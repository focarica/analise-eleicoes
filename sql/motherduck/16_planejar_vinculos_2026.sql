-- Requer as observações brutas e macros de 08_resolver_identidades.sql.
-- IDs numéricos de um staging não identificam pessoas no banco publicado.
CREATE OR REPLACE TEMP TABLE _matches_2026 AS
WITH candidatos AS (
SELECT DISTINCT o.ano_eleicao,o.sq_candidato,o.chave_pessoa,p.id_pessoa_projeto,
 nome_identidade(p.nm_candidato)=o.nome_norm AS nome_exato
FROM _person_by_candidature o JOIN public.candidato p
  ON p.dt_nascimento=o.nascimento
 AND (nome_identidade(p.nm_candidato)=o.nome_norm
      OR (cpf_valido(p.nr_cpf_candidato)
          AND REGEXP_REPLACE(p.nr_cpf_candidato,'[^0-9]','','g')=o.cpf_chave
          AND REPLACE(nome_identidade(p.nm_candidato),' ','')=REPLACE(o.nome_norm,' ','')))
WHERE NOT o.conflito AND o.ano_eleicao=2026
  AND ((cpf_valido(p.nr_cpf_candidato)
        AND REGEXP_REPLACE(p.nr_cpf_candidato,'[^0-9]','','g')=o.cpf_chave)
       OR (o.titulo IS NOT NULL AND p.nr_titulo_eleitoral_candidato=o.titulo
           AND (texto_publicado(p.nr_cpf_candidato) IS NULL OR o.cpf_publicado IS NULL
                OR REGEXP_REPLACE(p.nr_cpf_candidato,'[^0-9]','','g')=o.cpf_publicado)))
)
SELECT * FROM candidatos
-- Espaçamento com CPF corroborado só é alternativa quando não há nome exato.
QUALIFY nome_exato OR NOT BOOL_OR(nome_exato) OVER(PARTITION BY ano_eleicao,sq_candidato);

CREATE OR REPLACE TEMP TABLE _historicos_2026 AS
SELECT DISTINCT id_pessoa_projeto FROM public.candidatura WHERE ano_eleicao<>2026;

SELECT CASE WHEN EXISTS (
 SELECT m.sq_candidato FROM _matches_2026 m JOIN public.candidato p USING(id_pessoa_projeto)
 GROUP BY 1 HAVING COUNT(DISTINCT texto_publicado(p.nr_cpf_candidato))>1
) THEN ERROR('Perfis com CPFs conflitantes: revisão necessária') ELSE TRUE END;

CREATE OR REPLACE TEMP TABLE _preferidos_2026 AS
SELECT m.* FROM _matches_2026 m
WHERE EXISTS(SELECT 1 FROM _historicos_2026 h WHERE h.id_pessoa_projeto=m.id_pessoa_projeto)
   OR NOT EXISTS(SELECT 1 FROM _matches_2026 x JOIN _historicos_2026 h USING(id_pessoa_projeto)
                 WHERE x.sq_candidato=m.sq_candidato);

SELECT CASE WHEN EXISTS (
 SELECT c.sq_candidato FROM public.candidatura c
 LEFT JOIN _preferidos_2026 p USING(ano_eleicao,sq_candidato)
 WHERE c.ano_eleicao=2026 GROUP BY 1 HAVING COUNT(p.id_pessoa_projeto)<>1
) THEN ERROR('Candidatura sem perfil único corroborado: revisão necessária') ELSE TRUE END;

CREATE OR REPLACE TEMP TABLE _plano_vinculos_2026 AS
SELECT c.ano_eleicao,c.sq_candidato,c.id_pessoa_projeto AS id_anterior,p.id_pessoa_projeto AS id_novo
FROM public.candidatura c JOIN _preferidos_2026 p USING(ano_eleicao,sq_candidato)
WHERE c.ano_eleicao=2026;
