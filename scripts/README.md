# Scripts de carga

Esta pasta contém o pipeline local de aquisição e preparação dos dados do TSE para PostgreSQL.

## Requisitos e entrada

- Python 3.10 ou superior; os scripts usam a biblioteca padrão.
- Oito conjuntos CSV compactados de cada ano 2018, 2020, 2022 e 2024: candidaturas, complemento, bens, votos por candidato, votos por partido, comparecimento por zona, perfil do eleitorado e prestação de contas de candidatos.
- Os ZIPs devem estar em `data/raw/` com nomes `<conjunto>_<ano>.zip`. Exemplos: `consulta_cand_2024.zip`, `perfil_eleitorado_2020.zip`.

Obtenha os arquivos no [Portal de Dados Abertos do TSE](https://dadosabertos.tse.jus.br/). A disponibilidade, os nomes internos e os cabeçalhos variam por edição. Não descompacte manualmente.

## Normalizar e importar

Na raiz do repositório:

```sh
python3 scripts/normalizar_dados_tse.py --zip-dir data/raw --output data/staging
python3 scripts/carregar_staging.py --input data/staging
```

O normalizador lê CSV Latin-1, aplica a lista de UFs e anos configurada no próprio script e gera CSV UTF-8 separados por `;`. Preserva sentinelas do TSE para que ausência não vire zero. O carregador substitui os conteúdos das tabelas de entrada de staging em uma transação e preserva os mapas de identificadores usados pelas cargas incrementais.

Para começar do zero e reinicializar também esses mapas, use um banco descartável novo. A preparação e a ordem dos SQLs estão em [sql/README.md](../sql/README.md).

## MotherDuck Flight

O diretório `motherduck/` guarda o script autocontido executado no ambiente Flight do MotherDuck, com fluxo de carga distinto do pipeline local. Veja [motherduck/README.md](motherduck/README.md).
