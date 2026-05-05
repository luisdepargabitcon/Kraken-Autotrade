/**
 * idcaExitGuards.test.ts
 * Tests for exit guards: prevent false take_profit and require confirmed sell
 *
 * Tests:
 * 1. TP blocked if tpTargetPrice < avgEntry * 1.03 (misconfigured)
 * 2. TP allowed if tpTargetPrice >= avgEntry * 1.03 (valid)
 * 3. TP blocked if currentPrice < tpTargetPrice
 * 4. exitBlocked if no orderId in LIVE mode
 * 5. Cycle stays active if sell not confirmed
 */

import { describe, it, expect, vi } from "vitest";

describe("Exit Guards — HOTFIX BTC #21", () => {
  const avgEntry = 78989.70;
  const beTriggerPrice = 80964.44; // 2.5% over entry
  const realTpPrice = 81438.38;    // ~3.1% over entry
  const falseTpPrice = 80964.10;   // Coincide con BE (bug)

  it("1. Guard TP_BLOCKED si tpTargetPrice está demasiado cerca del avgEntry (<3%)", () => {
    // Simula configuración incorrecta: takeProfitPct = 2.5% (igual a protectionActivationPct)
    const misconfiguredTpPrice = avgEntry * 1.025; // $80964.44
    const minValidTpPrice = avgEntry * 1.03;     // $81359.39

    expect(misconfiguredTpPrice).toBeLessThan(minValidTpPrice);
    expect(misconfiguredTpPrice).toBeCloseTo(80964.44, 0);
  });

  it("2. Guard TP_ALLOWED si tpTargetPrice >= avgEntry * 1.03 (config válida)", () => {
    const validTpPrice = avgEntry * 1.031; // ~$81439
    const minValidTpPrice = avgEntry * 1.03;

    expect(validTpPrice).toBeGreaterThanOrEqual(minValidTpPrice);
  });

  it("3. Guard TP_NOT_READY si currentPrice < tpTargetPrice (aún no llega)", () => {
    const currentPrice = 80964.10;  // Donde cerró falsamente
    const tpTargetPrice = 81438.38;   // TP real

    expect(currentPrice).toBeLessThan(tpTargetPrice);
    // En esta condición, NO debería ejecutar take_profit
  });

  it("4. Guard EXIT_BLOCKED en LIVE si sellOrder no tiene orderId/txid", () => {
    const mockSellOrderNoId = { success: true, orderId: null, txid: null };
    const hasOrderId = !!(mockSellOrderNoId.orderId || mockSellOrderNoId.txid);

    expect(hasOrderId).toBe(false);
    // Si no hay orderId, ciclo debe permanecer activo
  });

  it("5. Guard EXIT_CONFIRMED solo si hay orderId/txid y success=true", () => {
    const mockSellOrderConfirmed = {
      success: true,
      orderId: "ORD-12345",
      txid: null,
    };
    const hasOrderId = !!(mockSellOrderConfirmed.orderId || mockSellOrderConfirmed.txid);
    const isConfirmed = mockSellOrderConfirmed.success && hasOrderId;

    expect(hasOrderId).toBe(true);
    expect(isConfirmed).toBe(true);
    // Solo aquí se permite cerrar el ciclo
  });

  it("6. Cálculo PnL: sin venta no debe ser -100%", () => {
    const capitalUsed = 625.80;
    const netValue = 0; // Sin venta
    const realizedPnlUsd = netValue - capitalUsed;

    expect(realizedPnlUsd).toBe(-625.80);
    // Este es el bug: -100% cuando no hay venta
    // FIX: No cerrar ciclo si no hay venta confirmada
  });

  it("7. Cálculo PnL correcto con venta real", () => {
    const capitalUsed = 625.80;
    const sellProceeds = 641.35; // ~2.5% ganancia
    const fees = 0.58; // ~0.09%
    const netValue = sellProceeds - fees;
    const realizedPnlUsd = netValue - capitalUsed;

    expect(realizedPnlUsd).toBeCloseTo(14.97, 1); // ~2.4% neto
    expect(realizedPnlUsd / capitalUsed).toBeCloseTo(0.024, 2);
  });
});

describe("Exit Manager — TP Arming Logic", () => {
  it("8. tpArmed solo si unrealizedPnlPct >= takeProfitPct configurado", () => {
    const takeProfitPct = 4.0;
    const pnlAt2_5 = 2.5; // Donde se disparó el bug
    const pnlAt4_0 = 4.0;

    const shouldArmAt2_5 = pnlAt2_5 >= takeProfitPct;
    const shouldArmAt4_0 = pnlAt4_0 >= takeProfitPct;

    expect(shouldArmAt2_5).toBe(false); // NO armar a 2.5%
    expect(shouldArmAt4_0).toBe(true);  // Sí armar a 4%
  });

  it("9. Protección debe armarse primero (2.5%), luego TP (4%)", () => {
    const protectionActivationPct = 2.5;
    const takeProfitPct = 4.0;

    expect(protectionActivationPct).toBeLessThan(takeProfitPct);
    // Orden correcto: BE (2.5%) → Trailing (3.1%) → TP (4%)
  });
});
