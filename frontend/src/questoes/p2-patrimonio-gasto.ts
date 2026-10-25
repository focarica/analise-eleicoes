// @ts-nocheck
// Questão 2: patrimônio declarado e gasto de campanha × sucesso eleitoral.
// Edite só este arquivo (e o .css ao lado).
import { fmt, brl, brlc, titulo, cargoNome, esc, ordemCargo, request } from "../util";
import { UF, ANO } from "../presentation";
import "./p2-patrimonio-gasto.css";

function montarPatrimonio(linhas){
  const el = document.getElementById("patrimonio-quartis");
  if (!linhas || !linhas.length) { el.innerHTML = `<p class="nota">Sem dados de património na base para ${ANO}.</p>`; return; }
  const porCargo = d3.group(linhas, r=>r.ds_cargo);
  const cargos = [...porCargo.keys()].sort((a,b)=>ordemCargo(a)-ordemCargo(b));
  
  el.innerHTML = cargos.map(c => {
    const rows = porCargo.get(c);
    const n = d3.sum(rows, q=>+q.qtd_candidatos_na_faixa), el_ = d3.sum(rows, q=>+q.qtd_eleitos);
    const faixas = [0,1,2,3,4].map(k => rows.find(q=>+q.quartil_patrimonio===k) || { quartil_patrimonio:k, vazia:true, teto_faixa_valor: 0, piso_faixa_valor: 0 });
    
    return `<div class="qc">
      <h3>${cargoNome(c)}</h3>
      <p class="nota" style="margin:-.4rem 0 0">${fmt.format(n)} candidatos, ${fmt.format(el_)} eleitos</p>
      
      <div class="barras" style="display: flex !important; justify-content: space-between !important; width: 100% !important;">
        ${faixas.map(q => q.vazia
          ? `<div class="b vazia" style="flex: 1 1 19% !important; max-width: 19% !important; min-width: 0 !important; margin: 0 !important;" title="Nenhum candidato nesta faixa"><span>–</span></div>`
          : `<div class="b" style="flex: 1 1 19% !important; max-width: 19% !important; min-width: 0 !important; margin: 0 !important; height:${Math.max(2,+q.taxa_sucesso_pct)}%" title="${q.qtd_eleitos} de ${q.qtd_candidatos_na_faixa} eleitos; bens de ${brl(+q.piso_faixa_valor)} a ${brl(+q.teto_faixa_valor)}"><span>${(+q.taxa_sucesso_pct).toLocaleString("pt-BR",{maximumFractionDigits:0})}%</span></div>`
        ).join("")}
      </div>
      
      <div class="eixo num" style="display: flex !important; justify-content: space-between !important; text-align: center; width: 100% !important;">
        ${faixas.map(q=>`<span style="flex: 1 1 19% !important; max-width: 19% !important; min-width: 0 !important; font-size: 9.5px; line-height: 1.1; padding-top: 4px; word-break: break-word;">
          ${+q.quartil_patrimonio===0 ? "Sem bens" : `até<br>${brlc(+q.teto_faixa_valor).replace(/\s/g, '&nbsp;')}`}<br>
          <em style="font-size: 8.5px; color:var(--ink-3);">${q.vazia ? "ninguém" : fmt.format(+q.qtd_candidatos_na_faixa) + "&nbsp;cand."}</em>
        </span>`).join("")}
      </div>
    </div>`;
  }).join("");
}

function montarQuartis(linhas){
  const el = document.getElementById("quartis");
  const porCargo = d3.group(linhas, r=>r.ds_cargo);
  const cargos = [...porCargo.keys()].sort((a,b)=>ordemCargo(a)-ordemCargo(b));
  if (!cargos.length){ el.innerHTML = `<p class="nota">Sem candidatos com prestação de contas na base para ${ANO}.</p>`; return; }
  el.innerHTML = cargos.map(c => {
    const rows = porCargo.get(c);
    const n = d3.sum(rows, q=>+q.qtd_candidatos_na_faixa), el_ = d3.sum(rows, q=>+q.qtd_eleitos);
    // as faixas têm o mesmo tamanho em reais; o limite de cada uma vem da maior faixa do cargo
    const topo = d3.max(rows, q=>+q.limite_superior_faixa) || 0;
    const faixas = [1,2,3,4].map(k => rows.find(q=>+q.faixa_financeira===k) || { faixa_financeira:k, vazia:true, limite_superior_faixa: topo*k/4 });
    // média geral de eleitos e não eleitos, recomposta a partir das médias de cada faixa
    const pond = (campo, qtd) => { const v = rows.filter(q=>q[campo]!=null); const w = d3.sum(v, qtd); return w ? d3.sum(v, q=>+q[campo]*qtd(q))/w : null; };
    const mEl = pond("media_gasto_eleitos", q=>+q.qtd_eleitos), mNao = pond("media_gasto_nao_eleitos", q=>+q.qtd_candidatos_na_faixa - q.qtd_eleitos);
    return `<div class="qc"><h3>${cargoNome(c)}</h3><p class="nota" style="margin:-.4rem 0 0">${fmt.format(n)} ${n===1?"candidato":"candidatos"}, ${fmt.format(el_)} ${el_===1?"eleito":"eleitos"}</p>
      <div class="barras">${faixas.map(q => q.vazia
        ? `<div class="b vazia" title="Nenhum candidato nesta faixa"><span>–</span></div>`
        : `<div class="b" style="height:${Math.max(2,+q.taxa_sucesso_pct)}%" title="${q.qtd_eleitos} de ${q.qtd_candidatos_na_faixa} eleitos; gastos de ${brl(+q.piso_faixa)} a ${brl(+q.teto_faixa)}"><span>${(+q.taxa_sucesso_pct).toLocaleString("pt-BR",{maximumFractionDigits:0})}%</span></div>`).join("")}</div>
      <div class="eixo num">${faixas.map(q=>`<span>até<br>${brlc(+q.limite_superior_faixa)}<br><em>${q.vazia ? "ninguém" : fmt.format(+q.qtd_candidatos_na_faixa) + (+q.qtd_candidatos_na_faixa===1?" cand.":" cand.")}</em></span>`).join("")}</div>
      <p class="med">Gasto médio: eleitos <b>${brlc(mEl)}</b>, não eleitos <b>${brlc(mNao)}</b></p></div>`;
  }).join("");
}

// estado e ano escolhidos no painel; dados de /api/q2-patrimonio e /api/q2-despesas
let pedidoP2 = 0;
export default {
  id: "p2", numero: "P2",
  titulo: "Patrimônio e gasto de campanha × sucesso",
  pergunta: "Qual a taxa de sucesso eleitoral por patrimônio declarado?",
  resumo: "Taxa de eleição por faixa de bens declarados e por faixa de gasto de campanha, por cargo.",
  usaAno: true,
  async montar(el) {
    el.innerHTML = `<h3 class="q-sub">Ter mais bens declarados ajuda a se eleger?</h3>
<p class="nota">Candidatos divididos em faixas de patrimônio. A primeira faixa concentra quem declarou R$ 0. Os demais foram divididos em quatro faixas (quartis) contendo o mesmo número de candidatos, do menor ao maior patrimônio declarado.</p>
<div class="quartis" id="patrimonio-quartis"></div>
<h3 class="q-sub">Quem gasta mais se elege mais?</h3>
<p class="nota">Candidatos que prestaram contas, em quatro faixas de despesa paga do mesmo tamanho em reais, de R$ 0 até o maior gasto de cada cargo. A barra mostra a parcela de eleitos em cada faixa; abaixo dela, o limite da faixa e quantos candidatos caíram nela.</p>
<div class="quartis" id="quartis"></div>`;
    const pat = el.querySelector("#patrimonio-quartis"), gasto = el.querySelector("#quartis");
    if (!UF) {
      pat.innerHTML = `<p class="aviso-mini">Escolha um estado da amostra para ver o patrimônio.</p>`;
      gasto.innerHTML = `<p class="aviso-mini">Escolha um estado da amostra para ver as faixas de gasto por cargo daquele ano.</p>`;
      return;
    }
    pat.innerHTML = gasto.innerHTML = `<p class="aviso-mini">Carregando…</p>`;
    const pedido = ++pedidoP2;
    const q = `uf=${encodeURIComponent(UF)}&ano=${ANO}`;
    const carregar = async (url, alvo, montar) => {
      try {
        const d = await request(url, { silencioso: true });
        if (pedido === pedidoP2 && alvo.isConnected) montar(d.dados);
      } catch (e) {
        if (pedido === pedidoP2 && alvo.isConnected) alvo.innerHTML = `<p class="aviso-mini">Não foi possível carregar: ${esc(e.message)}</p>`;
      }
    };
    await Promise.all([
      carregar(`/api/q2-patrimonio?${q}`, pat, montarPatrimonio),
      carregar(`/api/q2-despesas?${q}`, gasto, montarQuartis),
    ]);
  },
};
