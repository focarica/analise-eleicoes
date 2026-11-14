// Questão 7: viés político dos partidos (Bolognesi et al., Harvard Dataverse).
// Lê o snapshot local frontend/.p7-vies.duckdb (gerado por scripts/p7-local.ts)
// e não consulta o MotherDuck. Edite só este arquivo para mudar a API da P7.
import { DuckDBInstance } from "@duckdb/node-api";
import { resolve } from "node:path";
import { json, UFS } from "../banco";
import type { ExtensaoCandidato, ExtensaoMunicipio, Rotas } from "./tipos";

const CAMINHO = Bun.env.P7_DB || resolve(import.meta.dir, "../../.p7-vies.duckdb");

type Vies = {
  ano_eleicao: number;
  nr_partido: number;
  sg_partido: string;
  media: number | null;
  vies: number | null;
  onda: number;
};
type Onda = { ano_eleicao: number; onda: number; onda_estendida: boolean; observacao: string | null };
type ViesMunicipio = {
  ano_eleicao: number;
  vies: number | null;
  cobertura: number | null;
  n_cargos: number;
  onda: number;
  onda_estendida: boolean;
};
type SerieMunicipio = { cd: string; nome: string; serie: ViesMunicipio[] };

let leitura: Promise<{ partidos: Vies[]; ondas: Onda[] }> | undefined;
function dados() {
  leitura ??= (async () => {
    const db = await DuckDBInstance.create(CAMINHO, { access_mode: "READ_ONLY" });
    const con = await db.connect();
    try {
      const partidos = (await con.runAndReadAll(
        `SELECT ano_eleicao, nr_partido, sg_partido, media, vies, onda
         FROM public.vies_partido_onda ORDER BY ano_eleicao, nr_partido`,
      )).getRowObjectsJson() as unknown as Vies[];
      const ondas = (await con.runAndReadAll(
        `SELECT ano_eleicao, onda, onda_estendida, observacao
         FROM public.vies_onda_eleicao ORDER BY ano_eleicao`,
      )).getRowObjectsJson() as unknown as Onda[];
      return { partidos, ondas };
    } finally {
      con.closeSync();
      db.closeSync();
    }
  })().catch((error) => { leitura = undefined; throw error; });
  return leitura;
}

// Espectro de cada eleição da pessoa: partidos medidos ordenados da esquerda
// para a direita, com os extremos que viram as pontas da régua na ficha.
export const candidato: ExtensaoCandidato = async (_id, candidaturas) => {
  try {
    const { partidos, ondas } = await dados();
    const anos = new Set(candidaturas.map((c) => Number(c.ano_eleicao)));
    const eleicoes = ondas
      .filter((o) => anos.has(Number(o.ano_eleicao)))
      .map((o) => {
        const lista = partidos
          .filter((p) => Number(p.ano_eleicao) === Number(o.ano_eleicao) && p.media != null && p.vies != null)
          .map((p) => ({ nr_partido: Number(p.nr_partido), sg_partido: p.sg_partido, vies: Number(p.vies) }))
          .sort((a, b) => a.vies - b.vies);
        return {
          ano_eleicao: Number(o.ano_eleicao),
          onda: Number(o.onda),
          onda_estendida: Boolean(o.onda_estendida),
          esquerda: lista[0],
          direita: lista[lista.length - 1],
          partidos: lista,
        };
      })
      .filter((e) => e.partidos.length);
    return { viesEleicoes: eleicoes };
  } catch {
    // O snapshot é opcional: sem ele a ficha continua abrindo, só sem a régua.
    return { viesEleicoes: [] };
  }
};

// Viés do município por eleição: lido do mesmo snapshot local, tabela
// vies_municipio (gerada a partir da view vw_questao_7_vies).
const cacheMunicipio = new Map<string, Promise<ViesMunicipio[]>>();
function lerMunicipio(codigo: string) {
  let consulta = cacheMunicipio.get(codigo);
  if (!consulta) {
    consulta = (async () => {
      const db = await DuckDBInstance.create(CAMINHO, { access_mode: "READ_ONLY" });
      const con = await db.connect();
      try {
        const linhas = (await con.runAndReadAll(
          `SELECT ano_eleicao, vies, cobertura, n_cargos, onda, onda_estendida
           FROM public.vies_municipio WHERE cd_municipio_tse = $1 ORDER BY ano_eleicao`,
          [codigo],
        )).getRowObjectsJson() as unknown as ViesMunicipio[];
        return linhas.map((r) => ({
          ano_eleicao: Number(r.ano_eleicao),
          vies: r.vies == null ? null : Number(r.vies),
          cobertura: r.cobertura == null ? null : Number(r.cobertura),
          n_cargos: Number(r.n_cargos),
          onda: Number(r.onda),
          onda_estendida: Boolean(r.onda_estendida),
        }));
      } finally {
        con.closeSync();
        db.closeSync();
      }
    })().catch((error) => { cacheMunicipio.delete(codigo); throw error; });
    cacheMunicipio.set(codigo, consulta);
  }
  return consulta;
}

export const municipio: ExtensaoMunicipio = async (codigo) => {
  try {
    return { viesMunicipio: await lerMunicipio(codigo) };
  } catch {
    // Snapshot ausente: a gaveta do município continua abrindo sem a seção.
    return { viesMunicipio: [] };
  }
};

// Lista de municípios do snapshot, opcionalmente por UF, para o seletor do card.
const cacheLista = new Map<string, Promise<{ cd: string; nome: string; uf: string }[]>>();
function listarMunicipios(uf: string) {
  let consulta = cacheLista.get(uf);
  if (!consulta) {
    consulta = (async () => {
      const db = await DuckDBInstance.create(CAMINHO, { access_mode: "READ_ONLY" });
      const con = await db.connect();
      try {
        const filtro = uf ? "WHERE sg_uf = $1" : "";
        const params = uf ? [uf] : [];
        return (await con.runAndReadAll(
          `SELECT DISTINCT cd_municipio_tse AS cd, nm_municipio AS nome, sg_uf AS uf
           FROM public.vies_municipio ${filtro}
           ORDER BY uf, nome`,
          params,
        )).getRowObjectsJson() as unknown as { cd: string; nome: string; uf: string }[];
      } finally {
        con.closeSync();
        db.closeSync();
      }
    })().catch((error) => { cacheLista.delete(uf); throw error; });
    cacheLista.set(uf, consulta);
  }
  return consulta;
}

// Série de todos os municípios de uma UF para o mapa temporal da P7.
const cacheEstado = new Map<string, Promise<{ uf: string; anos: number[]; municipios: SerieMunicipio[] }>>();
function lerEstado(uf: string) {
  let consulta = cacheEstado.get(uf);
  if (!consulta) {
    consulta = (async () => {
      const db = await DuckDBInstance.create(CAMINHO, { access_mode: "READ_ONLY" });
      const con = await db.connect();
      try {
        const linhas = (await con.runAndReadAll(
          `SELECT cd_municipio_tse AS cd, nm_municipio AS nome, ano_eleicao, vies,
                  cobertura, n_cargos, onda, onda_estendida
           FROM public.vies_municipio WHERE sg_uf = $1
           ORDER BY nm_municipio, ano_eleicao`,
          [uf],
        )).getRowObjectsJson() as unknown as (ViesMunicipio & { cd: string; nome: string })[];
        const municipios = new Map<string, SerieMunicipio>();
        for (const r of linhas) {
          const cd = String(r.cd).padStart(5, "0");
          let municipio = municipios.get(cd);
          if (!municipio) {
            municipio = { cd, nome: r.nome, serie: [] };
            municipios.set(cd, municipio);
          }
          municipio.serie.push({
            ano_eleicao: Number(r.ano_eleicao),
            vies: r.vies == null ? null : Number(r.vies),
            cobertura: r.cobertura == null ? null : Number(r.cobertura),
            n_cargos: Number(r.n_cargos),
            onda: Number(r.onda),
            onda_estendida: Boolean(r.onda_estendida),
          });
        }
        const resultado = [...municipios.values()];
        return { uf, anos: [...new Set(resultado.flatMap((m) => m.serie.map((r) => r.ano_eleicao)))].sort(), municipios: resultado };
      } finally {
        con.closeSync();
        db.closeSync();
      }
    })().catch((error) => { cacheEstado.delete(uf); throw error; });
    cacheEstado.set(uf, consulta);
  }
  return consulta;
}

// Um município: nome, UF e a série de viés, para a linha do card.
async function municipioCompleto(codigo: string) {
  const vies = await lerMunicipio(codigo);
  if (!vies.length) return null;
  const lista = await listarMunicipios("");
  const achado = lista.find((m) => String(m.cd) === String(codigo));
  return { cd: codigo, nome: achado?.nome || codigo, uf: achado?.uf || "", vies };
}

export const rotas: Rotas = {
  "/api/q7-vies": async () => {
    try {
      return json(await dados());
    } catch {
      return json({
        error: "Snapshot local da P7 não encontrado. Rode `bun run p7-local` em frontend/.",
      }, 503);
    }
  },
  "/api/q7-vies/municipios": async (url) => {
    const uf = (url.searchParams.get("uf") || "").toUpperCase();
    if (uf && !/^[A-Z]{2}$/.test(uf)) return json({ error: "UF inválida." }, 400);
    try {
      return json(await listarMunicipios(uf));
    } catch {
      return json({
        error: "Snapshot local da P7 não encontrado. Rode `bun run p7-local` em frontend/.",
      }, 503);
    }
  },
  "/api/q7-vies/estado": async (url) => {
    const uf = (url.searchParams.get("uf") || "").toUpperCase();
    if (!UFS.has(uf)) return json({ error: "UF fora da amostra." }, 400);
    try {
      return json(await lerEstado(uf));
    } catch {
      return json({
        error: "Snapshot local da P7 não encontrado. Rode `bun run p7-local` em frontend/.",
      }, 503);
    }
  },
  "/api/q7-vies/municipio": async (url) => {
    const cd = (url.searchParams.get("cd") || "").trim();
    if (!/^[0-9]+$/.test(cd)) return json({ error: "Município inválido." }, 400);
    try {
      const m = await municipioCompleto(cd);
      return m ? json(m) : json({ error: "Município não encontrado." }, 404);
    } catch {
      return json({
        error: "Snapshot local da P7 não encontrado. Rode `bun run p7-local` em frontend/.",
      }, 503);
    }
  },
};
