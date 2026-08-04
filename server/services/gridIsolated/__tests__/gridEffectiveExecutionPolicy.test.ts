import { describe, it, expect } from "vitest";
import {
  getEffectiveExecutionPolicy,
  getEffectiveTakerFallbackEnabled,
  type GridMode,
  type ExecutionPolicy,
} from "../gridIsolatedTypes";

describe("getEffectiveTakerFallbackEnabled — REV-C12G", () => {
  it("1. SHADOW + stored true devuelve false", () => {
    expect(
      getEffectiveTakerFallbackEnabled({ mode: "SHADOW", takerFallbackEnabled: true }),
    ).toBe(false);
  });

  it("2. SHADOW + stored false devuelve false", () => {
    expect(
      getEffectiveTakerFallbackEnabled({ mode: "SHADOW", takerFallbackEnabled: false }),
    ).toBe(false);
  });

  it("3. OFF + stored true devuelve true", () => {
    expect(
      getEffectiveTakerFallbackEnabled({ mode: "OFF", takerFallbackEnabled: true }),
    ).toBe(true);
  });

  it("4. OFF + stored false devuelve false", () => {
    expect(
      getEffectiveTakerFallbackEnabled({ mode: "OFF", takerFallbackEnabled: false }),
    ).toBe(false);
  });

  it("5. REAL_LIMITED + stored true devuelve true", () => {
    expect(
      getEffectiveTakerFallbackEnabled({ mode: "REAL_LIMITED", takerFallbackEnabled: true }),
    ).toBe(true);
  });

  it("6. REAL_LIMITED + stored false devuelve false", () => {
    expect(
      getEffectiveTakerFallbackEnabled({ mode: "REAL_LIMITED", takerFallbackEnabled: false }),
    ).toBe(false);
  });

  it("7. REAL_FULL + stored true devuelve true", () => {
    expect(
      getEffectiveTakerFallbackEnabled({ mode: "REAL_FULL", takerFallbackEnabled: true }),
    ).toBe(true);
  });

  it("8. REAL_FULL + stored false devuelve false", () => {
    expect(
      getEffectiveTakerFallbackEnabled({ mode: "REAL_FULL", takerFallbackEnabled: false }),
    ).toBe(false);
  });

  it("9. no muta el objeto de configuración", () => {
    const config = { mode: "SHADOW" as GridMode, takerFallbackEnabled: true };
    const snapshot = { ...config };
    getEffectiveTakerFallbackEnabled(config);
    expect(config).toEqual(snapshot);
  });

  it("10. getEffectiveExecutionPolicy continúa devolviendo MAKER_ONLY en SHADOW", () => {
    const policy: ExecutionPolicy = "MAKER_FIRST_THEN_LIMIT_TAKER_FALLBACK";
    expect(getEffectiveExecutionPolicy({ mode: "SHADOW", executionPolicy: policy })).toBe(
      "MAKER_ONLY",
    );
  });
});
