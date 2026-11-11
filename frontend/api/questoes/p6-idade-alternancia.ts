// P6 — idade média estimada do eleitorado, idade dos prefeitos e alternância partidária.
import { UFS, comCache, json, rows } from "../banco";
import type { Rotas } from "./tipos";

const ANOS = new Set([2004, 2008, 2012, 2016, 2020, 2024]);

export const rotas: Rotas = {
  "/api/q6-idade-alternancia": async (url: URL) => {
    const uf = (url.searchParams.get("uf") || "").toUpperCase();
    const ano = Number(url.searchParams.get("ano") || 2024);
    if ((uf && !UFS.has(uf)) || !ANOS.has(ano))
      return json({ error: "Selecione uma UF da amostra e um ano municipal entre 2004 e 2024." }, 400);
    const dados = await comCache(`q6:${uf || "*"}:${ano}`, () => rows(
      `SELECT ano_eleicao, cd_municipio_tse, nm_municipio, sg_uf,
              nm_urna_candidato, sg_partido, idade_prefeito,
              ano_eleicao_anterior, sg_partido_anterior, idade_media_eleitorado,
              qt_eleitores_com_idade, alternou_partido, mesmo_prefeito
       FROM public.vw_questao_6_idade_alternancia
       WHERE ano_eleicao = $1 ${uf ? "AND sg_uf = $2" : ""}
       ORDER BY nm_municipio`, uf ? [ano, uf] : [ano],
    ));
    return json({ ano, uf: uf || null, dados });
  },
};
