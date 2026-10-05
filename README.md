# Análise de eleições: carga TSE em PostgreSQL

Este repositório contém o modelo relacional de destino, as tabelas de staging e o fluxo para baixar, normalizar e carregar dados públicos do TSE. Os arquivos de dados não são versionados: cada pessoa os obtém no [Portal de Dados Abertos do TSE](https://dadosabertos.tse.jus.br/).

O recorte de referência inclui AC, AL, BA, DF, RO e SP nos pleitos de 2018, 2020, 2022 e 2024. As constantes de anos e UFs ficam no início de `scripts/normalizar_dados_tse.py`; o escopo no banco fica em `stg_tse.escopo_uf`, definido por `sql/01_staging_postgresql.sql`. Ajuste os dois em conjunto para outro recorte. O normalizador considera eleições gerais e municipais; compare resultados respeitando o tipo de pleito, cargo, turno e circunscrição.

## Requisitos

- Docker com Docker Compose
- Python 3.10 ou superior (bibliotecas padrão)
- `psql` cliente PostgreSQL
- Espaço livre para os ZIPs originais e os CSVs intermediários; arquivos de prestação de contas podem ser grandes

## Preparar o PostgreSQL local

```sh
cp .env.example .env
```

Edite `.env`, trocando a senha tanto em `POSTGRES_PASSWORD` quanto em `DATABASE_URL`. Em seguida:

```sh
docker compose up -d
set -a
. ./.env
set +a
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/00_schema_destino.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/01_staging_postgresql.sql
```

Use um banco de desenvolvimento descartável. `00_schema_destino.sql` cria as entidades finais do modelo. `01_staging_postgresql.sql` cria `stg_tse`, que guarda importações e estruturas auxiliares de execução. Essas estruturas ficam separadas das tabelas finais.

## Obter os dados

No portal do TSE, localize os arquivos CSV compactados correspondentes aos seguintes conjuntos e anos: candidaturas (`consulta_cand`), complemento de candidaturas (`consulta_cand_complementar`), bens (`bem_candidato`), votos por candidato/município/zona (`votacao_candidato_munzona`), votos por partido/município/zona (`votacao_partido_munzona`), comparecimento por município/zona (`detalhe_votacao_munzona`), perfil do eleitorado (`perfil_eleitorado`) e prestações de contas de candidatos (`prestacao_de_contas_eleitorais_candidatos`).

Crie `data/raw/` e salve 32 ZIPs com nomes exatos no padrão `<conjunto>_<ano>.zip`, por exemplo `consulta_cand_2024.zip`. O script espera cada um dos oito conjuntos para cada ano de 2018, 2020, 2022 e 2024. Os nomes internos, cabeçalhos e disponibilidade variam entre edições; use os arquivos/documentação publicados pelo TSE e confira se correspondem ao ano e conjunto antes de renomear. Não descompacte os arquivos manualmente.

## Normalizar e importar

A normalização lê os CSVs dentro dos ZIPs (codificação de origem Latin-1), seleciona os estados configurados e gera CSVs temporários UTF-8 delimitados por `;`. Valores sentinela do TSE são preservados para que as funções SQL tratem ausência sem convertê-la em zero.

```sh
python3 scripts/normalizar_dados_tse.py --zip-dir data/raw --output data/staging
python3 scripts/carregar_staging.py --input data/staging
```

O carregador substitui o conteúdo das tabelas de entrada de staging dentro de uma transação, sem apagar os mapas persistentes de identificadores usados pelas cargas incrementais. Para repetir um lote do zero e reiniciar esses mapas, use um banco novo.

## Publicar as tabelas finais

Execute na ordem abaixo, no mesmo banco e com as entradas carregadas:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/05_identidade_e_cadeira.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/03_carga_candidaturas_postgresql.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/04_carga_fatos_postgresql.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/02_agregacoes_e_consultas.sql
```

A etapa 05 prepara a identificação por título eleitoral quando publicado pelo TSE e cria a visão analítica `custo_cadeira`. A etapa 03 carrega partidos e candidaturas; a 04 carrega fatos. A etapa 02 contém consultas de auditoria sobre staging. Confira os resultados e as mensagens do PostgreSQL antes de usar as tabelas em análises.

## Conteúdo

- `sql/00_schema_destino.sql`: entidades finais do projeto
- `sql/01_staging_postgresql.sql`: staging e funções de conversão
- `sql/02_agregacoes_e_consultas.sql`: consultas de validação
- `sql/03_carga_candidaturas_postgresql.sql`: candidatos, partidos e candidaturas
- `sql/04_carga_fatos_postgresql.sql`: votos, perfil, comparecimento, bens e finanças
- `sql/05_identidade_e_cadeira.sql`: título eleitoral e visão de custo médio por cadeira
- `sql/06_reparar_candidatura_municipio_votos.sql`: correção transacional para bancos já carregados antes da dimensão municipal
- `scripts/normalizar_dados_tse.py`: leitura dos ZIPs e geração dos CSVs de entrada
- `scripts/carregar_staging.py`: importação transacional dos CSVs para PostgreSQL

O repositório contém somente código e definições SQL. Não contém credenciais, arquivos brutos, CSVs de carga, dumps, dados pessoais extraídos, relatórios ou resultados de execução.
