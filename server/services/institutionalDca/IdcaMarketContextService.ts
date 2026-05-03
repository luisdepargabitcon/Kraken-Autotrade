/**
 * IdcaMarketContextService — Servicio unificado de contexto de mercado
 *
 * Consolida en una sola fuente:
 * - Anchor price y timestamp
 * - Current price operativo
 * - A-VWAP con bandas
 * - ATR y ATRP
 * - Drawdown desde ancla
 * - Referencia efectiva de entrada (usando resolver canónico)
 *
 * Reutiliza cálculos existentes sin romper runtime actual.
 */
import { MarketDataService } from "../MarketDataService";
import { computeVwapAnchored, getVwapBandPosition, OhlcCandle, computeATR, computeATRPct, computeBasePrice, type VwapResult } from "./IdcaSmartLayer";
import { resolveEffectiveEntryReference, type VwapAnchorState } from "./IdcaEntryReferenceResolver";
import type { BasePriceResult } from "./IdcaTypes";
import { getAssetConfig, getVwapAnchor } from "./IdcaRepository";

export interface MarketContext {
  // Anchor (legacy, mantenido para compatibilidad)
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

  // Referencia efectiva de entrada (resolver canónico)
  effectiveEntryReference: number;
  effectiveReferenceSource: "vwap_anchor" | "hybrid_v2_fallback";
  effectiveReferenceLabel: string;
  technicalBasePrice: number;
  technicalBaseType: string;
  technicalBaseReason?: string;
  technicalBaseTimestamp?: string;
  frozenAnchorPrice?: number;
  frozenAnchorTs?: number;
  frozenAnchorAgeHours?: number;
  frozenAnchorCandleAgeHours?: number;
  referenceChangedRecently: boolean;
  referenceUpdatedAt?: string;

  // Metadata
  pair: string;
  dataQuality: "excellent" | "good" | "poor" | "insufficient";
  lastUpdated: Date;
  anchorPriceUpdatedAt: Date;
  anchorSource: "vwap" | "window_high" | "frozen";

  // Calidad de datos estructurada (para UI y narrativa)
  qualityDetail: {
    status: "ok" | "partial" | "poor";
    reason: "ok" | "warming_up_cache" | "insufficient_candles" | "stale_market_data" | "missing_atrp" | "missing_vwap_zone" | "missing_anchor";
    candleCount: number;
    requiredForOptimal: number;
    hasVwap: boolean;
    hasAtrp: boolean;
  };
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
  private anchorChangeMap = new Map<string, { price: number; changedAt: Date }>();
  private readonly ANCHOR_CHANGE_THRESHOLD = 0.005; // 0.5%
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
  async getMarketContext(pair: string, options: MarketContextOptions & { frozenAnchorPrice?: number } = {}): Promise<MarketContext> {
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

    // Determine anchor (frozenAnchorPrice si está disponible, sino VWAP si fiable, sino high de ventana)
    let anchorPrice: number;
    let anchorTimestamp: Date;
    
    // Prioridad 1: frozenAnchorPrice (VWAP Anchor guardado en memoria) - alineado con IdcaEngine
    let anchorSource: MarketContext['anchorSource'];
    if (options.frozenAnchorPrice && options.frozenAnchorPrice > 0) {
      anchorPrice = options.frozenAnchorPrice;
      anchorTimestamp = new Date(); // frozenAnchor no tiene timestamp explícito aquí
      anchorSource = "frozen";
    } else if (vwap?.isReliable) {
      // Prioridad 2: VWAP si es fiable
      anchorPrice = vwap.vwap;
      anchorTimestamp = new Date(vwap.anchorTime);
      anchorSource = "vwap";
    } else {
      // Prioridad 3: Fallback a high de ventana extendida
      const anchorCandles = candles.slice(-opts.anchorLookbackHours);
      const highCandle = anchorCandles.reduce((max, c) => c.high > max.high ? c : max, anchorCandles[0]);
      anchorPrice = highCandle.high;
      anchorTimestamp = new Date(highCandle.time);
      anchorSource = "window_high";
    }

    // Track anchor price changes (in-memory, resets on restart)
    const prevAnchor = this.anchorChangeMap.get(pair);
    if (!prevAnchor || Math.abs((anchorPrice - prevAnchor.price) / prevAnchor.price) > this.ANCHOR_CHANGE_THRESHOLD) {
      this.anchorChangeMap.set(pair, { price: anchorPrice, changedAt: new Date() });
    }
    const anchorPriceUpdatedAt = this.anchorChangeMap.get(pair)!.changedAt;

    // Calculate drawdown
    const drawdownPct = ((anchorPrice - currentPrice) / anchorPrice) * 100;

    // Determine data quality (legacy 4-level, kept for backward compat)
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

    // Calidad estructurada con motivo específico
    const hasVwap = !!vwapZone;
    const hasAtrp = !!atrPct;
    let qualityStatus: MarketContext['qualityDetail']['status'];
    let qualityReason: MarketContext['qualityDetail']['reason'];
    const OPTIMAL_CANDLES = 100;

    // Si la referencia efectiva viene de frozenAnchor (VWAP Anclado), no marcar como "falta VWAP"
    // incluso si el cálculo actual de VWAP no está disponible
    const usingFrozenAnchor = options.frozenAnchorPrice && options.frozenAnchorPrice > 0;

    if (candles.length >= 50 && (vwap?.isReliable || usingFrozenAnchor) && hasAtrp) {
      qualityStatus = "ok";
      qualityReason = "ok";
    } else if (candles.length >= 20) {
      qualityStatus = "partial";
      if (candles.length < 50) {
        qualityReason = "warming_up_cache";
      } else if (!vwap?.isReliable && !usingFrozenAnchor) {
        qualityReason = "missing_vwap_zone";
      } else if (!hasAtrp) {
        qualityReason = "missing_atrp";
      } else {
        qualityReason = "ok"; // Tiene frozenAnchor, calidad aceptable
      }
    } else {
      qualityStatus = "poor";
      qualityReason = "insufficient_candles";
    }

    const qualityDetail: MarketContext['qualityDetail'] = {
      status: qualityStatus,
      reason: qualityReason,
      candleCount: candles.length,
      requiredForOptimal: OPTIMAL_CANDLES,
      hasVwap,
      hasAtrp,
    };

    const ohlcCandles: OhlcCandle[] = candles.map((c: any) => ({
      timestamp: c.timestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }));

    // Calcular basePriceResult para el resolver canónico
    let basePriceResult: BasePriceResult;
    try {
      basePriceResult = computeBasePrice({
        candles: candles as any, // candles tiene formato TimestampedCandle[]
        lookbackMinutes: 1440,
        method: "hybrid",
        currentPrice,
        pair,
      });
    } catch (error) {
      console.warn(`[IdcaMarketContextService] Base price calculation failed for ${pair}:`, error);
      // Fallback a high de ventana
      const highCandle = candles.reduce((max, c) => c.high > max.high ? c : max, candles[0]);
      basePriceResult = {
        price: highCandle.high,
        type: "swing_high_1h",
        windowMinutes: 1440,
        timestamp: new Date(highCandle.time),
        isReliable: false,
        reason: "Fallback to window high",
      };
    }

    // Obtener frozenAnchor para el resolver (desde DB para evitar circular import)
    let frozenAnchor: VwapAnchorState | undefined = undefined;
    try {
      const dbAnchor = await getVwapAnchor(pair);
      if (dbAnchor) {
        frozenAnchor = {
          anchorPrice: dbAnchor.anchor_price,
          anchorTimestamp: dbAnchor.anchor_ts,
          setAt: dbAnchor.set_at,
          drawdownPct: dbAnchor.drawdown_pct,
          previous: dbAnchor.prev_price ? {
            anchorPrice: dbAnchor.prev_price,
            anchorTimestamp: dbAnchor.prev_ts!,
            setAt: dbAnchor.prev_set_at!,
            replacedAt: dbAnchor.prev_replaced_at!,
          } : undefined,
        };
      }
    } catch (error) {
      // Silencioso - puede no haber anchor persistido
    }

    // Usar el resolver canónico para obtener la referencia efectiva
    const assetConfig = await getAssetConfig(pair);
    const vwapEnabled = assetConfig?.vwapEnabled ?? true; // Usar config del asset, fallback true para compatibilidad
    const refResult = resolveEffectiveEntryReference({
      pair,
      currentPrice,
      basePriceResult,
      frozenAnchor,
      vwapContext: vwap ? { isReliable: vwap.isReliable } as any : undefined,
      vwapEnabled,
      now: now.getTime(),
    });

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
      // Referencia efectiva de entrada
      effectiveEntryReference: refResult.effectiveEntryReference,
      effectiveReferenceSource: refResult.effectiveReferenceSource,
      effectiveReferenceLabel: refResult.effectiveReferenceLabel,
      technicalBasePrice: refResult.technicalBasePrice,
      technicalBaseType: refResult.technicalBaseType,
      technicalBaseReason: refResult.technicalBaseReason,
      technicalBaseTimestamp: refResult.technicalBaseTimestamp,
      frozenAnchorPrice: refResult.frozenAnchorPrice,
      frozenAnchorTs: refResult.frozenAnchorTs,
      frozenAnchorAgeHours: refResult.frozenAnchorAgeHours,
      frozenAnchorCandleAgeHours: refResult.frozenAnchorCandleAgeHours,
      referenceChangedRecently: refResult.referenceChangedRecently,
      referenceUpdatedAt: refResult.referenceUpdatedAt,
      pair,
      dataQuality,
      lastUpdated: now,
      anchorPriceUpdatedAt,
      anchorSource,
      qualityDetail,
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
    priceUpdatedAt: Date;
    lastUpdated: Date;
    anchorPriceUpdatedAt: Date;
    anchorAgeHours: number;
    anchorSource: MarketContext['anchorSource'];
    qualityDetail: MarketContext['qualityDetail'];
    // Referencia efectiva de entrada
    effectiveEntryReference: number;
    effectiveReferenceSource: "vwap_anchor" | "hybrid_v2_fallback";
    effectiveReferenceLabel: string;
    technicalBasePrice: number;
    technicalBaseType: string;
    technicalBaseReason?: string;
    technicalBaseTimestamp?: string;
    frozenAnchorPrice?: number;
    frozenAnchorTs?: number;
    frozenAnchorAgeHours?: number;
    frozenAnchorCandleAgeHours?: number;
    referenceChangedRecently: boolean;
    referenceUpdatedAt?: string;
  }> {
    const context = await this.getMarketContext(pair);
    return {
      anchorPrice: context.anchorPrice,
      currentPrice: context.currentPrice,
      drawdownPct: context.drawdownPct || 0,
      vwapZone: context.vwapZone,
      atrPct: context.atrPct,
      dataQuality: context.dataQuality,
      priceUpdatedAt: context.priceUpdatedAt,
      lastUpdated: context.lastUpdated,
      anchorPriceUpdatedAt: context.anchorPriceUpdatedAt,
      anchorAgeHours: context.anchorAgeHours,
      anchorSource: context.anchorSource,
      qualityDetail: context.qualityDetail,
      // Referencia efectiva de entrada
      effectiveEntryReference: context.effectiveEntryReference,
      effectiveReferenceSource: context.effectiveReferenceSource,
      effectiveReferenceLabel: context.effectiveReferenceLabel,
      technicalBasePrice: context.technicalBasePrice,
      technicalBaseType: context.technicalBaseType,
      technicalBaseReason: context.technicalBaseReason,
      technicalBaseTimestamp: context.technicalBaseTimestamp,
      frozenAnchorPrice: context.frozenAnchorPrice,
      frozenAnchorTs: context.frozenAnchorTs,
      frozenAnchorAgeHours: context.frozenAnchorAgeHours,
      frozenAnchorCandleAgeHours: context.frozenAnchorCandleAgeHours,
      referenceChangedRecently: context.referenceChangedRecently,
      referenceUpdatedAt: context.referenceUpdatedAt,
    };
  }
}

// Singleton export
export const idcaMarketContextService = new IdcaMarketContextService();
