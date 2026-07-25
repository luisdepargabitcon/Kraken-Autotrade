import * as React from "react";
import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { GridMarketPanel } from "./GridMarketPanel";

const baseOperational = {
  header: { pair: "BTC/USD" },
  market: {
    pair: "BTC/USD",
    current: {
      updatedAt: "2026-01-15T12:34:56.000Z",
      fresh: true,
      ageMs: 1000,
      maxAgeMs: 5000,
      source: "kraken",
      price: 95000,
      bid: 94990,
      ask: 95010,
      spreadUsd: 20,
      spreadPct: 0.02,
      regime: {
        code: "RANGE",
        label: "Lateral",
        direction: "lateral",
        confidencePct: 70,
        humanReason: "El mercado está en rango",
        technicalReason: "bandwidth within normal range",
      },
      band: {
        lower: 90000,
        center: 95000,
        upper: 100000,
        widthPct: 10,
        calculatedWidthPct: 10,
        atr: 950,
        atrPct: 2,
        period: 20,
        stdDevMultiplier: 2,
        timeframe: "1h",
        source: "kraken",
        calculatedAt: "2026-01-15T12:30:00.000Z",
        available: true,
        internallyConsistent: true,
        inconsistencyReason: null,
      },
    },
    entryRange: {
      mode: "ADAPTIVE",
      active: true,
      calculatedLower: 90000,
      calculatedUpper: 100000,
      calculatedWidthPct: 10,
      actualLevels: 4,
      requestedLevels: 4,
      viability: "ACTIVE",
    },
    exitObligationRanges: [],
    recommendation: null,
  },
  overview: {},
  capital: {},
  openCycles: [],
};

describe("GridMarketPanel render", () => {
  it("renders updated price labels", () => {
    const html = renderToString(<GridMarketPanel operational={baseOperational} />);
    expect(html).toContain("Último precio");
    expect(html).toContain("Mejor BID");
    expect(html).toContain("Mejor ASK");
  });

  it("renders market and execution exchange labels", () => {
    const html = renderToString(<GridMarketPanel operational={baseOperational} />);
    expect(html).toContain("Referencia de mercado: Kraken");
    expect(html).toContain("Exchange previsto de ejecución: Revolut X");
  });

  it("renders ATR and ATR% separately", () => {
    const html = renderToString(<GridMarketPanel operational={baseOperational} />);
    expect(html).toContain("ATR:");
    expect(html).toContain("ATR%:");
  });

  it("renders full date/time", () => {
    const html = renderToString(<GridMarketPanel operational={baseOperational} />);
    expect(html).toContain("15/01/2026");
  });

  it("renders inconsistent band details with calculated width", () => {
    const inconsistent = {
      ...baseOperational,
      market: {
        ...baseOperational.market,
        current: {
          ...baseOperational.market.current,
          band: {
            ...baseOperational.market.current.band,
            internallyConsistent: false,
            inconsistencyReason: "Anchura calculada (10.5000%) no coincide con widthPct reportado (10.0000%)",
            calculatedWidthPct: 10.5,
          },
        },
      },
    };
    const html = renderToString(<GridMarketPanel operational={inconsistent} />);
    expect(html).toContain("Banda inconsistente");
    expect(html).toContain("Anchura recalculada");
    expect(html).toContain("10,50%");
    expect(html).toContain("Detalle técnico");
  });
});
