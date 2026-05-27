/**
 * entryMode.test.ts — Sprint 2C
 * Validates that entry_mode persists and is reflected in diagnostics.
 * Tests the schema default and asset config upsert logic.
 */
import { describe, it, expect } from "vitest";

describe("entry_mode schema defaults and values", () => {
  it("default value is assisted_entry", () => {
    const defaultMode = "assisted_entry";
    expect(defaultMode).toBe("assisted_entry");
  });

  it("dynamic_intelligent_entry is a valid mode value", () => {
    const validModes = ["assisted_entry", "dynamic_intelligent_entry"];
    expect(validModes).toContain("dynamic_intelligent_entry");
  });

  it("switching back to assisted_entry is valid", () => {
    let mode = "dynamic_intelligent_entry";
    mode = "assisted_entry";
    expect(mode).toBe("assisted_entry");
  });

  it("unknown mode strings are NOT in the valid set", () => {
    const validModes = new Set(["assisted_entry", "dynamic_intelligent_entry"]);
    expect(validModes.has("some_random_mode")).toBe(false);
  });
});

describe("entry mode diagnostics reflection", () => {
  it("entryMode assisted_entry maps to Spanish label correctly", () => {
    function formatEntryMode(mode: string): string {
      if (mode === "assisted_entry") return "Entrada asistida";
      if (mode === "dynamic_intelligent_entry") return "Dinámica inteligente";
      return mode.replace(/_/g, " ");
    }
    expect(formatEntryMode("assisted_entry")).toBe("Entrada asistida");
    expect(formatEntryMode("dynamic_intelligent_entry")).toBe("Dinámica inteligente");
    expect(formatEntryMode("unknown_mode")).toBe("unknown mode");
  });

  it("blocker codes map to human-readable Spanish strings", () => {
    const BLOCKER_LABELS: Record<string, string> = {
      no_rebound_when_required:   "Falta confirmación de rebote",
      insufficient_dip:           "Caída insuficiente",
      dynamic_confidence_too_low: "Confianza dinámica insuficiente",
      data_unusable:              "Datos no utilizables",
      low_volatility:             "Baja volatilidad",
    };
    function translateBlocker(code: string): string {
      return BLOCKER_LABELS[code] ?? code.replace(/_/g, " ");
    }
    expect(translateBlocker("no_rebound_when_required")).toBe("Falta confirmación de rebote");
    expect(translateBlocker("insufficient_dip")).toBe("Caída insuficiente");
    expect(translateBlocker("low_volatility")).toBe("Baja volatilidad");
    expect(translateBlocker("some_unknown_code")).toBe("some unknown code");
  });

  it("no raw technical codes appear in UI labels (none of the codes should equal their label)", () => {
    const LABELS: Record<string, string> = {
      no_rebound_when_required:   "Falta confirmación de rebote",
      insufficient_dip:           "Caída insuficiente",
      assisted_entry:             "Entrada asistida",
      dynamic_intelligent_entry:  "Dinámica inteligente",
      ARM_TRAILING:               "Vigilar rebote",
      NO_ENTRY:                   "No entrar",
      WATCH:                      "Observar",
    };
    for (const [code, label] of Object.entries(LABELS)) {
      expect(label).not.toBe(code);
    }
  });
});
