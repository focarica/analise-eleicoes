#!/usr/bin/env python3
"""Recupera DS_ORIGEM_DESPESA de 2018/2020/2022/2024, sem recarregar o DER.

Dependências: duckdb e requests. Por padrão só prepara e reconcilia; --apply
atualiza categorias e cria as views da Q9, dentro de uma transação.
Os dados e o relatório ficam fora do repositório, no diretório de trabalho.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import importlib.util
import json
import os
from pathlib import Path
import struct
import sys
import time
import zipfile
import zlib

import duckdb
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

ROOT = Path(__file__).resolve().parents[2]
YEARS = (2018, 2020, 2022, 2024)
UFS = {"AC", "AL", "BA", "DF", "RO", "SP", "BR"}
SLUGS = {y: f"prestacao-de-contas-eleitorais-{y}" for y in YEARS}
SLUGS[2022] = "dadosabertos-tse-jus-br-dataset-prestacao-de-contas-eleitorais-2022"
KINDS = ("receitas_candidatos", "despesas_contratadas_candidatos", "despesas_pagas_candidatos")


def session():
    s = requests.Session()
    s.headers.update({"User-Agent": "Carga-TSE-Categorias/1.0", "Accept-Encoding": "identity"})
    s.mount("https://", HTTPAdapter(max_retries=Retry(total=4, backoff_factor=1,
        status_forcelist=[429, 500, 502, 503, 504])))
    return s


def acquire(year, root):
    """Baixa apenas membros relevantes por HTTP Range; confere CRC original.

    O ZIP local é um subconjunto sem compressão, não uma cópia do ZIP oficial.
    Nunca misturar BRASIL com os membros estaduais.
    """
    path = root / f"prestacao_de_contas_eleitorais_candidatos_{year}.zip"
    manifest_path = root / f"fonte_{year}.json"
    if path.exists() and manifest_path.exists():
        return json.loads(manifest_path.read_text())
    s = session()
    result = s.get("https://dadosabertos.tse.jus.br/api/3/action/package_show",
                   params={"id": SLUGS[year]}, timeout=60).json()
    if not result.get("success"):
        raise RuntimeError(f"Catálogo indisponível: {year}")
    urls = [r["url"] for r in result["result"]["resources"]
            if f"/prestacao_de_contas_eleitorais_candidatos_{year}.zip" in r.get("url", "")]
    if len(urls) != 1:
        raise RuntimeError(f"Recurso de candidatos ambíguo: {year}")
    url = urls[0]
    tail_response = s.get(url, headers={"Range": "bytes=-65536"}, timeout=60)
    if tail_response.status_code != 206:
        raise RuntimeError("CDN não aceitou HTTP Range")
    tail = tail_response.content
    validator = tail_response.headers.get("ETag") or tail_response.headers.get("Last-Modified")
    size = int(tail_response.headers["Content-Range"].split("/")[-1])
    transferred = len(tail)

    def response(start, end, stream=False):
        nonlocal transferred
        headers = {"Range": f"bytes={start}-{end}"}
        if validator:
            headers["If-Range"] = validator
        r = s.get(url, headers=headers, timeout=(30, 180), stream=stream)
        if r.status_code != 206 or r.headers.get("Content-Range") != f"bytes {start}-{end}/{size}":
            r.close()
            raise RuntimeError(f"Fonte alterada ou Range incorreto durante leitura: {year}")
        transferred += end - start + 1
        return r

    e = struct.unpack_from("<4s4H2IH", tail, tail.rfind(b"PK\x05\x06"))
    if e[5] == 0xFFFFFFFF or e[6] == 0xFFFFFFFF:
        raise RuntimeError("ZIP64 requer outro leitor")
    central = response(e[6], e[6] + e[5] - 1).content
    entries = []
    pos = 0
    while central[pos:pos + 4] == b"PK\x01\x02":
        h = struct.unpack_from("<4s6H3I5H2I", central, pos)
        name = central[pos + 46:pos + 46 + h[10]].decode("utf-8" if h[3] & 2048 else "cp437")
        base = name.rsplit("/", 1)[-1]
        if any(k in base.lower() for k in KINDS) and "doador_originario" not in base.lower() \
                and any(base.upper().endswith(f"_{uf}.CSV") for uf in UFS):
            entries.append((name, h))
        pos += 46 + h[10] + h[11] + h[12]
    if not entries:
        raise RuntimeError(f"Sem membros estaduais: {year}")
    metadata = []
    partial = path.with_suffix(".partial")
    with zipfile.ZipFile(partial, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as out:
        for name, h in entries:
            local = struct.unpack("<4s5H3I2H", response(h[16], h[16] + 29).content)
            start = h[16] + 30 + local[9] + local[10]
            if h[4] not in (0, 8):
                raise RuntimeError(f"Compressão ZIP não suportada: {h[4]}")
            decompressor = zlib.decompressobj(-15) if h[4] == 8 else None
            crc = 0
            uncompressed = compressed = 0
            with response(start, start + h[8] - 1, stream=True) as r, \
                    out.open(name, "w", force_zip64=True) as f:
                for block in r.iter_content(1024 * 1024):
                    compressed += len(block)
                    data = decompressor.decompress(block) if decompressor else block
                    f.write(data)
                    crc = zlib.crc32(data, crc)
                    uncompressed += len(data)
                if decompressor:
                    data = decompressor.flush()
                    f.write(data)
                    crc = zlib.crc32(data, crc)
                    uncompressed += len(data)
            if compressed != h[8] or uncompressed != h[9] or crc != h[7] \
                    or (decompressor and not decompressor.eof):
                raise RuntimeError(f"CRC/tamanho inválido: {name}")
            metadata.append({"member": name, "compressed_bytes": compressed,
                             "bytes": uncompressed, "crc32": f"{crc:08x}"})
            print(f"{year}: {name.rsplit('/', 1)[-1]} CRC OK", flush=True)
    partial.replace(path)
    manifest = {"year": year, "url": url, "validator": validator, "remote_zip_bytes": size,
                "download_bytes": transferred, "local_subset_bytes": path.stat().st_size,
                "members": metadata}
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    return manifest


def load_token(env_path):
    # Ler só a variável necessária, sem imprimir valores ou executar o .env.
    if not os.environ.get("motherduck_token"):
        token = os.environ.get("MOTHERDUCK_TOKEN")
        if not token and env_path and env_path.exists():
            for line in env_path.read_text().splitlines():
                key, sep, value = line.partition("=")
                if sep and key.strip() in ("MOTHERDUCK_TOKEN", "motherduck_token"):
                    token = value.strip().strip("\"'")
        if not token:
            raise RuntimeError("Configure MOTHERDUCK_TOKEN ou --env-file")
        os.environ["motherduck_token"] = token


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--work-dir", type=Path, default=Path("/tmp/tse_categorias_2018_2024"))
    parser.add_argument("--env-file", type=Path)
    parser.add_argument("--database", default="BDR-TSE")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--acquire-only", action="store_true")
    args = parser.parse_args()
    started = time.monotonic()
    args.work_dir.mkdir(parents=True, exist_ok=True)
    archives = args.work_dir / "archives"
    archives.mkdir(exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        manifests = list(pool.map(lambda y: acquire(y, archives), YEARS))
    if args.acquire_only:
        return
    stage = args.work_dir / "stage"
    if not (stage / "manifest.json").exists():
        spec = importlib.util.spec_from_file_location("normalizer", ROOT / "scripts/normalizar_dados_tse.py")
        normalizer = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(normalizer)
        normalizer.SOURCES = ("prestacao_de_contas_eleitorais_candidatos",)
        old_argv = sys.argv
        try:
            sys.argv = ["normalizer", "--zip-dir", str(archives), "--output", str(stage)]
            normalizer.main()
        finally:
            sys.argv = old_argv
    load_token(args.env_file)
    con = duckdb.connect("md:")
    db = '"' + args.database.replace('"', '""') + '"'
    con.execute(f"USE {db}")
    # Staging estritamente TEMP; nenhuma nova tabela publicada.
    con.execute("CREATE TEMP TABLE categorias_raw (ano_eleicao VARCHAR, sq_candidato VARCHAR, "
                "id_linha_origem VARCHAR, ds_despesa VARCHAR, ds_categoria_despesa VARCHAR, "
                "vr_pago VARCHAR, source_file VARCHAR)")
    con.execute("COPY categorias_raw FROM ? (DELIMITER ';', HEADER FALSE, NULL '')",
                [str(stage / "despesa_candidato.csv")])
    con.execute("""
        CREATE TEMP TABLE categorias_fonte AS
        SELECT ano_eleicao::INTEGER AS ano_eleicao, sq_candidato::BIGINT AS sq_candidato,
               ROW_NUMBER() OVER (PARTITION BY ano_eleicao,sq_candidato ORDER BY id_linha_origem)::INTEGER AS id_despesa,
               COUNT(*) OVER (PARTITION BY ano_eleicao,sq_candidato,
                   split_part(id_linha_origem,':',1),split_part(id_linha_origem,':',2),
                   split_part(id_linha_origem,':',3)) AS repeticoes_chave_tse,
               CASE WHEN UPPER(TRIM(ds_despesa)) IN ('','#NULO','#NULO#','#NE','-1','-3','-4','NÃO DIVULGÁVEL')
                    THEN NULL ELSE TRIM(ds_despesa) END AS ds_despesa,
               CASE WHEN UPPER(TRIM(vr_pago)) IN ('','#NULO','#NULO#','#NE','-1','-3','-4','NÃO DIVULGÁVEL')
                    THEN NULL WHEN CONTAINS(TRIM(vr_pago), ',') THEN
                    TRY_CAST(REPLACE(REPLACE(TRIM(vr_pago),'.',''),',','.') AS DECIMAL(14,2))
                    ELSE TRY_CAST(TRIM(vr_pago) AS DECIMAL(14,2)) END AS vr_pago,
               CASE WHEN UPPER(TRIM(ds_categoria_despesa)) IN ('','#NULO','#NULO#','#NE','-1','-3','-4','NÃO DIVULGÁVEL')
                    THEN NULL ELSE TRIM(ds_categoria_despesa) END AS categoria
        FROM categorias_raw;
        CREATE TEMP TABLE categorias_univocas AS
        SELECT ano_eleicao,sq_candidato,ds_despesa,vr_pago,MIN(categoria) AS categoria
        FROM categorias_fonte
        GROUP BY ano_eleicao,sq_candidato,ds_despesa,vr_pago
        HAVING COUNT(DISTINCT categoria)=1 AND COUNT(categoria)=COUNT(*);
        CREATE TEMP TABLE reparos_categoria AS
        SELECT d.ano_eleicao,d.sq_candidato,d.id_despesa,f.categoria,'assinatura_univoca' AS metodo
        FROM public.despesas_pagas d JOIN categorias_univocas f
          ON d.ano_eleicao=f.ano_eleicao AND d.sq_candidato=f.sq_candidato
         AND d.ds_despesa IS NOT DISTINCT FROM f.ds_despesa
         AND d.vr_pago IS NOT DISTINCT FROM f.vr_pago;
        -- Fallback específico da carga MotherDuck: ID_DESPESA foi gerado
        -- por ROW_NUMBER ordenado por provider:SQ_DESPESA:parcela:hash.
        -- Uma chave TSE única independe do hash/data de geração do arquivo.
        -- Só recuperar por essa ordem quando TODOS os IDs, textos, valores
        -- e contagens da candidatura conferirem (não apenas a linha isolada).
        CREATE TEMP TABLE candidaturas_ordem_validada AS
        SELECT COALESCE(d.ano_eleicao,f.ano_eleicao) AS ano_eleicao,
               COALESCE(d.sq_candidato,f.sq_candidato) AS sq_candidato
        FROM public.despesas_pagas d FULL JOIN categorias_fonte f USING(ano_eleicao,sq_candidato,id_despesa)
        GROUP BY 1,2
        HAVING BOOL_AND(d.id_despesa IS NOT NULL AND f.id_despesa IS NOT NULL
                    AND d.ds_despesa IS NOT DISTINCT FROM f.ds_despesa
                    AND d.vr_pago IS NOT DISTINCT FROM f.vr_pago);
        INSERT INTO reparos_categoria
        SELECT f.ano_eleicao,f.sq_candidato,f.id_despesa,f.categoria,'ordem_integral_validada'
        FROM categorias_fonte f JOIN candidaturas_ordem_validada c USING(ano_eleicao,sq_candidato)
        WHERE f.repeticoes_chave_tse=1 AND f.categoria IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM reparos_categoria r
              WHERE r.ano_eleicao=f.ano_eleicao AND r.sq_candidato=f.sq_candidato
                AND r.id_despesa=f.id_despesa);
    """)
    before = con.execute("SELECT ano_eleicao,COUNT(*),COUNT(ds_categoria_despesa),SUM(vr_pago) "
                         "FROM public.despesas_pagas GROUP BY 1 ORDER BY 1").fetchall()
    coverage = con.execute("""
        SELECT d.ano_eleicao,COUNT(*) AS existentes,COUNT(r.id_despesa) AS reconciliados,
               COUNT(*) FILTER (WHERE r.id_despesa IS NULL) AS sem_categoria_univoca
        FROM public.despesas_pagas d LEFT JOIN reparos_categoria r USING(ano_eleicao,sq_candidato,id_despesa)
        GROUP BY 1 ORDER BY 1
    """).fetchall()
    print("Cobertura (ano, existentes, reconciliados, não reconciliados):", coverage, flush=True)
    methods = con.execute("SELECT metodo,COUNT(*) FROM reparos_categoria GROUP BY 1 ORDER BY 1").fetchall()
    print("Métodos de recuperação:", methods, flush=True)
    report = {"sources": manifests, "before": before, "coverage": coverage, "methods": methods, "applied": False}
    if args.apply:
        if not con.execute("SELECT COUNT(*) FROM reparos_categoria").fetchone()[0]:
            raise RuntimeError("Nenhuma categoria reconciliada; atualização cancelada")
        con.execute("BEGIN TRANSACTION")
        try:
            con.execute("""
                UPDATE public.despesas_pagas d SET ds_categoria_despesa=r.categoria
                FROM reparos_categoria r
                WHERE d.ano_eleicao=r.ano_eleicao AND d.sq_candidato=r.sq_candidato
                  AND d.id_despesa=r.id_despesa
            """)
            con.execute((ROOT / "sql/motherduck/03_views_propaganda.sql").read_text())
            after = con.execute("SELECT ano_eleicao,COUNT(*),COUNT(ds_categoria_despesa),SUM(vr_pago) "
                                "FROM public.despesas_pagas GROUP BY 1 ORDER BY 1").fetchall()
            if [(r[0],r[1],r[3]) for r in before] != [(r[0],r[1],r[3]) for r in after]:
                raise RuntimeError("Quantidade ou soma financeira mudou; rollback")
            con.execute("COMMIT")
            report.update({"applied": True, "after": after})
        except Exception:
            con.execute("ROLLBACK")
            raise
    report["seconds"] = round(time.monotonic() - started, 2)
    (args.work_dir / "reconciliacao.json").write_text(json.dumps(report, default=str, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({k:v for k,v in report.items() if k != "sources"}, default=str, ensure_ascii=False, indent=2))
    con.close()


if __name__ == "__main__":
    main()
