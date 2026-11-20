// NEXA V2 — utilidades de formato y frescura. Sin dependencias.
export const NA = 'No disponible';
export const DEMO_TAG = 'DEMO';

export function isNum(v){ return typeof v === 'number' && Number.isFinite(v); }

export function fmtNum(v, {dec=2, unit='', prefix=''}={}){
  if(!isNum(v)) return NA;
  const s = v.toLocaleString('es-ES',{minimumFractionDigits:dec, maximumFractionDigits:dec});
  return `${prefix}${s}${unit?' '+unit:''}`;
}
export function fmtUsd(v, dec=2){ return isNum(v)? (v<0?'−':'')+fmtNum(Math.abs(v),{dec,prefix:'$'}) : NA; }
export function fmtPct(v, dec=2){ return isNum(v)? fmtNum(v,{dec})+' %' : NA; }
export function signedUsd(v, dec=2){ return isNum(v)? (v>=0?'+':'−')+fmtNum(Math.abs(v),{dec,prefix:'$'}) : NA; }
export function signedPct(v, dec=2){ return isNum(v)? (v>=0?'+':'−')+fmtNum(Math.abs(v),{dec})+' %' : NA; }
export function fmtQty(v, sym, dec=8){
  if(!isNum(v)) return NA;
  const max = Math.abs(v)>=1 ? 6 : dec;
  return `${v.toLocaleString('es-ES',{maximumFractionDigits:max})}${sym?' '+sym:''}`;
}

// Fechas y edad
export function fmtTs(ts, {withSec=false}={}){
  if(!ts) return NA;
  const d = ts instanceof Date ? ts : new Date(ts);
  if(isNaN(d)) return NA;
  const opt = {day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit', hour12:false};
  if(withSec) opt.second='2-digit';
  return d.toLocaleString('es-ES', opt);
}
export function ageSec(ts){
  if(!ts) return null;
  const d = ts instanceof Date ? ts : new Date(ts);
  if(isNaN(d)) return null;
  return Math.max(0, Math.round((Date.now()-d.getTime())/1000));
}
export function fmtAge(ts){
  const s = ageSec(ts);
  if(s===null) return 'edad '+NA.toLowerCase();
  if(s<60) return `hace ${s} s`;
  if(s<3600) return `hace ${Math.floor(s/60)} min`;
  if(s<86400) return `hace ${Math.floor(s/3600)} h ${Math.floor((s%3600)/60)} min`;
  return `hace ${Math.floor(s/86400)} d`;
}
// estado de frescura: fresh | stale | unknown
export function freshness(ts, {freshSec=120, staleSec=900}={}){
  const s = ageSec(ts);
  if(s===null) return 'unknown';
  return s<=freshSec ? 'fresh' : (s<=staleSec ? 'stale' : 'old');
}
export function duration(a, b){
  if(!a) return NA;
  const d0 = new Date(a), d1 = b? new Date(b) : new Date();
  if(isNaN(d0)||isNaN(d1)) return NA;
  let s = Math.max(0, Math.round((d1-d0)/1000));
  const dd = Math.floor(s/86400); s%=86400;
  const hh = Math.floor(s/3600); s%=3600;
  const mm = Math.floor(s/60);
  if(dd>0) return `${dd}d ${hh}h`;
  if(hh>0) return `${hh}h ${mm}m`;
  return `${mm}m`;
}

export function esc(s){
  return String(s??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
export function cls(...xs){ return xs.filter(Boolean).join(' '); }

// Normalizador de "data with provenance": {value, source, ts, state}
export function provenance(raw, {source='', ts=null, state=null, staleSec=900, freshSec=120}={}){
  const st = state ?? (raw===null||raw===undefined ? 'unavailable' : freshness(ts,{freshSec,staleSec}));
  return { value: raw, source, ts, state: st };
}
export function provText(p){
  const parts=[];
  if(p.source) parts.push(`origen: ${p.source}`);
  if(p.ts) parts.push(fmtAge(p.ts));
  if(p.state && p.state!=='fresh') parts.push(p.state==='unavailable'?'sin datos':p.state);
  return parts.join(' · ');
}
