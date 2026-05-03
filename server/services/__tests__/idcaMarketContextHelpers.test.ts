/**
 * Tests unitarios para los helpers puros de IdcaMarketContextCard
 *
 * getFreshnessState    — 3 casos: realtime / recent / stale
 * getReferencePriceState — 2 casos: recently_changed / stable
 * getZoneVisual        — zona favorable / neutra / sobreextendida
 * buildMarketContextNarrative — varios escenarios
 */
import { describe, it, expect } from "vitest";

// Importamos los helpers puros desde el módulo TS sin React
import {
  getFreshnessState,
  getReferencePriceState,
  getZoneVisual,
  getAtrpLabel,
  buildMarketContextNarrative,
  formatAgeLabel,
} from "../../../client/src/components/idca/idcaMarketContextHelpers";

// ─── getFreshnessState ────────────────────────────────────────────────────────

describe("getFreshnessState", () => {
  it("MC01. <= 5 min → realtime", () => {
    const t = new Date(Date.now() - 3 * 60_000).toISOString();
    expect(getFreshnessState(t)).toBe("realtime");
  });

  it("MC02. 5-15 min → recent", () => {
    const t = new Date(Date.now() - 10 * 60_000).toISOString();
    expect(getFreshnessState(t)).toBe("recent");
  });

  it("MC03. > 15 min → stale", () => {
    const t = new Date(Date.now() - 20 * 60_000).toISOString();
    expect(getFreshnessState(t)).toBe("stale");
  });

  it("MC04. undefined → stale", () => {
    expect(getFreshnessState(undefined)).toBe("stale");
  });

  it("MC05. exactamente 5 min → realtime (edge)", () => {
    const t = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(getFreshnessState(t)).toBe("realtime");
  });

  it("MC06. exactamente 15 min → recent (edge)", () => {
    const t = new Date(Date.now() - 15 * 60_000).toISOString();
    expect(getFreshnessState(t)).toBe("recent");
  });
});

// ─── getReferencePriceState ───────────────────────────────────────────────────

describe("getReferencePriceState", () => {
  it("MC07. cambiado hace 2h → recently_changed", () => {
    const t = new Date(Date.now() - 2 * 3_600_000).toISOString();
    expect(getReferencePriceState(t)).toBe("recently_changed");
  });

  it("MC08. cambiado hace 25h → stable", () => {
    const t = new Date(Date.now() - 25 * 3_600_000).toISOString();
    expect(getReferencePriceState(t)).toBe("stable");
  });

  it("MC09. undefined → unknown", () => {
    expect(getReferencePriceState(undefined)).toBe("unknown");
  });

  it("MC10. exactamente 24h → stable (edge)", () => {
    const t = new Date(Date.now() - 24 * 3_600_000).toISOString();
    expect(getReferencePriceState(t)).toBe("stable");
  });
});

// ─── getZoneVisual ────────────────────────────────────────────────────────────

describe("getZoneVisual", () => {
  it("MC11. below_lower3 → favorable, label Valor profundo", () => {
    const v = getZoneVisual("below_lower3");
    expect(v.favorable).toBe(true);
    expect(v.label).toBe("Valor profundo");
    expect(v.position).toBeLessThan(20);
  });

  it("MC12. between_bands → no favorable, zona neutra", () => {
    const v = getZoneVisual("between_bands");
    expect(v.favorable).toBe(false);
    expect(v.label).toBe("Zona neutra");
    expect(v.position).toBe(50);
  });

  it("MC13. above_upper2 → no favorable, sobreextendido", () => {
    const v = getZoneVisual("above_upper2");
    expect(v.favorable).toBe(false);
    expect(v.position).toBeGreaterThan(70);
  });

  it("MC14. undefined → label Desconocido, position 50", () => {
    const v = getZoneVisual(undefined);
    expect(v.label).toBe("Desconocido");
    expect(v.position).toBe(50);
  });

  it("MC15. below_lower1 → favorable, Zona de valor", () => {
    const v = getZoneVisual("below_lower1");
    expect(v.favorable).toBe(true);
    expect(v.label).toBe("Zona de valor");
  });
});

// ─── getAtrpLabel ─────────────────────────────────────────────────────────────

describe("getAtrpLabel", () => {
  it("MC16. atrPct=1.0 → Bajo", () => {
    expect(getAtrpLabel(1.0).label).toBe("Bajo");
  });

  it("MC17. atrPct=2.5 → Medio", () => {
    expect(getAtrpLabel(2.5).label).toBe("Medio");
  });

  it("MC18. atrPct=5.0 → Alto", () => {
    expect(getAtrpLabel(5.0).label).toBe("Alto");
  });

  it("MC19. undefined → N/A", () => {
    expect(getAtrpLabel(undefined).label).toBe("N/A");
  });
});

// ─── buildMarketContextNarrative ─────────────────────────────────────────────

describe("buildMarketContextNarrative", () => {
  it("MC20. datos stale → título 'Datos desactualizados', icon alert", () => {
    const stale = new Date(Date.now() - 30 * 60_000).toISOString();
    const r = buildMarketContextNarrative({
      vwapZone: "between_bands",
      dataQuality: "good",
      drawdownPct: 5,
      lastUpdated: stale,
    });
    expect(r.title).toBe("Datos desactualizados");
    expect(r.icon).toBe("alert");
  });

  it("MC21. calidad poor → 'Datos a revisar', icon warning", () => {
    const fresh = new Date(Date.now() - 1 * 60_000).toISOString();
    const r = buildMarketContextNarrative({
      vwapZone: "between_bands",
      dataQuality: "poor",
      drawdownPct: 5,
      lastUpdated: fresh,
    });
    expect(r.title).toBe("Datos a revisar");
    expect(r.icon).toBe("warning");
  });

  it("MC22. zona below_lower3 → 'Contexto favorable', icon ok", () => {
    const fresh = new Date(Date.now() - 1 * 60_000).toISOString();
    const r = buildMarketContextNarrative({
      vwapZone: "below_lower3",
      dataQuality: "excellent",
      drawdownPct: 12,
      lastUpdated: fresh,
    });
    expect(r.title).toBe("Contexto favorable");
    expect(r.icon).toBe("ok");
  });

  it("MC23. zona between_bands → 'Contexto neutro', icon warning", () => {
    const fresh = new Date(Date.now() - 1 * 60_000).toISOString();
    const r = buildMarketContextNarrative({
      vwapZone: "between_bands",
      dataQuality: "good",
      drawdownPct: 3,
      lastUpdated: fresh,
    });
    expect(r.title).toBe("Contexto neutro");
    expect(r.icon).toBe("warning");
  });

  it("MC24. zona above_upper2 → 'Contexto exigente', icon caution", () => {
    const fresh = new Date(Date.now() - 1 * 60_000).toISOString();
    const r = buildMarketContextNarrative({
      vwapZone: "above_upper2",
      dataQuality: "good",
      drawdownPct: -5,
      lastUpdated: fresh,
    });
    expect(r.title).toBe("Contexto exigente");
    expect(r.icon).toBe("caution");
  });

  it("MC25. referencia cambiada <24h se menciona en descripción", () => {
    const fresh = new Date(Date.now() - 1 * 60_000).toISOString();
    const recent = new Date(Date.now() - 2 * 3_600_000).toISOString();
    const r = buildMarketContextNarrative({
      vwapZone: "between_bands",
      dataQuality: "good",
      drawdownPct: 2,
      lastUpdated: fresh,
      anchorPriceUpdatedAt: recent,
    });
    expect(r.description).toContain("revisada recientemente");
  });
});

// ─── formatAgeLabel ───────────────────────────────────────────────────────────

describe("formatAgeLabel", () => {
  it("MC26. < 1 min → 'hace unos segundos'", () => {
    const t = new Date(Date.now() - 30_000).toISOString();
    expect(formatAgeLabel(t)).toBe("hace unos segundos");
  });

  it("MC27. 5 min → 'hace 5m'", () => {
    const t = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(formatAgeLabel(t)).toBe("hace 5m");
  });

  it("MC28. 3h → 'hace 3h'", () => {
    const t = new Date(Date.now() - 3 * 3_600_000).toISOString();
    expect(formatAgeLabel(t)).toBe("hace 3h");
  });

  it("MC29. 2d → 'hace 2d'", () => {
    const t = new Date(Date.now() - 2 * 86_400_000).toISOString();
    expect(formatAgeLabel(t)).toBe("hace 2d");
  });

  it("MC30. undefined → vacío", () => {
    expect(formatAgeLabel(undefined)).toBe("");
  });
});
