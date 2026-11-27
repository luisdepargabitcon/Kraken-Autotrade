// VWAP numeric audit — production copy vs reference
// src: IdcaSmartLayer.ts computeVwapAnchored (3ae1831 == main)
function computeVwapAnchored(candles, anchorTimeMs) {
  const anchor = anchorTimeMs ?? 0;
  const slice = anchor > 0 ? candles.filter(c => c.time >= anchor) : candles;
  if (slice.length < 5) return { vwap: 0, isReliable: false, reason: "insufficient" };
  let cumulativeTPV = 0, cumulativeVol = 0;
  for (const c of slice) {
    const tp = (c.high + c.low + c.close) / 3;
    const vol = c.volume ?? 0;
    cumulativeTPV += tp * vol;
    cumulativeVol += vol;
  }
  if (cumulativeVol === 0) return { vwap: 0, isReliable: false, reason: "zero vol" };
  const vwap = cumulativeTPV / cumulativeVol;
  const VWAP_SIGMA_MIN = 24;
  const sigmaSlice = slice.length < VWAP_SIGMA_MIN && candles.length >= VWAP_SIGMA_MIN
    ? candles.slice(-Math.max(VWAP_SIGMA_MIN, slice.length)) : slice;
  const sigmaVol = sigmaSlice.reduce((s, c) => s + (c.volume ?? 1), 0);
  const wssd = sigmaSlice.reduce((s, c) => {
    const tp = (c.high + c.low + c.close) / 3;
    return s + (c.volume ?? 1) * Math.pow(tp - vwap, 2);
  }, 0);
  const stdDev = Math.sqrt(wssd / (sigmaVol || 1));
  return { vwap, stdDev, upperBand2: vwap + 2 * stdDev, lowerBand2: vwap - 2 * stdDev, candlesUsed: slice.length, candlesForSigma: sigmaSlice.length, isReliable: true };
}
function refVwap(candles) {
  let tpv = 0, v = 0;
  for (const c of candles) { const tp = (c.high + c.low + c.close) / 3; tpv += tp * c.volume; v += c.volume; }
  return tpv / v;
}
function mkc(i, price, vol) { return { time: i * 3600000, high: price * 1.01, low: price * 0.99, close: price, volume: vol }; }
let pass = 0, fail = 0;
function check(n, c, d) { if (c) { pass++; console.log(`PASS ${n} ${d ?? ""}`); } else { fail++; console.log(`FAIL ${n} ${d ?? ""}`); } }

// T9: uniform candles — vwap equals reference
{
  const candles = []; for (let i = 0; i < 30; i++) candles.push(mkc(i, 100 + Math.sin(i) * 2, 10));
  const prod = computeVwapAnchored(candles, 0);
  const ref = refVwap(candles);
  console.log(`INFO vwap prod=${prod.vwap.toFixed(5)} ref=${ref.toFixed(5)}`);
  check("T9 VWAP matches reference (no anchor)", Math.abs(prod.vwap - ref) < 1e-9, "");
}
// T10: anchor filtering — vwap of post-anchor slice only
{
  const candles = []; for (let i = 0; i < 30; i++) candles.push(mkc(i, 100 + i, 10));
  const anchorTime = candles[20].time;
  const prod = computeVwapAnchored(candles, anchorTime);
  const ref = refVwap(candles.slice(20));
  console.log(`INFO anchored vwap prod=${prod.vwap.toFixed(4)} ref(post-anchor)=${ref.toFixed(4)}`);
  check("T10 anchored VWAP matches post-anchor reference", Math.abs(prod.vwap - ref) < 1e-9, "");
}
// T11: sigma window extension — candlesForSigma >= candlesUsed when anchor recent
{
  const candles = []; for (let i = 0; i < 30; i++) candles.push(mkc(i, 100 + Math.sin(i) * 5, 10));
  const anchorTime = candles[24].time; // only 6 candles post-anchor
  const prod = computeVwapAnchored(candles, anchorTime);
  console.log(`INFO candlesUsed=${prod.candlesUsed} candlesForSigma=${prod.candlesForSigma}`);
  check("T11 sigma extended to 24 when anchor slice small", prod.candlesUsed === 6 && prod.candlesForSigma === 24, `used=${prod.candlesUsed} sigma=${prod.candlesForSigma}`);
}
// T12: volume weighting — heavier candles dominate
{
  const candles = [mkc(0, 100, 1), mkc(1, 100, 1), mkc(2, 100, 1), mkc(3, 100, 1), mkc(4, 200, 100)];
  const prod = computeVwapAnchored(candles, 0);
  // ref: TP100=(101+99*0.99... ) compute: high=101,low=99,close=100 -> tp=100; heavy: high=202,low=198,close=200 -> tp=200
  const expected = (100 * 4 + 200 * 100) / 104;
  console.log(`INFO weighted vwap prod=${prod.vwap.toFixed(4)} expected=${expected.toFixed(4)}`);
  check("T12 volume weighting correct", Math.abs(prod.vwap - expected) < 1e-6, "");
}
// T13: zero volume -> unreliable
{
  const candles = []; for (let i = 0; i < 10; i++) candles.push(mkc(i, 100, 0));
  const prod = computeVwapAnchored(candles, 0);
  check("T13 zero volume -> unreliable", prod.isReliable === false, "");
}
// T14: insufficient candles -> unreliable
{
  const candles = [mkc(0, 100, 10), mkc(1, 100, 10)];
  const prod = computeVwapAnchored(candles, 0);
  check("T14 <5 candles -> unreliable", prod.isReliable === false, "");
}
console.log(`\nRESULT: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
