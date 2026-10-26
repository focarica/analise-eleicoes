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
