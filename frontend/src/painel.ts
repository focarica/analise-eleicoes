// @ts-nocheck
// Cards das questões e o painel que abre cada uma. O painel segue o endereço:
// #/SP/p4 abre a questão 4 com São Paulo; #/p4, com a amostra inteira.
import { QUESTOES, questaoPorId } from "./questoes";
import { UFS, esc } from "./util";
import { UF, ANO, GEO, anosDisponiveis, mudarAno, irPara, atualizarTrava, gavetaAberta } from "./presentation";

const painel = document.getElementById("q-painel");
const scrim = document.getElementById("q-scrim");
const corpo = document.getElementById("qp-corpo");
let aberta = null, focoAntes = null;

export const painelAberto = () => !!aberta;

export function montarCards(){
  const grade = document.getElementById("q-grid");
  grade.innerHTML = QUESTOES.map(q => `<button type="button" class="q-card" data-q="${q.id}">
      <span class="q-num">${esc(q.numero)}</span>
      <h3>${esc(q.titulo)}</h3>
      <p>${esc(q.resumo)}</p>
      <span class="q-onde">${esc(q.onde || (q.usaAno ? "Por estado e ano" : "Por estado ou amostra inteira"))}</span>
    </button>`).join("");
  grade.querySelectorAll(".q-card").forEach(b => b.onclick = () => irPara(UF, b.dataset.q));
}

// abre, troca ou fecha conforme o endereço
export function sincronizarPainel(id){
  const q = id ? questaoPorId(id) : null;
  if (!q){ if (aberta) fechar(); return; }
  const nova = aberta !== q;
  if (!aberta) focoAntes = document.activeElement;
  aberta = q;
  desenhar();
  if (nova){ painel.scrollTop = 0; painel.focus(); }
}

// estado ou ano mudaram: redesenha a questão aberta
export function atualizarPainel(){ if (aberta) desenhar(); }

function desenhar(){
  const q = aberta;
  painel.hidden = false; scrim.classList.add("on"); atualizarTrava();
  document.getElementById("qp-num").textContent = q.numero;
  document.getElementById("qp-titulo").textContent = q.titulo;
  const pergunta = document.getElementById("qp-pergunta");
  pergunta.textContent = q.pergunta && q.pergunta !== q.titulo ? q.pergunta : "";
  pergunta.hidden = !pergunta.textContent;
  // recorte: amostra inteira ou um estado; ano só nas questões que dependem dele
  const ufs = document.getElementById("qp-ufs");
  ufs.innerHTML = [`<button type="button" data-uf="" aria-pressed="${!UF}">Amostra inteira</button>`]
    .concat(UFS.map(u => `<button type="button" data-uf="${u}" aria-pressed="${UF === u}" title="${esc(GEO[u].properties.nome)}">${u}</button>`)).join("");
  ufs.querySelectorAll("button").forEach(b => b.onclick = () => irPara(b.dataset.uf || null, q.id));
  const anos = document.getElementById("qp-anos");
  anos.hidden = !(q.usaAno && UF);
  anos.innerHTML = q.usaAno && UF ? anosDisponiveis(UF).map(a => `<button type="button" data-ano="${a}" aria-pressed="${a === ANO}">${a}</button>`).join("") : "";
  anos.querySelectorAll("button").forEach(b => b.onclick = () => mudarAno(+b.dataset.ano));
  corpo.innerHTML = "";
  q.montar(corpo);
}

function fechar(){
  aberta = null;
  painel.hidden = true; scrim.classList.remove("on"); atualizarTrava();
  corpo.innerHTML = "";
  focoAntes?.focus?.(); focoAntes = null;
}

const pedirFechar = () => irPara(UF, null);
document.getElementById("qp-fechar").onclick = pedirFechar;
scrim.onclick = pedirFechar;
// Esc fecha a gaveta primeiro (ela fica por cima do painel); depois o painel
document.addEventListener("keydown", ev => { if (ev.key === "Escape" && aberta && !gavetaAberta()) pedirFechar(); });
