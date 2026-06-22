/**
 * IdcaHybridDecisionService — Coordinator for IDCA Hybrid Intelligent Layers.
 *
 * Orchestrates:
 *   1. Regime classification (IdcaRegimeAdapter)
 *   2. Mean Reversion overlay (IdcaMeanReversionOverlay)
 *   3. Grid overlay (IdcaGridOverlay)
 *   4. Persistence (idca_hybrid_state, idca_grid_legs)
 *   5. Alert dispatch (IdcaHybridAlertService)
 *
 * Modes:
 *   off      → returns legacy action immediately, zero overhead
 *   observer → evaluates all layers, persists to DB, sends alerts, does NOT block checkEntry
 *   real     → same as observer but CAN block/reduce IDCA buys and arm grid for real execution
 *
 * SAFE DEFAULT: mode='off'. In off mode the engine behaves exactly as before.
 */

import { db } from "../../db";
import { sql } from "drizzle-orm";
import { botConfig } from "@shared/schema";
import { getIdcaRegimeSnapshot, type IdcaRegimeSnapshot } from "./IdcaRegimeAdapter";
import { evaluateMeanReversion, type MeanReversionDecision, type MeanReversionConfig } from "./IdcaMeanReversionOverlay";
import { evaluateGridOverlay, type GridDecision, type GridConfig } from "./IdcaGridOverlay";
import { idcaHybridAlertService } from "./IdcaHybridAlertService";

export type IdcaHybridMode = "off" | "observer" | "real";

export type IdcaHybridAction =
  | "legacy"       // mode=off → no change
  | "allow_buy"    // hybrid confirms buy
  | "block_buy"    // hybrid blocks buy (only effective in real mode)
  | "reduce_size"  // hybrid allows but recommends smaller size
  | "hold";        // no strong opinion

/** Type of the active cycle being observed */
export type CycleKind = "normal" | "imported" | "manual";

/**
 * Observation state stored in idca_hybrid_state.grid_state for active cycle evaluations.
 * Distinct from GridDecision gridState so UI can identify the source.
 */
export type CycleObserverState =
  | "OBSERVING_ACTIVE_CYCLE"
  | "OBSERVING_IMPORTED_CYCLE"
  | "OBSERVING_MANUAL_CYCLE"
  | "GRID_PLAN_SIMULATED"
  | "GRID_BLOCKED_BEAR_TREND"
  | "GRID_BLOCKED_DATA_QUALITY"
  | "GRID_BLOCKED_CAPITAL_LIMIT"
  | "GRID_BLOCKED_IMPORTED_CYCLE"
  | "GRID_BLOCKED_MANUAL_CYCLE"
  | "ASSISTED_PROPOSAL_READY";

export interface HybridEvaluationInput {
  pair: string;
  cycleId: number | null;
  currentPrice: number;
  cycleCapitalUsd: number;
  frozenAnchorPrice?: number;
}

/**
 * Input for observer-mode evaluation of an already-open cycle.
 * ALL fields are READ-ONLY from the cycle — Hybrid/Grid NEVER writes back to institutional_dca_cycles.
 */
export interface ActiveCycleHybridInput {
  pair: string;
  cycleId: number;
  cycleKind: CycleKind;
  currentPrice: number;
  avgEntryPrice: number | null;
  basePrice: number | null;
  nextBuyPrice: number | null;
  tpTargetPrice: number | null;
  capitalUsedUsd: number;
  capitalReservedUsd: number;
  buyCount: number;
  sourceType: string | null;
  managedBy: string | null;
  isImported: boolean;
  isManualCycle: boolean;
  frozenAnchorPrice?: number;
}

export interface HybridDecision {
  pair: string;
  mode: IdcaHybridMode;
  regime: IdcaRegimeSnapshot | null;
  meanReversion: MeanReversionDecision | null;
  grid: GridDecision | null;
  idcaAction: IdcaHybridAction;
  confidence: number;
  naturalReason: string;
  metrics: Record<string, unknown>;
  evaluatedAt: Date;
}

// ── Default configs (fallback if DB has no config) ──────────────────────────
const DEFAULT_HYBRID_CONFIG = {
  profile: "conservative" as const,
  meanReversionEnabled: true,
  gridEnabled: false,
  dynamicVolatilityEnabled: true,
  bearTrendBlockEnabled: true,
  dataQualityBlockEnabled: true,
  executionScope: "observer",
  maxGridCapitalPctOfCycle: 10,
  maxGridLevels: 3,
  allowGridWithoutActiveCycle: false,
  doNotRewriteAnchor: true,
  gridCapitalPolicy: "dynamic_low",
  gridLevelPolicy: "dynamic_atr",
  gridProfitPolicy: "fees_aware",
};

const DEFAULT_ALERT_CONFIG = {
  enabled: true,
  regimeChange: true,
  meanReversionAllowed: true,
  meanReversionBlocked: true,
  gridArmed: true,
  gridPaused: true,
  gridExecuted: false,
  dataQuality: true,
  dedupeMinutes: 15,
  verbosity: "normal" as "normal" | "verbose" | "minimal",
};

// In-memory cache of config + regime (30s TTL to avoid hammering DB on every tick)
const configCache = new Map<string, { data: any; expires: number }>();
const regimeCache = new Map<string, { data: IdcaRegimeSnapshot; expires: number }>();
const CACHE_TTL_MS = 30_000;

async function loadHybridConfig(): Promise<{
  mode: IdcaHybridMode;
  hybridConfig: typeof DEFAULT_HYBRID_CONFIG;
  alertConfig: typeof DEFAULT_ALERT_CONFIG;
}> {
  const cacheKey = "global_hybrid_config";
  const cached = configCache.get(cacheKey);
  if (cached && Date.now() < cached.expires) return cached.data;

  try {
    const rows = await db.select({
      idcaHybridMode: botConfig.idcaHybridMode,
      idcaHybridConfig: botConfig.idcaHybridConfig,
      idcaHybridAlertConfig: botConfig.idcaHybridAlertConfig,
    }).from(botConfig).limit(1);

    const row = rows[0];
    const result = {
      mode: ((row?.idcaHybridMode as string) || "off") as IdcaHybridMode,
      hybridConfig: { ...DEFAULT_HYBRID_CONFIG, ...(row?.idcaHybridConfig as object ?? {}) },
      alertConfig: { ...DEFAULT_ALERT_CONFIG, ...(row?.idcaHybridAlertConfig as object ?? {}) },
    };
    configCache.set(cacheKey, { data: result, expires: Date.now() + CACHE_TTL_MS });
    return result;
  } catch {
    return { mode: "off", hybridConfig: DEFAULT_HYBRID_CONFIG, alertConfig: DEFAULT_ALERT_CONFIG };
  }
}

function invalidateConfigCache(): void {
  configCache.clear();
}

async function persistHybridState(
  pair: string,
  cycleId: number | null,
  decision: HybridDecision
): Promise<void> {
  try {
    const regime = decision.regime;
    const modeVal = decision.mode;
    const regimeVal = regime?.regime ?? "unknown";
    const mrState = decision.meanReversion?.state ?? "neutral";
    const gridStateVal = decision.grid?.gridState ?? "inactive";
    const lastPrice = regime?.price ?? null;
    const vwapVal = regime?.vwap ?? null;
    const ema20Val = regime?.ema20 ?? null;
    const ema50Val = regime?.ema50 ?? null;
    const atrPctVal = regime?.atrPct ?? null;
    const zScoreVal = regime?.zScore ?? null;
    const scoreVal = decision.confidence;
    const reasonVal = decision.meanReversion?.reason ?? decision.naturalReason;
    const naturalReasonVal = decision.naturalReason;
    const rawJson = JSON.stringify({ idcaAction: decision.idcaAction, metrics: decision.metrics });
    await db.execute(sql`
      INSERT INTO idca_hybrid_state
        (pair, cycle_id, mode, regime, mean_reversion_state, grid_state,
         last_price, vwap, ema20, ema50, atr_pct, z_score,
         score, reason, natural_reason, raw_json, updated_at)
      VALUES (${pair},${cycleId},${modeVal},${regimeVal},${mrState},${gridStateVal},
              ${lastPrice},${vwapVal},${ema20Val},${ema50Val},${atrPctVal},${zScoreVal},
              ${scoreVal},${reasonVal},${naturalReasonVal},${rawJson}::jsonb,NOW())
      ON CONFLICT (pair, cycle_id) DO UPDATE SET
        mode               = EXCLUDED.mode,
        regime             = EXCLUDED.regime,
        mean_reversion_state = EXCLUDED.mean_reversion_state,
        grid_state         = EXCLUDED.grid_state,
        last_price         = EXCLUDED.last_price,
        vwap               = EXCLUDED.vwap,
        ema20              = EXCLUDED.ema20,
        ema50              = EXCLUDED.ema50,
        atr_pct            = EXCLUDED.atr_pct,
        z_score            = EXCLUDED.z_score,
        score              = EXCLUDED.score,
        reason             = EXCLUDED.reason,
        natural_reason     = EXCLUDED.natural_reason,
        raw_json           = EXCLUDED.raw_json,
        updated_at         = NOW()
    `);
  } catch (e: any) {
    console.warn(`[IDCA_HYBRID] persistHybridState failed (non-fatal): ${e?.message}`);
  }
}

async function persistGridLegs(
  pair: string,
  cycleId: number | null,
  decision: GridDecision
): Promise<void> {
  if (!decision.gridAllowed || decision.levels.length === 0) return;
  try {
    // Clear existing planned legs for this pair+cycle
    await db.execute(sql`DELETE FROM idca_grid_legs WHERE pair = ${pair} AND cycle_id IS NOT DISTINCT FROM ${cycleId} AND status = 'planned'`);
    for (const leg of decision.levels) {
      const { legIndex, side, plannedPrice, reason: legReason, observerOnly } = leg;
      await db.execute(sql`
        INSERT INTO idca_grid_legs
          (pair, cycle_id, leg_index, status, side, planned_price, reason, observer_only)
        VALUES (${pair},${cycleId},${legIndex},'planned',${side},${plannedPrice},${legReason},${observerOnly})
      `);
    }
  } catch (e: any) {
    console.warn(`[IDCA_HYBRID] persistGridLegs failed (non-fatal): ${e?.message}`);
  }
}

// ── Main evaluate function ──────────────────────────────────────────────────
async function evaluate(input: HybridEvaluationInput): Promise<HybridDecision> {
  const { mode, hybridConfig, alertConfig } = await loadHybridConfig();

  // ── mode=off → immediate legacy return ──────────────────────────────────
  if (mode === "off") {
    return {
      pair: input.pair, mode, regime: null, meanReversion: null, grid: null,
      idcaAction: "legacy", confidence: 100,
      naturalReason: "IDCA Híbrido desactivado. Comportamiento estándar IDCA.",
      metrics: {}, evaluatedAt: new Date(),
    };
  }

  // ── Get regime snapshot (cached 30s) ────────────────────────────────────
  let regimeSnapshot: IdcaRegimeSnapshot;
  const regimeCacheKey = input.pair;
  const cachedRegime = regimeCache.get(regimeCacheKey);
  if (cachedRegime && Date.now() < cachedRegime.expires) {
    regimeSnapshot = cachedRegime.data;
  } else {
    try {
      regimeSnapshot = await getIdcaRegimeSnapshot(input.pair, input.frozenAnchorPrice);
      regimeCache.set(regimeCacheKey, { data: regimeSnapshot, expires: Date.now() + CACHE_TTL_MS });
    } catch (e: any) {
      console.warn(`[IDCA_HYBRID] getIdcaRegimeSnapshot failed (non-fatal): ${e?.message}`);
      return {
        pair: input.pair, mode, regime: null, meanReversion: null, grid: null,
        idcaAction: mode === "real" ? "hold" : "legacy",
        confidence: 0,
        naturalReason: "Error obteniendo contexto de mercado. No se bloquea entrada.",
        metrics: { error: e?.message }, evaluatedAt: new Date(),
      };
    }
  }

  // ── Mean Reversion overlay ───────────────────────────────────────────────
  const mrConfig: MeanReversionConfig = {
    meanReversionEnabled: hybridConfig.meanReversionEnabled,
    bearTrendBlockEnabled: hybridConfig.bearTrendBlockEnabled,
    dynamicVolatilityEnabled: hybridConfig.dynamicVolatilityEnabled,
    dataQualityBlockEnabled: hybridConfig.dataQualityBlockEnabled,
    profile: hybridConfig.profile,
  };
  const meanReversionDecision = evaluateMeanReversion(regimeSnapshot, mrConfig);

  // ── Grid overlay ────────────────────────────────────────────────────────
  const gridCfg: GridConfig = {
    gridEnabled: hybridConfig.gridEnabled,
    maxGridCapitalPctOfCycle: hybridConfig.maxGridCapitalPctOfCycle,
    maxGridLevels: hybridConfig.maxGridLevels,
    gridCapitalPolicy: hybridConfig.gridCapitalPolicy,
    gridLevelPolicy: hybridConfig.gridLevelPolicy,
    gridProfitPolicy: hybridConfig.gridProfitPolicy,
    doNotRewriteAnchor: hybridConfig.doNotRewriteAnchor,
    allowGridWithoutActiveCycle: hybridConfig.allowGridWithoutActiveCycle,
    executionScope: hybridConfig.executionScope,
  };
  const gridDecision = evaluateGridOverlay(
    regimeSnapshot,
    meanReversionDecision,
    gridCfg,
    input.cycleCapitalUsd,
    input.cycleId,
    mode
  );

  // ── Resolve IDCA action ─────────────────────────────────────────────────
  let idcaAction: IdcaHybridAction;
  if (mode === "observer") {
    idcaAction = "legacy"; // observer never blocks
  } else if (mode === "real") {
    if (meanReversionDecision.action === "block_buy") idcaAction = "block_buy";
    else if (meanReversionDecision.action === "allow_buy") idcaAction = "allow_buy";
    else if (meanReversionDecision.action === "reduce_size") idcaAction = "reduce_size";
    else idcaAction = "hold"; // hold = let legacy decide
  } else {
    idcaAction = "legacy";
  }

  const confidence = meanReversionDecision.score;
  const naturalReason = meanReversionDecision.naturalReason;

  const decision: HybridDecision = {
    pair: input.pair,
    mode,
    regime: regimeSnapshot,
    meanReversion: meanReversionDecision,
    grid: gridDecision,
    idcaAction,
    confidence,
    naturalReason,
    metrics: {
      regime: regimeSnapshot.regime,
      zScore: regimeSnapshot.zScore,
      atrPct: regimeSnapshot.atrPct,
      gridState: gridDecision.gridState,
    },
    evaluatedAt: new Date(),
  };

  // ── Persist state (non-blocking) ────────────────────────────────────────
  persistHybridState(input.pair, input.cycleId, decision).catch(() => {});
  if (gridDecision.gridAllowed) {
    persistGridLegs(input.pair, input.cycleId, gridDecision).catch(() => {});
  }

  // ── Send alerts (non-blocking) ──────────────────────────────────────────
  idcaHybridAlertService.dispatch(decision, alertConfig).catch(() => {});

  return decision;
}

// ── evaluateActiveCycle — Observer-only evaluation for open cycles ────────────
/**
 * Runs a read-only Hybrid/Grid evaluation for an already-open cycle.
 *
 * SAFETY CONTRACT (enforced here, never delegated):
 *   - NEVER modifies institutional_dca_cycles
 *   - NEVER calls any execution service
 *   - NEVER rewrites avg_entry_price, base_price, next_buy_price, anchor, capital, TP/trailing
 *   - ALL idca_grid_legs rows are saved with observer_only=true
 *   - For imported/manual cycles: grid is always blocked (GRID_BLOCKED_IMPORTED_CYCLE / GRID_BLOCKED_MANUAL_CYCLE)
 *   - Always non-blocking: caller must `.catch(() => {})` this
 */
async function evaluateActiveCycle(input: ActiveCycleHybridInput): Promise<void> {
  const { mode, hybridConfig, alertConfig } = await loadHybridConfig();
  if (mode === "off") return;

  const TAG_OBS = "[IDCA][HYBRID_OBSERVER";

  // ── Regime snapshot (cached 30s) ─────────────────────────────────────────
  let regimeSnapshot: IdcaRegimeSnapshot;
  const regimeCacheKey = input.pair;
  const cachedRegime = regimeCache.get(regimeCacheKey);
  if (cachedRegime && Date.now() < cachedRegime.expires) {
    regimeSnapshot = cachedRegime.data;
  } else {
    try {
      regimeSnapshot = await getIdcaRegimeSnapshot(input.pair, input.frozenAnchorPrice);
      regimeCache.set(regimeCacheKey, { data: regimeSnapshot, expires: Date.now() + CACHE_TTL_MS });
    } catch (e: any) {
      console.warn(`${TAG_OBS}] regime snapshot failed for ${input.pair} cycleId=${input.cycleId}: ${e?.message}`);
      return;
    }
  }

  // ── Mean Reversion overlay (observation only) ─────────────────────────────
  const mrConfig: MeanReversionConfig = {
    meanReversionEnabled: hybridConfig.meanReversionEnabled,
    bearTrendBlockEnabled: hybridConfig.bearTrendBlockEnabled,
    dynamicVolatilityEnabled: hybridConfig.dynamicVolatilityEnabled,
    dataQualityBlockEnabled: hybridConfig.dataQualityBlockEnabled,
    profile: hybridConfig.profile,
  };
  const meanReversionDecision = evaluateMeanReversion(regimeSnapshot, mrConfig);

  // ── Grid simulation ───────────────────────────────────────────────────────
  // Imported/manual cycles: grid always blocked — never touch their refs
  // Normal cycles: simulate with observer executionScope + forceObserverOnly
  let observerState: CycleObserverState;
  let gridDecision: GridDecision | null = null;
  let gridSimulated = false;
  const cycleKind = input.cycleKind;

  if (cycleKind === "imported") {
    observerState = "GRID_BLOCKED_IMPORTED_CYCLE";
  } else if (cycleKind === "manual") {
    observerState = "GRID_BLOCKED_MANUAL_CYCLE";
  } else {
    // Normal cycle — simulate with observer_only=true
    const gridCfg: GridConfig = {
      gridEnabled: hybridConfig.gridEnabled,
      maxGridCapitalPctOfCycle: hybridConfig.maxGridCapitalPctOfCycle,
      maxGridLevels: hybridConfig.maxGridLevels,
      gridCapitalPolicy: hybridConfig.gridCapitalPolicy,
      gridLevelPolicy: hybridConfig.gridLevelPolicy,
      gridProfitPolicy: hybridConfig.gridProfitPolicy,
      doNotRewriteAnchor: true, // always true for existing cycles
      allowGridWithoutActiveCycle: false,
      executionScope: "observer", // always observer for existing cycles
    };
    gridDecision = evaluateGridOverlay(
      regimeSnapshot,
      meanReversionDecision,
      gridCfg,
      input.capitalUsedUsd,
      input.cycleId,
      mode
    );
    if (gridDecision.gridAllowed && gridDecision.levels.length > 0) {
      // Force observer_only on every leg
      gridDecision = {
        ...gridDecision,
        levels: gridDecision.levels.map(l => ({ ...l, observerOnly: true })),
      };
      gridSimulated = true;
      observerState = meanReversionDecision.action === "allow_buy"
        ? "ASSISTED_PROPOSAL_READY"
        : "GRID_PLAN_SIMULATED";
    } else {
      // Map grid blocked reason to observer state
      const gs = gridDecision.gridState;
      if (gs === "paused_bear_trend") observerState = "GRID_BLOCKED_BEAR_TREND";
      else if (gs === "paused_spread_high") observerState = "GRID_BLOCKED_DATA_QUALITY";
      else if (gs === "paused_cycle_overloaded") observerState = "GRID_BLOCKED_CAPITAL_LIMIT";
      else if (gs === "inactive" && !hybridConfig.gridEnabled) observerState = "OBSERVING_ACTIVE_CYCLE";
      else observerState = "OBSERVING_ACTIVE_CYCLE";
    }
  }

  // Resolve display observerState when grid is not the focus
  if (cycleKind === "imported" && observerState === "GRID_BLOCKED_IMPORTED_CYCLE") {
    // keep as-is
  } else if (cycleKind === "manual" && observerState === "GRID_BLOCKED_MANUAL_CYCLE") {
    // keep as-is
  } else if (observerState === "OBSERVING_ACTIVE_CYCLE") {
    // keep as-is
  }

  // ── Build natural_reason ─────────────────────────────────────────────────
  let naturalReason: string;
  if (cycleKind === "imported") {
    naturalReason = `Ciclo importado: no se modifica precio medio, ancla ni capital. Solo se genera diagnóstico. Régimen: ${regimeSnapshot.regime}. Reversión a la media: ${meanReversionDecision.action}.`;
  } else if (cycleKind === "manual") {
    naturalReason = `Ciclo manual: se respetan decisiones del usuario. No se sobrescriben parámetros. Grid bloqueado hasta confirmación. Régimen: ${regimeSnapshot.regime}.`;
  } else if (gridSimulated) {
    naturalReason = `Modo observador: ciclo activo detectado; grid simulado (observer_only=true). ${gridDecision?.levels.length ?? 0} niveles calculados. ${meanReversionDecision.naturalReason}`;
  } else if (observerState === "GRID_BLOCKED_BEAR_TREND") {
    naturalReason = `Grid bloqueado por tendencia bajista. Régimen: ${regimeSnapshot.regime}. Solo diagnóstico. ${meanReversionDecision.naturalReason}`;
  } else if (observerState === "GRID_BLOCKED_DATA_QUALITY") {
    naturalReason = `Grid bloqueado por mala calidad de datos o spread alto. Régimen: ${regimeSnapshot.regime}.`;
  } else if (observerState === "GRID_BLOCKED_CAPITAL_LIMIT") {
    naturalReason = `Grid bloqueado por límite de capital configurado. Capital en uso: $${input.capitalUsedUsd.toFixed(0)}.`;
  } else {
    naturalReason = `Modo observador: ciclo activo detectado; se simula gestión Hybrid/Grid sin ejecutar órdenes. Régimen: ${regimeSnapshot.regime}.`;
  }

  // ── Log ─────────────────────────────────────────────────────────────────
  const logBase = `pair=${input.pair} cycle_id=${input.cycleId} is_imported=${input.isImported} is_manual_cycle=${input.isManualCycle} source_type=${input.sourceType ?? "null"} managed_by=${input.managedBy ?? "null"} observer_only=true executionScope=observer doNotRewriteAnchor=true`;
  if (cycleKind === "imported") {
    console.log(`[IDCA][HYBRID_OBSERVER_IMPORTED_CYCLE] ${logBase} reason=${observerState} natural_reason="${naturalReason}"`);
  } else if (cycleKind === "manual") {
    console.log(`[IDCA][HYBRID_OBSERVER_MANUAL_CYCLE] ${logBase} reason=${observerState} natural_reason="${naturalReason}"`);
  } else {
    console.log(`[IDCA][HYBRID_OBSERVER_ACTIVE_CYCLE] ${logBase} reason=${observerState} natural_reason="${naturalReason}"`);
  }
  if (gridSimulated) {
    console.log(`[IDCA][GRID_OBSERVER_PLAN] pair=${input.pair} cycle_id=${input.cycleId} legs=${gridDecision?.levels.length ?? 0} observer_only=true regime=${regimeSnapshot.regime}`);
  } else if (cycleKind === "normal" && gridDecision && !gridDecision.gridAllowed) {
    console.log(`[IDCA][GRID_OBSERVER_BLOCKED] pair=${input.pair} cycle_id=${input.cycleId} state=${observerState} regime=${regimeSnapshot.regime}`);
  }
  if (observerState === "ASSISTED_PROPOSAL_READY") {
    console.log(`[IDCA][HYBRID_ASSISTED_PROPOSAL] pair=${input.pair} cycle_id=${input.cycleId} mr_action=${meanReversionDecision.action} score=${meanReversionDecision.score}`);
  }

  // ── Persist hybrid state ──────────────────────────────────────────────────
  const rawJson = JSON.stringify({
    cycleKind,
    observerState,
    isImported: input.isImported,
    isManualCycle: input.isManualCycle,
    sourceType: input.sourceType,
    managedBy: input.managedBy,
    avgEntryPrice: input.avgEntryPrice,
    basePrice: input.basePrice,
    nextBuyPrice: input.nextBuyPrice,
    tpTargetPrice: input.tpTargetPrice,
    capitalUsedUsd: input.capitalUsedUsd,
    capitalReservedUsd: input.capitalReservedUsd,
    buyCount: input.buyCount,
    mrAction: meanReversionDecision.action,
    gridLevels: gridDecision?.levels.length ?? 0,
    assistedProposalReady: observerState === "ASSISTED_PROPOSAL_READY",
    doNotRewriteAnchor: true,
    observer_only: true,
  });

  try {
    const modeVal = mode;
    const regimeVal = regimeSnapshot.regime;
    const mrState = meanReversionDecision.state;
    const gridStateVal = observerState;
    const lastPrice = regimeSnapshot.price;
    const vwapVal = regimeSnapshot.vwap ?? null;
    const ema20Val = regimeSnapshot.ema20 ?? null;
    const ema50Val = regimeSnapshot.ema50 ?? null;
    const atrPctVal = regimeSnapshot.atrPct ?? null;
    const zScoreVal = regimeSnapshot.zScore ?? null;
    const scoreVal = meanReversionDecision.score;

    await db.execute(sql`
      INSERT INTO idca_hybrid_state
        (pair, cycle_id, mode, regime, mean_reversion_state, grid_state,
         last_price, vwap, ema20, ema50, atr_pct, z_score,
         score, reason, natural_reason, raw_json, updated_at)
      VALUES (${input.pair},${input.cycleId},${modeVal},${regimeVal},${mrState},${gridStateVal},
              ${lastPrice},${vwapVal},${ema20Val},${ema50Val},${atrPctVal},${zScoreVal},
              ${scoreVal},${observerState},${naturalReason},${rawJson}::jsonb,NOW())
      ON CONFLICT (pair, cycle_id) DO UPDATE SET
        mode                 = EXCLUDED.mode,
        regime               = EXCLUDED.regime,
        mean_reversion_state = EXCLUDED.mean_reversion_state,
        grid_state           = EXCLUDED.grid_state,
        last_price           = EXCLUDED.last_price,
        vwap                 = EXCLUDED.vwap,
        ema20                = EXCLUDED.ema20,
        ema50                = EXCLUDED.ema50,
        atr_pct              = EXCLUDED.atr_pct,
        z_score              = EXCLUDED.z_score,
        score                = EXCLUDED.score,
        reason               = EXCLUDED.reason,
        natural_reason       = EXCLUDED.natural_reason,
        raw_json             = EXCLUDED.raw_json,
        updated_at           = NOW()
    `);
  } catch (e: any) {
    console.warn(`[IDCA][HYBRID_OBSERVER] persistHybridState failed (non-fatal): ${e?.message}`);
  }

  // ── Persist simulated grid legs (normal cycles only, always observer_only) ──
  if (gridSimulated && gridDecision && gridDecision.levels.length > 0) {
    try {
      await db.execute(sql`DELETE FROM idca_grid_legs WHERE pair = ${input.pair} AND cycle_id = ${input.cycleId} AND status = 'planned'`);
      for (const leg of gridDecision.levels) {
        await db.execute(sql`
          INSERT INTO idca_grid_legs
            (pair, cycle_id, leg_index, status, side, planned_price, reason, observer_only)
          VALUES (${input.pair},${input.cycleId},${leg.legIndex},'planned',${leg.side},${leg.plannedPrice},${leg.reason},true)
        `);
      }
    } catch (e: any) {
      console.warn(`[IDCA][HYBRID_OBSERVER] persistGridLegs failed (non-fatal): ${e?.message}`);
    }
  }

  // ── Telegram alert (informative, deduped) ─────────────────────────────────
  try {
    const alertDecision: HybridDecision = {
      pair: input.pair,
      mode,
      regime: regimeSnapshot,
      meanReversion: meanReversionDecision,
      grid: gridDecision,
      idcaAction: "legacy",
      confidence: meanReversionDecision.score,
      naturalReason,
      metrics: { observerState, cycleKind, cycleId: input.cycleId },
      evaluatedAt: new Date(),
    };
    await idcaHybridAlertService.dispatch(alertDecision, alertConfig);
  } catch {
    // non-fatal
  }
}

// ── Config management ────────────────────────────────────────────────────────
async function getConfig(): Promise<{ mode: IdcaHybridMode; hybridConfig: object; alertConfig: object }> {
  const { mode, hybridConfig, alertConfig } = await loadHybridConfig();
  return { mode, hybridConfig, alertConfig };
}

async function setMode(mode: IdcaHybridMode): Promise<void> {
  await db.execute(sql`UPDATE bot_config SET idca_hybrid_mode = ${mode}, updated_at = NOW() WHERE id = (SELECT id FROM bot_config LIMIT 1)`);
  invalidateConfigCache();
}

async function setHybridConfig(patch: Partial<typeof DEFAULT_HYBRID_CONFIG>): Promise<void> {
  const { hybridConfig } = await loadHybridConfig();
  const merged = JSON.stringify({ ...hybridConfig, ...patch });
  await db.execute(sql`UPDATE bot_config SET idca_hybrid_config = ${merged}::jsonb, updated_at = NOW() WHERE id = (SELECT id FROM bot_config LIMIT 1)`);
  invalidateConfigCache();
}

async function setAlertConfig(patch: Partial<typeof DEFAULT_ALERT_CONFIG>): Promise<void> {
  const { alertConfig } = await loadHybridConfig();
  const merged = JSON.stringify({ ...alertConfig, ...patch });
  await db.execute(sql`UPDATE bot_config SET idca_hybrid_alert_config = ${merged}::jsonb, updated_at = NOW() WHERE id = (SELECT id FROM bot_config LIMIT 1)`);
  invalidateConfigCache();
}

async function applyRecommended(): Promise<void> {
  const hCfg = JSON.stringify({ ...DEFAULT_HYBRID_CONFIG, profile: "conservative", meanReversionEnabled: true, gridEnabled: false, executionScope: "observer", maxGridCapitalPctOfCycle: 10, maxGridLevels: 3 });
  const aCfg = JSON.stringify({ ...DEFAULT_ALERT_CONFIG, enabled: true, dedupeMinutes: 15, verbosity: "normal" });
  await db.execute(sql`UPDATE bot_config SET idca_hybrid_mode = 'observer', idca_hybrid_config = ${hCfg}::jsonb, idca_hybrid_alert_config = ${aCfg}::jsonb, updated_at = NOW() WHERE id = (SELECT id FROM bot_config LIMIT 1)`);
  invalidateConfigCache();
}

async function getStatus(pair?: string): Promise<object> {
  const rows = pair
    ? await db.execute(sql`SELECT * FROM idca_hybrid_state WHERE pair = ${pair} ORDER BY updated_at DESC LIMIT 1`)
    : await db.execute(sql`SELECT * FROM idca_hybrid_state ORDER BY updated_at DESC LIMIT 20`);
  return rows.rows ?? [];
}

export const idcaHybridDecisionService = {
  evaluate,
  evaluateActiveCycle,
  getConfig,
  setMode,
  setHybridConfig,
  setAlertConfig,
  applyRecommended,
  getStatus,
  invalidateConfigCache,
  DEFAULT_HYBRID_CONFIG,
  DEFAULT_ALERT_CONFIG,
};
