// NEXA V2 — sección C issue #18 + hallazgos Pixel.
// Fixtures con la forma REAL capturada del VPS (2026-11-20):
//  - grid-isolated/status {mode:'SHADOW',activeRangeVersionId:null} + cycles
//  - ama/status {mode:'OFF',state:'OBSERVING',pair:'BTC/USD'}
//  - spot open-positions [] + trades/closed global
//  - fisco summary/operations/lots/disposals/annual-report/meta/control-status
import test from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'web');
globalThis.location??={search:'',protocol:'https:',pathname:'/'};
globalThis.window??={Capacitor:null};
globalThis.sessionStorage??={getItem:()=>null,setItem(){},removeItem(){}};
globalThis.localStorage??={getItem:()=>null,setItem(){},removeItem(){}};
const imp = p => import(pathToFileURL(join(web, 'js', p)));
const { renderScopedEngine } = await imp('scoped-pages.js');
const { renderFiscalView } = await imp('fisco-view.js');
const { createApiProvider } = await imp('provider.js');

const ctx = (engineId, subtab, enginesData, mode='basic', viewScope='real') => ({
  viewScope, mode,
  ui:{ engineId, subtab },
  enginesData,
  data:{},
});

// ---------- Fixtures con forma real del VPS ----------
const GRID_STATUS = {
  mode:'SHADOW', activeRangeVersionId:null, activeRangeStatus:'none',
  pair:'BTC/USD', openCycles:2, openLevels:5, plannedLevelsCount:7,
  totalNetPnlUsd:9.81, capitalReservedUsd:980.40, capitalAvailableUsd:39.20,
  capitalBudgetUsd:2000, capitalUsedUsd:980.40,
  pumpDumpState:'none', circuitBreakerOpen:false,
  unlock:{ realLimited:false, realFull:false,
    checksPass:['shadow_consistency','maker_only','no_live_keys'],
    checksFail:['real_authorized'] },
};
const GRID_CYCLES = [
  // Ciclo cerrado con compra y venta ejecutadas + comisiones → neto calculable.
  { id:'gc_1', cycleNumber:41, pair:'BTC/USD', status:'completed',
    buyPrice:96000, sellPrice:97020, targetSellPrice:97020,
    quantity:0.005, targetSellQuantity:0.005,
    feeTotalUsd:0.18, netPnlUsd:4.92,
    buyFilledAt:'2026-11-19T10:00:00Z', sellFilledAt:'2026-11-19T14:00:00Z' },
  // Ciclo abierto: solo compra ejecutada, venta aún es objetivo → '—' honesto.
  { id:'gc_2', cycleNumber:42, pair:'BTC/USD', status:'buy_filled',
    buyPrice:97800, sellPrice:null, targetSellPrice:98700,
    quantity:0.0051, targetSellQuantity:0.0051,
    feeTotalUsd:0.09, netPnlUsd:null,
    buyFilledAt:'2026-11-20T08:00:00Z', sellFilledAt:null },
];
const gridEngines = extra=>({
  grid:{ state:'ok', data:{ status:GRID_STATUS, cycles:GRID_CYCLES,
    events:[{id:'ge1',ts:'2026-11-20T09:00:00Z',type:'GRID_LEVEL_FILLED',msg:'Nivel ejecutado'}],
    monitor:{ events:[{id:'gm1',ts:'2026-11-20T09:30:00Z',type:'monitor_tick',msg:'tick'}] },
    ...extra } },
});

const AMA_DATA = {
  status:{ mode:'OFF', state:'OBSERVING', pair:'BTC/USD', killSwitchActive:false },
  mandate:{ status:'active', scoring:{ macroScore:0.31, threshold:0.55 },
    explanation:'No compra: score macro 0.31 < umbral 0.55; mandato permite solo SHADOW.' },
  readiness:{ readyCount:12, totalCount:16,
    checks:[{id:'gateway',label:'Gateway bid/ask',ok:false},{id:'schema',label:'Esquema DB',ok:true}],
    blockers:['gateway sin bid/ask válido (demo)'] },
  portfolio:{ budgetUsd:3000, freeUsd:3000, exposureUsd:0 },
  tranches:[{id:'tr_1',state:'reserved'}],
  cycles:[{id:'ac_1',state:'shadow'}],
  trace:{ decisions:[{id:'ad1',ts:'2026-11-20T09:15:00Z',type:'decision',msg:'skip: macroScore<threshold'}] },
};

test('Estado GRID es resumen: no repite el historial de ciclos', () => {
  const html = renderScopedEngine(ctx('grid','panel',gridEngines(), 'basic', 'shadow'));
  assert.match(html, /Resumen del motor/);
  assert.match(html, /Ciclos abiertos/);
  assert.match(html, /Condiciones pendientes para ejecutar en real/);
  assert.match(html, /Autorización de ejecución real/); // check traducido, no 'real_authorized'
  // El historial completo NO está en Estado:
  assert.ok(!html.includes('data-inspect="grid:cycles'), 'Estado aún lista ciclos');
  assert.ok(!html.includes('TRAMO BUY'), 'Estado aún muestra tramos');
  // …pero sigue accesible en su subpestaña:
  const cycles = renderScopedEngine(ctx('grid','cycles',gridEngines(), 'basic', 'shadow'));
  assert.ok(cycles.includes('TRAMO BUY') && cycles.includes('TRAMO SELL'), 'subpestaña cycles sin tramos');
  assert.ok(cycles.includes('data-inspect="grid:cycles:0'), 'ficha de ciclo ausente');
});

test('Tramo GRID: ganancia neta solo cuando es calculable con datos reales', () => {
  const html = renderScopedEngine(ctx('grid','cycles',gridEngines(), 'basic', 'shadow'));
  // Ciclo cerrado: (97020−96000)*0.005 − 0.18 = 4.92 → neto calculado/registrado.
  assert.ok(html.includes('+$4,92') || html.includes('$4,92'), 'neto del ciclo cerrado no visible');
  // Ciclo abierto: venta solo objetivo → '—' honesto, nunca inventado.
  const openPart = html.split('gc_2').length ? html : html;
  assert.match(html, /La venta aún no se ha ejecutado; solo hay objetivo/);
  assert.match(html, /Objetivo de venta/);
  // El código crudo solo en Pro:
  const pro = renderScopedEngine(ctx('grid','cycles',gridEngines(), 'pro', 'shadow'));
  assert.ok(pro.includes('<code class="nxs-code">buy_filled</code>') || pro.includes('buy_filled'),
    'Pro debería conservar el código técnico');
});

test('Estado AMA OFF/OBSERVING: castellano en Básico, código solo en Pro', () => {
  const basic = renderScopedEngine(ctx('ama','panel',
    { ama:{ state:'ok', data:AMA_DATA } }, 'basic', 'shadow'));
  assert.match(basic, /Observando/);
  assert.match(basic, /Apagado|score macro 0,31 \/ umbral 0,55|0.31 \/ 0.55/);
  assert.match(basic, /Condiciones pendientes para actuar/);
  assert.match(basic, /Gateway bid\/ask/);
  // 'OFF'/'OBSERVING' crudos no deben aparecer como texto principal en Básico:
  assert.ok(!/>OFF</.test(basic) && !/>OBSERVING</.test(basic), 'código crudo visible en Básico');
  const pro = renderScopedEngine(ctx('ama','panel',
    { ama:{ state:'ok', data:AMA_DATA } }, 'pro', 'shadow'));
  assert.ok(pro.includes('OBSERVING'), 'Pro debe conservar el código técnico');
});

test('Estado SPOT con posiciones vacías y trades globales: honesto, sin ceros falsos', () => {
  const html = renderScopedEngine(ctx('spot','panel',{
    spot:{ state:'ok', data:{ status:{ mode:'dry-run', strategy:'momentum', pairs:['BTC/USD'] },
      positions:[], trades:[{id:'t1',pair:'BTC/USD',mode:'dry-run'}] } },
  }, 'basic', 'shadow'));
  assert.match(html, /Posiciones abiertas/);
  assert.match(html, /No hay posiciones abiertas/);
  assert.match(html, /origen no atribuido/);
});

// ---------- provider: resourceStates + partial ----------
const okJson = data => ({ ok:true, status:200, json:async()=>data });
const errJson = status => ({ ok:false, status, json:async()=>({}) });
function mockFetch(map){
  return async url => {
    const path = new URL(url, 'https://local.test').pathname.replace(/^\/api/, '');
    const hit = map[path];
    if(!hit) return errJson(404);
    return typeof hit==='function' ? hit() : okJson(hit);
  };
}

test('provider.grid: resourceStates por sub-recurso y partial si falla un GET', async () => {
  const base = {
    '/grid-isolated/status': { mode:'SHADOW', activeRangeVersionId:null },
    '/grid-isolated/levels': { levels:[] },
    '/grid-isolated/cycles': [],
    '/grid-isolated/events': [],
    '/grid-isolated/config': {},
    '/grid-isolated/monitor/audit': {},
  };
  const prev = globalThis.fetch;
  try {
    globalThis.fetch = mockFetch(base);
    const all = await createApiProvider().grid();
    assert.equal(all.state, 'ok');
    assert.equal(all.resourceStates.status, 'ok');
    assert.equal(all.resourceStates.cycles, 'ok');
    assert.equal(all.resourceStates.monitor, 'ok');

    globalThis.fetch = mockFetch({ ...base, '/grid-isolated/cycles': () => errJson(500) });
    const part = await createApiProvider().grid();
    assert.equal(part.state, 'partial', 'grid sin resourceStates no degrada a partial');
    assert.equal(part.resourceStates.cycles, 'error');
    assert.equal(part.resourceStates.events, 'ok');
    assert.equal(part.cycles.data, null, 'ciclos fallidos no deben leerse como lista vacía');
  } finally { globalThis.fetch = prev; }
});

test('provider.ama: resourceStates completo y partial si falla ledger/events', async () => {
  const base = {
    '/ama/status': { mode:'OFF', state:'OBSERVING', pair:'BTC/USD' },
    '/ama/mandate': { status:'active' },
    '/ama/tranche-plan/current': [],
    '/ama/cycles': [],
    '/ama/readiness': { readyCount:1, totalCount:2, checks:[], blockers:[] },
    '/ama/portfolio': { budgetUsd:3000 },
    '/ama/events': [],
    '/ama/ledger': [],
  };
  const prev = globalThis.fetch;
  try {
    globalThis.fetch = mockFetch(base);
    const all = await createApiProvider().ama();
    assert.equal(all.state, 'ok');
    for (const k of ['status','mandate','tranches','cycles','readiness','portfolio','events','ledger'])
      assert.equal(all.resourceStates[k], 'ok', `falta resourceStates.${k}`);

    globalThis.fetch = mockFetch({ ...base, '/ama/ledger': () => errJson(503), '/ama/events': () => errJson(500) });
    const part = await createApiProvider().ama();
    assert.equal(part.state, 'partial');
    assert.equal(part.resourceStates.ledger, 'error');
    assert.equal(part.resourceStates.events, 'error');
    assert.equal(part.trace.data.decisions, null, 'sin /ama/events las decisiones deben ser null, no []');
  } finally { globalThis.fetch = prev; }
});

// ---------- FISCO ----------
const FISCO_DATA = {
  summary:{ years:[{year:2026,total_gain_loss_eur:234.5,total_fees_eur:12}] },
  operations:{ operations:[{id:8,asset:'BTC',op_type:'trade_sell',total_eur:230}], total:1 },
  lots:{ lots:[{id:3,asset:'BTC',cost_eur:5000}] },
  disposals:{ disposals:[], total_gain_loss_eur:90 },
  annualReport:{ year:2026, is_safe_for_report:true, critical_errors_count:0,
    last_sync:'2026-11-20T08:00:00Z', section_a:{ganancias_eur:200} },
  finalizationStatus:{ report_can_be_finalized:true, blockers:[] },
  meta:{ availableYears:[2025,2026], totalOperations:419,
    lastSync:'2026-11-20T10:00:00Z', exchanges:['kraken','revolutx'] },
  controlStatus:{ status:'ok', lastSync:'2026-11-20T09:30:00Z' },
};

test('FISCO: meta y control-status se muestran con datos reales', () => {
  const fiscoCtx = {
    viewScope:'real', mode:'basic', ui:{ fiscoTab:'summary' },
    data:{ fisco:{ state:'ok', data:FISCO_DATA,
      resourceStates:{ summary:'ok', operations:'ok', lots:'ok', disposals:'ok',
        annualReport:'ok', finalizationStatus:'ok', meta:'ok', controlStatus:'ok' } } },
  };
  const summary = renderFiscalView(fiscoCtx);
  assert.match(summary, /Fuente y sincronización/);
  assert.match(summary, /2025, 2026|2025,2026/);
  assert.match(summary, /419/);
  assert.match(summary, /kraken/);
  const validation = renderFiscalView({ ...fiscoCtx, ui:{ fiscoTab:'validation' } });
  assert.match(validation, /Estado de control/);
  assert.match(validation, /controlStatus/);
});

test('provider.fisco: pide control-status y lo expone en data/resourceStates', async () => {
  const prevFetch = globalThis.fetch, prevStore = globalThis.sessionStorage;
  const routes = {
    '/fisco/summary': FISCO_DATA.summary,
    '/fisco/operations': FISCO_DATA.operations,
    '/fisco/lots': FISCO_DATA.lots,
    '/fisco/disposals': FISCO_DATA.disposals,
    '/fisco/annual-report': FISCO_DATA.annualReport,
    '/fisco/finalization-status': FISCO_DATA.finalizationStatus,
    '/fisco/meta': FISCO_DATA.meta,
    '/fisco/control-status': FISCO_DATA.controlStatus,
  };
  globalThis.fetch = mockFetch(routes);
  // Rol fiscal requerido por provider.fisco (sessionStorage → session.get()).
  globalThis.sessionStorage = {
    getItem: k => k==='nexa.session' ? JSON.stringify({ token:'t', expiresAt:Date.now()+60000, roles:['fisco:read'] }) : null,
    setItem(){}, removeItem(){},
  };
  try {
    const r = await createApiProvider().fisco();
    assert.equal(r.state, 'ok');
    assert.equal(r.resourceStates.controlStatus, 'ok');
    assert.equal(r.data.controlStatus.status, 'ok');
    assert.equal(r.data.meta.totalOperations, 419);
  } finally { globalThis.fetch = prevFetch; globalThis.sessionStorage = prevStore; }
});
