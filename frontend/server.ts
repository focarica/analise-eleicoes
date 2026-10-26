import { resolve, sep } from "node:path";
import {
  ConsultaLenta, DATABASE, UFS, YEARS, buscaCacheVersionado, comCache, errorMessage, json, rows, seguido,
} from "./api/banco";
import { EXTENSOES_CANDIDATO, EXTENSOES_MUNICIPIO, ROTAS_QUESTOES } from "./api/questoes";
import { fundoPublico } from "./api/questoes/p8-financiamento";

// Núcleo da API: mapa, busca, fotos, ficha do candidato e gaveta do município.
// As rotas de cada questão ficam em api/questoes/ (uma por arquivo).
const PORT = Number(Bun.env.PORT || 3001);
// A busca reaproveita consultas em curso e acompanha a revisão da carga.
function buscaEmCache(chave: string, consulta: () => Promise<unknown>) {
  return buscaCacheVersionado(chave, consulta);
}

// Mesma regra da view v_historico_candidato (sql/motherduck/01_views_analiticas.sql),
// mas com as candidaturas da pessoa ($1) filtradas antes de agregar receitas,
// despesas e bens. Se a view mudar, mude aqui também.
const SQL_HISTORICO_CANDIDATO = `
WITH alvo AS (
    SELECT ano_eleicao, sq_candidato
    FROM public.candidatura
    WHERE id_pessoa_projeto = $1
),
receita_linhas AS (
    SELECT
        rc.ano_eleicao,
        rc.sq_candidato,
        rc.ds_fonte_receita AS fonte,
        COALESCE(
            NULLIF(rc.tp_origem_recurso, ''),
            CASE
                WHEN ${fundoPublico("rc.ds_fonte_receita")} THEN 'PÚBLICO'
                WHEN rc.ds_fonte_receita = 'OUTROS RECURSOS' THEN 'PRIVADO'
                ELSE 'INDEFINIDO'
            END
        ) AS origem,
        SUM(rc.vr_receita) AS valor,
        COUNT(*) AS qtd
    FROM public.receitas_campanha rc
    JOIN alvo USING (ano_eleicao, sq_candidato)
    GROUP BY 1, 2, 3, 4
),
receitas AS (
    SELECT
        ano_eleicao,
        sq_candidato,
        SUM(valor) AS total_receitas,
        SUM(valor) FILTER (WHERE origem = 'PÚBLICO') AS receitas_publicas,
        SUM(valor) FILTER (WHERE origem = 'PRIVADO') AS receitas_privadas,
        TO_JSON(LIST(
            STRUCT_PACK(fonte := fonte, origem := origem, valor := valor, qtd := qtd)
            ORDER BY valor DESC
        )) AS receitas
    FROM receita_linhas
    GROUP BY 1, 2
),
despesa_linhas AS (
    SELECT
        dp.ano_eleicao,
        dp.sq_candidato,
        dp.ds_despesa,
        dp.vr_pago,
        ROW_NUMBER() OVER (
            PARTITION BY dp.ano_eleicao, dp.sq_candidato
            ORDER BY dp.vr_pago DESC NULLS LAST
        ) AS rn
    FROM public.despesas_pagas dp
    JOIN alvo USING (ano_eleicao, sq_candidato)
),
despesas AS (
    SELECT
        ano_eleicao,
        sq_candidato,
        SUM(vr_pago) AS total_despesas,
        COUNT(*) AS qt_despesas,
        TO_JSON(LIST(
            STRUCT_PACK(despesa := ds_despesa, valor := vr_pago)
            ORDER BY vr_pago DESC NULLS LAST
        ) FILTER (WHERE rn <= 8)) AS despesas
    FROM despesa_linhas
    GROUP BY 1, 2
),
bens AS (
    SELECT
        bd.ano_eleicao,
        bd.sq_candidato,
        SUM(bd.vr_bem) AS total_bens,
        TO_JSON(LIST(
            STRUCT_PACK(
                tipo := bd.ds_tipo_bem,
                descricao := NULLIF(bd.ds_bem, '#NULO#'),
                valor := bd.vr_bem
            ) ORDER BY bd.vr_bem DESC NULLS LAST
        )) AS bens
    FROM public.bens_declarados bd
    JOIN alvo USING (ano_eleicao, sq_candidato)
    GROUP BY 1, 2
)
SELECT
    c.ano_eleicao,
    c.sq_candidato,
    ca.nm_candidato,
    c.nm_urna_candidato,
    c.sg_partido AS partido,
    c.ds_cargo AS cargo,
    COALESCE(m.sg_uf, c.sg_ue) AS uf,
    c.cd_municipio_tse AS municipio,
    m.nm_municipio,
    c.nr_turno_resultado AS turno,
    c.ds_sit_tot_turno AS situacao,
    c.qt_votos_totais AS votos,
    COALESCE(r.total_receitas, 0) AS total_receitas,
    COALESCE(r.receitas_publicas, 0) AS receitas_publicas,
    COALESCE(r.receitas_privadas, 0) AS receitas_privadas,
    COALESCE(r.receitas, '[]'::JSON) AS receitas,
    COALESCE(d.total_despesas, 0) AS total_despesas,
    COALESCE(d.qt_despesas, 0) AS qt_despesas,
    COALESCE(d.despesas, '[]'::JSON) AS despesas,
    COALESCE(b.total_bens, 0) AS patrimonio_declarado,
    COALESCE(b.bens, '[]'::JSON) AS bens
FROM public.candidatura c
JOIN alvo USING (ano_eleicao, sq_candidato)
JOIN public.candidato ca ON ca.id_pessoa_projeto = c.id_pessoa_projeto
LEFT JOIN public.municipio m ON m.cd_municipio_tse = c.cd_municipio_tse
LEFT JOIN receitas r USING (ano_eleicao, sq_candidato)
LEFT JOIN despesas d USING (ano_eleicao, sq_candidato)
LEFT JOIN bens b USING (ano_eleicao, sq_candidato)
ORDER BY c.ano_eleicao, c.ds_cargo`;
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
    const [parties] = await comCache(`dash2:${uf}:${year}`, () => seguido([
      // Presidente é eleito no Brasil inteiro (uf = "BR"): entra no painel dos
      // anos de eleição geral para que o botão de cargo tenha nome de partido.
      () => rows(`SELECT nr_partido, sg_partido, nm_partido, ds_cargo, qt_eleitos
            FROM public.v_partidos_eleitos
            WHERE (uf = $1 OR uf = 'BR') AND ano_eleicao = $2
            ORDER BY qt_eleitos DESC, sg_partido`, [uf, year]),
    ]));
    return json({ uf, year, parties });
  }

  // Partido vencedor em cada município: o mais votado no 1º turno de cada cargo
  // (votos nominais + legenda) e, para prefeito, o partido do eleito.
  if (path === "/api/municipal-map") {
    const uf = (url.searchParams.get("uf") || "").toUpperCase();
    const year = Number(url.searchParams.get("year"));
    if (!UFS.has(uf) || !YEARS.has(year)) return json({ error: "UF ou ano inválido." }, 400);
    const [winners, mayors] = await comCache(`mapa:${uf}:${year}`, () => seguido([
      () => rows(`WITH votos AS (
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
      () => rows(`SELECT c.cd_municipio_tse AS municipio, c.sg_partido AS partido,
                   c.nm_urna_candidato AS nome, c.id_pessoa_projeto AS id, c.qt_votos_totais AS votos
            FROM public.candidatura c
            JOIN public.municipio m USING (cd_municipio_tse)
            WHERE m.sg_uf = $1 AND c.ano_eleicao = $2 AND c.ds_cargo = 'PREFEITO'
              AND c.ds_sit_tot_turno IN ('ELEITO', 'ELEITO POR QP', 'ELEITO POR MÉDIA')`, [uf, year]),
    ]));
    return json({ uf, year, winners, mayors });
  }

  if (path === "/api/search") {
    const uf = (url.searchParams.get("uf") || "").toUpperCase();
    const term = (url.searchParams.get("q") || "").trim();
    if (!UFS.has(uf)) return json({ error: "UF inválida." }, 400);
    if (term.length < 2) return json({ municipalities: [], candidates: [] });
    const pattern = `%${term}%`;
    return json(await buscaEmCache(`${uf}|${term.toLowerCase()}`, async () => {
    const [municipalities, candidates] = await Promise.all([
      rows(`SELECT cd_municipio_tse AS id, nm_municipio AS nome
            FROM public.municipio
            WHERE sg_uf = $1 AND nm_municipio ILIKE $2
            ORDER BY nm_municipio LIMIT 8`, [uf, pattern]),
      // Presidente é disputa nacional (uf "BR"): entra na busca de qualquer
      // estado, senão sumia de todas
      rows(`SELECT ca.id_pessoa_projeto AS id, ca.nm_candidato AS nome,
                   string_agg(DISTINCT c.nm_urna_candidato, ' / ' ORDER BY c.nm_urna_candidato) AS urna,
                   string_agg(DISTINCT CAST(c.ano_eleicao AS VARCHAR), ', ' ORDER BY CAST(c.ano_eleicao AS VARCHAR)) AS anos,
                   string_agg(DISTINCT c.ds_cargo, '|#|' ORDER BY c.ds_cargo) AS cargos
            FROM public.candidato ca
            JOIN public.candidatura c USING (id_pessoa_projeto)
            LEFT JOIN public.municipio m ON m.cd_municipio_tse = c.cd_municipio_tse
            WHERE (COALESCE(m.sg_uf, UPPER(c.sg_ue)) = $1
                    OR UPPER(COALESCE(m.sg_uf, c.sg_ue)) = 'BR')
              AND (ca.nm_candidato ILIKE $2 OR c.nm_urna_candidato ILIKE $2)
            GROUP BY ca.id_pessoa_projeto, ca.nm_candidato
            ORDER BY (bool_or(c.ds_cargo = 'PRESIDENTE'))::int DESC,
                     MAX(c.ano_eleicao) DESC, ca.nm_candidato LIMIT 10`, [uf, pattern]),
    ]);
    return { municipalities, candidates };
    }));
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
    // As views v_historico_candidato e vw_questao_9_* agregam a base inteira e só
    // depois filtram a pessoa: ~30 s por ficha no MotherDuck, ocupando conexões
    // que a busca e o mapa esperavam. Por isso a ficha resolve antes as
    // candidaturas da pessoa e filtra por (ano, sq) — o que o README das views da
    // Q9 já recomenda —, e o histórico usa a mesma regra da view com o filtro no
    // início (SQL_HISTORICO_CANDIDATO). Mantém o mesmo cálculo da view.
    const [personRows, candidacies, extras] = await comCache(`cand2:${id}`, async () => {
      const chaves = await rows(`SELECT ano_eleicao, sq_candidato FROM public.candidatura
                                 WHERE id_pessoa_projeto = $1 ORDER BY 1, 2`, [id]);
      return Promise.all([
        rows(`SELECT nm_candidato, dt_nascimento, ds_grau_instrucao,
                     ds_genero, ds_cor_raca
              FROM public.candidato WHERE id_pessoa_projeto = $1`, [id]),
        rows(SQL_HISTORICO_CANDIDATO, [id]),
        // dados que as questões acrescentam à ficha (ex.: nuvens da Q9)
        Promise.all(EXTENSOES_CANDIDATO.map((ext) => ext(id, chaves))).then((partes) => Object.assign({}, ...partes)),
      ]);
    });
    const person = personRows[0];
    if (!person) return json({ error: "Candidato não encontrado." }, 404);
    return json({ ...person, candidacies, ...extras });
  }

  const municipalityMatch = path.match(/^\/api\/municipality\/([0-9]+)$/);
  if (municipalityMatch) {
    const code = municipalityMatch[1];
    const [municipality] = await rows(`SELECT cd_municipio_tse AS id, nm_municipio AS nome,
                                              sg_uf AS uf, cd_municipio_ibge AS ibge,
                                              pib_per_capita, idhm, populacao_total
                                       FROM public.municipio WHERE cd_municipio_tse = $1`, [code]);
    if (!municipality) return json({ error: "Município não encontrado." }, 404);
    const [attendance, electorate, parties, topCandidates, localCandidacies] = await comCache(`mun2:${code}`, () => seguido([
      () => rows(`SELECT ano_eleicao, nr_turno, qt_aptos, qt_comparecimento, qt_abstencao
            FROM public.comparecimento_municipio WHERE cd_municipio_tse = $1
            ORDER BY ano_eleicao, nr_turno`, [code]),
      () => rows(`SELECT ano_eleicao, ds_faixa_etaria, qt_eleitores
            FROM public.perfil_eleitorado WHERE cd_municipio_tse = $1
            ORDER BY ano_eleicao, ds_faixa_etaria`, [code]),
      () => rows(`SELECT ano_eleicao, cd_cargo, sg_partido, qt_votos_nominais, qt_votos_legenda
            FROM public.votacao_partido WHERE cd_municipio_tse = $1 AND nr_turno = 1
            ORDER BY ano_eleicao, cd_cargo, qt_votos_nominais DESC LIMIT 120`, [code]),
      () => rows(`SELECT ano_eleicao, cd_cargo, nm_urna_candidato, sg_partido,
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
      () => rows(`SELECT c.ano_eleicao, c.ds_cargo AS cargo, c.id_pessoa_projeto,
                   c.nm_urna_candidato, ca.nm_candidato, c.sg_partido,
                   c.ds_sit_tot_turno, c.qt_votos_totais AS qt_votos_nominais
            FROM public.candidatura c
            LEFT JOIN public.candidato ca USING (id_pessoa_projeto)
            WHERE c.cd_municipio_tse = $1
              AND c.ano_eleicao IN (2004, 2008, 2012, 2016, 2020, 2024)
              AND c.ds_cargo IN ('PREFEITO', 'VEREADOR')
            ORDER BY c.ano_eleicao, c.ds_cargo, c.ds_sit_tot_turno, c.nm_urna_candidato`, [code]),
    ]));
    // dados que as questões acrescentam à gaveta (ex.: escolaridade da Q4)
    const extras = Object.assign({}, ...await Promise.all(EXTENSOES_MUNICIPIO.map((ext) => ext(code))));
    return json({ ...municipality, attendance, electorate, parties, topCandidates, localCandidacies, ...extras });
  }

  const rotaQuestao = ROTAS_QUESTOES[path];
  if (rotaQuestao) return rotaQuestao(url);

  return json({ error: "Rota não encontrada." }, 404);
}

Bun.serve({
  port: PORT,
  // Padrão do Bun: 10 s. Uma resposta mais demorada que isso era derrubada sem
  // resposta, e o proxy do Vite mostrava "socket hang up". 255 é o máximo.
  idleTimeout: 120,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await route(request);
      } catch (error) {
        console.error(error);
        return json({ error: errorMessage(error) }, error instanceof ConsultaLenta ? 504 : 503);
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
