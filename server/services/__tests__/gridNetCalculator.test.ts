import { describe, it, expect } from "vitest";
import {
  computeGrossTargetFromNet,
  computeSellPrice,
  computeCyclePnL,
  cycleMeetsNetTarget,
  computeBreakEvenSellPrice,
} from "../gridIsolated/gridNetCalculator";
import {
  FEE_BUFFER_BUY_PCT,
  FEE_BUFFER_SELL_PCT,
  TAX_RESERVE_PCT,
} from "../gridIsolated/gridIsolatedTypes";

describe("GridNetCalculator — computeGrossTargetFromNet", () => {
  it("returns correct breakdown for 0.5% net target", () => {
    const result = computeGrossTargetFromNet(0.5);
    expect(result.netProfitTargetPct).toBe(0.5);
    expect(result.buyFeePct).toBe(FEE_BUFFER_BUY_PCT);
    expect(result.sellFeePct).toBe(FEE_BUFFER_SELL_PCT);
    expect(result.grossTargetPct).toBeGreaterThan(0.5);
  });

  it("gross target includes fees and tax reserve", () => {
    const result = computeGrossTargetFromNet(1.0);
    // netBeforeTax = 1.0 / (1 - 0.20) = 1.25
    // grossTarget = 1.25 + 0.09 + 0.09 = 1.43
    expect(result.grossTargetPct).toBeCloseTo(1.43, 2);
    expect(result.taxReservePct).toBeCloseTo(0.25, 2);
  });

  it("higher net target produces higher gross target", () => {
    const low = computeGrossTargetFromNet(0.3);
    const high = computeGrossTargetFromNet(2.0);
    expect(high.grossTargetPct).toBeGreaterThan(low.grossTargetPct);
  });

  it("zero net target still has fees", () => {
    const result = computeGrossTargetFromNet(0);
    expect(result.grossTargetPct).toBeCloseTo(FEE_BUFFER_BUY_PCT + FEE_BUFFER_SELL_PCT, 2);
    expect(result.taxReservePct).toBe(0);
  });
});

describe("GridNetCalculator — computeSellPrice", () => {
  it("computes sell price above buy price", () => {
    const buyPrice = 100000;
    const sellPrice = computeSellPrice(buyPrice, 0.5);
    expect(sellPrice).toBeGreaterThan(buyPrice);
    // netBeforeTax = 0.5 / (1 - 0.20) = 0.625
    // grossTarget = 0.625 + 0.09 + 0.09 = 0.805
    const gapPct = ((sellPrice - buyPrice) / buyPrice) * 100;
    expect(gapPct).toBeCloseTo(0.805, 2);
  });

  it("higher target produces higher sell price", () => {
    const buyPrice = 50000;
    const low = computeSellPrice(buyPrice, 0.3);
    const high = computeSellPrice(buyPrice, 1.5);
    expect(high).toBeGreaterThan(low);
  });
});

describe("GridNetCalculator — computeCyclePnL", () => {
  it("computes positive PnL for profitable cycle", () => {
    const pnl = computeCyclePnL(100000, 101000, 0.01);
    // gross = (101000 - 100000) * 0.01 = 10
    expect(pnl.grossPnlUsd).toBeCloseTo(10.0, 2);
    expect(pnl.buyFeeUsd).toBeGreaterThan(0);
    expect(pnl.sellFeeUsd).toBeGreaterThan(0);
    expect(pnl.totalFeesUsd).toBeCloseTo(pnl.buyFeeUsd + pnl.sellFeeUsd, 6);
    expect(pnl.netPnlUsd).toBeGreaterThan(0);
    expect(pnl.taxReserveUsd).toBeGreaterThan(0);
  });

  it("tax reserve is 20% of net before tax when positive", () => {
    const pnl = computeCyclePnL(100000, 102000, 0.01);
    const expectedTax = pnl.netBeforeTaxUsd * (TAX_RESERVE_PCT / 100);
    expect(pnl.taxReserveUsd).toBeCloseTo(expectedTax, 6);
  });

  it("tax reserve is 0 when net before tax is negative", () => {
    const pnl = computeCyclePnL(100000, 99000, 0.01);
    expect(pnl.netBeforeTaxUsd).toBeLessThan(0);
    expect(pnl.taxReserveUsd).toBe(0);
  });

  it("maker fees are 0 when not using taker", () => {
    const pnl = computeCyclePnL(100000, 101000, 0.01, 0.00, 0.09, false, false);
    expect(pnl.buyFeeUsd).toBe(0);
    expect(pnl.sellFeeUsd).toBe(0);
    expect(pnl.totalFeesUsd).toBe(0);
  });

  it("actualPriceGapPct matches sell-buy gap", () => {
    const pnl = computeCyclePnL(100000, 101500, 0.01);
    expect(pnl.actualPriceGapPct).toBeCloseTo(1.5, 4);
  });

  it("netPnlPct is net PnL as % of buy notional", () => {
    const pnl = computeCyclePnL(100000, 101000, 0.01);
    const buyNotional = 100000 * 0.01;
    expect(pnl.netPnlPct).toBeCloseTo((pnl.netPnlUsd / buyNotional) * 100, 4);
  });
});

describe("GridNetCalculator — cycleMeetsNetTarget", () => {
  it("returns true when net PnL meets target", () => {
    const pnl = computeCyclePnL(100000, 102000, 0.01);
    expect(cycleMeetsNetTarget(pnl, 0.5)).toBe(true);
  });

  it("returns false when net PnL below target", () => {
    const pnl = computeCyclePnL(100000, 100100, 0.01);
    expect(cycleMeetsNetTarget(pnl, 0.5)).toBe(false);
  });
});

describe("GridNetCalculator — computeBreakEvenSellPrice", () => {
  it("computes break-even price above buy price", () => {
    const buyPrice = 100000;
    const qty = 0.01;
    const bePrice = computeBreakEvenSellPrice(buyPrice, qty);
    expect(bePrice).toBeGreaterThan(buyPrice);

    // Verify: at break-even, net PnL should be ~0
    const pnl = computeCyclePnL(buyPrice, bePrice, qty);
    expect(Math.abs(pnl.netPnlUsd)).toBeLessThan(0.01);
  });

  it("break-even price increases with higher fees", () => {
    const buyPrice = 50000;
    const qty = 0.1;
    const lowFee = computeBreakEvenSellPrice(buyPrice, qty, 0.05);
    const highFee = computeBreakEvenSellPrice(buyPrice, qty, 0.20);
    expect(highFee).toBeGreaterThan(lowFee);
  });
});
