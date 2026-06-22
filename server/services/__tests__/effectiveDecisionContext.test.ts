/**
 * Tests for EffectiveDecisionContextBuilder
 * Validates that the builder returns clean, versioned, serializable JSON contexts.
 */

import { describe, it, expect } from "vitest";
import {
  buildEffectiveDecisionContext,
  type EffectiveDecisionContextInput,
} from "../ai/EffectiveDecisionContextBuilder";

const BASE_INPUT: EffectiveDecisionContextInput = {
  pair: "BTC/USD",
  source: "shadow",
  mode: "live",
  decisionPhase: "entry",
};

describe("buildEffectiveDecisionContext — identity fields", () => {
  it("sets version=1 always", () => {
    const ctx = buildEffectiveDecisionContext(BASE_INPUT);
    expect(ctx.version).toBe(1);
  });

  it("sets timestamp as ISO string", () => {
    const ctx = buildEffectiveDecisionContext(BASE_INPUT);
    expect(typeof ctx.timestamp).toBe("string");
    expect(() => new Date(ctx.timestamp)).not.toThrow();
  });

  it("preserves pair, source, mode, decisionPhase", () => {
    const ctx = buildEffectiveDecisionContext(BASE_INPUT);
    expect(ctx.pair).toBe("BTC/USD");
    expect(ctx.source).toBe("shadow");
    expect(ctx.mode).toBe("live");
    expect(ctx.decisionPhase).toBe("entry");
  });
});

describe("buildEffectiveDecisionContext — null coercion", () => {
  it("converts undefined subfields to null in nested objects", () => {
    const ctx = buildEffectiveDecisionContext({
      ...BASE_INPUT,
      regime: {
        detectedRegime: "BULL",
        confidence: undefined,
        regimeDetectionEnabled: undefined,
      },
    });
    expect(ctx.regime?.detectedRegime).toBe("BULL");
    expect(ctx.regime?.confidence).toBeNull();
    expect(ctx.regime?.regimeDetectionEnabled).toBeNull();
  });

  it("leaves undefined optional groups as undefined (not forced to null object)", () => {
    const ctx = buildEffectiveDecisionContext(BASE_INPUT);
    expect(ctx.botState).toBeUndefined();
    expect(ctx.hybridGuard).toBeUndefined();
    expect(ctx.smartGuard).toBeUndefined();
    expect(ctx.exitPolicy).toBeUndefined();
  });

  it("outcome defaults to known=false, all nulls when omitted", () => {
    const ctx = buildEffectiveDecisionContext(BASE_INPUT);
    expect(ctx.outcome?.known).toBe(false);
    expect(ctx.outcome?.netPnl).toBeNull();
    expect(ctx.outcome?.label).toBeNull();
  });
});

describe("buildEffectiveDecisionContext — all groups populated", () => {
  const FULL_INPUT: EffectiveDecisionContextInput = {
    pair: "ETH/USD",
    source: "dry_run",
    mode: "dry_run",
    decisionPhase: "entry",
    botState: {
      botActive: true,
      dryRunMode: true,
      strategy: "momentum_candles_15m",
      positionMode: "SMART_GUARD",
      riskLevel: "MEDIUM",
    },
    entryPolicy: {
      requiredSignals: 3,
      detectedSignals: 3,
      finalSignalScore: 0.82,
      entryAllowedBeforeGuards: true,
    },
    cooldowns: {
      generalMinutes: 15,
      blockedByCooldown: false,
    },
    hybridGuard: {
      enabled: true,
      antiCrestEnabled: true,
      blocked: false,
      watchId: null,
      reason: null,
    },
    smartGuard: {
      enabled: true,
      minEntryUsd: 20,
      allowUnderMin: false,
      openLotsCurrent: 0,
      maxOpenLotsPerPair: 3,
    },
    entryFilters: {
      spreadFilterEnabled: true,
      spreadPct: 0.12,
      spreadThresholdPct: 0.50,
      blockedBySpread: false,
      stalenessGateEnabled: true,
      stalenessSec: 25,
      stalenessMaxSec: 60,
      blockedByStaleness: false,
      chaseGateEnabled: true,
      chasePct: 0.05,
      chaseMaxPct: 0.50,
      blockedByChase: false,
    },
    regime: {
      regimeDetectionEnabled: true,
      regimeRouterEnabled: true,
      detectedRegime: "BULL",
      confidence: 0.82,
    },
    risk: {
      riskPerTradePct: 15,
      maxTotalExposurePct: 80,
      currentTotalExposure: 0,
      blockedByExposure: false,
    },
    market: {
      price: 3500.00,
      spreadPct: 0.12,
      candlesTimeframe: "15m",
    },
    decision: {
      allowed: true,
      blocked: false,
      action: "WOULD_ALLOW",
      aiProbability: 0.82,
      aiThreshold: 0.60,
      aiRecommendation: "ALLOW",
    },
  };

  it("serializes cleanly to JSON without errors", () => {
    const ctx = buildEffectiveDecisionContext(FULL_INPUT);
    expect(() => JSON.stringify(ctx)).not.toThrow();
  });

  it("preserves botState fields", () => {
    const ctx = buildEffectiveDecisionContext(FULL_INPUT);
    expect(ctx.botState?.strategy).toBe("momentum_candles_15m");
    expect(ctx.botState?.positionMode).toBe("SMART_GUARD");
  });

  it("preserves regime fields", () => {
    const ctx = buildEffectiveDecisionContext(FULL_INPUT);
    expect(ctx.regime?.detectedRegime).toBe("BULL");
    expect(ctx.regime?.confidence).toBe(0.82);
  });

  it("preserves entryFilters — spread, staleness, chase", () => {
    const ctx = buildEffectiveDecisionContext(FULL_INPUT);
    expect(ctx.entryFilters?.spreadPct).toBe(0.12);
    expect(ctx.entryFilters?.stalenessSec).toBe(25);
    expect(ctx.entryFilters?.chasePct).toBe(0.05);
    expect(ctx.entryFilters?.blockedByChase).toBe(false);
  });

  it("preserves smartGuard openLotsCurrent", () => {
    const ctx = buildEffectiveDecisionContext(FULL_INPUT);
    expect(ctx.smartGuard?.openLotsCurrent).toBe(0);
    expect(ctx.smartGuard?.minEntryUsd).toBe(20);
  });

  it("preserves decision AI fields", () => {
    const ctx = buildEffectiveDecisionContext(FULL_INPUT);
    expect(ctx.decision?.aiProbability).toBe(0.82);
    expect(ctx.decision?.aiThreshold).toBe(0.60);
    expect(ctx.decision?.aiRecommendation).toBe("ALLOW");
  });

  it("default outcome still has known=false", () => {
    const ctx = buildEffectiveDecisionContext(FULL_INPUT);
    expect(ctx.outcome?.known).toBe(false);
  });
});

describe("buildEffectiveDecisionContext — IDCA hybrid context", () => {
  it("preserves idcaHybrid observerOnly flag", () => {
    const ctx = buildEffectiveDecisionContext({
      ...BASE_INPUT,
      source: "idca",
      decisionPhase: "observer",
      idcaHybrid: {
        enabled: true,
        mode: "shadow",
        observerOnly: true,
        doNotRewriteAnchor: true,
        cycleKind: "manual",
        isManualCycle: true,
        isImported: false,
      },
    });
    expect(ctx.idcaHybrid?.observerOnly).toBe(true);
    expect(ctx.idcaHybrid?.doNotRewriteAnchor).toBe(true);
    expect(ctx.idcaHybrid?.cycleKind).toBe("manual");
  });
});

describe("buildEffectiveDecisionContext — safety: never throws", () => {
  it("handles completely empty input without crashing", () => {
    expect(() => buildEffectiveDecisionContext({
      pair: "",
      source: "shadow",
      mode: "live",
      decisionPhase: "entry",
    })).not.toThrow();
  });

  it("is a pure function — same input produces same output structure", () => {
    const a = buildEffectiveDecisionContext(FULL_INPUT);
    const b = buildEffectiveDecisionContext(FULL_INPUT);
    expect(a.version).toBe(b.version);
    expect(a.pair).toBe(b.pair);
    expect(a.regime?.detectedRegime).toBe(b.regime?.detectedRegime);
  });

  const FULL_INPUT: EffectiveDecisionContextInput = {
    pair: "BTC/USD",
    source: "shadow",
    mode: "live",
    decisionPhase: "entry",
    regime: { detectedRegime: "BULL", confidence: 0.7 },
  };
});
