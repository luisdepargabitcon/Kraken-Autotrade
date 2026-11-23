// NEXA V2 — Harness QA de capturas CON datos. Vive solo en tests/: los fixtures
// DEMO nunca se importan desde el producto ni saltan la autenticación real.
// Renderiza las mismas funciones que usa la app (dashboard/premium/scoped-pages/
// portfolio-view) sobre los fixtures de tests/fixtures.mjs, monta la SHELL real
// de index.html (topbar con segmentos Básico/Pro + REAL/SHADOW, statusline,
// dock con botón Atrás + bottomnav por profundidad) y captura con Chrome
// headless + CDP a 360/393/412 px midiendo desbordamiento, tap targets y
// solape pie/contenido.
// Recorrido R19: Inicio → Mercado → Modos → SPOT → motor (Órdenes IDCA en Pro,
// Estado en Básico) → vuelta a Modos → vuelta a raíz, en Básico/Pro ×
// REAL/SHADOW; más Cartera y Actividad con datos / vacías / sin sesión.
// Salida: %TEMP%\qa-shots-r19\qa-<paso>-<modo>-<scope>-<ancho>.png + qa-metrics.json
// Uso: node tests/qa-screens.mjs [dir_salida]
import { mkdirSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
// actions.js (importado por dashboard.js) toca módulos de navegador (config/auth):
// se siembra el mínimo DOM como hacen los tests existentes. Solo afecta al harness.
globalThis.location ??= { search: '', protocol: 'https:', pathname: '/' };
globalThis.window ??= { Capacitor: null };
const mem = new Map();
globalThis.localStorage ??= {
  getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k),
};
globalThis.sessionStorage ??= {
  getItem: k => mem.get('s:' + k) ?? null, setItem: (k, v) => mem.set('s:' + k, String(v)), removeItem: k => mem.delete('s:' + k),
};
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'web');
const OUT = process.argv[2] || join(tmpdir(), 'qa-shots-r19');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const WIDTHS = [360, 393, 412];
const HEIGHT = 900;

const F = await import(pathToFileURL(join(root, 'tests', 'fixtures.mjs')));
const { ENGINES, ENGINE_SUBTABS } = await import(pathToFileURL(join(web, 'js', 'contracts.js')));
const { classifyMode } = await import(pathToFileURL(join(web, 'js', 'display-scope.js')));
const { normMarket, enrichMarket } = await import(pathToFileURL(join(web, 'js', 'adapters.js')));
const { renderDashboard } = await import(pathToFileURL(join(web, 'js', 'dashboard.js')));
const { renderMarketPremium } = await import(pathToFileURL(join(web, 'js', 'premium.js')));
const { renderScopedEngine, renderScopedActivity, renderModesOverview } = await import(pathToFileURL(join(web, 'js', 'scoped-pages.js')));
const { renderPortfolioView } = await import(pathToFileURL(join(web, 'js', 'portfolio-view.js')));
const { bottomItems, navView, ROOT_ITEMS } = await import(pathToFileURL(join(web, 'js', 'nav-model.js')));
const { BUILD_INFO } = await import(pathToFileURL(join(web, 'js', 'build-info.js')));

// ---------- Variante LIVE de los fixtures ----------
// Los fixtures DEMO son mayoría SHADOW/simulation; para que el scope REAL muestre
// contenido se clonan reescribiendo solo los campos de modo a 'live'. Sigue siendo
// dato sintético rotulado, no proviene del bot real.
const toLive = v => {
  if (Array.isArray(v)) return v.map(toLive);
  if (v && typeof v === 'object') {
    const r = {}; for (const [k, x] of Object.entries(v)) r[k] = toLive(x); return r;
  }
  return typeof v === 'string' && classifyMode(v) === 'shadow' ? 'live' : v;
};
const enginesFor = scope => {
  const src = scope === 'shadow'
    ? { idca: F.DEMO_IDCA, spot: F.DEMO_SPOT, grid: F.DEMO_GRID, ama: F.DEMO_AMA }
    : { idca: toLive(F.DEMO_IDCA), spot: toLive(F.DEMO_SPOT), grid: toLive(F.DEMO_GRID), ama: toLive(F.DEMO_AMA) };
  const idca = { ...src.idca, simWallet: { totalUsd: 4025.30, freeUsd: 1619.56, usedUsd: 2380.44 } };
  return {
    idca: { state: 'ok', data: idca },
    spot: { state: 'ok', data: src.spot },
    grid: { state: 'ok', data: src.grid },
    ama: { state: 'ok', data: src.ama },
  };
};

// Mercado por par, por el mismo contrato que el producto: normMarket+enrichMarket.
// El entryCtx se deriva de DEMO_IDCA.pairContexts; se añade referencePrice/
// requiredDipPct (que el fixture no trae) y, opcionalmente, targetEntryPrice para
// visualizar la rama «nivel del bot» de chartLevels.
function marketFor(pair, { botLevel = false, brokenCandles = false } = {}) {
  const pc = F.DEMO_IDCA.pairContexts[pair] || {};
  const entryCtx = {
    regime: pc.regime, atrpPct: pc.atrpPct, entryScore: pc.entryScore,
    entryDecision: 'watch', reboundSignal: pc.reboundSignal,
    referencePrice: Math.round(pc.currentPrice * 1.045 * 100) / 100,
    requiredDipPct: 4.5,
    ...(botLevel ? { targetEntryPrice: Math.round(pc.currentPrice * 0.985 * 100) / 100 } : {}),
  };
  const m = enrichMarket(normMarket({
    ...F.DEMO_MARKET.tickers[pair],
    candles: brokenCandles ? [] : F.DEMO_MARKET.candles[pair],
    indicators: F.DEMO_MARKET.indicators[pair],
    provider: 'FIXTURE DEMO (sintético)',
  }), { entryCtx, sources: F.DEMO_MARKET.externalSources });
  m.candlesSource = 'qa-fixture';
  if (brokenCandles) m.candlesError = 'Fuente OHLCV sin filas válidas (simulado QA)';
  return m;
}

const portfolioData = () => ({
  summary: F.DEMO_PORTFOLIO.summary,
  holdings: F.DEMO_PORTFOLIO.balances,
  ledger: [],
  reservations: F.DEMO_PORTFOLIO.budgets.reservations,
  budgets: F.DEMO_PORTFOLIO.budgets.items,
  // Mapa por exchange (forma real de /balances/all); sin duplicar exchange+asset.
  exchangeBalances: {
    revolutx: { connected: true, balances: { USD: 7451.11, BTC: 0.027909, ETH: 0.331, SOL: 1.205, XRP: 420.5 } },
    kraken: { connected: true, balances: { BTC: 0.02, EUR: 310.4 } },
  },
  prices: { BTC: 97340.25, ETH: 3284.10, SOL: 214.66, XRP: 2.18, USD: 1, EUR: 1.08 },
  resourceStates: { exchangeBalances: 'ok', prices: 'ok', summary: 'ok', holdings: 'ok', ledger: 'ok', reservations: 'ok' },
});

const activityFor = scope => F.DEMO_ACTIVITY.map(e => ({ ...e, mode: scope === 'shadow' ? 'simulation' : 'live' }));

// ctx replicando la forma exacta de app.js render(): {mode, viewScope, ui,
// engineList, authenticated, deviceEnrolled, enginesData, data, dataTag, market,
// subtabs, renderEngineSub}. El estado de navegación se traduce con navView(),
// igual que hace render() en app.js, y se sincronizan los campos de ui.
function makeCtx({ mode = 'pro', scope = 'real', nav = { depth: 0, section: 'home', sub: 'summary', inner: null },
  variant = 'datos', pair = 'BTC/USD', botLevel = false, brokenCandles = false } = {}) {
  const market = marketFor(pair, { botLevel, brokenCandles });
  const otherPair = pair === 'BTC/USD' ? 'ETH/USD' : 'BTC/USD';
  const view = navView(nav);
  const ui = {
    engineId: 'idca', subtab: 'panel', marketPair: pair, marketTf: '15',
    portfolioTab: 'summary', positionFilter: 'all',
    activityFilter: { sev: 'all', engine: 'all', cat: 'all' },
  };
  if (view.ui.marketSub !== undefined) ui.marketSub = view.ui.marketSub;
  if (view.ui.engineId) { ui.engineId = view.ui.engineId; ui.subtab = view.ui.subtab; }
  if (view.ui.portfolioTab) ui.portfolioTab = view.ui.portfolioTab;
  if (view.ui.activityCat) ui.activityFilter.cat = view.ui.activityCat;
  const sinSesion = variant === 'sinsesion';
  const vacia = variant === 'vacia';
  const portfolio = vacia
    ? { summary: null, holdings: [], ledger: [], reservations: [], budgets: [], inventory: [], exchangeBalances: null, prices: null, resourceStates: {} }
    : portfolioData();
  return {
    mode, viewScope: scope,
    authenticated: !sinSesion, deviceEnrolled: !sinSesion, repairRequired: false,
    engineList: ENGINES,
    ui,
    enginesData: enginesFor(scope),
    data: {
      marketPairs: {
        [pair]: { state: 'ok', data: market },
        [otherPair]: { state: 'ok', data: marketFor(otherPair, {}) },
      },
      market: { state: 'ok', data: market },
      portfolio: sinSesion ? { state: 'auth_required', data: null } : { state: 'ok', data: portfolio },
      activity: sinSesion ? { state: 'auth_required', data: { events: null } }
        : { state: 'ok', data: { events: vacia ? [] : activityFor(scope) } },
      fisco: { state: 'ok', data: F.DEMO_FISCO },
    },
    dataTag: 'QA · FIXTURES DEMO',
    market: { state: 'ok', data: market },
    subtabs: ENGINE_SUBTABS[ui.engineId] || [],
    renderEngineSub: () => '',
  };
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const RENDERERS = {
  dashboard: ctx => renderDashboard(ctx),
  market: ctx => renderMarketPremium(ctx),
  modes: ctx => renderModesOverview(ctx),
  engine: ctx => renderScopedEngine(ctx),
  portfolio: ctx => renderPortfolioView(ctx),
  activity: ctx => renderScopedActivity(ctx),
};
const renderShot = shot => RENDERERS[navView(shot.nav).screen](makeCtx(shot));

// Recorrido R19 (prototipo de controles): Inicio raíz → Mercado (subpestañas)
// → Modos → motor SPOT → sección interna del motor (Órdenes de IDCA en Pro —
// SPOT no tiene path 'orders'; en Básico se muestra Estado porque Órdenes se
// oculta) → vuelta a Modos → vuelta a la raíz. Todo en las 4 combinaciones
// Básico/Pro × REAL/SHADOW. Además Cartera y Actividad con datos, vacías y
// sin sesión (en Pro·REAL y Básico·SHADOW).
const D1 = (section, sub) => ({ depth: 1, section, sub, inner: null });
const D2 = (sub, inner) => ({ depth: 2, section: 'engines', sub, inner });
const JOURNEY = mode => [
  { step: 'inicio', nav: { depth: 0, section: 'home', sub: 'summary', inner: null }, botLevel: true },
  { step: 'mercado', nav: D1('market', 'price'), botLevel: true },
  { step: 'modos', nav: D1('engines', 'general') },
  { step: 'spot', nav: D2('spot', 'panel') },
  mode === 'pro'
    ? { step: 'ordenes', nav: D2('idca', 'orders') }
    : { step: 'motor', nav: D2('idca', 'panel') },
  { step: 'vuelta-modos', nav: D1('engines', 'general') },
  { step: 'vuelta-raiz', nav: { depth: 0, section: 'home', sub: 'summary', inner: null }, botLevel: true },
];
const SHOTS = [];
for (const mode of ['basic', 'pro']) for (const scope of ['real', 'shadow'])
  for (const j of JOURNEY(mode)) SHOTS.push({ ...j, mode, scope });
for (const { mode, scope } of [{ mode: 'pro', scope: 'real' }, { mode: 'basic', scope: 'shadow' }])
  for (const section of ['portfolio', 'activity'])
    for (const variant of ['datos', 'vacia', 'sinsesion'])
      SHOTS.push({
        step: `${section === 'portfolio' ? 'cartera' : 'actividad'}-${variant}`,
        nav: D1(section, section === 'activity' ? 'recent' : 'summary'),
        mode, scope, variant,
      });
const shotName = s => `qa-${s.step}-${s.mode}-${s.scope}`;

// ---------- Shell real de index.html ----------
// NAV y BOTTOM_NAV copiados de web/js/app.js (constantes NAV/BOTTOM_NAV) para no
// inventar rutas ni iconos; solo FISCO/Ajustes no caben en la barra inferior.
const NAV = [
  { id: 'home', label: 'Inicio', icon: 'M4 11 12 4l8 7v9h-5v-5H9v5H4z' },
  { id: 'market', label: 'Mercado', icon: 'M4 20 10 12l4 4 6-10' },
  { id: 'engines', label: 'Modos', icon: 'M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1M7.7 16.3l-2.1 2.1-2.1-2.1' },
  { id: 'portfolio', label: 'Cartera', icon: 'M4 7h16v12H4zM4 7l3-4h10l3 4M12 11v6' },
  { id: 'activity', label: 'Actividad', icon: 'M4 12h4l2-7 4 14 2-7h4' },
];
const NAV_ICONS = Object.fromEntries(NAV.map(n => [n.id, n.icon]));

// Texto de la insignia como en app.js ('v'+version+' · '+canal); si el sello
// fuente sigue siendo placeholder se muestra la versión de la entrega QA.
const verText = BUILD_INFO.version === '0.0.0-dev' || BUILD_INFO.commit === 'source'
  ? 'v0.9.6 · R18G'
  : 'v' + BUILD_INFO.version + ' · ' + String(BUILD_INFO.channel || '').toUpperCase();

const BRAND_SVG = '<svg aria-hidden="true" viewBox="0 0 36 36" width="30" height="30"><rect x="1" y="1" width="34" height="34" rx="9" fill="#123877"/><path d="m7 25 6-15h5l3 11 4-11h5l-6 15h-6l-3-10-4 10z" fill="#79bcff"/></svg>';
const GEAR_SVG = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06-1.91 1.91-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.52V20h-2.7v-.08a1.65 1.65 0 0 0-1-1.52 1.65 1.65 0 0 0-1.82.33l-.06.06-1.91-1.91.06.06A1.65 1.65 0 0 0 7.9 15a1.65 1.65 0 0 0-1.52-1H6.3v-2.7h.08a1.65 1.65 0 0 0 1.52-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06L9.42 6.5l.06.06a1.65 1.65 0 0 0 1.82.33 1.65 1.65 0 0 0 1-1.52V5.3H15v.08a1.65 1.65 0 0 0 1.82-.33l.06.06 1.91 1.91-.06.06A1.65 1.65 0 0 0 19.4 10.3a1.65 1.65 0 0 0 1.52 1H21v2.7h-.08A1.65 1.65 0 0 0 19.4 15Z"/></svg>';

function shell(shot, bodyHtml) {
  const name = shotName(shot);
  const { nav, mode } = shot;
  const view = navView(nav);
  // Igual que renderNav() de app.js: topnav por sección, bottomnav por nivel.
  const sectionOn = id => nav.section === id || view.screen === id;
  const topnav = NAV.filter(n => n.id !== 'engines').map(n =>
    `<a href="#${n.id}" data-nav="${n.id}" class="${sectionOn(n.id) ? 'on' : ''}">${esc(n.label)}</a>`).join('') +
    `<a href="#engines" data-nav="engines" class="${sectionOn('engines') ? 'on' : ''}">Modos</a>`;
  const items = bottomItems(nav, mode);
  const cols = Math.min(items.length, items.length > 5 ? 3 : 5);
  const bottomnav = items.map((it, i) => {
    const active = nav.depth === 0 ? it.id === nav.section
      : nav.depth === 1 ? it.id === nav.sub : it.id === nav.inner;
    const icon = nav.depth === 0 && NAV_ICONS[it.id]
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="${NAV_ICONS[it.id]}"/></svg>` : '';
    return `<a href="#${it.id}" data-nav-idx="${i}" class="${active ? 'on' : ''}${nav.depth ? ' nv-sub' : ''}">${icon}${esc(it.label)}</a>`;
  }).join('');
  const statusline = `<span class="dot"></span><span>Conectado · datos QA (fixtures)</span>` +
    `<span class="nx-status-right">NEXA · ${shot.scope === 'shadow' ? 'SHADOW' : 'REAL'} · ${mode === 'basic' ? 'Básico' : 'Pro'}</span>`;
  return `<div class="qa-ribbon">QA · FIXTURES DEMO — datos sintéticos, no provienen del bot · ${esc(name)}</div>
<div id="app" class="app" data-mode="${mode}" data-scope="${shot.scope}" data-screen="${view.screen}" data-online="1">
  <header class="topbar">
    <div class="brand">
      <button class="logo" id="brand-home" type="button" aria-label="Volver a Inicio" title="Inicio">${BRAND_SVG}
        <span class="brand-tx"><b>NEXA</b><span id="brand-sub">Control · Web + Android</span></span>
      </button>
    </div>
    <nav class="topnav" id="topnav" aria-label="Navegación principal escritorio">${topnav}</nav>
    <div class="top-segs">
      <div class="seg" role="group" aria-label="Nivel de presentación">
        <button id="mode-basic" data-mode="basic"${mode === 'basic' ? ' class="on"' : ''}>Básico</button>
        <button id="mode-pro" data-mode="pro"${mode === 'pro' ? ' class="on"' : ''}>Pro</button>
      </div>
      <div class="seg seg-env" role="group" aria-label="Datos visibles: reales o de simulación">
        <button type="button" id="scope-real" data-scope="real" class="${shot.scope === 'shadow' ? '' : 'on'}" aria-pressed="${shot.scope !== 'shadow'}">REAL</button>
        <button type="button" id="scope-shadow" data-scope="shadow" class="${shot.scope === 'shadow' ? 'on' : ''}" aria-pressed="${shot.scope === 'shadow'}">SHADOW</button>
      </div>
    </div>
    <div class="top-ctl">
      <button class="seg-btn" id="engine-btn" aria-haspopup="dialog" title="Cambiar motor" aria-label="Cambiar motor. Actual: IDCA">Motor: <b id="engine-name">IDCA</b></button>
      <button class="seg-btn" id="lock-btn" title="Bloquear (PIN)">Bloq.</button>
      <button class="nx-ver" id="ver-badge" type="button" title="Información de compilación" aria-label="Versión y compilación">${esc(verText)}</button>
      <button class="nx-header-settings" id="settings-shortcut" type="button" data-nav="settings" title="Ajustes" aria-label="Abrir ajustes">${GEAR_SVG}</button>
    </div>
  </header>
  <div class="statusline" id="statusline" role="status">${statusline}</div>
  <main id="screen" class="screen" tabindex="-1">${bodyHtml}</main>
  <div class="dock">
    <button id="back" type="button" aria-label="Volver al nivel anterior" title="Atrás"${nav.depth > 0 ? '' : ' hidden'}>‹</button>
    <nav class="bottomnav" id="bottomnav" aria-label="Navegación principal móvil" style="grid-template-columns:repeat(${cols},minmax(0,1fr))">${bottomnav}</nav>
  </div>
</div>`;
}

// Sonda evaluada por CDP (Runtime.evaluate) sobre el viewport EMULADO:
// - scrollWidth/innerWidth reales y hasta 15 elementos que pintan fuera sin un
//   ancestro que los recorte (overflow-x distinto de visible).
// - Tap targets del dock: todo control pulsable debe medir >=44px en ambos ejes.
// - Solape pie/contenido: el padding-bottom de <main> debe cubrir la altura del
//   dock fijo para que nada quede oculto (se mide con getBoundingClientRect).
const METRICS_EXPR = `(()=>{const iw=innerWidth;
const clipped=el=>{for(let p=el.parentElement;p;p=p.parentElement){const o=getComputedStyle(p).overflowX;if(o==='hidden'||o==='auto'||o==='scroll'||o==='clip')return true}return false};
const over=[];
for(const el of document.querySelectorAll('body *')){
 const r=el.getBoundingClientRect();
 if(r.width===0||r.right<=iw+1||clipped(el))continue;
 const cs=(typeof el.className==='string'&&el.className)?'.'+el.className.trim().split(/\\\\s+/).join('.'):'';
 over.push(el.tagName.toLowerCase()+(el.id?'#'+el.id:'')+cs+'['+Math.round(r.left)+'..'+Math.round(r.right)+']');
}
let minTap=9999;const tapBad=[];
for(const el of document.querySelectorAll('.dock a,.dock button')){
 const r=el.getBoundingClientRect();
 if(!r.width||el.hidden)continue;
 const mn=Math.min(r.width,r.height);if(mn<minTap)minTap=mn;
 if(r.height<44||r.width<44)tapBad.push((el.id?'#'+el.id:el.textContent.trim().slice(0,14))+' '+Math.round(r.width)+'x'+Math.round(r.height));
}
const dock=document.querySelector('.dock');
const scr=document.getElementById('screen');
const dockH=dock?dock.getBoundingClientRect().height:0;
const pad=scr?parseFloat(getComputedStyle(scr).paddingBottom)||0:0;
return JSON.stringify({iw,scrollW:document.documentElement.scrollWidth,over:over.slice(0,15),
 minTap:minTap===9999?null:Math.round(minTap),tapBad:tapBad.slice(0,10),
 dockH:Math.round(dockH),screenPad:Math.round(pad),padOk:pad>=dockH-1})})()`;

function page(shot, bodyHtml) {
  const name = shotName(shot);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#070b13"><meta name="color-scheme" content="dark">
<title>QA · ${esc(name)}</title>
<link rel="stylesheet" href="/css/style.css">
<link rel="stylesheet" href="/css/premium.css">
<link rel="stylesheet" href="/css/dashboard.css">
<link rel="stylesheet" href="/css/scope-portfolio.css">
<link rel="stylesheet" href="/css/scoped-pages.css">
<style>.qa-ribbon{position:sticky;top:0;z-index:9999;background:#5b1f1f;color:#ffd9d9;
font:600 11px/1.5 ui-monospace,monospace;padding:5px 10px;letter-spacing:.04em;border-bottom:1px solid #8a3434}</style>
</head><body>${shell(shot, bodyHtml)}</body></html>`;
}

mkdirSync(OUT, { recursive: true });
const pages = new Map();
for (const shot of SHOTS) {
  pages.set(shotName(shot) + '.html', page(shot, renderShot(shot)));
}

// Servidor estático local efímero: /css/* desde web/, el resto son páginas QA.
const server = createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  if (u.pathname.startsWith('/css/')) {
    try {
      res.setHeader('content-type', 'text/css; charset=utf-8');
      res.end(readFileSync(join(web, 'css', u.pathname.slice(5))));
    } catch { res.statusCode = 404; res.end(); }
    return;
  }
  const body = pages.get(u.pathname.replace(/^\//, ''));
  if (body) { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(body); return; }
  res.statusCode = 404; res.end('not found');
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

// Chrome headless fuerza un ancho de ventana mínimo de 500 px en esta plataforma
// (--window-size=360 deja innerWidth=500 → pantallas "recortadas" en el PNG).
// Solución: un solo Chrome con CDP y Emulation.setDeviceMetricsOverride por
// (pantalla,ancho) → innerWidth real = ancho pedido y captura exacta.
const profile = join(OUT, '.chrome-profile');
mkdirSync(profile, { recursive: true });
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
]);
const devtoolsFile = join(profile, 'DevToolsActivePort');
let debugPort = null;
for (let i = 0; i < 60 && !debugPort; i++) {
  await new Promise(r => setTimeout(r, 250));
  try { debugPort = readFileSync(devtoolsFile, 'utf8').split('\n')[0].trim(); } catch { /* aún no */ }
}
if (!debugPort) { chrome.kill(); server.close(); throw new Error('Chrome CDP no arrancó (DevToolsActivePort ausente)'); }
const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
const pageTarget = targets.find(t => t.type === 'page');
if (!pageTarget) { chrome.kill(); server.close(); throw new Error('Sin target page en CDP'); }

const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0;
const pending = new Map();
const events = [];
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id); }
  else if (m.method) events.push(m);
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++msgId; pending.set(i, { res, rej });
  ws.send(JSON.stringify({ id: i, method, params }));
});
const waitEvent = (method, timeoutMs = 8000) => new Promise(res => {
  const t0 = Date.now();
  const iv = setInterval(() => {
    const k = events.findIndex(e => e.method === method);
    if (k >= 0) { events.splice(k, 1); clearInterval(iv); res(true); }
    else if (Date.now() - t0 > timeoutMs) { clearInterval(iv); res(false); }
  }, 25);
});
await send('Page.enable');

const jobs = [];
for (const shot of SHOTS) for (const w of WIDTHS) jobs.push({ shot, w });

const metrics = [];
const results = [];
try {
  for (const { shot, w } of jobs) {
    const name = `${shotName(shot)}-${w}`;
    const url = `http://127.0.0.1:${port}/${shotName(shot)}.html`;
    const out = join(OUT, name + '.png');
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: HEIGHT, deviceScaleFactor: 1, mobile: true });
    const loaded = waitEvent('Page.loadEventFired');
    await send('Page.navigate', { url });
    await loaded;
    await new Promise(r => setTimeout(r, 200));
    const ev = await send('Runtime.evaluate', { expression: METRICS_EXPR, returnByValue: true });
    let m = null;
    try { m = JSON.parse(ev.result.value); } catch { m = null; }
    const shot2 = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(out, Buffer.from(shot2.data, 'base64'));
    const size = statSync(out).size;
    metrics.push({ name, ...m });
    results.push({ file: name + '.png', size });
    console.log(`${name}.png  ${size} B  scrollW=${m ? m.scrollW : '?'}/iw${w}` +
      `${m && m.over.length ? '  OVERFLOW: ' + m.over.join(' ') : ''}` +
      `${m ? `  tap>=44:${m.tapBad.length ? 'NO(' + m.tapBad.join('|') + ')' : 'si'}  pad:${m.screenPad}/${m.dockH}${m.padOk ? '' : ' FALLO'}` : ''}`);
  }
} finally {
  ws.close();
  chrome.kill();
  server.close();
}
writeFileSync(join(OUT, 'qa-metrics.json'), JSON.stringify(metrics, null, 2));
console.log(`\n${results.length} capturas en ${OUT}`);
console.log('Métricas → ' + join(OUT, 'qa-metrics.json'));
