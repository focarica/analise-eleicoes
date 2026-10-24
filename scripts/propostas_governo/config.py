"""Parâmetros do coletor de propostas de governo do TSE.

Anos, UFs e cargo ficam centralizados aqui. Os caminhos são relativos à raiz
do repositório, em ``data/``, que não é versionado.
"""
from __future__ import annotations

from pathlib import Path

ANOS: tuple[int, ...] = (2014, 2018, 2022)
UFS: tuple[str, ...] = ("SP", "BA")
CARGO = "GOVERNADOR"
CD_CARGO_GOVERNADOR = "3"

CKAN_BASE = "https://dadosabertos.tse.jus.br"
CKAN_PACKAGE_SHOW = CKAN_BASE + "/api/3/action/package_show?id=candidatos-{ano}"
PAGINA_CONJUNTO = CKAN_BASE + "/dataset/candidatos-{ano}"

RAIZ_REPO = Path(__file__).resolve().parents[2]
DIR_DADOS_PADRAO = RAIZ_REPO / "data"
TESSDATA_DIR = DIR_DADOS_PADRAO / "tessdata"

USER_AGENT = "analise-eleicoes-coletor-propostas/1.0"
TIMEOUT_S = 120.0
TENTATIVAS = 3
PAUSA_RETENTATIVA_S = 2.0
PAUSA_ENTRE_DOWNLOADS_S = 1.0

MAX_TAMANHO_MEMBRO_BYTES = 200 * 1024 * 1024
MAX_TAMANHO_DESCOMPACTADO_BYTES = 2 * 1024**3
MAX_RAZAO_COMPRESSAO = 100
