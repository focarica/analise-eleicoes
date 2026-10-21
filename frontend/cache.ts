import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

// O arquivo de revisão é atualizado após uma carga/reconciliação bem-sucedida.
// Ler a revisão em cada acesso também invalida processos já em execução.
export function createDataCache(directory: string, version = 'identidades-brutas-v1', options: {persist?: boolean; maxEntries?: number} = {}) {
  const memory = new Map<string, Promise<unknown>>();
  let previousRevision = '';
  return function cached<T>(key: string, calculate: () => Promise<T>): Promise<T> {
    let revision = version;
    try { revision += ':' + readFileSync(`${directory}/revision`, 'utf8').trim(); } catch {}
    if (revision !== previousRevision) {
      memory.clear();
      previousRevision = revision;
    }
    const cacheKey = createHash('sha256').update(`${revision}:${key}`).digest('hex');
    const existing = memory.get(cacheKey);
    if (existing) return existing as Promise<T>;
    const result = (async () => {
      const file = `${directory}/${cacheKey}.json`;
      if (options.persist !== false) {
        try {
          const saved = JSON.parse(readFileSync(file, 'utf8'));
          if (saved?.t && Date.now() - saved.t < 86_400_000 && saved.d !== undefined) return saved.d as T;
        } catch {}
      }
      const data = await calculate();
      if (options.persist !== false) {
        try {
          mkdirSync(directory, { recursive: true });
          writeFileSync(file, JSON.stringify({ t: Date.now(), d: data }));
        } catch {}
      }
      return data;
    })();
    result.catch(() => memory.delete(cacheKey));
    memory.set(cacheKey, result);
    if (memory.size > (options.maxEntries ?? Infinity)) memory.delete(memory.keys().next().value!);
    return result;
  };
}
