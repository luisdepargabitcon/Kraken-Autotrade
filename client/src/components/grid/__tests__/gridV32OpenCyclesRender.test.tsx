/**
 * GRID V3.2 Real component-render tests — PerformanceBlock + ProtectiveExecutionBlock.
 *
 * Uses renderToString to verify VISIBLE UI output, not just object properties.
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
    makerOrderCreatedAt: "2026-09-01T11:01:00Z",
    lastRepricedAt: "2026-09-01T11:05:00Z",
    activeExitRoute: "TRAILING_MAKER",
    activeExitRouteLabel: "Trailing maker",
    snapshotProtectiveMakerMaxAttempts: 3,
    snapshotProtectiveMakerMaxWaitSeconds: 30,
    protiveWaitSeconds: 15,
    snapshotResolvedTakerFeePct: 0.09,
    snapshotFeeSource: "EXECUTION_EXCHANGE_FEE_MODEL",
    snapshotFeeQuality: "REAL",
    snapshotFeeExchange: "revolutx",
    // V3.2 Performance
    performanceDataAvailable: true,
    mfeNetUsd: 2.87,
    maeNetUsd: -0.50,
    mfeGrossUsd: 3.00,
    maeGrossUsd: -0.40,
    peakNetPnlUsd: 3.50,
    troughNetPnlUsd: -0.50,
    highestObservedPrice: 77900,
    lowestObservedPrice: 76900,
    mfePeakPrice: 77900,
    maeTroughPrice: 76900,
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
    expect(html).toContain("Máximo drawdown desde peak");
    expect(html).toContain("Target V3 baseline");
    expect(html).toContain("Liquidación taker al best bid");
  });

  it("renders MFE and MAE values", () => {
    const html = renderToString(<PerformanceBlock cycle={makeOpenCycleV32()} />);
    // fmtUsd uses es-ES locale: 2.87 → "+2,87"
    expect(html).toContain("2,87");
    expect(html).toContain("-0,50");
  });

  it("renders peak and target baseline values", () => {
    const html = renderToString(<PerformanceBlock cycle={makeOpenCycleV32()} />);
    // fmtUsd uses es-ES locale
    expect(html).toContain("3,50");
    expect(html).toContain("2,80");
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
    expect(html).toContain("Maker pendiente");
    expect(html).toContain("Trailing maker");
  });

  it("renders trigger and first maker timestamps", () => {
    const html = renderToString(<ProtectiveExecutionBlock cycle={makeOpenCycleV32()} />);
    expect(html).toContain("Trigger");
    expect(html).toContain("Primer maker");
  });

  it("renders wait and max wait info", () => {
    const html = renderToString(<ProtectiveExecutionBlock cycle={makeOpenCycleV32()} />);
    expect(html).toContain("Espera");
    expect(html).toContain("15 s / 30 s");
  });
});
