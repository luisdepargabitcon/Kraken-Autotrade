/**
 * GridModeLockService — Enforces safety conditions before allowing REAL modes.
 *
 * REAL_LIMITED and REAL_FULL are fully implemented but LOCKED by default.
 * They can only be unlocked when ALL safety conditions are met:
 *   1. Revolut X initialized and connected
 *   2. Revolut X has balance (BTC or USD)
 *   3. Reconciliation passed (no mismatches)
 *   4. Capital reserved and isolated
 *   5. Mode lock explicitly acknowledged by user
 *   6. Daily order limit respected
 *
 * SHADOW mode is always available (simulation only, no real orders).
 * OFF mode is always available.
 */

import { revolutXService } from "../exchanges/RevolutXService";
import { botLogger } from "../botLogger";
import type {
  GridMode,
  GridModeLock,
  ModeUnlockCheck,
} from "./gridIsolatedTypes";
import { REAL_MODE_UNLOCK_DEFAULTS } from "./gridIsolatedTypes";

class GridModeLockService {
  private acknowledged: boolean = false;
  private lastUnlockCheck: ModeUnlockCheck = { ...REAL_MODE_UNLOCK_DEFAULTS };

  /**
   * Check if a mode transition is allowed.
   * Returns GridModeLock with blocking reasons if not unlocked.
   */
  async checkModeTransition(
    currentMode: GridMode,
    requestedMode: GridMode
  ): Promise<GridModeLock> {
    const blockingReasons: string[] = [];

    // OFF and SHADOW are always allowed
    if (requestedMode === "OFF" || requestedMode === "SHADOW") {
      return {
        currentMode,
        requestedMode,
        unlocked: true,
        blockingReasons: [],
        checkedAt: new Date(),
      };
    }

    // REAL modes require all safety conditions
    const checks = await this.runUnlockChecks();

    if (!checks.revolutxInitialized) {
      blockingReasons.push("Revolut X no está inicializado o no conectado");
    }
    if (!checks.revolutxHasBalance) {
      blockingReasons.push("Revolut X no tiene balance disponible");
    }
    if (!checks.reconciliationPassed) {
      blockingReasons.push("Reconciliación pendiente o con diferencias sin verificar");
    }
    if (!checks.capitalReserved) {
      blockingReasons.push("Capital no reservado o no aislado");
    }
    if (!checks.modeLockAcknowledged) {
      blockingReasons.push("Mode lock no reconocido explícitamente por el usuario");
    }
    if (!checks.postOnlySupported) {
      blockingReasons.push("RevolutXService no tiene soporte post-only real confirmado — modos REAL bloqueados");
    }
    if (!checks.dailyOrderLimitRespected) {
      blockingReasons.push("Límite diario de órdenes excedido");
    }

    const unlocked = blockingReasons.length === 0;

    const lock: GridModeLock = {
      currentMode,
      requestedMode,
      unlocked,
      blockingReasons,
      checkedAt: new Date(),
    };

    if (unlocked) {
      await botLogger.info(
        "GRID_MODE_UNLOCK_GRANTED",
        `Mode transition ${currentMode} → ${requestedMode} unlocked`,
        { currentMode, requestedMode, checks }
      );
    } else {
      await botLogger.warn(
        "GRID_MODE_UNLOCK_DENIED",
        `Mode transition ${currentMode} → ${requestedMode} blocked: ${blockingReasons.join("; ")}`,
        { currentMode, requestedMode, blockingReasons, checks }
      );
    }

    return lock;
  }

  /**
   * Run all safety checks for REAL mode unlock.
   */
  async runUnlockChecks(): Promise<ModeUnlockCheck> {
    const checks: ModeUnlockCheck = { ...REAL_MODE_UNLOCK_DEFAULTS };

    // 1. Revolut X initialized
    checks.revolutxInitialized = revolutXService.isInitialized();

    // 2. Revolut X has balance
    if (checks.revolutxInitialized) {
      try {
        const balance = await revolutXService.getBalance();
        const hasUsd = (balance["USD"] || 0) > 0;
        const hasBtc = (balance["BTC"] || 0) > 0;
        checks.revolutxHasBalance = hasUsd || hasBtc;
      } catch {
        checks.revolutxHasBalance = false;
      }
    }

    // 3. Reconciliation — checked externally, default false until first run
    // This is set by the reconciliation runner via setReconciliationPassed()
    checks.reconciliationPassed = this.lastUnlockCheck.reconciliationPassed;

    // 4. Capital reserved — set externally by capital allocator
    checks.capitalReserved = this.lastUnlockCheck.capitalReserved;

    // 5. Mode lock acknowledged
    checks.modeLockAcknowledged = this.acknowledged;

    // 6. Daily order limit — set externally by engine
    checks.dailyOrderLimitRespected = this.lastUnlockCheck.dailyOrderLimitRespected;

    // 7. Post-only / allow-taker support — must be confirmed by the adapter.
    // Default false until RevolutXService explicitly reports support, so REAL modes
    // stay blocked if the capability is not confirmed.
    checks.postOnlySupported = (revolutXService as any).postOnlySupported === true;

    this.lastUnlockCheck = checks;
    return checks;
  }

  /**
   * User explicitly acknowledges the mode lock for REAL modes.
   * This is a deliberate safety action that must be confirmed.
   */
  async acknowledgeLock(): Promise<void> {
    this.acknowledged = true;
    this.lastUnlockCheck.modeLockAcknowledged = true;
    await botLogger.info(
      "GRID_MODE_UNLOCK_REQUESTED",
      "Mode lock acknowledged by user — REAL mode unlock checks will now pass this condition",
      { acknowledged: true }
    );
  }

  /**
   * Revoke acknowledgment (e.g. when switching back to OFF/SHADOW).
   */
  revokeAcknowledgment(): void {
    this.acknowledged = false;
    this.lastUnlockCheck.modeLockAcknowledged = false;
  }

  /**
   * Update reconciliation status from external runner.
   */
  setReconciliationPassed(passed: boolean): void {
    this.lastUnlockCheck.reconciliationPassed = passed;
  }

  /**
   * Update capital reserved status from external allocator.
   */
  setCapitalReserved(reserved: boolean): void {
    this.lastUnlockCheck.capitalReserved = reserved;
  }

  /**
   * Update daily order limit status from external engine.
   */
  setDailyOrderLimitRespected(respected: boolean): void {
    this.lastUnlockCheck.dailyOrderLimitRespected = respected;
  }

  /**
   * Get last unlock check snapshot (for API/UI display).
   */
  getLastUnlockCheck(): ModeUnlockCheck {
    return { ...this.lastUnlockCheck };
  }

  /**
   * Check if a specific mode is currently safe to enter without running full checks.
   * Uses cached state from lastUnlockCheck.
   */
  isModeSafe(mode: GridMode): boolean {
    if (mode === "OFF" || mode === "SHADOW") return true;
    return (
      this.lastUnlockCheck.revolutxInitialized &&
      this.lastUnlockCheck.revolutxHasBalance &&
      this.lastUnlockCheck.reconciliationPassed &&
      this.lastUnlockCheck.capitalReserved &&
      this.acknowledged &&
      this.lastUnlockCheck.dailyOrderLimitRespected &&
      this.lastUnlockCheck.postOnlySupported
    );
  }
}

export const gridModeLockService = new GridModeLockService();
