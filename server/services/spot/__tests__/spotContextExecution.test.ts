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
