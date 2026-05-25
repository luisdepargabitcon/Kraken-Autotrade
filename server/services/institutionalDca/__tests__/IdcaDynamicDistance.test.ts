/**
 * Tests for IdcaDynamicDistanceService
 *
 * Casos cubiertos (spec aprobado):
 *   a) manual no cambia nada
 *   b) dinámico nunca sube nextBuyPrice
 *   c) dinámico baja nextBuyPrice si exige más distancia
 *   d) fallback a avgEntry si no hay lastBuyPrice
 *   e) feed not_ready (candleCount<5) bloquea
 *   f) clamp min/max
 *   g) imported/plus/recovery respetan la misma regla
 *   h) ladder ATRP + dinámico usa siempre la distancia más conservadora
 */

// ─── Test runner mínimo (patrón del repo) ────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

function test(name: string, fn: () => void): void {
  console.log(`\n📋 ${name}`);
  fn();
}

// ─── Import (pure functions only — no DB, no exchange) ────────────────────────

import { parseDynamicDistanceConfig, computeDynamicDistance } from "../IdcaDynamicDistanceService";
import type { DynamicDistanceConfig, DynamicDistanceInput } from "../IdcaTypes";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<DynamicDistanceConfig> = {}): DynamicDistanceConfig {
  return parseDynamicDistanceConfig({
    mode: "dynamic_hybrid",
    atrMultiplier: 1.0,
    aggressiveness: 50,
    minDistancePct: 0.80,
    maxDistancePct: 12.0,
    feeFloorPct: 0.60,
    useMarketRegime: true,
    useCyclePressure: true,
    useExposurePenalty: true,
    useDataHealthPenalty: true,
    ...overrides,
  });
}

function makeInput(overrides: Partial<DynamicDistanceInput> = {}): DynamicDistanceInput {
  return {
    config: makeConfig(),
    pair: "BTC/USD",
    cycleType: "main",
    buyCount: 2,
    avgEntryPrice: 95000,
    lastBuyPrice: 94000,
    existingNextBuyPrice: 90000,   // -4.26% from lastBuyPrice
    atrPct: 2.0,
    marketScore: 65,
    candleCount: 20,
    capitalUsedUsd: 500,
    capitalReservedUsd: 1000,
    ...overrides,
  };
}

// ─── TESTS ────────────────────────────────────────────────────────────────────

test("a) Manual mode: no change to nextBuyPrice", () => {
  const input = makeInput({ config: makeConfig({ mode: "manual" } as any) });
  const result = computeDynamicDistance(input);
  assert(result.mode === "manual", "mode is 'manual'");
  assert(result.blocked === false, "not blocked");
  assert(result.appliedDistancePct === undefined, "no appliedDistancePct in manual");
  assert(result.effectiveNextBuyPrice === undefined, "no effectiveNextBuyPrice in manual");
});

test("b) Dynamic hybrid: NEVER raises nextBuyPrice (trigger cannot move closer to current)", () => {
  // existingNextBuyPrice = 90000 (far from current ~94000)
  // Dynamic suggests a smaller distance → proposed > existingNextBuyPrice
  // effectiveNextBuyPrice must stay <= existingNextBuyPrice
  const input = makeInput({
    config: makeConfig({ atrMultiplier: 0.2, aggressiveness: 100 }), // very aggressive/small distance
    existingNextBuyPrice: 90000,
    lastBuyPrice: 94000,
    marketScore: 80,
    buyCount: 1,
  });
  const result = computeDynamicDistance(input);
  assert(result.mode === "dynamic_hybrid", "mode is dynamic_hybrid");
  assert(result.blocked === false, "not blocked");
  assert(result.effectiveNextBuyPrice != null, "effectiveNextBuyPrice is set");
  assert(
    result.effectiveNextBuyPrice! <= 90000,
    `effectiveNextBuyPrice (${result.effectiveNextBuyPrice?.toFixed(2)}) must be <= 90000`
  );
  assert(result.changedFrom == null, "changedFrom is null (no change needed)");
});

test("c) Dynamic hybrid: lowers nextBuyPrice when more distance required", () => {
  // existingNextBuyPrice = 93060 = 94000 * (1 - 1%) → only 1% away from lastBuyPrice
  // dynamic with ATR=2% should require more than 1% → push trigger further down
  const input = makeInput({
    config: makeConfig({ atrMultiplier: 1.5, aggressiveness: 50, feeFloorPct: 0.60 }),
    existingNextBuyPrice: 94000 * (1 - 1 / 100),  // 93060 — only 1% below lastBuyPrice
    lastBuyPrice: 94000,
    atrPct: 2.0,
    marketScore: 65,
    buyCount: 1,
    capitalUsedUsd: 300,
    capitalReservedUsd: 1000,
  });
  const result = computeDynamicDistance(input);
  assert(result.blocked === false, "not blocked");
  assert(result.changedFrom != null, "changedFrom is set (price was changed)");
  assert(
    result.effectiveNextBuyPrice! < 93060,
    `effectiveNextBuyPrice (${result.effectiveNextBuyPrice?.toFixed(2)}) must be < 93060`
  );
  assert(
    result.proposedNextBuyPrice! < 93060,
    `proposedNextBuyPrice (${result.proposedNextBuyPrice?.toFixed(2)}) must be < 93060`
  );
});

test("d) Fallback to avgEntryPrice when lastBuyPrice is null", () => {
  const input = makeInput({
    avgEntryPrice: 95000,
    lastBuyPrice: null,
    existingNextBuyPrice: null,
    candleCount: 20,
  });
  const result = computeDynamicDistance(input);
  assert(result.blocked === false, "not blocked");
  assert(result.referencePrice === 95000, `referencePrice should be avgEntryPrice=95000, got ${result.referencePrice}`);
  assert(result.proposedNextBuyPrice! < 95000, "proposedNextBuyPrice < avgEntryPrice");
});

test("e) candleCount < 5 blocks with data_not_ready", () => {
  const input = makeInput({ candleCount: 3 });
  const result = computeDynamicDistance(input);
  assert(result.blocked === true, "must be blocked");
  assert(result.blockReason === "data_not_ready", `blockReason should be 'data_not_ready', got '${result.blockReason}'`);
  assert(result.effectiveNextBuyPrice === undefined, "no effectiveNextBuyPrice when blocked");
});

test("f) Clamp: result is always within [minDistancePct, maxDistancePct]", () => {
  // Extreme ATR — would suggest huge distance, must be clamped to max
  const highAtrInput = makeInput({
    config: makeConfig({ atrMultiplier: 10.0, maxDistancePct: 8.0 }),
    atrPct: 5.0,
    buyCount: 3,
    marketScore: 30,
    capitalUsedUsd: 900,
    capitalReservedUsd: 1000,
  });
  const resultHigh = computeDynamicDistance(highAtrInput);
  assert(resultHigh.appliedDistancePct! <= 8.0,
    `applied (${resultHigh.appliedDistancePct?.toFixed(2)}%) must be <= maxDistancePct=8%`);
  assert(resultHigh.components!.clamped === true, "clamped should be true for high ATR case");

  // Very low ATR — would suggest tiny distance, must be clamped to min
  const lowAtrInput = makeInput({
    config: makeConfig({ atrMultiplier: 0.1, aggressiveness: 100, minDistancePct: 1.5 }),
    atrPct: 0.2,
    marketScore: 90,
    buyCount: 1,
    capitalUsedUsd: 100,
    capitalReservedUsd: 1000,
  });
  const resultLow = computeDynamicDistance(lowAtrInput);
  assert(resultLow.appliedDistancePct! >= 1.5,
    `applied (${resultLow.appliedDistancePct?.toFixed(2)}%) must be >= minDistancePct=1.5%`);
});

test("g) cycleType=plus and cycleType=recovery respect the same conservative rule", () => {
  const cycleTypes: Array<"main" | "plus" | "recovery"> = ["main", "plus", "recovery"];
  for (const cycleType of cycleTypes) {
    const input = makeInput({
      cycleType,
      config: makeConfig({ atrMultiplier: 1.5 }),
      existingNextBuyPrice: 94000 * (1 - 0.8 / 100),  // only 0.8% below lastBuyPrice
      lastBuyPrice: 94000,
      atrPct: 2.0,
    });
    const result = computeDynamicDistance(input);
    assert(result.blocked === false, `${cycleType}: not blocked`);
    assert(result.effectiveNextBuyPrice! <= input.existingNextBuyPrice!,
      `${cycleType}: effectiveNextBuyPrice (${result.effectiveNextBuyPrice?.toFixed(2)}) <= existing`);
  }
});

test("h) Ladder ATRP + dynamic: always uses most conservative (lower) nextBuyPrice", () => {
  // Simulates the engine logic: min(ladderNextBuyPrice, proposedByDynamic)
  const ladderNextBuyPrice = 93000;     // ladder calculated: -1.06% from lastBuyPrice=94000
  const input = makeInput({
    config: makeConfig({ atrMultiplier: 2.0, aggressiveness: 50 }),
    existingNextBuyPrice: ladderNextBuyPrice,
    lastBuyPrice: 94000,
    atrPct: 2.5,
    marketScore: 45,    // regime penalty: +0.5%
    buyCount: 2,        // cycle pressure: +0.3%
    capitalUsedUsd: 700,
    capitalReservedUsd: 1000,  // exposure 70%: +0.5%
  });
  const result = computeDynamicDistance(input);
  assert(result.blocked === false, "not blocked");
  // effective must be <= ladder price (most conservative)
  assert(result.effectiveNextBuyPrice! <= ladderNextBuyPrice,
    `effectiveNextBuyPrice (${result.effectiveNextBuyPrice?.toFixed(2)}) must be <= ladder (${ladderNextBuyPrice})`);
  // Verify the formula: raw = max(feeFloor, atr + penalties)
  const comps = result.components!;
  assert(comps.atrDistance > 0, "atrDistance > 0");
  assert(comps.regimePenalty > 0, "regimePenalty > 0 (marketScore=45 < 60)");
  assert(comps.cyclePressure > 0, "cyclePressure > 0 (buyCount=2)");
  assert(comps.exposurePenalty > 0, "exposurePenalty > 0 (exposure=70%)");
  assert(comps.raw === Math.max(comps.feeFloor,
    comps.atrDistance + comps.regimePenalty + comps.cyclePressure +
    comps.exposurePenalty + comps.dataHealthPenalty),
    "raw = max(feeFloor, atrDistance + all additive penalties)");
});

// ─── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log("✅ All tests passed!");
}
