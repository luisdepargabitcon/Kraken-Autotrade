/**
 * spotContextSnapshot.test.ts — Tests for SPOT context snapshot builder.
 *
 * Tests the PURE builder (buildSnapshotFromScanResults) that takes
 * real scan results and produces a snapshot. No DB, no market data.
 *
 * Also tests spotContextSnapshotStore (publish, get, getAll).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies — the builder only imports types, but the store imports pairAllowlist
vi.mock("../../../db", () => ({
  db: { execute: vi.fn() },
}));

vi.mock("drizzle-orm", () => ({
  sql: (strings: TemplateStringsArray) => strings.join(""),
}));

import { buildSnapshotFromScanResults, reasonCodeToSpanish } from "../spotContextSnapshot";
import { publishSnapshot, getSnapshot, getAllSnapshots, clearSnapshotStoreForTest } from "../spotContextSnapshotStore";
import { DataHealth } from "../candleTimestamp";
import { Regime, RegimeDirection, MacroBias, VolatilityLevel } from "../spotTypes";
import type { SpotMarketContext, SpotEntryIntent, ExecutionMode } from "../spotTypes";
import type { SpotSignalResult } from "../spotCanonicalStrategy";
import type { SizingResult } from "../spotRiskManager";
import type { IntentEvaluationResult } from "../spotEntryIntent";

// ─── Helpers ────────────────────────────────────────────────────────────────

function mockCtx(pair: string = "BTC/USD"): SpotMarketContext {
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
  } as any;
}

function mockSignal(signal: "BUY" | "NONE" = "NONE", blockReason: string | null = "BLOCKED"): SpotSignalResult {
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
  } as any;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("spotContextSnapshot — buildSnapshotFromScanResults", () => {
  beforeEach(() => {
    clearSnapshotStoreForTest();
  });

  it("should produce a snapshot with correct structure from scan results", () => {
    const ctx = mockCtx();
    const signal = mockSignal("NONE", "NO_SETUP_15M");

    const snap = buildSnapshotFromScanResults({
      pair: "BTC/USD", scanId: "scan-1", mode: "SHADOW" as ExecutionMode, enabled: true,
      ctx, signal, intent: null, intentEvaluation: null, sizing: null,
      blockReasonCode: "NO_SETUP_15M",
    });

    expect(snap.pair).toBe("BTC/USD");
    expect(snap.scanId).toBe("scan-1");
    expect(snap.enabled).toBe(true);
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
    expect(snap.mode).toBe("SHADOW");
  });

  it("should show CANDIDATE decision when signal is BUY without sizing", () => {
    const ctx = mockCtx();
    const signal = mockSignal("BUY", null);

    const snap = buildSnapshotFromScanResults({
      pair: "BTC/USD", scanId: "scan-1", mode: "SHADOW" as ExecutionMode, enabled: true,
      ctx, signal, intent: null, intentEvaluation: null, sizing: null,
      blockReasonCode: null,
    });

    expect(snap.signal).toBe("BUY");
    expect(snap.setupTag).toBe("PULLBACK_CONTINUATION");
    expect(snap.signalConfidence).toBe(0.75);
    expect(snap.decisionState).toBe("CANDIDATE");
    expect(snap.decisionColor).toBe("green");
  });

  it("should show APPROVED when signal BUY and sizing approved", () => {
    const ctx = mockCtx();
    const signal = mockSignal("BUY", null);
    const sizing: SizingResult = { approved: true, qty: 0.1, notional: 10, blockReason: null, reason: "OK" } as any;

    const snap = buildSnapshotFromScanResults({
      pair: "BTC/USD", scanId: "scan-1", mode: "SHADOW" as ExecutionMode, enabled: true,
      ctx, signal, intent: null, intentEvaluation: null, sizing,
      blockReasonCode: null,
    });

    expect(snap.decisionState).toBe("APPROVED");
  });

  it("should show red decision when data health is stale", () => {
    const ctx = mockCtx();
    ctx.dataHealth = DataHealth.STALE;
    const signal = mockSignal("NONE", "DATA_STALE");

    const snap = buildSnapshotFromScanResults({
      pair: "BTC/USD", scanId: "scan-1", mode: "SHADOW" as ExecutionMode, enabled: true,
      ctx, signal, intent: null, intentEvaluation: null, sizing: null,
      blockReasonCode: "DATA_STALE",
    });

    expect(snap.decisionColor).toBe("red");
    expect(snap.decisionTitle).toContain("Datos");
  });

  it("should show red decision when macro is bearish", () => {
    const ctx = mockCtx();
    ctx.regimeContext.macroBias = MacroBias.BEARISH;
    const signal = mockSignal("NONE", "MACRO_BEARISH");

    const snap = buildSnapshotFromScanResults({
      pair: "BTC/USD", scanId: "scan-1", mode: "SHADOW" as ExecutionMode, enabled: true,
      ctx, signal, intent: null, intentEvaluation: null, sizing: null,
      blockReasonCode: "MACRO_BEARISH",
    });

    expect(snap.decisionColor).toBe("red");
    expect(snap.decisionTitle).toContain("Macro");
  });

  it("should show DISABLED when pair is not enabled", () => {
    const ctx = mockCtx();
    const signal = mockSignal("NONE", null);

    const snap = buildSnapshotFromScanResults({
      pair: "BTC/USD", scanId: "scan-1", mode: "SHADOW" as ExecutionMode, enabled: false,
      ctx, signal, intent: null, intentEvaluation: null, sizing: null,
      blockReasonCode: null,
    });

    expect(snap.decisionState).toBe("DISABLED");
    expect(snap.enabled).toBe(false);
    expect(snap.decisionColor).toBe("gray");
  });

  it("should include gate breakdown with pass/fail status and reasonCodes", () => {
    const ctx = mockCtx();
    const signal = mockSignal("NONE", "NO_SETUP_15M");

    const snap = buildSnapshotFromScanResults({
      pair: "BTC/USD", scanId: "scan-1", mode: "SHADOW" as ExecutionMode, enabled: true,
      ctx, signal, intent: null, intentEvaluation: null, sizing: null,
      blockReasonCode: "NO_SETUP_15M",
    });

    const dataHealthGate = snap.gates.find(g => g.level === "Data Health");
    expect(dataHealthGate).toBeDefined();
    expect(dataHealthGate!.pass).toBe(true);
    expect(dataHealthGate!.reasonCode).toBe("DATA_GOOD");

    const macroGate = snap.gates.find(g => g.level === "Macro 4H");
    expect(macroGate).toBeDefined();
    expect(macroGate!.pass).toBe(true);
  });

  it("should be read-only (no side effects, pure function)", () => {
    const ctx = mockCtx();
    const signal = mockSignal("NONE", "BLOCKED");

    const snap = buildSnapshotFromScanResults({
      pair: "BTC/USD", scanId: "scan-1", mode: "SHADOW" as ExecutionMode, enabled: true,
      ctx, signal, intent: null, intentEvaluation: null, sizing: null,
      blockReasonCode: null,
    });

    expect(snap.hasActiveIntent).toBe(false);
    expect(snap.intentState).toBeNull();
  });

  it("reasonCodeToSpanish should map known codes and fallback for unknown", () => {
    expect(reasonCodeToSpanish("MACRO_BEARISH", "fallback")).toContain("bajista");
    expect(reasonCodeToSpanish("NO_SETUP_15M", "fallback")).toContain("configuración");
    expect(reasonCodeToSpanish("UNKNOWN_CODE", "fallback text")).toBe("fallback text");
    expect(reasonCodeToSpanish(null, "fallback")).toBe("fallback");
  });
});

describe("spotContextSnapshotStore", () => {
  beforeEach(() => {
    clearSnapshotStoreForTest();
  });

  it("should publish and retrieve a snapshot", () => {
    const ctx = mockCtx();
    const signal = mockSignal("NONE", null);
    const snap = buildSnapshotFromScanResults({
      pair: "BTC/USD", scanId: "scan-1", mode: "SHADOW" as ExecutionMode, enabled: true,
      ctx, signal, intent: null, intentEvaluation: null, sizing: null,
      blockReasonCode: null,
    });

    publishSnapshot(snap);
    const retrieved = getSnapshot("BTC/USD");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.pair).toBe("BTC/USD");
    expect(retrieved!.scanId).toBe("scan-1");
  });

  it("should return null for unpublished pair", () => {
    const result = getSnapshot("ETH/USD");
    expect(result).toBeNull();
  });

  it("getAllSnapshots should include published and placeholder pairs", () => {
    const ctx = mockCtx();
    const signal = mockSignal("NONE", null);
    const snap = buildSnapshotFromScanResults({
      pair: "BTC/USD", scanId: "scan-1", mode: "SHADOW" as ExecutionMode, enabled: true,
      ctx, signal, intent: null, intentEvaluation: null, sizing: null,
      blockReasonCode: null,
    });
    publishSnapshot(snap);

    const all = getAllSnapshots(new Set(["BTC/USD"]));
    expect(all.length).toBeGreaterThan(0);
    const btc = all.find(s => s.pair === "BTC/USD");
    expect(btc).toBeDefined();
    expect(btc!.enabled).toBe(true);
    expect(btc!.scanId).toBe("scan-1");
  });

  it("getAllSnapshots should mark disabled pairs", () => {
    const ctx = mockCtx();
    const signal = mockSignal("NONE", null);
    const snap = buildSnapshotFromScanResults({
      pair: "BTC/USD", scanId: "scan-1", mode: "SHADOW" as ExecutionMode, enabled: true,
      ctx, signal, intent: null, intentEvaluation: null, sizing: null,
      blockReasonCode: null,
    });
    publishSnapshot(snap);

    const all = getAllSnapshots(new Set()); // no enabled pairs
    const btc = all.find(s => s.pair === "BTC/USD");
    expect(btc).toBeDefined();
    expect(btc!.enabled).toBe(false);
    expect(btc!.decisionState).toBe("DISABLED");
  });

  it("getAllSnapshots should create placeholders for pairs without snapshots", () => {
    const all = getAllSnapshots(new Set(["BTC/USD"]));
    const btc = all.find(s => s.pair === "BTC/USD");
    expect(btc).toBeDefined();
    expect(btc!.scanId).toBe("");
    expect(btc!.decisionState).toBe("WAITING");
    expect(btc!.primaryReasonCode).toBe("NO_SCAN_YET");
  });
});
