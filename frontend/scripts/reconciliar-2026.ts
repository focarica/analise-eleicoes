// Uso em frontend/: bun scripts/reconciliar-2026.ts --check|--apply /diretorio-privado
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
const [mode, directory] = process.argv.slice(2);
if (!['--check', '--apply'].includes(mode) || !directory) throw Error('Use --check|--apply /diretorio-privado');
const apply = mode === '--apply';
const root = resolve(directory), repo = resolve(import.meta.dir, '../..');
mkdirSync(root, { recursive: true, mode: 0o700 }); chmodSync(root, 0o700);
const literal = (s: string) => `'${s.replaceAll("'", "''")}'`;
const zip = root + '/consulta_cand_2026.zip', csv = root + '/cadastro.csv';
const url = 'https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/consulta_cand_2026.zip';
if (!existsSync(zip)) {
  const response = await fetch(url);
  if (!response.ok) throw Error(`TSE: HTTP ${response.status}`);
  await Bun.write(zip, await response.arrayBuffer());
}
const preparar = Bun.spawnSync(['python3', '-c', `
import csv,io,sys,zipfile
fields={'ano_eleicao':'ANO_ELEICAO','sq_candidato':'SQ_CANDIDATO','sg_uf':'SG_UF','sg_ue':'SG_UE','cd_cargo':'CD_CARGO','nr_titulo_eleitoral_candidato':'NR_TITULO_ELEITORAL_CANDIDATO','nr_cpf_candidato':'NR_CPF_CANDIDATO','nm_candidato':'NM_CANDIDATO','dt_nascimento':'DT_NASCIMENTO','ds_grau_instrucao':'DS_GRAU_INSTRUCAO','ds_genero':'DS_GENERO','ds_cor_raca':'DS_COR_RACA'}
with zipfile.ZipFile(sys.argv[1]) as z,open(sys.argv[2],'w',newline='',encoding='utf8') as out:
 name=next(n for n in z.namelist() if n.upper().endswith('_BRASIL.CSV'))
 w=csv.DictWriter(out,fieldnames=[*fields,'source_file'],delimiter=';');w.writeheader()
 for r in csv.DictReader(io.TextIOWrapper(z.open(name),encoding='latin1'),delimiter=';'):
  if r['SG_UF'] in {'AC','AL','BA','DF','RO','SP','BR'}:
   w.writerow({**{k:r[v] for k,v in fields.items()},'source_file':name})
`, zip, csv], { stdout: 'inherit', stderr: 'inherit' });
if (preparar.exitCode !== 0) throw Error('Falha ao preparar cadastro bruto');
const token = apply ? (Bun.env.MOTHERDUCK_TOKEN_READ_WRITE || Bun.env.MOTHERDUCK_TOKEN) : Bun.env.MOTHERDUCK_TOKEN;
if (!token) throw Error('Token MotherDuck ausente');
const db = await DuckDBInstance.create(`md:BDR-TSE?token=${encodeURIComponent(token)}&motherduck_open_browser=false`);
const con = await db.connect();
const rows = async (sql: string) => (await con.runAndReadAll(sql)).getRowObjectsJson() as Record<string, any>[];
const scalar = async (sql: string) => Number(Object.values((await rows(sql))[0])[0]);
const stamp = new Date().toISOString().replaceAll(':', '-');
let committed = false;
try {
  await con.run('BEGIN TRANSACTION');
  await con.run(`CREATE TEMP TABLE _raw_2026 AS SELECT * FROM read_csv(${literal(csv)},header=true,delim=';',all_varchar=true)`);
  await con.run(`CREATE TEMP VIEW stg_candidatura AS
    SELECT r.* REPLACE(CAST(c.sq_candidato AS VARCHAR) AS sq_candidato)
    FROM _raw_2026 r JOIN public.candidatura c
      ON c.ano_eleicao=TRY_CAST(r.ano_eleicao AS INTEGER)
     AND c.sq_candidato_tse=TRY_CAST(r.sq_candidato AS BIGINT)
     AND c.sg_ue=r.sg_ue AND c.cd_cargo=TRY_CAST(r.cd_cargo AS INTEGER)
    WHERE c.ano_eleicao=2026`);
  await con.run(readFileSync(repo + '/sql/motherduck/08_resolver_identidades.sql', 'utf8'));
  await con.run(readFileSync(repo + '/sql/motherduck/16_planejar_vinculos_2026.sql', 'utf8'));
  const stats = (await rows(`SELECT COUNT(*) AS candidaturas,COUNT(*) FILTER(WHERE id_anterior<>id_novo) AS alterados FROM _plano_vinculos_2026`))[0];
  assert.ok(Number(stats.candidaturas) > 0);
  assert.equal(Number(stats.candidaturas), await scalar('SELECT COUNT(*) FROM public.candidatura WHERE ano_eleicao=2026'));
  await con.run(`COPY _plano_vinculos_2026 TO ${literal(root + '/plano-' + stamp + '.csv')} (HEADER,DELIMITER ';')`);
  if (apply) {
    await con.run(`COPY (SELECT * FROM public.candidatura WHERE ano_eleicao=2026) TO ${literal(root + '/candidaturas-antes-' + stamp + '.csv')} (HEADER,DELIMITER ';')`);
    const campos = (await rows('DESCRIBE public.candidatura')).map(r => r.column_name as string);
    const ident = (s: string) => '"' + s.replaceAll('"', '""') + '"';
    const assinatura = async () => rows(`SELECT COUNT(*) AS n,
      SUM(HASH(${campos.filter(n => n !== 'id_pessoa_projeto').map(ident).join(',')}))::VARCHAR AS atributos,
      SUM(HASH(ano_eleicao,sq_candidato,id_pessoa_projeto)) FILTER(WHERE ano_eleicao<>2026)::VARCHAR AS historicos
      FROM public.candidatura`);
    const perfis = async () => rows('SELECT COUNT(*) AS n,SUM(HASH(id_pessoa_projeto,nr_titulo_eleitoral_candidato,nr_cpf_candidato,nm_candidato,dt_nascimento,ds_grau_instrucao,ds_genero,ds_cor_raca))::VARCHAR AS assinatura FROM public.candidato');
    const before = await assinatura(), profilesBefore = await perfis();
    await con.run(`UPDATE public.candidatura c SET id_pessoa_projeto=p.id_novo FROM _plano_vinculos_2026 p
      WHERE c.ano_eleicao=p.ano_eleicao AND c.sq_candidato=p.sq_candidato
        AND c.id_pessoa_projeto IS NOT DISTINCT FROM p.id_anterior AND p.id_anterior IS DISTINCT FROM p.id_novo`);
    assert.equal(await scalar(`SELECT COUNT(*) FROM public.candidatura c JOIN _plano_vinculos_2026 p USING(ano_eleicao,sq_candidato) WHERE c.id_pessoa_projeto IS DISTINCT FROM p.id_novo`), 0);
    assert.deepEqual(await assinatura(), before, 'Atributos ou identidades históricas mudaram');
    assert.deepEqual(await perfis(), profilesBefore, 'Perfis existentes mudaram');
    await con.run('COMMIT'); committed = true;
    const cache = Bun.env.CACHE_DIR || resolve(import.meta.dir, '../.cache-api');
    mkdirSync(cache, { recursive: true }); writeFileSync(cache + '/revision', stamp);
  } else await con.run('ROLLBACK');
  const report = { applied: committed, ...stats, source: url, sha256: createHash('sha256').update(readFileSync(zip)).digest('hex'), at: stamp };
  writeFileSync(root + '/resultado-' + stamp + '.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} catch (e) { if (!committed) try { await con.run('ROLLBACK'); } catch {} throw e; }
finally { con.closeSync(); db.closeSync(); }
