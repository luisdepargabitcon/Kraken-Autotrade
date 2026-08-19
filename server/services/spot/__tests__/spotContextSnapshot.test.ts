/**
 * spotContextSnapshot.test.ts — Tests for SPOT context snapshot builder.
 *
 * Tests:
 *   - Snapshot structure correctness
 *   - Decision explanation for BUY signal
 *   - Decision explanation for NONE signal with various block reasons
 *   - Gate breakdown correctness
 *   - Error handling for invalid pair
 *   - Multi-pair snapshot with error resilience
 *   - Read-only: no side effects on engine state
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("../../../db", () => ({
  db: {
    execute: vi.fn(),
  },
}));

vi.mock("drizzle-orm", () => ({
  sql: (strings: TemplateStringsArray) => strings.join(""),
}));

vi.mock("../spotMarketContext", () => ({
  buildSpotMarketContext: vi.fn(),
}));

vi.mock("../spotCanonicalStrategy", () => ({
  evaluateSpotCanonical: vi.fn(),
  evaluate4hMacro: vi.fn(),
  evaluate1hRegime: vi.fn(),
}));

vi.mock("../spotEntryIntent", () => ({
  evaluateEntryIntent: vi.fn(),
}));

vi.mock("../spotRiskManager", () => ({
  evaluateSizing: vi.fn(),
  DEFAULT_SPOT_RISK_CONFIG: {},
}));

vi.mock("../spotRegimeEngine", () => ({
  isEntryAllowedByRegime: vi.fn(),
}));

vi.mock("../spotEngine", () => ({
  getIntentStore: vi.fn(() => ({
    get: vi.fn(() => null),
  })),
}));

import { buildSpotContextSnapshot, buildSpotContextSnapshots } from "../spotContextSnapshot";
import { buildSpotMarketContext } from "../spotMarketContext";
import { evaluateSpotCanonical, evaluate4hMacro, evaluate1hRegime } from "../spotCanonicalStrategy";
import { DataHealth } from "../candleTimestamp";
import { Regime, RegimeDirection, MacroBias, VolatilityLevel } from "../spotTypes";

// ─── Helpers ────────────────────────────────────────────────────────────────

function mockCtx(pair: string = "BTC/USD") {
  return {
    marketContextId: `mc-${pair}-test`,
    generatedAt: Date.now(),
    pair,
    dataHealth: DataHealth.GOOD,
    macroBias: MacroBias.BULLISH,
    regimeContext: {
      regimeId: `reg-${pair}-test`,
      regime: Regime.TREND,
      direction: RegimeDirection.BULLISH,
      volatility: VolatilityLevel.NORMAL,
      macroBias: MacroBias.BULLISH,
      adx: 35,
      ema20: 100,
      ema50: 98,
      ema200: 90,
      emaAlignment: 1,
      bollingerWidth: 2.5,
      atrPct: 1.8,
      confidence: 0.8,
    },
    candles5m: [],
    candles15m: [],
    candles1h: [],
    candles4h: [],
    ticker: { bid: 99.5, ask: 100.5, last: 100, spread: 1, fetchedAt: Date.now() },
    spreadPct: 0.5,
    atr: 2,
    volumeMetrics: { volumeRatio: 1.2, volume24h: 50000, participation: "NORMAL" as const },
  };
}

function mockSignal(signal: "BUY" | "NONE" = "NONE", blockReason: string | null = "BLOCKED") {
  return {
    signal,
    setupTag: signal === "BUY" ? "PULLBACK_CONTINUATION" as any : null,
    reason: signal === "BUY" ? "SPOT_CANONICAL BUY" : "Blocked",
    confidence: signal === "BUY" ? 0.75 : 0,
    originPrice: 100,
    origin15mCloseAt: Date.now(),
    originAtrPct: 1.5,
    originVolume: 1.2,
    contextId: "mc-test",
    blockReason,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("spotContextSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should produce a snapshot with correct structure", async () => {
    const ctx = mockCtx();
    (buildSpotMarketContext as any).mockResolvedValue(ctx);
    (evaluateSpotCanonical as any).mockReturnValue(mockSignal("NONE", "BLOCKED"));
    (evaluate4hMacro as any).mockReturnValue({ pass: true, reason: "Macro bullish" });
    (evaluate1hRegime as any).mockReturnValue({ pass: true, reason: "Trend bullish" });

    const snap = await buildSpotContextSnapshot("BTC/USD");

    expect(snap.pair).toBe("BTC/USD");
    expect(snap.dataHealth).toBe("GOOD");
    expect(snap.macroBias).toBe("BULLISH");
    expect(snap.regime).toBe("TREND");
    expect(snap.direction).toBe("BULLISH");
    expect(snap.price).toBe(100);
    expect(snap.signal).toBe("NONE");
    expect(snap.gates).toBeDefined();
    expect(snap.gates.length).toBeGreaterThan(0);
    expect(snap.decisionTitle).toBeDefined();
    expect(snap.decisionExplanation).toBeDefined();
    expect(snap.decisionColor).toBeDefined();
    expect(snap.marketContextId).toBe("mc-BTC/USD-test");
  });

  it("should show BUY decision when signal is BUY", async () => {
    const ctx = mockCtx();
    (buildSpotMarketContext as any).mockResolvedValue(ctx);
    (evaluateSpotCanonical as any).mockReturnValue(mockSignal("BUY", null));
    (evaluate4hMacro as any).mockReturnValue({ pass: true, reason: "Macro bullish" });
    (evaluate1hRegime as any).mockReturnValue({ pass: true, reason: "Trend bullish" });

    const snap = await buildSpotContextSnapshot("BTC/USD");

    expect(snap.signal).toBe("BUY");
    expect(snap.setupTag).toBe("PULLBACK_CONTINUATION");
    expect(snap.signalConfidence).toBe(0.75);
    expect(snap.decisionColor).toBe("green");
  });

  it("should show red decision when data health is stale", async () => {
    const ctx = mockCtx();
    ctx.dataHealth = DataHealth.STALE;
    (buildSpotMarketContext as any).mockResolvedValue(ctx);
    (evaluateSpotCanonical as any).mockReturnValue(mockSignal("NONE", "DATA_STALE"));
    (evaluate4hMacro as any).mockReturnValue({ pass: false, reason: "Macro fail" });
    (evaluate1hRegime as any).mockReturnValue({ pass: false, reason: "Regime fail" });

    const snap = await buildSpotContextSnapshot("BTC/USD");

    expect(snap.decisionColor).toBe("red");
    expect(snap.decisionTitle).toContain("Datos");
  });

  it("should show red decision when macro is bearish", async () => {
    const ctx = mockCtx();
    ctx.regimeContext.macroBias = MacroBias.BEARISH;
    (buildSpotMarketContext as any).mockResolvedValue(ctx);
    (evaluateSpotCanonical as any).mockReturnValue(mockSignal("NONE", "Macro bearish"));
    (evaluate4hMacro as any).mockReturnValue({ pass: false, reason: "Macro 4h bearish" });
    (evaluate1hRegime as any).mockReturnValue({ pass: false, reason: "Regime fail" });

    const snap = await buildSpotContextSnapshot("BTC/USD");

    expect(snap.decisionColor).toBe("red");
    expect(snap.decisionTitle).toContain("Macro");
  });

  it("should include gate breakdown with pass/fail status", async () => {
    const ctx = mockCtx();
    (buildSpotMarketContext as any).mockResolvedValue(ctx);
    (evaluateSpotCanonical as any).mockReturnValue(mockSignal("NONE", "NO_SETUP_15M"));
    (evaluate4hMacro as any).mockReturnValue({ pass: true, reason: "Macro bullish" });
    (evaluate1hRegime as any).mockReturnValue({ pass: true, reason: "Trend bullish" });

    const snap = await buildSpotContextSnapshot("BTC/USD");

    const dataHealthGate = snap.gates.find(g => g.level === "Data Health");
    expect(dataHealthGate).toBeDefined();
    expect(dataHealthGate!.pass).toBe(true);

    const macroGate = snap.gates.find(g => g.level === "Macro 4H");
    expect(macroGate).toBeDefined();
    expect(macroGate!.pass).toBe(true);
  });

  it("should handle errors gracefully in multi-pair snapshots", async () => {
    (buildSpotMarketContext as any)
      .mockResolvedValueOnce(mockCtx("BTC/USD"))
      .mockRejectedValueOnce(new Error("Network error"));

    (evaluateSpotCanonical as any).mockReturnValue(mockSignal("NONE", "BLOCKED"));
    (evaluate4hMacro as any).mockReturnValue({ pass: true, reason: "OK" });
    (evaluate1hRegime as any).mockReturnValue({ pass: true, reason: "OK" });

    const snapshots = await buildSpotContextSnapshots(["BTC/USD", "ETH/USD"]);

    expect(snapshots.length).toBe(2);
    expect(snapshots[0].pair).toBe("BTC/USD");
    expect(snapshots[1].pair).toBe("ETH/USD");
    expect(snapshots[1].dataHealth).toBe("ERROR");
    expect(snapshots[1].decisionColor).toBe("red");
  });

  it("should be read-only (no side effects on engine state)", async () => {
    const ctx = mockCtx();
    (buildSpotMarketContext as any).mockResolvedValue(ctx);
    (evaluateSpotCanonical as any).mockReturnValue(mockSignal("NONE", "BLOCKED"));
    (evaluate4hMacro as any).mockReturnValue({ pass: true, reason: "OK" });
    (evaluate1hRegime as any).mockReturnValue({ pass: true, reason: "OK" });

    const snap = await buildSpotContextSnapshot("BTC/USD");

    // Snapshot should not have created any intents or positions
    expect(snap.hasActiveIntent).toBe(false);
    expect(snap.intentState).toBeNull();
  });
});
