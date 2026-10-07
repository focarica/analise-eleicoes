-- Executado pelo Flight depois de normalizar os ZIPs oficiais do TSE em
-- tabelas temporarias locais. Publica somente as 11 tabelas do DER Joao Carlos.
-- O banco e o schema-alvo devem ser definidos pela execucao do Flight.

CREATE SCHEMA IF NOT EXISTS public;

CREATE OR REPLACE TEMP MACRO texto_publicado(v) AS (
    CASE WHEN v IS NULL OR UPPER(TRIM(v)) IN
        ('', '#NULO', '#NULO#', '#NE', '-1', '-3', '-4', 'NÃO DIVULGÁVEL')
    THEN NULL ELSE TRIM(v) END
);
CREATE OR REPLACE TEMP MACRO valor_brl(v) AS (
    CASE
        WHEN v IS NULL OR UPPER(TRIM(v)) IN
            ('', '#NULO', '#NULO#', '#NE', '-1', '-3', '-4', 'NÃO DIVULGÁVEL') THEN NULL
        WHEN CONTAINS(TRIM(v), ',') THEN
            TRY_CAST(REPLACE(REPLACE(TRIM(v), '.', ''), ',', '.') AS DECIMAL(14,2))
        ELSE TRY_CAST(TRIM(v) AS DECIMAL(14,2))
    END
);

-- O identificador de pessoa usa o titulo eleitoral quando divulgado. Sem titulo
-- valido, a pessoa permanece identificada somente naquela candidatura.
CREATE OR REPLACE TABLE public.candidato AS
WITH candidaturas_base AS (
    SELECT
        TRY_CAST(NULLIF(TRIM(ano_eleicao), '') AS INTEGER) AS ano_eleicao,
        TRY_CAST(NULLIF(TRIM(sq_candidato), '') AS BIGINT) AS sq_candidato,
        CASE WHEN REGEXP_FULL_MATCH(TRIM(nr_titulo_eleitoral_candidato), '[0-9]{12}')
                  AND TRIM(nr_titulo_eleitoral_candidato) <> '000000000000'
             THEN TRIM(nr_titulo_eleitoral_candidato) END AS titulo,
        texto_publicado(nr_cpf_candidato) AS cpf_bruto,
        texto_publicado(nm_candidato) AS nome_bruto,
        texto_publicado(dt_nascimento) AS nascimento_bruto,
        texto_publicado(ds_grau_instrucao) AS instrucao_bruta,
        texto_publicado(ds_genero) AS genero_bruto,
        texto_publicado(ds_cor_raca) AS raca_bruta
    FROM stg_candidatura
    WHERE TRY_CAST(ano_eleicao AS INTEGER) IS NOT NULL
      AND TRY_CAST(sq_candidato AS BIGINT) IS NOT NULL
), identidades AS (
    SELECT *,
        CASE WHEN titulo IS NOT NULL THEN 'T:' || titulo
             ELSE 'C:' || CAST(ano_eleicao AS VARCHAR) || ':' || CAST(sq_candidato AS VARCHAR)
        END AS chave_pessoa
    FROM candidaturas_base
), observacoes AS (
    SELECT *, ROW_NUMBER() OVER (
        PARTITION BY chave_pessoa ORDER BY ano_eleicao DESC, sq_candidato DESC
    ) AS rn
    FROM identidades
)
SELECT
    ROW_NUMBER() OVER (ORDER BY chave_pessoa)::INTEGER AS id_pessoa_projeto,
    MAX(titulo) AS nr_titulo_eleitoral_candidato,
    FIRST(cpf_bruto ORDER BY (cpf_bruto IS NOT NULL) DESC, ano_eleicao DESC) AS nr_cpf_candidato,
    FIRST(NULLIF(nome_bruto, '') ORDER BY ano_eleicao DESC) FILTER (WHERE rn = 1) AS nm_candidato,
    COALESCE(
        TRY_STRPTIME(FIRST(nascimento_bruto ORDER BY ano_eleicao DESC) FILTER (WHERE rn = 1), '%d/%m/%Y')::DATE,
        TRY_CAST(FIRST(nascimento_bruto ORDER BY ano_eleicao DESC) FILTER (WHERE rn = 1) AS DATE)
    ) AS dt_nascimento,
    FIRST(instrucao_bruta ORDER BY ano_eleicao DESC) FILTER (WHERE rn = 1) AS ds_grau_instrucao,
    FIRST(genero_bruto ORDER BY ano_eleicao DESC) FILTER (WHERE rn = 1) AS ds_genero,
    FIRST(raca_bruta ORDER BY ano_eleicao DESC) FILTER (WHERE rn = 1) AS ds_cor_raca
FROM observacoes
GROUP BY chave_pessoa;

CREATE OR REPLACE TABLE public.municipio AS
SELECT
    texto_publicado(cd_municipio_tse) AS cd_municipio_tse,
    CAST(NULL AS VARCHAR) AS cd_municipio_ibge,
    FIRST(texto_publicado(nm_municipio) ORDER BY (texto_publicado(nm_municipio) IS NOT NULL) DESC) AS nm_municipio,
    FIRST(UPPER(texto_publicado(sg_uf)) ORDER BY (texto_publicado(sg_uf) IS NOT NULL) DESC) AS sg_uf,
    CAST(NULL AS DECIMAL(14,2)) AS pib_per_capita,
    CAST(NULL AS DECIMAL(4,3)) AS idhm,
    CAST(NULL AS INTEGER) AS populacao_total
FROM stg_municipio
WHERE texto_publicado(cd_municipio_tse) IS NOT NULL
GROUP BY 1;

CREATE OR REPLACE TABLE public.partido AS
WITH fonte AS (
    SELECT TRY_CAST(nr_partido AS INTEGER) AS nr_partido,
        texto_publicado(sg_partido) AS sg_partido,
        texto_publicado(nm_partido) AS nm_partido,
           TRY_CAST(ano_eleicao AS INTEGER) AS ano_eleicao
    FROM stg_candidatura
    WHERE TRY_CAST(nr_partido AS INTEGER) IS NOT NULL
    UNION ALL
    SELECT TRY_CAST(nr_partido AS INTEGER), texto_publicado(sg_partido), NULL,
           TRY_CAST(ano_eleicao AS INTEGER)
    FROM stg_votacao_partido
    WHERE TRY_CAST(nr_partido AS INTEGER) IS NOT NULL
)
SELECT nr_partido,
       FIRST(sg_partido ORDER BY ano_eleicao DESC NULLS LAST) AS sg_partido,
       FIRST(nm_partido ORDER BY (nm_partido IS NOT NULL) DESC, ano_eleicao DESC NULLS LAST) AS nm_partido,
       CAST(NULL AS VARCHAR(50)) AS vies_politico
FROM fonte GROUP BY nr_partido;

CREATE OR REPLACE TABLE public.candidatura AS
WITH candidaturas_base AS (
    SELECT
        TRY_CAST(ano_eleicao AS INTEGER) AS ano_eleicao,
        TRY_CAST(sq_candidato AS BIGINT) AS sq_candidato,
        CASE WHEN REGEXP_FULL_MATCH(TRIM(nr_titulo_eleitoral_candidato), '[0-9]{12}')
                  AND TRIM(nr_titulo_eleitoral_candidato) <> '000000000000'
             THEN TRIM(nr_titulo_eleitoral_candidato) END AS titulo,
        TRY_CAST(nr_partido AS INTEGER) AS nr_partido,
    texto_publicado(sg_ue) AS sg_ue,
        TRY_CAST(cd_cargo AS INTEGER) AS cd_cargo,
    texto_publicado(ds_cargo) AS ds_cargo,
    texto_publicado(sg_partido) AS sg_partido,
    texto_publicado(nm_urna_candidato) AS nm_urna_candidato,
        TRY_CAST(nr_turno AS INTEGER) AS nr_turno,
    texto_publicado(ds_sit_tot_turno) AS situacao,
        NULLIF(TRIM(source_file), '') AS source_file
    FROM stg_candidatura
    WHERE TRY_CAST(ano_eleicao AS INTEGER) IS NOT NULL
      AND TRY_CAST(sq_candidato AS BIGINT) IS NOT NULL
      AND (UPPER(TRIM(sg_uf)) IN ('AC','AL','BA','DF','RO','SP') OR UPPER(TRIM(sg_uf)) = 'BR')
), com_turno AS (
    SELECT *,
        CASE WHEN nr_turno IN (1,2) AND UPPER(TRIM(situacao)) NOT IN
             ('2º TURNO','2° TURNO','2 TURNO','SEGUNDO TURNO') THEN nr_turno END AS turno_resultado
    FROM candidaturas_base
), resultado AS (
    SELECT * FROM com_turno
    QUALIFY ROW_NUMBER() OVER (
        PARTITION BY ano_eleicao, sq_candidato
        ORDER BY turno_resultado DESC NULLS LAST, source_file, situacao
    ) = 1
), pessoa AS (
    SELECT
        i.ano_eleicao, i.sq_candidato,
        CASE WHEN i.titulo IS NOT NULL THEN 'T:' || i.titulo
             ELSE 'C:' || CAST(i.ano_eleicao AS VARCHAR) || ':' || CAST(i.sq_candidato AS VARCHAR)
        END AS chave_pessoa
    FROM resultado i
), ids AS (
    SELECT chave_pessoa,
           ROW_NUMBER() OVER (ORDER BY chave_pessoa)::INTEGER AS id_pessoa_projeto
    FROM (SELECT DISTINCT chave_pessoa FROM pessoa)
)
SELECT
    r.ano_eleicao, r.sq_candidato, ids.id_pessoa_projeto,
    r.nr_partido,
    m.cd_municipio_tse,
    r.sg_partido,
    r.sg_ue,
    r.cd_cargo,
    r.ds_cargo,
    r.nm_urna_candidato,
    r.turno_resultado AS nr_turno_resultado,
    r.situacao AS ds_sit_tot_turno,
    CAST(NULL AS VARCHAR(50)) AS vies_politico_eleicao,
    CAST(NULL AS INTEGER) AS qt_votos_totais
FROM resultado r
JOIN pessoa p USING (ano_eleicao, sq_candidato)
JOIN ids USING (chave_pessoa)
LEFT JOIN public.municipio m ON m.cd_municipio_tse = r.sg_ue;

CREATE OR REPLACE TABLE public.bens_declarados AS
SELECT
    TRY_CAST(b.ano_eleicao AS INTEGER) AS ano_eleicao,
    TRY_CAST(b.sq_candidato AS BIGINT) AS sq_candidato,
    TRY_CAST(b.nr_ordem_bem_candidato AS INTEGER) AS id_bem,
    texto_publicado(b.ds_tipo_bem_candidato) AS ds_tipo_bem,
    texto_publicado(b.ds_bem_candidato) AS ds_bem,
    valor_brl(b.vr_bem_candidato) AS vr_bem
FROM stg_bem b
JOIN public.candidatura c
  ON c.ano_eleicao = TRY_CAST(b.ano_eleicao AS INTEGER)
 AND c.sq_candidato = TRY_CAST(b.sq_candidato AS BIGINT)
WHERE TRY_CAST(b.nr_ordem_bem_candidato AS INTEGER) IS NOT NULL;

CREATE OR REPLACE TABLE public.receitas_campanha AS
WITH parse AS (
    SELECT TRY_CAST(ano_eleicao AS INTEGER) AS ano_eleicao,
           TRY_CAST(sq_candidato AS BIGINT) AS sq_candidato,
           id_linha_origem,
           texto_publicado(ds_fonte_receita) AS ds_fonte_receita,
           valor_brl(vr_receita) AS vr_receita
    FROM stg_receita
)
SELECT p.ano_eleicao, p.sq_candidato,
       ROW_NUMBER() OVER (PARTITION BY p.ano_eleicao,p.sq_candidato ORDER BY p.id_linha_origem)::INTEGER AS id_receita,
       ds_fonte_receita,
       CAST(NULL AS VARCHAR(50)) AS tp_origem_recurso,
       vr_receita
FROM parse p
JOIN public.candidatura c USING (ano_eleicao,sq_candidato);

CREATE OR REPLACE TABLE public.despesas_pagas AS
WITH parse AS (
    SELECT TRY_CAST(ano_eleicao AS INTEGER) AS ano_eleicao,
           TRY_CAST(sq_candidato AS BIGINT) AS sq_candidato,
           id_linha_origem,
           texto_publicado(ds_despesa) AS ds_despesa,
           valor_brl(vr_pago) AS vr_pago
    FROM stg_despesa
)
SELECT p.ano_eleicao, p.sq_candidato,
       ROW_NUMBER() OVER (PARTITION BY p.ano_eleicao,p.sq_candidato ORDER BY p.id_linha_origem)::INTEGER AS id_despesa,
       ds_despesa,
       CAST(NULL AS VARCHAR(150)) AS ds_categoria_despesa,
       vr_pago
FROM parse p
JOIN public.candidatura c USING (ano_eleicao,sq_candidato);

CREATE OR REPLACE TABLE public.perfil_eleitorado AS
SELECT
    TRY_CAST(p.ano_eleicao AS INTEGER) AS ano_eleicao,
    TRIM(p.cd_municipio_tse) AS cd_municipio_tse,
    TRIM(p.ds_faixa_etaria) AS ds_faixa_etaria,
    TRY_CAST(SUM(TRY_CAST(p.qt_eleitores_perfil AS BIGINT)) AS INTEGER) AS qt_eleitores
FROM stg_perfil p
JOIN public.municipio m ON m.cd_municipio_tse = TRIM(p.cd_municipio_tse)
WHERE TRY_CAST(p.qt_eleitores_perfil AS BIGINT) IS NOT NULL
GROUP BY 1,2,3;

CREATE OR REPLACE TABLE public.votacao_candidato_municipio AS
SELECT
    TRY_CAST(v.ano_eleicao AS INTEGER) AS ano_eleicao,
    TRY_CAST(v.cd_eleicao AS INTEGER) AS cd_eleicao,
    TRY_CAST(v.nr_turno AS INTEGER) AS nr_turno,
    TRY_CAST(v.cd_cargo AS INTEGER) AS cd_cargo,
    TRIM(v.cd_municipio_tse) AS cd_municipio_tse,
    TRY_CAST(v.sq_candidato AS BIGINT) AS sq_candidato,
    TRY_CAST(SUM(TRY_CAST(v.qt_votos_nominais AS BIGINT)) AS INTEGER) AS qt_votos_nominais
FROM stg_votacao_candidato v
JOIN public.municipio m ON m.cd_municipio_tse = TRIM(v.cd_municipio_tse)
JOIN public.candidatura c
  ON c.ano_eleicao = TRY_CAST(v.ano_eleicao AS INTEGER)
 AND c.sq_candidato = TRY_CAST(v.sq_candidato AS BIGINT)
WHERE UPPER(TRIM(v.sg_uf)) IN ('AC','AL','BA','DF','RO','SP')
  AND TRY_CAST(v.qt_votos_nominais AS BIGINT) IS NOT NULL
GROUP BY 1,2,3,4,5,6;

UPDATE public.candidatura c
SET qt_votos_totais = v.qt_votos
FROM (
    SELECT ano_eleicao, sq_candidato, cd_cargo,
           TRY_CAST(SUM(qt_votos_nominais::BIGINT) AS INTEGER) AS qt_votos
    FROM public.votacao_candidato_municipio
    WHERE nr_turno = 1
    GROUP BY 1,2,3
) v
WHERE c.ano_eleicao=v.ano_eleicao AND c.sq_candidato=v.sq_candidato
  AND c.cd_cargo=v.cd_cargo
  AND (c.cd_municipio_tse IS NOT NULL OR UPPER(c.sg_ue) IN ('AC','AL','BA','DF','RO','SP'));

CREATE OR REPLACE TABLE public.votacao_partido AS
SELECT
    TRY_CAST(v.ano_eleicao AS INTEGER) AS ano_eleicao,
    TRY_CAST(v.cd_eleicao AS INTEGER) AS cd_eleicao,
    TRY_CAST(v.nr_turno AS INTEGER) AS nr_turno,
    TRY_CAST(v.cd_cargo AS INTEGER) AS cd_cargo,
    TRIM(v.cd_municipio_tse) AS cd_municipio_tse,
    TRY_CAST(v.nr_partido AS INTEGER) AS nr_partido,
    NULLIF(TRIM(v.sg_partido), '') AS sg_partido,
    TRY_CAST(SUM(TRY_CAST(v.qt_votos_legenda AS BIGINT)) AS INTEGER) AS qt_votos_legenda,
    TRY_CAST(SUM(TRY_CAST(v.qt_votos_nominais AS BIGINT)) AS INTEGER) AS qt_votos_nominais
FROM stg_votacao_partido v
JOIN public.municipio m ON m.cd_municipio_tse = TRIM(v.cd_municipio_tse)
JOIN public.partido p ON p.nr_partido = TRY_CAST(v.nr_partido AS INTEGER)
WHERE UPPER(TRIM(v.sg_uf)) IN ('AC','AL','BA','DF','RO','SP')
GROUP BY 1,2,3,4,5,6,7;

CREATE OR REPLACE TABLE public.comparecimento_municipio AS
WITH zonas AS (
    SELECT
        TRY_CAST(ano_eleicao AS INTEGER) AS ano_eleicao,
        TRY_CAST(cd_eleicao AS INTEGER) AS cd_eleicao,
        TRY_CAST(nr_turno AS INTEGER) AS nr_turno,
        TRIM(cd_municipio_tse) AS cd_municipio_tse,
        TRY_CAST(nr_zona AS INTEGER) AS nr_zona,
        COUNT(DISTINCT (TRY_CAST(qt_aptos AS BIGINT), TRY_CAST(qt_comparecimento AS BIGINT), TRY_CAST(qt_abstencao AS BIGINT))) AS combinacoes,
        MAX(TRY_CAST(qt_aptos AS BIGINT)) AS aptos,
        MAX(TRY_CAST(qt_comparecimento AS BIGINT)) AS presentes,
        MAX(TRY_CAST(qt_abstencao AS BIGINT)) AS ausentes,
        BOOL_AND(TRY_CAST(qt_aptos AS BIGINT) IS NOT NULL AND TRY_CAST(qt_comparecimento AS BIGINT) IS NOT NULL
                 AND TRY_CAST(qt_abstencao AS BIGINT) IS NOT NULL
                 AND TRY_CAST(qt_aptos AS BIGINT)=TRY_CAST(qt_comparecimento AS BIGINT)+TRY_CAST(qt_abstencao AS BIGINT)) AS medidas_validas
    FROM stg_detalhe
    WHERE UPPER(TRIM(sg_uf)) IN ('AC','AL','BA','DF','RO','SP')
    GROUP BY 1,2,3,4,5
), municipios_completos AS (
    SELECT ano_eleicao,cd_eleicao,nr_turno,cd_municipio_tse,
           BOOL_AND(combinacoes=1 AND medidas_validas) AS completo,
           COUNT(*) AS zonas,
           SUM(aptos) AS aptos,
           SUM(presentes) AS presentes,
           SUM(ausentes) AS ausentes
    FROM zonas
    GROUP BY 1,2,3,4
)
SELECT c.ano_eleicao,c.cd_eleicao,c.nr_turno,c.cd_municipio_tse,
       CAST(c.aptos AS INTEGER) AS qt_aptos,
       CAST(c.presentes AS INTEGER) AS qt_comparecimento,
       CAST(c.ausentes AS INTEGER) AS qt_abstencao
FROM municipios_completos c
JOIN public.municipio m USING(cd_municipio_tse)
WHERE c.completo
  AND c.aptos BETWEEN 0 AND 2147483647
  AND c.presentes BETWEEN 0 AND 2147483647
  AND c.ausentes BETWEEN 0 AND 2147483647;

-- Não carregar tabelas auxiliares/staging do pipeline no banco publicado.
