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

`12_views_custo_cadeira.sql` responde à questão 1 com `vw_questao_1_custo_cadeira`: por cargo, ano, UF e município (só prefeito e vereador têm município; Presidente tem `uf = 'BR'`), as candidaturas, os eleitos, as despesas pagas de todas as candidaturas e as dos eleitos, com contagens de quem declarou despesa. Duas leituras: gasto médio de quem se elegeu (`vr_despesas_eleitos / qt_eleitos_com_despesa`) e custo da disputa por cadeira (`vr_despesas_total / qt_eleitos`). Valores nominais; o painel corrige pelo IPCA para reais de 2024.

```sql
SELECT ano_eleicao,
       SUM(vr_despesas_eleitos) / SUM(qt_eleitos_com_despesa) AS gasto_medio_eleito,
       SUM(vr_despesas_total) / SUM(qt_eleitos) AS custo_disputa_por_cadeira
FROM public.vw_questao_1_custo_cadeira
WHERE cd_cargo = 13 AND uf = 'SP'
GROUP BY 1 ORDER BY 1;
```

```sh
bun run frontend/scripts/aplicar-views.ts sql/motherduck/12_views_custo_cadeira.sql
```

`06_municipio_ibge.sql` cria `vw_municipio_ibge`, uma correspondência de reserva entre o código TSE e o código IBGE dos 1.239 municípios da amostra (fonte: `betafcc/Municipios-Brasileiros-TSE`, a mesma das malhas do mapa). A carga do Censo (`10_censo_2022_escolaridade.sql`) preenche `municipio.cd_municipio_ibge` com a correspondência oficial do TSE; a questão 4 usa essa coluna e só recorre à view quando ela está nula, como depois de recarregar o modelo.

`07_views_escolaridade.sql` responde à questão 4 com `vw_questao_4_escolaridade`: o grau de instrução dos candidatos e eleitos a prefeito e vereador (`candidato.ds_grau_instrucao`) comparado com o da população de 18 anos ou mais no Censo 2022 (`escolaridade_populacao_municipio`, carregada por `10_censo_2022_escolaridade.sql`). Os sete níveis do TSE são agrupados nos quatro do Censo: sem instrução e fundamental incompleto; fundamental completo e médio incompleto; médio completo e superior incompleto; superior completo. Uma linha por município, ano, cargo (`TODOS` soma prefeito e vereador) e nível, com contagens, porcentagens e a razão entre a parcela dos eleitos e a da população. Escolaridade não informada fica numa linha à parte, fora das porcentagens; linhas de total do Censo são ignoradas. O Censo é de 2022: compare com as eleições de 2020 e 2024.

```sql
SELECT ds_nivel, pct_candidatos, pct_eleitos, pct_populacao, razao_eleitos_populacao
FROM public.vw_questao_4_escolaridade
WHERE cd_municipio_tse = '71072' AND ano_eleicao = 2024 AND ds_cargo = 'TODOS'
ORDER BY nr_nivel NULLS LAST;
```

Aplique depois da carga do Censo:

```sh
bun run frontend/scripts/aplicar-views.ts \
  sql/motherduck/06_municipio_ibge.sql \
  sql/motherduck/07_views_escolaridade.sql
```

`11_views_legenda.sql` responde à questão 5 com `vw_questao_5_legenda`: uma linha por eleito em cargo proporcional (vereador, deputado federal, estadual e distrital), com os votos nominais dele, o quociente eleitoral da disputa e os votos de legenda do partido. A unidade da disputa é o município para vereador e a UF para deputados. Quociente = votos válidos (nominais + legenda de todos os partidos, 1º turno) ÷ cadeiras, com a regra de arredondamento do art. 106 do Código Eleitoral. Duas réguas: `eleito_abaixo_qe` (votos próprios abaixo do quociente: dependeu dos votos do partido) e `eleito_abaixo_legenda` (votos próprios abaixo dos votos de legenda do partido). O eleito pela média dos arquivos antigos (`MÉDIA`) conta como eleito.

```sql
SELECT sg_partido, COUNT(*) AS eleitos,
       COUNT(*) FILTER (WHERE eleito_abaixo_qe) AS abaixo_do_quociente
FROM public.vw_questao_5_legenda
WHERE cd_cargo = 13 AND ano_eleicao = 2024 AND uf = 'SP'
GROUP BY 1 ORDER BY 3 DESC;
```

```sh
bun run frontend/scripts/aplicar-views.ts sql/motherduck/11_views_legenda.sql
```
