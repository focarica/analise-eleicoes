-- Requer 01 e 05. Carga repetível das tabelas dependentes; conferir os
-- códigos municipais contra MUNICIPIO e concluir o staging anual das contas.

BEGIN;
SET LOCAL work_mem = '256MB';
ANALYZE stg_tse.bem_candidato;
ANALYZE stg_tse.votacao_candidato_munzona;
ANALYZE stg_tse.votacao_partido_munzona;
ANALYZE stg_tse.detalhe_votacao_munzona;
ANALYZE stg_tse.perfil_eleitorado_municipio;
ANALYZE stg_tse.receita_candidato;
ANALYZE stg_tse.despesa_candidato;
ANALYZE stg_tse.cobertura_despesa_paga_lote;
ANALYZE stg_tse.comparecimento_zonas_esperadas;

-- MUNICIPIO: cadastro oficial TSE em staging. O código IBGE exige correspondência
-- comprovada e pode ficar NULL. Indicadores ficam fora desta carga TSE.
INSERT INTO municipio (
    cd_municipio_tse, cd_municipio_ibge, nm_municipio, sg_uf
)
SELECT x.cd_municipio_tse, x.cd_municipio_ibge, x.nm_municipio, x.sg_uf
FROM stg_tse.municipio_correspondencia x
JOIN stg_tse.escopo_uf uf ON uf.sg_uf = upper(x.sg_uf)
ON CONFLICT (cd_municipio_tse) DO UPDATE SET
    cd_municipio_ibge = coalesce(EXCLUDED.cd_municipio_ibge, municipio.cd_municipio_ibge),
    nm_municipio = EXCLUDED.nm_municipio,
    sg_uf = EXCLUDED.sg_uf;
ANALYZE municipio;

-- Captura chaves persistentes das linhas de contas antes da carga. id_linha_origem
-- deve ser o sequencial original do arquivo ou uma chave rastreável equivalente.
INSERT INTO stg_tse.mapa_lancamento (
    tipo_registro, ano_eleicao, sq_candidato, id_linha_origem
)
SELECT 'RECEITA', ano_eleicao::integer, sq_candidato::bigint, id_linha_origem
FROM stg_tse.receita_candidato
WHERE ano_eleicao ~ '^[0-9]{4}$' AND sq_candidato ~ '^[0-9]+$'
  AND EXISTS (
      SELECT 1 FROM candidatura c
      WHERE c.ano_eleicao = CASE WHEN stg_tse.receita_candidato.ano_eleicao ~ '^[0-9]{4}$' THEN stg_tse.receita_candidato.ano_eleicao::integer END
        AND c.sq_candidato = CASE WHEN stg_tse.receita_candidato.sq_candidato ~ '^[0-9]+$' THEN stg_tse.receita_candidato.sq_candidato::bigint END
  )
ON CONFLICT (tipo_registro, ano_eleicao, sq_candidato, id_linha_origem) DO NOTHING;

INSERT INTO stg_tse.mapa_lancamento (
    tipo_registro, ano_eleicao, sq_candidato, id_linha_origem
)
SELECT 'DESPESA', ano_eleicao::integer, sq_candidato::bigint, id_linha_origem
FROM stg_tse.despesa_candidato
WHERE ano_eleicao ~ '^[0-9]{4}$' AND sq_candidato ~ '^[0-9]+$'
  AND EXISTS (
      SELECT 1 FROM candidatura c
      WHERE c.ano_eleicao = CASE WHEN stg_tse.despesa_candidato.ano_eleicao ~ '^[0-9]{4}$' THEN stg_tse.despesa_candidato.ano_eleicao::integer END
        AND c.sq_candidato = CASE WHEN stg_tse.despesa_candidato.sq_candidato ~ '^[0-9]+$' THEN stg_tse.despesa_candidato.sq_candidato::bigint END
  )
ON CONFLICT (tipo_registro, ano_eleicao, sq_candidato, id_linha_origem) DO NOTHING;

-- Bens: a numeração oficial NR_ORDEM_BEM_CANDIDATO fornece ID_BEM no grão
-- (ano, candidatura, bem), conforme a chave proposta pelo grupo.
INSERT INTO bens_declarados (
    ano_eleicao, sq_candidato, id_bem, ds_tipo_bem, ds_bem, vr_bem
)
SELECT s.ano_eleicao::integer,
       s.sq_candidato::bigint,
       s.nr_ordem_bem_candidato::integer,
       CASE WHEN upper(trim(s.ds_tipo_bem_candidato)) IN ('', '#NULO', '#NE', '-1', '-3', '-4', 'NÃO DIVULGÁVEL') THEN NULL ELSE trim(s.ds_tipo_bem_candidato) END,
       CASE WHEN upper(trim(s.ds_bem_candidato)) IN ('', '#NULO', '#NE', '-1', '-3', '-4', 'NÃO DIVULGÁVEL') THEN NULL ELSE trim(s.ds_bem_candidato) END,
       stg_tse.parse_brl_amount(s.vr_bem_candidato)
FROM stg_tse.bem_candidato s
JOIN candidatura c
  ON c.ano_eleicao = s.ano_eleicao::integer
 AND c.sq_candidato = s.sq_candidato::bigint
WHERE s.ano_eleicao ~ '^[0-9]{4}$'
  AND s.sq_candidato ~ '^[0-9]+$'
  AND s.nr_ordem_bem_candidato ~ '^[0-9]+$'
ON CONFLICT (ano_eleicao, sq_candidato, id_bem) DO UPDATE SET
    ds_tipo_bem = EXCLUDED.ds_tipo_bem,
    ds_bem = EXCLUDED.ds_bem,
    vr_bem = EXCLUDED.vr_bem;

-- ID_RECEITA/ID_DESPESA são técnicos internos. id_linha_origem precisa ser a
-- chave estável anual fornecida pelo arquivo (sequencial) ou fingerprint
-- persistido no manifesto; não usar a ordem física do CSV como identificador.
INSERT INTO receitas_campanha (
    ano_eleicao, sq_candidato, id_receita, ds_fonte_receita,
    tp_origem_recurso, vr_receita
)
SELECT l.ano_eleicao::integer, l.sq_candidato::bigint, k.id_lancamento,
       CASE WHEN upper(trim(l.ds_fonte_receita)) IN ('', '#NULO', '#NE', '-1', '-3', '-4', 'NÃO DIVULGÁVEL') THEN NULL ELSE trim(l.ds_fonte_receita) END,
       NULL::varchar(50), -- taxonomia analítica do projeto ainda sem regra versionada
       stg_tse.parse_brl_amount(l.vr_receita)
FROM stg_tse.receita_candidato l
JOIN stg_tse.mapa_lancamento k
  ON k.tipo_registro = 'RECEITA'
 AND k.ano_eleicao = l.ano_eleicao::integer
 AND k.sq_candidato = l.sq_candidato::bigint
 AND k.id_linha_origem = l.id_linha_origem
JOIN candidatura c
  ON c.ano_eleicao = l.ano_eleicao::integer
 AND c.sq_candidato = l.sq_candidato::bigint
WHERE l.ano_eleicao ~ '^[0-9]{4}$'
  AND l.sq_candidato ~ '^[0-9]+$'
ON CONFLICT (ano_eleicao, sq_candidato, id_receita) DO UPDATE SET
    ds_fonte_receita = EXCLUDED.ds_fonte_receita,
    tp_origem_recurso = EXCLUDED.tp_origem_recurso,
    vr_receita = EXCLUDED.vr_receita;

-- Uma edição completa substitui os pagamentos conhecidos daquela candidatura:
-- linhas retiradas pela fonte não podem continuar compondo seu total.
INSERT INTO stg_tse.cobertura_despesa_paga
    (ano_eleicao,sq_candidato,completo,source_manifest)
SELECT ano_eleicao,sq_candidato,completo,source_manifest
FROM stg_tse.cobertura_despesa_paga_lote
ON CONFLICT (ano_eleicao,sq_candidato) DO UPDATE SET
    completo=EXCLUDED.completo,
    source_manifest=EXCLUDED.source_manifest;
WITH atuais AS MATERIALIZED (
    SELECT k.ano_eleicao,k.sq_candidato,k.id_lancamento
    FROM stg_tse.despesa_candidato l
    JOIN stg_tse.mapa_lancamento k
      ON k.tipo_registro='DESPESA' AND k.ano_eleicao::text=l.ano_eleicao
     AND k.sq_candidato::text=l.sq_candidato AND k.id_linha_origem=l.id_linha_origem
)
DELETE FROM despesas_pagas d USING stg_tse.cobertura_despesa_paga_lote c
WHERE c.completo AND d.ano_eleicao=c.ano_eleicao AND d.sq_candidato=c.sq_candidato
  AND NOT EXISTS(SELECT 1 FROM atuais a WHERE a.ano_eleicao=d.ano_eleicao
                 AND a.sq_candidato=d.sq_candidato AND a.id_lancamento=d.id_despesa);

INSERT INTO despesas_pagas (
    ano_eleicao, sq_candidato, id_despesa, ds_despesa,
    ds_categoria_despesa, vr_pago
)
SELECT l.ano_eleicao::integer, l.sq_candidato::bigint, k.id_lancamento,
       CASE WHEN upper(trim(l.ds_despesa)) IN ('', '#NULO', '#NE', '-1', '-3', '-4', 'NÃO DIVULGÁVEL') THEN NULL ELSE trim(l.ds_despesa) END,
       NULL::varchar(150), -- categoria analítica do projeto ainda sem regra
       stg_tse.parse_brl_amount(l.vr_pago) -- somente origem explicitamente DESPESAS_PAGAS
FROM stg_tse.despesa_candidato l
JOIN stg_tse.mapa_lancamento k
  ON k.tipo_registro = 'DESPESA'
 AND k.ano_eleicao = l.ano_eleicao::integer
 AND k.sq_candidato = l.sq_candidato::bigint
 AND k.id_linha_origem = l.id_linha_origem
JOIN candidatura c
  ON c.ano_eleicao = l.ano_eleicao::integer
 AND c.sq_candidato = l.sq_candidato::bigint
WHERE l.ano_eleicao ~ '^[0-9]{4}$'
  AND l.sq_candidato ~ '^[0-9]+$'
ON CONFLICT (ano_eleicao, sq_candidato, id_despesa) DO UPDATE SET
    ds_despesa = EXCLUDED.ds_despesa,
    ds_categoria_despesa = EXCLUDED.ds_categoria_despesa,
    vr_pago = EXCLUDED.vr_pago;

-- Voto nominal, agregado zona -> município. Processa a staging em uma passagem
-- para não reler os 7+ milhões de registros 16 vezes. O work_mem local limita o
-- hash agregado; candidaturas e municípios restringem ao universo carregado.
INSERT INTO votacao_candidato_municipio (
    ano_eleicao, cd_eleicao, nr_turno, cd_cargo, cd_municipio_tse,
    sq_candidato, qt_votos_nominais
)
SELECT s.ano_eleicao::integer, s.cd_eleicao::integer, s.nr_turno::integer,
       s.cd_cargo::integer, s.cd_municipio_tse, s.sq_candidato::bigint,
       sum(s.qt_votos_nominais::bigint)::integer
FROM stg_tse.votacao_candidato_munzona s
JOIN stg_tse.escopo_uf uf ON uf.sg_uf = upper(s.sg_uf)
JOIN municipio m ON m.cd_municipio_tse = s.cd_municipio_tse
JOIN candidatura c
  ON c.ano_eleicao = s.ano_eleicao::integer
 AND c.sq_candidato = s.sq_candidato::bigint
WHERE s.ano_eleicao ~ '^[0-9]{4}$'
  AND s.cd_eleicao ~ '^[0-9]+$'
  AND s.nr_turno ~ '^[0-9]+$'
  AND s.cd_cargo ~ '^[0-9]+$'
  AND s.sq_candidato ~ '^[0-9]+$'
  AND s.qt_votos_nominais ~ '^[0-9]+$'
GROUP BY s.ano_eleicao, s.cd_eleicao, s.nr_turno, s.cd_cargo,
         s.cd_municipio_tse, s.sq_candidato
ON CONFLICT (ano_eleicao, cd_eleicao, nr_turno, cd_cargo, cd_municipio_tse, sq_candidato)
DO UPDATE SET qt_votos_nominais = EXCLUDED.qt_votos_nominais;

-- O resumo do ER é primeiro turno e só deve ser preenchido quando a cobertura
-- municipal contém toda a circunscrição: candidatura municipal (município
-- carregado) ou candidatura estadual em UF integralmente incluída no MVP.
-- Candidaturas nacionais (SG_UE='BR') ficam NULL porque o recorte estadual não
-- cobre todos os votos da circunscrição.
WITH totais AS (
    SELECT v.ano_eleicao, v.sq_candidato, v.cd_cargo,
           sum(v.qt_votos_nominais::bigint)::integer AS qt_votos
    FROM votacao_candidato_municipio v
    WHERE v.nr_turno = 1
    GROUP BY v.ano_eleicao, v.sq_candidato, v.cd_cargo
)
UPDATE candidatura c
SET qt_votos_totais = t.qt_votos
FROM totais t
WHERE c.ano_eleicao = t.ano_eleicao
  AND c.sq_candidato = t.sq_candidato
  AND c.cd_cargo = t.cd_cargo
  AND (c.cd_municipio_tse IS NOT NULL
       OR upper(c.sg_ue) IN (SELECT sg_uf::text FROM stg_tse.escopo_uf));

-- A tabela de votos por partido duplica os votos nominais agregados dos
-- candidatos. Use as colunas separadas; não some o nominal nas duas tabelas.
INSERT INTO partido (nr_partido, sg_partido, nm_partido)
SELECT DISTINCT ON (s.nr_partido::integer)
       s.nr_partido::integer, s.sg_partido, NULL
FROM stg_tse.votacao_partido_munzona s
JOIN stg_tse.escopo_uf uf ON uf.sg_uf = upper(s.sg_uf)
WHERE s.nr_partido ~ '^[0-9]+$'
ORDER BY s.nr_partido::integer, s.ano_eleicao::integer DESC
ON CONFLICT (nr_partido) DO UPDATE SET
    sg_partido = coalesce(partido.sg_partido, EXCLUDED.sg_partido);
-- Este arquivo não possui NM_PARTIDO: não sobrescrever o nome já publicado.
-- A carga 03 completa/atualiza o nome quando CONSULTA_CAND estiver disponível.

INSERT INTO votacao_partido (
    ano_eleicao, cd_eleicao, nr_turno, cd_cargo, cd_municipio_tse,
    nr_partido, sg_partido, qt_votos_legenda, qt_votos_nominais
)
SELECT s.ano_eleicao::integer, s.cd_eleicao::integer, s.nr_turno::integer,
       s.cd_cargo::integer, s.cd_municipio_tse, s.nr_partido::integer,
       NULLIF(trim(s.sg_partido), ''),
       sum(CASE WHEN s.qt_votos_legenda ~ '^[0-9]+$' THEN s.qt_votos_legenda::bigint END)::integer,
       sum(CASE WHEN s.qt_votos_nominais ~ '^[0-9]+$' THEN s.qt_votos_nominais::bigint END)::integer
FROM stg_tse.votacao_partido_munzona s
JOIN stg_tse.escopo_uf uf ON uf.sg_uf = upper(s.sg_uf)
JOIN municipio m ON m.cd_municipio_tse = s.cd_municipio_tse
JOIN partido p ON p.nr_partido = s.nr_partido::integer
WHERE s.ano_eleicao ~ '^[0-9]{4}$'
  AND s.cd_eleicao ~ '^[0-9]+$'
  AND s.nr_turno ~ '^[0-9]+$'
  AND s.cd_cargo ~ '^[0-9]+$'
  AND s.nr_partido ~ '^[0-9]+$'
GROUP BY s.ano_eleicao, s.cd_eleicao, s.nr_turno, s.cd_cargo,
         s.cd_municipio_tse, s.nr_partido, s.sg_partido
ON CONFLICT (ano_eleicao, cd_eleicao, nr_turno, cd_cargo, cd_municipio_tse, nr_partido)
DO UPDATE SET sg_partido = EXCLUDED.sg_partido,
              qt_votos_legenda = EXCLUDED.qt_votos_legenda,
              qt_votos_nominais = EXCLUDED.qt_votos_nominais;

-- Quarentena e completude: não somar município com zona ausente, inesperada,
-- divergente ou com sentinelas. A lista esperada deve vir do arquivo conferido.
-- Renova somente os problemas do escopo carregado; resolve quarentenas antigas
-- quando a nova fonte é corrigida, sem apagar problemas de outros estados.
DELETE FROM stg_tse.quarentena_comparecimento q
USING stg_tse.comparecimento_cobertura c
WHERE q.ano_eleicao IS NOT DISTINCT FROM c.ano_eleicao
  AND q.cd_eleicao IS NOT DISTINCT FROM c.cd_eleicao
  AND q.nr_turno IS NOT DISTINCT FROM c.nr_turno
  AND q.cd_municipio_tse IS NOT DISTINCT FROM c.cd_municipio_tse;

INSERT INTO stg_tse.quarentena_comparecimento (
    ano_eleicao, cd_eleicao, nr_turno, cd_municipio_tse, nr_zona,
    motivo, registros_origem
)
SELECT z.ano_eleicao, z.cd_eleicao, z.nr_turno, z.cd_municipio_tse,
       z.nr_zona,
       CASE WHEN z.ano_eleicao IS NULL OR z.cd_eleicao IS NULL
                       OR z.nr_turno NOT IN (1, 2) OR z.nr_turno IS NULL
                       OR z.nr_zona IS NULL THEN 'CHAVE_INVALIDA'
            WHEN NOT z.medidas_validas THEN 'MEDIDA_INVALIDA_OU_INCONSISTENTE'
            WHEN z.combinacoes <> 1 THEN 'DIVERGENCIA_ENTRE_CARGOS'
            ELSE 'ZONA_NAO_PREVISTA_OU_MANIFESTO_NAO_VERIFICADO' END,
       z.registros_origem
FROM stg_tse.comparecimento_zonas z
LEFT JOIN stg_tse.comparecimento_zonas_esperadas e
  ON e.ano_eleicao = z.ano_eleicao AND e.cd_eleicao = z.cd_eleicao
 AND e.nr_turno = z.nr_turno AND e.cd_municipio_tse = z.cd_municipio_tse
 AND e.nr_zona = z.nr_zona
WHERE z.ano_eleicao IS NULL OR z.cd_eleicao IS NULL
   OR z.nr_turno IS NULL OR z.nr_turno NOT IN (1, 2) OR z.nr_zona IS NULL
   OR NOT z.medidas_validas OR z.combinacoes <> 1
   OR e.nr_zona IS NULL OR NOT e.manifesto_verificado;

INSERT INTO stg_tse.quarentena_comparecimento (
    ano_eleicao, cd_eleicao, nr_turno, cd_municipio_tse, nr_zona,
    motivo, registros_origem
)
SELECT e.ano_eleicao, e.cd_eleicao, e.nr_turno, e.cd_municipio_tse,
       e.nr_zona, 'ZONA_ESPERADA_AUSENTE', jsonb_build_array(to_jsonb(e))
FROM stg_tse.comparecimento_zonas_esperadas e
JOIN stg_tse.municipio_correspondencia m USING (cd_municipio_tse)
JOIN stg_tse.escopo_uf uf ON uf.sg_uf = upper(trim(m.sg_uf))
WHERE NOT EXISTS (
    SELECT 1 FROM stg_tse.comparecimento_zonas z
    WHERE z.ano_eleicao = e.ano_eleicao AND z.cd_eleicao = e.cd_eleicao
      AND z.nr_turno = e.nr_turno AND z.cd_municipio_tse = e.cd_municipio_tse
      AND z.nr_zona = e.nr_zona
);

-- Retira um total anteriormente publicado se o lote atual agora o invalida.
DELETE FROM comparecimento_municipio t
USING stg_tse.comparecimento_cobertura c
WHERE t.ano_eleicao = c.ano_eleicao AND t.cd_eleicao = c.cd_eleicao
  AND t.nr_turno = c.nr_turno AND t.cd_municipio_tse = c.cd_municipio_tse
  AND (NOT c.completo OR c.qt_aptos > 2147483647
       OR c.qt_comparecimento > 2147483647 OR c.qt_abstencao > 2147483647);

INSERT INTO comparecimento_municipio (
    ano_eleicao, cd_eleicao, nr_turno, cd_municipio_tse,
    qt_aptos, qt_comparecimento, qt_abstencao
)
SELECT c.ano_eleicao::integer, c.cd_eleicao::integer, c.nr_turno::integer,
       c.cd_municipio_tse, c.qt_aptos::integer,
       c.qt_comparecimento::integer, c.qt_abstencao::integer
FROM stg_tse.comparecimento_cobertura c
JOIN municipio m USING (cd_municipio_tse)
WHERE c.completo
  AND c.qt_aptos <= 2147483647 AND c.qt_comparecimento <= 2147483647
  AND c.qt_abstencao <= 2147483647
ON CONFLICT (ano_eleicao, cd_eleicao, nr_turno, cd_municipio_tse)
DO UPDATE SET qt_aptos = EXCLUDED.qt_aptos,
              qt_comparecimento = EXCLUDED.qt_comparecimento,
              qt_abstencao = EXCLUDED.qt_abstencao;

-- Perfil: manter apenas faixa etária e agregar qualquer outra dimensão do
-- arquivo (como sexo/escolaridade) para não duplicar a chave destino do modelo.
INSERT INTO perfil_eleitorado (
    cd_municipio_tse, ano_eleicao, ds_faixa_etaria, qt_eleitores
)
SELECT s.cd_municipio_tse, s.ano_eleicao::integer,
       trim(s.ds_faixa_etaria),
       sum(s.qt_eleitores_perfil::bigint)::integer
FROM stg_tse.perfil_eleitorado_municipio s
JOIN stg_tse.escopo_uf uf ON uf.sg_uf = upper(s.sg_uf)
JOIN municipio m ON m.cd_municipio_tse = s.cd_municipio_tse
WHERE s.ano_eleicao ~ '^[0-9]{4}$'
  AND s.qt_eleitores_perfil ~ '^[0-9]+$'
  AND upper(trim(s.ds_faixa_etaria)) NOT IN ('', '#NULO', '#NE', '-1', '-3', '-4', 'NÃO DIVULGÁVEL')
GROUP BY s.cd_municipio_tse, s.ano_eleicao, trim(s.ds_faixa_etaria)
ON CONFLICT (cd_municipio_tse, ano_eleicao, ds_faixa_etaria)
DO UPDATE SET qt_eleitores = EXCLUDED.qt_eleitores;

COMMIT;
