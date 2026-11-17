// Gráficos da carreira política na ficha do político (gaveta aberta por abrirCandidato).
//
// O módulo tem três camadas, de propósito separadas:
//   1. layout puro (layoutCarreira / layoutVotos): só contas, sem DOM — é o que o
//      script de teste confere (nada sobreposto, nada fora do viewBox);
//   2. SVG em texto (svgCarreira / svgVotos / carreiraHtml): entra no HTML da gaveta;
//   3. ativação no DOM (ativarCarreira): redesenha na largura real do contêiner,
//      liga a dica (hover/foco) e o clique que rola até o cartão na "Trajetória".
//
// Decisões de desenho (o porquê está em ANDAMENTO-CARREIRA.md, na raiz do projeto):
//   - só aparecem as raias dos cargos que a pessoa disputou, sempre na mesma ordem
//     hierárquica (Presidente → Vereador);
//   - deputado distrital (DF) divide a raia com deputado estadual: é o mesmo degrau;
//   - um traço contínuo (tipo linha de metrô) liga as candidaturas em ordem cronológica,
//     na cor do partido; o trecho grosso por cima dele é o mandato;
//   - o gráfico de votos usa a mesma escala de anos e os mesmos marcadores, com uma
//     linha por cargo (votações de cargos diferentes não se comparam);
//   - o SVG é desenhado em pixels reais (viewBox = largura do contêiner), então o
//     texto não encolhe no celular como encolheria num viewBox fixo de 640.
import { corP, fmt, cargoNome, esc, ehEleito, sitTxt, titulo } from "./util";
import "./carreira.css";

/** Campos de uma candidatura que o gráfico usa (os mesmos de `cs` em abrirCandidato). */
export interface Candidatura {
  ano_eleicao: number;
  cargo: string;
  situacao?: string | null;
  partido?: string | null;
  votos?: number | null;
  nm_municipio?: string | null;
  uf?: string | null;
  sq_candidato?: string | number | null;
}

/** Caixa de texto estimada (sem DOM não dá para medir; a estimativa é folgada). */
export interface Caixa { x0: number; x1: number; y0: number; y1: number }

interface Raia { chave: string; nome: string; yTitulo: number; linhas: number[]; y0: number; y1: number }
interface Marca { i: number; x: number; y: number; r: number; eleito: boolean; cor: string; raia: number }
interface Barra { i: number; x0: number; x1: number; y: number; cor: string; ini: number; fim: number; cortado: boolean }
interface Rotulo { texto: string; x: number; y: number; ancora: "start" | "middle" | "end"; caixa: Caixa }
interface Tique { ano: number; x: number; rotulo: boolean }
/** Trecho do traço que liga uma candidatura (de) à seguinte (para), em ordem cronológica. */
interface Ligacao { de: number; para: number; d: string; cor: string; derrota: boolean }

export interface LayoutCarreira {
  W: number; H: number; estreito: boolean;
  x0: number; x1: number; yEixo: number;
  raias: Raia[]; marcas: Marca[]; barras: Barra[]; siglas: Rotulo[]; titulos: Rotulo[]; tiques: Tique[];
  ligacoes: Ligacao[];
  /** escala de anos (o gráfico de votos reaproveita, para os dois ficarem alinhados) */
  escala: { t0: number; t1: number; ME: number; MD: number };
  /** mandato de cada candidatura eleita, por índice em `cs` (anos de início e fim, inclusive) */
  mandatos: Map<number, { ini: number; fim: number; cortado: boolean }>;
}

/* ===================== Regras do domínio ===================== */

// Ordem das raias, de cima para baixo: do cargo de maior abrangência ao local.
// Governador fica acima de senador porque é o chefe do Executivo estadual; distrital
// entra na raia do estadual (é o deputado "estadual" do DF).
const RAIAS: { chave: string; cargos: string[] }[] = [
  { chave: "PRESIDENTE", cargos: ["PRESIDENTE"] },
  { chave: "GOVERNADOR", cargos: ["GOVERNADOR"] },
  { chave: "SENADOR", cargos: ["SENADOR"] },
  { chave: "DEPUTADO FEDERAL", cargos: ["DEPUTADO FEDERAL"] },
  { chave: "DEPUTADO ESTADUAL", cargos: ["DEPUTADO ESTADUAL", "DEPUTADO DISTRITAL"] },
  { chave: "PREFEITO", cargos: ["PREFEITO"] },
  { chave: "VEREADOR", cargos: ["VEREADOR"] },
];
const chaveRaia = (cargo: string): string => RAIAS.find(r => r.cargos.includes(cargo))?.chave ?? cargo;
// cargos fora da lista (vice, suplente…) ganham raia própria, depois das conhecidas
const ordemRaia = (chave: string): number => { const i = RAIAS.findIndex(r => r.chave === chave); return i < 0 ? RAIAS.length : i; };

/** Duração legal do mandato, em anos: 8 para senador, 4 para os demais. */
export const duracaoMandato = (cargo: string): number => cargo === "SENADOR" ? 8 : 4;

const ABREV: Record<string, string> = {
  "PRESIDENTE": "Presidente", "GOVERNADOR": "Governador", "SENADOR": "Senador", "DEPUTADO FEDERAL": "Dep. federal",
  "DEPUTADO ESTADUAL": "Dep. estadual", "DEPUTADO DISTRITAL": "Dep. distrital", "PREFEITO": "Prefeito", "VEREADOR": "Vereador",
};
const cargoCurto = (cargo: string): string => ABREV[cargo] ?? cargoNome(cargo);
const cargoMinusculo = (cargo: string): string => String(cargoNome(cargo)).toLowerCase();
const localDe = (c: Candidatura): string => c.nm_municipio ? `${titulo(c.nm_municipio)} (${c.uf ?? ""})` : (c.uf ?? "");
const partidoDe = (c: Candidatura): string => c.partido || "Sem partido";

// largura aproximada de um texto em px (Schibsted Grotesk; fator folgado para negrito)
const larguraTxt = (s: string, px: number, fator = 0.62): number => s.length * px * fator;
const cruza = (a: Caixa, b: Caixa, folga = 0): boolean =>
  a.x0 < b.x1 + folga && b.x0 < a.x1 + folga && a.y0 < b.y1 && b.y0 < a.y1;
const n1 = (v: number): string => String(Math.round(v * 10) / 10);

/**
 * Mandato de cada candidatura eleita: começa no ano seguinte à eleição e dura 4 anos
 * (8 para senador). Se a pessoa se elege para outro mandato que começa antes do fim,
 * a barra é cortada ali — ninguém acumula dois mandatos eletivos. A base não registra
 * renúncia, cassação nem licença; por isso é "mandato previsto", não "exercido".
 */
export function calcularMandatos(cs: Candidatura[]): Map<number, { ini: number; fim: number; cortado: boolean }> {
  const eleitos = cs.map((c, i) => ({ c, i })).filter(d => ehEleito(d.c.situacao));
  const mapa = new Map<number, { ini: number; fim: number; cortado: boolean }>();
  for (const { c, i } of eleitos){
    const ini = c.ano_eleicao + 1;                     // posse em janeiro do ano seguinte
    let fim = ini + duracaoMandato(c.cargo);           // exclusivo: 2021 + 4 = 2025 (mandato 2021–2024)
    let cortado = false;
    for (const o of eleitos){
      const iniO = o.c.ano_eleicao + 1;
      if (iniO > ini && iniO < fim){ fim = iniO; cortado = true; }
    }
    mapa.set(i, { ini, fim: fim - 1, cortado });      // guarda o último ano, inclusive
  }
  return mapa;
}

/* ===================== Gráfico principal: layout ===================== */

const R = 6;            // raio do marcador (12 px de diâmetro; a área de toque é maior)
const PASSO = 18;       // distância entre marcadores empilhados (mesmo cargo, mesmo ano)
const MES_ELEICAO = 0.8; // outubro: o marcador fica colado no começo do mandato (janeiro seguinte)
const FONTE = 11.5;     // mesma dos textos do gráfico de patrimônio (.pat-linha)

export function layoutCarreira(cs: Candidatura[], largura: number): LayoutCarreira {
  const W = Math.max(280, Math.round(largura));
  const mandatos = calcularMandatos(cs);

  // raias presentes, na ordem hierárquica
  const chaves = [...new Set(cs.map(c => chaveRaia(c.cargo)))]
    .sort((a, b) => ordemRaia(a) - ordemRaia(b));
  const nomeRaia = (chave: string): string => {
    const cargos = [...new Set(cs.filter(c => chaveRaia(c.cargo) === chave).map(c => c.cargo))];
    if (cargos.length === 1) return cargoNome(cargos[0]);
    if (chave === "DEPUTADO ESTADUAL") return "Dep. estadual/distrital";
    return cargoNome(chave);
  };
  // largura da coluna de nomes: a do maior nome. No celular (ou se o nome comer mais de
  // 30% da largura) o nome da raia vai em cima dela, não ao lado.
  const maiorNome = Math.max(...chaves.map(ch => larguraTxt(nomeRaia(ch), 12, 0.6)));
  const estreito = W < 560 || maiorNome + 28 > W * 0.3;
  const ME = estreito ? 14 : Math.max(120, Math.ceil(maiorNome) + 28), MD = 16;

  // intervalo do eixo: o da pessoa, com 2 anos de folga, esticado até o fim do último
  // mandato; no mínimo 10 anos, para uma candidatura só não virar um ponto solto
  const anos = cs.map(c => +c.ano_eleicao);
  let t0 = Math.min(...anos) - 2;
  let t1 = Math.max(Math.max(...anos) + 2, ...[...mandatos.values()].map(m => m.fim + 1));
  const falta = 10 - (t1 - t0);
  if (falta > 0){ t0 -= Math.ceil(falta / 2); t1 += Math.floor(falta / 2); }
  const x = (t: number): number => ME + (t - t0) / (t1 - t0) * (W - ME - MD);

  const raias: Raia[] = [], marcas: Marca[] = [], barras: Barra[] = [];
  const siglas: Rotulo[] = [], titulos: Rotulo[] = [];
  let y = 4;
  // posição de cada candidatura dentro da raia: quem divide cargo e ano é empilhado
  const sub = new Map<number, number>();
  for (const chave of chaves){
    const daRaia = cs.map((c, i) => ({ c, i })).filter(d => chaveRaia(d.c.cargo) === chave);
    const porAno = new Map<number, number>();
    let niveis = 1;
    // no empilhamento o eleito fica na linha de cima, a mesma por onde correm os mandatos
    const pilha = [...daRaia].sort((a, b) => a.c.ano_eleicao - b.c.ano_eleicao
      || Number(ehEleito(b.c.situacao)) - Number(ehEleito(a.c.situacao)) || a.i - b.i);
    for (const d of pilha){
      const k = porAno.get(d.c.ano_eleicao) ?? 0;
      sub.set(d.i, k); porAno.set(d.c.ano_eleicao, k + 1);
      niveis = Math.max(niveis, k + 1);
    }
    const yTopo = y;
    const nome = nomeRaia(chave);
    let yTitulo: number;
    if (estreito){ yTitulo = y + 12; y += 19; }
    y += 15;                                   // faixa das siglas de partido, acima dos marcadores
    const linhas = Array.from({ length: niveis }, (_, k) => y + 9 + k * PASSO);
    y += niveis * PASSO;
    if (!estreito) yTitulo = (linhas[0] + linhas[niveis - 1]) / 2 + 4;
    y += estreito ? 9 : 7;
    const larg = larguraTxt(nome, 12, 0.6);
    titulos.push(estreito
      ? { texto: nome, x: ME, y: yTitulo!, ancora: "start", caixa: { x0: ME, x1: ME + larg, y0: yTitulo! - 10, y1: yTitulo! + 3 } }
      : { texto: nome, x: ME - 16, y: yTitulo!, ancora: "end", caixa: { x0: ME - 16 - larg, x1: ME - 16, y0: yTitulo! - 10, y1: yTitulo! + 3 } });
    raias.push({ chave, nome, yTitulo: yTitulo!, linhas, y0: yTopo, y1: y });
    const iRaia = raias.length - 1;
    for (const d of daRaia){
      const yM = linhas[sub.get(d.i)!];
      const eleito = ehEleito(d.c.situacao), cor = corP(d.c.partido);
      marcas.push({ i: d.i, x: x(d.c.ano_eleicao + MES_ELEICAO), y: yM, r: R, eleito, cor, raia: iRaia });
      const m = mandatos.get(d.i);
      // a barra termina 2 px antes do fim: o vão separa mandatos consecutivos sem contorno
      if (m) barras.push({ i: d.i, x0: x(m.ini), x1: Math.max(x(m.ini) + 3, x(m.fim + 1) - 2), y: yM, cor, ini: m.ini, fim: m.fim, cortado: m.cortado });
    }
  }
  marcas.sort((a, b) => a.i - b.i);

  // traço da trajetória: liga cada candidatura à seguinte, em ordem cronológica. Corre
  // na horizontal pela raia de origem e só nos últimos 2 anos (um intervalo entre
  // eleições) faz a curva até a raia de destino — cúbica com tangentes horizontais, como
  // uma linha de metrô. A cor é a do partido de origem: a troca aparece no marcador em
  // que a pessoa já está no partido novo. `derrota` = o trecho leva a uma candidatura
  // não eleita (o CSS traceja).
  const ordem = cs.map((c, i) => ({ c, i })).sort((a, b) => a.c.ano_eleicao - b.c.ano_eleicao || a.i - b.i);
  const larguraCurva = x(t0 + 2) - x(t0);
  const ligacoes: Ligacao[] = [];
  for (let k = 1; k < ordem.length; k++){
    const A = marcas.find(m => m.i === ordem[k - 1].i)!, B = marcas.find(m => m.i === ordem[k].i)!;
    let d: string;
    if (A.y === B.y) d = `M${n1(A.x)},${A.y}H${n1(B.x)}`;
    else if (B.x - A.x < 1) d = `M${n1(A.x)},${A.y}L${n1(B.x)},${B.y}`;      // mesmo ano: traço reto entre os dois
    else {
      const w = Math.min(B.x - A.x, larguraCurva), xs = B.x - w, xm = xs + w / 2;
      d = `M${n1(A.x)},${A.y}H${n1(xs)}C${n1(xm)},${A.y} ${n1(xm)},${B.y} ${n1(B.x)},${B.y}`;
    }
    ligacoes.push({ de: A.i, para: B.i, d, cor: A.cor, derrota: !B.eleito });
  }

  // siglas: só na primeira candidatura e quando o partido muda (em ordem cronológica,
  // atravessando as raias). Se a sigla não couber sem encostar em outra, fica para a
  // próxima candidatura do mesmo partido; a legenda e a dica cobrem o resto.
  let mostrado: string | null = null;
  const cron = cs.map((c, i) => ({ c, i })).sort((a, b) => a.c.ano_eleicao - b.c.ano_eleicao || a.i - b.i);
  for (const { c, i } of cron){
    const p = partidoDe(c);
    if (p === mostrado) continue;
    if ((sub.get(i) ?? 0) !== 0) continue;     // empilhado embaixo de outro: não há espaço em cima
    const m = marcas.find(d => d.i === i)!;
    const larg = larguraTxt(p, 11, 0.66);
    let cx = Math.min(Math.max(m.x, x(t0) + larg / 2), W - 4 - larg / 2);
    const yT = m.y - R - 5;
    const caixa: Caixa = { x0: cx - larg / 2, x1: cx + larg / 2, y0: yT - 9, y1: yT + 2 };
    if (siglas.some(s => cruza(s.caixa, caixa, 4)) || titulos.some(t => cruza(t.caixa, caixa, 4))) continue;
    siglas.push({ texto: p, x: cx, y: yT, ancora: "middle", caixa });
    mostrado = p;
  }

  // eixo: um tique por eleição (anos pares). Rotula todos se couberem; senão de 4 em 4
  // ou de 8 em 8 anos, sempre alinhado ao primeiro ano que a pessoa disputou (quem só
  // concorre em eleição municipal vê os anos municipais).
  const yEixo = y + 2;
  const tiques: Tique[] = [];
  for (let a = Math.ceil(t0 / 2) * 2; a + MES_ELEICAO <= t1; a += 2) tiques.push({ ano: a, x: x(a + MES_ELEICAO), rotulo: false });
  const MIN = 32;      // "2024" a 11,5 px ocupa ~27 px; abaixo disso os anos encostam
  const pxAno = (W - ME - MD) / (t1 - t0);
  const passo = [2, 4, 8].find(p => p * pxAno >= MIN) ?? 8;
  const base = Math.min(...anos);
  for (const t of tiques) t.rotulo = ((t.ano - base) % passo + passo) % passo === 0;
  const H = yEixo + 24;
  return { W, H, estreito, x0: x(t0), x1: x(t1), yEixo, raias, marcas, barras, siglas, titulos, tiques, mandatos, ligacoes, escala: { t0, t1, ME, MD } };
}

/* ===================== Textos: dica, rótulo acessível e frase-resumo ===================== */

/** Linhas da dica de uma candidatura (também viram o <title> e o aria-label do marcador). */
export function linhasDica(c: Candidatura, mandato?: { ini: number; fim: number; cortado: boolean }): string[] {
  const linhas = [`${c.ano_eleicao} · ${cargoNome(c.cargo)}`, localDe(c), partidoDe(c), sitTxt(c.situacao)];
  if (c.votos != null) linhas.push(`${fmt.format(c.votos)} ${+c.votos === 1 ? "voto" : "votos"}`);
  if (mandato) linhas.push(`Mandato previsto: ${mandato.ini}–${mandato.fim}${mandato.cortado ? " (encurtado por novo mandato)" : ""}`);
  return linhas.filter(Boolean);
}

const plural = (n: number, um: string, varios: string): string => `${n} ${n === 1 ? um : varios}`;
const lista = (itens: string[]): string => itens.length < 2 ? itens.join("") : `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;

/**
 * Frase-resumo, gerada dos dados. Evita flexão de gênero ("venceu" em vez de
 * "eleito/eleita") porque o módulo só recebe as candidaturas.
 * Ex.: "3 cargos disputados em 6 candidaturas ao longo de 16 anos (2008–2024);
 * venceu 4 de 6 disputas; passou de vereador a deputado estadual; esteve em 2 partidos (PT e PSB)."
 */
export function resumoCarreira(cs: Candidatura[]): string {
  if (!cs.length) return "";
  const cron = [...cs].sort((a, b) => a.ano_eleicao - b.ano_eleicao);
  const n = cron.length, a0 = cron[0].ano_eleicao, a1 = cron[n - 1].ano_eleicao;
  const cargos = [...new Set(cron.map(c => c.cargo))];
  const eleitos = cron.filter(c => ehEleito(c.situacao));
  const partidos = [...new Set(cron.map(partidoDe))];
  if (n === 1){
    const c = cron[0];
    return `Uma candidatura na base: ${cargoMinusculo(c.cargo)} em ${c.ano_eleicao}, pelo ${partidoDe(c)}, ${eleitos.length ? "com vitória" : "sem se eleger"}.`;
  }
  const periodo = a1 > a0 ? `${plural(a1 - a0, "ano", "anos")} (${a0}–${a1})` : "";
  const partes: string[] = [];
  if (cargos.length === 1) partes.push(`${n} candidaturas a ${cargoMinusculo(cargos[0])}${periodo ? ` em ${periodo}` : ` em ${a0}`}`);
  else partes.push(`${cargos.length} cargos disputados em ${n} candidaturas${periodo ? ` ao longo de ${periodo}` : ` em ${a0}`}`);

  if (!eleitos.length) partes.push("nenhuma vitória");
  else if (eleitos.length === n) partes.push(n === 2 ? "venceu as duas disputas" : `venceu todas as ${n} disputas`);
  else partes.push(`venceu ${eleitos.length} de ${n} disputas`);

  if (eleitos.length && cargos.length > 1){
    const cargosEleitos = [...new Set(eleitos.map(c => c.cargo))];
    const primeiro = eleitos[0].cargo, ultimo = eleitos[eleitos.length - 1].cargo;
    if (cargosEleitos.length === 1) partes.push(`só se elegeu para ${cargoMinusculo(primeiro)}`);
    else if (primeiro !== ultimo) partes.push(`passou de ${cargoMinusculo(primeiro)} a ${cargoMinusculo(ultimo)}`);
    else partes.push(`teve mandatos de ${lista(cargosEleitos.map(cargoMinusculo))}`);
  }
  if (partidos.length > 1){
    const nomes = partidos.length > 4 ? [...partidos.slice(0, 4), "outros"] : partidos;
    partes.push(`esteve em ${partidos.length} partidos (${lista(nomes)})`);
  }
  const frase = partes.join("; ");
  return frase.charAt(0).toUpperCase() + frase.slice(1) + ".";
}

/* ===================== Gráfico principal: SVG ===================== */

// atributos comuns do alvo interativo (marcador ou barra de votos): focável, com o
// índice da candidatura para a dica e para o clique que leva à "Trajetória"
const alvo = (i: number, rotulo: string, cor: string, ordem: number): string =>
  `tabindex="0" role="button" data-car-i="${i}" aria-label="${esc(rotulo)}. Ativar para ver na trajetória." style="--c:${cor};--o:${ordem}"`;

// Marcador de candidatura (usado nos dois gráficos): anel na cor do fundo, que separa o
// marcador do traço que chega nele + círculo cheio (eleito) ou anel na cor do partido
// (não eleito) + círculo invisível maior como área de toque. .car-borda é um traço um
// pouco mais largo por baixo do anel vazado: sobra um fio de contorno de cada lado, que
// mantém visível um partido de cor próxima à do fundo.
const marcaSvg = (m: { i: number; x: number; y: number; r: number; eleito: boolean; cor: string }, rotulo: string, ordem: number): string =>
  `<g class="car-marca ${m.eleito ? "car-eleito" : "car-nao"}" ${alvo(m.i, rotulo, m.cor, ordem)}>
      <title>${esc(rotulo)}</title>
      <circle cx="${n1(m.x)}" cy="${n1(m.y)}" r="12" class="car-toque"/>
      <circle cx="${n1(m.x)}" cy="${n1(m.y)}" r="${m.r + 2}" class="car-anel"/>
      ${m.eleito ? "" : `<circle cx="${n1(m.x)}" cy="${n1(m.y)}" r="${m.r - 1.5}" class="car-borda"/>`}
      <circle cx="${n1(m.x)}" cy="${n1(m.y)}" r="${m.eleito ? m.r : m.r - 1.5}" class="car-ponto"/>
    </g>`;

export function svgCarreira(cs: Candidatura[], largura: number): string {
  const L = layoutCarreira(cs, largura);
  const rotulo = (i: number): string => linhasDica(cs[i], L.mandatos.get(i)).join(", ");
  const linhasRaia = L.raias.map(r => r.linhas.map(yy => `<line x1="${n1(L.x0)}" y1="${yy}" x2="${n1(L.x1)}" y2="${yy}" class="car-trilho"/>`).join("")).join("");
  const guias = L.tiques.map(t => `<line x1="${n1(t.x)}" y1="${L.raias[0].y0 + (L.estreito ? 19 : 0) + 8}" x2="${n1(t.x)}" y2="${L.yEixo}" class="car-guia"/>`).join("");
  const barras = L.barras.map((b, k) =>
    `<rect x="${n1(b.x0)}" y="${b.y - 3.5}" width="${n1(b.x1 - b.x0)}" height="7" rx="3.5" class="car-mandato" style="--c:${b.cor};--o:${k}"><title>${esc(`Mandato previsto de ${cargoMinusculo(cs[b.i].cargo)}: ${b.ini}–${b.fim}`)}</title></rect>`).join("");
  const marcas = L.marcas.map((m, k) => marcaSvg(m, rotulo(m.i), k)).join("");
  // o traço tem um fio de contorno por baixo (.car-borda), como os marcadores vazados
  const ligacoes = L.ligacoes.map((g, k) => `<g class="car-ligacao${g.derrota ? " car-derrota" : ""}" style="--c:${g.cor};--o:${k}"><path d="${g.d}" class="car-borda"/><path d="${g.d}" class="car-traco"/></g>`).join("");
  const siglas = L.siglas.map(s => `<text x="${n1(s.x)}" y="${s.y}" text-anchor="${s.ancora}" class="car-sigla">${esc(s.texto)}</text>`).join("");
  const titulos = L.titulos.map(t => `<text x="${n1(t.x)}" y="${t.y}" text-anchor="${t.ancora}" class="car-raia">${esc(t.texto)}</text>`).join("");
  const eixo = `<line x1="${n1(L.x0)}" y1="${L.yEixo}" x2="${n1(L.x1)}" y2="${L.yEixo}" class="car-eixo"/>` +
    L.tiques.map(t => `<line x1="${n1(t.x)}" y1="${L.yEixo}" x2="${n1(t.x)}" y2="${L.yEixo + 4}" class="car-eixo"/>` +
      (t.rotulo ? `<text x="${n1(t.x)}" y="${L.yEixo + 17}" text-anchor="middle" class="car-ano">${t.ano}</text>` : "")).join("");
  const descricao = `${resumoCarreira(cs)} Linha do tempo com uma raia por cargo (${L.raias.map(r => r.nome).join(", ")}); cada marcador é uma candidatura, cheio quando eleito; um traço liga as candidaturas em ordem cronológica e o trecho grosso é o mandato.`;
  return `<svg class="car-svg car-linha" viewBox="0 0 ${L.W} ${L.H}" role="img" aria-label="${esc(descricao)}">
    ${guias}${linhasRaia}${eixo}<g aria-hidden="true">${ligacoes}</g>${barras}${titulos}${marcas}${siglas}
  </svg>`;
}

/* ===================== Gráfico de votos ===================== */
// Linha com pontos, no espírito do gráfico de patrimônio (.pat-linha), com duas diferenças:
//   - o eixo X é a mesma escala de anos do gráfico de carreira (os dois ficam alinhados);
//   - há UMA LINHA POR CARGO, ligando só as votações do mesmo cargo. Ligar tudo em ordem
//     cronológica desenharia subidas e quedas que são apenas troca de eleitorado (um
//     vereador tem milhares de votos; um deputado, dezenas de milhares).
// Os pontos são os mesmos marcadores da carreira: cheio = eleito, vazado = não eleito,
// na cor do partido.

interface PontoVoto { i: number; x: number; y: number; r: number; eleito: boolean; cor: string }
export interface LayoutVotos {
  W: number; H: number; yBase: number; x0: number; x1: number;
  pontos: PontoVoto[]; linhas: { chave: string; d: string }[];
  valores: Rotulo[]; series: Rotulo[]; tiques: Tique[];
}

// número compacto para caber em cima do ponto: 8.532 / 12,3 mil / 1,2 mi
const votosCurto = (v: number): string =>
  v >= 1e6 ? (v / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mi"
  : v >= 1e4 ? (v / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: v >= 1e5 ? 0 : 1 }) + " mil"
  : fmt.format(v);

/** Índices (em `cs`) das candidaturas com votos na base, em ordem cronológica. */
const comVotos = (cs: Candidatura[]): number[] =>
  cs.map((c, i) => ({ c, i })).filter(d => d.c.votos != null && Number.isFinite(+d.c.votos!))
    .sort((a, b) => a.c.ano_eleicao - b.c.ano_eleicao || a.i - b.i).map(d => d.i);

export function layoutVotos(cs: Candidatura[], largura: number): LayoutVotos | null {
  const idx = comVotos(cs);
  if (idx.length < 2) return null;          // um ponto só não compara nada
  const C = layoutCarreira(cs, largura);    // mesma escala de anos e mesmos tiques
  const { t0, t1, ME, MD } = C.escala, W = C.W;
  const x = (t: number): number => ME + (t - t0) / (t1 - t0) * (W - ME - MD);
  const topo = 28, yBase = 172, H = yBase + 24;
  const mx = Math.max(1, ...idx.map(i => +cs[i].votos!));
  const y = (v: number): number => yBase - v / mx * (yBase - topo);

  const pontos: PontoVoto[] = [];
  for (const i of idx){
    const p: PontoVoto = { i, x: x(cs[i].ano_eleicao + MES_ELEICAO), y: y(+cs[i].votos!), r: R, eleito: ehEleito(cs[i].situacao), cor: corP(cs[i].partido) };
    // duas candidaturas no mesmo ano com votação parecida: a segunda vai um pouco para o lado
    while (pontos.some(o => Math.abs(o.x - p.x) < 2 * R + 2 && Math.abs(o.y - p.y) < 2 * R + 2)) p.x += 2 * R + 2;
    pontos.push(p);
  }
  const caixaPonto = (p: PontoVoto): Caixa => ({ x0: p.x - p.r - 2, x1: p.x + p.r + 2, y0: p.y - p.r - 2, y1: p.y + p.r + 2 });

  // uma série por raia de cargo (estadual e distrital juntos, como no gráfico de cima)
  const chaves = [...new Set(idx.map(i => chaveRaia(cs[i].cargo)))].sort((a, b) => ordemRaia(a) - ordemRaia(b));
  const series = chaves.map(chave => ({ chave, pts: pontos.filter(p => chaveRaia(cs[p.i].cargo) === chave) }));
  const linhas = series.filter(s => s.pts.length > 1)
    .map(s => ({ chave: s.chave, d: s.pts.map((p, k) => `${k ? "L" : "M"}${n1(p.x)},${n1(p.y)}`).join("") }));

  const postos: Caixa[] = [];
  const livre = (c: Caixa, dono?: PontoVoto): boolean =>
    c.x0 >= 2 && c.x1 <= W - 2 && c.y0 >= 0 && c.y1 <= yBase - 1
    && !postos.some(o => cruza(o, c, 3)) && !pontos.some(p => p !== dono && cruza(caixaPonto(p), c));

  // nome do cargo junto a cada linha (só com 2+ cargos): à direita do último ponto; se não
  // couber, à esquerda do primeiro, ou abaixo do último. Sem lugar, fica só na dica.
  const nomes: Rotulo[] = [];
  if (series.length > 1) for (const s of series){
    const cargos = [...new Set(s.pts.map(p => cs[p.i].cargo))];
    const texto = cargos.length === 1 ? cargoCurto(cargos[0]) : s.chave === "DEPUTADO ESTADUAL" ? "Dep. est./distrital" : cargoCurto(s.chave);
    const larg = larguraTxt(texto, 11, 0.6);
    const ult = s.pts[s.pts.length - 1], pri = s.pts[0];
    const opcoes: { dono: PontoVoto; r: Rotulo }[] = [
      { dono: ult, r: { texto, x: ult.x + 12, y: ult.y + 4, ancora: "start", caixa: { x0: ult.x + 12, x1: ult.x + 12 + larg, y0: ult.y - 7, y1: ult.y + 7 } } },
      { dono: pri, r: { texto, x: pri.x - 12, y: pri.y + 4, ancora: "end", caixa: { x0: pri.x - 12 - larg, x1: pri.x - 12, y0: pri.y - 7, y1: pri.y + 7 } } },
      { dono: ult, r: { texto, x: ult.x, y: ult.y + 21, ancora: "middle", caixa: { x0: ult.x - larg / 2, x1: ult.x + larg / 2, y0: ult.y + 10, y1: ult.y + 24 } } },
    ];
    const ok = opcoes.find(o => livre(o.r.caixa, o.dono));
    if (ok){ nomes.push(ok.r); postos.push(ok.r.caixa); }
  }

  // valor em cima do ponto: o maior de cada cargo primeiro, depois o último, depois os
  // demais em ordem; o que não couber sem encostar em outro texto ou ponto fica na dica
  const valores: Rotulo[] = [];
  const fila = [
    ...series.map(s => [...s.pts].sort((a, b) => a.y - b.y)[0]),
    ...series.map(s => s.pts[s.pts.length - 1]),
    ...pontos,
  ];
  const feitos = new Set<number>();
  for (const p of fila){
    if (feitos.has(p.i)) continue;
    feitos.add(p.i);
    const texto = votosCurto(+cs[p.i].votos!);
    const larg = larguraTxt(texto, FONTE, 0.6);
    const cx = Math.min(Math.max(p.x, 2 + larg / 2), W - 2 - larg / 2);
    const caixa: Caixa = { x0: cx - larg / 2, x1: cx + larg / 2, y0: p.y - p.r - 17, y1: p.y - p.r - 4 };
    if (!livre(caixa, p)) continue;
    valores.push({ texto, x: cx, y: p.y - p.r - 7, ancora: "middle", caixa });
    postos.push(caixa);
  }
  return { W, H, yBase, x0: C.x0, x1: C.x1, pontos, linhas, valores, series: nomes, tiques: C.tiques };
}

export function svgVotos(cs: Candidatura[], largura: number): string {
  const L = layoutVotos(cs, largura);
  if (!L) return "";
  const idx = L.pontos.map(p => p.i);
  const mandatos = calcularMandatos(cs);
  const rotulo = (i: number): string => linhasDica(cs[i], mandatos.get(i)).join(", ");
  const texto = (r: Rotulo, classe: string): string => `<text x="${n1(r.x)}" y="${n1(r.y)}" text-anchor="${r.ancora}" class="${classe}">${esc(r.texto)}</text>`;
  const maior = idx.reduce((a, i) => +cs[i].votos! > +cs[a].votos! ? i : a, idx[0]);
  const descricao = `Votos em cada uma das ${idx.length} candidaturas com votação na base, de ${cs[idx[0]].ano_eleicao} a ${cs[idx[idx.length - 1]].ano_eleicao}, com uma linha por cargo. Maior votação: ${fmt.format(+cs[maior].votos!)} votos em ${cs[maior].ano_eleicao}, para ${cargoMinusculo(cs[maior].cargo)}.`;
  return `<svg class="car-svg car-votos" viewBox="0 0 ${L.W} ${L.H}" role="img" aria-label="${esc(descricao)}">
    ${L.pontos.map(p => `<line x1="${n1(p.x)}" y1="${n1(p.y)}" x2="${n1(p.x)}" y2="${L.yBase}" class="car-prumo"/>`).join("")}
    <line x1="${n1(L.x0)}" y1="${L.yBase}" x2="${n1(L.x1)}" y2="${L.yBase}" class="car-eixo"/>
    ${L.tiques.map(t => `<line x1="${n1(t.x)}" y1="${L.yBase}" x2="${n1(t.x)}" y2="${L.yBase + 4}" class="car-eixo"/>` +
      (t.rotulo ? `<text x="${n1(t.x)}" y="${L.yBase + 17}" text-anchor="middle" class="car-ano">${t.ano}</text>` : "")).join("")}
    <g aria-hidden="true">${L.linhas.map((l, k) => `<path d="${l.d}" class="car-serie" style="--o:${k}"/>`).join("")}</g>
    ${L.pontos.map((p, k) => marcaSvg(p, rotulo(p.i), k)).join("")}
    ${L.series.map(r => texto(r, "car-cargo")).join("")}${L.valores.map(r => texto(r, "car-valor")).join("")}
  </svg>`;
}

/* ===================== HTML que entra na ficha ===================== */

// legenda: o que é cheio, vazado e barra (em tinta neutra) + um quadradinho por partido
function legendaHtml(cs: Candidatura[]): string {
  const partidos = [...new Set([...cs].sort((a, b) => a.ano_eleicao - b.ano_eleicao).map(partidoDe))];
  const temEleito = cs.some(c => ehEleito(c.situacao)), temNao = cs.some(c => !ehEleito(c.situacao));
  return `<ul class="car-legenda" aria-label="Legenda">
    ${temEleito ? `<li><svg viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="5.5" class="car-leg-cheio"/></svg>Eleito</li>` : ""}
    ${temNao ? `<li><svg viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="4.25" class="car-leg-vazado"/></svg>Não eleito</li>` : ""}
    ${temEleito ? `<li><svg viewBox="0 0 22 14" class="car-leg-larga" aria-hidden="true"><rect x="1" y="3.5" width="20" height="7" rx="3.5" class="car-leg-cheio"/></svg>Mandato previsto</li>` : ""}
    ${cs.length > 1 && temNao ? `<li><svg viewBox="0 0 22 14" class="car-leg-larga" aria-hidden="true"><line x1="1" y1="7" x2="21" y2="7" class="car-leg-tracejado"/></svg>Rumo a uma derrota</li>` : ""}
    ${partidos.map(p => `<li><i class="car-leg-partido" style="--c:${corP(p === "Sem partido" ? null : p)}"></i>${esc(p)}</li>`).join("")}
  </ul>`;
}

const LARGURA_PADRAO = 640;   // usada até ativarCarreira medir o contêiner (mesma do .pat-linha)

/**
 * Bloco completo para a ficha: título, frase-resumo, gráfico da carreira, legenda e,
 * se houver 2+ candidaturas com votos, o gráfico de votos. Devolve "" sem candidaturas.
 * Os elementos saem como filhos diretos de .candidato-dashboard (o CSS da ficha
 * estiliza `> h3`), por isso não há um contêiner único em volta.
 */
export function carreiraHtml(cs: Candidatura[], largura = LARGURA_PADRAO): string {
  if (!cs?.length) return "";
  const votos = svgVotos(cs, largura);
  const variosCargos = new Set(comVotos(cs).map(i => chaveRaia(cs[i].cargo))).size > 1;
  return `<h3 id="car-titulo">Carreira política</h3>
    <p class="car-resumo">${esc(resumoCarreira(cs))}</p>
    <div class="car car-anima" data-car="linha">${svgCarreira(cs, largura)}</div>
    ${legendaHtml(cs)}
    <p class="aviso-mini car-nota">Cada marcador é uma candidatura; clique para ir ao cartão dela na Trajetória.${cs.length > 1 ? " O traço liga as candidaturas em ordem cronológica, na cor do partido em que a pessoa estava, e fica tracejado quando leva a uma derrota." : ""} Os trechos grossos mostram a duração legal do mandato (4 anos; 8 para senador) a partir do ano seguinte à eleição, encurtada quando a pessoa se elege para outro cargo antes do fim. A base não registra renúncia, cassação, licença nem suplente que assumiu.</p>
    ${votos ? `<h3>Votos por eleição</h3>
    <div class="car car-anima" data-car="votos">${votos}</div>
    <p class="aviso-mini car-nota">Votos do 1º turno, na mesma escala de anos do gráfico acima; ponto cheio: eleito; vazado: não eleito.${variosCargos ? " Há uma linha por cargo: ela liga só as votações do mesmo cargo, porque o eleitorado de um deputado ou prefeito é muito maior que o de um vereador e ligar cargos diferentes mostraria subidas e quedas que são apenas troca de disputa." : " A linha liga as votações em ordem cronológica."}</p>` : ""}`;
}

/** `id` do cartão de uma candidatura na "Trajetória" (índice em `cs`). */
export const idCartao = (i: number): string => `car-cand-${i}`;

/* ===================== Ativação no DOM ===================== */

let observador: ResizeObserver | null = null;

/**
 * Liga os gráficos depois que o HTML entrou na gaveta: redesenha na largura real
 * (e a cada mudança de largura), mostra a dica em hover/foco/toque e, no clique ou
 * Enter/Espaço, rola até o cartão da candidatura na "Trajetória".
 */
export function ativarCarreira(raiz: HTMLElement | null, cs: Candidatura[]): void {
  observador?.disconnect(); observador = null;
  const caixas = [...(raiz?.querySelectorAll<HTMLElement>(".car[data-car]") ?? [])];
  if (!raiz || !caixas.length || !cs?.length) return;
  const mandatos = calcularMandatos(cs);

  const dica = document.createElement("div");
  dica.className = "car-dica"; dica.setAttribute("role", "status"); dica.hidden = true;
  let ativo: Element | null = null;
  let ultimoPonteiro = "mouse";
  let vistoNoToque = -1;      // candidatura cuja dica já foi aberta por toque (o toque seguinte navega)

  const esconder = (): void => { dica.hidden = true; ativo?.classList.remove("car-ativo"); ativo = null; };
  const mostrar = (el: Element): void => {
    const i = Number((el as HTMLElement).dataset.carI);
    const c = cs[i]; const caixa = el.closest<HTMLElement>(".car");
    if (!c || !caixa) return;
    if (ativo !== el){ ativo?.classList.remove("car-ativo"); ativo = el; el.classList.add("car-ativo"); }
    // conteúdo por textContent: nomes de município e sigla vêm da base
    dica.replaceChildren();
    const [cabeca, local, partido, ...resto] = linhasDica(c, mandatos.get(i));
    const forte = document.createElement("strong"); forte.textContent = cabeca; dica.append(forte);
    const linha = (texto: string, classe = ""): HTMLElement => { const s = document.createElement("span"); s.textContent = texto; if (classe) s.className = classe; dica.append(s); return s; };
    if (local) linha(local);
    const p = linha(partido, "car-dica-partido"); p.style.setProperty("--c", corP(c.partido));
    resto.forEach(t => linha(t));
    linha(ultimoPonteiro === "touch" ? "Toque de novo para ver na trajetória" : "Clique para ver na trajetória", "car-dica-acao");
    caixa.append(dica); dica.hidden = false;
    // posição: acima do marcador, centralizada; vira para baixo ou encosta nas bordas se faltar espaço
    const rc = caixa.getBoundingClientRect();
    const re = (el.querySelector(".car-ponto") ?? el).getBoundingClientRect();
    const lw = dica.offsetWidth, lh = dica.offsetHeight;
    const esq = Math.min(Math.max(re.left + re.width / 2 - rc.left - lw / 2, 0), Math.max(0, rc.width - lw));
    let topo = re.top - rc.top - lh - 10;
    const gavetaTopo = (caixa.closest(".gaveta") ?? document.documentElement).getBoundingClientRect().top;
    if (rc.top + topo < Math.max(0, gavetaTopo) + 4) topo = re.bottom - rc.top + 10;
    dica.style.left = `${esq}px`; dica.style.top = `${topo}px`;
  };

  const irParaCartao = (i: number): void => {
    const li = document.getElementById(idCartao(i));
    if (!li) return;
    const suave = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    // a Trajetória rola na horizontal: `inline` traz o cartão; `block` sobe o topo dele na gaveta
    li.scrollIntoView({ behavior: suave ? "smooth" : "auto", block: "start", inline: "start" });
    li.classList.remove("car-alvo"); void li.offsetWidth; li.classList.add("car-alvo");
    setTimeout(() => li.classList.remove("car-alvo"), 2200);
    if (!li.hasAttribute("tabindex")) li.setAttribute("tabindex", "-1");
    li.focus({ preventScroll: true });
  };

  const alvoDe = (ev: Event): Element | null => (ev.target as Element | null)?.closest?.("[data-car-i]") ?? null;
  for (const caixa of caixas){
    caixa.addEventListener("pointerdown", ev => { ultimoPonteiro = ev.pointerType || "mouse"; });
    caixa.addEventListener("pointerover", ev => { ultimoPonteiro = ev.pointerType || "mouse"; const el = alvoDe(ev); if (el) mostrar(el); });
    caixa.addEventListener("pointerout", ev => {
      if (ev.pointerType === "touch") return;          // no toque a dica fica até tocar fora
      const el = alvoDe(ev), para = ev.relatedTarget as Node | null;
      if (el && !(para && el.contains(para)) && document.activeElement !== el) esconder();
    });
    caixa.addEventListener("focusin", ev => { const el = alvoDe(ev); if (el) mostrar(el); });
    caixa.addEventListener("focusout", ev => { if (alvoDe(ev)) esconder(); });
    caixa.addEventListener("click", ev => {
      const el = alvoDe(ev);
      if (!el){ esconder(); vistoNoToque = -1; return; }
      const i = Number((el as HTMLElement).dataset.carI);
      // no toque não existe hover: o primeiro toque mostra a dica, o segundo navega
      if (ultimoPonteiro === "touch" && vistoNoToque !== i){ mostrar(el); vistoNoToque = i; return; }
      vistoNoToque = -1; esconder();
      irParaCartao(i);
    });
    caixa.addEventListener("keydown", ev => {
      const el = alvoDe(ev);
      if (!el) return;
      if (ev.key === "Enter" || ev.key === " "){ ev.preventDefault(); esconder(); irParaCartao(Number((el as HTMLElement).dataset.carI)); }
      else if (ev.key === "Escape" && !dica.hidden){ ev.stopPropagation(); esconder(); }   // fecha a dica, não a gaveta
    });
  }

  // desenha na largura real: 1 unidade do viewBox = 1 px, então a letra tem tamanho de verdade
  const larguras = new WeakMap<HTMLElement, number>();
  const desenhar = (caixa: HTMLElement, animar: boolean): void => {
    const larg = Math.round(caixa.clientWidth);
    if (!larg || larguras.get(caixa) === larg) return;
    larguras.set(caixa, larg);
    const foco = caixa.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset?.carI : undefined;
    esconder(); dica.remove();
    caixa.classList.toggle("car-anima", animar);       // a entrada animada só vale no primeiro desenho
    caixa.innerHTML = caixa.dataset.car === "votos" ? svgVotos(cs, larg) : svgCarreira(cs, larg);
    // com o script ativo a dica própria substitui o <title> (senão apareceriam as duas);
    // o aria-label do marcador continua dizendo a mesma coisa aos leitores de tela
    caixa.querySelectorAll("[data-car-i] > title").forEach(t => t.remove());
    if (foco != null) caixa.querySelector<HTMLElement>(`[data-car-i="${foco}"]`)?.focus({ preventScroll: true });
  };
  caixas.forEach(c => desenhar(c, true));
  if (typeof ResizeObserver !== "undefined"){
    let quadro = 0;
    observador = new ResizeObserver(() => {
      cancelAnimationFrame(quadro);
      quadro = requestAnimationFrame(() => caixas.forEach(c => { if (c.isConnected) desenhar(c, false); }));
    });
    caixas.forEach(c => observador!.observe(c));
  }
}
