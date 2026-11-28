// NEXA V2 Fase 2A — Mercado: una responsabilidad por subpestaña, frescura real
// y traducción de contexto. Contratos verificados contra el VPS:
//  - /api/market devuelve ticker sin velas; change24h:"0.00" va hardcodeado.
//  - normMarket conserva lastCandleTs/candleAgeMs/candlesStale/dataState.
//  - entry-diagnostics emite códigos crudos (ARM_TRAILING, neutral_range…).
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
const { normMarket, enrichMarket } = await imp('adapters.js');
const { renderMarketPremium } = await imp('premium.js');
const { renderDashboard } = await imp('dashboard.js');
const { translateCode } = await imp('event-labels.js');

const NOW = Date.now();
const iso = ms => new Date(NOW - ms).toISOString();
const mctx = (data, sub='price', mode='pro', pair='BTC/USD') => ({
  mode, viewScope:'real', authenticated:true,
  ui:{ marketPair:pair, marketSub:sub },
  data:{ market:{ state:'ok', data } },
  enginesData:{},
});

// ---------- normMarket: frescura real ----------
test('normMarket mapea timestamp/lastCandleTs a ts/candleTs parseables y conserva el estado de velas', () => {
  const m = normMarket({
    id:'BTC/USD', pair:'BTC/USD', price:'60371.8', volume24h:5801.86,
    change24h:'0.00', timestamp: iso(5*60000),
    lastCandleTs: NOW-10*60000, candleAgeMs: 45000, candlesStale:true,
    dataState:'stale', candleTimeframe:'15', candlesSource:'bot-market-data',
  });
  assert.equal(m.price, 60371.8, 'precio string decimal parseado');
  assert.equal(m.change24h, 0);
  assert.equal(m.change24hPct, null, 'sin % explícito no se inventa');
  assert.equal(typeof m.ts, 'number');
  assert.ok(Math.abs(m.ts-(NOW-5*60000))<2000, 'ts = timestamp de cotización');
  assert.equal(m.candleTs, NOW-10*60000);
  assert.equal(m.candleAgeMs, 45000);
  assert.equal(m.candlesStale, true);
  assert.equal(m.dataState, 'stale');
  assert.equal(m.candleTimeframe, '15');
});
test('normMarket sin fechas parseables deja ts null (la UI muestra —, no una edad falsa)', () => {
  const m = normMarket({ pair:'BTC/USD', price:100, timestamp:'no-es-fecha', lastCandleTs:{} });
  assert.equal(m.ts, null);
  assert.equal(m.candleTs, null);
});
test('normMarket prefiere timestamp de cotización y usa lastCandleTs como respaldo', () => {
  const only = normMarket({ pair:'BTC/USD', price:1, lastCandleTs: iso(60000) });
  assert.equal(only.ts, only.candleTs, 'sin timestamp de cotización se usa la vela');
  const epochS = normMarket({ pair:'BTC/USD', price:1, timestamp: Math.floor(NOW/1000) });
  assert.ok(epochS.ts > 1e12, 'epoch segundos normalizado a ms');
});

// ---------- change24h honesto ----------
test('change24h: % explícito → porcentaje; absoluto ≠0 → Δ $; 0/ausente → — con nota', () => {
  const pct = renderMarketPremium(mctx({ pair:'BTC/USD', price:100, change24hPct:-1.5 }));
  assert.match(pct, /1,50 %/);
  const abs = renderMarketPremium(mctx({ pair:'BTC/USD', price:100, change24h:-12.5 }));
  assert.ok(abs.includes('Δ'), 'absoluto distinto de 0 sí se muestra como Δ');
  assert.ok(abs.includes('12,50'), 'monto del Δ visible');
  for (const data of [
    { pair:'BTC/USD', price:100, change24h:0 },
    { pair:'BTC/USD', price:100 },
    { pair:'BTC/USD', price:100, change24h:'0.00' },
  ]) {
    const h = renderMarketPremium(mctx(data));
    assert.ok(!h.includes('Δ'), `sin % fiable no hay Δ: ${JSON.stringify(data)}`);
    assert.ok(h.includes('no reporta una variación 24h fiable'), 'nota honesta presente');
  }
});

// ---------- Frescura en render ----------
test('Mercado muestra «Datos de hace X» desde ts/timestamp/lastCandleTs reales', () => {
  const h1 = renderMarketPremium(mctx({ pair:'BTC/USD', price:100, ts: iso(3*60000) }));
  assert.ok(h1.includes('Datos de hace'), 'edad desde ts');
  const h2 = renderMarketPremium(mctx({ pair:'BTC/USD', price:100, timestamp: iso(4*60000) }));
  assert.ok(h2.includes('Datos de hace'), 'edad desde timestamp crudo');
  const h3 = renderMarketPremium(mctx({ pair:'BTC/USD', price:100, lastCandleTs: iso(7*60000) }));
  assert.ok(h3.includes('Datos de hace'), 'edad desde lastCandleTs');
  const h4 = renderMarketPremium(mctx({ pair:'BTC/USD', price:100, candleAgeMs: 120000 }));
  assert.ok(h4.includes('Velas de hace'), 'edad desde candleAgeMs');
  const h5 = renderMarketPremium(mctx({ pair:'BTC/USD', price:100 }));
  assert.ok(!h5.includes('Datos de hace')&&!h5.includes('Velas de hace'), 'sin fecha → sin edad inventada');
});
test('candlesStale/dataState stale muestran aviso de velas antiguas', () => {
  const h = renderMarketPremium(mctx({ pair:'BTC/USD', price:100, ts: iso(60000), candlesStale:true, dataState:'stale' }));
  assert.ok(h.includes('Velas antiguas'), 'aviso de velas antiguas');
});


test('normMarket conserva procedencia nueva y premium muestra parcial/degradado sin romper ausencias', () => {
  const m = normMarket({
    pair:'BTC/USD', price:100, timestamp: iso(60000), origin:'db_fallback',
    providerTs: NOW-120000, receivedAt: NOW-60000, cachedAt: NOW-30000,
    validity:'valid', dataState:'partial', warmup:false,
  });
  assert.equal(m.origin, 'db_fallback');
  assert.equal(m.providerTs, NOW-120000);
  assert.equal(m.receivedAt, NOW-60000);
  assert.equal(m.cachedAt, NOW-30000);
  const h = renderMarketPremium(mctx(m));
  assert.ok(h.includes('respaldo de BD'), 'origen traducido');
  assert.ok(h.includes('parcial'), 'estado parcial visible');
  const warm = renderMarketPremium(mctx({ ...m, warmup:true }));
  assert.ok(warm.includes('warm-up insuficiente'), 'warm-up visible');
  const missing = renderMarketPremium(mctx({ pair:'BTC/USD', price:100 }));
  assert.ok(!missing.includes('respaldo de BD'), 'sin origen no se inventa');
});

// ---------- Traducción de contexto ----------
test('translateCode cubre los códigos crudos de entry-diagnostics/trailingBuy', () => {
  assert.equal(translateCode('ARM_TRAILING'), 'Armado · esperando rebote de confirmación');
  assert.equal(translateCode('arm_trailing'), 'Armado · esperando rebote de confirmación');
  assert.equal(translateCode('inactive'), 'Inactivo');
  assert.equal(translateCode('neutral_range'), 'Rango neutro');
  assert.equal(translateCode('vwap_anchor'), 'Referencia VWAP');
  assert.equal(translateCode('CAPITULACION'), 'Capitulación');
  assert.equal(translateCode('capitulation'), 'Capitulación');
  assert.equal(translateCode('wait_pullback'), 'En espera de retroceso');
  assert.equal(translateCode('watching'), 'Vigilando el mercado');
});
const entryCtx = {
  regime:'neutral_range', atrpPct:0.73, entryScore:62.5, confidenceGrade:'B',
  entryDecision:'wait_pullback', dipDetectedPct:6.37, requiredDipPct:1.35,
  reboundSignal:'ARM_TRAILING', hardBlocked:false,
  referencePrice:64520.3, targetEntryPrice:60100, nextBuyPrice:59000,
};
test('Panel de contexto (Indicadores): traduce códigos, separa AMA/IDCA y usa % coherentes', () => {
  const m = enrichMarket(normMarket({ pair:'BTC/USD', price:60000, change24h:1.2, timestamp: iso(60000) }),
    { marketView:{ pair:'BTC/USD', macroZone:'risk_off', currentDropPct:6.1, reboundFromLowPct:2.4 },
      entryCtx });
  const h = renderMarketPremium(mctx(m, 'indicators'));
  assert.ok(h.includes('CONTEXTO'), 'panel de contexto presente en Indicadores');
  assert.ok(h.includes('AMA · mercado'), 'grupo AMA identificado');
  assert.ok(h.includes('IDCA · decisión'), 'grupo IDCA identificado');
  assert.ok(h.includes('Armado · esperando rebote de confirmación'), 'ARM_TRAILING traducido');
  assert.ok(h.includes('En espera de retroceso'), 'wait_pullback traducido');
  assert.ok(h.includes('Rango neutro'), 'neutral_range traducido');
  assert.ok(h.includes('6,37 %') && h.includes('1,35 %'), 'caída/requerida en %');
  // En Pro el código crudo solo aparece dentro de <code> (detalle).
  const rawHits = h.match(/ARM_TRAILING/g) || [];
  assert.ok(rawHits.every(() => /<code[^>]*>ARM_TRAILING<\/code>/.test(h)), 'código crudo fuera de <code>');
});
test('Contexto para ETH/USD no muestra campos AMA como si aplicaran', () => {
  const m = enrichMarket(normMarket({ pair:'ETH/USD', price:3000, timestamp: iso(60000) }),
    { marketView:{ pair:'BTC/USD', macroZone:'risk_off', currentDropPct:6.1 }, entryCtx });
  const h = renderMarketPremium(mctx(m, 'indicators', 'pro', 'ETH/USD'));
  assert.ok(h.includes('solo publica BTC/USD'), 'nota honesta de cobertura AMA');
  assert.ok(!h.includes('risk_off'), 'zona macro AMA no se muestra para ETH');
  assert.ok(h.includes('IDCA · decisión'), 'el contexto IDCA sí aplica por par');
});
test('Precio no lleva contexto IDCA ni gráfica; cada subpestaña su contenido', () => {
  const m = enrichMarket(normMarket({ pair:'BTC/USD', price:60000, timestamp: iso(60000) }), { entryCtx });
  const price = renderMarketPremium(mctx(m, 'price'));
  assert.ok(!price.includes('CONTEXTO'), 'sin panel de contexto en Precio');
  assert.ok(!price.includes('nxp-chart-interactive'), 'sin gráfica en Precio');
  const chart = renderMarketPremium(mctx(m, 'chart'));
  assert.ok(!chart.includes('CONTEXTO'), 'sin contexto en Gráfico');
  const basic = renderMarketPremium(mctx(m, 'price', 'basic'));
  assert.ok(basic.includes('Fuente y frescura'), 'Precio básico sí muestra fuente/frescura');
});

// ---------- dashboard classifyMode ----------
test('El hero de Inicio clasifica entornos con classifyMode (modo production → REAL)', () => {
  const ctx = {
    mode:'basic', viewScope:'real', authenticated:true,
    ui:{},
    data:{
      portfolio:{ state:'ok', data:{ summary:{}, resourceStates:{} } },
      market:{ state:'ok', data:{ pair:'BTC/USD', price:100 } },
      activity:{ state:'ok', data:{ events:[] } },
    },
    enginesData:{
      idca:{ state:'ok', data:{ status:{ mode:'live' }, cycles:[
        { id:1, pair:'BTC/USD', status:'open', mode:'production', capitalUsedUsd:100 },
        { id:2, pair:'ETH/USD', status:'open', mode:'dry_run', capitalUsedUsd:50 },
      ] } },
      spot:{ state:'ok', data:{ status:{ mode:'live' }, positions:[] } },
      grid:{ state:'ok', data:{ status:{ mode:'live' }, cycles:[] } },
      ama:{ state:'ok', data:{ status:{ mode:'live' }, cycles:[] } },
    },
  };
  const h = renderDashboard(ctx);
  // 'production' no estaba en el set local antiguo → ahora cuenta como REAL.
  assert.ok(h.includes('1 posiciones'), 'posición production contada en REAL');
  assert.ok(!h.includes('sin entorno verificado'), 'sin registros unknown');
});
