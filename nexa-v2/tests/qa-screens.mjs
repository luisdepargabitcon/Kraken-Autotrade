// NEXA V2 — Harness QA de capturas CON datos. Vive solo en tests/: los fixtures
// DEMO nunca se importan desde el producto ni saltan la autenticación real.
// Renderiza las mismas funciones que usa la app (dashboard/premium/scoped-pages/
// portfolio-view) sobre los fixtures de tests/fixtures.mjs, monta la SHELL real
// de index.html (topbar, scope-bar, statusline, bottomnav) y captura con Chrome
// headless a 360/393/412 px midiendo el desbordamiento horizontal real.
// Salida: %TEMP%\qa-shots-r18h\qa-<pantalla>-<modo>-<scope>-<ancho>.png + qa-metrics.json
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
const OUT = process.argv[2] || join(tmpdir(), 'qa-shots-r18h');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const WIDTHS = [360, 393, 412];
const HEIGHT = 900;

const F = await import(pathToFileURL(join(root, 'tests', 'fixtures.mjs')));
const { ENGINES, ENGINE_SUBTABS } = await import(pathToFileURL(join(web, 'js', 'contracts.js')));
const { classifyMode } = await import(pathToFileURL(join(web, 'js', 'display-scope.js')));
const { normMarket, enrichMarket } = await import(pathToFileURL(join(web, 'js', 'adapters.js')));
const { renderDashboard } = await import(pathToFileURL(join(web, 'js', 'dashboard.js')));
const { renderMarketPremium } = await import(pathToFileURL(join(web, 'js', 'premium.js')));
const { renderScopedEngine, renderScopedActivity } = await import(pathToFileURL(join(web, 'js', 'scoped-pages.js')));
const { renderPortfolioView } = await import(pathToFileURL(join(web, 'js', 'portfolio-view.js')));
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
// subtabs, renderEngineSub}.
function makeCtx({ mode = 'pro', scope = 'real', pair = 'BTC/USD', botLevel = false, brokenCandles = false } = {}) {
  const market = marketFor(pair, { botLevel, brokenCandles });
  const otherPair = pair === 'BTC/USD' ? 'ETH/USD' : 'BTC/USD';
  return {
    mode, viewScope: scope,
    authenticated: true, deviceEnrolled: true, repairRequired: false,
    engineList: ENGINES,
    ui: {
      engineId: 'idca', subtab: 'panel', marketPair: pair, marketTf: '15',
      portfolioTab: 'summary', positionFilter: 'all',
      activityFilter: { sev: 'all', engine: 'all', cat: 'all' },
    },
    enginesData: enginesFor(scope),
    data: {
      marketPairs: {
        [pair]: { state: 'ok', data: market },
        [otherPair]: { state: 'ok', data: marketFor(otherPair, {}) },
      },
      market: { state: 'ok', data: market },
      portfolio: { state: 'ok', data: portfolioData() },
      activity: { state: 'ok', data: { events: activityFor(scope) } },
      fisco: { state: 'ok', data: F.DEMO_FISCO },
    },
    dataTag: 'QA · FIXTURES DEMO',
    market: { state: 'ok', data: market },
    subtabs: ENGINE_SUBTABS.idca || [],
    renderEngineSub: () => '',
  };
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const RENDERERS = {
  inicio: ctx => renderDashboard(ctx),
  mercado: ctx => renderMarketPremium(ctx),
  modos: ctx => renderScopedEngine(ctx),          // ui.engineId='idca'
  cartera: ctx => renderPortfolioView(ctx),
  actividad: ctx => renderScopedActivity(ctx),
};

// Matriz obligatoria: {Inicio, Mercado, Modos, Cartera, Actividad} × {basic, pro}
// a {360,393,412} px; REAL vs SHADOW para Inicio y Cartera; un caso de estado
// parcial (mercado sin velas válidas → aviso honesto, no curvas inventadas).
// Modos(IDCA) se captura en scope shadow porque el fixture IDCA es simulation:
// en scope real sus listas quedarían vacías (comportamiento correcto del scope).
// 'variant' solo cambia el nombre del fichero, no el scope del ctx.
const SHOTS = [
  { screen: 'inicio', mode: 'basic', scope: 'real' },
  { screen: 'inicio', mode: 'basic', scope: 'shadow' },
  { screen: 'inicio', mode: 'pro', scope: 'real' },
  { screen: 'inicio', mode: 'pro', scope: 'shadow' },
  { screen: 'mercado', mode: 'basic', scope: 'real', pair: 'ETH/USD' },  // fallback → «Umbral derivado»
  { screen: 'mercado', mode: 'pro', scope: 'real', botLevel: true },     // → «Activación (nivel del bot)»
  { screen: 'modos', mode: 'basic', scope: 'shadow' },
  { screen: 'modos', mode: 'pro', scope: 'shadow' },
  { screen: 'cartera', mode: 'basic', scope: 'real' },
  { screen: 'cartera', mode: 'basic', scope: 'shadow' },
  { screen: 'cartera', mode: 'pro', scope: 'real' },
  { screen: 'cartera', mode: 'pro', scope: 'shadow' },
  { screen: 'actividad', mode: 'basic', scope: 'real' },
  { screen: 'actividad', mode: 'pro', scope: 'real' },
  { screen: 'mercado', mode: 'pro', scope: 'real', variant: 'error', brokenCandles: true },
];
const shotName = s => `qa-${s.screen}-${s.mode}-${s.variant || s.scope}`;

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
const BOTTOM_NAV = ['home', 'market', 'engines', 'portfolio', 'activity'];
const SCREEN_NAV = { inicio: 'home', mercado: 'market', modos: 'engines', cartera: 'portfolio', actividad: 'activity' };

// Texto de la insignia como en app.js ('v'+version+' · '+canal); si el sello
// fuente sigue siendo placeholder se muestra la versión de la entrega QA.
const verText = BUILD_INFO.version === '0.0.0-dev' || BUILD_INFO.commit === 'source'
  ? 'v0.9.6 · R18G'
  : 'v' + BUILD_INFO.version + ' · ' + String(BUILD_INFO.channel || '').toUpperCase();

const BRAND_SVG = '<svg aria-hidden="true" viewBox="0 0 36 36" width="30" height="30"><rect x="1" y="1" width="34" height="34" rx="9" fill="#123877"/><path d="m7 25 6-15h5l3 11 4-11h5l-6 15h-6l-3-10-4 10z" fill="#79bcff"/></svg>';
const GEAR_SVG = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06-1.91 1.91-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.52V20h-2.7v-.08a1.65 1.65 0 0 0-1-1.52 1.65 1.65 0 0 0-1.82.33l-.06.06-1.91-1.91.06.06A1.65 1.65 0 0 0 7.9 15a1.65 1.65 0 0 0-1.52-1H6.3v-2.7h.08a1.65 1.65 0 0 0 1.52-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06L9.42 6.5l.06.06a1.65 1.65 0 0 0 1.82.33 1.65 1.65 0 0 0 1-1.52V5.3H15v.08a1.65 1.65 0 0 0 1.82-.33l.06.06 1.91 1.91-.06.06A1.65 1.65 0 0 0 19.4 10.3a1.65 1.65 0 0 0 1.52 1H21v2.7h-.08A1.65 1.65 0 0 0 19.4 15Z"/></svg>';

function shell(shot, bodyHtml) {
  const name = shotName(shot);
  const cur = SCREEN_NAV[shot.screen];
  const topnav = NAV.filter(n => n.id !== 'engines').map(n =>
    `<a href="#${n.id}" data-nav="${n.id}" class="${cur === n.id ? 'on' : ''}">${esc(n.label)}</a>`).join('') +
    `<a href="#engines" data-nav="engines" class="${cur === 'engines' ? 'on' : ''}">Modos</a>`;
  const bottomnav = BOTTOM_NAV.map(id => {
    const n = NAV.find(x => x.id === id);
    const active = cur === id;
    return `<a href="#${id}" data-nav="${id}" class="${active ? 'on' : ''}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="${n.icon}"/></svg>${esc(n.label)}</a>`;
  }).join('');
  const scopeReal = shot.scope === 'shadow' ? '' : ' on';
  const scopeShadow = shot.scope === 'shadow' ? ' on' : '';
  const statusline = `<span class="dot"></span><span>Conectado · datos QA (fixtures)</span>` +
    `<span class="nx-status-right">NEXA · ${shot.scope === 'shadow' ? 'SHADOW' : 'REAL'} · ${shot.mode === 'basic' ? 'Básico' : 'Pro'}</span>`;
  return `<div class="qa-ribbon">QA · FIXTURES DEMO — datos sintéticos, no provienen del bot · ${esc(name)}</div>
<div id="app" class="app" data-mode="${shot.mode}" data-scope="${shot.scope}" data-screen="${cur}" data-online="1">
  <header class="topbar">
    <div class="brand">${BRAND_SVG}
      <div class="brand-tx"><b>NEXA</b><span id="brand-sub">Control · Web + Android</span></div>
    </div>
    <nav class="topnav" id="topnav" aria-label="Navegación principal escritorio">${topnav}</nav>
    <div class="top-ctl">
      <button class="seg-btn" id="engine-btn" aria-haspopup="dialog" title="Cambiar motor" aria-label="Cambiar motor. Actual: IDCA">Motor: <b id="engine-name">IDCA</b></button>
      <div class="seg" role="group" aria-label="Nivel de presentación">
        <button id="mode-basic" data-mode="basic"${shot.mode === 'basic' ? ' class="on"' : ''}>Básico</button>
        <button id="mode-pro" data-mode="pro"${shot.mode === 'pro' ? ' class="on"' : ''}>Pro</button>
      </div>
      <button class="seg-btn" id="lock-btn" title="Bloquear (PIN)">Bloq.</button>
      <button class="nx-ver" id="ver-badge" type="button" title="Información de compilación" aria-label="Versión y compilación">${esc(verText)}</button>
      <button class="nx-header-settings" id="settings-shortcut" type="button" data-nav="settings" title="Ajustes" aria-label="Abrir ajustes">${GEAR_SVG}</button>
    </div>
  </header>
  <div class="nx-scope-bar" role="group" aria-label="Seleccionar datos reales o de simulación">
    <span>Datos visibles:</span>
    <button type="button" id="scope-real" data-scope="real" class="${scopeReal.trim()}" aria-pressed="${shot.scope !== 'shadow'}">REAL</button>
    <button type="button" id="scope-shadow" data-scope="shadow" class="${scopeShadow.trim()}" aria-pressed="${shot.scope === 'shadow'}">SHADOW</button>
    <small id="scope-warning">Selector de visualización, no cambia el motor</small>
  </div>
  <div class="statusline" id="statusline" role="status">${statusline}</div>
  <main id="screen" class="screen" tabindex="-1">${bodyHtml}</main>
  <nav class="bottomnav" id="bottomnav" aria-label="Navegación principal móvil">${bottomnav}</nav>
</div>`;
}

// Sonda de desbordamiento evaluada por CDP (Runtime.evaluate): devuelve
// scrollWidth/innerWidth reales del viewport EMULADO y hasta 15 elementos que
// pintan fuera sin un ancestro que los recorte (overflow-x distinto de visible).
const METRICS_EXPR = `(()=>{const iw=innerWidth;
const clipped=el=>{for(let p=el.parentElement;p;p=p.parentElement){const o=getComputedStyle(p).overflowX;if(o==='hidden'||o==='auto'||o==='scroll'||o==='clip')return true}return false};
const over=[];
for(const el of document.querySelectorAll('body *')){
 const r=el.getBoundingClientRect();
 if(r.width===0||r.right<=iw+1||clipped(el))continue;
 const cs=(typeof el.className==='string'&&el.className)?'.'+el.className.trim().split(/\\\\s+/).join('.'):'';
 over.push(el.tagName.toLowerCase()+(el.id?'#'+el.id:'')+cs+'['+Math.round(r.left)+'..'+Math.round(r.right)+']');
}
return JSON.stringify({iw,scrollW:document.documentElement.scrollWidth,over:over.slice(0,15)})})()`;

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
  const ctx = makeCtx(shot);
  pages.set(shotName(shot) + '.html', page(shot, RENDERERS[shot.screen](ctx)));
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
    console.log(`${name}.png  ${size} B  scrollW=${m ? m.scrollW : '?'}/iw${w}${m && m.over.length ? '  OVERFLOW: ' + m.over.join(' ') : ''}`);
  }
} finally {
  ws.close();
  chrome.kill();
  server.close();
}
writeFileSync(join(OUT, 'qa-metrics.json'), JSON.stringify(metrics, null, 2));
console.log(`\n${results.length} capturas en ${OUT}`);
console.log('Métricas → ' + join(OUT, 'qa-metrics.json'));
