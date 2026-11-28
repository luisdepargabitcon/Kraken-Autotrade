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
import * as D from './dashboard.js';
import {renderPortfolioView} from './portfolio-view.js';
import { BUILD_INFO } from './build-info.js';
import {renderFiscalView} from './fisco-view.js';
import {openImportPositionPreview} from './import-position.js';
import {renderScopedEngine,renderScopedActivity,renderModesOverview} from './scoped-pages.js';
import {loadSnapshot} from './data-loader.js';
import {classifyMode,inScope,SCOPE_SHADOW} from './display-scope.js';
import {ROOT_ITEMS,bottomItems,navMove,navUp,navRoot,sanitizeNav,navView} from './nav-model.js';

// Mark native Android WebView to reserve system status-bar inset reliably.
if(window.Capacitor?.isNativePlatform?.()) document.documentElement.classList.add('nexa-native');

// ---------- Estado global ----------
const state = {
  mode: localStorage.getItem('nexa.mode') || 'pro',
  viewScope: localStorage.getItem('nexa.viewScope')==='shadow'?'shadow':'real', // solo pantalla, jamás modo del bot      // basic | pro  (solo presentación)
  nav: navRoot(),          // navegación por profundidad {depth,section,sub,inner}
  detail: null,            // pantalla fuera del árbol: asset | manage-idca
  ui: { engineId:'idca', subtab:'panel', marketPair:'BTC/USD', cycleId:null, positionFilter:'all', portfolioTab:'summary',fiscoTab:'summary',
    activityFilter:{ sev:'all', engine:'all', cat:'all' } },
  provider: createApiProvider(),
  online: navigator.onLine !== false,

  common: {},          // market/portfolio/activity/fisco normalizados
  enginesData: {},     // { id: { state, data } }
  spotExtraTrades: [], // páginas de historial GET autenticado ya leídas por el usuario
  spotPageOffset: 100,
  lastGood: null,       // últimas lecturas válidas por recurso (para 'stale')
  allError: false,      // true solo si TODOS los recursos fallan a la vez
  refreshTimer: null,
  unlocked: false,             // PIN/biometría comprobados en esta apertura
  deviceEnrolled: false,       // Identidad persistente, independiente del token de 30 min
  repairRequired: false,       // Solo un dispositivo revocado exige nuevo código
};
let renewPromise=null;

const NAV = [
  { id:'home',   label:'Inicio',     icon:'M4 11 12 4l8 7v9h-5v-5H9v5H4z' },
  { id:'market', label:'Mercado',    icon:'M4 20 10 12l4 4 6-10' },
  { id:'engines',label:'Modos',    icon:'M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1M7.7 16.3l-2.1 2.1' },
  { id:'portfolio',label:'Cartera',  icon:'M4 7h16v12H4zM4 7l3-4h10l3 4M12 11v6' },
  { id:'activity',label:'Actividad', icon:'M4 12h4l2-7 4 14 2-7h4' },
  { id:'fisco',  label:'FISCO',      icon:'M8 3h8v18l-4-3-4 3z' },
  { id:'settings',label:'Ajustes',   icon:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm8 4h3M3 12h3m6-9v3m0 12v3M17.7 6.3l2-2M4.3 19.7l2-2m11.4 2 2-2M4.3 4.3l2 2' },
];
// ---------- Router ----------
// Historial real del WebView (botón Atrás de Android): la app NO instala
// @capacitor/app, así que no hay plugin 'backButton'. Capacitor Android ejecuta
// webView.goBack() por defecto cuando canGoBack() es true; por eso CADA navegación
// del usuario apila una entrada real con history.pushState y 'popstate' restaura
// state.nav/state.detail sin volver a llamar backOne (evitaría doble salto).
// state.mode y state.viewScope son preferencias persistentes: NUNCA entran en el
// historial ni generan entradas.
let navSeq = 0;
function pushNav(){
  navSeq++;
  try{ history.pushState({ nexa:{ seq:navSeq, nav:{...state.nav}, detail:state.detail } }, ''); }
  catch{ navSeq--; /* contexto sin historial (tests/jsdom): la navegación sigue */ }
}
// Sellado de la entrada actual cuando el estado cambia SIN apilar (p. ej. el
// cambio Básico/Pro sanea la ruta pero no debe crear un paso de «atrás»).
function stampCurrent(){
  try{ history.replaceState({ nexa:{ seq:history.state?.nexa?.seq||0, nav:{...state.nav}, detail:state.detail } }, ''); }catch{}
}
// navTo traduce los destinos data-nav que ya existen en el contenido al nuevo
// modelo de profundidad. 'engine:<id>' abre el motor en depth 2; 'fisco' es una
// sección depth 1 propia (subpestañas fiscales en la barra inferior) accesible
// solo por entrada explícita — nunca desde bottomItems de raíz; 'asset' y
// 'manage-idca' son pantallas detalle fuera del árbol de secciones.
// opts.push=false solo para navegaciones que YA son una entrada de historial
// (hashchange): apilar otra crearía un paso «atrás» duplicado.
function navTo(target, opts={}){
  state.detail=null;
  if(target.startsWith('engine:')){ state.nav={depth:2,section:'engines',sub:target.slice(7),inner:'panel'}; }
  else if(target==='fisco'){
    // FISCO = sección depth 1 con sus propias subpestañas en la barra inferior.
    // `from` recuerda la sección de origen para que ‹ vuelva a donde se abrió.
    if(state.nav?.section!=='fisco'){
      const from={...(state.nav||navRoot())};delete from.from;
      state.nav={depth:1,section:'fisco',sub:'summary',inner:null,from};
    }
  }
  else if(target==='asset'||target==='manage-idca'){ state.detail=target; }
  else if(target==='positions'){ state.nav={depth:1,section:'home',sub:'positions',inner:null}; }
  else if(target==='settings'){ state.nav={depth:1,section:'home',sub:'connection',inner:null}; }
  else {
    const i=ROOT_ITEMS.findIndex(x=>x.id===target);
    state.nav = i>=0 ? navMove(navRoot(),i,state.mode) : navRoot();
  }
  if(opts.push!==false) pushNav();
  render();
  window.scrollTo?.(0,0);
}
// Un único nivel hacia arriba: detalle → árbol, depth 2 → sección, depth 1 → raíz.
// Si la entrada actual del historial es una navegación NEXA apilada (seq>0), el ‹
// retrocede DE VERDAD con history.back() y popstate restaura el estado; solo si
// no hay entrada previa (p. ej. llegada por hash sin pushes) se calcula el nivel
// superior y se apila como navegación nueva. En la raíz no hay nada que hacer:
// el botón del sistema sale de la app con su comportamiento normal.
function backOne(){
  if(history.state && history.state.nexa && history.state.nexa.seq>0){ history.back(); return; }
  if(state.detail){ state.detail=null; }
  else if(state.nav.depth>0){ state.nav=navUp(state.nav); }
  else return;
  pushNav(); render(); window.scrollTo?.(0,0);
}
window.addEventListener('hashchange', ()=>{
  if(location.hash){
    navTo(location.hash.slice(1), {push:false});
    stampCurrent(); // el hash ya ES la entrada de historial: solo se actualiza su estado
  }
});
window.addEventListener('popstate', e=>{
  // Restauración directa del estado guardado: NO llamar a backOne (doble salto).
  // Entradas ajenas al modelo ({nxModal} de openModal en ui.js, o historial
  // externo) se ignoran: el modal gestiona su propio cierre en su listener.
  const snap = e.state && e.state.nexa;
  if(!snap || !snap.nav || typeof snap.nav!=='object') return;
  state.detail = snap.detail ? snap.detail : null;
  state.nav = sanitizeNav(snap.nav, state.mode);
  render();
  window.scrollTo?.(0,0);
});

// ---------- Datos ----------
// La carga vive en data-loader.js (módulo puro, sin DOM): cada recurso se
// resuelve de forma independiente — un fallo aísla solo ese recurso, la
// última lectura válida se conserva como 'stale' y el reset total solo ocurre
// si TODO falla a la vez (state.allError).
async function loadData(){
  const snap = await loadSnapshot(state.provider, {
    ui: state.ui,
    prevLastGood: state.lastGood,
    spotExtraTrades: state.spotExtraTrades,
    spotPageOffset: state.spotPageOffset,
  });
  state.enginesData = snap.enginesData;
  state.common = snap.common;
  state.lastGood = snap.lastGood;
  state.allError = snap.allError;
  state.spotPageOffset = snap.spotPageOffset;
}

// ---------- Render ----------
const $ = id => document.getElementById(id);
function render(){
  const scr = $('screen');
  const ctx = {
    mode: state.mode, viewScope:state.viewScope, ui: state.ui, engineList: ENGINES,
    authenticated: !!session.get(),
    deviceEnrolled: state.deviceEnrolled, repairRequired: state.repairRequired,
    enginesData: state.enginesData, data: state.common,
    dataTag: 'API', market: state.common.market,
    subtabs: ENGINE_SUBTABS[state.ui.engineId] || [],
    renderEngineSub, ctxBridge(){ window.__nexa = { ctx: this, session: session.get() }; },
  };
  ctx.ctxBridge();
  // La navegación de profundidad es la fuente de verdad de la ruta; se
  // sincronizan los campos de ui que los renderers existentes ya leen.
  state.nav = sanitizeNav(state.nav, state.mode);
  const view = navView(state.nav);
  if(view.ui.marketSub!==undefined)state.ui.marketSub=view.ui.marketSub;
  if(view.ui.engineId){state.ui.engineId=view.ui.engineId;state.ui.subtab=view.ui.subtab;}
  if(view.ui.portfolioTab)state.ui.portfolioTab=view.ui.portfolioTab;
  if(view.ui.fiscoTab)state.ui.fiscoTab=view.ui.fiscoTab;
  if(view.ui.activityCat)state.ui.activityFilter.cat=view.ui.activityCat;
  const scr2 = state.detail || view.screen;
  let html='';
  if(scr2==='dashboard') html = D.renderDashboard(ctx);
  else if(scr2==='positions') html = D.renderPositions(ctx);
  else if(scr2==='asset') html = D.renderAsset(ctx);
  else if(scr2==='manage-idca') html = D.renderCycleManager(ctx);
  else if(scr2==='market') html = S.renderMarket(ctx);
  else if(scr2==='modes') html = renderModesOverview(ctx);
  else if(scr2==='engine') html = renderScopedEngine(ctx);
  else if(scr2==='portfolio') html = renderPortfolioView(ctx);
  else if(scr2==='activity') html = renderScopedActivity(ctx);
  else if(scr2==='fisco') html = renderFiscalView(ctx);
  else if(scr2==='settings') html = S.renderSettings(ctx);
  scr.innerHTML = html;
  renderNav(); renderStatusline();
  document.getElementById('app').dataset.mode = state.mode;
  document.getElementById('app').dataset.scope = state.viewScope;
  $('scope-real').classList.toggle('on',state.viewScope==='real');
  $('scope-shadow').classList.toggle('on',state.viewScope==='shadow');
  $('scope-real').setAttribute('aria-pressed',String(state.viewScope==='real'));
  $('scope-shadow').setAttribute('aria-pressed',String(state.viewScope==='shadow'));
  document.getElementById('app').dataset.screen = scr2;
  document.getElementById('mode-basic').classList.toggle('on', state.mode==='basic');
  document.getElementById('mode-pro').classList.toggle('on', state.mode==='pro');
  const selectedEngine=ENGINES.find(e=>e.id===state.ui.engineId)?.name || 'Motor';
  document.getElementById('engine-name').textContent=selectedEngine;
  $('engine-btn').setAttribute('aria-label','Cambiar motor. Actual: '+selectedEngine);
  $('engine-btn').title='Cambiar motor · '+selectedEngine;
  scr.focus({preventScroll:true});
}
function renderNav(){
  const view = navView(state.nav);
  const cur = state.detail || view.screen;
  const sectionActive = id => state.detail===id || (!state.detail && state.nav.section===id) || cur===id;
  $('topnav').innerHTML = NAV.filter(n=>n.id!=='engines').map(n=>
    `<a href="#${n.id}" data-nav="${n.id}" class="${sectionActive(n.id)?'on':''}">${esc(n.label)}</a>`).join('')
    + `<a href="#engines" data-nav="engines" class="${sectionActive('engines')?'on':''}">Modos</a>`;
  $('settings-shortcut').setAttribute('aria-current',cur==='settings'?'page':'false');
  // La barra inferior cambia de contenido según el nivel (prototipo):
  // raíz → secciones; depth 1 → subpestañas; depth 2 → secciones del motor.
  const items = bottomItems(state.nav, state.mode);
  const bn = $('bottomnav');
  bn.style.gridTemplateColumns = `repeat(${Math.min(items.length,items.length>5?3:5)},minmax(0,1fr))`;
  bn.innerHTML = items.map((it,i)=>{
    const active = !state.detail && (state.nav.depth===0 ? it.id===state.nav.section
      : state.nav.depth===1 ? it.id===state.nav.sub : it.id===state.nav.inner);
    const icon = state.nav.depth===0 ? (()=>{const n=NAV.find(x=>x.id===it.id);
      return n?`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="${n.icon}"/></svg>`:'';})() : '';
    return `<a href="#${it.id}" data-nav-idx="${i}" class="${active?'on':''}${state.nav.depth?' nv-sub':''}">${icon}${esc(it.label)}</a>`;
  }).join('');
  $('back').hidden = !(state.detail || state.nav.depth>0);
}
function renderStatusline(){
  const authed=!!session.get();
  const states=Object.values(state.enginesData).map(e=>e.state);
  const sourceError=states.some(x=>x==='unavailable'||x==='unreachable'||x==='error'||x==='auth_required');
  const sourcesPartial=states.some(x=>x==='partial'||x==='stale') ||
    (authed && ['error','unavailable','partial','stale','auth_required'].includes(state.common.portfolio?.state));
  const cls=!state.online?'err':(authed&&!sourceError&&!sourcesPartial?'':'warn');
  const linked=state.deviceEnrolled&&!state.repairRequired;
  const connection = !state.online?'Sin red':
    state.repairRequired?'Dispositivo revocado':
    !authed?(linked?'Conexión pendiente':'Dispositivo sin vincular'):
    state.allError?'Sin datos del backend':
    sourceError||sourcesPartial?'Conectado · datos parciales':'Conectado';
  $('statusline').innerHTML =
    `<span class="dot ${cls}"></span><span>${esc(connection)}</span>`+
    (!authed?(linked?`<button data-app="refresh" class="nx-status-link">Reintentar conexión ↻</button>`:
      `<button data-app="pair-device" class="nx-status-link">Vincular ahora ›</button>`):
      sourceError||sourcesPartial?`<button data-app="refresh" class="nx-status-link">Reintentar ↻</button>`:'')+
    `<span class="nx-status-right">NEXA · ${state.viewScope==='shadow'?'SHADOW':'REAL'} · ${state.mode==='basic'?'Básico':'Pro'}</span>`;
}

// ---------- Sub-renderer de motor ----------
function renderEngineSub(engineId, subtab){
  const eng = state.enginesData?.[engineId] ?? {state:'unavailable', data:{}};
  if(eng.state && !['ok','partial','stale'].includes(eng.state)){
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
  // 'stale' = la última recarga falló pero se muestran los últimos datos
  // válidos, con su antigüedad. 'partial' = lectura incompleta del backend.
  const stale=eng.state==='stale'?`<div class="banner warn">Lectura anterior (${esc(fmtAge(eng.readAt))}): el último intento de actualización falló; se muestran los últimos datos válidos.</div>`:'';
  const partial=eng.state==='partial'?'<div class="nx-subview-partial">Lectura parcial: algunos endpoints pueden no estar autorizados o disponibles. Los datos confirmados sí se muestran; los ausentes no equivalen a cero.</div>':'';
  return fn ? stale+partial+fn(ctx) : `<div class="banner warn">Subvista no implementada: ${esc(engineId)}/${esc(subtab)}</div>`;
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
    state.detail=null;
    state.nav={depth:2,section:'engines',sub:b.dataset.pickEngine,inner:'panel'};
    pushNav(); modal.close(); render();
  }));
}

// ---------- Acciones de gestión autenticadas ----------
function openAction(actionId, params){
  const a = ACTIONS[actionId];
  if(!a) return;
  if(state.viewScope==='shadow')return openModal('<h3>Modo SHADOW: sin órdenes reales</h3><p>Las acciones de trading están bloqueadas desde esta vista de simulación. Cambiar a REAL tampoco autoriza acciones sin permisos del servidor.</p>');
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
  // TANGO-5 §10.3: cada gesto de confirmación es una operación NUEVA con seed
  // propio — una repetición intencionada (mismo payload) nunca se confunde con
  // la anterior. Los reintentos del mismo gesto (timeout, re-toque) conservan el seed.
  const gestureSeed = `g-${Date.now().toString(36)}-${crypto.getRandomValues(new Uint32Array(2))[0].toString(36)}`;
  modal.root.querySelector('#act-cancel').addEventListener('click',()=>modal.close());
  modal.root.querySelector('#act-run').addEventListener('click', async ev=>{
    if(dbl && modal.root.querySelector('#act-confirm').value!=='CONFIRMAR'){
      modal.root.querySelector('#act-result').textContent='Escribe CONFIRMAR.'; return;
    }
    ev.target.disabled = true;
    const r = await runAction(actionId, params, { operationSeed: gestureSeed });
    modal.root.querySelector('#act-result').innerHTML = r.ok
      ? `<span class="pos">Aceptada (HTTP ${r.status||200})</span>`
      : `<span class="neg">Rechazada: ${esc(r.error||'error')}${r.status?` (HTTP ${r.status})`:''}</span>`;
    if(r.ok) setTimeout(()=>{ modal.close(); loadData().then(render); }, 1200);
  });
}

// Registro de una compra EXTERNA YA EJECUTADA. No coloca órdenes en el exchange.
function openManualBuyForm(cycleId){
  const cycle=state.enginesData.idca?.data?.cycles?.find(c=>String(c.id)===String(cycleId));
  if(!cycle)return openModal('<h3>Ciclo no disponible</h3><p>No se ha verificado el ciclo en esta lectura.</p>');
  if(!canDo('idca.manualBuy'))return openModal('<h3>Acceso restringido</h3><p>Se necesita autorización IDCA para registrar compras.</p>');
  const modal=openModal('<div class="nx-manual-form"><h2>Registrar compra externa · #'+esc(cycleId)+'</h2>'+
    '<p>Solo úsalo para una compra <b>ya ejecutada</b> en el exchange. No es una orden de compra.</p>'+
    '<label>Precio ejecutado USD <input type="number" id="nm-price" min="0.00000001" step="any"></label>'+
    '<label>Cantidad de cripto <input type="number" id="nm-qty" min="0.00000001" step="any"></label>'+
    '<label>Importe ejecutado USD <input type="number" id="nm-value" min="0.01" step="any"></label>'+
    '<label>Comisiones USD <input type="number" id="nm-fee" min="0" step="any"></label>'+
    '<label>Fecha y hora de ejecución <input type="datetime-local" id="nm-date"></label>'+
    '<label>Exchange <select id="nm-exchange"><option value="">Seleccionar…</option>'+
    '<option value="kraken">Kraken</option><option value="revolut_x">Revolut X</option>'+
    '<option value="bit2me">Bit2Me</option><option value="manual_external">Externo/manual</option>'+
    '<option value="other">Otro</option></select></label>'+
    '<label>Referencia externa (opcional) <input id="nm-ref" type="text" maxlength="120"></label>'+
    '<label>Nota (opcional) <input id="nm-note" type="text" maxlength="400"></label>'+
    '<label class="nx-manual-ack"><input type="checkbox" id="nm-ack"> Confirmo que esta compra YA se ejecutó externamente.</label>'+
    '<button type="button" class="btn danger" id="nm-submit">Revisar registro</button>'+
    '<p id="nm-error" role="status"></p></div>');
  const el=id=>modal.root.querySelector('#'+id);
  el('nm-submit').addEventListener('click',()=>{
    const price=Number(el('nm-price').value),quantity=Number(el('nm-qty').value),
      notionalUsd=Number(el('nm-value').value),feesUsd=Number(el('nm-fee').value);
    const date=el('nm-date').value,exchange=el('nm-exchange').value;
    if(!el('nm-ack').checked||!date||!exchange||!(price>0)||!(quantity>0)||
       !(notionalUsd>0)||!el('nm-fee').value.trim()||!Number.isFinite(feesUsd)||feesUsd<0){
      el('nm-error').textContent='Introduce los datos reales de la ejecución y marca la confirmación.';return;
    }
    const executedAt=new Date(date);
    if(!Number.isFinite(executedAt.getTime())){
      el('nm-error').textContent='Fecha y hora no válidas.';return;
    }
    const payload={cycleId,pair:cycle.pair,price,quantity,notionalUsd,feesUsd,
      executedAt:executedAt.toISOString(),exchange,
      externalOrderId:el('nm-ref').value.trim(),note:el('nm-note').value.trim(),
      continueAutomaticManagement:false};
    modal.close();openAction('idca.manualBuy',payload);
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
  // Solo la PRIMERA vinculación, o la revocación explícita, usa código de acceso.
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
  state.enginesData={};state.common={};state.lastGood=null;state.allError=false;
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
      state.lastGood=null; // 'stale' nunca cruza de servidor: los datos del anterior no aplican.
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
  const asset = e.target.closest('[data-asset]');
  if(asset){
    e.preventDefault();const pair=asset.dataset.asset;
    if(pair!=='BTC/USD'&&pair!=='ETH/USD')return;
    state.ui.marketPair=pair;state.detail='asset';pushNav();render();window.scrollTo?.(0,0);return;
  }
  const manage=e.target.closest('[data-manage-cycle]');
  if(manage){
    e.preventDefault();state.ui.cycleId=manage.dataset.manageCycle;
    state.ui.engineId='idca';state.detail='manage-idca';pushNav();render();window.scrollTo?.(0,0);return;
  }
  const subFromManager=e.target.closest('[data-engine-sub]');
  if(subFromManager){e.preventDefault();
    state.detail=null;
    state.nav={depth:2,section:'engines',sub:'idca',inner:subFromManager.dataset.engineSub};
    pushNav();render();window.scrollTo?.(0,0);return;}
  const manual=e.target.closest('[data-manual-buy]');
  if(manual){e.preventDefault();openManualBuyForm(manual.dataset.manualBuy);return;}
  const importButton=e.target.closest('[data-idca-import]');
  if(importButton){e.preventDefault();openImportPositionPreview(state.enginesData.idca);return;}
  // OJO: #app lleva data-scope="real|shadow"; sin 'button' el closest capturaría
  // CUALQUIER click dentro de la app y toda la delegación inferior quedaría muerta.
  const scope=e.target.closest('button[data-scope]');
  if(scope){
    const next=scope.dataset.scope;
    if(next!=='real'&&next!=='shadow')return;
    state.viewScope=next;localStorage.setItem('nexa.viewScope',next);
    render();window.scrollTo?.(0,0);return;
  }
  const inspect = e.target.closest('[data-inspect]');
  if(inspect){ e.preventDefault(); showRecordInspector(state,inspect.dataset.inspect); return; }
  // Ítems de la barra inferior por índice: su significado depende del nivel.
  const nv=e.target.closest('[data-nav-idx]');
  if(nv){
    e.preventDefault();state.detail=null;
    state.nav=navMove(state.nav,Number(nv.dataset.navIdx),state.mode);
    pushNav();render();window.scrollTo?.(0,0);return;
  }
  const nav = e.target.closest('[data-nav]');
  if(nav){ e.preventDefault(); navTo(nav.dataset.nav); return; }
  const ui = e.target.closest('[data-ui]');
  if(ui){
    const [k,v] = ui.dataset.ui.split(':');
    if(k==='subtab'){ state.ui.subtab=v; if(state.nav.depth===2&&state.nav.inner!==v){ state.nav.inner=v; pushNav(); } }
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
    else if(k==='tf'){
      state.ui.marketTf=v;
      render();
      if(session.get()){const pair=state.ui.marketPair||'BTC/USD';
        state.provider.market(pair,v).then(res=>{
          if(state.ui.marketTf!==v)return;
          const pack={state:res.state,data:res.market?.data??null};
          if(state.common.marketPairs)state.common.marketPairs[pair]=pack;
          state.common.market=pack;
          render();
        }).catch(()=>{ state.common.market={state:'error',data:null};render(); });}
      return;
    }
    else if(k==='positionFilter')state.ui.positionFilter=v;
    else if(k==='portfolioTab'){ state.ui.portfolioTab=v;
      if(state.nav.depth===1&&state.nav.section==='portfolio'&&state.nav.sub!==v){ state.nav.sub=v; pushNav(); } }
    else if(k==='fiscoTab'){ state.ui.fiscoTab=v;
      if(state.nav.depth===1&&state.nav.section==='fisco'&&state.nav.sub!==v){ state.nav.sub=v; pushNav(); } }
    else if(k==='sev') state.ui.activityFilter.sev=v;
    else if(k==='eng') state.ui.activityFilter.engine=v;
    else if(k==='cat'){ state.ui.activityFilter.cat=v;
      if(state.nav.depth===1&&state.nav.section==='activity'){
        const inv={all:'recent',executed:'executed',decision:'decision',rejected:'rejected',error:'error',technical:'notices'};
        if(inv[v]&&state.nav.sub!==inv[v]){state.nav.sub=inv[v];pushNav();}
      } }
    render();
    // Cambios de sección (subpestaña de motor, pestaña de cartera/fiscal) son
    // navegación: vuelven arriba para que el título de la sección sea visible.
    if(k==='subtab'||k==='portfolioTab'||k==='fiscoTab')window.scrollTo?.(0,0);
    return;
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
// Modo Básico/Pro = preferencia persistente: NO crea entrada de historial; solo
// se re-sella la entrada actual por si sanitizeNav cambió la ruta (p. ej. Órdenes).
$('mode-basic').addEventListener('click', ()=>{ state.mode='basic'; localStorage.setItem('nexa.mode','basic'); state.nav=sanitizeNav(state.nav,'basic'); stampCurrent(); render(); window.scrollTo?.(0,0); });
$('mode-pro').addEventListener('click', ()=>{ state.mode='pro'; localStorage.setItem('nexa.mode','pro'); state.nav=sanitizeNav(state.nav,'pro'); stampCurrent(); render(); window.scrollTo?.(0,0); });
$('engine-btn').addEventListener('click', openEngineModal);
$('lock-btn').addEventListener('click', lockNow);
$('back').addEventListener('click', backOne);
$('brand-home').addEventListener('click',()=>{ state.detail=null; state.nav=navRoot(); pushNav(); render(); window.scrollTo?.(0,0); });
// Insignia de versión permanente: generada en compilación, visible en todas las pantallas.
(function(){
  const b=$('ver-badge');if(!b)return;
  b.textContent='v'+BUILD_INFO.version+' · '+String(BUILD_INFO.channel||'').toUpperCase();
  b.addEventListener('click',()=>openModal(
    '<h3>Compilación NEXA</h3><div class="nx-inspect-priority">'+
    '<div class="nx-detail-metric"><span>Versión</span><strong>'+esc(BUILD_INFO.version)+'</strong></div>'+
    '<div class="nx-detail-metric"><span>Commit</span><strong class="mono">'+esc(BUILD_INFO.commit)+'</strong></div>'+
    '<div class="nx-detail-metric"><span>Canal</span><strong>'+esc(String(BUILD_INFO.channel).toUpperCase())+'</strong></div>'+
    '<div class="nx-detail-metric"><span>Compilada</span><strong>'+esc(BUILD_INFO.builtAt?BUILD_INFO.builtAt.replace('T',' ').slice(0,16)+' UTC':'—')+'</strong></div>'+
    '<div class="nx-detail-metric"><span>Tipo de APK</span><strong>'+esc(BUILD_INFO.apkType||'—')+'</strong></div>'+
    '</div><p class="small" style="opacity:.75">El sello se genera automáticamente durante la compilación.</p>'));
})();

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
// En la APK (Capacitor) el bundle local ES la fuente de verdad: ningún service
// worker puede servir módulos antiguos restaurados por backup. Se purga
// cualquier registro/caché previa y solo en despliegue web se registra el SW.
(function(){
  const isCap=!!(window.Capacitor||window.webkit?.messageHandlers||/^https?:\/\/localhost$/.test(location.origin));
  if(!('serviceWorker' in navigator))return;
  if(isCap){
    navigator.serviceWorker.getRegistrations().then(rs=>rs.forEach(r=>r.unregister()));
    if(window.caches)caches.keys().then(ks=>ks.forEach(k=>caches.delete(k)));
    return;
  }
  navigator.serviceWorker.register('sw.js').catch(()=>{});
})();

// ---------- Boot ----------
(async function boot(){
  pinInit();
  render();
  stampCurrent(); // el estado de arranque también es restaurable vía popstate
  // Gate: PIN setup/unlock → sesión por challenge o pairing → app.
  await showUnlock();
})();
