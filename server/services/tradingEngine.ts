import { KrakenService } from "./kraken";
import { TelegramService } from "./telegram";
import { botLogger } from "./botLogger";
import { storage } from "../storage";
import { log } from "../index";
import { aiService, AiFeatures } from "./aiService";
import { environment } from "./environment";
import { fifoMatcher } from "./fifoMatcher";
import { toConfidencePct, toConfidenceUnit } from "../utils/confidence";

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

const DUST_THRESHOLD_USD = 5; // Minimum USD value to attempt selling

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

// SMART_GUARD: umbral absoluto mínimo para evitar comisiones absurdas
const SG_ABSOLUTE_MIN_USD = 20;

// === VALIDACIÓN CENTRALIZADA DE MÍNIMOS (fuente única de verdad) ===
// Reason codes para SMART_GUARD sizing
type SmartGuardReasonCode = 
  | "SMART_GUARD_BLOCKED_BELOW_EXCHANGE_MIN"   // saldo < floorUsd (hard block)
  | "SMART_GUARD_BLOCKED_AFTER_FEE_CUSHION"    // availableAfterCushion < floorUsd
  | "SMART_GUARD_ENTRY_USING_CONFIG_MIN"       // saldo >= sgMinEntryUsd, usando sgMinEntryUsd
  | "SMART_GUARD_ENTRY_FALLBACK_TO_AVAILABLE"; // saldo < sgMinEntryUsd, usando saldo disponible

interface MinimumValidationParams {
  positionMode: string;
  orderUsdFinal: number;
  orderUsdProposed: number;
  usdDisponible: number;
  exposureAvailable: number;
  pair: string;
  sgMinEntryUsd?: number;
  sgAllowUnderMin?: boolean; // DEPRECATED - se ignora (siempre auto fallback)
  dryRun?: boolean;
  env?: string;
  floorUsd?: number;
  availableAfterCushion?: number;
}

interface MinimumValidationResult {
  valid: boolean;
  skipReason?: SmartGuardReasonCode | "MIN_ORDER_ABSOLUTE" | "MIN_ORDER_USD";
  reasonCode?: SmartGuardReasonCode;
  message?: string;
  meta?: Record<string, any>;
}

function validateMinimumsOrSkip(params: MinimumValidationParams): MinimumValidationResult {
  const {
    positionMode,
    orderUsdFinal,
    orderUsdProposed,
    usdDisponible,
    exposureAvailable,
    pair,
    sgMinEntryUsd = 100,
    sgAllowUnderMin = true, // DEPRECATED - ignorado
    dryRun = false,
    env = "UNKNOWN",
    floorUsd,
    availableAfterCushion,
  } = params;

  const effectiveFloor = floorUsd ?? SG_ABSOLUTE_MIN_USD;

  const meta = {
    pair,
    usdDisponible,
    orderUsdProposed,
    orderUsdFinal,
    sgMinEntryUsd,
    sgAllowUnderMin_DEPRECATED: sgAllowUnderMin,
    exposureAvailable,
    env,
    dryRun,
    absoluteMinUsd: SG_ABSOLUTE_MIN_USD,
    floorUsd: effectiveFloor,
    availableAfterCushion,
  };

  // REGLA 1: Hard block - si orderUsdFinal < floorUsd (exchange min + absoluto)
  if (orderUsdFinal < effectiveFloor) {
    return {
      valid: false,
      skipReason: "SMART_GUARD_BLOCKED_BELOW_EXCHANGE_MIN",
      reasonCode: "SMART_GUARD_BLOCKED_BELOW_EXCHANGE_MIN",
      message: `Trade bloqueado: orderUsdFinal $${orderUsdFinal.toFixed(2)} < floorUsd $${effectiveFloor.toFixed(2)} (mín exchange + absoluto)`,
      meta,
    };
  }

  // REGLA 2: Hard block - si availableAfterCushion < floorUsd (fee cushion applied)
  if (availableAfterCushion !== undefined && availableAfterCushion < effectiveFloor) {
    return {
      valid: false,
      skipReason: "SMART_GUARD_BLOCKED_AFTER_FEE_CUSHION",
      reasonCode: "SMART_GUARD_BLOCKED_AFTER_FEE_CUSHION",
      message: `Trade bloqueado: availableAfterCushion $${availableAfterCushion.toFixed(2)} < floorUsd $${effectiveFloor.toFixed(2)}`,
      meta,
    };
  }

  // Fallback para modos no-SMART_GUARD
  if (orderUsdFinal < SG_ABSOLUTE_MIN_USD) {
    return {
      valid: false,
      skipReason: "MIN_ORDER_ABSOLUTE",
      message: `Trade bloqueado: orderUsdFinal $${orderUsdFinal.toFixed(2)} < mínimo absoluto $${SG_ABSOLUTE_MIN_USD}`,
      meta,
    };
  }

  return { valid: true };
}

interface ConfigSnapshot {
  stopLossPercent: number;
  takeProfitPercent: number;
  trailingStopEnabled: boolean;
  trailingStopPercent: number;
  positionMode: string;
  // SMART_GUARD specific fields (only populated when positionMode === "SMART_GUARD")
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

interface OpenPosition {
  lotId: string; // Unique identifier for this lot (multi-lot support)
  pair: string; // Pair for this position
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
  // SMART_GUARD dynamic state
  sgBreakEvenActivated?: boolean;
  sgCurrentStopPrice?: number;
  sgTrailingActivated?: boolean;
  sgScaleOutDone?: boolean;
}

function generateLotId(pair: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `LOT-${pair.replace("/", "")}-${timestamp}-${random}`;
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

// === MARKET REGIME DETECTION ===
type MarketRegime = "TREND" | "RANGE" | "TRANSITION";

interface RegimeAnalysis {
  regime: MarketRegime;
  adx: number;
  emaAlignment: number; // -1 to 1 (bearish to bullish alignment)
  bollingerWidth: number; // Percentage width of bands
  confidence: number;
  reason: string;
}

interface RegimePreset {
  sgBeAtPct: number;
  sgTrailDistancePct: number;
  sgTrailStepPct: number;
  sgTpFixedPct: number;
  minSignals: number;
  pauseEntries: boolean;
}

const REGIME_PRESETS: Record<MarketRegime, RegimePreset> = {
  TREND: {
    sgBeAtPct: 2.5,        // Break-even más tarde (dejar correr)
    sgTrailDistancePct: 2.0, // Trailing más amplio
    sgTrailStepPct: 0.5,   // Steps más grandes
    sgTpFixedPct: 8.0,     // TP más ambicioso
    minSignals: 5,         // Mantener 5 señales (no bajar)
    pauseEntries: false,
  },
  RANGE: {
    sgBeAtPct: 1.0,        // Break-even rápido (asegurar)
    sgTrailDistancePct: 1.0, // Trailing ajustado
    sgTrailStepPct: 0.2,   // Steps pequeños
    sgTpFixedPct: 3.0,     // TP conservador
    minSignals: 6,         // Más exigente en lateral
    pauseEntries: false,
  },
  TRANSITION: {
    sgBeAtPct: 1.5,        // Valores base (sin cambio)
    sgTrailDistancePct: 1.5,
    sgTrailStepPct: 0.25,
    sgTpFixedPct: 5.0,
    minSignals: 5,
    pauseEntries: true,    // Pausar nuevas entradas
  },
};

export class TradingEngine {
  private krakenService: KrakenService;
  private telegramService: TelegramService;
  private isRunning: boolean = false;
  private intervalId: NodeJS.Timeout | null = null;
  private priceHistory: Map<string, PriceData[]> = new Map();
  private lastTradeTime: Map<string, number> = new Map();
  private openPositions: Map<string, OpenPosition> = new Map(); // Key is lotId for multi-lot support
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
  
  // Fallback minimums (only used if Kraken API fails)
  private readonly FALLBACK_MINIMUMS: Record<string, number> = {
    "BTC/USD": 0.0001,
    "ETH/USD": 0.01,
    "SOL/USD": 0.02,
    "XRP/USD": 1.65,
    "TON/USD": 1,
    "ETH/BTC": 0.01,
  };

  private normalizeVolume(pair: string, volume: number): number {
    const stepSize = this.krakenService.getStepSize(pair);
    if (stepSize === null) {
      log(`[WARNING] No step size for ${pair}, using 8 decimal fallback`, "trading");
      const fallbackDecimals = 8;
      return Math.floor(volume * Math.pow(10, fallbackDecimals)) / Math.pow(10, fallbackDecimals);
    }
    const decimals = Math.abs(Math.log10(stepSize));
    return Math.floor(volume * Math.pow(10, decimals)) / Math.pow(10, decimals);
  }

  private getOrderMin(pair: string): number {
    const orderMin = this.krakenService.getOrderMin(pair);
    if (orderMin === null) {
      log(`[WARNING] No orderMin for ${pair}, using fallback`, "trading");
      return this.FALLBACK_MINIMUMS[pair] || 0.01;
    }
    return orderMin;
  }

  private hasPairMetadata(pair: string): boolean {
    return this.krakenService.hasMetadata(pair);
  }
  
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
  
  // SMART_GUARD alert throttle: key = "lotId:eventType", value = timestamp
  private sgAlertThrottle: Map<string, number> = new Map();
  private readonly SG_TRAIL_UPDATE_THROTTLE_MS = 5 * 60 * 1000; // 5 minutes between trailing stop updates
  
  // DRY_RUN mode: audit without sending real orders
  private dryRunMode: boolean = false;
  private readonly isReplitEnvironment: boolean = !!process.env.REPLIT_DEPLOYMENT || !!process.env.REPL_ID;

  // Market Regime Detection
  private regimeCache: Map<string, { regime: RegimeAnalysis; timestamp: number }> = new Map();
  private readonly REGIME_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  private lastRegime: Map<string, MarketRegime> = new Map(); // Track last regime for change alerts

  constructor(krakenService: KrakenService, telegramService: TelegramService) {
    this.krakenService = krakenService;
    this.telegramService = telegramService;
    
    // Auto-enable dry run on Replit to prevent accidental real trades
    if (this.isReplitEnvironment) {
      this.dryRunMode = true;
      log("[SAFETY] Entorno Replit detectado - DRY_RUN activado automáticamente", "trading");
    }
  }

  // === MULTI-LOT HELPERS ===
  private getPositionsByPair(pair: string): OpenPosition[] {
    const positions: OpenPosition[] = [];
    this.openPositions.forEach((position) => {
      if (position.pair === pair) {
        positions.push(position);
      }
    });
    return positions;
  }

  private getFirstPositionByPair(pair: string): OpenPosition | undefined {
    for (const position of this.openPositions.values()) {
      if (position.pair === pair) {
        return position;
      }
    }
    return undefined;
  }

  private countLotsForPair(pair: string): number {
    let count = 0;
    this.openPositions.forEach((position) => {
      if (position.pair === pair) {
        count++;
      }
    });
    return count;
  }

  // === SMART_GUARD ALERT HELPERS ===
  private shouldSendSgAlert(lotId: string, eventType: string, throttleMs?: number): boolean {
    const key = `${lotId}:${eventType}`;
    const lastAlert = this.sgAlertThrottle.get(key);
    const now = Date.now();
    const cooldown = throttleMs ?? 0;
    
    if (lastAlert && now - lastAlert < cooldown) {
      return false;
    }
    this.sgAlertThrottle.set(key, now);
    return true;
  }

  private async sendSgEventAlert(
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

    // Send Telegram notification
    if (this.telegramService.isInitialized()) {
      let emoji = "";
      let title = "";
      
      switch (eventType) {
        case "SG_BREAK_EVEN_ACTIVATED":
          emoji = "⚖️";
          title = "Break-Even Activado";
          break;
        case "SG_TRAILING_ACTIVATED":
          emoji = "📈";
          title = "Trailing Stop Activado";
          break;
        case "SG_TRAILING_STOP_UPDATED":
          emoji = "🔼";
          title = "Stop Actualizado";
          break;
        case "SG_SCALE_OUT_EXECUTED":
          emoji = "📊";
          title = "Scale-Out Ejecutado";
          break;
      }

      // Build exit prices section - use dynamic decimals based on price magnitude
      const formatPrice = (price: number) => {
        if (price >= 100) return price.toFixed(2);
        if (price >= 1) return price.toFixed(4);
        return price.toFixed(6);
      };
      
      const exitLines: string[] = [];
      if (extra.stopPrice) {
        exitLines.push(`   • 📉 Salida por abajo: <code>$${formatPrice(extra.stopPrice)}</code>`);
      }
      if (extra.takeProfitPrice) {
        exitLines.push(`   • 📈 Salida por arriba: <code>$${formatPrice(extra.takeProfitPrice)}</code>`);
      }
      const exitSection = exitLines.length > 0 
        ? `\n🎯 <b>Salidas configuradas:</b>\n${exitLines.join('\n')}` 
        : '';

      // Build trailing status section
      let trailingSection = '';
      if (extra.trailingStatus) {
        const ts = extra.trailingStatus;
        const statusTxt = ts.active 
          ? `Activo (distancia ${ts.distancePct}%)` 
          : `Pendiente (activa a +${ts.startPct}%)`;
        trailingSection = `\n🔄 <b>Trailing:</b> ${statusTxt}
   • Distancia: <code>${ts.distancePct}%</code>
   • Step: <code>${ts.stepPct}%</code>`;
      }
      
      const message = `🤖 <b>KRAKEN BOT</b> 🇪🇸
━━━━━━━━━━━━━━━━━━━
${emoji} <b>${title}</b>

📦 <b>Estado actual:</b>
   • Par: <code>${pair}</code>
   • Lote: <code>${shortLotId}</code>
   • Entrada: <code>$${formatPrice(entryPrice)}</code>
   • Actual: <code>$${formatPrice(currentPrice)}</code>
   • Profit: <code>${extra.profitPct >= 0 ? '+' : ''}${extra.profitPct.toFixed(2)}%</code>
   • Duración: <code>${durationTxt}</code>${exitSection}${trailingSection}

ℹ️ ${extra.reason}

🔗 <a href="${environment.panelUrl}">Ver Panel</a>
━━━━━━━━━━━━━━━━━━━`;

      await this.telegramService.sendAlertToMultipleChats(message, "trades");
    }
  }

  private getUniquePairs(): string[] {
    const pairs = new Set<string>();
    this.openPositions.forEach((position) => {
      pairs.add(position.pair);
    });
    return Array.from(pairs);
  }

  private calculatePairExposure(pair: string): number {
    let total = 0;
    this.openPositions.forEach((position) => {
      if (position.pair === pair) {
        total += position.amount * position.entryPrice;
      }
    });
    return total;
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
    exposureBaseUsed: string;
    baseValueUsd: number;
  } {
    const maxPairExposurePct = parseFloat(config.maxPairExposurePct?.toString() || "25");
    const maxTotalExposurePct = parseFloat(config.maxTotalExposurePct?.toString() || "60");
    const exposureBase = config.exposureBase || "cash";

    const currentPairExposure = this.calculatePairExposure(pair);
    const currentTotalExposure = this.calculateTotalExposure();

    const usdBalance = freshUsdBalance ?? this.currentUsdBalance;
    
    // Calculate base value depending on exposureBase setting
    // "cash" = solo USD disponible, "portfolio" = cash + posiciones abiertas
    const baseValueUsd = exposureBase === "portfolio" 
      ? usdBalance + currentTotalExposure 
      : usdBalance;
    
    const maxPairExposureUsd = baseValueUsd * (maxPairExposurePct / 100);
    const maxTotalExposureUsd = baseValueUsd * (maxTotalExposurePct / 100);

    const maxPairAvailable = Math.max(0, maxPairExposureUsd - currentPairExposure);
    const maxTotalAvailable = Math.max(0, maxTotalExposureUsd - currentTotalExposure);
    const maxAllowed = Math.min(maxPairAvailable, maxTotalAvailable);
    
    // Instrumentación: log detallado cuando maxAllowed = 0
    if (maxAllowed === 0) {
      log(`[EXPOSURE] ${pair}: EXPOSURE_LIMIT_REACHED | exposureBase=${exposureBase} baseValueUsd=$${baseValueUsd.toFixed(2)} usdBalance=$${usdBalance.toFixed(2)} | pairExp=$${currentPairExposure.toFixed(2)} totalExp=$${currentTotalExposure.toFixed(2)} | maxPairPct=${maxPairExposurePct}% maxTotalPct=${maxTotalExposurePct}% | maxPairUsd=$${maxPairExposureUsd.toFixed(2)} maxTotalUsd=$${maxTotalExposureUsd.toFixed(2)} | maxPairAvail=$${maxPairAvailable.toFixed(2)} maxTotalAvail=$${maxTotalAvailable.toFixed(2)} maxAllowed=$${maxAllowed.toFixed(2)}`, "trading");
    }
    
    return {
      maxPairAvailable,
      maxTotalAvailable,
      maxAllowed,
      exposureBaseUsed: exposureBase,
      baseValueUsd,
    };
  }

  // === SMART_GUARD: Obtener parámetros con overrides por par ===
  private getSmartGuardParams(pair: string, config: any): {
    sgMinEntryUsd: number;
    sgAllowUnderMin: boolean;
    sgBeAtPct: number;
    sgFeeCushionPct: number;
    sgFeeCushionAuto: boolean;
    sgTrailStartPct: number;
    sgTrailDistancePct: number;
    sgTrailStepPct: number;
    sgTpFixedEnabled: boolean;
    sgTpFixedPct: number;
    sgScaleOutEnabled: boolean;
    sgScaleOutPct: number;
    sgMinPartUsd: number;
    sgScaleOutThreshold: number;
  } {
    // Valores base de config global
    const base = {
      sgMinEntryUsd: parseFloat(config?.sgMinEntryUsd?.toString() || "100"),
      sgAllowUnderMin: config?.sgAllowUnderMin ?? true,
      sgBeAtPct: parseFloat(config?.sgBeAtPct?.toString() || "1.5"),
      sgFeeCushionPct: parseFloat(config?.sgFeeCushionPct?.toString() || "0.45"),
      sgFeeCushionAuto: config?.sgFeeCushionAuto ?? true,
      sgTrailStartPct: parseFloat(config?.sgTrailStartPct?.toString() || "2"),
      sgTrailDistancePct: parseFloat(config?.sgTrailDistancePct?.toString() || "1.5"),
      sgTrailStepPct: parseFloat(config?.sgTrailStepPct?.toString() || "0.25"),
      sgTpFixedEnabled: config?.sgTpFixedEnabled ?? false,
      sgTpFixedPct: parseFloat(config?.sgTpFixedPct?.toString() || "10"),
      sgScaleOutEnabled: config?.sgScaleOutEnabled ?? false,
      sgScaleOutPct: parseFloat(config?.sgScaleOutPct?.toString() || "35"),
      sgMinPartUsd: parseFloat(config?.sgMinPartUsd?.toString() || "50"),
      sgScaleOutThreshold: parseFloat(config?.sgScaleOutThreshold?.toString() || "80"),
    };

    // Aplicar overrides por par si existen
    const overrides = config?.sgPairOverrides?.[pair];
    if (overrides) {
      const merged = { ...base };
      // Floats
      if (overrides.sgMinEntryUsd !== undefined) merged.sgMinEntryUsd = parseFloat(overrides.sgMinEntryUsd.toString());
      if (overrides.sgBeAtPct !== undefined) merged.sgBeAtPct = parseFloat(overrides.sgBeAtPct.toString());
      if (overrides.sgFeeCushionPct !== undefined) merged.sgFeeCushionPct = parseFloat(overrides.sgFeeCushionPct.toString());
      if (overrides.sgTrailStartPct !== undefined) merged.sgTrailStartPct = parseFloat(overrides.sgTrailStartPct.toString());
      if (overrides.sgTrailDistancePct !== undefined) merged.sgTrailDistancePct = parseFloat(overrides.sgTrailDistancePct.toString());
      if (overrides.sgTrailStepPct !== undefined) merged.sgTrailStepPct = parseFloat(overrides.sgTrailStepPct.toString());
      if (overrides.sgTpFixedPct !== undefined) merged.sgTpFixedPct = parseFloat(overrides.sgTpFixedPct.toString());
      if (overrides.sgMinPartUsd !== undefined) merged.sgMinPartUsd = parseFloat(overrides.sgMinPartUsd.toString());
      if (overrides.sgScaleOutPct !== undefined) merged.sgScaleOutPct = parseFloat(overrides.sgScaleOutPct.toString());
      if (overrides.sgScaleOutThreshold !== undefined) merged.sgScaleOutThreshold = parseFloat(overrides.sgScaleOutThreshold.toString());
      // Booleans
      if (overrides.sgAllowUnderMin !== undefined) merged.sgAllowUnderMin = !!overrides.sgAllowUnderMin;
      if (overrides.sgFeeCushionAuto !== undefined) merged.sgFeeCushionAuto = !!overrides.sgFeeCushionAuto;
      if (overrides.sgTpFixedEnabled !== undefined) merged.sgTpFixedEnabled = !!overrides.sgTpFixedEnabled;
      if (overrides.sgScaleOutEnabled !== undefined) merged.sgScaleOutEnabled = !!overrides.sgScaleOutEnabled;
      return merged;
    }

    return base;
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
    
    // B1: Aplicar filtro MTF a Momentum Velas (igual que en ciclos)
    const mtfData = await this.getMultiTimeframeData(pair);
    const mtfAnalysis = mtfData ? this.analyzeMultiTimeframe(mtfData) : null;
    
    let signal = this.momentumCandlesStrategy(pair, closedCandles, candle.close);
    
    // Aplicar filtro MTF si hay señal activa
    if (mtfAnalysis && signal.action !== "hold") {
      const mtfBoost = this.applyMTFFilter(signal, mtfAnalysis);
      if (mtfBoost.filtered) {
        return { action: "hold", pair, confidence: 0.3, reason: `Señal filtrada por MTF: ${mtfBoost.reason}` };
      }
      signal.confidence = Math.min(0.95, signal.confidence + mtfBoost.confidenceBoost);
      if (mtfBoost.confidenceBoost > 0) {
        signal.reason += ` | ${mtfBoost.reason}`;
      }
    }
    
    return signal;
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
    
    // B2: Filtro anti-FOMO - bloquear BUY en condiciones de entrada tardía
    const isAntifomoTriggered = rsi > 65 && bollinger.percentB > 85 && bodyRatio > 0.7;
    
    if (buySignals >= 4 && buySignals > sellSignals && rsi < 70) {
      // B2: Verificar anti-FOMO antes de emitir señal BUY
      if (isAntifomoTriggered) {
        return {
          action: "hold",
          pair,
          confidence: 0.4,
          reason: `Anti-FOMO: RSI=${rsi.toFixed(0)} BB%=${bollinger.percentB.toFixed(0)} bodyRatio=${bodyRatio.toFixed(2)} | Señales: ${buySignals}/${sellSignals}`,
        };
      }
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

    // Load dynamic pair metadata from Kraken API (step sizes, order minimums)
    const activePairs = config.activePairs || ["BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD"];
    try {
      await this.krakenService.loadPairMetadata(activePairs);
      // Verify all active pairs have metadata
      const missingPairs = activePairs.filter(p => !this.krakenService.hasMetadata(p));
      if (missingPairs.length > 0) {
        log(`[CRITICAL] Missing metadata for pairs: ${missingPairs.join(", ")}. Using fallback values.`, "trading");
      }
      this.krakenService.startMetadataRefresh(activePairs);
    } catch (error: any) {
      log(`[CRITICAL] Failed to load pair metadata: ${error.message}. Trading will use fallback values.`, "trading");
      // Continue with fallbacks - don't block trading entirely for API failures
    }

    if (!this.telegramService.isInitialized()) {
      log("Telegram no está configurado, continuando sin notificaciones", "trading");
    }
    
    // Load dryRunMode from config (Replit always forces dry run regardless of DB setting)
    const dbDryRun = (config as any).dryRunMode ?? false;
    if (this.isReplitEnvironment) {
      this.dryRunMode = true;
      log("[SAFETY] Modo DRY_RUN forzado en Replit - no se enviarán órdenes reales", "trading");
    } else {
      this.dryRunMode = dbDryRun;
      if (this.dryRunMode) {
        log("[INFO] Modo DRY_RUN activado desde configuración", "trading");
      }
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
    
    const modeLabel = this.dryRunMode ? "DRY_RUN (simulación)" : "LIVE (órdenes reales)";
    
    await botLogger.info("BOT_STARTED", "Motor de trading iniciado", {
      strategy: config.strategy,
      riskLevel: config.riskLevel,
      activePairs: config.activePairs,
      balanceUsd: this.currentUsdBalance,
      openPositions: this.openPositions.size,
      dryRunMode: this.dryRunMode,
      isReplitEnvironment: this.isReplitEnvironment,
    });
    
    if (this.telegramService.isInitialized()) {
      const modeText = this.dryRunMode ? "DRY_RUN (simulación)" : "LIVE";
      await this.telegramService.sendMessage(`🤖 <b>KRAKEN BOT</b> 🇪🇸
━━━━━━━━━━━━━━━━━━━
✅ <b>Bot Iniciado</b>

📊 <b>Configuración:</b>
   • Estrategia: <code>${config.strategy}</code>
   • Riesgo: <code>${config.riskLevel}</code>
   • Pares: <code>${config.activePairs.join(", ")}</code>

💰 <b>Estado:</b>
   • Balance: <code>$${this.currentUsdBalance.toFixed(2)}</code>
   • Posiciones: <code>${this.openPositions.size}</code>

⚙️ <b>Modo:</b> <code>${modeText}</code>
━━━━━━━━━━━━━━━━━━━`);
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
      await this.telegramService.sendMessage(`🤖 <b>KRAKEN BOT</b> 🇪🇸
━━━━━━━━━━━━━━━━━━━
🛑 <b>Bot Detenido</b>

El motor de trading ha sido desactivado.
━━━━━━━━━━━━━━━━━━━`);
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
        const hasSnapshot = pos.configSnapshotJson && pos.entryMode;
        const configSnapshot = hasSnapshot ? (pos.configSnapshotJson as ConfigSnapshot) : undefined;
        
        // Use existing lotId or generate one for legacy positions
        const lotId = pos.lotId || generateLotId(pos.pair);
        
        this.openPositions.set(lotId, {
          lotId,
          pair: pos.pair,
          amount: parseFloat(pos.amount),
          entryPrice: parseFloat(pos.entryPrice),
          highestPrice: parseFloat(pos.highestPrice),
          openedAt: new Date(pos.openedAt).getTime(),
          entryStrategyId: pos.entryStrategyId || "momentum_cycle",
          entrySignalTf: pos.entrySignalTf || "cycle",
          signalConfidence: pos.signalConfidence ? toConfidenceUnit(pos.signalConfidence) : undefined,
          signalReason: pos.signalReason || undefined,
          entryMode: pos.entryMode || undefined,
          configSnapshot,
          // SMART_GUARD state
          sgBreakEvenActivated: pos.sgBreakEvenActivated ?? false,
          sgCurrentStopPrice: pos.sgCurrentStopPrice ? parseFloat(pos.sgCurrentStopPrice) : undefined,
          sgTrailingActivated: pos.sgTrailingActivated ?? false,
          sgScaleOutDone: pos.sgScaleOutDone ?? false,
        });
        
        // If position lacked lotId, update DB
        if (!pos.lotId) {
          await storage.updateOpenPositionLotId(pos.id, lotId);
          log(`Migrated legacy position ${pos.pair} -> lotId: ${lotId}`, "trading");
        }
        
        const snapshotInfo = hasSnapshot ? `[snapshot: ${pos.entryMode}]` : "[legacy: uses current config]";
        log(`Posición recuperada: ${pos.pair} (${lotId}) - ${pos.amount} @ $${pos.entryPrice} (${pos.entryStrategyId}/${pos.entrySignalTf}) ${snapshotInfo}`, "trading");
      }
      
      if (positions.length > 0) {
        log(`${positions.length} posiciones abiertas (${this.openPositions.size} lotes) cargadas desde la base de datos`, "trading");
        if (this.telegramService.isInitialized()) {
          const positionsList = positions.map(p => {
            const hasSnap = p.configSnapshotJson && p.entryMode;
            const snapEmoji = hasSnap ? "📸" : "⚙️";
            return `   ${snapEmoji} ${p.pair}: <code>${p.amount} @ $${parseFloat(p.entryPrice).toFixed(2)}</code>`;
          }).join("\n");
          await this.telegramService.sendMessage(`🤖 <b>KRAKEN BOT</b> 🇪🇸
━━━━━━━━━━━━━━━━━━━
📂 <b>Posiciones Abiertas</b>

${positionsList}
━━━━━━━━━━━━━━━━━━━`);
        }
      }
    } catch (error: any) {
      log(`Error cargando posiciones: ${error.message}`, "trading");
    }
  }

  private async savePositionToDB(pair: string, position: OpenPosition) {
    try {
      await storage.saveOpenPositionByLotId({
        lotId: position.lotId,
        pair,
        entryPrice: position.entryPrice.toString(),
        amount: position.amount.toString(),
        highestPrice: position.highestPrice.toString(),
        entryStrategyId: position.entryStrategyId,
        entrySignalTf: position.entrySignalTf,
        signalConfidence: position.signalConfidence?.toString(),
        signalReason: position.signalReason,
        entryMode: position.entryMode,
        configSnapshotJson: position.configSnapshot,
        // SMART_GUARD state
        sgBreakEvenActivated: position.sgBreakEvenActivated,
        sgCurrentStopPrice: position.sgCurrentStopPrice?.toString(),
        sgTrailingActivated: position.sgTrailingActivated,
        sgScaleOutDone: position.sgScaleOutDone,
      });
    } catch (error: any) {
      log(`Error guardando posición ${pair} (${position.lotId}): ${error.message}`, "trading");
    }
  }

  private async deletePositionFromDBByLotId(lotId: string) {
    try {
      await storage.deleteOpenPositionByLotId(lotId);
    } catch (error: any) {
      log(`Error eliminando posición ${lotId}: ${error.message}`, "trading");
    }
  }

  private async updatePositionHighestPriceByLotId(lotId: string, highestPrice: number) {
    try {
      await storage.updateOpenPositionByLotId(lotId, {
        highestPrice: highestPrice.toString(),
      });
    } catch (error: any) {
      log(`Error actualizando highestPrice ${lotId}: ${error.message}`, "trading");
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
            await this.telegramService.sendMessage(`🤖 <b>KRAKEN BOT</b> 🇪🇸
━━━━━━━━━━━━━━━━━━━
🛑 <b>Límite de Pérdida Diaria Alcanzado</b>

El bot ha pausado las operaciones de COMPRA.

📊 <b>Resumen:</b>
   • P&L del día: <code>${currentLossPercent.toFixed(2)}%</code>
   • Pérdida: <code>$${Math.abs(this.dailyPnL).toFixed(2)}</code>
   • Límite configurado: <code>-${dailyLossLimitPercent}%</code>

ℹ️ Las operaciones de cierre (SL/TP) siguen activas.
⏰ El trading normal se reanudará mañana.
━━━━━━━━━━━━━━━━━━━`);
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
        // Inicializar entrada por defecto para diagnóstico (se sobrescribe si hay señal)
        if (!this.lastScanResults.has(pair)) {
          const expDefault = this.getAvailableExposure(pair, config, this.currentUsdBalance);
          this.lastScanResults.set(pair, {
            signal: "NONE",
            reason: "Sin señal en este ciclo",
            exposureAvailable: expDefault.maxAllowed,
          });
        }
        
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
    // Get all positions for this pair (multi-lot support)
    const positions = this.getPositionsByPair(pair);
    if (positions.length === 0) return;

    try {
      const krakenPair = this.formatKrakenPair(pair);
      const ticker = await this.krakenService.getTicker(krakenPair);
      const tickerData: any = Object.values(ticker)[0];
      if (!tickerData) return;

      const currentPrice = parseFloat(tickerData.c?.[0] || "0");

      // Process each position for this pair independently
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
    const priceChange = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;

    if (currentPrice > position.highestPrice) {
      position.highestPrice = currentPrice;
      this.openPositions.set(lotId, position);
      await this.updatePositionHighestPriceByLotId(lotId, currentPrice);
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
      this.setStopLossCooldown(pair);
      await botLogger.warn("STOP_LOSS_HIT", `Stop-Loss activado en ${pair}`, {
        pair,
        lotId,
        entryPrice: position.entryPrice,
        currentPrice,
        priceChange,
        stopLossPercent: effectiveSL,
        paramsSource,
        cooldownMinutes: POST_STOPLOSS_COOLDOWN_MS / 60000,
      });
    }
    else if (priceChange >= effectiveTP) {
      shouldSell = true;
      reason = `Take-Profit activado (${priceChange.toFixed(2)}% > ${effectiveTP}%) [${paramsSource}]`;
      emoji = "🎯";
      await botLogger.info("TAKE_PROFIT_HIT", `Take-Profit alcanzado en ${pair}`, {
        pair,
        lotId,
        entryPrice: position.entryPrice,
        currentPrice,
        priceChange,
        takeProfitPercent: effectiveTP,
        paramsSource,
      });
    }
    else if (effectiveTrailingEnabled && position.highestPrice > position.entryPrice) {
      const dropFromHigh = ((position.highestPrice - currentPrice) / position.highestPrice) * 100;
      if (dropFromHigh >= effectiveTrailingPct && priceChange > 0) {
        shouldSell = true;
        reason = `Trailing Stop activado (cayó ${dropFromHigh.toFixed(2)}% desde máximo $${position.highestPrice.toFixed(2)}) [${paramsSource}]`;
        emoji = "📉";
        await botLogger.info("TRAILING_STOP_HIT", `Trailing Stop activado en ${pair}`, {
          pair,
          lotId,
          entryPrice: position.entryPrice,
          highestPrice: position.highestPrice,
          currentPrice,
          dropFromHigh,
          trailingStopPercent: effectiveTrailingPct,
          paramsSource,
        });
      }
    }

    if (shouldSell) {
      const minVolume = this.getOrderMin(pair);
      const sellAmount = position.amount;

      if (sellAmount < minVolume) {
        log(`Cantidad a vender (${sellAmount}) menor al mínimo de Kraken (${minVolume}) para ${pair} (${lotId})`, "trading");
        return;
      }

      // VERIFICACIÓN DE BALANCE REAL: Evitar "EOrder:Insufficient funds"
      const freshBalances = await this.krakenService.getBalance();
      const realAssetBalance = this.getAssetBalance(pair, freshBalances);
      
      // Si el balance real es menor al 99.5% del esperado (tolerancia para fees ~0.26%)
      if (realAssetBalance < sellAmount * 0.995) {
        log(`⚠️ Discrepancia de balance en ${pair} (${lotId}): Registrado ${sellAmount}, Real ${realAssetBalance}`, "trading");
        
        // Si balance real es prácticamente cero (< mínimo de Kraken), eliminar posición
        if (realAssetBalance < minVolume) {
          log(`Posición huérfana eliminada en ${pair} (${lotId}): balance real (${realAssetBalance}) < mínimo (${minVolume})`, "trading");
          
          // NO modificar dailyPnL: si fue vendida manualmente, el usuario ya tiene el USD
          // Pero SÍ debemos reconciliar exposure y cooldowns
          
          // Refrescar balance USD para tener métricas consistentes
          this.currentUsdBalance = parseFloat(freshBalances?.ZUSD || freshBalances?.USD || "0");
          
          this.openPositions.delete(lotId);
          await this.deletePositionFromDBByLotId(lotId);
          
          // Limpiar cooldowns obsoletos y establecer uno nuevo (15 min)
          this.stopLossCooldowns.delete(pair);
          this.lastExposureAlert.delete(pair);
          this.setPairCooldown(pair);
          this.lastTradeTime.set(pair, Date.now());
          
          if (this.telegramService.isInitialized()) {
            await this.telegramService.sendMessage(`🤖 <b>KRAKEN BOT</b> 🇪🇸
━━━━━━━━━━━━━━━━━━━
🔄 <b>Posición Huérfana Eliminada</b>

📦 <b>Detalles:</b>
   • Par: <code>${pair}</code>
   • Lot: <code>${lotId}</code>
   • Registrada: <code>${sellAmount.toFixed(8)}</code>
   • Real en Kraken: <code>${realAssetBalance.toFixed(8)}</code>

⚠️ La posición no existe en Kraken y fue eliminada.
━━━━━━━━━━━━━━━━━━━`);
          }
          
          await botLogger.warn("ORPHAN_POSITION_CLEANED", `Posición huérfana eliminada en ${pair}`, {
            pair,
            lotId,
            registeredAmount: sellAmount,
            realBalance: realAssetBalance,
            newUsdBalance: this.currentUsdBalance,
          });
          return;
        }
        
        // Si hay algo de balance pero menos del registrado, ajustar posición al real
        log(`Ajustando posición ${pair} (${lotId}) de ${sellAmount} a ${realAssetBalance}`, "trading");
        position.amount = realAssetBalance;
        this.openPositions.set(lotId, position);
        await this.savePositionToDB(pair, position);
        
        // Notificar ajuste
        if (this.telegramService.isInitialized()) {
          await this.telegramService.sendMessage(`🤖 <b>KRAKEN BOT</b> 🇪🇸
━━━━━━━━━━━━━━━━━━━
🔧 <b>Posición Ajustada</b>

📦 <b>Detalles:</b>
   • Par: <code>${pair}</code>
   • Lot: <code>${lotId}</code>
   • Cantidad anterior: <code>${sellAmount.toFixed(8)}</code>
   • Cantidad real: <code>${realAssetBalance.toFixed(8)}</code>

ℹ️ Se usará la cantidad real para la venta.
━━━━━━━━━━━━━━━━━━━`);
        }
        
        // Continuar con la venta usando el balance real
      }

      log(`${emoji} ${reason} para ${pair} (${lotId})`, "trading");

      // Usar position.amount (puede haber sido ajustado al balance real)
      const actualSellAmount = position.amount;
      const pnl = (currentPrice - position.entryPrice) * actualSellAmount;
      const pnlPercent = priceChange;

      const sellContext = { entryPrice: position.entryPrice, aiSampleId: position.aiSampleId, openedAt: position.openedAt };
      const success = await this.executeTrade(pair, "sell", actualSellAmount.toFixed(8), currentPrice, reason, undefined, undefined, undefined, sellContext);
      
      if (success && this.telegramService.isInitialized()) {
        const pnlEmoji = pnl >= 0 ? "📈" : "📉";
        const durationMs = position.openedAt ? Date.now() - position.openedAt : 0;
        const durationMins = Math.floor(durationMs / 60000);
        const durationHours = Math.floor(durationMins / 60);
        const durationDays = Math.floor(durationHours / 24);
        const durationTxt = durationDays > 0 ? `${durationDays}d ${durationHours % 24}h` : durationHours > 0 ? `${durationHours}h ${durationMins % 60}m` : `${durationMins}m`;
        await this.telegramService.sendAlertToMultipleChats(`🤖 <b>KRAKEN BOT</b> 🇪🇸
━━━━━━━━━━━━━━━━━━━
${emoji} <b>${reason}</b>

📦 <b>Detalles:</b>
   • Par: <code>${pair}</code>
   • Lot: <code>${lotId}</code>
   • Precio entrada: <code>$${position.entryPrice.toFixed(2)}</code>
   • Precio actual: <code>$${currentPrice.toFixed(2)}</code>
   • Cantidad vendida: <code>${actualSellAmount.toFixed(8)}</code>
   • Duración: <code>${durationTxt}</code>

${pnlEmoji} <b>P&L:</b> <code>${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%)</code>

🔗 <a href="${environment.panelUrl}">Ver Panel</a>
━━━━━━━━━━━━━━━━━━━`, "trades");
      }

      if (success) {
        this.openPositions.delete(lotId);
        await this.deletePositionFromDBByLotId(lotId);
        this.lastTradeTime.set(pair, Date.now());
      }
    }
  }

  private async checkSmartGuardExit(
    pair: string,
    position: OpenPosition,
    currentPrice: number,
    priceChange: number
  ) {
    const snapshot = position.configSnapshot!;
    const paramsSource = `SMART_GUARD snapshot`;
    
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
    
    // Also use the standard SL from snapshot as ultimate protection
    const ultimateSL = snapshot.stopLossPercent;
    
    let shouldSellFull = false;
    let shouldScaleOut = false;
    let sellReason = "";
    let emoji = "";
    let positionModified = false;
    
    // Calculate break-even price (entry + fee cushion)
    const breakEvenPrice = position.entryPrice * (1 + feeCushionPct / 100);
    
    // 1. ULTIMATE STOP-LOSS - Emergency exit (always active)
    if (priceChange <= -ultimateSL) {
      shouldSellFull = true;
      sellReason = `Stop-Loss emergencia SMART_GUARD (${priceChange.toFixed(2)}% < -${ultimateSL}%) [${paramsSource}]`;
      emoji = "🛑";
      this.setStopLossCooldown(pair);
      await botLogger.warn("SG_EMERGENCY_STOPLOSS", `SMART_GUARD Stop-Loss emergencia en ${pair}`, {
        pair, entryPrice: position.entryPrice, currentPrice, priceChange, ultimateSL, paramsSource,
      });
    }
    
    // 2. FIXED TAKE-PROFIT (if enabled)
    else if (tpFixedEnabled && priceChange >= tpFixedPct) {
      shouldSellFull = true;
      sellReason = `Take-Profit fijo SMART_GUARD (${priceChange.toFixed(2)}% >= ${tpFixedPct}%) [${paramsSource}]`;
      emoji = "🎯";
      await botLogger.info("SG_TP_FIXED", `SMART_GUARD TP fijo alcanzado en ${pair}`, {
        pair, entryPrice: position.entryPrice, currentPrice, priceChange, tpFixedPct, paramsSource,
      });
    }
    
    // 3. BREAK-EVEN ACTIVATION - Move stop to breakeven when profit >= beAtPct
    else if (!position.sgBreakEvenActivated && priceChange >= beAtPct) {
      position.sgBreakEvenActivated = true;
      position.sgCurrentStopPrice = breakEvenPrice;
      positionModified = true;
      log(`SMART_GUARD ${pair}: Break-even activado (+${priceChange.toFixed(2)}%), stop movido a $${breakEvenPrice.toFixed(4)}`, "trading");
      
      // Send alert (only once per lot, no throttle needed as flag prevents re-entry)
      if (this.shouldSendSgAlert(position.lotId, "SG_BREAK_EVEN_ACTIVATED")) {
        // Calculate take-profit price if enabled
        const takeProfitPrice = tpFixedEnabled 
          ? position.entryPrice * (1 + tpFixedPct / 100) 
          : undefined;
        
        await this.sendSgEventAlert("SG_BREAK_EVEN_ACTIVATED", position, currentPrice, {
          stopPrice: breakEvenPrice,
          profitPct: priceChange,
          reason: `Profit +${beAtPct}% alcanzado, stop movido a break-even + comisiones`,
          takeProfitPrice,
          trailingStatus: {
            active: false,
            startPct: trailStartPct,
            distancePct: trailDistancePct,
            stepPct: trailStepPct,
          },
        });
      }
    }
    
    // 4. TRAILING STOP ACTIVATION - Start trailing when profit >= trailStartPct
    if (!position.sgTrailingActivated && priceChange >= trailStartPct) {
      position.sgTrailingActivated = true;
      const trailStopPrice = currentPrice * (1 - trailDistancePct / 100);
      // Only update stop if higher than current
      if (!position.sgCurrentStopPrice || trailStopPrice > position.sgCurrentStopPrice) {
        position.sgCurrentStopPrice = trailStopPrice;
      }
      positionModified = true;
      log(`SMART_GUARD ${pair}: Trailing activado (+${priceChange.toFixed(2)}%), stop dinámico @ $${position.sgCurrentStopPrice!.toFixed(4)}`, "trading");
      
      // Send alert (only once per lot)
      if (this.shouldSendSgAlert(position.lotId, "SG_TRAILING_ACTIVATED")) {
        // Calculate take-profit price if enabled
        const takeProfitPrice = tpFixedEnabled 
          ? position.entryPrice * (1 + tpFixedPct / 100) 
          : undefined;
        
        await this.sendSgEventAlert("SG_TRAILING_ACTIVATED", position, currentPrice, {
          stopPrice: position.sgCurrentStopPrice,
          profitPct: priceChange,
          reason: `Profit +${trailStartPct}% alcanzado, trailing stop iniciado a ${trailDistancePct}% del máximo`,
          takeProfitPrice,
          trailingStatus: {
            active: true,
            startPct: trailStartPct,
            distancePct: trailDistancePct,
            stepPct: trailStepPct,
          },
        });
      }
    }
    
    // 5. TRAILING STOP UPDATE - Ratchet up stop with step increments
    if (position.sgTrailingActivated && position.sgCurrentStopPrice) {
      const newTrailStop = currentPrice * (1 - trailDistancePct / 100);
      const minStepPrice = position.sgCurrentStopPrice * (1 + trailStepPct / 100);
      
      // Only update if new stop is higher by at least one step
      if (newTrailStop > minStepPrice) {
        const oldStop = position.sgCurrentStopPrice;
        position.sgCurrentStopPrice = newTrailStop;
        positionModified = true;
        log(`SMART_GUARD ${pair}: Trailing step $${oldStop.toFixed(4)} → $${newTrailStop.toFixed(4)} (+${trailStepPct}%)`, "trading");
        
        // Send alert with throttle (max 1 per 5 min)
        if (this.shouldSendSgAlert(position.lotId, "SG_TRAILING_STOP_UPDATED", this.SG_TRAIL_UPDATE_THROTTLE_MS)) {
          // Calculate take-profit price if enabled
          const takeProfitPrice = tpFixedEnabled 
            ? position.entryPrice * (1 + tpFixedPct / 100) 
            : undefined;
          
          await this.sendSgEventAlert("SG_TRAILING_STOP_UPDATED", position, currentPrice, {
            stopPrice: newTrailStop,
            profitPct: priceChange,
            reason: `Stop actualizado: $${oldStop.toFixed(2)} → $${newTrailStop.toFixed(2)}`,
            takeProfitPrice,
            trailingStatus: {
              active: true,
              startPct: trailStartPct,
              distancePct: trailDistancePct,
              stepPct: trailStepPct,
            },
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
    
    // 7. SCALE-OUT (optional, only if exceptional signal)
    if (!shouldSellFull && scaleOutEnabled && !position.sgScaleOutDone) {
      // Only scale out if signal confidence >= threshold and part is worth selling
      const partValue = position.amount * currentPrice * (scaleOutPct / 100);
      const confPct = toConfidencePct(position.signalConfidence, 0);
      const thresholdPct = toConfidencePct(scaleOutThreshold, 80);
      if (confPct >= thresholdPct && partValue >= minPartUsd) {
        if (priceChange >= trailStartPct) { // Only scale out in profit
          shouldScaleOut = true;
          sellReason = `Scale-out SMART_GUARD (${scaleOutPct}% @ +${priceChange.toFixed(2)}%, conf=${confPct.toFixed(0)}%) [${paramsSource}]`;
          emoji = "📊";
          position.sgScaleOutDone = true;
          positionModified = true;
          
          // Send alert (only once as sgScaleOutDone flag prevents re-entry)
          if (this.shouldSendSgAlert(position.lotId, "SG_SCALE_OUT_EXECUTED")) {
            // Calculate take-profit price if enabled
            const takeProfitPrice = tpFixedEnabled 
              ? position.entryPrice * (1 + tpFixedPct / 100) 
              : undefined;
            
            await this.sendSgEventAlert("SG_SCALE_OUT_EXECUTED", position, currentPrice, {
              stopPrice: position.sgCurrentStopPrice,
              profitPct: priceChange,
              reason: `Vendido ${scaleOutPct}% de posición ($${partValue.toFixed(2)}) a +${priceChange.toFixed(2)}%`,
              takeProfitPrice,
              trailingStatus: position.sgTrailingActivated ? {
                active: true,
                startPct: trailStartPct,
                distancePct: trailDistancePct,
                stepPct: trailStepPct,
              } : undefined,
            });
          }
        }
      }
    }
    
    const lotId = position.lotId;
    
    // Save position changes
    if (positionModified && !shouldSellFull && !shouldScaleOut) {
      this.openPositions.set(lotId, position);
      await this.savePositionToDB(pair, position);
    }
    
    // Execute sell if needed
    if (shouldSellFull || shouldScaleOut) {
      const minVolume = this.getOrderMin(pair);
      let sellAmount = shouldScaleOut 
        ? position.amount * (scaleOutPct / 100)
        : position.amount;
      
      if (sellAmount < minVolume) {
        log(`SMART_GUARD: Cantidad a vender (${sellAmount}) menor al mínimo (${minVolume}) para ${pair} (${lotId})`, "trading");
        return;
      }
      
      // Balance verification
      const freshBalances = await this.krakenService.getBalance();
      const realAssetBalance = this.getAssetBalance(pair, freshBalances);
      
      if (realAssetBalance < sellAmount * 0.995) {
        if (realAssetBalance < minVolume) {
          log(`SMART_GUARD: Posición huérfana en ${pair} (${lotId}), eliminando`, "trading");
          this.openPositions.delete(lotId);
          await this.deletePositionFromDBByLotId(lotId);
          this.setPairCooldown(pair);
          return;
        }
        sellAmount = realAssetBalance;
        position.amount = realAssetBalance;
      }
      
      log(`${emoji} ${sellReason} para ${pair} (${lotId})`, "trading");
      
      const pnl = (currentPrice - position.entryPrice) * sellAmount;
      const sellContext = { entryPrice: position.entryPrice, aiSampleId: position.aiSampleId, openedAt: position.openedAt };
      const success = await this.executeTrade(pair, "sell", sellAmount.toFixed(8), currentPrice, sellReason, undefined, undefined, undefined, sellContext);
      
      if (success && this.telegramService.isInitialized()) {
        const pnlEmoji = pnl >= 0 ? "📈" : "📉";
        const durationMs = position.openedAt ? Date.now() - position.openedAt : 0;
        const durationMins = Math.floor(durationMs / 60000);
        const durationHours = Math.floor(durationMins / 60);
        const durationDays = Math.floor(durationHours / 24);
        const durationTxt = durationDays > 0 ? `${durationDays}d ${durationHours % 24}h` : durationHours > 0 ? `${durationHours}h ${durationMins % 60}m` : `${durationMins}m`;
        await this.telegramService.sendAlertToMultipleChats(`🤖 <b>KRAKEN BOT</b> 🇪🇸
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
      
      if (success) {
        // Reduce position amount by what was sold
        position.amount -= sellAmount;
        
        // Use epsilon comparison for floating-point safety (treat < 0.00000001 as zero)
        const EPSILON = 1e-8;
        const positionIsEmpty = shouldSellFull || position.amount < EPSILON;
        
        if (positionIsEmpty) {
          this.openPositions.delete(lotId);
          await this.deletePositionFromDBByLotId(lotId);
          log(`SMART_GUARD ${pair} (${lotId}): Posición cerrada completamente`, "trading");
        } else {
          // Partial sell (scale-out) - save reduced position
          this.openPositions.set(lotId, position);
          await this.savePositionToDB(pair, position);
          log(`SMART_GUARD ${pair} (${lotId}): Venta parcial, restante: ${position.amount.toFixed(8)}`, "trading");
        }
        this.lastTradeTime.set(pair, Date.now());
      }
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
      const existingPositions = this.getPositionsByPair(pair);
      const existingPosition = existingPositions[0];

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

        // MODO SINGLE o SMART_GUARD: Bloquear compras si ya hay posición abierta
        const botConfigCheck = await storage.getBotConfig();
        const positionMode = botConfigCheck?.positionMode || "SINGLE";
        const sgMaxLotsPerPair = botConfigCheck?.sgMaxOpenLotsPerPair ?? 1;
        
        // En SINGLE siempre 1 slot. En SMART_GUARD respetamos sgMaxOpenLotsPerPair.
        const maxLotsForMode = positionMode === "SMART_GUARD" ? sgMaxLotsPerPair : 1;
        const currentOpenLots = this.countLotsForPair(pair);
        
        if ((positionMode === "SINGLE" || positionMode === "SMART_GUARD") && currentOpenLots >= maxLotsForMode) {
          const reasonCode = positionMode === "SMART_GUARD" 
            ? "SMART_GUARD_MAX_LOTS_REACHED" 
            : "SINGLE_MODE_POSITION_EXISTS";
          
          log(`${pair}: Compra bloqueada - Modo ${positionMode}, lotes abiertos ${currentOpenLots}/${maxLotsForMode}`, "trading");
          await botLogger.info("TRADE_SKIPPED", `Señal BUY ignorada - máximo de lotes alcanzado`, {
            pair,
            signal: "BUY",
            reason: reasonCode,
            currentOpenLots,
            maxOpenLots: maxLotsForMode,
            existingAmount: existingPosition?.amount || 0,
            signalReason: signal.reason,
          });
          this.lastScanResults.set(pair, {
            signal: "BUY",
            reason: reasonCode,
            exposureAvailable: 0,
          });
          return;
        }

        // B3: SMART_GUARD requiere ≥5 señales para BUY (umbral más estricto)
        // + Market Regime: 6 señales en RANGE, pausa en TRANSITION
        if (positionMode === "SMART_GUARD") {
          const regimeEnabled = botConfigCheck?.regimeDetectionEnabled ?? false;
          let requiredSignals = 5; // Base SMART_GUARD requirement
          let regimeInfo = "";
          
          if (regimeEnabled) {
            try {
              const regimeAnalysis = await this.getMarketRegimeWithCache(pair);
              
              // TRANSITION: Pause new entries
              if (this.shouldPauseEntriesDueToRegime(regimeAnalysis.regime, regimeEnabled)) {
                await botLogger.info("TRADE_SKIPPED", `SMART_GUARD BUY bloqueado - régimen TRANSITION (pausa entradas)`, {
                  pair,
                  signal: "BUY",
                  reason: "REGIME_TRANSITION_PAUSE",
                  regime: regimeAnalysis.regime,
                  adx: regimeAnalysis.adx,
                  regimeReason: regimeAnalysis.reason,
                  signalReason: signal.reason,
                });
                this.lastScanResults.set(pair, {
                  signal: "BUY",
                  reason: `REGIME_PAUSE: ${regimeAnalysis.reason}`,
                });
                return;
              }
              
              // Adjust minSignals based on regime (RANGE = 6, TREND = 5)
              requiredSignals = this.getRegimeMinSignals(regimeAnalysis.regime, 5);
              regimeInfo = ` [Régimen: ${regimeAnalysis.regime}]`;
            } catch (regimeError: any) {
              // On regime detection error, fallback to base SMART_GUARD (5 signals)
              log(`${pair}: Error en detección de régimen, usando base SMART_GUARD: ${regimeError.message}`, "trading");
              // Update scan results to reflect the error state
              this.lastScanResults.set(pair, {
                signal: "BUY",
                reason: `REGIME_ERROR: Fallback a base SMART_GUARD`,
              });
            }
          }
          
          const signalCountMatch = signal.reason.match(/Señales:\s*(\d+)\/(\d+)/);
          if (signalCountMatch) {
            const buySignalCount = parseInt(signalCountMatch[1], 10);
            // Extraer nombre de régimen limpio para analytics
            const regimeMatch = regimeInfo.match(/Régimen:\s*(\w+)/);
            const regimeName = regimeMatch ? regimeMatch[1] : (regimeEnabled ? "BASE" : "DISABLED");
            
            log(`[B3] ${pair}: Parsed señales=${buySignalCount}, required=${requiredSignals}, regime=${regimeName}`, "trading");
            if (buySignalCount < requiredSignals) {
              await botLogger.info("TRADE_SKIPPED", `SMART_GUARD BUY bloqueado - señales insuficientes (${buySignalCount} < ${requiredSignals})${regimeInfo}`, {
                pair,
                signal: "BUY",
                reason: "SMART_GUARD_INSUFFICIENT_SIGNALS",
                got: buySignalCount,
                required: requiredSignals,
                regime: regimeName,
                regimeEnabled,
                signalReason: signal.reason,
              });
              return;
            }
          } else {
            // B3 Fallback: regex no matcheó - fail-closed en SMART_GUARD
            await botLogger.warn("B3_REGEX_NO_MATCH", `SMART_GUARD BUY bloqueado - no se pudo parsear señales (fail-closed)`, {
              pair,
              signal: "BUY",
              reason: "B3_REGEX_NO_MATCH",
              signalReason: signal.reason,
              strategyId: "momentum",
              entryMode: "SMART_GUARD",
            });
            log(`[B3] ${pair}: BLOQUEADO - regex no matcheó reason: "${signal.reason}"`, "trading");
            return;
          }
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

        const minVolume = this.getOrderMin(pair);
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
        
        // === CÁLCULO DE TAMAÑO DE ORDEN (tradeAmountUSD) ===
        // SMART_GUARD v2: sgMinEntryUsd es un "objetivo preferido", no un bloqueo
        // - Si saldo >= sgMinEntryUsd → usar sgMinEntryUsd exactamente (no más)
        // - Si saldo < sgMinEntryUsd → fallback automático a saldo disponible
        // - floorUsd = max(exchangeMin, absoluteMin) → hard block si saldo < floorUsd
        let tradeAmountUSD: number;
        let wasAdjusted = false;
        let originalAmount: number;
        let sgReasonCode: SmartGuardReasonCode | undefined;
        
        // Para SMART_GUARD: calcular orderUsdProposed por lógica normal, luego validar mínimos
        const sgParams = positionMode === "SMART_GUARD" ? this.getSmartGuardParams(pair, botConfig) : null;
        const sgMinEntryUsd = sgParams?.sgMinEntryUsd || 100;
        const sgAllowUnderMin = sgParams?.sgAllowUnderMin ?? true; // DEPRECATED - se ignora
        const sgFeeCushionPct = sgParams?.sgFeeCushionPct || 0;
        const sgFeeCushionAuto = sgParams?.sgFeeCushionAuto ?? false;
        
        // Calcular fee cushion efectivo (auto = 2 * KRAKEN_FEE_PCT)
        const effectiveCushionPct = sgFeeCushionAuto ? (KRAKEN_FEE_PCT * 2) : sgFeeCushionPct;
        
        // usdDisponible = saldo real disponible (sin buffer en SMART_GUARD v2 para sizing exacto)
        const usdDisponible = freshUsdBalance;
        
        // === NUEVA LÓGICA SMART_GUARD v2 ===
        // floorUsd = max(minOrderExchangeUsd, MIN_ORDER_ABSOLUTE_USD) - HARD BLOCK
        const floorUsd = Math.max(SG_ABSOLUTE_MIN_USD, minRequiredUSD);
        
        // availableAfterCushion = saldo menos reserva para fees
        const cushionAmount = freshUsdBalance * (effectiveCushionPct / 100);
        const availableAfterCushion = usdDisponible - cushionAmount;
        
        if (positionMode === "SMART_GUARD") {
          // === SMART_GUARD v2 SIZING ===
          // Regla 1: sgMinEntryUsd es "objetivo preferido"
          // Regla 2: Si saldo >= sgMinEntryUsd → usar sgMinEntryUsd EXACTO
          // Regla 3: Si saldo < sgMinEntryUsd → fallback a saldo disponible (si >= floorUsd)
          // Regla 4: Si saldo < floorUsd → BLOQUEAR
          
          originalAmount = sgMinEntryUsd; // El objetivo propuesto siempre es sgMinEntryUsd
          
          if (availableAfterCushion >= sgMinEntryUsd) {
            // Caso A: Saldo suficiente → usar sgMinEntryUsd EXACTO (no más)
            tradeAmountUSD = sgMinEntryUsd;
            sgReasonCode = "SMART_GUARD_ENTRY_USING_CONFIG_MIN";
            
          } else if (availableAfterCushion >= floorUsd) {
            // Caso B: Saldo insuficiente para config, pero >= floorUsd → fallback automático
            tradeAmountUSD = availableAfterCushion;
            sgReasonCode = "SMART_GUARD_ENTRY_FALLBACK_TO_AVAILABLE";
            
          } else if (usdDisponible >= floorUsd && availableAfterCushion < floorUsd) {
            // Caso C: Fee cushion lo baja de floorUsd → se bloqueará en validación
            tradeAmountUSD = availableAfterCushion;
            sgReasonCode = "SMART_GUARD_BLOCKED_AFTER_FEE_CUSHION";
            
          } else {
            // Caso D: Saldo < floorUsd → se bloqueará en validación
            tradeAmountUSD = usdDisponible;
            sgReasonCode = "SMART_GUARD_BLOCKED_BELOW_EXCHANGE_MIN";
          }
          
          log(`SMART_GUARD ${pair}: Sizing v2 - order=$${tradeAmountUSD.toFixed(2)}, reason=${sgReasonCode}`, "trading");
          log(`  → availableUsd=$${usdDisponible.toFixed(2)}, sgMinEntryUsd=$${sgMinEntryUsd.toFixed(2)}, floorUsd=$${floorUsd.toFixed(2)} [exch=$${minRequiredUSD.toFixed(2)}, abs=$${SG_ABSOLUTE_MIN_USD}]`, "trading");
          log(`  → cushionPct=${effectiveCushionPct.toFixed(2)}%, cushionAmt=$${cushionAmount.toFixed(2)}, availableAfterCushion=$${availableAfterCushion.toFixed(2)}`, "trading");
          log(`  → sgAllowUnderMin=${sgAllowUnderMin} (DEPRECATED - ignorado, siempre fallback automático)`, "trading");
          
          // La validación final de mínimos se hace DESPUÉS con validateMinimumsOrSkip()
        } else {
          // Modos SINGLE/DCA: lógica original con exposure limits
          
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
          
          tradeAmountUSD = freshUsdBalance * (riskPerTradePct / 100);
          tradeAmountUSD = Math.min(tradeAmountUSD, riskConfig.maxTradeUSD);

          // MEJORA 3: Position sizing dinámico basado en confianza
          const confidenceFactor = this.getConfidenceSizingFactor(signal.confidence);
          const originalBeforeConfidence = tradeAmountUSD;
          tradeAmountUSD = tradeAmountUSD * confidenceFactor;
          
          if (confidenceFactor < 1.0) {
            const confPct = toConfidencePct(signal.confidence, 0);
            const factorPct = Math.round(confidenceFactor * 100);
            log(`${pair}: Sizing ajustado por confianza (${confPct.toFixed(0)}%): $${originalBeforeConfidence.toFixed(2)} -> $${tradeAmountUSD.toFixed(2)} (${factorPct}%)`, "trading");
          }

          if (tradeAmountUSD < minRequiredUSD && freshUsdBalance >= minRequiredUSD) {
            const smallAccountAmount = freshUsdBalance * SMALL_ACCOUNT_FACTOR;
            tradeAmountUSD = Math.min(smallAccountAmount, riskConfig.maxTradeUSD);
          }
          
          originalAmount = tradeAmountUSD;
        }

        const exposure = this.getAvailableExposure(pair, botConfig, freshUsdBalance);
        const maxByBalance = Math.max(0, freshUsdBalance * 0.95);
        // POLÍTICA UNIFICADA: SMART_GUARD SÍ respeta maxTotalExposurePct para evitar sobreapalancamiento
        // Pero NO aplica maxPairExposurePct (permite concentración en un par si hay señal fuerte)
        const effectiveMaxAllowed = positionMode === "SMART_GUARD" 
          ? Math.min(exposure.maxTotalAvailable, maxByBalance)  // Solo limita por exposición TOTAL
          : Math.min(exposure.maxAllowed, maxByBalance);  // SINGLE/DCA limita por par Y total
        
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
              await this.telegramService.sendAlertToMultipleChats(`🤖 <b>KRAKEN BOT</b> 🇪🇸
━━━━━━━━━━━━━━━━━━━
⏸️ <b>Par en Espera</b>

📦 <b>Detalles:</b>
   • Par: <code>${pair}</code>
   • Disponible: <code>$${exposure.maxAllowed.toFixed(2)}</code>
   • Mínimo requerido: <code>$${minRequiredUSD.toFixed(2)}</code>

ℹ️ Cooldown: ${this.COOLDOWN_DURATION_MS / 60000} min
━━━━━━━━━━━━━━━━━━━`, "system");
            }
          }
          return;
        }

        // Ajustar por límite de exposición (solo para SINGLE/DCA, SMART_GUARD ya validó arriba)
        if (positionMode !== "SMART_GUARD" && tradeAmountUSD > effectiveMaxAllowed) {
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

        // === VALIDACIÓN FINAL ÚNICA Y CENTRALIZADA (fuente de verdad) ===
        // Se ejecuta ANTES de executeTrade() para REAL y DRY_RUN
        const orderUsdFinal = tradeAmountUSD;
        const envPrefix = environment.isReplit ? "REPLIT/DEV" : "NAS/PROD";
        const currentOpenLotsForLog = this.countLotsForPair(pair);
        const sgMaxLotsPerPairConfig = botConfig?.sgMaxOpenLotsPerPair ?? 1;
        const maxLotsForModeConfig = positionMode === "SMART_GUARD" ? sgMaxLotsPerPairConfig : 1;
        
        const validationResult = validateMinimumsOrSkip({
          positionMode,
          orderUsdFinal,
          orderUsdProposed: originalAmount || tradeAmountUSD,
          usdDisponible: freshUsdBalance,
          exposureAvailable: effectiveMaxAllowed,
          pair,
          sgMinEntryUsd,
          sgAllowUnderMin, // DEPRECATED - se ignora en validación
          dryRun: this.dryRunMode,
          env: envPrefix,
          floorUsd: positionMode === "SMART_GUARD" ? floorUsd : undefined,
          availableAfterCushion: positionMode === "SMART_GUARD" ? availableAfterCushion : undefined,
        });
        
        if (!validationResult.valid) {
          // === [BUY_EVAL] LOGS v2: Valores detallados para auditoría ===
          log(`[BUY_EVAL] ${pair}: mode=${positionMode}, sgReasonCode=${sgReasonCode}`, "trading");
          log(`[BUY_EVAL] ${pair}: availableUsd=$${usdDisponible.toFixed(2)}, sgMinEntryUsd=$${sgMinEntryUsd.toFixed(2)}, floorUsd=$${floorUsd.toFixed(2)}`, "trading");
          log(`[BUY_EVAL] ${pair}: orderUsd=$${orderUsdFinal.toFixed(2)}, availableAfterCushion=$${availableAfterCushion.toFixed(2)}`, "trading");
          log(`[BUY_EVAL] ${pair}: currentOpenLots=${currentOpenLotsForLog}/${maxLotsForModeConfig}`, "trading");
          log(`[BUY_EVAL] ${pair}: DECISION skipReason=${validationResult.skipReason} msg=${validationResult.message}`, "trading");
          log(`[FINAL CHECK] ${pair}: SKIP - ${validationResult.message}`, "trading");
          
          this.lastScanResults.set(pair, {
            signal: "BUY",
            reason: validationResult.skipReason!,
            exposureAvailable: orderUsdFinal,
          });
          
          await botLogger.info("TRADE_SKIPPED", `Señal BUY bloqueada - ${validationResult.skipReason}`, {
            pair,
            signal: "BUY",
            reason: validationResult.skipReason,
            sgReasonCode,
            ...validationResult.meta,
          });
          
          this.setPairCooldown(pair);
          return;
        }
        
        // Log de decisión final antes de ejecutar (con nuevo reason code)
        if (positionMode === "SMART_GUARD" && sgReasonCode) {
          log(`[FINAL CHECK] ${pair}: ALLOWED - ${sgReasonCode} orderUsd=$${orderUsdFinal.toFixed(2)}`, "trading");
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
        
        // Meta completa para trazabilidad v2
        const executionMeta = {
          mode: positionMode,
          usdDisponible: freshUsdBalance,
          orderUsdProposed: originalAmount || tradeAmountUSD,
          orderUsdFinal,
          sgMinEntryUsd,
          floorUsd,
          availableAfterCushion,
          sgReasonCode,
          sgAllowUnderMin_DEPRECATED: sgAllowUnderMin,
          dryRun: this.dryRunMode,
          env: envPrefix,
        };

        const success = await this.executeTrade(pair, "buy", tradeVolume.toFixed(8), currentPrice, signal.reason, adjustmentInfo, undefined, executionMeta);
        if (success) {
          this.lastTradeTime.set(pair, Date.now());
        }

      } else if (signal.action === "sell") {
        // A1: SMART_GUARD bloquea SELL por señal - solo risk exits permiten vender
        // EXCEPCIÓN: Permitir liquidación de huérfanos (balance > 0 sin posición trackeada)
        const botConfigSell = await storage.getBotConfig();
        const positionModeSell = botConfigSell?.positionMode || "SINGLE";
        const isOrphanCleanup = assetBalance > 0 && (!existingPosition || existingPosition.amount <= 0);
        
        if (positionModeSell === "SMART_GUARD" && !isOrphanCleanup) {
          await botLogger.info("TRADE_SKIPPED", `Señal SELL bloqueada en SMART_GUARD - solo risk exits permiten vender`, {
            pair,
            signal: "SELL",
            reason: "SMART_GUARD_SIGNAL_SELL_BLOCKED",
            signalReason: signal.reason,
          });
          
          // Notificar a Telegram
          if (this.telegramService.isInitialized()) {
            await this.telegramService.sendAlertToMultipleChats(`🤖 <b>KRAKEN BOT</b> 🇪🇸
━━━━━━━━━━━━━━━━━━━
🛡️ <b>Señal SELL Bloqueada</b>

📦 <b>Detalles:</b>
   • Par: <code>${pair}</code>
   • Modo: <code>SMART_GUARD</code>

⚠️ Solo risk exits (SL/TP/Trailing) permiten vender.

ℹ️ <i>${signal.reason}</i>
━━━━━━━━━━━━━━━━━━━`, "system");
          }
          
          return;
        }

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

        // === FIX: Vender lote completo, no 50% ===
        // Usar min(lot.amount, realAssetBalance) para evitar insufficient funds
        // Si no hay lot trackeado, usar balance real del wallet
        const lotAmount = existingPosition?.amount ?? assetBalance;
        const realAssetBalance = assetBalance;
        const rawSellVolume = Math.min(lotAmount, realAssetBalance);
        
        // Normalizar al stepSize de Kraken para evitar errores de precisión
        const sellVolume = this.normalizeVolume(pair, rawSellVolume);
        
        const minVolumeSell = this.getOrderMin(pair);
        const sellValueUsd = sellVolume * currentPrice;

        // === DUST DETECTION: No intentar vender si es dust ===
        if (sellVolume < minVolumeSell) {
          await botLogger.info("TRADE_SKIPPED", `SELL skipped - dust position (volumen < mínimo)`, {
            pair,
            signal: "SELL",
            reason: "DUST_POSITION",
            lotAmount,
            realAssetBalance,
            sellVolume,
            minVolume: minVolumeSell,
            sellValueUsd,
            signalReason: signal.reason,
          });
          return;
        }
        
        if (sellValueUsd < DUST_THRESHOLD_USD) {
          await botLogger.info("TRADE_SKIPPED", `SELL skipped - dust position (valor < $${DUST_THRESHOLD_USD})`, {
            pair,
            signal: "SELL",
            reason: "DUST_POSITION",
            lotAmount,
            realAssetBalance,
            sellVolume,
            sellValueUsd,
            dustThresholdUsd: DUST_THRESHOLD_USD,
            signalReason: signal.reason,
          });
          return;
        }

        log(`${pair}: SELL signal - vendiendo ${sellVolume.toFixed(8)} (lot: ${lotAmount.toFixed(8)}, balance: ${realAssetBalance.toFixed(8)}, value: $${sellValueUsd.toFixed(2)})`, "trading");

        const sellContext = existingPosition 
          ? { entryPrice: existingPosition.entryPrice, aiSampleId: existingPosition.aiSampleId, openedAt: existingPosition.openedAt }
          : undefined;
        const success = await this.executeTrade(pair, "sell", sellVolume.toFixed(8), currentPrice, signal.reason, undefined, undefined, undefined, sellContext);
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
      const existingPositions = this.getPositionsByPair(pair);
      const existingPosition = existingPositions[0];

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

        // MODO SINGLE o SMART_GUARD: Bloquear compras si ya hay posición abierta
        const botConfigCheck = await storage.getBotConfig();
        const positionMode = botConfigCheck?.positionMode || "SINGLE";
        const sgMaxLotsPerPair = botConfigCheck?.sgMaxOpenLotsPerPair ?? 1;
        
        // En SINGLE siempre 1 slot. En SMART_GUARD respetamos sgMaxOpenLotsPerPair.
        const maxLotsForMode = positionMode === "SMART_GUARD" ? sgMaxLotsPerPair : 1;
        const currentOpenLots = this.countLotsForPair(pair);
        
        if ((positionMode === "SINGLE" || positionMode === "SMART_GUARD") && currentOpenLots >= maxLotsForMode) {
          const reasonCode = positionMode === "SMART_GUARD" 
            ? "SMART_GUARD_MAX_LOTS_REACHED" 
            : "SINGLE_MODE_POSITION_EXISTS";
          
          log(`${pair}: Compra bloqueada - Modo ${positionMode}, lotes abiertos ${currentOpenLots}/${maxLotsForMode}`, "trading");
          await botLogger.info("TRADE_SKIPPED", `Señal BUY ignorada - máximo de lotes alcanzado`, {
            pair,
            signal: "BUY",
            reason: reasonCode,
            currentOpenLots,
            maxOpenLots: maxLotsForMode,
            existingAmount: existingPosition?.amount || 0,
            signalReason: signal.reason,
          });
          this.lastScanResults.set(pair, {
            signal: "BUY",
            reason: reasonCode,
            exposureAvailable: 0,
          });
          return;
        }

        // B3: SMART_GUARD requiere ≥5 señales para BUY (umbral más estricto)
        // + Market Regime: 6 señales en RANGE, pausa en TRANSITION
        if (positionMode === "SMART_GUARD") {
          const regimeEnabled = botConfigCheck?.regimeDetectionEnabled ?? false;
          let requiredSignals = 5; // Base SMART_GUARD requirement
          let regimeInfo = "";
          
          if (regimeEnabled) {
            try {
              const regimeAnalysis = await this.getMarketRegimeWithCache(pair);
              
              // TRANSITION: Pause new entries
              if (this.shouldPauseEntriesDueToRegime(regimeAnalysis.regime, regimeEnabled)) {
                await botLogger.info("TRADE_SKIPPED", `SMART_GUARD BUY bloqueado - régimen TRANSITION (pausa entradas)`, {
                  pair,
                  signal: "BUY",
                  reason: "REGIME_TRANSITION_PAUSE",
                  regime: regimeAnalysis.regime,
                  adx: regimeAnalysis.adx,
                  regimeReason: regimeAnalysis.reason,
                  signalReason: signal.reason,
                });
                this.lastScanResults.set(pair, {
                  signal: "BUY",
                  reason: `REGIME_PAUSE: ${regimeAnalysis.reason}`,
                });
                return;
              }
              
              // Adjust minSignals based on regime (RANGE = 6, TREND = 5)
              requiredSignals = this.getRegimeMinSignals(regimeAnalysis.regime, 5);
              regimeInfo = ` [Régimen: ${regimeAnalysis.regime}]`;
            } catch (regimeError: any) {
              // On regime detection error, fallback to base SMART_GUARD (5 signals)
              log(`${pair}: Error en detección de régimen, usando base SMART_GUARD: ${regimeError.message}`, "trading");
              // Update scan results to reflect the error state
              this.lastScanResults.set(pair, {
                signal: "BUY",
                reason: `REGIME_ERROR: Fallback a base SMART_GUARD`,
              });
            }
          }
          
          const signalCountMatch = signal.reason.match(/Señales:\s*(\d+)\/(\d+)/);
          if (signalCountMatch) {
            const buySignalCount = parseInt(signalCountMatch[1], 10);
            // Extraer nombre de régimen limpio para analytics
            const regimeMatch = regimeInfo.match(/Régimen:\s*(\w+)/);
            const regimeName = regimeMatch ? regimeMatch[1] : (regimeEnabled ? "BASE" : "DISABLED");
            
            log(`[B3] ${pair}: Parsed señales=${buySignalCount}, required=${requiredSignals}, regime=${regimeName}`, "trading");
            if (buySignalCount < requiredSignals) {
              await botLogger.info("TRADE_SKIPPED", `SMART_GUARD BUY bloqueado - señales insuficientes (${buySignalCount} < ${requiredSignals})${regimeInfo}`, {
                pair,
                signal: "BUY",
                reason: "SMART_GUARD_INSUFFICIENT_SIGNALS",
                got: buySignalCount,
                required: requiredSignals,
                regime: regimeName,
                regimeEnabled,
                signalReason: signal.reason,
              });
              return;
            }
          } else {
            // B3 Fallback: regex no matcheó - fail-closed en SMART_GUARD
            await botLogger.warn("B3_REGEX_NO_MATCH", `SMART_GUARD BUY bloqueado - no se pudo parsear señales (fail-closed)`, {
              pair,
              signal: "BUY",
              reason: "B3_REGEX_NO_MATCH",
              signalReason: signal.reason,
              strategyId: strategyId,
              entryMode: "SMART_GUARD",
            });
            log(`[B3] ${pair}: BLOQUEADO - regex no matcheó reason: "${signal.reason}"`, "trading");
            return;
          }
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

        const minVolume = this.getOrderMin(pair);
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
        
        // === CÁLCULO DE TAMAÑO DE ORDEN (tradeAmountUSD) - UNIFICADO CON analyzePairAndTrade ===
        let tradeAmountUSD: number;
        let wasAdjusted = false;
        let originalAmount: number;
        let sgReasonCode: SmartGuardReasonCode | undefined;
        
        // SMART_GUARD: obtener parámetros
        const sgParams = positionMode === "SMART_GUARD" ? this.getSmartGuardParams(pair, botConfig) : null;
        const sgMinEntryUsd = sgParams?.sgMinEntryUsd || 100;
        const sgAllowUnderMin = sgParams?.sgAllowUnderMin ?? true;
        const sgFeeCushionPct = sgParams?.sgFeeCushionPct || 0;
        const sgFeeCushionAuto = sgParams?.sgFeeCushionAuto ?? false;
        
        const effectiveCushionPct = sgFeeCushionAuto ? (KRAKEN_FEE_PCT * 2) : sgFeeCushionPct;
        const usdDisponible = freshUsdBalance;
        const floorUsd = Math.max(SG_ABSOLUTE_MIN_USD, minRequiredUSD);
        const cushionAmount = freshUsdBalance * (effectiveCushionPct / 100);
        const availableAfterCushion = usdDisponible - cushionAmount;
        
        if (positionMode === "SMART_GUARD") {
          // === SMART_GUARD v2 SIZING (mismo que analyzePairAndTrade) ===
          originalAmount = sgMinEntryUsd;
          
          if (availableAfterCushion >= sgMinEntryUsd) {
            tradeAmountUSD = sgMinEntryUsd;
            sgReasonCode = "SMART_GUARD_ENTRY_USING_CONFIG_MIN";
          } else if (availableAfterCushion >= floorUsd) {
            tradeAmountUSD = availableAfterCushion;
            sgReasonCode = "SMART_GUARD_ENTRY_FALLBACK_TO_AVAILABLE";
          } else if (usdDisponible >= floorUsd && availableAfterCushion < floorUsd) {
            tradeAmountUSD = availableAfterCushion;
            sgReasonCode = "SMART_GUARD_BLOCKED_AFTER_FEE_CUSHION";
          } else {
            tradeAmountUSD = usdDisponible;
            sgReasonCode = "SMART_GUARD_BLOCKED_BELOW_EXCHANGE_MIN";
          }
          
          log(`SMART_GUARD ${pair} [${strategyId}]: Sizing v2 - order=$${tradeAmountUSD.toFixed(2)}, reason=${sgReasonCode}`, "trading");
          log(`  → availableUsd=$${usdDisponible.toFixed(2)}, sgMinEntryUsd=$${sgMinEntryUsd.toFixed(2)}, floorUsd=$${floorUsd.toFixed(2)}`, "trading");
        } else {
          // Modos SINGLE/DCA: lógica original
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
          
          tradeAmountUSD = freshUsdBalance * (riskPerTradePct / 100);
          tradeAmountUSD = Math.min(tradeAmountUSD, riskConfig.maxTradeUSD);

          const confidenceFactor = this.getConfidenceSizingFactor(signal.confidence);
          tradeAmountUSD = tradeAmountUSD * confidenceFactor;

          if (tradeAmountUSD < minRequiredUSD && freshUsdBalance >= minRequiredUSD) {
            const smallAccountAmount = freshUsdBalance * SMALL_ACCOUNT_FACTOR;
            tradeAmountUSD = Math.min(smallAccountAmount, riskConfig.maxTradeUSD);
          }
          
          originalAmount = tradeAmountUSD;
        }

        const exposure = this.getAvailableExposure(pair, botConfig, freshUsdBalance);
        const maxByBalance = Math.max(0, freshUsdBalance * 0.95);
        const effectiveMaxAllowed = positionMode === "SMART_GUARD"
          ? Math.min(exposure.maxTotalAvailable, maxByBalance)
          : Math.min(exposure.maxAllowed, maxByBalance);
        
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

        // Ajustar por límite de exposición (solo para SINGLE/DCA)
        if (positionMode !== "SMART_GUARD" && tradeAmountUSD > effectiveMaxAllowed) {
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
        // A2: SMART_GUARD bloquea SELL por señal - solo risk exits permiten vender
        // EXCEPCIÓN: Permitir liquidación de huérfanos (balance > 0 sin posición trackeada)
        const botConfigSellCandles = await storage.getBotConfig();
        const positionModeSellCandles = botConfigSellCandles?.positionMode || "SINGLE";
        const isOrphanCleanupCandles = assetBalance > 0 && (!existingPosition || existingPosition.amount <= 0);
        
        if (positionModeSellCandles === "SMART_GUARD" && !isOrphanCleanupCandles) {
          await botLogger.info("TRADE_SKIPPED", `Señal SELL bloqueada en SMART_GUARD - solo risk exits permiten vender`, {
            pair,
            signal: "SELL",
            reason: "SMART_GUARD_SIGNAL_SELL_BLOCKED",
            strategyId,
            signalReason: signal.reason,
          });
          return;
        }

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

        // === FIX: Vender lote completo, no 50% ===
        // Si no hay lot trackeado, usar balance real del wallet
        const lotAmount = existingPosition?.amount ?? assetBalance;
        const realAssetBalance = assetBalance;
        const rawSellVolume = Math.min(lotAmount, realAssetBalance);
        const sellVolume = this.normalizeVolume(pair, rawSellVolume);
        
        const minVolumeSell = this.getOrderMin(pair);
        const sellValueUsd = sellVolume * currentPrice;

        // === DUST DETECTION ===
        if (sellVolume < minVolumeSell) {
          await botLogger.info("TRADE_SKIPPED", `SELL skipped - dust position (volumen < mínimo)`, {
            pair,
            signal: "SELL",
            reason: "DUST_POSITION",
            lotAmount,
            realAssetBalance,
            sellVolume,
            minVolume: minVolumeSell,
            sellValueUsd,
            strategyId,
          });
          return;
        }
        
        if (sellValueUsd < DUST_THRESHOLD_USD) {
          await botLogger.info("TRADE_SKIPPED", `SELL skipped - dust position (valor < $${DUST_THRESHOLD_USD})`, {
            pair,
            signal: "SELL",
            reason: "DUST_POSITION",
            lotAmount,
            realAssetBalance,
            sellVolume,
            sellValueUsd,
            dustThresholdUsd: DUST_THRESHOLD_USD,
            strategyId,
          });
          return;
        }

        log(`${pair}: SELL signal [${strategyId}] - vendiendo ${sellVolume.toFixed(8)} (value: $${sellValueUsd.toFixed(2)})`, "trading");

        const sellContext = existingPosition 
          ? { entryPrice: existingPosition.entryPrice, aiSampleId: existingPosition.aiSampleId, openedAt: existingPosition.openedAt }
          : undefined;
        const success = await this.executeTrade(pair, "sell", sellVolume.toFixed(8), currentPrice, `${signal.reason} [${strategyId}]`, undefined, undefined, undefined, sellContext);
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
        reason: `Momentum alcista: ${reasons.join(", ")} | Señales: ${buySignals}/${sellSignals}`,
      };
    }
    
    if (sellSignals >= 4 && sellSignals > buySignals && rsi > 30) {
      return {
        action: "sell",
        pair,
        confidence,
        reason: `Momentum bajista: ${reasons.join(", ")} | Señales: ${sellSignals}/${buySignals}`,
      };
    }

    return { action: "hold", pair, confidence: 0.3, reason: `Sin señal clara | Señales: ${buySignals}/${sellSignals}` };
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

  // === MARKET REGIME DETECTION ===
  
  // Wilder's smoothing helper (used in ADX calculation)
  private wilderSmooth(values: number[], period: number): number[] {
    if (values.length < period) return [];
    
    const result: number[] = [];
    // First value is simple sum of first N periods
    let sum = 0;
    for (let i = 0; i < period; i++) {
      sum += values[i];
    }
    result.push(sum);
    
    // Subsequent values use Wilder's smoothing: prev - (prev/N) + current
    for (let i = period; i < values.length; i++) {
      const smoothed = result[result.length - 1] - (result[result.length - 1] / period) + values[i];
      result.push(smoothed);
    }
    
    return result;
  }
  
  private calculateADX(candles: OHLCCandle[], period: number = 14): number {
    // Require enough candles for proper ADX calculation (need 2*period for ADX smoothing)
    if (!candles || candles.length < period * 2 + 1) return 25; // Default neutral value
    
    try {
      const dmPlus: number[] = [];
      const dmMinus: number[] = [];
      const trueRanges: number[] = [];
      
      // Calculate DM and TR for each period (starts at index 1)
      for (let i = 1; i < candles.length; i++) {
        const current = candles[i];
        const prev = candles[i - 1];
        
        // Validate candle data
        if (!current || !prev || 
            typeof current.high !== 'number' || typeof current.low !== 'number' ||
            typeof prev.high !== 'number' || typeof prev.low !== 'number' ||
            typeof prev.close !== 'number' ||
            !isFinite(current.high) || !isFinite(current.low) ||
            !isFinite(prev.high) || !isFinite(prev.low) || !isFinite(prev.close)) {
          // Push zeros to maintain array alignment
          dmPlus.push(0);
          dmMinus.push(0);
          trueRanges.push(0);
          continue;
        }
        
        const highDiff = current.high - prev.high;
        const lowDiff = prev.low - current.low;
        
        // +DM: higher high movement (only if > lower low movement and > 0)
        // -DM: lower low movement (only if > higher high movement and > 0)
        const plusDM = (highDiff > lowDiff && highDiff > 0) ? highDiff : 0;
        const minusDM = (lowDiff > highDiff && lowDiff > 0) ? lowDiff : 0;
        dmPlus.push(plusDM);
        dmMinus.push(minusDM);
        
        // True Range: max of (H-L, |H-prevC|, |L-prevC|)
        const tr = Math.max(
          current.high - current.low,
          Math.abs(current.high - prev.close),
          Math.abs(current.low - prev.close)
        );
        trueRanges.push(isFinite(tr) ? tr : 0);
      }
      
      if (trueRanges.length < period * 2) return 25;
      
      // Apply Wilder's smoothing to TR, +DM, -DM
      const smoothedTR = this.wilderSmooth(trueRanges, period);
      const smoothedDMPlus = this.wilderSmooth(dmPlus, period);
      const smoothedDMMinus = this.wilderSmooth(dmMinus, period);
      
      if (smoothedTR.length < period || smoothedDMPlus.length < period || smoothedDMMinus.length < period) {
        return 25;
      }
      
      // Calculate DI+ and DI- for each smoothed period, then DX
      const dxValues: number[] = [];
      for (let i = 0; i < smoothedTR.length; i++) {
        const tr = smoothedTR[i];
        if (tr <= 0 || !isFinite(tr)) continue;
        
        const diPlus = (smoothedDMPlus[i] / tr) * 100;
        const diMinus = (smoothedDMMinus[i] / tr) * 100;
        
        if (!isFinite(diPlus) || !isFinite(diMinus)) continue;
        
        const diSum = diPlus + diMinus;
        if (diSum <= 0) continue;
        
        const dx = (Math.abs(diPlus - diMinus) / diSum) * 100;
        if (isFinite(dx)) {
          dxValues.push(dx);
        }
      }
      
      if (dxValues.length < period) return 25;
      
      // ADX is Wilder-smoothed DX
      const adxSmoothed = this.wilderSmooth(dxValues, period);
      if (adxSmoothed.length === 0) return 25;
      
      // Return the latest ADX value, divided by period since Wilder stores sums
      const rawAdx = adxSmoothed[adxSmoothed.length - 1] / period;
      
      if (!isFinite(rawAdx)) return 25;
      
      return Math.min(100, Math.max(0, rawAdx));
    } catch (error) {
      return 25; // Safe default on any error
    }
  }

  private detectMarketRegime(candles: OHLCCandle[]): RegimeAnalysis {
    const defaultResult: RegimeAnalysis = {
      regime: "TRANSITION",
      adx: 25,
      emaAlignment: 0,
      bollingerWidth: 2,
      confidence: 0.3,
      reason: "Datos insuficientes para detección de régimen",
    };
    
    if (!candles || candles.length < 50) {
      return defaultResult;
    }
    
    try {
      const closes = candles.map(c => c.close).filter(c => isFinite(c));
      if (closes.length < 50) {
        return defaultResult;
      }
      
      const currentPrice = closes[closes.length - 1];
      if (!isFinite(currentPrice) || currentPrice <= 0) {
        return defaultResult;
      }
      
      // 1. Calculate ADX (trend strength) - safely coerced
      let adx = this.calculateADX(candles, 14);
      if (!isFinite(adx)) adx = 25;
      
      // 2. Calculate EMA alignment (20, 50, 200) - safely coerced
      let ema20 = this.calculateEMA(closes.slice(-20), 20);
      let ema50 = this.calculateEMA(closes.slice(-50), 50);
      let ema200 = candles.length >= 200 ? this.calculateEMA(closes, 200) : ema50;
      
      if (!isFinite(ema20)) ema20 = currentPrice;
      if (!isFinite(ema50)) ema50 = currentPrice;
      if (!isFinite(ema200)) ema200 = ema50;
      
      let emaAlignment = 0;
      if (ema20 > 0) { // Guard against division by zero
        if (currentPrice > ema20 && ema20 > ema50 && ema50 > ema200) {
          emaAlignment = 1; // Perfect bullish alignment
        } else if (currentPrice < ema20 && ema20 < ema50 && ema50 < ema200) {
          emaAlignment = -1; // Perfect bearish alignment
        } else if (Math.abs(currentPrice - ema20) / ema20 < 0.01) {
          emaAlignment = 0; // Price stuck near EMA20
        } else {
          emaAlignment = 0.5 * Math.sign(currentPrice - ema50);
        }
      }
      
      // 3. Calculate Bollinger Band width (volatility indicator) - safely coerced
      const bollinger = this.calculateBollingerBands(closes);
      let bollingerWidth = bollinger.middle > 0 
        ? ((bollinger.upper - bollinger.lower) / bollinger.middle) * 100 
        : 2;
      if (!isFinite(bollingerWidth)) bollingerWidth = 2;
      
      // 4. Determine regime
      let regime: MarketRegime;
      let confidence: number;
      let reason: string;
      
      if (adx > 25 && Math.abs(emaAlignment) >= 0.5) {
        // Strong trend: ADX high + EMAs aligned
        regime = "TREND";
        confidence = Math.min(0.95, 0.6 + (adx - 25) / 50 + Math.abs(emaAlignment) * 0.2);
        const direction = emaAlignment > 0 ? "alcista" : "bajista";
        reason = `Tendencia ${direction} (ADX=${adx.toFixed(0)}, EMAs alineadas)`;
      } else if (adx < 20 && bollingerWidth < 4) {
        // Range: ADX low + narrow bands
        regime = "RANGE";
        confidence = Math.min(0.9, 0.5 + (20 - adx) / 40 + (4 - bollingerWidth) / 8);
        reason = `Mercado lateral (ADX=${adx.toFixed(0)}, BB width=${bollingerWidth.toFixed(1)}%)`;
      } else {
        // Transition: between regimes
        regime = "TRANSITION";
        confidence = 0.5;
        reason = `Transición (ADX=${adx.toFixed(0)}, esperando confirmación)`;
      }
      
      if (!isFinite(confidence)) confidence = 0.5;
      
      return {
        regime,
        adx,
        emaAlignment,
        bollingerWidth,
        confidence,
        reason,
      };
    } catch (error) {
      return defaultResult;
    }
  }

  private getRegimeAdjustedParams(
    baseParams: { sgBeAtPct: number; sgTrailDistancePct: number; sgTrailStepPct: number; sgTpFixedPct: number },
    regime: MarketRegime,
    regimeEnabled: boolean
  ): { sgBeAtPct: number; sgTrailDistancePct: number; sgTrailStepPct: number; sgTpFixedPct: number } {
    if (!regimeEnabled) {
      return baseParams;
    }
    
    const preset = REGIME_PRESETS[regime];
    
    // Apply regime adjustments (blend base with preset)
    return {
      sgBeAtPct: preset.sgBeAtPct,
      sgTrailDistancePct: preset.sgTrailDistancePct,
      sgTrailStepPct: preset.sgTrailStepPct,
      sgTpFixedPct: preset.sgTpFixedPct,
    };
  }

  private async getMarketRegimeWithCache(pair: string): Promise<RegimeAnalysis> {
    const cached = this.regimeCache.get(pair);
    if (cached && Date.now() - cached.timestamp < this.REGIME_CACHE_TTL_MS) {
      return cached.regime;
    }
    
    // Get 1h candles for regime detection (most stable timeframe)
    try {
      const candles = await this.krakenService.getOHLC(pair, 60); // 1h candles
      if (!candles || candles.length < 50) {
        return {
          regime: "TRANSITION",
          adx: 25,
          emaAlignment: 0,
          bollingerWidth: 2,
          confidence: 0.3,
          reason: "Datos insuficientes",
        };
      }
      
      const analysis = this.detectMarketRegime(candles);
      
      // Cache result
      this.regimeCache.set(pair, { regime: analysis, timestamp: Date.now() });
      
      // Check for regime change and alert
      const lastRegime = this.lastRegime.get(pair);
      if (lastRegime && lastRegime !== analysis.regime) {
        await this.sendRegimeChangeAlert(pair, lastRegime, analysis);
      }
      this.lastRegime.set(pair, analysis.regime);
      
      return analysis;
    } catch (error: any) {
      log(`Error obteniendo régimen para ${pair}: ${error.message}`, "trading");
      return {
        regime: "TRANSITION",
        adx: 25,
        emaAlignment: 0,
        bollingerWidth: 2,
        confidence: 0.3,
        reason: "Error en detección",
      };
    }
  }

  private async sendRegimeChangeAlert(pair: string, fromRegime: MarketRegime, analysis: RegimeAnalysis) {
    const regimeEmoji: Record<MarketRegime, string> = {
      TREND: "📈",
      RANGE: "↔️",
      TRANSITION: "⏳",
    };
    
    const regimeDescriptions: Record<MarketRegime, string> = {
      TREND: "Tendencia fuerte",
      RANGE: "Mercado lateral",
      TRANSITION: "Transición (pausa entradas)",
    };
    
    const preset = REGIME_PRESETS[analysis.regime];
    const presetInfo = analysis.regime === "TRANSITION" 
      ? "Entradas pausadas hasta confirmación"
      : `BE: ${preset.sgBeAtPct}%, Trail: ${preset.sgTrailDistancePct}%, TP: ${preset.sgTpFixedPct}%, MinSig: ${preset.minSignals}`;
    
    const message = `
━━━━━━━━━━━━━━━━━━━
${regimeEmoji[analysis.regime]} <b>Cambio de Régimen</b>

📦 <b>Detalles:</b>
   • Par: <code>${pair}</code>
   • Antes: <code>${fromRegime}</code> → Ahora: <code>${analysis.regime}</code>
   • ADX: <code>${analysis.adx.toFixed(0)}</code>
   • Razón: <code>${analysis.reason}</code>

⚙️ <b>Parámetros ajustados:</b>
   ${presetInfo}

🔗 <a href="${environment.panelUrl}">Ver Panel</a>
━━━━━━━━━━━━━━━━━━━`;

    await this.telegramService.sendMessage(message, "system");
    await botLogger.info("REGIME_CHANGE", `Régimen cambiado en ${pair}: ${fromRegime} → ${analysis.regime}`, {
      pair,
      fromRegime,
      toRegime: analysis.regime,
      adx: analysis.adx,
      confidence: analysis.confidence,
      reason: analysis.reason,
    });
  }

  getRegimeMinSignals(regime: MarketRegime, baseMinSignals: number): number {
    const preset = REGIME_PRESETS[regime];
    // Never go below the stricter of base config or regime preset
    return Math.max(baseMinSignals, preset.minSignals);
  }

  shouldPauseEntriesDueToRegime(regime: MarketRegime, regimeEnabled: boolean): boolean {
    if (!regimeEnabled) return false;
    return REGIME_PRESETS[regime].pauseEntries;
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

  // === HELPER: Validar cantidad de venta antes de enviar orden ===
  // Solo para flujo SELL/cierre. NO afecta BUY ni sizing global.
  private async validateSellAmount(
    pair: string,
    lotId: string,
    requestedAmount: number
  ): Promise<{
    canSell: boolean;
    sellAmountFinal: number;
    reason: string;
    isDust: boolean;
    realAssetBalance: number;
    orderMin: number;
    stepSize: number;
    needsPositionAdjust: boolean;
  }> {
    const stepSize = this.krakenService.getStepSize(pair) || 0.00000001;
    const orderMin = this.getOrderMin(pair);
    
    // 1) Obtener balance real del asset base
    let freshBalances: any;
    try {
      freshBalances = await this.krakenService.getBalance();
    } catch (error: any) {
      log(`[MANUAL_CLOSE_EVAL] ${pair} ${lotId}: ERROR getBalance - ${error.message}`, "trading");
      return {
        canSell: false,
        sellAmountFinal: 0,
        reason: `Error obteniendo balance de Kraken: ${error.message}`,
        isDust: false,
        realAssetBalance: 0,
        orderMin,
        stepSize,
        needsPositionAdjust: false,
      };
    }
    
    const realAssetBalance = this.getAssetBalance(pair, freshBalances);
    
    // 2) Calcular sellAmount seguro = min(requested, realBalance)
    let sellAmountRaw = Math.min(requestedAmount, realAssetBalance);
    
    // 3) Normalizar al stepSize (truncar, no redondear)
    const decimals = Math.abs(Math.log10(stepSize));
    const sellAmountFinal = Math.floor(sellAmountRaw * Math.pow(10, decimals)) / Math.pow(10, decimals);
    
    // 4) Caso DUST: balance real < orderMin
    if (realAssetBalance < orderMin) {
      const logMsg = `[MANUAL_CLOSE_EVAL] ${pair} ${lotId} | lotAmount=${requestedAmount.toFixed(8)} realBalance=${realAssetBalance.toFixed(8)} orderMin=${orderMin} stepSize=${stepSize} sellFinal=0 decision=DUST`;
      log(logMsg, "trading");
      
      return {
        canSell: false,
        sellAmountFinal: 0,
        reason: `Balance real (${realAssetBalance.toFixed(8)}) menor al mínimo de Kraken (${orderMin}). Posición marcada como DUST.`,
        isDust: true,
        realAssetBalance,
        orderMin,
        stepSize,
        needsPositionAdjust: false,
      };
    }
    
    // 5) Verificar si sellAmountFinal queda por debajo del mínimo tras normalizar
    if (sellAmountFinal < orderMin) {
      const logMsg = `[MANUAL_CLOSE_EVAL] ${pair} ${lotId} | lotAmount=${requestedAmount.toFixed(8)} realBalance=${realAssetBalance.toFixed(8)} orderMin=${orderMin} stepSize=${stepSize} sellFinal=${sellAmountFinal.toFixed(8)} decision=BELOW_MIN_AFTER_NORMALIZE`;
      log(logMsg, "trading");
      
      return {
        canSell: false,
        sellAmountFinal: 0,
        reason: `Cantidad normalizada (${sellAmountFinal.toFixed(8)}) menor al mínimo de Kraken (${orderMin}).`,
        isDust: true,
        realAssetBalance,
        orderMin,
        stepSize,
        needsPositionAdjust: false,
      };
    }
    
    // 6) Detectar discrepancia: position.amount > realAssetBalance
    const needsPositionAdjust = requestedAmount > realAssetBalance * 1.005; // tolerancia 0.5%
    
    const logMsg = `[MANUAL_CLOSE_EVAL] ${pair} ${lotId} | lotAmount=${requestedAmount.toFixed(8)} realBalance=${realAssetBalance.toFixed(8)} orderMin=${orderMin} stepSize=${stepSize} sellFinal=${sellAmountFinal.toFixed(8)} decision=CAN_SELL${needsPositionAdjust ? " (adjusted)" : ""}`;
    log(logMsg, "trading");
    
    return {
      canSell: true,
      sellAmountFinal,
      reason: needsPositionAdjust 
        ? `Cantidad ajustada de ${requestedAmount.toFixed(8)} a ${sellAmountFinal.toFixed(8)} (balance real)` 
        : "OK",
      isDust: false,
      realAssetBalance,
      orderMin,
      stepSize,
      needsPositionAdjust,
    };
  }

  private async executeTrade(
    pair: string,
    type: "buy" | "sell",
    volume: string,
    price: number,
    reason: string,
    adjustmentInfo?: { wasAdjusted: boolean; originalAmountUsd: number; adjustedAmountUsd: number },
    strategyMeta?: { strategyId: string; timeframe: string; confidence: number },
    executionMeta?: { mode: string; usdDisponible: number; orderUsdProposed: number; orderUsdFinal: number; minOrderUsd: number; allowUnderMin: boolean; dryRun: boolean },
    sellContext?: { entryPrice: number; aiSampleId?: number; openedAt?: number | Date | null } // For sells: pass entry price and openedAt for P&L and duration tracking
  ): Promise<boolean> {
    try {
      // === VALIDACIÓN: Bloquear pares no-USD ===
      const allowedQuotes = ["USD"];
      const pairQuote = pair.split("/")[1];
      if (!allowedQuotes.includes(pairQuote)) {
        log(`[BLOCKED] Par ${pair} rechazado: quote "${pairQuote}" no permitido (solo ${allowedQuotes.join(", ")})`, "trading");
        await botLogger.warn("PAIR_NOT_ALLOWED_QUOTE", `Trade bloqueado: par ${pair} no tiene quote USD`, {
          pair,
          type,
          quote: pairQuote,
          allowedQuotes,
        });
        return false;
      }
      
      const volumeNum = parseFloat(volume);
      const totalUSD = volumeNum * price;
      
      // === PUNTO 2: Autocompletar strategyMeta desde posición si falta ===
      if (!strategyMeta?.strategyId || !strategyMeta?.timeframe) {
        // Buscar posiciones por par para heredar meta de la posición original
        const positions = this.getPositionsByPair(pair);
        let pos: OpenPosition | null = null;
        
        // Si hay múltiples posiciones, usar la más antigua (FIFO)
        if (positions.length > 0) {
          pos = positions[0];
        }
        
        if (pos) {
          strategyMeta = {
            strategyId: pos.entryStrategyId ?? strategyMeta?.strategyId ?? "unknown",
            timeframe: pos.entrySignalTf ?? strategyMeta?.timeframe ?? "cycle",
            confidence: pos.signalConfidence ?? strategyMeta?.confidence ?? 0,
          };
          log(`[META] Autocompletado strategyMeta desde posición ${pos.lotId}: ${strategyMeta.strategyId}/${strategyMeta.timeframe}`, "trading");
        }
      }
      
      // === DRY_RUN MODE: Simular sin enviar orden real ===
      if (this.dryRunMode) {
        const envPrefix = environment.isReplit ? "[REPLIT/DEV][DRY\\_RUN]" : "[NAS/PROD][DRY\\_RUN]";
        const envPrefixLog = environment.isReplit ? "[REPLIT/DEV][DRY_RUN]" : "[NAS/PROD][DRY_RUN]";
        
        // === DOBLE CINTURÓN: Validación redundante para DRY_RUN ===
        // Si falla mínimos, ni simula ni envía mensaje de trade
        if (type === "buy" && executionMeta) {
          const positionMode = executionMeta.mode || "SINGLE";
          const orderUsdFinal = totalUSD;
          const sgMinEntryUsd = executionMeta.minOrderUsd || 100;
          const sgAllowUnderMin = executionMeta.allowUnderMin ?? true;
          
          const doubleBeltValidation = validateMinimumsOrSkip({
            positionMode,
            orderUsdFinal,
            orderUsdProposed: executionMeta.orderUsdProposed || orderUsdFinal,
            usdDisponible: executionMeta.usdDisponible || 0,
            exposureAvailable: executionMeta.orderUsdFinal || 0,
            pair,
            sgMinEntryUsd,
            sgAllowUnderMin,
            dryRun: true,
            env: envPrefixLog,
          });
          
          if (!doubleBeltValidation.valid) {
            log(`${envPrefixLog} BLOQUEADO - ${doubleBeltValidation.message}`, "trading");
            await botLogger.info("TRADE_SKIPPED", `${envPrefixLog} Trade bloqueado en double-belt`, {
              pair,
              type,
              reason: doubleBeltValidation.skipReason,
              ...doubleBeltValidation.meta,
            });
            // NO enviar Telegram de simulación - solo log
            return false;
          }
        }
        
        const simTxid = `DRY-${Date.now()}`;
        log(`${envPrefixLog} SIMULACIÓN ${type.toUpperCase()} ${volume} ${pair} @ $${price.toFixed(2)} (Total: $${totalUSD.toFixed(2)})`, "trading");
        
        await botLogger.info("DRY_RUN_TRADE", `${envPrefixLog} Trade simulado - NO enviado al exchange`, {
          pair,
          type,
          volume: volumeNum,
          price,
          totalUsd: totalUSD,
          simTxid,
          reason,
          ...(executionMeta || {}),
        });
        
        // Enviar Telegram de simulación con prefijo correcto
        if (this.telegramService.isInitialized()) {
          const emoji = type === "buy" ? "🟢" : "🔴";
          const tipoLabel = type === "buy" ? "COMPRAR" : "VENDER";
          
          await this.telegramService.sendMessage(`🤖 <b>KRAKEN BOT</b> 🇪🇸
━━━━━━━━━━━━━━━━━━━
🧪 <b>Trade Simulado</b> [DRY_RUN]

${emoji} <b>SEÑAL: ${tipoLabel} ${pair}</b> ${emoji}

💵 <b>Precio:</b> <code>$${price.toFixed(2)}</code>
📦 <b>Cantidad:</b> <code>${volume}</code>
💰 <b>Total:</b> <code>$${totalUSD.toFixed(2)}</code>

⚠️ Modo simulación - NO se envió orden real
━━━━━━━━━━━━━━━━━━━`);
        }
        
        return true; // Simular éxito para flujo normal
      }
      
      // C1: Validar sellContext ANTES de ejecutar orden real (excepto emergency exits)
      if (type === "sell" && !sellContext) {
        const isEmergencyExit = reason.toLowerCase().includes("stop-loss") || 
                                 reason.toLowerCase().includes("emergencia") ||
                                 reason.toLowerCase().includes("emergency");
        if (!isEmergencyExit) {
          log(`[ERROR] SELL BLOQUEADO sin sellContext para ${pair} - violación de trazabilidad. Razón: ${reason}`, "trading");
          await botLogger.warn("SELL_BLOCKED_NO_CONTEXT", `SELL bloqueado - sin sellContext`, {
            pair,
            type,
            volume,
            price,
            reason,
          });
          return false;
        }
        log(`[WARN] Emergency SELL sin sellContext para ${pair} - permitido. Razón: ${reason}`, "trading");
      }
      
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
      
      // === A) P&L INMEDIATO EN SELL AUTOMÁTICO ===
      let tradeEntryPrice: string | null = null;
      let tradeRealizedPnlUsd: string | null = null;
      let tradeRealizedPnlPct: string | null = null;
      let reasonWithContext = reason;
      
      if (type === "sell") {
        const entryPrice = sellContext?.entryPrice ?? null;
        
        if (entryPrice != null && entryPrice > 0) {
          // A2: Calcular P&L con entryPrice disponible
          const grossPnlUsd = (price - entryPrice) * volumeNum;
          const pnlPct = ((price - entryPrice) / entryPrice) * 100;
          // Fee no disponible en este scope - guardar gross P&L
          tradeEntryPrice = entryPrice.toString();
          tradeRealizedPnlUsd = grossPnlUsd.toFixed(8);
          tradeRealizedPnlPct = pnlPct.toFixed(4);
          log(`[P&L] SELL ${pair}: entry=$${entryPrice.toFixed(2)} exit=$${price.toFixed(2)} → PnL=$${grossPnlUsd.toFixed(2)} (${pnlPct.toFixed(2)}%)`, "trading");
        } else {
          // A3: Orphan/emergency sin entryPrice - permitir pero marcar
          reasonWithContext = `${reason} | SELL_NO_ENTRYPRICE`;
          log(`[WARN] SELL ${pair} sin entryPrice - P&L no calculado (orphan/emergency)`, "trading");
        }
      }
      
      await storage.createTrade({
        tradeId,
        pair,
        type,
        price: price.toString(),
        amount: volume,
        status: "filled",
        krakenOrderId: txid,
        executedAt: new Date(),
        entryPrice: tradeEntryPrice,
        realizedPnlUsd: tradeRealizedPnlUsd,
        realizedPnlPct: tradeRealizedPnlPct,
      });

      // volumeNum ya declarado arriba
      if (type === "buy") {
        this.currentUsdBalance -= volumeNum * price;
        const existingPositions = this.getPositionsByPair(pair);
        const existing = existingPositions[0]; // First position for DCA mode
        let newPosition: OpenPosition;
        
        const entryStrategyId = strategyMeta?.strategyId || "momentum_cycle";
        const entrySignalTf = strategyMeta?.timeframe || "cycle";
        const signalConfidence = strategyMeta?.confidence;
        
        const currentConfig = await storage.getBotConfig();
        const entryMode = currentConfig?.positionMode || "SINGLE";
        
        // In SMART_GUARD with multi-lot, always create new positions
        const shouldCreateNewLot = entryMode === "SMART_GUARD" || !existing || existing.amount <= 0;
        
        if (!shouldCreateNewLot && existing) {
          // DCA mode: update existing position
          const totalAmount = existing.amount + volumeNum;
          const avgPrice = (existing.amount * existing.entryPrice + volumeNum * price) / totalAmount;
          newPosition = { 
            ...existing,
            amount: totalAmount, 
            entryPrice: avgPrice,
            highestPrice: Math.max(existing.highestPrice, price),
          };
          this.openPositions.set(existing.lotId, newPosition);
          log(`DCA entry: ${pair} (${existing.lotId}) - preserved snapshot from original entry`, "trading");
        } else {
          // NEW POSITION: create snapshot of current config with unique lotId
          const lotId = generateLotId(pair);
          
          const configSnapshot: ConfigSnapshot = {
            stopLossPercent: parseFloat(currentConfig?.stopLossPercent?.toString() || "5"),
            takeProfitPercent: parseFloat(currentConfig?.takeProfitPercent?.toString() || "7"),
            trailingStopEnabled: currentConfig?.trailingStopEnabled ?? false,
            trailingStopPercent: parseFloat(currentConfig?.trailingStopPercent?.toString() || "2"),
            positionMode: entryMode,
          };
          
          // Add SMART_GUARD specific params using getSmartGuardParams() for per-pair override support
          if (entryMode === "SMART_GUARD") {
            const sgParams = this.getSmartGuardParams(pair, currentConfig);
            configSnapshot.sgMinEntryUsd = sgParams.sgMinEntryUsd;
            configSnapshot.sgAllowUnderMin = sgParams.sgAllowUnderMin;
            configSnapshot.sgBeAtPct = sgParams.sgBeAtPct;
            configSnapshot.sgFeeCushionPct = sgParams.sgFeeCushionPct;
            configSnapshot.sgFeeCushionAuto = sgParams.sgFeeCushionAuto;
            configSnapshot.sgTrailStartPct = sgParams.sgTrailStartPct;
            configSnapshot.sgTrailDistancePct = sgParams.sgTrailDistancePct;
            configSnapshot.sgTrailStepPct = sgParams.sgTrailStepPct;
            configSnapshot.sgTpFixedEnabled = sgParams.sgTpFixedEnabled;
            configSnapshot.sgTpFixedPct = sgParams.sgTpFixedPct;
            configSnapshot.sgScaleOutEnabled = sgParams.sgScaleOutEnabled;
            configSnapshot.sgScaleOutPct = sgParams.sgScaleOutPct;
            configSnapshot.sgMinPartUsd = sgParams.sgMinPartUsd;
            configSnapshot.sgScaleOutThreshold = sgParams.sgScaleOutThreshold;
            
            // Apply regime-based adjustments if enabled
            const regimeEnabled = currentConfig?.regimeDetectionEnabled ?? false;
            if (regimeEnabled) {
              try {
                const regimeAnalysis = await this.getMarketRegimeWithCache(pair);
                const regimeAdjusted = this.getRegimeAdjustedParams(
                  {
                    sgBeAtPct: configSnapshot.sgBeAtPct!,
                    sgTrailDistancePct: configSnapshot.sgTrailDistancePct!,
                    sgTrailStepPct: configSnapshot.sgTrailStepPct!,
                    sgTpFixedPct: configSnapshot.sgTpFixedPct!,
                  },
                  regimeAnalysis.regime,
                  true
                );
                configSnapshot.sgBeAtPct = regimeAdjusted.sgBeAtPct;
                configSnapshot.sgTrailDistancePct = regimeAdjusted.sgTrailDistancePct;
                configSnapshot.sgTrailStepPct = regimeAdjusted.sgTrailStepPct;
                configSnapshot.sgTpFixedPct = regimeAdjusted.sgTpFixedPct;
                log(`[REGIME] ${pair}: Snapshot ajustado para ${regimeAnalysis.regime} (BE=${regimeAdjusted.sgBeAtPct}%, Trail=${regimeAdjusted.sgTrailDistancePct}%, TP=${regimeAdjusted.sgTpFixedPct}%)`, "trading");
              } catch (regimeErr: any) {
                log(`[REGIME] ${pair}: Error ajustando snapshot, usando params base: ${regimeErr.message}`, "trading");
              }
            }
          }
          
          newPosition = { 
            lotId,
            pair,
            amount: volumeNum, 
            entryPrice: price,
            highestPrice: price,
            openedAt: Date.now(),
            entryStrategyId,
            entrySignalTf,
            signalConfidence,
            signalReason: reason,
            entryMode,
            configSnapshot,
            // SMART_GUARD initial state
            sgBreakEvenActivated: false,
            sgCurrentStopPrice: undefined,
            sgTrailingActivated: false,
            sgScaleOutDone: false,
          };
          this.openPositions.set(lotId, newPosition);
          
          const lotCount = this.countLotsForPair(pair);
          if (entryMode === "SMART_GUARD") {
            log(`NEW LOT #${lotCount}: ${pair} (${lotId}) - SMART_GUARD snapshot saved (BE=${configSnapshot.sgBeAtPct}%, trail=${configSnapshot.sgTrailDistancePct}%, TP=${configSnapshot.sgTpFixedEnabled ? configSnapshot.sgTpFixedPct + '%' : 'OFF'})`, "trading");
          } else {
            log(`NEW POSITION: ${pair} (${lotId}) - snapshot saved (SL=${configSnapshot.stopLossPercent}%, TP=${configSnapshot.takeProfitPercent}%, trailing=${configSnapshot.trailingStopEnabled}, mode=${entryMode})`, "trading");
          }
        }
        
        // AI Sample collection: save features for ALL buy entries (not just new positions)
        if (!newPosition.aiSampleId) {
          try {
            const features = aiService.extractFeatures({
              rsi: 50, // Will be enriched from actual indicators in future
              confidence: toConfidencePct(signalConfidence, 50),
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
        // SELL: Update balance and P&L tracking
        // Note: Position management for sells is now handled by the callers 
        // (checkSinglePositionSLTP, checkSmartGuardExit, forceClosePosition)
        // which have the lotId context. This block only updates balance/P&L metrics.
        this.currentUsdBalance += volumeNum * price;
        
        // Calculate P&L using sellContext if provided (for correct per-lot tracking)
        if (sellContext) {
          const pnl = (price - sellContext.entryPrice) * volumeNum;
          this.dailyPnL += pnl;
          log(`P&L de operación: $${pnl.toFixed(2)} | P&L diario acumulado: $${this.dailyPnL.toFixed(2)}`, "trading");
          
          // AI Sample update: mark sample complete with PnL result
          if (sellContext.aiSampleId) {
            try {
              await storage.updateAiSample(sellContext.aiSampleId, {
                exitPrice: price.toString(),
                exitTs: new Date(),
                pnlGross: pnl.toString(),
                pnlNet: pnl.toString(),
                labelWin: pnl > 0 ? 1 : 0,
                isComplete: true,
              });
              log(`[AI] Sample #${sellContext.aiSampleId} actualizado: PnL=${pnl.toFixed(2)} (${pnl > 0 ? 'WIN' : 'LOSS'})`, "trading");
            } catch (aiErr: any) {
              log(`[AI] Error actualizando sample: ${aiErr.message}`, "trading");
            }
          }
        } else {
          // C1: sellContext no proporcionado - ya validado antes de ejecutar orden
          // Si llegamos aquí, es emergency exit permitido (P&L no registrado)
          log(`[WARN] Emergency SELL completado sin sellContext para ${pair} - P&L no registrado.`, "trading");
        }
        // Position deletion is handled by the caller (checkSinglePositionSLTP, checkSmartGuardExit, etc.)
      }

      const emoji = type === "buy" ? "🟢" : "🔴";
      const totalUSDFormatted = totalUSD.toFixed(2);
      
      if (this.telegramService.isInitialized()) {
        const strategyLabel = strategyMeta?.strategyId ? 
          ((strategyMeta?.timeframe && strategyMeta.timeframe !== "cycle") ? 
            `Momentum (Velas ${strategyMeta.timeframe})` : 
            "Momentum (Ciclos)") : 
          "Momentum (Ciclos)";
        const confidenceValue = strategyMeta?.confidence ? toConfidencePct(strategyMeta.confidence, 0).toFixed(0) : "N/A";
        const tipoLabel = type === "buy" ? "COMPRAR" : "VENDER";
        
        await this.telegramService.sendMessage(`🤖 <b>KRAKEN BOT</b> 🇪🇸
━━━━━━━━━━━━━━━━━━━
${emoji} <b>SEÑAL: ${tipoLabel} ${pair}</b> ${emoji}

💵 <b>Precio:</b> <code>$${price.toFixed(2)}</code>
📦 <b>Cantidad:</b> <code>${volume}</code>
💰 <b>Total:</b> <code>$${totalUSDFormatted}</code>

🧠 <b>Estrategia:</b> ${strategyLabel}
📈 <b>Confianza:</b> <code>${confidenceValue}%</code>

🔗 <b>ID:</b> <code>${txid}</code>
━━━━━━━━━━━━━━━━━━━`);
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
      
      // FIFO Matcher: Ingest real sell fill and trigger automatic matching
      // Only runs for real sells - DRY_RUN returns early at line ~3161
      // Triple guard: check dryRunMode AND executionMeta.dryRun for belt-and-suspenders safety
      const isSimulation = this.dryRunMode || (executionMeta?.dryRun ?? false);
      if (type === "sell" && !isSimulation) {
        try {
          const fee = volumeNum * price * (KRAKEN_FEE_PCT / 100); // Use existing fee constant
          await storage.upsertTradeFill({
            txid,
            pair,
            type: "sell",
            price: price.toString(),
            amount: volume,
            fee: fee.toFixed(8),
            matched: false,
          });
          
          const sellFill = await storage.getTradeFillByTxid(txid);
          if (sellFill) {
            const matchResult = await fifoMatcher.processSellFill(sellFill);
            log(`[FIFO] Auto-matched sell ${txid}: matched=${matchResult.totalMatched.toFixed(8)}, lots_closed=${matchResult.lotsClosed}, pnl=$${matchResult.pnlNet.toFixed(2)}`, "trading");
            
            if (matchResult.lotsClosed > 0) {
              await botLogger.info("FIFO_LOTS_CLOSED", `FIFO cerró ${matchResult.lotsClosed} lotes automáticamente`, {
                pair,
                sellTxid: txid,
                matchedQty: matchResult.totalMatched,
                lotsClosed: matchResult.lotsClosed,
                pnlNet: matchResult.pnlNet,
              });
            }
          }
        } catch (fifoErr: any) {
          log(`[FIFO] Error procesando sell ${txid}: ${fifoErr.message}`, "trading");
        }
      }
      
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
        await this.telegramService.sendMessage(`🤖 <b>KRAKEN BOT</b> 🇪🇸
━━━━━━━━━━━━━━━━━━━
⚠️ <b>Error en Operación</b>

📦 <b>Detalles:</b>
   • Par: <code>${pair}</code>
   • Tipo: <code>${type}</code>

❌ <b>Error:</b> <code>${error.message}</code>
━━━━━━━━━━━━━━━━━━━`);
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

  // === CIERRE MANUAL DE POSICIÓN ===
  async forceClosePosition(
    pair: string,
    currentPrice: number,
    correlationId: string,
    reason: string,
    lotId?: string // Optional: specify which lot to close (for multi-lot support)
  ): Promise<{
    success: boolean;
    error?: string;
    orderId?: string;
    pnlUsd?: number;
    pnlPct?: number;
    dryRun?: boolean;
    lotId?: string;
    isDust?: boolean; // Flag para indicar que la posición es DUST y no se puede cerrar
  }> {
    try {
      // Find the position to close
      let position: OpenPosition | undefined;
      if (lotId) {
        position = this.openPositions.get(lotId);
      } else {
        // Close the first position for this pair
        const positions = this.getPositionsByPair(pair);
        position = positions[0];
      }
      
      if (!position || position.amount <= 0) {
        return {
          success: false,
          error: "No se encontró posición abierta en memoria para este par",
        };
      }

      const positionLotId = position.lotId;
      const amount = position.amount;
      const entryPrice = position.entryPrice;
      const pnlUsd = (currentPrice - entryPrice) * amount;
      const pnlPct = ((currentPrice - entryPrice) / entryPrice) * 100;

      log(`[MANUAL_CLOSE] Iniciando cierre de ${pair} (${positionLotId}): ${amount.toFixed(8)} @ $${currentPrice.toFixed(2)}`, "trading");

      // En DRY_RUN, simular el cierre
      if (this.dryRunMode) {
        const simTxid = `MANUAL-DRY-${Date.now()}`;
        log(`[DRY_RUN] SIMULACIÓN cierre manual ${pair} (${positionLotId}) - ${amount.toFixed(8)} @ $${currentPrice.toFixed(2)}`, "trading");

        // Actualizar memoria y DB para reflejar el cierre (aunque sea simulado)
        this.openPositions.delete(positionLotId);
        await storage.deleteOpenPositionByLotId(positionLotId);

        // Registrar el trade de cierre
        const tradeId = `MANUAL-${Date.now()}`;
        await storage.createTrade({
          tradeId,
          pair,
          type: "sell",
          price: currentPrice.toString(),
          amount: amount.toFixed(8),
          status: "filled",
          krakenOrderId: simTxid,
          entryPrice: entryPrice.toString(),
          realizedPnlUsd: pnlUsd.toString(),
          realizedPnlPct: pnlPct.toString(),
          executedAt: new Date(),
        });

        // Notificar por Telegram
        if (this.telegramService.isInitialized()) {
          const pnlEmoji = pnlUsd >= 0 ? "📈" : "📉";
          await this.telegramService.sendMessage(`🤖 <b>KRAKEN BOT</b> 🇪🇸
━━━━━━━━━━━━━━━━━━━
🧪 <b>Cierre Manual Simulado</b> [DRY_RUN]

📦 <b>Detalles:</b>
   • Par: <code>${pair}</code>
   • Cantidad: <code>${amount.toFixed(8)}</code>
   • Precio entrada: <code>$${entryPrice.toFixed(2)}</code>
   • Precio salida: <code>$${currentPrice.toFixed(2)}</code>

${pnlEmoji} <b>PnL:</b> <code>${pnlUsd >= 0 ? "+" : ""}$${pnlUsd.toFixed(2)} (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%)</code>

⚠️ Modo simulación - NO se envió orden real
━━━━━━━━━━━━━━━━━━━`);
        }

        return {
          success: true,
          orderId: simTxid,
          pnlUsd,
          pnlPct,
          dryRun: true,
          lotId: positionLotId,
        };
      }

      // === VALIDACIÓN PRE-SELL: Verificar balance real y detectar DUST ===
      const validation = await this.validateSellAmount(pair, positionLotId, amount);
      
      if (!validation.canSell) {
        // Caso DUST: no se puede vender, devolver error con flag isDust
        if (validation.isDust) {
          // Enviar alerta Telegram
          if (this.telegramService.isInitialized()) {
            await this.telegramService.sendMessage(`🤖 <b>KRAKEN BOT</b> 🇪🇸
━━━━━━━━━━━━━━━━━━━
⚠️ <b>Posición DUST Detectada</b>

📦 <b>Detalles:</b>
   • Par: <code>${pair}</code>
   • Lot: <code>${positionLotId}</code>
   • Cantidad registrada: <code>${amount.toFixed(8)}</code>
   • Balance real: <code>${validation.realAssetBalance.toFixed(8)}</code>
   • Mínimo Kraken: <code>${validation.orderMin}</code>

ℹ️ No se puede cerrar - usar "Eliminar huérfana" en UI
━━━━━━━━━━━━━━━━━━━`);
          }
        }
        
        return {
          success: false,
          error: validation.reason,
          lotId: positionLotId,
          isDust: validation.isDust,
        };
      }
      
      // Si hubo ajuste de cantidad, actualizar posición interna
      const sellAmountFinal = validation.sellAmountFinal;
      if (validation.needsPositionAdjust) {
        log(`[MANUAL_CLOSE] Ajustando posición ${pair} (${positionLotId}) de ${amount} a ${sellAmountFinal}`, "trading");
        position.amount = sellAmountFinal;
        this.openPositions.set(positionLotId, position);
        await this.savePositionToDB(pair, position);
      }
      
      // Recalcular PnL con cantidad real
      const actualPnlUsd = (currentPrice - entryPrice) * sellAmountFinal;
      const actualPnlPct = ((currentPrice - entryPrice) / entryPrice) * 100;

      // PRODUCCIÓN: Ejecutar orden real de venta
      const order = await this.krakenService.placeOrder({
        pair,
        type: "sell",
        ordertype: "market",
        volume: sellAmountFinal.toFixed(8),
      });

      const txid = order.txid?.[0];
      if (!txid) {
        return {
          success: false,
          error: "Orden enviada pero no se recibió txid de confirmación",
        };
      }

      // Actualizar memoria y DB (usar lotId para multi-lot)
      this.openPositions.delete(positionLotId);
      await storage.deleteOpenPositionByLotId(positionLotId);

      // Registrar el trade de cierre
      const tradeId = `MANUAL-${Date.now()}`;
      await storage.createTrade({
        tradeId,
        pair,
        type: "sell",
        price: currentPrice.toString(),
        amount: sellAmountFinal.toFixed(8),
        status: "filled",
        krakenOrderId: txid,
        entryPrice: entryPrice.toString(),
        realizedPnlUsd: actualPnlUsd.toString(),
        realizedPnlPct: actualPnlPct.toString(),
        executedAt: new Date(),
      });

      // Notificar por Telegram
      if (this.telegramService.isInitialized()) {
        const pnlEmoji = actualPnlUsd >= 0 ? "📈" : "📉";
        await this.telegramService.sendMessage(`🤖 <b>KRAKEN BOT</b> 🇪🇸
━━━━━━━━━━━━━━━━━━━
🔴 <b>Cierre Manual Ejecutado</b>

📦 <b>Detalles:</b>
   • Par: <code>${pair}</code>
   • Cantidad: <code>${sellAmountFinal.toFixed(8)}</code>
   • Precio entrada: <code>$${entryPrice.toFixed(2)}</code>
   • Precio salida: <code>$${currentPrice.toFixed(2)}</code>

${pnlEmoji} <b>PnL:</b> <code>${actualPnlUsd >= 0 ? "+" : ""}$${actualPnlUsd.toFixed(2)} (${actualPnlPct >= 0 ? "+" : ""}${actualPnlPct.toFixed(2)}%)</code>

🔗 <b>ID:</b> <code>${txid}</code>
━━━━━━━━━━━━━━━━━━━`);
      }

      log(`[MANUAL_CLOSE] Cierre exitoso ${pair} (${positionLotId}) - Order: ${txid}, PnL: $${actualPnlUsd.toFixed(2)}`, "trading");

      return {
        success: true,
        orderId: txid,
        pnlUsd: actualPnlUsd,
        pnlPct: actualPnlPct,
        dryRun: false,
        lotId: positionLotId,
      };

    } catch (error: any) {
      log(`[MANUAL_CLOSE] Error al cerrar ${pair}: ${error.message}`, "trading");
      return {
        success: false,
        error: error.message,
      };
    }
  }

  getOpenPositions(): Map<string, { amount: number; entryPrice: number }> {
    return this.openPositions;
  }

  // === DIAGNÓSTICO: Obtener resultados del scan con razones en español ===
  async getScanDiagnostic(): Promise<{
    pairs: Array<{
      pair: string;
      signal: string;
      razon: string;
      cooldownSec?: number;
      exposureAvailable?: number;
      hasPosition: boolean;
      positionUsd?: number;
      regime?: string;
      regimeReason?: string;
      requiredSignals?: number;
    }>;
    positionMode: string;
    usdBalance: number;
    totalOpenPositions: number;
    lastScanAt: string | null;
    regimeDetectionEnabled: boolean;
  }> {
    const config = await storage.getBotConfig();
    const positionMode = config?.positionMode || "SINGLE";
    const regimeDetectionEnabled = config?.regimeDetectionEnabled ?? false;
    
    // Mapeo de razones a español (según documento SMART_GUARD)
    const reasonTranslations: Record<string, string> = {
      "PAIR_COOLDOWN": "En enfriamiento - esperando reintentos",
      "SINGLE_MODE_POSITION_EXISTS": "Ya hay posición abierta en este par",
      "SMART_GUARD_POSITION_EXISTS": "Ya hay posición abierta en este par",
      "SMART_GUARD_MAX_LOTS_REACHED": "Máximo de lotes abiertos alcanzado para este par",
      "STOPLOSS_COOLDOWN": "Enfriamiento post stop-loss activo",
      "SPREAD_TOO_HIGH": "Spread demasiado alto para operar",
      "POSITION_TOO_LARGE": "Posición existente demasiado grande",
      "INSUFFICIENT_FUNDS": "Fondos USD insuficientes",
      "LOW_PROFITABILITY": "Take-profit menor que comisiones",
      "EXPOSURE_ZERO": "Sin exposición disponible",
      "VOLUME_BELOW_MINIMUM": "Volumen calculado < mínimo Kraken",
      "SG_MIN_ENTRY_NOT_MET": "Mínimo por operación no alcanzado (tiene saldo, pero tamaño quedó por debajo)",
      "SG_REDUCED_ENTRY": "Saldo por debajo del mínimo — entro con lo disponible",
      "MIN_ORDER_ABSOLUTE": "Por debajo del mínimo absoluto ($20) — mínimo exchange no alcanzado",
      "MIN_ORDER_USD": "SKIP - Mínimo por orden no alcanzado (allowUnderMin=OFF)",
      "NO_POSITION": "Sin posición para vender",
      "AI_FILTER_REJECTED": "Señal rechazada por filtro IA",
      "Sin señal": "Sin señal de trading activa",
    };

    const pairs: Array<{
      pair: string;
      signal: string;
      razon: string;
      cooldownSec?: number;
      exposureAvailable?: number;
      hasPosition: boolean;
      positionUsd?: number;
      regime?: string;
      regimeReason?: string;
      requiredSignals?: number;
    }> = [];

    // Helper: buscar posiciones por par (openPositions usa lotId como clave, no pair)
    const getPositionsForPair = (targetPair: string): OpenPosition[] => {
      const positions: OpenPosition[] = [];
      this.openPositions.forEach((pos) => {
        if (pos.pair === targetPair && pos.amount > 0) {
          positions.push(pos);
        }
      });
      return positions;
    };

    // Si hay datos de escaneo, usar esos
    if (this.lastScanResults.size > 0) {
      for (const [pair, result] of this.lastScanResults.entries()) {
        const pairPositions = getPositionsForPair(pair);
        const hasPosition = pairPositions.length > 0;
        const totalPositionUsd = pairPositions.reduce((sum, p) => sum + (p.amount * p.entryPrice), 0);
        
        // Traducir la razón
        let razon = result.reason;
        for (const [key, value] of Object.entries(reasonTranslations)) {
          if (razon.includes(key) || razon === key) {
            razon = value;
            break;
          }
        }

        // Obtener cooldown si no viene en el resultado
        const cooldownSec = result.cooldownSec ?? this.getCooldownRemainingSec(pair);

        // Obtener régimen si está habilitado
        let regime: string | undefined;
        let regimeReason: string | undefined;
        let requiredSignals: number | undefined;
        
        if (regimeDetectionEnabled) {
          try {
            const regimeAnalysis = await this.getMarketRegimeWithCache(pair);
            regime = regimeAnalysis.regime;
            regimeReason = regimeAnalysis.reason;
            requiredSignals = this.getRegimeMinSignals(regimeAnalysis.regime, 5);
          } catch (err) {
            regime = "ERROR";
            regimeReason = "Error obteniendo régimen";
          }
        }

        pairs.push({
          pair,
          signal: result.signal,
          razon,
          cooldownSec: cooldownSec > 0 ? cooldownSec : undefined,
          exposureAvailable: result.exposureAvailable,
          hasPosition,
          positionUsd: hasPosition ? totalPositionUsd : undefined,
          regime,
          regimeReason,
          requiredSignals,
        });
      }
    } else {
      // Si no hay datos de escaneo, mostrar pares activos con info básica
      const activePairs = config?.activePairs || [];
      for (const pair of activePairs) {
        const pairPositions = getPositionsForPair(pair);
        const hasPosition = pairPositions.length > 0;
        const totalPositionUsd = pairPositions.reduce((sum, p) => sum + (p.amount * p.entryPrice), 0);
        const exposure = this.getAvailableExposure(pair, config, this.currentUsdBalance);
        
        // Determinar razón basada en el estado real
        let razon = "Bot inactivo - actívalo para escanear";
        if (this.isRunning) {
          if (this.lastScanTime > 0) {
            razon = "Sin señal activa";
          } else {
            razon = "Esperando primer escaneo...";
          }
        }
        
        const cooldownSec = this.getCooldownRemainingSec(pair);
        
        // Obtener régimen si está habilitado (mismo que rama principal)
        let regime: string | undefined;
        let regimeReason: string | undefined;
        let requiredSignals: number | undefined;
        
        if (regimeDetectionEnabled) {
          try {
            const regimeAnalysis = await this.getMarketRegimeWithCache(pair);
            regime = regimeAnalysis.regime;
            regimeReason = regimeAnalysis.reason;
            requiredSignals = this.getRegimeMinSignals(regimeAnalysis.regime, 5);
          } catch (err) {
            regime = "ERROR";
            regimeReason = "Error obteniendo régimen";
          }
        }
        
        pairs.push({
          pair,
          signal: "NONE",
          razon,
          cooldownSec: cooldownSec > 0 ? cooldownSec : undefined,
          exposureAvailable: exposure.maxAllowed,
          hasPosition,
          positionUsd: hasPosition ? totalPositionUsd : undefined,
          regime,
          regimeReason,
          requiredSignals,
        });
      }
    }

    return {
      pairs,
      positionMode,
      usdBalance: this.currentUsdBalance,
      totalOpenPositions: this.openPositions.size,
      lastScanAt: this.lastScanTime > 0 ? new Date(this.lastScanTime).toISOString() : null,
      regimeDetectionEnabled,
    };
  }
}
