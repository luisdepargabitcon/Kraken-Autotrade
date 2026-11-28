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

// Traducción de códigos técnicos de estado/decisión a castellano natural.
// El código original solo debe verse en detalle Pro; el texto principal usa esto.
const STATE_ES={
  watching:'Vigilando el mercado', watch:'Vigilar', idle:'En espera',
  armed:'Preparado', triggered:'Activado', blocked:'Bloqueado',
  cooldown:'En pausa de seguridad', active:'Activo', paused:'En pausa',
  neutral_range:'Rango neutro', capitulation:'Capitulación', capitulacion:'Capitulación',
  accumulation:'Acumulación', distribution:'Distribución', trend_up:'Tendencia alcista',
  trend_down:'Tendencia bajista', bullish:'Alcista', bearish:'Bajista', ranging:'En rango',
  low_volume:'volumen insuficiente', spread_too_wide:'diferencial excesivo',
  min_notional:'importe mínimo no alcanzado', insufficient_balance:'saldo insuficiente',
  high_volatility:'volatilidad elevada', stale_data:'datos desactualizados',
  pending_confirmation:'confirmación pendiente', waiting_rebound:'esperando rebote',
  hard_blocked:'bloqueo de seguridad', rate_limited:'límite de peticiones',
  // Estados que emite entry-diagnostics / trailingBuy del bot (códigos crudos).
  arm_trailing:'Armado · esperando rebote de confirmación',
  inactive:'Inactivo', neutral:'Neutro', tracking:'Siguiendo el mercado',
  confirmed:'Confirmado', vwap_anchor:'Referencia VWAP',
  capitulation:'Capitulación', capitulacion:'Capitulación',
  // Clases de decisión IDCA (decisionClass / entryDecision).
  wait_pullback:'En espera de retroceso', no_entry:'Sin entrada',
  normal_entry:'Entrada normal', high_confidence_entry:'Entrada de alta confianza',
  defensive_safety_buy:'Compra defensiva de seguridad',
};
export function translateCode(code){
  if(code===null||code===undefined||code==='')return null;
  const s=String(code);
  if(STATE_ES[s])return STATE_ES[s];
  if(STATE_ES[s.toLowerCase()])return STATE_ES[s.toLowerCase()];
  return s.replace(/_/g,' ');
}
