// Registro das questões no servidor. Para acrescentar uma questão, crie
// api/questoes/pN-nome.ts (exportando rotas e, se precisar, municipio/candidato)
// e acrescente uma linha abaixo. Cada questão mexe só no próprio arquivo.
import type { ExtensaoCandidato, ExtensaoMunicipio, QuestaoApi, Rotas } from "./tipos";
import * as p1 from "./p1-custo-cadeira";
import * as p2 from "./p2-patrimonio-gasto";
import * as p4 from "./p4-escolaridade";
import * as p5 from "./p5-legenda";
import * as p8 from "./p8-financiamento";
import * as p9 from "./p9-propaganda";
import * as p10 from "./p10-reeleicao";

const QUESTOES: QuestaoApi[] = [p1, p2, p4, p5, p8, p9, p10];

export const ROTAS_QUESTOES: Rotas = Object.assign({}, ...QUESTOES.map((q) => q.rotas || {}));
export const EXTENSOES_MUNICIPIO: ExtensaoMunicipio[] = QUESTOES.flatMap((q) => q.municipio ? [q.municipio] : []);
export const EXTENSOES_CANDIDATO: ExtensaoCandidato[] = QUESTOES.flatMap((q) => q.candidato ? [q.candidato] : []);
