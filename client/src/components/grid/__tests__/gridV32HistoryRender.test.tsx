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
    peakNetPnlUsd: 6.89,
    peakNetPnlPct: 1.78,
    maxDrawdownFromPeakUsd: 7.19,
    maxDrawdownFromPeakPct: 28.4,
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

  it("renders MAE value", () => {
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

  it("renders delta vs target value (es-ES locale)", () => {
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

  // V3.2 forensic fix: drawdown must use maxDrawdownFromPeakUsd, NOT troughNetPnlUsd
  it("UI-1 historical: shows drawdown from maxDrawdownFromPeakUsd (7.19), NOT troughNetPnlUsd", () => {
    const cycle = makeClosedCycleV32({
      maeNetUsd: -0.30,
      maxDrawdownFromPeakUsd: 7.19,
      maxDrawdownFromPeakPct: 28.4,
    });
    const html = renderToString(<CompletedPerformanceBlock cycle={cycle} />);
    // Must contain 7,19 (the drawdown magnitude)
    expect(html).toContain("7,19");
    expect(html).toContain("28.4%");
    // Should be displayed as negative
    expect(html).toContain("-$7,19");
    // Should use "Máxima caída desde el pico" label
    expect(html).toContain("Máxima caída desde el pico");
  });
});
