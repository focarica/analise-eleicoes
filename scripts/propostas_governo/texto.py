"""Extração do texto nativo dos PDFs com ``pdftotext`` (Poppler).

Não altera os PDFs. Cada PDF gera um ``.txt`` com marcadores de página, e um
registro em ``texto/extracao.csv`` com contagens e status. A classificação
não segmenta nem interpreta o conteúdo.

Status:
- ``OK``: todas as páginas têm texto nativo.
- ``PARCIAL_SEM_TEXTO``: parte das páginas não tem texto nativo (capas, imagens).
  Essas páginas podem exigir OCR.
- ``SEM_TEXTO``: nenhuma página tem texto nativo. Exige OCR.
- ``ERRO``: ``pdftotext`` falhou (por exemplo, PDF protegido ou corrompido).
"""
from __future__ import annotations

import hashlib
import shutil
import subprocess
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

# Abaixo disso, a página é tratada como sem texto nativo (capa ou imagem).
MIN_CARACTERES_POR_PAGINA = 30
TIMEOUT_S = 600

STATUS_OK = "OK"
STATUS_PARCIAL = "PARCIAL_SEM_TEXTO"
STATUS_SEM_TEXTO = "SEM_TEXTO"
STATUS_ERRO = "ERRO"

COLUNAS_EXTRACAO = (
    "ano_eleicao",
    "uf",
    "sq_candidato",
    "nome_candidato",
    "tipo_documento",
    "pdf_local",
    "sha256_pdf",
    "status_texto",
    "paginas",
    "paginas_sem_texto",
    "caracteres",
    "txt_local",
    "sha256_txt",
    "avisos_pdftotext",
    "erro",
    "ocr_status",
    "ocr_versao",
    "paginas_ocr",
    "paginas_ocr_com_texto",
    "paginas_ocr_vazias",
    "caracteres_ocr",
    "confianca_ocr_media",
    "status_final",
    "data_extracao",
)


class FerramentaAusente(RuntimeError):
    """``pdftotext`` não está instalado."""


@dataclass(frozen=True)
class ResultadoTexto:
    status: str
    paginas: int
    paginas_sem_texto: tuple[int, ...]
    caracteres: int
    texto: str
    avisos: int
    erro: str
    paginas_texto: tuple[str, ...] = ()


def verificar_ferramenta() -> str:
    caminho = shutil.which("pdftotext")
    if caminho is None:
        raise FerramentaAusente(
            "pdftotext não encontrado. Instale o Poppler (pacote poppler-utils ou poppler)."
        )
    return caminho


def _paginas(bruto: str) -> list[str]:
    paginas = bruto.split("\f")
    if paginas and paginas[-1].strip() == "":
        paginas = paginas[:-1]
    return paginas


def montar_texto(paginas: list[str], ocr: dict[int, str] | None = None) -> str:
    """Concatena as páginas com marcadores ``=== PÁGINA n ===``. Não remove conteúdo.

    Página sem texto nativo recebe o texto do OCR, quando houver, marcado com ``[OCR]``.
    """
    ocr = ocr or {}
    partes = []
    for n, pagina in enumerate(paginas, start=1):
        corpo = pagina.strip()
        reconhecido = ocr.get(n, "").strip()
        if reconhecido:
            # Texto nativo curto (ex.: título em fonte especial) vem antes; o OCR é anexado.
            blocos = [corpo] if corpo else []
            blocos.append("[OCR]\n" + reconhecido)
            bloco = "\n".join(blocos)
        elif corpo:
            bloco = corpo
        else:
            bloco = "[página sem texto nativo]"
        partes.append(f"=== PÁGINA {n} ===\n{bloco}\n")
    return "\n".join(partes)


def classificar(paginas: list[str], avisos: int) -> ResultadoTexto:
    sem = tuple(
        n for n, p in enumerate(paginas, start=1) if len(p.strip()) < MIN_CARACTERES_POR_PAGINA
    )
    caracteres = sum(len(p.strip()) for p in paginas)
    if not paginas or len(sem) == len(paginas):
        status = STATUS_SEM_TEXTO
    elif sem:
        status = STATUS_PARCIAL
    else:
        status = STATUS_OK
    return ResultadoTexto(
        status=status,
        paginas=len(paginas),
        paginas_sem_texto=sem,
        caracteres=caracteres,
        texto=montar_texto(paginas),
        avisos=avisos,
        erro="",
        paginas_texto=tuple(paginas),
    )


def extrair(pdf: Path, executavel: str | None = None) -> ResultadoTexto:
    """Extrai o texto nativo de ``pdf``. Nunca modifica o arquivo."""
    cmd = [executavel or verificar_ferramenta(), "-enc", "UTF-8", str(pdf), "-"]
    try:
        proc = subprocess.run(cmd, capture_output=True, timeout=TIMEOUT_S, check=False)
    except subprocess.TimeoutExpired:
        return ResultadoTexto(STATUS_ERRO, 0, (), 0, "", 0, f"tempo excedido ({TIMEOUT_S}s)")

    erros_stderr = proc.stderr.decode("utf-8", "replace")
    avisos = sum(1 for linha in erros_stderr.splitlines() if linha.strip())
    if proc.returncode != 0:
        primeira = next((l for l in erros_stderr.splitlines() if l.strip()), f"código {proc.returncode}")
        return ResultadoTexto(STATUS_ERRO, 0, (), 0, "", avisos, primeira.strip())

    bruto = proc.stdout.decode("utf-8", "replace")
    return classificar(_paginas(bruto), avisos)


def sha256_arquivo(caminho: Path) -> str:
    h = hashlib.sha256()
    with open(caminho, "rb") as fh:
        for bloco in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(bloco)
    return h.hexdigest()


def agora() -> str:
    return datetime.now().isoformat(timespec="seconds")
