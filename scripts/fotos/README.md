# Fotos dos candidatos no TSE

Os conjuntos oficiais [2018](https://dadosabertos.tse.jus.br/dataset/candidatos-2018), [2020](https://dadosabertos.tse.jus.br/dataset/candidatos-2020-subtemas), [2022](https://dadosabertos.tse.jus.br/dataset/candidatos-2022) e [2024](https://dadosabertos.tse.jus.br/dataset/candidatos-2024) oferecem recursos **Fotos de candidatos**, separados por UF. O catálogo CKAN permite descobri-los sem depender do HTML do DivulgaCandContas.

```text
GET https://dadosabertos.tse.jus.br/api/3/action/package_show?id=candidatos-2024
```

Selecione `result.resources` cujo nome seja `<UF> - Fotos de candidatos`. Nas eleições gerais, consulte também `BR` para candidaturas nacionais. Em 2020/2024 não há recurso do DF nem BR nesse conjunto de eleições municipais.

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

O ZIP contém a imagem; concatenar seu endereço com o nome do membro **não** cria uma URL pública individual. Uma rota como `/api/fotos/{ano}/{sq}` seria implementada no backend. O índice externo dispensa adicionar tabela ao DER. Esta etapa foi analisada, mas ainda não está implementada no painel.
