/**
 * Equivalence test: runReplay vs fastReplay
 *
 * Loads 1 pair, runs both replay methods with the same config,
 * and asserts identical results for trade count, entry/exit, PnL, fees, PF.
 *
 * Usage:
 *   node --import tsx server/services/spot/research/testFastReplayEquivalence.ts
 */

import { runReplay, type ReplayCandleSet, type ReplayConfig } from "../spotReplayEngine";
import { precomputeFrames, fastReplay } from "./fastResearchReplay";
import { DEFAULT_ENTRY_V3_CONFIG, type EntryV3Config } from "../spotEntryV3";
import { type FeeModel } from "../feeModel";
import { loadAllCached, PAIR_MAPPINGS, type KrakenOHLCRow } from "./krakenHistoricalLoader";
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
    console.error(`MISMATCH ${label}: expected=${expected} actual=${actual}`);
    return false;
  }
  console.log(`OK ${label}: ${actual}`);
  return true;
}

function assertClose(label: string, actual: number, expected: number, tolerance: number = 0.0001): boolean {
  if (Math.abs(actual - expected) > tolerance) {
    console.error(`MISMATCH ${label}: expected=${expected} actual=${actual} diff=${Math.abs(actual - expected)}`);
    return false;
  }
  console.log(`OK ${label}: ${actual}`);
  return true;
}

function main(): void {
  const pair = PAIR_MAPPINGS[0].requested;
  console.log(`\n=== Equivalence test for ${pair} ===\n`);

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

  // Use full dataset (no evaluation window restriction) for maximum trade count
  const evalStart = c5.rows[0].timestamp;
  const evalEnd = c5.rows[c5.rows.length - 1].timestamp;

  // Test with V3 enabled
  const config: ReplayConfig = {
    pair,
    availableCapitalUsd: 10000,
    feeModel: HISTORICAL_FEE_MODEL,
    entryV3Config: V3_ENABLED,
    evaluationStartMs: evalStart,
    evaluationEndMs: evalEnd,
  };

  console.log("Running runReplay...");
  const t0 = Date.now();
  const refResult = runReplay(candleSet, config);
  const refMs = Date.now() - t0;
  console.log(`  runReplay: ${refResult.trades.length} trades, ${refMs}ms`);

  console.log("Running precomputeFrames + fastReplay...");
  const t1 = Date.now();
  const precomputed = precomputeFrames(pair, candleSet, V3_ENABLED);
  const preMs = Date.now() - t1;
  console.log(`  precompute: ${precomputed.frames.length} frames, ${preMs}ms`);

  const t2 = Date.now();
  const fastResult = fastReplay(precomputed, config);
  const fastMs = Date.now() - t2;
  console.log(`  fastReplay: ${fastResult.trades.length} trades, ${fastMs}ms`);

  console.log(`\nSpeedup: ${((refMs / Math.max(fastMs, 1)) * 100 / 100).toFixed(1)}x (excluding precompute)`);
  console.log(`Speedup (incl precompute): ${(refMs / Math.max(preMs + fastMs, 1)).toFixed(1)}x\n`);

  // ── Compare stats ──
  let allOk = true;

  allOk = assertEq("tradeCount", fastResult.trades.length, refResult.trades.length) && allOk;
  allOk = assertEq("signalsBuy", fastResult.stats.signalsBuy, refResult.stats.signalsBuy) && allOk;
  allOk = assertEq("intentExecutable", fastResult.stats.intentExecutable, refResult.stats.intentExecutable) && allOk;
  allOk = assertEq("entriesExecuted", fastResult.stats.entriesExecuted, refResult.stats.entriesExecuted) && allOk;
  allOk = assertClose("netPnl", fastResult.stats.netPnlUsd, refResult.stats.netPnlUsd, 0.01) && allOk;
  allOk = assertClose("grossPnl", fastResult.stats.grossPnlUsd, refResult.stats.grossPnlUsd, 0.01) && allOk;
  allOk = assertClose("totalFees", fastResult.stats.totalFeesUsd, refResult.stats.totalFeesUsd, 0.01) && allOk;
  allOk = assertClose("winRate", fastResult.stats.winRate, refResult.stats.winRate, 0.0001) && allOk;
  allOk = assertClose("profitFactor", fastResult.stats.profitFactor, refResult.stats.profitFactor, 0.001) && allOk;
  allOk = assertEq("wins", fastResult.stats.wins, refResult.stats.wins) && allOk;
  allOk = assertEq("losses", fastResult.stats.losses, refResult.stats.losses) && allOk;

  // ── Compare per-trade details ──
  if (fastResult.trades.length === refResult.trades.length) {
    for (let i = 0; i < refResult.trades.length; i++) {
      const ref = refResult.trades[i];
      const fast = fastResult.trades[i];
      const prefix = `trade[${i}]`;
      allOk = assertEq(`${prefix}.lotId`, fast.lotId, ref.lotId) && allOk;
      allOk = assertClose(`${prefix}.entryPrice`, fast.entryPrice, ref.entryPrice, 0) && allOk;
      allOk = assertClose(`${prefix}.exitPrice`, fast.exitPrice, ref.exitPrice, 0) && allOk;
      allOk = assertClose(`${prefix}.volume`, fast.volume, ref.volume, 0.00000001) && allOk;
      allOk = assertClose(`${prefix}.netPnl`, fast.netPnlUsd, ref.netPnlUsd, 0.00000001) && allOk;
      allOk = assertClose(`${prefix}.entryFee`, fast.entryFeeUsd, ref.entryFeeUsd, 0.00000001) && allOk;
      allOk = assertClose(`${prefix}.exitFee`, fast.exitFeeUsd, ref.exitFeeUsd, 0.00000001) && allOk;
      allOk = assertEq(`${prefix}.exitReason`, fast.exitReason, ref.exitReason) && allOk;
      allOk = assertEq(`${prefix}.openedAtMs`, fast.openedAtMs, ref.openedAtMs) && allOk;
      allOk = assertEq(`${prefix}.closedAtMs`, fast.closedAtMs, ref.closedAtMs) && allOk;
    }
  }

  // ── Also test B0 (V3 OFF) ──
  console.log("\n--- B0 (V3 OFF) equivalence ---\n");
  const b0Config: ReplayConfig = {
    pair,
    availableCapitalUsd: 10000,
    feeModel: HISTORICAL_FEE_MODEL,
    evaluationStartMs: evalStart,
    evaluationEndMs: evalEnd,
  };

  const b0Ref = runReplay(candleSet, b0Config);
  const b0Precomputed = precomputeFrames(pair, candleSet, { ...V3_ENABLED, enabled: false });
  const b0Fast = fastReplay(b0Precomputed, b0Config);

  allOk = assertEq("B0.tradeCount", b0Fast.trades.length, b0Ref.trades.length) && allOk;
  allOk = assertClose("B0.netPnl", b0Fast.stats.netPnlUsd, b0Ref.stats.netPnlUsd, 0.01) && allOk;
  allOk = assertClose("B0.profitFactor", b0Fast.stats.profitFactor, b0Ref.stats.profitFactor, 0.001) && allOk;

  if (b0Fast.trades.length === b0Ref.trades.length) {
    for (let i = 0; i < b0Ref.trades.length; i++) {
      const ref = b0Ref.trades[i];
      const fast = b0Fast.trades[i];
      allOk = assertClose(`B0.trade[${i}].entryPrice`, fast.entryPrice, ref.entryPrice, 0) && allOk;
      allOk = assertClose(`B0.trade[${i}].exitPrice`, fast.exitPrice, ref.exitPrice, 0) && allOk;
      allOk = assertClose(`B0.trade[${i}].netPnl`, fast.netPnlUsd, ref.netPnlUsd, 0.00000001) && allOk;
    }
  }

  console.log(`\n=== ${allOk ? "ALL TESTS PASSED" : "TESTS FAILED"} ===`);
  process.exit(allOk ? 0 : 1);
}

main();
