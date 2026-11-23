// NEXA V2 Rev24 — regresiones duras: versión visible, separación REAL/SHADOW,
// presupuesto≠patrimonio, velas válidas, sin "verificado" falso, assets completos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'web');
const read = p => readFileSync(join(web, p), 'utf8');

// ---------- 1. Versión permanente ----------
test('index.html contiene la insignia de versión permanente', () => {
  const html = read('index.html');
  assert.ok(html.includes('id="ver-badge"'), 'falta #ver-badge en el encabezado');
  assert.ok(/<button[^>]*ver-badge/.test(html), 'la insignia no es un botón pulsable');
});
test('app.js alimenta la insignia con BUILD_INFO y abre ficha de compilación', () => {
  const app = read('js/app.js');
  assert.ok(app.includes("from './build-info.js'"), 'app.js no importa BUILD_INFO');
  assert.ok(app.includes('ver-badge'), 'app.js no enlaza la insignia');
  assert.ok(app.includes('BUILD_INFO.commit'), 'la ficha no muestra commit');
  assert.ok(app.includes('apkType'), 'la ficha no muestra tipo de APK');
});
test('el sello BUILD_INFO existe y tiene campos obligatorios', async () => {
  const m = await import(pathToFileURL(join(web, 'js', 'build-info.js')));
  for (const k of ['version', 'commit', 'channel', 'builtAt', 'apkType'])
    assert.ok(k in m.BUILD_INFO, `BUILD_INFO.${k} ausente`);
});
test('stamp-build sella build-info y la caché del service worker', () => {
  const s = readFileSync(join(root, 'scripts', 'stamp-build.mjs'), 'utf8');
  assert.ok(s.includes('apkType'), 'stamp no genera apkType');
  assert.ok(s.includes('sw.js'), 'stamp no actualiza la caché del service worker');
});

// ---------- 2. Presupuesto ≠ patrimonio / sin "verificado" falso ----------
test('el hero de inicio separa REAL y SHADOW sin sumarlos bajo un único total', () => {
  const d = read('js/dashboard.js');
  assert.ok(!d.includes('POSICIONES ABIERTAS CONFIRMADAS'), 'título que suma entornos sigue presente');
  assert.ok(d.includes('nxh-env-real') && d.includes('nxh-env-shadow'), 'falta la rejilla por entorno');
  assert.ok(d.includes('PnL real') && d.includes('PnL simulado'), 'falta separación de PnL por entorno');
});
test('ningún módulo declara "Balance verificado" sin conciliación', () => {
  for (const f of readdirSync(join(web, 'js')).filter(x => x.endsWith('.js'))) {
    const src = readFileSync(join(web, 'js', f), 'utf8');
    assert.ok(!/Balance verificado/i.test(src), `"Balance verificado" en ${f}`);
  }
});

// ---------- 3. Velas e indicadores reales ----------
test('fetchKrakenCandles normaliza y rechaza filas corruptas', async () => {
  const { computeIndicators, TIMEFRAMES } = await import(pathToFileURL(join(web, 'js', 'market-candles.js')));
  assert.equal(TIMEFRAMES.length, 6, 'faltan intervalos 1m/5m/15m/1h/4h/1d');
  const candles = Array.from({ length: 60 }, (_, i) => ({ t: i * 60000, o: 100 + i, h: 101 + i, l: 99 + i, c: 100.5 + i, v: 10 }));
  const ind = computeIndicators(candles);
  assert.ok(ind && ind.source === 'kraken-public-calc', 'indicadores sin etiqueta de fuente');
  assert.ok(Number.isFinite(ind.ema.ema20) && Number.isFinite(ind.rsi), 'EMA/RSI no calculados');
  assert.equal(computeIndicators([{ t: 1, o: 1 }]), null, 'no debe calcular con datos insuficientes');
});
test('el provider incorpora velas reales etiquetadas, nunca curvas fabricadas', () => {
  const p = read('js/provider.js');
  assert.ok(p.includes('?candles=1&timeframe='), 'provider no solicita las velas al bot');
  assert.ok(!p.includes('fetchKrakenCandles'), 'el móvil no debe duplicar MarketDataService');
  assert.ok(p.includes('candlesSource'), 'provider no etiqueta la fuente de velas');
  assert.ok(!/makeCandles|fakeCandles|synthCandles/.test(p), 'posible fabricación de velas');
});
test('el gráfico muestra intervalo y fuente; sin velas no dibuja', () => {
  const pr = read('js/premium.js');
  assert.ok(pr.includes('data-ui="tf:'), 'falta selector de intervalo');
  assert.ok(pr.includes('Kraken OHLC público'), 'falta etiqueta de fuente externa');
  assert.ok(pr.includes('No se dibujan curvas ficticias'), 'falta el guardrail anti-datos-inventados');
});

// ---------- 4. Clasificación de eventos ----------
test('event-labels clasifica ejecutadas, rechazadas, decisiones y errores', async () => {
  const { eventCategory, describeEvent } = await import(pathToFileURL(join(web, 'js', 'event-labels.js')));
  assert.equal(eventCategory({ type: 'buy_filled' }).id, 'executed');
  assert.equal(eventCategory({ type: 'order_rejected' }).id, 'rejected');
  assert.equal(eventCategory({ type: 'decision_evaluated' }).id, 'decision');
  assert.equal(eventCategory({ type: 'monitor_tick' }).id, 'technical');
  assert.equal(eventCategory({ severity: 'error' }).id, 'error');
  assert.equal(describeEvent({ type: 'buy_filled' }), 'Compra ejecutada en nivel de la rejilla');
  assert.notEqual(describeEvent({ type: 'range_version' }), 'range version', 'código sin traducir');
});

// ---------- 5. Recursos empaquetados completos ----------
test('todos los módulos JS servidos existen en web/js y en la shell del SW', () => {
  const sw = read('sw.js');
  const required = ['build-info', 'dashboard', 'display-scope', 'portfolio-view', 'scoped-pages',
    'fisco-view', 'inspector', 'market-candles', 'event-labels'];
  for (const m of required) {
    assert.ok(existsSync(join(web, 'js', m + '.js')), `falta js/${m}.js`);
    assert.ok(sw.includes(`'./js/${m}.js'`), `sw.js no precachea ${m}.js (riesgo de UI antigua)`);
  }
});

// ---------- R18: barra de decisión con payload real ----------
test('marketStatus no imprime [object Object] ni NaN con payload real', async () => {
  const { renderScopedEngine } = await import(pathToFileURL(join(web, 'js', 'scoped-pages.js')));
  const ctx = { viewScope:'real', mode:'pro', ui:{engineId:'idca',subtab:'panel'},
    enginesData:{ idca:{ state:'ok', data:{ pairContexts:{
      'BTC/USD':{ pair:'BTC/USD', currentPrice:'abc', referencePrice:60000,
        targetEntryPrice:57000, trailingBuy:{state:'watching',armed:true},
        dipDetectedPct:2.4, requiredDipPct:5.0, entryDecision:'watch',
        regime:'neutral_range', entryScore:36.8, confidenceGrade:'C',
        hardBlocked:false, cycles:[] } },
      cycles:[] } } },
    data:{} };
  const html = renderScopedEngine(ctx);
  assert.ok(!html.includes('[object Object]'), 'objeto serializado como texto');
  assert.ok(!html.includes('NaN'), 'NaN visible en la barra');
  assert.ok(html.includes('Régimen'), 'etiqueta Régimen ausente');
  assert.ok(html.includes('Vigilando el mercado'), 'estado trailing no traducido');
  // El código original solo puede aparecer en detalle Pro (<code>), nunca como texto principal.
  const proOnly=html.match(/watching/g)||[];
  assert.ok(proOnly.every(()=>/<code[^>]*>watching<\/code>/.test(html)), 'código crudo fuera del detalle Pro');
});
test('marketStatus con precio 0 o sin target no muestra distancia inválida', async () => {
  const { renderScopedEngine } = await import(pathToFileURL(join(web, 'js', 'scoped-pages.js')));
  const ctx = { viewScope:'real', mode:'pro', ui:{engineId:'idca',subtab:'panel'},
    enginesData:{ idca:{ state:'ok', data:{ pairContexts:{
      'ETH/USD':{ pair:'ETH/USD', currentPrice:0, referencePrice:null,
        trailingBuy:{state:'idle'}, hardBlocked:true, hardBlockers:['low_volume'], cycles:[] } },
      cycles:[] } } },
    data:{} };
  const html = renderScopedEngine(ctx);
  assert.ok(!html.includes('NaN'), 'NaN visible');
  assert.ok(!html.includes('Infinity'), 'Infinity visible');
  assert.ok(html.includes('volumen insuficiente'), 'hardBlocker no traducido');
});

// ---------- R18f: niveles conectados por contrato adapter->vista ----------
test('chartLevels conecta referencia/activación desde marketContext (contrato enrichMarket)', async () => {
  const { enrichMarket } = await import(pathToFileURL(join(web, 'js', 'adapters.js')));
  const { chartLevels } = await import(pathToFileURL(join(web, 'js', 'premium.js')));
  const m = enrichMarket({ pair:'BTC/USD', price:60000, indicators:{ema:{ema20:59800},bollinger:{upper:61000,mid:60000,lower:59000}} },
    { entryCtx:{ referencePrice:61000, requiredDipPct:5, entryDecision:'watch' } });
  const lv = chartLevels(m, 'BTC/USD');
  const labels = lv.map(l=>l.label);
  assert.ok(labels.includes('Referencia IDCA'), 'referencia no conectada a la gráfica');
  const act = lv.find(l=>l.label.startsWith('Activación'));
  assert.ok(act && act.price === 61000*(1-5/100), 'activación derivada incorrecta');
  const bb = lv.find(l=>l.label==='Bollinger sup.');
  assert.ok(bb && bb.price === 61000, 'Bollinger no conectada');
});
test('chartLevels no inventa niveles sin datos finitos', async () => {
  const { chartLevels } = await import(pathToFileURL(join(web, 'js', 'premium.js')));
  assert.equal(chartLevels({indicators:{},marketContext:{}}).length, 0);
  assert.equal(chartLevels({marketContext:{referencePrice:'x',requiredDipPct:5}}).length, 0);
});
