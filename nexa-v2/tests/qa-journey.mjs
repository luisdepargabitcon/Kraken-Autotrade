// NEXA V2 — Harness QA de INTERACCIÓN REAL (R20). A diferencia de qa-screens.mjs
// (que compone estados y renderiza shots estáticos), aquí se sirve la app de
// verdad (web/index.html + js/app.js) y el recorrido se hace PULSANDO los
// controles reales del DOM: [data-nav-idx], #mode-basic/#mode-pro,
// #scope-real/#scope-shadow, #back, #brand-home y history.back()+popstate.
//
// Autenticación: se recorre el gate real (PIN de 6 dígitos dos veces →
// «Ahora no» en vinculación) con clicks de teclado/puntero simulados. La API no
// existe en QA: fetch a /api/* devuelve 503 y, tras el primer render, se
// inyectan los FIXTURES DEMO en state.enginesData/state.common a través del
// bridge window.__nexa.ctx (misma referencia de objeto que usa render()).
// Sigue sin haber datos reales ni acciones de trading.
//
// Recorrido obligatorio: Inicio → Modos → SPOT → (Pro) Órdenes → back del
// sistema (history.back+popstate) → ‹ ‹ hasta raíz → logotipo → Inicio; y lo
// mismo en Básico (Órdenes no debe existir). Además: el toggle REAL/SHADOW no
// debe crear entradas de historial.
// Salida: %TEMP%\qa-shots-r20\jq-<paso>-<modo>-<ancho>.png + qa-metrics.json
//        + qa-journey-report.json
// Uso: node tests/qa-journey.mjs [dir_salida]
import { mkdirSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'web');
const OUT = process.argv[2] || join(tmpdir(), 'qa-shots-r20');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const WIDTHS = [360, 393, 412];
const HEIGHT = 900;

const F = await import(pathToFileURL(join(root, 'tests', 'fixtures.mjs')));
const { classifyMode, inScope } = await import(pathToFileURL(join(web, 'js', 'display-scope.js')));
const { normMarket, enrichMarket } = await import(pathToFileURL(join(web, 'js', 'adapters.js')));

// ---------- Fixtures en la forma que consume la app (igual que qa-screens) ----
const toLive = v => {
  if (Array.isArray(v)) return v.map(toLive);
  if (v && typeof v === 'object') {
    const r = {}; for (const [k, x] of Object.entries(v)) r[k] = toLive(x); return r;
  }
  return typeof v === 'string' && classifyMode(v) === 'shadow' ? 'live' : v;
};
const enginesLive = {
  idca: { ...toLive(F.DEMO_IDCA), simWallet: { totalUsd: 4025.30, freeUsd: 1619.56, usedUsd: 2380.44 } },
  spot: toLive(F.DEMO_SPOT), grid: toLive(F.DEMO_GRID), ama: toLive(F.DEMO_AMA),
};

function marketFor(pair) {
  const pc = F.DEMO_IDCA.pairContexts[pair] || {};
  const entryCtx = {
    regime: pc.regime, atrpPct: pc.atrpPct, entryScore: pc.entryScore,
    entryDecision: 'watch', reboundSignal: pc.reboundSignal,
    referencePrice: Math.round(pc.currentPrice * 1.045 * 100) / 100,
    requiredDipPct: 4.5,
  };
  const m = enrichMarket(normMarket({
    ...F.DEMO_MARKET.tickers[pair],
    candles: F.DEMO_MARKET.candles[pair],
    indicators: F.DEMO_MARKET.indicators[pair],
    provider: 'FIXTURE DEMO (sintético)',
  }), { entryCtx, sources: F.DEMO_MARKET.externalSources });
  m.candlesSource = 'qa-fixture';
  return m;
}
const marketBTC = marketFor('BTC/USD');
const marketETH = marketFor('ETH/USD');

const FIXTURES = {
  enginesData: {
    idca: { state: 'ok', data: enginesLive.idca },
    spot: { state: 'ok', data: enginesLive.spot },
    grid: { state: 'ok', data: enginesLive.grid },
    ama: { state: 'ok', data: enginesLive.ama },
  },
  common: {
    marketPairs: {
      'BTC/USD': { state: 'ok', data: marketBTC },
      'ETH/USD': { state: 'ok', data: marketETH },
    },
    market: { state: 'ok', data: marketBTC },
    portfolio: { state: 'ok', data: {
      summary: F.DEMO_PORTFOLIO.summary,
      holdings: F.DEMO_PORTFOLIO.balances,
      ledger: [],
      reservations: F.DEMO_PORTFOLIO.budgets.reservations,
      budgets: F.DEMO_PORTFOLIO.budgets.items,
      exchangeBalances: {
        revolutx: { connected: true, balances: { USD: 7451.11, BTC: 0.027909, ETH: 0.331 } },
        kraken: { connected: true, balances: { BTC: 0.02, EUR: 310.4 } },
      },
      prices: { BTC: 97340.25, ETH: 3284.10, USD: 1, EUR: 1.08 },
      resourceStates: { exchangeBalances: 'ok', prices: 'ok', summary: 'ok', holdings: 'ok' },
    } },
    activity: { state: 'ok', data: { events: F.DEMO_ACTIVITY.map(e => ({ ...e, mode: 'live' })) } },
    fisco: { state: 'ok', data: F.DEMO_FISCO, resourceStates: {} },
  },
};

// ---------- Verificaciones de datos por modo (fixtures, honesto) --------------
// «Niveles recibidos»: filas clasificadas por scope igual que chosen() en
// scoped-pages. «Condiciones de entrada/salida»: campos que el fixture declara.
function scopeCounts(rows, scope) {
  const all = Array.isArray(rows) ? rows : [];
  let visible = 0, other = 0, unknown = 0;
  for (const r of all) {
    const k = classifyMode(r);
    if (k === scope) visible++; else if (k === 'unknown') unknown++; else other++;
  }
  return { total: all.length, visible, other, unknown };
}
const modeChecks = {};
for (const scope of ['real', 'shadow']) {
  modeChecks[scope] = {
    idcaCycles: scopeCounts(F.DEMO_IDCA.cycles, scope),
    idcaOrders: scopeCounts(F.DEMO_IDCA.orders, scope),
    spotPositions: scopeCounts(F.DEMO_SPOT.positions, scope),
    spotTrades: scopeCounts(F.DEMO_SPOT.trades, scope),
    // SPOT no tiene fuente de órdenes: el fixture tampoco la trae → el panel
    // debe declarar «fuente no disponible», jamás «0 órdenes».
    spotOrdersSource: Array.isArray(F.DEMO_SPOT.orders) ? 'fixture' : 'ausente (correcto: sin endpoint)',
    gridCycles: scopeCounts(F.DEMO_GRID.cycles, scope),
    amaDecisions: scopeCounts(F.DEMO_AMA.trace?.decisions, scope),
    activityEvents: scopeCounts(F.DEMO_ACTIVITY, scope),
    entryExit: {
      idcaEntry: F.DEMO_IDCA.pairContexts['BTC/USD']
        ? { entryScore: F.DEMO_IDCA.pairContexts['BTC/USD'].entryScore,
            threshold: F.DEMO_IDCA.pairContexts['BTC/USD'].entryThreshold,
            reboundSignal: F.DEMO_IDCA.pairContexts['BTC/USD'].reboundSignal }
        : null,
      gridLevels: (F.DEMO_GRID.levels?.levels || []).map(l => ({ side: l.side, state: l.state })),
    },
  };
}
// Correspondencia compra/venta GRID: cada ciclo declara buyFillTs/sellFillTs.
// Solo se reporta lo que el fixture realmente contiene (nada inventado).
const gridCycles = F.DEMO_GRID.cycles || [];
const gridCheck = {
  total: gridCycles.length,
  conAmbasPatas: gridCycles.filter(c => c.buyFillTs && c.sellFillTs).length,
  compraSinVenta: gridCycles.filter(c => c.buyFillTs && !c.sellFillTs).length,
  sinCompra: gridCycles.filter(c => !c.buyFillTs).length,
  campos: gridCycles.length ? Object.keys(gridCycles[0]) : [],
  nota: 'buyFillTs = entrada ejecutada; sellFillTs = salida ejecutada. ' +
    'sellTargetPrice es objetivo, no ejecución.',
};

// ---------- Servidor estático de la app real + fixtures -----------------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  if (u.pathname === '/__fixtures.json') {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(FIXTURES));
    return;
  }
  let rel = decodeURIComponent(u.pathname);
  if (rel === '/' || rel === '/index.html') rel = '/index.html';
  const file = join(web, rel);
  if (!file.startsWith(web)) { res.statusCode = 403; res.end(); return; }
  try {
    const body = readFileSync(file);
    res.setHeader('content-type', MIME[file.slice(file.lastIndexOf('.'))] || 'application/octet-stream');
    res.end(body);
  } catch { res.statusCode = 404; res.end('not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

// ---------- Chrome headless + CDP (mismo mecanismo que qa-screens) ------------
mkdirSync(OUT, { recursive: true });
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
if (!debugPort) { chrome.kill(); server.close(); throw new Error('Chrome CDP no arrancó'); }
const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
const pageTarget = targets.find(t => t.type === 'page');
if (!pageTarget) { chrome.kill(); server.close(); throw new Error('Sin target page en CDP'); }
const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0;
const pending = new Map();
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++msgId; pending.set(i, { res, rej });
  ws.send(JSON.stringify({ id: i, method, params }));
});
const ev = async (expression, awaitPromise = false) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (r.exceptionDetails) throw new Error('evaluate: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result?.value;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
await send('Page.enable');
await send('Runtime.enable');
// Stub de red ANTES de cargar: /api/* no existe en QA → estado honesto de error;
// sesión QA en sessionStorage para que las pantallas rendericen autenticadas.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  try{ sessionStorage.setItem('nexa.session', JSON.stringify({token:'qa-${'x'.repeat(43)}',expiresAt:Date.now()+36e5,user:'qa',roles:['*'],csrf:'qa'})); }catch(e){}
  const __of = window.fetch.bind(window);
  window.fetch = (u,o)=>{ if(String(u).includes('/api/')) return Promise.resolve(new Response('{"success":false,"error":"qa-sin-backend"}',{status:503,headers:{'Content-Type':'application/json'}})); return __of(u,o); };
  window.__errs=[];
  window.addEventListener('error',e=>{window.__errs.push(String(e.message||e.error))});
  window.addEventListener('unhandledrejection',e=>{window.__errs.push('rej:'+String(e.reason))});
` });

// ---------- Recorrido ----------
const metrics = [];
const report = { steps: [], checks: [], modeChecks, gridCheck, files: [] };
const check = (name, ok, detail = '') => {
  report.checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

// Sonda de estado: historial NEXA, pantalla, bottomnav, botón ‹, scope y flags.
const PROBE = `(()=>{
  const h = history.state && history.state.nexa || null;
  const bn = [...document.querySelectorAll('#bottomnav a')].map(a=>a.textContent.trim());
  const scr = document.getElementById('screen');
  const txt = scr ? scr.innerText : '';
  return JSON.stringify({
    nav: h && h.nav ? {d:h.nav.depth,s:h.nav.section,sub:h.nav.sub,i:h.nav.inner,seq:h.seq,detail:h.detail} : null,
    histState: !!(history.state && history.state.nexa),
    screen: document.getElementById('app')?.dataset.screen,
    scope: document.getElementById('app')?.dataset.scope,
    mode: document.getElementById('app')?.dataset.mode,
    bn, backHidden: document.getElementById('back')?.hidden,
    hash: location.hash,
    ordenesMsg: /gateway no expone|Fuente no disponible/.test(txt),
    // «0 órdenes» citado en el disclaimer no cuenta: se busca un CONTADOR de
    // cero real (badge «N del entorno» o frase «0 órdenes» fuera de «»).
    ordenesCero: /0 del entorno/.test(txt) || /0 órdenes/.test(txt.replace(/«0 órdenes»/g, '')),
    txtHead: txt.slice(0,160),
  });
})()`;

const shot = async (name, w) => {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: HEIGHT, deviceScaleFactor: 1, mobile: true });
  await sleep(120);
  const evl = await send('Runtime.evaluate', { expression: METRICS_EXPR, returnByValue: true });
  let m = null; try { m = JSON.parse(evl.result.value); } catch { /* noop */ }
  const png = await send('Page.captureScreenshot', { format: 'png' });
  const file = `jq-${name}-${w}.png`;
  writeFileSync(join(OUT, file), Buffer.from(png.data, 'base64'));
  metrics.push({ name: `jq-${name}-${w}`, ...m });
  report.files.push(file);
};

// METRICS_EXPR: misma sonda que qa-screens (desbordamiento, tap targets, solape).
const METRICS_EXPR = `(()=>{const iw=innerWidth;
const clipped=el=>{for(let p=el.parentElement;p;p=p.parentElement){const o=getComputedStyle(p).overflowX;if(o==='hidden'||o==='auto'||o==='scroll'||o==='clip')return true}return false};
const over=[];
for(const el of document.querySelectorAll('body *')){
 const r=el.getBoundingClientRect();
 if(r.width===0||r.right<=iw+1||clipped(el))continue;
 const cs=(typeof el.className==='string'&&el.className)?'.'+el.className.trim().split(/\\s+/).join('.') :'';
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

// Pasos: act = expresión JS que pulsa controles REALES del DOM; expect = nav
// esperado en la entrada de historial tras la acción (null = solo capturar).
const CLICK = sel => `document.querySelector('${sel}')?.click()`;
const IDX = i => `#bottomnav [data-nav-idx="${i}"]`;

const JOURNEY = mode => [
  { name: 'inicio', expect: { d: 0 } },
  { name: 'modos', act: CLICK(IDX(2)), expect: { d: 1, s: 'engines' } },
  { name: 'spot', act: CLICK(IDX(2)), expect: { d: 2, sub: 'spot', i: 'panel' } },
  ...(mode === 'pro'
    ? [{ name: 'ordenes-spot', act: CLICK(IDX(3)), expect: { d: 2, sub: 'spot', i: 'orders' },
         flags: { ordenesMsg: true, ordenesCero: false } }]
    : [{ name: 'historial-spot', act: CLICK(IDX(2)), expect: { d: 2, sub: 'spot', i: 'trades' },
         flags: { sinOrdenes: true } }]),
  { name: 'back-sistema', act: 'history.back()', wait: 300, expect: { d: 2, sub: 'spot', i: 'panel' } },
  { name: 'back-boton-1', act: CLICK('#back'), expect: { d: 1, s: 'engines' } },
  { name: 'back-boton-2', act: CLICK('#back'), expect: { d: 0 } },
  { name: 'logo', act: CLICK('#brand-home'), expect: { d: 0 } },
];

async function runStep(step, mode, widths) {
  if (step.act) {
    if (step.act === 'history.back()') await ev('history.back()');
    else await ev(step.act);
  }
  await sleep(step.wait || 160);
  const probe = JSON.parse(await ev(PROBE));
  const tag = `${step.name}-${mode}`;
  report.steps.push({ tag, probe });
  const n = probe.nav || {};
  const exp = step.expect || {};
  const navOk = Object.entries(exp).every(([k, v]) => n[k] === v);
  check(`${tag} · nav`, navOk,
    `depth=${n.d} section=${n.s} sub=${n.sub} inner=${n.i} seq=${n.seq} screen=${probe.screen}`);
  if (step.flags) {
    if (step.flags.ordenesMsg !== undefined)
      check(`${tag} · mensaje fuente ausente`, probe.ordenesMsg === step.flags.ordenesMsg,
        probe.txtHead.slice(0, 80));
    if (step.flags.ordenesCero !== undefined)
      check(`${tag} · nunca «0 órdenes» sin fuente`, probe.ordenesCero === step.flags.ordenesCero);
    if (step.flags.sinOrdenes)
      check(`${tag} · sin pestaña Órdenes en Básico`, !probe.bn.some(x => /Órdenes/i.test(x)),
        probe.bn.join('|'));
  }
  for (const w of widths) await shot(tag, w);
  return probe;
}

try {
  // 1) Arranque real: navegar, desbloquear con PIN (setup ×2), saltar vinculación.
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
  await sleep(600);
  const unlock = await ev(`(async()=>{
    const sleep=ms=>new Promise(r=>setTimeout(r,ms));
    const seq='123456123456'; // setup pide 2×6; si el perfil ya tiene PIN basta 1×6
    let i=0;
    // Pulsar dígitos SOLO mientras el overlay de desbloqueo siga visible:
    // las teclas que llegan tarde después de afterUnlock registrarían fallos.
    for(;i<seq.length;i++){
      const u=document.getElementById('unlock-overlay');
      if(u&&u.classList.contains('hidden'))break;
      const k=seq[i];
      const b=document.querySelector('#pin-pad button[data-key="'+k+'"]');
      if(b)b.click();
      await sleep(90); // pbkdf2 (~100ms) entre etapas
    }
    for(let j=0;j<100;j++){
      const u=document.getElementById('unlock-overlay');
      if(u&&u.classList.contains('hidden'))break;
      await sleep(100);
    }
    for(let i=0;i<80;i++){const p=document.getElementById('pair-overlay');if(p&&!p.classList.contains('hidden'))break;await sleep(100);}
    const skip=document.getElementById('pair-skip');if(skip)skip.click();
    // Esperar a que el gate quede oculto del todo (unlock + pair) y la app pinte.
    for(let i=0;i<100;i++){
      const u=document.getElementById('unlock-overlay'),p=document.getElementById('pair-overlay');
      if(u&&p&&u.classList.contains('hidden')&&p.classList.contains('hidden')&&
         window.__nexa&&window.__nexa.ctx&&document.querySelector('#screen')&&document.querySelector('#screen').children.length)break;
      await sleep(100);
    }
    const u=document.getElementById('unlock-overlay'),p=document.getElementById('pair-overlay');
    return {ctx:!!(window.__nexa&&window.__nexa.ctx),unlockHidden:u?u.classList.contains('hidden'):null,pairHidden:p?p.classList.contains('hidden'):null};
  })()`, true);
  check('gate real · PIN + «Ahora no»', unlock.ctx && unlock.unlockHidden && unlock.pairHidden, JSON.stringify(unlock));

  // 2) Inyectar fixtures DEMO en el estado vivo y forzar render sin navegar.
  await ev(`(async()=>{
    const fx = await (await fetch('/__fixtures.json')).json();
    const c = window.__nexa.ctx;
    Object.assign(c.enginesData, fx.enginesData);
    Object.assign(c.data, fx.common);
    document.getElementById('mode-pro').click(); // render() sin pushState (preferencia)
    return true;
  })()`, true);
  await sleep(250);
  // Autodiagnóstico: ¿el handler delegado de app.js intercepta el click del dock?
  const selftest = await ev(`(async()=>{
    const sleep=ms=>new Promise(r=>setTimeout(r,ms));
    const a=document.querySelector('#bottomnav [data-nav-idx="2"]');
    if(!a)return {err:'no-anchor'};
    const me=new MouseEvent('click',{bubbles:true,cancelable:true});
    window.__cap=false;
    document.addEventListener('click',()=>{window.__cap=true},true);
    a.dispatchEvent(me);
    const st=history.state&&history.state.nexa||null;
    const out={defaultPrevented:me.defaultPrevented,hash:location.hash,cap:window.__cap,
      errs:(window.__errs||[]).slice(0,5),
      seq:st&&st.seq,depth:st&&st.nav&&st.nav.depth,screen:document.getElementById('app').dataset.screen};
    // Dejar el estado como estaba: si el click navegó, retroceder la entrada.
    if(st&&st.seq>0){history.back();await sleep(250);}
    else if(!me.defaultPrevented){ // fallback: el <a> navegó por hash → volver a Inicio
      document.getElementById('brand-home').click();await sleep(250);
    }
    return out;
  })()`, true);
  console.log('SELFTEST', JSON.stringify(selftest));
  report.checks.push({ name: 'selftest-click-delegado', ok: selftest.defaultPrevented === true, detail: JSON.stringify(selftest) });

  // 3) Recorrido Pro (REAL) y luego Básico.
  for (const mode of ['pro', 'basic']) {
    if (mode === 'basic') {
      const seqBefore = (JSON.parse(await ev(PROBE)).nav || {}).seq;
      await ev(`document.getElementById('mode-basic').click()`);
      await sleep(200);
      const p = JSON.parse(await ev(PROBE));
      report.steps.push({ tag: 'mode-basic', probe: p });
      check('mode-basic · preferencia sin entrada de historial',
        p.histState && p.nav && p.nav.d === 0 && p.nav.seq === seqBefore,
        `seq ${seqBefore}→${p.nav?.seq} depth=${p.nav?.d}`);
      for (const w of WIDTHS) await shot('mode-basic', w);
    }
    for (const step of JOURNEY(mode)) await runStep(step, mode, WIDTHS);
  }

  // 4) REAL/SHADOW es preferencia persistente: no debe apilar historial.
  const before = JSON.parse(await ev(PROBE));
  await ev(`document.getElementById('scope-shadow').click()`);
  await sleep(200);
  const after = JSON.parse(await ev(PROBE));
  check('scope-shadow · no crea entrada de historial',
    after.histState && before.nav && after.nav && after.nav.seq === before.nav.seq && after.scope === 'shadow',
    `seq ${before.nav?.seq}→${after.nav?.seq} scope=${after.scope}`);
  // El back del sistema debe saltar el toggle y volver a la entrada anterior.
  await ev('history.back()');
  await sleep(300);
  const back = JSON.parse(await ev(PROBE));
  report.steps.push({ tag: 'scope-back-sistema', probe: back });
  check('scope-back · retrocede navegación, no el toggle', back.scope === 'shadow', `scope=${back.scope} depth=${back.nav?.d}`);
  await ev(`document.getElementById('scope-real').click()`);
  await sleep(150);

  // 5) Métricas: ninguna captura debe desbordar ni romper tap targets ni solape.
  const bad = metrics.filter(m => (m.over && m.over.length) || (m.tapBad && m.tapBad.length) || m.padOk === false);
  check('métricas · sin desbordamiento/tap<44/solape', bad.length === 0,
    bad.length ? bad.map(b => b.name).join(', ') : `${metrics.length} capturas OK`);
} finally {
  ws.close();
  chrome.kill();
  server.close();
}
writeFileSync(join(OUT, 'qa-metrics.json'), JSON.stringify(metrics, null, 2));
writeFileSync(join(OUT, 'qa-journey-report.json'), JSON.stringify(report, null, 2));
const fails = report.checks.filter(c => !c.ok);
console.log(`\n${report.files.length} capturas en ${OUT}`);
console.log(`${report.checks.length - fails.length}/${report.checks.length} checks OK` +
  (fails.length ? ` — FALLOS: ${fails.map(f => f.name).join(' | ')}` : ''));
process.exit(fails.length ? 1 : 0);
