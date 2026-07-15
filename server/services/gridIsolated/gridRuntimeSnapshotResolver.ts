/**
 * gridRuntimeSnapshotResolver.ts
 *
 * Read-only resolver that returns a unified snapshot of the Grid runtime state.
 * If the engine runtime is loaded, it returns in-memory data.
 * Otherwise, it falls back to a safe DB read without mutating the engine.
 *
 * This is the single source of truth for /status, /monitor/audit,
 * /export/json and /shadow-orphan-cycles/diagnose.
 */

import { db } from "../../db";
import {
  gridIsolatedConfigs,
  gridRangeVersions,
  gridIsolatedLevels,
  gridIsolatedCycles,
} from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { MarketDataService } from "../MarketDataService";
import type {
  GridIsolatedConfig,
  GridCycle,
  GridLevel,
  GridExecutionStatus,
  GridRangeVersion,
  GridMode,
  PumpDumpState,
} from "./gridIsolatedTypes";

export type GridRuntimeSnapshotSource =
  | "runtime"
  | "db_fallback"
  | "mixed_runtime_db"
  | "empty";

export interface GridRuntimeSnapshot {
  source: GridRuntimeSnapshotSource;
  mode: GridMode;
  isActive: boolean;
  isRunning: boolean;
  activeRangeVersionId: string | null;
  activeRangeVersionNumber: number | null;
  realOpenOrdersCount: number;
  openCycles: number;
  activeOpenCyclesCount: number;
  orphanOpenCyclesCount: number;
  historicalOpenCyclesCount: number;
  globalOpenCyclesCount: number;
  openLevels: number;
  plannedLevelsCount: number;
  historicalLevelsCount: number;
  globalLevelsCount: number;
  orphanPlannedLevelsCount: number;
  currentPrice: number | null;
  currentPriceSource: string | null;
  lastTickAt: Date | null;
  lastTickReason: string | null;
  config: GridIsolatedConfig | null;
  activeRangeVersion: GridRangeVersion | null;
  levels: GridLevel[];
  cycles: GridCycle[];
}

const OPEN_CYCLE_STATUSES = new Set([
  "open",
  "active",
  "buy_filled",
  "buy_placed",
  "sell_placed",
  "cycle_open",
]);

function isCycleOpen(c: GridCycle): boolean {
  return OPEN_CYCLE_STATUSES.has(c.status);
}

function calculateCounts(
  levels: GridLevel[],
  cycles: GridCycle[],
  activeRangeId: string | null
): Pick<
  GridRuntimeSnapshot,
  | "openLevels"
  | "plannedLevelsCount"
  | "historicalLevelsCount"
  | "globalLevelsCount"
  | "orphanPlannedLevelsCount"
  | "openCycles"
  | "activeOpenCyclesCount"
  | "orphanOpenCyclesCount"
  | "historicalOpenCyclesCount"
  | "globalOpenCyclesCount"
  | "realOpenOrdersCount"
> {
  const activeLevels = activeRangeId
    ? levels.filter(l => l.rangeVersionId === activeRangeId)
    : [];

  const openLevels = activeRangeId
    ? activeLevels.filter(l => l.status === "open" || l.status === "planned").length
    : 0;
  const plannedLevelsCount = activeRangeId
    ? activeLevels.filter(l => l.status === "planned").length
    : 0;

  const historicalLevelsCount = activeRangeId
    ? levels.filter(
        l =>
          l.rangeVersionId !== activeRangeId &&
          ["replaced", "cancelled", "filled"].includes(l.status)
      ).length
    : levels.filter(l => ["replaced", "cancelled", "filled"].includes(l.status)).length;

  const realOpenOrdersCount = levels.filter(
    l => l.exchangeOrderId != null && !["filled", "cancelled"].includes(l.status)
  ).length;

  const orphanPlannedLevelsCount = activeRangeId
    ? levels.filter(l => l.rangeVersionId !== activeRangeId && l.status === "planned").length
    : levels.filter(l => l.status === "planned").length;

  const openCyclesList = cycles.filter(isCycleOpen);
  const openCycles = openCyclesList.length;
  const activeOpenCyclesCount = activeRangeId
    ? openCyclesList.filter(c => c.rangeVersionId === activeRangeId).length
    : 0;
  const orphanOpenCyclesCount = activeRangeId
    ? openCyclesList.filter(c => c.rangeVersionId !== activeRangeId).length
    : openCycles;

  return {
    openLevels,
    plannedLevelsCount,
    historicalLevelsCount,
    globalLevelsCount: levels.length,
    orphanPlannedLevelsCount,
    openCycles,
    activeOpenCyclesCount,
    orphanOpenCyclesCount,
    historicalOpenCyclesCount: orphanOpenCyclesCount,
    globalOpenCyclesCount: openCycles,
    realOpenOrdersCount,
  };
}

async function readDbFallback(): Promise<{
  config: GridIsolatedConfig | null;
  activeRangeVersion: GridRangeVersion | null;
  levels: GridLevel[];
  cycles: GridCycle[];
}> {
  const [configRows, rangeRows, allLevels, allCycles] = await Promise.all([
    db.select().from(gridIsolatedConfigs).limit(1),
    db
      .select()
      .from(gridRangeVersions)
      .where(eq(gridRangeVersions.status, "active"))
      .orderBy(desc(gridRangeVersions.createdAt))
      .limit(1),
    db.select().from(gridIsolatedLevels).limit(10000),
    db.select().from(gridIsolatedCycles).limit(10000),
  ]);

  const config = configRows.length > 0 ? (configRows[0] as unknown as GridIsolatedConfig) : null;
  const activeRangeVersion =
    rangeRows.length > 0 ? (rangeRows[0] as unknown as GridRangeVersion) : null;

  return {
    config,
    activeRangeVersion,
    levels: allLevels as unknown as GridLevel[],
    cycles: allCycles as unknown as GridCycle[],
  };
}

async function resolveCurrentPrice(
  pair: string | null | undefined,
  runtimePrice: number | null
): Promise<{ currentPrice: number | null; currentPriceSource: string | null }> {
  if (runtimePrice != null) {
    return { currentPrice: runtimePrice, currentPriceSource: "runtime" };
  }
  if (!pair) {
    return { currentPrice: null, currentPriceSource: null };
  }
  try {
    const ticker = await MarketDataService.getTicker(pair);
    if (ticker?.last != null) {
      return { currentPrice: Number(ticker.last), currentPriceSource: "ticker" };
    }
  } catch {
    // read-only fallback, ignore
  }
  return { currentPrice: null, currentPriceSource: null };
}

export interface GridRuntimeSnapshotEngineLike {
  getConfig: () => GridIsolatedConfig | null;
  getCycles: () => GridCycle[];
  getLevels: () => GridLevel[];
  getActiveRangeVersion: () => GridRangeVersion | null;
  getRunning: () => boolean;
  getLastTickAt: () => Date | null;
  getLastTickReason: () => string | null;
  getLastShadowExecutionPrice: () => { price: number | null } | null;
}

export async function resolveRuntimeSnapshot(
  engine: GridRuntimeSnapshotEngineLike
): Promise<GridRuntimeSnapshot> {
  const configFromRuntime = engine.getConfig();
  const levelsFromRuntime = engine.getLevels();
  const cyclesFromRuntime = engine.getCycles();
  const activeRangeFromRuntime = engine.getActiveRangeVersion();

  const runtimeLoaded = !!configFromRuntime;

  let source: GridRuntimeSnapshotSource = runtimeLoaded ? "runtime" : "db_fallback";
  let config = configFromRuntime ?? null;
  let activeRangeVersion = activeRangeFromRuntime;
  let levels = levelsFromRuntime;
  let cycles = cyclesFromRuntime;

  if (!runtimeLoaded) {
    const dbData = await readDbFallback();
    config = dbData.config;
    activeRangeVersion = dbData.activeRangeVersion;
    levels = dbData.levels;
    cycles = dbData.cycles;
  } else if (levelsFromRuntime.length === 0 && cyclesFromRuntime.length === 0) {
    // Runtime is loaded but has no levels/cycles; merge with DB for a complete read-only view.
    const dbData = await readDbFallback();
    if (dbData.levels.length > levels.length) {
      levels = dbData.levels;
    }
    if (dbData.cycles.length > cycles.length) {
      cycles = dbData.cycles;
    }
    if (!activeRangeVersion && dbData.activeRangeVersion) {
      activeRangeVersion = dbData.activeRangeVersion;
    }
    source = "mixed_runtime_db";
  }

  const mode = config?.mode ?? "OFF";
  const isActive = config?.isActive ?? false;
  const isRunning = engine.getRunning();
  const activeRangeId = activeRangeVersion?.id ?? null;

  const counts = calculateCounts(levels, cycles, activeRangeId);

  const pair = config?.pair;
  const runtimePrice = engine.getLastShadowExecutionPrice()?.price ?? null;
  const { currentPrice, currentPriceSource } = await resolveCurrentPrice(pair, runtimePrice);

  return {
    source,
    mode,
    isActive,
    isRunning,
    activeRangeVersionId: activeRangeVersion?.id ?? null,
    activeRangeVersionNumber: activeRangeVersion?.versionNumber ?? null,
    realOpenOrdersCount: counts.realOpenOrdersCount,
    openCycles: counts.openCycles,
    activeOpenCyclesCount: counts.activeOpenCyclesCount,
    orphanOpenCyclesCount: counts.orphanOpenCyclesCount,
    historicalOpenCyclesCount: counts.historicalOpenCyclesCount,
    globalOpenCyclesCount: counts.globalOpenCyclesCount,
    openLevels: counts.openLevels,
    plannedLevelsCount: counts.plannedLevelsCount,
    historicalLevelsCount: counts.historicalLevelsCount,
    globalLevelsCount: counts.globalLevelsCount,
    orphanPlannedLevelsCount: counts.orphanPlannedLevelsCount,
    currentPrice,
    currentPriceSource,
    lastTickAt: engine.getLastTickAt() ?? null,
    lastTickReason: engine.getLastTickReason() ?? null,
    config,
    activeRangeVersion,
    levels,
    cycles,
  };
}
