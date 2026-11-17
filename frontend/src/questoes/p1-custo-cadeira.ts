// @ts-nocheck
import { esc, request } from '../util';
import { UF, ANO } from '../presentation';
import './p1-custo-cadeira.css';
import { montarMapaCusto } from './p1-mapa';

let pedidoP1 = 0;
export default {
  id: 'p1', numero: 'P1',
  titulo: 'Qual o custo de uma cadeira?',
  pergunta: 'Quanto custa uma cadeira?',
  resumo: 'Despesas de campanha e cadeiras conquistadas, por cargo.',
  usaAno: true,
  async montar(el) {
    if (!UF || !ANO) {
      el.innerHTML = `<p class="aviso-mini">Escolha um estado e um ano para ver os gastos por município.</p>`;
      return;
    }

    el.innerHTML = '<p class="nota">Carregando…</p><div id="p1-mapa"></div>';
    const mapa = el.querySelector('#p1-mapa');
    const pedido = ++pedidoP1;
    try {
      const [resposta, malhaRes] = await Promise.all([
        request(`/api/q1-custo-cadeira?uf=${encodeURIComponent(UF)}&ano=${ANO}`, { silencioso: true }),
        fetch(`/geo/municipios-${UF}.json`),
      ]);
      if (!malhaRes.ok) throw new Error('Malha municipal indisponível');
      const malha = await malhaRes.json();
      if (pedido !== pedidoP1 || !mapa.isConnected) return;
      mapa.innerHTML = '';
      montarMapaCusto(mapa, malha, resposta.dados);
    } catch (e) {
      if (pedido === pedidoP1 && mapa.isConnected) mapa.innerHTML = `<p class="aviso-mini">Não foi possível carregar: ${esc(e.message)}</p>`;
    }
  },
};
