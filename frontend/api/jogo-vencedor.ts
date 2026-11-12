import { comCache, rows, errorMessage, json } from "./banco";

export default async function handler() {
  try {
    const duelos = await comCache(
      "duelos-jogo-v3", 
      () => rows(`
        SELECT 
          v.*,
          m.nm_municipio,
          -- Puxamos a sigla do estado direto da tabela município para não ter erro
          m.sg_uf AS estado_real 
        FROM public.vw_jogo_quem_venceu v
        LEFT JOIN public.municipio m 
          ON CAST(v.cd_municipio AS VARCHAR) = CAST(m.cd_municipio_tse AS VARCHAR)
      `)
    );

    return json(duelos);
  } catch (error) {
    console.error("Erro na API do Jogo:", error);
    return json({ erro: errorMessage(error) }, 500);
  }
}