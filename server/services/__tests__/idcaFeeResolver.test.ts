/**
 * Tests para resolveSimulationFeePct — prioridad executionFeesJson > simulationFeePct > 0.09.
 *
 * FR01. Sin executionFeesJson: usa simulationFeePct legacy
 * FR02. Con executionFeesJson.takerFeePct: usa ese valor
 * FR03. takerFeePct=0 (maker Revolut X): devuelve 0
 * FR04. simulationFeePct=0.4 (legacy default): se usa como fallback
 * FR05. Sin ninguno: fallback 0.09 (Revolut X default)
 * FR06. executionFeesJson.takerFeePct=0.09 (Revolut X): simulation fee correcto
 * FR07. Diferencia fee legacy (0.4%) vs Revolut X real (0.09%) sobre 600 USD
 */

import { describe, it, expect } from "vitest";

// ─── Pure resolver (same logic as IdcaEngine.resolveSimulationFeePct) ────────

function resolveSimulationFeePct(config: {
  simulationFeePct?: unknown;
  executionFeesJson?: unknown;
}): number {
  const execFees = config.executionFeesJson as any;
  if (execFees && typeof execFees.takerFeePct === "number") {
    return execFees.takerFeePct;
  }
  const legacy = parseFloat(String(config.simulationFeePct));
  return Number.isFinite(legacy) && legacy >= 0 ? legacy : 0.09;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("resolveSimulationFeePct — prioridad executionFeesJson > legacy > default", () => {
  it("FR01. Sin executionFeesJson usa simulationFeePct legacy (0.4)", () => {
    expect(resolveSimulationFeePct({ simulationFeePct: "0.400" })).toBe(0.4);
  });

  it("FR02. Con executionFeesJson.takerFeePct usa ese valor (0.09)", () => {
    expect(resolveSimulationFeePct({
      simulationFeePct: "0.400",
      executionFeesJson: { takerFeePct: 0.09 },
    })).toBe(0.09);
  });

  it("FR03. takerFeePct=0 (maker Revolut X) devuelve 0", () => {
    expect(resolveSimulationFeePct({
      simulationFeePct: "0.400",
      executionFeesJson: { takerFeePct: 0.0 },
    })).toBe(0.0);
  });

  it("FR04. simulationFeePct legacy default 0.4 sin executionFeesJson", () => {
    expect(resolveSimulationFeePct({ simulationFeePct: "0.400", executionFeesJson: null })).toBe(0.4);
  });

  it("FR05. Sin ningún valor: fallback 0.09 (Revolut X default)", () => {
    expect(resolveSimulationFeePct({})).toBe(0.09);
    expect(resolveSimulationFeePct({ simulationFeePct: undefined })).toBe(0.09);
  });

  it("FR06. executionFeesJson.takerFeePct=0.09 (Revolut X correcto)", () => {
    const fee = resolveSimulationFeePct({
      simulationFeePct: "0.400",
      executionFeesJson: { takerFeePct: 0.09 },
    });
    expect(fee).toBe(0.09);
    // Fee sobre 600 USD = 0.54 (no 2.40 con legacy 0.4%)
    const feeUsd = 600 * fee / 100;
    expect(feeUsd).toBeCloseTo(0.54, 2);
  });

  it("FR07. Diferencia 0.4% legacy vs 0.09% Revolut X sobre 600 USD = 1.86 USD", () => {
    const legacyFee = 600 * 0.4 / 100;   // 2.40
    const realFee   = 600 * 0.09 / 100;  // 0.54
    expect(legacyFee).toBeCloseTo(2.40, 2);
    expect(realFee).toBeCloseTo(0.54, 2);
    expect(legacyFee - realFee).toBeCloseTo(1.86, 2);
  });
});
