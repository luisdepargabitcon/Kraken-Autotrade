import { KrakenService } from "./kraken";
import { TelegramService } from "./telegram";
import { botLogger } from "./botLogger";
import { storage } from "../storage";
import { log } from "../index";

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
  maxPositionPercent: number;
  minTradeUSD: number;
  maxTradeUSD: number;
  stopLossPercent: number;
  takeProfitPercent: number;
}

const RISK_LEVELS: Record<string, RiskConfig> = {
  low: {
    maxPositionPercent: 1,
    minTradeUSD: 5,
    maxTradeUSD: 20,
    stopLossPercent: 2,
    takeProfitPercent: 3,
  },
  medium: {
    maxPositionPercent: 3,
    minTradeUSD: 10,
    maxTradeUSD: 50,
    stopLossPercent: 5,
    takeProfitPercent: 7,
  },
  high: {
    maxPositionPercent: 5,
    minTradeUSD: 20,
    maxTradeUSD: 100,
    stopLossPercent: 10,
    takeProfitPercent: 15,
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

interface OpenPosition {
  amount: number;
  entryPrice: number;
  highestPrice: number;
  openedAt: number;
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

  private async checkExposureLimits(
    pair: string,
    newTradeUsd: number,
    config: any
  ): Promise<{ allowed: boolean; reason?: string; blockedBy?: "pair" | "total" }> {
    const maxPairExposurePct = parseFloat(config.maxPairExposurePct?.toString() || "25");
    const maxTotalExposurePct = parseFloat(config.maxTotalExposurePct?.toString() || "60");

    const currentPairExposure = this.calculatePairExposure(pair);
    const currentTotalExposure = this.calculateTotalExposure();

    const maxPairExposureUsd = this.currentUsdBalance * (maxPairExposurePct / 100);
    const maxTotalExposureUsd = this.currentUsdBalance * (maxTotalExposurePct / 100);

    if (currentPairExposure + newTradeUsd > maxPairExposureUsd) {
      return {
        allowed: false,
        reason: `Exposición por par excedida: $${(currentPairExposure + newTradeUsd).toFixed(2)} > $${maxPairExposureUsd.toFixed(2)} (${maxPairExposurePct}%)`,
        blockedBy: "pair"
      };
    }

    if (currentTotalExposure + newTradeUsd > maxTotalExposureUsd) {
      return {
        allowed: false,
        reason: `Exposición total excedida: $${(currentTotalExposure + newTradeUsd).toFixed(2)} > $${maxTotalExposureUsd.toFixed(2)} (${maxTotalExposurePct}%)`,
        blockedBy: "total"
      };
    }

    return { allowed: true };
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
    
    this.runTradingCycle();
  }

  async stop() {
    if (!this.isRunning) return;
    
    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
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
        });
        log(`Posición recuperada: ${pos.pair} - ${pos.amount} @ $${pos.entryPrice}`, "trading");
      }
      
      if (positions.length > 0) {
        log(`${positions.length} posiciones abiertas cargadas desde la base de datos`, "trading");
        if (this.telegramService.isInitialized()) {
          const positionsList = positions.map(p => `• ${p.pair}: ${p.amount} @ $${parseFloat(p.entryPrice).toFixed(2)}`).join("\n");
          await this.telegramService.sendMessage(`📂 *Posiciones Recuperadas*\n\n${positionsList}`);
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

      for (const pair of config.activePairs) {
        await this.analyzePairAndTrade(pair, config.strategy, riskConfig, balances);
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
        await botLogger.warn("STOP_LOSS_HIT", `Stop-Loss activado en ${pair}`, {
          pair,
          entryPrice: position.entryPrice,
          currentPrice,
          priceChange,
          stopLossPercent,
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

        log(`${emoji} ${reason} para ${pair}`, "trading");

        const pnl = (currentPrice - position.entryPrice) * position.amount;
        const pnlPercent = priceChange;

        const success = await this.executeTrade(pair, "sell", sellAmount.toFixed(8), currentPrice, reason);
        
        if (success && this.telegramService.isInitialized()) {
          const pnlEmoji = pnl >= 0 ? "💰" : "📉";
          await this.telegramService.sendAlertToMultipleChats(`
${emoji} *${reason}*

*Par:* ${pair}
*Precio entrada:* $${position.entryPrice.toFixed(2)}
*Precio actual:* $${currentPrice.toFixed(2)}
*Cantidad vendida:* ${sellAmount}

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
      
      if (signal.action === "hold" || signal.confidence < 0.6) {
        return;
      }

      const assetBalance = this.getAssetBalance(pair, balances);
      const existingPosition = this.openPositions.get(pair);

      if (signal.action === "buy") {
        if (existingPosition && existingPosition.amount * currentPrice > riskConfig.maxTradeUSD * 2) {
          log(`Posición existente en ${pair} ya es grande: $${(existingPosition.amount * currentPrice).toFixed(2)}`, "trading");
          return;
        }

        const minVolume = KRAKEN_MINIMUMS[pair] || 0.01;
        const minRequiredUSD = minVolume * currentPrice;

        if (this.currentUsdBalance < minRequiredUSD) {
          log(`Saldo USD insuficiente para ${pair}: $${this.currentUsdBalance.toFixed(2)} < $${minRequiredUSD.toFixed(2)}`, "trading");
          if (this.telegramService.isInitialized()) {
            await this.telegramService.sendMessage(`
⚠️ *Saldo Insuficiente*

No se puede abrir posición en *${pair}*

*Saldo actual:* $${this.currentUsdBalance.toFixed(2)}
*Mínimo requerido:* $${minRequiredUSD.toFixed(2)}
*Volumen mínimo Kraken:* ${minVolume}

_Deposita más fondos para operar este par._
            `.trim());
          }
          return;
        }

        let tradeAmountUSD = Math.min(
          this.currentUsdBalance * (riskConfig.maxPositionPercent / 100),
          riskConfig.maxTradeUSD
        );

        if (tradeAmountUSD < minRequiredUSD && this.currentUsdBalance >= minRequiredUSD) {
          const smallAccountAmount = this.currentUsdBalance * SMALL_ACCOUNT_FACTOR;
          tradeAmountUSD = Math.min(smallAccountAmount, riskConfig.maxTradeUSD);
          log(`Cuenta pequeña detectada: usando ${(SMALL_ACCOUNT_FACTOR * 100).toFixed(0)}% del saldo ($${tradeAmountUSD.toFixed(2)})`, "trading");
        }

        const tradeVolume = tradeAmountUSD / currentPrice;

        if (tradeVolume < minVolume) {
          log(`Volumen menor al mínimo de Kraken: ${tradeVolume.toFixed(8)} < ${minVolume}`, "trading");
          if (this.telegramService.isInitialized()) {
            await this.telegramService.sendMessage(`
⚠️ *Volumen Menor al Mínimo de Kraken*

*Par:* ${pair}
*Volumen calculado:* ${tradeVolume.toFixed(8)}
*Mínimo de Kraken:* ${minVolume}
*Monto USD:* $${tradeAmountUSD.toFixed(2)}
*Mínimo USD requerido:* $${minRequiredUSD.toFixed(2)}

_Necesitas más saldo para cumplir el mínimo del exchange._
            `.trim());
          }
          return;
        }

        const botConfig = await storage.getBotConfig();
        const exposureCheck = await this.checkExposureLimits(pair, tradeAmountUSD, botConfig);
        if (!exposureCheck.allowed) {
          log(`Trade bloqueado por límite de exposición: ${exposureCheck.reason}`, "trading");
          
          await botLogger.warn("TRADE_BLOCKED", `Trade bloqueado por límite de exposición (${exposureCheck.blockedBy})`, {
            pair,
            newTradeUsd: tradeAmountUSD,
            currentPairExposure: this.calculatePairExposure(pair),
            currentTotalExposure: this.calculateTotalExposure(),
            maxPairExposurePct: parseFloat(botConfig?.maxPairExposurePct?.toString() || "25"),
            maxTotalExposurePct: parseFloat(botConfig?.maxTotalExposurePct?.toString() || "60"),
            blockedBy: exposureCheck.blockedBy,
          });

          if (this.telegramService.isInitialized()) {
            const blockType = exposureCheck.blockedBy === "pair" ? "por par" : "total";
            await this.telegramService.sendAlertToMultipleChats(`
🚫 *Trade Bloqueado por Exposición*

*Par:* ${pair}
*Tipo:* Límite de exposición ${blockType}
*Nuevo trade:* $${tradeAmountUSD.toFixed(2)}

${exposureCheck.reason}

_Reduce posiciones abiertas o ajusta los límites de exposición._
            `.trim(), "trades");
          }
          return;
        }

        const success = await this.executeTrade(pair, "buy", tradeVolume.toFixed(8), currentPrice, signal.reason);
        if (success) {
          this.lastTradeTime.set(pair, Date.now());
        }

      } else if (signal.action === "sell") {
        if (assetBalance <= 0 && (!existingPosition || existingPosition.amount <= 0)) {
          return;
        }

        const availableToSell = existingPosition?.amount || assetBalance;
        const sellVolume = Math.min(availableToSell, availableToSell * 0.5);
        const minVolume = KRAKEN_MINIMUMS[pair] || 0.01;

        if (sellVolume < minVolume) {
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
    reason: string
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
        if (existing && existing.amount > 0) {
          const totalAmount = existing.amount + volumeNum;
          const avgPrice = (existing.amount * existing.entryPrice + volumeNum * price) / totalAmount;
          newPosition = { 
            amount: totalAmount, 
            entryPrice: avgPrice,
            highestPrice: Math.max(existing.highestPrice, price),
            openedAt: existing.openedAt
          };
          this.openPositions.set(pair, newPosition);
        } else {
          newPosition = { 
            amount: volumeNum, 
            entryPrice: price,
            highestPrice: price,
            openedAt: Date.now()
          };
          this.openPositions.set(pair, newPosition);
        }
        await this.savePositionToDB(pair, newPosition);
      } else {
        this.currentUsdBalance += volumeNum * price;
        const existing = this.openPositions.get(pair);
        if (existing) {
          const pnl = (price - existing.entryPrice) * volumeNum;
          this.dailyPnL += pnl;
          log(`P&L de operación: $${pnl.toFixed(2)} | P&L diario acumulado: $${this.dailyPnL.toFixed(2)}`, "trading");
          
          existing.amount -= volumeNum;
          if (existing.amount <= 0) {
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
        await this.telegramService.sendMessage(`
${emoji} *Operación Automática Ejecutada*

*Tipo:* ${type.toUpperCase()}
*Par:* ${pair}
*Cantidad:* ${volume}
*Precio:* $${price.toFixed(2)}
*Total:* $${totalUSD}
*ID:* ${txid}

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
}
