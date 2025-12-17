import { KrakenService } from "./kraken";
import { TelegramService } from "./telegram";
import { botLogger } from "./botLogger";
import { storage } from "../storage";
import { log } from "../index";
import { aiService, AiFeatures } from "./aiService";

interface PriceData {
  price: number;
  timestamp: number;
  high: number;
  low: number;
  volume: number;
}

interface TradeSignal {
  action: "buy" | "sell" | "hold";
  pair: string;
  confidence: number;
  reason: string;
}

interface RiskConfig {
  maxTradeUSD: number;
}

const RISK_LEVELS: Record<string, RiskConfig> = {
  low: {
    maxTradeUSD: 20,
  },
  medium: {
    maxTradeUSD: 50,
  },
  high: {
    maxTradeUSD: 100,
  },
};

const KRAKEN_MINIMUMS: Record<string, number> = {
  "BTC/USD": 0.0001,
  "ETH/USD": 0.01,
  "SOL/USD": 0.1,
  "XRP/USD": 10,
  "TON/USD": 1,
  "ETH/BTC": 0.01,
};

const SMALL_ACCOUNT_FACTOR = 0.95;

// Kraken fee structure (taker fees for market orders)
const KRAKEN_FEE_PCT = 0.26; // 0.26% per trade
const ROUND_TRIP_FEE_PCT = KRAKEN_FEE_PCT * 2; // ~0.52% for buy + sell
const MIN_PROFIT_MULTIPLIER = 2; // Take-profit debe ser al menos 2x las fees

// Defensive improvements
const MAX_SPREAD_PCT = 0.5; // No comprar si spread > 0.5%
const TRADING_HOURS_START = 8; // UTC - inicio de horario de trading
const TRADING_HOURS_END = 22; // UTC - fin de horario de trading
const POST_STOPLOSS_COOLDOWN_MS = 30 * 60 * 1000; // 30 min cooldown tras stop-loss
const CONFIDENCE_SIZING_THRESHOLDS = {
  high: { min: 0.8, factor: 1.0 },    // 100% del monto
  medium: { min: 0.7, factor: 0.75 }, // 75% del monto
  low: { min: 0.6, factor: 0.5 },     // 50% del monto
};

interface ConfigSnapshot {
  stopLossPercent: number;
  takeProfitPercent: number;
  trailingStopEnabled: boolean;
  trailingStopPercent: number;
  positionMode: string;
}

interface OpenPosition {
  amount: number;
  entryPrice: number;
  highestPrice: number;
  openedAt: number;
  entryStrategyId: string;
  entrySignalTf: string;
  signalConfidence?: number;
  signalReason?: string;
  aiSampleId?: number;
  entryMode?: string;
  configSnapshot?: ConfigSnapshot;
}

interface CandleTrackingState {
  lastEvaluatedCandleTs: number;
  lastEvaluatedPair: string;
}

interface OHLCCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface MultiTimeframeData {
  tf5m: OHLCCandle[];
  tf1h: OHLCCandle[];
  tf4h: OHLCCandle[];
  lastUpdate: number;
}

interface TrendAnalysis {
  shortTerm: "bullish" | "bearish" | "neutral";
  mediumTerm: "bullish" | "bearish" | "neutral";
  longTerm: "bullish" | "bearish" | "neutral";
  alignment: number;
  confidence: number;
  summary: string;
}

export class TradingEngine {
  private krakenService: KrakenService;
  private telegramService: TelegramService;
  private isRunning: boolean = false;
  private intervalId: NodeJS.Timeout | null = null;
  private priceHistory: Map<string, PriceData[]> = new Map();
  private lastTradeTime: Map<string, number> = new Map();
  private openPositions: Map<string, OpenPosition> = new Map();
  private currentUsdBalance: number = 0;
  private mtfCache: Map<string, MultiTimeframeData> = new Map();
  private readonly PRICE_HISTORY_LENGTH = 50;
  private readonly MIN_TRADE_INTERVAL_MS = 60000;
  private readonly MTF_CACHE_TTL = 300000;
  
  private dailyPnL: number = 0;
  private dailyStartBalance: number = 0;
  private lastDayReset: string = "";
  private isDailyLimitReached: boolean = false;
  
  private pairCooldowns: Map<string, number> = new Map();
  private lastExposureAlert: Map<string, number> = new Map();
  private stopLossCooldowns: Map<string, number> = new Map();
  private spreadFilterEnabled: boolean = true;
  private readonly COOLDOWN_DURATION_MS = 15 * 60 * 1000;
  private readonly EXPOSURE_ALERT_INTERVAL_MS = 30 * 60 * 1000;
  
  // Tracking para Momentum (Velas) - última vela evaluada por par+timeframe
  private lastEvaluatedCandle: Map<string, number> = new Map();
  
  // Timeframe en segundos para calcular cierre de vela
  private readonly TIMEFRAME_SECONDS: Record<string, number> = {
    "5m": 5 * 60,
    "15m": 15 * 60,
    "1h": 60 * 60,
  };

  // Engine tick tracking (heartbeat cada 60s)
  private tickIntervalId: NodeJS.Timeout | null = null;
  private lastTickTime: number = 0;
  private lastScanTime: number = 0;
  private readonly TICK_INTERVAL_MS = 60 * 1000; // 60 seconds
  private lastScanResults: Map<string, { signal: string; reason: string; cooldownSec?: number; exposureAvailable?: number }> = new Map();

  constructor(krakenService: KrakenService, telegramService: TelegramService) {
    this.krakenService = krakenService;
    this.telegramService = telegramService;
  }

  private calculatePairExposure(pair: string): number {
    const position = this.openPositions.get(pair);
    if (!position) return 0;
    return position.amount * position.entryPrice;
  }

  private calculateTotalExposure(): number {
    let total = 0;
    this.openPositions.forEach((position) => {
      total += position.amount * position.entryPrice;
    });
    return total;
  }

  private getAvailableExposure(pair: string, config: any, freshUsdBalance?: number): { 
    maxPairAvailable: number; 
    maxTotalAvailable: number; 
    maxAllowed: number;
  } {
    const maxPairExposurePct = parseFloat(config.maxPairExposurePct?.toString() || "25");
    const maxTotalExposurePct = parseFloat(config.maxTotalExposurePct?.toString() || "60");

    const currentPairExposure = this.calculatePairExposure(pair);
    const currentTotalExposure = this.calculateTotalExposure();

    const usdBalance = freshUsdBalance ?? this.currentUsdBalance;
    const maxPairExposureUsd = usdBalance * (maxPairExposurePct / 100);
    const maxTotalExposureUsd = usdBalance * (maxTotalExposurePct / 100);

    const maxPairAvailable = Math.max(0, maxPairExposureUsd - currentPairExposure);
    const maxTotalAvailable = Math.max(0, maxTotalExposureUsd - currentTotalExposure);
    
    return {
      maxPairAvailable,
      maxTotalAvailable,
      maxAllowed: Math.min(maxPairAvailable, maxTotalAvailable)
    };
  }

  private isPairInCooldown(pair: string): boolean {
    const cooldownUntil = this.pairCooldowns.get(pair);
    if (!cooldownUntil) return false;
    
    if (Date.now() >= cooldownUntil) {
      this.pairCooldowns.delete(pair);
      return false;
    }
    return true;
  }

  private setPairCooldown(pair: string): void {
    const cooldownUntil = Date.now() + this.COOLDOWN_DURATION_MS;
    this.pairCooldowns.set(pair, cooldownUntil);
    log(`${pair} en cooldown por ${this.COOLDOWN_DURATION_MS / 60000} minutos`, "trading");
  }

  private shouldSendExposureAlert(pair: string): boolean {
    const lastAlert = this.lastExposureAlert.get(pair) || 0;
    if (Date.now() - lastAlert < this.EXPOSURE_ALERT_INTERVAL_MS) {
      return false;
    }
    this.lastExposureAlert.set(pair, Date.now());
    return true;
  }

  // === MEJORA 1: Filtro de Spread ===
  private calculateSpreadPct(bid: number, ask: number): number {
    if (bid <= 0 || ask <= 0) return 0;
    const midPrice = (bid + ask) / 2;
    return ((ask - bid) / midPrice) * 100;
  }

  private isSpreadAcceptable(tickerData: any): { acceptable: boolean; spreadPct: number } {
    if (!this.spreadFilterEnabled) {
      return { acceptable: true, spreadPct: 0 };
    }
    
    const bid = parseFloat(tickerData.b?.[0] || "0");
    const ask = parseFloat(tickerData.a?.[0] || "0");
    const spreadPct = this.calculateSpreadPct(bid, ask);
    
    return {
      acceptable: spreadPct <= MAX_SPREAD_PCT,
      spreadPct,
    };
  }

  // === MEJORA 2: Horarios de Trading ===
  private isWithinTradingHours(config: any): { withinHours: boolean; hourUTC: number; start: number; end: number } {
    const tradingHoursEnabled = config.tradingHoursEnabled ?? true;
    const start = parseInt(config.tradingHoursStart?.toString() || "8");
    const end = parseInt(config.tradingHoursEnd?.toString() || "22");
    
    if (!tradingHoursEnabled) {
      return { withinHours: true, hourUTC: new Date().getUTCHours(), start, end };
    }
    
    const now = new Date();
    const hourUTC = now.getUTCHours();
    
    return { withinHours: hourUTC >= start && hourUTC < end, hourUTC, start, end };
  }

  // === MEJORA 3: Position Sizing Dinámico ===
  private getConfidenceSizingFactor(confidence: number): number {
    if (confidence >= CONFIDENCE_SIZING_THRESHOLDS.high.min) {
      return CONFIDENCE_SIZING_THRESHOLDS.high.factor;
    } else if (confidence >= CONFIDENCE_SIZING_THRESHOLDS.medium.min) {
      return CONFIDENCE_SIZING_THRESHOLDS.medium.factor;
    } else if (confidence >= CONFIDENCE_SIZING_THRESHOLDS.low.min) {
      return CONFIDENCE_SIZING_THRESHOLDS.low.factor;
    }
    return 0; // No trade if confidence < 0.6
  }

  // === ENGINE TICK: Heartbeat cada 60s ===
  private async emitEngineTick(): Promise<void> {
    if (!this.isRunning) return;

    try {
      const config = await storage.getBotConfig();
      const now = Date.now();
      const loopLatencyMs = this.lastScanTime > 0 ? now - this.lastScanTime : 0;
      
      const openPositionsPairs = Array.from(this.openPositions.keys());
      
      await botLogger.info("ENGINE_TICK", "Motor activo - escaneo en curso", {
        activePairs: config?.activePairs || [],
        openPositionsCount: this.openPositions.size,
        openPositionsPairs,
        lastScanAt: this.lastScanTime > 0 ? new Date(this.lastScanTime).toISOString() : null,
        loopLatencyMs,
        balanceUsd: this.currentUsdBalance,
        isDailyLimitReached: this.isDailyLimitReached,
        dailyPnL: this.dailyPnL,
      });

      this.lastTickTime = now;

      // Emitir MARKET_SCAN_SUMMARY si hay resultados
      if (this.lastScanResults.size > 0) {
        const scanSummary: Record<string, any> = {};
        this.lastScanResults.forEach((result, pair) => {
          scanSummary[pair] = result;
        });

        await botLogger.info("MARKET_SCAN_SUMMARY", "Resumen de escaneo de mercado", {
          pairs: scanSummary,
          scanTime: new Date(this.lastScanTime).toISOString(),
        });
      }
    } catch (error: any) {
      log(`Error emitiendo ENGINE_TICK: ${error.message}`, "trading");
    }
  }

  // Helper to get cooldown remaining seconds
  private getCooldownRemainingSec(pair: string): number | undefined {
    const cooldownUntil = this.pairCooldowns.get(pair);
    if (!cooldownUntil) return undefined;
    const remaining = Math.max(0, Math.floor((cooldownUntil - Date.now()) / 1000));
    return remaining > 0 ? remaining : undefined;
  }

  private getStopLossCooldownRemainingSec(pair: string): number | undefined {
    const cooldownUntil = this.stopLossCooldowns.get(pair);
    if (!cooldownUntil) return undefined;
    const remaining = Math.max(0, Math.floor((cooldownUntil - Date.now()) / 1000));
    return remaining > 0 ? remaining : undefined;
  }

  // === MEJORA 4: Cooldown Post Stop-Loss ===
  private isPairInStopLossCooldown(pair: string): boolean {
    const cooldownUntil = this.stopLossCooldowns.get(pair);
    if (!cooldownUntil) return false;
    
    if (Date.now() >= cooldownUntil) {
      this.stopLossCooldowns.delete(pair);
      return false;
    }
    return true;
  }

  private setStopLossCooldown(pair: string): void {
    const cooldownUntil = Date.now() + POST_STOPLOSS_COOLDOWN_MS;
    this.stopLossCooldowns.set(pair, cooldownUntil);
    log(`${pair} en cooldown post-SL por ${POST_STOPLOSS_COOLDOWN_MS / 60000} minutos`, "trading");
  }

  private isProfitableAfterFees(takeProfitPct: number): { 
    isProfitable: boolean; 
    minProfitRequired: number; 
    roundTripFees: number;
    netExpectedProfit: number;
  } {
    const roundTripFees = ROUND_TRIP_FEE_PCT;
    const minProfitRequired = roundTripFees * MIN_PROFIT_MULTIPLIER;
    const netExpectedProfit = takeProfitPct - roundTripFees;
    
    return {
      isProfitable: takeProfitPct >= minProfitRequired,
      minProfitRequired,
      roundTripFees,
      netExpectedProfit,
    };
  }

  // === MOMENTUM (VELAS) - Helpers ===
  private getTimeframeIntervalMinutes(timeframe: string): number {
    switch (timeframe) {
      case "5m": return 5;
      case "15m": return 15;
      case "1h": return 60;
      default: return 5;
    }
  }

  private async getLastClosedCandle(pair: string, timeframe: string): Promise<OHLCCandle | null> {
    try {
      const intervalMinutes = this.getTimeframeIntervalMinutes(timeframe);
      const candles = await this.krakenService.getOHLC(pair, intervalMinutes);
      if (!candles || candles.length < 2) return null;
      return candles[candles.length - 2];
    } catch (error: any) {
      log(`Error obteniendo vela cerrada ${pair}/${timeframe}: ${error.message}`, "trading");
      return null;
    }
  }

  private isNewCandleClosed(pair: string, timeframe: string, candleTime: number): boolean {
    const key = `${pair}:${timeframe}`;
    const lastTs = this.lastEvaluatedCandle.get(key) || 0;
    if (candleTime > lastTs) {
      this.lastEvaluatedCandle.set(key, candleTime);
      return true;
    }
    return false;
  }

  private async analyzeWithCandleStrategy(
    pair: string,
    timeframe: string,
    candle: OHLCCandle
  ): Promise<TradeSignal> {
    const intervalMinutes = this.getTimeframeIntervalMinutes(timeframe);
    const candles = await this.krakenService.getOHLC(pair, intervalMinutes);
    if (!candles || candles.length < 20) {
      return { action: "hold", pair, confidence: 0, reason: "Datos insuficientes para análisis de velas" };
    }
    
    const closedCandles = candles.slice(0, -1);
    return this.momentumCandlesStrategy(pair, closedCandles, candle.close);
  }

  private momentumCandlesStrategy(pair: string, candles: OHLCCandle[], currentPrice: number): TradeSignal {
    if (candles.length < 20) {
      return { action: "hold", pair, confidence: 0, reason: "Historial de velas insuficiente" };
    }
    
    const closes = candles.map(c => c.close);
    const shortEMA = this.calculateEMA(closes.slice(-10), 10);
    const longEMA = this.calculateEMA(closes.slice(-20), 20);
    const rsi = this.calculateRSI(closes.slice(-14));
    const macd = this.calculateMACD(closes);
    const bollinger = this.calculateBollingerBands(closes);
    
    const lastCandle = candles[candles.length - 1];
    const prevCandle = candles[candles.length - 2];
    const isBullishCandle = lastCandle.close > lastCandle.open;
    const isBearishCandle = lastCandle.close < lastCandle.open;
    const candleBody = Math.abs(lastCandle.close - lastCandle.open);
    const candleRange = lastCandle.high - lastCandle.low;
    const bodyRatio = candleRange > 0 ? candleBody / candleRange : 0;
    
    const avgVolume = candles.slice(-10).reduce((sum, c) => sum + c.volume, 0) / 10;
    const volumeRatio = avgVolume > 0 ? lastCandle.volume / avgVolume : 1;
    const isHighVolume = volumeRatio > 1.5;
    
    let buySignals = 0;
    let sellSignals = 0;
    const reasons: string[] = [];

    if (shortEMA > longEMA) buySignals++;
    else if (shortEMA < longEMA) sellSignals++;

    if (rsi < 30) { buySignals += 2; reasons.push(`RSI sobrevendido (${rsi.toFixed(0)})`); }
    else if (rsi < 45) { buySignals++; }
    else if (rsi > 70) { sellSignals += 2; reasons.push(`RSI sobrecomprado (${rsi.toFixed(0)})`); }
    else if (rsi > 55) { sellSignals++; }

    if (macd.histogram > 0 && macd.macd > macd.signal) { buySignals++; reasons.push("MACD alcista"); }
    else if (macd.histogram < 0 && macd.macd < macd.signal) { sellSignals++; reasons.push("MACD bajista"); }

    if (bollinger.percentB < 20) { buySignals++; reasons.push("Precio en Bollinger inferior"); }
    else if (bollinger.percentB > 80) { sellSignals++; reasons.push("Precio en Bollinger superior"); }

    if (isBullishCandle && bodyRatio > 0.6) {
      buySignals++;
      reasons.push("Vela alcista fuerte");
    } else if (isBearishCandle && bodyRatio > 0.6) {
      sellSignals++;
      reasons.push("Vela bajista fuerte");
    }

    if (isHighVolume) {
      if (isBullishCandle) { buySignals++; reasons.push(`Volumen alto alcista (${volumeRatio.toFixed(1)}x)`); }
      else if (isBearishCandle) { sellSignals++; reasons.push(`Volumen alto bajista (${volumeRatio.toFixed(1)}x)`); }
    }

    if (isBullishCandle && prevCandle && prevCandle.close < prevCandle.open) {
      if (lastCandle.close > prevCandle.open) {
        buySignals++;
        reasons.push("Engulfing alcista");
      }
    }
    if (isBearishCandle && prevCandle && prevCandle.close > prevCandle.open) {
      if (lastCandle.close < prevCandle.open) {
        sellSignals++;
        reasons.push("Engulfing bajista");
      }
    }

    const confidence = Math.min(0.95, 0.5 + (Math.max(buySignals, sellSignals) * 0.07));
    
    if (buySignals >= 4 && buySignals > sellSignals && rsi < 70) {
      return {
        action: "buy",
        pair,
        confidence,
        reason: `Momentum Velas COMPRA: ${reasons.join(", ")} | Señales: ${buySignals}/${sellSignals}`,
      };
    }
    
    if (sellSignals >= 4 && sellSignals > buySignals && rsi > 30) {
      return {
        action: "sell",
        pair,
        confidence,
        reason: `Momentum Velas VENTA: ${reasons.join(", ")} | Señales: ${sellSignals}/${buySignals}`,
      };
    }

    return { action: "hold", pair, confidence: 0.3, reason: `Sin señal clara velas (${buySignals}/${sellSignals})` };
  }

  async start() {
    if (this.isRunning) return;
    
    const config = await storage.getBotConfig();
    if (!config?.isActive) {
      log("Bot no está activo, no se inicia el motor de trading", "trading");
      return;
    }

    if (!this.krakenService.isInitialized()) {
      log("Kraken no está configurado, no se puede iniciar el trading", "trading");
      return;
    }

    if (!this.telegramService.isInitialized()) {
      log("Telegram no está configurado, continuando sin notificaciones", "trading");
    }

    try {
      const balances = await this.krakenService.getBalance();
      this.currentUsdBalance = parseFloat(balances?.ZUSD || balances?.USD || "0");
      log(`Balance inicial USD: $${this.currentUsdBalance.toFixed(2)}`, "trading");
    } catch (error: any) {
      log(`Error obteniendo balance inicial: ${error.message}`, "trading");
      return;
    }

    this.isRunning = true;
    log("Motor de trading iniciado", "trading");
    
    await this.loadOpenPositionsFromDB();
    
    await botLogger.info("BOT_STARTED", "Motor de trading iniciado", {
      strategy: config.strategy,
      riskLevel: config.riskLevel,
      activePairs: config.activePairs,
      balanceUsd: this.currentUsdBalance,
      openPositions: this.openPositions.size,
    });
    
    if (this.telegramService.isInitialized()) {
      await this.telegramService.sendMessage(`🤖 *KrakenBot Iniciado*

El bot de trading autónomo está activo.
*Estrategia:* ${config.strategy}
*Nivel de riesgo:* ${config.riskLevel}
*Pares activos:* ${config.activePairs.join(", ")}
*Balance USD:* $${this.currentUsdBalance.toFixed(2)}`);
    }
    
    const intervalMs = this.getIntervalForStrategy(config.strategy);
    this.intervalId = setInterval(() => this.runTradingCycle(), intervalMs);
    
    // Iniciar tick interval para ENGINE_TICK cada 60s
    this.tickIntervalId = setInterval(() => this.emitEngineTick(), this.TICK_INTERVAL_MS);
    
    this.runTradingCycle();
  }

  async stop() {
    if (!this.isRunning) return;
    
    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.tickIntervalId) {
      clearInterval(this.tickIntervalId);
      this.tickIntervalId = null;
    }
    
    log("Motor de trading detenido", "trading");
    
    await botLogger.info("BOT_STOPPED", "Motor de trading detenido");
    
    if (this.telegramService.isInitialized()) {
      await this.telegramService.sendMessage("🛑 *KrakenBot Detenido*\n\nEl bot de trading ha sido desactivado.");
    }
  }

  private getIntervalForStrategy(strategy: string): number {
    switch (strategy) {
      case "scalping": return 10000;
      case "grid": return 15000;
      case "momentum": return 30000;
      case "mean_reversion": return 30000;
      default: return 30000;
    }
  }

  private async loadOpenPositionsFromDB() {
    try {
      const positions = await storage.getOpenPositions();
      this.openPositions.clear();
      
      for (const pos of positions) {
        this.openPositions.set(pos.pair, {
          amount: parseFloat(pos.amount),
          entryPrice: parseFloat(pos.entryPrice),
          highestPrice: parseFloat(pos.highestPrice),
          openedAt: new Date(pos.openedAt).getTime(),
          entryStrategyId: pos.entryStrategyId || "momentum_cycle",
          entrySignalTf: pos.entrySignalTf || "cycle",
          signalConfidence: pos.signalConfidence ? parseFloat(pos.signalConfidence) : undefined,
          signalReason: pos.signalReason || undefined,
        });
        log(`Posición recuperada: ${pos.pair} - ${pos.amount} @ $${pos.entryPrice} (${pos.entryStrategyId}/${pos.entrySignalTf})`, "trading");
      }
      
      if (positions.length > 0) {
        log(`${positions.length} posiciones abiertas cargadas desde la base de datos`, "trading");
        if (this.telegramService.isInitialized()) {
          const escapeMarkdown = (text: string) => text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
          const positionsList = positions.map(p => 
            `• ${p.pair}: ${p.amount} @ $${parseFloat(p.entryPrice).toFixed(2)} (${escapeMarkdown(p.entryStrategyId || '')})`
          ).join("\n");
          await this.telegramService.sendMessage(`📂 *Posiciones Abiertas*\n\n${positionsList}`);
        }
      }
    } catch (error: any) {
      log(`Error cargando posiciones: ${error.message}`, "trading");
    }
  }

  private async savePositionToDB(pair: string, position: OpenPosition) {
    try {
      await storage.saveOpenPosition({
        pair,
        entryPrice: position.entryPrice.toString(),
        amount: position.amount.toString(),
        highestPrice: position.highestPrice.toString(),
        entryStrategyId: position.entryStrategyId,
        entrySignalTf: position.entrySignalTf,
        signalConfidence: position.signalConfidence?.toString(),
        signalReason: position.signalReason,
      });
    } catch (error: any) {
      log(`Error guardando posición ${pair}: ${error.message}`, "trading");
    }
  }

  private async updatePositionHighestPrice(pair: string, highestPrice: number) {
    try {
      await storage.updateOpenPosition(pair, {
        highestPrice: highestPrice.toString(),
      });
    } catch (error: any) {
      log(`Error actualizando highestPrice ${pair}: ${error.message}`, "trading");
    }
  }

  private async deletePositionFromDB(pair: string) {
    try {
      await storage.deleteOpenPosition(pair);
    } catch (error: any) {
      log(`Error eliminando posición ${pair}: ${error.message}`, "trading");
    }
  }

  private async runTradingCycle() {
    try {
      const config = await storage.getBotConfig();
      if (!config?.isActive) {
        await this.stop();
        return;
      }

      // Actualizar tiempo de escaneo y limpiar resultados anteriores
      this.lastScanTime = Date.now();
      this.lastScanResults.clear();

      const balances = await this.krakenService.getBalance();
      this.currentUsdBalance = parseFloat(balances?.ZUSD || balances?.USD || "0");
      
      // Reset diario del P&L
      const today = new Date().toISOString().split("T")[0];
      if (this.lastDayReset !== today) {
        const previousDayPnL = this.dailyPnL;
        this.dailyPnL = 0;
        this.dailyStartBalance = this.currentUsdBalance;
        this.lastDayReset = today;
        this.isDailyLimitReached = false;
        log(`Nuevo día de trading: ${today}. Balance inicial: $${this.dailyStartBalance.toFixed(2)}`, "trading");
        
        await botLogger.info("DAILY_LIMIT_RESET", `Nuevo día de trading: ${today}`, {
          date: today,
          previousDayPnL,
          startBalance: this.dailyStartBalance,
        });
      }

      // Verificar límite de pérdida diaria
      const dailyLossLimitEnabled = config.dailyLossLimitEnabled ?? true;
      const dailyLossLimitPercent = parseFloat(config.dailyLossLimitPercent?.toString() || "10");
      
      if (dailyLossLimitEnabled && this.dailyStartBalance > 0) {
        const currentLossPercent = (this.dailyPnL / this.dailyStartBalance) * 100;
        
        if (currentLossPercent <= -dailyLossLimitPercent && !this.isDailyLimitReached) {
          this.isDailyLimitReached = true;
          log(`🛑 LÍMITE DE PÉRDIDA DIARIA ALCANZADO: ${currentLossPercent.toFixed(2)}% (límite: -${dailyLossLimitPercent}%)`, "trading");
          
          await botLogger.warn("DAILY_LIMIT_HIT", "Límite de pérdida diaria alcanzado. Bot pausado para nuevas compras.", {
            dailyPnL: this.dailyPnL,
            dailyPnLPercent: currentLossPercent,
            limitPercent: dailyLossLimitPercent,
            startBalance: this.dailyStartBalance,
          });
          
          if (this.telegramService.isInitialized()) {
            await this.telegramService.sendAlert(
              "Límite de Pérdida Diaria Alcanzado",
              `El bot ha pausado las operaciones de COMPRA.\n\n` +
              `📊 *P&L del día:* ${currentLossPercent.toFixed(2)}%\n` +
              `💰 *Pérdida:* $${Math.abs(this.dailyPnL).toFixed(2)}\n` +
              `⚙️ *Límite configurado:* -${dailyLossLimitPercent}%\n\n` +
              `_Las operaciones de cierre (Stop-Loss, Take-Profit) siguen activas._\n` +
              `_El trading normal se reanudará mañana automáticamente._`
            );
          }
        }
      }
      
      const riskConfig = RISK_LEVELS[config.riskLevel] || RISK_LEVELS.medium;

      const stopLossPercent = parseFloat(config.stopLossPercent?.toString() || "5");
      const takeProfitPercent = parseFloat(config.takeProfitPercent?.toString() || "7");
      const trailingStopEnabled = config.trailingStopEnabled ?? false;
      const trailingStopPercent = parseFloat(config.trailingStopPercent?.toString() || "2");

      // Stop-Loss y Take-Profit siempre se verifican (incluso con límite alcanzado)
      for (const pair of config.activePairs) {
        await this.checkStopLossTakeProfit(pair, stopLossPercent, takeProfitPercent, trailingStopEnabled, trailingStopPercent, balances);
      }

      // No abrir nuevas posiciones si se alcanzó el límite diario
      if (this.isDailyLimitReached) {
        return;
      }

      if (this.currentUsdBalance < 5) {
        log(`Saldo USD insuficiente: $${this.currentUsdBalance.toFixed(2)}`, "trading");
        return;
      }

      // MEJORA 2: Verificar horarios de trading
      const tradingHoursCheck = this.isWithinTradingHours(config);
      if (!tradingHoursCheck.withinHours) {
        log(`Fuera de horario de trading (${tradingHoursCheck.hourUTC}h UTC). Horario: ${tradingHoursCheck.start}h-${tradingHoursCheck.end}h UTC`, "trading");
        return;
      }

      const signalTimeframe = config.signalTimeframe || "cycle";
      const isCandleMode = signalTimeframe !== "cycle" && config.strategy === "momentum";

      for (const pair of config.activePairs) {
        if (isCandleMode) {
          const candle = await this.getLastClosedCandle(pair, signalTimeframe);
          if (!candle) continue;
          
          if (this.isNewCandleClosed(pair, signalTimeframe, candle.time)) {
            log(`Nueva vela cerrada ${pair}/${signalTimeframe} @ ${new Date(candle.time * 1000).toISOString()}`, "trading");
            await this.analyzePairAndTradeWithCandles(pair, signalTimeframe, candle, riskConfig, balances);
          }
        } else {
          await this.analyzePairAndTrade(pair, config.strategy, riskConfig, balances);
        }
      }
    } catch (error: any) {
      log(`Error en ciclo de trading: ${error.message}`, "trading");
    }
  }

  private async checkStopLossTakeProfit(
    pair: string,
    stopLossPercent: number,
    takeProfitPercent: number,
    trailingStopEnabled: boolean,
    trailingStopPercent: number,
    balances: any
  ) {
    const position = this.openPositions.get(pair);
    if (!position || position.amount <= 0) return;

    try {
      const krakenPair = this.formatKrakenPair(pair);
      const ticker = await this.krakenService.getTicker(krakenPair);
      const tickerData: any = Object.values(ticker)[0];
      if (!tickerData) return;

      const currentPrice = parseFloat(tickerData.c?.[0] || "0");
      const priceChange = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;

      if (currentPrice > position.highestPrice) {
        position.highestPrice = currentPrice;
        this.openPositions.set(pair, position);
        await this.updatePositionHighestPrice(pair, currentPrice);
      }

      let shouldSell = false;
      let reason = "";
      let emoji = "";

      if (priceChange <= -stopLossPercent) {
        shouldSell = true;
        reason = `Stop-Loss activado (${priceChange.toFixed(2)}% < -${stopLossPercent}%)`;
        emoji = "🛑";
        // MEJORA 4: Cooldown post stop-loss
        this.setStopLossCooldown(pair);
        await botLogger.warn("STOP_LOSS_HIT", `Stop-Loss activado en ${pair}`, {
          pair,
          entryPrice: position.entryPrice,
          currentPrice,
          priceChange,
          stopLossPercent,
          cooldownMinutes: POST_STOPLOSS_COOLDOWN_MS / 60000,
        });
      }
      else if (priceChange >= takeProfitPercent) {
        shouldSell = true;
        reason = `Take-Profit activado (${priceChange.toFixed(2)}% > ${takeProfitPercent}%)`;
        emoji = "🎯";
        await botLogger.info("TAKE_PROFIT_HIT", `Take-Profit alcanzado en ${pair}`, {
          pair,
          entryPrice: position.entryPrice,
          currentPrice,
          priceChange,
          takeProfitPercent,
        });
      }
      else if (trailingStopEnabled && position.highestPrice > position.entryPrice) {
        const dropFromHigh = ((position.highestPrice - currentPrice) / position.highestPrice) * 100;
        if (dropFromHigh >= trailingStopPercent && priceChange > 0) {
          shouldSell = true;
          reason = `Trailing Stop activado (cayó ${dropFromHigh.toFixed(2)}% desde máximo $${position.highestPrice.toFixed(2)})`;
          emoji = "📉";
          await botLogger.info("TRAILING_STOP_HIT", `Trailing Stop activado en ${pair}`, {
            pair,
            entryPrice: position.entryPrice,
            highestPrice: position.highestPrice,
            currentPrice,
            dropFromHigh,
            trailingStopPercent,
          });
        }
      }

      if (shouldSell) {
        const minVolume = KRAKEN_MINIMUMS[pair] || 0.01;
        const sellAmount = position.amount;

        if (sellAmount < minVolume) {
          log(`Cantidad a vender (${sellAmount}) menor al mínimo de Kraken (${minVolume}) para ${pair}`, "trading");
          return;
        }

        // VERIFICACIÓN DE BALANCE REAL: Evitar "EOrder:Insufficient funds"
        const freshBalances = await this.krakenService.getBalance();
        const realAssetBalance = this.getAssetBalance(pair, freshBalances);
        
        // Si el balance real es menor al 99.5% del esperado (tolerancia para fees ~0.26%)
        if (realAssetBalance < sellAmount * 0.995) {
          log(`⚠️ Discrepancia de balance en ${pair}: Registrado ${sellAmount}, Real ${realAssetBalance}`, "trading");
          
          // Si balance real es prácticamente cero (< mínimo de Kraken), eliminar posición
          if (realAssetBalance < minVolume) {
            log(`Posición huérfana eliminada en ${pair}: balance real (${realAssetBalance}) < mínimo (${minVolume})`, "trading");
            
            // NO modificar dailyPnL: si fue vendida manualmente, el usuario ya tiene el USD
            // Pero SÍ debemos reconciliar exposure y cooldowns
            
            // Refrescar balance USD para tener métricas consistentes
            this.currentUsdBalance = parseFloat(freshBalances?.ZUSD || freshBalances?.USD || "0");
            
            this.openPositions.delete(pair);
            await this.deletePositionFromDB(pair);
            
            // Limpiar cooldowns obsoletos y establecer uno nuevo (15 min)
            this.stopLossCooldowns.delete(pair);
            this.lastExposureAlert.delete(pair);
            this.setPairCooldown(pair); // Cooldown estándar de 15 minutos
            this.lastTradeTime.set(pair, Date.now());
            
            if (this.telegramService.isInitialized()) {
              await this.telegramService.sendMessage(`
🔄 *Posición Huérfana Eliminada*

*Par:* ${pair}
*Registrada:* ${sellAmount.toFixed(8)}
*Real en Kraken:* ${realAssetBalance.toFixed(8)}

_La posición no existe en Kraken y fue eliminada._
              `.trim());
            }
            
            await botLogger.warn("ORPHAN_POSITION_CLEANED", `Posición huérfana eliminada en ${pair}`, {
              pair,
              registeredAmount: sellAmount,
              realBalance: realAssetBalance,
              newUsdBalance: this.currentUsdBalance,
            });
            return;
          }
          
          // Si hay algo de balance pero menos del registrado, ajustar posición al real
          log(`Ajustando posición ${pair} de ${sellAmount} a ${realAssetBalance}`, "trading");
          position.amount = realAssetBalance;
          this.openPositions.set(pair, position);
          await this.savePositionToDB(pair, position);
          
          // Notificar ajuste
          if (this.telegramService.isInitialized()) {
            await this.telegramService.sendMessage(`
🔧 *Posición Ajustada*

*Par:* ${pair}
*Cantidad anterior:* ${sellAmount.toFixed(8)}
*Cantidad real:* ${realAssetBalance.toFixed(8)}

_Se usará la cantidad real para la venta._
            `.trim());
          }
          
          // Continuar con la venta usando el balance real
        }

        log(`${emoji} ${reason} para ${pair}`, "trading");

        // Usar position.amount (puede haber sido ajustado al balance real)
        const actualSellAmount = position.amount;
        const pnl = (currentPrice - position.entryPrice) * actualSellAmount;
        const pnlPercent = priceChange;

        const success = await this.executeTrade(pair, "sell", actualSellAmount.toFixed(8), currentPrice, reason);
        
        if (success && this.telegramService.isInitialized()) {
          const pnlEmoji = pnl >= 0 ? "💰" : "📉";
          await this.telegramService.sendAlertToMultipleChats(`
${emoji} *${reason}*

*Par:* ${pair}
*Precio entrada:* $${position.entryPrice.toFixed(2)}
*Precio actual:* $${currentPrice.toFixed(2)}
*Cantidad vendida:* ${actualSellAmount.toFixed(8)}

${pnlEmoji} *P&L:* ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%)
          `.trim(), "trades");
        }

        if (success) {
          this.openPositions.delete(pair);
          await this.deletePositionFromDB(pair);
          this.lastTradeTime.set(pair, Date.now());
        }
      }
    } catch (error: any) {
      log(`Error verificando SL/TP para ${pair}: ${error.message}`, "trading");
    }
  }

  private async analyzePairAndTrade(
    pair: string,
    strategy: string,
    riskConfig: RiskConfig,
    balances: any
  ) {
    try {
      const lastTrade = this.lastTradeTime.get(pair) || 0;
      if (Date.now() - lastTrade < this.MIN_TRADE_INTERVAL_MS) {
        return;
      }

      const krakenPair = this.formatKrakenPair(pair);
      const ticker = await this.krakenService.getTicker(krakenPair);
      const tickerData: any = Object.values(ticker)[0];
      
      if (!tickerData) return;

      const currentPrice = parseFloat(tickerData.c?.[0] || "0");
      const high24h = parseFloat(tickerData.h?.[1] || tickerData.h?.[0] || "0");
      const low24h = parseFloat(tickerData.l?.[1] || tickerData.l?.[0] || "0");
      const volume = parseFloat(tickerData.v?.[1] || tickerData.v?.[0] || "0");

      this.updatePriceHistory(pair, {
        price: currentPrice,
        timestamp: Date.now(),
        high: high24h,
        low: low24h,
        volume,
      });

      const history = this.priceHistory.get(pair) || [];
      if (history.length < 5) return;

      const signal = await this.analyzeWithStrategy(strategy, pair, history, currentPrice);
      
      // Registrar resultado del escaneo
      const signalStr = signal.action === "hold" ? "NONE" : signal.action.toUpperCase();
      const botConfigForScan = await storage.getBotConfig();
      const exposure = this.getAvailableExposure(pair, botConfigForScan, this.currentUsdBalance);
      this.lastScanResults.set(pair, {
        signal: signalStr,
        reason: signal.reason || "Sin señal",
        cooldownSec: this.getCooldownRemainingSec(pair),
        exposureAvailable: exposure.maxAllowed,
      });
      
      if (signal.action === "hold" || signal.confidence < 0.6) {
        return;
      }

      const assetBalance = this.getAssetBalance(pair, balances);
      const existingPosition = this.openPositions.get(pair);

      if (signal.action === "buy") {
        if (this.isPairInCooldown(pair)) {
          const cooldownSec = this.getCooldownRemainingSec(pair);
          await botLogger.info("TRADE_SKIPPED", `Señal BUY ignorada - par en cooldown`, {
            pair,
            signal: "BUY",
            reason: "PAIR_COOLDOWN",
            cooldownRemainingSec: cooldownSec,
            signalReason: signal.reason,
          });
          return;
        }

        // MODO SINGLE: Bloquear compras si ya hay posición abierta
        const botConfigCheck = await storage.getBotConfig();
        const positionMode = botConfigCheck?.positionMode || "SINGLE";
        if (positionMode === "SINGLE" && existingPosition && existingPosition.amount > 0) {
          log(`${pair}: Compra bloqueada - Modo SINGLE activo y ya hay posición abierta (${existingPosition.amount.toFixed(6)})`, "trading");
          await botLogger.info("TRADE_SKIPPED", `Señal BUY ignorada - modo SINGLE con posición abierta`, {
            pair,
            signal: "BUY",
            reason: "SINGLE_MODE_POSITION_EXISTS",
            existingAmount: existingPosition.amount,
            signalReason: signal.reason,
          });
          return;
        }

        // MEJORA 4: Verificar cooldown post stop-loss
        if (this.isPairInStopLossCooldown(pair)) {
          const cooldownSec = this.getStopLossCooldownRemainingSec(pair);
          log(`${pair}: En cooldown post stop-loss`, "trading");
          await botLogger.info("TRADE_SKIPPED", `Señal BUY ignorada - cooldown post stop-loss`, {
            pair,
            signal: "BUY",
            reason: "STOPLOSS_COOLDOWN",
            cooldownRemainingSec: cooldownSec,
            signalReason: signal.reason,
          });
          return;
        }

        // MEJORA 1: Verificar spread antes de comprar
        const spreadCheck = this.isSpreadAcceptable(tickerData);
        if (!spreadCheck.acceptable) {
          log(`${pair}: Spread demasiado alto (${spreadCheck.spreadPct.toFixed(3)}% > ${MAX_SPREAD_PCT}%)`, "trading");
          await botLogger.info("TRADE_SKIPPED", `Señal BUY ignorada - spread alto`, {
            pair,
            signal: "BUY",
            reason: "SPREAD_TOO_HIGH",
            spreadPct: spreadCheck.spreadPct,
            maxSpreadPct: MAX_SPREAD_PCT,
            signalReason: signal.reason,
          });
          return;
        }

        if (existingPosition && existingPosition.amount * currentPrice > riskConfig.maxTradeUSD * 2) {
          log(`Posición existente en ${pair} ya es grande: $${(existingPosition.amount * currentPrice).toFixed(2)}`, "trading");
          await botLogger.info("TRADE_SKIPPED", `Señal BUY ignorada - posición existente demasiado grande`, {
            pair,
            signal: "BUY",
            reason: "POSITION_TOO_LARGE",
            currentPositionUsd: existingPosition.amount * currentPrice,
            maxTradeUsd: riskConfig.maxTradeUSD * 2,
          });
          return;
        }

        const minVolume = KRAKEN_MINIMUMS[pair] || 0.01;
        const minRequiredUSD = minVolume * currentPrice;
        const freshUsdBalance = parseFloat(balances?.ZUSD || balances?.USD || "0");

        if (freshUsdBalance < minRequiredUSD) {
          log(`Saldo USD insuficiente para ${pair}: $${freshUsdBalance.toFixed(2)} < $${minRequiredUSD.toFixed(2)}`, "trading");
          await botLogger.info("TRADE_SKIPPED", `Señal BUY ignorada - fondos insuficientes`, {
            pair,
            signal: "BUY",
            reason: "INSUFFICIENT_FUNDS",
            availableUsd: freshUsdBalance,
            minRequiredUsd: minRequiredUSD,
          });
          this.setPairCooldown(pair);
          return;
        }

        const botConfig = await storage.getBotConfig();
        const riskPerTradePct = parseFloat(botConfig?.riskPerTradePct?.toString() || "15");
        const takeProfitPct = parseFloat(botConfig?.takeProfitPercent?.toString() || "7");
        
        // Verificar que el take-profit sea rentable después de comisiones
        const profitCheck = this.isProfitableAfterFees(takeProfitPct);
        if (!profitCheck.isProfitable) {
          log(`${pair}: Trade rechazado - Take-Profit (${takeProfitPct}%) < mínimo rentable (${profitCheck.minProfitRequired.toFixed(2)}%). Fees round-trip: ${profitCheck.roundTripFees.toFixed(2)}%`, "trading");
          
          await botLogger.info("TRADE_SKIPPED", `Señal BUY ignorada - take-profit menor que fees`, {
            pair,
            signal: "BUY",
            reason: "LOW_PROFITABILITY",
            takeProfitPct,
            roundTripFees: profitCheck.roundTripFees,
            minProfitRequired: profitCheck.minProfitRequired,
            netExpectedProfit: profitCheck.netExpectedProfit,
          });
          
          return;
        }
        
        let tradeAmountUSD = freshUsdBalance * (riskPerTradePct / 100);
        tradeAmountUSD = Math.min(tradeAmountUSD, riskConfig.maxTradeUSD);

        // MEJORA 3: Position sizing dinámico basado en confianza
        const confidenceFactor = this.getConfidenceSizingFactor(signal.confidence);
        const originalBeforeConfidence = tradeAmountUSD;
        tradeAmountUSD = tradeAmountUSD * confidenceFactor;
        
        if (confidenceFactor < 1.0) {
          log(`${pair}: Sizing ajustado por confianza (${(signal.confidence * 100).toFixed(0)}%): $${originalBeforeConfidence.toFixed(2)} -> $${tradeAmountUSD.toFixed(2)} (${(confidenceFactor * 100).toFixed(0)}%)`, "trading");
        }

        if (tradeAmountUSD < minRequiredUSD && freshUsdBalance >= minRequiredUSD) {
          const smallAccountAmount = freshUsdBalance * SMALL_ACCOUNT_FACTOR;
          tradeAmountUSD = Math.min(smallAccountAmount, riskConfig.maxTradeUSD);
        }

        const exposure = this.getAvailableExposure(pair, botConfig, freshUsdBalance);
        const maxByBalance = Math.max(0, freshUsdBalance * 0.95);
        const effectiveMaxAllowed = Math.min(exposure.maxAllowed, maxByBalance);
        
        if (effectiveMaxAllowed < minRequiredUSD) {
          log(`${pair}: Sin exposición disponible. Disponible: $${effectiveMaxAllowed.toFixed(2)}, Mínimo: $${minRequiredUSD.toFixed(2)}`, "trading");
          await botLogger.info("TRADE_SKIPPED", `Señal BUY ignorada - sin exposición disponible`, {
            pair,
            signal: "BUY",
            reason: "EXPOSURE_ZERO",
            exposureAvailable: effectiveMaxAllowed,
            minRequiredUsd: minRequiredUSD,
          });
          this.setPairCooldown(pair);
          
          if (this.shouldSendExposureAlert(pair)) {
            await botLogger.info("PAIR_COOLDOWN", `${pair} en cooldown - sin exposición disponible`, {
              pair,
              maxAllowed: effectiveMaxAllowed,
              minRequired: minRequiredUSD,
              cooldownMinutes: this.COOLDOWN_DURATION_MS / 60000,
            });

            if (this.telegramService.isInitialized()) {
              await this.telegramService.sendAlertToMultipleChats(`
⏸️ *Par en Espera*

*${pair}* sin exposición disponible.
*Disponible:* $${exposure.maxAllowed.toFixed(2)}
*Mínimo requerido:* $${minRequiredUSD.toFixed(2)}

_Cooldown: ${this.COOLDOWN_DURATION_MS / 60000} min. Se reintentará automáticamente._
              `.trim(), "system");
            }
          }
          return;
        }

        let wasAdjusted = false;
        let originalAmount = tradeAmountUSD;
        
        if (tradeAmountUSD > effectiveMaxAllowed) {
          originalAmount = tradeAmountUSD;
          tradeAmountUSD = effectiveMaxAllowed;
          wasAdjusted = true;
          
          log(`${pair}: Trade ajustado de $${originalAmount.toFixed(2)} a $${tradeAmountUSD.toFixed(2)} (límite exposición)`, "trading");
          
          await botLogger.info("TRADE_ADJUSTED", `Trade ajustado por límite de exposición`, {
            pair,
            originalAmountUsd: originalAmount,
            adjustedAmountUsd: tradeAmountUSD,
            maxPairAvailable: exposure.maxPairAvailable,
            maxTotalAvailable: exposure.maxTotalAvailable,
            riskPerTradePct,
          });
        }

        const tradeVolume = tradeAmountUSD / currentPrice;

        if (tradeVolume < minVolume) {
          log(`${pair}: Volumen ${tradeVolume.toFixed(8)} < mínimo ${minVolume}`, "trading");
          await botLogger.info("TRADE_SKIPPED", `Señal BUY ignorada - volumen < mínimo`, {
            pair,
            signal: "BUY",
            reason: "VOLUME_BELOW_MINIMUM",
            calculatedVolume: tradeVolume,
            minVolume,
          });
          this.setPairCooldown(pair);
          return;
        }

        if (wasAdjusted) {
          log(`${pair}: Ejecutando compra AJUSTADA $${tradeAmountUSD.toFixed(2)} (original: $${originalAmount.toFixed(2)})`, "trading");
        } else {
          log(`${pair}: Ejecutando compra $${tradeAmountUSD.toFixed(2)} (${riskPerTradePct}% de $${freshUsdBalance.toFixed(2)})`, "trading");
        }

        const adjustmentInfo = wasAdjusted ? {
          wasAdjusted: true,
          originalAmountUsd: originalAmount,
          adjustedAmountUsd: tradeAmountUSD
        } : undefined;

        const success = await this.executeTrade(pair, "buy", tradeVolume.toFixed(8), currentPrice, signal.reason, adjustmentInfo);
        if (success) {
          this.lastTradeTime.set(pair, Date.now());
        }

      } else if (signal.action === "sell") {
        if (assetBalance <= 0 && (!existingPosition || existingPosition.amount <= 0)) {
          await botLogger.info("TRADE_SKIPPED", `Señal SELL ignorada - sin posición para vender`, {
            pair,
            signal: "SELL",
            reason: "NO_POSITION",
            assetBalance,
            signalReason: signal.reason,
          });
          return;
        }

        const availableToSell = existingPosition?.amount || assetBalance;
        const sellVolume = Math.min(availableToSell, availableToSell * 0.5);
        const minVolumeSell = KRAKEN_MINIMUMS[pair] || 0.01;

        if (sellVolume < minVolumeSell) {
          await botLogger.info("TRADE_SKIPPED", `Señal SELL ignorada - volumen < mínimo`, {
            pair,
            signal: "SELL",
            reason: "VOLUME_BELOW_MINIMUM",
            calculatedVolume: sellVolume,
            minVolume: minVolumeSell,
          });
          return;
        }

        const success = await this.executeTrade(pair, "sell", sellVolume.toFixed(8), currentPrice, signal.reason);
        if (success) {
          this.lastTradeTime.set(pair, Date.now());
        }
      }
    } catch (error: any) {
      log(`Error analizando ${pair}: ${error.message}`, "trading");
    }
  }

  private async analyzePairAndTradeWithCandles(
    pair: string,
    timeframe: string,
    candle: OHLCCandle,
    riskConfig: RiskConfig,
    balances: any
  ) {
    try {
      const lastTrade = this.lastTradeTime.get(pair) || 0;
      if (Date.now() - lastTrade < this.MIN_TRADE_INTERVAL_MS) {
        return;
      }

      const signal = await this.analyzeWithCandleStrategy(pair, timeframe, candle);
      const strategyId = `momentum_candles_${timeframe}`;
      
      // Registrar resultado del escaneo para candles
      const signalStr = signal.action === "hold" ? "NONE" : signal.action.toUpperCase();
      const botConfigForScan = await storage.getBotConfig();
      const exposureScan = this.getAvailableExposure(pair, botConfigForScan, this.currentUsdBalance);
      this.lastScanResults.set(pair, {
        signal: signalStr,
        reason: signal.reason || "Sin señal",
        cooldownSec: this.getCooldownRemainingSec(pair),
        exposureAvailable: exposureScan.maxAllowed,
      });
      
      if (signal.action === "hold" || signal.confidence < 0.6) {
        return;
      }

      const krakenPair = this.formatKrakenPair(pair);
      const ticker = await this.krakenService.getTicker(krakenPair);
      const tickerData: any = Object.values(ticker)[0];
      if (!tickerData) return;

      const currentPrice = parseFloat(tickerData.c?.[0] || "0");
      const assetBalance = this.getAssetBalance(pair, balances);
      const existingPosition = this.openPositions.get(pair);

      if (signal.action === "buy") {
        if (this.isPairInCooldown(pair)) {
          const cooldownSec = this.getCooldownRemainingSec(pair);
          await botLogger.info("TRADE_SKIPPED", `Señal BUY ignorada - par en cooldown`, {
            pair,
            signal: "BUY",
            reason: "PAIR_COOLDOWN",
            cooldownRemainingSec: cooldownSec,
            signalReason: signal.reason,
          });
          return;
        }

        // MODO SINGLE: Bloquear compras si ya hay posición abierta
        const botConfigCheck = await storage.getBotConfig();
        const positionMode = botConfigCheck?.positionMode || "SINGLE";
        if (positionMode === "SINGLE" && existingPosition && existingPosition.amount > 0) {
          log(`${pair}: Compra bloqueada - Modo SINGLE activo y ya hay posición abierta (${existingPosition.amount.toFixed(6)})`, "trading");
          await botLogger.info("TRADE_SKIPPED", `Señal BUY ignorada - modo SINGLE con posición abierta`, {
            pair,
            signal: "BUY",
            reason: "SINGLE_MODE_POSITION_EXISTS",
            existingAmount: existingPosition.amount,
            signalReason: signal.reason,
          });
          return;
        }

        if (this.isPairInStopLossCooldown(pair)) {
          const cooldownSec = this.getStopLossCooldownRemainingSec(pair);
          log(`${pair}: En cooldown post stop-loss`, "trading");
          await botLogger.info("TRADE_SKIPPED", `Señal BUY ignorada - cooldown post stop-loss`, {
            pair,
            signal: "BUY",
            reason: "STOPLOSS_COOLDOWN",
            cooldownRemainingSec: cooldownSec,
            signalReason: signal.reason,
          });
          return;
        }

        const spreadCheck = this.isSpreadAcceptable(tickerData);
        if (!spreadCheck.acceptable) {
          log(`${pair}: Spread demasiado alto (${spreadCheck.spreadPct.toFixed(3)}% > ${MAX_SPREAD_PCT}%)`, "trading");
          await botLogger.info("TRADE_SKIPPED", `Señal BUY ignorada - spread alto`, {
            pair,
            signal: "BUY",
            reason: "SPREAD_TOO_HIGH",
            spreadPct: spreadCheck.spreadPct,
            maxSpreadPct: MAX_SPREAD_PCT,
            signalReason: signal.reason,
          });
          return;
        }

        if (existingPosition && existingPosition.amount * currentPrice > riskConfig.maxTradeUSD * 2) {
          log(`Posición existente en ${pair} ya es grande: $${(existingPosition.amount * currentPrice).toFixed(2)}`, "trading");
          await botLogger.info("TRADE_SKIPPED", `Señal BUY ignorada - posición existente demasiado grande`, {
            pair,
            signal: "BUY",
            reason: "POSITION_TOO_LARGE",
            currentPositionUsd: existingPosition.amount * currentPrice,
            maxTradeUsd: riskConfig.maxTradeUSD * 2,
          });
          return;
        }

        const minVolume = KRAKEN_MINIMUMS[pair] || 0.01;
        const minRequiredUSD = minVolume * currentPrice;
        const freshUsdBalance = parseFloat(balances?.ZUSD || balances?.USD || "0");

        if (freshUsdBalance < minRequiredUSD) {
          log(`Saldo USD insuficiente para ${pair}: $${freshUsdBalance.toFixed(2)} < $${minRequiredUSD.toFixed(2)}`, "trading");
          await botLogger.info("TRADE_SKIPPED", `Señal BUY ignorada - fondos insuficientes`, {
            pair,
            signal: "BUY",
            reason: "INSUFFICIENT_FUNDS",
            availableUsd: freshUsdBalance,
            minRequiredUsd: minRequiredUSD,
          });
          this.setPairCooldown(pair);
          return;
        }

        const botConfig = await storage.getBotConfig();
        const riskPerTradePct = parseFloat(botConfig?.riskPerTradePct?.toString() || "15");
        const takeProfitPct = parseFloat(botConfig?.takeProfitPercent?.toString() || "7");
        
        const profitCheck = this.isProfitableAfterFees(takeProfitPct);
        if (!profitCheck.isProfitable) {
          log(`${pair}: Trade rechazado - Take-Profit (${takeProfitPct}%) < mínimo rentable`, "trading");
          await botLogger.info("TRADE_SKIPPED", `Señal BUY ignorada - take-profit menor que fees`, {
            pair,
            signal: "BUY",
            reason: "LOW_PROFITABILITY",
            takeProfitPct,
            roundTripFees: profitCheck.roundTripFees,
            minProfitRequired: profitCheck.minProfitRequired,
            strategyId,
          });
          return;
        }
        
        let tradeAmountUSD = freshUsdBalance * (riskPerTradePct / 100);
        tradeAmountUSD = Math.min(tradeAmountUSD, riskConfig.maxTradeUSD);

        const confidenceFactor = this.getConfidenceSizingFactor(signal.confidence);
        tradeAmountUSD = tradeAmountUSD * confidenceFactor;

        if (tradeAmountUSD < minRequiredUSD && freshUsdBalance >= minRequiredUSD) {
          const smallAccountAmount = freshUsdBalance * SMALL_ACCOUNT_FACTOR;
          tradeAmountUSD = Math.min(smallAccountAmount, riskConfig.maxTradeUSD);
        }

        const exposure = this.getAvailableExposure(pair, botConfig, freshUsdBalance);
        const maxByBalance = Math.max(0, freshUsdBalance * 0.95);
        const effectiveMaxAllowed = Math.min(exposure.maxAllowed, maxByBalance);
        
        if (effectiveMaxAllowed < minRequiredUSD) {
          log(`${pair}: Sin exposición disponible`, "trading");
          await botLogger.info("TRADE_SKIPPED", `Señal BUY ignorada - sin exposición disponible`, {
            pair,
            signal: "BUY",
            reason: "EXPOSURE_ZERO",
            exposureAvailable: effectiveMaxAllowed,
            minRequiredUsd: minRequiredUSD,
          });
          this.setPairCooldown(pair);
          return;
        }

        let wasAdjusted = false;
        let originalAmount = tradeAmountUSD;
        
        if (tradeAmountUSD > effectiveMaxAllowed) {
          originalAmount = tradeAmountUSD;
          tradeAmountUSD = effectiveMaxAllowed;
          wasAdjusted = true;
        }

        const tradeVolume = tradeAmountUSD / currentPrice;

        if (tradeVolume < minVolume) {
          log(`${pair}: Volumen ${tradeVolume.toFixed(8)} < mínimo ${minVolume}`, "trading");
          await botLogger.info("TRADE_SKIPPED", `Señal BUY ignorada - volumen < mínimo`, {
            pair,
            signal: "BUY",
            reason: "VOLUME_BELOW_MINIMUM",
            calculatedVolume: tradeVolume,
            minVolume,
            strategyId,
          });
          this.setPairCooldown(pair);
          return;
        }

        const adjustmentInfo = wasAdjusted ? {
          wasAdjusted: true,
          originalAmountUsd: originalAmount,
          adjustedAmountUsd: tradeAmountUSD
        } : undefined;

        const success = await this.executeTrade(
          pair, 
          "buy", 
          tradeVolume.toFixed(8), 
          currentPrice, 
          `${signal.reason} [${strategyId}]`, 
          adjustmentInfo,
          { strategyId, timeframe, confidence: signal.confidence }
        );
        
        if (success) {
          this.lastTradeTime.set(pair, Date.now());
        }

      } else if (signal.action === "sell") {
        if (assetBalance <= 0 && (!existingPosition || existingPosition.amount <= 0)) {
          await botLogger.info("TRADE_SKIPPED", `Señal SELL ignorada - sin posición para vender`, {
            pair,
            signal: "SELL",
            reason: "NO_POSITION",
            assetBalance,
            strategyId,
            signalReason: signal.reason,
          });
          return;
        }

        const availableToSell = existingPosition?.amount || assetBalance;
        const sellVolume = Math.min(availableToSell, availableToSell * 0.5);
        const minVolumeSell = KRAKEN_MINIMUMS[pair] || 0.01;

        if (sellVolume < minVolumeSell) {
          await botLogger.info("TRADE_SKIPPED", `Señal SELL ignorada - volumen < mínimo`, {
            pair,
            signal: "SELL",
            reason: "VOLUME_BELOW_MINIMUM",
            calculatedVolume: sellVolume,
            minVolume: minVolumeSell,
            strategyId,
          });
          return;
        }

        const success = await this.executeTrade(pair, "sell", sellVolume.toFixed(8), currentPrice, `${signal.reason} [${strategyId}]`);
        if (success) {
          this.lastTradeTime.set(pair, Date.now());
        }
      }
    } catch (error: any) {
      log(`Error analizando ${pair} con velas: ${error.message}`, "trading");
    }
  }

  private async analyzeWithStrategy(
    strategy: string,
    pair: string,
    history: PriceData[],
    currentPrice: number
  ): Promise<TradeSignal> {
    const mtfData = await this.getMultiTimeframeData(pair);
    const mtfAnalysis = mtfData ? this.analyzeMultiTimeframe(mtfData) : null;

    let signal: TradeSignal;
    switch (strategy) {
      case "momentum":
        signal = this.momentumStrategy(pair, history, currentPrice);
        break;
      case "mean_reversion":
        signal = this.meanReversionStrategy(pair, history, currentPrice);
        break;
      case "scalping":
        signal = this.scalpingStrategy(pair, history, currentPrice);
        break;
      case "grid":
        signal = this.gridStrategy(pair, history, currentPrice);
        break;
      default:
        return { action: "hold", pair, confidence: 0, reason: "Estrategia desconocida" };
    }

    if (mtfAnalysis && signal.action !== "hold") {
      const mtfBoost = this.applyMTFFilter(signal, mtfAnalysis);
      if (mtfBoost.filtered) {
        return { action: "hold", pair, confidence: 0.3, reason: `Señal filtrada por MTF: ${mtfBoost.reason}` };
      }
      signal.confidence = Math.min(0.95, signal.confidence + mtfBoost.confidenceBoost);
      signal.reason += ` | MTF: ${mtfAnalysis.summary}`;
    }

    return signal;
  }

  private applyMTFFilter(signal: TradeSignal, mtf: TrendAnalysis): { filtered: boolean; confidenceBoost: number; reason: string } {
    if (signal.action === "buy") {
      if (mtf.longTerm === "bearish" && mtf.mediumTerm === "bearish") {
        return { filtered: true, confidenceBoost: 0, reason: "Tendencia 1h y 4h bajista" };
      }
      if (mtf.alignment < -0.5) {
        return { filtered: true, confidenceBoost: 0, reason: `Alineación MTF negativa (${mtf.alignment.toFixed(2)})` };
      }
      if (mtf.alignment > 0.5) {
        return { filtered: false, confidenceBoost: 0.15, reason: "Confirmado por MTF alcista" };
      }
      if (mtf.longTerm === "bullish") {
        return { filtered: false, confidenceBoost: 0.1, reason: "Tendencia 4h alcista" };
      }
    }

    if (signal.action === "sell") {
      if (mtf.longTerm === "bullish" && mtf.mediumTerm === "bullish") {
        return { filtered: true, confidenceBoost: 0, reason: "Tendencia 1h y 4h alcista" };
      }
      if (mtf.alignment > 0.5) {
        return { filtered: true, confidenceBoost: 0, reason: `Alineación MTF positiva (${mtf.alignment.toFixed(2)})` };
      }
      if (mtf.alignment < -0.5) {
        return { filtered: false, confidenceBoost: 0.15, reason: "Confirmado por MTF bajista" };
      }
      if (mtf.longTerm === "bearish") {
        return { filtered: false, confidenceBoost: 0.1, reason: "Tendencia 4h bajista" };
      }
    }

    return { filtered: false, confidenceBoost: 0, reason: "Sin filtro MTF aplicado" };
  }

  private momentumStrategy(pair: string, history: PriceData[], currentPrice: number): TradeSignal {
    const prices = history.map(h => h.price);
    const shortEMA = this.calculateEMA(prices.slice(-10), 10);
    const longEMA = this.calculateEMA(prices.slice(-20), 20);
    const rsi = this.calculateRSI(prices.slice(-14));
    const macd = this.calculateMACD(prices);
    const bollinger = this.calculateBollingerBands(prices);
    const volumeAnalysis = this.detectAbnormalVolume(history);
    
    const trend = (currentPrice - prices[0]) / prices[0] * 100;
    
    let buySignals = 0;
    let sellSignals = 0;
    const reasons: string[] = [];

    if (shortEMA > longEMA) buySignals++;
    else if (shortEMA < longEMA) sellSignals++;

    if (rsi < 30) { buySignals += 2; reasons.push(`RSI sobrevendido (${rsi.toFixed(0)})`); }
    else if (rsi < 45) { buySignals++; }
    else if (rsi > 70) { sellSignals += 2; reasons.push(`RSI sobrecomprado (${rsi.toFixed(0)})`); }
    else if (rsi > 55) { sellSignals++; }

    if (macd.histogram > 0 && macd.macd > macd.signal) { buySignals++; reasons.push("MACD alcista"); }
    else if (macd.histogram < 0 && macd.macd < macd.signal) { sellSignals++; reasons.push("MACD bajista"); }

    if (bollinger.percentB < 20) { buySignals++; reasons.push("Precio cerca de Bollinger inferior"); }
    else if (bollinger.percentB > 80) { sellSignals++; reasons.push("Precio cerca de Bollinger superior"); }

    if (volumeAnalysis.isAbnormal) {
      if (volumeAnalysis.direction === "bullish") { buySignals++; reasons.push(`Volumen alto alcista (${volumeAnalysis.ratio.toFixed(1)}x)`); }
      else if (volumeAnalysis.direction === "bearish") { sellSignals++; reasons.push(`Volumen alto bajista (${volumeAnalysis.ratio.toFixed(1)}x)`); }
    }

    if (trend > 1) buySignals++;
    else if (trend < -1) sellSignals++;

    const confidence = Math.min(0.95, 0.5 + (Math.max(buySignals, sellSignals) * 0.08));
    
    if (buySignals >= 4 && buySignals > sellSignals && rsi < 70) {
      return {
        action: "buy",
        pair,
        confidence,
        reason: `Momentum alcista: ${reasons.join(", ")} | Señales: ${buySignals} compra vs ${sellSignals} venta`,
      };
    }
    
    if (sellSignals >= 4 && sellSignals > buySignals && rsi > 30) {
      return {
        action: "sell",
        pair,
        confidence,
        reason: `Momentum bajista: ${reasons.join(", ")} | Señales: ${sellSignals} venta vs ${buySignals} compra`,
      };
    }

    return { action: "hold", pair, confidence: 0.3, reason: `Sin señal clara (${buySignals} compra / ${sellSignals} venta)` };
  }

  private meanReversionStrategy(pair: string, history: PriceData[], currentPrice: number): TradeSignal {
    const prices = history.map(h => h.price);
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const stdDev = Math.sqrt(prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length);
    const zScore = (currentPrice - mean) / stdDev;
    
    const bollinger = this.calculateBollingerBands(prices);
    const rsi = this.calculateRSI(prices.slice(-14));
    const volumeAnalysis = this.detectAbnormalVolume(history);
    
    const reasons: string[] = [];
    let confidence = 0.6;

    if (zScore < -2 || bollinger.percentB < 5) {
      confidence += 0.15;
      reasons.push(`Extremadamente sobrevendido (Z=${zScore.toFixed(2)}, %B=${bollinger.percentB.toFixed(0)})`);
      
      if (rsi < 25) { confidence += 0.1; reasons.push(`RSI muy bajo (${rsi.toFixed(0)})`); }
      if (volumeAnalysis.isAbnormal && volumeAnalysis.direction === "bearish") {
        confidence += 0.05;
        reasons.push("Volumen de capitulación");
      }
      
      return {
        action: "buy",
        pair,
        confidence: Math.min(0.95, confidence),
        reason: `Mean Reversion COMPRA: ${reasons.join(", ")}`,
      };
    }
    
    if (zScore < -1.5 || bollinger.percentB < 15) {
      if (rsi < 35) { confidence += 0.1; reasons.push(`RSI bajo (${rsi.toFixed(0)})`); }
      reasons.push(`Sobrevendido (Z=${zScore.toFixed(2)}, %B=${bollinger.percentB.toFixed(0)})`);
      
      return {
        action: "buy",
        pair,
        confidence: Math.min(0.85, confidence),
        reason: `Mean Reversion COMPRA: ${reasons.join(", ")}`,
      };
    }
    
    if (zScore > 2 || bollinger.percentB > 95) {
      confidence += 0.15;
      reasons.push(`Extremadamente sobrecomprado (Z=${zScore.toFixed(2)}, %B=${bollinger.percentB.toFixed(0)})`);
      
      if (rsi > 75) { confidence += 0.1; reasons.push(`RSI muy alto (${rsi.toFixed(0)})`); }
      if (volumeAnalysis.isAbnormal && volumeAnalysis.direction === "bullish") {
        confidence += 0.05;
        reasons.push("Volumen de euforia");
      }
      
      return {
        action: "sell",
        pair,
        confidence: Math.min(0.95, confidence),
        reason: `Mean Reversion VENTA: ${reasons.join(", ")}`,
      };
    }
    
    if (zScore > 1.5 || bollinger.percentB > 85) {
      if (rsi > 65) { confidence += 0.1; reasons.push(`RSI alto (${rsi.toFixed(0)})`); }
      reasons.push(`Sobrecomprado (Z=${zScore.toFixed(2)}, %B=${bollinger.percentB.toFixed(0)})`);
      
      return {
        action: "sell",
        pair,
        confidence: Math.min(0.85, confidence),
        reason: `Mean Reversion VENTA: ${reasons.join(", ")}`,
      };
    }

    return { action: "hold", pair, confidence: 0.3, reason: `Precio en rango normal (Z=${zScore.toFixed(2)})` };
  }

  private scalpingStrategy(pair: string, history: PriceData[], currentPrice: number): TradeSignal {
    if (history.length < 15) {
      return { action: "hold", pair, confidence: 0, reason: "Datos insuficientes para scalping" };
    }

    const prices = history.map(h => h.price);
    const recentPrices = prices.slice(-5);
    const avgPrice = recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length;
    const priceChange = (currentPrice - avgPrice) / avgPrice * 100;
    
    const volatility = this.calculateVolatility(recentPrices);
    const rsi = this.calculateRSI(prices.slice(-14));
    const volumeAnalysis = this.detectAbnormalVolume(history);
    const macd = this.calculateMACD(prices);
    const atr = this.calculateATR(history, 14);
    const atrPercent = this.calculateATRPercent(history, 14);
    
    const reasons: string[] = [];
    let confidence = 0.65;

    // Filtro de volatilidad mínima usando ATR
    if (atrPercent < 0.1) {
      return { action: "hold", pair, confidence: 0.2, reason: `Volatilidad ATR muy baja (${atrPercent.toFixed(2)}%)` };
    }

    // Ajustar umbral de entrada basado en ATR
    const entryThreshold = Math.max(0.2, atrPercent * 0.3);

    if (priceChange < -entryThreshold && volatility > 0.15) {
      reasons.push(`Caída rápida ${priceChange.toFixed(2)}%`);
      reasons.push(`ATR: ${atrPercent.toFixed(2)}%`);
      
      if (volumeAnalysis.isAbnormal && volumeAnalysis.ratio > 1.5) {
        confidence += 0.1;
        reasons.push(`Volumen alto (${volumeAnalysis.ratio.toFixed(1)}x)`);
      }
      if (rsi < 40) {
        confidence += 0.05;
        reasons.push(`RSI bajo (${rsi.toFixed(0)})`);
      }
      if (macd.histogram < 0 && macd.histogram > -0.5) {
        confidence += 0.05;
        reasons.push("MACD cerca de cruce");
      }
      // Bonus de confianza si ATR es alto (más oportunidad de profit)
      if (atrPercent > 0.5) {
        confidence += 0.05;
      }
      
      return {
        action: "buy",
        pair,
        confidence: Math.min(0.9, confidence),
        reason: `Scalping COMPRA: ${reasons.join(", ")}`,
      };
    }
    
    if (priceChange > entryThreshold && volatility > 0.15) {
      reasons.push(`Subida rápida +${priceChange.toFixed(2)}%`);
      reasons.push(`ATR: ${atrPercent.toFixed(2)}%`);
      
      if (volumeAnalysis.isAbnormal && volumeAnalysis.ratio > 1.5) {
        confidence += 0.1;
        reasons.push(`Volumen alto (${volumeAnalysis.ratio.toFixed(1)}x)`);
      }
      if (rsi > 60) {
        confidence += 0.05;
        reasons.push(`RSI alto (${rsi.toFixed(0)})`);
      }
      if (atrPercent > 0.5) {
        confidence += 0.05;
      }
      
      return {
        action: "sell",
        pair,
        confidence: Math.min(0.9, confidence),
        reason: `Scalping VENTA: ${reasons.join(", ")}`,
      };
    }

    return { action: "hold", pair, confidence: 0.3, reason: `Sin oportunidad (cambio: ${priceChange.toFixed(2)}%, ATR: ${atrPercent.toFixed(2)}%)` };
  }

  private gridStrategy(pair: string, history: PriceData[], currentPrice: number): TradeSignal {
    if (history.length < 15) {
      return { action: "hold", pair, confidence: 0, reason: "Datos insuficientes para grid" };
    }

    const prices = history.map(h => h.price);
    const high = Math.max(...prices);
    const low = Math.min(...prices);
    
    // Usar ATR para determinar el espaciado del grid dinámicamente
    const atr = this.calculateATR(history, 14);
    const atrPercent = this.calculateATRPercent(history, 14);
    
    // El grid size se basa en ATR para adaptarse a la volatilidad del mercado
    // Usamos 1.5x ATR como espaciado entre niveles del grid
    const atrBasedGridSize = atr * 1.5;
    const rangeBasedGridSize = (high - low) / 5;
    
    // Usamos el mayor de los dos para evitar niveles demasiado cercanos
    const gridSize = Math.max(atrBasedGridSize, rangeBasedGridSize);
    
    if (gridSize <= 0) {
      return { action: "hold", pair, confidence: 0, reason: "Grid size inválido" };
    }
    
    // Calcular niveles basados en precio medio
    const midPrice = (high + low) / 2;
    const distanceFromMid = currentPrice - midPrice;
    const levelFromMid = Math.round(distanceFromMid / gridSize);
    
    const prevPrice = prices[prices.length - 2];
    const prevDistanceFromMid = prevPrice - midPrice;
    const prevLevelFromMid = Math.round(prevDistanceFromMid / gridSize);
    
    // Niveles de soporte/resistencia basados en ATR
    const supportLevel = midPrice - (2 * gridSize);
    const resistanceLevel = midPrice + (2 * gridSize);
    
    let confidence = 0.7;
    
    // Ajustar confianza basado en ATR
    if (atrPercent > 0.5 && atrPercent < 2) {
      confidence += 0.1; // Volatilidad ideal para grid
    } else if (atrPercent > 2) {
      confidence -= 0.1; // Demasiada volatilidad
    }
    
    if (currentPrice <= supportLevel && levelFromMid < prevLevelFromMid) {
      return {
        action: "buy",
        pair,
        confidence: Math.min(0.85, confidence),
        reason: `Grid ATR: Precio en soporte $${supportLevel.toFixed(2)} (ATR: ${atrPercent.toFixed(2)}%, nivel: ${levelFromMid})`,
      };
    }
    
    if (currentPrice >= resistanceLevel && levelFromMid > prevLevelFromMid) {
      return {
        action: "sell",
        pair,
        confidence: Math.min(0.85, confidence),
        reason: `Grid ATR: Precio en resistencia $${resistanceLevel.toFixed(2)} (ATR: ${atrPercent.toFixed(2)}%, nivel: ${levelFromMid})`,
      };
    }

    return { action: "hold", pair, confidence: 0.3, reason: `Grid: Nivel ${levelFromMid}, ATR: ${atrPercent.toFixed(2)}%` };
  }

  private calculateEMA(prices: number[], period: number): number {
    if (prices.length === 0) return 0;
    const multiplier = 2 / (period + 1);
    let ema = prices[0];
    for (let i = 1; i < prices.length; i++) {
      ema = (prices[i] - ema) * multiplier + ema;
    }
    return ema;
  }

  private calculateRSI(prices: number[]): number {
    if (prices.length < 2) return 50;
    
    let gains = 0, losses = 0;
    for (let i = 1; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      if (change > 0) gains += change;
      else losses -= change;
    }
    
    const avgGain = gains / (prices.length - 1);
    const avgLoss = losses / (prices.length - 1);
    
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  private calculateVolatility(prices: number[]): number {
    if (prices.length < 2) return 0;
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const variance = prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length;
    return (Math.sqrt(variance) / mean) * 100;
  }

  private calculateMACD(prices: number[]): { macd: number; signal: number; histogram: number } {
    if (prices.length < 26) {
      return { macd: 0, signal: 0, histogram: 0 };
    }
    
    const ema12 = this.calculateEMA(prices.slice(-12), 12);
    const ema26 = this.calculateEMA(prices.slice(-26), 26);
    const macd = ema12 - ema26;
    
    const macdHistory: number[] = [];
    for (let i = 26; i <= prices.length; i++) {
      const e12 = this.calculateEMA(prices.slice(i - 12, i), 12);
      const e26 = this.calculateEMA(prices.slice(i - 26, i), 26);
      macdHistory.push(e12 - e26);
    }
    
    const signal = macdHistory.length >= 9 ? this.calculateEMA(macdHistory.slice(-9), 9) : 0;
    const histogram = macd - signal;
    
    return { macd, signal, histogram };
  }

  private calculateBollingerBands(prices: number[], period: number = 20, stdDevMultiplier: number = 2): { 
    upper: number; 
    middle: number; 
    lower: number; 
    percentB: number;
  } {
    if (prices.length < period) {
      const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
      return { upper: avg, middle: avg, lower: avg, percentB: 50 };
    }
    
    const recentPrices = prices.slice(-period);
    const middle = recentPrices.reduce((a, b) => a + b, 0) / period;
    const stdDev = Math.sqrt(
      recentPrices.reduce((sum, p) => sum + Math.pow(p - middle, 2), 0) / period
    );
    
    const upper = middle + (stdDevMultiplier * stdDev);
    const lower = middle - (stdDevMultiplier * stdDev);
    const currentPrice = prices[prices.length - 1];
    const percentB = ((currentPrice - lower) / (upper - lower)) * 100;
    
    return { upper, middle, lower, percentB };
  }

  private calculateATR(history: PriceData[], period: number = 14): number {
    if (history.length < period + 1) {
      return 0;
    }
    
    const trueRanges: number[] = [];
    for (let i = 1; i < history.length; i++) {
      const current = history[i];
      const previous = history[i - 1];
      
      const tr1 = current.high - current.low;
      const tr2 = Math.abs(current.high - previous.price);
      const tr3 = Math.abs(current.low - previous.price);
      
      const trueRange = Math.max(tr1, tr2, tr3);
      trueRanges.push(trueRange);
    }
    
    const recentTRs = trueRanges.slice(-period);
    const atr = recentTRs.reduce((a, b) => a + b, 0) / recentTRs.length;
    
    return atr;
  }

  private calculateATRPercent(history: PriceData[], period: number = 14): number {
    const atr = this.calculateATR(history, period);
    if (history.length === 0 || atr === 0) return 0;
    
    const currentPrice = history[history.length - 1].price;
    return (atr / currentPrice) * 100;
  }

  private detectAbnormalVolume(history: PriceData[]): { isAbnormal: boolean; ratio: number; direction: string } {
    if (history.length < 10) {
      return { isAbnormal: false, ratio: 1, direction: "neutral" };
    }
    
    const volumes = history.map(h => h.volume);
    const currentVolume = volumes[volumes.length - 1];
    const avgVolume = volumes.slice(0, -1).reduce((a, b) => a + b, 0) / (volumes.length - 1);
    
    if (avgVolume <= 0 || !isFinite(avgVolume) || currentVolume <= 0) {
      return { isAbnormal: false, ratio: 1, direction: "neutral" };
    }
    
    const ratio = currentVolume / avgVolume;
    
    if (!isFinite(ratio) || isNaN(ratio)) {
      return { isAbnormal: false, ratio: 1, direction: "neutral" };
    }
    
    const isAbnormal = ratio > 2.0 || ratio < 0.3;
    
    const priceChange = (history[history.length - 1].price - history[history.length - 2].price);
    const direction = priceChange > 0 ? "bullish" : priceChange < 0 ? "bearish" : "neutral";
    
    return { isAbnormal, ratio, direction };
  }

  private updatePriceHistory(pair: string, data: PriceData) {
    if (!this.priceHistory.has(pair)) {
      this.priceHistory.set(pair, []);
    }
    const history = this.priceHistory.get(pair)!;
    history.push(data);
    if (history.length > this.PRICE_HISTORY_LENGTH) {
      history.shift();
    }
  }

  private formatKrakenPair(pair: string): string {
    const pairMap: Record<string, string> = {
      "BTC/USD": "XXBTZUSD",
      "ETH/USD": "XETHZUSD",
      "SOL/USD": "SOLUSD",
      "XRP/USD": "XXRPZUSD",
      "TON/USD": "TONUSD",
      "ETH/BTC": "XETHXXBT",
      "BTC/ETH": "XXBTZXETH",
      "SOL/ETH": "SOLETH",
    };
    return pairMap[pair] || pair.replace("/", "");
  }

  private getAssetBalance(pair: string, balances: any): number {
    const asset = pair.split("/")[0];
    const assetMap: Record<string, string[]> = {
      "BTC": ["XXBT", "XBT", "BTC"],
      "ETH": ["XETH", "ETH"],
      "SOL": ["SOL"],
      "XRP": ["XXRP", "XRP"],
      "TON": ["TON"],
    };
    
    const keys = assetMap[asset] || [asset];
    for (const key of keys) {
      if (balances?.[key]) {
        return parseFloat(balances[key]);
      }
    }
    return 0;
  }

  private async executeTrade(
    pair: string,
    type: "buy" | "sell",
    volume: string,
    price: number,
    reason: string,
    adjustmentInfo?: { wasAdjusted: boolean; originalAmountUsd: number; adjustedAmountUsd: number },
    strategyMeta?: { strategyId: string; timeframe: string; confidence: number }
  ): Promise<boolean> {
    try {
      log(`Ejecutando ${type.toUpperCase()} ${volume} ${pair} @ $${price.toFixed(2)}`, "trading");
      
      const order = await this.krakenService.placeOrder({
        pair,
        type,
        ordertype: "market",
        volume,
      });

      const txid = order.txid?.[0];
      if (!txid) {
        log(`Orden sin txid - posible fallo`, "trading");
        return false;
      }

      const tradeId = `AUTO-${Date.now()}`;
      await storage.createTrade({
        tradeId,
        pair,
        type,
        price: price.toString(),
        amount: volume,
        status: "filled",
        krakenOrderId: txid,
        executedAt: new Date(),
      });

      const volumeNum = parseFloat(volume);
      if (type === "buy") {
        this.currentUsdBalance -= volumeNum * price;
        const existing = this.openPositions.get(pair);
        let newPosition: OpenPosition;
        
        const entryStrategyId = strategyMeta?.strategyId || "momentum_cycle";
        const entrySignalTf = strategyMeta?.timeframe || "cycle";
        const signalConfidence = strategyMeta?.confidence;
        
        if (existing && existing.amount > 0) {
          const totalAmount = existing.amount + volumeNum;
          const avgPrice = (existing.amount * existing.entryPrice + volumeNum * price) / totalAmount;
          newPosition = { 
            amount: totalAmount, 
            entryPrice: avgPrice,
            highestPrice: Math.max(existing.highestPrice, price),
            openedAt: existing.openedAt,
            entryStrategyId: existing.entryStrategyId,
            entrySignalTf: existing.entrySignalTf,
            signalConfidence: existing.signalConfidence,
            signalReason: existing.signalReason,
            aiSampleId: existing.aiSampleId,
          };
          this.openPositions.set(pair, newPosition);
        } else {
          newPosition = { 
            amount: volumeNum, 
            entryPrice: price,
            highestPrice: price,
            openedAt: Date.now(),
            entryStrategyId,
            entrySignalTf,
            signalConfidence,
            signalReason: reason,
          };
          this.openPositions.set(pair, newPosition);
        }
        
        // AI Sample collection: save features for ALL buy entries (not just new positions)
        if (!newPosition.aiSampleId) {
          try {
            const features = aiService.extractFeatures({
              rsi: 50, // Will be enriched from actual indicators in future
              confidence: signalConfidence ?? 50,
            });
            const sampleTradeId = `SAMPLE-${Date.now()}-${pair}`;
            const sample = await storage.saveAiSample({
              tradeId: sampleTradeId,
              pair,
              side: "buy",
              entryPrice: price.toString(),
              entryTs: new Date(),
              featuresJson: features,
            });
            if (sample?.id) {
              newPosition.aiSampleId = sample.id;
              log(`[AI] Sample #${sample.id} guardado para ${pair}`, "trading");
            }
          } catch (aiErr: any) {
            log(`[AI] Error guardando sample: ${aiErr.message}`, "trading");
          }
        }
        
        await this.savePositionToDB(pair, newPosition);
      } else {
        this.currentUsdBalance += volumeNum * price;
        const existing = this.openPositions.get(pair);
        if (existing) {
          const pnl = (price - existing.entryPrice) * volumeNum;
          const pnlPercent = ((price - existing.entryPrice) / existing.entryPrice) * 100;
          this.dailyPnL += pnl;
          log(`P&L de operación: $${pnl.toFixed(2)} | P&L diario acumulado: $${this.dailyPnL.toFixed(2)}`, "trading");
          
          existing.amount -= volumeNum;
          const isFullClose = existing.amount <= 0;
          
          // AI Sample update: mark sample complete with PnL result only on full close
          if (existing.aiSampleId && isFullClose) {
            try {
              await storage.updateAiSample(existing.aiSampleId, {
                exitPrice: price.toString(),
                exitTs: new Date(),
                pnlGross: pnl.toString(),
                pnlNet: pnl.toString(),
                labelWin: pnl > 0 ? 1 : 0,
                isComplete: true,
              });
              log(`[AI] Sample #${existing.aiSampleId} actualizado: PnL=${pnl.toFixed(2)} (${pnl > 0 ? 'WIN' : 'LOSS'})`, "trading");
            } catch (aiErr: any) {
              log(`[AI] Error actualizando sample: ${aiErr.message}`, "trading");
            }
          }
          
          if (isFullClose) {
            this.openPositions.delete(pair);
            await this.deletePositionFromDB(pair);
          } else {
            this.openPositions.set(pair, existing);
            await this.savePositionToDB(pair, existing);
          }
        }
      }

      const emoji = type === "buy" ? "🟢" : "🔴";
      const totalUSD = (volumeNum * price).toFixed(2);
      
      if (this.telegramService.isInitialized()) {
        let adjustmentNote = "";
        if (adjustmentInfo?.wasAdjusted) {
          adjustmentNote = `\n📉 _Ajustado por exposición: $${adjustmentInfo.originalAmountUsd.toFixed(2)} → $${adjustmentInfo.adjustedAmountUsd.toFixed(2)}_\n`;
        }
        
        const strategyLabel = strategyMeta?.strategyId ? 
          ((strategyMeta?.timeframe && strategyMeta.timeframe !== "cycle") ? 
            `Momentum (Velas ${strategyMeta.timeframe})` : 
            "Momentum (Ciclos)") : 
          "Momentum (Ciclos)";
        const confidenceLabel = strategyMeta?.confidence ? ` | Confianza: ${(strategyMeta.confidence * 100).toFixed(0)}%` : "";
        
        await this.telegramService.sendMessage(`
${emoji} *Operación Automática Ejecutada*

*Tipo:* ${type.toUpperCase()}
*Par:* ${pair}
*Cantidad:* ${volume}
*Precio:* $${price.toFixed(2)}
*Total:* $${totalUSD}
*ID:* ${txid}
*Estrategia:* ${strategyLabel}${confidenceLabel}
${adjustmentNote}
*Razón:* ${reason}

_KrakenBot.AI - Trading Autónomo_
        `.trim());
      }

      log(`Orden ejecutada: ${txid}`, "trading");
      
      await botLogger.info("TRADE_EXECUTED", `Trade ${type.toUpperCase()} ejecutado en ${pair}`, {
        pair,
        type,
        volume: volumeNum,
        price,
        totalUsd: volumeNum * price,
        txid,
        reason,
        strategyId: strategyMeta?.strategyId || "momentum_cycle",
        timeframe: strategyMeta?.timeframe || "cycle",
        confidence: strategyMeta?.confidence,
      });
      
      return true;
    } catch (error: any) {
      log(`Error ejecutando orden: ${error.message}`, "trading");
      
      await botLogger.error("TRADE_FAILED", `Error ejecutando ${type} en ${pair}`, {
        pair,
        type,
        volume,
        price,
        error: error.message,
      });
      
      if (this.telegramService.isInitialized()) {
        await this.telegramService.sendMessage(`
⚠️ *Error en Operación*

*Par:* ${pair}
*Tipo:* ${type}
*Error:* ${error.message}

_KrakenBot.AI_
        `.trim());
      }
      return false;
    }
  }

  private async getMultiTimeframeData(pair: string): Promise<MultiTimeframeData | null> {
    try {
      const cached = this.mtfCache.get(pair);
      if (cached && Date.now() - cached.lastUpdate < this.MTF_CACHE_TTL) {
        return cached;
      }

      const [tf5m, tf1h, tf4h] = await Promise.all([
        this.krakenService.getOHLC(pair, 5),
        this.krakenService.getOHLC(pair, 60),
        this.krakenService.getOHLC(pair, 240),
      ]);

      const data: MultiTimeframeData = {
        tf5m: tf5m.slice(-50),
        tf1h: tf1h.slice(-50),
        tf4h: tf4h.slice(-50),
        lastUpdate: Date.now(),
      };

      this.mtfCache.set(pair, data);
      log(`MTF datos actualizados para ${pair}: 5m=${tf5m.length}, 1h=${tf1h.length}, 4h=${tf4h.length}`, "trading");
      return data;
    } catch (error: any) {
      log(`Error obteniendo datos MTF para ${pair}: ${error.message}`, "trading");
      return null;
    }
  }

  private analyzeTimeframeTrend(candles: OHLCCandle[]): "bullish" | "bearish" | "neutral" {
    if (candles.length < 10) return "neutral";

    const closes = candles.map(c => c.close);
    const ema10 = this.calculateEMA(closes.slice(-10), 10);
    const ema20 = this.calculateEMA(closes.slice(-20), 20);
    const currentPrice = closes[closes.length - 1];

    const priceVsEma10 = (currentPrice - ema10) / ema10 * 100;
    const ema10VsEma20 = (ema10 - ema20) / ema20 * 100;

    let score = 0;
    if (priceVsEma10 > 0.5) score += 2;
    else if (priceVsEma10 > 0) score += 1;
    else if (priceVsEma10 < -0.5) score -= 2;
    else if (priceVsEma10 < 0) score -= 1;

    if (ema10VsEma20 > 0.3) score += 2;
    else if (ema10VsEma20 > 0) score += 1;
    else if (ema10VsEma20 < -0.3) score -= 2;
    else if (ema10VsEma20 < 0) score -= 1;

    const recentCandles = candles.slice(-5);
    const higherHighs = recentCandles.filter((c, i) => i > 0 && c.high > recentCandles[i-1].high).length;
    const lowerLows = recentCandles.filter((c, i) => i > 0 && c.low < recentCandles[i-1].low).length;
    
    if (higherHighs >= 3) score += 1;
    if (lowerLows >= 3) score -= 1;

    if (score >= 3) return "bullish";
    if (score <= -3) return "bearish";
    return "neutral";
  }

  private analyzeMultiTimeframe(mtfData: MultiTimeframeData): TrendAnalysis {
    const shortTerm = this.analyzeTimeframeTrend(mtfData.tf5m);
    const mediumTerm = this.analyzeTimeframeTrend(mtfData.tf1h);
    const longTerm = this.analyzeTimeframeTrend(mtfData.tf4h);

    const trendValues = { bullish: 1, neutral: 0, bearish: -1 };
    const totalScore = trendValues[shortTerm] + trendValues[mediumTerm] * 1.5 + trendValues[longTerm] * 2;
    
    const allAligned = (shortTerm === mediumTerm && mediumTerm === longTerm && shortTerm !== "neutral");
    const twoAligned = (shortTerm === mediumTerm || mediumTerm === longTerm || shortTerm === longTerm);
    
    let alignment = 0;
    let confidence = 0.5;
    
    if (allAligned) {
      alignment = trendValues[shortTerm];
      confidence = 0.9;
    } else if (twoAligned && shortTerm !== "neutral") {
      alignment = totalScore > 0 ? 0.7 : totalScore < 0 ? -0.7 : 0;
      confidence = 0.7;
    } else {
      alignment = totalScore / 4.5;
      confidence = 0.5;
    }

    let summary = "";
    if (allAligned) {
      summary = `Tendencia ${shortTerm === "bullish" ? "ALCISTA" : "BAJISTA"} confirmada en todos los timeframes (5m/1h/4h)`;
    } else {
      summary = `5m: ${shortTerm}, 1h: ${mediumTerm}, 4h: ${longTerm}`;
    }

    return { shortTerm, mediumTerm, longTerm, alignment, confidence, summary };
  }

  isActive(): boolean {
    return this.isRunning;
  }

  getOpenPositions(): Map<string, { amount: number; entryPrice: number }> {
    return this.openPositions;
  }
}
