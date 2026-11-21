// NEXA V2 — shell definitivo: router, Básico/Pro, sesión servidor + desbloqueo local,
// proveedor API real y acciones de gestión autenticadas. Sin datos DEMO en el producto.
import { ENGINES, ENGINE_SUBTABS } from './contracts.js';
import { createApiProvider } from './provider.js';
import { CONFIG, setApiBase } from './config.js';
import { session, logout, localLock, biometric } from './auth.js';
import { device, enrollDevice, redeemPairCode, obtainSession, unpair } from './pairing.js';
import { ACTIONS, runAction, canDo, confirmText, needsDouble } from './actions.js';
import { esc, fmtAge } from './util.js';
import { clear, h, badge, openModal } from './ui.js';
import { showRecordInspector } from './inspector.js';
import * as S from './screens.js';

// Mark native Android WebView to reserve system status-bar inset reliably.
if(window.Capacitor?.isNativePlatform?.()) document.documentElement.classList.add('nexa-native');

// ---------- Estado global ----------
const state = {
  mode: localStorage.getItem('nexa.mode') || 'pro',      // basic | pro  (solo presentación)
  screen: 'home',
  ui: { engineId:'idca', subtab:'panel', marketPair:'BTC/USD',
    activityFilter:{ sev:'all', engine:'all' } },
  provider: createApiProvider(),
  online: navigator.onLine !== false,

  common: {},          // market/portfolio/activity/fisco normalizados
  enginesData: {},     // { id: { state, data } }
  spotExtraTrades: [], // páginas de historial GET autenticado ya leídas por el usuario
  spotPageOffset: 100,
  refreshTimer: null,
  unlocked: false,             // PIN/biometría comprobados en esta apertura
  deviceEnrolled: false,       // Identidad persistente, independiente del token de 30 min
  repairRequired: false,       // Solo un dispositivo revocado exige nuevo código
};
let renewPromise=null;

const NAV = [
  { id:'home',   label:'Inicio',     icon:'M4 11 12 4l8 7v9h-5v-5H9v5H4z' },
  { id:'market', label:'Mercado',    icon:'M4 20 10 12l4 4 6-10' },
  { id:'engines',label:'Motores',    icon:'M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1M7.7 16.3l-2.1 2.1' },
  { id:'portfolio',label:'Cartera',  icon:'M4 7h16v12H4zM4 7l3-4h10l3 4M12 11v6' },
  { id:'activity',label:'Actividad', icon:'M4 12h4l2-7 4 14 2-7h4' },
  { id:'fisco',  label:'FISCO',      icon:'M8 3h8v18l-4-3-4 3z' },
  { id:'settings',label:'Ajustes',   icon:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm8 4h3M3 12h3m6-9v3m0 12v3M17.7 6.3l2-2M4.3 19.7l2-2m11.4 2 2-2M4.3 4.3l2 2' },
];
const BOTTOM_NAV = ['home','market','engines','portfolio','activity'];

// ---------- Router ----------
function navTarget(){
  if(state.screen==='engines') return 'engines:'+state.ui.engineId;
  return state.screen;
}
function navTo(target){
  if(target.startsWith('engine:')){ state.ui.engineId = target.slice(7); state.ui.subtab = ENGINE_SUBTABS[state.ui.engineId]?.[0]?.id || 'panel'; state.screen='engines'; }
  else state.screen = target;
  render();
  window.scrollTo?.(0,0);
}
window.addEventListener('hashchange', ()=>{ if(location.hash) navTo(location.hash.slice(1)); });

// ---------- Datos ----------
async function loadData(){
  const p = state.provider;
  const [idca, spot, grid, ama, market, portfolio, activity, fisco] = await Promise.all([
    p.idca(), p.spot(), p.grid(), p.ama(), p.market(state.ui.marketPair),
    p.portfolio(), p.activity(), p.fisco(),
  ]);
  const pack = r => ({ state: r.state||'ok', data: normalizeEngine(r) });
  state.enginesData = { idca:pack(idca), spot:pack(spot), grid:pack(grid), ama:pack(ama) };
  // El refresco de 30 s no debe tirar las páginas históricas ya consultadas.
  // Se mezclan solo si el GET del historial sigue autorizado; si no, se limpian.
  const sd=state.enginesData.spot.data;
  if(sd.resourceStates?.trades==='ok'&&Array.isArray(sd.trades)&&state.spotExtraTrades.length){
    const key=o=>String(o.id??o.tradeId??'')+'|'+String(o.ts??'');
    const seen=new Set(sd.trades.map(key));
    for(const t of state.spotExtraTrades){
      const k=key(t);
      if(!seen.has(k)){seen.add(k);sd.trades.push(t);}
    }
  }else if(sd.resourceStates?.trades!=='ok'){
    state.spotExtraTrades=[];state.spotPageOffset=100;
  }
  // Actividad global = feed de notificaciones + eventos reales de cada motor, sin duplicados.
  const feed=[...(activity.events?.data??[])];
  const seen=new Set(feed.map(e=>`${e.engine||'bot'}:${e.id??e.ts}`));
  const push=(arr,engine)=>{for(const e of arr||[]){const k=`${engine}:${e.id??e.ts??e.msg}`;if(!seen.has(k)){seen.add(k);feed.push({...e,engine:e.engine||engine});}}};
  const gd=state.enginesData.grid.data,ad=state.enginesData.ama.data,id=state.enginesData.idca.data;
  push(gd?.events,'grid');push(ad?.trace?.decisions,'ama');push(id?.events,'idca');
  feed.sort((a,b)=>new Date(b.ts||0)-new Date(a.ts||0));
  state.common = {
    market: { state: market.state, data: market.market?.data ?? null },
    portfolio: { state: portfolio.state, data: { summary: portfolio.summary?.data ?? null, holdings: portfolio.holdings?.data ?? [], ledger: portfolio.ledger?.data ?? [], reservations: portfolio.reservations?.data ?? [], budgets: portfolio.budgets?.data ?? null, inventory: portfolio.inventory?.data ?? [] } },
    activity: { state: activity.state, data: { events: feed } },
    fisco: { state: fisco.state, data: fisco.data ?? null, note: fisco.note },
  };
}
// Aplana los envoltorios {data,state} del provider a la forma que consumen las pantallas.
function normalizeEngine(r){
  const d = {};
  for(const [k,v] of Object.entries(r||{})){
    if(k==='state'||k==='latency') continue;
    d[k] = (v && typeof v==='object' && 'data' in v) ? v.data : v;
  }
  return d;
}

// ---------- Render ----------
const $ = id => document.getElementById(id);
function render(){
  const scr = $('screen');
  const ctx = {
    mode: state.mode, ui: state.ui, engineList: ENGINES,
    authenticated: !!session.get(),
    deviceEnrolled: state.deviceEnrolled, repairRequired: state.repairRequired,
    enginesData: state.enginesData, data: state.common,
    dataTag: 'API', market: state.common.market,
    subtabs: ENGINE_SUBTABS[state.ui.engineId] || [],
    renderEngineSub, ctxBridge(){ window.__nexa = { ctx: this, session: session.get() }; },
  };
  ctx.ctxBridge();
  let html='';
  if(state.screen==='home') html = S.renderHome(ctx);
  else if(state.screen==='market') html = S.renderMarket(ctx);
  else if(state.screen==='engines') html = S.renderEngine(ctx);
  else if(state.screen==='portfolio') html = S.renderPortfolio(ctx);
  else if(state.screen==='activity') html = S.renderActivity(ctx);
  else if(state.screen==='fisco') html = S.renderFisco(ctx);
  else if(state.screen==='settings') html = S.renderSettings(ctx);
  scr.innerHTML = html;
  renderNav(); renderStatusline();
  document.getElementById('app').dataset.mode = state.mode;
  document.getElementById('app').dataset.screen = state.screen;
  document.getElementById('mode-basic').classList.toggle('on', state.mode==='basic');
  document.getElementById('mode-pro').classList.toggle('on', state.mode==='pro');
  const selectedEngine=ENGINES.find(e=>e.id===state.ui.engineId)?.name || 'Motor';
  document.getElementById('engine-name').textContent=selectedEngine;
  $('engine-btn').setAttribute('aria-label','Cambiar motor. Actual: '+selectedEngine);
  $('engine-btn').title='Cambiar motor · '+selectedEngine;
  scr.focus({preventScroll:true});
}
function renderNav(){
  const cur = state.screen;
  $('topnav').innerHTML = NAV.filter(n=>n.id!=='engines').map(n=>
    `<a href="#${n.id}" data-nav="${n.id}" class="${cur===n.id?'on':''}">${esc(n.label)}</a>`).join('')
    + `<a href="#engines" data-nav="engines" class="${cur==='engines'?'on':''}">Motores</a>`;
  $('settings-shortcut').setAttribute('aria-current',cur==='settings'?'page':'false');
  $('bottomnav').innerHTML = BOTTOM_NAV.map(id=>{
    const n = NAV.find(x=>x.id===id);
    const active = cur===id || (id==='engines'&&cur==='engines');
    return `<a href="#${id}" data-nav="${id}" class="${active?'on':''}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="${n.icon}"/></svg>${esc(n.label)}</a>`;
  }).join('');
}
function renderStatusline(){
  const authed=!!session.get();
  const states=Object.values(state.enginesData).map(e=>e.state);
  const sourceError=states.some(x=>x==='unavailable'||x==='unreachable'||x==='error'||x==='auth_required');
  const sourcesPartial=states.some(x=>x==='partial') ||
    (authed && ['error','unavailable','partial','auth_required'].includes(state.common.portfolio?.state));
  const cls=!state.online?'err':(authed&&!sourceError&&!sourcesPartial?'':'warn');
  const linked=state.deviceEnrolled&&!state.repairRequired;
  const connection = !state.online?'Sin red':
    state.repairRequired?'Dispositivo revocado':
    !authed?(linked?'Conexión pendiente':'Dispositivo sin vincular'):
    sourceError||sourcesPartial?'Conectado · datos parciales':'Conectado';
  $('statusline').innerHTML =
    `<span class="dot ${cls}"></span><span>${esc(connection)}</span>`+
    (!authed?(linked?`<button data-app="refresh" class="nx-status-link">Reintentar conexión ↻</button>`:
      `<button data-app="pair-device" class="nx-status-link">Vincular ahora ›</button>`):
      sourceError||sourcesPartial?`<button data-app="refresh" class="nx-status-link">Reintentar ↻</button>`:'')+
    `<span class="nx-status-right">NEXA · ${state.mode==='basic'?'Básico':'Pro'}</span>`;
}

// ---------- Sub-renderer de motor ----------
function renderEngineSub(engineId, subtab){
  const eng = state.enginesData?.[engineId] ?? {state:'unavailable', data:{}};
  if(eng.state && !['ok','partial'].includes(eng.state)){
    return `<div class="banner ${eng.state==='auth_required'?'warn':'err'}">
      Motor ${esc(engineId)}: ${esc(stateLabel(eng.state))}.
      ${eng.state==='auth_required'?'Inicia sesión con permisos para verlo.':'Sin datos del backend.'}</div>`;
  }
  const ctx = { mode: state.mode, ui: state.ui, data: eng.data, dataTag:'API' };
  const fn = {
    idca: { panel:S.idcaPanel, cycles:S.idcaCycles, history:S.idcaHistory, orders:S.idcaOrders, hybrid:S.idcaHybrid, config:S.idcaConfig, alerts:S.idcaAlerts },
    spot: { panel:S.spotPanel, positions:S.spotPositions, history:S.spotHistory, protections:S.spotProtections, config:S.spotConfig },
    grid: { panel:S.gridPanel, cycles:S.gridCycles, levels:S.gridLevels, monitor:S.gridMonitor, config:S.gridConfig },
    ama:  { panel:S.amaPanel, readiness:S.amaReadiness, mandate:S.amaMandate, trace:S.amaTrace, lab:S.amaLab, config:S.amaConfig },
  }[engineId]?.[subtab];
  const partial=eng.state==='partial'?'<div class="nx-subview-partial">Lectura parcial: algunos endpoints pueden no estar autorizados o disponibles. Los datos confirmados sí se muestran; los ausentes no equivalen a cero.</div>':'';
  return fn ? partial+fn(ctx) : `<div class="banner warn">Subvista no implementada: ${esc(engineId)}/${esc(subtab)}</div>`;
}
function stateLabel(s){
  return {unreachable:'backend inaccesible',unavailable:'no disponible',error:'error de API',
    auth_required:'autenticación requerida',forbidden:'sin permiso',ok:'ok'}[s] || s;
}

// ---------- Modal selector de motor ----------
function openEngineModal(){
  const modal = openModal(`<h3>Seleccionar motor</h3><div class="pick">`+
    ENGINES.map(e=>`<button data-pick-engine="${e.id}" class="${e.id===state.ui.engineId?'on':''}">
      <span class="ic">${esc(e.name[0])}</span><span><b>${esc(e.name)}</b><br><small class="tiny">${esc(e.desc)}</small></span></button>`).join('')+
    `</div>`);
  modal.root.querySelectorAll('[data-pick-engine]').forEach(b=>b.addEventListener('click',()=>{
    state.ui.engineId=b.dataset.pickEngine; state.screen='engines';
    state.ui.subtab = ENGINE_SUBTABS[state.ui.engineId]?.[0]?.id || 'panel';
    modal.close(); render();
  }));
}

// ---------- Acciones de gestión autenticadas ----------
function openAction(actionId, params){
  const a = ACTIONS[actionId];
  if(!a) return;
  if(!session.get()){
    return openModal(`<h3>Autenticación requerida</h3><p class="small">Inicia sesión para ejecutar acciones.</p>`);
  }
  if(!canDo(actionId)){
    return openModal(`<h3>Sin permiso</h3><p class="small">Tu sesión no tiene el permiso <b>${esc(a.perm)}</b>.</p>`);
  }
  const dbl = needsDouble(actionId);
  const modal = openModal(`<h3>Confirmar acción</h3>
    <p class="small">${esc(confirmText(actionId, params))}</p>
    ${dbl?'<p class="warn-tx small">Acción de alto riesgo. Escribe CONFIRMAR para continuar.</p><input id="act-confirm" class="inp" placeholder="CONFIRMAR" autocomplete="off">':''}
    <div class="btn-row" style="margin-top:14px">
      <button class="btn danger" id="act-run">Ejecutar</button>
      <button class="btn" id="act-cancel">Cancelar</button></div>
    <div id="act-result" class="small" style="margin-top:10px"></div>`);
  modal.root.querySelector('#act-cancel').addEventListener('click',()=>modal.close());
  modal.root.querySelector('#act-run').addEventListener('click', async ev=>{
    if(dbl && modal.root.querySelector('#act-confirm').value!=='CONFIRMAR'){
      modal.root.querySelector('#act-result').textContent='Escribe CONFIRMAR.'; return;
    }
    ev.target.disabled = true;
    const r = await runAction(actionId, params);
    modal.root.querySelector('#act-result').innerHTML = r.ok
      ? `<span class="pos">Aceptada (HTTP ${r.status||200})</span>`
      : `<span class="neg">Rechazada: ${esc(r.error||'error')}${r.status?` (HTTP ${r.status})`:''}</span>`;
    if(r.ok) setTimeout(()=>{ modal.close(); loadData().then(render); }, 1200);
  });
}

// ---------- Gate de acceso: PIN local + biometría nativa + vinculación ----------
let pinBuf='', pinStage='unlock', pinFirst='';
const PIN_LEN = 6;

function pinInit(){
  const pad = $('pin-pad');
  const keys = ['1','2','3','4','5','6','7','8','9','','0','⌫'];
  pad.innerHTML = keys.map(k=>k===''?'<span></span>':`<button data-key="${k}">${k}</button>`).join('');
  pad.addEventListener('click', e=>{
    const k = e.target.closest('button')?.dataset.key;
    if(k!==undefined) pinKey(k);
  });
  document.addEventListener('keydown', e=>{
    if($('unlock-overlay').classList.contains('hidden')) return;
    if(/^[0-9]$/.test(e.key)) pinKey(e.key);
    if(e.key==='Backspace') pinKey('⌫');
  });
  $('bio-btn').addEventListener('click', bioUnlock);
  $('pair-btn').addEventListener('click', doPair);
  $('pair-code').addEventListener('keydown', e=>{ if(e.key==='Enter') doPair(); });
  $('pair-paste-btn').addEventListener('click',async()=>{
    try{
      const text=await navigator.clipboard.readText();
      const code=String(text||'').replace(/[\s-]/g,'').trim().toUpperCase();
      if(!/^[0-9A-F]{24}$/.test(code)){
        $('pair-err').textContent='El portapapeles no contiene un código válido de 24 caracteres.';
        return;
      }
      $('pair-code').value=code;
      $('pair-err').textContent='';
      $('pair-code').focus();
    }catch{
      $('pair-err').textContent='Mantén pulsado el campo para pegar el código.';
      $('pair-code').focus();
    }
  });
  $('pair-config-toggle').addEventListener('click', ()=>{
    const form=$('pair-config-form');
    const open=form.hidden;
    form.hidden=!open;
    $('pair-config-toggle').setAttribute('aria-expanded',String(open));
    if(open){ syncPairServer(); $('pair-api-base').focus(); }
  });
  $('pair-config-form').addEventListener('submit', e=>{
    e.preventDefault();
    const input=$('pair-api-base');
    try{
      setApiBase(input.value.trim());
      session.clear();
      syncPairServer();
      $('pair-err').textContent='Servidor guardado. Ya puedes conectar tu móvil.';
      $('pair-config-form').hidden=true;
      $('pair-config-toggle').setAttribute('aria-expanded','false');
    }catch(err){
      $('pair-err').textContent=String(err.message||err);
      input.focus();
    }
  });
  syncPairServer();
  $('pair-skip').addEventListener('click', ()=>{
    $('pair-overlay').classList.add('hidden');
    loadData().then(render);
  });
}
function syncPairServer(){
  $('pair-server-current').textContent=CONFIG.apiBase;
  $('pair-api-base').value=CONFIG.apiBase;
}
function openPairOverlay(message=''){
  syncPairServer();
  $('pair-err').textContent=message;
  $('pair-overlay').classList.remove('hidden');
}
function pinKey(k){
  if(Date.now()<localLock.lockedUntil()){ $('pin-err').textContent='Demasiados intentos. Espera unos segundos…'; return; }
  if(k==='⌫'){ pinBuf=pinBuf.slice(0,-1); }
  else if(pinBuf.length<PIN_LEN){ pinBuf+=k; }
  pinDraw();
  if(pinBuf.length===PIN_LEN) pinCheck();
}
function pinDraw(){
  $('pin-dots').innerHTML = Array.from({length:PIN_LEN},(_,i)=>`<i class="${i<pinBuf.length?'on':''}"></i>`).join('');
}
async function pinCheck(){
  if(pinStage==='setup'){
    pinFirst = pinBuf; pinBuf=''; pinStage='confirm';
    $('unlock-title').textContent='Confirma tu PIN';
    $('unlock-note').textContent='Repite el mismo PIN de 6 dígitos.';
    pinDraw(); return;
  }
  if(pinStage==='confirm'){
    if(pinBuf===pinFirst){ await localLock.setup(pinBuf); pinStage='unlock'; afterUnlock(); }
    else{ pinStage='setup'; $('unlock-title').textContent='Crear PIN';
      $('pin-err').textContent='No coinciden. Inténtalo de nuevo.'; }
    pinBuf=''; pinDraw(); return;
  }
  // unlock
  const ok = await localLock.verify(pinBuf);
  pinBuf=''; pinDraw();
  if(ok){ localLock.registerOk(); afterUnlock(); }
  else{ const wait = localLock.registerFail();
    $('pin-err').textContent = wait>0 ? `PIN incorrecto. Reintenta en ${Math.ceil(wait/1000)}s` : 'PIN incorrecto'; }
}
async function bioUnlock(){
  const r = await biometric.prompt('Desbloquear NEXA');
  if(r==='ok'){ afterUnlock(); }
  else if(r==='cancelled'){ $('pin-err').textContent='Biometría cancelada — usa tu PIN.'; }
  else if(r==='failed'){ $('pin-err').textContent='Biometría no reconocida — usa tu PIN.'; }
  else{ $('pin-err').textContent='Sin sensor disponible — usa tu PIN.'; }
}
async function showUnlock(){
  $('pin-err').textContent='';
  const enrolled = await device.isEnrolled();
  if(!localLock.isSet()){
    pinStage='setup';
    $('unlock-title').textContent='Crear PIN';
    $('unlock-note').textContent='Elige un PIN de 6 dígitos. Es tu llave local; nunca sale del dispositivo.';
  }else{
    pinStage='unlock';
    $('unlock-title').textContent='Desbloquear NEXA';
    const bio = await biometric.available();
    $('bio-btn').classList.toggle('hidden', !bio.ok);
    $('unlock-note').textContent = bio.ok ? 'Verifícate con biometría o introduce tu PIN.'
      : 'Introduce tu PIN de desbloqueo.';
    $('unlock-alt').textContent = enrolled ? 'Dispositivo vinculado al bot' : 'Dispositivo sin vincular';
    if(bio.ok) bioUnlock();
  }
  $('unlock-overlay').classList.remove('hidden');
  pinBuf=''; pinDraw();
}
// El código temporal SOLO registra una nueva identidad. Desde entonces la clave
// local firma desafíos nuevos y renueva el token sin PIN adicional ni otro código.
// Rotamos el token de 30 minutos antes de vencer; no guardamos secretos en logs.
async function ensureDeviceSession(force=false){
  if(!state.unlocked || !state.deviceEnrolled || !state.online)return false;
  const current=session.get();
  if(!force && current && current.expiresAt>Date.now()+2*60*1000)return true;
  if(renewPromise)return renewPromise;
  renewPromise=(async()=>{
    try{
      const next=await obtainSession();
      if(next.ok){
        session.set({token:next.token,expiresAt:next.expiresAt,user:next.user,
          roles:next.roles,csrf:next.csrf});
        state.repairRequired=false;
        return true;
      }
      if(next.status===403 && next.error==='device_unknown_or_revoked'){
        state.repairRequired=true;
        session.clear();
      }
      return !!session.get();
    }catch{
      // La falta de red NO borra el dispositivo registrado en IndexedDB.
      return !!session.get();
    }
  })();
  try{return await renewPromise;}finally{renewPromise=null;}
}
async function refreshVisibleData(forceSession=false){
  if(!state.unlocked)return;
  if(!await ensureDeviceSession(forceSession)){
    render(); // Sin datos ficticios, pero NUNCA exigir código por timeout.
    return;
  }
  try{
    await loadData();
    // El servidor puede reiniciarse y olvidar tokens temporales, aunque el móvil
    // continúe registrado. Si devuelve 401, pedir nuevo challenge automáticamente.
    const expiredRemotely=Object.values(state.enginesData).some(x=>x.state==='auth_required') ||
      state.common.portfolio?.state==='auth_required';
    if(expiredRemotely && state.deviceEnrolled && !state.repairRequired){
      if(await ensureDeviceSession(true))await loadData(); // máximo un reintento
    }
  }catch{
    // El servidor puede estar temporalmente fuera de línea; conserva la identidad.
  }
  render();
}
async function afterUnlock(){
  $('unlock-overlay').classList.add('hidden');
  state.unlocked=true;
  state.deviceEnrolled=await device.isEnrolled();
  if(state.deviceEnrolled){
    // Un móvil YA REGISTRADO nunca debe pedir otro código por expiración del token
    // o por caída de red. Reintenta sesión en segundo plano cada 30 s.
    await refreshVisibleData(true);
    scheduleRefresh();
    return;
  }
  // Solo la PRIMERA vinculación, o la revocación explícita, usa código temporal.
  openPairOverlay();
}
async function doPair(){
  const code=$('pair-code').value.replace(/[\s-]/g,'').toUpperCase();
  if(!/^[0-9A-F]{24}$/.test(code)){
    $('pair-err').textContent='El código debe tener 24 caracteres. Pégalo completo.';
    $('pair-code').focus();
    return;
  }
  const label=$('pair-label').value.trim()||'Mi móvil';
  const submit=$('pair-btn');
  if(submit.disabled)return;
  submit.disabled=true;
  $('pair-err').textContent='Comprobando código…';
  try{
    const r=await redeemPairCode(code,label);
    if(!r.ok){
      const reason=String(r.error||'');
      $('pair-err').textContent = r.status===403 || /invalid_or_expired|invalid|expired/.test(reason)
        ? 'El código no es válido o ha caducado. Pide uno nuevo a Cascade.'
        : r.status===409
          ? 'Este móvil ya está vinculado. Abre Ajustes si quieres cambiar de servidor.'
          : r.status===429
            ? 'Demasiados intentos. Prueba de nuevo más tarde.'
            : r.status===0
              ? 'No se puede conectar. Comprueba el servidor en ⚙ Ajustes.'
              : 'No se ha podido vincular. Comprueba la conexión o solicita otro código.';
      return;
    }
    // El canje ya guardó la identidad: nunca consumir otro código para reintentar.
    state.deviceEnrolled=true;
    state.repairRequired=false;
    $('pair-overlay').classList.add('hidden');
    let s;
    try{s=await obtainSession();}catch{s={ok:false};}
    if(s.ok){
      session.set({token:s.token,expiresAt:s.expiresAt,user:s.user,
        roles:s.roles,csrf:s.csrf});
    }
    // El código se consume durante el alta, no durante la sesión. Incluso si el
    // primer challenge falla por red, el dispositivo ya está registrado.
    await refreshVisibleData();
    scheduleRefresh();
  }catch(err){
    $('pair-err').textContent='No se ha podido conectar con la API segura. Comprueba la URL y tu conexión.';
    console.warn('[NEXA] Error en vinculación (sin imprimir código ni credenciales):',err?.name||'network_error');
  }finally{
    submit.disabled=false;
  }
}
function lockNow(){
  if(!localLock.isSet()) return;
  state.unlocked=false;
  clearInterval(state.refreshTimer);
  session.clear(); // La clave del dispositivo persiste; nuevo token tras PIN/biometría.
  state.enginesData={};state.common={};
  render();
  pinBuf='';pinDraw();showUnlock();
}


// ---------- Ajustes: backend y sesión ----------
function openSettingsApi(){
  const modal = openModal(`<h3>Conexión backend</h3>
    <p class="small">URL base de la API del bot. Sin credenciales aquí.</p>
    <input id="api-base" class="inp" value="${esc(CONFIG.apiBase)}" placeholder="/api o https://host/api">
    <div class="btn-row" style="margin-top:12px"><button class="btn" id="api-save">Guardar y reconectar</button></div>`);
  modal.root.querySelector('#api-save').addEventListener('click',()=>{
    try{
      setApiBase(modal.root.querySelector('#api-base').value.trim());
      session.clear(); // A previous bearer token must not be reused on a different server.
      modal.close();
      loadData().then(render);
    }catch(err){
      const input=modal.root.querySelector('#api-base');
      input.setCustomValidity(String(err.message||err));
      input.reportValidity();
      input.addEventListener('input',()=>input.setCustomValidity(''),{once:true});
    }
  });
}
function scheduleRefresh(){
  clearInterval(state.refreshTimer);
  state.refreshTimer=setInterval(()=>{
    if(state.unlocked && state.deviceEnrolled && state.online){
      refreshVisibleData().catch(()=>{ /* no se pierde la vinculación */ });
    }
  },30000);
}

async function loadMoreSpotHistory(button){
  if(!state.unlocked||!session.get()||!state.online)return;
  const spot=state.enginesData.spot?.data;
  if(!spot||spot.resourceStates?.trades!=='ok'||!Array.isArray(spot.trades))return;
  if(typeof state.provider.spotTradesPage!=='function')return;
  const offset=Math.max(100,state.spotPageOffset||100);
  button.disabled=true;button.textContent='Cargando historial…';button.setAttribute('aria-busy','true');
  try{
    const page=await state.provider.spotTradesPage(offset);
    if(page.state!=='ok')throw Error('lectura_denegada_o_no_disponible');
    if(!Array.isArray(page.trades)||!page.trades.length){
      button.textContent='No hay más operaciones confirmadas';
      return;
    }
    const key=o=>String(o.id??o.tradeId??'')+'|'+String(o.ts??'');
    const previous=new Set(spot.trades.map(key));
    const unique=page.trades.filter(x=>!previous.has(key(x)));
    for(const t of unique){previous.add(key(t));state.spotExtraTrades.push(t);spot.trades.push(t);}
    state.spotPageOffset=offset+page.trades.length;
    if(page.total!==null)spot.tradeTotal=page.total;
    const scroll=window.scrollY;
    render();
    window.scrollTo?.(0,scroll);
  }catch(e){
    button.disabled=false;button.removeAttribute('aria-busy');
    button.textContent='No se pudo cargar. Reintentar';
    button.title='Historial no accesible mediante GET autenticado. No implica que falten operaciones.';
  }
}

// ---------- Eventos globales ----------
document.addEventListener('click', e=>{
  // Ficha universal de lectura: selección de orden, venta, cierre, ciclo, nivel o evento.
  // Usa el registro del read-model vigente; no genera acciones de trading.
  const inspect = e.target.closest('[data-inspect]');
  if(inspect){ e.preventDefault(); showRecordInspector(state,inspect.dataset.inspect); return; }
  const nav = e.target.closest('[data-nav]');
  if(nav){ e.preventDefault(); navTo(nav.dataset.nav); return; }
  const ui = e.target.closest('[data-ui]');
  if(ui){
    const [k,v] = ui.dataset.ui.split(':');
    if(k==='subtab') state.ui.subtab=v;
    else if(k==='marketPair'){
      state.ui.marketPair=v;
      render(); // The chosen pair changes immediately.
      if(session.get()) state.provider.market(v).then(res=>{
        if(state.ui.marketPair!==v) return; // ignore a stale in-flight pair response
        state.common.market={state:res.state,data:res.market?.data??null};
        render();
      }).catch(()=>{ state.common.market={state:'error',data:null};render(); });
      return;
    }
    else if(k==='sev') state.ui.activityFilter.sev=v;
    else if(k==='eng') state.ui.activityFilter.engine=v;
    render(); return;
  }
  const act = e.target.closest('[data-action]');
  if(act){
    let params={}; try{ params = JSON.parse(act.dataset.params||'{}'); }catch{}
    openAction(act.dataset.action, params); return;
  }
  const misc = e.target.closest('[data-app]');
  if(misc){
    const k = misc.dataset.app;
    if(k==='pair-device') openPairOverlay();
    else if(k==='settings-api') openSettingsApi();
    else if(k==='logout'){ logout(); location.reload(); }
    else if(k==='refresh'){ refreshVisibleData(true).catch(()=>render()); }
    else if(k==='spot-history-more'){ loadMoreSpotHistory(misc).catch(()=>{}); }
    return;
  }
});
document.addEventListener('keydown', e=>{
  const target=e.target.closest?.('[data-inspect][role="button"]');
  if(!target || (e.key!=='Enter'&&e.key!==' '))return;
  e.preventDefault(); showRecordInspector(state,target.dataset.inspect);
});
$('mode-basic').addEventListener('click', ()=>{ state.mode='basic'; localStorage.setItem('nexa.mode','basic'); render(); });
$('mode-pro').addEventListener('click', ()=>{ state.mode='pro'; localStorage.setItem('nexa.mode','pro'); render(); });
$('engine-btn').addEventListener('click', openEngineModal);
$('lock-btn').addEventListener('click', lockNow);

// Inspección de velas: tooltip táctil/ratón/teclado, solo datos OHLCV del proveedor.
function showCandleTip(event){
  const mark=event.target?.closest?.('[data-candle-tip]');
  if(!mark)return;
  const box=mark.closest('[data-nxp-chart]');
  const tip=box?.querySelector('.nxp-chart-tooltip');
  if(!tip)return;
  tip.textContent=mark.dataset.candleTip||'';
  tip.hidden=false;
}
document.addEventListener('pointerdown',showCandleTip);
document.addEventListener('pointermove',event=>{if(event.pointerType==='mouse')showCandleTip(event);});
document.addEventListener('focusin',showCandleTip);
document.addEventListener('pointerout',event=>{
  const box=event.target?.closest?.('[data-nxp-chart]');
  if(box&&!box.contains(event.relatedTarget)){
    const tip=box.querySelector('.nxp-chart-tooltip');
    if(tip)tip.hidden=true;
  }
});

window.addEventListener('online',()=>{
  state.online=true;
  renderStatusline();
  if(state.unlocked&&state.deviceEnrolled)refreshVisibleData(true).catch(()=>render());
});
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden&&state.unlocked&&state.deviceEnrolled&&state.online)
    refreshVisibleData().catch(()=>render());
});
window.addEventListener('offline', ()=>{ state.online=false; renderStatusline(); });

// PWA
if('serviceWorker' in navigator){ navigator.serviceWorker.register('sw.js').catch(()=>{}); }

// ---------- Boot ----------
(async function boot(){
  pinInit();
  render();
  // Gate: PIN setup/unlock → sesión por challenge o pairing → app.
  await showUnlock();
})();