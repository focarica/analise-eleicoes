// Aplica arquivos SQL de views no banco de referência MotherDuck BDR-TSE.
// Requer token com permissão de escrita no .env: MOTHERDUCK_TOKEN.
// Uso: bun run scripts/aplicar-views.ts  ../sql/motherduck/04_views_reeleicao.sql
import { resolve } from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";

const PAINEL = 'BDR-TSE';
const arquivos = process.argv.slice(2).map((a) => resolve(a));
if (arquivos.length === 0) {
  console.error("Passe os caminhos dos arquivos SQL como argumento.");
  process.exit(1);
}
const token = Bun.env.MOTHERDUCK_TOKEN;
if (!token) throw new Error("Configure MOTHERDUCK_TOKEN no arquivo .env local.");
const inst = await DuckDBInstance.create(`md:${PAINEL}?motherduck_token=${token}`);
const con = await inst.connect();
await con.run(`USE "${PAINEL}"`);
for (const arquivo of arquivos) {
  const sql = await Bun.file(arquivo).text();
  const statements = sql.split(/;(?=\s*(?:CREATE|USE|--|WITH|$))/);
  let n = 0;
  for (const statement of statements) {
    const semComentarios = statement
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n")
      .trim();
    if (!semComentarios) continue;
    await con.run(semComentarios);
    n++;
  }
  console.log(`${arquivo}: ${n} statements aplicados.`);
}
console.log("OK");
