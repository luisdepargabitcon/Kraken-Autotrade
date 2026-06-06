/**
 * Tests for FISCO normalizer trade classification logic.
 * Covers all 9 trade cases in classifyAndBuildTrade.
 */

import { describe, it, expect, vi } from "vitest";

// Mock eur-rates so tests run offline
// getCryptoEurPriceHistorical defaults to null (no CoinGecko price available)
// so Case 9 falls back to requiresEurPrice=true unless overridden per-test.
vi.mock("../eur-rates", () => ({
  getHistoricalUsdEurRate: vi.fn().mockResolvedValue(0.92),
  prefetchHistoricalRates: vi.fn().mockResolvedValue(undefined),
  toEurHistorical: vi.fn().mockImplementation(async (amount: number, currency: string) => {
    if (currency === "EUR") return amount;
    return amount * 0.92; // 1 USD = 0.92 EUR
  }),
  getCryptoEurPriceHistorical: vi.fn().mockResolvedValue(null), // default: no price
}));

import * as eurRates from "../eur-rates";

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
// priceEur must be totalEur / recvAmount, not just usdEurRate
// ============================================================

describe("normalizeKrakenLedger — Case 6: Buy stablecoin with fiat", () => {
  it("computes priceEur as totalEur/recvAmount (not just usdEurRate)", async () => {
    // Spend 100.1 USD to get 100 USDC (slight spread)
    const entries = [
      makeEntry({ id: "e1", refid: "R5", asset: "USDC", amount: 100, fee: 0 }),
      makeEntry({ id: "e2", refid: "R5", asset: "ZUSD", amount: -100.1, fee: 0.1 }),
    ];
    const ops = await normalizeKrakenLedger(entries);
    expect(ops).toHaveLength(1);
    expect(ops[0].opType).toBe("trade_buy");
    expect(ops[0].asset).toBe("USDC");
    expect(ops[0].amount).toBeCloseTo(100);
    // totalEur = 100.1 USD × 0.92 = 92.092; priceEur = 92.092 / 100 = 0.92092 (NOT 0.92)
    const expectedTotalEur = 100.1 * 0.92;
    const expectedPriceEur = expectedTotalEur / 100;
    expect(ops[0].totalEur).toBeCloseTo(expectedTotalEur);
    expect(ops[0].priceEur).toBeCloseTo(expectedPriceEur);
    expect(ops[0].priceEur).not.toBeCloseTo(0.92, 4); // must differ from plain usdEurRate
  });
});

// ============================================================
// Case 7: Sell stablecoin for fiat (USDC/USD sell)
// totalEur must be based on USD received, NOT stablecoin amount
// ============================================================

describe("normalizeKrakenLedger — Case 7: Sell stablecoin for fiat", () => {
  it("uses USD received (not USDC spent) as proceeds basis", async () => {
    // Sell 100 USDC and receive only 99.9 USD (slight slippage)
    const entries = [
      makeEntry({ id: "e1", refid: "R6", asset: "ZUSD", amount: 99.9, fee: 0 }),
      makeEntry({ id: "e2", refid: "R6", asset: "USDC", amount: -100, fee: 0.1 }),
    ];
    const ops = await normalizeKrakenLedger(entries);
    expect(ops).toHaveLength(1);
    expect(ops[0].opType).toBe("trade_sell");
    expect(ops[0].asset).toBe("USDC");
    expect(ops[0].amount).toBeCloseTo(100);
    // totalEur = 99.9 USD received × 0.92 = 91.908 (NOT 100 × 0.92 = 92)
    expect(ops[0].totalEur).toBeCloseTo(99.9 * 0.92);
    expect(ops[0].totalEur).not.toBeCloseTo(100 * 0.92, 2); // must differ from spentAmount-based calc
    expect(ops[0].priceEur).toBeCloseTo((99.9 * 0.92) / 100);
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
// Case 9: Crypto-to-crypto WITH EUR price from CoinGecko
// ============================================================

describe("normalizeKrakenLedger — Case 9: Crypto-to-crypto with EUR price", () => {
  it("uses CoinGecko EUR price when available — no requiresEurPrice", async () => {
    // Mock BTC price on that date = 50000 EUR
    vi.mocked(eurRates.getCryptoEurPriceHistorical).mockResolvedValueOnce(50000);

    const entries = [
      makeEntry({ id: "e1", refid: "R7b", asset: "XETH", amount: 0.5, fee: 0 }),
      makeEntry({ id: "e2", refid: "R7b", asset: "XXBT", amount: -0.01, fee: 0 }),
    ];
    const ops = await normalizeKrakenLedger(entries);
    expect(ops).toHaveLength(2);

    const sellOp = ops.find(o => o.opType === "trade_sell");
    const buyOp = ops.find(o => o.opType === "trade_buy");

    // Sell BTC at 50000 EUR
    expect(sellOp!.asset).toBe("BTC");
    expect(sellOp!.requiresEurPrice).toBeFalsy();
    expect(sellOp!.priceEur).toBeCloseTo(50000);
    expect(sellOp!.totalEur).toBeCloseTo(0.01 * 50000); // 500 EUR

    // Buy ETH at same total EUR value
    expect(buyOp!.asset).toBe("ETH");
    expect(buyOp!.requiresEurPrice).toBeFalsy();
    expect(buyOp!.totalEur).toBeCloseTo(0.01 * 50000); // 500 EUR
    expect(buyOp!.priceEur).toBeCloseTo((0.01 * 50000) / 0.5); // 1000 EUR/ETH
  });

  it("falls back to requiresEurPrice=true when CoinGecko returns null", async () => {
    vi.mocked(eurRates.getCryptoEurPriceHistorical).mockResolvedValueOnce(null);

    const entries = [
      makeEntry({ id: "e1", refid: "R7c", asset: "XETH", amount: 0.5, fee: 0 }),
      makeEntry({ id: "e2", refid: "R7c", asset: "XXBT", amount: -0.01, fee: 0 }),
    ];
    const ops = await normalizeKrakenLedger(entries);
    expect(ops).toHaveLength(2);
    expect(ops.every(o => o.requiresEurPrice === true)).toBe(true);
    expect(ops.every(o => o.totalEur === null)).toBe(true);
  });
});

// ============================================================
// isSafeForReport recalculation after validateFifoResult
// ============================================================

describe("FifoResult.isSafeForReport recalculation", () => {
  it("is false when requiresEurPrice ops exist (not safe to report)", async () => {
    // getCryptoEurPriceHistorical returns null → requiresEurPrice=true → criticalErrors
    vi.mocked(eurRates.getCryptoEurPriceHistorical).mockResolvedValue(null);

    const { runFifo } = await import("../fifo-engine");
    const entries = [
      makeEntry({ id: "e1", refid: "R7d", asset: "XETH", amount: 0.5, fee: 0 }),
      makeEntry({ id: "e2", refid: "R7d", asset: "XXBT", amount: -0.01, fee: 0 }),
    ];
    const ops = await normalizeKrakenLedger(entries);
    const fifo = runFifo(ops);

    // There should be REQUIRES_EUR_PRICE critical errors → not safe
    expect(fifo.isSafeForReport).toBe(false);
    expect(fifo.criticalErrors.some(e => e.code === "REQUIRES_EUR_PRICE")).toBe(true);
  });

  it("is true when all ops have EUR values resolved", async () => {
    // All BTC ops have EUR values via normal buy/sell (Cases 2 & 3)
    const { runFifo } = await import("../fifo-engine");
    const buyEntries = [
      makeEntry({ id: "b1", refid: "RBuy", asset: "XXBT", amount: 0.01, fee: 0 }),
      makeEntry({ id: "b2", refid: "RBuy", asset: "ZUSD", amount: -500, fee: 0 }),
    ];
    const buyOps = await normalizeKrakenLedger(buyEntries);
    const fifo = runFifo(buyOps);

    expect(fifo.isSafeForReport).toBe(true);
    expect(fifo.criticalErrors).toHaveLength(0);
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
