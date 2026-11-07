// @ts-nocheck
// P3 — índices municipais e partido do prefeito eleito por município.
import { fmt, brlc, pctFmt, titulo, esc, request } from "../util";
import { UF, GEO } from "../presentation";
import "./p3-indicadores.css";

const ANOS = [2004, 2008, 2012, 2016, 2020, 2024];
const METRICAS = {
  pib: { nome: "PIB per capita", campo: "pib_per_capita", formatar: brlc, unidade: "R$ correntes" },
  idhm: { nome: "IDHM", campo: "idhm", formatar: v => Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 }), unidade: "referência Atlas" },
  eleitorado: { nome: "Eleitores aptos / população", campo: "pct_eleitores_populacao", formatar: v => `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`, unidade: "aptos ÷ população IBGE" },
  abstencao: { nome: "Abstenção", campo: "pct_abstencao", formatar: v => `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`, unidade: "abstenções ÷ aptos" },
};

function dadosQuartis(rows, metrica) {
  const campo = METRICAS[metrica].campo;
  const ordenados = rows.filter(r => r[campo] != null).slice().sort((a, b) => Number(a[campo]) - Number(b[campo]));
  const grupos = Array.from({ length: 4 }, (_, i) => ({ n: 0, soma: 0, partidos: new Map(), nomes: [] }));
  ordenados.forEach((r, i) => {
    const q = Math.min(3, Math.floor(i * 4 / ordenados.length));
    const g = grupos[q], valor = Number(r[campo]);
    g.n++; g.soma += valor;
    if (r.sg_partido) g.partidos.set(r.sg_partido, (g.partidos.get(r.sg_partido) || 0) + 1);
  });
  return grupos.map((g, i) => {
    const top = [...g.partidos].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    return { ...g, faixa: i + 1, media: g.n ? g.soma / g.n : null, partido: top?.[0], vitorias: top?.[1] || 0 };
  });
}

let pedido = 0;
export default {
  id: "p3", numero: "P3",
  titulo: "Município, eleitorado e resultado eleitoral",
  pergunta: "Como os indicadores municipais se relacionam com os eleitos e seus partidos?",
  resumo: "PIB, IDHM, proporção de eleitores e abstenção comparados com o partido do prefeito eleito.",
  async montar(el) {
    const atual = ++pedido;
    const anoInicial = ANOS.includes(2024) ? 2024 : ANOS.at(-1);
    el.innerHTML = `<p class="nota">Para cada eleição municipal, compara-se o indicador dos municípios e o partido do prefeito eleito. Os quartis agrupam municípios do menor ao maior valor do indicador; o partido exibido em cada faixa é o que venceu mais prefeituras nela.</p>
      <div class="q3-controles">
        <label>Eleição municipal<select id="q3-ano">${ANOS.map(a => `<option value="${a}" ${a === anoInicial ? "selected" : ""}>${a}</option>`).join("")}</select></label>
        <label>Indicador<select id="q3-metrica">${Object.entries(METRICAS).map(([id, m]) => `<option value="${id}">${m.nome}</option>`).join("")}</select></label>
      </div><p class="aviso-mini" id="q3-origem"></p><div id="q3-conteudo"><p class="aviso-mini">Carregando…</p></div>`;
    const anoSel = el.querySelector("#q3-ano"), metricaSel = el.querySelector("#q3-metrica"), conteudo = el.querySelector("#q3-conteudo");
    const carregar = async () => {
      const idAtual = ++pedido;
      conteudo.innerHTML = `<p class="aviso-mini">Carregando…</p>`;
      const query = new URLSearchParams({ ano: anoSel.value }); if (UF) query.set("uf", UF);
      try {
        const resp = await request(`/api/q3-indicadores?${query}`, { silencioso: true });
        if (idAtual !== pedido || !conteudo.isConnected) return;
        render(resp.dados || [], +anoSel.value, metricaSel.value, conteudo);
      } catch (e) {
        if (idAtual === pedido && conteudo.isConnected) conteudo.innerHTML = `<p class="aviso-mini">Não foi possível carregar: ${esc(e.message)}</p>`;
      }
    };
    const render = (rows, ano, metrica, alvo) => {
      const m = METRICAS[metrica], validos = rows.filter(r => r[m.campo] != null);
      const topPartido = [...d3.rollup(rows.filter(r => r.sg_partido), v => v.length, r => r.sg_partido)].sort((a, b) => b[1] - a[1])[0];
      const mediaAbst = d3.mean(rows, r => r.pct_abstencao == null ? null : Number(r.pct_abstencao));
      const mediaEleitorado = d3.mean(rows, r => r.pct_eleitores_populacao == null ? null : Number(r.pct_eleitores_populacao));
      const grupos = dadosQuartis(rows, metrica);
      const formatMetric = v => v == null ? "Sem dado" : m.formatar(v);
      const locais = validos.slice().sort((a, b) => Number(b[m.campo]) - Number(a[m.campo]));
      const nomeUf = UF ? GEO[UF]?.properties?.nome : null;
      const tabela = locais.slice(0, 20);
      alvo.innerHTML = `<div class="q3-resumo">
        <div class="q3-card"><small>Municípios com ${m.nome.toLowerCase()}</small><b>${fmt.format(validos.length)} / ${fmt.format(rows.length)}</b></div>
        <div class="q3-card"><small>Partido com mais prefeituras no recorte</small><b>${topPartido ? `${esc(topPartido[0])} · ${fmt.format(topPartido[1])}` : "Sem partido identificado"}</b></div>
        <div class="q3-card"><small>Abstenção média simples</small><b>${mediaAbst == null ? "Sem dado" : `${mediaAbst.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}</b></div>
      </div>
      <h3>Partido mais vitorioso por faixa de ${m.nome.toLowerCase()}</h3>
      <p class="aviso-mini">Cada faixa contém aproximadamente um quarto dos municípios com indicador publicado. Os percentuais de eleitorado/população e de abstenção são médias simples por município.</p>
      <div class="q3-quartis">${grupos.map(g => `<article class="q3-quartil"><small>${g.faixa === 1 ? "Menor" : g.faixa === 4 ? "Maior" : "Intermediário"} · faixa ${g.faixa}</small><b>${g.partido ? esc(g.partido) : "Sem partido"}</b><span>${g.partido ? `${fmt.format(g.vitorias)} de ${fmt.format(g.n)} prefeituras` : `${fmt.format(g.n)} municípios`}</span><small>média ${formatMetric(g.media)}</small></article>`).join("")}</div>
      <h3>Municípios com maior ${m.nome.toLowerCase()}</h3>
      <div class="q3-tabela"><table><thead><tr><th>Município${nomeUf ? ` · ${esc(nomeUf)}` : " · UF"}</th><th class="num">${m.nome}</th><th class="num">Abstenção</th><th class="num">Aptos/pop.</th><th>Prefeito eleito</th><th>Partido</th></tr></thead><tbody>${tabela.map(r => `<tr><td>${esc(titulo(r.nm_municipio))}${UF ? "" : ` · ${esc(r.sg_uf)}`}</td><td class="num">${formatMetric(r[m.campo])}</td><td class="num">${r.pct_abstencao == null ? "–" : `${Number(r.pct_abstencao).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}</td><td class="num">${r.pct_eleitores_populacao == null ? "–" : `${Number(r.pct_eleitores_populacao).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}</td><td>${esc(titulo(r.nm_urna_candidato || "Sem registro"))}</td><td>${esc(r.sg_partido || "–")}</td></tr>`).join("")}</tbody></table></div>
      <p class="aviso-mini">${fmt.format(rows.length)} municípios na base para ${ano}${UF ? ` · ${esc(UF)}` : " · amostra de seis UFs"}. População e PIB per capita usam cada um o último ano IBGE publicado até a eleição; os anos aparecem nas fontes e a série pode terminar antes do pleito. IDHM usa ${rows.find(r => r.ano_idhm != null)?.ano_idhm || "a referência mais recente disponível"}. Aptos/população usa aptos do 1º turno e população IBGE; abstenção usa abstenções/aptos do 1º turno. ${mediaEleitorado == null ? "Proporção de aptos/população indisponível neste recorte." : `Proporção média de aptos/população: ${mediaEleitorado.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%.`}</p>`;
    };
    anoSel.onchange = carregar; metricaSel.onchange = carregar;
    await carregar();
  },
};
