// @ts-nocheck
import { brl, titulo } from '../util';
import { abrirMunicipio } from '../presentation';

export function montarMapaCusto(host, topo, linhas) {
  const features = topojson.feature(topo, topo.objects.municipios).features;
  const projection = d3.geoMercator().fitExtent([[35, 190], [865, 650]], {type:'FeatureCollection',features});
  let azimute = 0, inclinacao = Math.PI / 3, zoom = 1;
  const projetar = (p, z = 0) => {
    const x = p[0] - 450, y = p[1] - 420;
    const u = x * Math.cos(azimute) - y * Math.sin(azimute);
    const v = x * Math.sin(azimute) + y * Math.cos(azimute);
    return [450 + u * zoom, 420 + (v * Math.cos(inclinacao) - z * Math.sin(inclinacao)) * zoom];
  };
  const geometrias = new Map(features.map(f => {
    const polygons = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    const rings = polygons.flatMap(p => p.map(r => r.map(projection)));
    return [f, { rings, path: d3.geoPath(projection)(f), centro: projection(d3.geoCentroid(f)) }];
  }));
  let modo = 'prefeito';
  host.innerHTML = '<div class="cargos" role="group" aria-label="Gasto representado no mapa"><button type="button" data-mapa="prefeito" aria-pressed="true">Prefeito eleito</button><button type="button" data-mapa="municipio" aria-pressed="false">Município · todos os candidatos</button></div><p class="nota" data-legenda></p><div class="p1-mapa-area"></div><p class="aviso-mini">Altura linear em reais. Cada coluna tem o contorno do município; a área territorial não representa gasto. Arraste para girar e inclinar. Role para aproximar; dê dois cliques para redefinir a vista. Passe o mouse ou use Tab para consultar. Clique para abrir o município.</p>';
  const area=host.querySelector('.p1-mapa-area');
  const render=()=>{
    const valores=new Map();
    for(const r of linhas){
      if(!r.cd_municipio_tse || (modo==='prefeito' && +r.cd_cargo!==11)) continue;
      const n=Number(modo==='prefeito'?r.qt_eleitos_com_despesa:r.qt_com_despesa);
      if(!n) continue;
      const v=Number(modo==='prefeito'?r.vr_despesas_eleitos:r.vr_despesas_total);
      const key=String(r.cd_municipio_tse);
      valores.set(key,(valores.get(key)||0)+v);
    }
    const max=Math.max(...valores.values(),0);
    host.querySelector('[data-legenda]').textContent=modo==='prefeito'
      ? 'Altura = soma das despesas de campanha dos prefeitos eleitos com dados financeiros.'
      : 'Altura = soma das despesas de campanha de candidatos a prefeito e vereador no município.';
    area.replaceChildren();
    const svg=d3.select(area).append('svg').attr('viewBox','0 0 900 700').attr('role','group').attr('aria-label','Mapa de gastos de campanha por município');
    const tooltip=document.createElement('div');tooltip.className='p1-mapa-tooltip';tooltip.hidden=true;area.append(tooltip);
    const height=d3.scaleLinear().domain([0,max||1]).range([0,155]);
    const updates = [];
    const centro = f => { const p = geometrias.get(f).centro; return (p[0]-450)*Math.sin(azimute)+(p[1]-420)*Math.cos(azimute); };
    const ordenados=features.slice().sort((a,b)=>centro(a)-centro(b));
    let arrastou = false;
    for(const f of ordenados){
      const valor=valores.get(String(f.properties.tse)),h=valor==null?0:height(valor);
      const g=svg.append('g').attr('class','p1-mapa-municipio').attr('tabindex',0).attr('role','button');
      const label=`${titulo(f.properties.nome)}: ${valor==null?'sem dados financeiros':brl(valor)}`;
      g.attr('aria-label',label).append('title').text(label);
      g.datum(f);
      const geometria = geometrias.get(f);
      const base = g.append('path').attr('class','p1-mapa-base').attr('d',geometria.path).node();
      const lado = h > 0 ? g.append('path').attr('class','p1-mapa-lado').node() : null;
      const top = g.append('path').attr('class',valor==null?'p1-mapa-sem-dado':'p1-mapa-topo').attr('d',geometria.path).node();
      updates.push(() => {
        const c=Math.cos(azimute), sn=Math.sin(azimute), tilt=Math.cos(inclinacao);
        const a=c*zoom,b=sn*tilt*zoom,cc=-sn*zoom,d=c*tilt*zoom;
        const tx=450-a*450-cc*420,ty=420-b*450-d*420;
        base.setAttribute('transform',`matrix(${a} ${b} ${cc} ${d} ${tx} ${ty})`);
        top.setAttribute('transform',`matrix(${a} ${b} ${cc} ${d} ${tx} ${ty-h*Math.sin(inclinacao)*zoom})`);
        if(lado){
          const dz=h*Math.sin(inclinacao)*zoom;
          let walls='';
          for(const ring of geometria.rings){
            const points=ring.map(p=>[a*p[0]+cc*p[1]+tx,b*p[0]+d*p[1]+ty]);
            for(let i=1;i<points.length;i++){
              // Faces com sentidos opostos se anulam quando reunidas no mesmo path SVG.
              const [p,q]=points[i-1][0] <= points[i][0]
                ? [points[i-1],points[i]] : [points[i],points[i-1]];
              walls+=`M${p[0].toFixed(1)},${p[1].toFixed(1)}L${q[0].toFixed(1)},${q[1].toFixed(1)}v${(-dz).toFixed(1)}L${p[0].toFixed(1)},${(p[1]-dz).toFixed(1)}Z`;
            }
          }
          lado.setAttribute('d',walls);
        }
      });
      const mostrar=()=>{if(arrastou)return;tooltip.textContent=label;tooltip.hidden=false;};
      const abrir=()=>{if(arrastou)return;tooltip.hidden=true;abrirMunicipio(String(f.properties.tse));};
      g.on('pointerenter focus',mostrar).on('pointerleave blur',()=>tooltip.hidden=true).on('click',abrir).on('pointerdown',()=>{arrastou=false;}).on('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();arrastou=false;abrir();}});
    }
    let frame = 0;
    const desenhar = () => {
      frame = 0;
      updates.forEach(f => f());
      svg.selectAll('.p1-mapa-municipio').sort((a,b)=>centro(a)-centro(b));
    };
    const atualizar = () => { tooltip.hidden=true; if(!frame)frame=requestAnimationFrame(desenhar); };
    svg.call(d3.drag().clickDistance(5).on('start',()=>{arrastou=false;}).on('drag',event=>{
      arrastou=true;
      azimute += event.dx * .008;
      inclinacao=Math.max(0,Math.min(Math.PI*75/180,inclinacao-event.dy*.006));
      atualizar();
    }));
    svg.on('wheel.camera',event=>{
      event.preventDefault();
      zoom=Math.max(.7,Math.min(1.8,zoom*Math.exp(-event.deltaY*.001)));
      atualizar();
    },{passive:false}).on('dblclick.camera',event=>{
      event.preventDefault();
      azimute=0;inclinacao=Math.PI/3;zoom=1;atualizar();
    });
    desenhar();
    svg.append('text').attr('x',35).attr('y',680).attr('class','p1-mapa-escala').text(`Maior altura: ${brl(max)} · ${valores.size} municípios com dados`);
  };
  host.querySelectorAll('[data-mapa]').forEach(b=>b.onclick=()=>{modo=b.dataset.mapa;host.querySelectorAll('[data-mapa]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));render();});
  render();
}
