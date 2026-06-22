/**
 * IdcaEngine — Main engine for the Institutional DCA module.
 * Independent scheduler, entry/safety/TP/trailing/breakeven/emergency engines.
 * Completely isolated from the main bot's TradingEngine.
 */
import * as repo from "./IdcaRepository";
import { TrailingBuyManager } from "./TrailingBuyManager";
import * as telegram from "./IdcaTelegramNotifier";
import { getNearZoneThresholdPct } from "./IdcaTelegramNotifier";
import * as tbState from "./IdcaTrailingBuyTelegramState";
import { resolveTrailingBuyPolicy, resolveTrailingBuyPolicyWithSliders, shouldSendDigest, type TrailingBuyDigestEntry } from "./IdcaTelegramAlertPolicy";
import { getEffectiveEntryConfig } from "./IdcaSliderConfig";
import * as smart from "./IdcaSmartLayer";
import { resolveEffectiveEntryReference, type EffectiveEntryReferenceResult, getAnchorUpdateThreshold, getAnchorUpdateCooldown, getAnchorResetThreshold, shouldUpdateAnchor, shouldResetAnchor } from "./IdcaEntryReferenceResolver";
import { buildReferenceContext, type ReferenceContext, MIN_VWAP_CANDLES_FOR_ENTRY_DEFAULT } from "./IdcaReferenceContext";
import { OhlcCandle, computeATRPct } from "./IdcaSmartLayer";
import { formatIdcaMessage, formatOrderReason, type FormatContext } from "./IdcaMessageFormatter";
import { idcaMigrationService } from "./IdcaMigrationService";
import { idcaExitManager } from "./IdcaExitManager";
import { idcaExecutionManager } from "./IdcaExecutionManager";
import * as exitRepo from "./IdcaExitInstructionRepository";
import { processTriggeredExitInstructions } from "./IdcaExitExecutor";
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
  VwapEntryContext,
  IdcaEntryMode,
  IdcaConfluenceResult,
} from "./IdcaTypes";
import { normalizeDipReferenceMethod } from "./IdcaTypes";
import { parseDynamicDistanceConfig } from "./IdcaDynamicDistanceService";
import { resolveIdcaRequiredDistance, logDistanceResolution } from "./IdcaDistanceResolver";
import { evaluateIdcaEntryConfluence, logIdcaConfluence } from "./IdcaConfluenceEngine";
import type { TimestampedCandle } from "./IdcaSmartLayer";
import { ExchangeFactory } from "../exchanges/ExchangeFactory";
import { MarketDataService } from "../MarketDataService";
import { resolveDynamicAnchor, type DynamicAnchorResult } from "./IdcaDynamicAnchorService";
import * as liveGuard from "./IdcaLiveExecutionGuard";
import { runStartupReconciliation, isSafeToStartAfterReconciliation } from "./IdcaStartupReconciliationService";
import { tradeSnapshotService, type IdcaCycleContext } from "../TradeSnapshotService";
import { tradeMetricsTracker } from "../TradeMetricsTracker";
import { idcaHybridDecisionService } from "./IdcaHybridDecisionService";

const TAG = "[IDCA]";

// ─── FASE 4: Autotuning snapshot hooks — NON-BLOCKING, write-only to new tables
// These helpers NEVER modify active cycles, basePrice, avgEntryPrice, VWAP anchors, or FISCO.
function emitIdcaSnapshot(ctx: {
  sourceMode:    "IDCA_SIMULATION" | "REAL";
  cycleId:       number;
  snapshotType:  IdcaCycleContext["snapshotType"];
  pair:          string;
  eventTs?:      Date;
  entryPrice?:   number;
  exitPrice?:    number;
  executedAmount?: number;
  pnlNetUsd?:    number;
  pnlPct?:       number;
  regime?:       string;
  signalScore?:  number;
  holdTimeMinutes?: number;
  exitReason?:   string;
}): void {
  tradeSnapshotService.onIdcaEvent({
    sourceMode:     ctx.sourceMode,
    cycleId:        ctx.cycleId.toString(),
    snapshotType:   ctx.snapshotType,
    pair:           ctx.pair,
    eventTs:        ctx.eventTs ?? new Date(),
    entryPrice:     ctx.entryPrice,
    exitPrice:      ctx.exitPrice,
    executedAmount: ctx.executedAmount,
    pnlNetUsd:      ctx.pnlNetUsd,
    pnlPct:         ctx.pnlPct,
    regime:         ctx.regime,
    signalScore:    ctx.signalScore,
    holdTimeMinutes: ctx.holdTimeMinutes,
    exitReason:     ctx.exitReason,
  });
}

function emitIdcaMetric(cycle: InstitutionalDcaCycle, sourceMode: "IDCA_SIMULATION" | "REAL", currentPrice: number): void {
  const avgEntry = parseFloat(String(cycle.avgEntryPrice || "0"));
  if (avgEntry <= 0 || currentPrice <= 0) return;
  tradeMetricsTracker.onIdcaSample({
    sourceMode,
    sourceTradeId: cycle.id.toString(),
    pair: cycle.pair,
    entryPrice: avgEntry,
    currentPrice,
    trailingActivated: cycle.status === "trailing_active" || !!cycle.trailingActiveAt,
  });
}

/** HOTFIX: Lock por ciclo para evitar compras simultáneas */
const cycleExecutionLocks = new Map<number, boolean>();

/** HOTFIX: Estado de reconciliación de startup */
let startupReconciliationCompleted = false;
let startupReconciliationResult: any = null;

// ─── Fee/Dust Tolerance for Live Full-Close Sells ───────────────
// When cycle.totalQuantity slightly exceeds exchange available balance
// due to fees/rounding, adjust the sell volume instead of failing.
// HOTFIX: Use dynamic relative tolerance (0.25% of requestedQty) instead of
// a fixed absolute threshold — the old ABS check was blocking on tiny shortfalls
// (e.g. BTC #24: diff=0.00001621 BTC, 0.0901%) when only the PCT check matters.

/**
 * Computes the actual sell quantity for a live full-close, applying dust tolerance.
 * For partial closes: NEVER adjusts — throws if available < requested.
 *
 * dustTolerance = max(2 base units, 0.25% of requestedQty).
 * Covers fee/rounding deltas up to ~0.25% without blocking protective exits.
 */
function computeLiveSellQtyWithDustTolerance(
  requestedQty: number,
  availableQty: number,
  isFullClose: boolean,
  asset: string
): { sellQty: number; adjusted: boolean; reason: string | null } {
  if (availableQty >= requestedQty) {
    return { sellQty: requestedQty, adjusted: false, reason: null };
  }
  const diff = requestedQty - availableQty;
  const diffPct = requestedQty > 0 ? (diff / requestedQty) * 100 : 100;
  const dustTolerance = Math.max(0.00000002, requestedQty * 0.0025); // 0.25% relative

  if (isFullClose && diff <= dustTolerance) {
    return {
      sellQty: availableQty,
      adjusted: true,
      reason: `fee_dust_quantity_adjustment: requested=${requestedQty.toFixed(8)}, available=${availableQty.toFixed(8)}, diff=${diff.toFixed(8)} (${diffPct.toFixed(4)}%) tolerance=${dustTolerance.toFixed(8)}`,
    };
  }

  throw new Error(
    `insufficient_exchange_balance: requested=${requestedQty.toFixed(8)} ${asset}, ` +
    `available=${availableQty.toFixed(8)}, diff=${diff.toFixed(8)} (${diffPct.toFixed(4)}%)`
  );
}

// ─── Per-cycle sell-failed Telegram cooldown (anti-spam) ────────
// Prevents repeated Telegram alerts when trailing/BE keeps triggering
// and the live sell keeps failing due to the same balance issue.

const sellFailedCooldown = new Map<string, number>();
const SELL_FAILED_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

function shouldSendSellFailedAlert(cycleId: number, errorKey: string): boolean {
  const key = `${cycleId}:sell_failed:${errorKey}`;
  const last = sellFailedCooldown.get(key) || 0;
  if (Date.now() - last < SELL_FAILED_COOLDOWN_MS) return false;
  sellFailedCooldown.set(key, Date.now());
  return true;
}

// ─── Helper Functions ───────────────────────────────────────────

/**
 * Get ATRP for a pair (helper for trailing buy level 1)
 */
async function getAtrPctForPair(pair: string): Promise<number> {
  try {
    const candles = await MarketDataService.getCandles(pair, "1h");
    if (candles.length >= 14) {
      return computeATRPct(candles, 14);
    }
  } catch (error) {
    console.warn(`${TAG}[ATRP] Failed to get ATRP for ${pair}:`, error);
  }
  return 2.0; // Default fallback
}

// ─── Exit Execution ─────────────────────────────────────────────

/**
 * Ejecuta una salida basada en señal del ExitManager
 * GUARD CRÍTICO: Solo cierra ciclo en BD si hay confirmación de venta real (orderId/filled)
 */
async function executeExit(
  cycle: InstitutionalDcaCycle,
  signal: any, // ExitSignal type
  config: InstitutionalDcaConfigRow,
  assetConfig: InstitutionalDcaAssetConfigRow,
  mode: IdcaMode
): Promise<void> {
  const pair = cycle.pair;
  const totalQty = parseFloat(String(cycle.totalQuantity));

  let sellVolume = totalQty; // may be adjusted by dust tolerance below

  try {
    // ─── GUARD: Verificar balance disponible en exchange antes de vender ───
    if (mode === "live") {
      const exchange = ExchangeFactory.getTradingExchange();
      const balance = await exchange.getBalance();
      const asset = pair.split("/")[0]; // BTC/USD -> BTC
      const availableQty = parseFloat(String((balance[asset] as any)?.available ?? balance[asset] ?? "0"));

      // Apply dust tolerance: may reduce sellVolume slightly for full-close.
      // Throws insufficient_exchange_balance for real shortages (caught below → no createOrder).
      const dustResult = computeLiveSellQtyWithDustTolerance(totalQty, availableQty, true, asset);
      sellVolume = dustResult.sellQty;

      if (dustResult.adjusted) {
        console.warn(
          `${TAG}[EXIT_DUST_ADJ] cycleId=${cycle.id} pair=${pair} ` +
          `requested=${totalQty.toFixed(8)} adjusted=${sellVolume.toFixed(8)} reason=${dustResult.reason}`
        );
      }
    }

    // Crear orden de salida (con volume ajustado por dust si aplica)
    const exchange = ExchangeFactory.getTradingExchange();
    const sellOrder = await exchange.placeOrder({ pair, type: "sell", ordertype: "market", volume: sellVolume.toFixed(8) });

    if (!sellOrder) {
      throw new Error("Failed to create sell order");
    }

    // ─── GUARD CRÍTICO: Verificar confirmación de venta antes de cerrar ciclo ───
    // OrderResult tiene orderId, txid, success - NO tiene id, filledQty, status
    const hasOrderId = !!(sellOrder.orderId || sellOrder.txid);

    // Para LIVE: exigir confirmación real antes de cerrar ciclo
    if (mode === "live" && !hasOrderId) {
      console.error(
        `${TAG}[EXIT_BLOCKED] cycleId=${cycle.id} pair=${pair} ` +
        `mode=live reason=no_confirmed_order_id ` +
        `exitType=${signal.exitType} price=${signal.exitPrice.toFixed(2)} ` +
        `sellOrder.success=${sellOrder.success}`
      );
      await createHumanEvent({
        cycleId: cycle.id, pair, mode,
        eventType: "exit_blocked",
        severity: "critical",
        message: `Cierre bloqueado: orden creada pero sin orderId confirmado. Ciclo sigue activo.`,
        payloadJson: {
          exitType: signal.exitType,
          exitPrice: signal.exitPrice,
          sellOrderSuccess: sellOrder.success,
          warning: "Ciclo NO cerrado - verificar orden manualmente en exchange",
        },
      }, { eventType: "exit_blocked", pair, mode, price: signal.exitPrice });
      await telegram.sendRawMessage(
        `🚨 <b>[IDCA][LIVE] EXIT BLOCKED</b>\n\n` +
        `Par: <b>${pair}</b> #${cycle.id}<br>\n` +
        `Tipo: <code>${signal.exitType}</code><br>\n` +
        `Precio: <code>$${signal.exitPrice.toFixed(2)}</code><br>\n` +
        `⚠️ Orden creada pero SIN orderId confirmado. Ciclo sigue ACTIVO.<br>\n` +
        `Revisar manualmente en Revolut X.`
      );
      return; // NO cerrar ciclo - mantiene activo
    }

    // Nota: OrderResult no tiene filledQty/status - asumimos market order se llena
    // Si sellOrder.success=true y tiene orderId, consideramos exitoso
    const isConfirmed = sellOrder.success && hasOrderId;

    // Solo cerrar ciclo si hay confirmación suficiente
    await repo.updateCycle(cycle.id, {
      status: "closed",
      closeReason: signal.exitType,
      closedAt: new Date(),
    });

    // Guardar referencia a la orden de venta
    const grossValueUsd = totalQty * signal.exitPrice;
    const { pct: feePct } = (await import('./IdcaPnlCalculator')).resolveFeePct(config.executionFeesJson, (config as any).simulationFeePct);
    const feesUsd = grossValueUsd * feePct / 100;
    const netValueUsd = grossValueUsd - feesUsd;

    await repo.createOrder({
      cycleId: cycle.id,
      pair,
      mode,
      orderType: signal.exitType === "take_profit" ? "final_sell" : "breakeven_sell",
      side: "sell",
      price: signal.exitPrice.toFixed(8),
      quantity: totalQty.toFixed(8),
      grossValueUsd: grossValueUsd.toFixed(2),
      netValueUsd: netValueUsd.toFixed(2),
      exchangeOrderId: sellOrder.orderId || sellOrder.txid || null,
      triggerReason: signal.exitType,
      humanReason: `Exit: ${signal.exitType} - ${signal.exitReason}`,
    });

    // Limpiar estado de salida
    idcaExitManager.clearExitState(cycle.id);

    // Eventos y notificaciones
    await createHumanEvent({
      pair, mode,
      eventType: "exit_executed",
      severity: "info",
      message: `Exit confirmed: ${signal.exitType} at $${signal.exitPrice.toFixed(2)} (orderId: ${sellOrder.orderId || sellOrder.txid || "n/a"})`,
      payloadJson: {
        exitType: signal.exitType,
        exitPrice: signal.exitPrice,
        exitReason: signal.exitReason,
        urgency: signal.urgency,
        orderId: sellOrder.orderId || sellOrder.txid || null,
      },
    }, { eventType: "exit_executed", pair, mode });

    // Alerta Telegram según tipo de salida
    switch (signal.exitType) {
      case "fail_safe":
        await telegram.alertFailSafeTriggered(pair, mode, signal.exitPrice, signal.metadata.currentState.unrealizedPnlPct);
        break;
      case "take_profit":
        await telegram.alertTakeProfitReached(pair, mode, signal.exitPrice, signal.metadata.currentState.unrealizedPnlPct);
        break;
      case "trailing":
        await telegram.alertTrailingStopTriggered(pair, mode, signal.exitPrice, signal.metadata.currentState.unrealizedPnlPct);
        break;
      case "break_even":
        await telegram.alertBreakEvenTriggered(pair, mode, signal.exitPrice);
        break;
    }

    console.log(
      `${TAG}[EXIT_CONFIRMED] cycleId=${cycle.id} pair=${pair} ` +
      `exitType=${signal.exitType} price=${signal.exitPrice.toFixed(2)} ` +
      `orderId=${sellOrder.orderId || sellOrder.txid || "n/a"} ` +
      `(${signal.metadata.currentState.unrealizedPnlPct?.toFixed(2)}% PnL)`
    );

    // ─── FASE 4: Exit snapshot — non-blocking, write-only
    const avgEntry = parseFloat(String(cycle.avgEntryPrice || "0"));
    const capitalUsed = parseFloat(String(cycle.capitalUsedUsd || "0"));
    const pnlNetUsd = netValueUsd - capitalUsed;
    const pnlPct = capitalUsed > 0 ? (pnlNetUsd / capitalUsed) * 100 : 0;
    const closedAt = new Date();
    const startedAt = cycle.startedAt ? new Date(cycle.startedAt) : closedAt;
    const durMs = closedAt.getTime() - startedAt.getTime();

    const snapshotType = signal.exitType === "fail_safe" ? "FAIL_SAFE_EXIT" : "CYCLE_CLOSED";
    emitIdcaSnapshot({
      sourceMode: mode === "simulation" ? "IDCA_SIMULATION" : "REAL",
      cycleId: cycle.id,
      snapshotType,
      pair,
      eventTs: new Date(),
      entryPrice: avgEntry,
      exitPrice: signal.exitPrice,
      executedAmount: totalQty,
      pnlNetUsd,
      pnlPct,
      holdTimeMinutes: durMs / 60000,
      exitReason: signal.exitType,
    });

  } catch (error) {
    const errMsg = (error as Error).message || "unknown";
    console.error(`${TAG}[EXIT_FAILED] cycleId=${cycle.id} pair=${pair}:`, errMsg);

    const isBalanceFail = errMsg.includes("insufficient_exchange_balance") || errMsg.includes("balance_zero");
    const errorKey = isBalanceFail ? "insufficient_exchange_balance" : "execution_error";

    await createHumanEvent({
      cycleId: cycle.id, pair, mode,
      eventType: "exit_failed",
      severity: "error",
      message: `Exit execution failed: ${errMsg}. Ciclo sigue activo.`,
      payloadJson: {
        exitType: signal.exitType,
        exitPrice: signal.exitPrice,
        error: errMsg,
        cycleStatus: "active",
      },
    }, { eventType: "exit_failed", pair, mode });

    if (mode === "live" && shouldSendSellFailedAlert(cycle.id, errorKey)) {
      const asset = pair.split("/")[0];
      await telegram.sendRawMessage(
        `🚨 <b>[IDCA][LIVE] VENTA FALLIDA</b>\n\n` +
        `Par: <b>${pair}</b> #${cycle.id}\n` +
        `Tipo: <code>${signal.exitType}</code>\n` +
        `Motivo: ${isBalanceFail ? "balance insuficiente real" : errMsg}\n` +
        (isBalanceFail
          ? `Cantidad ciclo: ${totalQty.toFixed(8)} ${asset}\n`
          : "") +
        `\nCiclo NO cerrado en DB. Revisar posición manualmente.`
      );
    }
  }
}

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

// FASE 8 — Adaptive scheduler: we use a recursive setTimeout instead of a fixed
// setInterval so the engine can sleep longer when idle and wake up faster when a
// protected cycle is near its exit trigger.
let schedulerTimeout: ReturnType<typeof setTimeout> | null = null;
let isRunning = false;
let lastTickAt: Date | null = null;
let lastError: string | null = null;
let tickCount = 0;
let lastSchedulerState: "idle" | "active" | "protected" | "init" = "init";

// Cache for market data
const priceCache = new Map<string, number>();
const ohlcCache = new Map<string, TimestampedCandle[]>();
const ohlcDailyCache = new Map<string, TimestampedCandle[]>();  // 1d candles for macro context (90d/180d)
const macroContextCache = new Map<string, IdcaMacroContext>();  // computed macro context per pair
const lastDailyFetchMs = new Map<string, number>();             // throttle: max 1 daily fetch per 6h per pair
const DAILY_FETCH_INTERVAL_MS = 6 * 60 * 60 * 1000;            // 6 hours
const lastEntryEventMs = new Map<string, number>();             // throttle: max 1 entry_evaluated DB event per 5min per pair
const ENTRY_EVENT_THROTTLE_MS = 5 * 60 * 1000;                 // 5 minutes
const lastObservedEventMs = new Map<string, number>();          // throttle: max 1 entry_observed event per 30min per pair
const OBSERVE_EVENT_THROTTLE_MS = 30 * 60 * 1000;              // 30 minutes
const migrationWarnedPairs = new Set<string>();                 // only warn ONCE per pair per process lifetime
// TODO: persistir en DB si se quiere sobrevivir reinicios (actualmente en memoria con TTL)
const lastDigestSentAt = new Map<string, number>();             // por modo: last time digest was sent

// Cooldown anti-spam: key = `${pair}#${cycleId}:${buyLevel}:${reason}` → nextAllowedAt ms
const safetyBuyCooldowns = new Map<string, number>();
const SAFETY_BUY_COOLDOWN_MS = 30 * 60 * 1000; // 30 min cooldown por insuf. balance
const UNKNOWN_PENDING_COOLDOWN_MS = 60 * 60 * 1000; // 60 min cooldown por ejecución desconocida

function getSafetyBuyCooldownKey(pair: string, cycleId: number, buyLevel: number, reason: string): string {
  const reasonTag = reason.startsWith("insufficient_exchange_balance") ? "insufficient_balance"
    : reason.startsWith("no_fill") || reason.startsWith("execution_unknown") ? "unknown_pending"
    : reason.substring(0, 30);
  return `${pair}#${cycleId}:${buyLevel}:${reasonTag}`;
}

function isSafetyBuyOnCooldown(pair: string, cycleId: number, buyLevel: number, reason: string): boolean {
  const key = getSafetyBuyCooldownKey(pair, cycleId, buyLevel, reason);
  const until = safetyBuyCooldowns.get(key);
  return until !== undefined && Date.now() < until;
}

function setSafetyBuyCooldown(pair: string, cycleId: number, buyLevel: number, reason: string): void {
  const key = getSafetyBuyCooldownKey(pair, cycleId, buyLevel, reason);
  const durationMs = (reason.startsWith("no_fill") || reason.startsWith("execution_unknown"))
    ? UNKNOWN_PENDING_COOLDOWN_MS
    : SAFETY_BUY_COOLDOWN_MS;
  safetyBuyCooldowns.set(key, Date.now() + durationMs);
  console.log(`${TAG}[BUY_COOLDOWN] ${pair} cycle#${cycleId} level=${buyLevel} reason=${reason.substring(0, 40)} cooldown=${Math.round(durationMs / 60000)}min`);
}

// VWAP anchor memory — frozen anchor that never goes down (only up or reset)
interface VwapAnchorPrevious {
  anchorPrice: number;
  anchorTimestamp: number;
  setAt: number;
  replacedAt: number;       // when it was replaced by a new anchor
}
interface VwapAnchorState {
  anchorPrice: number;      // price of the swing high that set the anchor
  anchorTimestamp: number;  // timestamp of that swing high (ms)
  setAt: number;            // when it was set (Date.now())
  drawdownPct: number;      // accumulated drawdown from anchor (updated each tick)
  previous?: VwapAnchorPrevious; // previous anchor (invalidated)
}
const vwapAnchorMemory = new Map<string, VwapAnchorState>();

// L1.4: Anti-spam para data_not_ready — emit once on cold start, then cooldown per pair+mode
const dataNotReadyLastSent = new Map<string, number>(); // key: `${pair}:${mode}`
const DATA_NOT_READY_COOLDOWN_MS = 5 * 60 * 1000;       // 5 minutos

// ─── Helper para obtener frozenAnchor (usado por servicios externos) ─────────

/**
 * Obtiene el frozenAnchor de memoria para un par específico.
 * Usado por IdcaMarketContextService para resolver la referencia efectiva.
 */
export function getFrozenAnchorFromMemory(pair: string): VwapAnchorState | undefined {
  return vwapAnchorMemory.get(pair);
}

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
    schedulerActive: schedulerTimeout !== null,
    schedulerState: lastSchedulerState,
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
  const trailingPct = assetConfig ? parseFloat(String(assetConfig.trailingMarginPct)) : 1.5;

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
    // Si ladder ATRP está activo, no usar safety orders legacy para evitar doble ejecución
    if (!assetConfig.ladderAtrpEnabled) {
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
    } else {
      console.log(`${TAG}[IMPORT] ${req.pair}: ladder ATRP enabled, skipping safety orders legacy calculation`);
    }
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

// FASE 8 — Adaptive scheduler
// State resolution:
//   protected → any active cycle with status in {tp_armed, trailing_active} OR protectionArmedAt set
//   active    → any active cycle (including imported, plus, recovery) for any pair
//   idle      → no active cycles at all
async function resolveSchedulerState(mode: IdcaMode): Promise<"idle" | "active" | "protected"> {
  try {
    // Checks current mode only; if mode=disabled we treat as idle (caller skips anyway).
    const checkMode = mode === "disabled" ? "simulation" : mode;
    const actives = await repo.getAllActiveCycles(checkMode);
    if (actives.length === 0) return "idle";
    const isProtected = actives.some(c =>
      c.status === "tp_armed" ||
      c.status === "trailing_active" ||
      !!c.protectionArmedAt
    );
    return isProtected ? "protected" : "active";
  } catch (e: any) {
    console.warn(`${TAG}[SCHED_STATE] resolve failed, defaulting to active: ${e?.message}`);
    return "active";
  }
}

function computeNextDelayMs(
  state: "idle" | "active" | "protected",
  config: import("@shared/schema").InstitutionalDcaConfigRow,
): number {
  // All three columns have DB-level defaults; fallback to legacy schedulerIntervalSeconds
  // if a column somehow ends up null (shouldn't happen after migration 027).
  const legacy = (config.schedulerIntervalSeconds ?? 60) * 1000;
  let secs: number;
  switch (state) {
    case "protected":
      secs = (config as any).schedulerProtectedSeconds ?? 120;
      break;
    case "active":
      secs = (config as any).schedulerActiveSeconds ?? 300;
      break;
    case "idle":
    default:
      secs = (config as any).schedulerIdleSeconds ?? 900;
      break;
  }
  const ms = Math.max(5_000, Number(secs) * 1000); // floor 5s defensive
  return ms > 0 ? ms : legacy;
}

async function scheduleNext(): Promise<void> {
  if (!isRunning) return;
  try {
    const config = await repo.getIdcaConfig();
    const mode = config.mode as IdcaMode;
    const state = mode === "disabled" ? "idle" : await resolveSchedulerState(mode);
    const delay = computeNextDelayMs(state, config);
    if (state !== lastSchedulerState) {
      console.log(`${TAG}[SCHED_STATE_CHANGE] ${lastSchedulerState} → ${state} (nextTick in ${Math.round(delay / 1000)}s)`);
      lastSchedulerState = state;
    }
    schedulerTimeout = setTimeout(() => {
      runTick()
        .catch(e => console.error(`${TAG}[ERROR]`, e.message))
        .finally(() => { void scheduleNext(); });
    }, delay);
  } catch (e: any) {
    console.error(`${TAG}[SCHED_ERR] scheduleNext failed: ${e?.message}. Falling back to 60s.`);
    schedulerTimeout = setTimeout(() => {
      runTick()
        .catch(er => console.error(`${TAG}[ERROR]`, er.message))
        .finally(() => { void scheduleNext(); });
    }, 60_000);
  }
}

async function loadAnchorsFromDb(): Promise<void> {
  try {
    const rows = await repo.loadAllVwapAnchors();
    for (const row of rows) {
      vwapAnchorMemory.set(row.pair, {
        anchorPrice:     parseFloat(row.anchorPrice),
        anchorTimestamp: row.anchorTs,
        setAt:           row.setAt,
        drawdownPct:     parseFloat(row.drawdownPct ?? "0"),
        previous: row.prevPrice != null ? {
          anchorPrice:     parseFloat(row.prevPrice),
          anchorTimestamp: row.prevTs!,
          setAt:           row.prevSetAt!,
          replacedAt:      row.prevReplacedAt!,
        } : undefined,
      });
    }
    console.log(`${TAG}[VWAP_ANCHOR] Loaded ${rows.length} anchor(s) from DB: ${rows.map(r => `${r.pair}=$${parseFloat(r.anchorPrice).toFixed(2)}`).join(", ") || "none"}`);
  } catch (e: any) {
    console.warn(`${TAG}[VWAP_ANCHOR] Could not load anchors from DB (table may not exist yet): ${e.message}`);
  }
}

export async function startScheduler(): Promise<void> {
  if (schedulerTimeout) return;

  // ── HOTFIX: Startup Reconciliation ─────────────────────────────────
  // Ejecutar reconciliación ANTES de arrancar el scheduler
  if (!startupReconciliationCompleted) {
    console.log(`${TAG} Running startup reconciliation before scheduler...`);
    try {
      startupReconciliationResult = await runStartupReconciliation();
      startupReconciliationCompleted = true;

      if (!isSafeToStartAfterReconciliation(startupReconciliationResult)) {
        // Solo errores críticos bloquean el scheduler global
        console.error(`${TAG} ==========================================`);
        console.error(`${TAG} SCHEDULER BLOCKED: Critical reconciliation errors`);
        console.error(`${TAG} Critical errors: ${startupReconciliationResult.criticalErrors.length}`);
        for (const err of startupReconciliationResult.criticalErrors) {
          console.error(`${TAG}   - ${err}`);
        }
        console.error(`${TAG} ==========================================`);
        // NO arrancar scheduler - queda en modo seguro
        return;
      }

      // Scheduler puede arrancar - mostrar resumen
      const cyclesNeedingReview = startupReconciliationResult.cyclesNeedingReview || [];
      if (cyclesNeedingReview.length > 0) {
        console.log(`${TAG} [STARTUP] Scheduler starting with ${cyclesNeedingReview.length} cycles needing review (automation skipped for these)`);
        for (const c of cyclesNeedingReview) {
          console.log(`${TAG} [STARTUP]   - ${c.pair} #${c.cycleId}: ${c.reason}`);
        }
      }
      console.log(`${TAG} Startup reconciliation passed: ${startupReconciliationResult.cyclesChecked} cycles checked, ${startupReconciliationResult.phantomsVoided} phantoms voided`);
    } catch (error: any) {
      console.error(`${TAG} Startup reconciliation FAILED: ${error.message}`);
      console.error(`${TAG} Scheduler NOT started due to reconciliation error`);
      return;
    }
  }

  const config = await repo.getIdcaConfig();
  const idle = (config as any).schedulerIdleSeconds ?? 900;
  const active = (config as any).schedulerActiveSeconds ?? 300;
  const protectedSec = (config as any).schedulerProtectedSeconds ?? 120;

  // ── Startup config log ──────────────────────────────────────────
  const execFees = (config as any).executionFeesJson as any;
  const entryUi = (config as any).entryUiJson as any;
  const telegramUi = (config as any).telegramUiJson as any;
  const feeSource = execFees ? "stored" : "default";
  const feeExchange = execFees?.exchange ?? "revolut_x";
  const feeMaker = execFees?.makerFeePct ?? 0;
  const feeTaker = execFees?.takerFeePct ?? 0.09;
  console.log(`[IDCA_FEES] using executionFeesJson exchange=${feeExchange} maker=${feeMaker}% taker=${feeTaker}% source=${feeSource}`);
  console.log(
    `${TAG} Scheduler starting (adaptive: idle=${idle}s, active=${active}s, protected=${protectedSec}s)` +
    ` | mode=${config.mode} | fees=${feeExchange} taker=${feeTaker}%` +
    ` | entrySliders=${entryUi ? `patience=${entryUi.entryPatienceLevel ?? 70}` : "default"}` +
    ` | telegramSliders=${telegramUi ? `freq=${telegramUi.telegramAlertFrequencyLevel ?? 85}` : "default"}`
  );
  await loadAnchorsFromDb();
  // Reconstruct anti-spam Trailing Buy state from DB so ARMED is not re-sent after restart
  for (const pair of INSTITUTIONAL_DCA_ALLOWED_PAIRS) {
    for (const mode of ["simulation", "live"]) {
      void tbState.loadStateFromDb(pair, mode);
    }
  }
  isRunning = true;

  // Initial tick after 2s; subsequent ticks are scheduled by scheduleNext().
  schedulerTimeout = setTimeout(() => {
    runTick()
      .catch(e => console.error(`${TAG}[ERROR]`, e.message))
      .finally(() => { void scheduleNext(); });
  }, 2000);
}

export function stopScheduler(): void {
  if (schedulerTimeout) {
    clearTimeout(schedulerTimeout);
    schedulerTimeout = null;
  }
  isRunning = false;
  lastSchedulerState = "init";
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

  // ─── Lote 4: Cancel all pending exit instructions before bulk close ───
  try {
    const activeCyclesBefore = await repo.getAllActiveCycles(mode);
    for (const c of activeCyclesBefore) {
      await exitRepo.cancelActiveExitInstructionForCycle(c.id, "emergency_close_all");
    }
  } catch (cancelErr: any) {
    console.error(`${TAG}[EMERGENCY_CLOSE] Failed to cancel exit instructions: ${cancelErr.message}`);
  }

  const closed = await repo.closeCyclesBulk(mode, "emergency_close_all", prices);

  // If live mode, attempt market sells
  if (mode === "live") {
    const activeCycles = await repo.getAllActiveCycles("live");
    for (const cycle of activeCycles) {
      if (parseFloat(String(cycle.totalQuantity)) > 0) {
        try {
          await executeRealSell(cycle, "emergency_sell", parseFloat(String(cycle.totalQuantity)), true);
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
  
  // Limpiar todos los estados de trailing buy para este modo
  for (const pair of INSTITUTIONAL_DCA_ALLOWED_PAIRS) {
    if (TrailingBuyManager.isArmed(pair)) {
      TrailingBuyManager.disarm(pair);
    }
    tbState.resetTrailingBuyTelegramState(pair, mode, "emergency_close");
  }
  
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

    // ─── Lote 4: Process triggered exit instructions ───────────────
    try {
      const currentPrices: Record<string, number> = {};
      for (const pair of INSTITUTIONAL_DCA_ALLOWED_PAIRS) {
        currentPrices[pair] = await getCurrentPrice(pair);
      }
      await processTriggeredExitInstructions(mode, currentPrices);
    } catch (exitErr: any) {
      console.error(`${TAG}[EXIT_INSTR_ERR] ${exitErr.message}`);
    }

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

    // Digest: enviar resumen agrupado Trailing Buy si la política lo requiere
    try {
      const tbPolicy = resolveTrailingBuyPolicyWithSliders(
        config.telegramAlertTogglesJson || {},
        config.telegramUiJson || {},
      );
      if (shouldSendDigest(lastDigestSentAt.get(mode) ?? 0, tbPolicy)) {
        lastDigestSentAt.set(mode, Date.now());
        const digestEntries = (INSTITUTIONAL_DCA_ALLOWED_PAIRS
          .map(p => {
            const tbManagerState = TrailingBuyManager.getState(p);
            if (!tbManagerState) return null;
            const telegramState = tbState.getTrailingBuyTelegramState(p, mode);
            const stateLabel = (() => {
              switch (telegramState?.state) {
                case "armed":    return "Trailing Buy armado";
                case "tracking": return "Siguiendo el m\u00ednimo";
                case "watching": return "Cerca de zona de entrada";
                default:         return "En seguimiento";
              }
            })();
            const rtp = tbManagerState.localLow > 0
              ? tbManagerState.localLow * (1 + tbManagerState.trailingPct / 100)
              : undefined;
            const entry: TrailingBuyDigestEntry = {
              pair: p as string,
              stateLabel,
              referencePrice: tbManagerState.referencePrice,
              localLow: tbManagerState.localLow,
              reboundTriggerPrice: rtp,
              maxExecutionPrice: tbManagerState.maxExecutionPrice,
            };
            return entry;
          })
          .filter(e => e !== null)) as TrailingBuyDigestEntry[];
        if (digestEntries.length > 0) {
          telegram.sendTrailingBuyDigest(mode, digestEntries)
            .catch((e2: unknown) => console.warn(`${TAG}[TELEGRAM] digest failed: ${(e2 as Error).message}`));
          console.log(`${TAG}[TELEGRAM_DIGEST_SENT] mode=${mode} pairs=${digestEntries.map(de => de.pair).join(",")}`);
        }
      }
    } catch (digestErr: any) {
      console.warn(`${TAG}[DIGEST_ERR] ${digestErr.message}`);
    }
  } catch (e: any) {
    lastError = e.message;
    console.error(`${TAG}[ERROR] Tick failed:`, e.message);
  }
}

// ─── Pair Disabled Log (throttled: 1 per 4 hours per pair) ──────────
const pairDisabledLastLogAt = new Map<string, number>();
const PAIR_DISABLED_LOG_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

function emitPairDisabledLog(pair: string, mode: string): void {
  const key = `${pair}#${mode}`;
  const now = Date.now();
  const lastAt = pairDisabledLastLogAt.get(key) ?? 0;
  if (now - lastAt >= PAIR_DISABLED_LOG_INTERVAL_MS) {
    console.log(`${TAG}[PAIR_DISABLED] ${pair} mode=${mode} operationMode=exit_only reason=no_new_buys`);
    pairDisabledLastLogAt.set(key, now);
  }
}

// ─── Pair Evaluation ───────────────────────────────────────────────

async function evaluatePair(
  pair: string,
  config: InstitutionalDcaConfigRow,
  mode: IdcaMode
): Promise<void> {
  console.log(`${TAG}[EVAL_START] pair=${pair}`);
  const assetConfig = await repo.getAssetConfig(pair);
  if (!assetConfig) {
    console.warn(`${TAG}[EVAL_SKIP] ${pair}: no assetConfig in DB`);
    return;
  }
  // ─── EXIT-ONLY MODE: Si par desactivado, gestionar salidas pero no compras ───
  const pairDisabled = !assetConfig.enabled;
  if (pairDisabled) {
    // Limpiar trailing buy si el par se desactivó
    if (TrailingBuyManager.isArmed(pair)) {
      TrailingBuyManager.disarm(pair);
      tbState.resetTrailingBuyTelegramState(pair, mode, "asset_disabled");
    }
    // Log throttled: solo emitir cada 4 horas por par
    emitPairDisabledLog(pair, mode);
  }

  const currentPrice = await getCurrentPrice(pair);
  if (currentPrice <= 0) {
    console.warn(`${TAG}[EVAL_SKIP] ${pair}: currentPrice=${currentPrice}`);
    return;
  }

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
    await manageCycle(ic, currentPrice, config, assetConfig, mode, pairDisabled);
    if (!ic.soloSalida && !pairDisabled) {
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
    // Log de referencia del ciclo cuando hay frozen anchor
    const frozenAnchor = vwapAnchorMemory.get(pair);
    if (frozenAnchor && frozenAnchor.anchorPrice > 0) {
      const avgEntry = parseFloat(String(activeCycle.avgEntryPrice || "0"));
      const nextBuy = parseFloat(String(activeCycle.nextBuyPrice || "0"));
      const ageHours = (Date.now() - frozenAnchor.setAt) / (1000 * 60 * 60);
      console.log(
        `[IDCA][CYCLE_REFERENCE]` +
        ` pair=${pair}` +
        ` cycleId=${activeCycle.id}` +
        ` frozen_reference=${frozenAnchor.anchorPrice.toFixed(2)}` +
        ` avg=${avgEntry.toFixed(2)}` +
        ` nextBuyPrice=${nextBuy.toFixed(2)}` +
        ` source=vwap_anchor` +
        ` ageHours=${ageHours.toFixed(1)}`
      );
    }

    // Manage existing autonomous main cycle (exits always allowed)
    await manageCycle(activeCycle, currentPrice, config, assetConfig, mode, pairDisabled);

    // Plus/Recovery: solo si par activo
    if (!pairDisabled) {
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
    }
  } else {
    // Check for orphaned bot subcycles (plus/recovery without a main)
    const hasAny = await repo.hasActiveBotCycleForPair(pair, mode);
    const hasImported = (await repo.getActiveImportedCycles(pair, mode)).length > 0;
    // Cleanup: disarm trailing buy if cycle exists but was armed before deploy
    if ((hasAny || hasImported) && TrailingBuyManager.isArmed(pair)) {
      TrailingBuyManager.disarm(pair);
      tbState.resetTrailingBuyTelegramState(pair, mode, "cycle_active_cleanup");
    }
    if (!hasAny && !hasImported && !pairDisabled) {
      // No cycle active (bot or manual/imported) — look for new autonomous entry

      // ── IDCA Hybrid Intelligent Layers ─────────────────────────────
      // mode=off → idcaAction='legacy' (zero overhead, falls through immediately)
      // mode=observer → evaluates + persists, never blocks
      // mode=real → can return 'block_buy', 'reduce_size', 'allow_buy'
      try {
        const hybridDecision = await idcaHybridDecisionService.evaluate({
          pair,
          cycleId: null,
          currentPrice,
          cycleCapitalUsd: 0,
          frozenAnchorPrice: vwapAnchorMemory.get(pair)?.anchorPrice,
        });
        if (hybridDecision.mode === "real" && hybridDecision.idcaAction === "block_buy") {
          console.log(`${TAG}[HYBRID_BLOCK] ${pair}: ${hybridDecision.naturalReason}`);
          return; // skip checkEntry — hybrid blocks this buy in real mode
        }
      } catch (hybridErr: any) {
        console.warn(`${TAG}[HYBRID] evaluate failed (non-fatal): ${hybridErr?.message}`);
      }

      // ── Entry check with VWAP logic ────────────────────────────────
      if (assetConfig.vwapEnabled) {
        // ── Trailing Buy (VWAP-driven) ─────────────────────────────
        // Trailing buy manages the ARM/DISARM state and gates the actual purchase.
        // checkEntry() is ALWAYS called so that entry_check_blocked events are
        // generated every tick for ALL pairs (BTC/USD included) regardless of
        // trailing state. Without this, pairs with vwapEnabled=true in neutral
        // zone would never produce any UI events.
        const tbCandles = ohlcCache.get(pair) || [];
        let trailingAllowsEntry = false; // true only when trailing buy fires
        let trailingBuyTriggerData: { localLow: number; bouncePct: number; buyThreshold: number; maxExecutionPrice: number } | undefined;

        const MIN_VWAP_CANDLES_FOR_ENTRY = 24;
        if (tbCandles.length >= 7) {
          const anchor24h = Date.now() - 24 * 60 * 60 * 1000;
          const tbVwap = smart.computeVwapAnchored(tbCandles, anchor24h);
          if (tbVwap.isReliable) {
            const tbZone = smart.getVwapBandPosition(currentPrice, tbVwap).zone;
            const inInterestZone = tbZone === "below_lower1" || tbZone === "below_lower2" || tbZone === "below_lower3";
            const inNeutralOrAbove = tbZone === "between_bands" || tbZone === "above_upper1" || tbZone === "above_upper2";

            // Guard FASE 5: VWAP solo puede armar TB si tiene suficientes candles (datos maduros)
            const vwapReliableForEntry = tbVwap.candlesUsed >= MIN_VWAP_CANDLES_FOR_ENTRY;
            if (!vwapReliableForEntry) {
              console.log(`${TAG}[VWAP_RELIABILITY] pair=${pair} candlesUsed=${tbVwap.candlesUsed} reliableForEntry=false reliableForContext=true reason=insufficient_vwap_candles minRequired=${MIN_VWAP_CANDLES_FOR_ENTRY}`);
            }

            // Guard FASE 2: computar buyThreshold real usando resolver de distancia
            const tbDerived = getEffectiveEntryConfig(config, pair); // mantener para reboundPct y otros
            const tbFrozenAnchor = vwapAnchorMemory.get(pair);
            const tbEffectiveRef = tbFrozenAnchor?.anchorPrice && tbFrozenAnchor.anchorPrice > 0
              ? tbFrozenAnchor.anchorPrice
              : tbVwap.lowerBand1;
            const tbEntryMode = (assetConfig.entryMode ?? "assisted_entry") as IdcaEntryMode;
            const tbDistanceResult = resolveIdcaRequiredDistance({
              pair,
              usedFor: "trailing_buy_entry",
              activeEntryMode: tbEntryMode,
              referencePrice: tbEffectiveRef,
              atrPct: getVolatility(pair),
              entryGlobalConfig: config,
              dynamicDistanceConfig: parseDynamicDistanceConfig(assetConfig.dynamicDistanceConfigJson),
              buyCount: 0,
              marketScore: 50,  // Sprint 1a: safe default para TB pre-ciclo
              candleCount: tbCandles.length,
              capitalUsedUsd: 0,
              capitalReservedUsd: 0,
              tbPath: "vwap_anchor",
            });
            logDistanceResolution(TAG, pair, tbDistanceResult, { referencePrice: tbEffectiveRef, currentPrice });
            const tbBuyThreshold = tbEffectiveRef * (1 - tbDistanceResult.requiredDistancePct / 100);

            // ─── HOTFIX: Stale reference guard ──────────────────────────────────────────
            // If trailing buy was armed BEFORE a dynamic anchor renewal, its snapshot
            // of referencePrice is stale. Disarm + let arm block re-arm with new ref.
            // Skip if: no active cycle (checked by caller), diff ≤ 0.25% (noise), or not armed.
            if (TrailingBuyManager.isArmed(pair)) {
              const tbStaleState = TrailingBuyManager.getState(pair);
              if (tbStaleState) {
                const tbStaleRefDiff = tbStaleState.referencePrice > 0
                  ? Math.abs(tbEffectiveRef - tbStaleState.referencePrice) / tbStaleState.referencePrice
                  : 1;
                if (tbStaleRefDiff > 0.0025) {
                  const oldRef = tbStaleState.referencePrice;
                  const oldLocalLow = tbStaleState.localLow;
                  console.log(
                    `${TAG}[TRAILING_BUY_REFERENCE_REFRESH] pair=${pair}` +
                    ` old=${oldRef.toFixed(2)} new=${tbEffectiveRef.toFixed(2)}` +
                    ` reason=dynamic_anchor_renewed activeCycle=false`
                  );
                  TrailingBuyManager.disarm(pair);
                  tbState.resetTrailingBuyTelegramState(pair, mode, "reference_refreshed");
                  await createHumanEvent({
                    pair, mode,
                    eventType: "trailing_buy_reference_refreshed",
                    severity: "info",
                    message: `Trailing buy rearmado: ancla dinámica renovada. Ref anterior: $${oldRef.toFixed(2)} → Nueva: $${tbEffectiveRef.toFixed(2)} (diff=${(tbStaleRefDiff * 100).toFixed(3)}%)`,
                    payloadJson: {
                      pair,
                      oldReference: oldRef,
                      newReference: tbEffectiveRef,
                      oldBestObservedPrice: oldLocalLow,
                      reason: "dynamic_anchor_renewed",
                      activeCycleExists: false,
                      diffPct: parseFloat((tbStaleRefDiff * 100).toFixed(4)),
                    },
                  }, { eventType: "trailing_buy_reference_refreshed", pair, mode });
                }
              }
            }

            // Arm: precio entra en zona VWAP Y toca buyThreshold real Y VWAP tiene datos maduros
            if (inInterestZone && vwapReliableForEntry && currentPrice <= tbBuyThreshold && !TrailingBuyManager.isArmed(pair)) {
              const reboundMinPct = tbDerived.reboundPct;
              const drawdownFromReferencePct = tbEffectiveRef > 0
                ? ((tbEffectiveRef - currentPrice) / tbEffectiveRef) * 100
                : 0;
              const atrPct = getVolatility(pair);
              const dynamicReboundConfig = (assetConfig as any).dynamicReboundConfigJson || null;

              // Prepare arm options with dynamic rebound parameters if applicable
              const armOpts: any = { trailingPct: reboundMinPct };
              if (tbEntryMode === "dynamic_intelligent_entry" && dynamicReboundConfig) {
                armOpts.entryMode = tbEntryMode;
                armOpts.dynamicReboundConfig = dynamicReboundConfig;
                armOpts.requiredDistancePct = tbDistanceResult.requiredDistancePct;
                armOpts.drawdownFromReferencePct = drawdownFromReferencePct;
                armOpts.atrPct = atrPct;
                armOpts.tbPath = "vwap_anchor";
              }

              TrailingBuyManager.arm(pair, tbEffectiveRef, currentPrice, armOpts);
              const tbArmedState = TrailingBuyManager.getState(pair);
              const reboundTriggerPrice = tbArmedState?.localLow
                ? tbArmedState.localLow * (1 + tbArmedState.trailingPct / 100)
                : currentPrice * (1 + reboundMinPct / 100);
              const maxExecPriceArmed = tbArmedState?.maxExecutionPrice ?? (tbBuyThreshold * (1 + reboundMinPct / 100));

              // Build payload with dynamic rebound data if available
              const payloadJson: any = {
                price: currentPrice,
                zone: tbZone,
                lowerBand1: tbVwap.lowerBand1,
                reboundMinPct,
                effectiveRef: tbEffectiveRef,
                buyThreshold: tbBuyThreshold,
                candlesUsed: tbVwap.candlesUsed,
                entryMode: tbEntryMode,
                reboundSource: armOpts.entryMode === "dynamic_intelligent_entry" ? "dynamic_rebound" : "legacy_rebound",
                actualReboundPct: tbArmedState?.trailingPct,
                actualTriggerPrice: reboundTriggerPrice,
                maxExecutionPrice: maxExecPriceArmed,
                retainedDropPct: tbEffectiveRef > 0
                  ? ((tbEffectiveRef - maxExecPriceArmed) / tbEffectiveRef) * 100
                  : null,
              };

              await createHumanEvent({
                pair, mode,
                eventType: "trailing_buy_activated",
                severity: "info",
                message: `Trailing buy armed: price $${currentPrice.toFixed(2)} in ${tbZone}, lowerBand1=$${tbVwap.lowerBand1.toFixed(2)}, reboundPct=${tbArmedState?.trailingPct?.toFixed(3)}%`,
                payloadJson,
              }, { eventType: "trailing_buy_activated", pair, mode });

              telegram.alertTrailingBuyArmed(pair, mode, currentPrice, tbEffectiveRef, tbBuyThreshold, reboundTriggerPrice, maxExecPriceArmed)
                .catch(e => console.warn(`${TAG}[TELEGRAM] alertTrailingBuyArmed failed: ${e.message}`));
            }

            // Update: si está armado, seguir el mínimo y notificar con throttle
            if (TrailingBuyManager.isArmed(pair)) {
              const tbManagerState = TrailingBuyManager.getState(pair);
              const tbResult = TrailingBuyManager.update(pair, currentPrice);
              
              // Notificar tracking throttled (no en cada tick)
              if (tbManagerState && !tbResult.triggered) {
                const check = tbState.shouldNotifyTracking(pair, mode, tbManagerState.localLow);
                if (check.should) {
                  const lastTgState = tbState.getTrailingBuyTelegramState(pair, mode);
                  const minutesSince = lastTgState ? Math.round((Date.now() - lastTgState.lastNotifiedAt) / 60000) : 15;
                  const reboundMinPct = parseFloat(String(assetConfig.reboundMinPct ?? "0.50"));
                  const reboundTriggerPrice = tbManagerState.localLow * (1 + reboundMinPct / 100);
                  telegram.alertTrailingBuyTracking(pair, mode, currentPrice, tbManagerState.localLow, reboundTriggerPrice, minutesSince, {
                    referencePrice: tbManagerState.referencePrice,
                    buyThreshold: tbManagerState.buyThreshold,
                    maxExecutionPrice: tbManagerState.maxExecutionPrice,
                  }).catch(e => console.warn(`${TAG}[TELEGRAM] alertTrailingBuyTracking failed: ${e.message}`));
                }
              }
              
              if (tbResult.triggered) {
                // ─── HOTFIX: Pre-purchase stale reference guard (task 5) ───────────────
                // Edge case: anchor renews in a previous stage of the same tick
                // (inside checkEntry). Verify reference used at arm still matches.
                const tbTriggerRefDiff = tbManagerState && tbEffectiveRef > 0
                  ? Math.abs(tbEffectiveRef - tbManagerState.referencePrice) / tbManagerState.referencePrice
                  : 0;
                if (tbTriggerRefDiff > 0.0025) {
                  console.log(
                    `${TAG}[TRAILING_BUY_REFERENCE_STALE_BLOCKED] pair=${pair}` +
                    ` trailingRef=${tbManagerState!.referencePrice.toFixed(2)}` +
                    ` currentRef=${tbEffectiveRef.toFixed(2)}` +
                    ` action=refresh_no_buy`
                  );
                  await createHumanEvent({
                    pair, mode,
                    eventType: "trailing_buy_reference_stale_blocked",
                    severity: "warn",
                    message: `Trailing buy trigger bloqueado: referencia stale ($${tbManagerState!.referencePrice.toFixed(2)}) vs referencia actual ($${tbEffectiveRef.toFixed(2)}). No se ejecuta compra.`,
                    payloadJson: {
                      pair,
                      trailingRef: tbManagerState!.referencePrice,
                      currentRef: tbEffectiveRef,
                      diffPct: parseFloat((tbTriggerRefDiff * 100).toFixed(4)),
                      action: "refresh_no_buy",
                    },
                  }, { eventType: "trailing_buy_reference_stale_blocked", pair, mode });
                  tbState.resetTrailingBuyTelegramState(pair, mode, "reference_stale_blocked");
                  // TB already disarmed by update(); stale guard on next tick will re-arm with new ref
                } else {
                // Trailing confirmó rebote → permitir ejecución de compra
                const tbState$ = TrailingBuyManager.getState(pair); // puede ser undefined ya (disarmed)
                const tbBuyThreshold = tbResult.buyThreshold ?? tbState$?.buyThreshold ?? currentPrice;
                const tbMaxExecutionPrice = tbResult.maxExecutionPrice ?? tbState$?.maxExecutionPrice ?? currentPrice * 1.01;
                trailingBuyTriggerData = {
                  localLow: tbResult.localLow,
                  bouncePct: tbResult.bouncePct,
                  buyThreshold: tbBuyThreshold,
                  maxExecutionPrice: tbMaxExecutionPrice,
                };
                await createHumanEvent({
                  pair, mode,
                  eventType: "trailing_buy_triggered",
                  severity: "info",
                  message: `Trailing buy triggered: bounce ${tbResult.bouncePct.toFixed(3)}% from low $${tbResult.localLow.toFixed(2)} | buyThreshold=$${tbBuyThreshold.toFixed(2)} maxExec=$${tbMaxExecutionPrice.toFixed(2)}`,
                  payloadJson: { ...tbResult, zone: tbZone, buyThreshold: tbBuyThreshold, maxExecutionPrice: tbMaxExecutionPrice },
                }, { eventType: "trailing_buy_triggered", pair, mode });
                telegram.alertTrailingBuyTriggered(pair, mode, currentPrice, tbResult.bouncePct, tbResult.localLow, tbResult.maxExecutionPrice)
                  .catch(e => console.warn(`${TAG}[TELEGRAM] alertTrailingBuyTriggered failed: ${e.message}`));
                trailingAllowsEntry = true;
                } // end stale-ref-ok branch
              } else if (tbResult.reason === "expired") {
                // Trailing buy expiró por timeout
                await createHumanEvent({
                  pair, mode,
                  eventType: "trailing_buy_reset",
                  severity: "info",
                  message: `Trailing buy expired: timeout reached`,
                  payloadJson: { price: currentPrice, zone: tbZone, reason: "expired" },
                }, { eventType: "trailing_buy_reset", pair, mode });
                telegram.alertTrailingBuyCancelled(pair, mode, currentPrice, "timeout")
                  .catch(e => console.warn(`${TAG}[TELEGRAM] alertTrailingBuyCancelled(expired) failed: ${e.message}`));
              } else if (tbResult.reason?.startsWith("recovered")) {
                // Histéresis: solo cancelar si 2 ticks consecutivos sobre threshold
                const doCancel = tbState.cancelIncrement(pair, mode);
                if (doCancel) {
                  // Trailing buy cancelado por recuperación de precio (Manager level 1)
                  await createHumanEvent({
                    pair, mode,
                    eventType: "trailing_buy_reset",
                    severity: "info",
                    message: `Trailing buy cancelled: price recovered above threshold`,
                    payloadJson: { price: currentPrice, zone: tbZone, reason: tbResult.reason },
                  }, { eventType: "trailing_buy_reset", pair, mode });
                  telegram.alertTrailingBuyCancelled(pair, mode, currentPrice, "price_recovered")
                    .catch(e => console.warn(`${TAG}[TELEGRAM] alertTrailingBuyCancelled(recovered) failed: ${e.message}`));
                } else {
                  console.log(`${TAG}[TRAILING_BUY] ${pair} price_recovered tick 1/${2} (histéresis) — esperando confirmación`);
                }
              }
            }

            // Disarm: precio vuelve a zona neutral sin haber comprado
            if (inNeutralOrAbove && TrailingBuyManager.isArmed(pair)) {
              // Histéresis: acumular ticks antes de cancelar por zona neutral
              const doCancel = tbState.cancelIncrement(pair, mode);
              if (doCancel) {
                TrailingBuyManager.disarm(pair);
                await createHumanEvent({
                  pair, mode,
                  eventType: "trailing_buy_reset",
                  severity: "info",
                  message: `Trailing buy disarmed: price returned to ${tbZone}`,
                  payloadJson: { price: currentPrice, zone: tbZone, reason: "price_returned_to_neutral" },
                }, { eventType: "trailing_buy_reset", pair, mode });
                telegram.alertTrailingBuyCancelled(pair, mode, currentPrice, "price_recovered")
                  .catch(e => console.warn(`${TAG}[TELEGRAM] alertTrailingBuyCancelled failed: ${e.message}`));
              } else {
                console.log(`${TAG}[TRAILING_BUY] ${pair} returned to neutral tick 1/${2} (histéresis) — waiting`);
              }
            } else if (!inNeutralOrAbove && TrailingBuyManager.isArmed(pair)) {
              // Precio sigue en zona de interés — resetear contador histéresis
              tbState.cancelReset(pair, mode);
            }
          }
        }

        // Check trailing buy level 1 configuration
        const trailingBuyLevel1Config = assetConfig.trailingBuyLevel1ConfigJson as import('./IdcaTypes').TrailingBuyLevel1Config | null | undefined;
        if (trailingBuyLevel1Config?.enabled && !trailingAllowsEntry) {
          // Check if we should trigger trailing buy for specific level
          const triggerLevel = trailingBuyLevel1Config.triggerLevel;
          
          // Get ladder ATRP levels if available
          let triggerPrice: number | undefined;
          if (assetConfig.ladderAtrpEnabled && assetConfig.ladderAtrpConfigJson) {
            // Use ladder ATRP to determine trigger price
            try {
              const { idcaLadderAtrpService } = await import('./IdcaLadderAtrpService');
              const frozenAnchor = vwapAnchorMemory.get(pair);
              const ladder = await idcaLadderAtrpService.calculateLadder(
                pair, 
                assetConfig.ladderAtrpConfigJson as import('./IdcaTypes').LadderAtrpConfig,
                undefined,
                frozenAnchor?.anchorPrice
              );
              const level = ladder.levels.find(l => l.level === triggerLevel);
              if (level) {
                triggerPrice = level.triggerPrice;
                console.log(`${TAG}[TRAILING_BUY_L1] ${pair}: using ladder level ${triggerLevel}, triggerPrice=${triggerPrice.toFixed(2)}`);
              } else {
                console.warn(`${TAG}[TRAILING_BUY_L1] ${pair}: ladder level ${triggerLevel} not found in ladder (totalLevels=${ladder.totalLevels})`);
              }
            } catch (error) {
              console.error(`${TAG}[TRAILING_BUY_L1] Failed to get ladder ATRP for ${pair}:`, error);
            }
          }
          
          // Fallback to safety orders ONLY if ladder ATRP is NOT enabled
          if (!triggerPrice && !assetConfig.ladderAtrpEnabled && assetConfig.safetyOrdersJson) {
            const safetyOrders = Array.isArray(assetConfig.safetyOrdersJson) ? assetConfig.safetyOrdersJson : [];
            if (triggerLevel === 0) {
              // Base buy - use current dip calculation
              const dipPct = parseFloat(String(assetConfig.minDipPct || "2.0"));
              const { idcaMarketContextService } = await import('./IdcaMarketContextService');
              const context = await idcaMarketContextService.getMarketContext(pair);
              triggerPrice = context.anchorPrice * (1 - dipPct / 100);
            } else if (triggerLevel <= safetyOrders.length) {
              const safetyOrder = safetyOrders[triggerLevel - 1];
              if (safetyOrder) {
                const { idcaMarketContextService } = await import('./IdcaMarketContextService');
                const context = await idcaMarketContextService.getMarketContext(pair);
                triggerPrice = context.anchorPrice * (1 - safetyOrder.dipPct / 100);
              }
            }
          } else if (!triggerPrice && assetConfig.ladderAtrpEnabled) {
            // Ladder is enabled but triggerPrice not found - do not fallback to VWAP
            console.warn(`${TAG}[TRAILING_BUY_L1] ${pair}: ladder ATRP enabled but triggerPrice not found for level ${triggerLevel}, skipping trailing buy trigger`);
          }
          
          if (triggerPrice) {
            // ── OPCIÓN B: effectiveEntryReference = frozenAnchorPrice (o fallback triggerPrice) ──
            // buyThreshold = effectiveEntryReference * (1 - minDipPct/100)
            //   → WATCHING si currentPrice > buyThreshold
            //   → ARMED    si currentPrice <= buyThreshold (y no armado aún)
            const frozenAnchor$ = vwapAnchorMemory.get(pair);
            const effectiveEntryReference = frozenAnchor$?.anchorPrice && frozenAnchor$.anchorPrice > 0
              ? frozenAnchor$.anchorPrice
              : triggerPrice; // fallback al precio del nivel ladder
            // Resolver de distancia: fuente de verdad para umbral de trailing buy L1
            const derived = getEffectiveEntryConfig(config, pair); // mantener para maxOvershootPct y otros
            const tbL1EntryMode = (assetConfig.entryMode ?? "assisted_entry") as IdcaEntryMode;
            const tbL1DistanceResult = resolveIdcaRequiredDistance({
              pair,
              usedFor: "trailing_buy_entry",
              activeEntryMode: tbL1EntryMode,
              referencePrice: effectiveEntryReference,
              atrPct: getVolatility(pair),
              entryGlobalConfig: config,
              dynamicDistanceConfig: parseDynamicDistanceConfig(assetConfig.dynamicDistanceConfigJson),
              buyCount: 0,
              marketScore: 50,  // Sprint 1a: safe default para TB pre-ciclo
              candleCount: ohlcCache.get(pair)?.length ?? 0,
              capitalUsedUsd: 0,
              capitalReservedUsd: 0,
              tbPath: "level_1",
            });
            logDistanceResolution(TAG, pair, tbL1DistanceResult, { referencePrice: effectiveEntryReference, currentPrice });
            const effectiveMinDipPct = tbL1DistanceResult.requiredDistancePct;
            const buyThreshold = effectiveEntryReference * (1 - effectiveMinDipPct / 100);
            const maxOvershootPct = derived.maxExecutionOvershootPct;
            const maxExecutionPrice = buyThreshold * (1 + maxOvershootPct / 100);

            // ─── HOTFIX: Stale reference guard (Level 1 path) ───────────────────────
            // Same as VWAP path: if TB armed before anchor renewal, disarm and re-arm.
            if (TrailingBuyManager.isArmed(pair)) {
              const tbL1StaleState = TrailingBuyManager.getState(pair);
              if (tbL1StaleState) {
                const tbL1RefDiff = tbL1StaleState.referencePrice > 0
                  ? Math.abs(effectiveEntryReference - tbL1StaleState.referencePrice) / tbL1StaleState.referencePrice
                  : 1;
                if (tbL1RefDiff > 0.0025) {
                  const oldRefL1 = tbL1StaleState.referencePrice;
                  const oldLowL1 = tbL1StaleState.localLow;
                  console.log(
                    `${TAG}[TRAILING_BUY_REFERENCE_REFRESH] pair=${pair}` +
                    ` old=${oldRefL1.toFixed(2)} new=${effectiveEntryReference.toFixed(2)}` +
                    ` reason=dynamic_anchor_renewed activeCycle=false path=level1`
                  );
                  TrailingBuyManager.disarm(pair);
                  tbState.resetTrailingBuyTelegramState(pair, mode, "reference_refreshed");
                  await createHumanEvent({
                    pair, mode,
                    eventType: "trailing_buy_reference_refreshed",
                    severity: "info",
                    message: `Trailing buy L1 rearmado: ancla dinámica renovada. Ref anterior: $${oldRefL1.toFixed(2)} → Nueva: $${effectiveEntryReference.toFixed(2)} (diff=${(tbL1RefDiff * 100).toFixed(3)}%)`,
                    payloadJson: {
                      pair,
                      oldReference: oldRefL1,
                      newReference: effectiveEntryReference,
                      oldBestObservedPrice: oldLowL1,
                      reason: "dynamic_anchor_renewed",
                      activeCycleExists: false,
                      diffPct: parseFloat((tbL1RefDiff * 100).toFixed(4)),
                      path: "level1",
                    },
                  }, { eventType: "trailing_buy_reference_refreshed", pair, mode });
                }
              }
            }

            if (currentPrice > buyThreshold) {
              // ── WATCHING: precio está cayendo hacia la zona de activación ──
              const missingDipPct = ((currentPrice - buyThreshold) / currentPrice * 100).toFixed(2);
              console.log(
                `${TAG}[TRAILING_BUY_WATCHING] pair=${pair}` +
                ` referencePrice=$${effectiveEntryReference.toFixed(2)}` +
                ` buyThreshold=$${buyThreshold.toFixed(2)}` +
                ` currentPrice=$${currentPrice.toFixed(2)}` +
                ` missingDipPct=${missingDipPct}% status=not_armed_yet`
              );
              telegram.alertTrailingBuyWatching(pair, mode, currentPrice, effectiveEntryReference, buyThreshold)
                .catch(e => console.warn(`${TAG}[TELEGRAM] alertTrailingBuyWatching failed: ${e.message}`));

            } else if (!TrailingBuyManager.isArmed(pair)) {
              // ── ARMED: precio llegó al nivel de activación ──
              const atrPct = await getAtrPctForPair(pair);
              // Para rebound_pct: usar reboundPct derivado de slider (override del valor técnico)
              const sliderReboundPct = derived.reboundPct;
              const effectiveTrailingValue = trailingBuyLevel1Config.trailingMode === "rebound_pct"
                ? sliderReboundPct
                : trailingBuyLevel1Config.trailingValue; // atrp_fraction: usar valor técnico raw
              TrailingBuyManager.armLevel(pair, effectiveEntryReference, buyThreshold, currentPrice, triggerLevel, {
                trailingMode: trailingBuyLevel1Config.trailingMode,
                trailingValue: effectiveTrailingValue,
                maxWaitMinutes: trailingBuyLevel1Config.maxWaitMinutes,
                cancelOnRecovery: trailingBuyLevel1Config.cancelOnRecovery,
                atrpMultiplier: atrPct,
                maxExecutionPrice,
              });

              const trailingPct = trailingBuyLevel1Config.trailingMode === "rebound_pct"
                ? sliderReboundPct
                : effectiveTrailingValue * (atrPct ?? 1);
              const reboundTriggerPrice = currentPrice * (1 + trailingPct / 100);

              await createHumanEvent({
                pair, mode,
                eventType: "trailing_buy_level1_activated",
                severity: "info",
                message: `Trailing buy Level 1 ARMED: level ${triggerLevel} referencePrice=$${effectiveEntryReference.toFixed(2)} buyThreshold=$${buyThreshold.toFixed(2)} maxExecutionPrice=$${maxExecutionPrice.toFixed(2)} current=$${currentPrice.toFixed(2)}`,
                payloadJson: {
                  triggerLevel,
                  effectiveEntryReference,
                  buyThreshold,
                  maxExecutionPrice,
                  currentPrice,
                  reboundTriggerPrice,
                  trailingMode: trailingBuyLevel1Config.trailingMode,
                  trailingValue: trailingBuyLevel1Config.trailingValue,
                  entrySource: "trailing_buy",
                },
              }, { eventType: "trailing_buy_level1_activated", pair, mode });

              telegram.alertTrailingBuyArmed(pair, mode, currentPrice, effectiveEntryReference, buyThreshold, reboundTriggerPrice, maxExecutionPrice)
                .catch(e => console.warn(`${TAG}[TELEGRAM] alertTrailingBuyArmed L1 failed: ${e.message}`));
            }
          }
        }

        // Validate no double execution before proceeding
        const safetyOrders = Array.isArray(assetConfig.safetyOrdersJson) ? assetConfig.safetyOrdersJson : [];
        const validation = idcaMigrationService.validateNoDoubleExecution(
          pair,
          safetyOrders,
          assetConfig.ladderAtrpEnabled || false,
          assetConfig.ladderAtrpConfigJson as import('./IdcaTypes').LadderAtrpConfig | undefined
        );
        
        if (!validation.valid) {
          const warnKey = `${pair}:${mode}`;
          if (!migrationWarnedPairs.has(warnKey)) {
            migrationWarnedPairs.add(warnKey);
            // Ladder ATRP active → safetyOrdersJson legacy is silently ignored at runtime
            const activeSystem = idcaMigrationService.getActiveSystem(
              pair, safetyOrders, assetConfig.ladderAtrpEnabled || false,
              assetConfig.ladderAtrpConfigJson as import('./IdcaTypes').LadderAtrpConfig | undefined
            );
            console.warn(`${TAG}[MIGRATION] ${pair} (once): ${validation.issues.join(", ")}. ActiveSystem=${activeSystem}. safetyOrdersJson legacy IGNORED while Ladder ATRP is enabled.`);
            await createHumanEvent({
              pair, mode,
              eventType: "migration_validation_warning",
              severity: "warning",
              message: `Migration validation warning (logged once): ${validation.issues.join(", ")}. Ladder ATRP activo: safetyOrdersJson legacy ignorado.`,
              payloadJson: { issues: validation.issues, recommendation: validation.recommendation, activeSystem },
            }, { eventType: "migration_validation_warning", pair, mode });
          }
        }

        // Always run checkEntry for event generation (entry_check_blocked visible in UI).
        // If trailingAllowsEntry, this will also execute the buy (con bypass de insufficient_dip).
        await checkEntry(
          pair, currentPrice, config, assetConfig, mode,
          !trailingAllowsEntry,
          trailingAllowsEntry && trailingBuyTriggerData
            ? { localLow: trailingBuyTriggerData.localLow, bouncePct: trailingBuyTriggerData.bouncePct }
            : undefined,
          trailingAllowsEntry && trailingBuyTriggerData
            ? { localLow: trailingBuyTriggerData.localLow, buyThreshold: trailingBuyTriggerData.buyThreshold, maxExecutionPrice: trailingBuyTriggerData.maxExecutionPrice }
            : undefined,
        );
      } else {
        // Sin VWAP → comportamiento original directo
        await checkEntry(pair, currentPrice, config, assetConfig, mode, false);
      }
    } else if (hasImported && !hasAny) {
      // Imported/manual cycle active — run entry check in observe-only mode
      // (generates events + logs for UI, but does NOT create a new cycle or buy)
      await checkEntry(pair, currentPrice, config, assetConfig, mode, true);
    }
  }
}

// ─── Entry Check ───────────────────────────────────────────────────

async function checkEntry(
  pair: string,
  currentPrice: number,
  config: InstitutionalDcaConfigRow,
  assetConfig: InstitutionalDcaAssetConfigRow,
  mode: IdcaMode,
  observeOnly = false,
  trailingBuyContext?: { localLow: number; bouncePct: number },
  trailingBuyEntry?: { localLow: number; buyThreshold: number; maxExecutionPrice: number }
): Promise<void> {
  const check = await performEntryCheck(pair, currentPrice, config, assetConfig, mode, trailingBuyEntry, observeOnly);

  if (!check.allowed) {
    for (const reason of check.blockReasons) {
      console.log(`${TAG}[ENTRY_BLOCKED] ${pair}: ${reason.code} - ${reason.message}`);
    }
    // L1.4: data_not_ready — emitir una vez al cold start, luego cooldown de 5 min por pair+mode
    const isDataNotReady = check.blockReasons[0]?.code === "data_not_ready";
    const drKey          = `${pair}:${mode}`;
    const drLastSent     = dataNotReadyLastSent.get(drKey) ?? 0;
    const drCooldownOk   = Date.now() - drLastSent > DATA_NOT_READY_COOLDOWN_MS;

    if (isDataNotReady && drCooldownOk) {
      dataNotReadyLastSent.set(drKey, Date.now());
      await createHumanEvent({
        pair, mode,
        eventType: "entry_check_blocked",
        severity:  "info",
        message: [
          `⏳ IDCA inicializando datos — ${pair}`,
          ``,
          `El módulo está cargando velas OHLCV para poder calcular una referencia fiable.`,
          `Las entradas quedan pausadas hasta completar los datos mínimos.`,
          `No requiere acción.`,
        ].join("\n"),
        payloadJson: {
          blockReasons:   check.blockReasons,
          price:          currentPrice,
          currentPrice,
          priceUpdatedAt: new Date().toISOString(),
        },
      }, {
        eventType:    "entry_check_blocked",
        reasonCode:   "data_not_ready",
        pair, mode,
        blockReasons: check.blockReasons,
      });
    } else if (!isDataNotReady) {
      // Resetear cooldown: si el par sale de data_not_ready, el próximo cold start notifica de nuevo
      dataNotReadyLastSent.delete(drKey);
    }

    if (check.blockReasons.length > 0 && !isDataNotReady) {
      // Read frozen anchor from Map (filled by performEntryCheck)
      const frozenAnchor = vwapAnchorMemory.get(pair);

      // Calculate additional payload fields for VWAP anchor
      const minDip = check.effectiveMinDip ?? 0;
      const effectiveBasePrice = check.effectiveBasePrice ?? 0;
      const buyTriggerPrice = effectiveBasePrice * (1 - minDip / 100);
      const distToBuyPct = ((currentPrice - buyTriggerPrice) / currentPrice) * 100;

      // Alerta: precio se acerca al trigger de compra (par-específico: BTC 0.75%, ETH 1.00%, gen 1.50%)
      // Suprimir si TB ya está activo (WATCHING/ARMED/TRACKING) — Op.B gestiona sus propios avisos
      const nearZoneThresholdPct = getNearZoneThresholdPct(pair);
      if (distToBuyPct >= 0 && distToBuyPct <= nearZoneThresholdPct && check.vwapContext) {
        const tbActiveNow = TrailingBuyManager.isArmed(pair);
        telegram.alertApproachingBuy(pair, mode, currentPrice, buyTriggerPrice, distToBuyPct, check.vwapContext.zone, tbActiveNow)
          .catch(e => console.warn(`${TAG}[TELEGRAM] alertApproachingBuy failed: ${e.message}`));
      }

      const trailingBuyArmed = TrailingBuyManager.isArmed(pair);
      const trailingBuyLocalLow = TrailingBuyManager.getState(pair)?.localLow ?? null;
      const trailingBuyTriggerAt = trailingBuyLocalLow
        ? trailingBuyLocalLow * (1 + parseFloat(String(assetConfig.reboundMinPct ?? "0.50")) / 100)
        : null;

      // Calculate data for improved human message
      const drawdown = (frozenAnchor?.drawdownPct ?? check.entryDipPct) ?? 0;
      const anchorAge = frozenAnchor ? Math.round((Date.now() - frozenAnchor.setAt) / (1000 * 60 * 60) * 10) / 10 : 0;
      const buyPrice = effectiveBasePrice * (1 - minDip / 100);
      const distToBuy = ((currentPrice - buyPrice) / buyPrice) * 100;
      const trailingArmed = TrailingBuyManager.isArmed(pair);
      const localLow = TrailingBuyManager.getState(pair)?.localLow ?? null;
      const reboundPct = parseFloat(String(assetConfig.reboundMinPct ?? "0.50"));
      const trailingBuyAt = localLow ? localLow * (1 + reboundPct / 100) : null;

      // Construir mensaje humano coherente con los blockReasons reales
      const hasInsufficientDip = check.blockReasons.some(r => r.code === "insufficient_dip" || r.code === "insufficient_base_price_data" || r.code === "data_not_ready");
      const hasMarketScoreTooLow = check.blockReasons.some(r => r.code === "market_score_too_low");
      const hasVwapWeeklyBearish = check.blockReasons.some(r => r.code === "vwap_weekly_trend_bearish");
      const hasBreakdown = check.blockReasons.some(r => r.code === "breakdown_detected");
      const hasNoRebound = check.blockReasons.some(r => r.code === "no_rebound_confirmed");

      let whyBlocked = "";
      if (hasInsufficientDip && !hasMarketScoreTooLow && !hasVwapWeeklyBearish) {
        whyBlocked = "No se compró porque todavía no alcanzó la caída mínima desde el precio de referencia de entrada.";
      } else if (hasMarketScoreTooLow && hasVwapWeeklyBearish) {
        whyBlocked = `No se compró ${pair} por condiciones de mercado desfavorables: score de mercado bajo y tendencia semanal VWAP bajista.`;
      } else if (hasMarketScoreTooLow) {
        whyBlocked = `No se compró ${pair} porque el score de mercado fue ${check.marketScore ?? "—"}/100 y las condiciones no son favorables para entrada.`;
      } else if (hasVwapWeeklyBearish) {
        whyBlocked = `No se compró ${pair} porque el precio sigue por debajo del VWAP semanal y el contexto todavía no acompaña la entrada.`;
      } else if (hasBreakdown) {
        whyBlocked = `No se compró ${pair} porque se detectó una ruptura técnica bajista. El sistema evita comprar cuando hay señales claras de continuación de caída.`;
      } else if (hasNoRebound) {
        whyBlocked = `No se compró ${pair} porque falta confirmación de rebote técnico. El precio entró en zona de interés pero aún no mostró señal clara de giro.`;
      } else {
        const codeLabels = check.blockReasons.map(r => r.code);
        whyBlocked = `No se compró ${pair} por las siguientes condiciones de bloqueo: ${codeLabels.join(", ")}.`;
      }

      const humanMessage = [
        `📉 Entrada bloqueada — ${pair}`,
        ``,
        whyBlocked,
        ``,
        `📍 Precio de referencia de entrada: $${effectiveBasePrice.toFixed(2)}`,
        `   Fuente: ${check.basePriceMethod === "vwap_anchor" ? "VWAP Anclado" : check.basePriceMethod === "hybrid_v2_fallback" ? "Hybrid V2.1 fallback" : check.basePriceMethod}`,
        ``,
        `💵 Precio actual: $${currentPrice.toFixed(2)}`,
        `📉 Caída desde referencia: ${(check.entryDipPct ?? 0).toFixed(2)}%`,
        `🎯 Entrada mínima requerida: ${minDip.toFixed(2)}%`,
        `🛒 Precio objetivo de entrada: $${buyPrice.toFixed(2)}`,
        `⏳ Falta caer: ${distToBuy > 0 ? distToBuy.toFixed(2) + "%" : "YA en rango"}`,
        ``,
        check.vwapContext ? [
          `📊 Contexto VWAP`,
          `   Zona: ${check.vwapContext.zone}`,
          `   Tendencia semanal: ${check.weeklyTrend}`,
          `   Sesgo mensual: ${check.monthlyBias}`,
        ].join("\n") : null,
        ``,
        (() => {
          if (!trailingArmed) return `⚪ Trailing Buy en vigilancia (precio no ha alcanzado zona de activación)`;
          const tbStateNow = TrailingBuyManager.getState(pair);
          const tbBuyThreshNow = tbStateNow ? tbStateNow.buyThreshold : 0;
          const priceAboveThreshold = tbBuyThreshNow > 0 && currentPrice > tbBuyThreshNow;
          if (priceAboveThreshold) {
            return `⚠️ Trailing Buy revalidándose (precio sobre umbral $${tbBuyThreshNow.toFixed(2)}) — no se ejecutará compra`;
          }
          return localLow
            ? `🔵 Trailing Buy ARMADO | Mínimo: $${localLow.toFixed(2)} | Compra si rebota a: $${trailingBuyAt?.toFixed(2)}`
            : `🔵 Trailing Buy ARMADO`;
        })(),
      ].filter(Boolean).join("\n");

      await createHumanEvent({
        pair,
        mode,
        eventType: "entry_check_blocked",
        severity: "info",
        message: humanMessage,
        payloadJson: {
          blockReasons: check.blockReasons,
          price: currentPrice,
          currentPrice,
          priceUpdatedAt: new Date().toISOString(),
          basePrice: check.basePrice,
          vwapContext: check.vwapContext ?? null,
          effectiveBasePrice: check.effectiveBasePrice,
          effectiveMinDip: check.effectiveMinDip,
          basePriceMethod: check.basePriceMethod,
          weeklyTrend: check.weeklyTrend,
          monthlyBias: check.monthlyBias,
          selectedSizeProfile: check.sizeProfile,
          frozenAnchorPrice: frozenAnchor?.anchorPrice ?? null,
          frozenAnchorTs: frozenAnchor?.anchorTimestamp ?? null,
          frozenAnchorAgeHours: frozenAnchor ? Math.round((Date.now() - frozenAnchor.setAt) / 36000) / 100 : null,
          drawdownFromAnchorPct: frozenAnchor?.drawdownPct ?? null,
          frozenAnchorPrevious: frozenAnchor?.previous ?? null,
          referenceContext: check.referenceContext ?? null,
          buyTriggerPrice,
          distToBuyPct,
          trailingBuyArmed,
          trailingBuyLocalLow,
          trailingBuyTriggerAt,
        },
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

  // In observe-only mode, log that entry would be allowed but do NOT execute.
  // Throttled to 30min to avoid spamming DB every tick when cycle is active.
  if (observeOnly) {
    const bp = check.basePrice!;
    const now$ = Date.now();
    const throttleKey = `${pair}:${mode}`;
    const lastObserved = lastObservedEventMs.get(throttleKey) ?? 0;
    if (now$ - lastObserved >= OBSERVE_EVENT_THROTTLE_MS) {
      lastObservedEventMs.set(throttleKey, now$);
      await createHumanEvent({
        pair, mode,
        eventType: "entry_observed",
        severity: "info",
        message: `[OBSERVE] Condición detectada, sin acción — ${TrailingBuyManager.isArmed(pair) ? "trailing buy en vigilancia" : "ciclo activo"}. BasePrice=$${bp.price.toFixed(2)} (${bp.type}), EntryDip=${check.entryDipPct?.toFixed(2)}%, Score=${check.marketScore}`,
        payloadJson: { observeOnly: true, marketScore: check.marketScore, entryDipPct: check.entryDipPct, sizeProfile: check.sizeProfile, basePrice: bp, vwapContext: check.vwapContext ?? null, effectiveBasePrice: check.effectiveBasePrice, effectiveMinDip: check.effectiveMinDip, basePriceMethod: check.basePriceMethod, weeklyTrend: check.weeklyTrend, monthlyBias: check.monthlyBias },
      }, { eventType: "entry_observed", pair, mode, entryDipPct: check.entryDipPct, entryBasePrice: bp.price, entryBasePriceType: bp.type, marketScore: check.marketScore, sizeProfile: check.sizeProfile });
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
    payloadJson: { marketScore: check.marketScore, entryDipPct: check.entryDipPct, sizeProfile: check.sizeProfile, basePrice: bp, vwapContext: check.vwapContext ?? null, effectiveBasePrice: check.effectiveBasePrice, effectiveMinDip: check.effectiveMinDip, basePriceMethod: check.basePriceMethod, weeklyTrend: check.weeklyTrend, monthlyBias: check.monthlyBias, selectedSizeProfile: check.sizeProfile },
  }, { eventType: "entry_check_passed", pair, mode, entryDipPct: check.entryDipPct, entryBasePrice: bp.price, entryBasePriceType: bp.type, marketScore: check.marketScore, sizeProfile: check.sizeProfile });

  // ── Regla 3: resetear ancla al abrir ciclo ────────────
  vwapAnchorMemory.delete(pair);

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

  // Compute trailing — trailingMarginPct is the single source of truth (UI slider)
  let trailingPct = parseFloat(String(assetConfig.trailingMarginPct));
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
  let nextBuyPrice = nextLevel ? currentPrice * (1 - nextLevel / 100) : null;

  // VWAP override: safety 1 → lowerBand2 (if lower than % fallback)
  const vc = check.vwapContext;
  if (assetConfig.vwapEnabled && vc?.lowerBand2 && vc.lowerBand2 > 0 && nextBuyPrice !== null) {
    nextBuyPrice = Math.min(nextBuyPrice, vc.lowerBand2);
  }

  // ─── HOTFIX: Flujo seguro LIVE vs SIMULATION ─────────────────────

  let executedQty = quantity;
  let executedUsd = baseBuyUsd;
  let avgFillPrice = currentPrice;
  let feeUsd = 0;
  let wasAdjusted = false;
  let originalQty: number | undefined;
  let exchangeOrderId: string | undefined;

  // Fee tracking variables (default to executedQty for simulation)
  let netBaseQty = quantity;
  let grossBaseQty = quantity;
  let feeAsset: string | null | undefined = null;
  let feeAmount: number | null | undefined = null;
  let feeSource: "exchange_api" | "inferred_from_default_pct" | "manual" | "legacy" | null | undefined = null;

  if (mode === "live") {
    // ─── MODO LIVE: Ejecutar PRIMERO, crear ciclo DESPUÉS ─────────
    const execResult = await executeRealBuyWithGuard(
      pair,
      quantity,
      currentPrice,
      0, // cycleId aún no existe
      "initial",
      mode,
      assetConfig,
      1
    );

    if (!execResult.success) {
      // Compra fallida - NO crear ciclo
      console.error(`${TAG}[LIVE][INITIAL_BUY] FAILED: ${execResult.rejectionReason}`);
      await createHumanEvent({
        cycleId: undefined,
        pair,
        mode,
        eventType: "initial_buy_failed",
        severity: "error",
        message: `Compra inicial bloqueada: ${execResult.rejectionReason}`,
        payloadJson: { intendedQty: quantity, intendedUsd: baseBuyUsd, currentPrice, reason: execResult.rejectionReason },
      }, { eventType: "initial_buy_failed", pair, mode, price: currentPrice, quantity });
      return; // Abortar - NO crear ciclo
    }

    // Fill confirmado - usar valores EJECUTADOS
    executedQty = execResult.executedQty;
    executedUsd = execResult.executedUsd;
    avgFillPrice = execResult.avgPrice;
    feeUsd = execResult.feeUsd;
    wasAdjusted = execResult.wasAdjusted;
    originalQty = execResult.originalQty;
    exchangeOrderId = execResult.orderId;

    // Fee tracking: usar netBaseQty si está disponible (fee en base asset)
    netBaseQty = execResult.netBaseQty ?? executedQty;
    grossBaseQty = execResult.grossBaseQty ?? executedQty;
    feeAsset = execResult.feeAsset ?? null;
    feeAmount = execResult.feeAmount ?? null;
    feeSource = execResult.feeSource ?? null;

    console.log(`${TAG}[LIVE][INITIAL_BUY] FILL CONFIRMED: qty=${executedQty.toFixed(8)} avg=${avgFillPrice.toFixed(2)} fee=${feeUsd.toFixed(4)} netQty=${netBaseQty.toFixed(8)} feeAsset=${feeAsset || 'N/A'}`);
  } else {
    // ─── MODO SIMULATION: Calcular fees simulados ────────────────
    const simFeePct = resolveSimulationFeePct(config);
    feeUsd = baseBuyUsd * (simFeePct / 100);
    const slippageUsd = baseBuyUsd * (parseFloat(String(config.simulationSlippagePct)) / 100);
    executedUsd = baseBuyUsd + feeUsd + slippageUsd;
  }

  // ─── Crear ciclo con valores EJECUTADOS (LIVE) o PLANIFICADOS (SIM) ─
  const cycle = await repo.createCycle({
    pair,
    strategy: "institutional_dca_v1",
    mode,
    status: "active",
    capitalReservedUsd: capitalForCycle.toFixed(2),
    capitalUsedUsd: executedUsd.toFixed(2),
    totalCostBasisUsd: executedUsd.toFixed(2),
    // HOTFIX: Usar netBaseQty (cantidad neta post-fee en base asset) para totalQuantity
    totalQuantity: (mode === "live" ? netBaseQty : executedQty).toFixed(8),
    avgEntryPrice: avgFillPrice.toFixed(8),
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
    basePriceMetaJson: {
      ...(bp.meta || {}),
      ...(assetConfig.vwapEnabled && vc ? { vwapBands: { lowerBand2: vc.lowerBand2, lowerBand3: vc.lowerBand3 } } : {}),
    },
    entryDipPct: (check.entryDipPct || 0).toFixed(4),
  });

  // ─── FASE 4: CYCLE_START snapshot — non-blocking, write-only
  emitIdcaSnapshot({
    sourceMode: mode === "simulation" ? "IDCA_SIMULATION" : "REAL",
    cycleId: cycle.id,
    snapshotType: "CYCLE_START",
    pair,
    eventTs: new Date(),
    entryPrice: avgFillPrice,
    executedAmount: mode === "live" ? netBaseQty : executedQty,
    signalScore: check.marketScore ?? undefined,
  });

  // Create order record with execution tracking
  const order = await repo.createOrder({
    cycleId: cycle.id,
    pair,
    mode,
    orderType: "base_buy",
    buyIndex: 1,
    side: "buy",
    price: avgFillPrice.toFixed(8),
    quantity: executedQty.toFixed(8),
    grossValueUsd: (mode === "live" ? executedUsd - feeUsd : baseBuyUsd).toFixed(2),
    feesUsd: feeUsd.toFixed(2),
    slippageUsd: (mode === "simulation" ? (executedUsd - baseBuyUsd - feeUsd) : 0).toFixed(2),
    netValueUsd: executedUsd.toFixed(2),
    triggerReason: `Entry dip ${check.entryDipPct?.toFixed(2)}% from base $${bp.price.toFixed(2)} (${bp.type}), score=${check.marketScore}`,
    humanReason: formatOrderReason("base_buy"),
    // HOTFIX: Campos de trazabilidad
    executionStatus: mode === "live" ? "filled" : "simulated",
    intendedQuantity: quantity.toFixed(8),
    intendedUsd: baseBuyUsd.toFixed(2),
    executedQuantity: executedQty.toFixed(8),
    executedUsd: executedUsd.toFixed(2),
    avgFillPrice: avgFillPrice.toFixed(8),
    exchangeOrderId,
    sizeAdjusted: wasAdjusted,
    originalIntendedUsd: wasAdjusted ? baseBuyUsd.toFixed(2) : undefined,
    adjustedUsd: wasAdjusted ? executedUsd.toFixed(2) : undefined,
    // Fee tracking (solo LIVE)
    ...(mode === "live" ? {
      grossBaseQty: grossBaseQty.toFixed(8),
      netBaseQty: netBaseQty.toFixed(8),
      feeAsset: feeAsset || null,
      feeAmount: feeAmount?.toFixed(8) || null,
      feeSource: feeSource || null,
    } : {}),
  });

  // Update simulation wallet
  if (mode === "simulation") {
    const wallet = await repo.getSimulationWallet();
    await repo.updateSimulationWallet({
      availableBalanceUsd: (parseFloat(String(wallet.availableBalanceUsd)) - executedUsd).toFixed(2),
      usedBalanceUsd: (parseFloat(String(wallet.usedBalanceUsd)) + executedUsd).toFixed(2),
      totalOrdersSimulated: wallet.totalOrdersSimulated + 1,
      totalCyclesSimulated: wallet.totalCyclesSimulated + 1,
    });
  }

  const baseFmtCtx: FormatContext = {
    eventType: "cycle_started", pair, mode,
    price: currentPrice, quantity, capitalUsed: executedUsd,
    entryDipPct: check.entryDipPct, entryBasePrice: bp.price, entryBasePriceType: bp.type,
    marketScore: check.marketScore,
    buyCount: 1, sizeProfile: check.sizeProfile,
  };

  await createHumanEvent({
    cycleId: cycle.id, pair, mode,
    eventType: "cycle_started",
    severity: "info",
    message: `Cycle started: baseBuy=${quantity.toFixed(6)} @ ${currentPrice.toFixed(2)} | BasePrice=$${bp.price.toFixed(2)} (${bp.type}) | EntryDip=${check.entryDipPct?.toFixed(2)}%`,
    payloadJson: { price: currentPrice, quantity, capital: executedUsd, sizeProfile: check.sizeProfile, basePrice: bp },
  }, baseFmtCtx);

  await createHumanEvent({
    cycleId: cycle.id, pair, mode,
    eventType: "base_buy_executed",
    severity: "info",
    message: `Base buy #1: ${quantity.toFixed(6)} @ ${currentPrice.toFixed(2)}`,
  }, { ...baseFmtCtx, eventType: "base_buy_executed" });

  await telegram.alertCycleStarted(cycle, check.entryDipPct || 0, check.marketScore || 0);
  await telegram.alertBuyExecuted(cycle, order, "base_buy");

  // ─── FASE 4: BASE_BUY snapshot — non-blocking, write-only
  emitIdcaSnapshot({
    sourceMode: mode === "simulation" ? "IDCA_SIMULATION" : "REAL",
    cycleId: cycle.id,
    snapshotType: "BASE_BUY",
    pair,
    eventTs: new Date(),
    entryPrice: avgFillPrice,
    executedAmount: mode === "live" ? netBaseQty : executedQty,
  });

  // Si esta compra vino de trailing buy, notificar específicamente
  if (trailingBuyContext) {
    telegram.alertTrailingBuyExecuted(
      pair,
      mode,
      currentPrice,
      trailingBuyContext.localLow,
      trailingBuyContext.bouncePct,
      cycle.id,
      order?.id
    ).catch(e => console.warn(`${TAG}[TELEGRAM] alertTrailingBuyExecuted failed: ${e.message}`));
  }
}

// ─── Cycle Management ──────────────────────────────────────────────

async function manageCycle(
  cycle: InstitutionalDcaCycle,
  currentPrice: number,
  config: InstitutionalDcaConfigRow,
  assetConfig: InstitutionalDcaAssetConfigRow,
  mode: IdcaMode,
  pairDisabled: boolean = false
): Promise<void> {
  const pair = cycle.pair;

  // ─── HOTFIX: Skip automation for cycles needing reconciliation ─────────
  // Ciclos bloqueados por reconciliación no ejecutan compras/ventas/plus/recovery
  if (cycle.status === "needs_reconciliation") {
    console.log(`${TAG}[CYCLE_SKIPPED_RECONCILIATION] pair=${pair} cycleId=${cycle.id} reason=${cycle.reconciliationBlockedReason || "needs_reconciliation"}`);
    // Solo actualizar precio/PnL para UI, sin ejecutar ninguna acción automática
    const avgEntry = parseFloat(String(cycle.avgEntryPrice || "0"));
    const totalQty = parseFloat(String(cycle.totalQuantity || "0"));
    const capitalUsed = parseFloat(String(cycle.capitalUsedUsd || "0"));
    if (avgEntry > 0 && totalQty > 0) {
      const marketValue = totalQty * currentPrice;
      const unrealizedPnlUsd = marketValue - capitalUsed;
      const unrealizedPnlPct = capitalUsed > 0 ? (unrealizedPnlUsd / capitalUsed) * 100 : 0;
      const currentDD = unrealizedPnlPct < 0 ? Math.abs(unrealizedPnlPct) : 0;
      const prevMaxDD = parseFloat(String(cycle.maxDrawdownPct || "0"));
      const maxDD = Math.max(currentDD, prevMaxDD);
      await repo.updateCycle(cycle.id, {
        currentPrice: currentPrice.toFixed(8),
        unrealizedPnlUsd: unrealizedPnlUsd.toFixed(2),
        unrealizedPnlPct: unrealizedPnlPct.toFixed(4),
        maxDrawdownPct: maxDD.toFixed(2),
      });
    }
    return;
  }

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

  // ─── FASE 4: Autotuning sample — non-blocking MFE/MAE for open IDCA cycle
  emitIdcaMetric(cycle, mode === "simulation" ? "IDCA_SIMULATION" : "REAL", currentPrice);

  // ─── TimeStop Check (max cycle duration) ──────────────────────
  // Only applies to main cycles (recovery has its own check in manageRecoveryCycle)
  if (cycle.cycleType !== "recovery" && cycle.startedAt) {
    const maxDurationHours = parseFloat(String(assetConfig.maxCycleDurationHours ?? "0"));
    if (maxDurationHours > 0) {
      const ageMs = Date.now() - new Date(cycle.startedAt).getTime();
      const maxMs = maxDurationHours * 3600000;
      if (ageMs > maxMs) {
        // Check if TimeStop is manually disabled for this cycle
        const overrides = typeof cycle.exitOverridesJson === "string"
          ? JSON.parse(cycle.exitOverridesJson)
          : cycle.exitOverridesJson;
        const timeStopDisabled = overrides?.timeStopDisabled === true;

        if (!timeStopDisabled) {
          // Close by TimeStop
          await executeExit(cycle, {
            shouldExit: true,
            exitType: "max_duration_reached",
            exitPrice: currentPrice,
            exitReason: `Max duration exceeded (${maxDurationHours}h)`,
            urgency: "medium",
          }, config, assetConfig, mode);
          return;
        } else {
          // TimeStop disabled by manual override — log once per 24h
          await logTimeStopIgnoredOnce(cycle.id, pair, mode, ageMs, maxDurationHours);
        }
      }
    }
  }

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
      await handleActiveState(cycle, currentPrice, unrealizedPnlPct, config, assetConfig, mode, pairDisabled);
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
  // Also applies to normal cycles that somehow lost nextBuyPrice.
  if (!cycle.soloSalida) {
    const storedNext = parseFloat(String(cycle.nextBuyPrice || "0"));
    if (storedNext <= 0) {
      // Si ladder ATRP está activo, calcular siguiente nivel con ATRP
      if (assetConfig.ladderAtrpEnabled && assetConfig.ladderAtrpConfigJson) {
        try {
          const { idcaLadderAtrpService } = await import('./IdcaLadderAtrpService');
          const frozenAnchor = vwapAnchorMemory.get(pair);
          const ladder = await idcaLadderAtrpService.calculateLadder(
            pair,
            assetConfig.ladderAtrpConfigJson as import('./IdcaTypes').LadderAtrpConfig,
            undefined,
            frozenAnchor?.anchorPrice
          );

          // Find next level based on current buyCount (0=base already bought, 1+=next safety)
          const currentBuyCount = cycle.buyCount || 1;
          const nextLevel = ladder.levels.find(l => l.level >= currentBuyCount);

          if (nextLevel && nextLevel.triggerPrice > 0) {
            // Resolver de distancia: aplica como suelo conservador. self-heal: avgEntry como referencia.
            let healedNextBuyPrice = nextLevel.triggerPrice;
            const shAtrpEntryMode = (assetConfig.entryMode ?? "assisted_entry") as IdcaEntryMode;
            const shAtrpDdCfg = parseDynamicDistanceConfig(assetConfig.dynamicDistanceConfigJson);
            const shAtrpResult = resolveIdcaRequiredDistance({
              pair,
              usedFor: "recovery",
              activeEntryMode: shAtrpEntryMode,
              referencePrice: avgEntry,  // no recent fill → usar avgEntry
              atrPct: getVolatility(pair),
              entryGlobalConfig: config,
              dynamicDistanceConfig: shAtrpDdCfg,
              buyCount: cycle.buyCount || 1,
              marketScore: parseFloat(String(cycle.marketScore || "50")),
              candleCount: ohlcCache.get(pair)?.length ?? 0,
              capitalUsedUsd: parseFloat(String(cycle.capitalUsedUsd || "0")),
              capitalReservedUsd: parseFloat(String(cycle.capitalReservedUsd || "0")),
              existingNextBuyPrice: nextLevel.triggerPrice,
            });
            if (shAtrpResult.effectiveNextBuyPrice != null) {
              if (shAtrpResult.effectiveNextBuyPrice !== nextLevel.triggerPrice) {
                console.log(`${TAG}[DISTANCE_RESOLVER][SELF_HEAL] ${pair} #${cycle.id}: ladder nextBuyPrice ${nextLevel.triggerPrice.toFixed(2)} → ${shAtrpResult.effectiveNextBuyPrice.toFixed(2)} (mode=${shAtrpResult.mode} source=${shAtrpResult.source})`);
              }
              healedNextBuyPrice = shAtrpResult.effectiveNextBuyPrice;
            }

            await repo.updateCycle(cycle.id, {
              nextBuyLevelPct: nextLevel.dipPct.toFixed(2),
              nextBuyPrice: healedNextBuyPrice.toFixed(8),
            });
            console.log(`${TAG}[SELF_HEAL] ${pair} #${cycle.id}: nextBuyPrice recalculated via ATRP ladder → $${healedNextBuyPrice.toFixed(2)} (level=${nextLevel.level}, dip=${nextLevel.dipPct.toFixed(2)}%)`);

            // Create event for traceability
            await createHumanEvent({
              cycleId: cycle.id, pair, mode,
              eventType: "cycle_data_healed",
              severity: "info",
              message: `Próxima compra recalculada: $${healedNextBuyPrice.toFixed(2)} usando ladder ATRP (nivel ${nextLevel.level})`,
            }, {
              eventType: "cycle_data_healed", pair, mode,
              nextBuyPrice: healedNextBuyPrice,
              nextBuyLevel: nextLevel.level,
              method: "ladder_atrp",
            });
          } else {
            console.log(`${TAG}[SELF_HEAL] ${pair} #${cycle.id}: no valid next level found in ATRP ladder (totalLevels=${ladder.totalLevels})`);
          }
        } catch (error) {
          console.error(`${TAG}[SELF_HEAL] ${pair} #${cycle.id}: failed to calculate ATRP ladder`, error);
        }
      } else {
        // Usar safety orders legacy cuando ladder ATRP no está activo
        const safetyOrders = parseSafetyOrders(assetConfig.safetyOrdersJson);
        const effectiveSafety = calculateEffectiveSafetyLevel(
          safetyOrders,
          avgEntry,
          currentPrice,
          cycle.buyCount || 1
        );
        if (effectiveSafety.nextBuyPrice && effectiveSafety.nextBuyPrice > 0) {
          // Resolver de distancia: aplica como suelo conservador. self-heal: avgEntry como referencia.
          let healedNextBuySafety = effectiveSafety.nextBuyPrice;
          const shSafetyEntryMode = (assetConfig.entryMode ?? "assisted_entry") as IdcaEntryMode;
          const shSafetyDdCfg = parseDynamicDistanceConfig(assetConfig.dynamicDistanceConfigJson);
          const shSafetyResult = resolveIdcaRequiredDistance({
            pair,
            usedFor: "recovery",
            activeEntryMode: shSafetyEntryMode,
            referencePrice: avgEntry,  // no recent fill → usar avgEntry
            atrPct: getVolatility(pair),
            entryGlobalConfig: config,
            dynamicDistanceConfig: shSafetyDdCfg,
            buyCount: cycle.buyCount || 1,
            marketScore: parseFloat(String(cycle.marketScore || "50")),
            candleCount: ohlcCache.get(pair)?.length ?? 0,
            capitalUsedUsd: parseFloat(String(cycle.capitalUsedUsd || "0")),
            capitalReservedUsd: parseFloat(String(cycle.capitalReservedUsd || "0")),
            existingNextBuyPrice: effectiveSafety.nextBuyPrice,
          });
          if (shSafetyResult.effectiveNextBuyPrice != null) {
            if (shSafetyResult.effectiveNextBuyPrice !== effectiveSafety.nextBuyPrice) {
              console.log(`${TAG}[DISTANCE_RESOLVER][SELF_HEAL] ${pair} #${cycle.id}: safety nextBuyPrice ${effectiveSafety.nextBuyPrice.toFixed(2)} → ${shSafetyResult.effectiveNextBuyPrice.toFixed(2)} (mode=${shSafetyResult.mode} source=${shSafetyResult.source})`);
            }
            healedNextBuySafety = shSafetyResult.effectiveNextBuyPrice;
          }

          await repo.updateCycle(cycle.id, {
            nextBuyLevelPct: effectiveSafety.nextLevelPct?.toFixed(2) || null,
            nextBuyPrice: healedNextBuySafety.toFixed(8),
            skippedSafetyLevels: effectiveSafety.skippedLevels,
            skippedLevelsDetail: effectiveSafety.skippedLevels > 0 ? effectiveSafety.skippedLevelsDetail : null,
          });
          console.log(`${TAG}[SELF_HEAL] ${pair} #${cycle.id}: nextBuyPrice recalculated → $${healedNextBuySafety.toFixed(2)} (skipped=${effectiveSafety.skippedLevels})`);

          // Create event for traceability
          await createHumanEvent({
            cycleId: cycle.id, pair, mode,
            eventType: "cycle_data_healed",
            severity: "info",
            message: `Próxima compra recalculada: $${healedNextBuySafety.toFixed(2)} usando safety orders`,
          }, {
            eventType: "cycle_data_healed", pair, mode,
            nextBuyPrice: healedNextBuySafety,
            method: "safety_orders",
          });
        } else if (effectiveSafety.skippedLevels !== (cycle.skippedSafetyLevels ?? 0)) {
          // Update skipped count even if no valid next level
          await repo.updateCycle(cycle.id, { skippedSafetyLevels: effectiveSafety.skippedLevels });
          console.log(`${TAG}[SELF_HEAL] ${pair} #${cycle.id}: skippedSafetyLevels updated → ${effectiveSafety.skippedLevels}`);
        }
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
  mode: IdcaMode,
  pairDisabled: boolean = false
): Promise<void> {
  const pair = cycle.pair;
  const avgEntry = parseFloat(String(cycle.avgEntryPrice || "0"));

  // Usar nuevo sistema unificado de salidas
  const exitSignals = await idcaExitManager.evaluateExitSignals(cycle, assetConfig, currentPrice);
  
  // Procesar señales de salida
  for (const signal of exitSignals) {
    if (signal.shouldExit) {
      await executeExit(cycle, signal, config, assetConfig, mode);
      return; // Solo procesar la primera señal (OCO lógico ya aplicado)
    }
  }

  // Lógica de seguridad existente como fallback
  const protectionActivationPct = parseFloat(String(assetConfig.protectionActivationPct ?? "1.00"));
  const beNetBufferPct = parseFloat(String(assetConfig.beNetBufferPct ?? "0.30"));
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

  // 1. ARM PROTECTION (net break-even as safety net, NOT an exit)
  // GUARD: skip if bePercent is invalid (0, NaN, negative) — prevents arming at avg with no threshold
  if (!isProtectionArmed && isBePercentValid && pnlPct >= protectionActivationPct && avgEntry > 0) {
    // Net break-even: add buffer to cover fees/spread (default 0.30%)
    const beNetBufferPct = parseFloat(String(assetConfig.beNetBufferPct ?? "0.30"));
    const grossStopPrice = avgEntry;
    const netStopPrice = avgEntry * (1 + beNetBufferPct / 100);

    await repo.updateCycle(cycle.id, {
      protectionArmedAt: new Date(),
      protectionStopPrice: netStopPrice.toFixed(8),
    });

    await createHumanEvent({
      cycleId: cycle.id, pair, mode,
      eventType: "protection_armed",
      severity: "info",
      message: `Protección armada en BE neto: precio medio=$${grossStopPrice.toFixed(2)}, buffer=${beNetBufferPct.toFixed(2)}%, stop=$${netStopPrice.toFixed(2)}`,
    }, {
      eventType: "protection_armed", pair, mode,
      price: currentPrice, avgEntry, pnlPct,
      beNetBufferPct,
      grossBreakEvenPrice: grossStopPrice,
      netBreakEvenPrice: netStopPrice,
    });

    await telegram.alertProtectionArmed(cycle, currentPrice, netStopPrice, pnlPct);

    // ─── FASE 4: BREAKEVEN_ARMED snapshot — non-blocking, write-only
    emitIdcaSnapshot({
      sourceMode: mode === "simulation" ? "IDCA_SIMULATION" : "REAL",
      cycleId: cycle.id,
      snapshotType: "BREAKEVEN_ARMED",
      pair,
      eventTs: new Date(),
      entryPrice: avgEntry,
      pnlPct,
    });

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

    // ─── FASE 4: TRAILING_ACTIVATED snapshot — non-blocking, write-only
    emitIdcaSnapshot({
      sourceMode: mode === "simulation" ? "IDCA_SIMULATION" : "REAL",
      cycleId: cycle.id,
      snapshotType: "TRAILING_ACTIVATED",
      pair,
      eventTs: new Date(),
      entryPrice: avgEntry,
      pnlPct,
    });

    return; // Transition done, next tick will be handleTrailingState
  }

  // 3. PROTECTION STOP HIT (price fell back to break-even after protection was armed)
  if (isProtectionArmed && protectionStopPrice > 0 && currentPrice <= protectionStopPrice) {
    await executeBreakevenExit(cycle, currentPrice, config, mode);
    return;
  }

  // 4. Check safety buy levels — skip if imported + soloSalida OR pair disabled
  if (!(cycle.isImported && cycle.soloSalida) && !pairDisabled) {
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

  // ─── Lote 4: Guard — No safety buys if exit instruction pending ───────────
  if (await exitRepo.hasPendingExitInstruction(cycle.id)) {
    console.log(`${TAG}[SAFETY_BLOCKED] cycleId=${cycle.id} pair=${pair}: exit instruction pending, blocking safety buy`);
    return;
  }

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
    const reboundMin = parseFloat(String(assetConfig.reboundMinPct ?? "0.30"));
    if (!smart.detectRebound({ recentCandles, currentPrice, localLow, reboundMinPct: reboundMin })) {
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

  // ─── HOTFIX: Flujo seguro LIVE vs SIMULATION ─────────────────────

  let executedQty = quantity;
  let executedUsd = buyUsd;
  let avgFillPrice = currentPrice;
  let feeUsd = 0;
  let wasAdjusted = false;
  let originalQty: number | undefined;
  let exchangeOrderId: string | undefined;

  // Fee tracking variables (default to executedQty for simulation)
  let netBaseQty = quantity;
  let grossBaseQty = quantity;
  let feeAsset: string | null | undefined = null;
  let feeAmount: number | null | undefined = null;
  let feeSource: "exchange_api" | "inferred_from_default_pct" | "manual" | "legacy" | null | undefined = null;

  if (mode === "live") {
    // ─── MODO LIVE: Ejecutar PRIMERO, actualizar ciclo DESPUÉS ─────────
    const execResult = await executeRealBuyWithGuard(
      pair,
      quantity,
      currentPrice,
      cycle.id,
      "safety",
      mode,
      assetConfig,
      safetyIndex + 1 // buyLevel (1-indexed)
    );

    if (!execResult.success) {
      const rejReason = execResult.rejectionReason ?? "unknown";
      // NO tocar ciclo si la compra falló
      console.error(`${TAG}[LIVE][SAFETY_BUY] FAILED for cycle #${cycle.id}: ${rejReason}`);
      // Anti-spam: solo emitir evento si no estamos en cooldown activo para este motivo
      if (!isSafetyBuyOnCooldown(pair, cycle.id, safetyIndex + 1, rejReason)) {
        const isUnknownPending = rejReason.startsWith("no_fill") || rejReason.startsWith("execution_unknown");
        await createHumanEvent({
          cycleId: cycle.id,
          pair,
          mode,
          eventType: isUnknownPending ? "safety_buy_unknown_pending" : "safety_buy_failed",
          severity: isUnknownPending ? "warning" : "error",
          message: isUnknownPending
            ? `Safety buy #${safetyIndex + 1} ejecución desconocida — pendiente reconciliación manual: ${rejReason}`
            : `Safety buy #${safetyIndex + 1} bloqueado/fallido: ${rejReason}`,
          payloadJson: { intendedQty: quantity, currentPrice, reason: rejReason },
        }, { eventType: "safety_buy_failed", pair, mode, cycleId: cycle.id, price: currentPrice, quantity });
        setSafetyBuyCooldown(pair, cycle.id, safetyIndex + 1, rejReason);
      } else {
        console.log(`${TAG}[BUY_COOLDOWN_SKIP] ${pair} cycle#${cycle.id} safety#${safetyIndex + 1} — event suppressed (cooldown active)`);
      }
      return; // Abortar - NO tocar ciclo
    }

    // Fill confirmado - usar valores EJECUTADOS
    executedQty = execResult.executedQty;
    executedUsd = execResult.executedUsd;
    avgFillPrice = execResult.avgPrice;
    feeUsd = execResult.feeUsd;
    wasAdjusted = execResult.wasAdjusted;
    originalQty = execResult.originalQty;
    exchangeOrderId = execResult.orderId;

    // Fee tracking: usar netBaseQty si está disponible (fee en base asset)
    netBaseQty = execResult.netBaseQty ?? executedQty;
    grossBaseQty = execResult.grossBaseQty ?? executedQty;
    feeAsset = execResult.feeAsset ?? null;
    feeAmount = execResult.feeAmount ?? null;
    feeSource = execResult.feeSource ?? null;

    console.log(`${TAG}[LIVE][SAFETY_BUY] FILL CONFIRMED for cycle #${cycle.id}: qty=${executedQty.toFixed(8)} avg=${avgFillPrice.toFixed(2)} netQty=${netBaseQty.toFixed(8)} feeAsset=${feeAsset || 'N/A'}`);
  } else {
    // ─── MODO SIMULATION: Calcular fees simulados ────────────────
    feeUsd = buyUsd * (resolveSimulationFeePct(config) / 100);
    const slippageUsd = buyUsd * (parseFloat(String(config.simulationSlippagePct)) / 100);
    executedUsd = buyUsd + feeUsd + slippageUsd;
  }

  // Recalculate average usando valores EJECUTADOS
  const prevQty = parseFloat(String(cycle.totalQuantity));
  const prevCost = parseFloat(String(cycle.capitalUsedUsd));
  // HOTFIX: Usar netBaseQty (cantidad neta post-fee en base asset) para el nuevo total
  const newTotalQty = prevQty + (mode === "live" ? netBaseQty : executedQty);
  const newTotalCost = prevCost + executedUsd;
  const newAvgPrice = newTotalCost / newTotalQty;
  const newBuyCount = buyCount + 1;

  // Next level (calculado desde nuevo promedio)
  const nextSafety = safetyOrders[safetyIndex];
  const nextLevelPct = nextSafety ? nextSafety.dipPct : null;
  let nextBuyPriceCalc = nextLevelPct ? newAvgPrice * (1 - nextLevelPct / 100) : null;

  // VWAP override
  if (assetConfig.vwapEnabled && nextBuyPriceCalc !== null) {
    try {
      const meta = typeof cycle.basePriceMetaJson === "string"
        ? JSON.parse(cycle.basePriceMetaJson)
        : cycle.basePriceMetaJson;
      const vwapBands = meta?.vwapBands;
      if (vwapBands) {
        const vwapLevels = [vwapBands.lowerBand2, vwapBands.lowerBand3];
        if (safetyIndex < vwapLevels.length && vwapLevels[safetyIndex] > 0) {
          nextBuyPriceCalc = Math.min(nextBuyPriceCalc, vwapLevels[safetyIndex]);
        }
      }
    } catch {
      // JSON corrupto → usa cálculo % fijo
    }
  }

  // ─── Resolver de distancia: aplicar como suelo conservador ──────────────────
  // Solo afecta nextBuyPriceCalc. Nunca modifica avgEntryPrice ni contabilidad.
  // Regla conservadora: effectiveNextBuyPrice = min(existingNextBuyPrice, proposedNextBuyPrice)
  if (nextBuyPriceCalc !== null) {
    const sbEntryMode = (assetConfig.entryMode ?? "assisted_entry") as IdcaEntryMode;
    const sbDdCfg = parseDynamicDistanceConfig(assetConfig.dynamicDistanceConfigJson);
    const sbDistanceResult = resolveIdcaRequiredDistance({
      pair,
      usedFor: "safety_buy",
      activeEntryMode: sbEntryMode,
      referencePrice: avgFillPrice > 0 ? avgFillPrice : newAvgPrice,  // precio real de esta compra
      atrPct: getVolatility(pair),
      entryGlobalConfig: config,
      dynamicDistanceConfig: sbDdCfg,
      buyCount: newBuyCount,
      marketScore: parseFloat(String(cycle.marketScore || "50")),
      candleCount: ohlcCache.get(pair)?.length ?? 0,
      capitalUsedUsd: newTotalCost,
      capitalReservedUsd: parseFloat(String(cycle.capitalReservedUsd || "0")),
      existingNextBuyPrice: nextBuyPriceCalc,
    });
    if (sbDistanceResult.effectiveNextBuyPrice != null) {
      if (sbDistanceResult.effectiveNextBuyPrice < nextBuyPriceCalc) {
        console.log(`${TAG}[DISTANCE_RESOLVER][SAFETY_BUY] ${pair} #${cycle.id}: nextBuyPrice ${nextBuyPriceCalc.toFixed(2)} → ${sbDistanceResult.effectiveNextBuyPrice.toFixed(2)} (mode=${sbDistanceResult.mode} source=${sbDistanceResult.source} applied=${sbDistanceResult.requiredDistancePct.toFixed(2)}%)`);
      }
      nextBuyPriceCalc = sbDistanceResult.effectiveNextBuyPrice;
    } else if (sbDistanceResult.source === "dynamic_distance" && sbDistanceResult.requiredDistancePct === 0) {
      console.log(`${TAG}[DISTANCE_RESOLVER][SAFETY_BUY] ${pair} #${cycle.id}: blocked or no-effect (mode=${sbDistanceResult.mode}) — keeping existing nextBuyPriceCalc`);
    }
  }

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

  // Actualizar ciclo con valores EJECUTADOS
  const prevTotalCostBasis = parseFloat(String((cycle as any).totalCostBasisUsd || cycle.capitalUsedUsd || "0"));
  await repo.updateCycle(cycle.id, {
    capitalUsedUsd: newTotalCost.toFixed(2),
    totalCostBasisUsd: (prevTotalCostBasis + executedUsd).toFixed(2),
    totalQuantity: newTotalQty.toFixed(8),
    avgEntryPrice: newAvgPrice.toFixed(8),
    buyCount: newBuyCount,
    nextBuyLevelPct: nextLevelPct?.toFixed(2) || null,
    nextBuyPrice: nextBuyPriceCalc?.toFixed(8) || null,
    tpTargetPct: tpPct.toFixed(2),
    tpTargetPrice: tpPrice.toFixed(8),
    tpBreakdownJson: tpBreakdownSafety,
    lastBuyAt: new Date(),
  } as any);

  // Crear orden con valores EJECUTADOS
  const order = await repo.createOrder({
    cycleId: cycle.id,
    pair,
    mode,
    orderType: "safety_buy",
    buyIndex: newBuyCount,
    side: "buy",
    price: avgFillPrice.toFixed(8),
    quantity: executedQty.toFixed(8),
    grossValueUsd: (mode === "live" ? executedUsd - feeUsd : buyUsd).toFixed(2),
    feesUsd: feeUsd.toFixed(2),
    slippageUsd: (mode === "simulation" ? (executedUsd - buyUsd - feeUsd) : 0).toFixed(2),
    netValueUsd: executedUsd.toFixed(2),
    triggerReason: `Safety buy #${newBuyCount} at -${safetyOrder.dipPct}%`,
    humanReason: formatOrderReason("safety_buy"),
    // HOTFIX: Campos de trazabilidad
    executionStatus: mode === "live" ? "filled" : "simulated",
    intendedQuantity: quantity.toFixed(8),
    intendedUsd: buyUsd.toFixed(2),
    executedQuantity: executedQty.toFixed(8),
    executedUsd: executedUsd.toFixed(2),
    avgFillPrice: avgFillPrice.toFixed(8),
    exchangeOrderId,
    sizeAdjusted: wasAdjusted,
    originalIntendedUsd: wasAdjusted ? buyUsd.toFixed(2) : undefined,
    adjustedUsd: wasAdjusted ? executedUsd.toFixed(2) : undefined,
    // Fee tracking (solo LIVE)
    ...(mode === "live" ? {
      grossBaseQty: grossBaseQty.toFixed(8),
      netBaseQty: netBaseQty.toFixed(8),
      feeAsset: feeAsset || null,
      feeAmount: feeAmount?.toFixed(8) || null,
      feeSource: feeSource || null,
    } : {}),
  });

  if (mode === "simulation") {
    const wallet = await repo.getSimulationWallet();
    await repo.updateSimulationWallet({
      availableBalanceUsd: (parseFloat(String(wallet.availableBalanceUsd)) - executedUsd).toFixed(2),
      usedBalanceUsd: (parseFloat(String(wallet.usedBalanceUsd)) + executedUsd).toFixed(2),
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

  // ─── FASE 4: SAFETY_BUY snapshot — non-blocking, write-only
  emitIdcaSnapshot({
    sourceMode: mode === "simulation" ? "IDCA_SIMULATION" : "REAL",
    cycleId: cycle.id,
    snapshotType: "SAFETY_BUY",
    pair,
    eventTs: new Date(),
    entryPrice: avgFillPrice,
    executedAmount: mode === "live" ? netBaseQty : executedQty,
  });
}

// ─── Take Profit Arm ───────────────────────────────────────────────
// LEGACY: This function performs a partial sell + transition to trailing_active.
// It is NOT called from the main cycle flow (handleActiveState transitions
// directly to trailing_active without partial sell). Retained for potential
// future use or manual invocation. Consumes config.partialTpMinPct/MaxPct.

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
    fees = partialValueUsd * (resolveSimulationFeePct(config) / 100);
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
    await executeRealSell(cycle, "partial_sell", partialQty, false);
  }

  const remainingQty = totalQty - partialQty;

  // Get trailing pct — prefer cycle-stored value, fallback to trailingMarginPct (UI slider)
  let trailingPct = parseFloat(String(cycle.trailingPct || assetConfig.trailingMarginPct));
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
  const trailingPct = parseFloat(String(cycle.trailingPct || assetConfig.trailingMarginPct));

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
  const requestedQty = parseFloat(String(cycle.totalQuantity));
  const asset = pair.split("/")[0];

  // ─── FASE D: Balance guard + dust tolerance (LIVE only) ──────────────────────
  // Must run BEFORE createOrder so we don't write fake sell history on failure.
  let actualSellQty = requestedQty;
  let dustAdjusted = false;

  if (mode === "live") {
    try {
      const exchange = ExchangeFactory.getTradingExchange();
      const balance = await exchange.getBalance();
      const availableQty = parseFloat(
        String((balance[asset] as any)?.available ?? balance[asset] ?? "0")
      );
      const dustResult = computeLiveSellQtyWithDustTolerance(requestedQty, availableQty, true, asset);
      actualSellQty = dustResult.sellQty;
      dustAdjusted = dustResult.adjusted;
      if (dustAdjusted) {
        console.warn(
          `${TAG}[TRAILING_DUST_ADJ] cycleId=${cycle.id} ${pair} ` +
          `requested=${requestedQty.toFixed(8)} adjusted=${actualSellQty.toFixed(8)} ` +
          `reason=${dustResult.reason}`
        );
      }
    } catch (balanceErr: any) {
      // Real shortage — abort without writing any order record
      console.error(`${TAG}[TRAILING_BLOCKED] #${cycle.id} ${pair} — ${balanceErr.message}`);
      await createHumanEvent({
        cycleId: cycle.id, pair, mode,
        eventType: "critical_error",
        severity: "critical",
        message: `Venta trailing bloqueada: ${balanceErr.message} — ciclo NO cerrado`,
        payloadJson: { error: balanceErr.message, price: currentPrice, qty: requestedQty },
      }, { eventType: "critical_error", pair, mode, price: currentPrice });
      const isBalanceFail = balanceErr.message.includes("insufficient_exchange_balance") || balanceErr.message.includes("balance_zero");
      if (shouldSendSellFailedAlert(cycle.id, "insufficient_exchange_balance")) {
        await telegram.sendRawMessage(
          `🚨 <b>[IDCA][LIVE] VENTA FALLIDA</b>\n\n` +
          `Par: <b>${pair}</b> #${cycle.id}\n` +
          `Tipo: trailing_exit\n` +
          `Motivo: ${isBalanceFail ? "balance insuficiente real" : balanceErr.message}\n` +
          `Cantidad ciclo: ${requestedQty.toFixed(8)} ${asset}\n` +
          `\nCiclo NO cerrado en DB. Revisar posición manualmente.`
        );
      }
      return; // Abort — do NOT close cycle, do NOT write order record
    }
  }

  const sellValueUsd = actualSellQty * currentPrice;
  let fees = 0, slippage = 0, netValue = sellValueUsd;
  if (mode === "simulation") {
    fees = sellValueUsd * (resolveSimulationFeePct(config) / 100);
    slippage = sellValueUsd * (parseFloat(String(config.simulationSlippagePct)) / 100);
    netValue = sellValueUsd - fees - slippage;
  }

  // ─── FASE E: Execute live sell BEFORE writing order record ───────────────────
  // Prevents fake sell history if the exchange call fails.
  if (mode === "live") {
    try {
      await executeRealSell(cycle, "final_sell", actualSellQty, true);
    } catch (sellErr: any) {
      console.error(`${TAG}[TRAILING_SELL_FAILED] #${cycle.id} ${pair} — ${sellErr.message}`);
      await createHumanEvent({
        cycleId: cycle.id, pair, mode,
        eventType: "critical_error",
        severity: "critical",
        message: `Venta trailing live FALLIDA: ${sellErr.message} — ciclo NO cerrado, posición ABIERTA en exchange`,
        payloadJson: { error: sellErr.message, price: currentPrice, qty: actualSellQty },
      }, { eventType: "critical_error", pair, mode, price: currentPrice });
      if (shouldSendSellFailedAlert(cycle.id, "execution_error")) {
        await telegram.sendRawMessage(
          `🚨 <b>[IDCA][LIVE] VENTA TRAILING FALLIDA</b>\n\n` +
          `Par: <b>${pair}</b> #${cycle.id}\n` +
          `Error: <code>${sellErr.message}</code>\n` +
          `Precio: $${currentPrice.toFixed(2)}\n` +
          `Cantidad: ${actualSellQty.toFixed(8)} ${asset}\n` +
          `\n⚠️ Ciclo NO cerrado en DB. Revisar posición en exchange manualmente.`
        );
      }
      return; // Abort — do NOT close cycle in DB, do NOT write order record
    }
  }

  // Live sell confirmed (or simulation) — now safe to write order record
  await repo.createOrder({
    cycleId: cycle.id, pair, mode,
    orderType: "final_sell",
    side: "sell",
    price: currentPrice.toFixed(8),
    quantity: actualSellQty.toFixed(8),
    grossValueUsd: sellValueUsd.toFixed(2),
    feesUsd: fees.toFixed(2),
    slippageUsd: slippage.toFixed(2),
    netValueUsd: netValue.toFixed(2),
    triggerReason: dustAdjusted ? "trailing_exit_dust_adj" : "trailing_exit",
    humanReason: formatOrderReason("final_sell"),
  });

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

  // Store net profit (proceeds − costBasis) so DB semantic is consistent with all other close types
  const trailingNetProfitUsd = totalRealized - capitalUsedForPnl;
  await repo.updateCycle(cycle.id, {
    status: "closed",
    closeReason: "trailing_exit",
    totalQuantity: "0",
    realizedPnlUsd: trailingNetProfitUsd.toFixed(2),
    closedAt,
    ...(dustAdjusted ? { reconciliationStatus: "closed_with_exchange_dust_adjustment" } : {}),
  } as any);

  if (mode === "simulation") {
    const wallet = await repo.getSimulationWallet();
    await repo.updateSimulationWallet({
      availableBalanceUsd: (parseFloat(String(wallet.availableBalanceUsd)) + netValue).toFixed(2),
      usedBalanceUsd: Math.max(0, parseFloat(String(wallet.usedBalanceUsd)) - sellValueUsd).toFixed(2),
      realizedPnlUsd: (parseFloat(String(wallet.realizedPnlUsd)) + totalRealized - capitalUsedForPnl).toFixed(2),
    });
  }

  if (dustAdjusted) {
    const dustDiff = requestedQty - actualSellQty;
    const assetT = pair.split("/")[0];
    console.log(`${TAG}[SELL_QTY_ADJUSTED] #${cycle.id} ${pair} exit=trailing_exit requested=${requestedQty.toFixed(8)} available=${actualSellQty.toFixed(8)} submitted=${actualSellQty.toFixed(8)} diffPct=${(dustDiff / requestedQty * 100).toFixed(4)} closeAsDust=true`);
    await createHumanEvent({
      cycleId: cycle.id, pair, mode,
      eventType: "sell_quantity_adjusted_to_exchange_balance",
      severity: "info",
      message: `Venta trailing ajustada al saldo real del exchange: ${actualSellQty.toFixed(8)} ${assetT} (solicitado ${requestedQty.toFixed(8)}, diff=${dustDiff.toFixed(8)})`,
      payloadJson: {
        cycleId: cycle.id, pair, exitType: "trailing_exit",
        requestedQty, availableQty: actualSellQty, submittedQty: actualSellQty,
        diffQty: dustDiff,
        diffPct: requestedQty > 0 ? (dustDiff / requestedQty) * 100 : 0,
        dustToleranceQty: Math.max(0.00000002, requestedQty * 0.0025),
        closeAsDust: true,
      },
    }, { eventType: "sell_quantity_adjusted_to_exchange_balance", pair, mode, cycleId: cycle.id });
  }

  await createHumanEvent({
    cycleId: cycle.id, pair, mode,
    eventType: "trailing_exit",
    severity: "info",
    message: `Trailing exit: sold ${actualSellQty.toFixed(6)} @ ${currentPrice.toFixed(2)}, realized=${totalRealized.toFixed(2)}`,
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

  // ─── FASE 4: TRAILING_EXIT snapshot — non-blocking, write-only
  const avgEntry = parseFloat(String(cycle.avgEntryPrice || "0"));
  emitIdcaSnapshot({
    sourceMode: mode === "simulation" ? "IDCA_SIMULATION" : "REAL",
    cycleId: cycle.id,
    snapshotType: "TRAILING_EXIT",
    pair,
    eventTs: new Date(),
    entryPrice: avgEntry,
    exitPrice: currentPrice,
    executedAmount: actualSellQty,
    pnlNetUsd: trailingNetProfitUsd,
    pnlPct: pnlPctTrailing,
    holdTimeMinutes: durMs / 60000,
    exitReason: "trailing_exit",
  });
}

// ─── Breakeven Exit ────────────────────────────────────────────────

async function executeBreakevenExit(
  cycle: InstitutionalDcaCycle,
  currentPrice: number,
  config: InstitutionalDcaConfigRow,
  mode: IdcaMode
): Promise<void> {
  const pair = cycle.pair;
  const requestedQty = parseFloat(String(cycle.totalQuantity));
  const asset = pair.split("/")[0];

  // ─── FASE D: Balance guard + dust tolerance (LIVE only) ──────────────────────
  let actualSellQty = requestedQty;
  let dustAdjusted = false;

  if (mode === "live") {
    try {
      const exchange = ExchangeFactory.getTradingExchange();
      const balance = await exchange.getBalance();
      const availableQty = parseFloat(
        String((balance[asset] as any)?.available ?? balance[asset] ?? "0")
      );
      const dustResult = computeLiveSellQtyWithDustTolerance(requestedQty, availableQty, true, asset);
      actualSellQty = dustResult.sellQty;
      dustAdjusted = dustResult.adjusted;
      if (dustAdjusted) {
        console.warn(
          `${TAG}[BREAKEVEN_DUST_ADJ] cycleId=${cycle.id} ${pair} ` +
          `requested=${requestedQty.toFixed(8)} adjusted=${actualSellQty.toFixed(8)}`
        );
      }
    } catch (balanceErr: any) {
      console.error(`${TAG}[BREAKEVEN_BLOCKED] #${cycle.id} ${pair} — ${balanceErr.message}`);
      await createHumanEvent({
        cycleId: cycle.id, pair, mode,
        eventType: "critical_error",
        severity: "critical",
        message: `Venta breakeven bloqueada: ${balanceErr.message} — ciclo NO cerrado`,
        payloadJson: { error: balanceErr.message, price: currentPrice, qty: requestedQty },
      }, { eventType: "critical_error", pair, mode, price: currentPrice });
      const isBalanceFail = balanceErr.message.includes("insufficient_exchange_balance") || balanceErr.message.includes("balance_zero");
      if (shouldSendSellFailedAlert(cycle.id, "insufficient_exchange_balance")) {
        await telegram.sendRawMessage(
          `🚨 <b>[IDCA][LIVE] VENTA FALLIDA</b>\n\n` +
          `Par: <b>${pair}</b> #${cycle.id}\n` +
          `Tipo: breakeven_exit\n` +
          `Motivo: ${isBalanceFail ? "balance insuficiente real" : balanceErr.message}\n` +
          `Cantidad ciclo: ${requestedQty.toFixed(8)} ${asset}\n` +
          `\nCiclo NO cerrado en DB. Revisar posición manualmente.`
        );
      }
      return; // Abort — do NOT write order record
    }
  }

  const sellValueUsd = actualSellQty * currentPrice;
  let fees = 0, slippage = 0, netValue = sellValueUsd;
  if (mode === "simulation") {
    fees = sellValueUsd * (resolveSimulationFeePct(config) / 100);
    slippage = sellValueUsd * (parseFloat(String(config.simulationSlippagePct)) / 100);
    netValue = sellValueUsd - fees - slippage;
  }

  // ─── FASE E: Execute live sell BEFORE writing order record ───────────────────
  if (mode === "live") {
    try {
      await executeRealSell(cycle, "breakeven_sell", actualSellQty, true);
    } catch (sellErr: any) {
      console.error(`${TAG}[BREAKEVEN_SELL_FAILED] #${cycle.id} ${pair} — ${sellErr.message}`);
      await createHumanEvent({
        cycleId: cycle.id, pair, mode,
        eventType: "critical_error",
        severity: "critical",
        message: `Venta breakeven live FALLIDA: ${sellErr.message} — ciclo NO cerrado`,
        payloadJson: { error: sellErr.message, price: currentPrice, qty: actualSellQty },
      }, { eventType: "critical_error", pair, mode, price: currentPrice });
      if (shouldSendSellFailedAlert(cycle.id, "execution_error")) {
        await telegram.sendRawMessage(
          `🚨 <b>[IDCA][LIVE] BREAKEVEN SELL FALLIDA</b>\n\n` +
          `Par: <b>${pair}</b> #${cycle.id}\n` +
          `Error: <code>${sellErr.message}</code>\n` +
          `Cantidad: ${actualSellQty.toFixed(8)} ${asset}\n` +
          `\n⚠️ Ciclo NO cerrado en DB. Revisar posición en exchange manualmente.`
        );
      }
      return; // Abort — do NOT write order record
    }
  }

  // Live sell confirmed (or simulation) — now safe to write order record
  await repo.createOrder({
    cycleId: cycle.id, pair, mode,
    orderType: "breakeven_sell",
    side: "sell",
    price: currentPrice.toFixed(8),
    quantity: actualSellQty.toFixed(8),
    grossValueUsd: sellValueUsd.toFixed(2),
    feesUsd: fees.toFixed(2),
    slippageUsd: slippage.toFixed(2),
    netValueUsd: netValue.toFixed(2),
    triggerReason: dustAdjusted ? "breakeven_protection_dust_adj" : "breakeven_protection",
    humanReason: formatOrderReason("breakeven_sell"),
  });

  // Store net profit (may be near-zero for breakeven)
  const capitalUsedForBe = parseFloat(String(cycle.capitalUsedUsd || "0"));
  const beNetProfitUsd = netValue - capitalUsedForBe;
  await repo.updateCycle(cycle.id, {
    status: "closed",
    closeReason: "breakeven_exit",
    totalQuantity: "0",
    realizedPnlUsd: beNetProfitUsd.toFixed(2),
    closedAt: new Date(),
    ...(dustAdjusted ? { reconciliationStatus: "closed_with_exchange_dust_adjustment" } : {}),
  } as any);

  if (mode === "simulation") {
    const wallet = await repo.getSimulationWallet();
    await repo.updateSimulationWallet({
      availableBalanceUsd: (parseFloat(String(wallet.availableBalanceUsd)) + netValue).toFixed(2),
      usedBalanceUsd: Math.max(0, parseFloat(String(wallet.usedBalanceUsd)) - sellValueUsd).toFixed(2),
    });
  }

  if (dustAdjusted) {
    const dustDiff = requestedQty - actualSellQty;
    const asset = pair.split("/")[0];
    console.log(`${TAG}[SELL_QTY_ADJUSTED] #${cycle.id} ${pair} exit=breakeven_exit requested=${requestedQty.toFixed(8)} available=${actualSellQty.toFixed(8)} submitted=${actualSellQty.toFixed(8)} diffPct=${(dustDiff / requestedQty * 100).toFixed(4)} closeAsDust=true`);
    await createHumanEvent({
      cycleId: cycle.id, pair, mode,
      eventType: "sell_quantity_adjusted_to_exchange_balance",
      severity: "info",
      message: `Venta de protección ajustada al saldo real del exchange: ${actualSellQty.toFixed(8)} ${asset} (solicitado ${requestedQty.toFixed(8)}, diff=${dustDiff.toFixed(8)})`,
      payloadJson: {
        cycleId: cycle.id, pair, exitType: "breakeven_exit",
        requestedQty, availableQty: actualSellQty, submittedQty: actualSellQty,
        diffQty: dustDiff,
        diffPct: requestedQty > 0 ? (dustDiff / requestedQty) * 100 : 0,
        dustToleranceQty: Math.max(0.00000002, requestedQty * 0.0025),
        closeAsDust: true,
      },
    }, { eventType: "sell_quantity_adjusted_to_exchange_balance", pair, mode, cycleId: cycle.id });
  }

  await createHumanEvent({
    cycleId: cycle.id, pair, mode,
    eventType: "breakeven_exit",
    severity: "warn",
    message: `Breakeven exit: ${actualSellQty.toFixed(6)} @ ${currentPrice.toFixed(2)}`,
  }, {
    eventType: "breakeven_exit", pair, mode,
    price: currentPrice, quantity: actualSellQty, buyCount: cycle.buyCount,
  });

  const updatedCycle = await repo.getCycleById(cycle.id);
  if (updatedCycle) {
    await telegram.alertBreakevenExit(updatedCycle);
  }

  // ─── FASE 4: BREAKEVEN_EXIT snapshot — non-blocking, write-only
  const avgEntry = parseFloat(String(cycle.avgEntryPrice || "0"));
  const closedAt = new Date();
  const startedAt = cycle.startedAt ? new Date(cycle.startedAt) : closedAt;
  const durMs = closedAt.getTime() - startedAt.getTime();
  emitIdcaSnapshot({
    sourceMode: mode === "simulation" ? "IDCA_SIMULATION" : "REAL",
    cycleId: cycle.id,
    snapshotType: "BREAKEVEN_EXIT",
    pair,
    eventTs: new Date(),
    entryPrice: avgEntry,
    exitPrice: currentPrice,
    executedAmount: actualSellQty,
    pnlNetUsd: beNetProfitUsd,
    pnlPct: capitalUsedForBe > 0 ? (beNetProfitUsd / capitalUsedForBe) * 100 : 0,
    holdTimeMinutes: durMs / 60000,
    exitReason: "breakeven_exit",
  });
}

// ─── Entry Check Logic ─────────────────────────────────────────────

async function performEntryCheck(
  pair: string,
  currentPrice: number,
  config: InstitutionalDcaConfigRow,
  assetConfig: InstitutionalDcaAssetConfigRow,
  mode: IdcaMode,
  trailingBuyEntry?: { localLow: number; buyThreshold: number; maxExecutionPrice: number },
  observeOnly?: boolean
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
    pair,
  });

  // Structured log — always emitted for trazabilidad
  logBasePriceDebug(pair, currentPrice, basePriceResult);

  if (!basePriceResult.isReliable) {
    blocks.push({ code: "insufficient_base_price_data", message: basePriceResult.reason, timestamp: now });
  }

  // ── Helper: normalizar timestamps a milisegundos (Kraken puede enviar segundos) ──
  const normalizeTimestampMs = (value: unknown, fallback = Date.now()): number => {
    if (value instanceof Date) {
      const t = value.getTime();
      return Number.isFinite(t) ? t : fallback;
    }
    if (typeof value === "string") {
      const t = new Date(value).getTime();
      return Number.isFinite(t) ? t : fallback;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value) || value <= 0) return fallback;
      return value < 1e12 ? value * 1000 : value;
    }
    return fallback;
  };

  // ── Helper: aplicar lógica legacy de VWAP anchor ────────────────────────
  // Encapsulada para poder invocarla tanto en modo legacy directo como en fallback
  // cuando el servicio dinámico falla y idcaDynamicAnchorFallbackToLegacy=true.
  const anchorPriceBefore = vwapAnchorMemory.get(pair)?.anchorPrice ?? null;
  const applyLegacyVwapAnchor = async (): Promise<void> => {
    if (!assetConfig.vwapEnabled || !(basePriceResult.price > 0)) return;
    const rawTs = basePriceResult.timestamp;
    const newSwingTs =
      rawTs instanceof Date     ? rawTs.getTime() :
      typeof rawTs === "string" ? new Date(rawTs).getTime() :
      typeof rawTs === "number" ? rawTs :
      Date.now();
    if (isNaN(newSwingTs)) return;
    const newSwingPrice = basePriceResult.price;

    // Regla 1: resetear si precio supera la ancla CON HISTÉRESIS
    const currentAnchor = vwapAnchorMemory.get(pair);
    if (currentAnchor) {
      const resetCheck = shouldResetAnchor({
        pair,
        currentPrice,
        anchorPrice: currentAnchor.anchorPrice,
      });
      if (resetCheck.shouldReset) {
        vwapAnchorMemory.delete(pair);
        console.log(`${TAG}[VWAP_ANCHOR] ${pair}: RESET — ${resetCheck.reason}`);
        if (TrailingBuyManager.isArmed(pair)) {
          TrailingBuyManager.disarm(pair);
          telegram.alertTrailingBuyCancelled(pair, mode, currentPrice, "reference_changed")
            .catch(e => console.warn(`${TAG}[TELEGRAM] alertTrailingBuyCancelled(anchor_reset) failed: ${e.message}`));
        }
        tbState.resetTrailingBuyTelegramState(pair, mode, "reference_changed");
      }
    }

    // Regla 2: ancla solo sube, nunca baja CON THRESHOLD Y COOLDOWN
    const anchorAfterReset = vwapAnchorMemory.get(pair);
    if (!anchorAfterReset) {
      vwapAnchorMemory.set(pair, {
        anchorPrice: newSwingPrice,
        anchorTimestamp: newSwingTs,
        setAt: Date.now(),
        drawdownPct: 0,
      });
      console.log(`${TAG}[VWAP_ANCHOR] ${pair}: NEW — price=${newSwingPrice.toFixed(2)} ts=${new Date(newSwingTs).toISOString()}`);
    } else {
      const updateCheck = shouldUpdateAnchor({
        pair,
        currentPrice,
        newSwingPrice,
        anchorPrice: anchorAfterReset.anchorPrice,
        anchorSetAt: anchorAfterReset.setAt,
        now: Date.now(),
      });
      if (updateCheck.shouldUpdate) {
        vwapAnchorMemory.set(pair, {
          anchorPrice: newSwingPrice,
          anchorTimestamp: newSwingTs,
          setAt: Date.now(),
          drawdownPct: 0,
          previous: {
            anchorPrice: anchorAfterReset.anchorPrice,
            anchorTimestamp: anchorAfterReset.anchorTimestamp,
            setAt: anchorAfterReset.setAt,
            replacedAt: Date.now(),
          },
        });
        console.log(`${TAG}[VWAP_ANCHOR] ${pair}: UPDATE — ${updateCheck.reason}`);
      } else {
        console.log(`${TAG}[VWAP_ANCHOR] ${pair}: SKIP UPDATE — ${updateCheck.reason}`);
      }
    }

    const frozenNow = vwapAnchorMemory.get(pair);
    if (frozenNow) {
      frozenNow.drawdownPct = ((frozenNow.anchorPrice - currentPrice) / frozenNow.anchorPrice) * 100;
      vwapAnchorMemory.set(pair, frozenNow);
    }
    const fa = vwapAnchorMemory.get(pair);
    console.log(
      `${TAG}[VWAP_ANCHOR] ${pair} newSwing=${newSwingPrice.toFixed(2)} curPrice=${currentPrice.toFixed(2)} anchor=${fa?.anchorPrice?.toFixed(2) ?? "null"} dd=${fa?.drawdownPct?.toFixed(2) ?? "null"}%`
    );
    if (fa && fa.anchorPrice !== anchorPriceBefore) {
      const anchorAgeHours = (Date.now() - fa.setAt) / 3600000;
      telegram.alertVwapAnchorChanged(pair, mode, anchorPriceBefore, fa.anchorPrice, anchorAgeHours, fa.drawdownPct)
        .catch(e => console.warn(`${TAG}[TELEGRAM] alertVwapAnchorChanged failed: ${e.message}`));
    }
    if (fa && fa.drawdownPct > 0) {
      const anchorAgeHours = (Date.now() - fa.setAt) / 3600000;
      telegram.alertVwapDrawdownMilestone(pair, mode, fa.drawdownPct, fa.anchorPrice, anchorAgeHours)
        .catch(e => console.warn(`${TAG}[TELEGRAM] alertVwapDrawdownMilestone failed: ${e.message}`));
    }
    if (fa) {
      await repo.upsertVwapAnchor({
        pair,
        anchorPrice:    fa.anchorPrice,
        anchorTs:       fa.anchorTimestamp,
        setAt:          fa.setAt,
        drawdownPct:    fa.drawdownPct,
        prevPrice:      fa.previous?.anchorPrice ?? null,
        prevTs:         fa.previous?.anchorTimestamp ?? null,
        prevSetAt:      fa.previous?.setAt ?? null,
        prevReplacedAt: fa.previous?.replacedAt ?? null,
      }).catch(e => console.warn(`${TAG}[VWAP_ANCHOR] DB persist failed for ${pair}: ${e.message}`));
    }
  };

  // ── VWAP Anchor Memory — ejecutar legacy si Ancla Dinámica está desactivada o kill switch activo ──
  const _legacyAnchorActive = !(config.idcaDynamicAnchorEnabled ?? true) || (config.idcaDynamicAnchorEmergencyDisable ?? false);
  if (_legacyAnchorActive) {
    await applyLegacyVwapAnchor();
  }

  // Read frozen anchor (just updated above)
  const frozenAnchor = vwapAnchorMemory.get(pair);

  // ── VWAP Anchored context (computed early so it can influence dip check) ──
  let vwapContext: VwapEntryContext | undefined;
  if (assetConfig.vwapEnabled && basePriceResult.isReliable && basePriceResult.timestamp) {
    // Use frozen anchor timestamp if available, otherwise use basePriceResult timestamp
    const anchorMs = frozenAnchor?.anchorTimestamp
      ? frozenAnchor.anchorTimestamp
      : basePriceResult.timestamp instanceof Date
        ? basePriceResult.timestamp.getTime()
        : basePriceResult.timestamp;
    const vwapResult = smart.computeVwapAnchored(candles, anchorMs);
    if (vwapResult.isReliable) {
      const bandPos = smart.getVwapBandPosition(currentPrice, vwapResult);
      vwapContext = {
        vwap: vwapResult.vwap,
        upperBand1: vwapResult.upperBand1,
        lowerBand1: vwapResult.lowerBand1,
        upperBand2: vwapResult.upperBand2,
        lowerBand2: vwapResult.lowerBand2,
        lowerBand3: vwapResult.lowerBand3,
        stdDev: vwapResult.stdDev,
        anchorTime: vwapResult.anchorTime,
        candlesUsed: vwapResult.candlesUsed,
        candlesForSigma: vwapResult.candlesForSigma,
        isReliable: true,
        zone: bandPos.zone,
        distanceFromVwapPct: bandPos.distanceFromVwapPct,
        distanceFromLower1Pct: bandPos.distanceFromLower1Pct,
        vwapWeekly: vwapResult.vwapWeekly,
        vwapMonthly: vwapResult.vwapMonthly,
      };
      console.log(
        `${TAG}[VWAP] ${pair}: vwap=$${vwapResult.vwap.toFixed(2)}` +
        ` | zone=${bandPos.zone}` +
        ` | dist=${bandPos.distanceFromVwapPct.toFixed(2)}%` +
        ` | σ=$${vwapResult.stdDev.toFixed(2)}` +
        ` | bands=[$${vwapResult.lowerBand3.toFixed(2)}, $${vwapResult.lowerBand2.toFixed(2)}, $${vwapResult.lowerBand1.toFixed(2)}, $${vwapResult.upperBand1.toFixed(2)}, $${vwapResult.upperBand2.toFixed(2)}]` +
        ` | weekly=${vwapResult.vwapWeekly?.toFixed(2) ?? "n/a"} | monthly=${vwapResult.vwapMonthly?.toFixed(2) ?? "n/a"}` +
        ` | candles=${vwapResult.candlesUsed}`
      );
    }
  }

  // ── Ancla Dinámica IDCA (Lote 5) ─────────────────────────────────────────
  // Si idcaDynamicAnchorEnabled=true, el servicio dinámico decide si renovar, mantener,
  // esperar o bloquear. Si emergencyDisable=true, cae al comportamiento anterior.
  let dynamicAnchorResult: DynamicAnchorResult | null = null;
  const dynamicAnchorEnabled = config.idcaDynamicAnchorEnabled ?? true;
  const emergencyDisable = config.idcaDynamicAnchorEmergencyDisable ?? false;

  if (dynamicAnchorEnabled && !emergencyDisable) {
    // Verificar si hay ciclo activo real para este par (no hardcoded)
    const hasCycleForAnchor = await repo.hasActiveCycleForPair(pair, mode);
    // Verificar salida pendiente: si hay ciclo, leer instrucción activa
    let hasPendingExitForAnchor = false;
    if (hasCycleForAnchor) {
      const activeCycles = await repo.getAllActiveCyclesForPair(pair, mode);
      for (const c of activeCycles) {
        if (await exitRepo.hasPendingExitInstruction(c.id)) {
          hasPendingExitForAnchor = true;
          break;
        }
      }
    }

    // Calcular vwapResult para el servicio dinámico
    let vwapResultForDynamic: import("./IdcaSmartLayer").VwapResult | undefined;
    if (assetConfig.vwapEnabled && frozenAnchor?.anchorTimestamp) {
      const vr = smart.computeVwapAnchored(candles, frozenAnchor.anchorTimestamp);
      if (vr.isReliable) vwapResultForDynamic = vr;
    }

    try {
      dynamicAnchorResult = await resolveDynamicAnchor({
        pair,
        mode,
        currentPrice,
        candles,
        basePriceResult,
        frozenAnchor: frozenAnchor ?? null,
        vwapContext,
        vwapResult: vwapResultForDynamic,
        hasActiveCycle: hasCycleForAnchor,
        hasPendingExit: hasPendingExitForAnchor,
        vwapEnabled: assetConfig.vwapEnabled,
        dynamicAnchorEnabled,
        emergencyDisable,
        now: typeof now === "number" ? now : Date.now(),
      });

      // Si la decisión es renovar_ancla, aplicar la nueva referencia calculada
      if (
        dynamicAnchorResult.decision === "renovar_ancla" &&
        dynamicAnchorResult.calculatedAnchor &&
        dynamicAnchorResult.calculatedAnchor.price > 0
      ) {
        const newAnchorPrice = dynamicAnchorResult.calculatedAnchor.price;
        // anchorTimestamp = vela/estructura origen normalizada a ms (Kraken puede venir en segundos)
        // Prioridad: calculatedAnchor.timestamp > basePriceResult.timestamp > Date.now()
        const anchorTimestampMs = normalizeTimestampMs(
          dynamicAnchorResult.calculatedAnchor.timestamp
          ?? basePriceResult.timestamp
          ?? Date.now()
        );
        const prevAnchor = vwapAnchorMemory.get(pair);
        vwapAnchorMemory.set(pair, {
          anchorPrice: newAnchorPrice,
          anchorTimestamp: anchorTimestampMs,
          setAt: Date.now(),
          drawdownPct: newAnchorPrice > 0 ? ((newAnchorPrice - currentPrice) / newAnchorPrice) * 100 : 0,
          previous: prevAnchor ? {
            anchorPrice: prevAnchor.anchorPrice,
            anchorTimestamp: prevAnchor.anchorTimestamp,
            setAt: prevAnchor.setAt,
            replacedAt: Date.now(),
          } : undefined,
        });
        const updatedAnchor = vwapAnchorMemory.get(pair)!;
        repo.upsertVwapAnchor({
          pair,
          anchorPrice: updatedAnchor.anchorPrice,
          anchorTs: updatedAnchor.anchorTimestamp,
          setAt: updatedAnchor.setAt,
          drawdownPct: updatedAnchor.drawdownPct,
          prevPrice: updatedAnchor.previous?.anchorPrice ?? null,
          prevTs: updatedAnchor.previous?.anchorTimestamp ?? null,
          prevSetAt: updatedAnchor.previous?.setAt ?? null,
          prevReplacedAt: updatedAnchor.previous?.replacedAt ?? null,
        }).catch(e => console.warn(`${TAG}[DYNAMIC_ANCHOR] DB persist failed for ${pair}: ${e.message}`));
        console.log(`${TAG}[DYNAMIC_ANCHOR] ${pair}: RENOVADA — trigger=${dynamicAnchorResult.changeTrigger} newAnchor=${newAnchorPrice.toFixed(2)}`);
        // Alerta Telegram: Ancla renovada
        telegram.alertDynamicAnchorRenewed(
          pair, mode,
          dynamicAnchorResult.currentAnchor?.price ?? null,
          newAnchorPrice,
          dynamicAnchorResult.changeTrigger,
          dynamicAnchorResult.reason,
        ).catch(() => {});
      } else if (dynamicAnchorResult.decision === "bloquear_nuevas_entradas_por_datos") {
        blocks.push({ code: "data_not_ready", message: dynamicAnchorResult.reason, timestamp: now });
        // Alerta Telegram según tipo de bloqueo
        if (dynamicAnchorResult.dataState === "stopped") {
          const feedAge = (dynamicAnchorResult.auditPayload as any)?.lastCandleAgeMinutes as number | undefined;
          telegram.alertMarketDataFeedStalled(pair, mode, feedAge ?? 0).catch(() => {});
        } else {
          const cCount = (dynamicAnchorResult.auditPayload as any)?.candleCount as number | undefined;
          const rCount = (dynamicAnchorResult.auditPayload as any)?.required as number | undefined;
          telegram.alertDynamicAnchorBlocked(
            pair, mode,
            dynamicAnchorResult.reason,
            dynamicAnchorResult.dataState,
            cCount ?? 0,
            rCount ?? 72,
          ).catch(() => {});
        }
      } else if (dynamicAnchorResult.decision === "precio_caro_no_perseguir") {
        // P3: código específico para precio caro, distinto de errores de datos
        blocks.push({ code: "market_context_no_chase", message: dynamicAnchorResult.reason, timestamp: now });
      }

      console.log(`${TAG}[DYNAMIC_ANCHOR] ${pair}: decision=${dynamicAnchorResult.decision} trigger=${dynamicAnchorResult.changeTrigger} dataState=${dynamicAnchorResult.dataState}`);
    } catch (dynErr: any) {
      const fallbackToLegacy = config.idcaDynamicAnchorFallbackToLegacy ?? true;
      if (fallbackToLegacy) {
        // P1: fallbackToLegacy=true → ejecutar comportamiento legacy real
        console.warn(`${TAG}[DYNAMIC_ANCHOR] ${pair}: service error — ${dynErr?.message}. FallbackToLegacy=true: ejecutando lógica legacy.`);
        await applyLegacyVwapAnchor();
      } else {
        // P1: fallbackToLegacy=false → bloquear nueva entrada con razón explícita
        console.warn(`${TAG}[DYNAMIC_ANCHOR] ${pair}: service error — ${dynErr?.message}. FallbackToLegacy=false: bloqueando entrada.`);
        blocks.push({
          code: "dynamic_anchor_service_error",
          message: `Servicio de Ancla Dinámica no disponible y fallback desactivado. No se abre nueva entrada para ${pair}. Error: ${dynErr?.message ?? "desconocido"}.`,
          timestamp: now,
        });
      }
    }
  }

  // Leer el ancla después de la posible renovación dinámica
  const frozenAnchorFinal = vwapAnchorMemory.get(pair);

  // ── Effective base price: Ancla Dinámica manda cuando está activa ─────────
  // Usar función canónica para resolver la referencia efectiva de entrada
  const refResult = resolveEffectiveEntryReference({
    pair,
    currentPrice,
    basePriceResult,
    frozenAnchor: frozenAnchorFinal,
    vwapContext,
    vwapEnabled: assetConfig.vwapEnabled,
    now: typeof now === "number" ? now : Date.now(),
  });

  const effectiveBasePrice = refResult.effectiveEntryReference;
  const basePriceMethod = refResult.effectiveReferenceSource;

  const entryDipPct = effectiveBasePrice > 0
    ? ((effectiveBasePrice - currentPrice) / effectiveBasePrice) * 100
    : 0;

  const atrPct = basePriceResult.meta?.atrPct ?? 0;
  const entryMode = (assetConfig.entryMode ?? "assisted_entry") as IdcaEntryMode;
  const ddCfgEntry = parseDynamicDistanceConfig(assetConfig.dynamicDistanceConfigJson);
  const entryDistanceResult = resolveIdcaRequiredDistance({
    pair,
    usedFor: "initial_entry",
    activeEntryMode: entryMode,
    referencePrice: effectiveBasePrice > 0 ? effectiveBasePrice : currentPrice,
    atrPct,
    entryGlobalConfig: config,
    dynamicDistanceConfig: ddCfgEntry,
    buyCount: 0,
    marketScore: 50,  // Sprint 1a: safe default; marketScore se calcula después (post-line 3870)
    candleCount: ohlcCache.get(pair)?.length ?? 0,
    capitalUsedUsd: 0,
    capitalReservedUsd: 0,
  });
  let minDip = entryDistanceResult.requiredDistancePct;
  logDistanceResolution(TAG, pair, entryDistanceResult, {
    referencePrice: effectiveBasePrice,
    currentPrice,
    drawdownFromReferencePct: entryDipPct,
    trailingBuyWillArm: entryDipPct >= minDip,
  });
  console.log(
    `${TAG}[EFFECTIVE_CONFIG] pair=${pair}` +
    ` entryMode=${entryMode}` +
    ` entryDistanceSource=${entryDistanceResult.source}` +
    ` requiredDistancePct=${minDip.toFixed(2)}%` +
    ` legacyUsed=${entryDistanceResult.legacyUsed}` +
    ` legacyMinDipPct=${parseFloat(String(assetConfig.minDipPct)).toFixed(2)}%` +
    ` atrPct=${atrPct.toFixed(2)}%`
  );

  // Construir referenceContext enriquecido (solo metadata — no altera trading logic)
  // hasActiveCycle real: si el servicio dinámico evaluó el ciclo, usar su resultado
  const hasActiveCycleForContext = dynamicAnchorResult
    ? dynamicAnchorResult.cycleProtection === "ciclo_activo_protegido"
    : false;
  const referenceContext: ReferenceContext = buildReferenceContext({
    pair,
    refResult,
    basePriceResult,
    vwapEnabled: assetConfig.vwapEnabled,
    frozenAnchor: frozenAnchorFinal,
    vwapContext,
    minCandlesForEntry: MIN_VWAP_CANDLES_FOR_ENTRY_DEFAULT,
    hasActiveCycle: hasActiveCycleForContext,
    trailingArmed: TrailingBuyManager.isArmed(pair),
  });

  console.log(
    `${TAG}[REFERENCE_CONTEXT]` +
    ` pair=${pair}` +
    ` source=${referenceContext.referenceSource}` +
    ` label="${referenceContext.referenceLabel}"` +
    ` vwapUsed=${referenceContext.vwapUsed}` +
    ` vwapStatus=${referenceContext.vwapStatus}` +
    ` usableForEntry=${referenceContext.vwapReliability.usableForEntry}` +
    ` usableForContext=${referenceContext.vwapReliability.usableForContext}` +
    ` candlesUsed=${referenceContext.vwapReliability.candlesUsed ?? "n/a"}` +
    ` minCandlesRequired=${referenceContext.vwapReliability.minCandlesRequired}` +
    ` effectiveEntryReference=${effectiveBasePrice.toFixed(2)}` +
    ` anchorAgeHours=${referenceContext.anchorAgeHours?.toFixed(1) ?? "n/a"}` +
    ` reason="${referenceContext.referenceReason}"`
  );

  if (!referenceContext.vwapUsed && referenceContext.vwapRejectReason) {
    console.warn(
      `${TAG}[ANCHOR_METADATA_WARNING]` +
      ` pair=${pair}` +
      ` source=${referenceContext.referenceSource}` +
      ` vwapStatus=${referenceContext.vwapStatus}` +
      ` candlesUsed=${referenceContext.vwapReliability.candlesUsed ?? "n/a"}` +
      ` minRequired=${referenceContext.vwapReliability.minCandlesRequired}` +
      ` reason="${referenceContext.vwapRejectReason}"`
    );
  }

  if (trailingBuyEntry) {
    // ── Trailing Buy entry: la caída mínima ya fue validada al armar el TB ──
    // Solo verificar que el precio post-rebote no supera maxExecutionPrice
    if (currentPrice > trailingBuyEntry.maxExecutionPrice) {
      console.log(
        `${TAG}[TRAILING_BUY_EXECUTION_BLOCKED] pair=${pair}` +
        ` reason=execution_too_high currentPrice=$${currentPrice.toFixed(2)}` +
        ` maxExecutionPrice=$${trailingBuyEntry.maxExecutionPrice.toFixed(2)}` +
        ` buyThreshold=$${trailingBuyEntry.buyThreshold.toFixed(2)}` +
        ` localLow=$${trailingBuyEntry.localLow.toFixed(2)}`
      );
      blocks.push({
        code: "trailing_buy_execution_too_high",
        message: `currentPrice $${currentPrice.toFixed(2)} > maxExecutionPrice $${trailingBuyEntry.maxExecutionPrice.toFixed(2)} (buyThreshold=$${trailingBuyEntry.buyThreshold.toFixed(2)})`,
        timestamp: now,
      });
    }
    // insufficient_dip NO se valida con currentPrice; la caída ya fue confirmada por localLow
  } else if (basePriceResult.isReliable && entryDipPct < minDip) {
    blocks.push({ code: "insufficient_dip", message: `EntryDip ${entryDipPct.toFixed(2)}% < min ${minDip.toFixed(2)}% (EffectiveBase=$${effectiveBasePrice.toFixed(2)}, Method=${basePriceMethod})`, timestamp: now });
  }

  // ── Gate semanal VWAP (solo con vwapEnabled) ──────────────────────
  let weeklyTrend: "below" | "above" | "unknown" = "unknown";
  if (assetConfig.vwapEnabled && vwapContext?.vwapWeekly) {
    weeklyTrend = currentPrice < vwapContext.vwapWeekly ? "below" : "above";

    const isNeutralZone = (
      currentPrice >= (vwapContext.lowerBand1 || 0) &&
      currentPrice <= (vwapContext.upperBand1 || Infinity)
    );

    if (weeklyTrend === "below" && isNeutralZone) {
      blocks.push({ code: "vwap_weekly_trend_bearish", message: `Weekly VWAP bearish: price $${currentPrice.toFixed(2)} < weekly VWAP $${vwapContext.vwapWeekly.toFixed(2)} in neutral zone`, timestamp: now });
    }
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
      pair: "BTC/USD",
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
  let btcScoreForConfluence: number | undefined;

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
          btcScoreForConfluence = btcScore;
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

  // ── sizeProfile override por VWAP mensual ────────────────────
  let monthlyBias: "aggressive" | "balanced" | "defensive" | "unknown" = "unknown";
  if (assetConfig.vwapEnabled && vwapContext?.vwapMonthly) {
    const mp = vwapContext.vwapMonthly;
    if (currentPrice < mp * 0.95) {
      monthlyBias = "aggressive";
      sizeProfile = "aggressive_quality";
    } else if (currentPrice < mp) {
      monthlyBias = "balanced";
      // No override — keep market score profile
    } else {
      monthlyBias = "defensive";
      sizeProfile = "defensive";
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
    const reboundMin = parseFloat(String(assetConfig.reboundMinPct ?? "0.30"));
    reboundConfirmed = smart.detectRebound({ recentCandles, currentPrice, localLow, reboundMinPct: reboundMin });
    if (!reboundConfirmed) {
      blocks.push({ code: "no_rebound_confirmed", message: `Waiting for rebound confirmation (minBounce=${reboundMin}%)`, timestamp: now });
    }
  }

  // ── Confluence evaluation (Sprint 1b) ───────────────────────────────────────
  // Evaluar después de tener: marketScore, reboundConfirmed, atrPct, vwapZone.
  // Sprint 1b default: smartAdjustmentEnabled=false → sólo diagnóstico, sin cambio de minDip.
  let confluenceResult: IdcaConfluenceResult | undefined;
  if (config.smartModeEnabled || entryMode === "dynamic_intelligent_entry") {
    const allCandles = ohlcCache.get(pair) || [];
    const recentForMomentum = allCandles.slice(-6);
    const shortMomentum = _deriveShortMomentum(recentForMomentum);
    const hasRecoveryCandle = _deriveHasRecoveryCandle(recentForMomentum);
    const btcContextForPair = _deriveBtcContext(btcScoreForConfluence);
    const confluenceProfile = entryMode === "dynamic_intelligent_entry" ? "full" : "assisted";

    confluenceResult = evaluateIdcaEntryConfluence({
      pair,
      usedFor: trailingBuyEntry ? "trailing_buy_entry" : "initial_entry",
      confluenceProfile,
      drawdownFromReferencePct: entryDipPct,
      requiredDistancePct: minDip,
      sliderBasePct: entryDistanceResult.breakdown.sliderBasePct ?? minDip,
      dynamicRawDistancePct: entryMode === "dynamic_intelligent_entry"
        ? entryDistanceResult.requiredDistancePct : undefined,
      userMinEntryDistancePct: entryDistanceResult.breakdown.userMinDistancePct,
      userMaxEntryDistancePct: entryDistanceResult.breakdown.userMaxDistancePct,
      vwapZone: vwapContext?.zone,
      referenceMethod: basePriceMethod ?? undefined,
      vwapReliable: vwapContext?.isReliable ?? false,
      reboundConfirmed,
      requireReboundConfirmation: !!assetConfig.requireReboundConfirmation,
      trailingBuyArmed: TrailingBuyManager.isArmed(pair),
      priceInActivationZone: entryDipPct >= minDip,
      shortMomentum,
      hasRecoveryCandle,
      capitalUsedUsd: 0,
      capitalReservedUsd: 0,
      buyCount: 0,
      marketScore,
      atrPct,
      btcContext: btcContextForPair,
      candleCount: allCandles.length,
      atrReliable: atrPct > 0,
      smartAdjustmentEnabled: false,  // Sprint 1b default: solo diagnóstico
    });

    logIdcaConfluence(TAG, pair, confluenceResult);

    // Aplicar hard blockers de confluencia a blocks (deduplicando)
    if (confluenceResult.hardBlocked) {
      for (const hb of confluenceResult.hardBlockers) {
        if (!blocks.some(b => b.code === hb) && !blocks.some(b => b.code === "confluence_hard_blocked")) {
          blocks.push({ code: "confluence_hard_blocked", message: `Hard gate: ${hb}`, timestamp: now });
        }
      }
    }

    // Confluencia con NO_ENTRY por baja confianza (no causado por hard gate ya procesado)
    if (!confluenceResult.hardBlocked && confluenceResult.decisionClass === "NO_ENTRY") {
      blocks.push({
        code: "confluence_no_entry",
        message: `Confluence NO_ENTRY: score=${confluenceResult.confidenceScore} grade=${confluenceResult.confidenceGrade} regime=${confluenceResult.marketRegime}`,
        timestamp: now,
      });
    }

    // Si confluencia ajustó minDip (smart adjustment activo o dynamic_intelligent_entry)
    if (confluenceResult.finalRequiredDistancePct !== minDip) {
      minDip = confluenceResult.finalRequiredDistancePct;
      // Re-evaluar insufficient_dip con el nuevo minDip
      const insuffIdx = blocks.findIndex(b => b.code === "insufficient_dip");
      if (insuffIdx >= 0 && entryDipPct >= minDip) {
        blocks.splice(insuffIdx, 1);  // ahora satisfecho
      } else if (insuffIdx < 0 && basePriceResult.isReliable && !trailingBuyEntry && entryDipPct < minDip) {
        blocks.push({
          code: "insufficient_dip",
          message: `EntryDip ${entryDipPct.toFixed(2)}% < adjusted min ${minDip.toFixed(2)}% (confluence)`,
          timestamp: now,
        });
      }
    }
  }

  // Entry decision log — emitido con todos los bloques evaluados
  logEntryDecision(
    pair, mode,
    blocks.length === 0 ? "allowed" : "blocked",
    blocks.length === 0 ? "all_checks_passed" : blocks.map(b => b.code).join(","),
    entryDipPct, minDip, basePriceResult, currentPrice,
    effectiveBasePrice, basePriceMethod,
    observeOnly,
    entryDistanceResult.mode, entryDistanceResult.source,
    TrailingBuyManager.isArmed(pair)
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
    vwapContext,
    effectiveBasePrice,
    effectiveMinDip: minDip,
    basePriceMethod,
    weeklyTrend,
    monthlyBias,
    entrySource: trailingBuyEntry ? "trailing_buy" : "normal",
    dipValidatedBy: trailingBuyEntry ? "localLow" : "currentPrice",
    // Campos adicionales del resolver canónico
    technicalBasePrice: refResult.technicalBasePrice,
    technicalBaseType: refResult.technicalBaseType,
    technicalBaseReason: refResult.technicalBaseReason,
    technicalBaseTimestamp: refResult.technicalBaseTimestamp,
    frozenAnchorPrice: refResult.frozenAnchorPrice,
    frozenAnchorTs: refResult.frozenAnchorTs,
    frozenAnchorAgeHours: refResult.frozenAnchorAgeHours,
    frozenAnchorCandleAgeHours: refResult.frozenAnchorCandleAgeHours,
    previousAnchor: refResult.previousAnchor,
    atrPct: refResult.atrPct,
    referenceChangedRecently: refResult.referenceChangedRecently,
    referenceUpdatedAt: refResult.referenceUpdatedAt,
    referenceContext,
    confluenceResult,
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

// ─── Fee Helpers ────────────────────────────────────────────────────

/**
 * Resolve the simulation fee percentage.
 * Priority: executionFeesJson.takerFeePct > config.simulationFeePct > 0.09 (Revolut X default).
 * NOTE: Live mode fees are handled by the exchange — never applied here.
 */
function resolveSimulationFeePct(config: InstitutionalDcaConfigRow): number {
  const execFees = (config as any).executionFeesJson as any;
  if (execFees && typeof execFees.takerFeePct === "number") {
    return execFees.takerFeePct;
  }
  const legacy = parseFloat(String(config.simulationFeePct));
  return Number.isFinite(legacy) && legacy >= 0 ? legacy : 0.09;
}

// ─── Market Data Helpers ───────────────────────────────────────────

async function getCurrentPrice(pair: string): Promise<number> {
  const price = await MarketDataService.getPrice(pair);
  if (price > 0) {
    priceCache.set(pair, price);
    return price;
  }
  return priceCache.get(pair) || 0;
}

function getVolatility(pair: string): number {
  const candles = ohlcCache.get(pair) || [];
  if (candles.length < 5) return 2.0; // Default
  return smart.computeATRPct(candles);
}

// ─── Confluence helpers ───────────────────────────────────────────────

function _deriveShortMomentum(
  candles: { close: number }[]
): "positive" | "flat" | "negative" {
  if (candles.length < 4) return "flat";
  const recent = candles[candles.length - 1].close;
  const past   = candles[candles.length - 4].close;
  if (past <= 0) return "flat";
  const pct = ((recent - past) / past) * 100;
  return pct > 0.3 ? "positive" : pct < -0.3 ? "negative" : "flat";
}

function _deriveHasRecoveryCandle(candles: { close: number; open?: number }[]): boolean {
  if (candles.length < 2) return false;
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  return !!(last.open && last.close > last.open && last.close > prev.close);
}

function _deriveBtcContext(
  btcScore: number | undefined
): "supportive" | "neutral" | "weak" | "breakdown" | undefined {
  if (btcScore == null) return undefined;
  if (btcScore >= 65) return "supportive";
  if (btcScore >= 50) return "neutral";
  if (btcScore >= 35) return "weak";
  return "breakdown";
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

function logEntryDecision(
  pair: string, mode: string, action: "allowed" | "blocked", reason: string,
  dip: number, minDip: number, base: BasePriceResult, currentPrice: number,
  effectiveBasePrice?: number, basePriceMethod?: string,
  observeOnly?: boolean,
  distanceMode?: string, distanceSource?: string,
  tbArmed?: boolean
): void {
  const effBase = effectiveBasePrice ?? base.price;
  const effMethod = basePriceMethod ?? base.type ?? "hybrid";
  const drawdownFromEff = effBase > 0 ? ((effBase - currentPrice) / effBase) * 100 : dip;

  // Determine effective action label for logging
  const effectiveAction = observeOnly ? "observed" : action;

  console.log(
    `${TAG}[IDCA_ENTRY_DECISION]` +
    ` pair=${pair}` +
    ` action=${effectiveAction}` +
    ` observeOnly=${observeOnly ?? false}` +
    ` reason="${reason}"` +
    ` entryMode=${distanceMode ?? "assisted_entry"}` +
    ` required_drop_source=${distanceSource ?? "assisted_entry_sliders"}` +
    ` hybrid_base_price=${base.price.toFixed(2)}` +
    ` effective_entry_reference=${effBase.toFixed(2)}` +
    ` reference_method=${effMethod}` +
    ` drawdown_from_reference_pct=${drawdownFromEff.toFixed(2)}%` +
    ` required_drop=${minDip.toFixed(2)}%` +
    ` current_price=${currentPrice.toFixed(2)}`
  );

  // Persist to DB (always for "allowed" non-observe; throttled 5min for "blocked"/"observed" to avoid DB spam)
  const now = Date.now();
  const last = lastEntryEventMs.get(pair) ?? 0;

  // Always persist for non-observe allowed entries; throttle for blocked and observed
  const shouldPersist = (!observeOnly && action === "allowed") || now - last >= ENTRY_EVENT_THROTTLE_MS;

  if (shouldPersist) {
    lastEntryEventMs.set(pair, now);

    // Build message based on context
    let message: string;
    if (observeOnly) {
      const observeCtx = tbArmed
        ? "trailing buy en vigilancia"
        : "condiciones de entrada detectadas";
      message = `[${pair}] Entrada observada — ${observeCtx} | caída ${dip.toFixed(2)}% vs mínimo ${minDip.toFixed(2)}% | base=$${base.price.toFixed(2)}`;
    } else if (action === "allowed") {
      message = `[${pair}] Entrada PERMITIDA — caída ${dip.toFixed(2)}% ≥ mínimo ${minDip.toFixed(2)}% | base=$${base.price.toFixed(2)}`;
    } else {
      message = `[${pair}] Entrada bloqueada (${reason}) — caída ${dip.toFixed(2)}% vs mínimo ${minDip.toFixed(2)}%`;
    }

    repo.createEvent({
      pair,
      mode,
      eventType: observeOnly ? "entry_observed" : "entry_evaluated",
      severity: "info",
      message,
      payloadJson: { action: effectiveAction, reason, dip, minDip, basePrice: base.price, currentPrice, baseMethod: base.meta?.selectedMethod ?? base.type, observeOnly: observeOnly ?? false },
    }).then(() => {
      console.log(`${TAG}[ENTRY_EVENT] Persisted ${observeOnly ? "entry_observed" : "entry_evaluated"} pair=${pair} mode=${mode} action=${effectiveAction}`);
    }).catch(e => {
      console.error(`${TAG}[ENTRY_EVENT] FAILED to persist entry event pair=${pair}: ${e?.message}`);
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
    open:   parseFloat(String(c.open   || c[1] || 0)),
    high:   parseFloat(String(c.high   || c[2] || 0)),
    low:    parseFloat(String(c.low    || c[3] || 0)),
    close:  parseFloat(String(c.close  || c[4] || 0)),
    volume: parseFloat(String(c.volume || c[5] || 0)),
    time:   c.time ? (c.time > 1e12 ? c.time : c.time * 1000) : (c[0] ? (c[0] > 1e12 ? c[0] : c[0] * 1000) : Date.now()),
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

      // ── 1h candles (24h / 7d / 30d analysis) — via MarketDataService ──
      const candles1h = await MarketDataService.getCandles(pair, "1h");
      if (candles1h.length > 0) {
        const mapped1h = mapKrakenCandles(candles1h);
        ohlcCache.set(pair, mapped1h);
        console.log(
          `${TAG}[OHLCV] ${pair}: ${mapped1h.length} 1h candles` +
          ` | first=${new Date(mapped1h[0].time).toISOString().slice(0, 16)}` +
          ` | last=${new Date(mapped1h[mapped1h.length - 1].time).toISOString().slice(0, 16)}` +
          ` | source=${ExchangeFactory.getDataExchangeType()} (MDS)`
        );
        // Store last 10 in DB cache
        for (const c of candles1h.slice(-10)) {
          try {
            await repo.upsertOhlcv({
              pair, timeframe: "1h",
              ts: new Date(c.time * 1000),
              open: String(c.open), high: String(c.high),
              low:  String(c.low),  close: String(c.close),
              volume: String(c.volume),
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
        const candlesDaily = await MarketDataService.getCandles(pair, "1d");
        if (candlesDaily.length > 0) {
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

// ─── Order Execution (Live) — HOTFIX: Validar saldo, ajustar, confirmar fill ────────────────────────────────────────

export interface BuyExecutionResult {
  success: boolean;
  orderId?: string;
  executedQty: number;
  executedUsd: number;
  avgPrice: number;
  feeUsd: number;
  wasAdjusted: boolean;
  originalQty?: number;
  rejectionReason?: string;
  // Fee tracking for base-asset fees (e.g., Revolut X charges fee in BTC)
  grossBaseQty?: number;
  netBaseQty?: number;
  feeAsset?: string;
  feeAmount?: number;
  feeSource?: "exchange_api" | "inferred_from_default_pct" | "manual" | "legacy" | null;
}

/**
 * HOTFIX: Ejecuta compra LIVE con validación de saldo, ajuste dinámico,
 * y confirmación de fill antes de retornar.
 * NUNCA modifica el ciclo directamente — eso lo hace el llamador con los valores retornados.
 */
async function executeRealBuyWithGuard(
  pair: string,
  intendedQty: number,
  price: number,
  cycleId: number,
  buyType: "initial" | "safety" | "plus" | "recovery",
  mode: string,
  assetConfig?: InstitutionalDcaAssetConfigRow,
  buyLevel?: number
): Promise<BuyExecutionResult> {
  const intendedUsd = intendedQty * price;

  // ─── FASE 1: Validar intención con ExecutionGuard ───
  const validation = await liveGuard.validateLiveBuyIntention({
    pair,
    cycleId,
    buyType,
    intendedUsd,
    intendedQty,
    currentPrice: price,
    feePct: 0.1, // Default: asset config doesn't have makerFeePct field
    slippagePct: 0.1, // Default: asset config doesn't have slippage field
    mode,
    buyLevel,
  });

  if (!validation.allowed) {
    console.error(`${TAG}[LIVE][BUY][BLOCKED] ${validation.reason}`);
    return {
      success: false,
      executedQty: 0,
      executedUsd: 0,
      avgPrice: 0,
      feeUsd: 0,
      wasAdjusted: false,
      originalQty: intendedQty,
      rejectionReason: validation.reason,
    };
  }

  // Usar cantidad ajustada si fue reducida
  const finalQty = validation.reduced ? (validation.finalQty ?? intendedQty) : intendedQty;
  const finalUsd = validation.reduced ? (validation.finalUsd ?? intendedUsd) : intendedUsd;

  if (validation.reduced) {
    console.log(`${TAG}[LIVE][BUY][ADJUSTED] ${pair} ${buyType}: ${intendedQty.toFixed(8)} → ${finalQty.toFixed(8)} (${finalUsd.toFixed(2)} USD)`);
  }

  // ─── FASE 2: Enviar orden al exchange ───
  let exchangeOrderId: string | undefined;
  try {
    const tradingExchange = ExchangeFactory.getTradingExchange();
    if (!tradingExchange.isInitialized()) {
      throw new Error("Trading exchange not initialized");
    }

    console.log(`${TAG}[LIVE][BUY][SENDING] ${pair} qty=${finalQty.toFixed(8)} @ ~${price.toFixed(2)}`);

    const orderResult = await tradingExchange.placeOrder({
      pair,
      type: "buy",
      ordertype: "market",
      volume: finalQty.toFixed(8),
    });

    if (!orderResult.success) {
      throw new Error(orderResult.error || "Order rejected by exchange");
    }

    exchangeOrderId = orderResult.orderId || orderResult.txid;
    console.log(`${TAG}[LIVE][BUY][SENT] ${pair} orderId=${exchangeOrderId || "pending"}`);

  } catch (e: any) {
    console.error(`${TAG}[LIVE][BUY][SEND_FAILED] ${pair}: ${e.message}`);
    return {
      success: false,
      executedQty: 0,
      executedUsd: 0,
      avgPrice: 0,
      feeUsd: 0,
      wasAdjusted: validation.reduced ?? false,
      originalQty: intendedQty,
      rejectionReason: `send_failed: ${e.message}`,
    };
  }

  // ─── FASE 3: Confirmar fill ───
  if (!exchangeOrderId) {
    return {
      success: false,
      executedQty: 0,
      executedUsd: 0,
      avgPrice: 0,
      feeUsd: 0,
      wasAdjusted: validation.reduced ?? false,
      originalQty: intendedQty,
      rejectionReason: "no_exchange_order_id",
    };
  }

  const fillConfirmation = await liveGuard.confirmOrderFill(pair, exchangeOrderId, 30000, 2000);

  if (!fillConfirmation.confirmed || fillConfirmation.filledQty <= 0) {
    console.error(`${TAG}[LIVE][BUY][NO_FILL] ${pair} orderId=${exchangeOrderId} status=${fillConfirmation.status}`);
    return {
      success: false,
      orderId: exchangeOrderId,
      executedQty: 0,
      executedUsd: 0,
      avgPrice: 0,
      feeUsd: 0,
      wasAdjusted: validation.reduced ?? false,
      originalQty: intendedQty,
      rejectionReason: `no_fill: ${fillConfirmation.status}`,
    };
  }

  // ─── FASE 4: Éxito — retornar valores reales de ejecución ───
  console.log(
    `${TAG}[LIVE][BUY][CONFIRMED] ${pair} orderId=${exchangeOrderId} ` +
    `qty=${fillConfirmation.filledQty.toFixed(8)} avg=${fillConfirmation.avgFillPrice.toFixed(2)} ` +
    `fee=${fillConfirmation.feeUsd.toFixed(4)} netQty=${fillConfirmation.netBaseQty?.toFixed(8) || 'N/A'}`
  );

  return {
    success: true,
    orderId: exchangeOrderId,
    executedQty: fillConfirmation.filledQty,
    executedUsd: fillConfirmation.filledUsd,
    avgPrice: fillConfirmation.avgFillPrice,
    feeUsd: fillConfirmation.feeUsd,
    wasAdjusted: validation.reduced ?? false,
    originalQty: validation.reduced ? intendedQty : undefined,
    grossBaseQty: fillConfirmation.grossBaseQty,
    netBaseQty: fillConfirmation.netBaseQty,
    feeAsset: fillConfirmation.feeAsset,
    feeAmount: fillConfirmation.feeAmount,
    feeSource: fillConfirmation.feeSource,
  };
}

/** @deprecated Usar executeRealBuyWithGuard que valida saldo y confirma fill */
async function executeRealBuy(pair: string, quantity: number, price: number, assetConfig?: InstitutionalDcaAssetConfigRow): Promise<void> {
  // Mantener compatibilidad hacia atrás — llamar al nuevo método y lanzar error si falla
  const result = await executeRealBuyWithGuard(pair, quantity, price, 0, "safety", "live", assetConfig);
  if (!result.success) {
    throw new Error(result.rejectionReason || "Buy execution failed");
  }
}

/**
 * HOTFIX: Ejecuta compra inicial de ciclo en modo LIVE con confirmación de fill.
 * SOLO crea el ciclo si el fill es confirmado. Si falla, NO crea ciclo.
 */
async function executeInitialBuyLiveSafe(
  pair: string,
  quantity: number,
  currentPrice: number,
  mode: IdcaMode,
  assetConfig?: InstitutionalDcaAssetConfigRow,
  config?: InstitutionalDcaConfigRow,
  check?: IdcaEntryCheckResult
): Promise<{ success: boolean; cycleId?: number; executedQty?: number; executedUsd?: number; avgFillPrice?: number; feeUsd?: number; wasAdjusted?: boolean; originalQty?: number; error?: string }> {
  const intendedQty = quantity;
  const intendedUsd = quantity * currentPrice;

  // 1. Ejecutar compra con validación de saldo y confirmación de fill
  const execResult = await executeRealBuyWithGuard(
    pair,
    intendedQty,
    currentPrice,
    0, // cycleId aún no existe
    "initial",
    mode,
    assetConfig,
    1 // buyLevel 1
  );

  if (!execResult.success) {
    // NO crear ciclo si la compra falló
    console.error(`${TAG}[LIVE][INITIAL_BUY] FAILED: ${execResult.rejectionReason}`);
    await createHumanEvent({
      cycleId: undefined,
      pair,
      mode,
      eventType: "initial_buy_failed",
      severity: "error",
      message: `Compra inicial bloqueada/fallida: ${execResult.rejectionReason}`,
      payloadJson: { intendedQty, intendedUsd, currentPrice, reason: execResult.rejectionReason },
    }, { eventType: "initial_buy_failed", pair, mode, price: currentPrice, quantity: intendedQty });
    return { success: false, error: execResult.rejectionReason };
  }

  // 2. Fill confirmado - ahora crear ciclo con valores EJECUTADOS (no planificados)
  console.log(`${TAG}[LIVE][INITIAL_BUY] FILL CONFIRMED: qty=${execResult.executedQty.toFixed(8)} avg=${execResult.avgPrice.toFixed(2)}`);

  // Usar valores ejecutados para crear el ciclo
  const executedQty = execResult.executedQty;
  const executedUsd = execResult.executedUsd;
  const avgFillPrice = execResult.avgPrice;
  const feeUsd = execResult.feeUsd;

  return { success: true, executedQty, executedUsd, avgFillPrice, feeUsd, wasAdjusted: execResult.wasAdjusted, originalQty: execResult.originalQty };
}

/**
 * HOTFIX: Ejecuta safety buy en modo LIVE con confirmación de fill.
 * SOLO actualiza ciclo si el fill es confirmado. Si falla, NO toca ciclo.
 */
async function executeSafetyBuyLiveSafe(
  cycle: InstitutionalDcaCycle,
  pair: string,
  quantity: number,
  currentPrice: number,
  mode: IdcaMode,
  assetConfig?: InstitutionalDcaAssetConfigRow,
  buyLevel: number = 1
): Promise<{ success: boolean; executedQty?: number; executedUsd?: number; avgPrice?: number; wasAdjusted?: boolean; originalQty?: number; orderId?: string; error?: string }> {
  const intendedQty = quantity;

  // 1. Ejecutar compra con validación de saldo y confirmación de fill
  const execResult = await executeRealBuyWithGuard(
    pair,
    intendedQty,
    currentPrice,
    cycle.id,
    "safety",
    mode,
    assetConfig,
    buyLevel
  );

  if (!execResult.success) {
    const rejReason = execResult.rejectionReason ?? "unknown";
    console.error(`${TAG}[LIVE][SAFETY_BUY] FAILED for cycle #${cycle.id}: ${rejReason}`);
    if (!isSafetyBuyOnCooldown(pair, cycle.id, buyLevel, rejReason)) {
      const isUnknownPending = rejReason.startsWith("no_fill") || rejReason.startsWith("execution_unknown");
      await createHumanEvent({
        cycleId: cycle.id,
        pair,
        mode,
        eventType: isUnknownPending ? "safety_buy_unknown_pending" : "safety_buy_failed",
        severity: isUnknownPending ? "warning" : "error",
        message: isUnknownPending
          ? `Safety buy #${buyLevel} ejecución desconocida — pendiente reconciliación manual: ${rejReason}`
          : `Safety buy #${buyLevel} bloqueado/fallido: ${rejReason}`,
        payloadJson: { intendedQty, currentPrice, reason: rejReason },
      }, { eventType: "safety_buy_failed", pair, mode, cycleId: cycle.id, price: currentPrice, quantity: intendedQty });
      setSafetyBuyCooldown(pair, cycle.id, buyLevel, rejReason);
    } else {
      console.log(`${TAG}[BUY_COOLDOWN_SKIP] ${pair} cycle#${cycle.id} safety#${buyLevel} — event suppressed (cooldown active)`);
    }
    return { success: false, error: rejReason };
  }

  // 2. Fill confirmado - retornar valores ejecutados
  console.log(`${TAG}[LIVE][SAFETY_BUY] FILL CONFIRMED for cycle #${cycle.id}: qty=${execResult.executedQty.toFixed(8)} avg=${execResult.avgPrice.toFixed(2)}`);

  return {
    success: true,
    executedQty: execResult.executedQty,
    executedUsd: execResult.executedUsd,
    avgPrice: execResult.avgPrice,
    wasAdjusted: execResult.wasAdjusted,
    originalQty: execResult.originalQty,
    orderId: execResult.orderId,
  };
}

async function executeRealSell(cycle: InstitutionalDcaCycle, orderType: string, quantity: number, isFullClose: boolean = false): Promise<void> {
  try {
    // HOTFIX: Validar balance base real antes de vender
    const cycleQty = parseFloat(String(cycle.totalQuantity));
    const validation = await liveGuard.validateSellQuantity(cycle.pair, quantity, cycleQty, isFullClose);
    if (!validation.valid) {
      console.error(`${TAG}[LIVE][SELL] BLOCKED: ${validation.reason} (pair=${cycle.pair} qty=${quantity.toFixed(8)} available=${validation.availableQty.toFixed(8)})`);
      await createHumanEvent({
        cycleId: cycle.id,
        pair: cycle.pair,
        mode: "live",
        eventType: "cycle_exchange_qty_mismatch",
        severity: "critical",
        message: `Venta bloqueada: ${validation.reason}. Ciclo necesita reconciliación.`,
        payloadJson: { requestedQty: quantity, availableQty: validation.availableQty, reason: validation.reason },
      }, { eventType: "cycle_exchange_qty_mismatch", pair: cycle.pair, mode: "live", cycleId: cycle.id });
      throw new Error(`Live sell blocked: ${validation.reason} (pair=${cycle.pair} type=${orderType})`);
    }

    // Usar cantidad ajustada si dust tolerance fue aplicada
    const sellQty = validation.adjustedQty ?? quantity;
    if (validation.adjustedQty && validation.adjustedQty !== quantity) {
      console.log(`${TAG}[LIVE][SELL] Dust tolerance applied: original=${quantity.toFixed(8)} adjusted=${sellQty.toFixed(8)} reason=${validation.reason}`);
    }

    const tradingExchange = ExchangeFactory.getTradingExchange();
    if (!tradingExchange.isInitialized()) {
      console.error(`${TAG}[LIVE][SELL] Trading exchange not initialized — order NOT sent for ${cycle.pair}`);
      throw new Error(`Live sell blocked: exchange not initialized (pair=${cycle.pair} type=${orderType})`);
    }
    console.log(`${TAG}[LIVE][SELL] Placing order: ${cycle.pair} type=${orderType} qty=${sellQty.toFixed(8)}`);
    const result = await tradingExchange.placeOrder({
      pair: cycle.pair,
      type: "sell",
      ordertype: "market",
      volume: sellQty.toFixed(8),
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

// ─── TimeStop Ignored Logger (anti-spam) ────────────────────────────

const lastTimeStopIgnoredLog = new Map<number, number>(); // cycleId -> last log timestamp
const TIMESTOP_IGNORED_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

async function logTimeStopIgnoredOnce(
  cycleId: number,
  pair: string,
  mode: string,
  ageMs: number,
  maxDurationHours: number
): Promise<void> {
  const now = Date.now();
  const lastLog = lastTimeStopIgnoredLog.get(cycleId) ?? 0;
  if (now - lastLog < TIMESTOP_IGNORED_COOLDOWN_MS) {
    return; // Skip - already logged within cooldown
  }

  const ageHours = (ageMs / 3600000).toFixed(1);
  console.log(`${TAG}[TIMESTOP_IGNORED] #${cycleId} ${pair}: TimeStop disabled, age=${ageHours}h > max=${maxDurationHours}h`);

  await createHumanEvent({
    cycleId,
    pair,
    mode,
    eventType: "cycle_management",
    severity: "info",
    message: `TimeStop ignorado por configuración manual: el ciclo superó la duración máxima (${maxDurationHours}h) pero no se cerró porque TimeStop está desactivado.`,
    payloadJson: {
      ageHours,
      maxDurationHours,
      timeStopDisabled: true,
    },
  }, {
    eventType: "cycle_management",
    pair,
    mode,
    reason: `TimeStop disabled, age=${ageHours}h > max=${maxDurationHours}h`,
  });

  lastTimeStopIgnoredLog.set(cycleId, now);
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
    let maxBuys: number;
    if (assetConfig.ladderAtrpEnabled && assetConfig.ladderAtrpConfigJson) {
      // Calcular ladder real y usar totalLevels
      try {
        const { idcaLadderAtrpService } = await import('./IdcaLadderAtrpService');
        const frozenAnchor = vwapAnchorMemory.get(pair);
        const ladder = await idcaLadderAtrpService.calculateLadder(
          pair,
          assetConfig.ladderAtrpConfigJson as import('./IdcaTypes').LadderAtrpConfig,
          undefined,
          frozenAnchor?.anchorPrice
        );
        maxBuys = ladder.totalLevels;
        console.log(`${TAG}[PLUS] ${pair}: ladder real calculated, totalLevels=${maxBuys}`);
      } catch (error) {
        console.error(`${TAG}[PLUS] ${pair}: error calculating ladder, fallback to maxLevels`, error);
        // Fallback seguro a maxLevels
        maxBuys = (assetConfig.ladderAtrpConfigJson as any).maxLevels || 5;
      }
    } else {
      // Usar safety orders legacy
      const safetyOrders = parseSafetyOrders(assetConfig.safetyOrdersJson);
      maxBuys = safetyOrders.length + 1; // base + safety orders
    }
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

  // ─── Lote 4: Guard — No plus cycle if main has exit instruction pending ───
  if (await exitRepo.hasPendingExitInstruction(mainCycle.id)) {
    console.log(`${TAG}[PLUS_BLOCKED] ${pair} #${mainCycle.id}: exit instruction pending, blocking plus activation`);
    return;
  }

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

  // ─── HOTFIX: Flujo seguro LIVE vs SIMULATION ─────────────────────

  let executedQty = quantity;
  let executedUsd = baseBuyUsd;
  let avgFillPrice = currentPrice;
  let feeUsd = 0;
  let wasAdjusted = false;
  let originalQty: number | undefined;
  let exchangeOrderId: string | undefined;

  // Fee tracking variables (default to executedQty for simulation)
  let netBaseQty = quantity;
  let grossBaseQty = quantity;
  let feeAsset: string | null | undefined = null;
  let feeAmount: number | null | undefined = null;
  let feeSource: "exchange_api" | "inferred_from_default_pct" | "manual" | "legacy" | null | undefined = null;

  if (mode === "live") {
    // ─── MODO LIVE: Ejecutar PRIMERO, crear ciclo DESPUÉS ─────────
    const execResult = await executeRealBuyWithGuard(
      pair,
      quantity,
      currentPrice,
      0, // cycleId aún no existe
      "plus",
      mode,
      assetConfig,
      1
    );

    if (!execResult.success) {
      // NO crear ciclo si la compra falló
      console.error(`${TAG}[LIVE][PLUS] FAILED: ${execResult.rejectionReason}`);
      await createHumanEvent({
        cycleId: undefined,
        pair,
        mode,
        eventType: "plus_buy_failed",
        severity: "error",
        message: `Plus buy bloqueado/fallido: ${execResult.rejectionReason}`,
        payloadJson: { intendedQty: quantity, intendedUsd: baseBuyUsd, currentPrice, reason: execResult.rejectionReason, parentCycleId: mainCycle.id },
      }, { eventType: "plus_buy_failed", pair, mode, price: currentPrice, quantity, parentCycleId: mainCycle.id });
      return; // Abortar - NO crear ciclo
    }

    // Fill confirmado - usar valores EJECUTADOS
    executedQty = execResult.executedQty;
    executedUsd = execResult.executedUsd;
    avgFillPrice = execResult.avgPrice;
    feeUsd = execResult.feeUsd;
    wasAdjusted = execResult.wasAdjusted;
    originalQty = execResult.originalQty;
    exchangeOrderId = execResult.orderId;

    // Fee tracking: usar netBaseQty si está disponible (fee en base asset)
    netBaseQty = execResult.netBaseQty ?? executedQty;
    grossBaseQty = execResult.grossBaseQty ?? executedQty;
    feeAsset = execResult.feeAsset ?? null;
    feeAmount = execResult.feeAmount ?? null;
    feeSource = execResult.feeSource ?? null;

    console.log(`${TAG}[LIVE][PLUS] FILL CONFIRMED: qty=${executedQty.toFixed(8)} avg=${avgFillPrice.toFixed(2)} netQty=${netBaseQty.toFixed(8)} feeAsset=${feeAsset || 'N/A'}`);
  } else {
    // ─── MODO SIMULATION: Calcular fees simulados ────────────────
    feeUsd = baseBuyUsd * (resolveSimulationFeePct(config) / 100);
    const slippageUsd = baseBuyUsd * (parseFloat(String(config.simulationSlippagePct)) / 100);
    executedUsd = baseBuyUsd + feeUsd + slippageUsd;
  }

  // Next plus entry level
  const nextDipPct = entrySteps.length > 1 ? entrySteps[1] : null;
  const nextBuyPrice = nextDipPct ? avgFillPrice * (1 - nextDipPct / 100) : null;

  // ─── Crear ciclo SOLO después de fill confirmado ─────────────────
  const plusCycle = await repo.createCycle({
    pair,
    strategy: "institutional_dca_v1_plus",
    mode,
    status: "active",
    capitalReservedUsd: plusCapital.toFixed(2),
    capitalUsedUsd: executedUsd.toFixed(2),
    totalCostBasisUsd: executedUsd.toFixed(2),
    // HOTFIX: Usar netBaseQty (cantidad neta post-fee en base asset) para totalQuantity
    totalQuantity: (mode === "live" ? netBaseQty : executedQty).toFixed(8),
    avgEntryPrice: avgFillPrice.toFixed(8),
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
  } as any);

  // Crear orden con valores EJECUTADOS
  await repo.createOrder({
    cycleId: plusCycle.id,
    pair,
    mode,
    orderType: "base_buy",
    buyIndex: 1,
    side: "buy",
    price: avgFillPrice.toFixed(8),
    quantity: executedQty.toFixed(8),
    grossValueUsd: (mode === "live" ? executedUsd - feeUsd : baseBuyUsd).toFixed(2),
    feesUsd: feeUsd.toFixed(2),
    slippageUsd: (mode === "simulation" ? (executedUsd - baseBuyUsd - feeUsd) : 0).toFixed(2),
    netValueUsd: executedUsd.toFixed(2),
    triggerReason: `Plus cycle base buy, dip ${dipFromLastBuy.toFixed(1)}% from main avg`,
    humanReason: formatOrderReason("base_buy"),
    // HOTFIX: Campos de trazabilidad
    executionStatus: mode === "live" ? "filled" : "simulated",
    intendedQuantity: quantity.toFixed(8),
    intendedUsd: baseBuyUsd.toFixed(2),
    executedQuantity: executedQty.toFixed(8),
    executedUsd: executedUsd.toFixed(2),
    avgFillPrice: avgFillPrice.toFixed(8),
    exchangeOrderId,
    sizeAdjusted: wasAdjusted,
    originalIntendedUsd: wasAdjusted ? baseBuyUsd.toFixed(2) : undefined,
    adjustedUsd: wasAdjusted ? executedUsd.toFixed(2) : undefined,
    // Fee tracking (solo LIVE)
    ...(mode === "live" ? {
      grossBaseQty: grossBaseQty.toFixed(8),
      netBaseQty: netBaseQty.toFixed(8),
      feeAsset: feeAsset || null,
      feeAmount: feeAmount?.toFixed(8) || null,
      feeSource: feeSource || null,
    } : {}),
  });

  if (mode === "simulation") {
    const wallet = await repo.getSimulationWallet();
    await repo.updateSimulationWallet({
      availableBalanceUsd: (parseFloat(String(wallet.availableBalanceUsd)) - executedUsd).toFixed(2),
      usedBalanceUsd: (parseFloat(String(wallet.usedBalanceUsd)) + executedUsd).toFixed(2),
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
    message: `Plus cycle activated: ${executedQty.toFixed(6)} @ ${avgFillPrice.toFixed(2)}, dip=${dipFromLastBuy.toFixed(1)}% from main`,
    payloadJson: { parentCycleId: mainCycle.id, dipFromLastBuy, plusCapital, tpPct, executedQty, executedUsd, avgFillPrice },
  }, {
    eventType: "plus_cycle_activated", pair, mode,
    price: avgFillPrice, quantity: executedQty, entryDipPct: dipFromLastBuy,
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
      // Transition to tp_armed → trailing (same as main cycle flow)
      const isBtc = pair === "BTC/USD";
      const trailingPct = isBtc ? plusCfg.trailingPctBtc : plusCfg.trailingPctEth;
      await repo.updateCycle(plusCycle.id, {
        status: "tp_armed",
        tpArmedAt: new Date(),
        highestPriceAfterTp: currentPrice.toFixed(8),
        trailingPct: trailingPct.toFixed(2),
      });
      await createHumanEvent({
        cycleId: plusCycle.id, pair, mode,
        eventType: "tp_armed",
        severity: "info",
        message: `Plus TP alcanzado +${unrealizedPnlPct.toFixed(2)}%: trailing ${trailingPct}% activado desde $${currentPrice.toFixed(2)}`,
      }, { eventType: "tp_armed", pair, mode, price: currentPrice, pnlPct: unrealizedPnlPct, trailingPct });
      await telegram.alertTpArmed(plusCycle, 100); // 100% = no partial sell on plus
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

  // ─── HOTFIX: Flujo seguro LIVE vs SIMULATION ─────────────────────

  // Calcular intención
  const capitalReserved = parseFloat(String(plusCycle.capitalReservedUsd || "0"));
  const entrySteps = plusCfg.entryDipSteps || [2.0, 3.5, 5.0];
  const buyUsd = capitalReserved / (entrySteps.length || 1);
  const quantity = buyUsd / currentPrice;

  let executedQty = quantity;
  let executedUsd = buyUsd;
  let avgFillPrice = currentPrice;
  let feeUsd = 0;
  let wasAdjusted = false;
  let originalQty: number | undefined;
  let exchangeOrderId: string | undefined;

  // Fee tracking variables (default to executedQty for simulation)
  let netBaseQty = quantity;
  let grossBaseQty = quantity;
  let feeAsset: string | null | undefined = null;
  let feeAmount: number | null | undefined = null;
  let feeSource: "exchange_api" | "inferred_from_default_pct" | "manual" | "legacy" | null | undefined = null;

  if (mode === "live") {
    // ─── MODO LIVE: Ejecutar PRIMERO, actualizar ciclo DESPUÉS ─────────
    const execResult = await executeRealBuyWithGuard(
      pair,
      quantity,
      currentPrice,
      plusCycle.id,
      "safety",
      mode,
      assetConfig,
      buyCount + 1
    );

    if (!execResult.success) {
      // NO tocar ciclo si la compra falló
      console.error(`${TAG}[LIVE][PLUS_SAFETY] FAILED for cycle #${plusCycle.id}: ${execResult.rejectionReason}`);
      await createHumanEvent({
        cycleId: plusCycle.id,
        pair,
        mode,
        eventType: "plus_safety_buy_failed",
        severity: "error",
        message: `Plus safety buy #${buyCount + 1} bloqueado/fallido: ${execResult.rejectionReason}`,
        payloadJson: { intendedQty: quantity, currentPrice, reason: execResult.rejectionReason },
      }, { eventType: "plus_safety_buy_failed", pair, mode, cycleId: plusCycle.id, price: currentPrice, quantity });
      return; // Abortar - NO tocar ciclo
    }

    // Fill confirmado - usar valores EJECUTADOS
    executedQty = execResult.executedQty;
    executedUsd = execResult.executedUsd;
    avgFillPrice = execResult.avgPrice;
    feeUsd = execResult.feeUsd;
    wasAdjusted = execResult.wasAdjusted;
    originalQty = execResult.originalQty;
    exchangeOrderId = execResult.orderId;

    // Fee tracking: usar netBaseQty si está disponible (fee en base asset)
    netBaseQty = execResult.netBaseQty ?? executedQty;
    grossBaseQty = execResult.grossBaseQty ?? executedQty;
    feeAsset = execResult.feeAsset ?? null;
    feeAmount = execResult.feeAmount ?? null;
    feeSource = execResult.feeSource ?? null;

    console.log(`${TAG}[LIVE][PLUS_SAFETY] FILL CONFIRMED for cycle #${plusCycle.id}: qty=${executedQty.toFixed(8)} avg=${avgFillPrice.toFixed(2)} netQty=${netBaseQty.toFixed(8)} feeAsset=${feeAsset || 'N/A'}`);
  } else {
    // ─── MODO SIMULATION: Calcular fees simulados ────────────────
    feeUsd = buyUsd * (resolveSimulationFeePct(config) / 100);
    const slippageUsd = buyUsd * (parseFloat(String(config.simulationSlippagePct)) / 100);
    executedUsd = buyUsd + feeUsd + slippageUsd;
  }

  // Recalcular promedios con valores EJECUTADOS
  const prevQty = parseFloat(String(plusCycle.totalQuantity));
  const prevCost = parseFloat(String(plusCycle.capitalUsedUsd));
  // HOTFIX: Usar netBaseQty (cantidad neta post-fee en base asset) para el nuevo total
  const newTotalQty = prevQty + (mode === "live" ? netBaseQty : executedQty);
  const newTotalCost = prevCost + executedUsd;
  const newAvgPrice = newTotalCost / newTotalQty;
  const newBuyCount = buyCount + 1;

  // Next level
  const nextIdx = newBuyCount;
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

  // Actualizar ciclo SOLO después de fill confirmado
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

  // Crear orden con valores EJECUTADOS
  const plusSafetyOrder = await repo.createOrder({
    cycleId: plusCycle.id,
    pair,
    mode,
    orderType: "safety_buy",
    buyIndex: newBuyCount,
    side: "buy",
    price: avgFillPrice.toFixed(8),
    quantity: executedQty.toFixed(8),
    grossValueUsd: (mode === "live" ? executedUsd - feeUsd : buyUsd).toFixed(2),
    feesUsd: feeUsd.toFixed(2),
    slippageUsd: (mode === "simulation" ? (executedUsd - buyUsd - feeUsd) : 0).toFixed(2),
    netValueUsd: executedUsd.toFixed(2),
    triggerReason: `Plus safety buy #${newBuyCount}`,
    humanReason: formatOrderReason("safety_buy"),
    // HOTFIX: Campos de trazabilidad
    executionStatus: mode === "live" ? "filled" : "simulated",
    intendedQuantity: quantity.toFixed(8),
    intendedUsd: buyUsd.toFixed(2),
    executedQuantity: executedQty.toFixed(8),
    executedUsd: executedUsd.toFixed(2),
    avgFillPrice: avgFillPrice.toFixed(8),
    exchangeOrderId,
    sizeAdjusted: wasAdjusted,
    originalIntendedUsd: wasAdjusted ? buyUsd.toFixed(2) : undefined,
    adjustedUsd: wasAdjusted ? executedUsd.toFixed(2) : undefined,
    // Fee tracking (solo LIVE)
    ...(mode === "live" ? {
      grossBaseQty: grossBaseQty.toFixed(8),
      netBaseQty: netBaseQty.toFixed(8),
      feeAsset: feeAsset || null,
      feeAmount: feeAmount?.toFixed(8) || null,
      feeSource: feeSource || null,
    } : {}),
  });

  if (mode === "simulation") {
    const wallet = await repo.getSimulationWallet();
    await repo.updateSimulationWallet({
      availableBalanceUsd: (parseFloat(String(wallet.availableBalanceUsd)) - executedUsd).toFixed(2),
      usedBalanceUsd: (parseFloat(String(wallet.usedBalanceUsd)) + executedUsd).toFixed(2),
      totalOrdersSimulated: wallet.totalOrdersSimulated + 1,
    });
  }

  await createHumanEvent({
    cycleId: plusCycle.id, pair, mode,
    eventType: "plus_safety_buy_executed",
    severity: "info",
    message: `Plus safety buy #${newBuyCount}: ${executedQty.toFixed(6)} @ ${avgFillPrice.toFixed(2)}, avg=${newAvgPrice.toFixed(2)}`,
  }, {
    eventType: "plus_safety_buy_executed", pair, mode,
    price: avgFillPrice, quantity: executedQty, avgEntry: newAvgPrice,
    capitalUsed: newTotalCost, buyCount: newBuyCount,
  });

  const updatedPlus = await repo.getCycleById(plusCycle.id);
  if (updatedPlus) {
    await telegram.alertBuyExecuted(updatedPlus, plusSafetyOrder, "safety_buy", parseFloat(String(plusCycle.avgEntryPrice)));
  }
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
    fees = sellValueUsd * (resolveSimulationFeePct(config) / 100);
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
    await executeRealSell(plusCycle, "final_sell", totalQty, true);
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

  const updatedPlusClosed = await repo.getCycleById(plusCycle.id);
  if (updatedPlusClosed) {
    if (reason === "trailing_exit") {
      await telegram.alertTrailingExit(updatedPlusClosed);
    } else if (reason === "breakeven_exit") {
      await telegram.alertBreakevenExit(updatedPlusClosed);
    } else if (reason === "tp_reached" || reason === "main_cycle_closed") {
      // tp_reached won't fire here anymore (goes through tp_armed first), but kept as safety
      await telegram.alertTrailingExit(updatedPlusClosed);
    }
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

  // Limpiar todos los estados de trailing buy al cambiar de modo
  for (const pair of INSTITUTIONAL_DCA_ALLOWED_PAIRS) {
    if (TrailingBuyManager.isArmed(pair)) {
      TrailingBuyManager.disarm(pair);
    }
    tbState.resetTrailingBuyTelegramState(pair, oldMode, "mode_transition");
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
  } else if (!schedulerTimeout) {
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
  // Si ladder ATRP está activo, no usar safety orders legacy para evitar doble ejecución
  let nextLevelPct: number | null = null;
  let nextBuyPrice: number | null = null;
  let skippedSafetyLevels = 0;
  let skippedLevelsDetail: { level: number; dipPct: number; triggerPrice: number }[] | null = null;

  if (!assetConfig.ladderAtrpEnabled) {
    const safetyOrders = parseSafetyOrders(assetConfig.safetyOrdersJson);
    const effectiveSafety = calculateEffectiveSafetyLevel(
      safetyOrders,
      avgEntry,
      currentPrice,
      buyCount
    );

    nextLevelPct = effectiveSafety.nextLevelPct;
    nextBuyPrice = effectiveSafety.nextBuyPrice;
    skippedSafetyLevels = effectiveSafety.skippedLevels;
    skippedLevelsDetail = effectiveSafety.skippedLevelsDetail;
  } else {
    console.log(`${TAG}[RECALCULATE] ${pair}: ladder ATRP enabled, skipping safety orders legacy calculation`);
  }

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

  // ── 4. Dynamic trailing — trailingMarginPct is the single source of truth (UI slider)
  let trailingPct = parseFloat(String(assetConfig.trailingMarginPct));
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
    ? ` (${skippedSafetyLevels} niveles de seguridad ya superados: ${skippedLevelsDetail?.map(s => `-${s.dipPct}%`).join(', ') || 'N/A'})`
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
  // Si ladder ATRP está activo, no usar safety orders legacy para evitar doble ejecución
  let nextLevelPct: number | null = null;
  let nextBuyPrice: number | null = null;
  let skippedSafetyLevels = 0;
  let skippedLevelsDetail: { level: number; dipPct: number; triggerPrice: number }[] | null = null;

  if (!assetConfig.ladderAtrpEnabled) {
    const safetyOrders = parseSafetyOrders(assetConfig.safetyOrdersJson);
    const effectiveSafety = calculateEffectiveSafetyLevel(
      safetyOrders,
      newAvgEntry,
      currentPrice,
      buyCount
    );

    nextLevelPct = effectiveSafety.nextLevelPct;
    nextBuyPrice = effectiveSafety.nextBuyPrice;
    skippedSafetyLevels = effectiveSafety.skippedLevels;
    skippedLevelsDetail = effectiveSafety.skippedLevelsDetail;
  } else {
    console.log(`${TAG}[BUY_EXECUTED] ${pair}: ladder ATRP enabled, skipping safety orders legacy calculation`);
  }

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

  // Dynamic trailing — trailingMarginPct is the single source of truth (UI slider)
  let trailingPct = parseFloat(String(assetConfig.trailingMarginPct));
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
    const lastClosed = await repo.getLastClosedRecoveryCycle(mainCycle.id);
    if (lastClosed?.closedAt) {
      const sinceLastRecoveryMs = Date.now() - new Date(lastClosed.closedAt).getTime();
      const betweenCooldownMs = rcfg.cooldownMinutesBetweenRecovery * 60 * 1000;
      if (sinceLastRecoveryMs < betweenCooldownMs) {
        const remaining = Math.ceil((betweenCooldownMs - sinceLastRecoveryMs) / 60000);
        blockReasons.push(`cooldown_between_recovery: ${remaining}min remaining`);
      }
    }
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

  // Calculate first buy intention
  const entrySteps = rcfg.recoveryEntryDipSteps;
  const buyUsd = recoveryCapital / (entrySteps.length || 1);
  const quantity = buyUsd / currentPrice;

  // ─── HOTFIX: Flujo seguro LIVE vs SIMULATION ─────────────────────

  let executedQty = quantity;
  let executedUsd = buyUsd;
  let avgFillPrice = currentPrice;
  let feeUsd = 0;
  let wasAdjusted = false;
  let originalQty: number | undefined;
  let exchangeOrderId: string | undefined;

  // Fee tracking variables (default to executedQty for simulation)
  let netBaseQty = quantity;
  let grossBaseQty = quantity;
  let feeAsset: string | null | undefined = null;
  let feeAmount: number | null | undefined = null;
  let feeSource: "exchange_api" | "inferred_from_default_pct" | "manual" | "legacy" | null | undefined = null;

  if (mode === "live") {
    // ─── MODO LIVE: Ejecutar PRIMERO, crear ciclo DESPUÉS ─────────
    const execResult = await executeRealBuyWithGuard(
      pair,
      quantity,
      currentPrice,
      0, // cycleId aún no existe
      "recovery",
      mode,
      assetConfig,
      1
    );

    if (!execResult.success) {
      // NO crear ciclo si la compra falló
      console.error(`${TAG}[LIVE][RECOVERY] FAILED: ${execResult.rejectionReason}`);
      await createHumanEvent({
        cycleId: undefined,
        pair,
        mode,
        eventType: "recovery_buy_failed",
        severity: "error",
        message: `Recovery buy bloqueado/fallido: ${execResult.rejectionReason}`,
        payloadJson: { intendedQty: quantity, intendedUsd: buyUsd, currentPrice, reason: execResult.rejectionReason, parentCycleId: mainCycle.id },
      }, { eventType: "recovery_buy_failed", pair, mode, price: currentPrice, quantity, parentCycleId: mainCycle.id });
      return; // Abortar - NO crear ciclo
    }

    // Fill confirmado - usar valores EJECUTADOS
    executedQty = execResult.executedQty;
    executedUsd = execResult.executedUsd;
    avgFillPrice = execResult.avgPrice;
    feeUsd = execResult.feeUsd;
    wasAdjusted = execResult.wasAdjusted;
    originalQty = execResult.originalQty;
    exchangeOrderId = execResult.orderId;

    // Fee tracking: usar netBaseQty si está disponible (fee en base asset)
    netBaseQty = execResult.netBaseQty ?? executedQty;
    grossBaseQty = execResult.grossBaseQty ?? executedQty;
    feeAsset = execResult.feeAsset ?? null;
    feeAmount = execResult.feeAmount ?? null;
    feeSource = execResult.feeSource ?? null;

    console.log(`${TAG}[LIVE][RECOVERY] FILL CONFIRMED: qty=${executedQty.toFixed(8)} avg=${avgFillPrice.toFixed(2)} netQty=${netBaseQty.toFixed(8)} feeAsset=${feeAsset || 'N/A'}`);
  } else {
    // ─── MODO SIMULATION: Calcular fees simulados ────────────────
    feeUsd = buyUsd * (resolveSimulationFeePct(config) / 100);
    const slippageUsd = buyUsd * (parseFloat(String(config.simulationSlippagePct)) / 100);
    executedUsd = buyUsd + feeUsd + slippageUsd;
  }

  // TP
  const tpPct = isBtc ? rcfg.recoveryTpPctBtc : rcfg.recoveryTpPctEth;
  const tpPrice = avgFillPrice * (1 + tpPct / 100);

  // Next safety buy
  const nextDipPct = entrySteps.length > 1 ? entrySteps[1] : null;
  const nextBuyPrice = nextDipPct ? avgFillPrice * (1 - nextDipPct / 100) : null;

  // ─── Crear ciclo SOLO después de fill confirmado ─────────────────
  const recoveryCycle = await repo.createCycle({
    pair,
    strategy: "institutional_dca_v1_recovery",
    mode,
    status: "active",
    avgEntryPrice: avgFillPrice.toFixed(8),
    // HOTFIX: Usar netBaseQty (cantidad neta post-fee en base asset) para totalQuantity
    totalQuantity: (mode === "live" ? netBaseQty : executedQty).toFixed(8),
    capitalUsedUsd: executedUsd.toFixed(2),
    totalCostBasisUsd: executedUsd.toFixed(2),
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

  // Crear orden con valores EJECUTADOS
  await repo.createOrder({
    cycleId: recoveryCycle.id,
    pair, mode,
    orderType: "base_buy",
    buyIndex: 1,
    side: "buy",
    price: avgFillPrice.toFixed(8),
    quantity: executedQty.toFixed(8),
    grossValueUsd: (mode === "live" ? executedUsd - feeUsd : buyUsd).toFixed(2),
    feesUsd: feeUsd.toFixed(2),
    slippageUsd: (mode === "simulation" ? (executedUsd - buyUsd - feeUsd) : 0).toFixed(2),
    netValueUsd: executedUsd.toFixed(2),
    triggerReason: `Recovery base buy: main DD=${mainDrawdown.toFixed(1)}%`,
    humanReason: formatOrderReason("base_buy"),
    // HOTFIX: Campos de trazabilidad
    executionStatus: mode === "live" ? "filled" : "simulated",
    intendedQuantity: quantity.toFixed(8),
    intendedUsd: buyUsd.toFixed(2),
    executedQuantity: executedQty.toFixed(8),
    executedUsd: executedUsd.toFixed(2),
    avgFillPrice: avgFillPrice.toFixed(8),
    exchangeOrderId,
    sizeAdjusted: wasAdjusted,
    originalIntendedUsd: wasAdjusted ? buyUsd.toFixed(2) : undefined,
    adjustedUsd: wasAdjusted ? executedUsd.toFixed(2) : undefined,
    // Fee tracking (solo LIVE)
    ...(mode === "live" ? {
      grossBaseQty: grossBaseQty.toFixed(8),
      netBaseQty: netBaseQty.toFixed(8),
      feeAsset: feeAsset || null,
      feeAmount: feeAmount?.toFixed(8) || null,
      feeSource: feeSource || null,
    } : {}),
  });

  if (mode === "simulation") {
    const wallet = await repo.getSimulationWallet();
    await repo.updateSimulationWallet({
      availableBalanceUsd: (parseFloat(String(wallet.availableBalanceUsd)) - executedUsd).toFixed(2),
      usedBalanceUsd: (parseFloat(String(wallet.usedBalanceUsd)) + executedUsd).toFixed(2),
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
    message: `Recovery cycle opened: ${executedQty.toFixed(6)} @ ${avgFillPrice.toFixed(2)}, main DD=${mainDrawdown.toFixed(1)}%, TP=${tpPct}%`,
    payloadJson: {
      parentCycleId: mainCycle.id, mainDrawdown, recoveryCapital,
      price: avgFillPrice, quantity: executedQty, tpPct, pairExposure, pairExposurePct,
    },
  }, {
    eventType: "recovery_cycle_started", pair, mode,
    price: avgFillPrice, quantity: executedQty, tpPct,
    drawdownPct: mainDrawdown, parentCycleId: mainCycle.id,
    capitalUsed: executedUsd,
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

  // ─── HOTFIX: Flujo seguro LIVE vs SIMULATION ─────────────────────

  // Calcular intención
  const capitalReserved = parseFloat(String(recoveryCycle.capitalReservedUsd || "0"));
  const entrySteps = rcfg.recoveryEntryDipSteps;
  const buyUsd = capitalReserved / (entrySteps.length || 1);
  const quantity = buyUsd / currentPrice;

  let executedQty = quantity;
  let executedUsd = buyUsd;
  let avgFillPrice = currentPrice;
  let feeUsd = 0;
  let wasAdjusted = false;
  let originalQty: number | undefined;
  let exchangeOrderId: string | undefined;

  // Fee tracking variables (default to executedQty for simulation)
  let netBaseQty = quantity;
  let grossBaseQty = quantity;
  let feeAsset: string | null | undefined = null;
  let feeAmount: number | null | undefined = null;
  let feeSource: "exchange_api" | "inferred_from_default_pct" | "manual" | "legacy" | null | undefined = null;

  if (mode === "live") {
    // ─── MODO LIVE: Ejecutar PRIMERO, actualizar ciclo DESPUÉS ─────────
    const execResult = await executeRealBuyWithGuard(
      pair,
      quantity,
      currentPrice,
      recoveryCycle.id,
      "safety",
      mode,
      undefined, // assetConfig no pasado a safety buys recovery
      buyCount + 1
    );

    if (!execResult.success) {
      // NO tocar ciclo si la compra falló
      console.error(`${TAG}[LIVE][RECOVERY_SAFETY] FAILED for cycle #${recoveryCycle.id}: ${execResult.rejectionReason}`);
      await createHumanEvent({
        cycleId: recoveryCycle.id,
        pair,
        mode,
        eventType: "recovery_safety_buy_failed",
        severity: "error",
        message: `Recovery safety buy #${buyCount + 1} bloqueado/fallido: ${execResult.rejectionReason}`,
        payloadJson: { intendedQty: quantity, currentPrice, reason: execResult.rejectionReason },
      }, { eventType: "recovery_safety_buy_failed", pair, mode, cycleId: recoveryCycle.id, price: currentPrice, quantity });
      return; // Abortar - NO tocar ciclo
    }

    // Fill confirmado - usar valores EJECUTADOS
    executedQty = execResult.executedQty;
    executedUsd = execResult.executedUsd;
    avgFillPrice = execResult.avgPrice;
    feeUsd = execResult.feeUsd;
    wasAdjusted = execResult.wasAdjusted;
    originalQty = execResult.originalQty;
    exchangeOrderId = execResult.orderId;

    // Fee tracking: usar netBaseQty si está disponible (fee en base asset)
    netBaseQty = execResult.netBaseQty ?? executedQty;
    grossBaseQty = execResult.grossBaseQty ?? executedQty;
    feeAsset = execResult.feeAsset ?? null;
    feeAmount = execResult.feeAmount ?? null;
    feeSource = execResult.feeSource ?? null;

    console.log(`${TAG}[LIVE][RECOVERY_SAFETY] FILL CONFIRMED for cycle #${recoveryCycle.id}: qty=${executedQty.toFixed(8)} avg=${avgFillPrice.toFixed(2)} netQty=${netBaseQty.toFixed(8)} feeAsset=${feeAsset || 'N/A'}`);
  } else {
    // ─── MODO SIMULATION: Calcular fees simulados ────────────────
    feeUsd = buyUsd * (resolveSimulationFeePct(config) / 100);
    const slippageUsd = buyUsd * (parseFloat(String(config.simulationSlippagePct)) / 100);
    executedUsd = buyUsd + feeUsd + slippageUsd;
  }

  // Recalcular promedios con valores EJECUTADOS
  const prevQty = parseFloat(String(recoveryCycle.totalQuantity));
  const prevCost = parseFloat(String(recoveryCycle.capitalUsedUsd));
  // HOTFIX: Usar netBaseQty (cantidad neta post-fee en base asset) para el nuevo total
  const newTotalQty = prevQty + (mode === "live" ? netBaseQty : executedQty);
  const newTotalCost = prevCost + executedUsd;
  const newAvgPrice = newTotalCost / newTotalQty;
  const newBuyCount = buyCount + 1;

  const nextIndex = buyCount; // 0-indexed in entrySteps
  const nextDipPct = entrySteps[nextIndex] || null;
  const nextBuyPriceCalc = nextDipPct ? newAvgPrice * (1 - nextDipPct / 100) : null;

  // Recalculate TP
  const isBtc = pair === "BTC/USD";
  const tpPct = isBtc ? rcfg.recoveryTpPctBtc : rcfg.recoveryTpPctEth;
  const tpPrice = newAvgPrice * (1 + tpPct / 100);

  // Actualizar ciclo SOLO después de fill confirmado
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

  // Crear orden con valores EJECUTADOS
  await repo.createOrder({
    cycleId: recoveryCycle.id, pair, mode,
    orderType: "safety_buy",
    buyIndex: newBuyCount,
    side: "buy",
    price: avgFillPrice.toFixed(8),
    quantity: executedQty.toFixed(8),
    grossValueUsd: (mode === "live" ? executedUsd - feeUsd : buyUsd).toFixed(2),
    feesUsd: feeUsd.toFixed(2),
    slippageUsd: (mode === "simulation" ? (executedUsd - buyUsd - feeUsd) : 0).toFixed(2),
    netValueUsd: executedUsd.toFixed(2),
    triggerReason: `Recovery safety buy #${newBuyCount}`,
    humanReason: formatOrderReason("safety_buy"),
    // HOTFIX: Campos de trazabilidad
    executionStatus: mode === "live" ? "filled" : "simulated",
    intendedQuantity: quantity.toFixed(8),
    intendedUsd: buyUsd.toFixed(2),
    executedQuantity: executedQty.toFixed(8),
    executedUsd: executedUsd.toFixed(2),
    avgFillPrice: avgFillPrice.toFixed(8),
    exchangeOrderId,
    sizeAdjusted: wasAdjusted,
    originalIntendedUsd: wasAdjusted ? buyUsd.toFixed(2) : undefined,
    adjustedUsd: wasAdjusted ? executedUsd.toFixed(2) : undefined,
    // Fee tracking (solo LIVE)
    ...(mode === "live" ? {
      grossBaseQty: grossBaseQty.toFixed(8),
      netBaseQty: netBaseQty.toFixed(8),
      feeAsset: feeAsset || null,
      feeAmount: feeAmount?.toFixed(8) || null,
      feeSource: feeSource || null,
    } : {}),
  });

  if (mode === "simulation") {
    const wallet = await repo.getSimulationWallet();
    await repo.updateSimulationWallet({
      availableBalanceUsd: (parseFloat(String(wallet.availableBalanceUsd)) - executedUsd).toFixed(2),
      usedBalanceUsd: (parseFloat(String(wallet.usedBalanceUsd)) + executedUsd).toFixed(2),
      totalOrdersSimulated: wallet.totalOrdersSimulated + 1,
    });
  }

  await createHumanEvent({
    cycleId: recoveryCycle.id, pair, mode,
    eventType: "safety_buy_executed",
    severity: "info",
    message: `Recovery safety buy #${newBuyCount}: ${executedQty.toFixed(6)} @ ${avgFillPrice.toFixed(2)}, avg=${newAvgPrice.toFixed(2)}`,
  }, {
    eventType: "safety_buy_executed", pair, mode,
    price: avgFillPrice, quantity: executedQty, avgEntry: newAvgPrice,
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
    fees = sellValueUsd * (resolveSimulationFeePct(config) / 100);
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
      await executeRealSell(recoveryCycle, "final_sell", remainingQty, true);
    }
  }

  // Store net profit
  await repo.updateCycle(recoveryCycle.id, {
    status: "closed",
    closeReason,
    totalQuantity: "0",
    realizedPnlUsd: pnlUsd.toFixed(2),
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

  // Telegram alert for recovery cycle close (dedicated format)
  const updated = await repo.getCycleById(recoveryCycle.id);
  if (updated) {
    if (closeReason === "trailing_exit") {
      await telegram.alertTrailingExit(updated);
    } else if (closeReason === "breakeven_exit") {
      await telegram.alertBreakevenExit(updated);
    } else {
      // tp_reached, main_cycle_closed, main_recovered, max_duration_exceeded
      await telegram.alertImportedClosed(updated, pnlUsd, pnlPct, durationStr);
    }
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

  // ─── Lote 4: Check for blocking exit instruction ───
  const activeInstr = await exitRepo.getActiveExitInstruction(cycleId);
  if (activeInstr && activeInstr.status === "failed_requires_review") {
    throw new Error(
      `Ciclo #${cycleId} tiene una instrucción de salida en estado failed_requires_review (#${activeInstr.id}). ` +
      `Revisa o cancela la instrucción antes de cerrar manualmente.`
    );
  }

  const pair = cycle.pair;
  const mode = cycle.mode as IdcaMode;
  const config = await repo.getIdcaConfig();

  const totalQty = parseFloat(String(cycle.totalQuantity || "0"));
  if (totalQty <= 0) throw new Error("El ciclo no tiene cantidad disponible para vender");

  const currentPrice = await getCurrentPrice(pair);
  if (!currentPrice || currentPrice <= 0) throw new Error(`No se pudo obtener precio actual para ${pair}`);

  const sellValueUsd = totalQty * currentPrice;
  const capitalUsed = parseFloat(String(cycle.capitalUsedUsd || "0"));
  // Lote 4: totalCostBasisUsd = historical cost; fallback to capitalUsedUsd for legacy cycles
  const totalCostBasis = parseFloat(String((cycle as any).totalCostBasisUsd || "0")) || capitalUsed;

  let fees = 0, slippage = 0, netValue = sellValueUsd;
  if (mode === "simulation") {
    fees = sellValueUsd * (resolveSimulationFeePct(config) / 100);
    slippage = sellValueUsd * (parseFloat(String(config.simulationSlippagePct)) / 100);
    netValue = sellValueUsd - fees - slippage;
  }

  const prevRealized = parseFloat(String(cycle.realizedPnlUsd || "0"));
  const sellRatio = capitalUsed > 0 ? 1.0 : 0; // full close = sell 100%
  const costBasisSold = capitalUsed; // entire remaining cost
  const realizedPnlIncrement = netValue - costBasisSold;
  const realizedPnlUsd = prevRealized + realizedPnlIncrement;
  // For pnlPct: use totalCostBasisUsd as denominator (works even when capitalUsedUsd=0)
  const realizedPnlPct = totalCostBasis > 0 ? (realizedPnlUsd / totalCostBasis) * 100 : 0;

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
    await executeRealSell(cycle, "manual_sell", totalQty, true);
  }

  // Lote 4: zero capitalUsedUsd on full close; preserve totalCostBasisUsd as historical
  const prevRealizedCostBasis = parseFloat(String((cycle as any).realizedCostBasisUsd || "0"));
  await repo.updateCycle(cycle.id, {
    status: "closed",
    closeReason: "manual_close",
    totalQuantity: "0",
    capitalUsedUsd: "0",
    realizedCostBasisUsd: (prevRealizedCostBasis + costBasisSold).toFixed(2),
    realizedPnlUsd: realizedPnlUsd.toFixed(2),
    unrealizedPnlUsd: "0",
    unrealizedPnlPct: "0",
    currentPrice: currentPrice.toFixed(8),
    closedAt,
  } as any);

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

// ─── VWAP Anchor Helper Functions ───────────────────────────────────

export function resetVwapAnchor(pair: string): { ok: true; pair: string } {
  vwapAnchorMemory.delete(pair);
  repo.deleteVwapAnchor(pair).catch(e => console.warn(`${TAG}[VWAP_ANCHOR] DB delete failed for ${pair}: ${e.message}`));
  // Limpiar cache de MarketContextService para que el próximo acceso recalcule con ancla vacía
  import("./IdcaMarketContextService").then(({ idcaMarketContextService }) => {
    idcaMarketContextService.clearCache(pair);
  }).catch(() => {});
  // Evento auditado de reset manual
  repo.createEvent({
    eventType: "idca_anchor_manual_reset",
    pair,
    mode: "system",
    message: `Ancla IDCA reseteada manualmente para ${pair}. Solo afecta futuras evaluaciones globales. No modifica ciclos activos.`,
    severity: "info",
    payloadJson: { pair, resetAt: new Date().toISOString() },
  }).catch(() => {});
  console.log(`${TAG}[VWAP_ANCHOR] Reset anchor for ${pair} (memory + DB + MCS cache + event)`);
  return { ok: true, pair };
}

interface VwapAnchorStatusEntry {
  pair: string;
  anchorPrice: number;
  anchorTimestamp: string;
  setAt: string;
  ageHours: number;
  drawdownPct: number;
  drawupPct: number;
  previous: {
    anchorPrice: number;
    anchorTimestamp: string;
    setAt: string;
    replacedAt: string;
  } | null;
}

export function getVwapAnchorStatus(): VwapAnchorStatusEntry[] {
  const now = Date.now();
  const result: VwapAnchorStatusEntry[] = [];

  for (const [pair, state] of vwapAnchorMemory.entries()) {
    const ageHours = (now - state.setAt) / (1000 * 60 * 60);
    result.push({
      pair,
      anchorPrice: state.anchorPrice,
      anchorTimestamp: new Date(state.anchorTimestamp).toISOString(),
      setAt: new Date(state.setAt).toISOString(),
      ageHours: Math.round(ageHours * 10) / 10,
      drawdownPct: state.drawdownPct,
      drawupPct: state.drawdownPct < 0 ? Math.abs(state.drawdownPct) : 0,
      previous: state.previous
        ? {
            anchorPrice: state.previous.anchorPrice,
            anchorTimestamp: new Date(state.previous.anchorTimestamp).toISOString(),
            setAt: new Date(state.previous.setAt).toISOString(),
            replacedAt: new Date(state.previous.replacedAt).toISOString(),
          }
        : null,
    });
  }

  return result;
}
