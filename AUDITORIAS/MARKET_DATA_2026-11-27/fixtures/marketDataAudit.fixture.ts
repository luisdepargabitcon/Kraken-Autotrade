// AUDITORIA #20 — fixtures locales puros (sin red, sin credenciales, sin DB).
// Documentan el comportamiento ACTUAL del código runtime (3ae1831). Un test en verde
// significa "el defecto descrito se reproduce", no "el comportamiento es correcto".
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import { MarketMetricsEngine } from "../services/marketMetrics/MarketMetricsEngine";
import { DEFAULT_METRICS_CONFIG, type MarketMetricsConfig } from "../services/marketMetrics/MarketMetricsTypes";
import * as smart from "../services/institutionalDca/IdcaSmartLayer";

const engine = new MarketMetricsEngine();
// Configuración efectiva observada en runtime (bot_config.market_metrics_config, 2026-11-27)
const RUNTIME_CFG: MarketMetricsConfig = {
  ...DEFAULT_METRICS_CONFIG,
  enabled: true, mode: "activo", applyToBuy: true, applyToSell: true, sensitivity: "conservador",
  stalenessMaxMs: { netflow: 21600000, derivatives: 3600000, stablecoins: 21600000, whaleActivity: 7200000 },
};
const out: Record<string, unknown> = {};
const pts = (d: any, m: string) => d.details.scoreBreakdown.find((b: any) => b.metric === m)?.points ?? null;

describe("H-MM OI: nivel absoluto USDT comparado con umbral de cambio % (15)", () => {
  it("OI absoluto constante (5.7e9 USDT) puntúa igual que una subida real del 15%", () => {
    const abs = engine.evaluate({ pair: "BTC/USD", side: "buy" }, { "open_interest:BTC": 5_746_314_575 }, RUNTIME_CFG, { "open_interest:BTC": 0 });
    const pct15 = engine.evaluate({ pair: "BTC/USD", side: "buy" }, { "open_interest:BTC": 15 }, RUNTIME_CFG, { "open_interest:BTC": 0 });
    const pct14 = engine.evaluate({ pair: "BTC/USD", side: "buy" }, { "open_interest:BTC": 14.9 }, RUNTIME_CFG, { "open_interest:BTC": 0 });
    out.oi = { absPoints: pts(abs, "open_interest"), pct15Points: pts(pct15, "open_interest"), pct14Points: pts(pct14, "open_interest"), absScore: abs.score };
    expect(pts(abs, "open_interest")).toBe(1);
    expect(pts(pct15, "open_interest")).toBe(1);
    expect(pts(pct14, "open_interest")).toBe(0);
  });
});

describe("H-MM Funding: fallback BTC con staleness del activo solicitado", () => {
  it("TON sin dato propio usa funding BTC de 10h y lo considera fresco (stale[TON] ?? 0)", () => {
    const d = engine.evaluate({ pair: "TON/USD", side: "buy" }, { "funding_rate:BTC": 0.2 }, RUNTIME_CFG, { "funding_rate:BTC": 10 * 3600_000 });
    const dBtc = engine.evaluate({ pair: "BTC/USD", side: "buy" }, { "funding_rate:BTC": 0.2 }, RUNTIME_CFG, { "funding_rate:BTC": 10 * 3600_000 });
    out.fundingFallback = { tonPoints: pts(d, "funding_rate"), tonReason: d.details.scoreBreakdown[0]?.reason, btcSameDataPoints: pts(dBtc, "funding_rate"), btcReason: dBtc.details.scoreBreakdown[0]?.reason };
    expect(pts(d, "funding_rate")).toBe(2);
    expect(pts(dBtc, "funding_rate")).toBe(0);
  });
  it("clave sin staleness (ausente) => 0 ms => fresco", () => {
    const d = engine.evaluate({ pair: "BTC/USD", side: "buy" }, { "funding_rate:BTC": 0.2 }, RUNTIME_CFG, {});
    expect(pts(d, "funding_rate")).toBe(2);
  });
});

describe("H-MM NaN / stale / ausencia", () => {
  it("NaN en funding se trata como 'normal' (0 puntos) en lugar de ausente", () => {
    const d = engine.evaluate({ pair: "BTC/USD", side: "buy" }, { "funding_rate:BTC": NaN, "open_interest:BTC": 1 }, RUNTIME_CFG, {});
    out.nan = { points: pts(d, "funding_rate"), reason: d.details.scoreBreakdown.find((b: any) => b.metric === "funding_rate")?.reason };
    expect(pts(d, "funding_rate")).toBe(0);
  });
  it("todos los datos stale pero hasAnyData=true => available=true, PERMITIR 'Condiciones de mercado favorables'", () => {
    const m = { "funding_rate:BTC": 0.5, "open_interest:BTC": 5e9, "stablecoin_supply_delta_24h:ALL": -5 };
    const s = { "funding_rate:BTC": 9e7, "open_interest:BTC": 9e7, "stablecoin_supply_delta_24h:ALL": 9e7 };
    const d = engine.evaluate({ pair: "BTC/USD", side: "buy" }, m, RUNTIME_CFG, s);
    out.allStale = { available: d.available, action: d.action, risk: d.riskLevel, reasons: d.reasons };
    expect(d.available).toBe(true);
    expect(d.action).toBe("PERMITIR");
    expect(d.reasons).toContain("Condiciones de mercado favorables");
  });
  it("con los últimos valores observados en runtime el score es BAJO y la acción PERMITIR", () => {
    const m = { "open_interest:BTC": 5_746_314_575, "funding_rate:BTC": 0.0036, "stablecoin_supply_delta_24h:ALL": -0.0958 };
    const fresh = engine.evaluate({ pair: "BTC/USD", side: "buy" }, m, RUNTIME_CFG, { "open_interest:BTC": 60_000, "funding_rate:BTC": 60_000, "stablecoin_supply_delta_24h:ALL": 60_000 });
    out.runtimeLike = { score: fresh.score, risk: fresh.riskLevel, action: fresh.action };
    expect(fresh.action).toBe("PERMITIR");
  });
  it("score máximo alcanzable con proveedores operativos (sin CoinMetrics/Whale/liquidaciones) en conservador", () => {
    const m = { "open_interest:BTC": 5e9, "funding_rate:BTC": 0.5, "stablecoin_supply_delta_24h:ALL": -5 };
    const d = engine.evaluate({ pair: "BTC/USD", side: "buy" }, m, RUNTIME_CFG, {});
    out.maxReachable = { score: d.score, risk: d.riskLevel, action: d.action };
    expect(d.score).toBe(Math.round(5 * 0.7));
  });
});

// ---------------- IDCA computeMarketScore ----------------
const W = { rsi: 15, ema20_slope: 10, ema50_slope: 10, btc_condition: 15, ema20_distance: 15, ema50_distance: 10, relative_volume: 10, drawdown_from_high: 15 } as any;

function emaSmaSeed(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const res: number[] = new Array(values.length).fill(NaN);
  if (values.length < period) return res;
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  res[period - 1] = prev;
  for (let i = period; i < values.length; i++) { prev = values[i] * k + prev * (1 - k); res[i] = prev; }
  return res;
}
function rsiWilder(c: number[], p = 14): number {
  let g = 0, l = 0;
  for (let i = 1; i <= p; i++) { const d = c[i] - c[i - 1]; if (d > 0) g += d; else l -= d; }
  let ag = g / p, al = l / p;
  for (let i = p + 1; i < c.length; i++) { const d = c[i] - c[i - 1]; ag = (ag * (p - 1) + Math.max(d, 0)) / p; al = (al * (p - 1) + Math.max(-d, 0)) / p; }
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
}

describe("H-IDCA volumen relativo fijo 1/1", () => {
  it("volScore = 50 constante: el peso relative_volume aporta siempre lo mismo", () => {
    const base = { currentPrice: 100, ema20: 101, ema50: 102, prevEma20: 101, prevEma50: 102, rsi: 40, localHigh: 110 };
    const a = smart.computeMarketScore({ ...base, currentVolume: 1, avgVolume: 1 } as any, W);
    const b = smart.computeMarketScore({ ...base, currentVolume: 3, avgVolume: 1 } as any, W);
    const c = smart.computeMarketScore({ ...base, currentVolume: 0.2, avgVolume: 1 } as any, W);
    out.volume = { as_runtime_1_1: a, if_vol_3x: b, if_vol_0_2x: c };
    expect(b).not.toBe(a);
  });
});

describe("Indicadores sintéticos reproducibles", () => {
  // Serie determinista: tendencia + seno, sin aleatoriedad
  const N = 300;
  const synth = Array.from({ length: N }, (_, i) => 100 + i * 0.05 + 3 * Math.sin(i / 7));
  it("EMA20/50: semilla primer valor vs semilla SMA, discrepancia por índice", () => {
    const e50 = smart.computeEMA(synth, 50), r50 = emaSmaSeed(synth, 50);
    const e20 = smart.computeEMA(synth, 20), r20 = emaSmaSeed(synth, 20);
    const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b) * 100;
    out.ema = {
      ema50_relDiffPct_at49: rel(e50[49], r50[49]), ema50_relDiffPct_at99: rel(e50[99], r50[99]), ema50_relDiffPct_at299: rel(e50[299], r50[299]),
      ema20_relDiffPct_at19: rel(e20[19], r20[19]), ema20_relDiffPct_at299: rel(e20[299], r20[299]),
    };
    expect(rel(e50[299], r50[299])).toBeLessThan(1e-4); // tolerancia 1e-4 % tras 250 velas de calentamiento
  });
  it("RSI14 coincide con Wilder independiente", () => {
    const d = Math.abs(smart.computeRSI(synth) - rsiWilder(synth));
    out.rsiDiff = d;
    expect(d).toBeLessThan(1e-9);
  });
  it("ATR14 es SMA del TR (no Wilder): discrepancia documentada", () => {
    const candles = synth.map((c, i) => ({ open: c, high: c + 1 + (i % 5) * 0.2, low: c - 1 - (i % 3) * 0.3, close: c, volume: 1, time: i }));
    const atrSma = smart.computeATR(candles as any, 14);
    const tr: number[] = []; for (let i = 1; i < candles.length; i++) { const x = candles[i], pc = candles[i - 1].close; tr.push(Math.max(x.high - x.low, Math.abs(x.high - pc), Math.abs(x.low - pc))); }
    let w = tr.slice(0, 14).reduce((a, b) => a + b, 0) / 14; for (let i = 14; i < tr.length; i++) w = (w * 13 + tr[i]) / 14;
    out.atr = { atrSma, atrWilder: w, relDiffPct: Math.abs(atrSma - w) / w * 100 };
    expect(atrSma).toBeGreaterThan(0);
  });
});

describe("Muestra histórica Kraken 1h (DB runtime, lectura previa read-only)", () => {
  const f = process.env.AUDIT20_CANDLES;
  it.skipIf(!f || !fs.existsSync(f!))("score BTC para ETH: EMA50=EMA20 previa (runtime) vs EMA50 real", () => {
    const rows = fs.readFileSync(f!, "utf8").split(/\r?\n/).filter(l => /^(BTC|ETH)\/USD\|/.test(l)).map(l => l.split("|"));
    const series = (p: string) => rows.filter(r => r[0] === p).map(r => ({ t: Number(r[1]), close: Number(r[5]), volume: Number(r[6]) }));
    const btc = series("BTC/USD");
    const res: number[] = [], diffs: number[] = [], volRatios: number[] = [];
    let changedAcross50 = 0, total = 0;
    for (let end = 200; end <= btc.length; end++) {
      const w = btc.slice(0, end), closes = w.map(x => x.close);
      const e20 = smart.computeEMA(closes, 20), e50 = smart.computeEMA(closes, 50), rsi = smart.computeRSI(closes);
      const common = { currentPrice: closes[closes.length - 1], ema20: e20[e20.length - 1], prevEma20: e20[e20.length - 2], rsi, currentVolume: 1, avgVolume: 1, localHigh: Math.max(...closes.slice(-60)) };
      const bug = smart.computeMarketScore({ ...common, ema50: e20[e20.length - 2], prevEma50: e20[e20.length - 3] } as any, W);
      const fix = smart.computeMarketScore({ ...common, ema50: e50[e50.length - 1], prevEma50: e50[e50.length - 2] } as any, W);
      res.push(bug); diffs.push(fix - bug); total++;
      if ((bug < 50) !== (fix < 50)) changedAcross50++;
      const vols = w.slice(-21, -1).map(x => x.volume); const avg = vols.reduce((a, b) => a + b, 0) / vols.length;
      volRatios.push(avg > 0 ? w[w.length - 1].volume / avg : NaN);
    }
    const abs = diffs.map(Math.abs).sort((a, b) => a - b);
    const vr = volRatios.filter(Number.isFinite).sort((a, b) => a - b);
    out.btcScoreSample = {
      candles: btc.length, firstTs: new Date(btc[0].t).toISOString(), lastTs: new Date(btc[btc.length - 1].t).toISOString(), windows: total,
      maxAbsDiff: abs[abs.length - 1], p50AbsDiff: abs[Math.floor(abs.length / 2)], p95AbsDiff: abs[Math.floor(abs.length * 0.95)],
      btcScoreCrossing50Changed: changedAcross50,
      realVolRatio_p05: vr[Math.floor(vr.length * 0.05)], realVolRatio_p50: vr[Math.floor(vr.length / 2)], realVolRatio_p95: vr[Math.floor(vr.length * 0.95)],
    };
    expect(total).toBeGreaterThan(0);
  });
});

import { afterAll } from "vitest";
afterAll(() => { console.log("AUDIT20_RESULTS " + JSON.stringify(out)); });
