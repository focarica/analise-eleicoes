# Análise de eleições: dados do TSE em MotherDuck e PostgreSQL

Este repositório contém o modelo relacional de destino, as tabelas de staging e o fluxo para baixar, normalizar e carregar dados públicos do TSE. Os arquivos de dados não são versionados: cada pessoa os obtém no [Portal de Dados Abertos do TSE](https://dadosabertos.tse.jus.br/).

## MotherDuck e painel web

O banco analítico publicado chama-se `BDR-TSE`. A carga de referência cobre AC, AL, BA, DF, RO e SP, nos anos 2018, 2020, 2022 e 2024. Ela publica somente as 11 tabelas do modelo e as quatro views definidas em `sql/motherduck/01_views_analiticas.sql`. Não inclui staging, relatórios de execução ou arquivos brutos.

O painel em `frontend/` usa TypeScript, Vite e Bun. O navegador chama uma API local Bun; somente essa API conecta ao MotherDuck com DuckDB. O token fica no servidor e nunca é enviado ao navegador.

```sh
cd frontend
cp .env.example .env
# Edite .env e informe MOTHERDUCK_TOKEN,
bun install
bun run dev
```

Abra `http://127.0.0.1:5173`. Para gerar e servir a versão de produção local: `bun run build && bun run start`; o servidor usa `PORT` quando definido e, por padrão, a porta 3001. O token pode ser criado nas configurações da conta MotherDuck. Use um token adequado a consultas de leitura.

O painel preserva o layout e as interações do HTML de apresentação: mapa por partido com áreas proporcionais, navegação por estado/ano, filtro de cargo, busca e gaveta de detalhes. Consulta `v_partidos_eleitos`, `vw_questao_2_despesas` (visão oficial da questão 2), `v_historico_candidato` e tabelas municipais. O snapshot gzipado de 62 MB foi removido; os dados vêm ao vivo do MotherDuck.

### Recriar a carga MotherDuck

`scripts/motherduck/carga_tse_motherduck_flight.py` é o código autocontido executado no MotherDuck Flight. Ele descobre e baixa as fontes públicas pelo CKAN do TSE, normaliza temporariamente os arquivos e publica o modelo e as views. Configure o Flight para usar o banco `BDR-TSE`; autenticação MotherDuck é fornecida pelo próprio ambiente Flight. O arquivo não contém credenciais. `sql/motherduck/02_carga_modelo.sql` documenta a transformação e depende das tabelas temporárias de staging preparadas pelo Flight; não é um script isolado para rodar manualmente.

Para reaplicar somente as views a um banco já carregado, abra `sql/motherduck/01_views_analiticas.sql` no editor SQL MotherDuck com `BDR-TSE` selecionado.

O `ID_PESSOA_PROJETO` é estável por título eleitoral divulgado; sem título, identifica apenas aquela candidatura. Uma carga histórica mais ampla deve recalcular os IDs no conjunto completo. O HTML legado com snapshot embutido não é usado pelo painel novo.

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

Em `CONSULTA_CAND`, `NM_URNA_CANDIDATO` é carregado em `CANDIDATURA`, junto ao ano e ao sequencial TSE, pois o nome exibido pode mudar entre pleitos. Em bancos já existentes, aplique `sql/07_nome_urna_candidatura.sql` no schema de destino antes de executar a carga 03; bancos novos recebem a coluna por `sql/00_schema_destino.sql`.

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
- `sql/07_nome_urna_candidatura.sql`: migração aditiva para bancos existentes; o schema novo já inclui o campo em `CANDIDATURA`
- `sql/motherduck/01_views_analiticas.sql`: quatro views analíticas para o banco DuckDB/MotherDuck
- `sql/motherduck/02_carga_modelo.sql`: transformação DuckDB do staging local para as 11 tabelas do DER
- `scripts/motherduck/carga_tse_motherduck_flight.py`: Flight autocontido que descobre, baixa e carrega os arquivos do TSE no MotherDuck
- `frontend/`: painel TypeScript + Vite servido por Bun e conectado ao MotherDuck no backend
- `scripts/normalizar_dados_tse.py`: leitura dos ZIPs e geração dos CSVs de entrada
- `scripts/carregar_staging.py`: importação transacional dos CSVs para PostgreSQL

O repositório contém somente código e definições SQL. Não contém credenciais, arquivos brutos, CSVs de carga, dumps, dados pessoais extraídos, relatórios ou resultados de execução.
