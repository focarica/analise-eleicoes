// @ts-nocheck
// Questão 10a: reeleição, quem volta. Edite só este arquivo (e o .css ao lado).
import { CARGO_COD, ORDEM_COD, corP, fmt, titulo, cargoNome, esc, request } from "../util";
import { UF, GEO, abrirCandidato } from "../presentation";
import "./p10-reeleicao.css";

/* ===================== Questão 10a: reeleição — quem volta ===================== */
// Tentou = o eleito no ano Y voltou como candidato ao mesmo cargo, na mesma unidade,
// na eleição ordinária seguinte (+4; senador +8); reeleito = venceu lá. A taxa é sempre
// sobre quem tentou; "(% eleitos)" é dos eleitos que tentaram; "média municípios" é a
// média das taxas municipais, ponderada pelo nº de municípios em que alguém tentou.
const REEL_GRUPO_TXT = { voltou: "Voltaram", perderam: "Perderam", nao: "Não tentaram" };
const REEL = { cargo: null, dados: null, cargaId: null, ciclo: null, grupo: "voltou", aberto: true, desde: 0, busca: "", lista: [], temMais: false };
const reelCache = new Map();

// Carga suave: o agregado de reeleição demora e não deve prender o véu do mapa.
async function carregarReeleicao(){
  const chave = UF || "*";
  if (reelCache.has(chave)) return reelCache.get(chave);
  const d = await request(`/api/reeleicao${UF ? `?uf=${encodeURIComponent(UF)}` : ""}`, {silencioso: true});
  reelCache.set(chave, d);
  return d;
}

async function montarReeleicao(){
  const el = document.getElementById("reel-conteudo"), botCargo = document.getElementById("reel-cargos");
  if (!el) return;
  const nomes = UF ? `Estado de ${GEO[UF].properties.nome}.` : "Sem estado escolhido: a amostra inteira (AC, AL, BA, DF, RO e SP).";
  const chave = UF || "*";
  if (reelCache.has(chave)){
    REEL.dados = reelCache.get(chave);
    aplicarReeleicao(nomes); // dados já conhecidos: troca de cargo é instantânea
    return;
  }
  el.innerHTML = ""; botCargo.innerHTML = "";
  document.getElementById("reel-origem").textContent = nomes;
  el.innerHTML = `<p class="aviso-mini">Carregando dados de reeleição…</p>`;
  const cargaId = Symbol(); REEL.cargaId = cargaId;
  let d;
  try { d = await carregarReeleicao(); }
  catch(e){ console.error(e); if (REEL.cargaId !== cargaId) return;
    el.innerHTML = `<p class="aviso-mini">Não foi possível carregar os dados de reeleição: ${esc(e.message)}</p>`;
    return; }
  if (REEL.cargaId !== cargaId) return;
  REEL.dados = d;
  aplicarReeleicao();
}

function aplicarReeleicao(origemTxt){
  const el = document.getElementById("reel-conteudo"), botCargo = document.getElementById("reel-cargos");
  if (!el || !REEL.dados) return;
  if (origemTxt) document.getElementById("reel-origem").textContent = origemTxt;
  const porCargo = new Map(REEL.dados.cargos.map(k => [k.cdCargo, k]));
  const cargos = ORDEM_COD.filter(cdo => (porCargo.get(cdo)?.ciclos.length) || (porCargo.get(cdo)?.media.length));
  if (!cargos.length){ el.innerHTML = `<p class="aviso-mini">Sem dados de reeleição na base.</p>`; botCargo.innerHTML = ""; return; }
  if (!cargos.includes(REEL.cargo)){
    REEL.cargo = cargos[0];
    const { ciclos } = ciclosReel(REEL.cargo);
    REEL.ciclo = ciclos.length ? ciclos[0].anoEleito : null;
    REEL.grupo = "voltou"; REEL.aberto = true; REEL.desde = 0; REEL.busca = "";
  }
  botCargo.innerHTML = cargos.map(cdo => `<button data-c="${cdo}" aria-pressed="${REEL.cargo===cdo}">${CARGO_COD[cdo]}</button>`).join("");
  botCargo.querySelectorAll("button").forEach(b => b.onclick = () => {
    if (REEL.cargo === +b.dataset.c) return; // mesmo cargo: a seção já está montada
    REEL.cargo = +b.dataset.c;
    const { ciclos } = ciclosReel(REEL.cargo);
    REEL.ciclo = ciclos.length ? ciclos[0].anoEleito : null;
    REEL.grupo = "voltou"; REEL.aberto = true; REEL.desde = 0; REEL.busca = "";
    botCargo.querySelectorAll("button").forEach(o => o.setAttribute("aria-pressed", String(o===b)));
    renderReeleicao();
  });
  renderReeleicao();
}

// soma as linhas por ciclo (sem estado: uma linha por UF entra na soma); ciclos sem
// eleição seguinte na base ficam fora da conta (e viram a lista "fora do cálculo",
// como no txt do grupo 7). A média municipal é ponderada pelo nº de municípios em
// que alguém tentou — não pelo total de municípios.
function ciclosReel(cargo){
  const reg = REEL.dados.cargos.find(k=>k.cdCargo===cargo);
  const brutas = reg?.ciclos||[];
  const linhas = brutas.filter(r=>r.haProxima);
  const fora = [...new Set(brutas.filter(r=>!r.haProxima).map(r=>r.anoEleito))].sort();
  const m = new Map();
  for (const r of linhas){
    const k = `${r.anoEleito}|${r.anoDisputa}`;
    if (!m.has(k)) m.set(k, { anoEleito: r.anoEleito, anoDisputa: r.anoDisputa, eleitos: 0, tentaram: 0, reeleitos: 0, somaMun: 0, nMun: 0 });
    const c = m.get(k);
    c.eleitos += r.eleitos; c.tentaram += r.tentaram; c.reeleitos += r.reeleitos;
    if (r.taxaMunicipios != null && r.municipiosComTentativa){ c.somaMun += r.taxaMunicipios * r.municipiosComTentativa; c.nMun += r.municipiosComTentativa; }
  }
  const ciclos = [...m.values()].map(c => ({ ...c,
    taxa: c.tentaram ? Math.round(c.reeleitos * 1000 / c.tentaram) / 10 : null,
    pctEleitos: c.eleitos ? Math.round(c.tentaram * 1000 / c.eleitos) / 10 : null,
    taxaMunicipios: c.nMun ? Math.round(c.somaMun * 10 / c.nMun) / 10 : null,
    municipios: c.nMun || null,
  })).sort((a,b)=>a.anoEleito-b.anoEleito);
  return { ciclos, municipal: cargo === 11 || cargo === 13, fora };
}

// resumo "todas as eleições somadas" por cargo, igual ao bloco final do txt do grupo 7
function resumoReel(){
  const linhas = [];
  const foras = new Set();
  let municipais = null;
  for (const cd of ORDEM_COD){
    if (cd === 1) continue; // Presidente: disputa nacional, fora da régua
    const { ciclos, municipal, fora } = ciclosReel(cd);
    for (const a of fora) foras.add(`${cargoNome(CARGO_COD[cd])} ${a}`);
    if (!ciclos.length) continue;
    const t = ciclos.reduce((s,c)=>({ eleitos: s.eleitos+c.eleitos, tentaram: s.tentaram+c.tentaram, reeleitos: s.reeleitos+c.reeleitos }), { eleitos: 0, tentaram: 0, reeleitos: 0 });
    let sm = 0, nm = 0;
    for (const c of ciclos){ if (c.taxaMunicipios != null && c.municipios){ sm += c.taxaMunicipios * c.municipios; nm += c.municipios; } }
    const linha = { cd, cargo: CARGO_COD[cd], de: ciclos[0].anoEleito, ate: ciclos[ciclos.length-1].anoEleito, ...t,
      taxa: t.tentaram ? Math.round(t.reeleitos * 1000 / t.tentaram) / 10 : null,
      taxaMun: nm ? Math.round(sm * 10 / nm) / 10 : null, municipal };
    linhas.push(linha);
    if (municipal){
      municipais ??= { eleitos: 0, tentaram: 0, reeleitos: 0, sm: 0, nm: 0, de: Infinity, ate: 0 };
      municipais.eleitos += t.eleitos; municipais.tentaram += t.tentaram; municipais.reeleitos += t.reeleitos;
      municipais.sm += sm; municipais.nm += nm;
      municipais.de = Math.min(municipais.de, linha.de); municipais.ate = Math.max(municipais.ate, linha.ate);
    }
  }
  return { linhas, foras: [...foras].sort(), municipais };
}

function aggUfReel(uf, rows){
  const validas = rows.filter(r=>r.haProxima);
  const t = validas.reduce((s,r)=>({ eleitos: s.eleitos+r.eleitos, tentaram: s.tentaram+r.tentaram, reeleitos: s.reeleitos+r.reeleitos }), { eleitos: 0, tentaram: 0, reeleitos: 0 });
  return { uf, ...t, taxa: t.tentaram ? Math.round(t.reeleitos * 1000 / t.tentaram) / 10 : null };
}

// taxa total por UF no cargo: das séries por UF do server, ou da média municipal
function porUfReel(cargo){
  const grada = REEL.dados.estados.find(g=>g.cdCargo===cargo);
  const linhas = grada
    ? grada.porUf.map(u => aggUfReel(u.uf, u.ciclos))
    : (() => {
        const reg = REEL.dados.cargos.find(k=>k.cdCargo===cargo);
        const por = new Map();
        for (const r of (reg?.ciclos||[]).filter(x=>x.haProxima && x.uf)){
          if (!por.has(r.uf)) por.set(r.uf, []);
          por.get(r.uf).push(r);
        }
        return [...por.entries()].map(([uf, rows]) => aggUfReel(uf, rows));
      })();
  return linhas.filter(u=>u.tentaram > 0).sort((a,b)=>(b.taxa ?? -1)-(a.taxa ?? -1));
}

// coluna empilhada por ciclo: os 100% são os eleitos do ano de origem e a coluna
// mostra quem voltou (escuro), quem tentou e perdeu (médio) e quem não tentou
// (claro). O nº acima da coluna é a taxa sobre quem tentou. Em vez de linha
// porque a amostra tem poucos ciclos por cargo — a composição diz mais que 2 pontos
function grafReel(ciclos, municipal){
  const W = 640, H = 214, T = 34, B = 28, L = 44, R = 16;
  const y = d3.scaleLinear().domain([0, 100]).range([H - B, T]);
  const passo = (W - L - R) / ciclos.length;
  const larg = Math.min(88, passo * 0.55);
  const grade = [0, 25, 50, 75, 100].map(v =>
    `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="0.7"/>
     <text x="${L - 5}" y="${y(v) + 3}" text-anchor="end" font-size="9.5" fill="var(--ink-3)">${v}%</text>`).join("");
  const cols = ciclos.map((c, i) => {
    const cx = L + passo * i + passo / 2;
    const nt = c.eleitos - c.tentaram, tp = c.tentaram - c.reeleitos;
    const p = n => n * 100 / (c.eleitos || 1);
    const seg = (de, ate, cor, txt) => ate > de
      ? `<rect x="${(cx - larg/2).toFixed(1)}" y="${y(ate).toFixed(1)}" width="${larg.toFixed(1)}" height="${(y(de) - y(ate)).toFixed(1)}" fill="${cor}"><title>${esc(txt)}</title></rect>` : "";
    // "não tentaram" leva hachura: lê como categoria própria, não como vazio ou dado faltante
    const naoSeg = (de, ate, txt) => ate > de
      ? `${seg(de, ate, "var(--line)", txt)}<rect x="${(cx - larg/2).toFixed(1)}" y="${y(ate).toFixed(1)}" width="${larg.toFixed(1)}" height="${(y(de) - y(ate)).toFixed(1)}" fill="url(#hach-reel)" class="hachura"><title>${esc(txt)}</title></rect>` : "";
    const taxaTxt = c.taxa != null ? `${c.taxa.toLocaleString("pt-BR")}%` : "–";
    return `${seg(0, p(c.reeleitos), "var(--ink)", `Voltaram: ${c.reeleitos} de ${c.eleitos} eleitos em ${c.anoEleito} (${taxaTxt} de quem tentou)`)}` +
      `${seg(p(c.reeleitos), p(c.reeleitos + tp), "color-mix(in srgb, var(--ink) 45%, var(--bg))", `Tentaram e perderam: ${tp}`)}` +
      `${naoSeg(p(c.reeleitos + tp), 100, `Não tentaram de novo: ${nt}`)}` +
      `<text x="${cx.toFixed(1)}" y="${(T - 8).toFixed(1)}" text-anchor="middle" font-size="10.5" font-weight="700" fill="var(--ink)">${taxaTxt}</text>` +
      `${municipal && c.taxaMunicipios != null ? `<text x="${cx.toFixed(1)}" y="${(T - 20).toFixed(1)}" text-anchor="middle" font-size="9" fill="var(--ink-3)">média mun. ${c.taxaMunicipios.toLocaleString("pt-BR")}%</text>` : ""}` +
      `<text x="${cx.toFixed(1)}" y="${H - 10}" text-anchor="middle" font-size="10" fill="var(--ink-3)">${c.anoEleito}→${c.anoDisputa}</text>`;
  }).join("");
  return `<svg class="reel-grafico" viewBox="0 0 ${W} ${H}" role="img" aria-label="Composição da reeleição por ciclo: voltaram, tentaram e perderam, não tentaram">
    <defs><pattern id="hach-reel" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="5" class="hach"/></pattern></defs>
    ${grade}${cols}</svg>`;
}

function renderReeleicao(){
  const el = document.getElementById("reel-conteudo");
  if (!el) return;
  const cargo = REEL.cargo;
  const { ciclos, municipal, fora } = ciclosReel(cargo);
  const res = resumoReel();
  if (!REEL.ciclo || !ciclos.some(c=>c.anoEleito===REEL.ciclo)) REEL.ciclo = ciclos.length ? ciclos[0].anoEleito : null;
  const total = ciclos.reduce((t,c)=>({ eleitos: t.eleitos+c.eleitos, tentaram: t.tentaram+c.tentaram, reeleitos: t.reeleitos+c.reeleitos }), { eleitos: 0, tentaram: 0, reeleitos: 0 });
  const taxaTotal = total.tentaram ? Math.round(total.reeleitos * 1000 / total.tentaram) / 10 : null;
  const pctElTotal = total.eleitos ? Math.round(total.tentaram * 1000 / total.eleitos) / 10 : null;
  const ufs = !UF ? porUfReel(cargo) : [];
  const ufMax = d3.max(ufs, u=>u.taxa) || 1;
  const municipais = res.municipais ? {
    ...res.municipais,
    taxa: res.municipais.tentaram ? Math.round(res.municipais.reeleitos * 1000 / res.municipais.tentaram) / 10 : null,
    taxaMun: res.municipais.nm ? Math.round(res.municipais.sm * 10 / res.municipais.nm) / 10 : null,
  } : null;
  el.innerHTML = `
    ${ciclos.length ? `
    <div class="fin-bloco reel-linha">
      <h3>Taxa de reeleição por ciclo (${fmt.format(total.eleitos)} eleitos, ${fmt.format(total.tentaram)} tentaram${taxaTotal!=null ? `, ${taxaTotal.toLocaleString("pt-BR",{maximumFractionDigits:1})}% voltaram` : ""})</h3>
      ${grafReel(ciclos, municipal)}
      <div class="reel-leg" aria-hidden="true">
        <span><i class="volt"></i>Voltaram</span>
        <span><i class="perd"></i>Tentaram e perderam</span>
        <span><i class="nao"></i>Não tentaram de novo</span>
      </div>
      <p class="aviso-mini">Cada coluna são os 100% dos eleitos no ano de origem: embaixo, escuro, quem voltou; no meio, quem tentou e perdeu; em cima, claro, quem não tentou de novo. O número acima é a taxa de reeleição sobre quem tentou.${municipal ? " \"média mun.\" é a média das taxas dos municípios em que alguém tentou." : ""} Passe o mouse nas seções para ver as contagens.</p>
    </div>
    <div class="fin-bloco">
      <h3>Ciclos — ${cargoNome(CARGO_COD[cargo]).toLowerCase()}</h3>
      <div class="tabw"><table class="tab"><thead><tr><th>Eleitos em</th><th>Disputa</th><th class="v">Eleitos</th><th class="v">Tentaram</th><th class="v">(% eleitos)</th><th class="v">Reeleitos</th><th class="v">Taxa</th>${municipal ? `<th class="v">Média municípios</th>` : ""}</tr></thead><tbody>
      ${ciclos.map(c=>`<tr${c.anoEleito===REEL.ciclo ? ' class="reel-atual"' : ""}>
        <td><button class="link" data-ciclo="${c.anoEleito}">${c.anoEleito}</button></td>
        <td>${c.anoDisputa}</td>
        <td class="v">${fmt.format(c.eleitos)}</td>
        <td class="v">${fmt.format(c.tentaram)}</td>
        <td class="v">${c.pctEleitos!=null ? `${c.pctEleitos.toLocaleString("pt-BR")}%` : "–"}</td>
        <td class="v">${fmt.format(c.reeleitos)}</td>
        <td class="v">${c.taxa!=null ? `${c.taxa.toLocaleString("pt-BR")}%` : "–"}</td>
        ${municipal ? `<td class="v">${c.taxaMunicipios!=null ? `${c.taxaMunicipios.toLocaleString("pt-BR")}%` : "–"}</td>` : ""}
      </tr>`).join("")}
      <tr><td><b>Total</b></td><td></td><td class="v"><b>${fmt.format(total.eleitos)}</b></td><td class="v"><b>${fmt.format(total.tentaram)}</b></td><td class="v"><b>${pctElTotal!=null ? `${pctElTotal.toLocaleString("pt-BR")}%` : "–"}</b></td><td class="v"><b>${fmt.format(total.reeleitos)}</b></td><td class="v"><b>${taxaTotal!=null ? `${taxaTotal.toLocaleString("pt-BR",{maximumFractionDigits:1})}%` : "–"}</b></td>${municipal ? "<td></td>" : ""}</tr>
      </tbody></table></div>
      <p class="aviso-mini">Clique no ano para ver quem voltou, perdeu ou não tentou.</p>
    </div>` : `<div class="fin-bloco reel-linha">
      <p class="aviso-mini">Sem ciclos com eleição seguinte na base para ${cargoNome(CARGO_COD[cargo])}${fora.length ? `: os eleitos em ${fora.join(", ")} só disputariam o cargo em um pleito ainda não carregado` : ""}.</p>
    </div>`}
    <div class="fin-bloco">
      <h3>Resumo — ${UF ? GEO[UF].properties.nome : "amostra inteira"} (todas as eleições somadas)</h3>
      <div class="tabw"><table class="tab reel-resumo"><thead><tr><th>Cargo</th><th>Eleitos em</th><th class="v">Eleitos</th><th class="v">Tentaram</th><th class="v">Reeleitos</th><th class="v">Taxa</th><th class="v">Média municípios</th></tr></thead><tbody>
      ${res.linhas.map(l=>`<tr>
        <td>${cargoNome(l.cargo).toLowerCase()}</td>
        <td>${l.de===l.ate ? l.de : `${l.de}–${l.ate}`}</td>
        <td class="v">${fmt.format(l.eleitos)}</td>
        <td class="v">${fmt.format(l.tentaram)}</td>
        <td class="v">${fmt.format(l.reeleitos)}</td>
        <td class="v">${l.taxa!=null ? `${l.taxa.toLocaleString("pt-BR")}%` : "–"}</td>
        <td class="v">${l.municipal && l.taxaMun!=null ? `${l.taxaMun.toLocaleString("pt-BR")}%` : "–"}</td>
      </tr>`).join("")}
      ${municipais ? `<tr class="reel-soma"><td><b>Municipais (prefeito + vereador)</b></td><td>${municipais.de===municipais.ate ? municipais.de : `${municipais.de}–${municipais.ate}`}</td><td class="v"><b>${fmt.format(municipais.eleitos)}</b></td><td class="v"><b>${fmt.format(municipais.tentaram)}</b></td><td class="v"><b>${fmt.format(municipais.reeleitos)}</b></td><td class="v"><b>${municipais.taxa!=null ? `${municipais.taxa.toLocaleString("pt-BR")}%` : "–"}</b></td><td class="v">${municipais.taxaMun!=null ? `${municipais.taxaMun.toLocaleString("pt-BR")}%` : "–"}</td></tr>` : ""}
      </tbody></table></div>
      ${res.foras.length ? `<p class="aviso-mini">Fora do cálculo (eleição seguinte ainda sem dados na base): ${res.foras.join(", ")}.</p>` : ""}
    </div>
    ${UF ? `<div class="fin-bloco">
      <h3>Quem são${REEL.ciclo!=null ? ` (${REEL.ciclo})` : ""}</h3>
      ${REEL.ciclo!=null ? `<div class="cargos">${["voltou","perderam","nao"].map(g=>`<button data-g="${g}" aria-pressed="${REEL.aberto && REEL.grupo===g}" title="Mostrar este grupo; clique de novo para recolher a lista">${REEL_GRUPO_TXT[g]}</button>`).join("")}</div>
      <input id="reel-busca" class="reel-busca" type="search" placeholder="Filtrar por nome ou município" value="${esc(REEL.busca)}" aria-label="Filtrar pessoas por nome ou município">
      <div id="reel-quem"></div>` : `<p class="aviso-mini">Sem ciclo selecionável para este cargo.</p>`}
    </div>` : (ufs.length ? `<div class="fin-bloco reel-linha">
      <h3>Taxa total por UF (${cargoNome(CARGO_COD[cargo]).toLowerCase()})</h3>
      ${ufs.map(u=>`<div class="hb"><span>${u.uf}</span><i class="t" style="width:${(u.taxa/ufMax*100).toFixed(1)}%"></i><span class="v">${u.taxa.toLocaleString("pt-BR")}% <small>(${fmt.format(u.tentaram)} tentaram)</small></span></div>`).join("")}
    </div>` : "")}`;
  el.querySelectorAll("[data-ciclo]").forEach(b => b.onclick = () => {
    REEL.ciclo = +b.dataset.ciclo; REEL.aberto = true; REEL.desde = 0;
    renderReeleicao(); // a lista "quem são" recarrega junto
  });
  if (UF && REEL.ciclo != null){
    el.querySelectorAll("[data-g]").forEach(b => b.onclick = () => {
      const alvo = document.getElementById("reel-quem");
      if (REEL.aberto && REEL.grupo === b.dataset.g){ // de novo no mesmo grupo: colapsa a lista
        REEL.aberto = false;
        el.querySelectorAll("[data-g]").forEach(o => o.setAttribute("aria-pressed", "false"));
        if (alvo) alvo.innerHTML = "";
        return;
      }
      REEL.grupo = b.dataset.g; REEL.aberto = true; REEL.desde = 0;
      el.querySelectorAll("[data-g]").forEach(o => o.setAttribute("aria-pressed", String(o===b)));
      quemReeleicao(false);
    });
    const inp = document.getElementById("reel-busca");
    let tBusca = null;
    inp.addEventListener("input", () => { clearTimeout(tBusca); tBusca = setTimeout(() => {
      REEL.busca = inp.value.trim();
      if (!REEL.aberto){ REEL.aberto = true; el.querySelectorAll("[data-g]").forEach(o => o.setAttribute("aria-pressed", String(o.dataset.g===REEL.grupo))); }
      quemReeleicao(false);
    }, 250); });
    if (REEL.aberto) quemReeleicao(false);
  }
  // confirmação visual de que o conteúdo mudou para o cargo/escolha
  el.classList.remove("surge"); void el.offsetWidth; el.classList.add("surge");
}

// "quem são" no ciclo: voltou / perdeu / não tentou; clique abre a ficha.
// O grupo escolhido de novo colapsa a lista; ela entra de 10 em 10 em "Mostrar mais".
// (pedido suave: o indicador de carga é o "Carregando…" desta lista)
async function quemReeleicao(continuar){
  const alvo = document.getElementById("reel-quem");
  if (!alvo || !UF || REEL.ciclo == null || !REEL.aberto) return;
  const marca = [REEL.cargo, REEL.ciclo, REEL.grupo, REEL.busca].join("|");
  if (!continuar){ REEL.desde = 0; REEL.lista = []; REEL.temMais = false; alvo.innerHTML = `<p class="aviso-mini">Carregando…</p>`; }
  const q = REEL.busca ? `&q=${encodeURIComponent(REEL.busca)}` : "";
  try {
    const d = await request(`/api/reeleicao/pessoas?uf=${encodeURIComponent(UF)}&cargo=${REEL.cargo}&eleitos_em=${REEL.ciclo}&grupo=${REEL.grupo}${q}&limite=10&desde=${REEL.desde}`, {silencioso: true});
    if (!alvo.isConnected || [REEL.cargo, REEL.ciclo, REEL.grupo, REEL.busca].join("|") !== marca) return;
    REEL.lista.push(...d.pessoas); REEL.temMais = d.temMais; REEL.desde = REEL.lista.length;
    if (!REEL.lista.length){ alvo.innerHTML = `<p class="aviso-mini">Ninguém neste grupo.</p>`; return; }
    alvo.innerHTML = `<div class="tabw"><table class="tab"><thead><tr><th>Candidato</th><th>Partido</th><th>Município</th><th class="v">Votos</th></tr></thead><tbody>
      ${REEL.lista.map(p=>`<tr>
        <td><button class="link" data-cand="${p.id_pessoa_projeto}">${esc(titulo(p.nm_urna_candidato))}</button></td>
        <td><span class="chip" style="background:${corP(p.sg_partido)}">${esc(p.sg_partido)}</span></td>
        <td>${esc(titulo(p.nm_municipio || ""))}</td>
        <td class="v num">${fmt.format(p.votos)}</td>
      </tr>`).join("")}</tbody></table>
      ${REEL.temMais ? `<p><button class="link" data-mais="1">Mostrar mais</button></p>` : ""}</div>`;
    alvo.querySelectorAll("[data-cand]").forEach(b => b.onclick = () => abrirCandidato(+b.dataset.cand));
    const mais = alvo.querySelector("[data-mais]");
    if (mais) mais.onclick = () => quemReeleicao(true);
  } catch(e){ console.error(e); if (!continuar) alvo.innerHTML = `<p class="aviso-mini">Não foi possível listar as pessoas: ${esc(e.message)}</p>`; }
}

export default {
  id: "p10", numero: "P10",
  titulo: "Reeleição: quem volta?",
  pergunta: "Sobrevivência da carreira de um político (P10a: reeleição)",
  resumo: "Dos eleitos em cada pleito, quantos tentaram o mesmo cargo na eleição seguinte e quantos venceram.",
  montar(el) {
    el.innerHTML = `<p class="nota">Dos eleitos em cada pleito, quantos voltaram a disputar o mesmo cargo, na mesma unidade, na eleição ordinária seguinte (senador, 8 anos depois) e quantos ganharam. <b>(% eleitos)</b> = dos eleitos, quantos tentaram de novo; <b>taxa</b> = dos que tentaram, quantos venceram; a <b>média municípios</b> só considera municípios em que alguém tentou. A ligação entre pleitos usa o mesmo identificador de pessoa do painel; candidaturas indeferidas contam como tentativa; Presidente (disputa nacional) e suplentes ficam fora; ciclos sem eleição seguinte na base ficam fora da conta (e aparecem listados). Deputado distrital (DF) entra na régua. <span id="reel-origem"></span></p>
<div class="cargos" id="reel-cargos" role="group" aria-label="Cargo da seção de reeleição"></div>
<div class="fin-grid" id="reel-conteudo"></div>`;
    montarReeleicao();
  },
};
