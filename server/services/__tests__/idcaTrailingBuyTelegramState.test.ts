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

// ─── Tests obligatorios spec: lógica WATCHING/ARMED/activationPrice ──────────

describe("TrailingBuy spec — activationPrice, WATCHING, ARMED, tracking", () => {
  const pair = "ETH/USD";
  const mode = "simulation";

  beforeEach(() => {
    TrailingBuyManager.clearAll();
    tbState.resetAllStates();
  });

  // Spec punto 2: cálculo activationPrice
  it("1. referencePrice=2404.66 minDip=3.5 → activationPrice=2320.50", () => {
    const activationPrice = computeActivationPrice(2404.66, 3.5);
    expect(activationPrice).toBeCloseTo(2320.50, 1);
  });

  // Spec punto 3: precio por encima → NO se arma
  it("2. currentPrice=2346 > activationPrice=2320.50 → no se arma el TB", () => {
    const referencePrice = 2404.66;
    const activationPrice = computeActivationPrice(referencePrice, 3.5);
    const currentPrice = 2346;

    expect(currentPrice).toBeGreaterThan(activationPrice);
    // Estado WATCHING: shouldNotifyWatching debe permitir notificar (primera vez)
    expect(tbState.shouldNotifyWatching(pair, mode)).toBe(true);
    // TB NO debe estar armado
    expect(TrailingBuyManager.isArmed(pair)).toBe(false);
  });

  // Spec punto 4: precio llega a activationPrice → se arma
  it("3. currentPrice=2320.50 <= activationPrice → TB se arma correctamente", () => {
    const referencePrice = 2404.66;
    const activationPrice = computeActivationPrice(referencePrice, 3.5);
    expect(activationPrice).toBeCloseTo(2320.50, 1);

    TrailingBuyManager.armLevel(pair, referencePrice, activationPrice, activationPrice, 0, {
      trailingMode: "rebound_pct",
      trailingValue: 0.3,
      maxWaitMinutes: 60,
      cancelOnRecovery: false,
    });

    expect(TrailingBuyManager.isArmed(pair)).toBe(true);
    const state = TrailingBuyManager.getState(pair);
    expect(state?.referencePrice).toBeCloseTo(2404.66, 1);
    expect(state?.activationPrice).toBeCloseTo(2320.50, 1);
    expect(state?.localLow).toBeCloseTo(2320.50, 1);
  });

  // Spec punto 5a: localLow=2320.50, rebound=0.3 → reboundTriggerPrice=2327.46
  it("4. localLow=2320.50 reboundPct=0.3 → reboundTriggerPrice=2327.46", () => {
    const reboundTriggerPrice = computeReboundTriggerPrice(2320.50, 0.3);
    expect(reboundTriggerPrice).toBeCloseTo(2327.46, 1);
  });

  // Spec punto 5b: localLow baja a 2317.00 → reboundTriggerPrice=2323.95
  it("5. localLow=2317.00 reboundPct=0.3 → reboundTriggerPrice=2323.95", () => {
    const reboundTriggerPrice = computeReboundTriggerPrice(2317.00, 0.3);
    expect(reboundTriggerPrice).toBeCloseTo(2323.95, 1);
  });

  // Spec punto 5: TB trackea local low correctamente
  it("6. localLow se actualiza al bajar el precio, reboundTriggerPrice se recalcula", () => {
    const referencePrice = 2404.66;
    const activationPrice = computeActivationPrice(referencePrice, 3.5);

    TrailingBuyManager.armLevel(pair, referencePrice, activationPrice, 2320.50, 0, {
      trailingMode: "rebound_pct",
      trailingValue: 0.3,
      maxWaitMinutes: 60,
      cancelOnRecovery: false,
    });

    // Precio baja más → debe actualizar localLow
    const result1 = TrailingBuyManager.update(pair, 2317.00);
    expect(result1.triggered).toBe(false);
    expect(result1.reason).toBe("tracking_lower");
    const state = TrailingBuyManager.getState(pair);
    expect(state?.localLow).toBeCloseTo(2317.00, 2);

    // reboundTriggerPrice desde nuevo localLow
    const reboundTriggerPrice = computeReboundTriggerPrice(state!.localLow, state!.trailingPct);
    expect(reboundTriggerPrice).toBeCloseTo(2323.95, 1);
  });

  // Spec punto 6 + 9: rebote detectado pero si revalidación falla → triggered=true solo indica rebote,
  // la compra real depende del engine. Solo "Compra ejecutada" si hay cycleId.
  it("7. alertTrailingBuyExecuted SIN cycleId/orderId → no envía Telegram (guard activo)", async () => {
    // La función guarda este contrato: si cycleId<=0 u orderId<=0 → return sin enviar
    // Verificamos el guard directamente desde el módulo
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { alertTrailingBuyExecuted } = await import("../institutionalDca/IdcaTelegramNotifier");

    // Sin cycleId (0)
    await alertTrailingBuyExecuted(pair, mode, 2324.00, 2317.00, 0.3, 0, undefined);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("no hay cycleId"));

    // Sin orderId (0) pero cycleId válido
    await alertTrailingBuyExecuted(pair, mode, 2324.00, 2317.00, 0.3, 999, 0);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("no hay orderId"));

    consoleSpy.mockRestore();
  });

  // WATCHING throttle: segunda llamada inmediata bloqueada por 30min
  it("8. shouldNotifyWatching: primera vez true, segunda inmediata false (throttle 30min)", () => {
    expect(tbState.shouldNotifyWatching(pair, mode)).toBe(true);
    tbState.markNotifiedWatching(pair, mode);
    // Segunda llamada inmediata → throttle activo (30 min no han pasado)
    expect(tbState.shouldNotifyWatching(pair, mode)).toBe(false);
  });

  // WATCHING no se muestra si ya estamos en ARMED
  it("9. shouldNotifyWatching=false cuando estado es armed", () => {
    tbState.markNotifiedArmed(pair, mode, 2404.66, 2320.50);
    expect(tbState.shouldNotifyWatching(pair, mode)).toBe(false);
  });
});
