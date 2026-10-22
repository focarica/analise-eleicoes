# Pendências de questões e planejamento


| Nº | Pergunta |
|---|---|
| P1 | Quanto custa uma cadeira? |
| P2 | Qual a taxa de sucesso eleitoral por patrimônio declarado? |
| P3 | Índices do município (PIB per capita, IDHM, eleitores/população, isentos) × eleitos/partidos mais vitoriosos |
| P4 | Escolaridade do candidato × escolaridade dos votantes |
| P5 | Quantos candidatos de dado partido foram eleitos por votos de legenda? |
| P6 | Idade média do município × alternância de poder e idade dos eleitos |
| P7 | Viés político de um município/região na linha do tempo |
| P8 | Sucesso de candidatos dependentes de repasses públicos × financiados por outras fontes |
| P9 | Onde o candidato investe em propaganda (nuvem de palavras)? |
| P10 | Sobrevivência da carreira de um político (P10a reeleição, P10b histórico completo) |

Escopo da nossa carga (`BDR-TSE`): UFs **AC, AL, BA, DF, RO, SP** nos pleitos de **2004–2024**; eleições municipais em 2004/2008/2012/2016/2020/2024 nas cinco UFs com municípios e eleições gerais em 2006/2010/2014/2018/2022 incluindo DF. Valores financeiros são nominais, sem deflator.

## Estado atual por questão

| Questão | Status | Evidência no nosso projeto |
|---|---|---|
| P1 | **Feita** | view `vw_questao_1_custo_cadeira` (`sql/motherduck/12_views_custo_cadeira.sql`): gasto médio dos eleitos e custo da disputa por cadeira, por cargo, ano, UF e município; endpoints `/api/custo-cadeira` e `/api/custo-cadeira/lugares`; seção "Quanto custa uma cadeira?" (valores em R$ de 2024, evolução 2004–2024, lugares mais caros e mais baratos); custo por voto segue na ficha do candidato |
| P2 | **Parcial** | patrimônio individual (evolução por eleição, na ficha); sem distribuição/taxa de eleição por faixa de bens |
| P3 | **Parcial** | PIB/IDHM/população já chegam pelo `/api/municipality` (`server.ts:192`) e **não são renderizados**; faltam eleitores/população e isentos |
| P4 | **Feita** | view `vw_questao_4_escolaridade` (`sql/motherduck/07_views_escolaridade.sql`): candidatos e eleitos a prefeito/vereador × população 18+ do Censo 2022 (`escolaridade_populacao_municipio`, via `vw_municipio_ibge`), nos quatro níveis do IBGE; endpoint `/api/escolaridade`; seção na página e na gaveta do município |
| P5 | **Feita** | view `vw_questao_5_legenda` (`sql/motherduck/11_views_legenda.sql`): por eleito em cargo proporcional, votos próprios × quociente eleitoral e × legenda do partido; endpoints `/api/legenda` e `/api/legenda/pessoas`; seção "Eleitos com a ajuda do partido" (cargo, ano, evolução 2004–2024, partidos e lista) |
| P6 | **Falta** | idade derivável de `dt_nascimento`; sem alternância (não baixamos 1996–2016) |
| P7 | **Falta** | não temos o dataset de notas de especialistas (Harvard Dataverse) |
| P8 | **Feita** | views de financiamento (`sql/motherduck/05_views_financiamento.sql`) + endpoints `/api/financiamento(.pessoas)` + UI na página: seção "Depender de fundo público se elege mais?" com barra segmentada por faixa (% da receita arrecadada vinda de fundos públicos), "quem são" por faixa, fontes e partidos; **gráfico de linhas com abas** (taxa de eleição por faixa × ano | verba por fonte × ano, com escala log opcional e legenda que liga/desliga séries) e **seletor multi-ano** (chips; "Todos os anos" por padrão; agregado no cliente com soma e taxa recalculada — nunca média de taxas; "quem são" usa `ano=all`, com coluna de ano) e seletor de cargo |
| P9 | **Feita** | nuvens por valor/frequência na ficha (`vw_questao_9_nuvem_*`) |
| P10 | **Feita (P10a)** | reeleição com SQL + endpoints + UI na página (seção "Reeleição: quem volta?"); P10b (carreira completa) pendente de anos históricos |

## O que é possível fazer com os dados que já temos

Feasível **sem baixar nada** (apenas views SQL + endpoints + UI):

- **P3** — UI do boletim do município: PIB per capita, IDHM, população (dados prontos no endpoint); eleitores/população de `perfil_eleitorado_municipio`; isentos de `detalhe_votacao_munzona` (brancos+nulos+abstencões ÷ aptos).
- **P1 (restante)** — ativar `custo_cadeira` por cargo/ano na gaveta do estado; mediana de eleito vs não eleito (já sai de `v_gasto_sucesso`); top 5 custo/voto agregado de `votacao_candidato` + despesas.
- **P2** — taxa de eleição por faixa de patrimônio: quartis de `bem_candidato` (por cargo/ano) × `ds_sit_tot_turno` de `candidatura`.
- **P4** — comparar `ds_grau_instrucao` de `candidatura` (candidatos/eleitos) com o de `perfil_eleitorado_municipio` (votantes) por ano/UF/município.
- **P5** — para cada partido/UF/ano: eleitos cujos votos nominais são menos que os de legenda, a partir de `votacao_partido_munzona` + `ds_sit_tot_turno` de `candidatura`.
- **P8** — agregado por UF/ano: taxa de eleição de candidatos cujo financiamento público ≥ X% vs demais, de `receita_candidato` (origem/fonte) × resultado.
- **P10a (escopo)** — reeleição dentro da janela: prefeito/vereador 2020→2024 e governador/deputado estadual 2018→2022, ligando pessoas por `nr_titulo_eleitoral_candidato`/CPF (mesma chave do `ID_PESSOA_PROJETO`): eleitos → tentaram → reeleitos por cargo e UF.

## O que exige dados novos

- **P7 (viés)** — notas de especialistas dos partidos (Harvard Dataverse, `df_experts.csv`, arquivo pequeno; `0..10` → escala −100..+100). Precisa do download + tabela de viés por partido + junta com `votacao_partido_munzona`. É o tema central de mapas/linha do tempo deles.
- **P6 (alternância)** — candidaturas 1996–2016 (crawlers de consulta_cand históricos) para a sequência de prefeitos por município.
- **P10b (carreira completa)** — extensão do escopo de anos (o título/CPF que já usamos dão a identidade; faltam as candidaturas históricas).
- **IPCA (deflator)** — série IPEA; requisito para comparar R$ de 2018 vs 2024 (afetaria P1 e P2).

## Planejamento por questão pendente

### P3 — Índices do município × eleitos
- SQL: view `v_municipio_indicadores` (pib_per_capita, idhm, populacao, eleitores/pop, isentos) sobre as tabelas já citadas.
- Endpoint: estender `/api/municipality/:code` com o bloco `indicadores` (server.ts:189).
- UI: seção "O lugar" na gaveta do município: quatro números grandes + nota de fonte/ano (IBGE/Atlas 2010).

### P1 — Quanto custa uma cadeira
- SQL: view `v_custo_cadeira_ano` (cargo × UF × ano: gasto_total, eleitos, custo_cadeira, gasto_por_cadeira, medianas eleito/não eleito, custo por voto).
- Endpoint: `/api/cadeira?uf&ano` (ou incluir no `/api/dashboard` existente).
- UI: na gaveta do estado, bloco "Quanto custa uma cadeira": 3 números, ranking top 5 custo/voto (ligam à ficha), barras custo por partido.

### P2 — Patrimônio × sucesso
- SQL: view `v_patrimonio_faixas` (cargo × UF × ano: quartis de patrimônio declarado por candidatura + taxa de eleição por faixa; nº sem registro e sem bens > 0).
- Endpoint: `/api/patrimonio?uf&ano`.
- UI: bloco na gaveta do estado com a fila dos 100 candidatos e a taxa por faixa; destaque taxas.

### P4 — Escolaridade votante × candidato
- SQL: view `v_escolaridade` (por UF/ano: % por grau para votantes, candidatos, eleitos; chance de eleição por grau).
- Endpoint: `/api/escola?uf&ano` (+ `/api/escola/municipio` na gaveta).
- UI: régua eleitor→candidato→eleito (8 graus TSE) e barra "chance por grau".

### P5 — Votos de legenda
- SQL: view `v_legenda` (partido × UF × ano: nominais, legenda, % legenda, nº de eleitos com legenda > nominais).
- Endpoint: `/api/legenda?uf&ano`.
- UI: bloco por partido na gaveta do estado (nominais vs legenda).

### P8 — Repasses públicos × outras fontes
- SQL ✅: views de `sql/motherduck/05_views_financiamento.sql` — `v_financiamento_candidatura` (candidatura com total recebido e parcela de fundo especial, fundo partidário e outras fontes), `v_financiamento_faixas` (0–25%, 25–50%, 50–75%, 75–100% e sem receita), `v_financiamento_fontes` (total por fonte) e `v_financiamento_partidos` (agregado por partido). Aplicadas no `BDR-TSE`.
- Endpoint ✅: `/api/financiamento?uf` (`{faixas, fontes, partidos}`; `cargo` opcional — o frontend usa `cargo=1` para o Presidente, nacional) e `/api/financiamento/pessoas?cargo&ano&faixa&(uf)`. uf vazio agrega todo o escopo.
- UI ✅: seção "Depender de fundo público se elege mais?" na página: faixas de dependência (barra segmentada + lista "quem são" com fichas), fontes (barras R$) e partidos (tabela dos 10 maiores com % público). O indicador de cargo traz o Presidente nos anos gerais (busca também inclui Presidentes de qualquer estado). Nota: `tp_origem_recurso` é todo null no escopo; só existem FUNDO ESPECIAL / FUNDO PARTIDARIO / OUTROS RECURSOS (+ null). O `server.ts` cacheia consultas pesadas em memória+disco (`.cache-api`) por causa do limite diário de computação do plano.

### P10a — Reeleição no escopo
- SQL ✅: views de `sql/motherduck/04_views_reeleicao.sql` — `v_reeleicao_linhas` (cada eleito em A ligado à disputa seguinte do cargo, com `havia_proxima`, `tentou`, `reeleita` e, para municipais, agregados do município) e `v_reeleicao_pessoas` (grupos voltou/perderam/nao com nome, CPF, partido, município e ciclos). Com 2014/2016 incluídos, o histórico municipal ganha o ciclo 2016→2020 e o geral 2014→2018; senador 2018 continua sem eleição seguinte dentro do escopo. Aplicadas no `BDR-TSE`.
- Endpoint ✅: `/api/reeleicao?uf` (fichas por cargo × ciclo + média do cargo e ranking por estado; municipais trazem `municipiosComTentativa` para ponderar a média) e `/api/reeleicao/pessoas?uf&cargo&eleitos_em&grupo&q&limite&desde`.
- UI ✅: seção "Reeleição: quem volta?" — chips de cargo; **coluna empilhada por ciclo** (os 100% são os eleitos: voltou / tentou e perdeu / não tentou; número acima = taxa sobre quem tentou; "média mun." em prefeito/vereador — em vez de linha porque a amostra tem 1 ciclo por cargo); tabela por ciclo com **(% eleitos)** (tentaram/eleitos) e linha Total; **Resumo "todas as eleições somadas"** por cargo (com UF: do estado; sem UF: da amostra) + linha **municipais combinados (prefeito + vereador)** + lista **"fora do cálculo"** (ciclos sem eleição seguinte na base); ranking da taxa por UF quando nenhum estado está aberto; "quem são" por ciclo (voltaram/perderam/não tentaram, busca + mostrar mais, abre a ficha). Média municipal ponderada pelo nº de municípios com tentativa. Deputado distrital (8) entra na régua — divergência deliberada do grupo 7, que não o calcula.
- Validação ✅: AC 2018→2022 bate com o txt do grupo 7 — Governador 1/1/1 (100%), Dep. Federal 8/5/0 (0%), Dep. Estadual 24/19/12 (63,2%, %eleitos 79,2%).
- Nota: P10b completa só com anos históricos novos (1994+).
