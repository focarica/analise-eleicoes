"""Auditoria de consistência da segmentação.

Lê ``propostas.csv``, ``trechos_descartados.csv`` e ``relatorio.csv`` de uma versão
da segmentação, e verifica contagens, campos, duplicatas, rastreabilidade ao texto
normalizado e sinais de problemas. Não altera nenhum arquivo: grava apenas o
relatório e as listas de casos em ``saida``.

Uso:

    python3 -m scripts.propostas_governo.segmentacao.auditoria \
        --segmentacao data/propostas_governo/2014/BA/segmentacao_v1_inicial \
        --texto-normalizado data/propostas_governo/2014/BA/texto_normalizado \
        --saida data/propostas_governo/2014/BA/auditoria_v1
"""
from __future__ import annotations

import argparse
import csv
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

from ..normalizacao import is_titulo
from .documento import ler_blocos
from .regras import analisar
from .semantica import INDETERMINADO, UMA_PROPOSTA

csv.field_size_limit(10**9)

CAMPOS_OBRIGATORIOS_PROPOSTA = (
    "proposta_id", "documento_id", "sq_candidato", "nome_candidato", "pdf_local",
    "texto_original", "pagina_inicial", "pagina_final", "blocos_origem", "status_segmentacao",
    "precisa_revisao",
)
CAMPOS_OBRIGATORIOS_DESCARTADO = (
    "documento_id", "sq_candidato", "pagina_inicial", "pagina_final", "blocos_origem", "motivo", "texto",
)
PALAVRAS_TRUNCAMENTO = {
    "e", "de", "a", "o", "os", "as", "do", "da", "dos", "das", "no", "na", "nos", "nas", "em", "um",
    "uma", "para", "com", "que", "por", "ao", "à", "sobre", "entre", "pelo", "pela",
}


def ler_csv(caminho: Path) -> list[dict]:
    with open(caminho, encoding="utf-8", newline="") as fh:
        return list(csv.DictReader(fh, delimiter=";"))


def _norm_ws(texto: str) -> str:
    return re.sub(r"\s+", " ", texto).strip()


def _jaccard(a: str, b: str) -> float:
    ta, tb = set(re.findall(r"\w+", a.lower())), set(re.findall(r"\w+", b.lower()))
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


@dataclass
class Achados:
    """Acumula achados. Cada achado é um dict com ``tipo``, ``severidade`` e campos livres."""

    itens: list[dict] = field(default_factory=list)

    def add(self, tipo: str, severidade: str, **campos) -> None:
        self.itens.append({"tipo": tipo, "severidade": severidade, **campos})

    def contar(self) -> Counter:
        return Counter(i["tipo"] for i in self.itens)


def auditar(
    propostas: list[dict],
    descartados: list[dict],
    relatorio: list[dict],
    blocos_por_documento: dict[str, dict[str, str]],
) -> tuple[dict, Achados]:
    """Retorna (métricas, achados). ``blocos_por_documento``: documento_id -> {bloco_id: texto}."""
    a = Achados()
    m: dict = {}

    m["registros_propostas"] = len(propostas)
    m["registros_descartados"] = len(descartados)
    m["documentos_relatorio"] = len(relatorio)
    m["status_segmentacao"] = dict(Counter(p["status_segmentacao"] for p in propostas))
    m["classificacao"] = dict(Counter(p.get("classificacao", "") for p in propostas))
    m["precisa_revisao"] = dict(Counter(p["precisa_revisao"] for p in propostas))
    m["motivos_descarte"] = dict(Counter(d["motivo"] for d in descartados))

    # 1. Campos obrigatórios
    for p in propostas:
        for c in CAMPOS_OBRIGATORIOS_PROPOSTA:
            if not (p.get(c) or "").strip():
                a.add("campo_obrigatorio_vazio", "alta", registro=p.get("proposta_id", ""), campo=c,
                      documento_id=p.get("documento_id", ""))
    for d in descartados:
        for c in CAMPOS_OBRIGATORIOS_DESCARTADO:
            if not (d.get(c) or "").strip():
                a.add("campo_obrigatorio_vazio", "alta", registro=d.get("blocos_origem", ""), campo=c,
                      documento_id=d.get("documento_id", ""))

    # 2. Identificadores
    ids = Counter(p["proposta_id"] for p in propostas)
    for k, v in ids.items():
        if v > 1:
            a.add("proposta_id_duplicado", "alta", registro=k, ocorrencias=v)

    # 3. Documento e candidato consistentes
    por_doc_sq = defaultdict(set)
    for p in propostas + descartados:
        por_doc_sq[p["documento_id"]].add(p["sq_candidato"])
    for doc, sqs in por_doc_sq.items():
        if len(sqs) > 1:
            a.add("candidato_inconsistente_no_documento", "alta", documento_id=doc, valores=";".join(sorted(sqs)))
    rel_ids = {r["documento_id"] for r in relatorio}
    for doc in por_doc_sq:
        if doc not in rel_ids:
            a.add("documento_sem_relatorio", "media", documento_id=doc)

    # 4. Contagens: relatório x registros
    por_doc_props = defaultdict(list)
    for p in propostas:
        por_doc_props[p["documento_id"]].append(p)
    por_doc_desc = defaultdict(list)
    for d in descartados:
        por_doc_desc[d["documento_id"]].append(d)
    comparacao = []
    for r in relatorio:
        doc = r["documento_id"]
        props = por_doc_props.get(doc, [])
        descs = por_doc_desc.get(doc, [])
        linha = {
            "documento_id": doc,
            "relatorio_propostas": int(r["propostas"] or 0),
            "registros_propostas": len(props),
            "relatorio_descartadas": int(r["descartadas"] or 0),
            "registros_descartados": len(descs),
            "relatorio_uma": int(r["uma_proposta"] or 0),
            "registros_uma": sum(1 for p in props if p["status_segmentacao"] == UMA_PROPOSTA),
            "relatorio_indeterminadas": int(r["indeterminadas"] or 0),
            "registros_indeterminadas": sum(1 for p in props if p["status_segmentacao"] == INDETERMINADO),
            "relatorio_revisao": int(r["revisao"] or 0),
            "registros_revisao": sum(1 for p in props if p["precisa_revisao"] == "sim"),
        }
        comparacao.append(linha)
        for campo_rel, campo_reg in [
            ("relatorio_propostas", "registros_propostas"),
            ("relatorio_descartadas", "registros_descartados"),
            ("relatorio_revisao", "registros_revisao"),
        ]:
            if linha[campo_rel] != linha[campo_reg]:
                a.add("contagem_relatorio_diferente", "alta", documento_id=doc, campo=campo_rel,
                      relatorio=linha[campo_rel], registros=linha[campo_reg])
        for campo_rel, campo_reg, rotulo in [
            ("relatorio_uma", "registros_uma", "uma_proposta"),
            ("relatorio_indeterminadas", "registros_indeterminadas", "indeterminadas"),
        ]:
            if linha[campo_rel] != linha[campo_reg]:
                a.add("contagem_relatorio_diferente", "media", documento_id=doc, campo=rotulo,
                      relatorio=linha[campo_rel], registros=linha[campo_reg],
                      nota="relatório conta unidades antes da consolidação; registros contam resultado final")
    m["comparacao_relatorio"] = comparacao

    # 5. Duplicatas exatas (mesmo texto) e quase-duplicatas
    grupos = defaultdict(list)
    for p in propostas:
        grupos[_norm_ws(p["texto_original"])].append(p)
    for texto, itens in grupos.items():
        if len(itens) > 1:
            mesmo_bloco = len({p["blocos_origem"] for p in itens}) < len(itens)
            a.add("duplicata_exata", "media", documento_id=itens[0]["documento_id"],
                  registros=";".join(p["proposta_id"] for p in itens),
                  mesmo_bloco="sim" if mesmo_bloco else "nao", texto=texto[:200])
    for doc, props in por_doc_props.items():
        textos = [(p["proposta_id"], _norm_ws(p["texto_original"])) for p in props if len(p["texto_original"]) > 60]
        for i in range(len(textos)):
            for j in range(i + 1, min(len(textos), i + 400)):
                if textos[i][1] == textos[j][1]:
                    continue
                if _jaccard(textos[i][1], textos[j][1]) >= 0.85:
                    a.add("quase_duplicata", "media", documento_id=doc,
                          registros=f"{textos[i][0]};{textos[j][0]}", texto=textos[i][1][:200])

    # 6. Texto e rastreabilidade
    for p in propostas:
        doc = p["documento_id"]
        texto = _norm_ws(p["texto_original"])
        if len(texto) < 25:
            a.add("texto_curto", "baixa", registro=p["proposta_id"], texto=texto, status=p["status_segmentacao"])
        if re.search(r"[\ufffd\x00-\x08\x0b\x0c\x0e-\x1f]", texto):
            a.add("texto_corrompido", "alta", registro=p["proposta_id"], texto=texto[:200])
        ultimo = re.findall(r"\w+", texto.lower())
        if ultimo and ultimo[-1] in PALAVRAS_TRUNCAMENTO and not re.search(r"[.!?;:\"”»)]$", texto):
            a.add("texto_truncado", "alta", registro=p["proposta_id"], texto=texto[-160:],
                  status=p["status_segmentacao"])
        blocos = blocos_por_documento.get(doc)
        if blocos is None:
            a.add("documento_sem_texto_normalizado", "alta", documento_id=doc)
            continue
        ids_bloco = [b for b in p["blocos_origem"].split(";") if b]
        faltantes = [b for b in ids_bloco if b not in blocos]
        if faltantes:
            a.add("bloco_inexistente", "alta", registro=p["proposta_id"], blocos=";".join(faltantes))
            continue
        origem = _norm_ws(" ".join(blocos[b] for b in ids_bloco))
        if texto not in origem:
            a.add("texto_fora_da_origem", "alta", registro=p["proposta_id"], texto=texto[:200])
        paginas_blocos = sorted({int(re.search(r"p(\d{3})", b).group(1)) for b in ids_bloco})
        if paginas_blocos and (int(p["pagina_inicial"]) != paginas_blocos[0] or int(p["pagina_final"]) != paginas_blocos[-1]):
            a.add("pagina_inconsistente_com_blocos", "media", registro=p["proposta_id"],
                  pagina_registro=f"{p['pagina_inicial']}-{p['pagina_final']}",
                  paginas_blocos=f"{paginas_blocos[0]}-{paginas_blocos[-1]}")

    # 7. Seção coerente com a ordem dos títulos: verificada em ``auditar_secoes``.

    # 8. Possíveis múltiplas propostas
    for p in propostas:
        t = p["texto_original"]
        inicios = len(re.findall(r"(?:^|[;\n]\s*)(?:\d{1,3}[.)]\s+|[a-z]\)\s+|[•●▪–-]\s*)?(?:[A-ZÀ-Ú][a-zà-ú]+(?:ar|er|ir)\b)", t))
        acoes_frase = sum(1 for s in re.split(r"(?<=[.;])\s+", t) if analisar(s).acoes)
        if inicios >= 2 or acoes_frase >= 2:
            a.add("possivel_multipla_proposta", "media", registro=p["proposta_id"],
                  status=p["status_segmentacao"], itens=inicios, frases_com_acao=acoes_frase,
                  texto=t[:200])

    # 9. Proposta com sinal diagnóstico e sem indício de ação ou compromisso
    for p in propostas:
        if p["status_segmentacao"] != UMA_PROPOSTA:
            continue
        i = analisar(p["texto_original"])
        if i.contexto >= 1 and not (i.compromisso or i.futuro_verbal or i.infinitivo_inicial):
            a.add("uma_proposta_com_sinal_diagnostico", "media", registro=p["proposta_id"],
                  texto=p["texto_original"][:200])
        if is_titulo(p["texto_original"]):
            a.add("titulo_classificado_como_proposta", "media", registro=p["proposta_id"],
                  texto=p["texto_original"][:200])

    # 10. Descartados: candidatos a recuperação e títulos
    recuperaveis = []
    for d in descartados:
        t = d["texto"]
        i = analisar(t)
        if d["motivo"] == "SEM_PROPOSTA" and (i.acoes or i.futuro_verbal or i.voz_passiva_futura
                                              or i.substantivo_de_acao) and not i.fragmento:
            recuperaveis.append(d)
            a.add("descartado_com_sinal_de_acao", "media", documento_id=d["documento_id"],
                  motivo=d["justificativa"], texto=t[:200])
    m["descartados_com_sinal_de_acao"] = len(recuperaveis)

    return m, a, comparacao


def auditar_secoes(propostas: list[dict], descartados: list[dict], blocos_por_documento: dict[str, list]) -> list[dict]:
    """Confere se o campo ``secao`` de cada registro é o último título antes do bloco de origem."""
    problemas = []
    for doc, blocos in blocos_por_documento.items():
        ordem = {b.id: n for n, b in enumerate(blocos)}
        titulos = [(n, b.texto) for n, b in enumerate(blocos) if b.tipo == "titulo"]
        for registro in propostas + descartados:
            if registro["documento_id"] != doc:
                continue
            primeiro = registro["blocos_origem"].split(";")[0]
            if primeiro not in ordem:
                continue
            n = ordem[primeiro]
            anteriores = [t for pos, t in titulos if pos <= n]
            esperado = anteriores[-1] if anteriores else ""
            if (registro.get("secao") or "") != esperado:
                problemas.append({"documento_id": doc, "registro": registro.get("proposta_id", registro.get("blocos_origem")),
                                  "secao_registrada": registro.get("secao", ""), "secao_esperada": esperado})
    return problemas


def carregar_blocos(texto_normalizado_dir: Path, propostas_docs: set[str]) -> tuple[dict, dict]:
    """Blocos por documento: (mapa id->texto, lista de Bloco para verificação de seções)."""
    mapa, listas = {}, {}
    for doc in propostas_docs:
        arq = texto_normalizado_dir / f"{doc}.txt"
        if not arq.exists():
            continue
        blocos = ler_blocos(arq.read_text(encoding="utf-8"))
        mapa[doc] = {b.id: b.texto for b in blocos}
        listas[doc] = blocos
    return mapa, listas


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Auditoria de consistência da segmentação.")
    p.add_argument("--segmentacao", type=Path, required=True)
    p.add_argument("--texto-normalizado", type=Path, required=True)
    p.add_argument("--saida", type=Path, required=True)
    args = p.parse_args(argv)

    propostas = ler_csv(args.segmentacao / "propostas.csv")
    descartados = ler_csv(args.segmentacao / "trechos_descartados.csv")
    relatorio = ler_csv(args.segmentacao / "relatorio.csv")
    docs = {p_["documento_id"] for p_ in propostas} | {d["documento_id"] for d in descartados}
    mapa, listas = carregar_blocos(args.texto_normalizado, docs)
    metricas, achados, comparacao = auditar(propostas, descartados, relatorio, mapa)
    problemas_secao = auditar_secoes(propostas, descartados, listas)
    for pr in problemas_secao:
        achados.add("secao_inconsistente", "media", registro=pr["registro"], documento_id=pr["documento_id"],
                    secao_registrada=pr["secao_registrada"], secao_esperada=pr["secao_esperada"])

    args.saida.mkdir(parents=True, exist_ok=True)
    with open(args.saida / "achados.csv", "w", encoding="utf-8", newline="") as fh:
        campos = sorted({k for i in achados.itens for k in i})
        w = csv.DictWriter(fh, fieldnames=campos, delimiter=";", extrasaction="ignore")
        w.writeheader()
        w.writerows(achados.itens)
    with open(args.saida / "comparacao_relatorio.csv", "w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(comparacao[0].keys()), delimiter=";")
        w.writeheader()
        w.writerows(comparacao)
    resumo = {
        "metricas": {k: v for k, v in metricas.items() if k != "comparacao_relatorio"},
        "achados_por_tipo": dict(achados.contar()),
    }
    import json
    (args.saida / "auditoria.json").write_text(json.dumps(resumo, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(resumo, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    import sys

    sys.exit(main())
