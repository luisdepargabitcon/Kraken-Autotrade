import { describe, it, expect } from "vitest";
import { filterGridLevels, gridLevelOperationalLabel, isHistoricalLegacyGridLevel } from "../gridLevelFilters";

function makeLevel(p: { id: string; status: string; rangeVersionId: string; exchangeOrderId?: string | null; filledAt?: Date | null }) {
  return {
    id: p.id,
    status: p.status,
    rangeVersionId: p.rangeVersionId,
    exchangeOrderId: p.exchangeOrderId ?? null,
    filledAt: p.filledAt ?? null,
  };
}

describe("filterGridLevels", () => {
  const activeRangeId = "range-active";
  const levels = [
    makeLevel({ id: "l1", status: "planned", rangeVersionId: activeRangeId }),
    makeLevel({ id: "l2", status: "planned", rangeVersionId: activeRangeId, exchangeOrderId: "ord-123" }),
    makeLevel({ id: "l3", status: "planned", rangeVersionId: "range-old" }),
    makeLevel({ id: "l4", status: "replaced", rangeVersionId: activeRangeId }),
    makeLevel({ id: "l5", status: "filled", rangeVersionId: "range-old" }),
    makeLevel({ id: "l6", status: "cancelled", rangeVersionId: "range-old" }),
  ];

  it("rango-activo returns only levels from active range", () => {
    const result = filterGridLevels(levels, "rango-activo", activeRangeId);
    expect(result.map(l => l.id)).toEqual(["l1", "l2", "l4"]);
  });

  it("planificados restricts to active range and excludes levels with real orders", () => {
    const result = filterGridLevels(levels, "planificados", activeRangeId);
    expect(result.map(l => l.id)).toEqual(["l1"]);
  });

  it("historicos includes levels from other ranges and replaced active levels", () => {
    const result = filterGridLevels(levels, "historicos", activeRangeId);
    expect(result.map(l => l.id)).toEqual(["l3", "l4", "l5", "l6"]);
  });

  it("reemplazados filters by replaced status", () => {
    const result = filterGridLevels(levels, "reemplazados", activeRangeId);
    expect(result.map(l => l.id)).toEqual(["l4"]);
  });

  it("ejecutados filters by filled status", () => {
    const result = filterGridLevels(levels, "ejecutados", activeRangeId);
    expect(result.map(l => l.id)).toEqual(["l5"]);
  });

  it("cancelados filters cancelled and expired statuses", () => {
    const result = filterGridLevels(levels, "cancelados", activeRangeId);
    expect(result.map(l => l.id)).toEqual(["l6"]);
  });
});

describe("isHistoricalLegacyGridLevel", () => {
  it("returns true for filled levels from other ranges", () => {
    expect(isHistoricalLegacyGridLevel({ status: "filled", rangeVersionId: "old" }, "active")).toBe(true);
  });

  it("returns false for filled levels in active range", () => {
    expect(isHistoricalLegacyGridLevel({ status: "filled", rangeVersionId: "active" }, "active")).toBe(false);
  });

  it("returns false for non-filled statuses", () => {
    expect(isHistoricalLegacyGridLevel({ status: "planned", rangeVersionId: "old" }, "active")).toBe(false);
  });
});

describe("gridLevelOperationalLabel", () => {
  it("labels active range levels as Activo", () => {
    expect(gridLevelOperationalLabel({ rangeVersionId: "active", status: "planned" }, "active")).toBe("Activo");
  });

  it("labels planned historical levels as non-executable", () => {
    expect(gridLevelOperationalLabel({ rangeVersionId: "old", status: "planned" }, "active")).toBe("Planificado histórico / no ejecutable");
  });

  it("labels legacy filled levels as non-executable", () => {
    expect(gridLevelOperationalLabel({ rangeVersionId: "old", status: "filled" }, "active")).toBe("Histórico legacy / no ejecutable / no afecta PnL");
  });

  it("labels other historical levels as non-executable", () => {
    expect(gridLevelOperationalLabel({ rangeVersionId: "old", status: "replaced" }, "active")).toBe("Histórico / no ejecutable");
  });
});
