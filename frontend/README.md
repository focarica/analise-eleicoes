# Frontend do painel eleitoral

O painel usa TypeScript, Vite e Bun. Seu markup, CSS, mapa e interações reproduzem o HTML da apresentação; o snapshot gzipado original foi removido. Os dados são consultados ao vivo no MotherDuck por uma API Bun, que mantém o token fora do navegador.

### Banco `BDR-TSE`

O painel consulta `BDR-TSE`, a base de referência compartilhada. O usuário do painel precisa ter permissão de leitura nessa base. A tabela de votos nominais por município não inclui Presidente (`CD_CARGO = 1`) em nenhum dos onze anos; por isso o filtro presidencial fica desabilitado até integrar os resultados específicos por seção do TSE. A tela e os filtros de candidatos usam todos os onze anos presentes na base: 2004–2024.

## Requisitos

- Bun instalado
- Acesso de leitura ao banco MotherDuck `BDR-TSE`
- Token MotherDuck de leitura

## Executar localmente

Se ainda não houver `.env`, copie o exemplo e preencha os dados de MotherDuck e R2:

```sh
cp .env.example .env
```

Depois, na pasta `frontend/`:

```sh
bun install
bun run dev
```

Abra `http://127.0.0.1:5173`. O comando inicia Vite e o backend Bun na porta 3001. Para compilar e servir a versão de produção local:

```sh
bun run build
bun run start
```

O servidor usa `PORT` quando definido e, por padrão, escuta na porta 3001.

### Fotos oficiais dos candidatos

As fotos ficam em um bucket R2 público, fora do MotherDuck. O backend valida a candidatura pela combinação `ano_eleicao + sq_candidato` e redireciona o navegador para `R2_PUBLIC_BASE_URL/candidatos/{ano}/{sq}`. O navegador e o servidor não precisam de credenciais R2 para ler as fotos. O `.env.example` contém a URL pública do bucket. As fotos de 2004–2016 foram carregadas para AC, AL, BA, RO e SP nas eleições municipais, e para AC, AL, BA, DF, RO e SP nas eleições gerais. Os objetos continuam fora do Git.

As chaves S3 compatíveis com R2 ainda são necessárias para administrar e carregar objetos, mas não devem ficar no ambiente da aplicação web. O domínio `r2.dev` é destinado a desenvolvimento e tem limitação variável de tráfego; para produção, configure um domínio próprio no bucket. Não publique credenciais nem o arquivo `.env`.

## Dados e estrutura

O banco contém AC, AL, BA, DF, RO e SP nos pleitos de 2004–2024. A interface mostra o partido vencedor em cada município no mapa, filtro de cargo, faixas de gastos da questão 2, busca de candidatos/municípios e detalhes em gaveta.

Os pleitos de 2014 e 2016 já estão carregados: 2014 cobre os cargos estaduais/federais da eleição geral; 2016 cobre prefeito e vereador, com lacunas de votos por cargo em Guarulhos, Itapetininga, Itupeva e Lins. A tabela de votos ainda não contém `CD_CARGO = 1` (Presidente) em nenhum ano; o filtro presidencial fica desabilitado até integrar os resultados específicos por seção publicados pelo TSE. A ausência de um município nessa tabela indica que não há votação publicada naquele grão; não a interprete como zero votos.

### Mapa de municípios

Os limites municipais ficam em `public/geo/municipios-UF.json` (TopoJSON, um arquivo por estado, já versionado). Cada município traz o código TSE, o mesmo de `municipio.cd_municipio_tse`. Cada município é pintado com a cor do partido vencedor no cargo escolhido: para prefeito, o partido do eleito (ou o mais votado no 1º turno, se o eleito não estiver na base); para os demais cargos, o partido mais votado no 1º turno, somando votos nominais e de legenda. A rota `/api/municipal-map` faz esse cálculo a partir de `votacao_partido` e `candidatura`. A legenda conta em quantos municípios cada partido venceu.

O mapa usa uma única projeção para o Brasil todo (cônica de áreas iguais, como no IBGE), com estados e malhas municipais no mesmo espaço de coordenadas: aproximar de um estado ou município é só mover a câmera (transformação de zoom do d3). A página abre no mapa do Brasil inteiro: os seis estados da amostra ficam em tom escuro e são clicáveis; os demais, sem dados, ficam mais claros — um clique apenas os demarca com um traço tracejado (um segundo clique desmarca), sem mover a câmera. Clicar em um estado da amostra (ou atalho na navegação) voa até ele e monta a malha municipal; clicar em um município aproxima até ele e abre a gaveta com os dados, e fechar a gaveta volta o enquadramento para o estado. Escolher um município na busca também aproxima o mapa até ele. O zoom funciona pelos botões, com Ctrl/⌘ + roda do mouse, pinça no trackpad ou dois dedos no celular; ampliado, o mapa pode ser arrastado. O botão de globo volta ao Brasil inteiro e o de enquadrar reenquadra o alvo corrente sem refazer a projeção. Um véu semitransparente cobre a tela durante as requisições de dados, com três quadrados pulando em sequência no centro; o indicador aparece como a primeira chamada é feita e some quando a última responde (contagem compartilhada entre as chamadas paralelas).

Para regenerar as malhas (IBGE via `tbrugz/geodata-br`, correspondência TSE x IBGE via `betafcc/Municipios-Brasileiros-TSE`):

```sh
bun run malhas
```

A API consulta `v_partidos_eleitos`, `vw_questao_2_despesas`, `v_historico_candidato`, as views de reeleição (`v_reeleicao_*`) e de financiamento (`v_financiamento_*`) e tabelas municipais. A view oficial da questão 2 é `vw_questao_2_despesas`. Os IDs entre pleitos só são compartilhados quando os identificadores e os atributos publicados passam pelas regras de corroboracão da carga; casos ambíguos permanecem separados.

O histórico depende do vínculo `id_pessoa_projeto`, reconstruído por observações dos arquivos brutos TSE. Veja o procedimento de carga e reconciliação em [`scripts/motherduck/README.md`](../scripts/motherduck/README.md). Candidaturas e fatos de 2006/2008 usam chaves internas com escopo ano/UF/SQ; o SQ original permanece em `sq_candidato_tse`. A carga e a reconstrução reproduzíveis estão descritas em `scripts/motherduck/README.md`.

Fichas e buscas usam cache por revisão dos dados. O cache em memória e disco segue a revisão dos dados. A reconciliação atualiza `.cache-api/revision` para invalidar resultados anteriores no backend em execução. Em outra instalação, altere `CACHE_VERSION` no `.env` e reinicie o backend após uma atualização externa do banco. Arquivos de cache e snapshots não são versionados.

As views de `sql/motherduck/04_views_reeleicao.sql` e `05_views_financiamento.sql` (P10a e P8) ainda não têm UI no painel; os endpoints `/api/reeleicao(.pessoas)` e `/api/financiamento` já as expõem. Para aplicá-las no `BDR-TSE`, use um token com permissão de escrita:

```sh
bun run scripts/aplicar-views.ts ../sql/motherduck/04_views_reeleicao.sql ../sql/motherduck/05_views_financiamento.sql
```

O script usa o `MOTHERDUCK_TOKEN` do `.env` e executa os statements individualmente; as views de `01` e `03` são reaplicáveis da mesma forma.

`server.ts` contém as rotas e consultas; `src/presentation.ts` preserva o comportamento do HTML original; `src/style.css` contém os estilos originais; `dev.ts` inicia os dois servidores em desenvolvimento; `scripts/malhas.ts` gera as malhas municipais. O arquivo `.env` é local e ignorado pelo Git: nunca coloque o token em código frontend, `VITE_*`, issues ou commits.

O GitHub Pages hospeda apenas o frontend estático. Para publicar o painel com dados ao vivo, é necessário também hospedar a API Bun e configurar a URL dela no frontend, mantendo o token no ambiente do backend.
