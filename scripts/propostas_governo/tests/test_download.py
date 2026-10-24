import http.server
import tempfile
import threading
import unittest
from pathlib import Path

from scripts.propostas_governo.arquivos import e_zip_ou_pdf
from scripts.propostas_governo.download import ErroDownload, baixar_arquivo, obter_bytes

PDF = b"%PDF-1.4\n" + b"A" * 50_000 + b"\n%%EOF\n"


class _Servidor:
    """Servidor local com respostas roteirizadas por caminho."""

    def __init__(self, rotas):
        self.rotas = rotas
        self.hits = {}
        outer = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                caminho = self.path
                outer.hits[caminho] = outer.hits.get(caminho, 0) + 1
                rota = outer.rotas.get(caminho)
                if rota is None:
                    self.send_response(404)
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                codigo_fn, corpo = rota
                codigo = codigo_fn(outer.hits[caminho])
                if codigo != 200:
                    self.send_response(codigo)
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                inicio = 0
                faixa = self.headers.get("Range")
                status = 200
                if faixa and faixa.startswith("bytes="):
                    inicio = int(faixa[6:].split("-")[0])
                    status = 206
                parte = corpo[inicio:]
                self.send_response(status)
                self.send_header("Content-Length", str(len(parte)))
                self.end_headers()
                self.wfile.write(parte)

        self.servidor = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.base = f"http://127.0.0.1:{self.servidor.server_address[1]}"
        self.thread = threading.Thread(target=self.servidor.serve_forever, daemon=True)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *exc):
        self.servidor.shutdown()
        self.servidor.server_close()


class DownloadTest(unittest.TestCase):
    def test_baixa_e_valida_pdf(self):
        with _Servidor({"/a.pdf": (lambda n: 200, PDF)}) as srv, tempfile.TemporaryDirectory() as tmp:
            destino = Path(tmp) / "a.pdf"
            res = baixar_arquivo(srv.base + "/a.pdf", destino, validador=e_zip_ou_pdf, pausa=0)
            self.assertTrue(res.baixado_agora)
            self.assertEqual(destino.read_bytes(), PDF)
            self.assertEqual(res.tamanho_bytes, len(PDF))
            self.assertEqual(len(res.sha256), 64)
            self.assertFalse((Path(tmp) / "a.pdf.part").exists())

    def test_nao_rebaixa_arquivo_valido_existente(self):
        with _Servidor({"/a.pdf": (lambda n: 200, PDF)}) as srv, tempfile.TemporaryDirectory() as tmp:
            destino = Path(tmp) / "a.pdf"
            destino.write_bytes(PDF)
            res = baixar_arquivo(srv.base + "/a.pdf", destino, validador=e_zip_ou_pdf, pausa=0)
            self.assertFalse(res.baixado_agora)
            self.assertEqual(srv.hits.get("/a.pdf", 0), 0)

    def test_404_nao_e_repetido(self):
        with _Servidor({}) as srv, tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ErroDownload):
                baixar_arquivo(srv.base + "/nada.zip", Path(tmp) / "x.zip", validador=e_zip_ou_pdf, pausa=0)
            self.assertEqual(srv.hits.get("/nada.zip"), 1)

    def test_erro_5xx_transitorio_e_repetido(self):
        with _Servidor({"/a.pdf": (lambda n: 500 if n == 1 else 200, PDF)}) as srv, tempfile.TemporaryDirectory() as tmp:
            res = baixar_arquivo(srv.base + "/a.pdf", Path(tmp) / "a.pdf", validador=e_zip_ou_pdf, pausa=0)
            self.assertEqual(res.tamanho_bytes, len(PDF))
            self.assertEqual(srv.hits["/a.pdf"], 2)

    def test_conteudo_que_nao_e_pdf_nao_vira_arquivo_final(self):
        with _Servidor({"/a.pdf": (lambda n: 200, b"<html>manutencao</html>")}) as srv, tempfile.TemporaryDirectory() as tmp:
            destino = Path(tmp) / "a.pdf"
            with self.assertRaises(ErroDownload):
                baixar_arquivo(srv.base + "/a.pdf", destino, validador=e_zip_ou_pdf, tentativas=2, pausa=0)
            self.assertFalse(destino.exists())

    def test_retoma_arquivo_parcial_com_range(self):
        with _Servidor({"/a.pdf": (lambda n: 200, PDF)}) as srv, tempfile.TemporaryDirectory() as tmp:
            destino = Path(tmp) / "a.pdf"
            parcial = Path(tmp) / "a.pdf.part"
            parcial.write_bytes(PDF[:10_000])
            res = baixar_arquivo(srv.base + "/a.pdf", destino, validador=e_zip_ou_pdf, pausa=0)
            self.assertEqual(destino.read_bytes(), PDF)
            self.assertEqual(res.tamanho_bytes, len(PDF))

    def test_obter_bytes_retorna_conteudo(self):
        with _Servidor({"/x.json": (lambda n: 200, b'{"success": true}')}) as srv:
            self.assertEqual(obter_bytes(srv.base + "/x.json", pausa=0), b'{"success": true}')


if __name__ == "__main__":
    unittest.main()
