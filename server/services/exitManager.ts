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

  constructor(host: IExitManagerHost) {
    this.host = host;
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

  // === TIME-STOP ===

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
  }> {
    const { lotId, openedAt, pair, entryPrice, timeStopDisabled } = position;
    const now = Date.now();
    const ageMs = now - openedAt;
    const ageHours = ageMs / (1000 * 60 * 60);
    const timeStopHours = exitConfig.timeStopHours;

    if (timeStopDisabled) {
      return {
        triggered: false,
        expired: false,
        shouldClose: false,
        reason: `[TIME_STOP_EXPIRED] pair=${pair} lotId=${lotId} ageHours=${ageHours.toFixed(1)} disabled=true`,
        ageHours,
      };
    }

    if (ageHours < timeStopHours) {
      return {
        triggered: false,
        expired: false,
        shouldClose: false,
        reason: "",
        ageHours,
      };
    }

    const priceChange = ((currentPrice - entryPrice) / entryPrice) * 100;
    const minCloseNetPct = this.calculateMinCloseNetPct(exitConfig.takerFeePct, exitConfig.takerFeePct, exitConfig.profitBufferPct);

    if (exitConfig.timeStopMode === "hard") {
      log(`[TIME_STOP_EXPIRED] pair=${pair} lotId=${lotId} ageHours=${ageHours.toFixed(1)} mode=hard FORCE_CLOSE`, "trading");

      if (this.host.getTelegramService().isInitialized()) {
        await this.host.getTelegramService().sendAlertWithSubtype(`🤖 <b>KRAKEN BOT</b> 🇪🇸
━━━━━━━━━━━━━━━━━━━
⏰ <b>Time-Stop HARD - Cierre Inmediato</b>

📦 <b>Detalles:</b>
   • Par: <code>${pair}</code>
   • Tiempo abierta: <code>${ageHours.toFixed(0)} horas</code>
   • Límite configurado: <code>${timeStopHours} horas</code>

📊 <b>Estado:</b>
   • Ganancia actual: <code>${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(2)}%</code>

⚡ <b>ACCIÓN:</b> La posición se cerrará INMEDIATAMENTE [modo HARD]
━━━━━━━━━━━━━━━━━━━`, "trades", "trade_timestop");
      }

      return {
        triggered: true,
        expired: true,
        shouldClose: true,
        reason: `Time-stop expirado (${ageHours.toFixed(0)}h >= ${timeStopHours}h) [modo HARD]`,
        ageHours,
      };
    }

    // SOFT MODE: Check if profit is sufficient to close
    if (priceChange >= minCloseNetPct) {
      log(`[TIME_STOP_EXPIRED] pair=${pair} lotId=${lotId} ageHours=${ageHours.toFixed(1)} mode=soft grossPnl=${priceChange.toFixed(2)} PROFIT_EXIT_OK`, "trading");
      return {
        triggered: true,
        expired: true,
        shouldClose: true,
        reason: `Time-stop expirado + profit suficiente (+${priceChange.toFixed(2)}% >= ${minCloseNetPct.toFixed(2)}%)`,
        ageHours,
      };
    }

    // SOFT MODE: No force close
    const lastNotify = this.timeStopNotified.get(lotId) || 0;
    const shouldNotify = now - lastNotify > this.TIME_STOP_NOTIFY_THROTTLE_MS;

    if (shouldNotify && !position.timeStopExpiredAt) {
      this.timeStopNotified.set(lotId, now);
      position.timeStopExpiredAt = now;
      this.host.setPosition(lotId, position);
      await this.host.savePositionToDB(pair, position);
      log(`[TIME_STOP_EXPIRED] pair=${pair} lotId=${lotId} ageHours=${ageHours.toFixed(1)} mode=soft grossPnl=${priceChange.toFixed(2)} WAITING_PROFIT_OR_MANUAL`, "trading");

      if (this.host.getTelegramService().isInitialized()) {
        await this.host.getTelegramService().sendAlertWithSubtype(`🤖 <b>KRAKEN BOT</b> 🇪🇸
━━━━━━━━━━━━━━━━━━━
⏰ <b>Time-Stop Alcanzado</b>

📦 <b>Detalles:</b>
   • Par: <code>${pair}</code>
   • Tiempo abierta: <code>${ageHours.toFixed(0)} horas</code>
   • Límite configurado: <code>${timeStopHours} horas</code>

📊 <b>Estado:</b>
   • Ganancia actual: <code>${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(2)}%</code>
   • Mínimo para cierre auto: <code>+${minCloseNetPct.toFixed(2)}%</code>

💡 Se cerrará automáticamente cuando supere +${minCloseNetPct.toFixed(2)}%
⚠️ <b>Puedes cerrarla manualmente si lo prefieres</b>
━━━━━━━━━━━━━━━━━━━`, "trades", "trade_timestop");
      }
    }

    return {
      triggered: true,
      expired: true,
      shouldClose: false,
      reason: `[TIME_STOP_EXPIRED] pair=${pair} lotId=${lotId} ageHours=${ageHours.toFixed(1)} mode=soft WAITING_PROFIT_OR_MANUAL`,
      ageHours,
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
      if (now - lastAlert < throttleMs) return false;
    } else if (lastAlert) {
      return false; // One-shot: already sent
    }
    this.sgAlertThrottle.set(key, now);
    return true;
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
    }
  ) {
    const { lotId, pair, entryPrice, openedAt } = position;
    const shortLotId = lotId.substring(0, 12);
    const envInfo = environment.getInfo();

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

    // Send Telegram notification with natural language + essential data
    const telegram = this.host.getTelegramService();
    const tgInitialized = telegram.isInitialized();
    log(`[SG_ALERT] ${eventType} ${pair} lotId=${shortLotId} tgInit=${tgInitialized} profit=${extra.profitPct.toFixed(2)}%`, "trading");
    if (tgInitialized) {
      const formatPrice = (price: number) => {
        if (price >= 100) return price.toFixed(2);
        if (price >= 1) return price.toFixed(4);
        return price.toFixed(6);
      };

      const assetName = pair.replace("/USD", "");
      const profitText = extra.profitPct >= 0 ? `+${extra.profitPct.toFixed(2)}%` : `${extra.profitPct.toFixed(2)}%`;

      let naturalMessage = "";

      switch (eventType) {
        case "SG_BREAK_EVEN_ACTIVATED":
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
          naturalMessage = `🔼 <b>Stop actualizado en ${assetName}</b>\n\n`;
          naturalMessage += `El precio sigue subiendo (${profitText}). Stop elevado para proteger más ganancias.\n\n`;
          naturalMessage += `📊 Actual: $${formatPrice(currentPrice)}\n`;
          if (extra.stopPrice) {
            naturalMessage += `📍 Nuevo stop: $${formatPrice(extra.stopPrice)}\n`;
          }
          naturalMessage += `🔗 Lote: <code>${shortLotId}</code>`;
          break;

        case "SG_SCALE_OUT_EXECUTED":
          naturalMessage = `📊 <b>Venta parcial en ${assetName}</b>\n\n`;
          naturalMessage += `He vendido parte de la posición para asegurar ganancias (${profitText}).\n\n`;
          naturalMessage += `📊 Entrada: $${formatPrice(entryPrice)} | Actual: $${formatPrice(currentPrice)}\n`;
          naturalMessage += `⏱️ Duración: ${durationTxt}\n`;
          naturalMessage += `🔗 Lote: <code>${shortLotId}</code>\n\n`;
          naturalMessage += `<i>El resto sigue abierto para capturar más subidas.</i>`;
          break;
      }

      try {
        await telegram.sendAlertToMultipleChats(naturalMessage, "trades");
        log(`[SG_ALERT] Telegram alert sent for ${eventType} ${pair}`, "trading");
      } catch (tgErr: any) {
        log(`[SG_ALERT_ERR] Failed to send Telegram alert for ${eventType} ${pair}: ${tgErr.message}`, "trading");
      }
    } else {
      log(`[SG_ALERT] Telegram NOT initialized - ${eventType} ${pair} alert LOST`, "trading");
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

      // VERIFICACIÓN DE BALANCE REAL
      const freshBalances = await this.host.getTradingExchange().getBalance();
      const realAssetBalance = this.host.getAssetBalance(pair, freshBalances);

      // Reconciliación hacia ARRIBA
      if (realAssetBalance > sellAmount * 1.005) {
        const extraAmount = realAssetBalance - sellAmount;
        const extraValueUsd = extraAmount * currentPrice;
        if (extraValueUsd <= DUST_THRESHOLD_USD) {
          log(`🔄 Discrepancia de balance (UP) en ${pair} (${lotId}): Registrado ${sellAmount}, Real ${realAssetBalance}`, "trading");
          position.amount = realAssetBalance;
          this.host.setPosition(lotId, position);
          await this.host.savePositionToDB(pair, position);
          await botLogger.info("POSITION_RECONCILED", `Posición reconciliada (UP) en ${pair}`, {
            pair, lotId, direction: "UP", registeredAmount: sellAmount,
            realBalance: realAssetBalance, extraValueUsd,
          });
        } else {
          log(`⚠️ Balance real mayor al registrado en ${pair} (${lotId}) pero parece HOLD externo (extra $${extraValueUsd.toFixed(2)}). Ignorando reconciliación UP.`, "trading");
        }
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

        // Si hay algo de balance pero menos del registrado, ajustar posición al real
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

      // Usar position.amount (puede haber sido ajustado al balance real)
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

          await telegram.sendAlertToMultipleChats(naturalMessage, "trades");
        }

        this.host.deletePosition(lotId);
        await this.host.deletePositionFromDBByLotId(lotId);
        this.host.setLastTradeTime(pair, Date.now());
        await botLogger.info("POSITION_CLOSED_SG", `Posición cerrada en ${pair}`, {
          posId: lotId, pair, closeReason: reason, avgPrice: currentPrice,
          pnlNet: pnl, priceChangePct: priceChange, exchange: this.host.getTradingExchangeType(),
        });
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

    // === TIME-STOP CHECK ===
    if (!position.timeStopDisabled) {
      const exitConfig = await this.getAdaptiveExitConfig();
      const now = Date.now();
      const ageMs = now - position.openedAt;
      const ageHours = ageMs / (1000 * 60 * 60);
      const timeStopHours = exitConfig.timeStopHours;

      if (ageHours >= timeStopHours) {
        // TIME-STOP HARD
        if (exitConfig.timeStopMode === "hard") {
          log(`[TIME_STOP_EXPIRED] pair=${pair} lotId=${lotId} ageHours=${ageHours.toFixed(1)} mode=hard SMART_GUARD FORCE_CLOSE`, "trading");

          const telegram = this.host.getTelegramService();
          if (telegram.isInitialized()) {
            await telegram.sendAlertWithSubtype(`🤖 <b>KRAKEN BOT</b> 🇪🇸
━━━━━━━━━━━━━━━━━━━
⏰ <b>Time-Stop HARD - Cierre Forzado</b>

📦 <b>Detalles:</b>
   • Par: <code>${pair}</code>
   • Modo: <code>SMART_GUARD</code>
   • Tiempo abierta: <code>${ageHours.toFixed(0)} horas</code>
   • Límite: <code>${timeStopHours} horas</code>

📊 <b>Estado:</b>
   • P&L actual: <code>${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(2)}%</code>

⚡ <b>ACCIÓN:</b> Cierre forzado por Time-Stop HARD
━━━━━━━━━━━━━━━━━━━`, "trades", "trade_timestop");
          }

          // Ejecutar cierre forzado
          const minVolume = this.host.getOrderMin(pair);
          if (position.amount >= minVolume) {
            const freshBalances = await this.host.getTradingExchange().getBalance();
            const realAssetBalance = this.host.getAssetBalance(pair, freshBalances);
            const sellAmount = Math.min(position.amount, realAssetBalance);

            if (sellAmount >= minVolume) {
              const sellContext = {
                entryPrice: position.entryPrice,
                entryFee: position.entryFee,
                sellAmount: sellAmount,
                positionAmount: position.amount,
                aiSampleId: position.aiSampleId,
                openedAt: position.openedAt
              };
              await this.host.executeTrade(pair, "sell", sellAmount.toFixed(8), currentPrice,
                `Time-Stop HARD (${ageHours.toFixed(0)}h >= ${timeStopHours}h) [SMART_GUARD]`,
                undefined, undefined, undefined, sellContext);
            }
          }
          return;
        }

        // TIME-STOP SOFT
        const lastNotify = this.timeStopNotified.get(lotId) || 0;
        const shouldNotify = now - lastNotify > this.TIME_STOP_NOTIFY_THROTTLE_MS;

        if (shouldNotify && !position.timeStopExpiredAt) {
          this.timeStopNotified.set(lotId, now);
          position.timeStopExpiredAt = now;
          this.host.setPosition(lotId, position);
          await this.host.savePositionToDB(pair, position);
          log(`[TIME_STOP_EXPIRED] pair=${pair} lotId=${lotId} ageHours=${ageHours.toFixed(1)} mode=soft SMART_GUARD ALERT_ONLY`, "trading");

          const telegram = this.host.getTelegramService();
          if (telegram.isInitialized()) {
            await telegram.sendAlertWithSubtype(`🤖 <b>KRAKEN BOT</b> 🇪🇸
━━━━━━━━━━━━━━━━━━━
⏰ <b>Time-Stop Alcanzado (SMART_GUARD)</b>

📦 <b>Detalles:</b>
   • Par: <code>${pair}</code>
   • Modo: <code>SMART_GUARD</code>
   • Tiempo abierta: <code>${ageHours.toFixed(0)} horas</code>
   • Límite: <code>${timeStopHours} horas</code>

📊 <b>Estado:</b>
   • P&L actual: <code>${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(2)}%</code>

💡 <b>SmartGuard sigue gestionando la posición</b>
⚠️ Puedes cerrarla manualmente si lo prefieres
━━━━━━━━━━━━━━━━━━━`, "trades", "trade_timestop");
          }
        }
        // En SOFT mode, continúa con la lógica de SmartGuard
      }
    }

    // Get snapshot params with defaults
    const beAtPct = snapshot.sgBeAtPct ?? 1.5;
    const feeCushionPct = snapshot.sgFeeCushionPct ?? 0.45;
    const trailStartPct = snapshot.sgTrailStartPct ?? 2.0;
    const trailDistancePct = snapshot.sgTrailDistancePct ?? 1.5;
    const trailStepPct = snapshot.sgTrailStepPct ?? 0.25;
    const tpFixedEnabled = snapshot.sgTpFixedEnabled ?? false;
    const tpFixedPct = snapshot.sgTpFixedPct ?? 10;
    const scaleOutEnabled = snapshot.sgScaleOutEnabled ?? false;
    const scaleOutPct = snapshot.sgScaleOutPct ?? 35;
    const minPartUsd = snapshot.sgMinPartUsd ?? 50;
    const scaleOutThreshold = snapshot.sgScaleOutThreshold ?? 80;

    const ultimateSL = snapshot.stopLossPercent;

    let shouldSellFull = false;
    let shouldScaleOut = false;
    let sellReason = "";
    let emoji = "";
    let positionModified = false;

    const breakEvenPrice = position.entryPrice * (1 + feeCushionPct / 100);

    // === EXIT_EVAL ===
    await botLogger.info("EXIT_EVAL", `SMART_GUARD evaluando posición ${pair}`, {
      posId: lotId, exchange: this.host.getTradingExchangeType(), pair,
      entryPrice: position.entryPrice, currentPrice, priceChangePct: priceChange,
      qty: position.amount,
      beArmed: position.sgBreakEvenActivated ?? false,
      trailingArmed: position.sgTrailingActivated ?? false,
      stopPrice: position.sgCurrentStopPrice ?? null,
      beAtPct, trailStartPct, trailDistancePct, ultimateSL,
    });

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

      if (this.shouldSendSgAlert(position.lotId, "SG_BREAK_EVEN_ACTIVATED")) {
        const takeProfitPrice = tpFixedEnabled
          ? position.entryPrice * (1 + tpFixedPct / 100)
          : undefined;
        await this.sendSgEventAlert("SG_BREAK_EVEN_ACTIVATED", position, currentPrice, {
          stopPrice: breakEvenPrice,
          profitPct: priceChange,
          reason: `Profit +${beAtPct}% alcanzado, stop movido a break-even + comisiones`,
          takeProfitPrice,
          trailingStatus: { active: false, startPct: trailStartPct, distancePct: trailDistancePct, stepPct: trailStepPct },
        });
      }
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

      if (this.shouldSendSgAlert(position.lotId, "SG_TRAILING_ACTIVATED")) {
        const takeProfitPrice = tpFixedEnabled
          ? position.entryPrice * (1 + tpFixedPct / 100)
          : undefined;
        await this.sendSgEventAlert("SG_TRAILING_ACTIVATED", position, currentPrice, {
          stopPrice: position.sgCurrentStopPrice,
          profitPct: priceChange,
          reason: `Profit +${trailStartPct}% alcanzado, trailing stop iniciado a ${trailDistancePct}% del máximo`,
          takeProfitPrice,
          trailingStatus: { active: true, startPct: trailStartPct, distancePct: trailDistancePct, stepPct: trailStepPct },
        });
      }
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

        if (this.shouldSendSgAlert(position.lotId, "SG_TRAILING_STOP_UPDATED", this.SG_TRAIL_UPDATE_THROTTLE_MS)) {
          const takeProfitPrice = tpFixedEnabled
            ? position.entryPrice * (1 + tpFixedPct / 100)
            : undefined;
          await this.sendSgEventAlert("SG_TRAILING_STOP_UPDATED", position, currentPrice, {
            stopPrice: newTrailStop,
            profitPct: priceChange,
            reason: `Stop actualizado: $${oldStop.toFixed(2)} → $${newTrailStop.toFixed(2)}`,
            takeProfitPrice,
            trailingStatus: { active: true, startPct: trailStartPct, distancePct: trailDistancePct, stepPct: trailStepPct },
          });
        }
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

          if (this.shouldSendSgAlert(position.lotId, "SG_SCALE_OUT_EXECUTED")) {
            const takeProfitPrice = tpFixedEnabled
              ? position.entryPrice * (1 + tpFixedPct / 100)
              : undefined;
            await this.sendSgEventAlert("SG_SCALE_OUT_EXECUTED", position, currentPrice, {
              stopPrice: position.sgCurrentStopPrice,
              profitPct: priceChange,
              reason: `Vendido ${scaleOutPct}% de posición ($${partValue.toFixed(2)}) a +${priceChange.toFixed(2)}%`,
              takeProfitPrice,
              trailingStatus: position.sgTrailingActivated ? {
                active: true, startPct: trailStartPct, distancePct: trailDistancePct, stepPct: trailStepPct,
              } : undefined,
            });
          }
        }
      }
    }

    // Save position changes (always persist modified state, even before a sell attempt)
    if (positionModified) {
      this.host.setPosition(lotId, position);
      await this.host.savePositionToDB(pair, position);
    }

    // Execute sell if needed
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

      // Balance verification
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
        sellAmount = realAssetBalance;
        position.amount = realAssetBalance;
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
      const entryFeeProrated = (position.entryFee || 0) * (sellAmount / position.amount);
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
      const success = await this.host.executeTrade(pair, "sell", sellAmount.toFixed(8), currentPrice, sellReason, undefined, undefined, undefined, sellContext);

      if (!success) {
        await botLogger.error("EXIT_ORDER_FAILED", `SMART_GUARD FALLO de orden SELL en ${pair} — posición sigue abierta`, {
          posId: lotId, pair, orderType: "market", side: "sell", qty: sellAmount,
          price: currentPrice, exchange: this.host.getTradingExchangeType(),
          computedOrderUsd: sellAmount * currentPrice, trigger: sellReason,
          action: "POSITION_LEFT_OPEN",
        });
        const telegram = this.host.getTelegramService();
        if (telegram.isInitialized()) {
          await telegram.sendAlertWithSubtype(
            `🤖 <b>KRAKEN BOT</b> 🇪🇸\n━━━━━━━━━━━━━━━━━━━\n` +
            `🚨 <b>FALLO DE ORDEN DE SALIDA</b>\n\n` +
            `📦 Par: <code>${pair}</code> | Lot: <code>${lotId}</code>\n` +
            `💵 Precio: <code>$${currentPrice.toFixed(2)}</code> | Qty: <code>${sellAmount.toFixed(8)}</code>\n` +
            `⚡ Trigger: <code>${sellReason}</code>\n` +
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
          const pnlEmoji = pnl >= 0 ? "📈" : "📉";
          const durationMs = position.openedAt ? Date.now() - position.openedAt : 0;
          const durationMins = Math.floor(durationMs / 60000);
          const durationHours = Math.floor(durationMins / 60);
          const durationDays = Math.floor(durationHours / 24);
          const durationTxt = durationDays > 0 ? `${durationDays}d ${durationHours % 24}h` : durationHours > 0 ? `${durationHours}h ${durationMins % 60}m` : `${durationMins}m`;
          await telegram.sendAlertToMultipleChats(`🤖 <b>KRAKEN BOT</b> 🇪🇸
━━━━━━━━━━━━━━━━━━━
${emoji} <b>${sellReason}</b>

📦 <b>Detalles:</b>
   • Par: <code>${pair}</code>
   • Lot: <code>${lotId}</code>
   • Precio entrada: <code>$${position.entryPrice.toFixed(2)}</code>
   • Precio actual: <code>$${currentPrice.toFixed(2)}</code>
   • Cantidad vendida: <code>${sellAmount.toFixed(8)}</code>
   • Duración: <code>${durationTxt}</code>

${pnlEmoji} <b>P&L:</b> <code>${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(2)}%)</code>

🔗 <a href="${environment.panelUrl}">Ver Panel</a>
━━━━━━━━━━━━━━━━━━━`, "trades");
        }

        // Reduce position amount by what was sold
        position.amount -= sellAmount;

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
      }
    }
  }
}
