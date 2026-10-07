-- Views analíticas do modelo TSE para DuckDB/MotherDuck.
-- Pré-requisito: as 11 tabelas do DER já devem estar no schema public
-- do banco BDR-TSE.
-- Execute conectado ao banco BDR-TSE.

CREATE SCHEMA IF NOT EXISTS public;

CREATE OR REPLACE VIEW public.v_partidos_eleitos AS
SELECT
    c.ano_eleicao,
    COALESCE(m.sg_uf, c.sg_ue) AS uf,
    c.nr_partido,
    c.sg_partido,
    CASE WHEN p.sg_partido = c.sg_partido THEN p.nm_partido END AS nm_partido,
    c.ds_cargo,
    COUNT(*) AS qt_eleitos
FROM public.candidatura c
LEFT JOIN public.municipio m
    ON m.cd_municipio_tse = c.cd_municipio_tse
LEFT JOIN public.partido p
    ON p.nr_partido = c.nr_partido
WHERE c.ds_sit_tot_turno IN ('ELEITO', 'ELEITO POR QP', 'ELEITO POR MÉDIA')
  AND c.ds_cargo NOT LIKE '%VICE%'
  AND c.ds_cargo NOT LIKE '%SUPLENTE%'
GROUP BY 1, 2, 3, 4, 5, 6;

-- Mantém a view existente usada pelo mapa. As quatro faixas são intervalos
-- iguais em reais (WIDTH_BUCKET), e não quartis por quantidade de candidatos.
CREATE OR REPLACE VIEW public.v_gasto_sucesso AS
WITH gastos_candidato AS (
    SELECT ano_eleicao, sq_candidato, SUM(vr_pago) AS total_gasto
    FROM public.despesas_pagas
    GROUP BY ano_eleicao, sq_candidato
),
base_candidatos AS (
    SELECT
        c.ano_eleicao,
        COALESCE(m.sg_uf, c.sg_ue) AS uf,
        c.ds_cargo,
        c.sq_candidato,
        CASE
            WHEN c.ds_sit_tot_turno IN ('ELEITO', 'ELEITO POR QP', 'ELEITO POR MÉDIA') THEN 1
            ELSE 0
        END AS flag_eleito,
        g.total_gasto,
        MAX(g.total_gasto) OVER (
            PARTITION BY c.ano_eleicao, COALESCE(m.sg_uf, c.sg_ue), c.ds_cargo
        ) AS teto_maximo_cargo_ano
    FROM public.candidatura c
    LEFT JOIN public.municipio m
        ON c.cd_municipio_tse = m.cd_municipio_tse
    INNER JOIN gastos_candidato g
        USING (ano_eleicao, sq_candidato)
    WHERE c.ds_cargo NOT LIKE '%VICE%'
      AND c.ds_cargo NOT LIKE '%SUPLENTE%'
      AND c.ds_sit_tot_turno NOT IN (
          'INDEFERIDO', 'CASSADO', 'FALECIDO', 'CANCELADO',
          'NÃO CONHECIDO', 'RENÚNCIA'
      )
      AND c.ds_sit_tot_turno IS NOT NULL
),
faixas_gasto AS (
    SELECT
        *,
        CASE
            WHEN total_gasto < 0 THEN 0
            WHEN total_gasto >= teto_maximo_cargo_ano + 0.01 THEN 5
            ELSE CAST(FLOOR(total_gasto * 4 / (teto_maximo_cargo_ano + 0.01)) AS INTEGER) + 1
        END AS faixa_financeira
    FROM base_candidatos
)
SELECT
    ano_eleicao,
    uf,
    ds_cargo,
    faixa_financeira,
    ROUND((MAX(teto_maximo_cargo_ano) + 0.01) * (faixa_financeira - 1) / 4, 2)
        AS limite_inferior_faixa,
    ROUND((MAX(teto_maximo_cargo_ano) + 0.01) * faixa_financeira / 4, 2)
        AS limite_superior_faixa,
    CAST(MIN(total_gasto) AS DECIMAL(14, 2)) AS piso_faixa,
    CAST(MAX(total_gasto) AS DECIMAL(14, 2)) AS teto_faixa,
    COUNT(*) AS qtd_candidatos_na_faixa,
    SUM(flag_eleito) AS qtd_eleitos,
    ROUND(SUM(flag_eleito)::DECIMAL / COUNT(*) * 100, 2) AS taxa_sucesso_pct,
    ROUND(AVG(total_gasto) FILTER (WHERE flag_eleito = 1), 2) AS media_gasto_eleitos,
    ROUND(AVG(total_gasto) FILTER (WHERE flag_eleito = 0), 2) AS media_gasto_nao_eleitos,
    CAST(quantile_cont(total_gasto, 0.5) FILTER (WHERE flag_eleito = 1) AS DECIMAL(14, 2))
        AS mediana_gasto_eleitos,
    CAST(quantile_cont(total_gasto, 0.5) FILTER (WHERE flag_eleito = 0) AS DECIMAL(14, 2))
        AS mediana_gasto_nao_eleitos
FROM faixas_gasto
GROUP BY ano_eleicao, uf, ds_cargo, faixa_financeira;

-- View oficial da Questão 2, conforme definição validada pelo grupo.
-- Mantém a saída usada no HTML e deriva da regra financeira acima.
CREATE OR REPLACE VIEW public.vw_questao_2_despesas AS
SELECT
    ano_eleicao,
    uf,
    ds_cargo,
    faixa_financeira,
    piso_faixa AS "piso_faixa_r$",
    teto_faixa AS "teto_faixa_r$",
    qtd_candidatos_na_faixa,
    qtd_eleitos,
    taxa_sucesso_pct,
    media_gasto_eleitos,
    media_gasto_nao_eleitos,
    mediana_gasto_eleitos,
    mediana_gasto_nao_eleitos
FROM public.v_gasto_sucesso;

-- Histórico por candidatura. JSON/JSONB PostgreSQL é representado como JSON
-- DuckDB; list(...) preserva o conteúdo aninhado consumido pela interface.
CREATE OR REPLACE VIEW public.v_historico_candidato AS
WITH receita_linhas AS (
    SELECT
        rc.ano_eleicao,
        rc.sq_candidato,
        rc.ds_fonte_receita AS fonte,
        COALESCE(
            NULLIF(rc.tp_origem_recurso, ''),
            CASE
                WHEN rc.ds_fonte_receita IN ('FUNDO ESPECIAL', 'FUNDO PARTIDARIO') THEN 'PÚBLICO'
                WHEN rc.ds_fonte_receita = 'OUTROS RECURSOS' THEN 'PRIVADO'
                ELSE 'INDEFINIDO'
            END
        ) AS origem,
        SUM(rc.vr_receita) AS valor,
        COUNT(*) AS qtd
    FROM public.receitas_campanha rc
    GROUP BY 1, 2, 3, 4
),
receitas AS (
    SELECT
        ano_eleicao,
        sq_candidato,
        SUM(valor) AS total_receitas,
        SUM(valor) FILTER (WHERE origem = 'PÚBLICO') AS receitas_publicas,
        SUM(valor) FILTER (WHERE origem = 'PRIVADO') AS receitas_privadas,
        TO_JSON(LIST(
            STRUCT_PACK(fonte := fonte, origem := origem, valor := valor, qtd := qtd)
            ORDER BY valor DESC
        )) AS receitas
    FROM receita_linhas
    GROUP BY 1, 2
),
despesa_linhas AS (
    SELECT
        dp.ano_eleicao,
        dp.sq_candidato,
        dp.ds_despesa,
        dp.vr_pago,
        ROW_NUMBER() OVER (
            PARTITION BY dp.ano_eleicao, dp.sq_candidato
            ORDER BY dp.vr_pago DESC NULLS LAST
        ) AS rn
    FROM public.despesas_pagas dp
),
despesas AS (
    SELECT
        ano_eleicao,
        sq_candidato,
        SUM(vr_pago) AS total_despesas,
        COUNT(*) AS qt_despesas,
        TO_JSON(LIST(
            STRUCT_PACK(despesa := ds_despesa, valor := vr_pago)
            ORDER BY vr_pago DESC NULLS LAST
        ) FILTER (WHERE rn <= 8)) AS despesas
    FROM despesa_linhas
    GROUP BY 1, 2
),
bens AS (
    SELECT
        bd.ano_eleicao,
        bd.sq_candidato,
        SUM(bd.vr_bem) AS total_bens,
        TO_JSON(LIST(
            STRUCT_PACK(
                tipo := bd.ds_tipo_bem,
                descricao := NULLIF(bd.ds_bem, '#NULO#'),
                valor := bd.vr_bem
            ) ORDER BY bd.vr_bem DESC NULLS LAST
        )) AS bens
    FROM public.bens_declarados bd
    GROUP BY 1, 2
)
SELECT
    c.id_pessoa_projeto,
    c.ano_eleicao,
    c.sq_candidato,
    ca.nm_candidato,
    c.nm_urna_candidato,
    c.sg_partido AS partido,
    c.ds_cargo AS cargo,
    COALESCE(m.sg_uf, c.sg_ue) AS uf,
    c.cd_municipio_tse AS municipio,
    m.nm_municipio,
    c.nr_turno_resultado AS turno,
    c.ds_sit_tot_turno AS situacao,
    c.qt_votos_totais AS votos,
    COALESCE(r.total_receitas, 0) AS total_receitas,
    COALESCE(r.receitas_publicas, 0) AS receitas_publicas,
    COALESCE(r.receitas_privadas, 0) AS receitas_privadas,
    COALESCE(r.receitas, '[]'::JSON) AS receitas,
    COALESCE(d.total_despesas, 0) AS total_despesas,
    COALESCE(d.qt_despesas, 0) AS qt_despesas,
    COALESCE(d.despesas, '[]'::JSON) AS despesas,
    COALESCE(b.total_bens, 0) AS patrimonio_declarado,
    COALESCE(b.bens, '[]'::JSON) AS bens
FROM public.candidatura c
JOIN public.candidato ca
    ON ca.id_pessoa_projeto = c.id_pessoa_projeto
LEFT JOIN public.municipio m
    ON m.cd_municipio_tse = c.cd_municipio_tse
LEFT JOIN receitas r
    USING (ano_eleicao, sq_candidato)
LEFT JOIN despesas d
    USING (ano_eleicao, sq_candidato)
LEFT JOIN bens b
    USING (ano_eleicao, sq_candidato);
