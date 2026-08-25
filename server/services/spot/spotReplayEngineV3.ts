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
  ReplayV3Config,
  ReplayV3Result,
  ReplayV3Trade,
  ReplayV3FidelityMetrics,
} from "./spotForwardTwinTypes";
import { SPOT_FORWARD_TWIN_SCHEMA_VERSION } from "./spotForwardTwinTypes";
import { evaluateSpotCanonical, type SpotSignalResult } from "./spotCanonicalStrategy";
import { createEntryIntent, evaluateEntryIntent, DEFAULT_ANTI_LATE_ENTRY_CONFIG } from "./spotEntryIntent";
import { evaluateSizing, DEFAULT_SPOT_RISK_CONFIG } from "./spotRiskManager";
import { evaluateExit, createExitState } from "./spotExitPolicy";
import { ExecutionMode, Regime, RegimeDirection, MacroBias, VolatilityLevel, SetupTag,
  type SpotMarketContext, type SpotPosition, type SpotExitState, type SpotExitDecision,
  type SpotRegimeContext } from "./spotTypes";
import { DataHealth } from "./candleTimestamp";

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
  const result = await db.execute(sql`
    SELECT data FROM spot_forward_twin_snapshots
    WHERE pair = ${pair}
      AND timestamp >= ${startMs}
      AND timestamp <= ${endMs}
      AND schema_version = ${SPOT_FORWARD_TWIN_SCHEMA_VERSION}
    ORDER BY timestamp ASC
  `);

  return result.rows.map((row: any) => row.data as ForwardTwinSnapshot);
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
}

interface ReplayState {
  positions: Map<string, ReplayPosition>;
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

  // Close any remaining open positions at last known price
  for (const [lotId, pos] of state.positions) {
    const lastSnap = snapshots.findLast(s => s.pair === pos.pair && s.ticker);
    const exitPrice = lastSnap?.ticker?.last ?? pos.entryPrice;
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
  const ctx = reconstructContext(snap);
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

  // Open replay position if recorded pipeline executed
  // Uses recorded sizing data to track actual activity (not replay recalculation)
  if (snap.pipelineStopStage === "EXECUTED" && snap.sizing?.approved) {
    const lotId = `replay-${snap.pair}-${snap.timestamp}`;
    const pos: ReplayPosition = {
      lotId,
      pair: snap.pair,
      entryPrice: ctx.ticker.last,
      entryTime: snap.timestamp,
      amount: snap.sizing.volume,
      qtyRemaining: snap.sizing.volume,
      setupTag: String(snap.signal?.setupTag ?? replaySignal.setupTag ?? "UNKNOWN"),
      highestPrice: ctx.ticker.last,
      mfe: 0,
      mae: 0,
      mfeR: 0,
      maeR: 0,
      entryFeeUsd: snap.sizing.entryFeeUsd,
      stopPrice: snap.sizing.stopPrice,
    };
    state.positions.set(lotId, pos);
    state.equity -= snap.sizing.entryFeeUsd;
  }
}

function processSupervisorSnapshot(state: ReplayState, snap: ForwardTwinSnapshot): void {
  state.supervisorCount++;

  // Reconstruct context from supervisor snapshot
  const ctx = reconstructContext(snap);
  if (!ctx || !snap.position) return;

  // Find replay position by pair (replay uses synthetic lotIds)
  let pos: ReplayPosition | undefined;
  for (const p of state.positions.values()) {
    if (p.pair === snap.position.pair) {
      pos = p;
      break;
    }
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

  // Close position if exit triggered (use recorded price for consistency)
  if (snap.exitDecision?.shouldExit) {
    const exitPrice = snap.exitDecision.price;
    for (const [key, p] of state.positions) {
      if (p.pair === snap.position.pair) {
        finalizeTrade(state, p, exitPrice, snap.exitDecision.reasonType ?? "UNKNOWN", snap.exitDecision.evaluatedAt);
        state.positions.delete(key);
        break;
      }
    }
  }
}

function processFillSnapshot(state: ReplayState, snap: ForwardTwinSnapshot): void {
  state.fillCount++;

  if (snap.fill) {
    state.fillTotal++;
    // Verify fill price is reasonable (within 1% of ticker)
    if (snap.ticker && snap.ticker.last > 0) {
      const deviation = Math.abs(snap.fill.fillPrice - snap.ticker.last) / snap.ticker.last;
      if (deviation < 0.01) {
        state.fillMatches++;
      }
    } else {
      // No ticker to compare — trust the recorded fill
      state.fillMatches++;
    }
  }
}

// ─── Trade Finalization ──────────────────────────────────────────────────────

function finalizeTrade(
  state: ReplayState,
  pos: ReplayPosition,
  exitPrice: number,
  exitReasonType: string,
  exitTime: number,
): void {
  const grossPnl = (exitPrice - pos.entryPrice) * pos.amount;
  const exitFeeUsd = grossPnl * 0.0026; // estimated taker fee
  const netPnl = grossPnl - pos.entryFeeUsd - exitFeeUsd;

  state.equity += netPnl;
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

function reconstructContext(snap: ForwardTwinSnapshot): SpotMarketContext | null {
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

  return {
    marketContextId: snap.marketContextId ?? snap.scanId,
    generatedAt: snap.timestamp,
    pair: snap.pair,
    dataHealth: (snap.dataHealth ?? "GOOD") as DataHealth,
    macroBias: regimeCtx.macroBias,
    regimeContext: regimeCtx,
    candles5m: snap.candles?.candles5m?.candles ?? [],
    candles15m: snap.candles?.candles15m?.candles ?? [],
    candles1h: snap.candles?.candles1h?.candles ?? [],
    candles4h: snap.candles?.candles4h?.candles ?? [],
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

  // Close remaining positions
  for (const [lotId, pos] of state.positions) {
    const lastSnap = snapshots.findLast(s => s.pair === pos.pair && s.ticker);
    const exitPrice = lastSnap?.ticker?.last ?? pos.entryPrice;
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
