-- Migração aditiva: o nome exibido na urna pertence ao pleito/candidatura,
-- pois pode mudar para a mesma pessoa em eleições diferentes.
-- Execute com o schema de destino no search_path (por exemplo, public ou tse_teste).
BEGIN;
ALTER TABLE candidatura
    ADD COLUMN IF NOT EXISTS nm_urna_candidato varchar(150);
COMMIT;
