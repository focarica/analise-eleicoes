// Rotas da questão: p5-legenda. Edite só este arquivo para mudar a API desta questão.
import { UFS, YEARS, comCache, json, rows, seguido, viewDisponivel } from "../banco";
import type { Rotas } from "./tipos";

export const rotas: Rotas = {
  "/api/legenda": async (url: URL) => {
    const uf = (url.searchParams.get("uf") || "").toUpperCase();
    if (uf && !UFS.has(uf)) return json({ error: "UF fora da amostra." }, 400);
    if (!(await viewDisponivel("vw_questao_5_legenda")))
      return json({ error: "A view vw_questao_5_legenda ainda não foi aplicada no banco (sql/motherduck/11_views_legenda.sql)." }, 503);
    const [condicao, params] = uf ? ["WHERE uf = $1", [uf]] : ["", []];
    const [resumo, partidos] = await comCache(`legenda:${uf || "*"}`, () => seguido([
      () => rows(`SELECT cd_cargo, ano_eleicao, COUNT(*) AS eleitos,
                   COUNT(*) FILTER (WHERE eleito_abaixo_qe) AS abaixo_qe,
                   COUNT(*) FILTER (WHERE eleito_abaixo_legenda) AS abaixo_legenda
            FROM public.vw_questao_5_legenda ${condicao}
            GROUP BY 1, 2 ORDER BY 1, 2`, params),
      () => rows(`SELECT cd_cargo, ano_eleicao, sg_partido, COUNT(*) AS eleitos,
                   COUNT(*) FILTER (WHERE eleito_abaixo_qe) AS abaixo_qe,
                   COUNT(*) FILTER (WHERE eleito_abaixo_legenda) AS abaixo_legenda
            FROM public.vw_questao_5_legenda ${condicao}
            GROUP BY 1, 2, 3`, params),
    ]));
    const num = (r: Record<string, unknown>) => ({
      cdCargo: Number(r.cd_cargo), ano: Number(r.ano_eleicao), eleitos: Number(r.eleitos),
      abaixoQe: Number(r.abaixo_qe), abaixoLegenda: Number(r.abaixo_legenda),
    });
    return json({
      uf: uf || null,
      resumo: resumo.map((r: Record<string, unknown>) => num(r)),
      partidos: partidos.map((r: Record<string, unknown>) => ({ ...num(r), partido: r.sg_partido })),
    });
  },
  "/api/legenda/pessoas": async (url: URL) => {
    const uf = (url.searchParams.get("uf") || "").toUpperCase();
    const cargo = Number(url.searchParams.get("cargo"));
    const ano = Number(url.searchParams.get("ano"));
    const partido = (url.searchParams.get("partido") || "").toUpperCase();
    if ((uf && !UFS.has(uf)) || ![6, 7, 8, 13].includes(cargo) || !YEARS.has(ano))
      return json({ error: "Filtro inválido." }, 400);
    const condicoes = ["l.cd_cargo = $1", "l.ano_eleicao = $2", "l.eleito_abaixo_qe"];
    const params: (string | number)[] = [cargo, ano];
    if (uf){ params.push(uf); condicoes.push(`l.uf = $${params.length}`); }
    if (partido){ params.push(partido); condicoes.push(`l.sg_partido = $${params.length}`); }
    const pessoas = await rows(`SELECT l.id_pessoa_projeto, l.nm_urna_candidato, l.sg_partido, l.uf,
                 m.nm_municipio, l.votos_nominais, l.quociente_eleitoral, l.pct_do_quociente,
                 l.votos_legenda_partido, l.eleito_abaixo_legenda
          FROM public.vw_questao_5_legenda l
          LEFT JOIN public.municipio m ON m.cd_municipio_tse = l.cd_municipio_tse
          WHERE ${condicoes.join(" AND ")}
          ORDER BY l.pct_do_quociente, l.votos_nominais LIMIT 40`, params);
    return json({ pessoas });
  },
};
