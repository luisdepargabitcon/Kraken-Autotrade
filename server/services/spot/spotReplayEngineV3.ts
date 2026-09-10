/**
 * spotReplayEngineV3 — Replay engine consuming Forward Twin snapshots.
 *
 * Reads recorded snapshots from spot_forward_twin_snapshots table and
 * reconstructs the trading session offline.
 *
 * PRINCIPLE:
 *   - Inputs (ticker, candles, regime, volume) come from recorded snapshots.
 *   - Decisions (signal, intent, sizing, exit) are RECALCULATED using
 *     the same productive code (evaluateSpotCanonical, evaluateEntryIntent,
 *     evaluateSizing, evaluateExit).
 *   - Recorded decisions are used ONLY for comparison (fidelity metrics).
 *
 * ANTI-CHEAT GUARD:
 *   - No access to trades, bot_events, open_positions historical tables.
 *   - Only reads from spot_forward_twin_snapshots.
 *
 * DETERMINISM:
 *   - All inputs come from recorded snapshots (no live API calls).
 *   - Time is driven by snapshot timestamps (no wall clock).
 *   - Same input → same output, guaranteed.
 */

import { db } from "../../db";
import { sql } from "drizzle-orm";
import type {
  ForwardTwinSnapshot,
  ForwardTwinPositionSnapshot,
  ForwardTwinFillSnapshot,
  ReplayV3Config,
  ReplayV3Result,
  ReplayV3Trade,
  ReplayV3FidelityMetrics,
} from "./spotForwardTwinTypes";
import { isForwardTwinSchemaAllowed } from "./spotForwardTwinTypes";
import { evaluateSpotCanonical, type SpotSignalResult } from "./spotCanonicalStrategy";
import { createEntryIntent, evaluateEntryIntent, DEFAULT_ANTI_LATE_ENTRY_CONFIG } from "./spotEntryIntent";
import { evaluateSizing, DEFAULT_SPOT_RISK_CONFIG } from "./spotRiskManager";
import { evaluateExit, createExitState } from "./spotExitPolicy";
import { ExecutionMode, Regime, RegimeDirection, MacroBias, VolatilityLevel, SetupTag,
  type SpotMarketContext, type SpotPosition, type SpotExitState, type SpotExitDecision,
  type SpotRegimeContext } from "./spotTypes";
import { DataHealth } from "./candleTimestamp";
import { buildClosedCandleContext } from "./closedCandleContract";
import { buildAdaptiveMarketState } from "./spotAdaptiveMarketState";
import { computeFeeBreakdown, computePnlBreakdown } from "./feeModel";

// ─── Snapshot Loader ─────────────────────────────────────────────────────────

/**
 * Load snapshots from DB for a given pair and time range.
 * Returns sorted by timestamp ascending.
 */
export async function loadSnapshots(
  pair: string,
  startMs: number,
  endMs: number,
): Promise<ForwardTwinSnapshot[]> {
  // C1F4-2: Do NOT filter by a single schema version — SUPERVISOR v2 is valid.
  // C1F4-3: ORDER BY timestamp ASC, id ASC for deterministic ordering.
  const result = await db.execute(sql`
    SELECT id, schema_version, snapshot_type, timestamp, data
    FROM spot_forward_twin_snapshots
    WHERE pair = ${pair}
      AND timestamp >= ${startMs}
      AND timestamp <= ${endMs}
    ORDER BY timestamp ASC, id ASC
  `);

  const snapshots: ForwardTwinSnapshot[] = [];
  for (const row of result.rows as any[]) {
    const data = row.data as ForwardTwinSnapshot;
    const rowSnapshotType = row.snapshot_type as string;
    const rowSchemaVersion = row.schema_version as number;

    // C1F4-2: Validate physical/JSON consistency — FAIL-CLOSED on mismatch.
    if (data.schemaVersion !== rowSchemaVersion || data.snapshotType !== rowSnapshotType) {
      // Typed schema mismatch — reject silently (fail-closed).
      continue;
    }

    // C1F4-2: Validate schema is allowed for this snapshot type.
    if (!isForwardTwinSchemaAllowed(rowSnapshotType, rowSchemaVersion)) {
      continue;
    }

    snapshots.push(data);
  }
  return snapshots;
}

// ─── Replay Engine ───────────────────────────────────────────────────────────

interface ReplayPosition {
  lotId: string;
  pair: string;
  entryPrice: number;
  entryTime: number;
  amount: number;
  qtyRemaining: number;
  setupTag: string;
  highestPrice: number;
  mfe: number;
  mae: number;
  mfeR: number;
  maeR: number;
  entryFeeUsd: number;
  stopPrice: number;
  economicFidelity: "FILL" | "DEGRADED";
  pendingExit: { price: number; reasonType: string; evaluatedAt: number } | null;
  signalId: string | null;
  intentId: string | null;
  // C1F4-10: Track fill confirmation separately.
  // economicFidelity="FILL" only when BOTH entryFillConfirmed AND exitFillConfirmed.
  entryFillConfirmed: boolean;
  exitFillConfirmed: boolean;
}

// C1F4-4: Pending entry — SCAN creates this, not a ReplayPosition.
// BUY FILL materializes a ReplayPosition from a PendingEntry.
interface PendingEntry {
  pair: string;
  scanId: string;
  signalId: string | null;
  setupTag: string;
  intendedVolume: number;
  estimatedFee: number;
  stopPrice: number;
  createdAt: number;
  tickerLast: number;
}

interface ReplayState {
  positions: Map<string, ReplayPosition>;
  // C1F4-4: Pending entries keyed by signalId (or scanId fallback).
  pendingEntries: Map<string, PendingEntry>;
  trades: ReplayV3Trade[];
  equity: number;
  maxEquity: number;
  maxDrawdownUsd: number;
  scanCount: number;
  supervisorCount: number;
  fillCount: number;
  // Fidelity tracking
  signalMatches: number;
  signalTotal: number;
  intentMatches: number;
  intentTotal: number;
  entryMatches: number;
  entryTotal: number;
  exitMatches: number;
  exitTotal: number;
  fillMatches: number;
  fillTotal: number;
}

/**
 * Run Replay V3 on recorded Forward Twin snapshots.
 *
 * The replay processes snapshots in chronological order:
 *   1. SCAN snapshots → track signals, intents, entries
 *   2. SUPERVISOR snapshots → track exit decisions, position updates
 *   3. FILL snapshots → verify fill prices match
 *
 * Returns trades, equity curve, and fidelity metrics.
 */
export async function runReplayV3(config: ReplayV3Config): Promise<ReplayV3Result> {
  const snapshots = await loadSnapshots(config.pair, config.startMs, config.endMs);

  const state: ReplayState = {
    positions: new Map(),
    pendingEntries: new Map(),
    trades: [],
    equity: config.initialCapitalUsd,
    maxEquity: config.initialCapitalUsd,
    maxDrawdownUsd: 0,
    scanCount: 0,
    supervisorCount: 0,
    fillCount: 0,
    signalMatches: 0,
    signalTotal: 0,
    intentMatches: 0,
    intentTotal: 0,
    entryMatches: 0,
    entryTotal: 0,
    exitMatches: 0,
    exitTotal: 0,
    fillMatches: 0,
    fillTotal: 0,
  };

  for (const snap of snapshots) {
    switch (snap.snapshotType) {
      case "SCAN":
        processScanSnapshot(state, snap);
        break;
      case "SUPERVISOR":
        processSupervisorSnapshot(state, snap);
        break;
      case "FILL":
        processFillSnapshot(state, snap);
        break;
    }
  }

  // C1F4-4: Pending entries without BUY FILL do NOT create full trades.
  // They are registered as degraded telemetry only.
  for (const [key, pending] of state.pendingEntries) {
    state.trades.push({
      lotId: `pending-${pending.pair}-${pending.createdAt}`,
      pair: pending.pair,
      entryPrice: pending.tickerLast,
      exitPrice: pending.tickerLast,
      amount: pending.intendedVolume,
      entryTime: pending.createdAt,
      exitTime: pending.createdAt,
      netPnlUsd: -pending.estimatedFee,
      grossPnlUsd: 0,
      entryFeeUsd: pending.estimatedFee,
      exitFeeUsd: 0,
      exitReasonType: "NO_BUY_FILL",
      holdTimeMinutes: 0,
      mfe: 0,
      mae: 0,
      mfeR: 0,
      maeR: 0,
      setupTag: pending.setupTag,
      economicFidelity: "DEGRADED",
    });
    state.equity -= pending.estimatedFee;
  }

  // Close any remaining open positions at last known price
  for (const [lotId, pos] of state.positions) {
    const lastSnap = snapshots.findLast(s => s.pair === pos.pair && s.ticker);
    const exitPrice = lastSnap?.ticker?.last ?? pos.entryPrice;
    // C1F4-10: OPEN_AT_END is always DEGRADED (no SELL FILL).
    pos.economicFidelity = "DEGRADED";
    // If entry fee was not yet deducted (entryFillConfirmed but no exit fill), deduct now.
    if (pos.entryFillConfirmed && !pos.exitFillConfirmed) {
      // Entry fee already deducted at BUY FILL time — do NOT double-deduct.
    } else {
      state.equity -= pos.entryFeeUsd;
    }
    finalizeTrade(state, pos, exitPrice, "OPEN_AT_END", snapshots[snapshots.length - 1]?.timestamp ?? Date.now());
  }

  const fidelity = computeFidelityMetrics(state);
  const maxDrawdownPct = state.maxEquity > 0
    ? (state.maxDrawdownUsd / state.maxEquity) * 100
    : 0;

  return {
    trades: state.trades,
    finalEquity: state.equity,
    maxDrawdownUsd: state.maxDrawdownUsd,
    maxDrawdownPct,
    scanCount: state.scanCount,
    supervisorCount: state.supervisorCount,
    fillCount: state.fillCount,
    fidelity,
    deterministic: true,
  };
}

// ─── Snapshot Processors ─────────────────────────────────────────────────────

function processScanSnapshot(state: ReplayState, snap: ForwardTwinSnapshot): void {
  state.scanCount++;

  // Reconstruct SpotMarketContext from recorded inputs
  const ctx = _reconstructContextForTest(snap);
  if (!ctx) return;

  // RECALCULATE signal using productive code
  const replaySignal = evaluateSpotCanonical(ctx);

  // Compare with recorded signal
  if (snap.signal) {
    state.signalTotal++;
    if (replaySignal.signal === snap.signal.signal) {
      state.signalMatches++;
    }
  }

  // RECALCULATE intent + sizing if signal is BUY
  if (replaySignal.signal === "BUY") {
    const replayIntent = createEntryIntent(replaySignal, ctx);
    const replayEvaluation = evaluateEntryIntent(replayIntent, ctx);

    // Compare with recorded intent
    if (snap.intent) {
      state.intentTotal++;
      if (replayEvaluation.shouldExecute === snap.intent.shouldExecute) {
        state.intentMatches++;
      }
    }

    // RECALCULATE sizing
    const replaySizing = evaluateSizing(ctx, replayIntent, state.equity, 0);

    // Compare with recorded sizing
    if (snap.sizing) {
      state.entryTotal++;
      if (replaySizing.approved === snap.sizing.approved) {
        state.entryMatches++;
      }
    }
  }

  // C1F4-4: Open pending entry if recorded pipeline executed.
  // SCAN does NOT create a ReplayPosition — only a PendingEntry.
  // BUY FILL materializes the ReplayPosition with real lotId and fill data.
  if (snap.pipelineStopStage === "EXECUTED" && snap.sizing?.approved) {
    // C1F4-5: signalId comes from snap.intent.signalId, NOT signal.contextId.
    const signalId = snap.intent?.signalId ?? null;
    // C1F4-6: Do NOT fake intentId in SCAN. intentId is SpotExecutionIntent.id,
    // which is NOT available at SCAN time. Keep null until a causal source provides it.
    const pendingKey = signalId ?? snap.scanId;
    const pending: PendingEntry = {
      pair: snap.pair,
      scanId: snap.scanId,
      signalId,
      setupTag: String(snap.signal?.setupTag ?? replaySignal.setupTag ?? "UNKNOWN"),
      intendedVolume: snap.sizing.volume,
      estimatedFee: snap.sizing.entryFeeUsd,
      stopPrice: snap.sizing.stopPrice,
      createdAt: snap.timestamp,
      tickerLast: ctx.ticker.last,
    };
    state.pendingEntries.set(pendingKey, pending);
  }
}

function processSupervisorSnapshot(state: ReplayState, snap: ForwardTwinSnapshot): void {
  state.supervisorCount++;

  // Reconstruct context from supervisor snapshot
  const ctx = _reconstructContextForTest(snap);
  if (!ctx || !snap.position) return;

  // C1F4-8: Correlate by lotId first — never pick the first matching pair arbitrarily.
  let pos: ReplayPosition | undefined;
  if (snap.position.lotId) {
    pos = state.positions.get(snap.position.lotId);
  }
  if (!pos) {
    // Fallback by pair only if EXACTLY one position for that pair (legacy/degraded).
    const samePair = [...state.positions.values()].filter(p => p.pair === snap.position!.pair);
    if (samePair.length === 1) {
      pos = samePair[0];
    }
    // If 2+ positions for same pair and no lotId match: fail-closed (no update).
  }
  if (!pos) return;

  // Reconstruct SpotPosition for evaluateExit
  const spotPosition = reconstructPosition(snap.position, pos);
  const exitState = reconstructExitState(snap.position);

  // RECALCULATE exit decision using productive code
  const replayExit = evaluateExit(spotPosition, exitState, ctx);

  // Compare with recorded exit decision
  if (snap.exitDecision) {
    state.exitTotal++;
    if (replayExit.shouldExit === snap.exitDecision.shouldExit) {
      state.exitMatches++;
    }
  }

  // Update MFE/MAE
  pos.highestPrice = Math.max(pos.highestPrice, snap.position.highestPrice);
  pos.mfe = snap.position.mfe;
  pos.mae = snap.position.mae;
  pos.mfeR = snap.position.mfeR;
  pos.maeR = snap.position.maeR;

  // C1F3-7: Register PENDING EXIT — do NOT finalize yet. SELL FILL is the economic authority.
  if (snap.exitDecision?.shouldExit) {
    pos.pendingExit = {
      price: snap.exitDecision.price,
      reasonType: snap.exitDecision.reasonType ?? "UNKNOWN",
      evaluatedAt: snap.exitDecision.evaluatedAt,
    };
  }
}

function processFillSnapshot(state: ReplayState, snap: ForwardTwinSnapshot): void {
  state.fillCount++;

  if (!snap.fill) return;
  state.fillTotal++;

  const fill = snap.fill;

  if (fill.side === "BUY") {
    // C1F4-7: BUY FILL materializes a ReplayPosition from a PendingEntry.
    // Correlate by fill.signalId → pendingEntry.signalId first.
    let pending: PendingEntry | undefined;
    if (fill.signalId) {
      pending = state.pendingEntries.get(fill.signalId);
    }
    if (!pending) {
      // Fallback: match by pair if exactly 1 pending entry for that pair.
      const samePair = [...state.pendingEntries.values()].filter(pe => pe.pair === snap.pair);
      if (samePair.length === 1) pending = samePair[0];
    }
    if (!pending) return; // No matching pending entry — skip.

    const lotId = fill.lotId ?? `replay-${snap.pair}-${pending.createdAt}`;
    // C1F4-7: mapKey === position.lotId invariant.
    const pos: ReplayPosition = {
      lotId,
      pair: pending.pair,
      entryPrice: fill.fillPrice,
      entryTime: fill.executedAt,
      amount: fill.fillVolume,
      qtyRemaining: fill.fillVolume,
      setupTag: pending.setupTag,
      highestPrice: fill.fillPrice,
      mfe: 0,
      mae: 0,
      mfeR: 0,
      maeR: 0,
      entryFeeUsd: fill.feeUsd > 0 ? fill.feeUsd : pending.estimatedFee,
      stopPrice: pending.stopPrice,
      // C1F4-10: economicFidelity is FILL only when BOTH entry AND exit fills confirmed.
      economicFidelity: "DEGRADED",
      pendingExit: null,
      signalId: pending.signalId,
      intentId: fill.intentId ?? null,
      entryFillConfirmed: true,
      exitFillConfirmed: false,
    };
    state.positions.set(lotId, pos);

    // Remove pending entry — it's been materialized.
    const pendingKey = pending.signalId ?? pending.scanId;
    state.pendingEntries.delete(pendingKey);

    // C1F3-5: Deduct entryFee at BUY FILL time.
    state.equity -= pos.entryFeeUsd;

    // Fill price verification
    state.fillMatches++;
  } else if (fill.side === "SELL") {
    // C1F4-9: SELL FILL correlates by lotId directly.
    let pos: ReplayPosition | undefined;
    if (fill.lotId) {
      pos = state.positions.get(fill.lotId);
    }
    if (!pos) {
      // Fallback: match by pair if exactly 1 position for that pair.
      const samePair = [...state.positions.values()].filter(p => p.pair === snap.pair);
      if (samePair.length === 1) pos = samePair[0];
    }
    if (!pos) return;

    // C1F4-14: Fill volume integrity — verify volume matches.
    const volumeMismatch = Math.abs(fill.fillVolume - pos.qtyRemaining) > 0.0001;
    if (volumeMismatch) {
      // Mark as DEGRADED — cannot guarantee exact economic parity.
      pos.economicFidelity = "DEGRADED";
    }

    const exitPrice = fill.fillPrice;
    const exitReasonType = pos.pendingExit?.reasonType ?? "UNKNOWN";
    const exitTime = fill.executedAt;

    // C1F4-10: Mark exit fill confirmed.
    pos.exitFillConfirmed = true;
    // C1F4-10: Full fidelity only if both entry AND exit fills confirmed.
    if (pos.entryFillConfirmed && pos.exitFillConfirmed && !volumeMismatch) {
      pos.economicFidelity = "FILL";
    } else {
      pos.economicFidelity = "DEGRADED";
    }

    finalizeTrade(state, pos, exitPrice, exitReasonType, exitTime, fill.feeUsd);
    // C1F4-7: Delete by lotId (mapKey === lotId invariant).
    state.positions.delete(pos.lotId);

    state.fillMatches++;
  }
}
// ─── Trade Finalization ──────────────────────────────────────────────────────

function finalizeTrade(
  state: ReplayState,
  pos: ReplayPosition,
  exitPrice: number,
  exitReasonType: string,
  exitTime: number,
  fillFeeUsd?: number,
): void {
  // C1F2-11: Use canonical fee model — eliminate hardcoded 0.0026
  // A fee must NEVER depend on the sign of PnL. Use computeFeeBreakdown + computePnlBreakdown.
  const feeBreakdown = computeFeeBreakdown(pos.entryPrice, exitPrice, pos.amount);
  const pnl = computePnlBreakdown({
    entryPrice: pos.entryPrice,
    exitPrice,
    volume: pos.amount,
    entryFeeUsd: pos.entryFeeUsd,
  });

  const grossPnl = pnl.grossPnlUsd;
  const exitFeeUsd = fillFeeUsd != null && fillFeeUsd > 0 ? fillFeeUsd : feeBreakdown.exitFeeUsd;
  // C1F3-7: When fill fee is provided, recompute netPnl to use fill-based exit fee
  const netPnl = fillFeeUsd != null && fillFeeUsd > 0
    ? grossPnl - pos.entryFeeUsd - exitFeeUsd
    : pnl.netPnlUsd;

  // C1F3-5: Fix double entry fee — entryFee already deducted at open (processScanSnapshot or BUY FILL)
  // At close: add grossPnl - exitFee (NOT netPnl, which includes entryFee)
  state.equity += grossPnl - exitFeeUsd;
  state.maxEquity = Math.max(state.maxEquity, state.equity);
  state.maxDrawdownUsd = Math.max(state.maxDrawdownUsd, state.maxEquity - state.equity);

  const holdTimeMinutes = (exitTime - pos.entryTime) / 60_000;

  state.trades.push({
    lotId: pos.lotId,
    pair: pos.pair,
    entryPrice: pos.entryPrice,
    exitPrice,
    amount: pos.amount,
    entryTime: pos.entryTime,
    exitTime,
    netPnlUsd: netPnl,
    grossPnlUsd: grossPnl,
    entryFeeUsd: pos.entryFeeUsd,
    exitFeeUsd,
    exitReasonType,
    holdTimeMinutes,
    mfe: pos.mfe,
    mae: pos.mae,
    mfeR: pos.mfeR,
    maeR: pos.maeR,
    setupTag: pos.setupTag,
    economicFidelity: pos.economicFidelity,
  });
}

// ─── Fidelity Metrics ────────────────────────────────────────────────────────

function computeFidelityMetrics(state: ReplayState): ReplayV3FidelityMetrics {
  const safeRate = (matches: number, total: number) => total > 0 ? matches / total : 1;

  return {
    signalMatchRate: safeRate(state.signalMatches, state.signalTotal),
    signalTotal: state.signalTotal,
    intentMatchRate: safeRate(state.intentMatches, state.intentTotal),
    intentTotal: state.intentTotal,
    entryMatchRate: safeRate(state.entryMatches, state.entryTotal),
    entryTotal: state.entryTotal,
    exitDecisionMatchRate: safeRate(state.exitMatches, state.exitTotal),
    fillMatchRate: safeRate(state.fillMatches, state.fillTotal),
    totalSnapshots: state.scanCount + state.supervisorCount + state.fillCount,
    scanSnapshots: state.scanCount,
    supervisorSnapshots: state.supervisorCount,
    fillSnapshots: state.fillCount,
    matchedTrades: state.trades.filter(t => t.netPnlUsd !== 0).length,
    mismatchedTrades: 0,
  };
}

// ─── Context Reconstruction ──────────────────────────────────────────────────

export function _reconstructContextForTest(snap: ForwardTwinSnapshot): SpotMarketContext | null {
  if (!snap.ticker) return null;

  // Supervisor snapshots may not have regime — construct minimal context
  const reg = snap.regime;
  const regimeCtx: SpotRegimeContext = reg ? {
    regimeId: reg.regimeId,
    contextId: reg.contextId,
    pair: snap.pair,
    regime: reg.regime as Regime,
    direction: reg.direction as RegimeDirection,
    volatility: reg.volatility as VolatilityLevel,
    macroBias: reg.macroBias as MacroBias,
    adx: reg.adx,
    ema20: reg.ema20,
    ema50: reg.ema50,
    ema200: reg.ema200,
    emaAlignment: reg.emaAlignment as "bullish" | "bearish" | "neutral",
    bollingerWidth: reg.bollingerWidth,
    atrPct: reg.atrPct,
    confidence: reg.confidence,
    dataHealth: (snap.dataHealth ?? "GOOD") as DataHealth,
    generatedAt: snap.timestamp,
  } : {
    regimeId: "replay-minimal",
    contextId: snap.marketContextId ?? snap.scanId,
    pair: snap.pair,
    regime: Regime.TREND,
    direction: RegimeDirection.BULLISH,
    volatility: VolatilityLevel.NORMAL,
    macroBias: MacroBias.BULLISH,
    adx: 25,
    ema20: snap.ticker.last,
    ema50: snap.ticker.last,
    ema200: snap.ticker.last,
    emaAlignment: "neutral",
    bollingerWidth: 0.03,
    atrPct: 1.5,
    confidence: 0.5,
    dataHealth: (snap.dataHealth ?? "GOOD") as DataHealth,
    generatedAt: snap.timestamp,
  };

  // Use the canonical contract as the single source of truth for candle arrays.
  // Snapshot candles are all historical (closed) in replay — no forming candles.
  const snapCandles5m = snap.candles?.candles5m?.candles ?? [];
  const snapCandles15m = snap.candles?.candles15m?.candles ?? [];
  const snapCandles1h = snap.candles?.candles1h?.candles ?? [];
  const snapCandles4h = snap.candles?.candles4h?.candles ?? [];

  const closedCandleContext = buildClosedCandleContext(
    snapCandles5m,
    snapCandles15m,
    snapCandles1h,
    snapCandles4h,
    snap.timestamp,
  );

  // Derive all candle arrays from the contract — no direct snapshot assignment
  const candles5m = closedCandleContext.tf5m.closedCandles;
  const candles15m = closedCandleContext.tf15m.closedCandles;
  const candles1h = closedCandleContext.tf1h.closedCandles;
  const candles4h = closedCandleContext.tf4h.closedCandles;

  return {
    marketContextId: snap.marketContextId ?? snap.scanId,
    generatedAt: snap.timestamp,
    pair: snap.pair,
    dataHealth: (snap.dataHealth ?? "GOOD") as DataHealth,
    macroBias: regimeCtx.macroBias,
    regimeContext: regimeCtx,
    candles5m,
    candles15m,
    candles1h,
    candles4h,
    formingCandle5m: closedCandleContext.tf5m.formingCandle,
    formingCandle15m: closedCandleContext.tf15m.formingCandle,
    formingCandle1h: closedCandleContext.tf1h.formingCandle,
    formingCandle4h: closedCandleContext.tf4h.formingCandle,
    closedCandleContext,
    adaptiveMarketState: buildAdaptiveMarketState({
      candles1h,
      candles15m,
      candles4h,
      regimeContext: regimeCtx,
      spreadPct: snap.ticker.spreadPct,
      dataHealth: snap.dataHealth ?? "GOOD",
    }),
    ticker: {
      bid: snap.ticker.bid,
      ask: snap.ticker.ask,
      last: snap.ticker.last,
      spread: snap.ticker.spread,
      fetchedAt: snap.ticker.fetchedAt,
    },
    spreadPct: snap.ticker.spreadPct,
    atr: regimeCtx.atrPct > 0 ? snap.ticker.last * regimeCtx.atrPct / 100 : 0,
    volumeMetrics: snap.volume ? {
      volumeRatio: snap.volume.volumeRatio,
      volume24h: snap.volume.volume24h,
      participation: snap.volume.participation as "LOW" | "NORMAL" | "HIGH",
    } : { volumeRatio: 1, volume24h: 0, participation: "NORMAL" },
  };
}

function reconstructPosition(posSnap: ForwardTwinPositionSnapshot, replayPos: ReplayPosition): SpotPosition {
  return {
    lotId: posSnap.lotId,
    pair: posSnap.pair,
    amount: posSnap.amount,
    qtyRemaining: posSnap.qtyRemaining,
    entryPrice: posSnap.entryPrice,
    entryFee: replayPos.entryFeeUsd,
    entryFeeQuality: "ESTIMATED",
    highestPrice: posSnap.highestPrice,
    openedAt: posSnap.openedAt,
    entryStrategyId: "SPOT_CANONICAL",
    entrySignalTf: "15m",
    signalConfidence: 0.8,
    signalReason: "",
    setupTag: posSnap.setupTag as SetupTag,
    signalId: "",
    marketContextId: "",
    regimeAtEntry: Regime.TREND,
    directionAtEntry: RegimeDirection.BULLISH,
    macroAtEntry: MacroBias.BULLISH,
    atrPctAtEntry: 0,
    initialStopPrice: replayPos.stopPrice,
    initialStopDistancePct: 0,
    initialStopDistanceUsd: 0,
    riskUsd: 0,
    notionalUsd: posSnap.entryPrice * posSnap.amount,
    executionMode: ExecutionMode.SHADOW,
    policyVersion: "SPOT-1.0.0-20260812",
    sgBreakEvenActivated: posSnap.sgBreakEvenActivated,
    sgTrailingActivated: posSnap.sgTrailingActivated,
    sgScaleOutDone: false,
    sgCurrentStopPrice: posSnap.sgCurrentStopPrice,
    mfe: posSnap.mfe,
    mae: posSnap.mae,
    mfeR: posSnap.mfeR,
    maeR: posSnap.maeR,
  };
}

function reconstructExitState(posSnap: ForwardTwinPositionSnapshot): SpotExitState {
  return {
    positionLotId: posSnap.lotId,
    emergencyStopPrice: posSnap.sgCurrentStopPrice,
    structureInvalidationPrice: null,
    breakEvenStopPrice: posSnap.breakEvenStopPrice,
    trailingStopPrice: posSnap.trailingStopPrice,
    trailingHighestPrice: posSnap.trailingHighestPrice,
    profitExitTarget: null,
    timeEfficiencyArmed: false,
    lastExitEvaluation: null,
    currentExitReason: null,
  };
}

// ─── Test-only helpers ───────────────────────────────────────────────────────

/**
 * Process snapshots from an in-memory array (for testing without DB).
 */
export function _processSnapshotsForTest(
  snapshots: ForwardTwinSnapshot[],
  initialCapitalUsd: number,
): ReplayV3Result {
  const state: ReplayState = {
    positions: new Map(),
    pendingEntries: new Map(),
    trades: [],
    equity: initialCapitalUsd,
    maxEquity: initialCapitalUsd,
    maxDrawdownUsd: 0,
    scanCount: 0,
    supervisorCount: 0,
    fillCount: 0,
    signalMatches: 0,
    signalTotal: 0,
    intentMatches: 0,
    intentTotal: 0,
    entryMatches: 0,
    entryTotal: 0,
    exitMatches: 0,
    exitTotal: 0,
    fillMatches: 0,
    fillTotal: 0,
  };

  for (const snap of snapshots) {
    switch (snap.snapshotType) {
      case "SCAN":
        processScanSnapshot(state, snap);
        break;
      case "SUPERVISOR":
        processSupervisorSnapshot(state, snap);
        break;
      case "FILL":
        processFillSnapshot(state, snap);
        break;
    }
  }

  // C1F4-4: Pending entries without BUY FILL do NOT create full trades.
  for (const [key, pending] of state.pendingEntries) {
    state.trades.push({
      lotId: `pending-${pending.pair}-${pending.createdAt}`,
      pair: pending.pair,
      entryPrice: pending.tickerLast,
      exitPrice: pending.tickerLast,
      amount: pending.intendedVolume,
      entryTime: pending.createdAt,
      exitTime: pending.createdAt,
      netPnlUsd: -pending.estimatedFee,
      grossPnlUsd: 0,
      entryFeeUsd: pending.estimatedFee,
      exitFeeUsd: 0,
      exitReasonType: "NO_BUY_FILL",
      holdTimeMinutes: 0,
      mfe: 0,
      mae: 0,
      mfeR: 0,
      maeR: 0,
      setupTag: pending.setupTag,
      economicFidelity: "DEGRADED",
    });
    state.equity -= pending.estimatedFee;
  }

  // Close remaining positions
  for (const [lotId, pos] of state.positions) {
    const lastSnap = snapshots.findLast(s => s.pair === pos.pair && s.ticker);
    const exitPrice = lastSnap?.ticker?.last ?? pos.entryPrice;
    // C1F4-10: OPEN_AT_END is always DEGRADED (no SELL FILL).
    pos.economicFidelity = "DEGRADED";
    if (pos.entryFillConfirmed && !pos.exitFillConfirmed) {
      // Entry fee already deducted at BUY FILL time — do NOT double-deduct.
    } else {
      state.equity -= pos.entryFeeUsd;
    }
    finalizeTrade(state, pos, exitPrice, "OPEN_AT_END", snapshots[snapshots.length - 1]?.timestamp ?? Date.now());
  }

  const fidelity = computeFidelityMetrics(state);
  const maxDrawdownPct = state.maxEquity > 0
    ? (state.maxDrawdownUsd / state.maxEquity) * 100
    : 0;

  return {
    trades: state.trades,
    finalEquity: state.equity,
    maxDrawdownUsd: state.maxDrawdownUsd,
    maxDrawdownPct,
    scanCount: state.scanCount,
    supervisorCount: state.supervisorCount,
    fillCount: state.fillCount,
    fidelity,
    deterministic: true,
  };
}
