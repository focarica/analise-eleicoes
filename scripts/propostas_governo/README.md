# Coletor de propostas de governo (TSE)

Coleta das propostas de governo de **governador** de **SP** e **BA**, nas eleições de **2014, 2018 e 2022**. Há duas etapas, descritas abaixo:

1. **Coleta** (`python3 -m scripts.propostas_governo`): descoberta, download, extração dos PDFs, associação e manifestos.
2. **Extração de texto** (`python3 -m scripts.propostas_governo.extrair_texto`): texto nativo dos PDFs, OCR das páginas sem texto, marcadores de página e inventário de status. Veja [Extração de texto](#extração-de-texto).

Não há segmentação de propostas nem classificação nesta fase.

As fontes são o [Portal de Dados Abertos do TSE](https://dadosabertos.tse.jus.br/), consultado pela API CKAN (`package_show`). Quando um recurso não aparece na API, a página oficial do conjunto (`/dataset/candidatos-{ano}`) é usada como alternativa. Nenhum site de terceiros é usado.

## Requisitos

- Python 3.10 ou superior.
- Apenas biblioteca padrão. Não há banco de dados nesta etapa.

## Execução

Na raiz do repositório:

```sh
# Plano: descobre os recursos e mostra as URLs, sem baixar nada
python3 -m scripts.propostas_governo --simular

# Um recorte
python3 -m scripts.propostas_governo --anos 2022 --ufs SP

# Todos os recortes (3 anos x 2 UFs)
python3 -m scripts.propostas_governo
```

Opções:

| Opção | Efeito |
|---|---|
| `--anos` | anos a processar (padrão: 2014 2018 2022) |
| `--ufs` | UFs a processar (padrão: SP BA) |
| `--simular` | não baixa nem grava manifestos |
| `--forcar` | baixa de novo mesmo que o arquivo já exista e seja válido |
| `--sem-pagina` | não usa a página do conjunto como alternativa à API |
| `--dir-dados` | diretório de saída (padrão: `data/` na raiz) |

A execução é repetível. Arquivos já baixados e válidos não são baixados de novo; PDFs já extraídos são reaproveitados pelo hash. Downloads interrompidos são retomados a partir do `.part`, com `Range` quando o servidor aceita.

## Estrutura dos resultados

Tudo fica em `data/`, que não é versionado.

```text
data/
  candidaturas/{ano}/
    originais/consulta_cand_{ano}.zip   # ZIP oficial de candidaturas, sem alteração
    candidaturas_governador.csv         # governadores de SP e BA do ano
  propostas_governo/{ano}/{UF}/
    originais/proposta_governo_{ano}_{UF}.zip  # ZIP oficial, sem alteração
    pdfs/                               # PDFs extraídos, com nome gerado
    manifest.csv                        # uma linha por PDF + uma por candidatura sem PDF
    revisao_manual.csv                  # pendências e não associados, para conferência
  propostas_governo/manifest_consolidado.csv
  propostas_governo/relatorio_cobertura.csv
  logs/                                 # log de cada execução e JSON do CKAN por ano
```

Os CSVs usam `;` como separador e UTF-8. Os caminhos em `caminho_local` são relativos à raiz do repositório.

### Nome dos PDFs extraídos

`{ano}_{UF}_{sha256[:12]}_{nome_sanitizado}.pdf`. O nome original fica em `nome_arquivo_original`, e o caminho dentro do ZIP em `caminho_interno_zip`. Os originais não são modificados.

## Estados de associação

| Estado | Significado |
|---|---|
| `MATCH_EXATO` | SQ no nome do arquivo confere com uma candidatura de governador da UF e ano, sem conflito |
| `MATCH_PENDENTE_REVISAO` | SQ de governador, mas com conflito: mais de um PDF para a mesma candidatura ou conteúdo idêntico a outro arquivo de outra candidatura |
| `NAO_ASSOCIADO` | não identificado: nome fora do padrão, SQ inexistente nas candidaturas da UF/ano, PDF inválido ou leiame |
| `OUTRO_CARGO` | **adicionado a esta especificação**: PDF de candidatura de outro cargo (deputado, senador). Inventariado, fora do escopo |
| `SEM_DOCUMENTO_LOCALIZADO` | candidatura de governador sem PDF no recurso oficial |

O campo `busca_conclusiva` diferencia os dois casos de ausência. `sim` significa que o recurso oficial foi lido com sucesso e o SQ não apareceu nele. `nao` significa que o download falhou ou o recurso não foi localizado, e portanto a busca não é conclusiva.

### Por que `OUTRO_CARGO`

Os ZIPs de proposta contêm PDFs de todas as candidaturas da UF, não só de governador. Um PDF de deputado não é "não associado": a candidatura foi identificada e está fora do escopo. Usar `NAO_ASSOCIADO` esconderia essa informação.

## Regras de associação

1. O SQ é extraído do nome do arquivo, nos padrões `{ano}{UF}{SQ}` (2014, 2022 e BA em 2018) e `proposta_governo_{ano}_{UF}_{SQ}` (SP em 2018).
2. O SQ precisa existir nas candidaturas da UF e ano (`consulta_cand`).
3. Hash idêntico entre arquivos de candidaturas diferentes gera `MATCH_PENDENTE_REVISAO`. Os arquivos são preservados e a duplicidade fica em `duplicado_de`.
4. Não há associação por similaridade de nome.

## Candidaturas

- Filtro por `DS_CARGO = GOVERNADOR` e verificação de que `CD_CARGO = 3` coincide com esse nome em todas as linhas da UF. O leiame do TSE não documenta os códigos de cargo, então a verificação é feita sobre os dados lidos. Se houver divergência, o ano é marcado com erro no relatório e a execução segue para os demais recortes.
- Todas as situações são mantidas (`APTO`, `INAPTO` etc.). A situação fica registrada, e nenhuma candidatura é descartada por ela.
- Candidaturas repetidas por turno são unificadas pelo SQ, e os turnos ficam em `turnos`.
- O CSV é lido em UTF-8 quando válido e em Latin-1 caso contrário. Os nomes de colunas são resolvidos por uma tabela de alternativas (`ALIASES`), para que mudanças entre anos apareçam de forma explícita.
- Em 2014 o campo `TP_ABRANGENCIA` vem como `FEDERAL` para governador, enquanto o leiame de 2022 descreve governador como circunscrição estadual. O coletor não usa esse campo para filtrar.

## Segurança na extração

- Só membros `.pdf` são extraídos. Os demais são contados e ignorados.
- Caminhos absolutos, `..`, separadores `\`, links simbólicos, entradas criptografadas, razão de compressão suspeita e tamanhos acima dos limites são rejeitados (`config.py`).
- O nome gravado é sempre gerado pelo coletor; o nome interno do ZIP nunca vira caminho.
- Um membro `.pdf` só é aceito se começar com `%PDF-`.
- Download: o conteúdo é validado (ZIP ou PDF, pelo cabeçalho), não pela extensão nem pelo tipo declarado no CKAN. Respostas HTML de erro são rejeitadas.

## Testes

```sh
python3 -m unittest discover -s scripts/propostas_governo/tests -t .
```

Os testes não dependem da rede: cobrem filtragem de candidaturas, detecção de formato, extração segura, retentativas e retomada de download (com servidor HTTP local), regras de associação, manifestos e relatório.

## Limitações conhecidas

- **Só o nome do arquivo é usado para associar.** Não há leitura do conteúdo do PDF nesta etapa. Um PDF com SQ correto no nome é tratado como do candidato. A conferência manual está em `revisao_manual.csv` e nos casos marcados como pendentes.
- Alguns PDFs têm páginas sem texto nativo (capas, fotos ou digitalizações). Veja [Extração de texto](#extração-de-texto) para o tratamento.
- O SQ `250000003174` aparece no ZIP de SP 2014 mas não nas candidaturas de SP. Ficou como `NAO_ASSOCIADO` e idêntico ao PDF de Laércio Benko. Não foi investigado além disso.
- Se a API CKAN e a página do conjunto ficarem indisponíveis ao mesmo tempo, o recurso aparece como não localizado e a busca fica não conclusiva.

## Extração de texto

```sh
python3 -m scripts.propostas_governo.extrair_texto                    # todos os recortes, com OCR
python3 -m scripts.propostas_governo.extrair_texto --anos 2022 --ufs SP
python3 -m scripts.propostas_governo.extrair_texto --sem-ocr          # só texto nativo
python3 -m scripts.propostas_governo.extrair_texto --forcar           # reprocessa tudo
```

A extração tem duas camadas:

1. **Texto nativo** (`pdftotext`, do Poppler). Não altera o PDF.
2. **OCR** (Tesseract, idioma português) das páginas sem texto nativo. Cada página é rasterizada a 300 DPI com `pdftoppm`, e as imagens temporárias não são gravadas.

### Requisitos

- `pdftotext` e `pdftoppm` (pacote `poppler-utils` no Debian/Ubuntu, `poppler` no Arch).
- `tesseract` 5.x, com o modelo `por.traineddata`. O modelo é lido de `data/tessdata/` quando existe, e caso contrário do diretório padrão do sistema.

No Arch, o modelo vem do pacote `tesseract-data-por` (`sudo pacman -S tesseract-data-por`). Sem ele, copie `por.traineddata` para `data/tessdata/`. O coletor também precisa de `data/tessdata/configs/tsv`, que vem do pacote `tesseract` em `/usr/share/tessdata/configs/tsv`. Sem `--sem-ocr`, o comando para com mensagem clara quando algo estiver faltando.

### Saídas, por recorte

- `texto/{nome_do_pdf}.txt`: texto com marcadores `=== PÁGINA n ===`.
  - Página com texto nativo: o texto é mantido como está.
  - Página sem texto nativo com OCR: o texto aparece sob `[OCR]`.
  - Página sem nada: `[página sem texto nativo]`.
  - Página com título curto nativo e corpo em imagem: o título vem antes e o OCR é anexado.
- `texto/extracao.csv`: um registro por PDF.
- `data/propostas_governo/texto_extracao_consolidado.csv`: todos os recortes juntos.

Colunas principais:

| Coluna | Significado |
|---|---|
| `status_texto` | resultado só do texto nativo: `OK`, `PARCIAL_SEM_TEXTO`, `SEM_TEXTO` ou `ERRO` |
| `paginas_sem_texto` | páginas sem texto nativo (limiar de 30 caracteres), separadas por `;` |
| `ocr_status` | `OK`, `ERRO` ou `NAO_NECESSARIO` (não havia página sem texto) |
| `paginas_ocr_com_texto` | páginas em que o OCR recuperou pelo menos 30 caracteres |
| `paginas_ocr_vazias` | páginas que continuam sem texto depois do OCR |
| `confianca_ocr_media` | média da confiança do Tesseract (0-100) nas palavras reconhecidas |
| `status_final` | resultado depois do OCR: `OK` ou `PARCIAL_SEM_TEXTO` |
| `ocr_versao` | `por-dpi300-psm3`; altera o reaproveitamento se mudar |

Um PDF é considerado sem texto numa página quando ela tem menos de 30 caracteres (`MIN_CARACTERES_POR_PAGINA`). Esse limiar separa capas e imagens de páginas com texto.

Os PDFs `leiame` e os inválidos não entram na extração. Os PDFs de candidatos de outros cargos (`OUTRO_CARGO`) entram, porque fazem parte do inventário.

A execução é repetível: um `.txt` existente é reaproveitado quando o SHA-256 do PDF não mudou e o OCR já foi feito com a mesma versão. Se não houver página sem texto, o OCR não precisa ser refeito.

### Resultado (OCR incluído)

| Ano | UF | PDFs | Nativo OK | Nativo parcial | Nativo sem texto | Páginas OCR | OCR recuperou | Final OK | Final parcial |
|---|---|---|---|---|---|---|---|---|---|
| 2014 | SP | 10 | 8 | 2 | 0 | 3 | 2 | 9 | 1 |
| 2014 | BA | 6 | 3 | 3 | 0 | 8 | 4 | 4 | 2 |
| 2018 | SP | 9 | 8 | 1 | 0 | 1 | 1 | 9 | 0 |
| 2018 | BA | 7 | 3 | 4 | 0 | 8 | 1 | 3 | 4 |
| 2022 | SP | 15 | 10 | 5 | 0 | 11 | 7 | 14 | 1 |
| 2022 | BA | 8 | 4 | 2 | 2 | 15 | 4 | 6 | 2 |

Entre os 46 PDFs de governador, o OCR recuperou texto em 2.327 caracteres no total. São sobretudo títulos e legendas. O corpo das propostas, quando existe, já está no texto nativo. Os casos em que o OCR fez diferença real são páginas com texto digitalizado, como a página 5 de Márcio Antoni Santana (2022 SP), que tinha só o título nativo.

As páginas que continuam sem texto depois do OCR são, em sua maioria, fotos com legenda ("Foto: ..."), capas com arte gráfica e páginas de imagem. Não há texto a recuperar nelas.

### Documentos pessoais no ZIP de propostas

Dois PDFs de 2022 BA, de candidatos a deputado, não são propostas. São documentos pessoais digitalizados (identidade e procuração), presentes no ZIP de propostas do TSE. Eles têm dados pessoais, e o OCR os transcreveu para os `.txt` locais. Estão marcados como `OUTRO_CARGO` no manifesto. Antes de qualquer publicação, esses textos devem ser excluídos ou tratados. A coleta não os filtra automaticamente.

## Normalização dos textos

```sh
python3 -m scripts.propostas_governo.normalizacao
```

Gera `texto_normalizado/*.txt` ao lado de `texto/`. O original não é alterado. A normalização:

- substitui ligaduras (`ﬁ`, `ﬂ`, ...) e remove caracteres invisíveis;
- junta quebras de linha de layout dentro do parágrafo, mantendo títulos, itens de lista e marcadores de página separados;
- remove a hifenização de fim de linha quando é artificial (`exercí-` + `cio` -> `exercício`). Mantém o hífen quando a palavra à esquerda é prefixo composto (`bem-`, `auto-`) ou a palavra à direita é segundo elemento comum (`estar`, `social`).

Estatísticas por arquivo: `propostas_governo/normalizacao_estatisticas.csv`. Nos 55 arquivos, 10 hifenizações foram removidas, todas em quebras reais (`principal-mente`, `em-preender`, `Empreende-dorismo`).

## Segmentação de propostas

```sh
python3 -m scripts.propostas_governo.segmentacao segmentar                 # todos os recortes
python3 -m scripts.propostas_governo.segmentacao consultar --ano 2022 --uf SP --sq 250001612450
python3 -m scripts.propostas_governo.segmentacao amostra --n-propostas 120 --n-descartados 60 --saida revisao.csv
python3 -m scripts.propostas_governo.segmentacao avaliar --revisao revisao.csv
```

Escopo: documentos de **candidatos a governador** com associação `MATCH_EXATO` ou `MATCH_PENDENTE_REVISAO`. Documentos de outros cargos (inclusive os pessoais, que estão no ZIP de propostas de deputados) não são segmentados.

### Como funciona

1. **Blocos e parágrafos** (`segmentacao/documento.py`): o texto normalizado é lido em blocos com página e referência (`p{pagina}-b{n}`). Parágrafos que atravessam quebras de página são unidos. Itens sob um pai terminado em `:` formam um só bloco com o pai.
2. **Sentenças** (`segmentacao/sentencas.py`): divisão que não quebra em abreviações (`Dr.`, `Av.`, `prof.`), iniciais (`J. Silva`), decimais (`3,5`, `2.000`) e `etc.` seguido de minúscula.
3. **Regras determinísticas** (`segmentacao/regras.py`): produzem indícios, não decisões. Verbo de ação no início ou após marcador de compromisso (`vamos`, `preciso`), futuro verbal (`exigiremos`, `dobrará`), voz passiva futura (`serão contratados`), substantivo de ação (`ampliação`, `criação`), marcadores de contexto diagnóstico (pretérito, `hoje`, `segundo`, porcentagens), prescrição (`deve`, `será necessário`), coordenação de verbos com objetos próprios e objeto coordenado com oração reduzida.
4. **Camada semântica** (`segmentacao/semantica.py`): interface `ClassificadorSemantico`, com classes `UMA_PROPOSTA`, `MULTIPLAS_PROPOSTAS`, `SEM_PROPOSTA` e `INDETERMINADO`. A implementação padrão é `HeuristicaLocal` (`heuristica_local_v1`), sem dependências externas. Um modelo de linguagem pode substituí-la implementando a mesma interface.
5. **Consolidação** (`segmentacao/consolidacao.py`):
   - `MULTIPLAS_PROPOSTAS` é dividida só quando há dois verbos de ação com objetos próprios (`Construir escolas e ampliar hospitais.`). `Ampliar e melhorar o atendimento.` não é dividida.
   - Frase de continuação (`Para isso...`, `Essa...`) sem ação própria é anexada à proposta anterior, com status `CONSOLIDADA_DE_FRASES`.
   - `INDETERMINADO` gera proposta com `precisa_revisao = sim` e justificativa. Não há divisão arbitrária.
   - `SEM_PROPOSTA` vai para `trechos_descartados.csv`, com motivo.

### Saídas

Por recorte, em `propostas_governo/{ano}/{UF}/segmentacao/`:

- `propostas.csv`: uma linha por proposta. Campos principais: `proposta_id` (estável, derivado de documento, frases de origem e texto), `texto_original` (trecho exato do texto normalizado), `pagina_inicial`/`pagina_final`, `blocos_origem`, `frases_origem`, `secao`, `status_segmentacao`, `precisa_revisao`, `justificativa`, `confianca`, `metodo_segmentacao`, `ocr`.
- `trechos_descartados.csv`: trechos não considerados proposta, com motivo. Permite conferir omissões.
- `relatorio.csv`: resumo por documento, com status (`OK`, `SEM_TEXTO`, `ERRO`) e contagens.

Consolidado: `propostas_governo/propostas_segmentadas.csv`. A cada execução os arquivos são reconstruídos, então reprocessar não duplica resultados.

### Resultado da primeira execução

| Ano | UF | Documentos | Propostas | Revisão | Descartados |
|---|---|---|---|---|---|
| 2014 | SP | 9 | 670 | 160 | 1.321 |
| 2014 | BA | 6 | 994 | 306 | 2.863 |
| 2018 | SP | 9 | 672 | 203 | 1.883 |
| 2018 | BA | 6 | 879 | 248 | 2.870 |
| 2022 | SP | 10 | 1.547 | 307 | 2.382 |
| 2022 | BA | 6 | 1.860 | 535 | 4.035 |

Total: 6.622 propostas (4.545 `UMA_PROPOSTA`, 1.681 `INDETERMINADO`, 282 `DIVIDIDA_DE_MULTIPLAS`, 114 `CONSOLIDADA_DE_FRASES`), das quais 1.759 com revisão indicada. Descartados: 15.354, dos quais 6.390 descrição sem indício de ação, 3.996 títulos e 2.231 fragmentos.

**Estes números não são medidas de qualidade.** Quantidade de propostas não indica acerto. A avaliação exige revisão humana (ver abaixo).

### Avaliação

Não há conjunto revisado manualmente no repositório. O fluxo:

1. `amostra` gera `revisao.csv` com propostas e descartados sorteados (com semente fixa). A coluna `avaliacao_humana` deve ser preenchida com `PROPOSTA_VALIDA`, `FRAGMENTADA_INDEVIDAMENTE`, `FUNDIDA_INDEVIDAMENTE`, `NAO_E_PROPOSTA` (para propostas), ou `PROPOSTA_OMITIDA`, `DESCARTE_CORRETO` (para descartados).
2. `avaliar` calcula precisão aproximada, fragmentação, fusão indevida, falsos positivos, taxa de omissão na amostra descartada e a quantidade de trechos encaminhados para revisão.

Gerada a amostra inicial com 180 linhas (120 propostas, 60 descartados), ainda sem rótulos. As métricas só podem ser apresentadas depois da revisão.

### Limitações conhecidas

- **Sem avaliação humana, não há métrica de qualidade.** A heurística foi ajustada com os casos de referência do plano e com trechos reais, então os testes não garantem desempenho geral.
- **Escolha de conservadorismo:** trecho narrativo sem nenhum indício de ação ou intenção vai para descartados. Isso reduz revisão, mas pode omitir propostas formuladas de forma descritiva. A amostra de descartados existe para medir isso.
- **Títulos em caixa alta** que são, na prática, o nome de uma proposta (ex.: `AMPLIAÇÃO DE VAGAS EM UNIVERSIDADES`) são tratados como contexto de seção. A revisão deve conferir.
- **Infinitivo genérico em posição inicial** conta como ação (`Saber ouvir...` foi excluído por lista, mas outros verbos passam).
- **Listas com letras e parênteses** (`a)`, `c)`) são tratadas como itens; sub-itens só são unidos ao pai quando o pai termina em `:`.
- **OCR:** os blocos reconhecidos pelo OCR são, em sua maioria, ruído (títulos de capa, legendas). Na primeira execução nenhuma proposta veio de OCR.
- **Sem normalização semântica:** o texto da proposta é o trecho do texto normalizado. Ligaduras e hifenização já foram tratadas, mas a ortografia do original é mantida.
- **Documentos pessoais** continuam no ZIP de propostas de deputados e não são segmentados, pois não são de governador. A marcação no banco fica para a etapa de carga.

## Próximas etapas

OCR das páginas marcadas como sem texto, segmentação das propostas e classificação temática. Todas dependem dos `texto/*.txt`, dos `manifest.csv` e dos PDFs em `pdfs/`, sem novo download.
