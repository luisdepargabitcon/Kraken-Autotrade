/**
 * spotForwardTwinBuilder — Pure functions to build ForwardTwinSnapshot objects
 * from runtime SpotMarketContext, SpotSignalResult, SpotEntryIntent, etc.
 *
 * These functions are called by spotEngine.ts at instrumentation points.
 * They are PURE (no side effects, no DB, no async) to guarantee zero
 * timing impact on the hot path.
 */

import { SPOT_FORWARD_TWIN_SCHEMA_VERSION } from "./spotForwardTwinTypes";
import { SPOT_POLICY_VERSION } from "./spotTypes";
import { SPOT_ENGINE_OWNER } from "./spotOwnership";
import type {
  SpotMarketContext,
  SpotEntryIntent,
  SpotPosition,
  SpotExitState,
  SpotExitDecision,
  SpotExecutionResult,
  SpotExecutionIntent,
} from "./spotTypes";
import type { SpotSignalResult } from "./spotCanonicalStrategy";
import type { SizingResult } from "./spotRiskManager";
import type { IntentEvaluationResult } from "./spotEntryIntent";
import type {
  ForwardTwinSnapshot,
  ForwardTwinTickerSnapshot,
  ForwardTwinCandleSnapshot,
  ForwardTwinCandleMeta,
  ForwardTwinCandleArray,
  ForwardTwinRegimeSnapshot,
  ForwardTwinVolumeSnapshot,
  ForwardTwinSignalSnapshot,
  ForwardTwinIntentSnapshot,
  ForwardTwinSizingSnapshot,
  ForwardTwinCapitalSnapshot,
  ForwardTwinPositionSnapshot,
  ForwardTwinExitDecisionSnapshot,
  ForwardTwinFillSnapshot,
} from "./spotForwardTwinTypes";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function candleArray(candles: { time: number; open: number; high: number; low: number; close: number; volume: number }[]): ForwardTwinCandleArray {
  if (candles.length === 0) return { meta: { count: 0, lastTime: 0, lastClose: 0 }, candles: [] };
  const last = candles[candles.length - 1];
  return {
    meta: { count: candles.length, lastTime: last.time, lastClose: last.close },
    candles: candles.map(c => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume })),
  };
}

// ─── SCAN Snapshot Builder ───────────────────────────────────────────────────

export interface ScanSnapshotInput {
  scanId: string;
  mode: string;
  ctx: SpotMarketContext;
  signal: SpotSignalResult;
  intent: SpotEntryIntent | null;
  intentEvaluation: IntentEvaluationResult | null;
  sizing: SizingResult | null;
  availableCapital: number;
  openLots: number;
  maxLotsPerPair: number;
  reservedCapital: number;
  realizedPnl: number;
  totalFees: number;
  pipelineStopStage?: string | null;
  pipelineStopReasonCode?: string | null;
}

export function buildScanSnapshot(input: ScanSnapshotInput): ForwardTwinSnapshot {
  const { ctx, signal, intent, intentEvaluation, sizing, scanId, mode } = input;

  const ticker: ForwardTwinTickerSnapshot = {
    bid: ctx.ticker.bid,
    ask: ctx.ticker.ask,
    last: ctx.ticker.last,
    spread: ctx.ticker.spread,
    spreadPct: ctx.spreadPct,
    fetchedAt: ctx.ticker.fetchedAt,
  };

  const candles: ForwardTwinCandleSnapshot = {
    candles5m: candleArray(ctx.candles5m),
    candles15m: candleArray(ctx.candles15m),
    candles1h: candleArray(ctx.candles1h),
    candles4h: candleArray(ctx.candles4h),
  };

  const regime: ForwardTwinRegimeSnapshot = {
    regime: String(ctx.regimeContext.regime),
    direction: String(ctx.regimeContext.direction),
    macroBias: String(ctx.regimeContext.macroBias),
    volatility: String(ctx.regimeContext.volatility),
    adx: ctx.regimeContext.adx,
    ema20: ctx.regimeContext.ema20,
    ema50: ctx.regimeContext.ema50,
    ema200: ctx.regimeContext.ema200,
    emaAlignment: ctx.regimeContext.emaAlignment,
    bollingerWidth: ctx.regimeContext.bollingerWidth,
    atrPct: ctx.regimeContext.atrPct,
    confidence: ctx.regimeContext.confidence,
    regimeId: ctx.regimeContext.regimeId,
    contextId: ctx.regimeContext.contextId,
  };

  const volume: ForwardTwinVolumeSnapshot = {
    volumeRatio: ctx.volumeMetrics.volumeRatio,
    volume24h: ctx.volumeMetrics.volume24h,
    participation: String(ctx.volumeMetrics.participation),
  };

  const signalSnap: ForwardTwinSignalSnapshot = {
    signal: signal.signal,
    setupTag: signal.setupTag ? String(signal.setupTag) : null,
    reason: signal.reason,
    confidence: signal.confidence,
    originPrice: signal.originPrice,
    origin15mCloseAt: signal.origin15mCloseAt,
    originAtrPct: signal.originAtrPct,
    originVolume: signal.originVolume,
    contextId: signal.contextId,
    blockReason: signal.blockReason,
  };

  let intentSnap: ForwardTwinIntentSnapshot | null = null;
  if (intent) {
    intentSnap = {
      signalId: intent.signalId,
      state: String(intent.state),
      setupTag: String(intent.setupTag),
      createdAt: intent.createdAt,
      expiresAt: intent.expiresAt,
      originPrice: intent.originPrice,
      originAtrPct: intent.originAtrPct,
      originRegime: String(intent.originRegime),
      originDirection: String(intent.originDirection),
      originMacro: String(intent.originMacro),
      retryCount: intent.retryCount,
      lastBlockReason: intent.lastBlockReason,
      lastEvaluatedAt: intent.lastEvaluatedAt,
      shouldExecute: intentEvaluation?.shouldExecute ?? false,
      evaluationReason: intentEvaluation?.reason ?? "",
    };
  }

  let sizingSnap: ForwardTwinSizingSnapshot | null = null;
  if (sizing) {
    sizingSnap = {
      approved: sizing.approved,
      reason: sizing.reason,
      volume: sizing.volume,
      notionalUsd: sizing.notionalUsd,
      stopPrice: sizing.stopPrice,
      stopDistanceUsd: sizing.stopDistanceUsd,
      stopDistancePct: sizing.stopDistancePct,
      riskUsd: sizing.riskUsd,
      entryFeeUsd: sizing.entryFeeUsd,
      roundTripFeeUsd: sizing.roundTripFeeUsd,
      blockReason: sizing.blockReason,
      blockCode: sizing.blockCode,
    };
  }

  const capital: ForwardTwinCapitalSnapshot = {
    availableCapital: input.availableCapital,
    openLots: input.openLots,
    maxLotsPerPair: input.maxLotsPerPair,
    reservedCapital: input.reservedCapital,
    realizedPnl: input.realizedPnl,
    totalFees: input.totalFees,
  };

  return {
    schemaVersion: SPOT_FORWARD_TWIN_SCHEMA_VERSION,
    snapshotType: "SCAN",
    scanId,
    timestamp: ctx.generatedAt,
    pair: ctx.pair,
    policyVersion: SPOT_POLICY_VERSION,
    executionMode: mode,
    engineOwner: SPOT_ENGINE_OWNER,
    ticker,
    candles,
    regime,
    volume,
    signal: signalSnap,
    intent: intentSnap,
    sizing: sizingSnap,
    capital,
    dataHealth: String(ctx.dataHealth),
    marketContextId: ctx.marketContextId,
    pipelineStopStage: input.pipelineStopStage ?? null,
    pipelineStopReasonCode: input.pipelineStopReasonCode ?? null,
  };
}

// ─── SUPERVISOR Snapshot Builder ─────────────────────────────────────────────

export interface SupervisorSnapshotInput {
  scanId: string;
  mode: string;
  ctx: SpotMarketContext;
  position: SpotPosition;
  exitState: SpotExitState;
  exitDecision: SpotExitDecision;
  auditMetrics: {
    mfeUsd: number;
    maeUsd: number;
    mfeR: number;
    maeR: number;
  };
}

export function buildSupervisorSnapshot(input: SupervisorSnapshotInput): ForwardTwinSnapshot {
  const { ctx, position, exitState, exitDecision, scanId, mode } = input;

  const positionSnap: ForwardTwinPositionSnapshot = {
    lotId: position.lotId,
    pair: position.pair,
    entryPrice: position.entryPrice,
    amount: position.amount,
    qtyRemaining: position.qtyRemaining,
    highestPrice: position.highestPrice,
    lowestPrice: position.entryPrice, // SpotPosition has no lowestPrice; entryPrice as baseline
    mfe: input.auditMetrics.mfeUsd,
    mae: input.auditMetrics.maeUsd,
    mfeR: input.auditMetrics.mfeR,
    maeR: input.auditMetrics.maeR,
    openedAt: position.openedAt,
    setupTag: String(position.setupTag),
    executionMode: String(position.executionMode),
    sgBreakEvenActivated: position.sgBreakEvenActivated,
    sgTrailingActivated: position.sgTrailingActivated,
    sgCurrentStopPrice: position.sgCurrentStopPrice,
    breakEvenStopPrice: exitState.breakEvenStopPrice,
    trailingStopPrice: exitState.trailingStopPrice,
    trailingHighestPrice: exitState.trailingHighestPrice,
  };

  const exitSnap: ForwardTwinExitDecisionSnapshot = {
    shouldExit: exitDecision.shouldExit,
    reasonType: exitDecision.reasonType ? String(exitDecision.reasonType) : null,
    reason: exitDecision.reason,
    price: exitDecision.price,
    priority: exitDecision.priority,
    evaluatedAt: exitDecision.evaluatedAt,
  };

  return {
    schemaVersion: SPOT_FORWARD_TWIN_SCHEMA_VERSION,
    snapshotType: "SUPERVISOR",
    scanId,
    timestamp: ctx.generatedAt,
    pair: ctx.pair,
    policyVersion: SPOT_POLICY_VERSION,
    executionMode: mode,
    engineOwner: SPOT_ENGINE_OWNER,
    position: positionSnap,
    exitDecision: exitSnap,
    ticker: {
      bid: ctx.ticker.bid,
      ask: ctx.ticker.ask,
      last: ctx.ticker.last,
      spread: ctx.ticker.spread,
      spreadPct: ctx.spreadPct,
      fetchedAt: ctx.ticker.fetchedAt,
    },
  };
}

// ─── FILL Snapshot Builder ───────────────────────────────────────────────────

export interface FillSnapshotInput {
  scanId: string;
  mode: string;
  pair: string;
  ctx: SpotMarketContext;
  execIntent: SpotExecutionIntent;
  result: SpotExecutionResult;
  slippagePct: number;
  /**
   * Optional lotId override. For BUY fills, the SpotPosition lotId is generated
   * AFTER the execution intent is submitted (execIntent.positionLotId is null at
   * capture time). Pass the materialized lotId here so the FILL snapshot carries
   * an unambiguous correlation key. For SELL fills, execIntent.positionLotId is
   * already set and this override is not needed.
   */
  lotId?: string | null;
}

export function buildFillSnapshot(input: FillSnapshotInput): ForwardTwinSnapshot {
  const { ctx, execIntent, result, scanId, mode, pair, slippagePct, lotId } = input;

  const fillSnap: ForwardTwinFillSnapshot = {
    side: execIntent.side,
    lotId: lotId ?? execIntent.positionLotId,
    fillPrice: result.fillPrice ?? 0,
    fillVolume: result.fillVolume ?? 0,
    notionalUsd: execIntent.notionalUsd,
    feeUsd: result.feeUsd ?? 0,
    slippageUsd: result.slippageUsd ?? 0,
    slippagePct,
    fillQuality: String(result.fillQuality),
    orderId: result.orderId ?? "",
    executedAt: result.executedAt,
    tickerBid: ctx.ticker.bid,
    tickerAsk: ctx.ticker.ask,
    tickerLast: ctx.ticker.last,
  };

  return {
    schemaVersion: SPOT_FORWARD_TWIN_SCHEMA_VERSION,
    snapshotType: "FILL",
    scanId,
    timestamp: result.executedAt,
    pair,
    policyVersion: SPOT_POLICY_VERSION,
    executionMode: mode,
    engineOwner: SPOT_ENGINE_OWNER,
    fill: fillSnap,
  };
}
