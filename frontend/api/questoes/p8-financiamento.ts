// Rotas da questão: p8-financiamento. Edite só este arquivo para mudar a API desta questão.
import { CARGOS, UFS, YEARS, comCache, json, rows, seguido } from "../banco";
import type { Rotas } from "./tipos";

// faixas de dependência pública (Q8): bruto do TSE e rótulos idênticos às views
const FAIXAS = new Set(["[00,25)", "[25,50)", "[50,75)", "[75,100]"]);
const SEM_RECEITA_FAIXA = new Set(["sem receita"]);

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
    const [faixas, fontes, partidos] = await comCache(`fin:${uf || "*"}:${cargo}`, () => seguido([
      () => rows(`SELECT cd_cargo, ano_eleicao, faixa,
                   SUM(candidaturas) AS candidaturas, SUM(eleitas) AS eleitas,
                   ROUND(SUM(eleitas) * 100.0 / NULLIF(SUM(candidaturas), 0), 1) AS taxa_eleicao
            FROM public.v_financiamento_faixas ${condicao}
            GROUP BY 1, 2, 3`, params),
      () => rows(`SELECT cd_cargo, ano_eleicao, ds_fonte_receita, SUM(total) AS total
            FROM public.v_financiamento_fontes ${condicao}
            GROUP BY 1, 2, 3`, params),
      () => rows(`SELECT cd_cargo, ano_eleicao, sg_partido,
                   SUM(candidaturas) AS candidaturas, SUM(eleitas) AS eleitas,
                   SUM(arrecadado) AS arrecadado, SUM(publicas) AS publicas
            FROM public.v_financiamento_partidos ${condicao}
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
    const pessoas = await comCache(`finp:${uf || "*"}:${cargo}:${ano}:${faixa}:${limite}:${desde}`, () => rows(
      `SELECT ca.id_pessoa_projeto AS id, ca.nm_urna_candidato AS urna, pc.nm_candidato AS nome,
              v.sg_partido AS partido, v.ds_sit_tot_turno AS situacao, v.ano_eleicao AS ano,
              COALESCE(m.sg_uf, ca.sg_ue) AS uf, m.nm_municipio AS municipio,
              ROUND(v.pct_publico, 1) AS pct_publico, ROUND(v.publicas, 2) AS publicas,
              ROUND(v.total, 2) AS total
       FROM public.v_financiamento_candidatura v
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
