-- P6 — idade do eleitorado, idade dos prefeitos eleitos e alternância partidária.
-- Janela deliberada: eleições municipais carregadas de 2004 a 2024.
-- Uma linha por município e pleito municipal. A idade média do eleitorado é
-- estimada pelo ponto médio de cada faixa etária do perfil TSE (100+ = 100).
-- Alternância significa mudança de partido do prefeito eleito em relação ao
-- ciclo municipal imediatamente anterior (quatro anos antes). Não mede troca
-- individual de prefeito nem mudança ideológica. O primeiro ano da janela e
-- lacunas de ciclo ficam NULL, sem inferir uma alternância.

CREATE SCHEMA IF NOT EXISTS public;

CREATE OR REPLACE VIEW public.vw_questao_6_idade_alternancia AS
WITH datas_eleicao(ano_eleicao, dt_eleicao) AS (
    VALUES (2004, DATE '2004-10-03'), (2008, DATE '2008-10-05'),
           (2012, DATE '2012-10-07'), (2016, DATE '2016-10-02'),
           (2020, DATE '2020-11-15'), (2024, DATE '2024-10-06')
), idade_faixa AS (
    SELECT f.cd_municipio_ibge, f.ano_eleicao, f.qt_eleitores,
           CASE
             WHEN regexp_matches(LOWER(f.ds_categoria), '^[0-9]+ anos?$')
               THEN regexp_extract(f.ds_categoria, '^[0-9]+', 0)::DOUBLE
             WHEN regexp_matches(LOWER(f.ds_categoria), '^[0-9]+ a [0-9]+ anos$')
               THEN (regexp_extract(f.ds_categoria, '^[0-9]+', 0)::DOUBLE
                    + regexp_extract(f.ds_categoria, ' a ([0-9]+)', 1)::DOUBLE) / 2.0
             WHEN regexp_matches(LOWER(f.ds_categoria), '^100 anos ou mais$') THEN 100.0
           END AS idade_media_faixa
    FROM public.fato_perfil_eleitorado f
    WHERE f.tp_dimensao = 'FAIXA_ETARIA'
), idade_eleitorado AS (
    SELECT cd_municipio_ibge, ano_eleicao,
           SUM(idade_media_faixa * qt_eleitores) / NULLIF(SUM(qt_eleitores) FILTER (WHERE idade_media_faixa IS NOT NULL), 0) AS idade_media_eleitorado,
           SUM(qt_eleitores) FILTER (WHERE idade_media_faixa IS NOT NULL) AS qt_eleitores_com_idade
    FROM idade_faixa
    WHERE idade_media_faixa IS NOT NULL
    GROUP BY 1, 2
), ponte AS (
    SELECT m.cd_municipio_tse, m.nm_municipio, m.sg_uf,
           COALESCE(m.cd_municipio_ibge, mi.cd_municipio_ibge) AS cd_municipio_ibge
    FROM public.municipio m
    LEFT JOIN public.vw_municipio_ibge mi USING (cd_municipio_tse)
), eleitos AS (
    SELECT c.ano_eleicao, c.cd_municipio_tse, c.id_pessoa_projeto,
           c.sq_candidato, c.nm_urna_candidato, c.nr_partido,
           COALESCE(c.sg_partido, p.sg_partido) AS sg_partido,
           ca.dt_nascimento, d.dt_eleicao,
           date_part('year', d.dt_eleicao) - date_part('year', ca.dt_nascimento)
             - CASE WHEN strftime(d.dt_eleicao, '%m%d') < strftime(ca.dt_nascimento, '%m%d') THEN 1 ELSE 0 END AS idade_prefeito
    FROM public.candidatura c
    JOIN datas_eleicao d USING (ano_eleicao)
    LEFT JOIN public.candidato ca ON ca.id_pessoa_projeto = c.id_pessoa_projeto
    LEFT JOIN public.partido p USING (nr_partido)
    WHERE c.cd_cargo = 11
      AND c.cd_municipio_tse IS NOT NULL
      AND c.ds_sit_tot_turno IN ('ELEITO', 'ELEITO POR QP', 'ELEITO POR MÉDIA', 'MÉDIA')
    QUALIFY ROW_NUMBER() OVER (
        PARTITION BY c.ano_eleicao, c.cd_municipio_tse
        ORDER BY c.nr_turno_resultado DESC NULLS LAST, c.sq_candidato
    ) = 1
), historico AS (
    SELECT e.*,
           LAG(e.ano_eleicao) OVER w AS ano_eleicao_anterior,
           LAG(e.nr_partido) OVER w AS nr_partido_anterior,
           LAG(e.sg_partido) OVER w AS sg_partido_anterior,
           LAG(e.id_pessoa_projeto) OVER w AS id_prefeito_anterior
    FROM eleitos e
    WINDOW w AS (PARTITION BY e.cd_municipio_tse ORDER BY e.ano_eleicao)
)
SELECT h.ano_eleicao, h.cd_municipio_tse, m.cd_municipio_ibge,
       m.nm_municipio, m.sg_uf,
       h.id_pessoa_projeto, h.sq_candidato, h.nm_urna_candidato,
       h.nr_partido, h.sg_partido, h.idade_prefeito,
       h.ano_eleicao_anterior, h.sg_partido_anterior,
       ie.idade_media_eleitorado, ie.qt_eleitores_com_idade,
       CASE WHEN h.ano_eleicao_anterior = h.ano_eleicao - 4
                  AND h.nr_partido_anterior IS NOT NULL AND h.nr_partido IS NOT NULL
            THEN h.nr_partido_anterior <> h.nr_partido END AS alternou_partido,
       CASE WHEN h.ano_eleicao_anterior = h.ano_eleicao - 4
                  AND h.id_prefeito_anterior IS NOT NULL AND h.id_pessoa_projeto IS NOT NULL
            THEN h.id_prefeito_anterior = h.id_pessoa_projeto END AS mesmo_prefeito
FROM historico h
JOIN ponte m USING (cd_municipio_tse)
LEFT JOIN idade_eleitorado ie
  ON ie.cd_municipio_ibge = m.cd_municipio_ibge AND ie.ano_eleicao = h.ano_eleicao;
