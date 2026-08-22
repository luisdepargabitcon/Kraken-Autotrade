import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { getOpenPositions, getClosedTrades } from "../spot/spotEngine";

function extractSql(query: any): { sql: string; params: any[] } {
  if (typeof query === "string") return { sql: query, params: [] };
  if (query?.sql) return { sql: query.sql, params: [] };
  if (query?.queryChunks) {
    const params: any[] = [];
    const walk = (chunks: any[]): string => chunks.map((chunk: any) => {
      if (chunk !== null && typeof chunk === "object" && chunk.value !== undefined) {
        return Array.isArray(chunk.value) ? chunk.value.join("") : chunk.value;
      }
      if (chunk !== null && typeof chunk === "object" && Array.isArray(chunk.queryChunks)) {
        return walk(chunk.queryChunks);
      }
      params.push(chunk);
      return "?";
    }).join("");
    const sqlText = walk(query.queryChunks);
    return { sql: sqlText, params };
  }
  return { sql: String(query), params: [] };
}

const mockDbState: {
  openPositions: any[];
  trades: any[];
} = {
  openPositions: [],
  trades: [],
};

vi.mock("../../db", () => ({
  db: {
    execute: vi.fn(async (query: any) => {
      const { sql: sqlText } = extractSql(query);

      if (sqlText.includes("FROM open_positions") && sqlText.includes("SELECT")) {
        return { rows: mockDbState.openPositions };
      }
      if (sqlText.includes("FROM trades") && sqlText.includes("SELECT")) {
        return { rows: mockDbState.trades };
      }
      if (sqlText.includes("COUNT")) {
        return { rows: [{ count: 0 }] };
      }
      return { rows: [] };
    }),
  },
}));

describe("SPOT API contract — positions and history", () => {
  beforeEach(() => {
    mockDbState.openPositions = [];
    mockDbState.trades = [];
    vi.clearAllMocks();
  });

  it("SPOT_POSITIONS_CONTRACT — returns canonical camelCase with finite notionalUsd", async () => {
    mockDbState.openPositions = [
      {
        lot_id: "spot-ETH/USD-abc123",
        pair: "ETH/USD",
        amount: "0.75",
        qty_remaining: "0.75",
        entry_price: "2450.52",
        execution_mode: "SHADOW",
        filled_notional_usd: "1837.89",
        mfe: "12.34",
        mae: "0.00",
        mfe_r: "0.05",
        opened_at_ms: Date.now() - 100000,
        setup_tag: "EMA20_BREAKOUT",
      },
    ];

    const positions = await getOpenPositions();
    expect(positions).toHaveLength(1);
    const p = positions[0];
    expect(p.lotId).toBe("spot-ETH/USD-abc123");
    expect(p.pair).toBe("ETH/USD");
    expect(Number.isFinite(p.entryPrice)).toBe(true);
    expect(Number.isFinite(p.qtyRemaining)).toBe(true);
    expect(Number.isFinite(p.notionalUsd)).toBe(true);
    expect(p.notionalUsd).toBe(1837.89);
    expect(p.filledNotionalUsd).toBe(1837.89);
    expect(p.executionMode).toBe("SHADOW");
    expect(p.setupTag).toBe("EMA20_BREAKOUT");
  });

  it("SPOT_POSITIONS_CONTRACT — notionalUsd falls back to entryPrice * amount when filled_notional_usd is null", async () => {
    mockDbState.openPositions = [
      {
        lot_id: "spot-ETH/USD-fallback",
        pair: "ETH/USD",
        amount: "0.5",
        qty_remaining: "0.5",
        entry_price: "2000.00",
        execution_mode: "SHADOW",
        filled_notional_usd: null,
        mfe: "0",
        mae: "0",
        mfe_r: "0",
        opened_at_ms: Date.now() - 100000,
        setup_tag: null,
      },
    ];

    const positions = await getOpenPositions();
    const p = positions[0];
    expect(p.notionalUsd).toBe(1000);
    expect(p.filledNotionalUsd).toBe(null);
  });

  it("SPOT_HISTORY_CONTRACT — returns camelCase numeric fields from DB row", async () => {
    mockDbState.trades = [
      {
        trade_id: "trade-1",
        lot_id: "lot-1",
        pair: "ETH/USD",
        type: "sell",
        price: "2314.17",
        entry_price: "2332.70",
        amount: "0.92",
        gross_pnl_usd: "-17.10",
        entry_fee_usd: "0.50",
        exit_fee_usd: "0.60",
        net_pnl_usd: "-20.96",
        exit_reason_type: "STRUCTURE_INVALIDATION",
        created_at: new Date(Date.now() - 1000000).toISOString(),
        executed_at: new Date(Date.now() - 900000).toISOString(),
        hold_time_minutes: 41,
        execution_mode: "SHADOW",
        r_multiple: "-0.75",
      },
    ];

    const trades = await getClosedTrades(10);
    expect(trades).toHaveLength(1);
    const t = trades[0];
    expect(t.tradeId).toBe("trade-1");
    expect(t.lotId).toBe("lot-1");
    expect(t.pair).toBe("ETH/USD");
    expect(t.side).toBe("sell");
    expect(Number.isFinite(t.entryPrice)).toBe(true);
    expect(t.entryPrice).toBe(2332.7);
    expect(Number.isFinite(t.exitPrice)).toBe(true);
    expect(Number.isFinite(t.netPnl)).toBe(true);
    expect(t.netPnl).toBe(-20.96);
    expect(Number.isFinite(t.grossPnl)).toBe(true);
    expect(Number.isFinite(t.entryFee)).toBe(true);
    expect(Number.isFinite(t.exitFee)).toBe(true);
    expect(Number.isFinite(t.amount)).toBe(true);
    expect(Number.isFinite(t.openedAt)).toBe(true);
    expect(Number.isFinite(t.closedAt)).toBe(true);
    expect(Number.isFinite(t.rMultiple)).toBe(true);
    expect(t.holdTimeMinutes).toBe(41);
    expect(t.exitReason).toBe("STRUCTURE_INVALIDATION");
    expect(t.executionMode).toBe("SHADOW");
  });
});
