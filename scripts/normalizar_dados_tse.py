#!/usr/bin/env python3
"""Normaliza os arquivos TSE de 2004 a 2024 para COPY em stg_tse.

O script não conecta ao banco. Gera CSVs temporários locais, preservando texto
e sentinelas; a publicação ocorre pelos scripts SQL existentes.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
from functools import lru_cache
from collections import defaultdict
from datetime import datetime
from pathlib import Path
import unicodedata
import zipfile

YEARS = (2004, 2006, 2008, 2010, 2012, 2014, 2016, 2018, 2020, 2022, 2024)
UFS = {"AC", "AL", "BA", "DF", "RO", "SP"}
SOURCES = (
    "consulta_cand", "consulta_cand_complementar", "votacao_candidato_munzona",
    "bem_candidato", "votacao_partido_munzona",
    "detalhe_votacao_munzona", "perfil_eleitorado",
    "prestacao_de_contas_eleitorais_candidatos",
)

STAGES = {
    "candidatura": ["ano_eleicao", "cd_eleicao", "nr_turno", "cd_tipo_eleicao", "nm_tipo_eleicao", "sg_uf", "sg_ue", "nm_ue", "cd_cargo", "ds_cargo", "sq_candidato", "sq_candidato_tse", "nr_cpf_candidato", "nm_candidato", "nm_urna_candidato", "dt_nascimento", "ds_grau_instrucao", "ds_genero", "ds_cor_raca", "nr_partido", "sg_partido", "nm_partido", "ds_sit_tot_turno", "source_file", "nr_titulo_eleitoral_candidato", "nr_candidato"],
    "candidatura_complementar": ["ano_eleicao", "cd_eleicao", "sq_candidato", "nr_turno", "nm_tipo_destinacao_votos", "source_file"],
    "bem_candidato": ["ano_eleicao", "sq_candidato", "nr_ordem_bem_candidato", "ds_tipo_bem_candidato", "ds_bem_candidato", "vr_bem_candidato", "source_file"],
    "votacao_candidato_munzona": ["ano_eleicao", "sg_uf", "cd_eleicao", "nr_turno", "cd_cargo", "cd_municipio_tse", "sq_candidato", "qt_votos_nominais", "source_file"],
    "votacao_partido_munzona": ["ano_eleicao", "sg_uf", "cd_eleicao", "nr_turno", "cd_cargo", "cd_municipio_tse", "nr_partido", "sg_partido", "qt_votos_legenda", "qt_votos_nominais", "source_file"],
    "detalhe_votacao_munzona": ["ano_eleicao", "sg_uf", "cd_eleicao", "nr_turno", "cd_cargo", "cd_municipio_tse", "nr_zona", "qt_aptos", "qt_comparecimento", "qt_abstencao", "source_file"],
    "perfil_eleitorado_municipio": ["ano_eleicao", "sg_uf", "cd_municipio_tse", "nr_zona", "ds_faixa_etaria", "ds_genero", "ds_estado_civil", "ds_grau_instrucao", "qt_eleitores_perfil", "source_file"],
    "municipio_correspondencia": ["cd_municipio_tse", "cd_municipio_ibge", "nm_municipio", "sg_uf", "source_file"],
    "receita_candidato": ["ano_eleicao", "sq_candidato", "id_linha_origem", "ds_fonte_receita", "vr_receita", "tp_origem_recurso", "source_file"],
    "despesa_candidato": ["ano_eleicao", "sq_candidato", "id_linha_origem", "ds_despesa", "ds_categoria_despesa", "vr_pago", "source_file"],
    "cobertura_despesa_paga": ["ano_eleicao", "sq_candidato", "completo", "source_manifest"],
    "comparecimento_zonas_esperadas": ["ano_eleicao", "cd_eleicao", "nr_turno", "cd_municipio_tse", "nr_zona", "source_manifest", "manifesto_verificado"],
}

ALIASES = {
    "cd_municipio_tse": "CD_MUNICIPIO",
    "qt_abstencao": "QT_ABSTENCOES",
    "qt_eleitores_perfil": "QT_ELEITORES",
    "ds_grau_instrucao": "DS_GRAU_ESCOLARIDADE",
    "qt_votos_legenda": "QT_TOTAL_VOTOS_LEG_VALIDOS",
}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


class Outputs:
    def __init__(self, root: Path):
        self.root = root
        self.files = {}
        self.writers = {}
        self.counts = defaultdict(int)
        root.mkdir(parents=True, exist_ok=True)
        for table, fields in STAGES.items():
            path = root / f"{table}.csv"
            f = path.open("w", encoding="utf-8", newline="")
            self.files[table] = f
            self.writers[table] = csv.writer(f, delimiter=";", lineterminator="\n")

    def put(self, table: str, row):
        self.writers[table].writerow(["" if x is None else x for x in row])
        self.counts[table] += 1

    def close(self):
        for f in self.files.values():
            f.close()


def rows(archive, member):
    with archive.open(member) as raw:
        yield from csv.DictReader(io.TextIOWrapper(raw, encoding="latin1", newline=""), delimiter=";")


def selected_members(names, source, year):
    extension = ".txt" if source == "prestacao_de_contas_eleitorais_candidatos" and year in (2010, 2012, 2014, 2016) else ".csv"
    csvs = [n for n in names if n.lower().endswith(extension)]
    selected = []
    if source in {"votacao_candidato_munzona", "votacao_partido_munzona", "detalhe_votacao_munzona"}:
        selected = [n for n in csvs if any(n.upper().endswith(f"_{uf}.CSV") for uf in UFS)]
        if source == "detalhe_votacao_munzona" and year == 2004:
            selected += [n for n in csvs if n.upper().endswith("_BRASIL.CSV")]
    elif source == "perfil_eleitorado" and (year < 2014 or year in (2018, 2020)):
        selected = [n for n in csvs if n.rsplit("/", 1)[-1].upper() == f"PERFIL_ELEITORADO_{year}.CSV"]
    elif source == "perfil_eleitorado":
        selected = [n for n in csvs if any(n.upper().endswith(f"_{uf}.CSV") for uf in UFS)]
    elif source == "prestacao_de_contas_eleitorais_candidatos":
        suffix = extension.upper()
        if year <= 2008:
            selected = [n for n in csvs if "candidato" in n.rsplit("/", 1)[-1].lower()
                        and any(k in n.rsplit("/", 1)[-1].lower() for k in ("receita", "despesa"))
                        and "comite" not in n.lower() and "comitê" not in n.lower()]
        else:
            selected = [n for n in csvs if any(n.upper().endswith(f"_{uf}{suffix}") for uf in UFS)
                        or (any(f"/{uf}/" in n.upper() for uf in UFS)
                            and "candidato" in n.lower() and "comite" not in n.lower() and "comitê" not in n.lower())]
    else:
        selected = [n for n in csvs if any(n.upper().endswith(f"_{uf}.CSV") for uf in UFS) or n.upper().endswith("_BR.CSV")]
    return sorted(selected)


def val(r, key, default=None):
    return r.get(key, default)


@lru_cache(maxsize=512)
def finance_header(value):
    """Canonicalize a TSE legacy header once; headers repeat on every row."""
    return "_".join(
        "".join(ch for ch in unicodedata.normalize("NFKD", value)
                if not unicodedata.combining(ch)).upper().split()
    ).replace("Ç", "C")


def finance_fields(row):
    return {finance_header(name.strip('"')): value for name, value in row.items()}


def finance_val(fields, key, default=None):
    """Read normalized legacy TSE fields without repeatedly scanning headers."""
    aliases = {
        "SQ_CANDIDATO": "SEQUENCIAL_CANDIDATO",
        "VR_RECEITA": "VALOR_RECEITA",
        "DS_FONTE_RECEITA": "FONTE_RECURSO",
        "DS_DESPESA": "DESCRICAO_DA_DESPESA",
        "DS_CATEGORIA_DESPESA": "TIPO_DESPESA",
    }
    canonical = finance_header(key)
    if canonical in fields:
        return fields[canonical]
    wanted = finance_header(aliases.get(key, key))
    value = fields.get(wanted)
    if value is not None:
        return value
    legacy_aliases = {
        "DS_FONTE_RECEITA": ("DS_TITULO", "DS_ESP_RECURSO", "TIPO_RECEITA", "DESCRICAO_TIPO_RECEITA", "DESCRICAO_TIPO_RECURSO"),
        "DS_DESPESA": ("DS_TITULO", "TIPO_DESPESA", "DESCRICAO_DA_DESPESA"),
        "DS_CATEGORIA_DESPESA": ("TIPO_DESPESA", "DS_TITULO", "DESCRICAO_DA_DESPESA"),
    }
    for alias in legacy_aliases.get(key, ()):
        alias = finance_header(alias)
        for source_name, value in fields.items():
            if source_name == alias or alias in source_name:
                return value if value is not None else default
    return default


def normalized_name(value):
    value = unicodedata.normalize("NFKD", (value or "").strip())
    value = "".join(ch for ch in value if not unicodedata.combining(ch)).upper()
    return " ".join("".join(ch if ch.isalnum() else " " for ch in value).split())


def mun_code(value):
    """Normalize TSE numeric municipality codes without losing leading zeroes."""
    value = (value or "").strip()
    return value.zfill(5) if value.isdigit() and len(value) < 5 else value


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zip-dir", type=Path, default=Path("/tmp/tse_full_2004_2024"))
    ap.add_argument("--output", type=Path, default=Path("/tmp/tse_railway_stage"))
    ap.add_argument("--legacy-key-map", type=Path, help="Mapa externo ano/UF/SQ original/SQ projeto para preservar chaves já publicadas de 2006/2008")
    args = ap.parse_args()
    out = Outputs(args.output)
    manifests = []
    municipalities = {}
    expected_zones = set()
    profile_counts = defaultdict(int)
    profile_invalid = 0
    account_candidates = defaultdict(set)
    final_dates = defaultdict(set)
    finance_members = []
    finance_files_loaded = set()
    receipt_keys = set()
    duplicate_receipt_rows_dropped = 0
    expense_keys = set()
    duplicate_expense_rows_dropped = 0
    candidate_sqs = defaultdict(set)
    bem_ordem_interna = defaultdict(int)
    candidate_2004_keys = defaultdict(set)
    candidate_2004_by_scope = defaultdict(set)
    candidate_2004_by_raw_scope = defaultdict(set)
    candidate_2004_finance_number = defaultdict(set)
    candidate_2004_ids = {}
    candidate_2004_id_keys = {}
    historical_vote_unmatched = 0
    finance_unmatched_rows = defaultdict(int)
    excluded_supplementary_rows = defaultdict(int)
    sparse_legacy_candidates = set()
    legacy_ids = {}
    legacy_id_scopes = {}
    legacy_registration_scopes = {}
    quarantine_file = (args.output / "quarentena_identificadores.jsonl").open("w", encoding="utf-8")

    def quarantine(year, source, source_file, record, reason):
        quarantine_file.write(json.dumps({"year":year,"source":source,"source_file":source_file,
                                         "reason":reason,"record":record},ensure_ascii=False)+"\n")
    if args.legacy_key_map:
        with args.legacy_key_map.open(encoding="utf-8", newline="") as f:
            for row in csv.DictReader(f, delimiter=";"):
                key = (int(row["ano_eleicao"]), row["sg_uf"], row["sq_candidato_tse"])
                value = row["sq_candidato"]
                if key in legacy_ids and legacy_ids[key] != value:
                    raise RuntimeError("Mapa legado contém duas chaves para o mesmo escopo")
                if (key[0], value) in legacy_id_scopes and legacy_id_scopes[(key[0], value)] != key:
                    raise RuntimeError("Mapa legado reutiliza SQ interno entre UFs")
                legacy_ids[key] = value
                legacy_id_scopes[(key[0], value)] = key

    def project_sq_legacy(year, uf, raw_sq):
        key = (year, uf, raw_sq)
        if key not in legacy_ids:
            digest = hashlib.blake2b("\x1f".join(map(str, key)).encode("utf-8"), digest_size=8).digest()
            value = str(year * 1_000_000_000_000 + int.from_bytes(digest, "big") % 1_000_000_000_000_000)
            if (year, value) in legacy_id_scopes and legacy_id_scopes[(year, value)] != key:
                raise RuntimeError("Colisão no SQ interno legado por ano/UF/SQ")
            legacy_ids[key] = value
            legacy_id_scopes[(year, value)] = key
        candidate_sqs[year].add(legacy_ids[key])
        return legacy_ids[key]

    def project_sq_2004(scope_key):
        if scope_key not in candidate_2004_ids:
            id_digest = hashlib.blake2b("\x1f".join(scope_key).encode("utf-8"), digest_size=8).digest()
            project_sq = 2_004_000_000_000_000 + int.from_bytes(id_digest, "big") % 1_000_000_000_000_000
            prior_key = candidate_2004_id_keys.get(project_sq)
            if prior_key is not None and prior_key != scope_key:
                raise RuntimeError("Colisão no ID interno derivado para candidatura de 2004")
            candidate_2004_ids[scope_key] = str(project_sq)
            candidate_2004_id_keys[project_sq] = scope_key
        sq = candidate_2004_ids[scope_key]
        uf, ue, office, source_sq, number, name = scope_key
        candidate_2004_keys[(uf, ue, office, number, name)].add(sq)
        candidate_2004_by_scope[(uf, ue, office, source_sq, number)].add(sq)
        candidate_2004_by_raw_scope[(uf, ue, office, source_sq)].add(sq)
        candidate_2004_finance_number[(uf, ue, office, number)].add(sq)
        candidate_sqs[2004].add(sq)
        return sq

    try:
        for year in YEARS:
            for source in SOURCES:
                if source == "consulta_cand_complementar" and year < 2018:
                    continue
                if source == "bem_candidato" and year == 2004:
                    continue
                path = args.zip_dir / f"{source}_{year}.zip"
                if not path.exists():
                    raise FileNotFoundError(path)
                digest = sha256(path)
                bytes_read = 0
                selected = 0
                with zipfile.ZipFile(path) as z:
                    members = selected_members(z.namelist(), source, year)
                    if not members:
                        raise RuntimeError(f"Nenhum membro selecionado: {source}/{year}")
                    for member in members:
                        selected += 1
                        base = member.rsplit("/", 1)[-1]
                        if source == "prestacao_de_contas_eleitorais_candidatos":
                            if year < 2018:
                                lower_base = base.lower()
                                kind = "receitas_candidatos" if "receita" in lower_base else (
                                    "despesas_candidatos" if "despesa" in lower_base else None
                                )
                                if kind is None:
                                    continue
                                source_file = base
                                for row_number, r in enumerate(rows(z, member), start=1):
                                    fields = finance_fields(r)
                                    sq = (finance_val(fields, "SQ_CANDIDATO", "") or "").strip()
                                    if year == 2004:
                                        state = (fields.get("SG_UE_SUP") or "").strip().upper()
                                        if state not in UFS:
                                            continue
                                        ue = mun_code(fields.get("SG_UE"))
                                        office = (fields.get("CD_CARGO") or "").strip()
                                        number = (fields.get("NR_CAND") or "").strip().lstrip("0")
                                        name = normalized_name(fields.get("NO_CAND"))
                                        matches = candidate_2004_keys[(state, ue, office, number, name)]
                                        if len(matches) != 1:
                                            matches = candidate_2004_finance_number[(state, ue, office, number)]
                                        sqs = matches
                                    elif year in (2006, 2008):
                                        state = (fields.get("SG_UE_SUPERIOR") or fields.get("SG_UE_SUP")
                                                 or fields.get("UNIDADE_ELEITORAL_CANDIDATO") or "").strip().upper()
                                        if state not in UFS and state != "BR":
                                            continue
                                        scope = legacy_registration_scopes.get((year, state, sq))
                                        finance_office = (fields.get("CD_CARGO") or fields.get("CODIGO_CARGO") or "").strip()
                                        finance_ue = (fields.get("SG_UE") or fields.get("UNIDADE_ELEITORAL_CANDIDATO") or "").strip()
                                        if scope and ((finance_office and finance_office != scope[1])
                                                      or (finance_ue and mun_code(finance_ue) != scope[0])):
                                            finance_unmatched_rows[(year, kind + "_escopo_divergente")] += 1
                                            quarantine(year,kind,source_file,r,"circunscricao_ou_cargo_divergente")
                                            continue
                                        mapped = legacy_ids.get((year, state, sq))
                                        sqs = {mapped} if mapped and mapped in candidate_sqs[year] else set()
                                    else:
                                        sqs = {sq} if sq.isdigit() and sq in candidate_sqs[year] else set()
                                    if len(sqs) != 1:
                                        finance_unmatched_rows[(year, kind)] += 1
                                        quarantine(year,kind,source_file,r,"sem_candidatura_univoca")
                                        continue
                                    sq = next(iter(sqs))
                                    fingerprint = f"{source_file}:{row_number}"
                                    if kind == "receitas_candidatos":
                                        key = (year, sq, fingerprint)
                                        if key in receipt_keys:
                                            duplicate_receipt_rows_dropped += 1
                                            continue
                                        receipt_keys.add(key)
                                        out.put("receita_candidato", [
                                            year, sq, fingerprint,
                                            finance_val(fields, "DS_FONTE_RECEITA"),
                                            finance_val(fields, "VR_RECEITA"), None, source_file
                                        ])
                                    else:
                                        key = (year, sq, fingerprint)
                                        if key in expense_keys:
                                            duplicate_expense_rows_dropped += 1
                                            continue
                                        expense_keys.add(key)
                                        # Os leiautes antigos publicam valor declarado, sem campo
                                        # equivalente a despesa paga. Mantemos descrição/categoria;
                                        # VR_PAGO fica NULL até decisão semântica do grupo.
                                        out.put("despesa_candidato", [
                                            year, sq, fingerprint,
                                            finance_val(fields, "DS_DESPESA"),
                                            finance_val(fields, "DS_CATEGORIA_DESPESA"), None, source_file
                                        ])
                                continue
                            kind = next((x for x in ("receitas_candidatos", "despesas_pagas_candidatos", "despesas_contratadas_candidatos") if x in base.lower()), None)
                            if kind is None or "doador_originario" in base.lower():
                                continue
                            finance_files_loaded.add((year, base))
                            for r in rows(z, member):
                                provider = val(r, "SQ_PRESTADOR_CONTAS", "")
                                election = val(r, "AA_ELEICAO", str(year))
                                tp = (val(r, "TP_PRESTACAO_CONTAS", "") or "").strip().upper()
                                dt = (val(r, "DT_PRESTACAO_CONTAS", "") or "").strip()
                                sq = (val(r, "SQ_CANDIDATO", "") or "").strip()
                                if provider and tp == "FINAL" and dt:
                                    try:
                                        final_dates[(year, provider)].add(datetime.strptime(dt, "%d/%m/%Y"))
                                    except ValueError:
                                        pass
                                if provider and sq.isdigit():
                                    account_candidates[(year, provider)].add(sq)
                                # contratado é usado somente para vincular conta/candidatura.
                            if kind in ("receitas_candidatos", "despesas_pagas_candidatos"):
                                finance_members.append((year, path, member, kind, base))
                            continue

                        for r in rows(z, member):
                            sg = (val(r, "SG_UF") or "").strip().upper()
                            source_file = base
                            if source in ("consulta_cand", "consulta_cand_complementar", "bem_candidato"):
                                if source == "consulta_cand":
                                    # A fonte de candidaturas de 2006 usa código 0
                                    # para a eleição geral ordinária, enquanto os
                                    # demais anos do escopo usam 2. As fontes de
                                    # votação de 2006 já registram o tipo 2; não
                                    # filtrar pelo código de outra tabela elimina
                                    # candidaturas e impede o vínculo de votos e contas.
                                    tipo_eleicao_principal = "0" if year == 2006 else "2"
                                    if val(r, "CD_TIPO_ELEICAO") != tipo_eleicao_principal:
                                        continue
                                    sq = (val(r, "SQ_CANDIDATO") or "").strip()
                                    sq_tse = sq
                                    nr_cand = (val(r, "NR_CANDIDATO") or "").strip()
                                    if year == 2004 and sq.isdigit():
                                        scope_key = (
                                            sg, mun_code(val(r, "SG_UE")),
                                            (val(r, "CD_CARGO") or "").strip(), sq,
                                            nr_cand.lstrip("0"), normalized_name(val(r, "NM_CANDIDATO")),
                                        )
                                        sq = project_sq_2004(scope_key)
                                    elif year in (2006, 2008) and sq.isdigit():
                                        key = (year, sg, sq)
                                        scope = (mun_code(val(r, "SG_UE")), (val(r, "CD_CARGO") or "").strip())
                                        if key in legacy_registration_scopes and legacy_registration_scopes[key] != scope:
                                            raise RuntimeError("SQ legado também se repete dentro da UF; ampliar o escopo da chave antes de publicar")
                                        legacy_registration_scopes[key] = scope
                                        sq = project_sq_legacy(year, sg, sq)
                                    if sq.isdigit():
                                        candidate_sqs[year].add(sq)
                                    out.put("candidatura", [
                                        val(r,"ANO_ELEICAO",str(year)), val(r,"CD_ELEICAO"), val(r,"NR_TURNO"),
                                        val(r,"CD_TIPO_ELEICAO"), val(r,"NM_TIPO_ELEICAO"), sg, mun_code(val(r,"SG_UE")), val(r,"NM_UE"),
                                        val(r,"CD_CARGO"), val(r,"DS_CARGO"), sq, sq_tse, val(r,"NR_CPF_CANDIDATO"),
                                        val(r,"NM_CANDIDATO"), val(r,"NM_URNA_CANDIDATO"), val(r,"DT_NASCIMENTO"), val(r,"DS_GRAU_INSTRUCAO"), val(r,"DS_GENERO"),
                                        val(r,"DS_COR_RACA"), val(r,"NR_PARTIDO"), val(r,"SG_PARTIDO"), val(r,"NM_PARTIDO"),
                                        val(r,"DS_SIT_TOT_TURNO"), source_file, val(r,"NR_TITULO_ELEITORAL_CANDIDATO"), nr_cand])
                                elif source == "consulta_cand_complementar":
                                    out.put("candidatura_complementar", [val(r,"ANO_ELEICAO",str(year)),val(r,"CD_ELEICAO"),val(r,"SQ_CANDIDATO"),val(r,"NR_TURNO"),val(r,"NM_TIPO_DESTINACAO_VOTOS"),source_file])
                                else:
                                    code = mun_code(val(r,"CD_MUNICIPIO"))
                                    nm = val(r,"NM_MUNICIPIO")
                                    if code and sg in UFS and nm:
                                        municipalities.setdefault(code,(code,None,nm,sg,source_file))
                                    bem_year = (val(r,"ANO_ELEICAO",str(year)) or str(year)).strip()
                                    bem_sq = (val(r,"SQ_CANDIDATO") or "").strip()
                                    if year in (2006, 2008):
                                        if val(r, "CD_TIPO_ELEICAO") == "1":
                                            excluded_supplementary_rows[(year, "bem_candidato")] += 1
                                            continue
                                        mapped = legacy_ids.get((year, sg, bem_sq))
                                        scope = legacy_registration_scopes.get((year, sg, bem_sq))
                                        if not mapped or (scope and mun_code(val(r,"SG_UE")) != scope[0]):
                                            finance_unmatched_rows[(year, "bem_candidato")] += 1
                                            quarantine(year,"bem_candidato",source_file,r,"sem_candidatura_univoca")
                                            continue
                                        bem_sq = mapped
                                    bem_key = (bem_year, bem_sq)
                                    bem_ordem_interna[bem_key] += 1
                                    # O número de ordem publicado varia por leiaute e
                                    # pode se repetir para bens distintos. O DER precisa
                                    # de um discriminador estável dentro da candidatura;
                                    # usamos a ordem de leitura determinística do ZIP.
                                    out.put("bem_candidato", [bem_year,bem_sq,bem_ordem_interna[bem_key],val(r,"DS_TIPO_BEM_CANDIDATO"),val(r,"DS_BEM_CANDIDATO"),val(r,"VR_BEM_CANDIDATO"),source_file])
                            elif source == "votacao_candidato_munzona":
                                if sg not in UFS:
                                    continue
                                code=mun_code(val(r,"CD_MUNICIPIO"))
                                sq_voto = (val(r,"SQ_CANDIDATO") or "").strip()
                                if year in (2006, 2008):
                                    if val(r, "CD_TIPO_ELEICAO") == "1":
                                        excluded_supplementary_rows[(year, source)] += 1
                                        continue
                                    candidate_uf = "BR" if val(r, "CD_CARGO") == "1" else sg
                                    raw_sq_voto = sq_voto
                                    mapped = legacy_ids.get((year, candidate_uf, sq_voto))
                                    scope = (mun_code(val(r,"SG_UE")), (val(r,"CD_CARGO") or "").strip())
                                    known_scope = legacy_registration_scopes.get((year,candidate_uf,sq_voto))
                                    if known_scope and known_scope != scope:
                                        historical_vote_unmatched += 1
                                        quarantine(year,source,source_file,r,"circunscricao_ou_cargo_divergente")
                                        continue
                                    if not mapped:
                                        if not sq_voto.isdigit() or int(sq_voto) <= 0 or val(r,"CD_TIPO_ELEICAO") != "2":
                                            historical_vote_unmatched += 1
                                            quarantine(year,source,source_file,r,"sem_candidatura_univoca")
                                            continue
                                        mapped = project_sq_legacy(year,candidate_uf,sq_voto)
                                        legacy_registration_scopes[(year,candidate_uf,sq_voto)] = scope
                                        sparse_legacy_candidates.add((year,candidate_uf,sq_voto))
                                    if (year,candidate_uf,raw_sq_voto) in sparse_legacy_candidates:
                                        out.put("candidatura", [
                                            val(r,"ANO_ELEICAO",str(year)),val(r,"CD_ELEICAO"),val(r,"NR_TURNO"),
                                            val(r,"CD_TIPO_ELEICAO"),val(r,"NM_TIPO_ELEICAO"),candidate_uf,scope[0],val(r,"NM_UE"),
                                            val(r,"CD_CARGO"),val(r,"DS_CARGO"),mapped,raw_sq_voto,None,
                                            val(r,"NM_CANDIDATO"),val(r,"NM_URNA_CANDIDATO"),None,None,None,None,
                                            val(r,"NR_PARTIDO"),val(r,"SG_PARTIDO"),val(r,"NM_PARTIDO"),
                                            val(r,"DS_SIT_TOT_TURNO"),f"resultado:{source_file}",None,val(r,"NR_CANDIDATO")
                                        ])
                                    sq_voto = mapped
                                if year == 2004:
                                    raw_sq_voto = sq_voto
                                    raw_scope = (sg, code, (val(r,"CD_CARGO") or "").strip(), sq_voto)
                                    matches = candidate_2004_by_raw_scope[raw_scope]
                                    if len(matches) == 1:
                                        sq_voto = next(iter(matches))
                                    else:
                                        scope = (*raw_scope, (val(r,"NR_CANDIDATO") or "").strip().lstrip("0"))
                                        matches = candidate_2004_by_scope[scope]
                                        if len(matches) != 1:
                                            candidate_name = normalized_name(val(r,"NM_CANDIDATO"))
                                            matches = candidate_2004_keys[(sg, code, scope[2], scope[4], candidate_name)]
                                        if len(matches) == 1:
                                            sq_voto = next(iter(matches))
                                        else:
                                            raw_number = (val(r,"NR_CANDIDATO") or "").strip().lstrip("0")
                                            candidate_name = normalized_name(val(r,"NM_CANDIDATO"))
                                            scope_key = (*raw_scope, raw_number, candidate_name)
                                            sq_voto = project_sq_2004(scope_key)
                                            # A small number of result rows have no matching registration
                                            # row in the 2004 candidate extract. Preserve the official
                                            # result as a sparse candidacy instead of dropping its votes.
                                            out.put("candidatura", [
                                                val(r,"ANO_ELEICAO",str(year)), val(r,"CD_ELEICAO"), val(r,"NR_TURNO"),
                                                val(r,"CD_TIPO_ELEICAO"), val(r,"NM_TIPO_ELEICAO"), sg, code, val(r,"NM_UE"),
                                                val(r,"CD_CARGO"), val(r,"DS_CARGO"), sq_voto, raw_sq_voto, None,
                                                val(r,"NM_CANDIDATO"), val(r,"NM_URNA_CANDIDATO"), None, None, None, None,
                                                val(r,"NR_PARTIDO"), val(r,"SG_PARTIDO"), val(r,"NM_PARTIDO"),
                                                val(r,"DS_SIT_TOT_TURNO"), f"resultado:{source_file}", None, val(r,"NR_CANDIDATO")
                                            ])
                                if code and sg in UFS and val(r,"NM_MUNICIPIO"):
                                    municipalities.setdefault(code,(code,None,val(r,"NM_MUNICIPIO"),sg,source_file))
                                out.put(source,[val(r,"ANO_ELEICAO",str(year)),sg,val(r,"CD_ELEICAO"),val(r,"NR_TURNO"),val(r,"CD_CARGO"),code,sq_voto,val(r,"QT_VOTOS_NOMINAIS"),source_file])
                            elif source == "votacao_partido_munzona":
                                if sg not in UFS:
                                    continue
                                code=mun_code(val(r,"CD_MUNICIPIO"))
                                if code and sg in UFS and val(r,"NM_MUNICIPIO"):
                                    municipalities.setdefault(code,(code,None,val(r,"NM_MUNICIPIO"),sg,source_file))
                                out.put(source,[val(r,"ANO_ELEICAO",str(year)),sg,val(r,"CD_ELEICAO"),val(r,"NR_TURNO"),val(r,"CD_CARGO"),code,val(r,"NR_PARTIDO"),val(r,"SG_PARTIDO"),val(r,"QT_TOTAL_VOTOS_LEG_VALIDOS",val(r,"QT_VOTOS_LEGENDA")),val(r,"QT_VOTOS_NOMINAIS_VALIDOS",val(r,"QT_VOTOS_NOMINAIS")),source_file])
                            elif source == "detalhe_votacao_munzona":
                                if sg not in UFS:
                                    continue
                                code=mun_code(val(r,"CD_MUNICIPIO"))
                                if code and sg in UFS and val(r,"NM_MUNICIPIO"):
                                    municipalities.setdefault(code,(code,None,val(r,"NM_MUNICIPIO"),sg,source_file))
                                out.put(source,[val(r,"ANO_ELEICAO",str(year)),sg,val(r,"CD_ELEICAO"),val(r,"NR_TURNO"),val(r,"CD_CARGO"),code,val(r,"NR_ZONA"),val(r,"QT_APTOS"),val(r,"QT_COMPARECIMENTO"),val(r,"QT_ABSTENCOES"),source_file])
                                if code and sg in UFS:
                                    expected_zones.add((val(r,"ANO_ELEICAO",str(year)),val(r,"CD_ELEICAO"),val(r,"NR_TURNO"),code,val(r,"NR_ZONA"),digest))
                            elif source == "perfil_eleitorado":
                                if sg not in UFS:
                                    continue
                                code=mun_code(val(r,"CD_MUNICIPIO"))
                                if code and val(r,"NM_MUNICIPIO"):
                                    municipalities.setdefault(code,(code,None,val(r,"NM_MUNICIPIO"),sg,source_file))
                                qty=val(r,"QT_ELEITORES",val(r,"QT_ELEITORES_PERFIL")) or ""
                                age=(val(r,"DS_FAIXA_ETARIA") or "").strip()
                                if code and code.isdigit() and age and qty.isdigit():
                                    profile_counts[(val(r,"ANO_ELEICAO",val(r,"AA_ELEICAO",str(year))),sg,code,age)]+=int(qty)
                                else:
                                    profile_invalid += 1
                        # Consuming every selected CSV to EOF verifies its ZIP CRC.
                manifests.append({"year":year,"source":source,"file":path.name,"sha256":digest,"zip_bytes":path.stat().st_size,"members_selected":selected})
                print(f"{year} {source}: {selected} arquivos",flush=True)

        # The destination grain is municipality/year/age band. Sum the other
        # source dimensions locally so the DB staging does not retain millions
        # of detail rows that 04 immediately aggregates away.
        for (year,sg,code,age),qty in profile_counts.items():
            out.put("perfil_eleitorado_municipio",[year,sg,code,"",age,"","","",qty,"perfil_agregado_local"])
        for row in municipalities.values():
            out.put("municipio_correspondencia",row)
        for z in expected_zones:
            out.put("comparecimento_zonas_esperadas",[*z[:5],z[5],"true"])

        # Only the latest final filing per provider/account is used. Expenses
        # are taken exclusively from DESPESAS_PAGAS; receipts remain separate.
        final_latest = {k:max(v) for k,v in final_dates.items() if v}
        covered = set()
        for year,path,member,kind,source_file in finance_members:
            with zipfile.ZipFile(path) as z:
                for r in rows(z,member):
                    provider=(val(r,"SQ_PRESTADOR_CONTAS","") or "").strip()
                    if not provider or final_latest.get((year,provider)) is None:
                        continue
                    try:
                        dt=datetime.strptime((val(r,"DT_PRESTACAO_CONTAS","") or "").strip(),"%d/%m/%Y")
                    except ValueError:
                        continue
                    if dt != final_latest[(year,provider)] or (val(r,"TP_PRESTACAO_CONTAS","") or "").strip().upper()!="FINAL":
                        continue
                    candidates=account_candidates.get((year,provider),set())
                    if len(candidates)!=1:
                        continue
                    sq=next(iter(candidates))
                    if kind=="receitas_candidatos":
                        sequence=(val(r,"SQ_RECEITA","") or "").strip()
                        if sequence:
                            # SQ_RECEITA pode se repetir até dentro da conta.
                            # Hash da linha original diferencia lançamentos sem
                            # expor seus campos pessoais na chave; cópias
                            # idênticas da mesma linha são gravadas uma vez.
                            fingerprint=hashlib.sha256(json.dumps(
                                r,ensure_ascii=False,sort_keys=True,
                                separators=(",",":")
                            ).encode("utf-8")).hexdigest()[:24]
                            line=f"{provider}:{sequence}:{fingerprint}"
                            key=(year,sq,line)
                            if key in receipt_keys:
                                duplicate_receipt_rows_dropped += 1
                                continue
                            receipt_keys.add(key)
                            out.put("receita_candidato",[year,sq,line,val(r,"DS_FONTE_RECEITA"),val(r,"VR_RECEITA"),None,source_file])
                    else:
                        sequence=(val(r,"SQ_DESPESA","") or "").strip()
                        installment=(val(r,"SQ_PARCELAMENTO_DESPESA","") or "").strip()
                        fingerprint=hashlib.sha256(json.dumps(
                            r,ensure_ascii=False,sort_keys=True,
                            separators=(",",":")
                        ).encode("utf-8")).hexdigest()[:24]
                        # Algumas prestações repetem a mesma linha e SQ_DESPESA
                        # pode ser reutilizado. O hash preserva despesas distintas
                        # e a chave elimina somente cópias exatas.
                        line=":".join([provider,sequence,installment,fingerprint])
                        if line.strip(":"):
                            key=(year,sq,line)
                            if key in expense_keys:
                                duplicate_expense_rows_dropped += 1
                                continue
                            expense_keys.add(key)
                            out.put("despesa_candidato",[year,sq,line,val(r,"DS_DESPESA"),val(r,"DS_ORIGEM_DESPESA"),val(r,"VR_PAGTO_DESPESA"),source_file])
                    covered.add((year,sq))
        # A coverage row is emitted only when an account was identified from a
        # final TSE prestação. No account is silently interpreted as zero cost.
        for year,sq in sorted(covered):
            digest=next((m["sha256"] for m in manifests if m["year"]==year and m["source"].startswith("prestacao_")),"")
            out.put("cobertura_despesa_paga",[year,sq,"true",digest])
        if legacy_ids:
            with (args.output / "legacy_candidate_key_map.csv").open("w",encoding="utf-8",newline="") as f:
                writer=csv.writer(f,delimiter=";",lineterminator="\n")
                writer.writerow(["ano_eleicao","sg_uf","sq_candidato_tse","sq_candidato"])
                for (year,uf,raw_sq),project_sq in sorted(legacy_ids.items()):
                    writer.writerow([year,uf,raw_sq,project_sq])
    finally:
        out.close()
        quarantine_file.close()
    summary={"years":YEARS,"ufs":sorted(UFS),"manifests":manifests,"stage_rows":dict(out.counts),"duplicate_receipt_rows_dropped":duplicate_receipt_rows_dropped,"duplicate_expense_rows_dropped":duplicate_expense_rows_dropped,"finance_unmatched_rows":{f"{y}:{kind}":n for (y,kind),n in finance_unmatched_rows.items()},"historical_vote_unmatched_rows":historical_vote_unmatched,"project_synthetic_2004_candidate_ids":len(candidate_2004_ids),"profile_invalid_source_rows":profile_invalid,"profile_aggregated_groups":len(profile_counts),"stage_csv_bytes":sum(p.stat().st_size for p in args.output.glob("*.csv")),"source_zip_bytes":sum(m["zip_bytes"] for m in manifests),"municipalities":len(municipalities),"expected_zones":len(expected_zones)}
    summary["excluded_supplementary_rows"]={f"{y}:{kind}":n for (y,kind),n in excluded_supplementary_rows.items()}
    summary["sparse_legacy_candidates_from_results"]=len(sparse_legacy_candidates)
    summary["scoped_legacy_candidate_keys"]=len(legacy_ids)
    (args.output/"manifest.json").write_text(json.dumps(summary,ensure_ascii=False,indent=2)+"\n")
    print(json.dumps({k:v for k,v in summary.items() if k!="manifests"},ensure_ascii=False,indent=2))


if __name__=="__main__":
    main()
