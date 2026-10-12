// Gera as malhas municipais usadas no mapa (public/geo/municipios-UF.json).
// Execute uma vez, na pasta frontend/:  bun run malhas
//
// Fontes:
// - Polígonos dos municípios (IBGE): github.com/tbrugz/geodata-br
// - Correspondência código TSE x código IBGE: github.com/betafcc/Municipios-Brasileiros-TSE
//
// Cada feição sai com { tse, nome }. O código TSE tem 5 dígitos com zeros à
// esquerda, o mesmo formato de public.municipio.cd_municipio_tse no banco.
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
// @ts-ignore: mapshaper não publica tipos
import mapshaper from "mapshaper";

const UFS: Record<string, string> = { AC: "12", AL: "27", BA: "29", DF: "53", RO: "11", SP: "35" };
const GEO_URL = (cod: string) => `https://raw.githubusercontent.com/tbrugz/geodata-br/master/geojson/geojs-${cod}-mun.json`;
const TSE_URL = "https://raw.githubusercontent.com/betafcc/Municipios-Brasileiros-TSE/master/municipios_brasileiros_tse.csv";
const SAIDA = resolve(import.meta.dir, "../public/geo");

async function baixar(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Falha ao baixar ${url}: ${r.status}`);
  return r.text();
}

const csv = await baixar(TSE_URL);
const [cab, ...linhas] = csv.trim().split(/\r?\n/);
const col = cab.split(",");
const iTse = col.indexOf("codigo_tse"), iIbge = col.indexOf("codigo_ibge");
const tsePorIbge = new Map(linhas.map((l) => l.split(",")).map((c) => [c[iIbge], c[iTse].padStart(5, "0")]));

// Na fonte, municípios com ilhas (litoral de SP, BA) vêm como um Polygon com
// vários anéis externos. Separa-os em MultiPolygon: anel horário = parte externa,
// anti-horário = buraco da última parte externa. Sem isso o anel principal vira
// "buraco" e o d3 desenha o município invertido.
type Anel = number[][];
const areaPlana = (r: Anel) => r.slice(1).reduce((s, p, i) => s + r[i][0] * p[1] - p[0] * r[i][1], 0) / 2;
function corrigirAneis(geometry: { type: string; coordinates: any }) {
  const poligonos: Anel[][] = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const saida: Anel[][] = [];
  for (const aneis of poligonos) for (const anel of aneis) {
    if (areaPlana(anel) <= 0 || !saida.length) saida.push([anel]);
    else saida[saida.length - 1].push(anel);
  }
  return saida.length === 1 ? { type: "Polygon", coordinates: saida[0] } : { type: "MultiPolygon", coordinates: saida };
}

await mkdir(SAIDA, { recursive: true });
for (const [uf, cod] of Object.entries(UFS)) {
  const geo = JSON.parse(await baixar(GEO_URL(cod)));
  const semCodigo: string[] = [];
  for (const f of geo.features) {
    const ibge = String(f.properties.id);
    const tse = tsePorIbge.get(ibge);
    if (!tse) semCodigo.push(`${f.properties.name} (${ibge})`);
    f.properties = { tse: tse ?? null, nome: f.properties.name };
    f.geometry = corrigirAneis(f.geometry);
  }
  // Simplificação que preserva a topologia (fronteiras compartilhadas não se separam)
  // e mantém detalhe suficiente para zoom de até ~12x.
  const out = await mapshaper.applyCommands(
    `-i entrada.json name=municipios -simplify weighted 12% keep-shapes -o saida.json format=topojson quantization=60000`,
    { "entrada.json": JSON.stringify(geo) },
  );
  const arquivo = resolve(SAIDA, `municipios-${uf}.json`);
  await writeFile(arquivo, out["saida.json"]);
  console.log(`${uf}: ${geo.features.length} municípios, ${(out["saida.json"].length / 1024).toFixed(0)} kB`
    + (semCodigo.length ? `; sem código TSE: ${semCodigo.join(", ")}` : ""));
}
