// NEXA V2 — shell: router, navegación, Básico/Pro, PIN local, proveedor de datos.
import { ENGINES, ENGINE_SUBTABS } from './contracts.js';
import { createDemoProvider, createLiveProvider, DATA_MODE } from './provider.js';
import { esc, fmtAge } from './util.js';
import { clear, h, badge, openModal } from './ui.js';
import * as S from './screens.js';

// ---------- Estado global ----------
const state = {
  mode: localStorage.getItem('nexa.mode') || 'pro',      // basic | pro  (solo presentación)
  screen: 'home',
  ui: { engineId:'idca', subtab:'panel', marketPair:'BTC/USD',
    activityFilter:{ sev:'all', engine:'all' } },
  provider: createDemoProvider(),
  apiBase: localStorage.getItem('nexa.apiBase') || '',
  online: navigator.onLine !== false,
  locked: true,
  dataTag: 'DEMO',
  demoCache: {},
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
  const [market, portfolio, activity, fisco, settings] = await Promise.all([
    p.market(), p.portfolio(), p.activity(), p.fisco(), p.settings(),
  ]);
  const enginesData = {};
  for(const e of ENGINES){ enginesData[e.id] = await p.engine(e.id); }
  state.demoCache = { market, portfolio, activity, fisco, settings };
  state.enginesData = enginesData;
}

// ---------- Render ----------
const $ = id => document.getElementById(id);
function render(){
  const scr = $('screen');
  const ctx = {
    mode: state.mode, ui: state.ui, engineList: ENGINES,
    enginesData: state.enginesData, data: state.demoCache,
    dataTag: state.dataTag, market: state.demoCache.market,
    subtabs: ENGINE_SUBTABS[state.ui.engineId] || [],
    renderEngineSub, ctxBridge(){ window.__nexa = { ctx: this }; },
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
  const on = navTarget().split(':')[0];
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
  const dotCls = state.online ? (state.provider.mode===DATA_MODE.DEMO?'warn':'') : 'err';
  $('statusline').innerHTML =
    `<span class="dot ${dotCls}"></span>`+
    `<span>${esc(state.provider.label)}</span>`+
    `<span>·</span><span>vista ${state.mode==='basic'?'Básico':'Pro'} (solo presentación)</span>`+
    `<span>·</span><span>${state.online?'en línea':'offline'}</span>`+
    `<span>·</span><span>obs ${esc(fmtAge(state.demoCache?.market?.ts))}</span>`+
    (state.provider.mode===DATA_MODE.DEMO?`<span>·</span><span class="warn-tx">DEMO — sin datos reales</span>`:'');
}

// ---------- Sub-renderer de motor ----------
function renderEngineSub(engineId, subtab){
  const data = state.enginesData?.[engineId]?.data ?? {};
  const ctx = { mode: state.mode, ui: state.ui, data, dataTag: state.dataTag };
  const fn = {
    idca: { panel:S.idcaPanel, cycles:S.idcaCycles, history:S.idcaHistory, orders:S.idcaOrders, hybrid:S.idcaHybrid, config:S.idcaConfig, alerts:S.idcaAlerts },
    spot: { panel:S.spotPanel, positions:S.spotPositions, history:S.spotHistory, protections:S.spotProtections, config:S.spotConfig },
    grid: { panel:S.gridPanel, cycles:S.gridCycles, levels:S.gridLevels, monitor:S.gridMonitor, config:S.gridConfig },
    ama:  { panel:S.amaPanel, readiness:S.amaReadiness, mandate:S.amaMandate, trace:S.amaTrace, lab:S.amaLab, config:S.amaConfig },
  }[engineId]?.[subtab];
  return fn ? fn(ctx) : `<div class="banner warn">Subvista no implementada: ${esc(engineId)}/${esc(subtab)}</div>`;
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

// ---------- Acciones demo protegidas ----------
function demoAction(a){
  openModal(`<h3>Acción protegida (prototipo)</h3>
    <p class="small">La acción <b>${esc(a)}</b> requeriría confirmación explícita y autorización del backend propietario del motor. En este prototipo no se ejecuta nada.</p>
    <div class="btn-row" style="margin-top:14px"><button class="btn" id="demo-cancel">Entendido</button></div>`)
    .root.querySelector('#demo-cancel')?.addEventListener('click',e=>e.target.closest('.modal-root')?.classList.add('hidden'));
}

// ---------- PIN local (demostración) ----------
const PIN = { len:4, expected:'2468', tries:0, lockUntil:0 };
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
let pinBuf='';
function pinKey(k){
  if(Date.now()<PIN.lockUntil){ $('pin-err').textContent='Bloqueado unos segundos…'; return; }
  if(k==='⌫'){ pinBuf=pinBuf.slice(0,-1); }
  else if(pinBuf.length<PIN.len){ pinBuf+=k; }
  pinDraw();
  if(pinBuf.length===PIN.len) pinCheck();
}
function pinDraw(){
  $('pin-dots').innerHTML = Array.from({length:PIN.len},(_,i)=>`<i class="${i<pinBuf.length?'on':''}"></i>`).join('');
}
async function pinCheck(){
  const digest = await sha256(pinBuf);
  const ok = digest === await sha256(PIN.expected);
  if(ok){ $('pin-overlay').classList.add('hidden'); pinBuf=''; pinDraw(); PIN.tries=0; state.locked=false; render(); }
  else{
    PIN.tries++; pinBuf=''; pinDraw();
    $('pin-err').textContent = `PIN incorrecto (${PIN.tries}/5)`;
    if(PIN.tries>=5){ PIN.lockUntil=Date.now()+15000; PIN.tries=0; }
  }
}
async function sha256(s){
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
function lockNow(){ state.locked=true; pinBuf=''; pinDraw(); $('pin-err').textContent=''; $('pin-overlay').classList.remove('hidden'); }

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
  const act = e.target.closest('[data-demo-action]');
  if(act){ demoAction(act.dataset.demoAction); return; }
});
$('mode-basic').addEventListener('click', ()=>{ state.mode='basic'; localStorage.setItem('nexa.mode','basic'); render(); });
$('mode-pro').addEventListener('click', ()=>{ state.mode='pro'; localStorage.setItem('nexa.mode','pro'); render(); });
$('engine-btn').addEventListener('click', openEngineModal);
$('lock-btn').addEventListener('click', lockNow);
window.addEventListener('online',  ()=>{ state.online=true; renderStatusline(); });
window.addEventListener('offline', ()=>{ state.online=false; renderStatusline(); });

// PWA
if('serviceWorker' in navigator){ navigator.serviceWorker.register('sw.js').catch(()=>{}); }

// ---------- Boot ----------
(async function boot(){
  pinInit();
  await loadData();
  render();
  // PIN al arranque (demostración): mostrar overlay bloqueado por defecto
  if(state.locked){ lockNow(); }
})();
