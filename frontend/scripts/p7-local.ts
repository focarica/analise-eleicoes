// Gera frontend/.p7-vies.duckdb a partir dos arquivos versionados da questão 7.
// Não usa o MotherDuck: as notas por partido/eleição estão no próprio
// sql/motherduck/14_vies_partidos.sql (o mesmo que o DBA executa) e o viés
// municipal no CSV exportado da view vw_questao_7_vies.
// Uso: bun run p7-local
import { DuckDBInstance } from "@duckdb/node-api";
import { readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const raiz = resolve(import.meta.dir, "../..");
const destino = resolve(import.meta.dir, "../.p7-vies.duckdb");
rmSync(destino, { force: true });
rmSync(destino + ".wal", { force: true });

const sql = readFileSync(resolve(raiz, "sql/motherduck/14_vies_partidos.sql"), "utf8");
// Só as tabelas de viés: CREATE/INSERT. Os ALTER/UPDATE são do banco completo.
const blocos = sql
  .replace(/^\s*--.*$/gm, "")
  .split(/;[ \t]*$/m)
  .map((b) => b.trim())
  .filter((b) => /^(CREATE OR REPLACE TABLE public\.vies_|INSERT INTO public\.vies_)/.test(b));

const db = await DuckDBInstance.create(destino);
const con = await db.connect();
await con.run("CREATE SCHEMA IF NOT EXISTS public");
for (const bloco of blocos) await con.run(bloco);

// Viés por município/eleição: CSV exportado da view vw_questao_7_vies
// (bun run p7-municipios). Mantém o site sem consulta ao MotherDuck.
const municipiosCsv = resolve(raiz, "data/referencias/vies_municipios.csv");
await con.run(`CREATE OR REPLACE TABLE public.vies_municipio AS
  SELECT * FROM read_csv_auto('${municipiosCsv.replace(/'/g, "''")}', HEADER = true)`);

const contar = async (tabela: string) =>
  (await con.runAndReadAll(`SELECT count(*) AS n FROM public.${tabela}`)).getRowObjectsJson()[0].n;
const partidos = Number(await contar("vies_partido_onda"));
const eleicoes = Number(await contar("vies_onda_eleicao"));
const municipios = Number(await contar("vies_municipio"));
console.log("partido/eleição:", partidos);
console.log("eleições:", eleicoes);
console.log("município/eleição:", municipios);

// Autoconferência: régua e linha esperam as 4 eleições e valores em −100..+100.
const fora = Number((await con.runAndReadAll(
  `SELECT count(*) AS n FROM public.vies_partido_onda
   WHERE vies IS NOT NULL AND (vies < -100 OR vies > 100)`,
)).getRowObjectsJson()[0].n);
if (partidos !== 131 || eleicoes !== 4 || fora !== 0) {
  throw new Error(`snapshot inesperado: ${partidos} partidos, ${eleicoes} eleições, ${fora} valores fora da escala`);
}
const munFora = Number((await con.runAndReadAll(
  `SELECT count(*) AS n FROM public.vies_municipio
   WHERE vies IS NOT NULL AND (vies < -100 OR vies > 100)`,
)).getRowObjectsJson()[0].n);
if (municipios !== 4954 || munFora !== 0) {
  throw new Error(`snapshot municipal inesperado: ${municipios} linhas, ${munFora} valores fora da escala`);
}
con.closeSync();
db.closeSync();
