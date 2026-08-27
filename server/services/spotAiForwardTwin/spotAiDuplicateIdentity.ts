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
