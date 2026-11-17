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
    const dados = await comCache(`q3:${uf || "*"}:${ano}`, () => rows(
      `SELECT ano_eleicao, cd_municipio_tse, nm_municipio, sg_uf,
              nm_urna_candidato, sg_partido, ano_populacao, tipo_populacao, populacao,
              ano_pib, pib_per_capita, ano_idhm, idhm, qt_aptos, qt_comparecimento,
              qt_abstencao, pct_abstencao, pct_comparecimento, pct_eleitores_populacao
       FROM public.vw_questao_3_indicadores_municipio
       WHERE ano_eleicao = $1 ${uf ? "AND sg_uf = $2" : ""}
       ORDER BY nm_municipio`, uf ? [ano, uf] : [ano],
    ));
    return json({ ano, uf: uf || null, dados });
  },
};
