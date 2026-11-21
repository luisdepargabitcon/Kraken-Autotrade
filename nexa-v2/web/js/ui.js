// NEXA V2 — helpers de UI (sin framework) y gráficas SVG.
import { esc, cls, NA, fmtAge, freshness, provText, isNum } from './util.js';

export function h(html){ const t=document.createElement('template'); t.innerHTML=html.trim(); return t.content.firstElementChild; }
export function frag(html){ const t=document.createElement('template'); t.innerHTML=html; return t.content; }
export function clear(el){ while(el.firstChild) el.removeChild(el.firstChild); }

export function card(title, bodyHtml, {right=''}={}){
  return `<section class="card"><h3>${esc(title)}${right?`<span class="right">${right}</span>`:''}</h3>${bodyHtml}</section>`;
}
export function badge(text, kind=''){
  return `<span class="badge ${kind}"><span class="dot"></span>${esc(text)}</span>`;
}
export function modeBadge(mode){
  const m=String(mode||'').toUpperCase();
  const kind = /REAL/.test(m) ? 'real' : /(SHADOW|SIM|LAB|DRY|REPLAY)/.test(m) ? 'sim' : /OFF|DISAB/.test(m) ? 'off' : 'on';
  return badge(m||NA, kind);
}
export function kv(items){
  return `<div class="kv">${items.map(([k,v,sub])=>`
    <div class="item"><div class="k">${esc(k)}</div><div class="v">${v??NA}${sub?` <small class="tiny">${esc(sub)}</small>`:''}</div></div>`).join('')}</div>`;
}
export function row(k, v, {sub=''}={}){
  return `<div class="row"><span class="k">${esc(k)}</span><span class="v">${v??NA}${sub?`<small>${esc(sub)}</small>`:''}</span></div>`;
}
export function provLine(p){
  if(!p) return '';
  const t = provText(p);
  const st = p.state==='unavailable'?'err':(p.state!=='fresh'?'stale':'');
  return `<div class="fresh ${st}">${esc(t)}</div>`;
}
export function freshChip(ts, src){
  const st = freshness(ts);
  const clsN = st==='fresh'?'':(st==='unknown'?'err':'stale');
  return `<span class="fresh ${clsN}" title="${esc(src||'')}">${esc(fmtAge(ts))}${src?` · ${esc(src)}`:''}</span>`;
}
export function table(cols, rows, {minWidth=560}={}){
  return `<div class="tblwrap"><table class="tbl" style="min-width:${minWidth}px">
    <thead><tr>${cols.map(c=>`<th class="${c.num?'num':''}">${esc(c.label)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r=>`<tr>${r.map((c,i)=>`<td class="${cols[i].num?'num':''}">${c??NA}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
export function expandable(summary, bodyHtml, {open=false}={}){
  return `<details class="exp" ${open?'open':''}><summary>${summary}</summary><div class="exp-body">${bodyHtml}</div></details>`;
}
export function microBar(pct, {mark=null, cls:clsN=''}={}){
  const p = Math.max(0, Math.min(100, pct??0));
  const fillCls = p<0?'dn':'up';
  return `<div class="mbar"><div class="fill ${clsN||fillCls}" style="width:${p}%"></div>${mark!==null?`<i class="mark" style="left:${Math.max(0,Math.min(100,mark))}%"></i>`:''}</div>`;
}
export function signed(v, text){ const c = !isNum(v)?'':(v>0?'pos':v<0?'neg':''); return `<span class="${c}">${text}</span>`; }
export function stateBanner(state, msg){
  if(state==='ok'||state==='fresh'||state==='demo') return '';
  const map={ stale:['warn','Datos posiblemente antiguos'], offline:['err','Sin conexión — última lectura cacheada'],
    unavailable:['warn','Sin datos'], error:['err','Error de lectura'], partial:['warn','Datos parciales'] };
  const [k,label]=map[state]||['info',state];
  return `<div class="banner ${k}"><b>${esc(label)}.</b><span>${esc(msg||'')}</span></div>`;
}

// ---------- Gráficas SVG ----------
const NS='http://www.w3.org/2000/svg';
export function lineChart(points, {w=640,hh=180,stroke='var(--blue2)',area=true,marks=[],ylabel=''}={}){
  if(!points||points.length<2) return `<div class="na">${NA}</div>`;
  const xs=points.map((p,i)=>i), ys=points.map(p=>p.v);
  const minY=Math.min(...ys), maxY=Math.max(...ys), pad=(maxY-minY)*0.08||1;
  const lo=minY-pad, hi=maxY+pad;
  const X=i=>8+i*(w-16)/(points.length-1), Y=v=>hh-14-(v-lo)*(hh-30)/(hi-lo);
  const path=points.map((p,i)=>`${i?'L':'M'}${X(i).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ');
  const areaPath=`${path} L${X(points.length-1).toFixed(1)},${hh-14} L${X(0).toFixed(1)},${hh-14} Z`;
  const gridLines=[0.25,0.5,0.75].map(f=>{const y=hh-14-f*(hh-30);return `<line class="grid-ln" x1="8" x2="${w-8}" y1="${y}" y2="${y}"/><text x="10" y="${y-2}">${(lo+f*(hi-lo)).toLocaleString('es-ES',{maximumFractionDigits:0})}</text>`}).join('');
  const markSvg=marks.map(m=>{const i=m.idx; if(i==null||i<0||i>=points.length)return '';
    return `<circle class="${m.cls||'tgt'}" cx="${X(i)}" cy="${Y(points[i].v)}" r="3.5"><title>${esc(m.title||'')}</title></circle>`}).join('');
  const trend = ys[ys.length-1]>=ys[0];
  return `<svg class="chart" viewBox="0 0 ${w} ${hh}" role="img" aria-label="${esc(ylabel||'gráfica')}">
    <defs><linearGradient id="gradUp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#48dc9e33"/><stop offset="1" stop-color="#48dc9e00"/></linearGradient>
    <linearGradient id="gradDn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff718233"/><stop offset="1" stop-color="#ff718200"/></linearGradient></defs>
    ${gridLines}${area?`<path class="${trend?'area-up':'area-dn'}" d="${areaPath}"/>`:''}
    <path class="${trend?'up':'dn'}" d="${path}" style="stroke:${stroke}"/>${markSvg}</svg>`;
}

export function candleChart(candles, {w=680,hh=210,levels=[],buys=[],sells=[],targets=[]}={}){
  if(!candles||candles.length<2) return `<div class="na">${NA}</div>`;
  const lo=Math.min(...candles.map(c=>c.l)), hi=Math.max(...candles.map(c=>c.h));
  const pad=(hi-lo)*0.06||1, l0=lo-pad, h0=hi+pad;
  const bw=(w-16)/candles.length;
  const X=i=>8+i*bw, Y=v=>hh-16-(v-l0)*(hh-30)/(h0-l0);
  const cs=candles.map((c,i)=>{
    const up=c.c>=c.o, x=X(i)+bw/2;
    return `<line class="candle ${up?'up':'dn'}" x1="${x}" x2="${x}" y1="${Y(c.h)}" y2="${Y(c.l)}" stroke-width="1"/>
      <rect class="${up?'body-up':'body-dn'}" x="${x-bw*0.28}" y="${Y(Math.max(c.o,c.c))}" width="${Math.max(1.5,bw*0.56)}" height="${Math.max(1,Math.abs(Y(c.o)-Y(c.c)))}"/>`;
  }).join('');
  const lvl=levels.map(l=>`<line class="level-ln ${l.old?'old':''}" x1="8" x2="${w-8}" y1="${Y(l.price)}" y2="${Y(l.price)}"><title>${esc(l.label||l.price)}</title></line>`).join('');
  const idxOf=ts=>{ if(!ts)return -1; const t=new Date(ts).getTime(); let best=-1,bd=1e18; candles.forEach((c,i)=>{const d=Math.abs(new Date(c.t).getTime()-t); if(d<bd){bd=d;best=i}}); return best; };
  const dot=(ts,price,clsN,title)=>{const i=idxOf(ts); if(i<0)return ''; const x=X(i)+bw/2; return `<circle class="${clsN}" cx="${x}" cy="${Y(price)}" r="4"><title>${esc(title)}</title></circle>`};
  const ms=[
    ...buys.map(b=>dot(b.ts,b.price,'buy',`BUY ${b.price}`)),
    ...sells.map(s=>dot(s.ts,s.price,'sell',`SELL ${s.price}`)),
    ...targets.map(t=>dot(t.ts,t.price,'tgt',`Objetivo ${t.price}`)),
  ].join('');
  return `<svg class="chart" viewBox="0 0 ${w} ${hh}" role="img" aria-label="velas OHLCV">${cs}${lvl}${ms}</svg>`;
}

export function miniSpark(points, {w=120,hh=34}={}){
  if(!points||points.length<2) return '';
  const ys=points.map(p=>p.v), lo=Math.min(...ys), hi=Math.max(...ys), r=(hi-lo)||1;
  const X=i=>2+i*(w-4)/(points.length-1), Y=v=>hh-4-(v-lo)*(hh-8)/r;
  const d=points.map((p,i)=>`${i?'L':'M'}${X(i).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ');
  const up=ys[ys.length-1]>=ys[0];
  return `<svg class="chart" viewBox="0 0 ${w} ${hh}" style="width:${w}px;height:${hh}px"><path class="${up?'up':'dn'}" d="${d}"/></svg>`;
}

// ---------- Modal ----------
export function openModal(innerHtml){
  const root=document.getElementById('modal-root');
  root.innerHTML=`<div class="modal"><button class="close-x" aria-label="Cerrar">✕</button>${innerHtml}</div>`;
  root.classList.remove('hidden');
  const close=()=>{root.classList.add('hidden');root.innerHTML='';};
  root.onclick=e=>{ if(e.target===root||e.target.closest('.close-x')) close(); };
  document.addEventListener('keydown',function esc(e){ if(e.key==='Escape'){close();document.removeEventListener('keydown',esc);} });
  root.querySelector('.modal').focus?.();
  return { close, root };
}
