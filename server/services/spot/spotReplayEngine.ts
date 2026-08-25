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
import { computeStopDistance, computePositionSize, type SpotRiskConfig, DEFAULT_SPOT_RISK_CONFIG } from "./spotRiskManager";
import { computePnlBreakdown, computeFeeBreakdown, getSpotTakerFeePct, type FeeQuality } from "./feeModel";
import { evaluateExit, createExitState, type SpotExitConfig, DEFAULT_SPOT_EXIT_CONFIG } from "./spotExitPolicy";
import { SpotAuditTracker, classifyProfitCapture, type ExitAuditMetrics } from "./spotAuditTracker";
import { DataHealth } from "./candleTimestamp";
import { type SpotTicker, type SpotVolumeMetrics } from "./spotTypes";
import { buildSpotRegimeContext } from "./spotRegimeEngine";
import { calculateATR, type PriceData, type OHLCCandle } from "../indicators";

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
}

export interface ReplayTrade {
  lotId: string;
  pair: string;
  signalId: string;
  setupTag: SetupTag;
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

export interface ReplayResult {
  pair: string;
  trades: ReplayTrade[];
  stats: ReplayStats;
  config: ReplayConfig;
}

export interface ReplayStats {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  netPnlUsd: number;
  grossPnlUsd: number;
  totalFeesUsd: number;
  avgNetPnlUsd: number;
  avgRMultiple: number;
  profitFactor: number;
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
  const takerFeePct = getSpotTakerFeePct();

  const positions: SpotPosition[] = [];
  const exitStates: Map<string, SpotExitState> = new Map();
  const auditTracker = new SpotAuditTracker();
  const trades: ReplayTrade[] = [];
  let lotCounter = 0;
  let signalCounter = 0;

  // Sort candles by time
  const sorted15m = [...candles.candles15m].sort((a, b) => a.time - b.time);
  const sorted5m = [...candles.candles5m].sort((a, b) => a.time - b.time);
  const sorted1h = [...candles.candles1h].sort((a, b) => a.time - b.time);
  const sorted4h = [...candles.candles4h].sort((a, b) => a.time - b.time);

  // Iterate through 5m candles for finer scan granularity (closer to 60s production scan).
  // Warmup: need 200 15m candles (= 600 5m candles) before generating signals.
  const warmup5m = 600;
  for (let i = warmup5m; i < sorted5m.length; i++) {
    const current5m = sorted5m[i];
    const currentTime = current5m.time;
    const nextCandle = sorted5m[i + 1];
    const fillPrice = nextCandle ? nextCandle.open : current5m.close;

    // Build market context from candles up to current time
    const ctx = buildReplayContext(
      pair,
      sorted5m,
      sorted15m,
      sorted1h,
      sorted4h,
      currentTime,
      current5m.close,
    );

    if (!ctx) continue;

    // ─── Exit evaluation for open positions ────────────────────────────────
    for (let p = positions.length - 1; p >= 0; p--) {
      const pos = positions[p];
      let state = exitStates.get(pos.lotId);
      if (!state) continue;

      // Update MFE/MAE
      auditTracker.updatePrice(pos, ctx.ticker.last, currentTime);

      const exitDecision = evaluateExit(pos, state, ctx, config.exitConfig ?? DEFAULT_SPOT_EXIT_CONFIG, currentTime);
      if (exitDecision.shouldExit) {
        const exitFillPrice = fillPrice;
        const feeBreakdown = computeFeeBreakdown(pos.entryPrice, exitFillPrice, pos.qtyRemaining);
        const pnl = computePnlBreakdown({
          entryPrice: pos.entryPrice,
          exitPrice: exitFillPrice,
          volume: pos.qtyRemaining,
          entryFeeUsd: pos.entryFee,
        });

        const audit = auditTracker.finalizeExit(pos, exitFillPrice, exitDecision.reasonType ?? "TIME_EFFICIENCY", currentTime);
        const posMetrics = auditTracker.getMetrics(pos.lotId);
        const rMultiple = pos.initialStopDistanceUsd > 0
          ? (exitFillPrice - pos.entryPrice) / pos.initialStopDistanceUsd
          : 0;

        const trade: ReplayTrade = {
          lotId: pos.lotId,
          pair: pos.pair,
          signalId: pos.signalId,
          setupTag: pos.setupTag,
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
          closedAtMs: currentTime,
          holdTimeMinutes: Math.round((currentTime - pos.openedAt) / 60000),
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

    const signal = evaluateSpotCanonical(ctx, config.strategyConfig);
    if (signal.signal !== "BUY") continue;

    signalCounter++;
    const signalId = `replay-${pair}-${signalCounter}`;
    const intent = createEntryIntent(signal, ctx, config.antiLateEntryConfig);

    // Evaluate intent immediately (in replay, we fill at next candle)
    const intentEval = evaluateEntryIntent(intent, ctx, config.antiLateEntryConfig);
    if (!intentEval.shouldExecute) continue;

    // Sizing
    const stopDist = computeStopDistance(
      fillPrice,
      ctx.atr,
      ctx.regimeContext.regime,
      config.riskConfig ?? DEFAULT_SPOT_RISK_CONFIG,
    );
    const sizing = computePositionSize(
      fillPrice,
      stopDist.stopDistanceUsd,
      config.riskConfig?.riskPerTradeUsd ?? DEFAULT_SPOT_RISK_CONFIG.riskPerTradeUsd,
      config.riskConfig ?? DEFAULT_SPOT_RISK_CONFIG,
    );

    if (sizing.volume <= 0 || sizing.notionalUsd <= 0) continue;

    lotCounter++;
    const lotId = `replay-${pair}-${lotCounter}`;
    const entryFee = fillPrice * sizing.volume * (takerFeePct / 100);

    const position: SpotPosition = {
      lotId,
      pair,
      amount: sizing.volume,
      qtyRemaining: sizing.volume,
      entryPrice: fillPrice,
      entryFee,
      entryFeeQuality: "ESTIMATED" as FeeQuality,
      highestPrice: fillPrice,
      openedAt: currentTime,
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
      initialStopPrice: stopDist.stopPrice,
      initialStopDistancePct: stopDist.stopDistancePct,
      initialStopDistanceUsd: stopDist.stopDistanceUsd,
      riskUsd: config.riskConfig?.riskPerTradeUsd ?? DEFAULT_SPOT_RISK_CONFIG.riskPerTradeUsd,
      notionalUsd: sizing.notionalUsd,
      executionMode: ExecutionMode.SHADOW,
      policyVersion: SPOT_POLICY_VERSION,
      sgBreakEvenActivated: false,
      sgTrailingActivated: false,
      sgScaleOutDone: false,
      sgCurrentStopPrice: stopDist.stopPrice,
      mfe: 0,
      mae: 0,
      mfeR: 0,
      maeR: 0,
    };

    positions.push(position);
    exitStates.set(lotId, createExitState(position));
    auditTracker.initPosition(position);
  }

  // Close any remaining positions at last available price
  const lastCandle = sorted5m[sorted5m.length - 1];
  for (const pos of positions) {
    const exitPrice = lastCandle.close;
    const feeBreakdown = computeFeeBreakdown(pos.entryPrice, exitPrice, pos.qtyRemaining);
    const pnl = computePnlBreakdown({
      entryPrice: pos.entryPrice,
      exitPrice,
      volume: pos.qtyRemaining,
      entryFeeUsd: pos.entryFee,
    });
    const audit = auditTracker.finalizeExit(pos, exitPrice, "TIME_EFFICIENCY", lastCandle.time);
    const posMetrics = auditTracker.getMetrics(pos.lotId);
    const rMultiple = pos.initialStopDistanceUsd > 0
      ? (exitPrice - pos.entryPrice) / pos.initialStopDistanceUsd
      : 0;

    trades.push({
      lotId: pos.lotId,
      pair: pos.pair,
      signalId: pos.signalId,
      setupTag: pos.setupTag,
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
      closedAtMs: lastCandle.time,
      holdTimeMinutes: Math.round((lastCandle.time - pos.openedAt) / 60000),
      mfeUsd: posMetrics?.mfeUsd ?? 0,
      maeUsd: posMetrics?.maeUsd ?? 0,
      mfeR: posMetrics?.mfeR ?? 0,
      profitCapturePct: audit.profitCapturePct,
      profitCaptureClass: classifyProfitCapture(audit.profitCapturePct),
      executionMode: ExecutionMode.SHADOW,
      policyVersion: SPOT_POLICY_VERSION,
    });
  }

  const stats = computeReplayStats(trades);
  return { pair, trades, stats, config };
}

// ─── Stats ──────────────────────────────────────────────────────────────────

export function computeReplayStats(trades: ReplayTrade[]): ReplayStats {
  const n = trades.length;
  if (n === 0) {
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

  const wins = trades.filter(t => t.netPnlUsd > 0);
  const losses = trades.filter(t => t.netPnlUsd <= 0);
  const grossWin = wins.reduce((s, t) => s + t.netPnlUsd, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.netPnlUsd, 0));

  let maxConWins = 0, maxConLosses = 0, curWins = 0, curLosses = 0;
  for (const t of trades) {
    if (t.netPnlUsd > 0) { curWins++; curLosses = 0; maxConWins = Math.max(maxConWins, curWins); }
    else { curLosses++; curWins = 0; maxConLosses = Math.max(maxConLosses, curLosses); }
  }

  return {
    totalTrades: n,
    wins: wins.length,
    losses: losses.length,
    winRate: wins.length / n,
    netPnlUsd: trades.reduce((s, t) => s + t.netPnlUsd, 0),
    grossPnlUsd: trades.reduce((s, t) => s + t.grossPnlUsd, 0),
    totalFeesUsd: trades.reduce((s, t) => s + t.entryFeeUsd + t.exitFeeUsd, 0),
    avgNetPnlUsd: trades.reduce((s, t) => s + t.netPnlUsd, 0) / n,
    avgRMultiple: trades.reduce((s, t) => s + t.rMultiple, 0) / n,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
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
  };
}

// ─── Context builder (from candles, no async) ───────────────────────────────

function buildReplayContext(
  pair: string,
  candles5m: SpotCandle[],
  candles15m: SpotCandle[],
  candles1h: SpotCandle[],
  candles4h: SpotCandle[],
  currentTime: number,
  currentPrice: number,
): SpotMarketContext | null {
  // Filter candles up to current time (no lookahead)
  const c5m = candles5m.filter(c => c.time <= currentTime);
  const c15m = candles15m.filter(c => c.time <= currentTime);
  const c1h = candles1h.filter(c => c.time <= currentTime);
  const c4h = candles4h.filter(c => c.time <= currentTime);

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
    fetchedAt: currentTime,
  };

  const recent15m = c15m.slice(-14);
  const volumeMetrics: SpotVolumeMetrics = {
    volumeRatio: 1.0,
    volume24h: recent15m.reduce((s, c) => s + c.volume, 0),
    participation: "NORMAL",
  };

  return {
    marketContextId: `replay-${pair}-${currentTime}`,
    generatedAt: currentTime,
    pair,
    dataHealth: DataHealth.GOOD,
    macroBias: regimeContext.macroBias,
    regimeContext,
    candles5m: c5m.slice(-200),
    candles15m: c15m.slice(-200),
    candles1h: c1h.slice(-200),
    candles4h: c4h.slice(-200),
    ticker,
    spreadPct: 0,
    atr,
    volumeMetrics,
  };
}
