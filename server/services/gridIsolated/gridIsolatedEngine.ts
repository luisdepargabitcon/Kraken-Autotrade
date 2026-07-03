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
import { eq, desc, and, isNull, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { botLogger } from "../botLogger";
import { MarketDataService } from "../MarketDataService";
import { ExchangeFactory } from "../exchanges/ExchangeFactory";
import { gridModeLockService } from "./gridModeLockService";
import { gridCapitalAllocator } from "./gridCapitalAllocator";
import { getGridBandSnapshot } from "./gridBandAdapter";
import {
  generateGeometricLevels,
  toGridLevels,
  computeAdaptiveRatio,
} from "./gridGeometricLevels";
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

  /**
   * Load config from DB or create default.
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
        };
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
   */
  private async tick(): Promise<void> {
    if (!this.config || this.config.mode === "OFF") return;

    // Reset daily order count if needed
    this.checkDailyOrderReset();

    // Check circuit breaker
    if (this.circuitBreakerOpen) {
      if (this.circuitBreakerOpenedAt && Date.now() - this.circuitBreakerOpenedAt.getTime() < CIRCUIT_BREAKER_RETRY_DELAY_MS) {
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

    if (!bandSnapshot) return;

    // Check pump/dump guard
    await this.checkPumpDumpGuard(bandSnapshot.midPrice);

    if (!bandSnapshot.suitableForGrid) {
      // Pause active range if conditions not suitable
      if (this.activeRangeVersion && this.activeRangeVersion.status === "active") {
        await this.pauseRangeVersion(bandSnapshot.reason);
      }
      return;
    }

    // If no active range, propose one
    if (!this.activeRangeVersion) {
      await this.proposeRangeVersion(bandSnapshot);
    }

    // In SHADOW mode: simulate fills
    if (this.config.mode === "SHADOW") {
      await this.simulateShadowTick(bandSnapshot.midPrice);
    }
  }

  /**
   * Propose a new range version based on band snapshot.
   */
  private async proposeRangeVersion(bandSnapshot: any): Promise<void> {
    if (!this.config) return;

    const allocation = await gridCapitalAllocator.allocate(
      this.config.capitalProfile,
      10, // initial estimate
      this.config.netProfitTargetPct
    );

    const generatedLevels = generateGeometricLevels({
      midPrice: bandSnapshot.midPrice,
      bandUpper: bandSnapshot.upper,
      bandLower: bandSnapshot.lower,
      atrPct: bandSnapshot.atrPct,
      bandWidthPct: bandSnapshot.bandWidthPct,
      netProfitTargetPct: this.config.netProfitTargetPct,
      gridStepAtrMultiplier: this.config.gridStepAtrMultiplier,
      gridStepMinPct: this.config.gridStepMinPct,
      gridStepMaxPct: this.config.gridStepMaxPct,
      geometricRatioMin: this.config.geometricRatioMin,
      geometricRatioMax: this.config.geometricRatioMax,
      capitalPerLevelUsd: allocation.capitalPerLevelUsd,
      maxLevels: allocation.levelsCount,
    });

    const rangeVersionId = randomUUID();
    const ratio = computeAdaptiveRatio(
      bandSnapshot.bandWidthPct,
      this.config.geometricRatioMin,
      this.config.geometricRatioMax
    );

    // Persist range version
    await db.insert(gridRangeVersions).values({
      id: rangeVersionId,
      versionNumber: await this.getNextVersionNumber(),
      pair: this.config.pair,
      status: "proposed",
      midPrice: bandSnapshot.midPrice.toFixed(8),
      upperPrice: bandSnapshot.upper.toFixed(8),
      lowerPrice: bandSnapshot.lower.toFixed(8),
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
      midPrice: bandSnapshot.midPrice,
      upperPrice: bandSnapshot.upper,
      lowerPrice: bandSnapshot.lower,
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

    await this.logEvent("GRID_RANGE_PROPOSED", `Range proposed: ${generatedLevels.length} levels, mid=${bandSnapshot.midPrice}`, {
      rangeVersionId, levelsCount: generatedLevels.length, regime: bandSnapshot.regime,
    });
    await this.logEvent("GRID_RANGE_ACTIVATED", `Range activated: ${rangeVersionId}`, {
      rangeVersionId, mode: this.config.mode,
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

    await this.logEvent("GRID_RANGE_PAUSED", `Range paused: ${reason}`, {
      rangeVersionId: this.activeRangeVersion.id, reason,
    });
  }

  /**
   * SHADOW mode simulation — check if price would have filled any levels.
   */
  private async simulateShadowTick(currentPrice: number): Promise<void> {
    if (!this.activeRangeVersion || !this.config) return;

    for (const level of this.levels) {
      if (level.status !== "planned" && level.status !== "open") continue;

      let filled = false;
      if (level.side === "BUY" && currentPrice <= level.price) {
        filled = true;
      } else if (level.side === "SELL" && currentPrice >= level.price) {
        filled = true;
      }

      if (filled) {
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
   * Process a fill and create/complete cycles.
   */
  private async processCycleFill(level: GridLevel, fillPrice: number): Promise<void> {
    if (!this.activeRangeVersion || !this.config) return;

    if (level.side === "BUY") {
      // Create new cycle
      const cycle: GridCycle = {
        id: randomUUID(),
        rangeVersionId: this.activeRangeVersion.id,
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
      // Find oldest open cycle (buy_filled, no sell yet)
      const openCycle = this.cycles.find(c => c.status === "buy_filled");
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
   */
  getExecutionStatus(): GridExecutionStatus {
    const openLevels = this.levels.filter(l => l.status === "open" || l.status === "planned").length;
    const openCycles = this.cycles.filter(c => c.status !== "completed" && c.status !== "cancelled").length;
    const totalNetPnl = this.cycles.reduce((sum, c) => sum + c.netPnlUsd, 0);
    const completedCycles = this.cycles.filter(c => c.status === "completed").length;

    return {
      mode: this.config?.mode || "OFF",
      activeRangeVersionId: this.activeRangeVersion?.id || null,
      openLevels,
      openCycles,
      dailyOrderCount: this.dailyOrderCount,
      circuitBreakerOpen: this.circuitBreakerOpen,
      pumpDumpState: this.pumpDumpState.state,
      lastReconciliationAt: null,
      lastReconciliationOk: null,
      capitalReservedUsd: 0,
      capitalAvailableUsd: 0,
      totalNetPnlUsd: totalNetPnl,
      totalCyclesCompleted: completedCycles,
    };
  }

  /**
   * Get current config.
   */
  getConfig(): GridIsolatedConfig | null {
    return this.config;
  }

  /**
   * Get active range version.
   */
  getActiveRangeVersion(): GridRangeVersion | null {
    return this.activeRangeVersion;
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
}

export const gridIsolatedEngine = new GridIsolatedEngine();
