#!/usr/bin/env python3
"""Backfill reproduzível dos votos municipais para Presidente (2006–2022).

Lê o arquivo oficial de votação nominal por município/zona publicado no CKAN do
TSE, agrega por município e turno, e insere somente CD_CARGO=1 no BDR-TSE.
O total nacional de primeiro turno é atualizado a partir do arquivo BR quando
ele existe. Não altera outras tabelas nem cria tabelas permanentes.

Dependências: duckdb==1.5.6 e requests. Configure MOTHERDUCK_TOKEN para aplicar.
"""
from __future__ import annotations

import argparse
import csv
import io
import os
from pathlib import Path
import re
import tempfile
import time
import zipfile

import duckdb
import requests

YEARS = (2006, 2010, 2014, 2018, 2022)
UFS = {"AC", "AL", "BA", "DF", "RO", "SP"}
ROOT = "https://dadosabertos.tse.jus.br"
ALIASES = {
    "SQ_CANDIDATO": ("SQ_CANDIDATO", "SEQUENCIAL_CANDIDATO"),
    "CD_ELEICAO": ("CD_ELEICAO",),
    "CD_CARGO": ("CD_CARGO",),
    "NR_TURNO": ("NR_TURNO",),
    "SG_UF": ("SG_UF", "UF"),
    "CD_MUNICIPIO": ("CD_MUNICIPIO", "CODIGO_MUNICIPIO"),
    "VOTOS": ("QT_VOTOS_NOMINAIS_VALIDOS", "QT_VOTOS_NOMINAIS", "QT_VOTOS"),
}


def normalized_header(value: str) -> str:
    return re.sub(r"[^A-Z0-9]+", "_", value.strip().strip('"').upper()).strip("_")


def normalize_row(row: dict[str, str]) -> dict[str, str]:
    return {normalized_header(k): (v or "").strip() for k, v in row.items()}


def get(normalized: dict[str, str], field: str) -> str:
    for alias in ALIASES[field]:
        if alias in normalized:
            return normalized[alias]
    raise KeyError(f"Campo obrigatório ausente: {field}; campos={sorted(normalized)}")


def municipality_code(value: str) -> str:
    value = value.strip()
    return value.zfill(5) if value.isdigit() and len(value) < 5 else value


def official_zip_url(year: int) -> str:
    response = requests.get(
        f"{ROOT}/api/3/action/package_show",
        params={"id": f"resultados-{year}"}, timeout=60,
    )
    response.raise_for_status()
    payload = response.json()
    if not payload.get("success"):
        raise RuntimeError(f"CKAN não encontrou resultados-{year}")
    resources = payload["result"]["resources"]
    matches = [
        r["url"] for r in resources
        if "votacao_candidato_munzona" in r.get("url", "").lower()
        or "votação nominal por município e zona" in r.get("name", "").lower()
    ]
    matches = list(dict.fromkeys(matches))
    if len(matches) != 1:
        raise RuntimeError(f"Recurso TSE ambíguo para {year}: {matches}")
    return matches[0]


def fetch_zip(url: str, target: Path) -> None:
    print(f"Baixando fonte oficial: {url}", flush=True)
    transferred = 0
    with requests.get(url, stream=True, timeout=(30, 300)) as response:
        response.raise_for_status()
        with target.open("wb") as output:
            for chunk in response.iter_content(1024 * 1024):
                if chunk:
                    output.write(chunk)
                    transferred += len(chunk)
    print(f"ZIP recebido: {transferred} bytes", flush=True)


def extract_year(year: int, zip_path: Path, local_codes: set[str]):
    candidate_votes: dict[tuple[int, int, str, int], int] = {}
    national_first_round: dict[int, int] = {}
    election_codes: dict[int, int] = {}
    with zipfile.ZipFile(zip_path) as archive:
        names = archive.namelist()
        national = [n for n in names if n.upper().endswith(("_BR.CSV", "_BRASIL.CSV"))]
        if national:
            selected = [national[0]]
            has_national = True
        else:
            selected = [
                n for n in names
                if n.upper().endswith(".CSV")
                and any(n.upper().endswith(f"_{uf}.CSV") for uf in UFS)
            ]
            has_national = False
        if not selected:
            raise RuntimeError(f"Sem CSV BR/UF do TSE em {zip_path.name}")
        print(f"{year}: lendo {len(selected)} membro(s); nacional={has_national}", flush=True)
        for member in selected:
            with archive.open(member) as raw:
                stream = io.TextIOWrapper(raw, encoding="latin1", newline="")
                rows_read = 0
                for row in csv.DictReader(stream, delimiter=";"):
                    rows_read += 1
                    if rows_read % 1_000_000 == 0:
                        print(f"{year}: {member.rsplit('/', 1)[-1]}: {rows_read:,} linhas lidas", flush=True)
                    fields = normalize_row(row)
                    cargo = get(fields, "CD_CARGO")
                    if cargo and cargo != "1":
                        continue
                    sq_text = get(fields, "SQ_CANDIDATO")
                    turn_text = get(fields, "NR_TURNO")
                    city = municipality_code(get(fields, "CD_MUNICIPIO"))
                    uf = get(fields, "SG_UF").upper()
                    election_text = get(fields, "CD_ELEICAO")
                    votes_text = get(fields, "VOTOS")
                    if not sq_text.isdigit() or not turn_text.isdigit() or not election_text.isdigit():
                        continue
                    votes = int(votes_text) if votes_text.isdigit() else 0
                    if votes < 0:
                        raise RuntimeError(f"Voto negativo no TSE: {year}/{member}")
                    sq, turn, election = int(sq_text), int(turn_text), int(election_text)
                    election_codes[turn] = election
                    # O arquivo BR contém o país inteiro; arquivos estaduais são
                    # usados como fallback apenas para as UFs do recorte.
                    if has_national and turn == 1 and uf not in UFS:
                        national_first_round[sq] = national_first_round.get(sq, 0) + votes
                    elif has_national and turn == 1:
                        national_first_round[sq] = national_first_round.get(sq, 0) + votes
                    if uf in UFS and city in local_codes and votes:
                        key = (election, turn, city, sq)
                        candidate_votes[key] = candidate_votes.get(key, 0) + votes
    return candidate_votes, national_first_round, election_codes, has_national


def write_csv(path: Path, header: list[str], rows) -> int:
    count = 0
    with path.open("w", encoding="utf-8", newline="") as output:
        writer = csv.writer(output, delimiter=";")
        writer.writerow(header)
        for row in rows:
            writer.writerow(row)
            count += 1
    return count


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", default="BDR-TSE")
    parser.add_argument("--work-dir", type=Path, default=Path(tempfile.gettempdir()) / "tse_presidente_2006_2022")
    args = parser.parse_args()
    if not os.environ.get("MOTHERDUCK_TOKEN"):
        raise RuntimeError("Configure MOTHERDUCK_TOKEN com permissão de escrita")
    started = time.monotonic()
    args.work_dir.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(f"md:{args.database}?attach_mode=single")
    municipalities = con.execute(
        "SELECT cd_municipio_tse FROM public.municipio WHERE sg_uf IN ('AC','AL','BA','DF','RO','SP')"
    ).fetchall()
    local_codes = {r[0] for r in municipalities}
    expected_municipalities = len(local_codes)
    if expected_municipalities < 1200:
        raise RuntimeError(f"Dimensão municipal incompleta: {expected_municipalities}")

    candidate_rows = []
    party_rows = []
    national_totals = []
    per_year_report = []
    for year in YEARS:
        url = official_zip_url(year)
        zip_path = args.work_dir / f"votacao_candidato_munzona_{year}.zip"
        if not zip_path.exists():
            fetch_zip(url, zip_path)
        candidate_votes, national_votes, election_codes, has_national = extract_year(year, zip_path, local_codes)
        if set(election_codes) != {1, 2}:
            raise RuntimeError(f"Esperados dois turnos presidenciais em {year}; encontrados {sorted(election_codes)}")
        if has_national and not national_votes:
            raise RuntimeError(f"Arquivo BR sem total nacional de primeiro turno em {year}")
        if not candidate_votes:
            raise RuntimeError(f"Nenhum voto presidencial no recorte em {year}")
        con.execute(
            "CREATE OR REPLACE TEMP TABLE map_candidato AS "
            "SELECT sq_candidato_tse, sq_candidato, nr_partido, sg_partido "
            "FROM public.candidatura WHERE ano_eleicao=? AND cd_cargo=1",
            [year],
        )
        mapping = {
            int(tse_sq): (int(project_sq), int(party), sigla)
            for tse_sq, project_sq, party, sigla in con.execute(
                "SELECT sq_candidato_tse,sq_candidato,nr_partido,sg_partido FROM map_candidato "
                "WHERE sq_candidato_tse IS NOT NULL AND nr_partido IS NOT NULL"
            ).fetchall()
        }
        missing = sorted({sq for _, _, _, sq in candidate_votes} - set(mapping))
        if missing:
            raise RuntimeError(f"Candidatos presidenciais sem vínculo TSE no banco ({year}): {missing}")
        by_party: dict[tuple[int, int, str, int], int] = {}
        by_party_sigla: dict[tuple[int, int, str, int], str] = {}
        for (election, turn, city, tse_sq), votes in candidate_votes.items():
            project_sq, party, sigla = mapping[tse_sq]
            candidate_rows.append([year, election, turn, city, project_sq, votes])
            pkey = (election, turn, city, party)
            by_party[pkey] = by_party.get(pkey, 0) + votes
            by_party_sigla[pkey] = sigla
        for (election, turn, city, party), votes in by_party.items():
            party_rows.append([year, election, turn, city, party, by_party_sigla[(election, turn, city, party)], votes])
        if has_national:
            for tse_sq, votes in national_votes.items():
                if tse_sq in mapping:
                    national_totals.append([year, mapping[tse_sq][0], votes])
        municipalities_by_turn = {
            turn: len({city for election, row_turn, city, sq in candidate_votes if row_turn == turn})
            for turn in (1, 2)
        }
        if any(n != expected_municipalities for n in municipalities_by_turn.values()):
            raise RuntimeError(f"Cobertura municipal não integral em {year}: {municipalities_by_turn}, esperado {expected_municipalities}")
        per_year_report.append({
            "year": year, "source_url": url, "source_member_national": has_national,
            "candidate_rows": len(candidate_votes), "municipalities_by_turn": municipalities_by_turn,
            "mapped_candidates": len({sq for _, _, _, sq in candidate_votes}),
            "national_first_round_candidates": len(national_votes),
            "election_codes_by_turn": election_codes,
        })
        print(f"{year}: {len(candidate_votes)} linhas agregadas; municípios/turno={municipalities_by_turn}", flush=True)

    # Separar fatos municipais dos totais nacionais sem criar tabela persistente.
    muni_path = args.work_dir / "presidente_municipios.csv"
    party_path = args.work_dir / "presidente_partidos.csv"
    total_path = args.work_dir / "presidente_totais_nacionais.csv"
    municipality_rows = [r for r in candidate_rows]
    party_municipality_rows = party_rows
    total_candidate_rows = national_totals
    write_csv(muni_path, ["ano_eleicao","cd_eleicao","nr_turno","cd_municipio_tse","sq_candidato","qt_votos_nominais"], municipality_rows)
    write_csv(party_path, ["ano_eleicao","cd_eleicao","nr_turno","cd_municipio_tse","nr_partido","sg_partido","qt_votos_nominais"], party_municipality_rows)
    write_csv(total_path, ["ano_eleicao","sq_candidato","qt_votos_totais"], total_candidate_rows)
    con.execute(f"""
        CREATE OR REPLACE TEMP TABLE stg_presidente AS
        SELECT ano_eleicao::INTEGER AS ano_eleicao,
               cd_eleicao::INTEGER AS cd_eleicao,
               nr_turno::INTEGER AS nr_turno,
               cd_municipio_tse::VARCHAR AS cd_municipio_tse,
               sq_candidato::BIGINT AS sq_candidato,
               qt_votos_nominais::INTEGER AS qt_votos_nominais
        FROM read_csv('{muni_path}', delim=';', header=true, all_varchar=true)
    """)
    con.execute(f"""
        CREATE OR REPLACE TEMP TABLE stg_partido_presidente AS
        SELECT ano_eleicao::INTEGER AS ano_eleicao,
               cd_eleicao::INTEGER AS cd_eleicao,
               nr_turno::INTEGER AS nr_turno,
               cd_municipio_tse::VARCHAR AS cd_municipio_tse,
               nr_partido::INTEGER AS nr_partido,
               sg_partido::VARCHAR AS sg_partido,
               qt_votos_nominais::INTEGER AS qt_votos_nominais
        FROM read_csv('{party_path}', delim=';', header=true, all_varchar=true)
    """)
    con.execute(f"""
        CREATE OR REPLACE TEMP TABLE stg_totais_presidente AS
        SELECT ano_eleicao::INTEGER AS ano_eleicao,
               sq_candidato::BIGINT AS sq_candidato,
               qt_votos_totais::INTEGER AS qt_votos_totais
        FROM read_csv('{total_path}', delim=';', header=true, all_varchar=true)
    """)

    expected_rows = len(municipality_rows)
    if con.execute("SELECT COUNT(*) FROM stg_presidente").fetchone()[0] != expected_rows:
        raise RuntimeError("Contagem do staging candidato diverge")
    con.execute("BEGIN TRANSACTION")
    try:
        con.execute("DELETE FROM public.votacao_candidato_municipio WHERE cd_cargo=1 AND ano_eleicao IN (2006,2010,2014,2018,2022)")
        con.execute("DELETE FROM public.votacao_partido WHERE cd_cargo=1 AND ano_eleicao IN (2006,2010,2014,2018,2022)")
        con.execute("""
            INSERT INTO public.votacao_candidato_municipio
            SELECT s.ano_eleicao,s.cd_eleicao,s.nr_turno,1,s.cd_municipio_tse,s.sq_candidato,s.qt_votos_nominais
            FROM stg_presidente s
            JOIN public.municipio m USING(cd_municipio_tse)
            JOIN public.candidatura c ON c.ano_eleicao=s.ano_eleicao AND c.sq_candidato=s.sq_candidato AND c.cd_cargo=1
        """)
        con.execute("""
            INSERT INTO public.votacao_partido
            SELECT s.ano_eleicao,s.cd_eleicao,s.nr_turno,1,s.cd_municipio_tse,s.nr_partido,s.sg_partido,
                   0,s.qt_votos_nominais
            FROM stg_partido_presidente s
            JOIN public.municipio m USING(cd_municipio_tse)
            JOIN public.partido p USING(nr_partido)
        """)
        con.execute("""
            UPDATE public.candidatura c SET qt_votos_totais=t.qt_votos_totais
            FROM stg_totais_presidente t
            WHERE c.ano_eleicao=t.ano_eleicao AND c.sq_candidato=t.sq_candidato AND c.cd_cargo=1
        """)
        bad = con.execute("""
            SELECT COUNT(*) FROM (
              SELECT ano_eleicao,cd_eleicao,nr_turno,cd_municipio_tse,
                     SUM(qt_votos_nominais) AS candidato,
                     (SELECT SUM(qt_votos_nominais) FROM public.votacao_partido p
                       WHERE p.ano_eleicao=v.ano_eleicao AND p.cd_eleicao=v.cd_eleicao
                         AND p.nr_turno=v.nr_turno AND p.cd_cargo=1
                         AND p.cd_municipio_tse=v.cd_municipio_tse) AS partido
              FROM public.votacao_candidato_municipio v
              WHERE cd_cargo=1 AND ano_eleicao IN (2006,2010,2014,2018,2022)
              GROUP BY 1,2,3,4
              HAVING candidato<>partido
            )
        """).fetchone()[0]
        if bad:
            raise RuntimeError(f"Totais presidenciais candidato/partido divergem em {bad} municípios")
        con.execute("COMMIT")
    except Exception:
        con.execute("ROLLBACK")
        raise

    result = {
        "database": args.database,
        "presidential_candidate_rows_added": expected_rows,
        "presidential_party_rows_added": len(party_municipality_rows),
        "national_first_round_totals_updated": len(total_candidate_rows),
        "years": per_year_report,
        "seconds": round(time.monotonic() - started, 2),
    }
    print(result, flush=True)
    con.close()


if __name__ == "__main__":
    main()
