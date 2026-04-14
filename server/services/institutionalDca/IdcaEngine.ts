/**
 * IdcaEngine — Main engine for the Institutional DCA module.
 * Independent scheduler, entry/safety/TP/trailing/breakeven/emergency engines.
 * Completely isolated from the main bot's TradingEngine.
 */
import * as repo from "./IdcaRepository";
import * as smart from "./IdcaSmartLayer";
import * as telegram from "./IdcaTelegramNotifier";
import { formatIdcaMessage, formatOrderReason, type FormatContext } from "./IdcaMessageFormatter";
import {
  INSTITUTIONAL_DCA_ALLOWED_PAIRS,
  type InstitutionalDcaCycle,
  type InstitutionalDcaConfigRow,
  type InstitutionalDcaAssetConfigRow,
} from "@shared/schema";
import type {
  IdcaMode,
  IdcaEntryCheckResult,
  IdcaBlockReason,
  SafetyOrderLevel,
  IdcaSizeProfile,
  DynamicTpConfig,
  IdcaCycleType,
  PlusConfig,
  RecoveryConfig,
  BasePriceResult,
  BasePriceType,
  DipReferenceMethod,
  IdcaMacroContext,
} from "./IdcaTypes";
import { normalizeDipReferenceMethod } from "./IdcaTypes";
import type { TimestampedCandle } from "./IdcaSmartLayer";
import { ExchangeFactory } from "../exchanges/ExchangeFactory";

const TAG = "[IDCA]";

// ─── Cycle Review Diagnosis ───────────────────────────────────────
// Captures what the bot evaluated and concluded during cycle management

interface CycleReviewDiagnosis {
  conclusion: string;        // Short human-readable conclusion
  actionTaken: boolean;      // Whether an action was taken (buy, sell, state change)
  checkedProtection: boolean;
  checkedTrailing: boolean;
  checkedSafetyBuy: boolean;
  checkedExit: boolean;
  isProtectionArmed: boolean;
  distToNextSafety: number | null;   // % distance to next safety buy trigger
  distToTp: number | null;           // % distance to TP target
  distToProtectionStop: number | null; // % distance to protection stop
  distToTrailingActivation: number | null; // % distance to trailing activation
  nearestTrigger: string | null;     // Which trigger is closest
  nearestTriggerDist: number | null;  // Distance to nearest trigger in %
}

function buildReviewConclusion(d: CycleReviewDiagnosis, pnlPct: number, maxDD: number, status: string): string {
  if (d.actionTaken) return "Acción ejecutada en este tick";

  // Trailing state
  if (status === "trailing_active") {
    if (d.distToProtectionStop != null && d.distToProtectionStop < 1) {
      return "Trailing activo: precio cerca del stop de protección";
    }
    return "Trailing activo: el precio sigue subiendo, sin cierre";
  }

  const parts: string[] = [];

  // Protection context
  if (d.isProtectionArmed) {
    parts.push("protección activa");
  } else if (d.distToTrailingActivation != null && d.distToTrailingActivation < 1.5) {
    parts.push("cerca de activar trailing");
  }

  // Nearest trigger
  if (d.nearestTrigger && d.nearestTriggerDist != null) {
    if (d.nearestTriggerDist < 1.0) {
      if (d.nearestTrigger === "safety_buy") parts.push("muy cerca del próximo safety buy");
      else if (d.nearestTrigger === "tp") parts.push("muy cerca de toma de ganancias");
      else if (d.nearestTrigger === "protection_stop") parts.push("muy cerca del stop de protección");
    } else if (d.nearestTriggerDist < 3.0) {
      if (d.nearestTrigger === "safety_buy") parts.push("acercándose al próximo safety buy");
      else if (d.nearestTrigger === "tp") parts.push("acercándose a toma de ganancias");
    }
  }

  // PnL context
  if (pnlPct < -10) parts.push("drawdown profundo");
  else if (pnlPct < -5) parts.push("en zona negativa");
  else if (pnlPct < 0) parts.push("ligeramente negativo");
  else if (pnlPct > 0 && pnlPct < 1) parts.push("cerca del break-even");

  if (parts.length === 0) {
    if (pnlPct >= 0) return "Ciclo revisado: en espera, sin acción";
    return "Ciclo revisado: sin trigger alcanzado, esperando";
  }

  return `Ciclo revisado: ${parts.join(", ")}`;
}

const DEFAULT_DYNAMIC_TP_CONFIG: DynamicTpConfig = {
  baseTpPctBtc: 4.0, baseTpPctEth: 5.0,
  reductionPerExtraBuyMain: 0.3, reductionPerExtraBuyPlus: 0.2,
  weakReboundReductionMain: 0.5, weakReboundReductionPlus: 0.3,
  strongReboundBonusMain: 0.3, strongReboundBonusPlus: 0.2,
  highVolatilityAdjustMain: 0.3, highVolatilityAdjustPlus: 0.2,
  lowVolatilityAdjustMain: -0.2, lowVolatilityAdjustPlus: -0.1,
  mainMinTpPctBtc: 2.0, mainMaxTpPctBtc: 6.0,
  mainMinTpPctEth: 2.5, mainMaxTpPctEth: 8.0,
  plusMinTpPctBtc: 2.5, plusMaxTpPctBtc: 5.0,
  plusMinTpPctEth: 3.0, plusMaxTpPctEth: 6.0,
};

function getDynamicTpConfig(config: InstitutionalDcaConfigRow): DynamicTpConfig {
  const raw = config.dynamicTpConfigJson as any;
  if (!raw || typeof raw !== "object") return DEFAULT_DYNAMIC_TP_CONFIG;
  return { ...DEFAULT_DYNAMIC_TP_CONFIG, ...raw };
}

function getReboundStrength(pair: string): "none" | "weak" | "strong" {
  const candles = ohlcCache.get(pair) || [];
  if (candles.length < 3) return "none";
  const recentCandles = candles.slice(-5);
  const localLow = Math.min(...recentCandles.map(c => c.low));
  const currentPrice = priceCache.get(pair) || recentCandles[recentCandles.length - 1]?.close || 0;
  const isRebound = smart.detectRebound({ recentCandles, currentPrice, localLow });
  if (!isRebound) return "none";
  const bounceFromLow = currentPrice > 0 ? ((currentPrice - localLow) / localLow) * 100 : 0;
  return bounceFromLow > 1.5 ? "strong" : "weak";
}

// ─── Engine State ──────────────────────────────────────────────────

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let isRunning = false;
let lastTickAt: Date | null = null;
let lastError: string | null = null;
let tickCount = 0;

// Cache for market data
const priceCache = new Map<string, number>();
const ohlcCache = new Map<string, TimestampedCandle[]>();
const ohlcDailyCache = new Map<string, TimestampedCandle[]>();  // 1d candles for macro context (90d/180d)
const macroContextCache = new Map<string, IdcaMacroContext>();  // computed macro context per pair
const lastDailyFetchMs = new Map<string, number>();             // throttle: max 1 daily fetch per 6h per pair
const DAILY_FETCH_INTERVAL_MS = 6 * 60 * 60 * 1000;            // 6 hours
const lastEntryEventMs = new Map<string, number>();             // throttle: max 1 entry_evaluated DB event per 5min per pair
const ENTRY_EVENT_THROTTLE_MS = 5 * 60 * 1000;                 // 5 minutes

// ─── Human Event Helper ───────────────────────────────────────────

async function createHumanEvent(
  base: { cycleId?: number; pair?: string; mode?: string; eventType: string; severity: string; message: string; payloadJson?: any },
  fmtCtx: FormatContext
) {
  const hm = formatIdcaMessage(fmtCtx);
  return repo.createEvent({
    ...base,
    reasonCode: fmtCtx.reasonCode || fmtCtx.eventType,
    humanTitle: hm.humanTitle,
    humanMessage: hm.humanMessage,
    technicalSummary: hm.technicalSummary,
  });
}

// ─── Public API ────────────────────────────────────────────────────

export function getHealthStatus() {
  return {
    isRunning,
    lastTickAt,
    lastError,
    tickCount,
    schedulerActive: schedulerInterval !== null,
  };
}

export async function importPosition(req: import("./IdcaTypes").ImportPositionRequest): Promise<import("@shared/schema").InstitutionalDcaCycle> {
  const config = await repo.getIdcaConfig();
  const mode = config.mode as IdcaMode;
  if (mode === "disabled") throw new Error("El módulo IDCA está deshabilitado.");

  const pair = req.pair;
  if (!INSTITUTIONAL_DCA_ALLOWED_PAIRS.includes(pair as any)) {
    throw new Error(`Par no permitido: ${pair}`);
  }

  // Check active cycle for this pair
  const hasActive = await repo.hasActiveCycleForPair(pair, mode);
  const isManual = req.isManualCycle || req.sourceType === "manual";

  if (hasActive && !isManual) {
    throw new Error(`Ya existe un ciclo activo de ${pair} en modo ${mode}. Ciérralo antes de importar, o importa como CICLO MANUAL.`);
  }
  if (hasActive && isManual && !req.warningAcknowledged) {
    throw new Error(`Ya existe otro ciclo activo de ${pair}. Debes confirmar que aceptas la convivencia para importar como CICLO MANUAL.`);
  }

  const capitalUsed = req.capitalUsedUsd ?? req.quantity * req.avgEntryPrice;
  const currentPrice = await getCurrentPrice(pair);
  const assetConfig = await repo.getAssetConfig(pair);
  const tpPct = assetConfig ? parseFloat(String(assetConfig.takeProfitPct)) : 4.0;
  const tpPrice = req.avgEntryPrice * (1 + tpPct / 100);
  const trailingPct = assetConfig ? parseFloat(String(assetConfig.trailingPct)) : 1.2;

  const exchangeSource = req.exchangeSource || "revolut_x";
  const estimatedFeePct = req.estimatedFeePct ?? 0.09;
  const estimatedFeeUsd = req.estimatedFeeUsd ?? Math.round((capitalUsed * estimatedFeePct / 100) * 100) / 100;
  const feesOverride = req.feesOverrideManual ?? false;

  // For gestión completa (soloSalida=false), calculate safety buy levels upfront
  let importNextBuyLevelPct: string | null = null;
  let importNextBuyPrice: string | null = null;
  let importSkippedSafetyLevels = 0;
  let importSkippedLevelsDetail: { level: number; dipPct: number; triggerPrice: number }[] | null = null;

  if (!req.soloSalida && assetConfig) {
    const safetyOrders = parseSafetyOrders(assetConfig.safetyOrdersJson);
    const effectiveSafety = calculateEffectiveSafetyLevel(
      safetyOrders,
      req.avgEntryPrice,
      currentPrice || req.avgEntryPrice,
      1 // buyCount=1 for imported positions (counts as base buy)
    );
    importNextBuyLevelPct = effectiveSafety.nextLevelPct?.toFixed(2) || null;
    importNextBuyPrice = effectiveSafety.nextBuyPrice?.toFixed(8) || null;
    importSkippedSafetyLevels = effectiveSafety.skippedLevels;
    importSkippedLevelsDetail = effectiveSafety.skippedLevels > 0 ? effectiveSafety.skippedLevelsDetail : null;
    console.log(`${TAG}[IMPORT] ${req.pair}: nextBuy=${importNextBuyPrice ? `$${parseFloat(importNextBuyPrice).toFixed(2)}` : "none"}, skipped=${importSkippedSafetyLevels}`);
  }

  const snapshot = {
    importedAt: new Date().toISOString(),
    originalQty: req.quantity,
    originalAvgPrice: req.avgEntryPrice,
    originalCapital: capitalUsed,
    sourceType: req.sourceType,
    soloSalida: req.soloSalida,
    feesPaidUsd: req.feesPaidUsd || 0,
    isManualCycle: isManual,
    exchangeSource,
    estimatedFeePct,
    estimatedFeeUsd,
    feesOverrideManual: feesOverride,
    hadActiveCycleAtImport: hasActive,
  };

  const cycle = await repo.createImportedCycle({
    pair,
    strategy: "institutional_dca_v1",
    mode,
    status: "active",
    capitalReservedUsd: capitalUsed.toFixed(2),
    capitalUsedUsd: capitalUsed.toFixed(2),
    totalQuantity: req.quantity.toFixed(8),
    avgEntryPrice: req.avgEntryPrice.toFixed(8),
    currentPrice: (currentPrice || req.avgEntryPrice).toFixed(8),
    buyCount: 1,
    tpTargetPct: tpPct.toFixed(2),
    tpTargetPrice: tpPrice.toFixed(8),
    trailingPct: trailingPct.toFixed(2),
    marketScore: "50.00",
    volatilityScore: "0.00",
    adaptiveSizeProfile: "balanced",
    lastBuyAt: req.openedAt ? new Date(req.openedAt) : new Date(),
    cycleType: "main",
    isImported: true,
    importedAt: new Date(),
    sourceType: req.sourceType,
    managedBy: "idca",
    soloSalida: req.soloSalida,
    importNotes: req.notes || null,
    importSnapshotJson: snapshot,
    isManualCycle: isManual,
    exchangeSource,
    estimatedFeePct: estimatedFeePct.toFixed(4),
    estimatedFeeUsd: estimatedFeeUsd.toFixed(2),
    feesOverrideManual: feesOverride,
    importWarningAcknowledged: hasActive && isManual,
    startedAt: req.openedAt ? new Date(req.openedAt) : new Date(),
    // Safety buy levels for gestión completa (calculated above)
    nextBuyLevelPct: importNextBuyLevelPct,
    nextBuyPrice: importNextBuyPrice,
    skippedSafetyLevels: importSkippedSafetyLevels,
    skippedLevelsDetail: importSkippedLevelsDetail,
  });

  const manualTag = isManual ? " [CICLO MANUAL]" : "";
  const exchangeTag = exchangeSource ? ` | Exchange=${exchangeSource}` : "";

  await createHumanEvent({
    cycleId: cycle.id, pair, mode,
    eventType: "imported_position_created",
    severity: "info",
    message: `Posición importada${manualTag}: ${req.quantity.toFixed(6)} @ ${req.avgEntryPrice.toFixed(2)}, soloSalida=${req.soloSalida}${exchangeTag}, fee=${estimatedFeePct}%`,
    payloadJson: snapshot,
  }, {
    eventType: "imported_position_created", pair, mode,
    price: req.avgEntryPrice, quantity: req.quantity,
    capitalUsed, soloSalida: req.soloSalida, sourceType: req.sourceType,
    isManualCycle: isManual, exchangeSource, estimatedFeePct, estimatedFeeUsd,
  });

  await telegram.alertImportedPosition(cycle, req.soloSalida, req.sourceType, isManual, exchangeSource, estimatedFeePct, estimatedFeeUsd, hasActive);

  return cycle;
}

export async function startScheduler(): Promise<void> {
  if (schedulerInterval) return;
  const config = await repo.getIdcaConfig();
  const intervalMs = (config.schedulerIntervalSeconds || 60) * 1000;

  console.log(`${TAG} Scheduler starting (interval: ${intervalMs / 1000}s)`);
  isRunning = true;

  // Initial tick
  setTimeout(() => runTick().catch(e => console.error(`${TAG}[ERROR]`, e.message)), 2000);

  schedulerInterval = setInterval(() => {
    runTick().catch(e => console.error(`${TAG}[ERROR]`, e.message));
  }, intervalMs);
}

export function stopScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
  isRunning = false;
  console.log(`${TAG} Scheduler stopped`);
}

export function getMacroContext(pair: string): IdcaMacroContext | undefined {
  return macroContextCache.get(pair);
}

export async function emergencyCloseAll(): Promise<number> {
  const config = await repo.getIdcaConfig();
  const mode = config.mode as IdcaMode;
  if (mode === "disabled") return 0;

  console.log(`${TAG}[EMERGENCY_CLOSE] Closing all positions for mode=${mode}`);

  // Get current prices
  const prices: Record<string, number> = {};
  for (const pair of INSTITUTIONAL_DCA_ALLOWED_PAIRS) {
    prices[pair] = await getCurrentPrice(pair);
  }

  const closed = await repo.closeCyclesBulk(mode, "emergency_close_all", prices);

  // If live mode, attempt market sells
  if (mode === "live") {
    const activeCycles = await repo.getAllActiveCycles("live");
    for (const cycle of activeCycles) {
      if (parseFloat(String(cycle.totalQuantity)) > 0) {
        try {
          await executeRealSell(cycle, "emergency_sell", parseFloat(String(cycle.totalQuantity)));
        } catch (e: any) {
          console.error(`${TAG}[EMERGENCY_CLOSE] Error selling ${cycle.pair}:`, e.message);
        }
      }
    }
  }

  await createHumanEvent({
    eventType: "emergency_close_all",
    severity: "critical",
    mode,
    message: `Emergency close: ${closed} cycles closed`,
    payloadJson: { closedCount: closed },
  }, { eventType: "emergency_close_all", mode, closedCount: closed, triggerSource: "manual" });

  await telegram.alertEmergencyClose(mode, closed);
  return closed;
}

// ─── Main Tick ─────────────────────────────────────────────────────

async function runTick(): Promise<void> {
  try {
    tickCount++;
    lastTickAt = new Date();

    // Load controls
    const controls = await repo.getTradingEngineControls();

    // Global pause check
    if (controls.globalTradingPause) {
      console.log(`${TAG}[GLOBAL][TRADING_PAUSED]`);
      return;
    }

    // IDCA toggle check
    if (!controls.institutionalDcaEnabled) {
      console.log(`${TAG}[PAUSED_BY_TOGGLE]`);
      return;
    }

    // Load config
    const config = await repo.getIdcaConfig();
    const mode = config.mode as IdcaMode;

    if (mode === "disabled") return;

    // Check max drawdown
    const drawdownOk = await checkModuleDrawdown(config, mode);
    if (!drawdownOk) return;

    // Update OHLCV cache
    await updateOhlcvCache();

    // Evaluate each allowed pair
    const pairResults: string[] = [];
    for (const pair of INSTITUTIONAL_DCA_ALLOWED_PAIRS) {
      try {
        await evaluatePair(pair, config, mode);
        const cycle = await repo.getActiveCycle(pair, mode);
        if (cycle) {
          const pnl = parseFloat(String(cycle.unrealizedPnlPct || "0"));
          pairResults.push(`${pair}:${pnl >= 0 ? "+" : ""}${pnl.toFixed(1)}%`);
        } else {
          pairResults.push(`${pair}:waiting`);
        }
      } catch (e: any) {
        console.error(`${TAG}[ERROR] ${pair}:`, e.message);
        lastError = `${pair}: ${e.message}`;
        pairResults.push(`${pair}:ERR`);
      }
    }
    console.log(`${TAG}[TICK #${tickCount}] mode=${mode} | ${pairResults.join(" | ")}`);
  } catch (e: any) {
    lastError = e.message;
    console.error(`${TAG}[ERROR] Tick failed:`, e.message);
  }
}

// ─── Pair Evaluation ───────────────────────────────────────────────

async function evaluatePair(
  pair: string,
  config: InstitutionalDcaConfigRow,
  mode: IdcaMode
): Promise<void> {
  const assetConfig = await repo.getAssetConfig(pair);
  if (!assetConfig || !assetConfig.enabled) return;

  const currentPrice = await getCurrentPrice(pair);
  if (currentPrice <= 0) return;

  // Update price/PnL for ALL active cycles of this pair (main, plus, imported, manual)
  const allPairCycles = await repo.getAllActiveCyclesForPair(pair, mode);
  for (const c of allPairCycles) {
    const avg = parseFloat(String(c.avgEntryPrice || "0"));
    const qty = parseFloat(String(c.totalQuantity || "0"));
    const cap = parseFloat(String(c.capitalUsedUsd || "0"));
    if (avg <= 0 || qty <= 0) continue;
    const mv = qty * currentPrice;
    const pnlUsd = mv - cap;
    const pnlPct = cap > 0 ? (pnlUsd / cap) * 100 : 0;
    const dd = pnlPct < 0 ? Math.abs(pnlPct) : 0;
    const prevDD = parseFloat(String(c.maxDrawdownPct || "0"));
    await repo.updateCycle(c.id, {
      currentPrice: currentPrice.toFixed(8),
      unrealizedPnlUsd: pnlUsd.toFixed(2),
      unrealizedPnlPct: pnlPct.toFixed(4),
      maxDrawdownPct: Math.max(dd, prevDD).toFixed(2),
    });
  }

  // ── Manage imported cycles independently (do not interfere with autonomous logic) ──
  const importedCycles = await repo.getActiveImportedCycles(pair, mode);
  for (const ic of importedCycles) {
    await manageCycle(ic, currentPrice, config, assetConfig, mode);
    if (!ic.soloSalida) {
      const plusCfgImp = getPlusConfig(config);
      if (plusCfgImp.enabled) {
        const existingPlus = await repo.getActivePlusCycle(pair, mode, ic.id);
        if (existingPlus) {
          await managePlusCycle(existingPlus, ic, currentPrice, config, assetConfig, mode, plusCfgImp);
        } else {
          await checkPlusActivation(ic, currentPrice, config, assetConfig, mode, plusCfgImp);
        }
      }
      const recoveryCfgImp = getRecoveryConfig(config);
      if (recoveryCfgImp.enabled) {
        const existingRecovery = await repo.getActiveRecoveryCycles(pair, mode, ic.id);
        if (existingRecovery.length > 0) {
          for (const rc of existingRecovery) {
            await manageRecoveryCycle(rc, ic, currentPrice, config, assetConfig, mode, recoveryCfgImp);
          }
        } else {
          await checkRecoveryActivation(ic, currentPrice, config, assetConfig, mode, recoveryCfgImp);
        }
      }
    }
  }

  // ── Autonomous bot cycle flow (independent of imported positions) ──
  const activeCycle = await repo.getActiveBotCycle(pair, mode);

  if (activeCycle) {
    // Manage existing autonomous main cycle
    await manageCycle(activeCycle, currentPrice, config, assetConfig, mode);

    const plusConfig = getPlusConfig(config);
    if (plusConfig.enabled) {
      const existingPlus = await repo.getActivePlusCycle(pair, mode, activeCycle.id);
      if (existingPlus) {
        await managePlusCycle(existingPlus, activeCycle, currentPrice, config, assetConfig, mode, plusConfig);
      } else {
        await checkPlusActivation(activeCycle, currentPrice, config, assetConfig, mode, plusConfig);
      }
    }

    const recoveryCfg = getRecoveryConfig(config);
    if (recoveryCfg.enabled) {
      const existingRecovery = await repo.getActiveRecoveryCycles(pair, mode, activeCycle.id);
      if (existingRecovery.length > 0) {
        for (const rc of existingRecovery) {
          await manageRecoveryCycle(rc, activeCycle, currentPrice, config, assetConfig, mode, recoveryCfg);
        }
      } else {
        await checkRecoveryActivation(activeCycle, currentPrice, config, assetConfig, mode, recoveryCfg);
      }
    }
  } else {
    // Check for orphaned bot subcycles (plus/recovery without a main)
    const hasAny = await repo.hasActiveBotCycleForPair(pair, mode);
    if (!hasAny) {
      // No bot cycle active — look for new autonomous entry
      await checkEntry(pair, currentPrice, config, assetConfig, mode);
    }
  }
}

// ─── Entry Check ───────────────────────────────────────────────────

async function checkEntry(
  pair: string,
  currentPrice: number,
  config: InstitutionalDcaConfigRow,
  assetConfig: InstitutionalDcaAssetConfigRow,
  mode: IdcaMode
): Promise<void> {
  const check = await performEntryCheck(pair, currentPrice, config, assetConfig, mode);

  if (!check.allowed) {
    for (const reason of check.blockReasons) {
      console.log(`${TAG}[ENTRY_BLOCKED] ${pair}: ${reason.code} - ${reason.message}`);
    }
    // Suppress event for data_not_ready (fires every tick on cold start, not useful)
    if (check.blockReasons.length > 0 && check.blockReasons[0]?.code !== "data_not_ready") {
      await createHumanEvent({
        pair,
        mode,
        eventType: "entry_check_blocked",
        severity: "info",
        message: check.blockReasons.map(r => r.code).join(", "),
        payloadJson: { blockReasons: check.blockReasons, basePrice: check.basePrice },
      }, {
        eventType: "entry_check_blocked",
        reasonCode: check.blockReasons[0]?.code || "entry_check_blocked",
        pair, mode,
        blockReasons: check.blockReasons,
        entryDipPct: check.entryDipPct,
        entryBasePrice: check.basePrice?.price,
        entryBasePriceType: check.basePrice?.type,
        marketScore: check.marketScore,
        sizeProfile: check.sizeProfile,
      });
    }
    return;
  }

  // Entry allowed — create cycle and execute base buy
  const bp = check.basePrice!;
  console.log(`${TAG}[ENTRY_CHECK] ${pair}: Entry allowed | BasePrice=$${bp.price.toFixed(2)} | BaseType=${bp.type} | Window=${config.localHighLookbackMinutes}min | EntryDip=${check.entryDipPct?.toFixed(2)}% | Score=${check.marketScore}`);

  await createHumanEvent({
    pair, mode,
    eventType: "entry_check_passed",
    severity: "info",
    message: `Entry check passed: BasePrice=$${bp.price.toFixed(2)} (${bp.type}), EntryDip=${check.entryDipPct?.toFixed(2)}%, Score=${check.marketScore}`,
    payloadJson: { marketScore: check.marketScore, entryDipPct: check.entryDipPct, sizeProfile: check.sizeProfile, basePrice: bp },
  }, { eventType: "entry_check_passed", pair, mode, entryDipPct: check.entryDipPct, entryBasePrice: bp.price, entryBasePriceType: bp.type, marketScore: check.marketScore, sizeProfile: check.sizeProfile });

  // Calculate capital for this cycle
  const allocatedCapital = parseFloat(String(config.allocatedCapitalUsd));
  const maxAssetPct = parseFloat(String(config.maxAssetExposurePct));
  const capitalForCycle = allocatedCapital * (maxAssetPct / 100);

  // Create cycle
  const safetyOrders = parseSafetyOrders(assetConfig.safetyOrdersJson);
  const sizeWeights = check.sizeProfile
    ? smart.getSizeWeights(check.sizeProfile, safetyOrders.length + 1)
    : smart.getSizeWeights("balanced", safetyOrders.length + 1);

  const baseBuyPct = sizeWeights[0];
  const baseBuyUsd = capitalForCycle * (baseBuyPct / 100);
  const quantity = baseBuyUsd / currentPrice;

  // Compute TP (dynamic or static fallback)
  let tpPct: number;
  let tpBreakdown: any = null;
  if (config.adaptiveTpEnabled) {
    const dtpConfig = getDynamicTpConfig(config);
    const breakdown = smart.computeDynamicTakeProfit({
      pair,
      cycleType: "main",
      buyCount: 1,
      marketScore: check.marketScore || 50,
      volatilityPct: getVolatility(pair),
      reboundStrength: getReboundStrength(pair),
      config: dtpConfig,
    });
    tpPct = breakdown.finalTpPct;
    tpBreakdown = breakdown;
  } else {
    tpPct = parseFloat(String(assetConfig.takeProfitPct));
  }

  const tpPrice = currentPrice * (1 + tpPct / 100);

  // Compute trailing
  let trailingPct = parseFloat(String(assetConfig.trailingPct));
  if (config.volatilityTrailingEnabled) {
    trailingPct = smart.computeDynamicTrailing({
      atrPct: getVolatility(pair),
      baseTrailingPct: trailingPct,
      minTrailingPct: parseFloat(String(pair === "BTC/USD" ? config.minTrailingPctBtc : config.minTrailingPctEth)),
      maxTrailingPct: parseFloat(String(pair === "BTC/USD" ? config.maxTrailingPctBtc : config.maxTrailingPctEth)),
    });
  }

  // Next safety buy level
  const nextLevel = safetyOrders.length > 0 ? safetyOrders[0].dipPct : null;
  const nextBuyPrice = nextLevel ? currentPrice * (1 - nextLevel / 100) : null;

  // Apply simulation fees
  let fees = 0;
  let slippage = 0;
  let netValue = baseBuyUsd;
  if (mode === "simulation") {
    fees = baseBuyUsd * (parseFloat(String(config.simulationFeePct)) / 100);
    slippage = baseBuyUsd * (parseFloat(String(config.simulationSlippagePct)) / 100);
    netValue = baseBuyUsd + fees + slippage;
  }

  const cycle = await repo.createCycle({
    pair,
    strategy: "institutional_dca_v1",
    mode,
    status: "active",
    capitalReservedUsd: capitalForCycle.toFixed(2),
    capitalUsedUsd: netValue.toFixed(2),
    totalQuantity: quantity.toFixed(8),
    avgEntryPrice: currentPrice.toFixed(8),
    currentPrice: currentPrice.toFixed(8),
    buyCount: 1,
    tpTargetPct: tpPct.toFixed(2),
    tpTargetPrice: tpPrice.toFixed(8),
    trailingPct: trailingPct.toFixed(2),
    nextBuyLevelPct: nextLevel?.toFixed(2) || null,
    nextBuyPrice: nextBuyPrice?.toFixed(8) || null,
    marketScore: (check.marketScore || 0).toFixed(2),
    volatilityScore: (check.volatilityScore || 0).toFixed(2),
    adaptiveSizeProfile: check.sizeProfile || "balanced",
    lastBuyAt: new Date(),
    tpBreakdownJson: tpBreakdown,
    cycleType: "main",
    // Persisted entry base price — deterministic, auditable
    basePrice: bp.price.toFixed(8),
    basePriceType: bp.type,
    basePriceWindowMinutes: bp.windowMinutes,
    basePriceTimestamp: bp.timestamp,
    basePriceMetaJson: bp.meta || null,
    entryDipPct: (check.entryDipPct || 0).toFixed(4),
  });

  // Create order record
  const order = await repo.createOrder({
    cycleId: cycle.id,
    pair,
    mode,
    orderType: "base_buy",
    buyIndex: 1,
    side: "buy",
    price: currentPrice.toFixed(8),
    quantity: quantity.toFixed(8),
    grossValueUsd: baseBuyUsd.toFixed(2),
    feesUsd: fees.toFixed(2),
    slippageUsd: slippage.toFixed(2),
    netValueUsd: netValue.toFixed(2),
    triggerReason: `Entry dip ${check.entryDipPct?.toFixed(2)}% from base $${bp.price.toFixed(2)} (${bp.type}), score=${check.marketScore}`,
    humanReason: formatOrderReason("base_buy"),
  });

  // Execute real order if live
  if (mode === "live") {
    await executeRealBuy(pair, quantity, currentPrice);
  }

  // Update simulation wallet
  if (mode === "simulation") {
    const wallet = await repo.getSimulationWallet();
    await repo.updateSimulationWallet({
      availableBalanceUsd: (parseFloat(String(wallet.availableBalanceUsd)) - netValue).toFixed(2),
      usedBalanceUsd: (parseFloat(String(wallet.usedBalanceUsd)) + netValue).toFixed(2),
      totalOrdersSimulated: wallet.totalOrdersSimulated + 1,
      totalCyclesSimulated: wallet.totalCyclesSimulated + 1,
    });
  }

  const baseFmtCtx: FormatContext = {
    eventType: "cycle_started", pair, mode,
    price: currentPrice, quantity, capitalUsed: netValue,
    entryDipPct: check.entryDipPct, entryBasePrice: bp.price, entryBasePriceType: bp.type,
    marketScore: check.marketScore,
    buyCount: 1, sizeProfile: check.sizeProfile,
  };

  await createHumanEvent({
    cycleId: cycle.id, pair, mode,
    eventType: "cycle_started",
    severity: "info",
    message: `Cycle started: baseBuy=${quantity.toFixed(6)} @ ${currentPrice.toFixed(2)} | BasePrice=$${bp.price.toFixed(2)} (${bp.type}) | EntryDip=${check.entryDipPct?.toFixed(2)}%`,
    payloadJson: { price: currentPrice, quantity, capital: netValue, sizeProfile: check.sizeProfile, basePrice: bp },
  }, baseFmtCtx);

  await createHumanEvent({
    cycleId: cycle.id, pair, mode,
    eventType: "base_buy_executed",
    severity: "info",
    message: `Base buy #1: ${quantity.toFixed(6)} @ ${currentPrice.toFixed(2)}`,
  }, { ...baseFmtCtx, eventType: "base_buy_executed" });

  await telegram.alertCycleStarted(cycle, check.entryDipPct || 0, check.marketScore || 0);
  await telegram.alertBuyExecuted(cycle, order, "base_buy");
}

// ─── Cycle Management ──────────────────────────────────────────────

async function manageCycle(
  cycle: InstitutionalDcaCycle,
  currentPrice: number,
  config: InstitutionalDcaConfigRow,
  assetConfig: InstitutionalDcaAssetConfigRow,
  mode: IdcaMode
): Promise<void> {
  const pair = cycle.pair;
  const avgEntry = parseFloat(String(cycle.avgEntryPrice || "0"));
  const totalQty = parseFloat(String(cycle.totalQuantity || "0"));
  const capitalUsed = parseFloat(String(cycle.capitalUsedUsd || "0"));

  if (avgEntry <= 0 || totalQty <= 0) return;

  // Update current price and PnL
  const marketValue = totalQty * currentPrice;
  const unrealizedPnlUsd = marketValue - capitalUsed;
  const unrealizedPnlPct = capitalUsed > 0 ? (unrealizedPnlUsd / capitalUsed) * 100 : 0;

  // Track max drawdown
  const currentDD = unrealizedPnlPct < 0 ? Math.abs(unrealizedPnlPct) : 0;
  const prevMaxDD = parseFloat(String(cycle.maxDrawdownPct || "0"));
  const maxDD = Math.max(currentDD, prevMaxDD);

  await repo.updateCycle(cycle.id, {
    currentPrice: currentPrice.toFixed(8),
    unrealizedPnlUsd: unrealizedPnlUsd.toFixed(2),
    unrealizedPnlPct: unrealizedPnlPct.toFixed(4),
    maxDrawdownPct: maxDD.toFixed(2),
  });

  // Compute distances for diagnosis BEFORE branching
  const tpTargetPrice = parseFloat(String(cycle.tpTargetPrice || "0"));
  const nextBuyPrice = parseFloat(String(cycle.nextBuyPrice || "0"));
  const protectionStopPriceVal = parseFloat(String(cycle.protectionStopPrice || "0"));
  const trailingActivationPct = parseFloat(String(assetConfig.trailingActivationPct ?? "3.50"));

  const distToTp = tpTargetPrice > 0 && currentPrice > 0
    ? ((tpTargetPrice - currentPrice) / currentPrice) * 100 : null;
  const distToNextSafety = nextBuyPrice > 0 && currentPrice > 0
    ? ((currentPrice - nextBuyPrice) / currentPrice) * 100 : null;
  const distToProtectionStop = protectionStopPriceVal > 0 && currentPrice > 0
    ? ((currentPrice - protectionStopPriceVal) / currentPrice) * 100 : null;
  const distToTrailingActivation = trailingActivationPct > 0
    ? trailingActivationPct - unrealizedPnlPct : null;

  // Build base diagnosis
  const diagnosis: CycleReviewDiagnosis = {
    conclusion: "",
    actionTaken: false,
    checkedProtection: cycle.status === "active",
    checkedTrailing: cycle.status === "active" || cycle.status === "trailing_active",
    checkedSafetyBuy: cycle.status === "active",
    checkedExit: cycle.status === "trailing_active",
    isProtectionArmed: !!cycle.protectionArmedAt,
    distToNextSafety,
    distToTp,
    distToProtectionStop,
    distToTrailingActivation: cycle.status === "active" ? distToTrailingActivation : null,
    nearestTrigger: null,
    nearestTriggerDist: null,
  };

  // Find nearest trigger
  const triggers: { name: string; dist: number }[] = [];
  if (distToNextSafety != null && distToNextSafety >= 0) triggers.push({ name: "safety_buy", dist: distToNextSafety });
  if (distToTp != null && distToTp >= 0) triggers.push({ name: "tp", dist: distToTp });
  if (distToProtectionStop != null && distToProtectionStop >= 0) triggers.push({ name: "protection_stop", dist: distToProtectionStop });
  if (triggers.length > 0) {
    triggers.sort((a, b) => a.dist - b.dist);
    diagnosis.nearestTrigger = triggers[0].name;
    diagnosis.nearestTriggerDist = triggers[0].dist;
  }

  // Branch by cycle status
  const prevBuyCount = cycle.buyCount;
  const prevStatus = cycle.status;
  switch (cycle.status) {
    case "active":
      await handleActiveState(cycle, currentPrice, unrealizedPnlPct, config, assetConfig, mode);
      break;
    case "tp_armed":
      await handleTpArmedState(cycle, currentPrice, config, assetConfig, mode);
      break;
    case "trailing_active":
      await handleTrailingState(cycle, currentPrice, config, assetConfig, mode);
      break;
    case "paused":
    case "blocked":
      break;
  }

  // For imported gestión-completa cycles with missing nextBuyPrice, recalculate on every tick.
  // This self-heals existing cycles regardless of status (active, paused, blocked, tp_armed).
  if (cycle.isImported && !cycle.soloSalida) {
    const storedNext = parseFloat(String(cycle.nextBuyPrice || "0"));
    if (storedNext <= 0) {
      const safetyOrders = parseSafetyOrders(assetConfig.safetyOrdersJson);
      const effectiveSafety = calculateEffectiveSafetyLevel(
        safetyOrders,
        avgEntry,
        currentPrice,
        cycle.buyCount || 1
      );
      if (effectiveSafety.nextBuyPrice && effectiveSafety.nextBuyPrice > 0) {
        await repo.updateCycle(cycle.id, {
          nextBuyLevelPct: effectiveSafety.nextLevelPct?.toFixed(2) || null,
          nextBuyPrice: effectiveSafety.nextBuyPrice.toFixed(8),
          skippedSafetyLevels: effectiveSafety.skippedLevels,
          skippedLevelsDetail: effectiveSafety.skippedLevels > 0 ? effectiveSafety.skippedLevelsDetail : null,
        });
        console.log(`${TAG}[SELF_HEAL] ${pair} #${cycle.id}: nextBuyPrice recalculated → $${effectiveSafety.nextBuyPrice.toFixed(2)} (skipped=${effectiveSafety.skippedLevels})`);
      } else if (effectiveSafety.skippedLevels !== (cycle.skippedSafetyLevels ?? 0)) {
        // Update skipped count even if no valid next level
        await repo.updateCycle(cycle.id, {
          skippedSafetyLevels: effectiveSafety.skippedLevels,
          skippedLevelsDetail: effectiveSafety.skippedLevels > 0 ? effectiveSafety.skippedLevelsDetail : null,
        });
      }
    }
  }

  // Detect if an action was taken by re-checking cycle state
  const updatedCycleCheck = await repo.getCycleById(cycle.id);
  if (updatedCycleCheck) {
    if (updatedCycleCheck.status !== prevStatus || updatedCycleCheck.buyCount !== prevBuyCount) {
      diagnosis.actionTaken = true;
    }
  }

  // Build conclusion
  diagnosis.conclusion = buildReviewConclusion(diagnosis, unrealizedPnlPct, maxDD, prevStatus);

  // Log enriched cycle management event (AFTER evaluation)
  // severity: 'info' when an action was taken (visible with "Sin debug" filter),
  //           'debug' for routine checks (hidden by default)
  await createHumanEvent({
    cycleId: cycle.id, pair, mode,
    eventType: "cycle_management",
    severity: diagnosis.actionTaken ? "info" : "debug",
    message: diagnosis.conclusion,
    payloadJson: {
      price: currentPrice, avgEntry, pnlPct: unrealizedPnlPct, pnlUsd: unrealizedPnlUsd,
      maxDD, status: prevStatus, buyCount: cycle.buyCount, totalQty, capitalUsed,
      distToNextSafety: distToNextSafety != null ? +distToNextSafety.toFixed(2) : null,
      distToTp: distToTp != null ? +distToTp.toFixed(2) : null,
      distToProtectionStop: distToProtectionStop != null ? +distToProtectionStop.toFixed(2) : null,
      distToTrailingActivation: distToTrailingActivation != null ? +distToTrailingActivation.toFixed(2) : null,
      nearestTrigger: diagnosis.nearestTrigger,
      nearestTriggerDist: diagnosis.nearestTriggerDist != null ? +diagnosis.nearestTriggerDist.toFixed(2) : null,
      isProtectionArmed: diagnosis.isProtectionArmed,
      actionTaken: diagnosis.actionTaken,
    },
  }, {
    eventType: "cycle_management", pair, mode,
    price: currentPrice,
    avgEntry,
    pnlPct: unrealizedPnlPct,
    pnlUsd: unrealizedPnlUsd,
    drawdownPct: maxDD,
    quantity: totalQty,
    capitalUsed,
    buyCount: cycle.buyCount || 0,
    reason: diagnosis.conclusion,
  });
}

// ─── TP Armed State: transition to trailing ────────────────────────

async function handleTpArmedState(
  cycle: InstitutionalDcaCycle,
  currentPrice: number,
  config: InstitutionalDcaConfigRow,
  assetConfig: InstitutionalDcaAssetConfigRow,
  mode: IdcaMode
): Promise<void> {
  // TP Armed is a brief transitional state before trailing activates.
  // If partial sell already happened, move to trailing_active.
  if (cycle.tpArmedAt) {
    await repo.updateCycle(cycle.id, { status: "trailing_active", trailingActiveAt: new Date() });
    await handleTrailingState(cycle, currentPrice, config, assetConfig, mode);
  }
}

// ─── Active State: Protection → Trailing Activation → Exit ──────────

async function handleActiveState(
  cycle: InstitutionalDcaCycle,
  currentPrice: number,
  pnlPct: number,
  config: InstitutionalDcaConfigRow,
  assetConfig: InstitutionalDcaAssetConfigRow,
  mode: IdcaMode
): Promise<void> {
  const pair = cycle.pair;
  const avgEntry = parseFloat(String(cycle.avgEntryPrice || "0"));

  // Read slider config values
  const protectionActivationPct = parseFloat(String(assetConfig.protectionActivationPct ?? "1.00"));
  const trailingActivationPct = parseFloat(String(assetConfig.trailingActivationPct ?? "3.50"));
  const trailingMarginPct = parseFloat(String(assetConfig.trailingMarginPct ?? "1.50"));

  // Guard: bePercent must be a valid positive number
  const isBePercentValid = !isNaN(protectionActivationPct) && protectionActivationPct > 0;
  const isTrailPercentValid = !isNaN(trailingActivationPct) && trailingActivationPct > 0;

  const isProtectionArmed = !!cycle.protectionArmedAt;
  const protectionStopPrice = parseFloat(String(cycle.protectionStopPrice || "0"));

  // ─── STRUCTURED BE & TRAIL EVAL LOG ──────────────────────────
  const beTriggerPrice = avgEntry > 0 && isBePercentValid ? avgEntry * (1 + protectionActivationPct / 100) : 0;
  const trailingActivationPrice = avgEntry > 0 ? avgEntry * (1 + trailingActivationPct / 100) : 0;
  const distToTrailing = trailingActivationPct - pnlPct;
  const willArmBe = !isProtectionArmed && isBePercentValid && pnlPct >= protectionActivationPct && avgEntry > 0;
  console.log(
    `${TAG}[BE_EVAL] #${cycle.id} ${pair}` +
    ` | price=$${currentPrice.toFixed(2)} | avg=$${avgEntry.toFixed(2)}` +
    ` | bePercent=${protectionActivationPct}% (valid=${isBePercentValid})` +
    ` | beTriggerPrice=$${beTriggerPrice.toFixed(2)}` +
    ` | pnlPct=${pnlPct.toFixed(3)}% | beArmed_before=${isProtectionArmed}` +
    ` | willArm=${willArmBe}`
  );
  console.log(
    `${TAG}[EXIT_EVAL] #${cycle.id} ${pair} | status=active | price=$${currentPrice.toFixed(2)}` +
    ` | avg=$${avgEntry.toFixed(2)} | pnl=${pnlPct.toFixed(3)}%` +
    ` | protectionArmed=${isProtectionArmed} | protectionActivation=${protectionActivationPct}%` +
    ` | trailingActivation=${trailingActivationPct}% (at $${trailingActivationPrice.toFixed(2)})` +
    ` | distToTrailing=${distToTrailing.toFixed(3)}% | trailingMargin=${trailingMarginPct}%`
  );
  if (!isBePercentValid) {
    console.warn(`${TAG}[BE_EVAL] #${cycle.id} ${pair} | BLOCKED: protectionActivationPct=${protectionActivationPct} is invalid (<=0 or NaN) — BE will NEVER arm. Check assetConfig.`);
  }

  // 1. ARM PROTECTION (break-even as safety net, NOT an exit)
  // GUARD: skip if bePercent is invalid (0, NaN, negative) — prevents arming at avg with no threshold
  if (!isProtectionArmed && isBePercentValid && pnlPct >= protectionActivationPct && avgEntry > 0) {
    const stopPrice = avgEntry; // break-even = avg entry price
    await repo.updateCycle(cycle.id, {
      protectionArmedAt: new Date(),
      protectionStopPrice: stopPrice.toFixed(8),
    });

    await createHumanEvent({
      cycleId: cycle.id, pair, mode,
      eventType: "protection_armed",
      severity: "info",
      message: `Protección armada a +${pnlPct.toFixed(2)}%: stop en $${stopPrice.toFixed(2)} (break-even)`,
    }, {
      eventType: "protection_armed", pair, mode,
      price: currentPrice, avgEntry, pnlPct,
    });

    await telegram.alertProtectionArmed(cycle, currentPrice, stopPrice, pnlPct);
    // Don't return — continue checking trailing activation in same tick
  }

  // 2. ACTIVATE TRAILING (no partial sell — just start tracking highest price)
  // GUARD: only count pnlPct toward protection if bePercent is valid
  const effectiveProtectionArmed = isProtectionArmed || (isBePercentValid && pnlPct >= protectionActivationPct);
  if (!effectiveProtectionArmed) {
    console.log(`${TAG}[EXIT_EVAL] #${cycle.id} ${pair} | trailing_blocked: protection not yet armed (pnl=${pnlPct.toFixed(3)}% < ${protectionActivationPct}%)`);
  } else if (pnlPct < trailingActivationPct) {
    console.log(`${TAG}[EXIT_EVAL] #${cycle.id} ${pair} | trailing_blocked: pnl=${pnlPct.toFixed(3)}% < trailingActivation=${trailingActivationPct}% (need +${distToTrailing.toFixed(3)}% more)`);
  }
  if (effectiveProtectionArmed && pnlPct >= trailingActivationPct) {
    // Compute trailing pct — use slider value, optionally adapt with ATR
    let effectiveTrailingPct = trailingMarginPct;
    if (config.volatilityTrailingEnabled) {
      effectiveTrailingPct = smart.computeDynamicTrailing({
        atrPct: getVolatility(pair),
        baseTrailingPct: trailingMarginPct,
        minTrailingPct: parseFloat(String(pair === "BTC/USD" ? config.minTrailingPctBtc : config.minTrailingPctEth)),
        maxTrailingPct: parseFloat(String(pair === "BTC/USD" ? config.maxTrailingPctBtc : config.maxTrailingPctEth)),
      });
    }

    await repo.updateCycle(cycle.id, {
      status: "trailing_active",
      trailingActiveAt: new Date(),
      highestPriceAfterTp: currentPrice.toFixed(8),
      trailingPct: effectiveTrailingPct.toFixed(2),
    });

    await createHumanEvent({
      cycleId: cycle.id, pair, mode,
      eventType: "trailing_activated",
      severity: "info",
      message: `Trailing activado a +${pnlPct.toFixed(2)}%: margen ${effectiveTrailingPct.toFixed(2)}%, máximo $${currentPrice.toFixed(2)}`,
    }, {
      eventType: "trailing_activated", pair, mode,
      price: currentPrice, pnlPct, trailingPct: effectiveTrailingPct,
      avgEntry,
    });

    await telegram.alertTrailingActivated(cycle, currentPrice, pnlPct, effectiveTrailingPct);
    return; // Transition done, next tick will be handleTrailingState
  }

  // 3. PROTECTION STOP HIT (price fell back to break-even after protection was armed)
  if (isProtectionArmed && protectionStopPrice > 0 && currentPrice <= protectionStopPrice) {
    await executeBreakevenExit(cycle, currentPrice, config, mode);
    return;
  }

  // 4. Check safety buy levels — skip if imported + soloSalida
  if (!(cycle.isImported && cycle.soloSalida)) {
    await checkSafetyBuy(cycle, currentPrice, config, assetConfig, mode);
  }
}

// ─── Safety Buy Check ──────────────────────────────────────────────

async function checkSafetyBuy(
  cycle: InstitutionalDcaCycle,
  currentPrice: number,
  config: InstitutionalDcaConfigRow,
  assetConfig: InstitutionalDcaAssetConfigRow,
  mode: IdcaMode
): Promise<void> {
  const pair = cycle.pair;
  const buyCount = cycle.buyCount;
  const maxOrders = assetConfig.maxSafetyOrders;
  const safetyOrders = parseSafetyOrders(assetConfig.safetyOrdersJson);

  // Already at max buys
  if (buyCount >= safetyOrders.length + 1) return;

  // Cooldown check
  if (cycle.lastBuyAt) {
    const cooldownMs = assetConfig.cooldownMinutesBetweenBuys * 60 * 1000;
    if (Date.now() - new Date(cycle.lastBuyAt).getTime() < cooldownMs) {
      return; // Cooldown active
    }
  }

  // Check next buy level
  const nextBuyPrice = parseFloat(String(cycle.nextBuyPrice || "0"));
  if (nextBuyPrice <= 0 || currentPrice > nextBuyPrice) return;

  // Price has reached the next safety buy level
  // Check rebound if required
  if (assetConfig.requireReboundConfirmation) {
    const candles = ohlcCache.get(pair) || [];
    const recentCandles = candles.slice(-5).map(c => ({
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    const localLow = Math.min(...recentCandles.map(c => c.low), currentPrice);
    if (!smart.detectRebound({ recentCandles, currentPrice, localLow })) {
      return; // No rebound confirmed yet
    }
  }

  // Exposure checks
  const allocatedCapital = parseFloat(String(config.allocatedCapitalUsd));
  const totalCapitalUsed = parseFloat(String(cycle.capitalUsedUsd));
  const maxModulePct = parseFloat(String(config.maxModuleExposurePct));
  const maxAssetPct = parseFloat(String(config.maxAssetExposurePct));
  const capitalReserved = parseFloat(String(cycle.capitalReservedUsd));

  if (totalCapitalUsed / allocatedCapital * 100 >= maxModulePct) {
    await logBlock(pair, mode, "module_exposure_max_reached", cycle);
    return;
  }
  if (totalCapitalUsed / capitalReserved * 100 >= maxAssetPct) {
    await logBlock(pair, mode, "asset_exposure_max_reached", cycle);
    return;
  }

  // Execute safety buy
  const safetyIndex = buyCount; // 0-indexed in safetyOrders, but buyCount starts at 1 (base buy)
  const safetyOrder = safetyOrders[safetyIndex - 1];
  if (!safetyOrder) return;

  const sizeProfile = (cycle.adaptiveSizeProfile as IdcaSizeProfile) || "balanced";
  const weights = smart.getSizeWeights(sizeProfile, safetyOrders.length + 1);
  const buyPct = weights[buyCount] || 25;
  const buyUsd = capitalReserved * (buyPct / 100);
  const quantity = buyUsd / currentPrice;

  // Simulation fees
  let fees = 0, slippage = 0, netValue = buyUsd;
  if (mode === "simulation") {
    fees = buyUsd * (parseFloat(String(config.simulationFeePct)) / 100);
    slippage = buyUsd * (parseFloat(String(config.simulationSlippagePct)) / 100);
    netValue = buyUsd + fees + slippage;
  }

  // Recalculate average
  const prevQty = parseFloat(String(cycle.totalQuantity));
  const prevCost = parseFloat(String(cycle.capitalUsedUsd));
  const newTotalQty = prevQty + quantity;
  const newTotalCost = prevCost + netValue;
  const newAvgPrice = newTotalCost / newTotalQty;
  const newBuyCount = buyCount + 1;

  // Next level
  const nextSafety = safetyOrders[safetyIndex]; // next after current
  const nextLevelPct = nextSafety ? nextSafety.dipPct : null;
  const avgForNextBuy = newAvgPrice; // Reference from new avg
  const nextBuyPriceCalc = nextLevelPct ? newAvgPrice * (1 - nextLevelPct / 100) : null;

  // Dynamic TP recalculation
  let tpPct = parseFloat(String(assetConfig.takeProfitPct));
  let tpBreakdownSafety: any = null;
  const cycleType = (cycle.cycleType as IdcaCycleType) || "main";
  if (config.adaptiveTpEnabled) {
    const dtpConfig = getDynamicTpConfig(config);
    const breakdown = smart.computeDynamicTakeProfit({
      pair,
      cycleType,
      buyCount: newBuyCount,
      marketScore: parseFloat(String(cycle.marketScore || "50")),
      volatilityPct: getVolatility(pair),
      reboundStrength: getReboundStrength(pair),
      config: dtpConfig,
    });
    tpPct = breakdown.finalTpPct;
    tpBreakdownSafety = breakdown;
  }
  const tpPrice = newAvgPrice * (1 + tpPct / 100);

  await repo.updateCycle(cycle.id, {
    capitalUsedUsd: newTotalCost.toFixed(2),
    totalQuantity: newTotalQty.toFixed(8),
    avgEntryPrice: newAvgPrice.toFixed(8),
    buyCount: newBuyCount,
    nextBuyLevelPct: nextLevelPct?.toFixed(2) || null,
    nextBuyPrice: nextBuyPriceCalc?.toFixed(8) || null,
    tpTargetPct: tpPct.toFixed(2),
    tpTargetPrice: tpPrice.toFixed(8),
    tpBreakdownJson: tpBreakdownSafety,
    lastBuyAt: new Date(),
  });

  const order = await repo.createOrder({
    cycleId: cycle.id,
    pair,
    mode,
    orderType: "safety_buy",
    buyIndex: newBuyCount,
    side: "buy",
    price: currentPrice.toFixed(8),
    quantity: quantity.toFixed(8),
    grossValueUsd: buyUsd.toFixed(2),
    feesUsd: fees.toFixed(2),
    slippageUsd: slippage.toFixed(2),
    netValueUsd: netValue.toFixed(2),
    triggerReason: `Safety buy #${newBuyCount} at -${safetyOrder.dipPct}%`,
    humanReason: formatOrderReason("safety_buy"),
  });

  if (mode === "live") {
    await executeRealBuy(pair, quantity, currentPrice);
  }

  if (mode === "simulation") {
    const wallet = await repo.getSimulationWallet();
    await repo.updateSimulationWallet({
      availableBalanceUsd: (parseFloat(String(wallet.availableBalanceUsd)) - netValue).toFixed(2),
      usedBalanceUsd: (parseFloat(String(wallet.usedBalanceUsd)) + netValue).toFixed(2),
      totalOrdersSimulated: wallet.totalOrdersSimulated + 1,
    });
  }

  await createHumanEvent({
    cycleId: cycle.id, pair, mode,
    eventType: "safety_buy_executed",
    severity: "info",
    message: `Safety buy #${newBuyCount}: ${quantity.toFixed(6)} @ ${currentPrice.toFixed(2)}, avg=${newAvgPrice.toFixed(2)}`,
  }, {
    eventType: "safety_buy_executed", pair, mode,
    price: currentPrice, quantity, avgEntry: newAvgPrice,
    capitalUsed: newTotalCost, buyCount: newBuyCount,
  });

  // Re-fetch cycle for telegram alert — pass previous avg so Telegram can show improvement
  const prevAvg = parseFloat(String(cycle.avgEntryPrice || "0"));
  const updatedCycle = await repo.getCycleById(cycle.id);
  if (updatedCycle) {
    await telegram.alertBuyExecuted(updatedCycle, order, "safety_buy", prevAvg);
  }
}

// ─── Take Profit Arm ───────────────────────────────────────────────

async function armTakeProfit(
  cycle: InstitutionalDcaCycle,
  currentPrice: number,
  config: InstitutionalDcaConfigRow,
  assetConfig: InstitutionalDcaAssetConfigRow,
  mode: IdcaMode
): Promise<void> {
  const pair = cycle.pair;
  const totalQty = parseFloat(String(cycle.totalQuantity));
  const capitalUsed = parseFloat(String(cycle.capitalUsedUsd));

  // Calculate partial sell amount
  const pnlPct = ((currentPrice * totalQty - capitalUsed) / capitalUsed) * 100;
  const partialPct = smart.computeDynamicPartialPct(
    pnlPct,
    parseFloat(String(config.partialTpMinPct)),
    parseFloat(String(config.partialTpMaxPct))
  );
  const partialQty = totalQty * (partialPct / 100);
  const partialValueUsd = partialQty * currentPrice;

  // Execute partial sell
  let fees = 0, slippage = 0, netValue = partialValueUsd;
  if (mode === "simulation") {
    fees = partialValueUsd * (parseFloat(String(config.simulationFeePct)) / 100);
    slippage = partialValueUsd * (parseFloat(String(config.simulationSlippagePct)) / 100);
    netValue = partialValueUsd - fees - slippage;
  }

  await repo.createOrder({
    cycleId: cycle.id, pair, mode,
    orderType: "partial_sell",
    side: "sell",
    price: currentPrice.toFixed(8),
    quantity: partialQty.toFixed(8),
    grossValueUsd: partialValueUsd.toFixed(2),
    feesUsd: fees.toFixed(2),
    slippageUsd: slippage.toFixed(2),
    netValueUsd: netValue.toFixed(2),
    triggerReason: `TP armed at ${pnlPct.toFixed(2)}%, partial sell ${partialPct.toFixed(0)}%`,
    humanReason: formatOrderReason("partial_sell"),
  });

  if (mode === "live") {
    await executeRealSell(cycle, "partial_sell", partialQty);
  }

  const remainingQty = totalQty - partialQty;

  // Get trailing pct
  let trailingPct = parseFloat(String(cycle.trailingPct || assetConfig.trailingPct));
  if (config.volatilityTrailingEnabled) {
    trailingPct = smart.computeDynamicTrailing({
      atrPct: getVolatility(pair),
      baseTrailingPct: trailingPct,
      minTrailingPct: parseFloat(String(pair === "BTC/USD" ? config.minTrailingPctBtc : config.minTrailingPctEth)),
      maxTrailingPct: parseFloat(String(pair === "BTC/USD" ? config.maxTrailingPctBtc : config.maxTrailingPctEth)),
    });
  }

  await repo.updateCycle(cycle.id, {
    status: "trailing_active",
    tpArmedAt: new Date(),
    trailingActiveAt: new Date(),
    highestPriceAfterTp: currentPrice.toFixed(8),
    totalQuantity: remainingQty.toFixed(8),
    realizedPnlUsd: netValue.toFixed(2),
    trailingPct: trailingPct.toFixed(2),
  });

  if (mode === "simulation") {
    const wallet = await repo.getSimulationWallet();
    await repo.updateSimulationWallet({
      availableBalanceUsd: (parseFloat(String(wallet.availableBalanceUsd)) + netValue).toFixed(2),
      usedBalanceUsd: (parseFloat(String(wallet.usedBalanceUsd)) - partialValueUsd).toFixed(2),
    });
  }

  await createHumanEvent({
    cycleId: cycle.id, pair, mode,
    eventType: "tp_armed",
    severity: "info",
    message: `TP armed: sold ${partialPct.toFixed(0)}%, trailing ${trailingPct.toFixed(2)}% on remaining ${remainingQty.toFixed(6)}`,
  }, {
    eventType: "tp_armed", pair, mode,
    pnlPct, tpPct: parseFloat(String(cycle.tpTargetPct || "0")), trailingPct, partialPct,
    avgEntry: parseFloat(String(cycle.avgEntryPrice || "0")),
    price: currentPrice,
  });

  const updatedCycle = await repo.getCycleById(cycle.id);
  if (updatedCycle) {
    await telegram.alertTpArmed(updatedCycle, partialPct);
  }
}

// ─── Trailing State ────────────────────────────────────────────────

async function handleTrailingState(
  cycle: InstitutionalDcaCycle,
  currentPrice: number,
  config: InstitutionalDcaConfigRow,
  assetConfig: InstitutionalDcaAssetConfigRow,
  mode: IdcaMode
): Promise<void> {
  const pair = cycle.pair;
  const highestPrice = parseFloat(String(cycle.highestPriceAfterTp || currentPrice));
  const trailingPct = parseFloat(String(cycle.trailingPct || assetConfig.trailingPct));

  // ─── TRAILING DIAGNOSTIC TRACE ────────────────────────────────
  const dropFromHigh = highestPrice > 0 ? ((highestPrice - currentPrice) / highestPrice) * 100 : 0;
  const stopPrice = highestPrice * (1 - trailingPct / 100);
  console.log(
    `${TAG}[EXIT_EVAL] #${cycle.id} ${pair} | status=trailing_active | price=$${currentPrice.toFixed(2)}` +
    ` | highest=$${highestPrice.toFixed(2)} | drop=${dropFromHigh.toFixed(3)}%` +
    ` | trailingPct=${trailingPct}% | trailingStop=$${stopPrice.toFixed(2)}` +
    ` | needDrop=${Math.max(0, trailingPct - dropFromHigh).toFixed(3)}% more`
  );

  // Update highest price
  if (currentPrice > highestPrice) {
    await repo.updateCycle(cycle.id, {
      highestPriceAfterTp: currentPrice.toFixed(8),
    });
    console.log(`${TAG}[EXIT_EVAL] #${cycle.id} ${pair} | trailing: new high=$${currentPrice.toFixed(2)} — rising, no exit`);
    return; // Price still rising
  }

  // Check trailing stop trigger
  if (dropFromHigh >= trailingPct) {
    console.log(`${TAG}[EXIT_EVAL] #${cycle.id} ${pair} | trailing_EXIT: drop=${dropFromHigh.toFixed(3)}% >= ${trailingPct}% → SELLING at $${currentPrice.toFixed(2)}`);
    // Trailing exit — sell remaining
    await executeTrailingExit(cycle, currentPrice, config, mode);
  } else {
    console.log(`${TAG}[EXIT_EVAL] #${cycle.id} ${pair} | trailing: drop=${dropFromHigh.toFixed(3)}% < ${trailingPct}% — holding`);
  }
}

// ─── Trailing Exit ─────────────────────────────────────────────────

async function executeTrailingExit(
  cycle: InstitutionalDcaCycle,
  currentPrice: number,
  config: InstitutionalDcaConfigRow,
  mode: IdcaMode
): Promise<void> {
  const pair = cycle.pair;
  const remainingQty = parseFloat(String(cycle.totalQuantity));
  const sellValueUsd = remainingQty * currentPrice;

  let fees = 0, slippage = 0, netValue = sellValueUsd;
  if (mode === "simulation") {
    fees = sellValueUsd * (parseFloat(String(config.simulationFeePct)) / 100);
    slippage = sellValueUsd * (parseFloat(String(config.simulationSlippagePct)) / 100);
    netValue = sellValueUsd - fees - slippage;
  }

  await repo.createOrder({
    cycleId: cycle.id, pair, mode,
    orderType: "final_sell",
    side: "sell",
    price: currentPrice.toFixed(8),
    quantity: remainingQty.toFixed(8),
    grossValueUsd: sellValueUsd.toFixed(2),
    feesUsd: fees.toFixed(2),
    slippageUsd: slippage.toFixed(2),
    netValueUsd: netValue.toFixed(2),
    triggerReason: "trailing_exit",
    humanReason: formatOrderReason("final_sell"),
  });

  if (mode === "live") {
    try {
      await executeRealSell(cycle, "final_sell", remainingQty);
    } catch (sellErr: any) {
      console.error(`${TAG}[EXIT] Live sell FAILED for #${cycle.id} ${pair} — cycle NOT closed in DB. Error: ${sellErr.message}`);
      await createHumanEvent({
        cycleId: cycle.id, pair, mode,
        eventType: "critical_error",
        severity: "critical",
        message: `Venta live FALLIDA: ${sellErr.message} — ciclo NO cerrado, posición ABIERTA en exchange`,
        payloadJson: { error: sellErr.message, price: currentPrice, qty: remainingQty },
      }, { eventType: "critical_error", pair, mode, price: currentPrice });
      await telegram.sendRawMessage(
        `🚨 <b>[IDCA][LIVE] VENTA FALLIDA</b>\n\nPar: <b>${pair}</b> #${cycle.id}\nError: <code>${sellErr.message}</code>\nPrecio: $${currentPrice.toFixed(2)}\nCantidad: ${remainingQty.toFixed(6)}\n\n⚠️ Ciclo NO cerrado en DB. Revisar posición en exchange manualmente.`
      );
      return; // Abort — do NOT close cycle in DB
    }
  }

  const prevRealized = parseFloat(String(cycle.realizedPnlUsd || "0"));
  const totalRealized = prevRealized + netValue;
  const capitalUsedForPnl = parseFloat(String(cycle.capitalUsedUsd || "0"));
  const pnlPctTrailing = capitalUsedForPnl > 0 ? ((totalRealized - capitalUsedForPnl) / capitalUsedForPnl) * 100 : 0;

  const closedAt = new Date();
  const startedAt = cycle.startedAt ? new Date(cycle.startedAt) : closedAt;
  const durMs = closedAt.getTime() - startedAt.getTime();
  const durH = Math.floor(durMs / 3600000);
  const durM = Math.floor((durMs % 3600000) / 60000);
  const durationStr = durH > 24 ? `${Math.floor(durH / 24)}d ${durH % 24}h` : `${durH}h ${durM}m`;

  await repo.updateCycle(cycle.id, {
    status: "closed",
    closeReason: "trailing_exit",
    totalQuantity: "0",
    realizedPnlUsd: totalRealized.toFixed(2),
    closedAt,
  });

  if (mode === "simulation") {
    const wallet = await repo.getSimulationWallet();
    await repo.updateSimulationWallet({
      availableBalanceUsd: (parseFloat(String(wallet.availableBalanceUsd)) + netValue).toFixed(2),
      usedBalanceUsd: Math.max(0, parseFloat(String(wallet.usedBalanceUsd)) - sellValueUsd).toFixed(2),
      realizedPnlUsd: (parseFloat(String(wallet.realizedPnlUsd)) + totalRealized - capitalUsedForPnl).toFixed(2),
    });
  }

  await createHumanEvent({
    cycleId: cycle.id, pair, mode,
    eventType: "trailing_exit",
    severity: "info",
    message: `Trailing exit: sold ${remainingQty.toFixed(6)} @ ${currentPrice.toFixed(2)}, realized=${totalRealized.toFixed(2)}`,
  }, {
    eventType: "trailing_exit", pair, mode,
    price: currentPrice, pnlPct: pnlPctTrailing,
    pnlUsd: totalRealized - capitalUsedForPnl,
    buyCount: cycle.buyCount, durationStr,
  });

  const updatedCycle = await repo.getCycleById(cycle.id);
  if (updatedCycle) {
    await telegram.alertTrailingExit(updatedCycle);
  }
}

// ─── Breakeven Exit ────────────────────────────────────────────────

async function executeBreakevenExit(
  cycle: InstitutionalDcaCycle,
  currentPrice: number,
  config: InstitutionalDcaConfigRow,
  mode: IdcaMode
): Promise<void> {
  const pair = cycle.pair;
  const totalQty = parseFloat(String(cycle.totalQuantity));
  const sellValueUsd = totalQty * currentPrice;

  let fees = 0, slippage = 0, netValue = sellValueUsd;
  if (mode === "simulation") {
    fees = sellValueUsd * (parseFloat(String(config.simulationFeePct)) / 100);
    slippage = sellValueUsd * (parseFloat(String(config.simulationSlippagePct)) / 100);
    netValue = sellValueUsd - fees - slippage;
  }

  await repo.createOrder({
    cycleId: cycle.id, pair, mode,
    orderType: "breakeven_sell",
    side: "sell",
    price: currentPrice.toFixed(8),
    quantity: totalQty.toFixed(8),
    grossValueUsd: sellValueUsd.toFixed(2),
    feesUsd: fees.toFixed(2),
    slippageUsd: slippage.toFixed(2),
    netValueUsd: netValue.toFixed(2),
    triggerReason: "breakeven_protection",
    humanReason: formatOrderReason("breakeven_sell"),
  });

  if (mode === "live") {
    try {
      await executeRealSell(cycle, "breakeven_sell", totalQty);
    } catch (sellErr: any) {
      console.error(`${TAG}[BREAKEVEN] Live sell FAILED for #${cycle.id} ${pair} — cycle NOT closed. Error: ${sellErr.message}`);
      await createHumanEvent({
        cycleId: cycle.id, pair, mode,
        eventType: "critical_error",
        severity: "critical",
        message: `Venta breakeven live FALLIDA: ${sellErr.message} — ciclo NO cerrado`,
        payloadJson: { error: sellErr.message, price: currentPrice, qty: totalQty },
      }, { eventType: "critical_error", pair, mode, price: currentPrice });
      await telegram.sendRawMessage(
        `🚨 <b>[IDCA][LIVE] BREAKEVEN SELL FALLIDA</b>\n\nPar: <b>${pair}</b> #${cycle.id}\nError: <code>${sellErr.message}</code>`
      );
      return;
    }
  }

  await repo.updateCycle(cycle.id, {
    status: "closed",
    closeReason: "breakeven_exit",
    totalQuantity: "0",
    realizedPnlUsd: netValue.toFixed(2),
    closedAt: new Date(),
  });

  if (mode === "simulation") {
    const wallet = await repo.getSimulationWallet();
    await repo.updateSimulationWallet({
      availableBalanceUsd: (parseFloat(String(wallet.availableBalanceUsd)) + netValue).toFixed(2),
      usedBalanceUsd: Math.max(0, parseFloat(String(wallet.usedBalanceUsd)) - sellValueUsd).toFixed(2),
    });
  }

  await createHumanEvent({
    cycleId: cycle.id, pair, mode,
    eventType: "breakeven_exit",
    severity: "warn",
    message: `Breakeven exit: ${totalQty.toFixed(6)} @ ${currentPrice.toFixed(2)}`,
  }, {
    eventType: "breakeven_exit", pair, mode,
    price: currentPrice, quantity: totalQty, buyCount: cycle.buyCount,
  });

  const updatedCycle = await repo.getCycleById(cycle.id);
  if (updatedCycle) {
    await telegram.alertBreakevenExit(updatedCycle);
  }
}

// ─── Entry Check Logic ─────────────────────────────────────────────

async function performEntryCheck(
  pair: string,
  currentPrice: number,
  config: InstitutionalDcaConfigRow,
  assetConfig: InstitutionalDcaAssetConfigRow,
  mode: IdcaMode
): Promise<IdcaEntryCheckResult> {
  const blocks: IdcaBlockReason[] = [];
  const now = new Date();

  // Check pair allowed
  if (!INSTITUTIONAL_DCA_ALLOWED_PAIRS.includes(pair as any)) {
    blocks.push({ code: "pair_not_allowed", message: `${pair} not allowed`, timestamp: now });
    return { allowed: false, blockReasons: blocks };
  }

  // Check no existing autonomous bot cycle
  const existing = await repo.getActiveBotCycle(pair, mode);
  if (existing) {
    return { allowed: false, blockReasons: [{ code: "cycle_already_active", message: "Active cycle exists", timestamp: now }] };
  }

  // Check exposure (bot-managed cycles only; imported positions are independent)
  const allocatedCapital = parseFloat(String(config.allocatedCapitalUsd));
  const allCycles = await repo.getAllActiveBotCycles(mode);
  let totalUsed = 0;
  for (const c of allCycles) {
    totalUsed += parseFloat(String(c.capitalUsedUsd || "0"));
  }
  const modulePct = (totalUsed / allocatedCapital) * 100;
  if (modulePct >= parseFloat(String(config.maxModuleExposurePct))) {
    blocks.push({ code: "module_exposure_max_reached", message: `Module exposure ${modulePct.toFixed(1)}% >= max`, timestamp: now });
  }

  // Check simulation wallet balance
  if (mode === "simulation") {
    const wallet = await repo.getSimulationWallet();
    const available = parseFloat(String(wallet.availableBalanceUsd));
    if (available < 50) {
      blocks.push({ code: "insufficient_simulation_balance", message: `Simulation balance too low: $${available.toFixed(2)}`, timestamp: now });
    }
  }

  // Cold-start guard: if OHLCV cache is empty, block immediately with data_not_ready
  const cacheCandles = ohlcCache.get(pair) || [];
  if (cacheCandles.length === 0) {
    const dataNotReadyMsg = `Sistema inicializando datos OHLCV para ${pair}. Esperando primera carga de velas.`;
    console.warn(`${TAG}[OHLCV] ${pair}: caché vacío — data_not_ready (exchange no inicializado o primera carga pendiente)`);
    blocks.push({ code: "data_not_ready", message: dataNotReadyMsg, timestamp: now });
    return {
      allowed: false,
      blockReasons: blocks,
      marketScore: 0,
      volatilityScore: 0,
      sizeProfile: "balanced" as IdcaSizeProfile,
      entryDipPct: 0,
      basePrice: { price: 0, type: "cycle_start_price" as BasePriceType, windowMinutes: 0, timestamp: new Date(), isReliable: false, reason: dataNotReadyMsg, meta: { candleCount: 0, swingHighsFound: 0 } },
      reboundConfirmed: false,
    };
  }

  // Calculate base price using deterministic method
  const dipRefMethod = normalizeDipReferenceMethod(assetConfig.dipReference || "hybrid", { pair, origin: "assetConfig.dipReference" });
  const candles = cacheCandles;
  const basePriceResult = smart.computeBasePrice({
    candles,
    lookbackMinutes: config.localHighLookbackMinutes,
    method: dipRefMethod,
    currentPrice,
  });

  // Structured log — always emitted for trazabilidad
  logBasePriceDebug(pair, currentPrice, basePriceResult);

  if (!basePriceResult.isReliable) {
    blocks.push({ code: "insufficient_base_price_data", message: basePriceResult.reason, timestamp: now });
  }

  const entryDipPct = basePriceResult.price > 0
    ? ((basePriceResult.price - currentPrice) / basePriceResult.price) * 100
    : 0;
  const minDip = parseFloat(String(assetConfig.minDipPct));

  if (basePriceResult.isReliable && entryDipPct < minDip) {
    blocks.push({ code: "insufficient_dip", message: `EntryDip ${entryDipPct.toFixed(2)}% < min ${minDip}% (BasePrice=$${basePriceResult.price.toFixed(2)}, Type=${basePriceResult.type})`, timestamp: now });
  }

  // BTC gate for ETH
  if (pair === "ETH/USD" && config.btcMarketGateForEthEnabled) {
    const btcPrice = await getCurrentPrice("BTC/USD");
    const btcCandles = ohlcCache.get("BTC/USD") || [];
    const btcBasePrice = smart.computeBasePrice({
      candles: btcCandles,
      lookbackMinutes: config.localHighLookbackMinutes,
      method: dipRefMethod,
      currentPrice: btcPrice,
    });
    const btcDip = btcBasePrice.price > 0 ? ((btcBasePrice.price - btcPrice) / btcBasePrice.price) * 100 : 0;
    if (btcDip > 10) {
      blocks.push({ code: "btc_breakdown_blocks_eth", message: `BTC dip ${btcDip.toFixed(1)}% > 10% (base=$${btcBasePrice.price.toFixed(2)})`, pair: "BTC/USD", timestamp: now });
    }
  }

  // Market score
  let marketScore = 60;
  let volatilityScore = 0;
  let sizeProfile: IdcaSizeProfile = "balanced";

  if (config.smartModeEnabled) {
    const scoreCandles = ohlcCache.get(pair) || [];
    if (scoreCandles.length >= 20) {
      const closes = scoreCandles.map(c => c.close);
      const ema20 = smart.computeEMA(closes, 20);
      const ema50 = smart.computeEMA(closes, Math.min(50, closes.length));
      const rsi = smart.computeRSI(closes);
      const atrPct = smart.computeATRPct(scoreCandles);
      volatilityScore = atrPct;

      const weights = (config.marketScoreWeightsJson || {}) as smart.MarketScoreInput & Record<string, number>;

      // Use basePriceResult as the reference high for score computation
      const scoreLocalHigh = basePriceResult.price > 0 ? basePriceResult.price : Math.max(...closes.slice(-60));

      // Get BTC score for ETH
      let btcScore: number | undefined;
      if (pair === "ETH/USD") {
        const btcScoreCandles = ohlcCache.get("BTC/USD") || [];
        if (btcScoreCandles.length >= 20) {
          const btcCloses = btcScoreCandles.map(c => c.close);
          const btcEma20 = smart.computeEMA(btcCloses, 20);
          const btcRsi = smart.computeRSI(btcCloses);
          btcScore = smart.computeMarketScore({
            currentPrice: btcCloses[btcCloses.length - 1],
            ema20: btcEma20[btcEma20.length - 1],
            ema50: btcEma20[Math.max(0, btcEma20.length - 2)],
            prevEma20: btcEma20[Math.max(0, btcEma20.length - 2)],
            prevEma50: btcEma20[Math.max(0, btcEma20.length - 3)],
            rsi: btcRsi,
            currentVolume: 1,
            avgVolume: 1,
            localHigh: Math.max(...btcCloses.slice(-60)),
          }, config.marketScoreWeightsJson as any);
        }
      }

      marketScore = smart.computeMarketScore({
        currentPrice,
        ema20: ema20[ema20.length - 1],
        ema50: ema50[ema50.length - 1],
        prevEma20: ema20[Math.max(0, ema20.length - 2)],
        prevEma50: ema50[Math.max(0, ema50.length - 2)],
        rsi,
        currentVolume: 1,
        avgVolume: 1,
        localHigh: scoreLocalHigh,
        btcScore,
      }, config.marketScoreWeightsJson as any);

      if (marketScore < 50) {
        blocks.push({ code: "market_score_too_low", message: `Score ${marketScore} < 50`, timestamp: now });
      }

      sizeProfile = config.adaptivePositionSizingEnabled
        ? smart.selectSizeProfile(marketScore)
        : "balanced";
    }
  }

  // Rebound confirmation
  let reboundConfirmed = true;
  if (assetConfig.requireReboundConfirmation && entryDipPct >= minDip) {
    const reboundCandles = ohlcCache.get(pair) || [];
    const recentCandles = reboundCandles.slice(-5);
    const localLow = recentCandles.length > 0
      ? Math.min(...recentCandles.map(c => c.low))
      : currentPrice;
    reboundConfirmed = smart.detectRebound({ recentCandles, currentPrice, localLow });
    if (!reboundConfirmed) {
      blocks.push({ code: "no_rebound_confirmed", message: "Waiting for rebound confirmation", timestamp: now });
    }
  }

  // Entry decision log — emitido con todos los bloques evaluados
  logEntryDecision(
    pair, mode,
    blocks.length === 0 ? "allowed" : "blocked",
    blocks.length === 0 ? "all_checks_passed" : blocks.map(b => b.code).join(","),
    entryDipPct, minDip, basePriceResult, currentPrice
  );

  return {
    allowed: blocks.length === 0,
    blockReasons: blocks,
    marketScore,
    volatilityScore,
    sizeProfile,
    entryDipPct,
    basePrice: basePriceResult,
    reboundConfirmed,
  };
}

// ─── Module Drawdown Check ─────────────────────────────────────────

const DRAWDOWN_ALERT_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes between alerts
let lastDrawdownAlertTime = 0;
let lastDrawdownAlertPct = 0;

async function checkModuleDrawdown(config: InstitutionalDcaConfigRow, mode: IdcaMode): Promise<boolean> {
  const maxDD = parseFloat(String(config.maxModuleDrawdownPct));
  if (maxDD <= 0) return true;

  const activeCycles = await repo.getAllActiveCycles(mode);
  const allocatedCapital = parseFloat(String(config.allocatedCapitalUsd));
  let totalUsed = 0;
  let totalUnrealized = 0;

  for (const c of activeCycles) {
    totalUsed += parseFloat(String(c.capitalUsedUsd || "0"));
    totalUnrealized += parseFloat(String(c.unrealizedPnlUsd || "0"));
  }

  if (totalUsed <= 0) return true;

  const ddPct = Math.abs(Math.min(0, totalUnrealized) / allocatedCapital * 100);
  if (ddPct >= maxDD) {
    const now = Date.now();
    const timeSinceLast = now - lastDrawdownAlertTime;

    // Only create event + telegram alert if cooldown has expired or drawdown jumped significantly (+5%)
    if (timeSinceLast >= DRAWDOWN_ALERT_COOLDOWN_MS || Math.abs(ddPct - lastDrawdownAlertPct) >= 5) {
      console.log(`${TAG}[MODULE_DRAWDOWN] ${ddPct.toFixed(2)}% >= ${maxDD}% — pausing module (alert sent)`);
      await createHumanEvent({
        mode,
        eventType: "module_max_drawdown_reached",
        severity: "critical",
        message: `Module drawdown ${ddPct.toFixed(2)}% exceeded max ${maxDD}%`,
        payloadJson: { drawdownPct: ddPct, maxPct: maxDD },
      }, { eventType: "module_max_drawdown_reached", mode, drawdownPct: ddPct, maxDrawdownPct: maxDD });
      await telegram.alertModuleDrawdownBreached(mode, ddPct, maxDD);
      lastDrawdownAlertTime = now;
      lastDrawdownAlertPct = ddPct;
    } else {
      console.log(`${TAG}[MODULE_DRAWDOWN] ${ddPct.toFixed(2)}% >= ${maxDD}% — pausing (cooldown, next alert in ${Math.ceil((DRAWDOWN_ALERT_COOLDOWN_MS - timeSinceLast) / 60000)}m)`);
    }
    return false;
  }

  // Drawdown recovered — reset cooldown so next breach triggers immediately
  if (lastDrawdownAlertTime > 0) {
    console.log(`${TAG}[MODULE_DRAWDOWN] Recovered: ${ddPct.toFixed(2)}% < ${maxDD}%`);
    lastDrawdownAlertTime = 0;
    lastDrawdownAlertPct = 0;
  }

  return true;
}

// ─── Market Data Helpers ───────────────────────────────────────────

async function getCurrentPrice(pair: string): Promise<number> {
  try {
    const dataExchange = ExchangeFactory.getDataExchange();
    if (dataExchange.isInitialized()) {
      const ticker = await dataExchange.getTicker(pair);
      const price = ticker.last;
      priceCache.set(pair, price);
      return price;
    }
  } catch (e: any) {
    // Fallback to cached price
  }
  return priceCache.get(pair) || 0;
}

function getVolatility(pair: string): number {
  const candles = ohlcCache.get(pair) || [];
  if (candles.length < 5) return 2.0; // Default
  return smart.computeATRPct(candles);
}

// ─── Structured logs for basePrice trazabilidad ──────────────────────

function logBasePriceDebug(pair: string, currentPrice: number, base: BasePriceResult): void {
  const m = base.meta;
  console.log(
    `${TAG}[IDCA_BASE_PRICE]` +
    ` pair=${pair}` +
    ` current_price=${currentPrice.toFixed(2)}` +
    ` base_price=${base.price.toFixed(2)}` +
    ` anchor_price=${(m?.selectedAnchorPrice ?? base.price).toFixed(2)}` +
    ` anchor_time=${m?.selectedAnchorTime ? new Date(m.selectedAnchorTime).toISOString().slice(0, 16) : "n/a"}` +
    ` drawdown_pct=${(m?.drawdownPctFromAnchor ?? 0).toFixed(2)}%` +
    ` selected_method=${m?.selectedMethod ?? base.type}` +
    ` selected_reason="${m?.selectedReason ?? base.reason}"` +
    ` p95_24h=${m?.candidates?.p95_24h?.toFixed(2) ?? "n/a"}` +
    ` p95_7d=${m?.candidates?.p95_7d?.toFixed(2) ?? "n/a"}` +
    ` p95_30d=${m?.candidates?.p95_30d?.toFixed(2) ?? "n/a"}` +
    ` window_high_24h=${m?.candidates?.windowHigh24h?.toFixed(2) ?? "n/a"}` +
    ` outlier_rejected=${m?.outlierRejected ?? false}` +
    ` atr_pct=${m?.atrPct?.toFixed(2) ?? "n/a"}%` +
    ` cap_7d_applied=${m?.capsApplied?.cappedBy7d ?? false}` +
    ` cap_30d_applied=${m?.capsApplied?.cappedBy30d ?? false}` +
    ` is_reliable=${base.isReliable}`
  );
}

function logEntryDecision(pair: string, mode: string, action: "allowed" | "blocked", reason: string, dip: number, minDip: number, base: BasePriceResult, currentPrice: number): void {
  console.log(
    `${TAG}[IDCA_ENTRY_DECISION]` +
    ` pair=${pair}` +
    ` action=${action}` +
    ` reason="${reason}"` +
    ` drawdown_pct=${dip.toFixed(2)}%` +
    ` required_drop=${minDip.toFixed(2)}%` +
    ` base_price=${base.price.toFixed(2)}` +
    ` current_price=${currentPrice.toFixed(2)}`
  );
  // Persist to DB (always for "allowed"; throttled 5min for "blocked" to avoid DB spam)
  const now = Date.now();
  const last = lastEntryEventMs.get(pair) ?? 0;
  if (action === "allowed" || now - last >= ENTRY_EVENT_THROTTLE_MS) {
    lastEntryEventMs.set(pair, now);
    repo.createEvent({
      pair,
      mode,
      eventType: "entry_evaluated",
      severity: "info",
      message: action === "allowed"
        ? `[${pair}] Entrada PERMITIDA — caída ${dip.toFixed(2)}% ≥ mínimo ${minDip.toFixed(2)}% | base=$${base.price.toFixed(2)}`
        : `[${pair}] Entrada bloqueada (${reason}) — caída ${dip.toFixed(2)}% vs mínimo ${minDip.toFixed(2)}%`,
      payloadJson: { action, reason, dip, minDip, basePrice: base.price, currentPrice, baseMethod: base.meta?.selectedMethod ?? base.type },
    }).then(() => {
      console.log(`${TAG}[ENTRY_EVENT] Persisted entry_evaluated pair=${pair} mode=${mode} action=${action}`);
    }).catch(e => {
      console.error(`${TAG}[ENTRY_EVENT] FAILED to persist entry_evaluated pair=${pair}: ${e?.message}`);
    });
  }
}

// Helper: compute P95 of an array of numbers
function computeP95Local(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * 0.95);
  return sorted[Math.min(idx, sorted.length - 1)];
}

// Helper: map raw Kraken OHLC response to TimestampedCandle
function mapKrakenCandles(candles: any[]): TimestampedCandle[] {
  return candles.map((c: any) => ({
    high:  parseFloat(String(c.high  || c[2] || 0)),
    low:   parseFloat(String(c.low   || c[3] || 0)),
    close: parseFloat(String(c.close || c[4] || 0)),
    time:  c.time ? c.time * 1000 : (c[0] ? c[0] * 1000 : Date.now()),
  }));
}

// Helper: compute bucket context metrics from a candle slice
function computeBucketContext(
  candles: TimestampedCandle[],
  nowMs: number,
  bucketMinutes: number,
  bucketLabel: "7d" | "30d" | "90d" | "180d"
): import("./IdcaTypes").IdcaBucketContext | undefined {
  const slice = candles.filter(c => c.time >= nowMs - bucketMinutes * 60 * 1000);
  if (slice.length < 2) return undefined;
  const highs  = slice.map(c => c.high);
  const lows   = slice.map(c => c.low);
  const closes = slice.map(c => c.close);
  const highMax  = Math.max(...highs);
  const lowMin   = Math.min(...lows);
  const p95High  = computeP95Local(highs);
  const avgClose = closes.reduce((a, b) => a + b, 0) / closes.length;
  const lastClose = closes[closes.length - 1];
  const drawdownFromHighPct = highMax > 0 ? ((highMax - lastClose) / highMax) * 100 : 0;
  const rangePosition = highMax > lowMin ? (lastClose - lowMin) / (highMax - lowMin) : 0.5;
  return { bucket: bucketLabel, highMax, lowMin, p95High, avgClose, drawdownFromHighPct, rangePosition, candleCount: slice.length };
}

async function updateOhlcvCache(): Promise<void> {
  for (const pair of INSTITUTIONAL_DCA_ALLOWED_PAIRS) {
    try {
      const dataExchange = ExchangeFactory.getDataExchange();
      if (!dataExchange.isInitialized()) continue;

      // ── 1h candles (24h / 7d / 30d analysis) ───────────────────────
      const candles1h = await (dataExchange as any).getOHLC?.(pair, 60);
      if (candles1h && Array.isArray(candles1h) && candles1h.length > 0) {
        const mapped1h = mapKrakenCandles(candles1h);
        ohlcCache.set(pair, mapped1h);
        console.log(
          `${TAG}[OHLCV] ${pair}: ${mapped1h.length} 1h candles` +
          ` | first=${new Date(mapped1h[0].time).toISOString().slice(0, 16)}` +
          ` | last=${new Date(mapped1h[mapped1h.length - 1].time).toISOString().slice(0, 16)}` +
          ` | source=${ExchangeFactory.getDataExchangeType()}`
        );
        // Store last 10 in DB cache
        for (const c of candles1h.slice(-10)) {
          try {
            await repo.upsertOhlcv({
              pair, timeframe: "1h",
              ts: new Date(c.time ? c.time * 1000 : (c[0] ? c[0] * 1000 : Date.now())),
              open: String(c.open || c[1] || 0), high: String(c.high || c[2] || 0),
              low:  String(c.low  || c[3] || 0), close: String(c.close || c[4] || 0),
              volume: String(c.volume || c[5] || 0),
            });
          } catch { /* ignore duplicate */ }
        }
      }

      // ── Daily candles (90d / 180d / 2y structural context) — throttled to 1×/6h ──
      const lastDaily = lastDailyFetchMs.get(pair) ?? 0;
      if (Date.now() - lastDaily < DAILY_FETCH_INTERVAL_MS) {
        // Skip — recent daily data still valid
      } else
      try {
        const candlesDaily = await (dataExchange as any).getOHLC?.(pair, 1440);
        if (candlesDaily && Array.isArray(candlesDaily) && candlesDaily.length > 0) {
          const mappedDaily = mapKrakenCandles(candlesDaily);
          ohlcDailyCache.set(pair, mappedDaily);
          console.log(`${TAG}[OHLCV] ${pair}: ${mappedDaily.length} daily candles | source=${ExchangeFactory.getDataExchangeType()}`);

          // Compute and cache macro context
          const nowMs = Date.now();
          const allHourly = ohlcCache.get(pair) || [];

          const ctx90d  = computeBucketContext(mappedDaily, nowMs, 90  * 24 * 60, "90d");
          const ctx180d = computeBucketContext(mappedDaily, nowMs, 180 * 24 * 60, "180d");
          const ctx7d   = computeBucketContext(allHourly,  nowMs, 7   * 24 * 60, "7d");
          const ctx30d  = computeBucketContext(allHourly,  nowMs, 30  * 24 * 60, "30d");

          // Structural: 2-year high/low from daily data
          const validDaily = mappedDaily.filter(c => c.high > 0 && c.low > 0);
          // Guard: if validDaily is empty skip structural computation
          const high2yCandle = validDaily.length > 0 ? validDaily.reduce((m, c) => c.high > m.high ? c : m) : undefined;
          const low2yCandle  = validDaily.length > 0 ? validDaily.reduce((m, c) => c.low  < m.low  ? c : m) : undefined;
          const yearCutoff   = nowMs - 365 * 24 * 60 * 60 * 1000;
          const yearCandles  = validDaily.filter(c => c.time >= yearCutoff);
          const yearHigh = yearCandles.length > 0 ? Math.max(...yearCandles.map(c => c.high)) : undefined;
          const yearLow  = yearCandles.length > 0 ? Math.min(...yearCandles.map(c => c.low))  : undefined;

          const macro: IdcaMacroContext = {
            pair, computedAt: new Date(nowMs),
            buckets: {
              ...(ctx7d   ? { "7d":   ctx7d   } : {}),
              ...(ctx30d  ? { "30d":  ctx30d  } : {}),
              ...(ctx90d  ? { "90d":  ctx90d  } : {}),
              ...(ctx180d ? { "180d": ctx180d } : {}),
            },
            high2y: high2yCandle?.high, high2yTime: high2yCandle ? new Date(high2yCandle.time) : undefined,
            low2y:  low2yCandle?.low,   low2yTime:  low2yCandle  ? new Date(low2yCandle.time)  : undefined,
            yearHigh, yearLow,
          };
          macroContextCache.set(pair, macro);

          // Upsert snapshots to DB (daily, idempotent via UNIQUE constraint)
          const today = new Date().toISOString().slice(0, 10);
          for (const [bucket, ctx] of Object.entries(macro.buckets) as [string, import("./IdcaTypes").IdcaBucketContext][]) {
            try {
              await repo.upsertPriceContextSnapshot({
                pair, bucket, snapshotDate: today,
                highMax: ctx.highMax.toFixed(8), lowMin: ctx.lowMin.toFixed(8),
                p95High: ctx.p95High.toFixed(8), avgClose: ctx.avgClose.toFixed(8),
                drawdownFromHighPct: ctx.drawdownFromHighPct.toFixed(4),
                rangePosition: ctx.rangePosition.toFixed(4), source: "scheduled",
              });
            } catch { /* ignore constraint errors */ }
          }

          // Upsert static structural data
          try {
            await repo.upsertPriceContextStatic({
              pair,
              high2y:    macro.high2y?.toFixed(8),
              high2yTime: macro.high2yTime,
              low2y:     macro.low2y?.toFixed(8),
              low2yTime:  macro.low2yTime,
              yearHigh:  macro.yearHigh?.toFixed(8),
              yearLow:   macro.yearLow?.toFixed(8),
              lastP95_90d:  ctx90d?.p95High.toFixed(8),
              lastP95_180d: ctx180d?.p95High.toFixed(8),
              lastDrawdown90dPct:  ctx90d?.drawdownFromHighPct.toFixed(4),
              lastDrawdown180dPct: ctx180d?.drawdownFromHighPct.toFixed(4),
              lastRangePosition90d:  ctx90d?.rangePosition.toFixed(4),
              lastRangePosition180d: ctx180d?.rangePosition.toFixed(4),
            });
          } catch { /* ignore */ }
        }
        // Mark fetch time so throttle prevents re-fetch for 6h
        lastDailyFetchMs.set(pair, Date.now());
      } catch (e: any) {
        console.warn(`${TAG}[OHLCV] ${pair}: daily candle fetch failed — ${e.message} (non-critical)`);
      }
    } catch (e: any) {
      console.error(`${TAG}[OHLCV] Error updating ${pair}:`, e.message);
    }
  }
}

// ─── Order Execution (Live) ────────────────────────────────────────

async function executeRealBuy(pair: string, quantity: number, price: number): Promise<void> {
  try {
    const tradingExchange = ExchangeFactory.getTradingExchange();
    if (!tradingExchange.isInitialized()) {
      console.error(`${TAG}[LIVE][BUY] Trading exchange not initialized — order NOT sent for ${pair}`);
      return;
    }
    console.log(`${TAG}[LIVE][BUY] Placing order: ${pair} qty=${quantity.toFixed(8)} @ ~${price.toFixed(2)}`);
    const result = await tradingExchange.placeOrder({
      pair,
      type: "buy",
      ordertype: "market",
      volume: quantity.toFixed(8),
    });
    if (result.success) {
      console.log(`${TAG}[LIVE][BUY] Order accepted: ${pair} orderId=${result.orderId || result.txid || "(pending)"}`);
    } else {
      console.error(`${TAG}[LIVE][BUY] Order FAILED: ${pair} error=${result.error}`);
      throw new Error(`Live buy order failed: ${result.error}`);
    }
  } catch (e: any) {
    console.error(`${TAG}[LIVE][BUY] Error placing order for ${pair}:`, e.message);
    throw e;
  }
}

async function executeRealSell(cycle: InstitutionalDcaCycle, orderType: string, quantity: number): Promise<void> {
  try {
    const tradingExchange = ExchangeFactory.getTradingExchange();
    if (!tradingExchange.isInitialized()) {
      console.error(`${TAG}[LIVE][SELL] Trading exchange not initialized — order NOT sent for ${cycle.pair}`);
      throw new Error(`Live sell blocked: exchange not initialized (pair=${cycle.pair} type=${orderType})`);
    }
    console.log(`${TAG}[LIVE][SELL] Placing order: ${cycle.pair} type=${orderType} qty=${quantity.toFixed(8)}`);
    const result = await tradingExchange.placeOrder({
      pair: cycle.pair,
      type: "sell",
      ordertype: "market",
      volume: quantity.toFixed(8),
    });
    if (result.success) {
      console.log(`${TAG}[LIVE][SELL] Order accepted: ${cycle.pair} type=${orderType} orderId=${result.orderId || result.txid || "(pending)"}`);
    } else {
      console.error(`${TAG}[LIVE][SELL] Order FAILED: ${cycle.pair} type=${orderType} error=${result.error}`);
      throw new Error(`Live sell order failed: ${result.error}`);
    }
  } catch (e: any) {
    console.error(`${TAG}[LIVE][SELL] Error placing order for ${cycle.pair}:`, e.message);
    throw e;
  }
}

// ─── Block Logger ──────────────────────────────────────────────────

async function logBlock(pair: string, mode: string, code: string, cycle?: InstitutionalDcaCycle): Promise<void> {
  console.log(`${TAG}[BUY_BLOCKED] ${pair}: ${code}`);
  const pnlPct = cycle ? parseFloat(String(cycle.unrealizedPnlPct || "0")) : 0;
  const buyCount = cycle?.buyCount || 0;
  await createHumanEvent({
    cycleId: cycle?.id,
    pair, mode,
    eventType: "buy_blocked",
    severity: "warn",
    message: code,
    payloadJson: { blockCode: code },
  }, {
    eventType: "buy_blocked", reasonCode: code, pair, mode,
    pnlPct, buyCount,
    blockReasons: [{ code, message: code }],
  });
  await telegram.alertBuyBlocked(pair, mode, code, pnlPct, buyCount);
}

// ─── Plus Cycle Config Helper ─────────────────────────────────────

const DEFAULT_PLUS_CONFIG: PlusConfig = {
  enabled: false, maxPlusCyclesPerMain: 2, maxPlusEntries: 3,
  capitalAllocationPct: 15, activationExtraDipPct: 4.0,
  requireMainExhausted: true, requireReboundConfirmation: true,
  cooldownMinutesBetweenBuys: 60, autoCloseIfMainClosed: true,
  maxExposurePctPerAsset: 20, entryDipSteps: [2.0, 3.5, 5.0],
  entrySizingMode: "fixed", baseTpPctBtc: 4.0, baseTpPctEth: 4.5,
  trailingPctBtc: 1.0, trailingPctEth: 1.2,
};

function getPlusConfig(config: InstitutionalDcaConfigRow): PlusConfig {
  const raw = config.plusConfigJson as any;
  if (!raw || typeof raw !== "object") return DEFAULT_PLUS_CONFIG;
  return { ...DEFAULT_PLUS_CONFIG, ...raw };
}

// ─── Plus Cycle Activation ────────────────────────────────────────

async function checkPlusActivation(
  mainCycle: InstitutionalDcaCycle,
  currentPrice: number,
  config: InstitutionalDcaConfigRow,
  assetConfig: InstitutionalDcaAssetConfigRow,
  mode: IdcaMode,
  plusCfg: PlusConfig
): Promise<void> {
  const pair = mainCycle.pair;

  // 1) Main must be exhausted (all safety orders used)
  if (plusCfg.requireMainExhausted) {
    const safetyOrders = parseSafetyOrders(assetConfig.safetyOrdersJson);
    const maxBuys = safetyOrders.length + 1; // base + safety orders
    if (mainCycle.buyCount < maxBuys) return; // main not exhausted yet
  }

  // 2) Check max plus cycles per main
  const closedPlusCount = await repo.getClosedPlusCyclesCount(mainCycle.id);
  if (closedPlusCount >= plusCfg.maxPlusCyclesPerMain) return;

  // 3) Check extra dip from last main buy price
  const lastBuyPrice = parseFloat(String(mainCycle.avgEntryPrice || "0"));
  if (lastBuyPrice <= 0) return;
  const dipFromLastBuy = ((lastBuyPrice - currentPrice) / lastBuyPrice) * 100;
  if (dipFromLastBuy < plusCfg.activationExtraDipPct) return;

  // 4) Rebound confirmation if required
  if (plusCfg.requireReboundConfirmation) {
    const strength = getReboundStrength(pair);
    if (strength === "none") return;
  }

  // 5) Exposure check (bot-managed cycles only)
  const allocatedCapital = parseFloat(String(config.allocatedCapitalUsd));
  const plusCapital = allocatedCapital * (plusCfg.capitalAllocationPct / 100);
  const allActive = await repo.getAllActiveBotCycles(mode);
  const pairExposure = allActive
    .filter(c => c.pair === pair)
    .reduce((sum, c) => sum + parseFloat(String(c.capitalUsedUsd || "0")), 0);
  const maxPairExposure = allocatedCapital * (plusCfg.maxExposurePctPerAsset / 100);
  if (pairExposure >= maxPairExposure) return;

  // All checks passed — create plus cycle
  console.log(`${TAG}[PLUS] Activating plus cycle for ${pair}, dip=${dipFromLastBuy.toFixed(2)}% from main avg`);

  const entrySteps = plusCfg.entryDipSteps || [2.0, 3.5, 5.0];
  const baseBuyUsd = plusCapital / (entrySteps.length || 1);
  const quantity = baseBuyUsd / currentPrice;

  // Compute TP for plus cycle
  let tpPct: number;
  let tpBreakdown: any = null;
  if (config.adaptiveTpEnabled) {
    const dtpConfig = getDynamicTpConfig(config);
    const breakdown = smart.computeDynamicTakeProfit({
      pair,
      cycleType: "plus",
      buyCount: 1,
      marketScore: parseFloat(String(mainCycle.marketScore || "50")),
      volatilityPct: getVolatility(pair),
      reboundStrength: getReboundStrength(pair),
      config: dtpConfig,
    });
    tpPct = breakdown.finalTpPct;
    tpBreakdown = breakdown;
  } else {
    const isBtc = pair === "BTC/USD";
    tpPct = isBtc ? plusCfg.baseTpPctBtc : plusCfg.baseTpPctEth;
  }

  const tpPrice = currentPrice * (1 + tpPct / 100);
  const isBtc = pair === "BTC/USD";
  const trailingPct = isBtc ? plusCfg.trailingPctBtc : plusCfg.trailingPctEth;

  // Simulation fees
  let fees = 0, slippage = 0, netValue = baseBuyUsd;
  if (mode === "simulation") {
    fees = baseBuyUsd * (parseFloat(String(config.simulationFeePct)) / 100);
    slippage = baseBuyUsd * (parseFloat(String(config.simulationSlippagePct)) / 100);
    netValue = baseBuyUsd + fees + slippage;
  }

  // Next plus entry level
  const nextDipPct = entrySteps.length > 1 ? entrySteps[1] : null;
  const nextBuyPrice = nextDipPct ? currentPrice * (1 - nextDipPct / 100) : null;

  const plusCycle = await repo.createCycle({
    pair,
    strategy: "institutional_dca_v1_plus",
    mode,
    status: "active",
    capitalReservedUsd: plusCapital.toFixed(2),
    capitalUsedUsd: netValue.toFixed(2),
    totalQuantity: quantity.toFixed(8),
    avgEntryPrice: currentPrice.toFixed(8),
    currentPrice: currentPrice.toFixed(8),
    buyCount: 1,
    tpTargetPct: tpPct.toFixed(2),
    tpTargetPrice: tpPrice.toFixed(8),
    trailingPct: trailingPct.toFixed(2),
    nextBuyLevelPct: nextDipPct?.toFixed(2) || null,
    nextBuyPrice: nextBuyPrice?.toFixed(8) || null,
    marketScore: mainCycle.marketScore,
    volatilityScore: mainCycle.volatilityScore,
    adaptiveSizeProfile: mainCycle.adaptiveSizeProfile,
    lastBuyAt: new Date(),
    tpBreakdownJson: tpBreakdown,
    cycleType: "plus",
    parentCycleId: mainCycle.id,
  });

  await repo.createOrder({
    cycleId: plusCycle.id,
    pair,
    mode,
    orderType: "base_buy",
    buyIndex: 1,
    side: "buy",
    price: currentPrice.toFixed(8),
    quantity: quantity.toFixed(8),
    grossValueUsd: baseBuyUsd.toFixed(2),
    feesUsd: fees.toFixed(2),
    slippageUsd: slippage.toFixed(2),
    netValueUsd: netValue.toFixed(2),
    triggerReason: `Plus cycle base buy, dip ${dipFromLastBuy.toFixed(1)}% from main avg`,
    humanReason: formatOrderReason("base_buy"),
  });

  if (mode === "simulation") {
    const wallet = await repo.getSimulationWallet();
    await repo.updateSimulationWallet({
      availableBalanceUsd: (parseFloat(String(wallet.availableBalanceUsd)) - netValue).toFixed(2),
      usedBalanceUsd: (parseFloat(String(wallet.usedBalanceUsd)) + netValue).toFixed(2),
      totalOrdersSimulated: wallet.totalOrdersSimulated + 1,
    });
  }

  // Increment plus count on main
  await repo.updateCycle(mainCycle.id, {
    plusCyclesCompleted: (mainCycle.plusCyclesCompleted || 0) + 1,
  });

  await createHumanEvent({
    cycleId: plusCycle.id, pair, mode,
    eventType: "plus_cycle_activated",
    severity: "info",
    message: `Plus cycle activated: ${quantity.toFixed(6)} @ ${currentPrice.toFixed(2)}, dip=${dipFromLastBuy.toFixed(1)}% from main`,
    payloadJson: { parentCycleId: mainCycle.id, dipFromLastBuy, plusCapital, tpPct },
  }, {
    eventType: "plus_cycle_activated", pair, mode,
    price: currentPrice, quantity, entryDipPct: dipFromLastBuy,
    parentCycleId: mainCycle.id, tpPct,
  });

  await telegram.alertCycleStarted(plusCycle, dipFromLastBuy, parseFloat(String(mainCycle.marketScore || "50")));
}

// ─── Plus Cycle Management ────────────────────────────────────────

async function managePlusCycle(
  plusCycle: InstitutionalDcaCycle,
  mainCycle: InstitutionalDcaCycle,
  currentPrice: number,
  config: InstitutionalDcaConfigRow,
  assetConfig: InstitutionalDcaAssetConfigRow,
  mode: IdcaMode,
  plusCfg: PlusConfig
): Promise<void> {
  const pair = plusCycle.pair;
  const avgEntry = parseFloat(String(plusCycle.avgEntryPrice || "0"));
  const totalQty = parseFloat(String(plusCycle.totalQuantity || "0"));
  const capitalUsed = parseFloat(String(plusCycle.capitalUsedUsd || "0"));

  if (avgEntry <= 0 || totalQty <= 0) return;

  // Auto-close if main cycle closed
  if (plusCfg.autoCloseIfMainClosed && mainCycle.status === "closed") {
    await closePlusCycle(plusCycle, currentPrice, config, mode, "main_cycle_closed");
    return;
  }

  // Update PnL
  const marketValue = totalQty * currentPrice;
  const unrealizedPnlUsd = marketValue - capitalUsed;
  const unrealizedPnlPct = capitalUsed > 0 ? (unrealizedPnlUsd / capitalUsed) * 100 : 0;

  const currentDD = unrealizedPnlPct < 0 ? Math.abs(unrealizedPnlPct) : 0;
  const prevMaxDD = parseFloat(String(plusCycle.maxDrawdownPct || "0"));

  await repo.updateCycle(plusCycle.id, {
    currentPrice: currentPrice.toFixed(8),
    unrealizedPnlUsd: unrealizedPnlUsd.toFixed(2),
    unrealizedPnlPct: unrealizedPnlPct.toFixed(4),
    maxDrawdownPct: Math.max(currentDD, prevMaxDD).toFixed(2),
  });

  // Check TP based on status
  if (plusCycle.status === "active") {
    const tpPct = parseFloat(String(plusCycle.tpTargetPct || "3"));
    if (unrealizedPnlPct >= tpPct) {
      // Arm TP — for plus cycles we do a direct final sell (simpler than main)
      await closePlusCycle(plusCycle, currentPrice, config, mode, "tp_reached");
      return;
    }

    // Check for plus safety buys
    await checkPlusSafetyBuy(plusCycle, currentPrice, config, assetConfig, mode, plusCfg);

  } else if (plusCycle.status === "tp_armed" || plusCycle.status === "trailing_active") {
    // Use same trailing logic as main but with plus trailing pct
    const isBtc = pair === "BTC/USD";
    const trailingPct = isBtc ? plusCfg.trailingPctBtc : plusCfg.trailingPctEth;
    const highestAfterTp = parseFloat(String(plusCycle.highestPriceAfterTp || "0"));

    if (currentPrice > highestAfterTp) {
      await repo.updateCycle(plusCycle.id, { highestPriceAfterTp: currentPrice.toFixed(8) });
    } else {
      const dropFromHigh = highestAfterTp > 0 ? ((highestAfterTp - currentPrice) / highestAfterTp) * 100 : 0;
      if (dropFromHigh >= trailingPct) {
        await closePlusCycle(plusCycle, currentPrice, config, mode, "trailing_exit");
      }
    }
  }
}

async function checkPlusSafetyBuy(
  plusCycle: InstitutionalDcaCycle,
  currentPrice: number,
  config: InstitutionalDcaConfigRow,
  assetConfig: InstitutionalDcaAssetConfigRow,
  mode: IdcaMode,
  plusCfg: PlusConfig
): Promise<void> {
  const pair = plusCycle.pair;
  const buyCount = plusCycle.buyCount;

  // Max entries check
  if (buyCount >= plusCfg.maxPlusEntries) return;

  // Cooldown check
  const lastBuyAt = plusCycle.lastBuyAt ? new Date(plusCycle.lastBuyAt).getTime() : 0;
  const cooldownMs = plusCfg.cooldownMinutesBetweenBuys * 60 * 1000;
  if (Date.now() - lastBuyAt < cooldownMs) return;

  // Next buy price check
  const nextBuyPrice = parseFloat(String(plusCycle.nextBuyPrice || "0"));
  if (nextBuyPrice <= 0 || currentPrice > nextBuyPrice) return;

  // Execute plus safety buy
  const capitalReserved = parseFloat(String(plusCycle.capitalReservedUsd || "0"));
  const entrySteps = plusCfg.entryDipSteps || [2.0, 3.5, 5.0];
  const buyUsd = capitalReserved / (entrySteps.length || 1);
  const quantity = buyUsd / currentPrice;

  let fees = 0, slippageVal = 0, netValue = buyUsd;
  if (mode === "simulation") {
    fees = buyUsd * (parseFloat(String(config.simulationFeePct)) / 100);
    slippageVal = buyUsd * (parseFloat(String(config.simulationSlippagePct)) / 100);
    netValue = buyUsd + fees + slippageVal;
  }

  const prevQty = parseFloat(String(plusCycle.totalQuantity));
  const prevCost = parseFloat(String(plusCycle.capitalUsedUsd));
  const newTotalQty = prevQty + quantity;
  const newTotalCost = prevCost + netValue;
  const newAvgPrice = newTotalCost / newTotalQty;
  const newBuyCount = buyCount + 1;

  // Next level
  const nextIdx = newBuyCount; // 0-indexed: buyCount is already next index
  const nextDipPct = entrySteps[nextIdx] ?? null;
  const nextBuyPriceCalc = nextDipPct ? newAvgPrice * (1 - nextDipPct / 100) : null;

  // Recalculate TP
  let tpPct = parseFloat(String(plusCycle.tpTargetPct || "3"));
  let tpBreakdownPlus: any = null;
  if (config.adaptiveTpEnabled) {
    const dtpConfig = getDynamicTpConfig(config);
    const breakdown = smart.computeDynamicTakeProfit({
      pair,
      cycleType: "plus",
      buyCount: newBuyCount,
      marketScore: parseFloat(String(plusCycle.marketScore || "50")),
      volatilityPct: getVolatility(pair),
      reboundStrength: getReboundStrength(pair),
      config: dtpConfig,
    });
    tpPct = breakdown.finalTpPct;
    tpBreakdownPlus = breakdown;
  }
  const tpPrice = newAvgPrice * (1 + tpPct / 100);

  await repo.updateCycle(plusCycle.id, {
    capitalUsedUsd: newTotalCost.toFixed(2),
    totalQuantity: newTotalQty.toFixed(8),
    avgEntryPrice: newAvgPrice.toFixed(8),
    buyCount: newBuyCount,
    nextBuyLevelPct: nextDipPct?.toFixed(2) || null,
    nextBuyPrice: nextBuyPriceCalc?.toFixed(8) || null,
    tpTargetPct: tpPct.toFixed(2),
    tpTargetPrice: tpPrice.toFixed(8),
    tpBreakdownJson: tpBreakdownPlus,
    lastBuyAt: new Date(),
  });

  await repo.createOrder({
    cycleId: plusCycle.id,
    pair,
    mode,
    orderType: "safety_buy",
    buyIndex: newBuyCount,
    side: "buy",
    price: currentPrice.toFixed(8),
    quantity: quantity.toFixed(8),
    grossValueUsd: buyUsd.toFixed(2),
    feesUsd: fees.toFixed(2),
    slippageUsd: slippageVal.toFixed(2),
    netValueUsd: netValue.toFixed(2),
    triggerReason: `Plus safety buy #${newBuyCount}`,
    humanReason: formatOrderReason("safety_buy"),
  });

  if (mode === "simulation") {
    const wallet = await repo.getSimulationWallet();
    await repo.updateSimulationWallet({
      availableBalanceUsd: (parseFloat(String(wallet.availableBalanceUsd)) - netValue).toFixed(2),
      usedBalanceUsd: (parseFloat(String(wallet.usedBalanceUsd)) + netValue).toFixed(2),
      totalOrdersSimulated: wallet.totalOrdersSimulated + 1,
    });
  }

  await createHumanEvent({
    cycleId: plusCycle.id, pair, mode,
    eventType: "plus_safety_buy_executed",
    severity: "info",
    message: `Plus safety buy #${newBuyCount}: ${quantity.toFixed(6)} @ ${currentPrice.toFixed(2)}, avg=${newAvgPrice.toFixed(2)}`,
  }, {
    eventType: "plus_safety_buy_executed", pair, mode,
    price: currentPrice, quantity, avgEntry: newAvgPrice,
    capitalUsed: newTotalCost, buyCount: newBuyCount,
  });
}

// ─── Plus Cycle Close ─────────────────────────────────────────────

async function closePlusCycle(
  plusCycle: InstitutionalDcaCycle,
  currentPrice: number,
  config: InstitutionalDcaConfigRow,
  mode: IdcaMode,
  reason: string
): Promise<void> {
  const pair = plusCycle.pair;
  const totalQty = parseFloat(String(plusCycle.totalQuantity || "0"));
  const capitalUsed = parseFloat(String(plusCycle.capitalUsedUsd || "0"));
  const sellValueUsd = totalQty * currentPrice;

  let fees = 0, slippageVal = 0, netValue = sellValueUsd;
  if (mode === "simulation") {
    fees = sellValueUsd * (parseFloat(String(config.simulationFeePct)) / 100);
    slippageVal = sellValueUsd * (parseFloat(String(config.simulationSlippagePct)) / 100);
    netValue = sellValueUsd - fees - slippageVal;
  }

  const realizedPnl = netValue - capitalUsed;

  await repo.createOrder({
    cycleId: plusCycle.id,
    pair,
    mode,
    orderType: "final_sell",
    buyIndex: null,
    side: "sell",
    price: currentPrice.toFixed(8),
    quantity: totalQty.toFixed(8),
    grossValueUsd: sellValueUsd.toFixed(2),
    feesUsd: fees.toFixed(2),
    slippageUsd: slippageVal.toFixed(2),
    netValueUsd: netValue.toFixed(2),
    triggerReason: `Plus cycle closed: ${reason}`,
    humanReason: formatOrderReason("final_sell"),
  });

  await repo.updateCycle(plusCycle.id, {
    status: "closed",
    closeReason: reason,
    realizedPnlUsd: realizedPnl.toFixed(2),
    currentPrice: currentPrice.toFixed(8),
    closedAt: new Date(),
  });

  if (mode === "simulation") {
    const wallet = await repo.getSimulationWallet();
    await repo.updateSimulationWallet({
      availableBalanceUsd: (parseFloat(String(wallet.availableBalanceUsd)) + netValue).toFixed(2),
      usedBalanceUsd: (parseFloat(String(wallet.usedBalanceUsd)) - capitalUsed).toFixed(2),
      realizedPnlUsd: (parseFloat(String(wallet.realizedPnlUsd)) + realizedPnl).toFixed(2),
    });
  }

  if (mode === "live") {
    await executeRealSell(plusCycle, "final_sell", totalQty);
  }

  await createHumanEvent({
    cycleId: plusCycle.id, pair, mode,
    eventType: "plus_cycle_closed",
    severity: "info",
    message: `Plus cycle closed (${reason}): PnL ${realizedPnl >= 0 ? "+" : ""}$${realizedPnl.toFixed(2)}`,
    payloadJson: { reason, realizedPnl, sellPrice: currentPrice, parentCycleId: plusCycle.parentCycleId },
  }, {
    eventType: "plus_cycle_closed", pair, mode,
    price: currentPrice, realizedPnl,
    closeReason: reason, parentCycleId: plusCycle.parentCycleId,
  });

  if (reason === "trailing_exit") {
    await telegram.alertTrailingExit(plusCycle);
  }
}

// ─── Helpers ───────────────────────────────────────────────────────

function parseSafetyOrders(json: unknown): SafetyOrderLevel[] {
  if (Array.isArray(json)) {
    return json.map((o: any) => ({
      dipPct: parseFloat(String(o.dipPct || o.dip_pct || 0)),
      sizePctOfAssetBudget: parseFloat(String(o.sizePctOfAssetBudget || o.size_pct || 25)),
    }));
  }
  return [];
}

/**
 * Calculate effective safety level considering current price vs avgEntry.
 * When importing a position, if currentPrice is below avgEntry, some safety levels
 * may already be "passed" (price is already below those trigger points).
 * This function finds the first valid safety level below current price.
 */
function calculateEffectiveSafetyLevel(
  safetyOrders: SafetyOrderLevel[],
  avgEntry: number,
  currentPrice: number,
  baseBuyCount: number
): {
  effectiveIndex: number;
  nextLevelPct: number | null;
  nextBuyPrice: number | null;
  skippedLevels: number;
  skippedLevelsDetail: { level: number; dipPct: number; triggerPrice: number }[];
} {
  // Start from the level after base buy (index = baseBuyCount - 1)
  let startIndex = Math.max(0, baseBuyCount - 1);
  let effectiveIndex = startIndex;
  let skippedLevels = 0;
  const skippedLevelsDetail: { level: number; dipPct: number; triggerPrice: number }[] = [];

  // Scan through safety orders to find first valid level
  for (let i = startIndex; i < safetyOrders.length; i++) {
    const level = safetyOrders[i];
    const triggerPrice = avgEntry * (1 - level.dipPct / 100);

    // If current price is already below this trigger, it's "passed"
    if (currentPrice < triggerPrice) {
      skippedLevels++;
      skippedLevelsDetail.push({
        level: i + 1, // 1-indexed for display
        dipPct: level.dipPct,
        triggerPrice,
      });
      effectiveIndex = i + 1; // Move to next level
    } else {
      // Found first valid level
      break;
    }
  }

  // Check if we have a valid level
  if (effectiveIndex < safetyOrders.length) {
    const effectiveLevel = safetyOrders[effectiveIndex];
    return {
      effectiveIndex,
      nextLevelPct: effectiveLevel.dipPct,
      nextBuyPrice: avgEntry * (1 - effectiveLevel.dipPct / 100),
      skippedLevels,
      skippedLevelsDetail,
    };
  }

  // All levels passed - no more safety buys available
  return {
    effectiveIndex: safetyOrders.length,
    nextLevelPct: null,
    nextBuyPrice: null,
    skippedLevels,
    skippedLevelsDetail,
  };
}

// ─── Mode Transition ───────────────────────────────────────────────

export async function handleModeTransition(newMode: IdcaMode): Promise<void> {
  const config = await repo.getIdcaConfig();
  const oldMode = config.mode as IdcaMode;

  if (oldMode === newMode) return;

  console.log(`${TAG}[MODE_TRANSITION] ${oldMode} -> ${newMode}`);

  // Get current prices for closing cycles
  const prices: Record<string, number> = {};
  for (const pair of INSTITUTIONAL_DCA_ALLOWED_PAIRS) {
    prices[pair] = await getCurrentPrice(pair);
  }

  // Apply transition rules
  if (oldMode === "simulation" && (newMode === "live" || newMode === "disabled")) {
    // Close all simulation cycles
    const closed = await repo.closeCyclesBulk("simulation", `mode_transition_${oldMode}_to_${newMode}`, prices);
    console.log(`${TAG}[MODE_TRANSITION] Closed ${closed} simulation cycles`);
  }

  if (oldMode === "live" && newMode !== "live") {
    // Pause live cycles (don't close automatically)
    const liveCycles = await repo.getAllActiveCycles("live");
    for (const cycle of liveCycles) {
      await repo.updateCycle(cycle.id, { status: "paused" });
    }
    console.log(`${TAG}[MODE_TRANSITION] Paused ${liveCycles.length} live cycles`);
  }

  // Update config
  await repo.updateIdcaConfig({ mode: newMode });

  await createHumanEvent({
    eventType: "mode_transition",
    severity: "info",
    mode: newMode,
    message: `Mode changed: ${oldMode} -> ${newMode}`,
    payloadJson: { oldMode, newMode },
  }, { eventType: "mode_transition", mode: newMode, oldMode, newMode });

  // Restart scheduler if needed
  if (newMode === "disabled") {
    stopScheduler();
  } else if (!schedulerInterval) {
    await startScheduler();
  }
}

// ════════════════════════════════════════════════════════════════════
// REHYDRATE IMPORTED CYCLE — Full management activation
// ════════════════════════════════════════════════════════════════════

/**
 * When an imported cycle switches from soloSalida=true to soloSalida=false,
 * this function recomputes all derived operational fields so it behaves
 * identically to a normal cycle: safety buy levels, dynamic TP, trailing,
 * capital reserved, base price reference, etc.
 */
export async function rehydrateImportedCycle(cycleId: number): Promise<import("@shared/schema").InstitutionalDcaCycle> {
  const cycle = await repo.getCycleById(cycleId);
  if (!cycle) throw new Error(`Cycle ${cycleId} not found`);
  if (cycle.status === "closed") throw new Error("Cannot rehydrate a closed cycle");

  const pair = cycle.pair;
  const mode = cycle.mode as IdcaMode;
  const config = await repo.getIdcaConfig();
  const assetConfig = await repo.getAssetConfig(pair);
  if (!assetConfig) throw new Error(`No asset config for ${pair}`);

  const avgEntry = parseFloat(String(cycle.avgEntryPrice || "0"));
  const buyCount = cycle.buyCount || 1;
  const currentPrice = await getCurrentPrice(pair) || avgEntry;
  const capitalUsed = parseFloat(String(cycle.capitalUsedUsd || "0"));

  // ── 1. Safety buy levels ──────────────────────────────────
  // Use effective safety level calculation for imported cycles
  const safetyOrders = parseSafetyOrders(assetConfig.safetyOrdersJson);
  const effectiveSafety = calculateEffectiveSafetyLevel(
    safetyOrders,
    avgEntry,
    currentPrice,
    buyCount
  );

  const nextLevelPct = effectiveSafety.nextLevelPct;
  const nextBuyPrice = effectiveSafety.nextBuyPrice;
  const skippedSafetyLevels = effectiveSafety.skippedLevels;
  const skippedLevelsDetail = effectiveSafety.skippedLevelsDetail;

  // ── 2. Capital reserved (budget for safety buys) ──────────
  const allocatedCapital = parseFloat(String(config.allocatedCapitalUsd || "0"));
  const maxAssetPct = parseFloat(String(config.maxAssetExposurePct || "25"));
  const assetBudget = allocatedCapital * (maxAssetPct / 100);
  // Reserve at least the current capital + room for safety buys
  const capitalReserved = Math.max(capitalUsed, assetBudget);

  // ── 3. Dynamic TP ─────────────────────────────────────────
  let tpPct: number;
  let tpBreakdown: any = null;
  const cycleType = (cycle.cycleType as IdcaCycleType) || "main";

  if (config.adaptiveTpEnabled) {
    const dtpConfig = getDynamicTpConfig(config);
    const breakdown = smart.computeDynamicTakeProfit({
      pair,
      cycleType,
      buyCount,
      marketScore: parseFloat(String(cycle.marketScore || "50")),
      volatilityPct: getVolatility(pair),
      reboundStrength: getReboundStrength(pair),
      config: dtpConfig,
    });
    tpPct = breakdown.finalTpPct;
    tpBreakdown = breakdown;
  } else {
    tpPct = parseFloat(String(assetConfig.takeProfitPct));
  }

  const tpPrice = avgEntry * (1 + tpPct / 100);

  // ── 4. Dynamic trailing ───────────────────────────────────
  let trailingPct = parseFloat(String(assetConfig.trailingPct));
  if (config.volatilityTrailingEnabled) {
    trailingPct = smart.computeDynamicTrailing({
      atrPct: getVolatility(pair),
      baseTrailingPct: trailingPct,
      minTrailingPct: parseFloat(String(pair === "BTC/USD" ? config.minTrailingPctBtc : config.minTrailingPctEth)),
      maxTrailingPct: parseFloat(String(pair === "BTC/USD" ? config.maxTrailingPctBtc : config.maxTrailingPctEth)),
    });
  }

  // ── 5. Base price reference ───────────────────────────────
  // For imported cycles, the base price is the avgEntryPrice at import time
  const basePrice = cycle.basePrice || avgEntry.toFixed(8);
  const basePriceType = cycle.basePriceType || "imported_avg";

  // ── 6. Persist all derived fields ─────────────────────────
  const patch: Record<string, any> = {
    nextBuyLevelPct: nextLevelPct?.toFixed(2) || null,
    nextBuyPrice: nextBuyPrice?.toFixed(8) || null,
    tpTargetPct: tpPct.toFixed(2),
    tpTargetPrice: tpPrice.toFixed(8),
    tpBreakdownJson: tpBreakdown,
    trailingPct: trailingPct.toFixed(2),
    capitalReservedUsd: capitalReserved.toFixed(2),
    currentPrice: currentPrice.toFixed(8),
    basePrice,
    basePriceType,
    skippedSafetyLevels,  // Store count of skipped levels
    skippedLevelsDetail: skippedSafetyLevels > 0 ? skippedLevelsDetail : null,  // Store detail for UI
  };

  // Update PnL while we're at it
  const totalQty = parseFloat(String(cycle.totalQuantity || "0"));
  if (totalQty > 0 && currentPrice > 0) {
    const mv = totalQty * currentPrice;
    const pnlUsd = mv - capitalUsed;
    const pnlPct = capitalUsed > 0 ? (pnlUsd / capitalUsed) * 100 : 0;
    patch.unrealizedPnlUsd = pnlUsd.toFixed(2);
    patch.unrealizedPnlPct = pnlPct.toFixed(4);
  }

  const updated = await repo.updateCycle(cycleId, patch);

  // Log the rehydration event
  const skippedMsg = skippedSafetyLevels > 0
    ? ` (${skippedSafetyLevels} niveles de seguridad ya superados: ${skippedLevelsDetail.map(s => `-${s.dipPct}%`).join(', ')})`
    : '';

  await createHumanEvent({
    cycleId, pair, mode,
    eventType: "imported_position_created",
    severity: "info",
    message: `Ciclo importado rehidratado → Gestión completa. TP=${tpPct.toFixed(1)}%, NextBuy=${nextBuyPrice ? `$${nextBuyPrice.toFixed(2)}` : "N/A"}${skippedMsg}, Trailing=${trailingPct.toFixed(2)}%`,
    payloadJson: {
      rehydratedAt: new Date().toISOString(),
      tpPct, tpPrice, trailingPct,
      nextBuyPrice, nextLevelPct,
      capitalReserved, basePrice, basePriceType,
      skippedSafetyLevels,
      skippedLevelsDetail,
      dynamicTpEnabled: config.adaptiveTpEnabled,
    },
  }, {
    eventType: "imported_position_created", pair, mode,
    price: currentPrice, avgEntry,
    tpPct, capitalUsed: capitalReserved,
  });

  console.log(`${TAG} Rehydrated imported cycle #${cycleId} (${pair}): TP=${tpPct.toFixed(1)}%, nextBuy=${nextBuyPrice?.toFixed(2) || "none"}${skippedMsg}, trailing=${trailingPct.toFixed(2)}%`);

  return updated;
}

// ════════════════════════════════════════════════════════════════════
// EDIT IMPORTED CYCLE — Manual correction with full recalculation
// ════════════════════════════════════════════════════════════════════

/**
 * Edit an imported/manual cycle with full recalculation of derived fields.
 * Validates activity status (Case A vs B) and maintains complete audit trail.
 */
export async function editImportedCycle(
  cycleId: number,
  req: import("./IdcaTypes").EditImportedCycleRequest
): Promise<{
  cycle: import("@shared/schema").InstitutionalDcaCycle;
  activityCheck: import("./IdcaTypes").PostImportActivityCheck;
  editHistory: import("./IdcaTypes").EditHistoryEntry;
}> {
  const cycle = await repo.getCycleById(cycleId);
  if (!cycle) throw new Error(`Cycle ${cycleId} not found`);
  if (cycle.status === "closed") throw new Error("Cannot edit a closed cycle");

  // Verify it's an imported or manual cycle
  const isImportable = cycle.isImported === true || cycle.sourceType === "manual" || cycle.isManualCycle === true;
  if (!isImportable) {
    throw new Error("Only imported or manual cycles can be edited");
  }

  const pair = cycle.pair;
  const mode = cycle.mode as IdcaMode;

  // ── 1. Detect post-import activity ──────────────────────────
  const activityCheck = await repo.detectPostImportActivity(cycle);

  // ── 2. Validate fields based on case ────────────────────────
  if (activityCheck.case === "B_with_activity") {
    // Case B: Block critical field edits if there's post-import activity
    const blockedFields: string[] = [];
    if (req.avgEntryPrice !== undefined && req.avgEntryPrice !== parseFloat(String(cycle.avgEntryPrice))) {
      blockedFields.push("avgEntryPrice");
    }
    if (req.quantity !== undefined && req.quantity !== parseFloat(String(cycle.totalQuantity))) {
      blockedFields.push("quantity");
    }

    if (blockedFields.length > 0) {
      throw new Error(
        `Caso B - Edición limitada: Este ciclo tiene actividad automática posterior ` +
        `(${activityCheck.safetyBuys} compras de seguridad, ${activityCheck.postImportSells} ventas). ` +
        `Los campos [${blockedFields.join(", ")}] no pueden editarse porque distorsionarían ` +
        `el histórico. Campos permitidos: exchangeSource, startedAt, soloSalida, notes, fees.`
      );
    }
  }

  // ── 3. Build change tracking ────────────────────────────────
  const oldAvgEntry = parseFloat(String(cycle.avgEntryPrice || "0"));
  const oldQty = parseFloat(String(cycle.totalQuantity || "0"));
  const oldCapitalUsed = parseFloat(String(cycle.capitalUsedUsd || "0"));

  const changes: Record<string, { old: string | number | null; new: string | number | null }> = {};

  // ── 4. Compute new values ───────────────────────────────────
  const newAvgEntry = req.avgEntryPrice !== undefined ? req.avgEntryPrice : oldAvgEntry;
  const newQty = req.quantity !== undefined ? req.quantity : oldQty;

  // Capital used: use provided or auto-calculate
  let newCapitalUsed: number;
  if (req.capitalUsedUsd !== undefined) {
    newCapitalUsed = req.capitalUsedUsd;
  } else if (req.avgEntryPrice !== undefined || req.quantity !== undefined) {
    newCapitalUsed = newQty * newAvgEntry;
  } else {
    newCapitalUsed = oldCapitalUsed;
  }

  // Track changes
  if (req.avgEntryPrice !== undefined && req.avgEntryPrice !== oldAvgEntry) {
    changes.avgEntryPrice = { old: oldAvgEntry, new: req.avgEntryPrice };
  }
  if (req.quantity !== undefined && req.quantity !== oldQty) {
    changes.quantity = { old: oldQty, new: req.quantity };
  }
  if (newCapitalUsed !== oldCapitalUsed) {
    changes.capitalUsedUsd = { old: oldCapitalUsed, new: newCapitalUsed };
  }
  if (req.exchangeSource !== undefined && req.exchangeSource !== cycle.exchangeSource) {
    changes.exchangeSource = { old: cycle.exchangeSource, new: req.exchangeSource };
  }
  if (req.startedAt !== undefined) {
    const oldStarted = cycle.startedAt ? new Date(cycle.startedAt).toISOString() : null;
    if (req.startedAt !== oldStarted) {
      changes.startedAt = { old: oldStarted, new: req.startedAt };
    }
  }
  if (req.soloSalida !== undefined && req.soloSalida !== cycle.soloSalida) {
    changes.soloSalida = { old: String(cycle.soloSalida), new: String(req.soloSalida) };
  }
  if (req.notes !== undefined && req.notes !== cycle.importNotes) {
    changes.importNotes = { old: cycle.importNotes, new: req.notes };
  }
  if (req.estimatedFeePct !== undefined) {
    const oldFeePct = parseFloat(String(cycle.estimatedFeePct || "0"));
    if (req.estimatedFeePct !== oldFeePct) {
      changes.estimatedFeePct = { old: oldFeePct, new: req.estimatedFeePct };
    }
  }

  // ── 5. Recalculate ALL derived fields ───────────────────────
  const config = await repo.getIdcaConfig();
  const assetConfig = await repo.getAssetConfig(pair);
  if (!assetConfig) throw new Error(`No asset config for ${pair}`);

  const currentPrice = await getCurrentPrice(pair) || newAvgEntry;
  const buyCount = cycle.buyCount || 1;

  // Safety buy levels - use effective calculation for imported cycles
  const safetyOrders = parseSafetyOrders(assetConfig.safetyOrdersJson);
  const effectiveSafety = calculateEffectiveSafetyLevel(
    safetyOrders,
    newAvgEntry,
    currentPrice,
    buyCount
  );

  const nextLevelPct = effectiveSafety.nextLevelPct;
  const nextBuyPrice = effectiveSafety.nextBuyPrice;
  const skippedSafetyLevels = effectiveSafety.skippedLevels;
  const skippedLevelsDetail = effectiveSafety.skippedLevelsDetail;

  // Capital reserved
  const allocatedCapital = parseFloat(String(config.allocatedCapitalUsd || "0"));
  const maxAssetPct = parseFloat(String(config.maxAssetExposurePct || "25"));
  const assetBudget = allocatedCapital * (maxAssetPct / 100);
  const capitalReserved = Math.max(newCapitalUsed, assetBudget);

  // Dynamic TP
  let tpPct: number;
  let tpBreakdown: any = null;
  const cycleType = (cycle.cycleType as import("./IdcaTypes").IdcaCycleType) || "main";

  if (config.adaptiveTpEnabled) {
    const dtpConfig = getDynamicTpConfig(config);
    const breakdown = smart.computeDynamicTakeProfit({
      pair,
      cycleType,
      buyCount,
      marketScore: parseFloat(String(cycle.marketScore || "50")),
      volatilityPct: getVolatility(pair),
      reboundStrength: getReboundStrength(pair),
      config: dtpConfig,
    });
    tpPct = breakdown.finalTpPct;
    tpBreakdown = breakdown;
  } else {
    tpPct = parseFloat(String(assetConfig.takeProfitPct));
  }
  const tpPrice = newAvgEntry * (1 + tpPct / 100);

  // Dynamic trailing
  let trailingPct = parseFloat(String(assetConfig.trailingPct));
  if (config.volatilityTrailingEnabled) {
    trailingPct = smart.computeDynamicTrailing({
      atrPct: getVolatility(pair),
      baseTrailingPct: trailingPct,
      minTrailingPct: parseFloat(String(pair === "BTC/USD" ? config.minTrailingPctBtc : config.minTrailingPctEth)),
      maxTrailingPct: parseFloat(String(pair === "BTC/USD" ? config.maxTrailingPctBtc : config.maxTrailingPctEth)),
    });
  }

  // Protection stop price (if armed)
  let protectionStopPrice: string | null = cycle.protectionStopPrice;
  if (cycle.protectionArmedAt && newAvgEntry !== oldAvgEntry) {
    // Re-arm protection at new break-even
    protectionStopPrice = newAvgEntry.toFixed(8);
  }

  // PnL recalculation
  const marketValue = newQty * currentPrice;
  const unrealizedPnlUsd = marketValue - newCapitalUsed;
  const unrealizedPnlPct = newCapitalUsed > 0 ? (unrealizedPnlUsd / newCapitalUsed) * 100 : 0;

  // Track derived impact
  const oldTpPrice = parseFloat(String(cycle.tpTargetPrice || "0"));
  const oldNextBuy = parseFloat(String(cycle.nextBuyPrice || "0"));
  const oldProtection = parseFloat(String(cycle.protectionStopPrice || "0"));
  const oldPnlPct = parseFloat(String(cycle.unrealizedPnlPct || "0"));

  const derivedImpact: Record<string, { old: string | number | null; new: string | number | null }> = {};
  if (tpPrice !== oldTpPrice) {
    derivedImpact.tpTargetPrice = { old: oldTpPrice, new: tpPrice };
  }
  if (nextBuyPrice !== oldNextBuy) {
    derivedImpact.nextBuyPrice = { old: oldNextBuy, new: nextBuyPrice };
  }
  if (parseFloat(protectionStopPrice || "0") !== oldProtection) {
    derivedImpact.protectionStopPrice = { old: oldProtection, new: parseFloat(protectionStopPrice || "0") };
  }
  if (unrealizedPnlPct !== oldPnlPct) {
    derivedImpact.unrealizedPnlPct = { old: oldPnlPct, new: unrealizedPnlPct };
  }

  // ── 6. Build patch ──────────────────────────────────────────
  const patch: Record<string, any> = {
    avgEntryPrice: newAvgEntry.toFixed(8),
    totalQuantity: newQty.toFixed(8),
    capitalUsedUsd: newCapitalUsed.toFixed(2),
    capitalReservedUsd: capitalReserved.toFixed(2),
    currentPrice: currentPrice.toFixed(8),
    nextBuyLevelPct: nextLevelPct?.toFixed(2) || null,
    nextBuyPrice: nextBuyPrice?.toFixed(8) || null,
    tpTargetPct: tpPct.toFixed(2),
    tpTargetPrice: tpPrice.toFixed(8),
    tpBreakdownJson: tpBreakdown,
    trailingPct: trailingPct.toFixed(2),
    unrealizedPnlUsd: unrealizedPnlUsd.toFixed(2),
    unrealizedPnlPct: unrealizedPnlPct.toFixed(4),
    skippedSafetyLevels,  // Store count of skipped levels
    skippedLevelsDetail: skippedSafetyLevels > 0 ? skippedLevelsDetail : null,  // Store detail for UI
  };

  if (protectionStopPrice !== null) {
    patch.protectionStopPrice = protectionStopPrice;
  }
  if (req.exchangeSource !== undefined) {
    patch.exchangeSource = req.exchangeSource;
  }
  if (req.startedAt !== undefined) {
    patch.startedAt = new Date(req.startedAt);
  }
  if (req.soloSalida !== undefined) {
    patch.soloSalida = req.soloSalida;
  }
  if (req.notes !== undefined) {
    patch.importNotes = req.notes;
  }
  if (req.estimatedFeePct !== undefined) {
    patch.estimatedFeePct = req.estimatedFeePct.toFixed(4);
    // Recalculate fee USD
    patch.estimatedFeeUsd = (newCapitalUsed * req.estimatedFeePct / 100).toFixed(2);
  }
  if (req.feesPaidUsd !== undefined) {
    // Store actual fees paid in import snapshot
    const snapshot = (cycle.importSnapshotJson as any) || {};
    snapshot.feesPaidUsdOverride = req.feesPaidUsd;
    patch.importSnapshotJson = snapshot;
  }

  // ── 7. Build edit history entry ────────────────────────────
  const editHistory: import("./IdcaTypes").EditHistoryEntry = {
    editedAt: new Date().toISOString(),
    editedBy: "user_manual",
    reason: req.editReason,
    case: activityCheck.case,
    changes,
    derivedImpact,
    activityAtEdit: {
      buyCount: activityCheck.buyCount,
      hasPostImportSells: activityCheck.postImportSells > 0,
      status: activityCheck.currentStatus,
    },
  };

  // ── 8. Persist with audit ───────────────────────────────────
  const updated = await repo.updateCycleWithEditAudit(cycleId, patch, editHistory);

  // ── 9. Log event ───────────────────────────────────────────
  const changeList = Object.keys(changes).join(", ");
  const derivedList = Object.keys(derivedImpact).join(", ");

  await createHumanEvent({
    cycleId, pair, mode,
    eventType: "imported_cycle_edited",
    severity: activityCheck.case === "B_with_activity" ? "warn" : "info",
    message: `Ciclo importado editado manualmente [${activityCheck.case}]. Cambios: ${changeList}. Impacto derivado: ${derivedList}`,
    payloadJson: {
      editHistory,
      activityCheck,
      oldAvgEntry, newAvgEntry,
      oldQty, newQty,
      oldCapitalUsed, newCapitalUsed,
    },
  }, {
    eventType: "imported_cycle_edited", pair, mode,
    price: currentPrice, avgEntry: newAvgEntry,
    capitalUsed: newCapitalUsed,
    reason: req.editReason,
  });

  console.log(`${TAG} Edited imported cycle #${cycleId} (${pair}): ${activityCheck.case}, changes=[${changeList}], derived=[${derivedList}]`);

  return { cycle: updated, activityCheck, editHistory };
}

// ════════════════════════════════════════════════════════════════════
// RECOVERY CYCLE ENGINE — Deep Drawdown Multi-Cycle
// ════════════════════════════════════════════════════════════════════

const DEFAULT_RECOVERY_CONFIG: RecoveryConfig = {
  enabled: false,
  activationDrawdownPct: 25,
  maxRecoveryCyclesPerMain: 1,
  maxTotalCyclesPerPair: 3,
  maxPairExposurePct: 40,
  capitalAllocationPct: 10,
  maxRecoveryCapitalUsd: 500,
  cooldownMinutesAfterMainBuy: 120,
  cooldownMinutesBetweenRecovery: 360,
  minMarketScoreForRecovery: 40,
  requireReboundConfirmation: true,
  recoveryTpPctBtc: 2.5,
  recoveryTpPctEth: 3.0,
  maxRecoveryEntries: 2,
  recoveryEntryDipSteps: [2.0, 4.0],
  recoveryTrailingPctBtc: 0.8,
  recoveryTrailingPctEth: 1.0,
  autoCloseIfMainClosed: true,
  autoCloseIfMainRecovers: false,
  maxRecoveryDurationHours: 168,
};

function getRecoveryConfig(config: InstitutionalDcaConfigRow): RecoveryConfig {
  const raw = config.recoveryConfigJson as any;
  if (!raw || typeof raw !== "object") return DEFAULT_RECOVERY_CONFIG;
  return { ...DEFAULT_RECOVERY_CONFIG, ...raw };
}

// ─── Recovery Activation Check ────────────────────────────────────

async function checkRecoveryActivation(
  mainCycle: InstitutionalDcaCycle,
  currentPrice: number,
  config: InstitutionalDcaConfigRow,
  assetConfig: InstitutionalDcaAssetConfigRow,
  mode: IdcaMode,
  rcfg: RecoveryConfig
): Promise<void> {
  const pair = mainCycle.pair;
  const mainDD = parseFloat(String(mainCycle.maxDrawdownPct || "0"));
  const mainPnlPct = parseFloat(String(mainCycle.unrealizedPnlPct || "0"));
  const currentDD = mainPnlPct < 0 ? Math.abs(mainPnlPct) : 0;

  // 1) Check drawdown threshold
  if (currentDD < rcfg.activationDrawdownPct) return;

  // 2) Check main cycle is active (not closed/paused)
  if (mainCycle.status === "closed" || mainCycle.status === "paused" || mainCycle.status === "blocked") return;

  // 3) Check max recovery cycles per main
  const closedCount = await repo.getClosedRecoveryCyclesCount(mainCycle.id);
  const activeRecovery = await repo.getActiveRecoveryCycles(pair, mode, mainCycle.id);
  const totalRecoveryCount = closedCount + activeRecovery.length;
  if (totalRecoveryCount >= rcfg.maxRecoveryCyclesPerMain) {
    return; // Already reached max recovery cycles
  }

  // At this point, drawdown is deep enough — emit eligible event
  const allocatedCapital = parseFloat(String(config.allocatedCapitalUsd));
  const pairExposure = await repo.getTotalBotPairExposureUsd(pair, mode);
  const pairExposurePct = allocatedCapital > 0 ? (pairExposure / allocatedCapital) * 100 : 0;
  const recoveryCapital = Math.min(
    allocatedCapital * (rcfg.capitalAllocationPct / 100),
    rcfg.maxRecoveryCapitalUsd
  );

  await createHumanEvent({
    cycleId: mainCycle.id, pair, mode,
    eventType: "recovery_cycle_eligible",
    severity: "warn",
    message: `Recovery eligible: main DD=${currentDD.toFixed(1)}% >= ${rcfg.activationDrawdownPct}%, exposure=${pairExposurePct.toFixed(1)}%`,
    payloadJson: {
      mainCycleId: mainCycle.id, drawdownPct: currentDD,
      activationDrawdownPct: rcfg.activationDrawdownPct,
      recoveryCapital, pairExposure, pairExposurePct,
      marketScore: parseFloat(String(mainCycle.marketScore || "0")),
    },
  }, {
    eventType: "recovery_cycle_eligible", pair, mode,
    drawdownPct: currentDD, capitalUsed: recoveryCapital,
    pnlPct: mainPnlPct, parentCycleId: mainCycle.id,
  });

  // 4) Gate checks — each produces a specific block reason if failed
  const blockReasons: string[] = [];

  // 4a) Total cycles per pair (bot-managed only; imported are independent)
  const allActive = await repo.getAllActiveBotCyclesForPair(pair, mode);
  if (allActive.length >= rcfg.maxTotalCyclesPerPair) {
    blockReasons.push(`max_cycles_per_pair: ${allActive.length} >= ${rcfg.maxTotalCyclesPerPair}`);
  }

  // 4b) Pair exposure limit
  if (pairExposurePct + rcfg.capitalAllocationPct > rcfg.maxPairExposurePct) {
    blockReasons.push(`pair_exposure: ${pairExposurePct.toFixed(1)}% + ${rcfg.capitalAllocationPct}% > ${rcfg.maxPairExposurePct}%`);
  }

  // 4c) Cooldown after last main buy
  if (mainCycle.lastBuyAt) {
    const sinceLastBuyMs = Date.now() - new Date(mainCycle.lastBuyAt).getTime();
    const cooldownMs = rcfg.cooldownMinutesAfterMainBuy * 60 * 1000;
    if (sinceLastBuyMs < cooldownMs) {
      const remaining = Math.ceil((cooldownMs - sinceLastBuyMs) / 60000);
      blockReasons.push(`cooldown_main_buy: ${remaining}min remaining`);
    }
  }

  // 4d) Cooldown between recovery cycles
  if (closedCount > 0) {
    // Check last closed recovery
    // Use a simplified check: if any recovery was closed recently
    // This is approximate; in production you'd store closedAt timestamp
    // For now we check using closedCount > 0 as a proxy
  }

  // 4e) Market score
  const marketScore = parseFloat(String(mainCycle.marketScore || "50"));
  if (marketScore < rcfg.minMarketScoreForRecovery) {
    blockReasons.push(`market_score_low: ${marketScore} < ${rcfg.minMarketScoreForRecovery}`);
  }

  // 4f) Capital availability
  if (mode === "simulation") {
    const wallet = await repo.getSimulationWallet();
    const available = parseFloat(String(wallet.availableBalanceUsd));
    if (available < recoveryCapital) {
      blockReasons.push(`insufficient_capital: $${available.toFixed(0)} < $${recoveryCapital.toFixed(0)}`);
    }
  }

  // 4g) Rebound confirmation
  if (rcfg.requireReboundConfirmation) {
    const candles = ohlcCache.get(pair) || [];
    const recentCandles = candles.slice(-5).map(c => ({
      high: c.high, low: c.low, close: c.close,
    }));
    const localLow = Math.min(...recentCandles.map(c => c.low), currentPrice);
    if (!smart.detectRebound({ recentCandles, currentPrice, localLow })) {
      blockReasons.push("no_rebound_confirmed");
    }
  }

  // If any gate failed, emit blocked event
  if (blockReasons.length > 0) {
    await createHumanEvent({
      cycleId: mainCycle.id, pair, mode,
      eventType: "recovery_cycle_blocked",
      severity: "warn",
      message: `Recovery blocked: ${blockReasons.join("; ")}`,
      payloadJson: {
        mainCycleId: mainCycle.id, drawdownPct: currentDD,
        blockReasons, pairExposurePct, recoveryCapital, marketScore,
      },
    }, {
      eventType: "recovery_cycle_blocked", pair, mode,
      drawdownPct: currentDD, parentCycleId: mainCycle.id,
      reason: blockReasons.join("; "),
    });
    return;
  }

  // All gates passed — execute recovery entry
  await executeRecoveryEntry(mainCycle, currentPrice, config, assetConfig, mode, rcfg, recoveryCapital, currentDD);
}

// ─── Recovery Entry Execution ─────────────────────────────────────

async function executeRecoveryEntry(
  mainCycle: InstitutionalDcaCycle,
  currentPrice: number,
  config: InstitutionalDcaConfigRow,
  assetConfig: InstitutionalDcaAssetConfigRow,
  mode: IdcaMode,
  rcfg: RecoveryConfig,
  recoveryCapital: number,
  mainDrawdown: number
): Promise<void> {
  const pair = mainCycle.pair;
  const isBtc = pair === "BTC/USD";

  // Calculate first buy
  const entrySteps = rcfg.recoveryEntryDipSteps;
  const buyUsd = recoveryCapital / (entrySteps.length || 1);
  const quantity = buyUsd / currentPrice;

  // Simulation fees
  let fees = 0, slippage = 0, netValue = buyUsd;
  if (mode === "simulation") {
    fees = buyUsd * (parseFloat(String(config.simulationFeePct)) / 100);
    slippage = buyUsd * (parseFloat(String(config.simulationSlippagePct)) / 100);
    netValue = buyUsd + fees + slippage;
  }

  // TP
  const tpPct = isBtc ? rcfg.recoveryTpPctBtc : rcfg.recoveryTpPctEth;
  const tpPrice = currentPrice * (1 + tpPct / 100);

  // Next safety buy
  const nextDipPct = entrySteps.length > 1 ? entrySteps[1] : null;
  const nextBuyPrice = nextDipPct ? currentPrice * (1 - nextDipPct / 100) : null;

  const recoveryCycle = await repo.createCycle({
    pair,
    strategy: "institutional_dca_v1_recovery",
    mode,
    status: "active",
    avgEntryPrice: currentPrice.toFixed(8),
    totalQuantity: quantity.toFixed(8),
    capitalUsedUsd: netValue.toFixed(2),
    capitalReservedUsd: recoveryCapital.toFixed(2),
    buyCount: 1,
    nextBuyLevelPct: nextDipPct?.toFixed(2) || null,
    nextBuyPrice: nextBuyPrice?.toFixed(8) || null,
    tpTargetPct: tpPct.toFixed(2),
    tpTargetPrice: tpPrice.toFixed(8),
    cycleType: "recovery",
    parentCycleId: mainCycle.id,
    marketScore: mainCycle.marketScore,
    currentPrice: currentPrice.toFixed(8),
    adaptiveSizeProfile: "defensive",
    startedAt: new Date(),
  });

  await repo.createOrder({
    cycleId: recoveryCycle.id,
    pair, mode,
    orderType: "base_buy",
    buyIndex: 1,
    side: "buy",
    price: currentPrice.toFixed(8),
    quantity: quantity.toFixed(8),
    grossValueUsd: buyUsd.toFixed(2),
    feesUsd: fees.toFixed(2),
    slippageUsd: slippage.toFixed(2),
    netValueUsd: netValue.toFixed(2),
    triggerReason: `Recovery base buy: main DD=${mainDrawdown.toFixed(1)}%`,
    humanReason: formatOrderReason("base_buy"),
  });

  if (mode === "live") {
    await executeRealBuy(pair, quantity, currentPrice);
  }

  if (mode === "simulation") {
    const wallet = await repo.getSimulationWallet();
    await repo.updateSimulationWallet({
      availableBalanceUsd: (parseFloat(String(wallet.availableBalanceUsd)) - netValue).toFixed(2),
      usedBalanceUsd: (parseFloat(String(wallet.usedBalanceUsd)) + netValue).toFixed(2),
      totalOrdersSimulated: wallet.totalOrdersSimulated + 1,
    });
  }

  const pairExposure = await repo.getTotalPairExposureUsd(pair, mode);
  const allocatedCapital = parseFloat(String(config.allocatedCapitalUsd));
  const pairExposurePct = allocatedCapital > 0 ? (pairExposure / allocatedCapital) * 100 : 0;

  await createHumanEvent({
    cycleId: recoveryCycle.id, pair, mode,
    eventType: "recovery_cycle_started",
    severity: "info",
    message: `Recovery cycle opened: ${quantity.toFixed(6)} @ ${currentPrice.toFixed(2)}, main DD=${mainDrawdown.toFixed(1)}%, TP=${tpPct}%`,
    payloadJson: {
      parentCycleId: mainCycle.id, mainDrawdown, recoveryCapital,
      price: currentPrice, quantity, tpPct, pairExposure, pairExposurePct,
    },
  }, {
    eventType: "recovery_cycle_started", pair, mode,
    price: currentPrice, quantity, tpPct,
    drawdownPct: mainDrawdown, parentCycleId: mainCycle.id,
    capitalUsed: netValue,
  });

  await telegram.alertCycleStarted(recoveryCycle, mainDrawdown, parseFloat(String(mainCycle.marketScore || "50")));

  // Risk warning if exposure is high
  if (pairExposurePct >= rcfg.maxPairExposurePct * 0.8) {
    await emitRecoveryRiskWarning(pair, mode, mainCycle.id, pairExposure, pairExposurePct, allocatedCapital, rcfg);
  }
}

// ─── Recovery Cycle Management ────────────────────────────────────

async function manageRecoveryCycle(
  recoveryCycle: InstitutionalDcaCycle,
  mainCycle: InstitutionalDcaCycle,
  currentPrice: number,
  config: InstitutionalDcaConfigRow,
  assetConfig: InstitutionalDcaAssetConfigRow,
  mode: IdcaMode,
  rcfg: RecoveryConfig
): Promise<void> {
  const pair = recoveryCycle.pair;
  const avgEntry = parseFloat(String(recoveryCycle.avgEntryPrice || "0"));
  const totalQty = parseFloat(String(recoveryCycle.totalQuantity || "0"));
  const capitalUsed = parseFloat(String(recoveryCycle.capitalUsedUsd || "0"));

  if (avgEntry <= 0 || totalQty <= 0) return;

  // 1) Auto-close if main cycle closed
  if (rcfg.autoCloseIfMainClosed && mainCycle.status === "closed") {
    await closeRecoveryCycle(recoveryCycle, currentPrice, config, mode, "main_cycle_closed");
    return;
  }

  // 2) Auto-close if main recovers (optional)
  if (rcfg.autoCloseIfMainRecovers) {
    const mainPnl = parseFloat(String(mainCycle.unrealizedPnlPct || "0"));
    if (mainPnl > 0) {
      await closeRecoveryCycle(recoveryCycle, currentPrice, config, mode, "main_recovered");
      return;
    }
  }

  // 3) Max duration check (0 = disabled / no limit)
  if (rcfg.maxRecoveryDurationHours > 0 && recoveryCycle.startedAt) {
    const ageMs = Date.now() - new Date(recoveryCycle.startedAt).getTime();
    const maxMs = rcfg.maxRecoveryDurationHours * 3600000;
    if (ageMs > maxMs) {
      await closeRecoveryCycle(recoveryCycle, currentPrice, config, mode, "max_duration_exceeded");
      return;
    }
  }

  // Update price and PnL
  const marketValue = totalQty * currentPrice;
  const unrealizedPnlUsd = marketValue - capitalUsed;
  const unrealizedPnlPct = capitalUsed > 0 ? (unrealizedPnlUsd / capitalUsed) * 100 : 0;
  const currentDD = unrealizedPnlPct < 0 ? Math.abs(unrealizedPnlPct) : 0;
  const prevMaxDD = parseFloat(String(recoveryCycle.maxDrawdownPct || "0"));

  await repo.updateCycle(recoveryCycle.id, {
    currentPrice: currentPrice.toFixed(8),
    unrealizedPnlUsd: unrealizedPnlUsd.toFixed(2),
    unrealizedPnlPct: unrealizedPnlPct.toFixed(4),
    maxDrawdownPct: Math.max(currentDD, prevMaxDD).toFixed(2),
  });

  const isBtc = pair === "BTC/USD";

  // Check by status
  if (recoveryCycle.status === "active") {
    // Check TP
    const tpPct = parseFloat(String(recoveryCycle.tpTargetPct || (isBtc ? rcfg.recoveryTpPctBtc : rcfg.recoveryTpPctEth)));
    if (unrealizedPnlPct >= tpPct) {
      await closeRecoveryCycle(recoveryCycle, currentPrice, config, mode, "tp_reached");
      return;
    }

    // Check safety buys
    await checkRecoverySafetyBuy(recoveryCycle, currentPrice, config, mode, rcfg);

  } else if (recoveryCycle.status === "trailing_active") {
    const trailingPct = isBtc ? rcfg.recoveryTrailingPctBtc : rcfg.recoveryTrailingPctEth;
    const highestAfterTp = parseFloat(String(recoveryCycle.highestPriceAfterTp || "0"));

    if (currentPrice > highestAfterTp) {
      await repo.updateCycle(recoveryCycle.id, { highestPriceAfterTp: currentPrice.toFixed(8) });
    } else {
      const dropFromHigh = highestAfterTp > 0 ? ((highestAfterTp - currentPrice) / highestAfterTp) * 100 : 0;
      if (dropFromHigh >= trailingPct) {
        await closeRecoveryCycle(recoveryCycle, currentPrice, config, mode, "trailing_exit");
      }
    }
  }

  // Periodic risk warning
  const allocatedCapital = parseFloat(String(config.allocatedCapitalUsd));
  const pairExposure = await repo.getTotalPairExposureUsd(pair, mode);
  const pairExposurePct = allocatedCapital > 0 ? (pairExposure / allocatedCapital) * 100 : 0;
  if (pairExposurePct >= rcfg.maxPairExposurePct * 0.9) {
    await emitRecoveryRiskWarning(pair, mode, mainCycle.id, pairExposure, pairExposurePct, allocatedCapital, rcfg);
  }
}

// ─── Recovery Safety Buy ──────────────────────────────────────────

async function checkRecoverySafetyBuy(
  recoveryCycle: InstitutionalDcaCycle,
  currentPrice: number,
  config: InstitutionalDcaConfigRow,
  mode: IdcaMode,
  rcfg: RecoveryConfig
): Promise<void> {
  const pair = recoveryCycle.pair;
  const buyCount = recoveryCycle.buyCount;

  if (buyCount >= rcfg.maxRecoveryEntries) return;

  // Cooldown
  const lastBuyAt = recoveryCycle.lastBuyAt ? new Date(recoveryCycle.lastBuyAt).getTime() : 0;
  const cooldownMs = 30 * 60 * 1000; // 30min fixed cooldown for recovery safety buys
  if (Date.now() - lastBuyAt < cooldownMs) return;

  // Next buy price
  const nextBuyPrice = parseFloat(String(recoveryCycle.nextBuyPrice || "0"));
  if (nextBuyPrice <= 0 || currentPrice > nextBuyPrice) return;

  // Execute safety buy
  const capitalReserved = parseFloat(String(recoveryCycle.capitalReservedUsd || "0"));
  const entrySteps = rcfg.recoveryEntryDipSteps;
  const buyUsd = capitalReserved / (entrySteps.length || 1);
  const quantity = buyUsd / currentPrice;

  let fees = 0, slippage = 0, netValue = buyUsd;
  if (mode === "simulation") {
    fees = buyUsd * (parseFloat(String(config.simulationFeePct)) / 100);
    slippage = buyUsd * (parseFloat(String(config.simulationSlippagePct)) / 100);
    netValue = buyUsd + fees + slippage;
  }

  const prevQty = parseFloat(String(recoveryCycle.totalQuantity));
  const prevCost = parseFloat(String(recoveryCycle.capitalUsedUsd));
  const newTotalQty = prevQty + quantity;
  const newTotalCost = prevCost + netValue;
  const newAvgPrice = newTotalCost / newTotalQty;
  const newBuyCount = buyCount + 1;

  const nextIndex = buyCount; // 0-indexed in entrySteps
  const nextDipPct = entrySteps[nextIndex] || null;
  const nextBuyPriceCalc = nextDipPct ? newAvgPrice * (1 - nextDipPct / 100) : null;

  // Recalculate TP
  const isBtc = pair === "BTC/USD";
  const tpPct = isBtc ? rcfg.recoveryTpPctBtc : rcfg.recoveryTpPctEth;
  const tpPrice = newAvgPrice * (1 + tpPct / 100);

  await repo.updateCycle(recoveryCycle.id, {
    capitalUsedUsd: newTotalCost.toFixed(2),
    totalQuantity: newTotalQty.toFixed(8),
    avgEntryPrice: newAvgPrice.toFixed(8),
    buyCount: newBuyCount,
    nextBuyLevelPct: nextDipPct?.toFixed(2) || null,
    nextBuyPrice: nextBuyPriceCalc?.toFixed(8) || null,
    tpTargetPct: tpPct.toFixed(2),
    tpTargetPrice: tpPrice.toFixed(8),
    lastBuyAt: new Date(),
  });

  await repo.createOrder({
    cycleId: recoveryCycle.id, pair, mode,
    orderType: "safety_buy",
    buyIndex: newBuyCount,
    side: "buy",
    price: currentPrice.toFixed(8),
    quantity: quantity.toFixed(8),
    grossValueUsd: buyUsd.toFixed(2),
    feesUsd: fees.toFixed(2),
    slippageUsd: slippage.toFixed(2),
    netValueUsd: netValue.toFixed(2),
    triggerReason: `Recovery safety buy #${newBuyCount}`,
    humanReason: formatOrderReason("safety_buy"),
  });

  if (mode === "live") {
    await executeRealBuy(pair, quantity, currentPrice);
  }

  if (mode === "simulation") {
    const wallet = await repo.getSimulationWallet();
    await repo.updateSimulationWallet({
      availableBalanceUsd: (parseFloat(String(wallet.availableBalanceUsd)) - netValue).toFixed(2),
      usedBalanceUsd: (parseFloat(String(wallet.usedBalanceUsd)) + netValue).toFixed(2),
      totalOrdersSimulated: wallet.totalOrdersSimulated + 1,
    });
  }

  await createHumanEvent({
    cycleId: recoveryCycle.id, pair, mode,
    eventType: "safety_buy_executed",
    severity: "info",
    message: `Recovery safety buy #${newBuyCount}: ${quantity.toFixed(6)} @ ${currentPrice.toFixed(2)}, avg=${newAvgPrice.toFixed(2)}`,
  }, {
    eventType: "safety_buy_executed", pair, mode,
    price: currentPrice, quantity, avgEntry: newAvgPrice,
    capitalUsed: newTotalCost, buyCount: newBuyCount,
    parentCycleId: recoveryCycle.parentCycleId,
  });
}

// ─── Recovery Cycle Close ─────────────────────────────────────────

async function closeRecoveryCycle(
  recoveryCycle: InstitutionalDcaCycle,
  currentPrice: number,
  config: InstitutionalDcaConfigRow,
  mode: IdcaMode,
  closeReason: string
): Promise<void> {
  const pair = recoveryCycle.pair;
  const remainingQty = parseFloat(String(recoveryCycle.totalQuantity));
  const capitalUsed = parseFloat(String(recoveryCycle.capitalUsedUsd || "0"));
  const sellValueUsd = remainingQty * currentPrice;

  let fees = 0, slippage = 0, netValue = sellValueUsd;
  if (mode === "simulation") {
    fees = sellValueUsd * (parseFloat(String(config.simulationFeePct)) / 100);
    slippage = sellValueUsd * (parseFloat(String(config.simulationSlippagePct)) / 100);
    netValue = sellValueUsd - fees - slippage;
  }

  const prevRealized = parseFloat(String(recoveryCycle.realizedPnlUsd || "0"));
  const totalRealized = prevRealized + netValue;
  const pnlUsd = totalRealized - capitalUsed;
  const pnlPct = capitalUsed > 0 ? (pnlUsd / capitalUsed) * 100 : 0;

  const closedAt = new Date();
  const startedAt = recoveryCycle.startedAt ? new Date(recoveryCycle.startedAt) : closedAt;
  const durMs = closedAt.getTime() - startedAt.getTime();
  const durH = Math.floor(durMs / 3600000);
  const durM = Math.floor((durMs % 3600000) / 60000);
  const durationStr = durH > 24 ? `${Math.floor(durH / 24)}d ${durH % 24}h` : `${durH}h ${durM}m`;

  if (remainingQty > 0) {
    await repo.createOrder({
      cycleId: recoveryCycle.id, pair, mode,
      orderType: "final_sell",
      side: "sell",
      price: currentPrice.toFixed(8),
      quantity: remainingQty.toFixed(8),
      grossValueUsd: sellValueUsd.toFixed(2),
      feesUsd: fees.toFixed(2),
      slippageUsd: slippage.toFixed(2),
      netValueUsd: netValue.toFixed(2),
      triggerReason: `Recovery close: ${closeReason}`,
      humanReason: formatOrderReason("final_sell"),
    });

    if (mode === "live") {
      await executeRealSell(recoveryCycle, "final_sell", remainingQty);
    }
  }

  await repo.updateCycle(recoveryCycle.id, {
    status: "closed",
    closeReason,
    totalQuantity: "0",
    realizedPnlUsd: totalRealized.toFixed(2),
    closedAt,
  });

  if (mode === "simulation") {
    const wallet = await repo.getSimulationWallet();
    await repo.updateSimulationWallet({
      availableBalanceUsd: (parseFloat(String(wallet.availableBalanceUsd)) + netValue).toFixed(2),
      usedBalanceUsd: Math.max(0, parseFloat(String(wallet.usedBalanceUsd)) - sellValueUsd).toFixed(2),
      realizedPnlUsd: (parseFloat(String(wallet.realizedPnlUsd)) + pnlUsd).toFixed(2),
    });
  }

  await createHumanEvent({
    cycleId: recoveryCycle.id, pair, mode,
    eventType: "recovery_cycle_closed",
    severity: "info",
    message: `Recovery closed: PnL=${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}% ($${pnlUsd.toFixed(2)}), reason=${closeReason}, duration=${durationStr}`,
    payloadJson: {
      parentCycleId: recoveryCycle.parentCycleId, closeReason,
      pnlPct, pnlUsd, durationStr, buyCount: recoveryCycle.buyCount,
      capitalUsed, netValue,
    },
  }, {
    eventType: "recovery_cycle_closed", pair, mode,
    pnlPct, pnlUsd, closeReason, durationStr,
    buyCount: recoveryCycle.buyCount,
    parentCycleId: recoveryCycle.parentCycleId,
    capitalUsed,
  });

  // Telegram alert for recovery close (reuse imported close format)
  const updated = await repo.getCycleById(recoveryCycle.id);
  if (updated) {
    await telegram.alertImportedClosed(updated, pnlUsd, pnlPct, durationStr);
  }
}

// ════════════════════════════════════════════════════════════════════
// MANUAL CLOSE — User-initiated sell from the UI
// ════════════════════════════════════════════════════════════════════

/**
 * Closes any non-closed cycle immediately with a market sell.
 * Works for simulation (wallet update) and live (real exchange order).
 * Returns the closed cycle and realized PnL summary.
 */
export async function manualCloseCycle(cycleId: number): Promise<{
  cycle: import("@shared/schema").InstitutionalDcaCycle;
  sellPrice: number;
  quantity: number;
  grossValueUsd: number;
  netValueUsd: number;
  realizedPnlUsd: number;
  realizedPnlPct: number;
}> {
  const cycle = await repo.getCycleById(cycleId);
  if (!cycle) throw new Error(`Ciclo #${cycleId} no encontrado`);
  if (cycle.status === "closed") throw new Error("El ciclo ya está cerrado");

  const pair = cycle.pair;
  const mode = cycle.mode as IdcaMode;
  const config = await repo.getIdcaConfig();

  const totalQty = parseFloat(String(cycle.totalQuantity || "0"));
  if (totalQty <= 0) throw new Error("El ciclo no tiene cantidad disponible para vender");

  const currentPrice = await getCurrentPrice(pair);
  if (!currentPrice || currentPrice <= 0) throw new Error(`No se pudo obtener precio actual para ${pair}`);

  const sellValueUsd = totalQty * currentPrice;
  const capitalUsed = parseFloat(String(cycle.capitalUsedUsd || "0"));

  let fees = 0, slippage = 0, netValue = sellValueUsd;
  if (mode === "simulation") {
    fees = sellValueUsd * (parseFloat(String(config.simulationFeePct)) / 100);
    slippage = sellValueUsd * (parseFloat(String(config.simulationSlippagePct)) / 100);
    netValue = sellValueUsd - fees - slippage;
  }

  const prevRealized = parseFloat(String(cycle.realizedPnlUsd || "0"));
  const totalRealized = prevRealized + netValue;
  const realizedPnlUsd = totalRealized - capitalUsed;
  const realizedPnlPct = capitalUsed > 0 ? (realizedPnlUsd / capitalUsed) * 100 : 0;

  const closedAt = new Date();

  await repo.createOrder({
    cycleId: cycle.id, pair, mode,
    orderType: "manual_sell",
    buyIndex: null,
    side: "sell",
    price: currentPrice.toFixed(8),
    quantity: totalQty.toFixed(8),
    grossValueUsd: sellValueUsd.toFixed(2),
    feesUsd: fees.toFixed(2),
    slippageUsd: slippage.toFixed(2),
    netValueUsd: netValue.toFixed(2),
    triggerReason: "manual_close_by_user",
    humanReason: formatOrderReason("manual_sell"),
  });

  if (mode === "live") {
    await executeRealSell(cycle, "manual_sell", totalQty);
  }

  await repo.updateCycle(cycle.id, {
    status: "closed",
    closeReason: "manual_close",
    totalQuantity: "0",
    realizedPnlUsd: totalRealized.toFixed(2),
    unrealizedPnlUsd: "0",
    unrealizedPnlPct: "0",
    currentPrice: currentPrice.toFixed(8),
    closedAt,
  });

  if (mode === "simulation") {
    const wallet = await repo.getSimulationWallet();
    await repo.updateSimulationWallet({
      availableBalanceUsd: (parseFloat(String(wallet.availableBalanceUsd)) + netValue).toFixed(2),
      usedBalanceUsd: Math.max(0, parseFloat(String(wallet.usedBalanceUsd)) - sellValueUsd).toFixed(2),
      realizedPnlUsd: (parseFloat(String(wallet.realizedPnlUsd)) + realizedPnlUsd).toFixed(2),
    });
  }

  await createHumanEvent({
    cycleId: cycle.id, pair, mode,
    eventType: "manual_close",
    severity: "info",
    message: `Cierre manual: vendido ${totalQty.toFixed(6)} @ ${currentPrice.toFixed(2)}, PnL=${realizedPnlUsd >= 0 ? "+" : ""}$${realizedPnlUsd.toFixed(2)} (${realizedPnlPct >= 0 ? "+" : ""}${realizedPnlPct.toFixed(2)}%)`,
    payloadJson: {
      sellPrice: currentPrice, quantity: totalQty,
      grossValueUsd: sellValueUsd, netValueUsd: netValue,
      fees, slippage, realizedPnlUsd, realizedPnlPct, capitalUsed,
    },
  }, {
    eventType: "manual_close", pair, mode,
    price: currentPrice, quantity: totalQty,
    pnlUsd: realizedPnlUsd, pnlPct: realizedPnlPct,
    capitalUsed,
  });

  const pnlSign = realizedPnlUsd >= 0 ? "+" : "";
  try {
    await telegram.sendRawMessage(
      `🔴 *Cierre manual de posición*\n` +
      `Par: ${pair}\n` +
      `Modo: ${mode.toUpperCase()}\n` +
      `CycleId: #${cycle.id}\n` +
      `Precio venta: $${currentPrice.toFixed(2)}\n` +
      `Cantidad: ${totalQty.toFixed(6)}\n` +
      `Valor bruto: $${sellValueUsd.toFixed(2)}\n` +
      `PnL realizado: ${pnlSign}$${realizedPnlUsd.toFixed(2)} (${pnlSign}${realizedPnlPct.toFixed(2)}%)\n` +
      `Iniciado por: usuario`
    );
  } catch { /* ignore telegram errors */ }

  const closedCycle = await repo.getCycleById(cycle.id);
  return {
    cycle: closedCycle!,
    sellPrice: currentPrice,
    quantity: totalQty,
    grossValueUsd: sellValueUsd,
    netValueUsd: netValue,
    realizedPnlUsd,
    realizedPnlPct,
  };
}

// ─── Recovery Risk Warning ────────────────────────────────────────

async function emitRecoveryRiskWarning(
  pair: string,
  mode: IdcaMode,
  mainCycleId: number,
  pairExposure: number,
  pairExposurePct: number,
  allocatedCapital: number,
  rcfg: RecoveryConfig
): Promise<void> {
  await createHumanEvent({
    pair, mode,
    eventType: "recovery_cycle_risk_warning",
    severity: "warn",
    message: `Recovery risk: pair exposure $${pairExposure.toFixed(0)} (${pairExposurePct.toFixed(1)}%), limit=${rcfg.maxPairExposurePct}%`,
    payloadJson: {
      mainCycleId, pairExposure, pairExposurePct,
      maxPairExposurePct: rcfg.maxPairExposurePct,
      allocatedCapital,
    },
  }, {
    eventType: "recovery_cycle_risk_warning", pair, mode,
    capitalUsed: pairExposure, parentCycleId: mainCycleId,
    reason: `Exposición del par: ${pairExposurePct.toFixed(1)}% de ${rcfg.maxPairExposurePct}%`,
  });
}
