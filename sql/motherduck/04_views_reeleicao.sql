-- P10a — Reeleição: eleitos → tentaram → reeleitos por cargo, estado e ciclo.
-- Banco BDR-TSE, schema public. Requer candidatura, candidato, municipio e
-- votacao_candidato_municipio já carregadas.
-- A ligação entre eleições usa o identificador de pessoa do projeto
-- (id_pessoa_projeto, derivado do título eleitoral), então nenhuma ligação
-- adicional por nome é necessária. Escopo: cargos titulares 3, 5, 6, 7, 8, 11, 13
-- (sem Vice/Suplente e sem Presidente). O ciclo de senador avança oito anos.

CREATE SCHEMA IF NOT EXISTS public;

CREATE OR REPLACE VIEW public.v_reeleicao_linhas AS
WITH base AS (
    SELECT
        c.id_pessoa_projeto,
        c.ano_eleicao,
        c.cd_cargo,
        COALESCE(m.sg_uf, c.sg_ue) AS uf,
        c.cd_municipio_tse,
        CASE WHEN c.ds_sit_tot_turno IN ('ELEITO', 'ELEITO POR QP', 'ELEITO POR MÉDIA') THEN 1 ELSE 0 END AS eleito
    FROM public.candidatura c
    LEFT JOIN public.municipio m ON m.cd_municipio_tse = c.cd_municipio_tse
    WHERE c.ds_sit_tot_turno IS NOT NULL
      AND c.cd_cargo IN (3, 5, 6, 7, 8, 11, 13)
),
pessoas AS (
    -- uma linha por pessoa × ano × cargo × unidade (posição eleita = máximo das candidaturas)
    SELECT id_pessoa_projeto, ano_eleicao, cd_cargo, uf, cd_municipio_tse,
           MAX(eleito) AS eleito
    FROM base
    GROUP BY 1, 2, 3, 4, 5
),
anos AS (
    SELECT DISTINCT cd_cargo, uf, cd_municipio_tse, ano_eleicao FROM pessoas
),
ciclos AS (
    SELECT
        a.cd_cargo, a.uf, a.cd_municipio_tse, a.ano_eleicao,
        a.ano_eleicao + CASE WHEN a.cd_cargo = 5 THEN 8 ELSE 4 END AS ano_disputa,
        EXISTS (
            SELECT 1 FROM anos n
            WHERE n.cd_cargo = a.cd_cargo AND n.uf = a.uf
              AND COALESCE(n.cd_municipio_tse, '') = COALESCE(a.cd_municipio_tse, '')
              AND n.ano_eleicao = a.ano_eleicao + CASE WHEN a.cd_cargo = 5 THEN 8 ELSE 4 END
        ) AS ha_proxima
    FROM anos a
),
contagem AS (
    SELECT
        p.cd_cargo, p.uf, p.cd_municipio_tse,
        c.ano_eleicao AS ano_eleito, c.ano_disputa, c.ha_proxima,
        COUNT(*) AS eleitos,
        COUNT(t.id_pessoa_projeto) AS tentaram,
        COALESCE(SUM(t.eleito), 0) AS reeleitos
    FROM pessoas p
    JOIN ciclos c
      ON c.cd_cargo = p.cd_cargo AND c.uf = p.uf
     AND COALESCE(c.cd_municipio_tse, '') = COALESCE(p.cd_municipio_tse, '')
     AND c.ano_eleicao = p.ano_eleicao
    LEFT JOIN pessoas t
      ON t.id_pessoa_projeto = p.id_pessoa_projeto
     AND t.cd_cargo = p.cd_cargo
     AND COALESCE(t.cd_municipio_tse, '') = COALESCE(p.cd_municipio_tse, '')
     AND t.uf = p.uf
     AND t.ano_eleicao = c.ano_disputa
    WHERE p.eleito = 1
    GROUP BY 1, 2, 3, 4, 5, 6
)
SELECT
    cd_cargo, uf, cd_municipio_tse, ano_eleito, ano_disputa, ha_proxima,
    eleitos, tentaram, reeleitos,
    CASE WHEN tentaram > 0 THEN ROUND(100.0 * reeleitos / tentaram, 1) END AS taxa
FROM contagem;

-- Pessoas de um ciclo (eleitos em ano_eleito classificados pelo que fizeram na disputa):
-- grupo = voltou (reeleito) | perderam (tentou e não foi eleito) | nao (não tentou).
-- Somente ciclos com a eleição seguinte dentro do escopo carregado (senador eleito
-- em 2018 disputa 2026, fora da amostra: não entra).
CREATE OR REPLACE VIEW public.v_reeleicao_pessoas AS
WITH base AS (
    SELECT
        c.id_pessoa_projeto, c.ano_eleicao, c.cd_cargo,
        COALESCE(m.sg_uf, c.sg_ue) AS uf,
        c.cd_municipio_tse,
        CASE WHEN c.ds_sit_tot_turno IN ('ELEITO', 'ELEITO POR QP', 'ELEITO POR MÉDIA') THEN 1 ELSE 0 END AS eleito
    FROM public.candidatura c
    LEFT JOIN public.municipio m ON m.cd_municipio_tse = c.cd_municipio_tse
    WHERE c.ds_sit_tot_turno IS NOT NULL
      AND c.cd_cargo IN (3, 5, 6, 7, 8, 11, 13)
),
pessoas AS (
    SELECT id_pessoa_projeto, ano_eleicao, cd_cargo, uf, cd_municipio_tse, MAX(eleito) AS eleito
    FROM base GROUP BY 1, 2, 3, 4, 5
),
anos AS (
    SELECT DISTINCT cd_cargo, uf, cd_municipio_tse, ano_eleicao FROM pessoas
),
disputa AS (
    SELECT id_pessoa_projeto, cd_cargo, uf, cd_municipio_tse, ano_eleicao, eleito
    FROM pessoas
),
eleitos_ano AS (
    SELECT e.*
    FROM pessoas e
    WHERE e.eleito = 1
      AND EXISTS (
          SELECT 1 FROM anos n
          WHERE n.cd_cargo = e.cd_cargo AND n.uf = e.uf
            AND COALESCE(n.cd_municipio_tse, '') = COALESCE(e.cd_municipio_tse, '')
            AND n.ano_eleicao = e.ano_eleicao + CASE WHEN e.cd_cargo = 5 THEN 8 ELSE 4 END
      )
)
SELECT
    e.id_pessoa_projeto,
    e.cd_cargo,
    e.uf,
    e.cd_municipio_tse,
    e.ano_eleicao AS ano_eleito,
    e.ano_eleicao + CASE WHEN e.cd_cargo = 5 THEN 8 ELSE 4 END AS ano_disputa,
    CAST(e.ano_eleicao AS VARCHAR) AS ano_foto,
    f.sq_candidato,
    f.nm_urna_candidato,
    f.sg_partido,
    f.nm_municipio,
    COALESCE(v.votos, 0) AS votos,
    CASE
        WHEN d.id_pessoa_projeto IS NULL THEN 'nao'
        WHEN d.eleito = 1 THEN 'voltou'
        ELSE 'perderam'
    END AS grupo
FROM eleitos_ano e
LEFT JOIN disputa d
  ON d.id_pessoa_projeto = e.id_pessoa_projeto
 AND d.cd_cargo = e.cd_cargo
 AND COALESCE(d.cd_municipio_tse, '') = COALESCE(e.cd_municipio_tse, '')
 AND d.uf = e.uf
 AND d.ano_eleicao = e.ano_eleicao + CASE WHEN e.cd_cargo = 5 THEN 8 ELSE 4 END
LEFT JOIN LATERAL (
    -- candidatura do ano eleito usada nos retratos e na urna da ficha
    SELECT c.sq_candidato, c.nm_urna_candidato, c.sg_partido, m2.nm_municipio
    FROM public.candidatura c
    LEFT JOIN public.municipio m2 ON m2.cd_municipio_tse = c.cd_municipio_tse
    WHERE c.id_pessoa_projeto = e.id_pessoa_projeto
      AND c.ano_eleicao = e.ano_eleicao
      AND c.cd_cargo = e.cd_cargo
      AND COALESCE(c.cd_municipio_tse, '') = COALESCE(e.cd_municipio_tse, '')
    ORDER BY c.sq_candidato
    LIMIT 1
) f ON TRUE
LEFT JOIN (
    SELECT ano_eleicao, sq_candidato, SUM(qt_votos_nominais) AS votos
    FROM public.votacao_candidato_municipio
    WHERE nr_turno = 1
    GROUP BY 1, 2
) v ON v.ano_eleicao = e.ano_eleicao AND v.sq_candidato = f.sq_candidato;
