/**
 * SpotEngine — Canonical SPOT runtime orchestrator.
 *
 * This is the SINGLE OWNER of SPOT trading decisions.
 * It orchestrates the existing modules:
 *   MarketData → SpotMarketContext → SpotRegimeContext → SPOT_CANONICAL
 *   → SpotEntryIntent → SpotRiskManager → SpotExecutionAdapter
 *   → SpotPosition → SpotExitPolicy → SpotAuditTracker
 *
 * Responsibilities:
 *   1. Get active pairs
 *   2. Build SpotMarketContext per pair
 *   3. Evaluate SPOT_CANONICAL strategy
 *   4. Create/re-evaluate SpotEntryIntent
 *   5. Execute SpotRiskManager sizing
 *   6. Execute via SpotExecutionAdapter (SHADOW only during refactor)
 *   7. Persist position to DB (open_positions)
 *   8. Update open positions (exit evaluation)
 *   9. Close/persist closed trades (trades table)
 *  10. Update SpotAuditTracker
 *  11. Log structured events
 *
 * INVARIANTS:
 *   - SPOT_RUNTIME_OWNER = "SpotEngine"
 *   - When SPOT is active, old Normal/DRY engines must NOT execute on same pairs
 *   - SHADOW never calls exchange.placeOrder()
 *   - REAL is blocked (REAL_ACTIVATION_ALLOWED = false)
 *   - executionMode is persisted in DB, not in-memory
 */

import { db } from "../../db";
import { sql } from "drizzle-orm";
import { ExecutionMode, REAL_ACTIVATION_ALLOWED, SPOT_POLICY_VERSION,
  type SpotPosition, type SpotMarketContext, type SpotEntryIntent,
  type SpotExecutionIntent, type SpotExitState, type SpotExitDecision,
  type SpotExecutionResult,
  SetupTag, Regime, RegimeDirection, MacroBias } from "./spotTypes";
import { loadExecutionMode, saveExecutionMode, getCachedExecutionMode } from "./spotExecutionModeStore";
import { buildSpotMarketContext } from "./spotMarketContext";
import { evaluateSpotCanonical, type SpotSignalResult } from "./spotCanonicalStrategy";
import { createEntryIntent, evaluateEntryIntent, SpotEntryIntentStore,
  DEFAULT_ANTI_LATE_ENTRY_CONFIG, type IntentEvaluationResult } from "./spotEntryIntent";
import { evaluateSizing, DEFAULT_SPOT_RISK_CONFIG, type SizingResult } from "./spotRiskManager";
import { createExecutionAdapter, type SpotExecutionAdapter } from "./spotExecutionAdapter";
import { evaluateExit, createExitState, DEFAULT_SPOT_EXIT_CONFIG, computeRMultiple } from "./spotExitPolicy";
import { SpotAuditTracker, type SpotAuditMetrics, type ExitAuditMetrics } from "./spotAuditTracker";
import { computePnlBreakdown, getTradingFeeModel } from "./feeModel";
import { DataHealth } from "./candleTimestamp";

// ─── Constants ──────────────────────────────────────────────────────────────

export const SPOT_RUNTIME_OWNER = "SpotEngine";
const SCAN_INTERVAL_MS = 60_000; // 60 seconds
const MAX_OPEN_POSITIONS = 10;

// ─── State ──────────────────────────────────────────────────────────────────

interface OpenPositionRow {
  lotId: string;
  pair: string;
  entryPrice: number;
  amount: number;
  qtyRemaining: number;
  highestPrice: number;
  entryFee: number;
  entryStrategyId: string;
  entrySignalTf: string;
  signalConfidence: number;
  signalReason: string;
  executionMode: string;
  policyVersion: string | null;
  setupTag: string | null;
  signalId: string | null;
  marketContextId: string | null;
  regimeAtEntry: string | null;
  directionAtEntry: string | null;
  macroAtEntry: string | null;
  atrPctAtEntry: number | null;
  initialStopPrice: number | null;
  initialStopDistancePct: number | null;
  initialStopDistanceUsd: number | null;
  riskUsd: number | null;
  mfe: number;
  mae: number;
  mfeR: number;
  maeR: number;
  sgBreakEvenActivated: boolean;
  sgTrailingActivated: boolean;
  sgCurrentStopPrice: number | null;
  openedAt: number;
}

// In-memory state (backed by DB for persistence)
const intentStore = new SpotEntryIntentStore();
const auditTracker = new SpotAuditTracker();
const exitStates = new Map<string, SpotExitState>();
let scanIntervalId: NodeJS.Timeout | null = null;
let isScanning = false;
let lastScanTime = 0;
let lastScanResults: Array<{ pair: string; signal: string; reason: string; mode: string }> = [];

// ─── Execution Mode ─────────────────────────────────────────────────────────

/**
 * Get current execution mode from DB (cached).
 */
export async function getExecutionMode(): Promise<ExecutionMode> {
  return loadExecutionMode();
}

/**
 * Set execution mode (persisted to DB).
 * REAL is blocked.
 */
export async function setExecutionMode(mode: ExecutionMode): Promise<ExecutionMode> {
  if (mode === ExecutionMode.REAL && !REAL_ACTIVATION_ALLOWED) {
    throw new Error("REAL execution mode is not authorized. REAL_ACTIVATION_ALLOWED=false.");
  }
  await saveExecutionMode(mode);
  if (mode === ExecutionMode.OFF) {
    // Clear all intents when switching to OFF
    for (const intent of intentStore.getAll()) {
      intentStore.remove(intent.pair);
    }
  }
  console.log(`[SpotEngine] Execution mode set to ${mode}`);
  return mode;
}

/**
 * Check if SpotEngine should be running.
 */
export function isSpotActive(): boolean {
  const mode = getCachedExecutionMode();
  return mode === ExecutionMode.SHADOW || mode === ExecutionMode.REAL;
}

// ─── Scan Cycle ─────────────────────────────────────────────────────────────

/**
 * Start the SpotEngine scan loop.
 */
export async function startSpotEngine(): Promise<void> {
  if (scanIntervalId) {
    console.log("[SpotEngine] Already running");
    return;
  }

  const mode = await getExecutionMode();
  if (mode === ExecutionMode.OFF) {
    console.log("[SpotEngine] Execution mode is OFF, not starting");
    return;
  }

  console.log(`[SpotEngine] Starting with mode=${mode}, owner=${SPOT_RUNTIME_OWNER}`);

  // Load open positions from DB
  await loadOpenPositionsFromDB();

  // Start scan loop
  scanIntervalId = setInterval(() => runScanCycle().catch(console.error), SCAN_INTERVAL_MS);

  // Run first scan immediately
  runScanCycle().catch(console.error);
}

/**
 * Stop the SpotEngine scan loop.
 */
export function stopSpotEngine(): void {
  if (scanIntervalId) {
    clearInterval(scanIntervalId);
    scanIntervalId = null;
    console.log("[SpotEngine] Stopped");
  }
}

/**
 * Single scan cycle: evaluate all active pairs.
 */
async function runScanCycle(): Promise<void> {
  if (isScanning) {
    console.log("[SpotEngine] Scan already in progress, skipping");
    return;
  }

  const mode = await getExecutionMode();
  if (mode === ExecutionMode.OFF) {
    return;
  }

  isScanning = true;
  lastScanTime = Date.now();
  const scanId = `scan-${lastScanTime.toString(36)}`;
  console.log(`[SpotEngine] Scan ${scanId} started, mode=${mode}`);

  try {
    // Get active pairs from bot_config
    const pairs = await getActivePairs();
    if (pairs.length === 0) {
      console.log("[SpotEngine] No active pairs configured");
      lastScanResults = [];
      return;
    }

    const results: Array<{ pair: string; signal: string; reason: string; mode: string }> = [];

    // Process each pair
    for (const pair of pairs) {
      try {
        const result = await scanPair(pair, mode);
        results.push(result);
      } catch (error: any) {
        console.error(`[SpotEngine] Error scanning ${pair}:`, error.message);
        results.push({ pair, signal: "ERROR", reason: error.message, mode });
      }
    }

    lastScanResults = results;
    console.log(`[SpotEngine] Scan ${scanId} completed: ${results.length} pairs processed`);
  } finally {
    isScanning = false;
  }
}

/**
 * Scan a single pair: build context, evaluate strategy, manage positions.
 */
async function scanPair(pair: string, mode: ExecutionMode): Promise<{ pair: string; signal: string; reason: string; mode: string }> {
  // 1. Build market context
  let ctx: SpotMarketContext;
  try {
    ctx = await buildSpotMarketContext({ pair });
  } catch (error: any) {
    return { pair, signal: "SKIP", reason: `MarketData error: ${error.message}`, mode };
  }

  // 2. Check data health
  if (ctx.dataHealth === DataHealth.STALE || ctx.dataHealth === DataHealth.INSUFFICIENT) {
    // Still manage open positions even with stale data (for exit safety)
    await manageOpenPositions(pair, ctx, mode);
    return { pair, signal: "HOLD", reason: `DataHealth=${ctx.dataHealth}`, mode };
  }

  // 3. Manage existing open positions for this pair (exit evaluation)
  await manageOpenPositions(pair, ctx, mode);

  // 4. Check for new entry signal
  const signal = evaluateSpotCanonical(ctx);

  if (signal.signal === "BUY" && signal.setupTag) {
    // Create entry intent
    const intent = createEntryIntent(signal, ctx);

    // Check if we already have an active intent for this pair
    const existing = intentStore.get(pair);
    if (!existing) {
      intentStore.put(intent);
      console.log(`[SpotEngine] Entry intent created for ${pair}, setup=${signal.setupTag}, confidence=${signal.confidence}`);
    }

    return { pair, signal: "BUY", reason: signal.reason, mode };
  }

  // 5. Evaluate existing intents
  const activeIntent = intentStore.get(pair);
  if (activeIntent && activeIntent.state !== "EXECUTED" && activeIntent.state !== "EXPIRED" && activeIntent.state !== "INVALIDATED") {
    const evaluation = evaluateEntryIntent(activeIntent, ctx);
    activeIntent.state = evaluation.newState;
    activeIntent.lastBlockReason = evaluation.reason;
    activeIntent.lastEvaluatedAt = Date.now();
    intentStore.update(activeIntent);

    if (evaluation.shouldExecute) {
      // Execute entry
      const executed = await executeEntry(activeIntent, ctx, mode);
      if (executed) {
        activeIntent.state = "EXECUTED" as any;
        intentStore.update(activeIntent);
        return { pair, signal: "EXECUTED", reason: "Entry executed", mode };
      }
    }

    return { pair, signal: "INTENT", reason: evaluation.reason, mode };
  }

  return { pair, signal: "HOLD", reason: signal.reason || signal.blockReason || "No signal", mode };
}

/**
 * Execute entry: sizing → adapter → persist position.
 */
async function executeEntry(intent: SpotEntryIntent, ctx: SpotMarketContext, mode: ExecutionMode): Promise<boolean> {
  // Get available capital
  const availableCapital = await getAvailableCapital();

  // Count open lots for this pair
  const openLots = await countOpenLotsForPair(intent.pair);

  // Sizing
  const sizing = evaluateSizing(ctx, intent, availableCapital, openLots);
  if (!sizing.approved) {
    console.log(`[SpotEngine] Entry blocked for ${intent.pair}: ${sizing.reason}`);
    return false;
  }

  // Create execution intent
  const execIntent: SpotExecutionIntent = {
    intentId: `ei-${intent.signalId}-${Date.now().toString(36)}`,
    pair: intent.pair,
    side: "BUY",
    orderType: "MARKET",
    volume: sizing.volume,
    price: null,
    notionalUsd: sizing.notionalUsd,
    reason: `SPOT entry: ${intent.setupTag}`,
    reasonType: "ENTRY",
    positionLotId: null,
    executionMode: mode,
    ttlMs: 30_000,
    createdAt: Date.now(),
  };

  // Execute via adapter
  const adapter = createExecutionAdapter(mode);
  const result = await adapter.executeEntry(execIntent, ctx);

  if (!result.success || result.fillPrice === null) {
    console.error(`[SpotEngine] Entry failed for ${intent.pair}: ${result.error}`);
    return false;
  }

  // Create position
  const lotId = `spot-${intent.pair}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  const now = Date.now();

  const position: SpotPosition = {
    lotId,
    pair: intent.pair,
    amount: result.fillVolume ?? sizing.volume,
    qtyRemaining: result.fillVolume ?? sizing.volume,
    entryPrice: result.fillPrice,
    entryFee: result.feeUsd ?? 0,
    entryFeeQuality: result.fillQuality,
    highestPrice: result.fillPrice,
    openedAt: now,
    entryStrategyId: "SPOT_CANONICAL",
    entrySignalTf: "15m",
    signalConfidence: 0,
    signalReason: intent.setupTag,
    setupTag: intent.setupTag,
    signalId: intent.signalId,
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
    executionMode: mode,
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

  // Persist to DB
  await persistOpenPosition(position, result);

  // Init audit tracking
  auditTracker.initPosition(position);

  // Init exit state
  const exitState = createExitState(position);
  exitStates.set(lotId, exitState);

  console.log(`[SpotEngine] Position opened: ${lotId} ${intent.pair} @ ${result.fillPrice}, mode=${mode}`);
  return true;
}

/**
 * Manage open positions for a pair: update MFE/MAE, evaluate exits, close if needed.
 */
async function manageOpenPositions(pair: string, ctx: SpotMarketContext, mode: ExecutionMode): Promise<void> {
  const positions = await getOpenPositionsForPair(pair);

  for (const row of positions) {
    if (row.executionMode !== "SHADOW" && row.executionMode !== "REAL") continue;

    const position = rowToPosition(row);
    const currentPrice = ctx.ticker.last;

    // Update audit tracker
    auditTracker.updatePrice(position, currentPrice, Date.now());

    // Update highest price in DB
    if (currentPrice > row.highestPrice) {
      await db.execute(sql`
        UPDATE open_positions SET highest_price = ${currentPrice}, updated_at = NOW()
        WHERE lot_id = ${row.lotId}
      `);
    }

    // Get or create exit state
    let exitState = exitStates.get(row.lotId);
    if (!exitState) {
      exitState = createExitState(position);
      exitStates.set(row.lotId, exitState);
    }

    // Evaluate exit
    const exitDecision = evaluateExit(position, exitState, ctx);
    if (exitDecision.shouldExit && exitDecision.reasonType) {
      await closePosition(position, exitDecision, ctx, mode);

      // Clean up state
      exitStates.delete(row.lotId);
      intentStore.remove(pair);
    }
  }
}

/**
 * Close a position: execute exit, persist trade, finalize audit.
 */
async function closePosition(
  position: SpotPosition,
  exitDecision: SpotExitDecision,
  ctx: SpotMarketContext,
  mode: ExecutionMode,
): Promise<void> {
  const adapter = createExecutionAdapter(mode);

  const execIntent: SpotExecutionIntent = {
    intentId: `exit-${position.lotId}-${Date.now().toString(36)}`,
    pair: position.pair,
    side: "SELL",
    orderType: "MARKET",
    volume: position.qtyRemaining,
    price: null,
    notionalUsd: position.notionalUsd,
    reason: exitDecision.reason,
    reasonType: exitDecision.reasonType!,
    positionLotId: position.lotId,
    executionMode: mode,
    ttlMs: 30_000,
    createdAt: Date.now(),
  };

  const result = await adapter.executeExit(execIntent, ctx);
  if (!result.success || result.fillPrice === null) {
    console.error(`[SpotEngine] Exit failed for ${position.lotId}: ${result.error}`);
    return;
  }

  // Compute PnL (computePnlBreakdown computes exitFee internally)
  const pnl = computePnlBreakdown({
    entryPrice: position.entryPrice,
    exitPrice: result.fillPrice!,
    volume: position.qtyRemaining,
    entryFeeUsd: position.entryFee,
  });

  // Finalize audit
  const exitAudit = auditTracker.finalizeExit(
    position,
    result.fillPrice,
    `${exitDecision.reasonType}:${exitDecision.reason}`,
    Date.now(),
  );
  const auditMetrics = auditTracker.getMetrics(position.lotId);

  // Persist closed trade to trades table
  await persistClosedTrade(position, result, pnl, exitDecision, auditMetrics ?? auditTracker.getMetrics(position.lotId));

  // Remove from open_positions
  await db.execute(sql`
    DELETE FROM open_positions WHERE lot_id = ${position.lotId}
  `);

  const am = auditMetrics ?? auditTracker.getMetrics(position.lotId);
  console.log(
    `[SpotEngine] Position closed: ${position.lotId} ${position.pair} @ ${result.fillPrice}, ` +
    `reason=${exitDecision.reasonType}, netPnl=$${pnl.netPnlUsd.toFixed(2)}, ` +
    `MFE=$${am?.mfeUsd ?? 0}, MAE=$${am?.maeUsd ?? 0}`
  );
}

// ─── DB Operations ──────────────────────────────────────────────────────────

/**
 * Get active pairs from bot_config.
 */
async function getActivePairs(): Promise<string[]> {
  try {
    const result = await db.execute(sql`
      SELECT active_pairs FROM bot_config LIMIT 1
    `);
    if (result.rows.length === 0) return [];
    const pairs = result.rows[0].active_pairs as string[] | null;
    return pairs ?? [];
  } catch (error) {
    console.error("[SpotEngine] Failed to get active pairs:", error);
    return [];
  }
}

/**
 * Get available capital (simplified: uses cached balance or 10000 for SHADOW).
 */
async function getAvailableCapital(): Promise<number> {
  if (getCachedExecutionMode() === ExecutionMode.SHADOW) {
    return 10_000; // SHADOW sandbox capital
  }
  try {
    const result = await db.execute(sql`
      SELECT COALESCE(
        (SELECT value FROM market_data WHERE pair = 'USD' ORDER BY timestamp DESC LIMIT 1),
        10000
      ) as capital
    `);
    return Number(result.rows[0]?.capital ?? 10000);
  } catch {
    return 10_000;
  }
}

/**
 * Count open positions for a pair.
 */
async function countOpenLotsForPair(pair: string): Promise<number> {
  try {
    const result = await db.execute(sql`
      SELECT COUNT(*) as count FROM open_positions
      WHERE pair = ${pair} AND status != 'CLOSED'
    `);
    return Number(result.rows[0]?.count ?? 0);
  } catch {
    return 0;
  }
}

/**
 * Get open positions for a pair from DB.
 */
async function getOpenPositionsForPair(pair: string): Promise<OpenPositionRow[]> {
  try {
    const result = await db.execute(sql`
      SELECT
        lot_id, pair, entry_price, amount, qty_remaining, highest_price,
        entry_fee, entry_strategy_id, entry_signal_tf, signal_confidence,
        signal_reason, execution_mode, policy_version, setup_tag, signal_id,
        market_context_id, regime_at_entry, direction_at_entry, macro_at_entry,
        atr_pct_at_entry, initial_stop_price, initial_stop_distance_pct,
        initial_stop_distance_usd, risk_usd, mfe, mae, mfe_r, mae_r,
        sg_break_even_activated, sg_trailing_activated, sg_current_stop_price,
        EXTRACT(EPOCH FROM opened_at) * 1000 as opened_at_ms
      FROM open_positions
      WHERE pair = ${pair} AND status != 'CLOSED'
    `);
    return result.rows.map((r: any) => ({
      lotId: r.lot_id,
      pair: r.pair,
      entryPrice: Number(r.entry_price),
      amount: Number(r.amount),
      qtyRemaining: r.qty_remaining ? Number(r.qty_remaining) : Number(r.amount),
      highestPrice: Number(r.highest_price),
      entryFee: Number(r.entry_fee ?? 0),
      entryStrategyId: r.entry_strategy_id,
      entrySignalTf: r.entry_signal_tf,
      signalConfidence: Number(r.signal_confidence ?? 0),
      signalReason: r.signal_reason,
      executionMode: r.execution_mode ?? "REAL",
      policyVersion: r.policy_version,
      setupTag: r.setup_tag,
      signalId: r.signal_id,
      marketContextId: r.market_context_id,
      regimeAtEntry: r.regime_at_entry,
      directionAtEntry: r.direction_at_entry,
      macroAtEntry: r.macro_at_entry,
      atrPctAtEntry: r.atr_pct_at_entry ? Number(r.atr_pct_at_entry) : null,
      initialStopPrice: r.initial_stop_price ? Number(r.initial_stop_price) : null,
      initialStopDistancePct: r.initial_stop_distance_pct ? Number(r.initial_stop_distance_pct) : null,
      initialStopDistanceUsd: r.initial_stop_distance_usd ? Number(r.initial_stop_distance_usd) : null,
      riskUsd: r.risk_usd ? Number(r.risk_usd) : null,
      mfe: Number(r.mfe ?? 0),
      mae: Number(r.mae ?? 0),
      mfeR: Number(r.mfe_r ?? 0),
      maeR: Number(r.mae_r ?? 0),
      sgBreakEvenActivated: Boolean(r.sg_break_even_activated),
      sgTrailingActivated: Boolean(r.sg_trailing_activated),
      sgCurrentStopPrice: r.sg_current_stop_price ? Number(r.sg_current_stop_price) : null,
      openedAt: Number(r.opened_at_ms),
    }));
  } catch (error) {
    console.error(`[SpotEngine] Failed to get open positions for ${pair}:`, error);
    return [];
  }
}

/**
 * Load all open positions from DB on startup.
 */
async function loadOpenPositionsFromDB(): Promise<void> {
  try {
    const result = await db.execute(sql`
      SELECT lot_id, pair FROM open_positions
      WHERE execution_mode IN ('SHADOW', 'REAL') AND status != 'CLOSED'
    `);
    console.log(`[SpotEngine] Loaded ${result.rows.length} open positions from DB`);

    // Rebuild exit states for loaded positions
    for (const row of result.rows) {
      const positions = await getOpenPositionsForPair(row.pair as string);
      for (const p of positions) {
        if (p.lotId === row.lot_id) {
          const position = rowToPosition(p);
          auditTracker.initPosition(position);
          const exitState = createExitState(position);
          exitStates.set(p.lotId, exitState);
        }
      }
    }
  } catch (error) {
    console.error("[SpotEngine] Failed to load open positions:", error);
  }
}

/**
 * Persist a new open position to DB.
 */
async function persistOpenPosition(position: SpotPosition, execResult: SpotExecutionResult): Promise<void> {
  await db.execute(sql`
    INSERT INTO open_positions (
      lot_id, exchange, pair, entry_price, amount, qty_remaining, highest_price,
      entry_strategy_id, entry_signal_tf, signal_confidence, signal_reason,
      entry_fee, status, opened_at,
      execution_mode, policy_version, setup_tag, signal_id, market_context_id,
      regime_at_entry, direction_at_entry, macro_at_entry, atr_pct_at_entry,
      initial_stop_price, initial_stop_distance_pct, initial_stop_distance_usd,
      risk_usd, mfe, mae, mfe_r, mae_r,
      sg_break_even_activated, sg_trailing_activated, sg_current_stop_price
    ) VALUES (
      ${position.lotId}, 'spot', ${position.pair}, ${position.entryPrice},
      ${position.amount}, ${position.qtyRemaining}, ${position.highestPrice},
      ${position.entryStrategyId}, ${position.entrySignalTf},
      ${position.signalConfidence}, ${position.signalReason},
      ${position.entryFee}, 'OPEN', NOW(),
      ${position.executionMode}, ${position.policyVersion},
      ${position.setupTag}, ${position.signalId}, ${position.marketContextId},
      ${position.regimeAtEntry}, ${position.directionAtEntry}, ${position.macroAtEntry},
      ${position.atrPctAtEntry}, ${position.initialStopPrice},
      ${position.initialStopDistancePct}, ${position.initialStopDistanceUsd},
      ${position.riskUsd}, 0, 0, 0, 0,
      false, false, ${position.sgCurrentStopPrice}
    )
    ON CONFLICT (lot_id) DO NOTHING
  `);
}

/**
 * Persist a closed trade to the trades table.
 */
async function persistClosedTrade(
  position: SpotPosition,
  execResult: SpotExecutionResult,
  pnl: { grossPnlUsd: number; netPnlUsd: number; entryFeeUsd: number; exitFeeUsd: number; executionCostUsd: number },
  exitDecision: SpotExitDecision,
  auditMetrics: SpotAuditMetrics | null,
): Promise<void> {
  const tradeId = `spot-trade-${position.lotId}`;
  const holdTimeMinutes = Math.round((Date.now() - position.openedAt) / 60000);

  await db.execute(sql`
    INSERT INTO trades (
      trade_id, exchange, origin, executed_by_bot, pair, type, price, amount,
      status, entry_price, realized_pnl_usd, realized_pnl_pct, executed_at,
      execution_mode, policy_version, setup_tag, signal_id, market_context_id,
      gross_pnl_usd, entry_fee_usd, exit_fee_usd, execution_cost_usd, net_pnl_usd,
      fee_quality, mfe, mae, mfe_r, mae_r, profit_capture_pct, exit_reason_type,
      lot_id, hold_time_minutes
    ) VALUES (
      ${tradeId}, 'spot', 'spot_engine', true, ${position.pair}, 'sell',
      ${execResult.fillPrice}, ${position.qtyRemaining},
      'closed', ${position.entryPrice}, ${pnl.netPnlUsd},
      ${position.entryPrice > 0 ? ((execResult.fillPrice! - position.entryPrice) / position.entryPrice) * 100 : 0},
      NOW(),
      ${position.executionMode}, ${position.policyVersion},
      ${position.setupTag}, ${position.signalId}, ${position.marketContextId},
      ${pnl.grossPnlUsd}, ${pnl.entryFeeUsd}, ${pnl.exitFeeUsd}, ${pnl.executionCostUsd},
      ${pnl.netPnlUsd}, ${execResult.fillQuality},
      ${auditMetrics?.mfeUsd ?? 0}, ${auditMetrics?.maeUsd ?? 0},
      ${auditMetrics?.mfeR ?? 0}, ${auditMetrics?.maeR ?? 0},
      ${auditMetrics?.exitAudit?.profitCapturePct ?? null},
      ${exitDecision.reasonType}, ${position.lotId}, ${holdTimeMinutes}
    )
    ON CONFLICT (exchange, pair, trade_id) DO NOTHING
  `);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function rowToPosition(row: OpenPositionRow): SpotPosition {
  return {
    lotId: row.lotId,
    pair: row.pair,
    amount: row.amount,
    qtyRemaining: row.qtyRemaining,
    entryPrice: row.entryPrice,
    entryFee: row.entryFee,
    entryFeeQuality: "ESTIMATED" as any,
    highestPrice: row.highestPrice,
    openedAt: row.openedAt,
    entryStrategyId: row.entryStrategyId,
    entrySignalTf: row.entrySignalTf,
    signalConfidence: row.signalConfidence,
    signalReason: row.signalReason ?? "",
    setupTag: (row.setupTag as SetupTag) ?? SetupTag.PULLBACK_CONTINUATION,
    signalId: row.signalId ?? "",
    marketContextId: row.marketContextId ?? "",
    regimeAtEntry: (row.regimeAtEntry as Regime) ?? Regime.RANGE,
    directionAtEntry: (row.directionAtEntry as RegimeDirection) ?? RegimeDirection.NEUTRAL,
    macroAtEntry: (row.macroAtEntry as MacroBias) ?? MacroBias.NEUTRAL,
    atrPctAtEntry: row.atrPctAtEntry ?? 0,
    initialStopPrice: row.initialStopPrice ?? 0,
    initialStopDistancePct: row.initialStopDistancePct ?? 0,
    initialStopDistanceUsd: row.initialStopDistanceUsd ?? 0,
    riskUsd: row.riskUsd ?? 0,
    notionalUsd: row.entryPrice * row.amount,
    executionMode: (row.executionMode as ExecutionMode) ?? ExecutionMode.SHADOW,
    policyVersion: row.policyVersion ?? SPOT_POLICY_VERSION,
    sgBreakEvenActivated: row.sgBreakEvenActivated,
    sgTrailingActivated: row.sgTrailingActivated,
    sgScaleOutDone: false,
    sgCurrentStopPrice: row.sgCurrentStopPrice ?? row.initialStopPrice ?? 0,
    mfe: row.mfe,
    mae: row.mae,
    mfeR: row.mfeR,
    maeR: row.maeR,
  };
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Get last scan results for API/status.
 */
export function getLastScanResults(): typeof lastScanResults {
  return lastScanResults;
}

/**
 * Get last scan time.
 */
export function getLastScanTime(): number {
  return lastScanTime;
}

/**
 * Get the intent store instance.
 */
export function getIntentStore(): SpotEntryIntentStore {
  return intentStore;
}

/**
 * Get the audit tracker instance.
 */
export function getAuditTracker(): SpotAuditTracker {
  return auditTracker;
}

/**
 * Get open positions from DB (for API).
 */
export async function getOpenPositions(): Promise<OpenPositionRow[]> {
  try {
    const result = await db.execute(sql`
      SELECT
        lot_id, pair, entry_price, amount, qty_remaining, highest_price,
        entry_fee, entry_strategy_id, entry_signal_tf, signal_confidence,
        signal_reason, execution_mode, policy_version, setup_tag, signal_id,
        market_context_id, regime_at_entry, direction_at_entry, macro_at_entry,
        atr_pct_at_entry, initial_stop_price, initial_stop_distance_pct,
        initial_stop_distance_usd, risk_usd, mfe, mae, mfe_r, mae_r,
        sg_break_even_activated, sg_trailing_activated, sg_current_stop_price,
        EXTRACT(EPOCH FROM opened_at) * 1000 as opened_at_ms
      FROM open_positions
      WHERE execution_mode IN ('SHADOW', 'REAL') AND status != 'CLOSED'
      ORDER BY opened_at DESC
    `);
    return result.rows.map((r: any) => ({
      lotId: r.lot_id,
      pair: r.pair,
      entryPrice: Number(r.entry_price),
      amount: Number(r.amount),
      qtyRemaining: r.qty_remaining ? Number(r.qty_remaining) : Number(r.amount),
      highestPrice: Number(r.highest_price),
      entryFee: Number(r.entry_fee ?? 0),
      entryStrategyId: r.entry_strategy_id,
      entrySignalTf: r.entry_signal_tf,
      signalConfidence: Number(r.signal_confidence ?? 0),
      signalReason: r.signal_reason,
      executionMode: r.execution_mode ?? "REAL",
      policyVersion: r.policy_version,
      setupTag: r.setup_tag,
      signalId: r.signal_id,
      marketContextId: r.market_context_id,
      regimeAtEntry: r.regime_at_entry,
      directionAtEntry: r.direction_at_entry,
      macroAtEntry: r.macro_at_entry,
      atrPctAtEntry: r.atr_pct_at_entry ? Number(r.atr_pct_at_entry) : null,
      initialStopPrice: r.initial_stop_price ? Number(r.initial_stop_price) : null,
      initialStopDistancePct: r.initial_stop_distance_pct ? Number(r.initial_stop_distance_pct) : null,
      initialStopDistanceUsd: r.initial_stop_distance_usd ? Number(r.initial_stop_distance_usd) : null,
      riskUsd: r.risk_usd ? Number(r.risk_usd) : null,
      mfe: Number(r.mfe ?? 0),
      mae: Number(r.mae ?? 0),
      mfeR: Number(r.mfe_r ?? 0),
      maeR: Number(r.mae_r ?? 0),
      sgBreakEvenActivated: Boolean(r.sg_break_even_activated),
      sgTrailingActivated: Boolean(r.sg_trailing_activated),
      sgCurrentStopPrice: r.sg_current_stop_price ? Number(r.sg_current_stop_price) : null,
      openedAt: Number(r.opened_at_ms),
    }));
  } catch (error) {
    console.error("[SpotEngine] Failed to get open positions:", error);
    return [];
  }
}

/**
 * Get closed trades from DB (for API).
 */
export async function getClosedTrades(limit: number = 100): Promise<any[]> {
  try {
    const result = await db.execute(sql`
      SELECT
        trade_id, pair, type, price, amount, entry_price,
        realized_pnl_usd, realized_pnl_pct, executed_at, created_at,
        execution_mode, policy_version, setup_tag, signal_id, market_context_id,
        gross_pnl_usd, entry_fee_usd, exit_fee_usd, execution_cost_usd, net_pnl_usd,
        fee_quality, mfe, mae, mfe_r, mae_r, profit_capture_pct, exit_reason_type,
        lot_id, hold_time_minutes
      FROM trades
      WHERE execution_mode IN ('SHADOW', 'REAL')
      ORDER BY executed_at DESC NULLS LAST
      LIMIT ${limit}
    `);
    return result.rows;
  } catch (error) {
    console.error("[SpotEngine] Failed to get closed trades:", error);
    return [];
  }
}

/**
 * Get summary stats from DB (for API).
 */
export async function getSummaryStats(): Promise<any> {
  try {
    const result = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE executed_at IS NOT NULL) as total_trades,
        COUNT(*) FILTER (WHERE net_pnl_usd > 0) as winning_trades,
        COUNT(*) FILTER (WHERE net_pnl_usd <= 0 AND executed_at IS NOT NULL) as losing_trades,
        COALESCE(SUM(net_pnl_usd), 0) as net_pnl_usd,
        COALESCE(SUM(gross_pnl_usd), 0) as gross_pnl_usd,
        COALESCE(SUM(CASE WHEN net_pnl_usd > 0 THEN net_pnl_usd ELSE 0 END), 0) as gross_profit,
        COALESCE(SUM(CASE WHEN net_pnl_usd < 0 THEN net_pnl_usd ELSE 0 END), 0) as gross_loss,
        COALESCE(AVG(hold_time_minutes), 0) as avg_hold_time,
        COALESCE(MAX(net_pnl_usd), 0) as best_trade,
        COALESCE(MIN(net_pnl_usd), 0) as worst_trade,
        COALESCE(AVG(mfe), 0) as avg_mfe,
        COALESCE(AVG(mae), 0) as avg_mae
      FROM trades
      WHERE execution_mode IN ('SHADOW', 'REAL')
    `);

    const row = result.rows[0] as any;
    const totalTrades = Number(row?.total_trades ?? 0);
    const winningTrades = Number(row?.winning_trades ?? 0);
    const grossProfit = Number(row?.gross_profit ?? 0);
    const grossLoss = Math.abs(Number(row?.gross_loss ?? 0));

    const openCount = await db.execute(sql`
      SELECT COUNT(*) as count FROM open_positions
      WHERE execution_mode IN ('SHADOW', 'REAL') AND status != 'CLOSED'
    `);

    return {
      totalTrades,
      openPositions: Number(openCount.rows[0]?.count ?? 0),
      netPnlUsd: Number(row?.net_pnl_usd ?? 0),
      grossPnlUsd: Number(row?.gross_pnl_usd ?? 0),
      winRate: totalTrades > 0 ? winningTrades / totalTrades : 0,
      avgHoldTimeMinutes: Number(row?.avg_hold_time ?? 0),
      bestTrade: Number(row?.best_trade ?? 0),
      worstTrade: Number(row?.worst_trade ?? 0),
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0),
      avgMfe: Number(row?.avg_mfe ?? 0),
      avgMae: Number(row?.avg_mae ?? 0),
    };
  } catch (error) {
    console.error("[SpotEngine] Failed to get summary stats:", error);
    return {
      totalTrades: 0, openPositions: 0, netPnlUsd: 0, grossPnlUsd: 0,
      winRate: 0, avgHoldTimeMinutes: 0, bestTrade: 0, worstTrade: 0,
      profitFactor: 0, avgMfe: 0, avgMae: 0,
    };
  }
}
