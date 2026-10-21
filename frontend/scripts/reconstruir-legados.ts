// Snapshot antes da reconstrução das chaves de 2006/2008. Nunca publicar CSVs.
import { mkdirSync, readFileSync, writeFileSync, openSync, readSync, closeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
const mode=process.argv[2],root=resolve(process.argv[3]||'/tmp/tse_rebuild_2006_2008');
if(!['--export','--apply'].includes(mode||''))throw Error('Use --export|--apply [diretorio]');
const token=mode==='--apply'?(Bun.env.MOTHERDUCK_TOKEN_READ_WRITE||Bun.env.MOTHERDUCK_TOKEN):Bun.env.MOTHERDUCK_TOKEN;
if(!token)throw Error('Token MotherDuck ausente.');
mkdirSync(root+'/backup',{recursive:true});
const lit=(s:string)=>`'${s.replaceAll("'","''")}'`;
const db=await DuckDBInstance.create(`md:BDR-TSE?token=${encodeURIComponent(token)}&motherduck_open_browser=false`);
const c=await db.connect();
// Limita o consumo do cliente ao comparar milhões de linhas com snapshots.
const spill=resolve(Bun.env.TSE_SPILL_DIR||root+'/spill');
mkdirSync(spill,{recursive:true});
await c.run("SET memory_limit='384MB'");
await c.run('SET threads=2');
await c.run("SET preserve_insertion_order=false");
await c.run(`SET temp_directory=${lit(spill)}`);
try {
 if(mode==='--apply'){ await apply(); } else {
 await c.run('BEGIN TRANSACTION');
 for(const table of ['candidato','candidatura','municipio','partido','bens_declarados','receitas_campanha','despesas_pagas','votacao_candidato_municipio']){
  const path=`${root}/backup/${table}.csv`;
  if(await Bun.file(path).exists())throw Error('Backup já existe; escolha outro diretório: '+table);
  const filter=['candidato','municipio','partido','candidatura'].includes(table)?'':' WHERE ano_eleicao IN (2006,2008)';
  await c.run(`COPY (SELECT * FROM public.${table}${filter}) TO ${lit(path)} (HEADER,DELIMITER ';')`);
  console.log('Snapshot salvo: '+table);
 }
 await c.run('COMMIT');
 }
}catch(e){try{await c.run('ROLLBACK')}catch{}throw e}finally{c.closeSync()}


// O plano é validado offline; a publicação revalida o snapshot e conserva os
// demais anos. Nenhuma tabela de auditoria é persistida no banco de produção.
async function apply(){
 const started=Date.now();
 const manifest=JSON.parse(readFileSync(root+'/plano_manifesto.json','utf8'));
 const facts=['bens_declarados','receitas_campanha','despesas_pagas','votacao_candidato_municipio'];
 const tables=['candidato','candidatura',...facts];
 for(const [name,info] of Object.entries(manifest.tables) as [string,any][]){
  const sha=createHash('sha256').update(readFileSync(`${root}/plano/${name}.csv`)).digest('hex');
  if(sha!==info.sha256)throw Error('Plano alterado: '+name);
 }
 for(const [file,sha] of Object.entries(manifest.snapshot_sha256)){
  if(createHash('sha256').update(readFileSync(`${root}/backup/${file}`)).digest('hex')!==sha)throw Error('Snapshot alterado: '+file);
 }
 const rows=async(sql:string)=>(await c.runAndReadAll(sql)).getRowObjectsJson() as Record<string,any>[];
 const count=async(sql:string)=>Number(Object.values((await rows(sql))[0])[0]);
 const check=async(sql:string,message:string)=>{if(await count(sql))throw Error(message)};
 const ident=(s:string)=>'"'+s.replaceAll('"','""')+'"';
 const fields:Record<string,string[]>={};
 const csv=`auto_detect=false,delim=';',header=true,quote='"',escape='"',allow_quoted_nulls=false`;
 for(const table of [...tables,'municipio','partido']){
  const schema=await rows(`DESCRIBE public.${table}`);
  fields[table]=schema.map(r=>r.column_name as string);
  const types=Object.fromEntries(schema.map(r=>[r.column_name,r.column_type]));
  for(const kind of (tables.includes(table)?['backup','plano']:['backup'])){
   // Todos os cabeçalhos do arquivo são conhecidos; a ordem física pode diferir
   // da ordem do banco. O INSERT sempre nomeia as colunas do destino.
   const path=`${root}/${kind}/${table}.csv`;
   const fd=openSync(path,'r');const buffer=Buffer.alloc(8192);const size=readSync(fd,buffer,0,buffer.length,0);closeSync(fd);
   const header=buffer.subarray(0,size).toString('utf8').split('\n',1)[0].replace(/\r$/,'').split(';').map(n=>n.replace(/^"|"$/g,''));
   if(header.length!==fields[table].length||header.some(n=>!types[n]))throw Error('Schema incompatível: '+table);
   const columns='{'+header.map(n=>`${lit(n)}:${lit(types[n])}`).join(',')+'}';
   console.log('Carregando conferência '+kind+': '+table);
   await c.run(`CREATE TEMP TABLE _${kind}_${table} AS SELECT * FROM read_csv(${lit(path)},${csv},columns=${columns})`);
  }
 }
 const columns=(table:string)=>fields[table].map(ident).join(',');
 const mismatch=(table:string,a:string,b:string,filter='')=>`SELECT COUNT(*) FROM ((SELECT ${columns(table)} FROM ${a} ${filter} EXCEPT ALL SELECT ${columns(table)} FROM ${b}) UNION ALL (SELECT ${columns(table)} FROM ${b} EXCEPT ALL SELECT ${columns(table)} FROM ${a} ${filter}))`;
 const signature=async(table:string,filter='')=>await rows(`SELECT COUNT(*) AS rows,SUM(HASH(${columns(table)}))::VARCHAR AS checksum FROM public.${table} ${filter}`);
 const sums:Record<string,string>={bens_declarados:'vr_bem',receitas_campanha:'vr_receita',despesas_pagas:'vr_pago',votacao_candidato_municipio:'qt_votos_nominais'};
 await c.run('BEGIN TRANSACTION');
 try{
  console.log('Validando que a base não mudou desde o snapshot.');
  for(const table of [...tables,'municipio','partido']){
   console.log('Comparando snapshot: '+table);
   await check(mismatch(table,'public.'+table,'_backup_'+table,facts.includes(table)?'WHERE ano_eleicao IN (2006,2008)':''),'Base mudou desde o snapshot: '+table);
  }
  for(const table of tables){
   const key=table==='candidato'?'id_pessoa_projeto':table==='candidatura'?'ano_eleicao,sq_candidato':table==='votacao_candidato_municipio'?'ano_eleicao,cd_eleicao,nr_turno,cd_cargo,cd_municipio_tse,sq_candidato':`ano_eleicao,sq_candidato,${{bens_declarados:'id_bem',receitas_campanha:'id_receita',despesas_pagas:'id_despesa'}[table]}`;
   await check(`SELECT COUNT(*) FROM (SELECT ${key} FROM _plano_${table} GROUP BY ${key} HAVING COUNT(*)>1)`,'Chaves repetidas no plano: '+table);
  }
  await check(`SELECT COUNT(*) FROM _plano_candidatura c LEFT JOIN _plano_candidato p USING(id_pessoa_projeto) WHERE p.id_pessoa_projeto IS NULL`,'Plano com vínculos órfãos.');
  await check(`SELECT COUNT(*) FROM _backup_candidatura b LEFT JOIN _plano_candidatura p USING(ano_eleicao,sq_candidato) WHERE p.sq_candidato IS NULL`,'Plano perderia candidaturas existentes.');
  const unaffected:Record<string,unknown>={};
  for(const table of facts)unaffected[table]=await signature(table,'WHERE ano_eleicao NOT IN (2006,2008)');
  for(const table of ['municipio','partido','perfil_eleitorado','comparecimento_municipio','votacao_partido']){
   if(!fields[table])fields[table]=(await rows(`DESCRIBE public.${table}`)).map(r=>r.column_name);
   unaffected[table]=await signature(table);
  }
  const nonLegacyFields=fields.candidatura.filter(n=>n!=='id_pessoa_projeto').map(ident).join(',');
  const nonLegacy=await rows(`SELECT COUNT(*) AS rows,SUM(HASH(${nonLegacyFields}))::VARCHAR AS checksum FROM public.candidatura WHERE ano_eleicao NOT IN (2006,2008)`);
  console.log('Publicando perfis e candidaturas corrigidas, em uma única transação.');
  const cols=columns('candidato');
  await c.run(`INSERT INTO public.candidato(${cols}) SELECT ${cols} FROM _plano_candidato p WHERE NOT EXISTS(SELECT 1 FROM public.candidato c WHERE c.id_pessoa_projeto=p.id_pessoa_projeto)`);
  const attrs=fields.candidato.filter(n=>n!=='id_pessoa_projeto');
  await c.run(`UPDATE public.candidato AS c SET ${attrs.map(n=>`${ident(n)}=p.${ident(n)}`).join(',')} FROM _plano_candidato p WHERE c.id_pessoa_projeto=p.id_pessoa_projeto AND (${attrs.map(n=>`c.${ident(n)} IS DISTINCT FROM p.${ident(n)}`).join(' OR ')})`);
  await c.run(`UPDATE public.candidatura AS c SET id_pessoa_projeto=p.id_pessoa_projeto FROM _plano_candidatura p WHERE c.ano_eleicao=p.ano_eleicao AND c.sq_candidato=p.sq_candidato AND c.ano_eleicao NOT IN (2006,2008) AND c.id_pessoa_projeto IS DISTINCT FROM p.id_pessoa_projeto`);
  for(const table of facts){console.log('Substituindo fatos: '+table);await c.run(`DELETE FROM public.${table} WHERE ano_eleicao IN (2006,2008)`)}
  await c.run('DELETE FROM public.candidatura WHERE ano_eleicao IN (2006,2008)');
  await c.run(`INSERT INTO public.candidatura(${columns('candidatura')}) SELECT ${columns('candidatura')} FROM _plano_candidatura WHERE ano_eleicao IN (2006,2008)`);
  for(const table of facts)await c.run(`INSERT INTO public.${table}(${columns(table)}) SELECT ${columns(table)} FROM _plano_${table}`);
  await c.run('DELETE FROM public.candidato AS c WHERE NOT EXISTS(SELECT 1 FROM _plano_candidato p WHERE p.id_pessoa_projeto=c.id_pessoa_projeto)');
  console.log('Reconciliando todos os registros publicados e conservando os demais anos.');
  for(const table of tables){console.log('Comparando publicação: '+table);await check(mismatch(table,'public.'+table,'_plano_'+table,facts.includes(table)?'WHERE ano_eleicao IN (2006,2008)':''),'Publicação diverge do plano: '+table)}
  for(const [table,before] of Object.entries(unaffected)){
   if(JSON.stringify(before)!==JSON.stringify(await signature(table,facts.includes(table)?'WHERE ano_eleicao NOT IN (2006,2008)':'')))throw Error('Dados fora do recorte mudaram: '+table);
  }
  if(JSON.stringify(nonLegacy)!==JSON.stringify(await rows(`SELECT COUNT(*) AS rows,SUM(HASH(${nonLegacyFields}))::VARCHAR AS checksum FROM public.candidatura WHERE ano_eleicao NOT IN (2006,2008)`)))throw Error('Metadados dos demais anos mudaram.');
  const summary:Record<string,unknown>={database:'BDR-TSE',applied_at:new Date().toISOString(),years:[2006,2008],unaffected,counts:await rows('SELECT ano_eleicao,COUNT(*) AS candidaturas FROM public.candidatura GROUP BY 1 ORDER BY 1'),totals:{}};
  for(const [table,value] of Object.entries(sums))(summary.totals as Record<string,unknown>)[table]=await rows(`SELECT ano_eleicao,COUNT(*) AS rows,SUM(${value})::VARCHAR AS total FROM public.${table} WHERE ano_eleicao IN (2006,2008) GROUP BY 1 ORDER BY 1`);
  await c.run('COMMIT');
  const cache=Bun.env.CACHE_DIR||resolve(import.meta.dir,'../.cache-api');
  mkdirSync(cache,{recursive:true});writeFileSync(cache+'/revision',String(summary.applied_at));
  summary.seconds=(Date.now()-started)/1000;
  writeFileSync(root+'/aplicacao_legados.json',JSON.stringify(summary,null,2));
  console.log(JSON.stringify({applied:true,seconds:summary.seconds,counts:summary.counts}));
 }catch(e){try{await c.run('ROLLBACK')}catch{}throw e}
}
