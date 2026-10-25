// @ts-nocheck
// Questão 9: onde o candidato investe em propaganda (nuvens de palavras).
// Não tem seção própria na página: acrescenta as nuvens à ficha de cada candidato.
// Edite só este arquivo (e o .css ao lado).
import { fmt, brl, titulo, esc } from "../util";
import "./p9-propaganda.css";

function organizarNuvem(nuvem){
  if (!nuvem || !nuvem.clientWidth || nuvem.closest("[hidden]") || !nuvem.closest("details")?.open) return;
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
      dica.innerHTML = `<b>${esc(palavra.textContent)}</b><span>Gastos associados: ${brl(valor)}</span><span>Lançamentos que contêm o termo: ${fmt.format(lancamentos)}</span>`;
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
    if (nuvem.closest("details")?.open && !nuvem.closest("[hidden]")) organizarNuvem(nuvem);
  });
}

window.addEventListener("resize", () => {
  document.querySelectorAll(".nuvem").forEach(organizarNuvem);
});

function nuvemPropaganda(c, h){
  const filtrar = rows => rows.filter(r => +r.ano_eleicao === +c.ano_eleicao && r.ds_cargo === c.cargo);
  const valor = filtrar(h.propagandaValor), frequencia = filtrar(h.propagandaFrequencia);
  if (!valor.length && !frequencia.length) return "";
  const render = (rows, modo) => {
    if (!rows.length) return `<p class="aviso-mini">Sem lançamentos classificados como propaganda nesta candidatura.</p>`;
    return `<div class="nuvem" data-modo="${modo}" role="list" aria-label="Termos de propaganda por ${modo === "valor" ? "valor gasto" : "frequência de lançamentos"}">${rows.map(r =>
      `<span role="listitem" tabindex="0" data-peso="${+r.peso || 0}" data-valor="${+r.valor_pago_associado || 0}" data-lancamentos="${+r.qt_lancamentos || 0}">${esc(r.termo)}</span>`
    ).join("")}<div class="nuvem-tooltip" role="tooltip" hidden></div></div>`;
  };
  return `<details class="q9"><summary>Onde investiu em propaganda?</summary>
    <div class="q9-conteudo">
      <div class="ctrl q9-controles" role="group" aria-label="Métrica da nuvem">
        <button type="button" data-q9="valor" aria-pressed="true">Valor gasto</button>
        <button type="button" data-q9="frequencia" aria-pressed="false">Frequência</button>
      </div>
      <div data-q9-nuvem="valor">${render(valor, "valor")}</div>
      <div data-q9-nuvem="frequencia" hidden>${render(frequencia, "frequencia")}</div>
      <p class="aviso-mini">Valor associa a cada termo os pagamentos dos lançamentos que o contêm; termos diferentes podem compartilhar o mesmo gasto. Frequência conta lançamentos, não unidades compradas, e pode incluir parcelas. Passe o cursor sobre um termo para ver os valores.</p>
    </div>
  </details>`;
}

export default {
  id: "p9", numero: "P9",
  titulo: "Onde o candidato investe em propaganda?",
  pergunta: "Onde o candidato investe em propaganda (nuvem de palavras)?",
  resumo: "Nuvens de palavras das despesas de propaganda, por valor gasto e por frequência, na ficha de cada candidato.",
  onde: "Na ficha de cada candidato",
  montar(el) {
    el.innerHTML = `<p class="nota">As despesas de propaganda de cada candidatura viram duas nuvens de palavras: por <b>valor gasto</b> (cada termo leva os pagamentos dos lançamentos que o contêm) e por <b>frequência</b> (em quantos lançamentos o termo aparece). Elas ficam na ficha do candidato, em "Onde investiu em propaganda?", dentro de cada candidatura.</p>
      <p class="nota">Para ver: escolha um estado, busque um candidato pelo nome (ou abra um município e clique em um dos mais votados) e abra a ficha.</p>
      <p><button type="button" class="link" id="p9-busca">Ir para a busca de candidatos</button></p>`;
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
