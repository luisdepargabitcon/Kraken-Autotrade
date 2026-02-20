import { KrakenService } from "./kraken";
import { TelegramService } from "./telegram";
import { botLogger } from "./botLogger";
import { storage } from "../storage";
import { log } from "../utils/logger";
import { aiService, AiFeatures } from "./aiService";
import { environment } from "./environment";
import { fifoMatcher } from "./fifoMatcher";
import { toConfidencePct, toConfidenceUnit } from "../utils/confidence";
import { type InsertTrade, type Trade } from "@shared/schema";
import { buildTradeId } from "../utils/tradeId";
import { ExchangeFactory, type ExchangeType } from "./exchanges/ExchangeFactory";
import type { IExchangeService } from "./exchanges/IExchangeService";
import { configService } from "./ConfigService";
import type { TradingConfig } from "@shared/config-schema";
import { errorAlertService, ErrorAlertService } from "./ErrorAlertService";
import { ExitManager, type IExitManagerHost, type OpenPosition as ExitOpenPosition, type ConfigSnapshot as ExitConfigSnapshot, type ExitReason as ExitExitReason, type FeeGatingResult as ExitFeeGatingResult } from "./exitManager";
import {
  calculateEMA as _calculateEMA,
  calculateRSI as _calculateRSI,
  calculateVolatility as _calculateVolatility,
  calculateMACD as _calculateMACD,
  calculateBollingerBands as _calculateBollingerBands,
  calculateATR as _calculateATR,
  calculateATRPercent as _calculateATRPercent,
  detectAbnormalVolume as _detectAbnormalVolume,
  wilderSmooth as _wilderSmooth,
  calculateADX as _calculateADX,
  type PriceData,
  type OHLCCandle,
} from "./indicators";
import {
  detectMarketRegime as _detectMarketRegime,
  getRegimeAdjustedParams as _getRegimeAdjustedParams,
  calculateAtrBasedExits as _calculateAtrBasedExits,
  shouldPauseEntriesDueToRegime as _shouldPauseEntriesDueToRegime,
  REGIME_PRESETS,
  REGIME_CONFIG,
  type MarketRegime,
  type RegimeAnalysis,
  type RegimePreset,
} from "./regimeDetection";
import { RegimeManager, type IRegimeManagerHost } from "./regimeManager";
import { SpreadFilter, type ISpreadFilterHost } from "./spreadFilter";
import {
  MtfAnalyzer,
  analyzeTimeframeTrend as _analyzeTimeframeTrend,
  analyzeMultiTimeframe as _analyzeMultiTimeframe,
  type MultiTimeframeData,
  type TrendAnalysis,
} from "./mtfAnalysis";

interface TradeSignal {
  action: "buy" | "sell" | "hold";
  pair: string;
  confidence: number;
  reason: string;
  // Signal count diagnostics (for PAIR_DECISION_TRACE)
  signalsCount?: number;      // Number of signals in favor of action
  minSignalsRequired?: number; // Minimum signals required for action
  hybridGuard?: { watchId: number; reason: "ANTI_CRESTA" | "MTF_STRICT" };
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

// Fee structure (taker fees for market orders)
// NOTA: Bot es MARKET-only = 100% taker
// Kraken Pro tier base: 0.40% taker
// Revolut X: 0.09% taker
const KRAKEN_FEE_PCT = 0.40; // Fallback/default - use getTakerFeePct() for dynamic value
const SLIPPAGE_BUFFER_PCT = 0.20; // Buffer adicional para slippage en market orders
const MIN_PROFIT_MULTIPLIER = 2; // Take-profit debe ser al menos 2x las fees

// Dynamic fee helper - gets fee from active trading exchange
function getTakerFeePct(): number {
  try {
    const fees = ExchangeFactory.getTradingExchangeFees();
    return fees.takerFeePct;
  } catch {
    return KRAKEN_FEE_PCT; // Fallback to Kraken fees
  }
}
function getRoundTripFeePct(): number {
  return getTakerFeePct() * 2;
}

function getRoundTripWithBufferPct(): number {
  return getRoundTripFeePct() + SLIPPAGE_BUFFER_PCT;
}

// Defensive improvements
// MAX_SPREAD_PCT removed â€” spread threshold now comes from bot config (dynamicSpread)
const TRADING_HOURS_START = 8; // UTC - inicio de horario de trading
const TRADING_HOURS_END = 22; // UTC - fin de horario de trading
const POST_STOPLOSS_COOLDOWN_MS = 30 * 60 * 1000; // 30 min cooldown tras stop-loss
const CONFIDENCE_SIZING_THRESHOLDS = {
  high: { min: 0.8, factor: 1.0 },    // 100% del monto
  medium: { min: 0.7, factor: 0.75 }, // 75% del monto
  low: { min: 0.6, factor: 0.5 },     // 50% del monto
};

// SMART_GUARD: umbral absoluto mÃ­nimo para evitar comisiones absurdas
const SG_ABSOLUTE_MIN_USD = 20;

// === VALIDACIÃ“N CENTRALIZADA DE MÃNIMOS (fuente Ãºnica de verdad) ===
// Reason codes para SMART_GUARD sizing
type SmartGuardReasonCode = 
  | "SMART_GUARD_BLOCKED_BELOW_EXCHANGE_MIN"   // saldo < floorUsd (hard block)
  | "SMART_GUARD_BLOCKED_AFTER_FEE_CUSHION"    // availableAfterCushion < floorUsd
  | "SMART_GUARD_ENTRY_USING_CONFIG_MIN"       // saldo >= sgMinEntryUsd, usando sgMinEntryUsd
  | "SMART_GUARD_ENTRY_FALLBACK_TO_AVAILABLE"; // saldo < sgMinEntryUsd, usando saldo disponible

// === PAIR_DECISION_TRACE: Enum y contexto para diagnÃ³stico ===
type BlockReasonCode = 
  | "NO_SIGNAL"               // No hay seÃ±al de la estrategia
  | "COOLDOWN"                // Par en cooldown
  | "STOPLOSS_COOLDOWN"       // Cooldown post stop-loss
  | "MAX_LOTS_PER_PAIR"       // MÃ¡ximo lotes por par alcanzado
  | "REGIME_PAUSE"            // RÃ©gimen TRANSITION - pausa entradas
  | "MIN_ORDER_USD"           // Order < minOrderUsd configurado
  | "MIN_ORDER_ABSOLUTE"      // Order < mÃ­nimo absoluto ($20)
  | "EXPOSURE_LIMIT"          // LÃ­mite de exposiciÃ³n alcanzado
  | "SPREAD_TOO_HIGH"         // Spread > mÃ¡ximo permitido
  | "TRADING_HOURS"           // Fuera de horario de trading
  | "SIGNALS_THRESHOLD"       // No alcanza minSignals requerido
  | "CONFIDENCE_LOW"          // Confianza < umbral mÃ­nimo
  | "REGIME_ERROR"            // Error detectando rÃ©gimen
  | "DAILY_LIMIT"             // LÃ­mite de pÃ©rdida diaria alcanzado
  | "TRADING_DISABLED"         // Kill-switch por env
  | "POSITIONS_INCONSISTENT"   // Fail-closed: trades bot recientes pero sin open positions
  | "SELL_BLOCKED"            // SELL bloqueado por SMART_GUARD
  | "RSI_OVERBOUGHT"          // BUY bloqueado por RSI >= 70
  | "RSI_OVERSOLD"            // SELL bloqueado por RSI <= 30
  | "NO_POSITION"             // Sin posiciÃ³n para vender
  | "ALLOWED";                // SeÃ±al permitida (no bloqueada)

type SmartGuardDecision = "ALLOW" | "BLOCK" | "SKIP" | "NOOP";

interface DecisionTraceContext {
  scanId: string;
  scanTime: string;
  pair: string;
  regime: string | null;
  regimeReason: string | null;
  selectedStrategy: string | null;
  rawSignal: "BUY" | "SELL" | "NONE";
  rawReason: string | null;
  signalsCount: number | null;
  minSignalsRequired: number | null;
  exposureAvailableUsd: number;
  computedOrderUsd: number;
  minOrderUsd: number;
  allowSmallerEntries: boolean;
  openLotsThisPair: number;
  maxLotsPerPair: number;
  smartGuardDecision: SmartGuardDecision;
  blockReasonCode: BlockReasonCode;
  blockDetails: Record<string, any> | null;
  finalSignal: "BUY" | "SELL" | "NONE";
  finalReason: string;
  // Campos de diagnÃ³stico para ciclos intermedios
  isIntermediateCycle?: boolean;
  lastCandleClosedAt?: string | null;
  lastFullEvaluationAt?: string | null;
  lastRegimeUpdateAt?: string | null;
  // Campos de observabilidad Router FASE 1
  regimeRouterEnabled?: boolean | null;
  feeCushionEffectivePct?: number | null;
}

// Cache para datos del Ãºltimo anÃ¡lisis completo por par (sin llamadas API extra)
interface LastFullAnalysisCache {
  regime: string;
  regimeReason: string;
  selectedStrategy: string;
  signalsCount: number;
  minSignalsRequired: number;
  rawReason: string;
  candleClosedAt: string;
  evaluatedAt: string;
  regimeUpdatedAt: string;
  regimeRouterEnabled?: boolean;
  feeCushionEffectivePct?: number | null;
}

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
      message: `Trade bloqueado: orderUsdFinal $${orderUsdFinal.toFixed(2)} < floorUsd $${effectiveFloor.toFixed(2)} (mÃ­n exchange + absoluto)`,
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
      message: `Trade bloqueado: orderUsdFinal $${orderUsdFinal.toFixed(2)} < mÃ­nimo absoluto $${SG_ABSOLUTE_MIN_USD}`,
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
  entryFee: number; // Fee paid at entry for accurate P&L (two legs)
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
  // Adaptive Exit Engine state per lot
  timeStopDisabled?: boolean;
  timeStopExpiredAt?: number; // Timestamp when time-stop expired (for UI/alerts)
  beProgressiveLevel?: number; // Break-even progressive level (0, 1, 2, 3)
}

// === ADAPTIVE EXIT ENGINE TYPES ===
type ExitReason = 
  | "STOP_LOSS"           // Risk exit - always allowed
  | "EMERGENCY_SL"        // Risk exit - always allowed
  | "DAILY_LOSS_LIMIT"    // Risk exit - always allowed
  | "TIME_STOP_HARD"      // Risk exit - always allowed
  | "TAKE_PROFIT"         // Profit exit - subject to fee-gating
  | "TRAILING_STOP"       // Profit exit - subject to fee-gating
  | "BREAK_EVEN"          // Profit exit - subject to fee-gating
  | "TIME_STOP_SOFT"      // Profit exit - subject to fee-gating
  | "SCALE_OUT";          // Profit exit - subject to fee-gating

interface FeeGatingResult {
  allowed: boolean;
  grossPnlPct: number;
  minCloseNetPct: number;
  estimatedNetPct: number;
  reason: string;
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


export class TradingEngine {
  private krakenService: KrakenService;
  private telegramService: TelegramService;
  private isRunning: boolean = false;
  private intervalId: NodeJS.Timeout | null = null;
  private priceHistory: Map<string, PriceData[]> = new Map();
  private lastTradeTime: Map<string, number> = new Map();
  private openPositions: Map<string, OpenPosition> = new Map(); // Key is lotId for multi-lot support
  private currentUsdBalance: number = 0;
  private mtfAnalyzer!: MtfAnalyzer;
  private readonly PRICE_HISTORY_LENGTH = 50;
  private readonly MIN_TRADE_INTERVAL_MS = 60000;
  
  private dailyPnL: number = 0;
  private dailyStartBalance: number = 0;
  private lastDayReset: string = "";
  private isDailyLimitReached: boolean = false;
  
  private pairCooldowns: Map<string, number> = new Map();
  private lastExposureAlert: Map<string, number> = new Map();
  private stopLossCooldowns: Map<string, number> = new Map();
  
  // Track PENDING_FILL exposure to prevent over-allocation
  // Key: lotId, Value: { pair, expectedUsd }
  private pendingFillExposure: Map<string, { pair: string; expectedUsd: number }> = new Map();
  private readonly COOLDOWN_DURATION_MS = 15 * 60 * 1000;
  private readonly EXPOSURE_ALERT_INTERVAL_MS = 30 * 60 * 1000;
  
  // Tracking para Momentum (Velas) - Ãºltima vela evaluada por par+timeframe
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
    const stepSize = this.getTradingExchange().getStepSize(pair);
    if (stepSize === null) {
      log(`[WARNING] No step size for ${pair}, using 8 decimal fallback`, "trading");
      const fallbackDecimals = 8;
      return Math.floor(volume * Math.pow(10, fallbackDecimals)) / Math.pow(10, fallbackDecimals);
    }
    const decimals = Math.abs(Math.log10(stepSize));
    return Math.floor(volume * Math.pow(10, decimals)) / Math.pow(10, decimals);
  }

  private getOrderMin(pair: string): number {
    const orderMin = this.getTradingExchange().getOrderMin(pair);
    if (orderMin === null) {
      log(`[WARNING] No orderMin for ${pair}, using fallback`, "trading");
      return this.FALLBACK_MINIMUMS[pair] || 0.01;
    }
    return orderMin;
  }

  private hasPairMetadata(pair: string): boolean {
    return this.getTradingExchange().hasMetadata(pair);
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
  // Snapshot de resultados del Ãºltimo scan completado (para MARKET_SCAN_SUMMARY)
  private lastEmittedResults: Map<string, { signal: string; reason: string; cooldownSec?: number; exposureAvailable?: number }> = new Map();
  private lastEmittedScanId: string = "";
  private lastEmittedScanTime: number = 0;
  
  // PAIR_DECISION_TRACE: Contexto de decisiÃ³n por par para diagnÃ³stico
  private pairDecisionTrace: Map<string, DecisionTraceContext> = new Map();
  
  // Scan state tracking (for MARKET_SCAN_SUMMARY guard)
  private scanInProgress: boolean = false;
  private currentScanId: string = "";
  private lastScanStartTime: number = 0;
  private lastExpectedPairs: string[] = [];
  
  // DRY_RUN mode: audit without sending real orders
  private dryRunMode: boolean = false;
  private readonly isReplitEnvironment: boolean = !!process.env.REPLIT_DEPLOYMENT || !!process.env.REPL_ID;

  // Market Regime Detection (delegated to RegimeManager)
  private regimeManager!: RegimeManager;
  // Spread Filter (delegated to SpreadFilter)
  private spreadFilter!: SpreadFilter;
  
  // Cache para Ãºltimo anÃ¡lisis completo por par (evita null en ciclos intermedios)
  private lastFullAnalysisCache: Map<string, LastFullAnalysisCache> = new Map();

  // Dynamic configuration from ConfigService
  private dynamicConfig: TradingConfig | null = null;
  private lastHybridWatchExpireRunMs: number = 0;

  private getHybridGuardConfig(): any {
    return (this.dynamicConfig as any)?.global?.hybridGuard;
  }

  private normalizeHybridReason(reason: string): "ANTI_CRESTA" | "MTF_STRICT" | null {
    const r = String(reason || '').toUpperCase();
    if (r === 'ANTI_CREST') return 'ANTI_CRESTA';
    if (r === 'ANTI_CRESTA') return 'ANTI_CRESTA';
    if (r === 'MTF_STRICT') return 'MTF_STRICT';
    return null;
  }

  private async expireHybridWatchesIfNeeded(): Promise<void> {
    const cfg = this.getHybridGuardConfig();
    if (!cfg?.enabled) return;
    const now = Date.now();
    if (now - this.lastHybridWatchExpireRunMs < 60_000) return;
    this.lastHybridWatchExpireRunMs = now;
    try {
      await storage.expireHybridReentryWatches({ now: new Date() });
    } catch (e: any) {
      log(`[HYBRID_GUARD] expireHybridReentryWatches error: ${e?.message ?? String(e)}`, 'trading');
    }
  }

  private async maybeCreateHybridReentryWatch(params: {
    pair: string;
    timeframe: string;
    strategyId: string;
    reason: string;
    regime?: string | null;
    rawSignal?: string;
    rejectPrice?: number;
    ema20?: number;
    priceVsEma20Pct?: number;
    volumeRatio?: number;
    mtfAlignment?: number;
    signalsCount?: number;
    minSignalsRequired?: number;
    rejectionReasonText?: string;
  }): Promise<void> {
    const cfg = this.getHybridGuardConfig();
    if (!cfg?.enabled) return;

    const normalizedReason = this.normalizeHybridReason(params.reason);
    if (!normalizedReason) return;

    if (normalizedReason === 'ANTI_CRESTA' && cfg?.antiCresta?.enabled === false) return;
    if (normalizedReason === 'MTF_STRICT' && cfg?.mtfStrict?.enabled === false) return;

    await this.expireHybridWatchesIfNeeded();

    const exchange = this.getTradingExchangeType();
    const ttlMinutes = Number(cfg?.ttlMinutes ?? 120);
    const cooldownMinutes = Number(cfg?.cooldownMinutes ?? 0);
    const maxActiveWatchesPerPair = Number(cfg?.maxActiveWatchesPerPair ?? 1);

    try {
      if (Number.isFinite(maxActiveWatchesPerPair) && maxActiveWatchesPerPair > 0) {
        const activeWatches = await storage.countActiveHybridReentryWatchesForPair({
          exchange,
          pair: params.pair,
        });
        if (activeWatches >= maxActiveWatchesPerPair) return;
      }

      const existingActive = await storage.getActiveHybridReentryWatch({
        exchange,
        pair: params.pair,
        strategy: params.strategyId,
        reason: normalizedReason,
      });
      if (existingActive) return;

      if (cooldownMinutes > 0) {
        const recent = await storage.recentlyCreatedHybridReentryWatch({
          exchange,
          pair: params.pair,
          withinMinutes: cooldownMinutes,
          strategy: params.strategyId,
          reason: normalizedReason,
        });
        if (recent) return;
      }

      const now = new Date();
      const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000);
      const created = await storage.insertHybridReentryWatch({
        exchange,
        pair: params.pair,
        strategy: params.strategyId,
        reason: normalizedReason,
        status: 'active',
        createdAt: now,
        expiresAt,
        regime: params.regime ?? null,
        rawSignal: params.rawSignal ?? null,
        rejectPrice: params.rejectPrice != null ? params.rejectPrice.toString() : null,
        ema20: params.ema20 != null ? params.ema20.toString() : null,
        priceVsEma20Pct: params.priceVsEma20Pct != null ? params.priceVsEma20Pct.toString() : null,
        volumeRatio: params.volumeRatio != null ? params.volumeRatio.toString() : null,
        mtfAlignment: params.mtfAlignment != null ? params.mtfAlignment.toString() : null,
        signalsCount: params.signalsCount ?? null,
        minSignalsRequired: params.minSignalsRequired ?? null,
        meta: {
          timeframe: params.timeframe,
          rejectionReasonText: params.rejectionReasonText,
        },
      } as any);

      if (this.telegramService.isInitialized()) {
        const alerts = cfg?.alerts;
        if (alerts?.enabled !== false && alerts?.watchCreated !== false) {
          this.telegramService.sendHybridGuardWatchCreated({
            pair: params.pair,
            exchange,
            reason: normalizedReason,
            ttlMinutes,
            watchId: created.id,
          }).catch((e: any) => log(`[ALERT_ERR] sendHybridGuardWatchCreated: ${e?.message ?? String(e)}`, 'trading'));
        }
      }
    } catch (e: any) {
      log(`[HYBRID_GUARD] create watch error: ${e?.message ?? String(e)}`, 'trading');
    }
  }

  // Exit management delegated to ExitManager
  private exitManager: ExitManager;

  constructor(krakenService: KrakenService, telegramService: TelegramService) {
    this.krakenService = krakenService;
    this.telegramService = telegramService;
    
    // Initialize ExitManager with host adapter
    this.exitManager = new ExitManager(this.createExitHost());
    
    // Initialize RegimeManager with host adapter
    this.regimeManager = new RegimeManager({
      getOHLC: (pair, interval) => this.getDataExchange().getOHLC(pair, interval),
      sendAlertWithSubtype: (msg, cat, sub) => this.telegramService.sendAlertWithSubtype(msg, cat, sub),
    });
    
    // Initialize MtfAnalyzer with host adapter
    this.mtfAnalyzer = new MtfAnalyzer({
      getOHLC: (pair, interval) => this.getDataExchange().getOHLC(pair, interval),
    });
    
    // Initialize SpreadFilter with host adapter
    this.spreadFilter = new SpreadFilter({
      getTradingExchangeType: () => this.getTradingExchangeType(),
      getDataExchangeType: () => ExchangeFactory.getDataExchangeType(),
      sendAlertWithSubtype: (msg, cat, sub) => this.telegramService.sendAlertWithSubtype(msg, cat, sub),
      isTelegramInitialized: () => this.telegramService.isInitialized(),
    });
    
    // Auto-enable dry run on Replit to prevent accidental real trades
    if (this.isReplitEnvironment) {
      this.dryRunMode = true;
      log("[SAFETY] Entorno Replit detectado - DRY_RUN activado automÃ¡ticamente", "trading");
    }
    
    // Setup configuration change listener for hot-reload
    this.setupConfigListener();
    
    // Log regime parameters at startup
    log(`[REGIME_PARAMS] enter=${REGIME_CONFIG.ADX_TREND_ENTRY} exit=${REGIME_CONFIG.ADX_TREND_EXIT} hardExit=${REGIME_CONFIG.ADX_HARD_EXIT} confirm=${REGIME_CONFIG.CONFIRM_SCANS_REQUIRED} minHold=${REGIME_CONFIG.MIN_HOLD_MINUTES} cooldown=${REGIME_CONFIG.NOTIFY_COOLDOWN_MS / 60000}min`, "trading");
    
    // Log exchange configuration
    log(`[EXCHANGE] Trading: ${ExchangeFactory.getTradingExchangeType()}, Data: ${ExchangeFactory.getDataExchangeType()}`, "trading");
  }

  private createExitHost(): IExitManagerHost {
    return {
      getOpenPositions: () => this.openPositions as Map<string, ExitOpenPosition>,
      setPosition: (lotId, position) => { this.openPositions.set(lotId, position as any); },
      deletePosition: (lotId) => { this.openPositions.delete(lotId); },
      savePositionToDB: (pair, position) => this.savePositionToDB(pair, position as any),
      deletePositionFromDBByLotId: (lotId) => this.deletePositionFromDBByLotId(lotId),
      updatePositionHighestPriceByLotId: (lotId, price) => this.updatePositionHighestPriceByLotId(lotId, price),
      getTradingExchange: () => this.getTradingExchange(),
      getDataExchange: () => this.getDataExchange(),
      getTradingExchangeType: () => this.getTradingExchangeType(),
      getTradingFees: () => this.getTradingFees(),
      getOrderMin: (pair) => this.getOrderMin(pair),
      getAssetBalance: (pair, balances) => this.getAssetBalance(pair, balances),
      formatKrakenPair: (pair) => this.formatKrakenPair(pair),
      getPositionsByPair: (pair) => this.getPositionsByPair(pair) as ExitOpenPosition[],
      executeTrade: (pair, type, volume, price, reason, adj?, strat?, exec?, sell?) =>
        this.executeTrade(pair, type, volume, price, reason, adj, strat, exec, sell),
      setStopLossCooldown: (pair) => this.setStopLossCooldown(pair),
      setPairCooldown: (pair) => this.setPairCooldown(pair),
      setLastTradeTime: (pair, time) => { this.lastTradeTime.set(pair, time); },
      clearStopLossCooldown: (pair) => { this.stopLossCooldowns.delete(pair); },
      clearExposureAlert: (pair) => { this.lastExposureAlert.delete(pair); },
      setCurrentUsdBalance: (balance) => { this.currentUsdBalance = balance; },
      getTelegramService: () => this.telegramService,
    };
  }

  private getTradingExchange(): IExchangeService {
    return ExchangeFactory.getTradingExchange();
  }

  private getDataExchange(): IExchangeService {
    return ExchangeFactory.getDataExchange();
  }

  private getTradingExchangeType(): ExchangeType {
    return ExchangeFactory.getTradingExchangeType();
  }

  private getTradingFees(): { takerFeePct: number; makerFeePct: number } {
    return ExchangeFactory.getTradingExchangeFees();
  }

  // === ADAPTIVE EXIT ENGINE: FEE-GATING ===
  // NOTA: El bot usa exclusivamente Ã³rdenes MARKET (100% taker fees).
  // Por tanto, entryFeePct = exitFeePct = takerFeePct.
  // El campo makerFeePct estÃ¡ reservado para futura implementaciÃ³n de Ã³rdenes lÃ­mite.
  // minCloseNetPct = (takerFeePct * 2) + profitBufferPct
  
  // === EXIT HELPERS (delegated to ExitManager) ===
  private isRiskExit(reason: ExitReason): boolean {
    return this.exitManager.isRiskExit(reason);
  }

  private async getAdaptiveExitConfig() {
    return this.exitManager.getAdaptiveExitConfig();
  }

  private calculateMinCloseNetPct(entryFeePct: number, exitFeePct: number, profitBufferPct: number): number {
    return this.exitManager.calculateMinCloseNetPct(entryFeePct, exitFeePct, profitBufferPct);
  }

  private checkFeeGating(grossPnlPct: number, exitReason: ExitReason, entryFeePct: number, exitFeePct: number, profitBufferPct: number): FeeGatingResult {
    return this.exitManager.checkFeeGating(grossPnlPct, exitReason, entryFeePct, exitFeePct, profitBufferPct);
  }

  // === TIME-STOP + PROGRESSIVE BE (delegated to ExitManager) ===

  private async checkTimeStop(
    position: OpenPosition,
    currentPrice: number,
    exitConfig: { enabled: boolean; takerFeePct: number; profitBufferPct: number; timeStopHours: number; timeStopMode: "soft" | "hard" }
  ) {
    return this.exitManager.checkTimeStop(position as any, currentPrice, exitConfig);
  }

  private calculateProgressiveBEStop(
    position: OpenPosition, currentPrice: number, grossPnlPct: number, roundTripFeePct: number, profitBufferPct: number
  ) {
    return this.exitManager.calculateProgressiveBEStop(position as any, currentPrice, grossPnlPct, roundTripFeePct, profitBufferPct);
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

  private async emitOrderTrackingAlert(
    alertType: "TRADE_PERSIST_FAIL" | "POSITION_APPLY_FAIL" | "ORDER_FILLED_BUT_UNTRACKED",
    context: { pair: string; tradeId: string; exchange: string; type: string; error?: string }
  ): Promise<void> {
    const envInfo = environment.getInfo();
    await botLogger.error("TRADE_FAILED", `Critical order tracking issue: ${alertType}`, {
      alertType,
      ...context,
      env: envInfo.env,
      instanceId: envInfo.instanceId,
      timestamp: new Date().toISOString(),
    });

    if (this.telegramService.isInitialized()) {
      // Use new visual error alert
      await this.telegramService.sendCriticalError({
        errorType: alertType,
        pair: context.pair,
        exchange: context.exchange,
        message: `Error en ${context.type}: ${context.error || 'Error desconocido'}`,
        context: {
          tradeId: context.tradeId,
          type: context.type,
          error: context.error,
          alertType,
        },
        timestamp: new Date(),
      });
    }
  }

  private async recoverPendingFillPositionsFromDB() {
    try {
      const exchange = this.getTradingExchangeType();
      const pendingPositions = await storage.getPendingFillPositions(exchange);
      if (!pendingPositions || pendingPositions.length === 0) return;

      log(`[PENDING_FILL_RECOVERY] Found ${pendingPositions.length} pending fill positions to recover`, "trading");

      const { startFillWatcher } = await import('./FillWatcher');

      for (const pos of pendingPositions) {
        const clientOrderId = pos.clientOrderId;
        const venueOrderId = pos.venueOrderId;
        const pair = pos.pair;
        const lotId = pos.lotId || `PENDING-${pos.id}`;
        const expectedAmount = parseFloat(pos.expectedAmount ?? '0');

        if (!clientOrderId || !pair) {
          log(`[PENDING_FILL_RECOVERY] Skipped invalid pending position (missing clientOrderId/pair): id=${pos.id}`, "trading");
          continue;
        }
        if (!venueOrderId) {
          log(`[PENDING_FILL_RECOVERY] Skipped pending position without venueOrderId (cannot query exchange): ${pair} clientOrderId=${clientOrderId}`, "trading");
          continue;
        }
        if (!Number.isFinite(expectedAmount) || expectedAmount <= 0) {
          log(`[PENDING_FILL_RECOVERY] Skipped pending position with invalid expectedAmount=${pos.expectedAmount} for ${pair} (clientOrderId=${clientOrderId})`, "trading");
          continue;
        }

        // Rehydrate pending exposure so SmartGuard doesn't over-allocate after restart
        try {
          const krakenPair = this.formatKrakenPair(pair);
          const ticker = await this.getDataExchange().getTicker(krakenPair);
          const currentPrice = Number((ticker as any)?.last ?? 0);
          if (Number.isFinite(currentPrice) && currentPrice > 0) {
            const expectedUsd = expectedAmount * currentPrice;
            this.addPendingExposure(lotId, pair, expectedUsd);
          }
        } catch (e: any) {
          log(`[PENDING_FILL_RECOVERY] Warning: could not rehydrate pending exposure for ${pair}: ${e.message}`, "trading");
        }

        log(`[PENDING_FILL_RECOVERY] Restarting FillWatcher for ${pair} (lotId=${lotId}, clientOrderId=${clientOrderId}, venueOrderId=${venueOrderId}, expectedAmount=${expectedAmount})`, "trading");

        // Restart FillWatcher: it will use getOrder (now parses average_fill_price) to open the position
        startFillWatcher({
          clientOrderId,
          exchangeOrderId: venueOrderId,
          exchange,
          pair,
          expectedAmount,
          pollIntervalMs: 3000,
          timeoutMs: 120000,
          onPositionOpen: () => {
            this.removePendingExposure(lotId);
          },
          onTimeout: () => {
            this.removePendingExposure(lotId);
          },
        }).catch((err: any) => {
          log(`[PENDING_FILL_RECOVERY] Failed to start FillWatcher for ${pair} (${clientOrderId}): ${err.message}`, "trading");
        });
      }
    } catch (error: any) {
      log(`[PENDING_FILL_RECOVERY] Error recovering pending fill positions: ${error.message}`, "trading");
    }
  }

  async manualBuyForTest(
    pair: string,
    usdAmount: number,
    reason: string
  ): Promise<{ success: boolean; lotId?: string; requestedVolume?: number; netAdded?: number; price?: number; error?: string }> {
    try {
      const tradingEnabled = String(process.env.TRADING_ENABLED ?? 'true').toLowerCase() === 'true';
      if (!tradingEnabled) {
        return { success: false, error: 'TRADING_DISABLED' };
      }

      // Fail-closed safety: if in-memory positions are empty but we have recent bot trades,
      // block manual buys until positions are rebuilt.
      if (this.openPositions.size === 0) {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const recentBotTrades = await storage.getRecentBotTradesCount({ since });
        if (recentBotTrades > 0) {
          return { success: false, error: 'POSITIONS_INCONSISTENT_RECENT_TRADES' };
        }
      }

      log(`[MANUAL_BUY] Iniciando compra manual: ${pair}, $${usdAmount}`, "trading");
      
      const prePositions = this.getPositionsByPair(pair);
      const preAmount = prePositions.reduce((sum, p) => sum + (p.amount || 0), 0);
      const preLotId = prePositions[0]?.lotId;

      // Usar data exchange (Kraken) para precio, igual que el bot automÃ¡tico
      // RevolutX no tiene endpoint de ticker funcional
      const krakenPair = this.formatKrakenPair(pair);
      log(`[MANUAL_BUY] Obteniendo precio de Kraken para ${krakenPair}`, "trading");
      const ticker = await this.getDataExchange().getTicker(krakenPair);
      const currentPrice = Number((ticker as any)?.last ?? 0);
      if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
        log(`[MANUAL_BUY] ERROR: Precio no vÃ¡lido para ${pair}: ${currentPrice}`, "trading");
        return { success: false, error: `Precio no vÃ¡lido para ${pair}: ${currentPrice}` };
      }
      log(`[MANUAL_BUY] Precio obtenido: $${currentPrice.toFixed(4)}`, "trading");

      const requestedVolume = usdAmount / currentPrice;
      const normalizedVolume = this.normalizeVolume(pair, requestedVolume);
      if (!Number.isFinite(normalizedVolume) || normalizedVolume <= 0) {
        log(`[MANUAL_BUY] ERROR: Volumen no vÃ¡lido para ${pair}: ${normalizedVolume}`, "trading");
        return { success: false, error: `Volumen no vÃ¡lido para ${pair}: ${normalizedVolume}` };
      }

      const quote = pair.split('/')[1] || 'USD';
      try {
        const balances = await this.getTradingExchange().getBalance();
        const availableQuote = Number((balances as any)?.[quote] ?? 0);
        const bufferPct = getTakerFeePct() + SLIPPAGE_BUFFER_PCT;
        const requiredQuote = usdAmount * (1 + bufferPct / 100);
        if (!Number.isFinite(availableQuote) || availableQuote < requiredQuote) {
          const availTxt = Number.isFinite(availableQuote) ? availableQuote.toFixed(2) : '0.00';
          const reqTxt = requiredQuote.toFixed(2);
          log(`[MANUAL_BUY] BLOQUEADO: balance insuficiente ${quote}. available=${availTxt} requiredâ‰ˆ${reqTxt} (usdAmount=${usdAmount}, bufferPct=${bufferPct}%)`, "trading");
          return {
            success: false,
            error: `Saldo insuficiente de ${quote}: disponible ${availTxt}, requerido â‰ˆ ${reqTxt} (incluye buffer ${bufferPct}%)`,
          };
        }
      } catch (balErr: any) {
        log(`[MANUAL_BUY] WARNING: No se pudo verificar balance previo: ${balErr.message}`, "trading");
      }

      log(`[MANUAL_BUY] Ejecutando BUY: ${normalizedVolume.toFixed(8)} ${pair} @ $${currentPrice.toFixed(2)}`, "trading");

      const ok = await this.executeTrade(
        pair,
        "buy",
        normalizedVolume.toFixed(8),
        currentPrice,
        reason,
        undefined,
        { strategyId: "manual_test", timeframe: "manual", confidence: 1 },
        undefined
      );

      if (!ok) {
        log(`[MANUAL_BUY] ERROR: executeTrade devolviÃ³ false`, "trading");
        return { success: false, error: "executeTrade fallÃ³ (ver logs para detalles)" };
      }

      const postPositions = this.getPositionsByPair(pair);
      const postAmount = postPositions.reduce((sum, p) => sum + (p.amount || 0), 0);
      const netAdded = postAmount - preAmount;

      let lotId = postPositions[0]?.lotId;
      if (preLotId && postPositions.some((p) => p.lotId === preLotId)) {
        lotId = preLotId;
      }

      log(`[MANUAL_BUY] BUY exitoso: lotId=${lotId}, netAdded=${netAdded.toFixed(8)}`, "trading");

      return {
        success: true,
        lotId,
        requestedVolume: normalizedVolume,
        netAdded,
        price: currentPrice,
      };
    } catch (error: any) {
      log(`[MANUAL_BUY] EXCEPTION: ${error.message}`, "trading");
      return { success: false, error: error.message || String(error) };
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
    // Include OPEN positions
    this.openPositions.forEach((position) => {
      if (position.pair === pair) {
        total += position.amount * position.entryPrice;
      }
    });
    // Include PENDING_FILL positions (not yet filled but order sent)
    this.pendingFillExposure.forEach((pending) => {
      if (pending.pair === pair) {
        total += pending.expectedUsd;
      }
    });
    return total;
  }

  private calculateTotalExposure(): number {
    let total = 0;
    // Include OPEN positions
    this.openPositions.forEach((position) => {
      total += position.amount * position.entryPrice;
    });
    // Include PENDING_FILL positions
    this.pendingFillExposure.forEach((pending) => {
      total += pending.expectedUsd;
    });
    return total;
  }
  
  // Track pending exposure when order is sent
  private addPendingExposure(lotId: string, pair: string, expectedUsd: number): void {
    this.pendingFillExposure.set(lotId, { pair, expectedUsd });
    log(`[PENDING_EXPOSURE] Added: ${pair} $${expectedUsd.toFixed(2)} (lotId=${lotId}, total pending=${this.pendingFillExposure.size})`, "trading");
  }
  
  // Remove pending exposure when position becomes OPEN or is cancelled
  private removePendingExposure(lotId: string): void {
    const removed = this.pendingFillExposure.delete(lotId);
    if (removed) {
      log(`[PENDING_EXPOSURE] Removed: lotId=${lotId} (remaining=${this.pendingFillExposure.size})`, "trading");
    }
  }
  
  // Clear stale pending exposure (e.g., on startup or after timeout)
  private clearAllPendingExposure(): void {
    const count = this.pendingFillExposure.size;
    this.pendingFillExposure.clear();
    if (count > 0) {
      log(`[PENDING_EXPOSURE] Cleared ${count} stale entries`, "trading");
    }
  }
  
  // Helper: Build Time-Stop alert message
  private buildTimeStopAlertMessage(
    pair: string,
    ageHours: number,
    timeStopHours: number,
    timeStopMode: "soft" | "hard",
    priceChange: number,
    minCloseNetPct: number
  ): string {
    if (timeStopMode === "hard") {
      return `ðŸ¤– <b>KRAKEN BOT</b> ðŸ‡ªðŸ‡¸
â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
â° <b>Time-Stop HARD - Cierre Inmediato</b>

ðŸ“¦ <b>Detalles:</b>
   â€¢ Par: <code>${pair}</code>
   â€¢ Tiempo abierta: <code>${ageHours.toFixed(0)} horas</code>
   â€¢ LÃ­mite configurado: <code>${timeStopHours} horas</code>

ðŸ“Š <b>Estado:</b>
   â€¢ Ganancia actual: <code>${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(2)}%</code>

âš¡ <b>ACCIÃ“N:</b> La posiciÃ³n se cerrarÃ¡ INMEDIATAMENTE [modo HARD]
â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”`;
    } else {
      return `ðŸ¤– <b>KRAKEN BOT</b> ðŸ‡ªðŸ‡¸
â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
â° <b>Time-Stop Alcanzado</b>

ðŸ“¦ <b>Detalles:</b>
   â€¢ Par: <code>${pair}</code>
   â€¢ Tiempo abierta: <code>${ageHours.toFixed(0)} horas</code>
   â€¢ LÃ­mite configurado: <code>${timeStopHours} horas</code>

ðŸ“Š <b>Estado:</b>
   â€¢ Ganancia actual: <code>${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(2)}%</code>
   â€¢ MÃ­nimo para cierre auto: <code>+${minCloseNetPct.toFixed(2)}%</code>

ðŸ’¡ Se cerrarÃ¡ automÃ¡ticamente cuando supere +${minCloseNetPct.toFixed(2)}%
âš ï¸ <b>Puedes cerrarla manualmente si lo prefieres</b>
â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”`;
    }
  }

  // Helper: Send Time-Stop alert with error handling
  private async sendTimeStopAlert(
    position: OpenPosition,
    exitConfig: { takerFeePct: number; profitBufferPct: number; timeStopHours: number; timeStopMode: "soft" | "hard" }
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.telegramService.isInitialized()) {
        return { success: false, error: "Telegram not initialized" };
      }

      const now = Date.now();
      const ageMs = now - position.openedAt;
      const ageHours = ageMs / (1000 * 60 * 60);

      // Get current price with error handling
      const krakenPair = this.formatKrakenPair(position.pair);
      let currentPrice: number;
      try {
        const ticker = await this.getDataExchange().getTicker(krakenPair);
        currentPrice = Number((ticker as any)?.last ?? 0);
      } catch (tickerError: any) {
        log(`[TIME_STOP_ALERT] ${position.pair}: Error getting ticker - ${tickerError.message}`, "trading");
        return { success: false, error: `Ticker error: ${tickerError.message}` };
      }

      if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
        return { success: false, error: `Invalid price: ${currentPrice}` };
      }

      const priceChange = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
      const minCloseNetPct = this.calculateMinCloseNetPct(exitConfig.takerFeePct, exitConfig.takerFeePct, exitConfig.profitBufferPct);

      const message = this.buildTimeStopAlertMessage(
        position.pair,
        ageHours,
        exitConfig.timeStopHours,
        exitConfig.timeStopMode,
        priceChange,
        minCloseNetPct
      );

      try {
        await this.telegramService.sendAlertWithSubtype(message, "trades", "trade_timestop");
        return { success: true };
      } catch (telegramError: any) {
        log(`[TIME_STOP_ALERT] ${position.pair}: Error sending Telegram - ${telegramError.message}`, "trading");
        return { success: false, error: `Telegram error: ${telegramError.message}` };
      }
    } catch (error: any) {
      log(`[TIME_STOP_ALERT] ${position.pair}: Unexpected error - ${error.message}`, "trading");
      return { success: false, error: error.message };
    }
  }

  // Check for Time-Stop expired positions that weren't notified (startup check)
  private async checkExpiredTimeStopPositions(): Promise<{ checked: number; alerted: number; errors: number }> {
    const result = { checked: 0, alerted: 0, errors: 0 };
    
    if (!this.telegramService.isInitialized()) {
      log("[TIME_STOP_CHECK] Telegram not initialized, skipping alerts", "trading");
      return result;
    }
    
    // Use dynamic config from DB instead of hardcoded values
    const exitConfig = await this.getAdaptiveExitConfig();
    const now = Date.now();
    
    for (const [lotId, position] of this.openPositions) {
      result.checked++;
      
      // Skip if already notified
      if (position.timeStopExpiredAt) continue;
      
      // Skip if Time-Stop is manually disabled
      if (position.timeStopDisabled) continue;
      
      const ageMs = now - position.openedAt;
      const ageHours = ageMs / (1000 * 60 * 60);
      
      // Check if Time-Stop is expired
      if (ageHours >= exitConfig.timeStopHours) {
        const alertResult = await this.sendTimeStopAlert(position, exitConfig);
        
        if (alertResult.success) {
          result.alerted++;
          
          // Mark as notified
          position.timeStopExpiredAt = now;
          this.openPositions.set(lotId, position);
          
          try {
            await this.savePositionToDB(position.pair, position);
          } catch (saveError: any) {
            log(`[TIME_STOP_CHECK] ${position.pair}: Error saving position - ${saveError.message}`, "trading");
          }
          
          log(`[TIME_STOP_EXPIRED_STARTUP] ${position.pair} (${lotId}): age=${ageHours.toFixed(1)}h mode=${exitConfig.timeStopMode} - Alert sent`, "trading");
        } else {
          result.errors++;
          log(`[TIME_STOP_CHECK] ${position.pair}: Alert failed - ${alertResult.error}`, "trading");
        }
      }
    }
    
    log(`[TIME_STOP_CHECK] Completed: checked=${result.checked} alerted=${result.alerted} errors=${result.errors}`, "trading");
    return result;
  }
  
  // Force Time-Stop alerts (ignoring previous notifications) - returns stats
  public async forceTimeStopAlerts(): Promise<{ checked: number; alerted: number; errors: number; skipped: number }> {
    const result = { checked: 0, alerted: 0, errors: 0, skipped: 0 };
    
    if (!this.telegramService.isInitialized()) {
      log("[TIME_STOP_FORCE] Telegram not initialized, skipping alerts", "trading");
      return result;
    }
    
    // Use dynamic config from DB instead of hardcoded values
    const exitConfig = await this.getAdaptiveExitConfig();
    const now = Date.now();
    
    log(`[TIME_STOP_FORCE] Starting force alerts check with config: timeStopHours=${exitConfig.timeStopHours} mode=${exitConfig.timeStopMode}`, "trading");
    
    for (const [lotId, position] of this.openPositions) {
      result.checked++;
      
      // Skip if Time-Stop is manually disabled
      if (position.timeStopDisabled) {
        result.skipped++;
        log(`[TIME_STOP_FORCE] ${position.pair}: Skipped (timeStopDisabled=true)`, "trading");
        continue;
      }
      
      const ageMs = now - position.openedAt;
      const ageHours = ageMs / (1000 * 60 * 60);
      
      // Check if Time-Stop is expired
      if (ageHours >= exitConfig.timeStopHours) {
        const alertResult = await this.sendTimeStopAlert(position, exitConfig);
        
        if (alertResult.success) {
          result.alerted++;
          log(`[TIME_STOP_EXPIRED_FORCED] ${position.pair} (${lotId}): age=${ageHours.toFixed(1)}h mode=${exitConfig.timeStopMode} - Alert sent (forced)`, "trading");
        } else {
          result.errors++;
          log(`[TIME_STOP_FORCE] ${position.pair}: Alert failed - ${alertResult.error}`, "trading");
        }
      } else {
        result.skipped++;
        log(`[TIME_STOP_FORCE] ${position.pair}: Skipped (age=${ageHours.toFixed(1)}h < ${exitConfig.timeStopHours}h)`, "trading");
      }
    }
    
    log(`[TIME_STOP_FORCE] Completed: checked=${result.checked} alerted=${result.alerted} errors=${result.errors} skipped=${result.skipped}`, "trading");
    return result;
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
    
    // InstrumentaciÃ³n: log detallado cuando maxAllowed = 0
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

  // === SMART_GUARD: Obtener parÃ¡metros con overrides por par ===
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

  // === SPREAD FILTER (delegated to SpreadFilter) ===
  private async checkSpreadForBuy(pair: string, ticker: { bid: number; ask: number; last: number }, regime: string | null, config: any) {
    return this.spreadFilter.checkSpreadForBuy(pair, ticker, regime, config);
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

  // === MEJORA 3: Position Sizing DinÃ¡mico ===
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
      const lastCompletedScanTime = this.lastEmittedScanTime;
      const timeSinceLastScanMs = lastCompletedScanTime > 0 ? now - lastCompletedScanTime : 0;
      
      const openPositionsPairs = Array.from(this.openPositions.keys());
      
      await botLogger.info("ENGINE_TICK", "Motor activo - escaneo en curso", {
        activePairs: config?.activePairs || [],
        openPositionsCount: this.openPositions.size,
        openPositionsPairs,
        lastScanAt: lastCompletedScanTime > 0 ? new Date(lastCompletedScanTime).toISOString() : null,
        lastScanId: this.lastEmittedScanId || null,
        timeSinceLastScanMs,
        balanceUsd: this.currentUsdBalance,
        isDailyLimitReached: this.isDailyLimitReached,
        dailyPnL: this.dailyPnL,
      });

      this.lastTickTime = now;

      // Emitir MARKET_SCAN_SUMMARY usando lastEmittedResults (snapshot del Ãºltimo scan completo)
      if (this.lastEmittedResults.size > 0) {
        const regimeDetectionEnabled = config?.regimeDetectionEnabled ?? false;
        
        // Usar el snapshot de resultados del Ãºltimo scan completado
        const scanResultsSnapshot = new Map(this.lastEmittedResults);
        const sourcePairs = Array.from(scanResultsSnapshot.keys());
        const scanId = this.lastEmittedScanId;
        const scanTime = this.lastEmittedScanTime;
        
        log(`[SCAN_SUMMARY_COUNT] scanId=${scanId} expected=${sourcePairs.length} got=${sourcePairs.length} missing=[]`, "trading");
        
        const scanSummary: Record<string, any> = {};
        
        for (const [pair, result] of scanResultsSnapshot) {
          try {
            const pairData: Record<string, any> = { ...result };
            
            if (regimeDetectionEnabled) {
              try {
                const regimeAnalysis = await this.getMarketRegimeWithCache(pair);
                pairData.regime = regimeAnalysis.regime;
                pairData.regimeReason = regimeAnalysis.reason;
              } catch (regimeErr) {
                pairData.regime = "ERROR";
                pairData.regimeReason = "Error obteniendo rÃ©gimen";
              }
            }
            
            scanSummary[pair] = pairData;
          } catch (loopErr: any) {
            log(`[SCAN_SUMMARY_PAIR_ERR] scanId=${scanId} pair=${pair} error=${loopErr.message}`, "trading");
            scanSummary[pair] = { ...result, regime: "ERROR", regimeReason: "Build error" };
          }
        }

        // Post-build validation
        const builtPairs = Object.keys(scanSummary);
        log(`[SCAN_SUMMARY_BUILD] scanId=${scanId} source=${sourcePairs.length} built=${builtPairs.length}`, "trading");
        if (builtPairs.length !== sourcePairs.length) {
          log(`[SCAN_SUMMARY_MISMATCH] scanId=${scanId} source=[${sourcePairs.join(",")}] built=[${builtPairs.join(",")}]`, "trading");
        }

        await botLogger.info("MARKET_SCAN_SUMMARY", "Resumen de escaneo de mercado", {
          pairs: scanSummary,
          scanTime: scanTime > 0 ? new Date(scanTime).toISOString() : null,
          regimeDetectionEnabled,
          _meta: { sourceCount: sourcePairs.length, builtCount: builtPairs.length, scanId },
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
    const roundTripFees = getRoundTripFeePct();
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
      const candles = await this.getDataExchange().getOHLC(pair, intervalMinutes);
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
    candle: OHLCCandle,
    adjustedMinSignals?: number,
    regime?: MarketRegime | string | null
  ): Promise<TradeSignal> {
    const intervalMinutes = this.getTimeframeIntervalMinutes(timeframe);
    const candles = await this.getDataExchange().getOHLC(pair, intervalMinutes);
    if (!candles || candles.length < 20) {
      return { action: "hold", pair, confidence: 0, reason: "Datos insuficientes para anÃ¡lisis de velas", signalsCount: 0, minSignalsRequired: 4 };
    }
    
    const closedCandles = candles.slice(0, -1);
    
    // B1: Aplicar filtro MTF a Momentum Velas (igual que en ciclos)
    const mtfData = await this.getMultiTimeframeData(pair);
    const mtfAnalysis = mtfData ? this.analyzeMultiTimeframe(mtfData) : null;
    
    let signal = this.momentumCandlesStrategy(pair, closedCandles, candle.close, adjustedMinSignals);

    const hybridCfg = this.getHybridGuardConfig();
    let activeHybridWatch: any | null = null;
    if (hybridCfg?.enabled) {
      try {
        await this.expireHybridWatchesIfNeeded();
        activeHybridWatch = await storage.getActiveHybridReentryWatch({
          exchange: this.getTradingExchangeType(),
          pair,
          strategy: `momentum_candles_${timeframe}`,
        });
      } catch (e: any) {
        activeHybridWatch = null;
      }
    }
    
    // === FILTRO ANTI-CRESTA (Fase 2.4) ===
    // Bloquea compras cuando: volumen > 1.5x promedio Y precio > 1% sobre EMA20
    // Esto evita compras tardÃ­as en momentum agotado
    if (signal.action === "buy" && closedCandles.length >= 20) {
      const closes = closedCandles.map(c => c.close);
      const ema20 = this.calculateEMA(closes.slice(-20), 20);
      const currentPrice = candle.close;
      const priceVsEma20Pct = ema20 > 0 ? ((currentPrice - ema20) / ema20) : 0;
      
      // Calcular ratio de volumen
      const volumes = closedCandles.slice(-20).map(c => c.volume);
      const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
      const currentVolume = closedCandles[closedCandles.length - 1]?.volume || 0;
      const volumeRatio = avgVolume > 0 ? currentVolume / avgVolume : 1;

      const watchReason = activeHybridWatch ? this.normalizeHybridReason(activeHybridWatch.reason) : null;
      if (
        activeHybridWatch &&
        signal.action === 'buy' &&
        watchReason === 'ANTI_CRESTA' &&
        hybridCfg?.antiCresta?.enabled !== false
      ) {
        const maxAbs = Number(hybridCfg?.antiCresta?.reentryMaxAbsPriceVsEma20Pct ?? 0.003);
        const absPct = Math.abs(priceVsEma20Pct);
        if (Number.isFinite(absPct) && absPct <= maxAbs) {
          signal.hybridGuard = { watchId: activeHybridWatch.id, reason: 'ANTI_CRESTA' };
          signal.reason = `${signal.reason} | HYBRID_REENTRY(ANTI_CRESTA)`;
        }
      }
      
      // Anti-cresta: volumen alto + sobrecompra respecto a EMA20
      if (volumeRatio > 1.5 && priceVsEma20Pct > 0.01) {
        const rejectionReason = `Anti-Cresta: Volumen ${volumeRatio.toFixed(1)}x + Precio ${(priceVsEma20Pct * 100).toFixed(2)}% sobre EMA20`;

        await this.maybeCreateHybridReentryWatch({
          pair,
          timeframe,
          strategyId: `momentum_candles_${timeframe}`,
          reason: 'ANTI_CRESTA',
          regime: regime?.toString(),
          rawSignal: signal.action.toUpperCase(),
          rejectPrice: currentPrice,
          ema20,
          priceVsEma20Pct,
          volumeRatio,
          mtfAlignment: mtfAnalysis?.alignment,
          signalsCount: signal.signalsCount,
          minSignalsRequired: adjustedMinSignals ?? signal.minSignalsRequired,
          rejectionReasonText: rejectionReason,
        });
        
        // Enviar alerta de rechazo
        this.telegramService.sendSignalRejectionAlert(
          pair,
          rejectionReason,
          "ANTI_CRESTA",
          {
            regime: regime?.toString(),
            mtfAlignment: mtfAnalysis?.alignment,
            signalsCount: signal.signalsCount,
            minSignalsRequired: adjustedMinSignals ?? signal.minSignalsRequired,
            volumeRatio,
            priceVsEma20Pct,
            selectedStrategy: `momentum_candles_${timeframe}`,
            rawSignal: signal.action.toUpperCase(),
            currentPrice,
            ema20,
          }
        ).catch(err => log(`[ALERT_ERR] sendSignalRejectionAlert ANTI_CRESTA: ${err.message}`, "trading"));
        
        log(`[ANTI_CRESTA] ${pair}: SeÃ±al BUY bloqueada - ${rejectionReason}`, "trading");
        
        return { 
          action: "hold", 
          pair, 
          confidence: 0.3, 
          reason: `SeÃ±al filtrada: ${rejectionReason}`,
          signalsCount: signal.signalsCount,
          minSignalsRequired: adjustedMinSignals ?? signal.minSignalsRequired,
        };
      }
    }
    
    // Aplicar filtro MTF si hay seÃ±al activa (ahora con rÃ©gimen para umbrales estrictos)
    if (mtfAnalysis && signal.action !== "hold") {
      const mtfBoost = this.applyMTFFilter(signal, mtfAnalysis, regime);
      if (mtfBoost.filtered) {
        // Preserve signalsCount from original signal for diagnostic trace
        // Si es filtro MTF_STRICT, enviar alerta de rechazo
        if (mtfBoost.filterType === "MTF_STRICT" && signal.action === "buy") {
          await this.maybeCreateHybridReentryWatch({
            pair,
            timeframe,
            strategyId: `momentum_candles_${timeframe}`,
            reason: 'MTF_STRICT',
            regime: regime?.toString(),
            rawSignal: signal.action.toUpperCase(),
            mtfAlignment: mtfAnalysis.alignment,
            signalsCount: signal.signalsCount,
            minSignalsRequired: adjustedMinSignals ?? signal.minSignalsRequired,
            rejectionReasonText: mtfBoost.reason,
          });

          this.telegramService.sendSignalRejectionAlert(
            pair,
            mtfBoost.reason,
            "MTF_STRICT",
            {
              regime: regime?.toString(),
              mtfAlignment: mtfAnalysis.alignment,
              signalsCount: signal.signalsCount,
              minSignalsRequired: adjustedMinSignals ?? signal.minSignalsRequired,
              selectedStrategy: `momentum_candles_${timeframe}`,
              rawSignal: signal.action.toUpperCase(),
            }
          ).catch(err => log(`[ALERT_ERR] sendSignalRejectionAlert: ${err.message}`, "trading"));
        }
        
        return { 
          action: "hold", 
          pair, 
          confidence: 0.3, 
          reason: `SeÃ±al filtrada por MTF: ${mtfBoost.reason}`,
          signalsCount: signal.signalsCount,
          minSignalsRequired: adjustedMinSignals ?? signal.minSignalsRequired,
        };
      }
      signal.confidence = Math.min(0.95, signal.confidence + mtfBoost.confidenceBoost);
      if (mtfBoost.confidenceBoost > 0) {
        signal.reason += ` | ${mtfBoost.reason}`;
      }

      const watchReason = activeHybridWatch ? this.normalizeHybridReason(activeHybridWatch.reason) : null;
      if (
        activeHybridWatch &&
        signal.action === 'buy' &&
        watchReason === 'MTF_STRICT' &&
        hybridCfg?.mtfStrict?.enabled !== false
      ) {
        const minAlign = Number(hybridCfg?.mtfStrict?.reentryMinAlignment ?? 0.2);
        const currentAlign = Number(mtfAnalysis?.alignment);
        if (Number.isFinite(currentAlign) && currentAlign >= minAlign) {
          signal.hybridGuard = { watchId: activeHybridWatch.id, reason: 'MTF_STRICT' };
          signal.reason = `${signal.reason} | HYBRID_REENTRY(MTF_STRICT)`;
        }
      }
    }
    
    return signal;
  }

  private momentumCandlesStrategy(pair: string, candles: OHLCCandle[], currentPrice: number, adjustedMinSignals?: number): TradeSignal {
    const minSignalsRequired = adjustedMinSignals ?? 5; // Default 5, but can be overridden (e.g., 4 for TRANSITION)
    
    if (candles.length < 20) {
      return { action: "hold", pair, confidence: 0, reason: "Historial de velas insuficiente", signalsCount: 0, minSignalsRequired };
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
    const buyReasons: string[] = [];
    const sellReasons: string[] = [];

    if (shortEMA > longEMA) { buySignals++; buyReasons.push("EMA10>EMA20"); }
    else if (shortEMA < longEMA) { sellSignals++; sellReasons.push("EMA10<EMA20"); }

    if (rsi < 30) { buySignals += 2; buyReasons.push(`RSI sobrevendido (${rsi.toFixed(0)})`); }
    else if (rsi < 45) { buySignals++; }
    else if (rsi > 70) { sellSignals += 2; sellReasons.push(`RSI sobrecomprado (${rsi.toFixed(0)})`); }
    else if (rsi > 55) { sellSignals++; }

    if (macd.histogram > 0 && macd.macd > macd.signal) { buySignals++; buyReasons.push("MACD alcista"); }
    else if (macd.histogram < 0 && macd.macd < macd.signal) { sellSignals++; sellReasons.push("MACD bajista"); }

    if (bollinger.percentB < 20) { buySignals++; buyReasons.push("Precio en Bollinger inferior"); }
    else if (bollinger.percentB > 80) { sellSignals++; sellReasons.push("Precio en Bollinger superior"); }

    if (isBullishCandle && bodyRatio > 0.6) {
      buySignals++;
      buyReasons.push("Vela alcista fuerte");
    } else if (isBearishCandle && bodyRatio > 0.6) {
      sellSignals++;
      sellReasons.push("Vela bajista fuerte");
    }

    if (isHighVolume) {
      if (isBullishCandle) { buySignals++; buyReasons.push(`Volumen alto alcista (${volumeRatio.toFixed(1)}x)`); }
      else if (isBearishCandle) { sellSignals++; sellReasons.push(`Volumen alto bajista (${volumeRatio.toFixed(1)}x)`); }
    }

    if (isBullishCandle && prevCandle && prevCandle.close < prevCandle.open) {
      if (lastCandle.close > prevCandle.open) {
        buySignals++;
        buyReasons.push("Engulfing alcista");
      }
    }
    if (isBearishCandle && prevCandle && prevCandle.close > prevCandle.open) {
      if (lastCandle.close < prevCandle.open) {
        sellSignals++;
        sellReasons.push("Engulfing bajista");
      }
    }

    const confidence = Math.min(0.95, 0.5 + (Math.max(buySignals, sellSignals) * 0.07));
    
    // B2: Filtro anti-FOMO - bloquear BUY en condiciones de entrada tardÃ­a
    const isAntifomoTriggered = rsi > 65 && bollinger.percentB > 85 && bodyRatio > 0.7;
    
    if (buySignals >= minSignalsRequired && buySignals > sellSignals && rsi < 70) {
      // B2: Verificar anti-FOMO antes de emitir seÃ±al BUY
      if (isAntifomoTriggered) {
        return {
          action: "hold",
          pair,
          confidence: 0.4,
          reason: `Anti-FOMO: RSI=${rsi.toFixed(0)} BB%=${bollinger.percentB.toFixed(0)} bodyRatio=${bodyRatio.toFixed(2)} | SeÃ±ales: ${buySignals}/${sellSignals}`,
          signalsCount: buySignals,
          minSignalsRequired,
        };
      }
      return {
        action: "buy",
        pair,
        confidence,
        reason: `Momentum Velas COMPRA: ${buyReasons.join(", ")} | SeÃ±ales: ${buySignals}/${sellSignals}`,
        signalsCount: buySignals,
        minSignalsRequired,
      };
    }
    
    if (sellSignals >= minSignalsRequired && sellSignals > buySignals && rsi > 30) {
      return {
        action: "sell",
        pair,
        confidence,
        reason: `Momentum Velas VENTA: ${sellReasons.join(", ")} | SeÃ±ales: ${sellSignals}/${buySignals}`,
        signalsCount: sellSignals,
        minSignalsRequired,
      };
    }

    // No signal: provide detailed diagnostic reason
    const dominantCount = Math.max(buySignals, sellSignals);
    const dominantSide = buySignals >= sellSignals ? "buy" : "sell";
    
    // Determine the actual blocking reason
    let blockReason = "";
    if (dominantCount < minSignalsRequired) {
      blockReason = `seÃ±ales insuficientes (${dominantCount}/${minSignalsRequired})`;
    } else if (dominantSide === "buy" && rsi >= 70) {
      blockReason = `RSI muy alto (${rsi.toFixed(0)}>=70) bloquea compra`;
    } else if (dominantSide === "sell" && rsi <= 30) {
      blockReason = `RSI muy bajo (${rsi.toFixed(0)}<=30) bloquea venta`;
    } else if (buySignals === sellSignals) {
      blockReason = `conflicto buy/sell (${buySignals}=${sellSignals})`;
    } else {
      blockReason = `sin dominancia clara`;
    }
    
    return { 
      action: "hold", 
      pair, 
      confidence: 0.3, 
      reason: `Sin seÃ±al clara velas: ${blockReason} | buy=${buySignals}/sell=${sellSignals}`,
      signalsCount: dominantCount,
      minSignalsRequired,
    };
  }

  // === MEAN REVERSION SIMPLE (RANGE regime) ===
  // Strategy for sideways/range markets using Bollinger Bands + RSI
  private meanReversionSimpleStrategy(pair: string, candles: OHLCCandle[], currentPrice: number): TradeSignal {
    const minSignalsRequired = 2; // Simpler strategy: BB touch + RSI confirmation
    
    if (candles.length < 20) {
      return { action: "hold", pair, confidence: 0, reason: "Historial insuficiente para Mean Reversion", signalsCount: 0, minSignalsRequired };
    }
    
    const closes = candles.map(c => c.close);
    const rsi = this.calculateRSI(closes.slice(-14));
    const bollinger = this.calculateBollingerBands(closes);
    
    const lastCandle = candles[candles.length - 1];
    const isBullishCandle = lastCandle.close > lastCandle.open;
    const isBearishCandle = lastCandle.close < lastCandle.open;
    const candleBody = Math.abs(lastCandle.close - lastCandle.open);
    const candleRange = lastCandle.high - lastCandle.low;
    const bodyRatio = candleRange > 0 ? candleBody / candleRange : 0;
    
    let buySignals = 0;
    let sellSignals = 0;
    const reasons: string[] = [];
    
    // BUY: price at/below lower BB + RSI oversold
    if (currentPrice <= bollinger.lower) {
      buySignals++;
      reasons.push(`Precio en BB inferior (${bollinger.lower.toFixed(2)})`);
    }
    if (rsi <= 35) {
      buySignals++;
      reasons.push(`RSI sobrevendido (${rsi.toFixed(0)})`);
    }
    // Extra confirmation: bullish candle (not required but helps)
    if (isBullishCandle && bodyRatio < 0.8) {
      // Avoid extreme bearish candles
      reasons.push("Vela no bajista extrema");
    } else if (isBearishCandle && bodyRatio > 0.7) {
      // Strong bearish candle = reduce buy confidence
      buySignals = Math.max(0, buySignals - 1);
      reasons.push("Vela bajista fuerte (penalizaciÃ³n)");
    }
    
    // SELL: price at/above upper BB + RSI overbought
    if (currentPrice >= bollinger.upper) {
      sellSignals++;
      reasons.push(`Precio en BB superior (${bollinger.upper.toFixed(2)})`);
    }
    if (rsi >= 65) {
      sellSignals++;
      reasons.push(`RSI sobrecomprado (${rsi.toFixed(0)})`);
    }
    
    const confidence = Math.min(0.85, 0.5 + (Math.max(buySignals, sellSignals) * 0.15));
    
    if (buySignals >= minSignalsRequired && buySignals > sellSignals) {
      return {
        action: "buy",
        pair,
        confidence,
        reason: `Mean Reversion COMPRA: ${reasons.join(", ")} | SeÃ±ales: ${buySignals}`,
        signalsCount: buySignals,
        minSignalsRequired,
      };
    }
    
    // NOTE: SELL signals are NOT emitted by mean_reversion_simple because
    // SMART_GUARD only allows risk exits (SL/TP/Trailing) to sell, not strategy signals.
    // The SELL logic is preserved for future use when router allows strategy-based exits.
    // if (sellSignals >= minSignalsRequired && sellSignals > buySignals) {
    //   return {
    //     action: "sell",
    //     pair,
    //     confidence,
    //     reason: `Mean Reversion VENTA: ${reasons.join(", ")} | SeÃ±ales: ${sellSignals}`,
    //     signalsCount: sellSignals,
    //     minSignalsRequired,
    //   };
    // }
    
    const dominantCount = Math.max(buySignals, sellSignals);
    const dominantSide = buySignals >= sellSignals ? "buy" : "sell";
    return {
      action: "hold",
      pair,
      confidence: 0.3,
      reason: `Mean Reversion sin seÃ±al: ${dominantSide}=${dominantCount} < min=${minSignalsRequired} | RSI=${rsi.toFixed(0)} BB%=${bollinger.percentB.toFixed(0)}`,
      signalsCount: dominantCount,
      minSignalsRequired,
    };
  }

  async start() {
    if (this.isRunning) return;
    
    const config = await storage.getBotConfig();
    if (!config?.isActive) {
      log("Bot no estÃ¡ activo, no se inicia el motor de trading", "trading");
      return;
    }

    const tradingExchange = this.getTradingExchange();
    if (!tradingExchange.isInitialized()) {
      log(`${ExchangeFactory.getTradingExchangeType()} no estÃ¡ configurado, no se puede iniciar el trading`, "trading");
      return;
    }

    // Load dynamic pair metadata from exchange API (step sizes, order minimums)
    const activePairs = config.activePairs || ["BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD"];
    try {
      await tradingExchange.loadPairMetadata(activePairs);
      // Verify all active pairs have metadata
      const missingPairs = activePairs.filter(p => !tradingExchange.hasMetadata(p));
      if (missingPairs.length > 0) {
        log(`[CRITICAL] Missing metadata for pairs: ${missingPairs.join(", ")}. Using fallback values.`, "trading");
      }
      // Start metadata refresh timer (Kraken-specific, falls back gracefully if not available)
      if (this.krakenService.startMetadataRefresh) {
        this.krakenService.startMetadataRefresh(activePairs);
      }
    } catch (error: any) {
      log(`[CRITICAL] Failed to load pair metadata: ${error.message}. Trading will use fallback values.`, "trading");
      // Continue with fallbacks - don't block trading entirely for API failures
    }

    if (!this.telegramService.isInitialized()) {
      log("Telegram no estÃ¡ configurado, continuando sin notificaciones", "trading");
    }
    
    // Load dynamic configuration from ConfigService
    await this.loadDynamicConfig();
    
    // Load dryRunMode from config (Replit always forces dry run regardless of DB setting)
    const dbDryRun = (config as any).dryRunMode ?? false;
    if (this.isReplitEnvironment) {
      this.dryRunMode = true;
      log("[SAFETY] Modo DRY_RUN forzado en Replit - no se enviarÃ¡n Ã³rdenes reales", "trading");
    } else {
      this.dryRunMode = dbDryRun;
      if (this.dryRunMode) {
        log("[INFO] Modo DRY_RUN activado desde configuraciÃ³n", "trading");
      }
    }

    try {
      const balances = await this.getTradingExchange().getBalance();
      this.currentUsdBalance = parseFloat(String(balances?.ZUSD || balances?.USD || "0"));
      log(`Balance inicial USD: $${this.currentUsdBalance.toFixed(2)}`, "trading");
    } catch (error: any) {
      log(`Error obteniendo balance inicial: ${error.message}`, "trading");
      return;
    }

    this.isRunning = true;
    log("Motor de trading iniciado", "trading");
    
    // Clear any stale pending exposure from previous runs
    this.clearAllPendingExposure();
    
    await this.loadOpenPositionsFromDB();

    // Recovery: restart FillWatcher for any PENDING_FILL positions so they don't get stuck after a restart
    await this.recoverPendingFillPositionsFromDB();
    
    // Check for expired Time-Stop positions that weren't notified
    await this.checkExpiredTimeStopPositions();
    
    const modeLabel = this.dryRunMode ? "DRY_RUN (simulaciÃ³n)" : "LIVE (Ã³rdenes reales)";
    
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
      const modeText = this.dryRunMode ? "DRY_RUN (simulaciÃ³n)" : "LIVE";
      const routerStatus = config.regimeRouterEnabled ? "ACTIVO" : "INACTIVO";
      await this.telegramService.sendAlertWithSubtype(`ðŸ¤– <b>KRAKEN BOT</b> ðŸ‡ªðŸ‡¸
â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
âœ… <b>Bot Iniciado</b>

ðŸ“Š <b>ConfiguraciÃ³n:</b>
   â€¢ Estrategia: <code>${config.strategy}</code>
   â€¢ Riesgo: <code>${config.riskLevel}</code>
   â€¢ Pares: <code>${config.activePairs.join(", ")}</code>
   â€¢ Router: <code>${routerStatus}</code>

ðŸ’° <b>Estado:</b>
   â€¢ Balance: <code>$${this.currentUsdBalance.toFixed(2)}</code>
   â€¢ Posiciones: <code>${this.openPositions.size}</code>

âš™ï¸ <b>Modo:</b> <code>${modeText}</code>
â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”`, "system", "system_bot_started");
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
      await this.telegramService.sendAlertWithSubtype(`ðŸ¤– <b>KRAKEN BOT</b> ðŸ‡ªðŸ‡¸
â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
ðŸ›‘ <b>Bot Detenido</b>

El motor de trading ha sido desactivado.
â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”`, "system", "system_bot_paused");
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
      const currentConfig = await storage.getBotConfig();
      this.openPositions.clear();
      
      for (const pos of positions) {
        const hasSnapshot = pos.configSnapshotJson && pos.entryMode;
        let configSnapshot = hasSnapshot ? (pos.configSnapshotJson as ConfigSnapshot) : undefined;
        let entryMode = pos.entryMode || undefined;
        let needsBackfill = false;
        
        // BACKFILL: If position lacks snapshot, create one from current config (SMART_GUARD by default)
        if (!configSnapshot && currentConfig) {
          needsBackfill = true;
          entryMode = currentConfig.positionMode || "SMART_GUARD";
          
          configSnapshot = {
            stopLossPercent: parseFloat(currentConfig?.stopLossPercent?.toString() || "5"),
            takeProfitPercent: parseFloat(currentConfig?.takeProfitPercent?.toString() || "7"),
            trailingStopEnabled: currentConfig?.trailingStopEnabled ?? false,
            trailingStopPercent: parseFloat(currentConfig?.trailingStopPercent?.toString() || "2"),
            positionMode: entryMode,
          };
          
          if (entryMode === "SMART_GUARD") {
            const sgParams = this.getSmartGuardParams(pos.pair, currentConfig);
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
          }
        }
        
        // Use existing lotId or generate one for legacy positions
        const lotId = pos.lotId || generateLotId(pos.pair);
        
        // Calculate entryFee for legacy positions that don't have it stored
        const storedEntryFee = (pos as any).entryFee ? parseFloat((pos as any).entryFee) : 0;
        const calculatedEntryFee = storedEntryFee > 0 
          ? storedEntryFee 
          : parseFloat(pos.amount) * parseFloat(pos.entryPrice) * (getTakerFeePct() / 100);
        
        const openPosition: OpenPosition = {
          lotId,
          pair: pos.pair,
          amount: parseFloat(pos.amount),
          entryPrice: parseFloat(pos.entryPrice),
          entryFee: calculatedEntryFee,
          highestPrice: parseFloat(pos.highestPrice),
          openedAt: new Date(pos.openedAt).getTime(),
          entryStrategyId: pos.entryStrategyId || "momentum_cycle",
          entrySignalTf: pos.entrySignalTf || "cycle",
          signalConfidence: pos.signalConfidence ? toConfidenceUnit(pos.signalConfidence) : undefined,
          signalReason: pos.signalReason || undefined,
          entryMode,
          configSnapshot,
          // SMART_GUARD state
          sgBreakEvenActivated: pos.sgBreakEvenActivated ?? false,
          sgCurrentStopPrice: pos.sgCurrentStopPrice ? parseFloat(pos.sgCurrentStopPrice) : undefined,
          sgTrailingActivated: pos.sgTrailingActivated ?? false,
          sgScaleOutDone: pos.sgScaleOutDone ?? false,
        };
        
        this.openPositions.set(lotId, openPosition);
        
        // Clean up any pending exposure for this position (now it's OPEN)
        this.removePendingExposure(lotId);
        
        // If position lacked lotId or snapshot, update DB
        if (!pos.lotId || needsBackfill) {
          if (!pos.lotId) {
            await storage.updateOpenPositionLotId(pos.id, lotId);
          }
          if (needsBackfill) {
            // Persist the backfilled snapshot to DB
            await this.savePositionToDB(pos.pair, openPosition);
            log(`[BACKFILL] ${pos.pair} (${lotId}): snapshot creado desde config actual (mode=${entryMode})`, "trading");
            await botLogger.info("SG_SNAPSHOT_BACKFILLED", `Snapshot backfilled for position ${pos.pair}`, {
              pair: pos.pair,
              lotId,
              entryMode,
              sgBeAtPct: configSnapshot?.sgBeAtPct,
              sgTrailStartPct: configSnapshot?.sgTrailStartPct,
              sgTrailDistancePct: configSnapshot?.sgTrailDistancePct,
              source: "loadOpenPositionsFromDB",
            });
          }
        }
        
        const snapshotInfo = hasSnapshot ? `[snapshot: ${pos.entryMode}]` : needsBackfill ? `[BACKFILLED: ${entryMode}]` : "[legacy: uses current config]";
        log(`PosiciÃ³n recuperada: ${pos.pair} (${lotId}) - ${pos.amount} @ $${pos.entryPrice} (${pos.entryStrategyId}/${pos.entrySignalTf}) ${snapshotInfo}`, "trading");
      }
      
      if (positions.length > 0) {
        log(`${positions.length} posiciones abiertas (${this.openPositions.size} lotes) cargadas desde la base de datos`, "trading");
        if (this.telegramService.isInitialized()) {
          const positionsList = positions.map(p => {
            const hasSnap = p.configSnapshotJson && p.entryMode;
            const snapEmoji = hasSnap ? "ðŸ“¸" : "âš™ï¸";
            return `   ${snapEmoji} ${p.pair}: <code>${p.amount} @ $${parseFloat(p.entryPrice).toFixed(2)}</code>`;
          }).join("\n");
          await this.telegramService.sendAlertWithSubtype(`ðŸ¤– <b>KRAKEN BOT</b> ðŸ‡ªðŸ‡¸
â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
ðŸ“‚ <b>Posiciones Abiertas</b>

${positionsList}
â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”`, "balance", "balance_exposure");
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
        exchange: this.getTradingExchangeType(),
        pair,
        entryPrice: position.entryPrice.toString(),
        amount: position.amount.toString(),
        entryFee: position.entryFee.toString(),
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
      log(`Error guardando posiciÃ³n ${pair} (${position.lotId}): ${error.message}`, "trading");
    }
  }

  private async deletePositionFromDBByLotId(lotId: string) {
    try {
      await storage.deleteOpenPositionByLotId(lotId);
    } catch (error: any) {
      log(`Error eliminando posiciÃ³n ${lotId}: ${error.message}`, "trading");
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

      // Kill-switch: environment can disable all BUY entries (sells/SL/TP still run)
      const tradingEnabled = String(process.env.TRADING_ENABLED ?? 'true').toLowerCase() === 'true';

      // Fail-closed: positions should not be empty if we have bot-origin trades recently.
      // This prevents "compras a ciegas" after a restart/desync.
      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const recentBotTrades = await storage.getRecentBotTradesCount({ since: since24h });
      const positionsInconsistent = this.openPositions.size === 0 && recentBotTrades > 0;

      // Actualizar tiempo de escaneo y limpiar resultados anteriores
      this.lastScanTime = Date.now();
      this.lastScanResults.clear();

      const balances = await this.getTradingExchange().getBalance();
      this.currentUsdBalance = parseFloat(String(balances?.ZUSD || balances?.USD || "0"));
      
      // Reset diario del P&L
      const today = new Date().toISOString().split("T")[0];
      if (this.lastDayReset !== today) {
        const previousDayPnL = this.dailyPnL;
        this.dailyPnL = 0;
        this.dailyStartBalance = this.currentUsdBalance;
        this.lastDayReset = today;
        this.isDailyLimitReached = false;
        log(`Nuevo dÃ­a de trading: ${today}. Balance inicial: $${this.dailyStartBalance.toFixed(2)}`, "trading");
        
        await botLogger.info("DAILY_LIMIT_RESET", `Nuevo dÃ­a de trading: ${today}`, {
          date: today,
          previousDayPnL,
          startBalance: this.dailyStartBalance,
        });
      }

      // Verificar lÃ­mite de pÃ©rdida diaria
      const dailyLossLimitEnabled = config.dailyLossLimitEnabled ?? true;
      const dailyLossLimitPercent = parseFloat(config.dailyLossLimitPercent?.toString() || "10");
      
      if (dailyLossLimitEnabled && this.dailyStartBalance > 0) {
        const currentLossPercent = (this.dailyPnL / this.dailyStartBalance) * 100;
        
        if (currentLossPercent <= -dailyLossLimitPercent && !this.isDailyLimitReached) {
          this.isDailyLimitReached = true;
          log(`ðŸ›‘ LÃMITE DE PÃ‰RDIDA DIARIA ALCANZADO: ${currentLossPercent.toFixed(2)}% (lÃ­mite: -${dailyLossLimitPercent}%)`, "trading");
          
          await botLogger.warn("DAILY_LIMIT_HIT", "LÃ­mite de pÃ©rdida diaria alcanzado. Bot pausado para nuevas compras.", {
            dailyPnL: this.dailyPnL,
            dailyPnLPercent: currentLossPercent,
            limitPercent: dailyLossLimitPercent,
            startBalance: this.dailyStartBalance,
          });
          
          if (this.telegramService.isInitialized()) {
            await this.telegramService.sendAlertWithSubtype(`ðŸ¤– <b>KRAKEN BOT</b> ðŸ‡ªðŸ‡¸
â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
ðŸ›‘ <b>LÃ­mite de PÃ©rdida Diaria Alcanzado</b>

El bot ha pausado las operaciones de COMPRA.

ðŸ“Š <b>Resumen:</b>
   â€¢ P&L del dÃ­a: <code>${currentLossPercent.toFixed(2)}%</code>
   â€¢ PÃ©rdida: <code>$${Math.abs(this.dailyPnL).toFixed(2)}</code>
   â€¢ LÃ­mite configurado: <code>-${dailyLossLimitPercent}%</code>

â„¹ï¸ Las operaciones de cierre (SL/TP) siguen activas.
â° El trading normal se reanudarÃ¡ maÃ±ana.
â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”`, "trades", "trade_daily_pnl");
          }
        }
      }
      
      const riskConfig = RISK_LEVELS[config.riskLevel] || RISK_LEVELS.medium;

      const stopLossPercent = parseFloat(config.stopLossPercent?.toString() || "5");
      const takeProfitPercent = parseFloat(config.takeProfitPercent?.toString() || "7");
      const trailingStopEnabled = config.trailingStopEnabled ?? false;
      const trailingStopPercent = parseFloat(config.trailingStopPercent?.toString() || "2");

      // Stop-Loss y Take-Profit siempre se verifican (incluso con lÃ­mite alcanzado)
      for (const pair of config.activePairs) {
        await this.exitManager.checkStopLossTakeProfit(pair, stopLossPercent, takeProfitPercent, trailingStopEnabled, trailingStopPercent, balances);
      }

      // Safety: if trading disabled, do not open new positions
      if (!tradingEnabled || positionsInconsistent) {
        for (const pair of config.activePairs || []) {
          const expCheck = this.getAvailableExposure(pair, config, this.currentUsdBalance);
          this.initPairTrace(pair, expCheck.maxAllowed, true);
          this.updatePairTrace(pair, {
            smartGuardDecision: "BLOCK",
            blockReasonCode: !tradingEnabled ? "TRADING_DISABLED" : "POSITIONS_INCONSISTENT",
            blockDetails: !tradingEnabled
              ? { env: "TRADING_ENABLED" }
              : { recentBotTrades, openPositionsCount: this.openPositions.size },
            finalSignal: "NONE",
            finalReason: !tradingEnabled ? "TRADING_ENABLED=false" : "Positions inconsistent: openPositions=0 but recent bot trades exist",
          });
        }
        return;
      }

      // No abrir nuevas posiciones si se alcanzÃ³ el lÃ­mite diario
      if (this.isDailyLimitReached) {
        // Emitir trace para todos los pares activos indicando DAILY_LIMIT
        const activePairsForTrace = config.activePairs || [];
        for (const pair of activePairsForTrace) {
          const expCheck = this.getAvailableExposure(pair, config, this.currentUsdBalance);
          this.initPairTrace(pair, expCheck.maxAllowed, true); // Usar cache
          this.updatePairTrace(pair, {
            smartGuardDecision: "BLOCK",
            blockReasonCode: "DAILY_LIMIT",
            blockDetails: { dailyPnL: this.dailyPnL, dailyStartBalance: this.dailyStartBalance },
            finalSignal: "NONE",
            finalReason: `LÃ­mite diario alcanzado: P&L $${this.dailyPnL.toFixed(2)}`,
          });
          this.emitPairDecisionTrace(pair);
        }
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
        // Emitir trace para todos los pares activos indicando TRADING_HOURS
        const activePairsForTrace = config.activePairs || [];
        for (const pair of activePairsForTrace) {
          const expCheck = this.getAvailableExposure(pair, config, this.currentUsdBalance);
          this.initPairTrace(pair, expCheck.maxAllowed, true); // Usar cache
          this.updatePairTrace(pair, {
            smartGuardDecision: "BLOCK",
            blockReasonCode: "TRADING_HOURS",
            blockDetails: { hourUTC: tradingHoursCheck.hourUTC, start: tradingHoursCheck.start, end: tradingHoursCheck.end },
            finalSignal: "NONE",
            finalReason: `Fuera de horario: ${tradingHoursCheck.hourUTC}h (${tradingHoursCheck.start}-${tradingHoursCheck.end}h)`,
          });
          this.emitPairDecisionTrace(pair);
        }
        return;
      }

      const signalTimeframe = config.signalTimeframe || "cycle";
      const isCandleMode = signalTimeframe !== "cycle" && config.strategy === "momentum";

      const activePairs = config.activePairs || [];
      const scannedPairs: string[] = [];
      const failedPairs: string[] = [];

      // Mark scan as in progress and clear previous results
      this.scanInProgress = true;
      this.currentScanId = `scan-${Date.now()}`;
      this.lastScanStartTime = Date.now();
      this.lastExpectedPairs = [...activePairs]; // Snapshot for guard validation
      this.lastScanResults.clear(); // Clear stale results from previous scan
      this.pairDecisionTrace.clear(); // Clear decision traces for new scan
      log(`[SCAN_START] scanId=${this.currentScanId} expectedPairs=[${activePairs.join(",")}]`, "trading");

      try {
        for (const pair of activePairs) {
          try {
            log(`[SCAN_PAIR_START] pair=${pair}`, "trading");
            
            // Inicializar entrada por defecto para diagnÃ³stico (se sobrescribe si hay seÃ±al)
            const expDefault = this.getAvailableExposure(pair, config, this.currentUsdBalance);
            if (!this.lastScanResults.has(pair)) {
              this.lastScanResults.set(pair, {
                signal: "NONE",
                reason: "Sin seÃ±al en este ciclo",
                exposureAvailable: expDefault.maxAllowed,
              });
            }
            
            // Determinar si es ciclo intermedio (sin vela cerrada nueva)
            let isIntermediateCycle = true;
            
            if (isCandleMode) {
              const candle = await this.getLastClosedCandle(pair, signalTimeframe);
              if (!candle) {
                // No hay vela, ciclo intermedio con datos cacheados
                this.initPairTrace(pair, expDefault.maxAllowed, true);
                log(`[SCAN_PAIR_OK] pair=${pair} result=no_candle`, "trading");
                scannedPairs.push(pair);
                continue;
              }
              
              if (this.isNewCandleClosed(pair, signalTimeframe, candle.time)) {
                // Vela nueva cerrada = anÃ¡lisis completo
                isIntermediateCycle = false;
                this.initPairTrace(pair, expDefault.maxAllowed, false);
                log(`Nueva vela cerrada ${pair}/${signalTimeframe} @ ${new Date(candle.time * 1000).toISOString()}`, "trading");
                await this.analyzePairAndTradeWithCandles(pair, signalTimeframe, candle, riskConfig, balances);
              } else {
                // No hay vela nueva, ciclo intermedio
                this.initPairTrace(pair, expDefault.maxAllowed, true);
              }
            } else {
              // Modo ciclo = siempre anÃ¡lisis completo
              isIntermediateCycle = false;
              this.initPairTrace(pair, expDefault.maxAllowed, false);
              await this.analyzePairAndTrade(pair, config.strategy, riskConfig, balances);
            }
            
            // Emitir decision trace para diagnÃ³stico
            this.emitPairDecisionTrace(pair);
            
            log(`[SCAN_PAIR_OK] pair=${pair}`, "trading");
            scannedPairs.push(pair);
          } catch (pairError: any) {
            log(`[SCAN_PAIR_ERR] pair=${pair} error=${pairError.message}`, "trading");
            failedPairs.push(pair);
            continue; // Never break the loop - continue to next pair
          }
        }

        // Validate all pairs were processed
        if (scannedPairs.length + failedPairs.length !== activePairs.length) {
          log(`[SCAN_INCOMPLETE] expected=${activePairs.length} scanned=${scannedPairs.length} failed=${failedPairs.length}`, "trading");
        }
        if (failedPairs.length > 0) {
          log(`[SCAN_FAILURES] pairs=${failedPairs.join(",")}`, "trading");
        }
      } finally {
        // Always mark scan as complete and log SCAN_END
        const durationMs = Date.now() - this.lastScanStartTime;
        this.scanInProgress = false;
        
        // Si el scan fue completo (done === expected), crear snapshot para emisiÃ³n
        if (scannedPairs.length === activePairs.length) {
          this.lastEmittedResults = new Map(this.lastScanResults);
          this.lastEmittedScanId = this.currentScanId;
          this.lastEmittedScanTime = this.lastScanTime;
          log(`[SCAN_SNAPSHOT] scanId=${this.currentScanId} pairs=${scannedPairs.length} snapshotted for emission`, "trading");
        }
        
        log(`[SCAN_END] scanId=${this.currentScanId} expected=${activePairs.length} done=${scannedPairs.length} failures=${failedPairs.length} durationMs=${durationMs}`, "trading");
      }
    } catch (error: any) {
      log(`Error en ciclo de trading: ${error.message}`, "trading");
    }
  }

  // checkStopLossTakeProfit + checkSinglePositionSLTP + checkSmartGuardExit → delegated to ExitManager
  // See server/services/exitManager.ts for the full implementation (~1200 lines)

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
      const ticker = await this.getDataExchange().getTicker(krakenPair);
      const currentPrice = Number((ticker as any)?.last ?? 0);
      const high24h = 0;
      const low24h = 0;
      const volume = Number((ticker as any)?.volume24h ?? 0);

      // SAFETY: Fail-fast if price is invalid (prevents Infinity in volume calculations)
      if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
        log(`[TICKER_INVALID] ${pair}: price=${currentPrice} - aborting cycle to prevent Infinity`, "trading");
        return;
      }

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
        reason: signal.reason || "Sin seÃ±al",
        cooldownSec: this.getCooldownRemainingSec(pair),
        exposureAvailable: exposure.maxAllowed,
      });
      
      // === EARLY REGIME DETECTION (always, for diagnostic trace) ===
      let earlyRegime: string | null = null;
      let earlyRegimeReason: string | null = null;
      const regimeEnabledEarly = botConfigForScan?.regimeDetectionEnabled ?? false;
      if (regimeEnabledEarly) {
        try {
          const regimeAnalysis = await this.getMarketRegimeWithCache(pair);
          earlyRegime = regimeAnalysis.regime;
          earlyRegimeReason = regimeAnalysis.reason;
        } catch (regimeErr: any) {
          earlyRegime = "ERROR";
          earlyRegimeReason = regimeErr.message;
        }
      } else {
        earlyRegime = "DISABLED";
        earlyRegimeReason = "Regime detection disabled in config";
      }
      
      // Ajustar minSignalsRequired segÃºn rÃ©gimen (modo scans)
      const baseMinSignalsScan = signal.minSignalsRequired ?? 5;
      const adjustedMinSignalsScan = earlyRegime === "TRANSITION" 
        ? Math.min(baseMinSignalsScan, 4) 
        : (earlyRegime ? this.getRegimeMinSignals(earlyRegime as MarketRegime, baseMinSignalsScan) : baseMinSignalsScan);
      
      // Actualizar trace con seÃ±al raw + rÃ©gime + signalsCount
      this.updatePairTrace(pair, {
        selectedStrategy: strategy,
        rawSignal: signal.action === "hold" ? "NONE" : (signal.action.toUpperCase() as "BUY" | "SELL" | "NONE"),
        rawReason: signal.reason || null,
        regime: earlyRegime,
        regimeReason: earlyRegimeReason,
        signalsCount: signal.signalsCount ?? null,
        minSignalsRequired: adjustedMinSignalsScan,
        exposureAvailableUsd: exposure.maxAllowed,
        finalSignal: signal.action === "hold" ? "NONE" : (signal.action.toUpperCase() as "BUY" | "SELL" | "NONE"),
        finalReason: signal.reason || "Sin seÃ±al",
      });
      
      if (signal.action === "hold" || signal.confidence < 0.6) {
        if (signal.confidence < 0.6 && signal.action !== "hold") {
          this.updatePairTrace(pair, {
            smartGuardDecision: "BLOCK",
            blockReasonCode: "CONFIDENCE_LOW",
            blockDetails: { confidence: signal.confidence, minRequired: 0.6 },
            finalSignal: "NONE",
            finalReason: `Confianza baja: ${(signal.confidence * 100).toFixed(0)}% < 60%`,
          });
        }
        return;
      }

      const assetBalance = this.getAssetBalance(pair, balances);
      const existingPositions = this.getPositionsByPair(pair);
      const existingPosition = existingPositions[0];

      if (signal.action === "buy") {
        if (this.isPairInCooldown(pair)) {
          const cooldownSec = this.getCooldownRemainingSec(pair);
          await botLogger.info("TRADE_SKIPPED", `SeÃ±al BUY ignorada - par en cooldown`, {
            pair,
            signal: "BUY",
            reason: "PAIR_COOLDOWN",
            cooldownRemainingSec: cooldownSec,
            signalReason: signal.reason,
          });
          this.updatePairTrace(pair, {
            smartGuardDecision: "BLOCK",
            blockReasonCode: "COOLDOWN",
            blockDetails: { cooldownRemainingSec: cooldownSec },
            finalSignal: "NONE",
            finalReason: `Cooldown: ${cooldownSec}s restantes`,
          });
          return;
        }

        // MODO SINGLE o SMART_GUARD: Bloquear compras si ya hay posiciÃ³n abierta
        // CRITICAL FIX: Use DB query to count OPEN + PENDING_FILL + pending intents
        const botConfigCheck = await storage.getBotConfig();
        const positionMode = botConfigCheck?.positionMode || "SINGLE";
        const sgMaxLotsPerPair = botConfigCheck?.sgMaxOpenLotsPerPair ?? 1;
        const exchangeForGate = this.getTradingExchangeType();
        
        // En SINGLE siempre 1 slot. En SMART_GUARD respetamos sgMaxOpenLotsPerPair.
        const maxLotsForMode = positionMode === "SMART_GUARD" ? sgMaxLotsPerPair : 1;
        
        // ROBUST GATE: Query DB for all occupied slots (OPEN + PENDING_FILL + pending intents)
        const occupiedSlots = await storage.countOccupiedSlotsForPair(exchangeForGate, pair);
        const currentOpenLots = occupiedSlots.total;
        
        // Anti-burst cooldown: minimum 120s between entries per pair
        const sgMinSecondsBetweenEntries = 120;
        const lastOrderTime = await storage.getLastOrderTimeForPair(exchangeForGate, pair);
        if (lastOrderTime) {
          const secondsSinceLastOrder = (Date.now() - lastOrderTime.getTime()) / 1000;
          if (secondsSinceLastOrder < sgMinSecondsBetweenEntries) {
            const remainingSec = Math.ceil(sgMinSecondsBetweenEntries - secondsSinceLastOrder);
            log(`${pair}: Compra bloqueada - Cooldown anti-rÃ¡faga: ${remainingSec}s`, "trading");
            await botLogger.info("TRADE_SKIPPED", `SeÃ±al BUY ignorada - cooldown anti-rÃ¡faga`, {
              pair, signal: "BUY", reason: "ENTRY_COOLDOWN",
              secondsSinceLastOrder, cooldownSeconds: sgMinSecondsBetweenEntries, remainingSeconds: remainingSec,
            });
            this.updatePairTrace(pair, {
              openLotsThisPair: currentOpenLots, maxLotsPerPair: maxLotsForMode,
              smartGuardDecision: "BLOCK", blockReasonCode: "COOLDOWN",
              blockDetails: { cooldownRemainingSec: remainingSec, type: "ENTRY_COOLDOWN" },
              finalSignal: "NONE", finalReason: `Cooldown anti-rÃ¡faga: ${remainingSec}s`,
            });
            return;
          }
        }
        
        if ((positionMode === "SINGLE" || positionMode === "SMART_GUARD") && currentOpenLots >= maxLotsForMode) {
          const reasonCode = positionMode === "SMART_GUARD" 
            ? "SMART_GUARD_MAX_LOTS_REACHED" 
            : "SINGLE_MODE_POSITION_EXISTS";
          
          log(`${pair}: Compra bloqueada - slots ocupados ${currentOpenLots}/${maxLotsForMode} (OPEN=${occupiedSlots.openPositions}, PENDING=${occupiedSlots.pendingFillPositions}, intents=${occupiedSlots.pendingIntents})`, "trading");
          await botLogger.info("TRADE_SKIPPED", `SeÃ±al BUY ignorada - mÃ¡ximo de slots ocupados`, {
            pair,
            signal: "BUY",
            reason: reasonCode,
            currentOpenLots,
            maxOpenLots: maxLotsForMode,
            occupiedSlots,
            existingAmount: existingPosition?.amount || 0,
            signalReason: signal.reason,
          });
          this.lastScanResults.set(pair, {
            signal: "BUY",
            reason: reasonCode,
            exposureAvailable: 0,
          });
          this.updatePairTrace(pair, {
            openLotsThisPair: currentOpenLots,
            maxLotsPerPair: maxLotsForMode,
            smartGuardDecision: "BLOCK",
            blockReasonCode: "MAX_LOTS_PER_PAIR",
            blockDetails: { currentOpenLots, maxLotsForMode, occupiedSlots },
            finalSignal: "NONE",
            finalReason: `Max slots: ${currentOpenLots}/${maxLotsForMode} (OPEN=${occupiedSlots.openPositions}, PENDING=${occupiedSlots.pendingFillPositions})`,
          });
          return;
        }

        // B3: SMART_GUARD requiere â‰¥5 seÃ±ales para BUY (umbral mÃ¡s estricto)
        // + Market Regime: 6 seÃ±ales en RANGE, pausa en TRANSITION (unless Router enabled)
        // Store current regime for sizing override and Telegram notifications
        let currentRegimeForSizing: string | null = null;
        let currentRegimeReasonForTelegram: string | null = null;
        const routerEnabledForSizing = (botConfigCheck as any)?.regimeRouterEnabled ?? false;
        
        if (positionMode === "SMART_GUARD") {
          const regimeEnabled = botConfigCheck?.regimeDetectionEnabled ?? false;
          let requiredSignals = 5; // Base SMART_GUARD requirement
          let regimeInfo = "";
          
          if (regimeEnabled) {
            try {
              const regimeAnalysis = await this.getMarketRegimeWithCache(pair);
              currentRegimeForSizing = regimeAnalysis.regime;
              currentRegimeReasonForTelegram = regimeAnalysis.reason;
              
              // TRANSITION: If Router enabled, allow with overrides; otherwise block
              if (this.shouldPauseEntriesDueToRegime(regimeAnalysis.regime, regimeEnabled) && !routerEnabledForSizing) {
                await botLogger.info("TRADE_SKIPPED", `SMART_GUARD BUY bloqueado - rÃ©gimen TRANSITION (pausa entradas)`, {
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
                this.updatePairTrace(pair, {
                  regime: regimeAnalysis.regime,
                  regimeReason: regimeAnalysis.reason,
                  smartGuardDecision: "BLOCK",
                  blockReasonCode: "REGIME_PAUSE",
                  blockDetails: { regime: regimeAnalysis.regime, adx: regimeAnalysis.adx },
                  finalSignal: "NONE",
                  finalReason: `RÃ©gimen TRANSITION: pausa entradas`,
                });
                return;
              }
              
              // Router TRANSITION: Log that we're allowing entry with overrides
              if (regimeAnalysis.regime === "TRANSITION" && routerEnabledForSizing) {
                const transitionSizeFactor = (botConfigCheck as any)?.transitionSizeFactor ?? 0.5;
                log(`[ROUTER] ${pair}: TRANSITION regime - allowing entry with sizing ${(transitionSizeFactor * 100).toFixed(0)}%`, "trading");
              }
              
              // Adjust minSignals based on regime (RANGE = 6, TREND = 5, TRANSITION = 4)
              const baseForRegime = regimeAnalysis.regime === "TRANSITION" ? 4 : 5;
              requiredSignals = this.getRegimeMinSignals(regimeAnalysis.regime, baseForRegime);
              regimeInfo = ` [RÃ©gimen: ${regimeAnalysis.regime}]`;
            } catch (regimeError: any) {
              // On regime detection error, fallback to base SMART_GUARD (5 signals)
              log(`${pair}: Error en detecciÃ³n de rÃ©gimen, usando base SMART_GUARD: ${regimeError.message}`, "trading");
              // Update scan results to reflect the error state
              this.lastScanResults.set(pair, {
                signal: "BUY",
                reason: `REGIME_ERROR: Fallback a base SMART_GUARD`,
              });
              this.updatePairTrace(pair, {
                regime: "ERROR",
                regimeReason: regimeError.message,
                blockReasonCode: "REGIME_ERROR",
                blockDetails: { error: regimeError.message },
              });
            }
          }
          
          // Regex flexible: acepta "SeÃ±ales: X/Y" (Momentum) o "SeÃ±ales: X" (Mean Reversion)
          const signalCountMatch = signal.reason.match(/SeÃ±ales:\s*(\d+)(?:\/(\d+))?/);
          if (signalCountMatch) {
            const buySignalCount = parseInt(signalCountMatch[1], 10);
            // Extraer nombre de rÃ©gimen limpio para analytics
            const regimeMatch = regimeInfo.match(/RÃ©gimen:\s*(\w+)/);
            const regimeName = regimeMatch ? regimeMatch[1] : (regimeEnabled ? "BASE" : "DISABLED");
            
            log(`[B3] ${pair}: Parsed seÃ±ales=${buySignalCount}, required=${requiredSignals}, regime=${regimeName}`, "trading");
            if (buySignalCount < requiredSignals) {
              await botLogger.info("TRADE_SKIPPED", `SMART_GUARD BUY bloqueado - seÃ±ales insuficientes (${buySignalCount} < ${requiredSignals})${regimeInfo}`, {
                pair,
                signal: "BUY",
                reason: "SMART_GUARD_INSUFFICIENT_SIGNALS",
                got: buySignalCount,
                required: requiredSignals,
                regime: regimeName,
                regimeEnabled,
                signalReason: signal.reason,
              });
              this.updatePairTrace(pair, {
                signalsCount: buySignalCount,
                minSignalsRequired: requiredSignals,
                smartGuardDecision: "BLOCK",
                blockReasonCode: "SIGNALS_THRESHOLD",
                blockDetails: { signalsCount: buySignalCount, minSignalsRequired: requiredSignals, regime: regimeName },
                finalSignal: "NONE",
                finalReason: `SeÃ±ales insuficientes: ${buySignalCount}/${requiredSignals}`,
              });
              return;
            }
          } else {
            // B3 Fallback: regex no matcheÃ³ - fail-closed en SMART_GUARD
            await botLogger.warn("B3_REGEX_NO_MATCH", `SMART_GUARD BUY bloqueado - no se pudo parsear seÃ±ales (fail-closed)`, {
              pair,
              signal: "BUY",
              reason: "B3_REGEX_NO_MATCH",
              signalReason: signal.reason,
              strategyId: "momentum",
              entryMode: "SMART_GUARD",
            });
            log(`[B3] ${pair}: BLOQUEADO - regex no matcheÃ³ reason: "${signal.reason}"`, "trading");
            return;
          }
        }

        // MEJORA 4: Verificar cooldown post stop-loss
        if (this.isPairInStopLossCooldown(pair)) {
          const cooldownSec = this.getStopLossCooldownRemainingSec(pair);
          log(`${pair}: En cooldown post stop-loss`, "trading");
          await botLogger.info("TRADE_SKIPPED", `SeÃ±al BUY ignorada - cooldown post stop-loss`, {
            pair,
            signal: "BUY",
            reason: "STOPLOSS_COOLDOWN",
            cooldownRemainingSec: cooldownSec,
            signalReason: signal.reason,
          });
          this.updatePairTrace(pair, {
            smartGuardDecision: "BLOCK",
            blockReasonCode: "STOPLOSS_COOLDOWN",
            blockDetails: { cooldownRemainingSec: cooldownSec },
            finalSignal: "NONE",
            finalReason: `SL Cooldown: ${cooldownSec}s restantes`,
          });
          return;
        }

        // SPREAD FILTER v2: Single decision point (Kraken proxy + RevolutX markup)
        const spreadTicker = await this.getDataExchange().getTicker(krakenPair);
        const spreadResult = await this.checkSpreadForBuy(pair, spreadTicker, earlyRegime, botConfigCheck);
        if (!spreadResult.ok) {
          const sd = spreadResult.details;
          log(`${pair}: Spread bloqueado (${sd.spreadEffectivePct.toFixed(3)}% > ${sd.thresholdPct.toFixed(2)}%) [${sd.decision}]`, "trading");
          this.updatePairTrace(pair, {
            smartGuardDecision: "BLOCK",
            blockReasonCode: "SPREAD_TOO_HIGH",
            blockDetails: {
              spreadEffectivePct: sd.spreadEffectivePct,
              thresholdPct: sd.thresholdPct,
              spreadKrakenPct: sd.spreadKrakenPct,
              revolutxMarkupPct: sd.revolutxMarkupPct,
              regime: earlyRegime,
              tradingExchange: sd.tradingExchange,
            },
            finalSignal: "NONE",
            finalReason: sd.reason,
          });
          return;
        }

        if (existingPosition && existingPosition.amount * currentPrice > riskConfig.maxTradeUSD * 2) {
          log(`PosiciÃ³n existente en ${pair} ya es grande: $${(existingPosition.amount * currentPrice).toFixed(2)}`, "trading");
          await botLogger.info("TRADE_SKIPPED", `SeÃ±al BUY ignorada - posiciÃ³n existente demasiado grande`, {
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
          await botLogger.info("TRADE_SKIPPED", `SeÃ±al BUY ignorada - fondos insuficientes`, {
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
        
        // === CÃLCULO DE TAMAÃ‘O DE ORDEN (tradeAmountUSD) ===
        // SMART_GUARD v2: sgMinEntryUsd es un "objetivo preferido", no un bloqueo
        // - Si saldo >= sgMinEntryUsd â†’ usar sgMinEntryUsd exactamente (no mÃ¡s)
        // - Si saldo < sgMinEntryUsd â†’ fallback automÃ¡tico a saldo disponible
        // - floorUsd = max(exchangeMin, absoluteMin) â†’ hard block si saldo < floorUsd
        let tradeAmountUSD: number;
        let wasAdjusted = false;
        let originalAmount: number;
        let sgReasonCode: SmartGuardReasonCode | undefined;
        
        // Para SMART_GUARD: calcular orderUsdProposed por lÃ³gica normal, luego validar mÃ­nimos
        const sgParams = positionMode === "SMART_GUARD" ? this.getSmartGuardParams(pair, botConfig) : null;
        const sgMinEntryUsd = sgParams?.sgMinEntryUsd || 100;
        const sgAllowUnderMin = sgParams?.sgAllowUnderMin ?? true; // DEPRECATED - se ignora
        const sgFeeCushionPct = sgParams?.sgFeeCushionPct || 0;
        const sgFeeCushionAuto = sgParams?.sgFeeCushionAuto ?? false;
        
        // Calcular fee cushion efectivo (auto = round-trip fees + slippage buffer)
        const effectiveCushionPct = sgFeeCushionAuto ? getRoundTripWithBufferPct() : sgFeeCushionPct;
        
        // usdDisponible = saldo real disponible (sin buffer en SMART_GUARD v2 para sizing exacto)
        const usdDisponible = freshUsdBalance;
        
        // === NUEVA LÃ“GICA SMART_GUARD v2 ===
        // floorUsd = max(minOrderExchangeUsd, MIN_ORDER_ABSOLUTE_USD) - HARD BLOCK
        const floorUsd = Math.max(SG_ABSOLUTE_MIN_USD, minRequiredUSD);
        
        // availableAfterCushion = saldo menos reserva para fees
        const cushionAmount = freshUsdBalance * (effectiveCushionPct / 100);
        const availableAfterCushion = usdDisponible - cushionAmount;
        
        if (positionMode === "SMART_GUARD") {
          // === SMART_GUARD v2 SIZING ===
          // Regla 1: sgMinEntryUsd es "objetivo preferido"
          // Regla 2: Si saldo >= sgMinEntryUsd â†’ usar sgMinEntryUsd EXACTO
          // Regla 3: Si saldo < sgMinEntryUsd â†’ fallback a saldo disponible (si >= floorUsd)
          // Regla 4: Si saldo < floorUsd â†’ BLOQUEAR
          
          originalAmount = sgMinEntryUsd; // El objetivo propuesto siempre es sgMinEntryUsd
          
          if (availableAfterCushion >= sgMinEntryUsd) {
            // Caso A: Saldo suficiente â†’ usar sgMinEntryUsd EXACTO (no mÃ¡s)
            tradeAmountUSD = sgMinEntryUsd;
            sgReasonCode = "SMART_GUARD_ENTRY_USING_CONFIG_MIN";
            
          } else if (availableAfterCushion >= floorUsd) {
            // Caso B: Saldo insuficiente para config, pero >= floorUsd â†’ fallback automÃ¡tico
            tradeAmountUSD = availableAfterCushion;
            sgReasonCode = "SMART_GUARD_ENTRY_FALLBACK_TO_AVAILABLE";
            
          } else if (usdDisponible >= floorUsd && availableAfterCushion < floorUsd) {
            // Caso C: Fee cushion lo baja de floorUsd â†’ se bloquearÃ¡ en validaciÃ³n
            tradeAmountUSD = availableAfterCushion;
            sgReasonCode = "SMART_GUARD_BLOCKED_AFTER_FEE_CUSHION";
            
          } else {
            // Caso D: Saldo < floorUsd â†’ se bloquearÃ¡ en validaciÃ³n
            tradeAmountUSD = usdDisponible;
            sgReasonCode = "SMART_GUARD_BLOCKED_BELOW_EXCHANGE_MIN";
          }
          
          log(`SMART_GUARD ${pair}: Sizing v2 - order=$${tradeAmountUSD.toFixed(2)}, reason=${sgReasonCode}`, "trading");
          log(`  â†’ availableUsd=$${usdDisponible.toFixed(2)}, sgMinEntryUsd=$${sgMinEntryUsd.toFixed(2)}, floorUsd=$${floorUsd.toFixed(2)} [exch=$${minRequiredUSD.toFixed(2)}, abs=$${SG_ABSOLUTE_MIN_USD}]`, "trading");
          log(`  â†’ cushionPct=${effectiveCushionPct.toFixed(2)}%, cushionAmt=$${cushionAmount.toFixed(2)}, availableAfterCushion=$${availableAfterCushion.toFixed(2)}`, "trading");
          log(`  â†’ sgAllowUnderMin=${sgAllowUnderMin} (DEPRECATED - ignorado, siempre fallback automÃ¡tico)`, "trading");
          
          // Fix coherencia: allowSmallerEntries siempre true en SMART_GUARD (auto fallback)
          this.updatePairTrace(pair, {
            allowSmallerEntries: true, // SMART_GUARD v2: siempre permite auto fallback
            computedOrderUsd: tradeAmountUSD,
            minOrderUsd: floorUsd,
          });
          
          // === ROUTER: Apply TRANSITION sizing factor (50% by default) ===
          if (currentRegimeForSizing === "TRANSITION" && routerEnabledForSizing) {
            const transitionSizeFactor = (botConfigCheck as any)?.transitionSizeFactor ?? 0.5;
            const originalBeforeTransition = tradeAmountUSD;
            tradeAmountUSD = tradeAmountUSD * transitionSizeFactor;
            log(`[ROUTER] ${pair}: TRANSITION sizing override: $${originalBeforeTransition.toFixed(2)} â†’ $${tradeAmountUSD.toFixed(2)} (${(transitionSizeFactor * 100).toFixed(0)}%)`, "trading");
          }
          
          // La validaciÃ³n final de mÃ­nimos se hace DESPUÃ‰S con validateMinimumsOrSkip()
        } else {
          // Modos SINGLE/DCA: lÃ³gica original con exposure limits
          
          // Verificar que el take-profit sea rentable despuÃ©s de comisiones
          const profitCheck = this.isProfitableAfterFees(takeProfitPct);
          if (!profitCheck.isProfitable) {
            log(`${pair}: Trade rechazado - Take-Profit (${takeProfitPct}%) < mÃ­nimo rentable (${profitCheck.minProfitRequired.toFixed(2)}%). Fees round-trip: ${profitCheck.roundTripFees.toFixed(2)}%`, "trading");
            
            await botLogger.info("TRADE_SKIPPED", `SeÃ±al BUY ignorada - take-profit menor que fees`, {
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

          // MEJORA 3: Position sizing dinÃ¡mico basado en confianza
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
        // POLÃTICA UNIFICADA: SMART_GUARD SÃ respeta maxTotalExposurePct para evitar sobreapalancamiento
        // Pero NO aplica maxPairExposurePct (permite concentraciÃ³n en un par si hay seÃ±al fuerte)
        const effectiveMaxAllowed = positionMode === "SMART_GUARD" 
          ? Math.min(exposure.maxTotalAvailable, maxByBalance)  // Solo limita por exposiciÃ³n TOTAL
          : Math.min(exposure.maxAllowed, maxByBalance);  // SINGLE/DCA limita por par Y total
        
        if (effectiveMaxAllowed < minRequiredUSD) {
          log(`${pair}: Sin exposiciÃ³n disponible. Disponible: $${effectiveMaxAllowed.toFixed(2)}, MÃ­nimo: $${minRequiredUSD.toFixed(2)}`, "trading");
          await botLogger.info("TRADE_SKIPPED", `SeÃ±al BUY ignorada - sin exposiciÃ³n disponible`, {
            pair,
            signal: "BUY",
            reason: "EXPOSURE_ZERO",
            exposureAvailable: effectiveMaxAllowed,
            minRequiredUsd: minRequiredUSD,
          });
          this.updatePairTrace(pair, {
            smartGuardDecision: "BLOCK",
            blockReasonCode: "EXPOSURE_LIMIT",
            blockDetails: { exposureAvailable: effectiveMaxAllowed, minRequiredUsd: minRequiredUSD },
            finalSignal: "NONE",
            finalReason: `ExposiciÃ³n insuficiente: $${effectiveMaxAllowed.toFixed(2)} < $${minRequiredUSD.toFixed(2)}`,
          });
          this.setPairCooldown(pair);
          
          if (this.shouldSendExposureAlert(pair)) {
            await botLogger.info("PAIR_COOLDOWN", `${pair} en cooldown - sin exposiciÃ³n disponible`, {
              pair,
              maxAllowed: effectiveMaxAllowed,
              minRequired: minRequiredUSD,
              cooldownMinutes: this.COOLDOWN_DURATION_MS / 60000,
            });

            if (this.telegramService.isInitialized()) {
              await this.telegramService.sendAlertToMultipleChats(`ðŸ¤– <b>KRAKEN BOT</b> ðŸ‡ªðŸ‡¸
â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
â¸ï¸ <b>Par en Espera</b>

ðŸ“¦ <b>Detalles:</b>
   â€¢ Par: <code>${pair}</code>
   â€¢ Disponible: <code>$${exposure.maxAllowed.toFixed(2)}</code>
   â€¢ MÃ­nimo requerido: <code>$${minRequiredUSD.toFixed(2)}</code>

â„¹ï¸ Cooldown: ${this.COOLDOWN_DURATION_MS / 60000} min
â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”`, "system");
            }
          }
          return;
        }

        // Ajustar por lÃ­mite de exposiciÃ³n (solo para SINGLE/DCA, SMART_GUARD ya validÃ³ arriba)
        if (positionMode !== "SMART_GUARD" && tradeAmountUSD > effectiveMaxAllowed) {
          originalAmount = tradeAmountUSD;
          tradeAmountUSD = effectiveMaxAllowed;
          wasAdjusted = true;
          
          log(`${pair}: Trade ajustado de $${originalAmount.toFixed(2)} a $${tradeAmountUSD.toFixed(2)} (lÃ­mite exposiciÃ³n)`, "trading");
          
          await botLogger.info("TRADE_ADJUSTED", `Trade ajustado por lÃ­mite de exposiciÃ³n`, {
            pair,
            originalAmountUsd: originalAmount,
            adjustedAmountUsd: tradeAmountUSD,
            maxPairAvailable: exposure.maxPairAvailable,
            maxTotalAvailable: exposure.maxTotalAvailable,
            riskPerTradePct,
          });
        }

        const tradeVolume = tradeAmountUSD / currentPrice;

        // SAFETY: Validate volume is finite before proceeding (prevents Infinity/NaN in placeOrder)
        if (!Number.isFinite(tradeVolume) || tradeVolume <= 0) {
          log(`[ORDER_SKIPPED_INVALID_NUMBER] ${pair}: tradeVolume=${tradeVolume}, orderUsd=${tradeAmountUSD}, price=${currentPrice}`, "trading");
          await botLogger.warn("ORDER_SKIPPED_INVALID_NUMBER", `Volume invalido - posible division por cero`, {
            pair,
            tradeVolume,
            tradeAmountUSD,
            currentPrice,
          });
          return;
        }

        if (tradeVolume < minVolume) {
          log(`${pair}: Volumen ${tradeVolume.toFixed(8)} < mÃ­nimo ${minVolume}`, "trading");
          await botLogger.info("TRADE_SKIPPED", `SeÃ±al BUY ignorada - volumen < mÃ­nimo`, {
            pair,
            signal: "BUY",
            reason: "VOLUME_BELOW_MINIMUM",
            calculatedVolume: tradeVolume,
            minVolume,
          });
          this.setPairCooldown(pair);
          return;
        }

        // === VALIDACIÃ“N FINAL ÃšNICA Y CENTRALIZADA (fuente de verdad) ===
        // Se ejecuta ANTES de executeTrade() para REAL y DRY_RUN
        const orderUsdFinal = tradeAmountUSD;
        const envPrefix = environment.envTag;
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
          sgAllowUnderMin, // DEPRECATED - se ignora en validaciÃ³n
          dryRun: this.dryRunMode,
          env: envPrefix,
          floorUsd: positionMode === "SMART_GUARD" ? floorUsd : undefined,
          availableAfterCushion: positionMode === "SMART_GUARD" ? availableAfterCushion : undefined,
        });
        
        if (!validationResult.valid) {
          // === [BUY_EVAL] LOGS v2: Valores detallados para auditorÃ­a ===
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
          
          // Determinar blockReasonCode basado en skipReason
          const traceBlockReason: BlockReasonCode = 
            validationResult.skipReason === "MIN_ORDER_ABSOLUTE" ? "MIN_ORDER_ABSOLUTE" :
            validationResult.skipReason === "MIN_ORDER_USD" ? "MIN_ORDER_USD" :
            validationResult.skipReason?.includes("BLOCKED") ? "MIN_ORDER_USD" : "MIN_ORDER_USD";
          
          this.updatePairTrace(pair, {
            computedOrderUsd: orderUsdFinal,
            minOrderUsd: sgMinEntryUsd,
            smartGuardDecision: "BLOCK",
            blockReasonCode: traceBlockReason,
            blockDetails: { 
              computedOrderUsd: orderUsdFinal, 
              minOrderUsd: sgMinEntryUsd,
              skipReason: validationResult.skipReason,
              ...validationResult.meta,
            },
            finalSignal: "NONE",
            finalReason: `Blocked: ${validationResult.message}`,
          });
          
          await botLogger.info("TRADE_SKIPPED", `SeÃ±al BUY bloqueada - ${validationResult.skipReason}`, {
            pair,
            signal: "BUY",
            reason: validationResult.skipReason,
            sgReasonCode,
            ...validationResult.meta,
          });
          
          this.setPairCooldown(pair);
          return;
        }
        
        // Log de decisiÃ³n final antes de ejecutar (con nuevo reason code)
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

        const hgCfg = this.getHybridGuardConfig();
        const hgInfo = (signal as any)?.hybridGuard as { watchId: number; reason: "ANTI_CRESTA" | "MTF_STRICT" } | undefined;
        
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
          hybridGuard: hgInfo ? { watchId: hgInfo.watchId, reason: hgInfo.reason } : undefined,
        };

        // Build strategyMeta with regime info for Telegram notifications
        const strategyMetaForTrade = currentRegimeForSizing ? {
          strategyId: "momentum_cycle",
          timeframe: "cycle",
          confidence: signal.confidence,
          regime: currentRegimeForSizing,
          regimeReason: currentRegimeReasonForTelegram || undefined,
          routerStrategy: routerEnabledForSizing ? "momentum_cycle" : undefined,
        } : {
          strategyId: "momentum_cycle",
          timeframe: "cycle",
          confidence: signal.confidence,
        };

        if (hgCfg?.enabled && hgInfo && this.telegramService.isInitialized()) {
          const alerts = hgCfg?.alerts;
          if (alerts?.enabled !== false && alerts?.reentrySignal !== false) {
            this.telegramService.sendHybridGuardReentrySignal({
              pair,
              exchange: this.getTradingExchangeType(),
              reason: hgInfo.reason,
              watchId: hgInfo.watchId,
              currentPrice,
            }).catch((e: any) => log(`[ALERT_ERR] sendHybridGuardReentrySignal: ${e?.message ?? String(e)}`, 'trading'));
          }
        }

        const success = await this.executeTrade(pair, "buy", tradeVolume.toFixed(8), currentPrice, signal.reason, adjustmentInfo, strategyMetaForTrade, executionMeta);
        if (success && !this.dryRunMode && hgCfg?.enabled && hgInfo) {
          try {
            await storage.markHybridReentryWatchTriggered({
              id: hgInfo.watchId,
              metaPatch: {
                triggerPrice: currentPrice,
                triggerVolume: tradeVolume.toFixed(8),
                triggeredAt: new Date().toISOString(),
                triggeredReason: hgInfo.reason,
              },
            });
          } catch (e: any) {
            log(`[HYBRID_GUARD] markTriggered error: ${e?.message ?? String(e)}`, 'trading');
          }

          if (this.telegramService.isInitialized()) {
            const alerts = hgCfg?.alerts;
            if (alerts?.enabled !== false && alerts?.orderExecuted !== false) {
              this.telegramService.sendHybridGuardOrderExecuted({
                pair,
                exchange: this.getTradingExchangeType(),
                reason: hgInfo.reason,
                watchId: hgInfo.watchId,
                price: currentPrice,
                volume: tradeVolume.toFixed(8),
              }).catch((e: any) => log(`[ALERT_ERR] sendHybridGuardOrderExecuted: ${e?.message ?? String(e)}`, 'trading'));
            }
          }
        }
        if (success) {
          this.lastTradeTime.set(pair, Date.now());
          this.updatePairTrace(pair, {
            smartGuardDecision: "ALLOW",
            blockReasonCode: "ALLOWED",
            finalSignal: "BUY",
            finalReason: `Trade ejecutado: ${tradeVolume.toFixed(8)} @ $${currentPrice.toFixed(2)}`,
            feeCushionEffectivePct: effectiveCushionPct,
          });
        }

      } else if (signal.action === "sell") {
        // PRIMERO: Verificar si hay posiciÃ³n para vender (antes de cualquier lÃ³gica SMART_GUARD)
        if (assetBalance <= 0 && (!existingPosition || existingPosition.amount <= 0)) {
          await botLogger.info("TRADE_SKIPPED", `SeÃ±al SELL ignorada - sin posiciÃ³n para vender`, {
            pair,
            signal: "SELL",
            reason: "NO_POSITION",
            assetBalance,
            signalReason: signal.reason,
          });
          this.updatePairTrace(pair, {
            smartGuardDecision: "SKIP",
            blockReasonCode: "NO_POSITION",
            blockDetails: { assetBalance },
            finalSignal: "NONE",
            finalReason: "Sin posiciÃ³n para vender",
          });
          this.emitPairDecisionTrace(pair);
          return;
        }
        
        // A1: SMART_GUARD bloquea SELL por seÃ±al - solo risk exits permiten vender
        // EXCEPCIÃ“N: Permitir liquidaciÃ³n de huÃ©rfanos (balance > 0 sin posiciÃ³n trackeada)
        const botConfigSell = await storage.getBotConfig();
        const positionModeSell = botConfigSell?.positionMode || "SINGLE";
        const isOrphanCleanup = assetBalance > 0 && (!existingPosition || existingPosition.amount <= 0);
        
        if (positionModeSell === "SMART_GUARD" && !isOrphanCleanup) {
          await botLogger.info("TRADE_SKIPPED", `SeÃ±al SELL bloqueada en SMART_GUARD - solo risk exits permiten vender`, {
            pair,
            signal: "SELL",
            reason: "SMART_GUARD_SIGNAL_SELL_BLOCKED",
            signalReason: signal.reason,
          });
          this.updatePairTrace(pair, {
            smartGuardDecision: "BLOCK",
            blockReasonCode: "SELL_BLOCKED",
            blockDetails: { reason: "SMART_GUARD solo permite risk exits" },
            finalSignal: "NONE",
            finalReason: "SELL bloqueado: Solo SL/TP/Trailing permiten vender",
          });
          this.emitPairDecisionTrace(pair);
          
          // Notificar a Telegram
          if (this.telegramService.isInitialized()) {
            await this.telegramService.sendAlertToMultipleChats(`ðŸ¤– <b>KRAKEN BOT</b> ðŸ‡ªðŸ‡¸
â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
ðŸ›¡ï¸ <b>SeÃ±al SELL Bloqueada</b>

ðŸ“¦ <b>Detalles:</b>
   â€¢ Par: <code>${pair}</code>
   â€¢ Modo: <code>SMART_GUARD</code>

âš ï¸ Solo risk exits (SL/TP/Trailing) permiten vender.

â„¹ï¸ <i>${signal.reason}</i>
â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”`, "system");
          }
          
          return;
        }

        // === FIX: Vender lote completo, no 50% ===
        // Usar min(lot.amount, realAssetBalance) para evitar insufficient funds
        // Si no hay lot trackeado, usar balance real del wallet
        let lotAmount = existingPosition?.amount ?? assetBalance;
        
        // ReconciliaciÃ³n hacia ARRIBA (SINGLE/DCA): si hay posiciÃ³n trackeada pero el wallet tiene mÃ¡s,
        // ajustamos el amount del lote para evitar restos sin posiciÃ³n.
        let realAssetBalance = assetBalance;
        if (existingPosition?.lotId) {
          try {
            const freshBalances = await this.getTradingExchange().getBalance();
            realAssetBalance = this.getAssetBalance(pair, freshBalances);
          } catch (balErr: any) {
            log(`${pair}: Error obteniendo balance fresco para reconciliaciÃ³n SELL: ${balErr.message}`, "trading");
          }
          if (realAssetBalance > lotAmount * 1.005) {
            const extraAmount = realAssetBalance - lotAmount;
            const extraValueUsd = extraAmount * currentPrice;
            if (extraValueUsd <= DUST_THRESHOLD_USD) {
              log(`ðŸ”„ ReconciliaciÃ³n (UP) pre-SELL seÃ±al en ${pair} (${existingPosition.lotId}): lot=${lotAmount} real=${realAssetBalance}`, "trading");
              existingPosition.amount = realAssetBalance;
              this.openPositions.set(existingPosition.lotId, existingPosition);
              await this.savePositionToDB(pair, existingPosition);
              await botLogger.info("POSITION_RECONCILED", `PosiciÃ³n reconciliada (UP) antes de SELL por seÃ±al en ${pair}`, {
                pair,
                lotId: existingPosition.lotId,
                direction: "UP",
                registeredAmount: lotAmount,
                realBalance: realAssetBalance,
                extraValueUsd,
                trigger: "SIGNAL_SELL",
              });
              lotAmount = existingPosition.amount;
            } else {
              log(`âš ï¸ Balance real mayor al lote en ${pair} (${existingPosition.lotId}) pero parece HOLD externo (extra $${extraValueUsd.toFixed(2)}). Ignorando reconciliaciÃ³n UP.`, "trading");
            }
          }
        }

        const rawSellVolume = Math.min(lotAmount, realAssetBalance);
        
        // Normalizar al stepSize de Kraken para evitar errores de precisiÃ³n
        const sellVolume = this.normalizeVolume(pair, rawSellVolume);
        
        const minVolumeSell = this.getOrderMin(pair);
        const sellValueUsd = sellVolume * currentPrice;

        // === DUST DETECTION: No intentar vender si es dust ===
        if (sellVolume < minVolumeSell) {
          await botLogger.info("TRADE_SKIPPED", `SELL skipped - dust position (volumen < mÃ­nimo)`, {
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
          if (existingPosition?.lotId) {
            this.openPositions.delete(existingPosition.lotId);
            await this.deletePositionFromDBByLotId(existingPosition.lotId);
          }
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

      const botConfigForScan = await storage.getBotConfig();
      const exposureScan = this.getAvailableExposure(pair, botConfigForScan, this.currentUsdBalance);
      
      // === EARLY REGIME DETECTION (always, for diagnostic trace in candles mode) ===
      let earlyRegime: string | null = null;
      let earlyRegimeReason: string | null = null;
      const regimeEnabledEarly = botConfigForScan?.regimeDetectionEnabled ?? false;
      const routerEnabled = (botConfigForScan as any)?.regimeRouterEnabled ?? false;
      
      if (regimeEnabledEarly) {
        try {
          const regimeAnalysis = await this.getMarketRegimeWithCache(pair);
          earlyRegime = regimeAnalysis.regime;
          earlyRegimeReason = regimeAnalysis.reason;
        } catch (regimeErr: any) {
          earlyRegime = "ERROR";
          earlyRegimeReason = regimeErr.message;
        }
      } else {
        earlyRegime = "DISABLED";
        earlyRegimeReason = "Regime detection disabled in config";
      }
      
      // Pre-calcular adjustedMinSignals para rÃ©gimen (usado en analyzeWithCandleStrategy)
      const baseMinSignalsForStrategy = 5; // Base para momentum
      const adjustedMinSignalsForStrategy = earlyRegime === "TRANSITION" 
        ? Math.min(baseMinSignalsForStrategy, 4) 
        : (earlyRegime ? this.getRegimeMinSignals(earlyRegime as MarketRegime, baseMinSignalsForStrategy) : baseMinSignalsForStrategy);
      
      // === ROUTER: Select strategy based on regime ===
      let selectedStrategyId = `momentum_candles_${timeframe}`;
      let signal: TradeSignal;
      let routerApplied = false;
      
      if (routerEnabled && regimeEnabledEarly && earlyRegime) {
        const intervalMinutes = this.getTimeframeIntervalMinutes(timeframe);
        const candles = await this.getDataExchange().getOHLC(pair, intervalMinutes);
        const closedCandles = candles ? candles.slice(0, -1) : [];
        const currentPrice = candle.close;
        
        if (earlyRegime === "RANGE") {
          // RANGE: Use Mean Reversion Simple strategy
          selectedStrategyId = "mean_reversion_simple";
          signal = this.meanReversionSimpleStrategy(pair, closedCandles, currentPrice);
          routerApplied = true;
          log(`[ROUTER] ${pair}: RANGE regime â†’ mean_reversion_simple`, "trading");
        } else if (earlyRegime === "TRANSITION") {
          // TRANSITION: Use momentum with overrides (handled later in sizing/exits)
          selectedStrategyId = `momentum_candles_${timeframe}`;
          signal = await this.analyzeWithCandleStrategy(pair, timeframe, candle, adjustedMinSignalsForStrategy, earlyRegime);
          routerApplied = true;
          log(`[ROUTER] ${pair}: TRANSITION regime â†’ momentum_candles + overrides`, "trading");
        } else {
          // TREND or other: Use standard momentum
          selectedStrategyId = `momentum_candles_${timeframe}`;
          signal = await this.analyzeWithCandleStrategy(pair, timeframe, candle, adjustedMinSignalsForStrategy, earlyRegime);
          if (earlyRegime === "TREND") {
            routerApplied = true;
            log(`[ROUTER] ${pair}: TREND regime â†’ momentum_candles`, "trading");
          }
        }
      } else {
        // Router disabled: use standard momentum strategy
        signal = await this.analyzeWithCandleStrategy(pair, timeframe, candle, adjustedMinSignalsForStrategy, earlyRegime);
      }
      
      // Registrar resultado del escaneo para candles
      const signalStr = signal.action === "hold" ? "NONE" : signal.action.toUpperCase();
      this.lastScanResults.set(pair, {
        signal: signalStr,
        reason: signal.reason || "Sin seÃ±al",
        cooldownSec: this.getCooldownRemainingSec(pair),
        exposureAvailable: exposureScan.maxAllowed,
      });
      
      // Ajustar minSignalsRequired segÃºn rÃ©gimen (antes de guardar en trace/cache)
      const baseMinSignals = signal.minSignalsRequired ?? 5;
      const adjustedMinSignals = earlyRegime === "TRANSITION" 
        ? Math.min(baseMinSignals, 4) 
        : (earlyRegime ? this.getRegimeMinSignals(earlyRegime as MarketRegime, baseMinSignals) : baseMinSignals);
      
      // Actualizar trace con seÃ±al raw + rÃ©gimen + signalsCount (candles mode)
      this.updatePairTrace(pair, {
        selectedStrategy: selectedStrategyId,
        rawSignal: signal.action === "hold" ? "NONE" : (signal.action.toUpperCase() as "BUY" | "SELL" | "NONE"),
        rawReason: signal.reason || null,
        regime: earlyRegime,
        regimeReason: earlyRegimeReason,
        signalsCount: signal.signalsCount ?? null,
        minSignalsRequired: adjustedMinSignals,
        exposureAvailableUsd: exposureScan.maxAllowed,
        finalSignal: signal.action === "hold" ? "NONE" : (signal.action.toUpperCase() as "BUY" | "SELL" | "NONE"),
        finalReason: signal.reason || "Sin seÃ±al",
        isIntermediateCycle: false, // AnÃ¡lisis completo
        lastCandleClosedAt: new Date(candle.time * 1000).toISOString(),
        lastFullEvaluationAt: new Date().toISOString(),
        lastRegimeUpdateAt: earlyRegime ? new Date().toISOString() : null,
        // Router observability
        regimeRouterEnabled: routerEnabled,
      });
      
      // Cache para ciclos intermedios (evita null en prÃ³ximos scans sin vela cerrada)
      this.cacheFullAnalysis(pair, {
        regime: earlyRegime || "UNKNOWN",
        regimeReason: earlyRegimeReason || "No regime data",
        selectedStrategy: selectedStrategyId,
        signalsCount: signal.signalsCount ?? 0,
        minSignalsRequired: adjustedMinSignals,
        rawReason: signal.reason || "Sin seÃ±al",
        candleClosedAt: new Date(candle.time * 1000).toISOString(),
        regimeRouterEnabled: routerEnabled,
        feeCushionEffectivePct: getRoundTripWithBufferPct(),
      });
      
      if (signal.action === "hold" || signal.confidence < 0.6) {
        if (signal.confidence < 0.6 && signal.action !== "hold") {
          this.updatePairTrace(pair, {
            smartGuardDecision: "BLOCK",
            blockReasonCode: "CONFIDENCE_LOW",
            blockDetails: { confidence: signal.confidence, minRequired: 0.6 },
            finalSignal: "NONE",
            finalReason: `Confianza baja: ${(signal.confidence * 100).toFixed(0)}% < 60%`,
          });
        }
        return;
      }

      const krakenPair = this.formatKrakenPair(pair);
      const ticker = await this.getDataExchange().getTicker(krakenPair);
      const currentPrice = Number((ticker as any)?.last ?? 0);
      
      if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
        log(`[PRICE_INVALID] ${pair}: precio=${currentPrice}, saltando evaluaciÃ³n`, "trading");
        await botLogger.warn("PRICE_INVALID", `Precio no vÃ¡lido para ${pair}`, { pair, currentPrice });
        
        // Enviar alerta crÃ­tica de precio invÃ¡lido
        const alert = ErrorAlertService.createCustomAlert(
          'PRICE_INVALID',
          `Precio invÃ¡lido detectado: ${currentPrice} para ${pair} en evaluaciÃ³n de seÃ±al`,
          'CRITICAL',
          'analyzePairAndTrade',
          'server/services/tradingEngine.ts',
          3720,
          pair,
          { currentPrice, signal: signal?.action, confidence: signal?.confidence }
        );
        await errorAlertService.sendCriticalError(alert);
        
        return;
      }
      
      const assetBalance = this.getAssetBalance(pair, balances);
      const existingPositions = this.getPositionsByPair(pair);
      const existingPosition = existingPositions[0];

      if (signal.action === "buy") {
        if (this.isPairInCooldown(pair)) {
          const cooldownSec = this.getCooldownRemainingSec(pair);
          await botLogger.info("TRADE_SKIPPED", `SeÃ±al BUY ignorada - par en cooldown`, {
            pair,
            signal: "BUY",
            reason: "PAIR_COOLDOWN",
            cooldownRemainingSec: cooldownSec,
            signalReason: signal.reason,
          });
          this.updatePairTrace(pair, {
            smartGuardDecision: "BLOCK",
            blockReasonCode: "COOLDOWN",
            blockDetails: { cooldownRemainingSec: cooldownSec },
            finalSignal: "NONE",
            finalReason: `Cooldown: ${cooldownSec}s restantes`,
          });
          return;
        }

        // MODO SINGLE o SMART_GUARD: Bloquear compras si ya hay posiciÃ³n abierta
        // CRITICAL FIX: Use DB query to count OPEN + PENDING_FILL + pending intents
        const botConfigCheck = await storage.getBotConfig();
        const positionMode = botConfigCheck?.positionMode || "SINGLE";
        const sgMaxLotsPerPair = botConfigCheck?.sgMaxOpenLotsPerPair ?? 1;
        const exchangeForGateCandles = this.getTradingExchangeType();
        
        // En SINGLE siempre 1 slot. En SMART_GUARD respetamos sgMaxOpenLotsPerPair.
        const maxLotsForMode = positionMode === "SMART_GUARD" ? sgMaxLotsPerPair : 1;
        
        // ROBUST GATE: Query DB for all occupied slots (OPEN + PENDING_FILL + pending intents)
        const occupiedSlots = await storage.countOccupiedSlotsForPair(exchangeForGateCandles, pair);
        const currentOpenLots = occupiedSlots.total;
        
        // Anti-burst cooldown: minimum 120s between entries per pair
        const sgMinSecondsBetweenEntriesCandles = 120;
        const lastOrderTimeCandles = await storage.getLastOrderTimeForPair(exchangeForGateCandles, pair);
        if (lastOrderTimeCandles) {
          const secondsSinceLastOrder = (Date.now() - lastOrderTimeCandles.getTime()) / 1000;
          if (secondsSinceLastOrder < sgMinSecondsBetweenEntriesCandles) {
            const remainingSec = Math.ceil(sgMinSecondsBetweenEntriesCandles - secondsSinceLastOrder);
            log(`${pair}: Compra bloqueada - Cooldown anti-rÃ¡faga: ${remainingSec}s`, "trading");
            await botLogger.info("TRADE_SKIPPED", `SeÃ±al BUY ignorada - cooldown anti-rÃ¡faga`, {
              pair, signal: "BUY", reason: "ENTRY_COOLDOWN",
              secondsSinceLastOrder, cooldownSeconds: sgMinSecondsBetweenEntriesCandles, remainingSeconds: remainingSec,
            });
            this.updatePairTrace(pair, {
              openLotsThisPair: currentOpenLots, maxLotsPerPair: maxLotsForMode,
              smartGuardDecision: "BLOCK", blockReasonCode: "COOLDOWN",
              blockDetails: { cooldownRemainingSec: remainingSec, type: "ENTRY_COOLDOWN" },
              finalSignal: "NONE", finalReason: `Cooldown anti-rÃ¡faga: ${remainingSec}s`,
            });
            return;
          }
        }
        
        if ((positionMode === "SINGLE" || positionMode === "SMART_GUARD") && currentOpenLots >= maxLotsForMode) {
          const reasonCode = positionMode === "SMART_GUARD" 
            ? "SMART_GUARD_MAX_LOTS_REACHED" 
            : "SINGLE_MODE_POSITION_EXISTS";
          
          log(`${pair}: Compra bloqueada - slots ocupados ${currentOpenLots}/${maxLotsForMode} (OPEN=${occupiedSlots.openPositions}, PENDING=${occupiedSlots.pendingFillPositions}, intents=${occupiedSlots.pendingIntents})`, "trading");
          await botLogger.info("TRADE_SKIPPED", `SeÃ±al BUY ignorada - mÃ¡ximo de slots ocupados`, {
            pair,
            signal: "BUY",
            reason: reasonCode,
            currentOpenLots,
            maxOpenLots: maxLotsForMode,
            occupiedSlots,
            existingAmount: existingPosition?.amount || 0,
            signalReason: signal.reason,
          });
          this.lastScanResults.set(pair, {
            signal: "BUY",
            reason: reasonCode,
            exposureAvailable: 0,
          });
          this.updatePairTrace(pair, {
            openLotsThisPair: currentOpenLots,
            maxLotsPerPair: maxLotsForMode,
            smartGuardDecision: "BLOCK",
            blockReasonCode: "MAX_LOTS_PER_PAIR",
            blockDetails: { currentOpenLots, maxLotsForMode, occupiedSlots },
            finalSignal: "NONE",
            finalReason: `Max slots: ${currentOpenLots}/${maxLotsForMode} (OPEN=${occupiedSlots.openPositions}, PENDING=${occupiedSlots.pendingFillPositions})`,
          });
          return;
        }

        // B3: SMART_GUARD requiere â‰¥5 seÃ±ales para BUY (umbral mÃ¡s estricto)
        // + Market Regime: 6 seÃ±ales en RANGE, pausa en TRANSITION (unless Router enabled)
        // Store current regime for sizing override and Telegram notifications
        let currentRegimeForSizing: string | null = null;
        let currentRegimeReasonForTelegram: string | null = null;
        const routerEnabledForSizing = (botConfigCheck as any)?.regimeRouterEnabled ?? false;
        
        if (positionMode === "SMART_GUARD") {
          const regimeEnabled = botConfigCheck?.regimeDetectionEnabled ?? false;
          let requiredSignals = 5; // Base SMART_GUARD requirement
          let regimeInfo = "";
          
          if (regimeEnabled) {
            try {
              const regimeAnalysis = await this.getMarketRegimeWithCache(pair);
              currentRegimeForSizing = regimeAnalysis.regime;
              currentRegimeReasonForTelegram = regimeAnalysis.reason;
              
              // TRANSITION: If Router enabled, allow with overrides; otherwise block
              if (this.shouldPauseEntriesDueToRegime(regimeAnalysis.regime, regimeEnabled) && !routerEnabledForSizing) {
                await botLogger.info("TRADE_SKIPPED", `SMART_GUARD BUY bloqueado - rÃ©gimen TRANSITION (pausa entradas)`, {
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
                this.updatePairTrace(pair, {
                  regime: regimeAnalysis.regime,
                  regimeReason: regimeAnalysis.reason,
                  smartGuardDecision: "BLOCK",
                  blockReasonCode: "REGIME_PAUSE",
                  blockDetails: { regime: regimeAnalysis.regime, adx: regimeAnalysis.adx },
                  finalSignal: "NONE",
                  finalReason: `RÃ©gimen TRANSITION: pausa entradas`,
                });
                return;
              }
              
              // Router TRANSITION: Log that we're allowing entry with overrides
              if (regimeAnalysis.regime === "TRANSITION" && routerEnabledForSizing) {
                const transitionSizeFactor = (botConfigCheck as any)?.transitionSizeFactor ?? 0.5;
                log(`[ROUTER] ${pair}: TRANSITION regime - allowing entry with sizing ${(transitionSizeFactor * 100).toFixed(0)}%`, "trading");
              }
              
              // Adjust minSignals based on regime (RANGE = 6, TREND = 5, TRANSITION = 4)
              const baseForRegime = regimeAnalysis.regime === "TRANSITION" ? 4 : 5;
              requiredSignals = this.getRegimeMinSignals(regimeAnalysis.regime, baseForRegime);
              regimeInfo = ` [RÃ©gimen: ${regimeAnalysis.regime}]`;
            } catch (regimeError: any) {
              // On regime detection error, fallback to base SMART_GUARD (5 signals)
              log(`${pair}: Error en detecciÃ³n de rÃ©gimen, usando base SMART_GUARD: ${regimeError.message}`, "trading");
              // Update scan results to reflect the error state
              this.lastScanResults.set(pair, {
                signal: "BUY",
                reason: `REGIME_ERROR: Fallback a base SMART_GUARD`,
              });
              this.updatePairTrace(pair, {
                regime: "ERROR",
                regimeReason: regimeError.message,
                blockReasonCode: "REGIME_ERROR",
                blockDetails: { error: regimeError.message },
              });
            }
          }
          
          // Regex flexible: acepta "SeÃ±ales: X/Y" (Momentum) o "SeÃ±ales: X" (Mean Reversion)
          const signalCountMatch = signal.reason.match(/SeÃ±ales:\s*(\d+)(?:\/(\d+))?/);
          if (signalCountMatch) {
            const buySignalCount = parseInt(signalCountMatch[1], 10);
            // Extraer nombre de rÃ©gimen limpio para analytics
            const regimeMatch = regimeInfo.match(/RÃ©gimen:\s*(\w+)/);
            const regimeName = regimeMatch ? regimeMatch[1] : (regimeEnabled ? "BASE" : "DISABLED");
            
            log(`[B3] ${pair}: Parsed seÃ±ales=${buySignalCount}, required=${requiredSignals}, regime=${regimeName}`, "trading");
            if (buySignalCount < requiredSignals) {
              await botLogger.info("TRADE_SKIPPED", `SMART_GUARD BUY bloqueado - seÃ±ales insuficientes (${buySignalCount} < ${requiredSignals})${regimeInfo}`, {
                pair,
                signal: "BUY",
                reason: "SMART_GUARD_INSUFFICIENT_SIGNALS",
                got: buySignalCount,
                required: requiredSignals,
                regime: regimeName,
                regimeEnabled,
                signalReason: signal.reason,
              });
              this.updatePairTrace(pair, {
                signalsCount: buySignalCount,
                minSignalsRequired: requiredSignals,
                smartGuardDecision: "BLOCK",
                blockReasonCode: "SIGNALS_THRESHOLD",
                blockDetails: { signalsCount: buySignalCount, minSignalsRequired: requiredSignals, regime: regimeName },
                finalSignal: "NONE",
                finalReason: `SeÃ±ales insuficientes: ${buySignalCount}/${requiredSignals}`,
              });
              return;
            }
          } else {
            // B3 Fallback: regex no matcheÃ³ - fail-closed en SMART_GUARD
            await botLogger.warn("B3_REGEX_NO_MATCH", `SMART_GUARD BUY bloqueado - no se pudo parsear seÃ±ales (fail-closed)`, {
              pair,
              signal: "BUY",
              reason: "B3_REGEX_NO_MATCH",
              signalReason: signal.reason,
              strategyId: selectedStrategyId,
              entryMode: "SMART_GUARD",
            });
            log(`[B3] ${pair}: BLOQUEADO - regex no matcheÃ³ reason: "${signal.reason}"`, "trading");
            return;
          }
        }

        if (this.isPairInStopLossCooldown(pair)) {
          const cooldownSec = this.getStopLossCooldownRemainingSec(pair);
          log(`${pair}: En cooldown post stop-loss`, "trading");
          await botLogger.info("TRADE_SKIPPED", `SeÃ±al BUY ignorada - cooldown post stop-loss`, {
            pair,
            signal: "BUY",
            reason: "STOPLOSS_COOLDOWN",
            cooldownRemainingSec: cooldownSec,
            signalReason: signal.reason,
          });
          this.updatePairTrace(pair, {
            smartGuardDecision: "BLOCK",
            blockReasonCode: "STOPLOSS_COOLDOWN",
            blockDetails: { cooldownRemainingSec: cooldownSec },
            finalSignal: "NONE",
            finalReason: `SL Cooldown: ${cooldownSec}s restantes`,
          });
          return;
        }

        // SPREAD FILTER v2: Single decision point (Kraken proxy + RevolutX markup)
        const spreadTicker2 = await this.getDataExchange().getTicker(krakenPair);
        const spreadResult2 = await this.checkSpreadForBuy(pair, spreadTicker2, earlyRegime, botConfigCheck);
        if (!spreadResult2.ok) {
          const sd2 = spreadResult2.details;
          log(`${pair}: Spread bloqueado (${sd2.spreadEffectivePct.toFixed(3)}% > ${sd2.thresholdPct.toFixed(2)}%) [${sd2.decision}]`, "trading");
          this.updatePairTrace(pair, {
            smartGuardDecision: "BLOCK",
            blockReasonCode: "SPREAD_TOO_HIGH",
            blockDetails: {
              spreadEffectivePct: sd2.spreadEffectivePct,
              thresholdPct: sd2.thresholdPct,
              spreadKrakenPct: sd2.spreadKrakenPct,
              revolutxMarkupPct: sd2.revolutxMarkupPct,
              regime: earlyRegime,
              tradingExchange: sd2.tradingExchange,
            },
            finalSignal: "NONE",
            finalReason: sd2.reason,
          });
          return;
        }

        if (existingPosition && existingPosition.amount * currentPrice > riskConfig.maxTradeUSD * 2) {
          log(`PosiciÃ³n existente en ${pair} ya es grande: $${(existingPosition.amount * currentPrice).toFixed(2)}`, "trading");
          await botLogger.info("TRADE_SKIPPED", `SeÃ±al BUY ignorada - posiciÃ³n existente demasiado grande`, {
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
          await botLogger.info("TRADE_SKIPPED", `SeÃ±al BUY ignorada - fondos insuficientes`, {
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
        
        // === CÃLCULO DE TAMAÃ‘O DE ORDEN (tradeAmountUSD) - UNIFICADO CON analyzePairAndTrade ===
        let tradeAmountUSD: number;
        let wasAdjusted = false;
        let originalAmount: number;
        let sgReasonCode: SmartGuardReasonCode | undefined;
        
        // SMART_GUARD: obtener parÃ¡metros
        const sgParams = positionMode === "SMART_GUARD" ? this.getSmartGuardParams(pair, botConfig) : null;
        const sgMinEntryUsd = sgParams?.sgMinEntryUsd || 100;
        const sgAllowUnderMin = sgParams?.sgAllowUnderMin ?? true;
        const sgFeeCushionPct = sgParams?.sgFeeCushionPct || 0;
        const sgFeeCushionAuto = sgParams?.sgFeeCushionAuto ?? false;
        
        // Calcular fee cushion efectivo (auto = round-trip fees + slippage buffer)
        const effectiveCushionPct = sgFeeCushionAuto ? getRoundTripWithBufferPct() : sgFeeCushionPct;
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
          
          log(`SMART_GUARD ${pair} [${selectedStrategyId}]: Sizing v2 - order=$${tradeAmountUSD.toFixed(2)}, reason=${sgReasonCode}`, "trading");
          log(`  â†’ availableUsd=$${usdDisponible.toFixed(2)}, sgMinEntryUsd=$${sgMinEntryUsd.toFixed(2)}, floorUsd=$${floorUsd.toFixed(2)}`, "trading");
          log(`  â†’ cushionPct=${effectiveCushionPct.toFixed(2)}%, cushionAmt=$${cushionAmount.toFixed(2)}, availableAfterCushion=$${availableAfterCushion.toFixed(2)}`, "trading");
          
          // Fix coherencia: allowSmallerEntries siempre true en SMART_GUARD (auto fallback)
          this.updatePairTrace(pair, {
            allowSmallerEntries: true,
            computedOrderUsd: tradeAmountUSD,
            minOrderUsd: floorUsd,
          });
          
          // === ROUTER: Apply TRANSITION sizing factor (50% by default) ===
          if (currentRegimeForSizing === "TRANSITION" && routerEnabledForSizing) {
            const transitionSizeFactor = (botConfigCheck as any)?.transitionSizeFactor ?? 0.5;
            const originalBeforeTransition = tradeAmountUSD;
            tradeAmountUSD = tradeAmountUSD * transitionSizeFactor;
            log(`[ROUTER] ${pair}: TRANSITION sizing override: $${originalBeforeTransition.toFixed(2)} â†’ $${tradeAmountUSD.toFixed(2)} (${(transitionSizeFactor * 100).toFixed(0)}%)`, "trading");
          }
        } else {
          // Modos SINGLE/DCA: lÃ³gica original
          const profitCheck = this.isProfitableAfterFees(takeProfitPct);
          if (!profitCheck.isProfitable) {
            log(`${pair}: Trade rechazado - Take-Profit (${takeProfitPct}%) < mÃ­nimo rentable`, "trading");
            await botLogger.info("TRADE_SKIPPED", `SeÃ±al BUY ignorada - take-profit menor que fees`, {
              pair,
              signal: "BUY",
              reason: "LOW_PROFITABILITY",
              takeProfitPct,
              roundTripFees: profitCheck.roundTripFees,
              minProfitRequired: profitCheck.minProfitRequired,
              strategyId: selectedStrategyId,
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
          log(`${pair}: Sin exposiciÃ³n disponible`, "trading");
          await botLogger.info("TRADE_SKIPPED", `SeÃ±al BUY ignorada - sin exposiciÃ³n disponible`, {
            pair,
            signal: "BUY",
            reason: "EXPOSURE_ZERO",
            exposureAvailable: effectiveMaxAllowed,
            minRequiredUsd: minRequiredUSD,
          });
          this.setPairCooldown(pair);
          return;
        }

        // Ajustar por lÃ­mite de exposiciÃ³n (solo para SINGLE/DCA)
        if (positionMode !== "SMART_GUARD" && tradeAmountUSD > effectiveMaxAllowed) {
          originalAmount = tradeAmountUSD;
          tradeAmountUSD = effectiveMaxAllowed;
          wasAdjusted = true;
        }

        const tradeVolume = tradeAmountUSD / currentPrice;

        // SAFETY: Validate volume is finite before proceeding (prevents Infinity/NaN in placeOrder)
        if (!Number.isFinite(tradeVolume) || tradeVolume <= 0) {
          log(`[ORDER_SKIPPED_INVALID_NUMBER] ${pair}: tradeVolume=${tradeVolume}, orderUsd=${tradeAmountUSD}, price=${currentPrice}`, "trading");
          await botLogger.warn("ORDER_SKIPPED_INVALID_NUMBER", `Volume invalido - posible division por cero`, {
            pair,
            tradeVolume,
            tradeAmountUSD,
            currentPrice,
            strategyId: selectedStrategyId,
          });
          return;
        }

        if (tradeVolume < minVolume) {
          log(`${pair}: Volumen ${tradeVolume.toFixed(8)} < mÃ­nimo ${minVolume}`, "trading");
          await botLogger.info("TRADE_SKIPPED", `SeÃ±al BUY ignorada - volumen < mÃ­nimo`, {
            pair,
            signal: "BUY",
            reason: "VOLUME_BELOW_MINIMUM",
            calculatedVolume: tradeVolume,
            minVolume,
            strategyId: selectedStrategyId,
          });
          this.setPairCooldown(pair);
          return;
        }

        const adjustmentInfo = wasAdjusted ? {
          wasAdjusted: true,
          originalAmountUsd: originalAmount,
          adjustedAmountUsd: tradeAmountUSD
        } : undefined;

        // Build strategyMeta with regime info for Telegram notifications
        const strategyMetaCandles = {
          strategyId: selectedStrategyId,
          timeframe,
          confidence: signal.confidence,
          regime: currentRegimeForSizing || undefined,
          regimeReason: currentRegimeReasonForTelegram || undefined,
          routerStrategy: routerEnabledForSizing ? selectedStrategyId : undefined,
        };

        const hgCfg = this.getHybridGuardConfig();
        const hgInfo = (signal as any)?.hybridGuard as { watchId: number; reason: "ANTI_CRESTA" | "MTF_STRICT" } | undefined;
        if (hgCfg?.enabled && hgInfo && this.telegramService.isInitialized()) {
          const alerts = hgCfg?.alerts;
          if (alerts?.enabled !== false && alerts?.reentrySignal !== false) {
            this.telegramService.sendHybridGuardReentrySignal({
              pair,
              exchange: this.getTradingExchangeType(),
              reason: hgInfo.reason,
              watchId: hgInfo.watchId,
              currentPrice,
            }).catch((e: any) => log(`[ALERT_ERR] sendHybridGuardReentrySignal: ${e?.message ?? String(e)}`, 'trading'));
          }
        }

        const executionMetaCandles: any = {
          mode: positionMode,
          usdDisponible: freshUsdBalance,
          orderUsdProposed: originalAmount || tradeAmountUSD,
          orderUsdFinal: tradeAmountUSD,
          sgMinEntryUsd,
          sgAllowUnderMin_DEPRECATED: sgAllowUnderMin,
          dryRun: this.dryRunMode,
          env: environment.envTag,
          hybridGuard: hgInfo ? { watchId: hgInfo.watchId, reason: hgInfo.reason } : undefined,
        };

        const success = await this.executeTrade(
          pair, 
          "buy", 
          tradeVolume.toFixed(8), 
          currentPrice, 
          `${signal.reason} [${selectedStrategyId}]`, 
          adjustmentInfo,
          strategyMetaCandles,
          executionMetaCandles
        );

        if (success && !this.dryRunMode && hgCfg?.enabled && hgInfo) {
          try {
            await storage.markHybridReentryWatchTriggered({
              id: hgInfo.watchId,
              metaPatch: {
                triggerPrice: currentPrice,
                triggerVolume: tradeVolume.toFixed(8),
                triggeredAt: new Date().toISOString(),
                triggeredReason: hgInfo.reason,
              },
            });
          } catch (e: any) {
            log(`[HYBRID_GUARD] markTriggered error: ${e?.message ?? String(e)}`, 'trading');
          }

          if (this.telegramService.isInitialized()) {
            const alerts = hgCfg?.alerts;
            if (alerts?.enabled !== false && alerts?.orderExecuted !== false) {
              this.telegramService.sendHybridGuardOrderExecuted({
                pair,
                exchange: this.getTradingExchangeType(),
                reason: hgInfo.reason,
                watchId: hgInfo.watchId,
                price: currentPrice,
                volume: tradeVolume.toFixed(8),
              }).catch((e: any) => log(`[ALERT_ERR] sendHybridGuardOrderExecuted: ${e?.message ?? String(e)}`, 'trading'));
            }
          }
        }
        
        if (success) {
          this.lastTradeTime.set(pair, Date.now());
        }

      } else if (signal.action === "sell") {
        // PRIMERO: Verificar si hay posiciÃ³n para vender (antes de cualquier lÃ³gica SMART_GUARD)
        if (assetBalance <= 0 && (!existingPosition || existingPosition.amount <= 0)) {
          await botLogger.info("TRADE_SKIPPED", `SeÃ±al SELL ignorada - sin posiciÃ³n para vender`, {
            pair,
            signal: "SELL",
            reason: "NO_POSITION",
            assetBalance,
            strategyId: selectedStrategyId,
            signalReason: signal.reason,
          });
          this.updatePairTrace(pair, {
            smartGuardDecision: "SKIP",
            blockReasonCode: "NO_POSITION",
            blockDetails: { assetBalance, strategyId: selectedStrategyId },
            finalSignal: "NONE",
            finalReason: "Sin posiciÃ³n para vender",
          });
          this.emitPairDecisionTrace(pair);
          return;
        }
        
        // A2: SMART_GUARD bloquea SELL por seÃ±al - solo risk exits permiten vender
        // EXCEPCIÃ“N: Permitir liquidaciÃ³n de huÃ©rfanos (balance > 0 sin posiciÃ³n trackeada)
        const botConfigSellCandles = await storage.getBotConfig();
        const positionModeSellCandles = botConfigSellCandles?.positionMode || "SINGLE";
        const isOrphanCleanupCandles = assetBalance > 0 && (!existingPosition || existingPosition.amount <= 0);
        
        if (positionModeSellCandles === "SMART_GUARD" && !isOrphanCleanupCandles) {
          await botLogger.info("TRADE_SKIPPED", `SeÃ±al SELL bloqueada en SMART_GUARD - solo risk exits permiten vender`, {
            pair,
            signal: "SELL",
            reason: "SMART_GUARD_SIGNAL_SELL_BLOCKED",
            strategyId: selectedStrategyId,
            signalReason: signal.reason,
          });
          this.updatePairTrace(pair, {
            smartGuardDecision: "BLOCK",
            blockReasonCode: "SELL_BLOCKED",
            blockDetails: { reason: "SMART_GUARD solo permite risk exits", strategyId: selectedStrategyId },
            finalSignal: "NONE",
            finalReason: "SELL bloqueado: Solo SL/TP/Trailing permiten vender",
          });
          this.emitPairDecisionTrace(pair);
          return;
        }

        // === FIX: Vender lote completo, no 50% ===
        // Si no hay lot trackeado, usar balance real del wallet
        let lotAmount = existingPosition?.amount ?? assetBalance;
        
        // ReconciliaciÃ³n hacia ARRIBA (SINGLE/DCA) antes de SELL por seÃ±al en candles
        let realAssetBalance = assetBalance;
        if (existingPosition?.lotId) {
          try {
            const freshBalances = await this.getTradingExchange().getBalance();
            realAssetBalance = this.getAssetBalance(pair, freshBalances);
          } catch (balErr: any) {
            log(`${pair}: Error obteniendo balance fresco para reconciliaciÃ³n SELL (candles): ${balErr.message}`, "trading");
          }
          if (realAssetBalance > lotAmount * 1.005) {
            const extraAmount = realAssetBalance - lotAmount;
            const extraValueUsd = extraAmount * currentPrice;
            if (extraValueUsd <= DUST_THRESHOLD_USD) {
              log(`ðŸ”„ ReconciliaciÃ³n (UP) pre-SELL seÃ±al (candles) en ${pair} (${existingPosition.lotId}): lot=${lotAmount} real=${realAssetBalance}`, "trading");
              existingPosition.amount = realAssetBalance;
              this.openPositions.set(existingPosition.lotId, existingPosition);
              await this.savePositionToDB(pair, existingPosition);
              await botLogger.info("POSITION_RECONCILED", `PosiciÃ³n reconciliada (UP) antes de SELL por seÃ±al (candles) en ${pair}`, {
                pair,
                lotId: existingPosition.lotId,
                direction: "UP",
                registeredAmount: lotAmount,
                realBalance: realAssetBalance,
                extraValueUsd,
                trigger: "SIGNAL_SELL_CANDLES",
              });
              lotAmount = existingPosition.amount;
            } else {
              log(`âš ï¸ Balance real mayor al lote en ${pair} (${existingPosition.lotId}) pero parece HOLD externo (extra $${extraValueUsd.toFixed(2)}). Ignorando reconciliaciÃ³n UP.`, "trading");
            }
          }
        }

        const rawSellVolume = Math.min(lotAmount, realAssetBalance);
        const sellVolume = this.normalizeVolume(pair, rawSellVolume);
        
        const minVolumeSell = this.getOrderMin(pair);
        const sellValueUsd = sellVolume * currentPrice;

        // === DUST DETECTION ===
        if (sellVolume < minVolumeSell) {
          await botLogger.info("TRADE_SKIPPED", `SELL skipped - dust position (volumen < mÃ­nimo)`, {
            pair,
            signal: "SELL",
            reason: "DUST_POSITION",
            lotAmount,
            realAssetBalance,
            sellVolume,
            minVolume: minVolumeSell,
            sellValueUsd,
            strategyId: selectedStrategyId,
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
            strategyId: selectedStrategyId,
          });
          return;
        }

        log(`${pair}: SELL signal [${selectedStrategyId}] - vendiendo ${sellVolume.toFixed(8)} (value: $${sellValueUsd.toFixed(2)})`, "trading");

        const sellContext = existingPosition 
          ? { entryPrice: existingPosition.entryPrice, aiSampleId: existingPosition.aiSampleId, openedAt: existingPosition.openedAt }
          : undefined;
        const success = await this.executeTrade(pair, "sell", sellVolume.toFixed(8), currentPrice, `${signal.reason} [${selectedStrategyId}]`, undefined, undefined, undefined, sellContext);
        if (success) {
          if (existingPosition?.lotId) {
            this.openPositions.delete(existingPosition.lotId);
            await this.deletePositionFromDBByLotId(existingPosition.lotId);
          }
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
        return { action: "hold", pair, confidence: 0.3, reason: `SeÃ±al filtrada por MTF: ${mtfBoost.reason}` };
      }
      signal.confidence = Math.min(0.95, signal.confidence + mtfBoost.confidenceBoost);
      signal.reason += ` | MTF: ${mtfAnalysis.summary}`;
    }

    return signal;
  }

  private applyMTFFilter(
    signal: TradeSignal, 
    mtf: TrendAnalysis, 
    regime?: MarketRegime | string | null
  ): { filtered: boolean; confidenceBoost: number; reason: string; filterType?: "MTF_STRICT" | "MTF_STANDARD" } {
    if (signal.action === "buy") {
      // === MTF ESTRICTO POR RÃ‰GIMEN (Fase 2.4) ===
      // En TRANSITION: exigir MTF >= 0.3 para compras
      // En RANGE: exigir MTF >= 0.2 para compras
      // Esto evita compras contra tendencia mayor en regÃ­menes inestables
      if (regime === "TRANSITION" && mtf.alignment < 0.3) {
        return { 
          filtered: true, 
          confidenceBoost: 0, 
          reason: `MTF insuficiente en TRANSITION (${mtf.alignment.toFixed(2)} < 0.30)`,
          filterType: "MTF_STRICT"
        };
      }
      if (regime === "RANGE" && mtf.alignment < 0.2) {
        return { 
          filtered: true, 
          confidenceBoost: 0, 
          reason: `MTF insuficiente en RANGE (${mtf.alignment.toFixed(2)} < 0.20)`,
          filterType: "MTF_STRICT"
        };
      }
      
      // Filtros estÃ¡ndar existentes
      if (mtf.longTerm === "bearish" && mtf.mediumTerm === "bearish") {
        return { filtered: true, confidenceBoost: 0, reason: "Tendencia 1h y 4h bajista", filterType: "MTF_STANDARD" };
      }
      if (mtf.alignment < -0.5) {
        return { filtered: true, confidenceBoost: 0, reason: `AlineaciÃ³n MTF negativa (${mtf.alignment.toFixed(2)})`, filterType: "MTF_STANDARD" };
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
        return { filtered: true, confidenceBoost: 0, reason: `AlineaciÃ³n MTF positiva (${mtf.alignment.toFixed(2)})` };
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
    const buyReasons: string[] = [];
    const sellReasons: string[] = [];

    if (shortEMA > longEMA) { buySignals++; buyReasons.push("EMA10>EMA20"); }
    else if (shortEMA < longEMA) { sellSignals++; sellReasons.push("EMA10<EMA20"); }

    if (rsi < 30) { buySignals += 2; buyReasons.push(`RSI sobrevendido (${rsi.toFixed(0)})`); }
    else if (rsi < 45) { buySignals++; }
    else if (rsi > 70) { sellSignals += 2; sellReasons.push(`RSI sobrecomprado (${rsi.toFixed(0)})`); }
    else if (rsi > 55) { sellSignals++; }

    if (macd.histogram > 0 && macd.macd > macd.signal) { buySignals++; buyReasons.push("MACD alcista"); }
    else if (macd.histogram < 0 && macd.macd < macd.signal) { sellSignals++; sellReasons.push("MACD bajista"); }

    if (bollinger.percentB < 20) { buySignals++; buyReasons.push("Precio cerca de Bollinger inferior"); }
    else if (bollinger.percentB > 80) { sellSignals++; sellReasons.push("Precio cerca de Bollinger superior"); }

    if (volumeAnalysis.isAbnormal) {
      if (volumeAnalysis.direction === "bullish") { buySignals++; buyReasons.push(`Volumen alto alcista (${volumeAnalysis.ratio.toFixed(1)}x)`); }
      else if (volumeAnalysis.direction === "bearish") { sellSignals++; sellReasons.push(`Volumen alto bajista (${volumeAnalysis.ratio.toFixed(1)}x)`); }
    }

    if (trend > 1) { buySignals++; buyReasons.push("Tendencia alcista"); }
    else if (trend < -1) { sellSignals++; sellReasons.push("Tendencia bajista"); }

    const confidence = Math.min(0.95, 0.5 + (Math.max(buySignals, sellSignals) * 0.08));
    const minSignalsRequired = 5; // TREND/TRANSITION require 5 signals (aligned with SMART_GUARD B3)
    
    if (buySignals >= minSignalsRequired && buySignals > sellSignals && rsi < 70) {
      return {
        action: "buy",
        pair,
        confidence,
        reason: `Momentum alcista: ${buyReasons.join(", ")} | SeÃ±ales: ${buySignals}/${sellSignals}`,
        signalsCount: buySignals,
        minSignalsRequired,
      };
    }
    
    if (sellSignals >= minSignalsRequired && sellSignals > buySignals && rsi > 30) {
      return {
        action: "sell",
        pair,
        confidence,
        reason: `Momentum bajista: ${sellReasons.join(", ")} | SeÃ±ales: ${sellSignals}/${buySignals}`,
        signalsCount: sellSignals,
        minSignalsRequired,
      };
    }

    // No signal: provide detailed diagnostic reason
    const dominantCount = Math.max(buySignals, sellSignals);
    const dominantSide = buySignals >= sellSignals ? "buy" : "sell";
    
    // Determine the actual blocking reason
    let blockReason = "";
    if (dominantCount < minSignalsRequired) {
      blockReason = `seÃ±ales insuficientes (${dominantCount}/${minSignalsRequired})`;
    } else if (dominantSide === "buy" && rsi >= 70) {
      blockReason = `RSI muy alto (${rsi.toFixed(0)}>=70) bloquea compra`;
    } else if (dominantSide === "sell" && rsi <= 30) {
      blockReason = `RSI muy bajo (${rsi.toFixed(0)}<=30) bloquea venta`;
    } else if (buySignals === sellSignals) {
      blockReason = `conflicto buy/sell (${buySignals}=${sellSignals})`;
    } else {
      blockReason = `sin dominancia clara`;
    }
    
    return { 
      action: "hold", 
      pair, 
      confidence: 0.3, 
      reason: `Sin seÃ±al clara momentum: ${blockReason} | buy=${buySignals}/sell=${sellSignals}`,
      signalsCount: dominantCount,
      minSignalsRequired,
    };
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

    // Mean Reversion uses threshold-based signals, not count-based
    // signalsCount=1 means threshold triggered, signalsCount=0 means not triggered
    const minSignalsRequired = 1;

    if (zScore < -2 || bollinger.percentB < 5) {
      confidence += 0.15;
      reasons.push(`Extremadamente sobrevendido (Z=${zScore.toFixed(2)}, %B=${bollinger.percentB.toFixed(0)})`);
      
      if (rsi < 25) { confidence += 0.1; reasons.push(`RSI muy bajo (${rsi.toFixed(0)})`); }
      if (volumeAnalysis.isAbnormal && volumeAnalysis.direction === "bearish") {
        confidence += 0.05;
        reasons.push("Volumen de capitulaciÃ³n");
      }
      
      return {
        action: "buy",
        pair,
        confidence: Math.min(0.95, confidence),
        reason: `Mean Reversion COMPRA: ${reasons.join(", ")}`,
        signalsCount: 1,
        minSignalsRequired,
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
        signalsCount: 1,
        minSignalsRequired,
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
        signalsCount: 1,
        minSignalsRequired,
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
        signalsCount: 1,
        minSignalsRequired,
      };
    }

    return { 
      action: "hold", 
      pair, 
      confidence: 0.3, 
      reason: `Precio en rango normal: Z=${zScore.toFixed(2)} (umbral: |Z|>1.5)`,
      signalsCount: 0,
      minSignalsRequired,
    };
  }

  private scalpingStrategy(pair: string, history: PriceData[], currentPrice: number): TradeSignal {
    // Scalping uses threshold-based signals
    const minSignalsRequired = 1;
    
    if (history.length < 15) {
      return { action: "hold", pair, confidence: 0, reason: "Datos insuficientes para scalping", signalsCount: 0, minSignalsRequired };
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

    // Filtro de volatilidad mÃ­nima usando ATR
    if (atrPercent < 0.1) {
      return { action: "hold", pair, confidence: 0.2, reason: `Volatilidad ATR muy baja (${atrPercent.toFixed(2)}%)`, signalsCount: 0, minSignalsRequired };
    }

    // Ajustar umbral de entrada basado en ATR
    const entryThreshold = Math.max(0.2, atrPercent * 0.3);

    if (priceChange < -entryThreshold && volatility > 0.15) {
      reasons.push(`CaÃ­da rÃ¡pida ${priceChange.toFixed(2)}%`);
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
      // Bonus de confianza si ATR es alto (mÃ¡s oportunidad de profit)
      if (atrPercent > 0.5) {
        confidence += 0.05;
      }
      
      return {
        action: "buy",
        pair,
        confidence: Math.min(0.9, confidence),
        reason: `Scalping COMPRA: ${reasons.join(", ")}`,
        signalsCount: 1,
        minSignalsRequired,
      };
    }
    
    if (priceChange > entryThreshold && volatility > 0.15) {
      reasons.push(`Subida rÃ¡pida +${priceChange.toFixed(2)}%`);
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
        signalsCount: 1,
        minSignalsRequired,
      };
    }

    return { 
      action: "hold", 
      pair, 
      confidence: 0.3, 
      reason: `Sin oportunidad: cambio=${priceChange.toFixed(2)}% (umbral=${entryThreshold.toFixed(2)}%), ATR=${atrPercent.toFixed(2)}%`,
      signalsCount: 0,
      minSignalsRequired,
    };
  }

  private gridStrategy(pair: string, history: PriceData[], currentPrice: number): TradeSignal {
    // Grid uses level-based signals
    const minSignalsRequired = 1;
    
    if (history.length < 15) {
      return { action: "hold", pair, confidence: 0, reason: "Datos insuficientes para grid", signalsCount: 0, minSignalsRequired };
    }

    const prices = history.map(h => h.price);
    const high = Math.max(...prices);
    const low = Math.min(...prices);
    
    // Usar ATR para determinar el espaciado del grid dinÃ¡micamente
    const atr = this.calculateATR(history, 14);
    const atrPercent = this.calculateATRPercent(history, 14);
    
    // El grid size se basa en ATR para adaptarse a la volatilidad del mercado
    // Usamos 1.5x ATR como espaciado entre niveles del grid
    const atrBasedGridSize = atr * 1.5;
    const rangeBasedGridSize = (high - low) / 5;
    
    // Usamos el mayor de los dos para evitar niveles demasiado cercanos
    const gridSize = Math.max(atrBasedGridSize, rangeBasedGridSize);
    
    if (gridSize <= 0) {
      return { action: "hold", pair, confidence: 0, reason: "Grid size invÃ¡lido", signalsCount: 0, minSignalsRequired };
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
        signalsCount: 1,
        minSignalsRequired,
      };
    }
    
    if (currentPrice >= resistanceLevel && levelFromMid > prevLevelFromMid) {
      return {
        action: "sell",
        pair,
        confidence: Math.min(0.85, confidence),
        reason: `Grid ATR: Precio en resistencia $${resistanceLevel.toFixed(2)} (ATR: ${atrPercent.toFixed(2)}%, nivel: ${levelFromMid})`,
        signalsCount: 1,
        minSignalsRequired,
      };
    }

    return { 
      action: "hold", 
      pair, 
      confidence: 0.3, 
      reason: `Grid: nivel=${levelFromMid}, ATR=${atrPercent.toFixed(2)}%, precio entre soporte/resistencia`,
      signalsCount: 0,
      minSignalsRequired,
    };
  }

  // === TECHNICAL INDICATORS (delegated to indicators.ts) ===
  private calculateEMA(prices: number[], period: number): number { return _calculateEMA(prices, period); }
  private calculateRSI(prices: number[]): number { return _calculateRSI(prices); }
  private calculateVolatility(prices: number[]): number { return _calculateVolatility(prices); }
  private calculateMACD(prices: number[]): { macd: number; signal: number; histogram: number } { return _calculateMACD(prices); }
  private calculateBollingerBands(prices: number[], period: number = 20, stdDevMultiplier: number = 2): { upper: number; middle: number; lower: number; percentB: number } { return _calculateBollingerBands(prices, period, stdDevMultiplier); }
  private calculateATR(history: PriceData[], period: number = 14): number { return _calculateATR(history, period); }
  private calculateATRPercent(history: PriceData[], period: number = 14): number { return _calculateATRPercent(history, period); }
  private detectAbnormalVolume(history: PriceData[]): { isAbnormal: boolean; ratio: number; direction: string } { return _detectAbnormalVolume(history); }

  // === MARKET REGIME DETECTION ===
  private wilderSmooth(values: number[], period: number): number[] { return _wilderSmooth(values, period); }
  private calculateADX(candles: OHLCCandle[], period: number = 14): number { return _calculateADX(candles, period); }

  // === REGIME DETECTION (delegated to regimeDetection.ts) ===
  private detectMarketRegime(candles: OHLCCandle[]): RegimeAnalysis { return _detectMarketRegime(candles); }
  private getRegimeAdjustedParams(baseParams: { sgBeAtPct: number; sgTrailDistancePct: number; sgTrailStepPct: number; sgTpFixedPct: number }, regime: MarketRegime, regimeEnabled: boolean) { return _getRegimeAdjustedParams(baseParams, regime, regimeEnabled); }
  private calculateAtrBasedExits(pair: string, entryPrice: number, atrPercent: number, regime: MarketRegime, adaptiveEnabled: boolean, historyLength: number = 0, minBeFloorPct: number = 2.0) { return _calculateAtrBasedExits(pair, entryPrice, atrPercent, regime, adaptiveEnabled, historyLength, minBeFloorPct); }

  // === REGIME STATEFUL METHODS (delegated to RegimeManager) ===
  private async getMarketRegimeWithCache(pair: string): Promise<RegimeAnalysis> { return this.regimeManager.getMarketRegimeWithCache(pair); }
  getRegimeMinSignals(regime: MarketRegime, baseMinSignals: number): number { return this.regimeManager.getRegimeMinSignals(regime, baseMinSignals); }

  private setupConfigListener(): void {
    // Listen for configuration changes from ConfigService
    configService.on('config:activated', async ({ configId }) => {
      log(`[CONFIG] Configuration activated: ${configId}, reloading...`, "trading");
      await this.loadDynamicConfig();
    });

    configService.on('config:updated', async ({ configId }) => {
      log(`[CONFIG] Configuration updated: ${configId}, reloading...`, "trading");
      await this.loadDynamicConfig();
    });
  }

  async loadDynamicConfig(): Promise<void> {
    try {
      const config = await configService.getActiveConfig();
      if (config) {
        this.dynamicConfig = config;
        this.regimeManager.setDynamicConfig(config);
        
        // Apply global configuration
        if (config.global) {
          // Update dry run mode if not in Replit
          if (!this.isReplitEnvironment) {
            this.dryRunMode = config.global.dryRunMode;
            log(`[CONFIG] DryRunMode updated: ${this.dryRunMode}`, "trading");
          }
        }
        
        log(`[CONFIG] Dynamic configuration loaded successfully`, "trading");
        
        await botLogger.info("CONFIG_LOADED", "Dynamic configuration loaded", {
          hasSignals: !!config.signals,
          hasExchanges: !!config.exchanges,
          hasGlobal: !!config.global,
          dryRunMode: this.dryRunMode,
          env: environment.envTag,
        });
      } else {
        log(`[CONFIG] No active configuration found, using defaults`, "trading");
      }
    } catch (error) {
      console.error('[tradingEngine] Error loading dynamic config:', error);
      log(`[CONFIG] Failed to load dynamic config, using defaults`, "trading");
      this.dynamicConfig = null;
      this.regimeManager.setDynamicConfig(null);
    }
  }

  shouldPauseEntriesDueToRegime(regime: MarketRegime, regimeEnabled: boolean): boolean {
    return _shouldPauseEntriesDueToRegime(regime, regimeEnabled);
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

  // === PAIR_DECISION_TRACE: Helpers ===
  private initPairTrace(pair: string, exposureAvailable: number, isIntermediateCycle: boolean = true): void {
    // En ciclos intermedios, usar datos cacheados del Ãºltimo anÃ¡lisis completo
    const cached = this.lastFullAnalysisCache.get(pair);
    
    const trace: DecisionTraceContext = {
      scanId: this.currentScanId,
      scanTime: new Date(this.lastScanStartTime).toISOString(),
      pair,
      // Usar cache en ciclos intermedios, null si no hay cache
      regime: isIntermediateCycle && cached ? cached.regime : null,
      regimeReason: isIntermediateCycle && cached ? `${cached.regimeReason} (cached)` : null,
      selectedStrategy: isIntermediateCycle && cached ? cached.selectedStrategy : null,
      rawSignal: "NONE",
      rawReason: isIntermediateCycle 
        ? (cached ? `Ciclo intermedio - sin vela 15m cerrada (Ãºltimo: ${cached.rawReason})` : "Ciclo intermedio - sin datos previos")
        : null,
      signalsCount: isIntermediateCycle && cached ? cached.signalsCount : null,
      minSignalsRequired: isIntermediateCycle && cached ? cached.minSignalsRequired : null,
      exposureAvailableUsd: exposureAvailable,
      computedOrderUsd: 0,
      minOrderUsd: 100,
      allowSmallerEntries: false,
      openLotsThisPair: this.getOpenLotsForPair(pair),
      maxLotsPerPair: 2,
      smartGuardDecision: "NOOP",
      blockReasonCode: "NO_SIGNAL",
      blockDetails: null,
      finalSignal: "NONE",
      finalReason: isIntermediateCycle ? "Ciclo intermedio - sin vela 15m cerrada" : "Sin seÃ±al en este ciclo",
      // Campos de diagnÃ³stico para ciclos intermedios
      isIntermediateCycle,
      lastCandleClosedAt: cached?.candleClosedAt || null,
      lastFullEvaluationAt: cached?.evaluatedAt || null,
      lastRegimeUpdateAt: cached?.regimeUpdatedAt || null,
      // Campos de observabilidad Router FASE 1 - usar cache en ciclos intermedios
      regimeRouterEnabled: isIntermediateCycle && cached ? cached.regimeRouterEnabled ?? null : null,
      feeCushionEffectivePct: isIntermediateCycle && cached ? cached.feeCushionEffectivePct ?? null : null,
    };
    this.pairDecisionTrace.set(pair, trace);
  }
  
  // Guardar datos del anÃ¡lisis completo para reutilizar en ciclos intermedios
  private cacheFullAnalysis(pair: string, data: {
    regime: string;
    regimeReason: string;
    selectedStrategy: string;
    signalsCount: number;
    minSignalsRequired: number;
    rawReason: string;
    candleClosedAt: string;
    regimeRouterEnabled?: boolean;
    feeCushionEffectivePct?: number | null;
  }): void {
    this.lastFullAnalysisCache.set(pair, {
      ...data,
      evaluatedAt: new Date().toISOString(),
      regimeUpdatedAt: new Date().toISOString(),
    });
  }

  private updatePairTrace(pair: string, updates: Partial<DecisionTraceContext>): void {
    const existing = this.pairDecisionTrace.get(pair);
    if (existing) {
      this.pairDecisionTrace.set(pair, { ...existing, ...updates });
    }
  }

  private emitPairDecisionTrace(pair: string): void {
    const trace = this.pairDecisionTrace.get(pair);
    if (!trace) return;
    
    // Detectar blockReasonCode especÃ­fico basado en finalReason
    let derivedBlockCode = trace.blockReasonCode || "NO_SIGNAL";
    const reason = trace.finalReason || trace.rawReason || "";
    
    // Si es NO_SIGNAL pero la razÃ³n indica RSI block, usar cÃ³digo especÃ­fico
    if (derivedBlockCode === "NO_SIGNAL") {
      if (reason.includes("RSI muy alto") || reason.includes("bloquea compra") || reason.includes(">=70")) {
        derivedBlockCode = "RSI_OVERBOUGHT";
      } else if (reason.includes("RSI muy bajo") || reason.includes("bloquea venta") || reason.includes("<=30")) {
        derivedBlockCode = "RSI_OVERSOLD";
      }
    }
    
    // Asegurar que finalSignal y finalReason estÃ©n definidos
    const safeTrace: DecisionTraceContext = {
      ...trace,
      finalSignal: trace.finalSignal || "NONE",
      finalReason: trace.finalReason || "Sin seÃ±al en este ciclo",
      blockReasonCode: derivedBlockCode,
      smartGuardDecision: trace.smartGuardDecision || "NOOP",
    };
    
    log(`[PAIR_DECISION_TRACE] ${JSON.stringify(safeTrace)}`, "trading");
  }

  private getOpenLotsForPair(pair: string): number {
    let count = 0;
    for (const [lotId, pos] of this.openPositions) {
      if (pos.pair === pair && pos.amount > 0) count++;
    }
    return count;
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
    const stepSize = this.getTradingExchange().getStepSize(pair) || 0.00000001;
    const orderMin = this.getOrderMin(pair);
    
    // 1) Obtener balance real del asset base
    let freshBalances: any;
    try {
      freshBalances = await this.getTradingExchange().getBalance();
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
        reason: `Balance real (${realAssetBalance.toFixed(8)}) menor al mÃ­nimo de Kraken (${orderMin}). PosiciÃ³n marcada como DUST.`,
        isDust: true,
        realAssetBalance,
        orderMin,
        stepSize,
        needsPositionAdjust: false,
      };
    }
    
    // 5) Verificar si sellAmountFinal queda por debajo del mÃ­nimo tras normalizar
    if (sellAmountFinal < orderMin) {
      const logMsg = `[MANUAL_CLOSE_EVAL] ${pair} ${lotId} | lotAmount=${requestedAmount.toFixed(8)} realBalance=${realAssetBalance.toFixed(8)} orderMin=${orderMin} stepSize=${stepSize} sellFinal=${sellAmountFinal.toFixed(8)} decision=BELOW_MIN_AFTER_NORMALIZE`;
      log(logMsg, "trading");
      
      return {
        canSell: false,
        sellAmountFinal: 0,
        reason: `Cantidad normalizada (${sellAmountFinal.toFixed(8)}) menor al mÃ­nimo de Kraken (${orderMin}).`,
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
    strategyMeta?: { strategyId: string; timeframe: string; confidence: number; regime?: string; regimeReason?: string; routerStrategy?: string },
    executionMeta?: { mode: string; usdDisponible: number; orderUsdProposed: number; orderUsdFinal: number; sgMinEntryUsd: number; sgAllowUnderMin_DEPRECATED: boolean; dryRun: boolean; env?: string; floorUsd?: number; availableAfterCushion?: number; sgReasonCode?: SmartGuardReasonCode; minOrderUsd?: number; allowUnderMin?: boolean },
    sellContext?: { entryPrice: number; entryFee?: number; sellAmount?: number; positionAmount?: number; aiSampleId?: number; openedAt?: number | Date | null } // For sells: pass entry price and optional fee/amounts for accurate P&L tracking
  ): Promise<boolean> {
    try {
      // === VALIDACIÃ“N: Bloquear pares no-USD ===
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
      
      let volumeNum = parseFloat(volume);
      let totalUSD = volumeNum * price;
      
      // === PUNTO 2: Autocompletar strategyMeta desde posiciÃ³n si falta ===
      if (!strategyMeta?.strategyId || !strategyMeta?.timeframe) {
        // Buscar posiciones por par para heredar meta de la posiciÃ³n original
        const positions = this.getPositionsByPair(pair);
        let pos: OpenPosition | null = null;
        
        // Si hay mÃºltiples posiciones, usar la mÃ¡s antigua (FIFO)
        if (positions.length > 0) {
          pos = positions[0];
        }
        
        if (pos) {
          strategyMeta = {
            strategyId: pos.entryStrategyId ?? strategyMeta?.strategyId ?? "unknown",
            timeframe: pos.entrySignalTf ?? strategyMeta?.timeframe ?? "cycle",
            confidence: pos.signalConfidence ?? strategyMeta?.confidence ?? 0,
          };
          log(`[META] Autocompletado strategyMeta desde posiciÃ³n ${pos.lotId}: ${strategyMeta.strategyId}/${strategyMeta.timeframe}`, "trading");
        }
      }
      
      // === DRY_RUN MODE: Simular sin enviar orden real ===
      if (this.dryRunMode) {
        const envPrefix = `[${environment.envTag}][DRY\\_RUN]`;
        const envPrefixLog = `[${environment.envTag}][DRY_RUN]`;
        
        // === DOBLE CINTURÃ“N: ValidaciÃ³n redundante para DRY_RUN ===
        // Si falla mÃ­nimos, ni simula ni envÃ­a mensaje de trade
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
            // NO enviar Telegram de simulaciÃ³n - solo log
            return false;
          }
        }
        
        const simTxid = `DRY-${Date.now()}`;
        log(`${envPrefixLog} SIMULACIÃ“N ${type.toUpperCase()} ${volume} ${pair} @ $${price.toFixed(2)} (Total: $${totalUSD.toFixed(2)})`, "trading");
        
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
        
        // Enviar Telegram de simulaciÃ³n con prefijo correcto
        if (this.telegramService.isInitialized()) {
          const emoji = type === "buy" ? "ðŸŸ¢" : "ðŸ”´";
          const tipoLabel = type === "buy" ? "COMPRAR" : "VENDER";
          
          const subtype = type === "buy" ? "trade_buy" : "trade_sell";
          await this.telegramService.sendAlertWithSubtype(`ðŸ¤– <b>KRAKEN BOT</b> ðŸ‡ªðŸ‡¸
â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
ðŸ§ª <b>Trade Simulado</b> [DRY_RUN]

${emoji} <b>SEÃ‘AL: ${tipoLabel} ${pair}</b> ${emoji}

ðŸ’µ <b>Precio:</b> <code>$${price.toFixed(2)}</code>
ðŸ“¦ <b>Cantidad:</b> <code>${volume}</code>
ðŸ’° <b>Total:</b> <code>$${totalUSD.toFixed(2)}</code>

âš ï¸ Modo simulaciÃ³n - NO se enviÃ³ orden real
â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”`, "trades", subtype as any);
        }
        
        return true; // Simular Ã©xito para flujo normal
      }
      
      // C1: Validar sellContext ANTES de ejecutar orden real (excepto emergency exits)
      if (type === "sell" && !sellContext) {
        const isEmergencyExit = reason.toLowerCase().includes("stop-loss") || 
                                 reason.toLowerCase().includes("emergencia") ||
                                 reason.toLowerCase().includes("emergency");
        if (!isEmergencyExit) {
          log(`[ERROR] SELL BLOQUEADO sin sellContext para ${pair} - violaciÃ³n de trazabilidad. RazÃ³n: ${reason}`, "trading");
          await botLogger.warn("SELL_BLOCKED_NO_CONTEXT", `SELL bloqueado - sin sellContext`, {
            pair,
            type,
            volume,
            price,
            reason,
          });
          return false;
        }
        log(`[WARN] Emergency SELL sin sellContext para ${pair} - permitido. RazÃ³n: ${reason}`, "trading");
      }
      
      // CRITICAL: Generate correlation_id for full traceability
      const correlationId = `${Date.now()}-${pair.replace('/', '')}-${type}-${Math.random().toString(36).slice(2, 8)}`;
      
      // Generate clientOrderId for bot order attribution (used to match synced trades)
      const clientOrderId = crypto.randomUUID();
      const exchange = this.getTradingExchangeType();
      
      // PERSIST ORDER INTENT: Store intent BEFORE sending to exchange for attribution
      try {
        const hg = (executionMeta as any)?.hybridGuard as { watchId: number; reason: string } | undefined;
        await storage.createOrderIntent({
          clientOrderId,
          exchange,
          pair,
          side: type,
          volume: volume.toString(),
          hybridGuardWatchId: hg?.watchId,
          hybridGuardReason: hg?.reason,
          status: 'pending',
        });
        log(`[ORDER_INTENT_CREATED] ${correlationId} | clientOrderId=${clientOrderId}`, "trading");
      } catch (intentErr: any) {
        log(`[ORDER_INTENT_ERROR] ${correlationId} | Failed to persist order intent: ${intentErr.message}`, "trading");
        // Continue anyway - order attribution is best-effort
      }
      
      // ORDER_ATTEMPT: Log before execution for forensic traceability
      log(`[ORDER_ATTEMPT] ${correlationId} | ${type.toUpperCase()} ${volume} ${pair} @ $${price.toFixed(2)} via ${exchange}`, "trading");
      await botLogger.info("ORDER_ATTEMPT", `Attempting ${type.toUpperCase()} order`, {
        correlationId,
        clientOrderId,
        pair,
        type,
        volume,
        price,
        exchange,
        reason,
        telegramInitialized: this.telegramService.isInitialized(),
      });

      let preAssetBalance: number | null = null;
      if (type === "buy") {
        try {
          const preBalances = await this.getTradingExchange().getBalance();
          preAssetBalance = this.getAssetBalance(pair, preBalances);
        } catch (balErr: any) {
          log(`${pair}: Error obteniendo balance previo (preBalance) para BUY neto: ${balErr.message}`, "trading");
        }
      }
      
      const order = await this.getTradingExchange().placeOrder({
        pair,
        type,
        ordertype: "market",
        volume,
        clientOrderId, // Pass clientOrderId to exchange for matching
      });

      // CRITICAL: Validate order success before continuing
      if ((order as any)?.success === false) {
        const errorMsg = (order as any)?.error || 'Unknown error';
        log(`[ORDER_FAILED] ${correlationId} | ${pair} ${type.toUpperCase()}: ${errorMsg}`, "trading");
        await botLogger.error("ORDER_FAILED", `Failed to place ${type} order for ${pair}`, {
          correlationId,
          pair,
          type,
          volume,
          error: errorMsg,
          exchange
        });
        // Update order intent status to failed
        try {
          await storage.updateOrderIntentStatus(clientOrderId, 'failed');
        } catch (e) { /* best-effort */ }
        return false;
      }
      
      // FIX: Handle pendingFill case (order submitted but price not immediately available)
      // This is NOT a failure - the order was accepted by the exchange
      if ((order as any)?.pendingFill === true) {
        // CRITICAL: Extract the REAL exchange order ID - this is what FillWatcher needs to query getOrder()
        const exchangeOrderId = (order as any)?.orderId || (order as any)?.txid;
        const pendingOrderId = exchangeOrderId || clientOrderId; // Fallback only for logging
        
        // MANDATORY LOGGING: Track IDs for debugging PENDING_FILL â†’ FAILED issues
        log(`[ORDER_IDS] ${correlationId} | exchangeOrderId=${exchangeOrderId}, pendingOrderId=${pendingOrderId}, clientOrderId=${clientOrderId}`, "trading");
        if (!exchangeOrderId) {
          log(`[ORDER_ID_WARNING] ${correlationId} | No real exchange order ID returned! FillWatcher may fail to find fills.`, "trading");
        }
        
        // Update order intent status to accepted (pending fill)
        try {
          await storage.updateOrderIntentStatus(clientOrderId, 'accepted', pendingOrderId);
        } catch (e) { /* best-effort */ }
        
        log(`[ORDER_PENDING_FILL] ${correlationId} | ${pair} ${type.toUpperCase()} submitted (orderId=${pendingOrderId}, clientOrderId=${clientOrderId}). Will reconcile via sync.`, "trading");
        await botLogger.info("ORDER_PENDING_FILL", `Order submitted but fill not yet confirmed - will reconcile`, {
          correlationId,
          pair,
          type,
          volume,
          orderId: pendingOrderId,
          clientOrderId,
          exchange,
          telegramInitialized: this.telegramService.isInitialized(),
        });
        
        // === INSTANT POSITION: Create PENDING_FILL position immediately ===
        if (type === 'buy') {
          try {
            // Build config snapshot inline for PENDING_FILL position
            const currentConfig = await storage.getBotConfig();
            const entryModeSnapshot = currentConfig?.positionMode || 'SMART_GUARD';
            const configSnapshot: ConfigSnapshot = {
              stopLossPercent: parseFloat(currentConfig?.stopLossPercent?.toString() || "5"),
              takeProfitPercent: parseFloat(currentConfig?.takeProfitPercent?.toString() || "7"),
              trailingStopEnabled: currentConfig?.trailingStopEnabled ?? false,
              trailingStopPercent: parseFloat(currentConfig?.trailingStopPercent?.toString() || "2"),
              positionMode: entryModeSnapshot,
            };
            if (entryModeSnapshot === 'SMART_GUARD' && currentConfig) {
              const sgParams = this.getSmartGuardParams(pair, currentConfig);
              configSnapshot.sgMinEntryUsd = sgParams.sgMinEntryUsd;
              configSnapshot.sgBeAtPct = sgParams.sgBeAtPct;
              configSnapshot.sgTrailStartPct = sgParams.sgTrailStartPct;
              configSnapshot.sgTrailDistancePct = sgParams.sgTrailDistancePct;
            }
            const lotId = `engine-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            
            // Create position in PENDING_FILL state
            // CRITICAL: venueOrderId MUST be the real exchange order ID (not clientOrderId UUID)
            const venueOrderIdToStore = exchangeOrderId || pendingOrderId;
            const pendingPosition = await storage.createPendingPosition({
              lotId,
              exchange,
              pair,
              clientOrderId,
              venueOrderId: venueOrderIdToStore, // CRITICAL: Persist exchange order ID for FillWatcher queries
              expectedAmount: volume.toString(),
              entryMode: 'SMART_GUARD',
              configSnapshotJson: configSnapshot,
              entryStrategyId: 'momentum_cycle',
              signalReason: reason,
            });
            
            // MANDATORY LOGGING: Track position creation with all IDs
            log(`[POSITION_PENDING_FILL] ${correlationId} | Created PENDING_FILL position for ${pair} (lotId=${lotId}, clientOrderId=${clientOrderId}, venueOrderId=${venueOrderIdToStore})`, "trading");
            await botLogger.info("POSITION_PENDING_FILL", `Created PENDING_FILL position for ${pair}`, {
              correlationId,
              lotId,
              pair,
              clientOrderId,
              expectedAmount: volume,
            });
            
            // CRITICAL: Track pending exposure to prevent over-allocation
            const expectedUsd = parseFloat(volume) * price;
            this.addPendingExposure(lotId, pair, expectedUsd);
            
            // Emit WebSocket event for instant UI update
            try {
              const { positionsWs } = await import('./positionsWebSocket');
              positionsWs.emitPositionCreated(pendingPosition);
            } catch (wsErr: any) {
              log(`[WS_ERROR] ${correlationId} | Failed to emit position created: ${wsErr.message}`, "trading");
            }
            
            // === START FILL WATCHER: Monitor for fills ===
            try {
              const { startFillWatcher } = await import('./FillWatcher');
              startFillWatcher({
                clientOrderId,
                exchangeOrderId: pendingOrderId,
                exchange,
                pair,
                expectedAmount: parseFloat(volume),
                pollIntervalMs: 3000, // Poll every 3 seconds
                timeoutMs: 120000, // 2 minute timeout
                onFillReceived: (fill, position) => {
                  log(`[FILL_RECEIVED] ${pair}: +${fill.amount} @ $${fill.price}`, "trading");
                },
                onPositionOpen: (position) => {
                  log(`[POSITION_OPEN] ${pair}: Position fully filled, avgPrice=${position.averageEntryPrice}`, "trading");
                  // Remove pending exposure now that position is OPEN
                  this.removePendingExposure(lotId);
                },
                onTimeout: (coid) => {
                  log(`[FILL_WATCHER_TIMEOUT] ${pair}: No fills after 2 minutes (clientOrderId=${coid})`, "trading");
                  // Remove pending exposure on timeout (order may have failed)
                  this.removePendingExposure(lotId);
                },
              });
              log(`[FILL_WATCHER_STARTED] ${correlationId} | Started FillWatcher for ${pair}`, "trading");
            } catch (fwErr: any) {
              log(`[FILL_WATCHER_ERROR] ${correlationId} | Failed to start FillWatcher: ${fwErr.message}`, "trading");
              // Continue anyway - sync will handle it as backup
            }
          } catch (posErr: any) {
            log(`[POSITION_PENDING_ERROR] ${correlationId} | Failed to create PENDING_FILL position: ${posErr.message}`, "trading");
            // Continue anyway - sync will create position as backup
          }
        }
        // === END INSTANT POSITION ===

        // For SELL pendingFill: we do NOT create a pending position, but we MUST still start FillWatcher
        // to ensure the executed SELL is persisted to trades and matched to the order_intent.
        if (type === 'sell') {
          try {
            const { startFillWatcher } = await import('./FillWatcher');
            startFillWatcher({
              clientOrderId,
              exchangeOrderId: pendingOrderId,
              exchange,
              pair,
              expectedAmount: parseFloat(volume),
              pollIntervalMs: 3000,
              timeoutMs: 120000,
              onFillReceived: (fill) => {
                log(`[FILL_RECEIVED] ${pair}: ${fill.side} ${fill.amount} @ $${fill.price}`, 'trading');
              },
              onTimeout: (coid) => {
                log(`[FILL_WATCHER_TIMEOUT] ${pair}: No fills after 2 minutes (clientOrderId=${coid})`, 'trading');
              },
            });
            log(`[FILL_WATCHER_STARTED] ${correlationId} | Started FillWatcher for SELL ${pair}`, 'trading');
          } catch (fwErr: any) {
            log(`[FILL_WATCHER_ERROR] ${correlationId} | Failed to start FillWatcher for SELL: ${fwErr.message}`, 'trading');
          }
        }
        
        // Send Telegram notification about pending order
        if (this.telegramService.isInitialized()) {
          try {
            const assetName = pair.replace("/USD", "");
            const pendingFooter = type === "sell"
              ? `<i>La orden fue aceptada por ${exchange}. La venta se reflejarÃ¡ en historial y P&L en segundos.</i>`
              : `<i>La orden fue aceptada por ${exchange}. La posiciÃ³n aparecerÃ¡ en UI en segundos.</i>`;
            await this.telegramService.sendAlertWithSubtype(
              `â³ <b>Orden ${type.toUpperCase()} enviada</b>\n\n` +
              `Par: <code>${assetName}</code>\n` +
              `Cantidad: <code>${volume}</code>\n` +
              `Estado: Pendiente de confirmaciÃ³n\n` +
              `ID: <code>${pendingOrderId}</code>\n\n` +
              pendingFooter,
              "trades",
              type === "buy" ? "trade_buy" : "trade_sell"
            );
          } catch (tgErr: any) {
            log(`[TELEGRAM_FAIL] ${correlationId} | Error notificando orden pendiente: ${tgErr.message}`, "trading");
          }
        }
        
        // Return true because the order WAS submitted successfully
        // FillWatcher will update position when fills arrive
        return true;
      }
      const rawTxid = Array.isArray((order as any)?.txid)
        ? (order as any)?.txid?.[0]
        : (order as any)?.txid;
      const rawOrderId = (order as any)?.orderId;
      const externalOrderId = typeof rawOrderId === 'string' ? rawOrderId : undefined;
      const txid = typeof rawTxid === 'string' ? rawTxid : externalOrderId;
      const externalId = txid ?? externalOrderId;

      if (exchange === 'kraken' && (!externalId || typeof externalId !== 'string')) {
        log(`Orden sin txid - posible fallo`, "trading");
        return false;
      }

      const resolvedOrderPrice = Number((order as any)?.price ?? (order as any)?.executedPrice ?? (order as any)?.average_price ?? (order as any)?.executed_price);
      const resolvedOrderVolume = Number((order as any)?.volume ?? (order as any)?.executedVolume ?? (order as any)?.executed_size ?? (order as any)?.filled_size);
      const resolvedOrderCost = Number((order as any)?.cost ?? (order as any)?.executed_value ?? (order as any)?.executed_notional ?? (order as any)?.executed_quote_size ?? (order as any)?.filled_value);

      if (Number.isFinite(resolvedOrderPrice) && resolvedOrderPrice > 0) {
        price = resolvedOrderPrice;
      }
      if (Number.isFinite(resolvedOrderVolume) && resolvedOrderVolume > 0) {
        volumeNum = resolvedOrderVolume;
      }
      if ((!Number.isFinite(price) || price <= 0) && Number.isFinite(resolvedOrderCost) && resolvedOrderCost > 0 && volumeNum > 0) {
        price = resolvedOrderCost / volumeNum;
      }
      volume = volumeNum.toFixed(8);
      totalUSD = volumeNum * price;

      const executedAt = new Date();
      const priceStr = price.toString();
      const amountStr = volumeNum.toFixed(8);
      const tradeId = buildTradeId({
        exchange,
        pair,
        executedAt,
        type,
        price: priceStr,
        amount: amountStr,
        externalId,
      });

      // === A) P&L INMEDIATO EN SELL AUTOMÃTICO ===
      let tradeEntryPrice: string | null = null;
      let tradeRealizedPnlUsd: string | null = null;
      let tradeRealizedPnlPct: string | null = null;
      let reasonWithContext = reason;

      
      if (type === "sell") {
        const entryPrice = sellContext?.entryPrice ?? null;
        
        if (entryPrice != null && entryPrice > 0) {
          // A2: Calcular P&L NETO con fees incluidos
          const grossPnlUsd = (price - entryPrice) * volumeNum;
          const entryValueUsd = entryPrice * volumeNum;
          const exitValueUsd = price * volumeNum;
          
          // Calcular fees: usar entryFee real si existe, sino estimar con fee dinÃ¡mico
          const currentFeePct = getTakerFeePct();
          const entryFeeUsd = sellContext?.entryFee ?? (entryValueUsd * currentFeePct / 100);
          const exitFeeUsd = exitValueUsd * currentFeePct / 100;
          const netPnlUsd = grossPnlUsd - entryFeeUsd - exitFeeUsd;
          const netPnlPct = (netPnlUsd / entryValueUsd) * 100;
          
          tradeEntryPrice = entryPrice.toString();
          tradeRealizedPnlUsd = netPnlUsd.toFixed(8);
          tradeRealizedPnlPct = netPnlPct.toFixed(4);
          log(`[P&L] SELL ${pair}: entry=$${entryPrice.toFixed(2)} exit=$${price.toFixed(2)} â†’ Bruto=$${grossPnlUsd.toFixed(2)}, Fees=$${(entryFeeUsd + exitFeeUsd).toFixed(2)}, NETO=$${netPnlUsd.toFixed(2)} (${netPnlPct.toFixed(2)}%)`, "trading");
        } else {
          // A3: Orphan/emergency sin entryPrice - permitir pero marcar
          reasonWithContext = `${reason} | SELL_NO_ENTRYPRICE`;
          log(`[WARN] SELL ${pair} sin entryPrice - P&L no calculado (orphan/emergency)`, "trading");
        }
      }
      
      const tradeRecord: InsertTrade = {
        tradeId,
        exchange,
        origin: 'engine',  // FIX: 'engine' for trades executed by trading engine (vs 'sync' for imported)
        pair,
        type,
        price: priceStr,
        amount: amountStr,
        status: "filled",
        krakenOrderId: exchange === 'kraken' ? externalId : undefined,
        executedAt,
        entryPrice: tradeEntryPrice ?? undefined,
        realizedPnlUsd: tradeRealizedPnlUsd ?? undefined,
        realizedPnlPct: tradeRealizedPnlPct ?? undefined,
      };

      log(`[TRADE_PERSIST_START] ${pair} ${tradeId}`, "trading");
      let persistedTrade: Trade | undefined;
      try {
        const { inserted, trade } = await storage.insertTradeIgnoreDuplicate(tradeRecord);
        persistedTrade = trade ?? await storage.getTradeByComposite(exchange, pair, tradeId);
        log(`[TRADE_PERSIST_${inserted ? 'OK' : 'DUPLICATE'}] ${pair} ${tradeId}`, "trading");
      } catch (persistErr: any) {
        await this.emitOrderTrackingAlert("TRADE_PERSIST_FAIL", {
          pair,
          tradeId,
          exchange,
          type,
          error: persistErr?.message ?? String(persistErr),
        });
        throw persistErr;
      }

      const applyKey = { exchange, pair, tradeId };
      let applyLockAcquired = false;
      try {
        const shouldApply = await storage.markTradeApplied(applyKey);
        if (!shouldApply) {
          log(`[POSITION_APPLY_DUPLICATE] ${pair} ${tradeId} (${type})`, "trading");
        } else {
          applyLockAcquired = true;
          log(`[POSITION_APPLY_START] ${pair} ${tradeId} (${type})`, "trading");

          if (type === "buy") {
            this.currentUsdBalance -= volumeNum * price;

            let netBought = volumeNum;
            if (preAssetBalance != null) {
              const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
              let postAssetBalance = preAssetBalance;
              for (let i = 0; i < 3; i++) {
                try {
                  const postBalances = await this.getTradingExchange().getBalance();
                  postAssetBalance = this.getAssetBalance(pair, postBalances);
                  if (postAssetBalance > preAssetBalance) break;
                } catch (balErr: any) {
                  log(`${pair}: Error obteniendo balance post (postBalance) para BUY neto: ${balErr.message}`, "trading");
                }
                await sleep(500);
              }

              const delta = Math.max(0, postAssetBalance - preAssetBalance);
              if (delta > 0 && delta <= volumeNum * 1.05) {
                netBought = delta;
              } else if (delta > volumeNum * 1.05) {
                log(`${pair}: BUY neto fuera de rango (delta=${delta}, requested=${volumeNum}). Usando requested volume para evitar mezclar HOLD.`, "trading");
              } else {
                log(`${pair}: BUY neto no detectado (delta=${delta}). Usando requested volume.`, "trading");
              }
            }

            const existingPositions = this.getPositionsByPair(pair);
            const existing = existingPositions[0];
            let newPosition: OpenPosition;

            const entryStrategyId = strategyMeta?.strategyId || "momentum_cycle";
            const entrySignalTf = strategyMeta?.timeframe || "cycle";
            const signalConfidence = strategyMeta?.confidence;

            const currentConfig = await storage.getBotConfig();
            const entryMode = currentConfig?.positionMode || "SINGLE";

            const shouldCreateNewLot = entryMode === "SMART_GUARD" || !existing || existing.amount <= 0;

            if (!shouldCreateNewLot && existing) {
              const totalAmount = existing.amount + netBought;
              const avgPrice = (existing.amount * existing.entryPrice + netBought * price) / totalAmount;
              const additionalEntryFee = volumeNum * price * (getTakerFeePct() / 100);
              const totalEntryFee = (existing.entryFee || 0) + additionalEntryFee;
              newPosition = {
                ...existing,
                amount: totalAmount,
                entryPrice: avgPrice,
                entryFee: totalEntryFee,
                highestPrice: Math.max(existing.highestPrice, price),
              };
              this.openPositions.set(existing.lotId, newPosition);
              // Clean up any pending exposure for this DCA entry
              this.removePendingExposure(existing.lotId);
              log(`DCA entry: ${pair} (${existing.lotId}) - preserved snapshot from original entry, totalFee=$${totalEntryFee.toFixed(4)}`, "trading");
            } else {
              const lotId = generateLotId(pair);

              const configSnapshot: ConfigSnapshot = {
                stopLossPercent: parseFloat(currentConfig?.stopLossPercent?.toString() || "5"),
                takeProfitPercent: parseFloat(currentConfig?.takeProfitPercent?.toString() || "7"),
                trailingStopEnabled: currentConfig?.trailingStopEnabled ?? false,
                trailingStopPercent: parseFloat(currentConfig?.trailingStopPercent?.toString() || "2"),
                positionMode: entryMode,
              };

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

                const regimeEnabled = currentConfig?.regimeDetectionEnabled ?? false;
                const adaptiveExitEnabled = currentConfig?.adaptiveExitEnabled ?? false;

                if (regimeEnabled || adaptiveExitEnabled) {
                  try {
                    const regimeAnalysis = await this.getMarketRegimeWithCache(pair);

                    if (adaptiveExitEnabled) {
                      const history = this.priceHistory.get(pair) || [];
                      const atrPercent = this.calculateATRPercent(history, 14);
                      const minBeFloorPct = parseFloat(currentConfig?.minBeFloorPct?.toString() || "2.0");

                      const atrExits = this.calculateAtrBasedExits(
                        pair, price, atrPercent, regimeAnalysis.regime, true, history.length, minBeFloorPct
                      );

                      configSnapshot.stopLossPercent = atrExits.slPct;
                      configSnapshot.sgBeAtPct = atrExits.beAtPct;
                      configSnapshot.sgTrailDistancePct = atrExits.trailPct;
                      configSnapshot.sgTpFixedPct = atrExits.tpPct;

                      const fallbackNote = atrExits.usedFallback ? " [FALLBACK]" : "";
                      log(`[ATR_SNAPSHOT] ${pair}: ATR-based exits applied â†’ SL=${atrExits.slPct.toFixed(2)}% BE=${atrExits.beAtPct.toFixed(2)}% Trail=${atrExits.trailPct.toFixed(2)}% TP=${atrExits.tpPct.toFixed(2)}% (${atrExits.source})${fallbackNote}`, "trading");
                    } else if (regimeEnabled) {
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
                    }
                  } catch (regimeErr: any) {
                    log(`[REGIME] ${pair}: Error ajustando snapshot, usando params base: ${regimeErr.message}`, "trading");
                  }
                }
              }

              const entryFee = volumeNum * price * (getTakerFeePct() / 100);

              newPosition = {
                lotId,
                pair,
                amount: netBought,
                entryPrice: price,
                entryFee,
                highestPrice: price,
                openedAt: Date.now(),
                entryStrategyId,
                entrySignalTf,
                signalConfidence,
                signalReason: reason,
                entryMode,
                configSnapshot,
                sgBreakEvenActivated: false,
                sgCurrentStopPrice: undefined,
                sgTrailingActivated: false,
                sgScaleOutDone: false,
              };
              this.openPositions.set(lotId, newPosition);
              
              // Clean up pending exposure now that position is confirmed OPEN
              this.removePendingExposure(lotId);

              const lotCount = this.countLotsForPair(pair);
              if (entryMode === "SMART_GUARD") {
                log(`NEW LOT #${lotCount}: ${pair} (${lotId}) - SMART_GUARD snapshot saved (BE=${configSnapshot.sgBeAtPct}%, trail=${configSnapshot.sgTrailDistancePct}%, TP=${configSnapshot.sgTpFixedEnabled ? configSnapshot.sgTpFixedPct + '%' : 'OFF'})`, "trading");
              } else {
                log(`NEW POSITION: ${pair} (${lotId}) - snapshot saved (SL=${configSnapshot.stopLossPercent}%, TP=${configSnapshot.takeProfitPercent}%, trailing=${configSnapshot.trailingStopEnabled}, mode=${entryMode})`, "trading");
              }
            }

            if (!newPosition.aiSampleId) {
              try {
                const features = aiService.extractFeatures({
                  rsi: 50,
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
            this.currentUsdBalance += volumeNum * price;

            if (sellContext) {
              const pnlGross = (price - sellContext.entryPrice) * volumeNum;
              const exitFee = volumeNum * price * (getTakerFeePct() / 100);
              const sellRatio = (sellContext.sellAmount && sellContext.positionAmount && sellContext.positionAmount > 0)
                ? sellContext.sellAmount / sellContext.positionAmount
                : 1;
              const proratedEntryFee = (sellContext.entryFee || 0) * sellRatio;
              const pnlNet = pnlGross - proratedEntryFee - exitFee;

              this.dailyPnL += pnlNet;

              log(`[FEES_DIAG] SELL ${pair}: pnlGross=$${pnlGross.toFixed(4)}, entryFee=$${proratedEntryFee.toFixed(4)} (${(sellRatio*100).toFixed(0)}% of pos), exitFee=$${exitFee.toFixed(4)}, pnlNet=$${pnlNet.toFixed(4)}, feePct=${getTakerFeePct()}%, slippage=${SLIPPAGE_BUFFER_PCT}%`, "trading");
              log(`P&L de operaciÃ³n: $${pnlNet.toFixed(2)} (bruto: $${pnlGross.toFixed(2)}, fees: $${(proratedEntryFee + exitFee).toFixed(2)}) | P&L diario acumulado: $${this.dailyPnL.toFixed(2)}`, "trading");

              if (sellContext.aiSampleId) {
                try {
                  await storage.updateAiSample(sellContext.aiSampleId, {
                    exitPrice: price.toString(),
                    exitTs: new Date(),
                    pnlGross: pnlGross.toString(),
                    pnlNet: pnlNet.toString(),
                    labelWin: pnlNet > 0 ? 1 : 0,
                    isComplete: true,
                  });
                  log(`[AI] Sample #${sellContext.aiSampleId} actualizado: PnLGross=${pnlGross.toFixed(2)}, PnLNet=${pnlNet.toFixed(2)} (${pnlNet > 0 ? 'WIN' : 'LOSS'})`, "trading");
                } catch (aiErr: any) {
                  log(`[AI] Error actualizando sample: ${aiErr.message}`, "trading");
                }
              }
            } else {
              log(`[WARN] Emergency SELL completado sin sellContext para ${pair} - P&L no registrado.`, "trading");
            }
          }

          log(`[POSITION_APPLY_OK] ${pair} ${tradeId} (${type})`, "trading");
        }
      } catch (applyErr: any) {
        log(`[POSITION_APPLY_FAIL] ${pair} ${tradeId} (${type}): ${applyErr.message}`, "trading");
        if (applyLockAcquired) {
          try {
            await storage.unmarkTradeApplied(applyKey);
          } catch (rollbackErr: any) {
            log(`[POSITION_APPLY_ROLLBACK_FAIL] ${pair} ${tradeId}: ${rollbackErr.message}`, "trading");
          }
        }
        await this.emitOrderTrackingAlert("POSITION_APPLY_FAIL", {
          pair,
          tradeId,
          exchange,
          type,
          error: applyErr?.message ?? String(applyErr),
        });
        throw applyErr;
      }

      const emoji = type === "buy" ? "ðŸŸ¢" : "ðŸ”´";
      const totalUSDFormatted = totalUSD.toFixed(2);
      
      // CRITICAL: Variables para tracking de notificaciÃ³n
      let notificationSent = false;
      let notificationError: string | null = null;
      
      const strategyLabel = strategyMeta?.strategyId ? 
        ((strategyMeta?.timeframe && strategyMeta.timeframe !== "cycle") ? 
          `Momentum (Velas ${strategyMeta.timeframe})` : 
          "Momentum (Ciclos)") : 
        "Momentum (Ciclos)";
      const confidenceValue = strategyMeta?.confidence ? toConfidencePct(strategyMeta.confidence, 0).toFixed(0) : "N/A";
      
      if (this.telegramService.isInitialized()) {
        try {
          // Build natural language messages for Telegram with essential data
          if (type === "buy") {
            const regimeText = strategyMeta?.regime 
              ? (strategyMeta.regime === "TREND" ? "tendencia alcista" : 
                 strategyMeta.regime === "RANGE" ? "mercado lateral" : "mercado en transiciÃ³n")
              : "";
            
            const confNum = parseInt(confidenceValue);
            const confidenceLevel = !isNaN(confNum) 
              ? (confNum >= 80 ? "alta" : confNum >= 60 ? "buena" : "moderada")
              : "";
            
            // Build signals summary
            let signalsSummary = confidenceLevel 
              ? `Confianza ${confidenceLevel} (${confidenceValue}%)` 
              : `Confianza ${confidenceValue}%`;
            if (regimeText) {
              signalsSummary += ` | Mercado en ${regimeText}`;
            }
            
            // Use new visual buy alert
            await this.telegramService.sendBuyAlert({
              pair: pair,
              exchange: exchange,
              price: price.toFixed(2),
              amount: volume,
              total: totalUSDFormatted,
              orderId: txid || externalId || `UNKNOWN-${Date.now()}`,
              lotId: tradeId,
              mode: this.dryRunMode ? "DRY_RUN" : "LIVE",
              status: "COMPLETED",
              signalsSummary: signalsSummary,
              regime: strategyMeta?.regime || undefined,
              regimeReason: regimeText || undefined,
              routerStrategy: strategyLabel || undefined,
            });
          } else {
            // For sell alerts, we need P&L calculation
            const assetName = pair.replace("/USD", "");
            
            // Use new visual sell alert
            await this.telegramService.sendSellAlert({
              pair: pair,
              exchange: exchange,
              price: price.toFixed(2),
              amount: volume,
              total: totalUSDFormatted,
              orderId: txid || externalId || `UNKNOWN-${Date.now()}`,
              lotId: tradeId,
              mode: this.dryRunMode ? "DRY_RUN" : "LIVE",
              exitType: reason.includes("STOP") ? "STOP_LOSS" : reason.includes("PROFIT") ? "TAKE_PROFIT" : "MANUAL",
              status: "COMPLETED",
              trigger: reason,
              // P&L will be calculated by the calling function with position data
            });
          }
          notificationSent = true;
        } catch (telegramErr: any) {
          notificationError = telegramErr.message;
          log(`[TELEGRAM_FAIL] ${correlationId} | Error enviando notificaciÃ³n: ${telegramErr.message}`, "trading");
        }
      } else {
        notificationError = "Telegram not initialized";
        log(`[TELEGRAM_NOT_INIT] ${correlationId} | Telegram no inicializado - orden ejecutada SIN notificaciÃ³n`, "trading");
      }
      
      // CRITICAL: Log notification status for forensic traceability
      await botLogger.info(notificationSent ? "NOTIFICATION_SENT" : "NOTIFICATION_FAILED", 
        notificationSent ? `Notification sent for ${type} order` : `FAILED to notify ${type} order`, {
        correlationId,
        pair,
        type,
        txid,
        notificationSent,
        notificationError,
        totalUsd: totalUSD,
      });

      log(`[ORDER_COMPLETED] ${correlationId} | Orden ejecutada: ${txid} | NotificaciÃ³n: ${notificationSent ? 'OK' : 'FAILED'}`, "trading");
      
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
      if (type === "sell" && !isSimulation && externalId) {
        try {
          const fee = volumeNum * price * (getTakerFeePct() / 100); // Use dynamic fee from active exchange
          await storage.upsertTradeFill({
            txid: externalId,
            orderId: externalId,
            exchange,
            pair,
            type: "sell",
            price: price.toString(),
            amount: volume,
            cost: (volumeNum * price).toFixed(8),
            fee: fee.toFixed(8),
            executedAt: new Date(),
            matched: false,
          });
          
          const sellFill = await storage.getTradeFillByTxid(externalId);
          if (sellFill) {
            const matchResult = await fifoMatcher.processSellFill(sellFill);
            log(`[FIFO] Auto-matched sell ${txid}: matched=${matchResult.totalMatched.toFixed(8)}, lots_closed=${matchResult.lotsClosed}, pnl=$${matchResult.pnlNet.toFixed(2)}`, "trading");
            
            if (matchResult.lotsClosed > 0) {
              await botLogger.info("FIFO_LOTS_CLOSED", `FIFO cerrÃ³ ${matchResult.lotsClosed} lotes automÃ¡ticamente`, {
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
        await this.telegramService.sendAlertWithSubtype(`ðŸ¤– <b>KRAKEN BOT</b> ðŸ‡ªðŸ‡¸
â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
âš ï¸ <b>Error en OperaciÃ³n</b>

ðŸ“¦ <b>Detalles:</b>
   â€¢ Par: <code>${pair}</code>
   â€¢ Tipo: <code>${type}</code>

âŒ <b>Error:</b> <code>${error.message}</code>
â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”`, "errors", "error_api");
      }
      return false;
    }
  }

  // === MTF ANALYSIS (delegated to MtfAnalyzer) ===
  private async getMultiTimeframeData(pair: string): Promise<MultiTimeframeData | null> { return this.mtfAnalyzer.getMultiTimeframeData(pair); }
  private analyzeTimeframeTrend(candles: OHLCCandle[]): "bullish" | "bearish" | "neutral" { return _analyzeTimeframeTrend(candles); }
  private analyzeMultiTimeframe(mtfData: MultiTimeframeData): TrendAnalysis { return _analyzeMultiTimeframe(mtfData); }

  isActive(): boolean {
    return this.isRunning;
  }

  // === CIERRE MANUAL DE POSICIÃ“N ===
  async forceClosePosition(
    pair: string,
    currentPrice: number,
    correlationId: string,
    reason: string,
    specificLotId?: string
  ): Promise<{
    success: boolean;
    pnlUsd?: number;
    pnlPct?: number;
    dryRun?: boolean;
    orderId?: string;
    lotId?: string;
    error?: string;
    isDust?: boolean; // Flag para indicar que la posiciÃ³n es DUST y no se puede cerrar
  }> {
    try {
      // Find the position to close
      let position: OpenPosition | undefined;
      if (specificLotId) {
        position = this.openPositions.get(specificLotId);
      } else {
        // Close the first position for this pair
        const positions = this.getPositionsByPair(pair);
        position = positions[0];
      }

      if (!position || position.amount <= 0) {
        try {
          const dbPosition = specificLotId
            ? await storage.getOpenPositionByLotId(specificLotId)
            : (await storage.getOpenPositionsByPair(pair)).find((p: any) => (p as any).status === 'OPEN');

          if (dbPosition && (dbPosition as any).status === 'OPEN') {
            const lotId = (dbPosition as any).lotId || specificLotId || generateLotId(pair);
            const amountDb = parseFloat(String((dbPosition as any).amount ?? '0'));
            const entryPriceDb = parseFloat(String((dbPosition as any).entryPrice ?? '0'));
            const highestPriceDb = parseFloat(String((dbPosition as any).highestPrice ?? entryPriceDb ?? '0'));
            const entryFeeDb = parseFloat(String((dbPosition as any).entryFee ?? '0'));
            const openedAtDb = (dbPosition as any).openedAt ? new Date((dbPosition as any).openedAt).getTime() : Date.now();

            if (Number.isFinite(amountDb) && amountDb > 0 && Number.isFinite(entryPriceDb) && entryPriceDb > 0) {
              position = {
                lotId,
                pair: (dbPosition as any).pair || pair,
                amount: amountDb,
                entryPrice: entryPriceDb,
                entryFee: Number.isFinite(entryFeeDb) ? entryFeeDb : 0,
                highestPrice: Number.isFinite(highestPriceDb) ? highestPriceDb : entryPriceDb,
                openedAt: openedAtDb,
                entryStrategyId: (dbPosition as any).entryStrategyId || 'momentum_cycle',
                entrySignalTf: (dbPosition as any).entrySignalTf || 'cycle',
                signalConfidence: (dbPosition as any).signalConfidence ? toConfidenceUnit((dbPosition as any).signalConfidence) : undefined,
                signalReason: (dbPosition as any).signalReason || undefined,
                entryMode: (dbPosition as any).entryMode || undefined,
                configSnapshot: (dbPosition as any).configSnapshotJson || undefined,
                sgBreakEvenActivated: (dbPosition as any).sgBreakEvenActivated ?? false,
                sgCurrentStopPrice: (dbPosition as any).sgCurrentStopPrice ? parseFloat((dbPosition as any).sgCurrentStopPrice) : undefined,
                sgTrailingActivated: (dbPosition as any).sgTrailingActivated ?? false,
                sgScaleOutDone: (dbPosition as any).sgScaleOutDone ?? false,
                timeStopDisabled: (dbPosition as any).timeStopDisabled ?? undefined,
                timeStopExpiredAt: (dbPosition as any).timeStopExpiredAt ? new Date((dbPosition as any).timeStopExpiredAt).getTime() : undefined,
                beProgressiveLevel: (dbPosition as any).beProgressiveLevel ?? undefined,
              };
              this.openPositions.set(lotId, position);
            }
          }
        } catch (e: any) {
          log(`[MANUAL_CLOSE] Warning: fallback DB load failed for ${pair}: ${e.message}`, 'trading');
        }
      }

      if (!position || position.amount <= 0) {
        return {
          success: false,
          error: "No se encontrÃ³ posiciÃ³n abierta en memoria/BD para este par",
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
        log(`[DRY_RUN] SIMULACIÃ“N cierre manual ${pair} (${positionLotId}) - ${amount.toFixed(8)} @ $${currentPrice.toFixed(2)}`, "trading");

        // Actualizar memoria y DB para reflejar el cierre (aunque sea simulado)
        this.openPositions.delete(positionLotId);
        await storage.deleteOpenPositionByLotId(positionLotId);

        // Registrar el trade de cierre
        const tradeId = `MANUAL-${Date.now()}`;
        const exchange = this.getTradingExchangeType();
        await storage.createTrade({
          tradeId,
          exchange,
          pair,
          type: "sell",
          price: currentPrice.toString(),
          amount: amount.toFixed(8),
          status: "filled",
          krakenOrderId: exchange === 'kraken' ? simTxid : undefined,
          entryPrice: entryPrice.toString(),
          realizedPnlUsd: pnlUsd.toString(),
          realizedPnlPct: pnlPct.toString(),
          executedAt: new Date(),
        });

        // Notificar por Telegram
        if (this.telegramService.isInitialized()) {
          const pnlEmoji = pnlUsd >= 0 ? "ðŸ“ˆ" : "ðŸ“‰";
          await this.telegramService.sendAlertWithSubtype(`ðŸ¤– <b>KRAKEN BOT</b> ðŸ‡ªðŸ‡¸
â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
ðŸ§ª <b>Cierre Manual Simulado</b> [DRY_RUN]

ðŸ“¦ <b>Detalles:</b>
   â€¢ Par: <code>${pair}</code>
   â€¢ Cantidad: <code>${amount.toFixed(8)}</code>
   â€¢ Precio entrada: <code>$${entryPrice.toFixed(2)}</code>
   â€¢ Precio salida: <code>$${currentPrice.toFixed(2)}</code>

${pnlEmoji} <b>PnL:</b> <code>${pnlUsd >= 0 ? "+" : ""}$${pnlUsd.toFixed(2)} (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%)</code>

âš ï¸ Modo simulaciÃ³n - NO se enviÃ³ orden real
â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”`, "trades", "trade_sell");
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

      // === VALIDACIÃ“N PRE-SELL: Verificar balance real y detectar DUST ===
      const validation = await this.validateSellAmount(pair, positionLotId, amount);
      
      if (!validation.canSell) {
        // Caso DUST: no se puede vender, devolver error con flag isDust
        if (validation.isDust) {
          // Enviar alerta Telegram
          if (this.telegramService.isInitialized()) {
            await this.telegramService.sendAlertWithSubtype(`ðŸ¤– <b>KRAKEN BOT</b> ðŸ‡ªðŸ‡¸
â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
âš ï¸ <b>PosiciÃ³n DUST Detectada</b>

ðŸ“¦ <b>Detalles:</b>
   â€¢ Par: <code>${pair}</code>
   â€¢ Lot: <code>${positionLotId}</code>
   â€¢ Cantidad registrada: <code>${amount.toFixed(8)}</code>
   â€¢ Balance real: <code>${validation.realAssetBalance.toFixed(8)}</code>
   â€¢ MÃ­nimo Kraken: <code>${validation.orderMin}</code>

â„¹ï¸ No se puede cerrar - usar "Eliminar huÃ©rfana" en UI
â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”`, "balance", "balance_exposure");
          }
        }
        
        return {
          success: false,
          error: validation.reason,
          lotId: positionLotId,
          isDust: validation.isDust,
        };
      }
      
      // Si hubo ajuste de cantidad, actualizar posiciÃ³n interna
      const sellAmountFinal = validation.sellAmountFinal;
      if (validation.needsPositionAdjust) {
        log(`[MANUAL_CLOSE] Ajustando posiciÃ³n ${pair} (${positionLotId}) de ${amount} a ${sellAmountFinal}`, "trading");
        position.amount = sellAmountFinal;
        this.openPositions.set(positionLotId, position);
        await this.savePositionToDB(pair, position);
      }
      
      // Recalcular PnL NETO con cantidad real y fees (usar fee dinÃ¡mico del exchange activo)
      const grossPnlUsd = (currentPrice - entryPrice) * sellAmountFinal;
      const entryValueUsd = entryPrice * sellAmountFinal;
      const exitValueUsd = currentPrice * sellAmountFinal;
      const currentFeePct = getTakerFeePct();
      const entryFeeUsd = position.entryFee ?? (entryValueUsd * currentFeePct / 100);
      const exitFeeUsd = exitValueUsd * currentFeePct / 100;
      const actualPnlUsd = grossPnlUsd - entryFeeUsd - exitFeeUsd;
      const actualPnlPct = (actualPnlUsd / entryValueUsd) * 100;

      // PRODUCCIÃ“N: Ejecutar orden real de venta via exchange activo
      const order = await this.getTradingExchange().placeOrder({
        pair,
        type: "sell",
        ordertype: "market",
        volume: sellAmountFinal.toFixed(8),
      });

      // CRITICAL: Validate order success before continuing
      if ((order as any)?.success === false) {
        const errorMsg = (order as any)?.error || 'Unknown error';
        log(`[ORDER_FAILED] ${pair} SELL: ${errorMsg}`, "trading");
        await botLogger.error("ORDER_FAILED", `Failed to place sell order for ${pair}`, {
          pair,
          type: "sell",
          volume: sellAmountFinal.toFixed(8),
          error: errorMsg,
          exchange: this.getTradingExchangeType()
        });
        return {
          success: false,
          error: errorMsg,
        };
      }

      const txid = Array.isArray((order as any).txid) ? (order as any).txid[0] : (order as any).txid;
      if (!txid || typeof txid !== "string") {
        return {
          success: false,
          error: "Orden enviada pero no se recibiÃ³ txid de confirmaciÃ³n",
        };
      }

      // Actualizar memoria y DB (usar lotId para multi-lot)
      this.openPositions.delete(positionLotId);
      await storage.deleteOpenPositionByLotId(positionLotId);

      // Registrar el trade de cierre
      const tradeId = `MANUAL-${Date.now()}`;
      const exchange = this.getTradingExchangeType();
      await storage.createTrade({
        tradeId,
        exchange,
        pair,
        type: "sell",
        price: currentPrice.toString(),
        amount: sellAmountFinal.toFixed(8),
        status: "filled",
        krakenOrderId: exchange === 'kraken' ? txid : undefined,
        entryPrice: entryPrice.toString(),
        realizedPnlUsd: actualPnlUsd.toString(),
        realizedPnlPct: actualPnlPct.toString(),
        executedAt: new Date(),
      });

      // Notificar por Telegram
      if (this.telegramService.isInitialized()) {
        await this.telegramService.sendSellAlert({
          pair: pair,
          exchange: exchange,
          price: currentPrice.toFixed(2),
          amount: sellAmountFinal.toFixed(8),
          total: (currentPrice * sellAmountFinal).toFixed(2),
          orderId: txid,
          lotId: positionLotId,
          mode: this.dryRunMode ? "DRY_RUN" : "LIVE",
          exitType: "MANUAL",
          status: "COMPLETED",
          trigger: "Cierre Manual",
          pnlUsd: actualPnlUsd,
          pnlPct: actualPnlPct,
          feeUsd: entryFeeUsd + exitFeeUsd,
          netPnlUsd: actualPnlUsd,
          openedAt: position.openedAt ? new Date(position.openedAt) : undefined,
        });
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

  // === DIAGNÃ“STICO: Obtener resultados del scan con razones en espaÃ±ol ===
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
    
    // Mapeo de razones a espaÃ±ol (segÃºn documento SMART_GUARD)
    const reasonTranslations: Record<string, string> = {
      "PAIR_COOLDOWN": "En enfriamiento - esperando reintentos",
      "SINGLE_MODE_POSITION_EXISTS": "Ya hay posiciÃ³n abierta en este par",
      "SMART_GUARD_POSITION_EXISTS": "Ya hay posiciÃ³n abierta en este par",
      "SMART_GUARD_MAX_LOTS_REACHED": "MÃ¡ximo de lotes abiertos alcanzado para este par",
      "STOPLOSS_COOLDOWN": "Enfriamiento post stop-loss activo",
      "SPREAD_TOO_HIGH": "Spread demasiado alto para operar",
      "POSITION_TOO_LARGE": "PosiciÃ³n existente demasiado grande",
      "INSUFFICIENT_FUNDS": "Fondos USD insuficientes",
      "LOW_PROFITABILITY": "Take-profit menor que comisiones",
      "EXPOSURE_ZERO": "Sin exposiciÃ³n disponible",
      "VOLUME_BELOW_MINIMUM": "Volumen calculado < mÃ­nimo Kraken",
      "SG_MIN_ENTRY_NOT_MET": "MÃ­nimo por operaciÃ³n no alcanzado (tiene saldo, pero tamaÃ±o quedÃ³ por debajo)",
      "SG_REDUCED_ENTRY": "Saldo por debajo del mÃ­nimo â€” entro con lo disponible",
      "MIN_ORDER_ABSOLUTE": "Por debajo del mÃ­nimo absoluto ($20) â€” mÃ­nimo exchange no alcanzado",
      "MIN_ORDER_USD": "SKIP - MÃ­nimo por orden no alcanzado (allowUnderMin=OFF)",
      "NO_POSITION": "Sin posiciÃ³n para vender",
      "AI_FILTER_REJECTED": "SeÃ±al rechazada por filtro IA",
      "Sin seÃ±al": "Sin seÃ±al de trading activa",
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
        
        // Traducir la razÃ³n
        let razon = result.reason;
        for (const [key, value] of Object.entries(reasonTranslations)) {
          if (razon.includes(key) || razon === key) {
            razon = value;
            break;
          }
        }

        // Obtener cooldown si no viene en el resultado
        const cooldownSec = result.cooldownSec ?? this.getCooldownRemainingSec(pair);

        // Obtener rÃ©gimen si estÃ¡ habilitado
        let regime: string | undefined;
        let regimeReason: string | undefined;
        let requiredSignals: number | undefined;
        
        if (regimeDetectionEnabled) {
          try {
            const regimeAnalysis = await this.getMarketRegimeWithCache(pair);
            regime = regimeAnalysis.regime;
            regimeReason = regimeAnalysis.reason;
            const baseForRegime = regimeAnalysis.regime === "TRANSITION" ? 4 : 5;
            requiredSignals = this.getRegimeMinSignals(regimeAnalysis.regime, baseForRegime);
          } catch (err) {
            regime = "ERROR";
            regimeReason = "Error obteniendo rÃ©gimen";
          }
        }

        pairs.push({
          pair,
          signal: result.signal,
          razon,
          cooldownSec: cooldownSec !== undefined && cooldownSec > 0 ? cooldownSec : undefined,
          exposureAvailable: result.exposureAvailable,
          hasPosition,
          positionUsd: hasPosition ? totalPositionUsd : undefined,
          regime,
          regimeReason,
          requiredSignals,
        });
      }
    } else {
      // Si no hay datos de escaneo, mostrar pares activos con info bÃ¡sica
      const activePairs = config?.activePairs || [];
      for (const pair of activePairs) {
        const pairPositions = getPositionsForPair(pair);
        const hasPosition = pairPositions.length > 0;
        const totalPositionUsd = pairPositions.reduce((sum, p) => sum + (p.amount * p.entryPrice), 0);
        const exposure = this.getAvailableExposure(pair, config, this.currentUsdBalance);
        
        // Determinar razÃ³n basada en el estado real
        let razon = "Bot inactivo - actÃ­valo para escanear";
        if (this.isRunning) {
          if (this.lastScanTime > 0) {
            razon = "Sin seÃ±al activa";
          } else {
            razon = "Esperando primer escaneo...";
          }
        }
        
        const cooldownSec = this.getCooldownRemainingSec(pair);
        
        // Obtener rÃ©gimen si estÃ¡ habilitado (mismo que rama principal)
        let regime: string | undefined;
        let regimeReason: string | undefined;
        let requiredSignals: number | undefined;
        
        if (regimeDetectionEnabled) {
          try {
            const regimeAnalysis = await this.getMarketRegimeWithCache(pair);
            regime = regimeAnalysis.regime;
            regimeReason = regimeAnalysis.reason;
            const baseForRegime = regimeAnalysis.regime === "TRANSITION" ? 4 : 5;
            requiredSignals = this.getRegimeMinSignals(regimeAnalysis.regime, baseForRegime);
          } catch (err) {
            regime = "ERROR";
            regimeReason = "Error obteniendo rÃ©gimen";
          }
        }
        
        pairs.push({
          pair,
          signal: "NONE",
          razon,
          cooldownSec: cooldownSec !== undefined && cooldownSec > 0 ? cooldownSec : undefined,
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
