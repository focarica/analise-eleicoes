-- Execute uma vez no PostgreSQL publicado. A carga correspondente preenche
-- VR_DESPESA_DECLARADA para 2004–2016 sem reinterpretar esses valores como pagos.
ALTER TABLE public.despesas_pagas
    ADD COLUMN IF NOT EXISTS vr_despesa_declarada numeric(14,2);
