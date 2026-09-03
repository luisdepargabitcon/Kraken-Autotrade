/**
 * GRID V3.2 Real component-render tests — CompletedPerformanceBlock historical performance.
 *
 * Uses renderToString to verify VISIBLE UI output for closed cycle performance,
 * giveback, capture efficiency, target baseline, delta vs target, and execution details.
 */

import * as React from "react";
import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { CompletedPerformanceBlock } from "../GridOpenCyclesPanel";

function makeClosedCycleV32(overrides: Record<string, any> = {}) {
  return {
    id: "cycle-12",
    cycleNumber: 12,
    pair: "BTC/USD",
    buyPrice: 77474.78,
    sellPrice: 78030.30,
    targetSellPrice: 78475.11,
    quantity: 0.00516297,
    closePath: "TRAILING_TAKER",
    closePathLabel: "Trailing taker",
    liquidityRole: "taker",
    takerFillPrice: 78030.30,
    takerFeePct: 0.09,
    takerFeeSource: "EXECUTION_EXCHANGE_FEE_MODEL",
    takerFeeQuality: "REAL",
    takerFeeExchange: "revolutx",
    takerFeeUsd: 0.36,
    makerAttempts: 3,
    repriceAttempts: 447,
    takerFallbackReason: "max_attempts",
    // V3.2 Performance
    performanceDataAvailable: true,
    mfeNetUsd: 6.89,
    maeNetUsd: -0.30,
    mfeGrossUsd: 7.00,
    maeGrossUsd: -0.25,
    peakNetPnlUsd: 6.89,
    peakNetPnlPct: 1.78,
    troughNetPnlUsd: -0.30,
    troughNetPnlPct: -0.08,
    maxDrawdownFromPeakUsd: 7.19,
    maxDrawdownFromPeakPct: 1.86,
    highestObservedPrice: 79369.60,
    lowestObservedPrice: 76900,
    mfePeakPrice: 79369.60,
    maeTroughPrice: 76900,
    givebackUsd: 1.99,
    givebackPct: 28.88,
    finalCaptureEfficiencyPct: 71.12,
    finalNetPnlUsd: 4.90,
    targetBaselineNetUsd: 3.20,
    targetBaselineNetPct: 0.82,
    deltaVsTargetUsd: 1.70,
    deltaVsTargetPct: 0.41,
    performanceValuationMode: "EXECUTABLE_TAKER_LIQUIDATION",
    markPriceSource: "BEST_BID_TAKER_LIQUIDATION",
    realizedNetPnl: 4.90,
    realizedFee: 0.36,
    ...overrides,
  };
}

describe("CompletedPerformanceBlock — real render", () => {
  it("renders 'Rendimiento del ciclo' with giveback, capture efficiency, target baseline, delta", () => {
    const html = renderToString(<CompletedPerformanceBlock cycle={makeClosedCycleV32()} />);
    expect(html).toContain("Rendimiento del ciclo");
    expect(html).toContain("Máximo beneficio alcanzado");
    expect(html).toContain("Giveback");
    expect(html).toContain("28.88");
    expect(html).toContain("Eficiencia de captura");
    expect(html).toContain("71.12");
    expect(html).toContain("Target V3 habría dado");
    expect(html).toContain("Diferencia vs Target V3");
  });

  it("renders 'Trailing taker' close path and taker liquidity role", () => {
    const html = renderToString(<CompletedPerformanceBlock cycle={makeClosedCycleV32()} />);
    expect(html).toContain("Trailing taker");
    expect(html).toContain("Taker");
  });

  it("renders MFE and MAE values", () => {
    const html = renderToString(<CompletedPerformanceBlock cycle={makeClosedCycleV32()} />);
    expect(html).toContain("MAE");
  });

  it("renders execution details: maker attempts, reprices, fee, quality", () => {
    const html = renderToString(<CompletedPerformanceBlock cycle={makeClosedCycleV32()} />);
    expect(html).toContain("Intentos maker");
    expect(html).toContain("Reprecios");
    expect(html).toContain("Fee SELL");
    expect(html).toContain("Calidad fee");
    expect(html).toContain("REAL");
    expect(html).toContain("Fallback taker");
    expect(html).toContain("max_attempts");
  });

  it("renders delta vs target value", () => {
    const html = renderToString(<CompletedPerformanceBlock cycle={makeClosedCycleV32()} />);
    expect(html).toContain("Diferencia vs Target V3");
    // fmtUsd uses es-ES locale: 1.70 → "+1,70"
    expect(html).toContain("1,70");
  });

  it("renders 'Sin datos históricos suficientes' for legacy closed cycles", () => {
    const legacyCycle = makeClosedCycleV32({ performanceDataAvailable: false });
    const html = renderToString(<CompletedPerformanceBlock cycle={legacyCycle} />);
    expect(html).toContain("Sin datos históricos suficientes");
  });
});
