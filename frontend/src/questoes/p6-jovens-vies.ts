// @ts-nocheck
// P6 — jovens (18–29 anos) × não jovens × viés político: o eleitorado do
// município (ou da UF, nas eleições gerais) comparado com a idade e o viés dos
// candidatos e eleitos, 2018–2024. Edite só este arquivo (e o .css ao lado).
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

let pedido = 0;
let anoSel = 2024, cargoSel = "";   // preservados entre trocas de estado

const div = (a, b) => b > 0 ? a / b : null;
const pct = v => v == null ? "–" : `${(100 * v).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const vies = v => v == null ? "–" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const anos = v => v == null ? "–" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} anos`;
const ladoVies = v => v == null ? "" : v < 0 ? "q6-esq" : v > 0 ? "q6-dir" : "";

// Soma linhas da API (já são somas e contagens) e deriva as razões.
function somar(linhas) {
  const s = Object.fromEntries(CAMPOS.map(c => [c, 0]));
  for (const r of linhas) for (const c of CAMPOS) s[c] += Number(r[c] || 0);
  return s;
}
function indicadores(s, e29 = null, e18 = null) {
  const naoJovensCand = s.cand_com_idade - s.cand_jovens;
  return {
    ...s,
    eleitores_18_29: e29, eleitores_18_mais: e18,
    pEleitorado: div(e29, e18),
    pCand: div(s.cand_jovens, s.cand_com_idade),
    pEleitos: div(s.eleitos_jovens, s.eleitos_com_idade),
    txJovens: div(s.eleitos_jovens, s.cand_jovens),
    txNaoJovens: div(s.eleitos_com_idade - s.eleitos_jovens, naoJovensCand),
    idadeCand: div(s.soma_idade_cand, s.cand_com_idade),
    idadeEleitos: div(s.soma_idade_eleitos, s.eleitos_com_idade),
    viesJ: div(s.vies_soma_jovens, s.vies_n_jovens),
    viesNJ: div(s.vies_soma_nao_jovens, s.vies_n_nao_jovens),
    viesEJ: div(s.vies_soma_eleitos_jovens, s.vies_n_eleitos_jovens),
    viesENJ: div(s.vies_soma_eleitos_nao_jovens, s.vies_n_eleitos_nao_jovens),
    esqJ: div(s.esq_jovens, s.vies_n_jovens), dirJ: div(s.dir_jovens, s.vies_n_jovens),
    esqNJ: div(s.esq_nao_jovens, s.vies_n_nao_jovens), dirNJ: div(s.dir_nao_jovens, s.vies_n_nao_jovens),
  };
}

// Régua −100..+100 com os pontos dos jovens e dos não jovens.
function reguaVies(itens, rotulo) {
  const W = 640, L = 40, R = 40, x = v => L + (v + 100) / 200 * (W - L - R);
  const validos = itens.filter(i => i.v != null);
  if (!validos.length) return `<p class="aviso-mini">${esc(rotulo)}: sem partidos com nota no survey.</p>`;
  const desc = `${rotulo}: ` + validos.map(i => `${i.nome} ${vies(i.v)}`).join("; ");
  return `<figure class="q6-regua"><figcaption>${esc(rotulo)}</figcaption>
    <svg viewBox="0 0 ${W} 78" role="img" aria-label="${esc(desc)}">
      <rect class="q6-regua-faixa" x="${L}" y="34" width="${W - L - R}" height="10" rx="5"/>
      <line class="q6-regua-zero" x1="${x(0)}" x2="${x(0)}" y1="26" y2="52"/>
      <text class="q6-regua-eixo" x="${L}" y="70" text-anchor="start">−100 esquerda</text>
      <text class="q6-regua-eixo" x="${x(0)}" y="70" text-anchor="middle">centro</text>
      <text class="q6-regua-eixo" x="${W - R}" y="70" text-anchor="end">direita +100</text>
      ${validos.map(i => {
        // rótulos próximos: o ponto mais à esquerda alinha o texto pela direita e vice-versa
        const outro = validos.find(o => o !== i);
        const perto = outro && Math.abs(x(outro.v) - x(i.v)) < 130;
        const primeiro = i.v < outro?.v || (i.v === outro?.v && validos[0] === i);
        const ancora = perto ? (primeiro ? "end" : "start") : "middle";
        // perto: os dois textos partem do ponto médio, com um respiro entre eles
        const meio = perto ? (x(i.v) + x(outro.v)) / 2 : x(i.v);
        const tx = perto ? meio + (ancora === "end" ? -8 : 8) : meio;
        return `<g class="q6-pt ${i.cls}"><circle cx="${x(i.v)}" cy="39" r="7"/><text x="${tx}" y="20" text-anchor="${ancora}">${esc(i.nome)} ${vies(i.v)}</text></g>`;
      }).join("")}
    </svg></figure>`;
}

// Barra 100% esquerda / direita (o resto é partido sem nota ou exatamente no centro).
function barraLado(nome, esq, dir) {
  if (esq == null) return "";
  const resto = Math.max(0, 1 - esq - dir);
  return `<div class="q6-lado"><span class="q6-lado-nome">${esc(nome)}</span>
    <div class="q6-lado-barra" role="img" aria-label="${esc(nome)}: ${pct(esq)} à esquerda, ${pct(dir)} à direita">
      <i class="q6-esq-bg" style="width:${100 * esq}%"></i><i class="q6-centro-bg" style="width:${100 * resto}%"></i><i class="q6-dir-bg" style="width:${100 * dir}%"></i>
    </div><span class="q6-lado-num"><b class="q6-esq">${pct(esq)}</b> · <b class="q6-dir">${pct(dir)}</b></span></div>`;
}

export default {
  id: "p6", numero: "P6",
  titulo: "Jovens, não jovens e viés político",
  pergunta: "Jovens × não jovens × viés político (população do município × idade do candidato)",
  resumo: "Quantos candidatos e eleitos têm de 18 a 29 anos, comparado ao eleitorado jovem do município, e se os jovens concorrem por partidos mais à esquerda ou à direita, 2018–2024.",
  async montar(el) {
    el.innerHTML = `<p class="nota"><b>Jovem = 18 a 29 anos</b> (Estatuto da Juventude, a partir da idade mínima para se candidatar). A idade do candidato é calculada pela data de nascimento na data do 1º turno; a do eleitorado vem das faixas etárias do cadastro do TSE (base: eleitores de 18 anos ou mais). O viés é o do partido da candidatura naquela eleição (P7), de −100 (esquerda) a +100 (direita); partido sem nota fica fora das médias.</p>
      <p class="nota">Nas eleições municipais (2020, 2024) a comparação é por município (prefeito e vereador). Nas gerais (2018, 2022) os candidatos disputam o estado inteiro, então a comparação é por UF (governador, senador e deputados). Os dois tipos de eleição têm universos diferentes.</p>
      <div class="q6-controles">
        <label>Eleição<select id="q6-ano">${ANOS.map(a => `<option value="${a}" ${a === anoSel ? "selected" : ""}>${a} · ${MUNICIPAL.has(a) ? "municipal" : "geral"}</option>`).join("")}</select></label>
        <div class="q6-chips" id="q6-cargos" role="group" aria-label="Cargo"></div>
      </div>
      <p class="aviso-mini" id="q6-origem"></p><div id="q6-conteudo"><p class="aviso-mini">Carregando…</p></div>`;
    const selAno = el.querySelector("#q6-ano"), chips = el.querySelector("#q6-cargos"), conteudo = el.querySelector("#q6-conteudo");
    const nomeUf = UF ? GEO[UF]?.properties?.nome : null;
    el.querySelector("#q6-origem").textContent = UF ? `Estado de ${nomeUf}.` : "Amostra inteira dos seis estados.";
    let resp = null;

    const desenharChips = () => {
      const tipo = MUNICIPAL.has(anoSel) ? "municipal" : "geral";
      const disponiveis = CARGOS_TIPO[tipo].filter(c => resp?.unidades?.some(u => +u.cd_cargo === c));
      if (cargoSel && !disponiveis.includes(+cargoSel)) cargoSel = "";
      chips.innerHTML = [["", "Todos os cargos"], ...disponiveis.map(c => [String(c), CARGO_COD[c]])]
        .map(([v, n]) => `<button type="button" data-cargo="${v}" aria-pressed="${String(cargoSel) === v}">${esc(n)}</button>`).join("");
      chips.querySelectorAll("button").forEach(b => b.onclick = () => { cargoSel = b.dataset.cargo; desenharChips(); desenhar(); });
    };

    const carregar = async () => {
      const chave = ++pedido;
      conteudo.innerHTML = `<p class="aviso-mini">Carregando…</p>`;
      const q = new URLSearchParams({ ano: String(anoSel) }); if (UF) q.set("uf", UF);
      try {
        const r = await request(`/api/q6-jovens-vies?${q}`, { silencioso: true });
        if (chave !== pedido || !conteudo.isConnected) return;
        resp = r; desenharChips(); desenhar();
      } catch (e) {
        if (chave === pedido && conteudo.isConnected) conteudo.innerHTML = `<p class="aviso-mini">Não foi possível carregar: ${esc(e.message)}</p>`;
      }
    };

    const desenhar = () => {
      const municipal = MUNICIPAL.has(anoSel);
      const doCargo = r => !cargoSel || +r.cd_cargo === +cargoSel;
      const linhas = (resp.unidades || []).filter(doCargo);
      if (!linhas.length) { conteudo.innerHTML = `<p class="aviso-mini">Sem candidaturas para ${anoSel} neste recorte.</p>`; return; }

      // Agrupa por unidade (município ou UF); o eleitorado é o mesmo em todos os cargos da unidade.
      const porUnidade = d3.groups(linhas, r => r.cd_municipio_tse || r.sg_uf).map(([chave, rs]) => ({
        chave, nome: municipal ? titulo(rs[0].nm_municipio) : (GEO[rs[0].sg_uf]?.properties?.nome || rs[0].sg_uf), uf: rs[0].sg_uf,
        ...indicadores(somar(rs), Number(rs[0].eleitores_18_29 ?? 0) || null, Number(rs[0].eleitores_18_mais ?? 0) || null),
      }));
      const e29 = d3.sum(porUnidade, u => u.eleitores_18_29 || 0), e18 = d3.sum(porUnidade, u => u.eleitores_18_mais || 0);
      const tot = indicadores(somar(linhas), e29, e18);

      // Série dos quatro anos para o mesmo recorte (cargo só filtra o tipo de eleição dele).
      const serie = ANOS.map(a => {
        const rs = (resp.serie || []).filter(r => +r.ano_eleicao === a && doCargoSerie(r, a));
        const ele = (resp.eleitorado || []).find(r => +r.ano_eleicao === a);
        return { ano: a, ...indicadores(somar(rs), Number(ele?.eleitores_18_29) || null, Number(ele?.eleitores_18_mais) || null), vazio: !rs.length };
      });
      function doCargoSerie(r, a) {
        if (!cargoSel) return true;
        const tipoSel = CARGOS_TIPO.municipal.includes(+cargoSel) ? "municipal" : "geral";
        const tipoAno = MUNICIPAL.has(a) ? "municipal" : "geral";
        return tipoSel !== tipoAno || +r.cd_cargo === +cargoSel;
      }

      // Municípios em quatro grupos pela proporção de jovens no eleitorado.
      let grupos = "";
      if (municipal) {
        const ord = porUnidade.filter(u => u.pEleitorado != null).sort((a, b) => a.pEleitorado - b.pEleitorado);
        const gs = Array.from({ length: 4 }, () => []);
        ord.forEach((u, i) => gs[Math.min(3, Math.floor(i * 4 / Math.max(1, ord.length)))].push(u));
        const agg = gs.map(g => {
          const s = indicadores(somar(g), d3.sum(g, u => u.eleitores_18_29), d3.sum(g, u => u.eleitores_18_mais));
          return { ...s, n: g.length, min: g[0]?.pEleitorado, max: g[g.length - 1]?.pEleitorado };
        });
        grupos = `<h3>Município mais jovem tem mais candidatos jovens?</h3>
          <p class="aviso-mini">Municípios ordenados pela proporção de eleitores de 18 a 29 anos e divididos em quatro grupos de tamanho semelhante. Cada grupo soma seus candidatos (não é média de médias).</p>
          <div class="q6-grupos">${agg.map((g, i) => `<article class="q6-grupo"><small>${i === 0 ? "Eleitorado mais velho" : i === 3 ? "Eleitorado mais jovem" : "Intermediário"} · ${fmt.format(g.n)} municípios</small>
            <span class="q6-g-faixa">${pct(g.min)} a ${pct(g.max)} de jovens no eleitorado</span>
            <dl><dt>Candidatos jovens</dt><dd>${pct(g.pCand)}</dd><dt>Eleitos jovens</dt><dd>${pct(g.pEleitos)}</dd>
            <dt>Viés jovens</dt><dd class="${ladoVies(g.viesJ)}">${vies(g.viesJ)}</dd><dt>Viés não jovens</dt><dd class="${ladoVies(g.viesNJ)}">${vies(g.viesNJ)}</dd></dl></article>`).join("")}</div>`;
      }

      const unidadesOrd = porUnidade.slice().sort((a, b) => (b.pEleitorado ?? -1) - (a.pEleitorado ?? -1));
      const cabUnidade = municipal ? `Município${nomeUf ? "" : " · UF"}` : "Estado";

      conteudo.innerHTML = `<div class="q6-resumo">
          <div class="q6-card"><small>Eleitorado de 18 a 29 anos</small><b>${pct(tot.pEleitorado)}</b><small>${fmt.format(e29)} de ${fmt.format(e18)} eleitores 18+</small></div>
          <div class="q6-card"><small>Candidatos de 18 a 29 anos</small><b>${pct(tot.pCand)}</b><small>${fmt.format(tot.cand_jovens)} de ${fmt.format(tot.cand_com_idade)} com nascimento · idade média ${anos(tot.idadeCand)}</small></div>
          <div class="q6-card"><small>Eleitos de 18 a 29 anos</small><b>${pct(tot.pEleitos)}</b><small>${fmt.format(tot.eleitos_jovens)} de ${fmt.format(tot.eleitos_com_idade)} · idade média ${anos(tot.idadeEleitos)}</small></div>
          <div class="q6-card"><small>Taxa de eleição</small><b>${pct(tot.txJovens)} <span class="q6-vs">× ${pct(tot.txNaoJovens)}</span></b><small>jovens × não jovens que concorreram</small></div>
        </div>
        <h3>Viés político: jovens × não jovens</h3>
        <div class="q6-reguas">
          ${reguaVies([{ nome: "Jovens", v: tot.viesJ, cls: "q6-pt-j" }, { nome: "Não jovens", v: tot.viesNJ, cls: "q6-pt-nj" }], "Candidatos — viés médio do partido")}
          ${reguaVies([{ nome: "Jovens", v: tot.viesEJ, cls: "q6-pt-j" }, { nome: "Não jovens", v: tot.viesENJ, cls: "q6-pt-nj" }], "Eleitos — viés médio do partido")}
        </div>
        <div class="q6-lados"><p class="aviso-mini">Candidatos por partido à <b class="q6-esq">esquerda</b> (viés &lt; 0) e à <b class="q6-dir">direita</b> (viés &gt; 0), entre os que têm partido com nota.</p>
          ${barraLado("Jovens", tot.esqJ, tot.dirJ)}${barraLado("Não jovens", tot.esqNJ, tot.dirNJ)}</div>
        <h3>2018 a 2024</h3>
        <div class="q6-tabela"><table><thead><tr><th>Eleição</th><th>Eleitorado jovem</th><th>Candidatos jovens</th><th>Eleitos jovens</th><th>Viés jovens</th><th>Viés não jovens</th><th>Viés eleitos jovens</th><th>Viés eleitos não jovens</th></tr></thead><tbody>
          ${serie.map(s => `<tr${s.ano === anoSel ? ' class="q6-atual"' : ""}><td>${s.ano} · ${MUNICIPAL.has(s.ano) ? "municipal" : "geral"}</td><td>${pct(s.pEleitorado)}</td><td>${s.vazio ? "–" : pct(s.pCand)}</td><td>${s.vazio ? "–" : pct(s.pEleitos)}</td><td class="${ladoVies(s.viesJ)}">${vies(s.viesJ)}</td><td class="${ladoVies(s.viesNJ)}">${vies(s.viesNJ)}</td><td class="${ladoVies(s.viesEJ)}">${vies(s.viesEJ)}</td><td class="${ladoVies(s.viesENJ)}">${vies(s.viesENJ)}</td></tr>`).join("")}
        </tbody></table></div>
        ${cargoSel ? `<p class="aviso-mini">Com um cargo escolhido, a série usa esse cargo nos anos do mesmo tipo de eleição e todos os cargos nos demais.</p>` : ""}
        ${grupos}
        <h3>${municipal ? "Municípios" : "Estados"}</h3>
        <div class="q6-tabela"><table><thead><tr><th>${cabUnidade}</th><th>Eleitorado jovem</th><th>Candidatos</th><th>Candidatos jovens</th><th>Eleitos jovens</th><th>Viés jovens</th><th>Viés não jovens</th></tr></thead><tbody>
          ${unidadesOrd.map(u => `<tr><td>${esc(u.nome)}${municipal && !UF ? ` · ${esc(u.uf)}` : ""}</td><td>${pct(u.pEleitorado)}</td><td>${fmt.format(u.cand_total)}</td><td>${pct(u.pCand)} <small>(${fmt.format(u.cand_jovens)})</small></td><td>${pct(u.pEleitos)} <small>(${fmt.format(u.eleitos_jovens)} de ${fmt.format(u.eleitos_com_idade)})</small></td><td class="${ladoVies(u.viesJ)}">${vies(u.viesJ)}</td><td class="${ladoVies(u.viesNJ)}">${vies(u.viesNJ)}</td></tr>`).join("")}
        </tbody></table></div>
        <p class="aviso-mini">O perfil do eleitorado mede o cadastro, não quem compareceu nem em quem votou. Candidatura sem data de nascimento fica fora das proporções. Entram só candidaturas totalizadas dos cargos titulares (sem vices, suplentes de senador e presidente). Em municípios pequenos, poucos candidatos jovens fazem a proporção e o viés oscilarem muito.</p>`;
    };

    selAno.onchange = () => { anoSel = +selAno.value; carregar(); };
    await carregar();
  },
};
