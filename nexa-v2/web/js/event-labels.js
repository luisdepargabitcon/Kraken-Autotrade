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
};
export function describeEvent(r){
  const code = String(r?.type||r?.kind||r?.reason||'');
  if(LABELS[code]) return LABELS[code];
  const human = r?.naturalMessage||r?.message||r?.msg||r?.text;
  if(human && String(human).length>3) return String(human);
  return code ? code.replace(/_/g,' ') : 'Evento del bot';
}
export function eventCode(r){ return String(r?.type||r?.kind||r?.reason||'')||null; }
