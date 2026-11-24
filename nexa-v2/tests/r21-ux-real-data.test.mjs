// NEXA V2 R21 — regresiones UX con datos reales del Pixel 9:
//  1) Mercado con ticker sin velas (state 'partial') muestra precio y Δ honesto.
//  2) Actividad vacía en /notifications pero con eventos de motor → se muestran.
//  3) Estado IDCA muestra la decisión del bot desde entry-diagnostics.
//  4) Una sola navegación: sin tiras interiores duplicadas (.nxs-tabs/.nxw-tabs).
//  5) Filtros de Actividad envuelven (CSS) — verificado aquí por markup+CSS.
//  6) marketStatus prioriza la decisión, no un muro de campos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'web');
// config.js (vía provider.js) lee location al importar: stub mínimo como en
// scope-portfolio-fisco-import.test.mjs.
globalThis.location??={search:'',protocol:'https:',pathname:'/'};
globalThis.window??={Capacitor:null};
globalThis.sessionStorage??={getItem:()=>null,setItem(){},removeItem(){}};
globalThis.localStorage??={getItem:()=>null,setItem(){},removeItem(){}};
const imp = p => import(pathToFileURL(join(web, 'js', p)));
const { renderMarketPremium } = await imp('premium.js');
const { renderDashboard } = await imp('dashboard.js');
const { renderScopedEngine, renderScopedActivity, collectActivity } = await imp('scoped-pages.js');
const { engineTabs } = await imp('nav-model.js');
const { entryContexts } = await imp('provider.js');

// Ticker real capturado del backend antiguo: SOLO precio/volumen, sin velas.
const TICKER = { id:'BTC/USD', pair:'BTC/USD', price:60444.8, volume24h:5801.86,
  change24h:0, timestamp:'2026-11-20T10:00:00Z' };
const marketCtx = mode => ({
  mode, viewScope:'real', authenticated:true,
  ui:{ marketPair:'BTC/USD', marketSub:'price' },
  data:{ market:{ state:'partial', data:TICKER },
    marketPairs:{ 'BTC/USD':{ state:'partial', data:TICKER } } },
  enginesData:{},
});

test('Mercado: ticker sin velas (partial) muestra el precio, no un guion', () => {
  for (const mode of ['basic','pro']) {
    const ctx = marketCtx(mode);
    const html = renderMarketPremium(ctx);
    assert.ok(html.includes('$60.444,80'), `${mode}: el precio real no se muestra`);
    assert.ok(!/<strong>—<\/strong>/.test(html.split('nxp-quote')[1]||''), `${mode}: precio vacío`);
    // change24h:0 hardcodeado upstream sin % fiable → '—', nunca «Δ +$0,00».
    assert.ok(!/0,00 ?%|0\.00 ?%/.test(html), `${mode}: absoluto mostrado como %`);
    assert.ok(!html.includes('Δ'), `${mode}: Δ absoluto mostrado pese al 0 hardcodeado`);
    assert.ok(html.includes('no reporta una variación 24h fiable'), `${mode}: falta la nota honesta`);
    // La ausencia de velas se explica en la subpestaña Gráfico (Precio no lleva gráfica).
    const chart = renderMarketPremium({...ctx, ui:{...ctx.ui, marketSub:'chart'}});
    assert.match(chart, /Sin velas|sin velas/i, `${mode}: falta aviso honesto de velas`);
    assert.ok(chart.includes('no publica velas')||chart.includes('Velas no disponibles'),
      `${mode}: la nota no explica que el backend aún no publica velas`);
    // Y el ticker sigue visible encima de la explicación.
    assert.ok(chart.includes('$60.444,80'), `${mode}: el ticker no sigue visible en Gráfico`);
  }
});

test('Inicio: la tarjeta de mercado muestra precio aunque falten velas', () => {
  const ctx = { ...marketCtx('basic'),
    ui:{ marketPair:'BTC/USD' },
    data:{ ...marketCtx('basic').data,
      portfolio:{ state:'ok', data:{ summary:{}, resourceStates:{} } },
      activity:{ state:'ok', data:{ events:[] } } } };
  const html = renderDashboard(ctx);
  assert.ok(html.includes('$60.444,80'), 'dashboard oculta el precio con state partial');
  assert.ok(html.includes('Sin variación 24h fiable'), 'dashboard no etiqueta el cambio no fiable');
  assert.ok(!html.includes('+$0'), 'dashboard muestra Δ +$0,00 como si fuera dato');
});

const actCtx = (feed, enginesData={}) => ({
  viewScope:'real', mode:'basic',
  ui:{ activityFilter:{ sev:'all', engine:'all', cat:'all' } },
  data:{ activity:{ state:'ok', data:{ events:feed } } },
  enginesData,
});
const engine = (mode, extra={}) => ({ state:'ok',
  data:{ status:{ mode }, ...extra } });

test('Actividad: notificaciones vacías pero eventos de motor sí se muestran', () => {
  const ctx = actCtx([], {
    idca: engine('live', { events:[
      { id:11, ts:'2026-11-20T09:00:00Z', msg:'Evaluación de entrada IDCA' },
      { id:12, ts:'2026-11-20T08:00:00Z', msg:'Compra simulada', mode:'simulation' },
    ] }),
    grid: engine('live', { events:[{ id:5, ts:'2026-11-20T07:00:00Z', msg:'Rejilla ajustada' }] }),
    ama:  engine('live', { trace:{ decisions:[{ id:7, ts:'2026-11-20T06:00:00Z', msg:'Decisión AMA' }] } }),
    spot: engine('live', { trades:[] }),
  });
  const { rows } = collectActivity(ctx);
  assert.ok(rows.length >= 3, 'collectActivity no une las fuentes de motor');
  const html = renderScopedActivity(ctx);
  assert.ok(html.includes('Evaluación de entrada IDCA'), 'evento IDCA sin modo propio no hereda el del motor');
  assert.ok(html.includes('Rejilla ajustada'), 'evento GRID ausente');
  assert.ok(html.includes('Decisión AMA'), 'decisión AMA ausente');
  assert.ok(!html.includes('Compra simulada'), 'evento SHADOW colado en vista REAL');
});

test('Actividad: sin ninguna fuente responde «API no devuelve historial», no ceros', () => {
  const ctx = actCtx(undefined, {});
  const html = renderScopedActivity(ctx);
  assert.ok(html.includes('La API no devuelve el historial de eventos'));
});

// Forma real de /api/institutional-dca/entry-diagnostics (capturada en el Pixel).
const DIAG = { generatedAt:'2026-11-20T10:00:00Z', pairs:{ 'BTC/USD':{
  referencePrice:64520.3, referenceMethod:'vwap_anchor', requiredDistancePct:1.35,
  drawdownFromReferencePct:6.37, currentPrice:60444.8, decisionClass:'wait_pullback',
  confidenceScore:62.5, confidenceGrade:'B', marketRegime:'bearish',
  trailingBuy:{ state:'watching', armed:true }, hardBlocked:false, hardBlockers:[] } } };

test('IDCA: Estado traduce la decisión y referencia del entry-diagnostics', () => {
  const pc = entryContexts(DIAG);
  assert.equal(pc['BTC/USD'].entryDecision, 'wait_pullback');
  assert.equal(pc['BTC/USD'].dipDetectedPct, 6.37);
  const ctx = { viewScope:'real', mode:'basic',
    ui:{ engineId:'idca', subtab:'panel' },
    enginesData:{ idca:{ state:'ok', data:{ status:{ mode:'live' },
      pairContexts:pc, cycles:[] } } },
    data:{} };
  const html = renderScopedEngine(ctx);
  assert.ok(html.includes('Qué decide ahora'), 'falta la línea de decisión');
  assert.ok(html.includes('Decisión del bot'), 'la decisión no se nombra');
  assert.ok(html.includes('Referencia (ancla)'), 'falta la referencia VWAP');
  assert.ok(html.includes('64.520'), 'precio de referencia no renderizado');
  assert.ok(html.includes('6,37'), 'caída desde referencia no renderizada');
  assert.ok(!html.includes('[object Object]') && !html.includes('NaN'));
});

test('Navegación única: la barra inferior cubre TODAS las secciones de STREAM', () => {
  // Cada path de STREAM debe tener pestaña inferior (salvo Órdenes en Básico).
  const STREAM = [
    ['idca','cycles'],['idca','history'],['idca','orders'],['idca','events'],
    ['spot','positions'],['spot','trades'],['spot','orders'],
    ['grid','cycles'],['grid','events'],
    ['ama','cycles'],['ama','tranches'],['ama','trace.decisions'],
  ];
  for (const [eng, path] of STREAM) {
    const tabs = engineTabs(eng, 'pro').map(([id]) => id);
    assert.ok(tabs.includes(path), `${eng}/${path} sin pestaña inferior en Pro`);
  }
  // Y los renderers ya no emiten tiras interiores duplicadas.
  const scopedSrc = readFileSync(join(web, 'js', 'scoped-pages.js'), 'utf8');
  const pvSrc = readFileSync(join(web, 'js', 'portfolio-view.js'), 'utf8');
  assert.ok(!scopedSrc.includes('nxs-tabs'), 'scoped-pages aún emite .nxs-tabs');
  assert.ok(!pvSrc.includes('nxw-tabs'), 'portfolio-view aún emite .nxw-tabs');
});

test('Filtros de Actividad envuelven en CSS (sin scroll horizontal forzado)', () => {
  const css = readFileSync(join(web, 'css', 'scoped-pages.css'), 'utf8');
  assert.match(css, /\.nxs-filters\{[^}]*flex-wrap:wrap/, 'nxs-filters sin flex-wrap');
});
