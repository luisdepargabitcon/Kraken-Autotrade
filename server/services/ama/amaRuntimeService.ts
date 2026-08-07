/**
 * AMA Runtime Service — Replaces in-memory amaService stub with persistent runtime.
 *
 * RESTART_SAFE: State persisted to ama_runtime_state table.
 * SHADOW_READY: Shadow orders persisted to ama_shadow_orders.
 * REAL_READY: REAL_LIMITED requires persistent authorization.
 *
 * This service wraps the domain pure functions with PostgreSQL persistence.
 * It does NOT replace the domain modules — it orchestrates them.
 *
 * SAFETY:
 * - REAL_FULL is permanently locked.
 * - REAL_LIMITED requires explicit authorization from ama_real_authorization table.
 * - Kill switch is persisted and survives restarts.
 * - Mode transitions are validated and logged.
 */

import {
  AMA_DISPLAY_NAME,
  AMA_SHORT_NAME,
  AMA_STRATEGY_CODE,
  AMA_STRATEGY_VERSION,
  AMA_PAIR,
  AMA_MODE_VALUES,
  isModeReal,
  isModeShadow,
  isModeSimulation,
  type AmaMode,
  type AmaState,
  type AmaStatus,
  type AmaMarketView,
  type AmaMandateInput,
  type AmaResolvedPolicy,
  type AmaTranchePlan,
  type AmaCycle,
  type AmaTranche,
  type AmaPortfolioSummary,
} from "./amaTypes";
import { validateModeTransition } from "./amaDomainPersistent";
import {
  getRuntimeState,
  updateRuntimeState,
  incrementRestartCount,
  insertModeChange,
  getActiveCycle,
  getCyclesByAsset,
  getTranchesByCycle,
  getActivePolicy,
  getLatestTranchePlan,
  insertAuditEvent,
  insertStateTransition,
  checkAmaSchemaAvailable,
  type AmaRuntimeStateRow,
} from "./amaRepository";
import { isRealLimitedAuthorized } from "./amaRealAuthorizationRepository";
import type { AssetSymbol } from "./amaSeedTypes";

// ─── Runtime State (in-memory cache, backed by DB) ───────────────────

interface RuntimeCache {
  mode: AmaMode;
  state: AmaState;
  killSwitchActive: boolean;
  cycleId: string | null;
  activePolicyId: string | null;
  mandateId: string | null;
  initialized: boolean;
}

const cache: RuntimeCache = {
  mode: "OFF",
  state: "OBSERVING",
  killSwitchActive: false,
  cycleId: null,
  activePolicyId: null,
  mandateId: null,
  initialized: false,
};

// ─── Initialization ──────────────────────────────────────────────────

export async function initializeRuntime(): Promise<void> {
  if (cache.initialized) return;

  const schemaAvailable = await checkAmaSchemaAvailable();
  if (!schemaAvailable) {
    cache.initialized = true;
    return;
  }

  const state = await getRuntimeState();
  if (state) {
    cache.mode = state.mode as AmaMode;
    cache.state = state.state as AmaState;
    cache.killSwitchActive = state.killSwitchActive;
    cache.cycleId = state.activeCycleId;
    cache.activePolicyId = state.activePolicyId;
    cache.mandateId = state.activeMandateId;

    await incrementRestartCount();
    await insertAuditEvent("RUNTIME_RESTART", "INFO", {
      mode: cache.mode,
      state: cache.state,
      killSwitch: cache.killSwitchActive,
    });
  }

  cache.initialized = true;
}

// ─── Mode Management ─────────────────────────────────────────────────

export async function setMode(
  mode: AmaMode,
  changedBy: string = "SYSTEM",
  reason?: string,
): Promise<void> {
  await initializeRuntime();

  if (mode === cache.mode) {
    throw new Error(`[AMA] Mode is already ${mode}`);
  }

  // REAL_FULL permanently locked
  if (mode === "REAL_FULL") {
    throw new Error(`[AMA] REAL_FULL is permanently locked.`);
  }

  // REAL_LIMITED requires authorization
  if (mode === "REAL_LIMITED") {
    const authorized = await isRealLimitedAuthorized();
    if (!authorized) {
      throw new Error(`[AMA] REAL_LIMITED requires explicit authorization. Gate locked.`);
    }
  }

  // Validate transition
  const transition = validateModeTransition(cache.mode, mode);
  if (!transition.valid) {
    throw new Error(`[AMA] Mode transition blocked: ${transition.reason}`);
  }

  const previousMode = cache.mode;
  const previousKillSwitch = cache.killSwitchActive;

  // Persist
  await updateRuntimeState({ mode, state: "OBSERVING" });
  await insertModeChange(previousMode, mode, changedBy, reason, previousKillSwitch, cache.killSwitchActive);
  await insertAuditEvent("MODE_CHANGE", "INFO", {
    from: previousMode,
    to: mode,
    changedBy,
    reason,
  });

  // Update cache
  cache.mode = mode;
  cache.state = "OBSERVING";
}

export function getMode(): AmaMode {
  return cache.mode;
}

export function canSetMode(mode: AmaMode): boolean {
  if (mode === "REAL_FULL") return false;
  if (mode === "REAL_LIMITED") return true; // can be attempted, will be gated
  return true;
}

// ─── Kill Switch ─────────────────────────────────────────────────────

export async function setKillSwitch(active: boolean): Promise<void> {
  await initializeRuntime();
  cache.killSwitchActive = active;
  await updateRuntimeState({ killSwitchActive: active });
  await insertAuditEvent(active ? "KILL_SWITCH_ACTIVATED" : "KILL_SWITCH_DEACTIVATED", "WARN", {
    previousMode: cache.mode,
  });
}

export function isKillSwitchActive(): boolean {
  return cache.killSwitchActive;
}

// ─── Status ──────────────────────────────────────────────────────────

export async function getStatus(): Promise<AmaStatus> {
  await initializeRuntime();
  return {
    mode: cache.mode,
    state: cache.state,
    protectionState: null,
    pair: AMA_PAIR,
    strategyVersion: AMA_STRATEGY_VERSION,
    cycleId: cache.cycleId,
    activePolicyId: cache.activePolicyId,
    mandateId: cache.mandateId,
    killSwitchActive: cache.killSwitchActive,
    lastUpdated: new Date().toISOString(),
  };
}

// ─── Market View ─────────────────────────────────────────────────────

export function getMarketView(): AmaMarketView {
  return {
    pair: AMA_PAIR,
    analysisPrice: null,
    analysisTimestamp: null,
    executionBid: null,
    executionAsk: null,
    executionMid: null,
    spreadPct: null,
    crossVenueBasisPct: null,
    executionTimestamp: null,
    highWaterMark: null,
    cycleLow: null,
    currentDropPct: null,
    maxDropPct: null,
    reboundFromLowPct: null,
    macroZone: null,
    daysSinceCeiling: null,
    daysSinceLow: null,
    dataQuality: "UNAVAILABLE",
  };
}

// ─── Mandate ─────────────────────────────────────────────────────────

export function getMandate(): AmaMandateInput | null {
  return null;
}

export async function saveMandateDraft(input: AmaMandateInput): Promise<{ mandateId: string }> {
  const mandateId = `mandate-${Date.now()}`;
  cache.mandateId = mandateId;
  await updateRuntimeState({ activeMandateId: mandateId });
  await insertAuditEvent("MANDATE_DRAFT_SAVED", "INFO", { mandateId, input });
  return { mandateId };
}

// ─── Policy ──────────────────────────────────────────────────────────

export async function getActivePolicyRuntime(): Promise<AmaResolvedPolicy | null> {
  if (!cache.activePolicyId) return null;
  return await getActivePolicy();
}

// ─── Tranche Plan ────────────────────────────────────────────────────

export async function getTranchePlan(): Promise<AmaTranchePlan | null> {
  if (!cache.cycleId) return null;
  return await getLatestTranchePlan(cache.cycleId);
}

// ─── Cycles ──────────────────────────────────────────────────────────

export async function getCycles(): Promise<AmaCycle[]> {
  return await getCyclesByAsset("BTC");
}

export async function getTranches(cycleId: string): Promise<AmaTranche[]> {
  return await getTranchesByCycle(cycleId);
}

export async function getActiveCycleRuntime(): Promise<AmaCycle | null> {
  return await getActiveCycle();
}

// ─── Portfolio Summary ───────────────────────────────────────────────

export async function getPortfolioSummary(): Promise<AmaPortfolioSummary> {
  await initializeRuntime();
  const cycle = await getActiveCycle();
  if (!cycle) {
    return {
      mode: cache.mode,
      budgetUsd: 0,
      deployedUsd: 0,
      reservedUsd: 0,
      freeUsd: 0,
      accumulatedQuantity: 0,
      averageCostBasis: null,
      currentValueUsd: null,
      unrealizedPnlUsd: null,
      realizedPnlUsd: null,
      sleeves: [],
    };
  }
  return {
    mode: cache.mode,
    budgetUsd: cycle.budgetUsd,
    deployedUsd: cycle.deployedUsd,
    reservedUsd: cycle.reservedUsd,
    freeUsd: cycle.freeUsd,
    accumulatedQuantity: cycle.accumulatedQuantity,
    averageCostBasis: cycle.averageCostBasis,
    currentValueUsd: null,
    unrealizedPnlUsd: null,
    realizedPnlUsd: null,
    sleeves: [],
  };
}

// ─── Meta ────────────────────────────────────────────────────────────

export function getDisplayName(): string {
  return AMA_DISPLAY_NAME;
}

export function getShortName(): string {
  return AMA_SHORT_NAME;
}

export function getStrategyCode(): string {
  return AMA_STRATEGY_CODE;
}

export function getStrategyVersion(): string {
  return AMA_STRATEGY_VERSION;
}

export function getModes(): AmaMode[] {
  return AMA_MODE_VALUES;
}

// ─── State Transitions ───────────────────────────────────────────────

export async function transitionState(
  newState: AmaState,
  reason?: string,
): Promise<void> {
  await initializeRuntime();
  const oldState = cache.state;
  if (oldState === newState) return;

  await insertStateTransition(cache.cycleId, oldState, newState, reason);
  await updateRuntimeState({ state: newState });
  await insertAuditEvent("STATE_TRANSITION", "INFO", {
    from: oldState,
    to: newState,
    cycleId: cache.cycleId,
    reason,
  });

  cache.state = newState;
}

// ─── Tick (runtime heartbeat) ────────────────────────────────────────

export async function tick(): Promise<void> {
  await initializeRuntime();
  if (cache.mode === "OFF") return;
  if (cache.killSwitchActive) return;

  await updateRuntimeState({ lastTickAt: new Date().toISOString() });
}

// ─── Export cache for testing ────────────────────────────────────────

export function _getCacheForTesting(): RuntimeCache {
  return { ...cache };
}

export function _resetCacheForTesting(): void {
  cache.mode = "OFF";
  cache.state = "OBSERVING";
  cache.killSwitchActive = false;
  cache.cycleId = null;
  cache.activePolicyId = null;
  cache.mandateId = null;
  cache.initialized = false;
}
