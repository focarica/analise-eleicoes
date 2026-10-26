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
  const nomeA=titulo(a.nm_candidato), nomeB=titulo(b.nm_candidato);
  const comuns = sa.years.filter(y=>sb.years.includes(y));
  let maior: {year:number; aa:number; ab:number} | null = null;
  for (const y of comuns) { const aa=idadeEm(a.dt_nascimento,y), ab=idadeEm(b.dt_nascimento,y); if (aa != null && ab != null && (!maior || Math.abs(aa-ab)>Math.abs(maior.aa-maior.ab))) maior={year:y,aa,ab}; }
  if (maior && Math.abs(maior.aa-maior.ab)>=10) {
    const maisVelho=maior.aa>maior.ab?nomeA:nomeB, jovem=maior.aa>maior.ab?nomeB:nomeA, diff=Math.abs(maior.aa-maior.ab);
    fatos.push(`Em ${maior.year}, ${jovem} tinha ${Math.min(maior.aa,maior.ab)} anos. ${maisVelho} era ${diff} anos mais velho.`);
  }
  const topA=maiorRegistro(sa.cs,"votos"), topB=maiorRegistro(sb.cs,"votos");
  if(topA&&topB) {
    const high=n(topA.votos)>=n(topB.votos)?topA:topB, low=high===topA?topB:topA, who=high===topA?nomeA:nomeB, other=high===topA?nomeB:nomeA;
    const ratio=n(low.votos)>0?n(high.votos)/n(low.votos):null;
    if(n(high.votos)-n(low.votos)>=10000 && ratio!=null && ratio>=2) fatos.push(`A maior votação de ${who} chegou a ${fmt.format(n(high.votos))} votos em ${high.ano}. Isso é mais que o dobro do recorde de ${other}.`);
  }
  const topGastoA=maiorRegistro(sa.cs,"total_despesas"), topGastoB=maiorRegistro(sb.cs,"total_despesas");
  if(topGastoA&&topGastoB) {
    const high=n(topGastoA.total_despesas)>=n(topGastoB.total_despesas)?topGastoA:topGastoB, low=high===topGastoA?topGastoB:topGastoA, who=high===topGastoA?nomeA:nomeB, other=high===topGastoA?nomeB:nomeA;
    const ratio=n(low.total_despesas)>0?n(high.total_despesas)/n(low.total_despesas):null;
    if(n(high.total_despesas)-n(low.total_despesas)>=100000 && ratio!=null && ratio>=2) fatos.push(`A campanha mais cara de ${who} custou ${dinheiro(high.total_despesas)}. Foi pelo menos o dobro do maior gasto de ${other}, em valores nominais.`);
  }
  const diffEleicoes=Math.abs(sa.years.length-sb.years.length), maxEleicoes=Math.max(sa.years.length,sb.years.length);
  if(diffEleicoes>=2 && diffEleicoes/maxEleicoes>=.4) {
    const mais=sa.years.length>sb.years.length?nomeA:nomeB, menos=sa.years.length>sb.years.length?nomeB:nomeA;
    fatos.push(`${mais} apareceu nas urnas em pelo menos o dobro de anos eleitorais que ${menos}.`);
  }
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
  if (eleito) return `${idadeTxt}${titulo(nome)} venceu a disputa para ${disputa}, com ${votos}.`;
  const situacao=String(c.situacao||"").toUpperCase();
  if (situacao.includes("2º TURNO") || situacao.includes("SEGUNDO TURNO")) return `${idadeTxt}${titulo(nome)} levou a disputa para ${disputa} ao segundo turno, com ${votos}.`;
  if (situacao.includes("SUPLENTE")) return `${idadeTxt}${titulo(nome)} terminou como suplente na disputa para ${disputa}, com ${votos}.`;
  if (n(c.votos)>=10000) return `${idadeTxt}${titulo(nome)} reuniu ${votos} na disputa para ${disputa}. O resultado registrado foi ${c.situacao ? sitTxt(c.situacao) : "não informado"}.`;
  return `${idadeTxt}${titulo(nome)} entrou na disputa para ${disputa}. O resultado registrado foi ${c.situacao ? sitTxt(c.situacao) : "não informado"}.`;
}
function resumoCenario(a: Perfil, b: Perfil, sa: ReturnType<typeof resumir>, sb: ReturnType<typeof resumir>, comuns: number[]) {
  const inicioA=sa.years[0], inicioB=sb.years[0], fimA=sa.years.at(-1)!, fimB=sb.years.at(-1)!;
  const anosA=sa.years.length, anosB=sb.years.length, faixaA=fimA-inicioA, faixaB=fimB-inicioB;
  if (!comuns.length && fimA < inicioB) return {
    titulo: "As candidaturas registradas não se sobrepõem",
    texto: `${titulo(a.nm_candidato)} já tinha encerrado sua sequência de candidaturas registradas quando ${titulo(b.nm_candidato)} apareceu pela primeira vez, ${inicioB-fimA} anos depois.`,
  };
  if (!comuns.length && fimB < inicioA) return {
    titulo: "As estreias eleitorais aconteceram em épocas diferentes",
    texto: `${titulo(b.nm_candidato)} já tinha sua última candidatura registrada quando ${titulo(a.nm_candidato)} estreou nas urnas da amostra, ${inicioA-fimB} anos depois.`,
  };
  if (!comuns.length) return {
    titulo: "As campanhas passaram perto, mas nunca dividiram o mesmo ano",
    texto: `Os registros de ${titulo(a.nm_candidato)} e ${titulo(b.nm_candidato)} se alternam no calendário. Mesmo com períodos próximos, a base não mostra candidaturas dos dois no mesmo ano.`,
  };
  if (inicioA===inicioB && fimA===fimB) return {
    titulo: `Duas estreias no mesmo ano: ${inicioA}`,
    texto: `Tanto ${titulo(a.nm_candidato)} quanto ${titulo(b.nm_candidato)} aparecem pela primeira vez em ${inicioA}, e os registros dos dois chegam até ${fimA}.`,
  };
  if (inicioA===inicioB) return {
    titulo: `Começaram no mesmo ano e seguiram caminhos diferentes`,
    texto: `A primeira candidatura registrada dos dois é de ${inicioA}. O registro mais recente de ${titulo(a.nm_candidato)} é de ${fimA}, e o de ${titulo(b.nm_candidato)} é de ${fimB}.`,
  };
  if (anosA-anosB>=2 || faixaA-faixaB>=8) return {
    titulo: `Mais tempo aparecendo nas urnas: ${titulo(a.nm_candidato)}`,
    texto: `${titulo(a.nm_candidato)} tem candidaturas registradas em ${anosA} anos eleitorais, ao longo de ${faixaA} anos.`,
  };
  if (anosB-anosA>=2 || faixaB-faixaA>=8) return {
    titulo: `Mais tempo aparecendo nas urnas: ${titulo(b.nm_candidato)}`,
    texto: `${titulo(b.nm_candidato)} tem candidaturas registradas em ${anosB} anos eleitorais, ao longo de ${faixaB} anos.`,
  };
  const cedo=inicioA<inicioB?a:b, tarde=cedo===a?b:a;
  return {
    titulo: `${titulo(cedo.nm_candidato)} chegou primeiro às urnas`,
    texto: `${titulo(cedo.nm_candidato)} estreou nos registros em ${Math.min(inicioA,inicioB)}. ${titulo(tarde.nm_candidato)} aparece pela primeira vez ${Math.max(inicioA,inicioB)-Math.min(inicioA,inicioB)} anos depois, e os dois têm ${comuns.length} ${comuns.length===1?"ano eleitoral":"anos eleitorais"} em comum.`,
  };
}
function maiorRegistro(cs: Candidatura[], campo: string) {
  return cs.filter(c=>c[campo]!=null).reduce<Candidatura|null>((best,c)=>!best || n(c[campo])>n(best[campo])?c:best,null);
}
function fatosTrajetoria(a: Perfil, b: Perfil, sa: ReturnType<typeof resumir>, sb: ReturnType<typeof resumir>) {
  const fatos: string[] = [];
  const nomeA=titulo(a.nm_candidato), nomeB=titulo(b.nm_candidato);
  const plural=(q:number,um:string,varios=um+"s")=>`${q} ${q===1?um:varios}`;
  const estreiaA=idadeEm(a.dt_nascimento,sa.years[0]), estreiaB=idadeEm(b.dt_nascimento,sb.years[0]);
  const idadeBNaEstreiaA=idadeEm(b.dt_nascimento,sa.years[0]), idadeANaEstreiaB=idadeEm(a.dt_nascimento,sb.years[0]);
  if (idadeBNaEstreiaA!=null && idadeANaEstreiaB!=null && (idadeBNaEstreiaA<0 || idadeBNaEstreiaA<4 || idadeBNaEstreiaA>=10)) {
    if (idadeBNaEstreiaA<0) fatos.push(`Quando ${nomeA} estreou nas urnas, ${nomeB} ainda não tinha nascido. A primeira candidatura de ${nomeB} veio em ${sb.years[0]}.`);
    else if (idadeBNaEstreiaA<4) fatos.push(`Quando ${nomeA} começou a disputar eleições, ${nomeB} ainda era bebê: tinha cerca de ${idadeBNaEstreiaA} anos.`);
    else fatos.push(`Quando ${nomeA} estreou nas urnas, ${nomeB} tinha ${idadeBNaEstreiaA} anos. A estreia eleitoral de ${nomeB} veio em ${sb.years[0]}.`);
  }
  if (estreiaA!=null && estreiaB!=null && estreiaA!==estreiaB) {
    const jovem=estreiaA<estreiaB?nomeA:nomeB, idadeJovem=Math.min(estreiaA,estreiaB), velho=estreiaA<estreiaB?nomeB:nomeA, idadeVelho=Math.max(estreiaA,estreiaB);
    if(idadeVelho-idadeJovem>=10) fatos.push(`${jovem} já disputava eleições aos ${idadeJovem} anos. ${velho} só estreou nas urnas aos ${idadeVelho}.`);
  }
  if (sa.cs.length!==sb.cs.length && Math.abs(sa.cs.length-sb.cs.length)>=2 && Math.abs(sa.cs.length-sb.cs.length)/Math.max(sa.cs.length,sb.cs.length)>=.4) {
    const mais=sa.cs.length>sb.cs.length?nomeA:nomeB, menos=sa.cs.length>sb.cs.length?nomeB:nomeA, diff=Math.abs(sa.cs.length-sb.cs.length);
    fatos.push(`${mais} entrou em ${plural(diff,"disputa eleitoral","disputas eleitorais")} a mais que ${menos} nos registros disponíveis.`);
  }
  if (sa.eleito!==sb.eleito && Math.abs(sa.eleito-sb.eleito)>=2) {
    const mais=sa.eleito>sb.eleito?nomeA:nomeB, q=Math.max(sa.eleito,sb.eleito);
    const diff=Math.abs(sa.eleito-sb.eleito), menos=sa.eleito>sb.eleito?nomeB:nomeA;
    fatos.push(`${mais} conquistou ${plural(q,"eleição","eleições")} nas candidaturas registradas, ${plural(diff,"vitória","vitórias")} a mais que ${menos}.`);
  } else if ((sa.eleito===0)!==(sb.eleito===0)) {
    const quem=sa.eleito>0?nomeA:nomeB;
    fatos.push(`${quem} tem vitória registrada nas urnas. O outro ainda não aparece como eleito nesta amostra.`);
  }
  const cargosA=new Set(sa.cs.map(c=>c.cargo).filter(Boolean)), cargosB=new Set(sb.cs.map(c=>c.cargo).filter(Boolean));
  if (Math.abs(cargosA.size-cargosB.size)>=2) {
    const quem=cargosA.size>cargosB.size?nomeA:nomeB, q=Math.max(cargosA.size,cargosB.size);
    fatos.push(`${quem} tentou a sorte em ${plural(q,"tipo de cargo","tipos de cargo")} diferentes ao longo da trajetória registrada.`);
  }
  const partidosA=new Set(sa.cs.map(c=>c.partido).filter(Boolean)), partidosB=new Set(sb.cs.map(c=>c.partido).filter(Boolean));
  const trocas=(cs:Candidatura[],campo:string)=>{
    const ordered=[...cs].sort((x,y)=>Number(x.ano_eleicao)-Number(y.ano_eleicao));
    return ordered.slice(1).flatMap((c,i)=>{
      const anterior=ordered[i][campo], atual=c[campo];
      return anterior&&atual&&anterior!==atual?[{ano:Number(c.ano_eleicao),de:String(anterior),para:String(atual)}]:[];
    });
  };
  const mudancasPartidoA=trocas(sa.cs,"partido"), mudancasPartidoB=trocas(sb.cs,"partido");
  const todasTrocasPartido=[...mudancasPartidoA.map(m=>({...m,nome:nomeA})),...mudancasPartidoB.map(m=>({...m,nome:nomeB}))].sort((x,y)=>x.ano-y.ano);
  if(todasTrocasPartido.length) { const m=todasTrocasPartido[0]; fatos.push(`Em ${m.ano}, ${m.nome} trocou de partido: saiu de ${m.de} e concorreu por ${m.para}.`); }
  else if(Math.max(partidosA.size,partidosB.size)>=3) { const quem=partidosA.size>partidosB.size?nomeA:nomeB; fatos.push(`${quem} concorreu por ${Math.max(partidosA.size,partidosB.size)} siglas diferentes ao longo da trajetória registrada.`); }
  const estados=(cs:Candidatura[])=>new Set(cs.map(c=>String(c.uf||"").trim()).filter(Boolean));
  const estadosA=estados(sa.cs), estadosB=estados(sb.cs);
  const trocaUF=(cs:Candidatura[])=>trocas(cs,"uf").filter(t=>t.de!==t.para);
  const mudancasUF=[...trocaUF(sa.cs).map(m=>({...m,nome:nomeA})),...trocaUF(sb.cs).map(m=>({...m,nome:nomeB}))].sort((x,y)=>x.ano-y.ano);
  if(mudancasUF.length) { const m=mudancasUF[0]; fatos.push(`${m.nome} levou a campanha para outro estado: saiu de ${m.de} e concorreu em ${m.para} em ${m.ano}.`); }
  else if(estadosA.size>1 || estadosB.size>1) { const quem=estadosA.size>estadosB.size?nomeA:nomeB; fatos.push(`${quem} tem candidaturas registradas em ${Math.max(estadosA.size,estadosB.size)} estados diferentes.`); }
  const mudancasCargoA=trocas(sa.cs,"cargo"), mudancasCargoB=trocas(sb.cs,"cargo");
  const mudancasCargo=[...mudancasCargoA.map(m=>({...m,nome:nomeA})),...mudancasCargoB.map(m=>({...m,nome:nomeB}))].sort((x,y)=>x.ano-y.ano);
  if(mudancasCargo.length) { const m=mudancasCargo[0]; fatos.push(`${m.nome} mudou de disputa em ${m.ano}: passou de ${cargoNome(m.de)} para ${cargoNome(m.para)}.`); }
  const situacaoEleito=(c:Candidatura)=>["ELEITO","ELEITO POR QP","ELEITO POR MÉDIA"].includes(String(c.situacao).toUpperCase());
  const viradaEleitoral=(cs:Candidatura[])=>{
    const ordered=[...cs].sort((x,y)=>Number(x.ano_eleicao)-Number(y.ano_eleicao));
    for(let i=0;i<ordered.length-1;i++) if(!situacaoEleito(ordered[i])&&situacaoEleito(ordered[i+1])) return {primeira:ordered[i],vitoria:ordered[i+1]};
    return null;
  };
  const viradaA=viradaEleitoral(sa.cs), viradaB=viradaEleitoral(sb.cs);
  const viradas=[viradaA?{...viradaA,nome:nomeA}:null,viradaB?{...viradaB,nome:nomeB}:null].filter((v):v is {primeira:Candidatura;vitoria:Candidatura;nome:string}=>!!v).sort((x,y)=>Number(x.vitoria.ano_eleicao)-Number(y.vitoria.ano_eleicao));
  if(viradas.length) { const v=viradas[0]; fatos.push(`${v.nome} tentou antes de vencer: não foi eleito em ${v.primeira.ano_eleicao} e conquistou uma vitória em ${v.vitoria.ano_eleicao}.`); }
  const maiorIntervalo=(s:ReturnType<typeof resumir>)=>s.years.slice(1).reduce((best,y,i)=>Math.max(best,y-s.years[i]),0);
  const intervaloA=maiorIntervalo(sa), intervaloB=maiorIntervalo(sb);
  if (intervaloA>=4 || intervaloB>=4) {
    const quem=intervaloA>=intervaloB?nomeA:nomeB, q=Math.max(intervaloA,intervaloB);
    fatos.push(`A maior pausa entre duas eleições registradas foi de ${plural(q,"ano","anos")} na trajetória de ${quem}.`);
  }
  const locais=(s:ReturnType<typeof resumir>)=>new Set(s.cs.map(c=>[c.nm_municipio,c.uf].filter(Boolean).join(" · ")).filter(Boolean));
  const locaisA=locais(sa), locaisB=locais(sb);
  if (Math.abs(locaisA.size-locaisB.size)>=3) { const quem=locaisA.size>locaisB.size?nomeA:nomeB; fatos.push(`${quem} fez campanha em uma variedade maior de municípios/UF: ${Math.max(locaisA.size,locaisB.size)} locais aparecem no histórico.`); }
  const xV=maiorRegistro(sa.cs,"votos"), yV=maiorRegistro(sb.cs,"votos");
  if(xV&&yV&&n(xV.votos)!==n(yV.votos)) {
    const maior=n(xV.votos)>n(yV.votos)?xV:yV, nomeMaior=maior===xV?nomeA:nomeB, menor=maior===xV?yV:xV;
    const razao=n(menor.votos)>0?n(maior.votos)/n(menor.votos):null;
    if(razao!=null && razao>=2 && n(maior.votos)-n(menor.votos)>=10000) fatos.push(`${nomeMaior} teve sua maior votação em ${maior.ano}, com ${fmt.format(n(maior.votos))} votos, mais que o dobro do recorde de ${maior===xV?nomeB:nomeA}.`);
  }
  const xG=maiorRegistro(sa.cs,"total_despesas"), yG=maiorRegistro(sb.cs,"total_despesas");
  if(xG&&yG&&n(xG.total_despesas)!==n(yG.total_despesas)) {
    const maior=n(xG.total_despesas)>n(yG.total_despesas)?xG:yG, menor=maior===xG?yG:xG, nomeMaior=maior===xG?nomeA:nomeB, nomeMenor=maior===xG?nomeB:nomeA;
    const razao=n(menor.total_despesas)>0?n(maior.total_despesas)/n(menor.total_despesas):null;
    if(razao!=null && razao>=2 && n(maior.total_despesas)-n(menor.total_despesas)>=100000) fatos.push(`A campanha mais cara de ${nomeMaior} foi em ${maior.ano}: ${dinheiro(maior.total_despesas)}, pelo menos o dobro do maior gasto de ${nomeMenor}. Valores nominais, sem ajuste pela inflação.`);
  }
  const xR=maiorRegistro(sa.cs,"total_receitas"), yR=maiorRegistro(sb.cs,"total_receitas");
  if(xR&&yR&&n(xR.total_receitas)!==n(yR.total_receitas)) {
    const maior=n(xR.total_receitas)>n(yR.total_receitas)?xR:yR, menor=maior===xR?yR:xR, quem=maior===xR?nomeA:nomeB;
    const razao=n(menor.total_receitas)>0?n(maior.total_receitas)/n(menor.total_receitas):null;
    if(razao!=null && razao>=2 && n(maior.total_receitas)-n(menor.total_receitas)>=100000) fatos.push(`A maior arrecadação de campanha foi de ${quem}, em ${maior.ano}: ${dinheiro(maior.total_receitas)}, pelo menos o dobro da maior arrecadação do outro. Valores nominais, sem ajuste pela inflação.`);
  }
  const xP=maiorRegistro(sa.cs,"patrimonio_declarado"), yP=maiorRegistro(sb.cs,"patrimonio_declarado");
  if(xP&&yP&&n(xP.patrimonio_declarado)!==n(yP.patrimonio_declarado)) {
    const maior=n(xP.patrimonio_declarado)>n(yP.patrimonio_declarado)?xP:yP, quem=maior===xP?nomeA:nomeB;
    const menor=maior===xP?yP:xP;
    if(n(maior.patrimonio_declarado)>=2*n(menor.patrimonio_declarado) && n(maior.patrimonio_declarado)-n(menor.patrimonio_declarado)>=1000000) fatos.push(`O maior patrimônio declarado em uma candidatura foi o de ${quem}: ${dinheiro(maior.patrimonio_declarado)}, mais que o dobro do outro maior registro. Foi declarado em ${maior.ano}.`);
  }
  const maiorParcelaPublica=(cs:Candidatura[])=>cs.filter(c=>n(c.total_receitas)>0).reduce<Candidatura|null>((best,c)=>!best || n(c.receitas_publicas)/n(c.total_receitas)>n(best.receitas_publicas)/n(best.total_receitas)?c:best,null);
  const pubA=maiorParcelaPublica(sa.cs), pubB=maiorParcelaPublica(sb.cs);
  if (pubA && pubB) {
    const percA=100*n(pubA.receitas_publicas)/n(pubA.total_receitas), percB=100*n(pubB.receitas_publicas)/n(pubB.total_receitas);
    if(Math.abs(percA-percB)>=10) { const quem=percA>percB?nomeA:nomeB, q=Math.max(percA,percB); fatos.push(`Em ${quem}, o financiamento público chegou a ${q.toLocaleString("pt-BR",{maximumFractionDigits:0})}% da receita em uma campanha. Foi a maior proporção pública entre os dois históricos.`); }
  }
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
    else contexto = `Em ${ano}, enquanto ${titulo(ausente.nm_candidato)} não aparece entre as candidaturas registradas, `;
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
  const fatos: string[] = [];
  const ia=idadeEm(a.dt_nascimento,Number(ca.ano_eleicao)), ib=idadeEm(b.dt_nascimento,Number(cb.ano_eleicao));
  if (ia!=null && ib!=null && Math.abs(ia-ib)>=10) {
    const velho=ia>ib?titulo(a.nm_candidato):titulo(b.nm_candidato), jovem=ia>ib?titulo(b.nm_candidato):titulo(a.nm_candidato);
    fatos.push(`Na campanha selecionada, ${jovem} tinha ${Math.min(ia,ib)} anos. ${velho} era ${Math.abs(ia-ib)} anos mais velho.`);
  }
  const va=n(ca.votos), vb=n(cb.votos), maiorVotos=Math.max(va,vb), menorVotos=Math.min(va,vb);
  if(menorVotos>0 && maiorVotos/menorVotos>=2 && maiorVotos-menorVotos>=10000) {
    const nomeMaior=va>vb?titulo(a.nm_candidato):titulo(b.nm_candidato), anoMaior=va>vb?ca.ano_eleicao:cb.ano_eleicao;
    fatos.push(`${nomeMaior} recebeu ${fmt.format(maiorVotos)} votos na campanha de ${anoMaior}, pelo menos o dobro da votação da outra candidatura selecionada.`);
  }
  const comparacao = (rotulo: string, va: unknown, vb: unknown) => {
    const x=n(va), y=n(vb); if (!x || !y || x===y) return null;
    const maior=Math.max(x,y), menor=Math.min(x,y), razao=maior/menor;
    if (razao<2 || maior-menor<100000) return null;
    const nomeMaior=x>y?titulo(a.nm_candidato):titulo(b.nm_candidato), nomeMenor=x>y?titulo(b.nm_candidato):titulo(a.nm_candidato), anoMaior=x>y?ca.ano_eleicao:cb.ano_eleicao;
    return `${rotulo}: ${nomeMaior} registrou ${dinheiro(maior)} em ${anoMaior}, pelo menos o dobro do valor de ${nomeMenor}. Valores nominais, sem ajuste pela inflação.`;
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
  const fatosDestaque=fatosTrajetoria(a,b,sa,sb);
  const fatosCarreira=fatosDestaque.length?`<section class="duelo-trivia" aria-labelledby="duelo-fatos-trajetoria"><h3 id="duelo-fatos-trajetoria">${esc(cenario.titulo)}</h3><p>${esc(cenario.texto)}</p><ol>${fatosDestaque.map((f,i)=>`<li><span>${String(i+1).padStart(2,"0")}</span><p>${esc(f)}</p></li>`).join("")}</ol></section>`:"";
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
  const fatosHeadToHead=frase(a,b,sa,sb);
  const curiosidades = fatosHeadToHead.length ? `<section class="duelo-trivia" aria-labelledby="duelo-fatos"><h3 id="duelo-fatos">A urna também conta histórias</h3><ol>${fatosHeadToHead.map((f,i)=>`<li><span>${String(i+1).padStart(2,"0")}</span><p>${esc(f)}</p></li>`).join("")}</ol></section>` : "";
  const contextoComum = `<section class="duelo-contexto-comum">${identidades}<p>Os números lado a lado abaixo se limitam aos anos em que os dois têm candidatura registrada.</p></section>`;
  const cronologiaComum = `<section class="duelo-linha"><div class="duelo-linha-cab"><h3>Quando os anos coincidem</h3><p>Idade no dia do 1º turno. Valores financeiros nominais, sem correção pela inflação.</p></div>${comuns.map(y=>`<article class="duelo-ano"><h4>${y}</h4><div class="duelo-ano-lados"><div>${candidaturas(sa.cs.filter(c=>Number(c.ano_eleicao)===y),a.dt_nascimento)}</div><div>${candidaturas(sb.cs.filter(c=>Number(c.ano_eleicao)===y),b.dt_nascimento)}</div></div></article>`).join("")}</section>`;
  out.innerHTML = `${foraDoPar.length ? contextoComum : `${carreira}${curiosidades}`}${foraDoPar.length?fatosCarreira:""}${narrativa}${foraDoPar.length?compararAnos:""}${cronologiaComum}`;
  if (foraDoPar.length) ligarComparacaoEntreAnos(out,a,b,sa,sb);
  out.querySelectorAll<HTMLImageElement>("[data-duelo-foto]").forEach(img=>img.addEventListener("error",()=>img.remove(),{once:true}));
}
