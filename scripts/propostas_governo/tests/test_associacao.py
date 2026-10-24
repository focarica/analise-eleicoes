import unittest

from scripts.propostas_governo.associacao import (
    ESTADO_EXATO,
    ESTADO_NAO_ASSOCIADO,
    ESTADO_OUTRO_CARGO,
    ESTADO_PENDENTE,
    ESTADO_SEM_DOCUMENTO,
    TIPO_LEIAME,
    associar,
    sq_do_nome,
)
from scripts.propostas_governo.modelos import Candidatura, Documento

# SQ_CANDIDATO reais têm 8 a 12 dígitos; o padrão exige pelo menos 5.
ALFA = "250001612465"
BETA = "250001612450"
GAMA = "250001609938"
DEP = "250001725452"


def cand(sq, nome, cargo="GOVERNADOR"):
    return Candidatura(
        ano=2022, uf="SP", sq=sq, nome=nome, nome_urna=nome, numero="1", partido="X",
        cd_cargo="3" if cargo == "GOVERNADOR" else "6", ds_cargo=cargo, situacao="APTO", turnos=(1,),
    )


def doc(nome, sha, status="EXTRAIDO", ano=2022, uf="SP"):
    return Documento(
        ano=ano, uf=uf, nome_original=nome, caminho_interno_zip=f"SP/{nome}", url_arquivo="u",
        formato_declarado="PDF", formato_detectado="PDF", status_extracao=status,
        motivo_extracao="", caminho_local=f"data/x/{sha[:6]}_{nome}", tamanho_bytes=10, sha256=sha,
    )


class SqDoNomeTest(unittest.TestCase):
    def test_padroes_observados_nos_anos(self):
        self.assertEqual(sq_do_nome("2014SP250000000502.pdf", 2014, "SP"), "250000000502")
        self.assertEqual(sq_do_nome("2018BA50000600867.pdf", 2018, "BA"), "50000600867")
        self.assertEqual(sq_do_nome("proposta_governo_2018_SP_250000601522.pdf", 2018, "SP"), "250000601522")
        self.assertEqual(sq_do_nome("2022SP250001612465.PDF", 2022, "SP"), "250001612465")

    def test_nome_fora_do_padrao_nao_gera_sq(self):
        self.assertIsNone(sq_do_nome("leiame.pdf", 2022, "SP"))
        self.assertIsNone(sq_do_nome("2022BA50001612465.pdf", 2022, "SP"))  # UF divergente
        self.assertIsNone(sq_do_nome("2014SP250001612465.pdf", 2022, "SP"))  # ano divergente
        self.assertIsNone(sq_do_nome("2022SP123.pdf", 2022, "SP"))  # sequencial curto demais


class AssociarTest(unittest.TestCase):
    def setUp(self):
        self.cands = {
            ALFA: cand(ALFA, "ALFA"),
            BETA: cand(BETA, "BETA"),
            GAMA: cand(GAMA, "GAMA"),
            DEP: cand(DEP, "DEPUTADO X", cargo="DEPUTADO ESTADUAL"),
        }

    def _por_status(self, assocs):
        out = {}
        for a in assocs:
            out.setdefault(a.status_associacao, []).append(a)
        return out

    def test_match_exato_e_sem_documento(self):
        docs = [doc(f"2022SP{ALFA}.pdf", "a" * 64)]
        res = self._por_status(associar(2022, "SP", self.cands, docs, busca_conclusiva=True))
        self.assertEqual(len(res[ESTADO_EXATO]), 1)
        self.assertEqual(res[ESTADO_EXATO][0].candidatura.sq, ALFA)
        sem = {a.candidatura.sq for a in res[ESTADO_SEM_DOCUMENTO]}
        self.assertEqual(sem, {BETA, GAMA})
        for a in res[ESTADO_SEM_DOCUMENTO]:
            self.assertTrue(a.busca_conclusiva)

    def test_busca_nao_conclusiva_quando_recurso_falhou(self):
        res = self._por_status(associar(2022, "SP", self.cands, [], busca_conclusiva=False))
        for a in res[ESTADO_SEM_DOCUMENTO]:
            self.assertFalse(a.busca_conclusiva)
            self.assertIn("não conclusiva", a.motivo)

    def test_outro_cargo_e_fora_do_escopo(self):
        docs = [doc(f"2022SP{DEP}.pdf", "b" * 64)]
        res = self._por_status(associar(2022, "SP", self.cands, docs, busca_conclusiva=True))
        self.assertEqual(res[ESTADO_OUTRO_CARGO][0].candidatura.sq, DEP)
        self.assertNotIn(ESTADO_EXATO, res)

    def test_sq_inexistente_e_nao_associado(self):
        docs = [doc("2022SP250009999999.pdf", "c" * 64)]
        res = self._por_status(associar(2022, "SP", self.cands, docs, busca_conclusiva=True))
        self.assertEqual(res[ESTADO_NAO_ASSOCIADO][0].sq_no_nome, "250009999999")
        self.assertIsNone(res[ESTADO_NAO_ASSOCIADO][0].candidatura)

    def test_leiame_nao_e_proposta(self):
        docs = [doc("leiame.pdf", "d" * 64)]
        res = associar(2022, "SP", self.cands, docs, busca_conclusiva=True)
        leiames = [a for a in res if a.tipo_documento == TIPO_LEIAME]
        self.assertEqual(len(leiames), 1)
        self.assertEqual(leiames[0].status_associacao, ESTADO_NAO_ASSOCIADO)

    def test_mais_de_um_pdf_para_mesma_candidatura_fica_pendente(self):
        docs = [doc(f"2022SP{ALFA}.pdf", "e" * 64), doc(f"proposta_governo_2022_SP_{ALFA}.pdf", "f" * 64)]
        res = self._por_status(associar(2022, "SP", self.cands, docs, busca_conclusiva=True))
        self.assertEqual(len(res[ESTADO_PENDENTE]), 2)

    def test_conteudo_identico_entre_candidaturas_fica_pendente(self):
        igual = "9" * 64
        docs = [doc(f"2022SP{ALFA}.pdf", igual), doc(f"2022SP{BETA}.pdf", igual)]
        res = associar(2022, "SP", self.cands, docs, busca_conclusiva=True)
        por_nome = {a.documento.nome_original: a for a in res if a.documento}
        self.assertEqual(por_nome[f"2022SP{ALFA}.pdf"].status_associacao, ESTADO_PENDENTE)
        self.assertEqual(por_nome[f"2022SP{BETA}.pdf"].status_associacao, ESTADO_PENDENTE)
        self.assertEqual(por_nome[f"2022SP{BETA}.pdf"].duplicado_de, f"SP/2022SP{ALFA}.pdf")

    def test_conteudo_identico_com_governador_e_nao_associado_fica_pendente(self):
        igual = "8" * 64
        docs = [doc(f"2022SP{ALFA}.pdf", igual), doc("2022SP250009999999.pdf", igual)]
        res = associar(2022, "SP", self.cands, docs, busca_conclusiva=True)
        por_nome = {a.documento.nome_original: a for a in res if a.documento}
        self.assertEqual(por_nome[f"2022SP{ALFA}.pdf"].status_associacao, ESTADO_PENDENTE)
        self.assertIn("conteúdo idêntico", por_nome[f"2022SP{ALFA}.pdf"].motivo)
        self.assertEqual(por_nome["2022SP250009999999.pdf"].status_associacao, ESTADO_NAO_ASSOCIADO)

    def test_extracao_rejeitada_vira_nao_associado(self):
        docs = [doc(f"2022SP{ALFA}.pdf", "7" * 64, status="INVALIDO")]
        res = associar(2022, "SP", self.cands, docs, busca_conclusiva=True)
        self.assertEqual(res[0].status_associacao, ESTADO_NAO_ASSOCIADO)
        self.assertEqual(res[0].tipo_documento, "invalido")


if __name__ == "__main__":
    unittest.main()
