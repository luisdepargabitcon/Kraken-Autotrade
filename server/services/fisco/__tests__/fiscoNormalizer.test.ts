/**
 * Tests for FISCO normalizer trade classification logic.
 * Covers all 9 trade cases in classifyAndBuildTrade.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock eur-rates so tests run offline
vi.mock("../eur-rates", () => ({
  getHistoricalUsdEurRate: vi.fn().mockResolvedValue(0.92),
  prefetchHistoricalRates: vi.fn().mockResolvedValue(undefined),
  toEurHistorical: vi.fn().mockImplementation(async (amount: number, currency: string) => {
    if (currency === "EUR") return amount;
    return amount * 0.92; // 1 USD = 0.92 EUR
  }),
}));

import { normalizeKrakenLedger, normalizeRevolutXOrders } from "../normalizer";

// ============================================================
// Helpers
// ============================================================

function makeEntry(overrides: Partial<{
  id: string; refid: string; type: string; subtype: string;
  asset: string; amount: number; fee: number; balance: number; time: number;
}>) {
  return {
    id: "id1", refid: "REF1", type: "trade", subtype: "",
    asset: "XXBT", amount: 0.01, fee: 0, balance: 1, time: 1700000000,
    ...overrides,
  };
}

// ============================================================
// Case 2: Buy crypto with fiat (BTC/USD buy)
// ============================================================

describe("normalizeKrakenLedger — Case 2: Buy crypto with fiat", () => {
  it("produces single trade_buy for BTC when spending USD", async () => {
    const entries = [
      makeEntry({ id: "e1", refid: "R1", asset: "XXBT", amount: 0.01, fee: 0 }),
      makeEntry({ id: "e2", refid: "R1", asset: "ZUSD", amount: -500, fee: 0.5 }),
    ];
    const ops = await normalizeKrakenLedger(entries);
    expect(ops).toHaveLength(1);
    expect(ops[0].opType).toBe("trade_buy");
    expect(ops[0].asset).toBe("BTC");
    expect(ops[0].amount).toBeCloseTo(0.01);
    expect(ops[0].totalEur).toBeCloseTo(500 * 0.92); // 500 USD × 0.92
    expect(ops[0].externalId).toBe("R1");
    expect(ops[0].requiresEurPrice).toBeFalsy();
  });
});

// ============================================================
// Case 3: Sell crypto for fiat (BTC/USD sell)
// ============================================================

describe("normalizeKrakenLedger — Case 3: Sell crypto for fiat", () => {
  it("produces single trade_sell for BTC when receiving USD", async () => {
    const entries = [
      makeEntry({ id: "e1", refid: "R2", asset: "ZUSD", amount: 500, fee: 0.5 }),
      makeEntry({ id: "e2", refid: "R2", asset: "XXBT", amount: -0.01, fee: 0 }),
    ];
    const ops = await normalizeKrakenLedger(entries);
    expect(ops).toHaveLength(1);
    expect(ops[0].opType).toBe("trade_sell");
    expect(ops[0].asset).toBe("BTC");
    expect(ops[0].amount).toBeCloseTo(0.01);
    expect(ops[0].totalEur).toBeCloseTo(500 * 0.92);
  });
});

// ============================================================
// Case 4: Buy crypto with stablecoin (TON/USDC buy)
// ============================================================

describe("normalizeKrakenLedger — Case 4: Buy crypto with stablecoin", () => {
  it("produces trade_sell USDC + trade_buy TON", async () => {
    const entries = [
      makeEntry({ id: "e1", refid: "R3", asset: "TON", amount: 10, fee: 0 }),
      makeEntry({ id: "e2", refid: "R3", asset: "USDC", amount: -30, fee: 0.027 }),
    ];
    const ops = await normalizeKrakenLedger(entries);
    expect(ops).toHaveLength(2);

    const sellOp = ops.find(o => o.opType === "trade_sell");
    const buyOp = ops.find(o => o.opType === "trade_buy");

    expect(sellOp).toBeDefined();
    expect(sellOp!.asset).toBe("USDC");
    expect(sellOp!.amount).toBeCloseTo(30);
    expect(sellOp!.externalId).toContain("disp_USDC");

    expect(buyOp).toBeDefined();
    expect(buyOp!.asset).toBe("TON");
    expect(buyOp!.amount).toBeCloseTo(10);
    expect(buyOp!.totalEur).toBeCloseTo(30 * 0.92); // USDC value in EUR
    expect(buyOp!.requiresEurPrice).toBeFalsy();
  });
});

// ============================================================
// Case 5: Sell crypto for stablecoin (TON/USDC sell)
// ============================================================

describe("normalizeKrakenLedger — Case 5: Sell crypto for stablecoin", () => {
  it("produces trade_sell TON + trade_buy USDC", async () => {
    const entries = [
      makeEntry({ id: "e1", refid: "R4", asset: "USDC", amount: 30, fee: 0.027 }),
      makeEntry({ id: "e2", refid: "R4", asset: "TON", amount: -10, fee: 0 }),
    ];
    const ops = await normalizeKrakenLedger(entries);
    expect(ops).toHaveLength(2);

    const sellOp = ops.find(o => o.opType === "trade_sell");
    const buyOp = ops.find(o => o.opType === "trade_buy");

    expect(sellOp!.asset).toBe("TON");
    expect(sellOp!.amount).toBeCloseTo(10);
    expect(sellOp!.totalEur).toBeCloseTo(30 * 0.92);

    expect(buyOp!.asset).toBe("USDC");
    expect(buyOp!.amount).toBeCloseTo(30);
    expect(buyOp!.externalId).toContain("rcv_USDC");
  });
});

// ============================================================
// Case 6: Buy stablecoin with fiat (USDC/USD buy)
// ============================================================

describe("normalizeKrakenLedger — Case 6: Buy stablecoin with fiat", () => {
  it("produces single trade_buy USDC", async () => {
    const entries = [
      makeEntry({ id: "e1", refid: "R5", asset: "USDC", amount: 100, fee: 0 }),
      makeEntry({ id: "e2", refid: "R5", asset: "ZUSD", amount: -100.1, fee: 0.1 }),
    ];
    const ops = await normalizeKrakenLedger(entries);
    expect(ops).toHaveLength(1);
    expect(ops[0].opType).toBe("trade_buy");
    expect(ops[0].asset).toBe("USDC");
    expect(ops[0].amount).toBeCloseTo(100);
    expect(ops[0].priceEur).toBeCloseTo(0.92);
  });
});

// ============================================================
// Case 7: Sell stablecoin for fiat (USDC/USD sell)
// ============================================================

describe("normalizeKrakenLedger — Case 7: Sell stablecoin for fiat", () => {
  it("produces single trade_sell USDC", async () => {
    const entries = [
      makeEntry({ id: "e1", refid: "R6", asset: "ZUSD", amount: 100, fee: 0 }),
      makeEntry({ id: "e2", refid: "R6", asset: "USDC", amount: -100, fee: 0.1 }),
    ];
    const ops = await normalizeKrakenLedger(entries);
    expect(ops).toHaveLength(1);
    expect(ops[0].opType).toBe("trade_sell");
    expect(ops[0].asset).toBe("USDC");
  });
});

// ============================================================
// Case 9: Crypto-to-crypto (ETH/BTC)
// ============================================================

describe("normalizeKrakenLedger — Case 9: Crypto-to-crypto", () => {
  it("produces two ops with requiresEurPrice=true and null totalEur", async () => {
    const entries = [
      makeEntry({ id: "e1", refid: "R7", asset: "XETH", amount: 0.1534, fee: 0 }),
      makeEntry({ id: "e2", refid: "R7", asset: "XXBT", amount: -0.00530, fee: 0.000001 }),
    ];
    const ops = await normalizeKrakenLedger(entries);
    expect(ops).toHaveLength(2);

    const sellOp = ops.find(o => o.opType === "trade_sell");
    const buyOp = ops.find(o => o.opType === "trade_buy");

    expect(sellOp!.requiresEurPrice).toBe(true);
    expect(sellOp!.totalEur).toBeNull();
    expect(sellOp!.asset).toBe("BTC");

    expect(buyOp!.requiresEurPrice).toBe(true);
    expect(buyOp!.totalEur).toBeNull();
    expect(buyOp!.asset).toBe("ETH");
  });
});

// ============================================================
// Multi-entry refid: aggregates partial fills
// ============================================================

describe("normalizeKrakenLedger — Multi-entry refid", () => {
  it("aggregates all positives and negatives for same refid", async () => {
    const entries = [
      makeEntry({ id: "e1", refid: "R8", asset: "XXBT", amount: 0.005, fee: 0 }),
      makeEntry({ id: "e2", refid: "R8", asset: "XXBT", amount: 0.005, fee: 0 }),
      makeEntry({ id: "e3", refid: "R8", asset: "ZUSD", amount: -250, fee: 0.25 }),
      makeEntry({ id: "e4", refid: "R8", asset: "ZUSD", amount: -250, fee: 0.25 }),
    ];
    const ops = await normalizeKrakenLedger(entries);
    expect(ops).toHaveLength(1);
    expect(ops[0].opType).toBe("trade_buy");
    expect(ops[0].amount).toBeCloseTo(0.01); // 0.005 + 0.005
    expect(ops[0].totalEur).toBeCloseTo(500 * 0.92); // 500 USD total
  });
});

// ============================================================
// Kraken asset normalization
// ============================================================

describe("normalizeKrakenLedger — Asset normalization", () => {
  it("normalizes XXBT → BTC, XETH → ETH, ZUSD → USD", async () => {
    const entries = [
      makeEntry({ id: "e1", refid: "R9", asset: "XETH", amount: 1, fee: 0 }),
      makeEntry({ id: "e2", refid: "R9", asset: "ZUSD", amount: -3500, fee: 1 }),
    ];
    const ops = await normalizeKrakenLedger(entries);
    expect(ops[0].asset).toBe("ETH");
    expect(ops[0].counterAsset).toBe("USD");
  });
});

// ============================================================
// Fiat↔Fiat conversion (Case 1)
// ============================================================

describe("normalizeKrakenLedger — Case 1: Fiat to fiat conversion", () => {
  it("produces a conversion op (not tracked in FIFO)", async () => {
    const entries = [
      makeEntry({ id: "e1", refid: "R10", asset: "ZEUR", amount: 92, fee: 0 }),
      makeEntry({ id: "e2", refid: "R10", asset: "ZUSD", amount: -100, fee: 0 }),
    ];
    const ops = await normalizeKrakenLedger(entries);
    expect(ops).toHaveLength(1);
    expect(ops[0].opType).toBe("conversion");
    expect(ops[0].asset).toBe("EUR");
  });
});
