import { describe, it, expect, beforeEach } from "vitest";
import { GridRecommendationRegistry, gridRecommendationRegistry } from "../gridIsolated/gridRecommendationRegistry";
import type { ConfigurationRecommendation } from "@shared/gridRecommendationHelper";

function makeRecommendation(overrides: Partial<ConfigurationRecommendation> = {}): ConfigurationRecommendation {
  const base: ConfigurationRecommendation = {
    id: "rec-test-btc",
    generatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    snapshotFingerprint: "snap",
    configFingerprint: "cfg",
    marketFingerprint: "mkt",
    activeRangeFingerprint: "range",
    context: {
      pair: "BTC/USD",
      mode: "SHADOW",
      activeRangeVersionId: "rv1",
      regime: "RANGE",
      regimeMaxPct: 5,
      bandPeriod: 20,
      bandStdDevMultiplier: 2,
      atrPeriod: 14,
      atrTimeframe: "1h",
      bandSource: "kraken",
      bandLower: 90000,
      bandCenter: 95000,
      bandUpper: 100000,
      bandWidthPct: 10,
      atrPct: 2,
      referencePrice: 95000,
    },
    referencePrice: 95000,
    fresh: true,
    confidence: 0.85,
    title: "Recomendación",
    explanation: "",
    currentConfig: {},
    alternatives: [],
    recommendedAlternativeId: "A",
    warnings: [],
    safeToApply: true,
    blockingReason: null,
  };
  return { ...base, ...overrides };
}

describe("GridRecommendationRegistry", () => {
  let registry: GridRecommendationRegistry;

  beforeEach(() => {
    registry = new GridRecommendationRegistry();
  });

  it("generates an id with the pair prefix", () => {
    const id = registry.generateId("BTC/USD");
    expect(id).toMatch(/^rec-/);
    expect(id).toContain("BTC/USD");
  });

  it("registers and retrieves a recommendation", () => {
    const rec = makeRecommendation({ id: "rec-1" });
    registry.register(rec);
    expect(registry.get("rec-1")?.id).toBe("rec-1");
  });

  it("returns null for an unknown recommendation", () => {
    expect(registry.get("unknown")).toBeNull();
  });

  it("returns null for an expired recommendation", () => {
    const rec = makeRecommendation({
      id: "rec-expired",
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    registry.register(rec);
    expect(registry.get("rec-expired")).toBeNull();
  });

  it("deletes expired entries on demand", () => {
    registry.register(makeRecommendation({ id: "rec-old", expiresAt: new Date(Date.now() - 1000).toISOString() }));
    registry.register(makeRecommendation({ id: "rec-new" }));
    const deleted = registry.deleteExpired();
    expect(deleted).toBe(1);
    expect(registry.size()).toBe(1);
  });

  it("marks a recommendation as applied and prevents reuse", () => {
    const rec = makeRecommendation({ id: "rec-apply" });
    registry.register(rec);
    expect(registry.isApplied("rec-apply")).toBe(false);
    expect(registry.markApplied("rec-apply")).toBe(true);
    expect(registry.isApplied("rec-apply")).toBe(true);
    expect(registry.markApplied("rec-apply")).toBe(false);
  });

  it("clears all entries", () => {
    registry.register(makeRecommendation({ id: "rec-a" }));
    registry.register(makeRecommendation({ id: "rec-b" }));
    registry.clear();
    expect(registry.size()).toBe(0);
  });

  it("size excludes expired entries", () => {
    registry.register(makeRecommendation({ id: "rec-exp", expiresAt: new Date(Date.now() - 1000).toISOString() }));
    expect(registry.size()).toBe(0);
  });
});

describe("gridRecommendationRegistry singleton", () => {
  it("exports a shared registry instance", () => {
    expect(gridRecommendationRegistry).toBeInstanceOf(GridRecommendationRegistry);
    gridRecommendationRegistry.clear();
    expect(gridRecommendationRegistry.size()).toBe(0);
  });
});
