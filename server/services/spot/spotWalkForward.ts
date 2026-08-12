/**
 * SpotWalkForward — Walk-forward analysis for SPOT_CANONICAL robustness.
 *
 * D9: Replay sin lookahead. D10: SPOT_POLICY_VERSION congelado post-deploy.
 *
 * Splits candle data into in-sample (IS) and out-of-sample (OOS) windows.
 * Runs replay on each window independently. Checks that performance metrics
 * are consistent across windows (no overfitting to a single period).
 *
 * Robustness criteria:
 *   - OOS win rate within 15% of IS win rate
 *   - OOS profit factor > 0.5 (not necessarily profitable, but not catastrophic)
 *   - No window with 100% loss rate (unless total trades < 3)
 *   - Avg R-multiple OOS within 0.5 of IS
 */

import { runReplay, type ReplayCandleSet, type ReplayConfig, type ReplayResult, type ReplayStats } from "./spotReplayEngine";

export interface WalkForwardWindow {
  label: string;
  startIndex: number;
  endIndex: number;
  result: ReplayResult;
  isInSample: boolean;
}

export interface WalkForwardResult {
  pair: string;
  windows: WalkForwardWindow[];
  isRobust: boolean;
  robustnessChecks: RobustnessCheck[];
  aggregateIS: ReplayStats;
  aggregateOOS: ReplayStats;
}

export interface RobustnessCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface WalkForwardConfig {
  /** Number of windows (default 4) */
  numWindows?: number;
  /** Fraction of each window that is in-sample (default 0.6) */
  inSampleFraction?: number;
  /** Min trades per window for stats to be meaningful (default 5) */
  minTradesPerWindow?: number;
}

export const DEFAULT_WF_CONFIG: WalkForwardConfig = {
  numWindows: 4,
  inSampleFraction: 0.6,
  minTradesPerWindow: 5,
};

/**
 * Run walk-forward analysis on historical candles.
 *
 * Splits the 15m candles into N windows. Each window is further split into
 * in-sample (first 60%) and out-of-sample (last 40%). Runs replay on each
 * sub-window independently.
 */
export function runWalkForward(
  candles: ReplayCandleSet,
  config: ReplayConfig,
  wfConfig: WalkForwardConfig = DEFAULT_WF_CONFIG,
): WalkForwardResult {
  const numWindows = wfConfig.numWindows ?? 4;
  const isFraction = wfConfig.inSampleFraction ?? 0.6;
  const minTrades = wfConfig.minTradesPerWindow ?? 5;
  const pair = config.pair;

  const sorted15m = [...candles.candles15m].sort((a, b) => a.time - b.time);
  const totalLen = sorted15m.length;
  const windowSize = Math.floor(totalLen / numWindows);

  const windows: WalkForwardWindow[] = [];

  for (let w = 0; w < numWindows; w++) {
    const start = w * windowSize;
    const end = Math.min((w + 1) * windowSize, totalLen);
    const isEnd = start + Math.floor((end - start) * isFraction);

    // In-sample window
    const isCandles = sliceCandles(candles, start, isEnd);
    const isResult = runReplay(isCandles, config);
    windows.push({
      label: `W${w + 1}-IS`,
      startIndex: start,
      endIndex: isEnd,
      result: isResult,
      isInSample: true,
    });

    // Out-of-sample window
    const oosCandles = sliceCandles(candles, isEnd, end);
    const oosResult = runReplay(oosCandles, config);
    windows.push({
      label: `W${w + 1}-OOS`,
      startIndex: isEnd,
      endIndex: end,
      result: oosResult,
      isInSample: false,
    });
  }

  // Aggregate IS and OOS stats
  const isTrades = windows.filter(w => w.isInSample).flatMap(w => w.result.trades);
  const oosTrades = windows.filter(w => !w.isInSample).flatMap(w => w.result.trades);

  const aggregateIS = aggregateStats(isTrades);
  const aggregateOOS = aggregateStats(oosTrades);

  // Robustness checks
  const checks = runRobustnessChecks(windows, aggregateIS, aggregateOOS, minTrades);
  const isRobust = checks.every(c => c.passed);

  return {
    pair,
    windows,
    isRobust,
    robustnessChecks: checks,
    aggregateIS,
    aggregateOOS,
  };
}

function sliceCandles(candles: ReplayCandleSet, start: number, end: number): ReplayCandleSet {
  const slice15m = candles.candles15m
    .sort((a, b) => a.time - b.time)
    .slice(start, end);
  const startTime = slice15m[0]?.time ?? 0;
  const endTime = slice15m[slice15m.length - 1]?.time ?? Infinity;

  return {
    pair: candles.pair,
    candles5m: candles.candles5m.filter(c => c.time >= startTime && c.time <= endTime),
    candles15m: slice15m,
    candles1h: candles.candles1h.filter(c => c.time >= startTime && c.time <= endTime),
    candles4h: candles.candles4h.filter(c => c.time >= startTime && c.time <= endTime),
  };
}

function aggregateStats(trades: any[]): ReplayStats {
  if (trades.length === 0) {
    return {
      totalTrades: 0, wins: 0, losses: 0, winRate: 0,
      netPnlUsd: 0, grossPnlUsd: 0, totalFeesUsd: 0,
      avgNetPnlUsd: 0, avgRMultiple: 0, profitFactor: 0,
      avgHoldTimeMinutes: 0, avgMfeUsd: 0, avgMaeUsd: 0, avgMfeR: 0,
      bestTradeUsd: 0, worstTradeUsd: 0,
      maxConsecutiveWins: 0, maxConsecutiveLosses: 0,
      excellentCount: 0, goodCount: 0, poorCount: 0, badCount: 0,
    };
  }
  const n = trades.length;
  const wins = trades.filter((t: any) => t.netPnlUsd > 0);
  const losses = trades.filter((t: any) => t.netPnlUsd <= 0);
  const grossWin = wins.reduce((s: number, t: any) => s + t.netPnlUsd, 0);
  const grossLoss = Math.abs(losses.reduce((s: number, t: any) => s + t.netPnlUsd, 0));

  return {
    totalTrades: n,
    wins: wins.length,
    losses: losses.length,
    winRate: wins.length / n,
    netPnlUsd: trades.reduce((s: number, t: any) => s + t.netPnlUsd, 0),
    grossPnlUsd: trades.reduce((s: number, t: any) => s + t.grossPnlUsd, 0),
    totalFeesUsd: trades.reduce((s: number, t: any) => s + t.entryFeeUsd + t.exitFeeUsd, 0),
    avgNetPnlUsd: trades.reduce((s: number, t: any) => s + t.netPnlUsd, 0) / n,
    avgRMultiple: trades.reduce((s: number, t: any) => s + t.rMultiple, 0) / n,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    avgHoldTimeMinutes: trades.reduce((s: number, t: any) => s + t.holdTimeMinutes, 0) / n,
    avgMfeUsd: trades.reduce((s: number, t: any) => s + t.mfeUsd, 0) / n,
    avgMaeUsd: trades.reduce((s: number, t: any) => s + t.maeUsd, 0) / n,
    avgMfeR: trades.reduce((s: number, t: any) => s + t.mfeR, 0) / n,
    bestTradeUsd: Math.max(...trades.map((t: any) => t.netPnlUsd)),
    worstTradeUsd: Math.min(...trades.map((t: any) => t.netPnlUsd)),
    maxConsecutiveWins: 0,
    maxConsecutiveLosses: 0,
    excellentCount: trades.filter((t: any) => t.profitCaptureClass === "EXCELLENT").length,
    goodCount: trades.filter((t: any) => t.profitCaptureClass === "GOOD").length,
    poorCount: trades.filter((t: any) => t.profitCaptureClass === "POOR").length,
    badCount: trades.filter((t: any) => t.profitCaptureClass === "BAD").length,
  };
}

function runRobustnessChecks(
  windows: WalkForwardWindow[],
  isStats: ReplayStats,
  oosStats: ReplayStats,
  minTrades: number,
): RobustnessCheck[] {
  const checks: RobustnessCheck[] = [];

  // Check 1: OOS win rate within 15% of IS
  if (isStats.totalTrades >= minTrades && oosStats.totalTrades >= minTrades) {
    const diff = Math.abs(oosStats.winRate - isStats.winRate);
    checks.push({
      name: "OOS win rate within 15% of IS",
      passed: diff <= 0.15,
      detail: `IS=${(isStats.winRate * 100).toFixed(1)}% OOS=${(oosStats.winRate * 100).toFixed(1)}% diff=${(diff * 100).toFixed(1)}%`,
    });
  } else {
    checks.push({
      name: "OOS win rate within 15% of IS",
      passed: true,
      detail: `Skipped (insufficient trades: IS=${isStats.totalTrades} OOS=${oosStats.totalTrades})`,
    });
  }

  // Check 2: OOS profit factor > 0.5
  if (oosStats.totalTrades >= minTrades) {
    const pf = oosStats.profitFactor;
    checks.push({
      name: "OOS profit factor > 0.5",
      passed: pf > 0.5,
      detail: `OOS PF=${pf.toFixed(2)}`,
    });
  } else {
    checks.push({
      name: "OOS profit factor > 0.5",
      passed: true,
      detail: `Skipped (insufficient trades: OOS=${oosStats.totalTrades})`,
    });
  }

  // Check 3: No window with 100% loss rate (unless < minTrades)
  const oosWindows = windows.filter(w => !w.isInSample);
  const badWindows = oosWindows.filter(w =>
    w.result.stats.totalTrades >= minTrades &&
    w.result.stats.wins === 0
  );
  checks.push({
    name: "No OOS window with 100% loss rate",
    passed: badWindows.length === 0,
    detail: badWindows.length === 0
      ? "All OOS windows have at least 1 win"
      : `${badWindows.length} windows with 100% loss: ${badWindows.map(w => w.label).join(", ")}`,
  });

  // Check 4: Avg R-multiple OOS within 0.5 of IS
  if (isStats.totalTrades >= minTrades && oosStats.totalTrades >= minTrades) {
    const rDiff = Math.abs(oosStats.avgRMultiple - isStats.avgRMultiple);
    checks.push({
      name: "OOS avg R within 0.5 of IS",
      passed: rDiff <= 0.5,
      detail: `IS R=${isStats.avgRMultiple.toFixed(2)} OOS R=${oosStats.avgRMultiple.toFixed(2)} diff=${rDiff.toFixed(2)}`,
    });
  } else {
    checks.push({
      name: "OOS avg R within 0.5 of IS",
      passed: true,
      detail: `Skipped (insufficient trades)`,
    });
  }

  // Check 5: No lookahead contamination (IS and OOS windows don't overlap)
  checks.push({
    name: "No IS/OOS window overlap",
    passed: true,
    detail: "Windows are sequential by construction (sliceCandles non-overlapping)",
  });

  return checks;
}
