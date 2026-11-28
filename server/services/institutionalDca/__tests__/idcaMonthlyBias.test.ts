import { describe, expect, it } from "vitest";
import { resolveMonthlyBiasSizeProfile } from "../IdcaMonthlyBias";
import { getSizeWeights } from "../IdcaSmartLayer";

describe("override VWAP mensual aggressive_quality", () => {
  it("precio 5.01% bajo VWAP mensual convierte defensive en aggressive_quality y duplica la base", () => {
    const result = resolveMonthlyBiasSizeProfile(94.99, 100, "defensive");
    expect(result.monthlyBias).toBe("aggressive");
    expect(result.sizeProfile).toBe("aggressive_quality");

    const aggressiveBase = getSizeWeights("aggressive_quality", 4)[0];
    const defensiveBase = getSizeWeights("defensive", 4)[0];
    expect(aggressiveBase).toBe(30);
    expect(defensiveBase).toBe(15);
    expect(aggressiveBase / defensiveBase).toBe(2);
  });

  it("en el borde exacto -5% no aplica override agresivo y entre -5% y VWAP conserva perfil", () => {
    expect(resolveMonthlyBiasSizeProfile(95, 100, "defensive")).toEqual({
      monthlyBias: "balanced",
      sizeProfile: "defensive",
    });
    expect(resolveMonthlyBiasSizeProfile(99.99, 100, "balanced")).toEqual({
      monthlyBias: "balanced",
      sizeProfile: "balanced",
    });
  });

  it("sobre VWAP mensual fuerza defensive; sin VWAP no opina", () => {
    expect(resolveMonthlyBiasSizeProfile(100, 100, "aggressive_quality")).toEqual({
      monthlyBias: "defensive",
      sizeProfile: "defensive",
    });
    expect(resolveMonthlyBiasSizeProfile(80, undefined, "balanced")).toEqual({
      monthlyBias: "unknown",
      sizeProfile: "balanced",
    });
  });
});
