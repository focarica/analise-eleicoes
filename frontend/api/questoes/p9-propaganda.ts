// Questão 9: onde o candidato investe em propaganda (nuvens de palavras na ficha).
// Não tem rota própria: acrescenta propagandaValor e propagandaFrequencia à ficha
// do candidato (/api/candidate/:id). Edite só este arquivo para mudar esses dados.
import { comCache, json, rows, UFS, YEARS } from "../banco";
import type { ExtensaoCandidato } from "./tipos";

export const rotas = {
  "/api/q9/anos": async (url: URL) => {
    const uf = (url.searchParams.get("uf") || "").toUpperCase();
    if (uf && !UFS.has(uf)) return json({ error: "UF fora da amostra." }, 400);
    const filtro = uf ? "WHERE uf = $1" : "";
    const anos = await comCache(`q9anos:${uf || "*"}`, () => rows(
      `SELECT DISTINCT ano_eleicao AS ano FROM public.vw_questao_9_nuvem_geral ${filtro} ORDER BY ano`, uf ? [uf] : [],
    ));
    return json({ anos: anos.map(r => Number(r.ano)).filter(a => YEARS.has(a)) });
  },
  "/api/q9/geral": async (url: URL) => {
    const uf = (url.searchParams.get("uf") || "").toUpperCase();
    const ano = Number(url.searchParams.get("ano"));
    if (uf && !UFS.has(uf)) return json({ error: "UF fora da amostra." }, 400);
    if (!YEARS.has(ano)) return json({ error: "Ano inválido." }, 400);
    const filtro = uf ? "AND uf = $2" : "";
    const params = uf ? [ano, uf] : [ano];
    const termos = await comCache(`q9geral:${uf || "*"}:${ano}`, () => rows(
      `WITH por_candidato AS (
         SELECT termo, sq_candidato, SUM(valor_associado) AS gasto,
                SUM(qt_lancamentos) AS lancamentos, MAX(nm_candidato) AS nome,
                MAX(nm_urna_candidato) AS urna, MAX(ds_cargo) AS cargo,
                MAX(sg_partido) AS partido, ANY_VALUE(base_valor) AS base_valor
         FROM public.vw_questao_9_nuvem_geral
         WHERE ano_eleicao = $1 ${filtro}
         GROUP BY termo, sq_candidato
       ), ordenados AS (
         SELECT *, SUM(gasto) OVER (PARTITION BY termo) AS gasto_total,
                SUM(lancamentos) OVER (PARTITION BY termo) AS lancamentos_total,
                COUNT(*) OVER (PARTITION BY termo) AS qtd_candidatos,
                ROW_NUMBER() OVER (PARTITION BY termo ORDER BY gasto DESC NULLS LAST,
                  lancamentos DESC, COALESCE(nome, urna, ''), sq_candidato) AS pos
         FROM por_candidato
       )
       SELECT termo, gasto_total, lancamentos_total, qtd_candidatos, base_valor,
              COALESCE(nome, urna, 'Candidato não identificado') AS maior_candidato,
              sq_candidato AS maior_sq, cargo AS maior_cargo, partido AS maior_partido,
              gasto AS maior_gasto, lancamentos AS maior_lancamentos
       FROM ordenados WHERE pos = 1
       ORDER BY COALESCE(gasto_total, lancamentos_total) DESC, termo LIMIT 35`, params,
    ));
    return json({ uf, ano, termos: termos.map(r => ({
      termo: r.termo, totalGasto: r.gasto_total == null ? null : Number(r.gasto_total),
      baseValor: r.base_valor,
      totalLancamentos: Number(r.lancamentos_total), qtdCandidatos: Number(r.qtd_candidatos),
      maiorCandidato: r.maior_candidato, maiorSq: String(r.maior_sq), maiorCargo: r.maior_cargo,
      maiorPartido: r.maior_partido, maiorGasto: r.maior_gasto == null ? null : Number(r.maior_gasto),
      maiorLancamentos: Number(r.maior_lancamentos),
      participacaoPct: r.gasto_total > 0 ? Number(r.maior_gasto) * 100 / Number(r.gasto_total) : null,
    })) });
  },
};

// As views vw_questao_9_* agregam a base inteira: filtrar por (ano, sq) das
// candidaturas da pessoa — o que o README das views da Q9 recomenda — faz a
// consulta cair de dezenas de segundos para menos de um.
export const candidato: ExtensaoCandidato = async (_id, candidaturas) => {
  if (!candidaturas.length) return { propagandaValor: [], propagandaFrequencia: [] };
  const filtro = candidaturas
    .map((_, k) => `(ano_eleicao = CAST($${2 * k + 1} AS INTEGER) AND sq_candidato = CAST($${2 * k + 2} AS BIGINT))`)
    .join(" OR ");
  const valores = candidaturas.flatMap((c) => [String(c.ano_eleicao), String(c.sq_candidato)]);
  const nuvem = (ordem: string, peso: string, somenteComValor = false) => rows(`SELECT ano_eleicao, sq_candidato, ds_cargo, termo, ${peso},
                 valor_associado, base_valor, qt_lancamentos
          FROM public.vw_questao_9_nuvem_valor
          WHERE ${filtro} ${somenteComValor ? "AND valor_associado IS NOT NULL" : ""}
          QUALIFY ROW_NUMBER() OVER (
            PARTITION BY ano_eleicao, ds_cargo ORDER BY ${ordem} DESC, termo
          ) <= 35
          ORDER BY ano_eleicao, ds_cargo, ${ordem} DESC, termo`, valores);
  const [propagandaValor, propagandaFrequencia] = await Promise.all([
    nuvem("peso", "peso", true),
    // Deriva frequência da mesma base de termos para evitar divergência entre as duas views.
    nuvem("qt_lancamentos", "qt_lancamentos AS peso"),
  ]);
  return { propagandaValor, propagandaFrequencia };
};
