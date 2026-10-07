#!/usr/bin/env python3
"""Normaliza os arquivos TSE de 2018/2020/2022/2024 para COPY em stg_tse.

O script não conecta ao banco. Gera CSVs temporários locais, preservando texto
e sentinelas; a publicação ocorre pelos scripts SQL existentes.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
from collections import defaultdict
from datetime import datetime
from pathlib import Path
import zipfile

YEARS = (2018, 2020, 2022, 2024)
UFS = {"AC", "AL", "BA", "DF", "RO", "SP"}
SOURCES = (
    "consulta_cand", "consulta_cand_complementar", "bem_candidato",
    "votacao_candidato_munzona", "votacao_partido_munzona",
    "detalhe_votacao_munzona", "perfil_eleitorado",
    "prestacao_de_contas_eleitorais_candidatos",
)

STAGES = {
    "candidatura": ["ano_eleicao", "cd_eleicao", "nr_turno", "cd_tipo_eleicao", "nm_tipo_eleicao", "sg_uf", "sg_ue", "nm_ue", "cd_cargo", "ds_cargo", "sq_candidato", "nr_cpf_candidato", "nm_candidato", "nm_urna_candidato", "dt_nascimento", "ds_grau_instrucao", "ds_genero", "ds_cor_raca", "nr_partido", "sg_partido", "nm_partido", "ds_sit_tot_turno", "source_file", "nr_titulo_eleitoral_candidato"],
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
    csvs = [n for n in names if n.lower().endswith(".csv")]
    selected = []
    if source in {"votacao_candidato_munzona", "votacao_partido_munzona", "detalhe_votacao_munzona"}:
        selected = [n for n in csvs if any(n.upper().endswith(f"_{uf}.CSV") for uf in UFS)]
    elif source == "perfil_eleitorado" and year in (2018, 2020):
        selected = [n for n in csvs if n.rsplit("/", 1)[-1].upper() == f"PERFIL_ELEITORADO_{year}.CSV"]
    elif source == "perfil_eleitorado":
        selected = [n for n in csvs if any(n.upper().endswith(f"_{uf}.CSV") for uf in UFS)]
    elif source == "prestacao_de_contas_eleitorais_candidatos":
        selected = [n for n in csvs if any(n.upper().endswith(f"_{uf}.CSV") for uf in UFS) or n.upper().endswith("_BR.CSV")]
    else:
        selected = [n for n in csvs if any(n.upper().endswith(f"_{uf}.CSV") for uf in UFS) or n.upper().endswith("_BR.CSV")]
    return sorted(selected)


def val(r, key, default=None):
    return r.get(key, default)


def mun_code(value):
    """Normalize TSE numeric municipality codes without losing leading zeroes."""
    value = (value or "").strip()
    return value.zfill(5) if value.isdigit() and len(value) < 5 else value


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zip-dir", type=Path, default=Path("/tmp/tse_full_2018_2024"))
    ap.add_argument("--output", type=Path, default=Path("/tmp/tse_railway_stage"))
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

    try:
        for year in YEARS:
            for source in SOURCES:
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
                                    if val(r, "CD_TIPO_ELEICAO") != "2":
                                        continue
                                    out.put("candidatura", [
                                        val(r,"ANO_ELEICAO",str(year)), val(r,"CD_ELEICAO"), val(r,"NR_TURNO"),
                                        val(r,"CD_TIPO_ELEICAO"), val(r,"NM_TIPO_ELEICAO"), sg, mun_code(val(r,"SG_UE")), val(r,"NM_UE"),
                                        val(r,"CD_CARGO"), val(r,"DS_CARGO"), val(r,"SQ_CANDIDATO"), val(r,"NR_CPF_CANDIDATO"),
                                        val(r,"NM_CANDIDATO"), val(r,"NM_URNA_CANDIDATO"), val(r,"DT_NASCIMENTO"), val(r,"DS_GRAU_INSTRUCAO"), val(r,"DS_GENERO"),
                                        val(r,"DS_COR_RACA"), val(r,"NR_PARTIDO"), val(r,"SG_PARTIDO"), val(r,"NM_PARTIDO"),
                                        val(r,"DS_SIT_TOT_TURNO"), source_file, val(r,"NR_TITULO_ELEITORAL_CANDIDATO")])
                                elif source == "consulta_cand_complementar":
                                    out.put("candidatura_complementar", [val(r,"ANO_ELEICAO",str(year)),val(r,"CD_ELEICAO"),val(r,"SQ_CANDIDATO"),val(r,"NR_TURNO"),val(r,"NM_TIPO_DESTINACAO_VOTOS"),source_file])
                                else:
                                    code = mun_code(val(r,"CD_MUNICIPIO"))
                                    nm = val(r,"NM_MUNICIPIO")
                                    if code and sg in UFS and nm:
                                        municipalities.setdefault(code,(code,None,nm,sg,source_file))
                                    out.put("bem_candidato", [val(r,"ANO_ELEICAO",str(year)),val(r,"SQ_CANDIDATO"),val(r,"NR_ORDEM_BEM_CANDIDATO"),val(r,"DS_TIPO_BEM_CANDIDATO"),val(r,"DS_BEM_CANDIDATO"),val(r,"VR_BEM_CANDIDATO"),source_file])
                            elif source == "votacao_candidato_munzona":
                                code=mun_code(val(r,"CD_MUNICIPIO"))
                                if code and sg in UFS and val(r,"NM_MUNICIPIO"):
                                    municipalities.setdefault(code,(code,None,val(r,"NM_MUNICIPIO"),sg,source_file))
                                out.put(source,[val(r,"ANO_ELEICAO",str(year)),sg,val(r,"CD_ELEICAO"),val(r,"NR_TURNO"),val(r,"CD_CARGO"),code,val(r,"SQ_CANDIDATO"),val(r,"QT_VOTOS_NOMINAIS"),source_file])
                            elif source == "votacao_partido_munzona":
                                code=mun_code(val(r,"CD_MUNICIPIO"))
                                if code and sg in UFS and val(r,"NM_MUNICIPIO"):
                                    municipalities.setdefault(code,(code,None,val(r,"NM_MUNICIPIO"),sg,source_file))
                                out.put(source,[val(r,"ANO_ELEICAO",str(year)),sg,val(r,"CD_ELEICAO"),val(r,"NR_TURNO"),val(r,"CD_CARGO"),code,val(r,"NR_PARTIDO"),val(r,"SG_PARTIDO"),val(r,"QT_TOTAL_VOTOS_LEG_VALIDOS",val(r,"QT_VOTOS_LEGENDA")),val(r,"QT_VOTOS_NOMINAIS_VALIDOS",val(r,"QT_VOTOS_NOMINAIS")),source_file])
                            elif source == "detalhe_votacao_munzona":
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
                            out.put("despesa_candidato",[year,sq,line,val(r,"DS_DESPESA"),None,val(r,"VR_PAGTO_DESPESA"),source_file])
                    covered.add((year,sq))
        # A coverage row is emitted only when an account was identified from a
        # final TSE prestação. No account is silently interpreted as zero cost.
        for year,sq in sorted(covered):
            digest=next((m["sha256"] for m in manifests if m["year"]==year and m["source"].startswith("prestacao_")),"")
            out.put("cobertura_despesa_paga",[year,sq,"true",digest])
    finally:
        out.close()
    summary={"years":YEARS,"ufs":sorted(UFS),"manifests":manifests,"stage_rows":dict(out.counts),"duplicate_receipt_rows_dropped":duplicate_receipt_rows_dropped,"duplicate_expense_rows_dropped":duplicate_expense_rows_dropped,"profile_invalid_source_rows":profile_invalid,"profile_aggregated_groups":len(profile_counts),"stage_csv_bytes":sum(p.stat().st_size for p in args.output.glob("*.csv")),"source_zip_bytes":sum(m["zip_bytes"] for m in manifests),"municipalities":len(municipalities),"expected_zones":len(expected_zones)}
    (args.output/"manifest.json").write_text(json.dumps(summary,ensure_ascii=False,indent=2)+"\n")
    print(json.dumps({k:v for k,v in summary.items() if k!="manifests"},ensure_ascii=False,indent=2))


if __name__=="__main__":
    main()
