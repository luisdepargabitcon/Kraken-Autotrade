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
  prefetchKrakenOhlcForAssets: vi.fn().mockResolvedValue(undefined), // bulk OHLC prefetch (offline)
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

// ============================================================
// Receive/spend — Internal earn/staking transfer (bug regression)
// SOL.S (unstake spend) + SOL (spot receive) → MUST be skipped
// Previously generated a false trade_sell SOL causing MISSING_OPENING_BALANCE
// ============================================================

describe("normalizeKrakenLedger — receive/spend internal earn transfer", () => {
  it("SOL.S spend + SOL receive: same asset after normalization → zero ops (no fiscal event)", async () => {
    const entries = [
      makeEntry({ id: "e1", refid: "TSGRLSI-5KGZS-NCXETD", type: "spend",   asset: "SOL.S", amount: -0.34542, fee: 0 }),
      makeEntry({ id: "e2", refid: "TSGRLSI-5KGZS-NCXETD", type: "receive", asset: "SOL",   amount:  0.34542, fee: 0 }),
    ];
    const ops = await normalizeKrakenLedger(entries);
    expect(ops).toHaveLength(0);
  });

  it("ETH2 (earn) spend + ETH receive: same asset after normalization → zero ops", async () => {
    const entries = [
      makeEntry({ id: "e1", refid: "R_ETH_EARN", type: "spend",   asset: "ETH2", amount: -1.5, fee: 0 }),
      makeEntry({ id: "e2", refid: "R_ETH_EARN", type: "receive", asset: "ETH",  amount:  1.5, fee: 0 }),
    ];
    const ops = await normalizeKrakenLedger(entries);
    expect(ops).toHaveLength(0);
  });

  it("DOT.S spend + DOT receive: zero ops (DOT.S strips to DOT)", async () => {
    const entries = [
      makeEntry({ id: "e1", refid: "R_DOT_STAKING", type: "spend",   asset: "DOT.S", amount: -10, fee: 0 }),
      makeEntry({ id: "e2", refid: "R_DOT_STAKING", type: "receive", asset: "DOT",   amount:  10, fee: 0 }),
    ];
    const ops = await normalizeKrakenLedger(entries);
    expect(ops).toHaveLength(0);
  });
});

// ============================================================
// Receive/spend — External (single-entry)
// ============================================================

describe("normalizeKrakenLedger — receive/spend single entry", () => {
  it("single receive entry (positive amount) → deposit op", async () => {
    const entries = [
      makeEntry({ id: "e1", refid: "R_RCV_SINGLE", type: "receive", asset: "SOL", amount: 2.5, fee: 0 }),
    ];
    const ops = await normalizeKrakenLedger(entries);
    expect(ops).toHaveLength(1);
    expect(ops[0].opType).toBe("deposit");
    expect(ops[0].asset).toBe("SOL");
    expect(ops[0].amount).toBeCloseTo(2.5);
    expect(ops[0].externalId).toBe("R_RCV_SINGLE_rcv");
  });

  it("single spend entry (negative amount) → withdrawal op", async () => {
    const entries = [
      makeEntry({ id: "e1", refid: "R_SPD_SINGLE", type: "spend", asset: "XXBT", amount: -0.05, fee: 0 }),
    ];
    const ops = await normalizeKrakenLedger(entries);
    expect(ops).toHaveLength(1);
    expect(ops[0].opType).toBe("withdrawal");
    expect(ops[0].asset).toBe("BTC");
    expect(ops[0].amount).toBeCloseTo(0.05);
    expect(ops[0].externalId).toBe("R_SPD_SINGLE_spd");
  });
});

// ============================================================
// Reward type → staking op
// ============================================================

describe("normalizeKrakenLedger — reward type", () => {
  it("reward entry → staking op (earn reward, no disposal)", async () => {
    const entries = [
      makeEntry({ id: "e1", refid: "R_REWARD", type: "reward", asset: "SOL", amount: 0.012, fee: 0 }),
    ];
    const ops = await normalizeKrakenLedger(entries);
    expect(ops).toHaveLength(1);
    expect(ops[0].opType).toBe("staking");
    expect(ops[0].asset).toBe("SOL");
    expect(ops[0].amount).toBeCloseTo(0.012);
  });
});

// ============================================================
// Transfer type → skipped (internal, no fiscal event)
// ============================================================

describe("normalizeKrakenLedger — transfer type", () => {
  it("transfer entry → zero ops (internal Kraken movement)", async () => {
    const entries = [
      makeEntry({ id: "e1", refid: "R_TRANSFER", type: "transfer", asset: "XETH", amount: 1.0, fee: 0 }),
    ];
    const ops = await normalizeKrakenLedger(entries);
    expect(ops).toHaveLength(0);
  });
});

// ============================================================
// Deposit EUR price fetching
// ============================================================

describe("normalizeKrakenLedger — deposit EUR price", () => {
  it("crypto deposit with known EUR price → priceEur and totalEur set", async () => {
    vi.mocked(eurRates.getCryptoEurPriceHistorical).mockResolvedValueOnce(150);
    const entries = [
      makeEntry({ id: "e1", refid: "R_DEP_SOL", type: "deposit", asset: "SOL", amount: 0.34542075, fee: 0 }),
    ];
    const ops = await normalizeKrakenLedger(entries);
    expect(ops).toHaveLength(1);
    expect(ops[0].opType).toBe("deposit");
    expect(ops[0].asset).toBe("SOL");
    expect(ops[0].priceEur).toBeCloseTo(150);
    expect(ops[0].totalEur).toBeCloseTo(150 * 0.34542075);
  });

  it("crypto deposit without EUR price → priceEur null, totalEur null (still emits op)", async () => {
    vi.mocked(eurRates.getCryptoEurPriceHistorical).mockResolvedValueOnce(null);
    const entries = [
      makeEntry({ id: "e1", refid: "R_DEP_NOPRICE", type: "deposit", asset: "SOL", amount: 1.0, fee: 0 }),
    ];
    const ops = await normalizeKrakenLedger(entries);
    expect(ops).toHaveLength(1);
    expect(ops[0].priceEur).toBeNull();
    expect(ops[0].totalEur).toBeNull();
    expect(ops[0].amount).toBeCloseTo(1.0);
  });

  it("staking reward with known EUR price → priceEur and totalEur set", async () => {
    vi.mocked(eurRates.getCryptoEurPriceHistorical).mockResolvedValueOnce(80000);
    const entries = [
      makeEntry({ id: "e1", refid: "R_STAKING_BTC", type: "staking", asset: "XXBT", amount: 0.00000277, fee: 0 }),
    ];
    const ops = await normalizeKrakenLedger(entries);
    expect(ops).toHaveLength(1);
    expect(ops[0].opType).toBe("staking");
    expect(ops[0].asset).toBe("BTC");
    expect(ops[0].priceEur).toBeCloseTo(80000);
    expect(ops[0].totalEur).toBeCloseTo(80000 * 0.00000277);
  });
});

// ============================================================
// FIFO regression: deposit → lot creation → no MISSING_OPENING_BALANCE
// Reproduces exact real-world cases from 2025-05-10/13 (SOL) and 2025-05-11/29 (TON)
// ============================================================

import { runFifo } from "../fifo-engine";
import type { NormalizedOperation } from "../normalizer";

function makeOp(overrides: Partial<NormalizedOperation>): NormalizedOperation {
  return {
    exchange: "kraken", externalId: "TEST", opType: "trade_buy",
    asset: "BTC", amount: 1, priceEur: 30000, totalEur: 30000, feeEur: 0,
    counterAsset: null, pair: null, executedAt: new Date("2025-01-01"), rawData: {},
    ...overrides,
  };
}

describe("FIFO — deposit creates lot (SOL regression TSGRLSI)", () => {
  it("deposit then sell: no MISSING_OPENING_BALANCE, no NEGATIVE_INVENTORY", () => {
    const ops: NormalizedOperation[] = [
      makeOp({ opType: "deposit",    asset: "SOL", amount: 0.34542075, priceEur: 154.1, totalEur: 154.1 * 0.34542075, executedAt: new Date("2025-05-10") }),
      makeOp({ opType: "trade_sell", asset: "SOL", amount: 0.34542,    priceEur: 154.1, totalEur: 154.1 * 0.34542,    executedAt: new Date("2025-05-13") }),
    ];
    const result = runFifo(ops);
    const errors = result.criticalErrors.filter(e => e.asset === "SOL");
    expect(errors).toHaveLength(0);
    expect(result.lots.filter(l => l.asset === "SOL")).toHaveLength(1);
    expect(result.disposals.filter(d => d.asset === "SOL")).toHaveLength(1);
  });
});

describe("FIFO — deposit creates lot (TON regression TSKBU63)", () => {
  it("deposit + 6 buys - 3 sells - big sell: no critical errors", () => {
    const ops: NormalizedOperation[] = [
      makeOp({ opType: "deposit",    asset: "TON", amount: 16.861676, priceEur: 3.0, totalEur: 16.861676 * 3.0, executedAt: new Date("2025-05-11") }),
      // 6 buys of 0.8 TON
      ...Array.from({ length: 6 }, (_, i) => makeOp({ opType: "trade_buy", asset: "TON", amount: 0.8, priceEur: 3.1, totalEur: 0.8 * 3.1, executedAt: new Date(`2025-05-14T${10 + i}:00:00`) })),
      // 2 sells of 0.8 TON
      makeOp({ opType: "trade_sell", asset: "TON", amount: 0.8, priceEur: 3.2, totalEur: 0.8 * 3.2, executedAt: new Date("2025-05-15T12:00:00") }),
      makeOp({ opType: "trade_sell", asset: "TON", amount: 0.8, priceEur: 3.2, totalEur: 0.8 * 3.2, executedAt: new Date("2025-05-15T13:00:00") }),
      // big sell: 21.6616 TON (deposit 16.86 + 6 buys 4.8 - 2 sells 1.6 = 20.06 available)
      // use 19.4616 to fit available = 16.861676 + 4.8 - 1.6 = 20.061676
      makeOp({ opType: "trade_sell", asset: "TON", amount: 20.0, priceEur: 3.3, totalEur: 20.0 * 3.3, executedAt: new Date("2025-05-29") }),
    ];
    const result = runFifo(ops);
    const errors = result.criticalErrors.filter(e => e.asset === "TON");
    expect(errors).toHaveLength(0);
  });
});

describe("FIFO — staking creates lot (BTC 37-sat regression TAYARB)", () => {
  it("buy + staking reward covers two sells exactly", () => {
    const ops: NormalizedOperation[] = [
      makeOp({ opType: "trade_buy",  asset: "BTC", amount: 0.00033063, priceEur: 80000, totalEur: 0.00033063 * 80000, executedAt: new Date("2025-12-11") }),
      makeOp({ opType: "staking",    asset: "BTC", amount: 0.00000277, priceEur: 80000, totalEur: 0.00000277 * 80000, executedAt: new Date("2025-12-12") }),
      makeOp({ opType: "trade_sell", asset: "BTC", amount: 0.0001655,  priceEur: 77000, totalEur: 0.0001655 * 77000,  executedAt: new Date("2025-12-12T22:00:00") }),
      makeOp({ opType: "trade_sell", asset: "BTC", amount: 0.0001655,  priceEur: 77000, totalEur: 0.0001655 * 77000,  executedAt: new Date("2025-12-13") }),
    ];
    const result = runFifo(ops);
    const errors = result.criticalErrors.filter(e => e.asset === "BTC");
    expect(errors).toHaveLength(0);
  });
});

// ============================================================
// USDC deposit cost basis regression (lot 5163 — FTAVCHJ)
// Reproduces bug where Kraken USDC deposit got cost_eur=0 → fake +306€ gain on RevolutX sell
// ============================================================

describe("normalizeKrakenLedger — USDC deposit uses USD/EUR rate as cost basis (regression FTAVCHJ)", () => {
  it("USDC deposit → priceEur = USD/EUR rate, totalEur = amount × rate, NOT null", async () => {
    vi.mocked(eurRates.getHistoricalUsdEurRate).mockResolvedValueOnce(0.8524);
    const entries = [
      makeEntry({ id: "e1", refid: "FTAVCHJ", type: "deposit", asset: "USDC", amount: 360, fee: 0 }),
    ];
    const ops = await normalizeKrakenLedger(entries);
    expect(ops).toHaveLength(1);
    expect(ops[0].opType).toBe("deposit");
    expect(ops[0].asset).toBe("USDC");
    expect(ops[0].priceEur).toBeCloseTo(0.8524);
    expect(ops[0].totalEur).toBeCloseTo(360 * 0.8524);
  });
});

describe("FIFO — USDC deposit at USD/EUR cost → sell produces near-zero gain (regression lot 5163)", () => {
  it("deposit 360 USDC @ 0.8524 EUR/unit → sell 360 USDC @ 306.77 proceeds → gain ≈ 0 (not +306)", () => {
    const costBasis = 360 * 0.8524; // 306.864 EUR
    const proceeds  = 306.7735;
    const ops: NormalizedOperation[] = [
      makeOp({ opType: "deposit",    asset: "USDC", amount: 360, priceEur: 0.8524, totalEur: costBasis, executedAt: new Date("2025-12-14") }),
      makeOp({ opType: "trade_sell", asset: "USDC", amount: 360, priceEur: proceeds / 360, totalEur: proceeds, executedAt: new Date("2026-01-20") }),
    ];
    const result = runFifo(ops);
    const usdcErrors = result.criticalErrors.filter(e => e.asset === "USDC");
    expect(usdcErrors).toHaveLength(0);
    expect(result.disposals).toHaveLength(1);
    const gain = result.disposals[0].gainLossEur;
    expect(Math.abs(gain)).toBeLessThan(1); // gain must be near 0, NOT +306
  });
});
