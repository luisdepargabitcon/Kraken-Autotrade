/**
 * Tests FISCO V2 — Criterio AEAT/Bit2Me de comisiones + Motor FIFO V2 independiente
 */
import { describe, it, expect } from "vitest";
import { normalizeToV2Events, detectFeeDoubleCount } from "../FiscoV2Normalizer";
import { runFifoV2, summarizeV2Result, buildFeeTreatmentSummary } from "../FiscoV2EngineService";
import type { V2Event, FeeTreatment } from "../FiscoV2Types";

// Helper: create a DB-like operation
function makeOp(overrides: Partial<any> = {}): any {
  return {
    id: 1,
    exchange: "kraken",
    external_id: "TX-001",
    op_type: "trade_buy",
    asset: "BTC",
    amount: "0.01",
    price_eur: "10000",
    total_eur: "100",
    fee_eur: "1",
    counter_asset: "EUR",
    pair: "XXBTZEUR",
    executed_at: new Date("2025-01-15T10:00:00Z"),
    raw_data: {},
    ...overrides,
  };
}

// ============================================================
// 1. Fee Treatment AEAT/Bit2Me
// ============================================================

describe("FISCO V2 — Criterio AEAT/Bit2Me de comisiones", () => {
  // Test 1: Compra 100€ + fee 1€ → acquisition_value = 101
  it("COMPRA: fee integrada en adquisición, acquisition_value = gross + fee", () => {
    const ops = [makeOp({ id: 1, op_type: "trade_buy", total_eur: "100", fee_eur: "1" })];
    const events = normalizeToV2Events(ops, "AEAT_INTEGRATED_TRACEABLE");
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe("BUY");
    expect(events[0].fee_treatment).toBe("integrated_in_acquisition");
    expect(events[0].gross_value_eur).toBe(100);
    expect(events[0].direct_fee_eur).toBe(1);
    expect(events[0].fiscal_value_eur).toBe(101);
  });

  // Test 2: Venta 100€ + fee 1€ → transmission_value = 99
  it("VENTA: fee integrada en transmisión, transmission_value = gross - fee", () => {
    const ops = [makeOp({ id: 1, op_type: "trade_sell", total_eur: "100", fee_eur: "1" })];
    const events = normalizeToV2Events(ops, "AEAT_INTEGRATED_TRACEABLE");
    expect(events[0].event_type).toBe("SELL");
    expect(events[0].fee_treatment).toBe("integrated_in_transmission");
    expect(events[0].gross_value_eur).toBe(100);
    expect(events[0].direct_fee_eur).toBe(1);
    expect(events[0].fiscal_value_eur).toBe(99);
  });

  // Test 3: Comisión en columna informativa, no duplica
  it("COMPRA: fee aparece como direct_fee_eur pero NO se resta de fiscal_value", () => {
    const ops = [makeOp({ id: 1, op_type: "trade_buy", total_eur: "100", fee_eur: "1" })];
    const events = normalizeToV2Events(ops, "AEAT_INTEGRATED_TRACEABLE");
    // fiscal_value = 101 (gross + fee), NOT 99 (gross - fee)
    expect(events[0].fiscal_value_eur).toBe(101);
    // direct_fee_eur is tracked separately for informational column
    expect(events[0].direct_fee_eur).toBe(1);
  });

  // Test 4: Withdrawal fee → inventory_reduction
  it("WITHDRAWAL: fee treatment = inventory_reduction", () => {
    const ops = [makeOp({ id: 1, op_type: "withdrawal", total_eur: null, fee_eur: "0.5", price_eur: null })];
    const events = normalizeToV2Events(ops, "AEAT_INTEGRATED_TRACEABLE");
    expect(events[0].event_type).toBe("WITHDRAWAL");
    expect(events[0].fee_treatment).toBe("inventory_reduction");
  });

  // Test 5: Fee sin precio → blocker
  it("FEE sin precio EUR: needs_manual_review = true", () => {
    const ops = [makeOp({ id: 1, op_type: "trade_buy", asset: "BTC", total_eur: null, price_eur: null, fee_eur: "0" })];
    const events = normalizeToV2Events(ops, "AEAT_INTEGRATED_TRACEABLE");
    expect(events[0].needs_manual_review).toBe(true);
    expect(events[0].blockers).toContain("REQUIRES_EUR_PRICE");
  });

  // Test 6: Doble cómputo detectado
  it("Doble cómputo: detectFeeDoubleCount detecta fees duplicadas", () => {
    const events: V2Event[] = [
      {
        event_id: "EVT-1",
        source_operation_id: 1,
        exchange: "kraken",
        event_type: "BUY",
        asset: "BTC",
        quantity: 0.01,
        counter_asset: "EUR",
        gross_value_eur: 100,
        direct_fee_eur: 1,
        fee_asset: null,
        fee_quantity: 0,
        fee_treatment: "integrated_in_acquisition",
        fiscal_value_eur: 101,
        executed_at: new Date("2025-01-15"),
        external_id: "TX-1",
        pair: "XXBTZEUR",
        needs_manual_review: false,
        blockers: [],
        transfer_link_id: null,
      },
      {
        event_id: "EVT-1-COUNTER",
        source_operation_id: 1,
        exchange: "kraken",
        event_type: "SELL",
        asset: "ETH",
        quantity: 0.1,
        counter_asset: "BTC",
        gross_value_eur: 100,
        direct_fee_eur: 1,
        fee_asset: null,
        fee_quantity: 0,
        fee_treatment: "integrated_in_transmission",
        fiscal_value_eur: 99,
        executed_at: new Date("2025-01-15"),
        external_id: "TX-1-COUNTER",
        pair: "XETHXXBT",
        needs_manual_review: false,
        blockers: [],
        transfer_link_id: null,
      },
    ];
    const blockers = detectFeeDoubleCount(events);
    expect(blockers.length).toBeGreaterThan(0);
    expect(blockers[0]).toContain("FEE_DOUBLE_COUNT_RISK");
  });
});

// ============================================================
// 2. Motor FIFO V2
// ============================================================

describe("FISCO V2 — Motor FIFO V2 independiente", () => {
  // Test: FIFO V2 crea lotes correctamente
  it("FIFO V2 crea lotes para compras", () => {
    const ops = [
      makeOp({ id: 1, op_type: "trade_buy", asset: "BTC", amount: "0.1", total_eur: "1000", fee_eur: "5", price_eur: "10000" }),
    ];
    const events = normalizeToV2Events(ops, "AEAT_INTEGRATED_TRACEABLE");
    const result = runFifoV2(events);
    expect(result.lots).toHaveLength(1);
    expect(result.lots[0].asset).toBe("BTC");
    expect(result.lots[0].quantity_acquired).toBe(0.1);
    expect(result.lots[0].acquisition_value_eur).toBe(1005); // 1000 + 5 fee
    expect(result.lots[0].gross_acquisition_eur).toBe(1000);
    expect(result.lots[0].direct_fee_eur).toBe(5);
  });

  // Test: FIFO V2 consume lotes en venta
  it("FIFO V2 consume lotes en venta y calcula ganancia/pérdida", () => {
    const ops = [
      makeOp({ id: 1, op_type: "trade_buy", asset: "BTC", amount: "0.1", total_eur: "1000", fee_eur: "5", price_eur: "10000", executed_at: new Date("2025-01-15") }),
      makeOp({ id: 2, op_type: "trade_sell", asset: "BTC", amount: "0.05", total_eur: "600", fee_eur: "3", price_eur: "12000", executed_at: new Date("2025-02-15") }),
    ];
    const events = normalizeToV2Events(ops, "AEAT_INTEGRATED_TRACEABLE");
    const result = runFifoV2(events);
    expect(result.lots).toHaveLength(1);
    expect(result.lots[0].quantity_remaining).toBeCloseTo(0.05, 8);
    expect(result.disposals).toHaveLength(1);
    // transmission_value = 600 - 3 = 597, cost_basis = 1005 * 0.5 = 502.5
    // gain = 597 - 502.5 = 94.5
    expect(result.disposals[0].transmission_value_eur).toBeCloseTo(597, 2);
    expect(result.disposals[0].cost_basis_eur).toBeCloseTo(502.5, 2);
    expect(result.disposals[0].gain_loss_eur).toBeCloseTo(94.5, 2);
  });

  // Test: Venta sin lote → blocker
  it("FIFO V2: venta sin lote genera blocker SELL_WITHOUT_LOTS", () => {
    const ops = [
      makeOp({ id: 1, op_type: "trade_sell", asset: "BTC", amount: "0.1", total_eur: "600", fee_eur: "3", price_eur: "6000", executed_at: new Date("2025-02-15") }),
    ];
    const events = normalizeToV2Events(ops, "AEAT_INTEGRATED_TRACEABLE");
    const result = runFifoV2(events, { blockIfSellWithoutCostBasis: true });
    expect(result.blockers.some(b => b.code === "SELL_WITHOUT_LOTS")).toBe(true);
    expect(result.is_safe_for_official).toBe(false);
  });

  // Test: Inventario negativo → blocker
  it("FIFO V2: inventario negativo genera blocker", () => {
    const ops = [
      makeOp({ id: 1, op_type: "trade_buy", asset: "BTC", amount: "0.1", total_eur: "1000", fee_eur: "0", price_eur: "10000", executed_at: new Date("2025-01-15") }),
      makeOp({ id: 2, op_type: "trade_sell", asset: "BTC", amount: "0.2", total_eur: "1200", fee_eur: "0", price_eur: "6000", executed_at: new Date("2025-02-15") }),
    ];
    const events = normalizeToV2Events(ops, "AEAT_INTEGRATED_TRACEABLE");
    const result = runFifoV2(events, { blockIfSellWithoutCostBasis: true });
    expect(result.blockers.some(b => b.code === "UNKNOWN_BASIS" || b.code === "NEGATIVE_INVENTORY")).toBe(true);
  });

  // Test: Conversion crypto/crypto genera SELL + BUY
  it("FIFO V2: conversion crypto/crypto genera SELL y BUY", () => {
    const ops = [
      makeOp({ id: 1, op_type: "trade_buy", asset: "BTC", amount: "0.1", total_eur: "1000", fee_eur: "0", price_eur: "10000", executed_at: new Date("2025-01-15") }),
      makeOp({ id: 2, op_type: "conversion", asset: "BTC", amount: "0.05", total_eur: "500", fee_eur: "0", price_eur: "10000", counter_asset: "ETH", pair: "XETHXXBT", executed_at: new Date("2025-02-15") }),
    ];
    const events = normalizeToV2Events(ops, "AEAT_INTEGRATED_TRACEABLE");
    // Should have 3 events: BUY BTC, SELL BTC (conversion), BUY ETH (counter)
    expect(events.length).toBeGreaterThanOrEqual(3);
    const result = runFifoV2(events);
    expect(result.disposals.length).toBeGreaterThan(0);
    // Should have a lot for ETH (counter side)
    expect(result.lots.some(l => l.asset === "ETH")).toBe(true);
  });

  // Test: Transferencia interna no genera ganancia/pérdida
  it("FIFO V2: withdrawal no genera disposición", () => {
    const ops = [
      makeOp({ id: 1, op_type: "trade_buy", asset: "BTC", amount: "0.1", total_eur: "1000", fee_eur: "0", price_eur: "10000", executed_at: new Date("2025-01-15") }),
      makeOp({ id: 2, op_type: "withdrawal", asset: "BTC", amount: "0.05", total_eur: null, fee_eur: "0", price_eur: null, executed_at: new Date("2025-02-15") }),
    ];
    const events = normalizeToV2Events(ops, "AEAT_INTEGRATED_TRACEABLE");
    const result = runFifoV2(events);
    // Withdrawal should NOT create a disposal
    expect(result.disposals.filter(d => d.asset === "BTC" && d.sell_operation_id === 2)).toHaveLength(0);
  });

  // Test: Reward sin precio → blocker si config lo exige
  it("FIFO V2: reward sin precio genera blocker REWARD_PRICE_MISSING", () => {
    const ops = [
      makeOp({ id: 1, op_type: "staking", asset: "BTC", amount: "0.001", total_eur: null, fee_eur: "0", price_eur: null, executed_at: new Date("2025-03-15") }),
    ];
    const events = normalizeToV2Events(ops, "AEAT_INTEGRATED_TRACEABLE");
    const result = runFifoV2(events, { blockIfRewardWithoutPrice: true });
    expect(result.blockers.some(b => b.code === "REWARD_PRICE_MISSING")).toBe(true);
  });

  // Test: Reward con precio registra lote
  it("FIFO V2: reward con precio crea lote correctamente", () => {
    const ops = [
      makeOp({ id: 1, op_type: "staking", asset: "BTC", amount: "0.001", total_eur: "50", fee_eur: "0", price_eur: "50000", executed_at: new Date("2025-03-15") }),
    ];
    const events = normalizeToV2Events(ops, "AEAT_INTEGRATED_TRACEABLE");
    const result = runFifoV2(events);
    expect(result.lots).toHaveLength(1);
    expect(result.lots[0].asset).toBe("BTC");
    expect(result.lots[0].acquisition_value_eur).toBe(50);
    expect(result.reward_events).toHaveLength(1);
  });

  // Test: Fee treatment summary
  it("buildFeeTreatmentSummary: resume comisiones por tratamiento", () => {
    const ops = [
      makeOp({ id: 1, op_type: "trade_buy", asset: "BTC", amount: "0.1", total_eur: "1000", fee_eur: "5", price_eur: "10000" }),
      makeOp({ id: 2, op_type: "trade_sell", asset: "BTC", amount: "0.05", total_eur: "600", fee_eur: "3", price_eur: "12000", executed_at: new Date("2025-02-15") }),
    ];
    const events = normalizeToV2Events(ops, "AEAT_INTEGRATED_TRACEABLE");
    const result = runFifoV2(events);
    const summary = buildFeeTreatmentSummary(result);
    expect(summary.integrated_in_acquisition.count).toBe(1);
    expect(summary.integrated_in_acquisition.total_eur).toBe(5);
    expect(summary.integrated_in_transmission.count).toBe(1);
    expect(summary.integrated_in_transmission.total_eur).toBe(3);
  });

  // Test: summarizeV2Result
  it("summarizeV2Result: calcula gains, losses, net correctamente", () => {
    const ops = [
      makeOp({ id: 1, op_type: "trade_buy", asset: "BTC", amount: "0.1", total_eur: "1000", fee_eur: "0", price_eur: "10000" }),
      makeOp({ id: 2, op_type: "trade_sell", asset: "BTC", amount: "0.05", total_eur: "600", fee_eur: "0", price_eur: "12000", executed_at: new Date("2025-02-15") }),
    ];
    const events = normalizeToV2Events(ops, "AEAT_INTEGRATED_TRACEABLE");
    const result = runFifoV2(events);
    const summary = summarizeV2Result(result);
    expect(summary.disposals_count).toBe(1);
    expect(summary.gains_eur).toBeGreaterThan(0);
    expect(summary.net_gain_loss_eur).toBeGreaterThan(0);
  });

  // Test: Determinismo — mismo input = mismo output
  it("FIFO V2: determinista (mismo input = mismo output)", () => {
    const ops = [
      makeOp({ id: 1, op_type: "trade_buy", asset: "BTC", amount: "0.1", total_eur: "1000", fee_eur: "5", price_eur: "10000", executed_at: new Date("2025-01-15") }),
      makeOp({ id: 2, op_type: "trade_sell", asset: "BTC", amount: "0.05", total_eur: "600", fee_eur: "3", price_eur: "12000", executed_at: new Date("2025-02-15") }),
    ];
    const events1 = normalizeToV2Events(ops, "AEAT_INTEGRATED_TRACEABLE");
    const events2 = normalizeToV2Events(ops, "AEAT_INTEGRATED_TRACEABLE");
    const result1 = runFifoV2(events1);
    const result2 = runFifoV2(events2);
    expect(result1.lots.length).toBe(result2.lots.length);
    expect(result1.disposals.length).toBe(result2.disposals.length);
    expect(result1.disposals[0].gain_loss_eur).toBeCloseTo(result2.disposals[0].gain_loss_eur, 10);
  });
});
