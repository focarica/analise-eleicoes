"""Descoberta dos recursos oficiais de candidaturas e propostas no portal do TSE.

A fonte primária é a API CKAN. Quando algum recurso não aparece nela, a página
oficial do conjunto de dados é usada como alternativa.
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from pathlib import PurePosixPath
from urllib.parse import unquote, urljoin, urlparse

from . import config
from .download import ErroDownload, obter_bytes

log = logging.getLogger(__name__)


@dataclass
class RecursosAno:
    ano: int
    url_candidaturas: str | None = None
    urls_propostas: dict[str, str] = field(default_factory=dict)
    formatos_propostas: dict[str, str] = field(default_factory=dict)
    fonte: dict[str, str] = field(default_factory=dict)
    json_ckan: dict | None = None

    def ausentes(self, ufs: tuple[str, ...] | list[str]) -> list[str]:
        falta = [uf for uf in ufs if uf not in self.urls_propostas]
        if self.url_candidaturas is None:
            falta.insert(0, "candidaturas")
        return falta


def nome_da_url(url: str) -> str:
    return unquote(PurePosixPath(urlparse(url).path).name)


def nome_candidaturas(ano: int) -> str:
    return f"consulta_cand_{ano}.zip"


def nome_proposta(ano: int, uf: str) -> str:
    return f"proposta_governo_{ano}_{uf}.zip"


def _aplicar(rec: RecursosAno, recursos: list[tuple[str, str]], fonte: str, ufs) -> None:
    """Recursos: lista de (url, formato_declarado). Preenche apenas o que ainda falta."""
    for url, formato in recursos:
        url = url.strip()
        if not url:
            continue
        base = nome_da_url(url).lower()
        if rec.url_candidaturas is None and base == nome_candidaturas(rec.ano).lower():
            rec.url_candidaturas = url
            rec.fonte["candidaturas"] = fonte
        for uf in ufs:
            if uf in rec.urls_propostas:
                continue
            if base == nome_proposta(rec.ano, uf).lower():
                rec.urls_propostas[uf] = url
                rec.formatos_propostas[uf] = formato or "desconhecido"
                rec.fonte[uf] = fonte


def descobrir(ano: int, ufs, *, usar_pagina: bool = True) -> RecursosAno:
    rec = RecursosAno(ano=ano)
    try:
        pacote = json.loads(obter_bytes(config.CKAN_PACKAGE_SHOW.format(ano=ano)))
        if not pacote.get("success"):
            raise ValueError("resposta CKAN sem success=true")
        rec.json_ckan = pacote
        recursos = [(r.get("url", ""), r.get("format", "")) for r in pacote["result"]["resources"]]
        _aplicar(rec, recursos, "ckan", ufs)
    except (ErroDownload, ValueError, KeyError, TypeError) as exc:
        log.warning("API CKAN indisponível ou inesperada para %s: %s", ano, exc)

    if rec.ausentes(ufs) and usar_pagina:
        pagina = config.PAGINA_CONJUNTO.format(ano=ano)
        try:
            html = obter_bytes(pagina).decode("utf-8", "replace")
        except ErroDownload as exc:
            log.warning("página do conjunto %s indisponível: %s", ano, exc)
        else:
            links = [urljoin(pagina, h) for h in re.findall(r"""href=["']([^"']+\.zip)["']""", html)]
            _aplicar(rec, [(u, "") for u in links], "pagina", ufs)

    return rec
