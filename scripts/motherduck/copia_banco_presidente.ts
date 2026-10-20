// Cria BDR-TSE-2026 (modificável), copia as 11 tabelas do share BDR-TSE e
// publica a votação de Presidente por município (cargo 1, 2018/2022).
// Tokens: leitura do painel + escrita do proprietário do banco novo.
import { readFileSync } from "node:fs";
import { DuckDBInstance } from "@duckdb/node-api";

const env = readFileSync(".env", "utf8").split("\n").reduce((m, l) => {
  const i = l.indexOf("=");
  if (i > 0) m[l.slice(0, i).trim()] = l.slice(i + 1).trim();
  return m;
}, {});
// Conta destino do banco novo: por padrão, a própria conta do token do painel
// (nunca o token de escrita de outra pessoa). A sobrescreva só se necessário.
const tokenEscrita = process.env.MOTHERDUCK_TOKEN || env.MOTHERDUCK_TOKEN;
if (!tokenEscrita) throw new Error("Defina MOTHERDUCK_TOKEN_READ_WRITE no .env.");
const tokenLeitura = env.MOTHERDUCK_TOKEN;

const NOVO = "BDR-TSE-2026";
const TABELAS = [
  "bens_declarados", "candidato", "candidatura", "comparecimento_municipio",
  "despesas_pagas", "municipio", "partido", "perfil_eleitorado",
  "receitas_campanha", "votacao_candidato_municipio", "votacao_partido",
];

process.env.motherduck_token = tokenEscrita;
// attach só com token (sem SSO do navegador), para não vazar para outra conta logada
const con = await (await DuckDBInstance.create("md:?token=" + encodeURIComponent(tokenEscrita) + "&motherduck_open_browser=false")).connect();
const run = (sql) => con.run(sql);
const q = async (sql) => (await con.runAndReadAll(sql)).getRowObjectsJson();

// cria o banco novo se ainda não existir
const existe = (await q(`SELECT count(*) AS n FROM duckdb_databases() WHERE database_name = '${NOVO}'`))[0].n > 0;
if (!existe) {
  await run(`CREATE DATABASE "${NOVO}"`);
  await run(`USE "${NOVO}"`);
  console.log(`banco ${NOVO} criado`);
} else {
  await run(`USE "${NOVO}"`);
}

// 1. copia das tabelas do share
await run(`CREATE SCHEMA IF NOT EXISTS public`);
for (const t of TABELAS) {
  await run(`CREATE OR REPLACE TABLE public.${t} AS SELECT * FROM "BDR-TSE".public.${t}`);
}
console.log("tabelas copiadas:", (await q(`SELECT count(*) AS n FROM information_schema.tables WHERE table_schema='public'`))[0].n);

// 2. carga de presidente (mesmos CSVs da etapa de extração)
await run(`
CREATE OR REPLACE TEMP TABLE stg_partido_presidente AS SELECT * FROM
  read_csv('/tmp/opencode/tse/presidente_partido_2018.csv', delim=';', header=true)
  UNION ALL SELECT * FROM
  read_csv('/tmp/opencode/tse/presidente_partido_2022.csv', delim=';', header=true)`);
await run(`
CREATE OR REPLACE TEMP TABLE stg_candidato_presidente AS SELECT * FROM
  read_csv('/tmp/opencode/tse/presidente_candidato_2018.csv', delim=';', header=true)
  UNION ALL SELECT * FROM
  read_csv('/tmp/opencode/tse/presidente_candidato_2022.csv', delim=';', header=true)`);
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

// 3. totais nacionais de 1º turno por candidato a presidente
const totais = [];
for (const ano of [2018, 2022]) {
  for (const [sq, total] of Object.entries(JSON.parse(readFileSync(`/tmp/opencode/tse/presidente_nacional_${ano}.json`, "utf8"))))
    totais.push(`(${ano},${Number(sq)},${total})`);
}
await run(`CREATE OR REPLACE TEMP TABLE stg_total_nacional (ano_eleicao INTEGER, sq_candidato BIGINT, qt_votos INTEGER)`);
await run(`INSERT INTO stg_total_nacional VALUES ${totais.join(",")}`);
await run(`
  UPDATE public.candidatura c SET qt_votos_totais = t.qt_votos
  FROM (SELECT ano_eleicao, sq_candidato, qt_votos FROM stg_total_nacional) t
  WHERE c.ano_eleicao = t.ano_eleicao AND c.sq_candidato = t.sq_candidato AND c.ds_cargo = 'PRESIDENTE'`);

// 4. views analíticas
const raiz = "/home/bernardo/Documents/dev/analise-eleicoes/sql/motherduck";
for (const arquivo of ["01_views_analiticas.sql", "03_views_propaganda.sql"]) {
  await run(readFileSync(`${raiz}/${arquivo}`, "utf8"));
}
console.log("views recriadas.");

// 5. validação
const valid = await q(`
  SELECT ano_eleicao, cd_cargo, count(*) AS linhas
  FROM public.votacao_partido WHERE cd_cargo = 1
  GROUP BY 1, 2 ORDER BY 1`);
console.log("cargo 1 em votacao_partido:", JSON.stringify(valid));
const pres = await q(`
  SELECT ano_eleicao, nm_urna_candidato, sg_partido, qt_votos_totais, ds_sit_tot_turno
  FROM public.candidatura WHERE ds_cargo='PRESIDENTE' AND qt_votos_totais > 0
  ORDER BY ano_eleicao DESC, qt_votos_totais DESC LIMIT 6`);
console.log("totais nacionais:", JSON.stringify(pres, null, 1));

// 6. compartilha o banco novo com a conta de leitura do painel
try {
  await run(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ("${env.MOTHERDUCK_TOKEN}"::USER)`);
  console.log("grant de leitura aplicado");
} catch (e) {
  console.log("grant: precisa compartilhar pelo painel web do MotherDuck:", e.message.slice(0, 160));
}
con.close();
