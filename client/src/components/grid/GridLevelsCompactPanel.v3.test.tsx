import * as React from "react";
import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { GridLevelsCompactPanel } from "./GridLevelsCompactPanel";

function makeOperational() {
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
  it("renderiza filtros V3: Entradas, Rungs, Targets, Histórico", () => {
    const html = renderToString(<GridLevelsCompactPanel operational={makeOperational()} />);
    expect(html).toContain("Entradas (BUY)");
    expect(html).toContain("Rungs SELL de referencia");
    expect(html).toContain("Targets de ciclo");
    expect(html).toContain("Histórico");
  });

  it("muestra BUY entradas por defecto y oculta rungs/targets", () => {
    const html = renderToString(<GridLevelsCompactPanel operational={makeOperational()} />);
    expect(html).toContain("BUY entrada");
    expect(html).toContain("$90.000,00");
    expect(html).not.toContain("SELL referencia");
    expect(html).not.toContain("SELL objetivo de ciclo");
  });
});
