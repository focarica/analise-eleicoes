// P6 — jovens (18–29) × não jovens × viés político: eleitorado do município/UF
// comparado com a idade dos candidatos e eleitos, 2018–2024.
// Fonte: view vw_questao_6_jovens_vies (sql/motherduck/13_view_questao_6_jovens_vies.sql).
// Enquanto a view não for aplicada no BDR-TSE, a rota usa a mesma consulta lida
// do arquivo SQL, para não manter duas versões da regra.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { UFS, comCache, json, rows, viewDisponivel } from "../banco";
import type { Rotas } from "./tipos";

const ANOS = new Set([2018, 2020, 2022, 2024]);
const VIEW = "vw_questao_6_jovens_vies";
const ARQUIVO = resolve(import.meta.dir, "../../../sql/motherduck/13_view_questao_6_jovens_vies.sql");

let corpo: string | undefined;
function consultaDaView() {
  corpo ??= readFileSync(ARQUIVO, "utf8")
    .split(new RegExp(`public\\.${VIEW}\\s+AS`, "i"))[1]
    .trim().replace(/;\s*$/, "");
  return corpo;
}
async function origem() {
  return (await viewDisponivel(VIEW)) ? `public.${VIEW}` : `(${consultaDaView()})`;
}

// Colunas somáveis da view (candidatos, eleitos e viés).
const SOMAS = [
  "cand_total", "cand_com_idade", "cand_jovens", "soma_idade_cand",
  "eleitos_total", "eleitos_com_idade", "eleitos_jovens", "soma_idade_eleitos",
  "vies_soma_jovens", "vies_n_jovens", "vies_soma_nao_jovens", "vies_n_nao_jovens",
  "esq_jovens", "dir_jovens", "esq_nao_jovens", "dir_nao_jovens",
  "vies_soma_eleitos_jovens", "vies_n_eleitos_jovens",
  "vies_soma_eleitos_nao_jovens", "vies_n_eleitos_nao_jovens",
].map((c) => `SUM(${c})::DOUBLE AS ${c}`).join(", ");

export const rotas: Rotas = {
  "/api/q6-jovens-vies": async (url: URL) => {
    const uf = (url.searchParams.get("uf") || "").toUpperCase();
    const ano = Number(url.searchParams.get("ano") || 2024);
    if ((uf && !UFS.has(uf)) || !ANOS.has(ano))
      return json({ error: "Selecione uma UF da amostra e um ano entre 2018, 2020, 2022 e 2024." }, 400);
    const filtroUf = uf ? "AND sg_uf = $1" : "";
    const params = uf ? [uf] : [];
    const dados = await comCache(`q6-jovens:v1:${uf || "*"}:${ano}`, async () => {
      const fonte = await origem();
      // Série dos quatro anos por cargo + eleitorado por ano (uma vez por unidade).
      const serie = await rows(
        `SELECT ano_eleicao, tipo_eleicao, cd_cargo, ANY_VALUE(ds_cargo) AS ds_cargo, ${SOMAS}
         FROM ${fonte} WHERE TRUE ${filtroUf} GROUP BY ALL ORDER BY 1, 3`, params);
      const eleitorado = await rows(
        `SELECT ano_eleicao, SUM(e29)::DOUBLE AS eleitores_18_29, SUM(e18)::DOUBLE AS eleitores_18_mais
         FROM (SELECT ano_eleicao, sg_uf, cd_municipio_tse,
                      ANY_VALUE(eleitores_18_29) AS e29, ANY_VALUE(eleitores_18_mais) AS e18
               FROM ${fonte} WHERE TRUE ${filtroUf} GROUP BY ALL)
         GROUP BY 1 ORDER BY 1`, params);
      // Unidades do ano escolhido: municípios (municipais) ou UFs (gerais), por cargo.
      const unidades = await rows(
        `SELECT sg_uf, cd_municipio_tse, ANY_VALUE(nm_municipio) AS nm_municipio, cd_cargo,
                ANY_VALUE(eleitores_18_29)::DOUBLE AS eleitores_18_29,
                ANY_VALUE(eleitores_18_mais)::DOUBLE AS eleitores_18_mais, ${SOMAS}
         FROM ${fonte} WHERE ano_eleicao = ${ano} ${filtroUf}
         GROUP BY sg_uf, cd_municipio_tse, cd_cargo ORDER BY 1, 3`, params);
      return { serie, eleitorado, unidades };
    });
    return json({ ano, uf: uf || null, ...dados });
  },
};
