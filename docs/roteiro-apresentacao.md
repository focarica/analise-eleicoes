# Roteiro de apresentação: análises do painel

Base: `BDR-TSE` (MotherDuck), AC, AL, BA, DF, RO e SP, 2004–2024. Valores nominais, sem deflator IPCA.
Números colhidos da API local (`/api/*`) na data de geração deste roteiro.

## Escopo da base (abertura)

- **6 UFs**: AC, AL, BA, DF, RO, SP.
- **2004 a 2024**: municipais 2004/08/12/16/20/24 e gerais 2006/10/14/18/22.
- A identidade da pessoa (`ID_PESSOA_PROJETO`) junta a carreira do candidato entre pleitos. Casos ambíguos ficam separados.
- Valores nominais. Comparar R$ de anos diferentes sem deflator é limitação declarada.

---

## Questões feitas

### P2: "Quem gasta mais se elege mais?"

Mostrar as faixas de gasto por cargo e a taxa de eleitos em cada uma.

- **Deputado federal SP 2022**: faixa 1 (até ~R$ 863 mil) = **0,93%** de eleitos; faixa 4 (R$ 2,6 a 3,45 mi) = **59,4%**.
- **Deputado estadual SP 2022**: faixa 1 = **0,54%**; faixa 4 = **55,6%**.
- **Vereador SP 2024**: faixa 1 (até ~R$ 1,06 mi) = **15%**; faixa 4 = **4 de 4 eleitos (100%)**. Amostra pequena: dizer que n=4.
- Gasto médio de eleitos e não eleitos é quase igual nas faixas altas (dep. estadual faixa 3: R$ 869 mil vs R$ 883 mil). Acima de certo patamar, gastar mais não distingue quem ganha.

### P8: "Depender de fundo público se elege mais?"

Barra segmentada por faixa de dependência (0–25%, 25–50%, 50–75%, 75–100%, sem receita) e gráfico por ano.

- **Amostra inteira** (todos os cargos, 2004–2024, já com a normalização da fonte pública): até 24% público = 13,7% de eleitos; 25–49% = 15,1%; 50–74% = 13,1%; 75%+ = 8,3%; sem receita = 5,6%.
  - Leitura correta: a taxa cai só a partir de 50% de dependência pública. Entre 0 e 49%, a diferença é pequena.
  - "Sem receita" inclui 2004, ano em que a base não tem receitas carregadas (ver nota abaixo).

> **Nota (P8, faixas antes de 2020):** antes da correção, a comparação de fonte era exata e não reconhecia `Fundo Partidario` (2012, 2014, 2016) nem `Fundo Partidáo` (2010). Por isso, esses anos apareciam sem fundo público. Agora a comparação ignora caixa e acentos. Em 2008 a base não tem nenhuma linha de fundo público, então todos os candidatos daquele ano ficam em `[00,25)` ou `sem receita`. Em 2004 não há receitas carregadas. Os números de 2020 e 2024 não mudaram.
- **Vereador 2020**: 15,4% (baixa dependência) vs **4,3%** (75%+ público).
- **Vereador 2024**: 16,2% vs 10,8%.
- **Ficha de Fernando Haddad, governador SP 2022**: R$ 33,58 mi arrecadados, **98,4%** de fundo público, R$ 3,94 por voto, derrota. Em 2018, na presidência: 95% público, também derrota.
- **Verba por fonte, presidente (agregado)**: FEFC R$ 360 mi; fundo partidário R$ 57 mi; outros recursos R$ 187 mi.

### P9: "Onde o candidato investe em propaganda?"

Nuvem de termos na ficha, alternando valor gasto e frequência de lançamentos.

- **Ricardo Nunes, prefeito SP 2024** (id 158406): "impulsionamento" R$ 6,2 mi e "facebook" R$ 2,39 mi; "banner" R$ 2,46 mi e "impressão" R$ 2,49 mi. Pergunta para a plateia: a campanha já é mais digital do que de rua?
- **Ricardo Nunes, deputado federal 2018**: "carro" R$ 99,6 mil e "agente" R$ 192 mil dominam. Contraste com 2024.
- Métrica: valor associa a cada termo os pagamentos dos lançamentos que o contêm (termos podem compartilhar o mesmo gasto). Frequência conta lançamentos, não unidades.

### P10a: "Reeleição: quem volta?"

Colunas empilhadas por ciclo, quem são e resumo somado.

| Cargo | Tentaram | Voltaram | Taxa |
|---|---|---|---|
| Governador | 11 | 9 | 81,8% |
| Deputado estadual | 609 | 432 | 70,9% |
| Deputado federal | 381 | 256 | 67,2% |
| Prefeito | 3.034 | 1.903 | 62,7% |
| Vereador | 40.623 | 23.282 | 57,3% |
| Senador | 10 | 4 | 40% |

- Governador: só 11 tentaram e quase todos voltaram. n pequeno (30 eleitos no escopo).
- Só cerca de 40% dos eleitos tentam de novo (vereador: 70.857 eleitos, 40.623 tentaram).
- Validação: AC 2018→2022 bate com o grupo 7. Governador 100%, deputado estadual 63,2%.
- Exemplo: Haddad, prefeito SP eleito em 2012 com 1.776.317 votos, tentou reeleição em 2016 e perdeu (967.190 votos).

### Ficha do candidato (P1 parcial: custo por voto; P2 parcial: patrimônio)

- **Custo por voto**: Ricardo Nunes, prefeito SP 2024, R$ 53,9 mi ÷ 1.801.139 votos = **R$ 29,93**. Haddad, governador SP 2022, R$ 32,8 mi ÷ 8.337.139 votos = **R$ 3,94**. Pergunta para a plateia: por que o voto custa 7× mais num caso que no outro?
- **Patrimônio declarado**: Haddad 2012→2022 = R$ 474 mil → 452 mil → 428 mil → **595 mil**. Nunes 2012→2024 = R$ 4,25 mi → **R$ 4,84 mi**, estável em seis candidaturas.
- A ficha mostra % público vs privado, receitas por fonte, maiores despesas e bens declarados.

### Mapa e gaveta do município (P5 parcial; P3 parcial)

- **Prefeitos SP 2024 por partido vencedor**: PSD 207 municípios, PL 106, Republicanos 83, MDB 71, PP 48, União 38.
- **Comparecimento SP 2024**: aptos 9,32 mi; abstenção 27,3% no 1º turno e 31,5% no 2º.
- **Mais votados SP 2004** (gaveta): José Serra (PSDB) 2,69 mi; Marta Suplicy (PT) 2,21 mi; Maluf (PP) 735 mil; Erundina (PSB) 244 mil.
- Votos por partido somam nominais e legenda. A separação "eleito por legenda" ainda não existe (P5 completa).

---

## Questões parciais (tratar como roadmap)

- **P1 restante**: view `custo_cadeira` pronta no SQL, falta o bloco na gaveta do estado.
- **P3 restante**: PIB per capita, IDHM e população já vêm da API e não estão renderizados. Faltam eleitores/população e isentos.
- **P4 (escolaridade candidato × votante)**: grau de instrução do eleitorado está na base; falta a comparação.
- **P6 e P7 (alternância e viés)**: dependem de dados externos (candidaturas 1996–2016; notas de especialistas do Harvard Dataverse).
- **P10b (carreira completa)**: depende de pleitos anteriores a 2004.
- **IPCA**: deflator ainda não aplicado.

## Condução sugerida

1. Abrir pelo mapa.
2. Mostrar a ficha do Haddad: prefeito eleito, perde reeleição, 98% de dinheiro público, perde de novo. Conecta P1, P2, P8, P9 e P10a numa pessoa só.
3. Citar sempre o n dos grupos pequenos.
4. Presidente: o filtro do mapa fica desabilitado porque `votacao_candidato` não tem `CD_CARGO = 1`. O cargo aparece na busca, nas fichas e no financiamento.
