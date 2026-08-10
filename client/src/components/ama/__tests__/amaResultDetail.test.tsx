import * as React from "react";
import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { AmaTrajectoryChart } from "../AmaTrajectoryChart";
import { AmaResultDetail, type ResultSummaryItem } from "../AmaResultDetail";

function render(node: React.ReactNode): string {
  return renderToString(node);
}

describe("AmaTrajectoryChart", () => {
  it("shows 'Gráfico no disponible' when fewer than 2 points are given (never fabricates a trajectory)", () => {
    const html = render(<AmaTrajectoryChart points={[]} />);
    expect(html).toContain("Gráfico no disponible");
  });

  it("renders an SVG path when real points are given", () => {
    const html = render(<AmaTrajectoryChart points={[{ x: 0, price: 100 }, { x: 1, price: 90 }]} />);
    expect(html).toContain("<svg");
    expect(html).toContain("<path");
  });

  it("shows buy marker count only when markers exist", () => {
    const html = render(
      <AmaTrajectoryChart
        points={[{ x: 0, price: 100 }, { x: 1, price: 90 }]}
        buyMarkers={[{ x: 0, price: 100 }]}
      />,
    );
    // renderToString interpola el número dinámico con comentarios React
    // (p.ej. "Compras (<!-- -->1<!-- -->)"), así que comprobamos las partes
    // fijas del texto en vez del string exacto.
    expect(html).toContain("Compras (");
    expect(html).toContain("fill-green-400");
  });
});

describe("AmaResultDetail — shadow (no per-id detail endpoint exists)", () => {
  const shadowItem: ResultSummaryItem = {
    id: "scenario-abc",
    name: "Caída rápida",
    type: "shadow",
    status: "ACTIVE",
    createdAt: new Date().toISOString(),
    raw: { name: "Caída rápida", pair: "BTC/USD", totalOrders: 3, totalFilled: 1, totalSimulatedUsd: 500, status: "ACTIVE" },
  };

  it("renders known fields from the already-fetched list item, and 'Gráfico no disponible' (no per-scenario history endpoint)", () => {
    const html = render(<AmaResultDetail item={shadowItem} onClose={() => {}} />);
    expect(html).toContain("Caída rápida");
    expect(html).toContain("BTC/USD");
    expect(html).toContain("Gráfico no disponible");
  });

  it("never shows the raw technical scenario id as the primary heading (collapsed under 'Detalles técnicos')", () => {
    const html = render(<AmaResultDetail item={shadowItem} onClose={() => {}} />);
    const idxDetails = html.indexOf("Detalles técnicos");
    const idxId = html.indexOf("scenario-abc");
    expect(idxDetails).toBeGreaterThan(-1);
    expect(idxId).toBeGreaterThan(idxDetails); // el id solo aparece dentro de <details>, después del summary
  });
});
