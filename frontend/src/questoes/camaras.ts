// Câmaras: o plenário de cada casa legislativa, uma cadeira por eleito, pintada
// pelo partido ou pelo viés político do partido (a mesma escala da P7).
// Edite só este arquivo (e o .css ao lado). A API fica em api/questoes/camaras.ts.
import { corP, esc, fmt, request, titulo } from "../util";
import { UF, abrirCandidato } from "../presentation";
import type { Questao } from "./tipos";
import "./p7-vies.css"; // cores da régua de viés (--q7-cor-esq/centro/dir)
import "./camaras.css";

type Casa = "senado" | "federal" | "estadual" | "vereadores";
type Modo = "partido" | "vies";
type Bloco = "esq" | "centro" | "dir" | "sem";

interface Cadeira {
  sq: string; id: number | null; ano_eleicao: number; nome: string; partido: string;
  nr_partido: number; uf: string; votos: number | null; situacao: string; vies: number | null;
}
interface Resposta {
  casa: Casa; nome_casa: string; ano: number; uf: string | null;
  municipio: { cd: string; nome: string; uf: string } | null;
  onda: { onda: number; estendida: boolean } | null;
  total_cadeiras: number; fora_da_base: number; anos_disponiveis: number[]; cadeiras: Cadeira[];
}
interface Bancada { sg: string; n: number; vies: number | null }

const CASAS: { id: Casa; nome: string }[] = [
  { id: "senado", nome: "Senado" },
  { id: "federal", nome: "Câmara dos Deputados" },
  { id: "estadual", nome: "Assembleia" },
  { id: "vereadores", nome: "Vereadores" },
];
const ANOS_GERAIS = [2014, 2018, 2022, 2026];
const ANOS_MUNICIPAIS = [2004, 2008, 2012, 2016, 2020, 2024];
const UFS_COM_CAMARA = ["AC", "AL", "BA", "RO", "SP"]; // o DF não tem vereadores
const CAPITAL: Record<string, number> = { SP: 71072, BA: 38490, AL: 27855, AC: 1392, RO: 35 };
const UF_NOME: Record<string, string> = { AC: "Acre", AL: "Alagoas", BA: "Bahia", DF: "Distrito Federal", RO: "Rondônia", SP: "São Paulo" };
const BLOCO_NOME: Record<Bloco, string> = { esq: "Esquerda", centro: "Centro", dir: "Direita", sem: "Sem nota" };

// O que o usuário escolheu continua valendo quando o painel redesenha (troca de estado).
const estado = {
  casa: "federal" as Casa,
  modo: "partido" as Modo,
  anoGeral: 2022,
  anoMunicipal: 2024,
  ufVereadores: "SP", // só usado com "Amostra inteira"
  municipio: {} as Record<string, string>, // UF -> código TSE escolhido
  partidos: new Set<string>(),
  blocos: new Set<Bloco>(),
};
let pedido = 0;
const listas = new Map<string, Promise<{ cd: string; nome: string }[]>>();

// mesmo formato da P7: "+30,0" / "−46,4"
const numero = (v: number) => (v > 0 ? "+" : "") + v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).replace("-", "−");
const blocoDe = (v: number | null): Bloco => v == null ? "sem" : v < 0 ? "esq" : v > 0 ? "dir" : "centro";
// Escala divergente da P7 (−100 esquerda, 0 centro, +100 direita), misturada em
// CSS para acompanhar o tema claro/escuro sem recalcular nada em JS.
const corVies = (v: number | null) => v == null
  ? "var(--cam-neutro)"
  : `color-mix(in srgb, var(${v < 0 ? "--q7-cor-esq" : "--q7-cor-dir"}) ${Math.min(100, Math.abs(v)).toFixed(1)}%, var(--q7-cor-centro))`;
const plural = (n: number, um: string, varios: string) => `${fmt.format(n)} ${n === 1 ? um : varios}`;

// ---------------------------------------------------------------------------
// Geometria do plenário: hemiciclo em fileiras concêntricas.
// - até 12 cadeiras: uma fileira só, com cadeiras grandes (Senado de uma UF);
//   com menos de 6, o arco é recuado nas pontas para não virar uma linha reta.
// - acima disso: escolhe o menor número de fileiras que dá cadeiras de bom
//   tamanho, distribui as cadeiras em proporção ao raio de cada fileira (as de
//   fora recebem mais) e ordena tudo por ângulo, da esquerda para a direita.
// ---------------------------------------------------------------------------
const R_FORA = 280;        // raio da fileira externa, em unidades do viewBox
const R_DENTRO = 0.36;     // a fileira interna não entra além desta fração do raio externo
const FOLGA = 0.43;        // raio da cadeira = 43% do passo (sobra um vão entre elas)
const RAIO_MAX = 34;       // cadeira nunca maior que isso
const PASSO_BOM = 48;      // passo a partir do qual não vale acrescentar fileiras

export interface Hemiciclo {
  assentos: { x: number; y: number; fila: number }[];
  raio: number;      // raio de cada cadeira
  filas: number;
  largura: number; altura: number; cx: number; cy: number;
  vao: number;       // raio livre no centro (para o total de cadeiras)
}

export function hemiciclo(n: number): Hemiciclo {
  n = Math.max(0, Math.floor(n));
  let polares: { r: number; t: number; fila: number }[] = [];
  let raio = RAIO_MAX, fora = 140, dentro = 140, filas = n ? 1 : 0;

  if (n > 0 && n <= 12) {
    const recuo = n < 6 ? Math.PI / (1.5 * (n + 1)) : 0;
    fora = dentro = Math.max(140, Math.min(R_FORA, (RAIO_MAX / FOLGA) * (n - 1) / Math.PI));
    const arco = Math.PI - 2 * recuo;
    for (let i = 0; i < n; i++) polares.push({ r: fora, t: n === 1 ? Math.PI / 2 : Math.PI - recuo - i * arco / (n - 1), fila: 0 });
    raio = n === 1 ? RAIO_MAX : Math.min(RAIO_MAX, FOLGA * fora * arco / (n - 1));
  } else if (n > 12) {
    // passo (distância entre fileiras ≈ distância entre cadeiras) para f fileiras
    const passoDe = (f: number) => Math.min(
      Math.PI * f * R_FORA / (n - f + Math.PI * f * (f - 1) / 2),
      R_FORA * (1 - R_DENTRO) / (f - 1),
    );
    let melhor = 0;
    for (let f = 2; f <= 16; f++) melhor = Math.max(melhor, passoDe(f));
    const alvo = Math.min(melhor, PASSO_BOM) * 0.999;
    filas = 2;
    while (passoDe(filas) < alvo) filas++;
    let passo = passoDe(filas);
    // poucas cadeiras: encolhe o plenário inteiro em vez de deixá-las soltas
    const escala = Math.min(1, (RAIO_MAX / FOLGA) / passo);
    fora = R_FORA * escala; passo *= escala;
    const raios = Array.from({ length: filas }, (_, i) => fora - i * passo);
    dentro = raios[filas - 1];
    // cadeiras por fileira, proporcionais ao raio (maiores restos)
    const soma = raios.reduce((a, b) => a + b, 0);
    const cotas = raios.map(r => n * r / soma);
    const porFila = cotas.map(Math.floor);
    let falta = n - porFila.reduce((a, b) => a + b, 0);
    cotas.map((c, i) => ({ i, resto: c - Math.floor(c) })).sort((a, b) => b.resto - a.resto || a.i - b.i)
      .forEach(({ i }) => { if (falta > 0) { porFila[i]++; falta--; } });
    let menorPasso = passo;
    raios.forEach((r, fila) => {
      const k = porFila[fila];
      if (k > 1) menorPasso = Math.min(menorPasso, Math.PI * r / (k - 1));
      for (let i = 0; i < k; i++) polares.push({ r, t: k === 1 ? Math.PI / 2 : Math.PI - i * Math.PI / (k - 1), fila });
    });
    raio = Math.min(RAIO_MAX, FOLGA * menorPasso);
  }

  // da esquerda (ângulo π) para a direita (0); no mesmo ângulo, de fora para dentro
  polares.sort((a, b) => b.t - a.t || b.r - a.r);
  const margem = 8;
  const largura = 2 * (fora + raio + margem), altura = fora + 2 * raio + 2 * margem;
  const cx = largura / 2, cy = fora + raio + margem;
  return {
    assentos: polares.map(p => ({ x: cx + p.r * Math.cos(p.t), y: cy - p.r * Math.sin(p.t), fila: p.fila })),
    raio, filas, largura, altura, cx, cy, vao: Math.max(0, dentro - raio),
  };
}

// ---------------------------------------------------------------------------
// Dados derivados
// ---------------------------------------------------------------------------
function bancadas(cadeiras: Cadeira[]): Bancada[] {
  const mapa = new Map<string, { n: number; soma: number; comNota: number }>();
  for (const c of cadeiras) {
    const b = mapa.get(c.partido) || { n: 0, soma: 0, comNota: 0 };
    b.n++;
    if (c.vies != null) { b.soma += c.vies; b.comNota++; }
    mapa.set(c.partido, b);
  }
  return [...mapa].map(([sg, b]) => ({ sg, n: b.n, vies: b.comNota ? b.soma / b.comNota : null }));
}
const porTamanho = (a: Bancada, b: Bancada) => b.n - a.n || a.sg.localeCompare(b.sg, "pt-BR");
// esquerda primeiro; partido sem nota vai para o fim (nunca é tratado como zero)
const porVies = (a: Bancada, b: Bancada) =>
  (a.vies == null ? 1 : 0) - (b.vies == null ? 1 : 0) || (a.vies ?? 0) - (b.vies ?? 0) || porTamanho(a, b);

function lugarDe(d: Resposta, ufPedida: string | null) {
  if (d.municipio) return `${titulo(d.municipio.nome)}${d.municipio.uf ? ` · ${d.municipio.uf}` : ""}`;
  return ufPedida ? (UF_NOME[ufPedida] || ufPedida) : "seis estados da amostra";
}

// ---------------------------------------------------------------------------
// Montagem
// ---------------------------------------------------------------------------
function montar(el: HTMLElement) {
  const ufPainel: string | null = UF || null;
  el.innerHTML = `<div class="cam">
    <p class="cam-intro">Cada círculo é uma cadeira ocupada por um eleito${ufPainel ? ` em ${esc(UF_NOME[ufPainel] || ufPainel)}` : " nos seis estados da amostra"}. Pinte o plenário pelo <b>partido</b> ou pelo <b>viés político</b> do partido e filtre as bancadas na legenda.</p>
    <div class="cam-controles">
      <div class="cam-grupo"><span class="cam-rot" id="cam-rot-casa">Casa</span>
        <div class="cam-chips" id="cam-casas" role="group" aria-labelledby="cam-rot-casa">${CASAS.map(c => `<button type="button" data-casa="${c.id}" aria-pressed="false">${c.id === "estadual" && ufPainel === "DF" ? "Câmara Legislativa" : c.nome}</button>`).join("")}</div></div>
      <div class="cam-grupo"><span class="cam-rot" id="cam-rot-ano">Ano</span>
        <div class="cam-chips cam-anos" id="cam-anos" role="group" aria-labelledby="cam-rot-ano"></div></div>
      <div class="cam-grupo" id="cam-local" hidden></div>
      <div class="cam-grupo"><span class="cam-rot" id="cam-rot-modo">Cor</span>
        <div class="cam-chips" id="cam-modos" role="group" aria-labelledby="cam-rot-modo">
          <button type="button" data-modo="partido" aria-pressed="false">Por partido</button>
          <button type="button" data-modo="vies" aria-pressed="false">Por viés</button>
        </div></div>
    </div>
    <p class="cam-estado" id="cam-estado" role="status"></p>
    <div class="cam-conteudo" id="cam-conteudo" hidden>
      <div class="cam-cab"><h3 id="cam-titulo"></h3><span class="cam-onda" id="cam-onda"></span></div>
      <div class="cam-resumo" id="cam-resumo" aria-live="polite"></div>
      <p class="cam-aviso" id="cam-aviso" hidden></p>
      <div class="cam-palco" id="cam-palco">
        <svg class="cam-svg" id="cam-svg" role="img" aria-label="">
          <g id="cam-cadeiras"></g>
          <rect class="cam-mesa" id="cam-mesa" rx="3" height="5" aria-hidden="true"/>
          <text class="cam-total" id="cam-total" text-anchor="middle" aria-hidden="true"></text>
          <text class="cam-total-rot" id="cam-total-rot" text-anchor="middle" aria-hidden="true"></text>
        </svg>
        <div class="cam-dica" id="cam-dica" role="tooltip" hidden></div>
      </div>
      <p class="cam-ajuda">Passe o mouse ou use ← → para percorrer as cadeiras; clique (ou Enter) abre a ficha do eleito.</p>
      <div class="cam-escala" id="cam-escala" hidden></div>
      <div class="cam-filtros">
        <div class="cam-filtros-cab"><span class="cam-rot" id="cam-rot-leg">Partidos</span><button type="button" class="link cam-limpar" id="cam-limpar" hidden>Limpar filtro</button></div>
        <div class="cam-legenda" id="cam-legenda" role="group" aria-labelledby="cam-rot-leg"></div>
      </div>
      <div class="cam-notas" id="cam-notas"></div>
      <details class="cam-lista"><summary id="cam-lista-rot">Lista das cadeiras</summary><div class="cam-lista-rolagem" id="cam-lista"></div></details>
    </div>
  </div>`;

  const $ = <T extends Element = HTMLElement>(id: string) => el.querySelector<T>(`#${id}`)!;
  const svg = $<SVGSVGElement>("cam-svg"), camada = $<SVGGElement>("cam-cadeiras");
  const dica = $("cam-dica"), palco = $("cam-palco");
  const nos = new Map<string, SVGCircleElement>(); // cadeira (sq) -> círculo, para animar a troca de lugar
  let dados: Resposta | null = null;
  let ufDados: string | null = null;
  let ordem: (Cadeira | null)[] = []; // cadeira em cada assento, da esquerda para a direita (null = fora da base)
  let circulos: SVGCircleElement[] = [];
  let foco = 0, dicaEm = -1, toque = false;

  const ehMunicipal = () => estado.casa === "vereadores";
  const anoAtual = () => ehMunicipal() ? estado.anoMunicipal : estado.anoGeral;
  // em Vereadores com "Amostra inteira", vale o estado escolhido aqui dentro
  const ufEfetiva = () => ehMunicipal() ? (ufPainel || estado.ufVereadores) : ufPainel;

  function pintarControles(anos = ehMunicipal() ? ANOS_MUNICIPAIS : ANOS_GERAIS) {
    el.querySelectorAll<HTMLElement>("[data-casa]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.casa === estado.casa)));
    el.querySelectorAll<HTMLElement>("[data-modo]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.modo === estado.modo)));
    const caixa = $("cam-anos");
    if (caixa.dataset.anos !== anos.join()) {
      caixa.dataset.anos = anos.join();
      caixa.innerHTML = anos.map(a => `<button type="button" data-ano="${a}" aria-pressed="false">${a}</button>`).join("");
    }
    caixa.querySelectorAll<HTMLElement>("[data-ano]").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.ano! === anoAtual())));
  }

  function mensagem(texto: string, esconder = true) {
    $("cam-estado").textContent = texto;
    if (esconder) $("cam-conteudo").hidden = true;
  }

  function listaMunicipios(uf: string) {
    if (!listas.has(uf)) {
      const p = request(`/api/camaras/municipios?uf=${uf}`, { silencioso: true }) as Promise<{ cd: string; nome: string }[]>;
      p.catch(() => listas.delete(uf));
      listas.set(uf, p);
    }
    return listas.get(uf)!;
  }

  // seletor de município (e de estado, quando o painel está em "Amostra inteira")
  async function pintarLocal(): Promise<string | null> {
    const caixa = $("cam-local");
    if (!ehMunicipal()) { caixa.hidden = true; caixa.innerHTML = ""; return null; }
    caixa.hidden = false;
    if (ufPainel === "DF") {
      caixa.innerHTML = "";
      caixa.hidden = true;
      return null;
    }
    const uf = ufEfetiva()!;
    const lista = await listaMunicipios(uf);
    const escolhido = estado.municipio[uf]
      || String(lista.find(m => Number(m.cd) === CAPITAL[uf])?.cd ?? lista[0]?.cd ?? "");
    estado.municipio[uf] = escolhido;
    const chipsUf = ufPainel ? "" : `<span class="cam-rot" id="cam-rot-uf">Estado</span>
      <div class="cam-chips" id="cam-ufs" role="group" aria-labelledby="cam-rot-uf">${UFS_COM_CAMARA.map(u => `<button type="button" data-cam-uf="${u}" aria-pressed="${u === uf}" title="${esc(UF_NOME[u])}">${u}</button>`).join("")}</div>`;
    caixa.innerHTML = `${chipsUf}<label class="cam-rot" for="cam-mun">Município</label>
      <select id="cam-mun">${lista.map(m => `<option value="${esc(m.cd)}"${String(m.cd) === escolhido ? " selected" : ""}>${esc(titulo(m.nome))}</option>`).join("")}</select>
      ${ufPainel ? "" : `<small class="cam-local-nota">Uma câmara municipal é de um município só: com “Amostra inteira”, o estado é escolhido aqui (padrão: SP, capital).</small>`}`;
    caixa.querySelector<HTMLSelectElement>("#cam-mun")!.onchange = (ev) => {
      estado.municipio[uf] = (ev.target as HTMLSelectElement).value;
      void carregar();
    };
    caixa.querySelectorAll<HTMLElement>("[data-cam-uf]").forEach(b => b.onclick = () => {
      estado.ufVereadores = b.dataset.camUf!;
      void carregar().then(() => el.querySelector<HTMLElement>(`[data-cam-uf="${estado.ufVereadores}"]`)?.focus());
    });
    return escolhido || null;
  }

  async function carregar() {
    const meu = ++pedido;
    const vivo = () => el.isConnected && meu === pedido;
    pintarControles();
    esconderDica();
    $("cam-conteudo").classList.add("cam-carregando");
    try {
      const municipio = await pintarLocal();
      if (!vivo()) return;
      if (ehMunicipal() && ufPainel === "DF") {
        mensagem("O Distrito Federal não tem vereadores: a Câmara Legislativa (deputados distritais) está em “Câmara Legislativa”. Escolha outro estado para ver uma câmara municipal.");
        return;
      }
      if (ehMunicipal() && !municipio) { mensagem("Escolha um município para ver a câmara municipal."); return; }
      const uf = ufEfetiva();
      const params = new URLSearchParams({ casa: estado.casa, ano: String(anoAtual()) });
      if (uf) params.set("uf", uf);
      if (municipio) params.set("municipio", municipio);
      if (!dados) mensagem("Carregando o plenário…", false);
      const r = await request(`/api/camaras?${params}`, { silencioso: true }) as Resposta;
      if (!vivo()) return;
      dados = r; ufDados = uf;
      pintarControles(r.anos_disponiveis?.length ? r.anos_disponiveis : undefined);
      // partidos filtrados que não existem neste plenário deixam de valer
      const siglas = new Set(r.cadeiras.map(c => c.partido));
      for (const p of [...estado.partidos]) if (!siglas.has(p)) estado.partidos.delete(p);
      if (!r.total_cadeiras) {
        mensagem(`Sem eleitos na base para ${r.nome_casa} em ${r.ano} (${lugarDe(r, uf)}).`);
        return;
      }
      mensagem("", false);
      $("cam-conteudo").hidden = false;
      foco = 0;
      desenhar();
    } catch (e) {
      if (vivo()) mensagem(`Não foi possível carregar o plenário: ${(e as Error).message}`);
    } finally {
      if (vivo()) $("cam-conteudo").classList.remove("cam-carregando");
    }
  }

  const temVies = () => !!dados && dados.cadeiras.some(c => c.vies != null);
  const porViesAtivo = () => estado.modo === "vies" && temVies();
  const destacada = (c: Cadeira | null) => {
    const filtraBloco = porViesAtivo() && estado.blocos.size > 0;
    if (!c) return !estado.partidos.size && !filtraBloco;
    return (!estado.partidos.size || estado.partidos.has(c.partido)) && (!filtraBloco || estado.blocos.has(blocoDe(c.vies)));
  };
  const filtroAtivo = () => estado.partidos.size > 0 || (porViesAtivo() && estado.blocos.size > 0);

  function rotuloCadeira(c: Cadeira | null) {
    if (!c) return "Cadeira fora da base: a eleição que a preencheu não está nos dados";
    return [
      titulo(c.nome) || "Sem nome", c.partido + (ufDados ? "" : ` (${c.uf})`),
      c.votos == null ? null : plural(c.votos, "voto", "votos"),
      c.vies == null ? "sem nota de viés" : `viés ${numero(c.vies)}`,
      dados?.casa === "senado" ? `eleito em ${c.ano_eleicao}` : null,
    ].filter(Boolean).join(", ");
  }

  // tudo o que depende de dados + modo: lugares, cores, resumo, legenda
  function desenhar() {
    if (!dados) return;
    const d = dados, viesAtivo = porViesAtivo();
    const lista = bancadas(d.cadeiras);
    const ordemBancadas = [...lista].sort(viesAtivo ? porVies : porTamanho);
    const posicao = new Map(ordemBancadas.map((b, i) => [b.sg, i]));
    // no modo viés vale a nota de cada cadeira (no Senado, o mesmo partido pode ter
    // uma cadeira com nota e outra sem); cadeiras sem nota vão para o fim da fila
    const semNota = (c: Cadeira) => viesAtivo && c.vies == null ? 1 : 0;
    const ocupadas = [...d.cadeiras].sort((a, b) =>
      semNota(a) - semNota(b) || (viesAtivo ? (a.vies ?? 0) - (b.vies ?? 0) : 0)
      || posicao.get(a.partido)! - posicao.get(b.partido)! || (b.votos ?? -1) - (a.votos ?? -1) || a.nome.localeCompare(b.nome, "pt-BR"));
    const vazias = Math.max(0, d.total_cadeiras - ocupadas.length);
    ordem = [...ocupadas, ...Array.from({ length: vazias }, () => null)];

    // --- plenário
    const h = hemiciclo(ordem.length);
    svg.setAttribute("viewBox", `0 0 ${h.largura.toFixed(1)} ${h.altura.toFixed(1)}`);
    svg.style.maxWidth = `${Math.min(760, Math.round(h.largura * 1.5))}px`;
    const usados = new Set<string>();
    circulos = ordem.map((c, i) => {
      const chave = c ? `c${c.sq}` : `v${i - ocupadas.length}`;
      usados.add(chave);
      let no = nos.get(chave);
      if (!no) {
        no = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        no.setAttribute("role", "button");
        nos.set(chave, no);
        camada.appendChild(no);
      }
      const a = h.assentos[i];
      no.setAttribute("class", c ? "cam-cadeira" : "cam-cadeira cam-vazia");
      no.setAttribute("r", (c ? h.raio : h.raio - 1).toFixed(2));
      no.dataset.i = String(i);
      no.style.transform = `translate(${a.x.toFixed(2)}px, ${a.y.toFixed(2)}px)`;
      no.style.fill = !c ? "" : viesAtivo ? corVies(c.vies) : estado.modo === "vies" ? "var(--cam-neutro)" : corP(c.partido);
      no.classList.toggle("cam-sem-nota", !!c && estado.modo === "vies" && c.vies == null);
      no.classList.toggle("cam-clicavel", !!c?.id);
      no.setAttribute("aria-label", rotuloCadeira(c));
      return no;
    });
    for (const [chave, no] of nos) if (!usados.has(chave)) { no.remove(); nos.delete(chave); }
    foco = Math.min(foco, circulos.length - 1);
    circulos.forEach((no, i) => no.setAttribute("tabindex", i === foco ? "0" : "-1"));

    // total no centro, com uma "mesa" embaixo
    const corpo = Math.max(16, Math.min(52, h.vao * 0.42));
    const total = $<SVGTextElement>("cam-total"), totalRot = $<SVGTextElement>("cam-total-rot"), mesa = $<SVGRectElement>("cam-mesa");
    total.setAttribute("x", String(h.cx)); total.setAttribute("y", String(h.cy - 17)); total.style.fontSize = `${corpo.toFixed(1)}px`;
    totalRot.setAttribute("x", String(h.cx)); totalRot.setAttribute("y", String(h.cy));
    const larguraMesa = Math.max(40, Math.min(150, h.vao * 1.1));
    mesa.setAttribute("x", String(h.cx - larguraMesa / 2)); mesa.setAttribute("y", String(h.cy + 6)); mesa.setAttribute("width", String(larguraMesa));

    // --- cabeçalho, resumo e avisos
    const lugar = lugarDe(d, ufDados);
    $("cam-titulo").textContent = `${d.nome_casa} · ${lugar} · ${d.ano}`;
    $("cam-onda").textContent = d.onda ? (d.onda.estendida ? `onda ${d.onda.onda}, estendida por 2 anos` : `onda ${d.onda.onda}`) : "";
    $("cam-onda").hidden = estado.modo !== "vies" || !d.onda;

    const maiores = [...lista].sort(porTamanho);
    const maior = maiores[0];
    const empate = maiores.filter(b => b.n === maior?.n);
    const comNota = d.cadeiras.filter(c => c.vies != null);
    const nEsq = comNota.filter(c => c.vies! < 0).length, nDir = comNota.filter(c => c.vies! > 0).length;
    const nCentro = comNota.length - nEsq - nDir, nSem = d.cadeiras.length - comNota.length;
    const media = comNota.length ? comNota.reduce((s, c) => s + c.vies!, 0) / comNota.length : null;
    const bloco = (valor: string, rotulo: string, cls = "") => `<span class="${cls}"><b>${valor}</b>${rotulo}</span>`;
    const blocos = [
      bloco(fmt.format(d.total_cadeiras), d.total_cadeiras === 1 ? "cadeira" : "cadeiras"),
      maior ? bloco(`${esc(empate.length > 1 ? empate.map(b => b.sg).join(" · ") : maior.sg)}`, `${empate.length > 1 ? "maiores bancadas" : "maior bancada"} · ${plural(maior.n, "cadeira", "cadeiras")}`) : "",
    ];
    if (viesAtivo) {
      blocos.push(bloco(fmt.format(nEsq), "à esquerda (viés < 0)", "cam-r-esq"));
      if (nCentro) blocos.push(bloco(fmt.format(nCentro), "no centro (viés = 0)"));
      blocos.push(bloco(fmt.format(nDir), "à direita (viés > 0)", "cam-r-dir"));
      if (nSem) blocos.push(bloco(fmt.format(nSem), "sem nota de viés"));
      if (media != null) blocos.push(bloco(numero(media), "viés médio das cadeiras"));
    } else {
      blocos.push(bloco(fmt.format(lista.length), lista.length === 1 ? "partido" : "partidos"));
    }
    $("cam-resumo").innerHTML = blocos.join("");

    const aviso = $("cam-aviso");
    let textoAviso = "";
    if (estado.modo === "vies" && !temVies()) {
      textoAviso = `<b>Sem nota de viés em ${d.ano}.</b> O survey de especialistas só cobre as eleições de 2018 a 2024, então nenhuma cadeira deste plenário tem posição na régua: elas aparecem em cinza, agrupadas por partido. Escolha um ano entre 2018 e 2024 para ver o viés.`;
    } else if (estado.modo === "vies" && !d.onda) {
      textoAviso = `<b>${d.ano} não tem onda do survey.</b> Só as cadeiras eleitas em anos cobertos (2018 a 2024) trazem a nota do partido naquela eleição; as demais ficam em cinza, sem nota.`;
    }
    aviso.innerHTML = textoAviso; aviso.hidden = !textoAviso;

    // --- escala de viés e filtro por bloco
    const escala = $("cam-escala");
    escala.hidden = !viesAtivo;
    if (viesAtivo) {
      const chips = ([["esq", nEsq], ["centro", nCentro], ["dir", nDir], ["sem", nSem]] as [Bloco, number][])
        .filter(([, n]) => n > 0);
      for (const b of [...estado.blocos]) if (!chips.some(([k]) => k === b)) estado.blocos.delete(b);
      escala.innerHTML = `<div class="cam-regua"><span>−100 · Esquerda</span><i aria-hidden="true"></i><span>Direita · +100</span>${nSem ? `<span class="cam-sem"><i aria-hidden="true"></i>sem nota de viés</span>` : ""}</div>
        <div class="cam-blocos"><span class="cam-rot" id="cam-rot-bloco">Bloco</span>
          <div class="cam-chips" role="group" aria-labelledby="cam-rot-bloco">${chips.map(([k, n]) => `<button type="button" class="cam-b-${k}" data-bloco="${k}" aria-pressed="${estado.blocos.has(k)}">${BLOCO_NOME[k]}<small>${plural(n, "cadeira", "cadeiras")}</small></button>`).join("")}</div></div>`;
      escala.querySelectorAll<HTMLElement>("[data-bloco]").forEach(b => b.onclick = () => {
        const k = b.dataset.bloco as Bloco;
        estado.blocos.has(k) ? estado.blocos.delete(k) : estado.blocos.add(k);
        b.setAttribute("aria-pressed", String(estado.blocos.has(k)));
        aplicarFiltro();
      });
    }

    // --- legenda clicável (filtro por partido)
    const legenda = $("cam-legenda");
    legenda.innerHTML = ordemBancadas.map(b => {
      const cor = viesAtivo ? corVies(b.vies) : estado.modo === "vies" ? "var(--cam-neutro)" : corP(b.sg);
      const nota = b.vies == null ? "sem nota" : numero(b.vies);
      return `<button type="button" class="cam-leg" data-partido="${esc(b.sg)}" aria-pressed="${estado.partidos.has(b.sg)}" title="${esc(b.sg)}: ${plural(b.n, "cadeira", "cadeiras")}, ${b.vies == null ? "sem nota de viés" : `viés ${nota}`}">
        <i class="${viesAtivo && b.vies == null ? "cam-sw-sem" : ""}" style="background:${cor}" aria-hidden="true"></i><b>${esc(b.sg)}</b><span>${fmt.format(b.n)}</span><small>${temVies() ? nota : ""}</small></button>`;
    }).join("");
    legenda.querySelectorAll<HTMLElement>("[data-partido]").forEach(b => b.onclick = () => {
      const p = b.dataset.partido!;
      estado.partidos.has(p) ? estado.partidos.delete(p) : estado.partidos.add(p);
      b.setAttribute("aria-pressed", String(estado.partidos.has(p)));
      aplicarFiltro();
    });

    // --- notas
    const notas: string[] = [];
    if (d.casa === "senado") notas.push(`O mandato de senador dura 8 anos: a bancada de ${d.ano} soma os eleitos em ${d.ano} e os eleitos em ${d.ano - 4}. A dica de cada cadeira diz em que ano ela foi eleita.`);
    if (d.fora_da_base) notas.push(`<span class="cam-nota-vazia"><i aria-hidden="true"></i></span>${plural(d.fora_da_base, "cadeira aparece vazia (tracejada)", "cadeiras aparecem vazias (tracejadas)")}: a eleição que as preencheu não está na base (senadores só a partir de 2018), então ninguém é inventado para ocupá-las.`);
    if (viesAtivo) notas.push(`As cadeiras estão ordenadas da esquerda para a direita pelo viés do partido (−100 esquerda, +100 direita; notas de especialistas, Bolognesi et al.).${nSem ? " Partidos sem nota ficam em cinza no fim da fila, à direita — isso não é uma posição política." : ""}`);
    else if (estado.modo === "partido") notas.push("As cadeiras estão agrupadas por partido, da maior para a menor bancada; dentro de cada bancada, do mais para o menos votado.");
    if (!ufDados && !d.municipio) notas.push("Com “Amostra inteira”, o plenário soma as bancadas dos seis estados da amostra, não a casa completa.");
    $("cam-notas").innerHTML = notas.map(n => `<p class="nota">${n}</p>`).join("");

    // descrição para leitores de tela
    const principais = maiores.slice(0, 8).map(b => `${b.sg} ${b.n}`).join(", ");
    const resto = maiores.length > 8 ? ` e outros ${maiores.length - 8} partidos` : "";
    svg.setAttribute("aria-label", `Plenário: ${d.nome_casa}, ${lugar}, ${d.ano}. ${plural(d.total_cadeiras, "cadeira", "cadeiras")}${d.fora_da_base ? `, ${d.fora_da_base} fora da base` : ""}. ${principais}${resto}.`
      + (viesAtivo ? ` Pelo viés do partido: ${nEsq} à esquerda, ${nDir} à direita${nCentro ? `, ${nCentro} no centro` : ""}${nSem ? `, ${nSem} sem nota` : ""}.` : ""));

    aplicarFiltro();
  }

  // destaque/esmaecimento, contador do centro e lista acessível
  function aplicarFiltro() {
    if (!dados) return;
    const d = dados, ativo = filtroAtivo();
    let n = 0;
    ordem.forEach((c, i) => {
      const on = destacada(c);
      if (on && c) n++;
      circulos[i].classList.toggle("cam-apagada", !on);
    });
    $("cam-limpar").hidden = !ativo;
    $<SVGTextElement>("cam-total").textContent = fmt.format(ativo ? n : d.total_cadeiras);
    $<SVGTextElement>("cam-total-rot").textContent = ativo ? `de ${fmt.format(d.total_cadeiras)} cadeiras` : d.total_cadeiras === 1 ? "cadeira" : "cadeiras";

    const visiveis = ordem.filter((c): c is Cadeira => !!c && destacada(c));
    const senado = d.casa === "senado", comUf = !ufDados && !d.municipio;
    $("cam-lista-rot").textContent = `Lista das cadeiras (${fmt.format(visiveis.length)}${ativo ? ` de ${fmt.format(d.cadeiras.length)}, com o filtro` : ""})`;
    $("cam-lista").innerHTML = `<table class="cam-tabela"><thead><tr><th scope="col">Eleito</th><th scope="col">Partido</th>${comUf ? `<th scope="col">UF</th>` : ""}<th scope="col" class="num">Votos</th><th scope="col" class="num">Viés</th>${senado ? `<th scope="col" class="num">Eleito em</th>` : ""}</tr></thead><tbody>${visiveis.map(c => `<tr>
        <td>${c.id ? `<button type="button" class="link" data-ficha="${c.id}">${esc(titulo(c.nome))}</button>` : esc(titulo(c.nome))}</td>
        <td><i class="cam-ponto" style="background:${corP(c.partido)}" aria-hidden="true"></i>${esc(c.partido)}</td>${comUf ? `<td>${esc(c.uf)}</td>` : ""}
        <td class="num">${c.votos == null ? "–" : fmt.format(c.votos)}</td><td class="num">${c.vies == null ? "sem nota" : numero(c.vies)}</td>${senado ? `<td class="num">${c.ano_eleicao}</td>` : ""}</tr>`).join("")}</tbody></table>`;
  }

  // ---- dica (hover, foco e primeiro toque)
  function mostrarDica(i: number) {
    const c = ordem[i], no = circulos[i];
    if (!no) return;
    dicaEm = i;
    if (!c) {
      dica.innerHTML = `<b>Cadeira fora da base</b><span>A eleição que preencheu esta cadeira não está nos dados.</span>`;
    } else {
      dica.innerHTML = `<b>${esc(titulo(c.nome) || "Sem nome")}</b>
        <span><i class="cam-ponto" style="background:${corP(c.partido)}" aria-hidden="true"></i>${esc(c.partido)}${ufDados && !dados?.municipio ? "" : ` · ${esc(c.uf)}`}</span>
        <span>${c.votos == null ? "Votos não informados" : plural(c.votos, "voto", "votos")}</span>
        <span>${c.vies == null ? "Sem nota de viés" : `Viés do partido: <b>${numero(c.vies)}</b>`}</span>
        ${dados?.casa === "senado" ? `<span>Cadeira eleita em ${c.ano_eleicao}</span>` : ""}
        ${c.id ? `<small>${toque ? "Toque de novo" : "Clique"} para abrir a ficha</small>` : ""}`;
    }
    dica.hidden = false;
    const caixa = palco.getBoundingClientRect(), alvo = no.getBoundingClientRect();
    const larg = dica.offsetWidth, alt = dica.offsetHeight;
    const centro = alvo.left + alvo.width / 2 - caixa.left;
    const x = Math.max(4, Math.min(caixa.width - larg - 4, centro - larg / 2));
    let y = alvo.top - caixa.top - alt - 8;
    if (alvo.top - alt - 8 < 0) y = alvo.bottom - caixa.top + 8; // sem espaço em cima: vai para baixo
    dica.style.left = `${x}px`; dica.style.top = `${y}px`;
  }
  function esconderDica() { dicaEm = -1; dica.hidden = true; }
  const indice = (alvo: EventTarget | null) => {
    const no = (alvo as Element | null)?.closest?.(".cam-cadeira") as SVGCircleElement | null;
    return no ? Number(no.dataset.i) : -1;
  };
  function abrir(i: number) {
    const c = ordem[i];
    if (c?.id) { esconderDica(); void abrirCandidato(c.id); }
  }
  function focar(i: number) {
    i = Math.max(0, Math.min(circulos.length - 1, i));
    circulos[foco]?.setAttribute("tabindex", "-1");
    foco = i;
    circulos[i].setAttribute("tabindex", "0");
    circulos[i].focus();
  }

  svg.addEventListener("pointerdown", ev => { toque = ev.pointerType === "touch"; });
  svg.addEventListener("pointerover", ev => { if (ev.pointerType === "touch") return; const i = indice(ev.target); if (i >= 0) mostrarDica(i); });
  svg.addEventListener("pointerout", ev => { if (ev.pointerType !== "touch" && indice(ev.target) >= 0 && indice(ev.relatedTarget) < 0) esconderDica(); });
  svg.addEventListener("focusin", ev => { const i = indice(ev.target); if (i >= 0 && !toque) mostrarDica(i); });
  svg.addEventListener("focusout", () => { if (!toque) esconderDica(); });
  svg.addEventListener("click", ev => {
    const i = indice(ev.target);
    if (i < 0) { esconderDica(); return; }
    // no toque não há hover: o primeiro toque mostra a dica, o segundo abre a ficha
    if (toque && dicaEm !== i) { mostrarDica(i); return; }
    abrir(i);
  });
  svg.addEventListener("keydown", ev => {
    const i = indice(ev.target);
    if (i < 0) return;
    const passo: Record<string, number> = { ArrowRight: i + 1, ArrowLeft: i - 1, ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: circulos.length - 1 };
    if (ev.key in passo) { ev.preventDefault(); toque = false; focar(passo[ev.key]); }
    else if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); abrir(i); }
    else if (ev.key === "Escape" && !dica.hidden) { ev.stopPropagation(); esconderDica(); }
  });

  // ---- controles
  $("cam-casas").addEventListener("click", ev => {
    const b = (ev.target as Element).closest<HTMLElement>("[data-casa]");
    if (!b || b.dataset.casa === estado.casa) return;
    estado.casa = b.dataset.casa as Casa;
    void carregar();
  });
  $("cam-anos").addEventListener("click", ev => {
    const b = (ev.target as Element).closest<HTMLElement>("[data-ano]");
    if (!b) return;
    if (ehMunicipal()) estado.anoMunicipal = +b.dataset.ano!; else estado.anoGeral = +b.dataset.ano!;
    void carregar();
  });
  $("cam-modos").addEventListener("click", ev => {
    const b = (ev.target as Element).closest<HTMLElement>("[data-modo]");
    if (!b || b.dataset.modo === estado.modo) return;
    estado.modo = b.dataset.modo as Modo;
    pintarControles(dados?.anos_disponiveis?.length ? dados.anos_disponiveis : undefined);
    esconderDica();
    desenhar();
  });
  $("cam-limpar").onclick = () => {
    estado.partidos.clear(); estado.blocos.clear();
    el.querySelectorAll("[data-partido], [data-bloco]").forEach(b => b.setAttribute("aria-pressed", "false"));
    aplicarFiltro();
    el.querySelector<HTMLElement>("[data-partido]")?.focus();
  };
  $("cam-lista").addEventListener("click", ev => {
    const b = (ev.target as Element).closest<HTMLElement>("[data-ficha]");
    if (b) void abrirCandidato(+b.dataset.ficha!);
  });

  void carregar();
}

const questao: Questao = {
  id: "camaras",
  numero: "Plenário",
  titulo: "As cadeiras de cada casa, por partido e por viés",
  pergunta: "Como ficam as cadeiras do Senado, da Câmara dos Deputados, das Assembleias e das Câmaras de Vereadores, por partido e pelo viés político de cada partido?",
  resumo: "O plenário desenhado cadeira a cadeira: pinte por partido ou pelo viés (−100 esquerda a +100 direita) e filtre as bancadas.",
  onde: "Senado, Câmara, Assembleia e Vereadores · por estado ou amostra",
  usaAno: false,
  montar,
};
export default questao;
