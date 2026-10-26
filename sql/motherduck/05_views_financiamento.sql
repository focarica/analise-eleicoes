-- Q8 / P8 — Financiamento: peso das fontes de campanha por candidatura, faixa de
-- dependência e partido. Banco BDR-TSE, schema public.
-- Usa a classificação explícita reconciliada em TP_ORIGEM_RECURSO. Fontes que
-- não permitem separar com segurança público/privado permanecem sem classe;
-- a porcentagem pública continua tendo o total arrecadado como denominador.

CREATE OR REPLACE VIEW public.v_financiamento_candidatura AS
WITH receptor AS (
    SELECT
        ano_eleicao, sq_candidato,
        SUM(vr_receita) AS total,
        SUM(CASE WHEN tp_origem_recurso = 'PÚBLICO' THEN vr_receita ELSE 0 END) AS publicas,
        SUM(CASE WHEN tp_origem_recurso = 'PRIVADO' THEN vr_receita ELSE 0 END) AS outros
    FROM public.receitas_campanha
    GROUP BY 1, 2
)
SELECT
    c.ano_eleicao, c.sq_candidato, c.cd_cargo,
    COALESCE(m.sg_uf, c.sg_ue) AS uf,
    c.sg_partido, c.ds_sit_tot_turno,
    CASE WHEN c.ds_sit_tot_turno IN ('ELEITO', 'ELEITO POR QP', 'ELEITO POR MÉDIA') THEN 1 ELSE 0 END AS eleito,
    r.total, COALESCE(r.publicas, 0) AS publicas, COALESCE(r.outros, 0) AS outros,
    CASE WHEN r.total > 0 THEN 100.0 * r.publicas / r.total ELSE NULL END AS pct_publico,
    CASE
        WHEN COALESCE(r.total, 0) = 0 THEN 'sem receita'
        WHEN 100.0 * r.publicas / r.total < 25 THEN '[00,25)'
        WHEN 100.0 * r.publicas / r.total < 50 THEN '[25,50)'
        WHEN 100.0 * r.publicas / r.total < 75 THEN '[50,75)'
        ELSE '[75,100]'
    END AS faixa
FROM public.candidatura c
LEFT JOIN public.municipio m ON m.cd_municipio_tse = c.cd_municipio_tse
LEFT JOIN receptor r ON r.ano_eleicao = c.ano_eleicao AND r.sq_candidato = c.sq_candidato
WHERE c.ds_sit_tot_turno IS NOT NULL
  AND c.cd_cargo IN (1, 3, 5, 6, 7, 8, 11, 13);

CREATE OR REPLACE VIEW public.v_financiamento_faixas AS
SELECT
    cd_cargo, uf, ano_eleicao, faixa,
    COUNT(*) AS candidaturas,
    SUM(eleito) AS eleitas,
    ROUND(100.0 * SUM(eleito) / COUNT(*), 1) AS taxa_eleicao
FROM public.v_financiamento_candidatura
GROUP BY 1, 2, 3, 4;

CREATE OR REPLACE VIEW public.v_financiamento_fontes AS
SELECT
    c.ano_eleicao, c.cd_cargo,
    COALESCE(m.sg_uf, c.sg_ue) AS uf,
    r.ds_fonte_receita,
    COUNT(*) AS lances,
    SUM(r.vr_receita) AS total
FROM public.receitas_campanha r
JOIN public.candidatura c ON c.ano_eleicao = r.ano_eleicao AND c.sq_candidato = r.sq_candidato
LEFT JOIN public.municipio m ON m.cd_municipio_tse = c.cd_municipio_tse
GROUP BY 1, 2, 3, 4;

CREATE OR REPLACE VIEW public.v_financiamento_partidos AS
SELECT
    cd_cargo, uf, ano_eleicao, sg_partido,
    COUNT(*) AS candidaturas,
    SUM(eleito) AS eleitas,
    SUM(total) AS arrecadado,
    SUM(publicas) AS publicas,
    SUM(outros) AS outros,
    CASE WHEN SUM(total) > 0 THEN ROUND(100.0 * SUM(publicas) / SUM(total), 1) ELSE NULL END AS pct_publico
FROM public.v_financiamento_candidatura
GROUP BY 1, 2, 3, 4;
