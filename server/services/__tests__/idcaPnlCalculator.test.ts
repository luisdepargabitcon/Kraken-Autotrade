/**
 * Tests para IdcaPnlCalculator — PnL canónico IDCA.
 *
 * PC01. resolveFeePct: executionFeesJson > legacy > default (0.09)
 * PC02. computeCyclePnl: ciclo activo — unrealizedNetPnl descuenta fee salida estimado
 * PC03. computeCyclePnl: ciclo cerrado — realizedNetPnl = realizedPnlUsd directo
 * PC04. computeCyclePnl: trailing_active (partial TP) — proceeds en partialTakeProfitProceedsUsd, pnl=0
 * PC05. getDisplayRealizedPnl: closed → label "Beneficio realizado"
 * PC06. getDisplayRealizedPnl: trailing_active + realized > 0 → label "TP parcial cobrado"
 * PC07. getDisplayRealizedPnl: active → value=0, label=""
 * PC08. computeCyclePnl: fee source correcto para cada escenario
 * PC09. unrealizedNetPnl negativo cuando precio cae
 * PC10. computeCyclePnl: capitalUsed=0 no divide-by-zero
 */

import { describe, it, expect } from "vitest";
import {
  resolveFeePct,
  computeCyclePnl,
  getDisplayRealizedPnl,
  DEFAULT_EXECUTION_FEES,
} from "../institutionalDca/IdcaPnlCalculator";

// ─── PC01 — resolveFeePct ─────────────────────────────────────────────────────

describe("resolveFeePct — prioridad fees", () => {
  it("PC01a. executionFeesJson.takerFeePct=0.09 → source=executionFeesJson", () => {
    const { pct, source } = resolveFeePct({ takerFeePct: 0.09 });
    expect(pct).toBe(0.09);
    expect(source).toBe("executionFeesJson");
  });

  it("PC01b. Sin executionFeesJson, simulationFeePct=0.4 → source=legacy", () => {
    const { pct, source } = resolveFeePct(null, "0.400");
    expect(pct).toBe(0.4);
    expect(source).toBe("legacy");
  });

  it("PC01c. Sin ninguno → default 0.09, source=default", () => {
    const { pct, source } = resolveFeePct(null, undefined);
    expect(pct).toBe(0.09);
    expect(source).toBe("default");
  });

  it("PC01d. executionFeesJson.takerFeePct=0 (maker only) → 0, source=executionFeesJson", () => {
    const { pct, source } = resolveFeePct({ takerFeePct: 0 });
    expect(pct).toBe(0);
    expect(source).toBe("executionFeesJson");
  });
});

// ─── PC02 — unrealizedNetPnl ──────────────────────────────────────────────────

describe("computeCyclePnl — ciclo activo", () => {
  const activeCycle = {
    status: "active",
    capitalUsedUsd: "600",
    totalQuantity: "0.006",
    currentPrice: "105000",  // market value = 630
    realizedPnlUsd: "0",
  };

  it("PC02. unrealizedNetPnl descuenta fee salida estimado", () => {
    const r = computeCyclePnl(activeCycle, { takerFeePct: 0.09 });
    expect(r.currentValueUsd).toBeCloseTo(630, 2);
    expect(r.estimatedExitFeeUsd).toBeCloseTo(630 * 0.0009, 4);
    expect(r.unrealizedNetPnlUsd).toBeCloseTo(630 - 630 * 0.0009 - 600, 2);
    expect(r.realizedNetPnlUsd).toBe(0);
    expect(r.isEstimated).toBe(true);
    expect(r.isPartialTp).toBe(false);
    expect(r.feeSource).toBe("executionFeesJson");
  });

  it("PC09. unrealizedNetPnl negativo cuando precio cae a 95000", () => {
    const cycle = { ...activeCycle, currentPrice: "95000" };
    const r = computeCyclePnl(cycle, { takerFeePct: 0.09 });
    // currentValue = 0.006 * 95000 = 570 < costBasis 600
    expect(r.unrealizedNetPnlUsd).toBeLessThan(0);
  });

  it("PC10. capitalUsed=0 no produce NaN ni división por cero", () => {
    const cycle = { ...activeCycle, capitalUsedUsd: "0" };
    const r = computeCyclePnl(cycle, { takerFeePct: 0.09 });
    expect(Number.isFinite(r.unrealizedNetPnlUsd)).toBe(true);
  });
});

// ─── PC03 — ciclo cerrado ─────────────────────────────────────────────────────

describe("computeCyclePnl — ciclo cerrado", () => {
  it("PC03. realizedNetPnlUsd = realizedPnlUsd (ya almacena profit post-bee8391+)", () => {
    const closed = {
      status: "closed",
      capitalUsedUsd: "600",
      totalQuantity: "0",
      currentPrice: "0",
      realizedPnlUsd: "14.72",  // net profit stored directly
    };
    const r = computeCyclePnl(closed, { takerFeePct: 0.09 });
    expect(r.realizedNetPnlUsd).toBeCloseTo(14.72, 2);
    expect(r.estimatedExitFeeUsd).toBe(0);
    expect(r.isEstimated).toBe(false);
    expect(r.isPartialTp).toBe(false);
  });

  it("PC08a. feeSource=executionFeesJson para closed cycle", () => {
    const closed = { status: "closed", capitalUsedUsd: "100", realizedPnlUsd: "5" };
    const r = computeCyclePnl(closed, { takerFeePct: 0.09 });
    expect(r.feeSource).toBe("executionFeesJson");
  });

  it("PC08b. feeSource=default si sin config", () => {
    const closed = { status: "closed", capitalUsedUsd: "100", realizedPnlUsd: "5" };
    const r = computeCyclePnl(closed);
    expect(r.feeSource).toBe("default");
  });
});

// ─── PC04 — trailing_active (partial TP) ─────────────────────────────────────

describe("computeCyclePnl — partial TP (trailing_active)", () => {
  it("PC04. proceeds en partialTakeProfitProceedsUsd, realizedNetPnlUsd=0", () => {
    const partial = {
      status: "trailing_active",
      capitalUsedUsd: "600",
      totalQuantity: "0.003",
      currentPrice: "100000",
      realizedPnlUsd: "300",  // partial sell proceeds
    };
    const r = computeCyclePnl(partial, { takerFeePct: 0.09 });
    expect(r.isPartialTp).toBe(true);
    expect(r.partialTakeProfitProceedsUsd).toBe(300);
    expect(r.realizedNetPnlUsd).toBe(0);
  });
});

// ─── PC05-PC07 — getDisplayRealizedPnl ────────────────────────────────────────

describe("getDisplayRealizedPnl — etiquetas correctas", () => {
  it("PC05. closed → label Beneficio realizado, valor=profit", () => {
    const d = getDisplayRealizedPnl({ status: "closed", capitalUsedUsd: "600", realizedPnlUsd: "12.5" });
    expect(d.label).toBe("Beneficio realizado");
    expect(d.value).toBeCloseTo(12.5, 2);
    expect(d.isPartial).toBe(false);
  });

  it("PC06. trailing_active + realized>0 → TP parcial cobrado", () => {
    const d = getDisplayRealizedPnl({
      status: "trailing_active",
      capitalUsedUsd: "600",
      realizedPnlUsd: "300",
    });
    expect(d.label).toBe("TP parcial cobrado");
    expect(d.value).toBe(300);
    expect(d.isPartial).toBe(true);
  });

  it("PC07. active → value=0, label=''", () => {
    const d = getDisplayRealizedPnl({ status: "active", capitalUsedUsd: "600", realizedPnlUsd: "0" });
    expect(d.value).toBe(0);
    expect(d.label).toBe("");
    expect(d.isPartial).toBe(false);
  });
});

// ─── DEFAULT_EXECUTION_FEES ───────────────────────────────────────────────────

describe("DEFAULT_EXECUTION_FEES", () => {
  it("DEFAULT es Revolut X 0.09% taker", () => {
    expect(DEFAULT_EXECUTION_FEES.exchange).toBe("revolut_x");
    expect(DEFAULT_EXECUTION_FEES.takerFeePct).toBe(0.09);
    expect(DEFAULT_EXECUTION_FEES.makerFeePct).toBe(0);
    expect(DEFAULT_EXECUTION_FEES.includeExitFeeInNetPnlEstimate).toBe(true);
  });
});
