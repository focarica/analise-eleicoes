// Rotas da questão: p10-reeleicao. Edite só este arquivo para mudar a API desta questão.
import { CARGOS, UFS, UFS_LIST, comCache, json, rows, seguido } from "../banco";
import type { Rotas } from "./tipos";

export const rotas: Rotas = {
// P10a — reeleição: fichas por cargo com os ciclos de eleição seguinte.
// uf vazio = TODOS as UFs da amostra, somado aqui; `estados` traz sempre os
// ciclos estaduais de cada UF (para o mapa-calor estado a estado) e `media`
// a média dos municípios por cargo municipal (11 e 13).
  "/api/reeleicao": async (url: URL) => {
    const uf = (url.searchParams.get("uf") || "").toUpperCase();
    if (uf && !UFS.has(uf)) return json({ error: "UF fora da amostra." }, 400);
    const [estados, municipais] = await comCache("reel", () => seguido([
      () => rows(`SELECT cd_cargo, uf, ano_eleito, ano_disputa, eleitos, tentaram,
                   reeleitos, taxa, ha_proxima
            FROM public.v_reeleicao_linhas
            WHERE cd_municipio_tse IS NULL
            ORDER BY cd_cargo, ano_eleito`),
      () => rows(`SELECT cd_cargo, uf, ano_eleito, ano_disputa,
                   SUM(eleitos) AS eleitos, SUM(tentaram) AS tentaram, SUM(reeleitos) AS reeleitos,
                   COUNT(*) AS municipios,
                   SUM(CASE WHEN tentaram > 0 THEN 1 ELSE 0 END) AS municipios_tentaram,
                   ROUND(AVG(CASE WHEN tentaram > 0 THEN taxa END), 1) AS taxa_municipios,
                   MAX(ha_proxima) AS ha_proxima
            FROM public.v_reeleicao_linhas
            WHERE cd_municipio_tse IS NOT NULL
            GROUP BY 1, 2, 3, 4`),
    ]));
    const fechar = (r: any) => ({
      cdCargo: Number(r.cd_cargo),
      uf: r.uf ?? r.uf_state ?? null,
      anoEleito: Number(r.ano_eleito),
      anoDisputa: Number(r.ano_disputa),
      eleitos: Number(r.eleitos),
      tentaram: Number(r.tentaram),
      reeleitos: Number(r.reeleitos),
      taxa: r.taxa == null ? null : Number(r.taxa),
      haProxima: r.ha_proxima === true,
    });
    const porCargo = (linhas: any) => {
      const porAno = new Map();
      for (const r of linhas) {
        const chave = `${r.anoEleito}|${r.anoDisputa}`;
        if (!porAno.has(chave)) porAno.set(chave, { ...r, eleitos: 0, tentaram: 0, reeleitos: 0 });
        const c = porAno.get(chave);
        c.eleitos += r.eleitos;
        c.tentaram += r.tentaram;
        c.reeleitos += r.reeleitos;
        c.haProxima = c.haProxima || r.haProxima;
        c.taxa = c.tentaram > 0 ? Math.round(c.reeleitos * 1000 / c.tentaram) / 10 : null;
      }
      return [...porAno.values()].sort((a, b) => a.anoEleito - b.anoEleito);
    };
    const municipaisFechados = municipais.map((r: any) => ({
      ...fechar(r),
      taxa: Number(r.tentaram) > 0 ? Math.round(Number(r.reeleitos) * 1000 / Number(r.tentaram)) / 10 : null,
      municipios: Number(r.municipios),
      municipiosComTentativa: Number(r.municipios_tentaram),
      taxaMunicipios: r.taxa_municipios == null ? null : Number(r.taxa_municipios),
    }));
    const cargos = [3, 5, 6, 7, 8, 11, 13].map((cd) => {
      const estado = estados.filter((r: any) => (!uf || r.uf === uf) && Number(r.cd_cargo) === cd).map(fechar);
      // prefeito e vereador só têm grão municipal: os ciclos saem da soma dos municípios
      const municipaisCargo = municipaisFechados.filter((r: any) => r.cdCargo === cd && (!uf || r.uf === uf));
      const fonte = estado.length > 0 ? estado : municipaisCargo;
      return {
        cdCargo: cd,
        cargo: CARGOS[cd],
        ciclos: fonte.map((r: any) => ({ ...r, municipios: r.municipios ?? null, municipiosComTentativa: r.municipiosComTentativa ?? null, taxaMunicipios: r.taxaMunicipios ?? null })).sort((a: any, b: any) => a.anoEleito - b.anoEleito),
        media: municipaisCargo.sort((a: any, b: any) => a.anoEleito - b.anoEleito),
      };
    });
    const gradas = [3, 5, 6, 7, 8].map((cd) => ({
      cdCargo: cd,
      cargo: CARGOS[cd],
      porUf: UFS_LIST.map((u) => ({
        uf: u,
        ciclos: porCargo(estados.filter((r: any) => r.uf === u && Number(r.cd_cargo) === cd).map(fechar)),
      })),
    }));
    return json({ uf, cargos, estados: gradas });
  },
  "/api/reeleicao/pessoas": async (url: URL) => {
    const uf = (url.searchParams.get("uf") || "").toUpperCase();
    const cargo = Number(url.searchParams.get("cargo"));
    const eleitosEm = Number(url.searchParams.get("eleitos_em"));
    const grupo = url.searchParams.get("grupo") || "";
    const q = (url.searchParams.get("q") || "").trim();
    const limite = Math.min(Number(url.searchParams.get("limite")) || 60, 200);
    const desde = Number(url.searchParams.get("desde")) || 0;
    if (!UFS.has(uf) || !CARGOS[cargo]) return json({ error: "UF ou cargo inválido." }, 400);
    if (!["voltou", "perderam", "nao"].includes(grupo)) return json({ error: "Grupo inválido." }, 400);
    const pattern = `%${q}%`;
    const pessoas = await comCache(`reelp:${uf}:${cargo}:${eleitosEm}:${grupo}:${q.toLowerCase()}:${limite}:${desde}`, () => rows(
      `SELECT id_pessoa_projeto, sq_candidato, ano_foto, nm_urna_candidato,
              sg_partido, nm_municipio, votos, grupo
       FROM public.v_reeleicao_pessoas
       WHERE uf = $1 AND cd_cargo = $2 AND ano_eleito = $3 AND grupo = $4
         AND (nm_urna_candidato ILIKE $5 OR COALESCE(nm_municipio, '') ILIKE $5)
       ORDER BY nm_urna_candidato
       LIMIT $6 OFFSET $7`,
      [uf, cargo, eleitosEm, grupo, pattern, limite + 1, desde],
    ));
    const temMais = pessoas.length > limite;
    if (temMais) pessoas.pop();
    return json({ uf, cargo, eleitosEm, grupo, pessoas, temMais });
  },
};
