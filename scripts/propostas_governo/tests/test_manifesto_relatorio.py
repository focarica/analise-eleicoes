import tempfile
import unittest
from pathlib import Path

from scripts.propostas_governo.associacao import associar
from scripts.propostas_governo.manifesto import COLUNAS_MANIFESTO, escrever_csv, ler_csv, linha_manifesto
from scripts.propostas_governo.modelos import Candidatura, Documento, ResultadoRecurso
from scripts.propostas_governo.relatorio import COLUNAS_RELATORIO, escrever_relatorio, resumir
from scripts.propostas_governo.associacao import escrever_revisao


def cand(sq, nome, cargo="GOVERNADOR"):
    return Candidatura(
        ano=2022, uf="SP", sq=sq, nome=nome, nome_urna=nome, numero="1", partido="P;X",
        cd_cargo="3" if cargo == "GOVERNADOR" else "6", ds_cargo=cargo, situacao="APTO", turnos=(1,),
    )


class ManifestoTest(unittest.TestCase):
    def test_gera_uma_linha_por_pdf_e_linha_para_sem_documento(self):
        raiz = Path("/repo")
        cands = {"250000000001": cand("250000000001", "ALFA"), "250000000002": cand("250000000002", "BETA")}
        documentos = [
            Documento(
                ano=2022, uf="SP", nome_original="2022SP250000000001.pdf", caminho_interno_zip="SP/2022SP250000000001.pdf",
                url_arquivo="https://x/z.zip", formato_declarado="PDF", formato_detectado="PDF",
                status_extracao="EXTRAIDO", motivo_extracao="", caminho_local="/repo/data/p/a.pdf",
                tamanho_bytes=99, sha256="a" * 64,
            )
        ]
        recurso = ResultadoRecurso(
            status_download="BAIXADO", url_recurso="https://x/z.zip", url_arquivo="https://x/z.zip",
            formato_declarado="PDF", formato_detectado="ZIP", caminho_local="data/z.zip", sha256="b" * 64,
            tamanho_bytes=5,
        )
        assocs = associar(2022, "SP", cands, documentos, busca_conclusiva=True)
        linhas = [linha_manifesto(a, recurso, raiz=raiz, data_coleta="2026-01-01T00:00:00") for a in assocs]
        self.assertEqual(len(linhas), 2)
        self.assertEqual(set(linhas[0].keys()), set(COLUNAS_MANIFESTO))
        com_pdf = [l for l in linhas if l["caminho_local"]]
        self.assertEqual(com_pdf[0]["caminho_local"], "data/p/a.pdf")
        sem = [l for l in linhas if l["status_associacao"] == "SEM_DOCUMENTO_LOCALIZADO"]
        self.assertEqual(sem[0]["sq_candidato"], "250000000002")
        self.assertEqual(sem[0]["caminho_local"], "")
        self.assertEqual(sem[0]["busca_conclusiva"], "sim")

    def test_csv_preserva_ponto_e_virgula_e_aspas(self):
        with tempfile.TemporaryDirectory() as tmp:
            caminho = Path(tmp) / "m.csv"
            linhas = [{c: "" for c in COLUNAS_MANIFESTO}]
            linhas[0]["partido"] = 'P;X "quoted"'
            escrever_csv(caminho, linhas, COLUNAS_MANIFESTO)
            lidas = ler_csv(caminho)
            self.assertEqual(lidas[0]["partido"], 'P;X "quoted"')

    def test_revisao_contem_pendentes_e_nao_associados_sem_leiame(self):
        cands = {"250000000001": cand("250000000001", "ALFA")}
        documentos = [
            Documento(2022, "SP", "leiame.pdf", "SP/leiame.pdf", "u", "PDF", "PDF", "EXTRAIDO", "", "/repo/a.pdf", 1, "c" * 64),
            Documento(2022, "SP", "2022SP250000000999.pdf", "SP/2022SP250000000999.pdf", "u", "PDF", "PDF", "EXTRAIDO", "", "/repo/b.pdf", 1, "d" * 64),
        ]
        assocs = associar(2022, "SP", cands, documentos, busca_conclusiva=True)
        with tempfile.TemporaryDirectory() as tmp:
            caminho = Path(tmp) / "revisao.csv"
            n = escrever_revisao(caminho, assocs, Path("/repo"))
            self.assertEqual(n, 1)
            linha = ler_csv(caminho)[0]
            self.assertEqual(linha["sq_candidato"], "250000000999")
            self.assertEqual(linha["status_associacao"], "NAO_ASSOCIADO")


class RelatorioTest(unittest.TestCase):
    def test_resumo_conta_estados(self):
        A, B, D = "250000000001", "250000000002", "250000000009"
        cands = {A: cand(A, "ALFA"), B: cand(B, "BETA"), D: cand(D, "DEP", cargo="DEPUTADO FEDERAL")}
        documentos = [
            Documento(2022, "SP", f"2022SP{A}.pdf", f"SP/2022SP{A}.pdf", "u", "PDF", "PDF", "EXTRAIDO", "", "/r/a.pdf", 1, "a" * 64),
            Documento(2022, "SP", f"2022SP{D}.pdf", f"SP/2022SP{D}.pdf", "u", "PDF", "PDF", "EXTRAIDO", "", "/r/b.pdf", 1, "b" * 64),
            Documento(2022, "SP", "x.pdf", "SP/x.pdf", "u", "PDF", "", "REJEITADO", "path", "", 0, ""),
        ]
        recurso = ResultadoRecurso(status_download="BAIXADO", url_recurso="u", formato_declarado="PDF")
        assocs = associar(2022, "SP", cands, documentos, busca_conclusiva=True)
        linha = resumir(2022, "SP", assocs, recurso, candidaturas_governador=2)
        self.assertEqual(linha.candidaturas_governador, 2)
        self.assertEqual(linha.pdfs_encontrados, 3)
        self.assertEqual(linha.pdfs_extraidos, 2)
        self.assertEqual(linha.extracoes_rejeitadas, 1)
        self.assertEqual(linha.candidaturas_com_pdf_associado, 1)
        self.assertEqual(linha.sem_documento_conclusivo, 1)
        self.assertEqual(linha.outros_cargos, 1)
        self.assertEqual(linha.recurso_proposta_localizado, "sim")

    def test_escrita_do_relatorio(self):
        from scripts.propostas_governo.relatorio import LinhaRelatorio
        with tempfile.TemporaryDirectory() as tmp:
            caminho = Path(tmp) / "r.csv"
            escrever_relatorio(caminho, [LinhaRelatorio(ano=2022, uf="SP")])
            lidas = ler_csv(caminho)
            self.assertEqual(set(lidas[0].keys()), set(COLUNAS_RELATORIO))


if __name__ == "__main__":
    unittest.main()
