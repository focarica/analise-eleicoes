import { readFileSync } from "node:fs";
import { DuckDBInstance } from "@duckdb/node-api";

// Token de escrita vem do ambiente ou do .env local (nunca commitado).
// Uso: MOTHERDUCK_TOKEN=<token de escrita> bun scripts/motherduck/carga_presidente.ts
const envToken = (() => {
  try {
    const linha = readFileSync(".env", "utf8")
      .split("\n")
      .find((l) => l.startsWith("MOTHERDUCK_TOKEN_READ_WRITE=") || l.startsWith("MOTHERDUCK_WRITE_TOKEN="));
    return linha?.split("=")[1]?.trim();
  } catch {
    return undefined;
  }
})();
process.env.motherduck_token =
  process.env.MOTHERDUCK_TOKEN || process.env.motherduck_token || envToken || "";
const DIR = "/tmp/opencode/tse";

const con = await (await DuckDBInstance.create("md:BDR-TSE")).connect();
const run = (sql) => con.run(sql);
const q = async (sql) => (await con.runAndReadAll(sql)).getRowObjectsJson();

const carga = `
CREATE OR REPLACE TEMP TABLE stg_partido_presidente (
  ano_eleicao INTEGER, cd_eleicao INTEGER, nr_turno INTEGER, cd_cargo INTEGER,
  cd_municipio_tse VARCHAR, nr_partido INTEGER, sg_partido VARCHAR,
  qt_votos_legenda INTEGER, qt_votos_nominais INTEGER
);
CREATE OR REPLACE TEMP TABLE stg_candidato_presidente (
  ano_eleicao INTEGER, cd_eleicao INTEGER, nr_turno INTEGER, cd_cargo INTEGER,
  cd_municipio_tse VARCHAR, sq_candidato BIGINT, qt_votos_nominais INTEGER
);
`;

await run(carga);
for (const ano of [2018, 2022]) {
  await run(`INSERT INTO stg_partido_presidente SELECT * FROM
    read_csv('${DIR}/presidente_partido_${ano}.csv', delim=';', header=true, all_varchar=false)`);
  await run(`INSERT INTO stg_candidato_presidente SELECT * FROM
    read_csv('${DIR}/presidente_candidato_${ano}.csv', delim=';', header=true, all_varchar=false)`);
}

// conferências antes da publicação
const checagens = await q(`
  SELECT 'partido' AS fonte, ano_eleicao, count(*) AS linhas,
         sum(qt_votos_nominais) AS nominais, count(DISTINCT cd_municipio_tse) AS municipios
  FROM stg_partido_presidente GROUP BY ano_eleicao
  UNION ALL
  SELECT 'candidato', ano_eleicao, count(*), sum(qt_votos_nominais), count(DISTINCT cd_municipio_tse)
  FROM stg_candidato_presidente GROUP BY ano_eleicao
  ORDER BY 1, 2`);
console.log("resumo escaneado:", JSON.stringify(checagens));

const semMunicipio = await q(`
  SELECT DISTINCT s.ano_eleicao, s.cd_municipio_tse FROM stg_partido_presidente s
  LEFT JOIN public.municipio m USING (cd_municipio_tse) WHERE m.cd_municipio_tse IS NULL`);
if (semMunicipio.length) throw new Error("municípios fora da base: " + JSON.stringify(semMunicipio));

const semCandidatura = await q(`
  SELECT s.ano_eleicao, s.sq_candidato FROM stg_candidato_presidente s
  LEFT JOIN public.candidatura c
    ON c.ano_eleicao = s.ano_eleicao AND c.sq_candidato = s.sq_candidato
   AND c.ds_cargo = 'PRESIDENTE'
  WHERE c.sq_candidato IS NULL GROUP BY 1, 2`);
if (semCandidatura.length) throw new Error("candidaturas ausentes: " + JSON.stringify(semCandidatura));

// publicação, mesmo join das tabelas originais
await run(`
  INSERT INTO public.votacao_partido
  SELECT s.ano_eleicao, s.cd_eleicao, s.nr_turno, s.cd_cargo, s.cd_municipio_tse,
         s.nr_partido, s.sg_partido, s.qt_votos_legenda, s.qt_votos_nominais
  FROM stg_partido_presidente s JOIN public.municipio m USING (cd_municipio_tse)`);
await run(`
  INSERT INTO public.votacao_candidato_municipio
  SELECT s.ano_eleicao, s.cd_eleicao, s.nr_turno, s.cd_cargo, s.cd_municipio_tse,
         s.sq_candidato, s.qt_votos_nominais
  FROM stg_candidato_presidente s JOIN public.municipio m USING (cd_municipio_tse)`);

// totais nacionais de 1º turno por candidato (in file)
const chargeTotals = [];
for (const ano of [2018, 2022]) {
  const totals = JSON.parse(readFileSync(`${DIR}/presidente_nacional_${ano}.json`, "utf8"));
  for (const [sq, total] of Object.entries(totals)) chargeTotals.push(`(${ano},${Number(sq)},${total})`);
}
await run(`CREATE OR REPLACE TEMP TABLE stg_total_nacional (ano_eleicao INTEGER, sq_candidato BIGINT, qt_votos_nacionais INTEGER)`);
await run(`INSERT INTO stg_total_nacional VALUES ${chargeTotals.join(",")}`);

await run(`
  UPDATE public.candidatura c SET qt_votos_totais = t.qt_votos_nacionais
  FROM (SELECT ano_eleicao, sq_candidato, qt_votos_nacionais FROM stg_total_nacional) t
  WHERE c.ano_eleicao = t.ano_eleicao AND c.sq_candidato = t.sq_candidato AND c.ds_cargo = 'PRESIDENTE'`);

const resultado = await q(`
  SELECT ano_eleicao, cd_cargo, nr_turno, count(*) AS linhas, sum(qt_votos_nominais) AS nominais
  FROM public.votacao_partido WHERE cd_cargo = 1 GROUP BY ALL ORDER BY ALL`);
console.log("votacao_partido cargo 1:", JSON.stringify(resultado));

const validacaoLulaBolso = await q(`
  SELECT ano_eleicao, sq_candidato, nm_urna_candidato, qt_votos_totais, ds_sit_tot_turno
  FROM public.candidatura
  WHERE ds_cargo = 'PRESIDENTE' AND qt_votos_totais IS NOT NULL
  ORDER BY ano_eleicao DESC, qt_votos_totais DESC LIMIT 8`);
console.log("totais nacionais:", JSON.stringify(validacaoLulaBolso));

con.close();
