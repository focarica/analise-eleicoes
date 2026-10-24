"""Extrai o texto dos PDFs já coletados e gera o inventário de extração.

Entrada: ``manifest.csv`` de cada recorte (``propostas_governo/{ano}/{UF}/``).
Saída, por recorte:
- ``texto/{nome_do_pdf}.txt``: texto com marcadores de página;
- ``texto/extracao.csv``: um registro por PDF, com status e contagens.

Primeiro usa o texto nativo (``pdftotext``). Páginas sem texto nativo passam por
OCR (Tesseract, português). Use ``--sem-ocr`` para pular o OCR.

Uso (na raiz do repositório):

    python3 -m scripts.propostas_governo.extrair_texto
    python3 -m scripts.propostas_governo.extrair_texto --anos 2022 --ufs SP

A execução é repetível: um ``.txt`` já gerado é reaproveitado quando o SHA-256
do PDF não mudou e o OCR já foi feito com a mesma configuração. Use ``--forcar``
para reprocessar tudo.
"""
from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from . import config, ocr, texto
from .coletor import _configurar_log
from .manifesto import escrever_csv, ler_csv
from .modelos import caminho_relativo

log = logging.getLogger("propostas_governo.texto")

TIPOS_EXCLUIDOS = {"leiame", "invalido"}
OCR_NAO_EXECUTADO = "NAO_EXECUTADO"
OCR_NAO_NECESSARIO = "NAO_NECESSARIO"
OCR_OK = "OK"
OCR_ERRO = "ERRO"


def _pdfs_do_recorte(dir_uf: Path) -> list[dict]:
    """Um item por PDF distinto, com SQ e nome vindos da associação do manifesto."""
    manifest = dir_uf / "manifest.csv"
    if not manifest.exists():
        return []
    por_caminho: dict[str, dict] = {}
    for linha in ler_csv(manifest):
        caminho = linha.get("caminho_local", "")
        if not caminho or linha.get("tipo_documento") in TIPOS_EXCLUIDOS:
            continue
        atual = por_caminho.get(caminho)
        # Vários registros podem apontar para o mesmo arquivo (duplicata por hash).
        # Mantém o que tem candidatura identificada.
        if atual is None or (not atual["sq_candidato"] and linha.get("sq_candidato")):
            por_caminho[caminho] = {
                "ano_eleicao": linha["ano_eleicao"],
                "uf": linha["uf"],
                "sq_candidato": linha.get("sq_candidato", ""),
                "nome_candidato": linha.get("nome_candidato", ""),
                "tipo_documento": linha.get("tipo_documento", ""),
                "pdf_local": caminho,
            }
    return sorted(por_caminho.values(), key=lambda d: d["pdf_local"])


def _carregar_extracao_anterior(caminho_csv: Path) -> dict[str, dict]:
    if not caminho_csv.exists():
        return {}
    return {linha["pdf_local"]: linha for linha in ler_csv(caminho_csv)}


def _reutilizavel(anterior: dict | None, sha_pdf: str, txt: Path, ocr_ativo: bool, versao: str) -> bool:
    if not anterior or anterior.get("sha256_pdf") != sha_pdf or not txt.exists():
        return False
    if anterior.get("status_texto") == texto.STATUS_ERRO:
        return False
    if not ocr_ativo:
        return True
    if anterior.get("ocr_versao") == versao:
        return True
    # Sem páginas pendentes de OCR, a versão do OCR não muda o resultado.
    return not anterior.get("paginas_sem_texto")


def _status_final(paginas_total: int, sem_nativo: tuple[int, ...], com_ocr: set[int]) -> str:
    restantes = [n for n in sem_nativo if n not in com_ocr]
    if paginas_total == 0 or len(restantes) == paginas_total:
        return texto.STATUS_SEM_TEXTO
    if restantes:
        return texto.STATUS_PARCIAL
    return texto.STATUS_OK


def _aplicar_ocr(pdf: Path, res: texto.ResultadoTexto) -> tuple[dict, dict]:
    """Roda OCR nas páginas sem texto nativo. Retorna (resumo_ocr, textos_por_pagina)."""
    vazio = {
        "ocr_status": OCR_NAO_NECESSARIO,
        "paginas_ocr": "",
        "paginas_ocr_com_texto": "",
        "paginas_ocr_vazias": "",
        "caracteres_ocr": 0,
        "confianca_ocr_media": "",
    }
    if not res.paginas_sem_texto:
        return vazio, {}

    resultados = ocr.ocr_paginas(pdf, list(res.paginas_sem_texto))
    textos: dict[int, str] = {}
    confiancas: list[float] = []
    erros: list[str] = []
    caracteres = 0
    for n, r in resultados.items():
        if r.erro:
            erros.append(f"p{n}: {r.erro}")
        if r.texto.strip():
            textos[n] = r.texto
            caracteres += len(r.texto.strip())
        if r.confianca_media is not None and r.texto.strip():
            confiancas.append(r.confianca_media)

    # Página "recuperada" é a que tem ao menos o mesmo limiar de texto usado na extração nativa.
    uteis = sorted(n for n, t in textos.items() if len(t.strip()) >= texto.MIN_CARACTERES_POR_PAGINA)
    vazias = [n for n in res.paginas_sem_texto if n not in uteis]
    resumo = {
        "ocr_status": OCR_ERRO if erros else OCR_OK,
        "paginas_ocr": ";".join(str(n) for n in res.paginas_sem_texto),
        "paginas_ocr_com_texto": ";".join(str(n) for n in uteis),
        "paginas_ocr_vazias": ";".join(str(n) for n in vazias),
        "caracteres_ocr": caracteres,
        "confianca_ocr_media": round(sum(confiancas) / len(confiancas), 1) if confiancas else "",
        "erro_ocr": " | ".join(erros),
        "_uteis": set(uteis),
    }
    return resumo, textos


def processar_recorte(
    ano: int,
    uf: str,
    base: Path,
    *,
    forcar: bool,
    ocr_ativo: bool,
) -> list[dict]:
    dir_uf = base / "propostas_governo" / str(ano) / uf
    dir_texto = dir_uf / "texto"
    csv_extracao = dir_texto / "extracao.csv"
    anteriores = {} if forcar else _carregar_extracao_anterior(csv_extracao)
    versao = ocr.versao_pipeline() if ocr_ativo else ""
    itens = _pdfs_do_recorte(dir_uf)

    registros: list[dict] = []
    for item in itens:
        pdf = config.RAIZ_REPO / item["pdf_local"]
        if not pdf.exists():
            log.error("%s/%s: PDF listado no manifesto não existe: %s", ano, uf, item["pdf_local"])
            registros.append({**item, "status_texto": texto.STATUS_ERRO, "erro": "arquivo ausente"})
            continue

        sha_pdf = texto.sha256_arquivo(pdf)
        txt = dir_texto / f"{pdf.stem}.txt"
        anterior = anteriores.get(item["pdf_local"])
        if _reutilizavel(anterior, sha_pdf, txt, ocr_ativo, versao):
            registros.append(anterior)
            continue

        res = texto.extrair(pdf)
        registro = {
            **item,
            "sha256_pdf": sha_pdf,
            "status_texto": res.status,
            "paginas": res.paginas,
            "paginas_sem_texto": ";".join(str(n) for n in res.paginas_sem_texto),
            "caracteres": res.caracteres,
            "txt_local": "",
            "sha256_txt": "",
            "avisos_pdftotext": res.avisos,
            "erro": res.erro,
            "ocr_versao": versao,
            "data_extracao": texto.agora(),
        }

        if res.status == texto.STATUS_ERRO:
            registro.update({"ocr_status": OCR_NAO_EXECUTADO, "status_final": texto.STATUS_ERRO})
            log.error("%s/%s: %s -> ERRO: %s", ano, uf, pdf.name, res.erro)
            registros.append(registro)
            continue

        if ocr_ativo:
            resumo_ocr, ocr_textos = _aplicar_ocr(pdf, res)
        else:
            resumo_ocr, ocr_textos = {"ocr_status": OCR_NAO_EXECUTADO}, {}
        erro_ocr = resumo_ocr.pop("erro_ocr", "")
        uteis = resumo_ocr.pop("_uteis", set())
        registro.update(resumo_ocr)
        if erro_ocr:
            registro["erro"] = (registro["erro"] + " | " if registro["erro"] else "") + erro_ocr

        registro["status_final"] = _status_final(res.paginas, res.paginas_sem_texto, uteis)

        dir_texto.mkdir(parents=True, exist_ok=True)
        conteudo = texto.montar_texto(list(res.paginas_texto), ocr_textos)
        tmp = txt.with_name(txt.name + ".tmp")
        tmp.write_text(conteudo, encoding="utf-8")
        tmp.replace(txt)
        registro["txt_local"] = caminho_relativo(txt, config.RAIZ_REPO)
        registro["sha256_txt"] = texto.sha256_arquivo(txt)

        log.info(
            "%s/%s: %s -> %s, final=%s (%d páginas; %d sem texto nativo; OCR útil em %d)",
            ano, uf, pdf.name, res.status, registro["status_final"], res.paginas,
            len(res.paginas_sem_texto), len(uteis),
        )
        registros.append(registro)

    escrever_csv(csv_extracao, registros, texto.COLUNAS_EXTRACAO)
    return registros


def _resumo(linhas: list[tuple[int, str, list[dict]]]) -> str:
    cab = (
        f"{'ano':<5} {'uf':<3} {'pdfs':>5} {'ok':>4} {'parcial':>8} {'sem_texto':>10} "
        f"{'pag_ocr':>8} {'ocr_util':>9} {'final_ok':>9} {'final_parc':>11} {'erro':>5} {'caracteres':>11}"
    )
    saida = [cab, "-" * len(cab)]
    for ano, uf, regs in linhas:
        nativo = {s: 0 for s in (texto.STATUS_OK, texto.STATUS_PARCIAL, texto.STATUS_SEM_TEXTO, texto.STATUS_ERRO)}
        final = {s: 0 for s in nativo}
        pag_ocr = ocr_util = 0
        for r in regs:
            nativo[r["status_texto"]] = nativo.get(r["status_texto"], 0) + 1
            final[r.get("status_final") or r["status_texto"]] = final.get(r.get("status_final") or r["status_texto"], 0) + 1
            if r.get("paginas_ocr"):
                pag_ocr += len(r["paginas_ocr"].split(";"))
            if r.get("paginas_ocr_com_texto"):
                ocr_util += len(r["paginas_ocr_com_texto"].split(";"))
        caracteres = sum(int(r.get("caracteres") or 0) + int(r.get("caracteres_ocr") or 0) for r in regs)
        saida.append(
            f"{ano:<5} {uf:<3} {len(regs):>5} {nativo[texto.STATUS_OK]:>4} {nativo[texto.STATUS_PARCIAL]:>8} "
            f"{nativo[texto.STATUS_SEM_TEXTO]:>10} {pag_ocr:>8} {ocr_util:>9} "
            f"{final[texto.STATUS_OK]:>9} {final[texto.STATUS_PARCIAL]:>11} {nativo[texto.STATUS_ERRO]:>5} {caracteres:>11}"
        )
    return "\n".join(saida)


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Extrai o texto dos PDFs de propostas (TSE), com OCR das páginas sem texto.")
    p.add_argument("--anos", nargs="+", type=int, default=list(config.ANOS))
    p.add_argument("--ufs", nargs="+", default=list(config.UFS))
    p.add_argument("--dir-dados", type=Path, default=config.DIR_DADOS_PADRAO)
    p.add_argument("--sem-ocr", action="store_true", help="usa só o texto nativo")
    p.add_argument("--forcar", action="store_true", help="reprocessa mesmo com .txt existente")
    return p


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        texto.verificar_ferramenta()
    except texto.FerramentaAusente as exc:
        print(str(exc), file=sys.stderr)
        return 2

    ocr_ativo = not args.sem_ocr
    if ocr_ativo:
        try:
            versao_tesseract = ocr.verificar()
        except ocr.FerramentaOcrAusente as exc:
            print(f"{exc}. Use --sem-ocr para extrair só o texto nativo.", file=sys.stderr)
            return 2
    else:
        versao_tesseract = "desligado"

    anos = sorted(set(args.anos))
    ufs = [u.upper() for u in args.ufs]
    invalidos = [a for a in anos if a not in config.ANOS] + [u for u in ufs if u not in config.UFS]
    if invalidos:
        print(f"valores fora da configuração: {invalidos}", file=sys.stderr)
        return 2

    base = args.dir_dados.resolve()
    _configurar_log(base / "logs")
    log.info("OCR: %s", versao_tesseract)

    resumo: list[tuple[int, str, list[dict]]] = []
    for ano in anos:
        for uf in ufs:
            regs = processar_recorte(ano, uf, base, forcar=args.forcar, ocr_ativo=ocr_ativo)
            resumo.append((ano, uf, regs))

    consolidado: list[dict] = []
    for _, _, regs in resumo:
        consolidado.extend(regs)
    escrever_csv(base / "propostas_governo" / "texto_extracao_consolidado.csv", consolidado, texto.COLUNAS_EXTRACAO)

    print()
    print(_resumo(resumo))
    print(f"\nconsolidado: {base / 'propostas_governo' / 'texto_extracao_consolidado.csv'}")
    return 1 if any(r["status_texto"] == texto.STATUS_ERRO for _, _, regs in resumo for r in regs) else 0


if __name__ == "__main__":
    sys.exit(main())
