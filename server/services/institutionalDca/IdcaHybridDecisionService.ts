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

export interface HybridEvaluationInput {
  pair: string;
  cycleId: number | null;
  currentPrice: number;
  cycleCapitalUsd: number;
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
