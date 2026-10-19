#!/usr/bin/env python3
"""Extrai a votação de PRESIDENTE (cd_cargo 1) dos ZIPs oficiais do TSE.

Os arquivos munzona por UF não trazem Presidente: a totalização desse cargo só
aparece no arquivo BR incluído no mesmo ZIP. Este script lê os ZIPs, filtra os
municípios dos estados da amostra e gera CSVs no grão já usado pelas tabelas
votacao_partido e votacao_candidato_municipio do MotherDuck.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import zipfile
from collections import defaultdict

YEARS = (2018, 2022)
UFS = {"AC", "AL", "BA", "DF", "RO", "SP"}
CD_MUNICIPIO, SG_UF, CD_CARGO, DS_CARGO = 14, 11, 17, 18


def mun_code(value):
    value = (value or "").strip()
    return value.zfill(5) if value.isdigit() and len(value) < 5 else value


def rows(archive, member):
    with archive.open(member) as raw:
        yield from csv.DictReader(io.TextIOWrapper(raw, encoding="latin1", newline=""), delimiter=";")


def num(value):
    value = (value or "").strip()
    digits = value.lstrip("-")
    if not digits.isdigit():
        return 0
    return int(value)


def pick(row, *keys):
    for key in keys:
        if key in row:
            value = (row[key] or "").strip()
            if value:
                return value
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zip-dir", type=str, default="/tmp/opencode/tse")
    ap.add_argument("--output", type=str, default="/tmp/opencode/tse")
    args = ap.parse_args()

    out = {}
    for year in YEARS:
        partido_zip = f"{args.zip_dir}/votacao_partido_munzona_{year}.zip"
        candidato_zip = f"{args.zip_dir}/votacao_candidato_munzona_{year}.zip"

        municipios_amostra = set()
        with zipfile.ZipFile(partido_zip) as z:
            for member in z.namelist():
                uf = member.rsplit("_", 1)[-1].removesuffix(".csv")
                if uf.upper() not in UFS:
                    continue
                for r in rows(z, member):
                    sg = (r.get("SG_UF") or "").strip().upper()
                    if sg in UFS:
                        municipios_amostra.add(mun_code(r["CD_MUNICIPIO"]))
        print(f"{year}: {len(municipios_amostra)} municípios de {len(UFS)} UFs", flush=True)

        partido_lock = defaultdict(lambda: [0, 0])
        candidato_lock = defaultdict(lambda: [0, 0])
        nacional_turno1 = defaultdict(int)

        with zipfile.ZipFile(partido_zip) as z:
            member = next(m for m in z.namelist() if m.upper().endswith("_BR.CSV"))
            for r in rows(z, member):
                codigo = mun_code(r["CD_MUNICIPIO"])
                if codigo not in municipios_amostra:
                    continue
                turno = (r["NR_TURNO"] or "").strip()
                nr_partido = (r["NR_PARTIDO"] or "").strip()
                key = (turno, codigo, nr_partido, (r.get("SG_PARTIDO") or "").strip())
                legenda = num(pick(r, "QT_TOTAL_VOTOS_LEG_VALIDOS", "QT_VOTOS_LEGENDA"))
                nominais = num(pick(r, "QT_VOTOS_NOMINAIS_VALIDOS", "QT_VOTOS_NOMINAIS"))
                partido_lock[key][0] += legenda
                partido_lock[key][1] += nominais

        with zipfile.ZipFile(candidato_zip) as z:
            member = next(m for m in z.namelist() if m.upper().endswith("_BR.CSV"))
            for r in rows(z, member):
                codigo = mun_code(r["CD_MUNICIPIO"])
                sq = (r["SQ_CANDIDATO"] or "").strip()
                turno = (r["NR_TURNO"] or "").strip()
                nominais = num(pick(r, "QT_VOTOS_NOMINAIS_VALIDOS", "QT_VOTOS_NOMINAIS"))
                nacional_turno1[sq] += nominais if turno == "1" else 0
                if codigo not in municipios_amostra:
                    continue
                bucket = candidato_lock[(turno, codigo, sq)]
                bucket[0] += nominais
                bucket[1] = (r.get("SG_PARTIDO") or "").strip()

        cd_eleicao = {t[0]: t[1] for t in (yield_cd_eleicao(year))}
        caminho_partido = f"{args.output}/presidente_partido_{year}.csv"
        caminho_candidato = f"{args.output}/presidente_candidato_{year}.csv"
        caminho_nacional = f"{args.output}/presidente_nacional_{year}.json"

        with open(caminho_partido, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f, delimiter=";")
            w.writerow(["ano_eleicao", "cd_eleicao", "nr_turno", "cd_cargo",
                        "cd_municipio_tse", "nr_partido", "sg_partido",
                        "qt_votos_legenda", "qt_votos_nominais"])
            for (turno, codigo, nr_partido, sg_partido), (legenda, nominais) in sorted(partido_lock.items()):
                if nr_partido.isdigit() and (legenda or nominais):
                    w.writerow([year, cd_eleicao[turno], int(turno), 1, codigo,
                                int(nr_partido), sg_partido, legenda, nominais])

        with open(caminho_candidato, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f, delimiter=";")
            w.writerow(["ano_eleicao", "cd_eleicao", "nr_turno", "cd_cargo",
                        "cd_municipio_tse", "sq_candidato", "qt_votos_nominais"])
            for (turno, codigo, sq), (nominais, _) in sorted(candidato_lock.items()):
                if sq.isdigit() and nominais:
                    w.writerow([year, cd_eleicao[turno], int(turno), 1, codigo,
                                int(sq), nominais])

        with open(caminho_nacional, "w", encoding="utf-8") as f:
            json.dump({sq: total for sq, total in sorted(nacional_turno1.items()) if sq.isdigit()},
                      f, indent=2)
        print(f"{year}: partido {sum(1 for _ in open(caminho_partido))-1} linhas; "
              f"candidato {sum(1 for _ in open(caminho_candidato))-1} linhas; "
              f"nacional {len(nacional_turno1)} candidatos", flush=True)


def yield_cd_eleicao(year):
    # Convenção já vigente no banco: 1º turno Usa CD_ELEICAO do 1º turno geral.
    return {
        2018: [("1", 297), ("2", 298)],
        2022: [("1", 546), ("2", 547)],
    }[year]


if __name__ == "__main__":
    main()
