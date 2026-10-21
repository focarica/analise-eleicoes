# Fotos dos candidatos no TSE

As fotos oficiais de [2004](https://dadosabertos.tse.jus.br/dataset/candidatos-2004), [2006](https://dadosabertos.tse.jus.br/dataset/candidatos-2006), [2008](https://dadosabertos.tse.jus.br/dataset/candidatos-2008), [2010](https://dadosabertos.tse.jus.br/dataset/candidatos-2010), [2012](https://dadosabertos.tse.jus.br/dataset/candidatos-2012), [2014](https://dadosabertos.tse.jus.br/dataset/candidatos-2014), [2016](https://dadosabertos.tse.jus.br/dataset/candidatos-2016), [2018](https://dadosabertos.tse.jus.br/dataset/candidatos-2018), [2020](https://dadosabertos.tse.jus.br/dataset/candidatos-2020-subtemas), [2022](https://dadosabertos.tse.jus.br/dataset/candidatos-2022) e [2024](https://dadosabertos.tse.jus.br/dataset/candidatos-2024) são publicadas no catálogo do TSE. Os recursos **Fotos de candidatos** são separados por UF; o catálogo CKAN permite descobri-los sem depender do HTML do DivulgaCandContas.

```text
GET https://dadosabertos.tse.jus.br/api/3/action/package_show?id=candidatos-2024
```

Selecione `result.resources` cujo nome seja `<UF> - Fotos de candidatos`. Nas eleições gerais, consulte também `BR` para candidaturas nacionais. Em 2020/2024 não há recurso do DF nem BR nesse conjunto de eleições municipais.

## Carga histórica 2004–2016

O script [`carregar_fotos_historicas_r2.py`](./carregar_fotos_historicas_r2.py) baixa os recursos do TSE e associa as imagens às candidaturas existentes no MotherDuck em modo somente leitura. O recorte utilizado é:

- Municipais 2004, 2008, 2012 e 2016: AC, AL, BA, RO e SP.
- Gerais 2006, 2010 e 2014: AC, AL, BA, DF, RO, SP e BR.

Os nomes variam por eleição. A rotina reconhece `F{UF}{SQ}_div.png` em 2006/2008, `{UF}{SQ}_div.jpg` em 2010/2012/2014 e `F{UF}{SQ}_div.jpg` em 2016. Em 2004, o nome também contém o código TSE do município (`F{UF}{MUNICIPIO}_{SQ}_div.png`); por isso, o vínculo usa UF + município + sequencial TSE. Nos demais anos, usa ano + UF + sequencial TSE. Em todos os casos, o destino é o `SQ_CANDIDATO` interno daquela candidatura, evitando colisões de identificadores entre pleitos.

As fotos são normalizadas para JPEG, qualidade 78, limite de 322×450 pixels e fundo branco para transparências. O objeto mantém o padrão já consumido pelo frontend: `candidatos/{ANO}/{SQ_CANDIDATO}`, `Content-Type: image/jpeg` e `Cache-Control: public,max-age=3600`. A associação continua sendo resolvida pelo banco; não são gravados links, imagens ou tabelas auxiliares no MotherDuck, Railway ou Supabase. ZIPs e imagens intermediárias ficam em `/tmp/tse_fotos_historicas_r2` e podem ser removidos ao final.

Para reproduzir a carga, configure `MOTHERDUCK_TOKEN` em `analise-eleicoes/frontend/.env` e as credenciais de escrita do bucket em `.env_r2`, instale `duckdb` e `Pillow`, tenha AWS CLI v2 disponível e execute na raiz do workspace:

```sh
python3 analise-eleicoes/scripts/fotos/carregar_fotos_historicas_r2.py
```

O script consulta as candidaturas no MotherDuck apenas para leitura, filtra exatamente o escopo acima, não sobrescreve chaves que já existam, testa uma URL pública por ano e só remove o staging se todas as validações passarem. `--dry-run` baixa e valida as imagens sem enviar; `--keep-local` preserva os arquivos temporários; `--years` e `--ufs` permitem limitar a execução. O AWS CLI usa 20 requisições concorrentes e repete até quatro vezes erros temporários de sincronização. Uma sincronização pode ser reexecutada com segurança, pois as chaves existentes não são sobrescritas.

## Associação à candidatura

O nome de cada imagem segue o padrão observado nos quatro anos:

```text
F{UF}{SQ_CANDIDATO}_div.jpg
F{UF}{SQ_CANDIDATO}_div.jpeg
```

Exemplo: `FSP250002118287_div.jpg`, no ZIP de SP de 2024, corresponde a `candidatura.ano_eleicao=2024 AND candidatura.sq_candidato=250002118287`.

Leia o índice do ZIP e preserve a extensão real; não suponha que toda foto termina em `.jpg`. Associe por **ano + SQ**, usando a UF como conferência. O ano vem do recurso, não do nome individual da imagem. Não associe somente ao `id_pessoa_projeto`: a fotografia é da candidatura naquele pleito.

## Uso proposto no painel

1. Descobrir os ZIPs do recorte e ler seus índices por HTTP Range, sem baixar todas as fotos.
2. Guardar um índice externo com ano, SQ, UF, URL do ZIP, nome, posição, tamanho e CRC do membro.
3. Quando o usuário abrir uma candidatura, buscar somente o trecho desse membro, descomprimir e validar o CRC.
4. Servir a foto pelo backend e mantê-la em cache no filesystem ou armazenamento de objetos, fora do banco e do Git.
5. Mostrar uma imagem padrão quando não houver foto; distinguir ausência de falha temporária no download.

A CDN oficial aceitou requisições HTTP Range durante a verificação. Trate recusa do Range, mudança de versão do ZIP e falha de CRC como erros; não baixe automaticamente um ZIP inteiro de vários GB a cada acesso.

O backend redireciona `/api/photo/{ano}/{sq_candidato}` para o objeto público correspondente no R2. O índice de candidaturas vem do MotherDuck; o banco não guarda imagens nem exige tabela adicional.
