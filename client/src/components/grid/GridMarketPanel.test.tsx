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
      // REV-C12E: server-derived data source / execution venue labels
      dataSourceInfo: {
        marketDataSourceLabel: "Kraken",
        executionVenueLabel: "Revolut X",
        executionPolicyLabel: "Maker-only / Post-only",
        takerFallbackLabel: "Desactivado",
        constraintsSourceLabel: "Revolut X",
        infoText: "Kraken se utiliza como referencia de mercado. La garantía maker definitiva se aplica en Revolut X mediante post_only.",
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
    expect(html).toContain("Fuente de precios: Kraken");
    expect(html).toContain("Venue de ejecución: Revolut X");
  });

  // ─── REV-C12E: UX tests ────────────────────────────────────────────────

  it("UX1. muestra Kraken como fuente de precios", () => {
    const html = renderToString(<GridMarketPanel operational={baseOperational} />);
    expect(html).toContain("Fuente de precios: Kraken");
  });

  it("UX2. muestra Revolut X como venue de ejecución", () => {
    const html = renderToString(<GridMarketPanel operational={baseOperational} />);
    expect(html).toContain("Venue de ejecución: Revolut X");
  });

  it("UX3. muestra Maker-only / Post-only como política", () => {
    const html = renderToString(<GridMarketPanel operational={baseOperational} />);
    expect(html).toContain("Maker-only / Post-only");
  });

  it("UX4. muestra fallback taker desactivado", () => {
    const html = renderToString(<GridMarketPanel operational={baseOperational} />);
    expect(html).toContain("Fallback taker: Desactivado");
  });

  it("UX5. no muestra 'Microestructura Revolut X verificada' cuando bid/ask proceden de Kraken", () => {
    const operational = {
      ...baseOperational,
      market: {
        ...baseOperational.market,
        current: {
          ...baseOperational.market.current,
          executionGate: {
            canCreateRange: true,
            status: "VERIFIED",
            evaluatedAt: "2026-01-15T12:34:56.000Z",
            ageMs: 5000,
            maxAgeMs: 30000,
            validUntil: "2026-01-15T12:35:26.000Z",
            executionMarketSnapshot: {
              available: true,
              verified: true,
              fresh: true,
              pair: "BTC/USD",
              executionVenue: "REVOLUT_X",
              source: "KRAKEN_MARKET_DATA",
              reasonCode: null,
              explanation: null,
            },
            pairConstraints: {
              available: true,
              verified: true,
              fresh: true,
              pair: "BTC/USD",
              source: "revolutx",
              reasonCode: null,
              explanation: null,
            },
            blockers: [],
            allowCycleExits: true,
          },
        },
      },
    };
    const html = renderToString(<GridMarketPanel operational={operational} />);
    expect(html).not.toContain("Microestructura Revolut X verificada");
    expect(html).not.toContain("Microestructura y constraints de Revolut X verificadas");
    expect(html).toContain("Ticker de referencia Kraken y constraints de Revolut X verificadas");
  });

  it("UX6. no muestra allow_taker ni referencias a taker fallback habilitado", () => {
    const html = renderToString(<GridMarketPanel operational={baseOperational} />);
    expect(html).not.toContain("allow_taker");
    expect(html).not.toContain("Fallback taker: Habilitado");
  });

  it("UX7. el render no realiza llamadas de red (renderToString es puro)", () => {
    // renderToString es sincrónico y no invoca fetch/XHR; si el componente
    // hiciera un POST al renderizar, esta prueba lanzaría por falta de fetch mock.
    expect(() => renderToString(<GridMarketPanel operational={baseOperational} />)).not.toThrow();
  });

  it("UX8. datos stale se muestran como referencia retrasada (Desactualizado)", () => {
    const stale = {
      ...baseOperational,
      market: {
        ...baseOperational.market,
        current: { ...baseOperational.market.current, fresh: false },
      },
    };
    const html = renderToString(<GridMarketPanel operational={stale} />);
    expect(html).toContain("Desactualizado");
  });

  it("UX9. dato ausente no se convierte en cero (precio null se muestra como —)", () => {
    const absent = {
      ...baseOperational,
      market: {
        ...baseOperational.market,
        current: { ...baseOperational.market.current, price: null, bid: null, ask: null },
      },
    };
    const html = renderToString(<GridMarketPanel operational={absent} />);
    expect(html).toContain("—");
    expect(html).not.toContain(">$0.00<");
  });

  it("UX10. no aparece REAL_LIMITED ni REAL_FULL en el render", () => {
    const html = renderToString(<GridMarketPanel operational={baseOperational} />);
    expect(html).not.toContain("REAL_LIMITED");
    expect(html).not.toContain("REAL_FULL");
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

  it("renders Revolut X gate as SIN EVALUACIÓN RECIENTE when no executionGate", () => {
    const html = renderToString(<GridMarketPanel operational={baseOperational} />);
    // REV-C12A: Gate is always visible. Without executionGate, shows SIN EVALUACIÓN RECIENTE.
    expect(html).toContain("Gate Revolut X");
    expect(html).toContain("SIN EVALUACIÓN RECIENTE");
  });

  it("renders Revolut X gate as BLOQUEADO when executionGate has blockers", () => {
    const operational = {
      ...baseOperational,
      market: {
        ...baseOperational.market,
        current: {
          ...baseOperational.market.current,
          executionGate: {
            canCreateRange: false,
            status: "BLOCKED",
            evaluatedAt: "2026-01-15T12:34:56.000Z",
            ageMs: 5000,
            maxAgeMs: 30000,
            validUntil: "2026-01-15T12:35:26.000Z",
            executionMarketSnapshot: {
              available: false,
              verified: false,
              fresh: false,
              pair: "BTC/USD",
              executionVenue: "REVOLUT_X",
              source: "REVOLUT_X_UNAVAILABLE",
              reasonCode: "EXECUTION_MARKET_SNAPSHOT_INVALID",
              explanation: "Snapshot no verificado",
            },
            pairConstraints: {
              available: true,
              verified: true,
              fresh: true,
              pair: "BTC/USD",
              source: "revolutx",
              reasonCode: null,
              explanation: null,
            },
            blockers: ["EXECUTION_MARKET_SNAPSHOT_INVALID"],
            allowCycleExits: true,
          },
        },
      },
    };
    const html = renderToString(<GridMarketPanel operational={operational} />);
    expect(html).toContain("Gate Revolut X");
    expect(html).toContain("BLOQUEADO");
    expect(html).toContain("EXECUTION_MARKET_SNAPSHOT_INVALID");
  });

  it("renders Revolut X gate as VERIFICADO when executionGate.canCreateRange is true", () => {
    const operational = {
      ...baseOperational,
      market: {
        ...baseOperational.market,
        current: {
          ...baseOperational.market.current,
          executionGate: {
            canCreateRange: true,
            status: "VERIFIED",
            evaluatedAt: "2026-01-15T12:34:56.000Z",
            ageMs: 5000,
            maxAgeMs: 30000,
            validUntil: "2026-01-15T12:35:26.000Z",
            executionMarketSnapshot: {
              available: true,
              verified: true,
              fresh: true,
              pair: "BTC/USD",
              executionVenue: "REVOLUT_X",
              source: "REVOLUT_X_TICKER",
              reasonCode: null,
              explanation: null,
            },
            pairConstraints: {
              available: true,
              verified: true,
              fresh: true,
              pair: "BTC/USD",
              source: "revolutx",
              reasonCode: null,
              explanation: null,
            },
            blockers: [],
            allowCycleExits: true,
          },
        },
      },
    };
    const html = renderToString(<GridMarketPanel operational={operational} />);
    expect(html).toContain("Gate Revolut X");
    expect(html).toContain("VERIFICADO");
  });
});
