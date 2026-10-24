"""Pipeline de segmentação: documentos de governador -> propostas, descartados e relatório.

Entrada: ``propostas_governo/{ano}/{UF}/texto_normalizado/*.txt`` (cria a partir de
``texto/*.txt`` quando faltar) e o ``manifest.csv`` para identificar o candidato.
Saída, por recorte, em ``propostas_governo/{ano}/{UF}/segmentacao/``:
``propostas.csv``, ``trechos_descartados.csv`` e ``relatorio.csv``. Os arquivos são
reconstruídos a cada execução, então reprocessar não duplica resultados.
"""
from __future__ import annotations

import argparse
import logging
import sys
from collections import Counter
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from .. import config, normalizacao
from ..manifesto import escrever_csv, ler_csv
from ..modelos import caminho_relativo
from .consolidacao import Descartado, Proposta, identificador, segmentar
from .documento import agrupar, ler_blocos
from .semantica import ClassificadorSemantico, HeuristicaLocal

log = logging.getLogger("propostas_governo.segmentacao")

REGRAS_VERSAO = "regras_v1"
ASSOCIACOES_GOVERNADOR = {"MATCH_EXATO", "MATCH_PENDENTE_REVISAO"}

COLUNAS_PROPOSTAS = (
    "proposta_id", "documento_id", "ano_eleicao", "uf", "sq_candidato", "nome_candidato",
    "status_associacao", "pdf_local", "texto_original", "pagina_inicial", "pagina_final",
    "paragrafo_origem", "blocos_origem", "frases_origem", "secao", "ocr", "status_segmentacao",
    "classificacao", "precisa_revisao", "justificativa", "confianca", "metodo_segmentacao",
    "data_segmentacao",
)
COLUNAS_DESCARTADOS = (
    "documento_id", "ano_eleicao", "uf", "sq_candidato", "pagina_inicial", "pagina_final",
    "paragrafo_origem", "blocos_origem", "secao", "motivo", "justificativa", "texto",
)
COLUNAS_RELATORIO = (
    "documento_id", "ano_eleicao", "uf", "sq_candidato", "nome_candidato", "status",
    "paragrafos", "unidades", "propostas", "uma_proposta", "divididas", "consolidadas",
    "indeterminadas", "revisao", "descartadas", "erro",
)


def _documentos_governador(dir_uf: Path) -> list[dict]:
    """Documentos de governador do recorte, com SQ e nome, sem duplicar o mesmo arquivo."""
    manifest = dir_uf / "manifest.csv"
    if not manifest.exists():
        return []
    vistos: dict[str, dict] = {}
    for linha in ler_csv(manifest):
        if linha.get("cargo") != config.CARGO or linha.get("status_associacao") not in ASSOCIACOES_GOVERNADOR:
            continue
        caminho = linha.get("caminho_local", "")
        if not caminho:
            continue
        vistos.setdefault(caminho, {
            "ano_eleicao": linha["ano_eleicao"],
            "uf": linha["uf"],
            "sq_candidato": linha["sq_candidato"],
            "nome_candidato": linha["nome_candidato"],
            "status_associacao": linha["status_associacao"],
            "pdf_local": caminho,
        })
    return sorted(vistos.values(), key=lambda d: d["pdf_local"])


def _metodo(classificador: ClassificadorSemantico, versao: str) -> str:
    regras = "regras_v1" if versao == "v1" else "regras_v2"
    return f"{regras}+{classificador.nome}_{classificador.versao}"


@dataclass(frozen=True)
class Versao:
    """Configuração de uma versão reproduzível da segmentação."""

    nome: str  # "v1" ou "v2"
    pasta_texto: str  # subpasta de texto normalizado
    pasta_saida: str  # subpasta de saída dentro de propostas_governo/{ano}/{UF}

    @classmethod
    def de(cls, nome: str) -> "Versao":
        if nome == "v1":
            return cls("v1", "texto_normalizado", "segmentacao")
        if nome == "v2":
            return cls("v2", "texto_normalizado_v2", "segmentacao_v2")
        raise ValueError(f"versão desconhecida: {nome}")


def segmentar_documento(
    texto_normalizado: str,
    classificador: ClassificadorSemantico,
    *,
    versao: str = "v1",
) -> tuple[list[Proposta], list[Descartado], Counter]:
    blocos = ler_blocos(texto_normalizado)
    paragrafos = agrupar(blocos, versao=versao)
    propostas, descartados, contagem = segmentar(paragrafos, classificador, versao=versao)
    contagem["paragrafos"] = len(paragrafos)
    return propostas, descartados, contagem


def _marcar_duplicatas(props: list[dict]) -> None:
    """Duplicatas textuais e quase-duplicatas dentro do mesmo documento. Não remove registros."""
    vistos: dict[str, str] = {}
    for p in props:
        texto = " ".join(p["texto_original"].split())
        p["duplicata_de"] = ""
        p["quase_duplicata_de"] = ""
        if texto in vistos:
            p["duplicata_de"] = vistos[texto]
        else:
            vistos[texto] = p["proposta_id"]
    # quase-duplicatas: Jaccard de palavras >= 0,85 entre textos longos, sem duplicata exata
    from .auditoria import _jaccard

    unicos = [p for p in props if not p["duplicata_de"] and len(p["texto_original"]) >= 60]
    for i, p in enumerate(unicos):
        for q in unicos[:i]:
            if _jaccard(p["texto_original"], q["texto_original"]) >= 0.85:
                p["quase_duplicata_de"] = q["proposta_id"]
                break


def _elegibilidade_proposta(p: dict, classificador: ClassificadorSemantico) -> dict:
    from .elegibilidade import classificar

    e = classificar(p["texto_original"], versao="v2")
    return {"elegibilidade": e.classe, "regra_elegibilidade": e.regra,
            "confianca_elegibilidade": round(e.confianca, 2), "motivo_elegibilidade": e.motivo}


def segmentar_recorte(
    ano: int,
    uf: str,
    base: Path,
    classificador: ClassificadorSemantico,
    *,
    versao: str = "v1",
) -> dict:
    """Segmenta os documentos de governador de um recorte e grava a saída da versão indicada."""
    cfg = Versao.de(versao)
    dir_uf = base / "propostas_governo" / str(ano) / uf
    saida = dir_uf / cfg.pasta_saida
    agora = datetime.now().isoformat(timespec="seconds")
    linhas_propostas: list[dict] = []
    linhas_descartados: list[dict] = []
    linhas_relatorio: list[dict] = []
    colunas_props = COLUNAS_PROPOSTAS + (V2_COLUNAS_PROPOSTAS if versao == "v2" else ())
    colunas_desc = COLUNAS_DESCARTADOS + (V2_COLUNAS_DESCARTADOS if versao == "v2" else ())

    for doc in _documentos_governador(dir_uf):
        stem = Path(doc["pdf_local"]).stem
        documento_id = stem
        relatorio = {
            "documento_id": documento_id, "ano_eleicao": doc["ano_eleicao"], "uf": uf,
            "sq_candidato": doc["sq_candidato"], "nome_candidato": doc["nome_candidato"],
            "status": "OK", "paragrafos": 0, "unidades": 0, "propostas": 0, "uma_proposta": 0,
            "divididas": 0, "consolidadas": 0, "indeterminadas": 0, "revisao": 0, "descartadas": 0, "erro": "",
        }
        try:
            normalizado = _garantir_normalizado(dir_uf, doc["pdf_local"], cfg.pasta_texto, versao)
            if normalizado is None:
                raise FileNotFoundError("texto extraído ausente")
            texto_norm = normalizado.read_text(encoding="utf-8")
            if not texto_norm.strip():
                relatorio["status"] = "SEM_TEXTO"
                linhas_relatorio.append(relatorio)
                log.warning("%s: texto vazio", documento_id)
                continue
            propostas, descartados, contagem = segmentar_documento(texto_norm, classificador, versao=versao)
        except Exception as exc:  # um documento com defeito não interrompe o recorte
            relatorio["status"] = "ERRO"
            relatorio["erro"] = f"{type(exc).__name__}: {exc}"
            linhas_relatorio.append(relatorio)
            log.exception("%s: falha na segmentação", documento_id)
            continue

        base_prop = {
            "documento_id": documento_id,
            "ano_eleicao": doc["ano_eleicao"],
            "uf": uf,
            "sq_candidato": doc["sq_candidato"],
            "nome_candidato": doc["nome_candidato"],
            "status_associacao": doc["status_associacao"],
            "pdf_local": doc["pdf_local"],
            "metodo_segmentacao": _metodo(classificador, versao),
            "data_segmentacao": agora,
        }
        props_doc: list[dict] = []
        for p in propostas:
            registro = {
                **base_prop,
                "proposta_id": identificador(documento_id, p),
                "texto_original": p.texto,
                "pagina_inicial": p.paginas[0],
                "pagina_final": p.paginas[1],
                "paragrafo_origem": p.paragrafo_id,
                "blocos_origem": ";".join(p.blocos_ids),
                "frases_origem": ";".join(p.frases_ids),
                "secao": p.secao,
                "ocr": "sim" if p.ocr else "nao",
                "status_segmentacao": p.status,
                "classificacao": p.classificacao,
                "precisa_revisao": "sim" if p.precisa_revisao else "nao",
                "justificativa": p.justificativa,
                "confianca": round(p.confianca, 2),
            }
            if versao == "v2":
                registro.update(_elegibilidade_proposta(registro, classificador))
                registro["partes_sugeridas"] = " | ".join(p.partes_sugeridas)
                registro["unidades_origem"] = len(p.numeros_unidade)
                registro["texto_fonte_normalizado"] = normalizado.name
            props_doc.append(registro)
        if versao == "v2":
            _marcar_duplicatas(props_doc)
        linhas_propostas.extend(props_doc)

        descartados_doc: list[dict] = []
        for d in descartados:
            registro_d = {
                "documento_id": documento_id,
                "ano_eleicao": doc["ano_eleicao"],
                "uf": uf,
                "sq_candidato": doc["sq_candidato"],
                "pagina_inicial": d.paginas[0],
                "pagina_final": d.paginas[1],
                "paragrafo_origem": d.paragrafo_id,
                "blocos_origem": ";".join(d.blocos_ids),
                "secao": d.secao,
                "motivo": d.motivo,
                "justificativa": d.justificativa,
                "texto": d.texto,
            }
            if versao == "v2":
                from .elegibilidade import classificar

                e = classificar(d.texto, bloco_titulo=d.justificativa.startswith("título"), versao="v2")
                registro_d.update({
                    "origem": "titulo" if d.justificativa.startswith("título") else "unidade",
                    "elegibilidade": e.classe,
                    "regra_elegibilidade": e.regra,
                    "confianca_elegibilidade": round(e.confianca, 2),
                    "motivo_elegibilidade": e.motivo,
                    "recuperavel_candidato": "sim" if e.classe in ("PROPOSTA", "AMBIGUO") else "nao",
                })
            descartados_doc.append(registro_d)
        linhas_descartados.extend(descartados_doc)

        if versao == "v1":
            relatorio.update({
                "paragrafos": contagem.get("paragrafos", 0),
                "unidades": contagem["unidades"],
                "propostas": len(propostas),
                "uma_proposta": contagem["uma"],
                "divididas": contagem["divididas"],
                "consolidadas": contagem["consolidadas"],
                "indeterminadas": contagem["indeterminadas"],
                "revisao": contagem["revisao"],
                "descartadas": len(descartados),
            })
        else:
            relatorio.update(_relatorio_v2(contagem, props_doc, descartados_doc))
        linhas_relatorio.append(relatorio)
        log.info("%s [%s]: %d unidade(s) -> %d registro(s), %d descartado(s)",
                 documento_id, versao, contagem["unidades"], len(props_doc), len(descartados_doc))

    colunas_rel = COLUNAS_RELATORIO if versao == "v1" else COLUNAS_RELATORIO_V2
    escrever_csv(saida / "propostas.csv", linhas_propostas, colunas_props)
    escrever_csv(saida / "trechos_descartados.csv", linhas_descartados, colunas_desc)
    escrever_csv(saida / "relatorio.csv", linhas_relatorio, colunas_rel)
    return {"ano": ano, "uf": uf, "propostas": linhas_propostas, "relatorio": linhas_relatorio,
            "descartados": len(linhas_descartados)}


V2_COLUNAS_PROPOSTAS = (
    "elegibilidade", "regra_elegibilidade", "confianca_elegibilidade", "motivo_elegibilidade",
    "partes_sugeridas", "unidades_origem", "duplicata_de", "quase_duplicata_de", "texto_fonte_normalizado",
)
V2_COLUNAS_DESCARTADOS = (
    "origem", "elegibilidade", "regra_elegibilidade", "confianca_elegibilidade", "motivo_elegibilidade",
    "recuperavel_candidato",
)
COLUNAS_RELATORIO_V2 = (
    "documento_id", "ano_eleicao", "uf", "sq_candidato", "nome_candidato", "status",
    "paragrafos", "unidades", "registros_propostas", "uma_proposta", "multiplas_sugeridas",
    "consolidadas", "indeterminadas", "revisao", "descartados_unidade", "descartados_titulo",
    "elegivel_proposta", "elegivel_diagnostico", "elegivel_contexto", "elegivel_titulo",
    "elegivel_fragmento", "elegivel_ambiguo", "duplicatas_textuais", "quase_duplicatas",
    "verificacao_unidades", "erro",
)


def _relatorio_v2(contagem: Counter, props: list[dict], descartados: list[dict]) -> dict:
    """Contagens definidas sobre os registros finais. Unidades são verificadas por soma."""
    unidades_em_registros = sum(int(p.get("unidades_origem") or 0) for p in props)
    unidades_descartadas = sum(1 for d in descartados if d["origem"] == "unidade")
    total = contagem["unidades"]
    contagem_elig = Counter(p["elegibilidade"] for p in props)
    return {
        "paragrafos": contagem.get("paragrafos", 0),
        "unidades": total,
        "registros_propostas": len(props),
        "uma_proposta": sum(1 for p in props if p["status_segmentacao"] == "UMA_PROPOSTA"),
        "multiplas_sugeridas": sum(1 for p in props if p["status_segmentacao"] == "MULTIPLAS_SUGERIDAS"),
        "consolidadas": sum(1 for p in props if p["status_segmentacao"] == "CONSOLIDADA_DE_FRASES"),
        "indeterminadas": sum(1 for p in props if p["status_segmentacao"] == "INDETERMINADO"),
        "revisao": sum(1 for p in props if p["precisa_revisao"] == "sim"),
        "descartados_unidade": unidades_descartadas,
        "descartados_titulo": sum(1 for d in descartados if d["origem"] == "titulo"),
        "elegivel_proposta": contagem_elig["PROPOSTA"],
        "elegivel_diagnostico": contagem_elig["DIAGNOSTICO"],
        "elegivel_contexto": contagem_elig["CONTEXTO"],
        "elegivel_titulo": contagem_elig["TITULO_ESTRUTURAL"],
        "elegivel_fragmento": contagem_elig["FRAGMENTO_INVALIDO"],
        "elegivel_ambiguo": contagem_elig["AMBIGUO"],
        "duplicatas_textuais": sum(1 for p in props if p["duplicata_de"]),
        "quase_duplicatas": sum(1 for p in props if p["quase_duplicata_de"]),
        "verificacao_unidades": "ok" if unidades_em_registros + unidades_descartadas == total else
        f"divergente: {unidades_em_registros}+{unidades_descartadas}!={total}",
    }


def _garantir_normalizado(dir_uf: Path, pdf_local: str, pasta_texto: str = "texto_normalizado",
                          versao: str = "v1") -> Path | None:
    stem = Path(pdf_local).stem
    normalizado = dir_uf / pasta_texto / f"{stem}.txt"
    if normalizado.exists():
        return normalizado
    original = dir_uf / "texto" / f"{stem}.txt"
    if not original.exists():
        return None
    normalizacao.normalizar_arquivo(original, normalizado, versao=versao)
    return normalizado


def consolidar(base: Path, anos, ufs, versao: str = "v1") -> int:
    cfg = Versao.de(versao)
    linhas: list[dict] = []
    colunas: list[str] = list(COLUNAS_PROPOSTAS)
    for ano in anos:
        for uf in ufs:
            caminho = base / "propostas_governo" / str(ano) / uf / cfg.pasta_saida / "propostas.csv"
            if caminho.exists():
                lidas = ler_csv(caminho)
                linhas.extend(lidas)
                for c in (lidas[0].keys() if lidas else []):
                    if c not in colunas:
                        colunas.append(c)
    nome = "propostas_segmentadas.csv" if versao == "v1" else f"propostas_segmentadas_{versao}.csv"
    escrever_csv(base / "propostas_governo" / nome, linhas, tuple(colunas))
    return len(linhas)


def consultar(base: Path, ano: int, uf: str, sq: str) -> str:
    """Texto original (versão extraída) e propostas segmentadas de um candidato."""
    dir_uf = base / "propostas_governo" / str(ano) / uf
    docs = [d for d in _documentos_governador(dir_uf) if d["sq_candidato"] == sq]
    if not docs:
        return f"candidatura {sq} não encontrada como governador em {uf}/{ano}"
    doc = docs[0]
    stem = Path(doc["pdf_local"]).stem
    partes = [f"{doc['nome_candidato']} | {uf}/{ano} | SQ {sq} | documento {stem}", ""]
    original = dir_uf / "texto" / f"{stem}.txt"
    partes.append("== TEXTO ORIGINAL (extraído) ==")
    partes.append(original.read_text(encoding="utf-8") if original.exists() else "(sem texto)")
    partes.append("")
    csv_prop = dir_uf / "segmentacao" / "propostas.csv"
    props = [l for l in ler_csv(csv_prop) if l["documento_id"] == stem] if csv_prop.exists() else []
    partes.append(f"== PROPOSTAS SEGMENTADAS ({len(props)}) ==")
    for i, p in enumerate(props, 1):
        rev = " [REVISAR]" if p["precisa_revisao"] == "sim" else ""
        partes.append(f"{i:03d} {p['proposta_id']} p.{p['pagina_inicial']}-{p['pagina_final']} "
                      f"{p['status_segmentacao']}{rev}")
        partes.append(f"    {p['texto_original']}")
        if p["justificativa"]:
            partes.append(f"    justificativa: {p['justificativa']}")
    return "\n".join(partes)


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Segmenta as propostas de governo (SP e BA).")
    sub = p.add_subparsers(dest="comando", required=True)
    s = sub.add_parser("segmentar", help="gera propostas a partir dos textos normalizados")
    s.add_argument("--anos", nargs="+", type=int, default=list(config.ANOS))
    s.add_argument("--ufs", nargs="+", default=list(config.UFS))
    s.add_argument("--dir-dados", type=Path, default=config.DIR_DADOS_PADRAO)
    s.add_argument("--versao", choices=("v1", "v2"), default="v1")
    a = sub.add_parser("amostra", help="gera planilha de revisão humana (propostas e descartados)")
    a.add_argument("--n-propostas", type=int, default=100)
    a.add_argument("--n-descartados", type=int, default=50)
    a.add_argument("--seed", type=int, default=20260501)
    a.add_argument("--saida", type=Path, required=True)
    a.add_argument("--dir-dados", type=Path, default=config.DIR_DADOS_PADRAO)
    v = sub.add_parser("avaliar", help="calcula métricas a partir da planilha revisada")
    v.add_argument("--revisao", type=Path, required=True)
    c = sub.add_parser("consultar", help="mostra texto original e propostas de um candidato")
    c.add_argument("--ano", type=int, required=True)
    c.add_argument("--uf", required=True)
    c.add_argument("--sq", required=True)
    c.add_argument("--dir-dados", type=Path, default=config.DIR_DADOS_PADRAO)
    return p


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.comando == "avaliar":
        from ..manifesto import ler_csv as _ler
        from . import avaliacao

        metricas = avaliacao.resumir(_ler(args.revisao))
        for chave, valor in metricas.items():
            print(f"{chave}: {valor}")
        return 0

    base = args.dir_dados.resolve()
    if args.comando == "amostra":
        from . import avaliacao

        props = ler_csv(base / "propostas_governo" / "propostas_segmentadas.csv")
        descs: list[dict] = []
        for ano in config.ANOS:
            for uf in config.UFS:
                cam = base / "propostas_governo" / str(ano) / uf / "segmentacao" / "trechos_descartados.csv"
                if cam.exists():
                    descs.extend(ler_csv(cam))
        linhas = avaliacao.amostra(props, descs, n_propostas=args.n_propostas,
                                   n_descartados=args.n_descartados, seed=args.seed)
        escrever_csv(args.saida, linhas, avaliacao.COLUNAS_AMOSTRA)
        print(f"{len(linhas)} linha(s) para revisão em {args.saida}")
        return 0

    if args.comando == "consultar":
        print(consultar(base, args.ano, args.uf.upper(), args.sq))
        return 0

    from ..coletor import _configurar_log

    _configurar_log(base / "logs")
    anos = sorted(set(args.anos))
    ufs = [u.upper() for u in args.ufs]
    classificador = HeuristicaLocal()
    totais: Counter = Counter()
    resumo_linhas = []
    for ano in anos:
        for uf in ufs:
            r = segmentar_recorte(ano, uf, base, classificador, versao=args.versao)
            for rel in r["relatorio"]:
                totais[rel["status"]] += 1
                totais["propostas"] += int(rel["propostas"] or 0)
                totais["revisao"] += int(rel["revisao"] or 0)
            resumo_linhas.append((ano, uf, r))
    total = consolidar(base, config.ANOS, config.UFS, versao=args.versao)

    print(f"\n{'ano':<5} {'uf':<3} {'docs':>5} {'ok':>4} {'erro':>5} {'propostas':>10} {'revisao':>8} {'descartadas':>12}")
    print("-" * 56)
    for ano, uf, r in resumo_linhas:
        rel = r["relatorio"]
        ok = sum(1 for x in rel if x["status"] == "OK")
        erro = sum(1 for x in rel if x["status"] == "ERRO")
        props = sum(int(x["propostas"] or 0) for x in rel)
        rev = sum(int(x["revisao"] or 0) for x in rel)
        print(f"{ano:<5} {uf:<3} {len(rel):>5} {ok:>4} {erro:>5} {props:>10} {rev:>8} {r['descartados']:>12}")
    print(f"\nconsolidado: {total} proposta(s) em {base / 'propostas_governo' / 'propostas_segmentadas.csv'}")
    return 1 if totais["ERRO"] else 0


if __name__ == "__main__":
    sys.exit(main())
