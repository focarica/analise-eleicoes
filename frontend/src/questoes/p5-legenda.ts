// @ts-nocheck
// Questão 5: eleitos com a ajuda dos votos do partido. Edite só este arquivo (e o .css ao lado).
import { CARGO_COD, corP, fmt, titulo, esc, request } from "../util";
import { UF, GEO, abrirCandidato } from "../presentation";
import "./p5-legenda.css";

/* ===================== P5: eleitos com a ajuda do partido ===================== */
// vw_questao_5_legenda (sql/motherduck/11_views_legenda.sql) via /api/legenda.
// Escolhas guardadas no módulo: continuam ao trocar de estado, para comparar.
const LEG5 = { cargo: null, ano: null, partido: null, lista: "sozinhos", dados: null, cargaId: null };
const leg5Cache = new Map();
const LEG5_CARGOS = [13, 6, 7, 8];

// Faixas de quanto do quociente eleitoral o eleito alcançou com os próprios votos.
// A última é quem se elegeu "sozinho": votos próprios ≥ quociente.
const FAIXAS_QE = [
  { rotulo: "menos de 10%", cls: "f0" },
  { rotulo: "10% a 25%", cls: "f1" },
  { rotulo: "25% a 50%", cls: "f2" },
  { rotulo: "50% a 100%", cls: "f3" },
  { rotulo: "100% ou mais: sozinhos", cls: "f4" },
];

// Porcentagem que nunca mostra 100% (ou 0%) quando não é exatamente isso: com uma casa
// decimal, 5.713 de 5.714 (99,98%) arredondava para "100%".
function pctSeguro(a, b){
  if (!b) return "–";
  if (a === b) return "100%";
  if (a === 0) return "0%";
  const v = a / b * 100;
  if (v > 99.9) return "mais de 99,9%";
  if (v < 0.1) return "menos de 0,1%";
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%";
}
const pctNum = v => Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%";

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
  const sozinhos = atual.eleitos - atual.abaixoQe;
  const faixas = atual.faixas || [0, 0, 0, 0, sozinhos];
  const serie = resumo.filter(r => r.cdCargo === LEG5.cargo && r.eleitos).sort((a,b) => a.ano - b.ano);
  const partidos = LEG5.dados.partidos.filter(r => r.cdCargo === LEG5.cargo && r.ano === LEG5.ano)
    .map(r => ({ ...r, sozinhos: r.eleitos - r.abaixoQe }))
    .sort((a,b) => b.eleitos - a.eleitos || a.partido.localeCompare(b.partido)).slice(0, 15);
  const cargoTxt = CARGO_COD[LEG5.cargo].toLowerCase().replace(/^deputado/, "deputados").replace(/^vereador$/, "vereadores");
  const disputa = LEG5.cargo === 13 ? "cada município" : "cada estado";
  // se não houver sozinhos no recorte, a lista começa nos mais dependentes
  if (LEG5.lista === "sozinhos" && !sozinhos) LEG5.lista = "dependentes";

  el.innerHTML = `
    <div class="fin-bloco">
      <h3>${LEG5.ano}: ${fmt.format(atual.eleitos)} ${cargoTxt} eleitos</h3>
      <div class="leg5-cards">
        <div class="leg5-card leg5-sozinho">
          <b class="num">${fmt.format(sozinhos)}</b>
          <span>se elegeram <strong>sozinhos</strong></span>
          <small>${pctSeguro(sozinhos, atual.eleitos)} dos eleitos: os próprios votos bastavam para a cadeira</small>
        </div>
        <div class="leg5-card leg5-dependente">
          <b class="num">${fmt.format(atual.abaixoQe)}</b>
          <span><strong>dependeram</strong> dos votos do partido</span>
          <small>${pctSeguro(atual.abaixoQe, atual.eleitos)} dos eleitos: sozinhos, não teriam a cadeira</small>
        </div>
      </div>
      <h4>Quanto do quociente cada eleito alcançou com os próprios votos</h4>
      <div class="leg5-pilha" role="img" aria-label="Distribuição dos eleitos por fração do quociente alcançada">
        ${faixas.map((n, k) => n ? `<i class="leg5-${FAIXAS_QE[k].cls}" style="width:${(n / atual.eleitos * 100).toFixed(2)}%" title="${FAIXAS_QE[k].rotulo}: ${fmt.format(n)} eleitos"></i>` : "").join("")}
      </div>
      <ul class="leg5-faixas">
        ${faixas.map((n, k) => `<li><i class="leg5-${FAIXAS_QE[k].cls}"></i><span>${FAIXAS_QE[k].rotulo}</span><span class="num">${fmt.format(n)}</span><span class="num dim">${pctSeguro(n, atual.eleitos)}</span></li>`).join("")}
      </ul>
      <p class="aviso-mini">Além disso, ${fmt.format(atual.abaixoLegenda)} eleitos (${pctSeguro(atual.abaixoLegenda, atual.eleitos)}) tiveram menos votos próprios que os votos de legenda do próprio partido na disputa.</p>
      <h4>Dependeram do partido, eleição a eleição</h4>
      ${serie.map(r => `<div class="hb leg5-ano${r.ano===LEG5.ano ? " on" : ""}" data-a="${r.ano}" role="button" tabindex="0" title="Ver ${r.ano}: ${fmt.format(r.abaixoQe)} de ${fmt.format(r.eleitos)}"><span>${r.ano}</span><i class="t" style="width:${r.eleitos ? (r.abaixoQe / r.eleitos * 100).toFixed(1) : 0}%"></i><span class="v">${pctSeguro(r.abaixoQe, r.eleitos)}</span></div>`).join("")}
    </div>
    <div class="fin-bloco">
      <h3>Por partido</h3>
      <div class="tabw"><table class="tab"><thead><tr><th>Partido</th><th class="v">Eleitos</th><th class="v">Sozinhos</th><th class="v">Dependeram</th><th class="v">Abaixo da legenda</th></tr></thead><tbody>
        ${partidos.map(r => `<tr class="leg5-partido${LEG5.partido===r.partido ? " on" : ""}" data-p="${esc(r.partido)}" title="Ver quem são">
          <td><span class="chip" style="background:${corP(r.partido)}">${esc(r.partido)}</span></td>
          <td class="v num">${fmt.format(r.eleitos)}</td>
          <td class="v num">${r.sozinhos ? `<b>${fmt.format(r.sozinhos)}</b>` : `<span class="dim">0</span>`}</td>
          <td class="v num">${fmt.format(r.abaixoQe)} <small>${pctSeguro(r.abaixoQe, r.eleitos)}</small></td>
          <td class="v num">${fmt.format(r.abaixoLegenda)}</td></tr>`).join("")}
      </tbody></table></div>
      <p class="aviso-mini">Clique num partido para ver só os eleitos dele nas listas abaixo.</p>
      <h4>Quem são${LEG5.partido ? ` · <span class="chip" style="background:${corP(LEG5.partido)}">${esc(LEG5.partido)}</span> <button class="link" data-limpar="1">ver todos</button>` : ""}</h4>
      <div class="cargos" role="group" aria-label="Lista de eleitos">
        <button data-lista="sozinhos" aria-pressed="${LEG5.lista === "sozinhos"}">Se elegeram sozinhos</button>
        <button data-lista="dependentes" aria-pressed="${LEG5.lista === "dependentes"}">Mais dependentes do partido</button>
      </div>
      <div id="leg5-exemplo"></div>
      <div id="leg5-quem"><p class="aviso-mini">Carregando…</p></div>
    </div>`;
  el.querySelectorAll(".leg5-ano").forEach(d => {
    const ir = () => { LEG5.ano = +d.dataset.a; LEG5.partido = null; aplicarLegendaPartido(); };
    d.onclick = ir; d.onkeydown = ev => { if (ev.key === "Enter" || ev.key === " "){ ev.preventDefault(); ir(); } };
  });
  el.querySelectorAll(".leg5-partido").forEach(tr => tr.onclick = () => { LEG5.partido = LEG5.partido === tr.dataset.p ? null : tr.dataset.p; aplicarLegendaPartido(); });
  el.querySelectorAll("[data-lista]").forEach(b => b.onclick = () => { LEG5.lista = b.dataset.lista; aplicarLegendaPartido(); });
  const limpar = el.querySelector("[data-limpar]"); if (limpar) limpar.onclick = () => { LEG5.partido = null; aplicarLegendaPartido(); };
  quemLegendaPartido(disputa);
}

// Exemplo concreto do quociente, com o primeiro nome da lista aberta.
function exemploQuociente(r){
  const lugar = LEG5.cargo === 13 ? titulo(r.nm_municipio || "") : (GEO[r.uf]?.properties.nome || r.uf);
  const quem = `<b>${esc(titulo(r.nm_urna_candidato))}</b> (${esc(r.sg_partido)})`;
  const conta = `${fmt.format(r.votos_validos_disputa)} votos válidos ÷ ${fmt.format(r.vagas)} cadeiras = quociente de <b>${fmt.format(r.quociente_eleitoral)}</b> votos`;
  const fim = Number(r.pct_do_quociente) >= 100
    ? `${quem} teve ${fmt.format(r.votos_nominais)} votos, ${pctNum(r.pct_do_quociente)} do quociente: se elegeria mesmo sem os votos do partido.`
    : `${quem} teve ${fmt.format(r.votos_nominais)} votos, só ${pctNum(r.pct_do_quociente)} do quociente: sem os votos de legenda e dos colegas de partido, não teria a cadeira.`;
  return `<p class="leg5-exemplo"><span>Como ler:</span> em ${esc(lugar)}, ${LEG5.ano}: ${conta}. ${fim}</p>`;
}

async function quemLegendaPartido(disputa){
  const alvo = document.getElementById("leg5-quem"), exemplo = document.getElementById("leg5-exemplo");
  if (!alvo) return;
  const marca = [UF, LEG5.cargo, LEG5.ano, LEG5.partido, LEG5.lista].join("|");
  const q = new URLSearchParams({ cargo: LEG5.cargo, ano: LEG5.ano, grupo: LEG5.lista });
  if (UF) q.set("uf", UF);
  if (LEG5.partido) q.set("partido", LEG5.partido);
  try {
    const d = await request(`/api/legenda/pessoas?${q}`, { silencioso: true });
    if (!alvo.isConnected || [UF, LEG5.cargo, LEG5.ano, LEG5.partido, LEG5.lista].join("|") !== marca) return;
    const sozinhos = LEG5.lista === "sozinhos";
    if (!d.pessoas.length){
      exemplo.innerHTML = "";
      alvo.innerHTML = `<p class="aviso-mini">${sozinhos ? "Ninguém se elegeu sozinho neste recorte: todos dependeram dos votos do partido." : "Ninguém se elegeu abaixo do quociente neste recorte."}</p>`;
      return;
    }
    exemplo.innerHTML = exemploQuociente(d.pessoas[0]);
    const local = LEG5.cargo === 13 ? "Município" : "UF";
    // dez por vez, como as outras listas "quem são" da página
    let mostrar = 10;
    const desenhar = () => {
      alvo.innerHTML = `<div class="tabw"><table class="tab"><thead><tr><th>Eleito</th><th>Partido</th><th>${local}</th><th class="v">Votos</th><th class="v">Quociente</th><th class="v">Alcançou</th></tr></thead><tbody>
        ${d.pessoas.slice(0, mostrar).map(r => `<tr>
          <td><button class="link" data-cand="${r.id_pessoa_projeto}">${esc(titulo(r.nm_urna_candidato))}</button>${r.eleito_abaixo_legenda ? ` <small class="dim" title="Menos votos próprios que a legenda do partido">· abaixo da legenda</small>` : ""}</td>
          <td><span class="chip" style="background:${corP(r.sg_partido)}">${esc(r.sg_partido)}</span></td>
          <td>${esc(LEG5.cargo === 13 ? titulo(r.nm_municipio || "") : r.uf)}</td>
          <td class="v num">${fmt.format(r.votos_nominais)}</td>
          <td class="v num dim">${fmt.format(r.quociente_eleitoral)}</td>
          <td class="v num"><span class="leg5-alcance"><i style="width:${Math.min(100, Number(r.pct_do_quociente)).toFixed(1)}%"></i></span>${pctNum(r.pct_do_quociente)}</td></tr>`).join("")}
        </tbody></table></div>
        ${mostrar < d.pessoas.length ? `<p><button class="link" data-mais="1">Mostrar mais</button></p>` : ""}
        <p class="aviso-mini">${sozinhos
          ? `Eleitos com mais votos próprios em relação ao quociente de ${disputa}${UF ? "" : " da amostra"} (até 40).`
          : `Eleitos com a menor fração do quociente de ${disputa}${UF ? "" : " da amostra"} (até 40).`} "Alcançou" = votos próprios ÷ quociente.</p>`;
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
  resumo: "Quantos vereadores e deputados se elegeram sozinhos e quantos dependeram dos votos do partido.",
  montar(el) {
    el.innerHTML = `<p class="nota">Em vereador e deputado, as cadeiras vão primeiro para os partidos, pela soma dos votos dos seus candidatos com os votos de legenda (dados só ao número do partido); dentro de cada partido, ficam com os mais votados. O <b>quociente eleitoral</b> é o total de votos válidos da disputa dividido pelo número de cadeiras: é o "preço" de uma cadeira. Quem teve votos próprios iguais ou acima dele <b>se elegeu sozinho</b>; quem ficou abaixo <b>dependeu dos votos do partido</b>. Votos do 1º turno; até 2018 os partidos podiam se coligar e a cadeira era da coligação. <span id="leg5-origem"></span></p>
<div class="cargos" id="leg5-cargos" role="group" aria-label="Cargo da seção de votos de legenda"></div>
<div class="cargos" id="leg5-anos" role="group" aria-label="Eleição da seção de votos de legenda"></div>
<div class="fin-grid" id="leg5-conteudo"></div>`;
    montarLegendaPartido();
  },
};
