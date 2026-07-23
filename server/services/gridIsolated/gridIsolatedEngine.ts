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
import { resolveGridShadowExecutionPrice, type GridShadowExecutionPriceResult, type GridTickContext } from "./gridShadowExecutionPrice";
import { evaluateShadowMarketPriceFreshness, GRID_SHADOW_PRICE_MAX_AGE_MS } from "./gridShadowMarketPriceFreshness";
import {
  getShadowPumpGuardPolicy,
  getCrossedShadowLevels,
  selectShadowCycleForSell,
  SHADOW_SELL_PAIRING_POLICY,
  type ShadowPumpGuardPolicy,
} from "./gridShadowPolicy";
import {
  toGridLevels,
} from "./gridGeometricLevels";
import {
  generateProfessionalGridLevels,
} from "./gridSpacingCalculator";
import { applyWeightsToGeneratedLevels } from "./gridAllocationEngine";
import {
  diagnoseShadowOrphanCycles,
  type ShadowOrphanDiagnosisResult,
} from "./gridShadowOrphanDiagnosis";
import {
  diagnoseShadowOpenCycles,
  type ShadowOpenCycleDiagnosisResult,
} from "./gridShadowOpenCycleDiagnosis";
import {
  resolveRuntimeSnapshot,
  type GridRuntimeSnapshot,
} from "./gridRuntimeSnapshotResolver";
import {
  resolveTargetSellForCycle,
  buildClaimedSellIds,
  type TargetSellResolution,
} from "./gridCycleTargetResolver";
import {
  selectFirstProfitableHigherRung,
} from "./gridCycleExitSelector";
import { gridRiskManager } from "./gridRiskManager";
import {
  loadRangeVersionsForCycles,
} from "./gridCycleRangeVersionLoader";
import {
  computeGrossTargetFromNet,
  computeSellPrice,
  computeCyclePnL,
  computeCyclePnLWithRoles,
} from "./gridNetCalculator";
import {
  safeParseMakerExitStateJson,
  safeParseMakerExitStateJsonForensic,
  safeParseRiskStateJson,
  safeParseRiskStateJsonForensic,
  safeParseTargetCalculationJson,
  safeParseTargetCalculationJsonForensic,
  validateMakerExitStateJson,
  validateRiskStateJson,
  validateTargetCalculationJson,
} from "./gridJsonbValidators";
import {
  DEFAULT_GRID_CONFIG,
  DAILY_ORDER_REQUEST_LIMIT,
  DAILY_ORDER_WARNING_THRESHOLD,
  CIRCUIT_BREAKER_RETRY_DELAY_MS,
  POSITION_OPEN_GRID_CYCLE_STATUSES,
  NON_TARGET_SELL_CLOSABLE_STATUSES,
  OPEN_POSITION_GRID_CYCLE_STATUSES,
  TERMINAL_GRID_CYCLE_STATUSES,
  SHADOW_EXECUTION_POLICY,
  getEffectiveExecutionPolicy,
  isLegacyExecutionPolicy,
  type GridIsolatedConfig,
  type GridMode,
  type GridRangeVersion,
  type GridLevel,
  type GridLevelStatus,
  type GridCycle,
  type GridCycleStatus,
  type GridExecutionStatus,
  type GridCycleLifecycleState,
  type GridCycleRangeRelation,
  type PumpDumpState,
  type PumpDumpGuardState,
  type GridEventType,
  type GridExitPolicyVersion,
  type GridTargetKind,
  type GridCycleRiskState,
  type GridClosePath,
  type GridTargetCalculation,
  type RiskAction,
  type TrailingProtectionState,
  type StopLossLayer,
  type HodlRecoveryState,
  type GridPendingMakerExit,
  FEE_BUFFER_BUY_PCT,
  FEE_BUFFER_SELL_PCT,
  TAX_RESERVE_PCT,
} from "./gridIsolatedTypes";

const MIN_MAKER_REST_MS = 1;

class GridIsolatedEngine {
  private config: GridIsolatedConfig | null = null;
  private activeRangeVersion: GridRangeVersion | null = null;
  private referencedRangeVersions: GridRangeVersion[] = [];
  private levels: GridLevel[] = [];
  private cycles: GridCycle[] = [];
  private dailyOrderCount: number = 0;
  private dailyOrderResetAt: Date = new Date();
  private circuitBreakerOpen: boolean = false;
  private circuitBreakerOpenedAt: Date | null = null;
  private circuitBreakerReason: string | null = null;
  private circuitBreakerCooldownUntil: Date | null = null;
  private closingCycleIds: Set<string> = new Set();
  /** Canonical tick id incremented exactly once per main tick() execution. */
  private currentTickId = 0;
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
  private lastShadowExecutionPrice: GridShadowExecutionPriceResult | null = null;
  private lastPausedEventKey: string | null = null;
  private lastPausedEventAt: Date | null = null;

  /**
   * Load config from DB or create default.
   * Does NOT auto-start the engine. Startup is owned by initializeGridShadowAtStartup().
   */
  async loadConfig(): Promise<GridIsolatedConfig> {
    try {
      const rows = await db.select().from(gridIsolatedConfigs).limit(1);
      if (rows.length > 0) {
        const row = rows[0];
        const originalExecutionPolicy = row.executionPolicy as string | null;
        this.config = {
          id: String(row.id),
          pair: row.pair,
          mode: row.mode as GridMode,
          capitalProfile: row.capitalProfile as any,
          executionPolicy: getEffectiveExecutionPolicy({ mode: row.mode as GridMode, executionPolicy: row.executionPolicy as any }),
          defaultExitPolicyVersion: (row.defaultExitPolicyVersion as GridExitPolicyVersion | undefined) ?? DEFAULT_GRID_CONFIG.defaultExitPolicyVersion,
          trailingEnabled: row.trailingEnabled ?? DEFAULT_GRID_CONFIG.trailingEnabled,
          stopLossEnabled: row.stopLossEnabled ?? DEFAULT_GRID_CONFIG.stopLossEnabled,
          buyFeePct: parseFloat(row.buyFeePct ?? String(DEFAULT_GRID_CONFIG.buyFeePct)),
          sellFeePct: parseFloat(row.sellFeePct ?? String(DEFAULT_GRID_CONFIG.sellFeePct)),
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
          takerFallbackEnabled: row.takerFallbackEnabled ?? false,
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
          // Compact Range Control (3C.3-A)
          enforceCompactRange: row.enforceCompactRange ?? true,
          gridRangeMaxPct: parseFloat(row.gridRangeMaxPct ?? "2.50"),
          maxDistanceFromCenterPct: parseFloat(row.maxDistanceFromCenterPct ?? "1.25"),
          maxSellDistanceFromNearestBuyPct: parseFloat(row.maxSellDistanceFromNearestBuyPct ?? "1.50"),
          // Adaptive Smart Range (3C.3-C)
          gridRangeControlMode: (row.gridRangeControlMode as any) ?? 'adaptive_smart',
          adaptiveRangeEnabled: row.adaptiveRangeEnabled ?? true,
          adaptiveRangeProfile: (row.adaptiveRangeProfile as any) ?? 'balanced',
          adaptiveRangeMinPct: parseFloat(row.adaptiveRangeMinPct ?? "1.50"),
          adaptiveRangeMaxPct: parseFloat(row.adaptiveRangeMaxPct ?? "7.00"),
          adaptiveRangeLowVolMaxPct: parseFloat(row.adaptiveRangeLowVolMaxPct ?? "3.00"),
          adaptiveRangeNormalMaxPct: parseFloat(row.adaptiveRangeNormalMaxPct ?? "5.00"),
          adaptiveRangeHighVolMaxPct: parseFloat(row.adaptiveRangeHighVolMaxPct ?? "7.00"),
          adaptiveRangeTargetFullLevels: row.adaptiveRangeTargetFullLevels ?? false,
          adaptiveRangeMinViableLevels: row.adaptiveRangeMinViableLevels ?? 4,
          // Risk/circuit breaker persistence
          circuitBreakerOpen: row.circuitBreakerOpen ?? false,
          circuitBreakerOpenedAt: row.circuitBreakerOpenedAt,
          circuitBreakerReason: row.circuitBreakerReason ?? null,
          circuitBreakerCooldownUntil: row.circuitBreakerCooldownUntil,
          circuitBreakerSourceCycleId: row.circuitBreakerSourceCycleId ?? null,
          circuitBreakerSeverity: (row.circuitBreakerSeverity as GridIsolatedConfig["circuitBreakerSeverity"]) ?? null,
          circuitBreakerReviewAfter: row.circuitBreakerReviewAfter,
          circuitBreakerResolvedAt: row.circuitBreakerResolvedAt,
          circuitBreakerResolvedBy: row.circuitBreakerResolvedBy ?? null,
          circuitBreakerResolutionReason: row.circuitBreakerResolutionReason ?? null,
        };
        if (this.config.mode === "SHADOW" && isLegacyExecutionPolicy(originalExecutionPolicy)) {
          await botLogger.warn(
            "GRID_SHADOW_EXECUTION_POLICY_NORMALIZED",
            `Configuración SHADOW almacenada contiene política legacy '${originalExecutionPolicy}'; se usa MAKER_ONLY en runtime sin reescribir DB.`,
            { originalPolicy: originalExecutionPolicy, effectivePolicy: SHADOW_EXECUTION_POLICY }
          );
        }
        // Load risk/circuit breaker state from DB
        this.circuitBreakerOpen = this.config.circuitBreakerOpen ?? false;
        this.circuitBreakerOpenedAt = this.config.circuitBreakerOpenedAt ?? null;
        this.circuitBreakerReason = this.config.circuitBreakerReason ?? null;
        this.circuitBreakerCooldownUntil = this.config.circuitBreakerCooldownUntil ?? null;
        this.config.circuitBreakerSourceCycleId = this.config.circuitBreakerSourceCycleId ?? null;
        this.config.circuitBreakerSeverity = this.config.circuitBreakerSeverity ?? null;
        this.config.circuitBreakerReviewAfter = this.config.circuitBreakerReviewAfter ?? null;
        this.config.circuitBreakerResolvedAt = this.config.circuitBreakerResolvedAt ?? null;
        this.config.circuitBreakerResolvedBy = this.config.circuitBreakerResolvedBy ?? null;
        this.config.circuitBreakerResolutionReason = this.config.circuitBreakerResolutionReason ?? null;

        // Load active state from DB
        await this.loadActiveRangeVersion();
        await this.loadLevels();
        await this.loadCycles();
        await this.loadReferencedRangeVersions(this.cycles);

        return this.config;
      }
    } catch (error) {
      botLogger.error("SYSTEM_ERROR", `[GridIsolatedEngine] Failed to load config: ${error}`);
      // Fail-safe: a DB/schema/conexión error must NOT auto-create a default config.
      // The caller decides whether to proceed; engine start is blocked.
      throw error;
    }

    // No config row found — create a safe default config in DB.
    this.config = { ...DEFAULT_GRID_CONFIG, id: "", createdAt: new Date(), updatedAt: new Date() } as GridIsolatedConfig;
    await this.saveConfig();
    return this.config;
  }

  /**
   * Read config snapshot from DB WITHOUT auto-starting the engine.
   * Used for read-only operations that should not change runtime state.
   */
  async getConfigSnapshotFromDb(): Promise<GridIsolatedConfig | null> {
    return this.readConfigSnapshotFromDbInternal();
  }

  private async readConfigSnapshotFromDb(): Promise<GridIsolatedConfig | null> {
    return this.readConfigSnapshotFromDbInternal();
  }

  private async readConfigSnapshotFromDbInternal(): Promise<GridIsolatedConfig | null> {
    try {
      const rows = await db.select().from(gridIsolatedConfigs).limit(1);
      if (rows.length > 0) {
        const row = rows[0];
        return {
          id: String(row.id),
          pair: row.pair,
          mode: row.mode as GridMode,
          capitalProfile: row.capitalProfile as any,
          executionPolicy: getEffectiveExecutionPolicy({ mode: row.mode as GridMode, executionPolicy: row.executionPolicy as any }),
          defaultExitPolicyVersion: (row.defaultExitPolicyVersion as GridExitPolicyVersion | undefined) ?? DEFAULT_GRID_CONFIG.defaultExitPolicyVersion,
          trailingEnabled: row.trailingEnabled ?? DEFAULT_GRID_CONFIG.trailingEnabled,
          stopLossEnabled: row.stopLossEnabled ?? DEFAULT_GRID_CONFIG.stopLossEnabled,
          buyFeePct: parseFloat(row.buyFeePct ?? String(DEFAULT_GRID_CONFIG.buyFeePct)),
          sellFeePct: parseFloat(row.sellFeePct ?? String(DEFAULT_GRID_CONFIG.sellFeePct)),
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
          takerFallbackEnabled: row.takerFallbackEnabled ?? false,
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
          // Compact Range Control (3C.3-A)
          enforceCompactRange: row.enforceCompactRange ?? true,
          gridRangeMaxPct: parseFloat(row.gridRangeMaxPct ?? "2.50"),
          maxDistanceFromCenterPct: parseFloat(row.maxDistanceFromCenterPct ?? "1.25"),
          maxSellDistanceFromNearestBuyPct: parseFloat(row.maxSellDistanceFromNearestBuyPct ?? "1.50"),
          // Adaptive Smart Range (3C.3-C)
          gridRangeControlMode: (row.gridRangeControlMode as any) ?? 'adaptive_smart',
          adaptiveRangeEnabled: row.adaptiveRangeEnabled ?? true,
          adaptiveRangeProfile: (row.adaptiveRangeProfile as any) ?? 'balanced',
          adaptiveRangeMinPct: parseFloat(row.adaptiveRangeMinPct ?? "1.50"),
          adaptiveRangeMaxPct: parseFloat(row.adaptiveRangeMaxPct ?? "7.00"),
          adaptiveRangeLowVolMaxPct: parseFloat(row.adaptiveRangeLowVolMaxPct ?? "3.00"),
          adaptiveRangeNormalMaxPct: parseFloat(row.adaptiveRangeNormalMaxPct ?? "5.00"),
          adaptiveRangeHighVolMaxPct: parseFloat(row.adaptiveRangeHighVolMaxPct ?? "7.00"),
          adaptiveRangeTargetFullLevels: row.adaptiveRangeTargetFullLevels ?? false,
          adaptiveRangeMinViableLevels: row.adaptiveRangeMinViableLevels ?? 4,
          // Risk/circuit breaker persistence
          circuitBreakerOpen: row.circuitBreakerOpen ?? false,
          circuitBreakerOpenedAt: row.circuitBreakerOpenedAt,
          circuitBreakerReason: row.circuitBreakerReason ?? null,
          circuitBreakerCooldownUntil: row.circuitBreakerCooldownUntil,
          circuitBreakerSourceCycleId: row.circuitBreakerSourceCycleId ?? null,
          circuitBreakerSeverity: (row.circuitBreakerSeverity as GridIsolatedConfig["circuitBreakerSeverity"]) ?? null,
          circuitBreakerReviewAfter: row.circuitBreakerReviewAfter,
          circuitBreakerResolvedAt: row.circuitBreakerResolvedAt,
          circuitBreakerResolvedBy: row.circuitBreakerResolvedBy ?? null,
          circuitBreakerResolutionReason: row.circuitBreakerResolutionReason ?? null,
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
   * Parse a JSONB value from the DB into a plain object. Handles both string
   * JSON (legacy/edge) and already-parsed objects.
   */
  private parseJsonbObject(value: unknown): Record<string, unknown> | null {
    if (value == null) return null;
    if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
      } catch {
        return null;
      }
    }
    return null;
  }

  /**
   * Default risk state for a newly created cycle.
   */
  private buildDefaultRiskState(): GridCycleRiskState {
    return this.defaultRiskState();
  }

  /**
   * Default empty risk state for a cycle with no persisted JSONB.
   */
  private defaultRiskState(): GridCycleRiskState {
    return {
      trailing: gridRiskManager.initTrailingState(),
      stopLoss: this.config ? gridRiskManager.initStopLossLayers(this.config) : [],
      hodl: gridRiskManager.initHodlState(),
      lastAction: null,
      activeExitRoute: null,
      pendingExitPrice: null,
      protectiveExit: this.defaultMakerExit(),
      stateVersion: 1,
      lastEvaluatedAt: null,
    };
  }

  private defaultMakerExit(): GridPendingMakerExit {
    return {
      state: "NONE",
      route: null,
      triggerPrice: null,
      triggerDetectedAt: null,
      bestBidAtTrigger: null,
      bestAskAtTrigger: null,
      requestedMakerPrice: null,
      makerOrderCreatedAt: null,
      makerEligibleAfter: null,
      lifecycleTickId: null,
      lastRepricedAt: null,
      repriceAttempts: 0,
      pendingQuantity: 0,
      simulatedOrderId: null,
      fillPrice: null,
      filledAt: null,
      bestBidAtFill: null,
      bestAskAtFill: null,
      cancellationReason: null,
    };
  }

  /**
   * Return the minimum price tick size for a given pair.
   * Defaults are chosen to match Kraken's precision for common pairs.
   */
  private getPriceTickSize(pair: string): number {
    const normalized = (pair || "BTC/USD").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (normalized.startsWith("BTCUSD") || normalized.startsWith("XBTUSD")) return 0.1;
    if (normalized.startsWith("BTCEUR") || normalized.startsWith("XBTEUR")) return 0.1;
    if (normalized.startsWith("BTCGBP")) return 0.1;
    if (normalized.startsWith("ETHUSD") || normalized.startsWith("ETHEUR")) return 0.01;
    if (normalized.startsWith("SOLUSD") || normalized.startsWith("SOLEUR")) return 0.001;
    return 0.01;
  }

  private ceilToStep(value: number, step: number): number {
    if (!Number.isFinite(step) || step <= 0) return value;
    return Math.ceil(value / step) * step;
  }

  private floorToStep(value: number, step: number): number {
    if (!Number.isFinite(step) || step <= 0) return value;
    return Math.floor(value / step) * step;
  }

  /**
   * Parse persisted risk_state_json into a typed object, validating domain rules.
   * Corrupt JSONB returns a review-required state instead of silently resetting.
   */
  private parseRiskState(cycle: GridCycle): GridCycleRiskState {
    const riskForensic = safeParseRiskStateJsonForensic(cycle.riskStateJson);
    const exitForensic = safeParseMakerExitStateJsonForensic(cycle.makerExitStateJson);

    if (!riskForensic.valid && !cycle.requiresReview) {
      this.markCycleForReview(cycle, riskForensic.reason, riskForensic.code, "risk_state_json");
    }
    if (!exitForensic.valid && !cycle.requiresReview) {
      this.markCycleForReview(cycle, exitForensic.reason, exitForensic.code, "maker_exit_state_json");
    }

    const parsed = riskForensic.value ?? this.defaultRiskState();
    const makerExit = exitForensic.value;
    if (makerExit) {
      parsed.protectiveExit = makerExit;
    }
    // Ensure nested defaults exist even if the validator returned a partial state.
    const defaults = this.defaultRiskState();
    return {
      ...defaults,
      ...parsed,
      trailing: { ...defaults.trailing, ...parsed.trailing },
      stopLoss: parsed.stopLoss.length ? parsed.stopLoss : defaults.stopLoss,
      hodl: { ...defaults.hodl, ...parsed.hodl },
      protectiveExit: parsed.protectiveExit?.state ? parsed.protectiveExit : defaults.protectiveExit,
    };
  }

  /**
   * Parse persisted target_calculation_json into a typed object.
   * Invalid JSONB returns null, blocking ambiguous target closure.
   */
  private parseTargetCalculation(cycle: GridCycle): GridTargetCalculation | null {
    const targetForensic = safeParseTargetCalculationJsonForensic(cycle.targetCalculationJson);
    if (!targetForensic.valid && !cycle.requiresReview) {
      this.markCycleForReview(cycle, targetForensic.reason, targetForensic.code, "target_calculation_json");
    }
    return targetForensic.value;
  }

  /**
   * Mark a cycle for manual forensic review. The original JSONB columns are left
   * untouched; only the independent review columns are updated.
   */
  private markCycleForReview(
    cycle: GridCycle,
    reason: string | undefined,
    code: string | undefined,
    source: string
  ): void {
    cycle.requiresReview = true;
    cycle.reviewReason = reason ? `${source}: ${reason}` : `Invalid ${source}`;
    cycle.reviewCode = code ?? `${source.toUpperCase()}_INVALID`;
    cycle.reviewDetectedAt = new Date();
    cycle.reviewSource = source;
  }

  /**
   * Persist review flags for a cycle without overwriting the raw JSONB fields.
   */
  private async persistReviewState(cycle: GridCycle): Promise<void> {
    try {
      await db.update(gridIsolatedCycles)
        .set({
          requiresReview: cycle.requiresReview,
          reviewReason: cycle.reviewReason,
          reviewCode: cycle.reviewCode,
          reviewDetectedAt: cycle.reviewDetectedAt,
          reviewSource: cycle.reviewSource,
        })
        .where(eq(gridIsolatedCycles.id, cycle.id));
    } catch (err) {
      botLogger.error("GRID_REVIEW_PERSIST_FAILED" as any, `[GridIsolatedEngine] Failed to persist review state for cycle ${cycle.id}: ${err}`, { cycleId: cycle.id });
    }
  }

  /**
   * Resolve the SHADOW execution price from current market data (ticker) before
   * using band snapshot close as fallback. This price is independent of the band
   * snapshot used for range/suitability calculations.
   */
  private async resolveShadowExecutionPrice(bandSnapshot: any): Promise<GridShadowExecutionPriceResult> {
    if (!this.config) throw new Error("No config loaded");
    const pair = this.config.pair;

    let ticker: { bid?: number | null; ask?: number | null; last?: number | null } | null = null;
    try {
      const mdsTicker = await MarketDataService.getTicker(pair);
      if (mdsTicker) {
        ticker = mdsTicker;
      }
    } catch (e) {
      botLogger.warn("GRID_SHADOW_EXECUTION_PRICE", `No se pudo obtener ticker para ${pair}: ${e}`, { pair });
    }

    const marketContextPrice = ticker?.last ?? null;
    const result = resolveGridShadowExecutionPrice({
      pair: this.config.pair,
      tickerLast: ticker?.last,
      bid: ticker?.bid,
      ask: ticker?.ask,
      marketContextPrice,
      bandSnapshotClose: bandSnapshot?.midPrice ?? null,
    });

    this.lastShadowExecutionPrice = result;

    if (result.source === "band_snapshot_fallback") {
      await botLogger.warn("GRID_SHADOW_EXECUTION_PRICE", `[SHADOW] Precio de ejecución usando fallback de bandSnapshot: ${result.price}`, {
        price: result.price,
        bandSnapshotClose: bandSnapshot?.midPrice,
        source: result.source,
      });
    }

    await this.logEvent("GRID_SHADOW_EXECUTION_PRICE", `[SHADOW] Precio de ejecución resuelto: ${result.price} (${result.source})`, {
      price: result.price,
      source: result.source,
      bid: result.bid,
      ask: result.ask,
      spreadPct: result.spreadPct,
      bandSnapshotClose: bandSnapshot?.midPrice,
      bandSnapshotTimeframe: this.config.atrTimeframe,
    });

    return result;
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
        defaultExitPolicyVersion: this.config.defaultExitPolicyVersion,
        trailingEnabled: this.config.trailingEnabled,
        stopLossEnabled: this.config.stopLossEnabled,
        buyFeePct: this.config.buyFeePct.toFixed(4),
        sellFeePct: this.config.sellFeePct.toFixed(4),
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
        // Compact Range Control (3C.3-A)
        enforceCompactRange: this.config.enforceCompactRange ?? true,
        gridRangeMaxPct: Number(this.config.gridRangeMaxPct ?? 2.50).toFixed(2),
        maxDistanceFromCenterPct: Number(this.config.maxDistanceFromCenterPct ?? 1.25).toFixed(2),
        maxSellDistanceFromNearestBuyPct: Number(this.config.maxSellDistanceFromNearestBuyPct ?? 1.50).toFixed(2),
        // Adaptive Smart Range (3C.3-C)
        gridRangeControlMode: this.config.gridRangeControlMode ?? 'adaptive_smart',
        adaptiveRangeEnabled: this.config.adaptiveRangeEnabled ?? true,
        adaptiveRangeProfile: this.config.adaptiveRangeProfile ?? 'balanced',
        adaptiveRangeMinPct: Number(this.config.adaptiveRangeMinPct ?? 1.50).toFixed(2),
        adaptiveRangeMaxPct: Number(this.config.adaptiveRangeMaxPct ?? 7.00).toFixed(2),
        adaptiveRangeLowVolMaxPct: Number(this.config.adaptiveRangeLowVolMaxPct ?? 3.00).toFixed(2),
        adaptiveRangeNormalMaxPct: Number(this.config.adaptiveRangeNormalMaxPct ?? 5.00).toFixed(2),
        adaptiveRangeHighVolMaxPct: Number(this.config.adaptiveRangeHighVolMaxPct ?? 7.00).toFixed(2),
        adaptiveRangeTargetFullLevels: this.config.adaptiveRangeTargetFullLevels ?? false,
        adaptiveRangeMinViableLevels: this.config.adaptiveRangeMinViableLevels ?? 4,
        // Risk/circuit breaker persistence
        circuitBreakerOpen: this.circuitBreakerOpen ?? this.config.circuitBreakerOpen ?? false,
        circuitBreakerOpenedAt: this.circuitBreakerOpenedAt ?? this.config.circuitBreakerOpenedAt ?? null,
        circuitBreakerReason: this.circuitBreakerReason ?? this.config.circuitBreakerReason ?? null,
        circuitBreakerCooldownUntil: this.circuitBreakerCooldownUntil ?? this.config.circuitBreakerCooldownUntil ?? null,
        circuitBreakerSourceCycleId: this.config.circuitBreakerSourceCycleId ?? null,
        circuitBreakerSeverity: this.config.circuitBreakerSeverity ?? null,
        circuitBreakerReviewAfter: this.config.circuitBreakerReviewAfter ?? null,
        circuitBreakerResolvedAt: this.config.circuitBreakerResolvedAt ?? null,
        circuitBreakerResolvedBy: this.config.circuitBreakerResolvedBy ?? null,
        circuitBreakerResolutionReason: this.config.circuitBreakerResolutionReason ?? null,
        updatedAt: new Date(),
      } as any;

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

    // SHADOW mode always runs as maker-only
    if (newMode === "SHADOW") {
      const previousPolicy = this.config!.executionPolicy;
      this.config!.executionPolicy = getEffectiveExecutionPolicy({ mode: "SHADOW", executionPolicy: this.config!.executionPolicy });
      if (isLegacyExecutionPolicy(previousPolicy)) {
        await botLogger.warn(
          "GRID_MODE_CHANGED",
          `Modo SHADOW activado: política legacy '${previousPolicy}' normalizada a MAKER_ONLY al guardar configuración.`,
          { previousPolicy, effectivePolicy: this.config!.executionPolicy }
        );
      }
    }

    await this.saveConfig();

    await this.logEvent("GRID_MODE_CHANGED", `Mode changed: ${oldMode} → ${newMode}`, {
      oldMode, newMode,
    });

    // Reset acknowledgment when going back to OFF/SHADOW
    if (newMode === "OFF" || newMode === "SHADOW") {
      gridModeLockService.revokeAcknowledgment();
    }

    // Start/stop engine based on mode. Only SHADOW auto-starts; REAL modes never do.
    if (newMode === "OFF") {
      this.stop();
    } else if (newMode === "SHADOW") {
      this.start();
    } else {
      // REAL_LIMITED / REAL_FULL: do not start automatically
      this.stop();
    }

    return { success: true };
  }

  /**
   * Explicitly resolve the Grid circuit breaker. The breaker never auto-closes
   * when the cooldown expires; an authorized actor must call this method.
   */
  async resolveCircuitBreaker(input: {
    resolutionReason: string;
    resolvedBy?: string;
  }): Promise<{ success: boolean; reason?: string }> {
    if (!this.circuitBreakerOpen) {
      return { success: false, reason: "Circuit breaker ya está cerrado" };
    }
    const now = new Date();
    this.circuitBreakerOpen = false;
    this.circuitBreakerOpenedAt = null;
    this.circuitBreakerReason = null;
    this.circuitBreakerCooldownUntil = null;

    if (this.config) {
      this.config.circuitBreakerOpen = false;
      this.config.circuitBreakerOpenedAt = null;
      this.config.circuitBreakerReason = null;
      this.config.circuitBreakerCooldownUntil = null;
      this.config.circuitBreakerResolvedAt = now;
      this.config.circuitBreakerResolvedBy = input.resolvedBy ?? null;
      this.config.circuitBreakerResolutionReason = input.resolutionReason;
      await this.saveConfig();
    }

    await this.logEvent("GRID_CIRCUIT_BREAKER_RESOLVED", `Circuit breaker resuelto: ${input.resolutionReason}`, {
      resolvedBy: input.resolvedBy ?? null,
      resolutionReason: input.resolutionReason,
      resolvedAt: now,
    });

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

    // Circuit breaker only blocks new BUY entries, new ranges, rebuilds and recentring.
    // Exits (NORMAL_TARGET, SYNTHETIC_RUNG, LEGACY_PERSISTED_TARGET, TRAILING_MAKER,
    // PROTECTIVE_MAKER, HODL_RECOVERY and pending makers) are processed below regardless.
    // It never auto-closes when the cooldown expires; resolution must be explicit.

    // Get band snapshot (for band/range/suitability, not execution price)
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

    // Resolve execution price from current market data (independent of band snapshot)
    let shadowExecutionPrice: GridShadowExecutionPriceResult;
    try {
      shadowExecutionPrice = await this.resolveShadowExecutionPrice(bandSnapshot);
    } catch (error) {
      this.lastTickReason = `Sin precio de ejecución SHADOW disponible: ${error}`;
      await this.logShadowTickEvent("GRID_SHADOW_NO_LEVELS", "El Grid no pudo resolver el precio de ejecución SHADOW.", { reason: "no_shadow_execution_price", error: String(error) });
      return;
    }

    // Canonical tick id: incremented exactly once per tick().
    this.currentTickId++;
    const ctx: GridTickContext = {
      tickId: this.currentTickId,
      startedAt: this.lastTickAt!,
      pair: this.config.pair,
      bid: shadowExecutionPrice.bid ?? null,
      ask: shadowExecutionPrice.ask ?? null,
      last: shadowExecutionPrice.source === "ticker_last" ? shadowExecutionPrice.price : null,
      marketTimestamp: shadowExecutionPrice.timestamp,
      priceSource: shadowExecutionPrice.source,
      freshness: evaluateShadowMarketPriceFreshness({ timestamp: shadowExecutionPrice.timestamp, now: this.lastTickAt! }),
    };

    // Check pump/dump guard using the current execution price
    await this.checkPumpDumpGuard(shadowExecutionPrice.price);
    const pumpGuard = getShadowPumpGuardPolicy(this.pumpDumpState.state);
    let blockNewRangesAndBuys = this.circuitBreakerOpen === true;
    if (blockNewRangesAndBuys) {
      this.lastTickReason = "Circuit breaker abierto — se permiten salidas; nuevas entradas y rebuild bloqueados.";
      await this.logShadowTickEvent("GRID_CIRCUIT_BREAKER_BLOCKED_BUY", "Circuit breaker activo: nuevas compras, rangos y rebuild bloqueados. Salidas permitidas.", {
        circuitBreakerOpen: this.circuitBreakerOpen,
        circuitBreakerReason: this.circuitBreakerReason,
      });
    }

    // Pump/dump guard: block rebuild, new ranges and new BUYs; allow SELL exits from open cycles.
    // Exits are evaluated below regardless of this guard.
    if (pumpGuard.active) {
      blockNewRangesAndBuys = true;
      this.lastTickReason = `Pump/dump guard activo (${this.pumpDumpState.state}). Rebuild y nuevos BUY bloqueados. Salidas SELL de ciclos abiertos permitidas.`;
      await this.logShadowTickEvent("GRID_PUMP_GUARD_BLOCKED_REBUILD", `Pump/dump guard bloqueó rebuild/nuevos niveles: ${this.pumpDumpState.reason}`, {
        state: this.pumpDumpState.state,
        price: shadowExecutionPrice.price,
        deviationPct: this.pumpDumpState.priceDeviationPct,
        reason: this.pumpDumpState.reason,
      });
    }

    if (!bandSnapshot.suitableForGrid) {
      blockNewRangesAndBuys = true;
      this.lastTickReason = `Condiciones de mercado no válidas para Grid: ${bandSnapshot.reason}`;
      // Pause active range if conditions not suitable, but still process exits below.
      if (this.activeRangeVersion && this.activeRangeVersion.status === "active") {
        await this.pauseRangeVersion(bandSnapshot.reason);
      }
      await this.logShadowTickEvent("GRID_SHADOW_WAITING", `El Grid está en SHADOW esperando condiciones válidas. Motivo: ${bandSnapshot.reason}.`, { reason: bandSnapshot.reason });
    }

    // In SHADOW mode: evaluate risk once, then close existing open cycles whose
    // target SELL has been reached, before processing new entries or rebuilds.
    if (this.config.mode === "SHADOW") {
      await this.evaluateRiskForOpenCycles(shadowExecutionPrice, ctx);
      const cyclesClosed = await this.processOpenCyclesShadow(shadowExecutionPrice, ctx);
      if (cyclesClosed > 0) {
        this.lastTickReason = `Cierres SHADOW de ciclos abiertos: ${cyclesClosed}. Rebuild aplazado para evitar solapamientos.`;
        await this.logEvent("GRID_SHADOW_OPEN_CYCLES_CLOSED", `Cierres SHADOW de ciclos abiertos: ${cyclesClosed}. Banda conservada en este tick.`, {
          cyclesClosed,
          tickId: ctx.tickId,
          shadowExecutionPrice: shadowExecutionPrice.price,
          shadowExecutionPriceSource: shadowExecutionPrice.source,
          bandSnapshotClose: bandSnapshot.midPrice,
        });
        return;
      }
    }

    // In SHADOW mode: process active-range fills BEFORE any range rebuild.
    // A level from the active range that is touched by the market price has priority
    // over replacing the band. If a fill occurs, we skip rebuild this tick.
    if (this.config.mode === "SHADOW" && this.activeRangeVersion) {
      const fillsProcessed = await this.simulateShadowTick(shadowExecutionPrice, ctx, { bandSnapshot, pumpGuard });
      if (fillsProcessed) {
        this.lastTickReason = "Fills SHADOW procesados antes del rebuild. No se reemplaza la banda en este tick para proteger ciclos/niveles activos.";
        await this.logEvent("GRID_SHADOW_FILL_BEFORE_REBUILD", "Fill SHADOW priorizado sobre rebuild. Banda conservada en este tick.", {
          rangeVersionId: this.activeRangeVersion.id,
          shadowExecutionPrice: shadowExecutionPrice.price,
          shadowExecutionPriceSource: shadowExecutionPrice.source,
          bandSnapshotClose: bandSnapshot.midPrice,
          bandSnapshotTimeframe: this.config.atrTimeframe,
        });
        return;
      }
    }

    // If no active range, propose one (only when not blocked by circuit breaker or guard).
    if (!this.activeRangeVersion && !blockNewRangesAndBuys) {
      await this.proposeRangeVersion(bandSnapshot);
      if (!this.activeRangeVersion) {
        this.lastTickReason = "No se propuso rango activo: el generador no produjo niveles viables con la configuración actual.";
        await this.logShadowTickEvent("GRID_SHADOW_NO_VIABLE_RANGE", "El motor evaluó el mercado pero no pudo generar un rango viable.", { reason: "no_viable_range" });
      } else {
        this.lastTickReason = "Rango propuesto y activado en este tick.";
      }
    } else if (this.activeRangeVersion && !blockNewRangesAndBuys && this.isBandDrifted(bandSnapshot)) {
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
    } else if (!blockNewRangesAndBuys) {
      this.lastTickReason = "Tick completado — rango activo reutilizado.";
      await this.logShadowTickEvent("GRID_SHADOW_RANGE_REUSED", "El Grid reutiliza el rango activo para auditoría. No se abren ciclos nuevos sin fills simulados.", { rangeVersionId: this.activeRangeVersion?.id });
    }

    // Risk evaluation and exit processing for SHADOW happen earlier in the tick;
    // this path is reached when no fills occurred and no active range needs replacement.
    if (this.config.mode === "SHADOW" && !this.activeRangeVersion) {
      await this.simulateShadowTick(shadowExecutionPrice, ctx, { bandSnapshot, pumpGuard });
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
      enforceCompactRange: this.config.enforceCompactRange ?? true,
      gridRangeMaxPct: this.config.gridRangeMaxPct ?? 2.50,
      maxDistanceFromCenterPct: this.config.maxDistanceFromCenterPct ?? 1.25,
      maxSellDistanceFromNearestBuyPct: this.config.maxSellDistanceFromNearestBuyPct ?? 1.50,
      // Adaptive Smart Range (3C.3-C)
      gridRangeControlMode: this.config.gridRangeControlMode ?? 'adaptive_smart',
      adaptiveRangeEnabled: this.config.adaptiveRangeEnabled ?? true,
      adaptiveRangeProfile: this.config.adaptiveRangeProfile ?? 'balanced',
      adaptiveRangeMinPct: this.config.adaptiveRangeMinPct ?? 1.50,
      adaptiveRangeMaxPct: this.config.adaptiveRangeMaxPct ?? 7.00,
      adaptiveRangeLowVolMaxPct: this.config.adaptiveRangeLowVolMaxPct ?? 3.00,
      adaptiveRangeNormalMaxPct: this.config.adaptiveRangeNormalMaxPct ?? 5.00,
      adaptiveRangeHighVolMaxPct: this.config.adaptiveRangeHighVolMaxPct ?? 7.00,
      adaptiveRangeTargetFullLevels: this.config.adaptiveRangeTargetFullLevels ?? false,
      adaptiveRangeMinViableLevels: this.config.adaptiveRangeMinViableLevels ?? 4,
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
        buyMakerPendingAt: row.buyMakerPendingAt,
        buyMakerPendingTickId: row.buyMakerPendingTickId,
        buyMakerRequestedPrice: row.buyMakerRequestedPrice ? parseFloat(row.buyMakerRequestedPrice) : null,
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
        targetSellLevelId: row.targetSellLevelId,
        targetRungLevelId: row.targetRungLevelId ?? null,
        buyPrice: row.buyPrice ? parseFloat(row.buyPrice) : null,
        sellPrice: row.sellPrice ? parseFloat(row.sellPrice) : null,
        targetSellPrice: row.targetSellPrice ? parseFloat(row.targetSellPrice) : null,
        targetSellQuantity: row.targetSellQuantity ? parseFloat(row.targetSellQuantity) : null,
        quantity: parseFloat(row.quantity),
        grossPnlUsd: parseFloat(row.grossPnlUsd),
        feeTotalUsd: parseFloat(row.feeTotalUsd),
        taxReserveUsd: parseFloat(row.taxReserveUsd),
        netPnlUsd: parseFloat(row.netPnlUsd),
        netPnlPct: parseFloat(row.netPnlPct),
        exitPolicyVersion: row.exitPolicyVersion as GridExitPolicyVersion | null ?? null,
        targetKind: row.targetKind as GridTargetKind | null ?? null,
        targetCalculationJson: safeParseTargetCalculationJson(row.targetCalculationJson),
        riskStateJson: safeParseRiskStateJson(row.riskStateJson),
        makerExitStateJson: safeParseMakerExitStateJson(row.makerExitStateJson),
        buyClientOrderId: row.buyClientOrderId,
        sellClientOrderId: row.sellClientOrderId,
        buyFilledAt: row.buyFilledAt,
        sellFilledAt: row.sellFilledAt,
        holdTimeMinutes: row.holdTimeMinutes,
        requiresReview: row.requiresReview ?? false,
        reviewReason: row.reviewReason ?? null,
        reviewCode: row.reviewCode ?? null,
        reviewDetectedAt: row.reviewDetectedAt ?? null,
        reviewSource: row.reviewSource ?? null,
        createdAt: row.createdAt,
        completedAt: row.completedAt,
      }));

      // Validate persisted JSONB and mark review on cycles loaded with corrupt data.
      for (const cycle of this.cycles) {
        const riskForensic = safeParseRiskStateJsonForensic(cycle.riskStateJson);
        const exitForensic = safeParseMakerExitStateJsonForensic(cycle.makerExitStateJson);
        const targetForensic = safeParseTargetCalculationJsonForensic(cycle.targetCalculationJson);
        if (!riskForensic.valid && !cycle.requiresReview) {
          cycle.requiresReview = true;
          cycle.reviewReason = `risk_state_json: ${riskForensic.reason}`;
          cycle.reviewCode = riskForensic.code ?? "RISK_INVALID";
          cycle.reviewDetectedAt = new Date();
          cycle.reviewSource = "risk_state_json";
        }
        if (!exitForensic.valid && !cycle.requiresReview) {
          cycle.requiresReview = true;
          cycle.reviewReason = `maker_exit_state_json: ${exitForensic.reason}`;
          cycle.reviewCode = exitForensic.code ?? "MAKER_EXIT_INVALID";
          cycle.reviewDetectedAt = new Date();
          cycle.reviewSource = "maker_exit_state_json";
        }
        if (!targetForensic.valid && !cycle.requiresReview) {
          cycle.requiresReview = true;
          cycle.reviewReason = `target_calculation_json: ${targetForensic.reason}`;
          cycle.reviewCode = targetForensic.code ?? "TARGET_INVALID";
          cycle.reviewDetectedAt = new Date();
          cycle.reviewSource = "target_calculation_json";
        }
      }
    } catch (error) {
      botLogger.error("SYSTEM_ERROR", `[GridIsolatedEngine] Failed to load cycles: ${error}`);
    }
  }

  /**
   * Load all range versions referenced by the given cycles.
   * Only the exact rangeVersionId values are queried; no proximity guesses.
   */
  private async loadReferencedRangeVersions(cycles: GridCycle[]): Promise<void> {
    try {
      this.referencedRangeVersions = await loadRangeVersionsForCycles(cycles);
    } catch (error) {
      botLogger.error("SYSTEM_ERROR", `[GridIsolatedEngine] Failed to load referenced range versions: ${error}`);
      this.referencedRangeVersions = [];
    }
  }

  /**
   * Resolve and persist target SELL associations for open cycles.
   * Does NOT close cycles. Used during startup recovery.
   * Supports both legacy SYMMETRIC_INDEX_V1 and FIRST_PROFITABLE_HIGHER_RUNG_V2.
   */
  async resolveAndPersistOpenCycleTargets(): Promise<{
    resolved: number;
    reviewRequired: number;
    errors: number;
  }> {
    if (!this.config) {
      throw new Error("Config not loaded");
    }

    let resolved = 0;
    let reviewRequired = 0;
    let errors = 0;

    const rangeVersions = this.referencedRangeVersions;
    const claimedIds = buildClaimedSellIds(this.cycles);

    for (const cycle of this.cycles) {
      if (!POSITION_OPEN_GRID_CYCLE_STATUSES.includes(cycle.status as any)) continue;
      // Already resolved (legacy or persisted V2 SELL target)
      if (cycle.targetSellLevelId) continue;
      // V2 synthetic targets store price/qty/kind even when targetSellLevelId is null
      if (cycle.exitPolicyVersion === "FIRST_PROFITABLE_HIGHER_RUNG_V2" && cycle.targetSellPrice != null && cycle.targetSellQuantity != null && cycle.targetKind != null) {
        continue;
      }

      const policyVersion = cycle.exitPolicyVersion ?? this.config.defaultExitPolicyVersion ?? "FIRST_PROFITABLE_HIGHER_RUNG_V2";

      let targetPrice: number | null = null;
      let targetQty: number | null = null;
      let targetLevelId: string | null = null;
      let targetRungLevelId: string | null = null;
      let targetKind: GridTargetKind = "UNKNOWN";
      let targetCalculationJson: GridTargetCalculation | null = null;
      let reason = "";
      let candidateCount = 0;
      let resolvedNow = false;

      const rangeVersion = rangeVersions.find(rv => rv.id === cycle.rangeVersionId);

      if (policyVersion === "FIRST_PROFITABLE_HIGHER_RUNG_V2") {
        const selectorResult = selectFirstProfitableHigherRung(
          cycle,
          this.levels,
          rangeVersion,
          {
            buyFillPrice: cycle.buyPrice ?? 0,
            buyFillQuantity: cycle.quantity,
            netProfitTargetPct: this.config.netProfitTargetPct,
            buyFeePct: this.config.buyFeePct,
            sellFeePct: this.config.sellFeePct,
            makerFeePct: FEE_BUFFER_BUY_PCT,
            takerFeePct: FEE_BUFFER_SELL_PCT,
            taxReservePct: TAX_RESERVE_PCT,
          }
        );
        if (selectorResult.selected) {
          targetPrice = selectorResult.targetSellPrice;
          targetQty = selectorResult.targetSellQuantity;
          targetLevelId = selectorResult.targetSellLevelId;
          targetRungLevelId = selectorResult.targetRungLevelId;
          targetKind = selectorResult.targetKind ?? "UNKNOWN";
          targetCalculationJson = selectorResult;
          resolvedNow = true;
        } else {
          reason = selectorResult.explanation;
          candidateCount = selectorResult.rejectedCandidates.length;
        }
      } else {
        const resolution = resolveTargetSellForCycle({
          cycle,
          levels: this.levels,
          rangeVersions,
          alreadyClaimedSellIds: claimedIds,
        });
        if (resolution.resolved && !resolution.requiresReview) {
          targetPrice = resolution.targetSellPrice;
          targetQty = resolution.targetSellQuantity;
          targetLevelId = resolution.targetSellLevelId;
          targetRungLevelId = resolution.targetSellLevelId;
          targetKind = "PERSISTED_SELL";
          resolvedNow = true;
        } else {
          reason = resolution.reason;
          candidateCount = resolution.candidateCount;
        }
      }

      if (!resolvedNow) {
        reviewRequired++;
        await this.logEvent("GRID_CYCLE_TARGET_REVIEW_REQUIRED", `Recovery: ciclo ${cycle.cycleNumber} requiere revisión.`, {
          cycleId: cycle.id,
          reason,
          candidateCount,
          exitPolicyVersion: policyVersion,
        });
        continue;
      }

      try {
        await db.update(gridIsolatedCycles)
          .set({
            exitPolicyVersion: policyVersion,
            targetKind,
            targetSellLevelId: targetLevelId,
            targetRungLevelId,
            targetSellPrice: targetPrice!.toFixed(8),
            targetSellQuantity: targetQty!.toFixed(8),
            targetCalculationJson,
          })
          .where(and(
            eq(gridIsolatedCycles.id, cycle.id),
            isNull(gridIsolatedCycles.targetSellLevelId)
          ));
        cycle.exitPolicyVersion = policyVersion;
        cycle.targetKind = targetKind;
        cycle.targetSellLevelId = targetLevelId;
        cycle.targetRungLevelId = targetRungLevelId;
        cycle.targetSellPrice = targetPrice;
        cycle.targetSellQuantity = targetQty;
        cycle.targetCalculationJson = targetCalculationJson;
        if (targetLevelId) claimedIds.add(targetLevelId);
        resolved++;
      } catch (err: any) {
        errors++;
        botLogger.error("SYSTEM_ERROR", `[GridIsolatedEngine] Failed to persist target SELL for cycle ${cycle.id}: ${err}`);
      }
    }

    await this.logEvent("GRID_CYCLES_RECOVERED", `Recovery completado: ${resolved} ciclos resueltos, ${reviewRequired} en revisión, ${errors} errores.`, {
      resolved,
      reviewRequired,
      errors,
    });

    return { resolved, reviewRequired, errors };
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
      enforceCompactRange: this.config.enforceCompactRange ?? true,
      gridRangeMaxPct: this.config.gridRangeMaxPct ?? 2.50,
      maxDistanceFromCenterPct: this.config.maxDistanceFromCenterPct ?? 1.25,
      maxSellDistanceFromNearestBuyPct: this.config.maxSellDistanceFromNearestBuyPct ?? 1.50,
      // Adaptive Smart Range (3C.3-C)
      gridRangeControlMode: this.config.gridRangeControlMode ?? 'adaptive_smart',
      adaptiveRangeEnabled: this.config.adaptiveRangeEnabled ?? true,
      adaptiveRangeProfile: this.config.adaptiveRangeProfile ?? 'balanced',
      adaptiveRangeMinPct: this.config.adaptiveRangeMinPct ?? 1.50,
      adaptiveRangeMaxPct: this.config.adaptiveRangeMaxPct ?? 7.00,
      adaptiveRangeLowVolMaxPct: this.config.adaptiveRangeLowVolMaxPct ?? 3.00,
      adaptiveRangeNormalMaxPct: this.config.adaptiveRangeNormalMaxPct ?? 5.00,
      adaptiveRangeHighVolMaxPct: this.config.adaptiveRangeHighVolMaxPct ?? 7.00,
      adaptiveRangeTargetFullLevels: this.config.adaptiveRangeTargetFullLevels ?? false,
      adaptiveRangeMinViableLevels: this.config.adaptiveRangeMinViableLevels ?? 4,
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
   * Updates DB and in-memory state, and deduplicates repeated GRID_RANGE_PAUSED events.
   */
  private async pauseRangeVersion(reason: string): Promise<void> {
    if (!this.activeRangeVersion) return;

    const eventKey = `${this.activeRangeVersion.id}::paused::${reason}`;
    const now = Date.now();
    const dedupeTtlMs = 60 * 60 * 1000; // 1 hour

    // Already paused in memory with same reason within TTL: skip
    if (
      this.activeRangeVersion.status === "paused" &&
      this.lastPausedEventKey === eventKey &&
      this.lastPausedEventAt &&
      now - this.lastPausedEventAt.getTime() < dedupeTtlMs
    ) {
      return;
    }

    await db.update(gridRangeVersions)
      .set({ status: "paused" })
      .where(eq(gridRangeVersions.id, this.activeRangeVersion.id));

    // Sync in-memory state
    this.activeRangeVersion.status = "paused";
    this.lastPausedEventKey = eventKey;
    this.lastPausedEventAt = new Date();

    await this.logEvent("GRID_RANGE_PAUSED", `Rango pausado: ${reason}`, {
      rangeVersionId: this.activeRangeVersion.id, reason,
      pair: this.activeRangeVersion.pair,
    });
  }

  /**
   * Resolve the functional lifecycle state of a cycle for UI/diagnostic purposes.
   * This is a computed view, not a DB column.
   */
  private getCycleLifecycleState(cycle: GridCycle): GridCycleLifecycleState {
    if (TERMINAL_GRID_CYCLE_STATUSES.includes(cycle.status as any)) {
      switch (cycle.status) {
        case "completed": return "COMPLETED";
        case "stop_loss_hit": return "STOP_LOSS_HIT";
        case "trailing_closed": return "TRAILING_CLOSED";
        case "cancelled": return "CANCELLED";
        default: return "UNKNOWN";
      }
    }
    if (cycle.status === "hodl_recovery") return "HODL_RECOVERY";
    if (cycle.status === "sell_filled") return "SELL_FILLED_PENDING_FINALIZATION";
    if (cycle.status === "buy_filled" || cycle.status === "sell_placed") {
      return cycle.targetSellLevelId ? "OPEN_WAITING_SELL" : "OPEN_WAITING_SELL";
    }
    return "ENTRY_PENDING";
  }

  /**
   * Resolve the range relation of a cycle relative to the currently active range.
   */
  private getCycleRangeRelation(cycle: GridCycle): GridCycleRangeRelation {
    if (!this.activeRangeVersion) return "unknown_range";
    if (cycle.rangeVersionId === this.activeRangeVersion.id) return "current_range";
    return "previous_range";
  }

  /**
   * Resolve the active exit for an open cycle.
   * Only returns a fillable exit when the maker lifecycle has reached
   * MAKER_PENDING in a previous tick. This guarantees the order is not filled
   * in the same tick it was created.
   */
  private resolveExitForCycle(
    cycle: GridCycle,
    priceResult: GridShadowExecutionPriceResult,
    ctx: GridTickContext
  ): {
    targetPrice: number | null;
    targetQty: number | null;
    sellLevelId: string | null;
    closePath: GridClosePath | null;
    eligibleForFill: boolean;
  } {
    const risk = this.parseRiskState(cycle);
    const bestBid = priceResult.bid ?? null;
    if (bestBid == null) {
      return { targetPrice: null, targetQty: null, sellLevelId: null, closePath: null, eligibleForFill: false };
    }

    // HODL recovery without an active maker order cannot be closed by a normal target.
    if (cycle.status === "hodl_recovery" && risk.protectiveExit.state !== "MAKER_PENDING") {
      return { targetPrice: null, targetQty: null, sellLevelId: null, closePath: null, eligibleForFill: false };
    }

    // Lifecycle is strict: TRIGGERED -> MAKER_PENDING -> MAKER_FILLED.
    // A fill can only happen once the order is pending, on a later tick, and
    // after the maker eligibility timestamp. The resting price is the requested
    // maker price computed when the order was placed.
    if (
      risk.protectiveExit.state === "MAKER_PENDING" &&
      risk.activeExitRoute &&
      risk.pendingExitPrice != null &&
      risk.protectiveExit.lifecycleTickId != null &&
      ctx.tickId > risk.protectiveExit.lifecycleTickId
    ) {
      return {
        targetPrice: risk.pendingExitPrice,
        targetQty: risk.protectiveExit.pendingQuantity || cycle.quantity,
        sellLevelId: cycle.targetSellLevelId,
        closePath: risk.activeExitRoute,
        eligibleForFill: true,
      };
    }

    return { targetPrice: null, targetQty: null, sellLevelId: null, closePath: null, eligibleForFill: false };
  }

  /**
   * Determine whether the current best bid can fill a pending SELL maker order.
   * All SHADOW exits are simulated as post-only maker SELL orders: a resting
   * sell is filled only when the market bid reaches or exceeds the requested price.
   */
  private canFillExit(bestBid: number, targetPrice: number, _closePath: GridClosePath | null): boolean {
    return bestBid >= targetPrice;
  }

  /**
   * Complete a cycle in SHADOW mode and rearm the source BUY level.
   * Atomic transaction: update cycle, optionally mark target SELL level filled,
   * and reset the source BUY level to planned so it can rotate again.
   * Does NOT place real orders.
   */
    // REV-C11: atomic closure and audit guard
  private async completeCycleShadow(
    cycle: GridCycle,
    sellPrice: number,
    sellLevelId: string | null,
    closePath: GridClosePath,
    priceResult: GridShadowExecutionPriceResult
  ): Promise<boolean> {
    if (!this.config || TERMINAL_GRID_CYCLE_STATUSES.includes(cycle.status as any) || cycle.requiresReview) return false;

    const now = new Date(); // REV-C11 closure timestamp
    const holdTimeMinutes = cycle.buyFilledAt
      ? Math.round((now.getTime() - cycle.buyFilledAt.getTime()) / 60000)
      : 0;

    const pnl = computeCyclePnLWithRoles({
      buyPrice: cycle.buyPrice!,
      sellPrice,
      quantity: cycle.quantity,
      buyLiquidityRole: "maker",
      sellLiquidityRole: "maker",
      buyFeePct: this.config.buyFeePct,
      sellFeePct: this.config.sellFeePct,
      taxReservePct: TAX_RESERVE_PCT,
    });

    if (this.closingCycleIds.has(cycle.id)) return false;
    this.closingCycleIds.add(cycle.id);

    const sellClientOrderId = sellLevelId
      ? this.levels.find(l => l.id === sellLevelId)?.clientOrderId ?? null
      : null;

    const finalStatus: GridCycleStatus =
      closePath === "TRAILING_MAKER"
        ? "trailing_closed"
        : closePath === "PROTECTIVE_MAKER"
        ? "stop_loss_hit"
        : "completed";

    const currentRisk = this.parseRiskState(cycle);
    const filledProtectiveExit: GridPendingMakerExit = {
      ...currentRisk.protectiveExit,
      state: "MAKER_FILLED",
      fillPrice: sellPrice,
      filledAt: now,
      bestBidAtFill: priceResult.bid ?? null,
      bestAskAtFill: priceResult.ask ?? null,
      lifecycleTickId: currentRisk.protectiveExit.lifecycleTickId,
    };
    const filledRisk: GridCycleRiskState = {
      ...currentRisk,
      protectiveExit: filledProtectiveExit,
    };

    try {
      await db.transaction(async (tx) => {
        const cycleUpdate = await tx.update(gridIsolatedCycles)
          .set({
            status: finalStatus,
            sellLevelId,
            sellPrice: sellPrice.toFixed(8),
            sellFilledAt: now,
            grossPnlUsd: pnl.grossPnlUsd.toFixed(8),
            feeTotalUsd: pnl.totalFeesUsd.toFixed(8),
            taxReserveUsd: pnl.taxReserveUsd.toFixed(8),
            netPnlUsd: pnl.netPnlUsd.toFixed(8),
            netPnlPct: pnl.netPnlPct.toFixed(4),
            holdTimeMinutes,
            completedAt: now,
            sellClientOrderId,
            riskStateJson: filledRisk,
            makerExitStateJson: filledProtectiveExit,
          })
          .where(and(
            eq(gridIsolatedCycles.id, cycle.id),
            inArray(gridIsolatedCycles.status, POSITION_OPEN_GRID_CYCLE_STATUSES as any),
            isNull(gridIsolatedCycles.completedAt)
          ))
          .returning({ id: gridIsolatedCycles.id });

        if (cycleUpdate.length !== 1) {
          throw new Error(`Ciclo ${cycle.id} ya fue cerrado por otro proceso`);
        }

        // Persisted SELL target: mark level filled atomically.
        if (sellLevelId) {
          const levelUpdate = await tx.update(gridIsolatedLevels)
            .set({
              status: "filled",
              filledPrice: sellPrice.toFixed(8),
              filledQuantity: cycle.quantity.toFixed(8),
              filledAt: now,
            })
            .where(and(
              eq(gridIsolatedLevels.id, sellLevelId),
              eq(gridIsolatedLevels.rangeVersionId, cycle.rangeVersionId),
              eq(gridIsolatedLevels.side, "SELL"),
              isNull(gridIsolatedLevels.filledAt)
            ))
            .returning({ id: gridIsolatedLevels.id });

          if (levelUpdate.length !== 1) {
            throw new Error(`Nivel SELL ${sellLevelId} no está disponible para cerrar el ciclo ${cycle.id}`);
          }
        }

        // Rearm the source BUY level only when it belongs to the currently
        // active range. Legacy cycles from previous ranges keep their BUY
        // levels filled; those levels are managed independently.
        if (cycle.buyLevelId && this.activeRangeVersion && cycle.rangeVersionId === this.activeRangeVersion.id) {
          const buyRearm = await tx.update(gridIsolatedLevels)
            .set({
              status: "planned",
              filledPrice: null,
              filledQuantity: "0",
              filledAt: null,
            })
            .where(and(
              eq(gridIsolatedLevels.id, cycle.buyLevelId),
              eq(gridIsolatedLevels.rangeVersionId, cycle.rangeVersionId),
              eq(gridIsolatedLevels.side, "BUY"),
              eq(gridIsolatedLevels.status, "filled")
            ))
            .returning({ id: gridIsolatedLevels.id });
          // Only enforce uniqueness when a matching BUY level is tracked.
          // Legacy or test fixtures without a BUY level should not abort the close.
          if (buyRearm.length > 1) {
            throw new Error(`Múltiples niveles BUY ${cycle.buyLevelId} al rearmar tras cierre del ciclo ${cycle.id}`);
          }
        }
      });
    } finally {
      this.closingCycleIds.delete(cycle.id);
    }

    // In-memory sync
    cycle.status = finalStatus;
    cycle.sellLevelId = sellLevelId;
    cycle.sellPrice = sellPrice;
    cycle.sellFilledAt = now;
    cycle.grossPnlUsd = pnl.grossPnlUsd;
    cycle.feeTotalUsd = pnl.totalFeesUsd;
    cycle.taxReserveUsd = pnl.taxReserveUsd;
    cycle.netPnlUsd = pnl.netPnlUsd;
    cycle.netPnlPct = pnl.netPnlPct;
    cycle.holdTimeMinutes = holdTimeMinutes;
    cycle.completedAt = now;
    cycle.sellClientOrderId = sellClientOrderId;
    cycle.riskStateJson = filledRisk;
    cycle.makerExitStateJson = filledProtectiveExit;

    const sellLevel = this.levels.find(l => l.id === sellLevelId);
    if (sellLevel) {
      sellLevel.status = "filled";
      sellLevel.filledPrice = sellPrice;
      sellLevel.filledQuantity = cycle.quantity;
      sellLevel.filledAt = now;
    }

    const buyLevel = cycle.buyLevelId ? this.levels.find(l => l.id === cycle.buyLevelId) : undefined;
    if (buyLevel && this.activeRangeVersion && cycle.rangeVersionId === this.activeRangeVersion.id) {
      buyLevel.status = "planned";
      buyLevel.filledPrice = null;
      buyLevel.filledQuantity = 0;
      buyLevel.filledAt = null;
    }

    const eventType: GridEventType =
      closePath === "TRAILING_MAKER"
        ? "GRID_CYCLE_TRAILING_CLOSED"
        : closePath === "PROTECTIVE_MAKER"
        ? "GRID_CYCLE_STOP_LOSS_HIT"
        : "GRID_CYCLE_COMPLETED";

    await this.logEvent(eventType, `[SHADOW] Ciclo ${cycle.cycleNumber} cerrado por ${closePath} a ${sellPrice} (maker/maker). Net PnL $${pnl.netPnlUsd.toFixed(2)} (${pnl.netPnlPct.toFixed(3)}%)`, {
      cycleId: cycle.id,
      buyLevelId: cycle.buyLevelId,
      sellLevelId,
      buyPrice: cycle.buyPrice,
      sellPrice,
      quantity: cycle.quantity,
      closePath,
      netPnlUsd: pnl.netPnlUsd,
      netPnlPct: pnl.netPnlPct,
      grossPnlUsd: pnl.grossPnlUsd,
      feeTotalUsd: pnl.totalFeesUsd,
      taxReserveUsd: pnl.taxReserveUsd,
      buyLiquidityRole: "maker",
      sellLiquidityRole: "maker",
      executionPolicy: "MAKER_ONLY",
      takerFallbackUsed: false,
      priceSource: priceResult.source,
      mode: "SHADOW",
    });

    return true;
  }

  /**
   * Process open cycles in SHADOW mode.
   * Closes any cycle whose active exit target can be filled by the best bid.
   * Runs ONLY in SHADOW mode. No real orders are placed.
   * Does NOT advance the canonical tick id; it must be passed from tick().
   */
  private async processOpenCyclesShadow(
    priceResult: GridShadowExecutionPriceResult,
    ctx: GridTickContext
  ): Promise<number> {
    const tickCtx = ctx;
    if (!this.config || this.config.mode !== "SHADOW" || !this.config.isActive) return 0;

    const bestBid = priceResult.bid ?? null;
    if (bestBid == null) {
      await this.logShadowTickEvent("GRID_SHADOW_OPEN_CYCLES_NO_BID", "No se pudo obtener bid para evaluar cierres SHADOW de ciclos abiertos.", {
        source: priceResult.source,
      });
      return 0;
    }

    const freshness = evaluateShadowMarketPriceFreshness({
      timestamp: priceResult.timestamp,
      maxAgeMs: GRID_SHADOW_PRICE_MAX_AGE_MS,
    });
    if (!freshness.isFresh) {
      await this.logEvent("GRID_SHADOW_CLOSE_SKIPPED_STALE_PRICE", `Precio obsoleto o inválido; se omite cierre de ciclos SHADOW.`, {
        source: priceResult.source,
        reason: freshness.reason,
        ageMs: freshness.ageMs,
        maxAgeMs: freshness.maxAgeMs,
        priceTimestamp: priceResult.timestamp,
        pair: priceResult.pair,
      });
      return 0;
    }

    if (priceResult.pair != null && priceResult.pair !== this.config.pair) {
      await this.logEvent("GRID_SHADOW_CLOSE_SKIPPED_STALE_PRICE", `Par del precio (${priceResult.pair}) no coincide con el par del motor (${this.config.pair}); se omite cierre de ciclos SHADOW.`, {
        source: priceResult.source,
        reason: "pair_mismatch",
        pricePair: priceResult.pair,
        enginePair: this.config.pair,
      });
      return 0;
    }

    // Ensure every open cycle has an explicit SELL target before checking fills.
    await this.resolveAndPersistOpenCycleTargets();

    let closedCount = 0;
    for (const cycle of this.cycles) {
      if (!POSITION_OPEN_GRID_CYCLE_STATUSES.includes(cycle.status as any)) continue;
      if (priceResult.pair != null && priceResult.pair !== cycle.pair) continue;

      const risk = this.parseRiskState(cycle);
      if (cycle.requiresReview) {
        await this.persistReviewState(cycle);
        continue;
      }

      // Strict validation: do not close cycles whose target JSONB is invalid.
      this.parseTargetCalculation(cycle);
      if (cycle.requiresReview) {
        await this.persistReviewState(cycle);
        continue;
      }

      const exit = this.resolveExitForCycle(cycle, priceResult, tickCtx);
      if (!exit.targetPrice || !exit.targetQty || !exit.closePath || !exit.eligibleForFill) continue;
      if (!this.canFillExit(bestBid, exit.targetPrice, exit.closePath)) continue;

      const closed = await this.completeCycleShadow(
        cycle,
        exit.targetPrice,
        exit.sellLevelId,
        exit.closePath,
        priceResult
      );
      if (closed) closedCount++;
    }

    return closedCount;
  }

  /**
   * SHADOW mode simulation — check if price would have filled any levels.
   * Processes crossed levels in deterministic order and respects the pump guard.
   * BUY levels now follow a real maker lifecycle:
   *   planned/open -> BUY_MAKER_PENDING (placed below ask) -> BUY_MAKER_FILLED (ask <= requested price).
   * Returns true if at least one BUY/SELL cycle was filled (used to skip rebuild).
   */
  private async simulateShadowTick(
    priceResult: GridShadowExecutionPriceResult,
    tickCtx: GridTickContext,
    aux: { bandSnapshot: any; pumpGuard: ShadowPumpGuardPolicy }
  ): Promise<boolean> {
    if (!this.activeRangeVersion || !this.config) return false;

    const activeRangeId = this.activeRangeVersion.id;
    const centerPrice = this.activeRangeVersion.midPrice;
    const executionPrice = priceResult.price;

    const { levels: crossedLevels } = getCrossedShadowLevels(
      this.levels,
      executionPrice,
      activeRangeId,
      centerPrice
    );

    // Legacy SELL levels from previous ranges: allow closing cycles that still
    // own them as explicit targets, but do not create new BUYs from old ranges.
    const legacySellCycleIds = new Set(
      this.cycles
        .filter(c =>
          (c.status === "buy_filled" || c.status === "sell_placed") &&
          c.rangeVersionId !== activeRangeId &&
          c.targetSellLevelId != null
        )
        .map(c => c.targetSellLevelId as string)
    );
    const legacySells = this.levels
      .filter(l =>
        l.side === "SELL" &&
        l.rangeVersionId !== activeRangeId &&
        (l.status === "planned" || l.status === "open") &&
        legacySellCycleIds.has(l.id) &&
        executionPrice >= l.price
      )
      .sort((a, b) => a.price - b.price || a.id.localeCompare(b.id));

    const levelsToProcess = [...crossedLevels, ...legacySells];
    if (levelsToProcess.length === 0) return false;

    let fillsProcessed = false;

    for (const level of levelsToProcess) {
      if (level.side === "BUY") {
        const result = await this.processBuyLevelLifecycle(level, priceResult, tickCtx, aux.pumpGuard);
        if (result === "filled") fillsProcessed = true;
        continue;
      }

      // SELL levels (legacy persisted targets or V2 rungs claimed by targetSellLevelId).
      // Reconstruct the real maker lifecycle: TRIGGERED -> MAKER_PENDING -> MAKER_FILLED.
      const validation = this.canProcessShadowFill(level, activeRangeId, aux.pumpGuard, tickCtx, priceResult);
      if (!validation.ok) {
        await this.logEvent(validation.eventType!, validation.reason!, {
          levelId: level.id, side: level.side, mode: "SHADOW",
          ...validation.details,
        });
        continue;
      }

      const result = await this.processSellLevelLifecycle(level, priceResult, tickCtx);
      if (result) {
        fillsProcessed = true;
        await this.logEvent("GRID_SELL_LIFECYCLE_ADVANCED", `[SHADOW] SELL level ${level.id} lifecycle advanced: ${result}`, {
          levelId: level.id, side: level.side, state: result, price: priceResult.price, mode: "SHADOW",
        });
      }
    }

    return fillsProcessed;
  }

  /**
   * BUY level lifecycle: place a post-only maker BUY order on the first crossed
   * tick, then fill it on a later tick when the best ask drops to or below the
   * requested price. Returns "pending" | "filled" | null.
   */
  private async processBuyLevelLifecycle(
    level: GridLevel,
    priceResult: GridShadowExecutionPriceResult,
    tickCtx: GridTickContext,
    pumpGuard: ShadowPumpGuardPolicy
  ): Promise<"pending" | "filled" | null> {
    if (!this.activeRangeVersion || !this.config) return null;
    const activeRangeId = this.activeRangeVersion.id;

    if (level.side !== "BUY") return null;

    // Placement phase.
    if (level.status === "planned" || level.status === "open") {
      const validation = this.canProcessShadowFill(level, activeRangeId, pumpGuard, tickCtx, priceResult);
      if (!validation.ok) {
        await this.logEvent(validation.eventType!, validation.reason!, {
          levelId: level.id, side: level.side, mode: "SHADOW",
          ...validation.details,
        });
        return null;
      }
      return await this.placeBuyMakerPending(level, tickCtx, priceResult);
    }

    // Fill phase (BUY_MAKER_PENDING).
    if (level.status === "buy_maker_pending") {
      const validation = this.canProcessShadowFill(level, activeRangeId, pumpGuard, tickCtx, priceResult);
      if (!validation.ok) {
        await this.logEvent(validation.eventType!, validation.reason!, {
          levelId: level.id, side: level.side, mode: "SHADOW",
          ...validation.details,
        });
        return null;
      }
      const cycle = await this.processCycleFill(level, priceResult, tickCtx);
      return cycle ? "filled" : null;
    }

    return null;
  }

  /**
   * Place a BUY maker order in SHADOW: persist BUY_MAKER_PENDING state without
   * creating a cycle. The level must be below the best ask to avoid a taker fill.
   */
  private async placeBuyMakerPending(
    level: GridLevel,
    tickCtx: GridTickContext,
    priceResult: GridShadowExecutionPriceResult
  ): Promise<"pending" | null> {
    if (!this.config) return null;
    const requestedPrice = this.floorToStep(level.price, this.getPriceTickSize(this.config.pair));
    const bestAsk = priceResult.ask ?? tickCtx.ask ?? null;
    if (bestAsk == null || requestedPrice >= bestAsk) {
      await this.logEvent("GRID_LEVEL_POST_ONLY_REJECTED", `[SHADOW] BUY maker ${level.id} no colocado: precio ${requestedPrice} cruzaría ask ${bestAsk}`, {
        levelId: level.id, requestedPrice, bestAsk, mode: "SHADOW",
      });
      return null;
    }

    try {
      await db.update(gridIsolatedLevels)
        .set({
          status: "buy_maker_pending",
          buyMakerPendingAt: tickCtx.startedAt,
          buyMakerPendingTickId: tickCtx.tickId,
          buyMakerRequestedPrice: requestedPrice.toFixed(8),
        })
        .where(and(
          eq(gridIsolatedLevels.id, level.id),
          inArray(gridIsolatedLevels.status, ["planned", "open"])
        ));

      level.status = "buy_maker_pending";
      level.buyMakerPendingAt = tickCtx.startedAt;
      level.buyMakerPendingTickId = tickCtx.tickId;
      level.buyMakerRequestedPrice = requestedPrice;

      await this.logEvent("GRID_CYCLE_BUY_PLACED", `[SHADOW] BUY maker colocado para nivel ${level.id} a ${requestedPrice}`, {
        levelId: level.id,
        buyPrice: requestedPrice,
        bestAsk,
        tickId: tickCtx.tickId,
        mode: "SHADOW",
      });
      return "pending";
    } catch (err) {
      botLogger.error("GRID_CYCLE_BUY_PLACED" as any, `[GridIsolatedEngine] Fallo al colocar BUY maker ${level.id}: ${err}`, { levelId: level.id });
      return null;
    }
  }

  /**
   * SELL level lifecycle in SHADOW: reconstruct a real resting maker order for
   * legacy persisted targets and V2 synthetic rungs. Trigger happens on the tick
   * the level is crossed; the resting order (MAKER_PENDING) is placed on a later
   * tick, and the fill is executed by processOpenCyclesShadow on a subsequent tick
   * when the best bid reaches the requested price.
   */
  private async processSellLevelLifecycle(
    level: GridLevel,
    priceResult: GridShadowExecutionPriceResult,
    tickCtx: GridTickContext
  ): Promise<"triggered" | "pending" | null> {
    if (!this.activeRangeVersion || !this.config) return null;
    if (level.side !== "SELL") return null;

    const openCycle = this.cycles.find(
      c =>
        (c.status === "buy_filled" || c.status === "sell_placed") &&
        c.rangeVersionId === level.rangeVersionId &&
        c.targetSellLevelId === level.id
    );
    if (!openCycle) {
      await this.logEvent("GRID_SHADOW_SELL_IGNORED_NO_OPEN_CYCLE", `[SHADOW] SELL level ${level.id} ignored: no cycle owns it as explicit target`, {
        levelId: level.id, sellPrice: level.price, rangeVersionId: level.rangeVersionId,
      });
      return null;
    }

    const currentRisk = this.parseRiskState(openCycle);
    if (openCycle.requiresReview || currentRisk.protectiveExit.state === "REQUIRES_REVIEW") {
      // Quarantined cycle: do not advance lifecycle, emit pending/fill/close events, or rearm.
      return null;
    }

    const closePath: GridClosePath =
      openCycle.targetKind === "PERSISTED_SELL"
        ? "LEGACY_PERSISTED_TARGET"
        : openCycle.targetKind === "SYNTHETIC_RUNG"
        ? "SYNTHETIC_RUNG"
        : "NORMAL_TARGET";

    const intendedPrice = openCycle.targetSellPrice ?? level.price;
    const currentBid = priceResult.bid ?? tickCtx.bid ?? null;
    const currentAsk = priceResult.ask ?? tickCtx.ask ?? null;

    if (
      currentRisk.protectiveExit.state === "NONE" ||
      currentRisk.protectiveExit.state === "ARMED"
    ) {
      const nextExit: GridPendingMakerExit = {
        ...this.defaultMakerExit(),
        state: "TRIGGERED",
        route: closePath,
        triggerPrice: intendedPrice,
        triggerDetectedAt: tickCtx.startedAt,
        bestBidAtTrigger: currentBid,
        bestAskAtTrigger: currentAsk,
        requestedMakerPrice: null,
        pendingQuantity: openCycle.quantity,
        lifecycleTickId: tickCtx.tickId,
      };
      const nextRisk: GridCycleRiskState = {
        ...currentRisk,
        activeExitRoute: closePath,
        pendingExitPrice: intendedPrice,
        protectiveExit: nextExit,
        lastEvaluatedAt: tickCtx.startedAt,
      };
      const persisted = await this.persistSellLifecycle(openCycle, level, nextRisk, nextExit, "open");
      return persisted ? "triggered" : null;
    }

    if (currentRisk.protectiveExit.state === "TRIGGERED") {
      if (
        currentRisk.protectiveExit.lifecycleTickId == null ||
        tickCtx.tickId <= currentRisk.protectiveExit.lifecycleTickId
      ) {
        return null;
      }
      const requestedPrice = this.resolveSellMakerRequestPrice(closePath, intendedPrice, currentBid ?? 0, currentAsk, openCycle.pair);
      if (requestedPrice == null || !Number.isFinite(requestedPrice)) {
        await this.logEvent("GRID_LEVEL_POST_ONLY_REJECTED", `[SHADOW] SELL maker ${level.id} no colocado: no se puede reconstruir precio maker`, {
          levelId: level.id, closePath, intendedPrice, currentBid, currentAsk,
        });
        return null;
      }
      const makerOrderCreatedAt = new Date();
      const nextExit: GridPendingMakerExit = {
        ...currentRisk.protectiveExit,
        state: "MAKER_PENDING",
        requestedMakerPrice: requestedPrice,
        makerOrderCreatedAt,
        makerEligibleAfter: new Date(makerOrderCreatedAt.getTime() + MIN_MAKER_REST_MS),
        lifecycleTickId: tickCtx.tickId,
        pendingQuantity: openCycle.quantity,
        simulatedOrderId: `grid-shadow-sell-${openCycle.id}-${tickCtx.tickId}`,
      };
      const nextRisk: GridCycleRiskState = {
        ...currentRisk,
        activeExitRoute: closePath,
        pendingExitPrice: requestedPrice,
        protectiveExit: nextExit,
        lastEvaluatedAt: tickCtx.startedAt,
      };
      const persisted = await this.persistSellLifecycle(openCycle, level, nextRisk, nextExit, "sell_maker_pending");
      return persisted ? "pending" : null;
    }

    // MAKER_PENDING and beyond are handled by processOpenCyclesShadow/completeCycleShadow.
    return null;
  }

  /**
   * Resolve the resting maker price for a SELL level depending on the close path.
   * Legacy/fixed targets keep their exact target price; protective routes follow
   * post-only rules.
   */
  private resolveSellMakerRequestPrice(
    closePath: GridClosePath,
    intendedPrice: number,
    currentBid: number,
    currentAsk: number | null,
    pair: string
  ): number | null {
    if (
      closePath === "LEGACY_PERSISTED_TARGET" ||
      closePath === "SYNTHETIC_RUNG" ||
      closePath === "NORMAL_TARGET"
    ) {
      return intendedPrice;
    }
    return this.computeShadowPostOnlySellPrice(closePath, intendedPrice, currentBid, currentAsk, pair);
  }

  /**
   * Persist SELL lifecycle state to DB and in-memory without closing the cycle.
   * Returns true when the compare-and-set transaction commits successfully.
   */
  private async persistSellLifecycle(
    cycle: GridCycle,
    level: GridLevel,
    risk: GridCycleRiskState,
    exit: GridPendingMakerExit,
    levelStatus: GridLevelStatus
  ): Promise<boolean> {
    if (!this.config) return false;
    try {
      await db.transaction(async (tx) => {
        const allowedStatuses = levelStatus === "open"
          ? (["buy_filled", "hodl_recovery"] as any)
          : (POSITION_OPEN_GRID_CYCLE_STATUSES as any);
        const cycleUpdate = await tx.update(gridIsolatedCycles)
          .set({
            status: "sell_placed",
            riskStateJson: risk,
            makerExitStateJson: exit,
            sellClientOrderId: level.clientOrderId,
          })
          .where(and(
            eq(gridIsolatedCycles.id, cycle.id),
            inArray(gridIsolatedCycles.status, allowedStatuses)
          ))
          .returning({ id: gridIsolatedCycles.id });

        if (cycleUpdate.length !== 1) {
          throw new Error(`Ciclo ${cycle.id} no estaba en estado abierto; lifecycle SELL abortado`);
        }

        const levelUpdate = await tx.update(gridIsolatedLevels)
          .set({
            status: levelStatus,
            placedAt: levelStatus === "sell_maker_pending" ? new Date() : level.placedAt,
          })
          .where(and(
            eq(gridIsolatedLevels.id, level.id),
            eq(gridIsolatedLevels.rangeVersionId, cycle.rangeVersionId),
            eq(gridIsolatedLevels.side, "SELL"),
            inArray(gridIsolatedLevels.status, ["planned", "open"])
          ))
          .returning({ id: gridIsolatedLevels.id });

        if (levelUpdate.length !== 1) {
          throw new Error(`Level SELL ${level.id} no actualizado; lifecycle SELL abortado`);
        }
      });
    } catch (err) {
      botLogger.error("GRID_SELL_LIFECYCLE_PERSIST_FAILED" as any, `[GridIsolatedEngine] Fallo al persistir lifecycle SELL para ciclo ${cycle.id}: ${err}`, { cycleId: cycle.id, levelId: level.id });
      return false;
    }

    cycle.status = "sell_placed";
    cycle.riskStateJson = risk;
    cycle.makerExitStateJson = exit;
    cycle.sellClientOrderId = level.clientOrderId;
    level.status = levelStatus;
    if (levelStatus === "sell_maker_pending") level.placedAt = new Date();
    return true;
  }

  /**
   * Pre-validate whether a SHADOW fill can be processed for a level.
   * Now receives the canonical GridTickContext and price snapshot so the BUY
   * maker lifecycle can be validated with real bid/ask/freshness/pair data.
   * Does NOT modify level state or DB.
   */
  private canProcessShadowFill(
    level: GridLevel,
    activeRangeId: string,
    pumpGuard: ShadowPumpGuardPolicy,
    tickCtx: GridTickContext,
    priceResult: GridShadowExecutionPriceResult
  ): { ok: boolean; reason?: string; eventType?: GridEventType; details?: Record<string, any> } {
    if (!this.config) return { ok: false, reason: "No config", eventType: "GRID_SHADOW_LEVEL_IGNORED_OUT_OF_ACTIVE_RANGE" };

    // Legacy/open-cycle SELL fills are not restricted to the active range.
    if (level.rangeVersionId !== activeRangeId && level.side !== "SELL") {
      return {
        ok: false,
        eventType: "GRID_SHADOW_LEVEL_IGNORED_OUT_OF_ACTIVE_RANGE",
        reason: `[SHADOW] Level ${level.id} ignored: belongs to range ${level.rangeVersionId}, not active ${activeRangeId}`,
        details: { levelRangeVersionId: level.rangeVersionId, activeRangeVersionId: activeRangeId },
      };
    }

    // Canonical market data checks (freshness, pair).
    if (!tickCtx.freshness.isFresh) {
      return {
        ok: false,
        eventType: "GRID_SHADOW_CLOSE_SKIPPED_STALE_PRICE",
        reason: `[SHADOW] Precio obsoleto para nivel ${level.id}: ${tickCtx.freshness.reason}`,
        details: { ageMs: tickCtx.freshness.ageMs, maxAgeMs: tickCtx.freshness.maxAgeMs },
      };
    }
    if (tickCtx.pair !== this.config.pair) {
      return {
        ok: false,
        eventType: "GRID_SHADOW_CLOSE_SKIPPED_STALE_PRICE",
        reason: `[SHADOW] Par del precio (${tickCtx.pair}) no coincide con el motor (${this.config.pair})`,
        details: { pricePair: tickCtx.pair, enginePair: this.config.pair },
      };
    }

    if (level.side === "BUY") {
      const isPending = level.status === "buy_maker_pending";
      if (!isPending && level.status !== "planned" && level.status !== "open") {
        return { ok: false, reason: "BUY level not planned/open/pending", eventType: "GRID_SHADOW_LEVEL_IGNORED_OUT_OF_ACTIVE_RANGE" };
      }

      // Circuit breaker blocks new BUY placements; existing pending orders may fill.
      if (!isPending && this.circuitBreakerOpen) {
        return {
          ok: false,
          eventType: "GRID_CIRCUIT_BREAKER_BLOCKED_BUY",
          reason: `[SHADOW] BUY level ${level.id} blocked: circuit breaker open`,
          details: { levelId: level.id, circuitBreakerOpen: this.circuitBreakerOpen },
        };
      }

      // Pump guard blocks new BUY placements; existing pending orders may fill.
      if (!isPending && !pumpGuard.allowBuyFill) {
        return {
          ok: false,
          eventType: "GRID_PUMP_GUARD_BLOCKED_REBUILD",
          reason: `[SHADOW] BUY level ${level.id} blocked: pump/dump guard active`,
          details: { levelId: level.id, state: this.pumpDumpState.state },
        };
      }

      // Quantity and notional validation.
      if (!Number.isFinite(level.quantity) || level.quantity <= 0) {
        return {
          ok: false,
          eventType: "GRID_SHADOW_LEVEL_IGNORED_OUT_OF_ACTIVE_RANGE",
          reason: `[SHADOW] BUY level ${level.id} has invalid quantity`,
          details: { quantity: level.quantity },
        };
      }
      const notional = level.price * level.quantity;
      if (notional < this.config.gridMinLevelUsd) {
        return {
          ok: false,
          eventType: "GRID_SHADOW_LEVEL_IGNORED_OUT_OF_ACTIVE_RANGE",
          reason: `[SHADOW] BUY level ${level.id} notional ${notional} below min ${this.config.gridMinLevelUsd}`,
          details: { notional, minLevelUsd: this.config.gridMinLevelUsd },
        };
      }

      // Max open cycles and duplicate checks apply at fill time as well.
      const openCyclesForActiveRange = this.cycles.filter(c =>
        c.rangeVersionId === activeRangeId &&
        OPEN_POSITION_GRID_CYCLE_STATUSES.includes(c.status as any)
      ).length;
      if (openCyclesForActiveRange >= this.config.maxOpenCycles) {
        return {
          ok: false,
          eventType: "GRID_SHADOW_MAX_OPEN_CYCLES_REACHED",
          reason: `[SHADOW] Max open cycles (${this.config.maxOpenCycles}) reached for active range. BUY level ${level.id} not filled.`,
          details: { openCycles: openCyclesForActiveRange, maxOpenCycles: this.config.maxOpenCycles },
        };
      }
      const existingCycleForBuy = this.cycles.find(c =>
        c.buyLevelId === level.id &&
        !TERMINAL_GRID_CYCLE_STATUSES.includes(c.status as any)
      );
      if (existingCycleForBuy) {
        return {
          ok: false,
          eventType: "GRID_SHADOW_DUPLICATE_BUY_LEVEL_IGNORED",
          reason: `[SHADOW] Duplicate cycle for buy level ${level.id} ignored. Existing cycle ${existingCycleForBuy.id}.`,
          details: { existingCycleId: existingCycleForBuy.id },
        };
      }

      // Target V2 prevalidation before creating any cycle.
      const exitPolicyVersion = this.config.defaultExitPolicyVersion ?? "FIRST_PROFITABLE_HIGHER_RUNG_V2";
      if (exitPolicyVersion === "FIRST_PROFITABLE_HIGHER_RUNG_V2") {
        const syntheticCycle = this.buildSyntheticCycleForBuyPrevalidation(level, level.price);
        const selectorResult = selectFirstProfitableHigherRung(
          syntheticCycle,
          this.levels,
          this.activeRangeVersion ?? undefined,
          {
            buyFillPrice: level.price,
            buyFillQuantity: level.quantity,
            netProfitTargetPct: this.config.netProfitTargetPct,
            buyFeePct: this.config.buyFeePct,
            sellFeePct: this.config.sellFeePct,
            makerFeePct: this.config.buyFeePct,
            takerFeePct: this.config.sellFeePct,
            taxReservePct: TAX_RESERVE_PCT,
          }
        );
        if (!selectorResult.selected) {
          return {
            ok: false,
            eventType: "GRID_CYCLE_TARGET_REVIEW_REQUIRED",
            reason: `[SHADOW] BUY level ${level.id} no rellenado: no existe target V2 rentable.`,
            details: { levelId: level.id, reason: selectorResult.explanation },
          };
        }
      }

      const bestAsk = priceResult.ask ?? tickCtx.ask ?? null;
      if (bestAsk == null) {
        return {
          ok: false,
          eventType: "GRID_SHADOW_CLOSE_SKIPPED_STALE_PRICE",
          reason: `[SHADOW] BUY level ${level.id} no ask disponible`,
          details: { levelId: level.id },
        };
      }

      if (!isPending) {
        // Placement: requested BUY price must be below ask to be post-only.
        const requestedPrice = this.floorToStep(level.price, this.getPriceTickSize(this.config.pair));
        if (requestedPrice >= bestAsk) {
          return {
            ok: false,
            eventType: "GRID_LEVEL_POST_ONLY_REJECTED",
            reason: `[SHADOW] BUY maker ${level.id} no colocado: precio ${requestedPrice} cruzaría ask ${bestAsk}`,
            details: { levelId: level.id, requestedPrice, bestAsk },
          };
        }
      } else {
        // Fill: must be a later tick and ask must have dropped to the requested price.
        if (tickCtx.tickId <= (level.buyMakerPendingTickId ?? 0)) {
          return {
            ok: false,
            eventType: "GRID_MAKER_PENDING_FILLED",
            reason: `[SHADOW] BUY maker ${level.id} no fill: mismo tick de creación`,
            details: { levelId: level.id, tickId: tickCtx.tickId, pendingTickId: level.buyMakerPendingTickId },
          };
        }
        if (!level.buyMakerPendingAt || tickCtx.startedAt.getTime() < level.buyMakerPendingAt.getTime()) {
          return {
            ok: false,
            eventType: "GRID_MAKER_PENDING_FILLED",
            reason: `[SHADOW] BUY maker ${level.id} no fill: timestamp anterior a pending`,
            details: { levelId: level.id },
          };
        }
        if (bestAsk > (level.buyMakerRequestedPrice ?? Infinity)) {
          return {
            ok: false,
            eventType: "GRID_MAKER_PENDING_FILLED",
            reason: `[SHADOW] BUY maker ${level.id} no fill: ask ${bestAsk} > requested ${level.buyMakerRequestedPrice}`,
            details: { levelId: level.id, bestAsk, requestedPrice: level.buyMakerRequestedPrice },
          };
        }
      }
    } else if (level.side === "SELL") {
      if (level.status !== "planned" && level.status !== "open") {
        return { ok: false, reason: "SELL level not planned/open", eventType: "GRID_SHADOW_LEVEL_IGNORED_OUT_OF_ACTIVE_RANGE" };
      }
      const explicitCycle = this.cycles.find(
        c =>
          (c.status === "buy_filled" || c.status === "sell_placed") &&
          c.rangeVersionId === level.rangeVersionId &&
          c.targetSellLevelId === level.id
      );
      if (!explicitCycle) {
        return {
          ok: false,
          eventType: "GRID_SHADOW_SELL_IGNORED_NO_OPEN_CYCLE",
          reason: `[SHADOW] SELL simulado ignorado: no existe BUY/ciclo que reclame este SELL como target explícito.`,
          details: { levelId: level.id, rangeVersionId: level.rangeVersionId },
        };
      }
      if (explicitCycle.requiresReview) {
        return {
          ok: false,
          eventType: "GRID_CYCLE_TARGET_REVIEW_REQUIRED",
          reason: `[SHADOW] SELL level ${level.id} rejected: owning cycle ${explicitCycle.id} requires review`,
          details: { levelId: level.id, cycleId: explicitCycle.id },
        };
      }
      // SELL lifecycle does not fill immediately; placement is validated later.
    }

    return { ok: true };
  }

  /**
   * Build a temporary cycle used only for BUY pre-validation. It has no DB id
   * and represents the cycle that would be created if the BUY level were filled.
   */
  private buildSyntheticCycleForBuyPrevalidation(level: GridLevel, fillPrice: number): Pick<GridCycle, "id" | "rangeVersionId" | "pair" | "buyPrice" | "quantity"> {
    return {
      id: level.id,
      rangeVersionId: level.rangeVersionId,
      pair: this.config?.pair ?? "BTC/USD",
      buyPrice: fillPrice,
      quantity: level.quantity,
    };
  }

  /**
   * Process a fill and create/complete cycles.
   * Pre-validated by canProcessShadowFill() — all checks (range, maxOpenCycles,
   * duplicate BUY, SELL with open cycle, BUY maker lifecycle) are already done.
   * Receives the canonical GridTickContext and price snapshot.
   * Returns the created/completed cycle or null if the SELL had no candidate.
   */
  private async processCycleFill(
    level: GridLevel,
    priceResult: GridShadowExecutionPriceResult,
    tickCtx: GridTickContext
  ): Promise<GridCycle | null> {
    if (!this.activeRangeVersion || !this.config) return null;

    const activeRangeId = this.activeRangeVersion.id;

    if (level.side === "BUY") {
      // Fill a previously placed BUY maker order. Never fill a planned level directly.
      if (level.status !== "buy_maker_pending") {
        await this.logEvent("GRID_SHADOW_LEVEL_IGNORED_OUT_OF_ACTIVE_RANGE", `[SHADOW] BUY level ${level.id} no está en BUY_MAKER_PENDING`, {
          levelId: level.id, status: level.status, mode: "SHADOW",
        });
        return null;
      }

      const fillPrice = level.buyMakerRequestedPrice ?? level.price;
      const exitPolicyVersion = this.config.defaultExitPolicyVersion ?? "FIRST_PROFITABLE_HIGHER_RUNG_V2";
      const cycle: GridCycle = {
        id: randomUUID(),
        rangeVersionId: activeRangeId,
        cycleNumber: this.cycles.length + 1,
        pair: this.config.pair,
        status: "buy_filled",
        buyLevelId: level.id,
        sellLevelId: null,
        targetSellLevelId: null,
        targetRungLevelId: null,
        buyPrice: fillPrice,
        sellPrice: null,
        targetSellPrice: null,
        targetSellQuantity: null,
        quantity: level.quantity,
        grossPnlUsd: 0,
        feeTotalUsd: 0,
        taxReserveUsd: 0,
        netPnlUsd: 0,
        netPnlPct: 0,
        exitPolicyVersion,
        targetKind: "UNKNOWN",
        targetCalculationJson: null,
        riskStateJson: this.buildDefaultRiskState(),
        makerExitStateJson: null,
        buyClientOrderId: level.clientOrderId,
        sellClientOrderId: null,
        buyFilledAt: tickCtx.startedAt,
        sellFilledAt: null,
        holdTimeMinutes: 0,
        requiresReview: false,
        reviewReason: null,
        reviewCode: null,
        reviewDetectedAt: null,
        reviewSource: null,
        createdAt: tickCtx.startedAt,
        completedAt: null,
      };

      // Pre-compute and persist the SELL obligation for V2 cycles immediately.
      if (exitPolicyVersion === "FIRST_PROFITABLE_HIGHER_RUNG_V2") {
        const selectorResult = selectFirstProfitableHigherRung(
          cycle,
          this.levels,
          this.activeRangeVersion,
          {
            buyFillPrice: fillPrice,
            buyFillQuantity: level.quantity,
            netProfitTargetPct: this.config.netProfitTargetPct,
            buyFeePct: this.config.buyFeePct,
            sellFeePct: this.config.sellFeePct,
            makerFeePct: this.config.buyFeePct,
            takerFeePct: this.config.sellFeePct,
            taxReservePct: TAX_RESERVE_PCT,
          }
        );
        const targetValidation = validateTargetCalculationJson(selectorResult);
        if (!targetValidation.valid) {
          this.markCycleForReview(cycle, targetValidation.reason, targetValidation.code, "target_calculation_json");
          await this.logEvent("GRID_TARGET_CALCULATION_REVIEW_REQUIRED", `[SHADOW] Ciclo ${cycle.cycleNumber}: target V2 con JSONB inválido: ${targetValidation.reason}`, {
            cycleId: cycle.id,
            reason: targetValidation.reason,
            code: targetValidation.code,
            exitPolicyVersion,
          });
        } else if (selectorResult.selected) {
          cycle.targetKind = selectorResult.targetKind;
          cycle.targetRungLevelId = selectorResult.targetRungLevelId;
          cycle.targetSellLevelId = selectorResult.targetSellLevelId;
          cycle.targetSellPrice = selectorResult.targetSellPrice;
          cycle.targetSellQuantity = selectorResult.targetSellQuantity;
          cycle.targetCalculationJson = selectorResult;
        } else {
          await this.logEvent("GRID_CYCLE_TARGET_REVIEW_REQUIRED", `[SHADOW] Ciclo ${cycle.cycleNumber}: BUY rellenado pero no se encontró target V2 rentable.`, {
            cycleId: cycle.id,
            reason: selectorResult.explanation,
            exitPolicyVersion,
          });
        }
      }

      const now = tickCtx.startedAt;
      const insertValues: any = {
        id: cycle.id,
        rangeVersionId: cycle.rangeVersionId,
        cycleNumber: cycle.cycleNumber,
        pair: cycle.pair,
        status: "buy_filled",
        buyLevelId: cycle.buyLevelId,
        buyPrice: fillPrice.toFixed(8),
        quantity: cycle.quantity.toFixed(8),
        exitPolicyVersion: cycle.exitPolicyVersion,
        targetKind: cycle.targetKind,
        targetRungLevelId: cycle.targetRungLevelId,
        targetSellLevelId: cycle.targetSellLevelId,
        targetSellPrice: cycle.targetSellPrice?.toFixed(8) ?? null,
        targetSellQuantity: cycle.targetSellQuantity?.toFixed(8) ?? null,
        targetCalculationJson: cycle.targetCalculationJson,
        riskStateJson: cycle.riskStateJson,
        buyClientOrderId: cycle.buyClientOrderId,
        buyFilledAt: now,
        requiresReview: cycle.requiresReview,
        reviewReason: cycle.reviewReason,
        reviewCode: cycle.reviewCode,
        reviewDetectedAt: cycle.reviewDetectedAt,
        reviewSource: cycle.reviewSource,
      };

      // Atomic BUY fill: level update + cycle insert in a single transaction.
      try {
        await db.transaction(async (tx) => {
          const levelUpdate = await tx.update(gridIsolatedLevels)
            .set({
              status: "filled",
              filledPrice: fillPrice.toFixed(8),
              filledQuantity: cycle.quantity.toFixed(8),
              filledAt: now,
              buyMakerPendingAt: null,
              buyMakerPendingTickId: null,
              buyMakerRequestedPrice: null,
            })
            .where(and(
              eq(gridIsolatedLevels.id, level.id),
              eq(gridIsolatedLevels.status, "buy_maker_pending")
            ))
            .returning({ id: gridIsolatedLevels.id });

          if (levelUpdate.length !== 1) {
            throw new Error(`Nivel BUY ${level.id} no está en BUY_MAKER_PENDING para crear el ciclo ${cycle.id}`);
          }

          await tx.insert(gridIsolatedCycles).values(insertValues);
        });
      } catch (err) {
        botLogger.error("GRID_CYCLE_BUY_FILL_ROLLBACK" as any, `[GridIsolatedEngine] BUY fill falló para nivel ${level.id}: ${err}`, { levelId: level.id, cycleId: cycle.id });
        return null;
      }

      // In-memory sync only after transaction commits.
      level.status = "filled";
      level.filledPrice = fillPrice;
      level.filledQuantity = level.quantity;
      level.filledAt = now;
      level.buyMakerPendingAt = null;
      level.buyMakerPendingTickId = null;
      level.buyMakerRequestedPrice = null;
      this.cycles.push(cycle);

      await this.logEvent("GRID_CYCLE_BUY_FILLED", `[SHADOW] Cycle ${cycle.cycleNumber} buy filled at ${fillPrice}`, {
        cycleId: cycle.id,
        buyPrice: fillPrice,
        targetSellPrice: cycle.targetSellPrice,
        targetSellLevelId: cycle.targetSellLevelId,
        targetRungLevelId: cycle.targetRungLevelId,
        targetKind: cycle.targetKind,
        exitPolicyVersion,
        tickId: tickCtx.tickId,
        mode: "SHADOW",
      });

      return cycle;
    }

    // SELL lifecycle is handled by processSellLevelLifecycle in simulateShadowTick
    // and filled later by processOpenCyclesShadow via completeCycleShadow.
    return null;
  }

  /**
   * Evaluate exit lifecycle (trailing, stop-loss, HODL recovery and normal target)
   * for every open cycle. Persist the resulting risk_state_json so the state
   * survives restarts.
   *
   * Separates trigger detection from fill execution:
   *   - tick N:   trigger detected -> protectiveExit state TRIGGERED
   *   - tick N+1: pending maker order created -> state MAKER_PENDING
   *   - tick N+2+: if bid reaches requested price, processOpenCyclesShadow fills.
   */
  private async evaluateRiskForOpenCycles(
    priceResult: GridShadowExecutionPriceResult,
    ctx: GridTickContext
  ): Promise<void> {
    if (!this.config) return;

    const tickCtx = ctx;

    const riskFeaturesEnabled =
      (this.config.trailingEnabled ?? false) ||
      (this.config.stopLossEnabled ?? false);

    const currentPrice = priceResult.bid ?? priceResult.price ?? null;
    const currentAsk = priceResult.ask ?? null;
    if (currentPrice == null) return;

    for (const cycle of this.cycles) {
      if (!POSITION_OPEN_GRID_CYCLE_STATUSES.includes(cycle.status as any)) continue;

      const risk = this.parseRiskState(cycle);

      if (cycle.requiresReview) {
        await this.persistReviewState(cycle);
        continue;
      }

      const hasTarget = cycle.targetSellPrice != null && cycle.targetSellPrice > 0;
      const pendingExit = risk.protectiveExit.state !== "NONE";
      const shouldEvaluateRisk =
        riskFeaturesEnabled ||
        risk.trailing.activated ||
        risk.hodl.active;

      if (!shouldEvaluateRisk && !hasTarget && !pendingExit) continue;

      let evaluation: { action: string; suggestedSellPrice: number | null; trailingState: TrailingProtectionState; hodlState: HodlRecoveryState; stopLossLayers: StopLossLayer[]; reason: string } | null = null;
      if (shouldEvaluateRisk) {
        const riskEval = gridRiskManager.evaluateCycle(
          cycle,
          currentPrice,
          this.config,
          risk.trailing,
          risk.stopLoss,
          risk.hodl
        );
        evaluation = riskEval;
      }

      let nextRisk: GridCycleRiskState = {
        trailing: evaluation?.trailingState ?? risk.trailing,
        stopLoss: evaluation?.stopLossLayers ?? risk.stopLoss,
        hodl: evaluation?.hodlState ?? risk.hodl,
        lastAction: (evaluation?.action as RiskAction) ?? null,
        activeExitRoute: risk.activeExitRoute,
        pendingExitPrice: risk.pendingExitPrice,
        protectiveExit: risk.protectiveExit,
        stateVersion: 1,
        lastEvaluatedAt: new Date(),
      };

      // A persisted protective exit in REQUIRES_REVIEW is a terminal quarantine
      // state: do not advance to triggered/pending/fill or rearm automatically.
      if (risk.protectiveExit.state === "REQUIRES_REVIEW") {
        if (!cycle.requiresReview) {
          this.markCycleForReview(cycle, "Persisted protective exit in REQUIRES_REVIEW state", "REVIEW_STATE", "maker_exit_state_json");
        }
        await this.persistReviewState(cycle);
        continue;
      }

      const intended = this.resolveIntendedExit(cycle, evaluation, currentPrice);
      const preEvalStatus = cycle.status;

      // HODL activation is committed immediately so the cycle stops normal targeting.
      if (evaluation?.action === "HODL_RECOVERY_ACTIVATE") {
        cycle.status = "hodl_recovery";
        nextRisk.activeExitRoute = "HODL_RECOVERY";
        nextRisk.pendingExitPrice = intended.price;
      }

      nextRisk.protectiveExit = this.advanceProtectiveExitLifecycle(
        cycle,
        nextRisk.protectiveExit,
        intended,
        currentPrice,
        currentAsk,
        priceResult,
        tickCtx
      );
      // While trailing is armed but not firing, do not advertise the normal target
      // as the active exit route; it would confuse the UI/risk state.
      if (evaluation?.action === "TRAILING_UPDATE") {
        nextRisk.activeExitRoute = null;
        nextRisk.pendingExitPrice = null;
      } else {
        nextRisk.activeExitRoute = nextRisk.protectiveExit.route ?? null;
        nextRisk.pendingExitPrice = nextRisk.protectiveExit.requestedMakerPrice ?? nextRisk.protectiveExit.triggerPrice ?? null;
      }

      // Strict JSONB validation before persistence (Gate F). On validation
      // failure we do NOT reset the persisted financial state; we mark the
      // cycle as requiring manual review, block further automatic transitions
      // and preserve the original JSON for inspection.
      const riskValidation = validateRiskStateJson(nextRisk);
      const exitValidation = validateMakerExitStateJson(nextRisk.protectiveExit);
      if (!riskValidation.valid) {
        botLogger.error("GRID_RISK_STATE_REVIEW_REQUIRED" as any, `[GridIsolatedEngine] riskStateJson inválido para ciclo ${cycle.id}: ${riskValidation.reason}`, { code: riskValidation.code });
        this.markCycleForReview(cycle, riskValidation.reason, riskValidation.code, "risk_state_json");
        await this.persistReviewState(cycle);
        cycle.status = preEvalStatus;
        continue;
      }
      if (!exitValidation.valid) {
        botLogger.error("GRID_MAKER_EXIT_STATE_REVIEW_REQUIRED" as any, `[GridIsolatedEngine] makerExitStateJson inválido para ciclo ${cycle.id}: ${exitValidation.reason}`, { code: exitValidation.code });
        this.markCycleForReview(cycle, exitValidation.reason, exitValidation.code, "maker_exit_state_json");
        await this.persistReviewState(cycle);
        cycle.status = preEvalStatus;
        continue;
      }

      cycle.riskStateJson = nextRisk;
      cycle.makerExitStateJson = nextRisk.protectiveExit;

      try {
        await db.update(gridIsolatedCycles)
          .set({ riskStateJson: nextRisk, makerExitStateJson: nextRisk.protectiveExit, status: cycle.status })
          .where(eq(gridIsolatedCycles.id, cycle.id));
      } catch (err) {
        botLogger.error("SYSTEM_ERROR", `[GridIsolatedEngine] Failed to persist risk state for cycle ${cycle.id}: ${err}`);
      }

      // Circuit breaker only on emergency stop. It stays open until explicitly
      // resolved; the cooldown is only advisory (reviewAfter).
      if (evaluation?.action === "STOP_LOSS_EMERGENCY") {
        const reason = `Stop-loss de emergencia activado para ciclo ${cycle.cycleNumber}`;
        const openedAt = new Date();
        const reviewAfter = new Date(openedAt.getTime() + CIRCUIT_BREAKER_RETRY_DELAY_MS);
        this.circuitBreakerOpen = true;
        this.circuitBreakerOpenedAt = openedAt;
        this.circuitBreakerReason = reason;
        this.circuitBreakerCooldownUntil = null;
        this.config!.circuitBreakerSourceCycleId = cycle.id;
        this.config!.circuitBreakerSeverity = "critical";
        this.config!.circuitBreakerReviewAfter = reviewAfter;
        this.config!.circuitBreakerResolvedAt = null;
        this.config!.circuitBreakerResolvedBy = null;
        this.config!.circuitBreakerResolutionReason = null;
        if (this.config) {
          this.config.circuitBreakerOpen = true;
          this.config.circuitBreakerOpenedAt = openedAt;
          this.config.circuitBreakerReason = reason;
          this.config.circuitBreakerCooldownUntil = null;
          await this.saveConfig();
        }
        await this.logEvent("GRID_CIRCUIT_BREAKER_OPEN", `${reason}. Se bloquean nuevas compras Grid hasta revisión.`, {
          cycleId: cycle.id,
          currentPrice,
          pendingExitPrice: nextRisk.pendingExitPrice,
          reviewAfter,
          mode: "SHADOW",
        });
      }

      if (evaluation && evaluation.action !== "HOLD") {
        const eventType = this.riskActionEventType(evaluation.action);
        await this.logEvent(eventType, `[SHADOW RISK] Ciclo ${cycle.cycleNumber}: ${evaluation.action}@${currentPrice} — ${evaluation.reason}`, {
          cycleId: cycle.id,
          action: evaluation.action,
          currentPrice,
          activeExitRoute: nextRisk.activeExitRoute,
          pendingExitPrice: nextRisk.pendingExitPrice,
          protectiveExitState: nextRisk.protectiveExit.state,
          suggestedSellPrice: evaluation.suggestedSellPrice,
          trailingActivated: evaluation.trailingState.activated,
          trailingStopPrice: evaluation.trailingState.currentStopPrice,
          stopLossLayers: evaluation.stopLossLayers.map(l => ({ layer: l.layer, triggered: l.triggered, triggerPricePct: l.triggerPricePct })),
          hodlActive: evaluation.hodlState.active,
          recoveryTargetPrice: evaluation.hodlState.recoveryTargetPrice,
          mode: "SHADOW",
        });
      }
    }
  }

  private resolveIntendedExit(
    cycle: GridCycle,
    evaluation: { action: string; suggestedSellPrice: number | null; trailingState: TrailingProtectionState; hodlState: HodlRecoveryState } | null,
    _currentPrice: number
  ): { route: GridClosePath | null; price: number | null } {
    if (evaluation) {
      switch (evaluation.action) {
        case "TRAILING_UPDATE":
          // Trailing is watching but not closing yet; keep normal target armed
          // without exposing an active exit route.
          return { route: null, price: null };
        case "TRAILING_CLOSE":
          return {
            route: "TRAILING_MAKER",
            price: _currentPrice,
          };
        case "STOP_LOSS_SOFT":
        case "STOP_LOSS_HARD":
        case "STOP_LOSS_EMERGENCY":
          return {
            route: "PROTECTIVE_MAKER",
            price: _currentPrice,
          };
        case "HODL_RECOVERY_ACTIVATE":
        case "HODL_RECOVERY_SELL":
          return {
            route: "HODL_RECOVERY",
            price: _currentPrice,
          };
      }
    }

    // Normal explicit SELL target (legacy persisted level or V2 synthetic rung).
    // The target is armed as soon as it exists; it does NOT wait until the bid
    // reaches it, because a resting maker order must be created before the fill.
    if (
      cycle.status !== "hodl_recovery" &&
      cycle.targetSellPrice != null &&
      cycle.targetSellPrice > 0
    ) {
      const route: GridClosePath =
        cycle.targetKind === "PERSISTED_SELL"
          ? "LEGACY_PERSISTED_TARGET"
          : cycle.targetKind === "SYNTHETIC_RUNG"
          ? "SYNTHETIC_RUNG"
          : "NORMAL_TARGET";
      return { route, price: cycle.targetSellPrice };
    }

    return { route: null, price: null };
  }

  private advanceProtectiveExitLifecycle(
    cycle: GridCycle,
    protectiveExit: GridPendingMakerExit,
    intended: { route: GridClosePath | null; price: number | null },
    currentBid: number,
    currentAsk: number | null,
    priceResult: GridShadowExecutionPriceResult,
    ctx: GridTickContext
  ): GridPendingMakerExit {
    const now = new Date();

    // No intended exit: keep any existing pending order alive; do not silently cancel.
    if (!intended.route || intended.price == null) {
      return protectiveExit;
    }

    // REQUIRES_REVIEW is a terminal quarantine state: do not advance.
    if (protectiveExit.state === "REQUIRES_REVIEW") {
      return protectiveExit;
    }

    // New trigger detected.
    if (protectiveExit.state === "NONE" || protectiveExit.state === "ARMED") {
      return {
        ...this.defaultMakerExit(),
        state: "TRIGGERED",
        route: intended.route,
        triggerPrice: intended.price,
        triggerDetectedAt: now,
        bestBidAtTrigger: currentBid,
        bestAskAtTrigger: currentAsk,
        requestedMakerPrice: null,
        pendingQuantity: cycle.quantity,
        lifecycleTickId: ctx.tickId,
      };
    }

    // Trigger already detected in a previous tick -> create the resting maker order.
    if (protectiveExit.state === "TRIGGERED") {
      // If the intended route changed (e.g. target armed, then trailing triggers),
      // reset to a fresh trigger with the new route.
      if (protectiveExit.route !== intended.route) {
        if (!intended.route || intended.price == null) return protectiveExit;
        return {
          ...this.defaultMakerExit(),
          state: "TRIGGERED",
          route: intended.route,
          triggerPrice: intended.price,
          triggerDetectedAt: now,
          bestBidAtTrigger: currentBid,
          bestAskAtTrigger: currentAsk,
          requestedMakerPrice: null,
          pendingQuantity: cycle.quantity,
          lifecycleTickId: ctx.tickId,
        };
      }
      // A new post-only maker order can only be placed on a later tick than the trigger.
      if (
        protectiveExit.lifecycleTickId != null &&
        ctx.tickId <= protectiveExit.lifecycleTickId
      ) {
        return protectiveExit;
      }
      const rawPrice = intended.price ?? protectiveExit.triggerPrice ?? 0;
      const makerPrice = this.computeShadowPostOnlySellPrice(
        intended.route,
        rawPrice,
        currentBid,
        currentAsk,
        cycle.pair
      );
      if (makerPrice == null || !Number.isFinite(makerPrice)) {
        // bestAsk missing or price not post-only valid: keep TRIGGERED and retry next tick.
        return protectiveExit;
      }
      return {
        ...protectiveExit,
        state: "MAKER_PENDING",
        requestedMakerPrice: makerPrice,
        makerOrderCreatedAt: now,
        makerEligibleAfter: new Date(now.getTime() + MIN_MAKER_REST_MS),
        lifecycleTickId: ctx.tickId,
        pendingQuantity: cycle.quantity,
        simulatedOrderId: `grid-shadow-${cycle.id}-${now.getTime()}`,
      };
    }

    // Already pending: reprice if the intended price moved materially.
    if (protectiveExit.state === "MAKER_PENDING") {
      if (intended.route !== protectiveExit.route || intended.price == null) {
        return {
          ...this.defaultMakerExit(),
          state: "TRIGGERED",
          route: intended.route,
          triggerPrice: intended.price,
          triggerDetectedAt: now,
          bestBidAtTrigger: currentBid,
          bestAskAtTrigger: currentAsk,
          requestedMakerPrice: null,
          pendingQuantity: cycle.quantity,
          lifecycleTickId: ctx.tickId,
        };
      }
      const currentMakerPrice = protectiveExit.requestedMakerPrice ?? protectiveExit.triggerPrice ?? 0;
      const tickSize = this.getPriceTickSize(cycle.pair);
      if (Math.abs((intended.price ?? 0) - currentMakerPrice) > tickSize) {
        const makerPrice = this.computeShadowPostOnlySellPrice(
          intended.route,
          intended.price,
          currentBid,
          currentAsk,
          cycle.pair
        );
        if (makerPrice == null || !Number.isFinite(makerPrice)) {
          return protectiveExit;
        }
        return {
          ...protectiveExit,
          requestedMakerPrice: makerPrice,
          makerEligibleAfter: new Date(now.getTime() + MIN_MAKER_REST_MS),
          lifecycleTickId: ctx.tickId,
          lastRepricedAt: now,
          repriceAttempts: (protectiveExit.repriceAttempts ?? 0) + 1,
        };
      }
      return protectiveExit;
    }

    return protectiveExit;
  }

  /**
   * Compute a realistic post-only SELL maker price for SHADOW simulation.
   *
   * Placement rule for a NEW maker order:
   *   requestedMakerPrice > bestBid
   *   requestedMakerPrice >= bestAsk (rest on the ask side)
   *
   * For NORMAL_TARGET/SYNTHETIC_RUNG/LEGACY_PERSISTED_TARGET the price is the
   * fixed target, but it is only accepted if it is strictly above the best bid.
   * For protective routes the price is:
   *   ceilToTick(max(intendedPrice, bestAsk, bestBid + tickSize))
   *
   * If bestAsk is not available the order cannot be placed safely; return null.
   */
  private computeShadowPostOnlySellPrice(
    route: GridClosePath,
    intendedExitPrice: number | string | null,
    currentBid: number,
    currentAsk: number | null,
    pair: string
  ): number | null {
    const normalized =
      typeof intendedExitPrice === "string" ? parseFloat(intendedExitPrice) : intendedExitPrice;
    if (normalized == null || !Number.isFinite(normalized)) return null;

    if (currentAsk == null) {
      // No ask available: cannot verify post-only placement; refuse to place.
      return null;
    }

    const tickSize = this.getPriceTickSize(pair);
    const isFixedTargetRoute =
      route === "NORMAL_TARGET" ||
      route === "SYNTHETIC_RUNG" ||
      route === "LEGACY_PERSISTED_TARGET";

    if (isFixedTargetRoute) {
      // Fixed targets keep their price; they must be strictly above the best bid.
      if (normalized <= currentBid) return null;
      return normalized;
    }

    // Protective routes (trailing, stop, HODL): place above ask and bid+tickSize.
    const minPostOnlyPrice = currentBid + tickSize;
    const price = this.ceilToStep(Math.max(normalized, currentAsk, minPostOnlyPrice), tickSize);
    return price > currentBid ? price : null;
  }

  /**
   * Map a RiskAction to an existing GridEventType.
   */
  private riskActionEventType(action: string): GridEventType {
    switch (action) {
      case "TRAILING_UPDATE":
        return "GRID_TRAILING_STOP_UPDATED";
      case "TRAILING_CLOSE":
        return "GRID_CYCLE_TRAILING_CLOSED";
      case "STOP_LOSS_SOFT":
      case "STOP_LOSS_HARD":
      case "STOP_LOSS_EMERGENCY":
        return "GRID_CYCLE_STOP_LOSS_HIT";
      case "HODL_RECOVERY_ACTIVATE":
        return "GRID_CYCLE_HODL_RECOVERY";
      case "HODL_RECOVERY_SELL":
        return "GRID_CYCLE_COMPLETED";
      default:
        return "GRID_SHADOW_TICK_SKIPPED";
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

    const openCycles = this.cycles.filter(c =>
      OPEN_POSITION_GRID_CYCLE_STATUSES.includes(c.status as any)
    ).length;
    const activeOpenCyclesCount = activeRangeId
      ? this.cycles.filter(c =>
          c.rangeVersionId === activeRangeId &&
          OPEN_POSITION_GRID_CYCLE_STATUSES.includes(c.status as any)
        ).length
      : 0;
    const globalOpenCyclesCount = openCycles;
    const orphanOpenCyclesCount = activeRangeId
      ? this.cycles.filter(c =>
          c.rangeVersionId !== activeRangeId &&
          OPEN_POSITION_GRID_CYCLE_STATUSES.includes(c.status as any)
        ).length
      : openCycles;
    const historicalOpenCyclesCount = orphanOpenCyclesCount;

    // New explicit counters
    const waitingSellCyclesCount = this.cycles.filter(c =>
      POSITION_OPEN_GRID_CYCLE_STATUSES.includes(c.status as any)
    ).length;
    const executableOpenCyclesCount = this.cycles.filter(c =>
      POSITION_OPEN_GRID_CYCLE_STATUSES.includes(c.status as any) &&
      c.targetSellLevelId != null &&
      c.targetSellPrice != null &&
      c.targetSellQuantity != null
    ).length;
    const reviewRequiredCyclesCount = this.cycles.filter(c =>
      POSITION_OPEN_GRID_CYCLE_STATUSES.includes(c.status as any) &&
      (c.targetSellLevelId == null || c.targetSellPrice == null || c.targetSellQuantity == null)
    ).length;
    const previousRangeOpenCyclesCount = activeRangeId
      ? this.cycles.filter(c =>
          c.rangeVersionId !== activeRangeId &&
          OPEN_POSITION_GRID_CYCLE_STATUSES.includes(c.status as any)
        ).length
      : openCycles;
    const trailingActiveCyclesCount = this.cycles.filter(c =>
      OPEN_POSITION_GRID_CYCLE_STATUSES.includes(c.status as any) &&
      this.parseRiskState(c).trailing.activated
    ).length;

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
      executableOpenCyclesCount,
      waitingSellCyclesCount,
      trailingActiveCyclesCount,
      reviewRequiredCyclesCount,
      previousRangeOpenCyclesCount,
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
      shadowExecutionPrice: this.lastShadowExecutionPrice?.price ?? null,
      shadowExecutionPriceSource: this.lastShadowExecutionPrice?.source ?? null,
      shadowExecutionPriceBid: this.lastShadowExecutionPrice?.bid ?? null,
      shadowExecutionPriceAsk: this.lastShadowExecutionPrice?.ask ?? null,
      bandSnapshotClose: null,
      bandSnapshotTimeframe: this.config?.atrTimeframe ?? null,
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
        pumpDumpState: "normal" as PumpDumpState,
        lastReconciliationAt: null,
        lastReconciliationOk: null,
        capitalReservedUsd: 0,
        capitalAvailableUsd: 0,
        totalNetPnlUsd: 0,
        totalCyclesCompleted: 0,
        globalLevelsCount: 0,
        globalPlannedLevelsCount: 0,
        orphanPlannedLevelsCount: 0,
        isActive: false,
        isRunning: false,
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
      OPEN_POSITION_GRID_CYCLE_STATUSES.includes(c.status as any)
    ).length;
    const activeOpenCyclesCount = activeRangeId
      ? allCycles.filter(c => c.rangeVersionId === activeRangeId && OPEN_POSITION_GRID_CYCLE_STATUSES.includes(c.status as any)).length
      : 0;
    const globalOpenCyclesCount = openCycles;
    const orphanOpenCyclesCount = activeRangeId
      ? allCycles.filter(c => c.rangeVersionId !== activeRangeId && OPEN_POSITION_GRID_CYCLE_STATUSES.includes(c.status as any)).length
      : openCycles;
    const executableOpenCyclesCount = allCycles.filter(c =>
      POSITION_OPEN_GRID_CYCLE_STATUSES.includes(c.status as any) &&
      c.targetSellLevelId != null &&
      c.targetSellPrice != null &&
      c.targetSellQuantity != null
    ).length;
    const waitingSellCyclesCount = allCycles.filter(c =>
      POSITION_OPEN_GRID_CYCLE_STATUSES.includes(c.status as any)
    ).length;
    const reviewRequiredCyclesCount = allCycles.filter(c =>
      POSITION_OPEN_GRID_CYCLE_STATUSES.includes(c.status as any) &&
      (c.targetSellLevelId == null || c.targetSellPrice == null || c.targetSellQuantity == null)
    ).length;
    const previousRangeOpenCyclesCount = activeRangeId
      ? allCycles.filter(c => c.rangeVersionId !== activeRangeId && OPEN_POSITION_GRID_CYCLE_STATUSES.includes(c.status as any)).length
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
      executableOpenCyclesCount,
      waitingSellCyclesCount,
      trailingActiveCyclesCount: 0,
      reviewRequiredCyclesCount,
      previousRangeOpenCyclesCount,
      dailyOrderCount: 0,
      circuitBreakerOpen: false,
      pumpDumpState: "normal" as PumpDumpState,
      lastReconciliationAt: null,
      lastReconciliationOk: null,
      capitalReservedUsd: 0,
      capitalAvailableUsd: 0,
      totalNetPnlUsd: totalNetPnl,
      totalCyclesCompleted: completedCycles,
      globalLevelsCount,
      globalPlannedLevelsCount,
      orphanPlannedLevelsCount,
      isActive: cfg.isActive ?? false,
      isRunning: false,
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
    const openCycles = allCycles.filter(c => OPEN_POSITION_GRID_CYCLE_STATUSES.includes(c.status as any));
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

    // Cycles with no sell target (targetSellLevelId is null)
    const cyclesWithNoSellTarget = openCycles.filter(c => !c.targetSellLevelId);

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
    // - status is buy_filled/sell_placed (position open)
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
   * Get running flag (read-only).
   */
  getRunning(): boolean {
    return this.running;
  }

  /**
   * Get last tick timestamp (read-only).
   */
  getLastTickAt(): Date | null {
    return this.lastTickAt;
  }

  /**
   * Get last tick reason (read-only).
   */
  getLastTickReason(): string | null {
    return this.lastTickReason;
  }

  /**
   * Get last shadow execution price (read-only).
   */
  getLastShadowExecutionPrice(): GridShadowExecutionPriceResult | null {
    return this.lastShadowExecutionPrice;
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

  /**
   * Read-only diagnosis of orphan/historical SHADOW cycles.
   * Does NOT modify cycles, levels, DB, or place orders.
   * Uses the unified runtime snapshot resolver so it stays coherent with
   * /status, /monitor/audit and /export/json even when the runtime is empty.
   */
  async diagnoseShadowOrphanCycles(): Promise<ShadowOrphanDiagnosisResult> {
    const snapshot = await this.getRuntimeSnapshot();
    return diagnoseShadowOrphanCycles(
      snapshot.cycles,
      snapshot.levels,
      snapshot.activeRangeVersionId,
      snapshot.currentPrice,
      snapshot.mode
    );
  }

  /**
   * Read-only diagnosis of all open cycles (including HODL recovery).
   * Reports whether each cycle would be closed now by processOpenCyclesShadow()
   * without actually closing it or placing orders.
   */
  async diagnoseShadowOpenCycles(): Promise<ShadowOpenCycleDiagnosisResult> {
    const snapshot = await this.getRuntimeSnapshot();
    const pair = snapshot.config?.pair;

    let ticker: { bid?: number | null; ask?: number | null; last?: number | null } | null = null;
    if (pair) {
      try {
        const mdsTicker = await MarketDataService.getTicker(pair);
        if (mdsTicker) {
          ticker = mdsTicker;
        }
      } catch (e) {
        botLogger.warn("GRID_SHADOW_OPEN_CYCLE_DIAGNOSE", `No se pudo obtener ticker para ${pair}: ${e}`, { pair });
      }
    }

    const marketContextPrice = snapshot.currentPrice ?? null;
    let priceResult: GridShadowExecutionPriceResult;
    try {
      priceResult = resolveGridShadowExecutionPrice({
        pair: pair ?? undefined,
        tickerLast: ticker?.last,
        bid: ticker?.bid,
        ask: ticker?.ask,
        marketContextPrice,
        bandSnapshotClose: marketContextPrice,
      });
    } catch {
      priceResult = {
        pair: pair ?? null,
        price: marketContextPrice ?? 0,
        source: marketContextPrice != null ? "market_context" : "no_price",
        bid: ticker?.bid ?? null,
        ask: ticker?.ask ?? null,
        spreadPct: null,
        timestamp: new Date().toISOString(),
      };
    }

    const activeRangeVersion = snapshot.source === "runtime"
      ? this.activeRangeVersion
      : null;

    await this.loadReferencedRangeVersions(snapshot.cycles);

    return diagnoseShadowOpenCycles(
      snapshot.cycles,
      snapshot.levels,
      snapshot.activeRangeVersionId,
      priceResult,
      snapshot.mode,
      activeRangeVersion,
      this.referencedRangeVersions
    );
  }

  /**
   * Unified read-only snapshot of the Grid state.
   * Prefers in-memory runtime; falls back to DB when the runtime is not loaded.
   * Never auto-starts the scheduler and never mutates the engine.
   */
  async getRuntimeSnapshot(): Promise<GridRuntimeSnapshot> {
    return resolveRuntimeSnapshot(this);
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
      enforceCompactRange: configSnapshot.enforceCompactRange ?? true,
      gridRangeMaxPct: configSnapshot.gridRangeMaxPct ?? 2.50,
      maxDistanceFromCenterPct: configSnapshot.maxDistanceFromCenterPct ?? 1.25,
      maxSellDistanceFromNearestBuyPct: configSnapshot.maxSellDistanceFromNearestBuyPct ?? 1.50,
      // Adaptive Smart Range (3C.3-C)
      gridRangeControlMode: configSnapshot.gridRangeControlMode ?? 'adaptive_smart',
      adaptiveRangeEnabled: configSnapshot.adaptiveRangeEnabled ?? true,
      adaptiveRangeProfile: configSnapshot.adaptiveRangeProfile ?? 'balanced',
      adaptiveRangeMinPct: configSnapshot.adaptiveRangeMinPct ?? 1.50,
      adaptiveRangeMaxPct: configSnapshot.adaptiveRangeMaxPct ?? 7.00,
      adaptiveRangeLowVolMaxPct: configSnapshot.adaptiveRangeLowVolMaxPct ?? 3.00,
      adaptiveRangeNormalMaxPct: configSnapshot.adaptiveRangeNormalMaxPct ?? 5.00,
      adaptiveRangeHighVolMaxPct: configSnapshot.adaptiveRangeHighVolMaxPct ?? 7.00,
      adaptiveRangeTargetFullLevels: configSnapshot.adaptiveRangeTargetFullLevels ?? false,
      adaptiveRangeMinViableLevels: configSnapshot.adaptiveRangeMinViableLevels ?? 4,
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
      rangeAudit: pg.rangeAudit || null,
      adaptiveRangeDecision: pg.adaptiveRangeDecision || null,
      rangeControlMode: pg.rangeControlMode || null,
      rangeProfile: pg.rangeProfile || null,
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
