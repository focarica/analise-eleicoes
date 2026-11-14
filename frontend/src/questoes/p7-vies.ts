// @ts-nocheck
// Questão 7: viés político dos partidos (Bolognesi et al., Harvard Dataverse).
// Acrescenta uma régua à ficha de cada candidatura e a linha do município
// (gaveta e card). Edite só este arquivo (e o .css ao lado).
import { esc, request, titulo } from "../util";
import { UF } from "../presentation";
import "./p7-vies.css";

const numero = (v) => (v > 0 ? "+" : "") + v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).replace("-", "−");

function regua(c, e){
  const { esquerda: esq, direita: dir } = e;
  const min = +esq.vies, max = +dir.vies;
  const faixa = max - min || 1;
  const pos = (v) => Math.max(0, Math.min(100, (v - min) / faixa * 100));
  const x = (p) => 78 + p / 100 * 484;
  const zero = pos(0);
  const partido = e.partidos.find(p => +p.nr_partido === +c.nr_partido && p.sg_partido === c.partido)
    || e.partidos.find(p => +p.nr_partido === +c.nr_partido)
    || e.partidos.find(p => p.sg_partido === c.partido);
  const xm = partido ? x(pos(+partido.vies)) : null;
  const ancora = xm == null ? "middle" : xm < 150 ? "start" : xm > 490 ? "end" : "middle";
  const grad = `q7-grad-${e.ano_eleicao}`;
  const onda = e.onda_estendida ? `onda ${e.onda}, estendida por 2 anos` : `onda ${e.onda}`;
  const rotulo = partido
    ? `<g class="q7-marca" transform="translate(${xm},0)">
        <line class="q7-marca-linha" x1="0" y1="36" x2="0" y2="82"/>
        <circle class="q7-marca-pto" cx="0" cy="59" r="7"/>
        <text class="q7-marca-txt" x="0" y="30" text-anchor="${ancora}">${esc(partido.sg_partido)} · ${numero(+partido.vies)}</text>
      </g>`
    : "";
  const nota = partido
    ? ""
    : `<p class="q7-nota">O partido ${esc(c.partido || "sem sigla")} não tem nota no survey desta eleição; a régua mostra só o espectro.</p>`;
  const descricao = `Régua política da eleição de ${e.ano_eleicao}, de ${esq.sg_partido} (${numero(min)}) a ${dir.sg_partido} (${numero(max)})`
    + (partido ? `; o partido ${partido.sg_partido} está em ${numero(+partido.vies)}.` : ".");
  return `<div class="q7">
    <div class="q7-cab"><span class="q7-tit">Viés político do partido</span><span class="q7-onda">${onda}</span></div>
    <svg class="q7-svg" viewBox="0 0 640 96" role="img" aria-label="${esc(descricao)}">
      <defs><linearGradient id="${grad}" x1="0" x2="1">
        <stop class="q7-stop-esq" offset="0"/>
        <stop class="q7-stop-meio" offset="${(zero / 100).toFixed(4)}"/>
        <stop class="q7-stop-dir" offset="1"/>
      </linearGradient></defs>
      <text class="q7-fim" x="70" y="46" text-anchor="end">${esc(esq.sg_partido)}</text>
      <text class="q7-fim-val" x="70" y="62" text-anchor="end">${numero(min)}</text>
      <rect x="78" y="52" width="484" height="14" rx="7" fill="url(#${grad})"/>
      <line class="q7-zero" x1="${x(zero)}" y1="44" x2="${x(zero)}" y2="76"/>
      <text class="q7-zero-txt" x="${x(zero)}" y="92" text-anchor="middle">centro</text>
      <text class="q7-fim" x="570" y="46" text-anchor="start">${esc(dir.sg_partido)}</text>
      <text class="q7-fim-val" x="570" y="62" text-anchor="start">${numero(max)}</text>
      ${rotulo}
    </svg>${nota}
  </div>`;
}

// Linha do viés de um município: cada eleição de 2018 a 2024 na escala fixa
// −100..+100. Usada na gaveta e no card da P7.
let seqLinha = 0;
function linhaVies(rows){
  rows = (rows || []).filter(r => r.vies != null)
    .sort((a, b) => +a.ano_eleicao - +b.ano_eleicao);
  if (!rows.length) return "";
  const W = 900, H = 210, L = 90, R = 80, T = 34, B = 46;
  const x = (i) => L + i * (W - L - R) / Math.max(1, rows.length - 1);
  const y = (v) => T + (1 - (v + 100) / 200) * (H - T - B);
  const pontos = rows.map((r, i) => ({ ...r, x: x(i), y: y(+r.vies) }));
  const caminho = pontos.length > 1
    ? pontos.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ")
    : "";
  const cor = (v) => v < 0 ? "q7m-neg" : v > 0 ? "q7m-pos" : "q7m-neutro";
  const coberturas = rows.map(r => +r.cobertura).filter(Number.isFinite);
  const cargos = rows.map(r => +r.n_cargos);
  const extensao = rows.some(r => r.onda_estendida) ? " Em 2024, a onda de 2022 foi estendida por dois anos." : "";
  const descricao = "Viés político do município: " + pontos.map(p => `${p.ano_eleicao} ${numero(+p.vies)}`).join("; ") + ".";
  const pct = (v) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  const faixaCob = coberturas.length
    ? Math.min(...coberturas) === Math.max(...coberturas)
      ? `${pct(coberturas[0])}%`
      : `${pct(Math.min(...coberturas))}%–${pct(Math.max(...coberturas))}%`
    : "";
  const notaCob = faixaCob ? `Cobertura dos votos válidos: ${faixaCob} · ${Math.min(...cargos)} a ${Math.max(...cargos)} cargos por eleição.` : "";
  const grad = `q7m-grad-${++seqLinha}`;
  return `<div class="mun-chart-wrap q7m">
    <div class="q7m-cab"><span class="q7m-tit">Viés político ao longo do tempo</span><span class="q7m-legenda">−100 esquerda · +100 direita</span></div>
    <svg class="q7m-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(descricao)}">
      <defs><linearGradient id="${grad}" gradientUnits="userSpaceOnUse" x1="${L}" y1="${T}" x2="${L}" y2="${H - B}">
        <stop class="q7-stop-dir" offset="0"/><stop class="q7-stop-meio" offset="0.5"/><stop class="q7-stop-esq" offset="1"/>
      </linearGradient></defs>
      ${[100, 0, -100].map(v => `<line class="q7m-guia${v === 0 ? " q7m-zero" : ""}" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="q7m-eixo" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v)}</text>`).join("")}
      ${caminho ? `<path class="q7m-tracado" style="stroke:url(#${grad})" d="${caminho}"/>` : ""}
      ${pontos.map(p => {
        const dy = p.y - 12 < T + 8 ? 22 : -12;
        return `<g class="q7m-ponto ${cor(+p.vies)}"><circle cx="${p.x}" cy="${p.y}" r="6"><title>${p.ano_eleicao}: viés ${numero(+p.vies)}; cobertura ${(+p.cobertura).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%; ${+p.n_cargos} cargos</title></circle><text class="q7m-valor" x="${p.x}" y="${p.y + dy}" text-anchor="middle">${numero(+p.vies)}</text></g>`;
      }).join("")}
      ${pontos.map(p => `<text class="q7m-ano" x="${p.x}" y="${H - 14}" text-anchor="middle">${p.ano_eleicao}</text>`).join("")}
    </svg>
    <p class="q7m-nota">${notaCob}${extensao}</p>
  </div>`;
}

// Linha na gaveta do município: a resposta traz `viesMunicipio` (api/questoes/p7-vies.ts).
function linhaMunicipio(m){
  return linhaVies(m.bruto?.viesMunicipio);
}

const UF_NOME = { AC:"Acre", AL:"Alagoas", BA:"Bahia", DF:"Distrito Federal", RO:"Rondônia", SP:"São Paulo" };
let pararAnimacao = () => {}, pedidoEstado = 0;

function desenharMapa(el, uf, dados, topo){
  const anos = dados.anos;
  if (!anos.length) throw new Error(`Sem série municipal de viés para ${uf}.`);
  const anosEl = el.querySelector("#q7-anos");
  const play = el.querySelector("#q7-animar");
  const resumo = el.querySelector("#q7-resumo");
  const detalhe = el.querySelector("#q7-municipio-detalhe");
  const svgEl = el.querySelector("#q7-mapa-svg");
  el.querySelector("#q7-mapa-titulo").textContent = `Evolução municipal · ${UF_NOME[uf]}`;
  const objeto = topo.objects.municipios;
  const feicoes = topojson.feature(topo, objeto).features.filter(f => f.properties.tse);
  const porCodigo = new Map(dados.municipios.map(m => [String(m.cd).padStart(5,"0"), m]));
  const W = 900, H = 620;
  const colecao = { type:"FeatureCollection", features:feicoes };
  const proj = d3.geoMercator().fitExtent([[8,8],[W-8,H-8]], colecao);
  const path = d3.geoPath(proj);
  const svg = d3.select(svgEl).attr("viewBox", `0 0 ${W} ${H}`);
  svg.selectAll("*").remove();
  const estilo = getComputedStyle(el.querySelector(".q7-mapa"));
  const cor = d3.scaleLinear().domain([-100,0,100]).range([
    estilo.getPropertyValue("--q7-esquerda").trim(),
    estilo.getPropertyValue("--q7-centro").trim(),
    estilo.getPropertyValue("--q7-direita").trim(),
  ]).clamp(true).interpolate(d3.interpolateRgb);
  const semDado = estilo.getPropertyValue("--vazio").trim();
  const contornos = svg.append("g").selectAll("path").data(feicoes).join("path")
    .attr("class", "q7-mun")
    .attr("d", path)
    .attr("tabindex", 0)
    .attr("role", "button")
    .on("click", (_, f) => selecionar(f))
    .on("keydown", (event, f) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selecionar(f); }
    });
  svg.append("path").datum(topojson.mesh(topo, objeto, (a,b) => a !== b))
    .attr("class", "q7-divisas").attr("d", path).attr("aria-hidden", "true");

  const linhaDoAno = (m, ano) => m?.serie.find(r => +r.ano_eleicao === +ano);
  let anoIndex = 0, timer = null;
  let selecionado = null;

  function descrever(f, ano){
    const cd = String(f.properties.tse).padStart(5,"0");
    const m = porCodigo.get(cd), r = linhaDoAno(m, ano);
    return `${m?.nome || f.properties.nome || "Município"} · ${ano}: ${r?.vies == null ? "sem dado" : numero(+r.vies)}`;
  }
  function selecionar(f){
    const cd = String(f.properties.tse).padStart(5,"0");
    selecionado = cd;
    contornos.classed("selecionado", d => String(d.properties.tse).padStart(5,"0") === cd)
      .attr("aria-pressed", d => String(d.properties.tse).padStart(5,"0") === cd ? "true" : "false");
    const m = porCodigo.get(cd);
    if (!m) {
      detalhe.innerHTML = `<p class="q7m-vazio">${esc(f.properties.nome || "Município")}: sem observações de viés nesta base.</p>`;
      return;
    }
    detalhe.innerHTML = `<p class="q7m-nome">${esc(titulo(m.nome))} · ${esc(uf)}</p>${linhaVies(m.serie) || `<p class="q7m-vazio">Sem valores de viés para este município.</p>`}`;
  }
  function atualizarAno(index, animar = true){
    anoIndex = Math.max(0, Math.min(anos.length - 1, index));
    const ano = anos[anoIndex];
    anosEl.querySelectorAll("[data-q7-year]").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.q7Year === +ano)));
    const linhas = feicoes.map(f => {
      const cd = String(f.properties.tse).padStart(5,"0");
      return linhaDoAno(porCodigo.get(cd), ano);
    });
    const validos = linhas.filter(r => r?.vies != null);
    const esquerda = validos.filter(r => +r.vies < 0).length;
    const direita = validos.filter(r => +r.vies > 0).length;
    const centro = validos.length - esquerda - direita;
    resumo.innerHTML = `<span><b>${validos.length}</b> de ${feicoes.length} municípios com dado</span><span><b>${esquerda}</b> à esquerda</span><span><b>${centro}</b> no centro</span><span><b>${direita}</b> à direita</span>`;
    contornos.interrupt().transition().duration(animar && !matchMedia("(prefers-reduced-motion: reduce)").matches ? 1450 : 0).ease(d3.easeCubicInOut)
      .attr("fill", f => {
        const cd = String(f.properties.tse).padStart(5,"0");
        const r = linhaDoAno(porCodigo.get(cd), ano);
        return r?.vies == null ? semDado : cor(+r.vies);
      });
    contornos.attr("aria-label", f => descrever(f, ano));
    contornos.select("title").text(f => descrever(f, ano));
    if (selecionado) contornos.classed("selecionado", f => String(f.properties.tse).padStart(5,"0") === selecionado);
  }
  contornos.append("title").text(f => descrever(f, anos[anoIndex]));
  anosEl.innerHTML = anos.map(ano => `<button type="button" data-q7-year="${ano}" aria-pressed="false">${ano}</button>`).join("");
  anosEl.querySelectorAll("[data-q7-year]").forEach(b => b.addEventListener("click", () => {
    pararAnimacao();
    atualizarAno(anos.indexOf(+b.dataset.q7Year));
  }));
  atualizarAno(anoIndex, false);
  function parar(){
    if (timer) clearInterval(timer);
    timer = null;
    play.textContent = "Animar evolução";
    play.setAttribute("aria-pressed", "false");
    if (pararAnimacao === parar) pararAnimacao = () => {};
  }
  function iniciar(){
    if (timer) return;
    if (anoIndex === anos.length - 1) atualizarAno(0, false);
    play.textContent = "Pausar animação";
    play.setAttribute("aria-pressed", "true");
    timer = setInterval(() => {
      if (!el.isConnected || el.closest(".q-painel")?.hidden || document.hidden || anoIndex >= anos.length - 1) {
        parar(); return;
      }
      atualizarAno(anoIndex + 1);
      if (anoIndex >= anos.length - 1) parar();
    }, 1800);
  }
  pararAnimacao = parar;
  play.onclick = () => play.getAttribute("aria-pressed") === "true" ? parar() : iniciar();
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) iniciar();
}

async function carregarEstado(el, uf){
  pararAnimacao();
  const pedido = ++pedidoEstado;
  el.querySelector("#q7-mapa-area").innerHTML = `<p class="q7m-vazio">Carregando mapa e série histórica de ${esc(UF_NOME[uf])}…</p>`;
  el.querySelector("#q7-resumo").innerHTML = "";
  el.querySelector("#q7-municipio-detalhe").innerHTML = `<p class="q7m-vazio">Selecione um município no mapa para ver a evolução.</p>`;
  try {
    const [dados, respostaGeo] = await Promise.all([
      request(`/api/q7-vies/estado?uf=${encodeURIComponent(uf)}`, { silencioso: true }),
      fetch(`${import.meta.env.BASE_URL}geo/municipios-${uf}.json`),
    ]);
    if (!respostaGeo.ok) throw new Error(`Malha municipal de ${uf} indisponível.`);
    const topo = await respostaGeo.json();
    if (!el.isConnected || pedido !== pedidoEstado) return;
    el.querySelector("#q7-mapa-area").innerHTML = `<svg id="q7-mapa-svg" class="q7-mapa-svg" role="group" aria-label="Municípios de ${esc(UF_NOME[uf])}"></svg>`;
    desenharMapa(el, uf, dados, topo);
  } catch (e) {
    if (el.isConnected && pedido === pedidoEstado) el.querySelector("#q7-mapa-area").innerHTML = `<p class="q7m-vazio">Não foi possível carregar o mapa: ${esc(e.message)}</p>`;
  }
}

export default {
  id: "p7", numero: "P7",
  titulo: "Viés político de um município/região na linha do tempo",
  pergunta: "Qual é o viés político de um município ou região ao longo do tempo?",
  resumo: "Uma régua de −100 (esquerda) a +100 (direita) mostra onde está o partido de cada candidatura e como o viés do município evolui.",
  onde: "Na ficha do candidato, na gaveta do município e neste card",
  montar(el) {
    pararAnimacao();
    const inicial = UF || "";
    el.innerHTML = `<div class="q7-explorer">
        <div class="q7-mapa">
          <div class="q7-mapa-cab"><div><span class="q7m-tit" id="q7-mapa-titulo">Evolução municipal</span><span class="q7m-legenda">Cores mostram o índice de −100 a +100</span></div><button type="button" id="q7-animar" aria-pressed="false">Animar evolução</button></div>
          <div class="q7-ano-controle"><span>Ano</span><div id="q7-anos" class="q7-anos" role="group" aria-label="Ano do mapa"></div></div>
          <div id="q7-resumo" class="q7-resumo" aria-live="polite"></div>
          <div class="q7-mapa-legenda"><span>−100 · Esquerda</span><i aria-hidden="true"></i><span>Direita · +100</span><span class="q7-sem-dado"><i aria-hidden="true"></i>Sem dado</span></div>
          <div id="q7-mapa-area" class="q7-mapa-area"><p class="q7m-vazio">Selecione um estado nos filtros acima para explorar os municípios no mapa.</p></div>
          <p class="q7m-nota">Cada município usa a mesma escala em todas as eleições. A animação percorre somente os anos com dados para o estado.</p>
        </div>
        <div id="q7-municipio-detalhe" class="q7-municipio-detalhe"><p class="q7m-vazio">Clique em um município no mapa para ver a linha do tempo dele.</p></div>
      </div>
      <details class="q7-metodologia"><summary>Como interpretar e de onde vêm os valores</summary>
        <p class="nota">A posição de cada partido vem das notas de especialistas do estudo de Bolognesi et al. (Harvard Dataverse): a média de 0 a 10 vira <b>(média − 5) × 20</b>, de −100 (esquerda) a +100 (direita). Cada eleição usa a onda mais recente do survey: 2018 e 2020 usam a onda de 2018; 2022 e 2024, a de 2022 — <b>2024 é a onda de 2022 estendida por dois anos</b>. Antes de 2018 não há valor.</p>
        <p class="nota">Na ficha do candidato, cada candidatura ganha uma régua que vai do partido mais à esquerda ao mais à direita daquela eleição, com o partido do candidato marcado. Partido sem nota no survey não recebe marcador; o valor nunca é tratado como zero.</p>
        <p class="nota">Na gaveta do município, a linha do tempo mostra o viés agregado de cada eleição: dentro de cada cargo, a média dos partidos é ponderada pelos votos válidos (nominais e de legenda, 1º turno); depois, os cargos entram com peso igual.</p>
      </details>
      <p><button type="button" class="link" id="p7-busca">Ir para a busca de candidatos</button></p>`;
    if (inicial) void carregarEstado(el, inicial);
    el.querySelector("#p7-busca").onclick = () => {
      window.addEventListener("hashchange", () => setTimeout(() => {
        const busca = document.getElementById("busca");
        busca.scrollIntoView({ block: "center" });
        if (!busca.disabled) busca.focus();
      }, 0), { once: true });
      document.getElementById("qp-fechar")?.click();
    };
  },
  fichaCandidatura(c, h) {
    const e = (h.bruto?.viesEleicoes || []).find(x => +x.ano_eleicao === +c.ano_eleicao);
    return e ? regua(c, e) : "";
  },
  linhaMunicipio,
};
