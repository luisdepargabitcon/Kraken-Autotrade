/**
 * SPOT Responsive Layout Tests
 *
 * Verifies that SPOT UI components contain the correct Tailwind responsive
 * breakpoint classes and overflow guards needed for mobile/tablet layouts.
 *
 * Uses renderToString (SSR) to inspect the static HTML without a real browser.
 * These tests guard against layout regressions when refactoring SPOT panels.
 */

import * as React from "react";
import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SpotHistoryPanel } from "./SpotHistoryPanel";

function withQC(node: React.ReactElement): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToString(
    React.createElement(QueryClientProvider, { client: qc }, node),
  );
}

const MINIMAL_TRADE = {
  tradeId: "spot-trade-spot-ETH/USD-test",
  lotId: "spot-ETH/USD-test",
  pair: "ETH/USD",
  side: "sell",
  entryPrice: 2450.52,
  exitPrice: 2478.20,
  amount: 0.75,
  grossPnl: 20.79,
  netPnl: 17.46,
  entryFee: 1.66,
  exitFee: 1.68,
  executionMode: "SHADOW",
  exitReason: "TIME_EFFICIENCY",
  holdTimeMinutes: 469,
  rMultiple: 0,
  openedAt: Date.now() - 469 * 60_000,
  closedAt: Date.now(),
};

describe("SpotHistoryPanel — responsive layout (SPOT_RESPONSIVE_LAYOUT)", () => {
  it("renders overflow-x-auto wrapper around the trade table for horizontal scroll on mobile", () => {
    const html = withQC(<SpotHistoryPanel trades={[MINIMAL_TRADE]} />);
    expect(html).toContain("overflow-x-auto");
  });

  it("renders the table element inside the overflow wrapper", () => {
    const html = withQC(<SpotHistoryPanel trades={[MINIMAL_TRADE]} />);
    expect(html).toContain("<table");
  });

  it("shows empty-state message when trades array is empty (no table overflow needed)", () => {
    const html = withQC(<SpotHistoryPanel trades={[]} />);
    expect(html).toContain("No hay trades cerrados");
    expect(html).not.toContain("overflow-x-auto");
  });

  it("renders entry and exit prices without crashing on valid camelCase trade data", () => {
    const html = withQC(<SpotHistoryPanel trades={[MINIMAL_TRADE]} />);
    expect(html).toContain("2450.52");
    expect(html).toContain("2478.20");
  });

  it("renders netPnl with correct sign styling class (positive trade)", () => {
    const html = withQC(<SpotHistoryPanel trades={[MINIMAL_TRADE]} />);
    expect(html).toContain("emerald");
  });

  it("renders negative trade with red styling class", () => {
    const lossTrade = { ...MINIMAL_TRADE, netPnl: -5.0, grossPnl: -3.0 };
    const html = withQC(<SpotHistoryPanel trades={[lossTrade]} />);
    expect(html).toContain("red");
  });

  it("does not crash when optional nullable fields are null (resilience guard)", () => {
    const sparseTrade = {
      ...MINIMAL_TRADE,
      entryFee: null,
      exitFee: null,
      rMultiple: null,
      holdTimeMinutes: null,
      exitReason: null,
      openedAt: null,
      closedAt: null,
    };
    expect(() =>
      withQC(<SpotHistoryPanel trades={[sparseTrade as any]} />),
    ).not.toThrow();
  });
});
