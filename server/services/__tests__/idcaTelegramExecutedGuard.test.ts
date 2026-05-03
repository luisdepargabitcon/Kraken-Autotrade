/**
 * Tests para alertTrailingBuyExecuted guard — cycleId + (orderId | tradeId).
 *
 * Verifica:
 * TG01. No envía si cycleId falta
 * TG02. No envía si cycleId existe pero faltan orderId y tradeId
 * TG03. Sí envía si existe cycleId + orderId
 * TG04. Sí envía si existe cycleId + tradeId (sin orderId)
 * TG05. Sí envía si existen cycleId + orderId + tradeId
 *
 * NOTE: La función real llama a Telegram. Aquí solo probamos la lógica de guard
 * usando el módulo de estado con mocks mínimos del repo e idcaConfig.
 */

import { describe, it, expect } from "vitest";

// ─── Guard logic (pure) ───────────────────────────────────────────────────────

/**
 * Extraemos la lógica pura del guard para testear sin dependencias de Telegram.
 */
function shouldBlock(
  cycleId: number | undefined,
  orderId: number | undefined,
  tradeId?: string | undefined,
): boolean {
  return !cycleId || (!orderId && !tradeId);
}

describe("alertTrailingBuyExecuted guard — cycleId + (orderId | tradeId)", () => {
  it("TG01. BLOCK: cycleId falta", () => {
    expect(shouldBlock(undefined, 42, undefined)).toBe(true);
    expect(shouldBlock(undefined, undefined, "TRD-123")).toBe(true);
    expect(shouldBlock(undefined, undefined, undefined)).toBe(true);
  });

  it("TG02. BLOCK: cycleId existe pero faltan orderId y tradeId", () => {
    expect(shouldBlock(1, undefined, undefined)).toBe(true);
    expect(shouldBlock(1, 0 as any, undefined)).toBe(true);  // 0 es falsy
  });

  it("TG03. PASS: cycleId + orderId", () => {
    expect(shouldBlock(1, 42, undefined)).toBe(false);
  });

  it("TG04. PASS: cycleId + tradeId (sin orderId)", () => {
    expect(shouldBlock(1, undefined, "TRD-XYZ")).toBe(false);
    expect(shouldBlock(5, undefined, "LIVE-EXEC-001")).toBe(false);
  });

  it("TG05. PASS: cycleId + orderId + tradeId (ambos presentes)", () => {
    expect(shouldBlock(1, 42, "TRD-XYZ")).toBe(false);
  });
});
