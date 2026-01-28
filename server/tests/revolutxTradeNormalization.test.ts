import { describe, expect, it } from "vitest";
import { normalizeRevolutXTrade } from "../utils/revolutxTradeNormalization";

describe("normalizeRevolutXTrade", () => {
  it("uses explicit side field when present", () => {
    const t = {
      id: "T1",
      created_at: "2026-01-28T16:14:00Z",
      price: "2986.04",
      amount_base: "0.19002405",
      side: "SELL",
    };

    const n = normalizeRevolutXTrade(t, false);
    expect(n.type).toBe("sell");
    expect(String(n.amount)).toBe("0.19002405");
    expect(n.assumed).toBe(false);
    expect(n.sideSource).toBe("side_field");
  });

  it("derives SELL from negative amount_base when side is missing", () => {
    const t = {
      id: "T2",
      created_at: "2026-01-28T16:14:00Z",
      price: "2986.04",
      amount_base: "-0.19002405",
    };

    const n = normalizeRevolutXTrade(t, false);
    expect(n.type).toBe("sell");
    expect(Number(n.amount)).toBeCloseTo(0.19002405, 10);
    expect(n.assumed).toBe(false);
    expect(n.sideSource).toBe("amount_base_sign");
  });

  it("derives SELL from positive amount_quote when side and amount_base are missing", () => {
    const t = {
      id: "T3",
      created_at: "2026-01-28T16:14:00Z",
      price: "2986.04",
      amount_quote: "566.90",
      quantity: "0.19002405",
    };

    const n = normalizeRevolutXTrade(t, false);
    expect(n.type).toBe("sell");
    expect(Number(n.amount)).toBeCloseTo(0.19002405, 10);
    expect(n.assumed).toBe(false);
    expect(n.sideSource).toBe("amount_quote_sign");
  });

  it("does not default to BUY when only positive quantity is available and allowAssumedSide is false", () => {
    const t = {
      id: "T4",
      created_at: "2026-01-28T16:14:00Z",
      price: "2986.04",
      quantity: "0.19002405",
    };

    const n = normalizeRevolutXTrade(t, false);
    expect(n.type).toBe(null);
    expect(n.assumed).toBe(false);
  });

  it("allows assumed BUY when only positive quantity is available and allowAssumedSide is true", () => {
    const t = {
      id: "T5",
      created_at: "2026-01-28T16:14:00Z",
      price: "2986.04",
      quantity: "0.19002405",
    };

    const n = normalizeRevolutXTrade(t, true);
    expect(n.type).toBe("buy");
    expect(n.assumed).toBe(true);
    expect(n.sideSource).toBe("assumed_positive_quantity");
  });
});
