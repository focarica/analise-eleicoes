// @ts-nocheck
// Questão 9: onde o candidato investe em propaganda (nuvens de palavras).
// Não tem seção própria na página: acrescenta as nuvens à ficha de cada candidato.
// Edite só este arquivo (e o .css ao lado).
import { fmt, brl, titulo, esc, request } from "../util";
import { UF, ANO } from "../presentation";
import "./p9-propaganda.css";

function organizarNuvem(nuvem){
  if (!nuvem || !nuvem.clientWidth || nuvem.closest("[hidden]") || (nuvem.closest("details") && !nuvem.closest("details").open)) return;
  const palavras = [...nuvem.querySelectorAll(":scope > span")];
  if (!palavras.length) return;
  const largura = nuvem.clientWidth, altura = nuvem.clientHeight;
  const maiorPeso = Math.max(1, ...palavras.map(p => +p.dataset.peso || 0));
  palavras.forEach((p, i) => {
    const posicao = palavras.length === 1 ? 1 : 1 - i / (palavras.length - 1);
    const relativo = Math.sqrt((+p.dataset.peso || 0) / maiorPeso);
    const escala = 0.72 * posicao + 0.28 * relativo;
    p.style.fontSize = `${14 + escala * 30}px`;
    p.style.left = "50%";
    p.style.top = "50%";
    p.style.visibility = "hidden";
  });
  const colocadas = [];
  const margem = 8;
  palavras.forEach((p, indice) => {
    let encontrado = false;
    // A primeira palavra ancora a composição; as seguintes percorrem uma espiral ao redor dela.
    const tamanhoBase = parseFloat(p.style.fontSize);
    for (const reducao of [1, 0.88, 0.76, 0.64]) {
      p.style.fontSize = `${Math.max(12, tamanhoBase * reducao)}px`;
      const w = p.offsetWidth + margem, h = p.offsetHeight + margem;
      const limite = indice === 0 ? 1 : 1800;
      for (let passo = 0; passo < limite; passo++) {
        const angulo = passo * 0.24;
        const raio = indice === 0 ? 0 : 1.45 * angulo;
        const x = largura / 2 + Math.cos(angulo) * raio;
        const y = altura / 2 + Math.sin(angulo) * raio * 0.72;
        if (x - w / 2 < 3 || x + w / 2 > largura - 3 || y - h / 2 < 3 || y + h / 2 > altura - 3) continue;
        const colide = colocadas.some(o => Math.abs(x - o.x) < (w + o.w) / 2 && Math.abs(y - o.y) < (h + o.h) / 2);
        if (colide) continue;
        p.style.left = `${x}px`;
        p.style.top = `${y}px`;
        p.style.visibility = "visible";
        colocadas.push({ x, y, w, h });
        encontrado = true;
        break;
      }
      if (encontrado) break;
    }
    if (!encontrado) p.style.visibility = "hidden";
  });
}

function prepararNuvens(raiz){
  raiz.querySelectorAll(".nuvem").forEach(nuvem => {
    const mostrarDetalhes = (palavra, evento) => {
      const dica = nuvem.querySelector(".nuvem-tooltip");
      const valor = +palavra.dataset.valor || 0;
      const lancamentos = +palavra.dataset.lancamentos || 0;
      dica.innerHTML = palavra.dataset.candidatos
        ? `<b>${esc(palavra.textContent)}</b>${palavra.dataset.valor ? `<span>Valor associado: ${brl(valor)}</span>` : `<span>Lançamentos associados: ${fmt.format(+palavra.dataset.lancamentos)}</span>`}<span>Candidatos: ${fmt.format(+palavra.dataset.candidatos)}</span>`
        : `<b>${esc(palavra.textContent)}</b><span>Valor associado: ${brl(valor)} (${palavra.dataset.baseValor === "DECLARADO" ? "declarado" : "pago"})</span><span>Lançamentos que contêm o termo: ${fmt.format(lancamentos)}</span>`;
      dica.hidden = false;
      if (evento?.clientX != null) {
        const caixa = nuvem.getBoundingClientRect();
        const metadeDica = dica.offsetWidth / 2;
        const x = Math.max(metadeDica + 8, Math.min(caixa.width - metadeDica - 8, evento.clientX - caixa.left));
        const y = Math.max(dica.offsetHeight + 8, evento.clientY - caixa.top - 12);
        dica.style.left = `${x}px`;
        dica.style.top = `${y}px`;
      } else {
        dica.style.left = `${parseFloat(palavra.style.left)}px`;
        dica.style.top = `${parseFloat(palavra.style.top) - 24}px`;
      }
    };
    const esconderDetalhes = () => { nuvem.querySelector(".nuvem-tooltip").hidden = true; };
    nuvem.querySelectorAll(":scope > span").forEach(palavra => {
      palavra.addEventListener("pointerenter", ev => mostrarDetalhes(palavra, ev));
      palavra.addEventListener("pointermove", ev => mostrarDetalhes(palavra, ev));
      palavra.addEventListener("pointerleave", esconderDetalhes);
      palavra.addEventListener("focus", () => mostrarDetalhes(palavra));
      palavra.addEventListener("blur", esconderDetalhes);
    });
    nuvem.closest("details")?.addEventListener("toggle", () => organizarNuvem(nuvem));
    if ((!nuvem.closest("details") || nuvem.closest("details").open) && !nuvem.closest("[hidden]")) organizarNuvem(nuvem);
  });
}

window.addEventListener("resize", () => {
  document.querySelectorAll(".nuvem").forEach(organizarNuvem);
});

let modalPalavra, palavraAtiva;
function fecharModalPalavra(devolverFoco = false){
  if (!modalPalavra) return;
  modalPalavra.hidden = true;
  if (devolverFoco && palavraAtiva?.isConnected) palavraAtiva.focus();
  palavraAtiva = null;
}
function abrirModalPalavra(palavra, r, ano){
  if (!modalPalavra) {
    modalPalavra = document.createElement("div");
    modalPalavra.className = "q9-palavra-modal";
    modalPalavra.setAttribute("role", "dialog");
    modalPalavra.setAttribute("aria-modal", "false");
    document.body.append(modalPalavra);
    document.addEventListener("pointerdown", ev => {
      if (!modalPalavra.hidden && !modalPalavra.contains(ev.target) && !ev.target.closest(".q9-nuvem-geral span")) fecharModalPalavra();
    });
    document.addEventListener("keydown", ev => { if (ev.key === "Escape" && !modalPalavra.hidden) fecharModalPalavra(true); });
  }
  palavraAtiva = palavra;
  const iniciais = titulo(r.maiorCandidato).split(/\s+/).slice(0, 2).map(x => x[0]).join("").toUpperCase();
  const base = r.baseValor === "DECLARADO" ? "declarado" : "pago";
  const gasto = r.totalGasto == null ? "Valor não publicado nos dados carregados para este ano." : `Valor ${base} associado ao termo: <b>${brl(r.totalGasto)}</b>`;
  const participacao = r.participacaoPct == null ? "Participação financeira indisponível." : `${r.participacaoPct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% do gasto associado a este termo`;
  const ranking = r.totalGasto == null ? `Top 1 por lançamentos · ${fmt.format(r.maiorLancamentos)} registros` : `Top 1 por valor ${base} · ${brl(r.maiorGasto)}`;
  modalPalavra.innerHTML = `<button type="button" class="q9-modal-fechar" aria-label="Fechar detalhes">×</button>
    <span class="q9-modal-kicker">${esc(UF || "Todos os estados da amostra")} · ${ano}</span><h3>${esc(r.termo)}</h3>
    <p>${gasto}</p><p>${fmt.format(r.qtdCandidatos)} candidatos com despesas associadas</p>
    <div class="q9-top-candidato"><span class="q9-top-foto">${esc(iniciais)}<img src="/api/photo/${ano}/${r.maiorSq}" alt="Foto de ${esc(titulo(r.maiorCandidato))}" loading="lazy"></span>
      <div><small>${ranking}</small><b>${esc(titulo(r.maiorCandidato))}</b><span>${esc(titulo(r.maiorUrna || ""))}${r.maiorPartido ? ` · ${esc(r.maiorPartido)}` : ""}</span><span>${esc(titulo(r.maiorCargo || ""))}</span><strong>${participacao}</strong></div></div>
    <p class="q9-modal-aviso">${r.totalGasto == null ? "O valor não foi publicado para estes lançamentos. O Top 1 é por quantidade de registros; não indica quem gastou mais." : `O percentual compara o valor ${base} deste candidato com o total associado à mesma palavra. Uma despesa pode conter vários termos.`}</p>`;
  modalPalavra.hidden = false;
  const rect = palavra.getBoundingClientRect(), width = modalPalavra.offsetWidth, height = modalPalavra.offsetHeight;
  const left = rect.right + width + 12 <= innerWidth ? rect.right + 12 : Math.max(12, rect.left - width - 12);
  modalPalavra.style.left = `${Math.max(12, Math.min(innerWidth - width - 12, left))}px`;
  modalPalavra.style.top = `${Math.max(12, Math.min(innerHeight - height - 12, rect.top))}px`;
  modalPalavra.querySelector(".q9-modal-fechar").onclick = () => fecharModalPalavra(true);
  modalPalavra.querySelector("img").onerror = ev => ev.currentTarget.remove();
}

function nuvemPropaganda(c, h){
  const filtrar = rows => rows.filter(r => +r.ano_eleicao === +c.ano_eleicao && r.ds_cargo === c.cargo);
  const valor = filtrar(h.propagandaValor), frequencia = filtrar(h.propagandaFrequencia);
  const render = (rows, modo) => {
    if (!rows.length) return `<p class="aviso-mini">Sem lançamentos classificados como propaganda nesta candidatura.</p>`;
    return `<div class="nuvem" data-modo="${modo}" role="list" aria-label="Termos de propaganda por ${modo === "valor" ? "valor gasto" : "frequência de lançamentos"}">${rows.map(r =>
      `<span role="listitem" tabindex="0" data-peso="${+r.peso || 0}" data-valor="${+r.valor_associado || 0}" data-base-valor="${esc(r.base_valor || "")}" data-lancamentos="${+r.qt_lancamentos || 0}">${esc(r.termo)}</span>`
    ).join("")}<div class="nuvem-tooltip" role="tooltip" hidden></div></div>`;
  };
  return `<details class="q9"><summary>Onde investiu em propaganda?</summary>
    <div class="q9-conteudo">
      <div class="ctrl q9-controles" role="group" aria-label="Métrica da nuvem">
        <button type="button" data-q9="valor" aria-pressed="true">Valor da despesa</button>
        <button type="button" data-q9="frequencia" aria-pressed="false">Frequência</button>
      </div>
      <div data-q9-nuvem="valor">${render(valor, "valor")}</div>
      <div data-q9-nuvem="frequencia" hidden>${render(frequencia, "frequencia")}</div>
      <p class="aviso-mini">A nuvem usa valor pago quando disponível e valor declarado nos leiautes antigos; os valores têm bases diferentes entre anos. Uma despesa pode conter vários termos, então seus valores não devem ser somados como orçamento total. Frequência conta lançamentos, não unidades compradas, e pode incluir parcelas.</p>
    </div>
  </details>`;
}

export default {
  id: "p9", numero: "P9",
  titulo: "Onde o candidato investe em propaganda?",
  pergunta: "Onde o candidato investe em propaganda (nuvem de palavras)?",
  resumo: "Nuvem de propaganda por ano no estado selecionado, com detalhes do candidato Top 1 por termo; inclui também a ficha individual.",
  onde: "Por ano e estado selecionado, e na ficha do candidato",
  async montar(el) {
    el.innerHTML = `<p class="nota">Cada palavra resume as despesas de propaganda identificadas${UF ? ` em <b>${esc(UF)}</b>` : " nos estados da amostra"}. Selecione uma palavra para abrir, ao lado dela, os valores e o candidato Top 1.</p>
      <div class="q9-geral-filtros"><label>Ano <select id="q9-geral-ano" disabled></select></label></div>
      <div id="q9-geral-conteudo" aria-live="polite"><p class="aviso-mini">Carregando anos disponíveis…</p></div>
      <p class="aviso-mini">O valor usa pagamentos quando publicados e valores declarados nos leiautes históricos. A frequência conta lançamentos classificados em todos os anos. Uma despesa pode conter vários termos, então os totais das palavras não devem ser somados como orçamento total.</p>
      <p><button type="button" class="link" id="p9-busca">Ir para a busca de candidatos</button></p>`;
    const anoEl = el.querySelector("#q9-geral-ano"), conteudo = el.querySelector("#q9-geral-conteudo");
    let pedido = 0;
    const carregar = async (uf, ano) => {
      const id = ++pedido;
      conteudo.innerHTML = `<p class="aviso-mini">Carregando nuvem…</p>`;
      try {
        const d = await request(`/api/q9/geral?uf=${uf}&ano=${ano}`, { silencioso: true });
        if (!el.isConnected || id !== pedido) return;
        if (!d.termos.length) { conteudo.innerHTML = `<p class="aviso-mini">Sem lançamentos de propaganda classificados neste estado e ano.</p>`; return; }
        conteudo.innerHTML = `<div class="nuvem q9-nuvem-geral" role="group" aria-label="Termos de propaganda em ${uf || "todos os estados"}, ${ano}">${d.termos.map((r, i) => `<span role="button" aria-label="${esc(r.termo)}" aria-pressed="false" tabindex="0" data-q9-palavra="${i}" data-peso="${r.peso}" data-valor="${r.totalGasto ?? ""}" data-base-valor="${esc(r.baseValor || "")}" data-lancamentos="${r.totalLancamentos}" data-candidatos="${r.qtdCandidatos}">${esc(r.termo)}</span>`).join("")}<div class="nuvem-tooltip" role="tooltip" hidden></div></div>`;
        prepararNuvens(conteudo);
        const nuvem = conteudo.querySelector(".nuvem"); organizarNuvem(nuvem);
        const palavras = [...nuvem.querySelectorAll(":scope > span")];
        palavras.forEach((p, i) => {
          p.onclick = () => { palavras.forEach(w => w.setAttribute("aria-pressed", String(w === p))); abrirModalPalavra(p, d.termos[i], ano); };
          p.onkeydown = ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); p.click(); } };
        });
      } catch (e) {
        if (el.isConnected && id === pedido) conteudo.innerHTML = `<p class="aviso-mini">Não foi possível carregar os dados: ${esc(e.message)}</p>`;
      }
    };
    const carregarAnos = async () => {
      const id = ++pedido;
      const uf = UF || "";
      conteudo.innerHTML = `<p class="aviso-mini">Carregando anos disponíveis…</p>`;
      anoEl.disabled = true;
      try {
        const d = await request(`/api/q9/anos${uf ? `?uf=${encodeURIComponent(uf)}` : ""}`, { silencioso: true });
        if (!el.isConnected || id !== pedido) return;
        const anos = d.anos || [];
        anoEl.innerHTML = anos.map(a => `<option value="${a}">${a}</option>`).join("");
        anoEl.disabled = !anos.length;
        if (!anos.length) { conteudo.innerHTML = `<p class="aviso-mini">Sem lançamentos classificados nos anos disponíveis.</p>`; return; }
        anoEl.value = String(anos.includes(ANO) ? ANO : anos[anos.length - 1]);
        await carregar(uf, anoEl.value);
      } catch (e) { if (el.isConnected && id === pedido) conteudo.innerHTML = `<p class="aviso-mini">Não foi possível carregar os anos: ${esc(e.message)}</p>`; }
    };
    anoEl.onchange = () => carregar(UF || "", anoEl.value);
    await carregarAnos();
    el.querySelector("#p9-busca").onclick = () => {
      // o painel fecha pela troca de endereço e devolve o foco ao card; a busca
      // recebe o foco depois disso
      window.addEventListener("hashchange", () => setTimeout(() => {
        const busca = document.getElementById("busca");
        busca.scrollIntoView({ block: "center" });
        if (!busca.disabled) busca.focus();
      }, 0), { once: true });
      document.getElementById("qp-fechar")?.click();
    };
  },
  fichaCandidatura(c, h) {
    return nuvemPropaganda(c, { propagandaValor: h.bruto?.propagandaValor || [], propagandaFrequencia: h.bruto?.propagandaFrequencia || [] });
  },
  aoAbrirGaveta(corpo) {
    corpo.querySelectorAll("[data-q9]").forEach(b => b.onclick = () => {
      const grupo = b.closest(".q9-conteudo");
      const modo = b.dataset.q9;
      grupo.querySelectorAll("[data-q9]").forEach(botao => botao.setAttribute("aria-pressed", String(botao === b)));
      grupo.querySelectorAll("[data-q9-nuvem]").forEach(nuvem => { nuvem.hidden = nuvem.dataset.q9Nuvem !== modo; });
      const ativa = grupo.querySelector(`[data-q9-nuvem="${modo}"] .nuvem`);
      if (ativa) organizarNuvem(ativa);
    });
    prepararNuvens(corpo);
  },
};
