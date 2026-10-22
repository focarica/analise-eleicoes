# SQL do MotherDuck

`02_carga_modelo.sql` transforma as tabelas temporárias do Flight nas 11 tabelas do modelo. O arquivo depende do staging e não deve ser executado isoladamente. A carga completa, incluindo a normalização histórica, está em [`scripts/motherduck/README.md`](../../scripts/motherduck/README.md).

## Identidade e chaves históricas

`08_resolver_identidades.sql` associa candidaturas somente quando CPF/título e os atributos publicados oferecem evidência compatível. Cada observação é identificada por ano e SQ da candidatura. Uma trava detecta reutilização de SQ entre circunscrições e cargos antes da publicação.

`09_planejar_reconciliacao_bruta.sql` é executado localmente sobre snapshots e observações brutas para formar perfis e vínculos. As tabelas de trabalho são temporárias/locais e não pertencem ao modelo publicado.

## Views

`01_views_analiticas.sql` contém as views de partidos eleitos, despesas da questão 2, sucesso por faixa de gastos e histórico financeiro da candidatura.

`03_views_propaganda.sql` cria as nuvens de palavras da questão 9, ponderadas pelo valor associado e pela frequência de lançamentos. A classificação vem de `ds_categoria_despesa`; palavras de um mesmo lançamento não devem ser somadas como orçamento.

`04_views_reeleicao.sql` e `05_views_financiamento.sql` contêm as views usadas pelas análises de reeleição e fontes de recursos. Para aplicá-las em um banco carregado, use um token com permissão de escrita:

```sh
bun run frontend/scripts/aplicar-views.ts \
  sql/motherduck/04_views_reeleicao.sql \
  sql/motherduck/05_views_financiamento.sql
```

`10_views_legenda.sql` responde à questão 5 com `vw_questao_5_legenda`: uma linha por eleito em cargo proporcional (vereador, deputado federal, estadual e distrital), com os votos nominais dele, o quociente eleitoral da disputa e os votos de legenda do partido. A unidade da disputa é o município para vereador e a UF para deputados. Quociente = votos válidos (nominais + legenda de todos os partidos, 1º turno) ÷ cadeiras, com a regra de arredondamento do art. 106 do Código Eleitoral. Duas réguas: `eleito_abaixo_qe` (votos próprios abaixo do quociente: dependeu dos votos do partido) e `eleito_abaixo_legenda` (votos próprios abaixo dos votos de legenda do partido). O eleito pela média dos arquivos antigos (`MÉDIA`) conta como eleito.

```sql
SELECT sg_partido, COUNT(*) AS eleitos,
       COUNT(*) FILTER (WHERE eleito_abaixo_qe) AS abaixo_do_quociente
FROM public.vw_questao_5_legenda
WHERE cd_cargo = 13 AND ano_eleicao = 2024 AND uf = 'SP'
GROUP BY 1 ORDER BY 3 DESC;
```

```sh
bun run frontend/scripts/aplicar-views.ts sql/motherduck/10_views_legenda.sql
```
