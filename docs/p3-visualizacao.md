# Visualização da P3

A P3 compara indicadores municipais com o partido do prefeito eleito. Seu gráfico principal mostra a composição partidária de quatro grupos de municípios, ordenados do menor para o maior indicador. A unidade de contagem é a prefeitura, não a quantidade de votos nem a área municipal.

## Referências e escolhas

- [Nexo — tipos de gráficos](https://www.nexojornal.com.br/grafico/tipos-mais-de-comuns-de-graficos-qual-escolher-nexo): escolha do gráfico conforme a comparação, títulos claros e hierarquia entre leitura principal e detalhes. Adaptado na separação entre composição, distribuição, relação entre indicadores e ranking.
- [IBGE Cidades](https://www.ibge.gov.br/cidadesat/topwindow.html): apresentação conjunta de indicadores, tabelas e gráficos por localidade. Adaptado nos KPIs e na tabela de conferência com unidades e fontes preservadas.
- [MapBiomas — plataforma e estatísticas](https://brasil.mapbiomas.org/iniciativas-e-produtos/cobertura-e-uso-da-terra/cobertura-10m/cobertura/): exploração territorial com mapas, estatísticas e classes identificadas em legenda. Adaptado no realce coordenado entre gráficos, com uma cor consistente para cada partido.
- Referência visual fornecida pelo grupo, “Saldo por município no 2º turno”: posição, cor e tamanho comunicam dados antes dos textos explicativos. Esse princípio orienta os gráficos; o mapa com espigões não foi adotado porque área e altura geográfica não ajudam a comparar a composição dos quatro grupos. O exemplo não fornece dados para a P3.

A página do Seu Imposto e o conteúdo interativo do artefato Claude não puderam ser inspecionados diretamente nesta pesquisa; o exemplo visual foi examinado pela imagem fornecida pelo grupo. Não se presume uma reprodução dessas interfaces.

A interface mantém a fonte Schibsted Grotesk, as superfícies e os temas claro/escuro do projeto. As cores dos partidos vêm de `corP`, como no restante do painel; nomes, contagens, tooltips e realce por seleção complementam a cor. O texto dentro das barras usa preto ou branco conforme a luminância da cor. O histograma usa a cor temática `--faixa-0`.

O grid apresenta KPIs, composição em largura total, dispersão e histograma lado a lado, ranking e detalhes recolhíveis. Em telas menores, os gráficos ficam em uma coluna e suas escalas são redesenhadas para a largura disponível. As legendas quebram linha; os segmentos estreitos preservam tooltip e contagem, sem comprimir nomes ilegíveis.

## Gráficos e sua leitura

| Gráfico | O que representa | Por que foi escolhido |
|---|---|---|
| Quatro barras empilhadas de 100% | Cada barra é um quartil existente; segmentos são as quantidades de prefeituras por partido divididas pelo total do grupo | Permite comparar a composição partidária do menor ao maior indicador, mesmo quando os grupos têm tamanhos ligeiramente diferentes |
| Dispersão | Um ponto por município com os dois indicadores disponíveis; X é o indicador selecionado, Y é abstenção | Mostra concentração, valores extremos e possíveis associações sem uma regressão que sugira explicação causal |
| Histograma | Quantidade de municípios em intervalos do indicador selecionado | Distingue valores comuns de valores extremos, mantendo o domínio completo |
| Ranking horizontal | Os mesmos 20 municípios e valores da tabela original | Comprimentos em uma escala comum tornam as diferenças visíveis; rótulos, números e cor do partido permitem conferir cada município |

Ao selecionar abstenção no eixo X, a dispersão usa aptos/população no Y, evitando comparar uma variável consigo mesma. Pares com algum indicador ausente não viram pontos; continuam presentes nos demais gráficos conforme sua disponibilidade.

Não há série temporal nova: o endpoint consulta uma eleição por vez. Não há interpolação, remoção de extremos, densidade estimada, coeficiente de correlação ou inferência causal. PIB é nominal e IDHM mantém a referência já disponibilizada pela API.

## Interações

- Clique em um partido da legenda ou em seu segmento para realçá-lo na composição, dispersão e ranking. Outro clique no mesmo partido, ou em “Todos os partidos”, remove o realce. Os totais não são recalculados e os demais registros permanecem nos gráficos.
- Passe o mouse ou use o foco do teclado para ver os valores completos, incluindo moeda em pt-BR.
- Use as setas para percorrer marcas, Home/End para ir à primeira/última e Escape para fechar o tooltip. Há uma entrada de tabulação por conjunto de marcas.
- Clique em um município da dispersão ou ranking, ou pressione Enter, para abrir a gaveta existente.
- Na dispersão, os botões +/−, Ctrl + rolagem e arraste exploram regiões do gráfico. “Redefinir” restaura as escalas completas. Zoom altera somente a vista.
- Os números dos quatro grupos e a tabela original ficam disponíveis em “Ver os números…” e “Ver a tabela…”.

## Dados e implementação

`src/questoes/p3-indicadores.ts` conserva a consulta, os KPIs, a função `dadosQuartis`, a seleção de municípios com indicador e a ordenação do ranking. O SQL, o endpoint e os dados do MotherDuck permanecem iguais.

`src/questoes/p3-graficos.ts` contém funções próprias para `composicao`, `dispersao`, `distribuicao` e `ranking`, além dos auxiliares de eixos e tooltips. A composição reutiliza o `Map` de partidos de cada quartil, que já existia na P3. Municípios sem partido identificado ocupam um segmento cinza para não desaparecer do denominador. O histograma faz apenas a contagem visual dos registros em intervalos; não substitui a divisão original em quartis.

O `ResizeObserver` redesenha apenas quando a largura muda e é desligado ao montar outro dashboard. A seleção de partido é preservada no redimensionamento. Não há novas dependências: o D3 7.9 já é carregado pelo projeto.

## Conferência e execução

```sh
cd frontend
bun dev.ts
```

Abra `http://127.0.0.1:5173/#/p3` para a amostra ou `#/SP/p3` para São Paulo. Ano e indicador são escolhidos no painel. A configuração MotherDuck segue o README do frontend.

A conferência no Chrome compara o total do histograma, as contagens partidárias dos segmentos, os valores individuais da dispersão e a ordem/valores do ranking com o JSON do endpoint. Para 2024, PIB/IDHM têm 1.239 municípios e a dispersão tem 1.238 pares; aptos/população e abstenção têm 1.238. Essa diferença é preservada, não preenchida com zero.

Também foram conferidos o histograma e o ranking nos seis anos municipais de 2004 a 2024, os estados de resposta vazia, valor constante e indicador ausente, o realce coordenado, zoom, teclado e a abertura da ficha municipal. O painel foi conferido em 320, 390, 768 e 1440 px e nos temas claro/escuro. A checagem não registrou erros de execução. `bun run typecheck`, `bun run build` e `git diff --check` completam a validação local. O aviso de zoom do mapa recebeu uma limitação de largura para não ultrapassar a tela de 320 px.
