// Indicadores calculados LOCALMENTE sobre velas que entrega la API autenticada
// del bot (Market Data del servidor). NUNCA se consulta ninguna API externa
// desde la app: la ruta directa a Kraken fue eliminada (TANGO 10.4) — el WebView
// no debe emitir peticiones fuera del bot. computeIndicators es matemática pura
// sin red ni estado; la procedencia de las velas la etiqueta el proveedor.
export const TIMEFRAMES = [ {id:'1',label:'1m'}, {id:'5',label:'5m'}, {id:'15',label:'15m'},
  {id:'60',label:'1h'}, {id:'240',label:'4h'}, {id:'1440',label:'1d'} ];

// ---------- Indicadores calculados sobre velas REALES (misma fuente, etiquetados) ----------
const ema=(vals,p)=>{ if(vals.length<p)return null; const k=2/(p+1); let e=vals.slice(0,p).reduce((a,b)=>a+b,0)/p;
  for(let i=p;i<vals.length;i++)e=vals[i]*k+e*(1-k); return e; };
export function computeIndicators(candles){
  if(!Array.isArray(candles)||candles.length<30)return null;
  const cl=candles.map(c=>c.c), n=cl.length, vol=candles.map(c=>c.v||0);
  const out={ema:{ema20:ema(cl,20),ema50:ema(cl,50),ema200:ema(cl,200)}};
  // RSI 14 (Wilder)
  if(n>15){let g=0,l=0;for(let i=1;i<=14;i++){const d=cl[i]-cl[i-1];d>0?g+=d:l-=d;}
    let ag=g/14,al=l/14;for(let i=15;i<n;i++){const d=cl[i]-cl[i-1];ag=(ag*13+Math.max(d,0))/14;al=(al*13+Math.max(-d,0))/14;}
    out.rsi=al===0?100:100-100/(1+ag/al);}
  // MACD 12/26/9
  if(n>26){const s=[];const k12=2/13,k26=2/27;let e12=ema(cl,12),e26=ema(cl,26);
    for(let i=26;i<n;i++){e12=cl[i]*k12+e12*(1-k12);e26=cl[i]*k26+e26*(1-k26);s.push(e12-e26);}
    const macdLine=s[s.length-1],sig=ema(s.slice(-9),9)||s[s.length-1];
    out.macd={macd:macdLine,signal:sig,histogram:macdLine-sig};}
  // ATR 14 + ATRP
  if(n>15){const tr=[];for(let i=1;i<n;i++){const h=candles[i].h,l=candles[i].l,pc=candles[i-1].c;
    tr.push(Math.max(h-l,Math.abs(h-pc),Math.abs(l-pc)));}
    const atr=ema(tr,14);out.atr=atr;out.atrpPct=atr&&cl[n-1]?atr/cl[n-1]*100:null;}
  // ADX 14 (simplificado Wilder)
  if(n>29){let pdm=0,ndm=0,atrS=0;const dx=[];
    for(let i=1;i<n;i++){const up=candles[i].h-candles[i-1].h,dn=candles[i-1].l-candles[i].l;
      pdm=up>dn&&up>0?up:0;ndm=dn>up&&dn>0?dn:0;
      const tr=Math.max(candles[i].h-candles[i].l,Math.abs(candles[i].h-candles[i-1].c),Math.abs(candles[i].l-candles[i-1].c));
      atrS+=tr;const di=atrS?(Math.abs(pdm-ndm)/(pdm+ndm||1))*100:0;if(i>=15)dx.push(di);}
    out.adx=dx.length?dx.reduce((a,b)=>a+b,0)/dx.length:null;}
  // Bollinger 20,2
  if(n>=20){const s=cl.slice(-20),m=s.reduce((a,b)=>a+b,0)/20;
    const sd=Math.sqrt(s.reduce((a,b)=>a+(b-m)**2,0)/20);
    out.bollinger={mid:m,upper:m+2*sd,lower:m-2*sd};}
  out.volume={last:vol[n-1]||null,avg24:vol.slice(-24).reduce((a,b)=>a+b,0)/Math.min(24,vol.length)};
  out.source='bot-market-data-calc';
  return out;
}
