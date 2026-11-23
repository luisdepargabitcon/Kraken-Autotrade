// Clasificación y traducción de eventos técnicos (Rev24).
// El código técnico original solo se muestra en detalle Pro (inspector).
const EXECUTED = /(filled|executed|closed|confirmed|settled|completed|collected)/i;
const REJECTED = /(rejected|cancelled|canceled|failed|skipped|vetoed|refused|denied|blocked|expired)/i;
const DECISION = /(decision|signal|evaluat|decide|mandate|veto_check|planned|analysis)/i;
const ERROR = /(error|exception|panic|crash|fatal)/i;
const PENDING = /(planned|pending|reserved|scheduled|queued|waiting)/i;

export function eventCategory(r){
  const t = String(r?.type||r?.kind||r?.status||r?.state||r?.reason||'');
  const sev = String(r?.severity||r?.level||'');
  if(ERROR.test(t)||ERROR.test(sev)) return {id:'error',label:'ERROR'};
  if(REJECTED.test(t)||REJECTED.test(r?.result||'')||r?.ok===false) return {id:'rejected',label:'RECHAZADA'};
  if(EXECUTED.test(t)) return {id:'executed',label:'OPERACIÓN'};
  if(DECISION.test(t)) return {id:'decision',label:'DECISIÓN'};
  if(PENDING.test(t)) return {id:'pending',label:'PLANIFICADA'};
  return {id:'technical',label:'EVENTO'};
}

// Agrupa eventos periódicos idénticos consecutivos (mismo tipo+motor+par) en
// "… ×N" sin ocultar ninguno: el detalle completo sigue en la ficha Pro.
export function dedupeEvents(list){
  if(!Array.isArray(list))return list;
  const out=[];
  for(const e of list){
    const prev=out[out.length-1];
    const key=[e.type||e.kind||e.reason||'',e.engine||'',e.pair||e.symbol||''].join('|');
    if(prev&&prev._k===key){prev._n=(prev._n||1)+1;continue;}
    out.push({...e,_k:key,_n:1});
  }
  return out;
}

// Traducciones de códigos conocidos (GRID, IDCA, AMA). Fallback honesto.
const LABELS = {
  buy_filled:'Compra ejecutada en nivel de la rejilla',
  sell_filled:'Venta ejecutada en nivel de la rejilla',
  level_placed:'Orden colocada en un nivel de la rejilla',
  level_cancelled:'Orden de nivel cancelada',
  range_version:'Nueva versión del rango de la rejilla',
  cycle_opened:'Ciclo de rejilla abierto (compra confirmada)',
  cycle_closed:'Ciclo de rejilla cerrado (venta confirmada)',
  cycle_resolved:'Ciclo resuelto',
  order_rejected:'Orden rechazada por el exchange',
  insufficient_funds:'Orden rechazada: fondos insuficientes',
  pair_blocked:'Par bloqueado por política del bot',
  monitor_tick:'Revisión periódica del monitor',
  guard_block:'Bloqueo del guardián de seguridad',
  entry_rejected:'Entrada rechazada por el motor',
  dip_detected:'Caída detectada: evaluación de entrada',
  trailing_exit:'Salida trailing ejecutada',
  breakeven_exit:'Salida en punto de equilibrio',
  fail_safe:'Salida de protección (fail-safe)',
  trailing_exit_dust_adj:'Ajuste de polvo en salida trailing',
  manual_buy:'Compra manual registrada',
  decision_evaluated:'Decisión del motor evaluada',
  mandate_updated:'Mandato AMA actualizado',
  // Códigos GRID_* emitidos por el monitor (mayúsculas, telemetría por minuto)
  GRID_LEVEL_POST_ONLY_REJECTED:'Orden post-only rechazada: el nivel se mantiene en modo maker (sin fallback taker)',
  GRID_CYCLES_RECOVERED:'Ciclos de rejilla recuperados al arrancar el monitor',
  GRID_SHADOW_EXECUTION_PRICE:'Precio de ejecución simulado recalculado (solo shadow)',
  GRID_MONITOR_TICK:'Revisión periódica del monitor de rejilla',
  GRID_RANGE_VERSION:'Nueva versión del rango de la rejilla',
  GRID_BUY_PLACED:'Orden de compra maker colocada en nivel',
  GRID_SELL_PLACED:'Orden de venta maker colocada en nivel',
  GRID_LEVEL_FILLED:'Nivel ejecutado (orden maker confirmada)',
};
export function describeEvent(r){
  const code = String(r?.type||r?.kind||r?.reason||'');
  if(LABELS[code]) return LABELS[code];
  const human = r?.naturalMessage||r?.message||r?.msg||r?.text;
  if(human && String(human).length>3) return String(human);
  return code ? code.replace(/_/g,' ') : 'Evento del bot';
}
export function eventCode(r){ return String(r?.type||r?.kind||r?.reason||'')||null; }
