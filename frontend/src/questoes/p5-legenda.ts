// @ts-nocheck
// Questão 5: eleitos com a ajuda dos votos do partido. Edite só este arquivo (e o .css ao lado).
import { CARGO_COD, corP, fmt, titulo, esc, request, pctFmt as pct } from "../util";
import { UF, GEO, abrirCandidato } from "../presentation";
import "./p5-legenda.css";

/* ===================== P5: eleitos com a ajuda do partido ===================== */
// vw_questao_5_legenda (sql/motherduck/11_views_legenda.sql) via /api/legenda.
const LEG5 = { cargo: null, ano: null, partido: null, dados: null, cargaId: null };
const leg5Cache = new Map();
const LEG5_CARGOS = [13, 6, 7, 8];

async function montarLegendaPartido(){
  const el = document.getElementById("leg5-conteudo");
  if (!el) return;
  const chave = UF || "*";
  document.getElementById("leg5-origem").textContent = UF ? `Estado de ${GEO[UF].properties.nome}.` : "Sem estado escolhido: a amostra inteira.";
  if (leg5Cache.has(chave)){ LEG5.dados = leg5Cache.get(chave); aplicarLegendaPartido(); return; }
  el.innerHTML = `<p class="aviso-mini">Carregando…</p>`;
  document.getElementById("leg5-cargos").innerHTML = ""; document.getElementById("leg5-anos").innerHTML = "";
  const cargaId = Symbol(); LEG5.cargaId = cargaId;
  try {
    const d = await request(`/api/legenda${UF ? `?uf=${encodeURIComponent(UF)}` : ""}`, { silencioso: true });
    leg5Cache.set(chave, d);
    if (LEG5.cargaId !== cargaId) return;
    LEG5.dados = d; aplicarLegendaPartido();
  } catch(e){
    if (LEG5.cargaId !== cargaId) return;
    el.innerHTML = `<p class="aviso-mini">Não foi possível carregar os dados: ${esc(e.message)}</p>`;
  }
}

function aplicarLegendaPartido(){
  const el = document.getElementById("leg5-conteudo"), botCargo = document.getElementById("leg5-cargos"), botAno = document.getElementById("leg5-anos");
  const resumo = LEG5.dados.resumo;
  const cargos = LEG5_CARGOS.filter(c => resumo.some(r => r.cdCargo === c && r.eleitos));
  if (!cargos.length){ el.innerHTML = `<p class="aviso-mini">Sem eleitos para cargos proporcionais com votação na base${UF ? " neste estado" : ""}.</p>`; botCargo.innerHTML = botAno.innerHTML = ""; return; }
  if (!cargos.includes(LEG5.cargo)) LEG5.cargo = cargos[0];
  const anos = resumo.filter(r => r.cdCargo === LEG5.cargo && r.eleitos).map(r => r.ano).sort((a,b) => a-b);
  // troca de cargo mantém o ano se ele existir; senão, o mais recente
  if (!anos.includes(LEG5.ano)){ LEG5.ano = anos[anos.length - 1]; LEG5.partido = null; }
  botCargo.innerHTML = cargos.map(c => `<button data-c="${c}" aria-pressed="${LEG5.cargo===c}">${CARGO_COD[c]}</button>`).join("");
  botCargo.querySelectorAll("button").forEach(b => b.onclick = () => { LEG5.cargo = +b.dataset.c; LEG5.partido = null; aplicarLegendaPartido(); });
  botAno.innerHTML = anos.map(a => `<button data-a="${a}" aria-pressed="${LEG5.ano===a}">${a}</button>`).join("");
  botAno.querySelectorAll("button").forEach(b => b.onclick = () => { LEG5.ano = +b.dataset.a; LEG5.partido = null; aplicarLegendaPartido(); });

  const atual = resumo.find(r => r.cdCargo === LEG5.cargo && r.ano === LEG5.ano);
  const p = (a, b) => b ? pct(a, b) : "–";
  const serie = resumo.filter(r => r.cdCargo === LEG5.cargo && r.eleitos).sort((a,b) => a.ano - b.ano);
  const partidos = LEG5.dados.partidos.filter(r => r.cdCargo === LEG5.cargo && r.ano === LEG5.ano)
    .sort((a,b) => b.abaixoQe - a.abaixoQe || b.eleitos - a.eleitos).slice(0, 15);
  const cargoTxt = CARGO_COD[LEG5.cargo].toLowerCase().replace(/^deputado/, "deputados").replace(/^vereador$/, "vereadores");
  el.innerHTML = `
    <div class="fin-bloco">
      <h3>${LEG5.ano}: ${cargoTxt}</h3>
      <p class="leg5-destaque"><b>${fmt.format(atual.abaixoQe)}</b> de ${fmt.format(atual.eleitos)} eleitos (${p(atual.abaixoQe, atual.eleitos)}) tiveram menos votos que o quociente eleitoral: dependeram dos votos do partido.</p>
      <p class="aviso-mini">${fmt.format(atual.abaixoLegenda)} (${p(atual.abaixoLegenda, atual.eleitos)}) tiveram menos votos próprios que a legenda do partido na disputa.</p>
      <h4>Abaixo do quociente, eleição a eleição</h4>
      ${serie.map(r => `<div class="hb leg5-ano${r.ano===LEG5.ano ? " on" : ""}" data-a="${r.ano}" role="button" tabindex="0" title="Ver ${r.ano}"><span>${r.ano}</span><i class="t" style="width:${r.eleitos ? (r.abaixoQe / r.eleitos * 100).toFixed(1) : 0}%"></i><span class="v">${p(r.abaixoQe, r.eleitos)}</span></div>`).join("")}
    </div>
    <div class="fin-bloco">
      <h3>Por partido</h3>
      <div class="tabw"><table class="tab"><thead><tr><th>Partido</th><th class="v">Eleitos</th><th class="v">Abaixo do quociente</th><th class="v">Abaixo da legenda</th></tr></thead><tbody>
        ${partidos.map(r => `<tr class="leg5-partido${LEG5.partido===r.partido ? " on" : ""}" data-p="${esc(r.partido)}" title="Ver quem são">
          <td><span class="chip" style="background:${corP(r.partido)}">${esc(r.partido)}</span></td>
          <td class="v num">${fmt.format(r.eleitos)}</td>
          <td class="v num">${fmt.format(r.abaixoQe)} <small>${p(r.abaixoQe, r.eleitos)}</small></td>
          <td class="v num">${fmt.format(r.abaixoLegenda)}</td></tr>`).join("")}
      </tbody></table></div>
      <h4>Quem se elegeu com menos votos em relação ao quociente${LEG5.partido ? ` · <span class="chip" style="background:${corP(LEG5.partido)}">${esc(LEG5.partido)}</span> <button class="link" data-limpar="1">ver todos</button>` : ""}</h4>
      <div id="leg5-quem"><p class="aviso-mini">Carregando…</p></div>
    </div>`;
  el.querySelectorAll(".leg5-ano").forEach(d => {
    const ir = () => { LEG5.ano = +d.dataset.a; LEG5.partido = null; aplicarLegendaPartido(); };
    d.onclick = ir; d.onkeydown = ev => { if (ev.key === "Enter" || ev.key === " "){ ev.preventDefault(); ir(); } };
  });
  el.querySelectorAll(".leg5-partido").forEach(tr => tr.onclick = () => { LEG5.partido = LEG5.partido === tr.dataset.p ? null : tr.dataset.p; aplicarLegendaPartido(); });
  const limpar = el.querySelector("[data-limpar]"); if (limpar) limpar.onclick = () => { LEG5.partido = null; aplicarLegendaPartido(); };
  quemLegendaPartido();
}

async function quemLegendaPartido(){
  const alvo = document.getElementById("leg5-quem"); if (!alvo) return;
  const marca = [UF, LEG5.cargo, LEG5.ano, LEG5.partido].join("|");
  const q = new URLSearchParams({ cargo: LEG5.cargo, ano: LEG5.ano });
  if (UF) q.set("uf", UF);
  if (LEG5.partido) q.set("partido", LEG5.partido);
  try {
    const d = await request(`/api/legenda/pessoas?${q}`, { silencioso: true });
    if (!alvo.isConnected || [UF, LEG5.cargo, LEG5.ano, LEG5.partido].join("|") !== marca) return;
    if (!d.pessoas.length){ alvo.innerHTML = `<p class="aviso-mini">Ninguém se elegeu abaixo do quociente neste recorte.</p>`; return; }
    const local = LEG5.cargo === 13 ? "Município" : "UF";
    // dez por vez, como as outras listas "quem são" da página
    let mostrar = 10;
    const desenhar = () => {
    alvo.innerHTML = `<div class="tabw"><table class="tab"><thead><tr><th>Eleito</th><th>Partido</th><th>${local}</th><th class="v">Votos</th><th class="v">do quociente</th></tr></thead><tbody>
      ${d.pessoas.slice(0, mostrar).map(r => `<tr>
        <td><button class="link" data-cand="${r.id_pessoa_projeto}">${esc(titulo(r.nm_urna_candidato))}</button>${r.eleito_abaixo_legenda ? ` <small class="dim" title="Menos votos que a legenda do partido">· abaixo da legenda</small>` : ""}</td>
        <td><span class="chip" style="background:${corP(r.sg_partido)}">${esc(r.sg_partido)}</span></td>
        <td>${esc(LEG5.cargo === 13 ? titulo(r.nm_municipio || "") : r.uf)}</td>
        <td class="v num" title="Quociente: ${fmt.format(r.quociente_eleitoral)} votos">${fmt.format(r.votos_nominais)}</td>
        <td class="v num">${Number(r.pct_do_quociente).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</td></tr>`).join("")}
      </tbody></table></div>
      ${mostrar < d.pessoas.length ? `<p><button class="link" data-mais="1">Mostrar mais</button></p>` : ""}
      <p class="aviso-mini">Os eleitos com menor fração do quociente${UF ? "" : " na amostra"} (até 40); passe o mouse nos votos para ver o quociente da disputa.</p>`;
    alvo.querySelectorAll("[data-cand]").forEach(b => b.onclick = () => abrirCandidato(+b.dataset.cand));
    const mais = alvo.querySelector("[data-mais]");
    if (mais) mais.onclick = () => { mostrar += 10; desenhar(); };
    };
    desenhar();
  } catch(e){ if (alvo.isConnected) alvo.innerHTML = `<p class="aviso-mini">Não foi possível listar: ${esc(e.message)}</p>`; }
}

export default {
  id: "p5", numero: "P5",
  titulo: "Eleitos com a ajuda do partido",
  pergunta: "Quantos candidatos de dado partido foram eleitos por votos de legenda?",
  resumo: "Eleitos a vereador e deputado com menos votos próprios que o quociente eleitoral ou que a legenda do partido.",
  montar(el) {
    el.innerHTML = `<p class="nota">Em vereador e deputado, as cadeiras são divididas primeiro entre os partidos, pela soma dos votos dos seus candidatos com os votos de legenda (no número do partido); dentro de cada partido, vão para os mais votados. Por isso dá para se eleger com poucos votos próprios. O <b>quociente eleitoral</b> é o total de votos válidos da disputa dividido pelas cadeiras: quem se elegeu <b>abaixo do quociente</b> não conquistaria a vaga sozinho e dependeu dos votos de legenda e dos colegas de partido. A segunda régua conta quem teve <b>menos votos que a legenda do próprio partido</b>. Votos do 1º turno; até 2018 os partidos podiam se coligar e a cadeira era da coligação. <span id="leg5-origem"></span></p>
<div class="cargos" id="leg5-cargos" role="group" aria-label="Cargo da seção de votos de legenda"></div>
<div class="cargos" id="leg5-anos" role="group" aria-label="Eleição da seção de votos de legenda"></div>
<div class="fin-grid" id="leg5-conteudo"></div>`;
    montarLegendaPartido();
  },
};
