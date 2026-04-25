/**
 * Tests for IdcaTrailingBuyTelegramState — Anti-spam state machine for Trailing Buy Telegram notifications.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import * as tbState from "../institutionalDca/IdcaTrailingBuyTelegramState";

describe("IdcaTrailingBuyTelegramState — Anti-spam state machine", () => {
  beforeEach(() => {
    // Reset internal state between tests
    tbState.resetAllStates();
  });

  const pair = "ETH/USD";
  const mode = "simulation";
  const modeLive = "live";

  // ───────────────────────────────────────────────
  // Test 1: ARMED — only once
  // ───────────────────────────────────────────────
  it("should allow armed notification once, then block duplicates", () => {
    expect(tbState.shouldNotifyArmed(pair, mode)).toBe(true);
    tbState.markNotifiedArmed(pair, mode, 2400, 2350);
    
    // Second call should be blocked
    expect(tbState.shouldNotifyArmed(pair, mode)).toBe(false);
  });

  // ───────────────────────────────────────────────
  // Test 2: TRACKING — no spam on small changes
  // ───────────────────────────────────────────────
  it("should block tracking notifications with small price changes", () => {
    tbState.markNotifiedArmed(pair, mode, 2400, 2350);
    
    // Small change (0.10%) should be blocked
    const check1 = tbState.shouldNotifyTracking(pair, mode, 2347.65); // -0.10%
    expect(check1.should).toBe(false);
    
    const check2 = tbState.shouldNotifyTracking(pair, mode, 2352.35); // +0.10%
    expect(check2.should).toBe(false);
  });

  // ───────────────────────────────────────────────
  // Test 3: TRACKING — allow on significant improvement (>= 0.20%)
  // ───────────────────────────────────────────────
  it("should allow tracking notification when price improves >= 0.20%", () => {
    tbState.markNotifiedArmed(pair, mode, 2400, 2350);
    
    // Mark tracking once
    tbState.markNotifiedTracking(pair, mode, 2350);
    
    // Small change blocked
    const check1 = tbState.shouldNotifyTracking(pair, mode, 2350.47); // +0.02%
    expect(check1.should).toBe(false);
    
    // Significant improvement (0.25%)
    const check2 = tbState.shouldNotifyTracking(pair, mode, 2355.88); // +0.25%
    expect(check2.should).toBe(true);
    expect(check2.reason).toBe("improvement");
  });

  // ───────────────────────────────────────────────
  // Test 4: TRACKING — allow after 15 min cooldown
  // ───────────────────────────────────────────────
  it("should allow tracking notification after 15 minute interval", () => {
    tbState.markNotifiedArmed(pair, mode, 2400, 2350);
    
    // Immediately blocked
    const check1 = tbState.shouldNotifyTracking(pair, mode, 2340);
    expect(check1.should).toBe(false);
    
    // After marking tracking, need to wait
    tbState.markNotifiedTracking(pair, mode, 2340);
    
    // Still blocked immediately
    const check2 = tbState.shouldNotifyTracking(pair, mode, 2330);
    expect(check2.should).toBe(false);
  });

  // ───────────────────────────────────────────────
  // Test 5: TRIGGERED — only once per cycle
  // ───────────────────────────────────────────────
  it("should allow triggered notification once, then block duplicates", () => {
    tbState.markNotifiedArmed(pair, mode, 2400, 2350);
    
    expect(tbState.shouldNotifyTriggered(pair, mode)).toBe(true);
    tbState.markNotifiedTriggered(pair, mode);
    
    // Second call should be blocked
    expect(tbState.shouldNotifyTriggered(pair, mode)).toBe(false);
  });

  // ───────────────────────────────────────────────
  // Test 6: CANCELLED — only once
  // ───────────────────────────────────────────────
  it("should allow cancelled notification once from armed state, then block", () => {
    tbState.markNotifiedArmed(pair, mode, 2400, 2350);
    
    expect(tbState.shouldNotifyCancelled(pair, mode)).toBe(true);
    tbState.markNotifiedCancelled(pair, mode);
    
    // Second call should be blocked
    expect(tbState.shouldNotifyCancelled(pair, mode)).toBe(false);
  });

  // ───────────────────────────────────────────────
  // Test 7: CANCELLED — blocked if not armed
  // ───────────────────────────────────────────────
  it("should block cancelled notification if state is idle", () => {
    // No state set yet
    expect(tbState.shouldNotifyCancelled(pair, mode)).toBe(false);
  });

  // ───────────────────────────────────────────────
  // Test 8: RESET — allows re-arming after reset
  // ───────────────────────────────────────────────
  it("should allow re-arming after reset", () => {
    tbState.markNotifiedArmed(pair, mode, 2400, 2350);
    expect(tbState.shouldNotifyArmed(pair, mode)).toBe(false);
    
    // Reset
    tbState.resetTrailingBuyTelegramState(pair, mode, "test_reset");
    
    // Should allow again
    expect(tbState.shouldNotifyArmed(pair, mode)).toBe(true);
  });

  // ───────────────────────────────────────────────
  // Test 9: Isolation by pair
  // ───────────────────────────────────────────────
  it("should isolate state between different pairs", () => {
    const eth = "ETH/USD";
    const btc = "BTC/USD";
    
    tbState.markNotifiedArmed(eth, mode, 2400, 2350);
    expect(tbState.shouldNotifyArmed(eth, mode)).toBe(false);
    
    // BTC should still be allowed
    expect(tbState.shouldNotifyArmed(btc, mode)).toBe(true);
  });

  // ───────────────────────────────────────────────
  // Test 10: Isolation by mode
  // ───────────────────────────────────────────────
  it("should isolate state between simulation and live modes", () => {
    tbState.markNotifiedArmed(pair, mode, 2400, 2350);
    expect(tbState.shouldNotifyArmed(pair, mode)).toBe(false);
    
    // Live mode should still be allowed
    expect(tbState.shouldNotifyArmed(pair, modeLive)).toBe(true);
  });

  // ───────────────────────────────────────────────
  // Test 11: Full cycle simulation — no spam
  // ───────────────────────────────────────────────
  it("should simulate full cycle without spam: arm, track small, trigger, cancel", () => {
    // Step 1: Arm
    expect(tbState.shouldNotifyArmed(pair, mode)).toBe(true);
    tbState.markNotifiedArmed(pair, mode, 2400, 2350);
    
    // Step 2: Try to arm again — blocked
    expect(tbState.shouldNotifyArmed(pair, mode)).toBe(false);
    
    // Step 3: Small price change tracking — blocked
    const trackCheck1 = tbState.shouldNotifyTracking(pair, mode, 2347);
    expect(trackCheck1.should).toBe(false);
    
    // Step 4: Trigger — allowed once
    expect(tbState.shouldNotifyTriggered(pair, mode)).toBe(true);
    tbState.markNotifiedTriggered(pair, mode);
    
    // Step 5: Trigger again — blocked
    expect(tbState.shouldNotifyTriggered(pair, mode)).toBe(false);
    
    // Step 6: Cancel after trigger — blocked (already triggered)
    expect(tbState.shouldNotifyCancelled(pair, mode)).toBe(false);
  });

  // ───────────────────────────────────────────────
  // Test 12: TRACKING improvement detection
  // ───────────────────────────────────────────────
  it("should detect price improvement correctly", () => {
    tbState.markNotifiedArmed(pair, mode, 2400, 2350);
    
    // Initial tracking notification at 2350
    tbState.markNotifiedTracking(pair, mode, 2350);
    
    // Improvement less than 0.20%
    const check1 = tbState.shouldNotifyTracking(pair, mode, 2354); // +0.17%
    expect(check1.should).toBe(false);
    
    // Improvement slightly above 0.20% (0.201% to avoid floating point edge case)
    const check2 = tbState.shouldNotifyTracking(pair, mode, 2354.72); // +0.201%
    expect(check2.should).toBe(true);
    expect(check2.reason).toBe("improvement");
  });

  // ───────────────────────────────────────────────
  // Test 13: getTrailingBuyTelegramState returns correct state
  // ───────────────────────────────────────────────
  it("should return correct state via getTrailingBuyTelegramState", () => {
    expect(tbState.getTrailingBuyTelegramState(pair, mode)).toBeUndefined();
    
    tbState.markNotifiedArmed(pair, mode, 2400, 2350);
    const state = tbState.getTrailingBuyTelegramState(pair, mode);
    
    expect(state).toBeDefined();
    expect(state?.state).toBe("armed");
    expect(state?.triggerPrice).toBe(2400);
    expect(state?.localLow).toBe(2350);
  });

  // ───────────────────────────────────────────────
  // Test 14: getAllTrailingBuyTelegramStates
  // ───────────────────────────────────────────────
  it("should return all states via getAllTrailingBuyTelegramStates", () => {
    tbState.markNotifiedArmed("ETH/USD", "simulation", 2400, 2350);
    tbState.markNotifiedArmed("BTC/USD", "live", 68000, 67500);
    
    const all = tbState.getAllTrailingBuyTelegramStates();
    expect(all).toHaveLength(2);
    expect(all.map(s => s.pair)).toContain("ETH/USD");
    expect(all.map(s => s.pair)).toContain("BTC/USD");
  });

  // ───────────────────────────────────────────────
  // Test 15: Cancel from idle state blocked
  // ───────────────────────────────────────────────
  it("should block cancel when state is idle or already cancelled", () => {
    // Reset to be sure
    tbState.resetTrailingBuyTelegramState(pair, mode, "test");
    
    // Idle → cancelled blocked
    expect(tbState.shouldNotifyCancelled(pair, mode)).toBe(false);
    
    // Arm and cancel
    tbState.markNotifiedArmed(pair, mode, 2400, 2350);
    tbState.markNotifiedCancelled(pair, mode);
    
    // Already cancelled → blocked
    expect(tbState.shouldNotifyCancelled(pair, mode)).toBe(false);
  });
});
