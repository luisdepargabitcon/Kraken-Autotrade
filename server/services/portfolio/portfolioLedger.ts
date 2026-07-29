/**
 * Portfolio Ledger & Attribution — Fase 4
 *
 * Movements, inventory attribution, reconciliation.
 * Idempotency by idempotencyKey. No double-entry.
 */

import type { LedgerEntry, LedgerEntryType, StrategyMode } from "./portfolioTypes";

export interface AttributionRecord {
  asset: string;
  exchange: string;
  mode: StrategyMode;
  quantity: number;
  costBasisUsd: number;
  attributedAt: string;
}

export interface ReconciliationResult {
  reconciled: boolean;
  discrepancies: Discrepancy[];
  totalChecked: number;
  totalMatched: number;
}

export interface Discrepancy {
  type: "QUANTITY_MISMATCH" | "MISSING_ENTRY" | "DUPLICATE_ENTRY" | "ORPHAN_ENTRY";
  asset: string;
  exchange: string;
  expected: number | null;
  actual: number | null;
  details: string;
}

export function attributeEntry(
  entry: LedgerEntry,
  mode: StrategyMode,
): AttributionRecord | null {
  if (entry.entryType !== "PURCHASE" && entry.entryType !== "TRANSFER") {
    return null;
  }

  if (entry.quantity <= 0) return null;

  return {
    asset: entry.asset,
    exchange: entry.exchange,
    mode,
    quantity: entry.quantity,
    costBasisUsd: 0, // To be filled from fill data
    attributedAt: new Date().toISOString(),
  };
}

export function reconcileHoldings(
  expected: { asset: string; exchange: string; quantity: number }[],
  actual: { asset: string; exchange: string; quantity: number }[],
): ReconciliationResult {
  const discrepancies: Discrepancy[] = [];
  let matched = 0;

  const actualMap = new Map<string, number>();
  for (const a of actual) {
    const key = `${a.asset}:${a.exchange}`;
    actualMap.set(key, (actualMap.get(key) || 0) + a.quantity);
  }

  for (const exp of expected) {
    const key = `${exp.asset}:${exp.exchange}`;
    const actualQty = actualMap.get(key) || 0;

    if (Math.abs(actualQty - exp.quantity) < 0.00000001) {
      matched++;
    } else {
      discrepancies.push({
        type: "QUANTITY_MISMATCH",
        asset: exp.asset,
        exchange: exp.exchange,
        expected: exp.quantity,
        actual: actualQty,
        details: `Expected ${exp.quantity} but got ${actualQty}`,
      });
    }
    actualMap.delete(key);
  }

  // Remaining actual entries are orphans
  for (const [key, qty] of actualMap) {
    const [asset, exchange] = key.split(":");
    discrepancies.push({
      type: "ORPHAN_ENTRY",
      asset,
      exchange,
      expected: 0,
      actual: qty,
      details: `No expected entry for ${asset} on ${exchange}`,
    });
  }

  return {
    reconciled: discrepancies.length === 0,
    discrepancies,
    totalChecked: expected.length,
    totalMatched: matched,
  };
}

export function detectDuplicateEntries(entries: LedgerEntry[]): LedgerEntry[] {
  const seen = new Set<string>();
  const duplicates: LedgerEntry[] = [];

  for (const entry of entries) {
    if (seen.has(entry.idempotencyKey)) {
      duplicates.push(entry);
    }
    seen.add(entry.idempotencyKey);
  }

  return duplicates;
}

export function computeNetQuantity(
  entries: LedgerEntry[],
  asset: string,
  exchange: string,
): number {
  let net = 0;
  for (const entry of entries) {
    if (entry.asset !== asset || entry.exchange !== exchange) continue;

    switch (entry.entryType) {
      case "DEPOSIT":
      case "PURCHASE":
      case "TRANSFER":
        net += entry.quantity;
        break;
      case "WITHDRAWAL":
      case "SALE":
        net -= entry.quantity;
        break;
      case "FEE":
        net -= entry.quantity;
        break;
      case "ADJUSTMENT":
        net += entry.quantity; // Can be positive or negative
        break;
      case "RESERVATION":
      case "RELEASE":
        // No net quantity change
        break;
    }
  }
  return net;
}

export function validateLedgerEntry(entry: LedgerEntry): string[] {
  const errors: string[] = [];

  if (!entry.eventId) errors.push("MISSING_EVENT_ID");
  if (!entry.idempotencyKey) errors.push("MISSING_IDEMPOTENCY_KEY");
  if (!entry.exchange) errors.push("MISSING_EXCHANGE");
  if (!entry.asset) errors.push("MISSING_ASSET");
  if (entry.quantity < 0) errors.push("NEGATIVE_QUANTITY");
  if (!entry.createdAt) errors.push("MISSING_CREATED_AT");

  return errors;
}

export function sortByCreatedAt(entries: LedgerEntry[]): LedgerEntry[] {
  return [...entries].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}
