/**
 * Tests for auditMetrics.ts
 * Covers MFE, MAE, Giveback, Profit Capture, Exit Efficiency, Diagnostics.
 * Pure unit tests — no DB, no real trading.
 */

import { describe, it, expect } from "vitest";
import {
  computeMfePnlUsd,
  computeMaePnlUsd,
  computeMfePct,
  computeMaePct,
  computeGivebackUsd,
  computeProfitCapturePct,
  classifyExitEfficiency,
  computeOpportunityLostUsd,
  buildTradeEfficiencyMetrics,
  computeProfitFactor,
  computeExpectancy,
  durationMinutes,
  formatDuration,
  generateTradeDiagnostics,
  generateIdcaDiagnostics,
  generateTradingChatGptSummary,
  generateIdcaChatGptSummary,
  classifyProfitCaptureQuality,
  type OhlcPoint,
} from "../auditMetrics";
import {
  classifyEventRetention,
  getCleanableTypes,
  buildSqlInList,
} from "../audit/botEventClassification";

const candles: OhlcPoint[] = [
  { high: 105, low: 95, open: 100, close: 102 },
  { high: 110, low: 98, open: 102, close: 108 },
  { high: 107, low: 96, open: 108, close: 104 },
];

// ─── MFE ──────────────────────────────────────────────────────────────────────

describe("computeMfePnlUsd", () => {
  it("returns (maxHigh - entryPrice) * qty", () => {
    const mfe = computeMfePnlUsd(100, 1, candles);
    expect(mfe).toBeCloseTo((110 - 100) * 1, 5);
  });

  it("returns null for empty candles", () => {
    expect(computeMfePnlUsd(100, 1, [])).toBeNull();
  });

  it("returns null for zero quantity", () => {
    expect(computeMfePnlUsd(100, 0, candles)).toBeNull();
  });

  it("returns null for zero entry price", () => {
    expect(computeMfePnlUsd(0, 1, candles)).toBeNull();
  });

  it("can be negative if all candles below entry (bad entry)", () => {
    const belowCandles: OhlcPoint[] = [
      { high: 98, low: 90 },
      { high: 97, low: 91 },
    ];
    const mfe = computeMfePnlUsd(100, 1, belowCandles);
    expect(mfe).toBeLessThan(0); // 98 - 100 = -2
  });
});

// ─── MAE ──────────────────────────────────────────────────────────────────────

describe("computeMaePnlUsd", () => {
  it("returns (minLow - entryPrice) * qty (negative)", () => {
    const mae = computeMaePnlUsd(100, 1, candles);
    expect(mae).toBeCloseTo((95 - 100) * 1, 5); // -5
  });

  it("returns null for empty candles", () => {
    expect(computeMaePnlUsd(100, 1, [])).toBeNull();
  });

  it("positive if all lows above entry (no adverse)", () => {
    const bullCandles: OhlcPoint[] = [
      { high: 115, low: 105 },
      { high: 120, low: 110 },
    ];
    const mae = computeMaePnlUsd(100, 1, bullCandles);
    expect(mae).toBeGreaterThan(0);
  });
});

// ─── MFE % and MAE % ─────────────────────────────────────────────────────────

describe("computeMfePct / computeMaePct", () => {
  it("MFE %: mfePnlUsd / capital * 100", () => {
    expect(computeMfePct(10, 100)).toBeCloseTo(10, 5);
  });

  it("MAE %: maePnlUsd / capital * 100 (negative)", () => {
    expect(computeMaePct(-5, 100)).toBeCloseTo(-5, 5);
  });

  it("returns null when null input", () => {
    expect(computeMfePct(null, 100)).toBeNull();
    expect(computeMaePct(null, 100)).toBeNull();
  });

  it("returns null when capital is 0", () => {
    expect(computeMfePct(10, 0)).toBeNull();
    expect(computeMaePct(-5, 0)).toBeNull();
  });
});

// ─── Giveback ─────────────────────────────────────────────────────────────────

describe("computeGivebackUsd", () => {
  it("giveback = MFE - finalPnl when MFE > finalPnl", () => {
    expect(computeGivebackUsd(40, 4)).toBeCloseTo(36, 5);
  });

  it("giveback = 0 when finalPnl >= MFE", () => {
    expect(computeGivebackUsd(10, 12)).toBe(0);
    expect(computeGivebackUsd(10, 10)).toBe(0);
  });

  it("returns null when MFE is null", () => {
    expect(computeGivebackUsd(null, 4)).toBeNull();
  });

  it("giveback when finalPnl is negative", () => {
    expect(computeGivebackUsd(30, -5)).toBeCloseTo(35, 5);
  });
});

// ─── Profit Capture ───────────────────────────────────────────────────────────

describe("computeProfitCapturePct", () => {
  it("example: MFE=40, final=4 → 10%", () => {
    expect(computeProfitCapturePct(40, 4)).toBeCloseTo(10, 5);
  });

  it("100% when final = MFE", () => {
    expect(computeProfitCapturePct(40, 40)).toBeCloseTo(100, 5);
  });

  it("returns null when MFE is null", () => {
    expect(computeProfitCapturePct(null, 4)).toBeNull();
  });

  it("returns null when MFE <= 0", () => {
    expect(computeProfitCapturePct(-5, 4)).toBeNull();
    expect(computeProfitCapturePct(0, 4)).toBeNull();
  });

  it("can exceed 100% if final > MFE (capped at 999)", () => {
    const pct = computeProfitCapturePct(10, 20);
    expect(pct).toBeCloseTo(200, 1);
  });

  it("negative when final is negative and MFE positive (closed at loss after being up)", () => {
    const pct = computeProfitCapturePct(20, -5);
    expect(pct).toBeLessThan(0);
  });
});

// ─── Exit Efficiency ──────────────────────────────────────────────────────────

describe("classifyExitEfficiency", () => {
  it("null → Sin datos", () => expect(classifyExitEfficiency(null)).toBe("Sin datos"));
  it("≥80 → Excelente", () => expect(classifyExitEfficiency(85)).toBe("Excelente"));
  it("50-79 → Buena", () => expect(classifyExitEfficiency(65)).toBe("Buena"));
  it("25-49 → Regular", () => expect(classifyExitEfficiency(30)).toBe("Regular"));
  it("<25 → Baja", () => expect(classifyExitEfficiency(10)).toBe("Baja"));
  it("exactly 80 → Excelente", () => expect(classifyExitEfficiency(80)).toBe("Excelente"));
  it("exactly 50 → Buena", () => expect(classifyExitEfficiency(50)).toBe("Buena"));
  it("exactly 25 → Regular", () => expect(classifyExitEfficiency(25)).toBe("Regular"));
});

// ─── Opportunity Lost ─────────────────────────────────────────────────────────

describe("computeOpportunityLostUsd", () => {
  it("same as giveback", () => {
    expect(computeOpportunityLostUsd(40, 4)).toBeCloseTo(36, 5);
  });
});

// ─── buildTradeEfficiencyMetrics (composite) ──────────────────────────────────

describe("buildTradeEfficiencyMetrics", () => {
  it("uses candles to compute MFE/MAE when available", () => {
    const m = buildTradeEfficiencyMetrics({
      entryPrice: 100,
      quantity: 1,
      capitalUsd: 100,
      finalPnlUsd: 4,
      candles,
    });
    expect(m.mfePnlUsd).toBeCloseTo(10, 5); // (110-100)*1
    expect(m.maePnlUsd).toBeCloseTo(-5, 5);  // (95-100)*1
    expect(m.givebackUsd).toBeCloseTo(6, 5); // 10 - 4
    expect(m.profitCapturePct).toBeCloseTo(40, 1); // 4/10*100
    expect(m.exitEfficiency).toBe("Regular");
  });

  it("uses mfePriceOverride when no candles", () => {
    const m = buildTradeEfficiencyMetrics({
      entryPrice: 100,
      quantity: 1,
      capitalUsd: 100,
      finalPnlUsd: 10,
      mfePriceOverride: 120,
    });
    expect(m.mfePnlUsd).toBeCloseTo(20, 5); // (120-100)*1
    expect(m.profitCapturePct).toBeCloseTo(50, 1); // 10/20*100
  });

  it("uses maePctOverride when no candles", () => {
    const m = buildTradeEfficiencyMetrics({
      entryPrice: 100,
      quantity: 1,
      capitalUsd: 100,
      finalPnlUsd: 5,
      maePctOverride: -10,
    });
    expect(m.maePnlUsd).toBeCloseTo(-10, 5); // -10% of 100
  });

  it("all nulls when no data provided", () => {
    const m = buildTradeEfficiencyMetrics({
      entryPrice: 100,
      quantity: 1,
      capitalUsd: 100,
      finalPnlUsd: 5,
    });
    expect(m.mfePnlUsd).toBeNull();
    expect(m.maePnlUsd).toBeNull();
    expect(m.profitCapturePct).toBeNull();
    expect(m.exitEfficiency).toBe("Sin datos");
  });

  it("handles operation still open (no exit data needed)", () => {
    const m = buildTradeEfficiencyMetrics({
      entryPrice: 1500,
      quantity: 0.1,
      capitalUsd: 150,
      finalPnlUsd: 3.5,
      candles: [{ high: 1560, low: 1480 }],
    });
    expect(m.mfePnlUsd).toBeCloseTo((1560 - 1500) * 0.1, 4);
    expect(m.maePnlUsd).toBeCloseTo((1480 - 1500) * 0.1, 4);
  });
});

// ─── Aggregate helpers ────────────────────────────────────────────────────────

describe("computeProfitFactor", () => {
  it("positive / negative ratio", () => {
    expect(computeProfitFactor([10, 20, -5, -10])).toBeCloseTo(2, 3);
  });

  it("returns null when all profits (no losses)", () => {
    expect(computeProfitFactor([10, 20])).toBeNull(); // Infinity → null
  });

  it("returns null for empty array", () => {
    expect(computeProfitFactor([])).toBeNull();
  });
});

describe("computeExpectancy", () => {
  it("positive expectancy for winning system", () => {
    const e = computeExpectancy([10, 20, -3, -4]);
    expect(e).toBeGreaterThan(0);
  });

  it("negative for losing system", () => {
    const e = computeExpectancy([-20, -10, 1, 2]);
    expect(e).toBeLessThan(0);
  });

  it("returns 0 for empty", () => {
    expect(computeExpectancy([])).toBe(0);
  });
});

describe("durationMinutes", () => {
  it("computes minutes between two ISO dates", () => {
    const d = durationMinutes("2026-01-01T00:00:00Z", "2026-01-01T02:30:00Z");
    expect(d).toBe(150);
  });

  it("returns null if either is null", () => {
    expect(durationMinutes(null, "2026-01-01T00:00:00Z")).toBeNull();
    expect(durationMinutes("2026-01-01T00:00:00Z", null)).toBeNull();
  });
});

describe("formatDuration", () => {
  it("formats minutes < 60", () => expect(formatDuration(45)).toBe("45m"));
  it("formats hours + minutes", () => expect(formatDuration(90)).toBe("1h 30m"));
  it("formats days", () => expect(formatDuration(1500)).toBe("1d 1h"));
  it("returns — for null", () => expect(formatDuration(null)).toBe("—"));
});

// ─── Diagnostics ──────────────────────────────────────────────────────────────

describe("generateTradeDiagnostics", () => {
  it("warns on low profit capture", () => {
    const metrics = buildTradeEfficiencyMetrics({
      entryPrice: 100, quantity: 1, capitalUsd: 100, finalPnlUsd: 2,
      mfePriceOverride: 110,
    });
    const diag = generateTradeDiagnostics(metrics, "TRAILING_STOP", 100);
    expect(diag.some(d => d.code === "LOW_PROFIT_CAPTURE")).toBe(true);
    expect(diag.some(d => d.severity === "warning")).toBe(true);
  });

  it("warns on high giveback", () => {
    const metrics = buildTradeEfficiencyMetrics({
      entryPrice: 100, quantity: 1, capitalUsd: 100, finalPnlUsd: 2,
      mfePriceOverride: 130,
    });
    const diag = generateTradeDiagnostics(metrics, null, 100);
    expect(diag.some(d => d.code === "HIGH_GIVEBACK")).toBe(true);
  });

  it("ok diagnosis for efficient exit", () => {
    const metrics = buildTradeEfficiencyMetrics({
      entryPrice: 100, quantity: 1, capitalUsd: 100, finalPnlUsd: 9,
      mfePriceOverride: 110,
    });
    const diag = generateTradeDiagnostics(metrics, null, 100);
    expect(diag.some(d => d.code === "GOOD_EXIT")).toBe(true);
  });

  it("informs on TimeStop with MFE", () => {
    const metrics = buildTradeEfficiencyMetrics({
      entryPrice: 100, quantity: 1, capitalUsd: 100, finalPnlUsd: 1,
      mfePriceOverride: 115,
    });
    const diag = generateTradeDiagnostics(metrics, "TIME_STOP", 100);
    expect(diag.some(d => d.code === "TIMESTOP_WITH_MFE")).toBe(true);
  });
});

describe("generateIdcaDiagnostics", () => {
  it("warns on low profit capture for IDCA cycle", () => {
    const diag = generateIdcaDiagnostics({
      buyCount: 2,
      closeReason: "TRAILING_STOP",
      profitCapturePct: 15,
      mfePnlUsd: 30,
      givebackUsd: 25,
      maePnlUsd: -10,
      capitalUsd: 200,
    });
    expect(diag.some(d => d.code === "LOW_PROFIT_CAPTURE")).toBe(true);
  });

  it("informs when grid not active", () => {
    const diag = generateIdcaDiagnostics({
      buyCount: 1,
      closeReason: null,
      profitCapturePct: 80,
      mfePnlUsd: 10,
      givebackUsd: 2,
      maePnlUsd: -3,
      capitalUsd: 100,
      gridPlanCreated: true,
      gridState: "GRID_BLOCKED_BEAR_TREND",
    });
    expect(diag.some(d => d.code === "GRID_NOT_ACTIVE")).toBe(true);
  });

  it("ok for efficient cycle", () => {
    const diag = generateIdcaDiagnostics({
      buyCount: 2,
      closeReason: "TAKE_PROFIT",
      profitCapturePct: 85,
      mfePnlUsd: 20,
      givebackUsd: 3,
      maePnlUsd: -5,
      capitalUsd: 150,
    });
    expect(diag.some(d => d.code === "GOOD_CYCLE")).toBe(true);
  });
});

// ─── ChatGPT summary generators ───────────────────────────────────────────────

describe("generateTradingChatGptSummary", () => {
  it("generates a non-empty string with required fields", () => {
    const metrics = buildTradeEfficiencyMetrics({
      entryPrice: 100, quantity: 1, capitalUsd: 100, finalPnlUsd: 10,
      mfePriceOverride: 120,
    });
    const diag = generateTradeDiagnostics(metrics, "TRAILING_STOP", 100);
    const summary = generateTradingChatGptSummary({
      id: 42,
      pair: "BTC/USD",
      mode: "dry_run",
      entryDate: "2026-01-01",
      exitDate: "2026-01-02",
      entryPrice: 100,
      exitPrice: 110,
      quantity: 1,
      capitalUsd: 100,
      finalPnlUsd: 10,
      finalPnlPct: 10,
      metrics,
      entryReason: "SIGNAL",
      exitReason: "TRAILING_STOP",
      smartExitActive: false,
      timeStopActive: false,
      beActive: true,
      trailingActive: true,
      durationMinutes: 1440,
      diagnostics: diag,
    });
    expect(summary).toContain("BTC/USD operación #42");
    expect(summary).toContain("dry_run");
    expect(summary).toContain("Profit Capture");
    expect(summary).toContain("Diagnóstico automático");
  });
});

describe("generateIdcaChatGptSummary", () => {
  it("generates a non-empty string with required fields", () => {
    const metrics = buildTradeEfficiencyMetrics({
      entryPrice: 1500, quantity: 0.1, capitalUsd: 150, finalPnlUsd: 5,
      mfePriceOverride: 1600,
    });
    const diag = generateIdcaDiagnostics({
      buyCount: 3,
      closeReason: "TAKE_PROFIT",
      profitCapturePct: metrics.profitCapturePct,
      mfePnlUsd: metrics.mfePnlUsd,
      givebackUsd: metrics.givebackUsd,
      maePnlUsd: metrics.maePnlUsd,
      capitalUsd: 150,
    });
    const summary = generateIdcaChatGptSummary({
      id: 29,
      pair: "ETH/USD",
      startDate: "2026-01-01",
      closeDate: "2026-01-15",
      buyCount: 3,
      capitalUsd: 150,
      avgEntryInitial: 1520,
      avgEntryFinal: 1500,
      tpPrice: 1600,
      finalPnlUsd: 5,
      metrics,
      beActive: true,
      trailingActive: false,
      gridPlanId: "GRID-29-abc",
      mrDecision: "hold",
      mrRegime: "lateral",
      closeReason: "TAKE_PROFIT",
      durationMinutes: 14 * 1440,
      diagnostics: diag,
    });
    expect(summary).toContain("ETH/USD ciclo #29");
    expect(summary).toContain("Grid Observer");
    expect(summary).toContain("Diagnóstico automático");
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe("Edge cases", () => {
  it("all-losing cycle has no profit capture", () => {
    const metrics = buildTradeEfficiencyMetrics({
      entryPrice: 100, quantity: 1, capitalUsd: 100, finalPnlUsd: -20,
      mfePriceOverride: null,
    });
    expect(metrics.profitCapturePct).toBeNull();
    expect(metrics.mfePnlUsd).toBeNull();
  });

  it("operation closed at breakeven (0 PnL)", () => {
    const metrics = buildTradeEfficiencyMetrics({
      entryPrice: 100, quantity: 1, capitalUsd: 100, finalPnlUsd: 0,
      mfePriceOverride: 110,
    });
    expect(metrics.profitCapturePct).toBeCloseTo(0, 1);
    expect(metrics.givebackUsd).toBeCloseTo(10, 5);
  });

  it("single candle operation", () => {
    const m = buildTradeEfficiencyMetrics({
      entryPrice: 50000, quantity: 0.001, capitalUsd: 50,
      finalPnlUsd: 2,
      candles: [{ high: 52000, low: 49500 }],
    });
    expect(m.mfePnlUsd).toBeCloseTo((52000 - 50000) * 0.001, 5);
    expect(m.maePnlUsd).toBeCloseTo((49500 - 50000) * 0.001, 5);
  });
});

// ─── Profit Capture Quality ──────────────────────────────────────────────────

describe("classifyProfitCaptureQuality", () => {
  it("Case 1: MFE=40, final=4 → 10%, reliable", () => {
    const r = classifyProfitCaptureQuality(40, 4, true);
    expect(r.displayProfitCapturePct).toBeCloseTo(10, 1);
    expect(r.profitCaptureQuality).toBe("reliable");
    expect(r.profitCaptureWarning).toBeNull();
  });

  it("Case 2: MFE=40, final=40 → 100%, reliable", () => {
    const r = classifyProfitCaptureQuality(40, 40, true);
    expect(r.displayProfitCapturePct).toBeCloseTo(100, 1);
    expect(r.profitCaptureQuality).toBe("reliable");
  });

  it("Case 3: MFE=10, final=30, no snapshots → insufficient_data (>100%)", () => {
    const r = classifyProfitCaptureQuality(10, 30, false);
    expect(r.displayProfitCapturePct).toBeNull();
    expect(r.profitCaptureQuality).toBe("insufficient_data");
    expect(r.rawProfitCapturePct).toBeGreaterThan(100);
    expect(r.profitCaptureWarning).toContain("supera 100%");
  });

  it("Case 4: MFE=null, final=30 → insufficient_data", () => {
    const r = classifyProfitCaptureQuality(null, 30, false);
    expect(r.displayProfitCapturePct).toBeNull();
    expect(r.profitCaptureQuality).toBe("insufficient_data");
    expect(r.profitCaptureWarning).toContain("No hay MFE");
  });

  it("Case 5: MFE<=0, final>0 → insufficient_data", () => {
    const r = classifyProfitCaptureQuality(-5, 30, true);
    expect(r.displayProfitCapturePct).toBeNull();
    expect(r.profitCaptureQuality).toBe("insufficient_data");
  });

  it("Case 6: estimated when hasReliableMfe=false and 0<pct<=100", () => {
    const r = classifyProfitCaptureQuality(40, 20, false);
    expect(r.profitCaptureQuality).toBe("estimated");
    expect(r.displayProfitCapturePct).toBeCloseTo(50, 1);
    expect(r.profitCaptureWarning).toContain("estimado");
  });

  it("Case 7: reliable when hasReliableMfe=true and 0<pct<=100", () => {
    const r = classifyProfitCaptureQuality(40, 20, true);
    expect(r.profitCaptureQuality).toBe("reliable");
    expect(r.profitCaptureWarning).toBeNull();
  });

  it("Case 8: negative pct (loss with MFE) — valid, not insufficient", () => {
    const r = classifyProfitCaptureQuality(40, -10, true);
    expect(r.displayProfitCapturePct).toBeCloseTo(-25, 1);
    expect(r.profitCaptureQuality).toBe("reliable");
  });

  it("Case 9: does not return Infinity", () => {
    const r = classifyProfitCaptureQuality(0.001, 100, false);
    expect(r.displayProfitCapturePct).toBeNull(); // >100 → insufficient
    expect(r.rawProfitCapturePct).not.toBe(Infinity);
    expect(Number.isFinite(r.rawProfitCapturePct)).toBe(true);
  });

  it("Case 10: does not return NaN", () => {
    const r = classifyProfitCaptureQuality(null, 0, false);
    expect(r.displayProfitCapturePct).toBeNull();
    expect(Number.isNaN(r.rawProfitCapturePct)).toBe(false);
  });

  it("Case 11: JSON serializable (no Infinity/NaN)", () => {
    const r1 = classifyProfitCaptureQuality(40, 4, true);
    const r2 = classifyProfitCaptureQuality(null, 30, false);
    const r3 = classifyProfitCaptureQuality(10, 300, false);
    expect(() => JSON.stringify(r1)).not.toThrow();
    expect(() => JSON.stringify(r2)).not.toThrow();
    expect(() => JSON.stringify(r3)).not.toThrow();
  });

  it("buildTradeEfficiencyMetrics includes quality fields", () => {
    const m = buildTradeEfficiencyMetrics({
      entryPrice: 100, quantity: 1, capitalUsd: 100, finalPnlUsd: 30,
      mfePriceOverride: 110, hasReliableMfe: false,
    });
    expect(m.profitCaptureQuality).toBe("insufficient_data"); // 300% > 100
    expect(m.displayProfitCapturePct).toBeNull();
    expect(m.rawProfitCapturePct).toBeGreaterThan(100);
    expect(m.profitCaptureWarning).not.toBeNull();
  });

  it("buildTradeEfficiencyMetrics with candles → reliable", () => {
    const m = buildTradeEfficiencyMetrics({
      entryPrice: 100, quantity: 1, capitalUsd: 100, finalPnlUsd: 5,
      candles: [{ high: 110, low: 95 }],
    });
    expect(m.profitCaptureQuality).toBe("reliable");
    expect(m.displayProfitCapturePct).toBeCloseTo(50, 1);
  });
});

// ─── Bot Event Classification ─────────────────────────────────────────────────

describe("classifyEventRetention", () => {
  it("TRADE_EXECUTED is permanent", () => {
    expect(classifyEventRetention("TRADE_EXECUTED", "INFO")).toBe("permanent");
  });

  it("ORDER_FILLED is permanent", () => {
    expect(classifyEventRetention("ORDER_FILLED", "INFO")).toBe("permanent");
  });

  it("POSITION_CLOSED is permanent", () => {
    expect(classifyEventRetention("POSITION_CLOSED", "INFO")).toBe("permanent");
  });

  it("CONFIG_UPDATED is permanent", () => {
    expect(classifyEventRetention("CONFIG_UPDATED", "INFO")).toBe("permanent");
  });

  it("ERROR level is always permanent regardless of type", () => {
    expect(classifyEventRetention("ENGINE_TICK", "ERROR")).toBe("permanent");
    expect(classifyEventRetention("UNKNOWN_TYPE", "ERROR")).toBe("permanent");
  });

  it("WARN level is always permanent regardless of type", () => {
    expect(classifyEventRetention("ENGINE_TICK", "WARN")).toBe("permanent");
  });

  it("ENGINE_TICK INFO is 90d", () => {
    expect(classifyEventRetention("ENGINE_TICK", "INFO")).toBe("90d");
  });

  it("SIGNAL_GENERATED INFO is 12mo", () => {
    expect(classifyEventRetention("SIGNAL_GENERATED", "INFO")).toBe("12mo");
  });

  it("Unknown INFO type defaults to 30d", () => {
    expect(classifyEventRetention("SOME_RANDOM_TYPE", "INFO")).toBe("30d");
  });

  it("FIFO_LOTS_CLOSED is permanent (fiscal)", () => {
    expect(classifyEventRetention("FIFO_LOTS_CLOSED", "INFO")).toBe("permanent");
  });

  it("MANUAL_CLOSE_SUCCESS is permanent", () => {
    expect(classifyEventRetention("MANUAL_CLOSE_SUCCESS", "INFO")).toBe("permanent");
  });
});

describe("getCleanableTypes", () => {
  it("returns tiers with 12mo, 90d, and 30d", () => {
    const c = getCleanableTypes();
    expect(c.tiers).toHaveLength(3);
    expect(c.tiers.map(t => t.tier)).toContain("12mo");
    expect(c.tiers.map(t => t.tier)).toContain("90d");
    expect(c.tiers.map(t => t.tier)).toContain("30d");
  });

  it("12mo tier has 365 days", () => {
    const c = getCleanableTypes();
    const t12 = c.tiers.find(t => t.tier === "12mo");
    expect(t12?.days).toBe(365);
  });

  it("90d tier has 90 days", () => {
    const c = getCleanableTypes();
    const t90 = c.tiers.find(t => t.tier === "90d");
    expect(t90?.days).toBe(90);
  });

  it("30d tier has 30 days and empty types (fallback)", () => {
    const c = getCleanableTypes();
    const t30 = c.tiers.find(t => t.tier === "30d");
    expect(t30?.days).toBe(30);
    expect(t30?.types).toEqual([]);
  });

  it("does not include TRADE_EXECUTED in cleanable types", () => {
    const c = getCleanableTypes();
    expect(c.types).not.toContain("TRADE_EXECUTED");
  });

  it("does not include ORDER_FILLED in cleanable types", () => {
    const c = getCleanableTypes();
    expect(c.types).not.toContain("ORDER_FILLED");
  });
});

describe("buildSqlInList", () => {
  it("builds comma-separated quoted list", () => {
    const list = buildSqlInList(["A", "B", "C"]);
    expect(list).toBe("'A','B','C'");
  });

  it("escapes single quotes", () => {
    const list = buildSqlInList(["IT'S", "OK"]);
    expect(list).toBe("'IT''S','OK'");
  });

  it("handles empty array", () => {
    const list = buildSqlInList([]);
    expect(list).toBe("");
  });
});
