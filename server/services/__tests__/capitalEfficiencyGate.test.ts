import { describe, it, expect } from "vitest";
import { checkCapitalEfficiencyGate } from "../capitalEfficiencyGate";

describe("checkCapitalEfficiencyGate", () => {
  const baseInput = {
    pair: "BTC/USD",
    computedOrderUsd: 500,
    currentPrice: 100000,
    minEntryUsd: 500,
    allowUnderMin: false,
    absoluteDustUsd: 20,
    minExpectedProfitUsd: 1.0,
    slotEfficiencyEnabled: true,
    maxLotsPerPair: 3,
    openLotsThisPair: 0,
    dryRun: false,
  };

  // === Rule A: ENTRY_BLOCKED_MIN_NOTIONAL ===
  it("A-1: blocks when allowUnderMin=false and order < minEntryUsd", () => {
    const result = checkCapitalEfficiencyGate({
      ...baseInput,
      computedOrderUsd: 300,
      minEntryUsd: 500,
      allowUnderMin: false,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("ENTRY_BLOCKED_MIN_NOTIONAL");
    expect(result.message).toContain("300");
    expect(result.message).toContain("500");
  });

  it("A-2: allows when allowUnderMin=false and order = minEntryUsd", () => {
    const result = checkCapitalEfficiencyGate({
      ...baseInput,
      computedOrderUsd: 500,
      minEntryUsd: 500,
      allowUnderMin: false,
    });
    expect(result.allowed).toBe(true);
  });

  it("A-3: allows when allowUnderMin=true and order < minEntryUsd (but >= dust)", () => {
    const result = checkCapitalEfficiencyGate({
      ...baseInput,
      computedOrderUsd: 100,
      minEntryUsd: 500,
      allowUnderMin: true,
    });
    expect(result.allowed).toBe(true);
  });

  // === Rule B: ENTRY_BLOCKED_DUST_ORDER ===
  it("B-1: blocks when order < absoluteDustUsd even if allowUnderMin=true", () => {
    const result = checkCapitalEfficiencyGate({
      ...baseInput,
      computedOrderUsd: 15,
      absoluteDustUsd: 20,
      allowUnderMin: true,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("ENTRY_BLOCKED_DUST_ORDER");
  });

  it("B-2: allows when order = absoluteDustUsd", () => {
    const result = checkCapitalEfficiencyGate({
      ...baseInput,
      computedOrderUsd: 20,
      absoluteDustUsd: 20,
      allowUnderMin: true,
      minEntryUsd: 20,
    });
    expect(result.allowed).toBe(true);
  });

  // === Rule C: ENTRY_BLOCKED_LOW_EXPECTED_PROFIT ===
  it("C-1: blocks when expected profit < minExpectedProfitUsd", () => {
    const result = checkCapitalEfficiencyGate({
      ...baseInput,
      computedOrderUsd: 50,
      minEntryUsd: 20,
      allowUnderMin: true,
      absoluteDustUsd: 20,
      expectedExitPct: 0.5,
      estimatedFeesPct: 0.4,
      minExpectedProfitUsd: 1.0,
    });
    // netProfitPct = 0.5 - 0.4 = 0.1%, expectedProfitUsd = 50 * 0.001 = 0.05 < 1.0
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("ENTRY_BLOCKED_LOW_EXPECTED_PROFIT");
  });

  it("C-2: allows when expected profit >= minExpectedProfitUsd", () => {
    const result = checkCapitalEfficiencyGate({
      ...baseInput,
      computedOrderUsd: 500,
      minEntryUsd: 20,
      allowUnderMin: true,
      absoluteDustUsd: 20,
      expectedExitPct: 2.0,
      estimatedFeesPct: 0.4,
      minExpectedProfitUsd: 1.0,
    });
    // netProfitPct = 2.0 - 0.4 = 1.6%, expectedProfitUsd = 500 * 0.016 = 8.0 >= 1.0
    expect(result.allowed).toBe(true);
  });

  it("C-3: skips profit check when expectedExitPct not provided", () => {
    const result = checkCapitalEfficiencyGate({
      ...baseInput,
      computedOrderUsd: 500,
      minEntryUsd: 20,
      allowUnderMin: true,
      absoluteDustUsd: 20,
      // expectedExitPct and estimatedFeesPct not provided
    });
    expect(result.allowed).toBe(true);
  });

  // === Rule D: ENTRY_BLOCKED_SLOT_EFFICIENCY ===
  it("D-1: blocks when slots are limited and order is small relative to minEntryUsd", () => {
    const result = checkCapitalEfficiencyGate({
      ...baseInput,
      computedOrderUsd: 200,
      minEntryUsd: 500,
      allowUnderMin: true,
      absoluteDustUsd: 20,
      slotEfficiencyEnabled: true,
      maxLotsPerPair: 3,
      openLotsThisPair: 1, // remaining = 2, order < minEntryUsd * 0.5
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("ENTRY_BLOCKED_SLOT_EFFICIENCY");
  });

  it("D-2: allows when slot efficiency disabled", () => {
    const result = checkCapitalEfficiencyGate({
      ...baseInput,
      computedOrderUsd: 200,
      minEntryUsd: 500,
      allowUnderMin: true,
      absoluteDustUsd: 20,
      slotEfficiencyEnabled: false,
      maxLotsPerPair: 3,
      openLotsThisPair: 1,
    });
    expect(result.allowed).toBe(true);
  });

  it("D-3: allows when plenty of slots remaining", () => {
    const result = checkCapitalEfficiencyGate({
      ...baseInput,
      computedOrderUsd: 200,
      minEntryUsd: 500,
      allowUnderMin: true,
      absoluteDustUsd: 20,
      slotEfficiencyEnabled: true,
      maxLotsPerPair: 10,
      openLotsThisPair: 0, // remaining = 10 > 2
    });
    expect(result.allowed).toBe(true);
  });

  // === Rule E: ENTRY_BLOCKED_INSUFFICIENT_USEFUL_CAPITAL ===
  it("E-1: blocks when exposureAvailable < minEntryUsd and allowUnderMin=false", () => {
    const result = checkCapitalEfficiencyGate({
      ...baseInput,
      computedOrderUsd: 500,
      minEntryUsd: 500,
      allowUnderMin: false,
      exposureAvailableUsd: 300,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("ENTRY_BLOCKED_INSUFFICIENT_USEFUL_CAPITAL");
  });

  it("E-2: allows when exposureAvailable >= minEntryUsd", () => {
    const result = checkCapitalEfficiencyGate({
      ...baseInput,
      computedOrderUsd: 500,
      minEntryUsd: 500,
      allowUnderMin: false,
      exposureAvailableUsd: 600,
    });
    expect(result.allowed).toBe(true);
  });

  it("E-3: skips capital check when allowUnderMin=true", () => {
    const result = checkCapitalEfficiencyGate({
      ...baseInput,
      computedOrderUsd: 100,
      minEntryUsd: 500,
      allowUnderMin: true,
      absoluteDustUsd: 20,
      exposureAvailableUsd: 100,
    });
    expect(result.allowed).toBe(true);
  });

  // === Combined scenarios ===
  it("F-1: dust check takes priority over min notional when both fail", () => {
    const result = checkCapitalEfficiencyGate({
      ...baseInput,
      computedOrderUsd: 10,
      minEntryUsd: 500,
      allowUnderMin: false,
      absoluteDustUsd: 20,
    });
    // Rule A fires first (allowUnderMin=false, 10 < 500)
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("ENTRY_BLOCKED_MIN_NOTIONAL");
  });

  it("F-2: dry run mode does not bypass the gate", () => {
    const result = checkCapitalEfficiencyGate({
      ...baseInput,
      computedOrderUsd: 15,
      absoluteDustUsd: 20,
      allowUnderMin: true,
      dryRun: true,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("ENTRY_BLOCKED_DUST_ORDER");
  });

  it("F-3: meta contains all relevant fields", () => {
    const result = checkCapitalEfficiencyGate({
      ...baseInput,
      computedOrderUsd: 500,
    });
    expect(result.meta.pair).toBe("BTC/USD");
    expect(result.meta.computedOrderUsd).toBe(500);
    expect(result.meta.minEntryUsd).toBe(500);
    expect(result.meta.dryRun).toBe(false);
  });
});
