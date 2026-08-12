/**
 * SpotFeeModel — Unit Tests (FASE 5)
 *
 * Required by PLAN:
 *   SPOT_REVOLUTX_FEE_MODEL
 *   SPOT_PNL_GROSS_NET
 *   market buy/sell, maker/maker, maker/taker, gross positive net negative,
 *   partial exit, scale-out
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getTradingFeeModel,
  getSpotTakerFeePct,
  getRoundTripFeePct,
  computeFeeBreakdown,
  computePnlBreakdown,
  computePartialExitPnl,
  isValidProfitExit,
  type FeeModel,
  type FeeQuality,
} from "../spot/feeModel";

// Mock ExchangeFactory
vi.mock("../exchanges/ExchangeFactory", () => ({
  ExchangeFactory: {
    getTradingExchangeFees: vi.fn(() => ({ takerFeePct: 0.09, makerFeePct: 0.00 })),
    getTradingExchange: vi.fn(() => ({ exchangeName: "revolutx" })),
  },
}));

import { ExchangeFactory } from "../exchanges/ExchangeFactory";

const REVOLUTX_MODEL: FeeModel = {
  exchange: "revolutx",
  takerFeePct: 0.09,
  makerFeePct: 0.00,
  quality: "REAL",
};

describe("SPOT_REVOLUTX_FEE_MODEL", () => {
  beforeEach(() => {
    vi.mocked(ExchangeFactory.getTradingExchangeFees).mockReturnValue({
      takerFeePct: 0.09,
      makerFeePct: 0.00,
    });
    vi.mocked(ExchangeFactory.getTradingExchange).mockReturnValue({
      exchangeName: "revolutx",
    } as any);
  });

  it("resolves Revolut X fees from ExchangeFactory", () => {
    const model = getTradingFeeModel();
    expect(model.exchange).toBe("revolutx");
    expect(model.takerFeePct).toBe(0.09);
    expect(model.makerFeePct).toBe(0.00);
    expect(model.quality).toBe("REAL");
  });

  it("getSpotTakerFeePct returns 0.09 for Revolut X", () => {
    expect(getSpotTakerFeePct()).toBe(0.09);
  });

  it("getRoundTripFeePct returns 0.18 (2× taker)", () => {
    expect(getRoundTripFeePct()).toBe(0.18);
  });

  it("falls back to ESTIMATED Revolut X (NOT Kraken) when factory throws", () => {
    vi.mocked(ExchangeFactory.getTradingExchangeFees).mockImplementation(() => {
      throw new Error("factory unavailable");
    });
    const model = getTradingFeeModel();
    expect(model.exchange).toBe("revolutx");
    expect(model.takerFeePct).toBe(0.09);
    expect(model.makerFeePct).toBe(0.00);
    expect(model.quality).toBe("ESTIMATED");
    // CRITICAL: never returns Kraken 0.40%
    expect(model.takerFeePct).not.toBe(0.40);
  });

  it("falls back to ESTIMATED when factory returns 0 fee", () => {
    vi.mocked(ExchangeFactory.getTradingExchangeFees).mockReturnValue({
      takerFeePct: 0,
      makerFeePct: 0,
    });
    const model = getTradingFeeModel();
    expect(model.quality).toBe("ESTIMATED");
    expect(model.takerFeePct).toBe(0.09);
  });
});

describe("SPOT_PNL_GROSS_NET — market buy/sell (taker/taker)", () => {
  it("net PnL = gross - entryFee - exitFee (Revolut X 0.09%)", () => {
    // Buy 0.1 BTC at $100k, sell at $101k
    const pnl = computePnlBreakdown({
      entryPrice: 100_000,
      exitPrice: 101_000,
      volume: 0.1,
      feeModel: REVOLUTX_MODEL,
    });
    // gross = (101000 - 100000) * 0.1 = $100
    expect(pnl.grossPnlUsd).toBe(100);
    // entryFee = 100000 * 0.1 * 0.0009 = $9
    expect(pnl.entryFeeUsd).toBeCloseTo(9, 6);
    // exitFee = 101000 * 0.1 * 0.0009 = $9.09
    expect(pnl.exitFeeUsd).toBeCloseTo(9.09, 6);
    // net = 100 - 9 - 9.09 = $81.91
    expect(pnl.netPnlUsd).toBeCloseTo(81.91, 6);
    expect(pnl.netPnlUsd).toBeLessThan(pnl.grossPnlUsd);
    expect(pnl.feeQuality).toBe("ESTIMATED"); // no entryFeeUsd provided
  });

  it("with actual entry fee provided, quality = REAL", () => {
    const pnl = computePnlBreakdown({
      entryPrice: 100_000,
      exitPrice: 101_000,
      volume: 0.1,
      entryFeeUsd: 9.50, // actual fee from fill
      feeModel: REVOLUTX_MODEL,
    });
    expect(pnl.entryFeeUsd).toBe(9.50);
    expect(pnl.feeQuality).toBe("REAL");
    // net = 100 - 9.50 - 9.09 = $81.41
    expect(pnl.netPnlUsd).toBeCloseTo(81.41, 6);
  });

  it("gross positive but net negative (small win eaten by fees)", () => {
    // Buy at $100k, sell at $100.05k — gross +$5, fees ~$18
    const pnl = computePnlBreakdown({
      entryPrice: 100_000,
      exitPrice: 100_050,
      volume: 0.1,
      feeModel: REVOLUTX_MODEL,
    });
    expect(pnl.grossPnlUsd).toBe(5); // gross positive
    expect(pnl.netPnlUsd).toBeLessThan(0); // net negative
    // This is the critical case: gross winner, net loser
    expect(isValidProfitExit(pnl.netPnlUsd)).toBe(false);
  });

  it("break-even: net = 0 when gross exactly equals round-trip fees", () => {
    // Round-trip fee = 0.18% of notional = $18 for $100k notional
    // Need gross = $18 → price move = $180 on $100k
    const pnl = computePnlBreakdown({
      entryPrice: 100_000,
      exitPrice: 100_180,
      volume: 0.1,
      feeModel: REVOLUTX_MODEL,
    });
    // gross = 180 * 0.1 = $18
    // entryFee = 100000*0.1*0.0009 = $9, exitFee = 100180*0.1*0.0009 = $9.0162
    // net = 18 - 9 - 9.0162 = -$0.0162 (slightly negative due to exit fee on higher price)
    expect(pnl.grossPnlUsd).toBeCloseTo(18, 6);
    expect(pnl.netPnlUsd).toBeCloseTo(-0.0162, 4);
  });
});

describe("SPOT_PNL — maker/maker (future limit support)", () => {
  it("maker/maker: 0% fee on Revolut X", () => {
    const makerModel: FeeModel = {
      exchange: "revolutx",
      takerFeePct: 0.09,
      makerFeePct: 0.00,
      quality: "REAL",
    };
    // Simulate maker fills: entryFeeUsd=0, exitFee would be 0 if maker
    const pnl = computePnlBreakdown({
      entryPrice: 100_000,
      exitPrice: 101_000,
      volume: 0.1,
      entryFeeUsd: 0, // maker entry
      feeModel: makerModel,
    });
    // exitFee still taker (0.09%) since we don't have maker exit flag yet
    expect(pnl.entryFeeUsd).toBe(0);
    expect(pnl.exitFeeUsd).toBeCloseTo(9.09, 6);
    expect(pnl.netPnlUsd).toBeCloseTo(90.91, 6);
  });
});

describe("SPOT_PNL — partial exit (scale-out)", () => {
  it("prorates entry fee by sell ratio", () => {
    // Full position: 0.2 BTC at $100k, entryFee = $18 total
    // Sell 50% (0.1 BTC) at $101k
    const pnl = computePartialExitPnl({
      entryPrice: 100_000,
      exitPrice: 101_000,
      sellVolume: 0.1,
      positionVolume: 0.2,
      totalEntryFeeUsd: 18, // actual entry fee for full position
      feeModel: REVOLUTX_MODEL,
    });
    // gross = (101000 - 100000) * 0.1 = $100
    expect(pnl.grossPnlUsd).toBe(100);
    // proratedEntryFee = 18 * 0.5 = $9
    expect(pnl.entryFeeUsd).toBe(9);
    // exitFee = 101000 * 0.1 * 0.0009 = $9.09
    expect(pnl.exitFeeUsd).toBeCloseTo(9.09, 6);
    // net = 100 - 9 - 9.09 = $81.91
    expect(pnl.netPnlUsd).toBeCloseTo(81.91, 6);
    expect(pnl.feeQuality).toBe("REAL");
  });

  it("25% partial exit: prorates entry fee at 25%", () => {
    const pnl = computePartialExitPnl({
      entryPrice: 50_000,
      exitPrice: 51_000,
      sellVolume: 0.025,
      positionVolume: 0.1,
      totalEntryFeeUsd: 4.5,
      feeModel: REVOLUTX_MODEL,
    });
    // proratedEntryFee = 4.5 * 0.25 = $1.125
    expect(pnl.entryFeeUsd).toBeCloseTo(1.125, 6);
    // exitFee = 51000 * 0.025 * 0.0009 = $1.1475
    expect(pnl.exitFeeUsd).toBeCloseTo(1.1475, 6);
    // gross = (51000-50000) * 0.025 = $25
    expect(pnl.grossPnlUsd).toBe(25);
    // net = 25 - 1.125 - 1.1475 = $22.7275
    expect(pnl.netPnlUsd).toBeCloseTo(22.7275, 4);
  });
});

describe("SPOT_PNL — execution cost (slippage)", () => {
  it("includes execution cost in net PnL", () => {
    const pnl = computePnlBreakdown({
      entryPrice: 100_000,
      exitPrice: 101_000,
      volume: 0.1,
      executionCostUsd: 5.0, // $5 slippage
      feeModel: REVOLUTX_MODEL,
    });
    // net = 100 - 9 - 9.09 - 5 = $76.91
    expect(pnl.executionCostUsd).toBe(5);
    expect(pnl.netPnlUsd).toBeCloseTo(76.91, 6);
  });

  it("execution cost defaults to 0 for perfect fills", () => {
    const pnl = computePnlBreakdown({
      entryPrice: 100_000,
      exitPrice: 101_000,
      volume: 0.1,
      feeModel: REVOLUTX_MODEL,
    });
    expect(pnl.executionCostUsd).toBe(0);
  });
});

describe("SPOT_PNL — isValidProfitExit", () => {
  it("returns true when netPnl > 0", () => {
    expect(isValidProfitExit(10)).toBe(true);
    expect(isValidProfitExit(0.01)).toBe(true);
  });

  it("returns false when netPnl <= 0", () => {
    expect(isValidProfitExit(0)).toBe(false);
    expect(isValidProfitExit(-1)).toBe(false);
  });
});

describe("SPOT_PNL — fee breakdown", () => {
  it("computeFeeBreakdown returns round-trip fees", () => {
    const fb = computeFeeBreakdown(100_000, 101_000, 0.1, REVOLUTX_MODEL);
    expect(fb.entryFeeUsd).toBeCloseTo(9, 6);
    expect(fb.exitFeeUsd).toBeCloseTo(9.09, 6);
    expect(fb.totalFeeUsd).toBeCloseTo(18.09, 6);
    expect(fb.roundTripFeePct).toBe(0.18);
    expect(fb.quality).toBe("REAL");
  });
});
