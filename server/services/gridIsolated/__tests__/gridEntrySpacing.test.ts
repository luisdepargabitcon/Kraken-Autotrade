import { describe, expect, it } from "vitest";
import { calculateEntrySpacingPct } from "../gridSpacingCalculator";

const base = {
  atrPct: 0.5,
  gridStepAtrMultiplier: 1.5,
  gridStepMinPct: 0.2,
  gridStepMaxPct: 1.2,
};

describe("calculateEntrySpacingPct", () => {
  it("no depende del objetivo neto ni de fees externas", () => {
    const first = calculateEntrySpacingPct(base);
    const second = calculateEntrySpacingPct(base);
    expect(first.entrySpacingPct).toBe(second.entrySpacingPct);
  });

  it("crece con ATR hasta el máximo", () => {
    expect(calculateEntrySpacingPct({ ...base, atrPct: 0.7 }).entrySpacingPct).toBeCloseTo(1.05, 10);
    expect(calculateEntrySpacingPct({ ...base, atrPct: 2 }).entrySpacingPct).toBe(1.2);
  });

  it("respeta el suelo microestructural", () => {
    const result = calculateEntrySpacingPct({ ...base, atrPct: 0.01 });
    expect(result.entrySpacingPct).toBe(0.2);
    expect(result.clampReason).toBe("min");
  });

  it("usa el spread para elevar el suelo", () => {
    const result = calculateEntrySpacingPct({ ...base, spreadPct: 0.35 });
    expect(result.microstructureFloorPct).toBe(0.7);
    expect(result.entrySpacingPct).toBe(0.75);
  });

  it("usa gridStepMinPct si faltan spread y tick", () => {
    const result = calculateEntrySpacingPct(base);
    expect(result.source).toBe("atr_config_floor");
    expect(result.microstructureFloorPct).toBe(0.2);
  });
});
