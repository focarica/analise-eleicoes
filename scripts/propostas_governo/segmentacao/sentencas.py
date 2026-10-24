"""Divisão de sentenças com cuidado para abreviações, iniciais e números.

Não remove nem altera caracteres: devolve intervalos ``(inicio, fim)`` sobre o
texto original.
"""
from __future__ import annotations

import re

ABREVIACOES = {
    "sr", "sra", "srs", "sras", "dr", "dra", "drs", "dras", "prof", "profa", "profs", "profas",
    "av", "art", "arts", "alin", "inc", "cf", "vs", "pág", "págs", "p", "pp", "cap", "nº", "nºs",
    "n", "nos", "fls", "tel", "hab", "aprox", "ltda", "jr", "sec", "gov", "min", "dep", "sen",
    "vol", "ed", "eng", "ref", "mun", "et", "al", "uf", "ibge", "pib", "apud", "obs", "bras",
    "mil", "milhões", "bilhões", "tri", "sem", "pl", "pls", "mp", "adi", "nr", "res",
}
_CANDIDATO = re.compile(r"[.!?…]+[\"”»)]?(?=\s)")
_PALAVRA_ANTERIOR = re.compile(r"([^\s]+)\s*$")
_INICIO = re.compile(r"[\"“«(\[—–-]*\s*(?P<c>\S)")


def _token_antes(texto: str, pos: int) -> str:
    m = _PALAVRA_ANTERIOR.search(texto[:pos])
    return m.group(1).strip("\"'“”«»()[]") if m else ""


def _inicia_sentenca(texto: str, pos: int) -> bool:
    """Após o espaço, a próxima sentença começa com maiúscula, dígito, aspas ou marcador."""
    m = _INICIO.match(texto, pos)
    if not m:
        return False
    c = m.group("c")
    return c.isupper() or c.isdigit() or c in "•●▪-–—\"“«(["


def _e_fim_real(texto: str, m: re.Match) -> bool:
    fim = m.end()
    pontuacao = m.group(0)
    token = _token_antes(texto, m.start()).lower().rstrip(".")
    if pontuacao.startswith(".") and len(pontuacao) == 1:
        if token in ABREVIACOES:
            return False
        if len(token) == 1 and token.isalpha():  # inicial de nome: "J. Silva"
            return False
    if not _inicia_sentenca(texto, fim):
        return False
    return True


def intervalos(texto: str) -> list[tuple[int, int]]:
    """Intervalos das sentenças, sem espaços nas bordas. Texto vazio -> lista vazia."""
    if not texto or not texto.strip():
        return []
    cortes: list[int] = []
    for m in _CANDIDATO.finditer(texto):
        if _e_fim_real(texto, m):
            cortes.append(m.end())
    intervalos_: list[tuple[int, int]] = []
    inicio = 0
    for corte in cortes + [len(texto)]:
        trecho = texto[inicio:corte]
        lstrip = len(trecho) - len(trecho.lstrip())
        rstrip = len(trecho.rstrip())
        if rstrip > lstrip:
            intervalos_.append((inicio + lstrip, inicio + rstrip))
        inicio = corte
    return intervalos_


def frases(texto: str) -> list[str]:
    return [texto[a:b] for a, b in intervalos(texto)]
