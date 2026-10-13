# Frontend do painel eleitoral

O painel usa TypeScript, Vite e Bun. Seu markup, CSS, mapa e interações reproduzem o HTML da apresentação; o snapshot gzipado original foi removido. Os dados são consultados ao vivo no MotherDuck por uma API Bun, que mantém o token fora do navegador.

## Requisitos

- Bun instalado
- Acesso ao banco MotherDuck `BDR-TSE`
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

O banco contém AC, AL, BA, DF, RO e SP nos pleitos de 2018, 2020, 2022 e 2024. A interface mostra eleitos por partido no mapa, filtro de cargo, faixas de gastos da questão 2, busca de candidatos/municípios e detalhes em gaveta.

### Mapa de municípios

Os limites municipais ficam em `public/geo/municipios-UF.json` (TopoJSON, um arquivo por estado, já versionado). Cada município traz o código TSE, o mesmo de `municipio.cd_municipio_tse`. No mapa, as divisas aparecem sobre as faixas de partido; clicar em um município abre a gaveta com os dados dele e escolher um município na busca aproxima o mapa até ele. O zoom funciona pelos botões, com Ctrl/⌘ + roda do mouse, pinça no trackpad ou dois dedos no celular; ampliado, o mapa pode ser arrastado.

Para regenerar as malhas (IBGE via `tbrugz/geodata-br`, correspondência TSE x IBGE via `betafcc/Municipios-Brasileiros-TSE`):

```sh
bun run malhas
```

A API consulta `v_partidos_eleitos`, `vw_questao_2_despesas`, `v_historico_candidato` e tabelas municipais. A view oficial da questão 2 é `vw_questao_2_despesas`. O identificador de pessoa não é prova de identidade entre pleitos quando o título eleitoral não está disponível.

`server.ts` contém as rotas e consultas; `src/presentation.ts` preserva o comportamento do HTML original; `src/style.css` contém os estilos originais; `dev.ts` inicia os dois servidores em desenvolvimento; `scripts/malhas.ts` gera as malhas municipais. O arquivo `.env` é local e ignorado pelo Git: nunca coloque o token em código frontend, `VITE_*`, issues ou commits.

O GitHub Pages hospeda apenas o frontend estático. Para publicar o painel com dados ao vivo, é necessário também hospedar a API Bun e configurar a URL dela no frontend, mantendo o token no ambiente do backend.
