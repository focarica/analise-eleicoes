-- Executar após 01 e antes de 03, com search_path no destino escolhido.
BEGIN;
ALTER TABLE stg_tse.candidatura ADD COLUMN IF NOT EXISTS nr_titulo_eleitoral_candidato text;
ALTER TABLE candidato ADD COLUMN IF NOT EXISTS nr_titulo_eleitoral_candidato varchar(12);
CREATE UNIQUE INDEX IF NOT EXISTS candidato_titulo_unico
    ON candidato (nr_titulo_eleitoral_candidato)
    WHERE nr_titulo_eleitoral_candidato IS NOT NULL;
ALTER TABLE stg_tse.mapa_candidatura
    DROP CONSTRAINT IF EXISTS mapa_candidatura_id_pessoa_projeto_key;
CREATE INDEX IF NOT EXISTS mapa_candidatura_pessoa_idx
    ON stg_tse.mapa_candidatura (id_pessoa_projeto);
CREATE TABLE IF NOT EXISTS stg_tse.observacao_pessoa (
    ano_eleicao integer NOT NULL, sq_candidato bigint NOT NULL,
    titulo text, cpf text, nome text, nascimento text,
    registro jsonb NOT NULL,
    PRIMARY KEY (ano_eleicao, sq_candidato)
);
CREATE TABLE IF NOT EXISTS stg_tse.mapa_titulo (
    titulo varchar(12) PRIMARY KEY,
    id_pessoa_projeto integer NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS observacao_pessoa_titulo_idx
    ON stg_tse.observacao_pessoa (titulo);
CREATE TABLE IF NOT EXISTS stg_tse.migracao_pessoa (
    id_anterior integer NOT NULL, id_mantido integer NOT NULL,
    ano_eleicao integer NOT NULL, sq_candidato bigint NOT NULL,
    regra text NOT NULL DEFAULT 'TITULO_UNICO_DECISAO_GRUPO',
    PRIMARY KEY (id_anterior, id_mantido, ano_eleicao, sq_candidato)
);
CREATE OR REPLACE VIEW stg_tse.conflitos_identidade AS
SELECT titulo, count(DISTINCT upper(nome)) AS nomes,
       count(DISTINCT nascimento) AS nascimentos,
       count(DISTINCT cpf) AS cpfs
FROM stg_tse.observacao_pessoa WHERE titulo IS NOT NULL
GROUP BY titulo
HAVING count(DISTINCT upper(nome)) > 1 OR count(DISTINCT nascimento) > 1
    OR count(DISTINCT cpf) > 1;
-- Completude financeira: arquivo completo pode comprovar zero linhas;
-- ausência de cobertura não significa gasto zero.
CREATE TABLE IF NOT EXISTS stg_tse.cobertura_despesa_paga (
    ano_eleicao integer NOT NULL, sq_candidato bigint NOT NULL,
    completo boolean NOT NULL, source_manifest text NOT NULL,
    PRIMARY KEY (ano_eleicao, sq_candidato)
);
DROP VIEW IF EXISTS custo_cadeira;
CREATE OR REPLACE VIEW custo_cadeira AS
WITH gastos AS (
    SELECT ano_eleicao,sq_candidato,sum(vr_pago) AS total,
           bool_and(vr_pago IS NOT NULL) AS valores_validos
    FROM despesas_pagas GROUP BY 1,2
), eleitos AS (
    SELECT c.*, stg_tse.inteiro_nao_negativo(o.registro->>'cd_eleicao') AS cd_eleicao,
           CASE WHEN k.completo AND coalesce(g.valores_validos,true)
                     THEN coalesce(g.total,0) END AS gasto_pago
    FROM candidatura c
    LEFT JOIN stg_tse.observacao_pessoa o USING (ano_eleicao,sq_candidato)
    LEFT JOIN gastos g USING (ano_eleicao,sq_candidato)
    LEFT JOIN stg_tse.cobertura_despesa_paga k USING (ano_eleicao,sq_candidato)
    WHERE upper(trim(c.ds_sit_tot_turno)) IN ('ELEITO','ELEITO POR QP','ELEITO POR MÉDIA')
)
SELECT ano_eleicao,cd_eleicao,cd_cargo,ds_cargo,nr_turno_resultado,
       count(*) AS qt_eleitos,count(gasto_pago) AS qt_eleitos_com_gasto_validado,
       count(gasto_pago)=count(*) AS completo,
       CASE WHEN count(gasto_pago)=count(*) THEN avg(gasto_pago) END AS valor_cadeira,
       avg(gasto_pago) AS media_parcial_identificada
FROM eleitos GROUP BY 1,2,3,4,5;
COMMIT;
