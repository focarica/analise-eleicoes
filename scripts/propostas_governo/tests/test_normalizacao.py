import unittest

from scripts.propostas_governo.normalizacao import is_titulo, normalizar_texto


class NormalizacaoTest(unittest.TestCase):
    def test_substitui_ligaduras_e_caracteres_invisiveis(self):
        t, est = normalizar_texto("A pro\ufb01ssão da \ufb02oresta\u00ad\n")
        self.assertIn("profissão da floresta", t)
        self.assertEqual(est.ligaduras_substituidas, 2)

    def test_remove_hifenizacao_artificial(self):
        t, est = normalizar_texto("Reforçar o ensino sobre o exercí-\ncio da cidadania.\n")
        self.assertEqual(t.strip(), "Reforçar o ensino sobre o exercício da cidadania.")
        self.assertEqual(est.hifenizacoes_removidas, 1)

    def test_mantem_hifen_de_prefixo_composto(self):
        t, est = normalizar_texto("Promover o bem-\nestar da família.\n")
        self.assertEqual(t.strip(), "Promover o bem-estar da família.")
        self.assertEqual(est.hifenizacoes_removidas, 0)
        self.assertEqual(est.hifenizacoes_mantidas, 1)

    def test_junta_quebras_de_layout_dentro_do_paragrafo(self):
        bruto = "Ampliar o atendimento nas\nunidades básicas de saúde. Construir\nnovos hospitais.\n"
        t, _ = normalizar_texto(bruto)
        self.assertEqual(t.strip(), "Ampliar o atendimento nas unidades básicas de saúde. Construir novos hospitais.")

    def test_preserva_paragrafos_separados_por_linha_em_branco(self):
        t, _ = normalizar_texto("Primeiro parágrafo.\n\nSegundo parágrafo.\n")
        self.assertEqual(t.strip(), "Primeiro parágrafo.\n\nSegundo parágrafo.")

    def test_titulo_fica_separado_do_paragrafo_seguinte(self):
        t, _ = normalizar_texto("DIRETRIZES\nINTRODUÇÃO\nO Estado tem muitas experiências\nde sucesso.\n")
        blocos = t.strip().split("\n\n")
        self.assertEqual(blocos[0], "DIRETRIZES")
        self.assertEqual(blocos[1], "INTRODUÇÃO")
        self.assertEqual(blocos[2], "O Estado tem muitas experiências de sucesso.")

    def test_marcadores_de_pagina_e_ocr_sao_preservados(self):
        bruto = "=== PÁGINA 1 ===\n[OCR]\ntexto digitalizado\n=== PÁGINA 2 ===\n[página sem texto nativo]\n"
        t, _ = normalizar_texto(bruto)
        for marcador in ("=== PÁGINA 1 ===", "[OCR]", "=== PÁGINA 2 ===", "[página sem texto nativo]"):
            self.assertIn(marcador, t)
        self.assertNotIn("[OCR] texto", t)

    def test_itens_de_lista_nao_sao_unidos_ao_item_anterior(self):
        t, _ = normalizar_texto("1. Ampliar a rede de saúde.\n2. Criar centros de convivência.\n")
        self.assertEqual(t.strip(), "1. Ampliar a rede de saúde.\n\n2. Criar centros de convivência.")

    def test_entrada_vazia(self):
        t, est = normalizar_texto("")
        self.assertEqual(t, "")
        self.assertEqual(est.paragrafos, 0)

    def test_frase_em_caixa_alta_com_pontuacao_nao_e_titulo(self):
        self.assertFalse(is_titulo("É PRECISO POR PRA FORA O GENOCIDA E DERROTAR TARCÍSIO DE FREITAS EM SÃO PAULO!"))
        self.assertFalse(is_titulo("Níquel (em Itagibá), vanádio (em Maracás), ouro (em Jacobina e"))

    def test_titulo_em_caixa_alta(self):
        self.assertTrue(is_titulo("EIXO 1 – ESTAR BEM"))
        self.assertFalse(is_titulo("Ampliar a rede de saúde mental e a atenção básica."))


if __name__ == "__main__":
    unittest.main()
