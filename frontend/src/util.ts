// Utilidades compartilhadas entre a página do mapa e as páginas de questão.
// Só código puro (formatadores, constantes e pedidos HTTP com o indicador de carga).
// @ts-nocheck

export const UFS = ["AC","AL","BA","DF","RO","SP"];
export const ANOS = [2018, 2020, 2022, 2024];
export const CARGO_COD = {1:"Presidente",3:"Governador",5:"Senador",6:"Deputado federal",7:"Deputado estadual",8:"Deputado distrital",11:"Prefeito",13:"Vereador"};
export const ORDEM_CARGO = ["GOVERNADOR","SENADOR","DEPUTADO FEDERAL","DEPUTADO ESTADUAL","DEPUTADO DISTRITAL","PREFEITO","VEREADOR"];
// ordem dos botões de cargo no mapa; o primeiro disponível é o padrão do ano
export const ORDEM_COD = [11, 13, 3, 5, 1, 6, 7, 8];
export const ELEITO = new Set(["ELEITO","ELEITO POR QP","ELEITO POR MÉDIA"]);
// anos de eleição geral: cargo 1 (Presidente) aparece na lista de filtros
export const ANOS_PRESIDENTE = new Set([2018, 2022]);

export const COR = {
  "MDB":"#2F8F5B","PP":"#79AEDB","PSD":"#E5C33A","PL":"#24304F","PSB":"#E8743B","UNIÃO":"#1C9C97",
  "REPUBLICANOS":"#6A4C93","PRB":"#8E73B5","PT":"#C8323C","PSDB":"#3D7BD9","PDT":"#9C2A5A","PODE":"#8BC34A",
  "DEM":"#7E9C3C","PTB":"#B5651D","AVANTE":"#F48FB1","SOLIDARIEDADE":"#F7B267","PV":"#A3D977",
  "PC do B":"#8E1B1B","PSL":"#D98E04","PROS":"#E6A0C4","PSC":"#4E7A8C","PRD":"#5D6D7E","PATRIOTA":"#2E4A3B",
  "CIDADANIA":"#C27CB0","PPS":"#C27CB0","PRTB":"#7A5C3E","PR":"#34495E","PMN":"#B0A08A","REDE":"#2AA876",
  "AGIR":"#A3876A","DC":"#6F8FAF","PRP":"#9E9E5B","PTC":"#A3876A","PHS":"#8C7AA9","PSOL":"#B39DDB",
  "NOVO":"#F07F2A","PMB":"#D96BA0","MOBILIZA":"#B0A08A","PCO":"#7B2D26","PSTU":"#A33B3B","UP":"#5A2A2A","PCB":"#912F2F"
};
export const corP = sg => COR[sg] || "#8A8F98";

export const fmt = new Intl.NumberFormat("pt-BR");
export const brl = v => v == null ? "–" : "R$ " + new Intl.NumberFormat("pt-BR",{maximumFractionDigits: Math.abs(v)>=1000?0:2, minimumFractionDigits: Math.abs(v)>=1000?0:2}).format(v);
export const brlc = v => { if (v == null) return "–"; const a=Math.abs(v);
  if (a>=1e6) return "R$ "+(v/1e6).toLocaleString("pt-BR",{maximumFractionDigits:1})+" mi";
  if (a>=1e3) return "R$ "+(v/1e3).toLocaleString("pt-BR",{maximumFractionDigits:0})+" mil";
  return "R$ "+fmt.format(Math.round(v)); };
export const titulo = s => s ? String(s).toLowerCase().replace(/(^|[\s\-\/(])(\p{L})/gu,(m,a,b)=>a+b.toUpperCase()).replace(/\b(Da|De|Do|Das|Dos|E)\b/g, m=>m.toLowerCase()) : "";
export const cargoNome = s => titulo(s).replace(/^Deputado /,"Deputado ").replace("Deputado Federal","Deputado federal").replace("Deputado Estadual","Deputado estadual").replace("Deputado Distrital","Deputado distrital");
export const norm = s => String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase();
export const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
export const ordemCargo = c => { const i = ORDEM_CARGO.indexOf(c); return i<0?99:i; };
export const pctFmt = (a, b) => (a/b*100).toLocaleString("pt-BR",{maximumFractionDigits:1}) + "%";
export const idade = (nasc, ano) => { if (!nasc) return null; const [y,m,d] = nasc.split("-").map(Number); const ref = new Date(ano, 9, 1); let i = ref.getFullYear()-y; if (ref < new Date(ref.getFullYear(), m-1, d)) i--; return i; };
export const ehEleito = s => ELEITO.has(s);
export const sitTxt = s => s ? titulo(s).replace("Por Qp","por QP").replace("Por Média","por média").replace("Não Eleito","Não eleito") : "Sem resultado";

// indicador dinâmico de carga: aparece para qualquer requisição pendente e só some quando
// a última responder (várias chamadas em paralelo compartilham o mesmo contador)
let pendentes = 0;
// opcoes.silencioso: não mostra o véu de carga (busca enquanto se digita);
// opcoes.signal: AbortSignal para cancelar uma requisição que ficou velha.
export const request = async (path, opcoes = {}) => {
  const { silencioso = false, signal } = opcoes;
  if (!silencioso){ pendentes++; sinalizaCarga(); }
  try {
    const response = await fetch(path, { signal });
    // quando o backend cai ou reinicia, o proxy do Vite responde com texto, não JSON
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Não foi possível consultar MotherDuck.");
    return data;
  } finally {
    if (!silencioso){ pendentes--; sinalizaCarga(); }
  }
};
function sinalizaCarga(){
  const carga = document.getElementById("carga");
  if (carga) carga.classList.toggle("on", pendentes > 0);
}
