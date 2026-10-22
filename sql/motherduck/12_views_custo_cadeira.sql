-- Q1 / P1 — Quanto custa uma cadeira? Banco BDR-TSE, schema public.
-- Requer candidatura, municipio e despesas_pagas.
--
-- Duas leituras, por cargo, ano e lugar da disputa:
--   gasto médio de quem se elegeu  = vr_despesas_eleitos / qt_eleitos_com_despesa
--                                    (mesma ideia da view custo_cadeira do PostgreSQL)
--   custo da disputa por cadeira   = vr_despesas_total / qt_eleitos
--                                    (tudo o que todas as candidaturas pagaram, eleitas
--                                    ou não, dividido pelas cadeiras preenchidas)
-- Grão: ano_eleicao × cd_cargo × uf × cd_municipio_tse, com somas e contagens
-- aditivas. cd_municipio_tse é nulo nos cargos estaduais e federais; Presidente
-- tem uf 'BR'. O valor de um estado soma suas linhas; o de um município, as dele.
-- Divida sempre somas por somas (nunca tire média de médias).
--
-- Despesas = despesas pagas declaradas ao TSE (valores nominais). Candidatura sem
-- despesa declarada entra nas contagens, não nas somas: qt_com_despesa e
-- qt_eleitos_com_despesa dão a cobertura. Titulares apenas (sem vice e suplente).

CREATE SCHEMA IF NOT EXISTS public;

CREATE OR REPLACE VIEW public.vw_questao_1_custo_cadeira AS
WITH despesa AS (
    SELECT ano_eleicao, sq_candidato, SUM(vr_pago) AS vr_pago
    FROM public.despesas_pagas
    GROUP BY 1, 2
), candidaturas AS (
    SELECT
        c.ano_eleicao, c.cd_cargo, c.ds_cargo,
        COALESCE(m.sg_uf, c.sg_ue) AS uf,
        CASE WHEN c.cd_cargo IN (11, 13) THEN c.cd_municipio_tse END AS cd_municipio_tse,
        CASE WHEN c.ds_sit_tot_turno IN ('ELEITO', 'ELEITO POR QP', 'ELEITO POR MÉDIA', 'MÉDIA') THEN 1 ELSE 0 END AS eleito,
        d.vr_pago
    FROM public.candidatura c
    LEFT JOIN public.municipio m ON m.cd_municipio_tse = c.cd_municipio_tse
    LEFT JOIN despesa d ON d.ano_eleicao = c.ano_eleicao AND d.sq_candidato = c.sq_candidato
    WHERE c.ds_sit_tot_turno IS NOT NULL
      AND c.cd_cargo IN (1, 3, 5, 6, 7, 8, 11, 13)
)
SELECT
    ano_eleicao, cd_cargo, ANY_VALUE(ds_cargo) AS ds_cargo, uf, cd_municipio_tse,
    COUNT(*) AS qt_candidaturas,
    COUNT(vr_pago) AS qt_com_despesa,
    CAST(COALESCE(SUM(vr_pago), 0) AS DECIMAL(18, 2)) AS vr_despesas_total,
    SUM(eleito) AS qt_eleitos,
    COUNT(vr_pago) FILTER (WHERE eleito = 1) AS qt_eleitos_com_despesa,
    CAST(COALESCE(SUM(vr_pago) FILTER (WHERE eleito = 1), 0) AS DECIMAL(18, 2)) AS vr_despesas_eleitos
FROM candidaturas
GROUP BY ano_eleicao, cd_cargo, uf, cd_municipio_tse;
