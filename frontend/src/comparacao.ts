// Modo trivia: duas pessoas escolhidas livremente e seus históricos completos.
import { brlc, cargoNome, esc, fmt, request, sitTxt, titulo } from "./util";

type Candidato = { id: number; nome: string; urna?: string; anos: string[]; cargos: string[]; estados?: string };
type Candidatura = Record<string, any> & { ano_eleicao: number };
type Perfil = { nm_candidato: string; dt_nascimento?: string; ds_grau_instrucao?: string; ds_genero?: string; ds_cor_raca?: string; candidacies: Candidatura[] };
const escolhidos: Record<string, Candidato | null> = { a: null, b: null };
const perfis: Record<string, Perfil | null> = { a: null, b: null };
const timers: Record<string, ReturnType<typeof setTimeout> | null> = { a: null, b: null };
const aborts: Record<string, AbortController | null> = { a: null, b: null };
const n = (v: unknown) => Number(v) || 0;
const anos = (p: Perfil) => [...new Set((p.candidacies || []).map(c => Number(c.ano_eleicao)))].sort((a,b) => a-b);
const dinheiro = (v: unknown) => brlc(n(v));
const arr = (v: unknown): any[] => { if (Array.isArray(v)) return v; try { return JSON.parse(String(v || "[]")); } catch { return []; } };

for (const side of ["a", "b"]) {
  const input = document.getElementById(`duelo-busca-${side}`) as HTMLInputElement;
  const options = document.getElementById(`duelo-opcoes-${side}`)!;
  const clear = input.parentElement!.querySelector(".duelo-limpar") as HTMLButtonElement;
  input.addEventListener("input", () => { clearTimeout(timers[side]!); timers[side] = setTimeout(() => buscar(side, input.value), 220); });
  input.addEventListener("keydown", ev => {
    const buttons = [...options.querySelectorAll("button")];
    if (ev.key === "Escape") { options.hidden = true; input.setAttribute("aria-expanded","false"); return; }
    if ((ev.key === "ArrowDown" || ev.key === "ArrowUp") && buttons.length) { ev.preventDefault(); (ev.key === "ArrowDown" ? buttons[0] : buttons.at(-1))!.focus(); }
    if (ev.key === "Enter" && buttons.length) { ev.preventDefault(); (buttons[0] as HTMLButtonElement).click(); }
  });
  options.addEventListener("keydown", ev => {
    const buttons = [...options.querySelectorAll("button")];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (ev.key === "Escape") { options.hidden = true; input.setAttribute("aria-expanded","false"); input.focus(); }
    else if (ev.key === "ArrowDown" && at >= 0) { ev.preventDefault(); buttons[Math.min(at+1,buttons.length-1)].focus(); }
    else if (ev.key === "ArrowUp" && at >= 0) { ev.preventDefault(); if (at === 0) input.focus(); else buttons[at-1].focus(); }
    else if (ev.key === "Enter" && at >= 0) { ev.preventDefault(); (buttons[at] as HTMLButtonElement).click(); }
  });
  clear.onclick = () => { aborts[side]?.abort(); escolhidos[side] = null; perfis[side] = null; input.value = ""; input.disabled = false; clear.hidden = true; options.hidden = true; input.setAttribute("aria-expanded","false"); desenharEscolhido(side); desenharResultado(); input.focus(); };
}

async function buscar(side: string, termo: string) {
  const input = document.getElementById(`duelo-busca-${side}`) as HTMLInputElement;
  const box = document.getElementById(`duelo-opcoes-${side}`)!;
  aborts[side]?.abort();
  if (termo.trim().length < 2 || input.disabled) { box.hidden = true; input.setAttribute("aria-expanded","false"); return; }
  const controller = aborts[side] = new AbortController();
  box.innerHTML = `<p class="duelo-opcao-status">Procurando no arquivo…</p>`; box.hidden = false; input.setAttribute("aria-expanded","true");
  try {
    const r = await request(`/api/candidate-search?q=${encodeURIComponent(termo.trim())}`, { silencioso: true, signal: controller.signal });
    if (aborts[side] !== controller) return;
    const list: Candidato[] = r.candidates || [];
    box.innerHTML = list.length ? list.map(c => `<button type="button" role="option" data-id="${c.id}"><b>${esc(titulo(c.urna || c.nome))}</b><span>${esc(titulo(c.nome))} · ${esc(c.cargos.map(cargoNome).join(", "))}</span><small>${esc(c.anos.join(" · "))} <i>${esc(c.estados || "")}</i></small></button>`).join("") : `<p class="duelo-opcao-status">Nenhum nome encontrado. Tente sobrenome ou nome de urna.</p>`;
    box.querySelectorAll("button").forEach((button, i) => button.addEventListener("click", () => selecionar(side, list[i], input, box)));
  } catch (error: any) {
    if (error.name === "AbortError") return;
    box.innerHTML = `<p class="duelo-opcao-status">A busca falhou. Confira a conexão e tente novamente.</p>`;
  }
}

async function selecionar(side: string, candidato: Candidato, input: HTMLInputElement, box: HTMLElement) {
  if (Object.entries(escolhidos).some(([s, c]) => s !== side && c?.id === candidato.id)) {
    box.innerHTML = `<p class="duelo-opcao-status">Esse nome já está no outro lado. Escolha alguém diferente.</p>`; return;
  }
  escolhidos[side] = candidato; perfis[side] = null;
  input.value = titulo(candidato.urna || candidato.nome); input.disabled = true; box.hidden = true; input.setAttribute("aria-expanded","false");
  input.parentElement!.querySelector(".duelo-limpar")!.removeAttribute("hidden");
  desenharEscolhido(side); desenharResultado();
  try {
    const perfil = await request(`/api/candidate/${candidato.id}`, { silencioso: true });
    if (escolhidos[side]?.id !== candidato.id) return;
    perfis[side] = perfil; desenharResultado();
  } catch {
    const out = document.getElementById("duelo-resultado")!;
    out.innerHTML = `<p class="duelo-erro">Não foi possível carregar o histórico de ${esc(titulo(candidato.nome))}. Remova o nome e tente de novo.</p>`;
  }
}

function desenharEscolhido(side: string) {
  const node = document.getElementById(`duelo-escolhido-${side}`)!;
  const c = escolhidos[side];
  node.textContent = c ? `${c.anos.length} eleições · ${c.cargos.map(cargoNome).join(", ")}` : "À espera de um nome";
}

function resumir(p: Perfil) {
  const cs = p.candidacies || [];
  return { cs, years: anos(p), votos: cs.reduce((s,c)=>s+n(c.votos),0), gastos: cs.reduce((s,c)=>s+n(c.total_despesas),0), receitas: cs.reduce((s,c)=>s+n(c.total_receitas),0), patrimonio: cs.reduce((s,c)=>s+n(c.patrimonio_declarado),0), eleito: cs.filter(c=>["ELEITO","ELEITO POR QP","ELEITO POR MÉDIA"].includes(String(c.situacao).toUpperCase())).length };
}
function idadeEm(data?: string, ano?: number) {
  if (!data || !ano) return null;
  const d = new Date(data); if (Number.isNaN(d.getTime())) return null;
  // O primeiro turno cai no primeiro domingo de outubro; em 2020 foi adiado
  // para 15 de novembro. A idade acompanha o dia da eleição, não o ano civil.
  const eleicao = ano === 2020 ? new Date(Date.UTC(ano,10,15)) : new Date(Date.UTC(ano,9,1));
  if (ano !== 2020) eleicao.setUTCDate(eleicao.getUTCDate() + ((7-eleicao.getUTCDay())%7));
  let idade = ano - d.getUTCFullYear();
  if (eleicao < new Date(Date.UTC(ano,d.getUTCMonth(),d.getUTCDate()))) idade--;
  return idade;
}
function frase(a: Perfil, b: Perfil, sa: ReturnType<typeof resumir>, sb: ReturnType<typeof resumir>) {
  const fatos: string[] = [];
  const ratio = (x:number,y:number) => y > 0 ? x/y : null;
  if (sa.gastos !== sb.gastos) {
    const [lider,outro,nome] = sa.gastos > sb.gastos ? [sa.gastos,sb.gastos,a.nm_candidato] : [sb.gastos,sa.gastos,b.nm_candidato];
    const q = ratio(lider,outro);
    fatos.push(q ? `${titulo(nome)} declarou ${q.toLocaleString("pt-BR",{maximumFractionDigits:1})}× as despesas de campanha do outro — ${dinheiro(lider)} contra ${dinheiro(outro)}.` : `${titulo(nome)} declarou ${dinheiro(lider)} em despesas de campanha; o outro não tem despesa registrada.`);
  }
  const comuns = sa.years.filter(y=>sb.years.includes(y));
  let maior: {year:number; aa:number; ab:number} | null = null;
  for (const y of comuns) { const aa=idadeEm(a.dt_nascimento,y), ab=idadeEm(b.dt_nascimento,y); if (aa != null && ab != null && (!maior || Math.abs(aa-ab)>Math.abs(maior.aa-maior.ab))) maior={year:y,aa,ab}; }
  if (maior && maior.aa !== maior.ab) fatos.push(`Em ${maior.year}, ${titulo(a.nm_candidato)} tinha ${maior.aa} anos; ${titulo(b.nm_candidato)}, ${maior.ab}.`);
  if (sa.votos !== sb.votos) { const nome = sa.votos>sb.votos?a.nm_candidato:b.nm_candidato; fatos.push(`Somando as candidaturas da base, ${titulo(nome)} recebeu mais votos: ${fmt.format(Math.max(sa.votos,sb.votos))} contra ${fmt.format(Math.min(sa.votos,sb.votos))}.`); }
  if (sa.receitas !== sb.receitas) { const nome = sa.receitas>sb.receitas?a.nm_candidato:b.nm_candidato; fatos.push(`${titulo(nome)} arrecadou mais nas campanhas registradas: ${dinheiro(Math.max(sa.receitas,sb.receitas))} no total.`); }
  if (sa.years.length !== sb.years.length) { const nome=sa.years.length>sb.years.length?a.nm_candidato:b.nm_candidato; fatos.push(`${titulo(nome)} voltou às urnas em ${Math.abs(sa.years.length-sb.years.length)} ${Math.abs(sa.years.length-sb.years.length)===1?"eleição":"eleições"} a mais.`); }
  if (!fatos.length) fatos.push("Empate curioso: os números disponíveis ficaram iguais nos recortes comparáveis.");
  return fatos;
}
function detalheLista(items: any[], rotulo: string, key: string, contexto = "") {
  if (!items.length) return "";
  return `<details class="duelo-detalhes"><summary>${rotulo}: ${items.length} registros${contexto ? ` · ${esc(contexto)}` : ""}</summary><ul>${items.map(i=>`<li><span>${esc(i[key] || i.fonte || i.tipo || "Registro")}</span><b>${dinheiro(i.valor)}</b></li>`).join("")}</ul></details>`;
}
function candidaturas(cs: Candidatura[], nascimento?: string) {
  if (!cs.length) return `<p class="duelo-sem-candidatura">Sem candidatura nesta eleição na base.</p>`;
  return cs.map(c=>{
    const cidade = [c.nm_municipio,c.uf].filter(Boolean).join(" · ");
    const bens = arr(c.bens), receitas = arr(c.receitas), despesas = arr(c.despesas);
    const idade = idadeEm(nascimento, Number(c.ano_eleicao));
    const origemReceita = `público ${dinheiro(c.receitas_publicas)} · privado ${dinheiro(c.receitas_privadas)}`;
    const turno = c.turno ? ` · ${c.turno}º turno` : "";
    return `<article class="duelo-candidatura">
      <div class="duelo-cargo"><b>${esc(cargoNome(c.cargo))}</b><span>${esc(c.partido || "Partido não informado")} ${c.situacao ? `· ${esc(sitTxt(c.situacao))}` : ""}${turno}</span></div>
      ${c.nm_urna_candidato?`<p class="duelo-local">Na urna: ${esc(titulo(c.nm_urna_candidato))}</p>`:""}${cidade?`<p class="duelo-local">${esc(cidade)}</p>`:""}
      <dl class="duelo-metricas"><div><dt>Idade no ano</dt><dd>${idade == null ? "Sem dado" : `${idade} anos`}</dd></div><div><dt>Votos</dt><dd>${c.votos==null?"Sem dado":fmt.format(n(c.votos))}</dd></div><div><dt>Arrecadado</dt><dd>${dinheiro(c.total_receitas)}</dd></div><div><dt>Despesas</dt><dd>${dinheiro(c.total_despesas)}</dd></div><div><dt>Patrimônio declarado</dt><dd>${dinheiro(c.patrimonio_declarado)}</dd></div></dl>
      ${detalheLista(receitas,"Fontes de receita","fonte",origemReceita)}${detalheLista(despesas,"Despesas pagas","despesa",`${fmt.format(n(c.qt_despesas))} lançamentos · ${dinheiro(c.total_despesas)}`)}${detalheLista(bens,"Bens declarados","descricao")}
    </article>`;
  }).join("");
}
function desenharResultado() {
  const out = document.getElementById("duelo-resultado")!;
  const a=perfis.a,b=perfis.b;
  if (!a || !b) {
    if (escolhidos.a || escolhidos.b) out.innerHTML = `<div class="duelo-carregando"><span></span>Buscando os cadernos eleitorais…</div>`;
    else out.innerHTML = `<div class="duelo-vazio"><span aria-hidden="true">＋</span><p>Escolha dois candidatos para revelar as curiosidades que a história eleitoral guardou.</p></div>`;
    return;
  }
  const sa=resumir(a), sb=resumir(b), all=[...new Set([...sa.years,...sb.years])].sort((x,y)=>x-y);
  const avatar = (p:Perfil, s:string) => {
    const foto = [...p.candidacies].sort((x,y)=>Number(y.ano_eleicao)-Number(x.ano_eleicao)).find(c=>Number(c.ano_eleicao)<=2016 && c.sq_candidato);
    const src = foto ? `/api/photo/${Number(foto.ano_eleicao)}/${Number(foto.sq_candidato)}` : "";
    return `<div class="duelo-identidade lado-${s}"><span class="duelo-avatar">${esc((p.nm_candidato||"?").trim().split(/\s+/).slice(0,2).map(x=>x[0]).join("").toUpperCase())}${src?`<img data-duelo-foto src="${src}" alt="" aria-hidden="true">`:""}</span><div><h3>${esc(titulo(p.nm_candidato))}</h3><p>${esc([p.ds_genero,p.ds_cor_raca].filter(Boolean).map(titulo).join(" · ") || "Perfil eleitoral")}</p></div></div>`;
  };
  const summary = (p:Perfil,s:ReturnType<typeof resumir>) => `<dl class="duelo-resumo"><div><dt>Nas urnas</dt><dd>${s.years.length} eleições</dd></div><div><dt>Votos somados</dt><dd>${fmt.format(s.votos)}</dd></div><div><dt>Receita de campanha</dt><dd>${dinheiro(s.receitas)}</dd></div><div><dt>Despesas</dt><dd>${dinheiro(s.gastos)}</dd></div><div><dt>Vitórias registradas</dt><dd>${s.eleito}</dd></div><div><dt>Escolaridade</dt><dd>${esc(titulo(p.ds_grau_instrucao||"Não informada"))}</dd></div></dl>`;
  out.innerHTML = `<div class="duelo-placar"><div class="duelo-identidades">${avatar(a,"a")}<span class="duelo-vs pequeno">×</span>${avatar(b,"b")}</div><div class="duelo-saldos">${summary(a,sa)}<span class="duelo-saldo-vs" aria-hidden="true">×</span>${summary(b,sb)}</div></div><section class="duelo-trivia" aria-labelledby="duelo-fatos"><h3 id="duelo-fatos">A urna também conta histórias</h3><ol>${frase(a,b,sa,sb).map((f,i)=>`<li><span>${String(i+1).padStart(2,"0")}</span><p>${esc(f)}</p></li>`).join("")}</ol></section><section class="duelo-linha"><div class="duelo-linha-cab"><h3>Uma eleição de cada vez</h3><p>Idade no dia do 1º turno. Valores financeiros nominais, sem correção pela inflação.</p></div>${all.map(y=>`<article class="duelo-ano"><h4>${y}</h4><div class="duelo-ano-lados"><div>${candidaturas(sa.cs.filter(c=>Number(c.ano_eleicao)===y),a.dt_nascimento)}</div><div>${candidaturas(sb.cs.filter(c=>Number(c.ano_eleicao)===y),b.dt_nascimento)}</div></div></article>`).join("")}</section>`;
  out.querySelectorAll<HTMLImageElement>("[data-duelo-foto]").forEach(img=>img.addEventListener("error",()=>img.remove(),{once:true}));
}
