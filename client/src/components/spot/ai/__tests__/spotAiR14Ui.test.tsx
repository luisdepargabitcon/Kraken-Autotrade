/**
 * spotAiR14Ui.test.tsx — R14 UI tests for IA Forward Twin panel.
 *
 * Tests:
 *   UI_01: Status loading state
 *   UI_02: Status error not infinite loading
 *   UI_03: Retry button present on error
 *   UI_04: Status success render
 *   UI_05: Historical SPOT labeled as reference
 *   UI_06: Valid fill not called trade
 *   UI_07: Tracked lots visible
 *   UI_08: Legacy excluded visible
 *   UI_09: Analytic error state
 *   UI_10: Analytic loading independent from main panel
 */

import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { SpotAiForwardTwinPanel } from "../SpotAiForwardTwinPanel";
import { ActividadTab } from "../tabs/ActividadTab";
import { DatosTab } from "../tabs/DatosTab";
import { fetchJsonWithTimeout, TimeoutError } from "../fetchWithTimeout";

// ─── Mock useQuery to control loading/error/success states ────────────────

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(),
}));

import { useQuery } from "@tanstack/react-query";

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

// ─── Tests ────────────────────────────────────────────────────────────────

describe("R14 UI tests — IA Forward Twin panel", () => {

  // UI_01: Status loading state
  it("UI_01_STATUS_LOADING — shows loading spinner", () => {
    mockUseQuery({ isLoading: true, isError: false, data: undefined });
    const html = renderToString(<SpotAiForwardTwinPanel />);
    expect(html).toContain("Cargando");
  });

  // UI_02: Status error NOT infinite loading
  it("UI_02_STATUS_ERROR_NOT_INFINITE_LOADING — shows error not loading", () => {
    mockUseQuery({
      isLoading: false,
      isError: true,
      data: undefined,
      error: new Error("network"),
    });
    const html = renderToString(<SpotAiForwardTwinPanel />);
    // Should NOT show "Cargando" when error
    expect(html).not.toContain("Cargando Centro");
    // Should show error message
    expect(html).toContain("No se pudo cargar");
  });

  // UI_03: Retry button present on error
  it("UI_03_RETRY_BUTTON — retry button visible on error", () => {
    mockUseQuery({
      isLoading: false,
      isError: true,
      data: undefined,
      error: new Error("network"),
    });
    const html = renderToString(<SpotAiForwardTwinPanel />);
    expect(html).toContain("Reintentar");
  });

  // UI_04: Status success render
  it("UI_04_STATUS_SUCCESS_RENDER — renders panel with status", () => {
    mockUseQuery({
      isLoading: false,
      isError: false,
      data: {
        status: "COLLECTING",
        featureSchemaVersion: 1,
        totalSnapshots: 100,
        labeledTrades: 0,
        minTradesToTrain: 100,
        preferredTradesToTrain: 200,
        entryModelVersion: null,
        givebackModelVersion: null,
        entryModelStatus: "NOT_TRAINED",
        givebackModelStatus: "NOT_TRAINED",
        autoRetrain: false,
        aiTradingControl: "NONE",
        legacyDataMixed: false,
      },
    });
    const html = renderToString(<SpotAiForwardTwinPanel />);
    expect(html).toContain("CENTRO DE INTELIGENCIA");
    expect(html).toContain("Solo observación");
    expect(html).toContain("Sin control de trading");
  });

  // UI_05: Historical SPOT labeled as reference
  it("UI_05_HISTORICAL_SPOT_LABELED_AS_REFERENCE — ActividadTab shows reference", () => {
    vi.mocked(useQuery).mockReturnValue({
      data: {
        historicalSpotTrades: 41,
        historicalSpotNote: "Referencia — no usados por IA",
        totalSnapshots: 16000,
        scanCount: 15000,
        supervisorCount: 1700,
        fillCount: 12,
        legacyFillCount: 6,
        validFillCount: 6,
        uniqueLots: 3,
        trackedLotsCount: 3,
        completedTrades: 0,
        labeledTrades: 0,
        durableStorageAvailable: true,
        lots: [],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as any);
    const html = renderToString(<ActividadTab />);
    expect(html).toContain("Histórico SPOT");
    expect(html).toContain("Referencia");
    expect(html).toContain("41");
  });

  // UI_06: Valid fill not called trade
  it("UI_06_VALID_FILL_NOT_CALLED_TRADE — FILL not labeled as trade", () => {
    vi.mocked(useQuery).mockReturnValue({
      data: {
        historicalSpotTrades: 41,
        historicalSpotNote: "Referencia — no usados por IA",
        totalSnapshots: 16000,
        scanCount: 15000,
        supervisorCount: 1700,
        fillCount: 12,
        legacyFillCount: 6,
        validFillCount: 6,
        uniqueLots: 3,
        trackedLotsCount: 3,
        completedTrades: 0,
        labeledTrades: 0,
        durableStorageAvailable: true,
        lots: [],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as any);
    const html = renderToString(<ActividadTab />);
    // Should show "FILL válidos" not "trades"
    expect(html).toContain("FILL válidos");
    // Should show the note about FILL != trade
    expect(html).toContain("Un FILL no equivale necesariamente a un trade");
  });

  // UI_07: Tracked lots visible
  it("UI_07_TRACKED_LOTS_VISIBLE — tracked lots table present", () => {
    vi.mocked(useQuery).mockReturnValue({
      data: {
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
        durableStorageAvailable: true,
        lots: [{
          lotId: "lot-abc",
          pair: "BTC/USD",
          status: "EN_SEGUIMIENTO",
          entryPrice: 100,
          currentR: 0.3,
          mfeR: 0.5,
          maeR: -0.2,
          initialQty: 0.5,
          remainingQty: 0.5,
          buyFills: 1,
          sellFills: 0,
          supervisions: 5,
          openSince: 1787738735328,
          lastUpdate: 1787918880733,
        }],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as any);
    const html = renderToString(<ActividadTab />);
    expect(html).toContain("Lotes en Seguimiento");
    expect(html).toContain("lot-abc");
    expect(html).toContain("EN SEGUIMIENTO");
  });

  // UI_08: Legacy excluded visible
  it("UI_08_LEGACY_EXCLUDED_VISIBLE — legacy fill count shown", () => {
    vi.mocked(useQuery).mockReturnValue({
      data: {
        historicalSpotTrades: 41,
        historicalSpotNote: "Referencia — no usados por IA",
        totalSnapshots: 16000,
        scanCount: 15000,
        supervisorCount: 1700,
        fillCount: 12,
        legacyFillCount: 6,
        validFillCount: 6,
        uniqueLots: 0,
        trackedLotsCount: 0,
        completedTrades: 0,
        labeledTrades: 0,
        durableStorageAvailable: true,
        lots: [],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as any);
    const html = renderToString(<ActividadTab />);
    expect(html).toContain("FILL legacy excluidos");
    expect(html).toContain("6");
  });

  // UI_09: Analytic error state
  it("UI_09_ANALYTIC_ERROR_STATE — DatosTab shows error on failure", () => {
    vi.mocked(useQuery).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("fetch"),
      refetch: vi.fn(),
    } as any);
    const html = renderToString(<DatosTab />);
    // Should show error message with retry
    expect(html).toContain("Error al cargar datos analíticos");
    expect(html).toContain("Reintentar");
  });

  // UI_10: Analytic loading independent from main panel
  it("UI_10_ANALYTIC_LOADING_INDEPENDENT — DatosTab loading does not block panel", () => {
    // DatosTab in loading state should show "Cargando..." not error.
    vi.mocked(useQuery).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as any);
    const html = renderToString(<DatosTab />);
    // Should show loading text, not error
    expect(html).toContain("Cargando");
    expect(html).not.toContain("Error al cargar");
  });

  // ─── fetchWithTimeout tests ──────────────────────────────────────────────

  it("FETCH_TIMEOUT_THROWS_TIMEOUT_ERROR", async () => {
    // Mock fetch to reject with AbortError (simulates timeout firing)
    const originalFetch = global.fetch;
    const abortError = new Error("Aborted");
    abortError.name = "AbortError";
    global.fetch = vi.fn().mockImplementation((_url: string, opts?: any) => {
      // Simulate the abort firing immediately
      if (opts?.signal) {
        opts.signal.dispatchEvent?.(new Event("abort"));
      }
      return Promise.reject(abortError);
    });
    try {
      await expect(fetchJsonWithTimeout("/test", 50)).rejects.toThrow(TimeoutError);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("FETCH_TIMEOUT_ERROR_MESSAGE", () => {
    const err = new TimeoutError(5000);
    expect(err.message).toContain("5000");
    expect(err.name).toBe("TimeoutError");
  });
});
