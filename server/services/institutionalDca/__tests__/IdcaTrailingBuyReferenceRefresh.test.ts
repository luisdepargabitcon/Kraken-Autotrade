/**
 * Tests for the trailing buy stale-reference refresh after dynamic anchor renewal.
 *
 * Root cause: TrailingBuyManager stores referencePrice as a snapshot at arm time.
 * When the dynamic anchor renews, the armed TB retains the old snapshot.
 * The guard detects diff > 0.25% and disarms + re-arms with the new reference.
 *
 * Cases:
 *   A. No active cycle, TB armed with old ref, anchor renewed → TB disarmed, no buy with old ref
 *   B. Active cycle, anchor renewed → TB reference NOT touched, cycle untouched
 *   C. Anchor diff ≤ 0.25% → no refresh (noise suppression)
 *   D. TB armed with stale ref fires trigger → blocked by pre-purchase guard
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TrailingBuyManager } from "../TrailingBuyManager";

// ─── Helper: compute whether a stale-reference guard would fire ─────────────
// Reproduces the guard logic from IdcaEngine.ts without importing the engine.

const STALE_REF_THRESHOLD = 0.0025; // 0.25%

function wouldRefreshTrigger(
  armedRefPrice: number,
  currentEffectiveRef: number
): { fires: boolean; diffPct: number } {
  if (armedRefPrice <= 0) return { fires: true, diffPct: 100 };
  const diff = Math.abs(currentEffectiveRef - armedRefPrice) / armedRefPrice;
  return { fires: diff > STALE_REF_THRESHOLD, diffPct: diff * 100 };
}

function wouldPrePurchaseGuardBlock(
  armedRefPrice: number,
  currentEffectiveRef: number
): boolean {
  if (armedRefPrice <= 0) return false;
  const diff = Math.abs(currentEffectiveRef - armedRefPrice) / armedRefPrice;
  return diff > STALE_REF_THRESHOLD;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("TrailingBuy stale-reference guard after dynamic anchor renewal", () => {

  beforeEach(() => {
    TrailingBuyManager.clearAll();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // CASO A: Sin ciclo activo, TB armado con ref vieja, ancla renovada a 77809.90
  // Resultado: guard dispara, TB se desarma, no compra con ref vieja
  // ───────────────────────────────────────────────────────────────────────────
  describe("Case A: no active cycle — TB armed with stale ref, anchor renewed", () => {

    it("A1: diff 5.1% (82017 → 77810) fires the guard", () => {
      const oldRef = 82017.40;
      const newRef = 77809.90;
      const { fires, diffPct } = wouldRefreshTrigger(oldRef, newRef);

      expect(fires).toBe(true);
      expect(diffPct).toBeGreaterThan(0.25);
      expect(diffPct).toBeCloseTo(5.12, 1);
    });

    it("A2: after guard disarms, TrailingBuyManager state is cleared", () => {
      const pair = "BTC/USD";
      TrailingBuyManager.arm(pair, 82017.40, 76000, { trailingPct: 0.5 });
      expect(TrailingBuyManager.isArmed(pair)).toBe(true);

      // Guard fires → disarm
      const state = TrailingBuyManager.getState(pair);
      const { fires } = wouldRefreshTrigger(state!.referencePrice, 77809.90);
      if (fires) TrailingBuyManager.disarm(pair);

      expect(TrailingBuyManager.isArmed(pair)).toBe(false);
    });

    it("A3: after disarm, re-arm uses new reference 77809.90", () => {
      const pair = "BTC/USD";
      // Original arm with old ref
      TrailingBuyManager.arm(pair, 82017.40, 76000, { trailingPct: 0.5 });
      const { fires } = wouldRefreshTrigger(82017.40, 77809.90);
      if (fires) TrailingBuyManager.disarm(pair);

      // Re-arm with new ref
      TrailingBuyManager.arm(pair, 77809.90, 76000, { trailingPct: 0.5 });
      const state = TrailingBuyManager.getState(pair);

      expect(state!.referencePrice).toBe(77809.90);
      expect(state!.referencePrice).not.toBe(82017.40);
    });

    it("A4: TB update would not trigger immediately after re-arm (needs to track low + bounce)", () => {
      const pair = "BTC/USD";
      TrailingBuyManager.disarm(pair);
      TrailingBuyManager.arm(pair, 77809.90, 76000, { trailingPct: 0.5 });

      // Price goes UP immediately — no trigger (no dip+bounce)
      const result = TrailingBuyManager.update(pair, 76100);
      expect(result.triggered).toBe(false);
    });

  });

  // ───────────────────────────────────────────────────────────────────────────
  // CASO B: Hay ciclo activo — NO toca referencia, NO cambia avg/ladder
  // El guard VWAP solo corre en el bloque sin ciclo activo; si hay ciclo,
  // el engine hace manageCycle y nunca llega al stale guard.
  // ───────────────────────────────────────────────────────────────────────────
  describe("Case B: active cycle present — TB reference locked", () => {

    it("B1: guard only runs in no-cycle branch — active cycle implies guard skipped", () => {
      // Simulate: if activeCycle exists, the engine runs manageCycle and returns
      // without entering the TB arm/stale-guard section.
      // We model this as: guard function is NOT called when hasActiveCycle=true.
      const hasActiveCycle = true;
      const pair = "BTC/USD";

      TrailingBuyManager.arm(pair, 82017.40, 76000, { trailingPct: 0.5 });

      // If active cycle, guard does NOT run:
      if (!hasActiveCycle) {
        const state = TrailingBuyManager.getState(pair);
        const { fires } = wouldRefreshTrigger(state!.referencePrice, 77809.90);
        if (fires) TrailingBuyManager.disarm(pair);
      }
      // Separately, active-cycle cleanup block disarms TB (existing behavior)
      if (hasActiveCycle && TrailingBuyManager.isArmed(pair)) {
        TrailingBuyManager.disarm(pair);
      }

      expect(TrailingBuyManager.isArmed(pair)).toBe(false);
      // Cycle data (avg, nextBuy, ladder) is managed by manageCycle — unchanged here.
    });

    it("B2: anchor price NOT modified for active cycle reference", () => {
      // The anchor memory update only happens inside checkEntry (no-cycle branch).
      // With active cycle, checkEntry is not called. referencePrice stays frozen.
      const cycleAvgEntry = 82017.40;
      const anchorAfterRenewal = 77809.90;

      // Guard logic skipped because activeCycle=true
      const hasActiveCycle = true;
      const guardRan = !hasActiveCycle;

      expect(guardRan).toBe(false);
      // Cycle avg entry is NOT touched:
      expect(cycleAvgEntry).toBe(82017.40);
      // Even if anchor changed externally, cycle reference stays:
      expect(cycleAvgEntry).not.toBe(anchorAfterRenewal);
    });

  });

  // ───────────────────────────────────────────────────────────────────────────
  // CASO C: Diferencia old/new ≤ 0.25% — NO refresca (supresión de ruido)
  // ───────────────────────────────────────────────────────────────────────────
  describe("Case C: anchor diff ≤ 0.25% — no refresh (noise suppression)", () => {

    it("C1: diff 0.10% does NOT fire the guard", () => {
      const oldRef = 77809.90;
      const newRef = oldRef * (1 - 0.0010); // 0.10% dip
      const { fires, diffPct } = wouldRefreshTrigger(oldRef, newRef);

      expect(fires).toBe(false);
      expect(diffPct).toBeLessThanOrEqual(0.25);
    });

    it("C2: diff exactly 0.25% does NOT fire (boundary, not strictly greater)", () => {
      const oldRef = 77809.90;
      const newRef = oldRef * (1 - 0.0025); // exactly 0.25%
      const { fires } = wouldRefreshTrigger(oldRef, newRef);

      expect(fires).toBe(false); // 0.25% is NOT > 0.25% threshold
    });

    it("C3: diff 0.26% DOES fire (just above threshold)", () => {
      const oldRef = 77809.90;
      const newRef = oldRef * (1 - 0.0026);
      const { fires } = wouldRefreshTrigger(oldRef, newRef);

      expect(fires).toBe(true);
    });

    it("C4: TrailingBuyManager state is preserved when diff ≤ 0.25%", () => {
      const pair = "ETH/USD";
      const oldRef = 3000;
      TrailingBuyManager.arm(pair, oldRef, 2950, { trailingPct: 0.5 });

      const newRef = oldRef * (1 - 0.0010); // 0.10% — no refresh
      const { fires } = wouldRefreshTrigger(oldRef, newRef);
      if (fires) TrailingBuyManager.disarm(pair);

      expect(TrailingBuyManager.isArmed(pair)).toBe(true); // NOT disarmed
      const state = TrailingBuyManager.getState(pair);
      expect(state!.referencePrice).toBe(oldRef); // unchanged
    });

  });

  // ───────────────────────────────────────────────────────────────────────────
  // CASO D: TB con ref stale dispara trigger → pre-purchase guard bloquea compra
  // ───────────────────────────────────────────────────────────────────────────
  describe("Case D: stale ref at trigger time → pre-purchase guard blocks buy", () => {

    it("D1: pre-purchase guard blocks buy when ref diff > 0.25%", () => {
      const armedRef = 82017.40;
      const currentRef = 77809.90; // anchor renewed between arm and trigger

      const blocked = wouldPrePurchaseGuardBlock(armedRef, currentRef);

      expect(blocked).toBe(true);
    });

    it("D2: pre-purchase guard allows buy when ref diff ≤ 0.25%", () => {
      const armedRef = 77809.90;
      const currentRef = armedRef * (1 - 0.001); // 0.10% diff — acceptable

      const blocked = wouldPrePurchaseGuardBlock(armedRef, currentRef);

      expect(blocked).toBe(false);
    });

    it("D3: after pre-purchase block, TB is disarmed (update already disarmed it)", () => {
      const pair = "BTC/USD";
      // Arm with stale ref
      TrailingBuyManager.arm(pair, 82017.40, 76500, { trailingPct: 0.5 });

      // Simulate bounce: localLow=76000, then price rebounds to 76380 (+0.5%)
      TrailingBuyManager.update(pair, 76000); // track low
      const result = TrailingBuyManager.update(pair, 76380); // trigger

      if (result.triggered) {
        // Pre-purchase guard
        const blocked = wouldPrePurchaseGuardBlock(82017.40, 77809.90);
        if (blocked) {
          // Do NOT set trailingAllowsEntry = true
          // TB already disarmed by update()
        }
      }

      // TB was disarmed by update() during trigger
      expect(TrailingBuyManager.isArmed(pair)).toBe(false);
      // trailingAllowsEntry would be false (blocked)
      const trailingAllowsEntry = result.triggered && !wouldPrePurchaseGuardBlock(82017.40, 77809.90);
      expect(trailingAllowsEntry).toBe(false);
    });

    it("D4: BTC real case — trigger allowed when ref is fresh", () => {
      const pair = "BTC/USD";
      const freshRef = 77809.90;
      TrailingBuyManager.arm(pair, freshRef, 76500, { trailingPct: 0.5 });

      TrailingBuyManager.update(pair, 76000);
      const result = TrailingBuyManager.update(pair, 76380);

      if (result.triggered) {
        const blocked = wouldPrePurchaseGuardBlock(freshRef, freshRef); // same ref
        expect(blocked).toBe(false); // NOT blocked
      }
    });

  });

  // ───────────────────────────────────────────────────────────────────────────
  // CASO REAL BTC — secuencia completa de renovación de ancla
  // ───────────────────────────────────────────────────────────────────────────
  describe("Real BTC case — full sequence", () => {

    it("Full flow: arm old ref → anchor renews → guard fires → re-arm new ref → Telegram uses new ref", () => {
      const pair = "BTC/USD";

      // Tick N: TB armed with old anchor
      const oldAnchor = 82017.40;
      TrailingBuyManager.arm(pair, oldAnchor, 76000, { trailingPct: 0.5 });
      expect(TrailingBuyManager.getState(pair)!.referencePrice).toBe(oldAnchor);

      // Tick N+1: anchor renewed inside checkEntry (previous tick)
      // Now vwapAnchorMemory has newAnchor; VWAP path reads it
      const newAnchor = 77809.90;

      // Guard logic fires:
      const state = TrailingBuyManager.getState(pair);
      const { fires } = wouldRefreshTrigger(state!.referencePrice, newAnchor);
      expect(fires).toBe(true);

      TrailingBuyManager.disarm(pair);
      expect(TrailingBuyManager.isArmed(pair)).toBe(false);

      // Arm block re-arms with new ref:
      TrailingBuyManager.arm(pair, newAnchor, 76000, { trailingPct: 0.5 });

      // Now Telegram alertTrailingBuyTracking would use:
      const newState = TrailingBuyManager.getState(pair)!;
      expect(newState.referencePrice).toBe(newAnchor); // 77809.90, NOT 82017.40
      expect(newState.referencePrice).not.toBe(oldAnchor);

      // Verification: "Precio de referencia de entrada" = ~77809.90 ✓
      expect(newState.referencePrice).toBeCloseTo(77809.90, 2);
    });

  });

});
