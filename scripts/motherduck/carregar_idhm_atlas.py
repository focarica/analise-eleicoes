#!/usr/bin/env python3
"""Carrega IDHM municipal do Atlas 2013 (censos 2000 e 2010)."""
from __future__ import annotations

import csv
import os
from pathlib import Path
import tempfile
import time

import duckdb
import requests

DATABASE = "BDR-TSE"
URL = "https://raw.githubusercontent.com/diego-s-fernandes/Idp_big_data/master/atlas2013_dadosbrutos_pt.xlsx"
ATLAS_ORIGINAL = "http://atlasbrasil.org.br/2013/data/rawData/atlas2013_dadosbrutos_pt.xlsx"
UFS = ("AC", "AL", "BA", "DF", "RO", "SP")
YEARS = (2000, 2010)


def main() -> None:
    if not os.environ.get("MOTHERDUCK_TOKEN"):
        raise RuntimeError("Configure MOTHERDUCK_TOKEN com permissão de escrita")
    started = time.monotonic()
    raw_path = Path(tempfile.gettempdir()) / "atlas2013_dadosbrutos_pt.xlsx"
    if not raw_path.exists() or raw_path.stat().st_size < 1_000_000:
        response = requests.get(URL, timeout=(30, 180))
        response.raise_for_status()
        if len(response.content) < 1_000_000:
            raise RuntimeError("Download da planilha Atlas parece incompleto")
        raw_path.write_bytes(response.content)

    con = duckdb.connect(f"md:{DATABASE}?attach_mode=single")
    expected = {str(code).zfill(7) for code, in con.execute(f"""
        SELECT cd_municipio_ibge FROM public.municipio
        WHERE sg_uf IN {UFS} AND cd_municipio_ibge IS NOT NULL
    """).fetchall()}
    if len(expected) < 1200:
        raise RuntimeError(f"Dimensão municipal incompleta: {len(expected)}")

    source = str(raw_path).replace("'", "''")
    con.execute(f"""
        CREATE OR REPLACE TEMP TABLE atlas_stage AS
        SELECT lpad(CAST(CODMUN7 AS VARCHAR), 7, '0') AS codmun7,
               TRY_CAST(ANO AS SMALLINT) AS ano_referencia,
               TRY_CAST(IDHM AS DECIMAL(5,3)) AS idhm,
               TRY_CAST(IDHM_R AS DECIMAL(5,3)) AS idhm_r,
               TRY_CAST(IDHM_L AS DECIMAL(5,3)) AS idhm_l,
               TRY_CAST(IDHM_E AS DECIMAL(5,3)) AS idhm_e
        FROM read_xlsx('{source}', sheet='MUN 91-00-10', header=true)
        WHERE TRY_CAST(ANO AS INTEGER) IN {YEARS}
    """)
    local_rows = con.execute("""
        SELECT codmun7, ano_referencia, idhm, idhm_r, idhm_l, idhm_e
        FROM atlas_stage WHERE codmun7 IN (SELECT unnest(?))
        ORDER BY codmun7, ano_referencia
    """, [sorted(expected)]).fetchall()
    keys = {(r[0], r[1]) for r in local_rows}
    duplicates = len(keys) != len(local_rows)
    wanted = {(code, year) for code in expected for year in YEARS}
    missing = wanted - keys
    extra = keys - wanted
    if duplicates or missing or extra or any(r[2] is None for r in local_rows):
        raise RuntimeError(f"Atlas divergente: duplicados={duplicates}, faltam={len(missing)}, sobram={len(extra)}, IDHM nulo={sum(r[2] is None for r in local_rows)}; exemplos={list(missing)[:5]}")

    stage_path = Path(tempfile.gettempdir()) / "idhm_atlas.csv"
    with stage_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f, delimiter=";")
        writer.writerow(["codmun7", "ano_referencia", "idhm", "idhm_r", "idhm_l", "idhm_e"])
        writer.writerows(local_rows)
    stage_csv = str(stage_path).replace("'", "''")
    con.execute("""
        CREATE TABLE IF NOT EXISTS public.fato_idhm_atlas (
            codmun7 VARCHAR(7) NOT NULL, ano_referencia SMALLINT NOT NULL,
            idhm DECIMAL(5,3), idhm_r DECIMAL(5,3), idhm_l DECIMAL(5,3), idhm_e DECIMAL(5,3),
            PRIMARY KEY (codmun7, ano_referencia)
        )
    """)
    con.execute(f"""
        CREATE OR REPLACE TEMP TABLE idhm_upload AS
        SELECT codmun7::VARCHAR(7), ano_referencia::SMALLINT,
               idhm::DECIMAL(5,3), idhm_r::DECIMAL(5,3), idhm_l::DECIMAL(5,3), idhm_e::DECIMAL(5,3)
        FROM read_csv('{stage_csv}', delim=';', header=true, all_varchar=true)
    """)
    con.execute("BEGIN TRANSACTION")
    try:
        con.execute(f"DELETE FROM public.fato_idhm_atlas WHERE codmun7 IN (SELECT unnest(?))", [sorted(expected)])
        con.execute("INSERT INTO public.fato_idhm_atlas SELECT * FROM idhm_upload")
        con.execute("COMMIT")
    except Exception:
        con.execute("ROLLBACK")
        raise
    print({"rows": len(local_rows), "municipalities": len(expected), "years": list(YEARS),
           "official_source_original": ATLAS_ORIGINAL, "download_copy": URL,
           "xlsx_bytes": raw_path.stat().st_size, "seconds": round(time.monotonic()-started, 2)}, flush=True)
    con.close()


if __name__ == "__main__":
    main()
