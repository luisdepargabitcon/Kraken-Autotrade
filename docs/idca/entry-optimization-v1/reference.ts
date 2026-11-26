// Reference implementation for isolated replay; not wired into production.
// Candles must be validated, closed, chronological and available at decision time.
export type Candle = {open:number; high:number; low:number; close:number};
export function evaluateRebound(candles: readonly Candle[], price:number, localLow:number, minPct:number) {
  const valid=(c:Candle)=>[c.open,c.high,c.low,c.close].every(x=>Number.isFinite(x)&&x>0)&&c.high>=Math.max(c.open,c.close)&&c.low<=Math.min(c.open,c.close);
  if(candles.length<2 || !candles.every(valid) || !Number.isFinite(price)||price<=0||!Number.isFinite(localLow)||localLow<=0||!Number.isFinite(minPct)||minPct<0) return {confirmed:false,reason:"invalid_data"};
  const a=candles[candles.length-1], b=candles[candles.length-2], c=candles[candles.length-3];
  const range=a.high-a.low;
  const wick=range>0&&(Math.min(a.open,a.close)-a.low)/range>0.4;
  const bounce=(price-localLow)/localLow*100;
  const recovery=bounce>minPct&&a.close>b.close;
  const priorDrop=c?c.close-b.close:0;
  const slowing=!!c&&priorDrop>0&&a.close>=b.close&&Math.abs(a.close-b.close)<priorDrop*0.5;
  return {confirmed:wick||recovery||slowing,wick,recovery,slowing,bounce,reason:"evaluated"};
}
export type Decision="NO_ENTRY"|"WATCH"|"ARM_TRAILING"|"NORMAL_ENTRY"|"HIGH_CONFIDENCE_ENTRY"|"DEFENSIVE_SAFETY_BUY";
export function permitsEntry(decision:Decision, safety:boolean, defensiveApproved:boolean):boolean {
  return decision==="NORMAL_ENTRY"||decision==="HIGH_CONFIDENCE_ENTRY"||(safety&&defensiveApproved&&decision==="DEFENSIVE_SAFETY_BUY");
}
// This gate is necessary, never sufficient: existing risk, exposure, price,
// execution, freshness, mode and idempotency guards remain mandatory.
