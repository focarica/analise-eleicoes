"""Leitura do texto normalizado em blocos e parágrafos lógicos, com páginas e referências.

Formato de entrada (``texto_normalizado/*.txt``): blocos separados por linha em
branco; marcadores ``=== PÁGINA n ===``, ``[OCR]`` e ``[página sem texto nativo]``.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from ..normalizacao import is_item, is_titulo, termina_frase

MARCADOR_PAGINA = re.compile(r"^=== PÁGINA (\d+) ===$")
SEM_TEXTO = "[página sem texto nativo]"


@dataclass(frozen=True)
class Bloco:
    id: str
    pagina: int
    texto: str
    tipo: str  # titulo | item | paragrafo
    ocr: bool


@dataclass
class Paragrafo:
    """Um ou mais blocos contíguos que formam um mesmo parágrafo lógico."""

    id: str
    tipo: str
    ocr: bool
    blocos: list[Bloco] = field(default_factory=list)
    # Intervalos de cada bloco dentro de ``texto`` (ver ``texto`` abaixo).
    intervalos_blocos: list[tuple[int, int]] = field(default_factory=list)

    @property
    def texto(self) -> str:
        # Itens com sub-itens mantêm as quebras de linha; parágrafos usam espaço.
        separador = "\n" if self.tipo == "item" and len(self.blocos) > 1 else " "
        return separador.join(b.texto for b in self.blocos)

    @property
    def paginas(self) -> tuple[int, int]:
        return self.blocos[0].pagina, self.blocos[-1].pagina

    def blocos_no_intervalo(self, inicio: int, fim: int) -> list[Bloco]:
        return [b for b, (a, z) in zip(self.blocos, self.intervalos_blocos) if a < fim and z > inicio]


def ler_blocos(texto_normalizado: str) -> list[Bloco]:
    blocos: list[Bloco] = []
    pagina = 0
    ocr = False
    contador: dict[int, int] = {}
    for bruto in re.split(r"\n\s*\n", texto_normalizado):
        chunk = bruto.strip()
        if not chunk:
            continue
        m = MARCADOR_PAGINA.match(chunk)
        if m:
            pagina = int(m.group(1))
            ocr = False
            continue
        if chunk == "[OCR]":
            ocr = True
            continue
        if chunk == SEM_TEXTO:
            continue
        for trecho in _separar_itens(chunk):
            contador[pagina] = contador.get(pagina, 0) + 1
            if is_titulo(trecho):
                tipo = "titulo"
            elif is_item(trecho):
                tipo = "item"
            else:
                tipo = "paragrafo"
            blocos.append(Bloco(
                id=f"p{pagina:03d}-b{contador[pagina]:03d}",
                pagina=pagina,
                texto=re.sub(r" {2,}", " ", trecho),
                tipo=tipo,
                ocr=ocr,
            ))
    return blocos


def _separar_itens(chunk: str) -> list[str]:
    """Um bloco com itens em linhas separadas vira um bloco por item (e por linha sem item)."""
    linhas = [l.strip() for l in chunk.split("\n") if l.strip()]
    if len(linhas) <= 1 or not any(is_item(l) for l in linhas[1:]):
        return [chunk]
    partes: list[str] = []
    for linha in linhas:
        if is_item(linha) or not partes:
            partes.append(linha)
        else:
            partes[-1] = partes[-1] + " " + linha
    return partes


def juntar_subitens(blocos: list[Bloco]) -> list[Bloco]:
    """Itens que seguem um bloco terminado em ':' formam um só bloco com o pai.

    Ex.: "284. Apoiar ..., com ações como:" + "a) ..." + "b) ..." -> um bloco com quebras
    de linha entre os itens. O grupo termina no primeiro bloco que não é item.
    """
    saida: list[Bloco] = []
    aberto = False  # há um pai terminado em ':' com sub-itens em andamento
    for b in blocos:
        anterior = saida[-1] if saida else None
        mesma_pagina = anterior is not None and anterior.pagina == b.pagina and anterior.ocr == b.ocr
        if b.tipo == "item" and mesma_pagina and (aberto or anterior.texto.rstrip().endswith(":")):
            saida[-1] = Bloco(id=anterior.id, pagina=anterior.pagina, texto=f"{anterior.texto}\n{b.texto}",
                              tipo="item", ocr=anterior.ocr)
            aberto = True
            continue
        aberto = b.tipo == "item" and b.texto.rstrip().endswith(":")
        saida.append(b)
    return saida


SUBITEM = re.compile(r"^(?:[a-z]\)|[ivxlcdm]{1,6}\))\s", re.IGNORECASE)


def agrupar(blocos: list[Bloco], *, versao: str = "v1") -> list[Paragrafo]:
    """Une blocos que pertencem à mesma unidade.

    - Parágrafo: continua no bloco seguinte quando o anterior não termina em pontuação
      forte, ambos são parágrafos comuns e o seguinte começa em minúscula (atravessa páginas).
    - v1: parágrafo terminado em ":" é fundido com os itens seguintes num único bloco
      (comportamento original; perde as referências dos blocos internos).
    - v2: parágrafo terminado em ":" fica separado; sub-itens ``a)``, ``i)`` se unem ao
      item anterior, e cada bloco original permanece referenciado.
    """
    if versao not in ("v1", "v2"):
        raise ValueError(f"versão de segmentação desconhecida: {versao}")
    grupos: list[Paragrafo] = []
    if versao == "v1":
        blocos = juntar_subitens(blocos)
    for b in blocos:
        atual = grupos[-1] if grupos else None
        continua = (
            atual is not None
            and b.tipo == "paragrafo"
            and atual.tipo == "paragrafo"
            and atual.ocr == b.ocr
            and not termina_frase(atual.blocos[-1].texto)
            and b.texto[:1].islower()
        )
        subitem = (
            versao == "v2"
            and atual is not None
            and atual.tipo == "item"
            and b.tipo == "item"
            and atual.ocr == b.ocr
            and bool(SUBITEM.match(b.texto))
        )
        if continua or subitem:
            atual.blocos.append(b)
        else:
            grupos.append(Paragrafo(id=b.id, tipo=b.tipo, ocr=b.ocr, blocos=[b]))
    for g in grupos:
        pos = 0
        g.intervalos_blocos = []
        for i, b in enumerate(g.blocos):
            inicio = pos
            pos += len(b.texto)
            g.intervalos_blocos.append((inicio, pos))
            pos += 1  # espaço separador de ``texto``
    return grupos
