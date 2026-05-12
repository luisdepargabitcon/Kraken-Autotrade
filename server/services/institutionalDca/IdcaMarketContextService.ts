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
import { buildReferenceContext, type ReferenceContext } from "./IdcaReferenceContext";
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
  referenceContext?: ReferenceContext;

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

// ─── FASE 8: Snapshot compacto del último VWAP válido (en memoria) ────────────
export interface LastValidVwapSnapshot {
  pair: string;
  computedAt: number;
  candlesUsed: number;
  minCandlesRequired: number;
  vwap: number;
  lowerBand1: number;
  lowerBand2: number;
  upperBand1: number;
  upperBand2: number;
  usableForEntry: boolean;
  source: "market_context_service";
}

class IdcaMarketContextService {
  private cache = new Map<string, { context: MarketContext; expires: number }>();
  private anchorChangeMap = new Map<string, { price: number; changedAt: Date }>();
  private readonly ANCHOR_CHANGE_THRESHOLD = 0.005; // 0.5%
  // FASE 8: último VWAP válido por par
  private lastValidVwap = new Map<string, LastValidVwapSnapshot>();
  // FASE 10: contador de ticks con candlesUsed=0 por par
  private candlesZeroCounter = new Map<string, number>();
  private readonly CANDLES_ZERO_WARN_THRESHOLD = 3;
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

    // Umbrales de velas por nivel (documentados explícitamente)
    const MIN_CANDLES_HYBRID_ENGINE = 7;   // mínimo para Hybrid V2.1 en el engine
    const MIN_CANDLES_ATR_CONTEXT   = opts.minCandlesForAtr; // mínimo para ATR/contexto en MCS (default 14)
    const OPTIMAL_CANDLES_VISUAL    = 100; // calidad visual óptima

    const rawCandles = await MarketDataService.getCandles(pair, "1h");
    if (rawCandles.length < MIN_CANDLES_ATR_CONTEXT) {
      // L1.3: Retorno degradado en lugar de throw — no romper la tarjeta de contexto si hay
      // entre MIN_CANDLES_HYBRID_ENGINE (7) y MIN_CANDLES_ATR_CONTEXT (14) velas.
      // El engine puede operar con 7 velas; MCS degrada su output pero no falla.
      // Este retorno NO permite entradas — MCS nunca controla la lógica de entrada del engine.
      console.warn(
        `[IDCA][MARKET_DATA_WARMUP] pair=${pair}` +
        ` candlesLoaded=${rawCandles.length} minForAtr=${MIN_CANDLES_ATR_CONTEXT}` +
        ` minForEngine=${MIN_CANDLES_HYBRID_ENGINE} status=degraded_context`
      );
      const degradedContext: MarketContext = {
        anchorPrice:              currentPrice,
        anchorTimestamp:          now,
        anchorAgeHours:           0,
        currentPrice,
        priceUpdatedAt:           now,
        drawdownPct:              0,
        effectiveEntryReference:  currentPrice,
        effectiveReferenceSource: "hybrid_v2_fallback",
        effectiveReferenceLabel:  `Sin datos suficientes (${rawCandles.length}/${MIN_CANDLES_ATR_CONTEXT} velas para ATR). Motor puede evaluar Hybrid si hay \u2265${MIN_CANDLES_HYBRID_ENGINE}.`,
        technicalBasePrice:       0,
        technicalBaseType:        "none",
        referenceChangedRecently: false,
        pair,
        dataQuality:              "insufficient",
        lastUpdated:              now,
        anchorPriceUpdatedAt:     now,
        anchorSource:             "window_high",
        qualityDetail: {
          status:             "poor",
          reason:             "insufficient_candles",
          candleCount:        rawCandles.length,
          requiredForOptimal: OPTIMAL_CANDLES_VISUAL,
          hasVwap:            false,
          hasAtrp:            false,
        },
      };
      return degradedContext;
    }

    // FASE 7: Convertir OHLC.time de segundos (Kraken) a milisegundos para computeBasePrice y computeVwapAnchored.
    // IdcaEngine hace esta conversión via mapKrakenCandles(c.time * 1000).
    // MarketDataService.getCandles devuelve OHLC[] directamente del exchange con time en segundos.
    const candles = rawCandles.map((c: any) => ({
      ...c,
      time: c.time > 1e12 ? c.time : c.time * 1000,
    }));

    // FASE 6: Log warm-up si hay pocas velas
    const MIN_WARMUP_CANDLES = 24;
    if (candles.length < MIN_WARMUP_CANDLES) {
      console.log(
        `[IDCA][MARKET_DATA_WARMUP] pair=${pair}` +
        ` candlesLoaded=${candles.length} required=${MIN_WARMUP_CANDLES}` +
        ` status=warming_up reason=insufficient_candles_in_mds`
      );
    }

    // Calculate VWAP (si hay suficientes velas)
    let vwap: VwapResult | undefined;
    let vwapZone: MarketContext['vwapZone'] | undefined;
    let vwapCandlesUsed = 0;
    
    if (candles.length >= opts.minCandlesForVwap) {
      try {
        const anchorTimeMs = Date.now() - opts.vwapLookbackHours * 60 * 60 * 1000;
        vwap = computeVwapAnchored(candles, anchorTimeMs);
        vwapCandlesUsed = (vwap as any).candlesUsed ?? 0;
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

    // FASE 7: Calcular basePriceResult con velas ya convertidas a ms
    let basePriceResult: BasePriceResult;
    try {
      basePriceResult = computeBasePrice({
        candles: candles as any, // candles ya tienen time en ms
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

    // FASE 6: Log warm-up OK cuando hay velas suficientes
    const hybridCandleCount = basePriceResult.meta?.candleCount ?? 0;
    if (hybridCandleCount >= MIN_WARMUP_CANDLES) {
      console.log(
        `[IDCA][MARKET_DATA_WARMUP] pair=${pair}` +
        ` candlesLoaded=${hybridCandleCount} required=${MIN_WARMUP_CANDLES}` +
        ` status=ready`
      );
    }

    // FASE 10: Contador candlesUsed=0 por par — warning tras 3 repeticiones
    const effectiveCandlesUsed = vwapCandlesUsed > 0 ? vwapCandlesUsed : hybridCandleCount;
    if (effectiveCandlesUsed === 0) {
      const prev = this.candlesZeroCounter.get(pair) ?? 0;
      const next = prev + 1;
      this.candlesZeroCounter.set(pair, next);
      if (next >= this.CANDLES_ZERO_WARN_THRESHOLD) {
        console.warn(
          `[IDCA][MARKET_DATA_WARNING] pair=${pair}` +
          ` reason=vwap_candles_zero repeated=${next}`
        );
      }
    } else {
      this.candlesZeroCounter.set(pair, 0);
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
    const vwapEnabled = assetConfig?.vwapEnabled ?? false; // Usar config del asset, fallback false (igual que schema default)

    // FASE 7: Construir vwapContextForRef con candlesUsed real para buildReferenceContext
    const vwapContextForRef = vwap
      ? { isReliable: vwap.isReliable, candlesUsed: vwapCandlesUsed } as any
      : (hybridCandleCount > 0 ? { isReliable: false, candlesUsed: hybridCandleCount } as any : undefined);

    const refResult = resolveEffectiveEntryReference({
      pair,
      currentPrice,
      basePriceResult,
      frozenAnchor,
      vwapContext: vwapContextForRef,
      vwapEnabled,
      now: now.getTime(),
    });

    // L1.1: drawdownPct calculado desde effectiveEntryReference (mismo origen que el engine)
    // Fallback a anchorPrice legacy solo si effectiveEntryReference no está disponible o es 0
    const drawdownPct = refResult.effectiveEntryReference > 0
      ? ((refResult.effectiveEntryReference - currentPrice) / refResult.effectiveEntryReference) * 100
      : ((anchorPrice - currentPrice) / anchorPrice) * 100;

    // FASE 8: Actualizar lastValidVwap si VWAP actual es fiable
    if (vwap?.isReliable && vwapCandlesUsed >= 24) {
      this.lastValidVwap.set(pair, {
        pair,
        computedAt: now.getTime(),
        candlesUsed: vwapCandlesUsed,
        minCandlesRequired: 24,
        vwap: vwap.vwap,
        lowerBand1: vwap.lowerBand1,
        lowerBand2: vwap.lowerBand2,
        upperBand1: vwap.upperBand1,
        upperBand2: vwap.upperBand2,
        usableForEntry: vwapCandlesUsed >= 24,
        source: "market_context_service",
      });
    }

    const referenceContext = buildReferenceContext({
      pair,
      refResult,
      basePriceResult,
      vwapEnabled,
      frozenAnchor,
      vwapContext: vwapContextForRef,
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
      referenceContext,
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
   * FASE 8: Obtiene el último snapshot de VWAP válido para un par (solo informativo/visual)
   */
  getLastValidVwap(pair: string): LastValidVwapSnapshot | undefined {
    return this.lastValidVwap.get(pair);
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
    referenceContext?: ReferenceContext;
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
      referenceContext: context.referenceContext,
    };
  }
}

// Singleton export
export const idcaMarketContextService = new IdcaMarketContextService();
