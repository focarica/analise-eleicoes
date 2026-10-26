// Questão 9: onde o candidato investe em propaganda (nuvens de palavras na ficha).
// Não tem rota própria: acrescenta propagandaValor e propagandaFrequencia à ficha
// do candidato (/api/candidate/:id). Edite só este arquivo para mudar esses dados.
import { rows } from "../banco";
import type { ExtensaoCandidato } from "./tipos";

// As views vw_questao_9_* agregam a base inteira: filtrar por (ano, sq) das
// candidaturas da pessoa — o que o README das views da Q9 recomenda — faz a
// consulta cair de dezenas de segundos para menos de um.
export const candidato: ExtensaoCandidato = async (_id, candidaturas) => {
  if (!candidaturas.length) return { propagandaValor: [], propagandaFrequencia: [] };
  const filtro = candidaturas
    .map((_, k) => `(ano_eleicao = CAST($${2 * k + 1} AS INTEGER) AND sq_candidato = CAST($${2 * k + 2} AS BIGINT))`)
    .join(" OR ");
  const valores = candidaturas.flatMap((c) => [String(c.ano_eleicao), String(c.sq_candidato)]);
  const nuvem = (ordem: string, peso: string) => rows(`SELECT ano_eleicao, sq_candidato, ds_cargo, termo, ${peso},
                 valor_pago_associado, qt_lancamentos
          FROM public.vw_questao_9_nuvem_valor
          WHERE ${filtro}
          QUALIFY ROW_NUMBER() OVER (
            PARTITION BY ano_eleicao, ds_cargo ORDER BY ${ordem} DESC, termo
          ) <= 35
          ORDER BY ano_eleicao, ds_cargo, ${ordem} DESC, termo`, valores);
  const [propagandaValor, propagandaFrequencia] = await Promise.all([
    nuvem("peso", "peso"),
    // Deriva frequência da mesma base de termos para evitar divergência entre as duas views.
    nuvem("qt_lancamentos", "qt_lancamentos AS peso"),
  ]);
  return { propagandaValor, propagandaFrequencia };
};
