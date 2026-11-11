-- Q7 / P7 — Viés político de um município/região na linha do tempo.
-- Banco BDR-TSE, schema public. Requer votacao_partido, partido e candidatura
-- carregados e sql/motherduck/14_vies_partidos.sql já aplicado.
--
-- Viés de um partido = (média das notas dos especialistas - 5) * 20, de -100
-- (esquerda) a +100 (direita). Fonte: Bolognesi et al., Harvard Dataverse,
-- doi:10.7910/DVN/MFIXKW, ondas de 2018 e 2022. Cada eleição usa a onda mais
-- recente que não é posterior ao pleito; 2024 usa a de 2022, estendida por dois
-- anos (a interface deve avisar).
--
-- Viés do município numa eleição: dentro de cada cargo, média dos partidos
-- ponderada pelos votos válidos (nominais + legenda, 1º turno); depois, média
-- simples entre os cargos. Partido sem valor não entra na média, mas entra na
-- cobertura. Só entram os códigos das eleições regulares de vies_onda_eleicao;
-- eleições suplementares não são somadas ao pleito regular. Sem cargo com valor, vies é NULL (nunca 0).

CREATE OR REPLACE VIEW public.vw_questao_7_vies AS
WITH base AS (
    SELECT
        v.ano_eleicao,
        v.cd_municipio_tse,
        v.cd_cargo,
        r.onda,
        r.onda_estendida,
        SUM(COALESCE(v.qt_votos_nominais, 0) + COALESCE(v.qt_votos_legenda, 0)) AS votos,
        SUM(COALESCE(v.qt_votos_nominais, 0) + COALESCE(v.qt_votos_legenda, 0))
            FILTER (WHERE o.media IS NOT NULL) AS votos_com_vies,
        SUM((COALESCE(v.qt_votos_nominais, 0) + COALESCE(v.qt_votos_legenda, 0)) * o.vies)
            FILTER (WHERE o.media IS NOT NULL) AS votos_x_vies
    FROM public.votacao_partido v
    JOIN public.vies_onda_eleicao r
      ON r.ano_eleicao = v.ano_eleicao
     AND list_contains(r.cargos, v.cd_cargo)
     AND list_contains(r.eleicoes, v.cd_eleicao)
    LEFT JOIN public.vies_partido_onda o
      ON o.ano_eleicao = v.ano_eleicao
     AND o.nr_partido = v.nr_partido
     AND o.sg_partido = v.sg_partido
    WHERE v.nr_turno = 1
    GROUP BY 1, 2, 3, 4, 5
    HAVING SUM(COALESCE(v.qt_votos_nominais, 0) + COALESCE(v.qt_votos_legenda, 0)) > 0
), por_cargo AS (
    SELECT *, votos_x_vies / NULLIF(votos_com_vies, 0) AS vies_cargo
    FROM base
)
SELECT
    ano_eleicao,
    cd_municipio_tse,
    AVG(vies_cargo) AS vies,
    ROUND(100.0 * COALESCE(SUM(votos_com_vies), 0) / SUM(votos), 2) AS cobertura,
    COUNT(*) FILTER (WHERE vies_cargo IS NOT NULL) AS n_cargos,
    MAX(onda) AS onda,
    BOOL_OR(onda_estendida) AS onda_estendida
FROM por_cargo
GROUP BY 1, 2;
