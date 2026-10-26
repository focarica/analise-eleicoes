// Rotas da questão: p2-patrimonio-gasto. Edite só este arquivo para mudar a API desta questão.
import { UFS, YEARS, comCache, json, rows } from "../banco";
import type { Rotas } from "./tipos";

export const rotas: Rotas = {
  "/api/q2-despesas": async (url: URL) => {
    const uf = (url.searchParams.get("uf") || "").toUpperCase();
    const ano = Number(url.searchParams.get("ano"));
    if (!UFS.has(uf) || !YEARS.has(ano)) return json({ error: "UF ou ano inválido." }, 400);
    
    // além das colunas da view, os nomes e limites que o card da questão usa
    const dados = await comCache(`q2-desp2:${uf}:${ano}`, () => rows(
      `SELECT *,
              "piso_faixa_r$" AS piso_faixa, "teto_faixa_r$" AS teto_faixa,
              MAX("teto_faixa_r$") OVER (PARTITION BY uf, ano_eleicao, ds_cargo) AS gasto_maximo,
              ROUND((MAX("teto_faixa_r$") OVER (PARTITION BY uf, ano_eleicao, ds_cargo) + 0.01)
                    * faixa_financeira / 4, 2) AS limite_superior_faixa
       FROM public.vw_questao_2_despesas
       WHERE uf = $1 AND ano_eleicao = $2
       ORDER BY ds_cargo, faixa_financeira`, [uf, ano]
    ));
    return json({ uf, ano, dados });
  },
  "/api/q2-patrimonio": async (url: URL) => {
    const uf = (url.searchParams.get("uf") || "").toUpperCase();
    const ano = Number(url.searchParams.get("ano"));
    if (!UFS.has(uf) || !YEARS.has(ano)) return json({ error: "UF ou ano inválido." }, 400);
    
    const dados = await comCache(`q2-pat:${uf}:${ano}`, () => rows(
      `SELECT * FROM public.vw_questao_2_patrimonio_sucesso 
       WHERE uf = $1 AND ano_eleicao = $2 
       ORDER BY ds_cargo, quartil_patrimonio`, [uf, ano]
    ));
    return json({ uf, ano, dados });
  },
};
