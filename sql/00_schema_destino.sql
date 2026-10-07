-- Modelo de destino do projeto. Somente entidades finais; o staging fica no
-- schema stg_tse e é criado por 01_staging_postgresql.sql.

CREATE TABLE IF NOT EXISTS municipio (
    cd_municipio_tse varchar(10) PRIMARY KEY,
    cd_municipio_ibge varchar(7),
    nm_municipio varchar(100),
    sg_uf varchar(2),
    pib_per_capita numeric(14,2),
    idhm numeric(4,3),
    populacao_total integer
);

CREATE TABLE IF NOT EXISTS candidato (
    id_pessoa_projeto integer PRIMARY KEY,
    nr_cpf_candidato varchar(14),
    nm_candidato varchar(150),
    dt_nascimento date,
    ds_grau_instrucao varchar(50),
    ds_genero varchar(50),
    ds_cor_raca varchar(50),
    nr_titulo_eleitoral_candidato varchar(12)
);
CREATE UNIQUE INDEX IF NOT EXISTS candidato_titulo_unico
    ON candidato (nr_titulo_eleitoral_candidato)
    WHERE nr_titulo_eleitoral_candidato IS NOT NULL;

CREATE TABLE IF NOT EXISTS partido (
    nr_partido integer PRIMARY KEY,
    sg_partido varchar(15),
    nm_partido varchar(100),
    vies_politico varchar(50)
);

CREATE TABLE IF NOT EXISTS candidatura (
    ano_eleicao integer NOT NULL,
    sq_candidato bigint NOT NULL,
    id_pessoa_projeto integer REFERENCES candidato(id_pessoa_projeto),
    nr_partido integer REFERENCES partido(nr_partido),
    cd_municipio_tse varchar(10) REFERENCES municipio(cd_municipio_tse),
    sg_partido varchar(15),
    sg_ue varchar(10),
    cd_cargo integer,
    ds_cargo varchar(50),
    nm_urna_candidato varchar(150),
    nr_turno_resultado integer,
    ds_sit_tot_turno varchar(50),
    vies_politico_eleicao varchar(50),
    qt_votos_totais integer,
    PRIMARY KEY (ano_eleicao, sq_candidato)
);

ALTER TABLE candidatura
    ADD COLUMN IF NOT EXISTS nm_urna_candidato varchar(150);

CREATE TABLE IF NOT EXISTS bens_declarados (
    ano_eleicao integer NOT NULL,
    sq_candidato bigint NOT NULL,
    id_bem integer NOT NULL,
    ds_tipo_bem varchar(150),
    ds_bem text,
    vr_bem numeric(14,2),
    PRIMARY KEY (ano_eleicao, sq_candidato, id_bem),
    FOREIGN KEY (ano_eleicao, sq_candidato)
        REFERENCES candidatura(ano_eleicao, sq_candidato)
);

CREATE TABLE IF NOT EXISTS receitas_campanha (
    ano_eleicao integer NOT NULL,
    sq_candidato bigint NOT NULL,
    id_receita integer NOT NULL,
    ds_fonte_receita varchar(150),
    tp_origem_recurso varchar(50),
    vr_receita numeric(14,2),
    PRIMARY KEY (ano_eleicao, sq_candidato, id_receita),
    FOREIGN KEY (ano_eleicao, sq_candidato)
        REFERENCES candidatura(ano_eleicao, sq_candidato)
);

CREATE TABLE IF NOT EXISTS despesas_pagas (
    ano_eleicao integer NOT NULL,
    sq_candidato bigint NOT NULL,
    id_despesa integer NOT NULL,
    ds_despesa text,
    ds_categoria_despesa varchar(150),
    vr_pago numeric(14,2),
    PRIMARY KEY (ano_eleicao, sq_candidato, id_despesa),
    FOREIGN KEY (ano_eleicao, sq_candidato)
        REFERENCES candidatura(ano_eleicao, sq_candidato)
);

CREATE TABLE IF NOT EXISTS perfil_eleitorado (
    cd_municipio_tse varchar(10) NOT NULL REFERENCES municipio(cd_municipio_tse),
    ano_eleicao integer NOT NULL,
    ds_faixa_etaria varchar(50) NOT NULL,
    qt_eleitores integer,
    PRIMARY KEY (cd_municipio_tse, ano_eleicao, ds_faixa_etaria)
);

CREATE TABLE IF NOT EXISTS comparecimento_municipio (
    ano_eleicao integer NOT NULL,
    cd_eleicao integer NOT NULL,
    nr_turno integer NOT NULL,
    cd_municipio_tse varchar(10) NOT NULL REFERENCES municipio(cd_municipio_tse),
    qt_aptos integer,
    qt_comparecimento integer,
    qt_abstencao integer,
    PRIMARY KEY (ano_eleicao, cd_eleicao, nr_turno, cd_municipio_tse)
);

CREATE TABLE IF NOT EXISTS votacao_partido (
    ano_eleicao integer NOT NULL,
    cd_eleicao integer NOT NULL,
    nr_turno integer NOT NULL,
    cd_cargo integer NOT NULL,
    cd_municipio_tse varchar(10) NOT NULL REFERENCES municipio(cd_municipio_tse),
    nr_partido integer NOT NULL REFERENCES partido(nr_partido),
    sg_partido varchar(15),
    qt_votos_legenda integer,
    qt_votos_nominais integer,
    PRIMARY KEY (ano_eleicao, cd_eleicao, nr_turno, cd_cargo, cd_municipio_tse, nr_partido)
);

CREATE TABLE IF NOT EXISTS votacao_candidato_municipio (
    ano_eleicao integer NOT NULL,
    cd_eleicao integer NOT NULL,
    nr_turno integer NOT NULL,
    cd_cargo integer NOT NULL,
    cd_municipio_tse varchar(10) NOT NULL REFERENCES municipio(cd_municipio_tse),
    sq_candidato bigint NOT NULL,
    qt_votos_nominais integer,
    PRIMARY KEY (ano_eleicao, cd_eleicao, nr_turno, cd_cargo, cd_municipio_tse, sq_candidato),
    FOREIGN KEY (ano_eleicao, sq_candidato)
        REFERENCES candidatura(ano_eleicao, sq_candidato)
);
