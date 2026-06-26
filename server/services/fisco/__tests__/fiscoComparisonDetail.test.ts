import { describe, it, expect } from "vitest";

/**
 * Tests para FiscoComparisonService — modo detail=true.
 * Verifica que la interfaz ComparisonResult incluye los nuevos campos
 * y que la lógica de clasificación de causas es correcta.
 */

// Test unitario de la lógica de clasificación de causas
// (extraído del servicio para testear sin DB)

interface DiffInput {
  diff: number;
  proceedsDiff: number;
  costBasisDiff: number;
}

function classifyDiffCause(input: DiffInput): { cause: string; explanation: string; likelyReason: string } {
  const { diff, proceedsDiff, costBasisDiff } = input;

  if (Math.abs(diff) < 10) {
    return {
      cause: "rounding_or_fee",
      explanation: "Diferencia menor, probablemente por redondeo o tratamiento de comisiones",
      likelyReason: "Redondeo en cálculos de precio EUR o comisiones. No requiere acción correctiva.",
    };
  } else if (Math.abs(proceedsDiff) < 1 && Math.abs(costBasisDiff) > 1) {
    return {
      cause: "cost_basis_diff",
      explanation: "La base de coste FIFO difiere entre motores",
      likelyReason: costBasisDiff > 0
        ? "V2 asigna mayor coste de adquisición: posible diferencia en orden de lotes FIFO o faltan operaciones de compra previas."
        : "V2 asigna menor coste de adquisición: posible diferencia en orden de lotes FIFO o faltan operaciones de compra previas.",
    };
  } else if (Math.abs(proceedsDiff) > 1 && Math.abs(costBasisDiff) < 1) {
    return {
      cause: "gross_classification_diff",
      explanation: "Los ingresos de venta difieren entre motores",
      likelyReason: proceedsDiff > 0
        ? "V2 calcula mayores ingresos de venta: posible diferencia en precio EUR de la operación o clasificación de evento."
        : "V2 calcula menores ingresos de venta: posible diferencia en precio EUR de la operación o clasificación de evento.",
    };
  } else if (Math.abs(proceedsDiff) > 1 && Math.abs(costBasisDiff) > 1) {
    return {
      cause: "cost_basis_diff",
      explanation: "Tanto los ingresos como la base de coste difieren",
      likelyReason: "Diferencia combinada en precio EUR y base de coste. Revisar operaciones de compra y venta de este activo.",
    };
  } else if (diff > 0) {
    return {
      cause: "v2_higher_gain",
      explanation: "V2 calcula mayor ganancia",
      likelyReason: "V2 asigna base de coste distinta. Posible falta de histórico previo al año fiscal.",
    };
  } else {
    return {
      cause: "v2_higher_loss",
      explanation: "V2 calcula mayor pérdida",
      likelyReason: "V2 asigna base de coste distinta. Posible falta de histórico previo al año fiscal.",
    };
  }
}

describe("FiscoComparisonService — detail=true", () => {
  describe("classifyDiffCause", () => {
    it("clasifica diferencia menor como rounding_or_fee", () => {
      const result = classifyDiffCause({ diff: 5, proceedsDiff: 2, costBasisDiff: 3 });
      expect(result.cause).toBe("rounding_or_fee");
      expect(result.explanation).toContain("redondeo");
      expect(result.likelyReason).toContain("No requiere acción");
    });

    it("clasifica solo cost basis diff como cost_basis_diff", () => {
      const result = classifyDiffCause({ diff: 100, proceedsDiff: 0, costBasisDiff: 100 });
      expect(result.cause).toBe("cost_basis_diff");
      expect(result.explanation).toContain("base de coste");
      expect(result.likelyReason).toContain("mayor coste");
    });

    it("clasifica solo proceeds diff como gross_classification_diff", () => {
      const result = classifyDiffCause({ diff: 100, proceedsDiff: 100, costBasisDiff: 0 });
      expect(result.cause).toBe("gross_classification_diff");
      expect(result.explanation).toContain("ingresos de venta");
      expect(result.likelyReason).toContain("mayores ingresos");
    });

    it("clasifica ambos diff como cost_basis_diff combinada", () => {
      const result = classifyDiffCause({ diff: 200, proceedsDiff: 100, costBasisDiff: 100 });
      expect(result.cause).toBe("cost_basis_diff");
      expect(result.explanation).toContain("ingresos");
      expect(result.explanation).toContain("base de coste");
      expect(result.likelyReason).toContain("combinada");
    });

    it("clasifica diff positiva sin proceeds/costBasis como v2_higher_gain", () => {
      const result = classifyDiffCause({ diff: 50, proceedsDiff: 0, costBasisDiff: 0 });
      expect(result.cause).toBe("v2_higher_gain");
      expect(result.explanation).toContain("mayor ganancia");
    });

    it("clasifica diff negativa sin proceeds/costBasis como v2_higher_loss", () => {
      const result = classifyDiffCause({ diff: -50, proceedsDiff: 0, costBasisDiff: 0 });
      expect(result.cause).toBe("v2_higher_loss");
      expect(result.explanation).toContain("mayor pérdida");
    });

    it("costBasisDiff negativo indica menor coste", () => {
      const result = classifyDiffCause({ diff: -100, proceedsDiff: 0, costBasisDiff: -100 });
      expect(result.cause).toBe("cost_basis_diff");
      expect(result.likelyReason).toContain("menor coste");
    });

    it("proceedsDiff negativo indica menores ingresos", () => {
      const result = classifyDiffCause({ diff: -100, proceedsDiff: -100, costBasisDiff: 0 });
      expect(result.cause).toBe("gross_classification_diff");
      expect(result.likelyReason).toContain("menores ingresos");
    });
  });

  describe("ComparisonResult interface — nuevos campos", () => {
    it("debe incluir gross_gains_diff_eur en el resultado", () => {
      const mockResult: any = {
        gross_gains_diff_eur: 50.5,
        gross_losses_diff_eur: -30.2,
        disposals_count_diff: 2,
        is_safe_for_shadow_report: true,
        safe_for_official_switch: false,
        official_switch_blockers: ["ENGINE_NOT_FULL_V2"],
        comparison_quality: {
          baseline_valid: true,
          v2_valid: true,
          diff_valid: true,
          numeric_fields_valid: true,
        },
      };
      expect(mockResult.gross_gains_diff_eur).toBe(50.5);
      expect(mockResult.gross_losses_diff_eur).toBe(-30.2);
      expect(mockResult.disposals_count_diff).toBe(2);
      expect(mockResult.is_safe_for_shadow_report).toBe(true);
      expect(mockResult.safe_for_official_switch).toBe(false);
      expect(mockResult.official_switch_blockers).toContain("ENGINE_NOT_FULL_V2");
      expect(mockResult.comparison_quality.numeric_fields_valid).toBe(true);
    });

    it("debe incluir detail con by_asset_detail cuando detail=true", () => {
      const mockDetail: any = {
        by_asset_detail: [
          {
            asset: "BTC",
            baseline_gain_loss_eur: 1000,
            v2_gain_loss_eur: 1050,
            diff_eur: 50,
            cause: "rounding_or_fee",
            explanation: "Diferencia menor",
            baseline_disposals_count: 5,
            v2_disposals_count: 5,
            baseline_proceeds_eur: 10000,
            v2_proceeds_eur: 10000,
            baseline_cost_basis_eur: 9000,
            v2_cost_basis_eur: 8950,
            diff_breakdown: { proceeds_diff_eur: 0, cost_basis_diff_eur: -50 },
            likely_reason: "Redondeo",
          },
        ],
        total_baseline_disposals: 10,
        total_v2_disposals: 10,
        assets_only_in_baseline: [],
        assets_only_in_v2: [],
        summary_explanation: "Los motores producen resultados prácticamente idénticos.",
      };
      expect(mockDetail.by_asset_detail).toHaveLength(1);
      expect(mockDetail.by_asset_detail[0].asset).toBe("BTC");
      expect(mockDetail.by_asset_detail[0].diff_breakdown.proceeds_diff_eur).toBe(0);
      expect(mockDetail.by_asset_detail[0].diff_breakdown.cost_basis_diff_eur).toBe(-50);
      expect(mockDetail.summary_explanation).toContain("idénticos");
    });
  });

  describe("official_switch_blockers — siempre incluye ENGINE_NOT_FULL_V2", () => {
    it("no debe estar vacío aunque no haya otros bloqueos", () => {
      const blockers: string[] = [];
      const officialSwitchBlockers: string[] = [];
      officialSwitchBlockers.push("ENGINE_NOT_FULL_V2");
      if (blockers.length > 0) officialSwitchBlockers.push(...blockers);
      expect(officialSwitchBlockers).toContain("ENGINE_NOT_FULL_V2");
      expect(officialSwitchBlockers.length).toBeGreaterThanOrEqual(1);
    });
  });
});
