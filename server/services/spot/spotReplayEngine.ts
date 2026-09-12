/**
 * SpotReplayEngine — Deterministic replay of SPOT_CANONICAL over historical candles.
 *
 * INVARIANTS:
 *   - No lookahead: signal evaluated at candle CLOSE, fill at NEXT candle OPEN.
 *   - Deterministic: same candles → same results, no random components.
 *   - Uses canonical SPOT pipeline: evaluateSpotCanonical → createEntryIntent →
 *     evaluateEntryIntent → evaluateSizing → SpotShadowAdapter → SpotExitPolicy.
 *   - Tracks MFE/MAE per trade via SpotAuditTracker.
 *   - PnL is NET (fees deducted) using canonical fee model.
 *
 * D9: Replay sin lookahead (señal al cierre, fill posterior, sin high/low futuro).
 */

import {
  type SpotCandle,
  type SpotMarketContext,
  type SpotPosition,
  type SpotEntryIntent,
  type SpotExitState,
  type SpotExitDecision,
  ExecutionMode,
  SetupTag,
  ExitReasonType,
  SPOT_POLICY_VERSION,
} from "./spotTypes";
import { evaluateSpotCanonical, type SpotSignalResult, type SpotCanonicalConfig } from "./spotCanonicalStrategy";
import { createEntryIntent, evaluateEntryIntent, type AntiLateEntryConfig } from "./spotEntryIntent";
import { evaluateEntryV3, evaluateV3AntiLateEntry, type EntryV3Config, DEFAULT_ENTRY_V3_CONFIG } from "./spotEntryV3";
import { evaluateSizing, type SpotRiskConfig, DEFAULT_SPOT_RISK_CONFIG } from "./spotRiskManager";
import { computePnlBreakdown, computeFeeBreakdown, type FeeQuality, type FeeModel } from "./feeModel";
import { evaluateExit, createExitState, type SpotExitConfig, DEFAULT_SPOT_EXIT_CONFIG } from "./spotExitPolicy";
import { SpotAuditTracker, classifyProfitCapture, type ExitAuditMetrics } from "./spotAuditTracker";
import { DataHealth, getCandleCloseTimeMs } from "./candleTimestamp";
import { type SpotTicker, type SpotVolumeMetrics } from "./spotTypes";
import { buildSpotRegimeContext } from "./spotRegimeEngine";
import { calculateATR, type PriceData, type OHLCCandle } from "../indicators";
import { type ClosedCandleContext, prepareCandles, buildClosedCandleContextFast } from "./closedCandleContract";
import { buildAdaptiveMarketState } from "./spotAdaptiveMarketState";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ReplayCandleSet {
  pair: string;
  candles5m: SpotCandle[];
  candles15m: SpotCandle[];
  candles1h: SpotCandle[];
  candles4h: SpotCandle[];
}

export interface ReplayConfig {
  pair: string;
  availableCapitalUsd: number;
  strategyConfig?: SpotCanonicalConfig;
  riskConfig?: SpotRiskConfig;
  exitConfig?: SpotExitConfig;
  antiLateEntryConfig?: AntiLateEntryConfig;
  /** Max concurrent positions (default 2) */
  maxConcurrentPositions?: number;
  /** Explicit fee model for historical replay (defaults to canonical) */
  feeModel?: FeeModel;
  /** V3 entry quality config (default OFF) */
  entryV3Config?: EntryV3Config;
  /** Instrumentation log for V3 research */
  v3Instrumentation?: V3InstrumentationLog;
  /** Evaluation boundary: no new entries before this time (candles still used for warmup/indicators) */
  evaluationStartMs?: number;
  /** Evaluation boundary: no new entries after this time */
  evaluationEndMs?: number;
}

export interface ReplayTrade {
  lotId: string;
  pair: string;
  signalId: string;
  setupTag: SetupTag;
  regimeAtEntry: string;
  directionAtEntry: string;
  entryPrice: number;
  exitPrice: number;
  volume: number;
  entryFeeUsd: number;
  exitFeeUsd: number;
  grossPnlUsd: number;
  netPnlUsd: number;
  rMultiple: number;
  exitReason: ExitReasonType;
  openedAtMs: number;
  closedAtMs: number;
  holdTimeMinutes: number;
  mfeUsd: number;
  maeUsd: number;
  mfeR: number;
  profitCapturePct: number | null;
  profitCaptureClass: string;
  executionMode: ExecutionMode;
  policyVersion: string;
}

export interface V3InstrumentationEntry {
  pair: string;
  timestamp: number;
  regime: string;
  direction: string;
  adx: number;
  atrPct: number;
  impulseAtr: number;
  retracementAtr: number;
  reclaimConfirmed: boolean;
  resumptionConfirmed: boolean;
  distanceFromOriginAtr: number;
  accepted: boolean;
  reasonCode: string;
}

export class V3InstrumentationLog {
  entries: V3InstrumentationEntry[] = [];
  add(e: V3InstrumentationEntry): void { this.entries.push(e); }
}

export interface ReplayResult {
  pair: string;
  trades: ReplayTrade[];
  stats: ReplayStats;
  config: ReplayConfig;
  v3Instrumentation?: V3InstrumentationEntry[];
}

export interface ReplayStats {
  totalTrades: number;
  signalsBuy: number;
  intentExecutable: number;
  entriesExecuted: number;
  closedTrades: number;
  openTerminalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  netPnlUsd: number;
  grossPnlUsd: number;
  totalFeesUsd: number;
  avgNetPnlUsd: number;
  avgRMultiple: number;
  profitFactor: number;
  grossProfitFactor: number;
  maxDrawdownUsd: number;
  maxDrawdownPct: number;
  avgHoldTimeMinutes: number;
  avgMfeUsd: number;
  avgMaeUsd: number;
  avgMfeR: number;
  bestTradeUsd: number;
  worstTradeUsd: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  excellentCount: number;
  goodCount: number;
  poorCount: number;
  badCount: number;
  regimeBreakdown: Record<string, { count: number; netPnlUsd: number; wins: number; losses: number }>;
}

// ─── Replay Engine ──────────────────────────────────────────────────────────

/**
 * Run a deterministic replay of SPOT_CANONICAL over historical candles.
 *
 * The replay iterates through 15m candles (the signal timeframe).
 * For each 15m candle close:
 *   1. Build a SpotMarketContext from available candles up to that point
 *   2. If no position: evaluate entry signal
 *   3. If position: evaluate exit conditions
 *   4. Fill at next candle open (no lookahead)
 *
 * @returns ReplayResult with all trades and aggregate stats.
 */
export function runReplay(
  candles: ReplayCandleSet,
  config: ReplayConfig,
): ReplayResult {
  const pair = config.pair;
  const maxConcurrent = config.maxConcurrentPositions ?? 2;
  const feeModel = config.feeModel;
  const entryV3Config = config.entryV3Config ?? DEFAULT_ENTRY_V3_CONFIG;
  const v3Log = config.v3Instrumentation;

  const positions: SpotPosition[] = [];
  const exitStates: Map<string, SpotExitState> = new Map();
  const auditTracker = new SpotAuditTracker();
  const trades: ReplayTrade[] = [];
  let lotCounter = 0;
  let signalCounter = 0;
  let signalsBuyCount = 0;
  let intentExecutableCount = 0;
  let entriesExecutedCount = 0;

  // Pre-sort + pre-dedup ONCE (O(n log n) total, not per-iteration)
  const sorted5m = prepareCandles(candles.candles5m);
  const sorted15m = prepareCandles(candles.candles15m);
  const sorted1h = prepareCandles(candles.candles1h);
  const sorted4h = prepareCandles(candles.candles4h);

  // Iterate through 5m candles for finer scan granularity (closer to 60s production scan).
  // Warmup: need 200 15m candles (= 600 5m candles) before generating signals.
  const warmup5m = 600;

  // Track last in-window candle for RESEARCH_WINDOW_END boundary
  let lastInWindowClose = 0;
  let lastInWindowTime = 0;
  let boundaryClosed = false;

  for (let i = warmup5m; i < sorted5m.length; i++) {
    const current5m = sorted5m[i];
    // CRITICAL: evaluation happens at the CLOSE time of the 5m candle, not its open time.
    // At open time, the close is unknown — using it would be lookahead bias.
    const evaluationTime = getCandleCloseTimeMs(current5m.time, "5m");
    if (evaluationTime === null) continue;

    // ── Strict evaluationEndMs boundary ──
    // When we pass the boundary, close all remaining positions at the last in-window
    // candle's close with RESEARCH_WINDOW_END and break. No future data leakage.
    if (config.evaluationEndMs !== undefined && evaluationTime > config.evaluationEndMs) {
      if (positions.length > 0 && lastInWindowClose > 0 && !boundaryClosed) {
        for (const pos of positions) {
          const exitPrice = lastInWindowClose;
          const feeBreakdown = computeFeeBreakdown(pos.entryPrice, exitPrice, pos.qtyRemaining, feeModel);
          const pnl = computePnlBreakdown({
            entryPrice: pos.entryPrice, exitPrice, volume: pos.qtyRemaining,
            entryFeeUsd: pos.entryFee, feeModel,
          });
          const audit = auditTracker.finalizeExit(pos, exitPrice, ExitReasonType.RESEARCH_WINDOW_END, lastInWindowTime);
          const posMetrics = auditTracker.getMetrics(pos.lotId);
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
            openedAtMs: pos.openedAt, closedAtMs: lastInWindowTime,
            holdTimeMinutes: Math.round((lastInWindowTime - pos.openedAt) / 60000),
            mfeUsd: posMetrics?.mfeUsd ?? 0, maeUsd: posMetrics?.maeUsd ?? 0,
            mfeR: posMetrics?.mfeR ?? 0,
            profitCapturePct: audit.profitCapturePct,
            profitCaptureClass: classifyProfitCapture(audit.profitCapturePct),
            executionMode: ExecutionMode.SHADOW, policyVersion: SPOT_POLICY_VERSION,
          });
        }
        boundaryClosed = true;
      }
      break;
    }

    lastInWindowClose = current5m.close;
    lastInWindowTime = evaluationTime;

    const nextCandle = sorted5m[i + 1];

    // C1F2-10: No entry without next candle fill — last candle cannot open position
    // If there is no next candle, we cannot fill at next open. No new entry.
    // Fill at NEXT candle OPEN (after signal confirmed at close). No lookahead.
    const fillPrice = nextCandle ? nextCandle.open : null;

    // C1F4-18: Exact next-candle contiguity required.
    // For a signal at current5m close, the expected next open is:
    //   expectedNextOpen = current5m.time + 5*60*1000
    // A new entry only has next-open fill if nextCandle != null AND nextCandle.time === expectedNextOpen.
    const expectedNextOpen = current5m.time + 5 * 60 * 1000;
    const hasNextCandle = nextCandle != null && nextCandle.time === expectedNextOpen;
    // C1F4-19: Gap detection for entries only — exits must still be evaluated.
    const hasDataGap = !hasNextCandle;

    // Build market context from candles closed at evaluationTime (fast path)
    const ctx = buildReplayContextFast(
      pair,
      sorted5m,
      sorted15m,
      sorted1h,
      sorted4h,
      evaluationTime,
      current5m.close,
    );

    if (!ctx) continue;

    // ─── Exit evaluation for open positions ────────────────────────────────
    for (let p = positions.length - 1; p >= 0; p--) {
      const pos = positions[p];
      let state = exitStates.get(pos.lotId);
      if (!state) continue;

      // Update MFE/MAE
      auditTracker.updatePrice(pos, ctx.ticker.last, evaluationTime);

      const exitDecision = evaluateExit(pos, state, ctx, config.exitConfig ?? DEFAULT_SPOT_EXIT_CONFIG, evaluationTime);
      if (exitDecision.shouldExit) {
        // C1F5F-1: Exit fill must NOT use distant next candle open.
        // Only use nextCandle.open if contiguous; otherwise use current5m.close as EXIT_AT_DECISION_CLOSE_DEGRADED.
        const exitFillPrice = hasNextCandle ? nextCandle!.open : current5m.close;
        const feeBreakdown = computeFeeBreakdown(pos.entryPrice, exitFillPrice, pos.qtyRemaining, feeModel);
        const pnl = computePnlBreakdown({
          entryPrice: pos.entryPrice,
          exitPrice: exitFillPrice,
          volume: pos.qtyRemaining,
          entryFeeUsd: pos.entryFee,
          feeModel,
        });

        const audit = auditTracker.finalizeExit(pos, exitFillPrice, exitDecision.reasonType ?? "TIME_EFFICIENCY", evaluationTime);
        const posMetrics = auditTracker.getMetrics(pos.lotId);
        const rMultiple = pos.initialStopDistanceUsd > 0
          ? (exitFillPrice - pos.entryPrice) / pos.initialStopDistanceUsd
          : 0;

        const trade: ReplayTrade = {
          lotId: pos.lotId,
          pair: pos.pair,
          signalId: pos.signalId,
          setupTag: pos.setupTag,
          regimeAtEntry: pos.regimeAtEntry ?? "UNKNOWN",
          directionAtEntry: pos.directionAtEntry ?? "NEUTRAL",
          entryPrice: pos.entryPrice,
          exitPrice: exitFillPrice,
          volume: pos.qtyRemaining,
          entryFeeUsd: feeBreakdown.entryFeeUsd,
          exitFeeUsd: feeBreakdown.exitFeeUsd,
          grossPnlUsd: pnl.grossPnlUsd,
          netPnlUsd: pnl.netPnlUsd,
          rMultiple,
          exitReason: exitDecision.reasonType ?? ExitReasonType.TIME_EFFICIENCY,
          openedAtMs: pos.openedAt,
          closedAtMs: evaluationTime,
          holdTimeMinutes: Math.round((evaluationTime - pos.openedAt) / 60000),
          mfeUsd: posMetrics?.mfeUsd ?? 0,
          maeUsd: posMetrics?.maeUsd ?? 0,
          mfeR: posMetrics?.mfeR ?? 0,
          profitCapturePct: audit.profitCapturePct,
          profitCaptureClass: classifyProfitCapture(audit.profitCapturePct),
          executionMode: ExecutionMode.SHADOW,
          policyVersion: SPOT_POLICY_VERSION,
        };
        trades.push(trade);
        positions.splice(p, 1);
        exitStates.delete(pos.lotId);
      }
    }

    // ─── Entry evaluation (if slots available) ─────────────────────────────
    if (positions.length >= maxConcurrent) continue;

    // Evaluation boundary: skip new entries outside [evaluationStartMs, evaluationEndMs]
    // Candles before evaluationStartMs are still processed for exit evaluation and indicator warmup
    if (config.evaluationStartMs !== undefined && evaluationTime < config.evaluationStartMs) continue;
    if (config.evaluationEndMs !== undefined && evaluationTime > config.evaluationEndMs) continue;

    // C1F4-19: Gap blocks entry but NOT exit evaluation.
    // Exit evaluation for open positions continues regardless of gap.
    // Only entry is blocked when there is no contiguous next candle.
    if (hasDataGap) continue;

    // C1F2-10: No entry without next candle fill — cannot open on last candle
    if (fillPrice === null) continue;
    const entryFillPrice = fillPrice;

    // Signal evaluation at candle CLOSE — no lookahead

    const signal = evaluateSpotCanonical(ctx, config.strategyConfig);
    if (signal.signal !== "BUY") continue;

    signalCounter++;
    signalsBuyCount++;
    const signalId = `replay-${pair}-${signalCounter}`;
    const intent = createEntryIntent(signal, ctx, config.antiLateEntryConfig);

    // ── V3 entry quality gate (when enabled) ──
    if (entryV3Config.enabled) {
      const v3Eval = evaluateEntryV3(
        ctx,
        intent.originPrice,
        intent.origin15mCloseAt,
        entryV3Config,
        evaluationTime,
      );

      // Instrumentation
      if (v3Log) {
        v3Log.add({
          pair,
          timestamp: evaluationTime,
          regime: ctx.regimeContext.regime,
          direction: ctx.regimeContext.direction,
          adx: ctx.regimeContext.adx,
          atrPct: ctx.regimeContext.atrPct,
          impulseAtr: v3Eval.impulseAtr,
          retracementAtr: v3Eval.retracementAtr,
          reclaimConfirmed: v3Eval.reclaimConfirmed,
          resumptionConfirmed: v3Eval.resumptionConfirmed,
          distanceFromOriginAtr: v3Eval.distanceFromOriginAtr,
          accepted: v3Eval.accepted,
          reasonCode: v3Eval.reasonCode,
        });
      }

      if (!v3Eval.accepted) continue;

      // V3 anti-late entry: no re-anchor, expire or execute
      const v3AntiLate = evaluateV3AntiLateEntry(
        ctx.ticker.last,
        intent.originPrice,
        intent.originAtrPct,
        intent.expiresAt,
        evaluationTime,
        entryV3Config,
      );
      if (v3AntiLate.action !== "EXECUTE") continue;
    } else {
      // B0 path: standard intent evaluation
      const intentEval = evaluateEntryIntent(intent, ctx, config.antiLateEntryConfig);
      if (!intentEval.shouldExecute) continue;
    }

    intentExecutableCount++;

    // Sizing — use productive evaluateSizing() (applies maxLots, maxOrder, spread gate, fee gate, capital efficiency)
    // Override ticker.last to the actual fill price so sizing matches the entry price
    const openLotsForPair = positions.filter(p => p.pair === pair).length;
    const riskConfig = config.riskConfig ?? DEFAULT_SPOT_RISK_CONFIG;
    const sizingCtx = { ...ctx, ticker: { ...ctx.ticker, last: entryFillPrice } };
    const sizing = evaluateSizing(
      sizingCtx,
      intent,
      config.availableCapitalUsd,
      openLotsForPair,
      riskConfig,
      feeModel,
    );

    if (!sizing.approved) continue;

    entriesExecutedCount++;
    lotCounter++;
    const lotId = `replay-${pair}-${lotCounter}`;
    const entryFee = sizing.entryFeeUsd;

    const position: SpotPosition = {
      lotId,
      pair,
      amount: sizing.volume,
      qtyRemaining: sizing.volume,
      entryPrice: entryFillPrice,
      entryFee,
      entryFeeQuality: "ESTIMATED" as FeeQuality,
      highestPrice: entryFillPrice,
      openedAt: evaluationTime,
      entryStrategyId: "SPOT_CANONICAL",
      entrySignalTf: "15m",
      signalConfidence: signal.confidence,
      signalReason: signal.reason,
      setupTag: signal.setupTag ?? SetupTag.PULLBACK_CONTINUATION,
      signalId,
      marketContextId: ctx.marketContextId,
      regimeAtEntry: ctx.regimeContext.regime,
      directionAtEntry: ctx.regimeContext.direction,
      macroAtEntry: ctx.regimeContext.macroBias,
      atrPctAtEntry: ctx.regimeContext.atrPct,
      initialStopPrice: sizing.stopPrice,
      initialStopDistancePct: sizing.stopDistancePct,
      initialStopDistanceUsd: sizing.stopDistanceUsd,
      riskUsd: sizing.riskUsd,
      notionalUsd: sizing.notionalUsd,
      executionMode: ExecutionMode.SHADOW,
      policyVersion: SPOT_POLICY_VERSION,
      sgBreakEvenActivated: false,
      sgTrailingActivated: false,
      sgScaleOutDone: false,
      sgCurrentStopPrice: sizing.stopPrice,
      mfe: 0,
      mae: 0,
      mfeR: 0,
      maeR: 0,
    };

    positions.push(position);
    exitStates.set(lotId, createExitState(position));
    auditTracker.initPosition(position);
  }

  // Close any remaining positions at last available price (only if not already closed by boundary)
  if (boundaryClosed) {
    positions.length = 0;
  }
  const lastCandle = sorted5m[sorted5m.length - 1];
  // C1F2-9: Terminal close timestamp must be candle CLOSE time, not OPEN time
  const terminalExitTime = getCandleCloseTimeMs(lastCandle.time, "5m") ?? lastCandle.time;
  for (const pos of positions) {
    const exitPrice = lastCandle.close;
    const feeBreakdown = computeFeeBreakdown(pos.entryPrice, exitPrice, pos.qtyRemaining, feeModel);
    const pnl = computePnlBreakdown({
      entryPrice: pos.entryPrice,
      exitPrice,
      volume: pos.qtyRemaining,
      entryFeeUsd: pos.entryFee,
      feeModel,
    });
    const audit = auditTracker.finalizeExit(pos, exitPrice, "TIME_EFFICIENCY", terminalExitTime);
    const posMetrics = auditTracker.getMetrics(pos.lotId);
    const rMultiple = pos.initialStopDistanceUsd > 0
      ? (exitPrice - pos.entryPrice) / pos.initialStopDistanceUsd
      : 0;

    trades.push({
      lotId: pos.lotId,
      pair: pos.pair,
      signalId: pos.signalId,
      setupTag: pos.setupTag,
      regimeAtEntry: pos.regimeAtEntry ?? "UNKNOWN",
      directionAtEntry: pos.directionAtEntry ?? "NEUTRAL",
      entryPrice: pos.entryPrice,
      exitPrice,
      volume: pos.qtyRemaining,
      entryFeeUsd: feeBreakdown.entryFeeUsd,
      exitFeeUsd: feeBreakdown.exitFeeUsd,
      grossPnlUsd: pnl.grossPnlUsd,
      netPnlUsd: pnl.netPnlUsd,
      rMultiple,
      exitReason: ExitReasonType.TIME_EFFICIENCY,
      openedAtMs: pos.openedAt,
      closedAtMs: terminalExitTime,
      holdTimeMinutes: Math.round((terminalExitTime - pos.openedAt) / 60000),
      mfeUsd: posMetrics?.mfeUsd ?? 0,
      maeUsd: posMetrics?.maeUsd ?? 0,
      mfeR: posMetrics?.mfeR ?? 0,
      profitCapturePct: audit.profitCapturePct,
      profitCaptureClass: classifyProfitCapture(audit.profitCapturePct),
      executionMode: ExecutionMode.SHADOW,
      policyVersion: SPOT_POLICY_VERSION,
    });
  }

  const stats = computeReplayStats(trades, {
    signalsBuy: signalsBuyCount,
    intentExecutable: intentExecutableCount,
    entriesExecuted: entriesExecutedCount,
    openTerminalTrades: positions.length,
    initialCapital: config.availableCapitalUsd,
  });
  return { pair, trades, stats, config, v3Instrumentation: v3Log?.entries };
}

// ─── Stats ──────────────────────────────────────────────────────────────────

export function computeReplayStats(
  trades: ReplayTrade[],
  extra?: { signalsBuy?: number; intentExecutable?: number; entriesExecuted?: number; openTerminalTrades?: number; initialCapital?: number },
): ReplayStats {
  const n = trades.length;
  const signalsBuy = extra?.signalsBuy ?? 0;
  const intentExecutable = extra?.intentExecutable ?? 0;
  const entriesExecuted = extra?.entriesExecuted ?? n;
  const openTerminalTrades = extra?.openTerminalTrades ?? 0;
  const initialCapital = extra?.initialCapital ?? 10000;
  const closedTrades = n;

  if (n === 0) {
    return {
      totalTrades: 0, signalsBuy, intentExecutable, entriesExecuted, closedTrades: 0, openTerminalTrades,
      wins: 0, losses: 0, winRate: 0,
      netPnlUsd: 0, grossPnlUsd: 0, totalFeesUsd: 0,
      avgNetPnlUsd: 0, avgRMultiple: 0, profitFactor: 0, grossProfitFactor: 0,
      maxDrawdownUsd: 0, maxDrawdownPct: 0,
      avgHoldTimeMinutes: 0, avgMfeUsd: 0, avgMaeUsd: 0, avgMfeR: 0,
      bestTradeUsd: 0, worstTradeUsd: 0,
      maxConsecutiveWins: 0, maxConsecutiveLosses: 0,
      excellentCount: 0, goodCount: 0, poorCount: 0, badCount: 0,
      regimeBreakdown: {},
    };
  }

  const wins = trades.filter(t => t.netPnlUsd > 0);
  const losses = trades.filter(t => t.netPnlUsd <= 0);
  const netWin = wins.reduce((s, t) => s + t.netPnlUsd, 0);
  const netLoss = Math.abs(losses.reduce((s, t) => s + t.netPnlUsd, 0));
  const grossWin = wins.reduce((s, t) => s + t.grossPnlUsd, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.grossPnlUsd, 0));

  let maxConWins = 0, maxConLosses = 0, curWins = 0, curLosses = 0;
  for (const t of trades) {
    if (t.netPnlUsd > 0) { curWins++; curLosses = 0; maxConWins = Math.max(maxConWins, curWins); }
    else { curLosses++; curWins = 0; maxConLosses = Math.max(maxConLosses, curLosses); }
  }

  // Max drawdown: equity starts at initialCapital, peakEquity starts at initialCapital
  let equity = initialCapital;
  let peakEquity = initialCapital;
  let maxDD = 0;
  let maxDDPct = 0;
  for (const t of trades) {
    equity += t.netPnlUsd;
    peakEquity = Math.max(peakEquity, equity);
    const dd = peakEquity - equity;
    const ddPct = peakEquity > 0 ? dd / peakEquity : 0;
    if (dd > maxDD) { maxDD = dd; maxDDPct = ddPct; }
  }

  // Regime breakdown
  const regimeBreakdown: Record<string, { count: number; netPnlUsd: number; wins: number; losses: number }> = {};
  for (const t of trades) {
    const regime = t.regimeAtEntry ?? "UNKNOWN";
    if (!regimeBreakdown[regime]) regimeBreakdown[regime] = { count: 0, netPnlUsd: 0, wins: 0, losses: 0 };
    regimeBreakdown[regime].count++;
    regimeBreakdown[regime].netPnlUsd += t.netPnlUsd;
    if (t.netPnlUsd > 0) regimeBreakdown[regime].wins++;
    else regimeBreakdown[regime].losses++;
  }

  return {
    totalTrades: n, signalsBuy, intentExecutable, entriesExecuted, closedTrades, openTerminalTrades,
    wins: wins.length, losses: losses.length, winRate: wins.length / n,
    netPnlUsd: trades.reduce((s, t) => s + t.netPnlUsd, 0),
    grossPnlUsd: trades.reduce((s, t) => s + t.grossPnlUsd, 0),
    totalFeesUsd: trades.reduce((s, t) => s + t.entryFeeUsd + t.exitFeeUsd, 0),
    avgNetPnlUsd: trades.reduce((s, t) => s + t.netPnlUsd, 0) / n,
    avgRMultiple: trades.reduce((s, t) => s + t.rMultiple, 0) / n,
    profitFactor: netLoss > 0 ? netWin / netLoss : netWin > 0 ? Infinity : 0,
    grossProfitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    maxDrawdownUsd: maxDD,
    maxDrawdownPct: maxDDPct,
    avgHoldTimeMinutes: trades.reduce((s, t) => s + t.holdTimeMinutes, 0) / n,
    avgMfeUsd: trades.reduce((s, t) => s + t.mfeUsd, 0) / n,
    avgMaeUsd: trades.reduce((s, t) => s + t.maeUsd, 0) / n,
    avgMfeR: trades.reduce((s, t) => s + t.mfeR, 0) / n,
    bestTradeUsd: Math.max(...trades.map(t => t.netPnlUsd)),
    worstTradeUsd: Math.min(...trades.map(t => t.netPnlUsd)),
    maxConsecutiveWins: maxConWins,
    maxConsecutiveLosses: maxConLosses,
    excellentCount: trades.filter(t => t.profitCaptureClass === "EXCELLENT").length,
    goodCount: trades.filter(t => t.profitCaptureClass === "GOOD").length,
    poorCount: trades.filter(t => t.profitCaptureClass === "POOR").length,
    badCount: trades.filter(t => t.profitCaptureClass === "BAD").length,
    regimeBreakdown,
  };
}

// ─── Context builder (from candles, no async) ───────────────────────────────

export function buildReplayContextFast(
  pair: string,
  candles5m: SpotCandle[],
  candles15m: SpotCandle[],
  candles1h: SpotCandle[],
  candles4h: SpotCandle[],
  evaluationTime: number,
  currentPrice: number,
): SpotMarketContext | null {
  // Use the canonical contract to split closed vs forming candles.
  // Fast path: inputs are pre-sorted + pre-deduped, uses binary search.
  const closed = buildClosedCandleContextFast(
    candles5m,
    candles15m,
    candles1h,
    candles4h,
    evaluationTime,
  );

  // Derive all candle arrays from the contract
  const c5m = closed.tf5m.closedCandles;
  const c15m = closed.tf15m.closedCandles;
  const c1h = closed.tf1h.closedCandles;
  const c4h = closed.tf4h.closedCandles;

  if (c15m.length < 200 || c1h.length < 50 || c4h.length < 50) return null;

  // ── Production regime context (real ADX, Bollinger, macro) ──
  const ohlc1h: OHLCCandle[] = c1h.map(c => ({
    time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
  }));
  const ohlc4h: OHLCCandle[] = c4h.map(c => ({
    time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
  }));

  const regimeContext = buildSpotRegimeContext({
    pair,
    candles1h: ohlc1h,
    candles4h: ohlc4h,
    dataHealth: DataHealth.GOOD,
  });

  // ── Production ATR from 1h candles (same as spotMarketContext.ts) ──
  const priceData1h: PriceData[] = c1h.map(c => ({
    price: c.close, timestamp: c.time, high: c.high, low: c.low, volume: c.volume,
  }));
  const atr = priceData1h.length >= 14 ? calculateATR(priceData1h, 14) : 0;

  // Ticker (no spread in replay)
  const ticker: SpotTicker = {
    bid: currentPrice,
    ask: currentPrice,
    last: currentPrice,
    spread: 0,
    fetchedAt: evaluationTime,
  };

  const recent15m = c15m.slice(-14);
  const volumeMetrics: SpotVolumeMetrics = {
    volumeRatio: 1.0,
    volume24h: recent15m.reduce((s, c) => s + c.volume, 0),
    participation: "NORMAL",
  };

  // Slice to last 200 for consumption (creates copies, preserves readonly)
  const candles5mCtx = c5m.slice(-200);
  const candles15mCtx = c15m.slice(-200);
  const candles1hCtx = c1h.slice(-200);
  const candles4hCtx = c4h.slice(-200);

  return {
    marketContextId: `replay-${pair}-${evaluationTime}`,
    generatedAt: evaluationTime,
    pair,
    dataHealth: DataHealth.GOOD,
    macroBias: regimeContext.macroBias,
    regimeContext,
    candles5m: candles5mCtx,
    candles15m: candles15mCtx,
    candles1h: candles1hCtx,
    candles4h: candles4hCtx,
    formingCandle5m: closed.tf5m.formingCandle,
    formingCandle15m: closed.tf15m.formingCandle,
    formingCandle1h: closed.tf1h.formingCandle,
    formingCandle4h: closed.tf4h.formingCandle,
    closedCandleContext: closed,
    adaptiveMarketState: buildAdaptiveMarketState({
      candles1h: candles1hCtx,
      candles15m: candles15mCtx,
      candles4h: candles4hCtx,
      regimeContext,
      spreadPct: 0,
      dataHealth: String(DataHealth.GOOD),
    }),
    ticker,
    spreadPct: 0,
    atr,
    volumeMetrics,
  };
}
