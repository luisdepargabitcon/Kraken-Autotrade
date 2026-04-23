/**
 * IdcaMarketContextService — Servicio unificado de contexto de mercado
 * 
 * Consolida en una sola fuente:
 * - Anchor price y timestamp
 * - Current price operativo
 * - A-VWAP con bandas
 * - ATR y ATRP
 * - Drawdown desde ancla
 * 
 * Reutiliza cálculos existentes sin romper runtime actual.
 */
import { MarketDataService } from "../MarketDataService";
import { computeVwapAnchored, getVwapBandPosition, OhlcCandle, computeATR, computeATRPct, type VwapResult } from "./IdcaSmartLayer";

export interface MarketContext {
  // Anchor
  anchorPrice: number;
  anchorTimestamp: Date;
  anchorAgeHours: number;
  
  // Current price
  currentPrice: number;
  priceUpdatedAt: Date;
  
  // VWAP
  vwap?: VwapResult;
  vwapZone?: "below_lower3" | "below_lower2" | "below_lower1" | "between_bands" | "above_upper1" | "above_upper2";
  
  // ATR
  atr?: number;
  atrPct?: number;
  
  // Drawdown
  drawdownPct?: number;
  
  // Metadata
  pair: string;
  dataQuality: "excellent" | "good" | "poor" | "insufficient";
  lastUpdated: Date;
}

export interface MarketContextOptions {
  // Lookback periods
  vwapLookbackHours?: number;        // Default: 24h
  atrLookbackHours?: number;         // Default: 24h
  anchorLookbackHours?: number;      // Default: 72h
  
  // Quality thresholds
  minCandlesForVwap?: number;        // Default: 50
  minCandlesForAtr?: number;         // Default: 14
  
  // Cache TTL (ms)
  cacheTtl?: number;                 // Default: 30s
}

class IdcaMarketContextService {
  private cache = new Map<string, { context: MarketContext; expires: number }>();
  private readonly defaultOptions: Required<MarketContextOptions> = {
    vwapLookbackHours: 24,
    atrLookbackHours: 24,
    anchorLookbackHours: 72,
    minCandlesForVwap: 50,
    minCandlesForAtr: 14,
    cacheTtl: 30000, // 30 seconds
  };

  /**
   * Obtiene contexto completo de mercado para un par
   */
  async getMarketContext(pair: string, options: MarketContextOptions = {}): Promise<MarketContext> {
    const opts = { ...this.defaultOptions, ...options };
    const cacheKey = `${pair}_${JSON.stringify(opts)}`;
    
    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() < cached.expires) {
      return cached.context;
    }

    // Fetch data
    const now = new Date();
    const currentPrice = await MarketDataService.getPrice(pair);
    if (!currentPrice) {
      throw new Error(`No current price available for ${pair}`);
    }

    const candles = await MarketDataService.getCandles(pair, "1h");
    if (candles.length < opts.minCandlesForAtr) {
      throw new Error(`Insufficient candles for ${pair}: ${candles.length} < ${opts.minCandlesForAtr}`);
    }

    // Calculate VWAP (si hay suficientes velas)
    let vwap: VwapResult | undefined;
    let vwapZone: MarketContext['vwapZone'] | undefined;
    
    if (candles.length >= opts.minCandlesForVwap) {
      try {
        const anchorTimeMs = Date.now() - opts.vwapLookbackHours * 60 * 60 * 1000;
        vwap = computeVwapAnchored(candles, anchorTimeMs);
        vwapZone = getVwapBandPosition(currentPrice, vwap).zone;
      } catch (error) {
        console.warn(`[IdcaMarketContextService] VWAP calculation failed for ${pair}:`, error);
      }
    }

    // Calculate ATR
    let atr: number | undefined;
    let atrPct: number | undefined;
    
    try {
      atr = computeATR(candles, 14); // 14-period ATR
      atrPct = computeATRPct(candles, 14);
    } catch (error) {
      console.warn(`[IdcaMarketContextService] ATR calculation failed for ${pair}:`, error);
    }

    // Determine anchor (VWAP si es fiable, sino high de ventana)
    let anchorPrice: number;
    let anchorTimestamp: Date;
    
    if (vwap?.isReliable) {
      anchorPrice = vwap.vwap;
      anchorTimestamp = new Date(vwap.anchorTime);
    } else {
      // Fallback a high de ventana extendida
      const anchorCandles = candles.slice(-opts.anchorLookbackHours);
      const highCandle = anchorCandles.reduce((max, c) => c.high > max.high ? c : max, anchorCandles[0]);
      anchorPrice = highCandle.high;
      anchorTimestamp = new Date(highCandle.time);
    }

    // Calculate drawdown
    const drawdownPct = ((anchorPrice - currentPrice) / anchorPrice) * 100;

    // Determine data quality
    let dataQuality: MarketContext['dataQuality'];
    if (candles.length >= 100 && vwap?.isReliable && atr) {
      dataQuality = "excellent";
    } else if (candles.length >= 50 && vwap?.isReliable) {
      dataQuality = "good";
    } else if (candles.length >= 20) {
      dataQuality = "poor";
    } else {
      dataQuality = "insufficient";
    }

    const ohlcCandles: OhlcCandle[] = candles.map((c: any) => ({
      timestamp: c.timestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }));

    const context: MarketContext = {
      anchorPrice,
      anchorTimestamp,
      anchorAgeHours: (now.getTime() - anchorTimestamp.getTime()) / (1000 * 60 * 60),
      currentPrice,
      priceUpdatedAt: now,
      vwap,
      vwapZone,
      atr,
      atrPct,
      drawdownPct,
      pair,
      dataQuality,
      lastUpdated: now,
    };

    // Cache result
    this.cache.set(cacheKey, {
      context,
      expires: Date.now() + opts.cacheTtl,
    });

    return context;
  }

  /**
   * Obtiene múltiples contextos en paralelo
   */
  async getMultipleContexts(pairs: string[], options: MarketContextOptions = {}): Promise<MarketContext[]> {
    const promises = pairs.map(pair => this.getMarketContext(pair, options));
    return Promise.all(promises);
  }

  /**
   * Limpia cache para un par específico o todos
   */
  clearCache(pair?: string): void {
    if (pair) {
      // Eliminar todas las entradas del cache para este par
      for (const [key] of this.cache.entries()) {
        if (key.startsWith(pair + "_")) {
          this.cache.delete(key);
        }
      }
    } else {
      this.cache.clear();
    }
  }

  /**
   * Helper para preview UI - devuelve solo datos necesarios para visualización
   */
  async getPreviewContext(pair: string): Promise<{
    anchorPrice: number;
    currentPrice: number;
    drawdownPct: number;
    vwapZone?: MarketContext['vwapZone'];
    atrPct?: number;
    dataQuality: MarketContext['dataQuality'];
  }> {
    const context = await this.getMarketContext(pair);
    return {
      anchorPrice: context.anchorPrice,
      currentPrice: context.currentPrice,
      drawdownPct: context.drawdownPct || 0,
      vwapZone: context.vwapZone,
      atrPct: context.atrPct,
      dataQuality: context.dataQuality,
    };
  }
}

// Singleton export
export const idcaMarketContextService = new IdcaMarketContextService();
