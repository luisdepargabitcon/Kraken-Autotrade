/**
 * AMA HWM & Macro Bar — Fase 9: tests
 */

import { describe, it, expect } from "vitest";
import {
  computeATR,
  computeATRPercentage,
  bootstrapHWM,
  supersedeHWM,
  invalidateHWM,
  freezeHWM,
  isCeilingConfirmed,
  detectCycleLow,
  computeDropPct,
  computeReboundPct,
  getMacroZone,
  getZoneRange,
  isValueZone,
  isCapitulation,
  computeReversalThreshold,
  isReversalConfirmed,
  type Candle,
} from "../amaHwmBar";

const makeCandles = (count: number, basePrice = 50000): Candle[] => {
  const candles: Candle[] = [];
  for (let i = 0; i < count; i++) {
    const close = basePrice + Math.sin(i / 3) * 1000;
    candles.push({
      timestamp: `2026-07-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
      open: close - 100,
      high: close + 200,
      low: close - 200,
      close,
    });
  }
  return candles;
};

describe("Fase 9 — ATR", () => {
  it("computes ATR with sufficient candles", () => {
    const candles = makeCandles(25);
    const atr = computeATR(candles, 20);
    expect(atr).not.toBeNull();
    expect(atr!).toBeGreaterThan(0);
  });

  it("returns null with insufficient candles", () => {
    const candles = makeCandles(10);
    expect(computeATR(candles, 20)).toBeNull();
  });

  it("computes ATR percentage", () => {
    expect(computeATRPercentage(500, 50000)).toBe(1.0);
    expect(computeATRPercentage(null, 50000)).toBeNull();
    expect(computeATRPercentage(0, 50000)).toBeNull();
  });
});

describe("Fase 9 — HWM Bootstrap", () => {
  it("bootstraps CONFIRMED HWM with enough lower closes", () => {
    const closes = [
      { timestamp: "2026-07-01T00:00:00Z", close: 50000 },
      { timestamp: "2026-07-02T00:00:00Z", close: 52000 },
      { timestamp: "2026-07-03T00:00:00Z", close: 51000 },
      { timestamp: "2026-07-04T00:00:00Z", close: 50500 },
      { timestamp: "2026-07-05T00:00:00Z", close: 50000 },
    ];
    const hwm = bootstrapHWM(closes, 3);
    expect(hwm).not.toBeNull();
    expect(hwm!.price).toBe(52000);
    expect(hwm!.status).toBe("CONFIRMED");
  });

  it("returns CANDIDATE with insufficient confirmations", () => {
    const closes = [
      { timestamp: "2026-07-01T00:00:00Z", close: 52000 },
      { timestamp: "2026-07-02T00:00:00Z", close: 51000 },
    ];
    const hwm = bootstrapHWM(closes, 3);
    expect(hwm).not.toBeNull();
    expect(hwm!.status).toBe("CANDIDATE");
  });

  it("returns CONFIRMING when a subsequent close equals the high", () => {
    const closes = [
      { timestamp: "2026-07-01T00:00:00Z", close: 50000 },
      { timestamp: "2026-07-02T00:00:00Z", close: 54000 },
      { timestamp: "2026-07-03T00:00:00Z", close: 54000 },
      { timestamp: "2026-07-04T00:00:00Z", close: 53000 },
      { timestamp: "2026-07-05T00:00:00Z", close: 52000 },
      { timestamp: "2026-07-06T00:00:00Z", close: 51000 },
    ];
    const hwm = bootstrapHWM(closes, 3);
    expect(hwm!.status).toBe("CONFIRMING");
  });

  it("returns null with no data", () => {
    expect(bootstrapHWM([], 3)).toBeNull();
  });
});

describe("Fase 9 — HWM Lifecycle", () => {
  it("supersedes HWM", () => {
    const old = { hwmId: "h1", price: 50000, timestamp: "2026-07-01T00:00:00Z", status: "CONFIRMED" as const, confirmedAt: "2026-07-03T00:00:00Z", supersededBy: null };
    const newH = { hwmId: "h2", price: 55000, timestamp: "2026-07-10T00:00:00Z", status: "CANDIDATE" as const, confirmedAt: null, supersededBy: null };
    const { oldHwm, newHwm } = supersedeHWM(old, newH);
    expect(oldHwm.status).toBe("SUPERSEDED");
    expect(oldHwm.supersededBy).toBe("h2");
    expect(newHwm.status).toBe("CONFIRMED");
  });

  it("invalidates HWM", () => {
    const hwm = { hwmId: "h1", price: 50000, timestamp: "2026-07-01T00:00:00Z", status: "CONFIRMED" as const, confirmedAt: "2026-07-03T00:00:00Z", supersededBy: null };
    expect(invalidateHWM(hwm).status).toBe("INVALIDATED");
  });

  it("freezes HWM", () => {
    const hwm = { hwmId: "h1", price: 50000, timestamp: "2026-07-01T00:00:00Z", status: "CONFIRMED" as const, confirmedAt: "2026-07-03T00:00:00Z", supersededBy: null };
    expect(freezeHWM(hwm).status).toBe("FROZEN");
  });
});

describe("Fase 9 — Ceiling Detection", () => {
  it("confirms ceiling when drop exceeds threshold", () => {
    const hwm = { hwmId: "h1", price: 50000, timestamp: "2026-07-01T00:00:00Z", status: "CONFIRMED" as const, confirmedAt: "2026-07-03T00:00:00Z", supersededBy: null };
    expect(isCeilingConfirmed(hwm, 44000, 500, 10)).toBe(true);
  });

  it("does not confirm ceiling with small drop", () => {
    const hwm = { hwmId: "h1", price: 50000, timestamp: "2026-07-01T00:00:00Z", status: "CONFIRMED" as const, confirmedAt: "2026-07-03T00:00:00Z", supersededBy: null };
    expect(isCeilingConfirmed(hwm, 48000, 500, 10)).toBe(false);
  });

  it("does not confirm ceiling with non-CONFIRMED HWM", () => {
    const hwm = { hwmId: "h1", price: 50000, timestamp: "2026-07-01T00:00:00Z", status: "CANDIDATE" as const, confirmedAt: null, supersededBy: null };
    expect(isCeilingConfirmed(hwm, 40000, 500, 10)).toBe(false);
  });
});

describe("Fase 9 — Cycle Low", () => {
  it("detects cycle low since a timestamp", () => {
    const closes = [
      { timestamp: "2026-07-01T00:00:00Z", close: 50000 },
      { timestamp: "2026-07-02T00:00:00Z", close: 48000 },
      { timestamp: "2026-07-03T00:00:00Z", close: 45000 },
      { timestamp: "2026-07-04T00:00:00Z", close: 47000 },
    ];
    const low = detectCycleLow(closes, "2026-07-01T00:00:00Z");
    expect(low).not.toBeNull();
    expect(low!.price).toBe(45000);
    expect(low!.timestamp).toBe("2026-07-03T00:00:00Z");
  });

  it("returns null for no data after timestamp", () => {
    const closes = [{ timestamp: "2026-07-01T00:00:00Z", close: 50000 }];
    expect(detectCycleLow(closes, "2026-08-01T00:00:00Z")).toBeNull();
  });
});

describe("Fase 9 — Drop & Rebound", () => {
  it("computes drop percentage", () => {
    expect(computeDropPct(50000, 40000)).toBe(20);
    expect(computeDropPct(0, 40000)).toBe(0);
  });

  it("computes rebound percentage", () => {
    expect(computeReboundPct(40000, 44000)).toBe(10);
    expect(computeReboundPct(0, 44000)).toBe(0);
  });
});

describe("Fase 9 — Macro Zones", () => {
  it("returns correct zones for drop percentages", () => {
    expect(getMacroZone(0)).toBe("NORMAL");
    expect(getMacroZone(5)).toBe("NORMAL");
    expect(getMacroZone(15)).toBe("RETROCESO");
    expect(getMacroZone(25)).toBe("CORRECCION");
    expect(getMacroZone(35)).toBe("VALUE");
    expect(getMacroZone(45)).toBe("DEEP_VALUE");
    expect(getMacroZone(55)).toBe("CAPITULACION");
    expect(getMacroZone(70)).toBe("CAPITULACION_EXTREMA");
    expect(getMacroZone(90)).toBe("CAPITULACION_EXTREMA");
  });

  it("returns zone range", () => {
    const range = getZoneRange("VALUE");
    expect(range).not.toBeNull();
    expect(range!.minPct).toBe(30);
    expect(range!.maxPct).toBe(40);
  });

  it("identifies value zones", () => {
    expect(isValueZone("VALUE")).toBe(true);
    expect(isValueZone("DEEP_VALUE")).toBe(true);
    expect(isValueZone("CAPITULACION")).toBe(true);
    expect(isValueZone("CAPITULACION_EXTREMA")).toBe(true);
    expect(isValueZone("NORMAL")).toBe(false);
  });

  it("identifies capitulation", () => {
    expect(isCapitulation("CAPITULACION")).toBe(true);
    expect(isCapitulation("CAPITULACION_EXTREMA")).toBe(true);
    expect(isCapitulation("VALUE")).toBe(false);
  });
});

describe("Fase 9 — Reversal Threshold", () => {
  it("computes ATR-based reversal threshold", () => {
    const threshold = computeReversalThreshold(50000, 500, 3.0, 10.0);
    const atrThreshold = 50000 - 500 * 3.0; // 48500
    const fixedThreshold = 50000 * 0.9; // 45000
    expect(threshold).toBe(Math.max(atrThreshold, fixedThreshold));
  });

  it("uses fixed threshold when ATR is null", () => {
    const threshold = computeReversalThreshold(50000, null, 3.0, 10.0);
    expect(threshold).toBe(45000);
  });

  it("confirms reversal with consecutive closes below threshold", () => {
    const closes = [
      { timestamp: "2026-07-01T00:00:00Z", close: 44000 },
      { timestamp: "2026-07-02T00:00:00Z", close: 43000 },
      { timestamp: "2026-07-03T00:00:00Z", close: 42000 },
    ];
    expect(isReversalConfirmed(50000, 42000, 45000, 3, closes)).toBe(true);
  });

  it("rejects reversal with insufficient closes", () => {
    const closes = [
      { timestamp: "2026-07-01T00:00:00Z", close: 44000 },
      { timestamp: "2026-07-02T00:00:00Z", close: 43000 },
    ];
    expect(isReversalConfirmed(50000, 43000, 45000, 3, closes)).toBe(false);
  });

  it("rejects reversal when price above threshold", () => {
    expect(isReversalConfirmed(50000, 46000, 45000, 3, [])).toBe(false);
  });
});
