import * as React from "react";
import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { GridLevelsCompactPanel, buildGridLevelFilterCounts, resolveGridLevelRows } from "./GridLevelsCompactPanel";

function makeOperational(): any {
  return {
    levels: {
      entryLevels: [
        { id: "buy-1", side: "BUY", price: 90000, quantity: 0.01, status: "planned", statusLabel: "Planificado", rangeRelation: "current" },
        { id: "buy-2", side: "BUY", price: 85000, quantity: 0.01, status: "planned", statusLabel: "Planificado", rangeRelation: "current" },
      ],
      referenceRungs: [
        { id: "rung-1", side: "SELL", price: 95000, quantity: 0.01, status: "planned", statusLabel: "Planificado", rangeRelation: "current", targetOfOpenCycle: false },
      ],
      legacyTargetLevels: [
        { id: "target-1", side: "SELL", price: 96000, quantity: 0.01, status: "open", statusLabel: "Activo", rangeRelation: "previous", targetOfOpenCycle: true, cycleNumber: 25 },
      ],
      historicalLevels: [],
      allLevels: [],
    },
    market: {},
  };
}

describe("GridLevelsCompactPanel V3", () => {
  it("cuenta salidas por ciclo desde V3 y legacy y las mantiene separadas", () => {
    const operational = makeOperational();
    operational.cycleOwnedExits = [{ cycleId: "cycle-v3-1", cycleNumber: 101, targetOwner: "cycle", targetSellPrice: 91000 }];
    const counts = buildGridLevelFilterCounts(operational);
    const rows = resolveGridLevelRows(operational, "salidas") as any;
    expect(counts.salidas).toBe(2);
    expect(rows.cycleOwnedExits[0]).toMatchObject({ cycleId: "cycle-v3-1", targetOwner: "cycle" });
    expect(rows.legacyTargetLevels[0]).toMatchObject({ id: "target-1" });
  });

  it("renderiza filtros unificados: Todos, BUY, SELL/rungs, Con ciclo, Histórico", () => {
    const html = renderToString(<GridLevelsCompactPanel operational={makeOperational()} />);
    expect(html).toContain("Todos");
    expect(html).toContain("BUY");
    expect(html).toContain("SELL / rungs");
    expect(html).toContain("Con ciclo");
    expect(html).toContain("Histórico");
  });

  it("muestra BUY y SELL juntos por defecto en la escalera unificada", () => {
    const html = renderToString(<GridLevelsCompactPanel operational={makeOperational()} />);
    expect(html).toContain("BUY entrada");
    expect(html).toContain("$90.000,00");
    expect(html).toContain("Rung de referencia");
  });

  it("renderiza el target V3 cycle-owned como fila sintética en la escalera", () => {
    const operational = makeOperational();
    operational.levels.entryLevels = [];
    operational.cycleOwnedExits = [{
      cycleId: "cycle-v3-1",
      cycleNumber: 101,
      policyVersion: "CYCLE_OWNED_NET_TARGET_V3",
      targetKind: "CYCLE_OWNED_SYNTHETIC",
      targetOwner: "cycle",
      buyPrice: 90000,
      targetSellPrice: 91000,
      targetDistancePctFromBuy: 1.1111,
      quantity: 0.01,
      expectedNetUsd: 8.25,
      netTargetPct: 0.8,
      makerState: "MAKER_PENDING",
      requestedMakerPrice: 91000.1,
      rangeRelation: "current",
      exchangeFeesUsd: 1.15,
      taxReserveUsd: 0.35,
      executionMicrostructureSource: "REVOLUT_X_TICKER",
      constraintsSource: "REVOLUT_X_PRIVATE",
      requiresReview: false,
    }];

    const html = renderToString(<GridLevelsCompactPanel operational={operational} />);
    expect(html).toContain("Escalera del rango actual");
    expect(html).toContain("SELL de ciclo");
    expect(html).toContain("Ciclo #101");
    expect(html).toContain("$91.000,00");
    expect(html).toContain("MAKER_PENDING");
  });
});
