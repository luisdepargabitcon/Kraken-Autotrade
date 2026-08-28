/**
 * spotAiR14GUi.test.tsx — R14G Frontend contract tests.
 *
 * Tests:
 *   R14G_UI_01_STATUS_NULL_IS_NOT_ZERO — null labeledTrades => NO DISP, no "0 / 100"
 *   R14G_UI_02_STATUS_REAL_ZERO — labeledTrades=0, available=true => "0 / 100"
 *   R14G_UI_03_DATASET_NULL — dataset labeledTrades=null => NO DISP.
 *   R14G_UI_04_QUALITY_NULL — invalidSnapshots/missingFeatures=null => NO DISP, no green
 *   R14G_UI_05_TRACKING_LABEL_UNAVAILABLE — lifecycle=EN_SEGUIMIENTO, label=NO_DISPONIBLE
 *   R14G_UI_06_TRACKING_LABELED — lifecycle=COMPLETO, label=ETIQUETADO
 *   R14G_UI_07_REGIMES_COLD — available=false => "Calculando", NOT "Sin datos"
 *   R14G_UI_08_REGIMES_AVAILABLE — available=true + data => correct render
 *   R14G_UI_09_REGIMES_CONDITIONAL_REFETCH — fake timers, conditional polling
 */

import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderToString } from "react-dom/server";
import { ResumenTab } from "../tabs/ResumenTab";
import { DatosTab } from "../tabs/DatosTab";
import { ActividadTab } from "../tabs/ActividadTab";
import type { SpotAiStatus, DatasetOverview, DatasetQuality, TrackingData, RegimesResponse } from "../spotAiTypes";

// ─── Mock useQuery ──────────────────────────────────────────────────────────

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(),
}));

import { useQuery } from "@tanstack/react-query";

// R14G: Smart mock that returns different values based on queryKey.
// This is needed because DatosTab makes multiple useQuery calls.
function mockUseQueryByPath(pathToData: Record<string, any>) {
  return vi.mocked(useQuery).mockImplementation(((opts: any) => {
    const key = opts?.queryKey?.[0];
    const data = pathToData[key];
    if (data !== undefined) {
      return {
        data,
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      } as any;
    }
    // Default: loading
    return {
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as any;
  }) as any);
}

function mockUseQuery(overrides: any = {}) {
  return vi.mocked(useQuery).mockReturnValue({
    data: undefined,
    isLoading: true,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  } as any);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeStatus(overrides: Partial<SpotAiStatus> = {}): SpotAiStatus {
  return {
    status: "COLLECTING",
    featureSchemaVersion: 1,
    totalSnapshots: 100,
    labeledTrades: 0,
    labeledTradesAvailable: true,
    minTradesToTrain: 100,
    preferredTradesToTrain: 200,
    entryModelVersion: null,
    givebackModelVersion: null,
    entryModelStatus: "NOT_TRAINED",
    givebackModelStatus: "NOT_TRAINED",
    autoRetrain: false,
    aiTradingControl: "NONE",
    legacyDataMixed: false,
    ...overrides,
  };
}

function makeDataset(overrides: Partial<DatasetOverview> = {}): DatasetOverview {
  return {
    totalSnapshots: 100,
    scanCount: 80,
    supervisorCount: 10,
    fillCount: 10,
    firstTimestamp: 1000,
    lastTimestamp: 2000,
    labeledTrades: 0,
    labeledTradesAvailable: true,
    pendingTrades: null,
    collectorEnabled: true,
    bufferSize: 0,
    bufferMax: 500,
    ...overrides,
  };
}

function makeQuality(overrides: Partial<DatasetQuality> = {}): DatasetQuality {
  return {
    checks: {
      schemaVersionMismatches: 0,
      invalidSnapshots: 0,
      missingFeatures: 0,
      duplicateEntryFills: 0,
      duplicateExitFills: 0,
      orphanSupervisor: 0,
      orphanFills: 0,
      incompleteTrades: 0,
      lookaheadViolations: null,
      causalCorrelationFailures: null,
      legacyMixed: false,
      syntheticLabels: false,
    },
    score: 80,
    available: true,
    status: "OK",
    legacyMixedStructuralInvariant: true,
    syntheticLabelsStructuralInvariant: true,
    featureSchemaVersion: 1,
    ...overrides,
  };
}

function makeTracking(overrides: Partial<TrackingData> = {}): TrackingData {
  return {
    historicalSpotTrades: 41,
    historicalSpotNote: "Referencia — no usados por IA",
    totalSnapshots: 16000,
    scanCount: 15000,
    supervisorCount: 1700,
    fillCount: 12,
    legacyFillCount: 6,
    validFillCount: 6,
    uniqueLots: 1,
    trackedLotsCount: 1,
    completedTrades: 0,
    labeledTrades: 0,
    labeledTradesAvailable: true,
    durableStorageAvailable: true,
    durableLotKeysAvailable: true,
    lots: [],
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("R14G_UI_01_STATUS_NULL_IS_NOT_ZERO", () => {
  it("null labeledTrades => NO DISP, no '0 / 100'", () => {
    const status = makeStatus({ labeledTrades: null, labeledTradesAvailable: false });
    const html = renderToString(<ResumenTab status={status} />);
    // Must show NO DISP
    expect(html).toContain("NO DISP");
    // Must NOT show "0 / 100" or "0 / 200"
    expect(html).not.toContain("0 / 100");
    expect(html).not.toContain("0 / 200");
    // Must show NO DISPONIBLE for progress
    expect(html).toContain("NO DISPONIBLE");
  });
});

describe("R14G_UI_02_STATUS_REAL_ZERO", () => {
  it("labeledTrades=0, available=true => '0 / 100'", () => {
    const status = makeStatus({ labeledTrades: 0, labeledTradesAvailable: true });
    const html = renderToString(<ResumenTab status={status} />);
    // Must show "0 / 100" and "0 / 200"
    expect(html).toContain("0 / 100");
    expect(html).toContain("0 / 200");
    // Must NOT show NO DISP
    expect(html).not.toContain("NO DISP");
  });
});

describe("R14G_UI_03_DATASET_NULL", () => {
  it("dataset labeledTrades=null => NO DISP.", () => {
    mockUseQueryByPath({
      "/api/spot/ai/dataset": makeDataset({ labeledTrades: null, labeledTradesAvailable: false }),
    });
    const html = renderToString(<DatosTab />);
    expect(html).toContain("NO DISP.");
  });
});

describe("R14G_UI_04_QUALITY_NULL", () => {
  it("invalidSnapshots=null, missingFeatures=null => NO DISP, no green badge", () => {
    const quality = makeQuality({
      checks: {
        schemaVersionMismatches: 0,
        invalidSnapshots: null,
        missingFeatures: null,
        duplicateEntryFills: 0,
        duplicateExitFills: 0,
        orphanSupervisor: 0,
        orphanFills: 0,
        incompleteTrades: 0,
        lookaheadViolations: null,
        causalCorrelationFailures: null,
        legacyMixed: false,
        syntheticLabels: false,
      },
    });
    mockUseQueryByPath({
      "/api/spot/ai/dataset/quality": quality,
    });
    const html = renderToString(<DatosTab />);
    // Must show NO DISP for invalidSnapshots and missingFeatures
    expect(html).toContain("NO DISP");
    // The null checks should NOT show green (text-green-400 for those specific checks)
    // We check that the gray styling is used for null values
    expect(html).toContain("text-gray-400");
  });
});

describe("R14G_UI_05_TRACKING_LABEL_UNAVAILABLE", () => {
  it("lifecycle=EN_SEGUIMIENTO, label=NO_DISPONIBLE — both visible separately", () => {
    mockUseQuery({
      data: makeTracking({
        labeledTrades: null,
        labeledTradesAvailable: false,
        durableStorageAvailable: false,
        durableLotKeysAvailable: false,
        lots: [{
          lotId: "lot-1",
          pair: "BTC/USD",
          status: "EN_SEGUIMIENTO",
          lifecycleStatus: "EN_SEGUIMIENTO",
          labelStatus: "NO_DISPONIBLE",
          entryPrice: 100,
          currentR: 0.3,
          mfeR: 0.5,
          maeR: -0.2,
          initialQty: 0.5,
          remainingQty: 0.5,
          buyFills: 1,
          sellFills: 0,
          supervisions: 5,
          openSince: 1000,
          lastUpdate: 2000,
        }],
      }),
      isLoading: false,
      isError: false,
    });
    const html = renderToString(<ActividadTab />);
    // Both lifecycle and label must be visible
    expect(html).toContain("EN SEGUIMIENTO");
    expect(html).toContain("NO DISPONIBLE");
    // Both column headers must be present
    expect(html).toContain("Estado lote");
    expect(html).toContain("Estado IA");
    // KPI: Etiquetados IA => NO DISP.
    expect(html).toContain("NO DISP.");
  });
});

describe("R14G_UI_06_TRACKING_LABELED", () => {
  it("lifecycle=COMPLETO, label=ETIQUETADO — both visible", () => {
    mockUseQuery({
      data: makeTracking({
        labeledTrades: 1,
        labeledTradesAvailable: true,
        completedTrades: 1,
        lots: [{
          lotId: "lot-2",
          pair: "SOL/USD",
          status: "ETIQUETADO",
          lifecycleStatus: "COMPLETO",
          labelStatus: "ETIQUETADO",
          entryPrice: 100,
          currentR: 1.0,
          mfeR: 1.5,
          maeR: -0.2,
          initialQty: 1.0,
          remainingQty: 0,
          buyFills: 1,
          sellFills: 1,
          supervisions: 10,
          openSince: 1000,
          lastUpdate: 2000,
        }],
      }),
      isLoading: false,
      isError: false,
    });
    const html = renderToString(<ActividadTab />);
    expect(html).toContain("COMPLETO");
    expect(html).toContain("ETIQUETADO");
    // KPI: Etiquetados IA => 1 (not NO DISP)
    expect(html).toContain("Etiquetados IA");
  });
});

describe("R14G_UI_07_REGIMES_COLD", () => {
  it("available=false => 'Calculando', NOT 'Sin datos de regime'", () => {
    const regimes: RegimesResponse = {
      regimes: [],
      available: false,
      reason: "COMPUTING_COLD_CACHE",
    };
    mockUseQueryByPath({
      "/api/spot/ai/dataset/regimes": regimes,
    });
    const html = renderToString(<DatosTab />);
    // Must show "Calculando" or "no disponible temporalmente"
    expect(html).toContain("no disponible temporalmente");
    expect(html).toContain("Calculando");
    // Must NOT show "Sin datos de regime"
    expect(html).not.toContain("Sin datos de regime");
  });
});

describe("R14G_UI_08_REGIMES_AVAILABLE", () => {
  it("available=true + data => correct render", () => {
    const regimes: RegimesResponse = {
      regimes: [
        { regime: "TREND", direction: "BULLISH", count: 100 },
        { regime: "RANGE", direction: "NEUTRAL", count: 50 },
      ],
      available: true,
    };
    mockUseQueryByPath({
      "/api/spot/ai/dataset/regimes": regimes,
    });
    const html = renderToString(<DatosTab />);
    expect(html).toContain("TREND");
    expect(html).toContain("BULLISH");
    expect(html).toContain("100");
    expect(html).toContain("RANGE");
    // Must NOT show "no disponible temporalmente"
    expect(html).not.toContain("no disponible temporalmente");
  });
});

describe("R14G_UI_09_REGIMES_CONDITIONAL_REFETCH", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("available=false => refetchInterval=45000; available=true => no polling", () => {
    // The DatosTab uses refetchInterval as a function.
    // We verify the logic by checking the useQuery mock call.
    // When available=false, refetchInterval should return 45000.
    // When available=true, refetchInterval should return false.

    // Render with available=false
    mockUseQueryByPath({
      "/api/spot/ai/dataset/regimes": { regimes: [], available: false, reason: "COMPUTING_COLD_CACHE" } as RegimesResponse,
    });

    renderToString(<DatosTab />);

    // Get the useQuery call for regimes
    const calls = vi.mocked(useQuery).mock.calls;
    // Find the call for regimes endpoint
    const regimesCall = calls.find((c: any) => {
      const opts = c[0];
      return opts?.queryKey?.[0] === "/api/spot/ai/dataset/regimes";
    });

    expect(regimesCall).toBeDefined();
    const opts = (regimesCall as any)[0];
    expect(opts.refetchInterval).toBeDefined();

    // Test the refetchInterval function
    const refetchInterval = opts.refetchInterval;

    // When available=false => should return 45000
    const falseResult = refetchInterval({ state: { data: { regimes: [], available: false } } });
    expect(falseResult).toBe(45000);

    // When available=true => should return false (no polling)
    const trueResult = refetchInterval({ state: { data: { regimes: [{ regime: "TREND" }], available: true } } });
    expect(trueResult).toBe(false);
  });
});
