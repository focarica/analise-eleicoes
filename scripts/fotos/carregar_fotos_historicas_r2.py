#!/usr/bin/env python3
"""Carrega fotos oficiais do TSE de 2004–2016 no bucket público de R2.

Chaves de objeto compatíveis com o frontend:
    candidatos/{ANO}/{SQ_CANDIDATO}

O identificador é resolvido contra BDR-TSE; em 2004 o nome do ZIP inclui
município + SQ_CANDIDATO_TSE, pois o sequencial isolado se repete.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from collections import defaultdict
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

import duckdb
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[3]
YEARS = (2004, 2006, 2008, 2010, 2012, 2014, 2016)
MUNICIPAL_YEARS = {2004, 2008, 2012, 2016}
GENERAL_YEARS = {2006, 2010, 2014}
MUNICIPAL_UFS = ("AC", "AL", "BA", "RO", "SP")
GENERAL_UFS = ("AC", "AL", "BA", "DF", "RO", "SP", "BR")
BUCKET = "analise-eleicoes-fotos"
TSE_API = "https://dadosabertos.tse.jus.br/api/3/action/package_show"
R2_API = "https://api.cloudflare.com/client/v4"
MAX_SIZE = (322, 450)
JPEG_QUALITY = 78


def read_env(path: Path) -> dict[str, str]:
    result = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            result[key.strip()] = value.strip().strip('"').strip("'")
    return result


def request_json(url: str, headers: dict[str, str] | None = None) -> dict:
    req = urllib.request.Request(url, headers=headers or {"User-Agent": "TSE-photo-loader/1.0"})
    with urllib.request.urlopen(req, timeout=60) as response:
        return json.load(response)


def motherduck_rows(token: str) -> list[tuple]:
    encoded = urllib.parse.quote(token, safe="")
    conn = duckdb.connect(f"md:BDR-TSE?motherduck_token={encoded}", read_only=True)
    try:
        return conn.execute("""
            WITH rows AS (
                SELECT c.ano_eleicao,
                       CASE WHEN c.ano_eleicao IN (2004, 2008, 2012, 2016)
                            THEN m.sg_uf ELSE c.sg_ue END AS uf,
                       c.cd_municipio_tse,
                       CAST(c.sq_candidato_tse AS VARCHAR) AS sq_tse,
                       CAST(c.sq_candidato AS VARCHAR) AS sq_interno
                FROM public.candidatura c
                LEFT JOIN public.municipio m
                  ON c.cd_municipio_tse = m.cd_municipio_tse
                WHERE c.ano_eleicao BETWEEN 2004 AND 2016
            )
            SELECT ano_eleicao, uf, cd_municipio_tse, sq_tse,
                   MIN(sq_interno) AS sq_interno, COUNT(DISTINCT sq_interno) AS destinos
            FROM rows
            WHERE ano_eleicao IN (2004, 2006, 2008, 2010, 2012, 2014, 2016)
              AND uf IS NOT NULL AND sq_tse IS NOT NULL AND sq_interno IS NOT NULL
            GROUP BY 1, 2, 3, 4
            ORDER BY 1, 2, 3, 4
        """).fetchall()
    finally:
        conn.close()


def norm_id(value: str | int | None) -> str:
    value = str(value or "").strip()
    if not value.isdigit():
        return ""
    return str(int(value))


def make_indexes(rows: list[tuple], years: set[int], ufs: set[str]):
    regular: dict[tuple[int, str, str], str] = {}
    municipal_2004: dict[tuple[str, str, str], str] = {}
    counts = defaultdict(int)
    ambiguous = 0
    for year, uf, municipality, sq_tse, sq_internal, destinations in rows:
        year, uf = int(year), str(uf).upper()
        if year not in years or uf not in ufs:
            continue
        counts[year] += int(destinations)
        seq = norm_id(sq_tse)
        if not seq or int(destinations) != 1:
            ambiguous += 1
            continue
        if year == 2004:
            muni = norm_id(municipality)
            if muni:
                municipal_2004[(uf, muni, seq)] = str(sq_internal)
        else:
            key = (year, uf, seq)
            if key in regular and regular[key] != str(sq_internal):
                ambiguous += 1
                regular.pop(key, None)
            else:
                regular[key] = str(sq_internal)
    return regular, municipal_2004, dict(counts), ambiguous


def photo_key(year: int, uf: str, member: str):
    stem = Path(member.replace("\\", "/")).stem.upper()
    stem = re.sub(r"_DIV$", "", stem)
    if year == 2004:
        match = re.fullmatch(rf"F{re.escape(uf)}(\d{{5}})_(\d+)", stem)
        if not match:
            return None
        return (uf, norm_id(match.group(1)), norm_id(match.group(2)))
    match = re.fullmatch(rf"F?{re.escape(uf)}(\d+)", stem)
    if not match:
        return None
    return (year, uf, norm_id(match.group(1)))


def compress_jpeg(raw: bytes) -> bytes:
    with Image.open(BytesIO(raw)) as source:
        image = ImageOps.exif_transpose(source)
        if image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info):
            rgba = image.convert("RGBA")
            background = Image.new("RGB", rgba.size, "white")
            background.paste(rgba, mask=rgba.getchannel("A"))
            image = background
        else:
            image = image.convert("RGB")
        image.thumbnail(MAX_SIZE, Image.Resampling.LANCZOS)
        output = BytesIO()
        image.save(output, format="JPEG", quality=JPEG_QUALITY, optimize=True)
        return output.getvalue()


def download_zip(url: str, path: Path) -> tuple[int, str]:
    digest = hashlib.sha256()
    size = 0
    req = urllib.request.Request(url, headers={"User-Agent": "TSE-photo-loader/1.0"})
    with urllib.request.urlopen(req, timeout=180) as response, path.open("wb") as out:
        while True:
            block = response.read(1024 * 1024)
            if not block:
                break
            out.write(block)
            digest.update(block)
            size += len(block)
    return size, digest.hexdigest()


def aws_run(args: list[str], env: dict[str, str], *, check: bool = True):
    result = subprocess.run(
        ["aws", *args], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, timeout=1800,
    )
    if check and result.returncode:
        raise RuntimeError(f"AWS CLI failed ({result.returncode}): {result.stderr[-1200:]}")
    return result


def existing_keys(year: int, env: dict[str, str], endpoint: str) -> set[str]:
    keys: set[str] = set()
    token = None
    while True:
        args = ["s3api", "list-objects-v2", "--bucket", BUCKET,
                "--prefix", f"candidatos/{year}/", "--max-keys", "1000",
                "--endpoint-url", endpoint, "--region", "auto", "--output", "json"]
        if token:
            args.extend(["--continuation-token", token])
        result = json.loads(aws_run(args, env).stdout)
        keys.update(item["Key"] for item in result.get("Contents", []))
        if not result.get("IsTruncated"):
            break
        token = result.get("NextContinuationToken")
    return keys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--years", nargs="+", type=int, choices=YEARS, default=list(YEARS))
    parser.add_argument("--ufs", nargs="+", default=None)
    parser.add_argument("--dry-run", action="store_true", help="Baixa e compacta; não envia ao R2")
    parser.add_argument("--workdir", type=Path, default=Path("/tmp/tse_fotos_historicas_r2"))
    parser.add_argument("--keep-local", action="store_true", help="Mantém ZIPs e JPEGs temporários após concluir")
    args = parser.parse_args()

    years = set(args.years)
    default_ufs = set(MUNICIPAL_UFS if years <= MUNICIPAL_YEARS else MUNICIPAL_UFS + ("DF",))
    if years & GENERAL_YEARS:
        default_ufs.update(GENERAL_UFS)
    selected_ufs = set(args.ufs or default_ufs)
    allowed = set(MUNICIPAL_UFS + ("DF", "BR"))
    if not selected_ufs <= allowed:
        raise SystemExit(f"UFs inválidas: {sorted(selected_ufs - allowed)}")

    frontend_env = read_env(ROOT / "analise-eleicoes" / "frontend" / ".env")
    r2_env = read_env(ROOT / ".env_r2")
    token = frontend_env.get("MOTHERDUCK_TOKEN")
    if not token:
        raise SystemExit("MOTHERDUCK_TOKEN ausente em analise-eleicoes/frontend/.env")

    rows = motherduck_rows(token)
    regular, municipal_2004, candidate_counts, ambiguous = make_indexes(rows, years, selected_ufs)
    del rows

    accounts = request_json(
        f"{R2_API}/accounts",
        {"Authorization": f"Bearer {r2_env['TOKEN_VAALUE']}", "User-Agent": "TSE-photo-loader/1.0"},
    ).get("result", [])
    if len(accounts) != 1:
        raise SystemExit("A API do Cloudflare não retornou exatamente uma conta acessível.")
    account_id = accounts[0]["id"]
    endpoint = f"https://{account_id}.r2.cloudflarestorage.com"

    aws_env = os.environ.copy()
    aws_env.update({
        "AWS_ACCESS_KEY_ID": r2_env["ACCESS_KEY_ID"],
        "AWS_SECRET_ACCESS_KEY": r2_env["SECRET_ACCESS_KEY"],
        "AWS_DEFAULT_REGION": "auto",
        "AWS_EC2_METADATA_DISABLED": "true",
    })

    args.workdir.mkdir(parents=True, exist_ok=True)
    archive_dir = args.workdir / "archives"
    staged_dir = args.workdir / "to_upload"
    archive_dir.mkdir(exist_ok=True)
    staged_dir.mkdir(exist_ok=True)

    # Upload de centenas de milhares de arquivos pequenos fica limitado pela
    # concorrência padrão do AWS CLI. Mantemos limites explícitos para tornar
    # a reprodução da carga mais eficiente e previsível.
    aws_config = args.workdir / "aws-cli-config"
    aws_config.write_text(
        "[default]\n"
        "region = auto\n"
        "s3 =\n"
        "    max_concurrent_requests = 20\n"
        "    max_queue_size = 10000\n",
        encoding="utf-8",
    )
    aws_env["AWS_CONFIG_FILE"] = str(aws_config)

    summary = {
        "years": sorted(years), "ufs_requested": sorted(selected_ufs),
        "candidate_rows_in_scope": candidate_counts, "ambiguous_candidate_keys": ambiguous,
        "archives": [], "matched_images": defaultdict(int),
        "missing_photo_candidates": {},
        "missing_image_rows": defaultdict(int), "duplicate_source_keys": 0,
        "source_archive_bytes": 0, "source_image_bytes": 0,
        "compressed_image_bytes": 0, "uploaded_objects": 0,
        "skipped_existing_objects": 0, "invalid_images": 0,
    }
    start = time.monotonic()
    uploaded_keys: dict[int, list[tuple[str, Path]]] = defaultdict(list)
    seen_keys: set[str] = set()

    for year in sorted(years):
        ufs = selected_ufs & set(GENERAL_UFS if year in GENERAL_YEARS else MUNICIPAL_UFS)
        package = request_json(f"{TSE_API}?id=candidatos-{year}")['result']
        resources = package.get("resources", [])
        for uf in sorted(ufs):
            resource = next((r for r in resources if re.fullmatch(
                rf"{re.escape(uf)}\s*-\s*Fotos de candidatos", r.get("name", ""), re.I
            )), None)
            if not resource:
                summary["archives"].append({"year": year, "uf": uf, "status": "sem_recurso"})
                continue

            zip_path = archive_dir / f"{year}_{uf}.zip"
            zip_size, digest = download_zip(resource["url"], zip_path)
            summary["source_archive_bytes"] += zip_size
            archive_info = {"year": year, "uf": uf, "archive_bytes": zip_size,
                            "sha256": digest, "members": 0, "matched": 0,
                            "unmatched": 0, "bad_images": 0}
            try:
                with zipfile.ZipFile(zip_path) as archive:
                    members = [m for m in archive.infolist() if not m.is_dir()]
                    archive_info["members"] = len(members)
                    for member in members:
                        key = photo_key(year, uf, member.filename)
                        if key is None:
                            archive_info["unmatched"] += 1
                            continue
                        sq = municipal_2004.get(key) if year == 2004 else regular.get(key)
                        if not sq:
                            archive_info["unmatched"] += 1
                            continue
                        object_key = f"candidatos/{year}/{sq}"
                        if object_key in seen_keys:
                            summary["duplicate_source_keys"] += 1
                            continue
                        seen_keys.add(object_key)
                        try:
                            raw = archive.read(member)
                            jpg = compress_jpeg(raw)
                        except Exception:
                            archive_info["bad_images"] += 1
                            summary["invalid_images"] += 1
                            continue
                        target = staged_dir / str(year) / str(sq)
                        target.parent.mkdir(parents=True, exist_ok=True)
                        target.write_bytes(jpg)
                        uploaded_keys[year].append((object_key, target))
                        archive_info["matched"] += 1
                        summary["source_image_bytes"] += len(raw)
                        summary["compressed_image_bytes"] += len(jpg)
            finally:
                zip_path.unlink(missing_ok=True)
            summary["matched_images"][str(year)] += archive_info["matched"]
            summary["missing_image_rows"][str(year)] += archive_info["unmatched"]
            summary["archives"].append(archive_info)
            print(f"{year} {uf}: {archive_info['matched']} fotos ligadas; "
                  f"{archive_info['unmatched']} membros sem candidatura correspondente", flush=True)

    for year in sorted(years):
        entries = uploaded_keys.get(year, [])
        if not entries:
            continue
        if args.dry_run:
            continue
        present = existing_keys(year, aws_env, endpoint)
        upload_root = args.workdir / "missing_only" / str(year)
        if upload_root.exists():
            shutil.rmtree(upload_root)
        upload_root.mkdir(parents=True)
        to_send = []
        for object_key, local_file in entries:
            if object_key in present:
                summary["skipped_existing_objects"] += 1
                continue
            copy_path = upload_root / object_key.rsplit("/", 1)[-1]
            shutil.copyfile(local_file, copy_path)
            to_send.append(copy_path)
        if not to_send:
            continue
        args_sync = ["s3", "sync", str(upload_root), f"s3://{BUCKET}/candidatos/{year}/",
                     "--endpoint-url", endpoint, "--region", "auto",
                     "--content-type", "image/jpeg", "--cache-control", "public,max-age=3600",
                     "--only-show-errors"]
        for attempt in range(4):
            try:
                aws_run(args_sync, aws_env)
                break
            except RuntimeError:
                if attempt == 3:
                    raise
                delay = 2 ** (attempt + 1)
                print(f"{year}: falha temporária no R2; repetindo o sync em {delay}s",
                      flush=True)
                time.sleep(delay)
        summary["uploaded_objects"] += len(to_send)
        print(f"{year}: {len(to_send)} objetos enviados ao R2", flush=True)
        shutil.rmtree(upload_root)

    public_base = frontend_env.get("R2_PUBLIC_BASE_URL", "").rstrip("/")
    samples = []
    for year in sorted(years):
        candidates = uploaded_keys.get(year, [])
        if args.dry_run or not candidates:
            continue
        object_key, _ = candidates[0]
        # O domínio público do bucket expõe a chave inteira, incluindo
        # "candidatos/"; sem esse prefixo, o host pode responder com o HTML do app.
        url = f"{public_base}/{object_key}"
        req = urllib.request.Request(url, headers={"Range": "bytes=0-63", "User-Agent": "TSE-photo-loader/1.0"})
        with urllib.request.urlopen(req, timeout=30) as response:
            data = response.read(64)
            samples.append({"year": year, "status": response.status,
                            "content_type": response.headers.get("Content-Type"),
                            "range_bytes": len(data)})
            if response.status not in (200, 206) or response.headers.get("Content-Type", "").split(";")[0] != "image/jpeg":
                raise RuntimeError(f"Falha no teste público para o ano {year}.")
    summary["public_samples"] = samples
    summary["elapsed_seconds"] = round(time.monotonic() - start, 1)
    summary["finished_at_utc"] = datetime.now(timezone.utc).isoformat()
    summary["matched_images"] = dict(summary["matched_images"])
    summary["missing_image_rows"] = dict(summary["missing_image_rows"])
    summary["missing_photo_candidates"] = {
        str(year): max(candidate_counts.get(year, 0) - summary["matched_images"].get(str(year), 0), 0)
        for year in sorted(years)
    }
    summary["dry_run"] = args.dry_run
    print(json.dumps(summary, ensure_ascii=False, indent=2))

    if not args.dry_run and not args.keep_local:
        shutil.rmtree(args.workdir, ignore_errors=True)


if __name__ == "__main__":
    main()
