// Ensaio local da migração, sem conexão com o MotherDuck.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
const db = await DuckDBInstance.create(':memory:');
const con = await db.connect();
const sql = (name: string) => readFileSync(resolve(import.meta.dir, '../../sql/motherduck', name), 'utf8');
try {
  await con.run(`CREATE SCHEMA public;
    CREATE TABLE public.partido(nr_partido INTEGER PRIMARY KEY, vies_politico VARCHAR);
    CREATE TABLE public.candidatura(ano_eleicao INTEGER, nr_partido INTEGER, sg_partido VARCHAR, vies_politico_eleicao VARCHAR);
    CREATE TABLE public.votacao_partido(ano_eleicao INTEGER, cd_eleicao INTEGER, nr_turno INTEGER, cd_cargo INTEGER, cd_municipio_tse VARCHAR, nr_partido INTEGER, sg_partido VARCHAR, qt_votos_nominais INTEGER, qt_votos_legenda INTEGER);
    INSERT INTO public.partido VALUES (13,NULL),(11,NULL);
    INSERT INTO public.candidatura VALUES (2024,13,'PT',NULL),(2026,13,'PT',NULL);
    INSERT INTO public.votacao_partido VALUES
      (2018,295,1,1,'001',13,'PT',100,0),(2018,297,1,6,'001',11,'PP',100,0),
      (2020,426,1,11,'001',13,'PT',100,0),(2020,426,1,13,'001',11,'PP',100,0),
      (2020,504,1,11,'001',11,'PP',10000,0),
      (2022,544,1,1,'001',13,'PT',100,0),(2022,546,1,6,'001',11,'PP',100,0),
      (2024,619,1,11,'001',13,'PT',100,0),(2024,619,1,13,'001',11,'PP',100,0),
      (2024,6041,1,11,'001',11,'PP',10000,0),(2024,619,2,11,'001',11,'PP',10000,0);`);
  for (let i = 0; i < 2; i++) {
    await con.run(sql('14_vies_partidos.sql'));
    await con.run(sql('15_views_vies.sql'));
    const rows = (await con.runAndReadAll('SELECT * FROM public.vw_questao_7_vies ORDER BY ano_eleicao')).getRowObjectsJson();
    assert.equal(rows.length, 4);
    rows.forEach((r, j) => { assert.ok(Math.abs(Number(r.vies) - [11.7,11.7,8.3,8.3][j]) < 1e-8); assert.equal(Number(r.n_cargos), 2); assert.equal(Number(r.cobertura), 100); });
    const r = (await con.runAndReadAll('SELECT vies_politico_eleicao FROM public.candidatura WHERE ano_eleicao=2026')).getRowObjectsJson()[0];
    assert.equal(r.vies_politico_eleicao, null);
  }
  await con.run("UPDATE public.partido SET vies_politico=12.3 WHERE nr_partido=13; INSERT INTO public.votacao_partido VALUES(2020,426,1,11,'001',80,'UP',100000,0)");
  await assert.rejects(con.run(sql('14_vies_partidos.sql')), /cobertura/);
  await con.run('ROLLBACK');
  assert.equal(Number((await con.runAndReadAll('SELECT vies_politico FROM public.partido WHERE nr_partido=13')).getRowObjectsJson()[0].vies_politico),12.3);
  console.log('P7: eleições regulares, presidente, turnos, repetição da carga e rollback conferidos.');
} finally { con.closeSync(); db.closeSync(); }
