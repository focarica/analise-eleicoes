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
viés são da UP em 2020, sem nota na onda de 2018. Se algum `ALTER COLUMN` falhar,
confira antes se as duas colunas de viés continuam vazias.

## Escopo

Somente as eleições de 2018 a 2024. Anos anteriores a 2018 e a eleição de 2026
ficam com `NULL` de propósito — não há onda do survey que cubra esses pleitos.
2018 e 2020 usam a onda de 2018; 2022 e 2024, a de 2022. **2024 é a onda de 2022
estendida por dois anos** e está marcada em `onda_estendida`.

## Atualização do painel

A régua da ficha do candidato e a linha do tempo do município leem o snapshot local `frontend/.p7-vies.duckdb`, gerado por
`bun run p7-local` a partir do mesmo `14_vies_partidos.sql` e do CSV
`data/referencias/vies_municipios.csv`. Esse CSV é uma exportação da view
`vw_questao_7_vies`. Depois de aplicar os dois arquivos no `BDR-TSE`, execute:

```sh
cd frontend
bun run p7-municipios
bun run p7-local
```

O exportador usa `BDR-TSE` por padrão; `P7_MOTHERDUCK_DB` permite informar
outro banco. Atualize `CACHE_VERSION` e reinicie com `bun run dev` (ou
`bun run start`), para renovar as fichas e séries guardadas em cache.
Executar `bun dev.ts` diretamente não dispara o hook `predev`.

## Eleições regulares e validação

`vies_onda_eleicao.eleicoes` define os códigos regulares: 2018 = 295/297,
2020 = 426, 2022 = 544/546 e 2024 = 619. Presidente e demais cargos mantêm
seus códigos próprios. Suplementares ficam fora tanto da cobertura quanto
da média municipal. Essa lista precisa ser revista ao ampliar o escopo.

O SQL e o carregador Python validam a presença das quatro eleições e a
cobertura mínima de 99,9% antes do commit; uma falha permite rollback.
A cobertura mede votos com nota disponível, não a completude da fonte TSE.

## Testes locais (sem escrita remota)

```sh
python3 scripts/motherduck/carregar_vies_partidos.py --check
python3 -m unittest discover -s scripts/motherduck -p test_vies_partidos.py
cd frontend
bun scripts/p7-check.ts
bun run p7-local
bun run typecheck
bun run build
```

O ensaio SQL verifica as duas eleições gerais (incluindo presidente), os pleitos
municipais, a exclusão de suplementares e segundo turno, a reaplicação e o
rollback quando a cobertura fica abaixo do mínimo. O teste Python também
rejeita cobertura ausente, nula ou insuficiente antes de confirmar a transação.
