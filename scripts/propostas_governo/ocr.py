"""OCR das páginas sem texto nativo, com Tesseract (idioma português).

Cada página é rasterizada com ``pdftoppm`` em ``DPI`` e reconhecida com
``tesseract``. O resultado usa a saída TSV para obter a confiança média por
página. Os arquivos de imagem são temporários e não são gravados no projeto.

O modelo ``por.traineddata`` é lido de ``config.TESSDATA_DIR`` quando existe.
Caso contrário, usa-se o diretório padrão do sistema.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

from . import config

DPI = 300
IDIOMA = "por"
PSM = "3"
TIMEOUT_PAGINA_S = 300


class FerramentaOcrAusente(RuntimeError):
    """``pdftoppm``, ``tesseract`` ou o idioma português não estão disponíveis."""


@dataclass(frozen=True)
class PaginaOcr:
    pagina: int
    texto: str
    confianca_media: float | None
    palavras: int
    erro: str


def _ambiente() -> dict:
    env = os.environ.copy()
    if (config.TESSDATA_DIR / f"{IDIOMA}.traineddata").exists():
        env["TESSDATA_PREFIX"] = str(config.TESSDATA_DIR)
    return env


def verificar() -> str:
    """Confere as ferramentas e o idioma. Retorna a versão do Tesseract."""
    for ferramenta in ("pdftoppm", "tesseract"):
        if shutil.which(ferramenta) is None:
            raise FerramentaOcrAusente(f"{ferramenta} não encontrado")
    env = _ambiente()
    proc = subprocess.run(["tesseract", "--list-langs"], capture_output=True, env=env, check=False)
    idiomas = proc.stdout.decode("utf-8", "replace").split()
    if IDIOMA not in idiomas:
        raise FerramentaOcrAusente(
            f"idioma '{IDIOMA}' não instalado. Coloque {IDIOMA}.traineddata em {config.TESSDATA_DIR}"
        )
    proc_v = subprocess.run(["tesseract", "--version"], capture_output=True, env=env, check=False)
    primeira = (proc_v.stdout or proc_v.stderr).decode("utf-8", "replace").splitlines()
    return primeira[0].strip() if primeira else "tesseract"


def versao_pipeline() -> str:
    return f"{IDIOMA}-dpi{DPI}-psm{PSM}"


def tsv_para_texto(tsv: str) -> tuple[str, float | None, int]:
    """Converte a saída TSV do Tesseract em texto por linha e confiança média.

    Só as palavras (nível 5) entram. Palavras vazias são descartadas.
    """
    grupos: dict[tuple[str, str, str], list[str]] = {}
    confiancas: list[float] = []
    for linha in tsv.splitlines()[1:]:
        colunas = linha.split("\t")
        if len(colunas) < 12 or colunas[0] != "5":
            continue
        palavra = colunas[11]
        if not palavra.strip():
            continue
        try:
            confianca = float(colunas[10])
        except ValueError:
            confianca = -1.0
        if confianca >= 0:
            confiancas.append(confianca)
        grupos.setdefault((colunas[2], colunas[3], colunas[4]), []).append(palavra)
    texto = "\n".join(" ".join(palavras) for palavras in grupos.values())
    media = sum(confiancas) / len(confiancas) if confiancas else None
    total = sum(len(p) for p in grupos.values())
    return texto, media, total


def ocr_pagina(pdf: Path, pagina: int, tmpdir: Path) -> PaginaOcr:
    """Rasteriza e reconhece uma página. Nunca altera o PDF."""
    prefixo = tmpdir / f"p{pagina:04d}"
    cmd_raster = ["pdftoppm", "-r", str(DPI), "-f", str(pagina), "-l", str(pagina), "-singlefile", "-png", str(pdf), str(prefixo)]
    try:
        raster = subprocess.run(cmd_raster, capture_output=True, timeout=TIMEOUT_PAGINA_S, check=False)
    except subprocess.TimeoutExpired:
        return PaginaOcr(pagina, "", None, 0, "tempo excedido na rasterização")
    imagem = prefixo.with_suffix(".png")
    if raster.returncode != 0 or not imagem.exists():
        erro = raster.stderr.decode("utf-8", "replace").strip().splitlines()
        return PaginaOcr(pagina, "", None, 0, erro[0] if erro else "falha na rasterização")

    cmd_ocr = ["tesseract", str(imagem), "stdout", "-l", IDIOMA, "--psm", PSM, "tsv"]
    try:
        proc = subprocess.run(cmd_ocr, capture_output=True, timeout=TIMEOUT_PAGINA_S, env=_ambiente(), check=False)
    except subprocess.TimeoutExpired:
        return PaginaOcr(pagina, "", None, 0, "tempo excedido no OCR")
    imagem.unlink(missing_ok=True)
    if proc.returncode != 0:
        erro = proc.stderr.decode("utf-8", "replace").strip().splitlines()
        return PaginaOcr(pagina, "", None, 0, erro[0] if erro else f"tesseract código {proc.returncode}")
    texto, media, palavras = tsv_para_texto(proc.stdout.decode("utf-8", "replace"))
    return PaginaOcr(pagina, texto, media, palavras, "")


def ocr_paginas(pdf: Path, paginas: list[int]) -> dict[int, PaginaOcr]:
    resultados: dict[int, PaginaOcr] = {}
    with tempfile.TemporaryDirectory(prefix="ocr_") as tmp:
        for n in paginas:
            resultados[n] = ocr_pagina(pdf, n, Path(tmp))
    return resultados
