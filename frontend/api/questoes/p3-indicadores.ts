// P3 — indicadores municipais, eleitorado, abstenção e partido do prefeito eleito.
import { UFS, comCache, json, rows } from "../banco";
import type { Rotas } from "./tipos";

const ANOS_MUNICIPAIS = new Set([2004, 2008, 2012, 2016, 2020, 2024]);

export const rotas: Rotas = {
  "/api/q3-indicadores": async (url: URL) => {
    const uf = (url.searchParams.get("uf") || "").toUpperCase();
    const ano = Number(url.searchParams.get("ano") || 2024);
    if ((uf && !UFS.has(uf)) || !ANOS_MUNICIPAIS.has(ano))
      return json({ error: "Selecione uma UF da amostra e um ano de eleição municipal." }, 400);
    const dados = await comCache(`q3-vies:${uf || "*"}:${ano}`, () => rows(
      `SELECT i.ano_eleicao, i.cd_municipio_tse, i.nm_municipio, i.sg_uf,
              i.nm_urna_candidato, i.sg_partido, i.ano_populacao, i.tipo_populacao, i.populacao,
              i.ano_pib, i.pib_per_capita, i.ano_idhm, i.idhm, i.qt_aptos, i.qt_comparecimento,
              i.qt_abstencao, i.pct_abstencao, i.pct_comparecimento, i.pct_eleitores_populacao,
              vies.vies AS vies_partido
       FROM public.vw_questao_3_indicadores_municipio i
       LEFT JOIN LATERAL (
         SELECT v.vies
         FROM public.vies_partido_onda v
         WHERE v.ano_eleicao = i.ano_eleicao
           AND (v.nr_partido = i.nr_partido OR v.sg_partido = i.sg_partido)
         ORDER BY CASE WHEN v.sg_partido = i.sg_partido THEN 0 ELSE 1 END, v.sg_partido
         LIMIT 1
       ) vies ON TRUE
       WHERE i.ano_eleicao = $1 ${uf ? "AND i.sg_uf = $2" : ""}
       ORDER BY i.nm_municipio`, uf ? [ano, uf] : [ano],
    ));
    return json({ ano, uf: uf || null, dados });
  },
};
