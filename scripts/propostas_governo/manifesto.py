"""Manifestos CSV por recorte e consolidado.

Cada PDF gera uma linha própria. Candidaturas de governador sem PDF também geram
uma linha (sem caminho local), para que a ausência fique registrada.
Separador ``;`` e UTF-8, como nos demais artefatos do repositório.
"""
from __future__ import annotations

import csv
from pathlib import Path

from .modelos import Associacao, ResultadoRecurso, caminho_relativo

COLUNAS_MANIFESTO = (
    "ano_eleicao",
    "uf",
    "cargo",
    "sq_candidato",
    "nome_candidato",
    "nome_urna",
    "partido",
    "situacao_candidatura",
    "url_recurso_tse",
    "url_arquivo_original",
    "zip_origem",
    "caminho_interno_zip",
    "nome_arquivo_original",
    "caminho_local",
    "formato_declarado",
    "formato_detectado",
    "tipo_documento",
    "tamanho_bytes",
    "sha256",
    "duplicado_de",
    "status_download",
    "status_extracao",
    "busca_conclusiva",
    "status_associacao",
    "motivo_pendente",
    "sq_no_nome_arquivo",
    "data_coleta",
)


def linha_manifesto(
    a: Associacao,
    recurso: ResultadoRecurso,
    *,
    raiz: Path,
    data_coleta: str,
) -> dict:
    c = a.candidatura
    d = a.documento
    return {
        "ano_eleicao": a.ano,
        "uf": a.uf,
        "cargo": c.ds_cargo if c else "",
        "sq_candidato": c.sq if c else "",
        "nome_candidato": c.nome if c else "",
        "nome_urna": c.nome_urna if c else "",
        "partido": c.partido if c else "",
        "situacao_candidatura": c.situacao if c else "",
        "url_recurso_tse": recurso.url_recurso,
        "url_arquivo_original": recurso.url_arquivo,
        "zip_origem": recurso.caminho_local,
        "caminho_interno_zip": d.caminho_interno_zip if d else "",
        "nome_arquivo_original": d.nome_original if d else "",
        "caminho_local": (caminho_relativo(Path(d.caminho_local), raiz) if d and d.caminho_local else ""),
        "formato_declarado": recurso.formato_declarado,
        "formato_detectado": d.formato_detectado if d else recurso.formato_detectado,
        "tipo_documento": a.tipo_documento,
        "tamanho_bytes": d.tamanho_bytes if d else "",
        "sha256": d.sha256 if d else "",
        "duplicado_de": a.duplicado_de,
        "status_download": recurso.status_download,
        "status_extracao": d.status_extracao if d else "",
        "busca_conclusiva": "sim" if a.busca_conclusiva else "nao",
        "status_associacao": a.status_associacao,
        "motivo_pendente": a.motivo,
        "sq_no_nome_arquivo": a.sq_no_nome,
        "data_coleta": data_coleta,
    }


def escrever_csv(caminho: Path, linhas: list[dict], colunas: tuple[str, ...]) -> None:
    caminho.parent.mkdir(parents=True, exist_ok=True)
    tmp = caminho.with_name(caminho.name + ".tmp")
    with open(tmp, "w", newline="", encoding="utf-8") as fh:
        escritor = csv.DictWriter(fh, fieldnames=colunas, delimiter=";", extrasaction="raise")
        escritor.writeheader()
        escritor.writerows(linhas)
    tmp.replace(caminho)


def ler_csv(caminho: Path) -> list[dict]:
    with open(caminho, newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh, delimiter=";"))
