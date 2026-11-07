-- P3 — contexto socioeconômico municipal, comparecimento e partido do prefeito eleito.
-- Uma linha por município e eleição municipal (2004–2024).
--
-- Regras:
-- * Para comparecimento, usa o código de eleição que cobre mais municípios no ano;
--   eleições suplementares não são somadas à eleição principal.
-- * PIB/população usam a observação IBGE mais recente com ano <= ano da eleição;
--   a referência usada permanece explícita nas colunas ano_ibge/tipo_populacao.
-- * IDHM usa a referência mais recente disponível até 2010, sem interpolação.
-- * Eleitores/população = aptos do 1º turno / população IBGE de referência.
-- * Isentos são apresentados como abstenção: abstencoes / aptos no 1º turno.
-- * Partido vitorioso é o do prefeito registrado como eleito pelo TSE.

CREATE SCHEMA IF NOT EXISTS public;

CREATE OR REPLACE VIEW public.vw_questao_3_indicadores_municipio AS
WITH pleitos AS (
    SELECT DISTINCT ano_eleicao
    FROM public.candidatura
    WHERE cd_cargo = 11
      AND ano_eleicao IN (2004, 2008, 2012, 2016, 2020, 2024)
), ponte AS (
    SELECT m.cd_municipio_tse, m.nm_municipio, m.sg_uf,
           COALESCE(m.cd_municipio_ibge, mi.cd_municipio_ibge) AS cd_municipio_ibge
    FROM public.municipio m
    LEFT JOIN public.vw_municipio_ibge mi USING (cd_municipio_tse)
), vencedor AS (
    SELECT c.ano_eleicao, c.cd_municipio_tse, c.id_pessoa_projeto,
           c.sq_candidato, c.nm_urna_candidato, c.nr_partido,
           COALESCE(c.sg_partido, p.sg_partido) AS sg_partido,
           c.ds_sit_tot_turno
    FROM public.candidatura c
    LEFT JOIN public.partido p USING (nr_partido)
    WHERE c.cd_cargo = 11
      AND c.cd_municipio_tse IS NOT NULL
      AND c.ds_sit_tot_turno IN ('ELEITO', 'ELEITO POR QP', 'ELEITO POR MÉDIA', 'MÉDIA')
    QUALIFY ROW_NUMBER() OVER (
        PARTITION BY c.ano_eleicao, c.cd_municipio_tse
        ORDER BY c.nr_turno_resultado DESC NULLS LAST, c.sq_candidato
    ) = 1
), comparecimento_por_codigo AS (
    SELECT ano_eleicao, cd_eleicao,
           COUNT(DISTINCT cd_municipio_tse) AS municipios,
           SUM(qt_aptos) AS aptos,
           SUM(qt_abstencao) AS abstencoes,
           SUM(qt_comparecimento) AS compareceram
    FROM public.comparecimento_municipio
    WHERE nr_turno = 1
      AND ano_eleicao IN (2004, 2008, 2012, 2016, 2020, 2024)
    GROUP BY ano_eleicao, cd_eleicao
), codigo_principal AS (
    SELECT ano_eleicao, cd_eleicao
    FROM comparecimento_por_codigo
    QUALIFY ROW_NUMBER() OVER (
        PARTITION BY ano_eleicao ORDER BY municipios DESC, aptos DESC, cd_eleicao
    ) = 1
), comparecimento AS (
    SELECT x.ano_eleicao, x.cd_municipio_tse, x.qt_aptos,
           x.qt_abstencao, x.qt_comparecimento
    FROM public.comparecimento_municipio x
    JOIN codigo_principal p USING (ano_eleicao, cd_eleicao)
    WHERE x.nr_turno = 1
), base AS (
    SELECT pl.ano_eleicao, m.cd_municipio_tse, m.cd_municipio_ibge,
           m.nm_municipio, m.sg_uf,
           w.id_pessoa_projeto, w.sq_candidato, w.nm_urna_candidato,
           w.nr_partido, w.sg_partido,
           c.qt_aptos, c.qt_comparecimento, c.qt_abstencao,
           pop.ano AS ano_populacao, pop.tipo_populacao, pop.populacao,
           pib.ano AS ano_pib, pib.pib_per_capita,
           i.ano_referencia AS ano_idhm, i.idhm, i.idhm_r, i.idhm_l, i.idhm_e
    FROM pleitos pl
    CROSS JOIN ponte m
    LEFT JOIN vencedor w
      ON w.ano_eleicao = pl.ano_eleicao AND w.cd_municipio_tse = m.cd_municipio_tse
    LEFT JOIN comparecimento c
      ON c.ano_eleicao = pl.ano_eleicao AND c.cd_municipio_tse = m.cd_municipio_tse
    LEFT JOIN LATERAL (
        SELECT s.ano, s.tipo_populacao, s.populacao
        FROM public.fato_socioeconomico_ibge s
        WHERE s.cd_municipio_ibge = m.cd_municipio_ibge
          AND s.ano <= pl.ano_eleicao AND s.populacao IS NOT NULL
        ORDER BY s.ano DESC
        LIMIT 1
    ) pop ON TRUE
    LEFT JOIN LATERAL (
        SELECT s.ano, s.pib_per_capita
        FROM public.fato_socioeconomico_ibge s
        WHERE s.cd_municipio_ibge = m.cd_municipio_ibge
          AND s.ano <= pl.ano_eleicao AND s.pib_per_capita IS NOT NULL
        ORDER BY s.ano DESC
        LIMIT 1
    ) pib ON TRUE
    LEFT JOIN LATERAL (
        SELECT i.ano_referencia, i.idhm, i.idhm_r, i.idhm_l, i.idhm_e
        FROM public.fato_idhm_atlas i
        WHERE i.codmun7 = m.cd_municipio_ibge
          AND i.ano_referencia <= 2010
        ORDER BY i.ano_referencia DESC
        LIMIT 1
    ) i ON TRUE
)
SELECT ano_eleicao, cd_municipio_tse, cd_municipio_ibge, nm_municipio, sg_uf,
       id_pessoa_projeto, sq_candidato, nm_urna_candidato, nr_partido, sg_partido,
       ano_populacao, tipo_populacao, populacao, ano_pib, pib_per_capita,
       ano_idhm, idhm, idhm_r, idhm_l, idhm_e,
       qt_aptos, qt_comparecimento, qt_abstencao,
       CASE WHEN qt_aptos > 0 THEN 100.0 * qt_abstencao / qt_aptos END AS pct_abstencao,
       CASE WHEN qt_aptos > 0 THEN 100.0 * qt_comparecimento / qt_aptos END AS pct_comparecimento,
       CASE WHEN populacao > 0 THEN 100.0 * qt_aptos / populacao END AS pct_eleitores_populacao
FROM base;
