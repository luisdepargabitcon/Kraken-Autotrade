// NEXA display scope — LIVE vs SHADOW (presentation only, never sends trading actions).
// Never infer a LIVE position from an unknown mode or from a capital reservation.
export const SCOPE_REAL='real';
export const SCOPE_SHADOW='shadow';
const LIVE=new Set(['live','real','real_limited','real_full','production','prod']);
const SHADOW=new Set(['simulation','sim','shadow','dry_run','dryrun','lab','replay','shadow_scenario','shadow_live','observing','paper']);
const canonical=v=>String(v??'').trim().toLowerCase().replace(/[\s-]+/g,'_');
export function classifyMode(record,fallback=null){
  if(record===null||record===undefined)return 'unknown';
  if(typeof record==='string'){
    const s=canonical(record);
    return LIVE.has(s)?SCOPE_REAL:SHADOW.has(s)?SCOPE_SHADOW:'unknown';
  }
  if(typeof record!=='object')return 'unknown';
  const own=['mode','executionMode','tradingMode','environment','runtimeMode','effectiveMode','executionPolicy','engineMode'];
  // Explicit per-record flag takes precedence over engine defaults.
  for(const k of own){
    const v=record[k];
    if(v===null||v===undefined||v==='')continue;
    const s=classifyMode(String(v));
    if(s!=='unknown')return s;
  }
  if(record.dryRun===true||record.dryRunMode===true||record.isSimulation===true||record.isShadow===true)return SCOPE_SHADOW;
  if(record.dryRun===false||record.dryRunMode===false||record.isLive===true)return SCOPE_REAL;
  if(record.isLive===false)return SCOPE_SHADOW;
  if(fallback!==null)return classifyMode(fallback);
  return 'unknown';
}
export function inScope(record,scope,fallback=null){
  return (scope===SCOPE_SHADOW?SCOPE_SHADOW:SCOPE_REAL)===classifyMode(record,fallback);
}
export function partitionByScope(items,scope,getFallback=()=>null){
  const all=Array.isArray(items)?items:[];
  return {visible:all.filter(x=>inScope(x,scope,getFallback(x))),
    other:all.filter(x=>classifyMode(x,getFallback(x))!==scope&&classifyMode(x,getFallback(x))!=='unknown').length,
    unknown:all.filter(x=>classifyMode(x,getFallback(x))==='unknown').length};
}
export function scopeTitle(scope){return scope===SCOPE_SHADOW?'SHADOW · Simulación':'REAL · Operativa';}
export function scopeSubtitle(scope){return scope===SCOPE_SHADOW?
  'Solo simulaciones, dry-run y shadow. No se mezclan saldos ni órdenes LIVE.':
  'Solo operativa LIVE verificada. El presupuesto interno no es saldo del exchange.';}
