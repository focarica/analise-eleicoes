-- Q5 / P5 — Eleitos com a ajuda dos votos do partido (cargos proporcionais).
-- Banco BDR-TSE, schema public. Requer candidatura, votacao_partido e
-- votacao_candidato_municipio já carregadas.
--
-- Nas eleições proporcionais (vereador, deputado federal, estadual e distrital)
-- as cadeiras vão primeiro para os partidos, pela soma dos votos nominais dos
-- seus candidatos com os votos de legenda; depois, dentro de cada partido, para
-- os mais votados. Por isso um candidato pode se eleger com poucos votos próprios.
-- Duas réguas, uma linha por eleito:
--   eleito_abaixo_qe       votos nominais do eleito < quociente eleitoral da
--                          disputa: sozinho, não conquistaria a cadeira; dependeu
--                          dos votos de legenda e dos colegas de partido.
--   eleito_abaixo_legenda  votos nominais do eleito < votos de legenda do próprio
--                          partido na disputa (régua prevista no planejamento do grupo).
--
-- Unidade da disputa: o município para vereador; a UF para deputados.
-- Quociente eleitoral = votos válidos (nominais + legenda de todos os partidos, 1º
-- turno) ÷ cadeiras, desprezada a fração até meio e arredondada para cima acima de
-- meio (Código Eleitoral, art. 106). Cadeiras = eleitos da disputa na candidatura.
-- Em arquivos antigos do TSE o eleito pela média aparece só como 'MÉDIA'; ele conta
-- como eleito aqui. Até 2018 os partidos podiam se coligar na proporcional e a
-- cadeira era da coligação; a régua do quociente continua válida.

CREATE SCHEMA IF NOT EXISTS public;

CREATE OR REPLACE VIEW public.vw_questao_5_legenda AS
WITH eleitos AS (
    SELECT
        c.ano_eleicao, c.sq_candidato, c.id_pessoa_projeto, c.cd_cargo, c.ds_cargo,
        c.sg_partido, c.nm_urna_candidato,
        COALESCE(m.sg_uf, c.sg_ue) AS uf,
        CASE WHEN c.cd_cargo = 13 THEN c.cd_municipio_tse END AS cd_municipio_tse
    FROM public.candidatura c
    LEFT JOIN public.municipio m ON m.cd_municipio_tse = c.cd_municipio_tse
    WHERE c.cd_cargo IN (6, 7, 8, 13)
      AND c.ds_sit_tot_turno IN ('ELEITO', 'ELEITO POR QP', 'ELEITO POR MÉDIA', 'MÉDIA')
), vagas AS (
    SELECT ano_eleicao, cd_cargo, uf, cd_municipio_tse, COUNT(*) AS vagas
    FROM eleitos
    GROUP BY 1, 2, 3, 4
), partido_unidade AS (
    -- votos do partido na disputa (1º turno), somados nos municípios da unidade
    SELECT
        v.ano_eleicao, v.cd_cargo, m.sg_uf AS uf,
        CASE WHEN v.cd_cargo = 13 THEN v.cd_municipio_tse END AS cd_municipio_tse,
        v.sg_partido,
        SUM(COALESCE(v.qt_votos_nominais, 0)) AS nominais,
        SUM(COALESCE(v.qt_votos_legenda, 0)) AS legenda
    FROM public.votacao_partido v
    JOIN public.municipio m ON m.cd_municipio_tse = v.cd_municipio_tse
    WHERE v.nr_turno = 1 AND v.cd_cargo IN (6, 7, 8, 13)
    GROUP BY 1, 2, 3, 4, 5
), validos AS (
    SELECT ano_eleicao, cd_cargo, uf, cd_municipio_tse, SUM(nominais + legenda) AS votos_validos
    FROM partido_unidade
    GROUP BY 1, 2, 3, 4
), nominais AS (
    -- votos nominais do candidato no 1º turno, somados em todos os municípios
    SELECT ano_eleicao, sq_candidato, SUM(qt_votos_nominais) AS votos
    FROM public.votacao_candidato_municipio
    WHERE nr_turno = 1 AND cd_cargo IN (6, 7, 8, 13)
    GROUP BY 1, 2
), quociente AS (
    SELECT
        va.ano_eleicao, va.cd_cargo, va.uf, va.cd_municipio_tse, va.vagas, vl.votos_validos,
        CASE WHEN vl.votos_validos / va.vagas - FLOOR(vl.votos_validos / va.vagas) > 0.5
             THEN CEIL(vl.votos_validos / va.vagas)
             ELSE FLOOR(vl.votos_validos / va.vagas) END AS quociente_eleitoral
    FROM vagas va
    JOIN validos vl
      ON vl.ano_eleicao = va.ano_eleicao AND vl.cd_cargo = va.cd_cargo AND vl.uf = va.uf
     AND vl.cd_municipio_tse IS NOT DISTINCT FROM va.cd_municipio_tse
    WHERE vl.votos_validos > 0
)
SELECT
    e.ano_eleicao, e.uf, e.cd_municipio_tse, e.cd_cargo, e.ds_cargo, e.sg_partido,
    e.id_pessoa_projeto, e.sq_candidato, e.nm_urna_candidato,
    CAST(n.votos AS BIGINT) AS votos_nominais,
    CAST(q.votos_validos AS BIGINT) AS votos_validos_disputa,
    q.vagas,
    CAST(q.quociente_eleitoral AS BIGINT) AS quociente_eleitoral,
    CAST(p.legenda AS BIGINT) AS votos_legenda_partido,
    CAST(p.nominais + p.legenda AS BIGINT) AS votos_partido,
    ROUND(100.0 * n.votos / q.quociente_eleitoral, 1) AS pct_do_quociente,
    n.votos < q.quociente_eleitoral AS eleito_abaixo_qe,
    n.votos < p.legenda AS eleito_abaixo_legenda
FROM eleitos e
JOIN quociente q
  ON q.ano_eleicao = e.ano_eleicao AND q.cd_cargo = e.cd_cargo AND q.uf = e.uf
 AND q.cd_municipio_tse IS NOT DISTINCT FROM e.cd_municipio_tse
JOIN nominais n ON n.ano_eleicao = e.ano_eleicao AND n.sq_candidato = e.sq_candidato
LEFT JOIN partido_unidade p
  ON p.ano_eleicao = e.ano_eleicao AND p.cd_cargo = e.cd_cargo AND p.uf = e.uf
 AND p.cd_municipio_tse IS NOT DISTINCT FROM e.cd_municipio_tse AND p.sg_partido = e.sg_partido;
