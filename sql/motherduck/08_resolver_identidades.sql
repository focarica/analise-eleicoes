-- Executar após criar stg_candidatura. Não publica tabelas auxiliares.
-- Título/CPF são observações por ano/SQ; conflitos nunca se resolvem pelo
-- menor ID. CPF requer dígitos verificadores + nome legal e nascimento iguais.
CREATE OR REPLACE TEMP TABLE _identidade_escopo_guard AS
SELECT CASE WHEN EXISTS (
 SELECT ano_eleicao,sq_candidato FROM stg_candidatura
 GROUP BY 1,2 HAVING COUNT(DISTINCT sg_uf||':'||sg_ue||':'||cd_cargo)>1
) THEN ERROR('SQ_CANDIDATO reutilizado entre circunscrições/cargos: reprocessar as chaves históricas com escopo antes de publicar; ano/SQ não basta em 2006/2008.') ELSE TRUE END AS valido;
CREATE OR REPLACE TEMP MACRO texto_publicado(v) AS (
 CASE WHEN v IS NULL OR UPPER(TRIM(v)) IN
 ('', '#NULO', '#NULO#', '#NE', '#NE#', '-1', '-3', '-4', 'NÃO DIVULGÁVEL')
 THEN NULL ELSE TRIM(v) END
);
CREATE OR REPLACE TEMP MACRO nome_identidade(v) AS (
 TRIM(REGEXP_REPLACE(STRIP_ACCENTS(UPPER(texto_publicado(v))), '[^A-Z0-9]+', ' ', 'g'))
);
CREATE OR REPLACE TEMP MACRO cpf_valido(v) AS (
 CASE WHEN REGEXP_FULL_MATCH(REGEXP_REPLACE(COALESCE(v, ''), '[^0-9]', '', 'g'), '[0-9]{11}')
 AND REGEXP_REPLACE(v, '[^0-9]', '', 'g') NOT IN
 ('00000000000','11111111111','22222222222','33333333333','44444444444',
 '55555555555','66666666666','77777777777','88888888888','99999999999')
 THEN ((LIST_SUM(LIST_TRANSFORM(RANGE(0,9),i -> CAST(SUBSTR(REGEXP_REPLACE(v,'[^0-9]','','g'),i+1,1) AS INTEGER)*(10-i)))*10)%11%10=CAST(SUBSTR(REGEXP_REPLACE(v,'[^0-9]','','g'),10,1) AS INTEGER)
 AND (LIST_SUM(LIST_TRANSFORM(RANGE(0,10),i -> CAST(SUBSTR(REGEXP_REPLACE(v,'[^0-9]','','g'),i+1,1) AS INTEGER)*(11-i)))*10)%11%10=CAST(SUBSTR(REGEXP_REPLACE(v,'[^0-9]','','g'),11,1) AS INTEGER))
 ELSE FALSE END
);

CREATE OR REPLACE TEMP TABLE _person_by_candidature AS
WITH origem AS (
 SELECT TRY_CAST(ano_eleicao AS INTEGER) AS ano_eleicao,
 TRY_CAST(sq_candidato AS BIGINT) AS sq_candidato,
 CASE WHEN REGEXP_FULL_MATCH(TRIM(nr_titulo_eleitoral_candidato),'[0-9]{12}')
 AND TRIM(nr_titulo_eleitoral_candidato)<>'000000000000' THEN TRIM(nr_titulo_eleitoral_candidato) END AS titulo,
 CASE WHEN REGEXP_FULL_MATCH(REGEXP_REPLACE(COALESCE(nr_cpf_candidato,''),'[^0-9]','','g'),'[0-9]{11}')
 THEN REGEXP_REPLACE(nr_cpf_candidato,'[^0-9]','','g') END AS cpf_publicado,
 CASE WHEN cpf_valido(nr_cpf_candidato) THEN REGEXP_REPLACE(nr_cpf_candidato,'[^0-9]','','g') END AS cpf_chave,
 texto_publicado(nm_candidato) AS nome, nome_identidade(nm_candidato) AS nome_norm,
 COALESCE(TRY_STRPTIME(texto_publicado(dt_nascimento),'%d/%m/%Y')::DATE,TRY_CAST(texto_publicado(dt_nascimento) AS DATE)) AS nascimento,
 texto_publicado(ds_grau_instrucao) AS instrucao, texto_publicado(ds_genero) AS genero,
 texto_publicado(ds_cor_raca) AS raca, source_file
 FROM stg_candidatura
 WHERE TRY_CAST(ano_eleicao AS INTEGER) IS NOT NULL AND TRY_CAST(sq_candidato AS BIGINT) IS NOT NULL
), observacao AS (
 SELECT ano_eleicao,sq_candidato,
 CASE WHEN COUNT(DISTINCT titulo)=1 THEN MAX(titulo) END AS titulo,
 CASE WHEN COUNT(DISTINCT cpf_publicado)=1 THEN MAX(cpf_publicado) END AS cpf_publicado,
 CASE WHEN COUNT(DISTINCT cpf_chave)=1 THEN MAX(cpf_chave) END AS cpf_chave,
 CASE WHEN COUNT(DISTINCT nome_norm)=1 THEN MAX(nome_norm) END AS nome_norm,
 CASE WHEN COUNT(DISTINCT nascimento)=1 THEN MAX(nascimento) END AS nascimento,
 FIRST(nome ORDER BY source_file DESC NULLS LAST,nome) AS nome,
 FIRST(instrucao ORDER BY source_file DESC NULLS LAST,instrucao) AS instrucao,
 FIRST(genero ORDER BY source_file DESC NULLS LAST,genero) AS genero,
 FIRST(raca ORDER BY source_file DESC NULLS LAST,raca) AS raca,
 COUNT(DISTINCT titulo)>1 OR COUNT(DISTINCT cpf_publicado)>1
 OR COUNT(DISTINCT nome_norm)>1 OR COUNT(DISTINCT nascimento)>1 AS conflito
 FROM origem GROUP BY 1,2
), titulo_classes AS (
 SELECT titulo,nome_norm,nascimento,
 COUNT(DISTINCT cpf_publicado) AS cpfs_publicados,
 CASE WHEN COUNT(DISTINCT cpf_chave)=1 THEN MAX(cpf_chave) END AS cpf_consenso
 FROM observacao
 WHERE NOT conflito AND titulo IS NOT NULL AND nome_norm IS NOT NULL AND nascimento IS NOT NULL
 GROUP BY 1,2,3
)
SELECT p.*,
 CASE WHEN p.conflito OR p.nome_norm IS NULL OR p.nascimento IS NULL
 THEN 'C:'||p.ano_eleicao||':'||p.sq_candidato
 WHEN p.cpf_chave IS NOT NULL
 THEN 'P:'||p.cpf_chave||':'||SHA256(p.nome_norm||':'||p.nascimento::VARCHAR)
 WHEN t.cpfs_publicados<=1 AND t.cpf_consenso IS NOT NULL
 THEN 'P:'||t.cpf_consenso||':'||SHA256(p.nome_norm||':'||p.nascimento::VARCHAR)
 WHEN t.cpfs_publicados<=1
 THEN 'T:'||p.titulo||':'||SHA256(p.nome_norm||':'||p.nascimento::VARCHAR)
 ELSE 'C:'||p.ano_eleicao||':'||p.sq_candidato END AS chave_pessoa
FROM observacao p LEFT JOIN titulo_classes t USING(titulo,nome_norm,nascimento);

CREATE OR REPLACE TEMP TABLE _person_ids AS
SELECT chave_pessoa,ROW_NUMBER() OVER(ORDER BY chave_pessoa)::INTEGER AS id_pessoa_projeto
FROM (SELECT DISTINCT chave_pessoa FROM _person_by_candidature);
