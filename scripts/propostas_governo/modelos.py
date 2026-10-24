"""Estruturas de dados compartilhadas entre os módulos do coletor."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Candidatura:
    """Candidatura oficial do TSE (uma por SQ_CANDIDATO e UF)."""

    ano: int
    uf: str
    sq: str
    nome: str
    nome_urna: str
    numero: str
    partido: str
    cd_cargo: str
    ds_cargo: str
    situacao: str
    turnos: tuple[int, ...] = ()


@dataclass(frozen=True)
class Documento:
    """Arquivo PDF encontrado em um recurso de propostas."""

    ano: int
    uf: str
    nome_original: str
    caminho_interno_zip: str
    url_arquivo: str
    formato_declarado: str
    formato_detectado: str
    status_extracao: str  # EXTRAIDO | INVALIDO | REJEITADO
    motivo_extracao: str
    caminho_local: str
    tamanho_bytes: int
    sha256: str


@dataclass(frozen=True)
class ResultadoRecurso:
    """Situação do download de um recurso (ZIP de propostas ou de candidaturas)."""

    status_download: str  # BAIXADO | JA_EXISTIA | FALHA | NAO_LOCALIZADO
    url_recurso: str = ""
    url_arquivo: str = ""
    formato_declarado: str = ""
    formato_detectado: str = ""
    caminho_local: str = ""
    sha256: str = ""
    tamanho_bytes: int = 0
    erro: str = ""


@dataclass
class Associacao:
    """Resultado da associação de um documento (ou da ausência dele) a uma candidatura."""

    ano: int
    uf: str
    status_associacao: str
    motivo: str
    tipo_documento: str
    documento: Documento | None = None
    candidatura: Candidatura | None = None
    sq_no_nome: str = ""
    duplicado_de: str = ""
    busca_conclusiva: bool = True


def caminho_relativo(caminho: Path, raiz: Path) -> str:
    """Retorna o caminho relativo à raiz do repositório, quando possível."""
    try:
        return str(caminho.resolve().relative_to(raiz.resolve()))
    except ValueError:
        return str(caminho)
