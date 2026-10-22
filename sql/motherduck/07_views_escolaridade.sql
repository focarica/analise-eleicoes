-- Q4 / P4 — Escolaridade dos candidatos e eleitos × escolaridade da população.
-- Banco BDR-TSE, schema public. Requer candidatura, candidato, municipio,
-- escolaridade_populacao_municipio (Censo 2022, IBGE, carregada por
-- 10_censo_2022_escolaridade.sql) e vw_municipio_ibge (06_municipio_ibge.sql).
-- O código IBGE do município vem de municipio.cd_municipio_ibge, que a carga do
-- Censo preenche com a correspondência oficial do TSE; se a tabela municipio
-- for recarregada (a coluna volta nula), vale a reserva vw_municipio_ibge.
--
-- Lado político: CANDIDATO.ds_grau_instrucao das candidaturas a prefeito e
-- vereador (titulares) registradas no município, com a parcela de eleitos.
-- Lado da população: pessoas de 18 anos ou mais por nível de instrução no
-- Censo (o ano mais recente de escolaridade_populacao_municipio).
--
-- O Censo usa quatro níveis; os sete do TSE são agrupados neles:
--   1 Sem instrução e fundamental incompleto  (analfabeto, lê e escreve, fundamental incompleto)
--   2 Fundamental completo e médio incompleto
--   3 Médio completo e superior incompleto
--   4 Superior completo
-- "Não informado", "não divulgável" e "não determinado" ficam numa linha à parte
-- (nr_nivel nulo) e fora das porcentagens; linhas de total do Censo são ignoradas.
--
-- Uma linha por município, ano de eleição, cargo e nível; ds_cargo = 'TODOS'
-- soma prefeito e vereador. O Censo é de 2022: compare com as eleições mais
-- próximas (2020 e 2024). qt_populacao se repete em cada ano e cargo: não some
-- entre anos ou cargos.

CREATE SCHEMA IF NOT EXISTS public;

CREATE OR REPLACE VIEW public.vw_questao_4_escolaridade AS
WITH niveis(nr_nivel, ds_nivel) AS (
    VALUES (1, 'Sem instrução e fundamental incompleto'),
           (2, 'Fundamental completo e médio incompleto'),
           (3, 'Médio completo e superior incompleto'),
           (4, 'Superior completo')
), candidaturas AS (
    SELECT c.cd_municipio_tse, c.ano_eleicao, c.ds_cargo, ca.ds_grau_instrucao AS grau,
           CASE WHEN c.ds_sit_tot_turno IN ('ELEITO', 'ELEITO POR QP', 'ELEITO POR MÉDIA', 'MÉDIA')
                THEN 1 ELSE 0 END AS eleito
    FROM public.candidatura c
    JOIN public.candidato ca ON ca.id_pessoa_projeto = c.id_pessoa_projeto
    WHERE c.cd_cargo IN (11, 13)
      AND c.cd_municipio_tse IS NOT NULL
      AND c.ds_sit_tot_turno IS NOT NULL
), cand_por_grau AS (
    SELECT cd_municipio_tse, ano_eleicao, COALESCE(ds_cargo, 'TODOS') AS ds_cargo, grau,
           COUNT(*) AS qt_candidatos, SUM(eleito) AS qt_eleitos
    FROM candidaturas
    GROUP BY GROUPING SETS ((cd_municipio_tse, ano_eleicao, ds_cargo, grau),
                            (cd_municipio_tse, ano_eleicao, grau))
), ponte AS (
    SELECT m.cd_municipio_tse, COALESCE(m.cd_municipio_ibge, mi.cd_municipio_ibge) AS cd_municipio_ibge
    FROM public.municipio m
    LEFT JOIN public.vw_municipio_ibge mi ON mi.cd_municipio_tse = m.cd_municipio_tse
), censo AS (
    SELECT MAX(ano_referencia) AS ano FROM public.escolaridade_populacao_municipio
), pop_por_grau AS (
    SELECT pt.cd_municipio_tse, e.ds_nivel_instrucao AS grau, SUM(e.qt_pessoas) AS qt_pessoas
    FROM public.escolaridade_populacao_municipio e
    JOIN ponte pt
      ON LEFT(CAST(e.cd_municipio_ibge AS VARCHAR), 6) = LEFT(CAST(pt.cd_municipio_ibge AS VARCHAR), 6)
    WHERE e.ano_referencia = (SELECT ano FROM censo)
      AND UPPER(strip_accents(TRIM(e.ds_nivel_instrucao))) NOT LIKE '%TOTAL%'
    GROUP BY 1, 2
), graus AS (
    SELECT grau,
           CASE
               WHEN g LIKE '%SEM INSTRU%' OR g IN ('ANALFABETO', 'LE E ESCREVE')
                    OR g LIKE '%FUNDAMENTAL INCOMPLETO%' THEN 1
               WHEN g LIKE '%FUNDAMENTAL COMPLETO%' OR g LIKE '%MEDIO INCOMPLETO%' THEN 2
               WHEN g LIKE '%MEDIO COMPLETO%' OR g LIKE '%SUPERIOR INCOMPLETO%' THEN 3
               WHEN g LIKE '%SUPERIOR COMPLETO%' THEN 4
           END AS nr_nivel
    FROM (
        SELECT DISTINCT grau, UPPER(strip_accents(TRIM(grau))) AS g
        FROM (SELECT grau FROM cand_por_grau UNION SELECT grau FROM pop_por_grau)
    )
), cand AS (
    SELECT p.cd_municipio_tse, p.ano_eleicao, p.ds_cargo, g.nr_nivel,
           SUM(p.qt_candidatos) AS qt_candidatos, SUM(p.qt_eleitos) AS qt_eleitos
    FROM cand_por_grau p LEFT JOIN graus g ON g.grau IS NOT DISTINCT FROM p.grau
    GROUP BY 1, 2, 3, 4
), pop AS (
    SELECT p.cd_municipio_tse, g.nr_nivel, SUM(p.qt_pessoas) AS qt_populacao
    FROM pop_por_grau p LEFT JOIN graus g ON g.grau IS NOT DISTINCT FROM p.grau
    GROUP BY 1, 2
), pop_total AS (
    SELECT cd_municipio_tse FROM pop GROUP BY 1
), recortes AS (
    SELECT DISTINCT cd_municipio_tse, ano_eleicao, ds_cargo FROM cand
), grade AS (
    -- os quatro níveis sempre; "não informado" só quando existe
    SELECT r.cd_municipio_tse, r.ano_eleicao, r.ds_cargo, n.nr_nivel, n.ds_nivel
    FROM recortes r CROSS JOIN niveis n
    UNION ALL
    SELECT r.cd_municipio_tse, r.ano_eleicao, r.ds_cargo, NULL, 'Não informado'
    FROM recortes r
    WHERE EXISTS (SELECT 1 FROM cand c WHERE c.nr_nivel IS NULL
                    AND c.cd_municipio_tse = r.cd_municipio_tse AND c.ano_eleicao = r.ano_eleicao
                    AND c.ds_cargo = r.ds_cargo)
       OR EXISTS (SELECT 1 FROM pop p WHERE p.nr_nivel IS NULL AND p.cd_municipio_tse = r.cd_municipio_tse)
), base AS (
    SELECT g.*,
           CAST(COALESCE(c.qt_candidatos, 0) AS BIGINT) AS qt_candidatos,
           CAST(COALESCE(c.qt_eleitos, 0) AS BIGINT) AS qt_eleitos,
           -- 0 quando o município está no Censo mas sem ninguém no nível; NULL sem Censo
           CAST(CASE WHEN t.cd_municipio_tse IS NOT NULL THEN COALESCE(p.qt_populacao, 0) END AS BIGINT) AS qt_populacao
    FROM grade g
    LEFT JOIN cand c ON c.cd_municipio_tse = g.cd_municipio_tse AND c.ano_eleicao = g.ano_eleicao
                    AND c.ds_cargo = g.ds_cargo AND c.nr_nivel IS NOT DISTINCT FROM g.nr_nivel
    LEFT JOIN pop p ON p.cd_municipio_tse = g.cd_municipio_tse AND p.nr_nivel IS NOT DISTINCT FROM g.nr_nivel
    LEFT JOIN pop_total t ON t.cd_municipio_tse = g.cd_municipio_tse
), parcelas AS (
    SELECT b.*,
           CASE WHEN b.nr_nivel IS NOT NULL THEN ROUND(100.0 * b.qt_candidatos / NULLIF(SUM(b.qt_candidatos)
               FILTER (WHERE b.nr_nivel IS NOT NULL) OVER w, 0), 2) END AS pct_candidatos,
           CASE WHEN b.nr_nivel IS NOT NULL THEN ROUND(100.0 * b.qt_eleitos / NULLIF(SUM(b.qt_eleitos)
               FILTER (WHERE b.nr_nivel IS NOT NULL) OVER w, 0), 2) END AS pct_eleitos,
           CASE WHEN b.nr_nivel IS NOT NULL THEN ROUND(100.0 * b.qt_populacao / NULLIF(SUM(b.qt_populacao)
               FILTER (WHERE b.nr_nivel IS NOT NULL) OVER w, 0), 2) END AS pct_populacao
    FROM base b
    WINDOW w AS (PARTITION BY b.cd_municipio_tse, b.ano_eleicao, b.ds_cargo)
)
SELECT p.ano_eleicao, (SELECT ano FROM censo) AS ano_censo,
       m.sg_uf, p.cd_municipio_tse, m.nm_municipio, p.ds_cargo,
       p.nr_nivel, p.ds_nivel,
       p.qt_candidatos, p.qt_eleitos, p.qt_populacao,
       p.pct_candidatos, p.pct_eleitos, p.pct_populacao,
       -- quantas vezes a parcela do nível entre candidatos/eleitos é a parcela na população
       ROUND(p.pct_candidatos / NULLIF(p.pct_populacao, 0), 2) AS razao_candidatos_populacao,
       ROUND(p.pct_eleitos / NULLIF(p.pct_populacao, 0), 2) AS razao_eleitos_populacao
FROM parcelas p
JOIN public.municipio m ON m.cd_municipio_tse = p.cd_municipio_tse;
