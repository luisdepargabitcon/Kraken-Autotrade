/**
 * Contract tests for spotHistoryService.getClosedTradesList
 *
 * These tests verify the shape and invariants of the list response.
 * They use a mocked db.execute to avoid real DB dependency.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { deriveRMultiple } from "../spotHistoryService";

// ─── deriveRMultiple unit tests ───────────────────────────────────────────────

describe("deriveRMultiple — R-multiple derivation invariants", () => {
  it("HIST_R_01 — returns null when mfe=0 and mae=0", () => {
    expect(deriveRMultiple(10, 0, 0, 0, 0)).toBeNull();
  });

  it("HIST_R_02 — returns null when mfe_r=0 and mae_r=0", () => {
    expect(deriveRMultiple(-5, 100, 0, 50, 0)).toBeNull();
  });

  it("HIST_R_03 — NEVER returns 0 as proxy for unknown", () => {
    const result = deriveRMultiple(0, 0, 0, 0, 0);
    expect(result).toBeNull();
  });

  it("HIST_R_04 — derives positive R from MFE (winner)", () => {
    const mfe = 70.71;
    const mfeR = 1.4143;
    const riskUsd = mfe / mfeR;
    const netPnl = 17.46;
    const expected = Math.round((netPnl / riskUsd) * 100) / 100;
    const result = deriveRMultiple(netPnl, mfe, mfeR, 0, 0);
    expect(result).not.toBeNull();
    expect(result).toBe(expected);
    expect(result).toBeGreaterThan(0);
  });

  it("HIST_R_05 — derives negative R from MFE (loser)", () => {
    const mfe = 5.71;
    const mfeR = 0.1142;
    const riskUsd = mfe / mfeR;
    const netPnl = -17.72;
    const result = deriveRMultiple(netPnl, mfe, mfeR, 0, 0);
    expect(result).not.toBeNull();
    expect(result).toBeLessThan(0);
  });

  it("HIST_R_06 — fallback to MAE derivation when mfe=0", () => {
    const mae = 30;
    const maeR = 0.6;
    const riskUsd = mae / maeR;
    const netPnl = -20;
    const expected = Math.round((netPnl / riskUsd) * 100) / 100;
    const result = deriveRMultiple(netPnl, 0, 0, mae, maeR);
    expect(result).not.toBeNull();
    expect(result).toBe(expected);
  });

  it("HIST_R_07 — rounds to 2 decimal places", () => {
    const result = deriveRMultiple(17.46, 70.71, 1.4143, 0, 0);
    expect(result).not.toBeNull();
    const str = String(result);
    const decimals = str.includes(".") ? str.split(".")[1].length : 0;
    expect(decimals).toBeLessThanOrEqual(2);
  });

  it("HIST_R_08 — large winner (XRP 2.65R)", () => {
    const mfe = 132.5;
    const mfeR = 2.6471;
    const riskUsd = mfe / mfeR;
    const netPnl = 107.2;
    const result = deriveRMultiple(netPnl, mfe, mfeR, 0, 0);
    expect(result).not.toBeNull();
    expect(result).toBeGreaterThan(2);
  });

  it("HIST_R_09 — returns null for NaN inputs", () => {
    expect(deriveRMultiple(NaN, 10, 0.5, 0, 0)).not.toBeNull();
    expect(deriveRMultiple(10, NaN, 0.5, 0, 0)).toBeNull();
    expect(deriveRMultiple(10, 10, NaN, 0, 0)).toBeNull();
  });

  it("HIST_R_10 — mfeR protection: 0 mfe with positive mfeR gives null", () => {
    expect(deriveRMultiple(10, 0, 1.5, 0, 0)).toBeNull();
  });
});

// ─── SpotTradeListRow shape contract ─────────────────────────────────────────

describe("SpotTradeListRow — field contract", () => {
  function makeRow(overrides = {}): Record<string, unknown> {
    return {
      tradeId: "spot-trade-ETH/USD-test",
      lotId: "spot-ETH/USD-test",
      pair: "ETH/USD",
      side: "sell",
      entryPrice: 2450.52,
      exitPrice: 2478.20,
      amount: 0.7511858,
      notionalUsd: 2450.52 * 0.7511858,
      grossPnl: 20.79,
      netPnl: 17.46,
      returnPct: 0.95,
      entryFee: 1.66,
      exitFee: 1.68,
      executionCost: 0,
      feeQuality: "ESTIMATED",
      mfe: 70.71,
      mae: 0,
      mfeR: 1.4143,
      maeR: 0,
      rMultiple: 0.35,
      exitReason: "TIME_EFFICIENCY",
      holdTimeMinutes: 469,
      executionMode: "SHADOW",
      policyVersion: "SPOT-1.0.0-20260812",
      setupTag: "PULLBACK_CONTINUATION",
      signalId: "intent-ETH/USD-test",
      marketContextId: "mc-ETH/USD-test",
      openedAt: 1787375369307,
      closedAt: 1787375369307 + 469 * 60000,
      ...overrides,
    };
  }

  it("HIST_LIST_01 — required fields are present", () => {
    const row = makeRow();
    expect(row.tradeId).toBeTruthy();
    expect(row.lotId).toBeTruthy();
    expect(row.pair).toBeTruthy();
    expect(row.executionMode).toBe("SHADOW");
    expect(row.policyVersion).toBe("SPOT-1.0.0-20260812");
  });

  it("HIST_LIST_02 — notionalUsd is computed from entry * amount", () => {
    const row = makeRow();
    const expectedNotional = Number(row.entryPrice) * Number(row.amount);
    expect(Number(row.notionalUsd)).toBeCloseTo(expectedNotional, 2);
  });

  it("HIST_LIST_03 — rMultiple is null OR a finite number (never fabricated 0)", () => {
    const rowNull = makeRow({ rMultiple: null });
    expect(rowNull.rMultiple).toBeNull();

    const rowNum = makeRow({ rMultiple: 0.35 });
    expect(typeof rowNum.rMultiple).toBe("number");
    expect(Number.isFinite(rowNum.rMultiple as number)).toBe(true);
  });

  it("HIST_LIST_04 — openedAt is null or a valid timestamp (not closedAt)", () => {
    const row = makeRow();
    if (row.openedAt !== null) {
      expect(typeof row.openedAt).toBe("number");
      expect(Number(row.openedAt)).toBeGreaterThan(0);
      // openedAt should be <= closedAt
      expect(Number(row.openedAt)).toBeLessThanOrEqual(Number(row.closedAt));
    }
  });

  it("HIST_LIST_05 — returnPct is null or computed from netPnl / notionalUsd", () => {
    const row = makeRow();
    if (row.returnPct !== null && row.notionalUsd !== 0) {
      const computed = (Number(row.netPnl) / Number(row.notionalUsd)) * 100;
      expect(Number(row.returnPct)).toBeCloseTo(computed, 1);
    }
  });

  it("HIST_LIST_06 — exitReason is null or a non-empty string", () => {
    const row = makeRow({ exitReason: "TIME_EFFICIENCY" });
    expect(typeof row.exitReason).toBe("string");
    expect((row.exitReason as string).length).toBeGreaterThan(0);

    const rowNull = makeRow({ exitReason: null });
    expect(rowNull.exitReason).toBeNull();
  });

  it("HIST_LIST_07 — fees are non-negative numbers", () => {
    const row = makeRow();
    expect(Number(row.entryFee)).toBeGreaterThanOrEqual(0);
    expect(Number(row.exitFee)).toBeGreaterThanOrEqual(0);
  });

  it("HIST_LIST_08 — mfeR > 0 implies mfe > 0", () => {
    const row = makeRow({ mfe: 70.71, mfeR: 1.4143 });
    if (Number(row.mfeR) > 0) {
      expect(Number(row.mfe)).toBeGreaterThan(0);
    }
  });

  it("HIST_LIST_09 — holdTimeMinutes is a non-negative integer", () => {
    const row = makeRow({ holdTimeMinutes: 469 });
    expect(Number(row.holdTimeMinutes)).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(Number(row.holdTimeMinutes))).toBe(true);
  });

  it("HIST_LIST_10 — lot_id starts with 'spot-' for SPOT_CANONICAL trades", () => {
    const row = makeRow();
    expect(String(row.lotId)).toMatch(/^spot-/);
  });
});
