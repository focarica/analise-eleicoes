-- Migração estrutural idempotente. O backfill dos valores TSE 2004–2016 e a
-- atualização das views são feitos pelo Flight dedicado, com reconciliação
-- integral das chaves e descrições antes do UPDATE.
ALTER TABLE public.despesas_pagas
    ADD COLUMN IF NOT EXISTS vr_despesa_declarada DECIMAL(14,2);
