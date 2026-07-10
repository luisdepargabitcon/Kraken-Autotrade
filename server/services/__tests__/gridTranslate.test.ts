import { describe, it, expect } from "vitest";
import { translateGridLabel, gridDisplayStatus, SHADOW_EXPLANATION, ANALYZE_NOW_EXPLANATION } from "@/lib/gridTranslate";

describe("translateGridLabel", () => {
  it("traduce modos correctamente", () => {
    expect(translateGridLabel("OFF")).toBe("Apagado");
    expect(translateGridLabel("SHADOW")).toBe("Simulación (SHADOW)");
    expect(translateGridLabel("REAL_LIMITED")).toBe("Real limitado");
  });

  it("traduce estados de ciclo", () => {
    // 'open' is shared with level statuses and maps to 'Activo'
    // GridCyclesPanel uses CYCLE_STATUS_OVERRIDES for cycle-specific 'Abierto'
    expect(translateGridLabel("completed")).toBe("Cerrado con beneficio");
    expect(translateGridLabel("cancelled")).toBe("Cancelado");
    expect(translateGridLabel("buy_filled")).toBe("Compra simulada");
    expect(translateGridLabel("error")).toBe("Error");
  });

  it("traduce estados de nivel", () => {
    expect(translateGridLabel("planned")).toBe("Planificado");
    expect(translateGridLabel("filled")).toBe("Ejecutado");
    expect(translateGridLabel("replaced")).toBe("Reemplazado (rango anterior)");
    expect(translateGridLabel("expired")).toBe("Expirado (archivado)");
  });

  it("traduce estados de lifecycle", () => {
    expect(translateGridLabel("reusable")).toBe("Válido y reutilizable");
    expect(translateGridLabel("needs_adaptive_validation")).toBe("Necesita validación (analizar ahora)");
    expect(translateGridLabel("protected_by_open_cycles")).toBe("Protegido por ciclos abiertos");
  });

  it("devuelve el valor original si no hay traducción", () => {
    expect(translateGridLabel("unknown_term")).toBe("unknown_term");
  });

  it("devuelve — para null/undefined", () => {
    expect(translateGridLabel(null)).toBe("—");
    expect(translateGridLabel(undefined)).toBe("—");
  });

  it("es insensible a mayúsculas/minúsculas", () => {
    expect(translateGridLabel("shadow")).toBe("Simulación (SHADOW)");
    expect(translateGridLabel("Shadow")).toBe("Simulación (SHADOW)");
  });
});

describe("gridDisplayStatus", () => {
  it("reusable => green/check", () => {
    const ds = gridDisplayStatus("reusable");
    expect(ds.color).toBe("green");
    expect(ds.icon).toBe("check");
  });

  it("needs_adaptive_validation => amber/alert", () => {
    const ds = gridDisplayStatus("needs_adaptive_validation");
    expect(ds.color).toBe("amber");
    expect(ds.icon).toBe("alert");
  });

  it("invalid_price_outside => red/x", () => {
    const ds = gridDisplayStatus("invalid_price_outside");
    expect(ds.color).toBe("red");
    expect(ds.icon).toBe("x");
  });

  it("protected_by_open_cycles => blue/shield", () => {
    const ds = gridDisplayStatus("protected_by_open_cycles");
    expect(ds.color).toBe("blue");
    expect(ds.icon).toBe("shield");
  });

  it("unknown status => muted/info", () => {
    const ds = gridDisplayStatus("nonexistent_status");
    expect(ds.color).toBe("muted");
    expect(ds.icon).toBe("info");
  });
});

describe("SHADOW_EXPLANATION y ANALYZE_NOW_EXPLANATION", () => {
  it("SHADOW_EXPLANATION contiene texto explicativo", () => {
    expect(SHADOW_EXPLANATION).toContain("simulación");
    expect(SHADOW_EXPLANATION).toContain("no envía órdenes reales");
  });

  it("ANALYZE_NOW_EXPLANATION contiene texto explicativo", () => {
    expect(ANALYZE_NOW_EXPLANATION).toContain("solo lectura");
    expect(ANALYZE_NOW_EXPLANATION).toContain("no modifica");
  });
});
