# Frontend do painel eleitoral

O painel usa TypeScript, Vite e Bun. Seu markup, CSS, mapa e interações reproduzem o HTML da apresentação; o snapshot gzipado original foi removido. Os dados são consultados ao vivo no MotherDuck por uma API Bun, que mantém o token fora do navegador.

## Requisitos

- Bun instalado
- Acesso ao banco MotherDuck `BDR-TSE`
- Token MotherDuck de leitura

## Executar localmente

Se ainda não houver `.env`, copie o exemplo e informe seu token:

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

## Dados e estrutura

O banco contém AC, AL, BA, DF, RO e SP nos pleitos de 2018, 2020, 2022 e 2024. A interface mostra eleitos por partido no mapa, filtro de cargo, faixas de gastos da questão 2, busca de candidatos/municípios e detalhes em gaveta.

A API consulta `v_partidos_eleitos`, `vw_questao_2_despesas`, `v_historico_candidato` e tabelas municipais. A view oficial da questão 2 é `vw_questao_2_despesas`. O identificador de pessoa não é prova de identidade entre pleitos quando o título eleitoral não está disponível.

`server.ts` contém as rotas e consultas; `src/presentation.ts` preserva o comportamento do HTML original; `src/style.css` contém os estilos originais; `dev.ts` inicia os dois servidores em desenvolvimento. O arquivo `.env` é local e ignorado pelo Git: nunca coloque o token em código frontend, `VITE_*`, issues ou commits.

O GitHub Pages hospeda apenas o frontend estático. Para publicar o painel com dados ao vivo, é necessário também hospedar a API Bun e configurar a URL dela no frontend, mantendo o token no ambiente do backend.
