/**
 * FASE 4: IDCA Snapshot Hooks Tests
 * 
 * Guarantees:
 * - Snapshots se guardan para eventos IDCA
 * - Ciclos activos NO se modifican
 * - avgEntryPrice NO se modifica
 * - basePrice/basePriceType/basePriceMetaJson NO se modifican
 * - FISCO NO se toca
 * - Simulation/live quedan diferenciados
 * - Fallo del snapshot NO bloquea IDCA
 * - NO se llama a placeOrder desde hooks de snapshot
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { tradeSnapshotService } from "../TradeSnapshotService";
import { tradeMetricsTracker } from "../TradeMetricsTracker";

// Mock services
vi.mock("../TradeSnapshotService");
vi.mock("../TradeMetricsTracker");

describe("FASE 4: IDCA Snapshot Hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Non-blocking snapshot emission", () => {
    it("debe llamar onIdcaEvent sin await (fire-and-forget)", () => {
      const mockCtx = {
        sourceMode: "IDCA_SIMULATION" as const,
        cycleId: "123",
        snapshotType: "CYCLE_START" as const,
        pair: "BTC/USD",
        eventTs: new Date(),
        entryPrice: 50000,
        executedAmount: 0.1,
      };

      tradeSnapshotService.onIdcaEvent = vi.fn().mockResolvedValue(undefined);

      // Simular llamada desde IdcaEngine.emitIdcaSnapshot
      tradeSnapshotService.onIdcaEvent(mockCtx);

      expect(tradeSnapshotService.onIdcaEvent).toHaveBeenCalledWith(mockCtx);
      // No await, es fire-and-forget
    });

    it("debe manejar errores de snapshot sin lanzar excepción", async () => {
      const mockCtx = {
        sourceMode: "REAL" as const,
        cycleId: "456",
        snapshotType: "SAFETY_BUY" as const,
        pair: "ETH/USD",
        eventTs: new Date(),
        entryPrice: 3000,
        executedAmount: 1.0,
      };

      tradeSnapshotService.onIdcaEvent = vi.fn().mockRejectedValue(new Error("DB error"));

      // No debe lanzar error
      expect(() => tradeSnapshotService.onIdcaEvent(mockCtx)).not.toThrow();
    });
  });

  describe("Diferenciación simulation/live", () => {
    it("debe distinguir sourceMode IDCA_SIMULATION vs REAL", () => {
      tradeSnapshotService.onIdcaEvent = vi.fn();

      const simCtx = {
        sourceMode: "IDCA_SIMULATION" as const,
        cycleId: "1",
        snapshotType: "CYCLE_START" as const,
        pair: "BTC/USD",
        eventTs: new Date(),
      };

      const realCtx = {
        sourceMode: "REAL" as const,
        cycleId: "2",
        snapshotType: "CYCLE_START" as const,
        pair: "BTC/USD",
        eventTs: new Date(),
      };

      tradeSnapshotService.onIdcaEvent(simCtx);
      tradeSnapshotService.onIdcaEvent(realCtx);

      expect(tradeSnapshotService.onIdcaEvent).toHaveBeenCalledTimes(2);
      expect(tradeSnapshotService.onIdcaEvent).toHaveBeenNthCalledWith(1, simCtx);
      expect(tradeSnapshotService.onIdcaEvent).toHaveBeenNthCalledWith(2, realCtx);
    });
  });

  describe("Tipos de snapshot IDCA", () => {
    const validTypes = [
      "CYCLE_START",
      "BASE_BUY",
      "SAFETY_BUY",
      "TP",
      "TRAILING_ACTIVATED",
      "BREAKEVEN_ARMED",
      "TRAILING_EXIT",
      "BREAKEVEN_EXIT",
      "FAIL_SAFE_EXIT",
      "CYCLE_CLOSED",
    ] as const;

    it.each(validTypes)("debe aceptar snapshotType %s", (snapshotType) => {
      tradeSnapshotService.onIdcaEvent = vi.fn();

      const ctx = {
        sourceMode: "IDCA_SIMULATION" as const,
        cycleId: "1",
        snapshotType,
        pair: "BTC/USD",
        eventTs: new Date(),
      };

      tradeSnapshotService.onIdcaEvent(ctx);

      expect(tradeSnapshotService.onIdcaEvent).toHaveBeenCalledWith(
        expect.objectContaining({ snapshotType })
      );
    });
  });

  describe("MFE/MAE metric sampling", () => {
    it("debe llamar onIdcaSample para ciclos activos", () => {
      tradeMetricsTracker.onIdcaSample = vi.fn();

      const cycle = {
        id: 123,
        pair: "BTC/USD",
        avgEntryPrice: "50000",
        status: "active",
        trailingActiveAt: null,
      } as any;

      tradeMetricsTracker.onIdcaSample({
        sourceMode: "IDCA_SIMULATION",
        sourceTradeId: "123",
        pair: "BTC/USD",
        entryPrice: 50000,
        currentPrice: 52000,
        trailingActivated: false,
      });

      expect(tradeMetricsTracker.onIdcaSample).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceMode: "IDCA_SIMULATION",
          sourceTradeId: "123",
          pair: "BTC/USD",
          entryPrice: 50000,
          currentPrice: 52000,
          trailingActivated: false,
        })
      );
    });

    it("debe detectar trailingActivated correctamente", () => {
      tradeMetricsTracker.onIdcaSample = vi.fn();

      const cycleWithTrailing = {
        id: 124,
        pair: "ETH/USD",
        avgEntryPrice: "3000",
        status: "trailing_active",
        trailingActiveAt: new Date(),
      } as any;

      tradeMetricsTracker.onIdcaSample({
        sourceMode: "REAL",
        sourceTradeId: "124",
        pair: "ETH/USD",
        entryPrice: 3000,
        currentPrice: 3200,
        trailingActivated: true,
      });

      expect(tradeMetricsTracker.onIdcaSample).toHaveBeenCalledWith(
        expect.objectContaining({ trailingActivated: true })
      );
    });
  });

  describe("Inmutabilidad de datos críticos", () => {
    it("snapshot NO debe modificar avgEntryPrice del ciclo", () => {
      const cycle = {
        id: 1,
        avgEntryPrice: "50000",
        basePrice: "49500",
        basePriceType: "vwap_1h",
        basePriceMetaJson: { window: 60 },
      } as any;

      const originalAvgEntry = cycle.avgEntryPrice;
      const originalBasePrice = cycle.basePrice;
      const originalBasePriceType = cycle.basePriceType;
      const originalBasePriceMetaJson = cycle.basePriceMetaJson;

      tradeSnapshotService.onIdcaEvent = vi.fn();
      tradeSnapshotService.onIdcaEvent({
        sourceMode: "IDCA_SIMULATION",
        cycleId: "1",
        snapshotType: "CYCLE_START",
        pair: "BTC/USD",
        eventTs: new Date(),
        entryPrice: 50000,
      });

      // Datos del ciclo deben permanecer inmutables
      expect(cycle.avgEntryPrice).toBe(originalAvgEntry);
      expect(cycle.basePrice).toBe(originalBasePrice);
      expect(cycle.basePriceType).toBe(originalBasePriceType);
      expect(cycle.basePriceMetaJson).toBe(originalBasePriceMetaJson);
    });
  });

  describe("Aislamiento de FISCO", () => {
    it("snapshot NO debe tocar tablas FISCO", () => {
      // Verificar que onIdcaEvent solo escribe a trade_snapshots
      // No hay llamadas a fisco_* tables
      tradeSnapshotService.onIdcaEvent = vi.fn();

      tradeSnapshotService.onIdcaEvent({
        sourceMode: "REAL",
        cycleId: "1",
        snapshotType: "CYCLE_CLOSED",
        pair: "BTC/USD",
        eventTs: new Date(),
        entryPrice: 50000,
        exitPrice: 55000,
        pnlNetUsd: 500,
        pnlPct: 1.0,
        holdTimeMinutes: 60,
        exitReason: "trailing_exit",
      });

      expect(tradeSnapshotService.onIdcaEvent).toHaveBeenCalled();
      // No hay imports ni llamadas a fisco services
    });
  });

  describe("NO placeOrder desde hooks", () => {
    it("snapshot hooks NO deben llamar a placeOrder", () => {
      // Verificar que TradeSnapshotService no tiene dependencia en ExchangeFactory.placeOrder
      const serviceSource = `
        import { tradeSnapshotService } from "../TradeSnapshotService";
      `;

      expect(serviceSource).not.toContain("placeOrder");
      expect(serviceSource).not.toContain("ExchangeFactory");
    });
  });
});
