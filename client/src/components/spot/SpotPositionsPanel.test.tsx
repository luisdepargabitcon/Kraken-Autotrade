import * as React from "react";
import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { SpotPositionsPanel } from "./SpotPositionsPanel";

const basePosition = {
  lotId: "spot-ETH/USD-mt3ge42d-1lm1",
  pair: "ETH/USD",
  entryPrice: 2450.524937,
  qtyRemaining: 0.7511858,
  notionalUsd: 1840.7995363,
  filledNotionalUsd: 1840.7995363,
  amount: 0.7511858,
  executionMode: "SHADOW",
  mfe: 68.21898575,
  mae: 0,
  mfeR: 0.05,
  maeR: 0,
  mfeUsd: 50.0,
  maeUsd: 0,
  profitCapturePct: 2.5,
  openedAt: Date.now() - 100000,
  setupTag: "EMA20_BREAKOUT",
};

describe("SpotPositionsPanel — SPOT_UI render resilience", () => {
  it("SPOT_POSITIONS_RENDER_01 — renders full position without throwing", () => {
    const html = renderToString(<SpotPositionsPanel positions={[basePosition as any]} executionMode="SHADOW" />);
    expect(html).toContain("ETH/USD");
    expect(html).toContain("$");
  });

  it("SPOT_POSITIONS_RENDER_02 — renders with valid notional", () => {
    const html = renderToString(<SpotPositionsPanel positions={[basePosition as any]} executionMode="SHADOW" />);
    expect(html).toContain("1841");
  });

  it("SPOT_POSITIONS_RENDER_03 — renders with optional null fields", () => {
    const pos = { ...basePosition, mfe: null, mae: null, mfeR: null, maeR: null, mfeUsd: null, maeUsd: null, profitCapturePct: null, setupTag: null };
    const html = renderToString(<SpotPositionsPanel positions={[pos as any]} executionMode="SHADOW" />);
    expect(html).toContain("ETH/USD");
  });

  it("SPOT_POSITIONS_RENDER_04 — renders with zero metrics", () => {
    const pos = { ...basePosition, mfe: 0, mae: 0, mfeR: 0, maeR: 0, mfeUsd: 0, maeUsd: 0, profitCapturePct: 0 };
    const html = renderToString(<SpotPositionsPanel positions={[pos as any]} executionMode="SHADOW" />);
    expect(html).toContain("0.00");
  });

  it("SPOT_POSITIONS_RENDER_05 — renders SHADOW badge", () => {
    const html = renderToString(<SpotPositionsPanel positions={[basePosition as any]} executionMode="SHADOW" />);
    expect(html).toContain("SHADOW");
  });

  it("SPOT_POSITIONS_RENDER_06 — empty positions does not throw", () => {
    const html = renderToString(<SpotPositionsPanel positions={[]} executionMode="SHADOW" />);
    expect(html).toContain("No hay posiciones abiertas");
  });
});
