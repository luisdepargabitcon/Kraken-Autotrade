/**
 * Portfolio Ledger & Attribution — Fase 4: tests
 */

import { describe, it, expect } from "vitest";
import {
  attributeEntry,
  reconcileHoldings,
  detectDuplicateEntries,
  computeNetQuantity,
  validateLedgerEntry,
  sortByCreatedAt,
  type AttributionRecord,
} from "../portfolioLedger";
import type { LedgerEntry } from "../portfolioTypes";

const makeEntry = (overrides: Partial<LedgerEntry> = {}): LedgerEntry => ({
  eventId: "e1",
  idempotencyKey: "k1",
  entryType: "PURCHASE",
  exchange: "kraken",
  asset: "BTC",
  quantity: 0.1,
  fromBucket: null,
  toBucket: null,
  mode: "AMA",
  cycleId: null,
  trancheId: null,
  source: "SYSTEM",
  metadataHash: null,
  createdAt: "2026-07-29T00:00:00Z",
  ...overrides,
});

describe("Portfolio 4 — Attribution", () => {
  it("attributes PURCHASE entries", () => {
    const entry = makeEntry({ entryType: "PURCHASE", quantity: 0.5 });
    const attr = attributeEntry(entry, "AMA");
    expect(attr).not.toBeNull();
    expect(attr!.mode).toBe("AMA");
    expect(attr!.quantity).toBe(0.5);
  });

  it("attributes TRANSFER entries", () => {
    const entry = makeEntry({ entryType: "TRANSFER", quantity: 0.3 });
    const attr = attributeEntry(entry, "IDCA");
    expect(attr).not.toBeNull();
    expect(attr!.mode).toBe("IDCA");
  });

  it("does not attribute non-purchase entries", () => {
    const entry = makeEntry({ entryType: "FEE", quantity: 0.001 });
    expect(attributeEntry(entry, "AMA")).toBeNull();
  });

  it("does not attribute zero quantity", () => {
    const entry = makeEntry({ entryType: "PURCHASE", quantity: 0 });
    expect(attributeEntry(entry, "AMA")).toBeNull();
  });
});

describe("Portfolio 4 — Reconciliation", () => {
  it("reconciles matching holdings", () => {
    const expected = [{ asset: "BTC", exchange: "kraken", quantity: 1.5 }];
    const actual = [{ asset: "BTC", exchange: "kraken", quantity: 1.5 }];
    const result = reconcileHoldings(expected, actual);
    expect(result.reconciled).toBe(true);
    expect(result.discrepancies).toHaveLength(0);
    expect(result.totalMatched).toBe(1);
  });

  it("detects quantity mismatch", () => {
    const expected = [{ asset: "BTC", exchange: "kraken", quantity: 1.5 }];
    const actual = [{ asset: "BTC", exchange: "kraken", quantity: 1.0 }];
    const result = reconcileHoldings(expected, actual);
    expect(result.reconciled).toBe(false);
    expect(result.discrepancies).toHaveLength(1);
    expect(result.discrepancies[0].type).toBe("QUANTITY_MISMATCH");
    expect(result.discrepancies[0].expected).toBe(1.5);
    expect(result.discrepancies[0].actual).toBe(1.0);
  });

  it("detects orphan entries in actual", () => {
    const expected = [{ asset: "BTC", exchange: "kraken", quantity: 1.0 }];
    const actual = [
      { asset: "BTC", exchange: "kraken", quantity: 1.0 },
      { asset: "ETH", exchange: "kraken", quantity: 10.0 },
    ];
    const result = reconcileHoldings(expected, actual);
    expect(result.reconciled).toBe(false);
    expect(result.discrepancies).toHaveLength(1);
    expect(result.discrepancies[0].type).toBe("ORPHAN_ENTRY");
    expect(result.discrepancies[0].asset).toBe("ETH");
  });

  it("handles empty expected", () => {
    const result = reconcileHoldings([], []);
    expect(result.reconciled).toBe(true);
    expect(result.totalChecked).toBe(0);
  });
});

describe("Portfolio 4 — Duplicate Detection", () => {
  it("detects duplicate idempotency keys", () => {
    const entries = [
      makeEntry({ eventId: "e1", idempotencyKey: "k1" }),
      makeEntry({ eventId: "e2", idempotencyKey: "k1" }),
      makeEntry({ eventId: "e3", idempotencyKey: "k2" }),
    ];
    const dups = detectDuplicateEntries(entries);
    expect(dups).toHaveLength(1);
    expect(dups[0].eventId).toBe("e2");
  });

  it("returns empty for unique entries", () => {
    const entries = [
      makeEntry({ eventId: "e1", idempotencyKey: "k1" }),
      makeEntry({ eventId: "e2", idempotencyKey: "k2" }),
    ];
    expect(detectDuplicateEntries(entries)).toHaveLength(0);
  });
});

describe("Portfolio 4 — Net Quantity", () => {
  it("computes net quantity from mixed entries", () => {
    const entries = [
      makeEntry({ entryType: "DEPOSIT", quantity: 1.0 }),
      makeEntry({ entryType: "PURCHASE", quantity: 0.5 }),
      makeEntry({ entryType: "SALE", quantity: 0.3 }),
      makeEntry({ entryType: "FEE", quantity: 0.001 }),
      makeEntry({ entryType: "WITHDRAWAL", quantity: 0.2 }),
    ];
    const net = computeNetQuantity(entries, "BTC", "kraken");
    // 1.0 + 0.5 - 0.3 - 0.001 - 0.2 = 0.999
    expect(net).toBeCloseTo(0.999, 6);
  });

  it("ignores entries for different asset/exchange", () => {
    const entries = [
      makeEntry({ entryType: "DEPOSIT", quantity: 1.0, asset: "BTC", exchange: "kraken" }),
      makeEntry({ entryType: "DEPOSIT", quantity: 1.0, asset: "ETH", exchange: "kraken" }),
    ];
    expect(computeNetQuantity(entries, "BTC", "kraken")).toBe(1.0);
    expect(computeNetQuantity(entries, "ETH", "kraken")).toBe(1.0);
  });

  it("handles ADJUSTMENT entries", () => {
    const entries = [
      makeEntry({ entryType: "DEPOSIT", quantity: 1.0 }),
      makeEntry({ entryType: "ADJUSTMENT", quantity: -0.1 }),
    ];
    expect(computeNetQuantity(entries, "BTC", "kraken")).toBeCloseTo(0.9, 6);
  });

  it("RESERVATION and RELEASE do not affect net", () => {
    const entries = [
      makeEntry({ entryType: "DEPOSIT", quantity: 1.0 }),
      makeEntry({ entryType: "RESERVATION", quantity: 0.5 }),
      makeEntry({ entryType: "RELEASE", quantity: 0.5 }),
    ];
    expect(computeNetQuantity(entries, "BTC", "kraken")).toBe(1.0);
  });
});

describe("Portfolio 4 — Validation", () => {
  it("validates correct entry", () => {
    expect(validateLedgerEntry(makeEntry())).toHaveLength(0);
  });

  it("rejects missing fields", () => {
    expect(validateLedgerEntry(makeEntry({ eventId: "" }))).toContain("MISSING_EVENT_ID");
    expect(validateLedgerEntry(makeEntry({ idempotencyKey: "" }))).toContain("MISSING_IDEMPOTENCY_KEY");
    expect(validateLedgerEntry(makeEntry({ exchange: "" }))).toContain("MISSING_EXCHANGE");
    expect(validateLedgerEntry(makeEntry({ asset: "" }))).toContain("MISSING_ASSET");
    expect(validateLedgerEntry(makeEntry({ createdAt: "" }))).toContain("MISSING_CREATED_AT");
  });

  it("rejects negative quantity", () => {
    expect(validateLedgerEntry(makeEntry({ quantity: -1 }))).toContain("NEGATIVE_QUANTITY");
  });
});

describe("Portfolio 4 — Sort by Created At", () => {
  it("sorts entries chronologically", () => {
    const entries = [
      makeEntry({ eventId: "e3", createdAt: "2026-07-31T00:00:00Z" }),
      makeEntry({ eventId: "e1", createdAt: "2026-07-29T00:00:00Z" }),
      makeEntry({ eventId: "e2", createdAt: "2026-07-30T00:00:00Z" }),
    ];
    const sorted = sortByCreatedAt(entries);
    expect(sorted[0].eventId).toBe("e1");
    expect(sorted[1].eventId).toBe("e2");
    expect(sorted[2].eventId).toBe("e3");
  });
});
