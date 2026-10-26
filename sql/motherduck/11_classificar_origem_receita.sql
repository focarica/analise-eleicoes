-- Recupera classificações inequívocas a partir da fonte publicada pelo TSE.
-- Não tenta classificar recursos de partido/comitê, origens não especificadas,
-- rendimentos financeiros nem "outros recursos" de 2016: a composição é ambígua.
-- Para 2018+, "OUTROS RECURSOS" segue a regra já usada pelas views do projeto.
UPDATE public.receitas_campanha
SET tp_origem_recurso = CASE
    WHEN ano_eleicao >= 2018
      AND UPPER(TRIM(ds_fonte_receita)) = 'OUTROS RECURSOS'
        THEN 'PRIVADO'
    WHEN UPPER(strip_accents(TRIM(ds_fonte_receita))) IN (
        'FUNDO ESPECIAL',
        'FUNDO PARTIDARIO',
        'RECURSOS DO FUNDO PARTIDARIO',
        'FUNDO PARTIDAO'
    ) THEN 'PÚBLICO'
    WHEN UPPER(strip_accents(TRIM(ds_fonte_receita))) IN (
        'RECURSOS PROPRIOS',
        'RECURSOS DE PESSOAS FISICAS',
        'RECURSOS DE PESSOAS JURIDICAS',
        'COMERCIALIZACAO DE BENS OU REALIZACAO DE EVENTOS',
        'DESCRICAO DAS DOACOES RELATIVAS A COMERCIALIZACAO',
        'DESCRICOES DAS DOACOES RELATIVAS A COMERCIALIZACAO',
        'DESCRICOES DAS DOACOES RELATIVAS A COMERCIALIZACAO OU EVENTO'
    ) THEN 'PRIVADO'
    ELSE NULL
END;
