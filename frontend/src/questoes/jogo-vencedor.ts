// @ts-nocheck
import { fmt, brlc, esc, request } from "../util";
import "./jogo-vencedor.css";

let todosDuelos = [];

async function sortearDuelo() {
  if (todosDuelos.length === 0) {
    const resposta = await request("/api/jogo-vencedor", { silencioso: true });
    todosDuelos = Array.isArray(resposta) ? resposta : resposta.dados || resposta.duelos || [];
  }

  const duelosValidos = todosDuelos.filter(d => 
    (d.cand1_despesa > 0 || d.cand2_despesa > 0) && 
    (d.cand1_patrimonio > 0 || d.cand2_patrimonio > 0)
  );

  const lista = duelosValidos.length > 0 ? duelosValidos : todosDuelos;
  const indiceSorteado = Math.floor(Math.random() * lista.length);
  return lista[indiceSorteado];
}

function renderizarJogo(el, duelo, estado) {
  const { identidadeRevelada, localRevelado, partidoRevelado, escolha, inverter } = estado;
  const finalizado = escolha !== null;

  const vencedor = {
    sq: duelo.cand1_sq, nome: duelo.cand1_nome, partido: duelo.cand1_partido,
    idade: duelo.cand1_idade, instrucao: duelo.cand1_instrucao, genero: duelo.cand1_genero,
    patrimonio: duelo.cand1_patrimonio, despesa: duelo.cand1_despesa,
    votos: duelo.cand1_votos, venceu: duelo.cand1_venceu
  };

  const perdedor = {
    sq: duelo.cand2_sq, nome: duelo.cand2_nome, partido: duelo.cand2_partido,
    idade: duelo.cand2_idade, instrucao: duelo.cand2_instrucao, genero: duelo.cand2_genero,
    patrimonio: duelo.cand2_patrimonio, despesa: duelo.cand2_despesa,
    votos: duelo.cand2_votos, venceu: duelo.cand2_venceu
  };

  const cA = inverter ? perdedor : vencedor;
  const cB = inverter ? vencedor : perdedor;

  const acertou = finalizado && (
    (escolha === 'a' && cA.venceu) ||
    (escolha === 'b' && cB.venceu)
  );

  const exibeLocal = localRevelado || identidadeRevelada || finalizado;
  const exibePartido = partidoRevelado || identidadeRevelada || finalizado;
  const exibeIdentidade = identidadeRevelada || finalizado;

  const getUrlFoto = (ano, sq) => `/api/photo/${ano}/${sq}`;

  const renderCarta = (cand, id) => `
    <div class="jogo-carta ${finalizado && cand.venceu ? 'carta-vencedora' : ''} ${finalizado && !cand.venceu ? 'carta-perdedora' : ''}">
      
      <div class="carta-foto-container">
        <div class="foto-moldura">
          ${exibeIdentidade 
            ? `
               <svg class="foto-fallback" viewBox="0 0 24 24" fill="currentColor">
                 <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
               </svg>
               <img class="foto-cand" src="${getUrlFoto(duelo.ano, cand.sq)}" alt="Foto" onerror="this.style.display='none'" />
              `
            : `<div class="foto-placeholder">?</div>`
          }
        </div>
      </div>

      <div class="carta-header">
        <h3>${exibeIdentidade ? esc(cand.nome) : `Candidato ${id.toUpperCase()}`}</h3>
        ${exibePartido 
          ? `<span class="tag-partido">${esc(cand.partido)}</span>` 
          : `<button class="btn-mini btn-rev-partido">Revelar Partido</button>`
        }
      </div>
      <ul class="carta-dados">
        <li><span>Gastos:</span> <strong>${cand.despesa > 0 ? brlc(cand.despesa) : 'Não declarado'}</strong></li>
        <li><span>Patrimônio:</span> <strong>${cand.patrimonio > 0 ? brlc(cand.patrimonio) : 'Nenhum bem'}</strong></li>
        <li><span>Idade:</span> <strong>${cand.idade} anos</strong></li>
        <li><span>Gênero:</span> <strong>${esc(cand.genero)}</strong></li>
        <li><span>Instrução:</span> <strong>${esc(cand.instrucao)}</strong></li>
      </ul>
      ${finalizado ? `
        <div class="resultado-votos">
          <span class="pct">${fmt.format((cand.votos / (vencedor.votos + perdedor.votos)) * 100)}%</span>
          <span class="total">(${fmt.format(cand.votos)} votos)</span>
        </div>
      ` : `
        <button class="btn-apostar" data-escolha="${id}">Votar neste perfil</button>
      `}
    </div>
  `;

  // Lógica de exibição segura do local
  let textoLocal = "";
  if (duelo.cargo === "PRESIDENTE") {
    textoLocal = "BR";
  } else if (duelo.nm_municipio && duelo.estado_real) {
    // Agora usa a sigla real do estado puxada do JOIN
    textoLocal = `${esc(duelo.nm_municipio)} - ${esc(duelo.estado_real)}`;
  } else if (duelo.cd_municipio === 'ESTADUAL' || duelo.cargo === 'GOVERNADOR' || duelo.cargo === 'SENADOR') {
    textoLocal = esc(duelo.uf);
  } else {
    textoLocal = `Cód TSE: ${esc(duelo.cd_municipio)}`;
  }

  el.innerHTML = `
    <div class="jogo-container">
      <div class="jogo-header">
        <div class="jogo-titulo-linha">
          <h2>Disputa para ${esc(duelo.cargo)} (${duelo.ano})</h2>
          <div class="jogo-acoes-topo">
            ${!exibeIdentidade ? `<button id="btn-revelar-tudo" class="btn-mini">Revelar Identidade</button>` : ''}
            <button id="btn-pular" class="btn-mini btn-destaque">Próximo confronto</button>
          </div>
        </div>
        <p class="local-oculto">
          ${exibeLocal 
            ? textoLocal 
            : `LOCAL OCULTO <button id="btn-rev-local" class="btn-mini">Revelar Local</button>`
          }
        </p>
      </div>

      ${finalizado ? `
        <div class="jogo-feedback ${acertou ? 'feedback-sucesso' : 'feedback-erro'}">
          ${acertou ? 'Boa! A sua intuição política está afiada.' : 'Não foi dessa vez! A realidade eleitoral surpreendeu.'}
        </div>
      ` : ''}

      <div class="jogo-arena">
        ${renderCarta(cA, 'a')}
        <div class="jogo-vs">VS</div>
        ${renderCarta(cB, 'b')}
      </div>
    </div>
  `;

  // O botão de próximo confronto agora serve para pular e para jogar novamente
  const proximoConfronto = async () => {
    el.innerHTML = `<div class="jogo-container"><div class="jogo-header"><h2>Sorteando próxima disputa...</h2></div></div>`;
    const novoDuelo = await sortearDuelo();
    estado.escolha = null;
    estado.identidadeRevelada = false;
    estado.localRevelado = false;
    estado.partidoRevelado = false;
    estado.inverter = Math.random() > 0.5;
    renderizarJogo(el, novoDuelo, estado);
  };

  const btnPular = el.querySelector('#btn-pular');
  if (btnPular) btnPular.onclick = proximoConfronto;

  if (!finalizado) {
    el.querySelectorAll('.btn-apostar').forEach(btn => {
      btn.onclick = () => {
        estado.escolha = btn.dataset.escolha;
        renderizarJogo(el, duelo, estado);
      };
    });
    
    const btnRevTudo = el.querySelector('#btn-revelar-tudo');
    if (btnRevTudo) btnRevTudo.onclick = () => {
      estado.identidadeRevelada = true;
      renderizarJogo(el, duelo, estado);
    };

    const btnRevLocal = el.querySelector('#btn-rev-local');
    if (btnRevLocal) btnRevLocal.onclick = () => {
      estado.localRevelado = true;
      renderizarJogo(el, duelo, estado);
    };

    el.querySelectorAll('.btn-rev-partido').forEach(btn => {
      btn.onclick = () => {
        estado.partidoRevelado = true;
        renderizarJogo(el, duelo, estado);
      };
    });
  }
}

export function inicializarJogo() {
  const btnAbrir = document.getElementById("jogo-abrir");
  const btnFechar = document.getElementById("jogo-fechar");
  const modal = document.getElementById("jogo-modal");
  const corpo = document.getElementById("jogo-corpo");

  if (!btnAbrir || !modal || !corpo) return;

  btnAbrir.addEventListener("click", async () => {
    modal.showModal();
    corpo.innerHTML = `
      <div class="jogo-container" style="justify-content: center; min-height: 300px;">
        <div class="jogo-header"><h2>Carregando base de dados...</h2></div>
      </div>
    `;

    try {
      const dueloSorteado = await sortearDuelo();
      const estado = { 
        identidadeRevelada: false, 
        localRevelado: false, 
        partidoRevelado: false, 
        escolha: null, 
        inverter: Math.random() > 0.5 
      };
      renderizarJogo(corpo, dueloSorteado, estado);
    } catch (erro) {
      console.error("Erro ao buscar a view:", erro);
      corpo.innerHTML = `
        <div class="jogo-container">
          <div class="jogo-feedback feedback-erro">
            Não foi possível carregar os dados. Verifique se o backend está rodando.
          </div>
        </div>
      `;
    }
  });

  btnFechar.addEventListener("click", () => {
    modal.close();
    corpo.innerHTML = "";
  });
}