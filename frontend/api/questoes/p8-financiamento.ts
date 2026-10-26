// Rotas da questão: p8-financiamento. Edite só este arquivo para mudar a API desta questão.
import { CARGOS, UFS, YEARS, comCache, json, rows, seguido } from "../banco";
import type { Rotas } from "./tipos";

// faixas de dependência pública (Q8): bruto do TSE e rótulos idênticos às views
const FAIXAS = new Set(["[00,25)", "[25,50)", "[50,75)", "[75,100]"]);
const SEM_RECEITA_FAIXA = new Set(["sem receita"]);

// Fundo público = FEFC + fundo partidário. O TSE grava a fonte com grafias variadas
// ("Fundo Partidario", "Fundo Partidáo", "RECURSOS DO FUNDO PARTIDÁRIO"), então a
// comparação ignora caixa, acentos e espaços. Sem isso, 2010–2016 ficam sem fundo público.
export const fundoPublico = (coluna: string) =>
  `UPPER(strip_accents(TRIM(${coluna}))) IN ('FUNDO ESPECIAL', 'FUNDO PARTIDARIO', 'FUNDO PARTIDAO', 'RECURSOS DO FUNDO PARTIDARIO')`;

// Mesma regra da view v_financiamento_candidatura (sql/motherduck/05_views_financiamento.sql),
// com a normalização de fundoPublico. Se a view mudar, mude aqui também.
const SQL_FINANCIAMENTO_CANDIDATURA = `
WITH receptor AS (
    SELECT
        ano_eleicao, sq_candidato,
        SUM(vr_receita) AS total,
        SUM(CASE WHEN ${fundoPublico("ds_fonte_receita")} THEN vr_receita ELSE 0 END) AS publicas
    FROM public.receitas_campanha
    GROUP BY 1, 2
)
SELECT
    c.ano_eleicao, c.sq_candidato, c.cd_cargo,
    COALESCE(m.sg_uf, c.sg_ue) AS uf,
    c.sg_partido, c.ds_sit_tot_turno,
    CASE WHEN c.ds_sit_tot_turno IN ('ELEITO', 'ELEITO POR QP', 'ELEITO POR MÉDIA') THEN 1 ELSE 0 END AS eleito,
    r.total, COALESCE(r.publicas, 0) AS publicas,
    CASE WHEN r.total > 0 THEN 100.0 * r.publicas / r.total ELSE NULL END AS pct_publico,
    CASE
        WHEN COALESCE(r.total, 0) = 0 THEN 'sem receita'
        WHEN 100.0 * r.publicas / r.total < 25 THEN '[00,25)'
        WHEN 100.0 * r.publicas / r.total < 50 THEN '[25,50)'
        WHEN 100.0 * r.publicas / r.total < 75 THEN '[50,75)'
        ELSE '[75,100]'
    END AS faixa
FROM public.candidatura c
LEFT JOIN public.municipio m ON m.cd_municipio_tse = c.cd_municipio_tse
LEFT JOIN receptor r ON r.ano_eleicao = c.ano_eleicao AND r.sq_candidato = c.sq_candidato
WHERE c.ds_sit_tot_turno IS NOT NULL
  AND c.cd_cargo IN (1, 3, 5, 6, 7, 8, 11, 13)
`;

export const rotas: Rotas = {
  "/api/financiamento": async (url: URL) => {
    const uf = (url.searchParams.get("uf") || "").toUpperCase();
    if (uf && !UFS.has(uf)) return json({ error: "UF fora da amostra." }, 400);
    const cargo = Number(url.searchParams.get("cargo") || 0);
    if (cargo && !(cargo in CARGOS)) return json({ error: "Cargo inválido." }, 400);
    const [condicao, params] = uf && cargo ? [`WHERE uf = $1 AND cd_cargo = $2`, [uf, cargo]]
      : uf ? ["WHERE uf = $1", [uf]]
      : cargo ? [`WHERE cd_cargo = $1`, [cargo]]
      : ["", []];
    const [faixas, fontes, partidos] = await comCache(`fin2:${uf || "*"}:${cargo}`, () => seguido([
      () => rows(`SELECT cd_cargo, ano_eleicao, faixa,
                   COUNT(*) AS candidaturas, SUM(eleito) AS eleitas,
                   ROUND(SUM(eleito) * 100.0 / NULLIF(COUNT(*), 0), 1) AS taxa_eleicao
            FROM (${SQL_FINANCIAMENTO_CANDIDATURA}) v ${condicao}
            GROUP BY 1, 2, 3`, params),
      () => rows(`SELECT cd_cargo, ano_eleicao, ds_fonte_receita, SUM(total) AS total
            FROM public.v_financiamento_fontes ${condicao}
            GROUP BY 1, 2, 3`, params),
      () => rows(`SELECT cd_cargo, ano_eleicao, sg_partido,
                   COUNT(*) AS candidaturas, SUM(eleito) AS eleitas,
                   SUM(total) AS arrecadado, SUM(publicas) AS publicas
            FROM (${SQL_FINANCIAMENTO_CANDIDATURA}) v ${condicao}
            GROUP BY 1, 2, 3`, params),
    ]));
    const partidosFechados = partidos.map((r: any) => ({
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
      faixas: faixas.map((r: any) => ({
        cdCargo: Number(r.cd_cargo),
        ano: Number(r.ano_eleicao),
        faixa: r.faixa,
        candidaturas: Number(r.candidaturas),
        eleitas: Number(r.eleitas),
        taxaEleicao: r.taxa_eleicao == null ? null : Number(r.taxa_eleicao),
      })),
      fontes: fontes.map((r: any) => ({
        cdCargo: Number(r.cd_cargo),
        ano: Number(r.ano_eleicao),
        fonte: r.ds_fonte_receita,
        total: Number(r.total),
      })),
      partidos: partidosFechados,
    });
  },
// Q8 — "quem são": candidaturas individuais dentro de uma faixa de
// dependência de fundo público. uf vazio = escopo inteiro (Presidente);
// `ano=all` pega todos os anos do escopo (agregado no cliente).
  "/api/financiamento/pessoas": async (url: URL) => {
    const uf = (url.searchParams.get("uf") || "").toUpperCase();
    if (uf && !UFS.has(uf)) return json({ error: "UF fora da amostra." }, 400);
    const cargo = Number(url.searchParams.get("cargo") || 0);
    if (!cargo || !(cargo in CARGOS)) return json({ error: "Cargo inválido." }, 400);
    const ano = url.searchParams.get("ano") || "";
    const todosAnos = ano === "all";
    const anosSel = todosAnos ? [] : ano.split(",").map(Number);
    if (!todosAnos && (!anosSel.length || anosSel.some(a => !YEARS.has(a)))) return json({ error: "Ano inválido." }, 400);
    const faixa = url.searchParams.get("faixa") || "";
    if (!SEM_RECEITA_FAIXA.has(faixa) && !FAIXAS.has(faixa)) return json({ error: "Faixa inválida." }, 400);
    const limite = Math.min(Number(url.searchParams.get("limite") || 30), 100);
    const desde = Math.max(Math.trunc(Number(url.searchParams.get("desde")) || 0), 0);
    const condicoes = ["v.cd_cargo = $1", "v.faixa = $2"];
    const params: (string | number)[] = [cargo, faixa];
    if (!todosAnos) {
      condicoes.push(`v.ano_eleicao IN (${anosSel.map((_, i) => `$${params.length + i + 1}`).join(", ")})`);
      params.push(...anosSel);
    }
    if (uf) { condicoes.push(`v.uf = $${params.length + 1}`); params.push(uf); }
    const pessoas = await comCache(`finp2:${uf || "*"}:${cargo}:${ano}:${faixa}:${limite}:${desde}`, () => rows(
      `SELECT ca.id_pessoa_projeto AS id, ca.nm_urna_candidato AS urna, pc.nm_candidato AS nome,
              v.sg_partido AS partido, v.ds_sit_tot_turno AS situacao, v.ano_eleicao AS ano,
              COALESCE(m.sg_uf, ca.sg_ue) AS uf, m.nm_municipio AS municipio,
              ROUND(v.pct_publico, 1) AS pct_publico, ROUND(v.publicas, 2) AS publicas,
              ROUND(v.total, 2) AS total
       FROM (${SQL_FINANCIAMENTO_CANDIDATURA}) v
       JOIN public.candidatura ca ON ca.ano_eleicao = v.ano_eleicao AND ca.sq_candidato = v.sq_candidato
       JOIN public.candidato pc ON pc.id_pessoa_projeto = ca.id_pessoa_projeto
       LEFT JOIN public.municipio m ON m.cd_municipio_tse = ca.cd_municipio_tse
       WHERE ${condicoes.join(" AND ")}
       ORDER BY v.total DESC, id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limite + 1, desde],
    ));
    const temMais = pessoas.length > limite;
    if (temMais) pessoas.pop();
    return json({ uf, cargo, ano, faixa, pessoas, temMais });
  },
};
