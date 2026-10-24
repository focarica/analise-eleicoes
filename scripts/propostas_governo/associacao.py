"""Associação dos PDFs de propostas às candidaturas de governador.

Regras (em ordem):
1. Arquivo não extraído (inválido ou rejeitado) -> NAO_ASSOCIADO.
2. ``leiame*.pdf`` é documento auxiliar do TSE -> NAO_ASSOCIADO (tipo leiame).
3. O nome deve seguir ``{ano}{UF}{SQ}`` ou ``proposta_governo_{ano}_{UF}_{SQ}``.
   Sem isso -> NAO_ASSOCIADO.
4. SQ fora das candidaturas da UF/ano -> NAO_ASSOCIADO.
5. SQ de outro cargo -> OUTRO_CARGO (fora do escopo, mas inventariado).
6. SQ de governador -> MATCH_EXATO, salvo se houver:
   - mais de um PDF para a mesma candidatura; ou
   - conteúdo idêntico a outro arquivo associado a outra candidatura ou não associado
   -> MATCH_PENDENTE_REVISAO.
7. Candidatura de governador sem PDF -> SEM_DOCUMENTO_LOCALIZADO. O campo
   ``busca_conclusiva`` indica se o recurso oficial foi lido com sucesso.
"""
from __future__ import annotations

import csv
import re
from collections import defaultdict
from pathlib import Path, PurePosixPath

from . import config
from .modelos import Associacao, Candidatura, Documento, caminho_relativo

ESTADO_EXATO = "MATCH_EXATO"
ESTADO_PENDENTE = "MATCH_PENDENTE_REVISAO"
ESTADO_NAO_ASSOCIADO = "NAO_ASSOCIADO"
ESTADO_SEM_DOCUMENTO = "SEM_DOCUMENTO_LOCALIZADO"
ESTADO_OUTRO_CARGO = "OUTRO_CARGO"

TIPO_PROPOSTA = "proposta"
TIPO_LEIAME = "leiame"
TIPO_INVALIDO = "invalido"


def sq_do_nome(nome_arquivo: str, ano: int, uf: str) -> str | None:
    stem = PurePosixPath(nome_arquivo).stem
    m = re.match(rf"^(?:proposta_governo_)?{ano}_?{uf}_?(\d{{5,}})$", stem, re.IGNORECASE)
    return m.group(1) if m else None


def eh_leiame(nome_arquivo: str) -> bool:
    return PurePosixPath(nome_arquivo).name.lower().startswith("leiame")


def associar(
    ano: int,
    uf: str,
    candidaturas: dict[str, Candidatura],
    documentos: list[Documento],
    *,
    busca_conclusiva: bool,
) -> list[Associacao]:
    n = len(documentos)
    sqs: list[str | None] = [None] * n
    cands: list[Candidatura | None] = [None] * n
    estados = [ESTADO_NAO_ASSOCIADO] * n
    tipos = [TIPO_PROPOSTA] * n
    motivos = [""] * n

    for i, doc in enumerate(documentos):
        if doc.status_extracao != "EXTRAIDO":
            tipos[i] = TIPO_INVALIDO
            motivos[i] = f"arquivo não aceito na extração: {doc.motivo_extracao}"
            continue
        if eh_leiame(doc.nome_original):
            tipos[i] = TIPO_LEIAME
            motivos[i] = "documento auxiliar do TSE (leiame); não é proposta de candidatura"
            continue
        sq = sq_do_nome(doc.nome_original, ano, uf)
        sqs[i] = sq
        if sq is None:
            motivos[i] = f"nome do arquivo não segue o padrão {ano}{uf}<SQ_CANDIDATO>"
            continue
        cand = candidaturas.get(sq)
        if cand is None:
            motivos[i] = f"SQ {sq} não consta nas candidaturas de {uf}/{ano}"
            continue
        cands[i] = cand
        if cand.ds_cargo.strip().upper() != config.CARGO:
            estados[i] = ESTADO_OUTRO_CARGO
            motivos[i] = f"candidatura de {cand.ds_cargo.lower()}; fora do escopo de governador"
        else:
            estados[i] = ESTADO_EXATO

    # Identidade de conteúdo: mesmo SHA-256 em mais de um arquivo.
    por_hash: dict[str, list[int]] = defaultdict(list)
    for i, doc in enumerate(documentos):
        if doc.status_extracao == "EXTRAIDO":
            por_hash[doc.sha256].append(i)

    duplicado_de = [""] * n
    conflito_hash = [False] * n
    for indices in por_hash.values():
        if len(indices) < 2:
            continue
        primeiro = indices[0]
        for i in indices:
            if i != primeiro:
                duplicado_de[i] = documentos[primeiro].caminho_interno_zip
            for j in indices:
                if j != i and sqs[j] != sqs[i]:
                    conflito_hash[i] = True

    # Mais de um PDF por candidatura de governador.
    por_sq: dict[str, list[int]] = defaultdict(list)
    for i in range(n):
        if estados[i] == ESTADO_EXATO and sqs[i] is not None:
            por_sq[sqs[i]].append(i)

    for sq, indices in por_sq.items():
        for i in indices:
            if len(indices) > 1:
                estados[i] = ESTADO_PENDENTE
                motivos[i] = f"mais de um PDF para a candidatura SQ {sq}"
            if conflito_hash[i]:
                estados[i] = ESTADO_PENDENTE
                motivos[i] = (
                    motivos[i] + "; " if motivos[i] else ""
                ) + "conteúdo idêntico a arquivo de outra candidatura ou sem associação"

    # Conflito de hash também vale para arquivos fora do escopo governador: a nota é anexada.
    for i in range(n):
        if conflito_hash[i] and estados[i] != ESTADO_PENDENTE and tipos[i] == TIPO_PROPOSTA:
            if estados[i] in (ESTADO_OUTRO_CARGO, ESTADO_NAO_ASSOCIADO):
                motivos[i] = (motivos[i] + "; " if motivos[i] else "") + (
                    "conteúdo idêntico a arquivo de outra candidatura"
                )

    for i in range(n):
        if estados[i] == ESTADO_EXATO:
            motivos[i] = f"SQ no nome do arquivo confere com candidatura de governador {uf}/{ano}"

    resultados: list[Associacao] = []
    for i, doc in enumerate(documentos):
        resultados.append(
            Associacao(
                ano=ano,
                uf=uf,
                status_associacao=estados[i],
                motivo=motivos[i],
                tipo_documento=tipos[i],
                documento=doc,
                candidatura=cands[i],
                sq_no_nome=sqs[i] or "",
                duplicado_de=duplicado_de[i],
                busca_conclusiva=busca_conclusiva,
            )
        )

    # Candidaturas de governador com PDF associado.
    com_pdf = {sq for sq, idxs in por_sq.items() if any(estados[i] in (ESTADO_EXATO, ESTADO_PENDENTE) for i in idxs)}
    for sq, cand in sorted(candidaturas.items(), key=lambda kv: kv[1].nome):
        if cand.ds_cargo.strip().upper() != config.CARGO or sq in com_pdf:
            continue
        motivo = (
            "não localizado nos recursos oficiais de propostas da UF/ano (busca concluída)"
            if busca_conclusiva
            else "busca não conclusiva: recurso oficial de propostas não foi lido"
        )
        resultados.append(
            Associacao(
                ano=ano,
                uf=uf,
                status_associacao=ESTADO_SEM_DOCUMENTO,
                motivo=motivo,
                tipo_documento="",
                documento=None,
                candidatura=cand,
                busca_conclusiva=busca_conclusiva,
            )
        )
    return resultados


def precisa_revisao(assoc: Associacao) -> bool:
    """Itens que vão para o CSV de mapeamento manual (exclui leiame e casos já resolvidos)."""
    if assoc.tipo_documento == TIPO_LEIAME:
        return False
    return assoc.status_associacao in (ESTADO_PENDENTE, ESTADO_NAO_ASSOCIADO)


COLUNAS_REVISAO = (
    "caminho_pdf",
    "nome_candidato_sugerido",
    "sq_candidato",
    "ano_eleicao",
    "uf",
    "status_associacao",
    "motivo",
)


def escrever_revisao(caminho: Path, associacoes: list[Associacao], raiz: Path) -> int:
    linhas = []
    for a in associacoes:
        if not precisa_revisao(a):
            continue
        doc = a.documento
        cand = a.candidatura
        linhas.append(
            {
                "caminho_pdf": caminho_relativo(Path(doc.caminho_local), raiz) if doc and doc.caminho_local else "",
                "nome_candidato_sugerido": cand.nome if cand else "",
                "sq_candidato": cand.sq if cand else a.sq_no_nome,
                "ano_eleicao": a.ano,
                "uf": a.uf,
                "status_associacao": a.status_associacao,
                "motivo": a.motivo,
            }
        )
    caminho.parent.mkdir(parents=True, exist_ok=True)
    tmp = caminho.with_name(caminho.name + ".tmp")
    with open(tmp, "w", newline="", encoding="utf-8") as fh:
        escritor = csv.DictWriter(fh, fieldnames=COLUNAS_REVISAO, delimiter=";")
        escritor.writeheader()
        escritor.writerows(linhas)
    tmp.replace(caminho)
    return len(linhas)
