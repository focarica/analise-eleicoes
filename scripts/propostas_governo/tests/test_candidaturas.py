import io
import tempfile
import unittest
import zipfile
from pathlib import Path

from scripts.propostas_governo.candidaturas import (
    ler_candidaturas,
    ler_candidaturas_zip,
    localizar_membro_uf,
    mapear_colunas,
)

CABECALHO = (
    '"ANO_ELEICAO";"SG_UF";"CD_CARGO";"DS_CARGO";"SQ_CANDIDATO";"NM_CANDIDATO";'
    '"NM_URNA_CANDIDATO";"NR_CANDIDATO";"SG_PARTIDO";"DS_SITUACAO_CANDIDATURA";"NR_TURNO"'
)


def _csv(linhas, cabecalho=CABECALHO):
    return ("\n".join([cabecalho, *linhas]) + "\n").encode("latin-1")


class LerCandidaturasTest(unittest.TestCase):
    def test_filtra_governador_da_uf_e_deduplica_turnos(self):
        conteudo = _csv(
            [
                '"2018";"SP";"3";"GOVERNADOR";"1";"FULANO DA SILVA";"FULANO";"45";"PSDB";"APTO";"1"',
                '"2018";"SP";"3";"GOVERNADOR";"1";"FULANO DA SILVA";"FULANO";"45";"PSDB";"APTO";"2"',
                '"2018";"SP";"6";"DEPUTADO FEDERAL";"2";"BELTRANO";"BELTRANO";"13";"PT";"APTO";"1"',
                '"2018";"SP";"3";"GOVERNADOR";"3";"ÇÁ JOÃO";"JOÃO";"13";"PT";"INAPTO";"1"',
            ]
        )
        arq = ler_candidaturas(conteudo, ano=2018, uf="SP")
        self.assertEqual(arq.encoding, "latin-1")
        self.assertEqual(len(arq.candidaturas), 3)
        gov = arq.governadores()
        self.assertEqual(set(gov), {"1", "3"})
        self.assertEqual(gov["1"].turnos, (1, 2))
        self.assertEqual(gov["3"].nome, "ÇÁ JOÃO")
        self.assertEqual(gov["3"].situacao, "INAPTO")  # situação preservada, não filtrada

    def test_ignora_linhas_de_outra_uf(self):
        conteudo = _csv(
            [
                '"2022";"BA";"3";"GOVERNADOR";"50001603638";"JERONIMO";"JERONIMO";"13";"PT";"APTO";"1"',
                '"2022";"SP";"3";"GOVERNADOR";"250001612465";"HADDAD";"HADDAD";"13";"PT";"APTO";"1"',
            ]
        )
        arq = ler_candidaturas(conteudo, ano=2022, uf="SP")
        self.assertEqual(list(arq.governadores()), ["250001612465"])
        self.assertEqual(arq.linhas_outra_uf, 1)

    def test_rejeita_codigo_de_cargo_incoerente(self):
        conteudo = _csv(['"2022";"SP";"4";"GOVERNADOR";"1";"X";"X";"1";"PT";"APTO";"1"'])
        with self.assertRaisesRegex(ValueError, "incoerente"):
            ler_candidaturas(conteudo, ano=2022, uf="SP")

    def test_rejeita_linha_de_outro_ano(self):
        conteudo = _csv(['"2014";"SP";"3";"GOVERNADOR";"1";"X";"X";"1";"PT";"APTO";"1"'])
        with self.assertRaisesRegex(ValueError, "outro ano"):
            ler_candidaturas(conteudo, ano=2022, uf="SP")

    def test_colunas_obrigatorias_ausentes_geram_erro(self):
        conteudo = _csv(['"2022";"SP";"3";"GOVERNADOR";"1";"X";"X";"1";"PT";"APTO";"1"'], cabecalho='"ANO_ELEICAO";"SG_UF"')
        with self.assertRaisesRegex(ValueError, "obrigatórias ausentes"):
            ler_candidaturas(conteudo, ano=2022, uf="SP")

    def test_aceita_nomes_alternativos_de_coluna(self):
        mapa = mapear_colunas(["ANO_ELEICAO", "SG_UF", "CD_CARGO", "DS_CARGO", "SQ_CANDIDATO", "NM_CANDIDATO", "SG_PARTIDO", "DS_SITUACAO_CANDIDATURA", "NR_TURNO"])
        self.assertNotIn("nome_urna", mapa)
        self.assertEqual(mapa["sq"], "SQ_CANDIDATO")

    def test_utf8_com_bom_e_decodificado(self):
        conteudo = ("\ufeff" + CABECALHO + "\n" + '"2022";"SP";"3";"GOVERNADOR";"1";"Ação";"A";"1";"PT";"APTO";"1"' + "\n").encode("utf-8")
        arq = ler_candidaturas(conteudo, ano=2022, uf="SP")
        self.assertEqual(arq.encoding, "utf-8")
        self.assertEqual(arq.governadores()["1"].nome, "Ação")


class ZipCandidaturasTest(unittest.TestCase):
    def test_localiza_csv_da_uf_dentro_do_zip(self):
        nomes = ["leiame.pdf", "consulta_cand_2022_BRASIL.csv", "consulta_cand_2022_BA.csv"]
        self.assertEqual(localizar_membro_uf(nomes, 2022, "BA"), "consulta_cand_2022_BA.csv")

    def test_le_csv_a_partir_de_zip(self):
        with tempfile.TemporaryDirectory() as tmp:
            caminho = Path(tmp) / "consulta_cand_2022.zip"
            with zipfile.ZipFile(caminho, "w") as zf:
                zf.writestr("consulta_cand_2022_SP.csv", _csv(['"2022";"SP";"3";"GOVERNADOR";"1";"X";"X";"1";"PT";"APTO";"1"']))
            arq = ler_candidaturas_zip(caminho, ano=2022, uf="SP")
            self.assertEqual(list(arq.governadores()), ["1"])
            self.assertEqual(arq.membro, "consulta_cand_2022_SP.csv")


if __name__ == "__main__":
    unittest.main()
