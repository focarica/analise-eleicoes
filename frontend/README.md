# Frontend do painel eleitoral

O painel usa TypeScript, Vite e Bun. Seu markup, CSS, mapa e interações reproduzem o HTML da apresentação; o snapshot gzipado original foi removido. Os dados são consultados ao vivo no MotherDuck por uma API Bun, que mantém o token fora do navegador.

### Banco `BDR-TSE-2026`

O share original `BDR-TSE` é somente leitura e não podia receber a votação de Presidente por município (que faltava na carga inicial: os arquivos munzona por UF do TSE não trazem esse cargo; ele só está no arquivo BR). O banco `BDR-TSE-2026` foi copiado das 11 tabelas do DER para a mesma conta do token do painel, recebeu o complemento de Presidente (2018 e 2022, dos ZIPs oficiais `votacao_partido_munzona`/`votacao_candidato_munzona`, arquivo BR) e as mesmas views. `~/scripts` (`scripts/motherduck/complementar_presidente.py`, `carga_presidente.ts`, `copia_banco_presidente.ts`) reproduz a atualização.

## Requisitos

- Bun instalado
- Acesso ao banco MotherDuck `BDR-TSE-2026` (conta do painel; veja nota abaixo)
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

As fotos ficam em um bucket R2 público, fora do MotherDuck. O backend valida a candidatura pela combinação `ano_eleicao + sq_candidato` e redireciona o navegador para `R2_PUBLIC_BASE_URL/candidatos/{ano}/{sq}`. O navegador e o servidor não precisam de credenciais R2 para ler as fotos. O `.env.example` contém a URL pública do bucket. No primeiro acesso ao bucket, carregue a imagem oficial correspondente do pacote do TSE, preservando-a fora do Git.

As chaves S3 compatíveis com R2 ainda são necessárias para administrar e carregar objetos, mas não devem ficar no ambiente da aplicação web. O domínio `r2.dev` é destinado a desenvolvimento e tem limitação variável de tráfego; para produção, configure um domínio próprio no bucket. Não publique credenciais nem o arquivo `.env`.

## Dados e estrutura

O banco contém AC, AL, BA, DF, RO e SP nos pleitos de 2018, 2020, 2022 e 2024. A interface mostra o partido vencedor em cada município no mapa, filtro de cargo, faixas de gastos da questão 2, busca de candidatos/municípios e detalhes em gaveta.

### Mapa de municípios

Os limites municipais ficam em `public/geo/municipios-UF.json` (TopoJSON, um arquivo por estado, já versionado). Cada município traz o código TSE, o mesmo de `municipio.cd_municipio_tse`. Cada município é pintado com a cor do partido vencedor no cargo escolhido: para prefeito, o partido do eleito (ou o mais votado no 1º turno, se o eleito não estiver na base); para os demais cargos, o partido mais votado no 1º turno, somando votos nominais e de legenda. A rota `/api/municipal-map` faz esse cálculo a partir de `votacao_partido` e `candidatura`. A legenda conta em quantos municípios cada partido venceu.

O mapa usa uma única projeção para o Brasil todo (cônica de áreas iguais, como no IBGE), com estados e malhas municipais no mesmo espaço de coordenadas: aproximar de um estado ou município é só mover a câmera (transformação de zoom do d3). A página abre no mapa do Brasil inteiro: os seis estados da amostra ficam em tom escuro e são clicáveis; os demais, sem dados, ficam mais claros — um clique apenas os demarca com um traço tracejado (um segundo clique desmarca), sem mover a câmera. Clicar em um estado da amostra (ou atalho na navegação) voa até ele e monta a malha municipal; clicar em um município aproxima até ele e abre a gaveta com os dados, e fechar a gaveta volta o enquadramento para o estado. Escolher um município na busca também aproxima o mapa até ele. O zoom funciona pelos botões, com Ctrl/⌘ + roda do mouse, pinça no trackpad ou dois dedos no celular; ampliado, o mapa pode ser arrastado. O botão de globo volta ao Brasil inteiro e o de enquadrar reenquadra o alvo corrente sem refazer a projeção. Um véu semitransparente cobre a tela durante as requisições de dados, com três quadrados pulando em sequência no centro; o indicador aparece como a primeira chamada é feita e some quando a última responde (contagem compartilhada entre as chamadas paralelas).

Para regenerar as malhas (IBGE via `tbrugz/geodata-br`, correspondência TSE x IBGE via `betafcc/Municipios-Brasileiros-TSE`):

```sh
bun run malhas
```

A API consulta `v_partidos_eleitos`, `vw_questao_2_despesas`, `v_historico_candidato`, as views de reeleição (`v_reeleicao_*`) e de financiamento (`v_financiamento_*`) e tabelas municipais. A view oficial da questão 2 é `vw_questao_2_despesas`. O identificador de pessoa não é prova de identidade entre pleitos quando o título eleitoral não está disponível.

As views de `sql/motherduck/04_views_reeleicao.sql` e `05_views_financiamento.sql` (P10a e P8) ainda não têm UI no painel; os endpoints `/api/reeleicao(.pessoas)` e `/api/financiamento` já as expõem. Para aplicá-las no `BDR-TSE-2026` sem abrir o editor SQL:

```sh
bun run scripts/aplicar-views.ts ../sql/motherduck/04_views_reeleicao.sql ../sql/motherduck/05_views_financiamento.sql
```

O script usa o `MOTHERDUCK_TOKEN` do `.env` (a conta do painel, a única com escrita no `BDR-TSE-2026`) e executa os statements individualmente; as views de `01` e `03` são reaplicáveis da mesma forma.

`server.ts` contém as rotas e consultas; `src/presentation.ts` preserva o comportamento do HTML original; `src/style.css` contém os estilos originais; `dev.ts` inicia os dois servidores em desenvolvimento; `scripts/malhas.ts` gera as malhas municipais. O arquivo `.env` é local e ignorado pelo Git: nunca coloque o token em código frontend, `VITE_*`, issues ou commits.

O GitHub Pages hospeda apenas o frontend estático. Para publicar o painel com dados ao vivo, é necessário também hospedar a API Bun e configurar a URL dela no frontend, mantendo o token no ambiente do backend.
