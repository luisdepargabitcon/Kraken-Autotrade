export const INDICATOR_LIB_VERSION='1.0.0';
export const INDICATOR_VERSIONS={ema:'ema/sma-seed/1',emaStrict:'emaStrict/warmup2/1',rsiWilder:'rsi/wilder/1',atr:'atr/sma+wilder/1',macd:'macd/12-26-9-full-series/1',bollinger:'bollinger/population/1',vwap:'vwap/anchored+period/1'} as const;
export type RsiFlatPolicy='neutral50'|'unreliable'|'legacy100';
const bad=(reason:string)=>({reason});
function nums(v:number[]){return v.filter(Number.isFinite)}
export function ema(values:number[],period:number):(number|null)[]{
 if(!Number.isInteger(period)||period<1)throw new Error('invalid_period'); const v=nums(values); if(v.length<period)return v.map(()=>null);
 const k=2/(period+1),out:(number|null)[]=new Array(period-1).fill(null); let e=v.slice(0,period).reduce((a,b)=>a+b,0)/period; out.push(e);
 for(let i=period;i<v.length;i++){e=v[i]*k+e*(1-k);out.push(e)} return out;
}
export function emaStrict(values:number[],period:number,opts:{warmupFactor?:number}={}){
 const need=period*(opts.warmupFactor??2),v=nums(values); if(v.length<need)return{available:false as const,reason:'insufficient_history' as const,have:v.length,need};
 const k=2/(period+1),seed=v.slice(0,period).reduce((a,b)=>a+b,0)/period,series:number[]=new Array(period-1).fill(NaN);series.push(seed);
 for(let i=period;i<v.length;i++)series.push(v[i]*k+series[i-1]*(1-k));return{available:true as const,series,warmup:need};
}
export function rsiWilder(closes:number[],period=14,opts:{flatPolicy?:RsiFlatPolicy}={}){
 const p=opts.flatPolicy??'unreliable',v=nums(closes); if(v.length<period+1)return{value:50,reliable:false,reason:'insufficient_history'};
 let g=0,l=0;for(let i=1;i<=period;i++){const d=v[i]-v[i-1];if(d>0)g+=d;else l+=-d}let ag=g/period,al=l/period;
 for(let i=period+1;i<v.length;i++){const d=v[i]-v[i-1];ag=(ag*(period-1)+Math.max(d,0))/period;al=(al*(period-1)+Math.max(-d,0))/period}
 if(al===0&&ag===0){if(p==='legacy100')return{value:100,reliable:true,reason:'flat_legacy'};if(p==='neutral50')return{value:50,reliable:true,reason:'flat_neutral'};return{value:50,reliable:false,reason:'flat_series'}}
 if(al===0)return{value:100,reliable:true,reason:'no_losses'};const rs=ag/al;return{value:100-100/(1+rs),reliable:true,reason:'ok'};
}
export type AtrCandle={high:number;low:number;close:number};
export function atr(candles:AtrCandle[],period=14,opts:{method:'sma'|'wilder'}){
 const c=candles.filter(x=>[x.high,x.low,x.close].every(Number.isFinite));if(c.length<period+1)return{value:null,reliable:false,reason:'insufficient_history'};
 const tr:number[]=[];for(let i=1;i<c.length;i++)tr.push(Math.max(c[i].high-c[i].low,Math.abs(c[i].high-c[i-1].close),Math.abs(c[i].low-c[i-1].close)));
 if(opts.method==='sma'){const s=tr.slice(-period);return{value:s.reduce((a,b)=>a+b,0)/s.length,reliable:true,reason:'ok_sma'}}
 let a=tr.slice(0,period).reduce((x,y)=>x+y,0)/period;for(let i=period;i<tr.length;i++)a=(a*(period-1)+tr[i])/period;return{value:a,reliable:true,reason:'ok_wilder'};
}
export function macd(closes:number[],o:{fast?:number;slow?:number;signal?:number}={}){
 const f=o.fast??12,s=o.slow??26,sig=o.signal??9,v=nums(closes),ef=ema(v,f),es=ema(v,s),line:(number|null)[]=v.map((_,i)=>ef[i]!=null&&es[i]!=null?ef[i]!-es[i]!:null);
 const vals=line.filter((x):x is number=>x!=null),sigVals=ema(vals,sig);const signal:(number|null)[]=line.map(x=>x==null?null:null);let j=0;for(let i=0;i<line.length;i++)if(line[i]!=null)signal[i]=sigVals[j++]??null;
 return{line,signal,histogram:line.map((x,i)=>x==null||signal[i]==null?null:x-signal[i]!)};
}
export function bollinger(closes:number[],period=20,k=2){
 const v=nums(closes),middle:(number|null)[]=[],upper:(number|null)[]=[],lower:(number|null)[]=[],percentB:(number|null)[]=[],reasons:(string|null)[]=[];
 for(let i=0;i<v.length;i++){if(i+1<period){middle.push(null);upper.push(null);lower.push(null);percentB.push(null);reasons.push('insufficient_history');continue}
 const w=v.slice(i+1-period,i+1),m=w.reduce((a,b)=>a+b,0)/period,sd=Math.sqrt(w.reduce((a,b)=>a+(b-m)**2,0)/period),u=m+k*sd,l=m-k*sd;middle.push(m);upper.push(u);lower.push(l);if(u===l){percentB.push(null);reasons.push('flat_band')}else{percentB.push((v[i]-l)/(u-l));reasons.push(null)}}
 return{middle,upper,lower,percentB,reasons};
}
export type VwapCandle={high:number;low:number;close:number;volume?:number;time:number};
export function vwapAnchored(candles:VwapCandle[],opts:{anchorTime:number;clockNowMs:number}){
 let pv=0,vol=0,ignored=0,used=0;for(const c of candles){if(c.time<opts.anchorTime||c.time>opts.clockNowMs)continue;if(!Number.isFinite(c.volume)||c.volume!<=0){ignored++;continue}const tp=(c.high+c.low+c.close)/3;if(![tp,c.volume].every(Number.isFinite)){ignored++;continue}pv+=tp*c.volume!;vol+=c.volume!;used++}
 return{vwap:vol>0?pv/vol:null,candlesUsed:used,ignoredVolumeCount:ignored,volume:vol,reason:vol>0?'ok':'no_valid_volume'};
}
function periodStart(nowMs:number,p:'day'|'week'|'month'){const d=new Date(nowMs);if(p==='day')return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate());if(p==='month')return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1);const day=(d.getUTCDay()+6)%7;return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-day)}
export function vwapPeriod(candles:VwapCandle[],opts:{period:'day'|'week'|'month';nowMs:number;bands?:boolean}){
 const start=periodStart(opts.nowMs,opts.period),r=vwapAnchored(candles,{anchorTime:start,clockNowMs:opts.nowMs});let sigma:null|number=null,upper:null|number=null,lower:null|number=null;
 if(opts.bands&&r.vwap!=null){let pv2=0,n=0;for(const c of candles){if(c.time<start||c.time>opts.nowMs||!Number.isFinite(c.volume)||c.volume!<=0)continue;const tp=(c.high+c.low+c.close)/3;pv2+=(tp-r.vwap)**2*c.volume!;n+=c.volume!}sigma=n>0?Math.sqrt(pv2/n):null;if(sigma!=null){upper=r.vwap+sigma;lower=r.vwap-sigma}}
 return{...r,anchorTime:start,sigma,upper,lower};
}
