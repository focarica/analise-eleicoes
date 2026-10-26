#!/usr/bin/env python3
"""Prepara offline a reconstrução de 2006/2008 por ano/UF/SQ de origem.

Requer snapshots de frontend/scripts/reconstruir-legados.ts --export e a
staging de candidatos dos onze anos produzida na auditoria de identidades.
Não conecta ao MotherDuck nem publica arquivos de dados no repositório.
"""
import argparse
import concurrent.futures
import csv
import hashlib
import importlib.util
import json
import sys
import time
from pathlib import Path

import duckdb
import requests

REPO = Path(__file__).resolve().parents[2]


def sha256(path):
    with path.open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def acquire(root, year, source):
    local = 'prestacao_de_contas_eleitorais_candidatos' if source == 'prestacao_contas' else source
    path = root / f'{local}_{year}.zip'
    url = f'https://cdn.tse.jus.br/estatistica/sead/odsele/{source}/{source}_{year}.zip'
    if not path.exists():
        for attempt in range(4):
            try:
                with requests.get(url, stream=True, timeout=(30, 180)) as response:
                    response.raise_for_status()
                    with path.with_suffix('.partial').open('wb') as f:
                        for b in response.iter_content(1024 * 1024):
                            f.write(b)
                path.with_suffix('.partial').replace(path)
                break
            except requests.RequestException:
                if attempt == 3:
                    raise
    return {'year': year, 'source': source, 'url': url, 'bytes': path.stat().st_size, 'sha256': sha256(path)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--work-dir', type=Path, default=Path('/tmp/tse_rebuild_2006_2008'))
    parser.add_argument('--identity-stage', type=Path, default=Path('/tmp/tse_identidades_2004_2024/staging/candidatura.csv'))
    parser.add_argument('--skip-normalize', action='store_true', help='Reusar staging_final já conferida da mesma versão do normalizador')
    args = parser.parse_args()
    root = args.work_dir.resolve()
    raw, stage = root / 'raw', root / 'staging_final'
    raw.mkdir(parents=True, exist_ok=True)
    if not args.identity_stage.exists():
        raise ValueError('Prepare primeiro as observações da auditoria de identidade dos onze anos.')
    for table in ('candidato', 'candidatura', 'municipio', 'partido', 'bens_declarados', 'receitas_campanha', 'despesas_pagas', 'votacao_candidato_municipio'):
        if not (root / 'backup' / f'{table}.csv').exists():
            raise ValueError('Snapshot ausente: ' + table)
    started = time.monotonic()
    spec = importlib.util.spec_from_file_location('normalizer', REPO / 'scripts/normalizar_dados_tse.py')
    normalizer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(normalizer)
    c = duckdb.connect(str(root / 'reconstrucao.duckdb'))
    c.execute('SET threads=4')
    c.execute("SET memory_limit='1GB'")
    try:
        c.execute("SET lambda_syntax='ENABLE_SINGLE_ARROW'")
    except duckdb.Error:
        pass

    def load(table, path, fields=None):
        header = fields is None
        if header:
            with path.open() as f:
                fields = next(csv.reader(f, delimiter=';'))
        c.execute(f'''CREATE OR REPLACE TABLE {table} AS SELECT * FROM read_csv(?,auto_detect=false,
          delim=';',header=?,allow_quoted_nulls=false,columns=?)''', [str(path), header, {n:'VARCHAR' for n in fields}])

    for table in ('candidato', 'candidatura', 'municipio', 'partido'):
        load('backup_' + table, root / 'backup' / f'{table}.csv')
    if not args.skip_normalize:
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            jobs = [(y, s) for y in (2006, 2008) for s in ('consulta_cand', 'votacao_candidato_munzona', 'bem_candidato', 'prestacao_contas')]
            manifests = list(pool.map(lambda pair: acquire(raw, *pair), jobs))
        (root / 'fontes_reconstrucao.json').write_text(json.dumps(manifests, indent=2))
        # Deriva o mapa de retenção das chaves da base, por correspondência de
        # origem. Assim as candidaturas existentes mantêm suas URLs de fotos.
        if not (root / 'legacy_key_map.csv').exists():
            load('origem_identidade', args.identity_stage, normalizer.STAGES['candidatura'])
            c.execute(f'''COPY (
              SELECT DISTINCT a.ano_eleicao,r.sg_uf,r.sq_candidato_tse,a.sq_candidato
              FROM backup_candidatura a JOIN origem_identidade r
              ON a.ano_eleicao=r.ano_eleicao AND a.sq_candidato_tse=r.sq_candidato_tse
              AND a.sg_ue=r.sg_ue AND a.cd_cargo=r.cd_cargo
              WHERE a.ano_eleicao IN ('2006','2008')
            ) TO '{str(root / 'legacy_key_map.csv').replace("'", "''")}' (HEADER,DELIMITER ';')''')
        normalizer.YEARS = (2006, 2008)
        normalizer.SOURCES = ('consulta_cand','votacao_candidato_munzona','bem_candidato','prestacao_de_contas_eleitorais_candidatos')
        old_args = sys.argv
        try:
            sys.argv = ['normalizar','--zip-dir',str(raw),'--output',str(stage),'--legacy-key-map',str(root / 'legacy_key_map.csv')]
            normalizer.main()
        finally:
            sys.argv = old_args

    c.execute('CREATE SCHEMA IF NOT EXISTS public')
    for table in ('municipio','partido'):
        c.execute(f'CREATE OR REPLACE TABLE public.{table} AS SELECT * FROM backup_{table}')
    stages = {'stg_candidatura':'candidatura','stg_bem':'bem_candidato','stg_receita':'receita_candidato',
              'stg_despesa':'despesa_candidato','stg_votacao_candidato':'votacao_candidato_munzona'}
    for table, source in stages.items():
        load(table, stage / f'{source}.csv', normalizer.STAGES[source])
    model = (REPO / 'sql/motherduck/02_carga_modelo.sql').read_text()
    c.execute(model[:model.index('CREATE OR REPLACE TABLE public.municipio AS')])
    c.execute(model[model.index('CREATE OR REPLACE TABLE public.candidatura AS'):model.index('CREATE OR REPLACE TABLE public.fato_perfil_eleitorado AS')])
    c.execute(model[model.index('CREATE OR REPLACE TABLE public.votacao_candidato_municipio AS'):model.index('CREATE OR REPLACE TABLE public.votacao_partido AS')])

    def scalar(sql):
        return c.execute(sql).fetchone()[0]

    if scalar('''SELECT COUNT(*) FROM public.votacao_candidato_municipio v
       JOIN public.candidatura c USING(ano_eleicao,sq_candidato)
       JOIN public.municipio m ON m.cd_municipio_tse=v.cd_municipio_tse
       WHERE c.cd_cargo<>v.cd_cargo OR (c.cd_municipio_tse IS NOT NULL AND c.cd_municipio_tse<>v.cd_municipio_tse)
       OR (c.cd_municipio_tse IS NULL AND UPPER(c.sg_ue)<>'BR' AND UPPER(c.sg_ue)<>m.sg_uf)'''):
        raise ValueError('Ainda existem votos ligados à circunscrição/cargo de outro candidato')
    for field, dimension, dtype in [('nr_partido','partido','INTEGER'),('cd_municipio_tse','municipio','VARCHAR')]:
        if scalar(f'''SELECT COUNT(*) FROM public.candidatura c LEFT JOIN public.{dimension} d
             ON c.{field}=TRY_CAST(d.{field} AS {dtype})
             WHERE c.{field} IS NOT NULL AND d.{field} IS NULL'''):
            raise ValueError('Candidatura sem dimensão correspondente: ' + dimension)
    vote_in = scalar('SELECT SUM(TRY_CAST(texto_publicado(qt_votos_nominais) AS BIGINT)) FROM stg_votacao_candidato')
    vote_out = scalar('SELECT SUM(qt_votos_nominais) FROM public.votacao_candidato_municipio')
    if vote_in != vote_out:
        raise ValueError(f'Votos de origem e destino não reconciliam: {vote_in} / {vote_out}')
    for source, value in [('stg_bem','vr_bem_candidato'),('stg_receita','vr_receita')]:
        for year in ('2006','2008'):
            total, amounts = c.execute(f"SELECT COUNT(*),COUNT(valor_brl({value})) FROM {source} WHERE ano_eleicao=?",[year]).fetchone()
            if total and not amounts:
                raise ValueError(f'Coluna monetária inteiramente ausente: {source}/{year}; conferir leiaute bruto')
    for table, source, value in [('bens_declarados','stg_bem','vr_bem_candidato'),('receitas_campanha','stg_receita','vr_receita')]:
        target_value = 'vr_bem' if table == 'bens_declarados' else 'vr_receita'
        if scalar(f'SELECT SUM(valor_brl({value})) FROM {source}') != scalar(f'SELECT SUM({target_value}) FROM public.{table}'):
            raise ValueError('Valores de origem e destino divergem: ' + table)
    c.execute('''CREATE OR REPLACE TABLE atual AS
      SELECT * FROM backup_candidatura WHERE ano_eleicao NOT IN ('2006','2008')
      UNION ALL BY NAME
      SELECT c.* REPLACE(b.id_pessoa_projeto AS id_pessoa_projeto)
      FROM public.candidatura c LEFT JOIN backup_candidatura b
      ON c.ano_eleicao=b.ano_eleicao::INTEGER AND c.sq_candidato=b.sq_candidato::BIGINT''')
    c.execute('CREATE OR REPLACE TABLE perfis AS SELECT * FROM backup_candidato')
    load('identidade_outros_anos', args.identity_stage, normalizer.STAGES['candidatura'])
    c.execute('''CREATE OR REPLACE TABLE stg_candidatura AS
       SELECT * FROM identidade_outros_anos WHERE ano_eleicao NOT IN ('2006','2008')
       UNION ALL BY NAME SELECT * FROM read_csv(?,auto_detect=false,delim=';',header=false,columns=?)''',
       [str(stage / 'candidatura.csv'),{n:'VARCHAR' for n in normalizer.STAGES['candidatura']}])
    c.execute((REPO / 'sql/motherduck/08_resolver_identidades.sql').read_text())
    c.execute('CREATE OR REPLACE TABLE observacoes AS SELECT * FROM _person_by_candidature')
    c.execute((REPO / 'sql/motherduck/09_planejar_reconciliacao_bruta.sql').read_text())
    c.execute('''CREATE OR REPLACE TABLE publicar_candidatura AS
       SELECT a.* REPLACE(v.id_novo::VARCHAR AS id_pessoa_projeto)
       FROM atual a JOIN plano_vinculos v
       ON a.ano_eleicao::INTEGER=v.ano_eleicao AND a.sq_candidato::BIGINT=v.sq_candidato''')
    mismatch = scalar('''SELECT COUNT(*) FROM observacoes o JOIN plano_vinculos v USING(ano_eleicao,sq_candidato)
      JOIN plano_perfis p ON p.id_pessoa_projeto=v.id_novo
      WHERE nome_identidade(p.nm_candidato) IS DISTINCT FROM o.nome_norm OR p.dt_nascimento IS DISTINCT FROM o.nascimento''')
    if mismatch:
        raise ValueError('Perfis planejados divergentes da fonte: ' + str(mismatch))
    preserved = scalar('''SELECT COUNT(*) FROM backup_candidatura b LEFT JOIN publicar_candidatura p
      USING(ano_eleicao,sq_candidato) WHERE p.sq_candidato IS NULL''')
    if preserved:
        raise ValueError('Candidaturas existentes desapareceriam: ' + str(preserved))
    for table in ('bens_declarados','receitas_campanha','despesas_pagas','votacao_candidato_municipio'):
        if scalar(f'''SELECT COUNT(*) FROM public.{table} f LEFT JOIN publicar_candidatura c
          ON f.ano_eleicao=c.ano_eleicao::INTEGER AND f.sq_candidato=c.sq_candidato::BIGINT
          WHERE c.sq_candidato IS NULL'''):
            raise ValueError('Fatos sem candidatura: ' + table)
    out = root / 'plano'
    out.mkdir(exist_ok=True)
    outputs = {'candidato':'plano_perfis','candidatura':'publicar_candidatura',**{t:'public.'+t for t in ('bens_declarados','receitas_campanha','despesas_pagas','votacao_candidato_municipio')}}
    report = {'years':[2006,2008],'source_identity_mismatches':mismatch,'existing_candidates_lost':preserved,
              'nominal_votes_source':vote_in,'nominal_votes_target':vote_out,'tables':{}}
    for name, table in outputs.items():
        path = out / f'{name}.csv'
        c.execute(f"COPY {table} TO '{str(path).replace(chr(39),chr(39)*2)}' (HEADER,DELIMITER ';')")
        report['tables'][name] = {'rows':scalar(f'SELECT COUNT(*) FROM {table}'),'bytes':path.stat().st_size,'sha256':sha256(path)}
    report['snapshot_sha256'] = {p.name:sha256(p) for p in (root / 'backup').glob('*.csv')}
    report['stage_manifest'] = json.loads((stage / 'manifest.json').read_text())
    report['seconds'] = round(time.monotonic()-started,2)
    (root / 'plano_manifesto.json').write_text(json.dumps(report,ensure_ascii=False,indent=2,default=str))
    print(json.dumps({k:v for k,v in report.items() if k not in ('stage_manifest','snapshot_sha256')},ensure_ascii=False,indent=2,default=str),flush=True)
    c.close()


if __name__ == '__main__':
    main()
