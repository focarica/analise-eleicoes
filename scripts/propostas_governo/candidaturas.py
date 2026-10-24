"""Leitura e validação das candidaturas oficiais do TSE (consulta_cand)."""
from __future__ import annotations

import csv
import io
import zipfile
from dataclasses import dataclass, replace
from pathlib import Path, PurePosixPath

from . import config
from .modelos import Candidatura

# Nomes aceitos por campo canônico. Os três anos usam os mesmos nomes hoje;
# a lista de alternativas torna explícita qualquer divergência futura.
ALIASES: dict[str, tuple[str, ...]] = {
    "ano": ("ANO_ELEICAO",),
    "uf": ("SG_UF",),
    "cd_cargo": ("CD_CARGO",),
    "ds_cargo": ("DS_CARGO",),
    "sq": ("SQ_CANDIDATO",),
    "nome": ("NM_CANDIDATO",),
    "nome_urna": ("NM_URNA_CANDIDATO",),
    "numero": ("NR_CANDIDATO",),
    "partido": ("SG_PARTIDO",),
    "situacao": ("DS_SITUACAO_CANDIDATURA",),
    "turno": ("NR_TURNO",),
}
OBRIGATORIAS = ("ano", "uf", "cd_cargo", "ds_cargo", "sq", "nome", "partido", "situacao", "turno")


@dataclass(frozen=True)
class ArquivoCandidaturas:
    ano: int
    uf: str
    membro: str
    encoding: str
    candidaturas: dict[str, Candidatura]
    linhas_lidas: int
    linhas_outra_uf: int
    linhas_sem_sq: int

    def governadores(self) -> dict[str, Candidatura]:
        return {sq: c for sq, c in self.candidaturas.items() if c.ds_cargo.strip().upper() == config.CARGO}


def decodificar(conteudo: bytes) -> tuple[str, str]:
    """UTF-8 quando válido; caso contrário Latin-1, que é a codificação oficial dos CSVs."""
    try:
        return conteudo.decode("utf-8-sig"), "utf-8"
    except UnicodeDecodeError:
        return conteudo.decode("latin-1"), "latin-1"


def mapear_colunas(nomes: list[str]) -> dict[str, str]:
    presentes = {n.strip().upper(): n for n in nomes if n}
    mapa: dict[str, str] = {}
    faltando: list[str] = []
    for chave, opcoes in ALIASES.items():
        achado = next((presentes[o] for o in opcoes if o in presentes), None)
        if achado is not None:
            mapa[chave] = achado
        elif chave in OBRIGATORIAS:
            faltando.append(opcoes[0])
    if faltando:
        raise ValueError(f"colunas obrigatórias ausentes: {faltando}")
    return mapa


def _inteiro(valor: str | None) -> int | None:
    try:
        return int(str(valor).strip())
    except (TypeError, ValueError):
        return None


def validar_codigos_cargo(candidaturas: dict[str, Candidatura]) -> None:
    """Confere que CD_CARGO = 3 coincide exatamente com DS_CARGO = GOVERNADOR.

    O código não está documentado no leiame; a verificação garante que o filtro
    por nome e o código concordam nos dados lidos.
    """
    incoerentes = [
        c
        for c in candidaturas.values()
        if (c.ds_cargo.strip().upper() == config.CARGO) != (c.cd_cargo.strip() == config.CD_CARGO_GOVERNADOR)
    ]
    if incoerentes:
        exemplo = incoerentes[0]
        raise ValueError(
            f"código de cargo incoerente com DS_CARGO em {len(incoerentes)} candidatura(s), "
            f"ex.: SQ {exemplo.sq} CD_CARGO={exemplo.cd_cargo} DS_CARGO={exemplo.ds_cargo}"
        )


def ler_candidaturas(conteudo: bytes, *, ano: int, uf: str, membro: str = "") -> ArquivoCandidaturas:
    texto, encoding = decodificar(conteudo)
    leitor = csv.DictReader(io.StringIO(texto), delimiter=";", quotechar='"')
    mapa = mapear_colunas(leitor.fieldnames or [])

    def campo(linha: dict, chave: str) -> str:
        return (linha.get(mapa[chave]) or "").strip()

    candidaturas: dict[str, Candidatura] = {}
    lidas = outra_uf = sem_sq = 0
    for linha in leitor:
        lidas += 1
        if campo(linha, "ano") != str(ano):
            raise ValueError(f"linha de outro ano ({campo(linha, 'ano')!r}) em {membro or 'CSV'}")
        if campo(linha, "uf").upper() != uf:
            outra_uf += 1
            continue
        sq = campo(linha, "sq")
        if not sq:
            sem_sq += 1
            continue
        turno = _inteiro(campo(linha, "turno"))
        if sq in candidaturas:
            atual = candidaturas[sq]
            if turno is not None and turno not in atual.turnos:
                candidaturas[sq] = replace(atual, turnos=tuple(sorted(atual.turnos + (turno,))))
            continue
        candidaturas[sq] = Candidatura(
            ano=ano,
            uf=uf,
            sq=sq,
            nome=campo(linha, "nome"),
            nome_urna=campo(linha, "nome_urna") if "nome_urna" in mapa else "",
            numero=campo(linha, "numero") if "numero" in mapa else "",
            partido=campo(linha, "partido"),
            cd_cargo=campo(linha, "cd_cargo"),
            ds_cargo=campo(linha, "ds_cargo"),
            situacao=campo(linha, "situacao"),
            turnos=() if turno is None else (turno,),
        )

    validar_codigos_cargo(candidaturas)
    return ArquivoCandidaturas(
        ano=ano,
        uf=uf,
        membro=membro,
        encoding=encoding,
        candidaturas=candidaturas,
        linhas_lidas=lidas,
        linhas_outra_uf=outra_uf,
        linhas_sem_sq=sem_sq,
    )


def localizar_membro_uf(nomes: list[str], ano: int, uf: str) -> str:
    exato = f"consulta_cand_{ano}_{uf}.csv".lower()
    for nome in nomes:
        if PurePosixPath(nome).name.lower() == exato:
            return nome
    for nome in nomes:
        if PurePosixPath(nome).name.lower().endswith(f"_{uf.lower()}.csv"):
            return nome
    raise ValueError(f"CSV de {uf} não encontrado no ZIP de candidaturas de {ano}")


def ler_candidaturas_zip(zip_path: Path, *, ano: int, uf: str) -> ArquivoCandidaturas:
    with zipfile.ZipFile(zip_path) as zf:
        membro = localizar_membro_uf(zf.namelist(), ano, uf)
        conteudo = zf.read(membro)
    return ler_candidaturas(conteudo, ano=ano, uf=uf, membro=membro)
