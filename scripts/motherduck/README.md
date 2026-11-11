# Carga TSE no MotherDuck

O fluxo reproduzível está em `carga_tse_motherduck_flight.py`. `gerar_carga_tse_flight.py` mantém o arquivo autocontido sincronizado com o normalizador e os SQLs versionados. Ele adquire os ZIPs oficiais do TSE, valida os arquivos ao lê-los, normaliza as eleições de 2004 a 2024 para AC, AL, BA, DF, RO e SP e publica somente as 11 tabelas do DER. A carga usa identificadores pessoais corroborados e chaves históricas de candidatura por ano, UF e sequencial original. Nenhuma tabela de staging ou auditoria fica no banco.

## Carga completa

Gere o Flight atualizado e execute-o como um MotherDuck Flight com Python, DuckDB e acesso à rede habilitados:

```sh
python3 scripts/motherduck/gerar_carga_tse_flight.py
```
 Configure a autenticação MotherDuck no ambiente do Flight ou em `MOTHERDUCK_TOKEN`. O destino é o banco `BDR-TSE`; o script cria ou atualiza as tabelas do schema `public` e as seis views de `sql/motherduck/01_views_analiticas.sql` e `03_views_propaganda.sql`.

O escopo inclui eleições municipais de 2004, 2008, 2012, 2016, 2020 e 2024 e eleições gerais de 2006, 2010, 2014, 2018 e 2022. Candidaturas nacionais são lidas dos arquivos BR quando disponíveis; os fatos municipais seguem o recorte de UFs. A carga principal não inclui Presidente (`CD_CARGO = 1`), publicado pelo TSE em arquivos separados. O complemento presidencial para os cinco pleitos gerais é executado por `complementar_votos_presidente.py`; ele substitui os fatos presidenciais dos cinco anos, exige cobertura dos 1.239 municípios do escopo nos dois turnos e verifica a igualdade dos totais por município entre votos nominais dos candidatos e do partido.

## Complementos e limites das fontes

Após reconstruir ou recarregar as receitas, aplique `../../sql/motherduck/11_classificar_origem_receita.sql`. A regra só classifica rubricas cuja natureza pública ou privada está explícita; fundos públicos conhecidos e origens privadas identificadas recebem classe, enquanto partido/comitê, origens genéricas e rubricas ambíguas permanecem `NULL`. A view de financiamento usa essa classificação. Em 2004, o TSE não fornece valores de receita nos arquivos usados, portanto a rubrica pode existir sem valor numérico.

`DS_CATEGORIA_DESPESA` está carregada nos pleitos de 2004 a 2024. `VR_PAGO` só tem valor em 2018–2024: nos arquivos anteriores há despesas declaradas, mas não um campo equivalente que comprove pagamento. Não converter valor declarado em valor pago.

O perfil do eleitorado tem linhas para todos os pleitos de 2004 a 2024. Em 2004 e 2006, porém, a fonte disponível só permite o total municipal (`#NE`), sem divisão por idade. As faixas etárias publicadas a partir de 2008 são mantidas como informadas pelo TSE.

## Complementos temporais IBGE/Atlas

`sql/motherduck/12_schema_dados_temporais.sql` cria os fatos temporais do IBGE, do perfil do eleitorado, da escolaridade censitária e do IDHM. As cargas já aplicadas estão nos scripts correspondentes:

- `complementar_perfil_eleitorado.py`: quatro marginais independentes do TSE (idade, gênero, estado civil e instrução), para 2004–2024; não representa cruzamentos entre dimensões.
- `carregar_serie_ibge.py`: PIB, população, VAB, área e densidade municipal publicados pelo SIDRA. O PIB per capita é derivado de PIB/população quando ambos têm o mesmo ano.
- `sql/motherduck/10_censo_2022_escolaridade.sql`: escolaridade da população de 18 anos ou mais no Censo 2022.
- `carregar_idhm_atlas.py`: IDHM geral, renda, longevidade e educação, para 2000 e 2010. Usa a planilha bruta do Atlas 2013; o endpoint institucional antigo não está mais disponível, então a URL da cópia pública e a fonte original estão registradas no script.

Após a execução, validar as contagens e os anos diretamente nas tabelas `fato_perfil_eleitorado`, `fato_socioeconomico_ibge`, `fato_escolaridade_populacao` e `fato_idhm_atlas`. A escolaridade atualmente carregada é apenas Censo 2022 (18+); os universos não devem ser misturados.

Depois da carga, aplique as views de reeleição e financiamento:

```sh
bun run frontend/scripts/aplicar-views.ts \
  sql/motherduck/04_views_reeleicao.sql \
  sql/motherduck/05_views_financiamento.sql
```

Use um token com permissão de escrita em `BDR-TSE`. O painel usa um token de leitura.

## Viés político dos partidos (P7)

`carregar_vies_partidos.py` lê `data/referencias/harvard/df_experts.csv` (Bolognesi et al., Harvard Dataverse, doi:10.7910/DVN/MFIXKW), calcula a média das notas de 0 a 10 de cada partido em cada onda e converte para `(média - 5) × 20`, de −100 a +100. Renomeações herdam o valor do mesmo partido; fusões usam a média dos componentes que têm valor; sem valor é `NULL`, nunca 0.

O script grava `vies_onda_eleicao` e `vies_partido_onda`, converte `partido.vies_politico` e `candidatura.vies_politico_eleicao` para `DOUBLE` e preenche as duas colunas. Eleições de 2018 e 2020 usam a onda de 2018; 2022 e 2024, a de 2022. **2024 é a onda de 2022 estendida por dois anos**, marcada em `onda_estendida`. Antes de 2018 não há valor.

```sh
# Confere a Tabela 1 do artigo e os exemplos de sucessão, sem banco:
python3 scripts/motherduck/carregar_vies_partidos.py --check

# Aplica no BDR-TSE com um token de escrita:
MOTHERDUCK_TOKEN=<token> python3 scripts/motherduck/carregar_vies_partidos.py
```

A execução termina com a cobertura dos votos válidos por eleição e falha se algum ano ficar abaixo de 99,9%. A origem de cada número fica em `vies_partido_onda.origem` e no CSV `respostas/vies_partidos_auditoria.csv`. O cliente DuckDB precisa ser 1.5.6: o MotherDuck ainda não aceita a versão 2.0. Depois, aplique a view:

```sh
bun run frontend/scripts/aplicar-views.ts sql/motherduck/15_views_vies.sql
```

O painel lê o viés municipal de `data/referencias/vies_municipios.csv`, uma exportação de `vw_questao_7_vies` (1.239 municípios × 4 eleições). Para reexportá-lo do banco com escrita e atualizar o snapshot local:

```sh
cd frontend
bun run p7-municipios   # exporta a view do BDR-TSE
bun run p7-local        # recarrega o snapshot .p7-vies.duckdb
```

### Sem token de escrita

Se o banco de destino for somente leitura para o projeto, peça ao administrador para executar, nesta ordem, os dois arquivos abaixo. Eles não dependem de Python, CSV ou das referências: `14_vies_partidos.sql` já traz os 131 valores por partido/eleição e o cabeçalho de cada arquivo explica o que ele faz.

```text
sql/motherduck/14_vies_partidos.sql
sql/motherduck/15_views_vies.sql
```

O primeiro termina com a cobertura por eleição (2018 e 2022 em 100%, 2020 em 99,97%, 2024 em 100%) e com a contagem de partidos e candidaturas preenchidos. Confira esses números antes de considerar a carga concluída.

## Identidades em uma base já carregada

A carga completa executa o mesmo resolvedor de identidades incluído em `sql/motherduck/08_resolver_identidades.sql`. Ele considera CPF válido com nome legal e nascimento compatíveis, ou título eleitoral com esses atributos e sem CPFs conflitantes. Registros inconclusivos permanecem separados. O procedimento local de planejamento está em `sql/motherduck/09_planejar_reconciliacao_bruta.sql`.

Para reconciliar uma base existente, exporte snapshots com `frontend/scripts/reconciliar-identidades.ts --export`, gere o plano local com `scripts/motherduck/reconciliar_identidades_tse.py` e aplique-o com `--apply`. O comando verifica SHA-256, compara o snapshot com o banco e atualiza vínculos em uma transação. Os snapshots contêm dados pessoais e devem permanecer em diretório privado, fora do Git.

## Reconstrução histórica de 2006/2008

Os arquivos brutos desses anos reutilizam `SQ_CANDIDATO` em UFs diferentes. O carregamento usa ano/UF/SQ de origem e preserva o sequencial original em `sq_candidato_tse`. Isso evita misturar candidaturas, votos, bens, receitas e despesas de pessoas distintas.

Para reconstruir uma base já carregada, exporte snapshots e execute `scripts/motherduck/reconstruir_legados_tse.py`. O script gera um plano local; `frontend/scripts/reconstruir-legados.ts --apply` valida o estado atual e publica candidaturas e fatos dos dois anos em uma transação. O mapa das chaves já publicadas conserva os IDs internos e as referências de fotos. Resultados ordinários sem cadastro geram candidaturas mínimas sem identificadores pessoais inferidos. Lançamentos financeiros sem vínculo seguro ficam em quarentena local. Despesas antigas sem prova de pagamento mantêm `VR_PAGO` como `NULL`.

Exemplo de sequência, usando um diretório privado com espaço em disco:

```sh
# Em frontend, usando um token de leitura:
bun scripts/reconstruir-legados.ts --export /dados-privados/legados

# Na raiz do repositório, com Python, DuckDB e requests:
python3 scripts/motherduck/reconstruir_legados_tse.py \
  --work-dir /dados-privados/legados \
  --identity-stage /dados-privados/identidades/staging/candidatura.csv

# Em frontend, usando token de escrita e TSE_SPILL_DIR em disco:
TSE_SPILL_DIR=/dados-privados/temporarios \
  bun scripts/reconstruir-legados.ts --apply /dados-privados/legados
```

A publicação verifica os snapshots, as chaves, os vínculos e os totais antes do commit. Preserva os outros anos, invalida o cache do backend pela revisão e não cria tabelas auxiliares permanentes. Os arquivos baixados, snapshots e planos contêm dados de origem e ficam fora do repositório.

## Conferência e correção dos vínculos de 2026

`frontend/scripts/reconciliar-2026.ts` compara as candidaturas já publicadas de
2026 com `CONSULTA_CAND` oficial, em Latin-1. Exige Bun, as dependências do
frontend e Python 3 (biblioteca padrão). Execute em `frontend/`:

```sh
bun scripts/reconciliar-2026.ts --check /dados-privados/identidades-2026
bun scripts/reconciliar-2026.ts --apply /dados-privados/identidades-2026
bun scripts/identidades-2026-check.ts
```

O modo `--check` usa `MOTHERDUCK_TOKEN`; `--apply` prefere
`MOTHERDUCK_TOKEN_READ_WRITE` e exige escrita no `BDR-TSE`. O diretório privado
recebe ZIP, cadastro extraído, plano, backup das candidaturas e resumo com SHA-256.
Esses arquivos contêm identificadores pessoais e ficam fora do Git.

O plano `sql/motherduck/16_planejar_vinculos_2026.sql` reutiliza perfis existentes
por CPF válido ou título corroborado por nome e nascimento, recusando CPFs
conflitantes e destinos ambíguos. Diferenças apenas de espaço no nome exigem CPF
válido coincidente e só entram se não houver correspondência exata normalizada.
Entre duplicatas compatíveis, um único perfil com candidaturas anteriores tem
preferência; dois perfis históricos elegíveis bloqueiam a aplicação.

A atualização muda somente `candidatura.id_pessoa_projeto` em 2026. Verifica por
assinaturas que os perfis, os vínculos dos demais anos e os outros atributos das
candidaturas continuam iguais, e renova a revisão do cache da API após o commit.
Uma nova execução deve informar `alterados=0`.

IDs produzidos por `ROW_NUMBER` em uma reconstrução/staging são locais àquela
execução. Ao publicar um ano adicional, não copie esses números como IDs do
banco existente: faça o mapeamento corroborado e valide os vínculos contra a
fonte antes de considerar a carga concluída. O reconciliador bloqueia quando o
perfil necessário ainda não existe, em vez de vincular a uma pessoa por acaso.
