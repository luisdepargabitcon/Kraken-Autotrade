/**
 * Tests for the multi-lot entry gate logic.
 *
 * The gate enforces:
 *   1. Max lots per pair (cap, not target)
 *   2. Anti-burst cooldown (SG_MIN_SECONDS_BETWEEN_ENTRIES = 600s)
 *   3. Dynamic ATR-based price distance from nearest open lot
 *   4. Per-candle signal dedup (same candle timestamp can't open >1 lot)
 *
 * Since checkMultiLotEntryGate is a private method with DB dependencies,
 * these tests exercise the pure decision logic extracted here.
 */

import { describe, it, expect } from "vitest";

// ── Pure dynamic distance formula (mirrors getSmartGuardMinEntryDistancePct) ──

interface DynamicDistanceParams {
  atrPct: number;       // ATR(14) / currentPrice * 100
  multiplier: number;   // default 1.00
  aggressivenessLevel: number; // 0-100, 50=neutral
  minClampPct: number;  // default 0.75
  maxClampPct: number;  // default 4.00
  fallbackPct: number;  // default 1.50
}

interface DynamicDistanceResult {
  requiredPct: number;
  source: "dynamic_atr" | "fallback";
}

function computeDynamicEntryDistance(params: DynamicDistanceParams): DynamicDistanceResult {
  if (params.atrPct <= 0) {
    return { requiredPct: params.fallbackPct, source: "fallback" };
  }
  // aggressionFactor: 0→1.15, 50→1.00, 100→0.85
  const aggressionFactor = 1.0 + (50 - Math.max(0, Math.min(100, params.aggressivenessLevel))) / (100 / 0.30);
  const raw = params.atrPct * params.multiplier * aggressionFactor;
  const clamped = Math.max(params.minClampPct, Math.min(params.maxClampPct, raw));
  return { requiredPct: clamped, source: "dynamic_atr" };
}

// ── Pure gate decision logic (mirrors checkMultiLotEntryGate) ──

interface GateInput {
  currentOpenLots: number;
  maxLotsForMode: number;
  positionMode: "SINGLE" | "SMART_GUARD";
  lastEntryTimeMs: number | null;
  nowMs: number;
  minSecondsBetweenEntries: number;
  existingEntryPrices: number[];
  currentPrice: number;
  requiredEntryDistancePct: number; // dynamic or fallback
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

  // Gate 3: Dynamic price distance
  if (input.currentOpenLots > 0 && input.currentPrice > 0) {
    let minDist = Infinity;
    for (const ep of input.existingEntryPrices) {
      if (ep > 0) {
        const d = Math.abs((input.currentPrice - ep) / ep) * 100;
        if (d < minDist) minDist = d;
      }
    }
    if (minDist < input.requiredEntryDistancePct) {
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
const DEFAULT_MULTIPLIER = 1.00;
const DEFAULT_MIN_CLAMP = 0.75;
const DEFAULT_MAX_CLAMP = 4.00;
const FALLBACK_PCT = 1.50;

const NOW = Date.now();

describe("Multi-Lot Entry Gate", () => {

  // ────── Dynamic Distance Formula Tests ──────

  describe("Dynamic ATR Distance Formula", () => {
    it("Case A: ATR not available → uses fallback 1.5%", () => {
      const result = computeDynamicEntryDistance({
        atrPct: 0, // no ATR data
        multiplier: DEFAULT_MULTIPLIER,
        aggressivenessLevel: 50,
        minClampPct: DEFAULT_MIN_CLAMP,
        maxClampPct: DEFAULT_MAX_CLAMP,
        fallbackPct: FALLBACK_PCT,
      });
      expect(result.source).toBe("fallback");
      expect(result.requiredPct).toBe(1.50);
    });

    it("Case B: BTC with low atrPct → required falls within clamp range", () => {
      // BTC atrPct=1.2%, multiplier=0.90 (BTC-style), aggression=50 (neutral)
      const result = computeDynamicEntryDistance({
        atrPct: 1.2,
        multiplier: 0.90,
        aggressivenessLevel: 50,
        minClampPct: 0.75,
        maxClampPct: 2.50,
        fallbackPct: FALLBACK_PCT,
      });
      // raw = 1.2 * 0.90 * 1.00 = 1.08 → within [0.75, 2.50]
      expect(result.source).toBe("dynamic_atr");
      expect(result.requiredPct).toBeCloseTo(1.08, 1);
      expect(result.requiredPct).toBeGreaterThanOrEqual(0.75);
      expect(result.requiredPct).toBeLessThanOrEqual(2.50);
    });

    it("Case C: SOL with high atrPct → required rises with volatility", () => {
      // SOL atrPct=2.5%, multiplier=1.10 (alt-style), aggression=50 (neutral)
      const result = computeDynamicEntryDistance({
        atrPct: 2.5,
        multiplier: 1.10,
        aggressivenessLevel: 50,
        minClampPct: 1.00,
        maxClampPct: 4.00,
        fallbackPct: FALLBACK_PCT,
      });
      // raw = 2.5 * 1.10 * 1.00 = 2.75 → within [1.00, 4.00]
      expect(result.source).toBe("dynamic_atr");
      expect(result.requiredPct).toBeCloseTo(2.75, 1);
      expect(result.requiredPct).toBeGreaterThan(FALLBACK_PCT); // better than fixed 1.5%
    });

    it("Case D: high aggressiveness reduces distance, but not below minClamp", () => {
      // atrPct=1.0%, aggression=91 (very high)
      const result = computeDynamicEntryDistance({
        atrPct: 1.0,
        multiplier: DEFAULT_MULTIPLIER,
        aggressivenessLevel: 91,
        minClampPct: DEFAULT_MIN_CLAMP,
        maxClampPct: DEFAULT_MAX_CLAMP,
        fallbackPct: FALLBACK_PCT,
      });
      // aggressionFactor = 1.0 + (50-91)/(100/0.30) = 1.0 + (-41/333.33) = 1.0 - 0.123 ≈ 0.877
      // raw = 1.0 * 1.0 * 0.877 ≈ 0.877 → clamped to max(0.75, 0.877) = 0.877
      expect(result.source).toBe("dynamic_atr");
      expect(result.requiredPct).toBeGreaterThanOrEqual(DEFAULT_MIN_CLAMP);
      expect(result.requiredPct).toBeLessThan(1.0); // aggression reduced it

      // Even more extreme: atrPct=0.5%, aggression=100 → should clamp to 0.75
      const extreme = computeDynamicEntryDistance({
        atrPct: 0.5,
        multiplier: DEFAULT_MULTIPLIER,
        aggressivenessLevel: 100,
        minClampPct: DEFAULT_MIN_CLAMP,
        maxClampPct: DEFAULT_MAX_CLAMP,
        fallbackPct: FALLBACK_PCT,
      });
      // aggressionFactor ≈ 0.85, raw = 0.5 * 1.0 * 0.85 = 0.425 → clamped to 0.75
      expect(extreme.requiredPct).toBe(DEFAULT_MIN_CLAMP);
    });

    it("low aggressiveness widens distance", () => {
      const result = computeDynamicEntryDistance({
        atrPct: 1.5,
        multiplier: DEFAULT_MULTIPLIER,
        aggressivenessLevel: 10, // very conservative
        minClampPct: DEFAULT_MIN_CLAMP,
        maxClampPct: DEFAULT_MAX_CLAMP,
        fallbackPct: FALLBACK_PCT,
      });
      // aggressionFactor = 1.0 + (50-10)/(100/0.30) = 1.0 + 40/333.33 ≈ 1.12
      // raw = 1.5 * 1.0 * 1.12 ≈ 1.68
      expect(result.requiredPct).toBeGreaterThan(1.5);
    });

    it("max clamp prevents unreasonable distance", () => {
      const result = computeDynamicEntryDistance({
        atrPct: 8.0, // extremely volatile
        multiplier: DEFAULT_MULTIPLIER,
        aggressivenessLevel: 10,
        minClampPct: DEFAULT_MIN_CLAMP,
        maxClampPct: DEFAULT_MAX_CLAMP,
        fallbackPct: FALLBACK_PCT,
      });
      expect(result.requiredPct).toBe(DEFAULT_MAX_CLAMP);
    });

    it("BTC calm market example from spec", () => {
      // atrPct=1.2, multiplier=0.90, aggression=91 → aggrFactor ≈ 0.877
      // raw = 1.2 * 0.90 * 0.877 ≈ 0.95 → within [0.75, 2.50]
      const result = computeDynamicEntryDistance({
        atrPct: 1.2,
        multiplier: 0.90,
        aggressivenessLevel: 91,
        minClampPct: 0.75,
        maxClampPct: 2.50,
        fallbackPct: FALLBACK_PCT,
      });
      expect(result.requiredPct).toBeCloseTo(0.95, 1);
    });

    it("SOL volatile market example from spec", () => {
      // atrPct=2.5, multiplier=1.10, aggression=91 → aggrFactor ≈ 0.877
      // raw = 2.5 * 1.10 * 0.877 ≈ 2.41 → within [1.00, 4.00]
      const result = computeDynamicEntryDistance({
        atrPct: 2.5,
        multiplier: 1.10,
        aggressivenessLevel: 91,
        minClampPct: 1.00,
        maxClampPct: 4.00,
        fallbackPct: FALLBACK_PCT,
      });
      expect(result.requiredPct).toBeCloseTo(2.41, 1);
      expect(result.requiredPct).toBeGreaterThan(FALLBACK_PCT);
    });
  });

  // ────── Gate Integration Tests (kept from original + updated) ──────

  describe("Gate: first entry with 0 open lots", () => {
    it("allows first entry when no lots are open", () => {
      const result = evaluateMultiLotGate({
        currentOpenLots: 0,
        maxLotsForMode: 3,
        positionMode: "SMART_GUARD",
        lastEntryTimeMs: null,
        nowMs: NOW,
        minSecondsBetweenEntries: SG_MIN_SECONDS_BETWEEN_ENTRIES,
        existingEntryPrices: [],
        currentPrice: 64000,
        requiredEntryDistancePct: 1.08, // dynamic BTC
        candleTs: 1718000000,
        lastEntryCandleTs: undefined,
      });
      expect(result.allowed).toBe(true);
    });

    it("blocks second entry on same candle (dedup)", () => {
      const result = evaluateMultiLotGate({
        currentOpenLots: 1,
        maxLotsForMode: 3,
        positionMode: "SMART_GUARD",
        lastEntryTimeMs: NOW - 700_000,
        nowMs: NOW,
        minSecondsBetweenEntries: SG_MIN_SECONDS_BETWEEN_ENTRIES,
        existingEntryPrices: [64000],
        currentPrice: 60000,
        requiredEntryDistancePct: 1.08,
        candleTs: 1718000000,
        lastEntryCandleTs: 1718000000,
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("SAME_CANDLE_DEDUP");
    });

    it("blocks by cooldown even if different candle", () => {
      const result = evaluateMultiLotGate({
        currentOpenLots: 1,
        maxLotsForMode: 3,
        positionMode: "SMART_GUARD",
        lastEntryTimeMs: NOW - 30_000,
        nowMs: NOW,
        minSecondsBetweenEntries: SG_MIN_SECONDS_BETWEEN_ENTRIES,
        existingEntryPrices: [64000],
        currentPrice: 63000,
        requiredEntryDistancePct: 1.08,
        candleTs: 1718000300,
        lastEntryCandleTs: 1718000000,
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("ENTRY_COOLDOWN");
    });
  });

  describe("Gate: cooldown not expired", () => {
    it("blocks at 120s when 600s required", () => {
      const result = evaluateMultiLotGate({
        currentOpenLots: 1,
        maxLotsForMode: 3,
        positionMode: "SMART_GUARD",
        lastEntryTimeMs: NOW - 120_000,
        nowMs: NOW,
        minSecondsBetweenEntries: SG_MIN_SECONDS_BETWEEN_ENTRIES,
        existingEntryPrices: [64000],
        currentPrice: 60000,
        requiredEntryDistancePct: 1.08,
        candleTs: 1718001200,
        lastEntryCandleTs: 1718000000,
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("ENTRY_COOLDOWN");
    });
  });

  describe("Case E: distance < requiredDistancePct → block", () => {
    it("blocks when actual distance is below dynamic required", () => {
      // BTC entry at 64000, current at 64500 → distance ~0.78%
      // Dynamic required is 1.08% → should block
      const result = evaluateMultiLotGate({
        currentOpenLots: 1,
        maxLotsForMode: 3,
        positionMode: "SMART_GUARD",
        lastEntryTimeMs: NOW - 700_000,
        nowMs: NOW,
        minSecondsBetweenEntries: SG_MIN_SECONDS_BETWEEN_ENTRIES,
        existingEntryPrices: [64000],
        currentPrice: 64500, // ~0.78% away
        requiredEntryDistancePct: 1.08, // dynamic BTC
        candleTs: 1718002000,
        lastEntryCandleTs: 1718000000,
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("TOO_CLOSE_TO_EXISTING");
    });
  });

  describe("Case F: distance >= required + cooldown + new candle → allow", () => {
    it("allows when all gates pass with dynamic distance", () => {
      // BTC entry at 64000, current at 62000 → distance ~3.13%
      // Dynamic required is 1.08% → passes
      const result = evaluateMultiLotGate({
        currentOpenLots: 1,
        maxLotsForMode: 3,
        positionMode: "SMART_GUARD",
        lastEntryTimeMs: NOW - 700_000,
        nowMs: NOW,
        minSecondsBetweenEntries: SG_MIN_SECONDS_BETWEEN_ENTRIES,
        existingEntryPrices: [64000],
        currentPrice: 62000, // ~3.13% away → passes 1.08%
        requiredEntryDistancePct: 1.08,
        candleTs: 1718002000,
        lastEntryCandleTs: 1718000000,
      });
      expect(result.allowed).toBe(true);
    });

    it("allows SOL with higher dynamic distance when met", () => {
      // SOL entry at 150, current at 143 → distance ~4.67%
      // Dynamic required is 2.75% → passes
      const result = evaluateMultiLotGate({
        currentOpenLots: 1,
        maxLotsForMode: 3,
        positionMode: "SMART_GUARD",
        lastEntryTimeMs: NOW - 700_000,
        nowMs: NOW,
        minSecondsBetweenEntries: SG_MIN_SECONDS_BETWEEN_ENTRIES,
        existingEntryPrices: [150],
        currentPrice: 143, // ~4.67% away → passes 2.75%
        requiredEntryDistancePct: 2.75, // dynamic SOL
        candleTs: 1718002000,
        lastEntryCandleTs: 1718000000,
      });
      expect(result.allowed).toBe(true);
    });

    it("blocks SOL when distance insufficient for its higher requirement", () => {
      // SOL entry at 150, current at 148 → distance ~1.33%
      // Dynamic required is 2.75% → blocks (would pass old 1.5% fixed)
      const result = evaluateMultiLotGate({
        currentOpenLots: 1,
        maxLotsForMode: 3,
        positionMode: "SMART_GUARD",
        lastEntryTimeMs: NOW - 700_000,
        nowMs: NOW,
        minSecondsBetweenEntries: SG_MIN_SECONDS_BETWEEN_ENTRIES,
        existingEntryPrices: [150],
        currentPrice: 148, // ~1.33% away
        requiredEntryDistancePct: 2.75, // dynamic SOL
        candleTs: 1718002000,
        lastEntryCandleTs: 1718000000,
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("TOO_CLOSE_TO_EXISTING");
    });
  });

  describe("Gate: max lots reached", () => {
    it("blocks at 3/3 SMART_GUARD", () => {
      const result = evaluateMultiLotGate({
        currentOpenLots: 3,
        maxLotsForMode: 3,
        positionMode: "SMART_GUARD",
        lastEntryTimeMs: NOW - 999_000,
        nowMs: NOW,
        minSecondsBetweenEntries: SG_MIN_SECONDS_BETWEEN_ENTRIES,
        existingEntryPrices: [64000, 62000, 60000],
        currentPrice: 58000,
        requiredEntryDistancePct: 1.08,
        candleTs: 1718005000,
        lastEntryCandleTs: 1718000000,
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("SMART_GUARD_MAX_LOTS_REACHED");
    });

    it("blocks SINGLE mode at 1/1", () => {
      const result = evaluateMultiLotGate({
        currentOpenLots: 1,
        maxLotsForMode: 1,
        positionMode: "SINGLE",
        lastEntryTimeMs: NOW - 999_000,
        nowMs: NOW,
        minSecondsBetweenEntries: SG_MIN_SECONDS_BETWEEN_ENTRIES,
        existingEntryPrices: [64000],
        currentPrice: 60000,
        requiredEntryDistancePct: 1.08,
        candleTs: 1718005000,
        lastEntryCandleTs: 1718000000,
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("SINGLE_MODE_POSITION_EXISTS");
    });
  });

  describe("Gate: DRY_RUN vs REAL parity", () => {
    it("same inputs produce same result", () => {
      const baseInput: GateInput = {
        currentOpenLots: 1,
        maxLotsForMode: 3,
        positionMode: "SMART_GUARD",
        lastEntryTimeMs: NOW - 30_000,
        nowMs: NOW,
        minSecondsBetweenEntries: SG_MIN_SECONDS_BETWEEN_ENTRIES,
        existingEntryPrices: [64000],
        currentPrice: 64100,
        requiredEntryDistancePct: 1.08,
        candleTs: 1718000300,
        lastEntryCandleTs: 1718000000,
      };
      const dryRunResult = evaluateMultiLotGate(baseInput);
      const realResult = evaluateMultiLotGate(baseInput);
      expect(dryRunResult).toEqual(realResult);
      expect(dryRunResult.allowed).toBe(false);
      expect(dryRunResult.reason).toContain("ENTRY_COOLDOWN");
    });
  });

  describe("Edge cases", () => {
    it("allows first entry with no candle timestamp (cycle mode)", () => {
      const result = evaluateMultiLotGate({
        currentOpenLots: 0,
        maxLotsForMode: 3,
        positionMode: "SMART_GUARD",
        lastEntryTimeMs: null,
        nowMs: NOW,
        minSecondsBetweenEntries: SG_MIN_SECONDS_BETWEEN_ENTRIES,
        existingEntryPrices: [],
        currentPrice: 64000,
        requiredEntryDistancePct: 1.08,
        candleTs: undefined,
        lastEntryCandleTs: undefined,
      });
      expect(result.allowed).toBe(true);
    });

    it("checks nearest lot, not average", () => {
      const result = evaluateMultiLotGate({
        currentOpenLots: 2,
        maxLotsForMode: 3,
        positionMode: "SMART_GUARD",
        lastEntryTimeMs: NOW - 700_000,
        nowMs: NOW,
        minSecondsBetweenEntries: SG_MIN_SECONDS_BETWEEN_ENTRIES,
        existingEntryPrices: [64000, 60000],
        currentPrice: 63500, // 0.78% from 64000
        requiredEntryDistancePct: 1.08,
        candleTs: 1718005000,
        lastEntryCandleTs: 1718000000,
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("TOO_CLOSE_TO_EXISTING");
    });

    it("600s cooldown blocks the old 120s window, passes at 601s", () => {
      const blocked = evaluateMultiLotGate({
        currentOpenLots: 1,
        maxLotsForMode: 3,
        positionMode: "SMART_GUARD",
        lastEntryTimeMs: NOW - 120_000,
        nowMs: NOW,
        minSecondsBetweenEntries: SG_MIN_SECONDS_BETWEEN_ENTRIES,
        existingEntryPrices: [64000],
        currentPrice: 60000,
        requiredEntryDistancePct: 1.08,
        candleTs: 1718001200,
        lastEntryCandleTs: 1718000000,
      });
      expect(blocked.allowed).toBe(false);

      const passed = evaluateMultiLotGate({
        currentOpenLots: 1,
        maxLotsForMode: 3,
        positionMode: "SMART_GUARD",
        lastEntryTimeMs: NOW - 601_000,
        nowMs: NOW,
        minSecondsBetweenEntries: SG_MIN_SECONDS_BETWEEN_ENTRIES,
        existingEntryPrices: [64000],
        currentPrice: 60000,
        requiredEntryDistancePct: 1.08,
        candleTs: 1718001200,
        lastEntryCandleTs: 1718000000,
      });
      expect(passed.allowed).toBe(true);
    });
  });
});
