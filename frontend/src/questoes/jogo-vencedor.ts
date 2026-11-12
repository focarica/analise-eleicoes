// @ts-nocheck
import { fmt, brlc, esc } from "../util";
import "./jogo-vencedor.css";

const mockDuelos = [
  {
    id_disputa: "2022_SP_ESTADUAL_GOVERNADOR",
    ano: 2022,
    cd_municipio: "ESTADUAL",
    uf: "SP",
    cargo: "GOVERNADOR",
    
    cand1_sq: 250001612497,
    cand1_nome: "TARCÍSIO",
    cand1_partido: "REPUBLICANOS",
    cand1_idade: 47,
    cand1_instrucao: "SUPERIOR COMPLETO",
    cand1_genero: "MASCULINO",
    cand1_patrimonio: 104900.00,
    cand1_despesa: 17500000.00,
    cand1_votos: 9881995,
    cand1_venceu: true,

    cand2_sq: 250001605333,
    cand2_nome: "FERNANDO HADDAD",
    cand2_partido: "PT",
    cand2_idade: 59,
    cand2_instrucao: "SUPERIOR COMPLETO",
    cand2_genero: "MASCULINO",
    cand2_patrimonio: 15416.00,
    cand2_despesa: 7400000.00,
    cand2_votos: 8337139,
    cand2_venceu: false
  }
];

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

  // Lógica unificada para saber o que exibir
  const exibeLocal = localRevelado || identidadeRevelada || finalizado;
  const exibePartido = partidoRevelado || identidadeRevelada || finalizado;
  const exibeIdentidade = identidadeRevelada || finalizado;

  const renderCarta = (cand, id) => `
    <div class="jogo-carta ${finalizado && cand.venceu ? 'carta-vencedora' : ''} ${finalizado && !cand.venceu ? 'carta-perdedora' : ''}">
      <div class="carta-header">
        <h3>${exibeIdentidade ? esc(cand.nome) : `Candidato ${id.toUpperCase()}`}</h3>
        ${exibePartido 
          ? `<span class="tag-partido">${esc(cand.partido)}</span>` 
          : `<button class="btn-mini btn-rev-partido">🚩 Revelar Partido</button>`
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

  el.innerHTML = `
    <div class="jogo-container">
      <div class="jogo-header">
        <div class="jogo-titulo-linha">
          <h2>Disputa para ${esc(duelo.cargo)} (${duelo.ano})</h2>
          ${!exibeIdentidade ? `<button id="btn-revelar-tudo" class="btn-mini">👀 Revelar Identidade</button>` : ''}
        </div>
        <p class="local-oculto">
          ${exibeLocal 
            ? `📍 ${duelo.cd_municipio === 'ESTADUAL' ? esc(duelo.uf) : esc(duelo.cd_municipio) + ' - ' + esc(duelo.uf)}` 
            : `📍 LOCAL OCULTO <button id="btn-rev-local" class="btn-mini">Revelar Local</button>`
          }
        </p>
      </div>

      ${finalizado ? `
        <div class="jogo-feedback ${acertou ? 'feedback-sucesso' : 'feedback-erro'}">
          ${acertou ? '🎉 Boa! A sua intuição política está afiada.' : '❌ Não foi dessa vez! A realidade eleitoral surpreendeu.'}
        </div>
      ` : ''}

      <div class="jogo-arena">
        ${renderCarta(cA, 'a')}
        <div class="jogo-vs">VS</div>
        ${renderCarta(cB, 'b')}
      </div>

      ${finalizado ? `
        <div class="jogo-controles">
          <button id="btn-proximo" class="btn-primario">🔄 Jogar novamente</button>
        </div>
      ` : ''}
    </div>
  `;

  if (!finalizado) {
    // Votar
    el.querySelectorAll('.btn-apostar').forEach(btn => {
      btn.onclick = () => {
        estado.escolha = btn.dataset.escolha;
        renderizarJogo(el, duelo, estado);
      };
    });
    
    // Revelar tudo (Identidade completa)
    const btnRevTudo = el.querySelector('#btn-revelar-tudo');
    if (btnRevTudo) btnRevTudo.onclick = () => {
      estado.identidadeRevelada = true;
      renderizarJogo(el, duelo, estado);
    };

    // Revelar apenas Local
    const btnRevLocal = el.querySelector('#btn-rev-local');
    if (btnRevLocal) btnRevLocal.onclick = () => {
      estado.localRevelado = true;
      renderizarJogo(el, duelo, estado);
    };

    // Revelar apenas Partidos
    el.querySelectorAll('.btn-rev-partido').forEach(btn => {
      btn.onclick = () => {
        estado.partidoRevelado = true;
        renderizarJogo(el, duelo, estado);
      };
    });
  } else {
    // Próxima rodada
    const btnProximo = el.querySelector('#btn-proximo');
    if (btnProximo) btnProximo.onclick = () => {
      estado.escolha = null;
      estado.identidadeRevelada = false;
      estado.localRevelado = false;
      estado.partidoRevelado = false;
      estado.inverter = Math.random() > 0.5;
      renderizarJogo(el, mockDuelos[0], estado);
    };
  }
}

export function inicializarJogo() {
  const btnAbrir = document.getElementById("jogo-abrir");
  const btnFechar = document.getElementById("jogo-fechar");
  const modal = document.getElementById("jogo-modal");
  const corpo = document.getElementById("jogo-corpo");

  if (!btnAbrir || !modal || !corpo) return;

  btnAbrir.addEventListener("click", () => {
    modal.showModal();
    const estado = { 
      identidadeRevelada: false, 
      localRevelado: false, 
      partidoRevelado: false, 
      escolha: null, 
      inverter: Math.random() > 0.5 
    };
    renderizarJogo(corpo, mockDuelos[0], estado);
  });

  btnFechar.addEventListener("click", () => {
    modal.close();
    corpo.innerHTML = "";
  });
}