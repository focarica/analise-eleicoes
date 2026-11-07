// @ts-nocheck
// P6 — idade média estimada do eleitorado × alternância partidária e idade dos prefeitos.
import { ANOS_MUNICIPAIS, fmt, titulo, esc, request } from "../util";
import { UF, GEO } from "../presentation";
import "./p6-idade-alternancia.css";

let pedido = 0;
const media = (rows, campo) => d3.mean(rows, r => r[campo] == null ? null : Number(r[campo]));
const dec1 = v => v == null ? "Sem dado" : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 });

export default {
  id: "p6", numero: "P6",
  titulo: "Idade do eleitorado e alternância nas prefeituras",
  pergunta: "Idade média do município × alternância de poder e idade dos eleitos",
  resumo: "Faixa etária estimada do eleitorado, troca de partido na prefeitura e idade dos prefeitos eleitos, de 2004 a 2024.",
  async montar(el) {
    const inicio = ++pedido;
    el.innerHTML = `<p class="nota">A idade média do eleitorado é estimada pelos pontos médios das faixas etárias publicadas pelo TSE. “Alternância” indica troca do partido do prefeito eleito em relação ao pleito municipal quatro anos antes; não mede mudança ideológica. A janela disponível começa em 2004, por isso esse ano não tem comparação anterior.</p>
      <div class="q6-controles"><label>Eleição municipal<select id="q6-ano">${[...ANOS_MUNICIPAIS].map(a => `<option value="${a}" ${a === 2024 ? "selected" : ""}>${a}</option>`).join("")}</select></label></div>
      <p class="aviso-mini" id="q6-origem"></p><div id="q6-conteudo"><p class="aviso-mini">Carregando…</p></div>`;
    const seletor = el.querySelector("#q6-ano"), conteudo = el.querySelector("#q6-conteudo");
    el.querySelector("#q6-origem").textContent = UF ? `Estado de ${GEO[UF].properties.nome}.` : "Amostra inteira dos seis estados.";
    const carregar = async () => {
      const chave = ++pedido;
      conteudo.innerHTML = `<p class="aviso-mini">Carregando…</p>`;
      const query = new URLSearchParams({ ano: seletor.value }); if (UF) query.set("uf", UF);
      try {
        const resp = await request(`/api/q6-idade-alternancia?${query}`, { silencioso: true });
        if (chave !== pedido || !conteudo.isConnected) return;
        desenhar(resp.dados || [], +seletor.value, conteudo);
      } catch (e) {
        if (chave === pedido && conteudo.isConnected) conteudo.innerHTML = `<p class="aviso-mini">Não foi possível carregar: ${esc(e.message)}</p>`;
      }
    };
    const desenhar = (rows, ano, alvo) => {
      if (!rows.length) { alvo.innerHTML = `<p class="aviso-mini">Sem dados de prefeito/eleitorado para ${ano} neste recorte.</p>`; return; }
      const comIdade = rows.filter(r => r.idade_media_eleitorado != null);
      const comPrefeito = rows.filter(r => r.idade_prefeito != null);
      const comp = rows.filter(r => r.alternou_partido != null);
      const mudou = comp.filter(r => r.alternou_partido === true || r.alternou_partido === "true").length;
      const pctMudou = comp.length ? 100 * mudou / comp.length : null;
      const ordenados = comIdade.slice().sort((a, b) => Number(a.idade_media_eleitorado) - Number(b.idade_media_eleitorado));
      const grupos = Array.from({ length: 4 }, (_, i) => ({ faixa: i + 1, rows: [] }));
      ordenados.forEach((r, i) => grupos[Math.min(3, Math.floor(i * 4 / Math.max(1, ordenados.length)))].rows.push(r));
      const qRows = grupos.map(g => {
        const c = g.rows.filter(r => r.alternou_partido != null);
        const n = c.filter(r => r.alternou_partido === true || r.alternou_partido === "true").length;
        return { ...g, mediaIdade: media(g.rows, "idade_media_eleitorado"), mediaPrefeito: media(g.rows, "idade_prefeito"), n, mudou: c.length, pct: c.length ? 100 * n / c.length : null };
      });
      const fmtPct = v => v == null ? "Sem comparativo" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
      const nomeUf = UF ? GEO[UF]?.properties?.nome : null;
      alvo.innerHTML = `<div class="q6-resumo">
        <div class="q6-card"><small>Idade média estimada do eleitorado</small><b>${comIdade.length ? `${dec1(media(comIdade, "idade_media_eleitorado"))} anos` : "Sem perfil etário publicado"}</b><small>${fmt.format(comIdade.length)} municípios com perfil</small></div>
        <div class="q6-card"><small>Idade média dos prefeitos eleitos</small><b>${dec1(media(comPrefeito, "idade_prefeito"))} anos</b><small>${fmt.format(comPrefeito.length)} prefeitos com nascimento informado</small></div>
        <div class="q6-card"><small>Prefeituras cujo partido mudou desde ${ano - 4}</small><b>${fmtPct(pctMudou)}</b><small>${fmt.format(mudou)} de ${fmt.format(comp.length)} municípios comparáveis</small></div>
      </div>
      <h3>Alternância por idade média do eleitorado</h3>
      <p class="aviso-mini">Municípios ordenados por idade média estimada do eleitorado e divididos em quatro grupos de tamanho semelhante.${ano === 2004 ? " O perfil TSE de 2004 não contém faixas etárias válidas (#NE), então não há média do eleitorado nem comparação de alternância anterior nesta eleição." : ""}</p>
      ${comIdade.length ? `<div class="q6-grupos">${qRows.map(g => `<article class="q6-grupo"><small>${g.faixa === 1 ? "Mais jovem" : g.faixa === 4 ? "Mais velho" : "Intermediário"} · grupo ${g.faixa}</small><b>${fmtPct(g.pct)}</b><span>${fmt.format(g.mudou)} trocas em ${fmt.format(g.n)} comparáveis</span><small>eleitorado: ${dec1(g.mediaIdade)} anos · prefeito: ${dec1(g.mediaPrefeito)} anos</small></article>`).join("")}</div>` : `<p class="aviso-mini">Não há distribuição etária utilizável para formar os quatro grupos.</p>`}
      <h3>Municípios e prefeitos eleitos</h3><div class="q6-tabela"><table><thead><tr><th>Município${nomeUf ? ` · ${esc(nomeUf)}` : " · UF"}</th><th>Prefeito eleito</th><th>Partido atual</th><th>Partido anterior</th><th>Idade eleitorado</th><th>Idade prefeito</th><th>Alternância</th></tr></thead><tbody>${rows.slice().sort((a,b)=>Number(b.idade_media_eleitorado||0)-Number(a.idade_media_eleitorado||0)).map(r => `<tr><td>${esc(titulo(r.nm_municipio))}${UF ? "" : ` · ${esc(r.sg_uf)}`}</td><td>${esc(titulo(r.nm_urna_candidato || "Sem registro"))}</td><td>${esc(r.sg_partido || "–")}</td><td>${esc(r.sg_partido_anterior || "–")}</td><td>${r.idade_media_eleitorado == null ? "–" : `${dec1(r.idade_media_eleitorado)} anos`}</td><td>${r.idade_prefeito == null ? "–" : `${fmt.format(r.idade_prefeito)} anos`}</td><td>${r.alternou_partido == null ? "Sem ciclo anterior na janela" : (r.alternou_partido === true || r.alternou_partido === "true" ? "Mudou" : "Manteve")}</td></tr>`).join("")}</tbody></table></div>
      <p class="aviso-mini">A idade do eleitorado é uma estimativa pelos pontos médios de faixas (100 anos ou mais = 100), não idade exata. A idade do prefeito é calculada na data do primeiro turno. Troca de sigla mede alternância partidária, não identidade ideológica; anos sem ciclo anterior ou sem partido identificado ficam fora do percentual.</p>`;
    };
    seletor.onchange = carregar;
    await carregar();
  },
};
