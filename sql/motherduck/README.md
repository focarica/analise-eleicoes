# SQL do MotherDuck

Esta pasta contém as views analíticas e o SQL que transforma o staging do Flight nas 11 tabelas do DER.

## Views

`01_views_analiticas.sql` cria quatro views no schema `public` do banco `BDR-TSE`:

- `v_partidos_eleitos`: total de eleitos titulares por UF, ano, partido e cargo.
- `v_gasto_sucesso`: candidatos em faixas iguais de gasto, com estatísticas de sucesso.
- `vw_questao_2_despesas`: view oficial da questão 2, baseada na regra financeira aprovada.
- `v_historico_candidato`: histórico de candidaturas com receitas, despesas e bens agregados.

Para reaplicar as views em um banco já carregado, conecte-se ao `BDR-TSE` no editor SQL do MotherDuck e execute `01_views_analiticas.sql`.

## Transformação do modelo

`02_carga_modelo.sql` carrega as 11 tabelas do modelo a partir das tabelas temporárias criadas pelo Flight. Ele depende desse staging, por isso não deve ser executado isoladamente. O fluxo completo está em [scripts/motherduck/README.md](../../scripts/motherduck/README.md).
