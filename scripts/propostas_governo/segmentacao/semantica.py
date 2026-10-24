"""Camada semântica: classifica trechos candidatos.

A interface ``ClassificadorSemantico`` desacopla o pipeline do mecanismo de
classificação. ``HeuristicaLocal`` é a implementação padrão, sem dependências
externas. Um modelo de linguagem pode ser integrado depois implementando a
mesma interface, sem alterar a segmentação determinística.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from .regras import Indicios

UMA_PROPOSTA = "UMA_PROPOSTA"
MULTIPLAS_PROPOSTAS = "MULTIPLAS_PROPOSTAS"
SEM_PROPOSTA = "SEM_PROPOSTA"
INDETERMINADO = "INDETERMINADO"
CLASSES = (UMA_PROPOSTA, MULTIPLAS_PROPOSTAS, SEM_PROPOSTA, INDETERMINADO)


@dataclass(frozen=True)
class Trecho:
    texto: str
    tipo: str  # frase | item | titulo
    secao: str
    anterior: str
    indicios: Indicios


@dataclass(frozen=True)
class Veredito:
    classe: str
    confianca: float
    justificativa: str
    # Para MULTIPLAS_PROPOSTAS: intervalos das partes dentro de ``Trecho.texto``.
    partes: tuple[tuple[int, int], ...] = ()


class ClassificadorSemantico(Protocol):
    nome: str
    versao: str

    def classificar(self, trecho: Trecho) -> Veredito: ...


class HeuristicaLocal:
    """Decisões por indícios: verbos de ação, compromisso, contexto diagnóstico e objetos coordenados."""

    nome = "heuristica_local"
    versao = "v1"

    def classificar(self, trecho: Trecho) -> Veredito:
        i = trecho.indicios
        if trecho.tipo == "titulo":
            return Veredito(SEM_PROPOSTA, 0.95, "título ou cabeçalho de seção")
        if i.fragmento:
            return Veredito(SEM_PROPOSTA, 0.8, "fragmento sem conteúdo proposicional (possível extração defeituosa)")

        if i.partes_coordenadas and i.acoes:
            return Veredito(
                MULTIPLAS_PROPOSTAS,
                0.8,
                "dois verbos de ação independentes coordenados com objetos próprios",
                partes=i.partes_coordenadas,
            )

        if i.futuro_verbal and not i.acoes and i.contexto == 0:
            return Veredito(UMA_PROPOSTA, 0.7, "ação no futuro verbal (intenção de execução)")

        if i.acoes:
            if i.objeto_coordenado and i.gerundio:
                return Veredito(
                    INDETERMINADO,
                    0.5,
                    "objeto coordenado seguido de oração reduzida; pode ser um compromisso geral",
                )
            if i.contexto >= 2 and not i.compromisso:
                return Veredito(
                    INDETERMINADO,
                    0.5,
                    "ação identificada, mas com forte contexto diagnóstico",
                )
            return Veredito(
                UMA_PROPOSTA,
                0.85 if i.compromisso else 0.75,
                "verbo de ação com objeto identificado" + (" e marcador de compromisso" if i.compromisso else ""),
            )

        if i.voz_passiva_futura or i.substantivo_de_acao:
            if i.contexto >= 1 or i.valor:
                return Veredito(INDETERMINADO, 0.4, "ação sugerida (construção passiva ou substantivo de ação) com contexto diagnóstico")
            return Veredito(UMA_PROPOSTA, 0.6, "ação expressa por construção passiva futura ou substantivo de ação")

        if i.cabecalho and not i.prescritivo:
            return Veredito(SEM_PROPOSTA, 0.7, "rótulo curto de seção ou de lista")
        if i.contexto >= 1 or i.valor:
            return Veredito(SEM_PROPOSTA, 0.7, "descrição, diagnóstico ou valores sem ação identificável")
        if i.prescritivo:
            return Veredito(INDETERMINADO, 0.4, "indício de intenção ou prescrição sem ação identificada; requer revisão")
        return Veredito(SEM_PROPOSTA, 0.5, "descrição sem indício de ação, compromisso ou intenção")
