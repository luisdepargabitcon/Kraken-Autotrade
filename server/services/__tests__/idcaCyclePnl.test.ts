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

  describe("Ciclo importado con ventas mayores que compras y con importedAvg", () => {
    it("debe incluir coste importado en el cálculo de PnL", () => {
      const cycle = {
        id: 3,
        pair: "ETH/USD",
        isImported: true,
        isManualCycle: true,
        capitalUsedUsd: 2086,
        totalQuantity: 2.443,
        avgEntryPrice: 2427.01,
        realizedPnlUsd: 2934.75, // This is wrong (sell proceeds, not net profit)
        status: "closed",
        importSnapshotJson: {
          quantity: 1.686,
          avgEntryPrice: 2427.01,
        },
      };

      const orders = [
        {
          side: "buy",
          type: "Compra adicional",
          status: "filled",
          price: 1123,
          quantity: 0.929,
          valueUsd: 1043,
          feeUsd: 0.81,
        },
        {
          side: "buy",
          type: "Compra adicional",
          status: "filled",
          price: 1123,
          quantity: 0.929,
          valueUsd: 1043,
          feeUsd: 0.81,
        },
        {
          side: "sell",
          type: "Venta manual",
          status: "filled",
          price: 2650,
          quantity: 1.216,
          valueUsd: 3219.39,
          feeUsd: 0.81,
        },
        {
          side: "sell",
          type: "Venta parcial",
          status: "filled",
          price: 2700,
          quantity: 1.227,
          valueUsd: 1801.36,
          feeUsd: 0.81,
        },
      ];

      const result = calculateIdcaCycleRealizedPnl(cycle, orders);

      // Total sell: 3219.39 + 1801.36 = 5020.75
      // Total buy: 1043 + 1043 = 2086 + fees = 2087.62
      // Imported lot: 1.686 * 2427.01 = 4091.94
      // Total cost basis: 2087.62 + 4091.94 = 6179.56
      // Sold qty: 1.216 + 1.227 = 2.443
      // Buy qty: 0.929 + 0.929 = 1.858
      // Imported needed: 2.443 - 1.858 = 0.585
      // Cost basis for sold: (0.585 * 2427.01) + 2087.62 = 1419.80 + 2087.62 = 3507.42
      // Realized net: 5020.75 - 3507.42 - 1.62 = 1511.71
      // PnL %: 1511.71 / 3507.42 = 43.1%

      // The key is that it should NOT return +2934.75 or +140.69%
      expect(result.realizedNetUsd).not.toBeCloseTo(2934.75, 1);
      expect(result.realizedPnlPct).not.toBeCloseTo(140.69, 1);
      
      // Should include imported lot
      expect(result.importedOpeningLot).toBeDefined();
      expect(result.importedOpeningLot?.quantity).toBeGreaterThan(0);
      expect(result.importedOpeningLot?.avgPrice).toBeGreaterThan(0);
      
      // PnL should be reasonable (< 50%)
      expect(Math.abs(result.realizedPnlPct)).toBeLessThan(50);
    });
  });

  describe("Ciclo importado sin importedAvg", () => {
    it("debe devolver pnlSource='cost_basis_missing' cuando falta precio medio importado", () => {
      const cycle = {
        id: 4,
        pair: "ETH/USD",
        isImported: true,
        capitalUsedUsd: 2086,
        totalQuantity: 2.443,
        avgEntryPrice: 0, // Missing
        realizedPnlUsd: 2934.75,
        status: "closed",
      };

      const orders = [
        {
          side: "buy",
          type: "Compra adicional",
          status: "filled",
          price: 1123,
          quantity: 0.929,
          valueUsd: 1043,
          feeUsd: 0.81,
        },
        {
          side: "sell",
          type: "Venta manual",
          status: "filled",
          price: 2650,
          quantity: 2.443,
          valueUsd: 5022.37,
          feeUsd: 1.62,
        },
      ];

      const result = calculateIdcaCycleRealizedPnl(cycle, orders);

      expect(result.pnlSource).toBe("cost_basis_missing");
      expect(result.realizedNetUsd).toBe(0);
      expect(result.realizedPnlPct).toBe(0);
      expect(result.warnings).toContainEqual(expect.stringContaining("Cannot determine imported average price"));
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
          type: "Venta manual",
          status: "filled",
          price: 50000,
          quantity: 0.1,
          valueUsd: 5000,
          feeUsd: 5,
        },
      ];

      const result = calculateIdcaCycleRealizedPnl(cycle, orders);

      expect(result.pnlSource).toBe("cost_basis_missing");
      expect(result.realizedNetUsd).toBe(0);
      // Not a win
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
          type: "Venta manual",
          status: "filled",
          price: 10000,
          quantity: 1,
          valueUsd: 10000,
          feeUsd: 10,
        },
      ];

      const result = calculateIdcaCycleRealizedPnl(cycle, orders);

      // Should not show giant PnL
      expect(result.realizedNetUsd).not.toBeGreaterThan(1000);
      expect(result.pnlSource).toBe("cost_basis_missing");
    });
  });

  describe("Side/type en castellano", () => {
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
          type: "compra inicial",
          status: "filled",
          price: 100000,
          quantity: 0.005,
          valueUsd: 500,
          feeUsd: 0.50,
        },
        {
          side: "VENTA",
          type: "venta final trailing",
          status: "filled",
          price: 105000,
          quantity: 0.005,
          valueUsd: 525,
          feeUsd: 0.50,
        },
      ];

      const result = calculateIdcaCycleRealizedPnl(cycle, orders);

      expect(result.realizedNetUsd).toBeCloseTo(24, 0);
      expect(result.pnlSource).toBe("orders");
    });
  });

  describe("valueUsd faltante", () => {
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
          type: "initial_buy",
          status: "filled",
          price: 100000,
          quantity: 0.005,
          valueUsd: 0, // Missing
          feeUsd: 0.50,
        },
        {
          side: "sell",
          type: "trailing_exit",
          status: "filled",
          price: 105000,
          quantity: 0.005,
          valueUsd: 0, // Missing
          feeUsd: 0.50,
        },
      ];

      const result = calculateIdcaCycleRealizedPnl(cycle, orders);

      expect(result.realizedNetUsd).toBeCloseTo(24, 0);
      expect(result.warnings).toContainEqual(expect.stringContaining("Reconstructed value"));
    });
  });

  describe("realizedPnlUsd con valor de venta", () => {
    it("no debe usar realizedPnlUsd como net PnL cuando es valor de venta", () => {
      const cycle = {
        id: 9,
        pair: "ETH/USD",
        capitalUsedUsd: 1000,
        totalQuantity: 0.5,
        avgEntryPrice: 2000,
        realizedPnlUsd: 2500, // This is sell proceeds, not net profit
        status: "closed",
      };

      const orders = []; // No orders

      const result = calculateIdcaCycleRealizedPnl(cycle, orders);

      // Should not use realizedPnlUsd as net profit (it's > 80% of capital)
      expect(result.pnlSource).not.toBe("cycle_realized");
      expect(result.realizedNetUsd).not.toBe(2500);
    });
  });

  describe("PnL total excluye ciclos cost_basis_missing", () => {
    it("debe excluir ciclos con cost_basis_missing del cálculo de PnL total", () => {
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
          type: "initial_buy",
          status: "filled",
          price: 100000,
          quantity: 0.005,
          valueUsd: 500,
          feeUsd: 0.50,
        },
        {
          side: "sell",
          type: "trailing_exit",
          status: "filled",
          price: 105000,
          quantity: 0.005,
          valueUsd: 525,
          feeUsd: 0.50,
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
          type: "Venta manual",
          status: "filled",
          price: 2000,
          quantity: 1,
          valueUsd: 2000,
          feeUsd: 10,
        },
      ];

      const result1 = calculateIdcaCycleRealizedPnl(cycle1, orders1);
      const result2 = calculateIdcaCycleRealizedPnl(cycle2, orders2);

      // Cycle 1 should have valid PnL
      expect(result1.pnlSource).toBe("orders");
      expect(result1.realizedNetUsd).toBeCloseTo(24, 0);

      // Cycle 2 should be cost_basis_missing
      expect(result2.pnlSource).toBe("cost_basis_missing");
      expect(result2.realizedNetUsd).toBe(0);

      // Total PnL should only include cycle 1
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
          type: "Venta manual",
          status: "filled",
          price: 55000,
          quantity: 0.02,
          valueUsd: 1100,
          feeUsd: 5,
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
          type: "Venta manual",
          status: "filled",
          price: 55000,
          quantity: 0.02,
          valueUsd: 1100,
          feeUsd: 5,
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
          type: "Venta manual",
          status: "filled",
          price: 55000,
          quantity: 0.02,
          valueUsd: 1100,
          feeUsd: 5,
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
          type: "Venta manual",
          status: "filled",
          price: 55000,
          quantity: 0.02,
          valueUsd: 1100,
          feeUsd: 5,
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
          type: "Venta manual",
          status: "filled",
          price: 55000,
          quantity: 0.02,
          valueUsd: 1100,
          feeUsd: 5,
        },
      ];

      const result = calculateIdcaCycleRealizedPnl(cycle, orders);
      expect(result.importedOpeningLot).toBeDefined();
    });
  });
});
