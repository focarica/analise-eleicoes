-- Consultas PostgreSQL para validar a ingestão e formar o grão municipal.
-- Estas consultas não calculam nem comparam resultados político-eleitorais.

-- 1) Diagnóstico de cobertura e sentinelas antes de converter dados.
SELECT ano_eleicao, source_file, count(*) AS linhas
FROM stg_tse.candidatura
GROUP BY ano_eleicao, source_file
ORDER BY ano_eleicao, source_file;

SELECT ano_eleicao, count(*) AS linhas_com_sentinela
FROM stg_tse.candidatura
WHERE sq_candidato IN ('#NULO', '#NE', '-1', '-3', '-4')
   OR nr_partido IN ('#NULO', '#NE', '-1', '-3', '-4')
GROUP BY ano_eleicao
ORDER BY ano_eleicao;

-- 2) Agregação zona -> município usada para preencher o grão do modelo.
-- Preserva eleição, turno e cargo; não atribua códigos especiais a municípios.
SELECT ano_eleicao::integer,
       cd_eleicao::integer,
       nr_turno::integer,
       cd_cargo::integer,
       cd_municipio_tse,
       sq_candidato::bigint,
       sum(NULLIF(qt_votos_nominais, '')::bigint)::integer AS qt_votos_nominais
FROM stg_tse.votacao_candidato_munzona
WHERE ano_eleicao ~ '^[0-9]{4}$'
  AND cd_eleicao ~ '^[0-9]+$'
  AND nr_turno ~ '^[0-9]+$'
  AND cd_cargo ~ '^[0-9]+$'
  AND sq_candidato ~ '^[0-9]+$'
  AND NULLIF(qt_votos_nominais, '') ~ '^[0-9]+$'
  AND upper(sg_uf) IN (SELECT sg_uf::text FROM stg_tse.escopo_uf)
GROUP BY ano_eleicao, cd_eleicao, nr_turno, cd_cargo,
         cd_municipio_tse, sq_candidato;

-- 2b) Uma zona/eleição/turno/município pode aparecer para vários cargos.
-- Esta consulta deve retornar zero linhas antes de carregar COMPARECIMENTO.
SELECT ano_eleicao, cd_eleicao, nr_turno, cd_municipio_tse, nr_zona,
       count(DISTINCT (qt_aptos, qt_comparecimento, qt_abstencao))
           AS combinacoes_de_medidas
FROM stg_tse.detalhe_votacao_munzona
WHERE ano_eleicao ~ '^[0-9]{4}$'
  AND cd_eleicao ~ '^[0-9]+$'
  AND nr_turno ~ '^[0-9]+$'
  AND nr_zona ~ '^[0-9]+$'
  AND qt_aptos ~ '^[0-9]+$'
  AND qt_comparecimento ~ '^[0-9]+$'
  AND qt_abstencao ~ '^[0-9]+$'
  AND upper(sg_uf) IN (SELECT sg_uf::text FROM stg_tse.escopo_uf)
GROUP BY ano_eleicao, cd_eleicao, nr_turno, cd_municipio_tse, nr_zona
HAVING count(DISTINCT (qt_aptos, qt_comparecimento, qt_abstencao)) > 1;

-- Verifique candidatos sem cadastro municipal (pode ser voto em trânsito,
-- circunscrição BR/ZZ ou código TSE ainda não carregado). Não invente município.
-- A carga final deve excluir/isolar esses códigos segundo regra aprovada.

-- 3) Reconciliação de carga: contagens por ano nas tabelas de destino.
SELECT 'candidatura' AS tabela, ano_eleicao, count(*) AS linhas
FROM candidatura
WHERE ano_eleicao IN (2018, 2020, 2022, 2024)
GROUP BY ano_eleicao
UNION ALL
SELECT 'bens_declarados', ano_eleicao, count(*)
FROM bens_declarados
WHERE ano_eleicao IN (2018, 2020, 2022, 2024)
GROUP BY ano_eleicao
UNION ALL
SELECT 'receitas_campanha', ano_eleicao, count(*)
FROM receitas_campanha
WHERE ano_eleicao IN (2018, 2020, 2022, 2024)
GROUP BY ano_eleicao
UNION ALL
SELECT 'despesas_pagas', ano_eleicao, count(*)
FROM despesas_pagas
WHERE ano_eleicao IN (2018, 2020, 2022, 2024)
GROUP BY ano_eleicao
ORDER BY ano_eleicao, tabela;

-- 4) Auditoria de destinação: NULL não significa voto válido. As tabelas finais
-- de votos continuam preservando a contagem bruta; use a visão valida somente
-- em consultas cuja definição exige essa destinação.
SELECT ano_eleicao, cd_eleicao, nr_turno, universo_destinacao,
       nm_tipo_destinacao_votos, count(*) AS linhas
FROM stg_tse.votacao_candidato_com_destinacao
GROUP BY ano_eleicao, cd_eleicao, nr_turno, universo_destinacao,
         nm_tipo_destinacao_votos;

-- 5) Conflitos no turno escolhido: a carga 03 aborta se houver estas linhas.
SELECT ano_id, candidato_id, turno_resultado
FROM stg_tse.candidatura_resultado
WHERE turno_resultado IS NOT NULL
GROUP BY ano_id, candidato_id, turno_resultado
HAVING count(DISTINCT (stg_tse.inteiro_nao_negativo(cd_eleicao),
                      upper(situacao_informada))) > 1;

-- 6) Bloqueios municipais e respectivas zonas/arquivos de origem.
SELECT * FROM stg_tse.comparecimento_cobertura WHERE NOT completo;
SELECT * FROM stg_tse.quarentena_comparecimento ORDER BY id;
