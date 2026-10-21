#!/usr/bin/env python3
"""Reconcilia identidades offline contra CONSULTA_CAND; não conecta ao banco.

Requer snapshots exportados por frontend/scripts/reconciliar-identidades.ts.
Dependências: requests e duckdb. Dados pessoais, ZIPs e planos ficam no work-dir.
"""
import argparse
import concurrent.futures
import contextlib
import csv
import hashlib
import importlib.util
import json
import sys
import time
import zipfile
from pathlib import Path

import duckdb
import requests

REPO = Path(__file__).resolve().parents[2]
YEARS = tuple(range(2004, 2025, 2))
UFS = ('AC', 'AL', 'BA', 'DF', 'RO', 'SP', 'BR')


def sha256(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        while b := f.read(1024 * 1024):
            h.update(b)
    return h.hexdigest()


def acquire(root, year):
    path = root / f'consulta_cand_{year}.zip'
    manifest_path = root / f'fonte_{year}.json'
    if path.exists() and manifest_path.exists():
        manifest = json.loads(manifest_path.read_text())
        with zipfile.ZipFile(path) as z:
            for member in manifest['members']:
                h = hashlib.sha256()
                with z.open(member['member']) as f:
                    while b := f.read(1024 * 1024):
                        h.update(b)
                if h.hexdigest() != member['sha256']:
                    raise ValueError(f'Fonte em cache alterada: {year}')
        return manifest
    url = f'https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/consulta_cand_{year}.zip'
    headers = {}
    if not path.exists():
        for attempt in range(4):
            try:
                with requests.get(url, stream=True, timeout=(30, 180)) as response:
                    response.raise_for_status()
                    headers = {k: v for k, v in response.headers.items()
                               if k.lower() in ('etag', 'last-modified')}
                    with path.with_suffix('.partial').open('wb') as f:
                        for b in response.iter_content(1024 * 1024):
                            f.write(b)
                path.with_suffix('.partial').replace(path)
                break
            except requests.RequestException:
                if attempt == 3:
                    raise
    members = []
    with zipfile.ZipFile(path) as z:
        names = [n for n in z.namelist() if any(n.upper().endswith(f'_{uf}.CSV') for uf in UFS)]
        if not names:
            raise ValueError(f'Sem membros do recorte: {year}')
        for name in names:
            h = hashlib.sha256()
            with z.open(name) as f:
                while b := f.read(1024 * 1024):
                    h.update(b)
            info = z.getinfo(name)
            members.append({'member': name, 'bytes': info.file_size,
                            'crc32': f'{info.CRC:08x}', 'sha256': h.hexdigest()})
    manifest = {'year': year, 'url': url, 'bytes': path.stat().st_size,
                'headers': headers, 'members': members}
    manifest_path.write_text(json.dumps(manifest, indent=2))
    print(f'{year}: {len(members)} CSVs conferidos por CRC/SHA-256', flush=True)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--work-dir', type=Path, default=Path('/tmp/tse_identidades_2004_2024'))
    args = parser.parse_args()
    root = args.work_dir.resolve()
    root.mkdir(parents=True, exist_ok=True)
    for name in ('candidato_antes.csv', 'candidatura_antes.csv'):
        if not (root / name).exists():
            raise ValueError(f'Exporte primeiro o snapshot: {name}')
    started = time.monotonic()
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        sources = list(pool.map(lambda y: acquire(root, y), YEARS))
    (root / 'fontes.json').write_text(json.dumps(sources, indent=2))
    spec = importlib.util.spec_from_file_location('normalizer', REPO / 'scripts/normalizar_dados_tse.py')
    normalizer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(normalizer)
    normalizer.SOURCES = ('consulta_cand',)
    previous_args = sys.argv
    try:
        sys.argv = ['normalizar', '--zip-dir', str(root), '--output', str(root / 'staging')]
        with (root / 'normalizacao.log').open('w') as log, contextlib.redirect_stdout(log):
            normalizer.main()
    finally:
        sys.argv = previous_args
    c = duckdb.connect(str(root / 'identidades.duckdb'))
    c.execute('SET threads=4')
    c.execute("SET memory_limit='1GB'")
    # DuckDB 2.0 mudou o padrão; o SQL também atende à versão 1.5 do MotherDuck.
    try:
        c.execute("SET lambda_syntax='ENABLE_SINGLE_ARROW'")
    except duckdb.Error:
        pass
    for table, filename, fields, header in [
        ('atual', 'candidatura_antes.csv', None, True),
        ('perfis', 'candidato_antes.csv', None, True),
        ('raw', 'staging/candidatura.csv', normalizer.STAGES['candidatura'], False),
    ]:
        path = root / filename
        if fields is None:
            with path.open() as f:
                fields = next(csv.reader(f, delimiter=';'))
        c.execute(f'CREATE OR REPLACE TABLE {table} AS SELECT * FROM read_csv(?,auto_detect=false,delim=\';\',header=?,columns=?)',
                  [str(path), header, {k: 'VARCHAR' for k in fields}])
    # Números históricos repetidos só são comparados na UE/cargo da candidatura
    # realmente existente no banco. Isto corrige identidade; não recria fatos
    # nem candidaturas perdidas na carga histórica original.
    c.execute('''CREATE OR REPLACE TEMP VIEW stg_candidatura AS
      SELECT r.* REPLACE(a.sq_candidato AS sq_candidato) FROM raw r JOIN atual a
      ON r.ano_eleicao=a.ano_eleicao AND r.sg_ue=a.sg_ue AND r.cd_cargo=a.cd_cargo
      AND CASE WHEN r.ano_eleicao IN ('2006','2008')
        THEN r.sq_candidato_tse=a.sq_candidato_tse
        ELSE r.sq_candidato=a.sq_candidato END''')
    c.execute((REPO / 'sql/motherduck/08_resolver_identidades.sql').read_text())
    c.execute('CREATE OR REPLACE TABLE observacoes AS SELECT * FROM _person_by_candidature')
    c.execute((REPO / 'sql/motherduck/09_planejar_reconciliacao_bruta.sql').read_text())
    mismatch = c.execute('''SELECT COUNT(*) FROM observacoes o
      JOIN plano_vinculos v USING(ano_eleicao,sq_candidato)
      JOIN plano_perfis p ON p.id_pessoa_projeto=v.id_novo
      WHERE nome_identidade(p.nm_candidato) IS DISTINCT FROM o.nome_norm
      OR p.dt_nascimento IS DISTINCT FROM o.nascimento''').fetchone()[0]
    if mismatch:
        raise ValueError(f'Plano ainda tem {mismatch} perfis incompatíveis com a fonte')
    stats = c.execute('SELECT COUNT(*),COUNT(*) FILTER(WHERE id_anterior<>id_novo),COUNT(DISTINCT id_novo) FROM plano_vinculos').fetchone()
    if stats[0] != c.execute('SELECT COUNT(*) FROM atual').fetchone()[0]:
        raise ValueError('O plano não cobre exatamente as candidaturas atuais')
    report = {'candidaturas': stats[0], 'vinculos_alterados': stats[1], 'perfis': stats[2],
              'candidaturas_com_fonte': c.execute('SELECT COUNT(*) FROM observacoes').fetchone()[0],
              'conflitos_por_candidatura_na_fonte': c.execute('SELECT COUNT(*) FROM observacoes WHERE conflito').fetchone()[0],
              'perfis_divergentes_apos': mismatch,
              'seconds': round(time.monotonic() - started, 2)}
    for table in ('plano_vinculos', 'plano_perfis'):
        target = str(root / f'{table}.csv').replace("'", "''")
        c.execute(f"COPY {table} TO '{target}' (HEADER,DELIMITER ';')")
    report['sha256'] = {n: sha256(root / n) for n in
                        ('plano_perfis.csv', 'plano_vinculos.csv', 'candidato_antes.csv', 'candidatura_antes.csv')}
    (root / 'plano_manifesto.json').write_text(json.dumps(report, indent=2))
    print(json.dumps({k: v for k, v in report.items() if k != 'sha256'}, indent=2), flush=True)
    c.close()


if __name__ == '__main__':
    main()
