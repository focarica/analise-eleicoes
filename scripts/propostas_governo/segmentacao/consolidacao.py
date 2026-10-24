"""Segmentação de um documento: unidades candidatas, classificação, divisão e consolidação.

Regras de consolidação:
- ``SEM_PROPOSTA`` não gera proposta; o trecho vai para os descartados.
- ``MULTIPLAS_PROPOSTAS`` é dividida apenas nas partes indicadas pela classificação.
- Frase com conector de continuação ("Para isso", "Essa") e sem ação própria é
  anexada à proposta da frase anterior.
- ``INDETERMINADO`` gera proposta com ``precisa_revisao = sim``, sem divisão arbitrária.
- Cada proposta guarda blocos, páginas e frases de origem.
"""
from __future__ import annotations

import hashlib
from collections import Counter
from dataclasses import dataclass, field

from .documento import Paragrafo
from .regras import analisar
from .semantica import (
    CLASSES,
    INDETERMINADO,
    MULTIPLAS_PROPOSTAS,
    SEM_PROPOSTA,
    UMA_PROPOSTA,
    ClassificadorSemantico,
    Trecho,
)
from .sentencas import intervalos

STATUS_UMA = "UMA_PROPOSTA"
STATUS_DIVIDIDA = "DIVIDIDA_DE_MULTIPLAS"
STATUS_CONSOLIDADA = "CONSOLIDADA_DE_FRASES"
STATUS_INDETERMINADO = "INDETERMINADO"
# Versão 2: a unidade com verbos coordenados não é dividida automaticamente.
STATUS_MULTIPLAS_SUGERIDAS = "MULTIPLAS_SUGERIDAS"


@dataclass
class Unidade:
    texto: str
    inicio: int  # offset dentro de Paragrafo.texto
    fim: int
    tipo: str  # frase | item
    paragrafo: Paragrafo
    indice: int  # ordem da frase dentro do parágrafo
    numero: int  # ordem global no documento
    secao: str
    anterior: str

    @property
    def frase_id(self) -> str:
        return f"{self.paragrafo.id}-s{self.indice:02d}"


@dataclass
class Proposta:
    texto: str
    status: str
    precisa_revisao: bool
    justificativa: str
    confianca: float
    classificacao: str
    blocos_ids: list[str]
    frases_ids: list[str]
    paginas: tuple[int, int]
    paragrafo_id: str
    secao: str
    ocr: bool
    numeros_unidade: list[int] = field(default_factory=list)
    partes_sugeridas: tuple[str, ...] = ()


@dataclass
class Descartado:
    texto: str
    motivo: str
    justificativa: str
    blocos_ids: list[str]
    paginas: tuple[int, int]
    paragrafo_id: str
    secao: str


def unidades(paragrafos: list[Paragrafo]) -> list[Unidade]:
    """Unidades candidatas: cada item de lista é uma unidade; parágrafos viram frases."""
    saida: list[Unidade] = []
    secao = ""
    numero = 0
    anterior = ""
    for par in paragrafos:
        if par.tipo == "titulo":
            secao = par.texto
            continue
        if par.tipo == "item":
            numero += 1
            saida.append(Unidade(par.texto, 0, len(par.texto), "item", par, 0, numero, secao, anterior))
            anterior = par.texto
            continue
        for k, (a, b) in enumerate(intervalos(par.texto)):
            numero += 1
            saida.append(Unidade(par.texto[a:b], a, b, "frase", par, k, numero, secao, anterior))
            anterior = par.texto[a:b]
    return saida


def _blocos_e_paginas(par: Paragrafo, inicio: int, fim: int) -> tuple[list[str], tuple[int, int]]:
    blocos = par.blocos_no_intervalo(inicio, fim) or [par.blocos[0]]
    paginas = [b.pagina for b in blocos]
    return [b.id for b in blocos], (min(paginas), max(paginas))


def segmentar(
    paragrafos: list[Paragrafo],
    classificador: ClassificadorSemantico,
    *,
    versao: str = "v1",
) -> tuple[list[Proposta], list[Descartado], Counter]:
    """Gera propostas. ``versao="v1"`` divide verbos coordenados; ``"v2"`` apenas sugere a divisão."""
    if versao not in ("v1", "v2"):
        raise ValueError(f"versão de segmentação desconhecida: {versao}")
    propostas: list[Proposta] = []
    descartados: list[Descartado] = []
    contagem: Counter = Counter()

    # Títulos viram contexto de seção e vão para os descartados (não são propostas).
    secao = ""
    for par in paragrafos:
        if par.tipo == "titulo":
            contagem["titulos"] += 1
            secao = par.texto
            blocos_ids, paginas = _blocos_e_paginas(par, 0, len(par.texto))
            descartados.append(Descartado(par.texto, SEM_PROPOSTA, "título ou cabeçalho de seção",
                                          blocos_ids, paginas, par.id, secao))

    ultima_emitida_numero = -10  # número da última unidade que virou proposta
    for u in unidades(paragrafos):
        contagem["unidades"] += 1
        indicios = analisar(u.texto, tipo=u.tipo, anterior=u.anterior, versao=versao)
        veredito = classificador.classificar(
            Trecho(texto=u.texto, tipo=u.tipo, secao=u.secao, anterior=u.anterior, indicios=indicios)
        )
        assert veredito.classe in CLASSES, veredito.classe
        blocos, paginas = _blocos_e_paginas(u.paragrafo, u.inicio, u.fim)

        if veredito.classe == SEM_PROPOSTA:
            contagem["descartadas"] += 1
            descartados.append(Descartado(u.texto, SEM_PROPOSTA, veredito.justificativa, blocos, paginas,
                                          u.paragrafo.id, u.secao))
            continue

        if veredito.classe == MULTIPLAS_PROPOSTAS and versao == "v2":
            contagem["multiplas_sugeridas"] += 1
            partes = tuple(u.texto[a:b].strip() for a, b in veredito.partes if u.texto[a:b].strip())
            propostas.append(Proposta(
                texto=u.texto,
                status=STATUS_MULTIPLAS_SUGERIDAS,
                precisa_revisao=True,
                justificativa=f"{veredito.justificativa}; nova segmentação recomendada",
                confianca=veredito.confianca,
                classificacao=MULTIPLAS_PROPOSTAS,
                blocos_ids=blocos,
                frases_ids=[u.frase_id],
                paginas=paginas,
                paragrafo_id=u.paragrafo.id,
                secao=u.secao,
                ocr=u.paragrafo.ocr,
                numeros_unidade=[u.numero],
                partes_sugeridas=partes,
            ))
            ultima_emitida_numero = u.numero
            continue

        if veredito.classe == MULTIPLAS_PROPOSTAS and veredito.partes:
            contagem["divididas"] += 1
            for idx, (a, b) in enumerate(veredito.partes):
                trecho = u.texto[a:b].strip()
                if not trecho:
                    continue
                propostas.append(Proposta(
                    texto=trecho,
                    status=STATUS_DIVIDIDA,
                    precisa_revisao=False,
                    justificativa=f"{veredito.justificativa} (parte {idx + 1}/{len(veredito.partes)})",
                    confianca=veredito.confianca,
                    classificacao=MULTIPLAS_PROPOSTAS,
                    blocos_ids=blocos,
                    frases_ids=[f"{u.frase_id}-p{idx + 1}"],
                    paginas=paginas,
                    paragrafo_id=u.paragrafo.id,
                    secao=u.secao,
                    ocr=u.paragrafo.ocr,
                    numeros_unidade=[u.numero],
                ))
            ultima_emitida_numero = u.numero
            continue

        # UMA_PROPOSTA ou INDETERMINADO (inclui MULTIPLAS sem partes, tratada como ambígua).
        revisar = veredito.classe != UMA_PROPOSTA
        classe = INDETERMINADO if veredito.classe == MULTIPLAS_PROPOSTAS else veredito.classe

        continuacao = (
            indicios.conector
            and not indicios.acoes
            and propostas
            and ultima_emitida_numero == u.numero - 1
            and propostas[-1].secao == u.secao
        )
        if continuacao:
            contagem["consolidadas"] += 1
            anterior = propostas[-1]
            anterior.texto = f"{anterior.texto} {u.texto}"
            anterior.status = STATUS_CONSOLIDADA
            anterior.blocos_ids = list(dict.fromkeys(anterior.blocos_ids + blocos))
            anterior.frases_ids = anterior.frases_ids + [u.frase_id]
            anterior.paginas = (min(anterior.paginas[0], paginas[0]), max(anterior.paginas[1], paginas[1]))
            anterior.precisa_revisao = anterior.precisa_revisao or revisar
            anterior.justificativa = (anterior.justificativa + "; " if anterior.justificativa else "") + \
                "frase de continuação anexada à proposta anterior"
            anterior.numeros_unidade.append(u.numero)
            ultima_emitida_numero = u.numero
            continue

        if classe == UMA_PROPOSTA:
            contagem["uma"] += 1
            status = STATUS_UMA
        else:
            contagem["indeterminadas"] += 1
            status = STATUS_INDETERMINADO
        propostas.append(Proposta(
            texto=u.texto,
            status=status,
            precisa_revisao=revisar,
            justificativa="" if not revisar else veredito.justificativa,
            confianca=veredito.confianca,
            classificacao=classe,
            blocos_ids=blocos,
            frases_ids=[u.frase_id],
            paginas=paginas,
            paragrafo_id=u.paragrafo.id,
            secao=u.secao,
            ocr=u.paragrafo.ocr,
            numeros_unidade=[u.numero],
        ))
        ultima_emitida_numero = u.numero

    contagem["propostas"] = len(propostas)
    contagem["revisao"] = sum(1 for p in propostas if p.precisa_revisao)
    return propostas, descartados, contagem


def identificador(documento_id: str, p: Proposta) -> str:
    """Identificador estável: depende do documento, das frases de origem e do texto."""
    base = f"{documento_id}|{'|'.join(p.frases_ids)}|{p.texto}"
    return hashlib.sha1(base.encode("utf-8")).hexdigest()[:12]
