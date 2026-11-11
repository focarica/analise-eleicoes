// Exporta vw_questao_7_vies do BDR-TSE para
// data/referencias/vies_municipios.csv. O snapshot local da P7 (p7-local.ts)
// lê esse CSV; o site nunca consulta o MotherDuck para a P7.
// Uso: bun run p7-municipios   (precisa de MOTHERDUCK_TOKEN no .env)
import { DuckDBInstance } from "@duckdb/node-api";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const banco = Bun.env.P7_MOTHERDUCK_DB || "BDR-TSE";
const token = Bun.env.MOTHERDUCK_TOKEN;
if (!token) throw new Error("MOTHERDUCK_TOKEN não definido no frontend/.env");
const destino = resolve(import.meta.dir, "../../data/referencias/vies_municipios.csv");

const db = await DuckDBInstance.create(`md:${banco}?token=${encodeURIComponent(token)}&motherduck_open_browser=false`);
const con = await db.connect();
const linhas = (await con.runAndReadAll(
  `SELECT v.ano_eleicao, v.cd_municipio_tse, m.nm_municipio, m.sg_uf,
          v.vies, v.cobertura, v.n_cargos, v.onda, v.onda_estendida
   FROM public.vw_questao_7_vies v
   LEFT JOIN public.municipio m USING (cd_municipio_tse)
   ORDER BY m.sg_uf, m.nm_municipio, v.ano_eleicao`,
)).getRowObjectsJson();
con.closeSync();
db.closeSync();

const colunas = ["ano_eleicao", "cd_municipio_tse", "nm_municipio", "sg_uf", "vies", "cobertura", "n_cargos", "onda", "onda_estendida"];
const csv = [colunas.join(","), ...linhas.map((r) => colunas.map((c) => r[c]).join(","))].join("\n") + "\n";
writeFileSync(destino, csv);
console.log("linhas:", linhas.length, "→", destino);
