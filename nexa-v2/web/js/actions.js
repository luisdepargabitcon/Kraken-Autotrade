// NEXA V2 — acciones de gestión auténticas.
// Cada acción: permiso requerido, confirmación, método+ruta REAL del bot,
// idempotencia y auditoría. El servidor es quien autoriza de verdad; el
// cliente solo prepara, confirma y muestra el resultado honesto.
import { CONFIG } from './config.js';
import { session } from './auth.js';
import { esc } from './util.js';

export const ACTIONS = {
  'idca.pauseGlobal':    { engine:'idca', perm:'idca:control', confirm:'¿Pausar el trading global IDCA?', danger:true,
                           req:(p)=>['PATCH','/institutional-dca/controls',{globalTradingPause:!!p.pause}] },
  'idca.emergencyClose': { engine:'idca', perm:'idca:emergency', confirm:'CIERRE DE EMERGENCIA: cerrará posiciones IDCA abiertas. Confirmar.', danger:true, doubleConfirm:true,
                           req:()=>['POST','/institutional-dca/emergency/close-all',{}] },
  'idca.closeCycle':     { engine:'idca', perm:'idca:control', confirm:p=>`¿Cerrar manualmente el ciclo ${p.cycleId}?`, danger:true,
                           req:(p)=>['POST',`/institutional-dca/cycles/${encodeURIComponent(p.cycleId)}/close-manual`,{}] },
  'idca.cycleStatus':    { engine:'idca', perm:'idca:control', confirm:p=>`¿Cambiar el estado del ciclo ${p.cycleId} a ${p.status}?`,
                           req:(p)=>['PATCH',`/institutional-dca/cycles/${encodeURIComponent(p.cycleId)}/status`,{status:p.status}] },
  'idca.soloSalida':     { engine:'idca', perm:'idca:control', confirm:p=>`¿${p.soloSalida?'Dejar el ciclo importado en solo salida':'Permitir la gestión completa'} para el ciclo ${p.cycleId}?`,
                           req:(p)=>['PATCH',`/institutional-dca/cycles/${encodeURIComponent(p.cycleId)}/solo-salida`,{soloSalida:!!p.soloSalida}] },
  'idca.timeStop':       { engine:'idca', perm:'idca:control', confirm:p=>`¿${p.disabled?'Desactivar':'Reactivar'} el cierre automático por duración del ciclo ${p.cycleId}?`,
                           req:(p)=>['PATCH',`/institutional-dca/cycles/${encodeURIComponent(p.cycleId)}/time-stop`,{disabled:!!p.disabled}] },
  'idca.deleteCycle':    { engine:'idca', perm:'idca:control', confirm:p=>`¿Eliminar el ciclo manual ${p.cycleId}?`, danger:true, doubleConfirm:true,
                           req:(p)=>['DELETE',`/institutional-dca/cycles/${encodeURIComponent(p.cycleId)}/manual`,{}] },
  'idca.manualBuy':      { engine:'idca', perm:'idca:control', confirm:p=>`¿Registrar una compra YA ejecutada externamente para el ciclo ${p.cycleId}? Esto NO lanza una compra al exchange.`,
                           req:(p)=>['POST',`/institutional-dca/cycles/${encodeURIComponent(p.cycleId)}/manual-buy`,{
                             pair:p.pair,price:p.price,quantity:p.quantity,notionalUsd:p.notionalUsd,
                             feesUsd:p.feesUsd,executedAt:p.executedAt,exchange:p.exchange,
                             externalOrderId:p.externalOrderId||null,note:p.note||null,
                             continueAutomaticManagement:p.continueAutomaticManagement===true
                           }] },
  'idca.togglePair':     { engine:'idca', perm:'idca:control', confirm:p=>`¿${p.enabled?'Activar':'Desactivar'} el par ${p.pair}?`,
                           req:(p)=>['PATCH',`/institutional-dca/asset-configs/${encodeURIComponent(p.pair)}`,{enabled:!!p.enabled}] },
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

// ── Idempotencia durable POR OPERACIÓN DE USUARIO (TANGO 10.3) ──
// La identidad de la operación se crea UNA vez por gesto del usuario, se
// persiste ANTES del primer envío en localStorage y se reutiliza en cualquier
// reintento: timeout, pérdida de respuesta, doble toque, cierre/reapertura de
// la app. Dos invocaciones del mismo gesto NUNCA crean dos operaciones. La
// clave queda ligada a acción+payload+identidad de sesión; jamás se reutiliza
// para un payload distinto (nuevo gesto = nueva identidad). Las entradas
// expiran a las 24 h; no se guardan tokens ni secretos aquí.
const IDEM_TTL_MS = 24*60*60*1000;
const IDEM_PREFIX = 'nxv2op:';

function canonical(value){
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
}
async function sha256hex(text){
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
function newKeyMaterial(){
  return `${Date.now().toString(36)}-${crypto.getRandomValues(new Uint32Array(2))[0].toString(36)}${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;
}

// Identidad estable de la operación: persiste antes del envío y sobrevive a
// reinicios de la app. operationSeed distingue gestos repetidos intencionados:
// la UI lo genera nuevo cuando el usuario confirma una operación NUEVA, pero
// lo conserva en reintentos del mismo gesto (ver runAction).
export async function operationIdentity(actionId, method, path, body, operationSeed){
  const sessionId = session.get()?.deviceId || session.get()?.tokenHash || 'anon';
  const fingerprint = await sha256hex(`${sessionId}|${method}|${path}|${canonical(body??null)}|${operationSeed}`);
  const storageKey = IDEM_PREFIX + fingerprint;
  let rec = null;
  try{ rec = JSON.parse(localStorage.getItem(storageKey)||'null'); }catch{}
  if(rec && Date.now()-rec.createdAt < IDEM_TTL_MS){
    return { key: rec.key, storageKey, existing: rec };
  }
  const key = `nxv2-${newKeyMaterial()}`;
  const fresh = { key, createdAt: Date.now(), state: 'in_progress' };
  try{ localStorage.setItem(storageKey, JSON.stringify(fresh)); }catch{}
  return { key, storageKey, existing: null };
}
export function markOperationCompleted(storageKey, result){
  try{
    const rec = JSON.parse(localStorage.getItem(storageKey)||'null');
    if(rec){ rec.state = result.ok ? 'completed' : 'failed'; rec.status = result.status??null; localStorage.setItem(storageKey, JSON.stringify(rec)); }
  }catch{}
}

// Ejecuta la acción tras la confirmación UI. Devuelve resultado honesto.
export async function runAction(actionId, params={}, { operationSeed } = {}){
  const a = ACTIONS[actionId];
  if(!a) return { ok:false, error:'unknown_action' };
  if(!session.get()) return { ok:false, error:'auth_required' };
  if(!canDo(actionId)) return { ok:false, error:'forbidden', perm:a.perm };
  const [method, path, body] = a.req(params);
  const s = session.get();
  const t0 = Date.now();
  // operationSeed: lo fija la UI al confirmar el gesto; los reintentos del
  // mismo gesto lo conservan (doble toque, timeout, reanudación). Sin seed la
  // identidad es igualmente estable para la misma acción+payload, de modo que
  // un doble toque sin seed tampoco duplica la operación.
  const identity = await operationIdentity(actionId, method, path, {...body, __action:actionId}, operationSeed ?? '');
  if(identity.existing?.state === 'completed'){
    // El gesto ya se ejecutó con éxito: jamás reejecutar. El usuario ve el
    // resultado honesto y debe iniciar una operación NUEVA si realmente quiere repetirla.
    return { ok:true, status: identity.existing.status ?? 200, data:null, latency:0,
             idempotentReplay:'local-operation-already-completed',
             warning:'Esta operación ya se ejecutó; no se ha enviado duplicado.' };
  }
  try{
    const res = await fetch(CONFIG.apiBase + path, {
      method,
      headers: {
        'Accept':'application/json','Content-Type':'application/json',
        'Authorization':`Bearer ${s.token}`,
        'X-Idempotency-Key': identity.key,
        ...(s.csrf ? {'X-CSRF-Token': s.csrf} : {}),
      },
      body: JSON.stringify({...body, __action:actionId}),
    });
    let data=null; try{ data=await res.json(); }catch{}
    const out = { ok:res.ok, status:res.status, data, latency:Date.now()-t0,
             error: res.ok?null:(data?.error||`http_${res.status}`),
             idempotentReplay: res.headers.get('x-idempotent-replay') || undefined };
    if(res.status===409 && (data?.error||'').includes('in_progress')){
      // Operación interrumpida en el servidor: NO reejecutar ni inventar clave
      // nueva. El usuario debe reconciliar el estado antes de reintentar.
      out.warning = 'Operación en curso o interrumpida en el servidor: reconcilie el estado antes de reintentar; no se ha reejecutado.';
    } else if (res.status !== 0) {
      markOperationCompleted(identity.storageKey, out);
    }
    return out;
  }catch(e){
    // Fallo de transporte: la identidad permanece in_progress y el reintento
    // reutiliza la MISMA clave — el servidor la reconocerá si ya la aplicó.
    return { ok:false, error:'unreachable', detail:String(e?.message||e),
             retryable:true, retryKeyHint:'same-operation-key' };
  }
}

// Render: botón de acción (disabled honesto si falta sesión/permiso).
export function actionBtn(actionId, params, label, {cls='btn'}={}){
  const allowed = session.get() && canDo(actionId);
  const title = !session.get() ? 'Requiere sesión' : (!allowed ? `Permiso requerido: ${ACTIONS[actionId]?.perm}` : '');
  return `<button class="${cls} ${isDanger(actionId,params)?'danger':''}" data-action="${esc(actionId)}"
    data-params="${esc(JSON.stringify(params||{}))}" ${allowed?'':'disabled'} title="${esc(title)}">${esc(label)}</button>`;
}
