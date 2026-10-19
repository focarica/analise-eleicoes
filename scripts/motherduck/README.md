# Carga no MotherDuck Flight

`carga_tse_motherduck_flight.py` é o script autocontido usado para adquirir dados públicos do TSE e carregar o modelo analítico no MotherDuck. Ele descobre os recursos pelo catálogo CKAN do TSE, baixa e normaliza temporariamente os arquivos e publica as tabelas do modelo e as views.

## Complemento de Presidente (cargo 1)

A votação de Presidente por município não constava da carga inicial: os ZIPs do TSE munzona por UF não trazem esse cargo — ele só aparece no arquivo BR incluído no próprio ZIP. O banco de referência (`BDR-TSE`) é um share somente leitura, e a escolha do projeto é manter uma cópia modificável do modelo (`BDR-TSE-2026`) na mesma conta do token do painel.

Fluxo (reproduz a atualização; requer os ZIPs `votacao_partido_munzona_{2018,2022}.zip` e `votacao_candidato_munzona_{2018,2022}.zip` do TSE):

```sh
# 1. Extrai o cargo 1 dos arquivos BR e agrega pelo grão das tabelas publicadas
python scripts/motherduck/complementar_presidente.py --zip-dir /tmp/opencode/tse --output /tmp/opencode/tse

# 2. Copia as 11 tabelas do share, publica o cargo 1, atualiza os votos
#    nacionais de 1º turno e recria as views (usa o token do painel)
bun scripts/motherduck/copia_banco_presidente.ts   # com frontend/.env na raiz
```

`carga_presidente.ts` é a variante que só aplica o complemento num banco já copiado; rodar `--output` do passo 1 é o caminho canônico. Todos os scripts usam token por parâmetro de conexão e não abrem fluxo SSO ambíguo.

## Executar

Execute o script em um Flight com Python e rede disponíveis. Configure o Flight para usar o banco MotherDuck `BDR-TSE`; o ambiente fornece a autenticação MotherDuck. O script não contém credenciais. Revise e ajuste no próprio arquivo os anos e estados do recorte antes de iniciar uma nova carga.

O fluxo Flight não depende dos arquivos PostgreSQL em `data/raw/` nem dos CSVs locais. As tabelas intermediárias são temporárias e não fazem parte do DER publicado.

## Transformação SQL

`sql/motherduck/02_carga_modelo.sql` documenta a transformação das tabelas temporárias criadas pelo Flight para as 11 tabelas do modelo. Como depende desse staging, não é um script autônomo para executar manualmente.

Para reaplicar as views num banco já carregado, siga [sql/motherduck/README.md](../../sql/motherduck/README.md). A carga completa inclui também as duas views da questão 9 em `03_views_propaganda.sql`.

## Recuperar categorias e criar as views da questão 9

`preencher_categorias_despesas.py` recupera `DS_ORIGEM_DESPESA` nos arquivos de despesas pagas de 2018, 2020, 2022 e 2024, no recorte AC/AL/BA/DF/RO/SP, mais BR para as candidaturas nacionais existentes. Requer Python 3.10+, `duckdb` e `requests`, e uma conexão MotherDuck com permissão de escrita para aplicar.

Na raiz do repositório, com as dependências instaladas no seu ambiente Python:

```sh
# Primeiro: adquirir, normalizar e conferir a cobertura, sem atualizar o banco.
python scripts/motherduck/preencher_categorias_despesas.py --env-file frontend/.env

# Depois: aplicar as categorias reconciliadas e criar as duas views da Q9.
python scripts/motherduck/preencher_categorias_despesas.py --env-file frontend/.env --apply
```

Também aceita `MOTHERDUCK_TOKEN` no ambiente, `--database` e `--work-dir`. Credenciais não são impressas. Os ZIPs locais são subconjuntos dos arquivos oficiais, obtidos por HTTP Range e conferidos pelo CRC de cada membro; somente os arquivos financeiros relevantes são baixados. URL, versão HTTP, tamanhos e CRCs ficam em manifestos no diretório de trabalho, cujo padrão é `/tmp/tse_categorias_2018_2024`.

O script reproduz o filtro de prestação FINAL mais recente e a vinculação de conta à candidatura usada na carga original. Primeiro reconcilia por ano, SQ, descrição e valor, quando a categoria é unívoca nessa combinação. Para os demais registros, pode reconstruir a ordem original dos IDs MotherDuck: só aceita esse método quando **todos** os IDs, descrições, valores e contagens da candidatura conferem e a chave TSE do lançamento é única (sem desempate pelo hash). Casos ainda conflitantes ou sem correspondência ficam sem alteração e aparecem na contagem de pendências. O relatório separa os dois métodos; nenhum ID é recriado.

O segundo método é específico do MotherDuck carregado com `ROW_NUMBER` por `id_linha_origem`. Não use esse script para recuperar categorias de um banco importado de PostgreSQL que tenha IDs do `mapa_lancamento`; nesse caso recupere pela chave original preservada no staging.

A aplicação é transacional: altera somente `ds_categoria_despesa`, cria as duas views e verifica que quantidade de despesas e soma paga por ano não mudaram. Todas as tabelas de trabalho são temporárias. O relatório `reconciliacao.json` fica fora do repositório, no diretório de trabalho.

O diretório de trabalho serve de cache para repetir a validação/aplicação. Para consultar uma nova versão dos arquivos do TSE, use outro `--work-dir`. Não publique esse diretório nem seus CSVs/ZIPs.

## Executar a recuperação em um Flight

Se o token local for somente de leitura (como deve ser o token do painel), gere o programa autocontido:

```sh
python scripts/motherduck/gerar_flight_categorias.py --output /tmp/tse_categorias_flight.py
```

Crie um Flight sob demanda com esse código e as dependências `duckdb==1.5.6` e `requests==2.34.2`. Configure um token de carga com escrita no banco `BDR-TSE`. O programa gerado já aplica a atualização (`--apply`); ele usa somente a autenticação fornecida pelo runtime. Não troque o token do frontend por um token de escrita.

Confira o resultado terminal `SUCCEEDED`, a cobertura, os métodos de recuperação e os totais antes/depois nos logs. Criar ou iniciar um Flight não comprova que a atualização foi concluída. O Flight principal de carga completa também deve usar o normalizador e os SQLs atualizados.
