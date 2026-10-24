"""Orquestração: descoberta, download, extração, associação, manifestos e relatório.

Uso (a partir da raiz do repositório):

    python3 -m scripts.propostas_governo                      # todos os recortes
    python3 -m scripts.propostas_governo --anos 2022 --ufs SP  # um recorte
    python3 -m scripts.propostas_governo --simular             # só descobre e mostra o plano
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
import time
import zipfile
from dataclasses import replace
from datetime import datetime
from pathlib import Path

from . import ckan, config
from .arquivos import ErroExtracao, detectar_formato, e_zip, e_zip_ou_pdf, extrair_pdfs, nome_seguro
from .associacao import associar, escrever_revisao
from .candidaturas import ArquivoCandidaturas, ler_candidaturas_zip
from .download import ErroDownload, baixar_arquivo
from .manifesto import COLUNAS_MANIFESTO, escrever_csv, linha_manifesto
from .modelos import Documento, ResultadoRecurso, caminho_relativo
from .relatorio import LinhaRelatorio, escrever_relatorio, formatar_tabela, resumir

log = logging.getLogger("propostas_governo")

COLUNAS_CANDIDATURAS = (
    "ano_eleicao",
    "uf",
    "sq_candidato",
    "nome_candidato",
    "nome_urna",
    "numero_candidato",
    "partido",
    "cd_cargo",
    "ds_cargo",
    "situacao_candidatura",
    "turnos",
    "arquivo_fonte",
    "encoding",
    "data_coleta",
)


def _rel(caminho: Path) -> str:
    return caminho_relativo(caminho, config.RAIZ_REPO)


def _agora() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _configurar_log(logs_dir: Path) -> None:
    logs_dir.mkdir(parents=True, exist_ok=True)
    arquivo = logs_dir / f"coleta_{datetime.now():%Y%m%d_%H%M%S}.log"
    formato = "%(asctime)s %(levelname)s %(name)s: %(message)s"
    logging.basicConfig(
        level=logging.INFO,
        format=formato,
        handlers=[logging.StreamHandler(sys.stderr), logging.FileHandler(arquivo, encoding="utf-8")],
        force=True,
    )
    log.info("log em %s", arquivo)


def _imprimir_plano(recursos: ckan.RecursosAno, ufs, base: Path) -> None:
    print(f"\n== {recursos.ano} ==")
    if recursos.url_candidaturas:
        print(f"  candidaturas [{recursos.fonte.get('candidaturas')}]: {recursos.url_candidaturas}")
    else:
        print("  candidaturas: NÃO LOCALIZADO")
    for uf in ufs:
        url = recursos.urls_propostas.get(uf)
        if url:
            fmt = recursos.formatos_propostas.get(uf)
            existe = (base / "propostas_governo" / str(recursos.ano) / uf / "originais").exists()
            print(f"  {uf} [{recursos.fonte.get(uf)}, formato declarado={fmt}]: {url}")
            print(f"     pasta de originais existe: {'sim' if existe else 'não'}")
        else:
            print(f"  {uf}: recurso de proposta NÃO LOCALIZADO")


def _obter_candidaturas(
    ano: int,
    recursos: ckan.RecursosAno,
    ufs,
    base: Path,
    *,
    forcar: bool,
    data_coleta: str,
) -> tuple[ResultadoRecurso, dict[str, ArquivoCandidaturas] | None]:
    if recursos.url_candidaturas is None:
        return ResultadoRecurso("NAO_LOCALIZADO", erro="recurso de candidaturas não localizado"), None
    url = recursos.url_candidaturas
    destino = base / "candidaturas" / str(ano) / "originais" / nome_seguro(ckan.nome_da_url(url))
    try:
        res = baixar_arquivo(url, destino, validador=e_zip, forcar=forcar)
    except ErroDownload as exc:
        return ResultadoRecurso("FALHA", url_recurso=url, erro=str(exc)), None
    recurso = ResultadoRecurso(
        status_download="BAIXADO" if res.baixado_agora else "JA_EXISTIA",
        url_recurso=url,
        url_arquivo=res.url_final,
        formato_declarado="CSV",
        formato_detectado="ZIP",
        caminho_local=_rel(destino),
        sha256=res.sha256,
        tamanho_bytes=res.tamanho_bytes,
    )
    if res.baixado_agora:
        time.sleep(config.PAUSA_ENTRE_DOWNLOADS_S)
    try:
        arquivos = {uf: ler_candidaturas_zip(destino, ano=ano, uf=uf) for uf in ufs}
    except (ValueError, zipfile.BadZipFile) as exc:
        log.error("candidaturas %s: arquivo não pode ser interpretado: %s", ano, exc)
        return ResultadoRecurso(recurso.status_download, url_recurso=url, url_arquivo=res.url_final,
                                caminho_local=recurso.caminho_local, sha256=recurso.sha256,
                                tamanho_bytes=recurso.tamanho_bytes, erro=str(exc)), None
    _escrever_candidaturas(ano, arquivos, base, recurso, data_coleta)
    return recurso, arquivos


def _escrever_candidaturas(
    ano: int,
    arquivos: dict[str, ArquivoCandidaturas],
    base: Path,
    recurso: ResultadoRecurso,
    data_coleta: str,
) -> None:
    linhas = []
    for uf, arq in arquivos.items():
        for sq, c in arq.governadores().items():
            linhas.append(
                {
                    "ano_eleicao": ano,
                    "uf": uf,
                    "sq_candidato": c.sq,
                    "nome_candidato": c.nome,
                    "nome_urna": c.nome_urna,
                    "numero_candidato": c.numero,
                    "partido": c.partido,
                    "cd_cargo": c.cd_cargo,
                    "ds_cargo": c.ds_cargo,
                    "situacao_candidatura": c.situacao,
                    "turnos": ",".join(str(t) for t in c.turnos),
                    "arquivo_fonte": recurso.caminho_local,
                    "encoding": arq.encoding,
                    "data_coleta": data_coleta,
                }
            )
        log.info(
            "candidaturas %s/%s: %d governador(es) de %d candidatura(s) (linhas da UF=%d, sem SQ=%d)",
            ano, uf, len(arq.governadores()), len(arq.candidaturas), arq.linhas_lidas - arq.linhas_outra_uf,
            arq.linhas_sem_sq,
        )
    escrever_csv(base / "candidaturas" / str(ano) / "candidaturas_governador.csv", linhas, COLUNAS_CANDIDATURAS)


def _documentos_do_recurso(
    ano: int,
    uf: str,
    url: str,
    formato_declarado: str,
    destino: Path,
    recurso: ResultadoRecurso,
    pasta_pdfs: Path,
) -> tuple[list[Documento], int]:
    formato = detectar_formato(destino)
    if formato == "ZIP":
        resumo = extrair_pdfs(destino, pasta_pdfs, prefixo=f"{ano}_{uf}")
        docs = []
        for it in resumo.itens:
            if it.status == "EXTRAIDO":
                fmt_det = "PDF"
            elif it.status == "INVALIDO":
                fmt_det = "OUTRO"
            else:
                fmt_det = ""
            docs.append(
                Documento(
                    ano=ano,
                    uf=uf,
                    nome_original=it.nome_original,
                    caminho_interno_zip=it.caminho_interno,
                    url_arquivo=recurso.url_arquivo,
                    formato_declarado=formato_declarado,
                    formato_detectado=fmt_det,
                    status_extracao=it.status,
                    motivo_extracao=it.motivo,
                    caminho_local=_rel(it.caminho_local) if it.caminho_local else "",
                    tamanho_bytes=it.tamanho_bytes,
                    sha256=it.sha256,
                )
            )
        return docs, resumo.membros_nao_pdf
    if formato == "PDF":
        nome = ckan.nome_da_url(url)
        return [
            Documento(
                ano=ano,
                uf=uf,
                nome_original=nome,
                caminho_interno_zip=nome,
                url_arquivo=recurso.url_arquivo,
                formato_declarado=formato_declarado,
                formato_detectado="PDF",
                status_extracao="EXTRAIDO",
                motivo_extracao="",
                caminho_local=_rel(destino),
                tamanho_bytes=recurso.tamanho_bytes,
                sha256=recurso.sha256,
            )
        ], 0
    raise ErroDownload(f"formato inesperado no download: {formato}")


def _processar_uf(
    ano: int,
    uf: str,
    recursos: ckan.RecursosAno,
    arq: ArquivoCandidaturas,
    base: Path,
    *,
    forcar: bool,
    data_coleta: str,
) -> LinhaRelatorio:
    dir_uf = base / "propostas_governo" / str(ano) / uf
    url = recursos.urls_propostas.get(uf)
    n_governadores = len(arq.governadores())

    documentos: list[Documento] = []
    busca_conclusiva = False
    if url is None:
        recurso = ResultadoRecurso("NAO_LOCALIZADO", erro="recurso de proposta não localizado no portal")
        log.warning("%s/%s: recurso de proposta não localizado", ano, uf)
    else:
        formato_declarado = recursos.formatos_propostas.get(uf, "")
        destino = dir_uf / "originais" / nome_seguro(ckan.nome_da_url(url))
        try:
            res = baixar_arquivo(url, destino, validador=e_zip_ou_pdf, forcar=forcar)
        except ErroDownload as exc:
            recurso = ResultadoRecurso("FALHA", url_recurso=url, formato_declarado=formato_declarado, erro=str(exc))
            log.error("%s/%s: falha no download: %s", ano, uf, exc)
        else:
            formato = detectar_formato(destino)
            recurso = ResultadoRecurso(
                status_download="BAIXADO" if res.baixado_agora else "JA_EXISTIA",
                url_recurso=url,
                url_arquivo=res.url_final,
                formato_declarado=formato_declarado,
                formato_detectado=formato,
                caminho_local=_rel(destino),
                sha256=res.sha256,
                tamanho_bytes=res.tamanho_bytes,
            )
            if res.baixado_agora:
                time.sleep(config.PAUSA_ENTRE_DOWNLOADS_S)
            try:
                documentos, nao_pdf = _documentos_do_recurso(
                    ano, uf, url, formato_declarado, destino, recurso, dir_uf / "pdfs"
                )
            except (ErroExtracao, ErroDownload) as exc:
                documentos, busca_conclusiva = [], False
                recurso = replace(recurso, status_download="FALHA", erro=str(exc))
                log.error("%s/%s: recurso baixado, mas não pode ser lido: %s", ano, uf, exc)
            else:
                busca_conclusiva = True
                log.info(
                    "%s/%s: %d membro(s) PDF, %d não-PDF ignorado(s), formato=%s",
                    ano, uf, len(documentos), nao_pdf, formato,
                )

    associacoes = associar(ano, uf, arq.candidaturas, documentos, busca_conclusiva=busca_conclusiva)
    linhas = [linha_manifesto(a, recurso, raiz=config.RAIZ_REPO, data_coleta=data_coleta) for a in associacoes]
    escrever_csv(dir_uf / "manifest.csv", linhas, COLUNAS_MANIFESTO)
    pendentes = escrever_revisao(dir_uf / "revisao_manual.csv", associacoes, config.RAIZ_REPO)
    log.info("%s/%s: %d linha(s) no manifesto, %d para revisão manual", ano, uf, len(linhas), pendentes)
    return resumir(ano, uf, associacoes, recurso, n_governadores)


def executar(
    anos,
    ufs,
    base: Path,
    *,
    simular: bool = False,
    forcar: bool = False,
    usar_pagina: bool = True,
) -> list[LinhaRelatorio]:
    linhas: list[LinhaRelatorio] = []
    data_coleta = _agora()
    (base / "logs").mkdir(parents=True, exist_ok=True)

    for ano in anos:
        log.info("descobrindo recursos de %s", ano)
        recursos = ckan.descobrir(ano, ufs, usar_pagina=usar_pagina)
        if recursos.json_ckan is not None:
            (base / "logs" / f"ckan_candidatos_{ano}.json").write_text(
                json.dumps(recursos.json_ckan, ensure_ascii=False, indent=1), encoding="utf-8"
            )
        if simular:
            _imprimir_plano(recursos, ufs, base)
            continue

        recurso_cand, arquivos = _obter_candidaturas(
            ano, recursos, ufs, base, forcar=forcar, data_coleta=data_coleta
        )
        if arquivos is None:
            for uf in ufs:
                linhas.append(LinhaRelatorio(ano=ano, uf=uf, erro=f"candidaturas: {recurso_cand.erro}"))
            continue

        for uf in ufs:
            linhas.append(
                _processar_uf(ano, uf, recursos, arquivos[uf], base, forcar=forcar, data_coleta=data_coleta)
            )
    return linhas


def _consolidar(base: Path, anos, ufs) -> int:
    from .manifesto import ler_csv

    linhas: list[dict] = []
    for ano in anos:
        for uf in ufs:
            caminho = base / "propostas_governo" / str(ano) / uf / "manifest.csv"
            if caminho.exists():
                linhas.extend(ler_csv(caminho))
    escrever_csv(base / "propostas_governo" / "manifest_consolidado.csv", linhas, COLUNAS_MANIFESTO)
    return len(linhas)


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Coleta propostas de governo (TSE) para SP e BA.")
    p.add_argument("--anos", nargs="+", type=int, default=list(config.ANOS))
    p.add_argument("--ufs", nargs="+", default=list(config.UFS))
    p.add_argument("--dir-dados", type=Path, default=config.DIR_DADOS_PADRAO)
    p.add_argument("--simular", action="store_true", help="descobre recursos e mostra o plano, sem baixar")
    p.add_argument("--forcar", action="store_true", help="baixa de novo mesmo que o arquivo já exista")
    p.add_argument("--sem-pagina", action="store_true", help="não usa a página do conjunto como alternativa")
    return p


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    anos = sorted(set(args.anos))
    ufs = [u.upper() for u in args.ufs]
    invalidos = [a for a in anos if a not in config.ANOS] + [u for u in ufs if u not in config.UFS]
    if invalidos:
        print(f"valores fora da configuração: {invalidos}", file=sys.stderr)
        return 2

    base = args.dir_dados.resolve()
    _configurar_log(base / "logs")
    linhas = executar(anos, ufs, base, simular=args.simular, forcar=args.forcar, usar_pagina=not args.sem_pagina)
    if args.simular:
        return 0

    escrever_relatorio(base / "propostas_governo" / "relatorio_cobertura.csv", linhas)
    total = _consolidar(base, config.ANOS, config.UFS)
    print()
    print(formatar_tabela(linhas))
    print(f"\nmanifest consolidado: {total} linha(s) em {base / 'propostas_governo' / 'manifest_consolidado.csv'}")
    print(f"relatório: {base / 'propostas_governo' / 'relatorio_cobertura.csv'}")
    return 1 if any(l.erro for l in linhas) else 0
