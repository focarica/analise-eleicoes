# P7 — instruções para o administrador do `BDR-TSE`

A questão 7 (viés político dos partidos) precisa de duas alterações no banco
compartilhado. Os dois arquivos são SQL puro, autossuficientes (não dependem de
Python, CSV nem das referências) e podem ser reexecutados sem duplicar dados.

## Ordem de execução

1. `sql/motherduck/14_vies_partidos.sql`
2. `sql/motherduck/15_views_vies.sql`

O primeiro cria `vies_onda_eleicao` e `vies_partido_onda`, converte
`partido.vies_politico` e `candidatura.vies_politico_eleicao` de `VARCHAR` para
`DOUBLE` (hoje estão inteiramente vazias) e preenche as duas colunas. O segundo
cria a view `vw_questao_7_vies`, com uma linha por município e eleição.

## Saída esperada do primeiro arquivo

```text
cobertura: 2018 100.00 | 2020 99.97 | 2022 100.00 | 2024 100.00
partidos_com_vies 36 / partidos 38
candidaturas_com_vies 294524 / candidaturas 294551
```

`PAN` e `PRONA` não têm nota no survey e ficam com `NULL`; as 27 candidaturas sem
viés são as que não têm partido ou sigla na base. Se algum `ALTER COLUMN` falhar,
confira antes se as duas colunas de viés continuam vazias.

## Escopo

Somente as eleições de 2018 a 2024. Anos anteriores a 2018 e a eleição de 2026
ficam com `NULL` de propósito — não há onda do survey que cubra esses pleitos.
2018 e 2020 usam a onda de 2018; 2022 e 2024, a de 2022. **2024 é a onda de 2022
estendida por dois anos** e está marcada em `onda_estendida`.

## Enquanto isso

O painel não depende desses arquivos: a régua da ficha do candidato e a linha do
tempo do município leem o snapshot local `frontend/.p7-vies.duckdb`, gerado por
`bun run p7-local` a partir do mesmo `14_vies_partidos.sql` e do CSV
`data/referencias/vies_municipios.csv`. Esse CSV é uma exportação da view
`vw_questao_7_vies` (hoje feita do `BDR-TSE-2026` com `bun run p7-municipios`);
depois de aplicar os dois arquivos acima, ele pode ser reexportado do próprio
`BDR-TSE` trocando `P7_MOTHERDUCK_DB=BDR-TSE`. A view municipal
`vw_questao_7_vies` só passa a existir no `BDR-TSE` depois da execução acima.
