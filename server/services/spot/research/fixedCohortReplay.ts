/**
 * fixedCohortReplay.ts — Exit R1 fixed-cohort (same-entries) replay.
 *
 * Replays ONLY the exit path for a frozen cohort of entries captured from a
 * previous path-dependent run (typically E0). Entries are not re-evaluated:
 * each frozen position is opened at its recorded openedAtMs/entryPrice and
 * managed forward candle-by-candle until the evaluator exits or the data ends.
 *
 * Gate: with the production evaluator + E0 config, the cohort replay MUST
 * reproduce the original E0 exits exactly (same exitReason, same closedAtMs,
 * same exitPrice) — test FIXED_COHORT_REPRODUCES_E0.
 *
 * Temporal correctness: identical to fastReplay — ctx built from closed
 * candles ≤ evaluation time, exits fill at next 5m candle open (fillPrice).
 */

import {
  type SpotCandle,
  type SpotPosition,
  type SpotExitState,
  type SpotMarketContext,
  type SpotExitDecision,
  ExitReasonType,
  ExecutionMode,
  SPOT_POLICY_VERSION,
  SetupTag,
  Regime,
  RegimeDirection,
  MacroBias,
} from "../spotTypes";
import { buildReplayContextFast, type ReplayTrade } from "../spotReplayEngine";
import { createExitState, evaluateExit, DEFAULT_SPOT_EXIT_CONFIG, type SpotExitConfig } from "../spotExitPolicy";
import { computePnlBreakdown, computeFeeBreakdown, type FeeModel } from "../feeModel";
import { SpotAuditTracker, classifyProfitCapture } from "../spotAuditTracker";
import { prepareCandles } from "../closedCandleContract";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Frozen entry snapshot — everything needed to reconstruct the position. */
export interface FrozenEntry {
  lotId: string;
  pair: string;
  signalId: string;
  setupTag: string;
  regimeAtEntry: string;
  directionAtEntry: string;
  entryPrice: number;
  volume: number;
  openedAtMs: number;
  initialStopPrice: number;
  initialStopDistanceUsd: number;
  riskUsd: number;
  notionalUsd: number;
  entryFee: number;
  /** Original E0 outcome (for reproduction gate / delta analysis). */
  e0ExitReason?: string;
  e0ExitPrice?: number;
  e0ClosedAtMs?: number;
  e0NetPnlUsd?: number;
  e0RMultiple?: number;
}

export interface CohortCandles {
  candles5m: SpotCandle[];
  candles15m: SpotCandle[];
  candles1h: SpotCandle[];
  candles4h: SpotCandle[];
}

export type CohortExitEvaluator = (
  position: SpotPosition,
  state: SpotExitState,
  ctx: SpotMarketContext,
  config: SpotExitConfig,
  nowMs: number,
) => SpotExitDecision;

export interface CohortReplayResult {
  trades: ReplayTrade[];
  /** Per-lot comparison vs original E0 outcome when provided. */
  deltas: {
    lotId: string;
    e0ExitReason?: string; e0ClosedAtMs?: number; e0NetPnlUsd?: number; e0RMultiple?: number;
    exitReason: string; closedAtMs: number; netPnlUsd: number; rMultiple: number;
    sameExit: boolean;
  }[];
}

// ─── Reconstruction ─────────────────────────────────────────────────────────

export function frozenEntryToPosition(e: FrozenEntry): SpotPosition {
  return {
    lotId: e.lotId,
    pair: e.pair,
    amount: e.volume,
    qtyRemaining: e.volume,
    entryPrice: e.entryPrice,
    entryFee: e.entryFee,
    entryFeeQuality: "ESTIMATED",
    highestPrice: e.entryPrice,
    openedAt: e.openedAtMs,
    entryStrategyId: "RESEARCH_COHORT",
    entrySignalTf: "15m",
    signalConfidence: 0,
    signalReason: "frozen-cohort",
    setupTag: e.setupTag as SetupTag,
    signalId: e.signalId,
    marketContextId: "cohort",
    regimeAtEntry: e.regimeAtEntry as Regime,
    directionAtEntry: e.directionAtEntry as RegimeDirection,
    macroAtEntry: MacroBias.NEUTRAL,
    atrPctAtEntry: 0,
    initialStopPrice: e.initialStopPrice,
    initialStopDistancePct: e.entryPrice > 0 ? (e.initialStopDistanceUsd / e.entryPrice) * 100 : 0,
    initialStopDistanceUsd: e.initialStopDistanceUsd,
    riskUsd: e.riskUsd,
    notionalUsd: e.notionalUsd,
    executionMode: ExecutionMode.SHADOW,
    policyVersion: SPOT_POLICY_VERSION,
    sgBreakEvenActivated: false,
    sgTrailingActivated: false,
    sgScaleOutDone: false,
    sgCurrentStopPrice: 0,
    mfe: 0, mae: 0, mfeR: 0, maeR: 0,
  };
}

// ─── Cohort replay ──────────────────────────────────────────────────────────

const FIVE_MIN_MS = 5 * 60 * 1000;

/**
 * Replay exits for a frozen cohort on one pair's candle data.
 * Each entry is evaluated independently (no concurrency limits — the cohort
 * fixes entries; exits are path-dependent per position only).
 */
export function fixedCohortReplay(
  entries: FrozenEntry[],
  candles: CohortCandles,
  exitConfig: SpotExitConfig = DEFAULT_SPOT_EXIT_CONFIG,
  evaluator: CohortExitEvaluator = evaluateExit,
  feeModel?: FeeModel,
): CohortReplayResult {
  const sorted5m = prepareCandles(candles.candles5m);
  const sorted15m = prepareCandles(candles.candles15m);
  const sorted1h = prepareCandles(candles.candles1h);
  const sorted4h = prepareCandles(candles.candles4h);

  const trades: ReplayTrade[] = [];
  const deltas: CohortReplayResult["deltas"] = [];

  for (const entry of entries) {
    const pos = frozenEntryToPosition(entry);
    const state: SpotExitState = createExitState(pos);
    const audit = new SpotAuditTracker();

    // Evaluation times: 5m candle close times strictly after openedAt
    const evalTimes = sorted5m
      .map(c => c.time + FIVE_MIN_MS)
      .filter(t => t > entry.openedAtMs);

    let closed = false;
    for (const evalTime of evalTimes) {
      // currentPrice = close of the candle that just closed
      const candleIdx = sorted5m.findIndex(c => c.time + FIVE_MIN_MS === evalTime);
      if (candleIdx < 0) continue;
      const currentPrice = sorted5m[candleIdx].close;
      // Fill at next candle open (same convention as fastReplay)
      const nextCandle = sorted5m[candleIdx + 1];
      const fillPrice = nextCandle ? nextCandle.open : currentPrice;

      const ctx = buildReplayContextFast(
        entry.pair, sorted5m, sorted15m, sorted1h, sorted4h, evalTime, currentPrice,
      );
      if (!ctx) continue;

      audit.updatePrice(pos, ctx.ticker.last, evalTime);
      const decision = evaluator(pos, state, ctx, exitConfig, evalTime);
      if (decision.shouldExit) {
        const exitPrice = fillPrice;
        const feeBreakdown = computeFeeBreakdown(pos.entryPrice, exitPrice, pos.qtyRemaining, feeModel);
        const pnl = computePnlBreakdown({
          entryPrice: pos.entryPrice, exitPrice, volume: pos.qtyRemaining,
          entryFeeUsd: pos.entryFee, feeModel,
        });
        const auditResult = audit.finalizeExit(pos, exitPrice, decision.reasonType ?? "TIME_EFFICIENCY", evalTime);
        const posMetrics = audit.getMetrics(pos.lotId);
        const rMultiple = pos.initialStopDistanceUsd > 0
          ? (exitPrice - pos.entryPrice) / pos.initialStopDistanceUsd : 0;
        trades.push({
          lotId: pos.lotId, pair: pos.pair, signalId: pos.signalId,
          setupTag: pos.setupTag,
          regimeAtEntry: pos.regimeAtEntry ?? "UNKNOWN",
          directionAtEntry: pos.directionAtEntry ?? "NEUTRAL",
          entryPrice: pos.entryPrice, exitPrice, volume: pos.qtyRemaining,
          entryFeeUsd: feeBreakdown.entryFeeUsd, exitFeeUsd: feeBreakdown.exitFeeUsd,
          grossPnlUsd: pnl.grossPnlUsd, netPnlUsd: pnl.netPnlUsd, rMultiple,
          exitReason: decision.reasonType ?? ExitReasonType.TIME_EFFICIENCY,
          openedAtMs: pos.openedAt, closedAtMs: evalTime,
          holdTimeMinutes: Math.round((evalTime - pos.openedAt) / 60000),
          mfeUsd: posMetrics?.mfeUsd ?? 0, maeUsd: posMetrics?.maeUsd ?? 0,
          mfeR: posMetrics?.mfeR ?? 0,
          profitCapturePct: auditResult.profitCapturePct,
          profitCaptureClass: classifyProfitCapture(auditResult.profitCapturePct),
          executionMode: ExecutionMode.SHADOW, policyVersion: SPOT_POLICY_VERSION,
        });
        closed = true;
        break;
      }
    }

    // Still open at data end → close at terminal close
    if (!closed && sorted5m.length > 0) {
      const lastCandle = sorted5m[sorted5m.length - 1];
      const exitPrice = lastCandle.close;
      const evalTime = lastCandle.time + FIVE_MIN_MS;
      const feeBreakdown = computeFeeBreakdown(pos.entryPrice, exitPrice, pos.qtyRemaining, feeModel);
      const pnl = computePnlBreakdown({
        entryPrice: pos.entryPrice, exitPrice, volume: pos.qtyRemaining,
        entryFeeUsd: pos.entryFee, feeModel,
      });
      const auditResult = audit.finalizeExit(pos, exitPrice, ExitReasonType.RESEARCH_WINDOW_END, evalTime);
      const posMetrics = audit.getMetrics(pos.lotId);
      const rMultiple = pos.initialStopDistanceUsd > 0
        ? (exitPrice - pos.entryPrice) / pos.initialStopDistanceUsd : 0;
      trades.push({
        lotId: pos.lotId, pair: pos.pair, signalId: pos.signalId,
        setupTag: pos.setupTag,
        regimeAtEntry: pos.regimeAtEntry ?? "UNKNOWN",
        directionAtEntry: pos.directionAtEntry ?? "NEUTRAL",
        entryPrice: pos.entryPrice, exitPrice, volume: pos.qtyRemaining,
        entryFeeUsd: feeBreakdown.entryFeeUsd, exitFeeUsd: feeBreakdown.exitFeeUsd,
        grossPnlUsd: pnl.grossPnlUsd, netPnlUsd: pnl.netPnlUsd, rMultiple,
        exitReason: ExitReasonType.RESEARCH_WINDOW_END,
        openedAtMs: pos.openedAt, closedAtMs: evalTime,
        holdTimeMinutes: Math.round((evalTime - pos.openedAt) / 60000),
        mfeUsd: posMetrics?.mfeUsd ?? 0, maeUsd: posMetrics?.maeUsd ?? 0,
        mfeR: posMetrics?.mfeR ?? 0,
        profitCapturePct: auditResult.profitCapturePct,
        profitCaptureClass: classifyProfitCapture(auditResult.profitCapturePct),
        executionMode: ExecutionMode.SHADOW, policyVersion: SPOT_POLICY_VERSION,
      });
    }

    const t = trades[trades.length - 1];
    deltas.push({
      lotId: entry.lotId,
      e0ExitReason: entry.e0ExitReason, e0ClosedAtMs: entry.e0ClosedAtMs,
      e0NetPnlUsd: entry.e0NetPnlUsd, e0RMultiple: entry.e0RMultiple,
      exitReason: t?.exitReason ?? "NONE", closedAtMs: t?.closedAtMs ?? 0,
      netPnlUsd: t?.netPnlUsd ?? 0, rMultiple: t?.rMultiple ?? 0,
      sameExit: t !== undefined
        && t.exitReason === entry.e0ExitReason
        && t.closedAtMs === entry.e0ClosedAtMs
        && Math.abs(t.exitPrice - (entry.e0ExitPrice ?? NaN)) < 1e-9,
    });
  }

  return { trades, deltas };
}
