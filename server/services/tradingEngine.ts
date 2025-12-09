import { KrakenService } from "./kraken";
import { TelegramService } from "./telegram";
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
  "ETH/USD": 0.004,
  "SOL/USD": 0.02,
};

export class TradingEngine {
  private krakenService: KrakenService;
  private telegramService: TelegramService;
  private isRunning: boolean = false;
  private intervalId: NodeJS.Timeout | null = null;
  private priceHistory: Map<string, PriceData[]> = new Map();
  private lastTradeTime: Map<string, number> = new Map();
  private openPositions: Map<string, { amount: number; entryPrice: number }> = new Map();
  private currentUsdBalance: number = 0;
  private readonly PRICE_HISTORY_LENGTH = 50;
  private readonly MIN_TRADE_INTERVAL_MS = 60000;

  constructor(krakenService: KrakenService, telegramService: TelegramService) {
    this.krakenService = krakenService;
    this.telegramService = telegramService;
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

  private async runTradingCycle() {
    try {
      const config = await storage.getBotConfig();
      if (!config?.isActive) {
        await this.stop();
        return;
      }

      const balances = await this.krakenService.getBalance();
      this.currentUsdBalance = parseFloat(balances?.ZUSD || balances?.USD || "0");
      
      if (this.currentUsdBalance < 5) {
        log(`Saldo USD insuficiente: $${this.currentUsdBalance.toFixed(2)}`, "trading");
        return;
      }

      const riskConfig = RISK_LEVELS[config.riskLevel] || RISK_LEVELS.medium;

      for (const pair of config.activePairs) {
        await this.analyzePairAndTrade(pair, config.strategy, riskConfig, balances);
      }
    } catch (error: any) {
      log(`Error en ciclo de trading: ${error.message}`, "trading");
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

      const signal = this.analyzeWithStrategy(strategy, pair, history, currentPrice);
      
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

        if (this.currentUsdBalance < riskConfig.minTradeUSD) {
          log(`Saldo USD insuficiente para comprar: $${this.currentUsdBalance.toFixed(2)}`, "trading");
          return;
        }

        const tradeAmountUSD = Math.min(
          this.currentUsdBalance * (riskConfig.maxPositionPercent / 100),
          riskConfig.maxTradeUSD
        );

        if (tradeAmountUSD < riskConfig.minTradeUSD) {
          log(`Monto de compra muy bajo: $${tradeAmountUSD.toFixed(2)}`, "trading");
          return;
        }

        const tradeVolume = tradeAmountUSD / currentPrice;
        const minVolume = KRAKEN_MINIMUMS[pair] || 0.01;

        if (tradeVolume < minVolume) {
          log(`Volumen menor al mínimo de Kraken: ${tradeVolume} < ${minVolume}`, "trading");
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

  private analyzeWithStrategy(
    strategy: string,
    pair: string,
    history: PriceData[],
    currentPrice: number
  ): TradeSignal {
    switch (strategy) {
      case "momentum":
        return this.momentumStrategy(pair, history, currentPrice);
      case "mean_reversion":
        return this.meanReversionStrategy(pair, history, currentPrice);
      case "scalping":
        return this.scalpingStrategy(pair, history, currentPrice);
      case "grid":
        return this.gridStrategy(pair, history, currentPrice);
      default:
        return { action: "hold", pair, confidence: 0, reason: "Estrategia desconocida" };
    }
  }

  private momentumStrategy(pair: string, history: PriceData[], currentPrice: number): TradeSignal {
    const prices = history.map(h => h.price);
    const shortEMA = this.calculateEMA(prices.slice(-10), 10);
    const longEMA = this.calculateEMA(prices.slice(-20), 20);
    const rsi = this.calculateRSI(prices.slice(-14));
    
    const trend = (currentPrice - prices[0]) / prices[0] * 100;
    
    if (shortEMA > longEMA && rsi < 70 && trend > 1) {
      return {
        action: "buy",
        pair,
        confidence: Math.min(0.9, 0.6 + (trend / 10)),
        reason: `Momentum alcista: EMA corta > EMA larga, RSI=${rsi.toFixed(0)}, Tendencia +${trend.toFixed(2)}%`,
      };
    }
    
    if (shortEMA < longEMA && rsi > 30 && trend < -1) {
      return {
        action: "sell",
        pair,
        confidence: Math.min(0.9, 0.6 + (Math.abs(trend) / 10)),
        reason: `Momentum bajista: EMA corta < EMA larga, RSI=${rsi.toFixed(0)}, Tendencia ${trend.toFixed(2)}%`,
      };
    }

    return { action: "hold", pair, confidence: 0.3, reason: "Sin señal clara de momentum" };
  }

  private meanReversionStrategy(pair: string, history: PriceData[], currentPrice: number): TradeSignal {
    const prices = history.map(h => h.price);
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const stdDev = Math.sqrt(prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length);
    
    const zScore = (currentPrice - mean) / stdDev;
    
    if (zScore < -1.5) {
      return {
        action: "buy",
        pair,
        confidence: Math.min(0.9, 0.6 + (Math.abs(zScore) / 5)),
        reason: `Precio por debajo de media: Z-Score=${zScore.toFixed(2)}, esperando reversión al alza`,
      };
    }
    
    if (zScore > 1.5) {
      return {
        action: "sell",
        pair,
        confidence: Math.min(0.9, 0.6 + (zScore / 5)),
        reason: `Precio por encima de media: Z-Score=${zScore.toFixed(2)}, esperando reversión a la baja`,
      };
    }

    return { action: "hold", pair, confidence: 0.3, reason: "Precio cerca de la media" };
  }

  private scalpingStrategy(pair: string, history: PriceData[], currentPrice: number): TradeSignal {
    if (history.length < 3) {
      return { action: "hold", pair, confidence: 0, reason: "Datos insuficientes" };
    }

    const recentPrices = history.slice(-5).map(h => h.price);
    const avgPrice = recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length;
    const priceChange = (currentPrice - avgPrice) / avgPrice * 100;
    
    const volatility = this.calculateVolatility(recentPrices);
    
    if (priceChange < -0.3 && volatility > 0.2) {
      return {
        action: "buy",
        pair,
        confidence: 0.7,
        reason: `Scalping: Caída rápida ${priceChange.toFixed(2)}%, volatilidad ${volatility.toFixed(2)}%`,
      };
    }
    
    if (priceChange > 0.3 && volatility > 0.2) {
      return {
        action: "sell",
        pair,
        confidence: 0.7,
        reason: `Scalping: Subida rápida +${priceChange.toFixed(2)}%, volatilidad ${volatility.toFixed(2)}%`,
      };
    }

    return { action: "hold", pair, confidence: 0.3, reason: "Sin oportunidad de scalping" };
  }

  private gridStrategy(pair: string, history: PriceData[], currentPrice: number): TradeSignal {
    if (history.length < 10) {
      return { action: "hold", pair, confidence: 0, reason: "Datos insuficientes para grid" };
    }

    const prices = history.map(h => h.price);
    const high = Math.max(...prices);
    const low = Math.min(...prices);
    const range = high - low;
    const gridSize = range / 5;
    
    const currentLevel = Math.floor((currentPrice - low) / gridSize);
    const prevPrice = prices[prices.length - 2];
    const prevLevel = Math.floor((prevPrice - low) / gridSize);
    
    if (currentLevel < prevLevel && currentLevel <= 1) {
      return {
        action: "buy",
        pair,
        confidence: 0.75,
        reason: `Grid: Precio bajó al nivel ${currentLevel}/5, comprando en soporte`,
      };
    }
    
    if (currentLevel > prevLevel && currentLevel >= 4) {
      return {
        action: "sell",
        pair,
        confidence: 0.75,
        reason: `Grid: Precio subió al nivel ${currentLevel}/5, vendiendo en resistencia`,
      };
    }

    return { action: "hold", pair, confidence: 0.3, reason: `Grid: Precio en nivel ${currentLevel}/5` };
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
    };
    return pairMap[pair] || pair.replace("/", "");
  }

  private getAssetBalance(pair: string, balances: any): number {
    const asset = pair.split("/")[0];
    const assetMap: Record<string, string[]> = {
      "BTC": ["XXBT", "XBT", "BTC"],
      "ETH": ["XETH", "ETH"],
      "SOL": ["SOL"],
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
        const existing = this.openPositions.get(pair) || { amount: 0, entryPrice: 0 };
        const totalAmount = existing.amount + volumeNum;
        const avgPrice = (existing.amount * existing.entryPrice + volumeNum * price) / totalAmount;
        this.openPositions.set(pair, { amount: totalAmount, entryPrice: avgPrice });
      } else {
        this.currentUsdBalance += volumeNum * price;
        const existing = this.openPositions.get(pair);
        if (existing) {
          existing.amount -= volumeNum;
          if (existing.amount <= 0) {
            this.openPositions.delete(pair);
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
      return true;
    } catch (error: any) {
      log(`Error ejecutando orden: ${error.message}`, "trading");
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

  isActive(): boolean {
    return this.isRunning;
  }
}
