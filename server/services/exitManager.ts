/**
 * ExitManager - Gestiona toda la lógica de salida de posiciones:
 * - Stop-Loss / Take-Profit (legacy)
 * - SMART_GUARD: Break-even, Trailing Stop, Scale-out, Fixed TP
 * - Time-Stop (soft/hard)
 * - Fee-gating (adaptive exit engine)
 * - Progressive Break-even
 * 
 * Delegado desde TradingEngine via IExitManagerHost.
 */

import { botLogger } from "./botLogger";
import { storage } from "../storage";
import { log } from "../utils/logger";
import { environment } from "./environment";
import { toConfidencePct } from "../utils/confidence";
import { ExchangeFactory } from "./exchanges/ExchangeFactory";
import { errorAlertService, ErrorAlertService } from "./ErrorAlertService";
import { checkSmartTimeStop, type MarketRegime, type TimeStopCheckResult } from "./TimeStopService";
import type { IExchangeService } from "./exchanges/IExchangeService";
import type { TelegramService } from "./telegram";

// Re-export types needed by both ExitManager and TradingEngine
export interface ConfigSnapshot {
  stopLossPercent: number;
  takeProfitPercent: number;
  trailingStopEnabled: boolean;
  trailingStopPercent: number;
  positionMode: string;
  sgMinEntryUsd?: number;
  sgAllowUnderMin?: boolean;
  sgBeAtPct?: number;
  sgFeeCushionPct?: number;
  sgFeeCushionAuto?: boolean;
  sgTrailStartPct?: number;
  sgTrailDistancePct?: number;
  sgTrailStepPct?: number;
  sgTpFixedEnabled?: boolean;
  sgTpFixedPct?: number;
  sgScaleOutEnabled?: boolean;
  sgScaleOutPct?: number;
  sgMinPartUsd?: number;
  sgScaleOutThreshold?: number;
}

export interface OpenPosition {
  lotId: string;
  pair: string;
  amount: number;
  entryPrice: number;
  entryFee: number;
  highestPrice: number;
  openedAt: number;
  entryStrategyId: string;
  entrySignalTf: string;
  signalConfidence?: number;
  signalReason?: string;
  aiSampleId?: number;
  entryMode?: string;
  configSnapshot?: ConfigSnapshot;
  sgBreakEvenActivated?: boolean;
  sgCurrentStopPrice?: number;
  sgTrailingActivated?: boolean;
  sgScaleOutDone?: boolean;
  timeStopDisabled?: boolean;
  timeStopExpiredAt?: number;
  beProgressiveLevel?: number;
  // Allow arbitrary fields for forward compat
  clientOrderId?: string;
  exchange?: string;
}

export type ExitReason = 
  | "STOP_LOSS"
  | "EMERGENCY_SL"
  | "DAILY_LOSS_LIMIT"
  | "TIME_STOP_HARD"
  | "TAKE_PROFIT"
  | "TRAILING_STOP"
  | "BREAK_EVEN"
  | "TIME_STOP_SOFT"
  | "SCALE_OUT";

export interface FeeGatingResult {
  allowed: boolean;
  grossPnlPct: number;
  minCloseNetPct: number;
  estimatedNetPct: number;
  reason: string;
}

// ====================================================================
// IExitManagerHost: Interfaz que TradingEngine implementa para ExitManager
// ====================================================================
export interface IExitManagerHost {
  // Position state
  getOpenPositions(): Map<string, OpenPosition>;
  setPosition(lotId: string, position: OpenPosition): void;
  deletePosition(lotId: string): void;

  // DB persistence
  savePositionToDB(pair: string, position: OpenPosition): Promise<void>;
  deletePositionFromDBByLotId(lotId: string): Promise<void>;
  updatePositionHighestPriceByLotId(lotId: string, price: number): Promise<void>;

  // Exchange
  getTradingExchange(): IExchangeService;
  getDataExchange(): IExchangeService;
  getTradingExchangeType(): string;
  getTradingFees(): { takerFeePct: number; makerFeePct: number };
  getOrderMin(pair: string): number;
  getAssetBalance(pair: string, balances: any): number;
  formatKrakenPair(pair: string): string;
  getPositionsByPair(pair: string): OpenPosition[];

  // Trade execution
  executeTrade(
    pair: string,
    type: "buy" | "sell",
    volume: string,
    price: number,
    reason: string,
    adjustmentInfo?: any,
    strategyMeta?: any,
    executionMeta?: any,
    sellContext?: { entryPrice: number; entryFee?: number; sellAmount?: number; positionAmount?: number; aiSampleId?: number; openedAt?: number | Date | null }
  ): Promise<boolean>;

  // Cooldowns
  setStopLossCooldown(pair: string): void;
  setPairCooldown(pair: string): void;
  setLastTradeTime(pair: string, time: number): void;
  clearStopLossCooldown(pair: string): void;
  clearExposureAlert(pair: string): void;
  setCurrentUsdBalance(balance: number): void;

  // Services
  getTelegramService(): TelegramService;

  // Market regime (for smart TimeStop TTL calculation)
  getMarketRegime(pair: string): Promise<MarketRegime>;

  // ATR% for dynamic trailing distance (cached from last analysis cycle)
  getATRPercent(pair: string): number;

  // Dry run mode flag — used by ExitManager to prefix alerts with [SIM]
  isDryRunMode(): boolean;
}

// ====================================================================
// Constants used by exit logic
// ====================================================================
const DUST_THRESHOLD_USD = 5;
const POST_STOPLOSS_COOLDOWN_MS = 30 * 60 * 1000;

// Dynamic fee helper
function getTakerFeePct(): number {
  try {
    const fees = ExchangeFactory.getTradingExchangeFees();
    return fees.takerFeePct;
  } catch {
    return 0.40;
  }
}

// ====================================================================
// ExitManager
// ====================================================================
export class ExitManager {
  private host: IExitManagerHost;

  // Alert throttles (owned by ExitManager, not host)
  private sgAlertThrottle: Map<string, number> = new Map();
  private readonly SG_TRAIL_UPDATE_THROTTLE_MS = 5 * 60 * 1000;
  private timeStopNotified: Map<string, number> = new Map();
  private readonly TIME_STOP_NOTIFY_THROTTLE_MS = 60 * 60 * 1000;

  // FASE 2 — Dedup de EXIT_EVAL: evita persistir el mismo log cada 5s cuando nada material cambia.
  // Se emite si hay cambio de estado o ha pasado el heartbeat mínimo.
  private lastExitEvalEmitted: Map<string, { hash: string; ts: number }> = new Map();
  private readonly EXIT_EVAL_HEARTBEAT_MS = 60 * 1000; // heartbeat cada 60s sin cambio

  // === FASE 0 HOTFIX: Exit Lock System ===
  // Prevents multiple simultaneous SELL attempts on the same position
  private exitLocks: Map<string, number> = new Map(); // lotId → timestamp
  private readonly EXIT_LOCK_TTL_MS = 120_000; // 2 min TTL to auto-release stale locks
  // Circuit breaker: track sell attempts per lotId in short window
  private sellAttempts: Map<string, number[]> = new Map(); // lotId → [timestamps]
  private readonly CIRCUIT_BREAKER_WINDOW_MS = 60_000; // 1 minute window
  private readonly CIRCUIT_BREAKER_MAX_ATTEMPTS = 1; // Max 1 sell attempt per window
  // FASE 6: Throttle Telegram para alertas de circuit breaker (evitar spam por tick)
  private cbTelegramThrottle: Map<string, number> = new Map(); // lotId → lastSentMs
  private readonly CB_TELEGRAM_COOLDOWN_MS = 15 * 60 * 1000; // 15 min entre alertas por lote

  private throttleLoaded = false;

  constructor(host: IExitManagerHost) {
    this.host = host;
    // Load persisted throttle state asynchronously (non-blocking)
    this.loadThrottleState().catch(e => log(`[EXIT_MGR] Failed to load throttle state: ${e?.message}`, "trading"));
  }

  private async loadThrottleState(): Promise<void> {
    try {
      const sgMap = await storage.loadAlertThrottles("sg:");
      for (const [key, ts] of sgMap) {
        this.sgAlertThrottle.set(key.replace("sg:", ""), ts);
      }
      const tsMap = await storage.loadAlertThrottles("ts:");
      for (const [key, ts] of tsMap) {
        this.timeStopNotified.set(key.replace("ts:", ""), ts);
      }
      this.throttleLoaded = true;
      log(`[EXIT_MGR] Throttle state loaded: sg=${sgMap.size} ts=${tsMap.size}`, "trading");
    } catch (e: any) {
      log(`[EXIT_MGR] Throttle load error (using empty): ${e?.message}`, "trading");
      this.throttleLoaded = true;
    }
  }

  private persistThrottle(prefix: string, key: string, timestamp: number): void {
    storage.upsertAlertThrottle(`${prefix}${key}`, timestamp)
      .catch(e => log(`[EXIT_MGR] Throttle persist error: ${e?.message}`, "trading"));
  }

  // === FASE 0 HOTFIX: Exit Lock Methods ===

  /** Acquire exit lock for a position. Returns true if lock acquired, false if already locked. */
  acquireExitLock(lotId: string): boolean {
    const now = Date.now();
    const existingLock = this.exitLocks.get(lotId);
    if (existingLock && (now - existingLock) < this.EXIT_LOCK_TTL_MS) {
      log(`[EXIT_LOCK] BLOCKED: lotId=${lotId.substring(0, 12)} already locked (age=${((now - existingLock) / 1000).toFixed(0)}s)`, "trading");
      return false;
    }
    this.exitLocks.set(lotId, now);
    log(`[EXIT_LOCK] ACQUIRED: lotId=${lotId.substring(0, 12)}`, "trading");
    return true;
  }

  /** Release exit lock for a position. */
  releaseExitLock(lotId: string): void {
    this.exitLocks.delete(lotId);
    log(`[EXIT_LOCK] RELEASED: lotId=${lotId.substring(0, 12)}`, "trading");
  }

  /** Check if position is currently locked for exit. */
  isExitLocked(lotId: string): boolean {
    const lock = this.exitLocks.get(lotId);
    if (!lock) return false;
    if ((Date.now() - lock) >= this.EXIT_LOCK_TTL_MS) {
      this.exitLocks.delete(lotId); // Auto-release stale lock
      return false;
    }
    return true;
  }

  /** Circuit breaker: check if too many sell attempts on this position. */
  checkCircuitBreaker(lotId: string): boolean {
    const now = Date.now();
    const attempts = this.sellAttempts.get(lotId) || [];
    // Filter to recent window
    const recent = attempts.filter(t => (now - t) < this.CIRCUIT_BREAKER_WINDOW_MS);
    this.sellAttempts.set(lotId, recent);
    if (recent.length >= this.CIRCUIT_BREAKER_MAX_ATTEMPTS) {
      log(`[CIRCUIT_BREAKER] TRIPPED: lotId=${lotId.substring(0, 12)} attempts=${recent.length} in ${this.CIRCUIT_BREAKER_WINDOW_MS / 1000}s window`, "trading");
      return false; // Circuit breaker tripped
    }
    return true; // OK to proceed
  }

  /** Record a sell attempt for circuit breaker tracking. */
  recordSellAttempt(lotId: string): void {
    const attempts = this.sellAttempts.get(lotId) || [];
    attempts.push(Date.now());
    this.sellAttempts.set(lotId, attempts);
  }

  /** Safe sell: acquires lock, checks circuit breaker, executes sell, cleans up position. */
  async safeSell(
    pair: string,
    lotId: string,
    sellAmount: number,
    currentPrice: number,
    sellReason: string,
    position: OpenPosition,
    sellContext: any
  ): Promise<boolean> {
    // 1. Circuit breaker check
    if (!this.checkCircuitBreaker(lotId)) {
      await botLogger.error("CIRCUIT_BREAKER_BLOCKED", `Circuit breaker bloqueó SELL en ${pair}`, {
        pair, lotId, sellReason, sellAmount,
      });
      // FASE 6: Telegram solo una vez cada CB_TELEGRAM_COOLDOWN_MS por lotId
      const telegram = this.host.getTelegramService();
      if (telegram.isInitialized()) {
        const lastCbAlert = this.cbTelegramThrottle.get(lotId) || 0;
        if (Date.now() - lastCbAlert >= this.CB_TELEGRAM_COOLDOWN_MS) {
          this.cbTelegramThrottle.set(lotId, Date.now());
          await telegram.sendAlertWithSubtype(
            `🤖 <b>KRAKEN BOT</b> 🇪🇸\n━━━━━━━━━━━━━━━━━━━\n` +
            `🚨 <b>CIRCUIT BREAKER: SELL BLOQUEADO</b>\n\n` +
            `📦 Par: <code>${pair}</code> | Lot: <code>${lotId.substring(0, 12)}</code>\n` +
            `⚡ Trigger: <code>${sellReason}</code>\n` +
            `⚠️ <b>Múltiples intentos de venta detectados en ventana corta</b>\n` +
            `━━━━━━━━━━━━━━━━━━━`,
            "errors", "error_api"
          );
        } else {
          log(`[CB_TELEGRAM_SUPPRESSED] lotId=${lotId.substring(0,12)} pair=${pair} — cooldown activo (${Math.round((this.CB_TELEGRAM_COOLDOWN_MS - (Date.now() - lastCbAlert)) / 1000)}s restantes)`, "trading");
        }
      }
      return false;
    }

    // 2. Acquire exit lock
    if (!this.acquireExitLock(lotId)) {
      return false;
    }

    // 3. Record attempt
    this.recordSellAttempt(lotId);

    try {
      // 4. CRITICAL: Cap sell amount to ONLY the lot's registered amount
      // NEVER use realAssetBalance if it's higher than position.amount
      const cappedSellAmount = Math.min(sellAmount, position.amount);
      if (cappedSellAmount !== sellAmount) {
        log(`[SAFE_SELL] Capped sell amount from ${sellAmount.toFixed(8)} to ${cappedSellAmount.toFixed(8)} (lot limit) for ${pair} ${lotId.substring(0, 12)}`, "trading");
      }

      // 5. Execute trade (inject lotId so DRY_RUN SELL can match the exact buy record)
      const enrichedSellContext = sellContext ? { ...sellContext, lotId } : { entryPrice: 0, lotId };
      const success = await this.host.executeTrade(
        pair, "sell", cappedSellAmount.toFixed(8), currentPrice,
        sellReason, undefined, undefined, undefined, enrichedSellContext
      );

      if (success) {
        // 6. CRITICAL: Clean up position immediately to prevent re-evaluation
        this.host.deletePosition(lotId);
        await this.host.deletePositionFromDBByLotId(lotId);
        this.host.setLastTradeTime(pair, Date.now());
        log(`[SAFE_SELL] SUCCESS: ${pair} ${lotId.substring(0, 12)} sold ${cappedSellAmount.toFixed(8)} — position deleted`, "trading");
      }

      return success;
    } finally {
      // Always release lock (even on error)
      this.releaseExitLock(lotId);
    }
  }

  // === PUBLIC ENTRY POINT (called by TradingEngine.tradingCycle) ===

  async checkStopLossTakeProfit(
    pair: string,
    stopLossPercent: number,
    takeProfitPercent: number,
    trailingStopEnabled: boolean,
    trailingStopPercent: number,
    balances: any
  ) {
    const positions = this.host.getPositionsByPair(pair);
    if (positions.length === 0) return;

    try {
      const krakenPair = this.host.formatKrakenPair(pair);
      const ticker = await this.host.getDataExchange().getTicker(krakenPair);
      const currentPrice = Number((ticker as any)?.last ?? 0);

      if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
        log(`[PRICE_INVALID] ${pair}: precio=${currentPrice}, saltando SL/TP`, "trading");

        const alert = ErrorAlertService.createCustomAlert(
          'PRICE_INVALID',
          `Precio inválido detectado: ${currentPrice} para ${pair} en SL/TP`,
          'HIGH',
          'checkPositionsSLTP',
          'server/services/exitManager.ts',
          0,
          pair,
          { currentPrice, positions: positions.length }
        );
        await errorAlertService.sendCriticalError(alert);

        return;
      }

      for (const position of positions) {
        if (position.amount <= 0) continue;

        await this.checkSinglePositionSLTP(
          pair, position, currentPrice, stopLossPercent, takeProfitPercent,
          trailingStopEnabled, trailingStopPercent, balances
        );
      }
    } catch (error: any) {
      log(`Error verificando SL/TP para ${pair}: ${error.message}`, "trading");
    }
  }

  // === ADAPTIVE EXIT ENGINE HELPERS ===

  isRiskExit(reason: ExitReason): boolean {
    const riskExits: ExitReason[] = ["STOP_LOSS", "EMERGENCY_SL", "DAILY_LOSS_LIMIT", "TIME_STOP_HARD"];
    return riskExits.includes(reason);
  }

  async getAdaptiveExitConfig(): Promise<{
    enabled: boolean;
    takerFeePct: number;
    makerFeePct: number;
    profitBufferPct: number;
    timeStopHours: number;
    timeStopMode: "soft" | "hard";
  }> {
    const config = await storage.getBotConfig();
    const exchangeFees = this.host.getTradingFees();
    return {
      enabled: config?.adaptiveExitEnabled ?? false,
      takerFeePct: exchangeFees.takerFeePct,
      makerFeePct: exchangeFees.makerFeePct,
      profitBufferPct: parseFloat(config?.profitBufferPct?.toString() ?? "1.00"),
      timeStopHours: config?.timeStopHours ?? 36,
      timeStopMode: (config?.timeStopMode as "soft" | "hard") ?? "soft",
    };
  }

  calculateMinCloseNetPct(entryFeePct: number, exitFeePct: number, profitBufferPct: number): number {
    const roundTripFeePct = entryFeePct + exitFeePct;
    return roundTripFeePct + profitBufferPct;
  }

  checkFeeGating(
    grossPnlPct: number,
    exitReason: ExitReason,
    entryFeePct: number,
    exitFeePct: number,
    profitBufferPct: number
  ): FeeGatingResult {
    const minCloseNetPct = this.calculateMinCloseNetPct(entryFeePct, exitFeePct, profitBufferPct);
    const estimatedNetPct = grossPnlPct - minCloseNetPct;

    if (this.isRiskExit(exitReason)) {
      return {
        allowed: true,
        grossPnlPct,
        minCloseNetPct,
        estimatedNetPct,
        reason: `[RISK_OVERRIDE] reason=${exitReason} (siempre permitido)`,
      };
    }

    if (grossPnlPct >= minCloseNetPct) {
      return {
        allowed: true,
        grossPnlPct,
        minCloseNetPct,
        estimatedNetPct,
        reason: `[EXIT] reason=${exitReason} grossPnlPct=${grossPnlPct.toFixed(2)} minCloseNetPct=${minCloseNetPct.toFixed(2)} decision=ALLOW`,
      };
    }

    return {
      allowed: false,
      grossPnlPct,
      minCloseNetPct,
      estimatedNetPct,
      reason: `[EXIT_BLOCKED_FEES] reason=${exitReason} grossPnlPct=${grossPnlPct.toFixed(2)} minCloseNetPct=${minCloseNetPct.toFixed(2)} decision=BLOCK`,
    };
  }

  // === SMART TIME-STOP ===
  // Uses per-asset/market TTL with regime multipliers from time_stop_config table.
  // TTL_final = clamp(TTL_base[asset,market] * factorRegime, minTTL, maxTTL)

  async checkTimeStop(
    position: OpenPosition,
    currentPrice: number,
    exitConfig: {
      enabled: boolean;
      takerFeePct: number;
      profitBufferPct: number;
      timeStopHours: number;
      timeStopMode: "soft" | "hard";
    }
  ): Promise<{
    triggered: boolean;
    expired: boolean;
    shouldClose: boolean;
    reason: string;
    ageHours: number;
    closeOrderType?: "market" | "limit";
    limitFallbackSeconds?: number;
  }> {
    const { lotId, openedAt, pair, entryPrice, timeStopDisabled } = position;

    // Get current market regime for smart TTL calculation
    let regime: MarketRegime = "TRANSITION";
    try {
      regime = await this.host.getMarketRegime(pair);
    } catch (e: any) {
      log(`[TIME_STOP] Failed to get regime for ${pair}, using TRANSITION: ${e?.message}`, "trading");
    }

    // Use Smart TimeStop Service (per-asset TTL + regime multiplier + clamp + softMode)
    // FASE 4 — pasar P&L y fee round-trip para que el servicio pueda aplicar softMode real.
    const priceChangePctLocal = ((currentPrice - entryPrice) / entryPrice) * 100;
    const takerFeePctLocal = exitConfig.takerFeePct ?? getTakerFeePct();
    const roundTripFeePctLocal = takerFeePctLocal * 2;
    const tsResult: TimeStopCheckResult = await checkSmartTimeStop(
      pair,
      openedAt,
      regime,
      timeStopDisabled ?? false,
      "spot",
      priceChangePctLocal,
      roundTripFeePctLocal,
    );

    const { ageHours, ttlHours, expired, shouldClose, closeOrderType, limitFallbackSeconds, telegramAlertEnabled, logExpiryEvenIfDisabled, configSource } = tsResult;

    // Not expired yet
    if (!expired) {
      return {
        triggered: false,
        expired: false,
        shouldClose: false,
        reason: "",
        ageHours,
        closeOrderType,
        limitFallbackSeconds,
      };
    }

    // Expired but disabled by UI toggle
    if (expired && !shouldClose) {
      // Log event even when disabled
      if (logExpiryEvenIfDisabled) {
        await botLogger.info("TIME_STOP_EXPIRED_DISABLED", `TimeStop expirado pero DESACTIVADO para ${pair}`, {
          pair, lotId, ageHours, ttlHours, regime, configSource, timeStopDisabled,
        });
      }

      // Notify once about expiry (even disabled) for visibility
      const now = Date.now();
      const lastNotify = this.timeStopNotified.get(lotId) || 0;
      const shouldNotify = now - lastNotify > this.TIME_STOP_NOTIFY_THROTTLE_MS;

      if (shouldNotify && telegramAlertEnabled && !position.timeStopExpiredAt) {
        this.timeStopNotified.set(lotId, now);
        this.persistThrottle("ts:", lotId, now);
        position.timeStopExpiredAt = now;
        this.host.setPosition(lotId, position);
        await this.host.savePositionToDB(pair, position);

        if (this.host.getTelegramService().isInitialized()) {
          const priceChange = ((currentPrice - entryPrice) / entryPrice) * 100;
          const simPfx = this.host.isDryRunMode() ? "🧪 <b>[SIM]</b>\n" : "";
          await this.host.getTelegramService().sendAlertWithSubtype(`${simPfx}🤖 <b>KRAKEN BOT</b> 🇪🇸
━━━━━━━━━━━━━━━━━━━
⏰ <b>Time-Stop Expirado (DESACTIVADO)</b>

📦 <b>Detalles:</b>
   • Par: <code>${pair}</code>
   • Tiempo abierta: <code>${ageHours.toFixed(0)} horas</code>
   • TTL inteligente: <code>${ttlHours.toFixed(1)} horas</code>
   • Régimen: <code>${regime}</code>
   • Config: <code>${configSource}</code>

📊 <b>Estado:</b>
   • Ganancia actual: <code>${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(2)}%</code>

⚠️ <b>TimeStop DESACTIVADO — NO se ejecutará venta automática</b>
💡 Evento registrado. Puedes cerrar manualmente.
━━━━━━━━━━━━━━━━━━━`, "trades", "trade_timestop");
        }
      }

      return {
        triggered: true,
        expired: true,
        shouldClose: false,
        reason: tsResult.reason,
        ageHours,
        closeOrderType,
        limitFallbackSeconds,
      };
    }

    // Expired AND enabled → CLOSE POSITION (closeReason=TIMESTOP)
    const priceChange = ((currentPrice - entryPrice) / entryPrice) * 100;
    log(`[TIME_STOP_CLOSE] pair=${pair} lotId=${lotId} ageHours=${ageHours.toFixed(1)} ttl=${ttlHours.toFixed(1)}h regime=${regime} closeType=${closeOrderType} config=${configSource}`, "trading");

    // Mark expiry timestamp
    if (!position.timeStopExpiredAt) {
      const now = Date.now();
      this.timeStopNotified.set(lotId, now);
      this.persistThrottle("ts:", lotId, now);
      position.timeStopExpiredAt = now;
      this.host.setPosition(lotId, position);
      await this.host.savePositionToDB(pair, position);
    }

    // Send Telegram alert
    if (telegramAlertEnabled && this.host.getTelegramService().isInitialized()) {
      const simPfxClose = this.host.isDryRunMode() ? "🧪 <b>[SIM]</b>\n" : "";
      await this.host.getTelegramService().sendAlertWithSubtype(`${simPfxClose}🤖 <b>KRAKEN BOT</b> 🇪🇸
━━━━━━━━━━━━━━━━━━━
⏰ <b>Time-Stop EXPIRADO — Cierre Automático</b>

📦 <b>Detalles:</b>
   • Par: <code>${pair}</code>
   • Tiempo abierta: <code>${ageHours.toFixed(0)} horas</code>
   • TTL inteligente: <code>${ttlHours.toFixed(1)} horas</code>
   • Régimen: <code>${regime}</code>
   • Config: <code>${configSource}</code>

📊 <b>Estado:</b>
   • Ganancia actual: <code>${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(2)}%</code>

⚡ <b>ACCIÓN:</b> Cerrando posición [closeReason=TIMESTOP, tipo=${closeOrderType}]
━━━━━━━━━━━━━━━━━━━`, "trades", "trade_timestop");
    }

    return {
      triggered: true,
      expired: true,
      shouldClose: true,
      reason: tsResult.reason,
      ageHours,
      closeOrderType,
      limitFallbackSeconds,
    };
  }

  // === PROGRESSIVE BREAK-EVEN ===

  calculateProgressiveBEStop(
    position: OpenPosition,
    currentPrice: number,
    grossPnlPct: number,
    roundTripFeePct: number,
    profitBufferPct: number
  ): { newStopPrice: number | null; newLevel: number; reason: string } {
    const { entryPrice, beProgressiveLevel = 0 } = position;
    let newLevel = beProgressiveLevel;
    let newStopPrice: number | null = null;
    let reason = "";

    if (grossPnlPct >= 5.0 && beProgressiveLevel < 3) {
      newLevel = 3;
      const stopPct = roundTripFeePct + profitBufferPct;
      newStopPrice = entryPrice * (1 + stopPct / 100);
      reason = `BE Nivel 3: +5.0% alcanzado, stop en +${stopPct.toFixed(2)}%`;
    } else if (grossPnlPct >= 3.0 && beProgressiveLevel < 2) {
      newLevel = 2;
      const stopPct = roundTripFeePct + (profitBufferPct * 0.5);
      newStopPrice = entryPrice * (1 + stopPct / 100);
      reason = `BE Nivel 2: +3.0% alcanzado, stop en +${stopPct.toFixed(2)}%`;
    } else if (grossPnlPct >= 1.5 && beProgressiveLevel < 1) {
      newLevel = 1;
      const stopPct = roundTripFeePct;
      newStopPrice = entryPrice * (1 + stopPct / 100);
      reason = `BE Nivel 1: +1.5% alcanzado, stop en +${stopPct.toFixed(2)}%`;
    }

    if (newStopPrice && newStopPrice >= currentPrice) {
      return { newStopPrice: null, newLevel: beProgressiveLevel, reason: "Stop BE calculado >= precio actual, no aplicado" };
    }

    return { newStopPrice, newLevel, reason };
  }

  // === SMART_GUARD ALERT HELPERS ===

  shouldSendSgAlert(lotId: string, eventType: string, throttleMs?: number): boolean {
    const key = `${lotId}:${eventType}`;
    const lastAlert = this.sgAlertThrottle.get(key);
    const now = Date.now();
    if (lastAlert && throttleMs) {
      return now - lastAlert >= throttleMs;
    } else if (lastAlert) {
      return false; // One-shot: already sent
    }
    return true;
  }

  private markSgAlertSent(lotId: string, eventType: string): void {
    const key = `${lotId}:${eventType}`;
    this.sgAlertThrottle.set(key, Date.now());
    this.persistThrottle("sg:", key, Date.now());
  }

  async sendSgEventAlert(
    eventType: "SG_BREAK_EVEN_ACTIVATED" | "SG_TRAILING_ACTIVATED" | "SG_TRAILING_STOP_UPDATED" | "SG_SCALE_OUT_EXECUTED",
    position: OpenPosition,
    currentPrice: number,
    extra: {
      stopPrice?: number;
      profitPct: number;
      reason: string;
      takeProfitPrice?: number;
      trailingStatus?: { active: boolean; startPct: number; distancePct: number; stepPct: number };
    },
    throttleMs?: number,
    eventKey?: string
  ) {
    const { lotId, pair, entryPrice, openedAt } = position;
    const shortLotId = lotId.substring(0, 12);
    const envInfo = environment.getInfo();
    const resolvedKey = eventKey ?? eventType;

    // === THROTTLE CHECK (read-only, does NOT mark yet) ===
    if (!this.shouldSendSgAlert(lotId, resolvedKey, throttleMs)) {
      log(`[POSITION_ALERT] SKIPPED one-shot/throttle: ${eventType} ${pair} key=${resolvedKey}`, "trading");
      return;
    }

    // === TELEGRAM INIT CHECK — do NOT mark throttle if TG not ready (allows retry next cycle) ===
    const telegram = this.host.getTelegramService();
    const tgInitialized = telegram.isInitialized();
    log(`[POSITION_ALERT] ${eventType} ${pair} lotId=${shortLotId} tgInit=${tgInitialized} profit=${extra.profitPct.toFixed(2)}%`, "trading");

    if (!tgInitialized) {
      log(`[POSITION_ALERT] SKIPPED no-tg: ${eventType} ${pair} — throttle NOT marked, will retry next cycle`, "trading");
      return;
    }

    // === MARK THROTTLE only after TG confirmed available ===
    this.markSgAlertSent(lotId, resolvedKey);

    // Emit event for /api/events
    await botLogger.info(eventType, `${eventType} en ${pair}`, {
      pair,
      lotId,
      entryPrice,
      currentPrice,
      stopPrice: extra.stopPrice,
      takeProfitPrice: extra.takeProfitPrice,
      profitPct: extra.profitPct,
      trailingStatus: extra.trailingStatus,
      env: envInfo.env,
      instanceId: envInfo.instanceId,
      reason: extra.reason,
    });

    // Calculate duration
    const durationMs = openedAt ? Date.now() - openedAt : 0;
    const durationMins = Math.floor(durationMs / 60000);
    const durationHours = Math.floor(durationMins / 60);
    const durationDays = Math.floor(durationHours / 24);
    const durationTxt = durationDays > 0
      ? `${durationDays}d ${durationHours % 24}h`
      : durationHours > 0
        ? `${durationHours}h ${durationMins % 60}m`
        : `${durationMins}m`;

    const formatPrice = (price: number) => {
      if (price >= 100) return price.toFixed(2);
      if (price >= 1) return price.toFixed(4);
      return price.toFixed(6);
    };

    const assetName = pair.replace("/USD", "");
    const profitText = extra.profitPct >= 0 ? `+${extra.profitPct.toFixed(2)}%` : `${extra.profitPct.toFixed(2)}%`;

    let naturalMessage = "";
    let subtype: "trade_breakeven" | "trade_trailing" | "trade_sell";

    switch (eventType) {
      case "SG_BREAK_EVEN_ACTIVATED":
        subtype = "trade_breakeven";
        naturalMessage = `⚖️ <b>Protección activada en ${assetName}</b>\n\n`;
        naturalMessage += `Tu posición ya está en ganancias (${profitText}). He movido el stop a break-even.\n\n`;
        naturalMessage += `📊 Entrada: $${formatPrice(entryPrice)} | Actual: $${formatPrice(currentPrice)}\n`;
        if (extra.stopPrice) {
          naturalMessage += `📍 Stop BE: $${formatPrice(extra.stopPrice)}\n`;
        }
        if (extra.takeProfitPrice) {
          naturalMessage += `🎯 Objetivo: $${formatPrice(extra.takeProfitPrice)}\n`;
        }
        naturalMessage += `⏱️ Duración: ${durationTxt}\n`;
        naturalMessage += `🔗 Lote: <code>${shortLotId}</code>`;
        break;

      case "SG_TRAILING_ACTIVATED":
        subtype = "trade_trailing";
        naturalMessage = `📈 <b>Trailing activo en ${assetName}</b>\n\n`;
        naturalMessage += `¡Las ganancias siguen subiendo! (${profitText}). El trailing ahora sigue el precio.\n\n`;
        naturalMessage += `📊 Entrada: $${formatPrice(entryPrice)} | Actual: $${formatPrice(currentPrice)}\n`;
        if (extra.stopPrice) {
          naturalMessage += `📍 Stop trailing: $${formatPrice(extra.stopPrice)}\n`;
        }
        if (extra.trailingStatus) {
          naturalMessage += `🔄 Distancia: ${extra.trailingStatus.distancePct}%\n`;
        }
        naturalMessage += `⏱️ Duración: ${durationTxt}\n`;
        naturalMessage += `🔗 Lote: <code>${shortLotId}</code>`;
        break;

      case "SG_TRAILING_STOP_UPDATED":
        subtype = "trade_trailing";
        naturalMessage = `🔼 <b>Stop actualizado en ${assetName}</b>\n\n`;
        naturalMessage += `El precio sigue subiendo (${profitText}). Stop elevado para proteger más ganancias.\n\n`;
        naturalMessage += `📊 Actual: $${formatPrice(currentPrice)}\n`;
        if (extra.stopPrice) {
          naturalMessage += `📍 Nuevo stop: $${formatPrice(extra.stopPrice)}\n`;
        }
        naturalMessage += `🔗 Lote: <code>${shortLotId}</code>`;
        break;

      case "SG_SCALE_OUT_EXECUTED":
        subtype = "trade_sell";
        naturalMessage = `📊 <b>Venta parcial en ${assetName}</b>\n\n`;
        naturalMessage += `He vendido parte de la posición para asegurar ganancias (${profitText}).\n\n`;
        naturalMessage += `📊 Entrada: $${formatPrice(entryPrice)} | Actual: $${formatPrice(currentPrice)}\n`;
        naturalMessage += `⏱️ Duración: ${durationTxt}\n`;
        naturalMessage += `🔗 Lote: <code>${shortLotId}</code>\n\n`;
        naturalMessage += `<i>El resto sigue abierto para capturar más subidas.</i>`;
        break;

      default:
        subtype = "trade_trailing";
    }

    try {
      const simPfxSg = this.host.isDryRunMode() ? "🧪 <b>[SIM]</b>\n" : "";
      await telegram.sendAlertWithSubtype(simPfxSg + naturalMessage, "trades", subtype);
      log(`[POSITION_ALERT] SENT: ${eventType} ${pair} subtype=${subtype}`, "trading");
    } catch (tgErr: any) {
      log(`[POSITION_ALERT] SEND_FAILED: ${eventType} ${pair} — clearing throttle for retry: ${tgErr.message}`, "trading");
      this.sgAlertThrottle.delete(`${lotId}:${resolvedKey}`);
    }
  }

  // ================================================================
  // PRIVATE: checkSinglePositionSLTP (legacy + delegates to SmartGuard)
  // ================================================================

  private async checkSinglePositionSLTP(
    pair: string,
    position: OpenPosition,
    currentPrice: number,
    stopLossPercent: number,
    takeProfitPercent: number,
    trailingStopEnabled: boolean,
    trailingStopPercent: number,
    balances: any
  ) {
    const lotId = position.lotId;

    const isTestPosition = lotId?.startsWith("TEST-") || position.entryMode === "TEST";
    if (isTestPosition) {
      return;
    }

    // REGLA ÚNICA: Smart-Guard solo gestiona posiciones del bot (engine-managed)
    const isBotPosition = position.configSnapshot != null &&
                          position.entryMode === 'SMART_GUARD' &&
                          !lotId?.startsWith('reconcile-') &&
                          !lotId?.startsWith('sync-') &&
                          !lotId?.startsWith('adopt-');

    if (!isBotPosition) {
      return;
    }
    const priceChange = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;

    if (currentPrice > position.highestPrice) {
      position.highestPrice = currentPrice;
      this.host.setPosition(lotId, position);
      await this.host.updatePositionHighestPriceByLotId(lotId, currentPrice);
    }

    // Check if this is a SMART_GUARD position - use dedicated logic
    if (position.entryMode === "SMART_GUARD" && position.configSnapshot) {
      await this.checkSmartGuardExit(pair, position, currentPrice, priceChange);
      return;
    }

    // Use snapshot params if available (new positions), else use current config (legacy)
    let effectiveSL: number;
    let effectiveTP: number;
    let effectiveTrailingEnabled: boolean;
    let effectiveTrailingPct: number;
    let paramsSource: string;

    if (position.configSnapshot) {
      effectiveSL = position.configSnapshot.stopLossPercent;
      effectiveTP = position.configSnapshot.takeProfitPercent;
      effectiveTrailingEnabled = position.configSnapshot.trailingStopEnabled;
      effectiveTrailingPct = position.configSnapshot.trailingStopPercent;
      paramsSource = `snapshot (${position.entryMode})`;
    } else {
      effectiveSL = stopLossPercent;
      effectiveTP = takeProfitPercent;
      effectiveTrailingEnabled = trailingStopEnabled;
      effectiveTrailingPct = trailingStopPercent;
      paramsSource = "current config (legacy)";
    }

    let shouldSell = false;
    let reason = "";
    let emoji = "";

    if (priceChange <= -effectiveSL) {
      shouldSell = true;
      reason = `Stop-Loss activado (${priceChange.toFixed(2)}% < -${effectiveSL}%) [${paramsSource}]`;
      emoji = "🛑";
      this.host.setStopLossCooldown(pair);
      await botLogger.warn("STOP_LOSS_HIT", `Stop-Loss activado en ${pair}`, {
        pair, lotId, entryPrice: position.entryPrice, currentPrice, priceChange,
        stopLossPercent: effectiveSL, paramsSource,
        cooldownMinutes: POST_STOPLOSS_COOLDOWN_MS / 60000,
      });
    }
    else if (priceChange >= effectiveTP) {
      shouldSell = true;
      reason = `Take-Profit activado (${priceChange.toFixed(2)}% > ${effectiveTP}%) [${paramsSource}]`;
      emoji = "🎯";
      await botLogger.info("TAKE_PROFIT_HIT", `Take-Profit alcanzado en ${pair}`, {
        pair, lotId, entryPrice: position.entryPrice, currentPrice, priceChange,
        takeProfitPercent: effectiveTP, paramsSource,
      });
    }
    else if (effectiveTrailingEnabled && position.highestPrice > position.entryPrice) {
      const dropFromHigh = ((position.highestPrice - currentPrice) / position.highestPrice) * 100;
      if (dropFromHigh >= effectiveTrailingPct && priceChange > 0) {
        shouldSell = true;
        reason = `Trailing Stop activado (cayó ${dropFromHigh.toFixed(2)}% desde máximo $${position.highestPrice.toFixed(2)}) [${paramsSource}]`;
        emoji = "📉";
        await botLogger.info("TRAILING_STOP_HIT", `Trailing Stop activado en ${pair}`, {
          pair, lotId, entryPrice: position.entryPrice, highestPrice: position.highestPrice,
          currentPrice, dropFromHigh, trailingStopPercent: effectiveTrailingPct, paramsSource,
        });
      }
    }

    if (shouldSell) {
      const minVolume = this.host.getOrderMin(pair);
      const sellAmount = position.amount;

      if (sellAmount < minVolume) {
        log(`Cantidad a vender (${sellAmount}) menor al mínimo de Kraken (${minVolume}) para ${pair} (${lotId})`, "trading");
        await botLogger.warn("EXIT_MIN_VOLUME_BLOCKED", `Salida bloqueada por volumen mínimo en ${pair}`, {
          posId: lotId, pair, sellAmount, minVolume, currentPrice,
          sellAmountUsd: sellAmount * currentPrice, trigger: reason, action: "POSITION_LEFT_OPEN",
        });
        const telegram = this.host.getTelegramService();
        if (telegram.isInitialized()) {
          await telegram.sendAlertWithSubtype(
            `🤖 <b>KRAKEN BOT</b> 🇪🇸\n━━━━━━━━━━━━━━━━━━━\n` +
            `⚠️ <b>Salida bloqueada: volumen mínimo</b>\n\n` +
            `📦 Par: <code>${pair}</code> | Lot: <code>${lotId}</code>\n` +
            `🔢 Cantidad: <code>${sellAmount.toFixed(8)}</code> (mín: <code>${minVolume}</code>)\n` +
            `💵 Valor: <code>$${(sellAmount * currentPrice).toFixed(2)}</code>\n` +
            `⚡ Trigger: <code>${reason}</code>\n` +
            `⚠️ <b>POSICIÓN SIGUE ABIERTA — Revisar manualmente</b>\n` +
            `━━━━━━━━━━━━━━━━━━━`,
            "errors", "error_api"
          );
        }
        return;
      }

      // FASE 0 HOTFIX: Check exit lock + circuit breaker BEFORE any sell
      if (!this.checkCircuitBreaker(lotId)) {
        await botLogger.error("CIRCUIT_BREAKER_BLOCKED", `Circuit breaker bloqueó SELL legacy en ${pair}`, {
          pair, lotId, reason, sellAmount,
        });
        return;
      }
      if (!this.acquireExitLock(lotId)) {
        return;
      }
      this.recordSellAttempt(lotId);

      try {
        // VERIFICACIÓN DE BALANCE REAL
        const freshBalances = await this.host.getTradingExchange().getBalance();
        const realAssetBalance = this.host.getAssetBalance(pair, freshBalances);

        // FASE 0 HOTFIX: REMOVED reconciliation UP — NEVER increase position.amount to match exchange balance
        // This was absorbing external/unmanaged funds into the lot
        if (realAssetBalance > sellAmount * 1.005) {
          const extraAmount = realAssetBalance - sellAmount;
          const extraValueUsd = extraAmount * currentPrice;
          log(`⚠️ Balance real mayor al registrado en ${pair} (${lotId}): Registrado ${sellAmount}, Real ${realAssetBalance}, Extra $${extraValueUsd.toFixed(2)} — IGNORADO (FASE 0 safe mode)`, "trading");
        }

        // Si el balance real es menor al 99.5% del esperado
        if (realAssetBalance < sellAmount * 0.995) {
          log(`⚠️ Discrepancia de balance en ${pair} (${lotId}): Registrado ${sellAmount}, Real ${realAssetBalance}`, "trading");

          if (realAssetBalance < minVolume) {
            log(`Posición huérfana eliminada en ${pair} (${lotId}): balance real (${realAssetBalance}) < mínimo (${minVolume})`, "trading");

            const usdBalance = parseFloat(String(freshBalances?.ZUSD || freshBalances?.USD || "0"));
            this.host.setCurrentUsdBalance(usdBalance);

            this.host.deletePosition(lotId);
            await this.host.deletePositionFromDBByLotId(lotId);

            this.host.clearStopLossCooldown(pair);
            this.host.clearExposureAlert(pair);
            this.host.setPairCooldown(pair);
            this.host.setLastTradeTime(pair, Date.now());

            const telegram = this.host.getTelegramService();
            if (telegram.isInitialized()) {
              await telegram.sendAlertWithSubtype(`🤖 <b>KRAKEN BOT</b> 🇪🇸
━━━━━━━━━━━━━━━━━━━
🔄 <b>Posición Huérfana Eliminada</b>

📦 <b>Detalles:</b>
   • Par: <code>${pair}</code>
   • Lot: <code>${lotId}</code>
   • Registrada: <code>${sellAmount.toFixed(8)}</code>
   • Real en Kraken: <code>${realAssetBalance.toFixed(8)}</code>

⚠️ La posición no existe en Kraken y fue eliminada.
━━━━━━━━━━━━━━━━━━━`, "strategy", "strategy_router_transition");
            }

            await botLogger.warn("ORPHAN_POSITION_CLEANED", `Posición huérfana eliminada en ${pair}`, {
              pair, lotId, registeredAmount: sellAmount, realBalance: realAssetBalance,
              newUsdBalance: usdBalance,
            });
            return;
          }

          // Si hay algo de balance pero menos del registrado, ajustar posición DOWN al real
          log(`Ajustando posición ${pair} (${lotId}) de ${sellAmount} a ${realAssetBalance}`, "trading");
          position.amount = realAssetBalance;
          this.host.setPosition(lotId, position);
          await this.host.savePositionToDB(pair, position);

          const telegram = this.host.getTelegramService();
          if (telegram.isInitialized()) {
            await telegram.sendAlertWithSubtype(`🤖 <b>KRAKEN BOT</b> 🇪🇸
━━━━━━━━━━━━━━━━━━━
🔧 <b>Posición Ajustada</b>

📦 <b>Detalles:</b>
   • Par: <code>${pair}</code>
   • Lot: <code>${lotId}</code>
   • Cantidad anterior: <code>${sellAmount.toFixed(8)}</code>
   • Cantidad real: <code>${realAssetBalance.toFixed(8)}</code>

ℹ️ Se usará la cantidad real para la venta.
━━━━━━━━━━━━━━━━━━━`, "strategy", "strategy_router_transition");
          }
        }

        log(`${emoji} ${reason} para ${pair} (${lotId})`, "trading");

        // FASE 0 HOTFIX: Use ONLY position.amount (may have been adjusted DOWN, never UP)
        const actualSellAmount = position.amount;

        // Calcular P&L NETO
        const grossPnl = (currentPrice - position.entryPrice) * actualSellAmount;
        const entryValueUsd = position.entryPrice * actualSellAmount;
        const exitValueUsd = currentPrice * actualSellAmount;
        const currentFeePct = getTakerFeePct();
        const entryFeeUsd = position.entryFee ?? (entryValueUsd * currentFeePct / 100);
        const exitFeeUsd = exitValueUsd * currentFeePct / 100;
        const pnl = grossPnl - entryFeeUsd - exitFeeUsd;
        const pnlPercent = (pnl / entryValueUsd) * 100;

        const sellContext = {
          entryPrice: position.entryPrice,
          entryFee: position.entryFee,
          sellAmount: actualSellAmount,
          positionAmount: position.amount,
          aiSampleId: position.aiSampleId,
          openedAt: position.openedAt
        };
        await botLogger.info("EXIT_TRIGGERED", `Salida disparada en ${pair}`, {
          posId: lotId, pair,
          trigger: reason.includes("Stop-Loss") ? "STOP_HIT" : reason.includes("Take-Profit") ? "TP_HIT" : "TRAIL_HIT",
          currentPrice, sellAmount: actualSellAmount, reason, priceChangePct: priceChange,
        });
        await botLogger.info("EXIT_ORDER_PLACED", `Intentando orden SELL en ${pair}`, {
          posId: lotId, pair, orderType: "market", side: "sell", qty: actualSellAmount,
          price: currentPrice, exchange: this.host.getTradingExchangeType(),
          computedOrderUsd: actualSellAmount * currentPrice, trigger: reason,
        });
        const success = await this.host.executeTrade(pair, "sell", actualSellAmount.toFixed(8), currentPrice, reason, undefined, undefined, undefined, sellContext);

        if (!success) {
          await botLogger.error("EXIT_ORDER_FAILED", `FALLO de orden SELL en ${pair} — posición sigue abierta`, {
            posId: lotId, pair, orderType: "market", side: "sell", qty: actualSellAmount,
            price: currentPrice, exchange: this.host.getTradingExchangeType(),
            computedOrderUsd: actualSellAmount * currentPrice, trigger: reason, action: "POSITION_LEFT_OPEN",
          });
          const telegram = this.host.getTelegramService();
          if (telegram.isInitialized()) {
            await telegram.sendAlertWithSubtype(
              `🤖 <b>KRAKEN BOT</b> 🇪🇸\n━━━━━━━━━━━━━━━━━━━\n` +
              `🚨 <b>FALLO DE ORDEN DE SALIDA</b>\n\n` +
              `📦 Par: <code>${pair}</code> | Lot: <code>${lotId}</code>\n` +
              `💵 Precio: <code>$${currentPrice.toFixed(2)}</code> | Qty: <code>${actualSellAmount.toFixed(8)}</code>\n` +
              `⚡ Trigger: <code>${reason}</code>\n` +
              `❌ La orden NO se ejecutó en el exchange\n` +
              `⚠️ <b>POSICIÓN SIGUE ABIERTA — Revisar manualmente</b>\n` +
              `━━━━━━━━━━━━━━━━━━━`,
              "errors", "error_api"
            );
          }
          return;
        }

        if (success) {
          const telegram = this.host.getTelegramService();
          if (telegram.isInitialized()) {
            const durationMs = position.openedAt ? Date.now() - position.openedAt : 0;
            const durationMins = Math.floor(durationMs / 60000);
            const durationHours = Math.floor(durationMins / 60);
            const durationDays = Math.floor(durationHours / 24);
            const durationTxt = durationDays > 0 ? `${durationDays}d ${durationHours % 24}h` : durationHours > 0 ? `${durationHours}h ${durationMins % 60}m` : `${durationMins}m`;

            const assetName = pair.replace("/USD", "");
            const shortLotId = lotId.substring(0, 12);

            const isStopLoss = reason.toLowerCase().includes("stop-loss") || reason.toLowerCase().includes("stoploss");
            const isTakeProfit = reason.toLowerCase().includes("take-profit") || reason.toLowerCase().includes("tp fijo");
            const isTrailing = reason.toLowerCase().includes("trailing");

            let headerEmoji = "";
            let headerText = "";
            let resultText = "";

            if (pnl >= 0) {
              if (isTakeProfit) {
                headerEmoji = "🎯";
                headerText = `Take-Profit en ${assetName}`;
                resultText = `¡Objetivo cumplido! Ganancia de <b>+$${pnl.toFixed(2)}</b> (+${pnlPercent.toFixed(2)}%).`;
              } else if (isTrailing) {
                headerEmoji = "📈";
                headerText = `Trailing Stop en ${assetName}`;
                resultText = `El trailing protegió las ganancias: <b>+$${pnl.toFixed(2)}</b> (+${pnlPercent.toFixed(2)}%).`;
              } else {
                headerEmoji = "🟢";
                headerText = `Venta con ganancia en ${assetName}`;
                resultText = `Resultado: <b>+$${pnl.toFixed(2)}</b> (+${pnlPercent.toFixed(2)}%).`;
              }
            } else {
              if (isStopLoss) {
                headerEmoji = "🛑";
                headerText = `Stop-Loss en ${assetName}`;
                resultText = `Pérdida limitada a <b>$${pnl.toFixed(2)}</b> (${pnlPercent.toFixed(2)}%).`;
              } else {
                headerEmoji = "🔴";
                headerText = `Venta en ${assetName}`;
                resultText = `Resultado: <b>$${pnl.toFixed(2)}</b> (${pnlPercent.toFixed(2)}%).`;
              }
            }

            let naturalMessage = `${headerEmoji} <b>${headerText}</b>\n\n`;
            naturalMessage += `${resultText}\n\n`;
            naturalMessage += `📊 Entrada: $${position.entryPrice.toFixed(2)} → Salida: $${currentPrice.toFixed(2)}\n`;
            naturalMessage += `📦 Cantidad: ${actualSellAmount.toFixed(8)}\n`;
            naturalMessage += `⏱️ Duración: ${durationTxt}\n`;
            naturalMessage += `🔗 Lote: <code>${shortLotId}</code>\n\n`;
            naturalMessage += `<a href="${environment.panelUrl}">Ver en Panel</a>`;

            await telegram.sendAlertWithSubtype(naturalMessage, "trades", "trade_sell");
          }

          this.host.deletePosition(lotId);
          await this.host.deletePositionFromDBByLotId(lotId);
          this.host.setLastTradeTime(pair, Date.now());
          await botLogger.info("POSITION_CLOSED_SG", `Posición cerrada en ${pair}`, {
            posId: lotId, pair, closeReason: reason, avgPrice: currentPrice,
            pnlNet: pnl, priceChangePct: priceChange, exchange: this.host.getTradingExchangeType(),
          });
        }
      } finally {
        // FASE 0 HOTFIX: Always release exit lock
        this.releaseExitLock(lotId);
      }
    }
  }

  // ================================================================
  // PRIVATE: checkSmartGuardExit (SMART_GUARD exit logic)
  // ================================================================

  private async checkSmartGuardExit(
    pair: string,
    position: OpenPosition,
    currentPrice: number,
    priceChange: number
  ) {
    const snapshot = position.configSnapshot!;
    const paramsSource = `SMART_GUARD snapshot`;
    const lotId = position.lotId;

    // === SMART TIME-STOP CHECK (per-asset TTL + regime multiplier) ===
    {
      let regime: MarketRegime = "TRANSITION";
      try {
        regime = await this.host.getMarketRegime(pair);
      } catch (e: any) {
        log(`[TIME_STOP_SG] Failed to get regime for ${pair}, using TRANSITION: ${e?.message}`, "trading");
      }

      // FASE 4 — pasar P&L + fee round-trip para softMode real.
      const takerFeePctSG = getTakerFeePct();
      const roundTripFeePctSG = takerFeePctSG * 2;
      const tsResult: TimeStopCheckResult = await checkSmartTimeStop(
        pair,
        position.openedAt,
        regime,
        position.timeStopDisabled ?? false,
        "spot",
        priceChange,
        roundTripFeePctSG,
      );

      if (tsResult.expired) {
        const { ageHours, ttlHours, shouldClose, closeOrderType, limitFallbackSeconds, telegramAlertEnabled, configSource } = tsResult;

        if (shouldClose) {
          // TIMESTOP EXPIRED + ENABLED → Execute SELL (closeReason=TIMESTOP)
          log(`[TIME_STOP_SG] pair=${pair} lotId=${lotId} ageHours=${ageHours.toFixed(1)} ttl=${ttlHours.toFixed(1)}h regime=${regime} closeType=${closeOrderType} FORCE_CLOSE`, "trading");

          // Mark expiry + send Telegram alert ONCE (first expiry cycle only)
          if (!position.timeStopExpiredAt) {
            const now = Date.now();
            this.timeStopNotified.set(lotId, now);
            this.persistThrottle("ts:", lotId, now);
            position.timeStopExpiredAt = now;
            this.host.setPosition(lotId, position);
            await this.host.savePositionToDB(pair, position);

            if (telegramAlertEnabled) {
              const telegram = this.host.getTelegramService();
              if (telegram.isInitialized()) {
                await telegram.sendAlertWithSubtype(`🤖 <b>KRAKEN BOT</b> 🇪🇸
━━━━━━━━━━━━━━━━━━━
⏰ <b>Time-Stop EXPIRADO — Cierre Forzado</b>

📦 <b>Detalles:</b>
   • Par: <code>${pair}</code>
   • Modo: <code>SMART_GUARD</code>
   • Tiempo abierta: <code>${ageHours.toFixed(0)} horas</code>
   • TTL inteligente: <code>${ttlHours.toFixed(1)} horas</code>
   • Régimen: <code>${regime}</code>
   • Config: <code>${configSource}</code>

📊 <b>Estado:</b>
   • P&L actual: <code>${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(2)}%</code>

⚡ <b>ACCIÓN:</b> Cierre forzado [closeReason=TIMESTOP, tipo=${closeOrderType}]
━━━━━━━━━━━━━━━━━━━`, "trades", "trade_timestop");
              }
            }
          }

          // Execute sell via safeSell (FASE 0 HOTFIX: lock + circuit breaker + cleanup)
          const minVolume = this.host.getOrderMin(pair);
          if (position.amount < minVolume) {
            // Position is dust — clean up directly
            log(`[TIME_STOP_SG] pair=${pair} lotId=${lotId} amount=${position.amount} < minVolume=${minVolume} — limpiando posición dust`, "trading");
            await botLogger.warn("TIME_STOP_DUST_CLEANUP", `TimeStop: posición dust limpiada en ${pair} [SMART_GUARD]`, {
              pair, lotId, amount: position.amount, minVolume, ageHours, ttlHours,
            });
            this.host.deletePosition(lotId);
            await this.host.deletePositionFromDBByLotId(lotId);
          } else {
            // FASE 0 HOTFIX: Use ONLY position.amount, never realAssetBalance for sell qty
            const sellAmount = position.amount;

            if (sellAmount >= minVolume) {
              const sellContext = {
                entryPrice: position.entryPrice,
                entryFee: position.entryFee,
                sellAmount: sellAmount,
                positionAmount: position.amount,
                aiSampleId: position.aiSampleId,
                openedAt: position.openedAt
              };

              await botLogger.info("TIME_STOP_CLOSE", `TimeStop cierre forzado en ${pair} [SMART_GUARD]`, {
                pair, lotId, ageHours, ttlHours, regime, closeOrderType, configSource,
                priceChangePct: priceChange, sellAmount,
              });

              // FASE 0 HOTFIX: Use safeSell which handles lock, circuit breaker, cap, and cleanup
              const sellSuccess = await this.safeSell(
                pair, lotId, sellAmount, currentPrice,
                `TimeStop expirado (${ageHours.toFixed(0)}h >= ${ttlHours.toFixed(1)}h) [SMART_GUARD, ${regime}, ${configSource}]`,
                position, sellContext
              );

              if (!sellSuccess) {
                // Check if balance is actually gone (orphan case)
                try {
                  const freshBalances = await this.host.getTradingExchange().getBalance();
                  const realAssetBalance = this.host.getAssetBalance(pair, freshBalances);
                  if (realAssetBalance < minVolume) {
                    log(`[TIME_STOP_SG] pair=${pair} lotId=${lotId} realBalance=${realAssetBalance.toFixed(8)} < minVolume=${minVolume} — huérfana, limpiando`, "trading");
                    await botLogger.warn("TIME_STOP_ORPHAN_CLEANUP", `TimeStop: posición huérfana limpiada en ${pair} (balance real insuficiente) [SMART_GUARD]`, {
                      pair, lotId, registeredAmount: position.amount, realBalance: realAssetBalance, minVolume, ageHours,
                    });
                    this.host.deletePosition(lotId);
                    await this.host.deletePositionFromDBByLotId(lotId);
                  }
                } catch (balErr: any) {
                  log(`[TIME_STOP_SG] pair=${pair} lotId=${lotId} balance check error after failed sell: ${balErr?.message}`, "trading");
                }
              }
            } else {
              // sellAmount < minVolume — dust, clean up
              log(`[TIME_STOP_SG] pair=${pair} lotId=${lotId} sellAmount=${sellAmount} < minVolume=${minVolume} — dust cleanup`, "trading");
              this.host.deletePosition(lotId);
              await this.host.deletePositionFromDBByLotId(lotId);
            }
          }
          return; // Position closed, skip rest of SmartGuard logic
        } else {
          // TIMESTOP EXPIRED but DISABLED by toggle → log + notify only
          const now = Date.now();
          const lastNotify = this.timeStopNotified.get(lotId) || 0;
          const shouldNotify = now - lastNotify > this.TIME_STOP_NOTIFY_THROTTLE_MS;

          if (shouldNotify && !position.timeStopExpiredAt) {
            this.timeStopNotified.set(lotId, now);
            this.persistThrottle("ts:", lotId, now);
            position.timeStopExpiredAt = now;
            this.host.setPosition(lotId, position);
            await this.host.savePositionToDB(pair, position);
            log(`[TIME_STOP_SG] pair=${pair} lotId=${lotId} ageHours=${ageHours.toFixed(1)} ttl=${ttlHours.toFixed(1)}h DISABLED_BY_TOGGLE — LOG_ONLY`, "trading");

            await botLogger.info("TIME_STOP_EXPIRED_DISABLED", `TimeStop expirado pero DESACTIVADO en ${pair} [SMART_GUARD]`, {
              pair, lotId, ageHours, ttlHours, regime, configSource,
            });

            if (telegramAlertEnabled) {
              const telegram = this.host.getTelegramService();
              if (telegram.isInitialized()) {
                await telegram.sendAlertWithSubtype(`🤖 <b>KRAKEN BOT</b> 🇪🇸
━━━━━━━━━━━━━━━━━━━
⏰ <b>Time-Stop Expirado (DESACTIVADO)</b>

📦 <b>Detalles:</b>
   • Par: <code>${pair}</code>
   • Modo: <code>SMART_GUARD</code>
   • Tiempo abierta: <code>${ageHours.toFixed(0)} horas</code>
   • TTL inteligente: <code>${ttlHours.toFixed(1)} horas</code>
   • Régimen: <code>${regime}</code>

📊 <b>Estado:</b>
   • P&L actual: <code>${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(2)}%</code>

⚠️ <b>TimeStop DESACTIVADO — NO se ejecutará venta</b>
💡 SmartGuard sigue gestionando la posición
━━━━━━━━━━━━━━━━━━━`, "trades", "trade_timestop");
              }
            }
          }
          // Continue with SmartGuard logic (BE, trailing, etc.)
        }
      }
    }

    // Get snapshot params with defaults
    const beAtPct = snapshot.sgBeAtPct ?? 1.5;
    const feeCushionPct = snapshot.sgFeeCushionPct ?? 0.45;
    const trailStartPct = snapshot.sgTrailStartPct ?? 2.0;
    const trailDistancePctConfig = snapshot.sgTrailDistancePct ?? 0.85;
    const trailStepPct = snapshot.sgTrailStepPct ?? 0.25;
    const tpFixedEnabled = snapshot.sgTpFixedEnabled ?? false;
    const tpFixedPct = snapshot.sgTpFixedPct ?? 10;
    const scaleOutEnabled = snapshot.sgScaleOutEnabled ?? true;
    const scaleOutPct = snapshot.sgScaleOutPct ?? 35;
    const minPartUsd = snapshot.sgMinPartUsd ?? 50;
    const scaleOutThreshold = snapshot.sgScaleOutThreshold ?? 80;

    const ultimateSL = snapshot.stopLossPercent;

    // === DYNAMIC TRAILING DISTANCE (ATR + Time Decay) ===
    // Pro standard: adapt trailing distance to current market volatility and position age
    const positionAgeHours = (Date.now() - position.openedAt) / (1000 * 60 * 60);
    const atrPct = this.host.getATRPercent(pair);

    // ATR-based: use 1.5× ATR as trailing distance, capped at config value, floor at 0.3%
    let effectiveTrailDistancePct = trailDistancePctConfig;
    if (atrPct > 0) {
      const atrBasedDist = atrPct * 1.5;
      effectiveTrailDistancePct = Math.min(trailDistancePctConfig, Math.max(0.3, atrBasedDist));
    }

    // Time decay: tighten trailing as position ages (halves over 72h, floor 50% of original)
    const decayFactor = Math.max(0.5, 1 - (positionAgeHours / 72) * 0.5);
    effectiveTrailDistancePct = Math.max(0.3, effectiveTrailDistancePct * decayFactor);

    // Use effective value throughout
    const trailDistancePct = effectiveTrailDistancePct;

    let shouldSellFull = false;
    let shouldScaleOut = false;
    let sellReason = "";
    let emoji = "";
    let positionModified = false;

    const breakEvenPrice = position.entryPrice * (1 + feeCushionPct / 100);

    // === EXIT_EVAL (FASE 2 — con dedup material) ===
    // Sólo emitir cuando cambia el estado (BE/trailing/stopPrice) o cada heartbeat (60s).
    // Evita persistir el mismo log cada 5s fuera de horario / en posiciones estables.
    {
      const evalHash = [
        position.sgBreakEvenActivated ? "1" : "0",
        position.sgTrailingActivated ? "1" : "0",
        position.sgCurrentStopPrice != null ? position.sgCurrentStopPrice.toFixed(4) : "na",
        position.beProgressiveLevel ?? 0,
        // Redondear priceChange a 0.1% para tolerar jitter
        (Math.round(priceChange * 10) / 10).toFixed(1),
      ].join("|");
      const nowEval = Date.now();
      const prevEval = this.lastExitEvalEmitted.get(lotId);
      const shouldEmit = !prevEval || prevEval.hash !== evalHash || (nowEval - prevEval.ts) >= this.EXIT_EVAL_HEARTBEAT_MS;
      if (shouldEmit) {
        this.lastExitEvalEmitted.set(lotId, { hash: evalHash, ts: nowEval });
        await botLogger.info("EXIT_EVAL", `SMART_GUARD evaluando posición ${pair}`, {
          posId: lotId, exchange: this.host.getTradingExchangeType(), pair,
          entryPrice: position.entryPrice, currentPrice, priceChangePct: priceChange,
          qty: position.amount,
          beArmed: position.sgBreakEvenActivated ?? false,
          trailingArmed: position.sgTrailingActivated ?? false,
          stopPrice: position.sgCurrentStopPrice ?? null,
          beAtPct, trailStartPct,
          trailDistancePct, trailDistancePctConfig, atrPct, decayFactor,
          positionAgeHours: Math.round(positionAgeHours * 10) / 10,
          beProgressiveLevel: position.beProgressiveLevel ?? 0,
          ultimateSL,
        });
      }
    }

    // 1. ULTIMATE STOP-LOSS
    if (priceChange <= -ultimateSL) {
      shouldSellFull = true;
      sellReason = `Stop-Loss emergencia SMART_GUARD (${priceChange.toFixed(2)}% < -${ultimateSL}%) [${paramsSource}]`;
      emoji = "🛑";
      this.host.setStopLossCooldown(pair);
      await botLogger.warn("SG_EMERGENCY_STOPLOSS", `SMART_GUARD Stop-Loss emergencia en ${pair}`, {
        pair, entryPrice: position.entryPrice, currentPrice, priceChange, ultimateSL, paramsSource,
      });
    }

    // 2. FIXED TAKE-PROFIT
    else if (tpFixedEnabled && priceChange >= tpFixedPct) {
      shouldSellFull = true;
      sellReason = `Take-Profit fijo SMART_GUARD (${priceChange.toFixed(2)}% >= ${tpFixedPct}%) [${paramsSource}]`;
      emoji = "🎯";
      await botLogger.info("SG_TP_FIXED", `SMART_GUARD TP fijo alcanzado en ${pair}`, {
        pair, entryPrice: position.entryPrice, currentPrice, priceChange, tpFixedPct, paramsSource,
      });
    }

    // 3. BREAK-EVEN ACTIVATION
    else if (!position.sgBreakEvenActivated && priceChange >= beAtPct) {
      position.sgBreakEvenActivated = true;
      position.sgCurrentStopPrice = breakEvenPrice;
      positionModified = true;
      log(`SMART_GUARD ${pair}: Break-even activado (+${priceChange.toFixed(2)}%), stop movido a $${breakEvenPrice.toFixed(4)}`, "trading");
      await botLogger.info("BREAKEVEN_ARMED", `SMART_GUARD Break-even armado en ${pair}`, {
        posId: lotId, pair, entryPrice: position.entryPrice, newStop: breakEvenPrice,
        cushionPct: feeCushionPct, currentPrice, priceChangePct: priceChange, rule: `beAtPct=${beAtPct}%`,
      });

      await this.sendSgEventAlert("SG_BREAK_EVEN_ACTIVATED", position, currentPrice, {
        stopPrice: breakEvenPrice,
        profitPct: priceChange,
        reason: `Profit +${beAtPct}% alcanzado, stop movido a break-even + comisiones`,
        takeProfitPrice: tpFixedEnabled ? position.entryPrice * (1 + tpFixedPct / 100) : undefined,
        trailingStatus: { active: false, startPct: trailStartPct, distancePct: trailDistancePct, stepPct: trailStepPct },
      });
    }

    // === RECOVERY: BE already activated in DB but notification was never delivered ===
    if (position.sgBreakEvenActivated && !this.sgAlertThrottle.has(`${lotId}:SG_BREAK_EVEN_ACTIVATED`)) {
      log(`[POSITION_ALERT] BE_RECOVERY ${pair} lotId=${lotId.substring(0, 12)}: sgBreakEvenActivated=true but no throttle entry — reenvio de notificacion perdida`, "trading");
      await this.sendSgEventAlert("SG_BREAK_EVEN_ACTIVATED", position, currentPrice, {
        stopPrice: position.sgCurrentStopPrice ?? breakEvenPrice,
        profitPct: priceChange,
        reason: `Break-even activo (stop @ $${(position.sgCurrentStopPrice ?? breakEvenPrice).toFixed(2)})`,
        takeProfitPrice: tpFixedEnabled ? position.entryPrice * (1 + tpFixedPct / 100) : undefined,
        trailingStatus: { active: position.sgTrailingActivated ?? false, startPct: trailStartPct, distancePct: trailDistancePct, stepPct: trailStepPct },
      });
    }

    // 4. TRAILING STOP ACTIVATION
    if (!position.sgTrailingActivated && priceChange >= trailStartPct) {
      position.sgTrailingActivated = true;
      const trailStopPrice = currentPrice * (1 - trailDistancePct / 100);
      if (!position.sgCurrentStopPrice || trailStopPrice > position.sgCurrentStopPrice) {
        position.sgCurrentStopPrice = trailStopPrice;
      }
      positionModified = true;
      log(`SMART_GUARD ${pair}: Trailing activado (+${priceChange.toFixed(2)}%), stop dinámico @ $${position.sgCurrentStopPrice!.toFixed(4)}`, "trading");

      await this.sendSgEventAlert("SG_TRAILING_ACTIVATED", position, currentPrice, {
        stopPrice: position.sgCurrentStopPrice,
        profitPct: priceChange,
        reason: `Profit +${trailStartPct}% alcanzado, trailing stop iniciado a ${trailDistancePct}% del máximo`,
        takeProfitPrice: tpFixedEnabled ? position.entryPrice * (1 + tpFixedPct / 100) : undefined,
        trailingStatus: { active: true, startPct: trailStartPct, distancePct: trailDistancePct, stepPct: trailStepPct },
      });
    }

    // === RECOVERY: Trailing already activated in DB but notification was never delivered ===
    if (position.sgTrailingActivated && !this.sgAlertThrottle.has(`${lotId}:SG_TRAILING_ACTIVATED`)) {
      log(`[POSITION_ALERT] TRAIL_RECOVERY ${pair} lotId=${lotId.substring(0, 12)}: sgTrailingActivated=true but no throttle entry — reenvio de notificacion perdida`, "trading");
      await this.sendSgEventAlert("SG_TRAILING_ACTIVATED", position, currentPrice, {
        stopPrice: position.sgCurrentStopPrice,
        profitPct: priceChange,
        reason: `Trailing activo (stop @ $${(position.sgCurrentStopPrice ?? 0).toFixed(2)})`,
        takeProfitPrice: tpFixedEnabled ? position.entryPrice * (1 + tpFixedPct / 100) : undefined,
        trailingStatus: { active: true, startPct: trailStartPct, distancePct: trailDistancePct, stepPct: trailStepPct },
      });
    }

    // 5. TRAILING STOP UPDATE
    if (position.sgTrailingActivated && position.sgCurrentStopPrice) {
      const newTrailStop = currentPrice * (1 - trailDistancePct / 100);
      const minStepPrice = position.sgCurrentStopPrice * (1 + trailStepPct / 100);

      if (newTrailStop > minStepPrice) {
        const oldStop = position.sgCurrentStopPrice;
        position.sgCurrentStopPrice = newTrailStop;
        positionModified = true;
        log(`SMART_GUARD ${pair}: Trailing step $${oldStop.toFixed(4)} → $${newTrailStop.toFixed(4)} (+${trailStepPct}%)`, "trading");
        await botLogger.info("TRAILING_UPDATED", `SMART_GUARD Trailing actualizado en ${pair}`, {
          posId: lotId, pair, prevStop: oldStop, newStop: newTrailStop,
          currentPrice, trailingPct: trailDistancePct, stepPct: trailStepPct, rule: `step=${trailStepPct}%`,
        });

        await this.sendSgEventAlert("SG_TRAILING_STOP_UPDATED", position, currentPrice, {
          stopPrice: newTrailStop,
          profitPct: priceChange,
          reason: `Stop actualizado: $${oldStop.toFixed(2)} → $${newTrailStop.toFixed(2)}`,
          takeProfitPrice: tpFixedEnabled ? position.entryPrice * (1 + tpFixedPct / 100) : undefined,
          trailingStatus: { active: true, startPct: trailStartPct, distancePct: trailDistancePct, stepPct: trailStepPct },
        }, this.SG_TRAIL_UPDATE_THROTTLE_MS);
      }
    }

    // 5b. PROGRESSIVE BREAK-EVEN FLOOR (ratchet stop upward with profit levels)
    // Pro standard (3Commas SL Breakeven): stop moves to last profit milestone reached
    if (position.sgBreakEvenActivated && priceChange > 0) {
      const fees = this.host.getTradingFees();
      const roundTripFeePct = fees.takerFeePct * 2;
      const profitBufferPct = 1.0;

      const progressiveResult = this.calculateProgressiveBEStop(
        position, currentPrice, priceChange, roundTripFeePct, profitBufferPct
      );

      if (progressiveResult.newStopPrice && progressiveResult.newLevel > (position.beProgressiveLevel ?? 0)) {
        const oldStop = position.sgCurrentStopPrice;
        const shouldUpdateStop = !position.sgCurrentStopPrice || progressiveResult.newStopPrice > position.sgCurrentStopPrice;
        const effectiveNewStop = shouldUpdateStop ? progressiveResult.newStopPrice : position.sgCurrentStopPrice!;

        // Always update level (milestone tracking), only update stop if it would be higher
        position.beProgressiveLevel = progressiveResult.newLevel;
        if (shouldUpdateStop) {
          position.sgCurrentStopPrice = progressiveResult.newStopPrice;
        }
        positionModified = true;

        const stopNote = shouldUpdateStop
          ? `stop $${oldStop?.toFixed(4) ?? 'N/A'} → $${progressiveResult.newStopPrice.toFixed(4)}`
          : `nivel actualizado (trailing stop $${effectiveNewStop.toFixed(4)} ya superior)`;
        log(`SMART_GUARD ${pair}: ${progressiveResult.reason} | ${stopNote}`, "trading");
        await botLogger.info("SG_PROGRESSIVE_BE", `SMART_GUARD Progressive BE en ${pair}`, {
          posId: lotId, pair, level: progressiveResult.newLevel, reason: progressiveResult.reason,
          prevStop: oldStop, newStop: effectiveNewStop, stopChanged: shouldUpdateStop,
          currentPrice, priceChangePct: priceChange,
        });

        await this.sendSgEventAlert("SG_TRAILING_STOP_UPDATED", position, currentPrice, {
          stopPrice: effectiveNewStop,
          profitPct: priceChange,
          reason: `🔒 ${progressiveResult.reason}`,
          takeProfitPrice: tpFixedEnabled ? position.entryPrice * (1 + tpFixedPct / 100) : undefined,
          trailingStatus: position.sgTrailingActivated ? {
            active: true, startPct: trailStartPct, distancePct: trailDistancePct, stepPct: trailStepPct,
          } : undefined,
        }, undefined, `SG_PROGRESSIVE_BE_L${progressiveResult.newLevel}`);
      }
    }

    // 6. CHECK IF STOP PRICE HIT
    if (position.sgCurrentStopPrice && currentPrice <= position.sgCurrentStopPrice) {
      const stopType = position.sgTrailingActivated ? "Trailing Stop" : "Break-even Stop";
      shouldSellFull = true;
      sellReason = `${stopType} SMART_GUARD ($${currentPrice.toFixed(2)} <= $${position.sgCurrentStopPrice.toFixed(2)}) [${paramsSource}]`;
      emoji = position.sgTrailingActivated ? "📉" : "⚖️";
      await botLogger.info("SG_STOP_HIT", `SMART_GUARD ${stopType} activado en ${pair}`, {
        pair, entryPrice: position.entryPrice, currentPrice, stopPrice: position.sgCurrentStopPrice,
        stopType, paramsSource,
      });
    }

    // 7. SCALE-OUT
    if (!shouldSellFull && scaleOutEnabled && !position.sgScaleOutDone) {
      const partValue = position.amount * currentPrice * (scaleOutPct / 100);
      const confPct = toConfidencePct(position.signalConfidence, 0);
      const thresholdPct = toConfidencePct(scaleOutThreshold, 80);
      if (confPct >= thresholdPct && partValue >= minPartUsd) {
        if (priceChange >= trailStartPct) {
          shouldScaleOut = true;
          sellReason = `Scale-out SMART_GUARD (${scaleOutPct}% @ +${priceChange.toFixed(2)}%, conf=${confPct.toFixed(0)}%) [${paramsSource}]`;
          emoji = "📊";
          position.sgScaleOutDone = true;
          positionModified = true;

          await this.sendSgEventAlert("SG_SCALE_OUT_EXECUTED", position, currentPrice, {
            stopPrice: position.sgCurrentStopPrice,
            profitPct: priceChange,
            reason: `Vendido ${scaleOutPct}% de posición ($${partValue.toFixed(2)}) a +${priceChange.toFixed(2)}%`,
            takeProfitPrice: tpFixedEnabled ? position.entryPrice * (1 + tpFixedPct / 100) : undefined,
            trailingStatus: position.sgTrailingActivated ? {
              active: true, startPct: trailStartPct, distancePct: trailDistancePct, stepPct: trailStepPct,
            } : undefined,
          });
        }
      }
    }

    // Save position changes (always persist modified state, even before a sell attempt)
    if (positionModified) {
      this.host.setPosition(lotId, position);
      await this.host.savePositionToDB(pair, position);
    }

    // Execute sell if needed (FASE 0 HOTFIX: all sells go through lock + circuit breaker)
    if (shouldSellFull || shouldScaleOut) {
      const minVolume = this.host.getOrderMin(pair);
      let sellAmount = shouldScaleOut
        ? position.amount * (scaleOutPct / 100)
        : position.amount;

      if (sellAmount < minVolume) {
        log(`SMART_GUARD: Cantidad a vender (${sellAmount}) menor al mínimo (${minVolume}) para ${pair} (${lotId})`, "trading");
        await botLogger.warn("EXIT_MIN_VOLUME_BLOCKED", `SMART_GUARD: Salida bloqueada por volumen mínimo en ${pair}`, {
          posId: lotId, pair, sellAmount, minVolume, currentPrice,
          sellAmountUsd: sellAmount * currentPrice, trigger: sellReason,
          action: "POSITION_LEFT_OPEN",
        });
        const telegram = this.host.getTelegramService();
        if (telegram.isInitialized()) {
          await telegram.sendAlertWithSubtype(
            `🤖 <b>KRAKEN BOT</b> 🇪🇸\n━━━━━━━━━━━━━━━━━━━\n` +
            `⚠️ <b>Salida bloqueada: volumen mínimo</b>\n\n` +
            `📦 Par: <code>${pair}</code> | Lot: <code>${lotId}</code>\n` +
            `🔢 Cantidad: <code>${sellAmount.toFixed(8)}</code> (mín: <code>${minVolume}</code>)\n` +
            `💵 Valor: <code>$${(sellAmount * currentPrice).toFixed(2)}</code>\n` +
            `⚡ Trigger: <code>${sellReason}</code>\n` +
            `⚠️ <b>POSICIÓN SIGUE ABIERTA — Revisar manualmente</b>\n` +
            `━━━━━━━━━━━━━━━━━━━`,
            "errors", "error_api"
          );
        }
        return;
      }

      // FASE 0 HOTFIX: Check exit lock + circuit breaker BEFORE any balance check or sell
      if (!this.checkCircuitBreaker(lotId)) {
        await botLogger.error("CIRCUIT_BREAKER_BLOCKED", `SMART_GUARD circuit breaker bloqueó SELL en ${pair}`, {
          pair, lotId, sellReason, sellAmount,
        });
        return;
      }
      if (!this.acquireExitLock(lotId)) {
        return;
      }
      this.recordSellAttempt(lotId);

      try {
        // Balance verification — only to detect orphan, NOT to increase sellAmount
        const freshBalances = await this.host.getTradingExchange().getBalance();
        const realAssetBalance = this.host.getAssetBalance(pair, freshBalances);

        if (realAssetBalance < sellAmount * 0.995) {
          if (realAssetBalance < minVolume) {
            log(`SMART_GUARD: Posición huérfana en ${pair} (${lotId}), eliminando`, "trading");
            this.host.deletePosition(lotId);
            await this.host.deletePositionFromDBByLotId(lotId);
            this.host.setPairCooldown(pair);
            return;
          }
          // FASE 0 HOTFIX: Adjust DOWN to real balance, but NEVER UP
          sellAmount = Math.min(sellAmount, realAssetBalance);
        }

        log(`${emoji} ${sellReason} para ${pair} (${lotId})`, "trading");
        await botLogger.info("EXIT_TRIGGERED", `SMART_GUARD salida disparada en ${pair}`, {
          posId: lotId, pair,
          trigger: shouldScaleOut ? "SCALE_OUT" : (position.sgTrailingActivated ? "TRAIL_HIT" : (position.sgBreakEvenActivated ? "BE_HIT" : "SL_HIT")),
          currentPrice, stopPrice: position.sgCurrentStopPrice ?? null, sellAmount,
          reason: sellReason, priceChangePct: priceChange,
        });

        // Calculate P&L before Telegram alert
        const sellValueGross = sellAmount * currentPrice;
        const sellFeeEstimated = sellValueGross * (getTakerFeePct() / 100);
        const entryValueGross = sellAmount * position.entryPrice;
        const entryFeeProrated = (position.entryFee || 0) * (sellAmount / (position.amount || 1));
        const pnl = sellValueGross - sellFeeEstimated - entryValueGross - entryFeeProrated;

        const sellContext = {
          entryPrice: position.entryPrice,
          entryFee: position.entryFee,
          sellAmount: sellAmount,
          positionAmount: position.amount,
          aiSampleId: position.aiSampleId,
          openedAt: position.openedAt
        };
        await botLogger.info("EXIT_ORDER_PLACED", `SMART_GUARD intentando orden SELL en ${pair}`, {
          posId: lotId, pair, orderType: "market", side: "sell", qty: sellAmount,
          price: currentPrice, exchange: this.host.getTradingExchangeType(),
          computedOrderUsd: sellAmount * currentPrice, trigger: sellReason,
        });

        // FASE 0 HOTFIX: Cap sell amount strictly to position.amount
        const cappedSellAmount = Math.min(sellAmount, position.amount);
        const success = await this.host.executeTrade(pair, "sell", cappedSellAmount.toFixed(8), currentPrice, sellReason, undefined, undefined, undefined, sellContext);

        if (!success) {
          await botLogger.error("EXIT_ORDER_FAILED", `SMART_GUARD FALLO de orden SELL en ${pair} — posición sigue abierta`, {
            posId: lotId, pair, orderType: "market", side: "sell", qty: cappedSellAmount,
            price: currentPrice, exchange: this.host.getTradingExchangeType(),
            computedOrderUsd: cappedSellAmount * currentPrice, trigger: sellReason,
            action: "POSITION_LEFT_OPEN",
          });
          const telegram = this.host.getTelegramService();
          if (telegram.isInitialized()) {
            await telegram.sendAlertWithSubtype(
              `🤖 <b>KRAKEN BOT</b> 🇪🇸\n━━━━━━━━━━━━━━━━━━━\n` +
              `🚨 <b>FALLO DE ORDEN DE SALIDA</b>\n\n` +
              `📦 Par: <code>${pair}</code> | Lot: <code>${lotId}</code>\n` +
              `💵 Precio: <code>$${currentPrice.toFixed(2)}</code> | Qty: <code>${cappedSellAmount.toFixed(8)}</code>\n` +
              `⚡ Trigger: <code>${sellReason}</code>\n` +
              `❌ La orden NO se ejecutó en el exchange\n` +
              `⚠️ <b>POSICIÓN SIGUE ABIERTA — Revisar manualmente</b>\n` +
              `━━━━━━━━━━━━━━━━━━━`,
              "errors", "error_api"
            );
          }
          return;
        }

        // FASE 0 HOTFIX: Determine correct exit subtype for Telegram
        const isTimeStop = sellReason.toLowerCase().includes("timestop");
        const isTrailingHit = position.sgTrailingActivated && sellReason.toLowerCase().includes("trailing");
        const isBEHit = position.sgBreakEvenActivated && sellReason.toLowerCase().includes("break-even");
        const telegramSubtype = isTimeStop ? "trade_timestop" as any
          : isTrailingHit ? "trade_trailing" as any
          : isBEHit ? "trade_breakeven" as any
          : "trade_sell" as any;

        const telegram = this.host.getTelegramService();
        if (telegram.isInitialized()) {
          const pnlEmoji = pnl >= 0 ? "📈" : "📉";
          const durationMs = position.openedAt ? Date.now() - position.openedAt : 0;
          const durationMins = Math.floor(durationMs / 60000);
          const durationHours = Math.floor(durationMins / 60);
          const durationDays = Math.floor(durationHours / 24);
          const durationTxt = durationDays > 0 ? `${durationDays}d ${durationHours % 24}h` : durationHours > 0 ? `${durationHours}h ${durationMins % 60}m` : `${durationMins}m`;
          await telegram.sendAlertWithSubtype(`🤖 <b>KRAKEN BOT</b> 🇪🇸
━━━━━━━━━━━━━━━━━━━
${emoji} <b>${sellReason}</b>

📦 <b>Detalles:</b>
   • Par: <code>${pair}</code>
   • Lot: <code>${lotId}</code>
   • Precio entrada: <code>$${position.entryPrice.toFixed(2)}</code>
   • Precio actual: <code>$${currentPrice.toFixed(2)}</code>
   • Cantidad vendida: <code>${cappedSellAmount.toFixed(8)}</code>
   • Duración: <code>${durationTxt}</code>

${pnlEmoji} <b>P&L:</b> <code>${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(2)}%)</code>

🔗 <a href="${environment.panelUrl}">Ver Panel</a>
━━━━━━━━━━━━━━━━━━━`, "trades", telegramSubtype);
        }

        // Reduce position amount by what was sold
        position.amount -= cappedSellAmount;

        const EPSILON = 1e-8;
        const positionIsEmpty = shouldSellFull || position.amount < EPSILON;

        if (positionIsEmpty) {
          this.host.deletePosition(lotId);
          await this.host.deletePositionFromDBByLotId(lotId);
          log(`SMART_GUARD ${pair} (${lotId}): Posición cerrada completamente`, "trading");
          await botLogger.info("POSITION_CLOSED_SG", `SMART_GUARD posición cerrada en ${pair}`, {
            posId: lotId, pair, closeReason: sellReason, avgPrice: currentPrice,
            pnlNet: pnl, priceChangePct: priceChange, exchange: this.host.getTradingExchangeType(),
          });
        } else {
          // Partial sell (scale-out)
          this.host.setPosition(lotId, position);
          await this.host.savePositionToDB(pair, position);
          log(`SMART_GUARD ${pair} (${lotId}): Venta parcial, restante: ${position.amount.toFixed(8)}`, "trading");
        }
        this.host.setLastTradeTime(pair, Date.now());
      } finally {
        // FASE 0 HOTFIX: Always release exit lock
        this.releaseExitLock(lotId);
      }
    }
  }
}
