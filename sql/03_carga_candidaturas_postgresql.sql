-- Requer tabelas-alvo e execução prévia de 01 e 05 no destino escolhido.
-- Executar por ano após validar os campos e completar a correspondência municipal.
-- `stg_tse.candidatura` deve conter apenas candidaturas elegíveis para carga.

BEGIN;
-- O lote contém centenas de milhares de chaves. Aumenta a memória local da
-- sessão para evitar que DISTINCT/GROUP BY gerem grandes arquivos temporários.
SET LOCAL work_mem = '64MB';

-- Divergências no mesmo turno prioritário exigem revisar a fonte; não escolher
-- um resultado pela ordem dos arquivos. A transação aborta antes de publicar.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM stg_tse.candidatura_resultado
        WHERE turno_resultado IS NOT NULL
        GROUP BY ano_id, candidato_id
        HAVING count(DISTINCT (stg_tse.inteiro_nao_negativo(cd_eleicao),
                              upper(situacao_informada))) > 1
    ) THEN
        RAISE EXCEPTION 'Resultados conflitantes no maior turno; confira stg_tse.candidatura_resultado';
    END IF;
END;
$$;

-- Carrega a destinação explicitamente, sem vincular pessoas entre pleitos.
-- Categorias ausentes ou conflitantes abortam apenas se houver contradição;
-- ausência permanece NULL e nunca vira voto válido por presunção.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM stg_tse.candidatura_complementar
        GROUP BY stg_tse.inteiro_nao_negativo(ano_eleicao),
                 stg_tse.inteiro_nao_negativo(cd_eleicao),
                 stg_tse.inteiro_nao_negativo(sq_candidato)
        HAVING count(DISTINCT upper(stg_tse.texto_publicado(nm_tipo_destinacao_votos))) > 1
    ) THEN
        RAISE EXCEPTION 'Destinações conflitantes no complementar; revisar arquivo/edição';
    END IF;
END;
$$;
-- A nova edição do lote substitui o complemento das chaves reprocessadas;
-- uma linha retirada da fonte não pode manter destinação antiga como válida.
DELETE FROM stg_tse.destinacao_votos d
WHERE EXISTS (
    SELECT 1 FROM stg_tse.candidatura s
    WHERE d.ano_eleicao = stg_tse.inteiro_nao_negativo(s.ano_eleicao)
      AND d.cd_eleicao = stg_tse.inteiro_nao_negativo(s.cd_eleicao)
      AND d.sq_candidato = stg_tse.inteiro_nao_negativo(s.sq_candidato)
      AND (upper(trim(s.sg_uf)) IN (SELECT sg_uf::text FROM stg_tse.escopo_uf)
           OR upper(trim(s.sg_uf)) = 'BR')
) OR EXISTS (
    SELECT 1 FROM stg_tse.votacao_candidato_munzona v
    WHERE d.ano_eleicao = stg_tse.inteiro_nao_negativo(v.ano_eleicao)
      AND d.cd_eleicao = stg_tse.inteiro_nao_negativo(v.cd_eleicao)
      AND d.sq_candidato = stg_tse.inteiro_nao_negativo(v.sq_candidato)
      AND upper(trim(v.sg_uf)) IN (SELECT sg_uf::text FROM stg_tse.escopo_uf)
);
INSERT INTO stg_tse.destinacao_votos (
    ano_eleicao, cd_eleicao, sq_candidato, nm_tipo_destinacao_votos, source_files
)
SELECT stg_tse.inteiro_nao_negativo(ano_eleicao)::integer,
       stg_tse.inteiro_nao_negativo(cd_eleicao)::integer,
       stg_tse.inteiro_nao_negativo(sq_candidato),
       max(upper(stg_tse.texto_publicado(nm_tipo_destinacao_votos))),
       array_agg(DISTINCT source_file ORDER BY source_file)
FROM stg_tse.candidatura_complementar
WHERE stg_tse.inteiro_nao_negativo(ano_eleicao) IS NOT NULL
  AND stg_tse.inteiro_nao_negativo(cd_eleicao) IS NOT NULL
  AND stg_tse.inteiro_nao_negativo(sq_candidato) IS NOT NULL
GROUP BY stg_tse.inteiro_nao_negativo(ano_eleicao),
         stg_tse.inteiro_nao_negativo(cd_eleicao),
         stg_tse.inteiro_nao_negativo(sq_candidato)
ON CONFLICT (ano_eleicao, cd_eleicao, sq_candidato) DO UPDATE SET
    nm_tipo_destinacao_votos = EXCLUDED.nm_tipo_destinacao_votos,
    source_files = EXCLUDED.source_files;


-- Preserva IDs já usados na tabela-alvo e mantém o mapa persistente entre lotes.
SELECT setval(
    pg_get_serial_sequence('stg_tse.mapa_candidatura', 'id_pessoa_projeto'),
    GREATEST(
        COALESCE((SELECT max(id_pessoa_projeto) FROM candidato), 0),
        COALESCE((SELECT max(id_anterior) FROM stg_tse.migracao_pessoa), 0),
        COALESCE((SELECT max(id_pessoa_projeto) FROM stg_tse.mapa_candidatura), 0)
    ) + 1,
    false
);

INSERT INTO stg_tse.mapa_candidatura (ano_eleicao, sq_candidato)
SELECT DISTINCT CASE WHEN ano_eleicao ~ '^[0-9]{4}$' THEN ano_eleicao::integer END,
                CASE WHEN sq_candidato ~ '^[0-9]+$' THEN sq_candidato::bigint END
FROM stg_tse.candidatura
WHERE ano_eleicao ~ '^[0-9]{4}$'
  AND sq_candidato ~ '^[0-9]+$'
  AND (upper(trim(sg_uf)) IN (SELECT sg_uf::text FROM stg_tse.escopo_uf)
       OR upper(trim(sg_uf)) = 'BR')
ON CONFLICT (ano_eleicao, sq_candidato) DO NOTHING;

-- Observações pessoais ficam por candidatura, preservando o histórico.
INSERT INTO stg_tse.observacao_pessoa
SELECT DISTINCT ON (ano_id,candidato_id) ano_id::integer,candidato_id,
 CASE WHEN nr_titulo_eleitoral_candidato ~ '^[0-9]{12}$' AND nr_titulo_eleitoral_candidato <> '000000000000' THEN nr_titulo_eleitoral_candidato END,
 stg_tse.texto_publicado(nr_cpf_candidato),stg_tse.texto_publicado(nm_candidato),
 stg_tse.texto_publicado(dt_nascimento),to_jsonb(s)
FROM stg_tse.candidatura_resultado s
ORDER BY ano_id,candidato_id,source_file
ON CONFLICT (ano_eleicao,sq_candidato) DO UPDATE SET
 titulo=EXCLUDED.titulo,cpf=EXCLUDED.cpf,nome=EXCLUDED.nome,
 nascimento=EXCLUDED.nascimento,registro=EXCLUDED.registro;
-- As tabelas foram copiadas em massa; sem estatísticas recentes o planejador
-- pode estimar uma única linha e escolher junções repetitivas muito custosas.
ANALYZE stg_tse.observacao_pessoa;
ANALYZE stg_tse.mapa_candidatura;
INSERT INTO stg_tse.mapa_titulo (titulo,id_pessoa_projeto)
SELECT o.titulo,min(m.id_pessoa_projeto)
FROM stg_tse.observacao_pessoa o
JOIN stg_tse.mapa_candidatura m USING (ano_eleicao,sq_candidato)
WHERE o.titulo IS NOT NULL
GROUP BY o.titulo
ON CONFLICT (titulo) DO NOTHING;
INSERT INTO stg_tse.migracao_pessoa(id_anterior,id_mantido,ano_eleicao,sq_candidato)
SELECT m.id_pessoa_projeto,t.id_pessoa_projeto,m.ano_eleicao,m.sq_candidato
FROM stg_tse.mapa_candidatura m JOIN stg_tse.observacao_pessoa o USING(ano_eleicao,sq_candidato)
JOIN stg_tse.mapa_titulo t ON t.titulo=o.titulo
WHERE m.id_pessoa_projeto<>t.id_pessoa_projeto ON CONFLICT DO NOTHING;
UPDATE stg_tse.mapa_candidatura m SET id_pessoa_projeto=t.id_pessoa_projeto
FROM stg_tse.observacao_pessoa o JOIN stg_tse.mapa_titulo t ON t.titulo=o.titulo
WHERE m.ano_eleicao=o.ano_eleicao AND m.sq_candidato=o.sq_candidato;

-- PARTIDO é classificação por número e armazena apenas um nome/sigla de
-- referência. A sigla específica da candidatura é preservada na própria linha.
INSERT INTO partido (nr_partido, sg_partido, nm_partido)
SELECT DISTINCT ON (nr_partido::integer)
       nr_partido::integer, stg_tse.texto_publicado(sg_partido),
       stg_tse.texto_publicado(nm_partido)
FROM stg_tse.candidatura
WHERE nr_partido ~ '^[0-9]+$'
  AND (upper(trim(sg_uf)) IN (SELECT sg_uf::text FROM stg_tse.escopo_uf)
       OR upper(trim(sg_uf)) = 'BR')
ORDER BY nr_partido::integer,
         (stg_tse.texto_publicado(nm_partido) IS NOT NULL) DESC,
         stg_tse.inteiro_nao_negativo(ano_eleicao) DESC NULLS LAST,
         source_file, sg_partido, nm_partido
ON CONFLICT (nr_partido) DO UPDATE SET
    sg_partido = coalesce(EXCLUDED.sg_partido, partido.sg_partido),
    nm_partido = coalesce(EXCLUDED.nm_partido, partido.nm_partido);

-- Uma pessoa por título; cadastro de referência usa a observação mais recente.
-- CPF usa a observação publicada mais recente e não é apagado por fonte oculta.
WITH observacao_recente AS (
    SELECT k.id_pessoa_projeto, o.titulo, o.nome, o.nascimento, o.registro
    FROM (
        SELECT DISTINCT ON (m.id_pessoa_projeto)
               m.id_pessoa_projeto, o.ano_eleicao, o.sq_candidato
        FROM stg_tse.observacao_pessoa o
        JOIN stg_tse.mapa_candidatura m USING (ano_eleicao, sq_candidato)
        ORDER BY m.id_pessoa_projeto, o.ano_eleicao DESC, o.sq_candidato
    ) k
    JOIN stg_tse.observacao_pessoa o USING (ano_eleicao, sq_candidato)
), cpf_recente AS (
    SELECT k.id_pessoa_projeto, o.cpf
    FROM (
        SELECT DISTINCT ON (m.id_pessoa_projeto)
               m.id_pessoa_projeto, o.ano_eleicao, o.sq_candidato
        FROM stg_tse.observacao_pessoa o
        JOIN stg_tse.mapa_candidatura m USING (ano_eleicao, sq_candidato)
        WHERE o.cpf IS NOT NULL
        ORDER BY m.id_pessoa_projeto, o.ano_eleicao DESC, o.sq_candidato
    ) k
    JOIN stg_tse.observacao_pessoa o USING (ano_eleicao, sq_candidato)
)
INSERT INTO candidato(id_pessoa_projeto,nr_titulo_eleitoral_candidato,nr_cpf_candidato,
 nm_candidato,dt_nascimento,ds_grau_instrucao,ds_genero,ds_cor_raca)
SELECT o.id_pessoa_projeto,coalesce(t.titulo,o.titulo),c.cpf,
 o.nome,CASE WHEN o.nascimento ~ '^\d{2}/\d{2}/\d{4}$' THEN to_date(o.nascimento,'DD/MM/YYYY') END,
 stg_tse.texto_publicado(o.registro->>'ds_grau_instrucao'),
 stg_tse.texto_publicado(o.registro->>'ds_genero'),stg_tse.texto_publicado(o.registro->>'ds_cor_raca')
FROM observacao_recente o
LEFT JOIN cpf_recente c USING (id_pessoa_projeto)
LEFT JOIN stg_tse.mapa_titulo t ON t.id_pessoa_projeto=o.id_pessoa_projeto
ON CONFLICT(id_pessoa_projeto) DO UPDATE SET
 nr_titulo_eleitoral_candidato=EXCLUDED.nr_titulo_eleitoral_candidato,
 nr_cpf_candidato=coalesce(EXCLUDED.nr_cpf_candidato,candidato.nr_cpf_candidato),
 nm_candidato=EXCLUDED.nm_candidato,dt_nascimento=EXCLUDED.dt_nascimento,
 ds_grau_instrucao=EXCLUDED.ds_grau_instrucao,ds_genero=EXCLUDED.ds_genero,ds_cor_raca=EXCLUDED.ds_cor_raca;
-- Reassocia também candidaturas antigas que não estão no staging atual.
UPDATE candidatura c SET id_pessoa_projeto=m.id_pessoa_projeto
FROM stg_tse.mapa_candidatura m WHERE c.ano_eleicao=m.ano_eleicao AND c.sq_candidato=m.sq_candidato;
-- Atualiza as estatísticas após a carga em massa e a reconciliação de IDs.
ANALYZE candidato;
ANALYZE candidatura;
ANALYZE stg_tse.mapa_candidatura;
ANALYZE stg_tse.migracao_pessoa;
DELETE FROM candidato c WHERE EXISTS (SELECT 1 FROM stg_tse.migracao_pessoa x WHERE x.id_anterior=c.id_pessoa_projeto)
 AND NOT EXISTS(SELECT 1 FROM candidatura k WHERE k.id_pessoa_projeto=c.id_pessoa_projeto)
 AND NOT EXISTS(SELECT 1 FROM stg_tse.mapa_candidatura m WHERE m.id_pessoa_projeto=c.id_pessoa_projeto);

-- Em eleições municipais, SG_UE contém o código do município TSE. Eleições
-- gerais usam UF/BR e ficam com CD_MUNICIPIO_TSE NULL. Inserir apenas códigos
-- já presentes em MUNICIPIO; não criar município usando nome como chave.
-- A dimensão precisa existir antes da candidatura por causa da FK do modelo.
INSERT INTO municipio (cd_municipio_tse, cd_municipio_ibge, nm_municipio, sg_uf)
SELECT DISTINCT ON (x.cd_municipio_tse)
       x.cd_municipio_tse, x.cd_municipio_ibge, x.nm_municipio, x.sg_uf
FROM stg_tse.municipio_correspondencia x
JOIN stg_tse.escopo_uf uf ON uf.sg_uf = upper(x.sg_uf)
WHERE NULLIF(trim(x.cd_municipio_tse), '') IS NOT NULL
ORDER BY x.cd_municipio_tse, x.source_file
ON CONFLICT (cd_municipio_tse) DO UPDATE SET
    cd_municipio_ibge = coalesce(EXCLUDED.cd_municipio_ibge, municipio.cd_municipio_ibge),
    nm_municipio = coalesce(EXCLUDED.nm_municipio, municipio.nm_municipio),
    sg_uf = coalesce(EXCLUDED.sg_uf, municipio.sg_uf);

INSERT INTO candidatura (
    ano_eleicao, sq_candidato, id_pessoa_projeto, nr_partido,
    cd_municipio_tse, sg_partido, sg_ue, cd_cargo, ds_cargo,
    nr_turno_resultado, ds_sit_tot_turno
)
SELECT DISTINCT ON (s.ano_eleicao::integer, s.sq_candidato::bigint)
       s.ano_eleicao::integer,
       s.sq_candidato::bigint,
       m.id_pessoa_projeto,
       CASE WHEN s.nr_partido ~ '^[0-9]+$' THEN s.nr_partido::integer END,
       mun.cd_municipio_tse,
       NULLIF(trim(s.sg_partido), ''),
       NULLIF(trim(s.sg_ue), ''),
       CASE WHEN s.cd_cargo ~ '^[0-9]+$' THEN s.cd_cargo::integer END,
       NULLIF(trim(s.ds_cargo), ''),
       s.turno_resultado::integer,
       CASE WHEN s.turno_resultado IS NOT NULL THEN s.situacao_informada END
FROM stg_tse.candidatura_resultado s
JOIN stg_tse.mapa_candidatura m
  ON m.ano_eleicao = CASE WHEN s.ano_eleicao ~ '^[0-9]{4}$' THEN s.ano_eleicao::integer END
 AND m.sq_candidato = CASE WHEN s.sq_candidato ~ '^[0-9]+$' THEN s.sq_candidato::bigint END
LEFT JOIN municipio mun
  ON mun.cd_municipio_tse = trim(s.sg_ue)
WHERE s.ano_eleicao ~ '^[0-9]{4}$'
  AND s.sq_candidato ~ '^[0-9]+$'
  AND (upper(trim(s.sg_uf)) IN (SELECT sg_uf::text FROM stg_tse.escopo_uf)
       OR upper(trim(s.sg_uf)) = 'BR')
ORDER BY s.ano_eleicao::integer, s.sq_candidato::bigint, s.source_file, s.cd_eleicao, s.ds_sit_tot_turno
ON CONFLICT (ano_eleicao, sq_candidato) DO UPDATE SET
    id_pessoa_projeto = EXCLUDED.id_pessoa_projeto,
    nr_partido = EXCLUDED.nr_partido,
    cd_municipio_tse = EXCLUDED.cd_municipio_tse,
    sg_partido = EXCLUDED.sg_partido,
    sg_ue = EXCLUDED.sg_ue,
    cd_cargo = EXCLUDED.cd_cargo,
    ds_cargo = EXCLUDED.ds_cargo,
    nr_turno_resultado = EXCLUDED.nr_turno_resultado,
    ds_sit_tot_turno = EXCLUDED.ds_sit_tot_turno;

COMMIT;

-- VIES_POLITICO_ELEICAO requer classificação externa por partido/pleito.
-- QT_VOTOS_TOTAIS é atualizado em 04_carga_fatos_postgresql.sql a partir da
-- votação municipal, mantendo eleição, turno e cargo.
