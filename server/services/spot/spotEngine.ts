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
import { ExchangeFactory } from "../exchanges/ExchangeFactory";
import { loadExecutionMode, saveExecutionMode, getCachedExecutionMode, invalidateExecutionModeCache } from "./spotExecutionModeStore";
import { buildSpotMarketContext } from "./spotMarketContext";
import { evaluateSpotCanonical, type SpotSignalResult } from "./spotCanonicalStrategy";
import { createEntryIntent, evaluateEntryIntent, SpotEntryIntentStore,
  DEFAULT_ANTI_LATE_ENTRY_CONFIG, type IntentEvaluationResult } from "./spotEntryIntent";
import { evaluateSizing, DEFAULT_SPOT_RISK_CONFIG, type SizingResult } from "./spotRiskManager";
import { createExecutionAdapter, type SpotExecutionAdapter } from "./spotExecutionAdapter";
import { evaluateExit, createExitState, restoreExitState, DEFAULT_SPOT_EXIT_CONFIG, computeRMultiple } from "./spotExitPolicy";
import { SpotAuditTracker, type SpotAuditMetrics, type ExitAuditMetrics } from "./spotAuditTracker";
import { computePnlBreakdown, getTradingFeeModel } from "./feeModel";
import { DataHealth } from "./candleTimestamp";
import { logActivity } from "./spotActivityLogger";
import {
  persistSubmissionIntent,
  updateSubmissionResult,
  generateClientOrderId,
  hasExistingSubmission,
  getCachedRecord,
  loadPendingRealOrders,
  countPendingRealOrderIntents,
  releaseReservationExact,
  hasUnresolvedRealExecution,
  RealIntentPersistenceError,
  RealOrderStatePersistenceError,
  RealSubmissionAmbiguousError,
  type CreateSubmissionIntentParams,
  _clearCacheForTest as _clearIntentCacheForTest,
} from "./spotOrderIntentStore";

// R8: Re-export ownership from pure module (no heavy deps)
import {
  isSpotRuntimeOwner as _isSpotRuntimeOwner,
  SPOT_RUNTIME_OWNER as _SPOT_RUNTIME_OWNER,
  SPOT_ENGINE_OWNER as _SPOT_ENGINE_OWNER,
} from "./spotOwnership";

// ─── Engine Owner & Provenance ────────────────────────────────────────────────

export const SPOT_ENGINE_OWNER = _SPOT_ENGINE_OWNER;
export const SPOT_ORIGIN = "spot_engine" as const;

// ─── Constants ──────────────────────────────────────────────────────────────

export const SPOT_RUNTIME_OWNER = _SPOT_RUNTIME_OWNER;

const SCAN_INTERVAL_MS = 60_000; // 60 seconds
const MAX_OPEN_POSITIONS = 10;

// ─── Engine Runtime State ────────────────────────────────────────────────────

let engineRunning = false;
let entryScanningEnabled = true;
let positionSupervisorRunning = false;

// R10.4: Reconciler state — runs independently of global mode
let reconcilerIntervalId: NodeJS.Timeout | null = null;
let isReconciling = false;
let realReconcilerRunning = false;
const RECONCILER_INTERVAL_MS = 120_000; // 2 minutes

// ─── State ──────────────────────────────────────────────────────────────────

interface OpenPositionRow {
  lotId: string;
  pair: string;
  amount: number;
  qtyRemaining: number;
  entryPrice: number;
  highestPrice: number;
  entryFee: number;
  entryStrategyId: string | null;
  entrySignalTf: string | null;
  signalConfidence: number;
  signalReason: string | null;
  executionMode: string;
  policyVersion: string | null;
  engineOwner: string | null;
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
  breakEvenStopPrice: number | null;
  trailingStopPrice: number | null;
  trailingHighestPrice: number | null;
  lowestPrice: number | null;
  filledNotionalUsd: number | null;
  openedAt: number;
}

// In-memory state (backed by DB for persistence)
const intentStore = new SpotEntryIntentStore();
const auditTracker = new SpotAuditTracker();
const exitStates = new Map<string, SpotExitState>();
const signalResultCache = new Map<string, SpotSignalResult>();
let scanIntervalId: NodeJS.Timeout | null = null;
let supervisorIntervalId: NodeJS.Timeout | null = null;
let isScanning = false;
let isSupervising = false;
let lastScanTime = 0;
let lastScanResults: Array<{ pair: string; signal: string; reason: string; mode: string }> = [];

// ─── Shadow Capital Ledger ───────────────────────────────────────────────────

/**
 * Shadow Capital Ledger — DB-persistent.
 *
 * Accounting contract:
 *   equity = initialCapitalUsd + realizedNetPnlUsd
 *   available = equity - reservedUsd
 *
 * realizedNetPnlUsd is NET (already includes entry+exit fees).
 * totalFeesUsd is a METRIC ONLY — never subtracted from equity again.
 *
 * Example:
 *   initial = 10000
 *   BUY notional = 1000, entry fee = 0.90
 *   → reserved = 1000, fees = 0.90 (metric)
 *   Close: gross = 10, entry fee = 0.90, exit fee = 0.90
 *   → net = 8.20
 *   → reserved = 0, realizedNetPnl = 8.20
 *   → equity = 10008.20 (NOT 10006.40 — no double fee)
 */
interface ShadowLedger {
  initialCapitalUsd: number;
  reservedUsd: number;
  realizedNetPnlUsd: number;
  totalFeesUsd: number; // metric only
}

let shadowLedger: ShadowLedger = {
  initialCapitalUsd: 10_000,
  reservedUsd: 0,
  realizedNetPnlUsd: 0,
  totalFeesUsd: 0,
};

async function loadShadowLedger(): Promise<void> {
  try {
    const result = await db.execute(sql`
      SELECT spot_shadow_capital_usd,
             spot_shadow_reserved_usd,
             spot_shadow_realized_pnl_usd,
             spot_shadow_total_fees_usd
      FROM bot_config LIMIT 1
    `);
    if (result.rows.length > 0) {
      const r = result.rows[0];
      shadowLedger.initialCapitalUsd = Number(r.spot_shadow_capital_usd ?? 10_000);
      shadowLedger.reservedUsd = Number(r.spot_shadow_reserved_usd ?? 0);
      shadowLedger.realizedNetPnlUsd = Number(r.spot_shadow_realized_pnl_usd ?? 0);
      shadowLedger.totalFeesUsd = Number(r.spot_shadow_total_fees_usd ?? 0);
    }
  } catch { /* default */ }
}

function getShadowEquity(): number {
  return shadowLedger.initialCapitalUsd + shadowLedger.realizedNetPnlUsd;
}

function getShadowAvailableCapital(): number {
  return getShadowEquity() - shadowLedger.reservedUsd;
}

// ─── R4: Shared SQL helpers (accept tx or db) ───────────────────────────────

async function insertOpenPositionSql(
  executor: { execute: (q: any) => Promise<any> },
  position: SpotPosition,
  venue: string,
  filledNotionalUsd: number,
): Promise<{ rows: any[] }> {
  return await executor.execute(sql`
    INSERT INTO open_positions (
      lot_id, exchange, pair, entry_price, amount, qty_remaining, highest_price,
      entry_strategy_id, entry_signal_tf, signal_confidence, signal_reason,
      entry_fee, status, opened_at,
      execution_mode, policy_version, engine_owner, origin, setup_tag, signal_id, market_context_id,
      regime_at_entry, direction_at_entry, macro_at_entry, atr_pct_at_entry,
      initial_stop_price, initial_stop_distance_pct, initial_stop_distance_usd,
      risk_usd, mfe, mae, mfe_r, mae_r,
      sg_break_even_activated, sg_trailing_activated, sg_current_stop_price,
      break_even_stop_price, trailing_stop_price, trailing_highest_price, lowest_price,
      filled_notional_usd
    ) VALUES (
      ${position.lotId}, ${venue}, ${position.pair}, ${position.entryPrice},
      ${position.amount}, ${position.qtyRemaining}, ${position.highestPrice},
      ${position.entryStrategyId}, ${position.entrySignalTf},
      ${position.signalConfidence}, ${position.signalReason},
      ${position.entryFee}, 'OPEN', NOW(),
      ${position.executionMode}, ${position.policyVersion}, ${SPOT_ENGINE_OWNER}, ${SPOT_ORIGIN},
      ${position.setupTag}, ${position.signalId}, ${position.marketContextId},
      ${position.regimeAtEntry}, ${position.directionAtEntry}, ${position.macroAtEntry},
      ${position.atrPctAtEntry}, ${position.initialStopPrice},
      ${position.initialStopDistancePct}, ${position.initialStopDistanceUsd},
      ${position.riskUsd}, 0, 0, 0, 0,
      false, false, ${position.sgCurrentStopPrice},
      null, null, ${position.highestPrice}, ${position.entryPrice},
      ${filledNotionalUsd}
    )
    RETURNING lot_id
  `);
}

async function insertClosedTradeSql(
  executor: { execute: (q: any) => Promise<any> },
  position: SpotPosition,
  execResult: SpotExecutionResult,
  pnl: { grossPnlUsd: number; netPnlUsd: number; entryFeeUsd: number; exitFeeUsd: number; executionCostUsd: number },
  exitDecision: SpotExitDecision,
  auditMetrics: SpotAuditMetrics | null,
  venue: string,
): Promise<{ rows: any[] }> {
  const tradeId = `spot-trade-${position.lotId}`;
  const holdTimeMinutes = Math.round((Date.now() - position.openedAt) / 60000);
  return await executor.execute(sql`
    INSERT INTO trades (
      trade_id, exchange, origin, executed_by_bot, pair, type, price, amount,
      status, entry_price, realized_pnl_usd, realized_pnl_pct, executed_at,
      execution_mode, policy_version, engine_owner, setup_tag, signal_id, market_context_id,
      gross_pnl_usd, entry_fee_usd, exit_fee_usd, execution_cost_usd, net_pnl_usd,
      fee_quality, mfe, mae, mfe_r, mae_r, profit_capture_pct, exit_reason_type,
      lot_id, hold_time_minutes
    ) VALUES (
      ${tradeId}, ${venue}, ${SPOT_ORIGIN}, true, ${position.pair}, 'sell',
      ${execResult.fillPrice}, ${position.qtyRemaining},
      'closed', ${position.entryPrice}, ${pnl.netPnlUsd},
      ${position.entryPrice > 0 ? ((execResult.fillPrice! - position.entryPrice) / position.entryPrice) * 100 : 0},
      NOW(),
      ${position.executionMode}, ${position.policyVersion}, ${SPOT_ENGINE_OWNER},
      ${position.setupTag}, ${position.signalId}, ${position.marketContextId},
      ${pnl.grossPnlUsd}, ${pnl.entryFeeUsd}, ${pnl.exitFeeUsd}, ${pnl.executionCostUsd},
      ${pnl.netPnlUsd}, ${execResult.fillQuality},
      ${auditMetrics?.mfeUsd ?? 0}, ${auditMetrics?.maeUsd ?? 0},
      ${auditMetrics?.mfeR ?? 0}, ${auditMetrics?.maeR ?? 0},
      ${auditMetrics?.exitAudit?.profitCapturePct ?? null},
      ${exitDecision.reasonType}, ${position.lotId}, ${holdTimeMinutes}
    )
    RETURNING trade_id
  `);
}

// ─── R4: Atomic shadow entry — INSERT position + UPDATE ledger in ONE tx ─────

export async function persistShadowEntryAtomic(
  position: SpotPosition,
  filledNotionalUsd: number,
  entryFeeUsd: number,
): Promise<ShadowLedger> {
  const venue = await getTradingVenue();
  return await db.transaction(async (tx) => {
    // 1. SELECT ledger FOR UPDATE
    const ledgerResult = await tx.execute(sql`
      SELECT spot_shadow_capital_usd,
             spot_shadow_reserved_usd,
             spot_shadow_realized_pnl_usd,
             spot_shadow_total_fees_usd
      FROM bot_config
      FOR UPDATE
      LIMIT 1
    `);
    if (ledgerResult.rows.length === 0) {
      throw new Error("No bot_config row found for shadow ledger");
    }
    const r = ledgerResult.rows[0];
    const initial = Number(r.spot_shadow_capital_usd ?? 10_000);
    const reserved = Number(r.spot_shadow_reserved_usd ?? 0);
    const realized = Number(r.spot_shadow_realized_pnl_usd ?? 0);
    const fees = Number(r.spot_shadow_total_fees_usd ?? 0);

    // 2. Validate filledNotionalUsd
    const equity = initial + realized;
    const available = equity - reserved;
    if (!Number.isFinite(filledNotionalUsd) || filledNotionalUsd <= 0) {
      throw new Error(`Invalid filledNotionalUsd=${filledNotionalUsd}`);
    }
    if (filledNotionalUsd > available) {
      throw new Error(`Insufficient shadow capital: need ${filledNotionalUsd}, available ${available}`);
    }

    // 3. INSERT open_positions using tx — RETURNING ensures exactly 1 row inserted
    const insertResult = await insertOpenPositionSql(tx, position, venue, filledNotionalUsd);
    if (!insertResult || insertResult.rows.length !== 1) {
      throw new Error(`Entry INSERT failed: expected 1 row, got ${insertResult?.rows?.length ?? 0} (lot_id=${position.lotId})`);
    }

    // 4. UPDATE bot_config ledger using tx
    const newReserved = reserved + filledNotionalUsd;
    const newFees = fees + entryFeeUsd;
    await tx.execute(sql`
      UPDATE bot_config SET
        spot_shadow_reserved_usd = ${newReserved},
        spot_shadow_total_fees_usd = ${newFees},
        updated_at = NOW()
    `);

    // 5. Return committed state
    return {
      initialCapitalUsd: initial,
      reservedUsd: newReserved,
      realizedNetPnlUsd: realized,
      totalFeesUsd: newFees,
    };
  });
}

// ─── R4: Atomic shadow exit — SELECT pos FOR UPDATE + INSERT trade + UPDATE ledger + DELETE ──

export async function persistShadowExitAtomic(
  lotId: string,
  position: SpotPosition,
  execResult: SpotExecutionResult,
  pnl: { grossPnlUsd: number; netPnlUsd: number; entryFeeUsd: number; exitFeeUsd: number; executionCostUsd: number },
  exitDecision: SpotExitDecision,
  auditMetrics: SpotAuditMetrics | null,
): Promise<{ ledger: ShadowLedger; filledNotionalUsd: number }> {
  const venue = await getTradingVenue();
  const DECIMAL_TOLERANCE = 0.01; // 1 cent tolerance for DECIMAL comparison

  return await db.transaction(async (tx) => {
    // 1. SELECT position FOR UPDATE — prevents double close
    const posResult = await tx.execute(sql`
      SELECT filled_notional_usd FROM open_positions
      WHERE lot_id = ${lotId}
        AND policy_version = ${SPOT_POLICY_VERSION}
        AND execution_mode = 'SHADOW'
      FOR UPDATE
    `);
    if (posResult.rows.length === 0) {
      throw new Error(`ALREADY_CLOSED: position ${lotId} not found or already closed`);
    }

    // 3. Read filled_notional_usd from the locked DB row (NOT from memory)
    const filledNotionalUsd = Number(posResult.rows[0].filled_notional_usd ?? position.notionalUsd);

    // 4. SELECT bot_config ledger FOR UPDATE
    const ledgerResult = await tx.execute(sql`
      SELECT spot_shadow_capital_usd,
             spot_shadow_reserved_usd,
             spot_shadow_realized_pnl_usd,
             spot_shadow_total_fees_usd
      FROM bot_config
      FOR UPDATE
      LIMIT 1
    `);
    if (ledgerResult.rows.length === 0) {
      throw new Error("No bot_config row found for shadow ledger");
    }
    const r = ledgerResult.rows[0];
    const initial = Number(r.spot_shadow_capital_usd ?? 10_000);
    const reserved = Number(r.spot_shadow_reserved_usd ?? 0);
    const realized = Number(r.spot_shadow_realized_pnl_usd ?? 0);
    const fees = Number(r.spot_shadow_total_fees_usd ?? 0);

    // 5. Validate: reserved >= filledNotionalUsd (within tolerance) — NO negative reserved
    const delta = reserved - filledNotionalUsd;
    if (delta < -DECIMAL_TOLERANCE) {
      throw new Error(
        `Invariant violation: filledNotionalUsd=${filledNotionalUsd} > reserved=${reserved} (delta=${delta}, tolerance=${DECIMAL_TOLERANCE})`
      );
    }

    // 6. INSERT closed trade using tx — RETURNING ensures exactly 1 row inserted
    const tradeInsertResult = await insertClosedTradeSql(tx, position, execResult, pnl, exitDecision, auditMetrics, venue);
    if (!tradeInsertResult || tradeInsertResult.rows.length !== 1) {
      throw new Error(`Exit trade INSERT failed: expected 1 row, got ${tradeInsertResult?.rows?.length ?? 0} (lot_id=${position.lotId})`);
    }

    // 7. UPDATE bot_config ledger using tx — normalize reserved to 0 within tolerance
    const newReserved = Math.abs(delta) <= DECIMAL_TOLERANCE ? 0 : delta;
    const newRealized = realized + pnl.netPnlUsd;
    const newFees = fees + pnl.exitFeeUsd;
    await tx.execute(sql`
      UPDATE bot_config SET
        spot_shadow_reserved_usd = ${newReserved},
        spot_shadow_realized_pnl_usd = ${newRealized},
        spot_shadow_total_fees_usd = ${newFees},
        updated_at = NOW()
    `);

    // 8. DELETE open_position using tx
    await tx.execute(sql`
      DELETE FROM open_positions WHERE lot_id = ${lotId}
    `);

    // 9. Return committed state
    return {
      ledger: {
        initialCapitalUsd: initial,
        reservedUsd: newReserved,
        realizedNetPnlUsd: newRealized,
        totalFeesUsd: newFees,
      },
      filledNotionalUsd,
    };
  });
}

// ─── Execution Mode ─────────────────────────────────────────────────────────

/**
 * Get current execution mode from DB (cached).
 */
export async function getExecutionMode(): Promise<ExecutionMode> {
  return loadExecutionMode();
}

/**
 * Set execution mode (persisted to DB).
 * R10: REAL is now supported with preflight checks.
 * OFF = entry disabled, position supervisor continues while SPOT positions exist.
 */
export async function setExecutionMode(mode: ExecutionMode): Promise<ExecutionMode> {
  if (mode === ExecutionMode.REAL && !REAL_ACTIVATION_ALLOWED) {
    throw new Error("REAL execution mode is not authorized. REAL_ACTIVATION_ALLOWED=false.");
  }
  await saveExecutionMode(mode);
  if (mode === ExecutionMode.OFF) {
    // OFF: disable new entries, clear intents, but keep position supervisor running
    entryScanningEnabled = false;
    for (const intent of intentStore.getAll()) {
      intentStore.remove(intent.pair);
    }
    // Stop scan loop but keep supervisor if positions exist
    if (scanIntervalId) {
      clearInterval(scanIntervalId);
      scanIntervalId = null;
    }
    const hasPositions = await hasOpenSpotPositions();
    if (!hasPositions && supervisorIntervalId) {
      clearInterval(supervisorIntervalId);
      supervisorIntervalId = null;
      positionSupervisorRunning = false;
    }
    engineRunning = false;
    console.log(`[SpotEngine] Mode set to OFF. Entry scanning disabled. Supervisor ${hasPositions ? 'running' : 'stopped'}.`);
  } else {
    entryScanningEnabled = true;
  }
  console.log(`[SpotEngine] Execution mode set to ${mode}`);
  logActivity({
    pair: null,
    category: "MODE",
    severity: mode === ExecutionMode.REAL ? "CRITICAL" : "INFO",
    title: `Modo cambiado a ${mode}`,
    explanation: `Modo de ejecución SPOT cambiado a ${mode}`,
    decision: mode,
    executionMode: mode,
    reasonCode: "MODE_CHANGE",
  });
  return mode;
}

/**
 * Check if SpotEngine should be running (entry scanning active).
 * Returns true only when mode is SHADOW or REAL.
 * This is NOT the same as runtime ownership — use isSpotRuntimeOwner() for that.
 */
export function isSpotActive(): boolean {
  const mode = getCachedExecutionMode();
  return mode === ExecutionMode.SHADOW || mode === ExecutionMode.REAL;
}

/**
 * R8: Canonical runtime ownership — delegated to pure module spotOwnership.ts.
 *
 * This is SEPARATE from execution mode:
 *   - isSpotRuntimeOwner() = which engine owns new entries (always SPOT_CANONICAL)
 *   - executionMode = whether entries are allowed (OFF=0, SHADOW=simulated, REAL=real)
 *
 * Invariant: SPOT_RUNTIME_OWNER = SPOT_CANONICAL in OFF, SHADOW, and REAL.
 * Legacy TradingEngine must NEVER re-acquire entry ownership, even in OFF mode.
 * R8: FAIL-CLOSED — if ownership resolution fails, legacy entries stay blocked.
 */
export function isSpotRuntimeOwner(): boolean {
  return _isSpotRuntimeOwner();
}

// ─── Scan Cycle ─────────────────────────────────────────────────────────────

/**
 * Start the SpotEngine scan loop.
 * Returns true if engine started successfully, false otherwise.
 */
export async function startSpotEngine(): Promise<boolean> {
  if (engineRunning && scanIntervalId) {
    console.log("[SpotEngine] Already running");
    return true;
  }

  const mode = await getExecutionMode();

  console.log(`[SpotEngine] Starting with mode=${mode}, owner=${SPOT_RUNTIME_OWNER}`);

  // Load shadow ledger
  await loadShadowLedger();

  // Load open positions from DB
  await loadOpenPositionsFromDB();

  // R10.4: Reconcile pending REAL order_intents at restart — REGARDLESS of global mode
  // If any REAL orders/positions exist, they must be reconciled even if mode is OFF/SHADOW
  await reconcilePendingRealOrderIntents();

  // R10.4: Start periodic REAL reconciler — runs independently of global mode
  startRealReconciler();

  // R7: OFF mode — no entry scanner, but supervisor if positions exist
  if (mode === ExecutionMode.OFF) {
    entryScanningEnabled = false;
    engineRunning = false;

    const hasPositions = await hasOpenSpotPositions();
    if (hasPositions) {
      // Start position supervisor only
      if (!supervisorIntervalId) {
        positionSupervisorRunning = true;
        supervisorIntervalId = setInterval(() => runPositionSupervisor().catch(console.error), SCAN_INTERVAL_MS);
      }
      // R7: Await first supervisor pass before returning
      console.log("[SpotEngine] OFF mode: entry scanner=0, position supervisor=1 (open positions exist)");
      await runPositionSupervisor().catch(err => console.error("[SpotEngine] Initial supervisor error:", err.message));
    } else {
      console.log("[SpotEngine] OFF mode: entry scanner=0, position supervisor=0 (no open positions)");
    }
    return true;
  }

  // SHADOW or REAL mode
  entryScanningEnabled = true;
  engineRunning = true;

  // Start scan loop
  scanIntervalId = setInterval(() => runScanCycle().catch(console.error), SCAN_INTERVAL_MS);

  // Start position supervisor (runs even when entry scanning is OFF)
  if (!supervisorIntervalId) {
    positionSupervisorRunning = true;
    supervisorIntervalId = setInterval(() => runPositionSupervisor().catch(console.error), SCAN_INTERVAL_MS);
  }

  // R7: Await first supervisor pass BEFORE first scan — literal ordering guarantee
  console.log("[SpotEngine] Supervisor first pass starting (before scan)");
  await runPositionSupervisor().catch(err => console.error("[SpotEngine] Initial supervisor error:", err.message));
  console.log("[SpotEngine] Supervisor first pass completed, starting scan");

  // Run first scan immediately (after supervisor)
  runScanCycle().catch(console.error);
  return true;
}

/**
 * Stop the SpotEngine scan loop and position supervisor.
 */
export function stopSpotEngine(): void {
  if (scanIntervalId) {
    clearInterval(scanIntervalId);
    scanIntervalId = null;
  }
  if (supervisorIntervalId) {
    clearInterval(supervisorIntervalId);
    supervisorIntervalId = null;
  }
  stopRealReconciler();
  engineRunning = false;
  entryScanningEnabled = false;
  positionSupervisorRunning = false;
  console.log("[SpotEngine] Stopped (scan + supervisor + reconciler)");
}

/**
 * R10.4: Periodic REAL reconciler — runs independently of global mode.
 * Checks for pending/uncertain REAL order_intents and reconciles with exchange.
 * Reentrancy guard: skips if already running.
 */
async function runRealReconciler(): Promise<void> {
  if (isReconciling) {
    console.log("[SpotEngine] REAL reconciler already in progress, skipping");
    return;
  }
  isReconciling = true;
  try {
    const counts = await countPendingRealOrderIntents();
    const totalPending = counts.pendingEntryOrders + counts.pendingExitOrders + counts.uncertainOrders;
    if (totalPending === 0) return;
    console.log(`[SpotEngine] R10.4: Periodic reconciler — ${totalPending} pending REAL intents (entry=${counts.pendingEntryOrders}, exit=${counts.pendingExitOrders}, uncertain=${counts.uncertainOrders})`);
    await reconcilePendingRealOrderIntents();
  } catch (error: any) {
    console.error(`[SpotEngine] R10.4: Periodic reconciler error: ${error.message}`);
  } finally {
    isReconciling = false;
  }
}

function startRealReconciler(): void {
  if (reconcilerIntervalId) {
    console.log("[SpotEngine] REAL reconciler already running");
    return;
  }
  realReconcilerRunning = true;
  reconcilerIntervalId = setInterval(() => runRealReconciler().catch(console.error), RECONCILER_INTERVAL_MS);
  console.log(`[SpotEngine] R10.4: REAL reconciler started (interval=${RECONCILER_INTERVAL_MS}ms)`);
}

function stopRealReconciler(): void {
  if (reconcilerIntervalId) {
    clearInterval(reconcilerIntervalId);
    reconcilerIntervalId = null;
  }
  realReconcilerRunning = false;
  console.log("[SpotEngine] R10.4: REAL reconciler stopped");
}

/**
 * R10.4: Runtime counts for scanner, supervisor, reconciler.
 */
export function getRuntimeCounts(): {
  entryScannerInstances: number;
  positionSupervisorInstances: number;
  realReconcilerInstances: number;
} {
  return {
    entryScannerInstances: engineRunning ? 1 : 0,
    positionSupervisorInstances: positionSupervisorRunning ? 1 : 0,
    realReconcilerInstances: realReconcilerRunning ? 1 : 0,
  };
}

/**
 * R10.4: Exported for test access — check if reconciler is currently running.
 */
export function _isReconcilerRunningForTest(): boolean {
  return isReconciling;
}

/**
 * Single scan cycle: evaluate all active pairs for new entries.
 * Respects entryScanningEnabled flag (OFF = no new entries).
 */
async function runScanCycle(): Promise<void> {
  if (isScanning) {
    console.log("[SpotEngine] Scan already in progress, skipping");
    return;
  }

  if (!entryScanningEnabled) {
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

// R6: Exported for testing — verify single owner invariant
export async function _runScanCycleForTest(): Promise<void> {
  return runScanCycle();
}

// R6: Exported for testing — verify reentrancy guard
export async function _runPositionSupervisorForTest(): Promise<void> {
  return runPositionSupervisor();
}

// R6: Exported for testing — check supervisor state
export function _isSupervisingForTest(): boolean {
  return isSupervising;
}

// R6: Exported for testing — set supervisor state (for reentrancy test)
export function _setSupervisingForTest(value: boolean): void {
  isSupervising = value;
}

// R7: Exported for testing — engine state inspection
export function _isEngineRunningForTest(): boolean {
  return engineRunning;
}

export function _isEntryScanningEnabledForTest(): boolean {
  return entryScanningEnabled;
}

export function _isSupervisorRunningForTest(): boolean {
  return positionSupervisorRunning;
}

export function _hasScanIntervalForTest(): boolean {
  return scanIntervalId !== null;
}

export function _hasSupervisorIntervalForTest(): boolean {
  return supervisorIntervalId !== null;
}

// R7: Exported for testing — full stop and reset
export function _stopSpotEngineForTest(): void {
  if (scanIntervalId) {
    clearInterval(scanIntervalId);
    scanIntervalId = null;
  }
  if (supervisorIntervalId) {
    clearInterval(supervisorIntervalId);
    supervisorIntervalId = null;
  }
  engineRunning = false;
  entryScanningEnabled = true;
  positionSupervisorRunning = false;
  isScanning = false;
  isSupervising = false;
}

/**
 * R5: Get DISTINCT pairs from open SPOT canonical positions.
 * activePairs defines the universe for NEW ENTRIES, not for position protection.
 * Open positions must receive protection regardless of activePairs.
 */
export async function getOpenSpotPositionPairs(): Promise<string[]> {
  try {
    const result = await db.execute(sql`
      SELECT DISTINCT pair FROM open_positions
      WHERE policy_version = ${SPOT_POLICY_VERSION}
        AND engine_owner = ${SPOT_ENGINE_OWNER}
        AND status != 'CLOSED'
    `);
    return result.rows.map((r: any) => r.pair as string);
  } catch (error) {
    console.error("[SpotEngine] Failed to get open position pairs:", error);
    return [];
  }
}

/**
 * Position supervisor: manages open SPOT positions (exit evaluation) independently of entry scanning.
 * Runs even when mode=OFF to avoid orphaning positions.
 * R5: Iterates over pairs with open positions, NOT activePairs.
 * R6: Reentrancy guard prevents overlapping cycles.
 */
async function runPositionSupervisor(): Promise<void> {
  if (isSupervising) {
    console.log("[SpotEngine] Supervisor already in progress, skipping");
    return;
  }
  isSupervising = true;
  try {
    const mode = await getExecutionMode();
    const pairs = await getOpenSpotPositionPairs();
    for (const pair of pairs) {
      try {
        let ctx: SpotMarketContext;
        try {
          ctx = await buildSpotMarketContext({ pair });
        } catch {
          continue; // skip pairs with data errors
        }
        // Use position's executionMode for exit, not global mode
        await manageOpenPositions(pair, ctx);
      } catch (error: any) {
        console.error(`[SpotEngine] Supervisor error for ${pair}:`, error.message);
      }
    }
  } catch (error: any) {
    console.error('[SpotEngine] Supervisor cycle error:', error.message);
  } finally {
    isSupervising = false;
  }
}

/**
 * Check if there are any open SPOT canonical positions.
 */
async function hasOpenSpotPositions(): Promise<boolean> {
  try {
    const result = await db.execute(sql`
      SELECT COUNT(*) as count FROM open_positions
      WHERE policy_version = ${SPOT_POLICY_VERSION} AND status != 'CLOSED'
    `);
    return Number(result.rows[0]?.count ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Scan a single pair: build context, evaluate strategy, manage positions.
 * FIXED FLOW (B01):
 *   A. Build context
 *   B. Manage open positions (exits)
 *   C. Check for active intent → re-evaluate it ALWAYS
 *   D. If no active intent → evaluate strategy → if BUY, create intent → evaluate immediately
 *   E. Execute only if all gates pass
 */
async function scanPair(pair: string, mode: ExecutionMode): Promise<{ pair: string; signal: string; reason: string; mode: string }> {
  // A. Build market context
  let ctx: SpotMarketContext;
  try {
    ctx = await buildSpotMarketContext({ pair });
  } catch (error: any) {
    return { pair, signal: "SKIP", reason: `MarketData error: ${error.message}`, mode };
  }

  // R6: Position management removed from scanPair — runPositionSupervisor is the single owner.
  // C. Check data health — if stale, skip entry evaluation
  if (ctx.dataHealth === DataHealth.STALE || ctx.dataHealth === DataHealth.INSUFFICIENT) {
    return { pair, signal: "HOLD", reason: `DataHealth=${ctx.dataHealth}`, mode };
  }

  // D. Check for active intent → re-evaluate it ALWAYS in this scan
  const activeIntent = intentStore.get(pair);
  if (activeIntent && activeIntent.state !== "EXECUTED" && activeIntent.state !== "EXPIRED" && activeIntent.state !== "INVALIDATED" && activeIntent.state !== "CANCELLED") {
    const evaluation = evaluateEntryIntent(activeIntent, ctx);
    activeIntent.state = evaluation.newState;
    activeIntent.lastBlockReason = evaluation.reason;
    activeIntent.lastEvaluatedAt = Date.now();
    intentStore.update(activeIntent);

    if (evaluation.shouldExecute) {
      const executed = await executeEntry(activeIntent, ctx, mode, signalResultCache.get(pair));
      if (executed) {
        activeIntent.state = "EXECUTED" as any;
        intentStore.update(activeIntent);
        signalResultCache.delete(pair);
        return { pair, signal: "EXECUTED", reason: "Entry executed", mode };
      }
    }

    // Intent expired or invalidated — clean up and fall through to new signal evaluation
    if (activeIntent.state === "EXPIRED" || activeIntent.state === "INVALIDATED") {
      intentStore.remove(pair);
      signalResultCache.delete(pair);
    }

    // If intent is still active (WAITING/APPROVED/CHASED), do NOT create a new one
    // Origin snapshot stays frozen — we don't reset it each scan
    if (activeIntent.state !== "EXPIRED" && activeIntent.state !== "INVALIDATED") {
      return { pair, signal: "INTENT", reason: evaluation.reason, mode };
    }
  }

  // E. No active intent — evaluate SPOT_CANONICAL strategy
  const signal = evaluateSpotCanonical(ctx);

  if (signal.signal === "BUY" && signal.setupTag) {
    // F. Create intent and evaluate it immediately against current context
    const intent = createEntryIntent(signal, ctx);
    intentStore.put(intent);
    signalResultCache.set(pair, signal);
    console.log(`[SpotEngine] Entry intent created for ${pair}, setup=${signal.setupTag}, confidence=${signal.confidence}`);

    // Evaluate immediately — don't wait for next scan
    const evaluation = evaluateEntryIntent(intent, ctx);
    intent.state = evaluation.newState;
    intent.lastBlockReason = evaluation.reason;
    intent.lastEvaluatedAt = Date.now();
    intentStore.update(intent);

    if (evaluation.shouldExecute) {
      const executed = await executeEntry(intent, ctx, mode, signal);
      if (executed) {
        intent.state = "EXECUTED" as any;
        intentStore.update(intent);
        signalResultCache.delete(pair);
        return { pair, signal: "EXECUTED", reason: "Entry executed (immediate)", mode };
      }
    }

    return { pair, signal: "BUY", reason: signal.reason, mode };
  }

  // No signal — clean up any stale signal cache
  signalResultCache.delete(pair);

  return { pair, signal: "HOLD", reason: signal.reason || signal.blockReason || "No signal", mode };
}

/**
 * Execute entry: sizing → adapter → persist position.
 * Propagates signalConfidence from SpotSignalResult (B14).
 */
async function executeEntry(intent: SpotEntryIntent, ctx: SpotMarketContext, mode: ExecutionMode, signal?: SpotSignalResult): Promise<boolean> {
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

  // R10.4: Freeze gate — check for unresolved REAL executions before new entries
  if (mode === ExecutionMode.REAL) {
    const frozen = await hasUnresolvedRealExecution();
    if (frozen) {
      console.log(`[SpotEngine] Entry blocked for ${intent.pair}: REAL FREEZE active (unresolved executions)`);
      logActivity({
        pair: intent.pair,
        category: "EXECUTION",
        severity: "CRITICAL",
        title: "Entrada bloqueada — REAL FREEZE activo",
        explanation: `Existen ejecuciones REAL sin resolver. Nuevas entradas congeladas hasta reconciliación.`,
        decision: "BLOCK",
        executionMode: mode,
        reasonCode: "REAL_FREEZE_ACTIVATED",
      });
      return false;
    }
  }

  // R10.2: Stable internalIntentId — NO Date.now(), deterministic per signalId+pair
  const internalIntentId = `entry:${SPOT_POLICY_VERSION}:${intent.signalId}:${intent.pair}`;
  const execIntent: SpotExecutionIntent = {
    intentId: internalIntentId,
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

  // R10.1: Generate stable clientOrderId BEFORE calling adapter
  const clientOrderId = generateClientOrderId(internalIntentId);

  // R10.4: For REAL mode — durable per-intent reservation + persist in ONE atomic tx
  if (mode === ExecutionMode.REAL) {
    const venue = await getTradingVenue();
    let alreadySubmitted: boolean;
    try {
      const result = await persistAndReserveRealEntryIntentAtomic({
        internalIntentId,
        pair: intent.pair,
        side: "BUY",
        requestedQty: sizing.volume,
        requestedPrice: null,
        orderType: "MARKET",
        executionMode: mode,
        lotId: null,
        reason: `SPOT entry: ${intent.setupTag}`,
      }, clientOrderId, venue, sizing.notionalUsd);
      alreadySubmitted = result.alreadySubmitted;
    } catch (error: any) {
      // R10.4: FAIL-CLOSED — no placeOrder if persistence/reservation fails
      console.error(`[SpotEngine] Entry BLOCKED — persist+reserve failed: ${error.message}`);
      logActivity({
        pair: intent.pair,
        category: "EXECUTION",
        severity: "CRITICAL",
        title: "Entrada bloqueada — persistencia+reserva falló",
        explanation: `No se pudo persistir ni reservar capital para el intent antes de placeOrder. NO se envió orden. Error: ${error.message}`,
        decision: "BLOCK",
        executionMode: mode,
        reasonCode: "REAL_INTENT_PERSISTENCE_FAILED_FAIL_CLOSED",
        intentId: internalIntentId,
      });
      return false;
    }

    if (alreadySubmitted) {
      console.log(`[SpotEngine] Entry SKIPPED — already submitted: ${internalIntentId} clientOrderId=${clientOrderId}`);
      // R10.4: Release reservation via exact idempotent release
      try { await releaseReservationExact(internalIntentId); } catch { /* best effort */ }
      logActivity({
        pair: intent.pair,
        category: "EXECUTION",
        severity: "INFO",
        title: "Entrada duplicada evitada",
        explanation: `Intent ${internalIntentId} ya tiene submission activa. placeOrder omitido.`,
        decision: "SKIP_DUPLICATE",
        executionMode: mode,
        reasonCode: "DUPLICATE_ENTRY_SUBMISSION",
        intentId: internalIntentId,
      });
      return true;
    }
  }

  // Execute via adapter — pass clientOrderId (NOT generated by adapter)
  const adapter = createExecutionAdapter(mode);
  let result: SpotExecutionResult;
  try {
    result = await adapter.executeEntry(execIntent, ctx, clientOrderId);
  } catch (error: any) {
    // R10.4: Network ambiguity — order may have been placed but response lost
    if (mode === ExecutionMode.REAL) {
      console.error(`[SpotEngine] REAL entry network ambiguity for ${intent.pair}: ${error.message}`);
      try {
        await updateSubmissionResult(internalIntentId, { status: "UNCERTAIN" });
      } catch { /* best effort */ }
      logActivity({
        pair: intent.pair,
        category: "SYSTEM",
        severity: "CRITICAL",
        title: "REAL_SUBMISSION_AMBIGUOUS — network error tras placeOrder",
        explanation: `Network error durante placeOrder. Orden puede estar viva en exchange. Marcado UNCERTAIN. NO reenviar. Error: ${error.message}`,
        decision: "FAIL_CLOSED",
        executionMode: mode,
        reasonCode: "REAL_SUBMISSION_AMBIGUOUS",
        intentId: internalIntentId,
      });
    } else {
      console.error(`[SpotEngine] Entry exception for ${intent.pair}: ${error.message}`);
    }
    return false;
  }

  if (!result.success) {
    console.error(`[SpotEngine] Entry failed for ${intent.pair}: ${result.error}`);
    // R10.4: Release reservation via exact idempotent release
    if (mode === ExecutionMode.REAL) {
      try { await releaseReservationExact(internalIntentId); } catch { /* best effort */ }
    }
    logActivity({
      pair: intent.pair,
      category: "ENTRY",
      severity: "WARNING",
      title: "Entrada rechazada",
      explanation: `Orden de entrada falló: ${result.error}`,
      decision: "REJECT",
      executionMode: mode,
      setupTag: intent.setupTag,
      reasonCode: "ENTRY_FAILED",
      intentId: execIntent.intentId,
      orderId: result.orderId,
    });
    return false;
  }

  // R10.1: Handle pending fill — persist to order_intents, NOT open_positions with price=0
  if (result.pendingFill && result.fillPrice === null) {
    // R10.1: For REAL mode, update order_intents with venueOrderId and PENDING_FILL status
    if (mode === ExecutionMode.REAL) {
      await updateSubmissionResult(internalIntentId, {
        venueOrderId: result.venueOrderId ?? result.orderId,
        status: "PENDING_FILL",
      });
    }

    console.log(`[SpotEngine] Entry PENDING_FILL: ${intent.pair} orderId=${result.orderId} clientOrderId=${result.clientOrderId}`);
    logActivity({
      pair: intent.pair,
      category: "EXECUTION",
      severity: "ATTENTION",
      title: "Orden enviada — pendiente de fill",
      explanation: `Orden de entrada enviada al exchange, esperando confirmación de fill. orderId=${result.orderId}`,
      decision: "PENDING_FILL",
      executionMode: mode,
      setupTag: intent.setupTag,
      reasonCode: "PENDING_FILL",
      intentId: internalIntentId,
      orderId: result.orderId,
    });
    return true;
  }

  if (result.fillPrice === null) {
    console.error(`[SpotEngine] Entry failed for ${intent.pair}: no fill price`);
    // R10.4: Release reservation via exact idempotent release
    if (mode === ExecutionMode.REAL) {
      try { await releaseReservationExact(internalIntentId); } catch { /* best effort */ }
    }
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
    signalConfidence: signal?.confidence ?? 0,
    signalReason: signal?.reason ?? intent.setupTag,
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

  // R3-2: Use filledNotionalUsd (fillPrice * fillVolume) as canonical source for capital reservation
  const filledNotionalUsd = result.fillPrice !== null && result.fillVolume !== null
    ? result.fillPrice * result.fillVolume
    : sizing.notionalUsd;
  if (!Number.isFinite(filledNotionalUsd) || filledNotionalUsd <= 0) {
    console.error(`[SpotEngine] Invalid filledNotionalUsd=${filledNotionalUsd} for ${intent.pair}`);
    return false;
  }
  position.notionalUsd = filledNotionalUsd;

  // R4: Atomic entry — INSERT position + UPDATE ledger in ONE transaction
  if (mode === ExecutionMode.SHADOW) {
    try {
      const newLedger = await persistShadowEntryAtomic(position, filledNotionalUsd, result.feeUsd ?? 0);
      // Sync in-memory cache only after successful COMMIT
      shadowLedger = newLedger;
    } catch (error: any) {
      console.error(`[SpotEngine] Shadow entry atomic persistence failed for ${intent.pair}: ${error.message}`);
      return false;
    }
  } else {
    // R10.3: REAL mode — atomic fill materialization (exactly-once)
    // INSERT open_position + UPDATE order_intent FILLED in ONE transaction
    if (mode === ExecutionMode.REAL) {
      try {
        await finalizeRealEntryFillAtomic(
          position, result, filledNotionalUsd, internalIntentId, clientOrderId,
        );
        // R10.4: Release durable per-intent reservation — position is now the reservation
        try { await releaseReservationExact(internalIntentId); } catch { /* best effort */ }
      } catch (error: any) {
        // R10.3: Exchange ack received but DB materialization failed.
        // Mark UNCERTAIN — do NOT re-send order. Freeze new REAL entries.
        console.error(`[SpotEngine] REAL entry fill materialization FAILED for ${lotId}: ${error.message}`);
        try {
          await updateSubmissionResult(internalIntentId, { status: "UNCERTAIN" });
        } catch { /* best effort */ }
        logActivity({
          pair: intent.pair,
          category: "SYSTEM",
          severity: "CRITICAL",
          title: "REAL_EXECUTION_UNRESOLVED — materialización DB falló",
          explanation: `Exchange aceptó orden ${result.orderId} pero DB no pudo materializar. Marcado UNCERTAIN. NO reenviar. Error: ${error.message}`,
          decision: "FAIL_CLOSED",
          executionMode: mode,
          reasonCode: "REAL_ENTRY_FILL_ATOMIC_FAILED",
          intentId: internalIntentId,
          lotId,
          orderId: result.orderId,
        });
        return false;
      }
    } else {
      // Non-SHADOW non-REAL (shouldn't happen but keep for safety)
      await persistOpenPosition(position, result, filledNotionalUsd);
    }
  }

  // Init audit tracking
  auditTracker.initPosition(position);

  // Init exit state
  const exitState = createExitState(position);
  exitStates.set(lotId, exitState);

  console.log(`[SpotEngine] Position opened: ${lotId} ${intent.pair} @ ${result.fillPrice}, mode=${mode}`);
  logActivity({
    pair: intent.pair,
    category: "ENTRY",
    severity: "SUCCESS",
    title: `Entrada ejecutada — ${intent.setupTag}`,
    explanation: `Posición abierta: ${lotId} @ ${result.fillPrice}, vol=${position.amount}, modo=${mode}`,
    decision: "BUY",
    executionMode: mode,
    setupTag: intent.setupTag,
    regime: ctx.regimeContext.regime,
    direction: ctx.regimeContext.direction,
    macroBias: ctx.regimeContext.macroBias,
    price: result.fillPrice,
    reasonCode: "ENTRY_FILLED",
    signalId: intent.signalId,
    lotId,
    orderId: result.orderId,
  });
  return true;
}

/**
 * Manage open positions for a pair: update MFE/MAE, evaluate exits, close if needed.
 * B03: Only manages SPOT_CANONICAL positions. Uses position.executionMode (immutable) for exit adapter.
 */
async function manageOpenPositions(pair: string, ctx: SpotMarketContext): Promise<void> {
  const positions = await getOpenPositionsForPair(pair);

  for (const row of positions) {
    // B03: Only manage SPOT_CANONICAL positions — filter by policy_version and engine_owner
    if (row.policyVersion !== SPOT_POLICY_VERSION) continue;
    if (row.engineOwner && row.engineOwner !== SPOT_ENGINE_OWNER) continue;
    // R10: Skip UNCERTAIN positions — require manual resolution
    if (row.executionMode === "UNCERTAIN" || (row as any).status === "UNCERTAIN") continue;

    const position = rowToPosition(row);
    const currentPrice = ctx.ticker.last;

    // B13: Restore audit tracker from DB if not already in memory (restart case)
    if (!auditTracker.getMetrics(position.lotId)) {
      auditTracker.restorePosition(position, {
        mfeUsd: row.mfe,
        maeUsd: row.mae,
        mfeR: row.mfeR,
        maeR: row.maeR,
        highestPrice: row.highestPrice,
        lowestPrice: row.lowestPrice ?? position.entryPrice,
        mfeTimestamp: position.openedAt,
        maeTimestamp: position.openedAt,
      });
    }

    // Update audit tracker with current price
    auditTracker.updatePrice(position, currentPrice, Date.now());

    // B13: Restore exit state from DB if not already in memory (restart case)
    let exitState = exitStates.get(row.lotId);
    if (!exitState) {
      exitState = restoreExitState(position, row);
      exitStates.set(row.lotId, exitState);
    }

    // Evaluate exit (this mutates exitState: arms BE, trailing, etc.)
    const exitDecision = evaluateExit(position, exitState, ctx);

    // B13: Persist updated protection state AFTER evaluateExit
    const auditMetrics = auditTracker.getMetrics(position.lotId);
    const mfeUsd = auditMetrics?.mfeUsd ?? row.mfe;
    const maeUsd = auditMetrics?.maeUsd ?? row.mae;
    const mfeR = auditMetrics?.mfeR ?? row.mfeR;
    const maeR = auditMetrics?.maeR ?? row.maeR;
    const newHighest = Math.max(row.highestPrice, currentPrice);
    const newLowest = Math.min(row.lowestPrice ?? position.entryPrice, currentPrice);

    await db.execute(sql`
      UPDATE open_positions SET
        highest_price = ${newHighest},
        lowest_price = ${newLowest},
        mfe = ${mfeUsd},
        mae = ${maeUsd},
        mfe_r = ${mfeR},
        mae_r = ${maeR},
        sg_break_even_activated = ${exitState.breakEvenStopPrice !== null},
        sg_trailing_activated = ${exitState.trailingStopPrice !== null},
        sg_current_stop_price = ${exitState.trailingStopPrice ?? exitState.breakEvenStopPrice ?? position.sgCurrentStopPrice},
        break_even_stop_price = ${exitState.breakEvenStopPrice},
        trailing_stop_price = ${exitState.trailingStopPrice},
        trailing_highest_price = ${exitState.trailingHighestPrice},
        updated_at = NOW()
      WHERE lot_id = ${row.lotId}
    `);

    if (exitDecision.shouldExit && exitDecision.reasonType) {
      // B03: Use position.executionMode (immutable), NOT global mode
      await closePosition(position, exitDecision, ctx);

      // Clean up state
      exitStates.delete(row.lotId);
      intentStore.remove(pair);
    }
  }
}

/**
 * Close a position: execute exit, persist trade, finalize audit.
 * B03: Uses position.executionMode (immutable) for exit adapter — never global mode.
 */
async function closePosition(
  position: SpotPosition,
  exitDecision: SpotExitDecision,
  ctx: SpotMarketContext,
): Promise<void> {
  // B03: Use position's immutable executionMode, not global mode
  const adapter = createExecutionAdapter(position.executionMode);

  // R10.2: Stable internalIntentId with attempt counter for exit.
  // If a prior exit attempt was CANCELLED/FAILED, a new attempt gets a new ID.
  // Format: exit:${lotId}:${reasonType}:${attempt}
  let exitAttempt = 0;
  if (position.executionMode === ExecutionMode.REAL) {
    try {
      const priorExits = await db.execute(sql`
        SELECT COUNT(*) as count FROM order_intents
        WHERE lot_id = ${position.lotId}
          AND side = ${"sell"}
          AND status IN (${"failed"}, ${"expired"})
          AND engine_owner = ${SPOT_ENGINE_OWNER}
      `);
      exitAttempt = Number(priorExits.rows[0]?.count ?? 0);
    } catch {
      // R10.3: FAIL-CLOSED — cannot determine exit attempt, NO placeOrder
      console.error(`[SpotEngine] Exit BLOCKED — cannot determine exit attempt for ${position.lotId}`);
      logActivity({
        pair: position.pair,
        category: "EXECUTION",
        severity: "CRITICAL",
        title: "Salida bloqueada — no se pudo determinar attempt",
        explanation: `No se pudo consultar order_intents para contar exit attempts previos de ${position.lotId}. NO se envió orden.`,
        decision: "BLOCK",
        executionMode: position.executionMode,
        reasonCode: "REAL_EXIT_ATTEMPT_RESOLUTION_FAILED_FAIL_CLOSED",
        lotId: position.lotId,
      });
      return;
    }
  }
  const internalIntentId = `exit:${position.lotId}:${exitDecision.reasonType ?? "EXIT"}:${exitAttempt}`;
  const clientOrderId = generateClientOrderId(internalIntentId);

  const execIntent: SpotExecutionIntent = {
    intentId: internalIntentId,
    pair: position.pair,
    side: "SELL",
    orderType: "MARKET",
    volume: position.qtyRemaining,
    price: null,
    notionalUsd: position.notionalUsd,
    reason: exitDecision.reason,
    reasonType: exitDecision.reasonType!,
    positionLotId: position.lotId,
    executionMode: position.executionMode,
    ttlMs: 30_000,
    createdAt: Date.now(),
  };

  // R10.1: For REAL mode — persist exit submission intent BEFORE calling placeOrder
  if (position.executionMode === ExecutionMode.REAL) {
    // R10.1: Check if position already has EXIT_PENDING — no double submission
    try {
      const existing = await db.execute(sql`
        SELECT status FROM open_positions
        WHERE lot_id = ${position.lotId} AND status = 'EXIT_PENDING'
      `);
      if (existing.rows.length > 0) {
        console.log(`[SpotEngine] Exit SKIPPED — already EXIT_PENDING: ${position.lotId}`);
        logActivity({
          pair: position.pair,
          category: "EXECUTION",
          severity: "INFO",
          title: "Salida duplicada evitada",
          explanation: `Posición ${position.lotId} ya tiene EXIT_PENDING. placeOrder omitido.`,
          decision: "SKIP_DUPLICATE",
          executionMode: position.executionMode,
          reasonCode: "DUPLICATE_EXIT_SUBMISSION",
          lotId: position.lotId,
        });
        return;
      }
    } catch { /* best effort */ }

    const venue = await getTradingVenue();
    let alreadySubmitted: boolean;
    try {
      const result = await persistSubmissionIntent({
        internalIntentId,
        pair: position.pair,
        side: "SELL",
        requestedQty: position.qtyRemaining,
        requestedPrice: null,
        orderType: "MARKET",
        executionMode: position.executionMode,
        lotId: position.lotId,
        reason: exitDecision.reason,
      }, clientOrderId, venue);
      alreadySubmitted = result.alreadySubmitted;
    } catch (error: any) {
      // R10.2: FAIL-CLOSED — no placeOrder if persistence fails
      console.error(`[SpotEngine] Exit BLOCKED — persistence failed: ${error.message}`);
      logActivity({
        pair: position.pair,
        category: "EXECUTION",
        severity: "CRITICAL",
        title: "Salida bloqueada — persistencia falló",
        explanation: `No se pudo persistir el exit intent antes de placeOrder. NO se envió orden. Error: ${error.message}`,
        decision: "BLOCK",
        executionMode: position.executionMode,
        reasonCode: "REAL_INTENT_PERSISTENCE_FAILED_FAIL_CLOSED",
        lotId: position.lotId,
        intentId: internalIntentId,
      });
      return;
    }

    if (alreadySubmitted) {
      console.log(`[SpotEngine] Exit SKIPPED — already submitted: ${internalIntentId}`);
      logActivity({
        pair: position.pair,
        category: "EXECUTION",
        severity: "INFO",
        title: "Salida duplicada evitada",
        explanation: `Intent ${internalIntentId} ya tiene submission activa. placeOrder omitido.`,
        decision: "SKIP_DUPLICATE",
        executionMode: position.executionMode,
        reasonCode: "DUPLICATE_EXIT_SUBMISSION",
        lotId: position.lotId,
        intentId: internalIntentId,
      });
      return;
    }
  }

  let result: SpotExecutionResult;
  try {
    result = await adapter.executeExit(execIntent, ctx, clientOrderId);
  } catch (error: any) {
    // R10.4: Network ambiguity for exit — order may have been placed but response lost
    if (position.executionMode === ExecutionMode.REAL) {
      console.error(`[SpotEngine] REAL exit network ambiguity for ${position.lotId}: ${error.message}`);
      try {
        await updateSubmissionResult(internalIntentId, { status: "UNCERTAIN" });
      } catch { /* best effort */ }
      logActivity({
        pair: position.pair,
        category: "SYSTEM",
        severity: "CRITICAL",
        title: "REAL_SUBMISSION_AMBIGUOUS — network error tras exit placeOrder",
        explanation: `Network error durante exit placeOrder. Orden puede estar viva en exchange. Marcado UNCERTAIN. NO reenviar. Error: ${error.message}`,
        decision: "FAIL_CLOSED",
        executionMode: position.executionMode,
        reasonCode: "REAL_SUBMISSION_AMBIGUOUS",
        lotId: position.lotId,
        intentId: internalIntentId,
      });
    } else {
      console.error(`[SpotEngine] Exit exception for ${position.lotId}: ${error.message}`);
    }
    return;
  }
  if (!result.success) {
    console.error(`[SpotEngine] Exit failed for ${position.lotId}: ${result.error}`);
    logActivity({
      pair: position.pair,
      category: "EXIT",
      severity: "WARNING",
      title: "Salida fallida",
      explanation: `Orden de salida falló: ${result.error}`,
      decision: "REJECT",
      executionMode: position.executionMode,
      reasonCode: "EXIT_FAILED",
      lotId: position.lotId,
      orderId: result.orderId,
    });
    return;
  }

  // R10.1: Handle pending fill for exit — persist real order IDs, don't close position
  if (result.pendingFill && result.fillPrice === null) {
    // R10.1: Update order_intents with PENDING_FILL status and venueOrderId
    if (position.executionMode === ExecutionMode.REAL) {
      await updateSubmissionResult(internalIntentId, {
        venueOrderId: result.venueOrderId ?? result.orderId,
        status: "PENDING_FILL",
      });
    }
    // R10.1: Persist real clientOrderId and venueOrderId on the position
    await db.execute(sql`
      UPDATE open_positions SET
        status = 'EXIT_PENDING',
        client_order_id = COALESCE(${result.clientOrderId ?? null}, client_order_id),
        venue_order_id = COALESCE(${result.venueOrderId ?? result.orderId ?? null}, venue_order_id),
        updated_at = NOW()
      WHERE lot_id = ${position.lotId}
    `);
    console.log(`[SpotEngine] Exit PENDING_FILL for ${position.lotId} orderId=${result.orderId} clientOrderId=${result.clientOrderId}`);
    logActivity({
      pair: position.pair,
      category: "EXIT",
      severity: "ATTENTION",
      title: "Salida enviada — pendiente de fill",
      explanation: `Orden de venta enviada, esperando confirmación. orderId=${result.orderId}`,
      decision: "PENDING_FILL",
      executionMode: position.executionMode,
      reasonCode: "EXIT_PENDING_FILL",
      lotId: position.lotId,
      orderId: result.orderId,
    });
    return;
  }

  if (result.fillPrice === null) {
    console.error(`[SpotEngine] Exit failed for ${position.lotId}: no fill price`);
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

  // R4: Atomic exit — SELECT pos FOR UPDATE + INSERT trade + UPDATE ledger + DELETE in ONE transaction
  if (position.executionMode === ExecutionMode.SHADOW) {
    try {
      const { ledger: newLedger, filledNotionalUsd: dbFilledNotional } = await persistShadowExitAtomic(
        position.lotId, position, result, pnl, exitDecision, auditMetrics ?? auditTracker.getMetrics(position.lotId),
      );
      shadowLedger = newLedger;
    } catch (error: any) {
      console.error(`[SpotEngine] Shadow exit atomic persistence failed for ${position.lotId}: ${error.message}`);
      return;
    }
  } else {
    // R10.3: REAL mode — atomic exit fill materialization (exactly-once)
    // lock order_intent + lock open_position + INSERT trade + DELETE position + UPDATE intent FILLED in ONE tx
    if (position.executionMode === ExecutionMode.REAL) {
      try {
        await finalizeRealExitFillAtomic(
          position, result, pnl, exitDecision,
          auditMetrics ?? auditTracker.getMetrics(position.lotId),
          internalIntentId,
        );
      } catch (error: any) {
        // R10.3: Exchange ack received but DB materialization failed.
        // Mark UNCERTAIN — do NOT re-send. Freeze new REAL entries.
        console.error(`[SpotEngine] REAL exit fill materialization FAILED for ${position.lotId}: ${error.message}`);
        try {
          await updateSubmissionResult(internalIntentId, { status: "UNCERTAIN" });
        } catch { /* best effort */ }
        logActivity({
          pair: position.pair,
          category: "SYSTEM",
          severity: "CRITICAL",
          title: "REAL_EXECUTION_UNRESOLVED — materialización DB exit falló",
          explanation: `Exchange aceptó orden de salida ${result.orderId} pero DB no pudo materializar. Marcado UNCERTAIN. NO reenviar. Error: ${error.message}`,
          decision: "FAIL_CLOSED",
          executionMode: position.executionMode,
          reasonCode: "REAL_EXIT_FILL_ATOMIC_FAILED",
          lotId: position.lotId,
          intentId: internalIntentId,
          orderId: result.orderId,
        });
        return;
      }
    } else {
      // Non-SHADOW non-REAL — keep legacy path for safety
      try {
        const guard = await db.execute(sql`
          SELECT lot_id FROM open_positions
          WHERE lot_id = ${position.lotId} AND status != 'CLOSED'
          FOR UPDATE
        `);
        if (guard.rows.length === 0) {
          console.log(`[SpotEngine] Exit SKIPPED — already closed: ${position.lotId}`);
          return;
        }
      } catch (error: any) {
        console.warn(`[SpotEngine] Exit guard check failed for ${position.lotId}: ${error.message}`);
      }
      await persistClosedTrade(position, result, pnl, exitDecision, auditMetrics ?? auditTracker.getMetrics(position.lotId));
      await db.execute(sql`
        DELETE FROM open_positions WHERE lot_id = ${position.lotId}
      `);
    }
  }

  const am = auditMetrics ?? auditTracker.getMetrics(position.lotId);
  console.log(
    `[SpotEngine] Position closed: ${position.lotId} ${position.pair} @ ${result.fillPrice}, ` +
    `reason=${exitDecision.reasonType}, netPnl=$${pnl.netPnlUsd.toFixed(2)}, ` +
    `MFE=$${am?.mfeUsd ?? 0}, MAE=$${am?.maeUsd ?? 0}`
  );
  logActivity({
    pair: position.pair,
    category: "EXIT",
    severity: pnl.netPnlUsd >= 0 ? "SUCCESS" : "WARNING",
    title: `Salida ejecutada — ${exitDecision.reasonType}`,
    explanation: `Posición cerrada: ${position.lotId} @ ${result.fillPrice}, PnL=$${pnl.netPnlUsd.toFixed(2)}, razón=${exitDecision.reason}`,
    decision: "SELL",
    executionMode: position.executionMode,
    price: result.fillPrice,
    reasonCode: exitDecision.reasonType ?? "EXIT",
    lotId: position.lotId,
    orderId: result.orderId,
  });
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
 * Get available capital — B12: uses configurable shadow ledger, not hardcode 10_000.
 * R10.4: For REAL mode, uses authenticated exchange balance (getRealQuoteBalance).
 *        NO fallback to market_data USD capital — fail-closed if exchange unreachable.
 */
async function getAvailableCapital(): Promise<number> {
  if (getCachedExecutionMode() === ExecutionMode.SHADOW) {
    return getShadowAvailableCapital();
  }
  // R10.4: REAL mode — use authenticated exchange balance, NO fictitious fallback
  if (getCachedExecutionMode() === ExecutionMode.REAL) {
    return getRealQuoteBalance();
  }
  // OFF mode — shouldn't be used for entries, but return 0 for safety
  return 0;
}

/**
 * R10.4: Get real quote balance from authenticated exchange.
 * This is the ONLY source of REAL capital — no fallback to market_data or hardcoded values.
 * Returns 0 on any error (fail-closed — no entries if balance unknown).
 */
async function getRealQuoteBalance(): Promise<number> {
  try {
    const exchange = ExchangeFactory.getTradingExchange();
    if (!exchange.isInitialized()) {
      console.error("[SpotEngine] getRealQuoteBalance: exchange not initialized — returning 0 (fail-closed)");
      return 0;
    }
    const anyExchange = exchange as any;
    if (typeof anyExchange.getBalance !== "function") {
      console.error("[SpotEngine] getRealQuoteBalance: exchange does not support getBalance — returning 0 (fail-closed)");
      return 0;
    }
    // Get USD balance from exchange
    const balance = await anyExchange.getBalance("USD");
    if (!Number.isFinite(balance) || balance < 0) {
      console.error(`[SpotEngine] getRealQuoteBalance: invalid balance=${balance} — returning 0 (fail-closed)`);
      return 0;
    }
    // Subtract already-reserved capital
    const reservedResult = await db.execute(sql`
      SELECT COALESCE(spot_real_reserved_capital_usd, 0) as reserved
      FROM bot_config LIMIT 1
    `);
    const reserved = Number(reservedResult.rows[0]?.reserved ?? 0);
    const available = balance - reserved;
    return Math.max(0, available);
  } catch (error: any) {
    console.error(`[SpotEngine] getRealQuoteBalance: exchange balance query failed: ${error.message} — returning 0 (fail-closed)`);
    return 0;
  }
}

/**
 * R10.4: Durable per-intent REAL capital reservation.
 * Atomically inserts the order_intent with reserved_quote_usd AND increments
 * spot_real_reserved_capital_usd in bot_config in a SINGLE transaction.
 *
 * This replaces the old reserveRealCapital which was not durable — if the process
 * crashed between reservation and order submission, the capital was leaked.
 * With reserved_quote_usd on the intent, the reconciler can release it on restart.
 *
 * Returns true if reservation succeeded, false if insufficient capital.
 */
async function persistAndReserveRealEntryIntentAtomic(
  params: CreateSubmissionIntentParams,
  clientOrderId: string,
  venue: string,
  notionalUsd: number,
): Promise<{ alreadySubmitted: boolean }> {
  return await db.transaction(async (tx) => {
    // 1. Lock bot_config and check available capital
    const configRow = await tx.execute(sql`
      SELECT COALESCE(spot_real_reserved_capital_usd, 0) as reserved
      FROM bot_config
      FOR UPDATE
      LIMIT 1
    `);
    if (configRow.rows.length === 0) {
      throw new RealIntentPersistenceError("persistAndReserve: bot_config row not found");
    }
    const currentReserved = Number(configRow.rows[0].reserved);

    // 2. Insert order_intent with reserved_quote_usd — ON CONFLICT DO NOTHING
    const insertResult = await tx.execute(sql`
      INSERT INTO order_intents (
        client_order_id, exchange, pair, side, volume, status,
        internal_intent_id, engine_owner, policy_version, execution_mode,
        lot_id, requested_price, order_type, reason, reserved_quote_usd
      ) VALUES (
        ${clientOrderId}, ${venue}, ${params.pair}, ${params.side.toLowerCase()},
        ${params.requestedQty.toString()}, 'pending',
        ${params.internalIntentId}, ${SPOT_ENGINE_OWNER}, ${SPOT_POLICY_VERSION},
        ${params.executionMode},
        ${params.lotId}, ${params.requestedPrice?.toString() ?? null},
        ${params.orderType}, ${params.reason},
        ${notionalUsd.toString()}
      )
      ON CONFLICT (client_order_id) DO NOTHING
      RETURNING id, client_order_id
    `);

    if (insertResult.rows.length === 0) {
      // Already exists — duplicate submission
      return { alreadySubmitted: true };
    }

    // 3. Increment reserved capital
    const newReserved = currentReserved + notionalUsd;
    await tx.execute(sql`
      UPDATE bot_config SET
        spot_real_reserved_capital_usd = ${newReserved},
        updated_at = NOW()
    `);

    return { alreadySubmitted: false };
  });
}

/**
 * Count open SPOT positions for a pair (B03: only SPOT_CANONICAL).
 */
async function countOpenLotsForPair(pair: string): Promise<number> {
  try {
    const result = await db.execute(sql`
      SELECT COUNT(*) as count FROM open_positions
      WHERE pair = ${pair} AND status != 'CLOSED'
        AND policy_version = ${SPOT_POLICY_VERSION}
    `);
    return Number(result.rows[0]?.count ?? 0);
  } catch {
    return 0;
  }
}

/**
 * Get open positions for a pair from DB — B03: only SPOT_CANONICAL positions.
 */
async function getOpenPositionsForPair(pair: string): Promise<OpenPositionRow[]> {
  try {
    const result = await db.execute(sql`
      SELECT
        lot_id, pair, entry_price, amount, qty_remaining, highest_price,
        entry_fee, entry_strategy_id, entry_signal_tf, signal_confidence,
        signal_reason, execution_mode, policy_version, engine_owner, setup_tag, signal_id,
        market_context_id, regime_at_entry, direction_at_entry, macro_at_entry,
        atr_pct_at_entry, initial_stop_price, initial_stop_distance_pct,
        initial_stop_distance_usd, risk_usd, mfe, mae, mfe_r, mae_r,
        sg_break_even_activated, sg_trailing_activated, sg_current_stop_price,
        break_even_stop_price, trailing_stop_price, trailing_highest_price, lowest_price,
        filled_notional_usd,
        EXTRACT(EPOCH FROM opened_at) * 1000 as opened_at_ms
      FROM open_positions
      WHERE pair = ${pair} AND status != 'CLOSED'
        AND policy_version = ${SPOT_POLICY_VERSION}
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
      engineOwner: r.engine_owner,
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
      breakEvenStopPrice: r.break_even_stop_price ? Number(r.break_even_stop_price) : null,
      trailingStopPrice: r.trailing_stop_price ? Number(r.trailing_stop_price) : null,
      trailingHighestPrice: r.trailing_highest_price ? Number(r.trailing_highest_price) : null,
      lowestPrice: r.lowest_price ? Number(r.lowest_price) : null,
      filledNotionalUsd: r.filled_notional_usd ? Number(r.filled_notional_usd) : null,
      openedAt: Number(r.opened_at_ms),
    }));
  } catch (error) {
    console.error(`[SpotEngine] Failed to get open positions for ${pair}:`, error);
    return [];
  }
}

/**
 * Load all open positions from DB on startup.
 * R10.1: Real reconciliation via exchange API for PENDING_FILL and EXIT_PENDING.
 * Only marks UNCERTAIN when exchange API cannot resolve the state.
 */
async function loadOpenPositionsFromDB(): Promise<void> {
  try {
    const result = await db.execute(sql`
      SELECT lot_id, pair, status, execution_mode, client_order_id, venue_order_id,
             entry_price, amount, qty_remaining, highest_price,
             entry_fee, entry_strategy_id, entry_signal_tf, signal_confidence,
             signal_reason, setup_tag, signal_id, market_context_id,
             regime_at_entry, direction_at_entry, macro_at_entry, atr_pct_at_entry,
             initial_stop_price, initial_stop_distance_pct, initial_stop_distance_usd,
             risk_usd, mfe, mae, mfe_r, mae_r,
             sg_break_even_activated, sg_trailing_activated, sg_current_stop_price,
             break_even_stop_price, trailing_stop_price, trailing_highest_price, lowest_price,
             filled_notional_usd,
             EXTRACT(EPOCH FROM opened_at) * 1000 as opened_at_ms
      FROM open_positions
      WHERE policy_version = ${SPOT_POLICY_VERSION} AND status != 'CLOSED'
    `);
    console.log(`[SpotEngine] Loaded ${result.rows.length} open positions from DB`);

    for (const row of result.rows) {
      const status = row.status as string;
      const execMode = row.execution_mode as string;
      const venueOrderId = row.venue_order_id as string | null;
      const clientOrderId = row.client_order_id as string | null;

      // R10.1: Reconciliation for PENDING_FILL / EXIT_PENDING positions
      if (status === 'PENDING_FILL' || status === 'EXIT_PENDING') {
        if (execMode === 'REAL' && venueOrderId) {
          // R10.1: Query exchange API for real order status
          const reconciled = await reconcileRealOrder(row, venueOrderId);
          if (reconciled === 'FILLED') {
            console.log(`[SpotEngine] RECONCILED: ${row.lot_id} was ${status}, exchange says FILLED`);
            // For PENDING_FILL entry: create open_position with real fill price
            // For EXIT_PENDING: close position with real fill price
            // The reconciliation updates the position in DB
            continue;
          } else if (reconciled === 'FAILED' || reconciled === 'CANCELLED') {
            console.log(`[SpotEngine] RECONCILED: ${row.lot_id} was ${status}, exchange says ${reconciled}`);
            // Remove failed entry or restore position from failed exit
            if (status === 'PENDING_FILL') {
              await db.execute(sql`DELETE FROM open_positions WHERE lot_id = ${row.lot_id}`);
            } else {
              // EXIT_PENDING → restore to OPEN (exit failed)
              await db.execute(sql`
                UPDATE open_positions SET status = 'OPEN', updated_at = NOW()
                WHERE lot_id = ${row.lot_id}
              `);
            }
            logActivity({
              pair: row.pair as string,
              category: "SYSTEM",
              severity: "WARNING",
              title: `Orden ${reconciled} tras reinicio`,
              explanation: `Posición ${row.lot_id} reconciliada: ${status} → ${reconciled}`,
              decision: "RECONCILED",
              executionMode: execMode as any,
              reasonCode: `RESTART_${reconciled}`,
              lotId: row.lot_id as string,
              orderId: venueOrderId,
            });
            continue;
          } else if (reconciled === 'PENDING') {
            // Still pending — keep as-is, supervisor will continue monitoring
            console.log(`[SpotEngine] RECONCILED: ${row.lot_id} still PENDING on exchange`);
            continue;
          }
          // reconciled === 'UNCERTAIN' — fall through to UNCERTAIN marking
        }

        // R10.1: Only mark UNCERTAIN when truly unresolved
        console.warn(
          `[SpotEngine] RECOVERY: Position ${row.lot_id} has status=${status}, ` +
          `executionMode=${execMode}, orderId=${venueOrderId}, clientOrderId=${clientOrderId}. ` +
          `Exchange API could not resolve. Marking as UNCERTAIN for manual review.`
        );
        await db.execute(sql`
          UPDATE open_positions SET status = 'UNCERTAIN', updated_at = NOW()
          WHERE lot_id = ${row.lot_id}
        `);
        logActivity({
          pair: row.pair as string,
          category: "SYSTEM",
          severity: "CRITICAL",
          title: "Posición incierta tras reinicio",
          explanation: `Posición ${row.lot_id} tenía status=${status}. Exchange API no pudo resolver. Marcada como UNCERTAIN.`,
          decision: "FAIL_CLOSED",
          executionMode: execMode as any,
          reasonCode: "RESTART_UNCERTAIN",
          lotId: row.lot_id as string,
          orderId: venueOrderId,
        });
        continue;
      }

      // Normal position recovery
      const position = rowToPosition({
        lotId: row.lot_id as string,
        pair: row.pair as string,
        entryPrice: Number(row.entry_price),
        amount: Number(row.amount),
        qtyRemaining: row.qty_remaining ? Number(row.qty_remaining) : Number(row.amount),
        highestPrice: Number(row.highest_price),
        entryFee: Number(row.entry_fee ?? 0),
        entryStrategyId: row.entry_strategy_id as string,
        entrySignalTf: row.entry_signal_tf as string,
        signalConfidence: Number(row.signal_confidence ?? 0),
        signalReason: row.signal_reason as string,
        executionMode: execMode as ExecutionMode,
        policyVersion: SPOT_POLICY_VERSION,
        engineOwner: row.engine_owner as string,
        setupTag: row.setup_tag as any,
        signalId: row.signal_id as string,
        marketContextId: row.market_context_id as string,
        regimeAtEntry: row.regime_at_entry as any,
        directionAtEntry: row.direction_at_entry as any,
        macroAtEntry: row.macro_at_entry as any,
        atrPctAtEntry: row.atr_pct_at_entry ? Number(row.atr_pct_at_entry) : null,
        initialStopPrice: row.initial_stop_price ? Number(row.initial_stop_price) : null,
        initialStopDistancePct: row.initial_stop_distance_pct ? Number(row.initial_stop_distance_pct) : null,
        initialStopDistanceUsd: row.initial_stop_distance_usd ? Number(row.initial_stop_distance_usd) : null,
        riskUsd: row.risk_usd ? Number(row.risk_usd) : null,
        mfe: Number(row.mfe ?? 0),
        mae: Number(row.mae ?? 0),
        mfeR: Number(row.mfe_r ?? 0),
        maeR: Number(row.mae_r ?? 0),
        sgBreakEvenActivated: Boolean(row.sg_break_even_activated),
        sgTrailingActivated: Boolean(row.sg_trailing_activated),
        sgCurrentStopPrice: row.sg_current_stop_price ? Number(row.sg_current_stop_price) : null,
        breakEvenStopPrice: row.break_even_stop_price ? Number(row.break_even_stop_price) : null,
        trailingStopPrice: row.trailing_stop_price ? Number(row.trailing_stop_price) : null,
        trailingHighestPrice: row.trailing_highest_price ? Number(row.trailing_highest_price) : null,
        lowestPrice: row.lowest_price ? Number(row.lowest_price) : null,
        filledNotionalUsd: row.filled_notional_usd ? Number(row.filled_notional_usd) : null,
        openedAt: Number(row.opened_at_ms),
      });
      auditTracker.restorePosition(position, {
        mfeUsd: Number(row.mfe ?? 0),
        maeUsd: Number(row.mae ?? 0),
        mfeR: Number(row.mfe_r ?? 0),
        maeR: Number(row.mae_r ?? 0),
        highestPrice: Number(row.highest_price),
        lowestPrice: row.lowest_price ? Number(row.lowest_price) : position.entryPrice,
        mfeTimestamp: position.openedAt,
        maeTimestamp: position.openedAt,
      });
      const exitState = restoreExitState(position, {
        lotId: row.lot_id as string,
        sgBreakEvenActivated: Boolean(row.sg_break_even_activated),
        sgTrailingActivated: Boolean(row.sg_trailing_activated),
        sgCurrentStopPrice: row.sg_current_stop_price ? Number(row.sg_current_stop_price) : null,
        breakEvenStopPrice: row.break_even_stop_price ? Number(row.break_even_stop_price) : null,
        trailingStopPrice: row.trailing_stop_price ? Number(row.trailing_stop_price) : null,
        trailingHighestPrice: row.trailing_highest_price ? Number(row.trailing_highest_price) : null,
        highestPrice: Number(row.highest_price),
        lowestPrice: row.lowest_price ? Number(row.lowest_price) : null,
        mfe: Number(row.mfe ?? 0),
        mae: Number(row.mae ?? 0),
        mfeR: Number(row.mfe_r ?? 0),
        maeR: Number(row.mae_r ?? 0),
      } as any);
      exitStates.set(position.lotId, exitState);
    }
  } catch (error) {
    console.error("[SpotEngine] Failed to load open positions:", error);
  }
}

/**
 * R10.2: Reconcile pending REAL order_intents at restart.
 * Domain separation:
 *   - ENTRY intents: in order_intents (side='buy', status pending/accepted)
 *   - EXIT intents: in open_positions (status='EXIT_PENDING')
 *
 * For each pending entry intent:
 *   - FILLED → create open_position exactly once (SELECT FOR UPDATE guard)
 *   - PENDING → keep in order_intents, supervisor will monitor
 *   - FAILED/CANCELLED → finalize in order_intents
 *   - UNCERTAIN → block, mark UNCERTAIN
 */
async function reconcilePendingRealOrderIntents(): Promise<void> {
  const pendingIntents = await loadPendingRealOrders();
  if (pendingIntents.length === 0) {
    console.log("[SpotEngine] R10.2: No pending REAL order_intents to reconcile");
    return;
  }

  console.log(`[SpotEngine] R10.2: Reconciling ${pendingIntents.length} pending REAL order_intents`);

  for (const intent of pendingIntents) {
    // Only reconcile entry intents (side=BUY) here — exit intents are in open_positions
    if (intent.side !== "BUY") continue;

    if (!intent.venueOrderId) {
      // No venue order ID — cannot query exchange. Mark UNCERTAIN.
      console.warn(`[SpotEngine] R10.2: Intent ${intent.internalIntentId} has no venueOrderId — marking UNCERTAIN`);
      await updateSubmissionResult(intent.internalIntentId, { status: "UNCERTAIN" });
      logActivity({
        pair: intent.pair,
        category: "SYSTEM",
        severity: "CRITICAL",
        title: "Intent incierta tras reinicio — sin venueOrderId",
        explanation: `Intent ${intent.internalIntentId} no tiene venueOrderId. No se puede reconciliar con exchange.`,
        decision: "FAIL_CLOSED",
        executionMode: ExecutionMode.REAL,
        reasonCode: "RESTART_NO_VENUE_ID",
        intentId: intent.internalIntentId,
      });
      continue;
    }

    const reconciled = await reconcileRealOrderViaExchange(intent.venueOrderId);

    if (reconciled.state === "FILLED") {
      // R10.2: Exactly-once — check if open_position already exists for this clientOrderId
      try {
        const existing = await db.execute(sql`
          SELECT lot_id FROM open_positions
          WHERE client_order_id = ${intent.clientOrderId}
            AND status != 'CLOSED'
          FOR UPDATE
        `);
        if (existing.rows.length > 0) {
          console.log(`[SpotEngine] R10.2: Intent ${intent.internalIntentId} already has open_position ${existing.rows[0].lot_id} — skipping`);
          await updateSubmissionResult(intent.internalIntentId, {
            status: "FILLED",
            fillPrice: reconciled.fillPrice,
            fillVolume: reconciled.fillVolume,
          });
          continue;
        }
      } catch (error: any) {
        console.warn(`[SpotEngine] R10.2: Guard check failed for ${intent.clientOrderId}: ${error.message}`);
      }

      // Create open_position with real fill data
      const fillPrice = reconciled.fillPrice!;
      const fillVolume = reconciled.fillVolume!;
      const filledNotionalUsd = fillPrice * fillVolume;
      const lotId = `spot-${intent.pair}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

      const venue = await getTradingVenue();
      await db.execute(sql`
        INSERT INTO open_positions (
          lot_id, exchange, pair, entry_price, amount, qty_remaining, highest_price,
          entry_strategy_id, entry_signal_tf, signal_confidence, signal_reason,
          entry_fee, status, opened_at,
          execution_mode, policy_version, engine_owner, origin, setup_tag, signal_id, market_context_id,
          regime_at_entry, direction_at_entry, macro_at_entry, atr_pct_at_entry,
          initial_stop_price, initial_stop_distance_pct, initial_stop_distance_usd,
          risk_usd, mfe, mae, mfe_r, mae_r,
          sg_break_even_activated, sg_trailing_activated, sg_current_stop_price,
          break_even_stop_price, trailing_stop_price, trailing_highest_price, lowest_price,
          filled_notional_usd, client_order_id, venue_order_id
        ) VALUES (
          ${lotId}, ${venue}, ${intent.pair}, ${fillPrice},
          ${fillVolume}, ${fillVolume}, ${fillPrice},
          'SPOT_CANONICAL', '15m', 0, ${intent.reason ?? ''},
          0, 'OPEN', NOW(),
          'REAL', ${SPOT_POLICY_VERSION}, ${SPOT_ENGINE_OWNER}, ${SPOT_ORIGIN},
          ${intent.reason ?? ''}, '', '',
          'RANGE', 'NEUTRAL', 'NEUTRAL', 0,
          null, null, null,
          null, 0, 0, 0, 0,
          false, false, null,
          null, null, ${fillPrice}, ${fillPrice},
          ${filledNotionalUsd}, ${intent.clientOrderId}, ${intent.venueOrderId}
        )
        RETURNING lot_id
      `);

      await updateSubmissionResult(intent.internalIntentId, {
        status: "FILLED",
        venueOrderId: intent.venueOrderId,
        fillPrice,
        fillVolume,
      });

      logActivity({
        pair: intent.pair,
        category: "SYSTEM",
        severity: "SUCCESS",
        title: "Entrada reconciliada desde order_intents",
        explanation: `Intent ${intent.internalIntentId} reconciled: FILLED @ ${fillPrice}, lot=${lotId}`,
        decision: "RECONCILED",
        executionMode: ExecutionMode.REAL,
        reasonCode: "RESTART_ENTRY_FILLED_FROM_INTENTS",
        intentId: intent.internalIntentId,
        lotId,
        orderId: intent.venueOrderId,
        price: fillPrice,
      });
    } else if (reconciled.state === "FAILED" || reconciled.state === "CANCELLED") {
      await updateSubmissionResult(intent.internalIntentId, { status: reconciled.state });
      logActivity({
        pair: intent.pair,
        category: "SYSTEM",
        severity: "WARNING",
        title: `Intent ${reconciled.state} tras reinicio`,
        explanation: `Entry intent ${intent.internalIntentId} reconciled: ${reconciled.state}`,
        decision: "RECONCILED",
        executionMode: ExecutionMode.REAL,
        reasonCode: `RESTART_ENTRY_${reconciled.state}`,
        intentId: intent.internalIntentId,
        orderId: intent.venueOrderId,
      });
    } else if (reconciled.state === "PENDING") {
      console.log(`[SpotEngine] R10.2: Intent ${intent.internalIntentId} still PENDING on exchange`);
    } else {
      // UNCERTAIN — block
      await updateSubmissionResult(intent.internalIntentId, { status: "UNCERTAIN" });
      logActivity({
        pair: intent.pair,
        category: "SYSTEM",
        severity: "CRITICAL",
        title: "Intent incierta tras reinicio",
        explanation: `Entry intent ${intent.internalIntentId} — exchange API could not resolve. Marked UNCERTAIN.`,
        decision: "FAIL_CLOSED",
        executionMode: ExecutionMode.REAL,
        reasonCode: "RESTART_UNCERTAIN",
        intentId: intent.internalIntentId,
        orderId: intent.venueOrderId,
      });
    }
  }
}

/**
 * R10.2: Query exchange API for real order status.
 * Returns { state, fillPrice, fillVolume }.
 */
async function reconcileRealOrderViaExchange(venueOrderId: string): Promise<{
  state: "FILLED" | "FAILED" | "CANCELLED" | "PENDING" | "UNCERTAIN";
  fillPrice: number | null;
  fillVolume: number | null;
}> {
  try {
    const exchange = ExchangeFactory.getTradingExchange();
    if (!exchange.isInitialized()) {
      console.warn(`[SpotEngine] Exchange not initialized — cannot reconcile ${venueOrderId}`);
      return { state: "UNCERTAIN", fillPrice: null, fillVolume: null };
    }

    const anyExchange = exchange as any;
    if (typeof anyExchange.getOrder !== "function") {
      console.warn(`[SpotEngine] Exchange does not support getOrder — cannot reconcile ${venueOrderId}`);
      return { state: "UNCERTAIN", fillPrice: null, fillVolume: null };
    }

    const order = await anyExchange.getOrder(venueOrderId);
    if (order === null) {
      return { state: "CANCELLED", fillPrice: null, fillVolume: null };
    }

    const orderStatus = (order.status || "").toLowerCase();
    const filledSize = order.filledSize ?? 0;
    const averagePrice = order.averagePrice ?? 0;

    if (orderStatus === "filled" || (filledSize > 0 && averagePrice > 0)) {
      return { state: "FILLED", fillPrice: averagePrice, fillVolume: filledSize };
    }

    if (orderStatus === "cancelled" || orderStatus === "expired" || orderStatus === "rejected") {
      return { state: "CANCELLED", fillPrice: null, fillVolume: null };
    }

    if (orderStatus === "open" || orderStatus === "pending" || orderStatus === "accepted" || orderStatus === "new") {
      return { state: "PENDING", fillPrice: null, fillVolume: null };
    }

    console.warn(`[SpotEngine] Exchange returned unknown order status: ${orderStatus} for ${venueOrderId}`);
    return { state: "UNCERTAIN", fillPrice: null, fillVolume: null };
  } catch (error: any) {
    console.warn(`[SpotEngine] Reconciliation failed for ${venueOrderId}: ${error.message}`);
    return { state: "UNCERTAIN", fillPrice: null, fillVolume: null };
  }
}

/**
 * R10.1: Reconcile a real order via exchange API.
 * Returns 'FILLED', 'FAILED', 'CANCELLED', 'PENDING', or 'UNCERTAIN'.
 */
async function reconcileRealOrder(row: any, venueOrderId: string): Promise<string> {
  try {
    const exchange = ExchangeFactory.getTradingExchange();
    if (!exchange.isInitialized()) {
      console.warn(`[SpotEngine] Exchange not initialized — cannot reconcile ${venueOrderId}`);
      return "UNCERTAIN";
    }

    // Use getOrder if available (RevolutXService has it)
    const anyExchange = exchange as any;
    if (typeof anyExchange.getOrder === "function") {
      const order = await anyExchange.getOrder(venueOrderId);
      if (order === null) {
        // Order not found — could be expired/cancelled
        return "CANCELLED";
      }

      const orderStatus = (order.status || "").toLowerCase();
      const filledSize = order.filledSize ?? 0;
      const averagePrice = order.averagePrice ?? 0;

      if (orderStatus === "filled" || (filledSize > 0 && averagePrice > 0)) {
        // R10.1: Reconcile fill — update position with real fill data
        const fillPrice = averagePrice;
        const fillVolume = filledSize;

        if (row.status === 'PENDING_FILL') {
          // Entry was pending — now confirmed filled, update position with real price
          const filledNotionalUsd = fillPrice * fillVolume;
          await db.execute(sql`
            UPDATE open_positions SET
              status = 'OPEN',
              entry_price = ${fillPrice},
              amount = ${fillVolume},
              qty_remaining = ${fillVolume},
              highest_price = ${fillPrice},
              lowest_price = ${fillPrice},
              filled_notional_usd = ${filledNotionalUsd},
              updated_at = NOW()
            WHERE lot_id = ${row.lot_id}
          `);

          // Restore audit and exit state
          const position = rowToPosition({
            lotId: row.lot_id as string,
            pair: row.pair as string,
            entryPrice: fillPrice,
            amount: fillVolume,
            qtyRemaining: fillVolume,
            highestPrice: fillPrice,
            entryFee: Number(row.entry_fee ?? 0),
            entryStrategyId: row.entry_strategy_id as string,
            entrySignalTf: row.entry_signal_tf as string,
            signalConfidence: Number(row.signal_confidence ?? 0),
            signalReason: row.signal_reason as string,
            executionMode: row.execution_mode as ExecutionMode,
            policyVersion: SPOT_POLICY_VERSION,
            engineOwner: row.engine_owner as string,
            setupTag: row.setup_tag as any,
            signalId: row.signal_id as string,
            marketContextId: row.market_context_id as string,
            regimeAtEntry: row.regime_at_entry as any,
            directionAtEntry: row.direction_at_entry as any,
            macroAtEntry: row.macro_at_entry as any,
            atrPctAtEntry: row.atr_pct_at_entry ? Number(row.atr_pct_at_entry) : null,
            initialStopPrice: row.initial_stop_price ? Number(row.initial_stop_price) : null,
            initialStopDistancePct: row.initial_stop_distance_pct ? Number(row.initial_stop_distance_pct) : null,
            initialStopDistanceUsd: row.initial_stop_distance_usd ? Number(row.initial_stop_distance_usd) : null,
            riskUsd: row.risk_usd ? Number(row.risk_usd) : null,
            mfe: 0, mae: 0, mfeR: 0, maeR: 0,
            sgBreakEvenActivated: false,
            sgTrailingActivated: false,
            sgCurrentStopPrice: row.initial_stop_price ? Number(row.initial_stop_price) : null,
            breakEvenStopPrice: null,
            trailingStopPrice: null,
            trailingHighestPrice: null,
            lowestPrice: fillPrice,
            filledNotionalUsd: filledNotionalUsd,
            openedAt: Number(row.opened_at_ms),
          });
          auditTracker.initPosition(position);
          const exitState = createExitState(position);
          exitStates.set(position.lotId, exitState);

          logActivity({
            pair: row.pair as string,
            category: "SYSTEM",
            severity: "SUCCESS",
            title: "Entrada reconciliada — fill confirmado",
            explanation: `Posición ${row.lot_id} reconciliada: PENDING_FILL → OPEN @ ${fillPrice}`,
            decision: "RECONCILED",
            executionMode: row.execution_mode as any,
            reasonCode: "RESTART_ENTRY_FILLED",
            lotId: row.lot_id as string,
            orderId: venueOrderId,
            price: fillPrice,
          });
        } else if (row.status === 'EXIT_PENDING') {
          // Exit was pending — now confirmed filled, close position
          const entryPrice = Number(row.entry_price);
          const pnl = computePnlBreakdown({
            entryPrice,
            exitPrice: fillPrice,
            volume: fillVolume,
            entryFeeUsd: Number(row.entry_fee ?? 0),
          });

          const venue = await getTradingVenue();
          await db.execute(sql`
            INSERT INTO trades (
              trade_id, exchange, origin, executed_by_bot, pair, type, price, amount,
              status, entry_price, realized_pnl_usd, realized_pnl_pct, executed_at,
              execution_mode, policy_version, engine_owner, setup_tag, signal_id, market_context_id,
              gross_pnl_usd, entry_fee_usd, exit_fee_usd, execution_cost_usd, net_pnl_usd,
              fee_quality, lot_id, hold_time_minutes
            ) VALUES (
              ${`spot-trade-${row.lot_id}`}, ${venue}, ${SPOT_ORIGIN}, true,
              ${row.pair}, 'sell', ${fillPrice}, ${fillVolume},
              'closed', ${entryPrice}, ${pnl.netPnlUsd},
              ${entryPrice > 0 ? ((fillPrice - entryPrice) / entryPrice) * 100 : 0},
              NOW(),
              ${row.execution_mode}, ${SPOT_POLICY_VERSION}, ${SPOT_ENGINE_OWNER},
              ${row.setup_tag}, ${row.signal_id}, ${row.market_context_id},
              ${pnl.grossPnlUsd}, ${pnl.entryFeeUsd}, ${pnl.exitFeeUsd}, ${pnl.executionCostUsd},
              ${pnl.netPnlUsd}, 'ESTIMATED', ${row.lot_id},
              ${Math.round((Date.now() - Number(row.opened_at_ms)) / 60000)}
            )
            RETURNING trade_id
          `);
          await db.execute(sql`DELETE FROM open_positions WHERE lot_id = ${row.lot_id}`);

          logActivity({
            pair: row.pair as string,
            category: "SYSTEM",
            severity: "SUCCESS",
            title: "Salida reconciliada — fill confirmado",
            explanation: `Posición ${row.lot_id} cerrada: EXIT_PENDING → CLOSED @ ${fillPrice}, PnL=$${pnl.netPnlUsd.toFixed(2)}`,
            decision: "RECONCILED",
            executionMode: row.execution_mode as any,
            reasonCode: "RESTART_EXIT_FILLED",
            lotId: row.lot_id as string,
            orderId: venueOrderId,
            price: fillPrice,
          });
        }
        return "FILLED";
      }

      if (orderStatus === "cancelled" || orderStatus === "expired" || orderStatus === "rejected") {
        return "CANCELLED";
      }

      if (orderStatus === "open" || orderStatus === "pending" || orderStatus === "accepted" || orderStatus === "new") {
        return "PENDING";
      }

      // Unknown status
      console.warn(`[SpotEngine] Exchange returned unknown order status: ${orderStatus} for ${venueOrderId}`);
      return "UNCERTAIN";
    }

    // No getOrder method available — cannot reconcile
    console.warn(`[SpotEngine] Exchange does not support getOrder — cannot reconcile ${venueOrderId}`);
    return "UNCERTAIN";
  } catch (error: any) {
    console.warn(`[SpotEngine] Reconciliation failed for ${venueOrderId}: ${error.message}`);
    return "UNCERTAIN";
  }
}

/**
 * R10.3: Atomic REAL entry fill materialization — exactly-once.
 * Transaction: lock order_intent → check open_position doesn't exist → INSERT open_position → UPDATE order_intent FILLED → COMMIT.
 * Throws on any failure — caller must handle UNCERTAIN marking.
 */
async function finalizeRealEntryFillAtomic(
  position: SpotPosition,
  execResult: SpotExecutionResult,
  filledNotionalUsd: number,
  internalIntentId: string,
  clientOrderId: string,
): Promise<void> {
  const venue = await getTradingVenue();
  const venueOrderId = execResult.venueOrderId ?? execResult.orderId ?? null;

  await db.transaction(async (tx) => {
    // 1. Lock the order_intent row
    const intentRow = await tx.execute(sql`
      SELECT id FROM order_intents
      WHERE client_order_id = ${clientOrderId}
      FOR UPDATE
    `);
    if (intentRow.rows.length === 0) {
      throw new Error(`order_intent not found for clientOrderId=${clientOrderId}`);
    }

    // 2. Check if open_position already exists (exactly-once guard)
    const existing = await tx.execute(sql`
      SELECT lot_id FROM open_positions
      WHERE client_order_id = ${clientOrderId}
        AND status != 'CLOSED'
      FOR UPDATE
    `);
    if (existing.rows.length > 0) {
      // Already materialized — just update intent to FILLED
      await tx.execute(sql`
        UPDATE order_intents SET
          status = 'filled',
          exchange_order_id = COALESCE(${venueOrderId}, exchange_order_id),
          fill_price = COALESCE(${execResult.fillPrice?.toString() ?? null}, fill_price),
          fill_volume = COALESCE(${execResult.fillVolume?.toString() ?? null}, fill_volume),
          fee_usd = COALESCE(${execResult.feeUsd?.toString() ?? null}, fee_usd),
          updated_at = NOW()
        WHERE client_order_id = ${clientOrderId}
      `);
      return;
    }

    // 3. INSERT open_position
    await tx.execute(sql`
      INSERT INTO open_positions (
        lot_id, exchange, pair, entry_price, amount, qty_remaining, highest_price,
        entry_strategy_id, entry_signal_tf, signal_confidence, signal_reason,
        entry_fee, status, opened_at,
        execution_mode, policy_version, engine_owner, origin, setup_tag, signal_id, market_context_id,
        regime_at_entry, direction_at_entry, macro_at_entry, atr_pct_at_entry,
        initial_stop_price, initial_stop_distance_pct, initial_stop_distance_usd,
        risk_usd, mfe, mae, mfe_r, mae_r,
        sg_break_even_activated, sg_trailing_activated, sg_current_stop_price,
        break_even_stop_price, trailing_stop_price, trailing_highest_price, lowest_price,
        filled_notional_usd, client_order_id, venue_order_id
      ) VALUES (
        ${position.lotId}, ${venue}, ${position.pair}, ${position.entryPrice},
        ${position.amount}, ${position.qtyRemaining}, ${position.highestPrice},
        ${position.entryStrategyId}, ${position.entrySignalTf},
        ${position.signalConfidence}, ${position.signalReason},
        ${position.entryFee}, 'OPEN', NOW(),
        ${position.executionMode}, ${position.policyVersion}, ${SPOT_ENGINE_OWNER}, ${SPOT_ORIGIN},
        ${position.setupTag}, ${position.signalId}, ${position.marketContextId},
        ${position.regimeAtEntry}, ${position.directionAtEntry}, ${position.macroAtEntry},
        ${position.atrPctAtEntry}, ${position.initialStopPrice},
        ${position.initialStopDistancePct}, ${position.initialStopDistanceUsd},
        ${position.riskUsd}, 0, 0, 0, 0,
        false, false, ${position.sgCurrentStopPrice},
        null, null, ${position.highestPrice}, ${position.entryPrice},
        ${filledNotionalUsd}, ${clientOrderId}, ${venueOrderId}
      )
      RETURNING lot_id
    `);

    // 4. UPDATE order_intent to FILLED
    await tx.execute(sql`
      UPDATE order_intents SET
        status = 'filled',
        exchange_order_id = COALESCE(${venueOrderId}, exchange_order_id),
        fill_price = COALESCE(${execResult.fillPrice?.toString() ?? null}, fill_price),
        fill_volume = COALESCE(${execResult.fillVolume?.toString() ?? null}, fill_volume),
        fee_usd = COALESCE(${execResult.feeUsd?.toString() ?? null}, fee_usd),
        updated_at = NOW()
      WHERE client_order_id = ${clientOrderId}
      RETURNING id
    `);
  });

  // Update in-memory cache after successful COMMIT
  const cached = getCachedRecord(internalIntentId);
  if (cached) {
    cached.status = "FILLED";
    cached.venueOrderId = venueOrderId;
    cached.fillPrice = execResult.fillPrice;
    cached.fillVolume = execResult.fillVolume;
    cached.feeUsd = execResult.feeUsd;
  }
}

/**
 * R10.3: Atomic REAL exit fill materialization — exactly-once.
 * Transaction: lock order_intent → lock open_position → check trade doesn't exist
 * → INSERT trade → DELETE open_position → UPDATE order_intent FILLED → COMMIT.
 * Throws on any failure — caller must handle UNCERTAIN marking.
 */
async function finalizeRealExitFillAtomic(
  position: SpotPosition,
  execResult: SpotExecutionResult,
  pnl: { grossPnlUsd: number; netPnlUsd: number; entryFeeUsd: number; exitFeeUsd: number; executionCostUsd: number },
  exitDecision: SpotExitDecision,
  auditMetrics: SpotAuditMetrics | null,
  internalIntentId: string,
): Promise<void> {
  const venue = await getTradingVenue();
  const venueOrderId = execResult.venueOrderId ?? execResult.orderId ?? null;
  const tradeId = `spot-trade-${position.lotId}`;

  await db.transaction(async (tx) => {
    // 1. Lock the order_intent row
    const intentRow = await tx.execute(sql`
      SELECT id, client_order_id FROM order_intents
      WHERE internal_intent_id = ${internalIntentId}
      FOR UPDATE
    `);
    if (intentRow.rows.length === 0) {
      throw new Error(`order_intent not found for internalIntentId=${internalIntentId}`);
    }
    const clientOrderId = intentRow.rows[0].client_order_id;

    // 2. Lock open_position
    const posRow = await tx.execute(sql`
      SELECT lot_id FROM open_positions
      WHERE lot_id = ${position.lotId} AND status != 'CLOSED'
      FOR UPDATE
    `);
    if (posRow.rows.length === 0) {
      // Position already closed — just update intent
      await tx.execute(sql`
        UPDATE order_intents SET status = 'filled', updated_at = NOW()
        WHERE internal_intent_id = ${internalIntentId}
      `);
      return;
    }

    // 3. Check if trade already exists (exactly-once guard)
    const existingTrade = await tx.execute(sql`
      SELECT trade_id FROM trades WHERE lot_id = ${position.lotId} FOR UPDATE
    `);
    if (existingTrade.rows.length > 0) {
      // Trade already inserted — just update intent and delete position
      await tx.execute(sql`DELETE FROM open_positions WHERE lot_id = ${position.lotId}`);
      await tx.execute(sql`
        UPDATE order_intents SET status = 'filled', updated_at = NOW()
        WHERE internal_intent_id = ${internalIntentId}
      `);
      return;
    }

    // 4. INSERT trade
    const holdTimeMinutes = Math.round((Date.now() - position.openedAt) / 60000);
    await tx.execute(sql`
      INSERT INTO trades (
        trade_id, exchange, origin, executed_by_bot, pair, type, price, amount,
        status, entry_price, realized_pnl_usd, realized_pnl_pct, executed_at,
        execution_mode, policy_version, engine_owner, setup_tag, signal_id, market_context_id,
        gross_pnl_usd, entry_fee_usd, exit_fee_usd, execution_cost_usd, net_pnl_usd,
        fee_quality, mfe, mae, mfe_r, mae_r, profit_capture_pct, exit_reason_type,
        lot_id, hold_time_minutes
      ) VALUES (
        ${tradeId}, ${venue}, ${SPOT_ORIGIN}, true, ${position.pair}, 'sell',
        ${execResult.fillPrice}, ${position.qtyRemaining},
        'closed', ${position.entryPrice}, ${pnl.netPnlUsd},
        ${position.entryPrice > 0 ? ((execResult.fillPrice! - position.entryPrice) / position.entryPrice) * 100 : 0},
        NOW(),
        ${position.executionMode}, ${position.policyVersion}, ${SPOT_ENGINE_OWNER},
        ${position.setupTag}, ${position.signalId}, ${position.marketContextId},
        ${pnl.grossPnlUsd}, ${pnl.entryFeeUsd}, ${pnl.exitFeeUsd}, ${pnl.executionCostUsd},
        ${pnl.netPnlUsd}, ${execResult.fillQuality},
        ${auditMetrics?.mfeUsd ?? 0}, ${auditMetrics?.maeUsd ?? 0},
        ${auditMetrics?.mfeR ?? 0}, ${auditMetrics?.maeR ?? 0},
        ${auditMetrics?.exitAudit?.profitCapturePct ?? null},
        ${exitDecision.reasonType}, ${position.lotId}, ${holdTimeMinutes}
      )
      RETURNING trade_id
    `);

    // 5. DELETE open_position
    await tx.execute(sql`DELETE FROM open_positions WHERE lot_id = ${position.lotId}`);

    // 6. UPDATE order_intent to FILLED
    await tx.execute(sql`
      UPDATE order_intents SET
        status = 'filled',
        exchange_order_id = COALESCE(${venueOrderId}, exchange_order_id),
        fill_price = COALESCE(${execResult.fillPrice?.toString() ?? null}, fill_price),
        fill_volume = COALESCE(${execResult.fillVolume?.toString() ?? null}, fill_volume),
        fee_usd = COALESCE(${execResult.feeUsd?.toString() ?? null}, fee_usd),
        updated_at = NOW()
      WHERE internal_intent_id = ${internalIntentId}
      RETURNING id
    `);
  });

  // Update in-memory cache after successful COMMIT
  const cached = getCachedRecord(internalIntentId);
  if (cached) {
    cached.status = "FILLED";
    cached.venueOrderId = venueOrderId;
    cached.fillPrice = execResult.fillPrice;
    cached.fillVolume = execResult.fillVolume;
    cached.feeUsd = execResult.feeUsd;
  }
}

/**
 * R10.3: Prepare REAL activation — reconciliation BEFORE mode change.
 * Called from POST /api/spot/mode when transitioning to REAL.
 * Does NOT depend on SpotEngine being started.
 *
 * Flow:
 *   1. checkRealReadiness (preliminary)
 *   2. loadPendingRealOrders (fail-closed)
 *   3. reconcile pendings
 *   4. re-check readiness
 *   5. return { ready, readiness, error? }
 */
export async function prepareRealActivation(): Promise<{
  ready: boolean;
  readiness: any;
  error?: string;
}> {
  // 1. Preliminary readiness check
  const { checkRealReadiness } = await import("./spotRealReadiness");
  const readiness = await checkRealReadiness();
  if (!readiness.ready) {
    return { ready: false, readiness, error: "Preliminary readiness checks failed" };
  }

  // 2. Load pending REAL orders (fail-closed)
  let pendingOrders: Awaited<ReturnType<typeof loadPendingRealOrders>>;
  try {
    pendingOrders = await loadPendingRealOrders();
  } catch (error: any) {
    return { ready: false, readiness, error: `LOAD_PENDING_DB_FAILURE: ${error.message}` };
  }

  // 3. Reconcile pendings if any
  if (pendingOrders.length > 0) {
    console.log(`[SpotEngine] R10.3: prepareRealActivation — reconciling ${pendingOrders.length} pending orders`);
    try {
      await reconcilePendingRealOrderIntents();
    } catch (error: any) {
      return { ready: false, readiness, error: `RECONCILIATION_FAILED: ${error.message}` };
    }
  }

  // 4. Re-check readiness after reconciliation
  const finalReadiness = await checkRealReadiness();
  if (!finalReadiness.ready) {
    return { ready: false, readiness: finalReadiness, error: "Post-reconciliation readiness checks failed" };
  }

  // R10.4: Freeze gate — no REAL activation if unresolved executions remain
  const frozen = await hasUnresolvedRealExecution();
  if (frozen) {
    return { ready: false, readiness: finalReadiness, error: "UNRESOLVED_REAL_EXECUTIONS: freeze gate active" };
  }

  return { ready: true, readiness: finalReadiness };
}

/**
 * Persist a new open position to DB.
 * B09: exchange uses real venue (revolutx/kraken), NOT 'spot'.
 * B08: engine_owner and origin identify the SPOT engine.
 */
async function persistOpenPosition(position: SpotPosition, execResult: SpotExecutionResult, filledNotionalUsd: number): Promise<void> {
  const venue = await getTradingVenue();
  // R10.1: Persist real clientOrderId and venueOrderId from execution result
  const clientOrderId = execResult.clientOrderId ?? null;
  const venueOrderId = execResult.venueOrderId ?? execResult.orderId ?? null;
  await db.execute(sql`
    INSERT INTO open_positions (
      lot_id, exchange, pair, entry_price, amount, qty_remaining, highest_price,
      entry_strategy_id, entry_signal_tf, signal_confidence, signal_reason,
      entry_fee, status, opened_at,
      execution_mode, policy_version, engine_owner, origin, setup_tag, signal_id, market_context_id,
      regime_at_entry, direction_at_entry, macro_at_entry, atr_pct_at_entry,
      initial_stop_price, initial_stop_distance_pct, initial_stop_distance_usd,
      risk_usd, mfe, mae, mfe_r, mae_r,
      sg_break_even_activated, sg_trailing_activated, sg_current_stop_price,
      break_even_stop_price, trailing_stop_price, trailing_highest_price, lowest_price,
      filled_notional_usd, client_order_id, venue_order_id
    ) VALUES (
      ${position.lotId}, ${venue}, ${position.pair}, ${position.entryPrice},
      ${position.amount}, ${position.qtyRemaining}, ${position.highestPrice},
      ${position.entryStrategyId}, ${position.entrySignalTf},
      ${position.signalConfidence}, ${position.signalReason},
      ${position.entryFee}, 'OPEN', NOW(),
      ${position.executionMode}, ${position.policyVersion}, ${SPOT_ENGINE_OWNER}, ${SPOT_ORIGIN},
      ${position.setupTag}, ${position.signalId}, ${position.marketContextId},
      ${position.regimeAtEntry}, ${position.directionAtEntry}, ${position.macroAtEntry},
      ${position.atrPctAtEntry}, ${position.initialStopPrice},
      ${position.initialStopDistancePct}, ${position.initialStopDistanceUsd},
      ${position.riskUsd}, 0, 0, 0, 0,
      false, false, ${position.sgCurrentStopPrice},
      null, null, ${position.highestPrice}, ${position.entryPrice},
      ${filledNotionalUsd}, ${clientOrderId}, ${venueOrderId}
    )
    RETURNING lot_id
  `);
}

/**
 * Persist a closed trade to the trades table.
 * B09: exchange uses real venue. B08: engine_owner and origin.
 */
async function persistClosedTrade(
  position: SpotPosition,
  execResult: SpotExecutionResult,
  pnl: { grossPnlUsd: number; netPnlUsd: number; entryFeeUsd: number; exitFeeUsd: number; executionCostUsd: number },
  exitDecision: SpotExitDecision,
  auditMetrics: SpotAuditMetrics | null,
): Promise<void> {
  const venue = await getTradingVenue();
  await insertClosedTradeSql(db, position, execResult, pnl, exitDecision, auditMetrics, venue);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Get the real trading venue from api_config (B09).
 * SPOT is not an exchange — we use revolutx, kraken, etc.
 */
async function getTradingVenue(): Promise<string> {
  try {
    const result = await db.execute(sql`
      SELECT trading_exchange FROM api_config LIMIT 1
    `);
    const venue = result.rows[0]?.trading_exchange as string | undefined;
    return venue || "kraken";
  } catch {
    return "kraken";
  }
}

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
    entryStrategyId: row.entryStrategyId ?? "SPOT_CANONICAL",
    entrySignalTf: row.entrySignalTf ?? "15m",
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
    notionalUsd: row.filledNotionalUsd ?? row.entryPrice * row.amount,
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
        signal_reason, execution_mode, policy_version, engine_owner, setup_tag, signal_id,
        market_context_id, regime_at_entry, direction_at_entry, macro_at_entry,
        atr_pct_at_entry, initial_stop_price, initial_stop_distance_pct,
        initial_stop_distance_usd, risk_usd, mfe, mae, mfe_r, mae_r,
        sg_break_even_activated, sg_trailing_activated, sg_current_stop_price,
        break_even_stop_price, trailing_stop_price, trailing_highest_price, lowest_price,
        filled_notional_usd,
        EXTRACT(EPOCH FROM opened_at) * 1000 as opened_at_ms
      FROM open_positions
      WHERE policy_version = ${SPOT_POLICY_VERSION} AND status != 'CLOSED'
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
      engineOwner: r.engine_owner,
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
      breakEvenStopPrice: r.break_even_stop_price ? Number(r.break_even_stop_price) : null,
      trailingStopPrice: r.trailing_stop_price ? Number(r.trailing_stop_price) : null,
      trailingHighestPrice: r.trailing_highest_price ? Number(r.trailing_highest_price) : null,
      lowestPrice: r.lowest_price ? Number(r.lowest_price) : null,
      filledNotionalUsd: r.filled_notional_usd ? Number(r.filled_notional_usd) : null,
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
      WHERE policy_version = ${SPOT_POLICY_VERSION}
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
      WHERE policy_version = ${SPOT_POLICY_VERSION}
    `);

    const row = result.rows[0] as any;
    const totalTrades = Number(row?.total_trades ?? 0);
    const winningTrades = Number(row?.winning_trades ?? 0);
    const grossProfit = Number(row?.gross_profit ?? 0);
    const grossLoss = Math.abs(Number(row?.gross_loss ?? 0));

    const openCount = await db.execute(sql`
      SELECT COUNT(*) as count FROM open_positions
      WHERE policy_version = ${SPOT_POLICY_VERSION} AND status != 'CLOSED'
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
