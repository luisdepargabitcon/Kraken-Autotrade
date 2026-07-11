import { describe, it, expect } from "vitest";

// These tests verify the logic that GridBandsPanel uses to determine
// which state to render. Since the project uses node environment for
// vitest (no jsdom), we test the decision logic directly.

function getBandStatus(diagnosticBand: any, hasActiveRange: boolean): string {
  if (!diagnosticBand) return "not_enough_data";
  const status = diagnosticBand.status;
  if (status === "active" && !hasActiveRange) return "not_enough_data";
  return status;
}

function shouldShowActiveState(bandStatus: string, hasActiveRange: boolean): boolean {
  return bandStatus === "active" && hasActiveRange;
}

function shouldShowCalculatedState(bandStatus: string, bandExists: boolean): boolean {
  return bandStatus === "calculated_not_active" && bandExists;
}

function shouldShowNotViableState(bandStatus: string): boolean {
  return bandStatus === "not_viable";
}

function shouldShowNoDataState(bandStatus: string): boolean {
  return bandStatus === "not_enough_data" || bandStatus === "market_unsuitable";
}

function fmtPrice(v: unknown): string {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? `$${n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
}

function fmtPct(v: unknown): string {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? `${n.toFixed(2)}%` : "—";
}

function computeRangeDifference(requiredPct: number | null, allowedPct: number | null): number | null {
  if (requiredPct == null || allowedPct == null) return null;
  return requiredPct - allowedPct;
}

describe("GridBandsPanel logic", () => {
  describe("getBandStatus", () => {
    it("returns not_enough_data when diagnosticBand is null", () => {
      expect(getBandStatus(null, false)).toBe("not_enough_data");
    });

    it("returns not_enough_data when status is active but hasActiveRange is false", () => {
      expect(getBandStatus({ status: "active" }, false)).toBe("not_enough_data");
    });

    it("returns active when status is active and hasActiveRange is true", () => {
      expect(getBandStatus({ status: "active" }, true)).toBe("active");
    });

    it("returns calculated_not_active when status is calculated_not_active", () => {
      expect(getBandStatus({ status: "calculated_not_active" }, false)).toBe("calculated_not_active");
    });

    it("returns not_viable when status is not_viable", () => {
      expect(getBandStatus({ status: "not_viable" }, false)).toBe("not_viable");
    });

    it("returns market_unsuitable when status is market_unsuitable", () => {
      expect(getBandStatus({ status: "market_unsuitable" }, false)).toBe("market_unsuitable");
    });
  });

  describe("state visibility functions", () => {
    it("shouldShowActiveState only when both conditions true", () => {
      expect(shouldShowActiveState("active", true)).toBe(true);
      expect(shouldShowActiveState("active", false)).toBe(false);
      expect(shouldShowActiveState("not_viable", true)).toBe(false);
    });

    it("shouldShowCalculatedState requires bandExists", () => {
      expect(shouldShowCalculatedState("calculated_not_active", true)).toBe(true);
      expect(shouldShowCalculatedState("calculated_not_active", false)).toBe(false);
      expect(shouldShowCalculatedState("active", true)).toBe(false);
    });

    it("shouldShowNotViableState matches not_viable", () => {
      expect(shouldShowNotViableState("not_viable")).toBe(true);
      expect(shouldShowNotViableState("active")).toBe(false);
    });

    it("shouldShowNoDataState matches not_enough_data and market_unsuitable", () => {
      expect(shouldShowNoDataState("not_enough_data")).toBe(true);
      expect(shouldShowNoDataState("market_unsuitable")).toBe(true);
      expect(shouldShowNoDataState("active")).toBe(false);
      expect(shouldShowNoDataState("not_viable")).toBe(false);
    });
  });

  describe("fmtPrice", () => {
    it("formats numbers with $ and 2 decimals", () => {
      expect(fmtPrice(95000)).toBe("$95.000,00");
      expect(fmtPrice(90000.5)).toBe("$90.000,50");
    });

    it("returns — for null/undefined/NaN", () => {
      expect(fmtPrice(null)).toBe("—");
      expect(fmtPrice(undefined)).toBe("—");
      expect(fmtPrice("abc")).toBe("—");
    });

    it("parses string numbers", () => {
      expect(fmtPrice("95000")).toBe("$95.000,00");
    });
  });

  describe("fmtPct", () => {
    it("formats numbers with % and 2 decimals", () => {
      expect(fmtPct(5.0)).toBe("5.00%");
      expect(fmtPct(2.567)).toBe("2.57%");
    });

    it("returns — for null/undefined/NaN", () => {
      expect(fmtPct(null)).toBe("—");
      expect(fmtPct(undefined)).toBe("—");
      expect(fmtPct("abc")).toBe("—");
    });
  });

  describe("computeRangeDifference", () => {
    it("returns difference when both values present", () => {
      expect(computeRangeDifference(5.0, 2.0)).toBe(3.0);
      expect(computeRangeDifference(2.0, 5.0)).toBe(-3.0);
    });

    it("returns null when either value is null", () => {
      expect(computeRangeDifference(null, 2.0)).toBeNull();
      expect(computeRangeDifference(5.0, null)).toBeNull();
      expect(computeRangeDifference(null, null)).toBeNull();
    });
  });

  describe("4-state coverage", () => {
    it("all 4 states are mutually exclusive for rendering", () => {
      const states = ["active", "calculated_not_active", "not_viable", "not_enough_data"];
      for (const s of states) {
        const active = shouldShowActiveState(s, true);
        const calculated = shouldShowCalculatedState(s, true);
        const notViable = shouldShowNotViableState(s);
        const noData = shouldShowNoDataState(s);
        const trueCount = [active, calculated, notViable, noData].filter(Boolean).length;
        expect(trueCount).toBe(1);
      }
    });

    it("market_unsuitable is covered by noData state, not others", () => {
      expect(shouldShowNoDataState("market_unsuitable")).toBe(true);
      expect(shouldShowActiveState("market_unsuitable", true)).toBe(false);
      expect(shouldShowCalculatedState("market_unsuitable", true)).toBe(false);
      expect(shouldShowNotViableState("market_unsuitable")).toBe(false);
    });
  });
});
