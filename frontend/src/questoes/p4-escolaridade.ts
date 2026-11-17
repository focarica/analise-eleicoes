// @ts-nocheck
// Questão 4: escolaridade dos eleitos × população (Censo 2022).
// Edite só este arquivo (e o .css ao lado). Também acrescenta uma seção à gaveta do município.
import { fmt, titulo, esc, request, pctFmt as pct } from "../util";
import { UF, GEO, abrirMunicipio } from "../presentation";
import "./p4-escolaridade.css";
import { montarPainelEscolaridade } from "./p4-painel";

/* ===================== P4: escolaridade dos eleitos × população ===================== */
// vw_questao_4_escolaridade (sql/motherduck/07_views_escolaridade.sql): quatro níveis do
// Censo 2022 (população de 18+), com os sete níveis do TSE agrupados neles.
const NIVEIS_Q4 = ["Sem instrução e fundamental incompleto", "Fundamental completo e médio incompleto", "Médio completo e superior incompleto", "Superior completo"];
const pctQ4 = x => (x * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%";
// linhas: [{ nivel: 1..4 | null, populacao, candidatos, eleitos }] de um recorte
function htmlEscolaridade(linhas, anoCenso, comparacao = "AMBOS"){
  const dist = campo => {
    const arr = NIVEIS_Q4.map(() => 0); let fora = 0;
    for (const r of linhas){ const q = Number(r[campo]) || 0; if (r.nivel >= 1 && r.nivel <= 4) arr[r.nivel - 1] += q; else fora += q; }
    return { arr, tot: d3.sum(arr), fora };
  };
  const todasSeries = [
    { nome: `População 18+ (Censo ${anoCenso || 2022})`, cls: "esc-el", d: dist("populacao"), fonte: "CENSO" },
    { nome: "Eleitorado apto (TSE)", cls: "esc-te", d: dist("eleitorado"), fonte: "ELEITORADO" },
    { nome: "Candidatos", cls: "esc-ca", d: dist("candidatos") },
    { nome: "Eleitos", cls: "esc-ei", d: dist("eleitos") },
  ];
  const series = todasSeries.filter(s => !s.fonte || comparacao === "AMBOS" || s.fonte === comparacao).filter(s => s.d.tot);
  const P = series.find(s => s.cls === "esc-el"), T = series.find(s => s.cls === "esc-te"), C = series.find(s => s.cls === "esc-ca"), E = series.find(s => s.cls === "esc-ei");
  if (!C) return `<p class="aviso-mini">Sem candidatos com escolaridade informada neste recorte.</p>`;
  const parte = (s, k) => s.d.arr[k] / s.d.tot;
  const mx = d3.max(series, s => d3.max(s.d.arr) / s.d.tot) || 1;
  const frase = (rotulo, ks) => {
    const soma = s => s ? d3.sum(ks, k => parte(s, k)) : null;
    const c = soma(C), e = soma(E), p = soma(P), te = soma(T);
    let texto = `${rotulo}: <b>${pctQ4(c)}</b> dos candidatos${E ? ` e <b>${pctQ4(e)}</b> dos eleitos` : ""}`;
    if (P) texto += `, contra <b>${pctQ4(p)}</b> da população residente`;
    if (T) texto += `${P ? " e" : ", contra"} <b>${pctQ4(te)}</b> do eleitorado apto`;
    return `<li>${texto}.</li>`;
  };
  let h = `<ul class="esc-resumo">${frase("Superior completo", [3])}${frase("Sem instrução ou fundamental incompleto", [0])}</ul>`;
  h += `<div class="esc-leg">${series.map(s => `<span><i class="${s.cls}"></i>${s.nome}</span>`).join("")}</div>`;
  h += NIVEIS_Q4.map((nome, k) => `<div class="esc-linha"><span>${nome}</span><div class="esc-barras">${
    series.map(s => `<div title="${s.nome}: ${fmt.format(s.d.arr[k])}"><b><i class="${s.cls}" style="width:${(parte(s, k) / mx * 100).toFixed(1)}%"></i></b><span>${pctQ4(parte(s, k))}</span></div>`).join("")}</div></div>`).join("");
  const fora = C.d.fora + (E?.d.fora || 0);
  h += `<p class="aviso-mini">${fmt.format(C.d.tot)} candidaturas a prefeito e vereador${E ? `, ${fmt.format(E.d.tot)} eleitas` : ""}${P ? `; ${fmt.format(P.d.tot)} pessoas de 18 anos ou mais no Censo` : ""}${T ? `; ${fmt.format(T.d.tot)} eleitores aptos no perfil do TSE` : ""}.${fora ? ` ${fmt.format(fora)} candidaturas sem escolaridade informada ficam fora das porcentagens.` : ""} As distribuições do Censo e do eleitorado são marginais independentes; não são cruzamentos entre pessoas. A escolaridade do candidato é a do cadastro no TSE; vices e suplentes não entram.</p>`;
  if (!P) h += `<p class="aviso-mini">Sem dados do Censo para este recorte.</p>`;
  if (!T && comparacao !== "CENSO") h += `<p class="aviso-mini">Sem perfil de instrução do eleitorado TSE para este recorte.</p>`;
  return h;
}

// gaveta do município: a resposta de /api/municipality traz `education` (api/questoes/p4-escolaridade.ts)
function escolaridadeDoMunicipio(m){
  const d = m.bruto?.education;
  if (!d) return [];
  return d.map(r => ({ ano: +r.ano_eleicao, anoCenso: +r.ano_censo, anoEleitorado: +r.ano_eleitorado, cargo: r.ds_cargo,
    nivel: r.nr_nivel == null ? null : +r.nr_nivel, candidatos: +r.qt_candidatos, eleitos: +r.qt_eleitos,
    populacao: r.qt_populacao == null ? null : +r.qt_populacao,
    eleitorado: r.qt_eleitorado == null ? null : +r.qt_eleitorado })).filter(r => r.candidatos || r.populacao || r.eleitorado);
}

export default {
  id: "p4", numero: "P4",
  titulo: "Escolaridade: os eleitos se parecem com a população?",
  pergunta: "Escolaridade do candidato × escolaridade dos votantes",
  resumo: "Grau de instrução de candidatos e eleitos comparado com o eleitorado do TSE, a população do Censo 2022 ou ambos.",
  montar(el) { return montarPainelEscolaridade(el); },
  gavetaMunicipio(m) {
    const escol = escolaridadeDoMunicipio(m);
    if (!escol.length) return null;
    const anosE = [...new Set(escol.map(r => r.ano))].sort((a, b) => b - a);
    const opcoes = anosE.flatMap(a => [[`${a}|TODOS`, `${a}, prefeito e vereador`], [`${a}|PREFEITO`, `${a}, prefeito`], [`${a}|VEREADOR`, `${a}, vereador`]]
      .filter(([v]) => v.endsWith("TODOS") || escol.some(r => `${r.ano}|${r.cargo}` === v && r.candidatos)));
    return {
      html: `<h3>Escolaridade: candidatos e eleitos × eleitorado/população</h3><div class="ctrl"><select id="esc-sel" aria-label="Eleição e cargo">${opcoes.map(([v, t]) => `<option value="${esc(v)}">${t}</option>`).join("")}</select><select id="esc-universo" aria-label="Referência de escolaridade"><option value="CENSO">População do Censo</option><option value="ELEITORADO">Eleitorado TSE</option><option value="AMBOS" selected>Ambos</option></select></div><div id="esc-lista"></div>`,
      ligar(corpo) {
        const sel = corpo.querySelector("#esc-sel"), lista = corpo.querySelector("#esc-lista");
        const universo = corpo.querySelector("#esc-universo");
        const desenhar = () => {
          const [a, c] = sel.value.split("|");
          const linhas = escol.filter(r => r.ano === +a && r.cargo === c);
          lista.innerHTML = htmlEscolaridade(linhas, linhas[0]?.anoCenso, universo.value);
        };
        sel.onchange = desenhar; universo.onchange = desenhar; desenhar();
      },
    };
  },
};
