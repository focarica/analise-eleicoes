// Modo trivia: duas pessoas escolhidas livremente e seus históricos completos.
import { brlc, cargoNome, esc, fmt, request, sitTxt, titulo } from "./util";

type Candidato = { id: number; nome: string; urna?: string; anos: string[]; cargos: string[]; estados?: string };
type Candidatura = Record<string, any> & { ano_eleicao: number };
type Perfil = { nm_candidato: string; dt_nascimento?: string; ds_grau_instrucao?: string; ds_genero?: string; ds_cor_raca?: string; candidacies: Candidatura[] };
const escolhidos: Record<string, Candidato | null> = { a: null, b: null };
const perfis: Record<string, Perfil | null> = { a: null, b: null };
const timers: Record<string, ReturnType<typeof setTimeout> | null> = { a: null, b: null };
const aborts: Record<string, AbortController | null> = { a: null, b: null };
const modal = document.getElementById("duelo-modal") as HTMLDialogElement;
const abrirModal = document.getElementById("duelo-abrir") as HTMLButtonElement;
const fecharModal = document.getElementById("duelo-fechar") as HTMLButtonElement;
abrirModal.addEventListener("click", () => {
  if (modal.open) return;
  modal.showModal();
  abrirModal.setAttribute("aria-expanded","true");
  document.getElementById("duelo-busca-a")?.focus({preventScroll:true});
});
fecharModal.addEventListener("click", () => modal.close());
modal.addEventListener("click", ev => { if (ev.target === modal) modal.close(); });
modal.addEventListener("close", () => {
  abrirModal.setAttribute("aria-expanded","false");
  abrirModal.focus({preventScroll:true});
});
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
function fraseDaCandidatura(c: Candidatura, nome: string, nascimento?: string) {
  const idade = idadeEm(nascimento, Number(c.ano_eleicao));
  const cargo = cargoNome(c.cargo);
  const onde = [c.nm_municipio, c.uf].filter(Boolean).map(titulo).join(" · ");
  const disputa = `${cargo}${c.partido ? ` pelo ${c.partido}` : ""}${onde ? ` em ${onde}` : ""}`;
  const votos = c.votos == null ? "votos não informados" : `${fmt.format(n(c.votos))} votos`;
  const idadeTxt = idade == null ? "" : `Aos ${idade} anos, `;
  const eleito = ["ELEITO","ELEITO POR QP","ELEITO POR MÉDIA"].includes(String(c.situacao).toUpperCase());
  const abertura = eleito
    ? `${idadeTxt}${titulo(nome)} foi eleito para ${disputa} com ${votos}.`
    : `${idadeTxt}${titulo(nome)} disputou ${disputa}, teve ${votos} e terminou como ${c.situacao ? sitTxt(c.situacao) : "resultado não informado"}.`;
  const campanha = `Na mesma campanha, arrecadou ${dinheiro(c.total_receitas)}, registrou ${dinheiro(c.total_despesas)} em despesas pagas e declarou ${dinheiro(c.patrimonio_declarado)} em bens.`;
  return `${abertura} ${campanha}`;
}
function resumoCenario(a: Perfil, b: Perfil, sa: ReturnType<typeof resumir>, sb: ReturnType<typeof resumir>, comuns: number[]) {
  const inicioA=sa.years[0], inicioB=sb.years[0], fimA=sa.years.at(-1)!, fimB=sb.years.at(-1)!;
  const anosA=sa.years.length, anosB=sb.years.length, faixaA=fimA-inicioA, faixaB=fimB-inicioB;
  if (!comuns.length && fimA < inicioB) return {
    titulo: "Uma trajetória registrada terminou antes da outra começar",
    texto: `A última candidatura de ${titulo(a.nm_candidato)} nesta amostra foi em ${fimA}; ${titulo(b.nm_candidato)} aparece pela primeira vez em ${inicioB}, ${inicioB-fimA} anos depois.`,
  };
  if (!comuns.length && fimB < inicioA) return {
    titulo: "Uma trajetória registrada terminou antes da outra começar",
    texto: `${titulo(b.nm_candidato)} tem seu último registro em ${fimB}. ${titulo(a.nm_candidato)} só aparece na amostra em ${inicioA}, ${inicioA-fimB} anos depois.`,
  };
  if (!comuns.length) return {
    titulo: "As trajetórias se alternam, sem um pleito em comum",
    texto: `${titulo(a.nm_candidato)} aparece nos anos ${sa.years.join(", ")}; ${titulo(b.nm_candidato)}, em ${sb.years.join(", ")}. Os intervalos se cruzam no calendário, mas não há eleição registrada para os dois no mesmo ano.`,
  };
  if (inicioA===inicioB && fimA===fimB) return {
    titulo: `Os dois aparecem pela primeira vez em ${inicioA} e têm registros até ${fimA}`,
    texto: `A base registra ${anosA} anos eleitorais para ${titulo(a.nm_candidato)} e ${anosB} para ${titulo(b.nm_candidato)}; as aparições entre esses extremos é que diferem.`,
  };
  if (inicioA===inicioB) return {
    titulo: `Os dois estrearam nos registros em ${inicioA}; depois, suas trilhas se separaram`,
    texto: `${titulo(a.nm_candidato)} aparece pela última vez em ${fimA}; ${titulo(b.nm_candidato)}, em ${fimB}. Na amostra, são ${anosA} e ${anosB} anos eleitorais registrados, respectivamente.`,
  };
  if (anosA-anosB>=2 || faixaA-faixaB>=8) return {
    titulo: `${titulo(a.nm_candidato)} tem uma trajetória registrada mais longa`,
    texto: `Aparece em ${anosA} anos eleitorais, de ${inicioA} a ${fimA}; ${titulo(b.nm_candidato)} aparece em ${anosB}, de ${inicioB} a ${fimB}.`,
  };
  if (anosB-anosA>=2 || faixaB-faixaA>=8) return {
    titulo: `${titulo(b.nm_candidato)} tem uma trajetória registrada mais longa`,
    texto: `Aparece em ${anosB} anos eleitorais, de ${inicioB} a ${fimB}; ${titulo(a.nm_candidato)} aparece em ${anosA}, de ${inicioA} a ${fimA}.`,
  };
  const cedo=inicioA<inicioB?a:b, tarde=cedo===a?b:a;
  return {
    titulo: `${titulo(cedo.nm_candidato)} aparece primeiro nos registros`,
    texto: `A primeira candidatura de ${titulo(cedo.nm_candidato)} é de ${Math.min(inicioA,inicioB)}; a de ${titulo(tarde.nm_candidato)} vem em ${Math.max(inicioA,inicioB)}. As trajetórias se encontram em ${comuns.length} ${comuns.length===1?"ano":"anos"} eleitorais.`,
  };
}
function maiorRegistro(cs: Candidatura[], campo: string) {
  return cs.filter(c=>c[campo]!=null).reduce<Candidatura|null>((best,c)=>!best || n(c[campo])>n(best[campo])?c:best,null);
}
function fatosTrajetoria(a: Perfil, b: Perfil, sa: ReturnType<typeof resumir>, sb: ReturnType<typeof resumir>) {
  const fatos: string[] = [];
  const estreiaA=idadeEm(a.dt_nascimento,sa.years[0]), estreiaB=idadeEm(b.dt_nascimento,sb.years[0]);
  if (estreiaA!=null && estreiaB!=null) fatos.push(`Na primeira candidatura registrada, ${titulo(a.nm_candidato)} tinha ${estreiaA} anos (${sa.years[0]}); ${titulo(b.nm_candidato)} tinha ${estreiaB} (${sb.years[0]}).`);
  fatos.push(`${titulo(a.nm_candidato)} aparece em ${sa.years.length} anos eleitorais e ${sa.cs.length} candidaturas; ${titulo(b.nm_candidato)}, em ${sb.years.length} anos e ${sb.cs.length} candidaturas.`);
  if (sa.eleito || sb.eleito) fatos.push(`A base registra ${sa.eleito} candidatura${sa.eleito===1?" eleita":"s eleitas"} para ${titulo(a.nm_candidato)} e ${sb.eleito} para ${titulo(b.nm_candidato)}.`);
  const cargosA=new Set(sa.cs.map(c=>c.cargo).filter(Boolean)), cargosB=new Set(sb.cs.map(c=>c.cargo).filter(Boolean));
  fatos.push(`Disputaram ${cargosA.size} tipo${cargosA.size===1?"":"s"} de cargo (${titulo(a.nm_candidato)}) e ${cargosB.size} (${titulo(b.nm_candidato)}).`);
  const partidosA=new Set(sa.cs.map(c=>c.partido).filter(Boolean)), partidosB=new Set(sb.cs.map(c=>c.partido).filter(Boolean));
  if (partidosA.size>1 || partidosB.size>1) fatos.push(`As candidaturas aparecem sob ${partidosA.size} sigla${partidosA.size===1?"":"s"} partidária${partidosA.size===1?"":"s"} para ${titulo(a.nm_candidato)} e ${partidosB.size} para ${titulo(b.nm_candidato)}.`);
  const maiorIntervalo=(s:ReturnType<typeof resumir>)=>s.years.slice(1).reduce((best,y,i)=>Math.max(best,y-s.years[i]),0);
  const intervaloA=maiorIntervalo(sa), intervaloB=maiorIntervalo(sb);
  if (intervaloA>=4 || intervaloB>=4) fatos.push(`Maior intervalo entre anos eleitorais com candidatura registrada: ${titulo(a.nm_candidato)} ficou ${intervaloA} anos entre registros; ${titulo(b.nm_candidato)}, ${intervaloB} anos.`);
  const locais=(s:ReturnType<typeof resumir>)=>new Set(s.cs.map(c=>[c.nm_municipio,c.uf].filter(Boolean).join(" · ")).filter(Boolean));
  const locaisA=locais(sa), locaisB=locais(sb);
  if (locaisA.size || locaisB.size) fatos.push(`Municípios/UF distintos nos registros: ${titulo(a.nm_candidato)} aparece em ${locaisA.size}; ${titulo(b.nm_candidato)}, em ${locaisB.size}.`);
  const generoA=a.ds_genero&&titulo(a.ds_genero), generoB=b.ds_genero&&titulo(b.ds_genero);
  if (generoA && generoB && generoA!==generoB) fatos.push(`Os perfis cadastrais informam gêneros diferentes: ${titulo(a.nm_candidato)}, ${generoA}; ${titulo(b.nm_candidato)}, ${generoB}.`);
  const escolaridadeA=a.ds_grau_instrucao&&titulo(a.ds_grau_instrucao), escolaridadeB=b.ds_grau_instrucao&&titulo(b.ds_grau_instrucao);
  if (escolaridadeA && escolaridadeB && escolaridadeA!==escolaridadeB) fatos.push(`Escolaridade declarada no cadastro: ${titulo(a.nm_candidato)}, ${escolaridadeA}; ${titulo(b.nm_candidato)}, ${escolaridadeB}.`);
  const racaA=a.ds_cor_raca&&titulo(a.ds_cor_raca), racaB=b.ds_cor_raca&&titulo(b.ds_cor_raca);
  if (racaA && racaB && racaA!==racaB) fatos.push(`Raça/cor informada no cadastro: ${titulo(a.nm_candidato)}, ${racaA}; ${titulo(b.nm_candidato)}, ${racaB}.`);
  for (const [campo,rotulo] of [["votos","maior votação registrada"],["total_despesas","maior despesa de campanha"],["total_receitas","maior arrecadação em uma campanha"],["patrimonio_declarado","maior patrimônio declarado"]] as [string,string][]) {
    const x=maiorRegistro(sa.cs,campo), y=maiorRegistro(sb.cs,campo);
    if (x && y) fatos.push(`${rotulo}: ${titulo(a.nm_candidato)} — ${campo==="votos"?fmt.format(n(x[campo]))+" votos":dinheiro(x[campo])} em ${x.ano_eleicao}, ${cargoNome(x.cargo)}; ${titulo(b.nm_candidato)} — ${campo==="votos"?fmt.format(n(y[campo]))+" votos":dinheiro(y[campo])} em ${y.ano_eleicao}, ${cargoNome(y.cargo)}. Valores financeiros nominais.`);
  }
  const maiorParcelaPublica=(cs:Candidatura[])=>cs.filter(c=>n(c.total_receitas)>0).reduce<Candidatura|null>((best,c)=>!best || n(c.receitas_publicas)/n(c.total_receitas)>n(best.receitas_publicas)/n(best.total_receitas)?c:best,null);
  const pubA=maiorParcelaPublica(sa.cs), pubB=maiorParcelaPublica(sb.cs);
  if (pubA && pubB) fatos.push(`Maior parcela pública entre as receitas de campanha: ${titulo(a.nm_candidato)} teve ${(100*n(pubA.receitas_publicas)/n(pubA.total_receitas)).toLocaleString("pt-BR",{maximumFractionDigits:0})}% em ${pubA.ano_eleicao}; ${titulo(b.nm_candidato)} teve ${(100*n(pubB.receitas_publicas)/n(pubB.total_receitas)).toLocaleString("pt-BR",{maximumFractionDigits:0})}% em ${pubB.ano_eleicao}.`);
  return fatos;
}
function anosSemPar(a: Perfil, b: Perfil, sa: ReturnType<typeof resumir>, sb: ReturnType<typeof resumir>) {
  const anosA = new Set(sa.years), anosB = new Set(sb.years);
  return [...new Set([...sa.years, ...sb.years])].sort((x,y)=>x-y).flatMap(ano => {
    const csA = sa.cs.filter(c=>Number(c.ano_eleicao)===ano);
    const csB = sb.cs.filter(c=>Number(c.ano_eleicao)===ano);
    if (!!csA.length === !!csB.length) return [];
    const ausente = csA.length ? b : a, presente = csA.length ? a : b;
    const registros = csA.length ? csA : csB;
    const anosAusente = csA.length ? anosB : anosA;
    const primeiro = Math.min(...anosAusente), ultimo = Math.max(...anosAusente);
    let contexto: string;
    if (ano < primeiro) contexto = `Antes de ${titulo(ausente.nm_candidato)} aparecer entre as candidaturas desta amostra, em ${ano} `;
    else if (ano > ultimo) contexto = `Depois da última candidatura de ${titulo(ausente.nm_candidato)} registrada nesta amostra, em ${ano} `;
    else contexto = `Em ${ano}, ${titulo(ausente.nm_candidato)} não tem candidatura registrada nesta amostra; enquanto isso, `;
    const nome = presente.nm_candidato;
    return [`${contexto}${registros.map(c=>fraseDaCandidatura(c,nome,presente.dt_nascimento)).join(" ")}`];
  });
}
function opcoesDeCandidatura(cs: Candidatura[]) {
  return cs.map((c,index)=>({c,index})).sort((x,y)=>Number(x.c.ano_eleicao)-Number(y.c.ano_eleicao)||String(x.c.cargo).localeCompare(String(y.c.cargo)));
}
function rotuloCandidatura(c: Candidatura) {
  return [c.ano_eleicao,cargoNome(c.cargo),c.partido,[c.nm_municipio,c.uf].filter(Boolean).join(" · ")].filter(Boolean).join(" · ");
}
function fatosEntreAnos(ca: Candidatura, cb: Candidatura, a: Perfil, b: Perfil) {
  const fatos = [`${titulo(a.nm_candidato)} teve ${ca.votos==null?"votos sem dado":`${fmt.format(n(ca.votos))} votos`} na candidatura de ${ca.ano_eleicao}; ${titulo(b.nm_candidato)} teve ${cb.votos==null?"votos sem dado":`${fmt.format(n(cb.votos))} votos`} na de ${cb.ano_eleicao}.`];
  const ia=idadeEm(a.dt_nascimento,Number(ca.ano_eleicao)), ib=idadeEm(b.dt_nascimento,Number(cb.ano_eleicao));
  if (ia!=null && ib!=null && (ca.ano_eleicao!==cb.ano_eleicao || ia!==ib)) fatos.push(`Em ${ca.ano_eleicao}, ${titulo(a.nm_candidato)} tinha ${ia} anos; em ${cb.ano_eleicao}, ${titulo(b.nm_candidato)} tinha ${ib}.`);
  const comparacao = (rotulo: string, va: unknown, vb: unknown) => {
    const x=n(va), y=n(vb); if (x===y) return null;
    const nome=x>y?a.nm_candidato:b.nm_candidato, maior=Math.max(x,y), menor=Math.min(x,y);
    return menor>0 ? `${titulo(nome)} registrou ${(maior/menor).toLocaleString("pt-BR",{maximumFractionDigits:1})}× ${rotulo} na candidatura de ${x>y?ca.ano_eleicao:cb.ano_eleicao} (${dinheiro(maior)} contra ${dinheiro(menor)}).` : `${titulo(nome)} registrou ${dinheiro(maior)} em ${rotulo}; o outro registro mostra ${dinheiro(menor)}.`;
  };
  for (const [label,x,y] of [["despesas de campanha",ca.total_despesas,cb.total_despesas],["arrecadação de campanha",ca.total_receitas,cb.total_receitas],["patrimônio declarado",ca.patrimonio_declarado,cb.patrimonio_declarado]] as [string,unknown,unknown][]) {
    const f=comparacao(label,x,y); if (f) fatos.push(f);
  }
  return fatos;
}
function ligarComparacaoEntreAnos(out: HTMLElement, a: Perfil, b: Perfil, sa: ReturnType<typeof resumir>, sb: ReturnType<typeof resumir>) {
  const abrir = out.querySelector<HTMLButtonElement>("[data-abrir-anos]");
  const painel = out.querySelector<HTMLElement>("[data-painel-anos]");
  const selecionarA = out.querySelector<HTMLSelectElement>("[data-ano-a]");
  const selecionarB = out.querySelector<HTMLSelectElement>("[data-ano-b]");
  const executar = out.querySelector<HTMLButtonElement>("[data-executar-anos]");
  const resultado = out.querySelector<HTMLElement>("[data-resultado-anos]");
  if (!abrir || !painel || !selecionarA || !selecionarB || !executar || !resultado) return;
  const opA=opcoesDeCandidatura(sa.cs), opB=opcoesDeCandidatura(sb.cs);
  const preencher=(select:HTMLSelectElement, opcoes:{c:Candidatura;index:number}[])=>{
    select.innerHTML=opcoes.map(o=>`<option value="${o.index}">${esc(rotuloCandidatura(o.c))}</option>`).join("");
  };
  preencher(selecionarA,opA); preencher(selecionarB,opB);
  selecionarA.value=String(opA[0].index); selecionarB.value=String(opB.at(-1)!.index);
  selecionarA.addEventListener("change",()=>{resultado.hidden=true;});
  selecionarB.addEventListener("change",()=>{resultado.hidden=true;});
  abrir.addEventListener("click",()=>{
    painel.hidden=!painel.hidden;
    abrir.setAttribute("aria-expanded",String(!painel.hidden));
    if (!painel.hidden) selecionarA.focus();
  });
  executar.addEventListener("click",()=>{
    const ca=sa.cs[Number(selecionarA.value)], cb=sb.cs[Number(selecionarB.value)];
    if (!ca || !cb) return;
    resultado.innerHTML=`<p class="duelo-aviso-anos">Anos e possivelmente cargos diferentes: são duas trajetórias eleitorais, não a mesma disputa. Os valores financeiros são nominais, sem correção pela inflação.</p><ol class="duelo-trivia-fatos">${fatosEntreAnos(ca,cb,a,b).map((f,i)=>`<li><span>${String(i+1).padStart(2,"0")}</span><p>${esc(f)}</p></li>`).join("")}</ol><div class="duelo-anos-lados"><section><h4>${esc(titulo(a.nm_candidato))} · ${ca.ano_eleicao}</h4>${candidaturas([ca],a.dt_nascimento)}</section><section><h4>${esc(titulo(b.nm_candidato))} · ${cb.ano_eleicao}</h4>${candidaturas([cb],b.dt_nascimento)}</section></div>`;
    resultado.hidden=false;
    resultado.querySelectorAll<HTMLImageElement>("[data-duelo-foto]").forEach(img=>img.addEventListener("error",()=>img.remove(),{once:true}));
    resultado.scrollIntoView({block:"nearest",behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"instant":"smooth"});
  });
}
function desenharResultado() {
  const out = document.getElementById("duelo-resultado")!;
  const a=perfis.a,b=perfis.b;
  if (!a || !b) {
    if (escolhidos.a || escolhidos.b) out.innerHTML = `<div class="duelo-carregando"><span></span>Buscando os cadernos eleitorais…</div>`;
    else out.innerHTML = `<div class="duelo-vazio"><span aria-hidden="true">＋</span><p>Escolha dois candidatos para revelar as curiosidades que a história eleitoral guardou.</p></div>`;
    return;
  }
  const sa=resumir(a), sb=resumir(b);
  const comuns=sa.years.filter(y=>sb.years.includes(y));
  const foraDoPar=anosSemPar(a,b,sa,sb);
  const cenario=resumoCenario(a,b,sa,sb,comuns);
  const fatosCarreira=`<section class="duelo-trivia" aria-labelledby="duelo-fatos-trajetoria"><h3 id="duelo-fatos-trajetoria">${esc(cenario.titulo)}</h3><p>${esc(cenario.texto)}</p><ol>${fatosTrajetoria(a,b,sa,sb).map((f,i)=>`<li><span>${String(i+1).padStart(2,"0")}</span><p>${esc(f)}</p></li>`).join("")}</ol></section>`;
  const avatar = (p:Perfil, s:string) => {
    const foto = [...p.candidacies].sort((x,y)=>Number(y.ano_eleicao)-Number(x.ano_eleicao)).find(c=>Number(c.ano_eleicao)<=2016 && c.sq_candidato);
    const src = foto ? `/api/photo/${Number(foto.ano_eleicao)}/${Number(foto.sq_candidato)}` : "";
    return `<div class="duelo-identidade lado-${s}"><span class="foto-frame foto-topo duelo-foto">${esc((p.nm_candidato||"?").trim().split(/\s+/).slice(0,2).map(x=>x[0]).join("").toUpperCase())}${src?`<img data-duelo-foto src="${src}" alt="" aria-hidden="true">`:""}</span><div><h3>${esc(titulo(p.nm_candidato))}</h3><p>${esc([p.ds_genero,p.ds_cor_raca].filter(Boolean).map(titulo).join(" · ") || "Perfil eleitoral")}</p></div></div>`;
  };
  const identidades = `<div class="duelo-identidades">${avatar(a,"a")}<span class="duelo-vs pequeno">×</span>${avatar(b,"b")}</div>`;
  const narrativa = foraDoPar.length ? `<section class="duelo-sem-par"><h3>Enquanto isso, nas urnas</h3><p>Estes pleitos não coincidem. Abaixo, cada registro fica no seu próprio ano.</p><ol>${foraDoPar.map((f,i)=>`<li><span>${String(i+1).padStart(2,"0")}</span><p>${esc(f)}</p></li>`).join("")}</ol><small>“Sem candidatura registrada” descreve apenas esta base; não indica afastamento da política.</small></section>` : "";
  const compararAnos = `<div class="duelo-comparar-anos"><button class="duelo-abrir-anos" type="button" data-abrir-anos aria-expanded="false" aria-controls="duelo-painel-anos">Escolher anos para comparar</button><div class="duelo-painel-anos" id="duelo-painel-anos" data-painel-anos hidden><p>Escolha uma candidatura de cada trajetória. Os anos, cargos e disputas podem ser diferentes.</p><div class="duelo-seletores-anos"><label>${esc(titulo(a.nm_candidato))}<select data-ano-a aria-label="Ano e candidatura de ${esc(titulo(a.nm_candidato))}"></select></label><label>${esc(titulo(b.nm_candidato))}<select data-ano-b aria-label="Ano e candidatura de ${esc(titulo(b.nm_candidato))}"></select></label></div><button class="duelo-executar-anos" type="button" data-executar-anos>Comparar estas candidaturas</button><div data-resultado-anos hidden></div></div></div>`;
  if (!comuns.length) {
    out.innerHTML=`<section class="duelo-sem-encontro"><p class="duelo-contexto">As candidaturas de ${esc(titulo(a.nm_candidato))} e ${esc(titulo(b.nm_candidato))} não aparecem no mesmo ano da amostra.</p>${identidades}${fatosCarreira}${narrativa}<p class="duelo-nota-base">As frases resumem cada candidatura sem tratar eleições diferentes como a mesma disputa. A ausência de registro não permite concluir que alguém deixou a política; valores de campanhas em anos diferentes são nominais, sem correção pela inflação.</p>${compararAnos}</section>`;
    ligarComparacaoEntreAnos(out,a,b,sa,sb);
    out.querySelectorAll<HTMLImageElement>("[data-duelo-foto]").forEach(img=>img.addEventListener("error",()=>img.remove(),{once:true}));
    return;
  }
  const summary = (p:Perfil,s:ReturnType<typeof resumir>) => `<dl class="duelo-resumo"><div><dt>Nas urnas</dt><dd>${s.years.length} eleições</dd></div><div><dt>Votos somados</dt><dd>${fmt.format(s.votos)}</dd></div><div><dt>Receita de campanha</dt><dd>${dinheiro(s.receitas)}</dd></div><div><dt>Despesas</dt><dd>${dinheiro(s.gastos)}</dd></div><div><dt>Vitórias registradas</dt><dd>${s.eleito}</dd></div><div><dt>Escolaridade</dt><dd>${esc(titulo(p.ds_grau_instrucao||"Não informada"))}</dd></div></dl>`;
  const carreira = `<div class="duelo-placar">${identidades}<div class="duelo-saldos">${summary(a,sa)}<span class="duelo-saldo-vs" aria-hidden="true">×</span>${summary(b,sb)}</div></div>`;
  const curiosidades = `<section class="duelo-trivia" aria-labelledby="duelo-fatos"><h3 id="duelo-fatos">A urna também conta histórias</h3><ol>${frase(a,b,sa,sb).map((f,i)=>`<li><span>${String(i+1).padStart(2,"0")}</span><p>${esc(f)}</p></li>`).join("")}</ol></section>`;
  const contextoComum = `<section class="duelo-contexto-comum">${identidades}<p>Os números lado a lado abaixo se limitam aos anos em que os dois têm candidatura registrada.</p></section>`;
  const cronologiaComum = `<section class="duelo-linha"><div class="duelo-linha-cab"><h3>Quando os anos coincidem</h3><p>Idade no dia do 1º turno. Valores financeiros nominais, sem correção pela inflação.</p></div>${comuns.map(y=>`<article class="duelo-ano"><h4>${y}</h4><div class="duelo-ano-lados"><div>${candidaturas(sa.cs.filter(c=>Number(c.ano_eleicao)===y),a.dt_nascimento)}</div><div>${candidaturas(sb.cs.filter(c=>Number(c.ano_eleicao)===y),b.dt_nascimento)}</div></div></article>`).join("")}</section>`;
  out.innerHTML = `${foraDoPar.length ? contextoComum : `${carreira}${curiosidades}`}${foraDoPar.length?fatosCarreira:""}${narrativa}${foraDoPar.length?compararAnos:""}${cronologiaComum}`;
  if (foraDoPar.length) ligarComparacaoEntreAnos(out,a,b,sa,sb);
  out.querySelectorAll<HTMLImageElement>("[data-duelo-foto]").forEach(img=>img.addEventListener("error",()=>img.remove(),{once:true}));
}
