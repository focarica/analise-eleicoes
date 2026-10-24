import unittest
from unittest import mock

from scripts.propostas_governo import ckan
from scripts.propostas_governo.download import ErroDownload


RECURSOS_2022 = [
    ("https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/consulta_cand_2022.zip", "CSV"),
    ("https://cdn.tse.jus.br/estatistica/sead/odsele/proposta_governo/proposta_governo_2022_SP.zip", "PDF"),
    ("https://cdn.tse.jus.br/estatistica/sead/odsele/proposta_governo/proposta_governo_2022_BA.zip", "PDF"),
    ("https://cdn.tse.jus.br/estatistica/sead/odsele/proposta_governo/proposta_governo_2022_RJ.zip", "PDF"),
]


class DescobertaTest(unittest.TestCase):
    def test_extrai_urls_por_nome_esperado(self):
        rec = ckan.RecursosAno(ano=2022)
        ckan._aplicar(rec, RECURSOS_2022, "ckan", ("SP", "BA"))
        self.assertTrue(rec.url_candidaturas.endswith("consulta_cand_2022.zip"))
        self.assertEqual(set(rec.urls_propostas), {"SP", "BA"})
        self.assertEqual(rec.formatos_propostas["SP"], "PDF")
        self.assertEqual(rec.ausentes(("SP", "BA")), [])

    def test_ausentes_quando_recurso_nao_existe(self):
        rec = ckan.RecursosAno(ano=2022)
        ckan._aplicar(rec, RECURSOS_2022[1:2], "ckan", ("SP", "BA"))
        self.assertEqual(rec.ausentes(("SP", "BA")), ["candidaturas", "BA"])

    def test_descobrir_usa_pagina_quando_api_falha(self):
        html = (
            '<a href="https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/consulta_cand_2018.zip">c</a>'
            '<a href="https://cdn.tse.jus.br/estatistica/sead/odsele/proposta_governo/proposta_governo_2018_SP.zip">p</a>'
            '<a href="https://cdn.tse.jus.br/estatistica/sead/odsele/proposta_governo/proposta_governo_2018_BA.zip">p</a>'
        ).encode()

        def fake_obter(url, **kw):
            if "package_show" in url:
                raise ErroDownload("indisponível")
            return html

        with mock.patch.object(ckan, "obter_bytes", side_effect=fake_obter):
            rec = ckan.descobrir(2018, ("SP", "BA"))
        self.assertEqual(rec.fonte["candidaturas"], "pagina")
        self.assertEqual(set(rec.urls_propostas), {"SP", "BA"})
        self.assertEqual(rec.ausentes(("SP", "BA")), [])

    def test_descobrir_sem_pagina_reporta_ausencias(self):
        with mock.patch.object(ckan, "obter_bytes", side_effect=ErroDownload("x")):
            rec = ckan.descobrir(2018, ("SP", "BA"), usar_pagina=False)
        self.assertEqual(rec.ausentes(("SP", "BA")), ["candidaturas", "SP", "BA"])


if __name__ == "__main__":
    unittest.main()
