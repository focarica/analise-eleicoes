// @ts-nocheck
import { fmt, brlc, titulo, cargoNome, esc, request } from "../util";
import { UF, ANO } from "../presentation";
import "./p1-custo-cadeira.css";

// Cache para não baixar o mapa de municípios várias vezes
const nomesMunicipios = new Map();

async function obterNomesMunicipios(uf) {
  if (nomesMunicipios.has(uf)) return nomesMunicipios.get(uf);
  try {
    const res = await fetch(`/geo/municipios-${uf}.json`);
    const malha = await res.json();
    const mapa = new Map();
    // Extrai os nomes a partir da geometria do TopoJSON
    malha.objects.municipios.geometries.forEach(g => {
      if (g.properties && g.properties.tse) {
        mapa.set(String(g.properties.tse), g.properties.nome);
      }
    });
    nomesMunicipios.set(uf, mapa);
    return mapa;
  } catch (e) {
    return new Map();
  }
}

function montarCustoCadeira(linhas, mapaNomes, el) {
  if (!linhas || !linhas.length) { 
    el.innerHTML = `<p class="nota">Sem dados de despesas na base para ${ANO}.</p>`; 
    return; 
  }

  let modoCalculo = "eleitos";
  let termoBusca = "";
  let limite = 20;

  // Calcula os valores base e traduz o código da cidade
  const dadosBase = linhas.map(r => {
    const vagas = +r.qt_eleitos || 1;
    const eleitosComDespesa = +r.qt_eleitos_com_despesa || 1;
    
    const custoEleitos = (+r.vr_despesas_eleitos || 0) / eleitosComDespesa;
    const custoTodos = (+r.vr_despesas_total || 0) / vagas;
    const nomeCidade = r.cd_municipio_tse ? (mapaNomes.get(String(r.cd_municipio_tse)) || r.cd_municipio_tse) : "";

    return { 
      cargo: r.ds_cargo, 
      cidade: nomeCidade,
      custoEleitos,
      custoTodos,
      vagas, 
      candComDespesaEleitos: r.qt_eleitos_com_despesa,
      candComDespesaTodos: r.qt_com_despesa
    };
  });

  const ehMunicipal = dadosBase.some(d => d.cidade);

  const renderizarGrafico = () => {
    let dadosFiltrados = dadosBase;
    
    if (termoBusca.trim().length > 0) {
      const t = termoBusca.toLowerCase().trim();
      dadosFiltrados = dadosBase.filter(d => 
        d.cidade.toLowerCase().includes(t) || d.cargo.toLowerCase().includes(t)
      );
    }

    const dadosProcessados = dadosFiltrados.map(d => ({
      ...d,
      valorExibido: modoCalculo === "eleitos" ? d.custoEleitos : d.custoTodos,
      candComDespesa: modoCalculo === "eleitos" ? d.candComDespesaEleitos : d.candComDespesaTodos
    })).sort((a, b) => b.valorExibido - a.valorExibido);

    const maiorCusto = d3.max(dadosProcessados, d => d.valorExibido) || 1;
    const dadosPaginados = dadosProcessados.slice(0, limite);

    el.innerHTML = `
      <div class="cargos" role="group" aria-label="Modo de cálculo do custo" style="margin-bottom: 12px;">
        <button data-modo="eleitos" aria-pressed="${modoCalculo === 'eleitos'}">Apenas despesas dos eleitos</button>
        <button data-modo="todos" aria-pressed="${modoCalculo === 'todos'}">Despesas de todos os candidatos</button>
      </div>
      
      ${ehMunicipal ? `
      <div class="busca" style="margin-bottom: 16px; width: 100%;">
        <input type="search" id="q1-busca" placeholder="Buscar por cidade..." value="${esc(termoBusca)}" style="width: 100%; padding: 10px; border-radius: 6px; border: 1px solid var(--line); background: var(--bg); color: var(--ink);">
      </div>
      ` : ""}

      <p class="aviso-mini" style="margin-bottom: 24px;">
        ${modoCalculo === 'eleitos' 
          ? "Cálculo: soma das despesas declaradas pelos <b>candidatos eleitos</b> dividida pelo número de cadeiras." 
          : "Cálculo: soma das despesas de <b>todos os candidatos</b> dividida pelo número de cadeiras."}
        ${ehMunicipal && !termoBusca ? " Mostrando as disputas mais caras." : ""}
      </p>

      <div class="fin-grid" style="display: flex; flex-direction: column; gap: 16px;">
        ${dadosPaginados.length ? dadosPaginados.map(d => `
          <div class="hb" style="display: flex; align-items: center; width: 100%;">
            <span style="font-weight: 600; width: 160px; flex-shrink: 0; line-height: 1.2;">
              ${cargoNome(d.cargo)}
              ${d.cidade ? `<br><small style="color:var(--ink-3); font-weight: 400;">${esc(titulo(d.cidade))}</small>` : ""}
            </span>
            <div style="flex-grow: 1; background: var(--bg-escuro); height: 16px; margin: 0 16px; position: relative; border-radius: 2px; overflow: hidden;">
              <i style="position: absolute; top: 0; left: 0; height: 100%; width: ${(d.valorExibido / maiorCusto) * 100}%; background: var(--ink);"></i>
            </div>
            <div style="display: flex; flex-direction: column; align-items: flex-end; width: 110px; flex-shrink: 0;">
              <span class="v num" style="font-size: 15px; font-weight: 700;">${brlc(d.valorExibido)}</span>
              <span style="font-size: 10px; color: var(--ink-3);">em ${fmt.format(d.candComDespesa)} prest.</span>
            </div>
          </div>
        `).join("") : `<p class="aviso-mini">Nenhum resultado encontrado.</p>`}
      </div>
      
      ${dadosProcessados.length > limite ? `
        <div style="text-align: center; margin-top: 24px;">
          <button id="q1-mais" class="link">Mostrar mais resultados</button>
        </div>
      ` : ""}
    `;

    el.querySelectorAll("button[data-modo]").forEach(btn => {
      btn.onclick = () => { modoCalculo = btn.dataset.modo; limite = 20; renderizarGrafico(); };
    });

    const inputBusca = el.querySelector("#q1-busca");
    if (inputBusca) {
      inputBusca.focus();
      const val = inputBusca.value;
      inputBusca.value = '';
      inputBusca.value = val;
      
      inputBusca.oninput = (e) => {
        termoBusca = e.target.value;
        limite = 20;
        renderizarGrafico();
      };
    }

    const btnMais = el.querySelector("#q1-mais");
    if (btnMais) {
      btnMais.onclick = () => { limite += 20; renderizarGrafico(); };
    }
  };

  renderizarGrafico();
}

let pedidoP1 = 0;
export default {
  id: "p1", numero: "P1",
  titulo: "Qual o custo de uma cadeira?",
  pergunta: "Quanto custa uma cadeira?",
  resumo: "Despesas de campanha divididas pelas cadeiras conquistadas, por cargo.",
  usaAno: true,
  async montar(el) {
    if (UF && !ANO) { el.innerHTML = `<p class="aviso-mini">Escolha um ano acima para ver o custo por cadeira.</p>`; return; }
    el.innerHTML = `<p class="nota">Relação entre as despesas de campanha e as cadeiras conquistadas por cargo.</p><div id="custo-cadeira"></div>`;
    
    const alvo = el.querySelector("#custo-cadeira");
    if (!UF) { alvo.innerHTML = `<p class="aviso-mini">Escolha um estado da amostra para ver o custo por cadeira.</p>`; return; }
    alvo.innerHTML = `<p class="aviso-mini">Carregando…</p>`;
    
    const pedido = ++pedidoP1;
    try {
      // Pedimos a view do banco e o dicionário de municípios do frontend em simultâneo
      const [d, mapaNomes] = await Promise.all([
        request(`/api/q1-custo-cadeira?uf=${encodeURIComponent(UF)}&ano=${ANO}`, { silencioso: true }),
        obterNomesMunicipios(UF)
      ]);
      if (pedido === pedidoP1 && alvo.isConnected) montarCustoCadeira(d.dados, mapaNomes, alvo);
    } catch (e) {
      if (pedido === pedidoP1 && alvo.isConnected) alvo.innerHTML = `<p class="aviso-mini">Não foi possível carregar: ${esc(e.message)}</p>`;
    }
  },
};
