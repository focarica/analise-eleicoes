import { resolve, sep } from "node:path";
import { DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";

const PORT = Number(Bun.env.PORT || 3001);
// BDR-TSE-2026: banco na própria conta do painel — espelho do share BDR-TSE
// mais a votação de Presidente por município (carga em scripts/motherduck/).
const DATABASE = "BDR-TSE-2026";
const UFS = new Set(["AC", "AL", "BA", "DF", "RO", "SP"]);
const YEARS = new Set([2018, 2020, 2022, 2024]);
const CARGOS: Record<number, string> = { 3: "Governador", 5: "Senador", 6: "Deputado federal", 7: "Deputado estadual", 8: "Deputado distrital", 11: "Prefeito", 13: "Vereador" };
const UFS_LIST = ["AC", "AL", "BA", "DF", "RO", "SP"];
let connection: DuckDBConnection | undefined;
let connectionPromise: Promise<DuckDBConnection> | undefined;

async function db() {
  if (connection) return connection;
  if (!connectionPromise) {
    connectionPromise = (async () => {
      const token = Bun.env.MOTHERDUCK_TOKEN || Bun.env.motherduck_token;
      if (!token) throw new Error("Configure MOTHERDUCK_TOKEN no arquivo .env local.");
      // o token vai na connection string: o node-api não lê variáveis de ambiente
      // do DuckDB de forma confiável e sem vínculo explícito pode cair no SSO do
      // navegador (conta errada) em vez de usar o token do painel.
      const instancia = await DuckDBInstance.create(
        `md:${DATABASE}?token=${encodeURIComponent(token)}&motherduck_open_browser=false`,
      );
      connection = await instancia.connect();
      return connection;
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
      // Presidente é eleito no Brasil inteiro (uf = "BR"): entra no painel dos
      // anos de eleição geral para que o botão de cargo tenha nome de partido.
      rows(`SELECT nr_partido, sg_partido, nm_partido, ds_cargo, qt_eleitos
            FROM public.v_partidos_eleitos
            WHERE (uf = $1 OR uf = 'BR') AND ano_eleicao = $2
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

  // Partido vencedor em cada município: o mais votado no 1º turno de cada cargo
  // (votos nominais + legenda) e, para prefeito, o partido do eleito.
  if (path === "/api/municipal-map") {
    const uf = (url.searchParams.get("uf") || "").toUpperCase();
    const year = Number(url.searchParams.get("year"));
    if (!UFS.has(uf) || !YEARS.has(year)) return json({ error: "UF ou ano inválido." }, 400);
    const [winners, mayors] = await Promise.all([
      rows(`WITH votos AS (
              SELECT v.cd_municipio_tse, v.cd_cargo, v.sg_partido,
                     SUM(COALESCE(v.qt_votos_nominais, 0) + COALESCE(v.qt_votos_legenda, 0)) AS votos
              FROM public.votacao_partido v
              JOIN public.municipio m USING (cd_municipio_tse)
              WHERE m.sg_uf = $1 AND v.ano_eleicao = $2 AND v.nr_turno = 1 AND v.sg_partido IS NOT NULL
              GROUP BY 1, 2, 3
            ), ranqueado AS (
              SELECT *, SUM(votos) OVER (PARTITION BY cd_municipio_tse, cd_cargo) AS total,
                     ROW_NUMBER() OVER (PARTITION BY cd_municipio_tse, cd_cargo ORDER BY votos DESC, sg_partido) AS pos
              FROM votos
            )
            SELECT cd_municipio_tse AS municipio, cd_cargo AS cargo, sg_partido AS partido, votos, total
            FROM ranqueado WHERE pos = 1 AND votos > 0`, [uf, year]),
      rows(`SELECT c.cd_municipio_tse AS municipio, c.sg_partido AS partido,
                   c.nm_urna_candidato AS nome, c.id_pessoa_projeto AS id, c.qt_votos_totais AS votos
            FROM public.candidatura c
            JOIN public.municipio m USING (cd_municipio_tse)
            WHERE m.sg_uf = $1 AND c.ano_eleicao = $2 AND c.ds_cargo = 'PREFEITO'
              AND c.ds_sit_tot_turno IN ('ELEITO', 'ELEITO POR QP', 'ELEITO POR MÉDIA')`, [uf, year]),
    ]);
    return json({ uf, year, winners, mayors });
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

  // P10a — reeleição: fichas por cargo com os ciclos de eleição seguinte.
  // uf vazio = TODOS as UFs da amostra, somado aqui; `estados` traz sempre os
  // ciclos estaduais de cada UF (para o mapa-calor estado a estado) e `media`
  // a média dos municípios por cargo municipal (11 e 13).
  if (path === "/api/reeleicao") {
    const uf = (url.searchParams.get("uf") || "").toUpperCase();
    if (uf && !UFS.has(uf)) return json({ error: "UF fora da amostra." }, 400);
    const [estados, municipais] = await Promise.all([
      rows(`SELECT cd_cargo, uf, ano_eleito, ano_disputa, eleitos, tentaram,
                   reeleitos, taxa, ha_proxima
            FROM public.v_reeleicao_linhas
            WHERE cd_municipio_tse IS NULL
            ORDER BY cd_cargo, ano_eleito`),
      rows(`SELECT cd_cargo, uf, ano_eleito, ano_disputa,
                   SUM(eleitos) AS eleitos, SUM(tentaram) AS tentaram, SUM(reeleitos) AS reeleitos,
                   COUNT(*) AS municipios,
                   ROUND(AVG(CASE WHEN tentaram > 0 THEN taxa END), 1) AS taxa_municipios,
                   MAX(ha_proxima) AS ha_proxima
            FROM public.v_reeleicao_linhas
            WHERE cd_municipio_tse IS NOT NULL
            GROUP BY 1, 2, 3, 4`),
    ]);
    const fechar = (r: any) => ({
      cdCargo: Number(r.cd_cargo),
      uf: r.uf ?? r.uf_state ?? null,
      anoEleito: Number(r.ano_eleito),
      anoDisputa: Number(r.ano_disputa),
      eleitos: Number(r.eleitos),
      tentaram: Number(r.tentaram),
      reeleitos: Number(r.reeleitos),
      taxa: r.taxa == null ? null : Number(r.taxa),
      haProxima: r.ha_proxima === true,
    });
    const porCargo = (linhas: any) => {
      const porAno = new Map();
      for (const r of linhas) {
        const chave = `${r.anoEleito}|${r.anoDisputa}`;
        if (!porAno.has(chave)) porAno.set(chave, { ...r, eleitos: 0, tentaram: 0, reeleitos: 0 });
        const c = porAno.get(chave);
        c.eleitos += r.eleitos;
        c.tentaram += r.tentaram;
        c.reeleitos += r.reeleitos;
        c.haProxima = c.haProxima || r.haProxima;
        c.taxa = c.tentaram > 0 ? Math.round(c.reeleitos * 1000 / c.tentaram) / 10 : null;
      }
      return [...porAno.values()].sort((a, b) => a.anoEleito - b.anoEleito);
    };
    const municipaisFechados = municipais.map((r) => ({
      ...fechar(r),
      taxa: Number(r.tentaram) > 0 ? Math.round(Number(r.reeleitos) * 1000 / Number(r.tentaram)) / 10 : null,
      municipios: Number(r.municipios),
      taxaMunicipios: r.taxa_municipios == null ? null : Number(r.taxa_municipios),
    }));
    const cargos = [3, 5, 6, 7, 8, 11, 13].map((cd) => {
      const estado = estados.filter((r) => (!uf || r.uf === uf) && Number(r.cd_cargo) === cd).map(fechar);
      // prefeito e vereador só têm grão municipal: os ciclos saem da soma dos municípios
      const municipaisCargo = municipaisFechados.filter((r) => r.cdCargo === cd && (!uf || r.uf === uf));
      const fonte = estado.length > 0 ? estado : municipaisCargo;
      return {
        cdCargo: cd,
        cargo: CARGOS[cd],
        ciclos: fonte.map((r: any) => ({ ...r, municipios: r.municipios ?? null, taxaMunicipios: r.taxaMunicipios ?? null })).sort((a: any, b: any) => a.anoEleito - b.anoEleito),
        media: municipaisCargo.sort((a, b) => a.anoEleito - b.anoEleito),
      };
    });
    const gradas = [3, 5, 6, 7, 8].map((cd) => ({
      cdCargo: cd,
      cargo: CARGOS[cd],
      porUf: UFS_LIST.map((u) => ({
        uf: u,
        ciclos: porCargo(estados.filter((r) => r.uf === u && Number(r.cd_cargo) === cd).map(fechar)),
      })),
    }));
    return json({ uf, cargos, estados: gradas });
  }

  if (path === "/api/reeleicao/pessoas") {
    const uf = (url.searchParams.get("uf") || "").toUpperCase();
    const cargo = Number(url.searchParams.get("cargo"));
    const eleitosEm = Number(url.searchParams.get("eleitos_em"));
    const grupo = url.searchParams.get("grupo") || "";
    const q = (url.searchParams.get("q") || "").trim();
    const limite = Math.min(Number(url.searchParams.get("limite")) || 60, 200);
    const desde = Number(url.searchParams.get("desde")) || 0;
    if (!UFS.has(uf) || !CARGOS[cargo]) return json({ error: "UF ou cargo inválido." }, 400);
    if (!["voltou", "perderam", "nao"].includes(grupo)) return json({ error: "Grupo inválido." }, 400);
    const pattern = `%${q}%`;
    const pessoas = await rows(
      `SELECT id_pessoa_projeto, sq_candidato, ano_foto, nm_urna_candidato,
              sg_partido, nm_municipio, votos, grupo
       FROM public.v_reeleicao_pessoas
       WHERE uf = $1 AND cd_cargo = $2 AND ano_eleito = $3 AND grupo = $4
         AND (nm_urna_candidato ILIKE $5 OR COALESCE(nm_municipio, '') ILIKE $5)
       ORDER BY nm_urna_candidato
       LIMIT $6 OFFSET $7`,
      [uf, cargo, eleitosEm, grupo, pattern, limite + 1, desde],
    );
    const temMais = pessoas.length > limite;
    if (temMais) pessoas.pop();
    return json({ uf, cargo, eleitosEm, grupo, pessoas, temMais });
  }

  // Q8 — financiamento: peso dos fundos públicos por cargo, faixa e partido.
  // uf vazio = TODOS as UFs da amostra, agregado aqui.
  if (path === "/api/financiamento") {
    const uf = (url.searchParams.get("uf") || "").toUpperCase();
    if (uf && !UFS.has(uf)) return json({ error: "UF fora da amostra." }, 400);
    const condicaoUf = uf ? "WHERE uf = $1" : "";
    const params = uf ? [uf] : [];
    const [faixas, fontes, partidos] = await Promise.all([
      rows(`SELECT cd_cargo, ano_eleicao, faixa,
                   SUM(candidaturas) AS candidaturas, SUM(eleitas) AS eleitas,
                   ROUND(SUM(eleitas) * 100.0 / NULLIF(SUM(candidaturas), 0), 1) AS taxa_eleicao
            FROM public.v_financiamento_faixas ${condicaoUf}
            GROUP BY 1, 2, 3`, params),
      rows(`SELECT cd_cargo, ano_eleicao, ds_fonte_receita, SUM(total) AS total
            FROM public.v_financiamento_fontes ${condicaoUf}
            GROUP BY 1, 2, 3`, params),
      rows(`SELECT cd_cargo, ano_eleicao, sg_partido,
                   SUM(candidaturas) AS candidaturas, SUM(eleitas) AS eleitas,
                   SUM(arrecadado) AS arrecadado, SUM(publicas) AS publicas
            FROM public.v_financiamento_partidos ${condicaoUf}
            GROUP BY 1, 2, 3`, params),
    ]);
    const partidosFechados = partidos.map((r) => ({
      cdCargo: Number(r.cd_cargo),
      ano: Number(r.ano_eleicao),
      partido: r.sg_partido,
      candidaturas: Number(r.candidaturas),
      eleitas: Number(r.eleitas),
      arrecadado: Number(r.arrecadado),
      publicas: Number(r.publicas),
      pctPublico: Number(r.arrecadado) > 0 ? Math.round(Number(r.publicas) * 1000 / Number(r.arrecadado)) / 10 : null,
    }));
    return json({
      uf,
      faixas: faixas.map((r) => ({
        cdCargo: Number(r.cd_cargo),
        ano: Number(r.ano_eleicao),
        faixa: r.faixa,
        candidaturas: Number(r.candidaturas),
        eleitas: Number(r.eleitas),
        taxaEleicao: r.taxa_eleicao == null ? null : Number(r.taxa_eleicao),
      })),
      fontes: fontes.map((r) => ({
        cdCargo: Number(r.cd_cargo),
        ano: Number(r.ano_eleicao),
        fonte: r.ds_fonte_receita,
        total: Number(r.total),
      })),
      partidos: partidosFechados,
    });
  }

  const photoMatch = path.match(/^\/api\/photo\/(\d{4})\/(\d{1,20})$/);
  if (photoMatch) {
    const year = Number(photoMatch[1]);
    const sq = photoMatch[2];
    if (!YEARS.has(year)) return json({ error: "Ano inválido." }, 400);
    const [candidacy] = await rows(
      "SELECT 1 AS encontrada FROM public.candidatura WHERE ano_eleicao = $1 AND sq_candidato = $2 LIMIT 1",
      [year, Number(sq)],
    );
    if (!candidacy) return json({ error: "Candidatura não encontrada." }, 404);
    const publicBase = Bun.env.R2_PUBLIC_BASE_URL?.replace(/\/+$/, "");
    if (!publicBase || !publicBase.startsWith("https://")) {
      return json({ error: "Configure R2_PUBLIC_BASE_URL no ambiente local." }, 503);
    }
    return Response.redirect(`${publicBase}/candidatos/${year}/${sq}`, 302);
  }

  const candidateMatch = path.match(/^\/api\/candidate\/(\d+)$/);
  if (candidateMatch) {
    const id = Number(candidateMatch[1]);
    const [personRows, candidacies, propagandaValor, propagandaFrequencia] = await Promise.all([
      rows(`SELECT nm_candidato, dt_nascimento, ds_grau_instrucao,
                   ds_genero, ds_cor_raca
            FROM public.candidato WHERE id_pessoa_projeto = $1`, [id]),
      rows(`SELECT ano_eleicao, sq_candidato, nm_candidato, nm_urna_candidato,
                   partido, cargo, uf, municipio, nm_municipio,
                   turno, situacao, votos, total_receitas,
                   receitas_publicas, receitas_privadas, receitas,
                   total_despesas, qt_despesas, despesas,
                   patrimonio_declarado, bens
            FROM public.v_historico_candidato
            WHERE id_pessoa_projeto = $1
            ORDER BY ano_eleicao, cargo`, [id]),
      rows(`SELECT ano_eleicao, sq_candidato, ds_cargo, termo, peso,
                   valor_pago_associado, qt_lancamentos
            FROM public.vw_questao_9_nuvem_valor
            WHERE id_pessoa_projeto = $1
            QUALIFY ROW_NUMBER() OVER (
              PARTITION BY ano_eleicao, ds_cargo ORDER BY peso DESC, termo
            ) <= 35
            ORDER BY ano_eleicao, ds_cargo, peso DESC, termo`, [id]),
      // Deriva frequência da mesma base de termos para evitar divergência entre as duas views.
      rows(`SELECT ano_eleicao, sq_candidato, ds_cargo, termo,
                   qt_lancamentos AS peso, valor_pago_associado, qt_lancamentos
            FROM public.vw_questao_9_nuvem_valor
            WHERE id_pessoa_projeto = $1
            QUALIFY ROW_NUMBER() OVER (
              PARTITION BY ano_eleicao, ds_cargo ORDER BY qt_lancamentos DESC, termo
            ) <= 35
            ORDER BY ano_eleicao, ds_cargo, qt_lancamentos DESC, termo`, [id]),
    ]);
    const person = personRows[0];
    if (!person) return json({ error: "Candidato não encontrado." }, 404);
    return json({ ...person, candidacies, propagandaValor, propagandaFrequencia });
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
