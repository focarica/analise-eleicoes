// @ts-nocheck
// Registro das questões no frontend, na ordem dos cards. Para acrescentar uma
// questão, crie src/questoes/pN-nome.ts (export default, ver tipos.ts) e uma linha
// abaixo. Cada questão mexe só nos próprios arquivos.
import p1 from "./p1-custo-cadeira";
import p2 from "./p2-patrimonio-gasto";
import p4 from "./p4-escolaridade";
import p5 from "./p5-legenda";
import p8 from "./p8-financiamento";
import p9 from "./p9-propaganda";
import p10 from "./p10-reeleicao";

export const QUESTOES = [p1, p2, p4, p5, p8, p9, p10];
export const questaoPorId = (id) => QUESTOES.find((q) => q.id === id) || null;
