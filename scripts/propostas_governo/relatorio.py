"""Relatório de cobertura por ano e UF."""
from __future__ import annotations

from dataclasses import dataclass, asdict
from pathlib import Path

from .associacao import (
    ESTADO_EXATO,
    ESTADO_NAO_ASSOCIADO,
    ESTADO_OUTRO_CARGO,
    ESTADO_PENDENTE,
    ESTADO_SEM_DOCUMENTO,
    TIPO_LEIAME,
)
from .modelos import Associacao, ResultadoRecurso
from .manifesto import escrever_csv


@dataclass
class LinhaRelatorio:
    ano: int
    uf: str
    candidaturas_governador: int = 0
    recurso_proposta_localizado: str = "nao"
    status_download_proposta: str = ""
    pdfs_encontrados: int = 0
    pdfs_extraidos: int = 0
    pdfs_leiame: int = 0
    candidaturas_com_pdf_associado: int = 0
    associacoes_pendentes: int = 0
    sem_documento_conclusivo: int = 0
    sem_documento_nao_conclusivo: int = 0
    falhas_download: int = 0
    extracoes_rejeitadas: int = 0
    duplicados_hash: int = 0
    outros_cargos: int = 0
    nao_associados: int = 0
    erro: str = ""

    def como_dict(self) -> dict:
        return asdict(self)


COLUNAS_RELATORIO = tuple(LinhaRelatorio.__dataclass_fields__.keys())


def resumir(
    ano: int,
    uf: str,
    associacoes: list[Associacao],
    recurso: ResultadoRecurso,
    candidaturas_governador: int,
    erro: str = "",
) -> LinhaRelatorio:
    linha = LinhaRelatorio(ano=ano, uf=uf, candidaturas_governador=candidaturas_governador, erro=erro)
    linha.recurso_proposta_localizado = "sim" if recurso.url_recurso else "nao"
    linha.status_download_proposta = recurso.status_download
    linha.falhas_download = 1 if recurso.status_download == "FALHA" else 0

    sq_com_pdf: set[str] = set()
    for a in associacoes:
        if a.documento is not None:
            linha.pdfs_encontrados += 1
            if a.documento.status_extracao == "EXTRAIDO":
                linha.pdfs_extraidos += 1
            else:
                linha.extracoes_rejeitadas += 1
        if a.tipo_documento == TIPO_LEIAME:
            linha.pdfs_leiame += 1
        if a.duplicado_de:
            linha.duplicados_hash += 1
        s = a.status_associacao
        if s in (ESTADO_EXATO, ESTADO_PENDENTE) and a.candidatura is not None:
            sq_com_pdf.add(a.candidatura.sq)
        if s == ESTADO_PENDENTE:
            linha.associacoes_pendentes += 1
        elif s == ESTADO_SEM_DOCUMENTO:
            if a.busca_conclusiva:
                linha.sem_documento_conclusivo += 1
            else:
                linha.sem_documento_nao_conclusivo += 1
        elif s == ESTADO_OUTRO_CARGO:
            linha.outros_cargos += 1
        elif s == ESTADO_NAO_ASSOCIADO and a.tipo_documento != TIPO_LEIAME:
            linha.nao_associados += 1
    linha.candidaturas_com_pdf_associado = len(sq_com_pdf)
    return linha


def formatar_tabela(linhas: list[LinhaRelatorio]) -> str:
    colunas = [
        ("ano", "ano"),
        ("uf", "uf"),
        ("candidaturas_governador", "cand"),
        ("recurso_proposta_localizado", "recurso"),
        ("status_download_proposta", "download"),
        ("pdfs_encontrados", "pdfs"),
        ("pdfs_extraidos", "extraidos"),
        ("candidaturas_com_pdf_associado", "com_pdf"),
        ("associacoes_pendentes", "pendentes"),
        ("sem_documento_conclusivo", "sem_doc_conc"),
        ("sem_documento_nao_conclusivo", "sem_doc_inconc"),
        ("falhas_download", "falhas"),
        ("duplicados_hash", "dup_hash"),
        ("outros_cargos", "outro_cargo"),
        ("nao_associados", "nao_assoc"),
    ]
    dados = [[str(getattr(l, c)) for c, _ in colunas] for l in linhas]
    larguras = [max(len(h), *(len(r[i]) for r in dados)) if dados else len(h) for i, (_, h) in enumerate(colunas)]
    cab = "  ".join(h.ljust(larguras[i]) for i, (_, h) in enumerate(colunas))
    corpo = ["  ".join(v.ljust(larguras[i]) for i, v in enumerate(r)) for r in dados]
    erros = [f"ERRO {l.ano}/{l.uf}: {l.erro}" for l in linhas if l.erro]
    return "\n".join([cab, "-" * len(cab), *corpo, *erros])


def escrever_relatorio(caminho: Path, linhas: list[LinhaRelatorio]) -> None:
    escrever_csv(caminho, [l.como_dict() for l in linhas], COLUNAS_RELATORIO)
