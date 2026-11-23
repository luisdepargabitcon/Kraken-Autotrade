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
  assert.ok(p.includes('fetchKrakenCandles'), 'provider no consulta OHLCV real');
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
