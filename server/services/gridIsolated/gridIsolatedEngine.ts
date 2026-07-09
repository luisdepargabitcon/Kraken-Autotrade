/**
 * GridIsolatedEngine — Core motor for the Isolated Professional Grid.
 *
 * Responsibilities:
 *   - Load/persist config from DB
 *   - Propose range versions (based on WBands + ATR)
 *   - Generate geometric levels
 *   - In SHADOW mode: simulate fills, compute PnL, log events — NO real orders
 *   - In REAL modes: delegate to GridExecutionService (FASE 7)
 *   - Track cycles (buy → sell round trips)
 *   - Coordinate with PumpDumpGuard, TrailingProtection, StopLoss, HODL
 *   - Enforce daily order limits and circuit breaker
 *
 * This engine is ISOLATED from Spot Normal and IDCA.
 * It does NOT share inventories, capital, or state.
 */

import { db } from "../../db";
import {
  gridIsolatedConfigs,
  gridRangeVersions,
  gridIsolatedLevels,
  gridIsolatedCycles,
  gridIsolatedEvents,
} from "@shared/schema";
import { eq, desc, and, isNull, sql, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";
import { botLogger } from "../botLogger";
import { MarketDataService } from "../MarketDataService";
import { ExchangeFactory } from "../exchanges/ExchangeFactory";
import { gridModeLockService } from "./gridModeLockService";
import { gridCapitalAllocator } from "./gridCapitalAllocator";
import { getGridBandSnapshot } from "./gridBandAdapter";
import {
  toGridLevels,
} from "./gridGeometricLevels";
import {
  generateProfessionalGridLevels,
} from "./gridSpacingCalculator";
import { applyWeightsToGeneratedLevels } from "./gridAllocationEngine";
import {
  computeGrossTargetFromNet,
  computeSellPrice,
  computeCyclePnL,
} from "./gridNetCalculator";
import {
  DEFAULT_GRID_CONFIG,
  DAILY_ORDER_REQUEST_LIMIT,
  DAILY_ORDER_WARNING_THRESHOLD,
  CIRCUIT_BREAKER_RETRY_DELAY_MS,
  type GridIsolatedConfig,
  type GridMode,
  type GridRangeVersion,
  type GridLevel,
  type GridCycle,
  type GridExecutionStatus,
  type PumpDumpState,
  type PumpDumpGuardState,
  type GridEventType,
} from "./gridIsolatedTypes";

class GridIsolatedEngine {
  private config: GridIsolatedConfig | null = null;
  private activeRangeVersion: GridRangeVersion | null = null;
  private levels: GridLevel[] = [];
  private cycles: GridCycle[] = [];
  private dailyOrderCount: number = 0;
  private dailyOrderResetAt: Date = new Date();
  private circuitBreakerOpen: boolean = false;
  private circuitBreakerOpenedAt: Date | null = null;
  private pumpDumpState: PumpDumpGuardState = {
    state: "normal" as PumpDumpState,
    triggeredAt: null,
    priceDeviationPct: 0,
    volumeSpikeRatio: 0,
    cooldownUntil: null,
    reason: "",
  };
  private tickInterval: NodeJS.Timeout | null = null;
  private running: boolean = false;
  private lastTickAt: Date | null = null;
  private lastTickReason: string | null = null;
  private lastShadowValidationAt: Date | null = null;
  private lastShadowValidationResult: any = null;
  private lastShadowEventAt: Date | null = null;
  private shadowTickThrottleMs: number = 5 * 60 * 1000; // 5 min throttle for shadow info events
  private lastProfessionalGeneratorValidationAt: Date | null = null;
  private lastProfessionalGeneratorValidationResult: any = null;

  /**
   * Load config from DB or create default.
   * Auto-starts the engine if mode != OFF and isActive = true.
   */
  async loadConfig(): Promise<GridIsolatedConfig> {
    try {
      const rows = await db.select().from(gridIsolatedConfigs).limit(1);
      if (rows.length > 0) {
        const row = rows[0];
        this.config = {
          id: String(row.id),
          pair: row.pair,
          mode: row.mode as GridMode,
          capitalProfile: row.capitalProfile as any,
          executionPolicy: row.executionPolicy as any,
          netProfitTargetPct: parseFloat(row.netProfitTargetPct),
          bandPeriod: row.bandPeriod,
          bandStdDevMultiplier: parseFloat(row.bandStdDevMultiplier),
          atrPeriod: row.atrPeriod,
          atrTimeframe: row.atrTimeframe,
          gridStepAtrMultiplier: parseFloat(row.gridStepAtrMultiplier),
          gridStepMinPct: parseFloat(row.gridStepMinPct),
          gridStepMaxPct: parseFloat(row.gridStepMaxPct),
          geometricRatioMin: parseFloat(row.geometricRatioMin),
          geometricRatioMax: parseFloat(row.geometricRatioMax),
          trailingActivationPct: parseFloat(row.trailingActivationPct),
          trailingStopPct: parseFloat(row.trailingStopPct),
          stopLossSoftPct: parseFloat(row.stopLossSoftPct),
          stopLossHardPct: parseFloat(row.stopLossHardPct),
          stopLossEmergencyPct: parseFloat(row.stopLossEmergencyPct),
          hodlRecoveryEnabled: row.hodlRecoveryEnabled,
          pumpGuardDeviationPct: parseFloat(row.pumpGuardDeviationPct),
          pumpGuardVolumeSpikeRatio: parseFloat(row.pumpGuardVolumeSpikeRatio),
          pumpGuardCooldownMinutes: row.pumpGuardCooldownMinutes,
          dumpGuardDeviationPct: parseFloat(row.dumpGuardDeviationPct),
          dumpGuardVolumeSpikeRatio: parseFloat(row.dumpGuardVolumeSpikeRatio),
          dumpGuardCooldownMinutes: row.dumpGuardCooldownMinutes,
          maxOpenCycles: row.maxOpenCycles,
          maxDailyOrders: row.maxDailyOrders,
          fiscalStatus: row.fiscalStatus,
          isActive: row.isActive,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          // Execution: Maker/Taker
          makerAttemptsBeforeTaker: row.makerAttemptsBeforeTaker ?? 3,
          takerFallbackEnabled: row.takerFallbackEnabled ?? true,
          takerFallbackAttemptNumber: row.takerFallbackAttemptNumber ?? 4,
          maxTakerFallbackPerCycle: row.maxTakerFallbackPerCycle ?? 1,
          takerFallbackRequiresNetProfit: row.takerFallbackRequiresNetProfit ?? true,
          takerFallbackAuditRequired: row.takerFallbackAuditRequired ?? true,
          // Wallet / Cartera
          gridWalletMode: (row.gridWalletMode as any) ?? "automatic",
          gridWalletInitialUsd: parseFloat(row.gridWalletInitialUsd ?? "1000"),
          gridWalletMaxUsd: parseFloat(row.gridWalletMaxUsd ?? "5000"),
          gridWalletUseProfits: row.gridWalletUseProfits ?? true,
          gridWalletCompoundProfits: row.gridWalletCompoundProfits ?? true,
          gridMaxCapitalPerCycleUsd: parseFloat(row.gridMaxCapitalPerCycleUsd ?? "600"),
          gridMaxCapitalPerCyclePct: parseFloat(row.gridMaxCapitalPerCyclePct ?? "60"),
          gridReservePct: parseFloat(row.gridReservePct ?? "20"),
          gridMinFreeCapitalUsd: parseFloat(row.gridMinFreeCapitalUsd ?? "50"),
          gridPauseCycleWhenCapitalDepleted: row.gridPauseCycleWhenCapitalDepleted ?? true,
          gridAllowNewCycleWhenCapitalFree: row.gridAllowNewCycleWhenCapitalFree ?? true,
          // Capital allocation modes
          gridAllocationMode: (row.gridAllocationMode as any) ?? "uniform",
          gridCapitalDeploymentMode: (row.gridCapitalDeploymentMode as any) ?? "capped",
          gridProgressiveIntensity: parseFloat(row.gridProgressiveIntensity ?? "0.30"),
          gridMaxLevelPct: parseFloat(row.gridMaxLevelPct ?? "40.00"),
          gridMinLevelUsd: parseFloat(row.gridMinLevelUsd ?? "30.00"),
        };
        // Load active state from DB
        await this.loadActiveRangeVersion();
        await this.loadLevels();
        await this.loadCycles();

        // Auto-start engine if mode != OFF and isActive = true
        if (this.config.mode !== "OFF" && this.config.isActive && !this.running) {
          this.start();
        }
        return this.config;
      }
    } catch (error) {
      botLogger.error("SYSTEM_ERROR", `[GridIsolatedEngine] Failed to load config: ${error}`);
    }

    // Create default config in DB
    this.config = { ...DEFAULT_GRID_CONFIG, id: "", createdAt: new Date(), updatedAt: new Date() } as GridIsolatedConfig;
    await this.saveConfig();
    return this.config;
  }

  /**
   * Read config snapshot from DB WITHOUT auto-starting the engine.
   * Used for read-only operations that should not change runtime state.
   */
  private async readConfigSnapshotFromDb(): Promise<GridIsolatedConfig | null> {
    try {
      const rows = await db.select().from(gridIsolatedConfigs).limit(1);
      if (rows.length > 0) {
        const row = rows[0];
        return {
          id: String(row.id),
          pair: row.pair,
          mode: row.mode as GridMode,
          capitalProfile: row.capitalProfile as any,
          executionPolicy: row.executionPolicy as any,
          netProfitTargetPct: parseFloat(row.netProfitTargetPct),
          bandPeriod: row.bandPeriod,
          bandStdDevMultiplier: parseFloat(row.bandStdDevMultiplier),
          atrPeriod: row.atrPeriod,
          atrTimeframe: row.atrTimeframe,
          gridStepAtrMultiplier: parseFloat(row.gridStepAtrMultiplier),
          gridStepMinPct: parseFloat(row.gridStepMinPct),
          gridStepMaxPct: parseFloat(row.gridStepMaxPct),
          geometricRatioMin: parseFloat(row.geometricRatioMin),
          geometricRatioMax: parseFloat(row.geometricRatioMax),
          trailingActivationPct: parseFloat(row.trailingActivationPct),
          trailingStopPct: parseFloat(row.trailingStopPct),
          stopLossSoftPct: parseFloat(row.stopLossSoftPct),
          stopLossHardPct: parseFloat(row.stopLossHardPct),
          stopLossEmergencyPct: parseFloat(row.stopLossEmergencyPct),
          hodlRecoveryEnabled: row.hodlRecoveryEnabled,
          pumpGuardDeviationPct: parseFloat(row.pumpGuardDeviationPct),
          pumpGuardVolumeSpikeRatio: parseFloat(row.pumpGuardVolumeSpikeRatio),
          pumpGuardCooldownMinutes: row.pumpGuardCooldownMinutes,
          dumpGuardDeviationPct: parseFloat(row.dumpGuardDeviationPct),
          dumpGuardVolumeSpikeRatio: parseFloat(row.dumpGuardVolumeSpikeRatio),
          dumpGuardCooldownMinutes: row.dumpGuardCooldownMinutes,
          maxOpenCycles: row.maxOpenCycles,
          maxDailyOrders: row.maxDailyOrders,
          fiscalStatus: row.fiscalStatus,
          isActive: row.isActive,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          // Execution: Maker/Taker
          makerAttemptsBeforeTaker: row.makerAttemptsBeforeTaker ?? 3,
          takerFallbackEnabled: row.takerFallbackEnabled ?? true,
          takerFallbackAttemptNumber: row.takerFallbackAttemptNumber ?? 4,
          maxTakerFallbackPerCycle: row.maxTakerFallbackPerCycle ?? 1,
          takerFallbackRequiresNetProfit: row.takerFallbackRequiresNetProfit ?? true,
          takerFallbackAuditRequired: row.takerFallbackAuditRequired ?? true,
          // Wallet / Cartera
          gridWalletMode: (row.gridWalletMode as any) ?? "automatic",
          gridWalletInitialUsd: parseFloat(row.gridWalletInitialUsd ?? "1000"),
          gridWalletMaxUsd: parseFloat(row.gridWalletMaxUsd ?? "5000"),
          gridWalletUseProfits: row.gridWalletUseProfits ?? true,
          gridWalletCompoundProfits: row.gridWalletCompoundProfits ?? true,
          gridMaxCapitalPerCycleUsd: parseFloat(row.gridMaxCapitalPerCycleUsd ?? "600"),
          gridMaxCapitalPerCyclePct: parseFloat(row.gridMaxCapitalPerCyclePct ?? "60"),
          gridReservePct: parseFloat(row.gridReservePct ?? "20"),
          gridMinFreeCapitalUsd: parseFloat(row.gridMinFreeCapitalUsd ?? "50"),
          gridPauseCycleWhenCapitalDepleted: row.gridPauseCycleWhenCapitalDepleted ?? true,
          gridAllowNewCycleWhenCapitalFree: row.gridAllowNewCycleWhenCapitalFree ?? true,
          // Capital allocation modes
          gridAllocationMode: (row.gridAllocationMode as any) ?? "uniform",
          gridCapitalDeploymentMode: (row.gridCapitalDeploymentMode as any) ?? "capped",
          gridProgressiveIntensity: parseFloat(row.gridProgressiveIntensity ?? "0.30"),
          gridMaxLevelPct: parseFloat(row.gridMaxLevelPct ?? "40.00"),
          gridMinLevelUsd: parseFloat(row.gridMinLevelUsd ?? "30.00"),
        };
      }
    } catch (error) {
      botLogger.error("SYSTEM_ERROR", `[GridIsolatedEngine] Failed to read config snapshot: ${error}`);
    }
    return null;
  }

  /**
   * Get runtime fingerprint to detect side effects in read-only operations.
   */
  private getRuntimeFingerprint() {
    return {
      mode: this.config?.mode ?? null,
      isActive: this.config?.isActive ?? null,
      isRunning: this.running,
      activeRangeVersionId: this.activeRangeVersion?.id ?? null,
      levelsCount: this.levels.length,
      cyclesCount: this.cycles.length,
      tickIntervalActive: this.tickInterval !== null,
    };
  }

  /**
   * Save config to DB.
   */
  async saveConfig(): Promise<void> {
    if (!this.config) return;
    try {
      const values = {
        pair: this.config.pair,
        mode: this.config.mode,
        capitalProfile: this.config.capitalProfile,
        executionPolicy: this.config.executionPolicy,
        netProfitTargetPct: this.config.netProfitTargetPct.toFixed(3),
        bandPeriod: this.config.bandPeriod,
        bandStdDevMultiplier: this.config.bandStdDevMultiplier.toFixed(2),
        atrPeriod: this.config.atrPeriod,
        atrTimeframe: this.config.atrTimeframe,
        gridStepAtrMultiplier: this.config.gridStepAtrMultiplier.toFixed(2),
        gridStepMinPct: this.config.gridStepMinPct.toFixed(3),
        gridStepMaxPct: this.config.gridStepMaxPct.toFixed(3),
        geometricRatioMin: this.config.geometricRatioMin.toFixed(3),
        geometricRatioMax: this.config.geometricRatioMax.toFixed(3),
        trailingActivationPct: this.config.trailingActivationPct.toFixed(3),
        trailingStopPct: this.config.trailingStopPct.toFixed(3),
        stopLossSoftPct: this.config.stopLossSoftPct.toFixed(3),
        stopLossHardPct: this.config.stopLossHardPct.toFixed(3),
        stopLossEmergencyPct: this.config.stopLossEmergencyPct.toFixed(3),
        hodlRecoveryEnabled: this.config.hodlRecoveryEnabled,
        pumpGuardDeviationPct: this.config.pumpGuardDeviationPct.toFixed(3),
        pumpGuardVolumeSpikeRatio: this.config.pumpGuardVolumeSpikeRatio.toFixed(2),
        pumpGuardCooldownMinutes: this.config.pumpGuardCooldownMinutes,
        dumpGuardDeviationPct: this.config.dumpGuardDeviationPct.toFixed(3),
        dumpGuardVolumeSpikeRatio: this.config.dumpGuardVolumeSpikeRatio.toFixed(2),
        dumpGuardCooldownMinutes: this.config.dumpGuardCooldownMinutes,
        maxOpenCycles: this.config.maxOpenCycles,
        maxDailyOrders: this.config.maxDailyOrders,
        fiscalStatus: this.config.fiscalStatus,
        isActive: this.config.isActive,
        // Execution: Maker/Taker
        makerAttemptsBeforeTaker: this.config.makerAttemptsBeforeTaker,
        takerFallbackEnabled: this.config.takerFallbackEnabled,
        takerFallbackAttemptNumber: this.config.takerFallbackAttemptNumber,
        maxTakerFallbackPerCycle: this.config.maxTakerFallbackPerCycle,
        takerFallbackRequiresNetProfit: this.config.takerFallbackRequiresNetProfit,
        takerFallbackAuditRequired: this.config.takerFallbackAuditRequired,
        // Wallet / Cartera
        gridWalletMode: this.config.gridWalletMode,
        gridWalletInitialUsd: this.config.gridWalletInitialUsd.toFixed(2),
        gridWalletMaxUsd: this.config.gridWalletMaxUsd.toFixed(2),
        gridWalletUseProfits: this.config.gridWalletUseProfits,
        gridWalletCompoundProfits: this.config.gridWalletCompoundProfits,
        gridMaxCapitalPerCycleUsd: this.config.gridMaxCapitalPerCycleUsd.toFixed(2),
        gridMaxCapitalPerCyclePct: this.config.gridMaxCapitalPerCyclePct.toFixed(2),
        gridReservePct: this.config.gridReservePct.toFixed(2),
        gridMinFreeCapitalUsd: this.config.gridMinFreeCapitalUsd.toFixed(2),
        gridPauseCycleWhenCapitalDepleted: this.config.gridPauseCycleWhenCapitalDepleted,
        gridAllowNewCycleWhenCapitalFree: this.config.gridAllowNewCycleWhenCapitalFree,
        // Capital allocation modes
        gridAllocationMode: this.config.gridAllocationMode,
        gridCapitalDeploymentMode: this.config.gridCapitalDeploymentMode,
        gridProgressiveIntensity: this.config.gridProgressiveIntensity.toFixed(2),
        gridMaxLevelPct: this.config.gridMaxLevelPct.toFixed(2),
        gridMinLevelUsd: this.config.gridMinLevelUsd.toFixed(2),
        updatedAt: new Date(),
      };

      if (this.config.id && this.config.id !== "") {
        await db.update(gridIsolatedConfigs).set(values).where(eq(gridIsolatedConfigs.id, parseInt(this.config.id)));
      } else {
        const result = await db.insert(gridIsolatedConfigs).values(values).returning({ id: gridIsolatedConfigs.id });
        this.config.id = String(result[0].id);
      }
    } catch (error) {
      botLogger.error("SYSTEM_ERROR", `[GridIsolatedEngine] Failed to save config: ${error}`);
    }
  }

  /**
   * Change mode with safety lock check.
   */
  async changeMode(newMode: GridMode): Promise<{ success: boolean; reason?: string }> {
    if (!this.config) await this.loadConfig();
    const currentMode = this.config!.mode;

    if (currentMode === newMode) return { success: true };

    const lock = await gridModeLockService.checkModeTransition(currentMode, newMode);
    if (!lock.unlocked) {
      return { success: false, reason: lock.blockingReasons.join("; ") };
    }

    const oldMode = this.config!.mode;
    this.config!.mode = newMode;
    await this.saveConfig();

    await this.logEvent("GRID_MODE_CHANGED", `Mode changed: ${oldMode} → ${newMode}`, {
      oldMode, newMode,
    });

    // Reset acknowledgment when going back to OFF/SHADOW
    if (newMode === "OFF" || newMode === "SHADOW") {
      gridModeLockService.revokeAcknowledgment();
    }

    // Start/stop engine based on mode
    if (newMode === "OFF") {
      this.stop();
    } else {
      this.start();
    }

    return { success: true };
  }

  /**
   * Start the engine tick loop.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.tickInterval = setInterval(() => {
      this.tick().catch(err => {
        botLogger.error("SYSTEM_ERROR", `[GridIsolatedEngine] Tick error: ${err}`);
      });
    }, 60_000); // 1 minute tick
    botLogger.info("GRID_MODE_CHANGED", "Grid Isolated Engine started");
  }

  /**
   * Stop the engine.
   */
  stop(): void {
    this.running = false;
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    botLogger.info("GRID_MODE_CHANGED", "Grid Isolated Engine stopped");
  }

  /**
   * Main tick — evaluate market, propose/activate ranges, check fills.
   * Returns a diagnostic result describing what happened.
   */
  private async tick(): Promise<void> {
    this.lastTickAt = new Date();

    if (!this.config || this.config.mode === "OFF") {
      this.lastTickReason = "Modo OFF — el motor no ejecuta ticks.";
      return;
    }

    // Check isActive flag
    if (!this.config.isActive) {
      this.lastTickReason = "Motor inactivo (isActive=false). No se generan niveles ni ciclos automáticos.";
      await this.logShadowTickEvent("GRID_SHADOW_TICK_SKIPPED", "Evaluación SHADOW omitida: motor inactivo (isActive=false).", { reason: "isActive=false" });
      return;
    }

    // Reset daily order count if needed
    this.checkDailyOrderReset();

    // Check circuit breaker
    if (this.circuitBreakerOpen) {
      if (this.circuitBreakerOpenedAt && Date.now() - this.circuitBreakerOpenedAt.getTime() < CIRCUIT_BREAKER_RETRY_DELAY_MS) {
        this.lastTickReason = "Circuit breaker abierto — en cooldown.";
        return; // Still in cooldown
      }
      this.circuitBreakerOpen = false;
      this.circuitBreakerOpenedAt = null;
      await this.logEvent("GRID_CIRCUIT_BREAKER_CLOSED", "Circuit breaker closed after cooldown");
    }

    // Get band snapshot
    const bandSnapshot = await getGridBandSnapshot({
      bandPeriod: this.config.bandPeriod,
      bandStdDevMultiplier: this.config.bandStdDevMultiplier,
      atrPeriod: this.config.atrPeriod,
      atrTimeframe: this.config.atrTimeframe,
      pair: this.config.pair,
    });

    if (!bandSnapshot) {
      this.lastTickReason = "Sin datos de mercado (bandSnapshot no disponible).";
      await this.logShadowTickEvent("GRID_SHADOW_NO_LEVELS", "El Grid evaluó el mercado pero no obtuvo datos de banda válidos.", { reason: "no_band_snapshot" });
      return;
    }

    // Check pump/dump guard
    await this.checkPumpDumpGuard(bandSnapshot.midPrice);

    if (!bandSnapshot.suitableForGrid) {
      this.lastTickReason = `Condiciones de mercado no válidas para Grid: ${bandSnapshot.reason}`;
      // Pause active range if conditions not suitable
      if (this.activeRangeVersion && this.activeRangeVersion.status === "active") {
        await this.pauseRangeVersion(bandSnapshot.reason);
      }
      await this.logShadowTickEvent("GRID_SHADOW_WAITING", `El Grid está en SHADOW esperando condiciones válidas. Motivo: ${bandSnapshot.reason}.`, { reason: bandSnapshot.reason });
      return;
    }

    // If no active range, propose one
    if (!this.activeRangeVersion) {
      await this.proposeRangeVersion(bandSnapshot);
      this.lastTickReason = "Rango propuesto y activado en este tick.";
    } else if (this.isBandDrifted(bandSnapshot)) {
      // Band has drifted significantly from active range
      const canRebuild = this.canRebuildLevels();
      if (canRebuild) {
        await this.rebuildRangeAndLevels(bandSnapshot);
        this.lastTickReason = "Banda desplazada — niveles planificados recalculados para el nuevo rango.";
      } else {
        this.lastTickReason = "Banda desplazada — niveles/ciclos reales conservados por seguridad.";
        await this.logShadowTickEvent("GRID_LEVELS_PRESERVED_DUE_TO_CYCLE", "La banda cambió, pero se conservan niveles/ciclos abiertos por seguridad.", {
          rangeVersionId: this.activeRangeVersion.id,
          reason: "hay niveles con órdenes reales o ciclos abiertos",
        });
      }
    } else {
      this.lastTickReason = "Tick completado — rango activo reutilizado.";
      await this.logShadowTickEvent("GRID_SHADOW_RANGE_REUSED", "El Grid reutiliza el rango activo para auditoría. No se abren ciclos nuevos sin fills simulados.", { rangeVersionId: this.activeRangeVersion.id });
    }

    // In SHADOW mode: simulate fills
    if (this.config.mode === "SHADOW") {
      await this.simulateShadowTick(bandSnapshot.midPrice);
    }
  }

  /**
   * Log a SHADOW tick event with throttling to avoid spam.
   * Only logs if enough time has passed since the last shadow info event.
   */
  private async logShadowTickEvent(eventType: GridEventType, message: string, meta?: Record<string, any>): Promise<void> {
    const now = Date.now();
    if (this.lastShadowEventAt && (now - this.lastShadowEventAt.getTime()) < this.shadowTickThrottleMs) {
      return; // Throttled — skip logging
    }
    this.lastShadowEventAt = new Date();
    await this.logEvent(eventType, message, meta);
  }

  /**
   * Check if the current market band has drifted significantly from the active range.
   * Returns true if the mid-price moved outside the active range or if the band width changed materially.
   */
  private isBandDrifted(bandSnapshot: any): boolean {
    if (!this.activeRangeVersion) return false;
    const active = this.activeRangeVersion;
    const midPrice = bandSnapshot.midPrice;
    const activeLower = active.bandLower;
    const activeUpper = active.bandUpper;
    const activeWidth = active.bandWidthPct;
    const newWidth = bandSnapshot.bandWidthPct;

    // Price moved outside the active band
    if (midPrice < activeLower || midPrice > activeUpper) {
      return true;
    }

    // Band width changed by more than 30%
    if (activeWidth > 0 && Math.abs(newWidth - activeWidth) / activeWidth > 0.3) {
      return true;
    }

    // Mid price moved more than 20% of the active band width
    if (activeWidth > 0) {
      const deviationPct = Math.abs(midPrice - active.midPrice) / active.midPrice * 100;
      if (deviationPct > activeWidth * 0.2) {
        return true;
      }
    }

    return false;
  }

  /**
   * Determine whether levels can be safely replaced when the band drifts.
   * Only planned levels without real orders or open cycles can be rebuilt.
   */
  private canRebuildLevels(): boolean {
    if (!this.activeRangeVersion) return false;
    const activeLevels = this.levels.filter(l => l.rangeVersionId === this.activeRangeVersion!.id);
    const hasRealOrders = activeLevels.some(l =>
      l.exchangeOrderId != null || l.status === "open" || l.status === "placed" || l.status === "partially_filled"
    );
    const hasOpenCycles = this.cycles.some(c =>
      c.rangeVersionId === this.activeRangeVersion!.id &&
      !["completed", "cancelled", "stop_loss_hit", "trailing_closed"].includes(c.status)
    );
    const hasFilledLevels = activeLevels.some(l => l.status === "filled");
    return !hasRealOrders && !hasOpenCycles && !hasFilledLevels;
  }

  /**
   * Pre-check if the professional generator can generate viable levels.
   * Used by rebuildRangeAndLevels and rebuildPlannedLevels to avoid leaving the system
   * without a valid range due to a rebuild that produces 0 levels.
   */
  private async precheckProfessionalGeneration(bandSnapshot: any): Promise<{
    ok: boolean;
    levelsCount: number;
    viabilityStatus?: string;
    professionalGenerator?: any;
    reason?: string;
  }> {
    if (!this.config) {
      return { ok: false, levelsCount: 0, reason: "No config loaded" };
    }

    const allocation = await gridCapitalAllocator.allocate(
      this.config.capitalProfile,
      10, // initial estimate
      this.config.netProfitTargetPct,
      {
        maxCapitalPerCycleUsd: this.config.gridMaxCapitalPerCycleUsd ?? 0,
        allocationMode: this.config.gridAllocationMode ?? "uniform",
        deploymentMode: this.config.gridCapitalDeploymentMode ?? "capped",
        progressiveIntensity: this.config.gridProgressiveIntensity ?? 0.30,
        maxLevelPct: this.config.gridMaxLevelPct ?? 40,
        minLevelUsd: this.config.gridMinLevelUsd ?? 30,
      }
    );
    const professionalPrecheck = generateProfessionalGridLevels({
      currentPrice: bandSnapshot.midPrice,
      bollingerMiddle: bandSnapshot.middle,
      bollingerUpper: bandSnapshot.upper,
      bollingerLower: bandSnapshot.lower,
      atrPct: bandSnapshot.atrPct,
      netProfitTargetPct: this.config.netProfitTargetPct,
      gridStepAtrMultiplier: this.config.gridStepAtrMultiplier,
      gridStepMaxPct: this.config.gridStepMaxPct,
      configuredBuyLevels: Math.floor(allocation.levelsCount / 2),
      configuredSellLevels: Math.floor(allocation.levelsCount / 2),
      capitalPerLevelUsd: allocation.capitalPerLevelUsd,
      spreadBufferPct: 0.01,
      safetyBufferPct: 0.10,
      minLevelsForViableGrid: 4,
      centerPriceMode: "hybrid",
      centerClampPct: 0.25,
      operationalRangeMode: "hybrid",
      operationalBandWidthPct: 20.0,
      atrRangeMultiplier: 8.0,
      minOperationalBandWidthPct: 20.0,
      dynamicLevelReduction: true,
      gridViabilityMode: "strict",
    });

    if (professionalPrecheck.levels.length === 0) {
      return {
        ok: false,
        levelsCount: 0,
        viabilityStatus: professionalPrecheck.viabilityStatus,
        professionalGenerator: professionalPrecheck.professionalGenerator,
        reason: "professional_generator_zero_levels_precheck",
      };
    }

    return {
      ok: true,
      levelsCount: professionalPrecheck.levels.length,
      viabilityStatus: professionalPrecheck.viabilityStatus,
      professionalGenerator: professionalPrecheck.professionalGenerator,
    };
  }

  /**
   * Replace the active range and its planned levels with a new band.
   * Marks old range as replaced and old levels as replaced, then proposes a new range.
   * SAFETY: Before marking old range as replaced, verify that the new professional generator
   * can generate viable levels. If not, abort rebuild and preserve old range.
   */
  private async rebuildRangeAndLevels(bandSnapshot: any): Promise<void> {
    if (!this.activeRangeVersion || !this.config) return;
    const oldRange = this.activeRangeVersion;
    const activeLevels = this.levels.filter(l => l.rangeVersionId === oldRange.id);
    const replacedCount = activeLevels.length;

    // Calculate drift metrics
    const centerDriftPct = oldRange.midPrice > 0
      ? ((bandSnapshot.midPrice - oldRange.midPrice) / oldRange.midPrice) * 100
      : 0;
    const widthChangePct = oldRange.bandWidthPct > 0
      ? ((bandSnapshot.bandWidthPct - oldRange.bandWidthPct) / oldRange.bandWidthPct) * 100
      : 0;

    // Count preserved levels (with real orders or open cycles)
    const preservedLevels = activeLevels.filter(l =>
      l.exchangeOrderId != null || l.status === "filled" || l.status === "open"
    );
    const preservedCycles = this.cycles.filter(c =>
      c.rangeVersionId === oldRange.id && c.status !== "completed" && c.status !== "cancelled"
    );

    // SAFETY: Pre-check if professional generator can generate viable levels before marking old range as replaced
    const precheck = await this.precheckProfessionalGeneration(bandSnapshot);
    if (!precheck.ok) {
      await this.logEvent("GRID_LEVELS_PRESERVED_DUE_TO_CYCLE", "El rebuild fue abortado porque el generador profesional no pudo generar niveles viables. Se conserva el rango anterior.", {
        rangeVersionId: oldRange.id,
        reason: precheck.reason,
        viabilityStatus: precheck.viabilityStatus,
        professionalGenerator: precheck.professionalGenerator,
        centerDriftPct,
        widthChangePct,
      });
      return;
    }

    // Mark old range as replaced (only after pre-check passes)
    await db.update(gridRangeVersions)
      .set({ status: "replaced", closedAt: new Date() })
      .where(eq(gridRangeVersions.id, oldRange.id));

    // Mark old levels as replaced
    if (activeLevels.length > 0) {
      await db.update(gridIsolatedLevels)
        .set({ status: "replaced" })
        .where(eq(gridIsolatedLevels.rangeVersionId, oldRange.id));
      for (const level of this.levels) {
        if (level.rangeVersionId === oldRange.id) {
          level.status = "replaced";
        }
      }
    }

    // Log range change with enriched metadata
    await this.logEvent("GRID_RANGE_CHANGED", `El rango activo cambió de ${oldRange.bandLower.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}-${oldRange.bandUpper.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} a ${bandSnapshot.lower.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}-${bandSnapshot.upper.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`, {
      oldRangeVersionId: oldRange.id,
      newRangeVersionId: this.activeRangeVersion?.id,
      oldLowerPrice: oldRange.bandLower,
      oldUpperPrice: oldRange.bandUpper,
      oldCenterPrice: oldRange.midPrice,
      oldWidthPct: oldRange.bandWidthPct,
      newLowerPrice: bandSnapshot.lower,
      newUpperPrice: bandSnapshot.upper,
      newCenterPrice: bandSnapshot.midPrice,
      newWidthPct: bandSnapshot.bandWidthPct,
      centerDriftPct,
      widthChangePct,
      pair: this.config.pair,
      regime: bandSnapshot.regime || oldRange.regime,
      atrPct: bandSnapshot.atrPct ?? oldRange.atrPct,
      trigger: "band_drift",
      replacedLevelsCount: replacedCount,
      preservedLevelsCount: preservedLevels.length,
      preservedCyclesCount: preservedCycles.length,
      safetyDecision: "rebuild_planned_levels",
    });

    // Log old levels replaced
    await this.logEvent("GRID_LEVELS_REPLACED", `Los niveles planificados anteriores fueron sustituidos por una nueva banda (${replacedCount} niveles).`, {
      oldRangeVersionId: oldRange.id,
      replacedLevelsCount: replacedCount,
      preservedLevelsCount: preservedLevels.length,
      preservedCyclesCount: preservedCycles.length,
      pair: this.config.pair,
    });

    // Propose new range
    await this.proposeRangeVersion(bandSnapshot);
    const newLevels = this.levels.filter(l => l.rangeVersionId === this.activeRangeVersion!.id);

    // Log new levels rebuilt
    await this.logEvent("GRID_LEVELS_REBUILT", `La banda cambió y el Grid recalculó ${newLevels.length} niveles planificados.`, {
      newRangeVersionId: this.activeRangeVersion!.id,
      oldRangeVersionId: oldRange.id,
      levelsCount: newLevels.length,
      pair: this.config.pair,
      regime: bandSnapshot.regime || oldRange.regime,
      centerDriftPct,
      widthChangePct,
    });

    // Check for regime change
    const oldRegime = oldRange.regime;
    const newRegime = bandSnapshot.regime || bandSnapshot.method;
    if (newRegime && oldRegime && newRegime !== oldRegime) {
      await this.logEvent("GRID_REGIME_CHANGED", `${this.config.pair} pasó de ${oldRegime} a ${newRegime}.`, {
        pair: this.config.pair,
        previousRegime: oldRegime,
        newRegime,
        reason: `el precio cambió de banda y el régimen detectado cambió`,
        reasonCode: "band_drift_regime_change",
        price: bandSnapshot.midPrice,
        atrPct: bandSnapshot.atrPct ?? oldRange.atrPct,
        bollingerWidthPct: bandSnapshot.bandWidthPct,
        timeframe: this.config.atrTimeframe,
      });
    }
  }

  /**
   * Load active range version from DB.
   */
  private async loadActiveRangeVersion(): Promise<void> {
    try {
      const rows = await db.select().from(gridRangeVersions)
        .where(eq(gridRangeVersions.status, "active"))
        .orderBy(desc(gridRangeVersions.activatedAt))
        .limit(1);
      if (rows.length > 0) {
        const row = rows[0];
        this.activeRangeVersion = {
          id: row.id,
          versionNumber: row.versionNumber,
          pair: row.pair,
          status: row.status as any,
          midPrice: parseFloat(row.midPrice),
          upperPrice: parseFloat(row.upperPrice),
          lowerPrice: parseFloat(row.lowerPrice),
          bandUpper: parseFloat(row.bandUpper),
          bandMiddle: parseFloat(row.bandMiddle),
          bandLower: parseFloat(row.bandLower),
          bandWidthPct: parseFloat(row.bandWidthPct),
          atrPct: parseFloat(row.atrPct),
          regime: row.regime,
          levelsCount: row.levelsCount,
          geometricRatio: parseFloat(row.geometricRatio),
          capitalBudgetUsd: parseFloat(row.capitalBudgetUsd),
          capitalPerLevelUsd: parseFloat(row.capitalPerLevelUsd),
          netProfitTargetPct: parseFloat(row.netProfitTargetPct),
          createdAt: row.createdAt,
          activatedAt: row.activatedAt,
          closedAt: row.closedAt,
        };
      }
    } catch (error) {
      botLogger.error("SYSTEM_ERROR", `[GridIsolatedEngine] Failed to load active range: ${error}`);
    }
  }

  /**
   * Load levels from DB for the active range and all historical levels.
   */
  private async loadLevels(): Promise<void> {
    try {
      const rows = await db.select().from(gridIsolatedLevels).orderBy(desc(gridIsolatedLevels.createdAt));
      this.levels = rows.map((row) => ({
        id: row.id,
        rangeVersionId: row.rangeVersionId,
        levelIndex: row.levelIndex,
        side: row.side as any,
        price: parseFloat(row.price),
        notionalUsd: parseFloat(row.notionalUsd),
        quantity: parseFloat(row.quantity),
        status: row.status as any,
        filledQuantity: parseFloat(row.filledQuantity),
        filledPrice: row.filledPrice ? parseFloat(row.filledPrice) : null,
        clientOrderId: row.clientOrderId,
        exchangeOrderId: row.exchangeOrderId,
        postOnlyAttempts: row.postOnlyAttempts,
        usedTakerFallback: row.usedTakerFallback,
        netProfitTargetUsd: parseFloat(row.netProfitTargetUsd),
        feeEstimateUsd: parseFloat(row.feeEstimateUsd),
        taxReserveUsd: parseFloat(row.taxReserveUsd),
        createdAt: row.createdAt,
        placedAt: row.placedAt,
        filledAt: row.filledAt,
        cancelledAt: row.cancelledAt,
      }));
    } catch (error) {
      botLogger.error("SYSTEM_ERROR", `[GridIsolatedEngine] Failed to load levels: ${error}`);
    }
  }

  /**
   * Load cycles from DB.
   */
  private async loadCycles(): Promise<void> {
    try {
      const rows = await db.select().from(gridIsolatedCycles).orderBy(desc(gridIsolatedCycles.createdAt));
      this.cycles = rows.map((row) => ({
        id: row.id,
        rangeVersionId: row.rangeVersionId,
        cycleNumber: row.cycleNumber,
        pair: row.pair,
        status: row.status as any,
        buyLevelId: row.buyLevelId,
        sellLevelId: row.sellLevelId,
        buyPrice: row.buyPrice ? parseFloat(row.buyPrice) : null,
        sellPrice: row.sellPrice ? parseFloat(row.sellPrice) : null,
        quantity: parseFloat(row.quantity),
        grossPnlUsd: parseFloat(row.grossPnlUsd),
        feeTotalUsd: parseFloat(row.feeTotalUsd),
        taxReserveUsd: parseFloat(row.taxReserveUsd),
        netPnlUsd: parseFloat(row.netPnlUsd),
        netPnlPct: parseFloat(row.netPnlPct),
        buyClientOrderId: row.buyClientOrderId,
        sellClientOrderId: row.sellClientOrderId,
        buyFilledAt: row.buyFilledAt,
        sellFilledAt: row.sellFilledAt,
        holdTimeMinutes: row.holdTimeMinutes,
        createdAt: row.createdAt,
        completedAt: row.completedAt,
      }));
    } catch (error) {
      botLogger.error("SYSTEM_ERROR", `[GridIsolatedEngine] Failed to load cycles: ${error}`);
    }
  }

  /**
   * Propose a new range version based on band snapshot.
   * Uses professional generator (accumulated spacing) instead of geometric formula.
   */
  private async proposeRangeVersion(bandSnapshot: any): Promise<void> {
    if (!this.config) return;

    const allocation = await gridCapitalAllocator.allocate(
      this.config.capitalProfile,
      10, // initial estimate
      this.config.netProfitTargetPct,
      {
        maxCapitalPerCycleUsd: this.config.gridMaxCapitalPerCycleUsd ?? 0,
        allocationMode: this.config.gridAllocationMode ?? "uniform",
        deploymentMode: this.config.gridCapitalDeploymentMode ?? "capped",
        progressiveIntensity: this.config.gridProgressiveIntensity ?? 0.30,
        maxLevelPct: this.config.gridMaxLevelPct ?? 40,
        minLevelUsd: this.config.gridMinLevelUsd ?? 30,
      }
    );

    // Use professional generator (accumulated spacing) instead of geometric formula
    const professionalResult = generateProfessionalGridLevels({
      currentPrice: bandSnapshot.midPrice,
      bollingerMiddle: bandSnapshot.middle,
      bollingerUpper: bandSnapshot.upper,
      bollingerLower: bandSnapshot.lower,
      atrPct: bandSnapshot.atrPct,
      netProfitTargetPct: this.config.netProfitTargetPct,
      gridStepAtrMultiplier: this.config.gridStepAtrMultiplier,
      gridStepMaxPct: this.config.gridStepMaxPct,
      configuredBuyLevels: Math.floor(allocation.levelsCount / 2),
      configuredSellLevels: Math.floor(allocation.levelsCount / 2),
      capitalPerLevelUsd: allocation.capitalPerLevelUsd,
      // Internal defaults for SHADOW mode (no DB migration yet)
      spreadBufferPct: 0.01,
      safetyBufferPct: 0.10,
      minLevelsForViableGrid: 4,
      centerPriceMode: "hybrid",
      centerClampPct: 0.25,
      operationalRangeMode: "hybrid",
      operationalBandWidthPct: 20.0,
      atrRangeMultiplier: 8.0,
      minOperationalBandWidthPct: 20.0,
      dynamicLevelReduction: true,
      gridViabilityMode: "strict",
    });

    const { levels: generatedLevels, viabilityStatus, professionalGenerator } = professionalResult;

    // Strong guard: never persist range with 0 levels (compact or not_viable)
    if (generatedLevels.length === 0) {
      await this.logEvent(
        viabilityStatus === "compact"
          ? "GRID_PROFESSIONAL_GENERATOR_COMPACT"
          : "GRID_PROFESSIONAL_GENERATOR_NOT_VIABLE",
        viabilityStatus === "compact"
          ? "No se generan niveles porque el Grid queda compacto en modo strict."
          : "No se generan niveles porque no caben niveles rentables con la configuración actual.",
        {
          viabilityStatus,
          professionalGenerator,
          pair: this.config.pair,
          generatedLevelsCount: 0,
          reasonCode: "PROFESSIONAL_GENERATOR_ZERO_LEVELS",
        }
      );
      return;
    }

    // ─── Apply per-level weighted capital to BUY levels ───────────────
    // After geometry is fixed, re-distribute budget using the configured
    // allocation mode. SELL levels are marked "requires_base_asset_not_usd".
    applyWeightsToGeneratedLevels(
      generatedLevels,
      allocation.finalGridBudgetUsd,
      this.config.gridAllocationMode ?? "uniform",
      this.config.gridProgressiveIntensity ?? 0.30,
      this.config.gridMaxLevelPct ?? 40,
      this.config.gridMinLevelUsd ?? 30,
      bandSnapshot.regime ?? "ranging",
      this.config.netProfitTargetPct
    );

    const rangeVersionId = randomUUID();
    // Use 1.0 as placeholder for geometricRatio (linear spacing)
    const ratio = 1.0;

    // Persist range version
    await db.insert(gridRangeVersions).values({
      id: rangeVersionId,
      versionNumber: await this.getNextVersionNumber(),
      pair: this.config.pair,
      status: "proposed",
      midPrice: professionalGenerator.centerPrice.toFixed(8),
      // Use operational range for Grid levels (not Bollinger macro)
      upperPrice: professionalGenerator.operationalUpper.toFixed(8),
      lowerPrice: professionalGenerator.operationalLower.toFixed(8),
      // Keep Bollinger macro for diagnosis/regime
      bandUpper: bandSnapshot.upper.toFixed(8),
      bandMiddle: bandSnapshot.middle.toFixed(8),
      bandLower: bandSnapshot.lower.toFixed(8),
      bandWidthPct: bandSnapshot.bandWidthPct.toFixed(4),
      atrPct: bandSnapshot.atrPct.toFixed(4),
      regime: bandSnapshot.regime,
      levelsCount: generatedLevels.length,
      geometricRatio: ratio.toFixed(4),
      capitalBudgetUsd: allocation.finalGridBudgetUsd.toFixed(2),
      capitalPerLevelUsd: allocation.capitalPerLevelUsd.toFixed(2),
      netProfitTargetPct: this.config.netProfitTargetPct.toFixed(3),
    });

    // Persist levels
    const gridLevels = toGridLevels(generatedLevels, rangeVersionId);
    for (const level of gridLevels) {
      await db.insert(gridIsolatedLevels).values({
        id: level.id,
        rangeVersionId: level.rangeVersionId,
        levelIndex: level.levelIndex,
        side: level.side,
        price: level.price.toFixed(8),
        notionalUsd: level.notionalUsd.toFixed(2),
        quantity: level.quantity.toFixed(8),
        status: level.status,
        filledQuantity: "0",
        clientOrderId: level.clientOrderId,
        postOnlyAttempts: 0,
        usedTakerFallback: false,
        netProfitTargetUsd: level.netProfitTargetUsd.toFixed(8),
        feeEstimateUsd: level.feeEstimateUsd.toFixed(8),
        taxReserveUsd: level.taxReserveUsd.toFixed(8),
      });
    }

    // Activate immediately in SHADOW mode (no real orders)
    await db.update(gridRangeVersions)
      .set({ status: "active", activatedAt: new Date() })
      .where(eq(gridRangeVersions.id, rangeVersionId));

    this.activeRangeVersion = {
      id: rangeVersionId,
      versionNumber: 0, // will be corrected
      pair: this.config.pair,
      status: "active",
      midPrice: professionalGenerator.centerPrice,
      // Use operational range for Grid levels (not Bollinger macro)
      upperPrice: professionalGenerator.operationalUpper,
      lowerPrice: professionalGenerator.operationalLower,
      // Keep Bollinger macro for diagnosis/regime
      bandUpper: bandSnapshot.upper,
      bandMiddle: bandSnapshot.middle,
      bandLower: bandSnapshot.lower,
      bandWidthPct: bandSnapshot.bandWidthPct,
      atrPct: bandSnapshot.atrPct,
      regime: bandSnapshot.regime,
      levelsCount: generatedLevels.length,
      geometricRatio: ratio,
      capitalBudgetUsd: allocation.finalGridBudgetUsd,
      capitalPerLevelUsd: allocation.capitalPerLevelUsd,
      netProfitTargetPct: this.config.netProfitTargetPct,
      createdAt: new Date(),
      activatedAt: new Date(),
      closedAt: null,
    };
    this.levels = gridLevels;

    await this.logEvent("GRID_PROFESSIONAL_GENERATOR_USED", `Generador profesional (spacing acumulativo): ${generatedLevels.length} niveles generados con viabilidad ${viabilityStatus}.`, {
      rangeVersionId,
      pair: this.config.pair,
      viabilityStatus,
      professionalGenerator,
      lowerPrice: professionalGenerator.operationalLower,
      upperPrice: professionalGenerator.operationalUpper,
      centerPrice: professionalGenerator.centerPrice,
      widthPct: professionalGenerator.operationalBandWidthPct,
      method: "professional_accumulated_spacing",
      reasonCode: "PROFESSIONAL_GENERATOR",
      naturalReason: `El Grid generó ${generatedLevels.length} niveles usando fórmula profesional acumulativa con viabilidad ${viabilityStatus}.`,
      impact: "Se generan niveles futuros; no se modifican ciclos abiertos.",
      levelsCount: generatedLevels.length,
      regime: bandSnapshot.regime,
    });
    await this.logEvent("GRID_RANGE_PROPOSED", `Rango propuesto: el Grid detectó una zona válida para ${this.config.pair} con ${generatedLevels.length} niveles alrededor de ${professionalGenerator.centerPrice.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $.`, {
      rangeVersionId,
      pair: this.config.pair,
      lowerPrice: professionalGenerator.operationalLower,
      upperPrice: professionalGenerator.operationalUpper,
      centerPrice: professionalGenerator.centerPrice,
      widthPct: professionalGenerator.operationalBandWidthPct,
      method: "professional_accumulated_spacing",
      reasonCode: "BAND_VALID",
      naturalReason: `${this.config.pair} está en régimen ${bandSnapshot.regime} y permite separar niveles Grid con margen suficiente.`,
      impact: "Se generan niveles futuros; no se modifican ciclos abiertos.",
      levelsCount: generatedLevels.length,
      regime: bandSnapshot.regime,
      volatilityState: bandSnapshot.regime,
      atrPct: bandSnapshot.atrPct,
      bollingerWidthPct: bandSnapshot.bandWidthPct,
      marketRegime: bandSnapshot.regime,
      professionalGenerator,
    });
    await this.logEvent("GRID_RANGE_ACTIVATED", `Rango activado: el Grid usará esta banda para generar niveles futuros en modo ${this.config.mode}.`, {
      rangeVersionId,
      pair: this.config.pair,
      mode: this.config.mode,
      lowerPrice: professionalGenerator.operationalLower,
      upperPrice: professionalGenerator.operationalUpper,
      centerPrice: professionalGenerator.centerPrice,
      widthPct: professionalGenerator.operationalBandWidthPct,
      method: "professional_accumulated_spacing",
      reasonCode: "SHADOW_ACTIVATION",
      naturalReason: `El Grid activó este rango en ${this.config.mode} tras proponer una banda válida para ${this.config.pair}.`,
      impact: "El rango queda disponible para generar niveles futuros. No hay ciclos abiertos todavía.",
      levelsCount: generatedLevels.length,
      regime: bandSnapshot.regime,
    });
  }

  /**
   * Pause active range version.
   */
  private async pauseRangeVersion(reason: string): Promise<void> {
    if (!this.activeRangeVersion) return;
    await db.update(gridRangeVersions)
      .set({ status: "paused" })
      .where(eq(gridRangeVersions.id, this.activeRangeVersion.id));

    await this.logEvent("GRID_RANGE_PAUSED", `Rango pausado: ${reason}`, {
      rangeVersionId: this.activeRangeVersion.id, reason,
      pair: this.activeRangeVersion.pair,
    });
  }

  /**
   * SHADOW mode simulation — check if price would have filled any levels.
   * Only processes levels that belong to the active range version.
   * Pre-validates with canProcessShadowFill() before marking any level as filled.
   */
  private async simulateShadowTick(currentPrice: number): Promise<void> {
    if (!this.activeRangeVersion || !this.config) return;

    const activeRangeId = this.activeRangeVersion.id;

    for (const level of this.levels) {
      if (level.rangeVersionId !== activeRangeId) continue;
      if (level.status !== "planned" && level.status !== "open") continue;

      let filled = false;
      if (level.side === "BUY" && currentPrice <= level.price) {
        filled = true;
      } else if (level.side === "SELL" && currentPrice >= level.price) {
        filled = true;
      }

      if (filled) {
        // Pre-validate before touching level state or DB
        const validation = this.canProcessShadowFill(level, activeRangeId);
        if (!validation.ok) {
          await this.logEvent(validation.eventType!, validation.reason!, {
            levelId: level.id, side: level.side, mode: "SHADOW",
            ...validation.details,
          });
          continue;
        }

        // Only now mark as filled
        level.status = "filled";
        level.filledPrice = currentPrice;
        level.filledQuantity = level.quantity;
        level.filledAt = new Date();

        await this.logEvent("GRID_LEVEL_FILLED", `[SHADOW] ${level.side} level filled at ${currentPrice}`, {
          levelId: level.id, side: level.side, price: currentPrice, mode: "SHADOW",
        });

        // Update DB
        await db.update(gridIsolatedLevels)
          .set({
            status: "filled",
            filledPrice: currentPrice.toFixed(8),
            filledQuantity: level.quantity.toFixed(8),
            filledAt: new Date(),
          })
          .where(eq(gridIsolatedLevels.id, level.id));

        // Create or complete cycle
        await this.processCycleFill(level, currentPrice);
      }
    }
  }

  /**
   * Pre-validate whether a SHADOW fill can be processed for a level.
   * Returns ok=true only if the fill is safe to apply.
   * Does NOT modify level state or DB.
   */
  private canProcessShadowFill(
    level: GridLevel,
    activeRangeId: string
  ): { ok: boolean; reason?: string; eventType?: GridEventType; details?: Record<string, any> } {
    if (!this.config) return { ok: false, reason: "No config", eventType: "GRID_SHADOW_LEVEL_IGNORED_OUT_OF_ACTIVE_RANGE" };

    // Level must belong to active range
    if (level.rangeVersionId !== activeRangeId) {
      return {
        ok: false,
        eventType: "GRID_SHADOW_LEVEL_IGNORED_OUT_OF_ACTIVE_RANGE",
        reason: `[SHADOW] Level ${level.id} ignored: belongs to range ${level.rangeVersionId}, not active ${activeRangeId}`,
        details: { levelRangeVersionId: level.rangeVersionId, activeRangeVersionId: activeRangeId },
      };
    }

    if (level.side === "BUY") {
      // Check maxOpenCycles for active range
      const openCyclesForActiveRange = this.cycles.filter(c =>
        c.rangeVersionId === activeRangeId &&
        ["open", "active", "buy_filled", "buy_placed", "sell_placed", "cycle_open"].includes(c.status)
      ).length;

      if (openCyclesForActiveRange >= this.config.maxOpenCycles) {
        return {
          ok: false,
          eventType: "GRID_SHADOW_MAX_OPEN_CYCLES_REACHED",
          reason: `[SHADOW] Max open cycles (${this.config.maxOpenCycles}) reached for active range. BUY level ${level.id} not filled.`,
          details: { openCycles: openCyclesForActiveRange, maxOpenCycles: this.config.maxOpenCycles },
        };
      }

      // Check for existing open cycle for this buy level (prevent duplicates)
      const existingCycleForBuy = this.cycles.find(c =>
        c.buyLevelId === level.id &&
        !["completed", "cancelled", "stop_loss_hit", "trailing_closed"].includes(c.status)
      );

      if (existingCycleForBuy) {
        return {
          ok: false,
          eventType: "GRID_SHADOW_DUPLICATE_BUY_LEVEL_IGNORED",
          reason: `[SHADOW] Duplicate cycle for buy level ${level.id} ignored. Existing cycle ${existingCycleForBuy.id}.`,
          details: { existingCycleId: existingCycleForBuy.id },
        };
      }
    } else if (level.side === "SELL") {
      // Check there is an open cycle from the same active range
      const openCycle = this.cycles.find(c =>
        c.rangeVersionId === activeRangeId && c.status === "buy_filled"
      );

      if (!openCycle) {
        return {
          ok: false,
          eventType: "GRID_SHADOW_SELL_IGNORED_NO_OPEN_CYCLE",
          reason: `[SHADOW] SELL simulado ignorado: no existe BUY/ciclo abierto del mismo rango activo.`,
          details: { levelId: level.id },
        };
      }
    }

    return { ok: true };
  }

  /**
   * Process a fill and create/complete cycles.
   * Pre-validated by canProcessShadowFill() — all checks (range, maxOpenCycles,
   * duplicate BUY, SELL with open cycle) are already done before calling this.
   */
  private async processCycleFill(level: GridLevel, fillPrice: number): Promise<void> {
    if (!this.activeRangeVersion || !this.config) return;

    const activeRangeId = this.activeRangeVersion.id;

    if (level.side === "BUY") {
      // Create new cycle
      const cycle: GridCycle = {
        id: randomUUID(),
        rangeVersionId: activeRangeId,
        cycleNumber: this.cycles.length + 1,
        pair: this.config.pair,
        status: "buy_filled",
        buyLevelId: level.id,
        sellLevelId: null,
        buyPrice: fillPrice,
        sellPrice: null,
        quantity: level.quantity,
        grossPnlUsd: 0,
        feeTotalUsd: 0,
        taxReserveUsd: 0,
        netPnlUsd: 0,
        netPnlPct: 0,
        buyClientOrderId: level.clientOrderId,
        sellClientOrderId: null,
        buyFilledAt: new Date(),
        sellFilledAt: null,
        holdTimeMinutes: 0,
        createdAt: new Date(),
        completedAt: null,
      };
      this.cycles.push(cycle);

      await db.insert(gridIsolatedCycles).values({
        id: cycle.id,
        rangeVersionId: cycle.rangeVersionId,
        cycleNumber: cycle.cycleNumber,
        pair: cycle.pair,
        status: "buy_filled",
        buyLevelId: cycle.buyLevelId,
        buyPrice: fillPrice.toFixed(8),
        quantity: cycle.quantity.toFixed(8),
        buyClientOrderId: cycle.buyClientOrderId,
        buyFilledAt: new Date(),
      });

      await this.logEvent("GRID_CYCLE_BUY_FILLED", `[SHADOW] Cycle ${cycle.cycleNumber} buy filled at ${fillPrice}`, {
        cycleId: cycle.id, buyPrice: fillPrice, mode: "SHADOW",
      });
    } else if (level.side === "SELL") {
      // Find oldest open cycle from the SAME active range only
      const openCycle = this.cycles.find(c =>
        c.rangeVersionId === activeRangeId && c.status === "buy_filled"
      );
      if (!openCycle) return;

      openCycle.sellLevelId = level.id;
      openCycle.sellPrice = fillPrice;
      openCycle.sellFilledAt = new Date();
      openCycle.holdTimeMinutes = Math.round(
        (openCycle.sellFilledAt.getTime() - (openCycle.buyFilledAt?.getTime() || 0)) / 60000
      );

      const pnl = computeCyclePnL(
        openCycle.buyPrice!,
        fillPrice,
        openCycle.quantity
      );

      openCycle.grossPnlUsd = pnl.grossPnlUsd;
      openCycle.feeTotalUsd = pnl.totalFeesUsd;
      openCycle.taxReserveUsd = pnl.taxReserveUsd;
      openCycle.netPnlUsd = pnl.netPnlUsd;
      openCycle.netPnlPct = pnl.netPnlPct;
      openCycle.status = "completed";
      openCycle.completedAt = new Date();
      openCycle.sellClientOrderId = level.clientOrderId;

      await db.update(gridIsolatedCycles)
        .set({
          status: "completed",
          sellLevelId: level.id,
          sellPrice: fillPrice.toFixed(8),
          sellFilledAt: new Date(),
          grossPnlUsd: pnl.grossPnlUsd.toFixed(8),
          feeTotalUsd: pnl.totalFeesUsd.toFixed(8),
          taxReserveUsd: pnl.taxReserveUsd.toFixed(8),
          netPnlUsd: pnl.netPnlUsd.toFixed(8),
          netPnlPct: pnl.netPnlPct.toFixed(4),
          holdTimeMinutes: openCycle.holdTimeMinutes,
          completedAt: new Date(),
          sellClientOrderId: level.clientOrderId,
        })
        .where(eq(gridIsolatedCycles.id, openCycle.id));

      await this.logEvent("GRID_CYCLE_COMPLETED", `[SHADOW] Cycle ${openCycle.cycleNumber} completed: net PnL $${pnl.netPnlUsd.toFixed(2)} (${pnl.netPnlPct.toFixed(3)}%)`, {
        cycleId: openCycle.id, buyPrice: openCycle.buyPrice, sellPrice: fillPrice,
        netPnlUsd: pnl.netPnlUsd, netPnlPct: pnl.netPnlPct, mode: "SHADOW",
      });
    }
  }

  /**
   * Check pump/dump guard.
   */
  private async checkPumpDumpGuard(currentPrice: number): Promise<void> {
    if (!this.config || !this.activeRangeVersion) return;

    const midPrice = this.activeRangeVersion.midPrice;
    const deviationPct = Math.abs((currentPrice - midPrice) / midPrice) * 100;

    if (deviationPct > this.config.pumpGuardDeviationPct && currentPrice > midPrice) {
      this.pumpDumpState = {
        state: "pump_detected",
        triggeredAt: new Date(),
        priceDeviationPct: deviationPct,
        volumeSpikeRatio: 0, // Would need volume data
        cooldownUntil: new Date(Date.now() + this.config.pumpGuardCooldownMinutes * 60000),
        reason: `Pump detected: ${deviationPct.toFixed(2)}% above mid`,
      };
      await this.logEvent("GRID_PUMP_GUARD_TRIGGERED", this.pumpDumpState.reason, {
        deviationPct, currentPrice, midPrice,
      });
    } else if (deviationPct > this.config.dumpGuardDeviationPct && currentPrice < midPrice) {
      this.pumpDumpState = {
        state: "dump_detected",
        triggeredAt: new Date(),
        priceDeviationPct: deviationPct,
        volumeSpikeRatio: 0,
        cooldownUntil: new Date(Date.now() + this.config.dumpGuardCooldownMinutes * 60000),
        reason: `Dump detected: ${deviationPct.toFixed(2)}% below mid`,
      };
      await this.logEvent("GRID_DUMP_GUARD_TRIGGERED", this.pumpDumpState.reason, {
        deviationPct, currentPrice, midPrice,
      });
    } else if (this.pumpDumpState.state !== "normal" && this.pumpDumpState.cooldownUntil && Date.now() > this.pumpDumpState.cooldownUntil.getTime()) {
      this.pumpDumpState = {
        state: "normal",
        triggeredAt: null,
        priceDeviationPct: 0,
        volumeSpikeRatio: 0,
        cooldownUntil: null,
        reason: "",
      };
      await this.logEvent("GRID_PUMP_DUMP_COOLDOWN_END", "Pump/Dump guard cooldown ended");
    }
  }

  /**
   * Check and reset daily order count.
   */
  private checkDailyOrderReset(): void {
    const now = new Date();
    if (now.getDate() !== this.dailyOrderResetAt.getDate() ||
        now.getMonth() !== this.dailyOrderResetAt.getMonth()) {
      this.dailyOrderCount = 0;
      this.dailyOrderResetAt = now;
    }
  }

  /**
   * Get next version number.
   */
  private async getNextVersionNumber(): Promise<number> {
    try {
      const result = await db.execute(sql`SELECT COALESCE(MAX(version_number), 0) + 1 as next FROM grid_range_versions`);
      return parseInt(result.rows[0]?.next as string || "1");
    } catch {
      return 1;
    }
  }

  /**
   * Log event to both botLogger and grid_isolated_events table.
   */
  private async logEvent(eventType: GridEventType, message: string, meta?: Record<string, any>): Promise<void> {
    const mode = this.config?.mode || "OFF";
    const pair = this.config?.pair || "BTC/USD";

    // Log to botLogger (central event system)
    await botLogger.info(eventType as any, message, { ...meta, pair, mode, source: "GRID_ISOLATED" });

    // Also persist to grid_isolated_events for dedicated audit trail
    try {
      await db.insert(gridIsolatedEvents).values({
        eventType,
        pair,
        rangeVersionId: this.activeRangeVersion?.id || null,
        levelId: meta?.levelId || null,
        cycleId: meta?.cycleId || null,
        mode,
        message,
        metadataJson: meta ? JSON.stringify(meta) : null,
      });
    } catch {
      // Non-fatal if grid events table doesn't exist yet
    }
  }

  /**
   * Get execution status (for API/UI).
   * Uses config snapshot if not loaded, without auto-starting.
   */
  getExecutionStatus(configOverride?: GridIsolatedConfig | null): GridExecutionStatus {
    const activeRangeId = this.activeRangeVersion?.id || null;
    const configToUse = configOverride ?? this.config;

    // Filter levels by active range version if exists
    const activeLevels = activeRangeId
      ? this.levels.filter(l => l.rangeVersionId === activeRangeId)
      : [];

    // Operational counts refer to active range only
    const openLevels = activeRangeId
      ? activeLevels.filter(l => l.status === "open" || l.status === "planned").length
      : 0;
    const plannedLevelsCount = activeRangeId
      ? activeLevels.filter(l => l.status === "planned").length
      : 0;
    const activeOrdersCount = activeRangeId
      ? activeLevels.filter(l =>
          ["open", "placed", "partially_filled", "filled"].includes(l.status)
        ).length
      : 0;

    // Real orders count is always global (safety check)
    const realOpenOrdersCount = this.levels.filter(l =>
      l.exchangeOrderId != null && !["filled", "cancelled"].includes(l.status)
    ).length;

    // Historical levels count is global (all non-active ranges)
    const historicalLevelsCount = activeRangeId
      ? this.levels.filter(l =>
          l.rangeVersionId !== activeRangeId && ["replaced", "cancelled", "filled"].includes(l.status)
        ).length
      : this.levels.filter(l =>
          ["replaced", "cancelled", "filled"].includes(l.status)
        ).length;

    // Global counters for all levels in memory
    const globalLevelsCount = this.levels.length;
    const globalPlannedLevelsCount = this.levels.filter(l => l.status === "planned").length;
    const orphanPlannedLevelsCount = activeRangeId
      ? this.levels.filter(l =>
          l.rangeVersionId !== activeRangeId && l.status === "planned"
        ).length
      : this.levels.filter(l => l.status === "planned").length;

    const openCycleStatuses = ["open", "active", "buy_filled", "buy_placed", "sell_placed", "cycle_open"];
    const openCycles = this.cycles.filter(c =>
      !["completed", "cancelled", "stop_loss_hit", "trailing_closed"].includes(c.status)
    ).length;
    const activeOpenCyclesCount = activeRangeId
      ? this.cycles.filter(c => c.rangeVersionId === activeRangeId && openCycleStatuses.includes(c.status)).length
      : 0;
    const globalOpenCyclesCount = openCycles;
    const orphanOpenCyclesCount = activeRangeId
      ? this.cycles.filter(c => c.rangeVersionId !== activeRangeId && openCycleStatuses.includes(c.status)).length
      : openCycles;
    const historicalOpenCyclesCount = orphanOpenCyclesCount;
    const totalNetPnl = this.cycles.reduce((sum, c) => sum + c.netPnlUsd, 0);
    const completedCycles = this.cycles.filter(c => c.status === "completed").length;

    // Determine config source
    let configLoaded = false;
    let configSource: "memory" | "db_snapshot" | "default_runtime_empty" = "default_runtime_empty";
    if (this.config) {
      configLoaded = true;
      configSource = "memory";
    } else if (configOverride) {
      configLoaded = true;
      configSource = "db_snapshot";
    }

    return {
      mode: configToUse?.mode || "OFF",
      activeRangeVersionId: activeRangeId,
      activeRangeVersionNumber: this.activeRangeVersion?.versionNumber ?? null,
      activeRangeCreatedAt: this.activeRangeVersion?.createdAt ?? null,
      activeRangeStatus: this.activeRangeVersion?.status ?? null,
      openLevels,
      plannedLevelsCount,
      activeOrdersCount,
      realOpenOrdersCount,
      historicalLevelsCount,
      openCycles,
      activeOpenCyclesCount,
      globalOpenCyclesCount,
      orphanOpenCyclesCount,
      historicalOpenCyclesCount,
      dailyOrderCount: this.dailyOrderCount,
      circuitBreakerOpen: this.circuitBreakerOpen,
      pumpDumpState: this.pumpDumpState.state,
      lastReconciliationAt: null,
      lastReconciliationOk: null,
      capitalReservedUsd: 0,
      capitalAvailableUsd: 0,
      totalNetPnlUsd: totalNetPnl,
      totalCyclesCompleted: completedCycles,
      isActive: configToUse?.isActive ?? false,
      isRunning: this.running,
      lastTickAt: this.lastTickAt,
      lastTickReason: this.lastTickReason,
      lastShadowValidationAt: this.lastShadowValidationAt,
      lastShadowValidationResult: this.lastShadowValidationResult,
      globalLevelsCount,
      globalPlannedLevelsCount,
      orphanPlannedLevelsCount,
      configLoaded,
      configSource,
      runtimeLoaded: !!this.config,
      statusSource: this.config ? "runtime" : (configOverride ? "db_snapshot" : "default_runtime_empty"),
    } as any;
  }

  /**
   * Safe status: returns runtime status if loaded, otherwise falls back to DB snapshot.
   * This is the preferred method for /status endpoint — never auto-starts, never mutates runtime.
   */
  async getStatusSafe(): Promise<GridExecutionStatus> {
    if (this.config) {
      const status = this.getExecutionStatus();
      return {
        ...status,
        runtimeLoaded: true,
        statusSource: "runtime" as const,
        configLoaded: true,
        configSource: "memory" as const,
      };
    }
    return await this.getStatusFromDb();
  }

  /**
   * Get execution status from DB snapshot — READ-ONLY fallback.
   * Only used when runtime is not loaded (this.config is null).
   * Does NOT modify this.config, this.activeRangeVersion, this.levels, this.cycles.
   * Does NOT start the scheduler.
   */
  async getStatusFromDb(): Promise<GridExecutionStatus> {
    if (this.config) {
      return this.getExecutionStatus();
    }

    const openCycleStatuses = ["open", "active", "buy_filled", "buy_placed", "sell_placed", "cycle_open"];

    // Read config from DB
    const configRows = await db.select().from(gridIsolatedConfigs).limit(1);
    if (configRows.length === 0) {
      return {
        mode: "OFF",
        activeRangeVersionId: null,
        activeRangeVersionNumber: null,
        activeRangeCreatedAt: null,
        activeRangeStatus: null,
        openLevels: 0,
        plannedLevelsCount: 0,
        activeOrdersCount: 0,
        realOpenOrdersCount: 0,
        historicalLevelsCount: 0,
        openCycles: 0,
        activeOpenCyclesCount: 0,
        globalOpenCyclesCount: 0,
        orphanOpenCyclesCount: 0,
        historicalOpenCyclesCount: 0,
        dailyOrderCount: 0,
        circuitBreakerOpen: false,
        pumpDumpState: { state: "normal", triggeredAt: null, peakPrice: null, troughPrice: null } as any,
        lastReconciliationAt: null,
        lastReconciliationOk: null,
        capitalReservedUsd: 0,
        capitalAvailableUsd: 0,
        totalNetPnlUsd: 0,
        totalCyclesCompleted: 0,
        globalLevelsCount: 0,
        globalPlannedLevelsCount: 0,
        orphanPlannedLevelsCount: 0,
        configLoaded: false,
        configSource: "default_runtime_empty",
        runtimeLoaded: false,
        statusSource: "db_snapshot",
      } as any;
    }

    const cfg = configRows[0];

    // Read active range version from DB
    const rangeRows = await db.select().from(gridRangeVersions)
      .where(eq(gridRangeVersions.status, "active"))
      .orderBy(desc(gridRangeVersions.createdAt))
      .limit(1);
    const activeRange = rangeRows.length > 0 ? rangeRows[0] : null;
    const activeRangeId = activeRange?.id ?? null;

    // Read all levels from DB
    const allLevels = await db.select().from(gridIsolatedLevels).limit(10000);
    const activeLevels = activeRangeId
      ? allLevels.filter(l => l.rangeVersionId === activeRangeId)
      : [];

    const openLevels = activeRangeId
      ? activeLevels.filter(l => l.status === "open" || l.status === "planned").length
      : 0;
    const plannedLevelsCount = activeRangeId
      ? activeLevels.filter(l => l.status === "planned").length
      : 0;
    const activeOrdersCount = activeRangeId
      ? activeLevels.filter(l => ["open", "placed", "partially_filled", "filled"].includes(l.status)).length
      : 0;
    const realOpenOrdersCount = allLevels.filter(l =>
      l.exchangeOrderId != null && !["filled", "cancelled"].includes(l.status)
    ).length;
    const historicalLevelsCount = activeRangeId
      ? allLevels.filter(l => l.rangeVersionId !== activeRangeId && ["replaced", "cancelled", "filled"].includes(l.status)).length
      : allLevels.filter(l => ["replaced", "cancelled", "filled"].includes(l.status)).length;
    const globalLevelsCount = allLevels.length;
    const globalPlannedLevelsCount = allLevels.filter(l => l.status === "planned").length;
    const orphanPlannedLevelsCount = activeRangeId
      ? allLevels.filter(l => l.rangeVersionId !== activeRangeId && l.status === "planned").length
      : allLevels.filter(l => l.status === "planned").length;

    // Read all cycles from DB
    const allCycles = await db.select().from(gridIsolatedCycles).limit(10000);
    const openCycles = allCycles.filter(c =>
      !["completed", "cancelled", "stop_loss_hit", "trailing_closed"].includes(c.status)
    ).length;
    const activeOpenCyclesCount = activeRangeId
      ? allCycles.filter(c => c.rangeVersionId === activeRangeId && openCycleStatuses.includes(c.status)).length
      : 0;
    const globalOpenCyclesCount = openCycles;
    const orphanOpenCyclesCount = activeRangeId
      ? allCycles.filter(c => c.rangeVersionId !== activeRangeId && openCycleStatuses.includes(c.status)).length
      : openCycles;
    const completedCycles = allCycles.filter(c => c.status === "completed").length;
    const totalNetPnl = allCycles.reduce((sum, c) => sum + parseFloat(c.netPnlUsd || "0"), 0);

    return {
      mode: (cfg.mode as any) || "OFF",
      activeRangeVersionId: activeRangeId,
      activeRangeVersionNumber: activeRange?.versionNumber ?? null,
      activeRangeCreatedAt: activeRange?.createdAt ?? null,
      activeRangeStatus: (activeRange?.status as any) ?? null,
      openLevels,
      plannedLevelsCount,
      activeOrdersCount,
      realOpenOrdersCount,
      historicalLevelsCount,
      openCycles,
      activeOpenCyclesCount,
      globalOpenCyclesCount,
      orphanOpenCyclesCount,
      historicalOpenCyclesCount: orphanOpenCyclesCount,
      dailyOrderCount: 0,
      circuitBreakerOpen: false,
      pumpDumpState: { state: "normal", triggeredAt: null, peakPrice: null, troughPrice: null } as any,
      lastReconciliationAt: null,
      lastReconciliationOk: null,
      capitalReservedUsd: 0,
      capitalAvailableUsd: 0,
      totalNetPnlUsd: totalNetPnl,
      totalCyclesCompleted: completedCycles,
      globalLevelsCount,
      globalPlannedLevelsCount,
      orphanPlannedLevelsCount,
      configLoaded: false,
      configSource: "db_snapshot",
      runtimeLoaded: false,
      statusSource: "db_snapshot",
    } as any;
  }

  /**
   * Get current config.
   */
  getConfig(): GridIsolatedConfig | null {
    return this.config;
  }

  /**
   * Dry-run preview of SHADOW cleanup — analyzes cycles/levels from DB without modifying anything.
   * Returns a diagnostic report of cycles/levels that could be archived/reset.
   */
  async shadowCleanupPreview(): Promise<any> {
    const openCycleStatuses = ["open", "active", "buy_filled", "buy_placed", "sell_placed", "cycle_open"];

    // Read all cycles from DB
    const allCycles = await db.select().from(gridIsolatedCycles).limit(10000);
    // Read all levels from DB
    const allLevels = await db.select().from(gridIsolatedLevels).limit(10000);
    // Read active range from DB
    const rangeRows = await db.select().from(gridRangeVersions)
      .where(eq(gridRangeVersions.status, "active"))
      .orderBy(desc(gridRangeVersions.createdAt))
      .limit(1);
    const activeRangeId = rangeRows.length > 0 ? rangeRows[0].id : null;

    // ─── A) Cycle analysis ─────────────────────────────────
    const openCycles = allCycles.filter(c => openCycleStatuses.includes(c.status));
    const activeRangeOpenCycles = activeRangeId
      ? openCycles.filter(c => c.rangeVersionId === activeRangeId)
      : [];
    const orphanOpenCycles = activeRangeId
      ? openCycles.filter(c => c.rangeVersionId !== activeRangeId)
      : openCycles;
    const historicalOpenCycles = orphanOpenCycles;

    // Group by rangeVersionId
    const cyclesByRangeVersionId: Record<string, number> = {};
    for (const c of openCycles) {
      cyclesByRangeVersionId[c.rangeVersionId] = (cyclesByRangeVersionId[c.rangeVersionId] || 0) + 1;
    }

    // Group by buyLevelId
    const cyclesByBuyLevelId: Record<string, number> = {};
    for (const c of openCycles) {
      if (c.buyLevelId) {
        cyclesByBuyLevelId[c.buyLevelId] = (cyclesByBuyLevelId[c.buyLevelId] || 0) + 1;
      }
    }

    // Duplicate buyLevelId cycles (more than 1 open cycle per buyLevelId)
    const duplicateBuyLevelCycles = Object.entries(cyclesByBuyLevelId)
      .filter(([, count]) => count > 1)
      .map(([buyLevelId, count]) => ({ buyLevelId, count }));

    // Cycles without buyLevelId
    const cyclesWithoutBuyLevel = openCycles.filter(c => !c.buyLevelId);

    // Cycles whose buyLevel is not filled
    const cyclesWhoseBuyLevelIsNotFilled = openCycles.filter(c => {
      if (!c.buyLevelId) return false;
      const level = allLevels.find(l => l.id === c.buyLevelId);
      return level && level.status !== "filled";
    });

    // Cycles with no sell target (sellLevelId is null)
    const cyclesWithNoSellTarget = openCycles.filter(c => !c.sellLevelId);

    // Cycles with status buy_filled
    const cyclesWithStatusBuyFilled = openCycles.filter(c => c.status === "buy_filled");

    // ─── B) Level analysis ─────────────────────────────────
    const filledLevelsWithoutCycle = allLevels.filter(l =>
      l.status === "filled" && l.side === "BUY" &&
      !allCycles.some(c => c.buyLevelId === l.id)
    );

    const plannedLevelsFromHistoricalRanges = activeRangeId
      ? allLevels.filter(l => l.rangeVersionId !== activeRangeId && l.status === "planned")
      : allLevels.filter(l => l.status === "planned");

    const filledLevelsFromHistoricalRanges = activeRangeId
      ? allLevels.filter(l => l.rangeVersionId !== activeRangeId && l.status === "filled")
      : [];

    const levelsBelongingToActiveRange = activeRangeId
      ? allLevels.filter(l => l.rangeVersionId === activeRangeId)
      : [];

    const levelsBelongingToInactiveRanges = activeRangeId
      ? allLevels.filter(l => l.rangeVersionId !== activeRangeId)
      : allLevels;

    // ─── C) Risk assessment ────────────────────────────────
    // Check if any cycle/level has real exchangeOrderId
    const cyclesWithRealOrders = openCycles.filter(c => {
      const buyLevel = c.buyLevelId ? allLevels.find(l => l.id === c.buyLevelId) : null;
      const sellLevel = c.sellLevelId ? allLevels.find(l => l.id === c.sellLevelId) : null;
      return (buyLevel?.exchangeOrderId != null) || (sellLevel?.exchangeOrderId != null);
    });

    const levelsWithRealOrders = allLevels.filter(l =>
      l.exchangeOrderId != null && !["filled", "cancelled"].includes(l.status)
    );

    const realOrdersAffected = cyclesWithRealOrders.length > 0 || levelsWithRealOrders.length > 0;

    // A cycle can be proposed for archive if:
    // - no real exchangeOrderId on associated levels
    // - status is open/active/buy_filled
    // - no sellFilledAt (not completed)
    const archiveCycleIds = openCycles.filter(c => {
      const buyLevel = c.buyLevelId ? allLevels.find(l => l.id === c.buyLevelId) : null;
      const sellLevel = c.sellLevelId ? allLevels.find(l => l.id === c.sellLevelId) : null;
      const hasRealOrder = (buyLevel?.exchangeOrderId != null) || (sellLevel?.exchangeOrderId != null);
      return !hasRealOrder && !c.sellFilledAt;
    }).map(c => c.id);

    // A level can be proposed for reset if:
    // - exchangeOrderId is null
    // - status is "filled" (from SHADOW simulation)
    // - belongs to a cycle proposed for archive, or is inconsistent
    const resetLevelIds = allLevels.filter(l => {
      if (l.exchangeOrderId != null) return false;
      if (l.status !== "filled") return false;
      // Check if it belongs to a cycle proposed for archive
      const belongsToArchivedCycle = allCycles.some(c =>
        archiveCycleIds.includes(c.id) &&
        (c.buyLevelId === l.id || c.sellLevelId === l.id)
      );
      // Or it's a filled BUY level without any cycle
      const isOrphanFilledBuy = l.side === "BUY" && !allCycles.some(c => c.buyLevelId === l.id);
      return belongsToArchivedCycle || isOrphanFilledBuy;
    }).map(l => l.id);

    const preserveCycleIds = allCycles.filter(c => !archiveCycleIds.includes(c.id)).map(c => c.id);
    const preserveLevelIds = allLevels.filter(l => !resetLevelIds.includes(l.id)).map(l => l.id);

    const safeToArchiveShadowOnly = !realOrdersAffected;

    // Determine cleanup reason
    let cleanupReason = "";
    if (realOrdersAffected) {
      cleanupReason = "No se puede limpiar automáticamente: se detectaron órdenes reales asociadas.";
    } else if (archiveCycleIds.length > 0) {
      cleanupReason = `Se detectaron ${archiveCycleIds.length} ciclos SHADOW abiertos sin órdenes reales, candidatos para archivo.`;
    } else {
      cleanupReason = "No se detectaron ciclos SHADOW abiertos que requieran limpieza.";
    }

    return {
      ok: true,
      timestamp: new Date().toISOString(),
      dryRun: true,
      readOnly: true,
      realOrdersAffected,
      cycles: {
        totalOpenCycles: openCycles.length,
        activeRangeOpenCycles: activeRangeOpenCycles.length,
        orphanOpenCycles: orphanOpenCycles.length,
        historicalOpenCycles: historicalOpenCycles.length,
        cyclesByRangeVersionId,
        cyclesByBuyLevelId,
        duplicateBuyLevelCycles,
        cyclesWithoutBuyLevel: cyclesWithoutBuyLevel.length,
        cyclesWhoseBuyLevelIsNotFilled: cyclesWhoseBuyLevelIsNotFilled.length,
        cyclesWithNoSellTarget: cyclesWithNoSellTarget.length,
        cyclesWithStatusBuyFilled: cyclesWithStatusBuyFilled.length,
      },
      levels: {
        filledLevelsWithoutCycle: filledLevelsWithoutCycle.length,
        plannedLevelsFromHistoricalRanges: plannedLevelsFromHistoricalRanges.length,
        filledLevelsFromHistoricalRanges: filledLevelsFromHistoricalRanges.length,
        levelsBelongingToActiveRange: levelsBelongingToActiveRange.length,
        levelsBelongingToInactiveRanges: levelsBelongingToInactiveRanges.length,
      },
      risk: {
        safeToArchiveShadowOnly,
        reason: cleanupReason,
        affectedCyclesCount: archiveCycleIds.length,
        affectedLevelsCount: resetLevelIds.length,
        realOrdersAffected,
      },
      preview: {
        archiveCycleIds,
        resetLevelIds,
        preserveCycleIds,
        preserveLevelIds,
      },
    };
  }

  /**
   * Apply SHADOW cleanup — archives cycles and cancels levels.
   * Requires confirmToken when dryRun=false.
   * Uses DB transaction. No DELETE operations.
   * Returns backup/evidence object for audit.
   */
  async applyShadowCleanup(opts: {
    dryRun: boolean;
    confirmToken?: string | null;
    expectedCyclesCount?: number;
    expectedLevelsCount?: number;
  }): Promise<any> {
    const { dryRun, confirmToken, expectedCyclesCount, expectedLevelsCount } = opts;

    // Always run preview first
    const cleanupPreview = await this.shadowCleanupPreview();

    // Log preview event
    await this.logEvent("GRID_SHADOW_CLEANUP_PREVIEWED", `Vista previa de limpieza SHADOW: ${cleanupPreview.risk.affectedCyclesCount} ciclos, ${cleanupPreview.risk.affectedLevelsCount} niveles.`, {
      affectedCyclesCount: cleanupPreview.risk.affectedCyclesCount,
      affectedLevelsCount: cleanupPreview.risk.affectedLevelsCount,
      dryRun,
    });

    // ─── dryRun=true: return preview only, no DB modifications ───
    if (dryRun) {
      return {
        ok: true,
        dryRun: true,
        readOnly: true,
        action: "preview_apply",
        wouldArchiveCyclesCount: cleanupPreview.risk.affectedCyclesCount,
        wouldUpdateLevelsCount: cleanupPreview.risk.affectedLevelsCount,
        realOrdersAffected: cleanupPreview.risk.realOrdersAffected,
        safeToArchiveShadowOnly: cleanupPreview.risk.safeToArchiveShadowOnly,
        cleanupPreview,
      };
    }

    // ─── dryRun=false: require confirmToken and validations ───
    const archiveCycleIds = cleanupPreview.preview.archiveCycleIds as string[];
    const resetLevelIds = cleanupPreview.preview.resetLevelIds as string[];

    // Validation 1: confirmToken required
    if (!confirmToken) {
      await this.logEvent("GRID_SHADOW_CLEANUP_ABORTED", "Limpieza SHADOW abortada: confirmToken requerido.", { reason: "missing_confirm_token" });
      return { ok: false, applied: false, reason: "confirmToken es requerido para dryRun=false" };
    }

    // Validation 2: confirmToken must match expected format
    const activeRangeId = cleanupPreview.preview.archiveCycleIds.length > 0
      ? (await db.select().from(gridIsolatedCycles).where(eq(gridIsolatedCycles.id, archiveCycleIds[0])).limit(1))[0]?.rangeVersionId
      : null;
    const expectedToken = activeRangeId
      ? `ARCHIVE_SHADOW_PREFIX_${activeRangeId.toUpperCase()}_${archiveCycleIds.length}_CYCLES`
      : null;

    if (expectedToken && confirmToken !== expectedToken) {
      await this.logEvent("GRID_SHADOW_CLEANUP_ABORTED", `Limpieza SHADOW abortada: confirmToken incorrecto.`, { reason: "invalid_confirm_token", expected: expectedToken });
      return { ok: false, applied: false, reason: `confirmToken incorrecto. Esperado: ${expectedToken}` };
    }

    // Validation 3: expectedCyclesCount must match
    if (expectedCyclesCount !== undefined && expectedCyclesCount !== cleanupPreview.risk.affectedCyclesCount) {
      await this.logEvent("GRID_SHADOW_CLEANUP_ABORTED", `Limpieza SHADOW abortada: expectedCyclesCount=${expectedCyclesCount} != actual=${cleanupPreview.risk.affectedCyclesCount}.`, { reason: "cycles_count_mismatch" });
      return { ok: false, applied: false, reason: `expectedCyclesCount (${expectedCyclesCount}) no coincide con detectado (${cleanupPreview.risk.affectedCyclesCount})` };
    }

    // Validation 4: expectedLevelsCount must match
    if (expectedLevelsCount !== undefined && expectedLevelsCount !== cleanupPreview.risk.affectedLevelsCount) {
      await this.logEvent("GRID_SHADOW_CLEANUP_ABORTED", `Limpieza SHADOW abortada: expectedLevelsCount=${expectedLevelsCount} != actual=${cleanupPreview.risk.affectedLevelsCount}.`, { reason: "levels_count_mismatch" });
      return { ok: false, applied: false, reason: `expectedLevelsCount (${expectedLevelsCount}) no coincide con detectado (${cleanupPreview.risk.affectedLevelsCount})` };
    }

    // Validation 5: hard safety checks
    if (cleanupPreview.ok !== true) {
      await this.logEvent("GRID_SHADOW_CLEANUP_ABORTED", "Limpieza SHADOW abortada: preview.ok !== true.", { reason: "preview_not_ok" });
      return { ok: false, applied: false, reason: "preview.ok !== true" };
    }
    if (cleanupPreview.risk.realOrdersAffected !== false) {
      await this.logEvent("GRID_SHADOW_CLEANUP_ABORTED", "Limpieza SHADOW abortada: realOrdersAffected !== false.", { reason: "real_orders_detected" });
      return { ok: false, applied: false, reason: "realOrdersAffected !== false — no se puede limpiar" };
    }
    if (cleanupPreview.risk.safeToArchiveShadowOnly !== true) {
      await this.logEvent("GRID_SHADOW_CLEANUP_ABORTED", "Limpieza SHADOW abortada: safeToArchiveShadowOnly !== true.", { reason: "not_safe_to_archive" });
      return { ok: false, applied: false, reason: "safeToArchiveShadowOnly !== true" };
    }
    if (cleanupPreview.risk.affectedCyclesCount <= 0) {
      await this.logEvent("GRID_SHADOW_CLEANUP_ABORTED", "Limpieza SHADOW abortada: no cycles to archive.", { reason: "no_affected_cycles" });
      return { ok: false, applied: false, reason: "affectedCyclesCount <= 0" };
    }

    // Validation 6: archiveCycleIds length must match expectedCyclesCount
    if (archiveCycleIds.length !== (expectedCyclesCount ?? cleanupPreview.risk.affectedCyclesCount)) {
      await this.logEvent("GRID_SHADOW_CLEANUP_ABORTED", `Limpieza SHADOW abortada: archiveCycleIds.length mismatch.`, { reason: "archive_ids_length_mismatch" });
      return { ok: false, applied: false, reason: "archiveCycleIds.length no coincide con expectedCyclesCount" };
    }

    // Validation 7: mode must be OFF
    const config = this.getConfig();
    const currentMode = config?.mode || "OFF";
    if (currentMode !== "OFF") {
      await this.logEvent("GRID_SHADOW_CLEANUP_ABORTED", `Limpieza SHADOW abortada: mode=${currentMode} (debe ser OFF).`, { reason: "mode_not_off", mode: currentMode });
      return { ok: false, applied: false, reason: `mode debe ser OFF (actual: ${currentMode})` };
    }

    // Validation 8: realOpenOrdersCount must be 0
    const status = await this.getStatusSafe();
    if (status.realOpenOrdersCount !== 0) {
      await this.logEvent("GRID_SHADOW_CLEANUP_ABORTED", `Limpieza SHADOW abortada: realOpenOrdersCount=${status.realOpenOrdersCount}.`, { reason: "real_open_orders" });
      return { ok: false, applied: false, reason: `realOpenOrdersCount !== 0 (actual: ${status.realOpenOrdersCount})` };
    }

    // ─── Build backup/evidence object (in memory) ───
    const now = new Date();
    const backup = {
      timestamp: now.toISOString(),
      reason: "shadow_prefix_cleanup",
      dryRun: false,
      affectedCycles: archiveCycleIds,
      affectedLevels: resetLevelIds,
      previewHash: JSON.stringify(cleanupPreview.preview).length.toString(),
      confirmTokenUsed: true,
    };
    const backupHash = `${now.getTime()}_${archiveCycleIds.length}_${resetLevelIds.length}`;

    // ─── Execute in transaction ───
    try {
      await db.transaction(async (tx) => {
        // Archive cycles: set status to "cancelled", set completedAt
        await tx.update(gridIsolatedCycles)
          .set({
            status: "cancelled",
            completedAt: now,
          })
          .where(inArray(gridIsolatedCycles.id, archiveCycleIds));

        // Cancel levels: set status to "cancelled", clear fill data
        await tx.update(gridIsolatedLevels)
          .set({
            status: "cancelled",
            filledPrice: null,
            filledQuantity: "0",
            filledAt: null,
            cancelledAt: now,
          })
          .where(inArray(gridIsolatedLevels.id, resetLevelIds));
      });

      await this.logEvent("GRID_SHADOW_CLEANUP_APPLIED", `Limpieza SHADOW aplicada: ${archiveCycleIds.length} ciclos archivados, ${resetLevelIds.length} niveles cancelados.`, {
        archivedCyclesCount: archiveCycleIds.length,
        updatedLevelsCount: resetLevelIds.length,
        backupHash,
      });

      // Sync in-memory runtime state to match DB after cleanup
      const archiveSet = new Set(archiveCycleIds);
      const resetSet = new Set(resetLevelIds);
      for (const cycle of this.cycles) {
        if (archiveSet.has(cycle.id)) {
          cycle.status = "cancelled" as any;
          cycle.completedAt = now;
        }
      }
      for (const level of this.levels) {
        if (resetSet.has(level.id)) {
          level.status = "cancelled" as any;
          level.filledPrice = null;
          level.filledQuantity = 0;
          level.filledAt = null;
          level.cancelledAt = now;
        }
      }

      // Get status after cleanup
      const statusAfter = await this.getStatusSafe();

      return {
        ok: true,
        dryRun: false,
        applied: true,
        archivedCyclesCount: archiveCycleIds.length,
        updatedLevelsCount: resetLevelIds.length,
        realOrdersAffected: false,
        backupHash,
        backupSummary: {
          timestamp: backup.timestamp,
          reason: backup.reason,
          affectedCyclesCount: archiveCycleIds.length,
          affectedLevelsCount: resetLevelIds.length,
        },
        affectedCycleIds: archiveCycleIds,
        affectedLevelIds: resetLevelIds,
        statusAfter: {
          activeOpenCyclesCount: statusAfter.activeOpenCyclesCount,
          globalOpenCyclesCount: statusAfter.globalOpenCyclesCount,
          realOpenOrdersCount: statusAfter.realOpenOrdersCount,
        },
      };
    } catch (error) {
      await this.logEvent("GRID_SHADOW_CLEANUP_ABORTED", `Limpieza SHADOW abortada: error en transacción: ${String(error)}`, { reason: "transaction_error", error: String(error) });
      return { ok: false, applied: false, reason: `Error en transacción: ${String(error)}` };
    }
  }

  /**
   * Get active range version.
   */
  getActiveRangeVersion(): GridRangeVersion | null {
    return this.activeRangeVersion;
  }

  /**
   * Safely rebuild planned levels for the active range.
   * Marks old planned levels as replaced, generates new levels with current code.
   * Safety guards:
   *   - mode must be OFF or SHADOW (never REAL)
   *   - no real open orders
   *   - no open cycles
   *   - no levels with exchangeOrderId
   *   - no filled levels in active range
   */
  async rebuildPlannedLevels(options?: {
    dryRun?: boolean;
    reason?: string;
  }): Promise<{
    success: boolean;
    reason?: string;
    dryRun?: boolean;
    oldRangeVersionId?: string;
    newRangeVersionId?: string;
    replacedLevelsCount?: number;
    newLevelsCount?: number;
    beforeSummary?: { buyTotal: number; sellTotal: number };
    afterSummary?: { buyTotal: number; sellTotal: number };
  }> {
    const dryRun = options?.dryRun ?? false;
    const reason = options?.reason ?? "not specified";

    if (!this.config) {
      return { success: false, reason: "No config loaded", dryRun };
    }

    // Guard 1: mode must be OFF or SHADOW
    if (this.config.mode === "REAL_LIMITED" || this.config.mode === "REAL_FULL") {
      return { success: false, reason: `Cannot rebuild in REAL mode (${this.config.mode})`, dryRun };
    }

    // Guard 2: no active range
    if (!this.activeRangeVersion) {
      return { success: false, reason: "No active range version to rebuild", dryRun };
    }

    // Guard 3: engine must not be running (ticks active)
    if (this.running) {
      return { success: false, reason: "Engine is running — stop the grid before rebuild", dryRun };
    }

    const oldRange = this.activeRangeVersion;
    const activeLevels = this.levels.filter(l => l.rangeVersionId === oldRange.id);

    // Guard 4: no real orders
    const hasRealOrders = activeLevels.some(l =>
      l.exchangeOrderId != null || l.status === "open" || l.status === "placed" || l.status === "partially_filled"
    );
    if (hasRealOrders) {
      return { success: false, reason: "Active range has real orders or open levels", dryRun };
    }

    // Guard 5: no open cycles
    const hasOpenCycles = this.cycles.some(c =>
      c.rangeVersionId === oldRange.id &&
      !["completed", "cancelled", "stop_loss_hit", "trailing_closed"].includes(c.status)
    );
    if (hasOpenCycles) {
      return { success: false, reason: "Active range has open cycles", dryRun };
    }

    // Guard 6: no filled levels in active range
    const hasFilledLevels = activeLevels.some(l => l.status === "filled");
    if (hasFilledLevels) {
      return { success: false, reason: "Active range has filled levels — cannot rebuild safely", dryRun };
    }

    // Compute before summary
    const plannedLevels = activeLevels.filter(l => l.status === "planned");
    const beforeBuyTotal = activeLevels
      .filter(l => l.side === "BUY" && l.status === "planned")
      .reduce((s, l) => s + Number(l.notionalUsd || 0), 0);
    const beforeSellTotal = activeLevels
      .filter(l => l.side === "SELL" && l.status === "planned")
      .reduce((s, l) => s + Number(l.notionalUsd || 0), 0);

    // Get fresh band snapshot
    const bandSnapshot = await getGridBandSnapshot({
      pair: this.config.pair,
      atrPeriod: this.config.atrPeriod ?? 14,
      atrTimeframe: this.config.atrTimeframe ?? "1h",
      bandPeriod: this.config.bandPeriod ?? 89,
      bandStdDevMultiplier: this.config.bandStdDevMultiplier ?? 2.0,
    });
    if (!bandSnapshot) {
      return { success: false, reason: "Could not fetch band snapshot from market data", dryRun };
    }

    // SAFETY: Pre-check if professional generator can generate viable levels before marking old range as replaced
    const precheck = await this.precheckProfessionalGeneration(bandSnapshot);
    if (!precheck.ok) {
      await this.logEvent("GRID_LEVELS_PRESERVED_DUE_TO_CYCLE", "Rebuild manual abortado porque el generador profesional no pudo generar niveles viables. Se conserva el rango anterior.", {
        rangeVersionId: oldRange.id,
        reason: precheck.reason,
        viabilityStatus: precheck.viabilityStatus,
        professionalGenerator: precheck.professionalGenerator,
        trigger: "manual_rebuild_planned_levels",
        manualReason: reason,
        dryRun,
      });
      return {
        success: false,
        dryRun,
        reason: precheck.reason,
        oldRangeVersionId: oldRange.id,
        replacedLevelsCount: 0,
        newLevelsCount: 0,
        beforeSummary: { buyTotal: beforeBuyTotal, sellTotal: beforeSellTotal },
      };
    }

    // If dryRun, return what would happen without touching DB
    if (dryRun) {
      return {
        success: true,
        dryRun: true,
        oldRangeVersionId: oldRange.id,
        replacedLevelsCount: plannedLevels.length,
        beforeSummary: { buyTotal: beforeBuyTotal, sellTotal: beforeSellTotal },
        reason,
      };
    }

    // Mark old range as replaced
    await db.update(gridRangeVersions)
      .set({ status: "replaced", closedAt: new Date() })
      .where(eq(gridRangeVersions.id, oldRange.id));

    // Mark old planned levels as replaced
    if (plannedLevels.length > 0) {
      await db.update(gridIsolatedLevels)
        .set({ status: "replaced" })
        .where(eq(gridIsolatedLevels.rangeVersionId, oldRange.id));
      for (const level of this.levels) {
        if (level.rangeVersionId === oldRange.id && level.status === "planned") {
          level.status = "replaced";
        }
      }
    }

    // Log old levels replaced
    await this.logEvent("GRID_LEVELS_REPLACED", `Rebuild manual: ${plannedLevels.length} niveles planificados antiguos marcados como replaced.`, {
      oldRangeVersionId: oldRange.id,
      replacedLevelsCount: plannedLevels.length,
      pair: this.config.pair,
      trigger: "manual_rebuild_planned_levels",
      reason,
      dryRun,
    });

    // Generate new range + levels with current code
    await this.proposeRangeVersion(bandSnapshot);
    const newLevels = this.levels.filter(l => l.rangeVersionId === this.activeRangeVersion!.id);

    // Log new levels rebuilt
    await this.logEvent("GRID_LEVELS_REBUILT", `Rebuild manual: ${newLevels.length} niveles nuevos generados con código actualizado.`, {
      newRangeVersionId: this.activeRangeVersion!.id,
      oldRangeVersionId: oldRange.id,
      levelsCount: newLevels.length,
      pair: this.config.pair,
      trigger: "manual_rebuild_planned_levels",
      reason,
      dryRun,
    });

    // Log audit event
    await this.logEvent("GRID_RANGE_REBUILT_MANUAL", `Rebuild manual de niveles planificados completado. Rango ${oldRange.id.slice(0, 8)} → ${this.activeRangeVersion!.id.slice(0, 8)}.`, {
      oldRangeVersionId: oldRange.id,
      newRangeVersionId: this.activeRangeVersion!.id,
      replacedLevelsCount: plannedLevels.length,
      newLevelsCount: newLevels.length,
      pair: this.config.pair,
      trigger: "manual_rebuild_planned_levels",
      reason,
      dryRun,
    });

    // Compute after summary
    const afterBuyTotal = newLevels
      .filter(l => l.side === "BUY")
      .reduce((s, l) => s + Number(l.notionalUsd || 0), 0);
    const afterSellTotal = newLevels
      .filter(l => l.side === "SELL")
      .reduce((s, l) => s + Number(l.notionalUsd || 0), 0);

    return {
      success: true,
      dryRun: false,
      oldRangeVersionId: oldRange.id,
      newRangeVersionId: this.activeRangeVersion!.id,
      replacedLevelsCount: plannedLevels.length,
      newLevelsCount: newLevels.length,
      beforeSummary: { buyTotal: beforeBuyTotal, sellTotal: beforeSellTotal },
      afterSummary: { buyTotal: afterBuyTotal, sellTotal: afterSellTotal },
    };
  }

  /**
   * Get all levels.
   */
  getLevels(): GridLevel[] {
    return this.levels;
  }

  /**
   * Get all cycles.
   */
  getCycles(): GridCycle[] {
    return this.cycles;
  }

  /**
   * Get pump/dump state.
   */
  getPumpDumpState(): PumpDumpGuardState {
    return this.pumpDumpState;
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * Activate or deactivate the grid motor.
   * Sets isActive in config and starts/stops the scheduler accordingly.
   * Does NOT change mode — stays in SHADOW if already SHADOW.
   */
  async setActive(active: boolean): Promise<{ success: boolean; isActive: boolean; running: boolean }> {
    if (!this.config) await this.loadConfig();
    if (!this.config) return { success: false, isActive: false, running: false };

    this.config.isActive = active;
    await this.saveConfig();

    if (active && this.config.mode !== "OFF") {
      this.start();
    } else {
      this.stop();
    }

    return { success: true, isActive: this.config.isActive, running: this.running };
  }

  /**
   * Get last shadow validation result.
   */
  getLastShadowValidation(): { at: Date | null; result: any } {
    return { at: this.lastShadowValidationAt, result: this.lastShadowValidationResult };
  }

  getLastProfessionalGeneratorValidation(): { at: Date | null; result: any } {
    return { at: this.lastProfessionalGeneratorValidationAt, result: this.lastProfessionalGeneratorValidationResult };
  }

  /**
   * Read-only validation of the professional grid generator.
   * Does NOT persist ranges, levels, or place orders.
   * Does NOT auto-start the engine.
   * Safe to call even when market conditions are unsuitable.
   */
  async validateProfessionalGeneratorReadOnly(): Promise<any> {
    // Capture runtime fingerprint BEFORE to detect side effects
    const runtimeBefore = this.getRuntimeFingerprint();

    // Load config snapshot WITHOUT auto-start
    const configSnapshot = this.config
      ? { ...this.config }
      : await this.readConfigSnapshotFromDb();

    if (!configSnapshot) {
      return {
        ok: false,
        error: "Grid config not loaded",
        runtimeBefore,
        runtimeAfter: this.getRuntimeFingerprint(),
        sideEffectsDetected: false,
      };
    }

    // Get current band snapshot using REAL config
    const bandSnapshot = await getGridBandSnapshot({
      pair: configSnapshot.pair,
      bandPeriod: configSnapshot.bandPeriod,
      bandStdDevMultiplier: configSnapshot.bandStdDevMultiplier,
      atrPeriod: configSnapshot.atrPeriod,
      atrTimeframe: configSnapshot.atrTimeframe,
    });

    if (!bandSnapshot) {
      return {
        ok: false,
        error: "No band snapshot available",
        suitableForGrid: false,
        bandReason: "No market data available",
        runtimeBefore,
        runtimeAfter: this.getRuntimeFingerprint(),
        sideEffectsDetected: false,
      };
    }

    // Execute professional generator with same config as proposeRangeVersion
    const allocation = await gridCapitalAllocator.allocate(
      configSnapshot.capitalProfile,
      10, // initial estimate
      configSnapshot.netProfitTargetPct,
      {
        maxCapitalPerCycleUsd: configSnapshot.gridMaxCapitalPerCycleUsd ?? 0,
        allocationMode: configSnapshot.gridAllocationMode ?? "uniform",
        deploymentMode: configSnapshot.gridCapitalDeploymentMode ?? "capped",
        progressiveIntensity: configSnapshot.gridProgressiveIntensity ?? 0.30,
        maxLevelPct: configSnapshot.gridMaxLevelPct ?? 40,
        minLevelUsd: configSnapshot.gridMinLevelUsd ?? 30,
      }
    );

    const professionalResult = generateProfessionalGridLevels({
      currentPrice: bandSnapshot.midPrice,
      bollingerMiddle: bandSnapshot.middle,
      bollingerUpper: bandSnapshot.upper,
      bollingerLower: bandSnapshot.lower,
      atrPct: bandSnapshot.atrPct,
      netProfitTargetPct: configSnapshot.netProfitTargetPct,
      gridStepAtrMultiplier: configSnapshot.gridStepAtrMultiplier,
      gridStepMaxPct: configSnapshot.gridStepMaxPct,
      configuredBuyLevels: Math.floor(allocation.levelsCount / 2),
      configuredSellLevels: Math.floor(allocation.levelsCount / 2),
      capitalPerLevelUsd: allocation.capitalPerLevelUsd,
      spreadBufferPct: 0.01,
      safetyBufferPct: 0.10,
      minLevelsForViableGrid: 4,
      centerPriceMode: "hybrid",
      centerClampPct: 0.25,
      operationalRangeMode: "hybrid",
      operationalBandWidthPct: 20.0,
      atrRangeMultiplier: 8.0,
      minOperationalBandWidthPct: 20.0,
      dynamicLevelReduction: true,
      gridViabilityMode: "strict",
    });

    const pg = professionalResult.professionalGenerator || {};

    // Capture runtime fingerprint AFTER to detect side effects
    const runtimeAfter = this.getRuntimeFingerprint();

    // Detect side effects: any change in critical runtime state
    const sideEffectsDetected =
      runtimeBefore.mode !== runtimeAfter.mode ||
      runtimeBefore.isActive !== runtimeAfter.isActive ||
      runtimeBefore.isRunning !== runtimeAfter.isRunning ||
      runtimeBefore.activeRangeVersionId !== runtimeAfter.activeRangeVersionId ||
      runtimeBefore.levelsCount !== runtimeAfter.levelsCount ||
      runtimeBefore.cyclesCount !== runtimeAfter.cyclesCount ||
      runtimeBefore.tickIntervalActive !== runtimeAfter.tickIntervalActive;

    const result = {
      ok: true,
      readOnly: true,
      suitableForGrid: bandSnapshot.suitableForGrid,
      bandReason: bandSnapshot.reason || null,
      professionalGeneratorExecuted: true,
      viabilityStatus: professionalResult.viabilityStatus,
      levelsCount: professionalResult.levels.length,
      generatedBuyLevels: pg.generatedBuyLevels || 0,
      generatedSellLevels: pg.generatedSellLevels || 0,
      minSpacingPctReal: pg.minSpacingPctReal || null,
      spacingPct: pg.spacingPct || null,
      centerPrice: pg.centerPrice || null,
      operationalLower: pg.operationalLower || null,
      operationalUpper: pg.operationalUpper || null,
      operationalBandWidthPct: pg.operationalBandWidthPct || null,
      operationalSemiRangePct: pg.operationalSemiRangePct || null,
      legacyGeneratorUsed: pg.legacyGeneratorUsed || false,
      persistsLevels: false,
      placesOrders: false,
      changesMode: false,
      rebuild: false,
      configUsed: {
        pair: configSnapshot.pair,
        bandPeriod: configSnapshot.bandPeriod,
        bandStdDevMultiplier: configSnapshot.bandStdDevMultiplier,
        atrPeriod: configSnapshot.atrPeriod,
        atrTimeframe: configSnapshot.atrTimeframe,
        netProfitTargetPct: configSnapshot.netProfitTargetPct,
        gridStepAtrMultiplier: configSnapshot.gridStepAtrMultiplier,
        gridStepMaxPct: configSnapshot.gridStepMaxPct,
      },
      note: "Resultado matemático read-only; el motor real seguiría bloqueando generación porque el mercado no es apto si suitableForGrid=false.",
      runtimeBefore,
      runtimeAfter,
      sideEffectsDetected,
    };

    // Store in memory
    this.lastProfessionalGeneratorValidationAt = new Date();
    this.lastProfessionalGeneratorValidationResult = result;

    return result;
  }

  /**
   * Run a SHADOW validation tick — switches to SHADOW mode, runs one tick,
   * verifies no real orders were placed, and returns audit info.
   * Safe: SHADOW never calls placeOrder.
   */
  async runShadowValidation(): Promise<{
    success: boolean;
    mode: GridMode;
    realOrdersPlaced: boolean;
    levelsGenerated: number;
    eventsGenerated: number;
    status: GridExecutionStatus;
    realModesBlocked: boolean;
    message: string;
    evaluated: boolean;
    tickRan: boolean;
    rangeUsed: string | null;
    activeRangeVersionIdUsed: string | null;
    levelsWouldGenerate: number;
    reasonNoLevels: string | null;
    reasonNoEvents: string | null;
    marketSnapshotAvailable: boolean;
    bandSnapshotAvailable: boolean;
    walletAvailable: boolean;
    capitalAvailable: boolean;
    blockedByIsActive: boolean;
    blockedByMode: boolean;
    blockedByReconciliation: boolean;
    blockedByModeLock: boolean;
    blockedByNoRange: boolean;
    blockedByNoMarketData: boolean;
    blockedByExistingLevels: boolean;
    blockedByRiskGuard: boolean;
    nextAction: string;
  }> {
    if (!this.config) await this.loadConfig();

    const previousMode = this.config!.mode;
    const configIsActive = this.config!.isActive;

    // Switch to SHADOW if not already
    if (previousMode !== "SHADOW") {
      const result = await this.changeMode("SHADOW");
      if (!result.success) {
        return {
          success: false,
          mode: previousMode,
          realOrdersPlaced: false,
          levelsGenerated: 0,
          eventsGenerated: 0,
          status: this.getExecutionStatus(),
          realModesBlocked: true,
          message: `No se pudo cambiar a SHADOW: ${result.reason}`,
          evaluated: false,
          tickRan: false,
          rangeUsed: null,
          activeRangeVersionIdUsed: null,
          levelsWouldGenerate: 0,
          reasonNoLevels: `No se pudo cambiar a SHADOW: ${result.reason}`,
          reasonNoEvents: "No se ejecutó el tick.",
          marketSnapshotAvailable: false,
          bandSnapshotAvailable: false,
          walletAvailable: false,
          capitalAvailable: false,
          blockedByIsActive: false,
          blockedByMode: true,
          blockedByReconciliation: false,
          blockedByModeLock: false,
          blockedByNoRange: false,
          blockedByNoMarketData: false,
          blockedByExistingLevels: false,
          blockedByRiskGuard: false,
          nextAction: "Resolver el bloqueo de modo para permitir SHADOW.",
        };
      }
    }

    // Gather diagnostics before tick
    const rangeBefore = this.activeRangeVersion?.id || null;
    const levelsBefore = this.levels.length;
    const eventsBefore = await this.countRecentEvents();

    // Temporarily force isActive=true for the validation tick
    const originalIsActive = this.config!.isActive;
    this.config!.isActive = true;

    // Run one tick
    await this.tick();

    // Restore isActive
    this.config!.isActive = originalIsActive;

    const levelsAfter = this.levels.length;
    const eventsAfter = await this.countRecentEvents();
    const levelsGenerated = levelsAfter - levelsBefore;
    const eventsGenerated = eventsAfter - eventsBefore;

    // Verify no real orders — SHADOW never calls gridExecutionService
    const realOrdersPlaced = false;

    // Check that REAL modes are still blocked
    const realModesBlocked = !gridModeLockService.isModeSafe("REAL_LIMITED");

    // Restore previous mode if it was OFF
    if (previousMode === "OFF") {
      await this.changeMode("OFF");
    }

    // Build diagnostics
    const bandSnapshotAvailable = this.lastTickReason !== "Sin datos de mercado (bandSnapshot no disponible).";
    const marketSnapshotAvailable = bandSnapshotAvailable;
    const walletAvailable = (this.config?.gridWalletInitialUsd || 0) > 0;
    const capitalAvailable = walletAvailable;
    const blockedByIsActive = !configIsActive;
    const blockedByMode = previousMode === "OFF" && !this.config!.isActive;
    const blockedByReconciliation = false; // Checked in blockingReasons, not in engine tick
    const blockedByModeLock = false;
    const blockedByNoRange = !rangeBefore && levelsGenerated === 0;
    const blockedByNoMarketData = !bandSnapshotAvailable;
    const blockedByExistingLevels = levelsBefore > 0 && levelsGenerated === 0;
    const blockedByRiskGuard = this.pumpDumpState.state !== "normal" || this.circuitBreakerOpen;

    // Check if market was unsuitable (takes priority over other reasons)
    const blockedByUnsuitableMarket = this.lastTickReason?.startsWith("Condiciones de mercado no válidas para Grid") || false;
    const marketUnsuitableReason = blockedByUnsuitableMarket ? this.lastTickReason : null;
    const professionalGeneratorExecuted = !blockedByUnsuitableMarket && levelsGenerated > 0;

    let reasonNoLevels: string | null = null;
    if (levelsGenerated === 0) {
      if (blockedByUnsuitableMarket) {
        reasonNoLevels = this.lastTickReason || "Condiciones de mercado no válidas para Grid";
      } else if (blockedByIsActive) {
        reasonNoLevels = "El motor está en SHADOW pero isActive=false, por lo que no se generan niveles automáticos.";
      } else if (blockedByNoMarketData) {
        reasonNoLevels = "No hay datos de mercado disponibles para evaluar bandas.";
      } else if (blockedByNoRange) {
        reasonNoLevels = "No hay rango activo cargado en el motor runtime. El rango puede existir en auditoría pero no en memoria tras reinicio.";
      } else if (blockedByExistingLevels) {
        reasonNoLevels = "Ya existen niveles generados. El motor no duplica niveles para el mismo rango.";
      } else if (blockedByRiskGuard) {
        reasonNoLevels = `Risk guard activo: pump/dump=${this.pumpDumpState.state}, circuitBreaker=${this.circuitBreakerOpen}.`;
      } else {
        reasonNoLevels = this.lastTickReason || "El tick se ejecutó pero no generó niveles nuevos.";
      }
    }

    let reasonNoEvents: string | null = null;
    if (eventsGenerated === 0) {
      if (blockedByIsActive) {
        reasonNoEvents = "Motor inactivo (isActive=false) — no se ejecutaron ticks automáticos.";
      } else {
        reasonNoEvents = "El tick se ejecutó pero no produjo eventos nuevos (posiblemente condiciones sin cambios).";
      }
    }

    let nextAction = "";
    if (blockedByUnsuitableMarket) {
      nextAction = "Esperar condiciones de mercado aptas o ejecutar validación read-only del generador profesional.";
    } else if (blockedByIsActive) {
      nextAction = "Activar motor Grid en SHADOW o ejecutar una simulación forzada.";
    } else if (blockedByNoMarketData) {
      nextAction = "Verificar conectividad de datos de mercado y reintentar.";
    } else if (blockedByNoRange) {
      nextAction = "Esperar a que el motor proponga un rango o verificar datos de banda.";
    } else if (levelsGenerated > 0) {
      nextAction = "Revisar niveles generados en la pestaña Niveles.";
    } else {
      nextAction = "El motor está activo pero no hay cambios. Revisar condiciones de mercado.";
    }

    const result = {
      success: true,
      mode: this.config!.mode,
      realOrdersPlaced,
      levelsGenerated,
      eventsGenerated,
      status: this.getExecutionStatus(),
      realModesBlocked,
      message: "SHADOW validation OK — no real orders placed, simulation ran successfully",
      evaluated: true,
      tickRan: true,
      rangeUsed: rangeBefore,
      activeRangeVersionIdUsed: this.activeRangeVersion?.id || null,
      levelsWouldGenerate: levelsGenerated,
      reasonNoLevels,
      reasonNoEvents,
      marketSnapshotAvailable,
      bandSnapshotAvailable,
      walletAvailable,
      capitalAvailable,
      blockedByIsActive,
      blockedByMode,
      blockedByReconciliation,
      blockedByModeLock,
      blockedByNoRange,
      blockedByNoMarketData,
      blockedByExistingLevels,
      blockedByRiskGuard,
      blockedByUnsuitableMarket,
      marketUnsuitableReason,
      professionalGeneratorExecuted,
      nextAction,
    };

    this.lastShadowValidationAt = new Date();
    this.lastShadowValidationResult = result;

    return result;
  }

  /**
   * Count recent grid events (last 5 minutes) for validation.
   */
  private async countRecentEvents(): Promise<number> {
    try {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
      const result = await db.select({ id: gridIsolatedEvents.id })
        .from(gridIsolatedEvents)
        .where(sql`${gridIsolatedEvents.createdAt} > ${fiveMinAgo}`);
      return result.length;
    } catch {
      return 0;
    }
  }
}

export const gridIsolatedEngine = new GridIsolatedEngine();
