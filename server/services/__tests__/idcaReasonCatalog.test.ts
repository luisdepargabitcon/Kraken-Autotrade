/**
 * Tests específicos para IdcaReasonCatalog
 * Validan: humanTitle correcto, sin espacios iniciales, sin términos legacy
 */

import { describe, it, expect } from "vitest";
import { getCatalogEntry, IDCA_EVENT_CATALOG } from "../institutionalDca/IdcaReasonCatalog";

describe("IdcaReasonCatalog - mapper de reasons", () => {
  describe("reasons principales existen", () => {
    it("entry_check_passed devuelve título humano", () => {
      const entry = getCatalogEntry("entry_check_passed");
      expect(entry).not.toBeNull();
      expect(entry!.humanTitle).toBeTruthy();
    });

    it("entry_check_blocked devuelve título humano", () => {
      const entry = getCatalogEntry("entry_check_blocked");
      expect(entry).not.toBeNull();
      expect(entry!.humanTitle).toBeTruthy();
    });

    it("insufficient_dip devuelve título humano", () => {
      const entry = getCatalogEntry("insufficient_dip");
      expect(entry).not.toBeNull();
      expect(entry!.humanTitle).toBeTruthy();
    });

    it("no_rebound_confirmed devuelve título humano", () => {
      const entry = getCatalogEntry("no_rebound_confirmed");
      expect(entry).not.toBeNull();
      expect(entry!.humanTitle).toBeTruthy();
    });

    it("market_score_too_low devuelve título humano", () => {
      const entry = getCatalogEntry("market_score_too_low");
      expect(entry).not.toBeNull();
      expect(entry!.humanTitle).toBeTruthy();
    });

    it("breakdown_detected devuelve título humano", () => {
      const entry = getCatalogEntry("breakdown_detected");
      expect(entry).not.toBeNull();
      expect(entry!.humanTitle).toBeTruthy();
    });

    it("spread_too_high devuelve título humano", () => {
      const entry = getCatalogEntry("spread_too_high");
      expect(entry).not.toBeNull();
      expect(entry!.humanTitle).toBeTruthy();
    });

    it("sell_pressure_too_high devuelve título humano", () => {
      const entry = getCatalogEntry("sell_pressure_too_high");
      expect(entry).not.toBeNull();
      expect(entry!.humanTitle).toBeTruthy();
    });
  });

  describe("humanTitle validación", () => {
    it("ningún humanTitle empieza por espacio", () => {
      const entries = Object.values(IDCA_EVENT_CATALOG);
      for (const entry of entries) {
        expect(entry.humanTitle).not.toMatch(/^\s/);
      }
    });

    it("ningún humanTitle contiene 'undefined'", () => {
      const entries = Object.values(IDCA_EVENT_CATALOG);
      for (const entry of entries) {
        expect(entry.humanTitle).not.toContain("undefined");
      }
    });

    it("ningún humanTitle contiene 'null'", () => {
      const entries = Object.values(IDCA_EVENT_CATALOG);
      for (const entry of entries) {
        expect(entry.humanTitle).not.toContain("null");
      }
    });

    it("ningún humanTitle contiene 'NaN'", () => {
      const entries = Object.values(IDCA_EVENT_CATALOG);
      for (const entry of entries) {
        expect(entry.humanTitle).not.toContain("NaN");
      }
    });

    it("ningún humanTemplate contiene 'undefined'", () => {
      const entries = Object.values(IDCA_EVENT_CATALOG);
      for (const entry of entries) {
        expect(entry.humanTemplate).not.toContain("undefined");
      }
    });

    it("ningún humanTemplate contiene 'null'", () => {
      const entries = Object.values(IDCA_EVENT_CATALOG);
      for (const entry of entries) {
        expect(entry.humanTemplate).not.toContain("null");
      }
    });
  });

  describe("sin prefijo repetitivo 'Compra bloqueada:'", () => {
    it("insufficient_dip NO tiene prefijo 'Compra bloqueada:'", () => {
      const entry = getCatalogEntry("insufficient_dip");
      expect(entry!.humanTitle).not.toContain("Compra bloqueada:");
    });

    it("no_rebound_confirmed NO tiene prefijo 'Compra bloqueada:'", () => {
      const entry = getCatalogEntry("no_rebound_confirmed");
      expect(entry!.humanTitle).not.toContain("Compra bloqueada:");
    });

    it("market_score_too_low NO tiene prefijo 'Compra bloqueada:'", () => {
      const entry = getCatalogEntry("market_score_too_low");
      expect(entry!.humanTitle).not.toContain("Compra bloqueada:");
    });
  });

  describe("insufficient_dip - terminología correcta", () => {
    it("debe referirse a caída mínima desde precio de referencia de entrada", () => {
      const entry = getCatalogEntry("insufficient_dip");
      const text = `${entry!.humanTitle} ${entry!.humanTemplate}`.toLowerCase();
      // Debe hablar de caída mínima o referencia de entrada
      const hasCorrectTerminology =
        text.includes("caída") ||
        text.includes("referencia") ||
        text.includes("mínima");
      expect(hasCorrectTerminology).toBe(true);
    });
  });

  describe("no_rebound_confirmed - terminología correcta", () => {
    it("debe referirse a falta confirmación de rebote", () => {
      const entry = getCatalogEntry("no_rebound_confirmed");
      const text = `${entry!.humanTitle} ${entry!.humanTemplate}`.toLowerCase();
      const hasRebound = text.includes("rebote") || text.includes("confirmación");
      expect(hasRebound).toBe(true);
    });
  });

  describe("market_score_too_low - terminología correcta", () => {
    it("debe referirse a score de mercado bajo", () => {
      const entry = getCatalogEntry("market_score_too_low");
      const text = `${entry!.humanTitle} ${entry!.humanTemplate}`.toLowerCase();
      const hasScore = text.includes("score") || text.includes("mercado");
      expect(hasScore).toBe(true);
    });
  });

  describe("exposure/spread/sell pressure son claros", () => {
    it("spread_too_high describe claramente el problema", () => {
      const entry = getCatalogEntry("spread_too_high");
      expect(entry!.humanTitle.length).toBeGreaterThan(3);
      expect(entry!.humanTemplate.length).toBeGreaterThan(10);
    });

    it("sell_pressure_too_high describe claramente el problema", () => {
      const entry = getCatalogEntry("sell_pressure_too_high");
      expect(entry!.humanTitle.length).toBeGreaterThan(3);
      expect(entry!.humanTemplate.length).toBeGreaterThan(10);
    });

    it("combined_exposure_exceeded describe claramente el problema", () => {
      const entry = getCatalogEntry("combined_exposure_exceeded");
      expect(entry!.humanTitle.length).toBeGreaterThan(3);
      expect(entry!.humanTemplate.length).toBeGreaterThan(10);
    });
  });
});
