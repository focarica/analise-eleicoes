"""Avaliação da segmentação com revisão humana.

Não há conjunto revisado manualmente no repositório. O fluxo é:

1. ``amostra``: sorteia propostas e trechos descartados para revisão. A planilha
   tem a coluna ``avaliacao_humana`` para ser preenchida com um dos rótulos abaixo.
2. ``avaliar``: calcula as métricas a partir da planilha revisada.

Rótulos aceitos em ``avaliacao_humana``:
- PROPOSTA_VALIDA: proposta identificada corretamente (para propostas).
- FRAGMENTADA_INDEVIDAMENTE: uma proposta real foi partida em várias.
- FUNDIDA_INDEVIDAMENTE: duas ou mais propostas independentes foram unidas.
- NAO_E_PROPOSTA: a proposta é contexto, diagnóstico ou outro conteúdo (falso positivo).
- PROPOSTA_OMITIDA: trecho descartado que, na verdade, contém proposta (para descartados).
- DESCARTE_CORRETO: trecho descartado que não contém proposta.
"""
from __future__ import annotations

import random
from collections import Counter

ROTULOS = (
    "PROPOSTA_VALIDA", "FRAGMENTADA_INDEVIDAMENTE", "FUNDIDA_INDEVIDAMENTE", "NAO_E_PROPOSTA",
    "PROPOSTA_OMITIDA", "DESCARTE_CORRETO",
)
COLUNAS_AMOSTRA = (
    "origem", "proposta_id", "documento_id", "status_segmentacao", "precisa_revisao",
    "motivo_descarte", "texto", "avaliacao_humana", "observacao",
)


def amostra(
    propostas: list[dict],
    descartados: list[dict],
    *,
    n_propostas: int,
    n_descartados: int,
    seed: int = 20260501,
) -> list[dict]:
    """Amostra reprodutível. Estratifica propostas por status para cobrir os casos de risco."""
    rng = random.Random(seed)
    linhas: list[dict] = []

    por_status: dict[str, list[dict]] = {}
    for p in propostas:
        por_status.setdefault(p["status_segmentacao"], []).append(p)
    if propostas and n_propostas:
        grupos = sorted(por_status)
        quota = max(1, n_propostas // max(1, len(grupos)))
        escolhidas: list[dict] = []
        for g in grupos:
            itens = por_status[g]
            escolhidas.extend(rng.sample(itens, min(quota, len(itens))))
        restante = [p for p in propostas if p not in escolhidas]
        faltam = n_propostas - len(escolhidas)
        if faltam > 0 and restante:
            escolhidas.extend(rng.sample(restante, min(faltam, len(restante))))
        for p in escolhidas[:n_propostas]:
            linhas.append({
                "origem": "proposta", "proposta_id": p["proposta_id"], "documento_id": p["documento_id"],
                "status_segmentacao": p["status_segmentacao"], "precisa_revisao": p["precisa_revisao"],
                "motivo_descarte": "", "texto": p["texto_original"], "avaliacao_humana": "", "observacao": "",
            })

    if descartados and n_descartados:
        for d in rng.sample(descartados, min(n_descartados, len(descartados))):
            linhas.append({
                "origem": "descartado", "proposta_id": "", "documento_id": d["documento_id"],
                "status_segmentacao": "", "precisa_revisao": "",
                "motivo_descarte": d["motivo"], "texto": d["texto"], "avaliacao_humana": "", "observacao": "",
            })
    return linhas


def resumir(linhas: list[dict]) -> dict:
    """Métricas a partir da amostra revisada. Linhas sem rótulo são contadas à parte."""
    rotulos = Counter(l.get("avaliacao_humana", "").strip() for l in linhas)
    invalidos = [r for r in rotulos if r and r not in ROTULOS]
    if invalidos:
        raise ValueError(f"rótulos inválidos: {invalidos}")
    propostas = [l for l in linhas if l.get("origem") == "proposta" and l.get("avaliacao_humana")]
    descartes = [l for l in linhas if l.get("origem") == "descartado" and l.get("avaliacao_humana")]
    rotulos_prop = Counter(l["avaliacao_humana"] for l in propostas)
    rotulos_desc = Counter(l["avaliacao_humana"] for l in descartes)
    total_prop = len(propostas)
    validas = rotulos_prop["PROPOSTA_VALIDA"]
    return {
        "propostas_revisadas": total_prop,
        "propostas_validas": validas,
        "propostas_fragmentadas_indevidamente": rotulos_prop["FRAGMENTADA_INDEVIDAMENTE"],
        "propostas_fundidas_indevidamente": rotulos_prop["FUNDIDA_INDEVIDAMENTE"],
        "falsos_positivos_nao_e_proposta": rotulos_prop["NAO_E_PROPOSTA"],
        "precisao_aproximada": round(validas / total_prop, 3) if total_prop else None,
        "trechos_descartados_revisados": len(descartes),
        "propostas_omitidas_em_descartados": rotulos_desc["PROPOSTA_OMITIDA"],
        "taxa_omissao_na_amostra_descartada": round(rotulos_desc["PROPOSTA_OMITIDA"] / len(descartes), 3)
        if descartes else None,
        "trechos_encaminhados_para_revisao": sum(1 for l in linhas if l.get("precisa_revisao") == "sim"),
        "linhas_sem_rotulo": sum(1 for l in linhas if not l.get("avaliacao_humana", "").strip()),
    }
