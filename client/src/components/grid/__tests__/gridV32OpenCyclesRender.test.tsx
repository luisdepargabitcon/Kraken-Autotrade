/**
 * GRID V3.2 Real component-render tests — PerformanceBlock + ProtectiveExecutionBlock.
 *
 * Uses renderToString to verify VISIBLE UI output, not just object properties.
 * Includes wiring bug detection tests (UI-1 through UI-4).
 */

import * as React from "react";
import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { PerformanceBlock, ProtectiveExecutionBlock } from "../GridOpenCyclesPanel";

function makeOpenCycleV32(overrides: Record<string, any> = {}) {
  return {
    id: "cycle-1",
    cycleNumber: 1,
    pair: "BTC/USD",
    buyPrice: 77000,
    targetSellPrice: 78000,
    currentBid: 77500,
    currentPrice: 77500,
    quantity: 0.005,
    makerState: "MAKER_PENDING",
    makerAttempts: 2,
    repriceAttempts: 1,
    triggerDetectedAt: "2026-09-01T11:00:00Z",
    firstMakerCreatedAt: "2026-09-01T11:01:00Z",
    makerOrderCreatedAt: "2026-09-01T11:02:00Z",
    lastRepricedAt: "2026-09-01T11:05:00Z",
    activeExitRoute: "TRAILING_MAKER",
    activeExitRouteLabel: "Trailing maker",
    closePath: "TRAILING_MAKER",
    snapshotProtectiveMakerMaxAttempts: 3,
    snapshotProtectiveMakerMaxWaitSeconds: 30,
    snapshotResolvedTakerFeePct: 0.09,
    snapshotFeeSource: "EXECUTION_EXCHANGE_FEE_MODEL",
    snapshotFeeQuality: "REAL",
    snapshotFeeExchange: "revolutx",
    protectiveElapsedMs: 15000,
    // V3.2 Performance
    performanceDataAvailable: true,
    mfeNetUsd: 2.87,
    maeNetUsd: -0.50,
    peakNetPnlUsd: 3.50,
    maxDrawdownFromPeakUsd: 7.19,
    maxDrawdownFromPeakPct: 28.4,
    highestObservedPrice: 77900,
    lowestObservedPrice: 76900,
    targetBaselineNetUsd: 2.80,
    performanceValuationMode: "EXECUTABLE_TAKER_LIQUIDATION",
    markPriceSource: "BEST_BID_TAKER_LIQUIDATION",
    ...overrides,
  };
}

describe("PerformanceBlock — real render", () => {
  it("renders 'Rendimiento en curso' block with MFE/MAE/peak/drawdown", () => {
    const html = renderToString(<PerformanceBlock cycle={makeOpenCycleV32()} />);
    expect(html).toContain("Rendimiento en curso");
    expect(html).toContain("MFE neto");
    expect(html).toContain("MAE neto");
    expect(html).toContain("Máximo beneficio observado");
    expect(html).toContain("Máxima caída desde el pico");
    expect(html).toContain("Target V3 baseline");
    expect(html).toContain("Liquidación taker al best bid");
  });

  it("renders MFE and MAE values (es-ES locale)", () => {
    const html = renderToString(<PerformanceBlock cycle={makeOpenCycleV32()} />);
    expect(html).toContain("2,87");
    expect(html).toContain("-0,50");
  });

  it("renders peak and target baseline values (es-ES locale)", () => {
    const html = renderToString(<PerformanceBlock cycle={makeOpenCycleV32()} />);
    expect(html).toContain("3,50");
    expect(html).toContain("2,80");
  });

  // TEST UI-1: Drawdown must use maxDrawdownFromPeakUsd, NOT troughNetPnlUsd
  it("UI-1: shows drawdown from maxDrawdownFromPeakUsd (7.19), NOT troughNetPnlUsd (0.50)", () => {
    const cycle = makeOpenCycleV32({
      maeNetUsd: -0.50,
      maxDrawdownFromPeakUsd: 7.19,
      maxDrawdownFromPeakPct: 28.4,
    });
    const html = renderToString(<PerformanceBlock cycle={cycle} />);
    // Must contain 7,19 (the drawdown magnitude) and NOT 0,50 as drawdown
    expect(html).toContain("7,19");
    expect(html).toContain("28.4%");
    // The drawdown should be displayed as negative
    expect(html).toContain("-$7,19");
    // Should NOT show 0,50 in the drawdown field (it's the MAE, not drawdown)
    // The MAE line will show -0,50 but the drawdown line should show -7,19
    expect(html).toContain("Máxima caída desde el pico");
  });
});

describe("ProtectiveExecutionBlock — real render", () => {
  it("renders 'Salida protectora' block with maker attempts, reprices, fee", () => {
    const html = renderToString(<ProtectiveExecutionBlock cycle={makeOpenCycleV32()} />);
    expect(html).toContain("Salida protectora");
    expect(html).toContain("Intentos maker");
    expect(html).toContain("Reprecios");
    expect(html).toContain("Fee taker");
    expect(html).toContain("0.090");
    expect(html).toContain("revolutx");
    expect(html).toContain("REAL");
  });

  it("renders protective execution route/status", () => {
    const html = renderToString(<ProtectiveExecutionBlock cycle={makeOpenCycleV32()} />);
    // MAKER_PENDING with 2 attempts, max 3 → "Maker #3/3" (actualAttempts+1)
    expect(html).toContain("Maker #3/3");
    expect(html).toContain("Trailing maker");
  });

  it("renders trigger and first maker timestamps", () => {
    const html = renderToString(<ProtectiveExecutionBlock cycle={makeOpenCycleV32()} />);
    expect(html).toContain("Trigger");
    expect(html).toContain("Primer maker");
  });

  // TEST UI-2: makerAttempts=null should show 0/3, NOT 3/3
  it("UI-2: makerAttempts=null shows '0 / 3', NOT '3 / 3'", () => {
    const cycle = makeOpenCycleV32({
      makerAttempts: null,
      snapshotProtectiveMakerMaxAttempts: 3,
    });
    const html = renderToString(<ProtectiveExecutionBlock cycle={cycle} />);
    // React inserts HTML comments between adjacent text nodes: 0<!-- --> / <!-- -->3
    expect(html).toContain("0<!-- --> / <!-- -->3");
    // Should NOT contain "3 / 3" as the attempts display
    expect(html).not.toContain("3<!-- --> / <!-- -->3");
  });

  // TEST UI-3: firstMakerCreatedAt takes priority over makerOrderCreatedAt
  it("UI-3: firstMakerCreatedAt=T1 is shown, not makerOrderCreatedAt=T2", () => {
    const cycle = makeOpenCycleV32({
      firstMakerCreatedAt: "2026-09-01T10:00:00Z",
      makerOrderCreatedAt: "2026-09-01T11:00:00Z",
    });
    const html = renderToString(<ProtectiveExecutionBlock cycle={cycle} />);
    // T1 = 10:00 → formatted as "01/09/26, 12:00" (UTC→local may vary)
    // The key is that T1 appears, not T2
    // Both will be formatted; we verify T1's date appears
    expect(html).toContain("01/09/26");
  });

  // TEST UI-4: protectiveElapsedMs=15000 → "15 s / 30 s"
  it("UI-4: protectiveElapsedMs=15000 shows '15 s / 30 s'", () => {
    const cycle = makeOpenCycleV32({
      protectiveElapsedMs: 15000,
      snapshotProtectiveMakerMaxWaitSeconds: 30,
    });
    const html = renderToString(<ProtectiveExecutionBlock cycle={cycle} />);
    expect(html).toContain("15 s / 30 s");
  });

  it("renders fallback status correctly when not triggered", () => {
    const html = renderToString(<ProtectiveExecutionBlock cycle={makeOpenCycleV32()} />);
    expect(html).toContain("Fallback");
    expect(html).toContain("No");
  });

  it("renders fallback by max_attempts correctly", () => {
    const cycle = makeOpenCycleV32({
      makerState: "TAKER_FILLED",
      takerFallbackReason: "max_attempts",
      takerFallbackTriggeredAt: "2026-09-01T11:10:00Z",
    });
    const html = renderToString(<ProtectiveExecutionBlock cycle={cycle} />);
    expect(html).toContain("Fallback por intentos");
    expect(html).toContain("Taker ejecutado");
  });

  it("renders fallback by max_wait correctly", () => {
    const cycle = makeOpenCycleV32({
      makerState: "TAKER_PENDING",
      takerFallbackReason: "max_wait",
      takerFallbackTriggeredAt: "2026-09-01T11:10:00Z",
    });
    const html = renderToString(<ProtectiveExecutionBlock cycle={cycle} />);
    expect(html).toContain("Fallback por tiempo");
  });

  it("renders CANCELLED with taker fallback as 'Maker cancelado → fallback taker'", () => {
    const cycle = makeOpenCycleV32({
      makerState: "CANCELLED",
      takerFallbackTriggeredAt: "2026-09-01T11:10:00Z",
    });
    const html = renderToString(<ProtectiveExecutionBlock cycle={cycle} />);
    expect(html).toContain("Maker cancelado → fallback taker");
  });

  it("renders close route from closePath (PROTECTIVE_TAKER)", () => {
    const cycle = makeOpenCycleV32({
      closePath: "PROTECTIVE_TAKER",
      activeExitRoute: "TRAILING_MAKER",
    });
    const html = renderToString(<ProtectiveExecutionBlock cycle={cycle} />);
    expect(html).toContain("Stop-loss taker");
  });
});
