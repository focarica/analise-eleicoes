import "./style.css";

type Row = Record<string, unknown>;
type Dashboard = { uf: string; year: number; parties: Row[]; spending: Row[] };

const UFS = ["AC", "AL", "BA", "DF", "RO", "SP"];
const UF_NAMES: Record<string, string> = {
  AC: "Acre", AL: "Alagoas", BA: "Bahia", DF: "Distrito Federal", RO: "Rondônia", SP: "São Paulo",
};
const PARTY_COLORS: Record<string, string> = {
  MDB: "#2f8f5b", PP: "#79aedb", PSD: "#d8b62c", PL: "#24304f", PSB: "#e8743b",
  UNIÃO: "#1c9c97", REPUBLICANOS: "#6a4c93", PT: "#c8323c", PSDB: "#3d7bd9",
  PDT: "#9c2a5a", PODE: "#8bc34a", AVANTE: "#f48fb1", PV: "#83a94a", PSOL: "#b39ddb",
  NOVO: "#f07f2a", REDE: "#2aa876", PRD: "#5d6d7e",
};
const root = document.querySelector<HTMLDivElement>("#app")!;
const number = new Intl.NumberFormat("pt-BR");
const money = (value: unknown) => value == null ? "—" : Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const fmt = (value: unknown) => value == null ? "—" : number.format(Number(value));
const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const partyColor = (name: unknown) => PARTY_COLORS[String(name || "").toUpperCase()] || "#8a8f98";
const empty = "<p class=muted>Nenhum dado disponível neste recorte.</p>";

async function api<T>(path: string): Promise<T> {
  const response = await fetch(path);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Falha ao consultar o MotherDuck.");
  return data as T;
}

root.innerHTML = `
  <header class="topbar">
    <a class="brand" href="#"><span class="mark">E</span><span>Eleitoral<small>dados abertos do TSE</small></span></a>
    <span class="live"><i></i> MotherDuck</span>
  </header>
  <main>
    <section class="intro">
      <div><p class="eyebrow">Painel eleitoral</p><h1>Votos, gastos e trajetórias.</h1><p class="muted">Explore os resultados e as prestações de contas nos estados da amostra.</p></div>
      <div class="filters"><label>Estado<select id="uf">${UFS.map((uf) => `<option value="${uf}" ${uf === "SP" ? "selected" : ""}>${UF_NAMES[uf]}</option>`).join("")}</select></label><label>Eleição<select id="year"></select></label></div>
    </section>

    <section class="search-wrap" aria-label="Busca">
      <label for="search">Buscar candidato ou município</label>
      <input id="search" type="search" autocomplete="off" placeholder="Digite pelo menos 2 caracteres…">
      <div id="suggestions" class="suggestions" hidden></div>
    </section>

    <div id="notice" class="notice" role="status">Conectando ao MotherDuck…</div>
    <div id="dashboard" hidden>
      <section class="section-head"><div><p class="eyebrow" id="context"></p><h2>Eleitos por partido</h2></div><label class="compact">Cargo<select id="office"><option value="*">Todos</option></select></label></section>
      <section class="grid two">
        <article class="card party-card"><div id="seat-total" class="metric"></div><div id="parties"></div></article>
        <article class="card"><p class="eyebrow">Questão 2</p><h2>Gasto e chance de eleição</h2><p class="muted small">Quatro faixas de mesmo intervalo em reais, por cargo. A barra indica a taxa de eleitos.</p><div id="spending"></div></article>
      </section>
    </div>

    <section id="detail" class="detail" hidden></section>
    <footer><span>Fonte: <a href="https://dadosabertos.tse.jus.br/" target="_blank" rel="noreferrer">Dados Abertos do TSE</a>.</span><span>Consultas ao vivo em MotherDuck · BDR-TSE</span></footer>
  </main>`;

const ufSelect = document.querySelector<HTMLSelectElement>("#uf")!;
const yearSelect = document.querySelector<HTMLSelectElement>("#year")!;
const officeSelect = document.querySelector<HTMLSelectElement>("#office")!;
const notice = document.querySelector<HTMLDivElement>("#notice")!;
const dash = document.querySelector<HTMLDivElement>("#dashboard")!;
const detail = document.querySelector<HTMLDivElement>("#detail")!;
const search = document.querySelector<HTMLInputElement>("#search")!;
const suggestions = document.querySelector<HTMLDivElement>("#suggestions")!;

let current: Dashboard | undefined;
let debounce: ReturnType<typeof setTimeout>;

function setNotice(message: string, error = false) {
  notice.textContent = message;
  notice.className = error ? "notice error" : "notice";
  notice.hidden = !message;
}

function renderDashboard(data: Dashboard) {
  current = data;
  dash.hidden = false;
  setNotice("");
  document.querySelector("#context")!.textContent = `${UF_NAMES[data.uf]} · ${data.year}`;

  const offices = [...new Set(data.parties.map((row) => String(row.ds_cargo)))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const selected = officeSelect.value;
  officeSelect.innerHTML = `<option value="*">Todos</option>${offices.map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join("")}`;
  if (offices.includes(selected)) officeSelect.value = selected;
  renderPartyChart();
  renderSpending(data.spending);
}

function renderPartyChart() {
  if (!current) return;
  const selectedOffice = officeSelect.value;
  const rows = current.parties.filter((row) => selectedOffice === "*" || row.ds_cargo === selectedOffice);
  const parties = new Map<string, { name: string; total: number; detail: string[] }>();
  for (const row of rows) {
    const acronym = String(row.sg_partido || "S/ partido");
    const party = parties.get(acronym) || { name: String(row.nm_partido || acronym), total: 0, detail: [] };
    party.total += Number(row.qt_eleitos || 0);
    party.detail.push(`${row.ds_cargo}: ${fmt(row.qt_eleitos)}`);
    parties.set(acronym, party);
  }
  const ordered = [...parties.entries()].sort((a, b) => b[1].total - a[1].total);
  const total = ordered.reduce((sum, [, item]) => sum + item.total, 0);
  document.querySelector("#seat-total")!.innerHTML = `<strong>${fmt(total)}</strong><span>eleitos titulares na base</span>`;
  const chart = document.querySelector<HTMLDivElement>("#parties")!;
  if (!ordered.length) { chart.innerHTML = empty; return; }
  chart.innerHTML = `<div class="party-strip">${ordered.map(([sg, item]) => `<i title="${esc(sg)}: ${item.total}" style="width:${total ? item.total / total * 100 : 0}%;background:${partyColor(sg)}"></i>`).join("")}</div>
    <ol class="rank">${ordered.map(([sg, item]) => `<li title="${esc(item.detail.join(" · "))}"><span class="party"><i style="background:${partyColor(sg)}"></i><b>${esc(sg)}</b><small>${esc(item.name)}</small></span><span class="bar"><i style="width:${Math.max(2, item.total / (ordered[0]?.[1].total || 1) * 100)}%;background:${partyColor(sg)}"></i></span><strong>${fmt(item.total)}</strong></li>`).join("")}</ol>`;
}

function renderSpending(rows: Row[]) {
  const host = document.querySelector<HTMLDivElement>("#spending")!;
  const groups = new Map<string, Row[]>();
  for (const row of rows) groups.set(String(row.ds_cargo), [...(groups.get(String(row.ds_cargo)) || []), row]);
  if (!groups.size) { host.innerHTML = empty; return; }
  host.innerHTML = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], "pt-BR")).map(([office, values]) => {
    const count = values.reduce((sum, row) => sum + Number(row.qtd_candidatos_na_faixa || 0), 0);
    const elected = values.reduce((sum, row) => sum + Number(row.qtd_eleitos || 0), 0);
    const max = Math.max(...values.map((row) => Number(row.gasto_maximo || row.teto_faixa || 0)));
    const buckets = [1, 2, 3, 4].map((bucket) => values.find((row) => Number(row.faixa_financeira) === bucket));
    return `<article class="spend-group"><div class="spend-title"><b>${esc(office)}</b><span>${fmt(elected)} eleitos / ${fmt(count)} candidatos</span></div><div class="bars">${buckets.map((row, index) => {
      const pct = Number(row?.taxa_sucesso_pct || 0);
      const upper = max * (index + 1) / 4;
      return `<div class="bucket" title="${row ? `${fmt(row.qtd_eleitos)} eleitos em ${fmt(row.qtd_candidatos_na_faixa)} candidatos` : "Sem candidatos"}"><div class="barspace"><i style="height:${Math.max(2, pct)}%"></i><b>${row ? `${pct.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%` : "—"}</b></div><small>até ${money(upper)}</small></div>`;
    }).join("")}</div></article>`;
  }).join("");
}

async function loadMeta(uf: string) {
  const meta = await api<{ years: number[] }>(`/api/meta?uf=${uf}`);
  const preferred = Number(yearSelect.value);
  yearSelect.innerHTML = meta.years.map((year) => `<option value="${year}">${year}</option>`).join("");
  yearSelect.value = String(meta.years.includes(preferred) ? preferred : meta.years[0]);
  await loadDashboard();
}

async function loadDashboard() {
  setNotice("Consultando as views no MotherDuck…");
  try {
    const data = await api<Dashboard>(`/api/dashboard?uf=${ufSelect.value}&year=${yearSelect.value}`);
    renderDashboard(data);
  } catch (error) { setNotice(error instanceof Error ? error.message : "Falha ao carregar dados.", true); }
}

function objectList(value: unknown): Row[] {
  if (Array.isArray(value)) return value as Row[];
  if (typeof value === "string") {
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed as Row[] : []; } catch { return []; }
  }
  return [];
}

async function openCandidate(id: string) {
  detail.hidden = false;
  detail.innerHTML = `<article class="card"><p class="muted">Carregando histórico…</p></article>`;
  try {
    const person = await api<Row & { candidacies: Row[] }>(`/api/candidate/${encodeURIComponent(id)}`);
    const candidacies = person.candidacies || [];
    detail.innerHTML = `<article class="card profile"><button class="close" data-close>Fechar</button><p class="eyebrow">Trajetória na base</p><h2>${esc(person.nm_candidato)}</h2><p class="muted">${candidacies.length} candidaturas · ${candidacies.filter((c) => String(c.situacao || "").startsWith("ELEITO")).length} eleições</p>
      <div class="timeline">${candidacies.map((c) => {
        const local = c.nm_municipio ? `${c.nm_municipio} (${c.uf})` : c.uf;
        const receipts = objectList(c.receitas), expenses = objectList(c.despesas), assets = objectList(c.bens);
        return `<article class="timeline-item"><span class="year">${esc(c.ano_eleicao)}</span><div class="timeline-content"><div class="headline"><h3>${esc(c.cargo)}</h3><span class="tag" style="--party:${partyColor(c.partido)}">${esc(c.partido || "—")}</span><span class="result">${esc(c.situacao || "Sem resultado")}</span></div><p class="muted">${esc(local || "Local não informado")} · urna: ${esc(c.nm_urna_candidato || "—")}</p>
          <div class="facts"><div><small>Votos (1º turno)</small><b>${fmt(c.votos)}</b></div><div><small>Receitas</small><b>${money(c.total_receitas)}</b><small>${money(c.receitas_publicas)} públicas · ${money(c.receitas_privadas)} privadas</small></div><div><small>Despesas pagas</small><b>${money(c.total_despesas)}</b></div><div><small>Patrimônio declarado</small><b>${money(c.patrimonio_declarado)}</b></div></div>
          ${receipts.length ? `<details><summary>Receitas por fonte</summary>${receipts.map((r) => `<p>${esc(r.fonte)} · ${esc(r.origem)} · ${money(r.valor)} (${fmt(r.qtd)})</p>`).join("")}</details>` : ""}
          ${expenses.length ? `<details><summary>Maiores despesas (${fmt(c.qt_despesas)} registros)</summary>${expenses.map((r) => `<p>${esc(r.despesa || "Sem descrição")} · ${money(r.valor)}</p>`).join("")}</details>` : ""}
          ${assets.length ? `<details><summary>Bens declarados (${assets.length})</summary>${assets.map((r) => `<p>${esc(r.tipo)} · ${esc(r.descricao)} · ${money(r.valor)}</p>`).join("")}</details>` : ""}</div></article>`;
      }).join("") || empty}</div><p class="footnote">A trajetória reúne registros ligados ao mesmo identificador de pessoa do projeto. Sem título eleitoral divulgado, a identidade fica restrita à candidatura.</p></article>`;
  } catch (error) { detail.innerHTML = `<article class="card"><button class="close" data-close>Fechar</button><p class="error-text">${esc(error instanceof Error ? error.message : "Erro ao carregar histórico.")}</p></article>`; }
  detail.scrollIntoView({ behavior: "smooth", block: "start" });
}

const OFFICE_NAMES: Record<number, string> = { 3: "Governador", 5: "Senador", 6: "Deputado federal", 7: "Deputado estadual", 8: "Deputado distrital", 11: "Prefeito", 13: "Vereador" };

async function openMunicipality(code: string) {
  detail.hidden = false;
  detail.innerHTML = `<article class="card"><p class="muted">Carregando município…</p></article>`;
  try {
    const m = await api<Row & { attendance: Row[]; electorate: Row[]; parties: Row[]; topCandidates: Row[] }>(`/api/municipality/${encodeURIComponent(code)}`);
    detail.innerHTML = `<article class="card profile"><button class="close" data-close>Fechar</button><p class="eyebrow">Município · ${esc(m.uf)}</p><h2>${esc(m.nome)}</h2><p class="muted">Código TSE ${esc(m.id)}${m.ibge ? ` · IBGE ${esc(m.ibge)}` : ""}</p>
      <div class="municipal-grid"><section><h3>Comparecimento</h3>${m.attendance.length ? `<div class="table-wrap"><table><thead><tr><th>Ano / turno</th><th>Aptos</th><th>Compareceram</th><th>Abstenção</th></tr></thead><tbody>${m.attendance.map((r) => `<tr><td>${fmt(r.ano_eleicao)} / ${fmt(r.nr_turno)}º</td><td>${fmt(r.qt_aptos)}</td><td>${fmt(r.qt_comparecimento)}</td><td>${fmt(r.qt_abstencao)}</td></tr>`).join("")}</tbody></table></div>` : empty}</section>
      <section><h3>Faixas etárias do eleitorado</h3>${m.electorate.length ? `<div class="table-wrap"><table><thead><tr><th>Ano</th><th>Faixa</th><th>Eleitores</th></tr></thead><tbody>${m.electorate.map((r) => `<tr><td>${fmt(r.ano_eleicao)}</td><td>${esc(r.ds_faixa_etaria)}</td><td>${fmt(r.qt_eleitores)}</td></tr>`).join("")}</tbody></table></div>` : empty}</section>
      <section><h3>Mais votados por cargo</h3>${m.topCandidates.length ? `<div class="simple-list">${m.topCandidates.map((r) => `<button class="list-row" data-candidate="${esc(r.id_pessoa_projeto)}"><span>${fmt(r.ano_eleicao)} · ${esc(OFFICE_NAMES[Number(r.cd_cargo)] || r.cd_cargo)}<small>${esc(r.nm_urna_candidato)} · ${esc(r.sg_partido)}</small></span><b>${fmt(r.qt_votos_nominais)}</b></button>`).join("")}</div>` : empty}</section>
      <section><h3>Votos por partido</h3>${m.parties.length ? `<div class="simple-list">${m.parties.map((r) => `<div class="list-row"><span>${fmt(r.ano_eleicao)} · ${esc(OFFICE_NAMES[Number(r.cd_cargo)] || r.cd_cargo)}<small>${esc(r.sg_partido)}</small></span><b>${fmt(Number(r.qt_votos_nominais || 0) + Number(r.qt_votos_legenda || 0))}</b></div>`).join("")}</div>` : empty}</section></div></article>`;
  } catch (error) { detail.innerHTML = `<article class="card"><button class="close" data-close>Fechar</button><p class="error-text">${esc(error instanceof Error ? error.message : "Erro ao carregar município.")}</p></article>`; }
  detail.scrollIntoView({ behavior: "smooth", block: "start" });
}

function hideSuggestions() { suggestions.hidden = true; suggestions.innerHTML = ""; }

search.addEventListener("input", () => {
  clearTimeout(debounce);
  const term = search.value.trim();
  if (term.length < 2) { hideSuggestions(); return; }
  debounce = setTimeout(async () => {
    try {
      const results = await api<{ municipalities: Row[]; candidates: Row[] }>(`/api/search?uf=${ufSelect.value}&q=${encodeURIComponent(term)}`);
      const items = [
        ...results.municipalities.map((row) => ({ type: "municipality", id: row.id, label: row.nome, note: "Município" })),
        ...results.candidates.map((row) => ({ type: "candidate", id: row.id, label: row.urna || row.nome, note: `Candidato · ${row.anos}` })),
      ];
      suggestions.innerHTML = items.length ? items.map((item) => `<button class="suggestion" data-type="${item.type}" data-id="${esc(item.id)}"><span>${esc(item.label)}</span><small>${esc(item.note)}</small></button>`).join("") : `<p class="muted">Nenhum resultado neste estado.</p>`;
      suggestions.hidden = false;
    } catch (error) { suggestions.innerHTML = `<p class="error-text">${esc(error instanceof Error ? error.message : "Erro de busca.")}</p>`; suggestions.hidden = false; }
  }, 220);
});

suggestions.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-type]");
  if (!button) return;
  hideSuggestions();
  if (button.dataset.type === "candidate") void openCandidate(button.dataset.id!);
  else void openMunicipality(button.dataset.id!);
});

detail.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  if (target.closest("[data-close]")) detail.hidden = true;
  const candidate = target.closest<HTMLElement>("[data-candidate]");
  if (candidate?.dataset.candidate) void openCandidate(candidate.dataset.candidate);
});

ufSelect.addEventListener("change", () => { detail.hidden = true; hideSuggestions(); void loadMeta(ufSelect.value); });
yearSelect.addEventListener("change", () => void loadDashboard());
officeSelect.addEventListener("change", renderPartyChart);

try {
  const health = await api<{ ok: boolean }>("/api/health");
  if (health.ok) await loadMeta("SP");
} catch (error) {
  setNotice(error instanceof Error ? error.message : "Não foi possível conectar ao MotherDuck.", true);
}
