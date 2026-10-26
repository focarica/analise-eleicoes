#!/usr/bin/env python3
"""Agrega marginais municipais do perfil do eleitorado TSE (2004–2024)."""
from __future__ import annotations

import csv
import io
import os
from pathlib import Path
import tempfile
import time
import zipfile

import duckdb
import requests

YEARS = (2004, 2006, 2008, 2010, 2012, 2014, 2016, 2018, 2020, 2022, 2024)
UFS = {"AC", "AL", "BA", "DF", "RO", "SP"}
ROOT = "https://cdn.tse.jus.br/estatistica/sead/odsele/perfil_eleitorado"
DIMENSIONS = {
    "FAIXA_ETARIA": ("DS_FAIXA_ETARIA",),
    "GENERO": ("DS_GENERO",),
    "ESTADO_CIVIL": ("DS_ESTADO_CIVIL",),
    "GRAU_INSTRUCAO": ("DS_GRAU_ESCOLARIDADE", "DS_GRAU_INSTRUCAO"),
}


def normalize_row(row: dict[str, str]) -> dict[str, str]:
    return {k.strip().lstrip("\ufeff").upper(): (v or "").strip() for k, v in row.items()}


def field(normalized: dict[str, str], aliases: tuple[str, ...]) -> str:
    for alias in aliases:
        if alias in normalized:
            return normalized[alias]
    return ""


def selected_members(names: list[str], year: int) -> list[str]:
    csvs = [n for n in names if n.lower().endswith(".csv")]
    if year <= 2016 or year in (2018, 2020):
        target = f"PERFIL_ELEITORADO_{year}.CSV"
        return [n for n in csvs if n.rsplit("/", 1)[-1].upper() == target]
    return [n for n in csvs if any(n.upper().endswith(f"_{uf}.CSV") for uf in UFS)]


def download(year: int, path: Path) -> int:
    url = f"{ROOT}/perfil_eleitorado_{year}.zip"
    print(f"Baixando {year}: {url}", flush=True)
    total = 0
    with requests.get(url, stream=True, timeout=(30, 300)) as response:
        response.raise_for_status()
        with path.open("wb") as output:
            for block in response.iter_content(1024 * 1024):
                if block:
                    output.write(block)
                    total += len(block)
    return total


def main() -> None:
    if not os.environ.get("MOTHERDUCK_TOKEN"):
        raise RuntimeError("Configure MOTHERDUCK_TOKEN com permissão de escrita")
    started = time.monotonic()
    work = Path(tempfile.gettempdir()) / "tse_perfil_eleitorado_2004_2024"
    work.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect("md:BDR-TSE?attach_mode=single")
    municipalities = con.execute("""
        SELECT cd_municipio_tse, cd_municipio_ibge, sg_uf
        FROM public.municipio
        WHERE sg_uf IN ('AC','AL','BA','DF','RO','SP')
          AND cd_municipio_ibge IS NOT NULL
    """).fetchall()
    crosswalk = {str(tse).strip(): (str(ibge).zfill(7), uf) for tse, ibge, uf in municipalities}
    expected = len(crosswalk)
    if expected < 1200:
        raise RuntimeError(f"Correspondência municipal insuficiente: {expected}")

    counts: dict[tuple[int, str, str, str], int] = {}
    unmapped: dict[tuple[str, str, str], int] = {}
    reports = []
    for year in YEARS:
        archive_path = work / f"perfil_eleitorado_{year}.zip"
        if not archive_path.exists():
            received = download(year, archive_path)
        else:
            received = archive_path.stat().st_size
        with zipfile.ZipFile(archive_path) as archive:
            members = selected_members(archive.namelist(), year)
            if not members:
                raise RuntimeError(f"Nenhum arquivo de perfil compatível em {archive_path.name}")
            rows_read = 0
            municipalities_with_source_rows: set[str] = set()
            for member in members:
                with archive.open(member) as binary:
                    reader = csv.DictReader(io.TextIOWrapper(binary, encoding="latin1", newline=""), delimiter=";")
                    for row in reader:
                        rows_read += 1
                        source = normalize_row(row)
                        uf = field(source, ("SG_UF", "UF")).upper()
                        # Alguns arquivos antigos removem zeros à esquerda do
                        # código TSE (ex.: AC 01007 aparece como 1007).
                        code = field(source, ("CD_MUNICIPIO", "CODIGO_MUNICIPIO")).zfill(5)
                        mapped = crosswalk.get(code)
                        if not mapped or uf not in UFS or mapped[1] != uf:
                            if uf in UFS:
                                key = (uf, code, field(source, ("NM_MUNICIPIO", "NOME_MUNICIPIO")))
                                unmapped[key] = unmapped.get(key, 0) + 1
                            continue
                        municipalities_with_source_rows.add(mapped[0])
                        qty_text = field(source, ("QT_ELEITORES", "QT_ELEITORES_PERFIL"))
                        if not qty_text.isdigit():
                            continue
                        qty = int(qty_text)
                        if qty < 0:
                            raise RuntimeError(f"Quantidade negativa em {year}/{member}")
                        for dimension, aliases in DIMENSIONS.items():
                            category = field(source, aliases)
                            if category:
                                key = (year, mapped[0], dimension, category)
                                counts[key] = counts.get(key, 0) + qty
            # Reading every selected member to EOF also verifies ZIP CRC.
        age_municipalities = {city for y, city, dim, _ in counts if y == year and dim == "FAIXA_ETARIA"}
        if unmapped:
            print(f"{year}: códigos/nomes da fonte sem correspondência: "
                  f"{[(uf, code, name, n) for (uf, code, name), n in sorted(unmapped.items())]}", flush=True)
            raise RuntimeError(f"Códigos TSE sem crosswalk em {year}; não publicar carga parcial")
        if len(municipalities_with_source_rows) < expected:
            missing = [(str(tse), str(ibge).zfill(7), uf) for tse, ibge, uf in municipalities
                       if str(ibge).zfill(7) not in municipalities_with_source_rows]
            print(f"{year}: arquivo não publicou linhas para {len(missing)}/{expected} municípios: {missing}", flush=True)
        if len(age_municipalities) < expected:
            print(f"{year}: faixa etária publicada para {len(age_municipalities)}/{expected} municípios; "
                  "não serão inventadas categorias ausentes.", flush=True)
        dimensions = {dim: sum(1 for y, _, d, _ in counts if y == year and d == dim) for dim in DIMENSIONS}
        reports.append({"year": year, "zip_bytes": received, "files": len(members), "source_rows": rows_read,
                        "municipalities_source": len(municipalities_with_source_rows),
                        "municipalities_age": len(age_municipalities), "rows_by_dimension": dimensions})
        print(f"{year}: {rows_read:,} linhas da fonte; {dimensions}", flush=True)

    stage_path = work / "perfil_marginal.csv"
    with stage_path.open("w", encoding="utf-8", newline="") as output:
        writer = csv.writer(output, delimiter=";")
        writer.writerow(["ano_eleicao", "cd_municipio_ibge", "tp_dimensao", "ds_categoria", "qt_eleitores"])
        for (year, city, dimension, category), quantity in sorted(counts.items()):
            writer.writerow([year, city, dimension, category, quantity])
    con.execute(f"""
        CREATE OR REPLACE TEMP TABLE stg_perfil_marginal AS
        SELECT ano_eleicao::INTEGER AS ano_eleicao,
               cd_municipio_ibge::VARCHAR AS cd_municipio_ibge,
               tp_dimensao::VARCHAR AS tp_dimensao,
               ds_categoria::VARCHAR AS ds_categoria,
               qt_eleitores::BIGINT AS qt_eleitores
        FROM read_csv('{stage_path}', delim=';', header=true, all_varchar=true)
    """)
    con.execute("BEGIN TRANSACTION")
    try:
        con.execute("""
            DELETE FROM public.fato_perfil_eleitorado
            WHERE cd_municipio_ibge IN (SELECT cd_municipio_ibge FROM public.municipio WHERE sg_uf IN ('AC','AL','BA','DF','RO','SP'))
              AND ano_eleicao IN (2004,2006,2008,2010,2012,2014,2016,2018,2020,2022,2024)
        """)
        con.execute("INSERT INTO public.fato_perfil_eleitorado SELECT * FROM stg_perfil_marginal")
        # Keep the existing application query stable while exposing the full
        # marginal fact in its DER entity.
        legacy_is_view = con.execute("""
            SELECT COUNT(*) FROM duckdb_views()
            WHERE database_name='BDR-TSE' AND schema_name='public' AND view_name='perfil_eleitorado'
        """).fetchone()[0] > 0
        con.execute("DROP VIEW public.perfil_eleitorado" if legacy_is_view else "DROP TABLE public.perfil_eleitorado")
        con.execute("""
            CREATE VIEW public.perfil_eleitorado AS
            SELECT f.ano_eleicao, m.cd_municipio_tse,
                   f.ds_categoria AS ds_faixa_etaria, f.qt_eleitores
            FROM public.fato_perfil_eleitorado f
            JOIN public.municipio m USING (cd_municipio_ibge)
            WHERE f.tp_dimensao='FAIXA_ETARIA'
        """)
        bad = con.execute("""
            SELECT COUNT(*) FROM (
              SELECT ano_eleicao, cd_municipio_ibge, tp_dimensao, ds_categoria
              FROM public.fato_perfil_eleitorado
              GROUP BY ALL HAVING COUNT(*) > 1
            )
        """).fetchone()[0]
        if bad:
            raise RuntimeError(f"Chaves duplicadas no perfil marginal: {bad}")
        con.execute("COMMIT")
    except Exception:
        con.execute("ROLLBACK")
        raise
    print({"rows": len(counts), "years": reports, "seconds": round(time.monotonic()-started, 2)}, flush=True)
    con.close()


if __name__ == "__main__":
    main()
