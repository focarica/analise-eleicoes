-- Fato municipal temporal do IDHM (Atlas Brasil 2013, Censos 2000/2010 no escopo atual).
CREATE TABLE IF NOT EXISTS public.fato_idhm_atlas (
    codmun7 VARCHAR(7) NOT NULL,
    ano_referencia SMALLINT NOT NULL,
    idhm DECIMAL(5,3),
    idhm_r DECIMAL(5,3),
    idhm_l DECIMAL(5,3),
    idhm_e DECIMAL(5,3),
    PRIMARY KEY (codmun7, ano_referencia)
);

-- Carga reproduzível: python scripts/motherduck/carregar_idhm_atlas.py
-- A fonte institucional original está identificada no script; como o endpoint
-- antigo não está disponível, o script baixa uma cópia pública da planilha.
