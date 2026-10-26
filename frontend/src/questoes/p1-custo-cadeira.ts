// @ts-nocheck
// Questão 1: quanto custa uma cadeira? Edite só este arquivo (e o .css ao lado).
import { fmt, brlc, titulo, cargoNome, esc, request } from "../util";
import { UF, ANO } from "../presentation";
import "./p1-custo-cadeira.css";

// filtro escolhido pelo usuário: "eleitos" ou "todos"
let modoCalculo = "eleitos";

function montarCustoCadeira(linhas) {
  const el = document.getElementById("custo-cadeira");
  if (!linhas || !linhas.length) { 
    el.innerHTML = `<p class="nota">Sem dados de despesas na base para ${ANO}.</p>`; 
    return; 
  }

  // o modo escolhido fica guardado no módulo (modoCalculo, abaixo): continua o mesmo
  // ao trocar de estado ou de ano, para comparar

  const renderizarGrafico = () => {
    // Processa os dados calculando o custo médio da cadeira com base no modo
    const dadosProcessados = linhas.map(r => {
      const vagas = +r.qt_eleitos || 1; // Evita divisão por zero
      const eleitosComDespesa = +r.qt_eleitos_com_despesa || 1;
      
      const custoEleitos = (+r.vr_despesas_eleitos || 0) / eleitosComDespesa;
      const custoTodos = (+r.vr_despesas_total || 0) / vagas;
      
      const valorExibido = modoCalculo === "eleitos" ? custoEleitos : custoTodos;
      
      return { 
        cargo: r.ds_cargo, 
        valorExibido, 
        vagas, 
        candComDespesa: modoCalculo === "eleitos" ? r.qt_eleitos_com_despesa : r.qt_com_despesa
      };
    }).sort((a, b) => b.valorExibido - a.valorExibido); // Ordena do cargo mais caro para o mais barato

    const maiorCusto = d3.max(dadosProcessados, d => d.valorExibido) || 1;

    el.innerHTML = `
      <div class="cargos" role="group" aria-label="Modo de cálculo do custo" style="margin-bottom: 12px;">
        <button data-modo="eleitos" aria-pressed="${modoCalculo === 'eleitos'}">Apenas despesas dos eleitos</button>
        <button data-modo="todos" aria-pressed="${modoCalculo === 'todos'}">Despesas de todos os candidatos</button>
      </div>
      
      <p class="aviso-mini" style="margin-bottom: 24px;">
        ${modoCalculo === 'eleitos' 
          ? "Cálculo: soma das despesas declaradas pelos <b>candidatos eleitos</b> dividida pelo número de cadeiras." 
          : "Cálculo: soma das despesas de <b>todos os candidatos (eleitos e não eleitos)</b> dividida pelo número de cadeiras."}
      </p>

      <div class="fin-grid" style="display: flex; flex-direction: column; gap: 16px;">
        ${dadosProcessados.map(d => `
          <div class="hb" style="display: flex; align-items: center; width: 100%;">
            <span style="font-weight: 600; width: 140px; flex-shrink: 0;">${cargoNome(d.cargo)}</span>
            <div style="flex-grow: 1; background: var(--bg-escuro); height: 16px; margin: 0 16px; position: relative;">
              <i style="position: absolute; top: 0; left: 0; height: 100%; width: ${(d.valorExibido / maiorCusto) * 100}%; background: var(--ink);"></i>
            </div>
            <div style="display: flex; flex-direction: column; align-items: flex-end; width: 130px; flex-shrink: 0;">
              <span class="v num" style="font-size: 15px; font-weight: 700;">${brlc(d.valorExibido)}</span>
              <span style="font-size: 10px; color: var(--ink-3);">em ${fmt.format(d.candComDespesa)} prest. contas</span>
            </div>
          </div>
        `).join("")}
      </div>
    `;

    // Adiciona interatividade aos botões
    el.querySelectorAll("button[data-modo]").forEach(btn => {
      btn.onclick = () => {
        modoCalculo = btn.dataset.modo;
        renderizarGrafico(); // Recarrega apenas este componente ao clicar
      };
    });
  };

  renderizarGrafico();
}

// estado e ano escolhidos no painel; a resposta chega de /api/q1-custo-cadeira
let pedidoP1 = 0;
export default {
  id: "p1", numero: "P1",
  titulo: "Qual o custo de uma cadeira?",
  pergunta: "Quanto custa uma cadeira?",
  resumo: "Despesas de campanha divididas pelas cadeiras conquistadas, por cargo.",
  usaAno: true,
  async montar(el) {
    if (UF && !ANO) { el.innerHTML = `<p class="aviso-mini">Escolha um ano acima para ver o custo por cadeira.</p>`; return; }
    el.innerHTML = `<p class="nota">Relação entre as despesas de campanha e as cadeiras conquistadas por cargo.</p>
<div id="custo-cadeira"></div>`;
    const alvo = el.querySelector("#custo-cadeira");
    if (!UF) { alvo.innerHTML = `<p class="aviso-mini">Escolha um estado da amostra para ver o custo por cadeira.</p>`; return; }
    alvo.innerHTML = `<p class="aviso-mini">Carregando…</p>`;
    const pedido = ++pedidoP1;
    try {
      const d = await request(`/api/q1-custo-cadeira?uf=${encodeURIComponent(UF)}&ano=${ANO}`, { silencioso: true });
      if (pedido === pedidoP1 && alvo.isConnected) montarCustoCadeira(d.dados);
    } catch (e) {
      if (pedido === pedidoP1 && alvo.isConnected) alvo.innerHTML = `<p class="aviso-mini">Não foi possível carregar: ${esc(e.message)}</p>`;
    }
  },
};
