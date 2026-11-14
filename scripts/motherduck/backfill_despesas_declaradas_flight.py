"""Template single-file do Flight TSE -> MotherDuck.

O gerador local substitui os tres marcadores por literais Python contendo o
normalizador atual e os SQLs versionados deste diretorio.
"""

import csv
import hashlib
import io
import json
import os
import shutil
import sys
import struct
import time
import urllib.parse
import urllib.request
import zipfile
import zlib
from pathlib import Path

import duckdb

NORMALIZER_SOURCE = '#!/usr/bin/env python3\n"""Normaliza os arquivos TSE de 2004 a 2024 para COPY em stg_tse.\n\nO script não conecta ao banco. Gera CSVs temporários locais, preservando texto\ne sentinelas; a publicação ocorre pelos scripts SQL existentes.\n"""\nfrom __future__ import annotations\n\nimport argparse\nimport csv\nimport hashlib\nimport io\nimport json\nfrom functools import lru_cache\nfrom collections import defaultdict\nfrom datetime import datetime\nfrom pathlib import Path\nimport unicodedata\nimport zipfile\n\nYEARS = (2004, 2006, 2008, 2010, 2012, 2014, 2016, 2018, 2020, 2022, 2024)\nUFS = {"AC", "AL", "BA", "DF", "RO", "SP"}\nSOURCES = (\n    "consulta_cand", "consulta_cand_complementar", "votacao_candidato_munzona",\n    "bem_candidato", "votacao_partido_munzona",\n    "detalhe_votacao_munzona", "perfil_eleitorado",\n    "prestacao_de_contas_eleitorais_candidatos",\n)\n\nSTAGES = {\n    "candidatura": ["ano_eleicao", "cd_eleicao", "nr_turno", "cd_tipo_eleicao", "nm_tipo_eleicao", "sg_uf", "sg_ue", "nm_ue", "cd_cargo", "ds_cargo", "sq_candidato", "sq_candidato_tse", "nr_cpf_candidato", "nm_candidato", "nm_urna_candidato", "dt_nascimento", "ds_grau_instrucao", "ds_genero", "ds_cor_raca", "nr_partido", "sg_partido", "nm_partido", "ds_sit_tot_turno", "source_file", "nr_titulo_eleitoral_candidato", "nr_candidato"],\n    "candidatura_complementar": ["ano_eleicao", "cd_eleicao", "sq_candidato", "nr_turno", "nm_tipo_destinacao_votos", "source_file"],\n    "bem_candidato": ["ano_eleicao", "sq_candidato", "nr_ordem_bem_candidato", "ds_tipo_bem_candidato", "ds_bem_candidato", "vr_bem_candidato", "source_file"],\n    "votacao_candidato_munzona": ["ano_eleicao", "sg_uf", "cd_eleicao", "nr_turno", "cd_cargo", "cd_municipio_tse", "sq_candidato", "qt_votos_nominais", "source_file"],\n    "votacao_partido_munzona": ["ano_eleicao", "sg_uf", "cd_eleicao", "nr_turno", "cd_cargo", "cd_municipio_tse", "nr_partido", "sg_partido", "qt_votos_legenda", "qt_votos_nominais", "source_file"],\n    "detalhe_votacao_munzona": ["ano_eleicao", "sg_uf", "cd_eleicao", "nr_turno", "cd_cargo", "cd_municipio_tse", "nr_zona", "qt_aptos", "qt_comparecimento", "qt_abstencao", "source_file"],\n    "perfil_eleitorado_municipio": ["ano_eleicao", "sg_uf", "cd_municipio_tse", "tp_dimensao", "ds_categoria", "qt_eleitores_perfil", "source_file"],\n    "municipio_correspondencia": ["cd_municipio_tse", "cd_municipio_ibge", "nm_municipio", "sg_uf", "source_file"],\n    "receita_candidato": ["ano_eleicao", "sq_candidato", "id_linha_origem", "ds_fonte_receita", "vr_receita", "tp_origem_recurso", "source_file"],\n    "despesa_candidato": ["ano_eleicao", "sq_candidato", "id_linha_origem", "ds_despesa", "ds_categoria_despesa", "vr_despesa_declarada", "vr_pago", "source_file"],\n    "cobertura_despesa_paga": ["ano_eleicao", "sq_candidato", "completo", "source_manifest"],\n    "comparecimento_zonas_esperadas": ["ano_eleicao", "cd_eleicao", "nr_turno", "cd_municipio_tse", "nr_zona", "source_manifest", "manifesto_verificado"],\n}\n\nALIASES = {\n    "cd_municipio_tse": "CD_MUNICIPIO",\n    "qt_abstencao": "QT_ABSTENCOES",\n    "qt_eleitores_perfil": "QT_ELEITORES",\n    "ds_grau_instrucao": "DS_GRAU_ESCOLARIDADE",\n    "qt_votos_legenda": "QT_TOTAL_VOTOS_LEG_VALIDOS",\n}\n\n\ndef sha256(path: Path) -> str:\n    h = hashlib.sha256()\n    with path.open("rb") as f:\n        for block in iter(lambda: f.read(1024 * 1024), b""):\n            h.update(block)\n    return h.hexdigest()\n\n\nclass Outputs:\n    def __init__(self, root: Path):\n        self.root = root\n        self.files = {}\n        self.writers = {}\n        self.counts = defaultdict(int)\n        root.mkdir(parents=True, exist_ok=True)\n        for table, fields in STAGES.items():\n            path = root / f"{table}.csv"\n            f = path.open("w", encoding="utf-8", newline="")\n            self.files[table] = f\n            self.writers[table] = csv.writer(f, delimiter=";", lineterminator="\\n")\n\n    def put(self, table: str, row):\n        self.writers[table].writerow(["" if x is None else x for x in row])\n        self.counts[table] += 1\n\n    def close(self):\n        for f in self.files.values():\n            f.close()\n\n\ndef rows(archive, member):\n    with archive.open(member) as raw:\n        yield from csv.DictReader(io.TextIOWrapper(raw, encoding="latin1", newline=""), delimiter=";")\n\n\ndef selected_members(names, source, year):\n    extension = ".txt" if source == "prestacao_de_contas_eleitorais_candidatos" and year in (2010, 2012, 2014, 2016) else ".csv"\n    csvs = [n for n in names if n.lower().endswith(extension)]\n    selected = []\n    if source in {"votacao_candidato_munzona", "votacao_partido_munzona", "detalhe_votacao_munzona"}:\n        selected = [n for n in csvs if any(n.upper().endswith(f"_{uf}.CSV") for uf in UFS)]\n        if source == "detalhe_votacao_munzona" and year == 2004:\n            selected += [n for n in csvs if n.upper().endswith("_BRASIL.CSV")]\n    elif source == "perfil_eleitorado" and (year < 2014 or year in (2018, 2020)):\n        selected = [n for n in csvs if n.rsplit("/", 1)[-1].upper() == f"PERFIL_ELEITORADO_{year}.CSV"]\n    elif source == "perfil_eleitorado":\n        selected = [n for n in csvs if any(n.upper().endswith(f"_{uf}.CSV") for uf in UFS)]\n    elif source == "prestacao_de_contas_eleitorais_candidatos":\n        suffix = extension.upper()\n        if year <= 2008:\n            selected = [n for n in csvs if "candidato" in n.rsplit("/", 1)[-1].lower()\n                        and any(k in n.rsplit("/", 1)[-1].lower() for k in ("receita", "despesa"))\n                        and "comite" not in n.lower() and "comitê" not in n.lower()]\n        else:\n            selected = [n for n in csvs if any(n.upper().endswith(f"_{uf}{suffix}") for uf in UFS)\n                        or (any(f"/{uf}/" in n.upper() for uf in UFS)\n                            and "candidato" in n.lower() and "comite" not in n.lower() and "comitê" not in n.lower())]\n    else:\n        selected = [n for n in csvs if any(n.upper().endswith(f"_{uf}.CSV") for uf in UFS) or n.upper().endswith("_BR.CSV")]\n    return sorted(selected)\n\n\ndef val(r, key, default=None):\n    return r.get(key, default)\n\n\n@lru_cache(maxsize=512)\ndef finance_header(value):\n    """Canonicalize a TSE legacy header once; headers repeat on every row."""\n    return "_".join(\n        "".join(ch for ch in unicodedata.normalize("NFKD", value)\n                if not unicodedata.combining(ch)).upper().split()\n    ).replace("Ç", "C")\n\n\ndef finance_fields(row):\n    return {finance_header(name.strip(\'"\')): value for name, value in row.items()}\n\n\ndef finance_val(fields, key, default=None):\n    """Read normalized legacy TSE fields without repeatedly scanning headers."""\n    aliases = {\n        "SQ_CANDIDATO": "SEQUENCIAL_CANDIDATO",\n        "VR_RECEITA": "VALOR_RECEITA",\n        "DS_FONTE_RECEITA": "FONTE_RECURSO",\n        "DS_DESPESA": "DESCRICAO_DA_DESPESA",\n        "DS_CATEGORIA_DESPESA": "TIPO_DESPESA",\n        "VR_DESPESA_DECLARADA": "VR_DESPESA",\n    }\n    canonical = finance_header(key)\n    if canonical in fields:\n        return fields[canonical]\n    wanted = finance_header(aliases.get(key, key))\n    value = fields.get(wanted)\n    if value is not None:\n        return value\n    legacy_aliases = {\n        "DS_FONTE_RECEITA": ("DS_TITULO", "DS_ESP_RECURSO", "TIPO_RECEITA", "DESCRICAO_TIPO_RECEITA", "DESCRICAO_TIPO_RECURSO"),\n        "DS_DESPESA": ("DS_TITULO", "TIPO_DESPESA", "DESCRICAO_DA_DESPESA"),\n        "DS_CATEGORIA_DESPESA": ("DS_ORIGEM_DESPESA", "DS_NATUREZA_DESPESA", "TIPO_DESPESA", "DS_TITULO", "DESCRICAO_DA_DESPESA"),\n        "VR_DESPESA_DECLARADA": ("VR_DESPESA_CONTRATADA", "VALOR_DESPESA", "VL_DESPESA"),\n    }\n    for alias in legacy_aliases.get(key, ()):\n        alias = finance_header(alias)\n        for source_name, value in fields.items():\n            if source_name == alias or alias in source_name:\n                return value if value is not None else default\n    return default\n\n\ndef normalized_name(value):\n    value = unicodedata.normalize("NFKD", (value or "").strip())\n    value = "".join(ch for ch in value if not unicodedata.combining(ch)).upper()\n    return " ".join("".join(ch if ch.isalnum() else " " for ch in value).split())\n\n\ndef mun_code(value):\n    """Normalize TSE numeric municipality codes without losing leading zeroes."""\n    value = (value or "").strip()\n    return value.zfill(5) if value.isdigit() and len(value) < 5 else value\n\n\ndef main():\n    ap = argparse.ArgumentParser()\n    ap.add_argument("--zip-dir", type=Path, default=Path("/tmp/tse_full_2004_2024"))\n    ap.add_argument("--output", type=Path, default=Path("/tmp/tse_railway_stage"))\n    ap.add_argument("--legacy-key-map", type=Path, help="Mapa externo ano/UF/SQ original/SQ projeto para preservar chaves já publicadas de 2006/2008")\n    args = ap.parse_args()\n    out = Outputs(args.output)\n    manifests = []\n    municipalities = {}\n    expected_zones = set()\n    profile_counts = defaultdict(int)\n    profile_invalid = 0\n    account_candidates = defaultdict(set)\n    final_dates = defaultdict(set)\n    finance_members = []\n    finance_files_loaded = set()\n    receipt_keys = set()\n    duplicate_receipt_rows_dropped = 0\n    expense_keys = set()\n    duplicate_expense_rows_dropped = 0\n    candidate_sqs = defaultdict(set)\n    bem_ordem_interna = defaultdict(int)\n    candidate_2004_keys = defaultdict(set)\n    candidate_2004_by_scope = defaultdict(set)\n    candidate_2004_by_raw_scope = defaultdict(set)\n    candidate_2004_finance_number = defaultdict(set)\n    candidate_2004_ids = {}\n    candidate_2004_id_keys = {}\n    historical_vote_unmatched = 0\n    finance_unmatched_rows = defaultdict(int)\n    excluded_supplementary_rows = defaultdict(int)\n    sparse_legacy_candidates = set()\n    legacy_ids = {}\n    legacy_id_scopes = {}\n    legacy_registration_scopes = {}\n    quarantine_file = (args.output / "quarentena_identificadores.jsonl").open("w", encoding="utf-8")\n\n    def quarantine(year, source, source_file, record, reason):\n        quarantine_file.write(json.dumps({"year":year,"source":source,"source_file":source_file,\n                                         "reason":reason,"record":record},ensure_ascii=False)+"\\n")\n    if args.legacy_key_map:\n        with args.legacy_key_map.open(encoding="utf-8", newline="") as f:\n            for row in csv.DictReader(f, delimiter=";"):\n                key = (int(row["ano_eleicao"]), row["sg_uf"], row["sq_candidato_tse"])\n                value = row["sq_candidato"]\n                if key in legacy_ids and legacy_ids[key] != value:\n                    raise RuntimeError("Mapa legado contém duas chaves para o mesmo escopo")\n                if (key[0], value) in legacy_id_scopes and legacy_id_scopes[(key[0], value)] != key:\n                    raise RuntimeError("Mapa legado reutiliza SQ interno entre UFs")\n                legacy_ids[key] = value\n                legacy_id_scopes[(key[0], value)] = key\n\n    def project_sq_legacy(year, uf, raw_sq):\n        key = (year, uf, raw_sq)\n        if key not in legacy_ids:\n            digest = hashlib.blake2b("\\x1f".join(map(str, key)).encode("utf-8"), digest_size=8).digest()\n            value = str(year * 1_000_000_000_000 + int.from_bytes(digest, "big") % 1_000_000_000_000_000)\n            if (year, value) in legacy_id_scopes and legacy_id_scopes[(year, value)] != key:\n                raise RuntimeError("Colisão no SQ interno legado por ano/UF/SQ")\n            legacy_ids[key] = value\n            legacy_id_scopes[(year, value)] = key\n        candidate_sqs[year].add(legacy_ids[key])\n        return legacy_ids[key]\n\n    def project_sq_2004(scope_key):\n        if scope_key not in candidate_2004_ids:\n            id_digest = hashlib.blake2b("\\x1f".join(scope_key).encode("utf-8"), digest_size=8).digest()\n            project_sq = 2_004_000_000_000_000 + int.from_bytes(id_digest, "big") % 1_000_000_000_000_000\n            prior_key = candidate_2004_id_keys.get(project_sq)\n            if prior_key is not None and prior_key != scope_key:\n                raise RuntimeError("Colisão no ID interno derivado para candidatura de 2004")\n            candidate_2004_ids[scope_key] = str(project_sq)\n            candidate_2004_id_keys[project_sq] = scope_key\n        sq = candidate_2004_ids[scope_key]\n        uf, ue, office, source_sq, number, name = scope_key\n        candidate_2004_keys[(uf, ue, office, number, name)].add(sq)\n        candidate_2004_by_scope[(uf, ue, office, source_sq, number)].add(sq)\n        candidate_2004_by_raw_scope[(uf, ue, office, source_sq)].add(sq)\n        candidate_2004_finance_number[(uf, ue, office, number)].add(sq)\n        candidate_sqs[2004].add(sq)\n        return sq\n\n    try:\n        for year in YEARS:\n            for source in SOURCES:\n                if source == "consulta_cand_complementar" and year < 2018:\n                    continue\n                if source == "bem_candidato" and year == 2004:\n                    continue\n                path = args.zip_dir / f"{source}_{year}.zip"\n                if not path.exists():\n                    raise FileNotFoundError(path)\n                digest = sha256(path)\n                bytes_read = 0\n                selected = 0\n                with zipfile.ZipFile(path) as z:\n                    members = selected_members(z.namelist(), source, year)\n                    if not members:\n                        raise RuntimeError(f"Nenhum membro selecionado: {source}/{year}")\n                    for member in members:\n                        selected += 1\n                        base = member.rsplit("/", 1)[-1]\n                        if source == "prestacao_de_contas_eleitorais_candidatos":\n                            if year < 2018:\n                                lower_base = base.lower()\n                                kind = "receitas_candidatos" if "receita" in lower_base else (\n                                    "despesas_candidatos" if "despesa" in lower_base else None\n                                )\n                                if kind is None:\n                                    continue\n                                source_file = base\n                                for row_number, r in enumerate(rows(z, member), start=1):\n                                    fields = finance_fields(r)\n                                    sq = (finance_val(fields, "SQ_CANDIDATO", "") or "").strip()\n                                    if year == 2004:\n                                        state = (fields.get("SG_UE_SUP") or "").strip().upper()\n                                        if state not in UFS:\n                                            continue\n                                        ue = mun_code(fields.get("SG_UE"))\n                                        office = (fields.get("CD_CARGO") or "").strip()\n                                        number = (fields.get("NR_CAND") or "").strip().lstrip("0")\n                                        name = normalized_name(fields.get("NO_CAND"))\n                                        matches = candidate_2004_keys[(state, ue, office, number, name)]\n                                        if len(matches) != 1:\n                                            matches = candidate_2004_finance_number[(state, ue, office, number)]\n                                        sqs = matches\n                                    elif year in (2006, 2008):\n                                        state = (fields.get("SG_UE_SUPERIOR") or fields.get("SG_UE_SUP")\n                                                 or fields.get("UNIDADE_ELEITORAL_CANDIDATO") or "").strip().upper()\n                                        if state not in UFS and state != "BR":\n                                            continue\n                                        scope = legacy_registration_scopes.get((year, state, sq))\n                                        finance_office = (fields.get("CD_CARGO") or fields.get("CODIGO_CARGO") or "").strip()\n                                        finance_ue = (fields.get("SG_UE") or fields.get("UNIDADE_ELEITORAL_CANDIDATO") or "").strip()\n                                        if scope and ((finance_office and finance_office != scope[1])\n                                                      or (finance_ue and mun_code(finance_ue) != scope[0])):\n                                            finance_unmatched_rows[(year, kind + "_escopo_divergente")] += 1\n                                            quarantine(year,kind,source_file,r,"circunscricao_ou_cargo_divergente")\n                                            continue\n                                        mapped = legacy_ids.get((year, state, sq))\n                                        sqs = {mapped} if mapped and mapped in candidate_sqs[year] else set()\n                                    else:\n                                        sqs = {sq} if sq.isdigit() and sq in candidate_sqs[year] else set()\n                                    if len(sqs) != 1:\n                                        finance_unmatched_rows[(year, kind)] += 1\n                                        quarantine(year,kind,source_file,r,"sem_candidatura_univoca")\n                                        continue\n                                    sq = next(iter(sqs))\n                                    fingerprint = f"{source_file}:{row_number}"\n                                    if kind == "receitas_candidatos":\n                                        key = (year, sq, fingerprint)\n                                        if key in receipt_keys:\n                                            duplicate_receipt_rows_dropped += 1\n                                            continue\n                                        receipt_keys.add(key)\n                                        out.put("receita_candidato", [\n                                            year, sq, fingerprint,\n                                            finance_val(fields, "DS_FONTE_RECEITA"),\n                                            finance_val(fields, "VR_RECEITA"), None, source_file\n                                        ])\n                                    else:\n                                        key = (year, sq, fingerprint)\n                                        if key in expense_keys:\n                                            duplicate_expense_rows_dropped += 1\n                                            continue\n                                        expense_keys.add(key)\n                                        # Até 2016 o valor publicado é declarado; em 2018+ a\n                                        # prestação de despesas pagas traz o pagamento realizado.\n                                        out.put("despesa_candidato", [\n                                            year, sq, fingerprint,\n                                            finance_val(fields, "DS_DESPESA"),\n                                            finance_val(fields, "DS_CATEGORIA_DESPESA"),\n                                            finance_val(fields, "VR_DESPESA_DECLARADA"), None, source_file\n                                        ])\n                                continue\n                            kind = next((x for x in ("receitas_candidatos", "despesas_pagas_candidatos", "despesas_contratadas_candidatos") if x in base.lower()), None)\n                            if kind is None or "doador_originario" in base.lower():\n                                continue\n                            finance_files_loaded.add((year, base))\n                            for r in rows(z, member):\n                                provider = val(r, "SQ_PRESTADOR_CONTAS", "")\n                                election = val(r, "AA_ELEICAO", str(year))\n                                tp = (val(r, "TP_PRESTACAO_CONTAS", "") or "").strip().upper()\n                                dt = (val(r, "DT_PRESTACAO_CONTAS", "") or "").strip()\n                                sq = (val(r, "SQ_CANDIDATO", "") or "").strip()\n                                if provider and tp == "FINAL" and dt:\n                                    try:\n                                        final_dates[(year, provider)].add(datetime.strptime(dt, "%d/%m/%Y"))\n                                    except ValueError:\n                                        pass\n                                if provider and sq.isdigit():\n                                    account_candidates[(year, provider)].add(sq)\n                                # contratado é usado somente para vincular conta/candidatura.\n                            if kind in ("receitas_candidatos", "despesas_pagas_candidatos"):\n                                finance_members.append((year, path, member, kind, base))\n                            continue\n\n                        for r in rows(z, member):\n                            sg = (val(r, "SG_UF") or "").strip().upper()\n                            source_file = base\n                            if source in ("consulta_cand", "consulta_cand_complementar", "bem_candidato"):\n                                if source == "consulta_cand":\n                                    # A fonte de candidaturas de 2006 usa código 0\n                                    # para a eleição geral ordinária, enquanto os\n                                    # demais anos do escopo usam 2. As fontes de\n                                    # votação de 2006 já registram o tipo 2; não\n                                    # filtrar pelo código de outra tabela elimina\n                                    # candidaturas e impede o vínculo de votos e contas.\n                                    tipo_eleicao_principal = "0" if year == 2006 else "2"\n                                    if val(r, "CD_TIPO_ELEICAO") != tipo_eleicao_principal:\n                                        continue\n                                    sq = (val(r, "SQ_CANDIDATO") or "").strip()\n                                    sq_tse = sq\n                                    nr_cand = (val(r, "NR_CANDIDATO") or "").strip()\n                                    if year == 2004 and sq.isdigit():\n                                        scope_key = (\n                                            sg, mun_code(val(r, "SG_UE")),\n                                            (val(r, "CD_CARGO") or "").strip(), sq,\n                                            nr_cand.lstrip("0"), normalized_name(val(r, "NM_CANDIDATO")),\n                                        )\n                                        sq = project_sq_2004(scope_key)\n                                    elif year in (2006, 2008) and sq.isdigit():\n                                        key = (year, sg, sq)\n                                        scope = (mun_code(val(r, "SG_UE")), (val(r, "CD_CARGO") or "").strip())\n                                        if key in legacy_registration_scopes and legacy_registration_scopes[key] != scope:\n                                            raise RuntimeError("SQ legado também se repete dentro da UF; ampliar o escopo da chave antes de publicar")\n                                        legacy_registration_scopes[key] = scope\n                                        sq = project_sq_legacy(year, sg, sq)\n                                    if sq.isdigit():\n                                        candidate_sqs[year].add(sq)\n                                    out.put("candidatura", [\n                                        val(r,"ANO_ELEICAO",str(year)), val(r,"CD_ELEICAO"), val(r,"NR_TURNO"),\n                                        val(r,"CD_TIPO_ELEICAO"), val(r,"NM_TIPO_ELEICAO"), sg, mun_code(val(r,"SG_UE")), val(r,"NM_UE"),\n                                        val(r,"CD_CARGO"), val(r,"DS_CARGO"), sq, sq_tse, val(r,"NR_CPF_CANDIDATO"),\n                                        val(r,"NM_CANDIDATO"), val(r,"NM_URNA_CANDIDATO"), val(r,"DT_NASCIMENTO"), val(r,"DS_GRAU_INSTRUCAO"), val(r,"DS_GENERO"),\n                                        val(r,"DS_COR_RACA"), val(r,"NR_PARTIDO"), val(r,"SG_PARTIDO"), val(r,"NM_PARTIDO"),\n                                        val(r,"DS_SIT_TOT_TURNO"), source_file, val(r,"NR_TITULO_ELEITORAL_CANDIDATO"), nr_cand])\n                                elif source == "consulta_cand_complementar":\n                                    out.put("candidatura_complementar", [val(r,"ANO_ELEICAO",str(year)),val(r,"CD_ELEICAO"),val(r,"SQ_CANDIDATO"),val(r,"NR_TURNO"),val(r,"NM_TIPO_DESTINACAO_VOTOS"),source_file])\n                                else:\n                                    code = mun_code(val(r,"CD_MUNICIPIO"))\n                                    nm = val(r,"NM_MUNICIPIO")\n                                    if code and sg in UFS and nm:\n                                        municipalities.setdefault(code,(code,None,nm,sg,source_file))\n                                    bem_year = (val(r,"ANO_ELEICAO",str(year)) or str(year)).strip()\n                                    bem_sq = (val(r,"SQ_CANDIDATO") or "").strip()\n                                    if year in (2006, 2008):\n                                        if val(r, "CD_TIPO_ELEICAO") == "1":\n                                            excluded_supplementary_rows[(year, "bem_candidato")] += 1\n                                            continue\n                                        mapped = legacy_ids.get((year, sg, bem_sq))\n                                        scope = legacy_registration_scopes.get((year, sg, bem_sq))\n                                        if not mapped or (scope and mun_code(val(r,"SG_UE")) != scope[0]):\n                                            finance_unmatched_rows[(year, "bem_candidato")] += 1\n                                            quarantine(year,"bem_candidato",source_file,r,"sem_candidatura_univoca")\n                                            continue\n                                        bem_sq = mapped\n                                    bem_key = (bem_year, bem_sq)\n                                    bem_ordem_interna[bem_key] += 1\n                                    # O número de ordem publicado varia por leiaute e\n                                    # pode se repetir para bens distintos. O DER precisa\n                                    # de um discriminador estável dentro da candidatura;\n                                    # usamos a ordem de leitura determinística do ZIP.\n                                    out.put("bem_candidato", [bem_year,bem_sq,bem_ordem_interna[bem_key],val(r,"DS_TIPO_BEM_CANDIDATO"),val(r,"DS_BEM_CANDIDATO"),val(r,"VR_BEM_CANDIDATO"),source_file])\n                            elif source == "votacao_candidato_munzona":\n                                if sg not in UFS:\n                                    continue\n                                code=mun_code(val(r,"CD_MUNICIPIO"))\n                                sq_voto = (val(r,"SQ_CANDIDATO") or "").strip()\n                                if year in (2006, 2008):\n                                    if val(r, "CD_TIPO_ELEICAO") == "1":\n                                        excluded_supplementary_rows[(year, source)] += 1\n                                        continue\n                                    candidate_uf = "BR" if val(r, "CD_CARGO") == "1" else sg\n                                    raw_sq_voto = sq_voto\n                                    mapped = legacy_ids.get((year, candidate_uf, sq_voto))\n                                    scope = (mun_code(val(r,"SG_UE")), (val(r,"CD_CARGO") or "").strip())\n                                    known_scope = legacy_registration_scopes.get((year,candidate_uf,sq_voto))\n                                    if known_scope and known_scope != scope:\n                                        historical_vote_unmatched += 1\n                                        quarantine(year,source,source_file,r,"circunscricao_ou_cargo_divergente")\n                                        continue\n                                    if not mapped:\n                                        if not sq_voto.isdigit() or int(sq_voto) <= 0 or val(r,"CD_TIPO_ELEICAO") != "2":\n                                            historical_vote_unmatched += 1\n                                            quarantine(year,source,source_file,r,"sem_candidatura_univoca")\n                                            continue\n                                        mapped = project_sq_legacy(year,candidate_uf,sq_voto)\n                                        legacy_registration_scopes[(year,candidate_uf,sq_voto)] = scope\n                                        sparse_legacy_candidates.add((year,candidate_uf,sq_voto))\n                                    if (year,candidate_uf,raw_sq_voto) in sparse_legacy_candidates:\n                                        out.put("candidatura", [\n                                            val(r,"ANO_ELEICAO",str(year)),val(r,"CD_ELEICAO"),val(r,"NR_TURNO"),\n                                            val(r,"CD_TIPO_ELEICAO"),val(r,"NM_TIPO_ELEICAO"),candidate_uf,scope[0],val(r,"NM_UE"),\n                                            val(r,"CD_CARGO"),val(r,"DS_CARGO"),mapped,raw_sq_voto,None,\n                                            val(r,"NM_CANDIDATO"),val(r,"NM_URNA_CANDIDATO"),None,None,None,None,\n                                            val(r,"NR_PARTIDO"),val(r,"SG_PARTIDO"),val(r,"NM_PARTIDO"),\n                                            val(r,"DS_SIT_TOT_TURNO"),f"resultado:{source_file}",None,val(r,"NR_CANDIDATO")\n                                        ])\n                                    sq_voto = mapped\n                                if year == 2004:\n                                    raw_sq_voto = sq_voto\n                                    raw_scope = (sg, code, (val(r,"CD_CARGO") or "").strip(), sq_voto)\n                                    matches = candidate_2004_by_raw_scope[raw_scope]\n                                    if len(matches) == 1:\n                                        sq_voto = next(iter(matches))\n                                    else:\n                                        scope = (*raw_scope, (val(r,"NR_CANDIDATO") or "").strip().lstrip("0"))\n                                        matches = candidate_2004_by_scope[scope]\n                                        if len(matches) != 1:\n                                            candidate_name = normalized_name(val(r,"NM_CANDIDATO"))\n                                            matches = candidate_2004_keys[(sg, code, scope[2], scope[4], candidate_name)]\n                                        if len(matches) == 1:\n                                            sq_voto = next(iter(matches))\n                                        else:\n                                            raw_number = (val(r,"NR_CANDIDATO") or "").strip().lstrip("0")\n                                            candidate_name = normalized_name(val(r,"NM_CANDIDATO"))\n                                            scope_key = (*raw_scope, raw_number, candidate_name)\n                                            sq_voto = project_sq_2004(scope_key)\n                                            # A small number of result rows have no matching registration\n                                            # row in the 2004 candidate extract. Preserve the official\n                                            # result as a sparse candidacy instead of dropping its votes.\n                                            out.put("candidatura", [\n                                                val(r,"ANO_ELEICAO",str(year)), val(r,"CD_ELEICAO"), val(r,"NR_TURNO"),\n                                                val(r,"CD_TIPO_ELEICAO"), val(r,"NM_TIPO_ELEICAO"), sg, code, val(r,"NM_UE"),\n                                                val(r,"CD_CARGO"), val(r,"DS_CARGO"), sq_voto, raw_sq_voto, None,\n                                                val(r,"NM_CANDIDATO"), val(r,"NM_URNA_CANDIDATO"), None, None, None, None,\n                                                val(r,"NR_PARTIDO"), val(r,"SG_PARTIDO"), val(r,"NM_PARTIDO"),\n                                                val(r,"DS_SIT_TOT_TURNO"), f"resultado:{source_file}", None, val(r,"NR_CANDIDATO")\n                                            ])\n                                if code and sg in UFS and val(r,"NM_MUNICIPIO"):\n                                    municipalities.setdefault(code,(code,None,val(r,"NM_MUNICIPIO"),sg,source_file))\n                                out.put(source,[val(r,"ANO_ELEICAO",str(year)),sg,val(r,"CD_ELEICAO"),val(r,"NR_TURNO"),val(r,"CD_CARGO"),code,sq_voto,val(r,"QT_VOTOS_NOMINAIS"),source_file])\n                            elif source == "votacao_partido_munzona":\n                                if sg not in UFS:\n                                    continue\n                                code=mun_code(val(r,"CD_MUNICIPIO"))\n                                if code and sg in UFS and val(r,"NM_MUNICIPIO"):\n                                    municipalities.setdefault(code,(code,None,val(r,"NM_MUNICIPIO"),sg,source_file))\n                                out.put(source,[val(r,"ANO_ELEICAO",str(year)),sg,val(r,"CD_ELEICAO"),val(r,"NR_TURNO"),val(r,"CD_CARGO"),code,val(r,"NR_PARTIDO"),val(r,"SG_PARTIDO"),val(r,"QT_TOTAL_VOTOS_LEG_VALIDOS",val(r,"QT_VOTOS_LEGENDA")),val(r,"QT_VOTOS_NOMINAIS_VALIDOS",val(r,"QT_VOTOS_NOMINAIS")),source_file])\n                            elif source == "detalhe_votacao_munzona":\n                                if sg not in UFS:\n                                    continue\n                                code=mun_code(val(r,"CD_MUNICIPIO"))\n                                if code and sg in UFS and val(r,"NM_MUNICIPIO"):\n                                    municipalities.setdefault(code,(code,None,val(r,"NM_MUNICIPIO"),sg,source_file))\n                                out.put(source,[val(r,"ANO_ELEICAO",str(year)),sg,val(r,"CD_ELEICAO"),val(r,"NR_TURNO"),val(r,"CD_CARGO"),code,val(r,"NR_ZONA"),val(r,"QT_APTOS"),val(r,"QT_COMPARECIMENTO"),val(r,"QT_ABSTENCOES"),source_file])\n                                if code and sg in UFS:\n                                    expected_zones.add((val(r,"ANO_ELEICAO",str(year)),val(r,"CD_ELEICAO"),val(r,"NR_TURNO"),code,val(r,"NR_ZONA"),digest))\n                            elif source == "perfil_eleitorado":\n                                if sg not in UFS:\n                                    continue\n                                code=mun_code(val(r,"CD_MUNICIPIO"))\n                                if code and val(r,"NM_MUNICIPIO"):\n                                    municipalities.setdefault(code,(code,None,val(r,"NM_MUNICIPIO"),sg,source_file))\n                                qty=val(r,"QT_ELEITORES",val(r,"QT_ELEITORES_PERFIL")) or ""\n                                election_year=val(r,"ANO_ELEICAO",val(r,"AA_ELEICAO",str(year)))\n                                dimensions=(\n                                    ("FAIXA_ETARIA", val(r,"DS_FAIXA_ETARIA")),\n                                    ("GENERO", val(r,"DS_GENERO")),\n                                    ("ESTADO_CIVIL", val(r,"DS_ESTADO_CIVIL")),\n                                    ("GRAU_INSTRUCAO", val(r,"DS_GRAU_INSTRUCAO")),\n                                )\n                                present=[(kind,(category or "").strip()) for kind,category in dimensions if (category or "").strip()]\n                                if code and code.isdigit() and present and qty.isdigit():\n                                    for kind,category in present:\n                                        profile_counts[(election_year,sg,code,kind,category)]+=int(qty)\n                                else:\n                                    profile_invalid += 1\n                        # Consuming every selected CSV to EOF verifies its ZIP CRC.\n                manifests.append({"year":year,"source":source,"file":path.name,"sha256":digest,"zip_bytes":path.stat().st_size,"members_selected":selected})\n                print(f"{year} {source}: {selected} arquivos",flush=True)\n\n        # The destination grain is municipality/year/age band. Sum the other\n        # source dimensions locally so the DB staging does not retain millions\n        # of detail rows that 04 immediately aggregates away.\n        for (year,sg,code,dimension,category),qty in profile_counts.items():\n            out.put("perfil_eleitorado_municipio",[year,sg,code,dimension,category,qty,"perfil_agregado_local"])\n        for row in municipalities.values():\n            out.put("municipio_correspondencia",row)\n        for z in expected_zones:\n            out.put("comparecimento_zonas_esperadas",[*z[:5],z[5],"true"])\n\n        # Only the latest final filing per provider/account is used. Expenses\n        # are taken exclusively from DESPESAS_PAGAS; receipts remain separate.\n        final_latest = {k:max(v) for k,v in final_dates.items() if v}\n        covered = set()\n        for year,path,member,kind,source_file in finance_members:\n            with zipfile.ZipFile(path) as z:\n                for r in rows(z,member):\n                    provider=(val(r,"SQ_PRESTADOR_CONTAS","") or "").strip()\n                    if not provider or final_latest.get((year,provider)) is None:\n                        continue\n                    try:\n                        dt=datetime.strptime((val(r,"DT_PRESTACAO_CONTAS","") or "").strip(),"%d/%m/%Y")\n                    except ValueError:\n                        continue\n                    if dt != final_latest[(year,provider)] or (val(r,"TP_PRESTACAO_CONTAS","") or "").strip().upper()!="FINAL":\n                        continue\n                    candidates=account_candidates.get((year,provider),set())\n                    if len(candidates)!=1:\n                        continue\n                    sq=next(iter(candidates))\n                    if kind=="receitas_candidatos":\n                        sequence=(val(r,"SQ_RECEITA","") or "").strip()\n                        if sequence:\n                            # SQ_RECEITA pode se repetir até dentro da conta.\n                            # Hash da linha original diferencia lançamentos sem\n                            # expor seus campos pessoais na chave; cópias\n                            # idênticas da mesma linha são gravadas uma vez.\n                            fingerprint=hashlib.sha256(json.dumps(\n                                r,ensure_ascii=False,sort_keys=True,\n                                separators=(",",":")\n                            ).encode("utf-8")).hexdigest()[:24]\n                            line=f"{provider}:{sequence}:{fingerprint}"\n                            key=(year,sq,line)\n                            if key in receipt_keys:\n                                duplicate_receipt_rows_dropped += 1\n                                continue\n                            receipt_keys.add(key)\n                            out.put("receita_candidato",[year,sq,line,val(r,"DS_FONTE_RECEITA"),val(r,"VR_RECEITA"),None,source_file])\n                    else:\n                        sequence=(val(r,"SQ_DESPESA","") or "").strip()\n                        installment=(val(r,"SQ_PARCELAMENTO_DESPESA","") or "").strip()\n                        fingerprint=hashlib.sha256(json.dumps(\n                            r,ensure_ascii=False,sort_keys=True,\n                            separators=(",",":")\n                        ).encode("utf-8")).hexdigest()[:24]\n                        # Algumas prestações repetem a mesma linha e SQ_DESPESA\n                        # pode ser reutilizado. O hash preserva despesas distintas\n                        # e a chave elimina somente cópias exatas.\n                        line=":".join([provider,sequence,installment,fingerprint])\n                        if line.strip(":"):\n                            key=(year,sq,line)\n                            if key in expense_keys:\n                                duplicate_expense_rows_dropped += 1\n                                continue\n                            expense_keys.add(key)\n                            if year <= 2016:\n                                fields = finance_fields(r)\n                                descricao = finance_val(fields, "DS_DESPESA")\n                                categoria = finance_val(fields, "DS_CATEGORIA_DESPESA")\n                                declarado = finance_val(fields, "VR_DESPESA_DECLARADA")\n                                pago = None\n                            else:\n                                descricao = val(r, "DS_DESPESA")\n                                categoria = val(r, "DS_ORIGEM_DESPESA")\n                                declarado = None\n                                pago = val(r, "VR_PAGTO_DESPESA")\n                            out.put("despesa_candidato", [year, sq, line, descricao, categoria, declarado, pago, source_file])\n                    covered.add((year,sq))\n        # A coverage row is emitted only when an account was identified from a\n        # final TSE prestação. No account is silently interpreted as zero cost.\n        for year,sq in sorted(covered):\n            digest=next((m["sha256"] for m in manifests if m["year"]==year and m["source"].startswith("prestacao_")),"")\n            out.put("cobertura_despesa_paga",[year,sq,"true",digest])\n        if legacy_ids:\n            with (args.output / "legacy_candidate_key_map.csv").open("w",encoding="utf-8",newline="") as f:\n                writer=csv.writer(f,delimiter=";",lineterminator="\\n")\n                writer.writerow(["ano_eleicao","sg_uf","sq_candidato_tse","sq_candidato"])\n                for (year,uf,raw_sq),project_sq in sorted(legacy_ids.items()):\n                    writer.writerow([year,uf,raw_sq,project_sq])\n    finally:\n        out.close()\n        quarantine_file.close()\n    summary={"years":YEARS,"ufs":sorted(UFS),"manifests":manifests,"stage_rows":dict(out.counts),"duplicate_receipt_rows_dropped":duplicate_receipt_rows_dropped,"duplicate_expense_rows_dropped":duplicate_expense_rows_dropped,"finance_unmatched_rows":{f"{y}:{kind}":n for (y,kind),n in finance_unmatched_rows.items()},"historical_vote_unmatched_rows":historical_vote_unmatched,"project_synthetic_2004_candidate_ids":len(candidate_2004_ids),"profile_invalid_source_rows":profile_invalid,"profile_aggregated_groups":len(profile_counts),"stage_csv_bytes":sum(p.stat().st_size for p in args.output.glob("*.csv")),"source_zip_bytes":sum(m["zip_bytes"] for m in manifests),"municipalities":len(municipalities),"expected_zones":len(expected_zones)}\n    summary["excluded_supplementary_rows"]={f"{y}:{kind}":n for (y,kind),n in excluded_supplementary_rows.items()}\n    summary["sparse_legacy_candidates_from_results"]=len(sparse_legacy_candidates)\n    summary["scoped_legacy_candidate_keys"]=len(legacy_ids)\n    (args.output/"manifest.json").write_text(json.dumps(summary,ensure_ascii=False,indent=2)+"\\n")\n    print(json.dumps({k:v for k,v in summary.items() if k!="manifests"},ensure_ascii=False,indent=2))\n\n\nif __name__=="__main__":\n    main()\n'
MODEL_SQL = ''
VIEWS_SQL = '-- Views analíticas do modelo TSE para DuckDB/MotherDuck.\n-- Pré-requisito: as 11 tabelas do DER já devem estar no schema public\n-- do banco BDR-TSE.\n-- Execute conectado ao banco BDR-TSE.\n\nCREATE SCHEMA IF NOT EXISTS public;\n\nCREATE OR REPLACE VIEW public.v_partidos_eleitos AS\nSELECT\n    c.ano_eleicao,\n    COALESCE(m.sg_uf, c.sg_ue) AS uf,\n    c.nr_partido,\n    c.sg_partido,\n    CASE WHEN p.sg_partido = c.sg_partido THEN p.nm_partido END AS nm_partido,\n    c.ds_cargo,\n    COUNT(*) AS qt_eleitos\nFROM public.candidatura c\nLEFT JOIN public.municipio m\n    ON m.cd_municipio_tse = c.cd_municipio_tse\nLEFT JOIN public.partido p\n    ON p.nr_partido = c.nr_partido\nWHERE c.ds_sit_tot_turno IN (\'ELEITO\', \'ELEITO POR QP\', \'ELEITO POR MÉDIA\')\n  AND c.ds_cargo NOT LIKE \'%VICE%\'\n  AND c.ds_cargo NOT LIKE \'%SUPLENTE%\'\nGROUP BY 1, 2, 3, 4, 5, 6;\n\n-- Mantém a view existente usada pelo mapa. As quatro faixas são intervalos\n-- iguais em reais (WIDTH_BUCKET), e não quartis por quantidade de candidatos.\nCREATE OR REPLACE VIEW public.v_gasto_sucesso AS\nWITH gastos_candidato AS (\n    SELECT ano_eleicao, sq_candidato,\n           SUM(COALESCE(vr_pago, vr_despesa_declarada)) AS total_gasto,\n           CASE WHEN COUNT(vr_pago) > 0 THEN \'PAGO\' ELSE \'DECLARADO\' END AS base_valor\n    FROM public.despesas_pagas\n    GROUP BY ano_eleicao, sq_candidato\n),\nbase_candidatos AS (\n    SELECT\n        c.ano_eleicao,\n        COALESCE(m.sg_uf, c.sg_ue) AS uf,\n        c.ds_cargo,\n        c.sq_candidato,\n        CASE\n            WHEN c.ds_sit_tot_turno IN (\'ELEITO\', \'ELEITO POR QP\', \'ELEITO POR MÉDIA\') THEN 1\n            ELSE 0\n        END AS flag_eleito,\n        g.total_gasto,\n        g.base_valor,\n        MAX(g.total_gasto) OVER (\n            PARTITION BY c.ano_eleicao, COALESCE(m.sg_uf, c.sg_ue), c.ds_cargo, g.base_valor\n        ) AS teto_maximo_cargo_ano\n    FROM public.candidatura c\n    LEFT JOIN public.municipio m\n        ON c.cd_municipio_tse = m.cd_municipio_tse\n    INNER JOIN gastos_candidato g\n        USING (ano_eleicao, sq_candidato)\n    WHERE c.ds_cargo NOT LIKE \'%VICE%\'\n      AND c.ds_cargo NOT LIKE \'%SUPLENTE%\'\n      AND c.ds_sit_tot_turno NOT IN (\n          \'INDEFERIDO\', \'CASSADO\', \'FALECIDO\', \'CANCELADO\',\n          \'NÃO CONHECIDO\', \'RENÚNCIA\'\n      )\n      AND c.ds_sit_tot_turno IS NOT NULL\n      AND g.total_gasto IS NOT NULL\n),\nfaixas_gasto AS (\n    SELECT\n        *,\n        CASE\n            WHEN total_gasto < 0 THEN 0\n            WHEN total_gasto >= teto_maximo_cargo_ano + 0.01 THEN 5\n            ELSE CAST(FLOOR(total_gasto * 4 / (teto_maximo_cargo_ano + 0.01)) AS INTEGER) + 1\n        END AS faixa_financeira\n    FROM base_candidatos\n)\nSELECT\n    ano_eleicao,\n    uf,\n    ds_cargo,\n    faixa_financeira,\n    base_valor,\n    ROUND((MAX(teto_maximo_cargo_ano) + 0.01) * (faixa_financeira - 1) / 4, 2)\n        AS limite_inferior_faixa,\n    ROUND((MAX(teto_maximo_cargo_ano) + 0.01) * faixa_financeira / 4, 2)\n        AS limite_superior_faixa,\n    CAST(MIN(total_gasto) AS DECIMAL(14, 2)) AS piso_faixa,\n    CAST(MAX(total_gasto) AS DECIMAL(14, 2)) AS teto_faixa,\n    COUNT(*) AS qtd_candidatos_na_faixa,\n    SUM(flag_eleito) AS qtd_eleitos,\n    ROUND(SUM(flag_eleito)::DECIMAL / COUNT(*) * 100, 2) AS taxa_sucesso_pct,\n    ROUND(AVG(total_gasto) FILTER (WHERE flag_eleito = 1), 2) AS media_gasto_eleitos,\n    ROUND(AVG(total_gasto) FILTER (WHERE flag_eleito = 0), 2) AS media_gasto_nao_eleitos,\n    CAST(quantile_cont(total_gasto, 0.5) FILTER (WHERE flag_eleito = 1) AS DECIMAL(14, 2))\n        AS mediana_gasto_eleitos,\n    CAST(quantile_cont(total_gasto, 0.5) FILTER (WHERE flag_eleito = 0) AS DECIMAL(14, 2))\n        AS mediana_gasto_nao_eleitos\nFROM faixas_gasto\nGROUP BY ano_eleicao, uf, ds_cargo, base_valor, faixa_financeira;\n\n-- View oficial da Questão 2, conforme definição validada pelo grupo.\n-- Mantém a saída usada no HTML e deriva da regra financeira acima.\nCREATE OR REPLACE VIEW public.vw_questao_2_despesas AS\nSELECT\n    ano_eleicao,\n    uf,\n    ds_cargo,\n    faixa_financeira,\n    base_valor,\n    piso_faixa AS "piso_faixa_r$",\n    teto_faixa AS "teto_faixa_r$",\n    qtd_candidatos_na_faixa,\n    qtd_eleitos,\n    taxa_sucesso_pct,\n    media_gasto_eleitos,\n    media_gasto_nao_eleitos,\n    mediana_gasto_eleitos,\n    mediana_gasto_nao_eleitos\nFROM public.v_gasto_sucesso;\n\n-- Histórico por candidatura. JSON/JSONB PostgreSQL é representado como JSON\n-- DuckDB; list(...) preserva o conteúdo aninhado consumido pela interface.\nCREATE OR REPLACE VIEW public.v_historico_candidato AS\nWITH receita_linhas AS (\n    SELECT\n        rc.ano_eleicao,\n        rc.sq_candidato,\n        rc.ds_fonte_receita AS fonte,\n        COALESCE(\n            NULLIF(rc.tp_origem_recurso, \'\'),\n            CASE\n                WHEN rc.ds_fonte_receita IN (\'FUNDO ESPECIAL\', \'FUNDO PARTIDARIO\') THEN \'PÚBLICO\'\n                WHEN rc.ds_fonte_receita = \'OUTROS RECURSOS\' THEN \'PRIVADO\'\n                ELSE \'INDEFINIDO\'\n            END\n        ) AS origem,\n        SUM(rc.vr_receita) AS valor,\n        COUNT(*) AS qtd\n    FROM public.receitas_campanha rc\n    GROUP BY 1, 2, 3, 4\n),\nreceitas AS (\n    SELECT\n        ano_eleicao,\n        sq_candidato,\n        SUM(valor) AS total_receitas,\n        SUM(valor) FILTER (WHERE origem = \'PÚBLICO\') AS receitas_publicas,\n        SUM(valor) FILTER (WHERE origem = \'PRIVADO\') AS receitas_privadas,\n        TO_JSON(LIST(\n            STRUCT_PACK(fonte := fonte, origem := origem, valor := valor, qtd := qtd)\n            ORDER BY valor DESC\n        )) AS receitas\n    FROM receita_linhas\n    GROUP BY 1, 2\n),\ndespesa_linhas AS (\n    SELECT\n        dp.ano_eleicao,\n        dp.sq_candidato,\n        dp.ds_despesa,\n        COALESCE(dp.vr_pago, dp.vr_despesa_declarada) AS valor,\n        CASE WHEN dp.vr_pago IS NOT NULL THEN \'PAGO\'\n             WHEN dp.vr_despesa_declarada IS NOT NULL THEN \'DECLARADO\' END AS base_valor,\n        ROW_NUMBER() OVER (\n            PARTITION BY dp.ano_eleicao, dp.sq_candidato\n            ORDER BY COALESCE(dp.vr_pago, dp.vr_despesa_declarada) DESC NULLS LAST\n        ) AS rn\n    FROM public.despesas_pagas dp\n),\ndespesas AS (\n    SELECT\n        ano_eleicao,\n        sq_candidato,\n        SUM(valor) AS total_despesas,\n        COUNT(*) AS qt_despesas,\n        COUNT(valor) AS qt_despesas_com_valor,\n        CASE WHEN COUNT(*) FILTER (WHERE base_valor = \'PAGO\') > 0 THEN \'PAGO\'\n             WHEN COUNT(*) FILTER (WHERE base_valor = \'DECLARADO\') > 0 THEN \'DECLARADO\' END AS base_despesa,\n        TO_JSON(LIST(\n            STRUCT_PACK(despesa := ds_despesa, valor := valor, base_valor := base_valor)\n            ORDER BY valor DESC NULLS LAST\n        ) FILTER (WHERE rn <= 8)) AS despesas\n    FROM despesa_linhas\n    GROUP BY 1, 2\n),\nbens AS (\n    SELECT\n        bd.ano_eleicao,\n        bd.sq_candidato,\n        SUM(bd.vr_bem) AS total_bens,\n        TO_JSON(LIST(\n            STRUCT_PACK(\n                tipo := bd.ds_tipo_bem,\n                descricao := NULLIF(bd.ds_bem, \'#NULO#\'),\n                valor := bd.vr_bem\n            ) ORDER BY bd.vr_bem DESC NULLS LAST\n        )) AS bens\n    FROM public.bens_declarados bd\n    GROUP BY 1, 2\n)\nSELECT\n    c.id_pessoa_projeto,\n    c.ano_eleicao,\n    c.sq_candidato,\n    ca.nm_candidato,\n    c.nm_urna_candidato,\n    c.sg_partido AS partido,\n    c.ds_cargo AS cargo,\n    COALESCE(m.sg_uf, c.sg_ue) AS uf,\n    c.cd_municipio_tse AS municipio,\n    m.nm_municipio,\n    c.nr_turno_resultado AS turno,\n    c.ds_sit_tot_turno AS situacao,\n    c.qt_votos_totais AS votos,\n    COALESCE(r.total_receitas, 0) AS total_receitas,\n    COALESCE(r.receitas_publicas, 0) AS receitas_publicas,\n    COALESCE(r.receitas_privadas, 0) AS receitas_privadas,\n    COALESCE(r.receitas, \'[]\'::JSON) AS receitas,\n    d.total_despesas AS total_despesas,\n    COALESCE(d.qt_despesas, 0) AS qt_despesas,\n    COALESCE(d.qt_despesas_com_valor, 0) AS qt_despesas_com_valor,\n    d.base_despesa,\n    COALESCE(d.despesas, \'[]\'::JSON) AS despesas,\n    COALESCE(b.total_bens, 0) AS patrimonio_declarado,\n    COALESCE(b.bens, \'[]\'::JSON) AS bens\nFROM public.candidatura c\nJOIN public.candidato ca\n    ON ca.id_pessoa_projeto = c.id_pessoa_projeto\nLEFT JOIN public.municipio m\n    ON m.cd_municipio_tse = c.cd_municipio_tse\nLEFT JOIN receitas r\n    USING (ano_eleicao, sq_candidato)\nLEFT JOIN despesas d\n    USING (ano_eleicao, sq_candidato)\nLEFT JOIN bens b\n    USING (ano_eleicao, sq_candidato);\n\n-- Q9: nuvens de palavras das descrições de despesas de propaganda.\n-- Banco BDR-TSE, schema public. Requer DS_ORIGEM_DESPESA carregada em\n-- despesas_pagas.ds_categoria_despesa. Nenhuma tabela auxiliar persistente.\n-- Escopo explícito: publicidade, produção de comunicação, internet,\n-- eventos/comícios e mobilização de rua. Não inferir propaganda de rubricas\n-- genéricas como pessoal ou serviços de terceiros.\n\nCREATE OR REPLACE VIEW public.vw_questao_9_nuvem_valor AS\nWITH propaganda AS (\n    SELECT ano_eleicao,sq_candidato,id_despesa,ds_despesa,\n           COALESCE(vr_pago,vr_despesa_declarada) AS valor_despesa,\n           CASE WHEN vr_pago IS NOT NULL THEN \'PAGO\' ELSE \'DECLARADO\' END AS base_valor\n    FROM public.despesas_pagas\n    WHERE LOWER(strip_accents(TRIM(ds_categoria_despesa))) IN (\n        \'publicidade por carros de som\',\n        \'publicidade por adesivos\',\n        \'publicidade por jornais e revistas\',\n        \'publicidade por materiais impressos\',\n        \'producao de programas de radio, televisao ou video\',\n        \'producao de jingles, vinhetas e slogans\',\n        \'criacao e inclusao de paginas na internet\',\n        \'despesa com impulsionamento de conteudos\',\n        \'eventos de promocao da candidatura\',\n        \'comicios\',\n        \'atividades de militancia e mobilizacao de rua\'\n    )\n      AND ds_despesa IS NOT NULL\n), tokens AS (\n    -- Um termo conta uma vez por lançamento, mesmo se repetido na descrição.\n    SELECT DISTINCT p.ano_eleicao,p.sq_candidato,p.id_despesa,p.valor_despesa,p.base_valor,t.termo\n    FROM propaganda p,\n         UNNEST(regexp_split_to_array(\n             LOWER(strip_accents(p.ds_despesa)), \'[^a-z]+\'\n         )) AS t(termo)\n    WHERE LENGTH(t.termo) >= 3\n      AND t.termo NOT IN (\n        \'com\',\'para\',\'por\',\'dos\',\'das\',\'uma\',\'uns\',\'umas\',\'que\',\'como\',\'sem\',\n        \'sob\',\'sobre\',\'entre\',\'este\',\'esta\',\'esse\',\'essa\',\'estes\',\'estas\',\n        \'esses\',\'essas\',\'pelo\',\'pela\',\'pelos\',\'pelas\',\'seu\',\'sua\',\'seus\',\'suas\',\n        \'foi\',\'sao\',\'ser\',\'dia\',\'dias\',\'mes\',\'meses\',\'ano\',\'anos\',\n        \'servico\',\'servicos\',\'prestacao\',\'prestado\',\'prestados\',\'prestada\',\n        \'prestadas\',\'referente\',\'referentes\',\'conforme\',\'contrato\',\'contratos\',\n        \'contratacao\',\'pagamento\',\'pagamentos\',\'pago\',\'paga\',\'pagos\',\'pagas\',\n        \'nota\',\'notas\',\'fiscal\',\'fiscais\',\'nfe\',\'nfse\',\'recibo\',\'recibos\',\n        \'eleicao\',\'eleicoes\',\'eleitoral\',\'eleitorais\',\'campanha\',\'campanhas\',\n        \'candidato\',\'candidatos\',\'candidata\',\'candidatas\',\'candidatura\',\n        \'realizado\',\'realizada\',\'realizados\',\'realizadas\'\n      )\n), termos AS (\n    SELECT ano_eleicao,sq_candidato,termo,\n           SUM(valor_despesa) AS valor_associado,\n           CASE WHEN COUNT(DISTINCT base_valor) = 1 THEN MIN(base_valor) ELSE \'MISTO\' END AS base_valor,\n           COUNT(*) AS qt_lancamentos\n    FROM tokens\n    GROUP BY 1,2,3\n)\nSELECT t.ano_eleicao,t.sq_candidato,c.id_pessoa_projeto,\n       pessoa.nm_candidato,c.nm_urna_candidato,\n       COALESCE(m.sg_uf,c.sg_ue) AS uf,c.cd_municipio_tse,\n       c.ds_cargo,c.nr_partido,c.sg_partido,t.termo,\n       t.valor_associado,t.base_valor,t.qt_lancamentos,\n       t.valor_associado AS peso\nFROM termos t\nJOIN public.candidatura c USING(ano_eleicao,sq_candidato)\nLEFT JOIN public.candidato pessoa USING(id_pessoa_projeto)\nLEFT JOIN public.municipio m USING(cd_municipio_tse);\n\n-- Mesmos termos, universo e métricas; só muda o peso visual.\n-- Frequência = lançamentos que contêm a palavra, não unidades adquiridas\n-- nem número garantido de compras/contratos (podem existir parcelas).\nCREATE OR REPLACE VIEW public.vw_questao_9_nuvem_frequencia AS\nSELECT * EXCLUDE(peso),qt_lancamentos AS peso\nFROM public.vw_questao_9_nuvem_valor;\n\n-- Nuvem agregada por estado/ano: mantém anos históricos sem valor pago para\n-- que a frequência possa ser analisada sem tratar valores ausentes como zero.\nCREATE OR REPLACE VIEW public.vw_questao_9_nuvem_geral AS\nWITH propaganda AS (\n    SELECT ano_eleicao,sq_candidato,id_despesa,ds_despesa,\n           COALESCE(vr_pago,vr_despesa_declarada) AS valor_despesa,\n           CASE WHEN vr_pago IS NOT NULL THEN \'PAGO\' ELSE \'DECLARADO\' END AS base_valor\n    FROM public.despesas_pagas\n    WHERE REGEXP_REPLACE(\n            REGEXP_REPLACE(LOWER(strip_accents(TRIM(ds_categoria_despesa))),\n                \'^baixa( de)? estimaveis\\s*-\\s*\', \'\'),\n            \'^baixa recursos estimaveis\\s*-\\s*\', \'\') IN (\n        \'publicidade por carros de som\',\n        \'publicidade por adesivos\',\n        \'publicidade por jornais e revistas\',\n        \'publicidade por materiais impressos\',\n        \'publicidade por placas, estandartes e faixas\',\n        \'publicidade por telemarketing\',\n        \'propagandas e publicidade\',\n        \'impressos\',\n        \'aquisicao, confeccao e distribuicao de brindes\',\n        \'caches de artistas ou animadores\',\n        \'eventos promocionais\',\n        \'producao de programas de radio, televisao ou video\',\n        \'producao de jingles, vinhetas e slogans\',\n        \'criacao e inclusao de paginas na internet\',\n        \'despesa com impulsionamento de conteudos\',\n        \'eventos de promocao da candidatura\',\n        \'comicios\',\n        \'atividades de militancia e mobilizacao de rua\'\n    ) AND ds_despesa IS NOT NULL\n), tokens AS (\n    SELECT DISTINCT p.ano_eleicao,p.sq_candidato,p.id_despesa,p.valor_despesa,p.base_valor,t.termo\n    FROM propaganda p,\n         UNNEST(regexp_split_to_array(LOWER(strip_accents(p.ds_despesa)), \'[^a-z]+\')) AS t(termo)\n    WHERE LENGTH(t.termo) >= 3\n      AND t.termo NOT IN (\n        \'com\',\'para\',\'por\',\'dos\',\'das\',\'uma\',\'uns\',\'umas\',\'que\',\'como\',\'sem\',\'sob\',\'sobre\',\'entre\',\n        \'este\',\'esta\',\'esse\',\'essa\',\'estes\',\'estas\',\'esses\',\'essas\',\'pelo\',\'pela\',\'pelos\',\'pelas\',\n        \'seu\',\'sua\',\'seus\',\'suas\',\'foi\',\'sao\',\'ser\',\'dia\',\'dias\',\'mes\',\'meses\',\'ano\',\'anos\',\n        \'servico\',\'servicos\',\'prestacao\',\'prestado\',\'prestados\',\'prestada\',\'prestadas\',\'referente\',\n        \'referentes\',\'conforme\',\'contrato\',\'contratos\',\'contratacao\',\'pagamento\',\'pagamentos\',\n        \'pago\',\'paga\',\'pagos\',\'pagas\',\'nota\',\'notas\',\'fiscal\',\'fiscais\',\'nfe\',\'nfse\',\'recibo\',\'recibos\',\n        \'eleicao\',\'eleicoes\',\'eleitoral\',\'eleitorais\',\'campanha\',\'campanhas\',\'candidato\',\'candidatos\',\n        \'candidata\',\'candidatas\',\'candidatura\',\'realizado\',\'realizada\',\'realizados\',\'realizadas\'\n      )\n), termos AS (\n    SELECT ano_eleicao,sq_candidato,termo,SUM(valor_despesa) AS valor_associado,\n           CASE WHEN COUNT(DISTINCT base_valor) = 1 THEN MIN(base_valor) ELSE \'MISTO\' END AS base_valor,\n           COUNT(*) AS qt_lancamentos\n    FROM tokens GROUP BY 1,2,3\n)\nSELECT t.ano_eleicao,t.sq_candidato,c.id_pessoa_projeto,pessoa.nm_candidato,c.nm_urna_candidato,\n       COALESCE(m.sg_uf,c.sg_ue) AS uf,c.cd_municipio_tse,c.ds_cargo,c.nr_partido,c.sg_partido,\n       t.termo,t.valor_associado,t.base_valor,t.qt_lancamentos\nFROM termos t\nJOIN public.candidatura c USING(ano_eleicao,sq_candidato)\nLEFT JOIN public.candidato pessoa USING(id_pessoa_projeto)\nLEFT JOIN public.municipio m USING(cd_municipio_tse);\n\n-- Exemplo (substitua o SQ pela candidatura desejada):\n-- SELECT termo,peso,valor_associado,base_valor,qt_lancamentos\n-- FROM public.vw_questao_9_nuvem_valor\n-- WHERE ano_eleicao=2024 AND sq_candidato=250002118287\n-- ORDER BY peso DESC,termo LIMIT 80;\n-- Troque o nome da view por vw_questao_9_nuvem_frequencia para frequência.\n-- Uma despesa pode conter várias palavras; somar pesos de palavras\n-- diferentes não equivale ao orçamento total. Filtre ano E SQ sempre.\n\n-- Views que existiam no banco publicado antes da expansão histórica.\n-- Mantidas aqui para que a recriação do banco não as descarte.\n\nCREATE OR REPLACE VIEW public.vw_questao_1_custo_cadeira AS\nWITH despesa AS (\n    SELECT ano_eleicao, sq_candidato,\n           SUM(COALESCE(vr_pago, vr_despesa_declarada)) AS valor,\n           CASE WHEN COUNT(vr_pago) > 0 THEN \'PAGO\'\n                WHEN COUNT(vr_despesa_declarada) > 0 THEN \'DECLARADO\' END AS base_valor\n    FROM public.despesas_pagas\n    GROUP BY 1, 2\n), candidaturas AS (\n    SELECT c.ano_eleicao, c.cd_cargo, c.ds_cargo,\n           COALESCE(m.sg_uf, c.sg_ue) AS uf,\n           CASE WHEN c.cd_cargo IN (11, 13) THEN c.cd_municipio_tse END AS cd_municipio_tse,\n           CASE WHEN c.ds_sit_tot_turno IN (\'ELEITO\', \'ELEITO POR QP\', \'ELEITO POR MÉDIA\', \'MÉDIA\') THEN 1 ELSE 0 END AS eleito,\n           d.valor, d.base_valor\n    FROM public.candidatura c\n    LEFT JOIN public.municipio m ON m.cd_municipio_tse = c.cd_municipio_tse\n    LEFT JOIN despesa d ON d.ano_eleicao = c.ano_eleicao AND d.sq_candidato = c.sq_candidato\n    WHERE c.ds_sit_tot_turno IS NOT NULL\n      AND c.cd_cargo IN (1, 3, 5, 6, 7, 8, 11, 13)\n)\nSELECT ano_eleicao, cd_cargo, ANY_VALUE(ds_cargo) AS ds_cargo, uf, cd_municipio_tse,\n       COUNT(*) AS qt_candidaturas,\n       COUNT(valor) AS qt_com_despesa,\n       CAST(COALESCE(SUM(valor), 0) AS DECIMAL(18, 2)) AS vr_despesas_total,\n       SUM(eleito) AS qt_eleitos,\n       COUNT(valor) FILTER (WHERE eleito = 1) AS qt_eleitos_com_despesa,\n       CAST(COALESCE(SUM(valor) FILTER (WHERE eleito = 1), 0) AS DECIMAL(18, 2)) AS vr_despesas_eleitos,\n       CASE WHEN COUNT(valor) > 0 THEN MIN(base_valor) END AS base_valor\nFROM candidaturas\nGROUP BY ano_eleicao, cd_cargo, uf, cd_municipio_tse;\n\nCREATE OR REPLACE VIEW public.vw_questao_2_patrimonio_sucesso AS\nWITH patrimonio_candidato AS (\n    SELECT ano_eleicao, sq_candidato, SUM(vr_bem) AS total_patrimonio\n    FROM public.bens_declarados\n    GROUP BY ano_eleicao, sq_candidato\n), base_candidatos AS (\n    SELECT\n        c.ano_eleicao,\n        COALESCE(m.sg_uf, c.sg_ue) AS uf,\n        c.ds_cargo,\n        c.sq_candidato,\n        CASE WHEN c.ds_sit_tot_turno IN (\'ELEITO\', \'ELEITO POR QP\', \'ELEITO POR MÉDIA\') THEN 1 ELSE 0 END AS flag_eleito,\n        COALESCE(p.total_patrimonio, 0) AS total_patrimonio\n    FROM public.candidatura c\n    LEFT JOIN public.municipio m USING (cd_municipio_tse)\n    LEFT JOIN patrimonio_candidato p USING (ano_eleicao, sq_candidato)\n    WHERE c.ds_cargo NOT LIKE \'%VICE%\'\n      AND c.ds_cargo NOT LIKE \'%SUPLENTE%\'\n      AND c.ds_sit_tot_turno NOT IN (\'INDEFERIDO\', \'CASSADO\', \'FALECIDO\', \'CANCELADO\', \'NÃO CONHECIDO\', \'RENÚNCIA\')\n      AND c.ds_sit_tot_turno IS NOT NULL\n), candidatos_zerados AS (\n    SELECT *, 0 AS quartil_patrimonio FROM base_candidatos WHERE total_patrimonio = 0\n), candidatos_com_bens AS (\n    SELECT *, NTILE(4) OVER (PARTITION BY ano_eleicao, uf, ds_cargo ORDER BY total_patrimonio) AS quartil_patrimonio\n    FROM base_candidatos WHERE total_patrimonio > 0\n), faixas_patrimonio AS (\n    SELECT * FROM candidatos_zerados\n    UNION ALL\n    SELECT * FROM candidatos_com_bens\n)\nSELECT\n    ano_eleicao,\n    uf,\n    ds_cargo,\n    quartil_patrimonio,\n    CAST(MIN(total_patrimonio) AS DECIMAL(14,2)) AS piso_faixa_valor,\n    CAST(MAX(total_patrimonio) AS DECIMAL(14,2)) AS teto_faixa_valor,\n    COUNT(*) AS qtd_candidatos_na_faixa,\n    SUM(flag_eleito) AS qtd_eleitos,\n    ROUND(SUM(flag_eleito)::DECIMAL / COUNT(*) * 100, 2) AS taxa_sucesso_pct,\n    ROUND(AVG(total_patrimonio) FILTER (WHERE flag_eleito = 1), 2) AS media_patrimonio_eleitos,\n    ROUND(AVG(total_patrimonio) FILTER (WHERE flag_eleito = 0), 2) AS media_patrimonio_nao_eleitos,\n    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_patrimonio) FILTER (WHERE flag_eleito = 1)::DECIMAL(14,2) AS mediana_patrimonio_eleitos,\n    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_patrimonio) FILTER (WHERE flag_eleito = 0)::DECIMAL(14,2) AS mediana_patrimonio_nao_eleitos\nFROM faixas_patrimonio\nGROUP BY ano_eleicao, uf, ds_cargo, quartil_patrimonio;\n'

YEARS = (2004, 2006, 2008, 2010, 2012, 2014, 2016, 2018, 2020, 2022, 2024)
UFS = ("AC", "AL", "BA", "DF", "RO", "SP")
DB = os.environ.get("TSE_TARGET_DATABASE", "BDR-TSE")
CKAN = "https://dadosabertos.tse.jus.br/api/3/action"

PACKAGES = {
    "candidates": {
        2004: "candidatos-2004",
        2006: "candidatos-2006",
        2008: "candidatos-2008",
        2010: "candidatos-2010",
        2012: "candidatos-2012",
        2014: "candidatos-2014",
        2016: "candidatos-2016",
        2018: "candidatos-2018",
        2020: "candidatos-2020-subtemas",
        2022: "candidatos-2022",
        2024: "candidatos-2024",
    },
    "results": {y: f"resultados-{y}" for y in YEARS},
    "finance": {
        2004: "prestacao-de-contas-eleitorais-2004",
        2006: "prestacao-de-contas-eleitorais-2006",
        2008: "prestacao-de-contas-eleitorais-2008",
        2010: "prestacao-de-contas-eleitorais-2010",
        2012: "prestacao-de-contas-eleitorais-2012",
        2014: "prestacao-de-contas-eleitorais-2014",
        2016: "prestacao-de-contas-eleitorais-2016",
        2018: "prestacao-de-contas-eleitorais-2018",
        2020: "prestacao-de-contas-eleitorais-2020",
        2022: "dadosabertos-tse-jus-br-dataset-prestacao-de-contas-eleitorais-2022",
        2024: "prestacao-de-contas-eleitorais-2024",
    },
    "electorate": {y: f"eleitorado-{y}" for y in YEARS},
}


def ckan_action(action, **params):
    url = CKAN + "/" + action + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "Carga-TSE-MotherDuck/1.0"})
    with urllib.request.urlopen(req, timeout=60) as response:
        payload = json.load(response)
    if not payload.get("success"):
        raise RuntimeError(f"Falha na API CKAN: {action} {params}")
    return payload["result"]


def package_resources(slug):
    result = ckan_action("package_show", id=slug)
    return result["resources"]


def find_resource(year, group, marker):
    slug = PACKAGES[group][year]
    resources = package_resources(slug)
    marker = marker.lower()
    matches = [r for r in resources if marker in (r.get("url") or "").lower()]
    if not matches:
        matches = [r for r in resources if marker in (r.get("name") or "").lower()]
    if len(matches) != 1:
        raise RuntimeError(
            f"Esperava 1 recurso {marker!r} em {slug}, encontrei {len(matches)}"
        )
    return matches[0]["url"]


def download(url, destination):
    request = urllib.request.Request(url, headers={"User-Agent": "Carga-TSE-MotherDuck/1.0"})
    digest = hashlib.sha256()
    total = 0
    with urllib.request.urlopen(request, timeout=180) as response, open(destination, "wb") as output:
        while True:
            block = response.read(1024 * 1024)
            if not block:
                break
            output.write(block)
            digest.update(block)
            total += len(block)
    if total == 0:
        raise RuntimeError(f"Arquivo vazio baixado: {url}")
    return {"url": url, "bytes": total, "sha256": digest.hexdigest()}


def acquire_historical_profile(root, year):
    """Combina os recursos estaduais de perfil por seção em um ZIP local."""
    resources = package_resources(PACKAGES["electorate"][year])
    destination = root / f"perfil_eleitorado_{year}.zip"
    manifest = []
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=1) as combined:
        for uf in UFS:
            matches = []
            for resource in resources:
                name = (resource.get("name") or "").lower()
                prefix = f"{uf.lower()} -"
                if name.startswith(prefix) and "perfil do eleitorado por seção eleitoral" in name and str(year) in name:
                    matches.append(resource)
            if len(matches) != 1:
                if not matches and year == 2016 and uf == "DF":
                    print("2016 perfil do eleitorado: sem recurso do DF no catálogo TSE; ignorando", flush=True)
                    manifest.append({"year": year, "source": "perfil_eleitorado", "uf": uf,
                                     "available": False, "reason": "recurso estadual ausente no catálogo TSE"})
                    continue
                raise RuntimeError(f"Esperava um recurso de perfil por seção para {uf}/{year}, encontrei {len(matches)}")
            resource = matches[0]
            tmp = root / f"perfil_{year}_{uf}.download"
            info = download(resource["url"], tmp)
            info.update({"year": year, "source": "perfil_eleitorado", "uf": uf, "name": resource.get("name")})
            manifest.append(info)
            if zipfile.is_zipfile(tmp):
                with zipfile.ZipFile(tmp) as source_zip:
                    members = [name for name in source_zip.namelist() if name.lower().endswith(".csv")]
                    if len(members) != 1:
                        raise RuntimeError(f"Esperava um CSV dentro do perfil {uf}/{year}; encontrei {len(members)}")
                    combined.writestr(f"perfil_eleitor_secao_{year}_{uf}.csv", source_zip.read(members[0]))
            elif (resource.get("format") or "").lower() == "csv" or (resource.get("url") or "").lower().endswith(".csv"):
                combined.writestr(f"perfil_eleitor_secao_{year}_{uf}.csv", tmp.read_bytes())
            else:
                raise RuntimeError(f"Formato inesperado no perfil {uf}/{year}")
            tmp.unlink(missing_ok=True)
    return manifest


def acquire_historical_finance(root, year):
    """Extrai por HTTP Range só receitas/despesas de candidatos das UFs do projeto."""
    resources = package_resources(PACKAGES["finance"][year])
    matches = []
    for resource in resources:
        name = (resource.get("name") or "").lower()
        is_target = ((year == 2010 and "prest" in name and "contas" in name)
                    or (year != 2010 and "presta" in name and "contas" in name
                        and ("final" in name or "finais" in name)))
        if is_target \
                and "suplementar" not in name and "parcial" not in name:
            matches.append(resource)
    if len(matches) != 1:
        raise RuntimeError(f"Esperava um arquivo de prestação final {year}, encontrei {len(matches)}")
    url = matches[0]["url"]
    destination = root / f"prestacao_de_contas_eleitorais_candidatos_{year}.zip"

    def ranged(start, end, validator=None):
        headers = {"Range": f"bytes={start}-{end}", "Accept-Encoding": "identity"}
        if validator:
            headers["If-Range"] = validator
        request = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(request, timeout=180) as response:
            if response.status != 206:
                raise RuntimeError(f"O servidor não aceitou HTTP Range para {year}")
            expected = f"bytes {start}-{end}/"
            if not response.headers.get("Content-Range", "").startswith(expected):
                raise RuntimeError(f"Content-Range inesperado no arquivo de {year}")
            data = response.read()
            return data, response.headers.get("ETag") or response.headers.get("Last-Modified"), response.headers.get("Content-Range").rsplit("/", 1)[1]

        tail_start = max(0, int(matches[0].get("size") or 0) - 65536)
    # Obtem o final via sufixo quando o tamanho do recurso não está no catálogo.
    req = urllib.request.Request(url, headers={"Range": "bytes=-65536", "Accept-Encoding": "identity"})
    with urllib.request.urlopen(req, timeout=180) as response:
        if response.status != 206:
            raise RuntimeError(f"O servidor não aceitou HTTP Range para {year}")
        tail = response.read()
        validator = response.headers.get("ETag") or response.headers.get("Last-Modified")
        total_size = int(response.headers["Content-Range"].rsplit("/", 1)[1])
        tail_start = total_size - len(tail)
    eocd = tail.rfind(b"PK\x05\x06")
    if eocd < 0:
        raise RuntimeError(f"Diretório central ZIP ausente em {year}")
    end = struct.unpack_from("<4s4H2IH", tail, eocd)
    if end[5] == 0xFFFFFFFF or end[6] == 0xFFFFFFFF:
        raise RuntimeError(f"ZIP64 não suportado no arquivo financeiro de {year}")
    central_start = end[6]
    central_size = end[5]
    central, _, _ = ranged(central_start, central_start + central_size - 1, validator)
    entries = []
    pos = 0
    while central[pos:pos + 4] == b"PK\x01\x02":
        header = struct.unpack_from("<4s6H3I5H2I", central, pos)
        name_bytes = central[pos + 46:pos + 46 + header[10]]
        name = name_bytes.decode("utf-8" if header[3] & 2048 else "cp437")
        base = name.rsplit("/", 1)[-1].lower()
        candidate_kind = any(x in base for x in ("receitas_candidatos", "despesas_candidatos", "receitascandidatos", "despesascandidatos"))
        state_file = any(base.endswith(f"_{uf.lower()}.txt") or base.endswith(f"_{uf.lower()}.csv") for uf in UFS) \
            or any(f"/{uf.lower()}/" in name.lower() for uf in UFS)
        if candidate_kind and state_file and "doador_originario" not in base:
            entries.append((name, header))
        pos += 46 + header[10] + header[11] + header[12]
    if not entries:
        raise RuntimeError(f"Nenhum arquivo estadual de receita/despesa de candidato em {year}")
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as out:
        for name, header in entries:
            local, _, _ = ranged(header[16], header[16] + 29, validator)
            local_header = struct.unpack("<4s5H3I2H", local)
            data_start = header[16] + 30 + local_header[9] + local_header[10]
            compressed_size, uncompressed_size, expected_crc, method = header[8], header[9], header[7], header[4]
            if method not in (0, 8):
                raise RuntimeError(f"Método ZIP não suportado: {method}")
            request = urllib.request.Request(url, headers={"Range": f"bytes={data_start}-{data_start + compressed_size - 1}", "Accept-Encoding": "identity", **({"If-Range": validator} if validator else {})})
            with urllib.request.urlopen(request, timeout=180) as response, out.open(name, "w", force_zip64=True) as member:
                if response.status != 206:
                    raise RuntimeError(f"Range inválido ao ler {name}")
                decoder = zlib.decompressobj(-15) if method == 8 else None
                crc = 0
                compressed_read = uncompressed_read = 0
                while True:
                    block = response.read(1024 * 1024)
                    if not block:
                        break
                    compressed_read += len(block)
                    plain = decoder.decompress(block) if decoder else block
                    member.write(plain)
                    crc = zlib.crc32(plain, crc)
                    uncompressed_read += len(plain)
                if decoder:
                    plain = decoder.flush()
                    member.write(plain)
                    crc = zlib.crc32(plain, crc)
                    uncompressed_read += len(plain)
                if compressed_read != compressed_size or uncompressed_read != uncompressed_size or crc != expected_crc:
                    raise RuntimeError(f"Tamanho/CRC inválido no membro {name}")
            print(f"{year}: {name.rsplit('/', 1)[-1]} CRC OK", flush=True)
    return [{"url": url, "bytes": destination.stat().st_size, "remote_bytes": total_size,
             "year": year, "source": "prestacao_de_contas_eleitorais_candidatos",
             "members": [name for name, _ in entries]}]


def acquire_sources(root, years=None, only_sources=None):
    sources = {
        "perfil_eleitorado": ("electorate", "/perfil_eleitorado/perfil_eleitorado_"),
        "consulta_cand": ("candidates", "/consulta_cand/consulta_cand_"),
        "consulta_cand_complementar": ("candidates", "/consulta_cand_complementar/consulta_cand_complementar_"),
        "bem_candidato": ("candidates", "/bem_candidato/bem_candidato_"),
        "votacao_candidato_munzona": ("results", "/votacao_candidato_munzona/votacao_candidato_munzona_"),
        "votacao_partido_munzona": ("results", "/votacao_partido_munzona/votacao_partido_munzona_"),
        "detalhe_votacao_munzona": ("results", "/detalhe_votacao_munzona/detalhe_votacao_munzona_"),
        "prestacao_de_contas_eleitorais_candidatos": (
            "finance", "/prestacao_de_contas_eleitorais_candidatos_"
        ),
    }
    manifests = []
    for year in years or YEARS:
        for local_name, (group, marker) in sources.items():
            if only_sources is not None and local_name not in only_sources:
                continue
            if local_name == "consulta_cand_complementar" and year < 2018:
                continue
            if local_name == "bem_candidato" and year == 2004:
                continue
            if local_name == "perfil_eleitorado" and year in (2014, 2016):
                manifests.extend(acquire_historical_profile(root, year))
                continue
            if local_name == "prestacao_de_contas_eleitorais_candidatos" and year < 2014:
                if year <= 2008:
                    resources = package_resources(PACKAGES["finance"][year])
                    matches = [r for r in resources if "prest" in (r.get("name") or "").lower()
                               and "contas" in (r.get("name") or "").lower()
                               and (r.get("url") or "").lower().endswith(".zip")]
                    if len(matches) != 1:
                        raise RuntimeError(f"Esperava 1 arquivo de contas {year}, encontrei {len(matches)}")
                    path = root / f"{local_name}_{year}.zip"
                    info = download(matches[0]["url"], path)
                    info.update({"year": year, "source": local_name})
                    manifests.append(info)
                else:
                    manifests.extend(acquire_historical_finance(root, year))
                continue
            if local_name == "prestacao_de_contas_eleitorais_candidatos" and year in (2014, 2016):
                manifests.extend(acquire_historical_finance(root, year))
                continue
            url = find_resource(year, group, marker + str(year) + ".zip")
            path = root / f"{local_name}_{year}.zip"
            info = download(url, path)
            info.update({"year": year, "source": local_name})
            manifests.append(info)
            print(f"baixado {year} {local_name}: {info['bytes'] / 1e6:.1f} MB", flush=True)
    return manifests




HISTORICAL_YEARS = (2010, 2012, 2014, 2016)
NORMALIZER_SOURCES = ("consulta_cand", "prestacao_de_contas_eleitorais_candidatos")

def qident(value):
    return '"' + value.replace('"', '""') + '"'

def qliteral(value):
    return "'" + str(value).replace("'", "''") + "'"

def main():
    started = time.monotonic()
    zip_root = Path("/tmp/tse_despesas_declaradas_zip")
    stage_root = Path("/tmp/tse_despesas_declaradas_stage")
    shutil.rmtree(zip_root, ignore_errors=True)
    shutil.rmtree(stage_root, ignore_errors=True)
    zip_root.mkdir(parents=True)
    stage_root.mkdir(parents=True)
    manifests = acquire_sources(zip_root, HISTORICAL_YEARS, set(NORMALIZER_SOURCES))

    namespace = {"__name__": "tse_normalizer", "__file__": "/tmp/normalizer.py"}
    exec(compile(NORMALIZER_SOURCE, "/tmp/normalizer.py", "exec"), namespace)
    namespace["YEARS"] = HISTORICAL_YEARS
    namespace["SOURCES"] = NORMALIZER_SOURCES
    sys.argv = ["normalizer.py", "--zip-dir", str(zip_root), "--output", str(stage_root)]
    namespace["main"]()

    con = duckdb.connect("md:")
    con.execute(f"USE {qident(DB)}")
    candidate_fields = "ano_eleicao cd_eleicao nr_turno cd_tipo_eleicao nm_tipo_eleicao sg_uf sg_ue nm_ue cd_cargo ds_cargo sq_candidato sq_candidato_tse nr_cpf_candidato nm_candidato nm_urna_candidato dt_nascimento ds_grau_instrucao ds_genero ds_cor_raca nr_partido sg_partido nm_partido ds_sit_tot_turno source_file nr_titulo_eleitoral_candidato nr_candidato".split()
    candidate_definitions = ", ".join(f"{qident(name)} VARCHAR" for name in candidate_fields)
    con.execute(f"CREATE TEMP TABLE stg_candidatura ({candidate_definitions})")
    con.execute(f"COPY stg_candidatura FROM {qliteral(stage_root / 'candidatura.csv')} (DELIMITER ';', HEADER FALSE, QUOTE '\"', ESCAPE '\"', NULL '')")
    fields = "ano_eleicao sq_candidato id_linha_origem ds_despesa ds_categoria_despesa vr_despesa_declarada vr_pago source_file".split()
    definitions = ", ".join(f"{qident(name)} VARCHAR" for name in fields)
    con.execute(f"CREATE TEMP TABLE stg_despesa ({definitions})")
    con.execute(f"COPY stg_despesa FROM {qliteral(stage_root / 'despesa_candidato.csv')} (DELIMITER ';', HEADER FALSE, QUOTE '\"', ESCAPE '\"', NULL '')")
    con.execute("""
        CREATE OR REPLACE TEMP MACRO texto_publicado(v) AS (
            CASE WHEN v IS NULL OR UPPER(TRIM(v)) IN ('','#NULO','#NULO#','#NE','-1','-3','-4','NÃO DIVULGÁVEL')
                 THEN NULL ELSE TRIM(v) END
        );
        CREATE OR REPLACE TEMP MACRO valor_brl(v) AS (
            CASE WHEN v IS NULL OR UPPER(TRIM(v)) IN ('','#NULO','#NULO#','#NE','-1','-3','-4','NÃO DIVULGÁVEL') THEN NULL
                 WHEN CONTAINS(TRIM(v), ',') THEN TRY_CAST(REPLACE(REPLACE(TRIM(v),'.',''),',','.') AS DECIMAL(14,2))
                 ELSE TRY_CAST(TRIM(v) AS DECIMAL(14,2)) END
        );
        CREATE OR REPLACE TEMP TABLE candidato_fonte AS
        SELECT DISTINCT TRY_CAST(ano_eleicao AS INTEGER) AS ano_eleicao,
               TRY_CAST(sq_candidato AS BIGINT) AS sq_fonte,
               TRY_CAST(sq_candidato_tse AS BIGINT) AS sq_tse,
               TRY_CAST(cd_cargo AS INTEGER) AS cd_cargo,
               texto_publicado(sg_ue) AS sg_ue,
               texto_publicado(nm_candidato) AS nm_candidato,
               texto_publicado(nm_urna_candidato) AS nm_urna_candidato
        FROM stg_candidatura WHERE TRY_CAST(ano_eleicao AS INTEGER) BETWEEN 2010 AND 2016;
        CREATE OR REPLACE TEMP TABLE mapa_candidato AS
        SELECT s.ano_eleicao,s.sq_fonte,MIN(c.sq_candidato) AS sq_candidato
        FROM candidato_fonte s
        JOIN public.candidatura c
          ON c.ano_eleicao=s.ano_eleicao AND c.sq_candidato_tse=s.sq_tse
        WHERE c.ano_eleicao BETWEEN 2010 AND 2016
        GROUP BY s.ano_eleicao,s.sq_fonte
        HAVING COUNT(DISTINCT c.sq_candidato)=1;
        CREATE OR REPLACE TEMP TABLE despesas_fonte AS
        WITH origem AS (
            SELECT TRY_CAST(e.ano_eleicao AS INTEGER) AS ano_eleicao,
                   m.sq_candidato,
                   texto_publicado(e.ds_despesa) AS ds_despesa,
                   texto_publicado(e.ds_categoria_despesa) AS ds_categoria_despesa,
                   valor_brl(e.vr_despesa_declarada) AS vr_despesa_declarada,
                   e.id_linha_origem
            FROM stg_despesa e JOIN mapa_candidato m
              ON m.ano_eleicao=TRY_CAST(e.ano_eleicao AS INTEGER)
             AND m.sq_fonte=TRY_CAST(e.sq_candidato AS BIGINT)
            WHERE TRY_CAST(e.ano_eleicao AS INTEGER) BETWEEN 2010 AND 2016
        ), origem_ordenada AS (
            SELECT *,ROW_NUMBER() OVER (
                PARTITION BY ano_eleicao,sq_candidato,ds_despesa,ds_categoria_despesa
                ORDER BY vr_despesa_declarada NULLS FIRST,id_linha_origem
            ) AS ordem
            FROM origem
        ), destino_ordenado AS (
            SELECT ano_eleicao,sq_candidato,id_despesa,ds_despesa,ds_categoria_despesa,
                   ROW_NUMBER() OVER (
                       PARTITION BY ano_eleicao,sq_candidato,ds_despesa,ds_categoria_despesa
                       ORDER BY id_despesa
                   ) AS ordem
            FROM public.despesas_pagas WHERE ano_eleicao BETWEEN 2010 AND 2016
        )
        SELECT d.ano_eleicao,d.sq_candidato,d.id_despesa,
               o.ds_despesa,o.ds_categoria_despesa,o.vr_despesa_declarada
        FROM origem_ordenada o JOIN destino_ordenado d
          ON o.ano_eleicao=d.ano_eleicao AND o.sq_candidato=d.sq_candidato
         AND o.ds_despesa IS NOT DISTINCT FROM d.ds_despesa
         AND o.ds_categoria_despesa IS NOT DISTINCT FROM d.ds_categoria_despesa
         AND o.ordem=d.ordem;
    """)

    mismatch = con.execute("""
        WITH source_groups AS (
            SELECT TRY_CAST(e.ano_eleicao AS INTEGER) AS ano_eleicao,m.sq_candidato,
                   texto_publicado(e.ds_despesa) AS ds_despesa,
                   texto_publicado(e.ds_categoria_despesa) AS ds_categoria_despesa,COUNT(*) AS n
            FROM stg_despesa e JOIN mapa_candidato m
              ON m.ano_eleicao=TRY_CAST(e.ano_eleicao AS INTEGER)
             AND m.sq_fonte=TRY_CAST(e.sq_candidato AS BIGINT)
            WHERE TRY_CAST(e.ano_eleicao AS INTEGER) BETWEEN 2010 AND 2016 GROUP BY 1,2,3,4
        ), target_groups AS (
            SELECT ano_eleicao,sq_candidato,ds_despesa,ds_categoria_despesa,COUNT(*) AS n
            FROM public.despesas_pagas WHERE ano_eleicao BETWEEN 2010 AND 2016 GROUP BY 1,2,3,4
        )
        SELECT COUNT(*) FROM source_groups s FULL JOIN target_groups d
          ON s.ano_eleicao=d.ano_eleicao AND s.sq_candidato=d.sq_candidato
         AND s.ds_despesa IS NOT DISTINCT FROM d.ds_despesa
         AND s.ds_categoria_despesa IS NOT DISTINCT FROM d.ds_categoria_despesa
        WHERE s.n IS DISTINCT FROM d.n
    """).fetchone()[0]
    unmapped = con.execute("""
        SELECT COUNT(*) FROM stg_despesa e LEFT JOIN mapa_candidato m
          ON m.ano_eleicao=TRY_CAST(e.ano_eleicao AS INTEGER)
         AND m.sq_fonte=TRY_CAST(e.sq_candidato AS BIGINT)
        WHERE TRY_CAST(e.ano_eleicao AS INTEGER) BETWEEN 2010 AND 2016 AND m.sq_candidato IS NULL
    """).fetchone()[0]
    if unmapped:
        raise RuntimeError(f"{unmapped} candidaturas financeiras não mapearam univocamente para o banco; nenhum valor foi aplicado")
    if mismatch:
        raise RuntimeError(f"Carga histórica não corresponde aos lançamentos publicados ({mismatch} divergências); nenhum valor foi aplicado")

    missing_amounts = con.execute("SELECT COUNT(*) FROM despesas_fonte WHERE vr_despesa_declarada IS NULL").fetchone()[0]
    if missing_amounts:
        print(f"Fonte sem valor publicado: {missing_amounts:,} lançamentos (sentinelas/ausentes mantidos como NULL)", flush=True)
    source_totals = con.execute("SELECT ano_eleicao,COUNT(*),COUNT(vr_despesa_declarada),SUM(vr_despesa_declarada) FROM despesas_fonte GROUP BY 1 ORDER BY 1").fetchall()
    preserved_before = con.execute("SELECT COUNT(*),SUM(HASH(ano_eleicao,sq_candidato,id_despesa,ds_despesa,ds_categoria_despesa,vr_pago,vr_despesa_declarada)) FROM public.despesas_pagas WHERE ano_eleicao < 2010 OR ano_eleicao >= 2018").fetchone()

    con.execute("BEGIN TRANSACTION")
    try:
        con.execute("ALTER TABLE public.despesas_pagas ADD COLUMN IF NOT EXISTS vr_despesa_declarada DECIMAL(14,2)")
        con.execute("""
            UPDATE public.despesas_pagas d SET vr_despesa_declarada=s.vr_despesa_declarada
            FROM despesas_fonte s
            WHERE d.ano_eleicao=s.ano_eleicao AND d.sq_candidato=s.sq_candidato AND d.id_despesa=s.id_despesa
        """)
        con.execute(VIEWS_SQL)
        preserved_after = con.execute("SELECT COUNT(*),SUM(HASH(ano_eleicao,sq_candidato,id_despesa,ds_despesa,ds_categoria_despesa,vr_pago,vr_despesa_declarada)) FROM public.despesas_pagas WHERE ano_eleicao < 2010 OR ano_eleicao >= 2018").fetchone()
        if preserved_before != preserved_after:
            raise RuntimeError("Os lançamentos de 2018 em diante mudaram; rollback")
        target_totals = con.execute("SELECT ano_eleicao,COUNT(*),COUNT(vr_despesa_declarada),SUM(vr_despesa_declarada) FROM public.despesas_pagas WHERE ano_eleicao BETWEEN 2010 AND 2016 GROUP BY 1 ORDER BY 1").fetchall()
        if source_totals != target_totals:
            raise RuntimeError(f"Totais de origem/destino não reconciliam: {source_totals} / {target_totals}; rollback")
        con.execute("COMMIT")
    except Exception:
        con.execute("ROLLBACK")
        raise

    print("HISTORICAL_EXPENSE_BACKFILL=" + json.dumps({
        "database": DB, "years": HISTORICAL_YEARS, "sources": manifests,
        "rows_by_year": target_totals, "preserved_2018_plus": preserved_after,
        "elapsed_seconds": round(time.monotonic()-started, 1)
    }, ensure_ascii=False, default=str), flush=True)
    con.close()
    shutil.rmtree(zip_root, ignore_errors=True)
    shutil.rmtree(stage_root, ignore_errors=True)

if __name__ == "__main__":
    main()
