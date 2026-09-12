/**
 * testEntryV4CounterAudit — Real-data counter-audit tests for V4 true B0 overlay
 *
 * Tests:
 *   1. HISTORICAL_INTENT_CLOCK: intent.createdAt === evaluationTime, expiresAt correct
 *   2. CANONICAL_FAST_B0_PARITY: runReplay B0 == fastReplay B0 (exact trades)
 *   3. V4_THRESHOLD_ZERO_EQUALS_B0: fastReplay B0 == fastReplay V4 threshold=0 (exact trades)
 *   4. V4_REAL_FUTURE_INVARIANCE: altering future candles doesn't change V3RawFeatures at T
 *   5. V4_ACCEPTS_B0_REJECTED: real measurement from actual replay (must be 0)
 *   6. B0_SCORE_COVERAGE: every B0 trade has a V4 score
 *
 * Usage:
 *   npx tsx server/services/spot/research/testEntryV4CounterAudit.ts
 */

import { runReplay, type ReplayCandleSet, type ReplayConfig } from "../spotReplayEngine";
import { precomputeFrames, fastReplay, type V3RawFeatures } from "./fastResearchReplay";
import { DEFAULT_ENTRY_V3_CONFIG, type EntryV3Config } from "../spotEntryV3";
import { DEFAULT_ANTI_LATE_ENTRY_CONFIG } from "../spotEntryIntent";
import { type FeeModel } from "../feeModel";
import { loadAllCached, PAIR_MAPPINGS, type KrakenOHLCRow } from "./krakenHistoricalLoader";
import { computeV4QualityScores } from "./spotEntryV4Research";
import type { SpotCandle } from "../spotTypes";

const HISTORICAL_FEE_MODEL: FeeModel = {
  exchange: "revolutx",
  takerFeePct: 0.09,
  makerFeePct: 0.00,
  quality: "ESTIMATED",
};

const V3_ENABLED: EntryV3Config = { ...DEFAULT_ENTRY_V3_CONFIG, enabled: true };

function toSpotCandle(row: KrakenOHLCRow): SpotCandle {
  return { time: row.timestamp, open: row.open, high: row.high, low: row.low, close: row.close, volume: row.volume };
}

function assertEq(label: string, actual: unknown, expected: unknown): boolean {
  if (actual !== expected) {
    console.error(`FAIL ${label}: expected=${expected} actual=${actual}`);
    return false;
  }
  return true;
}

function assertClose(label: string, actual: number, expected: number, tolerance: number): boolean {
  if (Math.abs(actual - expected) > tolerance) {
    console.error(`FAIL ${label}: expected=${expected} actual=${actual} diff=${Math.abs(actual - expected)}`);
    return false;
  }
  return true;
}

function featuresEqual(a: V3RawFeatures, b: V3RawFeatures): boolean {
  return a.atr === b.atr &&
    a.impulseAtr === b.impulseAtr &&
    a.retracementAtr === b.retracementAtr &&
    a.retracementLow === b.retracementLow &&
    a.ema20 === b.ema20 &&
    a.reclaimCandleClose === b.reclaimCandleClose &&
    a.reclaimBodyPct === b.reclaimBodyPct &&
    a.reclaimIsBullish === b.reclaimIsBullish &&
    a.reclaimAfterOrigin === b.reclaimAfterOrigin &&
    a.resumptionExists === b.resumptionExists &&
    a.resumptionBodyPct === b.resumptionBodyPct &&
    a.resumptionIsBullish === b.resumptionIsBullish &&
    a.resumptionUpperWickRatio === b.resumptionUpperWickRatio &&
    a.resumptionVolRatio5m === b.resumptionVolRatio5m &&
    a.distanceFromOriginAtr === b.distanceFromOriginAtr;
}

function main(): void {
  const pair = PAIR_MAPPINGS[0].requested;
  console.log(`\n=== V4 Counter-Audit Tests for ${pair} ===\n`);

  const datasets = loadAllCached();
  const c5 = datasets.get(`${pair}_5m`);
  const c15 = datasets.get(`${pair}_15m`);
  const c60 = datasets.get(`${pair}_60m`);
  const c240 = datasets.get(`${pair}_240m`);

  if (!c5 || !c15 || !c60 || !c240) {
    console.error("Missing datasets");
    process.exit(1);
  }

  const candleSet: ReplayCandleSet = {
    pair,
    candles5m: c5.rows.map(toSpotCandle),
    candles15m: c15.rows.map(toSpotCandle),
    candles1h: c60.rows.map(toSpotCandle),
    candles4h: c240.rows.map(toSpotCandle),
  };

  const evalStart = c5.rows[0].timestamp;
  const evalEnd = c5.rows[c5.rows.length - 1].timestamp;

  let allPass = true;

  // ─── 1. HISTORICAL_INTENT_CLOCK ─────────────────────────────────────────────
  console.log("1. HISTORICAL_INTENT_CLOCK");
  {
    const precomputed = precomputeFrames(pair, candleSet, V3_ENABLED);
    const expectedTtl = DEFAULT_ANTI_LATE_ENTRY_CONFIG.maxCandlesAfterSignal * DEFAULT_ANTI_LATE_ENTRY_CONFIG.candleIntervalMs;
    let clockOk = true;
    let checked = 0;
    for (const frame of precomputed.frames) {
      if (!frame.intent) continue;
      checked++;
      if (frame.intent.createdAt !== frame.evaluationTime) {
        console.error(`  FAIL: intent.createdAt=${frame.intent.createdAt} !== evaluationTime=${frame.evaluationTime} at frame ${frame.index}`);
        clockOk = false;
        break;
      }
      if (frame.intent.expiresAt - frame.intent.createdAt !== expectedTtl) {
        console.error(`  FAIL: expiresAt-createdAt=${frame.intent.expiresAt - frame.intent.createdAt} !== expectedTtl=${expectedTtl} at frame ${frame.index}`);
        clockOk = false;
        break;
      }
    }
    console.log(`  checked=${checked} intents`);
    console.log(`  HISTORICAL_INTENT_CLOCK=${clockOk ? "PASS" : "FAIL"}`);
    if (!clockOk) allPass = false;
  }

  // ─── 2. CANONICAL_FAST_B0_PARITY ────────────────────────────────────────────
  console.log("\n2. CANONICAL_FAST_B0_PARITY");
  {
    const b0Config: ReplayConfig = {
      pair, availableCapitalUsd: 10000, feeModel: HISTORICAL_FEE_MODEL,
      evaluationStartMs: evalStart, evaluationEndMs: evalEnd,
    };

    const refResult = runReplay(candleSet, b0Config);
    const precomputed = precomputeFrames(pair, candleSet, { ...V3_ENABLED, enabled: false });
    const fastResult = fastReplay(precomputed, b0Config);

    let parityOk = true;
    parityOk = assertEq("  tradeCount", fastResult.trades.length, refResult.trades.length) && parityOk;
    parityOk = assertClose("  netPnl", fastResult.stats.netPnlUsd, refResult.stats.netPnlUsd, 0.01) && parityOk;
    parityOk = assertClose("  profitFactor", fastResult.stats.profitFactor, refResult.stats.profitFactor, 0.001) && parityOk;

    if (fastResult.trades.length === refResult.trades.length) {
      for (let i = 0; i < refResult.trades.length; i++) {
        const ref = refResult.trades[i];
        const fast = fastResult.trades[i];
        // signalId counters differ: precomputeFrames counts all signals across full dataset,
        // runReplay only counts within evaluation window. Compare material fields instead.
        parityOk = assertClose(`  trade[${i}].openedAtMs`, fast.openedAtMs, ref.openedAtMs, 0) && parityOk;
        parityOk = assertClose(`  trade[${i}].entryPrice`, fast.entryPrice, ref.entryPrice, 0) && parityOk;
        parityOk = assertClose(`  trade[${i}].volume`, fast.volume, ref.volume, 0.00000001) && parityOk;
        parityOk = assertClose(`  trade[${i}].entryFee`, fast.entryFeeUsd, ref.entryFeeUsd, 0.00000001) && parityOk;
        parityOk = assertClose(`  trade[${i}].closedAtMs`, fast.closedAtMs, ref.closedAtMs, 0) && parityOk;
        parityOk = assertClose(`  trade[${i}].exitPrice`, fast.exitPrice, ref.exitPrice, 0) && parityOk;
        parityOk = assertClose(`  trade[${i}].exitFee`, fast.exitFeeUsd, ref.exitFeeUsd, 0.00000001) && parityOk;
        parityOk = assertEq(`  trade[${i}].exitReason`, fast.exitReason, ref.exitReason) && parityOk;
        parityOk = assertClose(`  trade[${i}].netPnl`, fast.netPnlUsd, ref.netPnlUsd, 0.00000001) && parityOk;
      }
    }

    console.log(`  CANONICAL_FAST_B0_PARITY=${parityOk ? "PASS" : "FAIL"}`);
    if (!parityOk) allPass = false;
  }

  // ─── 3. V4_THRESHOLD_ZERO_EQUALS_B0 ────────────────────────────────────────
  console.log("\n3. V4_THRESHOLD_ZERO_EQUALS_B0");
  {
    const b0Config: ReplayConfig = {
      pair, availableCapitalUsd: 10000, feeModel: HISTORICAL_FEE_MODEL,
      evaluationStartMs: evalStart, evaluationEndMs: evalEnd,
    };
    const v4ZeroConfig: ReplayConfig = {
      pair, availableCapitalUsd: 10000, feeModel: HISTORICAL_FEE_MODEL,
      entryV3Config: V3_ENABLED,
      evaluationStartMs: evalStart, evaluationEndMs: evalEnd,
      v4MinQualityScore: 0,
    };

    const precomputedV3 = precomputeFrames(pair, candleSet, V3_ENABLED);
    const b0Result = fastReplay(precomputedV3, b0Config);
    const v4ZeroResult = fastReplay(precomputedV3, v4ZeroConfig);

    let parityOk = true;
    parityOk = assertEq("  tradeCount", v4ZeroResult.trades.length, b0Result.trades.length) && parityOk;
    parityOk = assertClose("  netPnl", v4ZeroResult.stats.netPnlUsd, b0Result.stats.netPnlUsd, 0.01) && parityOk;
    parityOk = assertClose("  totalFees", v4ZeroResult.stats.totalFeesUsd, b0Result.stats.totalFeesUsd, 0.01) && parityOk;
    parityOk = assertClose("  profitFactor", v4ZeroResult.stats.profitFactor, b0Result.stats.profitFactor, 0.001) && parityOk;

    if (v4ZeroResult.trades.length === b0Result.trades.length) {
      for (let i = 0; i < b0Result.trades.length; i++) {
        const b0 = b0Result.trades[i];
        const v4 = v4ZeroResult.trades[i];
        parityOk = assertClose(`  trade[${i}].openedAtMs`, v4.openedAtMs, b0.openedAtMs, 0) && parityOk;
        parityOk = assertClose(`  trade[${i}].entryPrice`, v4.entryPrice, b0.entryPrice, 0) && parityOk;
        parityOk = assertClose(`  trade[${i}].volume`, v4.volume, b0.volume, 0.00000001) && parityOk;
        parityOk = assertClose(`  trade[${i}].entryFee`, v4.entryFeeUsd, b0.entryFeeUsd, 0.00000001) && parityOk;
        parityOk = assertClose(`  trade[${i}].closedAtMs`, v4.closedAtMs, b0.closedAtMs, 0) && parityOk;
        parityOk = assertClose(`  trade[${i}].exitPrice`, v4.exitPrice, b0.exitPrice, 0) && parityOk;
        parityOk = assertClose(`  trade[${i}].exitFee`, v4.exitFeeUsd, b0.exitFeeUsd, 0.00000001) && parityOk;
        parityOk = assertEq(`  trade[${i}].exitReason`, v4.exitReason, b0.exitReason) && parityOk;
        parityOk = assertClose(`  trade[${i}].netPnl`, v4.netPnlUsd, b0.netPnlUsd, 0.00000001) && parityOk;
      }
    }

    console.log(`  V4_THRESHOLD_ZERO_EQUALS_B0=${parityOk ? "PASS" : "FAIL"}`);
    if (!parityOk) allPass = false;
  }

  // ─── 4. V4_REAL_FUTURE_INVARIANCE ───────────────────────────────────────────
  console.log("\n4. V4_REAL_FUTURE_INVARIANCE");
  {
    const precomputedA = precomputeFrames(pair, candleSet, V3_ENABLED);

    // Pick a frame T in the middle with v3Features
    const frameT = precomputedA.frames.find(f => f.v3Features != null && f.index > 700);
    if (!frameT || !frameT.v3Features) {
      console.log("  V4_REAL_FUTURE_INVARIANCE=FAIL (no suitable frame T found)");
      allPass = false;
    } else {
      const T = frameT.evaluationTime;
      const featuresA = frameT.v3Features;
      const scoresA = computeV4QualityScores(featuresA);

      // Alter all candles AFTER T
      const altered5m = c5.rows.map(r => r.timestamp > T ? { ...r, open: r.open * 2, high: r.high * 3, low: r.low * 0.5, close: r.close * 2.5, volume: r.volume * 10 } : r);
      const altered15m = c15.rows.map(r => r.timestamp > T ? { ...r, open: r.open * 2, high: r.high * 3, low: r.low * 0.5, close: r.close * 2.5, volume: r.volume * 10 } : r);
      const altered1h = c60.rows.map(r => r.timestamp > T ? { ...r, open: r.open * 2, high: r.high * 3, low: r.low * 0.5, close: r.close * 2.5, volume: r.volume * 10 } : r);
      const altered4h = c240.rows.map(r => r.timestamp > T ? { ...r, open: r.open * 2, high: r.high * 3, low: r.low * 0.5, close: r.close * 2.5, volume: r.volume * 10 } : r);

      const alteredCandleSet: ReplayCandleSet = {
        pair,
        candles5m: altered5m.map(toSpotCandle),
        candles15m: altered15m.map(toSpotCandle),
        candles1h: altered1h.map(toSpotCandle),
        candles4h: altered4h.map(toSpotCandle),
      };

      const precomputedB = precomputeFrames(pair, alteredCandleSet, V3_ENABLED);
      const frameB = precomputedB.frames.find(f => f.evaluationTime === T);

      if (!frameB || !frameB.v3Features) {
        console.log("  V4_REAL_FUTURE_INVARIANCE=FAIL (frame B not found or no features)");
        allPass = false;
      } else {
        const featuresB = frameB.v3Features;
        const scoresB = computeV4QualityScores(featuresB);

        const featEq = featuresEqual(featuresA, featuresB);
        const scoreEq = scoresA.qualityScore === scoresB.qualityScore &&
          scoresA.impulseScore === scoresB.impulseScore &&
          scoresA.retracementScore === scoresB.retracementScore &&
          scoresA.structureScore === scoresB.structureScore &&
          scoresA.reclaimScore === scoresB.reclaimScore &&
          scoresA.resumptionScore === scoresB.resumptionScore;

        console.log(`  featuresEqual=${featEq} scoresEqual=${scoreEq}`);
        console.log(`  scoreA=${scoresA.qualityScore} scoreB=${scoresB.qualityScore}`);
        console.log(`  V4_REAL_FUTURE_INVARIANCE=${featEq && scoreEq ? "PASS" : "FAIL"}`);
        if (!featEq || !scoreEq) allPass = false;
      }
    }
  }

  // ─── 5. V4_ACCEPTS_B0_REJECTED ─────────────────────────────────────────────
  console.log("\n5. V4_ACCEPTS_B0_REJECTED");
  {
    const v4Config: ReplayConfig = {
      pair, availableCapitalUsd: 10000, feeModel: HISTORICAL_FEE_MODEL,
      entryV3Config: V3_ENABLED,
      evaluationStartMs: evalStart, evaluationEndMs: evalEnd,
      v4MinQualityScore: 0.3,
    };

    const precomputedV3 = precomputeFrames(pair, candleSet, V3_ENABLED);
    const v4Result = fastReplay(precomputedV3, v4Config);

    const accepts = v4Result.v4AcceptsB0Rejected ?? 0;
    console.log(`  V4_ACCEPTS_B0_REJECTED=${accepts}`);
    console.log(`  V4_ACCEPTS_B0_REJECTED=${accepts === 0 ? "PASS" : "FAIL"}`);
    if (accepts !== 0) allPass = false;
  }

  // ─── 6. B0_SCORE_COVERAGE ──────────────────────────────────────────────────
  console.log("\n6. B0_SCORE_COVERAGE");
  {
    const b0Config: ReplayConfig = {
      pair, availableCapitalUsd: 10000, feeModel: HISTORICAL_FEE_MODEL,
      evaluationStartMs: evalStart, evaluationEndMs: evalEnd,
    };

    const precomputedV3 = precomputeFrames(pair, candleSet, V3_ENABLED);
    const b0Result = fastReplay(precomputedV3, b0Config);

    let totalTrades = 0;
    let mapped = 0;
    let missing = 0;

    for (const trade of b0Result.trades) {
      totalTrades++;
      const frame = precomputedV3.frames.find(f => f.evaluationTime === trade.openedAtMs);
      if (!frame || !frame.v3Features) {
        missing++;
        continue;
      }
      const scores = computeV4QualityScores(frame.v3Features);
      if (typeof scores.qualityScore === "number" && !isNaN(scores.qualityScore)) {
        mapped++;
      } else {
        missing++;
      }
    }

    const coverage = totalTrades > 0 ? Math.round((mapped / totalTrades) * 10000) / 100 : 0;
    console.log(`  totalTrades=${totalTrades} mapped=${mapped} missing=${missing} coverage=${coverage}%`);
    console.log(`  B0_SCORE_COVERAGE=${coverage === 100 ? "PASS" : "FAIL"}`);
    if (coverage !== 100) allPass = false;
  }

  // ─── Summary ───────────────────────────────────────────────────────────────
  console.log(`\nALL_V4_COUNTER_AUDIT_TESTS=${allPass ? "PASS" : "FAIL"}`);
  process.exit(allPass ? 0 : 1);
}

main();
