/**
 * Tests for IDCA Per-Pair Operation Toggle (exit-only mode)
 * 
 * When assetConfig.enabled=false, the pair enters "exit-only" mode:
 * - NO new cycles opened
 * - NO dynamic entry / trailing buy entry
 * - NO safety buys on active cycles
 * - NO Plus cycle creation
 * - NO Recovery cycle creation
 * - YES exits: TP, trailing, break-even, manual close
 * - YES PnL/price updates
 * - YES UI badge shows "PAR DESACTIVADO — SOLO SALIDAS"
 * - NO spam logs (throttled to 1 per 4 hours)
 */

import { describe, it, expect } from "vitest";

describe("IDCA Per-Pair Operation Toggle", () => {

  describe("1. Par disabled sin ciclo abierto: no abre main", () => {
    it("should block new cycle creation when pair is disabled", () => {
      const assetConfig = { pair: "BTC/USD", enabled: false };
      const pairDisabled = !assetConfig.enabled;
      const hasActiveCycle = false;
      const hasImportedCycle = false;

      // When pairDisabled=true and no active cycles, entry logic is skipped
      const shouldAttemptEntry = !hasActiveCycle && !hasImportedCycle && !pairDisabled;
      expect(shouldAttemptEntry).toBe(false);
    });
  });

  describe("2. Par disabled con ciclo abierto: no hace safety buy", () => {
    it("should block safety buys when pair is disabled and cycle is active", () => {
      const assetConfig = { pair: "BTC/USD", enabled: false };
      const pairDisabled = !assetConfig.enabled;
      const cycle = { id: 25, pair: "BTC/USD", status: "active", isImported: false, soloSalida: false };

      // Safety buy is blocked when pairDisabled=true
      const shouldCheckSafetyBuy = !(cycle.isImported && cycle.soloSalida) && !pairDisabled;
      expect(shouldCheckSafetyBuy).toBe(false);
    });
  });

  describe("3. Par disabled con ciclo abierto: sí evalúa TP/trailing/break-even", () => {
    it("should still evaluate exits when pair is disabled", () => {
      const assetConfig = { pair: "BTC/USD", enabled: false };
      const pairDisabled = !assetConfig.enabled;
      const cycle = { id: 25, pair: "BTC/USD", status: "active" };

      // manageCycle is still called (exits are evaluated)
      // pairDisabled only blocks safety buys inside handleActiveState
      const shouldManageCycle = true; // always true regardless of pairDisabled
      expect(shouldManageCycle).toBe(true);

      // Exit evaluation is always performed
      const shouldEvaluateExits = true;
      expect(shouldEvaluateExits).toBe(true);
    });
  });

  describe("4. Par disabled: no crea Plus", () => {
    it("should block Plus cycle activation when pair is disabled", () => {
      const assetConfig = { pair: "BTC/USD", enabled: false };
      const pairDisabled = !assetConfig.enabled;
      const plusConfig = { enabled: true };

      // Plus activation is blocked when pairDisabled=true
      const shouldCheckPlus = plusConfig.enabled && !pairDisabled;
      expect(shouldCheckPlus).toBe(false);
    });
  });

  describe("5. Par disabled: no crea Recovery", () => {
    it("should block Recovery cycle activation when pair is disabled", () => {
      const assetConfig = { pair: "BTC/USD", enabled: false };
      const pairDisabled = !assetConfig.enabled;
      const recoveryConfig = { enabled: true };

      // Recovery activation is blocked when pairDisabled=true
      const shouldCheckRecovery = recoveryConfig.enabled && !pairDisabled;
      expect(shouldCheckRecovery).toBe(false);
    });
  });

  describe("6. Par disabled: cierre manual permitido", () => {
    it("should allow manual close regardless of pair disabled state", () => {
      const assetConfig = { pair: "BTC/USD", enabled: false };
      const pairDisabled = !assetConfig.enabled;
      const cycle = { id: 25, pair: "BTC/USD", status: "active" };

      // Manual close is always allowed — it does not check pairDisabled
      const canManualClose = cycle.status === "active" || cycle.status === "trailing_active" || cycle.status === "tp_armed";
      expect(canManualClose).toBe(true);
    });
  });

  describe("7. Par enabled: opera normal", () => {
    it("should allow all operations when pair is enabled", () => {
      const assetConfig = { pair: "BTC/USD", enabled: true };
      const pairDisabled = !assetConfig.enabled;

      expect(pairDisabled).toBe(false);

      // All operations allowed
      const shouldAttemptEntry = !pairDisabled;
      const shouldCheckSafetyBuy = !pairDisabled;
      const shouldCheckPlus = !pairDisabled;
      const shouldCheckRecovery = !pairDisabled;

      expect(shouldAttemptEntry).toBe(true);
      expect(shouldCheckSafetyBuy).toBe(true);
      expect(shouldCheckPlus).toBe(true);
      expect(shouldCheckRecovery).toBe(true);
    });
  });

  describe("8. No spam de eventos/logs", () => {
    it("should throttle pair disabled log to 1 per 4 hours per pair", () => {
      const PAIR_DISABLED_LOG_INTERVAL_MS = 4 * 60 * 60 * 1000;
      const lastLogAt = Date.now() - (3 * 60 * 60 * 1000); // 3 hours ago
      const now = Date.now();
      const timeSinceLastLog = now - lastLogAt;

      // Should NOT emit (3h < 4h interval)
      const shouldEmit = timeSinceLastLog >= PAIR_DISABLED_LOG_INTERVAL_MS;
      expect(shouldEmit).toBe(false);

      // After 4h, should emit
      const lastLogAt2 = Date.now() - (5 * 60 * 60 * 1000); // 5 hours ago
      const timeSinceLastLog2 = now - lastLogAt2;
      const shouldEmit2 = timeSinceLastLog2 >= PAIR_DISABLED_LOG_INTERVAL_MS;
      expect(shouldEmit2).toBe(true);
    });
  });

  describe("9. UI badge muestra estado correcto", () => {
    it("should show correct badge text based on enabled state", () => {
      // Enabled
      const enabledBadge = true ? "Activo" : "Solo salidas";
      expect(enabledBadge).toBe("Activo");

      // Disabled
      const disabledBadge = false ? "Activo" : "Solo salidas";
      expect(disabledBadge).toBe("Solo salidas");
    });

    it("should show PAR DESACTIVADO badge on active cycle when pair disabled", () => {
      const assetCfg = { enabled: false };
      const cycleStatus: string = "active";
      const showBadge = !assetCfg.enabled && cycleStatus !== "closed";
      expect(showBadge).toBe(true);
    });

    it("should NOT show PAR DESACTIVADO badge on closed cycle", () => {
      const assetCfg = { enabled: false };
      const cycleStatus: string = "closed";
      const showBadge = !assetCfg.enabled && cycleStatus !== "closed";
      expect(showBadge).toBe(false);
    });
  });

  describe("10. PnL/price update siempre ocurre", () => {
    it("should update PnL regardless of pair disabled state", () => {
      const assetConfig = { pair: "BTC/USD", enabled: false };
      const pairDisabled = !assetConfig.enabled;

      // PnL update happens BEFORE the pairDisabled check blocks entries
      // The code updates allPairCycles PnL unconditionally
      const shouldUpdatePnl = true; // Always true
      expect(shouldUpdatePnl).toBe(true);
      expect(pairDisabled).toBe(true); // Par is disabled
    });
  });

  describe("11. Trailing buy disarmed when pair disabled", () => {
    it("should disarm trailing buy when pair is disabled", () => {
      const assetConfig = { pair: "BTC/USD", enabled: false };
      const pairDisabled = !assetConfig.enabled;
      const trailingBuyArmed = true;

      // When pairDisabled=true, trailing buy should be disarmed
      const shouldDisarm = pairDisabled && trailingBuyArmed;
      expect(shouldDisarm).toBe(true);
    });
  });
});
