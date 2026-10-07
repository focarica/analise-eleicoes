# Carga no MotherDuck Flight

`carga_tse_motherduck_flight.py` é o script autocontido usado para adquirir dados públicos do TSE e carregar o modelo analítico no MotherDuck. Ele descobre os recursos pelo catálogo CKAN do TSE, baixa e normaliza temporariamente os arquivos e publica as tabelas do modelo e as views.

## Executar

Execute o script em um Flight com Python e rede disponíveis. Configure o Flight para usar o banco MotherDuck `BDR-TSE`; o ambiente fornece a autenticação MotherDuck. O script não contém credenciais. Revise e ajuste no próprio arquivo os anos e estados do recorte antes de iniciar uma nova carga.

O fluxo Flight não depende dos arquivos PostgreSQL em `data/raw/` nem dos CSVs locais. As tabelas intermediárias são temporárias e não fazem parte do DER publicado.

## Transformação SQL

`sql/motherduck/02_carga_modelo.sql` documenta a transformação das tabelas temporárias criadas pelo Flight para as 11 tabelas do modelo. Como depende desse staging, não é um script autônomo para executar manualmente.

Para reaplicar apenas as quatro views num banco já carregado, siga [sql/motherduck/README.md](../../sql/motherduck/README.md).
