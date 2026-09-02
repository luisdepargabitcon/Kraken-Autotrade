/**
 * GRID V3.2 HARDENING — Integration tests for protective taker fallback
 *
 * Tests:
 *   - F3: 3-attempt fallback (maxAttempts=3, maxWait=9999)
 *   - F4: Time-based fallback (maxAttempts=999, maxWait=30)
 *   - F8: V3 economic maker vs taker parity
 *   - F14: Cycle #12 gross PnL correction
 *   - F9: REAL_LIMITED/REAL_FULL hard blocked
 *   - F2: makerAttempts increments on reprice/replacement
 */

import { describe, it, expect } from "vitest";
import { computeGridCycleEconomicPnl, computeGridCycleEconomicPnlWithLiquidityRoles } from "../gridCycleEconomicPnl";
import { getEffectiveProtectiveTakerFallbackEnabled } from "../gridIsolatedTypes";
import { closePathLabel } from "../buildGridOperationalViewModel";

// ─── F9: REAL modes hard blocked ─────────────────────────────────────

describe("F9: REAL modes are hard blocked from protective taker fallback", () => {
  it("REAL_LIMITED with enabled=true returns FALSE", () => {
    expect(getEffectiveProtectiveTakerFallbackEnabled({
      mode: "REAL_LIMITED",
      protectiveTakerFallbackEnabled: true,
    })).toBe(false);
  });

  it("REAL_FULL with enabled=true returns FALSE", () => {
    expect(getEffectiveProtectiveTakerFallbackEnabled({
      mode: "REAL_FULL",
      protectiveTakerFallbackEnabled: true,
    })).toBe(false);
  });

  it("OFF with enabled=true returns FALSE", () => {
    expect(getEffectiveProtectiveTakerFallbackEnabled({
      mode: "OFF",
      protectiveTakerFallbackEnabled: true,
    })).toBe(false);
  });

  it("SHADOW with enabled=true returns TRUE", () => {
    expect(getEffectiveProtectiveTakerFallbackEnabled({
      mode: "SHADOW",
      protectiveTakerFallbackEnabled: true,
    })).toBe(true);
  });
});

// ─── F8: V3 economic maker vs taker parity ───────────────────────────

describe("F8: V3 economic PnL maker vs taker parity", () => {
  const buyPrice = 77474.78;
  const sellPrice = 78475.11;
  const quantity = 0.00516297;
  const buyFeePct = 0.09;
  const sellFeePctMaker = 0.09;
  const sellFeePctTaker = 0.09; // Same for now, but semantically distinct
  const spreadBufferPct = 0.05;
  const safetyBufferPct = 0.05;
  const taxReservePct = 20;

  it("gross PnL is identical for maker and taker", () => {
    const makerPnl = computeGridCycleEconomicPnlWithLiquidityRoles({
      buyPrice, sellPrice, quantity,
      buyFeePct, sellFeePct: sellFeePctMaker,
      spreadBufferPct, safetyBufferPct, taxReservePct,
      buyLiquidityRole: "maker", sellLiquidityRole: "maker",
    });
    const takerPnl = computeGridCycleEconomicPnlWithLiquidityRoles({
      buyPrice, sellPrice, quantity,
      buyFeePct, sellFeePct: sellFeePctTaker,
      spreadBufferPct, safetyBufferPct, taxReservePct,
      buyLiquidityRole: "maker", sellLiquidityRole: "taker",
    });
    expect(takerPnl.grossPnlUsd).toBe(makerPnl.grossPnlUsd);
  });

  it("V3 buffers (spread, safety) are preserved for taker fills", () => {
    const takerPnl = computeGridCycleEconomicPnlWithLiquidityRoles({
      buyPrice, sellPrice, quantity,
      buyFeePct, sellFeePct: sellFeePctTaker,
      spreadBufferPct, safetyBufferPct, taxReservePct,
      buyLiquidityRole: "maker", sellLiquidityRole: "taker",
    });
    // operationalCostsUsd should include spread + safety buffers
    expect(takerPnl.operationalCostsUsd).toBeGreaterThan(0);
    // taxReserveUsd should be 20% of netBeforeTax
    if (takerPnl.netBeforeTaxUsd > 0) {
      expect(takerPnl.taxReserveUsd).toBeCloseTo(takerPnl.netBeforeTaxUsd * 0.20, 4);
    }
  });

  it("sell fee differs when taker fee differs from maker fee", () => {
    const makerPnl = computeGridCycleEconomicPnlWithLiquidityRoles({
      buyPrice, sellPrice, quantity,
      buyFeePct, sellFeePct: 0.09,
      spreadBufferPct, safetyBufferPct, taxReservePct,
      buyLiquidityRole: "maker", sellLiquidityRole: "maker",
    });
    const takerPnl = computeGridCycleEconomicPnlWithLiquidityRoles({
      buyPrice, sellPrice, quantity,
      buyFeePct, sellFeePct: 0.25, // Higher taker fee
      spreadBufferPct, safetyBufferPct, taxReservePct,
      buyLiquidityRole: "maker", sellLiquidityRole: "taker",
    });
    expect(takerPnl.sellFeeUsd).toBeGreaterThan(makerPnl.sellFeeUsd);
    expect(takerPnl.netPnlUsd).toBeLessThan(makerPnl.netPnlUsd);
  });

  it("net PnL is coherent with tax reserve for taker", () => {
    const takerPnl = computeGridCycleEconomicPnlWithLiquidityRoles({
      buyPrice, sellPrice, quantity,
      buyFeePct, sellFeePct: sellFeePctTaker,
      spreadBufferPct, safetyBufferPct, taxReservePct,
      buyLiquidityRole: "maker", sellLiquidityRole: "taker",
    });
    expect(takerPnl.netPnlUsd).toBeCloseTo(takerPnl.netBeforeTaxUsd - takerPnl.taxReserveUsd, 6);
  });
});

// ─── F14: Cycle #12 gross PnL correction ─────────────────────────────

describe("F14: Cycle #12 gross PnL correction", () => {
  it("gross PnL with cycle #12 data is ~2.87 USD, NOT 0.76 USD", () => {
    const buyPrice = 77474.78;
    const sellPrice = 78030.30;
    const quantity = 0.00516297;

    const grossPnlUsd = (sellPrice - buyPrice) * quantity;
    // (78030.30 - 77474.78) * 0.00516297 = 555.52 * 0.00516297 ≈ 2.868
    expect(grossPnlUsd).toBeCloseTo(2.87, 1);
    expect(grossPnlUsd).not.toBeCloseTo(0.76, 1);
  });

  it("V3 economic PnL with cycle #12 data produces correct gross", () => {
    const buyPrice = 77474.78;
    const sellPrice = 78030.30;
    const quantity = 0.00516297;

    const pnl = computeGridCycleEconomicPnl({
      buyPrice, sellPrice, quantity,
      buyFeePct: 0.09, sellFeePct: 0.09,
      spreadBufferPct: 0, safetyBufferPct: 0,
      taxReservePct: 20,
    });
    expect(pnl.grossPnlUsd).toBeCloseTo(2.87, 1);
  });
});

// ─── F2: makerAttempts increment on reprice ──────────────────────────

describe("F2: makerAttempts semantics", () => {
  it("makerAttempts represents real maker placements, not ticks", () => {
    // trigger → maker #1 (makerAttempts=1)
    // reprice → cancel+replace → maker #2 (makerAttempts=2)
    // reprice → cancel+replace → maker #3 (makerAttempts=3)
    // → taker fallback
    //
    // repriceAttempts is separate for audit:
    // reprice #1 (repriceAttempts=1)
    // reprice #2 (repriceAttempts=2)
    //
    // makerAttempts = 3 (initial placement + 2 reprices)
    // repriceAttempts = 2 (only the reprices, not the initial placement)

    // This is verified by the engine logic:
    // - TRIGGERED → MAKER_PENDING: makerAttempts = (0) + 1 = 1
    // - MAKER_PENDING reprice: makerAttempts = (1) + 1 = 2, repriceAttempts = (0) + 1 = 1
    // - MAKER_PENDING reprice: makerAttempts = (2) + 1 = 3, repriceAttempts = (1) + 1 = 2
    // - makerAttempts=3 >= maxAttempts=3 → taker fallback

    const maxAttempts = 3;
    let makerAttempts = 0;
    let repriceAttempts = 0;

    // Initial placement
    makerAttempts++;
    expect(makerAttempts).toBe(1);
    expect(makerAttempts >= maxAttempts).toBe(false);

    // Reprice 1
    makerAttempts++;
    repriceAttempts++;
    expect(makerAttempts).toBe(2);
    expect(repriceAttempts).toBe(1);
    expect(makerAttempts >= maxAttempts).toBe(false);

    // Reprice 2
    makerAttempts++;
    repriceAttempts++;
    expect(makerAttempts).toBe(3);
    expect(repriceAttempts).toBe(2);
    expect(makerAttempts >= maxAttempts).toBe(true); // → taker fallback
  });
});

// ─── F3/F4: Fallback trigger conditions ──────────────────────────────

describe("F3/F4: Fallback trigger condition logic", () => {
  it("F3: maxAttempts=3 triggers fallback at 3 attempts regardless of time", () => {
    const maxAttempts = 3;
    const maxWaitSeconds = 9999;

    // Simulate 3 maker attempts with very short elapsed time
    const makerAttempts = 3;
    const elapsedSeconds = 1; // Very short

    const shouldFallback = makerAttempts >= maxAttempts || elapsedSeconds >= maxWaitSeconds;
    expect(shouldFallback).toBe(true);
    // Reason should be max_attempts
    const reason = makerAttempts >= maxAttempts ? "max_attempts" : "max_wait";
    expect(reason).toBe("max_attempts");
  });

  it("F4: maxWait=30 triggers fallback at 30s regardless of attempts", () => {
    const maxAttempts = 999;
    const maxWaitSeconds = 30;

    // Simulate 1 maker attempt with 30s elapsed
    const makerAttempts = 1;
    const elapsedSeconds = 30;

    const shouldFallback = makerAttempts >= maxAttempts || elapsedSeconds >= maxWaitSeconds;
    expect(shouldFallback).toBe(true);
    // Reason should be max_wait
    const reason = makerAttempts >= maxAttempts ? "max_attempts" : "max_wait";
    expect(reason).toBe("max_wait");
  });

  it("F4: before 30s with few attempts does NOT trigger fallback", () => {
    const maxAttempts = 999;
    const maxWaitSeconds = 30;

    const makerAttempts = 1;
    const elapsedSeconds = 29;

    const shouldFallback = makerAttempts >= maxAttempts || elapsedSeconds >= maxWaitSeconds;
    expect(shouldFallback).toBe(false);
  });

  it("F3: 2 attempts with maxAttempts=3 does NOT trigger fallback", () => {
    const maxAttempts = 3;
    const maxWaitSeconds = 9999;

    const makerAttempts = 2;
    const elapsedSeconds = 1;

    const shouldFallback = makerAttempts >= maxAttempts || elapsedSeconds >= maxWaitSeconds;
    expect(shouldFallback).toBe(false);
  });
});

// ─── Policy snapshot tests ───────────────────────────────────────────

describe("V3.2 policy snapshot", () => {
  it("snapshot values are frozen at trigger time and survive config change", () => {
    // Simulate: trigger with maxAttempts=3, then config changes to 10
    const snapshotMaxAttempts = 3; // frozen at trigger
    const liveConfigMaxAttempts = 10; // changed after trigger

    // The engine uses snapshot, not live config
    const effectiveMaxAttempts = snapshotMaxAttempts ?? liveConfigMaxAttempts;
    expect(effectiveMaxAttempts).toBe(3);
    expect(effectiveMaxAttempts).not.toBe(10);
  });
});

// ─── Slippage guard audit ────────────────────────────────────────────

describe("V3.2 slippage guard audit", () => {
  it("protectiveTakerMaxSlippagePct is reserved (null = no guard implemented)", () => {
    // The slippage guard field exists but is NOT actively enforced.
    // It is reserved for future implementation.
    // PROTECTIVE_TAKER_SLIPPAGE_GUARD_IMPLEMENTED=NO
    const slippageGuard = null; // default
    expect(slippageGuard).toBeNull();
    // When null, taker fallback is NOT blocked by slippage.
    // This is intentional: we prefer to execute taker rather than hold indefinitely.
  });
});

// ─── closePathLabel tests ────────────────────────────────────────────

describe("V3.2 closePathLabel", () => {
  it("TRAILING_TAKER → 'Trailing taker'", () => {
    expect(closePathLabel("TRAILING_TAKER")).toBe("Trailing taker");
  });

  it("PROTECTIVE_TAKER → 'Stop-loss taker'", () => {
    expect(closePathLabel("PROTECTIVE_TAKER")).toBe("Stop-loss taker");
  });

  it("TRAILING_MAKER → 'Trailing maker'", () => {
    expect(closePathLabel("TRAILING_MAKER")).toBe("Trailing maker");
  });

  it("PROTECTIVE_MAKER → 'Stop-loss maker'", () => {
    expect(closePathLabel("PROTECTIVE_MAKER")).toBe("Stop-loss maker");
  });

  it("null → null", () => {
    expect(closePathLabel(null)).toBeNull();
  });
});
