/**
 * spotAiDuplicateIdentity — Shared duplicate fill detection logic.
 *
 * R7: Duplicate identity = strict tuple:
 *   (lotId, pair, side, orderId, executedAt, fillPrice, fillVolume, feeUsd)
 *
 * Same orderId + different executedAt/volume/price/fee = legitimate multi-fill, NOT duplicate.
 * Exact copy of same snapshot = duplicate.
 *
 * This function is the SINGLE canonical implementation used by quality checks.
 */

import { sql } from "drizzle-orm";

export interface FillIdentityInput {
  lotId: string;
  pair: string;
  side: "BUY" | "SELL";
  orderId: string;
  executedAt: number;
  fillPrice: number;
  fillVolume: number;
  feeUsd: number;
}

/**
 * Build the identity key for a fill. Two fills with the same key are duplicates.
 */
export function fillIdentityKey(f: FillIdentityInput): string {
  return [
    f.lotId,
    f.pair,
    f.side,
    f.orderId ?? "",
    f.executedAt ?? 0,
    f.fillPrice ?? 0,
    f.fillVolume ?? 0,
    f.feeUsd ?? 0,
  ].join("|");
}

/**
 * Check if two fills are exact duplicates (same identity tuple).
 */
export function isDuplicateFill(a: FillIdentityInput, b: FillIdentityInput): boolean {
  return fillIdentityKey(a) === fillIdentityKey(b);
}

/**
 * Count duplicate fills from a list, separated by BUY/SELL.
 * Returns { duplicateEntry, duplicateExit }.
 * A duplicate is a fill that shares the same identity key with another fill.
 */
export function countDuplicateFills(
  fills: FillIdentityInput[],
): { duplicateEntry: number; duplicateExit: number } {
  const keyCount = new Map<string, number>();
  for (const f of fills) {
    const key = fillIdentityKey(f);
    keyCount.set(key, (keyCount.get(key) ?? 0) + 1);
  }
  let duplicateEntry = 0;
  let duplicateExit = 0;
  for (const [key, count] of keyCount) {
    if (count > 1) {
      // The key contains the side as the 3rd field
      const parts = key.split("|");
      const side = parts[2];
      if (side === "BUY") duplicateEntry++;
      if (side === "SELL") duplicateExit++;
    }
  }
  return { duplicateEntry, duplicateExit };
}

// ─── R9-01: Fail-closed duplicate quality loader ─────────────────────────────

/**
 * R9-01: Result of loading duplicate fill quality.
 * - available=false → DB query failed, values are null.
 * - available=true → values are real numbers (including 0).
 */
export interface DuplicateFillQualityResult {
  available: boolean;
  duplicateEntryFills: number | null;
  duplicateExitFills: number | null;
  error: string | null;
}

/**
 * R9-01: Fail-closed duplicate fill quality loader.
 *
 * Loads FILL snapshots from the DB via an executor, maps them to FillIdentityInput,
 * and counts duplicates via the SINGLE canonical countDuplicateFills().
 *
 * On SUCCESS: returns real numbers (including 0) with available=true.
 * On FAILURE: returns null values with available=false and error message.
 *
 * NO DEFAULT 0 after exception.
 */
export async function loadDuplicateFillQuality(
  executor: { execute: (query: any) => Promise<{ rows: any[] }> },
): Promise<DuplicateFillQualityResult> {
  try {
    const fillRows = await executor.execute(sql`
      SELECT data FROM spot_forward_twin_snapshots
      WHERE data->>'snapshotType' = 'FILL'
        AND data->'fill'->>'lotId' IS NOT NULL
    `);
    const fillIdentities: FillIdentityInput[] = ((fillRows.rows ?? []) as any[]).map((r) => {
      const f = (r.data ?? {}).fill ?? {};
      return {
        lotId: String(f.lotId ?? ""),
        pair: String((r.data ?? {}).pair ?? ""),
        side: (f.side === "SELL" ? "SELL" : "BUY") as "BUY" | "SELL",
        orderId: String(f.orderId ?? ""),
        executedAt: Number(f.executedAt ?? 0),
        fillPrice: Number(f.fillPrice ?? 0),
        fillVolume: Number(f.fillVolume ?? 0),
        feeUsd: Number(f.feeUsd ?? 0),
      };
    });
    const dupCounts = countDuplicateFills(fillIdentities);
    return {
      available: true,
      duplicateEntryFills: dupCounts.duplicateEntry,
      duplicateExitFills: dupCounts.duplicateExit,
      error: null,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("[SpotAi] loadDuplicateFillQuality failed:", error);
    return {
      available: false,
      duplicateEntryFills: null,
      duplicateExitFills: null,
      error: errMsg,
    };
  }
}
