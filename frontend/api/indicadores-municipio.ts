// Indicadores temporais do município que alimentam a gaveta principal,
// independentemente das extensões específicas das questões.
import { comCache, rows, seguido } from "./banco";

export async function carregarIndicadoresMunicipio(codigoTse: string) {
  const [perfilEleitorado, indicadoresIbge, idhmAtlas, escolaridadeCenso] = await comCache(
    `indicadores-municipio-v1:${codigoTse}`,
    () => seguido([
      () => rows(`SELECT f.ano_eleicao, f.tp_dimensao, f.ds_categoria, f.qt_eleitores
            FROM public.fato_perfil_eleitorado f
            JOIN public.municipio m USING (cd_municipio_ibge)
            WHERE m.cd_municipio_tse = $1
            ORDER BY f.ano_eleicao, f.tp_dimensao, f.ds_categoria`, [codigoTse]),
      () => rows(`SELECT s.ano, s.populacao, s.tipo_populacao, s.pib, s.pib_per_capita,
                         s.vab_agropecuaria, s.vab_industria, s.vab_servicos,
                         s.vab_administracao_publica, s.area_km2, s.densidade_hab_km2, s.fonte
            FROM public.fato_socioeconomico_ibge s
            JOIN public.municipio m USING (cd_municipio_ibge)
            WHERE m.cd_municipio_tse = $1
            ORDER BY s.ano`, [codigoTse]),
      () => rows(`SELECT a.ano_referencia, a.idhm, a.idhm_r, a.idhm_l, a.idhm_e
            FROM public.fato_idhm_atlas a
            JOIN public.municipio m ON m.cd_municipio_ibge = a.codmun7
            WHERE m.cd_municipio_tse = $1
            ORDER BY a.ano_referencia`, [codigoTse]),
      () => rows(`SELECT e.ano_referencia, e.ds_faixa_etaria, e.ds_nivel_instrucao,
                         e.qt_pessoas, e.qt_populacao, e.pct_populacao
            FROM public.fato_escolaridade_populacao e
            JOIN public.municipio m USING (cd_municipio_ibge)
            WHERE m.cd_municipio_tse = $1
            ORDER BY e.ano_referencia, e.ds_nivel_instrucao`, [codigoTse]),
    ]),
  );
  return { perfilEleitorado, indicadoresIbge, idhmAtlas, escolaridadeCenso };
}
