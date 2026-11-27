/**
 * REPLAY DE SEÑALES DE ENTRADA IDCA sobre velas PÚBLICAS (no es replay de ciclos privados).
 *
 * Uso:
 *   npx tsx scripts/idca_signal_replay.ts --fetch   # descarga velas públicas Bitstamp 1h (≈12 peticiones) y las guarda
 *   npx tsx scripts/idca_signal_replay.ts           # ejecuta el replay offline sobre el snapshot
 *
 * QUÉ ES: compara, con las MISMAS condiciones de entrada simplificadas, variantes de las
 * correcciones técnicas de entrada (rebote A1a/A1b/A1c, score de mercado A2) frente al
 * comportamiento actual (A0), midiendo resultados hacia adelante de cada señal (MFE/MAE/retorno).
 *
 * QUÉ NO ES: no reproduce configuración, capital, niveles, safety, TP/trailing/stop, comisiones ni
 * ciclos reales (requieren la copia privada autorizada). No hay PnL, drawdown de cartera ni
 * utilización: NO CONCLUYENTE sobre rentabilidad. No se aprueba ninguna estrategia con esto.
 *
 * Reglas del replay: reloj determinista (una vela = un instante de decisión al CIERRE de la vela t);
 * solo velas cerradas disponibles en ese instante; entrada hipotética en la APERTURA de t+1
 * (latencia de 1 vela, sin ejecutar al cierre conocido); series sin interpolar; huecos
 * detectados y excluidos; señales sin horizonte completo quedan censuradas y se cuentan aparte.
 */
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://user:pass@localhost:5432/replay_only";

const OUT = "AUDITORIAS/NEXA_INTEGRAL_2026-11-27";
const DIR = path.join(OUT, "data_public", "replay");
const HOUR = 3_600_000;
const PAGES = 6; // 6 × 1000 velas 1h ≈ 250 días
const WEIGHTS = {
  ema20_distance: 15, ema50_distance: 10, ema20_slope: 10, ema50_slope: 10,
  rsi: 15, relative_volume: 10, drawdown_from_high: 15, btc_condition: 15,
} as Record<string, number>;

type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };
type Snap = { source: string; url: string; fetchedAt: string; count: number; first: string; last: string; sha256: string; candles: Candle[] };

const sha = (c: Candle[]) => crypto.createHash("sha256").update(JSON.stringify(c)).digest("hex");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchBitstamp(asset: "BTC" | "ETH"): Promise<Snap> {
  const market = asset === "BTC" ? "btcusd" : "ethusd";
  const all = new Map<number, Candle>();
  let end = Math.floor(Date.now() / 1000);
  let calls = 0;
  for (let p = 0; p < PAGES; p++) {
    const url = `https://www.bitstamp.net/api/v2/ohlc/${market}/?step=3600&limit=1000&end=${end}&exclude_current_candle=true`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    calls++;
    if (!res.ok) throw new Error(`Bitstamp ${market} HTTP ${res.status}`);
    const j: any = await res.json();
    const rows: any[] = j.data.ohlc;
    if (!rows.length) break;
    for (const r of rows) all.set(+r.timestamp * 1000, { time: +r.timestamp * 1000, open: +r.open, high: +r.high, low: +r.low, close: +r.close, volume: +r.volume });
    const earliest = Math.min(...rows.map((r) => +r.timestamp));
    end = earliest - 1;
    await sleep(1200);
  }
  const candles = [...all.values()].sort((a, b) => a.time - b.time);
  const snap: Snap = {
    source: "bitstamp", url: `https://www.bitstamp.net/api/v2/ohlc/${market}/?step=3600&limit=1000&end=<paged>&exclude_current_candle=true (${calls} peticiones)`,
    fetchedAt: new Date().toISOString(), count: candles.length,
    first: new Date(candles[0].time).toISOString(), last: new Date(candles.at(-1)!.time).toISOString(), sha256: sha(candles), candles,
  };
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, `${asset}_bitstamp_1h.json`), JSON.stringify(snap));
  return snap;
}

function loadSnap(asset: "BTC" | "ETH"): Snap {
  return JSON.parse(fs.readFileSync(path.join(DIR, `${asset}_bitstamp_1h.json`), "utf8"));
}

// ── estadística auxiliar ──
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r4 = (x: number | null) => (x == null ? null : +x.toFixed(4));
function lcg(seed: number) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32); }
function bootstrapDiffCI(a: number[], b: number[], iters = 2000, seed = 12345) {
  if (a.length < 5 || b.length < 5) return null;
  const rnd = lcg(seed), d: number[] = [];
  for (let i = 0; i < iters; i++) {
    const ma = mean(Array.from({ length: a.length }, () => a[Math.floor(rnd() * a.length)]))!;
    const mb = mean(Array.from({ length: b.length }, () => b[Math.floor(rnd() * b.length)]))!;
    d.push(ma - mb);
  }
  d.sort((x, y) => x - y);
  return { lo: r4(d[Math.floor(0.025 * iters)]), hi: r4(d[Math.floor(0.975 * iters)]) };
}

type Arm = "A0_legacy" | "A1a_wick" | "A1b_slowing" | "A1c_combined" | "A2_score" | "A1c_plus_A2";
const ARMS: Arm[] = ["A0_legacy", "A1a_wick", "A1b_slowing", "A1c_combined", "A2_score", "A1c_plus_A2"];
const HORIZONS = [24, 72, 168];
const MAX_H = 168;

async function main() {
  if (process.argv.includes("--fetch")) {
    for (const a of ["BTC", "ETH"] as const) { const s = await fetchBitstamp(a); console.log(a, s.count, s.first, s.last, s.sha256); }
  }
  const smart = await import("../server/services/institutionalDca/IdcaSmartLayer");
  const engine = await import("../server/services/institutionalDca/IdcaEngine");

  const btc = loadSnap("BTC"), eth = loadSnap("ETH");
  // Alinea por tiempo y exige contigüidad: se usan solo tramos sin huecos en AMBOS pares.
  const bMap = new Map(btc.candles.map((c) => [c.time, c]));
  const common = eth.candles.filter((c) => bMap.has(c.time));
  const segments: { eth: Candle[]; btc: Candle[] }[] = [];
  let cur: { eth: Candle[]; btc: Candle[] } | null = null;
  for (const c of common) {
    if (cur && c.time - cur.eth[cur.eth.length - 1].time === HOUR) { cur.eth.push(c); cur.btc.push(bMap.get(c.time)!); }
    else { cur = { eth: [c], btc: [bMap.get(c.time)!] }; segments.push(cur); }
  }
  const gaps = segments.length - 1;
  const seg = segments.sort((a, b) => b.eth.length - a.eth.length)[0];
  const E = seg.eth, B = seg.btc;
  const nowOf = (i: number) => E[i].time + HOUR; // instante de decisión = cierre de la vela i

  // OLD score = replica del cálculo previo (EMA50 BTC := EMA20 desplazada, volumen 1/1, semilla legacy, btc por defecto 60)
  function oldScore(i: number): number {
    const bW = B.slice(Math.max(0, i - 199), i + 1), eW = E.slice(Math.max(0, i - 199), i + 1);
    const bCl = bW.map((c) => c.close), bE20 = smart.computeEMA(bCl, 20);
    const btcScore = smart.computeMarketScore({
      currentPrice: bCl.at(-1)!, ema20: bE20.at(-1)!, ema50: bE20[Math.max(0, bE20.length - 2)],
      prevEma20: bE20[Math.max(0, bE20.length - 2)], prevEma50: bE20[Math.max(0, bE20.length - 3)],
      rsi: smart.computeRSI(bCl), currentVolume: 1, avgVolume: 1, localHigh: Math.max(...bCl.slice(-60)),
    }, WEIGHTS as any);
    const cl = eW.map((c) => c.close), e20 = smart.computeEMA(cl, 20), e50 = smart.computeEMA(cl, Math.min(50, cl.length));
    return smart.computeMarketScore({
      currentPrice: cl.at(-1)!, ema20: e20.at(-1)!, ema50: e50.at(-1)!, prevEma20: e20[Math.max(0, e20.length - 2)], prevEma50: e50[Math.max(0, e50.length - 2)],
      rsi: smart.computeRSI(cl), currentVolume: 1, avgVolume: 1, localHigh: Math.max(...cl.slice(-60)), btcScore,
    }, WEIGHTS as any);
  }
  function newScore(i: number) {
    const eW = E.slice(Math.max(0, i - 199), i + 1), bW = B.slice(Math.max(0, i - 199), i + 1);
    const cl = eW.map((c) => c.close);
    return engine.evaluateEntryMarketScoreQuality({
      pair: "ETH/USD", currentPrice: cl.at(-1)!, scoreCandles: eW as any, btcCandles: bW as any,
      weights: WEIGHTS as any, localHigh: Math.max(...cl.slice(-60)), nowMs: nowOf(i),
    }).detailed;
  }

  function reboundOf(i: number, variant: "legacy" | "a1a_wick_geometry" | "a1b_slowing_real_fall" | "a1c_combined", localLow: number): boolean {
    const recent = E.slice(i - 4, i + 1).map((c) => ({ open: c.open, high: c.high, low: c.low, close: c.close }));
    return smart.detectReboundDetailed({ recentCandles: recent, currentPrice: E[i].close, localLow, reboundMinPct: 0.3 }, variant).confirmed;
  }

  const DIPS = [2, 3, 5];
  const WARMUP = 200;
  const COOLDOWN_H = 24;
  type Sig = { i: number; arm: Arm; dip: number; entry: number; fwd: Record<number, number | null>; mae: number | null; mfe: number | null; censored: boolean };
  const sigs: Sig[] = [];

  for (const dip of DIPS) {
    const lastSig: Record<string, number> = {};
    for (let i = WARMUP; i < E.length - 1; i++) {
      const high7d = Math.max(...E.slice(i - 167, i + 1).map((c) => c.high));
      const dipPct = ((high7d - E[i].close) / high7d) * 100;
      if (dipPct < dip) continue;
      const localLow = Math.min(...E.slice(i - 23, i + 1).map((c) => c.low));
      const old = oldScore(i), nw = newScore(i);
      const newOk = nw.status === "ok" && nw.score != null && nw.score >= 50;
      const oldOk = old >= 50;
      const reb = {
        legacy: reboundOf(i, "legacy", localLow),
        a1a: reboundOf(i, "a1a_wick_geometry", localLow),
        a1b: reboundOf(i, "a1b_slowing_real_fall", localLow),
        a1c: reboundOf(i, "a1c_combined", localLow),
      };
      const pass: Record<Arm, boolean> = {
        A0_legacy: oldOk && reb.legacy,
        A1a_wick: oldOk && reb.a1a,
        A1b_slowing: oldOk && reb.a1b,
        A1c_combined: oldOk && reb.a1c,
        A2_score: newOk && reb.legacy,
        A1c_plus_A2: newOk && reb.a1c,
      };
      for (const arm of ARMS) {
        if (!pass[arm]) continue;
        const key = `${dip}:${arm}`;
        if (key in lastSig && i - lastSig[key] < COOLDOWN_H) continue; // cooldown idéntico por brazo
        lastSig[key] = i;
        const entry = E[i + 1].open; // entrada en la apertura de la vela siguiente (latencia 1 vela)
        const fwd: Record<number, number | null> = {};
        let censored = false;
        for (const h of HORIZONS) {
          const j = i + h;
          fwd[h] = j < E.length ? (E[j].close / entry - 1) * 100 : null;
          if (fwd[h] == null) censored = true;
        }
        const end = Math.min(E.length - 1, i + MAX_H);
        const win = E.slice(i + 1, end + 1);
        const mae = (Math.min(...win.map((c) => c.low)) / entry - 1) * 100;
        const mfe = (Math.max(...win.map((c) => c.high)) / entry - 1) * 100;
        sigs.push({ i, arm, dip, entry, fwd, mae: i + MAX_H < E.length ? mae : null, mfe: i + MAX_H < E.length ? mfe : null, censored });
      }
    }
  }

  // ── Agregados: periodo de calibración (primer 60 %) y validación cronológica (último 40 %) ──
  const split = Math.floor(WARMUP + (E.length - WARMUP) * 0.6);
  const summarize = (list: Sig[]) => {
    const complete = list.filter((s) => !s.censored);
    const f72 = complete.map((s) => s.fwd[72]!), f168 = complete.map((s) => s.fwd[168]!);
    return {
      signals: list.length, censored: list.length - complete.length,
      meanFwd24h: r4(mean(complete.map((s) => s.fwd[24]!))), meanFwd72h: r4(mean(f72)), medianFwd72h: r4(median(f72)), meanFwd168h: r4(mean(f168)),
      winRate72hPct: complete.length ? r4((f72.filter((x) => x > 0).length / complete.length) * 100) : null,
      meanMAE168hPct: r4(mean(complete.map((s) => s.mae!))), meanMFE168hPct: r4(mean(complete.map((s) => s.mfe!))),
    };
  };
  const results: any[] = [];
  for (const dip of DIPS) {
    const row: any = { minDipPct: dip, arms: {} as Record<string, any> };
    for (const arm of ARMS) {
      const all = sigs.filter((s) => s.dip === dip && s.arm === arm);
      row.arms[arm] = {
        all: summarize(all),
        calibration_first60pct: summarize(all.filter((s) => s.i < split)),
        validation_last40pct: summarize(all.filter((s) => s.i >= split)),
      };
    }
    // Señales evitadas / añadidas frente a A0 (mismo instante de decisión)
    const a0 = new Set(sigs.filter((s) => s.dip === dip && s.arm === "A0_legacy").map((s) => s.i));
    row.vsA0 = {} as Record<string, any>;
    for (const arm of ARMS.slice(1)) {
      const armSigs = sigs.filter((s) => s.dip === dip && s.arm === arm);
      const set = new Set(armSigs.map((s) => s.i));
      const avoided = sigs.filter((s) => s.dip === dip && s.arm === "A0_legacy" && !set.has(s.i) && !s.censored);
      const added = armSigs.filter((s) => !a0.has(s.i) && !s.censored);
      const kept = armSigs.filter((s) => a0.has(s.i) && !s.censored);
      row.vsA0[arm] = {
        avoidedSignals: avoided.length, avoidedMeanFwd72h: r4(mean(avoided.map((s) => s.fwd[72]!))),
        addedSignals: added.length, addedMeanFwd72h: r4(mean(added.map((s) => s.fwd[72]!))),
        keptSignals: kept.length, keptMeanFwd72h: r4(mean(kept.map((s) => s.fwd[72]!))),
        meanFwd72hDiff_vs_A0_bootstrap95: bootstrapDiffCI(
          armSigs.filter((s) => !s.censored).map((s) => s.fwd[72]!),
          sigs.filter((s) => s.dip === dip && s.arm === "A0_legacy" && !s.censored).map((s) => s.fwd[72]!),
        ),
      };
    }
    results.push(row);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    kind: "SIGNAL_REPLAY_PUBLIC_DATA_NOT_CYCLE_REPLAY",
    limits: [
      "No es replay de ciclos: sin configuración real, capital, niveles, safety, TP/trailing/stop, comisiones ni slippage.",
      "Sin PnL/drawdown de cartera/utilización: NO CONCLUYENTE sobre rentabilidad; no aprueba ninguna estrategia.",
      "Condición de entrada simplificada (caída ≥ X % desde el máximo de 7 días + score + rebote) como proxy del motor.",
      "Ventanas forward solapadas (señales dependientes): los IC bootstrap son orientativos y optimistas.",
      "Fuente: Bitstamp USD 1h (proxy de la serie Kraken; divergencia media ≈0,01–0,02 % en el estudio de fuentes).",
      "Una sola ventana temporal (~250 días), un solo régimen; sin ajuste de parámetros (no se optimizó sobre validación).",
    ],
    data: {
      eth: { first: new Date(E[0].time).toISOString(), last: new Date(E.at(-1)!.time).toISOString(), candles: E.length },
      btc: { candles: B.length }, gapsExcluded: gaps, snapshots: [btc, eth].map((s) => ({ source: s.source, url: s.url, fetchedAt: s.fetchedAt, candles: s.count, first: s.first, last: s.last, sha256: s.sha256 })),
    },
    method: { warmupCandles: WARMUP, decisionClock: "cierre de la vela i", entry: "apertura de la vela i+1", cooldownHours: COOLDOWN_H, horizonsHours: HORIZONS, splitIndex: split, arms: ARMS, weights: WEIGHTS },
    results,
  };
  fs.writeFileSync(path.join(OUT, "REPLAY_SENALES_RESULTADOS.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
