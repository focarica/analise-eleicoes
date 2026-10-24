"""Testes dos cenários de segmentação (plano: seção 5, cenários 1 a 12) e dos componentes."""
import csv
import tempfile
import unittest
from pathlib import Path

from scripts.propostas_governo.normalizacao import normalizar_texto
from scripts.propostas_governo.segmentacao import avaliacao, pipeline
from scripts.propostas_governo.segmentacao.consolidacao import identificador, segmentar
from scripts.propostas_governo.segmentacao.documento import agrupar, ler_blocos
from scripts.propostas_governo.segmentacao.semantica import (
    INDETERMINADO,
    SEM_PROPOSTA,
    UMA_PROPOSTA,
    HeuristicaLocal,
)
from scripts.propostas_governo.segmentacao.sentencas import frases
from scripts.propostas_governo.segmentacao.regras import analisar, partes_coordenadas

CLASSIFICADOR = HeuristicaLocal()


def segmentar_texto(texto_normalizado: str):
    paragrafos = agrupar(ler_blocos(texto_normalizado))
    return segmentar(paragrafos, CLASSIFICADOR)


def pagina(*paragrafos: str, numero: int = 1) -> str:
    return f"=== PÁGINA {numero} ===\n\n" + "\n\n".join(paragrafos) + "\n"


class Cenario1DuasPropostasEmFrasesConsecutivas(unittest.TestCase):
    def test_entrada_e_saida(self):
        # Entrada: "Ampliar o atendimento nas unidades básicas de saúde. Construir novos hospitais regionais."
        props, desc, _ = segmentar_texto(pagina(
            "Ampliar o atendimento nas unidades básicas de saúde. Construir novos hospitais regionais."))
        self.assertEqual([p.texto for p in props], [
            "Ampliar o atendimento nas unidades básicas de saúde.",
            "Construir novos hospitais regionais.",
        ])
        self.assertTrue(all(p.status == "UMA_PROPOSTA" and not p.precisa_revisao for p in props))
        self.assertEqual(desc, [])


class Cenario2PropostaComFrasesComplementares(unittest.TestCase):
    def test_oracao_reduzida_mantem_uma_proposta(self):
        # Exemplo do plano: a expansão e seus componentes complementares ficam juntos.
        props, _, _ = segmentar_texto(pagina(
            "Ampliar o ensino técnico estadual, oferecendo novos cursos e expandindo a estrutura das escolas existentes."))
        self.assertEqual(len(props), 1)
        self.assertEqual(props[0].status, "UMA_PROPOSTA")

    def test_frase_de_continuacao_e_anexada_a_anterior(self):
        props, _, _ = segmentar_texto(pagina(
            "Vamos criar um programa de bolsas para estudantes. Para isso, serão contratados 200 professores."))
        self.assertEqual(len(props), 1)
        self.assertEqual(props[0].status, "CONSOLIDADA_DE_FRASES")
        self.assertEqual(props[0].texto, "Vamos criar um programa de bolsas para estudantes. "
                                         "Para isso, serão contratados 200 professores.")
        self.assertEqual(len(props[0].frases_ids), 2)


class Cenario3DuasPropostasNoMesmoParagrafo(unittest.TestCase):
    def test_divide_verbos_coordenados_com_objetos_proprios(self):
        props, _, _ = segmentar_texto(pagina("Construir escolas e ampliar hospitais."))
        self.assertEqual([p.texto for p in props], ["Construir escolas", "ampliar hospitais."])
        self.assertTrue(all(p.status == "DIVIDIDA_DE_MULTIPLAS" for p in props))

    def test_nao_divide_verbo_com_objeto_compartilhado(self):
        props, _, _ = segmentar_texto(pagina("Ampliar e melhorar o atendimento."))
        self.assertEqual(len(props), 1)

    def test_objeto_coordenado_com_oracao_reduzida_e_ambiguo(self):
        # Exemplo do plano: não criar divisões arbitrárias; registrar revisão.
        props, _, _ = segmentar_texto(pagina(
            "Investir em educação e saúde, garantindo melhores condições de vida para a população."))
        self.assertEqual(len(props), 1)
        self.assertEqual(props[0].status, "INDETERMINADO")
        self.assertTrue(props[0].precisa_revisao)
        self.assertIn("objeto coordenado", props[0].justificativa)


class Cenario4QuebrasArtificiaisDeLinha(unittest.TestCase):
    def test_frase_partida_entre_linhas_vira_uma_proposta(self):
        bruto = "=== PÁGINA 1 ===\nAmpliar o atendimento nas\nunidades básicas de saúde. Construir\nnovos hospitais regionais.\n"
        normalizado, _ = normalizar_texto(bruto)
        props, _, _ = segmentar_texto(normalizado)
        self.assertEqual([p.texto for p in props], [
            "Ampliar o atendimento nas unidades básicas de saúde.",
            "Construir novos hospitais regionais.",
        ])

    def test_hifenizacao_artificial_e_removida_antes_da_segmentacao(self):
        bruto = "=== PÁGINA 1 ===\nReforçar o ensino técnico e a formação profissional para o trabalho, ampliando o exercí-\ncio da cidadania.\n"
        normalizado, _ = normalizar_texto(bruto)
        props, _, _ = segmentar_texto(normalizado)
        self.assertEqual(len(props), 1)
        self.assertIn("exercício", props[0].texto)


class Cenario5ListasNumeradasEComMarcadores(unittest.TestCase):
    def test_itens_numerados(self):
        props, _, _ = segmentar_texto(pagina("1. Ampliar a rede de saúde mental.", "2. Criar centros de convivência."))
        self.assertEqual([p.texto for p in props], ["1. Ampliar a rede de saúde mental.",
                                                     "2. Criar centros de convivência."])

    def test_itens_com_marcadores(self):
        bruto = "=== PÁGINA 1 ===\n\n• Criar centros de convivência\n• Reduzir as filas do SUS\n"
        normalizado, _ = normalizar_texto(bruto)
        props, _, _ = segmentar_texto(normalizado)
        self.assertEqual(len(props), 2)
        self.assertTrue(all(p.paragrafo_id for p in props))


class Cenario5bSubitensDeUmaProposta(unittest.TestCase):
    def test_subitens_ficam_com_o_item_pai(self):
        props, _, _ = segmentar_texto(pagina(
            "284. Apoiar os pequenos empresários, com ações como:",
            "a) facilidade de abrir negócios,",
            "b) crédito facilitado."))
        self.assertEqual(len(props), 1)
        self.assertEqual(props[0].texto.count("\n"), 2)


class Cenario6TitulosESubtitulos(unittest.TestCase):
    def test_titulo_nao_e_proposta_e_define_secao(self):
        props, desc, _ = segmentar_texto(pagina("EIXO 1 – ESTAR BEM", "Ampliar a rede de atendimento."))
        self.assertEqual(len(props), 1)
        self.assertEqual(props[0].secao, "EIXO 1 – ESTAR BEM")
        self.assertEqual([d.motivo for d in desc], [SEM_PROPOSTA])
        self.assertEqual(desc[0].texto, "EIXO 1 – ESTAR BEM")


class Cenario7AbreviacoesENumeros(unittest.TestCase):
    def test_pontos_de_abreviacao_e_numeros_nao_quebram_proposta(self):
        texto = ("Vamos ampliar a rede do Dr. Paulo Costa em 3,5 km. "
                 "Construir a Av. Brasil com 2.000 metros de extensão.")
        self.assertEqual(frases(texto), [
            "Vamos ampliar a rede do Dr. Paulo Costa em 3,5 km.",
            "Construir a Av. Brasil com 2.000 metros de extensão.",
        ])
        props, _, _ = segmentar_texto(pagina(texto))
        self.assertEqual(len(props), 2)

    def test_inicial_de_nome_e_etc(self):
        self.assertEqual(len(frases("O prof. A. Costa apresentou o plano. Ele inclui saúde, etc. de fato.")), 2)


class Cenario8ContextualizacaoSemProposta(unittest.TestCase):
    def test_diagnostico_nao_gera_proposta(self):
        props, desc, _ = segmentar_texto(pagina(
            "Hoje o desemprego atinge 12% da população. Segundo a pesquisa anual, a renda caiu."))
        self.assertEqual(props, [])
        self.assertEqual([d.motivo for d in desc], [SEM_PROPOSTA, SEM_PROPOSTA])


class Cenario8bRotulosEFuturoVerbal(unittest.TestCase):
    def test_rotulo_de_lista_nao_e_proposta(self):
        props, desc, _ = segmentar_texto(pagina("Ciência e tecnologia", "Ações de saúde específicas:"))
        self.assertEqual(props, [])
        self.assertEqual(len(desc), 2)

    def test_futuro_verbal_e_acao(self):
        props, _, _ = segmentar_texto(pagina("Exigiremos contrapartidas trabalhistas das empresas que recebem benefícios."))
        self.assertEqual(len(props), 1)
        self.assertEqual(props[0].status, "UMA_PROPOSTA")

    def test_letra_de_lista_com_infinitivo(self):
        props, _, _ = segmentar_texto(pagina("c. Potencializar a inserção dos jovens no mundo do trabalho."))
        self.assertEqual(len(props), 1)


class Cenario9PropostaAmbigua(unittest.TestCase):
    def test_intencao_sem_acao_identificada_vai_para_revisao(self):
        props, _, _ = segmentar_texto(pagina("Será necessário um acordo amplo para as áreas da gestão."))
        self.assertEqual(len(props), 1)
        self.assertEqual(props[0].status, "INDETERMINADO")
        self.assertTrue(props[0].precisa_revisao)

    def test_descricao_sem_intencao_nao_vai_para_revisao(self):
        props, desc, _ = segmentar_texto(pagina("O ensino médio apresenta um quadro alarmante."))
        self.assertEqual(props, [])
        self.assertEqual(len(desc), 1)
        self.assertEqual(desc[0].motivo, SEM_PROPOSTA)


class Cenario10TextoVazioOuDefeituoso(unittest.TestCase):
    def test_texto_vazio(self):
        props, desc, contagem = segmentar_texto("")
        self.assertEqual((props, desc), ([], []))

    def test_somente_marcadores(self):
        props, desc, _ = segmentar_texto("=== PÁGINA 1 ===\n\n[página sem texto nativo]\n")
        self.assertEqual((props, desc), ([], []))

    def test_fragmento_sem_conteudo_vai_para_descartados(self):
        props, desc, _ = segmentar_texto(pagina("ok", "1,41"))
        self.assertEqual(props, [])
        self.assertEqual([d.texto for d in desc], ["ok", "1,41"])
        self.assertTrue(all("fragmento" in d.justificativa for d in desc))


class Cenario11PropostaQueAtravessaPagina(unittest.TestCase):
    def test_paragrafo_continua_na_pagina_seguinte(self):
        texto = ("=== PÁGINA 1 ===\n\nVamos ampliar a rede de atendimento para\n\n"
                 "=== PÁGINA 2 ===\n\nmais famílias da periferia.\n")
        props, _, _ = segmentar_texto(texto)
        self.assertEqual(len(props), 1)
        self.assertEqual(props[0].paginas, (1, 2))
        self.assertEqual(props[0].texto, "Vamos ampliar a rede de atendimento para mais famílias da periferia.")
        self.assertEqual(len(props[0].blocos_ids), 2)


class Cenario12RastreabilidadeAposDivisaoOuConsolidacao(unittest.TestCase):
    def test_divisao_preserva_bloco_e_frase_de_origem(self):
        props, _, _ = segmentar_texto(pagina("Construir escolas e ampliar hospitais."))
        self.assertEqual(props[0].blocos_ids, props[1].blocos_ids)
        self.assertEqual(props[0].frases_ids[0].split("-p")[0], props[1].frases_ids[0].split("-p")[0])
        self.assertNotEqual(props[0].frases_ids, props[1].frases_ids)

    def test_consolidacao_preserva_todas_as_frases(self):
        props, _, _ = segmentar_texto(pagina(
            "Vamos criar um programa de bolsas. Para isso, serão contratados 200 professores."))
        self.assertEqual(len(props[0].frases_ids), 2)
        self.assertTrue(all(f.startswith(props[0].paragrafo_id) for f in props[0].frases_ids))

    def test_texto_de_saida_e_trecho_do_original_normalizado(self):
        normalizado = pagina("Ampliar o atendimento. Construir novos hospitais. Criar escolas técnicas.")
        props, _, _ = segmentar_texto(normalizado)
        for p in props:
            self.assertIn(p.texto, normalizado)

    def test_identificador_e_estavel(self):
        props, _, _ = segmentar_texto(pagina("Ampliar o atendimento."))
        a = identificador("doc1", props[0])
        b = identificador("doc1", props[0])
        self.assertEqual(a, b)
        self.assertNotEqual(a, identificador("doc2", props[0]))


class ComponentesTest(unittest.TestCase):
    def test_partes_coordenadas_exigem_objeto(self):
        self.assertIsNone(partes_coordenadas("Ampliar e melhorar o atendimento."))
        self.assertIsNotNone(partes_coordenadas("Construir escolas e ampliar hospitais."))

    def test_indicios_de_compromisso_e_contexto(self):
        i = analisar("Vamos ampliar o atendimento. Hoje a rede é insuficiente.")
        self.assertTrue(i.compromisso)
        self.assertGreaterEqual(i.contexto, 1)

    def test_titulo_de_bloco_numerado_e_item(self):
        blocos = ler_blocos(pagina("EIXO 2 – CIDADANIA", "1. Ampliar a rede."))
        self.assertEqual([b.tipo for b in blocos], ["titulo", "item"])

    def test_classificacao_em_classes_validas(self):
        from scripts.propostas_governo.segmentacao.semantica import CLASSES
        props, desc, _ = segmentar_texto(pagina("Ampliar a rede. Hoje há muitos problemas."))
        self.assertTrue(all(p.classificacao in CLASSES for p in props))


class PipelineEAvaliacaoTest(unittest.TestCase):
    def _recorte(self, base: Path, texto_original: str):
        dir_uf = base / "propostas_governo" / "2022" / "SP"
        (dir_uf / "texto").mkdir(parents=True)
        (dir_uf / "texto_normalizado").mkdir(parents=True)
        (dir_uf / "texto" / "2022_SP_x_2022SP1.txt").write_text(texto_original, encoding="utf-8")
        from scripts.propostas_governo.manifesto import escrever_csv
        escrever_csv(dir_uf / "manifest.csv", [{
            "ano_eleicao": "2022", "uf": "SP", "cargo": "GOVERNADOR", "sq_candidato": "250000000001",
            "nome_candidato": "ALFA", "status_associacao": "MATCH_EXATO",
            "caminho_local": "data/propostas_governo/2022/SP/pdfs/2022_SP_x_2022SP1.pdf",
        }], COLUNAS_MIN)
        return dir_uf

    def test_reprocessar_nao_duplica_e_gera_mesmos_ids(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            self._recorte(base, "=== PÁGINA 1 ===\n\nAmpliar o atendimento. Construir hospitais.\n")
            pipeline.segmentar_recorte(2022, "SP", base, CLASSIFICADOR)
            primeiro = (base / "propostas_governo/2022/SP/segmentacao/propostas.csv").read_text(encoding="utf-8")
            pipeline.segmentar_recorte(2022, "SP", base, CLASSIFICADOR)
            segundo = (base / "propostas_governo/2022/SP/segmentacao/propostas.csv").read_text(encoding="utf-8")
            self.assertEqual(primeiro, segundo)
            with open(base / "propostas_governo/2022/SP/segmentacao/propostas.csv", encoding="utf-8") as fh:
                linhas = list(csv.DictReader(fh, delimiter=";"))
            self.assertEqual(len(linhas), 2)
            self.assertEqual(linhas[0]["metodo_segmentacao"], "regras_v1+heuristica_local_v1")

    def test_texto_vazio_no_recorte_e_registrado_sem_quebrar(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            self._recorte(base, "")
            r = pipeline.segmentar_recorte(2022, "SP", base, CLASSIFICADOR)
            self.assertEqual(r["relatorio"][0]["status"], "SEM_TEXTO")

    def test_consultar_mostra_texto_e_propostas(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            self._recorte(base, "=== PÁGINA 1 ===\n\nAmpliar o atendimento.\n")
            pipeline.segmentar_recorte(2022, "SP", base, CLASSIFICADOR)
            saida = pipeline.consultar(base, 2022, "SP", "250000000001")
            self.assertIn("TEXTO ORIGINAL", saida)
            self.assertIn("PROPOSTAS SEGMENTADAS (1)", saida)

    def test_amostra_e_avaliacao(self):
        propostas = [
            {"proposta_id": f"p{i}", "documento_id": "d", "status_segmentacao": s, "precisa_revisao": "nao",
             "texto_original": f"texto {i}"}
            for i, s in enumerate(["UMA_PROPOSTA"] * 4 + ["INDETERMINADO"] * 2)
        ]
        descartados = [{"documento_id": "d", "motivo": SEM_PROPOSTA, "texto": f"contexto {i}"} for i in range(3)]
        linhas = avaliacao.amostra(propostas, descartados, n_propostas=4, n_descartados=2, seed=1)
        self.assertEqual(sum(1 for l in linhas if l["origem"] == "proposta"), 4)
        self.assertEqual(sum(1 for l in linhas if l["origem"] == "descartado"), 2)
        rotuladas = []
        for l in linhas:
            l = dict(l)
            if l["origem"] == "proposta":
                l["avaliacao_humana"] = "PROPOSTA_VALIDA" if l["proposta_id"] != "p0" else "FRAGMENTADA_INDEVIDAMENTE"
            else:
                l["avaliacao_humana"] = "DESCARTE_CORRETO"
            rotuladas.append(l)
        m = avaliacao.resumir(rotuladas)
        self.assertEqual(m["propostas_revisadas"], 4)
        self.assertEqual(m["propostas_fragmentadas_indevidamente"], 1)
        self.assertEqual(m["propostas_omitidas_em_descartados"], 0)

    def test_rotulo_invalido_e_rejeitado(self):
        with self.assertRaises(ValueError):
            avaliacao.resumir([{"origem": "proposta", "avaliacao_humana": "BOM"}])


COLUNAS_MIN = ("ano_eleicao", "uf", "cargo", "sq_candidato", "nome_candidato", "status_associacao", "caminho_local")

if __name__ == "__main__":
    unittest.main()
