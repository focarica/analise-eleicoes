// @ts-nocheck
// Questão 4: escolaridade dos eleitos × população (Censo 2022).
// Edite só este arquivo (e o .css ao lado). Também acrescenta uma seção à gaveta do município.
import { fmt, titulo, esc, request, pctFmt as pct } from "../util";
import { UF, GEO, abrirMunicipio } from "../presentation";
import "./p4-escolaridade.css";

/* ===================== P4: escolaridade dos eleitos × população ===================== */
// vw_questao_4_escolaridade (sql/motherduck/07_views_escolaridade.sql): quatro níveis do
// Censo 2022 (população de 18+), com os sete níveis do TSE agrupados neles.
const NIVEIS_Q4 = ["Sem instrução e fundamental incompleto", "Fundamental completo e médio incompleto", "Médio completo e superior incompleto", "Superior completo"];
const pctQ4 = x => (x * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%";
// linhas: [{ nivel: 1..4 | null, populacao, candidatos, eleitos }] de um recorte
function htmlEscolaridade(linhas, anoCenso){
  const dist = campo => {
    const arr = NIVEIS_Q4.map(() => 0); let fora = 0;
    for (const r of linhas){ const q = Number(r[campo]) || 0; if (r.nivel >= 1 && r.nivel <= 4) arr[r.nivel - 1] += q; else fora += q; }
    return { arr, tot: d3.sum(arr), fora };
  };
  const series = [
    { nome: `População 18+ (Censo ${anoCenso || 2022})`, cls: "esc-el", d: dist("populacao") },
    { nome: "Candidatos", cls: "esc-ca", d: dist("candidatos") },
    { nome: "Eleitos", cls: "esc-ei", d: dist("eleitos") },
  ].filter(s => s.d.tot);
  const P = series.find(s => s.cls === "esc-el"), C = series.find(s => s.cls === "esc-ca"), E = series.find(s => s.cls === "esc-ei");
  if (!C) return `<p class="aviso-mini">Sem candidatos com escolaridade informada neste recorte.</p>`;
  const parte = (s, k) => s.d.arr[k] / s.d.tot;
  const mx = d3.max(series, s => d3.max(s.d.arr) / s.d.tot) || 1;
  const frase = (rotulo, ks) => {
    const soma = s => s ? d3.sum(ks, k => parte(s, k)) : null;
    const c = soma(C), e = soma(E), p = soma(P);
    let t = `${rotulo}: <b>${pctQ4(c)}</b> dos candidatos${E ? ` e <b>${pctQ4(e)}</b> dos eleitos` : ""}`;
    if (P){
      t += `, contra <b>${pctQ4(p)}</b> da população`;
      const ref = E ? e : c, quem = E ? "entre os eleitos" : "entre os candidatos";
      if (p > 0 && ref > 0){
        const r = ref / p;
        t += r >= 1.05 ? ` (${quem}, ${r.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} vezes a proporção da população)`
          : r <= 0.95 ? ` (${quem}, ${Math.round((1 - r) * 100)}% abaixo da proporção da população)` : " (proporção semelhante à da população)";
      }
    }
    return `<li>${t}.</li>`;
  };
  let h = `<ul class="esc-resumo">${frase("Superior completo", [3])}${frase("Sem instrução ou fundamental incompleto", [0])}</ul>`;
  h += `<div class="esc-leg">${series.map(s => `<span><i class="${s.cls}"></i>${s.nome}</span>`).join("")}</div>`;
  h += NIVEIS_Q4.map((nome, k) => `<div class="esc-linha"><span>${nome}</span><div class="esc-barras">${
    series.map(s => `<div title="${s.nome}: ${fmt.format(s.d.arr[k])}"><b><i class="${s.cls}" style="width:${(parte(s, k) / mx * 100).toFixed(1)}%"></i></b><span>${pctQ4(parte(s, k))}</span></div>`).join("")}</div></div>`).join("");
  const fora = C.d.fora + (E?.d.fora || 0);
  h += `<p class="aviso-mini">${fmt.format(C.d.tot)} candidaturas a prefeito e vereador${E ? `, ${fmt.format(E.d.tot)} eleitas` : ""}${P ? `; ${fmt.format(P.d.tot)} pessoas de 18 anos ou mais no Censo` : ""}.${fora ? ` ${fmt.format(fora)} candidaturas sem escolaridade informada ficam fora das porcentagens.` : ""} A escolaridade do candidato é a do cadastro da pessoa; vices e suplentes não entram.</p>`;
  if (!P) h += `<p class="aviso-mini">Sem dados do Censo para este recorte.</p>`;
  return h;
}

const Q4 = { cargo: "TODOS", ano: null, ordem: "maior", cargaId: null };
const q4Cache = new Map();
async function montarEscolaridade(){
  const el = document.getElementById("q4-conteudo");
  if (!el) return;
  document.getElementById("q4-origem").textContent = UF ? `Estado de ${GEO[UF].properties.nome}.` : "Sem estado escolhido: a amostra inteira.";
  const cargos = document.getElementById("q4-cargos");
  cargos.innerHTML = [["TODOS", "Prefeito e vereador"], ["PREFEITO", "Prefeito"], ["VEREADOR", "Vereador"]]
    .map(([c, t]) => `<button data-c="${c}" aria-pressed="${Q4.cargo === c}">${t}</button>`).join("");
  cargos.querySelectorAll("button").forEach(b => b.onclick = () => { Q4.cargo = b.dataset.c; montarEscolaridade(); });
  const pedir = async ano => {
    const q = new URLSearchParams({ cargo: Q4.cargo }); if (UF) q.set("uf", UF); if (ano) q.set("ano", ano);
    const chave = q.toString();
    if (!q4Cache.has(chave)) q4Cache.set(chave, request(`/api/escolaridade?${q}`, { silencioso: true }).catch(e => { q4Cache.delete(chave); throw e; }));
    return q4Cache.get(chave);
  };
  const cargaId = Symbol(); Q4.cargaId = cargaId;
  el.innerHTML = `<p class="aviso-mini">Carregando…</p>`;
  let d;
  try {
    // anos com candidatos: o padrão é a eleição mais próxima do Censo
    const geral = await pedir(0);
    if (Q4.cargaId !== cargaId) return;
    if (!geral.anos.length){ el.innerHTML = `<p class="aviso-mini">Sem candidaturas municipais com escolaridade${UF ? " neste estado" : ""}.</p>`; document.getElementById("q4-anos").innerHTML = ""; return; }
    const censo = geral.anoCenso || 2022;
    if (!geral.anos.includes(Q4.ano)) Q4.ano = geral.anos.reduce((a, b) => Math.abs(b - censo) < Math.abs(a - censo) || (Math.abs(b - censo) === Math.abs(a - censo) && b > a) ? b : a);
    const anos = document.getElementById("q4-anos");
    anos.innerHTML = geral.anos.map(a => `<button data-a="${a}" aria-pressed="${Q4.ano === a}" ${Math.abs(a - censo) > 2 ? `title="Longe do Censo ${censo}: compare com cautela"` : ""}>${a}</button>`).join("");
    anos.querySelectorAll("button").forEach(b => b.onclick = () => { Q4.ano = +b.dataset.a; montarEscolaridade(); });
    d = await pedir(Q4.ano);
  } catch(e){
    if (Q4.cargaId === cargaId) el.innerHTML = `<p class="aviso-mini">Não foi possível carregar: ${esc(e.message)}</p>`;
    return;
  }
  if (Q4.cargaId !== cargaId) return;
  const censo = d.anoCenso || 2022;
  const linhas = d.niveis.filter(r => r.ano === Q4.ano);
  // municípios: diferença de superior completo, eleitos − população (pontos percentuais)
  const muns = d.municipios.filter(m => m.eleitosInf > 0 && m.popInf > 0)
    .map(m => ({ ...m, eleitos: m.eleitosSup / m.eleitosInf, pop: m.popSup / m.popInf }))
    .map(m => ({ ...m, dif: (m.eleitos - m.pop) * 100 }));
  muns.sort((a, b) => Q4.ordem === "maior" ? b.dif - a.dif : a.dif - b.dif);
  const acima = muns.filter(m => m.dif > 0).length;
  let mostrar = 10;
  const pp = v => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} p.p.`;
  const desenhar = () => {
    el.innerHTML = `<div class="fin-grid">
      <div class="fin-bloco"><h3>${Q4.ano}: quem se candidata e quem se elege × população</h3>
        ${Math.abs(Q4.ano - censo) > 2 ? `<p class="aviso-mini">O Censo é de ${censo}; a escolaridade da população em ${Q4.ano} era outra. Compare com cautela.</p>` : ""}
        ${htmlEscolaridade(linhas, censo)}</div>
      <div class="fin-bloco"><h3>Superior completo, município a município</h3>
        <p class="aviso-mini">Em ${fmt.format(acima)} de ${fmt.format(muns.length)} municípios (${muns.length ? pct(acima, muns.length) : "–"}) a parcela de eleitos com superior completo é maior que a da população.</p>
        <div class="cargos" role="group" aria-label="Ordem da lista">
          <button data-o="maior" aria-pressed="${Q4.ordem === "maior"}">Eleitos muito mais escolarizados</button>
          <button data-o="menor" aria-pressed="${Q4.ordem === "menor"}">Mais próximos ou abaixo da população</button></div>
        <div class="tabw"><table class="tab"><thead><tr><th>Município</th><th class="v">Eleitos</th><th class="v">População</th><th class="v">Diferença</th></tr></thead><tbody>
          ${muns.slice(0, mostrar).map(m => `<tr><td><button class="link" data-mun="${esc(m.tse)}" data-uf="${esc(m.uf)}">${esc(titulo(m.nome))}</button>${UF ? "" : ` <small class="dim">${esc(m.uf)}</small>`}</td>
            <td class="v num" title="${fmt.format(m.eleitosSup)} de ${fmt.format(m.eleitosInf)} eleitos">${pctQ4(m.eleitos)}</td>
            <td class="v num">${pctQ4(m.pop)}</td><td class="v num"><b>${pp(m.dif)}</b></td></tr>`).join("")}
        </tbody></table></div>
        ${mostrar < muns.length ? `<p><button class="link" data-mais="1">Mostrar mais</button></p>` : ""}
      </div></div>`;
    el.querySelectorAll("[data-o]").forEach(b => b.onclick = () => { Q4.ordem = b.dataset.o; montarEscolaridade(); });
    // a gaveta do município não depende do estado aberto no mapa
    el.querySelectorAll("[data-mun]").forEach(b => b.onclick = () => abrirMunicipio(b.dataset.mun));
    const mais = el.querySelector("[data-mais]"); if (mais) mais.onclick = () => { mostrar += 10; desenhar(); };
  };
  desenhar();
}

// gaveta do município: a resposta de /api/municipality traz `education` (api/questoes/p4-escolaridade.ts)
function escolaridadeDoMunicipio(m){
  const d = m.bruto?.education;
  if (!d) return [];
  return d.map(r => ({ ano: +r.ano_eleicao, anoCenso: +r.ano_censo, cargo: r.ds_cargo,
    nivel: r.nr_nivel == null ? null : +r.nr_nivel, candidatos: +r.qt_candidatos, eleitos: +r.qt_eleitos,
    populacao: r.qt_populacao == null ? null : +r.qt_populacao })).filter(r => r.candidatos || r.populacao);
}

export default {
  id: "p4", numero: "P4",
  titulo: "Escolaridade: os eleitos se parecem com a população?",
  pergunta: "Escolaridade do candidato × escolaridade dos votantes",
  resumo: "Grau de instrução de candidatos e eleitos a prefeito e vereador comparado com o da população no Censo 2022.",
  montar(el) {
    el.innerHTML = `<p class="nota">Grau de instrução de quem se candidata e de quem se elege a prefeito e vereador, comparado com o da população de 18 anos ou mais no Censo 2022 (IBGE), nos quatro níveis do Censo. A escolaridade do candidato é a do cadastro no TSE; as candidaturas sem escolaridade informada ficam fora das porcentagens. O Censo é de 2022: as eleições mais próximas são as de 2020 e 2024. <span id="q4-origem"></span></p>
<div class="cargos" id="q4-cargos" role="group" aria-label="Cargo da seção de escolaridade"></div>
<div class="cargos" id="q4-anos" role="group" aria-label="Eleição da seção de escolaridade"></div>
<div id="q4-conteudo"></div>`;
    montarEscolaridade();
  },
  gavetaMunicipio(m) {
    const escol = escolaridadeDoMunicipio(m);
    if (!escol.length) return null;
    const anosE = [...new Set(escol.map(r => r.ano))].sort((a, b) => b - a);
    const opcoes = anosE.flatMap(a => [[`${a}|TODOS`, `${a}, prefeito e vereador`], [`${a}|PREFEITO`, `${a}, prefeito`], [`${a}|VEREADOR`, `${a}, vereador`]]
      .filter(([v]) => v.endsWith("TODOS") || escol.some(r => `${r.ano}|${r.cargo}` === v && r.candidatos)));
    return {
      html: `<h3>Escolaridade: candidatos e eleitos × população</h3><div class="ctrl"><select id="esc-sel" aria-label="Eleição e cargo">${opcoes.map(([v, t]) => `<option value="${esc(v)}">${t}</option>`).join("")}</select></div><div id="esc-lista"></div>`,
      ligar(corpo) {
        const sel = corpo.querySelector("#esc-sel"), lista = corpo.querySelector("#esc-lista");
        const desenhar = () => {
          const [a, c] = sel.value.split("|");
          const linhas = escol.filter(r => r.ano === +a && r.cargo === c);
          lista.innerHTML = htmlEscolaridade(linhas, linhas[0]?.anoCenso);
        };
        sel.onchange = desenhar; desenhar();
      },
    };
  },
};
