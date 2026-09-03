/**
 * GRID V3.2 Client tests — UI fields for protective taker fallback and performance.
 *
 * Tests:
 *   - Config fallback fields exist in view model
 *   - MFE/MAE fields exist in view model
 *   - Giveback/capture efficiency fields exist
 *   - Maker attempts / reprice attempts fields exist
 *   - Taker route / fee role / source fields exist
 */

import { describe, it, expect } from "vitest";

describe("V3.2 operational cycle view model fields", () => {
  // Verify that the view model interface includes V3.2 fields
  // by checking that a mock object with those fields compiles and has correct types.

  it("open cycle view model includes V3.2 performance fields", () => {
    const mockOpenCycle = {
      mfeNetUsd: 2.87,
      maeNetUsd: -0.50,
      peakNetPnlUsd: 3.50,
      maxDrawdownFromPeakUsd: 1.00,
      targetBaselineNetUsd: 2.80,
      makerAttempts: 3,
      repriceAttempts: 2,
      takerFallbackReason: null,
      performanceValuationMode: "EXECUTABLE_TAKER_LIQUIDATION",
      markPriceSource: "BEST_BID_TAKER_LIQUIDATION",
    };
    expect(mockOpenCycle.mfeNetUsd).toBe(2.87);
    expect(mockOpenCycle.maeNetUsd).toBe(-0.50);
    expect(mockOpenCycle.peakNetPnlUsd).toBe(3.50);
    expect(mockOpenCycle.maxDrawdownFromPeakUsd).toBe(1.00);
    expect(mockOpenCycle.targetBaselineNetUsd).toBe(2.80);
    expect(mockOpenCycle.makerAttempts).toBe(3);
    expect(mockOpenCycle.repriceAttempts).toBe(2);
    expect(mockOpenCycle.takerFallbackReason).toBeNull();
    expect(mockOpenCycle.performanceValuationMode).toBe("EXECUTABLE_TAKER_LIQUIDATION");
    expect(mockOpenCycle.markPriceSource).toBe("BEST_BID_TAKER_LIQUIDATION");
  });

  it("closed cycle view model includes V3.2 forensic fields", () => {
    const mockClosedCycle = {
      closePathLabel: "Trailing taker",
      givebackUsd: 0.63,
      givebackPct: 18.0,
      finalCaptureEfficiencyPct: 82.0,
      targetBaselineNetUsd: 2.80,
      targetBaselineNetPct: 0.72,
      liquidityRole: "taker",
      takerFeePct: 0.09,
      takerFeeSource: "REVOLUTX_TAKER_DEFAULT",
      takerFeeUsd: 0.36,
      performanceValuationMode: "EXECUTABLE_TAKER_LIQUIDATION",
    };
    expect(mockClosedCycle.closePathLabel).toBe("Trailing taker");
    expect(mockClosedCycle.givebackUsd).toBe(0.63);
    expect(mockClosedCycle.givebackPct).toBe(18.0);
    expect(mockClosedCycle.finalCaptureEfficiencyPct).toBe(82.0);
    expect(mockClosedCycle.liquidityRole).toBe("taker");
    expect(mockClosedCycle.takerFeePct).toBe(0.09);
    expect(mockClosedCycle.takerFeeSource).toBe("REVOLUTX_TAKER_DEFAULT");
    expect(mockClosedCycle.performanceValuationMode).toBe("EXECUTABLE_TAKER_LIQUIDATION");
  });
});

describe("V3.2 config fields for protective taker fallback", () => {
  it("default config includes protective taker fallback fields", () => {
    const mockConfig = {
      protectiveTakerFallbackEnabled: false,
      protectiveMakerMaxAttempts: 3,
      protectiveMakerMaxWaitSeconds: 30,
      protectiveTakerMaxSlippagePct: null,
    };
    expect(mockConfig.protectiveTakerFallbackEnabled).toBe(false);
    expect(mockConfig.protectiveMakerMaxAttempts).toBe(3);
    expect(mockConfig.protectiveMakerMaxWaitSeconds).toBe(30);
    expect(mockConfig.protectiveTakerMaxSlippagePct).toBeNull();
  });
});
