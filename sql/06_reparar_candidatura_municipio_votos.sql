-- Corrige candidaturas carregadas antes de MUNICIPIO e recalcula votos totais
-- a partir dos fatos já publicados. Não inventa municípios nem converte
-- ausência de voto em zero.
-- Executar uma vez no banco que já recebeu a carga TSE.

BEGIN;

DO $$
DECLARE
    municipios_atualizados integer;
    votos_atualizados integer;
BEGIN
    -- Em eleições municipais, SG_UE contém o código TSE do município. A
    -- associação é exata por código; candidaturas estaduais/nacionais ficam
    -- sem município.
    UPDATE candidatura c
       SET cd_municipio_tse = m.cd_municipio_tse
      FROM municipio m
     WHERE c.cd_municipio_tse IS NULL
       AND trim(c.sg_ue) ~ '^[0-9]+$'
       AND m.cd_municipio_tse = trim(c.sg_ue);
    GET DIAGNOSTICS municipios_atualizados = ROW_COUNT;

    -- QT_VOTOS_TOTAIS é o total nominal do primeiro turno. Para cargos
    -- estaduais, só somamos UFs integralmente presentes neste recorte. Para
    -- candidaturas municipais, o recorte contém o município da candidatura.
    -- Sem linha de votação, o campo permanece NULL, nunca vira zero.
    WITH totais AS (
        SELECT ano_eleicao, sq_candidato, cd_cargo,
               sum(qt_votos_nominais::bigint)::integer AS qt_votos
          FROM votacao_candidato_municipio
         WHERE nr_turno = 1
           AND qt_votos_nominais IS NOT NULL
         GROUP BY ano_eleicao, sq_candidato, cd_cargo
    )
    UPDATE candidatura c
       SET qt_votos_totais = t.qt_votos
      FROM totais t
     WHERE c.ano_eleicao = t.ano_eleicao
       AND c.sq_candidato = t.sq_candidato
       AND c.cd_cargo = t.cd_cargo
       AND (c.cd_municipio_tse IS NOT NULL
            OR upper(trim(c.sg_ue)) IN ('AC', 'AL', 'BA', 'DF', 'RO', 'SP'));
    GET DIAGNOSTICS votos_atualizados = ROW_COUNT;

    RAISE NOTICE 'Candidaturas com município associado: %', municipios_atualizados;
    RAISE NOTICE 'Totais de votos recalculados: %', votos_atualizados;
END;
$$;

-- A carga insere MUNICIPIO antes de CANDIDATURA; essa condição deve deixar de
-- ocorrer depois da correção. Se falhar, a transação inteira é desfeita.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM candidatura c
          JOIN municipio m ON m.cd_municipio_tse = trim(c.sg_ue)
         WHERE c.cd_municipio_tse IS NULL
           AND trim(c.sg_ue) ~ '^[0-9]+$'
    ) THEN
        RAISE EXCEPTION 'Ainda há candidaturas com SG_UE municipal sem município associado';
    END IF;
END;
$$;

-- Resultado da correção por tipo de circunscrição. Nulos em BR ou sem voto
-- publicado são esperados e permanecem explícitos.
SELECT CASE
           WHEN upper(trim(sg_ue)) = 'BR' THEN 'BR'
           WHEN trim(sg_ue) ~ '^[0-9]+$' THEN 'CODIGO_MUNICIPIO'
           ELSE 'UF_OU_OUTRO'
       END AS tipo_circunscricao,
       count(*) AS candidaturas,
       count(*) FILTER (WHERE cd_municipio_tse IS NULL) AS municipio_nulo,
       count(*) FILTER (WHERE qt_votos_totais IS NULL) AS votos_nulos
  FROM candidatura
 GROUP BY 1
 ORDER BY 1;

COMMIT;
