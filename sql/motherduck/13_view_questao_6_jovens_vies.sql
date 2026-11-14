-- P6 — Jovens × não jovens × viés político
-- (população do município × idade do candidato), eleições de 2018 a 2024.
--
-- Uma linha por eleição, unidade territorial e cargo:
--   * eleições municipais (2020, 2024): unidade = município (prefeito e vereador);
--   * eleições gerais (2018, 2022): unidade = UF (governador, senador e deputados),
--     porque essas candidaturas não têm município.
--
-- Jovem = 18 a 29 anos (Estatuto da Juventude, Lei 12.852/2013, limitado à idade
-- mínima de candidatura). O corte coincide com as faixas do perfil do eleitorado
-- do TSE ("18 anos" … "25 a 29 anos"), o que permite comparar candidatos e
-- eleitorado com a mesma régua. A idade do candidato é calculada a partir de
-- CANDIDATO.DT_NASCIMENTO na data do primeiro turno; sem data, fica fora das
-- proporções (contada em cand_total, não em cand_com_idade).
--
-- Eleitorado: PERFIL_ELEITORADO.DS_FAIXA_ETARIA; base = eleitores de 18 anos ou
-- mais (16 e 17 anos e faixa inválida ficam fora, porque não podem se candidatar).
-- Mede o cadastro eleitoral, não o comparecimento.
--
-- Viés: CANDIDATURA.VIES_POLITICO_ELEICAO (−100 esquerda … +100 direita, P7).
-- Esquerda = viés < 0; direita = viés > 0; sem nota fica fora das médias.
-- As colunas são somas e contagens para que a API possa reagregar (UF, amostra,
-- cargos) sem tirar média de médias. Os campos do eleitorado se repetem nas
-- linhas de cargos da mesma unidade: some-os uma vez por unidade.
--
-- Entram só candidaturas totalizadas (DS_SIT_TOT_TURNO não nulo) dos cargos
-- titulares; vices, suplentes de senador e presidente ficam fora.

CREATE SCHEMA IF NOT EXISTS public;

CREATE OR REPLACE VIEW public.vw_questao_6_jovens_vies AS
WITH datas_eleicao(ano_eleicao, dt_eleicao, tipo_eleicao) AS (
    VALUES (2018, DATE '2018-10-07', 'geral'), (2020, DATE '2020-11-15', 'municipal'),
           (2022, DATE '2022-10-02', 'geral'), (2024, DATE '2024-10-06', 'municipal')
), cand AS (
    SELECT c.ano_eleicao, d.tipo_eleicao, c.cd_cargo, c.ds_cargo,
           CASE WHEN d.tipo_eleicao = 'municipal' THEN m.sg_uf ELSE c.sg_ue END AS sg_uf,
           CASE WHEN d.tipo_eleicao = 'municipal' THEN c.cd_municipio_tse END AS cd_municipio_tse,
           c.ds_sit_tot_turno IN ('ELEITO', 'ELEITO POR QP', 'ELEITO POR MÉDIA') AS eleito,
           c.vies_politico_eleicao AS vies,
           date_part('year', d.dt_eleicao) - date_part('year', ca.dt_nascimento)
             - CASE WHEN strftime(d.dt_eleicao, '%m%d') < strftime(ca.dt_nascimento, '%m%d') THEN 1 ELSE 0 END AS idade
    FROM public.candidatura c
    JOIN datas_eleicao d USING (ano_eleicao)
    LEFT JOIN public.candidato ca ON ca.id_pessoa_projeto = c.id_pessoa_projeto
    LEFT JOIN public.municipio m ON m.cd_municipio_tse = c.cd_municipio_tse
    WHERE c.ds_sit_tot_turno IS NOT NULL
      AND ((d.tipo_eleicao = 'municipal' AND c.cd_cargo IN (11, 13) AND c.cd_municipio_tse IS NOT NULL)
        OR (d.tipo_eleicao = 'geral' AND c.cd_cargo IN (3, 5, 6, 7, 8)))
), cand_class AS (
    SELECT *,
           CASE WHEN idade BETWEEN 18 AND 120 THEN idade END AS idade_valida,
           CASE WHEN idade BETWEEN 18 AND 120 THEN idade <= 29 END AS jovem
    FROM cand
), agg_cand AS (
    SELECT ano_eleicao, tipo_eleicao, sg_uf, cd_municipio_tse, cd_cargo,
           ANY_VALUE(ds_cargo) AS ds_cargo,
           COUNT(*) AS cand_total,
           COUNT(jovem) AS cand_com_idade,
           COUNT(*) FILTER (WHERE jovem) AS cand_jovens,
           SUM(idade_valida) AS soma_idade_cand,
           COUNT(*) FILTER (WHERE eleito) AS eleitos_total,
           COUNT(jovem) FILTER (WHERE eleito) AS eleitos_com_idade,
           COUNT(*) FILTER (WHERE eleito AND jovem) AS eleitos_jovens,
           SUM(idade_valida) FILTER (WHERE eleito) AS soma_idade_eleitos,
           -- viés dos candidatos
           SUM(vies) FILTER (WHERE jovem) AS vies_soma_jovens,
           COUNT(vies) FILTER (WHERE jovem) AS vies_n_jovens,
           SUM(vies) FILTER (WHERE NOT jovem) AS vies_soma_nao_jovens,
           COUNT(vies) FILTER (WHERE NOT jovem) AS vies_n_nao_jovens,
           COUNT(*) FILTER (WHERE jovem AND vies < 0) AS esq_jovens,
           COUNT(*) FILTER (WHERE jovem AND vies > 0) AS dir_jovens,
           COUNT(*) FILTER (WHERE NOT jovem AND vies < 0) AS esq_nao_jovens,
           COUNT(*) FILTER (WHERE NOT jovem AND vies > 0) AS dir_nao_jovens,
           -- viés dos eleitos
           SUM(vies) FILTER (WHERE eleito AND jovem) AS vies_soma_eleitos_jovens,
           COUNT(vies) FILTER (WHERE eleito AND jovem) AS vies_n_eleitos_jovens,
           SUM(vies) FILTER (WHERE eleito AND NOT jovem) AS vies_soma_eleitos_nao_jovens,
           COUNT(vies) FILTER (WHERE eleito AND NOT jovem) AS vies_n_eleitos_nao_jovens
    FROM cand_class
    WHERE sg_uf IS NOT NULL
    GROUP BY ALL
), perfil AS (
    SELECT p.ano_eleicao, m.sg_uf, p.cd_municipio_tse,
           SUM(p.qt_eleitores) FILTER (WHERE p.ds_faixa_etaria IN
               ('18 anos', '19 anos', '20 anos', '21 a 24 anos', '25 a 29 anos')) AS eleitores_18_29,
           SUM(p.qt_eleitores) FILTER (WHERE regexp_matches(p.ds_faixa_etaria, '^[0-9]')
               AND p.ds_faixa_etaria NOT IN ('16 anos', '17 anos')) AS eleitores_18_mais
    FROM public.perfil_eleitorado p
    JOIN public.municipio m USING (cd_municipio_tse)
    WHERE p.ano_eleicao IN (2018, 2020, 2022, 2024)
    GROUP BY ALL
), perfil_uf AS (
    SELECT ano_eleicao, sg_uf,
           SUM(eleitores_18_29) AS eleitores_18_29, SUM(eleitores_18_mais) AS eleitores_18_mais
    FROM perfil GROUP BY ALL
)
SELECT a.ano_eleicao, a.tipo_eleicao, a.sg_uf, a.cd_municipio_tse, m.nm_municipio,
       a.cd_cargo, a.ds_cargo,
       COALESCE(pm.eleitores_18_29, pu.eleitores_18_29) AS eleitores_18_29,
       COALESCE(pm.eleitores_18_mais, pu.eleitores_18_mais) AS eleitores_18_mais,
       a.* EXCLUDE (ano_eleicao, tipo_eleicao, sg_uf, cd_municipio_tse, cd_cargo, ds_cargo)
FROM agg_cand a
LEFT JOIN public.municipio m ON m.cd_municipio_tse = a.cd_municipio_tse
LEFT JOIN perfil pm
  ON a.tipo_eleicao = 'municipal' AND pm.ano_eleicao = a.ano_eleicao AND pm.cd_municipio_tse = a.cd_municipio_tse
LEFT JOIN perfil_uf pu
  ON a.tipo_eleicao = 'geral' AND pu.ano_eleicao = a.ano_eleicao AND pu.sg_uf = a.sg_uf;
