import { describe, it, expect } from "vitest";
import {
  formatFiscoEngineModeLabel,
  formatFiscoEngineModeDescription,
  formatFiscoBlockerLabel,
  formatFiscoWarningLabel,
  formatFiscoStatusLabel,
  formatFiscoImportStatusLabel,
  formatFiscoComparisonMetricLabel,
  formatFiscoDiffCauseLabel,
  formatEur,
  formatEurSigned,
  FiscoEngineMode,
} from "@/components/fisco/fiscoLabels";

describe("fiscoLabels — helpers de traducción castellano", () => {
  describe("formatFiscoEngineModeLabel", () => {
    it("traduce legacy a 'Motor actual'", () => {
      expect(formatFiscoEngineModeLabel("legacy")).toBe("Motor actual");
    });
    it("traduce v2_shadow a 'V2 en sombra'", () => {
      expect(formatFiscoEngineModeLabel("v2_shadow")).toBe("V2 en sombra");
    });
    it("traduce v2_official a 'V2 oficial'", () => {
      expect(formatFiscoEngineModeLabel("v2_official")).toBe("V2 oficial");
    });
    it("devuelve el original si no reconoce el modo", () => {
      expect(formatFiscoEngineModeLabel("unknown_mode" as FiscoEngineMode)).toBe("unknown_mode");
    });
  });

  describe("formatFiscoEngineModeDescription", () => {
    it("devuelve descripción para legacy", () => {
      const desc = formatFiscoEngineModeDescription("legacy");
      expect(desc).toContain("Motor FIFO");
      expect(desc).toContain("oficial");
    });
    it("devuelve descripción para v2_shadow", () => {
      const desc = formatFiscoEngineModeDescription("v2_shadow");
      expect(desc).toContain("paralelo");
      expect(desc).toContain("oficial");
    });
    it("devuelve descripción para v2_official", () => {
      const desc = formatFiscoEngineModeDescription("v2_official");
      expect(desc).toContain("bloqueos");
    });
  });

  describe("formatFiscoBlockerLabel", () => {
    it("traduce GROSS_GAINS_LOSSES_DIFF_EXCESSIVE", () => {
      const label = formatFiscoBlockerLabel("GROSS_GAINS_LOSSES_DIFF_EXCESSIVE");
      expect(label).toContain("Diferencia bruta");
      expect(label).toContain("excesiva");
    });
    it("traduce ENGINE_NOT_FULL_V2", () => {
      const label = formatFiscoBlockerLabel("ENGINE_NOT_FULL_V2");
      expect(label).toContain("motor V2");
      expect(label).toContain("completo");
    });
    it("traduce DISPOSALS_COUNT_DIFF", () => {
      const label = formatFiscoBlockerLabel("DISPOSALS_COUNT_DIFF");
      expect(label).toContain("disposiciones");
    });
    it("traduce SELL_WITHOUT_COST_BASIS", () => {
      const label = formatFiscoBlockerLabel("SELL_WITHOUT_COST_BASIS");
      expect(label).toContain("Venta sin base de coste");
    });
    it("traduce REWARD_WITHOUT_PRICE", () => {
      const label = formatFiscoBlockerLabel("REWARD_WITHOUT_PRICE");
      expect(label).toContain("Recompensa sin precio");
    });
    it("traduce BLOCKER con sufijo dinámico (DISPOSALS_COUNT_DIFF:5)", () => {
      const label = formatFiscoBlockerLabel("DISPOSALS_COUNT_DIFF: 5");
      expect(label).toContain("disposiciones");
      expect(label).toContain("5");
    });
    it("devuelve el original si no reconoce el código", () => {
      expect(formatFiscoBlockerLabel("UNKNOWN_CODE")).toBe("UNKNOWN_CODE");
    });
  });

  describe("formatFiscoWarningLabel", () => {
    it("traduce GROSS_GAINS_LOSSES_DIFF", () => {
      const label = formatFiscoWarningLabel("GROSS_GAINS_LOSSES_DIFF");
      expect(label).toContain("ganancias/pérdidas brutas");
    });
    it("traduce MULTI_YEAR_CSV", () => {
      const label = formatFiscoWarningLabel("MULTI_YEAR_CSV");
      expect(label).toContain("múltiples años");
    });
    it("traduce warning con sufijo dinámico", () => {
      const label = formatFiscoWarningLabel("MULTI_YEAR_CSV: 2024,2025");
      expect(label).toContain("múltiples años");
      expect(label).toContain("2024,2025");
    });
  });

  describe("formatFiscoStatusLabel", () => {
    it("traduce FINALIZABLE", () => {
      expect(formatFiscoStatusLabel("FINALIZABLE")).toBe("Finalizable");
    });
    it("traduce NO_FINALIZABLE", () => {
      expect(formatFiscoStatusLabel("NO_FINALIZABLE")).toBe("No finalizable");
    });
    it("traduce V2_OFICIAL_BLOQUEADO", () => {
      expect(formatFiscoStatusLabel("V2_OFICIAL_BLOQUEADO")).toBe("V2 oficial bloqueado");
    });
  });

  describe("formatFiscoImportStatusLabel", () => {
    it("traduce ok", () => {
      expect(formatFiscoImportStatusLabel("ok")).toBe("Correcto");
    });
    it("traduce warning", () => {
      expect(formatFiscoImportStatusLabel("warning")).toBe("Aviso");
    });
    it("traduce error", () => {
      expect(formatFiscoImportStatusLabel("error")).toBe("Error");
    });
    it("traduce duplicate", () => {
      expect(formatFiscoImportStatusLabel("duplicate")).toBe("Duplicado");
    });
    it("traduce skipped", () => {
      expect(formatFiscoImportStatusLabel("skipped")).toBe("Saltado");
    });
  });

  describe("formatFiscoComparisonMetricLabel", () => {
    it("traduce net_gain_loss_eur", () => {
      expect(formatFiscoComparisonMetricLabel("net_gain_loss_eur")).toBe("Ganancia/pérdida neta");
    });
    it("traduce gross_gains_diff_eur", () => {
      expect(formatFiscoComparisonMetricLabel("gross_gains_diff_eur")).toBe("Diferencia en ganancias brutas");
    });
    it("traduce disposals_count_diff", () => {
      expect(formatFiscoComparisonMetricLabel("disposals_count_diff")).toBe("Diferencia en número de disposiciones");
    });
  });

  describe("formatFiscoDiffCauseLabel", () => {
    it("traduce rounding_or_fee", () => {
      expect(formatFiscoDiffCauseLabel("rounding_or_fee")).toBe("Redondeo o comisiones");
    });
    it("traduce cost_basis_diff", () => {
      expect(formatFiscoDiffCauseLabel("cost_basis_diff")).toBe("Base de coste FIFO distinta");
    });
    it("traduce v2_higher_gain", () => {
      expect(formatFiscoDiffCauseLabel("v2_higher_gain")).toBe("V2 calcula mayor ganancia");
    });
    it("traduce v2_higher_loss", () => {
      expect(formatFiscoDiffCauseLabel("v2_higher_loss")).toBe("V2 calcula mayor pérdida");
    });
    it("traduce unknown", () => {
      expect(formatFiscoDiffCauseLabel("unknown")).toBe("Causa desconocida");
    });
  });

  describe("formatEur", () => {
    it("formatea cantidad positiva en EUR con formato es-ES", () => {
      const result = formatEur(1234.56);
      expect(result).toContain("34,56");
      expect(result).toContain("€");
    });
    it("formatea cantidad negativa", () => {
      const result = formatEur(-500.0);
      expect(result).toContain("500,00");
      expect(result).toContain("€");
    });
    it("formatea cero", () => {
      const result = formatEur(0);
      expect(result).toContain("0,00");
      expect(result).toContain("€");
    });
  });

  describe("formatEurSigned", () => {
    it("añade signo + para cantidades positivas", () => {
      const result = formatEurSigned(100);
      expect(result.startsWith("+")).toBe(true);
      expect(result).toContain("100,00");
    });
    it("añade signo - para cantidades negativas", () => {
      const result = formatEurSigned(-50);
      expect(result.startsWith("-")).toBe(true);
      expect(result).toContain("50,00");
    });
    it("trata cero como positivo", () => {
      const result = formatEurSigned(0);
      expect(result.startsWith("+")).toBe(true);
    });
  });
});
