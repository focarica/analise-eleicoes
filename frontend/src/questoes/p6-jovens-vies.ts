// @ts-nocheck
// P6 — jovens (18–29 anos) × não jovens × viés político: o eleitorado do
// município (ou da UF, nas eleições gerais) comparado com a idade e o viés dos
// candidatos e eleitos, 2018–2024. Edite só este arquivo (e o .css ao lado).
//
// A tela é dividida em perguntas curtas. Cada bloco abre com uma frase que já
// responde a pergunta (gerada a partir dos números) e um gráfico simples;
// metodologia e tabelas completas ficam recolhidas em <details>.
import { fmt, titulo, esc, request, CARGO_COD } from "../util";
import { UF, GEO } from "../presentation";
import "./p6-jovens-vies.css";

const ANOS = [2018, 2020, 2022, 2024];
const MUNICIPAL = new Set([2020, 2024]);
const CARGOS_TIPO = { municipal: [11, 13], geral: [3, 5, 6, 7, 8] };
const CAMPOS = [
  "cand_total", "cand_com_idade", "cand_jovens", "soma_idade_cand",
  "eleitos_total", "eleitos_com_idade", "eleitos_jovens", "soma_idade_eleitos",
  "vies_soma_jovens", "vies_n_jovens", "vies_soma_nao_jovens", "vies_n_nao_jovens",
  "esq_jovens", "dir_jovens", "esq_nao_jovens", "dir_nao_jovens",
  "vies_soma_eleitos_jovens", "vies_n_eleitos_jovens",
  "vies_soma_eleitos_nao_jovens", "vies_n_eleitos_nao_jovens",
];

let pedido = 0, seqGrad = 0;
let anoSel = 2024, cargoSel = "";   // preservados entre trocas de estado

const div = (a, b) => b > 0 ? a / b : null;
const pct = v => v == null ? "–" : `${(100 * v).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
// porcentagem curta: uma casa decimal abaixo de 10% (onde o arredondamento esconderia a diferença)
const pctInt = v => v == null ? "–" : `${(100 * v).toLocaleString("pt-BR", { maximumFractionDigits: 100 * v < 10 ? 1 : 0 })}%`;
// "7.060 de 118.892 candidatos" para o texto de passar o mouse
function contagem(s, k) {
  const [a, b, nome] = k === "pEleitorado" ? [s.eleitores_18_29, s.eleitores_18_mais, "eleitores"]
    : k === "pCand" ? [s.cand_jovens, s.cand_com_idade, "candidatos"] : [s.eleitos_jovens, s.eleitos_com_idade, "eleitos"];
  return `${fmt.format(a || 0)} de ${fmt.format(b || 0)} ${nome}`;
}
const de100 = v => v == null ? "–" : Math.round(100 * v).toLocaleString("pt-BR");
const vies = v => v == null ? "–" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 });
const ladoVies = v => v == null ? "" : v < 0 ? "q6-esq" : v > 0 ? "q6-dir" : "";

// Soma linhas da API (já são somas e contagens) e deriva as razões.
function somar(linhas) {
  const s = Object.fromEntries(CAMPOS.map(c => [c, 0]));
  for (const r of linhas) for (const c of CAMPOS) s[c] += Number(r[c] || 0);
  return s;
}
function indicadores(s, e29 = null, e18 = null) {
  return {
    ...s,
    eleitores_18_29: e29, eleitores_18_mais: e18,
    pEleitorado: div(e29, e18),
    pCand: div(s.cand_jovens, s.cand_com_idade),
    pEleitos: div(s.eleitos_jovens, s.eleitos_com_idade),
    txJovens: div(s.eleitos_jovens, s.cand_jovens),
    txNaoJovens: div(s.eleitos_com_idade - s.eleitos_jovens, s.cand_com_idade - s.cand_jovens),
    viesJ: div(s.vies_soma_jovens, s.vies_n_jovens),
    viesNJ: div(s.vies_soma_nao_jovens, s.vies_n_nao_jovens),
    viesEJ: div(s.vies_soma_eleitos_jovens, s.vies_n_eleitos_jovens),
    viesENJ: div(s.vies_soma_eleitos_nao_jovens, s.vies_n_eleitos_nao_jovens),
    esqJ: div(s.esq_jovens, s.vies_n_jovens),
    esqNJ: div(s.esq_nao_jovens, s.vies_n_nao_jovens),
  };
}

// ---------- 1. "De cada 100": três grades de 100 quadradinhos ----------
function grade(rotulo, v, detalhe) {
  const n = v == null ? 0 : Math.round(100 * v);
  const celulas = Array.from({ length: 100 }, (_, i) => `<i${i < n ? ' class="on"' : ""}></i>`).join("");
  return `<figure class="q6-waffle" title="${esc(rotulo)}: ${pct(v)} jovens">
    <figcaption><span>${esc(rotulo)}</span><b>${de100(v)}</b><small>de cada 100 são jovens</small></figcaption>
    <div class="q6-waffle-grade" role="img" aria-label="${esc(rotulo)}: ${pct(v)} são jovens">${celulas}</div>
    <small class="q6-waffle-det">${detalhe}</small>
  </figure>`;
}

// ---------- 2. Régua de viés: jovens em cima, não jovens embaixo ----------
function regua(rotulo, vj, vnj) {
  if (vj == null && vnj == null) return "";
  const W = 640, L = 16, R = 16, x = v => L + (v + 100) / 200 * (W - L - R);
  const grad = `q6-grad-${++seqGrad}`;
  const marca = (v, nome, cls, cima) => v == null ? "" : `<g class="q6-marca ${cls}">
      <title>${nome}: viés médio ${vies(v)}</title>
      <line x1="${x(v)}" x2="${x(v)}" y1="${cima ? 26 : 56}" y2="${cima ? 40 : 70}"/>
      <circle cx="${x(v)}" cy="48" r="8"/>
      <text x="${x(v)}" y="${cima ? 18 : 88}" text-anchor="${x(v) < 90 ? "start" : x(v) > W - 90 ? "end" : "middle"}">${nome} ${vies(v)}</text>
    </g>`;
  return `<div class="q6-regua"><span class="q6-regua-rot">${esc(rotulo)}</span>
    <svg viewBox="0 0 ${W} 112" role="img" aria-label="${esc(rotulo)}: jovens ${vies(vj)}, não jovens ${vies(vnj)}, numa escala de −100 (esquerda) a +100 (direita)">
      <defs><linearGradient id="${grad}" x1="0" x2="1">
        <stop class="q6-stop-esq" offset="0"/><stop class="q6-stop-meio" offset=".5"/><stop class="q6-stop-dir" offset="1"/>
      </linearGradient></defs>
      <rect x="${L}" y="42" width="${W - L - R}" height="12" rx="6" fill="url(#${grad})"/>
      <line class="q6-regua-centro" x1="${x(0)}" x2="${x(0)}" y1="36" y2="60"/>
      <text class="q6-regua-eixo" x="${L}" y="106">◀ esquerda</text>
      <text class="q6-regua-eixo" x="${x(0)}" y="106" text-anchor="middle">centro</text>
      <text class="q6-regua-eixo" x="${W - R}" y="106" text-anchor="end">direita ▶</text>
      ${marca(vnj, "Não jovens", "q6-nj", false)}${marca(vj, "Jovens", "q6-j", true)}
    </svg></div>`;
}

// ---------- 3. Barras verticais simples (uma série) ----------
function colunas(itens) {
  const max = Math.max(0.01, ...itens.map(i => i.v ?? 0));
  return `<div class="q6-colunas">${itens.map(i => `
    <div class="q6-col" title="${esc(i.dica)}">
      <b>${pct(i.v)}</b>
      <div class="q6-col-trilho"><i style="height:${100 * (i.v ?? 0) / max}%"></i></div>
      <span>${i.rotulo}</span>
    </div>`).join("")}</div>`;
}

// ---------- 3b. Barras horizontais pareadas (por estado, eleições gerais) ----------
function pares(itens) {
  const max = Math.max(0.01, ...itens.flatMap(i => [i.a ?? 0, i.b ?? 0]));
  return `<div class="q6-legenda"><span><i class="q6-sw-eleitorado"></i>Eleitores jovens</span><span><i class="q6-sw-cand"></i>Candidatos jovens</span></div>
    <div class="q6-pares">${itens.map(i => `
      <div class="q6-par"><span class="q6-par-nome">${esc(i.nome)}</span>
        <div class="q6-par-barras">
          <div title="Eleitores jovens: ${pct(i.a)}"><i class="q6-sw-eleitorado" style="width:${100 * (i.a ?? 0) / max}%"></i><b>${pct(i.a)}</b></div>
          <div title="Candidatos jovens: ${pct(i.b)}"><i class="q6-sw-cand" style="width:${100 * (i.b ?? 0) / max}%"></i><b>${pct(i.b)}</b></div>
        </div></div>`).join("")}</div>`;
}

// ---------- 4. Duas eleições do mesmo tipo lado a lado (barras pareadas) ----------
function comparaTipo(titulo, a, b) {
  const grupos = [["Eleitores", "pEleitorado"], ["Candidatos", "pCand"], ["Eleitos", "pEleitos"]];
  const max = Math.max(0.05, ...grupos.flatMap(([, k]) => [a[k] ?? 0, b[k] ?? 0]));
  const W = 360, H = 220, L = 8, R = 8, T = 26, B = 34, gw = (W - L - R) / grupos.length, bw = 32, vao = 12;
  const y = v => T + (1 - v / max) * (H - T - B);
  const barra = (s, k, cx, cls) => s[k] == null ? "" : `<g class="${cls}">
      <title>${s.ano}: ${pct(s[k])} dos ${grupos.find(g => g[1] === k)[0].toLowerCase()} eram jovens (${contagem(s, k)})</title>
      <path d="M${cx - bw / 2} ${H - B} V${y(s[k]) + 4} q0 -4 4 -4 h${bw - 8} q4 0 4 4 V${H - B} Z"/>
      <text x="${cx}" y="${y(s[k]) - 6}" text-anchor="middle">${pctInt(s[k])}</text></g>`;
  return `<figure class="q6-cmp"><figcaption>${titulo}</figcaption>
    <div class="q6-legenda"><span><i class="q6-sw-antes"></i>${a.ano}</span><span><i class="q6-sw-depois"></i>${b.ano}</span></div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${titulo}, porcentagem de jovens: ${grupos.map(([n, k]) => `${n} ${pctInt(a[k])} em ${a.ano} e ${pctInt(b[k])} em ${b.ano}`).join("; ")}">
      <line class="q6-base" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>
      ${grupos.map(([nome, k], i) => {
        const cx = L + gw * i + gw / 2;
        return `${barra(a, k, cx - bw / 2 - vao / 2, "q6-antes")}${barra(b, k, cx + bw / 2 + vao / 2, "q6-depois")}
          <text class="q6-cmp-rot" x="${cx}" y="${H - B + 20}" text-anchor="middle">${nome}</text>`;
      }).join("")}
    </svg>
    <p class="q6-cmp-frase">${fraseMudanca(a, b)}</p>
  </figure>`;
}
function fraseMudanca(a, b) {
  const parte = (nome, k) => {
    if (a[k] == null || b[k] == null) return null;
    const d = 100 * (b[k] - a[k]);   // pontos percentuais
    const verbo = Math.abs(d) < 0.3 ? "ficou praticamente igual" : d > 0 ? "subiu" : "caiu";
    return `entre os ${nome}, <b>${verbo}</b> (de ${pctInt(a[k])} para ${pctInt(b[k])})`;
  };
  const partes = [parte("candidatos", "pCand"), parte("eleitos", "pEleitos")].filter(Boolean);
  if (!partes.length) return "Sem dados suficientes para comparar.";
  return `De ${a.ano} para ${b.ano}, a porcentagem de jovens ${partes.join("; ")}.`;
}

// Frases-resposta, geradas pelos números.
function fraseVies(vj, vnj, quem) {
  if (vj == null || vnj == null) return `Não há ${quem} jovens com partido avaliado neste recorte.`;
  const d = vj - vnj;
  if (Math.abs(d) < 3) return `${quem[0].toUpperCase() + quem.slice(1)} jovens e não jovens estão em partidos com <b>viés parecido</b>.`;
  return `${quem[0].toUpperCase() + quem.slice(1)} jovens estão em partidos <b class="${d < 0 ? "q6-esq" : "q6-dir"}">mais à ${d < 0 ? "esquerda" : "direita"}</b> que os não jovens (${vies(vj)} contra ${vies(vnj)}).`;
}

export default {
  id: "p6", numero: "P6",
  titulo: "Jovens, não jovens e viés político",
  pergunta: "Jovens × não jovens × viés político (população do município × idade do candidato)",
  resumo: "Há poucos jovens (18 a 29 anos) entre candidatos e eleitos? E eles concorrem por partidos mais à esquerda ou à direita? 2018–2024.",
  async montar(el) {
    const nomeUf = UF ? GEO[UF]?.properties?.nome : null;
    el.innerHTML = `<p class="q6-intro">Jovem aqui é quem tem <b>de 18 a 29 anos</b>. Compare quantos jovens há entre os eleitores, os candidatos e os eleitos${nomeUf ? ` em ${esc(nomeUf)}` : " nos seis estados"}, e por quais partidos eles concorrem.</p>
      <div class="q6-controles">
        <div class="q6-chips" id="q6-anos" role="group" aria-label="Eleição">${ANOS.map(a => `<button type="button" data-ano="${a}" aria-pressed="${a === anoSel}">${a}<small>${MUNICIPAL.has(a) ? "municipal" : "geral"}</small></button>`).join("")}</div>
        <div class="q6-chips q6-chips-cargo" id="q6-cargos" role="group" aria-label="Cargo"></div>
      </div>
      <div id="q6-conteudo"><p class="aviso-mini">Carregando…</p></div>`;
    const chipsAno = el.querySelector("#q6-anos"), chips = el.querySelector("#q6-cargos"), conteudo = el.querySelector("#q6-conteudo");
    let resp = null;

    const desenharChips = () => {
      const tipo = MUNICIPAL.has(anoSel) ? "municipal" : "geral";
      const disponiveis = CARGOS_TIPO[tipo].filter(c => resp?.unidades?.some(u => +u.cd_cargo === c));
      if (cargoSel && !disponiveis.includes(+cargoSel)) cargoSel = "";
      chips.innerHTML = [["", "Todos os cargos"], ...disponiveis.map(c => [String(c), CARGO_COD[c]])]
        .map(([v, n]) => `<button type="button" data-cargo="${v}" aria-pressed="${String(cargoSel) === v}">${esc(n)}</button>`).join("");
      chips.querySelectorAll("button").forEach(b => b.onclick = () => { cargoSel = b.dataset.cargo; desenharChips(); desenhar(); });
    };
    const selecionarAno = (a) => {
      anoSel = a;
      chipsAno.querySelectorAll("button").forEach(o => o.setAttribute("aria-pressed", String(+o.dataset.ano === a)));
      carregar();
    };
    chipsAno.querySelectorAll("button").forEach(b => b.onclick = () => selecionarAno(+b.dataset.ano));

    const carregar = async () => {
      const chave = ++pedido;
      conteudo.classList.add("q6-carregando");
      if (!resp) conteudo.innerHTML = `<p class="aviso-mini">Carregando…</p>`;
      const q = new URLSearchParams({ ano: String(anoSel) }); if (UF) q.set("uf", UF);
      try {
        const r = await request(`/api/q6-jovens-vies?${q}`, { silencioso: true });
        if (chave !== pedido || !conteudo.isConnected) return;
        resp = r; desenharChips(); desenhar();
      } catch (e) {
        if (chave === pedido && conteudo.isConnected) conteudo.innerHTML = `<p class="aviso-mini">Não foi possível carregar: ${esc(e.message)}</p>`;
      } finally {
        if (chave === pedido) conteudo.classList.remove("q6-carregando");
      }
    };

    const desenhar = () => {
      const municipal = MUNICIPAL.has(anoSel);
      const doCargo = r => !cargoSel || +r.cd_cargo === +cargoSel;
      const linhasAno = (resp.unidades || []).filter(doCargo);
      if (!linhasAno.length) { conteudo.innerHTML = `<p class="aviso-mini">Sem candidaturas para ${anoSel} neste recorte.</p>`; return; }

      // Por unidade (município ou UF); o eleitorado é o mesmo em todos os cargos da unidade.
      const unidades = d3.groups(linhasAno, r => r.cd_municipio_tse || r.sg_uf).map(([, rs]) => ({
        nome: municipal ? titulo(rs[0].nm_municipio) : (GEO[rs[0].sg_uf]?.properties?.nome || rs[0].sg_uf), uf: rs[0].sg_uf,
        ...indicadores(somar(rs), Number(rs[0].eleitores_18_29) || null, Number(rs[0].eleitores_18_mais) || null),
      }));
      const e29 = d3.sum(unidades, u => u.eleitores_18_29 || 0), e18 = d3.sum(unidades, u => u.eleitores_18_mais || 0);
      const t = indicadores(somar(linhasAno), e29, e18);
      const cargoTxt = cargoSel ? CARGO_COD[cargoSel].toLowerCase() : null;
      const quemCand = cargoTxt ? `candidatos a ${cargoTxt}` : "candidatos";

      // ---- 1. De cada 100
      const razao = t.pEleitorado && t.pEleitos != null ? t.pEleitorado / Math.max(t.pEleitos, 0.001) : null;
      const bloco1 = `<section class="q6-bloco">
        <h3><span class="q6-num">1</span>Os jovens chegam às urnas como candidatos?</h3>
        <p class="q6-frase">De cada 100 eleitores, <b>${de100(t.pEleitorado)}</b> são jovens. Entre os ${quemCand}, só <b>${de100(t.pCand)}</b>; entre os eleitos, <b>${de100(t.pEleitos)}</b>.${razao && razao > 1.5 ? ` Os jovens têm <b>${razao.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} vezes</b> mais peso no eleitorado do que entre os eleitos.` : ""}</p>
        <div class="q6-waffles">
          ${grade("Eleitores", t.pEleitorado, `${fmt.format(e29)} de ${fmt.format(e18)} eleitores`)}
          ${grade("Candidatos", t.pCand, `${fmt.format(t.cand_jovens)} de ${fmt.format(t.cand_com_idade)} candidatos`)}
          ${grade("Eleitos", t.pEleitos, `${fmt.format(t.eleitos_jovens)} de ${fmt.format(t.eleitos_com_idade)} eleitos`)}
        </div>
        ${t.txJovens != null && t.txNaoJovens != null ? `<p class="q6-sub">Quando concorrem, <b>${pct(t.txJovens)}</b> dos jovens se elegem, contra <b>${pct(t.txNaoJovens)}</b> dos não jovens.</p>` : ""}
      </section>`;

      // ---- 2. Viés
      const bloco2 = `<section class="q6-bloco">
        <h3><span class="q6-num">2</span>Jovens concorrem por partidos mais à esquerda ou à direita?</h3>
        <p class="q6-frase">${fraseVies(t.viesJ, t.viesNJ, "candidatos")}</p>
        ${regua("Candidatos", t.viesJ, t.viesNJ)}
        ${regua("Eleitos", t.viesEJ, t.viesENJ)}
        ${t.esqJ != null && t.esqNJ != null ? `<p class="q6-sub"><b>${pct(t.esqJ)}</b> dos candidatos jovens estão em partidos de <span class="q6-esq">esquerda</span>, contra <b>${pct(t.esqNJ)}</b> dos não jovens.</p>` : ""}
        <p class="q6-mini">Cada partido tem uma nota de −100 (esquerda) a +100 (direita), dada por especialistas (a mesma da P7). O ponto é a média dos partidos dos candidatos de cada grupo.</p>
      </section>`;

      // ---- 3. Onde há mais eleitores jovens
      let bloco3;
      if (municipal) {
        const ord = unidades.filter(u => u.pEleitorado != null).sort((a, b) => a.pEleitorado - b.pEleitorado);
        const gs = Array.from({ length: 4 }, () => []);
        ord.forEach((u, i) => gs[Math.min(3, Math.floor(i * 4 / Math.max(1, ord.length)))].push(u));
        const g = gs.map(g => ({ ...indicadores(somar(g), d3.sum(g, u => u.eleitores_18_29), d3.sum(g, u => u.eleitores_18_mais)), n: g.length, min: g[0]?.pEleitorado, max: g[g.length - 1]?.pEleitorado }));
        const nomes = ["Eleitorado mais velho", "", "", "Eleitorado mais jovem"];
        const d = (g[3].pCand ?? 0) - (g[0].pCand ?? 0);
        const frase = Math.abs(d) < 0.005
          ? `Não muda muito: a proporção de candidatos jovens é parecida em municípios de eleitorado mais jovem e mais velho.`
          : d > 0
            ? `<b>Sim.</b> Nos municípios de eleitorado mais jovem, <b>${pct(g[3].pCand)}</b> dos candidatos são jovens; nos de eleitorado mais velho, <b>${pct(g[0].pCand)}</b>.`
            : `<b>Não.</b> Nos municípios de eleitorado mais jovem, ${pct(g[3].pCand)} dos candidatos são jovens, menos que nos de eleitorado mais velho (${pct(g[0].pCand)}).`;
        bloco3 = `<section class="q6-bloco">
          <h3><span class="q6-num">3</span>Onde há mais eleitores jovens, há mais candidatos jovens?</h3>
          <p class="q6-frase">${frase}</p>
          <p class="q6-mini">Os ${fmt.format(ord.length)} municípios foram divididos em quatro grupos do mesmo tamanho, do eleitorado mais velho ao mais jovem. Cada barra é a % de candidatos jovens no grupo.</p>
          ${colunas(g.map((x, i) => ({ v: x.pCand, rotulo: `<em>${nomes[i] || "&nbsp;"}</em>${pct(x.min)}–${pct(x.max)}<br>de eleitores jovens`, dica: `${x.n} municípios · eleitores jovens ${pct(x.min)} a ${pct(x.max)} · candidatos jovens ${pct(x.pCand)} · eleitos jovens ${pct(x.pEleitos)}` })))}
        </section>`;
      } else {
        const ufs = unidades.slice().sort((a, b) => (b.pEleitorado ?? 0) - (a.pEleitorado ?? 0));
        bloco3 = `<section class="q6-bloco">
          <h3><span class="q6-num">3</span>Estados com mais eleitores jovens têm mais candidatos jovens?</h3>
          <p class="q6-frase">Nas eleições gerais os candidatos disputam o estado inteiro, então a comparação é por estado. Em todos eles, a porcentagem de jovens entre os candidatos fica bem abaixo da porcentagem entre os eleitores.</p>
          ${pares(ufs.map(u => ({ nome: u.nome, a: u.pEleitorado, b: u.pCand })))}
        </section>`;
        if (ufs.some(u => (u.pCand ?? 0) >= (u.pEleitorado ?? 1))) bloco3 = bloco3.replace("Em todos eles, a porcentagem de jovens entre os candidatos fica bem abaixo da porcentagem entre os eleitores.", "Compare as duas barras de cada estado.");
      }

      // ---- 4. Série
      const serie = ANOS.map(a => {
        const rs = (resp.serie || []).filter(r => +r.ano_eleicao === a && (!cargoSel || (MUNICIPAL.has(a) !== CARGOS_TIPO.municipal.includes(+cargoSel)) || +r.cd_cargo === +cargoSel));
        const e = (resp.eleitorado || []).find(r => +r.ano_eleicao === a);
        return { ano: a, ...indicadores(somar(rs), Number(e?.eleitores_18_29) || null, Number(e?.eleitores_18_mais) || null) };
      });
      const doAno = a => serie.find(s => s.ano === a);
      const tipoCargo = cargoSel ? (CARGOS_TIPO.municipal.includes(+cargoSel) ? "municipal" : "geral") : null;
      const sufixo = tipo => tipoCargo === tipo ? ` · ${CARGO_COD[cargoSel].toLowerCase()}` : "";
      const bloco4 = `<section class="q6-bloco">
        <h3><span class="q6-num">4</span>Isso mudou de uma eleição para a outra?</h3>
        <p class="q6-frase">Cada barra é a <b>porcentagem de jovens</b> (18 a 29 anos) no grupo. Ex.: 23% nos eleitores = de cada 100 eleitores, 23 eram jovens. Só comparamos eleições do mesmo tipo, que têm os mesmos cargos.</p>
        <div class="q6-cmps">
          ${comparaTipo(`Municipais${sufixo("municipal")}`, doAno(2020), doAno(2024))}
          ${comparaTipo(`Gerais${sufixo("geral")}`, doAno(2018), doAno(2022))}
        </div>
        <p class="q6-mini">Municipais: prefeito e vereador. Gerais: governador, senador e deputados.${cargoSel ? ` O cargo escolhido vale só para as eleições ${tipoCargo === "municipal" ? "municipais" : "gerais"}; as ${tipoCargo === "municipal" ? "gerais" : "municipais"} mostram todos os cargos.` : ""}</p>
      </section>`;

      // ---- Detalhes recolhidos
      const tabela = unidades.slice().sort((a, b) => (b.pEleitorado ?? -1) - (a.pEleitorado ?? -1));
      const detalhes = `<details class="q6-det"><summary>Ver números por ${municipal ? "município" : "estado"} (${fmt.format(tabela.length)})</summary>
          <div class="q6-tabela"><table><thead><tr><th>${municipal ? "Município" : "Estado"}</th><th>Eleitores jovens</th><th>Candidatos jovens</th><th>Eleitos jovens</th><th>Viés jovens</th><th>Viés não jovens</th></tr></thead><tbody>
          ${tabela.map(u => `<tr><td>${esc(u.nome)}${municipal && !UF ? ` · ${esc(u.uf)}` : ""}</td><td>${pct(u.pEleitorado)}</td><td>${pct(u.pCand)} <small>${fmt.format(u.cand_jovens)} de ${fmt.format(u.cand_com_idade)}</small></td><td>${pct(u.pEleitos)} <small>${fmt.format(u.eleitos_jovens)} de ${fmt.format(u.eleitos_com_idade)}</small></td><td class="${ladoVies(u.viesJ)}">${vies(u.viesJ)}</td><td class="${ladoVies(u.viesNJ)}">${vies(u.viesNJ)}</td></tr>`).join("")}
          </tbody></table></div>
          <p class="q6-mini">Em municípios pequenos, um ou dois candidatos jovens já mudam muito a porcentagem e o viés.</p>
        </details>
        <details class="q6-det"><summary>Como calculamos</summary>
          <ul class="q6-metodo">
            <li><b>Jovem</b> = 18 a 29 anos (Estatuto da Juventude, a partir da idade mínima para se candidatar). A idade do candidato é calculada pela data de nascimento no dia do 1º turno.</li>
            <li><b>Eleitores</b>: faixas etárias do cadastro do TSE, contando só quem tem 18 anos ou mais. É o cadastro, não quem foi votar.</li>
            <li><b>Eleições municipais</b> (2020, 2024): prefeito e vereador, comparados com o eleitorado de cada município. <b>Gerais</b> (2018, 2022): governador, senador e deputados, comparados com o eleitorado do estado.</li>
            <li><b>Viés</b>: nota do partido da candidatura naquela eleição (survey de especialistas, Harvard Dataverse), de −100 a +100. Partido sem nota fica fora da média.</li>
            <li>Ficam de fora vices, suplentes de senador, presidente e candidaturas que não chegaram à totalização.</li>
          </ul>
        </details>`;

      conteudo.innerHTML = bloco1 + bloco2 + bloco3 + bloco4 + detalhes;
    };

    await carregar();
  },
};
