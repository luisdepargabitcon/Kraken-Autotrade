// NEXA V2 — Harness QA de capturas CON datos. Vive solo en tests/: los fixtures
// DEMO nunca se importan desde el producto ni saltan la autenticación real.
// Renderiza las mismas funciones que usa la app (dashboard/premium/scoped-pages/
// portfolio-view) sobre los fixtures de tests/fixtures.mjs, sirve el HTML en un
// servidor local efímero y captura con Chrome headless.
// Salida: %TEMP%\qa-shots-r18g\qa-<pantalla>-<modo>-<scope>.png (rotuladas QA).
// Uso: node tests/qa-screens.mjs [dir_salida]
import { mkdirSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);
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
const OUT = process.argv[2] || join(tmpdir(), 'qa-shots-r18g');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const WIDTH = 393, HEIGHT = 800;

const F = await import(pathToFileURL(join(root, 'tests', 'fixtures.mjs')));
const { ENGINES, ENGINE_SUBTABS } = await import(pathToFileURL(join(web, 'js', 'contracts.js')));
const { classifyMode } = await import(pathToFileURL(join(web, 'js', 'display-scope.js')));
const { normMarket, enrichMarket } = await import(pathToFileURL(join(web, 'js', 'adapters.js')));
const { renderDashboard } = await import(pathToFileURL(join(web, 'js', 'dashboard.js')));
const { renderMarketPremium } = await import(pathToFileURL(join(web, 'js', 'premium.js')));
const { renderScopedEngine, renderScopedActivity } = await import(pathToFileURL(join(web, 'js', 'scoped-pages.js')));
const { renderPortfolioView } = await import(pathToFileURL(join(web, 'js', 'portfolio-view.js')));

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
// a 393 px; REAL vs SHADOW para Inicio y Cartera; un caso de estado parcial
// (mercado sin velas válidas → aviso honesto, no curvas inventadas).
// Modos(IDCA) se captura en scope shadow porque el fixture IDCA es simulation:
// en scope real sus listas quedarían vacías (comportamiento correcto del scope).
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
  { screen: 'mercado', mode: 'pro', scope: 'error', brokenCandles: true },
];

function page(shot, bodyHtml) {
  const label = `qa-${shot.screen}-${shot.mode}-${shot.scope}`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>QA · ${esc(label)}</title>
<link rel="stylesheet" href="/css/style.css">
<link rel="stylesheet" href="/css/premium.css">
<link rel="stylesheet" href="/css/dashboard.css">
<link rel="stylesheet" href="/css/scope-portfolio.css">
<link rel="stylesheet" href="/css/scoped-pages.css">
<style>.qa-ribbon{position:sticky;top:0;z-index:9999;background:#5b1f1f;color:#ffd9d9;
font:600 11px/1.5 ui-monospace,monospace;padding:5px 10px;letter-spacing:.04em;border-bottom:1px solid #8a3434}</style>
</head><body>
<div class="qa-ribbon">QA · FIXTURES DEMO — datos sintéticos, no provienen del bot · ${esc(label)}</div>
<div id="app" class="app" data-mode="${shot.mode}" data-scope="${shot.scope}" data-online="1">
<main id="screen" class="screen" tabindex="-1">${bodyHtml}</main>
</div></body></html>`;
}

mkdirSync(OUT, { recursive: true });
const pages = new Map();
for (const shot of SHOTS) {
  const name = `qa-${shot.screen}-${shot.mode}-${shot.scope}`;
  const ctx = makeCtx(shot);
  const html = page(shot, RENDERERS[shot.screen](ctx));
  pages.set(name + '.html', html);
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
const profile = join(OUT, '.chrome-profile');
mkdirSync(profile, { recursive: true });

const results = [];
try {
  for (const shot of SHOTS) {
    const name = `qa-${shot.screen}-${shot.mode}-${shot.scope}`;
    const out = join(OUT, name + '.png');
    await execFileP(CHROME, [
      '--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      `--user-data-dir=${profile}`, '--hide-scrollbars', '--virtual-time-budget=4000',
      `--screenshot=${out}`, `--window-size=${WIDTH},${HEIGHT}`,
      `http://127.0.0.1:${port}/${name}.html`,
    ]);
    const size = statSync(out).size;
    results.push({ file: name + '.png', size });
    console.log(`${name}.png  ${size} B`);
  }
} finally {
  server.close();
}
console.log(`\n${results.length} capturas en ${OUT}`);
