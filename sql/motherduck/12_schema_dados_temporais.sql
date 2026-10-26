-- Fatos temporais municipais e dimensoes marginais do perfil do eleitorado.
-- Executar uma vez antes das cargas complementares. Nao cria tabelas de staging.

CREATE TABLE IF NOT EXISTS public.fato_socioeconomico_ibge (
    cd_municipio_ibge VARCHAR(7) NOT NULL,
    ano SMALLINT NOT NULL,
    populacao BIGINT,
    tipo_populacao VARCHAR(20),
    pib DECIMAL(18,2),
    pib_per_capita DECIMAL(16,2),
    renda_domiciliar_per_capita DECIMAL(16,2),
    area_km2 DECIMAL(12,3),
    densidade_hab_km2 DECIMAL(14,4),
    populacao_jovem BIGINT,
    porcentagem_analfabetismo DECIMAL(6,3),
    porcentagem_superior DECIMAL(6,3),
    vab_agropecuaria DECIMAL(18,2),
    vab_industria DECIMAL(18,2),
    vab_servicos DECIMAL(18,2),
    vab_administracao_publica DECIMAL(18,2),
    perfil_municipio VARCHAR(30),
    fonte VARCHAR(100),
    PRIMARY KEY (cd_municipio_ibge, ano)
);

CREATE TABLE IF NOT EXISTS public.fato_perfil_eleitorado (
    ano_eleicao INTEGER NOT NULL,
    cd_municipio_ibge VARCHAR(7) NOT NULL,
    tp_dimensao VARCHAR(30) NOT NULL,
    ds_categoria VARCHAR(100) NOT NULL,
    qt_eleitores BIGINT,
    PRIMARY KEY (cd_municipio_ibge, ano_eleicao, tp_dimensao, ds_categoria)
);

CREATE TABLE IF NOT EXISTS public.fato_escolaridade_populacao (
    cd_municipio_ibge VARCHAR(7) NOT NULL,
    ano_referencia SMALLINT NOT NULL,
    ds_faixa_etaria VARCHAR(40) NOT NULL,
    ds_nivel_instrucao VARCHAR(100) NOT NULL,
    qt_pessoas BIGINT NOT NULL,
    qt_populacao BIGINT NOT NULL,
    pct_populacao DECIMAL(7,4),
    PRIMARY KEY (cd_municipio_ibge, ano_referencia, ds_faixa_etaria, ds_nivel_instrucao)
);

CREATE TABLE IF NOT EXISTS public.fato_idhm_atlas (
    codmun7 VARCHAR(7) NOT NULL,
    ano_referencia SMALLINT NOT NULL,
    idhm DECIMAL(5,3),
    idhm_r DECIMAL(5,3),
    idhm_l DECIMAL(5,3),
    idhm_e DECIMAL(5,3),
    PRIMARY KEY (codmun7, ano_referencia)
);
