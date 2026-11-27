/**
 * Medición reproducible del impacto de las correcciones de indicadores IDCA/SPOT
 * sobre un snapshot PÚBLICO de velas Kraken (1h, BTC/USD y ETH/USD).
 *
 * Uso:  npx tsx scripts/measure_indicator_impact.ts
 *
 * - Si el snapshot existe en data_public/ se usa sin red (reproducible offline).
 * - Si no existe, descarga un máximo de 1 petición pública OHLC por par (sin claves).
 * - Escribe IMPACTO_INDICADORES.json con agregados y el manifest con hashes.
 *
 * LÍMITES: muestra corta (~720 velas 1h ≈ 30 días), proxy analítico del score de
 * mercado; NO es replay de ciclos, NO demuestra rentabilidad ni causalidad con
 * compras reales. Las ventanas deslizantes se solapan (no son independientes).
 */
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://user:pass@localhost:5432/measure_only";

const OUT_DIR = "AUDITORIAS/NEXA_INTEGRAL_2026-11-27";
const DATA_DIR = path.join(OUT_DIR, "data_public");
const HOUR_MS = 3_600_000;
const WEIGHTS = {
  ema20_distance: 15, ema50_distance: 10, ema20_slope: 10, ema50_slope: 10,
  rsi: 15, relative_volume: 10, drawdown_from_high: 15, btc_condition: 15,
} as Record<string, number>;

type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };
type Snapshot = { url: string; fetchedAt: string; count: number; first: string; last: string; sha256: string; candles: Candle[] };

function sha(candles: Candle[]): string {
  return crypto.createHash("sha256").update(JSON.stringify(candles)).digest("hex");
}

async function loadSnapshot(pair: string, interval: number): Promise<Snapshot> {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const file = path.join(DATA_DIR, `${pair}_${interval}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  const url = `https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=${interval}`;
  const res = await fetch(url);
  const json: any = await res.json();
  const rows = Object.values(json.result).find(Array.isArray) as any[][];
  // Kraken OHLC row: [time(s), open, high, low, close, vwap, volume, count]
  const candles: Candle[] = rows.slice(-720).map((r) => ({
    time: Number(r[0]) * 1000, open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[6],
  }));
  const snap: Snapshot = {
    url, fetchedAt: new Date().toISOString(), count: candles.length,
    first: new Date(candles[0].time).toISOString(), last: new Date(candles[candles.length - 1].time).toISOString(),
    sha256: sha(candles), candles,
  };
  fs.writeFileSync(file, JSON.stringify(snap, null, 2));
  return snap;
}

const sideOf50 = (s: number) => (s >= 50 ? "ge50" : "lt50");
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round = (x: number | null, d = 3) => (x == null ? null : +x.toFixed(d));

async function main() {
  const { macd, atr } = await import("../server/services/indicators/core");
  const smart = await import("../server/services/institutionalDca/IdcaSmartLayer");
  const engine = await import("../server/services/institutionalDca/IdcaEngine");

  const btcSnap = await loadSnapshot("XBTUSD", 60);
  const ethSnap = await loadSnapshot("ETHUSD", 60);
  const btc = btcSnap.candles, eth = ethSnap.candles;
  if (btc.length !== eth.length || btc[btc.length - 1].time !== eth[eth.length - 1].time || btc[0].time !== eth[0].time) {
    throw new Error("Los snapshots BTC/ETH no están alineados temporalmente");
  }

  // ── (1) MACD truncado vs estándar, ATR SMA vs Wilder, series planas ──
  const perPair = [{ name: "BTC/USD", snap: btcSnap }, { name: "ETH/USD", snap: ethSnap }].map(({ name, snap }) => {
    const cs = snap.candles, closes = cs.map((c) => c.close);
    const fullLast = macd(closes).line.at(-1)!, truncLast = macd(closes.slice(-100)).line.at(-1)!;
    let n = 0, signDiff = 0;
    for (let i = 60; i < closes.length; i++) {
      const a = macd(closes.slice(0, i)).histogram.at(-1);
      const b = macd(closes.slice(Math.max(0, i - 100), i)).histogram.at(-1);
      if (a != null && b != null) { n++; if (Math.sign(a) !== Math.sign(b)) signDiff++; }
    }
    const aSma = atr(cs, 14, { method: "sma" }).value!, aWil = atr(cs, 14, { method: "wilder" }).value!;
    const flat = closes.filter((x, i) => i > 0 && x === closes[i - 1]).length;
    return {
      pair: name, candles: snap.count, sha256: snap.sha256, range: [snap.first, snap.last],
      macdLastFull: round(fullLast, 4), macdLastTruncated: round(truncLast, 4), macdAbsDiff: round(Math.abs(fullLast - truncLast), 4),
      macdHistogramSignDisagreementPct: round((signDiff / n) * 100, 2), macdWindows: n,
      flatCloseTransitions: flat, atrSma: round(aSma, 4), atrWilder: round(aWil, 4), atrSmaMinusWilderPct: round(((aSma - aWil) / aWil) * 100, 3),
    };
  });

  // ── (2) Score BTC→ETH: cálculo ANTIGUO real vs NUEVO (evaluateEntryMarketScoreQuality) ──
  // OLD replica el código previo de performEntryCheck: EMA50 de BTC := EMA20 desplazada,
  // volumen 1/1, EMA legacy (semilla = primer valor), btc fallback 60 (default de computeMarketScore).
  function oldScore(ethW: Candle[], btcW: Candle[]): number {
    const bCl = btcW.map((c) => c.close);
    const bE20 = smart.computeEMA(bCl, 20);
    const btcScore = smart.computeMarketScore({
      currentPrice: bCl.at(-1)!, ema20: bE20.at(-1)!, ema50: bE20[Math.max(0, bE20.length - 2)],
      prevEma20: bE20[Math.max(0, bE20.length - 2)], prevEma50: bE20[Math.max(0, bE20.length - 3)],
      rsi: smart.computeRSI(bCl), currentVolume: 1, avgVolume: 1, localHigh: Math.max(...bCl.slice(-60)),
    }, WEIGHTS as any);
    const cl = ethW.map((c) => c.close);
    const e20 = smart.computeEMA(cl, 20), e50 = smart.computeEMA(cl, Math.min(50, cl.length));
    return smart.computeMarketScore({
      currentPrice: cl.at(-1)!, ema20: e20.at(-1)!, ema50: e50.at(-1)!,
      prevEma20: e20[Math.max(0, e20.length - 2)], prevEma50: e50[Math.max(0, e50.length - 2)],
      rsi: smart.computeRSI(cl), currentVolume: 1, avgVolume: 1, localHigh: Math.max(...cl.slice(-60)), btcScore,
    }, WEIGHTS as any);
  }
  function newResult(ethW: Candle[], btcW: Candle[], weights: Record<string, number> = WEIGHTS) {
    const cl = ethW.map((c) => c.close);
    return engine.evaluateEntryMarketScoreQuality({
      pair: "ETH/USD", currentPrice: cl.at(-1)!, scoreCandles: ethW as any, btcCandles: btcW as any,
      weights: weights as any, localHigh: Math.max(...cl.slice(-60)), nowMs: ethW.at(-1)!.time + HOUR_MS,
    }).detailed;
  }
  const withUnitVolume = (cs: Candle[]) => cs.map((c) => ({ ...c, volume: 1 }));

  const lengths = [60, 80, 100, 200];
  const byLength = lengths.map((L) => {
    let total = 0, ok = 0, degraded = 0, unavailable = 0;
    const diffs: number[] = [];
    let crossUp = 0, crossDown = 0, comparable = 0;
    for (let end = L; end <= eth.length; end++) {
      const ethW = eth.slice(end - L, end), btcW = btc.slice(end - L, end);
      total++;
      const nr = newResult(ethW, btcW);
      if (nr.status === "ok") ok++; else if (nr.status === "degraded") degraded++; else unavailable++;
      if (nr.score == null) continue;
      const o = oldScore(ethW, btcW);
      comparable++;
      diffs.push(nr.score - o);
      if (o < 50 && nr.score >= 50) crossUp++;
      if (o >= 50 && nr.score < 50) crossDown++;
    }
    return {
      windowCandles: L, windows: total, statusOk: ok, statusDegraded: degraded, statusUnavailable: unavailable,
      comparableWindows: comparable, meanDelta_newMinusOld: round(mean(diffs), 3),
      maxAbsDelta: round(diffs.length ? Math.max(...diffs.map(Math.abs)) : null, 1),
      crossOldLt50_to_newGe50: crossUp, crossOldGe50_to_newLt50: crossDown,
    };
  });

  // ── (3) Ablation del volumen relativo (EMA estricta fija) ──
  const L = 200;
  let n = 0, flipUnit = 0, flipExcl = 0, towardBuyUnit = 0, towardSellUnit = 0, towardBuyExcl = 0, towardSellExcl = 0, degradedExcl = 0;
  const dUnit: number[] = [], dExcl: number[] = [];
  for (let end = L; end <= eth.length; end++) {
    const ethW = eth.slice(end - L, end), btcW = btc.slice(end - L, end);
    const real = newResult(ethW, btcW);
    if (real.score == null || real.status !== "ok") continue;
    const unit = newResult(withUnitVolume(ethW), withUnitVolume(btcW));
    const excl = newResult(ethW, btcW, { ...WEIGHTS, relative_volume: 0 });
    n++;
    if (unit.score != null) {
      dUnit.push(unit.score - real.score);
      if (sideOf50(unit.score) !== sideOf50(real.score)) { flipUnit++; if (unit.score >= 50) towardBuyUnit++; else towardSellUnit++; }
    }
    if (excl.score != null) {
      dExcl.push(excl.score - real.score);
      if (sideOf50(excl.score) !== sideOf50(real.score)) { flipExcl++; if (excl.score >= 50) towardBuyExcl++; else towardSellExcl++; }
    }
    if (excl.status !== "ok") degradedExcl++;
  }
  const volumeAblation = {
    windowCandles: L, baselineWindows: n,
    unitVolume_vs_real: { sideOf50Flips: flipUnit, towardEntry: towardBuyUnit, towardNoEntry: towardSellUnit, meanDelta: round(mean(dUnit), 3), maxAbsDelta: round(dUnit.length ? Math.max(...dUnit.map(Math.abs)) : null, 1) },
    excludedRenormalized_vs_real: { sideOf50Flips: flipExcl, towardEntry: towardBuyExcl, towardNoEntry: towardSellExcl, meanDelta: round(mean(dExcl), 3), maxAbsDelta: round(dExcl.length ? Math.max(...dExcl.map(Math.abs)) : null, 1), statusNotOkWindows: degradedExcl },
  };

  const result = {
    generatedAt: new Date().toISOString(),
    limits: "Muestra corta (~720 velas 1h, ~30 días), ventanas solapadas, proxy analítico del score; no es replay de ciclos ni evidencia de rentabilidad/causalidad con compras reales.",
    method: { weights: WEIGHTS, oldScore: "replica del cálculo previo (EMA50 BTC = EMA20 desplazada, volumen 1/1, semilla legacy)", newScore: "evaluateEntryMarketScoreQuality real del motor (EMA estricta con warm-up, volumen relativo real, estado de calidad)" },
    snapshots: [btcSnap, ethSnap].map((s) => ({ url: s.url, fetchedAt: s.fetchedAt, candles: s.count, first: s.first, last: s.last, sha256: s.sha256 })),
    indicators: perPair,
    scoreOldVsNewByWindowLength: byLength,
    volumeAblation,
  };
  fs.writeFileSync(path.join(OUT_DIR, "IMPACTO_INDICADORES.json"), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(DATA_DIR, "MANIFEST.json"), JSON.stringify({ generatedAt: result.generatedAt, files: result.snapshots }, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
