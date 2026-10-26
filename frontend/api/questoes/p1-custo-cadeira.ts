// Rotas da questão: p1-custo-cadeira. Edite só este arquivo para mudar a API desta questão.
import { UFS, YEARS, comCache, json, rows } from "../banco";
import type { Rotas } from "./tipos";

export const rotas: Rotas = {
  "/api/q1-custo-cadeira": async (url: URL) => {
    const uf = (url.searchParams.get("uf") || "").toUpperCase();
    const ano = Number(url.searchParams.get("ano"));
    if (!UFS.has(uf) || !YEARS.has(ano)) return json({ error: "UF ou ano inválido." }, 400);
    
    const dados = await comCache(`q1-custo:${uf}:${ano}`, () => rows(
      `SELECT * FROM public.vw_questao_1_custo_cadeira 
       WHERE uf = $1 AND ano_eleicao = $2 
       ORDER BY ds_cargo`, [uf, ano]
    ));
    return json({ uf, ano, dados });
  },
};
