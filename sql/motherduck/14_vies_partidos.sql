-- P7 — Viés político dos partidos (Bolognesi et al., Harvard Dataverse,
-- doi:10.7910/DVN/MFIXKW). Arquivo autossuficiente para o administrador do
-- BDR-TSE: não depende de Python, CSV nem de outra tabela além das do modelo.
--
-- Ordem de execução: 1) este arquivo; 2) 15_views_vies.sql (view por município).
--
-- O que este arquivo faz:
--   1. cria vies_onda_eleicao e vies_partido_onda e grava os valores resolvidos;
--   2. converte partido.vies_politico e candidatura.vies_politico_eleicao de
--      VARCHAR para DOUBLE (hoje estão inteiramente vazias);
--   3. preenche as duas colunas a partir das tabelas acima.
--
-- Escopo: eleições de 2018 a 2024. Anos anteriores a 2018 e a eleição de 2026
-- ficam com NULL — não há onda do survey que cubra esses pleitos.
--
-- Escala: viés = (média das notas de 0 a 10 − 5) × 20, de −100 (esquerda) a
-- +100 (direita). Ondas: 2018 e 2020 usam a onda de 2018; 2022 e 2024, a de
-- 2022. 2024 é a onda de 2022 estendida por dois anos e está marcada em
-- onda_estendida. Renomeações herdam o valor; fusões usam a média dos
-- componentes que têm valor; sem valor é NULL, nunca 0.
--
-- Reexecutável: as duas tabelas são recriadas e as colunas zeradas antes do
-- preenchimento.

BEGIN;

CREATE OR REPLACE TABLE public.vies_onda_eleicao (
    ano_eleicao INTEGER PRIMARY KEY,
    onda SMALLINT NOT NULL,
    onda_estendida BOOLEAN NOT NULL,
    cargos INTEGER[] NOT NULL,
    observacao VARCHAR
);

CREATE OR REPLACE TABLE public.vies_partido_onda (
    ano_eleicao INTEGER NOT NULL,
    nr_partido INTEGER NOT NULL,
    sg_partido VARCHAR NOT NULL,
    onda SMALLINT NOT NULL,
    media DOUBLE CHECK (media BETWEEN 0 AND 10),
    vies DOUBLE,
    origem VARCHAR NOT NULL,
    PRIMARY KEY (ano_eleicao, nr_partido, sg_partido)
);

INSERT INTO public.vies_onda_eleicao (ano_eleicao, onda, onda_estendida, cargos, observacao) VALUES
    (2018, 2018, FALSE, [1, 3, 5, 6, 7, 8], 'presidente, governador, senador, deputados federal, estadual e distrital'),
    (2020, 2018, FALSE, [11, 13], 'prefeito e vereador'),
    (2022, 2022, FALSE, [1, 3, 5, 6, 7, 8], 'presidente, governador, senador, deputados federal, estadual e distrital'),
    (2024, 2022, TRUE, [11, 13], 'prefeito e vereador; onda 2022 estendida por dois anos');

INSERT INTO public.vies_partido_onda (ano_eleicao, nr_partido, sg_partido, onda, media, vies, origem) VALUES
    (2018, 10, 'PRB', 2018, 7.78, 55.6, 'direto'),
    (2018, 11, 'PP', 2018, 8.2, 64.0, 'direto'),
    (2018, 12, 'PDT', 2018, 3.93, -21.4, 'direto'),
    (2018, 13, 'PT', 2018, 2.97, -40.6, 'direto'),
    (2018, 14, 'PTB', 2018, 6.1, 22.0, 'direto'),
    (2018, 15, 'MDB', 2018, 7.02, 40.4, 'direto'),
    (2018, 16, 'PSTU', 2018, 0.51, -89.8, 'direto'),
    (2018, 17, 'PSL', 2018, 8.11, 62.2, 'direto'),
    (2018, 18, 'REDE', 2018, 4.77, -4.6, 'direto'),
    (2018, 19, 'PODE', 2018, 7.24, 44.8, 'direto'),
    (2018, 20, 'PSC', 2018, 8.33, 66.6, 'direto'),
    (2018, 21, 'PCB', 2018, 0.91, -81.8, 'direto'),
    (2018, 22, 'PR', 2018, 7.78, 55.6, 'direto'),
    (2018, 23, 'PPS', 2018, 4.93, -1.4, 'direto'),
    (2018, 25, 'DEM', 2018, 8.57, 71.4, 'direto'),
    (2018, 27, 'DC', 2018, 8.11, 62.2, 'direto'),
    (2018, 28, 'PRTB', 2018, 7.45, 49.0, 'direto'),
    (2018, 29, 'PCO', 2018, 0.61, -87.8, 'direto'),
    (2018, 30, 'NOVO', 2018, 8.13, 62.6, 'direto'),
    (2018, 31, 'PHS', 2018, 6.96, 39.2, 'direto'),
    (2018, 33, 'PMN', 2018, 6.88, 37.6, 'direto'),
    (2018, 35, 'PMB', 2018, 6.9, 38.0, 'direto'),
    (2018, 36, 'PTC', 2018, 7.86, 57.2, 'direto'),
    (2018, 40, 'PSB', 2018, 4.05, -19.0, 'direto'),
    (2018, 43, 'PV', 2018, 5.29, 5.8, 'direto'),
    (2018, 44, 'PRP', 2018, 7.6, 52.0, 'direto'),
    (2018, 45, 'PSDB', 2018, 7.11, 42.2, 'direto'),
    (2018, 50, 'PSOL', 2018, 1.28, -74.4, 'direto'),
    (2018, 51, 'PATRI', 2018, 8.55, 71.0, 'direto'),
    (2018, 51, 'PATRIOTA', 2018, 8.55, 71.0, 'renomeado de PATRI'),
    (2018, 54, 'PPL', 2018, 7.27, 45.4, 'direto'),
    (2018, 55, 'PSD', 2018, 7.09, 41.8, 'direto'),
    (2018, 65, 'PC do B', 2018, 1.92, -61.6, 'direto'),
    (2018, 70, 'AVANTE', 2018, 6.32, 26.4, 'direto'),
    (2018, 77, 'SOLIDARIEDADE', 2018, 6.5, 30.0, 'direto'),
    (2018, 90, 'PROS', 2018, 7.47, 49.4, 'direto'),
    (2020, 10, 'REPUBLICANOS', 2018, 7.78, 55.6, 'renomeado de PRB'),
    (2020, 11, 'PP', 2018, 8.2, 64.0, 'direto'),
    (2020, 12, 'PDT', 2018, 3.93, -21.4, 'direto'),
    (2020, 13, 'PT', 2018, 2.97, -40.6, 'direto'),
    (2020, 14, 'PTB', 2018, 6.1, 22.0, 'direto'),
    (2020, 15, 'MDB', 2018, 7.02, 40.4, 'direto'),
    (2020, 16, 'PSTU', 2018, 0.51, -89.8, 'direto'),
    (2020, 17, 'PSL', 2018, 8.11, 62.2, 'direto'),
    (2020, 18, 'REDE', 2018, 4.77, -4.6, 'direto'),
    (2020, 19, 'PODE', 2018, 7.1, 42.0, 'média de PODE e PHS (fusão de 2019)'),
    (2020, 20, 'PSC', 2018, 8.33, 66.6, 'direto'),
    (2020, 21, 'PCB', 2018, 0.91, -81.8, 'direto'),
    (2020, 22, 'PL', 2018, 7.78, 55.6, 'renomeado de PR'),
    (2020, 23, 'CIDADANIA', 2018, 4.93, -1.4, 'renomeado de PPS'),
    (2020, 25, 'DEM', 2018, 8.57, 71.4, 'direto'),
    (2020, 27, 'DC', 2018, 8.11, 62.2, 'direto'),
    (2020, 28, 'PRTB', 2018, 7.45, 49.0, 'direto'),
    (2020, 29, 'PCO', 2018, 0.61, -87.8, 'direto'),
    (2020, 30, 'NOVO', 2018, 8.13, 62.6, 'direto'),
    (2020, 33, 'PMN', 2018, 6.88, 37.6, 'direto'),
    (2020, 35, 'PMB', 2018, 6.9, 38.0, 'direto'),
    (2020, 36, 'PTC', 2018, 7.86, 57.2, 'direto'),
    (2020, 40, 'PSB', 2018, 4.05, -19.0, 'direto'),
    (2020, 43, 'PV', 2018, 5.29, 5.8, 'direto'),
    (2020, 44, 'UNIÃO', 2018, NULL, NULL, 'sem valor'),
    (2020, 45, 'PSDB', 2018, 7.11, 42.2, 'direto'),
    (2020, 50, 'PSOL', 2018, 1.28, -74.4, 'direto'),
    (2020, 51, 'PATRIOTA', 2018, 8.075, 61.5, 'média de PATRI e PRP (fusão de 2019)'),
    (2020, 55, 'PSD', 2018, 7.09, 41.8, 'direto'),
    (2020, 65, 'PC do B', 2018, 4.595, -8.1, 'média de PCDOB e PPL (fusão de 2019)'),
    (2020, 70, 'AVANTE', 2018, 6.32, 26.4, 'direto'),
    (2020, 77, 'SOLIDARIEDADE', 2018, 6.5, 30.0, 'direto'),
    (2020, 80, 'UP', 2018, NULL, NULL, 'sem valor'),
    (2020, 90, 'PROS', 2018, 7.47, 49.4, 'direto'),
    (2022, 10, 'REPUBLICANOS', 2022, 8.33, 66.6, 'direto'),
    (2022, 11, 'PP', 2022, 8.15, 63.0, 'direto'),
    (2022, 12, 'PDT', 2022, 3.86, -22.8, 'direto'),
    (2022, 13, 'PT', 2022, 2.68, -46.4, 'direto'),
    (2022, 14, 'PTB', 2022, 7.72, 54.4, 'direto'),
    (2022, 15, 'MDB', 2022, 6.5, 30.0, 'direto'),
    (2022, 16, 'PSTU', 2022, 0.51, -89.8, 'direto'),
    (2022, 18, 'REDE', 2022, 3.69, -26.2, 'direto'),
    (2022, 19, 'PODE', 2022, 7.44, 48.8, 'direto'),
    (2022, 20, 'PSC', 2022, 8.41, 68.2, 'direto'),
    (2022, 21, 'PCB', 2022, 0.69, -86.2, 'direto'),
    (2022, 22, 'PL', 2022, 8.8, 76.0, 'direto'),
    (2022, 23, 'CIDADANIA', 2022, 6.17, 23.4, 'direto'),
    (2022, 27, 'DC', 2022, 8.21, 64.2, 'direto'),
    (2022, 28, 'PRTB', 2022, 7.49, 49.8, 'direto'),
    (2022, 29, 'PCO', 2022, 0.55, -89.0, 'direto'),
    (2022, 30, 'NOVO', 2022, 8.67, 73.4, 'direto'),
    (2022, 33, 'PMN', 2022, 6.74, 34.8, 'direto'),
    (2022, 35, 'PMB', 2022, 7.29, 45.8, 'direto'),
    (2022, 36, 'AGIR', 2022, 7.55, 51.0, 'direto'),
    (2022, 40, 'PSB', 2022, 3.59, -28.2, 'direto'),
    (2022, 43, 'PV', 2022, 4.12, -17.6, 'direto'),
    (2022, 44, 'UNIÃO', 2022, 8.49, 69.8, 'direto'),
    (2022, 45, 'PSDB', 2022, 6.76, 35.2, 'direto'),
    (2022, 50, 'PSOL', 2022, 1.41, -71.8, 'direto'),
    (2022, 51, 'PATRIOTA', 2022, 8.6, 72.0, 'renomeado de PATRI'),
    (2022, 55, 'PSD', 2022, 6.94, 38.8, 'direto'),
    (2022, 65, 'PC do B', 2022, 1.78, -64.4, 'direto'),
    (2022, 70, 'AVANTE', 2022, 6.47, 29.4, 'direto'),
    (2022, 77, 'SOLIDARIEDADE', 2022, 6.01, 20.2, 'direto'),
    (2022, 80, 'UP', 2022, 1.63, -67.4, 'direto'),
    (2022, 90, 'PROS', 2022, 7.45, 49.0, 'direto'),
    (2024, 10, 'REPUBLICANOS', 2022, 8.33, 66.6, 'direto'),
    (2024, 11, 'PP', 2022, 8.15, 63.0, 'direto'),
    (2024, 12, 'PDT', 2022, 3.86, -22.8, 'direto'),
    (2024, 13, 'PT', 2022, 2.68, -46.4, 'direto'),
    (2024, 15, 'MDB', 2022, 6.5, 30.0, 'direto'),
    (2024, 16, 'PSTU', 2022, 0.51, -89.8, 'direto'),
    (2024, 18, 'REDE', 2022, 3.69, -26.2, 'direto'),
    (2024, 20, 'PODE', 2022, 7.925, 58.5, 'média de PODE e PSC (fusão de 2023)'),
    (2024, 21, 'PCB', 2022, 0.69, -86.2, 'direto'),
    (2024, 22, 'PL', 2022, 8.8, 76.0, 'direto'),
    (2024, 23, 'CIDADANIA', 2022, 6.17, 23.4, 'direto'),
    (2024, 25, 'PRD', 2022, 8.16, 63.2, 'média de PTB e PATRI (fusão de 2023)'),
    (2024, 27, 'DC', 2022, 8.21, 64.2, 'direto'),
    (2024, 28, 'PRTB', 2022, 7.49, 49.8, 'direto'),
    (2024, 29, 'PCO', 2022, 0.55, -89.0, 'direto'),
    (2024, 30, 'NOVO', 2022, 8.67, 73.4, 'direto'),
    (2024, 33, 'MOBILIZA', 2022, 6.74, 34.8, 'renomeado de PMN'),
    (2024, 35, 'PMB', 2022, 7.29, 45.8, 'direto'),
    (2024, 36, 'AGIR', 2022, 7.55, 51.0, 'direto'),
    (2024, 40, 'PSB', 2022, 3.59, -28.2, 'direto'),
    (2024, 43, 'PV', 2022, 4.12, -17.6, 'direto'),
    (2024, 44, 'UNIÃO', 2022, 8.49, 69.8, 'direto'),
    (2024, 45, 'PSDB', 2022, 6.76, 35.2, 'direto'),
    (2024, 50, 'PSOL', 2022, 1.41, -71.8, 'direto'),
    (2024, 55, 'PSD', 2022, 6.94, 38.8, 'direto'),
    (2024, 65, 'PC do B', 2022, 1.78, -64.4, 'direto'),
    (2024, 70, 'AVANTE', 2022, 6.47, 29.4, 'direto'),
    (2024, 77, 'SOLIDARIEDADE', 2022, 6.73, 34.6, 'média de SOLIDARIEDADE e PROS (fusão de 2023)'),
    (2024, 80, 'UP', 2022, 1.63, -67.4, 'direto');

ALTER TABLE public.partido ALTER COLUMN vies_politico TYPE DOUBLE;
ALTER TABLE public.candidatura ALTER COLUMN vies_politico_eleicao TYPE DOUBLE;

-- partido.vies_politico = valor da eleição mais recente com valor para o número.
UPDATE public.partido SET vies_politico = NULL;
UPDATE public.partido p
SET vies_politico = (
    SELECT o.vies FROM public.vies_partido_onda o
    WHERE o.nr_partido = p.nr_partido AND o.media IS NOT NULL
    ORDER BY o.ano_eleicao DESC LIMIT 1
);

-- candidatura.vies_politico_eleicao = valor do partido naquela eleição.
UPDATE public.candidatura SET vies_politico_eleicao = NULL
WHERE ano_eleicao BETWEEN 2018 AND 2024;
UPDATE public.candidatura c
SET vies_politico_eleicao = o.vies
FROM public.vies_partido_onda o
WHERE o.ano_eleicao = c.ano_eleicao
  AND o.nr_partido = c.nr_partido
  AND o.sg_partido = c.sg_partido;

COMMIT;

-- Conferência: deve imprimir 2018 100,00 / 2020 ≥99,9 / 2022 100,00 / 2024 100,00.
SELECT v.ano_eleicao,
       ROUND(100.0 * SUM(COALESCE(v.qt_votos_nominais, 0) + COALESCE(v.qt_votos_legenda, 0))
                      FILTER (WHERE o.media IS NOT NULL)
             / SUM(COALESCE(v.qt_votos_nominais, 0) + COALESCE(v.qt_votos_legenda, 0)), 2) AS cobertura
FROM public.votacao_partido v
JOIN public.vies_onda_eleicao r
  ON r.ano_eleicao = v.ano_eleicao
 AND list_contains(r.cargos, v.cd_cargo)
LEFT JOIN public.vies_partido_onda o
  ON o.ano_eleicao = v.ano_eleicao
 AND o.nr_partido = v.nr_partido
 AND o.sg_partido = v.sg_partido
WHERE v.nr_turno = 1
GROUP BY 1 ORDER BY 1;

SELECT (SELECT count(*) FROM public.partido WHERE vies_politico IS NOT NULL) AS partidos_com_vies,
       (SELECT count(*) FROM public.partido) AS partidos,
       (SELECT count(*) FROM public.candidatura
        WHERE ano_eleicao BETWEEN 2018 AND 2024 AND vies_politico_eleicao IS NOT NULL) AS candidaturas_com_vies,
       (SELECT count(*) FROM public.candidatura WHERE ano_eleicao BETWEEN 2018 AND 2024) AS candidaturas;
