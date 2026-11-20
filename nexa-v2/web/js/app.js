// NEXA V2 — shell definitivo: router, Básico/Pro, sesión servidor + desbloqueo local,
// proveedor API real y acciones de gestión autenticadas. Sin datos DEMO en el producto.
import { ENGINES, ENGINE_SUBTABS } from './contracts.js';
import { createApiProvider } from './provider.js';
import { CONFIG, setApiBase } from './config.js';
import { session, login, logout, localLock } from './auth.js';
import { ACTIONS, runAction, canDo, confirmText, needsDouble } from './actions.js';
import { esc, fmtAge } from './util.js';
import { clear, h, badge, openModal } from './ui.js';
import * as S from './screens.js';

// ---------- Estado global ----------
const state = {
  mode: localStorage.getItem('nexa.mode') || 'pro',      // basic | pro  (solo presentación)
  screen: 'home',
  ui: { engineId:'idca', subtab:'panel', marketPair:'BTC/USD',
    activityFilter:{ sev:'all', engine:'all' } },
  provider: createApiProvider(),
  online: navigator.onLine !== false,
  unlocked: !localLock.isSet(),
  common: {},          // market/portfolio/activity/fisco normalizados
  enginesData: {},     // { id: { state, data } }
  refreshTimer: null,
};

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
  if(target.startsWith('engine:')){ state.ui.engineId = target.slice(7); state.screen='engines'; }
  else state.screen = target;
  render();
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
  state.common = {
    market: { state: market.state, data: market.market?.data ?? null },
    portfolio: { state: portfolio.state, data: { summary: portfolio.summary?.data ?? null, holdings: portfolio.holdings?.data ?? [] } },
    activity: { state: activity.state, data: { events: activity.events?.data ?? [] } },
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
  document.getElementById('mode-basic').classList.toggle('on', state.mode==='basic');
  document.getElementById('mode-pro').classList.toggle('on', state.mode==='pro');
  document.getElementById('engine-name').textContent =
    ENGINES.find(e=>e.id===state.ui.engineId)?.name || 'Motor';
  scr.focus({preventScroll:true});
}
function renderNav(){
  const cur = state.screen;
  $('topnav').innerHTML = NAV.filter(n=>n.id!=='engines').map(n=>
    `<a href="#${n.id}" data-nav="${n.id}" class="${cur===n.id?'on':''}">${esc(n.label)}</a>`).join('')
    + `<a href="#engines" data-nav="engines" class="${cur==='engines'?'on':''}">Motores</a>`;
  $('bottomnav').innerHTML = BOTTOM_NAV.map(id=>{
    const n = NAV.find(x=>x.id===id);
    const active = cur===id || (id==='engines'&&cur==='engines');
    return `<a href="#${id}" data-nav="${id}" class="${active?'on':''}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="${n.icon}"/></svg>${esc(n.label)}</a>`;
  }).join('');
}
function renderStatusline(){
  const s = session.get();
  const states = Object.values(state.enginesData).map(e=>e.state);
  const bad = states.includes('unavailable')||states.includes('unreachable')||states.includes('error');
  const dotCls = !state.online ? 'err' : (s ? (bad?'warn':'') : 'warn');
  const authTxt = s ? `sesión ${esc(s.user||'')}` : 'sin sesión';
  $('statusline').innerHTML =
    `<span class="dot ${dotCls}"></span>`+
    `<span>API ${esc(CONFIG.apiBase)}</span>`+
    `<span>·</span><span>${authTxt}</span>`+
    `<span>·</span><span>vista ${state.mode==='basic'?'Básico':'Pro'}</span>`+
    `<span>·</span><span>${state.online?'en línea':'offline'}</span>`+
    (bad?`<span>·</span><span class="warn-tx">datos parciales/no disponibles</span>`:'');
}

// ---------- Sub-renderer de motor ----------
function renderEngineSub(engineId, subtab){
  const eng = state.enginesData?.[engineId] ?? {state:'unavailable', data:{}};
  if(eng.state && eng.state!=='ok'){
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
  return fn ? fn(ctx) : `<div class="banner warn">Subvista no implementada: ${esc(engineId)}/${esc(subtab)}</div>`;
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

// ---------- Login de sesión ----------
function showLogin(){
  const ov = $('login-overlay');
  ov.classList.remove('hidden');
  $('login-err').textContent='';
  $('login-api').textContent = CONFIG.apiBase;
}
async function doLogin(){
  const user = $('login-user').value.trim(), pass = $('login-pass').value;
  $('login-err').textContent='Conectando…';
  const r = await login(user, pass);
  if(r.ok){
    $('login-overlay').classList.add('hidden');
    await loadData(); render(); scheduleRefresh();
  }else{
    $('login-err').textContent = r.status===0 ? 'Backend inaccesible ('+CONFIG.apiBase+')'
      : `Acceso denegado (${r.status}): ${r.error||'credenciales'}`;
  }
}
function skipLogin(){
  // Explorar sin sesión: la UI muestra estados honestos, ningún dato inventado.
  $('login-overlay').classList.add('hidden');
  loadData().then(render);
}

// ---------- Desbloqueo local (2ª capa, elegido por el usuario) ----------
let pinBuf='';
function pinInit(){
  const pad = $('pin-pad');
  const keys = ['1','2','3','4','5','6','7','8','9','','0','⌫'];
  pad.innerHTML = keys.map(k=>k===''?'<span></span>':`<button data-key="${k}">${k}</button>`).join('');
  pad.addEventListener('click', e=>{
    const k = e.target.closest('button')?.dataset.key;
    if(k!==undefined) pinKey(k);
  });
  document.addEventListener('keydown', e=>{
    if($('pin-overlay').classList.contains('hidden')) return;
    if(/^[0-9]$/.test(e.key)) pinKey(e.key);
    if(e.key==='Backspace') pinKey('⌫');
  });
}
function pinKey(k){
  if(k==='⌫'){ pinBuf=pinBuf.slice(0,-1); }
  else if(pinBuf.length<8){ pinBuf+=k; }
  pinDraw();
  if(pinBuf.length>=4) pinCheck();
}
function pinDraw(){
  $('pin-dots').innerHTML = Array.from({length:Math.max(4,pinBuf.length||4)},(_,i)=>`<i class="${i<pinBuf.length?'on':''}"></i>`).join('');
}
async function pinCheck(){
  if(!localLock.isSet()){
    // Primer uso: el usuario define su PIN de desbloqueo local (4–8 dígitos).
    if(pinBuf.length>=4){ await localLock.setup(pinBuf); $('pin-overlay').classList.add('hidden'); pinBuf=''; pinDraw(); }
    return;
  }
  const ok = await localLock.verify(pinBuf);
  if(ok){ $('pin-overlay').classList.add('hidden'); pinBuf=''; pinDraw(); }
  else{ pinBuf=''; pinDraw(); $('pin-err').textContent='PIN incorrecto'; }
}
function lockNow(){
  if(!localLock.isSet()) return; // sin PIN local no hay nada que bloquear
  pinBuf=''; pinDraw(); $('pin-err').textContent=''; $('pin-overlay').classList.remove('hidden');
}

// ---------- Ajustes: backend y sesión ----------
function openSettingsApi(){
  const modal = openModal(`<h3>Conexión backend</h3>
    <p class="small">URL base de la API del bot. Sin credenciales aquí.</p>
    <input id="api-base" class="inp" value="${esc(CONFIG.apiBase)}" placeholder="/api o https://host/api">
    <div class="btn-row" style="margin-top:12px"><button class="btn" id="api-save">Guardar y reconectar</button></div>`);
  modal.root.querySelector('#api-save').addEventListener('click',()=>{
    setApiBase(modal.root.querySelector('#api-base').value.trim());
    modal.close(); loadData().then(render);
  });
}
function scheduleRefresh(){
  clearInterval(state.refreshTimer);
  state.refreshTimer = setInterval(()=>{ if(session.get()) loadData().then(render); }, 30000);
}

// ---------- Eventos globales ----------
document.addEventListener('click', e=>{
  const nav = e.target.closest('[data-nav]');
  if(nav){ e.preventDefault(); navTo(nav.dataset.nav); return; }
  const ui = e.target.closest('[data-ui]');
  if(ui){
    const [k,v] = ui.dataset.ui.split(':');
    if(k==='subtab') state.ui.subtab=v;
    else if(k==='marketPair') state.ui.marketPair=v;
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
    if(k==='settings-api') openSettingsApi();
    else if(k==='logout'){ logout(); location.reload(); }
    else if(k==='refresh'){ loadData().then(render); }
    return;
  }
});
$('mode-basic').addEventListener('click', ()=>{ state.mode='basic'; localStorage.setItem('nexa.mode','basic'); render(); });
$('mode-pro').addEventListener('click', ()=>{ state.mode='pro'; localStorage.setItem('nexa.mode','pro'); render(); });
$('engine-btn').addEventListener('click', openEngineModal);
$('lock-btn').addEventListener('click', lockNow);
$('login-btn').addEventListener('click', doLogin);
$('login-pass').addEventListener('keydown', e=>{ if(e.key==='Enter') doLogin(); });
$('login-skip').addEventListener('click', skipLogin);
window.addEventListener('online',  ()=>{ state.online=true; renderStatusline(); });
window.addEventListener('offline', ()=>{ state.online=false; renderStatusline(); });

// PWA
if('serviceWorker' in navigator){ navigator.serviceWorker.register('sw.js').catch(()=>{}); }

// ---------- Boot ----------
(async function boot(){
  pinInit();
  render();
  if(localLock.isSet() && !state.unlocked){
    $('pin-overlay').classList.remove('hidden');
  }
  if(!session.get()){ showLogin(); }
  else{ await loadData(); render(); scheduleRefresh(); }
})();
