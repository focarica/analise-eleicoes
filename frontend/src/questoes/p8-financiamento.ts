// @ts-nocheck
// Questão 8: financiamento público × sucesso eleitoral. Edite só este arquivo (e o .css ao lado).
import { CARGO_COD, ORDEM_COD, ANOS_PRESIDENTE, corP, fmt, brlc, titulo, cargoNome, norm, esc, ehEleito, sitTxt, request } from "../util";
import { UF, ANO, GEO, abrirCandidato } from "../presentation";
import "./p8-financiamento.css";

/* ===================== Questão 8: financiamento público × outras fontes ===================== */
// As faixas classificam cada candidatura pela FRAÇÃO DA RECEITA ARRECADADA que
// veio de fundo público (fundo especial FEFC + fundo partidário), não do gasto.
const FAIXA_ORDEM = ["[00,25)", "[25,50)", "[50,75)", "[75,100]", "sem receita"];
const FAIXA_TXT = {
  "[00,25)": "Fundo é até 24% da receita",
  "[25,50)": "Fundo é 25–49% da receita",
  "[50,75)": "Fundo é 50–74% da receita",
  "[75,100]": "Fundo é 75%+ da receita",
  "sem receita": "Sem receita declarada",
};
// sel: "todos" (padrão) ou Set de anos marcados nos chips; graf: aba do gráfico
const FIN = { cargo: null, sel: "todos", graf: "taxa", log: false, ocultas: new Set(), dados: null, cargaId: null, quemFaixa: null, quemLista: [], quemDesde: 0, quemTemMais: false };
const FIN_COMPACTO = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
const FIN_FAIXA_CURTO = { "[00,25)": "até 24%", "[25,50)": "25–49%", "[50,75)": "50–74%", "[75,100]": "75%+", "sem receita": "sem receita" };
const FIN_FAIXA_COR = { "[00,25)": "var(--faixa-0)", "[25,50)": "var(--faixa-1)", "[50,75)": "var(--faixa-2)", "[75,100]": "var(--faixa-3)", "sem receita": "var(--faixa-4)" };
const FIN_FONTE_SERIE = { "Fundo especial (FEFC)": "var(--ink)", "Fundo partidário": "color-mix(in srgb, var(--ink) 45%, var(--bg))", "Outros recursos": "var(--ink-3)" };
// A TSE escreve a mesma fonte com maiúsculas e acentos variando (e typos: "Fundo
// Partidáo", "Recursos Proprios"); sem essa redução a lista fica com uma linha
// por grafia em vez de uma linha por fonte.
const finFonteNome = f => {
  if (f == null) return "Sem fonte informada";
  const n = norm(f).replace(/\s+/g," ").trim();
  return ({
    "FUNDO ESPECIAL": "Fundo especial (FEFC)",
    "FUNDO ESPECIAL (FEFC)": "Fundo especial (FEFC)",
    "SEM FONTE INFORMADA": "Sem fonte informada",
    "FUNDO PARTIDARIO": "Fundo partidário",
    "FUNDO PARTIDO": "Fundo partidário",
    "FUNDO PARTIDAO": "Fundo partidário",
    "RECURSOS DO FUNDO PARTIDARIO": "Fundo partidário",
    "OUTROS RECURSOS": "Outros recursos",
    "OUTROS RECURSOS NAO DESCRITOS": "Outros recursos não descritos",
    "NAO ESPECIFICADO": "Não especificado",
    "NAO INFORMADO": "Não especificado",
    "RECURSOS DE OUTROS CANDIDATOS/COMITES": "Recursos de outros candidatos/comitês",
    "RECURSOS DE PESSOAS FISICAS": "Recursos de pessoas físicas",
    "RECURSOS DE PESSOAS JURIDICAS": "Recursos de pessoas jurídicas",
    "RECURSOS PROPRIOS": "Recursos próprios",
    "RECURSOS DE PARTIDO POLITICO": "Recursos de partido político",
    "RECURSOS DE ORIGENS NAO IDENTIFICADAS": "Recursos de origens não identificadas",
    "RECURSOS DE ORIGENS NAO IDENTIFICADA": "Recursos de origens não identificadas",
    "RENDIMENTOS DE APLICACOES FINANCEIRAS": "Rendimentos de aplicações financeiras",
    "RECEITAS DIVERSAS A ESPECIFICAR": "Receitas diversas a especificar",
    "COMERCIALIZACAO DE BENS OU REALIZACAO DE EVENTOS": "Comercialização de bens ou realização de eventos",
    "DESCRICAO DAS DOACOES RELATIVAS A COMERCIALIZACAO": "Descrição das doações relativas à comercialização",
    "DESCRICOES DAS DOACOES RELATIVAS A COMERCIALIZACAO OU EVENTO": "Descrição das doações relativas à comercialização",
  })[n] || titulo(f);
};
const finFonteCor = f => FIN_FONTE_SERIE[f] || "var(--ink-2)";

// anos disponíveis do cargo (só existem os anos em que o cargo foi disputado)
// e os que estão marcados; desmarcar tudo volta ao padrão
function finAnosSel(c, cargo){
  const anos = [...new Set(c.faixas.filter(r=>r.cdCargo===cargo).map(r=>r.ano))].sort();
  const sel = FIN.sel === "todos" ? anos : [...FIN.sel];
  let marcados = anos.filter(a=>sel.includes(a));
  if (!marcados.length) marcados = anos;
  return { anos, marcados };
}

// gráfico de linhas genérico: uma linha por série, pontos = anos marcados
function grafFin(anos, series, { fixo0100=false, log=false, fmtV, eixoX = "ano", eixoY = "" }){
  const W = 640, H = 234, L = 54, DR = 16, T = 12, B = 50;
  const todas = series.flatMap(s=>s.pts).filter(p=>log ? p.v > 0 : true);
  if (!todas.length) return "";
  const y = fixo0100 ? d3.scaleLinear().domain([0, 100]).range([H - B, T])
    : log ? d3.scaleLog().domain([d3.min(todas, p=>p.v) * 0.8, d3.max(todas, p=>p.v) * 1.15]).range([H - B, T])
    : d3.scaleLinear().domain([0, d3.max(todas, p=>p.v) * 1.08]).range([H - B, T]).nice();
  const x = d3.scalePoint().domain(anos.map(String)).range([L + 10, W - DR]).padding(0.55);
  const ticks = fixo0100 ? [0, 25, 50, 75, 100]
    : log ? [1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11].filter(v=>v > y.domain()[0] && v < y.domain()[1])
    : y.ticks(4);
  const fmtY = fixo0100 ? v=>`${v}%` : v=>log || v >= 1e5 ? `R$ ${FIN_COMPACTO.format(v)}` : brlc(v);
  const grade = ticks.map(v => `<line x1="${L}" x2="${W - DR + 4}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="var(--line)" stroke-width="0.7"/>
    <text x="${L - 5}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end" font-size="9.5" fill="var(--ink-3)">${fmtY(v)}</text>`).join("");
  const rotulosAnos = anos.map(a => `<text x="${x(String(a)).toFixed(1)}" y="${H - 32}" text-anchor="middle" font-size="10" fill="var(--ink-3)">${a}</text>`).join("");
  const titulos =
    `<text x="${((L + W - DR) / 2).toFixed(1)}" y="${H - 12}" text-anchor="middle" font-size="10" font-weight="600" fill="var(--ink-2)">${esc(eixoX)}</text>` +
    (eixoY ? `<text transform="rotate(-90 14 ${((T + H - B) / 2).toFixed(1)})" x="14" y="${((T + H - B) / 2).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="600" fill="var(--ink-2)">${esc(eixoY)}</text>` : "");
  const corpo = series.map(s => {
    if (FIN.ocultas.has(s.nome) || !s.pts.length) return "";
    const pts = s.pts.filter(p=>log ? p.v > 0 : true);
    if (!pts.length) return "";
    const d = pts.map((p,j)=>`${j ? "L" : "M"}${x(String(p.ano)).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ");
    const circ = pts.map(p => `<circle cx="${x(String(p.ano)).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="3.2" fill="${s.cor}">
      <title>${esc(s.nome)}, ${p.ano}: ${fmtV(p.v)}${p.extra ? ` · ${esc(p.extra)}` : ""}</title></circle>`).join("");
    return `<path d="${d}" fill="none" stroke="${s.cor}" stroke-width="2"/>${circ}`;
  }).join("");
  return `<svg class="fin-grafico" viewBox="0 0 ${W} ${H}" role="img" aria-label="Linhas de comparação por ano">${grade}${rotulosAnos}${titulos}${corpo}</svg>`;
}

function legendaFin(series){
  return `<div class="fin-legenda" role="group" aria-label="Séries do gráfico; clique para ligar ou desligar">${series.map(s =>
    `<button data-serie="${esc(s.nome)}" aria-pressed="${!FIN.ocultas.has(s.nome)}"><i style="background:${s.cor}"></i>${esc(s.nome)}</button>`).join("")}</div>`;
}

// guarda os agregados por chave de escopo: o estado aberto e a presença da
// eleição federal; trocar o ano não nova consulta, o filtro é feito na render
const finCache = new Map();

// Presidente é da federação (uf = "BR"): quando um estado está aberto, os dados
// dele vêm de um pedido extra do escopo inteiro limitado ao cargo 1.
// Consultas suaves: os agregados demoram e não devem prender o véu do mapa.
async function carregarFinanciamento(){
  const chave = `${UF || "*"}·${ANOS_PRESIDENTE.has(ANO) ? "fed" : "estadual"}`;
  if (finCache.has(chave)) return finCache.get(chave);
  if (!UF){ const d = await request("/api/financiamento", {silencioso: true}); finCache.set(chave, d); return d; }
  const pFederal = ANOS_PRESIDENTE.has(ANO) ? request("/api/financiamento?cargo=1", {silencioso: true}) : null;
  const [estado, federal] = await Promise.all([request(`/api/financiamento?uf=${encodeURIComponent(UF)}`, {silencioso: true}), pFederal]);
  const d = !federal ? estado : {
    faixas: [...estado.faixas, ...federal.faixas],
    fontes: [...estado.fontes, ...federal.fontes],
    partidos: [...estado.partidos, ...federal.partidos],
  };
  finCache.set(chave, d);
  return d;
}

async function montarFinanciamento(){
  const el = document.getElementById("fin-conteudo"), botCargo = document.getElementById("fin-cargos");
  if (!el) return;
  const nomes = UF ? `Estado de ${GEO[UF].properties.nome}.` : "Sem estado escolhido: a amostra inteira (AC, AL, BA, DF, RO e SP).";
  const chave = `${UF || "*"}·${ANOS_PRESIDENTE.has(ANO) ? "fed" : "estadual"}`;
  if (finCache.has(chave)){
    FIN.dados = finCache.get(chave);
    aplicarFinanciamento(nomes); // dados já conhecidos: troca de cargo/ano é instantânea
    return;
  }
  // primeira carga do escopo: carrega em segundo plano, com estado local — sem véu
  el.innerHTML = ""; botCargo.innerHTML = "";
  document.getElementById("fin-origem").textContent = nomes;
  el.innerHTML = `<p class="aviso-mini">Carregando dados de financiamento…</p>`;
  const cargaId = Symbol(); FIN.cargaId = cargaId;
  let d;
  try { d = await carregarFinanciamento(); }
  catch(e){ console.error(e); if (FIN.cargaId !== cargaId) return;
    el.innerHTML = `<p class="aviso-mini">Não foi possível carregar os dados de financiamento: ${esc(e.message)}</p>`;
    return; }
  if (FIN.cargaId !== cargaId) return;
  FIN.dados = d;
  aplicarFinanciamento();
}

function aplicarFinanciamento(origemTxt){
  const el = document.getElementById("fin-conteudo"), botCargo = document.getElementById("fin-cargos");
  if (!el || !FIN.dados) return;
  if (origemTxt) document.getElementById("fin-origem").textContent = origemTxt;
  const d = FIN.dados;
  // cargos do escopo inteiro: os anos são escolhidos à parte na seção
  const cargos = ORDEM_COD.filter(cdo =>
    d.faixas.some(r=>r.cdCargo===cdo) || d.partidos.some(r=>r.cdCargo===cdo));
  if (!cargos.length){ el.innerHTML = `<p class="aviso-mini">Sem candidaturas com financiamento na base.</p>`; botCargo.innerHTML = ""; return; }
  if (!cargos.includes(FIN.cargo)) FIN.cargo = cargos[0];
  // anos marcados que não existem no novo escopo: volta para "todos os anos"
  const anosEscopo = new Set([...d.faixas.map(r=>r.ano)]);
  if (FIN.sel instanceof Set && ![...FIN.sel].some(a => anosEscopo.has(a))) FIN.sel = "todos";
  botCargo.innerHTML = cargos.map(cdo => `<button data-c="${cdo}" aria-pressed="${FIN.cargo===cdo}">${CARGO_COD[cdo]}</button>`).join("");
  botCargo.querySelectorAll("button").forEach(b => b.onclick = () => {
    if (FIN.cargo === +b.dataset.c) return; // mesmo cargo: a seção já está montada
    FIN.cargo = +b.dataset.c;
    botCargo.querySelectorAll("button").forEach(o => o.setAttribute("aria-pressed", String(o===b)));
    renderFinanciamento();
  });
  renderFinanciamento();
}

function renderFinanciamento(){
  const el = document.getElementById("fin-conteudo"), botAno = document.getElementById("fin-anos");
  if (!el) return;
  FIN.quemFaixa = null; // o conteúdo refeito começa com a lista "quem são" fechada
  const cargo = FIN.cargo, c = FIN.dados;
  const { anos, marcados } = finAnosSel(c, cargo);
  const selSet = new Set(marcados);
  const junto = r => r.cdCargo===cargo && selSet.has(r.ano);

  // chips multi-ano: "todos os anos" marca tudo; ano individual liga/desliga;
  // desmarcar tudo volta ao padrão
  botAno.innerHTML = anos.length > 1
    ? [`<button data-ano="todos" aria-pressed="${FIN.sel==="todos"}">Todos os anos</button>`,
       ...anos.map(a => `<button data-ano="${a}" aria-pressed="${selSet.has(a)}">${a}</button>`)].join("")
    : "";
  botAno.querySelectorAll("button").forEach(b => b.onclick = () => {
    if (b.dataset.ano === "todos") FIN.sel = "todos";
    else {
      const base = FIN.sel === "todos" ? new Set(anos) : new Set(FIN.sel);
      base.has(+b.dataset.ano) ? base.delete(+b.dataset.ano) : base.add(+b.dataset.ano);
      FIN.sel = base.size ? base : "todos";
    }
    renderFinanciamento();
  });

  // série do gráfico conforme a aba: taxa de eleição por faixa | verba por fonte
  const series = FIN.graf === "taxa"
    ? FAIXA_ORDEM.flatMap(fi => {
        const porAno = new Map(c.faixas.filter(r => junto(r) && r.faixa===fi).map(r=>[r.ano, r]));
        const pts = marcados.filter(a=>porAno.has(a)).map(a => { const q = porAno.get(a);
          return { ano: a, v: q.candidaturas ? q.eleitas * 100 / q.candidaturas : 0, extra: `${fmt.format(q.candidaturas)} candidaturas, ${fmt.format(q.eleitas)} eleitas` }; });
        return pts.length ? [{ nome: FIN_FAIXA_CURTO[fi], cor: FIN_FAIXA_COR[fi], pts }] : [];
      })
    : (() => {
        // agrupa por fonte canônica (reduce grafias) antes de abrir as séries por ano
        const fams = new Map();
        for (const r of c.fontes.filter(junto)){
          const f = finFonteNome(r.fonte);
          const porAno = fams.get(f) || new Map();
          porAno.set(r.ano, (porAno.get(r.ano)||0) + r.total);
          fams.set(f, porAno);
        }
        return [...fams.entries()].map(([f, porAno]) => {
          const pts = marcados.filter(a=>(porAno.get(a)||0)>0).map(a=>({ ano:a, v: porAno.get(a) }));
          return pts.length ? { nome: f, cor: finFonteCor(f), pts } : null;
        }).filter(Boolean);
      })().sort((a,b)=> d3.max(b.pts,p=>p.v) - d3.max(a.pts,p=>p.v));

  // agregados dos cards: soma só dos anos marcados, taxa recalculada
  const faixas = FAIXA_ORDEM.map(fi => {
    const rows = c.faixas.filter(r => junto(r) && r.faixa===fi);
    return { faixa: fi, candidaturas: d3.sum(rows, r=>r.candidaturas) || 0, eleitas: d3.sum(rows, r=>r.eleitas) || 0 };
  });
  const totalCand = d3.sum(faixas, q=>q.candidaturas);
  const periodo = marcados.length > 1 ? `nos anos ${marcados.join(", ")}` : `em ${marcados[0]}`;
  if (!totalCand){ el.innerHTML = `<p class="aviso-mini">Sem candidaturas com receita declarada na base para ${cargoNome(CARGO_COD[cargo])} ${periodo}.</p>`; return; }

  const porFonte = new Map();
  for (const r of c.fontes.filter(junto)){
    const fd = finFonteNome(r.fonte);
    const o = porFonte.get(fd) || { fonte: fd, total: 0 };
    o.total += r.total; porFonte.set(fd, o);
  }
  // listagem: só fontes com verba; as zeradas ficam ruido visual
  const fontes = [...porFonte.values()].filter(r=>r.total>0).sort((a,b)=>b.total-a.total);
  const fonteMax = d3.max(fontes, r=>r.total) || 1;

  const porPartido = new Map();
  for (const r of c.partidos.filter(junto)){
    const o = porPartido.get(r.partido) || { partido: r.partido, candidaturas: 0, eleitas: 0, arrecadado: 0, publicas: 0 };
    o.candidaturas += r.candidaturas; o.eleitas += r.eleitas; o.arrecadado += r.arrecadado; o.publicas += r.publicas;
    porPartido.set(r.partido, o);
  }
  const partidos = [...porPartido.values()]
    .map(r => ({ ...r, pctPublico: r.arrecadado > 0 ? Math.round(r.publicas * 1000 / r.arrecadado) / 10 : null }))
    .sort((a,b)=>b.arrecadado-a.arrecadado).slice(0,10);

  el.innerHTML = `
    <div class="fin-bloco fin-largo">
      <h3>Comparar anos — ${cargoNome(CARGO_COD[cargo]).toLowerCase()}</h3>
      <div class="cargos" role="group" aria-label="Tipo de comparação no gráfico">
        <button data-graf="taxa" aria-pressed="${FIN.graf==="taxa"}">Taxa de eleição por faixa</button>
        <button data-graf="fonte" aria-pressed="${FIN.graf==="fonte"}">Verba por fonte (R$)</button>
      </div>
      ${series.length
        ? (FIN.graf === "taxa"
            ? grafFin(marcados, series, { fixo0100: true, fmtV: v => `${v.toLocaleString("pt-BR",{maximumFractionDigits:1})}%`, eixoY: "taxa de eleição (%)" })
            : grafFin(marcados, series, { log: FIN.log, fmtV: v => brlc(v), eixoY: FIN.log ? "verba (R$, escala log)" : "verba (R$)" })) + legendaFin(series)
        : `<p class="aviso-mini">Sem valores nos anos marcados para desenhar o gráfico.</p>`}
      ${FIN.graf==="fonte" ? `<label class="fin-log"><input type="checkbox" id="fin-log" ${FIN.log?"checked":""}> escala logarítmica</label>` : ""}
      <p class="aviso-mini">${FIN.graf==="taxa"
        ? "Cada ponto é a taxa de eleição das candidaturas da faixa naquele ano (sobre quem tem receita na base). As eleições gerais (2006, 2010, 2014, 2018, 2022) e municipais (2004, 2008, 2012, 2016, 2020, 2024) são ciclos distintos e não se comparam entre si."
        : "Verba declarada como receita, por fonte, em cada ano — não é gasto. Use a escala log quando a diferença de magnitude entre as fontes espremer as linhas menores."}</p>
    </div>
    <div class="fin-bloco">
      <h3>Parcela do fundo público na receita arrecadada (${fmt.format(totalCand)} ${totalCand===1?"candidatura":"candidaturas"} ${periodo})</h3>
      <div class="fin-seg" role="img" aria-label="Candidaturas em cada faixa: fração da receita arrecadada que veio de fundos públicos">
        ${faixas.filter(q=>q.candidaturas).map(q => `<i class="fin-${FAIXA_ORDEM.indexOf(q.faixa)}" style="width:${(q.candidaturas/totalCand*100).toFixed(2)}%" title="${esc(FAIXA_TXT[q.faixa])}: fundo especial + fundo partidário como fração da receita recebida; ${q.candidaturas} candidaturas"></i>`).join("")}
      </div>
      <ol class="fin-faixas">${faixas.map(q => `<li>
        <button type="button" data-faixa="${q.faixa}" aria-pressed="false" title="Fundos públicos (FEFC + fundo partidário) como fração da receita arrecadada da candidatura; clique para ver quem está na faixa, de novo para fechar">
          <i class="faixa-swatch fin-${FAIXA_ORDEM.indexOf(q.faixa)}"></i>${esc(FAIXA_TXT[q.faixa])}
          <b class="num">${q.candidaturas ? fmt.format(q.candidaturas) : ""}</b>
          <span class="num">${q.candidaturas ? ((q.eleitas/q.candidaturas*100).toLocaleString("pt-BR",{maximumFractionDigits:1}) + "% eleitas") : ""}</span>
        </button></li>`).join("")}</ol>
      <div id="fin-quem"></div>
    </div>
    <div class="fin-bloco">
      <h3>Receita por fonte (verba que a campanha recebeu)</h3>
      ${fontes.length ? fontes.map(r => `<div class="hb"><span>${esc(r.fonte)}</span><i class="t" style="width:${r.total/fonteMax*100}%"></i><span class="v">${brlc(r.total)}</span></div>`).join("")
        : `<p class="aviso-mini">Sem receita lançada na base.</p>`}
      <details class="fin-partidos"><summary>Partidos <small>(10 que mais arrecadaram)</small></summary>
      <div class="tabw"><table class="tab"><thead><tr><th>Partido</th><th class="v">Candidaturas</th><th class="v">Eleitas</th><th class="v">Arrecadado</th><th class="v">Público</th></tr></thead><tbody>
      ${partidos.map(r => `<tr>
        <td><span class="chip" style="background:${corP(r.partido)}">${esc(r.partido)}</span></td>
        <td class="v">${fmt.format(r.candidaturas)}</td>
        <td class="v">${fmt.format(r.eleitas)}</td>
        <td class="v num">${brlc(r.arrecadado)}</td>
        <td class="v">${r.pctPublico!=null ? `${r.pctPublico.toLocaleString("pt-BR")}%` : "–"}</td>
      </tr>`).join("")}</tbody></table></div></details>
    </div>`;
  el.querySelectorAll("[data-graf]").forEach(b => b.onclick = () => {
    if (FIN.graf === b.dataset.graf) return;
    FIN.graf = b.dataset.graf;
    renderFinanciamento();
  });
  const caixaLog = document.getElementById("fin-log");
  if (caixaLog) caixaLog.onchange = () => { FIN.log = caixaLog.checked; renderFinanciamento(); };
  el.querySelectorAll("[data-serie]").forEach(b => b.onclick = () => {
    const k = b.dataset.serie;
    FIN.ocultas.has(k) ? FIN.ocultas.delete(k) : FIN.ocultas.add(k);
    renderFinanciamento();
  });
  el.querySelectorAll("[data-faixa]").forEach(b => b.onclick = () => {
    const alvo = document.getElementById("fin-quem");
    if (FIN.quemFaixa === b.dataset.faixa){ // de novo na mesma faixa: colapsa a lista
      FIN.quemFaixa = null;
      el.querySelectorAll("[data-faixa]").forEach(o => o.setAttribute("aria-pressed", "false"));
      if (alvo) alvo.innerHTML = "";
      return;
    }
    el.querySelectorAll("[data-faixa]").forEach(o => o.setAttribute("aria-pressed", String(o===b)));
    quemFinanciamento(b.dataset.faixa, false);
  });
  // confirmação visual de que o conteúdo mudou para o cargo/ano escolhido
  el.classList.remove("surge"); void el.offsetWidth; el.classList.add("surge");
}

// "quem são" na faixa escolhida: maiores arrecadações, clique abre a ficha.
// A faixa escolhida de novo colapsa a lista; a lista entra de 10 em 10 em "Mostrar mais".
// (pedido suave: o indicador de carga é o "Carregando…" desta lista)
async function quemFinanciamento(faixa, continuar){
  const alvo = document.getElementById("fin-quem");
  if (!alvo || !FIN.dados) return;
  if (!continuar){
    FIN.quemFaixa = faixa; FIN.quemLista = []; FIN.quemDesde = 0; FIN.quemTemMais = false;
    alvo.innerHTML = `<p class="aviso-mini">Carregando…</p>`;
  }
  // cargo 1 é nacional: o uf do pedido não vale a pena (a uf da candidatura é "BR")
  const ufParam = FIN.cargo === 1 || !UF ? "" : `&uf=${encodeURIComponent(UF)}`;
  const { marcados } = finAnosSel(FIN.dados, FIN.cargo);
  const multi = marcados.length > 1;
  const anoParam = marcados.join(",");
  try {
    const d = await request(`/api/financiamento/pessoas?cargo=${FIN.cargo}&ano=${encodeURIComponent(anoParam)}&faixa=${encodeURIComponent(faixa)}${ufParam}&limite=10&desde=${FIN.quemDesde}`, {silencioso: true});
    if (!alvo.isConnected || FIN.quemFaixa !== faixa) return;
    FIN.quemLista.push(...d.pessoas); FIN.quemTemMais = d.temMais; FIN.quemDesde = FIN.quemLista.length;
    if (!FIN.quemLista.length){ alvo.innerHTML = `<p class="aviso-mini">Nenhuma candidatura nesta faixa.</p>`; return; }
    alvo.innerHTML = `<h4>Maiores arrecadações na faixa “${esc(FAIXA_TXT[faixa])}”</h4>
      <div class="tabw"><table class="tab"><thead><tr><th>Candidato</th><th>Partido</th>${multi ? "<th>Ano</th>" : ""}<th>Local</th><th>Resultado</th><th class="v">Arrecadado</th><th class="v">Público</th></tr></thead><tbody>
      ${FIN.quemLista.map(p => `<tr>
        <td><button class="link" data-cand="${p.id}">${esc(titulo(p.urna || p.nome))}</button></td>
        <td><span class="chip" style="background:${corP(p.partido)}">${esc(p.partido)}</span></td>
        ${multi ? `<td>${p.ano}</td>` : ""}
        <td>${esc(titulo(p.municipio || p.uf || ""))}</td>
        <td class="${!ehEleito(p.situacao) ? "dim" : ""}">${sitTxt(p.situacao)}</td>
        <td class="v num">${brlc(p.total)}</td>
        <td class="v">${p.pct_publico != null ? p.pct_publico.toLocaleString("pt-BR") + "%" : "–"}</td>
      </tr>`).join("")}</tbody></table>
      ${FIN.quemTemMais ? `<p><button class="link" data-mais="1">Mostrar mais</button></p>` : ""}</div>`;
    alvo.querySelectorAll("[data-cand]").forEach(b => b.onclick = () => abrirCandidato(+b.dataset.cand));
    const mais = alvo.querySelector("[data-mais]");
    if (mais) mais.onclick = () => quemFinanciamento(faixa, true);
  } catch(e){ console.error(e); if (!continuar) alvo.innerHTML = `<p class="aviso-mini">Não foi possível listar as candidaturas: ${esc(e.message)}</p>`; }
}

export default {
  id: "p8", numero: "P8",
  titulo: "Depender de fundo público se elege mais?",
  pergunta: "Sucesso de candidatos dependentes de repasses públicos × financiados por outras fontes",
  resumo: "Taxa de eleição por faixa de dependência de fundo eleitoral e partidário na receita arrecadada.",
  montar(el) {
    el.innerHTML = `<p class="nota">Cada candidatura é classificada pela fração <b>da receita que arrecadou</b> que veio de fundos públicos — fundo eleitoral (FEFC) + fundo partidário somados, divididos pelo total recebido; o resto veio de outras fontes, como recursos próprios e doadores privados. Não é a fração do gasto: é a das entradas. No escopo, o TSE só publica as fontes FUNDO ESPECIAL, FUNDO PARTIDARIO e OUTROS RECURSOS. <span id="fin-origem"></span> Clique em uma faixa para ver quem são.</p>
<div class="cargos" id="fin-cargos" role="group" aria-label="Cargo da seção de financiamento"></div>
<div class="cargos" id="fin-anos" role="group" aria-label="Anos considerados nesta questão"></div>
<div class="fin-grid" id="fin-conteudo"></div>`;
    montarFinanciamento();
  },
};
