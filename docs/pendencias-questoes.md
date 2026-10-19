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

Escopo da nossa carga (`BDR-TSE`): UFs **AC, AL, BA, DF, RO, SP** nos anos **2018, 2020, 2022, 2024** (municipais só DF 2018/2022); valores nominais, sem deflator.

## Estado atual por questão

| Questão | Status | Evidência no nosso projeto |
|---|---|---|
| P1 | **Parcial** | custo por voto por candidatura na ficha (`presentation.ts:641`); view `custo_cadeira` pronta (`sql/05_identidade_e_cadeira.sql`) mas sem endpoint/UI; agregados de campanha não renderizados |
| P2 | **Parcial** | patrimônio individual (evolução por eleição, na ficha); sem distribuição/taxa de eleição por faixa de bens |
| P3 | **Parcial** | PIB/IDHM/população já chegam pelo `/api/municipality` (`server.ts:192`) e **não são renderizados**; faltam eleitores/população e isentos |
| P4 | **Falta** | grau de instrução só na ficha individual; `stg_tse.perfil_eleitorado_municipio` tem `ds_grau_instrucao` — nada agregado |
| P5 | **Parcial** | mapa soma nominais+legenda por partido (`server.ts:83`); não separa nem mede "eleitos por votos de legenda" |
| P6 | **Falta** | idade derivável de `dt_nascimento`; sem alternância (não baixamos 1996–2016) |
| P7 | **Falta** | não temos o dataset de notas de especialistas (Harvard Dataverse) |
| P8 | **Parcial** | views de financiamento prontas (`sql/motherduck/05_views_financiamento.sql`) + endpoint `/api/financiamento` (server.ts); sem UI |
| P9 | **Feita** | nuvens por valor/frequência na ficha (`vw_questao_9_nuvem_*`) |
| P10 | **Parcial (p10a)** | views de reeleição prontas (`sql/motherduck/04_views_reeleicao.sql`) + endpoints `/api/reeleicao(.pessoas)` (server.ts); sem UI. Ficha com candidaturas 2018–2024 (votos, gasto, bens); P10b (carreira completa) pendente de anos históricos |

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
- SQL ✅: views de `sql/motherduck/05_views_financiamento.sql` — `v_financiamento_candidatura` (candidatura com total recebido e parcela de fundo especial, fundo partidário e outras fontes), `v_financiamento_faixas` (0–25%, 25–50%, 50–75%, 75–100% e sem receita), `v_financiamento_fontes` (total por fonte) e `v_financiamento_partidos` (agregado por partido). Aplicadas no `BDR-TSE-2026`.
- Endpoint ✅: `/api/financiamento?uf` (`{faixas, fontes, partidos}`); uf vazio agrega todo o escopo.
- UI (pendente): páginas por questão do - faixas de dependência (barra segmentada + lista "quem são"), fontes (barras R$) e partidos (barras de representação). Nota: `tp_origem_recurso` é todo null no escopo; só existem FUNDO ESPECIAL / FUNDO PARTIDARIO / OUTROS RECURSOS (+ null).

### P10a — Reeleição no escopo
- SQL ✅: views de `sql/motherduck/04_views_reeleicao.sql` — `v_reeleicao_linhas` (cada eleito em A ligado à disputa seguinte do cargo, com `havia_proxima`, `tentou`, `reeleita` e, para municipais, agregados do município) e `v_reeleicao_pessoas` (grupos voltou/perderam/nao com nome, CPF, partido, município e ciclos). Senador 2018 fica fora (`ha_proxima` falso — a próxima disputa é 2026); deputados agregam no grão municipal. Aplicadas no `BDR-TSE-2026`.
- Endpoint ✅: `/api/reeleicao?uf` (fichas por cargo × ciclo + média do cargo e ranking por estado) e `/api/reeleicao/pessoas?uf&cargo&eleitos_em&grupo&q&limite&desde`.
- UI (pendente): páginas por questão , em lugar da urna — fichas com barra segmentada "voltaram / tentaram e perderam / não tentaram" por ciclo, seção "quem são" por grupo e calor "estado a estado".
- Nota: P10b completa só com anos históricos novos (1994+).
