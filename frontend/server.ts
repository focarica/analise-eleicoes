import { resolve, sep } from "node:path";
import { DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";

const PORT = Number(Bun.env.PORT || 3001);
const DATABASE = "BDR-TSE";
const UFS = new Set(["AC", "AL", "BA", "DF", "RO", "SP"]);
const YEARS = new Set([2018, 2020, 2022, 2024]);
let connection: DuckDBConnection | undefined;
let connectionPromise: Promise<DuckDBConnection> | undefined;

async function db() {
  if (connection) return connection;
  if (!connectionPromise) {
    connectionPromise = (async () => {
      const token = Bun.env.MOTHERDUCK_TOKEN || Bun.env.motherduck_token;
      if (!token) throw new Error("Configure MOTHERDUCK_TOKEN no arquivo .env local.");
      process.env.motherduck_token = token;
      const instance = await DuckDBInstance.create(`md:${DATABASE}`);
      const con = await instance.connect();
      connection = con;
      return con;
    })();
  }
  return connectionPromise;
}

async function rows(sql: string, values: (string | number)[] = []) {
  const con = await db();
  const reader = await con.runAndReadAll(sql, values);
  return reader.getRowObjectsJson() as Record<string, unknown>[];
}

const json = (data: unknown, status = 200) => Response.json(data, { status });
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Erro ao consultar MotherDuck.";

async function route(request: Request) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/api/health") {
    await rows("SELECT 1 AS ok");
    return json({ ok: true, database: DATABASE });
  }

  if (path === "/api/meta") {
    const uf = (url.searchParams.get("uf") || "SP").toUpperCase();
    if (!UFS.has(uf)) return json({ error: "UF fora da amostra." }, 400);
    const years = await rows(
      "SELECT DISTINCT ano_eleicao FROM public.v_partidos_eleitos WHERE uf = $1 ORDER BY ano_eleicao DESC",
      [uf],
    );
    return json({ uf, years: years.map((r) => Number(r.ano_eleicao)) });
  }

  if (path === "/api/dashboard") {
    const uf = (url.searchParams.get("uf") || "").toUpperCase();
    const year = Number(url.searchParams.get("year"));
    if (!UFS.has(uf) || !YEARS.has(year)) return json({ error: "UF ou ano inválido." }, 400);
    const [parties, spending] = await Promise.all([
      rows(`SELECT nr_partido, sg_partido, nm_partido, ds_cargo, qt_eleitos
            FROM public.v_partidos_eleitos WHERE uf = $1 AND ano_eleicao = $2
            ORDER BY qt_eleitos DESC, sg_partido`, [uf, year]),
      rows(`SELECT ds_cargo, faixa_financeira,
                   "piso_faixa_r$" AS piso_faixa, "teto_faixa_r$" AS teto_faixa,
                   qtd_candidatos_na_faixa, qtd_eleitos, taxa_sucesso_pct,
                   media_gasto_eleitos, media_gasto_nao_eleitos,
                   MAX("teto_faixa_r$") OVER (PARTITION BY uf, ano_eleicao, ds_cargo) AS gasto_maximo,
                   ROUND((MAX("teto_faixa_r$") OVER (PARTITION BY uf, ano_eleicao, ds_cargo) + 0.01)
                         * faixa_financeira / 4, 2) AS limite_superior_faixa
            FROM public.vw_questao_2_despesas WHERE uf = $1 AND ano_eleicao = $2
            ORDER BY ds_cargo, faixa_financeira`, [uf, year]),
    ]);
    return json({ uf, year, parties, spending });
  }

  if (path === "/api/search") {
    const uf = (url.searchParams.get("uf") || "").toUpperCase();
    const term = (url.searchParams.get("q") || "").trim();
    if (!UFS.has(uf)) return json({ error: "UF inválida." }, 400);
    if (term.length < 2) return json({ municipalities: [], candidates: [] });
    const pattern = `%${term}%`;
    const [municipalities, candidates] = await Promise.all([
      rows(`SELECT cd_municipio_tse AS id, nm_municipio AS nome
            FROM public.municipio
            WHERE sg_uf = $1 AND nm_municipio ILIKE $2
            ORDER BY nm_municipio LIMIT 8`, [uf, pattern]),
      rows(`SELECT ca.id_pessoa_projeto AS id, ca.nm_candidato AS nome,
                   string_agg(DISTINCT c.nm_urna_candidato, ' / ' ORDER BY c.nm_urna_candidato) AS urna,
                   string_agg(DISTINCT CAST(c.ano_eleicao AS VARCHAR), ', ' ORDER BY CAST(c.ano_eleicao AS VARCHAR)) AS anos,
                   string_agg(DISTINCT c.ds_cargo, '|#|' ORDER BY c.ds_cargo) AS cargos
            FROM public.candidato ca
            JOIN public.candidatura c USING (id_pessoa_projeto)
            LEFT JOIN public.municipio m ON m.cd_municipio_tse = c.cd_municipio_tse
            WHERE COALESCE(m.sg_uf, UPPER(c.sg_ue)) = $1
              AND (ca.nm_candidato ILIKE $2 OR c.nm_urna_candidato ILIKE $2)
            GROUP BY ca.id_pessoa_projeto, ca.nm_candidato
            ORDER BY MAX(c.ano_eleicao) DESC, ca.nm_candidato LIMIT 10`, [uf, pattern]),
    ]);
    return json({ municipalities, candidates });
  }

  const candidateMatch = path.match(/^\/api\/candidate\/(\d+)$/);
  if (candidateMatch) {
    const id = Number(candidateMatch[1]);
    const [person] = await rows(`SELECT nm_candidato, dt_nascimento, ds_grau_instrucao,
                                        ds_genero, ds_cor_raca
                                 FROM public.candidato WHERE id_pessoa_projeto = $1`, [id]);
    if (!person) return json({ error: "Candidato não encontrado." }, 404);
    const candidacies = await rows(`SELECT ano_eleicao, nm_candidato, nm_urna_candidato,
                                          partido, cargo, uf, municipio, nm_municipio,
                                          turno, situacao, votos, total_receitas,
                                          receitas_publicas, receitas_privadas, receitas,
                                          total_despesas, qt_despesas, despesas,
                                          patrimonio_declarado, bens
                                   FROM public.v_historico_candidato
                                   WHERE id_pessoa_projeto = $1
                                   ORDER BY ano_eleicao, cargo`, [id]);
    return json({ ...person, candidacies });
  }

  const municipalityMatch = path.match(/^\/api\/municipality\/([0-9]+)$/);
  if (municipalityMatch) {
    const code = municipalityMatch[1];
    const [municipality] = await rows(`SELECT cd_municipio_tse AS id, nm_municipio AS nome,
                                              sg_uf AS uf, cd_municipio_ibge AS ibge,
                                              pib_per_capita, idhm, populacao_total
                                       FROM public.municipio WHERE cd_municipio_tse = $1`, [code]);
    if (!municipality) return json({ error: "Município não encontrado." }, 404);
    const [attendance, electorate, parties, topCandidates, localCandidacies] = await Promise.all([
      rows(`SELECT ano_eleicao, nr_turno, qt_aptos, qt_comparecimento, qt_abstencao
            FROM public.comparecimento_municipio WHERE cd_municipio_tse = $1
            ORDER BY ano_eleicao, nr_turno`, [code]),
      rows(`SELECT ano_eleicao, ds_faixa_etaria, qt_eleitores
            FROM public.perfil_eleitorado WHERE cd_municipio_tse = $1
            ORDER BY ano_eleicao, ds_faixa_etaria`, [code]),
      rows(`SELECT ano_eleicao, cd_cargo, sg_partido, qt_votos_nominais, qt_votos_legenda
            FROM public.votacao_partido WHERE cd_municipio_tse = $1 AND nr_turno = 1
            ORDER BY ano_eleicao, cd_cargo, qt_votos_nominais DESC LIMIT 120`, [code]),
      rows(`SELECT ano_eleicao, cd_cargo, nm_urna_candidato, sg_partido,
                   qt_votos_nominais, id_pessoa_projeto
            FROM (
              SELECT v.ano_eleicao, v.cd_cargo, c.nm_urna_candidato, c.sg_partido,
                     v.qt_votos_nominais, c.id_pessoa_projeto,
                     ROW_NUMBER() OVER (PARTITION BY v.ano_eleicao, v.cd_cargo
                                        ORDER BY v.qt_votos_nominais DESC) AS pos
              FROM public.votacao_candidato_municipio v
              JOIN public.candidatura c USING (ano_eleicao, sq_candidato)
              WHERE v.cd_municipio_tse = $1 AND v.nr_turno = 1
            ) ranked WHERE pos <= 5
            ORDER BY ano_eleicao, cd_cargo, pos`, [code]),
      rows(`SELECT c.ano_eleicao, c.ds_cargo AS cargo, c.id_pessoa_projeto,
                   c.nm_urna_candidato, ca.nm_candidato, c.sg_partido,
                   c.ds_sit_tot_turno, c.qt_votos_totais AS qt_votos_nominais
            FROM public.candidatura c
            LEFT JOIN public.candidato ca USING (id_pessoa_projeto)
            WHERE c.cd_municipio_tse = $1
              AND c.ano_eleicao IN (2020, 2024)
              AND c.ds_cargo IN ('PREFEITO', 'VEREADOR')
            ORDER BY c.ano_eleicao, c.ds_cargo, c.ds_sit_tot_turno, c.nm_urna_candidato`, [code]),
    ]);
    return json({ ...municipality, attendance, electorate, parties, topCandidates, localCandidacies });
  }

  return json({ error: "Rota não encontrada." }, 404);
}

Bun.serve({
  port: PORT,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await route(request);
      } catch (error) {
        console.error(error);
        return json({ error: errorMessage(error) }, 503);
      }
    }

    const dist = resolve(import.meta.dir, "dist");
    const requested = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    const filePath = resolve(dist, `.${requested}`);
    if (filePath.startsWith(`${dist}${sep}`) || filePath === resolve(dist, "index.html")) {
      const file = Bun.file(filePath);
      if (await file.exists()) return new Response(file);
    }
    const fallback = Bun.file(resolve(dist, "index.html"));
    return (await fallback.exists()) ? new Response(fallback) : new Response("Execute bun run build primeiro.", { status: 404 });
  },
});

console.log(`API e frontend disponíveis na porta ${PORT}; banco MotherDuck: ${DATABASE}`);
