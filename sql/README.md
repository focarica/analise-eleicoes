# SQL e ordem de execução

A pasta contém o esquema PostgreSQL, staging, cargas, consultas de validação e migrações. Os arquivos DuckDB/MotherDuck estão em `motherduck/` e têm instruções próprias.

## PostgreSQL local

Prepare Docker Compose, `psql` e o arquivo `.env` na raiz do repositório. Edite a senha tanto em `POSTGRES_PASSWORD` quanto em `DATABASE_URL`, inicie o banco e crie o destino e o staging:

```sh
docker compose up -d
set -a
. ./.env
set +a
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/00_schema_destino.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/01_staging_postgresql.sql
```

Após importar os CSVs para staging com os scripts de `scripts/`, execute as etapas nesta ordem:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/05_identidade_e_cadeira.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/03_carga_candidaturas_postgresql.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/04_carga_fatos_postgresql.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/02_agregacoes_e_consultas.sql
```

A etapa 05 prepara os IDs de projeto por título eleitoral quando disponível e a visão `custo_cadeira`; a etapa 03 carrega candidatos, partidos e candidaturas; a etapa 04 carrega os fatos; a 02 contém consultas de auditoria. Confira mensagens e contagens antes de usar o banco em análises.

## Arquivos

- `00_schema_destino.sql`: entidades finais.
- `01_staging_postgresql.sql`: schema `stg_tse` e conversões de valores.
- `02_agregacoes_e_consultas.sql`: consultas de validação do staging.
- `03_carga_candidaturas_postgresql.sql`: candidatos, partidos e candidaturas.
- `04_carga_fatos_postgresql.sql`: votos, perfil, comparecimento, bens e finanças.
- `05_identidade_e_cadeira.sql`: identidade por título e visão de custo médio por cadeira.
- `06_reparar_candidatura_municipio_votos.sql`: reparo para bancos carregados antes da dimensão municipal.
- `07_nome_urna_candidatura.sql`: migração aditiva para adicionar nome de urna a bancos existentes; bancos novos já recebem o campo pelo schema.
- `motherduck/`: views e transformação para DuckDB/MotherDuck; ver [README](motherduck/README.md).

Use um banco de desenvolvimento descartável. `stg_tse` e suas estruturas auxiliares são staging, não entidades do modelo final.
