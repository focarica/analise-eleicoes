// Exporta snapshots ou aplica um plano produzido pelo reconciliador de fontes.
// Rodar na pasta frontend para ler seu .env. CSVs e relatórios ficam fora do Git.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';

const mode = process.argv[2];
const root = resolve(process.argv[3] || '/tmp/tse_identidades_2004_2024');
if (!['--export', '--apply'].includes(mode || '')) throw Error('Use --export|--apply [diretorio]');
mkdirSync(root, { recursive: true });
const literal = (s: string) => `'${s.replaceAll("'", "''")}'`;
const token = mode === '--apply'
  ? (Bun.env.MOTHERDUCK_TOKEN_READ_WRITE || Bun.env.MOTHERDUCK_TOKEN)
  : Bun.env.MOTHERDUCK_TOKEN;
if (!token) throw Error('Configure o token MotherDuck no .env local.');
const db = await DuckDBInstance.create(`md:BDR-TSE?token=${encodeURIComponent(token)}&motherduck_open_browser=false`);
const c = await db.connect();
const rows = async (sql: string) => (await c.runAndReadAll(sql)).getRowObjectsJson() as Record<string, any>[];
const scalar = async (sql: string) => Number(Object.values((await rows(sql))[0])[0]);
const started = Date.now();
try {
  if (mode === '--export') {
    for (const table of ['candidato', 'candidatura']) {
      const path = `${root}/${table}_antes.csv`;
      if (await Bun.file(path).exists()) throw Error(`Snapshot já existe: ${path}; escolha outro diretório.`);
      await c.run(`COPY public.${table} TO ${literal(path)} (HEADER,DELIMITER ';')`);
      console.log(`${table}: snapshot salvo.`);
    }
  } else {
    const manifest = JSON.parse(readFileSync(`${root}/plano_manifesto.json`, 'utf8'));
    for (const file of ['plano_perfis.csv', 'plano_vinculos.csv', 'candidato_antes.csv', 'candidatura_antes.csv']) {
      const digest = createHash('sha256').update(readFileSync(`${root}/${file}`)).digest('hex');
      if (manifest.sha256[file] !== digest) throw Error(`Checksum divergiu: ${file}`);
    }
    const csvOptions = `auto_detect=false,delim=';',header=true,quote='"',escape='"',allow_quoted_nulls=false`;
    await c.run(`CREATE TEMP TABLE _vinculos AS SELECT * FROM read_csv(${literal(`${root}/plano_vinculos.csv`)},${csvOptions},columns={'ano_eleicao':'INTEGER','sq_candidato':'BIGINT','id_anterior':'INTEGER','id_novo':'INTEGER'})`);
    const fields = {'id_pessoa_projeto':'INTEGER','nr_titulo_eleitoral_candidato':'VARCHAR','nr_cpf_candidato':'VARCHAR','nm_candidato':'VARCHAR','dt_nascimento':'DATE','ds_grau_instrucao':'VARCHAR','ds_genero':'VARCHAR','ds_cor_raca':'VARCHAR'};
    const columns = '{' + Object.entries(fields).map(([k,v]) => `${literal(k)}:${literal(v)}`).join(',') + '}';
    await c.run(`CREATE TEMP TABLE _perfis AS SELECT * FROM read_csv(${literal(`${root}/plano_perfis.csv`)},${csvOptions},columns=${columns})`);
    await c.run(`CREATE TEMP TABLE _perfis_antes AS SELECT * FROM read_csv(${literal(`${root}/candidato_antes.csv`)},${csvOptions},columns=${columns})`);
    const cols = Object.keys(fields).join(',');
    const check = async (sql: string, message: string) => { if (await scalar(sql)) throw Error(message); };
    const facts = async () => {
      const result: Record<string, unknown> = {};
      const sums: Record<string,string> = {bens_declarados:'vr_bem',receitas_campanha:'vr_receita',despesas_pagas:'vr_pago',votacao_candidato_municipio:'qt_votos_nominais',votacao_partido:'qt_votos_nominais + qt_votos_legenda'};
      for (const table of ['municipio','partido','bens_declarados','receitas_campanha','despesas_pagas','perfil_eleitorado','comparecimento_municipio','votacao_partido','votacao_candidato_municipio']) {
        result[table] = await rows(`SELECT COUNT(*) AS linhas${sums[table] ? `,SUM(${sums[table]})::VARCHAR AS total` : ''} FROM public.${table}`);
      }
      // Assinatura de todos os campos da candidatura exceto o vínculo alterado.
      const names = (await rows(`DESCRIBE public.candidatura`)).map(r => r.column_name as string).filter(n => n !== 'id_pessoa_projeto');
      result.candidatura = await rows(`SELECT COUNT(*) AS linhas,SUM(HASH(${names.map(n => `"${n}"`).join(',')}))::VARCHAR AS assinatura FROM public.candidatura`);
      return result;
    };
    await c.run('BEGIN TRANSACTION');
    try {
      await check(`SELECT COUNT(*) FROM public.candidatura c FULL JOIN _vinculos v USING(ano_eleicao,sq_candidato) WHERE c.sq_candidato IS NULL OR v.sq_candidato IS NULL OR c.id_pessoa_projeto IS DISTINCT FROM v.id_anterior`, 'Os vínculos mudaram desde o snapshot; exporte novamente.');
      await check(`SELECT COUNT(*) FROM ((SELECT ${cols} FROM public.candidato EXCEPT SELECT ${cols} FROM _perfis_antes) UNION ALL (SELECT ${cols} FROM _perfis_antes EXCEPT SELECT ${cols} FROM public.candidato))`, 'Os perfis mudaram desde o snapshot.');
      await check(`SELECT COUNT(*) FROM (SELECT ano_eleicao,sq_candidato FROM _vinculos GROUP BY 1,2 HAVING COUNT(*)>1)`, 'Plano contém candidaturas repetidas.');
      await check(`SELECT COUNT(*) FROM (SELECT id_pessoa_projeto FROM _perfis GROUP BY 1 HAVING COUNT(*)>1)`, 'Plano contém IDs de pessoa repetidos.');
      await check(`SELECT COUNT(*) FROM _vinculos v LEFT JOIN _perfis p ON p.id_pessoa_projeto=v.id_novo WHERE p.id_pessoa_projeto IS NULL`, 'Plano contém referências sem perfil.');
      console.log('Snapshot e plano conferidos; registrando totais antes da atualização.');
      const before = await facts();
      console.log('Atualizando perfis e vínculos dentro da transação.');
      await c.run(`INSERT INTO public.candidato(${cols}) SELECT ${cols.split(',').map(n => `p.${n}`).join(',')} FROM _perfis p WHERE NOT EXISTS(SELECT 1 FROM public.candidato c WHERE c.id_pessoa_projeto=p.id_pessoa_projeto)`);
      await c.run(`UPDATE public.candidato AS c SET ${Object.keys(fields).filter(n => n !== 'id_pessoa_projeto').map(n => `${n}=p.${n}`).join(',')} FROM _perfis p WHERE c.id_pessoa_projeto=p.id_pessoa_projeto`);
      await c.run(`UPDATE public.candidatura AS c SET id_pessoa_projeto=v.id_novo FROM _vinculos v WHERE c.ano_eleicao=v.ano_eleicao AND c.sq_candidato=v.sq_candidato AND c.id_pessoa_projeto IS DISTINCT FROM v.id_novo`);
      await c.run(`DELETE FROM public.candidato AS c WHERE NOT EXISTS(SELECT 1 FROM _perfis p WHERE p.id_pessoa_projeto=c.id_pessoa_projeto)`);
      await check(`SELECT COUNT(*) FROM public.candidatura c JOIN _vinculos v USING(ano_eleicao,sq_candidato) WHERE c.id_pessoa_projeto IS DISTINCT FROM v.id_novo`, 'Vínculos publicados divergem do plano.');
      await check(`SELECT COUNT(*) FROM ((SELECT ${cols} FROM public.candidato EXCEPT SELECT ${cols} FROM _perfis) UNION ALL (SELECT ${cols} FROM _perfis EXCEPT SELECT ${cols} FROM public.candidato))`, 'Perfis publicados divergem do plano.');
      console.log('Vínculos e perfis conferem com o plano; comparando os fatos.');
      const after = await facts();
      if (JSON.stringify(before) !== JSON.stringify(after)) throw Error('As contagens/totais dos fatos ou campos da candidatura mudaram.');
      const summary = { database:'BDR-TSE', applied_at:new Date().toISOString(), candidaturas:await scalar('SELECT COUNT(*) FROM _vinculos'), perfis:await scalar('SELECT COUNT(*) FROM _perfis'), vinculos_alterados:await scalar('SELECT COUNT(*) FROM _vinculos WHERE id_anterior<>id_novo'), before,after };
      await c.run('COMMIT');
      const dir = Bun.env.CACHE_DIR || resolve(import.meta.dir, '../.cache-api');
      mkdirSync(dir, {recursive:true});writeFileSync(`${dir}/revision`, summary.applied_at);
      writeFileSync(`${root}/aplicacao.json`, JSON.stringify({...summary,seconds:(Date.now()-started)/1000},null,2));
      console.log(JSON.stringify({applied:true,candidaturas:summary.candidaturas,perfis:summary.perfis,vinculos_alterados:summary.vinculos_alterados,seconds:(Date.now()-started)/1000}));
    } catch (e) { try { await c.run('ROLLBACK'); } catch {} throw e; }
  }
} finally { c.closeSync(); }
