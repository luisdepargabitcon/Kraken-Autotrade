/**
 * spotContextExecution.test.ts — Tests for ExecuteEntryOutcome and snapshot pipeline stop metadata.
 *
 * Verifies that executeEntry returns a typed outcome with stage/reasonCode/reason,
 * and that snapshots carry pipelineStopStage/ReasonCode/Reason from the pipeline.
 */
import { describe, it, expect } from "vitest";
import { buildSnapshotFromScanResults } from "../spotContextSnapshot";
import type { SnapshotBuildContext } from "../spotContextSnapshot";

function makeBaseInput(overrides: Partial<SnapshotBuildContext> = {}): SnapshotBuildContext {
  return {
    pair: "BTC/USD",
    scanId: "scan-test-001",
    mode: "SHADOW" as any,
    enabled: true,
    ctx: {
      pair: "BTC/USD",
      marketContextId: "ctx-001",
      ticker: { last: 95000, bid: 94990, ask: 95010, spread: 20, spreadPct: 0.021, volume24h: 500000000, volumeRatio: 1.2 },
      volumeMetrics: { volumeRatio: 1.2, volume24h: 500000000, participation: "STRONG" },
      regimeContext: {
        regimeId: "reg-001",
        regime: "BULLISH_TREND",
        direction: "UP",
        macroBias: "BULLISH",
        atrPct: 2.5,
        adx: 35,
        ema20: 94000,
        ema50: 92000,
        ema200: 88000,
        emaAlignment: "BULLISH",
        bollingerWidth: 0.08,
        confidence: 0.75,
        volatility: "HIGH",
        participation: "STRONG",
      },
      macro4h: "BULLISH",
      regime1h: "BULLISH_TREND",
      dataHealth: "GOOD",
      spread: 20,
      spreadPct: 0.021,
      volumeRatio: 1.2,
      volume24h: 500000000,
      macroBias: "BULLISH",
      regime: "BULLISH_TREND",
      direction: "UP",
      volatility: "HIGH",
      adx: 35,
      ema20: 94000,
      ema50: 92000,
      ema200: 88000,
      emaAlignment: "BULLISH",
      bollingerWidth: 0.08,
      atrPct: 2.5,
      confidence: 0.75,
      price: 95000,
      bid: 94990,
      ask: 95010,
      participation: "STRONG",
    } as any,
    signal: {
      signal: "BUY",
      setupTag: "BREAKOUT_15M",
      reason: "Breakout confirmado",
      confidence: 0.75,
      blockReason: null,
    } as any,
    intent: null,
    intentEvaluation: null,
    sizing: null,
    blockReasonCode: null,
    ...overrides,
  };
}

describe("ExecuteEntryOutcome propagation to snapshot", () => {
  it("CE-1: snapshot includes pipelineStopStage when provided", () => {
    const input = makeBaseInput({
      pipelineStopStage: "SIZING",
      pipelineStopReasonCode: "SIZING_REJECTED",
      pipelineStopReason: "Capital insuficiente",
    });
    const snap = buildSnapshotFromScanResults(input);
    expect(snap.pipelineStopStage).toBe("SIZING");
    expect(snap.pipelineStopReasonCode).toBe("SIZING_REJECTED");
    expect(snap.pipelineStopReason).toBe("Capital insuficiente");
  });

  it("CE-2: snapshot uses pipelineStopReasonCode over blockReasonCode", () => {
    const input = makeBaseInput({
      blockReasonCode: "OLD_REASON",
      pipelineStopReasonCode: "NEW_REASON",
      pipelineStopStage: "GENERATION",
      pipelineStopReason: "Modo cambió",
    });
    const snap = buildSnapshotFromScanResults(input);
    expect(snap.primaryReasonCode).toBe("NEW_REASON");
  });

  it("CE-3: snapshot falls back to blockReasonCode when no pipelineStop", () => {
    const input = makeBaseInput({
      blockReasonCode: "FALLBACK_REASON",
    });
    const snap = buildSnapshotFromScanResults(input);
    expect(snap.pipelineStopStage).toBeNull();
    expect(snap.pipelineStopReasonCode).toBeNull();
    expect(snap.primaryReasonCode).toBe("FALLBACK_REASON");
  });

  it("CE-4: snapshot with EXECUTED stage shows ENTRY_FILLED", () => {
    const input = makeBaseInput({
      pipelineStopStage: "EXECUTED",
      pipelineStopReasonCode: "ENTRY_FILLED",
      pipelineStopReason: "Posición abierta",
    });
    const snap = buildSnapshotFromScanResults(input);
    expect(snap.pipelineStopStage).toBe("EXECUTED");
    expect(snap.pipelineStopReasonCode).toBe("ENTRY_FILLED");
  });

  it("CE-5: snapshot with null pipelineStop uses gate-based detection", () => {
    const input = makeBaseInput();
    const snap = buildSnapshotFromScanResults(input);
    expect(snap.pipelineStopStage).toBeNull();
    expect(snap.gates.length).toBeGreaterThan(0);
  });

  it("CE-6: disabled pair snapshot shows DESACTIVADO decisionState", () => {
    const input = makeBaseInput({ enabled: false });
    const snap = buildSnapshotFromScanResults(input);
    expect(snap.decisionState).toBe("DISABLED");
  });

  it("CE-7: pipelineStopStage overrides determineLastReachedStage", () => {
    const input = makeBaseInput({
      pipelineStopStage: "ADAPTER",
    });
    const snap = buildSnapshotFromScanResults(input);
    expect(snap.lastReachedStage).toBe("ADAPTER");
  });
});

describe("Context Spanish labels and reason code mapping", () => {
  it("CTX_ES_SETUP_LABELS: gate levels use Spanish labels", () => {
    const input = makeBaseInput({
      ctx: {
        ...makeBaseInput().ctx,
        regimeContext: {
          ...makeBaseInput().ctx.regimeContext,
          regime: "TREND",
          direction: "BULLISH",
        },
      } as any,
      signal: { signal: "NONE", setupTag: null, reason: "No setup", confidence: 0, blockReason: "NO_SETUP_15M" } as any,
    });
    const snap = buildSnapshotFromScanResults(input);
    const setupGate = snap.gates.find(g => g.reasonCode === "NO_SETUP_15M");
    expect(setupGate).toBeDefined();
    expect(setupGate!.level).toBe("Configuración 15 min");
  });

  it("CTX_ES_MARKET_LABELS: gate levels use Spanish for trigger and sizing", () => {
    const input = makeBaseInput({
      ctx: {
        ...makeBaseInput().ctx,
        regimeContext: {
          ...makeBaseInput().ctx.regimeContext,
          regime: "TREND",
          direction: "BULLISH",
        },
      } as any,
      signal: { signal: "BUY", setupTag: "PULLBACK_CONTINUATION", reason: "ok", confidence: 0.8, blockReason: null } as any,
      sizing: { approved: false, volume: 0, notionalUsd: 0, stopPrice: 0, stopDistancePct: 0, stopDistanceUsd: 0, riskUsd: 0, reason: "too small", blockReason: "SIZING_REJECTED" } as any,
    });
    const snap = buildSnapshotFromScanResults(input);
    const sizingGate = snap.gates.find(g => g.reasonCode === "SIZING_REJECTED");
    expect(sizingGate).toBeDefined();
    expect(sizingGate!.level).toBe("Gestión de riesgo");
  });

  it("CTX_ES_PRIMARY_REASON_FROM_CODE: primaryReasonEs derived from reasonCode, not pipelineStopReason", () => {
    const input = makeBaseInput({
      pipelineStopStage: "SIZING",
      pipelineStopReasonCode: "SIZING_REJECTED",
      pipelineStopReason: "Some English technical reason that should NOT appear in primaryReasonEs",
    });
    const snap = buildSnapshotFromScanResults(input);
    expect(snap.primaryReasonCode).toBe("SIZING_REJECTED");
    expect(snap.primaryReasonEs).toContain("gestión de riesgo");
    expect(snap.primaryReasonEs).not.toContain("Some English technical reason");
  });

  it("CTX_ES_PIPELINE_RAW_REASON_DETAIL_ONLY: pipelineStopReason preserved as technical detail", () => {
    const input = makeBaseInput({
      pipelineStopStage: "ADAPTER",
      pipelineStopReasonCode: "ENTRY_FAILED",
      pipelineStopReason: "Exchange error: connection timeout",
    });
    const snap = buildSnapshotFromScanResults(input);
    expect(snap.pipelineStopReason).toBe("Exchange error: connection timeout");
    expect(snap.primaryReasonEs).not.toContain("Exchange error");
    expect(snap.primaryReasonEs).toContain("entrada");
  });

  it("CTX_ES_ALL_EXECUTE_ENTRY_OUTCOME_CODES_MAPPED: every outcome code has Spanish mapping", () => {
    const codes = [
      "PAIR_DISABLED_RACE_BLOCKED",
      "SIZING_REJECTED",
      "REAL_FREEZE_ACTIVATED",
      "SUPERVISOR_UNHEALTHY_BLOCKS_REAL_BUY",
      "REAL_OPEN_LOTS_QUERY_FAILED_FAIL_CLOSED",
      "REAL_TRADING_VENUE_UNVERIFIED",
      "REAL_INTENT_PERSISTENCE_FAILED_FAIL_CLOSED",
      "DUPLICATE_ENTRY_SUBMISSION",
      "DUPLICATE_ENTRY_TERMINAL",
      "REAL_SUBMISSION_AMBIGUOUS",
      "REAL_ACCEPTED_NO_VENUE_ID",
      "ENTRY_REJECTED",
      "ENTRY_FAILED",
      "NO_FILL_PRICE",
      "INVALID_NOTIONAL",
      "SHADOW_PERSIST_FAILED",
      "REAL_ENTRY_FILL_ATOMIC_FAILED",
      "PENDING_FILL",
      "ENTRY_FILLED",
    ];
    for (const code of codes) {
      const input = makeBaseInput({
        pipelineStopStage: "TEST",
        pipelineStopReasonCode: code,
        pipelineStopReason: `English detail for ${code}`,
      });
      const snap = buildSnapshotFromScanResults(input);
      expect(snap.primaryReasonEs).not.toBe(`English detail for ${code}`);
      expect(snap.primaryReasonEs.length).toBeGreaterThan(5);
    }
  });
});
