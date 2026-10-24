import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from scripts.propostas_governo import ocr, texto
from scripts.propostas_governo.extrair_texto import _status_final, _reutilizavel


TSV_EXEMPLO = "\n".join(
    [
        "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
        "1\t1\t0\t0\t0\t0\t0\t0\t100\t100\t-1\t",
        "5\t1\t1\t1\t1\t1\t10\t10\t40\t20\t91.5\tProposta",
        "5\t1\t1\t1\t1\t2\t60\t10\t20\t20\t92.0\tde",
        "5\t1\t1\t1\t2\t1\t10\t40\t60\t20\t80.0\tgoverno",
        "5\t1\t1\t1\t2\t2\t80\t40\t10\t20\t-1\t",
    ]
)


class TsvTest(unittest.TestCase):
    def test_agrupa_palavras_por_linha_e_calcula_confianca(self):
        texto_ocr, media, palavras = ocr.tsv_para_texto(TSV_EXEMPLO)
        self.assertEqual(texto_ocr, "Proposta de\ngoverno")
        self.assertAlmostEqual(media, (91.5 + 92.0 + 80.0) / 3, places=3)
        self.assertEqual(palavras, 3)

    def test_sem_palavras_devolve_vazio_e_confianca_nula(self):
        texto_ocr, media, palavras = ocr.tsv_para_texto("level\tpage\n")
        self.assertEqual((texto_ocr, media, palavras), ("", None, 0))


class MontagemComOcrTest(unittest.TestCase):
    def test_pagina_sem_texto_recebe_ocr_marcado(self):
        conteudo = texto.montar_texto(["texto nativo " * 5, ""], {2: "frase reconhecida"})
        self.assertIn("=== PÁGINA 2 ===\n[OCR]\nfrase reconhecida", conteudo)

    def test_titulo_curto_nativo_nao_impede_o_ocr_do_corpo(self):
        conteudo = texto.montar_texto(["P\nR\nO\nP\nO\nS\nT\nA\nS:"], {1: "corpo da proposta reconhecido"})
        self.assertIn("corpo da proposta reconhecido", conteudo)
        self.assertIn("P\nR\nO", conteudo)

    def test_pagina_sem_ocr_continua_marcada_como_vazia(self):
        conteudo = texto.montar_texto(["", ""], {1: "   "})
        self.assertEqual(conteudo.count("[página sem texto nativo]"), 2)

    def test_status_final_considera_paginas_recuperadas(self):
        self.assertEqual(_status_final(3, (2,), {2}), texto.STATUS_OK)
        self.assertEqual(_status_final(3, (2, 3), {2}), texto.STATUS_PARCIAL)
        self.assertEqual(_status_final(2, (1, 2), set()), texto.STATUS_SEM_TEXTO)
        self.assertEqual(_status_final(0, (), set()), texto.STATUS_SEM_TEXTO)


class ReutilizacaoTest(unittest.TestCase):
    def test_sem_ocr_reaproveita_registro_valido(self):
        with tempfile.TemporaryDirectory() as tmp:
            txt = Path(tmp) / "a.txt"
            txt.write_text("x", encoding="utf-8")
            anterior = {"sha256_pdf": "h", "status_texto": "OK", "ocr_versao": "", "paginas_sem_texto": "2"}
            self.assertTrue(_reutilizavel(anterior, "h", txt, False, ""))

    def test_com_ocr_refaz_quando_versao_muda_e_ha_paginas_pendentes(self):
        with tempfile.TemporaryDirectory() as tmp:
            txt = Path(tmp) / "a.txt"
            txt.write_text("x", encoding="utf-8")
            anterior = {"sha256_pdf": "h", "status_texto": "OK", "ocr_versao": "", "paginas_sem_texto": "2"}
            self.assertFalse(_reutilizavel(anterior, "h", txt, True, "por-dpi300-psm3"))

    def test_com_ocr_reaproveita_quando_nao_ha_pagina_sem_texto(self):
        with tempfile.TemporaryDirectory() as tmp:
            txt = Path(tmp) / "a.txt"
            txt.write_text("x", encoding="utf-8")
            anterior = {"sha256_pdf": "h", "status_texto": "OK", "ocr_versao": "", "paginas_sem_texto": ""}
            self.assertTrue(_reutilizavel(anterior, "h", txt, True, "por-dpi300-psm3"))


def _ferramentas_ok() -> bool:
    if not (shutil.which("convert") and shutil.which("pdftoppm") and shutil.which("tesseract")):
        return False
    try:
        ocr.verificar()
    except ocr.FerramentaOcrAusente:
        return False
    return True


@unittest.skipUnless(_ferramentas_ok(), "ImageMagick, pdftoppm ou idioma por do Tesseract indisponível")
class OcrRealTest(unittest.TestCase):
    def test_reconhece_texto_de_pdf_so_imagem(self):
        with tempfile.TemporaryDirectory() as tmp:
            t = Path(tmp)
            png = t / "pagina.png"
            pdf = t / "pagina.pdf"
            subprocess.run(
                ["convert", "-size", "1400x300", "xc:white", "-fill", "black", "-pointsize", "60",
                 "-annotate", "+40+150", "Proposta de governo para o Estado", str(png)],
                check=True, capture_output=True,
            )
            subprocess.run(["convert", str(png), str(pdf)], check=True, capture_output=True)
            self.assertEqual(texto.extrair(pdf).status, texto.STATUS_SEM_TEXTO)

            res = ocr.ocr_pagina(pdf, 1, t)
            self.assertEqual(res.erro, "")
            self.assertIn("Proposta", res.texto)
            self.assertIn("governo", res.texto.lower())
            self.assertIsNotNone(res.confianca_media)
            self.assertGreater(res.confianca_media, 50)


if __name__ == "__main__":
    unittest.main()
