#!/usr/bin/env python3
"""Carrega série municipal do PIB e população IBGE para as UFs do projeto."""
from __future__ import annotations

import csv
import os
from pathlib import Path
import tempfile
import time

import duckdb
import requests

DATABASE = "BDR-TSE"
UFS = {"AC": "12", "AL": "27", "BA": "29", "DF": "53", "RO": "11", "SP": "35"}
SIDRA = "https://apisidra.ibge.gov.br/values"


def number(value: str):
    value = (value or "").strip()
    if value in {"", "-", "...", "X", ".."}:
        return None
    # API SIDRA returns decimal point and no thousands separator (e.g. 7.74).
    # Accept Brazilian-formatted strings too, should a source file use them.
    if "," in value and "." in value:
        value = value.replace(".", "").replace(",", ".")
    else:
        value = value.replace(",", ".")
    try:
        return float(value)
    except ValueError:
        return None


def sidra(path: str) -> list[dict[str, str]]:
    response = requests.get(f"{SIDRA}/{path}", params={"formato": "json"}, timeout=(30, 180))
    response.raise_for_status()
    data = response.json()
    if not isinstance(data, list) or len(data) < 2:
        raise RuntimeError(f"Resposta SIDRA vazia ou inválida: {path}")
    return data[1:]


def getrow(row: dict[str, str], dimension: str) -> str:
    return row.get(f"D{dimension}C", "")


def fetch_table(con, codes_by_uf, table, variables, periods, filters=""):
    result = {}
    for uf, codes in codes_by_uf.items():
        print(f"SIDRA tabela {table}, UF {uf}: {len(codes)} municípios", flush=True)
        # Keep requests well below URL length limits for UFs with hundreds of cities.
        for start in range(0, len(codes), 100):
            subset = codes[start:start + 100]
            joined_codes = ",".join(subset)
            path = f"t/{table}/n6/{joined_codes}/v/{variables}/p/{periods}{filters}"
            for row in sidra(path):
                municipality = getrow(row, 1).zfill(7)
                if municipality in subset:
                    yield municipality, row


def main() -> None:
    if not os.environ.get("MOTHERDUCK_TOKEN"):
        raise RuntimeError("Configure MOTHERDUCK_TOKEN com permissão de escrita")
    started = time.monotonic()
    con = duckdb.connect(f"md:{DATABASE}?attach_mode=single")
    municipalities = con.execute("""
        SELECT cd_municipio_ibge, sg_uf FROM public.municipio
        WHERE sg_uf IN ('AC','AL','BA','DF','RO','SP') AND cd_municipio_ibge IS NOT NULL
    """).fetchall()
    codes_by_uf: dict[str, list[str]] = {uf: [] for uf in UFS}
    for code, uf in municipalities:
        code = str(code).zfill(7)
        if str(code)[:2] != UFS[uf]:
            raise RuntimeError(f"Código IBGE e UF divergem: {code}/{uf}")
        codes_by_uf[uf].append(code)
    expected_codes = {code for codes in codes_by_uf.values() for code in codes}
    if len(expected_codes) < 1200:
        raise RuntimeError(f"Dimensão municipal incompleta: {len(expected_codes)}")

    # Mantém todos os campos definidos no fato; cada fonte só preenche os que publica.
    values: dict[tuple[str, int], dict[str, object]] = {}
    def record(code, year):
        return values.setdefault((code, year), {"populacao": None, "tipo_populacao": None,
            "pib": None, "pib_per_capita": None, "renda_domiciliar_per_capita": None,
            "area_km2": None, "densidade_hab_km2": None, "populacao_jovem": None,
            "porcentagem_analfabetismo": None, "porcentagem_superior": None,
            "vab_agropecuaria": None, "vab_industria": None, "vab_servicos": None,
            "vab_administracao_publica": None, "perfil_municipio": None, "fontes": set()})

    # Tabela 5938: PIB e componentes do VAB. O PIB per capita vem da tabela
    # 6784 (variável 9812), não da tabela 5938.
    pib_vars = {"37": "pib", "513": "vab_agropecuaria",
                "517": "vab_industria", "6575": "vab_servicos",
                "525": "vab_administracao_publica"}
    for code, row in fetch_table(con, codes_by_uf, 5938, ",".join(pib_vars), "2002-2023"):
        year_text = getrow(row, 3)
        variable = getrow(row, 2)
        if not year_text.isdigit() or variable not in pib_vars:
            continue
        year = int(year_text)
        target = pib_vars[variable]
        amount = number(row.get("V", ""))
        if amount is None:
            continue
        # PIB e VAB da tabela são divulgados em mil reais.
        amount *= 1000
        if target.startswith("vab_") and year > 2021:
            continue
        record(code, year)[target] = amount
        record(code, year)["fontes"].add("SIDRA:5938")

    # Tabela 6579: estimativas anuais de população, com referência em 1º de julho.
    for code, row in fetch_table(con, codes_by_uf, 6579, "9324", "2001-2024"):
        year_text = getrow(row, 3)
        quantity = number(row.get("V", ""))
        if year_text.isdigit() and quantity is not None:
            item = record(code, int(year_text))
            if int(year_text) not in (2010, 2022):
                item["populacao"] = int(quantity)
                item["tipo_populacao"] = "ESTIMADA"
                item["fontes"].add("SIDRA:6579")

    # Censo 2010 (tabela 202, totais de sexo e situação do domicílio).
    for code, row in fetch_table(con, codes_by_uf, 202, "93", "2010", "/c1/0/c2/0"):
        quantity = number(row.get("V", ""))
        if quantity is not None:
            item = record(code, 2010)
            item["populacao"] = int(quantity)
            item["tipo_populacao"] = "CENSITARIA"
            item["fontes"].add("SIDRA:202")

    # Censo 2022 (tabela 4709: população residente municipal).
    for code, row in fetch_table(con, codes_by_uf, 4709, "93", "2022"):
        quantity = number(row.get("V", ""))
        if quantity is not None:
            item = record(code, 2022)
            item["populacao"] = int(quantity)
            item["tipo_populacao"] = "CENSITARIA"
            item["fontes"].add("SIDRA:4709")

    # O Censo 2022 também publica área e densidade como variáveis próprias.
    for code, row in fetch_table(con, codes_by_uf, 4714, "6318,614", "2022"):
        variable = getrow(row, 2)
        amount = number(row.get("V", ""))
        if amount is None:
            continue
        item = record(code, 2022)
        if variable == "6318":
            item["area_km2"] = amount
        elif variable == "614":
            item["densidade_hab_km2"] = amount
        item["fontes"].add("SIDRA:4714")

    # Só publica município/ano com ao menos um indicador encontrado na fonte.
    rows = []
    for (code, year), item in sorted(values.items()):
        if not item["fontes"]:
            continue
        # SIDRA table 6784 has PIB per capita only at Brasil level, not municipal.
        # Derive a municipal value only where the same-year population is published.
        if item["pib"] is not None and item["populacao"] not in (None, 0):
            item["pib_per_capita"] = item["pib"] / item["populacao"]
            item["fontes"].add("DERIVADO: PIB/populacao")
        rows.append([code, year, item["populacao"], item["tipo_populacao"], item["pib"],
            item["pib_per_capita"], item["renda_domiciliar_per_capita"], item["area_km2"],
            item["densidade_hab_km2"], item["populacao_jovem"], item["porcentagem_analfabetismo"],
            item["porcentagem_superior"], item["vab_agropecuaria"], item["vab_industria"],
            item["vab_servicos"], item["vab_administracao_publica"], item["perfil_municipio"],
            ";".join(sorted(item["fontes"]))])
    stage = Path(tempfile.gettempdir()) / "ibge_socioeconomico_municipal.csv"
    with stage.open("w", encoding="utf-8", newline="") as output:
        writer = csv.writer(output, delimiter=";")
        writer.writerow(["cd_municipio_ibge", "ano", "populacao", "tipo_populacao", "pib", "pib_per_capita",
            "renda_domiciliar_per_capita", "area_km2", "densidade_hab_km2", "populacao_jovem",
            "porcentagem_analfabetismo", "porcentagem_superior", "vab_agropecuaria", "vab_industria",
            "vab_servicos", "vab_administracao_publica", "perfil_municipio", "fonte"])
        writer.writerows(rows)
    con.execute("""
        CREATE TABLE IF NOT EXISTS public.fato_socioeconomico_ibge (
            cd_municipio_ibge VARCHAR(7) NOT NULL, ano SMALLINT NOT NULL, populacao BIGINT,
            tipo_populacao VARCHAR(20), pib DECIMAL(18,2), pib_per_capita DECIMAL(16,2),
            renda_domiciliar_per_capita DECIMAL(16,2), area_km2 DECIMAL(12,3), densidade_hab_km2 DECIMAL(14,4),
            populacao_jovem BIGINT, porcentagem_analfabetismo DECIMAL(6,3), porcentagem_superior DECIMAL(6,3),
            vab_agropecuaria DECIMAL(18,2), vab_industria DECIMAL(18,2), vab_servicos DECIMAL(18,2),
            vab_administracao_publica DECIMAL(18,2), perfil_municipio VARCHAR(30), fonte VARCHAR(100),
            PRIMARY KEY (cd_municipio_ibge, ano)
        )
    """)
    con.execute(f"""
        CREATE OR REPLACE TEMP TABLE stg_ibge AS
        SELECT cd_municipio_ibge::VARCHAR(7) AS cd_municipio_ibge,
               ano::SMALLINT AS ano, TRY_CAST(populacao AS BIGINT) AS populacao,
               tipo_populacao::VARCHAR AS tipo_populacao, TRY_CAST(pib AS DECIMAL(18,2)) AS pib,
               TRY_CAST(pib_per_capita AS DECIMAL(16,2)) AS pib_per_capita,
               TRY_CAST(renda_domiciliar_per_capita AS DECIMAL(16,2)) AS renda_domiciliar_per_capita,
               TRY_CAST(area_km2 AS DECIMAL(12,3)) AS area_km2,
               TRY_CAST(densidade_hab_km2 AS DECIMAL(14,4)) AS densidade_hab_km2,
               TRY_CAST(populacao_jovem AS BIGINT) AS populacao_jovem,
               TRY_CAST(porcentagem_analfabetismo AS DECIMAL(6,3)) AS porcentagem_analfabetismo,
               TRY_CAST(porcentagem_superior AS DECIMAL(6,3)) AS porcentagem_superior,
               TRY_CAST(vab_agropecuaria AS DECIMAL(18,2)) AS vab_agropecuaria,
               TRY_CAST(vab_industria AS DECIMAL(18,2)) AS vab_industria,
               TRY_CAST(vab_servicos AS DECIMAL(18,2)) AS vab_servicos,
               TRY_CAST(vab_administracao_publica AS DECIMAL(18,2)) AS vab_administracao_publica,
               perfil_municipio::VARCHAR AS perfil_municipio, fonte::VARCHAR AS fonte
        FROM read_csv('{stage}', delim=';', header=true, all_varchar=true)
    """)
    if con.execute("SELECT COUNT(*) FROM stg_ibge").fetchone()[0] != len(rows):
        raise RuntimeError("Contagem do staging IBGE diverge")
    if con.execute("SELECT COUNT(*) FROM stg_ibge WHERE ano BETWEEN 2002 AND 2023 AND pib IS NOT NULL").fetchone()[0] < 15000:
        raise RuntimeError("Cobertura SIDRA 5938 inesperadamente baixa")
    con.execute("BEGIN TRANSACTION")
    try:
        con.execute("DELETE FROM public.fato_socioeconomico_ibge WHERE cd_municipio_ibge IN (SELECT cd_municipio_ibge FROM public.municipio WHERE sg_uf IN ('AC','AL','BA','DF','RO','SP'))")
        con.execute("INSERT INTO public.fato_socioeconomico_ibge SELECT * FROM stg_ibge")
        missing_census = con.execute("""
            SELECT COUNT(*) FROM public.municipio m
            WHERE m.sg_uf IN ('AC','AL','BA','DF','RO','SP') AND m.cd_municipio_ibge IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM public.fato_socioeconomico_ibge s
                              WHERE s.cd_municipio_ibge=m.cd_municipio_ibge AND s.ano IN (2010,2022)
                                AND s.populacao IS NOT NULL AND s.tipo_populacao='CENSITARIA')
        """).fetchone()[0]
        if missing_census:
            raise RuntimeError(f"Municípios sem população censitária em 2010/2022: {missing_census}")
        con.execute("COMMIT")
    except Exception:
        con.execute("ROLLBACK")
        raise
    stats = con.execute("""
        SELECT MIN(ano), MAX(ano), COUNT(*), COUNT(pib), COUNT(populacao),
               COUNT(vab_agropecuaria), COUNT(*) FILTER (WHERE ano IN (2010,2022) AND tipo_populacao='CENSITARIA')
        FROM public.fato_socioeconomico_ibge
        WHERE cd_municipio_ibge IN (SELECT cd_municipio_ibge FROM public.municipio WHERE sg_uf IN ('AC','AL','BA','DF','RO','SP'))
    """).fetchone()
    print({"municipalities": len(expected_codes), "sidra_rows": len(rows), "stats": stats,
           "seconds": round(time.monotonic()-started, 2)}, flush=True)
    con.close()


if __name__ == "__main__":
    main()
