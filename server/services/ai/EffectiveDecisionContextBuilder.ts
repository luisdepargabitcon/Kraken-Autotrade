/**
 * EffectiveDecisionContextBuilder — FASE 4
 *
 * Builds a normalized, versioned JSON snapshot of the FULL effective decision
 * context used by the AI / Shadow Mode / Dry Run / Autotuning at the moment
 * a trading decision is evaluated.
 *
 * This is a PURE function — no DB access, no side effects.
 * Consumers persist the result in effective_decision_context_json JSONB columns.
 *
 * Safety guarantees:
 *  - Never modifies config, positions, or orders.
 *  - Never calls exchange APIs.
 *  - All fields are optional (undefined → null in output) for backward compat.
 *  - Versioned via `version` field so UI/analytics can handle schema evolution.
 */

export type DecisionSource = "spot" | "dry_run" | "shadow" | "idca" | "smart_exit";
export type DecisionMode   = "normal" | "dry_run" | "observer" | "live";
export type DecisionPhase  = "entry" | "exit" | "hold" | "block" | "observer";

export interface EffectiveDecisionContextInput {
  // ── Identity ──────────────────────────────────────────────────────────────
  pair: string;
  source: DecisionSource;
  mode: DecisionMode;
  decisionPhase: DecisionPhase;

  // ── Bot global state ───────────────────────────────────────────────────────
  botState?: {
    botActive?: boolean;
    dryRunMode?: boolean;
    strategy?: string;
    signalTimeframe?: string;
    positionMode?: string;
    riskLevel?: string;
    activePairs?: string[];
    tradingHoursEnabled?: boolean;
    tradingHoursStart?: number;
    tradingHoursEnd?: number;
  };

  // ── Signal quality ────────────────────────────────────────────────────────
  entryPolicy?: {
    signalRequirementLevel?: number;
    requiredSignals?: number | null;
    detectedSignals?: number | null;
    passedSignals?: string[];
    failedSignals?: string[];
    finalSignalScore?: number | null;
    entryAllowedBeforeGuards?: boolean | null;
    normalizedSignalReason?: string | null;
    naturalSignalReason?: string | null;
  };

  // ── Cooldowns ─────────────────────────────────────────────────────────────
  cooldowns?: {
    generalMinutes?: number | null;
    postStopLossMinutes?: number | null;
    activeCooldownType?: string | null;   // "general" | "post_stop_loss" | null
    cooldownRemainingSec?: number | null;
    blockedByCooldown?: boolean;
  };

  // ── Hybrid Guard (anti-cresta) ────────────────────────────────────────────
  hybridGuard?: {
    enabled?: boolean | null;
    antiCrestEnabled?: boolean | null;
    blocked?: boolean;
    watchId?: number | null;
    reason?: string | null;              // "ANTI_CRESTA" | "MTF_STRICT" | null
    distanceToEma20Pct?: number | null;
    ema20?: number | null;
    currentPrice?: number | null;
  };

  // ── Smart Guard ───────────────────────────────────────────────────────────
  smartGuard?: {
    enabled?: boolean | null;
    maxOpenLotsPerPair?: number | null;
    minEntryUsd?: number | null;
    allowUnderMin?: boolean | null;
    effectivePairOverride?: string | null;
    lotSpacingPolicy?: string | null;
    dynamicAtrDistancePct?: number | null;
    openLotsCurrent?: number | null;
    blockedByMaxLots?: boolean;
    blockedBySpacing?: boolean;
    blockedByMinEntry?: boolean;
  };

  // ── Entry filters ─────────────────────────────────────────────────────────
  entryFilters?: {
    spreadFilterEnabled?: boolean | null;
    spreadPct?: number | null;
    spreadThresholdPct?: number | null;
    blockedBySpread?: boolean;
    stalenessGateEnabled?: boolean | null;
    stalenessSec?: number | null;
    stalenessMaxSec?: number | null;
    blockedByStaleness?: boolean;
    chaseGateEnabled?: boolean | null;
    chasePct?: number | null;
    chaseMaxPct?: number | null;
    blockedByChase?: boolean;
  };

  // ── Regime ────────────────────────────────────────────────────────────────
  regime?: {
    regimeDetectionEnabled?: boolean | null;
    regimeRouterEnabled?: boolean | null;
    detectedRegime?: string | null;
    confidence?: number | null;
    routerDecision?: string | null;
    rangeCooldownMinutes?: number | null;
    transitionSizeFactor?: number | null;
  };

  // ── Risk / exposure ───────────────────────────────────────────────────────
  risk?: {
    maxPairExposurePct?: number | null;
    maxTotalExposurePct?: number | null;
    exposureBase?: string | null;
    riskPerTradePct?: number | null;
    dailyLossLimitEnabled?: boolean | null;
    dailyLossLimitPercent?: number | null;
    currentPairExposure?: number | null;
    currentTotalExposure?: number | null;
    blockedByExposure?: boolean;
    blockedByDailyLoss?: boolean;
  };

  // ── Market snapshot ───────────────────────────────────────────────────────
  market?: {
    price?: number | null;
    spreadPct?: number | null;
    atrPct?: number | null;
    vwap?: number | null;
    ema20?: number | null;
    ema50?: number | null;
    rsi?: number | null;
    volume?: number | null;
    zScore?: number | null;
    candlesTimeframe?: string | null;
    dataQuality?: string | null;
  };

  // ── Exit policy config ────────────────────────────────────────────────────
  exitPolicy?: {
    stopLossPercent?: number | null;
    takeProfitPercent?: number | null;
    trailingStopEnabled?: boolean | null;
    trailingStopPercent?: number | null;
    breakEvenEnabled?: boolean | null;
    beAtPct?: number | null;
    scaleOutEnabled?: boolean | null;
    scaleOutPct?: number | null;
    smartExitEnabled?: boolean | null;
    timeStopHours?: number | null;
    timeStopMode?: string | null;
  };

  // ── Exit live state ───────────────────────────────────────────────────────
  exitState?: {
    beArmed?: boolean | null;
    trailingArmed?: boolean | null;
    currentStopPrice?: number | null;
    positionAgeHours?: number | null;
    smartExitState?: string | null;
    timeStopCandidate?: boolean | null;
    exitBlockedReason?: string | null;
  };

  // ── IDCA Hybrid context ───────────────────────────────────────────────────
  idcaHybrid?: {
    enabled?: boolean | null;
    mode?: string | null;
    profile?: string | null;
    meanReversionEnabled?: boolean | null;
    gridEnabled?: boolean | null;
    regime?: string | null;
    meanReversionState?: string | null;
    gridState?: string | null;
    observerOnly?: boolean | null;
    doNotRewriteAnchor?: boolean | null;
    cycleKind?: string | null;
    isManualCycle?: boolean | null;
    isImported?: boolean | null;
  };

  // ── AI decision ──────────────────────────────────────────────────────────
  decision?: {
    allowed?: boolean | null;
    blocked?: boolean | null;
    action?: string | null;
    normalizedReason?: string | null;
    naturalReason?: string | null;
    aiProbability?: number | null;
    aiThreshold?: number | null;
    aiRecommendation?: string | null;
  };

  // ── Outcome (filled later) ────────────────────────────────────────────────
  outcome?: {
    known?: boolean;
    label?: string | null;
    netPnl?: number | null;
    cleanSellPnl?: number | null;
    fees?: number | null;
    holdDurationMinutes?: number | null;
    maxFavorableExcursionPct?: number | null;
    maxAdverseExcursionPct?: number | null;
  };
}

export interface EffectiveDecisionContext extends EffectiveDecisionContextInput {
  version: 1;
  timestamp: string;
}

/**
 * Build a normalized effective decision context snapshot.
 * Returns a versioned JSON object safe to persist in JSONB columns.
 * All undefined fields are converted to null for clean JSON storage.
 */
export function buildEffectiveDecisionContext(
  input: EffectiveDecisionContextInput
): EffectiveDecisionContext {
  return {
    version: 1,
    timestamp: new Date().toISOString(),
    pair: input.pair,
    source: input.source,
    mode: input.mode,
    decisionPhase: input.decisionPhase,
    botState: _nullifyUndefined(input.botState),
    entryPolicy: _nullifyUndefined(input.entryPolicy),
    cooldowns: _nullifyUndefined(input.cooldowns),
    hybridGuard: _nullifyUndefined(input.hybridGuard),
    smartGuard: _nullifyUndefined(input.smartGuard),
    entryFilters: _nullifyUndefined(input.entryFilters),
    regime: _nullifyUndefined(input.regime),
    risk: _nullifyUndefined(input.risk),
    market: _nullifyUndefined(input.market),
    exitPolicy: _nullifyUndefined(input.exitPolicy),
    exitState: _nullifyUndefined(input.exitState),
    idcaHybrid: _nullifyUndefined(input.idcaHybrid),
    decision: _nullifyUndefined(input.decision),
    outcome: input.outcome ?? { known: false, label: null, netPnl: null, cleanSellPnl: null, fees: null, holdDurationMinutes: null, maxFavorableExcursionPct: null, maxAdverseExcursionPct: null },
  };
}

/** Recursively replace undefined values with null for clean JSON serialization */
function _nullifyUndefined<T>(obj: T | undefined): T | undefined {
  if (obj === undefined || obj === null) return obj;
  if (typeof obj !== "object") return obj;
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    result[k] = v === undefined ? null : v;
  }
  return result as T;
}
