/**
 * IDCA Cycle PnL Calculator Tests
 * 
 * Tests for calculateIdcaCycleRealizedPnl function in shared/idcaCyclePnl.ts
 * Covers normal cycles, imported/manual cycles, and edge cases.
 */

import { describe, it, expect } from "vitest";
import { calculateIdcaCycleRealizedPnl } from "../../../shared/idcaCyclePnl";

describe("calculateIdcaCycleRealizedPnl", () => {
  describe("Ciclo normal BTC", () => {
    it("debe calcular PnL correcto para ciclo BTC con BUY+SELL", () => {
      const cycle = {
        id: 1,
        pair: "BTC/USD",
        capitalUsedUsd: 625.80,
        totalQuantity: 0.006,
        avgEntryPrice: 104300,
        realizedPnlUsd: 22.25,
        status: "closed",
      };

      const orders = [
        {
          side: "buy",
          type: "initial_buy",
          status: "filled",
          price: 104300,
          quantity: 0.006,
          valueUsd: 625.80,
          feeUsd: 0.50,
        },
        {
          side: "sell",
          type: "trailing_exit",
          status: "filled",
          price: 108008,
          quantity: 0.006,
          valueUsd: 648.05,
          feeUsd: 0.50,
        },
      ];

      const result = calculateIdcaCycleRealizedPnl(cycle, orders);

      // Buy: 625.80 + 0.50 fee = 626.30
      // Sell: 648.05 - 0.50 fee = 647.55
      // Net: 647.55 - 626.30 = 21.25
      expect(result.realizedNetUsd).toBeCloseTo(21.25, 1);
      expect(result.realizedPnlPct).toBeCloseTo(3.39, 1);
      expect(result.pnlSource).toBe("orders");
      expect(result.capitalInvestedUsd).toBeCloseTo(626.30, 1); // includes fee
    });
  });

  describe("Ciclo ETH con BUY+SELL", () => {
    it("debe calcular PnL correcto para ciclo ETH con compras adicionales", () => {
      const cycle = {
        id: 2,
        pair: "ETH/USD",
        capitalUsedUsd: 1043,
        totalQuantity: 0.4,
        avgEntryPrice: 2607.50,
        realizedPnlUsd: 85.01,
        status: "closed",
      };

      const orders = [
        {
          side: "buy",
          type: "initial_buy",
          status: "filled",
          price: 2607.50,
          quantity: 0.4,
          valueUsd: 1043,
          feeUsd: 1.20,
        },
        {
          side: "sell",
          type: "trailing_exit",
          status: "filled",
          price: 2820,
          quantity: 0.4,
          valueUsd: 1128.01,
          feeUsd: 1.20,
        },
      ];

      const result = calculateIdcaCycleRealizedPnl(cycle, orders);

      // Buy: 1043 + 1.20 fee = 1044.20
      // Sell: 1128.01 - 1.20 fee = 1126.81
      // Net: 1126.81 - 1044.20 = 82.61
      expect(result.realizedNetUsd).toBeCloseTo(82.61, 1);
      expect(result.realizedPnlPct).toBeCloseTo(7.91, 1);
      expect(result.pnlSource).toBe("orders");
    });
  });

  describe("Ciclo ETH id=18 (realizedPnlUsd contaminado como valor vendido)", () => {
    it("debe detectar realizedPnlUsd como valor vendido y calcular desde órdenes", () => {
      const cycle = {
        id: 18,
        pair: "ETH/USD",
        capitalUsedUsd: 1043,
        totalQuantity: 0.4,
        avgEntryPrice: 2607.50,
        realizedPnlUsd: 1128.01, // This is sell proceeds, not net profit
        status: "closed",
      };

      const orders = [
        {
          side: "buy",
          order_type: "initial_buy",
          status: "filled",
          price: 2607.50,
          quantity: 0.4,
          gross_value_usd: 1043,
          fees_usd: 1.20,
        },
        {
          side: "sell",
          order_type: "trailing_exit",
          status: "filled",
          price: 2820,
          quantity: 0.4,
          gross_value_usd: 1128.01,
          fees_usd: 1.20,
        },
      ];

      const result = calculateIdcaCycleRealizedPnl(cycle, orders);

      // Buy: 1043 + 1.20 fee = 1044.20
      // Sell: 1128.01 - 1.20 fee = 1126.81
      // Net: 1126.81 - 1044.20 = 82.61
      expect(result.realizedNetUsd).toBeCloseTo(82.61, 1);
      expect(result.realizedPnlPct).toBeCloseTo(7.91, 1);
      expect(result.pnlSource).toBe("orders");
      // Should NOT use realizedPnlUsd as net profit
      expect(result.realizedNetUsd).not.toBe(1128.01);
    });
  });

  describe("Ciclo ETH id=17 (importado con snapshot originalQty/originalCapital)", () => {
    it("debe usar imported_persisted_pnl como canónico y guardar FIFO como auditoría", () => {
      const cycle = {
        id: 17,
        pair: "ETH/USD",
        isImported: true,
        isManualCycle: true,
        sourceType: "manual",
        capitalUsedUsd: 0,
        totalQuantity: 0,
        avgEntryPrice: 2301.64843305,
        realizedPnlUsd: -654.95,
        basePrice: 2427.01,
        basePriceType: "imported_avg",
        status: "closed",
        importSnapshotJson: {
          importedAt: "2026-03-29T11:09:46.452Z",
          soloSalida: true,
          sourceType: "manual",
          feesPaidUsd: 0,
          originalQty: 1.51467812,
          isManualCycle: true,
          exchangeSource: "revolut_x",
          estimatedFeePct: 0.09,
          estimatedFeeUsd: 3.31,
          originalCapital: 3676.1389440212,
          originalAvgPrice: 2427.01,
          feesOverrideManual: false,
          hadActiveCycleAtImport: false,
        },
      };

      const orders = [
        {
          side: "sell",
          order_type: "manual_close",
          status: "filled",
          price: 2650,
          quantity: 1.51467812,
          gross_value_usd: 4013.90,
          fees_usd: 5,
        },
      ];

      const result = calculateIdcaCycleRealizedPnl(cycle, orders);

      // Imported lot should use originalQty and originalCapital
      expect(result.importedOpeningLot).toBeDefined();
      expect(result.importedOpeningLot?.quantity).toBeCloseTo(1.51467812, 6);
      expect(result.importedOpeningLot?.costUsd).toBeCloseTo(3676.1389440212, 2);
      expect(result.importedOpeningLot?.avgPrice).toBeCloseTo(2427.01, 1);
      expect(result.importedOpeningLot?.source).toBe("import_snapshot_original_capital");

      // Should use imported_persisted_pnl as canonical value (negative PnL)
      expect(result.pnlSource).toBe("imported_persisted_pnl");
      expect(result.realizedNetUsd).toBeCloseTo(-654.95, 2);
      expect(result.realizedNetUsd).not.toBe(0);

      // Audit fields should contain FIFO calculation
      expect(result.auditRealizedNetUsd).toBeDefined();
      expect(result.auditRealizedPnlPct).toBeDefined();
      expect(result.auditSource).toBe("orders");
      expect(result.pnlDiscrepancyUsd).toBeGreaterThan(0);
    });
  });

  describe("Ciclo importado con realizedPnlUsd negativo y órdenes incompletas", () => {
    it("debe usar fallback cycle_realized_fallback para PnL negativo persistido", () => {
      const cycle = {
        id: 17,
        pair: "ETH/USD",
        isImported: true,
        isManualCycle: true,
        capitalUsedUsd: 0,
        totalQuantity: 0,
        avgEntryPrice: 2301.64843305,
        realizedPnlUsd: -654.95,
        status: "closed",
        importSnapshotJson: {
          originalQty: 1.51467812,
          originalCapital: 3676.1389440212,
          originalAvgPrice: 2427.01,
        },
      };

      // No orders (simulating incomplete data)
      const orders = [];

      const result = calculateIdcaCycleRealizedPnl(cycle, orders);

      // Should use realizedPnlUsd as fallback for imported cycle with negative PnL
      expect(result.realizedNetUsd).toBe(-654.95);
      expect(result.pnlSource).toBe("cycle_realized_fallback");
      // Should NOT return 0
      expect(result.realizedNetUsd).not.toBe(0);
    });
  });

  describe("Ciclo ETH id=17 con costBasisMissing y realizedPnlUsd negativo", () => {
    it("debe usar imported_persisted_pnl en lugar de cost_basis_missing", () => {
      const cycle = {
        id: 17,
        pair: "ETH/USD",
        isImported: true,
        isManualCycle: true,
        sourceType: "manual",
        capitalUsedUsd: 0,
        totalQuantity: 0,
        avgEntryPrice: 2301.64843305,
        realizedPnlUsd: -654.95,
        basePrice: 2427.01,
        basePriceType: "imported_avg",
        status: "closed",
        importSnapshotJson: {
          importedAt: "2026-03-29T11:09:46.452Z",
          soloSalida: true,
          sourceType: "manual",
          feesPaidUsd: 0,
          originalQty: 1.51467812,
          isManualCycle: true,
          exchangeSource: "revolut_x",
          estimatedFeePct: 0.09,
          estimatedFeeUsd: 3.31,
          originalCapital: 3676.1389440212,
          originalAvgPrice: 2427.01,
          feesOverrideManual: false,
          hadActiveCycleAtImport: false,
        },
      };

      // Orders that cause costBasisMissing (sell qty > buy qty + imported lot not fully accounted)
      const orders = [
        {
          side: "sell",
          order_type: "manual_close",
          status: "filled",
          price: 2650,
          quantity: 2.0, // More than imported lot (1.51467812)
          gross_value_usd: 5300,
          fees_usd: 5,
        },
      ];

      const result = calculateIdcaCycleRealizedPnl(cycle, orders);

      // Should use imported_persisted_pnl instead of cost_basis_missing
      expect(result.pnlSource).toBe("imported_persisted_pnl");
      expect(result.realizedNetUsd).toBeCloseTo(-654.95, 2);
      expect(result.realizedNetUsd).not.toBe(0);
      expect(result.importedOpeningLot?.costUsd).toBeCloseTo(3676.1389440212, 2);
      expect(result.importedOpeningLot?.quantity).toBeCloseTo(1.51467812, 6);
    });
  });

  describe("Ciclo ETH id=17 con órdenes completas y realizedPnlUsd negativo", () => {
    it("debe usar imported_persisted_pnl como canónico y guardar FIFO como auditoría", () => {
      const cycle = {
        id: 17,
        pair: "ETH/USD",
        isImported: true,
        isManualCycle: true,
        sourceType: "manual",
        capitalUsedUsd: 0,
        totalQuantity: 0,
        avgEntryPrice: 2301.64843305,
        realizedPnlUsd: -654.95,
        basePrice: 2427.01,
        basePriceType: "imported_avg",
        status: "closed",
        importSnapshotJson: {
          importedAt: "2026-03-29T11:09:46.452Z",
          soloSalida: true,
          sourceType: "manual",
          feesPaidUsd: 0,
          originalQty: 1.51467812,
          isManualCycle: true,
          exchangeSource: "revolut_x",
          estimatedFeePct: 0.09,
          estimatedFeeUsd: 3.31,
          originalCapital: 3676.1389440212,
          originalAvgPrice: 2427.01,
          feesOverrideManual: false,
          hadActiveCycleAtImport: false,
        },
      };

      // Orders that allow FIFO calculation (sell qty matches imported lot)
      const orders = [
        {
          side: "sell",
          order_type: "manual_close",
          status: "filled",
          price: 2650,
          quantity: 1.51467812, // Matches imported lot
          gross_value_usd: 4013.90,
          fees_usd: 5,
        },
      ];

      const result = calculateIdcaCycleRealizedPnl(cycle, orders);

      // Should use imported_persisted_pnl as canonical value
      expect(result.pnlSource).toBe("imported_persisted_pnl");
      expect(result.realizedNetUsd).toBeCloseTo(-654.95, 2);
      expect(result.realizedNetUsd).not.toBe(0);
      expect(result.importedOpeningLot?.costUsd).toBeCloseTo(3676.1389440212, 2);
      expect(result.importedOpeningLot?.quantity).toBeCloseTo(1.51467812, 6);

      // Audit fields should contain FIFO calculation
      expect(result.auditRealizedNetUsd).toBeDefined();
      expect(result.auditRealizedPnlPct).toBeDefined();
      expect(result.auditSource).toBe("orders");
      expect(result.pnlDiscrepancyUsd).toBeGreaterThan(0);
      expect(result.pnlDiscrepancyPct).toBeGreaterThan(0);

      // FIFO calculated PnL should be different from persisted PnL
      expect(result.auditRealizedNetUsd).not.toBeCloseTo(-654.95, 1);
    });
  });

  describe("Ciclo importado con ventas > compras y snapshot válido", () => {
    it("debe usar FIFO importado y no devolver +140%", () => {
      const cycle = {
        id: 3,
        pair: "ETH/USD",
        isImported: true,
        isManualCycle: true,
        capitalUsedUsd: 2086,
        totalQuantity: 2.443,
        avgEntryPrice: 2427.01,
        realizedPnlUsd: 2934.75,
        status: "closed",
        importSnapshotJson: {
          originalQty: 1.686,
          originalCapital: 4091.94,
          originalAvgPrice: 2427.01,
        },
      };

      const orders = [
        {
          side: "buy",
          order_type: "safety_order",
          status: "filled",
          price: 1123,
          quantity: 0.929,
          gross_value_usd: 1043,
          fees_usd: 0.81,
        },
        {
          side: "buy",
          order_type: "safety_order",
          status: "filled",
          price: 1123,
          quantity: 0.929,
          gross_value_usd: 1043,
          fees_usd: 0.81,
        },
        {
          side: "sell",
          order_type: "manual_close",
          status: "filled",
          price: 2650,
          quantity: 1.216,
          gross_value_usd: 3219.39,
          fees_usd: 0.81,
        },
        {
          side: "sell",
          order_type: "manual_close",
          status: "filled",
          price: 2700,
          quantity: 1.227,
          gross_value_usd: 1801.36,
          fees_usd: 0.81,
        },
      ];

      const result = calculateIdcaCycleRealizedPnl(cycle, orders);

      // Should NOT return +2934.75 or +140%
      expect(result.realizedNetUsd).not.toBeCloseTo(2934.75, 1);
      expect(result.realizedPnlPct).not.toBeCloseTo(140.69, 1);
      expect(Math.abs(result.realizedPnlPct)).toBeLessThan(50);
    });
  });


  describe("Ciclo normal no importado con realizedPnlUsd neto", () => {
    it("debe mantener comportamiento actual (calcular desde órdenes)", () => {
      const cycle = {
        id: 21,
        pair: "BTC/USD",
        capitalUsedUsd: 500,
        totalQuantity: 0.005,
        avgEntryPrice: 100000,
        realizedPnlUsd: 24,
        status: "closed",
      };

      const orders = [
        {
          side: "buy",
          order_type: "initial_buy",
          status: "filled",
          price: 100000,
          quantity: 0.005,
          gross_value_usd: 500,
          fees_usd: 0.50,
        },
        {
          side: "sell",
          order_type: "trailing_exit",
          status: "filled",
          price: 105000,
          quantity: 0.005,
          gross_value_usd: 525,
          fees_usd: 0.50,
        },
      ];

      const result = calculateIdcaCycleRealizedPnl(cycle, orders);

      // Should calculate from orders, not use realizedPnlUsd
      expect(result.pnlSource).toBe("orders");
      expect(result.realizedNetUsd).toBeCloseTo(24, 0);
      expect(result.realizedNetUsd).not.toBe(0);
    });
  });

  describe("Ciclo importado sin realizedPnlUsd y sin snapshot", () => {
    it("debe mantener cost_basis_missing", () => {
      const cycle = {
        id: 22,
        pair: "ETH/USD",
        isImported: true,
        capitalUsedUsd: 0,
        totalQuantity: 0,
        avgEntryPrice: 0,
        realizedPnlUsd: 0,
        status: "closed",
      };

      const orders = [
        {
          side: "sell",
          order_type: "manual_close",
          status: "filled",
          price: 2000,
          quantity: 1,
          gross_value_usd: 2000,
          fees_usd: 10,
        },
      ];

      const result = calculateIdcaCycleRealizedPnl(cycle, orders);

      expect(result.pnlSource).toBe("cost_basis_missing");
      expect(result.realizedNetUsd).toBe(0);
    });
  });

  describe("Ciclo importado sin snapshot y ventas > compras", () => {
    it("debe devolver pnlSource='cost_basis_missing' cuando falta snapshot", () => {
      const cycle = {
        id: 4,
        pair: "ETH/USD",
        isImported: true,
        capitalUsedUsd: 2086,
        totalQuantity: 2.443,
        avgEntryPrice: 0,
        realizedPnlUsd: 2934.75,
        status: "closed",
      };

      const orders = [
        {
          side: "buy",
          order_type: "safety_order",
          status: "filled",
          price: 1123,
          quantity: 0.929,
          gross_value_usd: 1043,
          fees_usd: 0.81,
        },
        {
          side: "sell",
          order_type: "manual_close",
          status: "filled",
          price: 2650,
          quantity: 2.443,
          gross_value_usd: 5022.37,
          fees_usd: 1.62,
        },
      ];

      const result = calculateIdcaCycleRealizedPnl(cycle, orders);

      expect(result.pnlSource).toBe("cost_basis_missing");
      expect(result.realizedNetUsd).toBe(0);
      expect(result.realizedPnlPct).toBe(0);
    });
  });

  describe("Ciclo importado sin coste base", () => {
    it("no debe contar como win cuando el coste base está ausente", () => {
      const cycle = {
        id: 5,
        pair: "BTC/USD",
        isImported: true,
        capitalUsedUsd: 0,
        totalQuantity: 0,
        avgEntryPrice: 0,
        realizedPnlUsd: 5000,
        status: "closed",
      };

      const orders = [
        {
          side: "sell",
          order_type: "manual_close",
          status: "filled",
          price: 50000,
          quantity: 0.1,
          gross_value_usd: 5000,
          fees_usd: 5,
        },
      ];

      const result = calculateIdcaCycleRealizedPnl(cycle, orders);

      expect(result.pnlSource).toBe("cost_basis_missing");
      expect(result.realizedNetUsd).toBe(0);
      expect(result.realizedNetUsd).not.toBeGreaterThan(1);
    });
  });

  describe("Ciclo importado con coste base incompleto", () => {
    it("no debe mostrar PnL positivo gigante", () => {
      const cycle = {
        id: 6,
        pair: "ETH/USD",
        isImported: true,
        capitalUsedUsd: 100,
        totalQuantity: 1,
        avgEntryPrice: 100,
        realizedPnlUsd: 10000,
        status: "closed",
      };

      const orders = [
        {
          side: "sell",
          order_type: "manual_close",
          status: "filled",
          price: 10000,
          quantity: 1,
          gross_value_usd: 10000,
          fees_usd: 10,
        },
      ];

      const result = calculateIdcaCycleRealizedPnl(cycle, orders);

      expect(result.realizedNetUsd).not.toBeGreaterThan(1000);
      expect(result.pnlSource).toBe("cost_basis_missing");
    });
  });

  describe("Side/order_type en castellano", () => {
    it("debe normalizar 'COMPRA' y 'VENTA' correctamente", () => {
      const cycle = {
        id: 7,
        pair: "BTC/USD",
        capitalUsedUsd: 500,
        totalQuantity: 0.005,
        avgEntryPrice: 100000,
        status: "closed",
      };

      const orders = [
        {
          side: "COMPRA",
          order_type: "compra inicial",
          status: "filled",
          price: 100000,
          quantity: 0.005,
          gross_value_usd: 500,
          fees_usd: 0.50,
        },
        {
          side: "VENTA",
          order_type: "venta final trailing",
          status: "filled",
          price: 105000,
          quantity: 0.005,
          gross_value_usd: 525,
          fees_usd: 0.50,
        },
      ];

      const result = calculateIdcaCycleRealizedPnl(cycle, orders);

      expect(result.realizedNetUsd).toBeCloseTo(24, 0);
      expect(result.pnlSource).toBe("orders");
    });
  });

  describe("gross_value_usd faltante", () => {
    it("debe reconstruir valueUsd desde price * quantity", () => {
      const cycle = {
        id: 8,
        pair: "BTC/USD",
        capitalUsedUsd: 500,
        totalQuantity: 0.005,
        avgEntryPrice: 100000,
        status: "closed",
      };

      const orders = [
        {
          side: "buy",
          order_type: "initial_buy",
          status: "filled",
          price: 100000,
          quantity: 0.005,
          gross_value_usd: 0,
          fees_usd: 0.50,
        },
        {
          side: "sell",
          order_type: "trailing_exit",
          status: "filled",
          price: 105000,
          quantity: 0.005,
          gross_value_usd: 0,
          fees_usd: 0.50,
        },
      ];

      const result = calculateIdcaCycleRealizedPnl(cycle, orders);

      expect(result.realizedNetUsd).toBeCloseTo(24, 0);
      expect(result.warnings).toContainEqual(expect.stringContaining("Reconstructed value"));
    });
  });

  describe("realizedPnlUsd > capital*0.5", () => {
    it("no debe usar realizedPnlUsd como PnL neto", () => {
      const cycle = {
        id: 9,
        pair: "ETH/USD",
        capitalUsedUsd: 1000,
        totalQuantity: 0.5,
        avgEntryPrice: 2000,
        realizedPnlUsd: 2500,
        status: "closed",
      };

      const orders = [];

      const result = calculateIdcaCycleRealizedPnl(cycle, orders);

      expect(result.pnlSource).toBe("insufficient");
      expect(result.realizedNetUsd).toBe(0);
    });
  });

  describe("realizedPnlUsd parecido a totalSellValue", () => {
    it("no debe usar realizedPnlUsd como PnL neto", () => {
      const cycle = {
        id: 10,
        pair: "ETH/USD",
        capitalUsedUsd: 1043,
        totalQuantity: 0.4,
        avgEntryPrice: 2607.50,
        realizedPnlUsd: 1128.01,
        status: "closed",
      };

      const orders = [
        {
          side: "sell",
          order_type: "trailing_exit",
          status: "filled",
          price: 2820,
          quantity: 0.4,
          gross_value_usd: 1128.01,
          fees_usd: 1.20,
        },
      ];

      const result = calculateIdcaCycleRealizedPnl(cycle, orders);

      // Should use capitalUsedUsd as cost basis (no BUY orders)
      expect(result.pnlSource).toBe("orders_cycle_capital");
      // PnL should be calculated from orders, not from realizedPnlUsd
      expect(result.realizedNetUsd).toBeCloseTo(83.81, 1); // 1128.01 - 1043 - 1.20
      // Should NOT use realizedPnlUsd (1128.01) as net profit
      expect(result.realizedNetUsd).not.toBe(1128.01);
    });
  });

  describe("PnL total excluye ciclos cost_basis_missing e insufficient", () => {
    it("debe excluir ciclos con cost_basis_missing e insufficient del cálculo de PnL total", () => {
      const cycle1 = {
        id: 10,
        pair: "BTC/USD",
        capitalUsedUsd: 500,
        totalQuantity: 0.005,
        avgEntryPrice: 100000,
        status: "closed",
      };

      const orders1 = [
        {
          side: "buy",
          order_type: "initial_buy",
          status: "filled",
          price: 100000,
          quantity: 0.005,
          gross_value_usd: 500,
          fees_usd: 0.50,
        },
        {
          side: "sell",
          order_type: "trailing_exit",
          status: "filled",
          price: 105000,
          quantity: 0.005,
          gross_value_usd: 525,
          fees_usd: 0.50,
        },
      ];

      const cycle2 = {
        id: 11,
        pair: "ETH/USD",
        isImported: true,
        capitalUsedUsd: 0,
        totalQuantity: 0,
        avgEntryPrice: 0,
        status: "closed",
      };

      const orders2 = [
        {
          side: "sell",
          order_type: "manual_close",
          status: "filled",
          price: 2000,
          quantity: 1,
          gross_value_usd: 2000,
          fees_usd: 10,
        },
      ];

      const result1 = calculateIdcaCycleRealizedPnl(cycle1, orders1);
      const result2 = calculateIdcaCycleRealizedPnl(cycle2, orders2);

      expect(result1.pnlSource).toBe("orders");
      expect(result1.realizedNetUsd).toBeCloseTo(24, 0);
      expect(result2.pnlSource).toBe("cost_basis_missing");
      expect(result2.realizedNetUsd).toBe(0);

      const totalPnl = result1.realizedNetUsd + result2.realizedNetUsd;
      expect(totalPnl).toBeCloseTo(24, 0);
    });
  });

  describe("Detección de ciclos importados/manuales", () => {
    it("debe detectar ciclo importado por isImported", () => {
      const cycle = {
        id: 12,
        pair: "BTC/USD",
        isImported: true,
        capitalUsedUsd: 1000,
        totalQuantity: 0.02,
        avgEntryPrice: 50000,
        status: "closed",
      };

      const orders = [
        {
          side: "sell",
          order_type: "manual_close",
          status: "filled",
          price: 55000,
          quantity: 0.02,
          gross_value_usd: 1100,
          fees_usd: 5,
        },
      ];

      const result = calculateIdcaCycleRealizedPnl(cycle, orders);
      expect(result.importedOpeningLot).toBeDefined();
    });

    it("debe detectar ciclo importado por is_imported (snake_case)", () => {
      const cycle = {
        id: 13,
        pair: "BTC/USD",
        is_imported: true,
        capitalUsedUsd: 1000,
        totalQuantity: 0.02,
        avgEntryPrice: 50000,
        status: "closed",
      };

      const orders = [
        {
          side: "sell",
          order_type: "manual_close",
          status: "filled",
          price: 55000,
          quantity: 0.02,
          gross_value_usd: 1100,
          fees_usd: 5,
        },
      ];

      const result = calculateIdcaCycleRealizedPnl(cycle, orders);
      expect(result.importedOpeningLot).toBeDefined();
    });

    it("debe detectar ciclo manual por isManualCycle", () => {
      const cycle = {
        id: 14,
        pair: "BTC/USD",
        isManualCycle: true,
        capitalUsedUsd: 1000,
        totalQuantity: 0.02,
        avgEntryPrice: 50000,
        status: "closed",
      };

      const orders = [
        {
          side: "sell",
          order_type: "manual_close",
          status: "filled",
          price: 55000,
          quantity: 0.02,
          gross_value_usd: 1100,
          fees_usd: 5,
        },
      ];

      const result = calculateIdcaCycleRealizedPnl(cycle, orders);
      expect(result.importedOpeningLot).toBeDefined();
    });

    it("debe detectar ciclo manual por sourceType='manual'", () => {
      const cycle = {
        id: 15,
        pair: "BTC/USD",
        sourceType: "manual",
        capitalUsedUsd: 1000,
        totalQuantity: 0.02,
        avgEntryPrice: 50000,
        status: "closed",
      };

      const orders = [
        {
          side: "sell",
          order_type: "manual_close",
          status: "filled",
          price: 55000,
          quantity: 0.02,
          gross_value_usd: 1100,
          fees_usd: 5,
        },
      ];

      const result = calculateIdcaCycleRealizedPnl(cycle, orders);
      expect(result.importedOpeningLot).toBeDefined();
    });

    it("debe detectar ciclo importado por basePriceType='imported_avg'", () => {
      const cycle = {
        id: 16,
        pair: "BTC/USD",
        basePriceType: "imported_avg",
        basePrice: 50000,
        capitalUsedUsd: 1000,
        totalQuantity: 0.02,
        avgEntryPrice: 50000,
        status: "closed",
      };

      const orders = [
        {
          side: "sell",
          order_type: "manual_close",
          status: "filled",
          price: 55000,
          quantity: 0.02,
          gross_value_usd: 1100,
          fees_usd: 5,
        },
      ];

      const result = calculateIdcaCycleRealizedPnl(cycle, orders);
      expect(result.importedOpeningLot).toBeDefined();
    });
  });
});
