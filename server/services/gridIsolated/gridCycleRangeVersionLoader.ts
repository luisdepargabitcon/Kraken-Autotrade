/**
 * GridCycleRangeVersionLoader — Deterministic loader for range versions
 * referenced by open Grid cycles.
 *
 * Goal:
 *   - Only load the exact range versions that open cycles point to.
 *   - Avoid depending solely on the active range version.
 *   - Avoid loading all historical ranges indiscriminately.
 *   - Do NOT pick ranges by proximity or price similarity.
 *
 * Used by:
 *   - resolveAndPersistOpenCycleTargets (startup recovery)
 *   - processOpenCyclesShadow (tick closure)
 *   - diagnoseShadowOpenCycles (read-only diagnosis)
 */

import { db } from "../../db";
import { gridRangeVersions } from "@shared/schema";
import { inArray } from "drizzle-orm";
import type { GridCycle, GridRangeVersion } from "./gridIsolatedTypes";

export function mapGridRangeVersionRow(row: any): GridRangeVersion {
  return {
    id: row.id,
    versionNumber: row.versionNumber,
    pair: row.pair,
    status: row.status as GridRangeVersion["status"],
    midPrice: parseFloat(row.midPrice),
    upperPrice: parseFloat(row.upperPrice),
    lowerPrice: parseFloat(row.lowerPrice),
    bandUpper: parseFloat(row.bandUpper),
    bandMiddle: parseFloat(row.bandMiddle),
    bandLower: parseFloat(row.bandLower),
    bandWidthPct: parseFloat(row.bandWidthPct),
    atrPct: parseFloat(row.atrPct),
    regime: row.regime,
    levelsCount: row.levelsCount,
    geometricRatio: parseFloat(row.geometricRatio),
    capitalBudgetUsd: parseFloat(row.capitalBudgetUsd),
    capitalPerLevelUsd: parseFloat(row.capitalPerLevelUsd),
    netProfitTargetPct: parseFloat(row.netProfitTargetPct),
    createdAt: row.createdAt,
    activatedAt: row.activatedAt ?? null,
    closedAt: row.closedAt ?? null,
  };
}

export function getRangeVersionIdsFromCycles(
  cycles: readonly { rangeVersionId?: string | null }[]
): string[] {
  const ids = new Set<string>();
  for (const c of cycles) {
    if (c && c.rangeVersionId) {
      ids.add(c.rangeVersionId);
    }
  }
  return Array.from(ids);
}

export async function loadRangeVersionsForCycles(
  cycles: readonly { rangeVersionId?: string | null }[]
): Promise<GridRangeVersion[]> {
  const ids = getRangeVersionIdsFromCycles(cycles);
  if (ids.length === 0) return [];

  const rows = await db
    .select()
    .from(gridRangeVersions)
    .where(inArray(gridRangeVersions.id, ids));

  return rows.map(mapGridRangeVersionRow);
}
