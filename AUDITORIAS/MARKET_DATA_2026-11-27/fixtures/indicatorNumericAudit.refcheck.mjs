// Numeric audit: compare production algorithms (verbatim copies with provenance)
// against reference implementations. No network, no private data.

// ─── PRODUCTION COPIES ───
// src: server/services/indicators.ts@3ae1831 L27-37
function calculateEMA(prices, period) {
  if (prices.length === 0) return 0;
  const multiplier = 2 / (period + 1);
  let ema = prices[0];
  for (let i = 1; i < prices.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema;
  }
  return ema;
}
// src: indicators.ts L68-89 (MACD)
function calculateMACD(prices) {
  if (prices.length < 26) return { macd: 0, signal: 0, histogram: 0 };
  const ema12 = calculateEMA(prices.slice(-12), 12);
  const ema26 = calculateEMA(prices.slice(-26), 26);
  const macd = ema12 - ema26;
  const macdHistory = [];
  for (let i = 26; i <= prices.length; i++) {
    const e12 = calculateEMA(prices.slice(i - 12, i), 12);
    const e26 = calculateEMA(prices.slice(i - 26, i), 26);
    macdHistory.push(e12 - e26);
  }
  const signal = macdHistory.length >= 9 ? calculateEMA(macdHistory.slice(-9), 9) : 0;
  const histogram = macd - signal;
  return { macd, signal, histogram };
}
// src: indicators.ts L92-116 (Bollinger)
function calculateBollingerBands(prices, period = 20, mult = 2) {
  if (prices.length < period) {
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    return { upper: avg, middle: avg, lower: avg, percentB: 50 };
  }
  const recent = prices.slice(-period);
  const middle = recent.reduce((a, b) => a + b, 0) / period;
  const stdDev = Math.sqrt(recent.reduce((s, p) => s + Math.pow(p - middle, 2), 0) / period);
  const upper = middle + mult * stdDev;
  const lower = middle - mult * stdDev;
  const cur = prices[prices.length - 1];
  const percentB = ((cur - lower) / (upper - lower)) * 100;
  return { upper, middle, lower, percentB };
}
// src: indicators.ts L39-56 (RSI)
function calculateRSI(prices) {
  if (prices.length < 2) return 50;
  let gains = 0, losses = 0;
  for (let i = 1; i < prices.length; i++) {
    const ch = prices[i] - prices[i - 1];
    if (ch > 0) gains += ch; else losses -= ch;
  }
  const avgGain = gains / (prices.length - 1);
  const avgLoss = losses / (prices.length - 1);
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}
// src: IdcaSmartLayer.ts computeEMA (full-series EMA, seeded with first value)
function computeEMAseries(values, period) {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const ema = [values[0]];
  for (let i = 1; i < values.length; i++) ema.push(values[i] * k + ema[i - 1] * (1 - k));
  return ema;
}

// ─── REFERENCE IMPLEMENTATIONS (independent) ───
function refEMAseriesSMAseed(values, period) {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const seed = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const out = new Array(values.length).fill(null);
  out[period - 1] = seed;
  for (let i = period; i < values.length; i++) out[i] = values[i] * k + out[i - 1] * (1 - k);
  return out;
}
function refRSIWilder(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) g += d; else l += Math.abs(d);
  }
  let avgG = g / period, avgL = l / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgG = (avgG * (period - 1) + Math.max(d, 0)) / period;
    avgL = (avgL * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (avgL === 0) return 100;
  return 100 - 100 / (1 + avgG / avgL);
}
function refBollingerSample(prices, period = 20, mult = 2) {
  const recent = prices.slice(-period);
  const middle = recent.reduce((a, b) => a + b, 0) / period;
  const variance = recent.reduce((s, p) => s + Math.pow(p - middle, 2), 0) / (period - 1);
  const sd = Math.sqrt(variance);
  return { middle, upper: middle + mult * sd, lower: middle - mult * sd, sd };
}

// ─── TEST DATA: deterministic synthetic ───
function walk(n, start = 100, seed = 42) {
  let x = seed; const out = [start];
  for (let i = 1; i < n; i++) { x = (x * 1103515245 + 12345) % 2147483648; out.push(out[i - 1] * (1 + ((x / 2147483648) - 0.5) * 0.04)); }
  return out;
}
const prices100 = walk(100);
const prices30 = walk(30, 100, 7);

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS ${name} ${detail ?? ""}`); }
  else { fail++; console.log(`FAIL ${name} ${detail ?? ""}`); }
}
function approx(a, b, tol) { return Math.abs(a - b) <= tol; }

// T1: production calculateEMA seeds with prices[0] — deviation from SMA-seeded reference
{
  const prodEnd = calculateEMA(prices100, 20);
  const ref = refEMAseriesSMAseed(prices100, 20);
  const refEnd = ref[ref.length - 1];
  const devPct = Math.abs(prodEnd - refEnd) / refEnd * 100;
  console.log(`INFO EMA20 seed-deviation after 100 pts: ${devPct.toFixed(4)}% (prod=${prodEnd.toFixed(4)} ref=${refEnd.toFixed(4)})`);
  const dev50 = Math.abs(calculateEMA(prices100.slice(0, 50), 20) - ref[49]) / ref[49] * 100;
  console.log(`INFO EMA20 seed-deviation after 50 pts: ${dev50.toFixed(4)}%`);
  check("T1 EMA seed convergence documented", true, `dev100=${devPct.toFixed(4)}% dev50=${dev50.toFixed(4)}%`);
}
// T2: MACD truncated windows vs standard full-series MACD
{
  const prod = calculateMACD(prices100);
  const e12full = computeEMAseries(prices100, 12);
  const e26full = computeEMAseries(prices100, 26);
  const macdSeries = prices100.map((_, i) => e12full[i] - e26full[i]);
  const refMacd = macdSeries[macdSeries.length - 1];
  const sigSeries = computeEMAseries(macdSeries, 9);
  const refSignal = sigSeries[sigSeries.length - 1];
  const devPct = Math.abs(prod.macd - refMacd) / (Math.abs(refMacd) || 1e-9) * 100;
  console.log(`INFO MACD prod=${prod.macd.toFixed(4)} ref=${refMacd.toFixed(4)} dev=${devPct.toFixed(1)}%`);
  console.log(`INFO SIGNAL prod=${prod.signal.toFixed(4)} ref=${refSignal.toFixed(4)}`);
  console.log(`INFO HISTOGRAM prod=${prod.histogram.toFixed(4)} ref=${(refMacd - refSignal).toFixed(4)} sign-prod=${Math.sign(prod.histogram)} sign-ref=${Math.sign(refMacd - refSignal)}`);
  check("T2 MACD deviation quantified", true, `macd dev ${devPct.toFixed(1)}%`);
}
// T2b: histogram sign flips between prod and ref across windows
{
  let flips = 0, total = 0;
  for (let n = 35; n <= 100; n++) {
    const p = prices100.slice(0, n);
    const prod = calculateMACD(p);
    const e12 = computeEMAseries(p, 12), e26 = computeEMAseries(p, 26);
    const ms = p.map((_, i) => e12[i] - e26[i]);
    const ss = computeEMAseries(ms, 9);
    const refHist = ms[ms.length - 1] - ss[ss.length - 1];
    total++;
    if (Math.sign(prod.histogram) !== Math.sign(refHist) && prod.histogram !== 0 && refHist !== 0) flips++;
  }
  console.log(`INFO histogram sign disagreement: ${flips}/${total} windows`);
  check("T2b histogram sign-flip count documented", true, `${flips}/${total}`);
}
// T3: Bollinger population vs sample stddev
{
  const prod = calculateBollingerBands(prices30);
  const ref = refBollingerSample(prices30);
  const prodSd = (prod.upper - prod.middle) / 2;
  const ratio = prodSd / ref.sd;
  console.log(`INFO Bollinger prod sd=${prodSd.toFixed(5)} sample sd=${ref.sd.toFixed(5)} ratio=${ratio.toFixed(4)} expected sqrt(19/20)=${Math.sqrt(19 / 20).toFixed(4)} (period=20, not 30)`);
  check("T3 Bollinger uses population stddev", approx(ratio, Math.sqrt(19 / 20), 1e-9), `ratio=${ratio.toFixed(6)} (period=20 -> sqrt(19/20)=${Math.sqrt(19/20).toFixed(4)})`);
}
// T4: RSI production (simple average over ALL history) vs Wilder 14
{
  const prod = calculateRSI(prices100);
  const ref = refRSIWilder(prices100, 14);
  console.log(`INFO RSI prod(all-history simple)=${prod.toFixed(2)} ref(Wilder14)=${ref?.toFixed(2)} diff=${(prod - ref).toFixed(2)}`);
  check("T4 RSI deviation quantified", true, `diff=${Math.abs(prod - ref).toFixed(2)} pts`);
}
// T5: RSI edge cases
{
  check("T5a RSI flat series returns 100 (zero losses)", calculateRSI([5, 5, 5, 5]) === 100, `got ${calculateRSI([5, 5, 5, 5])}`);
  const rising = calculateRSI([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  check("T5b RSI monotonic rising = 100", rising === 100, `got ${rising}`);
  const falling = calculateRSI([15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  console.log(`INFO RSI monotonic falling = ${falling}`);
  check("T5c RSI monotonic falling -> near 0 (gains=0 -> rs=0 -> 0)", falling === 0, `got ${falling}`);
}
// T6: Bollinger degenerate flat case
{
  const flat = calculateBollingerBands(Array(21).fill(7));
  console.log(`INFO flat Bollinger percentB=${flat.percentB} upper=${flat.upper}`);
  check("T6 flat prices -> percentB NaN (0/0)", Number.isNaN(flat.percentB), `percentB=${flat.percentB}`);
}
// T7: insufficient data fallback
{
  const short = calculateBollingerBands([1, 2, 3], 20);
  check("T7 insufficient data -> degenerate bands percentB=50", short.percentB === 50 && short.upper === short.middle, "");
}
// T8: IdcaSmartLayer computeRSI — check which RSI IDCA uses
{
  // src: IdcaSmartLayer.ts computeRSI — standard initial SMA then Wilder smoothing? verify:
  // (copied structure: first `period` simple avg, then wilder? — we test convergence vs refRSIWilder)
  function idcaRSI(closes, period = 14) {
    if (closes.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff > 0) gains += diff;
      else losses += Math.abs(diff);
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    for (let i = period + 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff > 0) { avgGain = (avgGain * (period - 1) + diff) / period; avgLoss = (avgLoss * (period - 1)) / period; }
      else { avgGain = (avgGain * (period - 1)) / period; avgLoss = (avgLoss * (period - 1) + Math.abs(diff)) / period; }
    }
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }
  const prod = idcaRSI(prices100);
  const ref = refRSIWilder(prices100, 14);
  console.log(`INFO IDCA RSI=${prod.toFixed(2)} refWilder=${ref?.toFixed(2)} diff=${(prod - ref).toFixed(4)}`);
  check("T8 IDCA RSI matches Wilder reference", approx(prod, ref, 0.01), `diff=${Math.abs(prod - ref).toFixed(4)}`);
}
console.log(`\nRESULT: ${pass} pass, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
