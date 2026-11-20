// NEXA V2 — acciones de gestión auténticas.
// Cada acción: permiso requerido, confirmación, método+ruta REAL del bot,
// idempotencia y auditoría. El servidor es quien autoriza de verdad; el
// cliente solo prepara, confirma y muestra el resultado honesto.
import { CONFIG } from './config.js';
import { session } from './auth.js';
import { esc } from './util.js';

export const ACTIONS = {
  'idca.pauseGlobal':    { engine:'idca', perm:'idca:control', confirm:'¿Pausar el trading global IDCA?', danger:true,
                           req:(p)=>['POST','/institutional-dca/controls',{globalTradingPause:!!p.pause}] },
  'idca.emergencyClose': { engine:'idca', perm:'idca:emergency', confirm:'CIERRE DE EMERGENCIA: cerrará posiciones IDCA abiertas. Confirmar.', danger:true, doubleConfirm:true,
                           req:()=>['POST','/institutional-dca/emergency/close-all',{}] },
  'idca.closeCycle':     { engine:'idca', perm:'idca:control', confirm:p=>`¿Cerrar manualmente el ciclo ${p.cycleId}?`, danger:true,
                           req:(p)=>['POST',`/institutional-dca/cycles/${encodeURIComponent(p.cycleId)}/close-manual`,{}] },
  'idca.manualBuy':      { engine:'idca', perm:'idca:control', confirm:p=>`¿Añadir compra manual al ciclo ${p.cycleId}?`,
                           req:(p)=>['POST',`/institutional-dca/cycles/${encodeURIComponent(p.cycleId)}/manual-buy`,{amount:p.amount??null}] },
  'idca.togglePair':     { engine:'idca', perm:'idca:control', confirm:p=>`¿${p.enabled?'Activar':'Desactivar'} el par ${p.pair}?`,
                           req:(p)=>['POST',`/institutional-dca/asset-configs/${encodeURIComponent(p.pair)}`,{enabled:!!p.enabled}] },
  'grid.setMode':        { engine:'grid', perm:'grid:control', confirm:p=>`¿Cambiar modo Grid aislado a ${p.mode}?`, danger:p=>['REAL_FULL','REAL_LIMITED'].includes(p?.mode),
                           req:(p)=>['POST','/grid-isolated/mode',{mode:p.mode}] },
  'grid.reconcile':      { engine:'grid', perm:'grid:control', confirm:'¿Ejecutar reconciliación de Grid?',
                           req:()=>['POST','/grid-isolated/reconcile',{}] },
  'ama.killSwitch':      { engine:'ama', perm:'ama:control', confirm:'KILL SWITCH AMA: detiene la acumulación. Confirmar.', danger:true, doubleConfirm:true,
                           req:()=>['POST','/ama/kill-switch',{}] },
  'ama.analyzeNow':      { engine:'ama', perm:'ama:control', confirm:'¿Lanzar análisis AMA ahora?',
                           req:()=>['POST','/ama/analyze-now',{}] },
  'spot.closePosition':  { engine:'spot', perm:'spot:control', confirm:p=>`¿Cerrar posición ${p.pair}?`, danger:true,
                           req:(p)=>['POST',`/positions/${encodeURIComponent(p.pair)}/close`,{}] },
};

export function canDo(actionId){
  const a = ACTIONS[actionId];
  return !!a && session.hasPerm(a.perm);
}

export function confirmText(actionId, params){
  const a = ACTIONS[actionId];
  const c = a?.confirm;
  return typeof c==='function' ? c(params) : (c||'Confirmar acción');
}
export function isDanger(actionId, params){
  const a = ACTIONS[actionId];
  const d = a?.danger;
  return typeof d==='function' ? d(params) : !!d;
}
export function needsDouble(actionId){ return !!ACTIONS[actionId]?.doubleConfirm; }

let idemSeed = 0;
function idemKey(){
  return `nxv2-${Date.now().toString(36)}-${(++idemSeed).toString(36)}-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;
}

// Ejecuta la acción tras la confirmación UI. Devuelve resultado honesto.
export async function runAction(actionId, params={}){
  const a = ACTIONS[actionId];
  if(!a) return { ok:false, error:'unknown_action' };
  if(!session.get()) return { ok:false, error:'auth_required' };
  if(!canDo(actionId)) return { ok:false, error:'forbidden', perm:a.perm };
  const [method, path, body] = a.req(params);
  const s = session.get();
  const t0 = Date.now();
  try{
    const res = await fetch(CONFIG.apiBase + path, {
      method,
      headers: {
        'Accept':'application/json','Content-Type':'application/json',
        'Authorization':`Bearer ${s.token}`,
        'X-Idempotency-Key': idemKey(),
        ...(s.csrf ? {'X-CSRF-Token': s.csrf} : {}),
      },
      body: JSON.stringify({...body, __action:actionId}),
    });
    let data=null; try{ data=await res.json(); }catch{}
    return { ok:res.ok, status:res.status, data, latency:Date.now()-t0,
             error: res.ok?null:(data?.error||`http_${res.status}`) };
  }catch(e){
    return { ok:false, error:'unreachable', detail:String(e?.message||e) };
  }
}

// Render: botón de acción (disabled honesto si falta sesión/permiso).
export function actionBtn(actionId, params, label, {cls='btn'}={}){
  const allowed = session.get() && canDo(actionId);
  const title = !session.get() ? 'Requiere sesión' : (!allowed ? `Permiso requerido: ${ACTIONS[actionId]?.perm}` : '');
  return `<button class="${cls} ${isDanger(actionId,params)?'danger':''}" data-action="${esc(actionId)}"
    data-params="${esc(JSON.stringify(params||{}))}" ${allowed?'':'disabled'} title="${esc(title)}">${esc(label)}</button>`;
}
