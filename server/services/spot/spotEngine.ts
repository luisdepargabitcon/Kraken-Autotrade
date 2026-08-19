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
  type SpotExecutionResult, type RealOrderRecord,
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
import { emitSpotTerminal } from "./spotTerminalStream";
import {
  persistSubmissionIntent,
  updateSubmissionResult,
  generateClientOrderId,
  hasExistingSubmission,
  getCachedRecord,
  loadPendingRealOrders,
  countPendingRealOrderIntents,
  hasUnresolvedRealExecution,
  RealIntentPersistenceError,
  RealOrderStatePersistenceError,
  RealSubmissionAmbiguousError,
  type CreateSubmissionIntentParams,
  _clearCacheForTest as _clearIntentCacheForTest,
} from "./spotOrderIntentStore";
import { publishSnapshot } from "./spotContextSnapshotStore";
import { buildSnapshotFromScanResults } from "./spotContextSnapshot";
import { normalizePair, DEFAULT_ACTIVE_PAIRS } from "../pairAllowlist";

// R8: Re-export ownership from pure module (no heavy deps)
import {
  isSpotRuntimeOwner as _isSpotRuntimeOwner,
  SPOT_RUNTIME_OWNER as _SPOT_RUNTIME_OWNER,
  SPOT_ENGINE_OWNER as _SPOT_ENGINE_OWNER,
} from "./spotOwnership";

// ─── Engine Owner & Provenance ────────────────────────────────────────────────

export const SPOT_ENGINE_OWNER = _SPOT_ENGINE_OWNER;
export const SPOT_ORIGIN = "spot_engine" as const;

// ─── Typed Errors ────────────────────────────────────────────────────────────

export class RealActivationBlockedError extends Error {
  readonly blockers: string[];
  constructor(blockers: string[], message?: string) {
    super(message ?? `REAL activation blocked: ${blockers.join("; ")}`);
    this.name = "RealActivationBlockedError";
    this.blockers = blockers;
  }
}

// ─── Constants ──────────────────────────────────────────────────────────────

export const SPOT_RUNTIME_OWNER = _SPOT_RUNTIME_OWNER;

const SCAN_INTERVAL_MS = 60_000; // 60 seconds
const MAX_OPEN_POSITIONS = 10;

// ─── Engine Runtime State ────────────────────────────────────────────────────

let engineRunning = false;
let entryScanningEnabled = true;
let positionSupervisorRunning = false;

// Activity dedup: last MARKET state per pair (regime|direction|macroBias|dataHealth)
const lastActivityMarketStateByPair = new Map<string, string>();

// Activity dedup: last PROTECTION state per lot (BE|TRAILING activated flags)
const lastProtectionStateByLot = new Map<string, string>();

// R10.4: Reconciler state — runs independently of global mode
let reconcilerIntervalId: NodeJS.Timeout | null = null;
let isReconciling = false;
let realReconcilerRunning = false;
const RECONCILER_INTERVAL_MS = 120_000; // 2 minutes

// R10.9-8: General entry-generation gate — closes the in-flight race for ANY mode
// transition (OFF↔SHADOW, SHADOW↔REAL, REAL↔OFF), not only REAL→SHADOW/OFF.
// A scan captures the generation at start; any new-entry work (SHADOW or REAL) MUST
// re-verify the generation is unchanged immediately before doing anything that could
// create a position. REAL additionally re-verifies mode===REAL at two narrower gates
// (persist+reserve, placeOrder) because it carries real money risk.
// On ANY mode transition, the generation is bumped and setExecutionMode drains any
// in-flight critical section before returning success to the caller.
let entryGeneration = 0;
let entryCriticalSectionCount = 0;

function getEntryGeneration(): number {
  return entryGeneration;
}

function isEntryGenerationValid(generation: number): boolean {
  return generation === entryGeneration;
}

function enterEntryCriticalSection(): void {
  entryCriticalSectionCount++;
}

function exitEntryCriticalSection(): void {
  entryCriticalSectionCount = Math.max(0, entryCriticalSectionCount - 1);
}

// R10.9-cierre: Test-only pause hooks — no-op in production.
// Allow tests to pause execution at critical points to test mode-transition races.
let _testPauseAfterReserve: (() => Promise<void>) | null = null;
let _testPauseAfterShadowAdapter: (() => Promise<void>) | null = null;

/** R10.9-10: Explicit drain outcome — a timeout must never be treated as success. */
interface DrainResult {
  drained: boolean;
  remainingCount: number;
}

/**
 * R10.9-8/10: Called on EVERY mode transition. Bumps the generation (any in-flight
 * scan holding the old generation will fail its next gate check) and drains any
 * submission currently inside the critical section (persist+reserve..placeOrder)
 * before returning. If the drain times out, returns drained=false — the caller
 * (setExecutionMode) MUST treat this as DRAIN_TIMEOUT_FAIL_CLOSED, not as success.
 */
let drainTimeoutMs = 15_000;

export function _setDrainTimeoutMsForTest(ms: number): void {
  drainTimeoutMs = ms;
}

export function _getDrainTimeoutMsForTest(): number {
  return drainTimeoutMs;
}

async function invalidateEntryGenerationAndDrain(): Promise<DrainResult> {
  entryGeneration++;
  const maxWaitMs = drainTimeoutMs;
  const start = Date.now();
  while (entryCriticalSectionCount > 0 && Date.now() - start < maxWaitMs) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  if (entryCriticalSectionCount > 0) {
    console.error(`[SpotEngine] R10.9-10: DRAIN_TIMEOUT_FAIL_CLOSED — ${entryCriticalSectionCount} entry critical section(s) still active after ${maxWaitMs}ms`);
    return { drained: false, remainingCount: entryCriticalSectionCount };
  }
  return { drained: true, remainingCount: 0 };
}

// R10.9: Exported for productive tests — inspect/drive the transition gate directly.
export function _getRealSubmissionGenerationForTest(): number {
  return entryGeneration;
}
export function _enterRealCriticalSectionForTest(): void {
  enterEntryCriticalSection();
}
export function _exitRealCriticalSectionForTest(): void {
  exitEntryCriticalSection();
}
export async function _invalidateRealSubmissionGenerationAndDrainForTest(): Promise<DrainResult> {
  return invalidateEntryGenerationAndDrain();
}
export function _getEntryCriticalSectionCountForTest(): number {
  return entryCriticalSectionCount;
}

// ─── Per-pair entry generation ──────────────────────────────────────────────
// R10.9-pair: Per-pair race safety — disabling a pair (e.g. SOL) must NOT
// invalidate the generation of other pairs (e.g. BTC/ETH). Each pair has its
// own generation counter and critical section count. When a pair is disabled,
// only that pair's generation is bumped and its critical section is drained.

const pairEntryGeneration = new Map<string, number>();
const pairCriticalSectionCount = new Map<string, number>();

function getPairEntryGeneration(pair: string): number {
  return pairEntryGeneration.get(normalizePair(pair)) ?? 0;
}

function isPairEntryGenerationValid(pair: string, generation: number): boolean {
  return getPairEntryGeneration(pair) === generation;
}

async function invalidatePairEntryGenerationAndDrain(pair: string): Promise<DrainResult> {
  const normalized = normalizePair(pair);
  pairEntryGeneration.set(normalized, (pairEntryGeneration.get(normalized) ?? 0) + 1);
  const maxWaitMs = drainTimeoutMs;
  const start = Date.now();
  while ((pairCriticalSectionCount.get(normalized) ?? 0) > 0 && Date.now() - start < maxWaitMs) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const remaining = pairCriticalSectionCount.get(normalized) ?? 0;
  if (remaining > 0) {
    console.error(`[SpotEngine] R10.9-pair: DRAIN_TIMEOUT_FAIL_CLOSED for ${normalized} — ${remaining} critical section(s) still active after ${maxWaitMs}ms`);
    return { drained: false, remainingCount: remaining };
  }
  return { drained: true, remainingCount: 0 };
}

function enterPairCriticalSection(pair: string): void {
  const normalized = normalizePair(pair);
  pairCriticalSectionCount.set(normalized, (pairCriticalSectionCount.get(normalized) ?? 0) + 1);
}

function exitPairCriticalSection(pair: string): void {
  const normalized = normalizePair(pair);
  const current = pairCriticalSectionCount.get(normalized) ?? 0;
  pairCriticalSectionCount.set(normalized, Math.max(0, current - 1));
}

// Export for spotPairToggle integration
export async function _invalidatePairEntryGenerationAndDrain(pair: string): Promise<DrainResult> {
  return invalidatePairEntryGenerationAndDrain(pair);
}

// P3: Separated invalidate-only (no drain) — called BEFORE DB write in disablePair
export async function _invalidatePairEntryGenerationOnly(pair: string): Promise<void> {
  const normalized = normalizePair(pair);
  pairEntryGeneration.set(normalized, (pairEntryGeneration.get(normalized) ?? 0) + 1);
}

// P3: Separated drain-only (no invalidate) — called AFTER DB write in disablePair
export async function _drainPairCriticalSection(pair: string): Promise<DrainResult> {
  const normalized = normalizePair(pair);
  const maxWaitMs = drainTimeoutMs;
  const start = Date.now();
  while ((pairCriticalSectionCount.get(normalized) ?? 0) > 0 && Date.now() - start < maxWaitMs) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const remaining = pairCriticalSectionCount.get(normalized) ?? 0;
  if (remaining > 0) {
    console.error(`[SpotEngine] R10.9-pair: DRAIN_TIMEOUT_FAIL_CLOSED for ${normalized} — ${remaining} critical section(s) still active after ${maxWaitMs}ms`);
    return { drained: false, remainingCount: remaining };
  }
  return { drained: true, remainingCount: 0 };
}

// Test-only exports for per-pair generation
export function _getPairEntryGenerationForTest(pair: string): number {
  return getPairEntryGeneration(pair);
}

export function _getPairCriticalSectionCountForTest(pair: string): number {
  return pairCriticalSectionCount.get(normalizePair(pair)) ?? 0;
}

export function _enterPairCriticalSectionForTest(pair: string): void {
  enterPairCriticalSection(pair);
}

export function _exitPairCriticalSectionForTest(pair: string): void {
  exitPairCriticalSection(pair);
}

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

// R10.9-5: Position supervisor health — only a cycle that successfully demonstrates
// open-positions + manageOpenPositions state (DB coherent) is HEALTHY. DB errors or
// any thrown exception mark it UNHEALTHY, which blocks new REAL BUY entries.
let positionSupervisionHealthy = false;
let positionSupervisionLastSuccessAt: number | null = null;
let positionSupervisionFailureReason: string | null = "Supervisor has not completed a successful cycle yet";

// R10.9-final: Supervisor freshness window — 2× scan interval + small tolerance.
// If lastSuccessAt is older than this, the supervisor is stale even if no error was seen.
const SUPERVISOR_STALE_MS = 2 * SCAN_INTERVAL_MS + 5_000;

export interface PositionSupervisionHealth {
  healthy: boolean;
  lastSuccessAt: number | null;
  failureReason: string | null;
  stale: boolean;
}

export function getPositionSupervisionHealth(): PositionSupervisionHealth {
  const stale = positionSupervisionLastSuccessAt === null
    || (Date.now() - positionSupervisionLastSuccessAt) > SUPERVISOR_STALE_MS;
  return {
    healthy: positionSupervisionHealthy && !stale,
    lastSuccessAt: positionSupervisionLastSuccessAt,
    failureReason: positionSupervisionFailureReason,
    stale,
  };
}

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

// R10.9-9: Mode transition mutex — only ONE transition may run at a time. Concurrent
// POST /api/spot/mode requests cannot interleave, which would allow races between
// generation invalidation, drain, mode persist, and lifecycle changes.
let modeTransitionLock: Promise<unknown> = Promise.resolve();

async function doSetExecutionMode(mode: ExecutionMode): Promise<ExecutionMode> {
  if (mode === ExecutionMode.REAL && !REAL_ACTIVATION_ALLOWED) {
    throw new Error("REAL execution mode is not authorized. REAL_ACTIVATION_ALLOWED=false.");
  }

  // R10.9-8: Capture the PREVIOUS mode before any side effects. Uses the DB-backed
  // loader (not the sync cache) to avoid a false OFF fallback if the 5s cache window
  // happened to have just expired.
  const previousMode = await getExecutionMode();

  // R10.9-8: Invalidate the general entry generation FIRST on ANY mode change, so new
  // entry work started under the previous mode gets blocked before we persist the new
  // mode. This closes OFF↔SHADOW, SHADOW↔REAL, and REAL↔OFF races, not only REAL→others.
  // R10.9-10: Drain timeout is DRAIN_TIMEOUT_FAIL_CLOSED — the new mode is still
  // persisted (to avoid leaving DB in the old mode), but the caller receives an error
  // and the entry scanner is not started/restarted.
  // R10.9-cierre: Generation invalidation must happen BEFORE REAL preflight to prevent
  // in-flight SHADOW entries from materializing during the preflight window.
  let drainResult: DrainResult;
  if (previousMode !== mode) {
    drainResult = await invalidateEntryGenerationAndDrain();
  } else {
    drainResult = { drained: true, remainingCount: 0 };
  }

  // R10.9-8: Serialize REAL preflight inside the mode transition lock. This prevents
  // concurrent POST /api/spot/mode requests from running prepareRealActivation in
  // parallel with a mode transition — the preflight and the transition are now atomic.
  if (mode === ExecutionMode.REAL && previousMode !== ExecutionMode.REAL) {
    const prep = await prepareRealActivation();
    if (!prep.ready) {
      const blockers = prep.readiness?.blockers ?? [prep.error ?? "unknown"];
      throw new RealActivationBlockedError(blockers, `REAL activation preflight failed: ${prep.error ?? "unknown"}`);
    }
  }

  // Persist the target mode BEFORE runtime lifecycle changes, so the authoritative state
  // is committed even if drain partially failed. A partial drain still blocks new work
  // because the generation has already been bumped and executeEntry's top gate will fail.
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
    // R10.8-7: FAIL-SAFE — if we cannot determine whether positions exist, assume they
    // MIGHT and keep the supervisor running. Never stop supervision based on an UNKNOWN.
    let hasPositions: boolean;
    try {
      hasPositions = await hasOpenSpotPositions();
    } catch (error: any) {
      console.error(`[SpotEngine] R10.8-7: Cannot determine open positions on OFF transition — assuming positions MAY exist: ${error.message}`);
      hasPositions = true;
    }
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
  emitSpotTerminal("SYSTEM", "engine", `Modo cambiado a ${mode}`, { mode });
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

  // R10.9-10: After the mode is persisted, throw if the drain did not complete. This
  // keeps the response honest: the mode changed, but the transition is incomplete and
  // the entry scanner must not be trusted yet. Callers (spot.routes.ts) map this to 500.
  if (!drainResult.drained) {
    // R10.9-6: DRAIN_TIMEOUT_FAIL_CLOSED — disable entry scanner regardless of mode.
    // A timed-out drain means in-flight entries may still be creating positions under
    // the old mode. The scanner must NOT restart until a clean transition succeeds.
    entryScanningEnabled = false;
    if (scanIntervalId) {
      clearInterval(scanIntervalId);
      scanIntervalId = null;
    }
    engineRunning = false;
    throw new Error(
      `DRAIN_TIMEOUT_FAIL_CLOSED: mode transition ${previousMode}→${mode} persisted, ` +
      `but ${drainResult.remainingCount} entry critical section(s) still active after timeout. ` +
      `Reconciler/supervisor continue; entry scanner disabled.`
    );
  }

  // R10.9-cierre: Single authority — lifecycle management inside the mutex.
  // The route no longer calls startSpotEngine/stopSpotEngine separately.
  // Same-mode retry (e.g. after drain timeout left runtime stopped) recovers here.
  if (mode === ExecutionMode.OFF) {
    // OFF: stop scanner, keep supervisor if positions exist
    if (scanIntervalId) {
      clearInterval(scanIntervalId);
      scanIntervalId = null;
    }
    entryScanningEnabled = false;
    engineRunning = false;
    // Supervisor stays if positions exist (already handled above in the OFF branch)
  } else {
    // SHADOW or REAL: ensure runtime is running
    // If same-mode retry after drain timeout, engine may be stopped — restart it
    if (!engineRunning || !scanIntervalId) {
      const started = await startSpotEngine();
      if (!started) {
        // Revert to previous mode — engine failed to start
        await saveExecutionMode(previousMode);
        throw new Error(
          `Failed to start SPOT engine for mode ${mode}. Reverted to ${previousMode}.`
        );
      }
    }
  }

  return mode;
}

/**
 * Set execution mode (persisted to DB).
 * R10: REAL is now supported with preflight checks.
 * OFF = entry disabled, position supervisor continues while SPOT positions exist.
 * R10.9-9: Serialized through a promise-queue mutex so concurrent transitions cannot
 * interleave generation invalidation, drain, persist, and lifecycle.
 */
export function setExecutionMode(mode: ExecutionMode): Promise<ExecutionMode> {
  const run = modeTransitionLock
    .catch(() => { /* prior error must not block the queue */ })
    .then(() => doSetExecutionMode(mode));
  modeTransitionLock = run.catch(() => { /* swallow so next transition can still queue */ });
  return run;
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
  // R10.7-11: Fail-closed INDEPENDENT of global mode. There may be REAL positions or
  // pending REAL order_intents on disk regardless of whether the global mode is currently
  // OFF, SHADOW, or REAL — we cannot silently continue if we can't prove what exists.
  // The process/API stays alive; only the trading runtime (entry scanner) is blocked.
  try {
    await loadOpenPositionsFromDB();
  } catch (error: any) {
    console.error(`[SpotEngine] R10.7-11: FAIL-CLOSED — DB load failed (mode=${mode}): ${error.message}`);
    logActivity({
      category: "SYSTEM",
      severity: "CRITICAL",
      title: "FAIL-CLOSED — Carga DB posiciones falló",
      explanation: `No se pueden cargar posiciones desde DB (mode=${mode}). Pueden existir posiciones/órdenes REAL sin supervisar. Entry scanner NO iniciará. Error: ${error.message}`,
      decision: "FAIL_CLOSED",
      executionMode: mode,
      reasonCode: "STARTUP_DB_LOAD_FAILED",
    });
    entryScanningEnabled = false;
    engineRunning = false;
    return false;
  }

  // R10.4: Reconcile pending REAL order_intents at restart — REGARDLESS of global mode
  // If any REAL orders/positions exist, they must be reconciled even if mode is OFF/SHADOW
  await reconcilePendingRealOrderIntents();

  // R10.4: Start periodic REAL reconciler — runs independently of global mode
  startRealReconciler();

  // R7: OFF mode — no entry scanner, but supervisor if positions exist
  if (mode === ExecutionMode.OFF) {
    entryScanningEnabled = false;
    engineRunning = false;

    // R10.8-7: FAIL-SAFE — if we cannot determine whether positions exist, assume they
    // MIGHT and start the supervisor. NEVER conclude 0 positions from a DB error.
    let hasPositions: boolean;
    try {
      hasPositions = await hasOpenSpotPositions();
    } catch (error: any) {
      console.error(`[SpotEngine] R10.8-7: OFF startup — cannot determine open positions, assuming positions MAY exist: ${error.message}`);
      logActivity({
        pair: null,
        category: "SYSTEM",
        severity: "CRITICAL",
        title: "OFF startup — no se pudo determinar posiciones abiertas",
        explanation: `Error de DB al arrancar en OFF. Se asume fail-safe que PUEDEN existir posiciones REAL. Supervisor iniciado. Error: ${error.message}`,
        decision: "FAIL_SAFE",
        executionMode: mode,
        reasonCode: "REAL_POSITION_QUERY_FAILED_FAIL_CLOSED",
      });
      hasPositions = true;
    }
    if (hasPositions) {
      // Start position supervisor only
      if (!supervisorIntervalId) {
        positionSupervisorRunning = true;
        supervisorIntervalId = setInterval(() => runPositionSupervisor().catch(console.error), SCAN_INTERVAL_MS);
      }
      // R10.9-6: Await first supervisor pass and verify it SUCCEEDED. A first cycle that
      // throws on DB position query must NOT be treated as a successful startup, because
      // we cannot demonstrate that positions are being supervised. OFF mode: no entry
      // scanner anyway, but supervisor health still matters for the next mode change to REAL.
      console.log("[SpotEngine] OFF mode: entry scanner=0, position supervisor=1 (open positions exist)");
      const firstPass = await runPositionSupervisor().catch(err => ({ ok: false, reason: err.message } as SupervisorCycleResult));
      if (!firstPass.ok) {
        console.error(`[SpotEngine] R10.9-6: OFF startup — first supervisor pass FAILED: ${firstPass.reason}. Supervisor will retry on interval.`);
      }
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

  // R7: Await first supervisor pass BEFORE first scan — and verify it SUCCEEDED (R10.9-6).
  // A supervisor pass that cannot determine open positions (DB error) is NOT a valid
  // starting condition for new REAL BUY or SHADOW entries, because the engine cannot
  // demonstrate it knows existing exposure. In SHADOW/REAL we fail the startup.
  console.log("[SpotEngine] Supervisor first pass starting (before scan)");
  const firstPass = await runPositionSupervisor().catch(err => ({ ok: false, reason: err.message } as SupervisorCycleResult));
  if (!firstPass.ok) {
    console.error(`[SpotEngine] R10.9-6: ${mode} startup — first supervisor pass FAILED: ${firstPass.reason}. Entry scanner will NOT start.`);
    logActivity({
      category: "SYSTEM",
      severity: "CRITICAL",
      title: `SPOT startup bloqueado — supervisor inicial falló`,
      explanation: `El primer ciclo del supervisor no pudo demostrar el estado de posiciones abiertas (mode=${mode}). NO se inicia el scanner de nuevas entradas hasta recovery. Razón: ${firstPass.reason}`,
      decision: "FAIL_CLOSED",
      executionMode: mode,
      reasonCode: "SUPERVISOR_FIRST_PASS_FAILED",
    });
    if (scanIntervalId) {
      clearInterval(scanIntervalId);
      scanIntervalId = null;
    }
    entryScanningEnabled = false;
    engineRunning = false;
    return false;
  }
  console.log("[SpotEngine] Supervisor first pass completed, starting scan");
  emitSpotTerminal("SYSTEM", "engine", `Motor iniciado — mode=${mode}, supervisor OK`, { mode });

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
  emitSpotTerminal("SYSTEM", "engine", "Motor detenido (scan + supervisor + reconciler)");
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
    emitSpotTerminal("SYSTEM", "reconciler", `Reconciler — ${totalPending} pending REAL intents (entry=${counts.pendingEntryOrders}, exit=${counts.pendingExitOrders}, uncertain=${counts.uncertainOrders})`);
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
  emitSpotTerminal("SYSTEM", "reconciler", `Reconciler iniciado (interval=${RECONCILER_INTERVAL_MS}ms)`);
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
 * R10.5: Exported for test access — check if reconciler INTERVAL is active.
 * This reflects whether the periodic interval is running, NOT the reentrancy guard.
 */
export function _isReconcilerIntervalRunningForTest(): boolean {
  return realReconcilerRunning;
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

  // R10.9-8: Capture the general entry generation at scan start. Any new-entry work
  // (SHADOW or REAL) reachable from this scan MUST re-verify this generation at the
  // top of executeEntry — closes races for ANY mode transition, not only REAL→SHADOW/OFF.
  const scanGeneration = getEntryGeneration();

  isScanning = true;
  lastScanTime = Date.now();
  const scanId = `scan-${lastScanTime.toString(36)}`;
  console.log(`[SpotEngine] Scan ${scanId} started, mode=${mode}`);
  emitSpotTerminal("INFO", "scan", `[${scanId}] Scan iniciado — mode=${mode}`);

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
        const result = await scanPair(pair, mode, scanGeneration, scanId, new Set(pairs.map(normalizePair)));
        results.push(result);
      } catch (error: any) {
        console.error(`[SpotEngine] Error scanning ${pair}:`, error.message);
        results.push({ pair, signal: "ERROR", reason: error.message, mode });
      }
    }

    lastScanResults = results;
    console.log(`[SpotEngine] Scan ${scanId} completed: ${results.length} pairs processed`);
    for (const r of results) {
      const lvl = r.signal === "BUY" || r.signal === "EXECUTED" ? "SIGNAL" : r.signal === "ERROR" ? "ERROR" : "INFO";
      emitSpotTerminal(lvl, "scan", `[${r.pair}] ${r.signal} — ${r.reason}`, { pair: r.pair, mode: r.mode });
    }
  } catch (err: any) {
    console.error(`[SpotEngine] Scan ${scanId} aborted: ${err.message}`);
    emitSpotTerminal("ERROR", "scan", `[${scanId}] Scan abortado — ${err.message}`);
  } finally {
    isScanning = false;
  }
}

// R6: Exported for testing — verify single owner invariant
export async function _runScanCycleForTest(): Promise<void> {
  return runScanCycle();
}

// R10.7: Minimal test-only hooks for productive reservation/reconciliation tests.
// These call the REAL production functions directly — no logic is duplicated in tests.
export async function _persistAndReserveRealEntryIntentAtomicForTest(
  params: CreateSubmissionIntentParams,
  clientOrderId: string,
  venue: string,
  notionalUsd: number,
  grossQuoteBalance: number,
  quoteCurrency: string,
): Promise<PersistReserveOutcome> {
  return persistAndReserveRealEntryIntentAtomic(params, clientOrderId, venue, notionalUsd, grossQuoteBalance, quoteCurrency);
}

export async function _terminateIntentAndReleaseReservationAtomicForTest(
  internalIntentId: string,
  finalStatus: "FAILED" | "CANCELLED",
): Promise<void> {
  return terminateIntentAndReleaseReservationAtomic(internalIntentId, finalStatus);
}

export async function _finalizeRealEntryFillAtomicForTest(
  position: SpotPosition,
  execResult: SpotExecutionResult,
  filledNotionalUsd: number,
  internalIntentId: string,
  clientOrderId: string,
): Promise<void> {
  return finalizeRealEntryFillAtomic(position, execResult, filledNotionalUsd, internalIntentId, clientOrderId);
}

export async function _getRealQuoteBalanceForTest(pair: string): Promise<number> {
  return getRealQuoteBalance(pair);
}

export async function _getAvailableCapitalForTest(pair: string, executionMode: ExecutionMode): Promise<number> {
  return getAvailableCapital(pair, executionMode);
}

// R10.8: Minimal test-only hooks calling the REAL executeEntry/closePosition productive
// functions directly — needed for end-to-end transition-race and exit-retry tests.
export async function _executeEntryForTest(
  intent: SpotEntryIntent,
  ctx: SpotMarketContext,
  mode: ExecutionMode,
  signal: SpotSignalResult | undefined,
  generation: number,
): Promise<ExecuteEntryOutcome> {
  return executeEntry(intent, ctx, mode, signal, generation, getPairEntryGeneration(intent.pair));
}

export async function _closePositionForTest(
  position: SpotPosition,
  exitDecision: SpotExitDecision,
  ctx: SpotMarketContext,
): Promise<void> {
  return closePosition(position, exitDecision, ctx);
}

export async function _reconcilePendingRealOrderIntentsForTest(): Promise<void> {
  return reconcilePendingRealOrderIntents();
}

// R6: Exported for testing — verify reentrancy guard
export async function _runPositionSupervisorForTest(): Promise<{ ok: boolean; reason?: string; busy?: boolean }> {
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

// R10.9-5: Exported for testing — set supervisor health explicitly or inspect it.
export function _setPositionSupervisionHealthyForTest(value: boolean, reason: string | null = null): void {
  positionSupervisionHealthy = value;
  positionSupervisionFailureReason = reason;
  if (value) {
    positionSupervisionLastSuccessAt = Date.now();
  }
}

export function _isPositionSupervisionHealthyForTest(): boolean {
  return positionSupervisionHealthy;
}

export function _getPositionSupervisionFailureReasonForTest(): string | null {
  return positionSupervisionFailureReason;
}

// R10.9-cierre: Test-only pause hooks — no-op in production
export function _setPauseAfterReserveForTest(hook: (() => Promise<void>) | null): void {
  _testPauseAfterReserve = hook;
}

export function _setPauseAfterShadowAdapterForTest(hook: (() => Promise<void>) | null): void {
  _testPauseAfterShadowAdapter = hook;
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
  } catch (error: any) {
    // R10.8-7: FAIL-CLOSED — a DB error means UNKNOWN, not "no positions". Returning []
    // here would let a REAL position go unsupervised. Callers MUST treat a thrown error
    // as "cannot determine" and keep retrying, never conclude zero positions.
    console.error("[SpotEngine] R10.8-7: Failed to get open position pairs (DB error) — cannot conclude no positions:", error.message);
    throw new Error(`REAL_POSITION_QUERY_FAILED_FAIL_CLOSED: getOpenSpotPositionPairs: ${error.message}`);
  }
}

interface SupervisorCycleResult {
  ok: boolean;
  reason?: string;
  busy?: boolean;
}

/**
 * Position supervisor: manages open SPOT positions (exit evaluation) independently of entry scanning.
 * Runs even when mode=OFF to avoid orphaning positions.
 * R5: Iterates over pairs with open positions, NOT activePairs.
 * R6: Reentrancy guard prevents overlapping cycles.
 * R10.9-5/6: Returns explicit { ok, reason }. Health is true only when the entire cycle
 * (pair discovery + manageOpenPositions for each pair) completed successfully with no
 * fail-closed DB error. Any DB/cycle error marks positionSupervisionHealthy=false and
 * blocks new REAL BUY entries until a later cycle succeeds.
 */
async function runPositionSupervisor(): Promise<SupervisorCycleResult> {
  if (isSupervising) {
    console.log("[SpotEngine] Supervisor already in progress, skipping");
    return { ok: false, reason: "already-running", busy: true };
  }
  isSupervising = true;
  try {
    const mode = await getExecutionMode();
    let pairs: string[];
    try {
      pairs = await getOpenSpotPositionPairs();
    } catch (error: any) {
      // R10.8-7: DB error = UNKNOWN, never "no positions". Log CRITICAL and skip this
      // cycle WITHOUT concluding zero positions — the interval stays alive to retry.
      console.error(`[SpotEngine] R10.8-7: Supervisor cycle SKIPPED — cannot determine open positions: ${error.message}`);
      emitSpotTerminal("ERROR", "supervisor", `DB error — no se pudo determinar posiciones: ${error.message}`, { mode });
      positionSupervisionHealthy = false;
      positionSupervisionFailureReason = error.message || "getOpenSpotPositionPairs DB error";
      const reason = positionSupervisionFailureReason ?? undefined;
      logActivity({
        pair: null,
        category: "SYSTEM",
        severity: "CRITICAL",
        title: "Supervisor — no se pudo determinar posiciones abiertas",
        explanation: `Error de DB al consultar pares con posiciones abiertas. NO se asume 0 posiciones. Se reintentará en el próximo ciclo. Error: ${error.message}`,
        decision: "FAIL_CLOSED",
        executionMode: mode,
        reasonCode: "REAL_POSITION_QUERY_FAILED_FAIL_CLOSED",
      });
      return { ok: false, reason };
    }

    // R10.9-3: Track per-pair failures — the supervisor is only healthy if ALL pairs
    // were successfully evaluated. A single pair failure (e.g. getOpenPositionsForPair
    // DB error) means the supervisor could not demonstrate the state of that pair's
    // positions, which is a false positive if we mark healthy anyway.
    let cycleFailures = 0;
    let cycleFailureReason: string | null = null;

    for (const pair of pairs) {
      try {
        let ctx: SpotMarketContext;
        try {
          ctx = await buildSpotMarketContext({ pair });
        } catch {
          cycleFailures++;
          if (cycleFailureReason === null) cycleFailureReason = `${pair}: buildSpotMarketContext failed`;
          continue;
        }
        // Use position's executionMode for exit, not global mode
        await manageOpenPositions(pair, ctx);
      } catch (error: any) {
        console.error(`[SpotEngine] Supervisor error for ${pair}:`, error.message);
        cycleFailures++;
        if (cycleFailureReason === null) cycleFailureReason = `${pair}: ${error.message}`;
      }
    }

    if (cycleFailures > 0) {
      positionSupervisionHealthy = false;
      positionSupervisionFailureReason = `${cycleFailures} pair(s) failed — ${cycleFailureReason}`;
      console.error(`[SpotEngine] R10.9-3: Supervisor cycle completed with ${cycleFailures} failure(s): ${positionSupervisionFailureReason}`);
      emitSpotTerminal("ERROR", "supervisor", `Ciclo con ${cycleFailures} fallo(s) — ${cycleFailureReason}`, { mode });
      return { ok: false, reason: positionSupervisionFailureReason ?? undefined };
    }

    positionSupervisionHealthy = true;
    positionSupervisionLastSuccessAt = Date.now();
    positionSupervisionFailureReason = null;
    emitSpotTerminal("SUPERVISOR", "supervisor", `Ciclo OK — ${pairs.length} par(es) supervisado(s)`, { mode });
    return { ok: true };
  } catch (error: any) {
    console.error('[SpotEngine] Supervisor cycle error:', error.message);
    emitSpotTerminal("ERROR", "supervisor", `Ciclo error: ${error.message}`, { mode: undefined });
    positionSupervisionHealthy = false;
    positionSupervisionFailureReason = error.message || "supervisor cycle exception";
    return { ok: false, reason: positionSupervisionFailureReason ?? undefined };
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
  } catch (error: any) {
    // R10.8-7: FAIL-CLOSED — a DB error is UNKNOWN, never "false" (no positions).
    // Returning false here could stop the position supervisor while a REAL position
    // still exists. Callers MUST treat this as "assume positions may exist".
    console.error("[SpotEngine] R10.8-7: hasOpenSpotPositions DB error — cannot conclude false:", error.message);
    throw new Error(`REAL_POSITION_QUERY_FAILED_FAIL_CLOSED: hasOpenSpotPositions: ${error.message}`);
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
async function scanPair(pair: string, mode: ExecutionMode, generation: number, scanId: string, enabledPairs: Set<string>): Promise<{ pair: string; signal: string; reason: string; mode: string }> {
  // Capture per-pair generation at scan start — any disable during this scan invalidates it
  const pairGen = getPairEntryGeneration(pair);

  // A. Build market context
  let ctx: SpotMarketContext;
  try {
    ctx = await buildSpotMarketContext({ pair });
  } catch (error: any) {
    return { pair, signal: "SKIP", reason: `MarketData error: ${error.message}`, mode };
  }

  // MARKET terminal emit — technical per-scan context info
  emitSpotTerminal("MARKET", "scan", `${pair} regime=${ctx.regimeContext.regime} dir=${ctx.regimeContext.direction} macro=${ctx.regimeContext.macroBias} health=${ctx.dataHealth} atrPct=${ctx.regimeContext.atrPct.toFixed(2)} price=${ctx.ticker.last}`, { pair, mode });

  // MARKET activity — emit on first valid context and on state changes only (no spam)
  const marketStateKey = `${ctx.regimeContext.regime}|${ctx.regimeContext.direction}|${ctx.regimeContext.macroBias}|${ctx.dataHealth}`;
  const lastMarketState = lastActivityMarketStateByPair.get(pair);
  if (lastMarketState !== marketStateKey) {
    lastActivityMarketStateByPair.set(pair, marketStateKey);
    logActivity({
      pair,
      category: "MARKET",
      severity: "INFO",
      title: `Contexto de mercado: ${ctx.regimeContext.regime} ${ctx.regimeContext.direction}`,
      explanation: `Par ${pair} — régimen=${ctx.regimeContext.regime}, dirección=${ctx.regimeContext.direction}, macroBias=${ctx.regimeContext.macroBias}, dataHealth=${ctx.dataHealth}, ATR%=${ctx.regimeContext.atrPct.toFixed(2)}`,
      decision: ctx.regimeContext.direction,
      executionMode: mode,
      regime: ctx.regimeContext.regime,
      direction: ctx.regimeContext.direction,
      macroBias: ctx.regimeContext.macroBias,
      reasonCode: lastMarketState ? "MARKET_CONTEXT_CHANGED" : "MARKET_CONTEXT_INITIAL",
    });
  }

  // R6: Position management removed from scanPair — runPositionSupervisor is the single owner.
  // C. Check data health — if stale, skip entry evaluation
  if (ctx.dataHealth === DataHealth.STALE || ctx.dataHealth === DataHealth.INSUFFICIENT) {
    publishSnapshot(buildSnapshotFromScanResults({
      pair, scanId, mode, enabled: enabledPairs.has(normalizePair(pair)),
      ctx, signal: { signal: "NONE", setupTag: null, reason: `DataHealth=${ctx.dataHealth}`, confidence: 0, blockReason: `DATA_${ctx.dataHealth}` } as SpotSignalResult,
      intent: null, intentEvaluation: null, sizing: null,
      blockReasonCode: `DATA_${ctx.dataHealth}`,
    }));
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
      const outcome = await executeEntry(activeIntent, ctx, mode, signalResultCache.get(pair), generation, pairGen);
      if (outcome.executed) {
        activeIntent.state = "EXECUTED" as any;
        intentStore.update(activeIntent);
        signalResultCache.delete(pair);
        publishSnapshot(buildSnapshotFromScanResults({
          pair, scanId, mode, enabled: enabledPairs.has(normalizePair(pair)),
          ctx, signal: signalResultCache.get(pair) ?? { signal: "BUY", setupTag: null, reason: "Executed", confidence: 0, blockReason: null } as SpotSignalResult,
          intent: activeIntent, intentEvaluation: evaluation, sizing: outcome.sizing ?? null,
          blockReasonCode: null,
          pipelineStopStage: "EXECUTED", pipelineStopReasonCode: outcome.reasonCode, pipelineStopReason: outcome.reason,
        }));
        return { pair, signal: "EXECUTED", reason: "Entry executed", mode };
      } else {
        // P5: Propagate outcome when executed=false — the pipeline reached executeEntry
        // and returned a real reason. This is the LAST real gate executed.
        publishSnapshot(buildSnapshotFromScanResults({
          pair, scanId, mode, enabled: enabledPairs.has(normalizePair(pair)),
          ctx, signal: signalResultCache.get(pair) ?? { signal: "BUY", setupTag: null, reason: outcome.reason, confidence: 0, blockReason: null } as SpotSignalResult,
          intent: activeIntent, intentEvaluation: evaluation, sizing: outcome.sizing ?? null,
          blockReasonCode: outcome.reasonCode,
          pipelineStopStage: outcome.stage, pipelineStopReasonCode: outcome.reasonCode, pipelineStopReason: outcome.reason,
        }));
        return { pair, signal: "BLOCKED", reason: outcome.reason, mode };
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
      publishSnapshot(buildSnapshotFromScanResults({
        pair, scanId, mode, enabled: enabledPairs.has(normalizePair(pair)),
        ctx, signal: signalResultCache.get(pair) ?? { signal: "NONE", setupTag: null, reason: evaluation.reason, confidence: 0, blockReason: null } as SpotSignalResult,
        intent: activeIntent, intentEvaluation: evaluation, sizing: null,
        blockReasonCode: activeIntent.lastBlockReason,
      }));
      return { pair, signal: "INTENT", reason: evaluation.reason, mode };
    }
  }

  // E. No active intent — evaluate SPOT_CANONICAL strategy
  const signal = evaluateSpotCanonical(ctx);

  if (signal.signal === "BUY" && signal.setupTag) {
    logActivity({
      pair,
      category: "SIGNAL",
      severity: "INFO",
      title: `Setup detectado: ${signal.setupTag}`,
      explanation: signal.reason || `Setup ${signal.setupTag} con confianza ${signal.confidence}`,
      decision: signal.setupTag,
      executionMode: mode,
      reasonCode: "SIGNAL_DETECTED",
    });
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
      const outcome = await executeEntry(intent, ctx, mode, signal, generation, pairGen);
      if (outcome.executed) {
        intent.state = "EXECUTED" as any;
        intentStore.update(intent);
        signalResultCache.delete(pair);
        publishSnapshot(buildSnapshotFromScanResults({
          pair, scanId, mode, enabled: enabledPairs.has(normalizePair(pair)),
          ctx, signal, intent, intentEvaluation: evaluation, sizing: outcome.sizing ?? null,
          blockReasonCode: null,
          pipelineStopStage: "EXECUTED", pipelineStopReasonCode: outcome.reasonCode, pipelineStopReason: outcome.reason,
        }));
        return { pair, signal: "EXECUTED", reason: "Entry executed (immediate)", mode };
      } else {
        // P5: Propagate outcome when executed=false — the pipeline reached executeEntry
        // and returned a real reason. This is the LAST real gate executed.
        publishSnapshot(buildSnapshotFromScanResults({
          pair, scanId, mode, enabled: enabledPairs.has(normalizePair(pair)),
          ctx, signal, intent, intentEvaluation: evaluation, sizing: outcome.sizing ?? null,
          blockReasonCode: outcome.reasonCode,
          pipelineStopStage: outcome.stage, pipelineStopReasonCode: outcome.reasonCode, pipelineStopReason: outcome.reason,
        }));
        return { pair, signal: "BLOCKED", reason: outcome.reason, mode };
      }
    } else {
      logActivity({
        pair,
        category: "DECISION",
        severity: "INFO",
        title: `Entrada pendiente: ${evaluation.newState}`,
        explanation: evaluation.reason || `Intent en estado ${evaluation.newState}`,
        decision: evaluation.newState,
        executionMode: mode,
        reasonCode: "ENTRY_GATED",
      });
    }

    publishSnapshot(buildSnapshotFromScanResults({
      pair, scanId, mode, enabled: enabledPairs.has(normalizePair(pair)),
      ctx, signal, intent, intentEvaluation: evaluation, sizing: null,
      blockReasonCode: intent.lastBlockReason,
      pipelineStopStage: "ANTI_LATE_ENTRY", pipelineStopReasonCode: intent.lastBlockReason ?? "ENTRY_GATED", pipelineStopReason: evaluation.reason,
    }));
    return { pair, signal: "BUY", reason: signal.reason, mode };
  }

  // No signal — clean up any stale signal cache
  signalResultCache.delete(pair);

  publishSnapshot(buildSnapshotFromScanResults({
    pair, scanId, mode, enabled: enabledPairs.has(normalizePair(pair)),
    ctx, signal, intent: null, intentEvaluation: null, sizing: null,
    blockReasonCode: signal.blockReason,
  }));
  return { pair, signal: "HOLD", reason: signal.reason || signal.blockReason || "No signal", mode };
}

/**
 * Typed outcome from executeEntry — preserves the CAUSE when entry doesn't proceed.
 * scanPair uses this to pass the real reason into the snapshot.
 */
export interface ExecuteEntryOutcome {
  executed: boolean;
  stage:
    | "GENERATION"
    | "PAIR_DISABLED"
    | "SIZING"
    | "FREEZE"
    | "SUPERVISOR"
    | "CAPACITY"
    | "ADAPTER"
    | "PERSIST"
    | "EXECUTED";
  reasonCode: string;
  reason: string;
  sizing?: SizingResult | null;
  submitted?: boolean;
}

/**
 * Execute entry: sizing → adapter → persist position.
 * Propagates signalConfidence from SpotSignalResult (B14).
 * Returns typed outcome for full traceability.
 */
async function executeEntry(intent: SpotEntryIntent, ctx: SpotMarketContext, mode: ExecutionMode, signal: SpotSignalResult | undefined, generation: number, pairGeneration: number): Promise<ExecuteEntryOutcome> {
  // R10.9-8: General entry-generation gate — applies to EVERY mode, not only REAL.
  // A scan job captures `generation` at scan start; any mode transition (OFF↔SHADOW,
  // SHADOW↔REAL, REAL↔OFF) bumps the generation. A stale job must not create a NEW
  // position under a mode that is no longer current, in ANY direction.
  if (!isEntryGenerationValid(generation)) {
    console.log(`[SpotEngine] R10.9-8: Entry BLOCKED for ${intent.pair} — mode transitioned during scan (stale entryGeneration)`);
    logActivity({
      pair: intent.pair,
      category: "EXECUTION",
      severity: "WARNING",
      title: "Entrada bloqueada — transición de modo durante scan",
      explanation: `El modo global cambió mientras este trabajo de scan estaba en curso. NO se crea posición bajo un modo obsoleto.`,
      decision: "BLOCK",
      executionMode: mode,
      reasonCode: "ENTRY_GENERATION_STALE_BLOCKED",
    });
    return { executed: false, stage: "GENERATION", reasonCode: "ENTRY_GENERATION_STALE_BLOCKED", reason: "Modo global cambió durante scan", sizing: null, submitted: false };
  }

  // P2-A: Per-pair generation check — before any entry work begins
  if (!isPairEntryGenerationValid(intent.pair, pairGeneration)) {
    console.log(`[SpotEngine] R10.9-pair: Entry BLOCKED for ${intent.pair} — pair disabled during scan (stale pairGeneration)`);
    logActivity({
      pair: intent.pair,
      category: "EXECUTION",
      severity: "WARNING",
      title: "Entrada bloqueada — par desactivado durante scan",
      explanation: `El par ${intent.pair} fue desactivado mientras este scan estaba en curso. NO se crea nueva entrada.`,
      decision: "BLOCK",
      executionMode: mode,
      reasonCode: "PAIR_DISABLED_RACE_BLOCKED",
    });
    return { executed: false, stage: "PAIR_DISABLED", reasonCode: "PAIR_DISABLED_RACE_BLOCKED", reason: `Par ${intent.pair} desactivado durante scan`, sizing: null, submitted: false };
  }

  // R10.9-5: Position supervisor health gate — a new REAL BUY must never proceed while
  // the supervisor cannot demonstrate it correctly knows the state of open positions.
  // SELL protections, the reconciler, and SHADOW entries are NOT affected.
  // R10.9-cierre: Use production getPositionSupervisionHealth() which includes freshness.
  // A supervisor whose last successful cycle is older than SUPERVISOR_STALE_MS is stale
  // and must block REAL BUY — the engine cannot trust it knows current exposure.
  if (mode === ExecutionMode.REAL) {
    const supervision = getPositionSupervisionHealth();
    if (!supervision.healthy) {
      const reason = supervision.stale
        ? `supervisor stale (last success: ${supervision.lastSuccessAt ?? 'never'})`
        : `supervisor unhealthy: ${supervision.failureReason ?? 'unknown'}`;
      console.error(`[SpotEngine] R10.9-5: REAL BUY BLOCKED for ${intent.pair} — ${reason}`);
      logActivity({
        pair: intent.pair,
        category: "SYSTEM",
        severity: "CRITICAL",
        title: "REAL BUY bloqueada — supervisor de posiciones no saludable",
        explanation: `El position supervisor no pudo demostrar el estado de las posiciones abiertas en su último ciclo. NO se abren nuevas posiciones REAL hasta recovery. Razón: ${reason}`,
        decision: "BLOCK",
        executionMode: mode,
        reasonCode: "SUPERVISOR_UNHEALTHY_BLOCKS_REAL_BUY",
      });
      return { executed: false, stage: "SUPERVISOR", reasonCode: "SUPERVISOR_UNHEALTHY_BLOCKS_REAL_BUY", reason: `Supervisor no saludable: ${reason}`, sizing: null, submitted: false };
    }
  }

  // Get available capital — R10.7-8: mandatory pair, no first-active-pair fallback
  const availableCapital = await getAvailableCapital(intent.pair, mode);

  // R10.9-4: FAIL-CLOSED — countOpenLotsForPair now throws on DB error instead of
  // returning 0. A fabricated openLots=0 could let evaluateSizing approve a REAL BUY
  // that violates max-lots-per-pair risk limits. BLOCK the entry instead.
  let openLots: number;
  try {
    openLots = await countOpenLotsForPair(intent.pair);
  } catch (error: any) {
    console.error(`[SpotEngine] R10.9-4: Entry BLOCKED for ${intent.pair} — cannot count open lots: ${error.message}`);
    logActivity({
      pair: intent.pair,
      category: "SYSTEM",
      severity: "CRITICAL",
      title: "Entrada bloqueada — no se pudo contar posiciones abiertas",
      explanation: `Error de DB al contar lots abiertos para ${intent.pair}. NO se asume 0 lots. NO se envía orden. Error: ${error.message}`,
      decision: "FAIL_CLOSED",
      executionMode: mode,
      reasonCode: "REAL_OPEN_LOTS_QUERY_FAILED_FAIL_CLOSED",
    });
    return { executed: false, stage: "CAPACITY", reasonCode: "REAL_OPEN_LOTS_QUERY_FAILED_FAIL_CLOSED", reason: `No se pudo contar posiciones abiertas: ${error.message}`, sizing: null, submitted: false };
  }

  // Sizing
  const sizing = evaluateSizing(ctx, intent, availableCapital, openLots);
  if (!sizing.approved) {
    console.log(`[SpotEngine] Entry blocked for ${intent.pair}: ${sizing.reason}`);
    logActivity({
      pair: intent.pair,
      category: "RISK",
      severity: "WARNING",
      title: `Entrada rechazada por sizing: ${sizing.blockReason ?? sizing.reason}`,
      explanation: `Sizing no aprobado para ${intent.pair}: ${sizing.reason}. Capital disponible=${availableCapital}, openLots=${openLots}.`,
      decision: "REJECT",
      executionMode: mode,
      reasonCode: "SIZING_REJECTED",
    });
    return { executed: false, stage: "SIZING", reasonCode: sizing.blockCode ?? "SIZING_REJECTED", reason: sizing.reason, sizing, submitted: false };
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
      return { executed: false, stage: "FREEZE", reasonCode: "REAL_FREEZE_ACTIVATED", reason: "REAL FREEZE activo — ejecuciones sin resolver", sizing: null, submitted: false };
    }
  }

  // P2-B: Per-pair revalidation before creating/advancing executable intent
  if (!isPairEntryGenerationValid(intent.pair, pairGeneration)) {
    console.log(`[SpotEngine] R10.9-pair: Entry BLOCKED at point B for ${intent.pair} — pair disabled before intent creation`);
    return { executed: false, stage: "PAIR_DISABLED", reasonCode: "PAIR_DISABLED_RACE_BLOCKED", reason: `Par ${intent.pair} desactivado antes de crear intent`, sizing: null, submitted: false };
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
  // R10.9-2: The entry critical section now covers BOTH REAL and SHADOW modes.
  // Any new entry that can create a position must be inside the critical section so
  // that invalidateEntryGenerationAndDrain can wait for it during a mode transition.
  // R10.9-final: The critical section spans from enterEntryCriticalSection through
  // persistShadowEntryAtomic / finalizeRealEntryFillAtomic and ALL return/throw paths.
  // A single try/finally guarantees exitEntryCriticalSection on every path.
  let entryCriticalSectionEntered = false;
  if (mode === ExecutionMode.REAL) {
    // R10.9-8: Gate check #1 — re-verify mode is still REAL and the entry generation is
    // still valid IMMEDIATELY before persist+reserve. Closes the REAL→SHADOW/OFF race
    // where a scan captured mode=REAL before the user switched away.
    if (!isEntryGenerationValid(generation) || getCachedExecutionMode() !== ExecutionMode.REAL) {
      console.log(`[SpotEngine] R10.8: Entry BLOCKED — REAL mode transitioned away before persist+reserve for ${intent.pair}`);
      logActivity({
        pair: intent.pair,
        category: "EXECUTION",
        severity: "WARNING",
        title: "Entrada bloqueada — transición de modo REAL",
        explanation: `El modo cambió fuera de REAL durante el scan. NO se persiste ni reserva. NO se envía orden.`,
        decision: "BLOCK",
        executionMode: mode,
        reasonCode: "REAL_MODE_TRANSITION_RACE_BLOCKED",
        intentId: internalIntentId,
      });
      return { executed: false, stage: "GENERATION", reasonCode: "REAL_MODE_TRANSITION_RACE_BLOCKED", reason: "Modo REAL cambió antes de persist+reserve", sizing: null, submitted: false };
    }
  } else if (mode === ExecutionMode.SHADOW) {
    if (!isEntryGenerationValid(generation) || getCachedExecutionMode() !== ExecutionMode.SHADOW) {
      console.log(`[SpotEngine] R10.9-2: Entry BLOCKED — SHADOW mode transitioned away for ${intent.pair}`);
      logActivity({
        pair: intent.pair,
        category: "EXECUTION",
        severity: "WARNING",
        title: "Entrada bloqueada — transición de modo SHADOW",
        explanation: `El modo cambió fuera de SHADOW durante el scan. NO se crea posición.`,
        decision: "BLOCK",
        executionMode: mode,
        reasonCode: "SHADOW_MODE_TRANSITION_RACE_BLOCKED",
      });
      return { executed: false, stage: "GENERATION", reasonCode: "SHADOW_MODE_TRANSITION_RACE_BLOCKED", reason: "Modo SHADOW cambió", sizing: null, submitted: false };
    }
  }

  // P2-C: Per-pair revalidation before reserving capital
  if (!isPairEntryGenerationValid(intent.pair, pairGeneration)) {
    console.log(`[SpotEngine] R10.9-pair: Entry BLOCKED at point C for ${intent.pair} — pair disabled before reserve`);
    return { executed: false, stage: "PAIR_DISABLED", reasonCode: "PAIR_DISABLED_RACE_BLOCKED", reason: `Par ${intent.pair} desactivado antes de reserva`, sizing: null, submitted: false };
  }

  enterEntryCriticalSection();
  entryCriticalSectionEntered = true;
  let pairCriticalSectionEntered = false;
  enterPairCriticalSection(intent.pair);
  pairCriticalSectionEntered = true;

  try {
    // ─── REAL: persist+reserve + outcome handling ──────────────────────────────
    if (mode === ExecutionMode.REAL) {
      let venue: string;
      try {
        venue = await getTradingVenueFailClosed();
      } catch (error: any) {
        console.error(`[SpotEngine] R10.8-6: Entry BLOCKED — trading venue unverified/mismatched: ${error.message}`);
        logActivity({
          pair: intent.pair,
          category: "EXECUTION",
          severity: "CRITICAL",
          title: "Entrada bloqueada — venue no verificado",
          explanation: `No se pudo verificar el venue de trading configurado contra el runtime. NO se envía orden. Error: ${error.message}`,
          decision: "BLOCK",
          executionMode: mode,
          reasonCode: "REAL_TRADING_VENUE_UNVERIFIED",
          intentId: internalIntentId,
        });
        return { executed: false, stage: "ADAPTER", reasonCode: "REAL_TRADING_VENUE_UNVERIFIED", reason: `Venue no verificado: ${error.message}`, sizing: null, submitted: false };
      }
      // R10.5: Fetch real balance BEFORE the transaction to validate inside the lock
      // R10.6: Per-pair balance, returns GROSS (no double subtraction)
      const realBalanceUsd = await getRealQuoteBalance(intent.pair);
      // R10.7-9: Resolve the quote currency from the pair's own metadata — never a bare
      // constant disconnected from the balance we just resolved.
      const pairMetaForReserve = (ExchangeFactory.getTradingExchange() as any).getPairMetadata?.(intent.pair);
      const resolvedQuoteCurrency: string = pairMetaForReserve?.quoteCurrency ?? "UNKNOWN";
      let reserveOutcome: PersistReserveOutcome;
      try {
        reserveOutcome = await persistAndReserveRealEntryIntentAtomic({
          internalIntentId,
          pair: intent.pair,
          side: "BUY",
          requestedQty: sizing.volume,
          requestedPrice: null,
          orderType: "MARKET",
          executionMode: mode,
          lotId: null,
          reason: `SPOT entry: ${intent.setupTag}`,
        }, clientOrderId, venue, sizing.notionalUsd, realBalanceUsd, resolvedQuoteCurrency);
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
        return { executed: false, stage: "PERSIST", reasonCode: "REAL_INTENT_PERSISTENCE_FAILED_FAIL_CLOSED", reason: `Persist+reserve falló: ${error.message}`, sizing: null, submitted: false };
      }

      // R10.9-1/2: explicit outcome — never treat CANCELLED pre-submit as already-submitted active.
      if (reserveOutcome.kind === "EXISTING_ACTIVE") {
        console.log(`[SpotEngine] Entry SKIPPED — existing active submission: ${internalIntentId} clientOrderId=${clientOrderId}`);
        logActivity({
          pair: intent.pair,
          category: "EXECUTION",
          severity: "INFO",
          title: "Entrada duplicada evitada",
          explanation: `Intent ${internalIntentId} ya tiene submission activa (pending/accepted/uncertain). placeOrder omitido.`,
          decision: "SKIP_DUPLICATE",
          executionMode: mode,
          reasonCode: "DUPLICATE_ENTRY_SUBMISSION",
          intentId: internalIntentId,
        });
        return { executed: false, stage: "PERSIST", reasonCode: "DUPLICATE_ENTRY_SUBMISSION", reason: "Submission activa existente", sizing: null, submitted: false };
      }

      if (reserveOutcome.kind === "EXISTING_FILLED") {
        // R10.9-9: Verify materialization — an EXISTING_FILLED intent MUST have either an
        // open_position or a closed trade. If neither exists, the intent was marked FILLED
        // but the position was never materialized — this is a data inconsistency that must
        // not be silently skipped. Freeze REAL mode by throwing.
        let materialized = false;
        try {
          const posCheck = await db.execute(sql`
            SELECT lot_id FROM open_positions
            WHERE client_order_id = ${clientOrderId}
              AND policy_version = ${SPOT_POLICY_VERSION}
              AND engine_owner = ${SPOT_ENGINE_OWNER}
            LIMIT 1
          `);
          if (posCheck.rows.length > 0) {
            materialized = true;
          } else {
            const tradeCheck = await db.execute(sql`
              SELECT trade_id FROM trades
              WHERE lot_id IN (
                SELECT lot_id FROM order_intents WHERE client_order_id = ${clientOrderId}
              )
                AND policy_version = ${SPOT_POLICY_VERSION}
                AND engine_owner = ${SPOT_ENGINE_OWNER}
              LIMIT 1
            `);
            if (tradeCheck.rows.length > 0) {
              materialized = true;
            }
          }
        } catch (verifyError: any) {
          console.error(`[SpotEngine] R10.9-9: EXISTING_FILLED verification DB error for ${internalIntentId}: ${verifyError.message}`);
          throw new Error(`EXISTING_FILLED_VERIFICATION_FAILED: ${verifyError.message}`);
        }
        if (!materialized) {
          console.error(`[SpotEngine] R10.9-9: EXISTING_FILLED intent ${internalIntentId} has NO materialized position or trade — data inconsistency`);
          throw new Error(
            `EXISTING_FILLED_NOT_MATERIALIZED: intent ${internalIntentId} is marked FILLED ` +
            `but no open_position or trade exists. REAL mode must be frozen until resolved.`
          );
        }
        console.log(`[SpotEngine] Entry SKIPPED — existing filled intent (materialized): ${internalIntentId}`);
        logActivity({
          pair: intent.pair,
          category: "EXECUTION",
          severity: "INFO",
          title: "Entrada duplicada evitada",
          explanation: `Intent ${internalIntentId} ya está filled. NO se reenvía.`,
          decision: "SKIP_DUPLICATE",
          executionMode: mode,
          reasonCode: "DUPLICATE_ENTRY_SUBMISSION",
          intentId: internalIntentId,
        });
        return { executed: false, stage: "PERSIST", reasonCode: "DUPLICATE_ENTRY_SUBMISSION", reason: "Intent ya filled", sizing: null, submitted: false };
      }

      if (reserveOutcome.kind === "EXISTING_TERMINAL") {
        console.log(`[SpotEngine] Entry SKIPPED — existing terminal intent: ${internalIntentId}`);
        logActivity({
          pair: intent.pair,
          category: "EXECUTION",
          severity: "WARNING",
          title: "Entrada terminal — no se reenvía",
          explanation: `Intent ${internalIntentId} está en estado terminal (failed/expired/cancelled con exchange_order_id). NO se marca EXECUTED. NO se reenvía.`,
          decision: "BLOCK",
          executionMode: mode,
          reasonCode: "DUPLICATE_ENTRY_TERMINAL",
          intentId: internalIntentId,
        });
        return { executed: false, stage: "PERSIST", reasonCode: "DUPLICATE_ENTRY_TERMINAL", reason: "Intent terminal existente", sizing: null, submitted: false };
      }

      // CREATED or REARMED_PRE_SUBMIT → continue to placeOrder. For REARMED_PRE_SUBMIT the
      // same clientOrderId is reused because the row was never sent to the exchange.
      if (reserveOutcome.kind === "REARMED_PRE_SUBMIT") {
        console.log(`[SpotEngine] Entry REARMED from PRE_SUBMISSION_CANCELLED: ${internalIntentId} clientOrderId=${clientOrderId}`);
      }

      // R10.9-cierre: Test pause hook — after reserve, before Gate #2
      if (_testPauseAfterReserve) {
        await _testPauseAfterReserve();
      }

      // P2-D: Per-pair generation revalidation AFTER reserve, BEFORE placeOrder.
      // Independent of the global generation check. If the pair was disabled during
      // the reserve step, the reservation must be released and no order placed.
      if (!isPairEntryGenerationValid(intent.pair, pairGeneration)) {
        console.log(`[SpotEngine] R10.9-pair: Entry BLOCKED at point D (post-reserve) for ${intent.pair} — pair disabled during reserve`);
        try {
          await terminateIntentAndReleaseReservationAtomic(internalIntentId, "CANCELLED");
        } catch (error: any) {
          console.error(`[SpotEngine] R10.9-pair: Failed to release reservation after pair-disable race: ${error.message}`);
        }
        logActivity({
          pair: intent.pair,
          category: "EXECUTION",
          severity: "WARNING",
          title: "Entrada bloqueada — par desactivado durante reserva",
          explanation: `El par ${intent.pair} fue desactivado mientras se reservaba capital. Reserva liberada. NO se envía orden.`,
          decision: "BLOCK",
          executionMode: mode,
          reasonCode: "PAIR_DISABLED_RACE_BLOCKED",
          intentId: internalIntentId,
        });
        return { executed: false, stage: "PAIR_DISABLED", reasonCode: "PAIR_DISABLED_RACE_BLOCKED", reason: `Par ${intent.pair} desactivado durante reserva`, sizing: null, submitted: false };
      }

      // R10.9-8: Gate check #2 — re-verify IMMEDIATELY before placeOrder. The persist+reserve
      // step above may have taken time; the mode may have transitioned away in the interim.
      if (!isEntryGenerationValid(generation) || getCachedExecutionMode() !== ExecutionMode.REAL) {
        console.log(`[SpotEngine] R10.8: Entry BLOCKED — REAL mode transitioned away before placeOrder for ${intent.pair}`);
        try {
          await terminateIntentAndReleaseReservationAtomic(internalIntentId, "CANCELLED");
        } catch (error: any) {
          console.error(`[SpotEngine] R10.8: Failed to release reservation after transition-race block: ${error.message}`);
        }
        logActivity({
          pair: intent.pair,
          category: "EXECUTION",
          severity: "WARNING",
          title: "Entrada bloqueada — transición de modo REAL (antes de placeOrder)",
          explanation: `El modo cambió fuera de REAL entre la reserva y el envío de la orden. Reserva liberada. NO se envía orden.`,
          decision: "BLOCK",
          executionMode: mode,
          reasonCode: "REAL_MODE_TRANSITION_RACE_BLOCKED",
          intentId: internalIntentId,
        });
        // P2-D: Per-pair revalidation before REAL placeOrder
        return { executed: false, stage: "GENERATION", reasonCode: "REAL_MODE_TRANSITION_RACE_BLOCKED", reason: "Modo REAL cambió antes de placeOrder", sizing: null, submitted: false };
      }
    }

    // ─── Adapter execution ─────────────────────────────────────────────────────
    // Execute via adapter — pass clientOrderId (NOT generated by adapter)
    const adapter = createExecutionAdapter(mode);
    let result: SpotExecutionResult;
    try {
      result = await adapter.executeEntry(execIntent, ctx, clientOrderId);
    } catch (error: any) {
      // R10.6: Adapter should not throw — but if it does, treat as AMBIGUOUS
      if (mode === ExecutionMode.REAL) {
        console.error(`[SpotEngine] REAL entry unexpected exception for ${intent.pair}: ${error.message}`);
        try {
          await updateSubmissionResult(internalIntentId, { status: "UNCERTAIN" });
        } catch { /* best effort */ }
        logActivity({
          pair: intent.pair,
          category: "SYSTEM",
          severity: "CRITICAL",
          title: "REAL_SUBMISSION_AMBIGUOUS — exception tras placeOrder",
          explanation: `Exception durante placeOrder. Orden puede estar viva en exchange. Marcado UNCERTAIN. NO reenviar. Error: ${error.message}`,
          decision: "FAIL_CLOSED",
          executionMode: mode,
          reasonCode: "REAL_SUBMISSION_AMBIGUOUS",
          intentId: internalIntentId,
        });
      } else {
        console.error(`[SpotEngine] Entry exception for ${intent.pair}: ${error.message}`);
      }
      return { executed: false, stage: "ADAPTER", reasonCode: mode === ExecutionMode.REAL ? "REAL_SUBMISSION_AMBIGUOUS" : "ENTRY_EXCEPTION", reason: error.message, sizing: null, submitted: false };
    }

    // R10.6: Handle ACCEPTED without venueOrderId — treat as UNCERTAIN, retain reservation
    if (result.success && result.submissionState === "ACCEPTED" && !result.venueOrderId && !result.pendingFill) {
      if (mode === ExecutionMode.REAL) {
        console.warn(`[SpotEngine] REAL entry ACCEPTED but no venueOrderId for ${intent.pair} — marking UNCERTAIN`);
        try {
          await updateSubmissionResult(internalIntentId, { status: "UNCERTAIN" });
        } catch { /* best effort */ }
        logActivity({
          pair: intent.pair,
          category: "SYSTEM",
          severity: "CRITICAL",
          title: "REAL_SUBMISSION_AMBIGUOUS — ACCEPTED sin venueOrderId",
          explanation: `Orden aceptada pero sin venueOrderId. No se puede reconciliar. Marcado UNCERTAIN. Reserva retenida.`,
          decision: "FAIL_CLOSED",
          executionMode: mode,
          reasonCode: "REAL_ACCEPTED_NO_VENUE_ID",
          intentId: internalIntentId,
        });
      }
      return { executed: false, stage: "ADAPTER", reasonCode: "REAL_ACCEPTED_NO_VENUE_ID", reason: "ACCEPTED sin venueOrderId", sizing: null, submitted: false };
    }

    if (!result.success) {
      console.error(`[SpotEngine] Entry failed for ${intent.pair}: ${result.error}`);
      // R10.6: Check submissionState — AMBIGUOUS retains reservation, REJECTED releases
      if (mode === ExecutionMode.REAL) {
        if (result.submissionState === "AMBIGUOUS") {
          // R10.6: Order may be live — mark UNCERTAIN, retain reservation, freeze new REAL BUY
          console.error(`[SpotEngine] REAL entry AMBIGUOUS for ${intent.pair}: ${result.error}`);
          try {
            await updateSubmissionResult(internalIntentId, { status: "UNCERTAIN" });
          } catch { /* best effort */ }
          logActivity({
            pair: intent.pair,
            category: "SYSTEM",
            severity: "CRITICAL",
            title: "REAL_SUBMISSION_AMBIGUOUS — network error tras placeOrder",
            explanation: `Network error durante placeOrder. Orden puede estar viva en exchange. Marcado UNCERTAIN. NO reenviar. Reserva retenida. Error: ${result.error}`,
            decision: "FAIL_CLOSED",
            executionMode: mode,
            reasonCode: "REAL_SUBMISSION_AMBIGUOUS",
            intentId: internalIntentId,
          });
        } else {
          // R10.6: Explicit REJECTED — terminate intent and release reservation atomically
          try {
            await terminateIntentAndReleaseReservationAtomic(internalIntentId, "FAILED");
          } catch (error: any) {
            console.error(`[SpotEngine] R10.6: Atomic termination failed for ${internalIntentId}: ${error.message}`);
          }
          logActivity({
            pair: intent.pair,
            category: "ENTRY",
            severity: "WARNING",
            title: "Entrada rechazada",
            explanation: `Orden de entrada rechazada: ${result.error}`,
            decision: "REJECT",
            executionMode: mode,
            setupTag: intent.setupTag,
            reasonCode: "ENTRY_REJECTED",
            intentId: execIntent.intentId,
            orderId: result.orderId,
          });
        }
      } else {
        logActivity({
          pair: intent.pair,
          category: "ENTRY",
          severity: "WARNING",
          title: "Entrada fallida",
          explanation: `Orden de entrada falló: ${result.error}`,
          decision: "REJECT",
          executionMode: mode,
          setupTag: intent.setupTag,
          reasonCode: "ENTRY_FAILED",
          intentId: execIntent.intentId,
          orderId: result.orderId,
        });
      }
      return { executed: false, stage: "ADAPTER", reasonCode: result.submissionState === "AMBIGUOUS" ? "REAL_SUBMISSION_AMBIGUOUS" : "ENTRY_REJECTED", reason: result.error ?? "Entry failed", sizing: null, submitted: false };
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
      return { executed: true, stage: "EXECUTED", reasonCode: "PENDING_FILL", reason: "Orden pendiente de fill", sizing, submitted: true };
    }

    if (result.fillPrice === null) {
      console.error(`[SpotEngine] Entry failed for ${intent.pair}: no fill price`);
      // R10.5: Use atomic termination for consistency
      if (mode === ExecutionMode.REAL) {
        try {
          await terminateIntentAndReleaseReservationAtomic(internalIntentId, "FAILED");
        } catch { /* best effort */ }
      }
      return { executed: false, stage: "ADAPTER", reasonCode: "NO_FILL_PRICE", reason: "No fill price", sizing: null, submitted: false };
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
      return { executed: false, stage: "PERSIST", reasonCode: "INVALID_NOTIONAL", reason: `filledNotionalUsd inválido: ${filledNotionalUsd}`, sizing: null, submitted: false };
    }
    position.notionalUsd = filledNotionalUsd;

    // R4: Atomic entry — INSERT position + UPDATE ledger in ONE transaction
    if (mode === ExecutionMode.SHADOW) {
      // R10.9-cierre: Test pause hook — after SHADOW adapter, before persist
      if (_testPauseAfterShadowAdapter) {
        await _testPauseAfterShadowAdapter();
      }
      // P2-E: Per-pair generation revalidation AFTER shadow adapter, BEFORE persist.
      // If the pair was disabled during the adapter call, do NOT materialize the position.
      if (!isPairEntryGenerationValid(intent.pair, pairGeneration)) {
        console.log(`[SpotEngine] R10.9-pair: Entry BLOCKED at point E (post-shadow-adapter) for ${intent.pair} — pair disabled during adapter`);
        logActivity({
          pair: intent.pair,
          category: "EXECUTION",
          severity: "WARNING",
          title: "Entrada bloqueada — par desactivado durante adapter shadow",
          explanation: `El par ${intent.pair} fue desactivado mientras el adapter shadow ejecutaba. NO se materializa posición fantasma.`,
          decision: "BLOCK",
          executionMode: mode,
          reasonCode: "PAIR_DISABLED_RACE_BLOCKED",
        });
        return { executed: false, stage: "PAIR_DISABLED", reasonCode: "PAIR_DISABLED_RACE_BLOCKED", reason: `Par ${intent.pair} desactivado durante adapter shadow`, sizing: null, submitted: false };
      }
      // R10.9-cierre: Gate check #3 — re-verify mode is still SHADOW after the adapter
      // completed. The adapter call may have taken time; the mode may have transitioned
      // away. A shadow fill must NOT be materialized under a different mode.
      if (!isEntryGenerationValid(generation) || getCachedExecutionMode() !== ExecutionMode.SHADOW) {
        console.log(`[SpotEngine] R10.9-cierre: SHADOW entry BLOCKED — mode transitioned away after adapter for ${intent.pair}`);
        logActivity({
          pair: intent.pair,
          category: "EXECUTION",
          severity: "WARNING",
          title: "Entrada bloqueada — transición de modo SHADOW (después de adapter)",
          explanation: `El modo cambió fuera de SHADOW entre el adapter y la persistencia. NO se materializa posición.`,
          decision: "BLOCK",
          executionMode: mode,
          reasonCode: "SHADOW_MODE_TRANSITION_RACE_BLOCKED_POST_ADAPTER",
        });
        // P2-E: Per-pair revalidation after SHADOW adapter, before persist
        return { executed: false, stage: "GENERATION", reasonCode: "SHADOW_MODE_TRANSITION_RACE_BLOCKED_POST_ADAPTER", reason: "Modo SHADOW cambió después de adapter", sizing: null, submitted: false };
      }
      try {
        const newLedger = await persistShadowEntryAtomic(position, filledNotionalUsd, result.feeUsd ?? 0);
        // Sync in-memory cache only after successful COMMIT
        shadowLedger = newLedger;
      } catch (error: any) {
        console.error(`[SpotEngine] Shadow entry atomic persistence failed for ${intent.pair}: ${error.message}`);
        return { executed: false, stage: "PERSIST", reasonCode: "SHADOW_PERSIST_FAILED", reason: error.message, sizing: null, submitted: false };
      }
    } else {
      // R10.3: REAL mode — atomic fill materialization (exactly-once)
      // INSERT open_position + UPDATE order_intent FILLED in ONE transaction
      if (mode === ExecutionMode.REAL) {
        try {
          await finalizeRealEntryFillAtomic(
            position, result, filledNotionalUsd, internalIntentId, clientOrderId,
          );
          // R10.7-3: Reservation release happens INSIDE finalizeRealEntryFillAtomic's transaction.
          // No separate release call — releaseReservationInTx is the SINGLE owner of release.
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
          return { executed: false, stage: "PERSIST", reasonCode: "REAL_ENTRY_FILL_ATOMIC_FAILED", reason: `Materialización DB falló: ${error.message}`, sizing: null, submitted: false };
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
    // POSITION activity — emit once on materialization
    logActivity({
      pair: intent.pair,
      category: "POSITION",
      severity: "SUCCESS",
      title: `Posición materializada: ${lotId}`,
      explanation: `Posición ${lotId} abierta para ${intent.pair} — modo=${mode}, precio=${result.fillPrice}, qty=${position.amount}, lotId=${lotId}`,
      decision: "OPEN",
      executionMode: mode,
      price: result.fillPrice,
      reasonCode: "POSITION_MATERIALIZED",
      lotId,
    });
    return { executed: true, stage: "EXECUTED", reasonCode: "ENTRY_FILLED", reason: `Posición abierta: ${lotId} @ ${result.fillPrice}`, sizing, submitted: true };
  } finally {
    if (entryCriticalSectionEntered) exitEntryCriticalSection();
    if (pairCriticalSectionEntered) exitPairCriticalSection(intent.pair);
  }
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

    // PROTECTION activity — emit on BE/TRAILING state change false→true (no repeat)
    const protectionKey = `${exitState.breakEvenStopPrice !== null}|${exitState.trailingStopPrice !== null}`;
    const lastProtection = lastProtectionStateByLot.get(row.lotId);
    if (lastProtection !== protectionKey) {
      const wasActive = lastProtection !== undefined;
      lastProtectionStateByLot.set(row.lotId, protectionKey);
      if (exitState.breakEvenStopPrice !== null && (!wasActive || lastProtection === "false|false")) {
        logActivity({
          pair: position.pair,
          category: "PROTECTION",
          severity: "INFO",
          title: `Break-Even activado: ${row.lotId}`,
          explanation: `Stop movido a break-even para posición ${row.lotId} (${position.pair}). Precio de stop=${exitState.breakEvenStopPrice}.`,
          decision: "BE_ACTIVATED",
          executionMode: position.executionMode,
          reasonCode: "PROTECTION_BE_ACTIVATED",
          lotId: row.lotId,
        });
      }
      if (exitState.trailingStopPrice !== null && (!wasActive || lastProtection === "true|false")) {
        logActivity({
          pair: position.pair,
          category: "PROTECTION",
          severity: "INFO",
          title: `Trailing stop activado: ${row.lotId}`,
          explanation: `Trailing stop armado para posición ${row.lotId} (${position.pair}). Precio de stop=${exitState.trailingStopPrice}, highest=${exitState.trailingHighestPrice}.`,
          decision: "TRAILING_ACTIVATED",
          executionMode: position.executionMode,
          reasonCode: "PROTECTION_TRAILING_ACTIVATED",
          lotId: row.lotId,
        });
      }
    }

    if (exitDecision.shouldExit && exitDecision.reasonType) {
      // B03: Use position.executionMode (immutable), NOT global mode
      await closePosition(position, exitDecision, ctx);

      // Clean up state
      exitStates.delete(row.lotId);
      intentStore.remove(pair);
      lastProtectionStateByLot.delete(row.lotId);
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
          AND status IN (${"failed"}, ${"expired"}, ${"cancelled"})
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

    let venue: string;
    try {
      venue = await getTradingVenueFailClosed();
    } catch (error: any) {
      console.error(`[SpotEngine] R10.8-6: Exit BLOCKED — trading venue unverified/mismatched for ${position.lotId}: ${error.message}`);
      logActivity({
        pair: position.pair,
        category: "EXECUTION",
        severity: "CRITICAL",
        title: "Salida bloqueada — venue no verificado",
        explanation: `No se pudo verificar el venue de trading configurado contra el runtime. NO se envía orden de salida. Error: ${error.message}`,
        decision: "BLOCK",
        executionMode: position.executionMode,
        reasonCode: "REAL_TRADING_VENUE_UNVERIFIED",
        lotId: position.lotId,
      });
      return;
    }
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
    // R10.6: Adapter should not throw — but if it does, treat as AMBIGUOUS
    if (position.executionMode === ExecutionMode.REAL) {
      console.error(`[SpotEngine] REAL exit unexpected exception for ${position.lotId}: ${error.message}`);
      try {
        await updateSubmissionResult(internalIntentId, { status: "UNCERTAIN" });
      } catch { /* best effort */ }
      logActivity({
        pair: position.pair,
        category: "SYSTEM",
        severity: "CRITICAL",
        title: "REAL_SUBMISSION_AMBIGUOUS — exception tras exit placeOrder",
        explanation: `Exception durante exit placeOrder. Orden puede estar viva en exchange. Marcado UNCERTAIN. NO reenviar. Error: ${error.message}`,
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

  // R10.6: Handle ACCEPTED without venueOrderId — treat as UNCERTAIN
  if (result.success && result.submissionState === "ACCEPTED" && !result.venueOrderId && !result.pendingFill) {
    if (position.executionMode === ExecutionMode.REAL) {
      console.warn(`[SpotEngine] REAL exit ACCEPTED but no venueOrderId for ${position.lotId} — marking UNCERTAIN`);
      try {
        await updateSubmissionResult(internalIntentId, { status: "UNCERTAIN" });
      } catch { /* best effort */ }
      logActivity({
        pair: position.pair,
        category: "SYSTEM",
        severity: "CRITICAL",
        title: "REAL_SUBMISSION_AMBIGUOUS — ACCEPTED sin venueOrderId",
        explanation: `Orden de salida aceptada pero sin venueOrderId. No se puede reconciliar. Marcado UNCERTAIN. Posición retenida.`,
        decision: "FAIL_CLOSED",
        executionMode: position.executionMode,
        reasonCode: "REAL_ACCEPTED_NO_VENUE_ID",
        lotId: position.lotId,
        intentId: internalIntentId,
      });
    }
    return;
  }

  if (!result.success) {
    console.error(`[SpotEngine] Exit failed for ${position.lotId}: ${result.error}`);
    // R10.6: Check submissionState — AMBIGUOUS retains position, REJECTED terminates atomically
    if (position.executionMode === ExecutionMode.REAL) {
      if (result.submissionState === "AMBIGUOUS") {
        // R10.6: Order may be live — mark UNCERTAIN, retain position, do NOT re-send
        console.error(`[SpotEngine] REAL exit AMBIGUOUS for ${position.lotId}: ${result.error}`);
        try {
          await updateSubmissionResult(internalIntentId, { status: "UNCERTAIN" });
        } catch { /* best effort */ }
        logActivity({
          pair: position.pair,
          category: "SYSTEM",
          severity: "CRITICAL",
          title: "REAL_SUBMISSION_AMBIGUOUS — network error tras exit placeOrder",
          explanation: `Network error durante exit placeOrder. Orden puede estar viva en exchange. Marcado UNCERTAIN. NO reenviar. Posición retenida. Error: ${result.error}`,
          decision: "FAIL_CLOSED",
          executionMode: position.executionMode,
          reasonCode: "REAL_SUBMISSION_AMBIGUOUS",
          lotId: position.lotId,
          intentId: internalIntentId,
        });
      } else {
        // R10.6-3: Explicit REJECTED — atomically terminate intent AND revert position to OPEN
        try {
          await db.transaction(async (tx) => {
            await tx.execute(sql`
              UPDATE order_intents SET
                status = 'failed',
                updated_at = NOW()
              WHERE internal_intent_id = ${internalIntentId}
            `);
            await tx.execute(sql`
              UPDATE open_positions SET
                status = 'OPEN',
                updated_at = NOW()
              WHERE lot_id = ${position.lotId} AND status = 'EXIT_PENDING'
            `);
          });
        } catch (error: any) {
          console.error(`[SpotEngine] R10.6: Atomic exit rejection failed for ${position.lotId}: ${error.message}`);
        }
        logActivity({
          pair: position.pair,
          category: "EXIT",
          severity: "WARNING",
          title: "Salida rechazada — posición revertida",
          explanation: `Orden de salida rechazada: ${result.error}. Posición revertida a OPEN atómicamente.`,
          decision: "REJECT",
          executionMode: position.executionMode,
          reasonCode: "EXIT_REJECTED",
          lotId: position.lotId,
          orderId: result.orderId,
        });
      }
    } else {
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
    }
    return;
  }

  // R10.1: Handle pending fill for exit — persist real order IDs, don't close position
  if (result.pendingFill && result.fillPrice === null) {
    // R10.5: Consistent persistence — update order_intents AND open_positions in ONE transaction
    if (position.executionMode === ExecutionMode.REAL) {
      const venueOrderId = result.venueOrderId ?? result.orderId ?? null;
      await db.transaction(async (tx) => {
        await tx.execute(sql`
          UPDATE order_intents SET
            status = 'accepted',
            exchange_order_id = COALESCE(${venueOrderId}, exchange_order_id),
            updated_at = NOW()
          WHERE internal_intent_id = ${internalIntentId}
        `);
        await tx.execute(sql`
          UPDATE open_positions SET
            status = 'EXIT_PENDING',
            client_order_id = COALESCE(${result.clientOrderId ?? null}, client_order_id),
            venue_order_id = COALESCE(${venueOrderId}, venue_order_id),
            updated_at = NOW()
          WHERE lot_id = ${position.lotId}
        `);
      });
      // Update cache after commit
      const cached = getCachedRecord(internalIntentId);
      if (cached) {
        cached.status = "PENDING_FILL";
        cached.venueOrderId = venueOrderId;
      }
    } else {
      // Non-REAL: just update position
      await db.execute(sql`
        UPDATE open_positions SET
          status = 'EXIT_PENDING',
          client_order_id = COALESCE(${result.clientOrderId ?? null}, client_order_id),
          venue_order_id = COALESCE(${result.venueOrderId ?? result.orderId ?? null}, venue_order_id),
          updated_at = NOW()
        WHERE lot_id = ${position.lotId}
      `);
    }
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
    console.error("[SpotEngine] Failed to get active pairs — FAIL CLOSED:", error);
    throw new Error(`ACTIVE_PAIRS_DB_READ_FAILED: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function getActivePairsExportedForRoutes(): Promise<string[]> {
  return getActivePairs();
}

/**
 * Get available capital — B12: uses configurable shadow ledger, not hardcode 10_000.
 * R10.4: For REAL mode, uses authenticated exchange balance (getRealQuoteBalance).
 *        NO fallback to market_data USD capital — fail-closed if exchange unreachable.
 * R10.7-8: pair is MANDATORY — sizing must always use the balance of the concrete pair
 *          being entered, never the first active pair's balance.
 * R10.9-8: executionMode is MANDATORY and MUST be the mode the calling scan job started
 *          with — NEVER re-read getCachedExecutionMode() here. A scan that began under
 *          SHADOW must always size against the shadow ledger even if the global mode has
 *          since transitioned to REAL, and vice versa. The transition gate (generation +
 *          isEntryGenerationValid) is the ONLY mechanism allowed to invalidate a
 *          job — sizing must not silently switch ledgers mid-job.
 */
async function getAvailableCapital(pair: string, executionMode: ExecutionMode): Promise<number> {
  if (executionMode === ExecutionMode.SHADOW) {
    return getShadowAvailableCapital();
  }
  // R10.4: REAL mode — use authenticated exchange balance, NO fictitious fallback
  if (executionMode === ExecutionMode.REAL) {
    // R10.6: getRealQuoteBalance returns GROSS balance — subtract reserved capital here
    const grossBalance = await getRealQuoteBalance(pair);
    const reservedResult = await db.execute(sql`
      SELECT COALESCE(spot_real_reserved_capital_usd, 0) as reserved
      FROM bot_config LIMIT 1
    `);
    const reserved = Number(reservedResult.rows[0]?.reserved ?? 0);
    return Math.max(0, grossBalance - reserved);
  }
  // OFF mode — shouldn't be used for entries, but return 0 for safety
  return 0;
}

/**
 * R10.6: Get real GROSS quote balance from authenticated exchange for a specific pair.
 * Uses getBalance() which returns Record<string, number> keyed by currency.
 * Extracts quoteCurrency from the pair's metadata — NO fallback to "USD".
 * Returns the GROSS balance (does NOT subtract reserved capital).
 * The caller must subtract reserved capital separately to avoid double subtraction.
 * Fail-closed: returns 0 if balance unknown, missing, or exchange unreachable.
 */
async function getRealQuoteBalance(pair: string): Promise<number> {
  try {
    if (!pair) {
      console.error("[SpotEngine] getRealQuoteBalance: pair is mandatory — returning 0 (fail-closed)");
      return 0;
    }
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
    // R10.6: getBalance() returns Record<string, number> keyed by currency
    const balances = await anyExchange.getBalance() as Record<string, number>;
    if (!balances || typeof balances !== "object") {
      console.error("[SpotEngine] getRealQuoteBalance: getBalance returned non-object — returning 0 (fail-closed)");
      return 0;
    }
    // R10.7-8: Determine the quote currency from the specific pair's metadata — no fallback
    const meta = anyExchange.getPairMetadata?.(pair);
    if (!meta || !meta.quoteCurrency) {
      console.error(`[SpotEngine] getRealQuoteBalance: no quoteCurrency in metadata for ${pair} — returning 0 (fail-closed)`);
      return 0;
    }
    const quoteCurrency: string = meta.quoteCurrency;
    // R10.7-8: USD-only enforced at runtime, not just at readiness time
    if (quoteCurrency.toUpperCase() !== "USD") {
      console.error(`[SpotEngine] getRealQuoteBalance: pair ${pair} has quoteCurrency=${quoteCurrency} — only USD supported in REAL mode (fail-closed)`);
      return 0;
    }
    const balance = balances[quoteCurrency] ?? balances[quoteCurrency.toUpperCase()] ?? 0;
    if (!Number.isFinite(balance) || balance < 0) {
      console.error(`[SpotEngine] getRealQuoteBalance: invalid ${quoteCurrency} balance=${balance} — returning 0 (fail-closed)`);
      return 0;
    }
    // R10.6: Return GROSS balance — do NOT subtract reserved capital here.
    // The reservation check in persistAndReserveRealEntryIntentAtomic does the subtraction.
    return balance;
  } catch (error: any) {
    console.error(`[SpotEngine] getRealQuoteBalance: exchange balance query failed: ${error.message} — returning 0 (fail-closed)`);
    return 0;
  }
}

/**
 * R10.6: Unified helper to release reservation inside a DB transaction.
 * Locks the order_intent row, reads reserved_quote_usd, subtracts from bot_config,
 * and nulls the reservation. Idempotent — no-op if already released.
 * This is the SINGLE canonical implementation used by all atomic finalize/terminate functions.
 */
async function releaseReservationInTx(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  identifier: string,
  lookupBy: "internal_intent_id" | "client_order_id",
): Promise<void> {
  const intentRow = await tx.execute(sql`
    SELECT reserved_quote_usd FROM order_intents
    WHERE ${sql.raw(lookupBy)} = ${identifier}
    FOR UPDATE
  `);
  if (intentRow.rows.length === 0) return;

  const reservedUsd = intentRow.rows[0]?.reserved_quote_usd;
  if (reservedUsd != null && Number(reservedUsd) > 0) {
    const reservedUsdNum = Number(reservedUsd);
    const configLock = await tx.execute(sql`
      SELECT spot_real_reserved_capital_usd FROM bot_config FOR UPDATE LIMIT 1
    `);
    // R10.8-5: If this intent holds a positive reservation, bot_config MUST exist exactly
    // once. A missing row means the aggregate ledger is corrupt/uninitialized — we must
    // NOT silently pretend the release happened (which would desync per-intent evidence
    // from the aggregate). Throw and let the transaction roll back.
    if (configLock.rows.length === 0) {
      throw new Error(
        `REAL_RESERVATION_AGGREGATE_INCONSISTENT: bot_config row missing while releasing reservation ` +
        `reservedUsd=${reservedUsdNum} for ${lookupBy}=${identifier}`
      );
    }
    const currentReserved = Number(configLock.rows[0].spot_real_reserved_capital_usd ?? 0);
    // R10.8-5: The aggregate can NEVER be less than what this single intent claims to hold —
    // that would mean other reservations were already lost/corrupted. Do NOT clamp with
    // Math.max(0, ...) which would hide the inconsistency. Fail closed instead.
    if (currentReserved < reservedUsdNum) {
      throw new Error(
        `REAL_RESERVATION_AGGREGATE_INCONSISTENT: currentReserved=${currentReserved} < reservedUsd=${reservedUsdNum} ` +
        `for ${lookupBy}=${identifier} — aggregate ledger does not account for this intent's reservation`
      );
    }
    const newReserved = currentReserved - reservedUsdNum;
    await tx.execute(sql`
      UPDATE bot_config SET spot_real_reserved_capital_usd = ${newReserved}, updated_at = NOW()
    `);
    await tx.execute(sql`
      UPDATE order_intents SET reserved_quote_usd = NULL, reserved_quote_currency = NULL, updated_at = NOW()
      WHERE ${sql.raw(lookupBy)} = ${identifier}
    `);
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
 * R10.9-1/2: Returns an explicit PersistReserveOutcome instead of an ambiguous boolean.
 */
type PersistReserveOutcome =
  | { kind: "CREATED" }
  | { kind: "REARMED_PRE_SUBMIT" }
  | { kind: "EXISTING_ACTIVE" }
  | { kind: "EXISTING_FILLED" }
  | { kind: "EXISTING_TERMINAL" };

/**
 * R10.4: Durable per-intent REAL capital reservation.
 * Atomically inserts the order_intent with reserved_quote_usd AND increments
 * spot_real_reserved_capital_usd in bot_config in a SINGLE transaction.
 *
 * This replaces the old reserveRealCapital which was not durable — if the process
 * crashed between reservation and order submission, the capital was leaked.
 * With reserved_quote_usd on the intent, the reconciler can release it on restart.
 *
 * R10.9-1/2: Returns an explicit PersistReserveOutcome instead of an ambiguous boolean.
 * A PRE_SUBMISSION_CANCELLED row (status='cancelled', exchange_order_id IS NULL,
 * reserved_quote_usd IS NULL, SPOT_CANONICAL provenance, REAL executionMode) can be
 * safely rearmed: its clientOrderId was never sent to the exchange, so the same
 * clientOrderId is reused, the reservation is re-applied, and the row flips back to
 * 'pending' for a single placeOrder attempt.
 */
async function persistAndReserveRealEntryIntentAtomic(
  params: CreateSubmissionIntentParams,
  clientOrderId: string,
  venue: string,
  notionalUsd: number,
  grossQuoteBalance: number,
  quoteCurrency: string,
): Promise<PersistReserveOutcome> {
  // R10.7-9: Balance params are MANDATORY — no optional path that bypasses the capital check.
  if (!Number.isFinite(grossQuoteBalance) || grossQuoteBalance < 0) {
    throw new RealIntentPersistenceError(
      `persistAndReserve: invalid grossQuoteBalance=${grossQuoteBalance} — must be a finite number >= 0`
    );
  }
  if (!Number.isFinite(notionalUsd) || notionalUsd <= 0) {
    throw new RealIntentPersistenceError(
      `persistAndReserve: invalid notionalUsd=${notionalUsd} — must be a finite number > 0`
    );
  }
  if (quoteCurrency !== "USD") {
    throw new RealIntentPersistenceError(
      `persistAndReserve: unsupported quoteCurrency=${quoteCurrency} — only USD supported in REAL mode`
    );
  }

  return await db.transaction(async (tx) => {
    // 1. Lock bot_config and read current reservation
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

    // R10.7-9: ALWAYS validate notionalUsd <= available capital INSIDE the lock —
    // there is no code path that reserves without checking balance.
    const available = grossQuoteBalance - currentReserved;
    if (notionalUsd > available) {
      throw new RealIntentPersistenceError(
        `persistAndReserve: insufficient capital — notional=${notionalUsd}, available=${available} (balance=${grossQuoteBalance}, reserved=${currentReserved})`
      );
    }

    // 2. Insert order_intent with reserved_quote_usd and reserved_quote_currency — ON CONFLICT DO NOTHING
    // R10.7-9: Persist the quote currency that was actually resolved/validated for this balance —
    // not a hardcoded constant disconnected from grossQuoteBalance.
    const insertResult = await tx.execute(sql`
      INSERT INTO order_intents (
        client_order_id, exchange, pair, side, volume, status,
        internal_intent_id, engine_owner, policy_version, execution_mode,
        lot_id, requested_price, order_type, reason, reserved_quote_usd, reserved_quote_currency
      ) VALUES (
        ${clientOrderId}, ${venue}, ${params.pair}, ${params.side.toLowerCase()},
        ${params.requestedQty.toString()}, 'pending',
        ${params.internalIntentId}, ${SPOT_ENGINE_OWNER}, ${SPOT_POLICY_VERSION},
        ${params.executionMode},
        ${params.lotId}, ${params.requestedPrice?.toString() ?? null},
        ${params.orderType}, ${params.reason},
        ${notionalUsd.toString()}, ${quoteCurrency}
      )
      ON CONFLICT (client_order_id) DO NOTHING
      RETURNING id, client_order_id
    `);

    if (insertResult.rows.length > 0) {
      // 3a. Row freshly created — increment reserved capital
      const newReserved = currentReserved + notionalUsd;
      await tx.execute(sql`
        UPDATE bot_config SET
          spot_real_reserved_capital_usd = ${newReserved},
          updated_at = NOW()
      `);
      return { kind: "CREATED" };
    }

    // 3b. ON CONFLICT — row already existed. Lock it and decide what that means.
    const existingRowResult = await tx.execute(sql`
      SELECT id, status, exchange_order_id, reserved_quote_usd, reserved_quote_currency,
             engine_owner, policy_version, execution_mode
      FROM order_intents
      WHERE client_order_id = ${clientOrderId}
      FOR UPDATE
    `);
    if (existingRowResult.rows.length === 0) {
      // Should be impossible after ON CONFLICT, but fail-closed
      throw new RealIntentPersistenceError(
        `persistAndReserve: INSERT ON CONFLICT detected a conflict for clientOrderId=${clientOrderId} but SELECT returned no row`
      );
    }
    const row = existingRowResult.rows[0] as any;
    const status = row.status;

    // R10.9-1: active states — a submission is in flight, do NOT rearm or resend.
    if (status === "pending" || status === "accepted" || status === "uncertain") {
      return { kind: "EXISTING_ACTIVE" };
    }

    // R10.9-1: filled — the original call already executed; a position/trade should exist.
    if (status === "filled") {
      return { kind: "EXISTING_FILLED" };
    }

    // R10.9-1: safe PRE_SUBMISSION_CANCELLED rearm. The row is cancelled AND was never
    // sent to the exchange (exchange_order_id IS NULL) AND has no reservation left
    // (reserved_quote_usd IS NULL) AND belongs to the canonical REAL engine. Reuse the
    // same clientOrderId — it was never transmitted to the exchange, so there is no
    // duplicate-order risk. Re-validate capital inside the same lock and flip to pending.
    if (
      status === "cancelled" &&
      row.exchange_order_id == null &&
      row.reserved_quote_usd == null &&
      row.engine_owner === SPOT_ENGINE_OWNER &&
      row.policy_version === SPOT_POLICY_VERSION &&
      row.execution_mode === ExecutionMode.REAL
    ) {
      const available = grossQuoteBalance - currentReserved;
      if (notionalUsd > available) {
        throw new RealIntentPersistenceError(
          `persistAndReserve: REARM_PRE_SUBMIT insufficient capital — notional=${notionalUsd}, available=${available}`
        );
      }
      const newReserved = currentReserved + notionalUsd;
      await tx.execute(sql`
        UPDATE bot_config SET
          spot_real_reserved_capital_usd = ${newReserved},
          updated_at = NOW()
      `);
      await tx.execute(sql`
        UPDATE order_intents SET
          status = 'pending',
          reserved_quote_usd = ${notionalUsd.toString()},
          reserved_quote_currency = ${quoteCurrency},
          volume = ${params.requestedQty.toString()},
          requested_price = ${params.requestedPrice?.toString() ?? null},
          order_type = ${params.orderType},
          reason = ${params.reason},
          updated_at = NOW()
        WHERE client_order_id = ${clientOrderId}
      `);
      return { kind: "REARMED_PRE_SUBMIT" };
    }

    // R10.9-1: any other terminal state (failed, expired, cancelled with exchange_order_id,
    // cancelled without canonical provenance, etc.) is NOT safe to rearm.
    return { kind: "EXISTING_TERMINAL" };
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
  } catch (error: any) {
    // R10.9-4: FAIL-CLOSED — a DB error is UNKNOWN, not "0 open lots". Returning 0 here
    // would let evaluateSizing believe the pair has no exposure and approve a new REAL
    // BUY that violates max-lots-per-pair risk limits. Callers MUST block on this throw.
    console.error(`[SpotEngine] R10.9-4: countOpenLotsForPair(${pair}) DB error — cannot conclude 0 open lots:`, error.message);
    throw new Error(`REAL_OPEN_LOTS_QUERY_FAILED_FAIL_CLOSED: countOpenLotsForPair(${pair}): ${error.message}`);
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
  } catch (error: any) {
    // R10.8-7: FAIL-CLOSED — a DB error means UNKNOWN, not "no positions for this pair".
    // Returning [] would let a REAL position for this pair go unmanaged this cycle
    // without anyone noticing. Caller (manageOpenPositions, inside the supervisor's
    // per-pair try/catch) will log and retry next cycle rather than silently skip.
    console.error(`[SpotEngine] R10.8-7: Failed to get open positions for ${pair} (DB error) — cannot conclude no positions:`, error.message);
    throw new Error(`REAL_POSITION_QUERY_FAILED_FAIL_CLOSED: getOpenPositionsForPair(${pair}): ${error.message}`);
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

      // R10.6: Legacy inline reconciliation removed — reconcilePendingRealOrderIntents handles it.
      // PENDING_FILL / EXIT_PENDING positions without venueOrderId → mark UNCERTAIN
      if (status === 'PENDING_FILL' || status === 'EXIT_PENDING') {
        if (!venueOrderId) {
          console.warn(
            `[SpotEngine] RECOVERY: Position ${row.lot_id} has status=${status} but no venueOrderId. ` +
            `Marking as UNCERTAIN for manual review.`
          );
          await db.execute(sql`
            UPDATE open_positions SET status = 'UNCERTAIN', updated_at = NOW()
            WHERE lot_id = ${row.lot_id}
          `);
          logActivity({
            pair: row.pair as string,
            category: "SYSTEM",
            severity: "CRITICAL",
            title: "Posición incierta tras reinicio — sin venueOrderId",
            explanation: `Posición ${row.lot_id} tenía status=${status} sin venueOrderId. Marcada como UNCERTAIN.`,
            decision: "FAIL_CLOSED",
            executionMode: execMode as any,
            reasonCode: "RESTART_UNCERTAIN",
            lotId: row.lot_id as string,
          });
          continue;
        }
        // R10.6: Positions WITH venueOrderId are reconciled by reconcilePendingRealOrderIntents.
        // Load them as-is so the supervisor can continue monitoring.
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
    // R10.5: Re-throw so caller can fail-closed for REAL mode
    console.error("[SpotEngine] Failed to load open positions:", error);
    throw error;
  }
}

/**
 * R10.2: Reconcile pending REAL order_intents at restart.
 * R10.5: Handles BOTH BUY and SELL intents.
 * Domain separation:
 *   - ENTRY intents (BUY): in order_intents (side='buy', status pending/accepted)
 *   - EXIT intents (SELL): in order_intents (side='sell', status pending/accepted)
 *
 * For each pending entry intent (BUY):
 *   - FILLED → create open_position exactly once (SELECT FOR UPDATE guard)
 *   - PENDING → keep in order_intents, supervisor will monitor
 *   - FAILED/CANCELLED → finalize in order_intents, release reservation
 *   - UNCERTAIN → block, mark UNCERTAIN
 *
 * For each pending exit intent (SELL):
 *   - FILLED → finalize exit atomically (INSERT trade + DELETE position + UPDATE intent)
 *   - PENDING → keep in order_intents, supervisor will monitor
 *   - FAILED/CANCELLED → revert position status to OPEN, update intent
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
    // R10.5: Handle BOTH BUY and SELL intents — no skip for SELL
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

    if (intent.side === "BUY") {
      await reconcileBuyIntent(intent, reconciled);
    } else {
      await reconcileSellIntent(intent, reconciled);
    }
  }
}

/**
 * R10.5: Reconcile a BUY (entry) intent using the same atomic finalize as runtime.
 */
async function reconcileBuyIntent(
  intent: RealOrderRecord,
  reconciled: { state: string; fillPrice: number | null; fillVolume: number | null },
): Promise<void> {
    if (reconciled.state === "FILLED") {
      // R10.7-2: No external pre-check bypass. finalizeRealEntryFillAtomic is the SINGLE
      // authority for exactly-once materialization AND reservation release — including the
      // already-materialized path, which now releases the reservation before returning.
      // R10.5: Use finalizeRealEntryFillAtomic for exactly-once materialization
      const fillPrice = reconciled.fillPrice!;
      const fillVolume = reconciled.fillVolume!;
      const filledNotionalUsd = fillPrice * fillVolume;
      const lotId = `spot-${intent.pair}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

      // R10.5: Use the same atomic finalize function as runtime path
      const execResult: SpotExecutionResult = {
        success: true,
        orderId: intent.venueOrderId,
        clientOrderId: intent.clientOrderId,
        venueOrderId: intent.venueOrderId,
        fillPrice,
        fillVolume,
        fillQuality: "ESTIMATED" as any,
        feeUsd: null,
        slippageUsd: null,
        error: null,
        pendingFill: false,
        executedAt: Date.now(),
        submissionState: "ACCEPTED" as const,
      };

      // Build a minimal SpotPosition for atomic finalize
      const position: SpotPosition = {
        lotId,
        pair: intent.pair,
        amount: fillVolume,
        qtyRemaining: fillVolume,
        entryPrice: fillPrice,
        entryFee: 0,
        entryFeeQuality: "ESTIMATED" as any,
        highestPrice: fillPrice,
        openedAt: Date.now(),
        entryStrategyId: "SPOT_CANONICAL",
        entrySignalTf: "15m",
        signalConfidence: 0,
        signalReason: intent.reason ?? "",
        setupTag: SetupTag.PULLBACK_CONTINUATION,
        signalId: "",
        marketContextId: "",
        regimeAtEntry: Regime.RANGE,
        directionAtEntry: RegimeDirection.NEUTRAL,
        macroAtEntry: MacroBias.NEUTRAL,
        atrPctAtEntry: 0,
        initialStopPrice: 0,
        initialStopDistancePct: 0,
        initialStopDistanceUsd: 0,
        riskUsd: 0,
        notionalUsd: filledNotionalUsd,
        executionMode: ExecutionMode.REAL,
        policyVersion: SPOT_POLICY_VERSION,
        sgBreakEvenActivated: false,
        sgTrailingActivated: false,
        sgScaleOutDone: false,
        sgCurrentStopPrice: 0,
        mfe: 0,
        mae: 0,
        mfeR: 0,
        maeR: 0,
      };

      try {
        await finalizeRealEntryFillAtomic(position, execResult, filledNotionalUsd, intent.internalIntentId, intent.clientOrderId);
      } catch (error: any) {
        console.error(`[SpotEngine] R10.5: reconcileBuyIntent atomic finalize failed for ${intent.internalIntentId}: ${error.message}`);
        await updateSubmissionResult(intent.internalIntentId, { status: "UNCERTAIN" });
        logActivity({
          pair: intent.pair,
          category: "SYSTEM",
          severity: "CRITICAL",
          title: "REAL_EXECUTION_UNRESOLVED — materialización DB entrada falló en reconciliación",
          explanation: `Intent ${intent.internalIntentId} — exchange FILLED pero DB no pudo materializar. Marcado UNCERTAIN. Error: ${error.message}`,
          decision: "FAIL_CLOSED",
          executionMode: ExecutionMode.REAL,
          reasonCode: "RESTART_ENTRY_ATOMIC_FAILED",
          intentId: intent.internalIntentId,
          orderId: intent.venueOrderId,
        });
        return;
      }

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
      // R10.6: Use atomic termination — update intent status + release reservation in ONE tx
      try {
        await terminateIntentAndReleaseReservationAtomic(intent.internalIntentId, reconciled.state as "FAILED" | "CANCELLED");
      } catch (error: any) {
        console.error(`[SpotEngine] R10.6: Atomic termination failed for ${intent.internalIntentId}: ${error.message}`);
      }
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

/**
 * R10.5: Reconcile a SELL (exit) intent using the same atomic finalize as runtime.
 */
async function reconcileSellIntent(
  intent: RealOrderRecord,
  reconciled: { state: string; fillPrice: number | null; fillVolume: number | null },
): Promise<void> {
    if (reconciled.state === "FILLED") {
      // R10.5: Exit filled — find the open_position and finalize atomically
      if (!intent.lotId) {
        console.warn(`[SpotEngine] R10.5: SELL intent ${intent.internalIntentId} has no lotId — cannot finalize exit`);
        await updateSubmissionResult(intent.internalIntentId, { status: "UNCERTAIN" });
        return;
      }

      try {
        // Load the position from DB
        const posResult = await db.execute(sql`
          SELECT * FROM open_positions WHERE lot_id = ${intent.lotId} AND status != 'CLOSED'
          FOR UPDATE
        `);
        if (posResult.rows.length === 0) {
          // R10.9-11: Position already closed does NOT automatically mean the trade exists.
          // Verify trade count atomically before marking FILLED or UNCERTAIN.
          const tradeResult = await db.execute(sql`
            SELECT id FROM trades
            WHERE lot_id = ${intent.lotId}
              AND policy_version = ${SPOT_POLICY_VERSION}
              AND engine_owner = ${SPOT_ENGINE_OWNER}
          `);
          const tradeCount = tradeResult.rows.length;
          if (tradeCount === 1) {
            // Trade already materialized — replay is idempotent. Mark intent FILLED.
            await updateSubmissionResult(intent.internalIntentId, {
              status: "FILLED",
              fillPrice: reconciled.fillPrice,
              fillVolume: reconciled.fillVolume,
            });
            return;
          } else if (tradeCount === 0) {
            // INCONSISTENCY: exchange says FILLED but no position and no trade.
            console.error(`[SpotEngine] R10.9-11: SELL reconcile inconsistent for ${intent.internalIntentId} — position missing, no trade. Marking UNCERTAIN.`);
            await updateSubmissionResult(intent.internalIntentId, { status: "UNCERTAIN" });
            logActivity({
              pair: intent.pair,
              category: "SYSTEM",
              severity: "CRITICAL",
              title: "RECONCILE SELL INCONSISTENT",
              explanation: `Posición ${intent.lotId} no existe y no hay trade para intent ${intent.internalIntentId}. Exchange dice FILLED pero no hay materialización. Marcado UNCERTAIN.`,
              decision: "FAIL_CLOSED",
              executionMode: ExecutionMode.REAL,
              reasonCode: "REAL_EXIT_RECONCILE_INCONSISTENT",
              intentId: intent.internalIntentId,
              lotId: intent.lotId,
            });
            return;
          } else {
            // CRITICAL data invariant failure.
            throw new Error(
              `REAL_EXIT_RECONCILE_CRITICAL_INVARIANT: multiple trades (${tradeCount}) for lotId=${intent.lotId} ` +
              `during reconcile of intent ${intent.internalIntentId}`
            );
          }
        }

        const row = posResult.rows[0] as any;
        const position = rowToPosition({
          lotId: row.lot_id,
          pair: row.pair,
          amount: Number(row.amount),
          qtyRemaining: Number(row.qty_remaining ?? row.amount),
          entryPrice: Number(row.entry_price),
          highestPrice: Number(row.highest_price),
          entryFee: Number(row.entry_fee ?? 0),
          entryStrategyId: row.entry_strategy_id,
          entrySignalTf: row.entry_signal_tf,
          signalConfidence: Number(row.signal_confidence ?? 0),
          signalReason: row.signal_reason,
          executionMode: row.execution_mode,
          policyVersion: row.policy_version,
          engineOwner: row.engine_owner,
          setupTag: row.setup_tag,
          signalId: row.signal_id,
          marketContextId: row.market_context_id,
          regimeAtEntry: row.regime_at_entry,
          directionAtEntry: row.direction_at_entry,
          macroAtEntry: row.macro_at_entry,
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
          openedAt: row.opened_at ? new Date(row.opened_at).getTime() : Date.now(),
        });

        const fillPrice = reconciled.fillPrice!;
        const fillVolume = reconciled.fillVolume!;
        const execResult: SpotExecutionResult = {
          success: true,
          orderId: intent.venueOrderId,
          clientOrderId: intent.clientOrderId,
          venueOrderId: intent.venueOrderId,
          fillPrice,
          fillVolume,
          fillQuality: "ESTIMATED" as any,
          feeUsd: null,
          slippageUsd: null,
          error: null,
          pendingFill: false,
          executedAt: Date.now(),
          submissionState: "ACCEPTED" as const,
        };

        const pnl = computePnlBreakdown({
          entryPrice: position.entryPrice,
          exitPrice: fillPrice,
          volume: position.qtyRemaining,
          entryFeeUsd: position.entryFee,
        });

        const exitDecision: SpotExitDecision = {
          shouldExit: true,
          reason: "Reconciled exit",
          reasonType: null,
          price: fillPrice,
          volume: null,
          priority: null,
          evaluatedAt: Date.now(),
        };

        await finalizeRealExitFillAtomic(
          position, execResult, pnl, exitDecision, null, intent.internalIntentId,
        );

        logActivity({
          pair: intent.pair,
          category: "SYSTEM",
          severity: "SUCCESS",
          title: "Salida reconciliada desde order_intents",
          explanation: `Exit intent ${intent.internalIntentId} reconciled: FILLED @ ${fillPrice}, lot=${intent.lotId}`,
          decision: "RECONCILED",
          executionMode: ExecutionMode.REAL,
          reasonCode: "RESTART_EXIT_FILLED_FROM_INTENTS",
          intentId: intent.internalIntentId,
          lotId: intent.lotId,
          orderId: intent.venueOrderId,
          price: fillPrice,
        });
      } catch (error: any) {
        console.error(`[SpotEngine] R10.5: reconcileSellIntent atomic finalize failed for ${intent.internalIntentId}: ${error.message}`);
        await updateSubmissionResult(intent.internalIntentId, { status: "UNCERTAIN" });
        logActivity({
          pair: intent.pair,
          category: "SYSTEM",
          severity: "CRITICAL",
          title: "REAL_EXECUTION_UNRESOLVED — materialización DB salida falló en reconciliación",
          explanation: `Exit intent ${intent.internalIntentId} — exchange FILLED pero DB no pudo materializar. Marcado UNCERTAIN. Error: ${error.message}`,
          decision: "FAIL_CLOSED",
          executionMode: ExecutionMode.REAL,
          reasonCode: "RESTART_EXIT_ATOMIC_FAILED",
          intentId: intent.internalIntentId,
          lotId: intent.lotId ?? undefined,
          orderId: intent.venueOrderId,
        });
      }
    } else if (reconciled.state === "FAILED" || reconciled.state === "CANCELLED") {
      // R10.7-12: Exit failed/cancelled — update intent AND revert position to OPEN in ONE
      // transaction. No code path may leave intent=CANCELLED/FAILED with position=EXIT_PENDING.
      const dbStatus = reconciled.state === "FAILED" ? "failed" : "cancelled";
      try {
        await db.transaction(async (tx) => {
          const intentRow = await tx.execute(sql`
            SELECT id FROM order_intents WHERE internal_intent_id = ${intent.internalIntentId} FOR UPDATE
          `);
          if (intentRow.rows.length === 0) {
            throw new Error(`order_intent not found for internalIntentId=${intent.internalIntentId}`);
          }
          await tx.execute(sql`
            UPDATE order_intents SET status = ${dbStatus}, updated_at = NOW()
            WHERE internal_intent_id = ${intent.internalIntentId}
          `);
          if (intent.lotId) {
            await tx.execute(sql`
              SELECT lot_id FROM open_positions WHERE lot_id = ${intent.lotId} AND status = 'EXIT_PENDING' FOR UPDATE
            `);
            await tx.execute(sql`
              UPDATE open_positions SET status = 'OPEN', updated_at = NOW()
              WHERE lot_id = ${intent.lotId} AND status = 'EXIT_PENDING'
            `);
          }
        });
      } catch (error: any) {
        // R10.7-12: Transaction failed — fail-closed to UNCERTAIN rather than risk a
        // partial state (intent terminal + position stuck EXIT_PENDING).
        console.error(`[SpotEngine] R10.7-12: Atomic SELL ${reconciled.state} reconciliation failed for ${intent.internalIntentId}: ${error.message}`);
        try { await updateSubmissionResult(intent.internalIntentId, { status: "UNCERTAIN" }); } catch { /* best effort */ }
        logActivity({
          pair: intent.pair,
          category: "SYSTEM",
          severity: "CRITICAL",
          title: "Reconciliación de salida rechazada falló atómicamente",
          explanation: `Exit intent ${intent.internalIntentId} — no se pudo aplicar ${reconciled.state} atómicamente. Marcado UNCERTAIN. Error: ${error.message}`,
          decision: "FAIL_CLOSED",
          executionMode: ExecutionMode.REAL,
          reasonCode: "RESTART_EXIT_TERMINATE_ATOMIC_FAILED",
          intentId: intent.internalIntentId,
          lotId: intent.lotId ?? undefined,
          orderId: intent.venueOrderId,
        });
        return;
      }

      const cachedSell = getCachedRecord(intent.internalIntentId);
      if (cachedSell) cachedSell.status = reconciled.state as any;

      logActivity({
        pair: intent.pair,
        category: "SYSTEM",
        severity: "WARNING",
        title: `Exit intent ${reconciled.state} tras reinicio`,
        explanation: `Exit intent ${intent.internalIntentId} reconciled: ${reconciled.state}. Posición revertida a OPEN.`,
        decision: "RECONCILED",
        executionMode: ExecutionMode.REAL,
        reasonCode: `RESTART_EXIT_${reconciled.state}`,
        intentId: intent.internalIntentId,
        lotId: intent.lotId ?? undefined,
        orderId: intent.venueOrderId,
      });
    } else if (reconciled.state === "PENDING") {
      console.log(`[SpotEngine] R10.5: Exit intent ${intent.internalIntentId} still PENDING on exchange`);
    } else {
      // UNCERTAIN — block
      await updateSubmissionResult(intent.internalIntentId, { status: "UNCERTAIN" });
      logActivity({
        pair: intent.pair,
        category: "SYSTEM",
        severity: "CRITICAL",
        title: "Exit intent incierta tras reinicio",
        explanation: `Exit intent ${intent.internalIntentId} — exchange API could not resolve. Marked UNCERTAIN.`,
        decision: "FAIL_CLOSED",
        executionMode: ExecutionMode.REAL,
        reasonCode: "RESTART_EXIT_UNCERTAIN",
        intentId: intent.internalIntentId,
        lotId: intent.lotId ?? undefined,
        orderId: intent.venueOrderId,
      });
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
      // R10.5: getOrder null is UNCERTAIN, not CANCELLED — order may exist but API couldn't find it
      return { state: "UNCERTAIN", fillPrice: null, fillVolume: null };
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
  const venue = await getTradingVenueFailClosed();
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
      // R10.7-2: Already materialized — update intent to FILLED AND release reservation
      // if still present. finalizeRealEntryFillAtomic is the SINGLE authority for this path —
      // no external pre-check bypass may return before this release.
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
      await releaseReservationInTx(tx, clientOrderId, "client_order_id");
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
      RETURNING id, reserved_quote_usd
    `);

    // R10.6: Use unified releaseReservationInTx helper
    // R10.6-11: Also release if entry was already materialized (the exactly-once guard above returned early)
    await releaseReservationInTx(tx, clientOrderId, "client_order_id");
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
 * R10.5: Atomic intent termination + reservation release for explicit rejections.
 * Transaction: lock order_intent → UPDATE status to FAILED/CANCELLED → release reservation → COMMIT.
 */
async function terminateIntentAndReleaseReservationAtomic(
  internalIntentId: string,
  finalStatus: "FAILED" | "CANCELLED",
): Promise<void> {
  await db.transaction(async (tx) => {
    const intentRow = await tx.execute(sql`
      SELECT id FROM order_intents
      WHERE internal_intent_id = ${internalIntentId}
      FOR UPDATE
    `);
    if (intentRow.rows.length === 0) return;

    const dbStatus = finalStatus === "FAILED" ? "failed" : "cancelled";

    // R10.7-1: Release the reservation FIRST (while reserved_quote_usd is still populated).
    // releaseReservationInTx reads reserved_quote_usd, decrements the aggregate exactly once,
    // then nulls reserved_quote_usd + reserved_quote_currency. Nulling the reservation BEFORE
    // calling this helper would make it read NULL and silently no-op — that was the R10.6 bug.
    await releaseReservationInTx(tx, internalIntentId, "internal_intent_id");

    // Now update the terminal status — reservation fields are already cleared above.
    await tx.execute(sql`
      UPDATE order_intents SET
        status = ${dbStatus},
        updated_at = NOW()
      WHERE internal_intent_id = ${internalIntentId}
    `);
  });

  const cached = getCachedRecord(internalIntentId);
  if (cached) {
    cached.status = finalStatus;
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
  const venue = await getTradingVenueFailClosed();
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
      // R10.9-11: Position already closed does NOT automatically mean the trade exists.
      // We must demonstrate exactly one trade for this lot before marking FILLED.
      const tradeResult = await tx.execute(sql`
        SELECT id FROM trades
        WHERE lot_id = ${position.lotId}
          AND policy_version = ${SPOT_POLICY_VERSION}
          AND engine_owner = ${SPOT_ENGINE_OWNER}
      `);
      const tradeCount = tradeResult.rows.length;
      if (tradeCount === 1) {
        // Trade already materialized — replay is idempotent. Mark intent FILLED and return.
        await tx.execute(sql`
          UPDATE order_intents SET status = 'filled', updated_at = NOW()
          WHERE internal_intent_id = ${internalIntentId}
        `);
        return;
      } else if (tradeCount === 0) {
        // INCONSISTENCY: exchange says FILLED but no position and no trade. Do NOT invent state.
        throw new Error(
          `REAL_EXIT_INCONSISTENT: open_position missing for lotId=${position.lotId} and no trade exists. ` +
          `Cannot mark intent ${internalIntentId} as FILLED.`
        );
      } else {
        // CRITICAL data invariant failure: multiple trades for the same lot.
        throw new Error(
          `REAL_EXIT_CRITICAL_INVARIANT: multiple trades (${tradeCount}) found for lotId=${position.lotId}. ` +
          `Data invariant violated for intent ${internalIntentId}.`
        );
      }
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
      RETURNING id, reserved_quote_usd
    `);

    // R10.6: Use unified releaseReservationInTx helper
    await releaseReservationInTx(tx, internalIntentId, "internal_intent_id");
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
 * R10.5: Prepare REAL activation with structural + final readiness split.
 * Called from POST /api/spot/mode when transitioning to REAL.
 * Does NOT depend on SpotEngine being started.
 *
 * Flow:
 *   1. checkStructuralReadiness (no runtime state — avoids deadlock)
 *   2. loadPendingRealOrders (fail-closed)
 *   3. reconcile pendings
 *   4. checkRealReadiness (full — includes runtime state)
 *   5. freeze gate check
 *   6. return { ready, readiness, error? }
 */
export async function prepareRealActivation(): Promise<{
  ready: boolean;
  readiness: any;
  error?: string;
}> {
  // 1. Structural readiness check (no runtime state — safe to call during reconciliation)
  const { checkStructuralReadiness, checkRealReadiness } = await import("./spotRealReadiness");
  const structuralReadiness = await checkStructuralReadiness();
  if (!structuralReadiness.ready) {
    return { ready: false, readiness: structuralReadiness, error: "Structural readiness checks failed" };
  }

  // 2. Load pending REAL orders (fail-closed)
  let pendingOrders: Awaited<ReturnType<typeof loadPendingRealOrders>>;
  try {
    pendingOrders = await loadPendingRealOrders();
  } catch (error: any) {
    return { ready: false, readiness: structuralReadiness, error: `LOAD_PENDING_DB_FAILURE: ${error.message}` };
  }

  // 3. Reconcile pendings if any
  if (pendingOrders.length > 0) {
    console.log(`[SpotEngine] R10.5: prepareRealActivation — reconciling ${pendingOrders.length} pending orders`);
    try {
      await reconcilePendingRealOrderIntents();
    } catch (error: any) {
      return { ready: false, readiness: structuralReadiness, error: `RECONCILIATION_FAILED: ${error.message}` };
    }
  }

  // 4. Final readiness check (includes runtime state — safe now that reconciliation is done)
  const finalReadiness = await checkRealReadiness();
  if (!finalReadiness.ready) {
    return { ready: false, readiness: finalReadiness, error: "Post-reconciliation readiness checks failed" };
  }

  // 5. Freeze gate — no REAL activation if unresolved executions remain
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

/**
 * R10.8-6: Fail-closed trading venue resolution for REAL-mode critical paths
 * (persist+reserve, placeOrder, fill materialization). PROHIBITS the "kraken"
 * invented fallback used by getTradingVenue() (which is only safe for SHADOW-mode
 * DB tagging metadata, never for gating a REAL order).
 *
 * Requires:
 *   - api_config.trading_exchange to be a real, non-empty configured value;
 *   - it must match ExchangeFactory.getTradingExchange().exchangeName (normalized);
 *   - any DB error, missing value, or mismatch is a BLOCK — never a guess.
 */
export async function getTradingVenueFailClosed(): Promise<string> {
  let configuredVenue: string;
  try {
    const result = await db.execute(sql`
      SELECT trading_exchange FROM api_config LIMIT 1
    `);
    const raw = result.rows[0]?.trading_exchange as string | null | undefined;
    if (!raw || typeof raw !== "string" || raw.trim() === "") {
      throw new Error("api_config.trading_exchange is missing or empty");
    }
    configuredVenue = raw.trim().toLowerCase();
  } catch (error: any) {
    throw new Error(`REAL_TRADING_VENUE_UNVERIFIED: DB error reading api_config.trading_exchange: ${error.message}`);
  }

  let runtimeVenue: string;
  try {
    const runtimeName = ExchangeFactory.getTradingExchange()?.exchangeName;
    if (!runtimeName || typeof runtimeName !== "string" || runtimeName.trim() === "") {
      throw new Error("runtime exchange has no exchangeName");
    }
    runtimeVenue = runtimeName.trim().toLowerCase();
  } catch (error: any) {
    throw new Error(`REAL_TRADING_VENUE_UNVERIFIED: could not resolve runtime exchange: ${error.message}`);
  }

  if (configuredVenue !== runtimeVenue) {
    throw new Error(
      `REAL_TRADING_VENUE_MISMATCH: configured=${configuredVenue} runtime=${runtimeVenue}`
    );
  }
  return runtimeVenue;
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
 * R10.9-15: FAIL-CLOSED — a DB error is UNKNOWN, never "zero positions". The API route
 * must return 500 so the caller cannot base a trading/UI decision on a silent empty list.
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
  } catch (error: any) {
    console.error("[SpotEngine] R10.9-15: Failed to get open positions (DB error) — throwing:", error.message);
    throw new Error(`REAL_POSITION_QUERY_FAILED_FAIL_CLOSED: getOpenPositions: ${error.message}`);
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
 * R10.9-15: FAIL-CLOSED — a DB error is UNKNOWN. Returning fabricated zero stats could
 * hide a real P&L/position state. The API route returns 500.
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
  } catch (error: any) {
    console.error("[SpotEngine] R10.9-15: Failed to get summary stats (DB error) — throwing:", error.message);
    throw new Error(`REAL_POSITION_QUERY_FAILED_FAIL_CLOSED: getSummaryStats: ${error.message}`);
  }
}
