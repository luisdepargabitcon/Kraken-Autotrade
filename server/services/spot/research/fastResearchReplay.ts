/**
 * fastResearchReplay — Precompute + fast replay for WFO parameter search.
 *
 * Strategy:
 *   1. PRECOMPUTE (once per pair): Build lightweight frames with signal result,
 *      V3 raw features, fill prices. NO ctx stored (avoids OOM).
 *   2. FAST REPLAY (per combo): Iterate frames, rebuild ctx on-the-fly ONLY when
 *      needed (exit eval for open positions, sizing for accepted entries).
 *      Apply V3 thresholds numerically on precomputed features.
 *
 * Performance gain: avoid redundant evaluateSpotCanonical + evaluateEntryV3
 * per combo. ctx rebuild only when exits/sizing needed, not per frame.
 *
 * Equivalence: Produces identical trades to runReplay() for the same config.
 */

import {
  type SpotCandle,
  type SpotMarketContext,
  type SpotPosition,
  type SpotEntryIntent,
  type SpotExitState,
  ExecutionMode,
  SetupTag,
  ExitReasonType,
  SPOT_POLICY_VERSION,
} from "../spotTypes";
import {
  buildReplayContextFast,
  computeReplayStats,
  type ReplayCandleSet,
  type ReplayConfig,
  type ReplayTrade,
  type ReplayResult,
} from "../spotReplayEngine";
import { evaluateSpotCanonical, type SpotSignalResult, type SpotCanonicalConfig } from "../spotCanonicalStrategy";
import { createEntryIntent, evaluateEntryIntent, type AntiLateEntryConfig } from "../spotEntryIntent";
import {
  type EntryV3Config,
  DEFAULT_ENTRY_V3_CONFIG,
} from "../spotEntryV3";
import { computeV4QualityScores } from "./spotEntryV4Research";
import { evaluateSizing, DEFAULT_SPOT_RISK_CONFIG } from "../spotRiskManager";
import { type FeeQuality } from "../feeModel";
import { computePnlBreakdown, computeFeeBreakdown, type FeeModel } from "../feeModel";
import { evaluateExit, createExitState, DEFAULT_SPOT_EXIT_CONFIG } from "../spotExitPolicy";
import { SpotAuditTracker, classifyProfitCapture } from "../spotAuditTracker";
import { getCandleCloseTimeMs } from "../candleTimestamp";
import { prepareCandles } from "../closedCandleContract";
import { extractEntryV4Features, type V3RawFeatures } from "../spotEntryQualityFeatures";

// Re-export V3RawFeatures for backward compat (other research files import from here)
export type { V3RawFeatures } from "../spotEntryQualityFeatures";

// ─── Research V3 Stage Mask (research-only, does NOT modify production) ──────

export interface ResearchV3StageMask {
  impulse: boolean;
  retracement: boolean;
  structure: boolean;
  reclaim: boolean;
  resumption: boolean;
}

export const ALL_STAGES_MASK: ResearchV3StageMask = {
  impulse: true, retracement: true, structure: true, reclaim: true, resumption: true,
};

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Lightweight precomputed frame — no ctx stored.
 */
export interface ReplayFrame {
  index: number;
  evaluationTime: number;
  currentPrice: number;
  fillPrice: number | null;
  hasNextCandle: boolean;
  signal: SpotSignalResult;
  isBuy: boolean;
  v3Features: V3RawFeatures | null;
  intent: SpotEntryIntent | null;
}

/**
 * Raw V3 features — combo-independent.
 * Threshold checks happen in checkV3Acceptance() per combo.
 */
// V3RawFeatures is now imported from spotEntryQualityFeatures (shared module)

/**
 * Precomputed data per pair: lightweight frames + sorted candles for ctx rebuild.
 */
export interface PrecomputedData {
  frames: ReplayFrame[];
  sorted5m: SpotCandle[];
  sorted15m: SpotCandle[];
  sorted1h: SpotCandle[];
  sorted4h: SpotCandle[];
  terminalClosePrice: number;
  terminalCloseTime: number;
}

// ─── Precompute ─────────────────────────────────────────────────────────────

export function precomputeFrames(
  pair: string,
  candles: ReplayCandleSet,
  entryV3Config: EntryV3Config = DEFAULT_ENTRY_V3_CONFIG,
  antiLateEntryConfig?: AntiLateEntryConfig,
  strategyConfig?: SpotCanonicalConfig,
): PrecomputedData {
  const sorted5m = prepareCandles(candles.candles5m);
  const sorted15m = prepareCandles(candles.candles15m);
  const sorted1h = prepareCandles(candles.candles1h);
  const sorted4h = prepareCandles(candles.candles4h);

  const warmup5m = 600;
  const frames: ReplayFrame[] = [];
  let signalCounter = 0;

  const last5m = sorted5m[sorted5m.length - 1];
  const terminalClosePrice = last5m?.close ?? 0;
  const terminalCloseTime = getCandleCloseTimeMs(last5m?.time ?? 0, "5m") ?? last5m?.time ?? 0;

  for (let i = warmup5m; i < sorted5m.length; i++) {
    const current5m = sorted5m[i];
    const evaluationTime = getCandleCloseTimeMs(current5m.time, "5m");
    if (evaluationTime === null) continue;

    const nextCandle = sorted5m[i + 1];
    const fillPrice = nextCandle ? nextCandle.open : null;
    const expectedNextOpen = current5m.time + 5 * 60 * 1000;
    const hasNextCandle = nextCandle != null && nextCandle.time === expectedNextOpen;

    // Build ctx for signal evaluation (needed only during precompute)
    const ctx = buildReplayContextFast(
      pair, sorted5m, sorted15m, sorted1h, sorted4h, evaluationTime, current5m.close,
    );
    if (!ctx) continue;

    const signal = evaluateSpotCanonical(ctx, strategyConfig);
    const isBuy = signal.signal === "BUY";

    let v3Features: V3RawFeatures | null = null;
    let intent: SpotEntryIntent | null = null;

    if (isBuy) {
      signalCounter++;
      intent = createEntryIntent(signal, ctx, antiLateEntryConfig, evaluationTime);
      intent = { ...intent, signalId: `replay-${pair}-${signalCounter}` };

      if (entryV3Config.enabled) {
        v3Features = extractEntryV4Features(ctx, intent);
      }
    }

    frames.push({
      index: i, evaluationTime, currentPrice: current5m.close,
      fillPrice, hasNextCandle, signal, isBuy, v3Features, intent,
    });
  }

  return { frames, sorted5m, sorted15m, sorted1h, sorted4h, terminalClosePrice, terminalCloseTime };
}

// extractV3Features moved to spotEntryQualityFeatures.ts (shared module)

// computeAtr15m moved to spotEntryQualityFeatures.ts (shared module)

// ─── V3 threshold check (fast, per-combo) ───────────────────────────────────

export interface RawStageAttribution {
  rawPassImpulse: boolean;
  rawPassRetracement: boolean;
  rawPassStructure: boolean;
  rawPassReclaim: boolean;
  rawPassResumption: boolean;
  passAntiLateDistance: boolean;
  passAntiLateExpiry: boolean;
  passAntiLateTotal: boolean;
  accepted: boolean;
}

function checkV3Acceptance(
  f: V3RawFeatures,
  config: EntryV3Config,
  currentPrice: number,
  nowMs: number,
  mask: ResearchV3StageMask = ALL_STAGES_MASK,
): { accepted: boolean; attribution: RawStageAttribution } {
  // Raw stage booleans — INDEPENDENT of mask, INDEPENDENT of anti-late
  const rawPassImpulse = f.impulseAtr >= config.impulseMinAtr;
  const rawPassRetracement = f.retracementAtr >= config.retracementMinAtr && f.retracementAtr <= config.retracementMaxAtr;
  const structureThreshold = f.ema20 - config.structureMinEmaDistanceAtr * f.atr;
  const rawPassStructure = f.retracementLow >= structureThreshold;
  const rawPassReclaim = f.reclaimIsBullish && f.reclaimBodyPct >= config.reclaimMinBodyPct && (!config.reclaimMustCloseAboveEma || f.reclaimCandleClose >= f.ema20) && f.reclaimAfterOrigin;
  const rawPassResumption = f.resumptionExists && f.resumptionIsBullish && f.resumptionBodyPct >= config.resumptionMinBodyPct && f.resumptionUpperWickRatio <= config.resumptionMaxUpperWickRatio && f.resumptionVolRatio5m >= config.resumptionMinVolumeRatio;

  // Anti-late checks — SEPARATE from stages, direct computation
  const passAntiLateDistance = f.distanceFromOriginAtr <= config.maxEntryDistanceAtr;
  const passAntiLateExpiry = nowMs <= f.expiresAt;
  const passAntiLateTotal = passAntiLateDistance && passAntiLateExpiry;

  // Mask determines which stages are REQUIRED for acceptance
  const maskPassImpulse = !mask.impulse || rawPassImpulse;
  const maskPassRetracement = !mask.retracement || rawPassRetracement;
  const maskPassStructure = !mask.structure || rawPassStructure;
  const maskPassReclaim = !mask.reclaim || rawPassReclaim;
  const maskPassResumption = !mask.resumption || rawPassResumption;

  const accepted = maskPassImpulse && maskPassRetracement && maskPassStructure && maskPassReclaim && maskPassResumption && passAntiLateTotal;

  return {
    accepted,
    attribution: {
      rawPassImpulse, rawPassRetracement, rawPassStructure, rawPassReclaim, rawPassResumption,
      passAntiLateDistance, passAntiLateExpiry, passAntiLateTotal,
      accepted,
    },
  };
}

// ─── Fast replay ───────────────────────────────────────────────────────────

export function fastReplay(
  precomputed: PrecomputedData,
  config: ReplayConfig,
  stageMask: ResearchV3StageMask = ALL_STAGES_MASK,
): ReplayResult {
  const { frames, sorted5m, sorted15m, sorted1h, sorted4h, terminalClosePrice, terminalCloseTime } = precomputed;
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
  let signalsBuyCount = 0;
  let intentExecutableCount = 0;
  let entriesExecutedCount = 0;

  // Stage attribution tracking (raw, independent of mask)
  let totalCandidates = 0;
  let rawPassImpulseCount = 0;
  let rawPassRetracementCount = 0;
  let rawPassStructureCount = 0;
  let rawPassReclaimCount = 0;
  let rawPassResumptionCount = 0;
  let failOnlyImpulse = 0;
  let failOnlyRetracement = 0;
  let failOnlyStructure = 0;
  let failOnlyReclaim = 0;
  let failOnlyResumption = 0;
  let failMultipleStages = 0;
  let antiLateDistanceFails = 0;
  let antiLateExpiryFails = 0;

  // V4 quality score tracking per lotId
  const v4ScoreMap = new Map<string, number>();
  let b0EligibleCandidates = 0;
  let v4AcceptedCandidates = 0;
  let b0SignalCandidates = 0;
  let b0IntentEligible = 0;
  let b0SizingApproved = 0;
  let v4ScoreEligible = 0;
  let v4FinalExecuted = 0;
  let v4AcceptsB0Rejected = 0;

  let lastInWindowClose = 0;
  let lastInWindowTime = 0;
  let boundaryClosed = false;

  for (const frame of frames) {
    const { evaluationTime, currentPrice, fillPrice, hasNextCandle } = frame;

    // ── Strict evaluationEndMs boundary ──
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
            v4QualityScore: v4ScoreMap.get(pos.lotId) ?? -1,
          });
        }
        boundaryClosed = true;
      }
      break;
    }

    lastInWindowClose = currentPrice;
    lastInWindowTime = evaluationTime;

    // ── Exit evaluation (only if open positions) ──
    if (positions.length > 0) {
      // Rebuild ctx for exit evaluation
      const ctx = buildReplayContextFast(
        pair, sorted5m, sorted15m, sorted1h, sorted4h, evaluationTime, currentPrice,
      );
      if (!ctx) continue;

      for (let p = positions.length - 1; p >= 0; p--) {
        const pos = positions[p];
        let state = exitStates.get(pos.lotId);
        if (!state) continue;

        auditTracker.updatePrice(pos, ctx.ticker.last, evaluationTime);

        const exitDecision = evaluateExit(pos, state, ctx, config.exitConfig ?? DEFAULT_SPOT_EXIT_CONFIG, evaluationTime);
        if (exitDecision.shouldExit) {
          const exitFillPrice = hasNextCandle ? frame.fillPrice! : currentPrice;
          const feeBreakdown = computeFeeBreakdown(pos.entryPrice, exitFillPrice, pos.qtyRemaining, feeModel);
          const pnl = computePnlBreakdown({
            entryPrice: pos.entryPrice, exitPrice: exitFillPrice,
            volume: pos.qtyRemaining, entryFeeUsd: pos.entryFee, feeModel,
          });

          const audit = auditTracker.finalizeExit(pos, exitFillPrice, exitDecision.reasonType ?? "TIME_EFFICIENCY", evaluationTime);
          const posMetrics = auditTracker.getMetrics(pos.lotId);
          const rMultiple = pos.initialStopDistanceUsd > 0
            ? (exitFillPrice - pos.entryPrice) / pos.initialStopDistanceUsd : 0;

          trades.push({
            lotId: pos.lotId, pair: pos.pair, signalId: pos.signalId,
            setupTag: pos.setupTag,
            regimeAtEntry: pos.regimeAtEntry ?? "UNKNOWN",
            directionAtEntry: pos.directionAtEntry ?? "NEUTRAL",
            entryPrice: pos.entryPrice, exitPrice: exitFillPrice,
            volume: pos.qtyRemaining,
            entryFeeUsd: feeBreakdown.entryFeeUsd, exitFeeUsd: feeBreakdown.exitFeeUsd,
            grossPnlUsd: pnl.grossPnlUsd, netPnlUsd: pnl.netPnlUsd, rMultiple,
            exitReason: exitDecision.reasonType ?? ExitReasonType.TIME_EFFICIENCY,
            openedAtMs: pos.openedAt, closedAtMs: evaluationTime,
            holdTimeMinutes: Math.round((evaluationTime - pos.openedAt) / 60000),
            mfeUsd: posMetrics?.mfeUsd ?? 0, maeUsd: posMetrics?.maeUsd ?? 0,
            mfeR: posMetrics?.mfeR ?? 0,
            profitCapturePct: audit.profitCapturePct,
            profitCaptureClass: classifyProfitCapture(audit.profitCapturePct),
            executionMode: ExecutionMode.SHADOW, policyVersion: SPOT_POLICY_VERSION,
            v4QualityScore: v4ScoreMap.get(pos.lotId) ?? -1,
          });
          positions.splice(p, 1);
          exitStates.delete(pos.lotId);
        }
      }
    }

    // ── Entry evaluation ──
    if (positions.length >= maxConcurrent) continue;

    if (config.evaluationStartMs !== undefined && evaluationTime < config.evaluationStartMs) continue;
    if (config.evaluationEndMs !== undefined && evaluationTime > config.evaluationEndMs) continue;

    if (!hasNextCandle) continue;
    if (fillPrice === null) continue;
    const entryFillPrice = fillPrice;

    if (!frame.isBuy) continue;
    signalsBuyCount++;
    b0SignalCandidates++;

    const intent = frame.intent!;

    if (entryV3Config.enabled && config.v4MinQualityScore === undefined) {
      // ── V3 path: hard AND-gates (unchanged) ──
      const features = frame.v3Features;
      if (!features) continue;

      totalCandidates++;
      const { accepted, attribution } = checkV3Acceptance(features, entryV3Config, currentPrice, evaluationTime, stageMask);

      if (attribution.rawPassImpulse) rawPassImpulseCount++;
      if (attribution.rawPassRetracement) rawPassRetracementCount++;
      if (attribution.rawPassStructure) rawPassStructureCount++;
      if (attribution.rawPassReclaim) rawPassReclaimCount++;
      if (attribution.rawPassResumption) rawPassResumptionCount++;

      if (!attribution.passAntiLateDistance) antiLateDistanceFails++;
      if (!attribution.passAntiLateExpiry) antiLateExpiryFails++;

      if (!accepted) {
        const stageFails = [!attribution.rawPassImpulse, !attribution.rawPassRetracement, !attribution.rawPassStructure, !attribution.rawPassReclaim, !attribution.rawPassResumption].filter(Boolean).length;
        if (stageFails === 1) {
          if (!attribution.rawPassImpulse) failOnlyImpulse++;
          else if (!attribution.rawPassRetracement) failOnlyRetracement++;
          else if (!attribution.rawPassStructure) failOnlyStructure++;
          else if (!attribution.rawPassReclaim) failOnlyReclaim++;
          else if (!attribution.rawPassResumption) failOnlyResumption++;
        } else if (stageFails >= 2) {
          failMultipleStages++;
        }
      }

      if (v3Log) {
        v3Log.add({
          pair, timestamp: evaluationTime,
          regime: "", direction: "",
          adx: 0, atrPct: 0,
          impulseAtr: features.impulseAtr, retracementAtr: features.retracementAtr,
          reclaimConfirmed: features.reclaimIsBullish && features.reclaimAfterOrigin,
          resumptionConfirmed: features.resumptionExists && features.resumptionIsBullish,
          distanceFromOriginAtr: features.distanceFromOriginAtr,
          accepted,
          reasonCode: accepted ? "V3_ENTRY_CONFIRMED" : "V3_REJECTED" as any,
        });
      }

      if (!accepted) continue;
    } else {
      // ── B0 path: evaluateEntryIntent (also used by V4 overlay) ──
      const ctx = buildReplayContextFast(
        pair, sorted5m, sorted15m, sorted1h, sorted4h, evaluationTime, currentPrice,
      );
      if (!ctx) continue;

      const intentEval = evaluateEntryIntent(intent, ctx, config.antiLateEntryConfig, evaluationTime);
      const b0Approved = intentEval.shouldExecute;

      // V4 overlay: quality filter on top of B0 eligibility
      if (config.v4MinQualityScore !== undefined) {
        const features = frame.v3Features;
        if (!features) {
          if (!b0Approved) continue;
          continue;
        }

        if (b0Approved) {
          b0IntentEligible++;
          b0EligibleCandidates++;
        }

        v4ScoreEligible++;
        const v4Scores = computeV4QualityScores(features);
        if (v4Scores.impulseScore > 0) rawPassImpulseCount++;
        if (v4Scores.retracementScore > 0) rawPassRetracementCount++;
        if (v4Scores.structureScore > 0) rawPassStructureCount++;
        if (v4Scores.reclaimScore > 0) rawPassReclaimCount++;
        if (v4Scores.resumptionScore > 0) rawPassResumptionCount++;

        const v4QualityPass = v4Scores.qualityScore >= config.v4MinQualityScore;
        const v4FinalAccepted = v4QualityPass && b0Approved;

        if (v4FinalAccepted && !b0Approved) v4AcceptsB0Rejected++;

        if (!b0Approved) continue;
        if (!v4QualityPass) continue;

        v4AcceptedCandidates++;
        v4FinalExecuted++;
        (frame as any)._v4QualityScore = v4Scores.qualityScore;
      } else {
        if (!b0Approved) continue;
        b0IntentEligible++;
        b0EligibleCandidates++;
      }
    }

    intentExecutableCount++;

    // Rebuild ctx for sizing (needed for ticker.last override, regime, atr, spread)
    const ctx = buildReplayContextFast(
      pair, sorted5m, sorted15m, sorted1h, sorted4h, evaluationTime, currentPrice,
    );
    if (!ctx) continue;

    const openLotsForPair = positions.filter(p => p.pair === pair).length;
    const riskConfig = config.riskConfig ?? DEFAULT_SPOT_RISK_CONFIG;
    const sizingCtx = { ...ctx, ticker: { ...ctx.ticker, last: entryFillPrice } };
    const sizing = evaluateSizing(
      sizingCtx, intent, config.availableCapitalUsd, openLotsForPair, riskConfig, feeModel,
    );

    if (!sizing.approved) continue;
    b0SizingApproved++;

    entriesExecutedCount++;
    lotCounter++;
    const lotId = `replay-${pair}-${lotCounter}`;
    const entryFee = sizing.entryFeeUsd;

    const position: SpotPosition = {
      lotId, pair, amount: sizing.volume, qtyRemaining: sizing.volume,
      entryPrice: entryFillPrice, entryFee,
      entryFeeQuality: "ESTIMATED" as FeeQuality,
      highestPrice: entryFillPrice, openedAt: evaluationTime,
      entryStrategyId: "SPOT_CANONICAL", entrySignalTf: "15m",
      signalConfidence: frame.signal.confidence, signalReason: frame.signal.reason,
      setupTag: frame.signal.setupTag ?? SetupTag.PULLBACK_CONTINUATION,
      signalId: intent.signalId, marketContextId: ctx.marketContextId,
      regimeAtEntry: ctx.regimeContext.regime, directionAtEntry: ctx.regimeContext.direction,
      macroAtEntry: ctx.regimeContext.macroBias, atrPctAtEntry: ctx.regimeContext.atrPct,
      initialStopPrice: sizing.stopPrice,
      initialStopDistancePct: sizing.stopDistancePct,
      initialStopDistanceUsd: sizing.stopDistanceUsd,
      riskUsd: sizing.riskUsd, notionalUsd: sizing.notionalUsd,
      executionMode: ExecutionMode.SHADOW, policyVersion: SPOT_POLICY_VERSION,
      sgBreakEvenActivated: false, sgTrailingActivated: false, sgScaleOutDone: false,
      sgCurrentStopPrice: sizing.stopPrice, mfe: 0, mae: 0, mfeR: 0, maeR: 0,
    };

    positions.push(position);
    exitStates.set(lotId, createExitState(position));
    auditTracker.initPosition(position);

    // Store V4 quality score for this position
    const v4Score = (frame as any)._v4QualityScore;
    if (v4Score !== undefined) {
      v4ScoreMap.set(lotId, v4Score);
    }
  }

  // Close remaining positions at terminal candle (only if not already closed by boundary)
  if (boundaryClosed) {
    positions.length = 0;
  }
  if (positions.length > 0) {
    for (const pos of positions) {
      const exitPrice = terminalClosePrice;
      const feeBreakdown = computeFeeBreakdown(pos.entryPrice, exitPrice, pos.qtyRemaining, feeModel);
      const pnl = computePnlBreakdown({
        entryPrice: pos.entryPrice, exitPrice, volume: pos.qtyRemaining,
        entryFeeUsd: pos.entryFee, feeModel,
      });
      const audit = auditTracker.finalizeExit(pos, exitPrice, "TIME_EFFICIENCY", terminalCloseTime);
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
        exitReason: ExitReasonType.TIME_EFFICIENCY,
        openedAtMs: pos.openedAt, closedAtMs: terminalCloseTime,
        holdTimeMinutes: Math.round((terminalCloseTime - pos.openedAt) / 60000),
        mfeUsd: posMetrics?.mfeUsd ?? 0, maeUsd: posMetrics?.maeUsd ?? 0,
        mfeR: posMetrics?.mfeR ?? 0,
        profitCapturePct: audit.profitCapturePct,
        profitCaptureClass: classifyProfitCapture(audit.profitCapturePct),
        executionMode: ExecutionMode.SHADOW, policyVersion: SPOT_POLICY_VERSION,
        v4QualityScore: v4ScoreMap.get(pos.lotId) ?? -1,
      });
    }
  }

  const stats = computeReplayStats(trades, {
    signalsBuy: signalsBuyCount, intentExecutable: intentExecutableCount,
    entriesExecuted: entriesExecutedCount, openTerminalTrades: positions.length,
    initialCapital: config.availableCapitalUsd,
  });

  // Attach stage attribution to v3Instrumentation if present
  if (v3Log) {
    (v3Log as any).stageAttribution = {
      totalCandidates,
      rawPassImpulsePct: totalCandidates > 0 ? rawPassImpulseCount / totalCandidates : 0,
      rawPassRetracementPct: totalCandidates > 0 ? rawPassRetracementCount / totalCandidates : 0,
      rawPassStructurePct: totalCandidates > 0 ? rawPassStructureCount / totalCandidates : 0,
      rawPassReclaimPct: totalCandidates > 0 ? rawPassReclaimCount / totalCandidates : 0,
      rawPassResumptionPct: totalCandidates > 0 ? rawPassResumptionCount / totalCandidates : 0,
      failOnlyImpulse, failOnlyRetracement, failOnlyStructure, failOnlyReclaim, failOnlyResumption,
      failMultipleStages,
      antiLateDistanceFails, antiLateExpiryFails,
    };
  }

  return { pair, trades, stats, config, v3Instrumentation: v3Log?.entries, b0EligibleCandidates, v4AcceptedCandidates, b0SignalCandidates, b0IntentEligible, b0SizingApproved, v4ScoreEligible, v4FinalExecuted, v4AcceptsB0Rejected };
}
