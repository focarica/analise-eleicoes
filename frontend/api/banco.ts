// Acesso ao MotherDuck compartilhado pelo servidor e pelas rotas das questões:
// pool de conexões, consulta com tempo limite, cache em memória e disco,
// checagem de views e respostas JSON. Mudanças aqui afetam todas as questões.
import { DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import { createDataCache } from '../cache';

// Banco de referência compartilhado: contém eleições de 2004 a 2024.
export const DATABASE = "BDR-TSE";
export const UFS = new Set(["AC", "AL", "BA", "DF", "RO", "SP"]);
export const YEARS = new Set([2004, 2006, 2008, 2010, 2012, 2014, 2016, 2018, 2020, 2022, 2024]);
export const CARGOS: Record<number, string> = { 1: "Presidente", 3: "Governador", 5: "Senador", 6: "Deputado federal", 7: "Deputado estadual", 8: "Deputado distrital", 11: "Prefeito", 13: "Vereador" };
export const UFS_LIST = ["AC", "AL", "BA", "DF", "RO", "SP"];
// Várias conexões da mesma instância: as consultas rodam em paralelo no
// MotherDuck em vez de esperarem numa fila única (a busca dispara uma requisição
// por pausa na digitação e travava o resto do painel).
export const POOL_SIZE = Math.max(1, Number(Bun.env.DB_CONNECTIONS || 4));
// Consulta mais lenta que isso é interrompida e vira erro 504 (em vez de a
// conexão HTTP ser derrubada sem resposta).
export const QUERY_TIMEOUT_MS = Number(Bun.env.QUERY_TIMEOUT_MS || 60_000);
export let instancePromise: Promise<DuckDBInstance> | undefined;
export const livres: DuckDBConnection[] = [];
export const aguardando: ((con: DuckDBConnection) => void)[] = [];
export let criadas = 0;

export function instance() {
  instancePromise ??= (async () => {
    const token = Bun.env.MOTHERDUCK_TOKEN || Bun.env.motherduck_token;
    if (!token) throw new Error("Configure MOTHERDUCK_TOKEN no arquivo .env local.");
    // o token vai na connection string: o node-api não lê variáveis de ambiente
    // do DuckDB de forma confiável e sem vínculo explícito pode cair no SSO do
    // navegador (conta errada) em vez de usar o token do painel.
    return DuckDBInstance.create(
      `md:${DATABASE}?token=${encodeURIComponent(token)}&motherduck_open_browser=false`,
    );
  })().catch((error) => { instancePromise = undefined; throw error; });
  return instancePromise;
}

export async function acquire(): Promise<DuckDBConnection> {
  const livre = livres.pop();
  if (livre) return livre;
  if (criadas < POOL_SIZE) {
    criadas++;
    try {
      return await (await instance()).connect();
    } catch (error) {
      criadas--;
      throw error;
    }
  }
  return new Promise((resolve) => aguardando.push(resolve));
}

export function release(con: DuckDBConnection) {
  const proximo = aguardando.shift();
  if (proximo) proximo(con);
  else livres.push(con);
}

export async function rows(sql: string, values: (string | number)[] = []) {
  const con = await acquire();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let estourou = false;
  try {
    timer = setTimeout(() => { estourou = true; con.interrupt(); }, QUERY_TIMEOUT_MS);
    const reader = await con.runAndReadAll(sql, values);
    return reader.getRowObjectsJson() as Record<string, unknown>[];
  } catch (error) {
    if (estourou) throw new ConsultaLenta();
    throw error;
  } finally {
    clearTimeout(timer);
    release(con);
  }
}

export class ConsultaLenta extends Error {
  constructor() { super("A consulta ao MotherDuck demorou demais. Tente de novo."); }
}

// cache de memória + disco: os dados são estáticos (a carga fecha e as views só
// mudam por atualização), então cada consulta caríssima precisa rodar uma vez
// no máximo — recorrer ao banco de novo só queima o limite diário do plano
// MotherDuck; o arquivo em disco também sobrevive aos reinícios do --hot em
// desenvolvimento, que recriam o processo a cada edição.
export const CACHE_DIR = Bun.env.CACHE_DIR || (import.meta.dir + "/../.cache-api");
export const comCache = createDataCache(CACHE_DIR, Bun.env.CACHE_VERSION);
export const buscaCacheVersionado = createDataCache(CACHE_DIR, Bun.env.CACHE_VERSION, {persist:false,maxEntries:500});

// rota pesada: em vez de N consultas simultâneas sobre a mesma conexão (pico de
// computação no MotherDuck e concorrência instável), rodar uma depois da outra
export const seguido = async (consultas: (() => Promise<any>)[]) => {
  const out: any[] = [];
  for (const f of consultas) out.push(await f());
  return out;
};

// Views opcionais: a rota explica o que falta aplicar em vez de devolver o erro do banco.
export const viewsVistas = new Map<string, Promise<boolean>>();
export function viewDisponivel(nome: string) {
  if (!viewsVistas.has(nome)) {
    viewsVistas.set(nome, rows(
      `SELECT 1 AS existe FROM information_schema.tables
       WHERE table_catalog = current_database() AND table_schema = 'public' AND table_name = $1`, [nome],
    ).then((r) => r.length > 0).catch((error) => { viewsVistas.delete(nome); throw error; }));
  }
  return viewsVistas.get(nome)!.then((existe) => { if (!existe) viewsVistas.delete(nome); return existe; });
}

export const json = (data: unknown, status = 200) => Response.json(data, { status });
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Erro ao consultar MotherDuck.";
