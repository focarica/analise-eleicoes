# Análise de eleições: dados do TSE

Repositório com scripts de carga, SQLs do modelo eleitoral e painel de apresentação conectado ao MotherDuck. Os dados brutos do TSE não são versionados.

## Documentação por área

- [Frontend e execução do painel](frontend/README.md)
- [Scripts de normalização e carga](scripts/README.md)
- [Carga MotherDuck no Flight](scripts/motherduck/README.md)
- [SQLs PostgreSQL e ordem de execução](sql/README.md)
- [Views e transformação do modelo no MotherDuck](sql/motherduck/README.md)

## Visão geral

A carga analítica de referência no banco `BDR-TSE` cobre AC, AL, BA, DF, RO e SP nos anos 2018, 2020, 2022 e 2024. Publica as 11 tabelas do DER e quatro views. O fluxo PostgreSQL local é documentado separadamente e serve para preparar e validar uma carga.

O painel mantém o visual do HTML de apresentação, mas consulta o MotherDuck por uma API Bun. A credencial fica no backend; GitHub Pages sozinho não executa essa API.

O `ID_PESSOA_PROJETO` usa o título eleitoral quando disponível; sem título, identifica apenas aquela candidatura. Para reproduzir uma carga histórica ampliada, recalcule os identificadores no conjunto completo. Respeite a diferença entre eleições gerais e municipais ao comparar anos, cargos, turnos e circunscrições.

Credenciais, `.env`, arquivos brutos, CSVs temporários e relatórios locais não devem ser commitados. Consulte os `.env.example` de cada aplicação e mantenha os segredos locais.
