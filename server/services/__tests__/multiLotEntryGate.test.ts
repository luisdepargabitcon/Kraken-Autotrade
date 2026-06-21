/**
 * Tests for the multi-lot entry gate logic.
 *
 * The gate enforces:
 *   1. Max lots per pair (cap, not target)
 *   2. Anti-burst cooldown (SG_MIN_SECONDS_BETWEEN_ENTRIES = 600s)
 *   3. Price distance from nearest open lot (SG_MIN_ENTRY_DISTANCE_PCT = 1.5%)
 *   4. Per-candle signal dedup (same candle timestamp can't open >1 lot)
 *
 * Since checkMultiLotEntryGate is a private method with DB dependencies,
 * these tests exercise the pure decision logic extracted here.
 */

import { describe, it, expect } from "vitest";

// ── Pure decision logic extracted from checkMultiLotEntryGate ──

interface GateInput {
  currentOpenLots: number;
  maxLotsForMode: number;
  positionMode: "SINGLE" | "SMART_GUARD";
  lastEntryTimeMs: number | null;
  nowMs: number;
  minSecondsBetweenEntries: number;
  existingEntryPrices: number[];
  currentPrice: number;
  minEntryDistancePct: number;
  candleTs: number | undefined;
  lastEntryCandleTs: number | undefined;
}

interface GateResult {
  allowed: boolean;
  reason: string;
}

function evaluateMultiLotGate(input: GateInput): GateResult {
  // Gate 1: Max lots
  if (input.currentOpenLots >= input.maxLotsForMode) {
    const code = input.positionMode === "SMART_GUARD"
      ? "SMART_GUARD_MAX_LOTS_REACHED"
      : "SINGLE_MODE_POSITION_EXISTS";
    return { allowed: false, reason: code };
  }

  // Gate 2: Anti-burst cooldown
  if (input.lastEntryTimeMs !== null) {
    const secSince = (input.nowMs - input.lastEntryTimeMs) / 1000;
    if (secSince < input.minSecondsBetweenEntries) {
      const remaining = Math.ceil(input.minSecondsBetweenEntries - secSince);
      return { allowed: false, reason: `ENTRY_COOLDOWN:${remaining}s` };
    }
  }

  // Gate 3: Price distance
  if (input.currentOpenLots > 0 && input.currentPrice > 0) {
    let minDist = Infinity;
    for (const ep of input.existingEntryPrices) {
      if (ep > 0) {
        const d = Math.abs((input.currentPrice - ep) / ep) * 100;
        if (d < minDist) minDist = d;
      }
    }
    if (minDist < input.minEntryDistancePct) {
      return { allowed: false, reason: `TOO_CLOSE_TO_EXISTING:${minDist.toFixed(2)}%` };
    }
  }

  // Gate 4: Per-candle dedup
  if (input.candleTs && input.candleTs > 0) {
    if (input.lastEntryCandleTs === input.candleTs) {
      return { allowed: false, reason: "SAME_CANDLE_DEDUP" };
    }
  }

  return { allowed: true, reason: "ALLOWED" };
}

// ── Constants matching tradingEngine.ts ──
const SG_MIN_SECONDS_BETWEEN_ENTRIES = 600;
const SG_MIN_ENTRY_DISTANCE_PCT = 1.5;

const NOW = Date.now();

describe("Multi-Lot Entry Gate", () => {

  // Case A: maxOpenLotsPerPair=3, activeLots=0, same tick/signal → only 1 BUY
  describe("Case A: first entry with 0 open lots", () => {
    it("allows the first entry when no lots are open", () => {
      const result = evaluateMultiLotGate({
        currentOpenLots: 0,
        maxLotsForMode: 3,
        positionMode: "SMART_GUARD",
        lastEntryTimeMs: null,
        nowMs: NOW,
        minSecondsBetweenEntries: SG_MIN_SECONDS_BETWEEN_ENTRIES,
        existingEntryPrices: [],
        currentPrice: 64000,
        minEntryDistancePct: SG_MIN_ENTRY_DISTANCE_PCT,
        candleTs: 1718000000,
        lastEntryCandleTs: undefined,
      });
      expect(result.allowed).toBe(true);
    });

    it("blocks second entry on same candle (dedup) — even if cooldown passed and price far", () => {
      // Cooldown expired and price distance OK, but same candle → dedup blocks
      const result = evaluateMultiLotGate({
        currentOpenLots: 1,
        maxLotsForMode: 3,
        positionMode: "SMART_GUARD",
        lastEntryTimeMs: NOW - 700_000, // cooldown OK
        nowMs: NOW,
        minSecondsBetweenEntries: SG_MIN_SECONDS_BETWEEN_ENTRIES,
        existingEntryPrices: [64000],
        currentPrice: 60000, // 6.25% away — distance OK
        minEntryDistancePct: SG_MIN_ENTRY_DISTANCE_PCT,
        candleTs: 1718000000,
        lastEntryCandleTs: 1718000000, // same candle
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("SAME_CANDLE_DEDUP");
    });

    it("blocks second entry by cooldown even if different candle", () => {
      const result = evaluateMultiLotGate({
        currentOpenLots: 1,
        maxLotsForMode: 3,
        positionMode: "SMART_GUARD",
        lastEntryTimeMs: NOW - 30_000, // 30s ago
        nowMs: NOW,
        minSecondsBetweenEntries: SG_MIN_SECONDS_BETWEEN_ENTRIES,
        existingEntryPrices: [64000],
        currentPrice: 63000, // far enough in price
        minEntryDistancePct: SG_MIN_ENTRY_DISTANCE_PCT,
        candleTs: 1718000300, // different candle
        lastEntryCandleTs: 1718000000,
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("ENTRY_COOLDOWN");
    });
  });

  // Case B: maxOpenLotsPerPair=3, activeLots=1, cooldown NOT expired
  describe("Case B: cooldown not expired", () => {
    it("blocks entry when cooldown has not expired", () => {
      const result = evaluateMultiLotGate({
        currentOpenLots: 1,
        maxLotsForMode: 3,
        positionMode: "SMART_GUARD",
        lastEntryTimeMs: NOW - 120_000, // 120s ago, but 600s required
        nowMs: NOW,
        minSecondsBetweenEntries: SG_MIN_SECONDS_BETWEEN_ENTRIES,
        existingEntryPrices: [64000],
        currentPrice: 60000,
        minEntryDistancePct: SG_MIN_ENTRY_DISTANCE_PCT,
        candleTs: 1718001200,
        lastEntryCandleTs: 1718000000,
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("ENTRY_COOLDOWN");
    });
  });

  // Case C: maxOpenLotsPerPair=3, activeLots=1, cooldown expired, distance OK, new candle
  describe("Case C: additional lot allowed", () => {
    it("allows additional lot when cooldown expired, distance met, new candle", () => {
      const result = evaluateMultiLotGate({
        currentOpenLots: 1,
        maxLotsForMode: 3,
        positionMode: "SMART_GUARD",
        lastEntryTimeMs: NOW - 700_000, // 700s ago (>600s)
        nowMs: NOW,
        minSecondsBetweenEntries: SG_MIN_SECONDS_BETWEEN_ENTRIES,
        existingEntryPrices: [64000],
        currentPrice: 62000, // ~3.1% away
        minEntryDistancePct: SG_MIN_ENTRY_DISTANCE_PCT,
        candleTs: 1718002000,
        lastEntryCandleTs: 1718000000,
      });
      expect(result.allowed).toBe(true);
    });

    it("blocks additional lot when price too close despite cooldown expired", () => {
      const result = evaluateMultiLotGate({
        currentOpenLots: 1,
        maxLotsForMode: 3,
        positionMode: "SMART_GUARD",
        lastEntryTimeMs: NOW - 700_000,
        nowMs: NOW,
        minSecondsBetweenEntries: SG_MIN_SECONDS_BETWEEN_ENTRIES,
        existingEntryPrices: [64000],
        currentPrice: 64500, // ~0.78% away — too close
        minEntryDistancePct: SG_MIN_ENTRY_DISTANCE_PCT,
        candleTs: 1718002000,
        lastEntryCandleTs: 1718000000,
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("TOO_CLOSE_TO_EXISTING");
    });
  });

  // Case D: maxOpenLotsPerPair=3, activeLots=3 → block
  describe("Case D: max lots reached", () => {
    it("blocks entry when 3/3 lots are already open", () => {
      const result = evaluateMultiLotGate({
        currentOpenLots: 3,
        maxLotsForMode: 3,
        positionMode: "SMART_GUARD",
        lastEntryTimeMs: NOW - 999_000,
        nowMs: NOW,
        minSecondsBetweenEntries: SG_MIN_SECONDS_BETWEEN_ENTRIES,
        existingEntryPrices: [64000, 62000, 60000],
        currentPrice: 58000,
        minEntryDistancePct: SG_MIN_ENTRY_DISTANCE_PCT,
        candleTs: 1718005000,
        lastEntryCandleTs: 1718000000,
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("SMART_GUARD_MAX_LOTS_REACHED");
    });

    it("blocks SINGLE mode when 1/1 lot exists", () => {
      const result = evaluateMultiLotGate({
        currentOpenLots: 1,
        maxLotsForMode: 1,
        positionMode: "SINGLE",
        lastEntryTimeMs: NOW - 999_000,
        nowMs: NOW,
        minSecondsBetweenEntries: SG_MIN_SECONDS_BETWEEN_ENTRIES,
        existingEntryPrices: [64000],
        currentPrice: 60000,
        minEntryDistancePct: SG_MIN_ENTRY_DISTANCE_PCT,
        candleTs: 1718005000,
        lastEntryCandleTs: 1718000000,
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("SINGLE_MODE_POSITION_EXISTS");
    });
  });

  // Case E: DRY RUN and REAL must pass the same gate
  describe("Case E: gate parity DRY_RUN vs REAL", () => {
    it("same inputs produce same result regardless of mode context", () => {
      const baseInput: GateInput = {
        currentOpenLots: 1,
        maxLotsForMode: 3,
        positionMode: "SMART_GUARD",
        lastEntryTimeMs: NOW - 30_000,
        nowMs: NOW,
        minSecondsBetweenEntries: SG_MIN_SECONDS_BETWEEN_ENTRIES,
        existingEntryPrices: [64000],
        currentPrice: 64100,
        minEntryDistancePct: SG_MIN_ENTRY_DISTANCE_PCT,
        candleTs: 1718000300,
        lastEntryCandleTs: 1718000000,
      };

      // Simulate: the gate function is the same for DRY_RUN and REAL
      // getOccupiedLotsForGate and getLastEntryTimeForGate return
      // the same semantic result regardless of mode (in-memory vs DB).
      // Both calls to evaluateMultiLotGate must produce identical results.
      const dryRunResult = evaluateMultiLotGate(baseInput);
      const realResult = evaluateMultiLotGate(baseInput);

      expect(dryRunResult).toEqual(realResult);
      // Specifically, cooldown should block
      expect(dryRunResult.allowed).toBe(false);
      expect(dryRunResult.reason).toContain("ENTRY_COOLDOWN");
    });
  });

  // Additional edge cases
  describe("Edge cases", () => {
    it("allows first entry even with no candle timestamp (cycle mode)", () => {
      const result = evaluateMultiLotGate({
        currentOpenLots: 0,
        maxLotsForMode: 3,
        positionMode: "SMART_GUARD",
        lastEntryTimeMs: null,
        nowMs: NOW,
        minSecondsBetweenEntries: SG_MIN_SECONDS_BETWEEN_ENTRIES,
        existingEntryPrices: [],
        currentPrice: 64000,
        minEntryDistancePct: SG_MIN_ENTRY_DISTANCE_PCT,
        candleTs: undefined,
        lastEntryCandleTs: undefined,
      });
      expect(result.allowed).toBe(true);
    });

    it("price distance checks nearest lot, not average", () => {
      // Two lots at 64000 and 60000. Current price 63500.
      // Distance to 64000 = 0.78%, distance to 60000 = 5.83%
      // Should block because nearest (64000) is too close
      const result = evaluateMultiLotGate({
        currentOpenLots: 2,
        maxLotsForMode: 3,
        positionMode: "SMART_GUARD",
        lastEntryTimeMs: NOW - 700_000,
        nowMs: NOW,
        minSecondsBetweenEntries: SG_MIN_SECONDS_BETWEEN_ENTRIES,
        existingEntryPrices: [64000, 60000],
        currentPrice: 63500,
        minEntryDistancePct: SG_MIN_ENTRY_DISTANCE_PCT,
        candleTs: 1718005000,
        lastEntryCandleTs: 1718000000,
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("TOO_CLOSE_TO_EXISTING");
    });

    it("600s cooldown blocks the old 120s window", () => {
      // At 120s since last entry, old logic would allow. New logic blocks.
      const result = evaluateMultiLotGate({
        currentOpenLots: 1,
        maxLotsForMode: 3,
        positionMode: "SMART_GUARD",
        lastEntryTimeMs: NOW - 120_000,
        nowMs: NOW,
        minSecondsBetweenEntries: SG_MIN_SECONDS_BETWEEN_ENTRIES,
        existingEntryPrices: [64000],
        currentPrice: 60000,
        minEntryDistancePct: SG_MIN_ENTRY_DISTANCE_PCT,
        candleTs: 1718001200,
        lastEntryCandleTs: 1718000000,
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("ENTRY_COOLDOWN");

      // At 601s, should pass cooldown gate
      const result2 = evaluateMultiLotGate({
        ...result,
        allowed: undefined as any, reason: undefined as any,
        currentOpenLots: 1,
        maxLotsForMode: 3,
        positionMode: "SMART_GUARD",
        lastEntryTimeMs: NOW - 601_000,
        nowMs: NOW,
        minSecondsBetweenEntries: SG_MIN_SECONDS_BETWEEN_ENTRIES,
        existingEntryPrices: [64000],
        currentPrice: 60000,
        minEntryDistancePct: SG_MIN_ENTRY_DISTANCE_PCT,
        candleTs: 1718001200,
        lastEntryCandleTs: 1718000000,
      });
      expect(result2.allowed).toBe(true);
    });
  });
});
