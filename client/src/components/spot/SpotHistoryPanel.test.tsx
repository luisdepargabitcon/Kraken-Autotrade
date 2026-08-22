import * as React from "react";
import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { SpotHistoryPanel } from "./SpotHistoryPanel";

const baseTrade = {
  tradeId: "trade-1",
  lotId: "lot-1",
  pair: "ETH/USD",
  side: "sell",
  entryPrice: 2332.7,
  exitPrice: 2314.17,
  amount: 0.92265514,
  grossPnl: -17.1,
  entryFee: 0.5,
  exitFee: 0.6,
  netPnl: -20.96,
  exitReason: "STRUCTURE_INVALIDATION",
  openedAt: Date.now() - 1000000,
  closedAt: Date.now() - 900000,
  holdTimeMinutes: 41,
  executionMode: "SHADOW",
  rMultiple: -0.75,
};

describe("SpotHistoryPanel — SPOT_UI render resilience", () => {
  it("SPOT_HISTORY_RENDER_01 — renders negative trade without throwing", () => {
    const html = renderToString(<SpotHistoryPanel trades={[baseTrade as any]} />);
    expect(html).toContain("ETH/USD");
    expect(html).toContain("Salida por pérdida de estructura");
    expect(html).toContain("-20.96");
  });

  it("SPOT_HISTORY_RENDER_02 — renders positive trade", () => {
    const t = { ...baseTrade, grossPnl: 10, netPnl: 9.5, rMultiple: 1.5 };
    const html = renderToString(<SpotHistoryPanel trades={[t as any]} />);
    expect(html).toContain("ETH/USD");
    expect(html).toContain("9.50");
  });

  it("SPOT_HISTORY_RENDER_03 — renders with zero fees", () => {
    const t = { ...baseTrade, entryFee: 0, exitFee: 0 };
    const html = renderToString(<SpotHistoryPanel trades={[t as any]} />);
    expect(html).toContain("0.00");
  });

  it("SPOT_HISTORY_RENDER_04 — renders with optional null fields", () => {
    const t = { ...baseTrade, entryPrice: null, exitPrice: null, grossPnl: null, netPnl: null, rMultiple: null, holdTimeMinutes: null };
    const html = renderToString(<SpotHistoryPanel trades={[t as any]} />);
    expect(html).toContain("ETH/USD");
  });

  it("SPOT_HISTORY_RENDER_05 — empty trades does not throw", () => {
    const html = renderToString(<SpotHistoryPanel trades={[]} />);
    expect(html).toContain("No hay trades cerrados");
  });
});
