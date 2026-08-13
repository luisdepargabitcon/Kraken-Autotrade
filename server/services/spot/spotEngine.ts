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

// ─── Engine Owner & Provenance ────────────────────────────────────────────────

export const SPOT_ENGINE_OWNER = "SPOT_CANONICAL" as const;
export const SPOT_ORIGIN = "spot_engine" as const;

// ─── Constants ──────────────────────────────────────────────────────────────

export const SPOT_RUNTIME_OWNER = "SpotEngine";
const SCAN_INTERVAL_MS = 60_000; // 60 seconds
const MAX_OPEN_POSITIONS = 10;

// ─── Engine Runtime State ────────────────────────────────────────────────────

let engineRunning = false;
let entryScanningEnabled = true;
let positionSupervisorRunning = false;

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
 * REAL is blocked.
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
 * Returns true if engine started successfully, false otherwise.
 */
export async function startSpotEngine(): Promise<boolean> {
  if (engineRunning && scanIntervalId) {
    console.log("[SpotEngine] Already running");
    return true;
  }

  const mode = await getExecutionMode();
  if (mode === ExecutionMode.OFF) {
    console.log("[SpotEngine] Execution mode is OFF, not starting");
    return false;
  }

  console.log(`[SpotEngine] Starting with mode=${mode}, owner=${SPOT_RUNTIME_OWNER}`);

  // Load shadow ledger
  await loadShadowLedger();

  // Load open positions from DB
  await loadOpenPositionsFromDB();

  entryScanningEnabled = true;
  engineRunning = true;

  // Start scan loop
  scanIntervalId = setInterval(() => runScanCycle().catch(console.error), SCAN_INTERVAL_MS);

  // Start position supervisor (runs even when entry scanning is OFF)
  if (!supervisorIntervalId) {
    positionSupervisorRunning = true;
    supervisorIntervalId = setInterval(() => runPositionSupervisor().catch(console.error), SCAN_INTERVAL_MS);
  }

  // R6: Run first supervisor pass immediately to avoid initial protection gap
  runPositionSupervisor().catch(console.error);

  // Run first scan immediately
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
  engineRunning = false;
  entryScanningEnabled = false;
  positionSupervisorRunning = false;
  console.log("[SpotEngine] Stopped (scan + supervisor)");
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
    // Non-SHADOW: persist position without ledger transaction
    await persistOpenPosition(position, result, filledNotionalUsd);
  }

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
 * B03: Only manages SPOT_CANONICAL positions. Uses position.executionMode (immutable) for exit adapter.
 */
async function manageOpenPositions(pair: string, ctx: SpotMarketContext): Promise<void> {
  const positions = await getOpenPositionsForPair(pair);

  for (const row of positions) {
    // B03: Only manage SPOT_CANONICAL positions — filter by policy_version and engine_owner
    if (row.policyVersion !== SPOT_POLICY_VERSION) continue;
    if (row.engineOwner && row.engineOwner !== SPOT_ENGINE_OWNER) continue;

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
    executionMode: position.executionMode,
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
    // Non-SHADOW: persist trade, delete position separately
    await persistClosedTrade(position, result, pnl, exitDecision, auditMetrics ?? auditTracker.getMetrics(position.lotId));
    await db.execute(sql`
      DELETE FROM open_positions WHERE lot_id = ${position.lotId}
    `);
  }

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
 * Get available capital — B12: uses configurable shadow ledger, not hardcode 10_000.
 */
async function getAvailableCapital(): Promise<number> {
  if (getCachedExecutionMode() === ExecutionMode.SHADOW) {
    return getShadowAvailableCapital();
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
 */
async function loadOpenPositionsFromDB(): Promise<void> {
  try {
    const result = await db.execute(sql`
      SELECT lot_id, pair FROM open_positions
      WHERE policy_version = ${SPOT_POLICY_VERSION} AND status != 'CLOSED'
    `);
    console.log(`[SpotEngine] Loaded ${result.rows.length} open positions from DB`);

    // Rebuild exit states and audit metrics for loaded positions (B13: restore from DB)
    for (const row of result.rows) {
      const positions = await getOpenPositionsForPair(row.pair as string);
      for (const p of positions) {
        if (p.lotId === row.lot_id) {
          const position = rowToPosition(p);
          // B13: Restore audit metrics from DB, not reinitialize to zero
          auditTracker.restorePosition(position, {
            mfeUsd: p.mfe,
            maeUsd: p.mae,
            mfeR: p.mfeR,
            maeR: p.maeR,
            highestPrice: p.highestPrice,
            lowestPrice: p.lowestPrice ?? position.entryPrice,
            mfeTimestamp: position.openedAt,
            maeTimestamp: position.openedAt,
          });
          // B13: Restore exit state from DB, not reinitialize to defaults
          const exitState = restoreExitState(position, p);
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
 * B09: exchange uses real venue (revolutx/kraken), NOT 'spot'.
 * B08: engine_owner and origin identify the SPOT engine.
 */
async function persistOpenPosition(position: SpotPosition, execResult: SpotExecutionResult, filledNotionalUsd: number): Promise<void> {
  const venue = await getTradingVenue();
  await insertOpenPositionSql(db, position, venue, filledNotionalUsd);
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
