import { describe, it, expect } from "vitest";

/**
 * Tests for DRY_RUN sell matching logic.
 * Validates that sellContext.lotId is present and that matching
 * produces correct entryPrice, pnlUsd, and pnlPct.
 *
 * The actual matching logic lives in tradingEngine.ts executeTrade()
 * DRY_RUN branch. These tests validate the pure matching decision
 * extracted here to ensure correctness of the audit log.
 */

interface MockBuy {
  simTxid: string;
  pair: string;
  type: "buy";
  status: "open" | "closed";
  price: string;
  amount: string;
  createdAt: Date;
}

interface SellContext {
  entryPrice?: number;
  aiSampleId?: number;
  openedAt?: number | Date | null;
  lotId?: string;
}

interface MatchResult {
  matched: boolean;
  matchStatus: "OK" | "MISMATCH";
  matchReason: string;
  entryPriceNum: number;
  pnlUsd: number;
  pnlPct: number;
  priceMismatch: boolean;
}

/**
 * Pure function mirroring the DRY_RUN sell matching logic in tradingEngine.ts.
 * Given a sellContext.lotId, a list of open buys, and sell price/amount,
 * determines the match and computes PnL.
 */
function simulateDryRunSellMatch(
  sellContext: SellContext | undefined,
  openBuys: MockBuy[],
  sellPrice: number,
  sellVolume: number,
  pair: string
): MatchResult {
  const sellLotId = sellContext?.lotId;
  let matchedBuy: MockBuy | undefined;

  if (sellLotId) {
    matchedBuy = openBuys.find(
      (b) => b.simTxid === sellLotId && b.status === "open" && b.type === "buy"
    );
  }

  if (!matchedBuy) {
    // FIFO fallback
    matchedBuy = openBuys
      .filter((b) => b.pair === pair && b.status === "open" && b.type === "buy")
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
  }

  const entryPriceNum = matchedBuy ? parseFloat(matchedBuy.price) : (sellContext?.entryPrice || sellPrice);
  const pnlUsd = (sellPrice - entryPriceNum) * sellVolume;
  const pnlPct = entryPriceNum > 0 ? ((sellPrice - entryPriceNum) / entryPriceNum) * 100 : 0;

  const matchStatus = !sellLotId ? "MISMATCH" as const :
    (matchedBuy && matchedBuy.simTxid === sellLotId) ? "OK" as const : "MISMATCH" as const;

  const matchReason = !sellLotId ? "NO_LOTID_IN_SELL_CONTEXT" :
    !matchedBuy ? "BUY_NOT_FOUND" :
    matchedBuy.simTxid === sellLotId ? "EXACT_MATCH" : "FIFO_FALLBACK";

  const sellCtxEntryPrice = sellContext?.entryPrice || 0;
  const entryPriceDiff = sellCtxEntryPrice > 0 ? Math.abs(entryPriceNum - sellCtxEntryPrice) : 0;
  const priceMismatch = entryPriceDiff > 0.01;

  return {
    matched: !!matchedBuy,
    matchStatus,
    matchReason,
    entryPriceNum,
    pnlUsd,
    pnlPct,
    priceMismatch,
  };
}

describe("DRY_RUN Sell Matching", () => {
  const baseBuy: MockBuy = {
    simTxid: "DRY-1782568262334",
    pair: "BTC/USD",
    type: "buy",
    status: "open",
    price: "95000.00000000",
    amount: "0.00526316",
    createdAt: new Date("2025-06-22T10:00:00Z"),
  };

  // === Exact match by lotId ===
  it("M-01: exact match when sellContext.lotId matches open buy", () => {
    const result = simulateDryRunSellMatch(
      { entryPrice: 95000, lotId: "DRY-1782568262334" },
      [baseBuy],
      96000,
      0.00526316,
      "BTC/USD"
    );
    expect(result.matched).toBe(true);
    expect(result.matchStatus).toBe("OK");
    expect(result.matchReason).toBe("EXACT_MATCH");
    expect(result.entryPriceNum).toBe(95000);
    expect(result.pnlUsd).toBeCloseTo(5.26, 1);
    expect(result.pnlPct).toBeCloseTo(1.0526, 1);
    expect(result.priceMismatch).toBe(false);
  });

  // === MISMATCH: no lotId in sellContext ===
  it("M-02: MISMATCH when sellContext has no lotId (Smart Exit bug scenario)", () => {
    const result = simulateDryRunSellMatch(
      { entryPrice: 95000 }, // no lotId!
      [baseBuy],
      96000,
      0.00526316,
      "BTC/USD"
    );
    expect(result.matchStatus).toBe("MISMATCH");
    expect(result.matchReason).toBe("NO_LOTID_IN_SELL_CONTEXT");
    // FIFO fallback finds the buy, so matched=true but status=MISMATCH
    expect(result.matched).toBe(true);
  });

  // === MISMATCH: lotId not found among open buys ===
  it("M-03: MISMATCH when sellContext.lotId not found (buy already closed)", () => {
    const result = simulateDryRunSellMatch(
      { entryPrice: 95000, lotId: "DRY-NOTFOUND" },
      [baseBuy],
      96000,
      0.00526316,
      "BTC/USD"
    );
    expect(result.matchStatus).toBe("MISMATCH");
    expect(result.matchReason).toBe("FIFO_FALLBACK");
    // Falls back to FIFO, finds baseBuy
    expect(result.matched).toBe(true);
  });

  // === FIFO fallback: lotId present but doesn't match, falls to FIFO ===
  it("M-04: FIFO_FALLBACK when lotId doesn't match any buy but FIFO finds one", () => {
    const buy2: MockBuy = {
      ...baseBuy,
      simTxid: "DRY-DIFFERENT",
      createdAt: new Date("2025-06-22T11:00:00Z"),
    };
    const result = simulateDryRunSellMatch(
      { entryPrice: 95000, lotId: "DRY-WRONGLOT" },
      [baseBuy, buy2],
      96000,
      0.00526316,
      "BTC/USD"
    );
    expect(result.matchStatus).toBe("MISMATCH");
    expect(result.matchReason).toBe("FIFO_FALLBACK");
    // FIFO picks the oldest (baseBuy)
    expect(result.entryPriceNum).toBe(95000);
  });

  // === Price mismatch detection ===
  it("M-05: priceMismatch=true when entryPrice from buy differs from sellContext", () => {
    const buyDiffPrice: MockBuy = {
      ...baseBuy,
      price: "93000.00000000", // different from sellContext.entryPrice
    };
    const result = simulateDryRunSellMatch(
      { entryPrice: 95000, lotId: "DRY-1782568262334" },
      [buyDiffPrice],
      96000,
      0.00526316,
      "BTC/USD"
    );
    // Exact match by lotId, but price from DB (93000) differs from sellContext (95000)
    expect(result.matchStatus).toBe("OK");
    expect(result.entryPriceNum).toBe(93000);
    expect(result.priceMismatch).toBe(true);
    // PnL computed from DB price, not sellContext
    expect(result.pnlUsd).toBeCloseTo(15.79, 1);
  });

  // === Multiple open buys: exact lotId match picks correct one ===
  it("M-06: exact match picks correct buy among multiple open buys", () => {
    const buy1: MockBuy = {
      ...baseBuy,
      simTxid: "DRY-BUY1",
      price: "90000.00000000",
      createdAt: new Date("2025-06-22T10:00:00Z"),
    };
    const buy2: MockBuy = {
      ...baseBuy,
      simTxid: "DRY-BUY2",
      price: "95000.00000000",
      createdAt: new Date("2025-06-22T11:00:00Z"),
    };
    const result = simulateDryRunSellMatch(
      { entryPrice: 95000, lotId: "DRY-BUY2" },
      [buy1, buy2],
      96000,
      0.005,
      "BTC/USD"
    );
    expect(result.matchStatus).toBe("OK");
    expect(result.matchReason).toBe("EXACT_MATCH");
    expect(result.entryPriceNum).toBe(95000);
    expect(result.pnlUsd).toBeCloseTo(5.0, 1);
  });

  // === No open buys at all ===
  it("M-07: MISMATCH when no open buys exist (orphan sell)", () => {
    const result = simulateDryRunSellMatch(
      { entryPrice: 95000, lotId: "DRY-1782568262334" },
      [],
      96000,
      0.005,
      "BTC/USD"
    );
    expect(result.matched).toBe(false);
    expect(result.matchStatus).toBe("MISMATCH");
    expect(result.matchReason).toBe("BUY_NOT_FOUND");
    // Falls back to sellContext.entryPrice
    expect(result.entryPriceNum).toBe(95000);
  });

  // === PnL calculation correctness ===
  it("M-08: PnL is negative when sell price < entry price", () => {
    const result = simulateDryRunSellMatch(
      { entryPrice: 95000, lotId: "DRY-1782568262334" },
      [baseBuy],
      94000,
      0.00526316,
      "BTC/USD"
    );
    expect(result.pnlUsd).toBeCloseTo(-5.26, 1);
    expect(result.pnlPct).toBeCloseTo(-1.0526, 1);
  });

  // === PnL zero when sell price = entry price ===
  it("M-09: PnL is zero when sell price equals entry price", () => {
    const result = simulateDryRunSellMatch(
      { entryPrice: 95000, lotId: "DRY-1782568262334" },
      [baseBuy],
      95000,
      0.00526316,
      "BTC/USD"
    );
    expect(result.pnlUsd).toBeCloseTo(0, 5);
    expect(result.pnlPct).toBeCloseTo(0, 5);
  });

  // === Specific TXID from user: DRY-1782568262334 ===
  it("M-10: reproduces DRY-1782568262334 scenario with correct match", () => {
    const buy: MockBuy = {
      simTxid: "DRY-1782568262334",
      pair: "BTC/USD",
      type: "buy",
      status: "open",
      price: "95000.00000000",
      amount: "0.00526316",
      createdAt: new Date("2025-06-22T10:00:00Z"),
    };
    const result = simulateDryRunSellMatch(
      { entryPrice: 95000, lotId: "DRY-1782568262334" },
      [buy],
      95500,
      0.00526316,
      "BTC/USD"
    );
    expect(result.matchStatus).toBe("OK");
    expect(result.matchReason).toBe("EXACT_MATCH");
    expect(result.priceMismatch).toBe(false);
    expect(result.pnlUsd).toBeCloseTo(2.63, 1);
    expect(result.pnlPct).toBeCloseTo(0.5263, 1);
  });

  // === Specific TXID from user: DRY-1782069612018 ===
  it("M-11: reproduces DRY-1782069612018 scenario — Smart Exit without lotId causes MISMATCH", () => {
    const buy: MockBuy = {
      simTxid: "DRY-1782069612018",
      pair: "BTC/USD",
      type: "buy",
      status: "open",
      price: "94000.00000000",
      amount: "0.00531915",
      createdAt: new Date("2025-06-21T10:00:00Z"),
    };
    // Smart Exit sellContext was missing lotId before fix
    const result = simulateDryRunSellMatch(
      { entryPrice: 94000 }, // no lotId — the bug
      [buy],
      94500,
      0.00531915,
      "BTC/USD"
    );
    expect(result.matchStatus).toBe("MISMATCH");
    expect(result.matchReason).toBe("NO_LOTID_IN_SELL_CONTEXT");
    // After fix (with lotId), it would be OK:
    const fixedResult = simulateDryRunSellMatch(
      { entryPrice: 94000, lotId: "DRY-1782069612018" },
      [buy],
      94500,
      0.00531915,
      "BTC/USD"
    );
    expect(fixedResult.matchStatus).toBe("OK");
    expect(fixedResult.matchReason).toBe("EXACT_MATCH");
  });
});
