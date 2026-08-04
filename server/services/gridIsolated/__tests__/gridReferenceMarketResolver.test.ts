/**
 * gridReferenceMarketResolver.test.ts — REV-C12E
 * Tests for the Kraken reference market resolver.
 * Pure logic — no DB, no network.
 */

import { describe, it, expect } from "vitest";
import { resolveGridReferenceMarketSnapshot } from "../gridReferenceMarketResolver";
import type { MarketTickerSnapshot } from "../../MarketDataService";

function validSnapshot(pair: string = "BTC/USD"): MarketTickerSnapshot {
  return {
    pair,
    ticker: { bid: 94990, ask: 95010, last: 95000 },
    marketDataVenue: "KRAKEN",
    source: "KRAKEN_MARKET_DATA",
    fetchedAt: new Date(),
    ageMs: 0,
    maxAgeMs: 45000,
    fresh: true,
    cached: false,
  };
}

describe("GridReferenceMarketResolver — REV-C12E", () => {
  const now = new Date();

  // ─── 9. pair correcto aceptado ──────────────────────────────────────
  it("accepts valid snapshot with correct pair", () => {
    const result = resolveGridReferenceMarketSnapshot(validSnapshot(), "BTC/USD", now);
    expect(result.verifiedForPlanning).toBe(true);
    expect(result.pair).toBe("BTC/USD");
    expect(result.bid).toBe(94990);
    expect(result.ask).toBe(95010);
    expect(result.last).toBe(95000);
  });

  // ─── 10. pair mismatch bloqueado ────────────────────────────────────
  it("blocks pair mismatch", () => {
    const result = resolveGridReferenceMarketSnapshot(validSnapshot("ETH/USD"), "BTC/USD", now);
    expect(result.verifiedForPlanning).toBe(false);
    expect(result.reasonCode).toBe("REFERENCE_MARKET_PAIR_MISMATCH");
  });

  // ─── 11. bid <= 0 bloqueado ─────────────────────────────────────────
  it("blocks bid <= 0", () => {
    const snap = validSnapshot();
    snap.ticker.bid = 0;
    const result = resolveGridReferenceMarketSnapshot(snap, "BTC/USD", now);
    expect(result.verifiedForPlanning).toBe(false);
    expect(result.reasonCode).toBe("REFERENCE_MARKET_BID_INVALID");
  });

  // ─── 12. ask <= bid bloqueado ───────────────────────────────────────
  it("blocks ask <= bid", () => {
    const snap = validSnapshot();
    snap.ticker.ask = 94990;
    const result = resolveGridReferenceMarketSnapshot(snap, "BTC/USD", now);
    expect(result.verifiedForPlanning).toBe(false);
    expect(result.reasonCode).toBe("REFERENCE_MARKET_ASK_INVALID");
  });

  // ─── 13. last <= 0 bloqueado ────────────────────────────────────────
  it("blocks last <= 0", () => {
    const snap = validSnapshot();
    snap.ticker.last = 0;
    const result = resolveGridReferenceMarketSnapshot(snap, "BTC/USD", now);
    expect(result.verifiedForPlanning).toBe(false);
    expect(result.reasonCode).toBe("REFERENCE_MARKET_LAST_INVALID");
  });

  // ─── 14. timestamp inválido bloqueado ───────────────────────────────
  it("blocks invalid timestamp (stale)", () => {
    const snap = validSnapshot();
    snap.fresh = false;
    const result = resolveGridReferenceMarketSnapshot(snap, "BTC/USD", now);
    expect(result.verifiedForPlanning).toBe(false);
    expect(result.reasonCode).toBe("REFERENCE_MARKET_STALE");
  });

  // ─── 15. stale bloqueado ────────────────────────────────────────────
  it("blocks stale snapshot", () => {
    const snap = validSnapshot();
    snap.fresh = false;
    snap.ageMs = 120000;
    const result = resolveGridReferenceMarketSnapshot(snap, "BTC/USD", now);
    expect(result.verifiedForPlanning).toBe(false);
    expect(result.reasonCode).toBe("REFERENCE_MARKET_STALE");
  });

  // ─── 16. source=KRAKEN_MARKET_DATA ──────────────────────────────────
  it("verified snapshot has source=KRAKEN_MARKET_DATA", () => {
    const result = resolveGridReferenceMarketSnapshot(validSnapshot(), "BTC/USD", now);
    expect(result.source).toBe("KRAKEN_MARKET_DATA");
  });

  // ─── 17. marketDataVenue=KRAKEN ─────────────────────────────────────
  it("verified snapshot has marketDataVenue=KRAKEN", () => {
    const result = resolveGridReferenceMarketSnapshot(validSnapshot(), "BTC/USD", now);
    expect(result.marketDataVenue).toBe("KRAKEN");
  });

  // ─── 18. executionVenue=REVOLUT_X ───────────────────────────────────
  it("verified snapshot has executionVenue=REVOLUT_X", () => {
    const result = resolveGridReferenceMarketSnapshot(validSnapshot(), "BTC/USD", now);
    expect(result.executionVenue).toBe("REVOLUT_X");
  });

  // ─── 19. authoritativeForVenueCrossing=false ────────────────────────
  it("verified snapshot has authoritativeForVenueCrossing=false", () => {
    const result = resolveGridReferenceMarketSnapshot(validSnapshot(), "BTC/USD", now);
    expect(result.authoritativeForVenueCrossing).toBe(false);
  });

  // ─── null snapshot ──────────────────────────────────────────────────
  it("null snapshot → REFERENCE_MARKET_UNAVAILABLE", () => {
    const result = resolveGridReferenceMarketSnapshot(null, "BTC/USD", now);
    expect(result.verifiedForPlanning).toBe(false);
    expect(result.reasonCode).toBe("REFERENCE_MARKET_UNAVAILABLE");
  });

  // ─── source invalid ─────────────────────────────────────────────────
  it("invalid source → REFERENCE_MARKET_SOURCE_INVALID", () => {
    const snap = validSnapshot();
    snap.source = "SOMETHING_ELSE" as any;
    const result = resolveGridReferenceMarketSnapshot(snap, "BTC/USD", now);
    expect(result.verifiedForPlanning).toBe(false);
    expect(result.reasonCode).toBe("REFERENCE_MARKET_SOURCE_INVALID");
  });

  // ─── marketDataVenue not KRAKEN ─────────────────────────────────────
  it("marketDataVenue not KRAKEN → REFERENCE_MARKET_SOURCE_INVALID", () => {
    const snap = validSnapshot();
    snap.marketDataVenue = "BINANCE" as any;
    const result = resolveGridReferenceMarketSnapshot(snap, "BTC/USD", now);
    expect(result.verifiedForPlanning).toBe(false);
    expect(result.reasonCode).toBe("REFERENCE_MARKET_SOURCE_INVALID");
  });

  // ─── spread calculation ─────────────────────────────────────────────
  it("calculates spread correctly", () => {
    const result = resolveGridReferenceMarketSnapshot(validSnapshot(), "BTC/USD", now);
    expect(result.spreadUsd).toBe(20);
    expect(result.spreadPct).toBeCloseTo(20 / 94990 * 100, 5);
  });
});
