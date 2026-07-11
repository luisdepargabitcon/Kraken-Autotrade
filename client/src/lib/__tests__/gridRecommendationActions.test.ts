import { describe, it, expect } from "vitest";
import {
  buildTryRecommendationAction,
  buildGoToRecommendationTargetAction,
  getRecommendationPrimaryButtonLabel,
  getRecommendationSecondaryButtonLabel,
  sanitizeDiagnosticBandPricesForUi,
} from "../gridRecommendationActions";

describe("gridRecommendationActions", () => {
  describe("buildTryRecommendationAction", () => {
    it("returns the correct action shape", () => {
      const rec = {
        id: "test-rec",
        title: "Bajar objetivo neto",
        recommendedPatch: { netProfitTargetPct: 0.8 },
        targetField: "netProfitTargetPct",
      };

      const action = buildTryRecommendationAction(rec);

      expect(action.mainTab).toBe("ajustes");
      expect(action.settingsSubTab).toBe("avanzado");
      expect(action.patch).toEqual({ netProfitTargetPct: 0.8 });
      expect(action.focusField).toBe("netProfitTargetPct");
      expect(action.notice).toContain("Cambio aplicado en pantalla");
    });

    it("handles missing fields safely", () => {
      const action = buildTryRecommendationAction({});
      expect(action.mainTab).toBe("ajustes");
      expect(action.settingsSubTab).toBe("avanzado");
      expect(action.patch).toEqual({});
      expect(action.focusField).toBeNull();
      expect(action.notice).toContain("Cambio aplicado en pantalla");
    });
  });

  describe("buildGoToRecommendationTargetAction", () => {
    it("returns the correct navigation action without patch", () => {
      const rec = {
        id: "test-rec",
        targetField: "adaptiveRangeMaxPct",
      };

      const action = buildGoToRecommendationTargetAction(rec);

      expect(action.mainTab).toBe("ajustes");
      expect(action.settingsSubTab).toBe("avanzado");
      expect(action.patch).toBeNull();
      expect(action.focusField).toBe("adaptiveRangeMaxPct");
    });
  });

  describe("button labels", () => {
    it("primary label is fixed and not a legacy CTA", () => {
      const label = getRecommendationPrimaryButtonLabel();
      expect(label).toBe("Probar este ajuste");
      expect(label).not.toContain("Aplicar recomendación");
      expect(label).not.toContain("Aplicar al borrador");
      expect(label).not.toContain("Alinear al borrador");
    });

    it("secondary label is fixed and not a legacy CTA", () => {
      const label = getRecommendationSecondaryButtonLabel();
      expect(label).toBe("Ir al ajuste");
      expect(label).not.toContain("Aplicar recomendación");
      expect(label).not.toContain("Aplicar al borrador");
      expect(label).not.toContain("Alinear al borrador");
    });
  });

  describe("sanitizeDiagnosticBandPricesForUi", () => {
    it("recalculates zero lower/upper from center and finalRangePct", () => {
      const input = {
        lowerPrice: 0,
        upperPrice: 0,
        centerPrice: 64025,
        finalRangePct: 4.25,
      };

      const sanitized = sanitizeDiagnosticBandPricesForUi(input);

      expect(sanitized).not.toBeNull();
      expect(sanitized!.lowerPrice).toBeGreaterThan(0);
      expect(sanitized!.upperPrice).toBeGreaterThan(0);
      expect(sanitized!.widthPct).toBe(4.25);
      expect(sanitized!.lowerPrice).toBeCloseTo(62664, 0);
      expect(sanitized!.upperPrice).toBeCloseTo(65386, 0);
      expect(String(sanitized!.lowerPrice)).not.toContain("$0.00");
      expect(sanitized!.priceSource).toBe("diagnostic_orientative");
    });

    it("returns the original band when prices are already valid", () => {
      const input = {
        lowerPrice: 60000,
        upperPrice: 70000,
        centerPrice: 65000,
        finalRangePct: 4.25,
      };

      const sanitized = sanitizeDiagnosticBandPricesForUi(input);

      expect(sanitized).toEqual(input);
    });

    it("returns null/undefined input unchanged", () => {
      expect(sanitizeDiagnosticBandPricesForUi(null)).toBeNull();
      expect(sanitizeDiagnosticBandPricesForUi(undefined)).toBeUndefined();
    });
  });
});
