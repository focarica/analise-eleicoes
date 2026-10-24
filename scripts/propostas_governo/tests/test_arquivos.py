import stat
import tempfile
import unittest
import zipfile
from pathlib import Path

from scripts.propostas_governo import config
from scripts.propostas_governo.arquivos import (
    ErroExtracao,
    detectar_formato,
    extrair_pdfs,
    motivo_rejeicao_membro,
    nome_seguro,
)

PDF = b"%PDF-1.4\n%fake\n1 0 obj<<>>endobj\n%%EOF\n"


class FormatoTest(unittest.TestCase):
    def test_detecta_pelo_conteudo_e_nao_pela_extensao(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            casos = {
                "a.pdf": (PDF, "PDF"),
                "b.zip": (b"PK\x03\x04" + b"\x00" * 30, "ZIP"),
                "c.pdf": (b"<html>erro</html>", "OUTRO"),
                "d.bin": (b"\x7fELF\x02\x01", "EXECUTAVEL"),
            }
            for nome, (conteudo, esperado) in casos.items():
                (d / nome).write_bytes(conteudo)
                self.assertEqual(detectar_formato(d / nome), esperado, nome)

    def test_nome_seguro_remove_caminho_e_acentos(self):
        self.assertEqual(nome_seguro("../../etc/passwd.pdf"), "etc_passwd.pdf")
        self.assertEqual(nome_seguro("Proposta São Paulo.pdf"), "Proposta_Sao_Paulo.pdf")
        self.assertTrue(nome_seguro("x" * 300 + ".pdf").endswith(".pdf"))
        self.assertLessEqual(len(nome_seguro("x" * 300 + ".pdf")), 100)


class ExtracaoSegurTest(unittest.TestCase):
    def _zip(self, tmp: Path, membros: dict) -> Path:
        caminho = tmp / "proposta.zip"
        with zipfile.ZipFile(caminho, "w", zipfile.ZIP_DEFLATED) as zf:
            for nome, dados in membros.items():
                if isinstance(dados, zipfile.ZipInfo):
                    zf.writestr(dados, b"x")
                else:
                    zf.writestr(nome, dados)
        return caminho

    def test_extrai_somente_pdfs_com_nome_gerado(self):
        with tempfile.TemporaryDirectory() as tmp:
            t = Path(tmp)
            zp = self._zip(t, {"SP/2022SP250001612465.pdf": PDF, "SP/leiame.pdf": PDF + b"2", "SP/notas.txt": b"oi"})
            resumo = extrair_pdfs(zp, t / "pdfs", prefixo="2022_SP")
            self.assertEqual(resumo.membros_nao_pdf, 1)
            extraidos = [i for i in resumo.itens if i.status == "EXTRAIDO"]
            self.assertEqual(len(extraidos), 2)
            for i in extraidos:
                self.assertTrue(i.caminho_local.name.startswith("2022_SP_"))
                self.assertIn(i.sha256[:12], i.caminho_local.name)
                self.assertTrue(i.caminho_local.is_file())
                self.assertEqual(i.caminho_local.parent, t / "pdfs")

    def test_path_traversal_nao_grava_fora_do_destino(self):
        with tempfile.TemporaryDirectory() as tmp:
            t = Path(tmp)
            zp = self._zip(t, {"../fora.pdf": PDF, "ok/2022SP1234567890.pdf": PDF})
            resumo = extrair_pdfs(zp, t / "pdfs", prefixo="2022_SP")
            rejeitados = [i for i in resumo.itens if i.status == "REJEITADO"]
            self.assertEqual(len(rejeitados), 1)
            self.assertIn("path traversal", rejeitados[0].motivo)
            self.assertFalse((t / "fora.pdf").exists())
            self.assertFalse((t.parent / "fora.pdf").exists())

    def test_rejeita_link_simbolico(self):
        with tempfile.TemporaryDirectory() as tmp:
            t = Path(tmp)
            info = zipfile.ZipInfo("link.pdf")
            info.external_attr = (stat.S_IFLNK | 0o777) << 16
            zp = self._zip(t, {"link.pdf": info})
            resumo = extrair_pdfs(zp, t / "pdfs", prefixo="2022_SP")
            self.assertEqual(resumo.itens[0].status, "REJEITADO")
            self.assertIn("link", resumo.itens[0].motivo)

    def test_pdf_falso_nao_e_extraido(self):
        with tempfile.TemporaryDirectory() as tmp:
            t = Path(tmp)
            zp = self._zip(t, {"falso.pdf": b"<html>erro</html>"})
            resumo = extrair_pdfs(zp, t / "pdfs", prefixo="2022_SP")
            self.assertEqual(resumo.itens[0].status, "INVALIDO")
            self.assertEqual(list((t / "pdfs").glob("2022_SP_*")), [])

    def test_conteudo_identico_mantem_originais_e_mesmo_hash(self):
        # Os arquivos são preservados um a um; a duplicidade é registrada pelo SHA-256.
        with tempfile.TemporaryDirectory() as tmp:
            t = Path(tmp)
            zp = self._zip(t, {"BA/2018BA50000600866.pdf": PDF, "BA/2018BA50000600867.pdf": PDF})
            resumo = extrair_pdfs(zp, t / "pdfs", prefixo="2018_BA")
            self.assertEqual(len(resumo.itens), 2)
            self.assertEqual(len({i.sha256 for i in resumo.itens}), 1)
            self.assertEqual(len({i.caminho_local for i in resumo.itens}), 2)

    def test_zip_corrompido_levanta_erro(self):
        with tempfile.TemporaryDirectory() as tmp:
            t = Path(tmp)
            ruim = t / "ruim.zip"
            ruim.write_bytes(b"PK\x03\x04 nada")
            with self.assertRaises(ErroExtracao):
                extrair_pdfs(ruim, t / "pdfs", prefixo="x")

    def test_motivos_de_rejeicao(self):
        info = zipfile.ZipInfo("a/../b.pdf")
        self.assertIn("traversal", motivo_rejeicao_membro(info))
        info = zipfile.ZipInfo("/abs.pdf")
        self.assertIn("absoluto", motivo_rejeicao_membro(info))
        info = zipfile.ZipInfo("normal.pdf")
        self.assertIsNone(motivo_rejeicao_membro(info))
        self.assertEqual(config.MAX_RAZAO_COMPRESSAO, 100)


if __name__ == "__main__":
    unittest.main()
