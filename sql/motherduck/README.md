# SQL do MotherDuck

Esta pasta contém as views analíticas e o SQL que transforma o staging do Flight nas 11 tabelas do DER.

## Views

`01_views_analiticas.sql` cria quatro views no schema `public` do banco `BDR-TSE`:

- `v_partidos_eleitos`: total de eleitos titulares por UF, ano, partido e cargo.
- `v_gasto_sucesso`: candidatos em faixas iguais de gasto, com estatísticas de sucesso.
- `vw_questao_2_despesas`: view oficial da questão 2, baseada na regra financeira aprovada.
- `v_historico_candidato`: histórico de candidaturas com receitas, despesas e bens agregados.

Para reaplicar as views em um banco já carregado, conecte-se ao `BDR-TSE` no editor SQL do MotherDuck e execute `01_views_analiticas.sql`.

`03_views_propaganda.sql` cria as duas views da questão 9, depois de preencher `despesas_pagas.ds_categoria_despesa` com `DS_ORIGEM_DESPESA` oficial do TSE:

- `vw_questao_9_nuvem_valor`: palavras das descrições, com `peso` em reais pagos nos lançamentos que contêm cada palavra.
- `vw_questao_9_nuvem_frequencia`: as mesmas palavras, com `peso` igual ao número de lançamentos que as contêm.

As duas expõem `valor_pago_associado` e `qt_lancamentos`, além do candidato, ano, UF, cargo e partido. Sempre filtre por `ano_eleicao` **e** `sq_candidato`; o SQ sozinho não identifica uma candidatura entre eleições.

```sql
SELECT termo, peso, valor_pago_associado, qt_lancamentos
FROM public.vw_questao_9_nuvem_valor
WHERE ano_eleicao = 2024 AND sq_candidato = 250001926547
ORDER BY peso DESC, termo
LIMIT 80;
```

Troque o nome da view por `vw_questao_9_nuvem_frequencia` para comparar frequência. Um pagamento de R$ 1 milhão com a palavra `facebook` pesa 1 milhão na primeira view e 1 na segunda; 100 lançamentos de R$ 10 com `panfletagem` pesam R$ 1.000 e 100, respectivamente.

O SQL declara as 11 rubricas de publicidade, comunicação, eventos/comícios e mobilização de rua incluídas. Rubricas genéricas de pessoal/terceiros não são classificadas automaticamente como propaganda. Entram somente valores positivos com descrição publicada; ausências, zeros e ajustes negativos ficam fora das nuvens. Palavras são normalizadas para minúsculas sem acentos; termos genéricos/documentais são removidos. Não há correção automática de grafia ou agrupamento de sinônimos. Uma palavra repetida na mesma descrição conta uma vez por lançamento.

Frequência não é quantidade de produtos nem número comprovado de compras: os dados são pagamentos e podem incluir parcelas ou lotes. Cada palavra recebe o valor dos lançamentos associados; como um lançamento pode conter várias palavras, **não some os pesos da nuvem como orçamento**. Para o total de propaganda, some `vr_pago` diretamente nas rubricas filtradas em `despesas_pagas`.

Para recuperar categorias em um banco já carregado sem trocar valores ou IDs, veja [o script de atualização](../../scripts/motherduck/README.md#recuperar-categorias-e-criar-as-views-da-questão-9).

## Views de reeleição e financiamento (P10a e P8)

`04_views_reeleicao.sql` cria as views da taxa de reeleição (P10a):

- `v_reeleicao_linhas`: cada candidatura eleita ligada à disputa seguinte do mesmo cargo, com flags `havia_proxima`, `tentou`, `reeleita` e, para cargos municipais, os agregados do município.
- `v_reeleicao_pessoas`: as pessoas por grupo `voltou` / `perderam` / `nao`, com nome, CPF, partido, município e anos em que estejam no escopo.

`05_views_financiamento.sql` cria as views da questão das fontes de dinheiro (P8):

- `v_financiamento_candidatura`: total recebido por candidatura e parcela de fundo especial, fundo partidário e outras fontes.
- `v_financiamento_faixas`: candidatos agrupados por faixa de dependência de fundos (0–25%, 25–50%, 50–75%, 75–100% e sem receita declarada).
- `v_financiamento_fontes`: total por fonte de receita.
- `v_financiamento_partidos`: agregado por partido (candidatos, eleitos e receita por tipo).

Para aplicar `04` e `05` no banco do painel (`BDR-TSE-2026`), sem abrir o editor SQL:

```bash
bun run scripts/aplicar-views.ts ../sql/motherduck/04_views_reeleicao.sql ../sql/motherduck/05_views_financiamento.sql
```

O script usa `MOTHERDUCK_TOKEN` do `.env` do frontend (a conta do painel, que é a que tem escrita no `BDR-TSE-2026`) e executa cada statement individualmente. As views de `01` e `03` podem ser reaplicadas da mesma forma.

## Transformação do modelo

`02_carga_modelo.sql` carrega as 11 tabelas do modelo a partir das tabelas temporárias criadas pelo Flight. Ele depende desse staging, por isso não deve ser executado isoladamente. O fluxo completo está em [scripts/motherduck/README.md](../../scripts/motherduck/README.md).
