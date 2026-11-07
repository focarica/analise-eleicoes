// @ts-nocheck
// Camada visual da P3. Consulta, KPIs, ordenação e quartis pertencem à P3 original.
import { corP, esc, fmt, titulo } from '../util';

const percentual = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
let observador: ResizeObserver | undefined;
let sequencia = 0;

function valorCompleto(m, valor) {
  if (valor == null) return 'Sem dado';
  if (m.campo === 'pib_per_capita') return moeda.format(Number(valor));
  const numero = Number(valor).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  return m.campo.startsWith('pct_') ? `${numero}%` : numero;
}

function quadro(host, id, tituloGrafico, subtitulo) {
  const card = document.createElement('article');
  card.className = `q3-grafico q3-${id}`;
  card.innerHTML = `<header><div><h3>${esc(tituloGrafico)}</h3><p>${esc(subtitulo)}</p></div></header><div class="q3-canvas"></div>`;
  host.append(card);
  return { card, canvas: card.querySelector('.q3-canvas') };
}

function grafico(q, nome, altura = 310, margemEsquerda = 64) {
  const largura = Math.max(280, q.canvas.clientWidth);
  const margem = { esquerda: margemEsquerda, direita: 18, topo: 25, baixo: 52 };
  const svg = d3.select(q.canvas).append('svg')
    .attr('viewBox', `0 0 ${largura} ${altura}`)
    .attr('role', 'group').attr('aria-label', nome);
  svg.append('title').text(nome);
  return { ...q, svg, largura, altura, margem, direita: largura - margem.direita, base: altura - margem.baixo };
}

function eixos(q, x, y, formatX, formatY, nomeX, nomeY) {
  const grade = q.svg.append('g').attr('class', 'q3-grade')
    .attr('transform', `translate(${q.margem.esquerda},0)`);
  const eixoX = q.svg.append('g').attr('class', 'q3-eixo').attr('transform', `translate(0,${q.base})`);
  const eixoY = q.svg.append('g').attr('class', 'q3-eixo').attr('transform', `translate(${q.margem.esquerda},0)`);
  q.svg.append('text').attr('class', 'q3-unidade').attr('x', q.margem.esquerda).attr('y', 12).text(nomeY);
  q.svg.append('text').attr('class', 'q3-unidade').attr('x', (q.margem.esquerda + q.direita) / 2)
    .attr('y', q.altura - 5).attr('text-anchor', 'middle').text(nomeX);
  return (sx = x, sy = y) => {
    grade.call(d3.axisLeft(sy).ticks(4).tickSize(-(q.direita - q.margem.esquerda)).tickFormat(''));
    eixoX.call(d3.axisBottom(sx).ticks(Math.max(2, Math.floor(q.largura / 125))).tickFormat(formatX));
    eixoY.call(d3.axisLeft(sy).ticks(4).tickFormat(formatY));
  };
}

// Um ponto de entrada no teclado por gráfico; setas percorrem suas marcas.
function detalhes(marcas, tooltip, conteudo, abrirMunicipio) {
  const nodes = marcas.nodes();
  const esconder = () => { tooltip.hidden = true; marcas.classed('q3-ativo', false); };
  marcas.attr('tabindex', (_, i) => i === 0 ? 0 : -1)
    .attr('aria-label', conteudo)
    .on('pointerenter focus', function(event, d) {
      marcas.classed('q3-ativo', false);
      d3.select(this).classed('q3-ativo', true);
      tooltip.textContent = conteudo(d);
      tooltip.hidden = false;
      const rect = this.getBoundingClientRect();
      const px = event.clientX || rect.x + rect.width / 2;
      const py = event.clientY || rect.y + rect.height / 2;
      tooltip.style.left = `${Math.max(12, Math.min(px + 14, innerWidth - tooltip.offsetWidth - 12))}px`;
      tooltip.style.top = `${Math.max(12, Math.min(py + 14, innerHeight - tooltip.offsetHeight - 12))}px`;
    })
    .on('pointerleave blur', esconder)
    .on('keydown', function(event, d) {
      const i = nodes.indexOf(this);
      if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const n = event.key === 'Home' ? 0 : event.key === 'End' ? nodes.length - 1
          : (i + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) + nodes.length) % nodes.length;
        this.setAttribute('tabindex', '-1'); nodes[n].setAttribute('tabindex', '0'); nodes[n].focus();
      }
      if (event.key === 'Escape') { event.stopPropagation(); esconder(); }
      if (event.key === 'Enter' && abrirMunicipio && d.cd_municipio_tse) abrirMunicipio(d.cd_municipio_tse);
    });
  if (abrirMunicipio) marcas.style('cursor', 'pointer').on('click', (_, d) => abrirMunicipio(d.cd_municipio_tse));
}

function corTexto(cor) {
  const { r, g, b } = d3.rgb(cor);
  const lum = [r, g, b].map(v => { const c = v / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
  return .2126 * lum[0] + .7152 * lum[1] + .0722 * lum[2] > .179 ? '#000000' : '#FFFFFF';
}

export function composicao(host, grupos, m, partidos, tooltip, selecionar) {
  const q = quadro(host, 'composicao', `${m.nome}: quais partidos ganham mais prefeituras?`,
    'Do menor ao maior indicador, em quatro grupos. Largura = parcela de prefeituras por partido.');
  const rotulos = ['Menores valores', 'Valores intermediários', 'Valores intermediários', 'Maiores valores'];
  q.canvas.innerHTML = `<div class="q3-regua" aria-hidden="true"><span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span></div>`;
  grupos.forEach((grupo, i) => {
    const linha = document.createElement('div'); linha.className = 'q3-grupo';
    linha.dataset.grupo = String(grupo.faixa); linha.dataset.total = String(grupo.n);
    linha.innerHTML = `<div class="q3-grupo-cab"><div><b>Grupo ${grupo.faixa}</b><span>${rotulos[i]}</span></div><span>${fmt.format(grupo.n)} municípios · média <b>${esc(valorCompleto(m, grupo.media))}</b></span></div><div class="q3-barra" role="group" aria-label="Partidos no grupo ${grupo.faixa}"></div>`;
    q.canvas.append(linha);
    if (!grupo.n) { linha.querySelector('.q3-barra').textContent = 'Sem municípios neste grupo'; return; }
    const segmentos = partidos.map(p => ({ partido: p, n: grupo.partidos.get(p) || 0, grupo: grupo.faixa, total: grupo.n })).filter(d => d.n);
    const identificados = segmentos.reduce((s, d) => s + d.n, 0);
    if (identificados < grupo.n) segmentos.push({ partido: '', n: grupo.n - identificados, grupo: grupo.faixa, total: grupo.n });
    const marcas = d3.select(linha.querySelector('.q3-barra')).selectAll('div').data(segmentos).join('div')
      .attr('class', 'q3-segmento q3-party-mark').attr('role', 'button')
      .attr('data-partido', d => d.partido).attr('data-n', d => d.n)
      .style('width', d => `${100 * d.n / d.total}%`).style('background', d => corP(d.partido))
      .style('color', d => corTexto(corP(d.partido)))
      .text(d => {
        const label = `${d.partido || 'Sem partido'} ${d.n}`;
        const largura = q.canvas.clientWidth * d.n / d.total;
        return largura >= Math.max(50, label.length * 6 + 14) ? label : '';
      });
    detalhes(marcas, tooltip, d => `Grupo ${d.grupo} · ${d.partido || 'Partido não identificado'}: ${fmt.format(d.n)} de ${fmt.format(d.total)} prefeituras (${percentual.format(100 * d.n / d.total)}%)`);
    marcas.on('click', (_, d) => selecionar(d.partido)).on('keydown.selecionar', (event, d) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selecionar(d.partido); }
    });
  });
  const legenda = document.createElement('div'); legenda.className = 'q3-legenda';
  legenda.setAttribute('role', 'group'); legenda.setAttribute('aria-label', 'Realçar um partido nos gráficos');
  legenda.innerHTML = `<button type="button" data-partido="" aria-pressed="true">Todos os partidos</button>` + partidos.map(p =>
    `<button type="button" data-partido="${esc(p)}" aria-pressed="false"><i style="background:${corP(p)}"></i>${esc(p)}</button>`).join('');
  legenda.querySelectorAll('button').forEach(b => b.onclick = () => selecionar(b.dataset.partido));
  if (grupos.some(g => [...g.partidos.values()].reduce((s, n) => s + n, 0) < g.n)) {
    const ausente = document.createElement('span'); ausente.className = 'q3-legenda-ausente';
    ausente.innerHTML = '<i style="background:#8A8F98"></i>Partido não identificado'; legenda.append(ausente);
  }
  q.card.append(legenda);
}

export function distribuicao(host, rows, m, tooltip) {
  const valores = rows.filter(r => r[m.campo] != null).map(r => Number(r[m.campo]));
  const q = grafico(quadro(host, 'distribuicao', 'Quais valores são mais comuns?', 'Altura = quantidade de municípios. Valores extremos permanecem na escala.'), 'Distribuição dos municípios');
  if (!valores.length) { q.canvas.textContent = 'Sem indicador publicado neste recorte.'; return; }
  const [min, max] = d3.extent(valores);
  const x = d3.scaleLinear().domain(min === max ? [Math.min(0, min), max || 1] : [min, max]).nice().range([q.margem.esquerda, q.direita]);
  const bins = d3.bin().domain(x.domain()).thresholds(x.ticks(16))(valores);
  const y = d3.scaleLinear().domain([0, d3.max(bins, d => d.length) || 1]).nice().range([q.base, q.margem.topo]);
  eixos(q, x, y, m.formatar, fmt.format, m.nome, 'Municípios')();
  const marcas = q.svg.append('g').selectAll('rect').data(bins).join('rect').attr('class', 'q3-histograma-barra')
    .attr('data-n', d => d.length).attr('x', d => x(d.x0) + 1).attr('y', d => y(d.length))
    .attr('width', d => Math.max(0, x(d.x1) - x(d.x0) - 2)).attr('height', d => q.base - y(d.length)).attr('rx', 2);
  detalhes(marcas, tooltip, d => `${valorCompleto(m, d.x0)} a ${valorCompleto(m, d.x1)}: ${fmt.format(d.length)} municípios`);
}

export function dispersao(host, rows, m, tooltip, abrirMunicipio) {
  const campoY = m.campo === 'pct_abstencao' ? 'pct_eleitores_populacao' : 'pct_abstencao';
  const nomeY = campoY === 'pct_abstencao' ? 'Abstenção' : 'Aptos / população';
  const dados = rows.filter(r => r[m.campo] != null && r[campoY] != null);
  const q = grafico(quadro(host, 'dispersao', `${m.nome} × ${nomeY.toLowerCase()}`,
    'Um ponto por município, colorido pelo partido vencedor. Clique para abrir a ficha municipal.'), 'Comparação entre indicadores municipais');
  if (!dados.length) { q.canvas.textContent = 'Sem pares de indicadores disponíveis.'; return; }
  const escala = (campo, range) => {
    const [a, b] = d3.extent(dados, r => Number(r[campo]));
    return d3.scaleLinear().domain(a === b ? [a - 1, b + 1] : [a, b]).nice().range(range);
  };
  const x = escala(m.campo, [q.margem.esquerda, q.direita]), y = escala(campoY, [q.base, q.margem.topo]);
  const atualizarEixos = eixos(q, x, y, m.formatar, v => `${percentual.format(v)}%`, m.nome, `${nomeY} (%)`);
  atualizarEixos();
  const clipId = `q3-recorte-${++sequencia}`;
  q.svg.append('defs').append('clipPath').attr('id', clipId).append('rect')
    .attr('x', q.margem.esquerda).attr('y', q.margem.topo).attr('width', q.direita - q.margem.esquerda).attr('height', q.base - q.margem.topo);
  const marcas = q.svg.append('g').attr('clip-path', `url(#${clipId})`).selectAll('circle').data(dados).join('circle')
    .attr('class', 'q3-ponto q3-party-mark').attr('data-partido', r => r.sg_partido || '')
    .attr('data-x', r => r[m.campo]).attr('data-y', r => r[campoY])
    .attr('cx', r => x(Number(r[m.campo]))).attr('cy', r => y(Number(r[campoY])))
    .attr('r', 4.5).attr('fill', r => corP(r.sg_partido));
  detalhes(marcas, tooltip, r => `${titulo(r.nm_municipio)} · ${r.sg_uf} — ${m.nome}: ${valorCompleto(m, r[m.campo])}; ${nomeY}: ${percentual.format(Number(r[campoY]))}%; ${r.sg_partido || 'partido não identificado'}`, abrirMunicipio);
  const zoom = d3.zoom().extent([[q.margem.esquerda, q.margem.topo], [q.direita, q.base]])
    .scaleExtent([1, 12]).translateExtent([[q.margem.esquerda, q.margem.topo], [q.direita, q.base]])
    .filter(e => e.type !== 'dblclick' && (e.type !== 'wheel' || e.ctrlKey))
    .on('zoom', event => {
      tooltip.hidden = true;
      const sx = event.transform.rescaleX(x), sy = event.transform.rescaleY(y);
      atualizarEixos(sx, sy);
      marcas.attr('cx', r => sx(Number(r[m.campo]))).attr('cy', r => sy(Number(r[campoY])));
    });
  q.svg.call(zoom).on('dblclick.zoom', null);
  const controles = document.createElement('div'); controles.className = 'q3-zoom';
  controles.innerHTML = '<span>Arraste para explorar · Ctrl + rolagem para ampliar</span><button type="button" aria-label="Ampliar gráfico">+</button><button type="button" aria-label="Reduzir gráfico">−</button><button type="button">Redefinir</button>';
  const botoes = controles.querySelectorAll('button');
  botoes[0].onclick = () => q.svg.call(zoom.scaleBy, 1.5);
  botoes[1].onclick = () => q.svg.call(zoom.scaleBy, 1 / 1.5);
  botoes[2].onclick = () => q.svg.call(zoom.transform, d3.zoomIdentity);
  q.card.append(controles);
}

export function ranking(host, rows, m, tooltip, abrirMunicipio) {
  const q = quadro(host, 'ranking', 'Os 20 municípios com maior indicador', 'Comprimento = valor do indicador · cor = partido do prefeito eleito.');
  if (!rows.length) { q.canvas.textContent = 'Sem municípios com indicador publicado.'; return; }
  const max = d3.max(rows, r => Number(r[m.campo])) || 1;
  const linhas = d3.select(q.canvas).append('div').attr('class', 'q3-ranking-lista').selectAll('button')
    .data(rows).join('button').attr('type', 'button').attr('class', 'q3-ranking-linha')
    .attr('data-value', r => r[m.campo]).attr('data-municipio', r => r.cd_municipio_tse);
  linhas.append('span').attr('class', 'q3-posicao').text((_, i) => String(i + 1).padStart(2, '0'));
  linhas.append('span').attr('class', 'q3-ranking-local').text(r => titulo(r.nm_municipio))
    .append('small').text(r => ` ${r.sg_uf} · ${r.sg_partido || 'Sem partido'}`);
  linhas.append('span').attr('class', 'q3-ranking-trilho').append('span')
    .attr('class', 'q3-ranking-barra q3-party-mark').attr('data-partido', r => r.sg_partido || '')
    .style('width', r => `${Math.max(0, 100 * Number(r[m.campo]) / max)}%`).style('background', r => corP(r.sg_partido));
  linhas.append('b').attr('class', 'q3-ranking-valor').text(r => m.formatar(r[m.campo]));
  detalhes(linhas, tooltip, r => `${titulo(r.nm_municipio)} · ${r.sg_uf}: ${valorCompleto(m, r[m.campo])}; ${r.sg_partido || 'partido não identificado'}`, abrirMunicipio);
}

export function montarGraficos(host, rows, m, grupos, tabela, abrirMunicipio) {
  observador?.disconnect();
  let selecionado = '';
  const totais = new Map();
  grupos.forEach(g => g.partidos.forEach((n, p) => totais.set(p, (totais.get(p) || 0) + n)));
  const partidos = [...totais.keys()].sort((a, b) => totais.get(b) - totais.get(a) || a.localeCompare(b));
  const selecionar = partido => {
    selecionado = selecionado === partido ? '' : partido;
    realcar();
  };
  const realcar = () => {
    host.querySelectorAll('.q3-party-mark').forEach(e => {
      e.classList.toggle('q3-atenuado', !!selecionado && e.dataset.partido !== selecionado);
      e.classList.toggle('q3-destaque', !!selecionado && e.dataset.partido === selecionado);
    });
    host.querySelectorAll('.q3-legenda button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.partido === selecionado)));
  };
  const desenhar = () => {
    host.replaceChildren();
    const tooltip = document.createElement('div'); tooltip.className = 'q3-tooltip'; tooltip.hidden = true; tooltip.setAttribute('role', 'status');
    host.append(tooltip);
    composicao(host, grupos, m, partidos, tooltip, selecionar);
    dispersao(host, rows, m, tooltip, abrirMunicipio);
    distribuicao(host, rows, m, tooltip);
    ranking(host, tabela, m, tooltip, abrirMunicipio);
    realcar();
  };
  desenhar();
  let largura = host.clientWidth;
  const novoObservador = new ResizeObserver(() => {
    if (!host.isConnected) { novoObservador.disconnect(); return; }
    if (Math.abs(largura - host.clientWidth) < 2) return;
    largura = host.clientWidth; desenhar();
  });
  observador = novoObservador;
  novoObservador.observe(host);
}
