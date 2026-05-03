/**
 * Tests unitarios para los helpers puros de IdcaMarketContextCard
 *
 * getFreshnessState       — 3 casos: realtime / recent / stale
 * getReferencePriceState  — 2 casos: recently_changed / stable
 * getZoneVisual           — zona favorable / neutra / sobreextendida
 * getQualityBadgeText     — badge compacto con motivo
 * buildMarketContextNarrative — todos los escenarios
 */
import { describe, it, expect } from "vitest";

// Importamos los helpers puros desde el módulo TS sin React
import {
  getFreshnessState,
  getReferencePriceState,
  getZoneVisual,
  getAtrpLabel,
  getQualityBadgeText,
  buildMarketContextNarrative,
  formatAgeLabel,
  type MarketContextQualityDetail,
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

// ─── getQualityBadgeText ──────────────────────────────────────────────────────

describe("getQualityBadgeText", () => {
  it("MC20. status=ok → 'Óptima'", () => {
    const qd: MarketContextQualityDetail = { status: "ok", reason: "ok", candleCount: 120, requiredForOptimal: 100, hasVwap: true, hasAtrp: true };
    expect(getQualityBadgeText(qd)).toBe("Óptima");
  });

  it("MC21. status=poor → 'Insuficiente'", () => {
    const qd: MarketContextQualityDetail = { status: "poor", reason: "insufficient_candles", candleCount: 5, requiredForOptimal: 100, hasVwap: false, hasAtrp: false };
    expect(getQualityBadgeText(qd)).toBe("Insuficiente");
  });

  it("MC22. partial + warming_up_cache → 'Parcial: calentando'", () => {
    const qd: MarketContextQualityDetail = { status: "partial", reason: "warming_up_cache", candleCount: 34, requiredForOptimal: 100, hasVwap: false, hasAtrp: true };
    expect(getQualityBadgeText(qd)).toBe("Parcial: calentando");
  });

  it("MC23. partial + insufficient_candles → 'Parcial: X/Y velas'", () => {
    const qd: MarketContextQualityDetail = { status: "partial", reason: "insufficient_candles", candleCount: 65, requiredForOptimal: 100, hasVwap: true, hasAtrp: true };
    expect(getQualityBadgeText(qd)).toBe("Parcial: 65/100 velas");
  });

  it("MC24. partial + missing_vwap_zone → 'Parcial: falta VWAP'", () => {
    const qd: MarketContextQualityDetail = { status: "partial", reason: "missing_vwap_zone", candleCount: 80, requiredForOptimal: 100, hasVwap: false, hasAtrp: true };
    expect(getQualityBadgeText(qd)).toBe("Parcial: falta VWAP");
  });

  it("MC25. partial + missing_atrp → 'Parcial: falta ATRP'", () => {
    const qd: MarketContextQualityDetail = { status: "partial", reason: "missing_atrp", candleCount: 80, requiredForOptimal: 100, hasVwap: true, hasAtrp: false };
    expect(getQualityBadgeText(qd)).toBe("Parcial: falta ATRP");
  });

  it("MC26. undefined → 'Parcial' (fallback seguro)", () => {
    expect(getQualityBadgeText(undefined)).toBe("Parcial");
  });
});

// ─── buildMarketContextNarrative ─────────────────────────────────────────────

const freshTs = () => new Date(Date.now() - 1 * 60_000).toISOString();
const okQd = (): MarketContextQualityDetail => ({ status: "ok", reason: "ok", candleCount: 120, requiredForOptimal: 100, hasVwap: true, hasAtrp: true });

describe("buildMarketContextNarrative", () => {
  it("MC27. datos stale → 'Datos desactualizados', icon alert (prioridad máxima)", () => {
    const stale = new Date(Date.now() - 30 * 60_000).toISOString();
    const r = buildMarketContextNarrative({ vwapZone: "between_bands", qualityDetail: okQd(), drawdownPct: 5, lastUpdated: stale });
    expect(r.title).toBe("Datos desactualizados");
    expect(r.icon).toBe("alert");
  });

  it("MC28. qualityDetail.status=poor → 'Datos a revisar', icon alert", () => {
    const qd: MarketContextQualityDetail = { status: "poor", reason: "insufficient_candles", candleCount: 5, requiredForOptimal: 100, hasVwap: false, hasAtrp: false };
    const r = buildMarketContextNarrative({ vwapZone: "between_bands", qualityDetail: qd, drawdownPct: 5, lastUpdated: freshTs() });
    expect(r.title).toBe("Datos a revisar");
    expect(r.icon).toBe("alert");
  });

  it("MC29. warming_up_cache → 'Histórico calentando', icon warning, texto con velas", () => {
    const qd: MarketContextQualityDetail = { status: "partial", reason: "warming_up_cache", candleCount: 34, requiredForOptimal: 100, hasVwap: false, hasAtrp: true };
    const r = buildMarketContextNarrative({ vwapZone: "between_bands", qualityDetail: qd, drawdownPct: 5, lastUpdated: freshTs() });
    expect(r.title).toBe("Histórico calentando");
    expect(r.icon).toBe("warning");
    expect(r.description).toContain("34/100");
    expect(r.shortText).toContain("34/100");
  });

  it("MC30. insufficient_candles partial → 'Histórico parcial', texto con X/Y", () => {
    const qd: MarketContextQualityDetail = { status: "partial", reason: "insufficient_candles", candleCount: 65, requiredForOptimal: 100, hasVwap: true, hasAtrp: true };
    const r = buildMarketContextNarrative({ vwapZone: "between_bands", qualityDetail: qd, drawdownPct: 3, lastUpdated: freshTs() });
    expect(r.title).toBe("Histórico parcial");
    expect(r.description).toContain("65/100");
  });

  it("MC31. ok + zona below_lower3 → 'Contexto favorable', icon ok", () => {
    const r = buildMarketContextNarrative({ vwapZone: "below_lower3", qualityDetail: okQd(), drawdownPct: 12, lastUpdated: freshTs() });
    expect(r.title).toBe("Contexto favorable");
    expect(r.icon).toBe("ok");
  });

  it("MC32. ok + zona between_bands → 'Contexto actualizado' (status ok sin zona desfavorable)", () => {
    const r = buildMarketContextNarrative({ vwapZone: "between_bands", qualityDetail: okQd(), drawdownPct: 2, lastUpdated: freshTs() });
    expect(r.title).toBe("Contexto actualizado");
    expect(r.icon).toBe("ok");
  });

  it("MC33. ok + zona above_upper2 → 'Contexto exigente', icon caution", () => {
    const r = buildMarketContextNarrative({ vwapZone: "above_upper2", qualityDetail: okQd(), drawdownPct: -5, lastUpdated: freshTs() });
    expect(r.title).toBe("Contexto exigente");
    expect(r.icon).toBe("caution");
  });

  it("MC34. parcial con precio + drawdown + ATRP + zona + lastUpdated reciente → NO 'Datos a revisar'", () => {
    const qd: MarketContextQualityDetail = { status: "partial", reason: "warming_up_cache", candleCount: 40, requiredForOptimal: 100, hasVwap: false, hasAtrp: true };
    const r = buildMarketContextNarrative({
      vwapZone: "between_bands",
      qualityDetail: qd,
      drawdownPct: 3,
      lastUpdated: freshTs(),
    });
    expect(r.title).not.toBe("Datos a revisar");
  });

  it("MC35. referencia cambiada <24h mencionada en descripción (zona favorable)", () => {
    const recent = new Date(Date.now() - 2 * 3_600_000).toISOString();
    const r = buildMarketContextNarrative({
      vwapZone: "below_lower3",
      qualityDetail: okQd(),
      drawdownPct: 10,
      lastUpdated: freshTs(),
      anchorPriceUpdatedAt: recent,
    });
    expect(r.description).toContain("revisada recientemente");
  });

  it("MC36. dataQuality=insufficient sin qualityDetail → 'Datos a revisar'", () => {
    const r = buildMarketContextNarrative({ vwapZone: "between_bands", dataQuality: "insufficient", drawdownPct: 5, lastUpdated: freshTs() });
    expect(r.title).toBe("Datos a revisar");
  });
});

// ─── formatAgeLabel ───────────────────────────────────────────────────────────

describe("formatAgeLabel", () => {
  it("MC37. < 1 min → 'hace unos segundos'", () => {
    const t = new Date(Date.now() - 30_000).toISOString();
    expect(formatAgeLabel(t)).toBe("hace unos segundos");
  });

  it("MC38. 5 min → 'hace 5m'", () => {
    const t = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(formatAgeLabel(t)).toBe("hace 5m");
  });

  it("MC39. 3h → 'hace 3h'", () => {
    const t = new Date(Date.now() - 3 * 3_600_000).toISOString();
    expect(formatAgeLabel(t)).toBe("hace 3h");
  });

  it("MC40. 2d → 'hace 2d'", () => {
    const t = new Date(Date.now() - 2 * 86_400_000).toISOString();
    expect(formatAgeLabel(t)).toBe("hace 2d");
  });

  it("MC41. undefined → vacío", () => {
    expect(formatAgeLabel(undefined)).toBe("");
  });
});
