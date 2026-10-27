// @ts-nocheck
// Questão 4: escolaridade dos eleitos × população (Censo 2022).
// Edite só este arquivo (e o .css ao lado). Também acrescenta uma seção à gaveta do município.
import { fmt, titulo, esc, request } from "../util";
import { UF, GEO, abrirMunicipio } from "../presentation";
import "./p4-escolaridade.css";

/* ===================== P4: escolaridade dos eleitos × população ===================== */
// vw_questao_4_escolaridade (sql/motherduck/07_views_escolaridade.sql): quatro níveis do
// Censo 2022 (população de 18+), com os sete níveis do TSE agrupados neles.
const NIVEIS_Q4 = ["Sem instrução e fundamental incompleto", "Fundamental completo e médio incompleto", "Médio completo e superior incompleto", "Superior completo"];
const pctQ4 = x => (x * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%";
// porcentagem de uma razão sem arredondar para 0% ou 100% quando não é exatamente isso
function pctRazao(a, b){
  if (!b) return "–";
  if (a === b) return "100%";
  if (a === 0) return "0%";
  const v = a / b * 100;
  if (v > 99.9) return "mais de 99,9%";
  if (v < 0.1) return "menos de 0,1%";
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%";
}
const ppQ4 = v => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} p.p.`;
// rótulos curtos para as barras empilhadas
const NIVEIS_CURTOS = ["Até fundamental incompleto", "Fundamental completo", "Médio completo", "Superior completo"];

// linhas: [{ nivel: 1..4 | null, populacao, candidatos, eleitos }] de um recorte.
// Usado no painel da questão e na gaveta do município.
function htmlEscolaridade(linhas, anoCenso){
  const dist = campo => {
    const arr = NIVEIS_Q4.map(() => 0); let fora = 0;
    for (const r of linhas){ const q = Number(r[campo]) || 0; if (r.nivel >= 1 && r.nivel <= 4) arr[r.nivel - 1] += q; else fora += q; }
    return { arr, tot: d3.sum(arr), fora };
  };
  const series = [
    { nome: `População 18+ (Censo ${anoCenso || 2022})`, curto: "População", d: dist("populacao") },
    { nome: "Candidatos", curto: "Candidatos", d: dist("candidatos") },
    { nome: "Eleitos", curto: "Eleitos", d: dist("eleitos") },
  ].filter(s => s.d.tot);
  const P = series.find(s => s.curto === "População"), C = series.find(s => s.curto === "Candidatos"), E = series.find(s => s.curto === "Eleitos");
  if (!C) return `<p class="aviso-mini">Sem candidatos com escolaridade informada neste recorte.</p>`;
  const parte = (s, k) => s.d.arr[k] / s.d.tot;

  // 1) a resposta em uma frase: superior completo entre os eleitos × na população
  const ref = E || C, quem = E ? "eleitos" : "candidatos";
  let h = "";
  if (P){
    const e = parte(ref, 3), p = parte(P, 3), razao = p > 0 ? e / p : null;
    const comparacao = razao == null ? "" : razao >= 1.05
      ? `${razao.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} vezes a proporção da população`
      : razao <= 0.95 ? `abaixo da proporção da população` : `quase a mesma proporção da população`;
    h += `<div class="esc-resposta">
        <div><b class="num">${pctQ4(e)}</b><span>dos ${quem} têm superior completo</span></div>
        <div><b class="num">${pctQ4(p)}</b><span>da população adulta tem superior completo</span></div>
      </div>
      <p class="esc-frase">${comparacao ? `Entre os ${quem}, a parcela com superior completo é ${comparacao}.` : ""}
        Na outra ponta, ${pctQ4(parte(ref, 0))} dos ${quem} não completaram o fundamental, contra ${pctQ4(parte(P, 0))} da população.</p>`;
  }

  // 2) barras empilhadas: cada barra soma 100%, dividida nos quatro níveis
  h += `<div class="esc-pilhas">${series.map(s => `<div class="esc-pilha-linha"><span>${s.curto}</span><div class="esc-pilha">${
      s.d.arr.map((n, k) => { const v = parte(s, k); return v ? `<i class="esc-n${k + 1}" style="width:${(v * 100).toFixed(2)}%" title="${s.nome} · ${NIVEIS_Q4[k]}: ${pctQ4(v)} (${fmt.format(n)})">${v >= 0.09 ? pctQ4(v).replace(/,\d%$/, "%") : ""}</i>` : ""; }).join("")
    }</div></div>`).join("")}</div>
    <div class="esc-niveis">${NIVEIS_CURTOS.map((n, k) => `<span><i class="esc-n${k + 1}"></i>${n}</span>`).join("")}</div>`;

  // 3) os números exatos, com a diferença entre eleitos e população
  h += `<div class="tabw"><table class="tab esc-tab"><thead><tr><th>Nível</th>${series.map(s => `<th class="v">${s.curto}</th>`).join("")}${P && E ? `<th class="v" title="Parcela entre os eleitos menos parcela na população, em pontos percentuais">Diferença</th>` : ""}</tr></thead><tbody>
    ${NIVEIS_Q4.map((nome, k) => `<tr><td><i class="esc-n${k + 1} esc-mini"></i>${nome}</td>${series.map(s => `<td class="v num">${pctQ4(parte(s, k))}</td>`).join("")}${P && E ? `<td class="v num"><b>${ppQ4((parte(E, k) - parte(P, k)) * 100)}</b></td>` : ""}</tr>`).join("")}
  </tbody></table></div>`;
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
  // municípios: diferença de superior completo, eleitos − população (pontos percentuais).
  // Com poucos eleitos a parcela vira 0% ou 100% (1 eleito com superior = 100%): a lista
  // só compara municípios com pelo menos MIN_ELEITOS eleitos com escolaridade informada.
  const MIN_ELEITOS = 5;
  const todos = d.municipios.filter(m => m.eleitosInf > 0 && m.popInf > 0)
    .map(m => ({ ...m, eleitos: m.eleitosSup / m.eleitosInf, pop: m.popSup / m.popInf }))
    .map(m => ({ ...m, dif: (m.eleitos - m.pop) * 100 }));
  const muns = todos.filter(m => m.eleitosInf >= MIN_ELEITOS);
  muns.sort((a, b) => Q4.ordem === "maior" ? b.dif - a.dif : a.dif - b.dif);
  const acima = muns.filter(m => m.dif > 0).length;
  let mostrar = 10;
  const blocoMunicipios = () => {
    // prefeito: um eleito por município, então a comparação município a município não diz nada
    if (Q4.cargo === "PREFEITO"){
      const comSup = todos.filter(m => m.eleitosSup > 0).length;
      const popSup = d3.sum(todos, m => m.popSup), popInf = d3.sum(todos, m => m.popInf);
      return `<h3>Prefeitos com superior completo</h3>
        <p class="esc-frase">Em <b>${fmt.format(comSup)}</b> de ${fmt.format(todos.length)} municípios (${pctRazao(comSup, todos.length)}) o prefeito eleito em ${Q4.ano} tem superior completo. Na população adulta desses municípios, a parcela com superior completo é de ${popInf ? pctQ4(popSup / popInf) : "–"}.</p>
        <p class="aviso-mini">Cada município elege um único prefeito: a parcela dele só pode ser 0% ou 100%, por isso aqui não há lista município a município. Para ela, escolha "Vereador" ou "Prefeito e vereador".</p>`;
    }
    return `<h3>Superior completo, município a município</h3>
      <p class="esc-frase">Em <b>${fmt.format(acima)}</b> de ${fmt.format(muns.length)} municípios (${pctRazao(acima, muns.length)}) a parcela de eleitos com superior completo é maior que a da população.</p>
      <div class="cargos" role="group" aria-label="Ordem da lista">
        <button data-o="maior" aria-pressed="${Q4.ordem === "maior"}">Eleitos bem mais escolarizados</button>
        <button data-o="menor" aria-pressed="${Q4.ordem === "menor"}">Eleitos parecidos com a população</button></div>
      <div class="tabw"><table class="tab"><thead><tr><th>Município</th><th class="v">Eleitos com superior</th><th class="v">População com superior</th><th class="v">Diferença</th></tr></thead><tbody>
        ${muns.slice(0, mostrar).map(m => `<tr><td><button class="link" data-mun="${esc(m.tse)}" data-uf="${esc(m.uf)}">${esc(titulo(m.nome))}</button>${UF ? "" : ` <small class="dim">${esc(m.uf)}</small>`}</td>
          <td class="v num">${pctQ4(m.eleitos)} <small class="dim">${fmt.format(m.eleitosSup)} de ${fmt.format(m.eleitosInf)}</small></td>
          <td class="v num">${pctQ4(m.pop)}</td><td class="v num"><b>${ppQ4(m.dif)}</b></td></tr>`).join("")}
      </tbody></table></div>
      ${mostrar < muns.length ? `<p><button class="link" data-mais="1">Mostrar mais</button></p>` : ""}
      <p class="aviso-mini">Só municípios com pelo menos ${MIN_ELEITOS} eleitos com escolaridade informada (${fmt.format(muns.length)} de ${fmt.format(todos.length)}): com menos, um único eleito já vira 0% ou 100%. Diferença em pontos percentuais (p.p.): parcela entre os eleitos menos parcela na população.</p>`;
  };
  const desenhar = () => {
    el.innerHTML = `<div class="fin-grid">
      <div class="fin-bloco"><h3>${Q4.ano}: quem se candidata e quem se elege × população</h3>
        ${Math.abs(Q4.ano - censo) > 2 ? `<p class="aviso-mini">O Censo é de ${censo}; a escolaridade da população em ${Q4.ano} era outra. Compare com cautela.</p>` : ""}
        ${htmlEscolaridade(linhas, censo)}</div>
      <div class="fin-bloco">${blocoMunicipios()}</div></div>`;
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
