# Análise de eleições: dados do TSE

Repositório com scripts de carga, SQLs do modelo eleitoral e painel de apresentação conectado ao MotherDuck. Os dados brutos do TSE não são versionados.

## Documentação por área

- [Frontend e execução do painel](frontend/README.md)
- [Scripts de normalização e carga](scripts/README.md)
- [Carga MotherDuck no Flight](scripts/motherduck/README.md)
- [SQLs PostgreSQL e ordem de execução](sql/README.md)
- [Views e transformação do modelo no MotherDuck](sql/motherduck/README.md)

## Visão geral

A carga analítica de referência no banco MotherDuck `BDR-TSE` cobre AC, AL, BA, DF, RO e SP nos pleitos de 2004 a 2024: eleições gerais de 2006, 2010, 2014, 2018 e 2022; eleições municipais de 2004, 2008, 2012, 2016, 2020 e 2024. Publica as 11 tabelas do DER e views analíticas. O painel consulta essa base de referência compartilhada. O fluxo PostgreSQL local é documentado separadamente e serve para preparar e validar uma carga.

O painel mantém o visual do HTML de apresentação, mas consulta o MotherDuck por uma API Bun. A credencial fica no backend; GitHub Pages sozinho não executa essa API.

O `ID_PESSOA_PROJETO` só relaciona candidaturas quando os dados publicados são compatíveis e corroborados pelos arquivos de origem. Casos ambíguos permanecem separados. O procedimento de carga e reconciliação está em [Carga MotherDuck](scripts/motherduck/README.md). Respeite a diferença entre eleições gerais e municipais ao comparar anos, cargos, turnos e circunscrições.

Credenciais, `.env`, arquivos brutos, CSVs temporários e relatórios locais não devem ser commitados. Consulte os `.env.example` de cada aplicação e mantenha os segredos locais.
