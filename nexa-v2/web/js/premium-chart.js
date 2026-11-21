// NEXA premium chart — real OHLCV, responsive SVG, tap/hover inspection.
// No trading engine calculations; no network, no fabricated indicators.
import {esc,fmtUsd} from './util.js';

const fin=v=>typeof v==='number'&&Number.isFinite(v);
const fmt=v=>fin(v)?fmtUsd(v):'—';
const decimal=(v,d=0)=>fin(v)?v.toLocaleString('es-ES',{maximumFractionDigits:d}):'—';
const clip=(v,a,b)=>Math.max(a,Math.min(b,v));

export function ohlcvChart(raw,{levels=[],height=315,label='Velas 15m'}={}){
 if(!Array.isArray(raw))return '';
 const cs=raw.filter(c=>[c.o,c.h,c.l,c.c].every(fin)&&c.h>=c.l).slice(-90);
 if(cs.length<2)return '';
 const W=720,H=height,left=12,right=65,top=15,volHeight=55,bottom=24;
 const chartBottom=H-bottom-volHeight,volumeBase=H-bottom;
 const priceLow=Math.min(...cs.map(x=>x.l));
 const priceHigh=Math.max(...cs.map(x=>x.h));
 const padding=(priceHigh-priceLow)*0.07||1;
 const lo=priceLow-padding,hi=priceHigh+padding;
 const plotW=W-left-right;const step=plotW/cs.length;
 const y=v=>top+(hi-v)/(hi-lo)*(chartBottom-top);
 const x=i=>left+(i+0.5)*step;
 const maxVol=Math.max(0,...cs.map(c=>fin(c.v)?c.v:0));
 const grid=[0,1,2,3,4].map(i=>{
  const value=lo+i*(hi-lo)/4;const yy=y(value).toFixed(2);
  return '<line x1="'+left+'" y1="'+yy+'" x2="'+(W-right+5)+'" y2="'+yy+'" stroke="#253d56" stroke-dasharray="3 7"/>'+
   '<text x="'+(W-right+10)+'" y="'+(Number(yy)+4)+'" fill="#86a4c9" font-size="11">'+esc(decimal(value,0))+'</text>';
 }).join('');
 const shapes=cs.map((c,i)=>{
  const xx=x(i),up=c.c>=c.o,color=up?'#4cdaa9':'#f17386';
  const yO=y(c.o),yC=y(c.c),yH=y(c.h),yL=y(c.l);
  const bx=(xx-Math.max(1.5,step*.3)).toFixed(2),
    bw=Math.max(2,step*.6).toFixed(2),by=Math.min(yO,yC).toFixed(2),bh=Math.max(1.5,Math.abs(yO-yC)).toFixed(2);
  const vbar=maxVol&&fin(c.v)?'<rect x="'+(xx-Math.max(1.5,step*.25)).toFixed(2)+'" y="'+(volumeBase-c.v/maxVol*(volHeight-9)).toFixed(2)+'" width="'+Math.max(2,step*.5).toFixed(2)+'" height="'+Math.max(1,c.v/maxVol*(volHeight-9)).toFixed(2)+'" fill="'+color+'" opacity=".33"/>':'';
  const t=c.t==null?'Vela '+(i+1):String(c.t);
  const tip=t+' · Apertura '+fmt(c.o)+' · Máximo '+fmt(c.h)+' · Mínimo '+fmt(c.l)+' · Cierre '+fmt(c.c)+(fin(c.v)?' · Volumen '+decimal(c.v,2):'');
  return '<g tabindex="0" class="nxp-candle-hit" data-candle-tip="'+esc(tip)+'" aria-label="'+esc(tip)+'" role="img">'+
   '<line x1="'+xx.toFixed(2)+'" y1="'+yH.toFixed(2)+'" x2="'+xx.toFixed(2)+'" y2="'+yL.toFixed(2)+'" stroke="'+color+'" stroke-width="'+Math.max(1,Math.min(2.2,step*.16)).toFixed(2)+'"/>'+
   '<rect x="'+bx+'" y="'+by+'" width="'+bw+'" height="'+bh+'" rx=".7" fill="'+color+'"/>'+
   vbar+'<rect x="'+(xx-step/2).toFixed(2)+'" y="'+top+'" width="'+step.toFixed(2)+'" height="'+(H-top-bottom)+'" fill="transparent"/></g>';
 }).join('');
 const lines=(Array.isArray(levels)?levels:[]).filter(l=>fin(l.price)&&l.price>=lo&&l.price<=hi).map(l=>{
  const yy=y(l.price).toFixed(2),old=!!l.old,color=old?'#e7bb77':'#7caeff';
  return '<line x1="'+left+'" y1="'+yy+'" x2="'+(W-right)+'" y2="'+yy+'" stroke="'+color+'" stroke-dasharray="6 4" opacity=".8"/>'+
   '<text x="'+(W-right-4)+'" y="'+(Number(yy)-4)+'" text-anchor="end" font-size="9" fill="'+color+'">'+esc(l.label||decimal(l.price,0))+'</text>';
 }).join('');
 const last=cs.at(-1),lastY=y(last.c);
 const recent=Number(lastY).toFixed(2);
 const lastTag='<rect x="'+(W-right+4)+'" y="'+(lastY-10).toFixed(2)+'" width="'+(right-5)+'" height="20" rx="6" fill="#26538e"/>'+
 '<text x="'+(W-right+right/2)+'" y="'+(lastY+4).toFixed(2)+'" text-anchor="middle" font-size="10" font-weight="700" fill="#fff">'+esc(decimal(last.c,0))+'</text>';
 return '<div class="nxp-chart-interactive" role="group" aria-label="'+esc(label)+'" data-nxp-chart>'+
  '<svg class="nxp-ohclv" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+esc(label)+'">'+
  '<rect width="'+W+'" height="'+H+'" fill="#0b1728" rx="10"/>'+
  grid+'<path d="M'+left+' '+chartBottom+'H'+(W-right)+'" stroke="#2a4767" stroke-width="1"/>'+
  lines+shapes+lastTag+
  '<text x="'+left+'" y="'+(H-5)+'" font-size="10" fill="#819ec4">VOL · '+(maxVol?'barras de volumen':'volumen no facilitado')+'</text></svg>'+
  '<div class="nxp-chart-tooltip" aria-live="polite" hidden></div></div>';
}
