// Rotas da questão: p4-escolaridade. Edite só este arquivo para mudar a API desta questão.
import { UFS, YEARS, comCache, json, rows, seguido, viewDisponivel } from "../banco";
import type { ExtensaoMunicipio, Rotas } from "./tipos";

// Gaveta do município: escolaridade dos candidatos e eleitos × população (Censo),
// por nível. null quando a view não está no banco (a gaveta então omite a seção).
export const municipio: ExtensaoMunicipio = async (codigo) => {
  if (!(await viewDisponivel("vw_questao_4_escolaridade"))) return { education: null };
  const education = await comCache(`q4mun:${codigo}`, () => rows(`SELECT ano_eleicao, ano_censo, ds_cargo, nr_nivel, ds_nivel,
               qt_candidatos, qt_eleitos, qt_populacao
        FROM public.vw_questao_4_escolaridade WHERE cd_municipio_tse = $1
        ORDER BY ano_eleicao, ds_cargo, nr_nivel NULLS LAST`, [codigo]));
  return { education };
};

export const rotas: Rotas = {
// Q8 — financiamento: peso dos fundos públicos por cargo, faixa e partido.
// uf vazio = TODOS as UFs da amostra, agregado aqui; `cargo` opcional afina
// o corte (o frontend usa cargo=1 para trazer o Presidente nacional).
// P5 — eleitos com a ajuda dos votos do partido (vw_questao_5_legenda,
// sql/motherduck/11_views_legenda.sql). uf vazio agrega toda a amostra.
// P4 — escolaridade dos eleitos × população (vw_questao_4_escolaridade,
// sql/motherduck/07_views_escolaridade.sql). uf vazio agrega toda a amostra.
  "/api/escolaridade": async (url: URL) => {
    const uf = (url.searchParams.get("uf") || "").toUpperCase();
    const ano = Number(url.searchParams.get("ano") || 0);
    const cargo = (url.searchParams.get("cargo") || "TODOS").toUpperCase();
    if ((uf && !UFS.has(uf)) || (ano && !YEARS.has(ano)) || !["TODOS", "PREFEITO", "VEREADOR"].includes(cargo))
      return json({ error: "Filtro inválido." }, 400);
    if (!(await viewDisponivel("vw_questao_4_escolaridade")))
      return json({ error: "A view vw_questao_4_escolaridade ainda não foi aplicada no banco (sql/motherduck/10_censo_2022_escolaridade.sql, 06_municipio_ibge.sql e 07_views_escolaridade.sql)." }, 503);
    const [anos, niveis, municipios] = await comCache(`q4:${uf || "*"}:${ano}:${cargo}`, () => seguido([
      () => rows(`SELECT DISTINCT ano_eleicao, ano_censo FROM public.vw_questao_4_escolaridade
            ${uf ? "WHERE sg_uf = $1" : ""} ORDER BY 1`, uf ? [uf] : []),
      () => {
        const params: (string | number)[] = [cargo]; const cond = ["ds_cargo = $1"];
        if (ano){ params.push(ano); cond.push(`ano_eleicao = $${params.length}`); }
        if (uf){ params.push(uf); cond.push(`sg_uf = $${params.length}`); }
        return rows(`SELECT ano_eleicao, nr_nivel, ANY_VALUE(ds_nivel) AS ds_nivel,
                     SUM(qt_candidatos) AS candidatos, SUM(qt_eleitos) AS eleitos, SUM(qt_populacao) AS populacao
              FROM public.vw_questao_4_escolaridade WHERE ${cond.join(" AND ")}
              GROUP BY 1, 2 ORDER BY 1, 2 NULLS LAST`, params);
      },
      () => {
        // por município: superior completo entre eleitos e na população (ano escolhido)
        if (!ano) return Promise.resolve([]);
        const params: (string | number)[] = [cargo, ano]; const cond = ["ds_cargo = $1", "ano_eleicao = $2"];
        if (uf){ params.push(uf); cond.push(`sg_uf = $${params.length}`); }
        return rows(`SELECT cd_municipio_tse, ANY_VALUE(nm_municipio) AS nm_municipio, ANY_VALUE(sg_uf) AS uf,
                     SUM(qt_eleitos) FILTER (WHERE nr_nivel = 4) AS eleitos_sup,
                     SUM(qt_eleitos) FILTER (WHERE nr_nivel IS NOT NULL) AS eleitos_inf,
                     SUM(qt_populacao) FILTER (WHERE nr_nivel = 4) AS pop_sup,
                     SUM(qt_populacao) FILTER (WHERE nr_nivel IS NOT NULL) AS pop_inf
              FROM public.vw_questao_4_escolaridade WHERE ${cond.join(" AND ")}
              GROUP BY 1`, params);
      },
    ]));
    const n = (v: unknown) => v == null ? null : Number(v);
    return json({
      anos: anos.map((r: Record<string, unknown>) => Number(r.ano_eleicao)),
      anoCenso: n(anos[0]?.ano_censo),
      niveis: niveis.map((r: Record<string, unknown>) => ({ ano: Number(r.ano_eleicao), nivel: n(r.nr_nivel), nome: r.ds_nivel,
        candidatos: Number(r.candidatos), eleitos: Number(r.eleitos), populacao: n(r.populacao) })),
      municipios: municipios.map((r: Record<string, unknown>) => ({ tse: r.cd_municipio_tse, nome: r.nm_municipio, uf: r.uf,
        eleitosSup: Number(r.eleitos_sup || 0), eleitosInf: Number(r.eleitos_inf || 0),
        popSup: n(r.pop_sup), popInf: n(r.pop_inf) })),
    });
  },
};
