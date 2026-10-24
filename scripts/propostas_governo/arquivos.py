"""Detecção de formato, nomes seguros e extração restrita de PDFs de ZIPs."""
from __future__ import annotations

import hashlib
import os
import re
import stat
import unicodedata
import zipfile
import zlib
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from . import config


class ErroExtracao(RuntimeError):
    """O ZIP não pode ser lido ou excede os limites de segurança."""


def detectar_formato(caminho: Path) -> str:
    """Identifica o conteúdo real pelo cabeçalho, sem confiar na extensão ou no CKAN."""
    with open(caminho, "rb") as fh:
        cabecalho = fh.read(8)
    if cabecalho.startswith(b"%PDF-"):
        return "PDF"
    if cabecalho.startswith((b"PK\x03\x04", b"PK\x05\x06")):
        return "ZIP"
    if cabecalho.startswith((b"\x7fELF", b"MZ")):
        return "EXECUTAVEL"
    return "OUTRO"


def e_pdf(caminho: Path) -> bool:
    return detectar_formato(caminho) == "PDF"


def e_zip(caminho: Path) -> bool:
    return detectar_formato(caminho) == "ZIP" and zipfile.is_zipfile(caminho)


def e_zip_ou_pdf(caminho: Path) -> bool:
    return e_zip(caminho) or e_pdf(caminho)


def nome_seguro(nome: str, limite: int = 100) -> str:
    """Converte um nome em ASCII seguro, preservando a extensão."""
    base = unicodedata.normalize("NFKD", nome).encode("ascii", "ignore").decode("ascii")
    base = re.sub(r"[^A-Za-z0-9._-]+", "_", base).strip("._") or "arquivo"
    if len(base) > limite:
        stem, ext = os.path.splitext(base)
        base = stem[: limite - len(ext)] + ext
    return base


def motivo_rejeicao_membro(info: zipfile.ZipInfo) -> str | None:
    """Retorna o motivo para não processar um membro do ZIP, ou None se ele é aceitável."""
    nome = info.filename
    if "\\" in nome or nome.startswith("/") or re.match(r"^[A-Za-z]:", nome):
        return "caminho absoluto ou com separador inválido"
    if ".." in nome.split("/"):
        return "tentativa de path traversal"
    if info.flag_bits & 0x1:
        return "membro criptografado"
    modo = (info.external_attr >> 16) & 0o170000
    if modo == stat.S_IFLNK:
        return "link simbólico"
    if modo not in (0, stat.S_IFREG, stat.S_IFDIR):
        return "tipo de entrada especial"
    if info.file_size > config.MAX_TAMANHO_MEMBRO_BYTES:
        return "tamanho descompactado acima do limite"
    if info.compress_size and info.file_size / info.compress_size > config.MAX_RAZAO_COMPRESSAO:
        return "razão de compressão suspeita"
    return None


@dataclass(frozen=True)
class ItemZip:
    nome_original: str
    caminho_interno: str
    status: str  # EXTRAIDO | INVALIDO | REJEITADO
    motivo: str
    caminho_local: Path | None
    tamanho_bytes: int
    sha256: str


@dataclass(frozen=True)
class ResumoZip:
    itens: list[ItemZip]
    membros_nao_pdf: int


def _extrair_membro(zf: zipfile.ZipFile, info: zipfile.ZipInfo, destino: Path, prefixo: str) -> ItemZip:
    nome = PurePosixPath(info.filename).name
    tmp = destino / f".{prefixo}.tmp"
    h = hashlib.sha256()
    tamanho = 0
    try:
        with zf.open(info) as origem, open(tmp, "wb") as alvo:
            for bloco in iter(lambda: origem.read(1024 * 1024), b""):
                alvo.write(bloco)
                h.update(bloco)
                tamanho += len(bloco)
    except (zipfile.BadZipFile, NotImplementedError, RuntimeError, zlib.error) as exc:
        tmp.unlink(missing_ok=True)
        return ItemZip(nome, info.filename, "REJEITADO", f"membro ilegível: {exc}", None, 0, "")

    digest = h.hexdigest()
    with open(tmp, "rb") as fh:
        cabecalho = fh.read(5)
    if not cabecalho.startswith(b"%PDF-"):
        tmp.unlink(missing_ok=True)
        return ItemZip(nome, info.filename, "INVALIDO", "conteúdo não começa com %PDF-", None, tamanho, digest)

    final = destino / f"{prefixo}_{digest[:12]}_{nome_seguro(nome)}"
    if final.exists():
        tmp.unlink(missing_ok=True)
    else:
        os.replace(tmp, final)
    return ItemZip(nome, info.filename, "EXTRAIDO", "", final, tamanho, digest)


def extrair_pdfs(zip_path: Path, destino: Path, *, prefixo: str) -> ResumoZip:
    """Extrai apenas membros ``.pdf`` de ``zip_path`` para ``destino``.

    O nome gravado é gerado pelo coletor (prefixo + hash + nome sanitizado); o nome
    interno do ZIP nunca é usado como caminho. Os originais não são alterados.
    """
    destino.mkdir(parents=True, exist_ok=True)
    itens: list[ItemZip] = []
    nao_pdf = 0
    total = 0
    try:
        zf = zipfile.ZipFile(zip_path)
    except zipfile.BadZipFile as exc:
        raise ErroExtracao(f"ZIP inválido: {zip_path.name}") from exc
    with zf:
        for info in zf.infolist():
            if info.is_dir():
                continue
            motivo = motivo_rejeicao_membro(info)
            if motivo:
                itens.append(
                    ItemZip(PurePosixPath(info.filename).name, info.filename, "REJEITADO", motivo, None, 0, "")
                )
                continue
            if not info.filename.lower().endswith(".pdf"):
                nao_pdf += 1
                continue
            total += info.file_size
            if total > config.MAX_TAMANHO_DESCOMPACTADO_BYTES:
                raise ErroExtracao("total descompactado acima do limite de segurança")
            itens.append(_extrair_membro(zf, info, destino, prefixo))
    return ResumoZip(itens=itens, membros_nao_pdf=nao_pdf)
