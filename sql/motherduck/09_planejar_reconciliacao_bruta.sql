-- Plano local: atual/perfis são snapshots do banco; observacoes foi resolvida
-- por 08_resolver_identidades.sql a partir dos CSVs TSE correspondentes à UE/cargo.
-- Nenhuma instrução deste arquivo altera o banco publicado.
CREATE OR REPLACE TEMP TABLE _observacoes_completas AS
SELECT * FROM observacoes
UNION ALL
SELECT a.ano_eleicao::INTEGER,a.sq_candidato::BIGINT,
 NULL,NULL,NULL,nome_identidade(a.nm_urna_candidato),NULL::DATE,
 a.nm_urna_candidato,NULL,NULL,NULL,TRUE,
 'U:'||a.ano_eleicao||':'||a.sq_candidato
FROM atual a LEFT JOIN observacoes o
 ON a.ano_eleicao::INTEGER=o.ano_eleicao AND a.sq_candidato::BIGINT=o.sq_candidato
WHERE o.sq_candidato IS NULL;

CREATE OR REPLACE TEMP TABLE _grupos AS
SELECT chave_pessoa,
 FIRST(titulo ORDER BY titulo IS NULL,ano_eleicao DESC,sq_candidato DESC) AS nr_titulo_eleitoral_candidato,
 FIRST(cpf_publicado ORDER BY cpf_chave IS NULL,cpf_publicado IS NULL,ano_eleicao DESC,sq_candidato DESC) AS nr_cpf_candidato,
 FIRST(nome ORDER BY ano_eleicao DESC,sq_candidato DESC) AS nm_candidato,
 FIRST(nascimento ORDER BY ano_eleicao DESC,sq_candidato DESC) AS dt_nascimento,
 FIRST(instrucao ORDER BY ano_eleicao DESC,sq_candidato DESC) AS ds_grau_instrucao,
 FIRST(genero ORDER BY ano_eleicao DESC,sq_candidato DESC) AS ds_genero,
 FIRST(raca ORDER BY ano_eleicao DESC,sq_candidato DESC) AS ds_cor_raca,
 MAX(cpf_chave) AS cpf_chave,
 MAX(nome_norm) AS nome_norm,MAX(ano_eleicao) AS ano_mais_recente
FROM _observacoes_completas GROUP BY chave_pessoa;

-- Reusar um ID existente exige que seu perfil corresponda à identidade da
-- fonte. Assim uma pessoa contaminada não cede seu ID a outra por acaso.
CREATE OR REPLACE TEMP TABLE _ids_elegiveis AS
SELECT o.chave_pessoa,p.id_pessoa_projeto::INTEGER AS id_anterior,
 COUNT(*) AS suporte,MAX(o.ano_eleicao) AS ano_mais_recente
FROM _observacoes_completas o
JOIN atual a ON a.ano_eleicao::INTEGER=o.ano_eleicao AND a.sq_candidato::BIGINT=o.sq_candidato
JOIN perfis p ON p.id_pessoa_projeto=a.id_pessoa_projeto
JOIN _grupos g USING(chave_pessoa)
WHERE (nome_identidade(p.nm_candidato)=g.nome_norm
 AND TRY_CAST(p.dt_nascimento AS DATE)=g.dt_nascimento
 AND CASE WHEN cpf_valido(p.nr_cpf_candidato) AND g.cpf_chave IS NOT NULL
 THEN REGEXP_REPLACE(p.nr_cpf_candidato,'[^0-9]','','g')=g.cpf_chave
 ELSE p.nr_titulo_eleitoral_candidato=o.titulo END)
 OR (STARTS_WITH(o.chave_pessoa,'U:') AND p.nr_titulo_eleitoral_candidato IS NULL
 AND p.nr_cpf_candidato IS NULL AND nome_identidade(p.nm_candidato)=g.nome_norm
 AND (SELECT COUNT(*) FROM atual x WHERE x.id_pessoa_projeto=p.id_pessoa_projeto)=1)
GROUP BY 1,2;

CREATE OR REPLACE TEMP TABLE _ids_mantidos AS
SELECT chave_pessoa,id_anterior AS id_pessoa_projeto FROM (
 SELECT * FROM _ids_elegiveis
 QUALIFY ROW_NUMBER() OVER(PARTITION BY id_anterior ORDER BY suporte DESC,ano_mais_recente DESC,chave_pessoa)=1
) QUALIFY ROW_NUMBER() OVER(PARTITION BY chave_pessoa ORDER BY ano_mais_recente DESC,suporte DESC,id_anterior)=1;

CREATE OR REPLACE TEMP TABLE _ids_finais AS
SELECT g.chave_pessoa,m.id_pessoa_projeto
FROM _grupos g JOIN _ids_mantidos m USING(chave_pessoa)
UNION ALL
SELECT g.chave_pessoa,
 ((SELECT MAX(id_pessoa_projeto::INTEGER) FROM perfis)+ROW_NUMBER() OVER(ORDER BY g.chave_pessoa))::INTEGER
FROM _grupos g LEFT JOIN _ids_mantidos m USING(chave_pessoa)
WHERE m.id_pessoa_projeto IS NULL;

CREATE OR REPLACE TABLE plano_vinculos AS
SELECT o.ano_eleicao,o.sq_candidato,a.id_pessoa_projeto::INTEGER AS id_anterior,
 i.id_pessoa_projeto AS id_novo
FROM _observacoes_completas o JOIN _ids_finais i USING(chave_pessoa)
JOIN atual a ON a.ano_eleicao::INTEGER=o.ano_eleicao AND a.sq_candidato::BIGINT=o.sq_candidato;

CREATE OR REPLACE TABLE plano_perfis AS
SELECT i.id_pessoa_projeto,g.nr_titulo_eleitoral_candidato,g.nr_cpf_candidato,g.nm_candidato,
 g.dt_nascimento,g.ds_grau_instrucao,g.ds_genero,g.ds_cor_raca
FROM _grupos g JOIN _ids_finais i USING(chave_pessoa);
