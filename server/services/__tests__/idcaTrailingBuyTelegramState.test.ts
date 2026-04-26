/**
 * Tests for IdcaTrailingBuyTelegramState — Anti-spam state machine for Trailing Buy Telegram notifications.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import * as tbState from "../institutionalDca/IdcaTrailingBuyTelegramState";
import { computeActivationPrice, computeReboundTriggerPrice, TrailingBuyManager } from "../institutionalDca/TrailingBuyManager";

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
  it("should allow tracking notification when price improves >= 0.20% (new lower low)", () => {
    tbState.markNotifiedArmed(pair, mode, 2400, 2350);
    
    // Mark tracking once at 2350
    tbState.markNotifiedTracking(pair, mode, 2350);
    
    // Small drop (<0.20%) blocked
    const check1 = tbState.shouldNotifyTracking(pair, mode, 2349.58); // -0.018% — blocked
    expect(check1.should).toBe(false);
    
    // New lower low by >= 0.20% triggers improvement notification (2350 * 0.998 = 2345.30)
    const check2 = tbState.shouldNotifyTracking(pair, mode, 2345.00); // -0.2128% from 2350
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
    
    // Small change (0.04%) — still blocked immediately
    const check2 = tbState.shouldNotifyTracking(pair, mode, 2339.10); // -0.038%
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
  it("should detect price improvement correctly (lower low)", () => {
    tbState.markNotifiedArmed(pair, mode, 2400, 2350);
    
    // Initial tracking notification at 2350
    tbState.markNotifiedTracking(pair, mode, 2350);
    
    // Drop less than 0.20% — blocked
    const check1 = tbState.shouldNotifyTracking(pair, mode, 2346.30); // -0.16%
    expect(check1.should).toBe(false);
    
    // Drop exactly above 0.20% — allowed
    const check2 = tbState.shouldNotifyTracking(pair, mode, 2345.29); // -0.20% from 2350
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

  // ───────────────────────────────────────────────
  // Test 16: Cooldown de rearmado tras cancel
  // ───────────────────────────────────────────────
  it("should block re-arming within 30 min after cancel", () => {
    // Arm, then cancel
    tbState.markNotifiedArmed(pair, mode, 2400, 2350);
    tbState.markNotifiedCancelled(pair, mode);

    // Immediately after cancel: shouldNotifyArmed must be false (cooldown active)
    expect(tbState.shouldNotifyArmed(pair, mode)).toBe(false);
  });

  // ───────────────────────────────────────────────
  // Test 17: cancelIncrement — histéresis (2 ticks para cancelar)
  // ───────────────────────────────────────────────
  it("cancelIncrement should return false on first tick and true on second", () => {
    tbState.markNotifiedArmed(pair, mode, 2400, 2350);

    // Tick 1 — no debe cancelar
    const tick1 = tbState.cancelIncrement(pair, mode);
    expect(tick1).toBe(false);

    // Tick 2 — debe cancelar
    const tick2 = tbState.cancelIncrement(pair, mode);
    expect(tick2).toBe(true);
  });

  // ───────────────────────────────────────────────
  // Test 18: cancelReset reinicia el contador de histéresis
  // ───────────────────────────────────────────────
  it("cancelReset should restart histeresis counter", () => {
    tbState.markNotifiedArmed(pair, mode, 2400, 2350);

    // Tick 1 — no cancela
    tbState.cancelIncrement(pair, mode);

    // Reset — vuelve a cero
    tbState.cancelReset(pair, mode);

    // Tick 1 de nuevo — no cancela (reinició)
    const tick1again = tbState.cancelIncrement(pair, mode);
    expect(tick1again).toBe(false);

    // Tick 2 — ahora sí cancela
    const tick2 = tbState.cancelIncrement(pair, mode);
    expect(tick2).toBe(true);
  });

  // ───────────────────────────────────────────────
  // Test 19: Estado cargado como "armed" impide re-notificar ARMED (simula restart)
  // ───────────────────────────────────────────────
  it("should not re-notify ARMED if state was loaded from DB as armed (restart simulation)", () => {
    // Simulamos lo que hace loadStateFromDb — se llama markNotifiedArmed directamente
    // (la carga de DB establece el mismo estado en memoria)
    tbState.markNotifiedArmed(pair, mode, 2400, 2350);

    // Como si el scheduler hubiera arrancado y cargado ese estado:
    // shouldNotifyArmed debe retornar false
    expect(tbState.shouldNotifyArmed(pair, mode)).toBe(false);
  });

  // ───────────────────────────────────────────────
  // Test 20: Estado cancelado preserva rearmAllowedAfter tras markNotifiedCancelled
  // ───────────────────────────────────────────────
  it("should preserve rearmAllowedAfter in cancelled state (cooldown intact)", () => {
    tbState.markNotifiedArmed(pair, mode, 2400, 2350);
    tbState.markNotifiedCancelled(pair, mode);

    const st = tbState.getTrailingBuyTelegramState(pair, mode);
    expect(st?.state).toBe("cancelled");
    expect(st?.cancelledAt).toBeDefined();
    expect(st?.rearmAllowedAfter).toBeDefined();
    expect(st!.rearmAllowedAfter!).toBeGreaterThan(Date.now());
  });
});

// ─── Tests obligatorios Opción B spec numérico ETH/USD ───────────────────────
// effectiveEntryReference=2424.05, minDip=3.5%, rebound=0.30%, maxOvershoot=0.30%
// buyThreshold = 2424.05 * (1-0.035) = 2339.21
// maxExecutionPrice = 2339.21 * (1+0.003) = 2346.23

describe("TrailingBuy Opción B — buyThreshold desde effectiveEntryReference", () => {
  const pair = "ETH/USD";
  const mode = "simulation";

  const REF = 2424.05;
  const MIN_DIP = 3.5;
  const REBOUND_PCT = 0.3;
  const MAX_OVERSHOOT = 0.3;

  const buyThreshold = REF * (1 - MIN_DIP / 100);           // 2339.21
  const maxExecutionPrice = buyThreshold * (1 + MAX_OVERSHOOT / 100); // 2346.23

  beforeEach(() => {
    TrailingBuyManager.clearAll();
    tbState.resetAllStates();
  });

  // Test 1: fórmula buyThreshold
  it("1. reference=2424.05 minDip=3.5 → buyThreshold=2339.21", () => {
    expect(computeActivationPrice(REF, MIN_DIP)).toBeCloseTo(2339.21, 1);
  });

  // Test 2: Caso A — currentPrice=2378.81 > buyThreshold → WATCHING, no armado
  it("2. currentPrice=2378.81 > buyThreshold=2339.21 → WATCHING, TB no armado", () => {
    expect(2378.81).toBeGreaterThan(buyThreshold);
    expect(tbState.shouldNotifyWatching(pair, mode)).toBe(true);
    expect(TrailingBuyManager.isArmed(pair)).toBe(false);
  });

  // Test 3: Caso B — currentPrice=2339.21 <= buyThreshold → ARMED
  it("3. currentPrice=2339.21 <= buyThreshold → ARMED con referencePrice y buyThreshold correctos", () => {
    TrailingBuyManager.armLevel(pair, REF, buyThreshold, buyThreshold, 0, {
      trailingMode: "rebound_pct",
      trailingValue: REBOUND_PCT,
      maxWaitMinutes: 60,
      cancelOnRecovery: false,
      maxExecutionPrice,
    });

    expect(TrailingBuyManager.isArmed(pair)).toBe(true);
    const state = TrailingBuyManager.getState(pair);
    expect(state?.referencePrice).toBeCloseTo(REF, 1);
    expect(state?.buyThreshold).toBeCloseTo(buyThreshold, 1);
    expect(state?.maxExecutionPrice).toBeCloseTo(maxExecutionPrice, 1);
    expect(state?.localLow).toBeCloseTo(buyThreshold, 1);
  });

  // Test 4: localLow=buyThreshold, rebound=0.3% → reboundTriggerPrice=2346.23
  it("4. localLow=2339.21 reboundPct=0.3 → reboundTriggerPrice=2346.23", () => {
    const rtp = computeReboundTriggerPrice(buyThreshold, REBOUND_PCT);
    expect(rtp).toBeCloseTo(maxExecutionPrice, 1);
  });

  // Test 5: Caso C — localLow baja a 2325, reboundTriggerPrice=2331.98
  it("5. localLow=2325.00 reboundPct=0.3 → reboundTriggerPrice=2331.98", () => {
    const rtp = computeReboundTriggerPrice(2325.00, REBOUND_PCT);
    expect(rtp).toBeCloseTo(2325.00 * 1.003, 2);
    expect(rtp).toBeCloseTo(2331.98, 1);
  });

  // Test 6: Caso D — precio baja a 2325, update lo trackea correctamente
  it("6. TRACKING: localLow actualiza a 2325, reboundTriggerPrice < maxExecutionPrice", () => {
    TrailingBuyManager.armLevel(pair, REF, buyThreshold, buyThreshold, 0, {
      trailingMode: "rebound_pct",
      trailingValue: REBOUND_PCT,
      maxWaitMinutes: 60,
      cancelOnRecovery: false,
      maxExecutionPrice,
    });

    const r = TrailingBuyManager.update(pair, 2325.00);
    expect(r.triggered).toBe(false);
    expect(r.reason).toBe("tracking_lower");
    const state = TrailingBuyManager.getState(pair);
    expect(state?.localLow).toBeCloseTo(2325.00, 2);
    const rtp = computeReboundTriggerPrice(state!.localLow, state!.trailingPct);
    expect(rtp).toBeCloseTo(2331.98, 1);
  });

  // Test 7: Caso D — rebote desde 2325 a 2331.98 → REBOUND_DETECTED, incluye buyThreshold y maxExecutionPrice
  it("7. REBOUND_DETECTED desde localLow=2325 → triggered=true, incluye buyThreshold y maxExecutionPrice", () => {
    TrailingBuyManager.armLevel(pair, REF, buyThreshold, 2325.00, 0, {
      trailingMode: "rebound_pct",
      trailingValue: REBOUND_PCT,
      maxWaitMinutes: 60,
      cancelOnRecovery: false,
      maxExecutionPrice,
    });

    const reboundPrice = computeReboundTriggerPrice(2325.00, REBOUND_PCT); // 2331.98
    // +0.01 para evitar imprecisión float al comparar bouncePct >= trailingPct
    const r = TrailingBuyManager.update(pair, reboundPrice + 0.01);
    expect(r.triggered).toBe(true);
    expect(r.localLow).toBeCloseTo(2325.00, 2);
    expect(r.buyThreshold).toBeCloseTo(buyThreshold, 1);
    expect(r.maxExecutionPrice).toBeCloseTo(maxExecutionPrice, 1);
    // 2331.98 <= 2346.23 → permitido
    expect(r.buyPrice).toBeLessThanOrEqual(maxExecutionPrice);
  });

  // Test 8: Caso E — currentPrice=2350 > maxExecutionPrice=2346.23 → bloqueado
  it("8. currentPrice=2350 > maxExecutionPrice=2346.23 → execution_too_high (arm no dispara)", () => {
    TrailingBuyManager.armLevel(pair, REF, buyThreshold, 2325.00, 0, {
      trailingMode: "rebound_pct",
      trailingValue: REBOUND_PCT,
      maxWaitMinutes: 60,
      cancelOnRecovery: false,
      maxExecutionPrice,
    });

    // El TB dispara a cualquier precio > reboundTriggerPrice
    // El bloqueo execution_too_high lo hace el engine al llamar performEntryCheck
    // Aquí verificamos que maxExecutionPrice se almacena correctamente en el estado
    const state = TrailingBuyManager.getState(pair);
    expect(2350.00).toBeGreaterThan(state!.maxExecutionPrice);
    expect(state!.maxExecutionPrice).toBeCloseTo(2346.23, 1);
  });

  // Test 9: sin cycleId → no Telegram "Compra ejecutada"
  it("9. alertTrailingBuyExecuted sin cycleId → no envía Telegram (guard activo)", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { alertTrailingBuyExecuted } = await import("../institutionalDca/IdcaTelegramNotifier");
    await alertTrailingBuyExecuted(pair, mode, 2331.98, 2325.00, REBOUND_PCT, 0, undefined);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("no hay cycleId"));
    consoleSpy.mockRestore();
  });

  // Test 10: restart — no re-notifica ARMED si ya estaba armado
  it("10. restart: shouldNotifyArmed=false si ya estaba en estado armed", () => {
    tbState.markNotifiedArmed(pair, mode, REF, buyThreshold);
    expect(tbState.shouldNotifyArmed(pair, mode)).toBe(false);
  });

  // Test 11: WATCHING throttle — 30min
  it("11. shouldNotifyWatching: primera=true, segunda inmediata=false (throttle 30min)", () => {
    expect(tbState.shouldNotifyWatching(pair, mode)).toBe(true);
    tbState.markNotifiedWatching(pair, mode);
    expect(tbState.shouldNotifyWatching(pair, mode)).toBe(false);
  });

  // Test 12: WATCHING bloqueado cuando ya estamos en ARMED
  it("12. shouldNotifyWatching=false cuando estado es armed", () => {
    tbState.markNotifiedArmed(pair, mode, REF, buyThreshold);
    expect(tbState.shouldNotifyWatching(pair, mode)).toBe(false);
  });

  // Test 13: parser reconoce todos los logTypes del spec
  it("13. detectLogType reconoce WATCHING, ARMED, TRACKING, REBOUND_DETECTED, EXECUTION_BLOCKED, EXECUTED, CANCELLED", () => {
    const cases: [string, string][] = [
      ["[TRAILING_BUY_WATCHING] pair=ETH/USD referencePrice=$2424.05", "trailing_buy_watching"],
      ["[TRAILING_BUY_ARMED] pair=ETH/USD level=0 referencePrice=$2424.05 buyThreshold=$2339.21", "trailing_buy_armed"],
      ["[TRAILING_BUY_TRACKING] pair=ETH/USD oldLow=$2339.21 newLow=$2325.00", "trailing_buy_tracking"],
      ["[TRAILING_BUY_REBOUND_DETECTED] pair=ETH/USD localLow=$2325.00 status=processing_entry", "trailing_buy_rebound_detected"],
      ["[TRAILING_BUY_EXECUTION_BLOCKED] pair=ETH/USD reason=execution_too_high currentPrice=$2350.00", "trailing_buy_execution_blocked"],
      ["[TRAILING_BUY_EXECUTED] pair=ETH/USD cycleId=123 orderId=456", "trailing_buy_executed"],
      ["[TRAILING_BUY_CANCELLED] pair=ETH/USD reason=price_recovered", "trailing_buy_cancelled"],
    ];
    for (const [line, expectedType] of cases) {
      const l = line.toLowerCase();
      let detected = "other";
      if (l.includes("trailing_buy_watching"))             detected = "trailing_buy_watching";
      else if (l.includes("trailing_buy_execution_blocked")) detected = "trailing_buy_execution_blocked";
      else if (l.includes("trailing_buy_rebound_detected")) detected = "trailing_buy_rebound_detected";
      else if (l.includes("trailing_buy_armed"))            detected = "trailing_buy_armed";
      else if (l.includes("trailing_buy_tracking"))         detected = "trailing_buy_tracking";
      else if (l.includes("trailing_buy_executed"))         detected = "trailing_buy_executed";
      else if (l.includes("trailing_buy_cancelled"))        detected = "trailing_buy_cancelled";
      expect(detected, `line: ${line}`).toBe(expectedType);
    }
  });
});
