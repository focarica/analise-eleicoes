"""Downloads HTTP com retentativas, retomada e validação do conteúdo recebido."""
from __future__ import annotations

import hashlib
import logging
import os
import shutil
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from . import config

log = logging.getLogger(__name__)

Validador = Callable[[Path], bool]


class ErroDownload(RuntimeError):
    """Falha definitiva ou tentativas esgotadas."""


class _Transitorio(Exception):
    """Falha que justifica nova tentativa."""


@dataclass(frozen=True)
class ResultadoDownload:
    caminho: Path
    url_final: str
    tamanho_bytes: int
    sha256: str
    baixado_agora: bool


def sha256_arquivo(caminho: Path) -> str:
    h = hashlib.sha256()
    with open(caminho, "rb") as fh:
        for bloco in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(bloco)
    return h.hexdigest()


def _codigo_transitorio(codigo: int) -> bool:
    return codigo in (408, 425, 429) or codigo >= 500


def _requisitar(url: str, cabecalhos: dict, timeout: float):
    req = urllib.request.Request(
        url, headers={"User-Agent": config.USER_AGENT, **cabecalhos}
    )
    return urllib.request.urlopen(req, timeout=timeout)


def obter_bytes(
    url: str,
    *,
    tentativas: int = config.TENTATIVAS,
    timeout: float = config.TIMEOUT_S,
    pausa: float = config.PAUSA_RETENTATIVA_S,
) -> bytes:
    """Obtém o conteúdo de uma URL pequena (JSON ou HTML) com retentativas."""
    ultimo = "erro desconhecido"
    for n in range(1, tentativas + 1):
        try:
            with _requisitar(url, {}, timeout) as resp:
                return resp.read()
        except urllib.error.HTTPError as exc:
            exc.close()
            if not _codigo_transitorio(exc.code):
                raise ErroDownload(f"HTTP {exc.code} em {url}") from exc
            ultimo = f"HTTP {exc.code}"
        except (urllib.error.URLError, OSError) as exc:
            ultimo = str(exc)
        if n < tentativas:
            log.warning("tentativa %d/%d falhou (%s); nova tentativa", n, tentativas, ultimo)
            time.sleep(pausa * 2 ** (n - 1))
    raise ErroDownload(f"{ultimo} após {tentativas} tentativas em {url}")


def _baixar_uma_vez(url: str, parcial: Path, timeout: float) -> str:
    """Grava a resposta em ``parcial``, retomando se já houver bytes. Retorna a URL final."""
    inicio = parcial.stat().st_size if parcial.exists() else 0
    cabecalhos = {"Range": f"bytes={inicio}-"} if inicio else {}
    try:
        resp = _requisitar(url, cabecalhos, timeout)
    except urllib.error.HTTPError as exc:
        exc.close()
        if exc.code == 416 and inicio:
            parcial.unlink(missing_ok=True)
            raise _Transitorio("intervalo de retomada recusado; reiniciando") from exc
        if _codigo_transitorio(exc.code):
            raise _Transitorio(f"HTTP {exc.code}") from exc
        raise ErroDownload(f"HTTP {exc.code} em {url}") from exc
    except (urllib.error.URLError, OSError) as exc:
        raise _Transitorio(str(exc)) from exc

    with resp:
        retomado = inicio > 0 and getattr(resp, "status", 200) == 206
        anunciado = resp.headers.get("Content-Length")
        modo = "ab" if retomado else "wb"
        try:
            with open(parcial, modo) as fh:
                shutil.copyfileobj(resp, fh, 1024 * 1024)
        except OSError as exc:
            raise _Transitorio(f"interrupção durante a transferência: {exc}") from exc
        if anunciado is not None:
            esperado = int(anunciado) + (inicio if retomado else 0)
            obtido = parcial.stat().st_size
            if obtido != esperado:
                raise _Transitorio(f"transferência incompleta: {obtido} de {esperado} bytes")
        return resp.geturl()


def baixar_arquivo(
    url: str,
    destino: Path,
    *,
    validador: Validador,
    forcar: bool = False,
    tentativas: int = config.TENTATIVAS,
    timeout: float = config.TIMEOUT_S,
    pausa: float = config.PAUSA_RETENTATIVA_S,
) -> ResultadoDownload:
    """Baixa ``url`` para ``destino``. Não baixa de novo se o arquivo já é válido.

    A escrita passa por ``<destino>.part`` e só é renomeada após validação, para
    que uma interrupção nunca deixe um arquivo final incompleto.
    """
    destino.parent.mkdir(parents=True, exist_ok=True)
    if destino.exists() and not forcar and validador(destino):
        return ResultadoDownload(destino, url, destino.stat().st_size, sha256_arquivo(destino), False)

    parcial = destino.with_name(destino.name + ".part")
    if forcar:
        parcial.unlink(missing_ok=True)

    ultimo = "erro desconhecido"
    for n in range(1, tentativas + 1):
        try:
            url_final = _baixar_uma_vez(url, parcial, timeout)
            if not validador(parcial):
                parcial.unlink(missing_ok=True)
                raise _Transitorio("conteúdo recebido não corresponde ao formato esperado")
            os.replace(parcial, destino)
            return ResultadoDownload(
                destino, url_final, destino.stat().st_size, sha256_arquivo(destino), True
            )
        except _Transitorio as exc:
            ultimo = str(exc)
            log.warning("tentativa %d/%d falhou para %s: %s", n, tentativas, url, exc)
        if n < tentativas:
            time.sleep(pausa * 2 ** (n - 1))
    raise ErroDownload(f"{ultimo} após {tentativas} tentativas em {url}")
