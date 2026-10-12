-- Q9: nuvens de palavras das descrições de despesas de propaganda.
-- Banco BDR-TSE, schema public. Requer DS_ORIGEM_DESPESA carregada em
-- despesas_pagas.ds_categoria_despesa. Nenhuma tabela auxiliar persistente.
-- Escopo explícito: publicidade, produção de comunicação, internet,
-- eventos/comícios e mobilização de rua. Não inferir propaganda de rubricas
-- genéricas como pessoal ou serviços de terceiros.

CREATE OR REPLACE VIEW public.vw_questao_9_nuvem_valor AS
WITH propaganda AS (
    SELECT ano_eleicao,sq_candidato,id_despesa,ds_despesa,vr_pago
    FROM public.despesas_pagas
    WHERE LOWER(strip_accents(TRIM(ds_categoria_despesa))) IN (
        'publicidade por carros de som',
        'publicidade por adesivos',
        'publicidade por jornais e revistas',
        'publicidade por materiais impressos',
        'producao de programas de radio, televisao ou video',
        'producao de jingles, vinhetas e slogans',
        'criacao e inclusao de paginas na internet',
        'despesa com impulsionamento de conteudos',
        'eventos de promocao da candidatura',
        'comicios',
        'atividades de militancia e mobilizacao de rua'
    )
      AND ds_despesa IS NOT NULL AND vr_pago > 0
), tokens AS (
    -- Um termo conta uma vez por lançamento, mesmo se repetido na descrição.
    SELECT DISTINCT p.ano_eleicao,p.sq_candidato,p.id_despesa,p.vr_pago,t.termo
    FROM propaganda p,
         UNNEST(regexp_split_to_array(
             LOWER(strip_accents(p.ds_despesa)), '[^a-z]+'
         )) AS t(termo)
    WHERE LENGTH(t.termo) >= 3
      AND t.termo NOT IN (
        'com','para','por','dos','das','uma','uns','umas','que','como','sem',
        'sob','sobre','entre','este','esta','esse','essa','estes','estas',
        'esses','essas','pelo','pela','pelos','pelas','seu','sua','seus','suas',
        'foi','sao','ser','dia','dias','mes','meses','ano','anos',
        'servico','servicos','prestacao','prestado','prestados','prestada',
        'prestadas','referente','referentes','conforme','contrato','contratos',
        'contratacao','pagamento','pagamentos','pago','paga','pagos','pagas',
        'nota','notas','fiscal','fiscais','nfe','nfse','recibo','recibos',
        'eleicao','eleicoes','eleitoral','eleitorais','campanha','campanhas',
        'candidato','candidatos','candidata','candidatas','candidatura',
        'realizado','realizada','realizados','realizadas'
      )
), termos AS (
    SELECT ano_eleicao,sq_candidato,termo,
           SUM(vr_pago) AS valor_pago_associado,
           COUNT(*) AS qt_lancamentos
    FROM tokens
    GROUP BY 1,2,3
)
SELECT t.ano_eleicao,t.sq_candidato,c.id_pessoa_projeto,
       pessoa.nm_candidato,c.nm_urna_candidato,
       COALESCE(m.sg_uf,c.sg_ue) AS uf,c.cd_municipio_tse,
       c.ds_cargo,c.nr_partido,c.sg_partido,t.termo,
       t.valor_pago_associado,t.qt_lancamentos,
       t.valor_pago_associado AS peso
FROM termos t
JOIN public.candidatura c USING(ano_eleicao,sq_candidato)
LEFT JOIN public.candidato pessoa USING(id_pessoa_projeto)
LEFT JOIN public.municipio m USING(cd_municipio_tse);

-- Mesmos termos, universo e métricas; só muda o peso visual.
-- Frequência = lançamentos que contêm a palavra, não unidades adquiridas
-- nem número garantido de compras/contratos (podem existir parcelas).
CREATE OR REPLACE VIEW public.vw_questao_9_nuvem_frequencia AS
SELECT * EXCLUDE(peso),qt_lancamentos AS peso
FROM public.vw_questao_9_nuvem_valor;

-- Exemplo (substitua o SQ pela candidatura desejada):
-- SELECT termo,peso,valor_pago_associado,qt_lancamentos
-- FROM public.vw_questao_9_nuvem_valor
-- WHERE ano_eleicao=2024 AND sq_candidato=250002118287
-- ORDER BY peso DESC,termo LIMIT 80;
-- Troque o nome da view por vw_questao_9_nuvem_frequencia para frequência.
-- Uma despesa pode conter várias palavras; somar pesos de palavras
-- diferentes não equivale ao orçamento total. Filtre ano E SQ sempre.
