import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from scripts.propostas_governo import texto
from scripts.propostas_governo.extrair_texto import _pdfs_do_recorte, processar_recorte
from scripts.propostas_governo.manifesto import escrever_csv

COLUNAS_MANIFESTO_MIN = (
    "ano_eleicao", "uf", "sq_candidato", "nome_candidato", "tipo_documento", "caminho_local", "status_associacao",
)


def pdf_com_texto(paginas):
    """Monta um PDF mínimo. ``None`` gera uma página sem conteúdo de texto."""
    objetos = []
    n_paginas = len(paginas)
    kids = " ".join(f"{3 + 2 * i} 0 R" for i in range(n_paginas))
    objetos.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    objetos.append(f"<< /Type /Pages /Kids [{kids}] /Count {n_paginas} >>".encode())
    fonte_id = 3 + 2 * n_paginas
    for i, texto_pagina in enumerate(paginas):
        page_id = 3 + 2 * i
        conteudo_id = page_id + 1
        recursos = f"/Resources << /Font << /F1 {fonte_id} 0 R >> >>"
        objetos.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] {recursos} /Contents {conteudo_id} 0 R >>".encode()
        )
        if texto_pagina is None:
            stream = b""
        else:
            stream = f"BT /F1 12 Tf 20 100 Td ({texto_pagina}) Tj ET".encode()
        objetos.append(f"<< /Length {len(stream)} >>\nstream\n".encode() + stream + b"\nendstream")
    objetos.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")

    corpo = bytearray(b"%PDF-1.4\n")
    for i, obj in enumerate(objetos, start=1):
        corpo += f"{i} 0 obj\n".encode() + obj + b"\nendobj\n"
    corpo += b"trailer\n<< /Root 1 0 R >>\n%%EOF\n"
    return bytes(corpo)


class ClassificacaoTest(unittest.TestCase):
    def test_todas_as_paginas_com_texto_sao_ok(self):
        res = texto.classificar(["texto " * 10, "outro " * 10], avisos=0)
        self.assertEqual(res.status, texto.STATUS_OK)
        self.assertEqual(res.paginas_sem_texto, ())

    def test_pagina_sem_texto_gera_parcial_com_numero_da_pagina(self):
        res = texto.classificar(["x" * 80, "", "y" * 80], avisos=0)
        self.assertEqual(res.status, texto.STATUS_PARCIAL)
        self.assertEqual(res.paginas_sem_texto, (2,))

    def test_nenhuma_pagina_com_texto_gera_sem_texto(self):
        res = texto.classificar(["  ", ""], avisos=0)
        self.assertEqual(res.status, texto.STATUS_SEM_TEXTO)

    def test_documento_sem_paginas_gera_sem_texto(self):
        self.assertEqual(texto.classificar([], avisos=0).status, texto.STATUS_SEM_TEXTO)

    def test_marcadores_de_pagina_sao_gerados(self):
        conteudo = texto.montar_texto(["primeira", "   "])
        self.assertIn("=== PÁGINA 1 ===\nprimeira", conteudo)
        self.assertIn("=== PÁGINA 2 ===\n[página sem texto nativo]", conteudo)


class ExtrairComFerramentaSimuladaTest(unittest.TestCase):
    def test_erro_do_pdftotext_gera_status_erro(self):
        resultado = subprocess.CompletedProcess(args=[], returncode=1, stdout=b"", stderr=b"Command Line Error: Incorrect password\n")
        with mock.patch.object(texto.subprocess, "run", return_value=resultado):
            res = texto.extrair(Path("x.pdf"), executavel="pdftotext")
        self.assertEqual(res.status, texto.STATUS_ERRO)
        self.assertIn("Incorrect password", res.erro)

    def test_separa_paginas_pelo_form_feed(self):
        resultado = subprocess.CompletedProcess(args=[], returncode=0, stdout=("a" * 40 + "\f" + "b" * 40 + "\f").encode(), stderr=b"Syntax Warning: x\n")
        with mock.patch.object(texto.subprocess, "run", return_value=resultado):
            res = texto.extrair(Path("x.pdf"), executavel="pdftotext")
        self.assertEqual(res.paginas, 2)
        self.assertEqual(res.avisos, 1)
        self.assertEqual(res.status, texto.STATUS_OK)


@unittest.skipUnless(shutil.which("pdftotext"), "pdftotext não instalado")
class ExtrairPdfRealTest(unittest.TestCase):
    def test_extrai_texto_de_pdf_sintetico_sem_alterar_o_arquivo(self):
        with tempfile.TemporaryDirectory() as tmp:
            pdf = Path(tmp) / "x.pdf"
            dados = pdf_com_texto(["Proposta de governo teste com texto suficiente para o limiar minimo de caracteres", None])
            pdf.write_bytes(dados)
            res = texto.extrair(pdf)
            self.assertEqual(res.paginas, 2)
            self.assertIn("Proposta de governo teste", res.texto)
            self.assertEqual(res.paginas_sem_texto, (2,))
            self.assertEqual(res.status, texto.STATUS_PARCIAL)
            self.assertEqual(pdf.read_bytes(), dados)


@unittest.skipUnless(shutil.which("pdftotext"), "pdftotext não instalado")
class ProcessarRecorteTest(unittest.TestCase):
    def test_leiame_fica_fora_e_pdf_duplicado_aparece_uma_vez(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            dir_uf = base / "propostas_governo" / "2022" / "SP"
            pdfs = dir_uf / "pdfs"
            pdfs.mkdir(parents=True)
            a = pdfs / "2022_SP_aaa_2022SP1.pdf"
            b = pdfs / "2022_SP_bbb_leiame.pdf"
            a.write_bytes(pdf_com_texto(["Texto da proposta do candidato alfa com bastante conteudo para passar do limiar de caracteres"]))
            b.write_bytes(pdf_com_texto(["Leiame"]))
            linhas = [
                {"ano_eleicao": "2022", "uf": "SP", "sq_candidato": "", "nome_candidato": "", "tipo_documento": "proposta", "caminho_local": str(a), "status_associacao": "NAO_ASSOCIADO"},
                {"ano_eleicao": "2022", "uf": "SP", "sq_candidato": "1", "nome_candidato": "ALFA", "tipo_documento": "proposta", "caminho_local": str(a), "status_associacao": "MATCH_EXATO"},
                {"ano_eleicao": "2022", "uf": "SP", "sq_candidato": "", "nome_candidato": "", "tipo_documento": "leiame", "caminho_local": str(b), "status_associacao": "NAO_ASSOCIADO"},
            ]
            escrever_csv(dir_uf / "manifest.csv", linhas, COLUNAS_MANIFESTO_MIN)

            itens = _pdfs_do_recorte(dir_uf)
            self.assertEqual(len(itens), 1)
            self.assertEqual(itens[0]["sq_candidato"], "1")

            regs = processar_recorte(2022, "SP", base, forcar=False, ocr_ativo=False)
            self.assertEqual(len(regs), 1)
            self.assertEqual(regs[0]["status_texto"], texto.STATUS_OK)
            txt = dir_uf / "texto" / "2022_SP_aaa_2022SP1.txt"
            self.assertTrue(txt.exists())
            self.assertIn("candidato alfa", txt.read_text(encoding="utf-8"))

            # Segunda execução reaproveita o registro sem reextrair.
            with mock.patch.object(texto, "extrair", side_effect=AssertionError("não deveria extrair")):
                regs2 = processar_recorte(2022, "SP", base, forcar=False, ocr_ativo=False)
            self.assertEqual(regs2[0]["status_texto"], texto.STATUS_OK)


if __name__ == "__main__":
    unittest.main()
