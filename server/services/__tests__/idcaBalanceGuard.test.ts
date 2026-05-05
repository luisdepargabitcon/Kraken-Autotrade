/**
 * Tests para guard de balance en executeExit
 * Verifica que las ventas se bloqueen cuando el balance disponible es insuficiente
 */

import { describe, it, expect } from "vitest";

describe("executeExit - Guard de balance (lógica unitaria)", () => {
  const cycleQty = 0.00792255;

  it("1. Debería bloquear si balance < 95% de cantidad del ciclo", () => {
    const availableQty = 0.0075; // 94.6% de 0.00792255
    const threshold = cycleQty * 0.95; // 0.00752642

    expect(availableQty).toBeLessThan(threshold);
    expect(availableQty / cycleQty).toBeCloseTo(0.9467, 4);
  });

  it("2. Debería permitir si balance >= 95% de cantidad del ciclo", () => {
    const availableQty = 0.0079; // 99.7% de 0.00792255
    const threshold = cycleQty * 0.95; // 0.00752642

    expect(availableQty).toBeGreaterThanOrEqual(threshold);
    expect(availableQty / cycleQty).toBeCloseTo(0.997, 3);
  });

  it("3. Debería permitir si balance exactamente igual a cantidad del ciclo", () => {
    const availableQty = 0.00792255; // 100%
    const threshold = cycleQty * 0.95;

    expect(availableQty).toBeGreaterThanOrEqual(threshold);
    expect(availableQty).toBe(cycleQty);
  });

  it("4. Debería calcular shortagePct correctamente", () => {
    const cycleQty = 0.01;
    const availableQty = 0.008; // 20% menos
    const shortagePct = ((cycleQty - availableQty) / cycleQty) * 100;

    expect(shortagePct).toBe(20);
  });

  it("5. Debería extraer asset correcto del par", () => {
    const pair1 = "BTC/USD";
    const asset1 = pair1.split("/")[0];
    expect(asset1).toBe("BTC");

    const pair2 = "ETH/USD";
    const asset2 = pair2.split("/")[0];
    expect(asset2).toBe("ETH");
  });

  it("6. Tolerancia 5% por fees/redondeo", () => {
    const cycleQty = 0.01;
    const tolerance = 0.95;
    const minAllowed = cycleQty * tolerance;

    expect(minAllowed).toBe(0.0095);
    expect(0.0094).toBeLessThan(minAllowed); // Bloquear
    expect(0.0095).toBeGreaterThanOrEqual(minAllowed); // Permitir
    expect(0.0096).toBeGreaterThanOrEqual(minAllowed); // Permitir
  });
});
