// Câmaras: composição de cada casa legislativa, uma cadeira por eleito, com o
// partido e o viés político do partido na eleição (snapshot local da P7).
// Edite só este arquivo para mudar a API das câmaras.
//
//   GET /api/camaras?casa=senado|federal|estadual|vereadores&ano=AAAA[&uf=XX][&municipio=CD]
//   GET /api/camaras/municipios?uf=XX
//
// - federal/estadual/senado: por UF, ou a amostra inteira quando `uf` vem vazio.
//   No DF, "estadual" é a Câmara Legislativa (deputado distrital, cargo 8).
// - senado: a bancada do ano é a eleita naquele ano mais a eleita quatro anos
//   antes (mandato de 8 anos). Cadeiras cuja eleição não está na base entram em
//   `fora_da_base`, para o desenho mostrar o assento vazio sem inventar ninguém.
// - vereadores: exige `municipio` (código TSE); a câmara municipal é o recorte.
// - viés: nota do partido na onda que cobre o ano mostrado (2018–2024). Fora
//   disso, `vies` é null e `onda` também.
import { DuckDBInstance } from "@duckdb/node-api";
import { resolve } from "node:path";
import { UFS, UFS_LIST, comCache, errorMessage, json, rows } from "../banco";
import type { Rotas } from "./tipos";

const SNAPSHOT = Bun.env.P7_DB || resolve(import.meta.dir, "../../.p7-vies.duckdb");
const ELEITO = `('ELEITO', 'ELEITO POR QP', 'ELEITO POR MÉDIA', 'MÉDIA')`;
const GERAIS = [2014, 2018, 2022, 2026];
const MUNICIPAIS = [2004, 2008, 2012, 2016, 2020, 2024];
// Cadeiras por UF (fonte: tamanho legal das casas; conferido contra os eleitos da base).
const SENADO_POR_UF = 3;
const CASAS = {
  senado: { nome: "Senado Federal", anos: GERAIS },
  federal: { nome: "Câmara dos Deputados", anos: GERAIS },
  estadual: { nome: "Assembleia Legislativa", anos: GERAIS },
  vereadores: { nome: "Câmara Municipal", anos: MUNICIPAIS },
} as const;
type Casa = keyof typeof CASAS;

type Onda = { ano_eleicao: number; onda: number; onda_estendida: boolean };
type ViesPartido = { ano_eleicao: number; nr_partido: number; sg_partido: string; vies: number | null };

let leituraVies: Promise<{ partidos: ViesPartido[]; ondas: Onda[] }> | undefined;
function viesSnapshot() {
  leituraVies ??= (async () => {
    const db = await DuckDBInstance.create(SNAPSHOT, { access_mode: "READ_ONLY" });
    const con = await db.connect();
    try {
      const partidos = (await con.runAndReadAll(
        `SELECT ano_eleicao, nr_partido, sg_partido, vies FROM public.vies_partido_onda`,
      )).getRowObjectsJson() as unknown as ViesPartido[];
      const ondas = (await con.runAndReadAll(
        `SELECT ano_eleicao, onda, onda_estendida FROM public.vies_onda_eleicao`,
      )).getRowObjectsJson() as unknown as Onda[];
      return {
        partidos: partidos.map((p) => ({ ...p, ano_eleicao: Number(p.ano_eleicao), nr_partido: Number(p.nr_partido), vies: p.vies == null ? null : Number(p.vies) })),
        ondas: ondas.map((o) => ({ ano_eleicao: Number(o.ano_eleicao), onda: Number(o.onda), onda_estendida: Boolean(o.onda_estendida) })),
      };
    } finally {
      con.closeSync();
      db.closeSync();
    }
  })().catch(() => { leituraVies = undefined; return { partidos: [], ondas: [] }; });
  return leituraVies;
}

type Linha = {
  sq_candidato: string; id: number | null; ano_eleicao: number; nome: string; sg_partido: string;
  nr_partido: number; uf: string; votos: number | null; situacao: string;
};

function eleitosGerais(cargos: number[], anos: number[], uf: string) {
  const filtroUf = uf ? `AND left(c.sg_ue, 2) = $1` : "";
  return rows(
    `SELECT CAST(c.sq_candidato AS VARCHAR) AS sq_candidato, c.id_pessoa_projeto AS id, c.ano_eleicao,
            coalesce(c.nm_urna_candidato, '') AS nome, c.sg_partido, c.nr_partido,
            left(c.sg_ue, 2) AS uf, c.qt_votos_totais AS votos, c.ds_sit_tot_turno AS situacao
     FROM public.candidatura c
     WHERE c.cd_cargo IN (${cargos.join(",")}) AND c.ano_eleicao IN (${anos.join(",")})
       AND c.ds_sit_tot_turno IN ${ELEITO} ${filtroUf}
     ORDER BY c.ano_eleicao, uf, c.qt_votos_totais DESC NULLS LAST`,
    uf ? [uf] : [],
  ) as unknown as Promise<Linha[]>;
}

function eleitosMunicipio(cd: string, ano: number) {
  return rows(
    `SELECT CAST(c.sq_candidato AS VARCHAR) AS sq_candidato, c.id_pessoa_projeto AS id, c.ano_eleicao,
            coalesce(c.nm_urna_candidato, '') AS nome, c.sg_partido, c.nr_partido,
            m.sg_uf AS uf, c.qt_votos_totais AS votos, c.ds_sit_tot_turno AS situacao
     FROM public.candidatura c
     LEFT JOIN public.municipio m ON m.cd_municipio_tse = c.cd_municipio_tse
     WHERE c.cd_cargo = 13 AND c.ano_eleicao = $1 AND c.cd_municipio_tse = $2
       AND c.ds_sit_tot_turno IN ${ELEITO}
     ORDER BY c.qt_votos_totais DESC NULLS LAST`,
    [ano, cd],
  ) as unknown as Promise<Linha[]>;
}

async function montar(casa: Casa, ano: number, uf: string, municipio: string) {
  const { partidos, ondas } = await viesSnapshot();
  const onda = ondas.find((o) => o.ano_eleicao === ano) || null;
  const notaNoAno = (a: number, nr: number, sg: string) => {
    const notas = partidos.filter((p) => p.ano_eleicao === a);
    const p = notas.find((n) => n.nr_partido === Number(nr) && n.sg_partido === sg)
      || notas.find((n) => n.nr_partido === Number(nr))
      || notas.find((n) => n.sg_partido === sg);
    return p?.vies ?? null;
  };
  // Nota da onda do ano mostrado; se o partido não existe mais nela (ex.: DEM e
  // PSL, fundidos no UNIÃO), vale a nota do ano em que a cadeira foi eleita.
  const viesDe = (nr: number, sg: string, origem: number) =>
    notaNoAno(ano, nr, sg) ?? (origem !== ano ? notaNoAno(origem, nr, sg) : null);

  let linhas: Linha[] = [];
  let fora = 0;
  let local: { cd: string; nome: string; uf: string } | null = null;
  if (casa === "vereadores") {
    linhas = await eleitosMunicipio(municipio, ano);
    const m = await rows(`SELECT cd_municipio_tse AS cd, nm_municipio AS nome, sg_uf AS uf FROM public.municipio WHERE cd_municipio_tse = $1`, [municipio]);
    local = (m[0] as unknown as typeof local) || { cd: municipio, nome: municipio, uf: "" };
  } else if (casa === "senado") {
    const anterior = ano - 4;
    const anos = GERAIS.includes(anterior) ? [ano, anterior] : [ano];
    linhas = await eleitosGerais([5], anos, uf);
    // A base só tem senadores a partir de 2018: o que faltar até 3 por UF fica vazio.
    const ufs = uf ? [uf] : UFS_LIST;
    for (const u of ufs) fora += Math.max(0, SENADO_POR_UF - linhas.filter((l) => l.uf === u).length);
  } else {
    // No DF a casa "estadual" é a Câmara Legislativa (cargo 8).
    linhas = await eleitosGerais(casa === "federal" ? [6] : [7, 8], [ano], uf);
  }

  const cadeiras = linhas.map((l) => ({
    sq: String(l.sq_candidato),
    id: l.id == null ? null : Number(l.id), // id_pessoa_projeto: abre a ficha (abrirCandidato)
    ano_eleicao: Number(l.ano_eleicao),
    nome: l.nome,
    partido: l.sg_partido,
    nr_partido: Number(l.nr_partido),
    uf: l.uf,
    votos: l.votos == null ? null : Number(l.votos),
    situacao: l.situacao,
    vies: viesDe(Number(l.nr_partido), l.sg_partido, Number(l.ano_eleicao)),
  }));

  return {
    casa,
    nome_casa: casa === "estadual" && uf === "DF" ? "Câmara Legislativa do DF" : CASAS[casa].nome,
    ano,
    uf: uf || null,
    municipio: local,
    onda: onda ? { onda: onda.onda, estendida: onda.onda_estendida } : null,
    total_cadeiras: cadeiras.length + fora,
    fora_da_base: fora,
    anos_disponiveis: CASAS[casa].anos,
    cadeiras,
  };
}

export const rotas: Rotas = {
  "/api/camaras": async (url) => {
    const casa = (url.searchParams.get("casa") || "") as Casa;
    const ano = Number(url.searchParams.get("ano"));
    const uf = (url.searchParams.get("uf") || "").toUpperCase();
    const municipio = (url.searchParams.get("municipio") || "").trim();
    if (!(casa in CASAS)) return json({ error: "Casa inválida." }, 400);
    if (!(CASAS[casa].anos as readonly number[]).includes(ano)) return json({ error: "Ano sem eleição para esta casa." }, 400);
    if (uf && !UFS.has(uf)) return json({ error: "UF fora da amostra." }, 400);
    if (casa === "vereadores" && !/^[0-9]{1,6}$/.test(municipio)) return json({ error: "Escolha um município." }, 400);
    if (casa === "vereadores" && uf === "DF") return json({ error: "O DF não tem câmara municipal." }, 400);
    try {
      const chave = `camaras-v3:${casa}:${ano}:${uf}:${municipio}`;
      return json(await comCache(chave, () => montar(casa, ano, uf, municipio)));
    } catch (error) {
      return json({ error: errorMessage(error) }, 500);
    }
  },
  "/api/camaras/municipios": async (url) => {
    const uf = (url.searchParams.get("uf") || "").toUpperCase();
    if (!UFS.has(uf) || uf === "DF") return json({ error: "UF inválida para câmara municipal." }, 400);
    try {
      return json(await comCache(`camaras-municipios-v1:${uf}`, () => rows(
        `SELECT cd_municipio_tse AS cd, nm_municipio AS nome FROM public.municipio
         WHERE sg_uf = $1 ORDER BY nm_municipio`, [uf],
      )));
    } catch (error) {
      return json({ error: errorMessage(error) }, 500);
    }
  },
};
