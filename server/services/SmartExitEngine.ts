/**
 * SmartExitEngine — Experimental dynamic exit system.
 *
 * Evaluates open positions each scan cycle using technical deterioration,
 * entry signal decay, market regime, and temporal confirmation to decide
 * whether a position should be closed early.
 *
 * Designed to coexist with the existing SL/TP/Trailing system.
 * Controlled via UI toggle (smartExitConfig.enabled).
 */

import {
  calculateEMA,
  calculateMACD,
  calculateADX,
  calculateATRPercent,
  type PriceData,
  type OHLCCandle,
} from "./indicators";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type SmartExitRegime = "TREND" | "CHOP" | "VOLATILE";

export interface SmartExitConfig {
  enabled: boolean;
  exitScoreThresholdBase: number;
  confirmationCycles: number;
  minPositionAgeSec: number;
  minPnlLossPct: number;
  extraLossThresholdPenalty: number;
  stagnationMinutes: number;
  stagnationMinPnlPct: number;
  regimeThresholds: Record<SmartExitRegime, number>;
  signals: {
    emaReversal: boolean;
    macdReversal: boolean;
    volumeDrop: boolean;
    mtfAlignmentLoss: boolean;
    orderbookImbalance: boolean;
    exchangeFlows: boolean;
    entrySignalDeterioration: boolean;
    stagnationExit: boolean;
    marketRegimeAdjustment: boolean;
  };
  notifications: SmartExitNotificationsConfig;
}

export interface SmartExitNotificationsConfig {
  enabled: boolean;
  notifyOnThresholdHit: boolean;
  notifyOnExecutedExit: boolean;
  notifyOnRegimeChange: boolean;
  includeSnapshot: boolean;
  includePnl: boolean;
  includeReasons: boolean;
  cooldownSec: number;
  minScoreToNotify: number;
  oneAlertPerEvent: boolean;
}

export const DEFAULT_SMART_EXIT_CONFIG: SmartExitConfig = {
  enabled: false,
  exitScoreThresholdBase: 3,
  confirmationCycles: 3,
  minPositionAgeSec: 30,
  minPnlLossPct: 0,
  extraLossThresholdPenalty: 1,
  stagnationMinutes: 10,
  stagnationMinPnlPct: 0.2,
  regimeThresholds: {
    TREND: 5,
    CHOP: 2,
    VOLATILE: 3,
  },
  signals: {
    emaReversal: true,
    macdReversal: true,
    volumeDrop: true,
    mtfAlignmentLoss: true,
    orderbookImbalance: true,
    exchangeFlows: false,
    entrySignalDeterioration: true,
    stagnationExit: true,
    marketRegimeAdjustment: true,
  },
  notifications: {
    enabled: true,
    notifyOnThresholdHit: true,
    notifyOnExecutedExit: true,
    notifyOnRegimeChange: false,
    includeSnapshot: true,
    includePnl: true,
    includeReasons: true,
    cooldownSec: 300,
    minScoreToNotify: 3,
    oneAlertPerEvent: true,
  },
};

/** Snapshot of conditions at entry time — stored per position */
export interface EntryContext {
  entrySignalsCount: number;
  emaAlignment: boolean;
  macdBullish: boolean;
  volumeStrong: boolean;
  mtfTrend: string;
  regimeAtEntry: string;
  timestamp: string;
}

/** Signal contribution to exit score */
export interface SignalContribution {
  signal: string;
  score: number;
  detail: string;
}

/** Result of evaluating a single position */
export interface SmartExitDecision {
  shouldExit: boolean;
  score: number;
  threshold: number;
  regime: SmartExitRegime;
  confirmationProgress: number;
  confirmationRequired: number;
  reasons: string[];
  contributions: SignalContribution[];
  positionAgeSec: number;
  pnlPct: number;
}

/** Market data passed from TradingEngine per position evaluation */
export interface SmartExitMarketData {
  pair: string;
  currentPrice: number;
  priceHistory: PriceData[];
  candles?: OHLCCandle[];
  mtfTrend?: string | null;
  volumeRatio?: number;
  orderbookBias?: number | null; // -1 to 1 (sell to buy pressure)
  exchangeNetflow?: number | null;
}

/** Position data for Smart Exit evaluation */
export interface SmartExitPosition {
  lotId: string;
  pair: string;
  entryPrice: number;
  amount: number;
  openedAt: number; // timestamp ms
  entryMode?: string;
  pnlPct: number;
  pnlUsd: number;
  entryContext?: EntryContext;
  isClosing?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIRMATION STATE (per position)
// ═══════════════════════════════════════════════════════════════════════════════

interface ConfirmationState {
  consecutiveCycles: number;
  lastScore: number;
  lastRegime: SmartExitRegime;
  lastThresholdHitNotifiedAt: number;
  lastRegimeChangeNotifiedAt: number;
  previousRegime: SmartExitRegime | null;
  thresholdHitSent: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SMART EXIT ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

export class SmartExitEngine {
  private confirmationMap: Map<string, ConfirmationState> = new Map();

  // ─── Config helpers ──────────────────────────────────────────────────────

  getConfig(raw: any): SmartExitConfig {
    if (!raw) return { ...DEFAULT_SMART_EXIT_CONFIG };
    return {
      enabled: raw.enabled ?? false,
      exitScoreThresholdBase: raw.exitScoreThresholdBase ?? 3,
      confirmationCycles: raw.confirmationCycles ?? 3,
      minPositionAgeSec: raw.minPositionAgeSec ?? 30,
      minPnlLossPct: raw.minPnlLossPct ?? 0,
      extraLossThresholdPenalty: raw.extraLossThresholdPenalty ?? 1,
      stagnationMinutes: raw.stagnationMinutes ?? 10,
      stagnationMinPnlPct: raw.stagnationMinPnlPct ?? 0.2,
      regimeThresholds: {
        TREND: raw.regimeThresholds?.TREND ?? 5,
        CHOP: raw.regimeThresholds?.CHOP ?? 2,
        VOLATILE: raw.regimeThresholds?.VOLATILE ?? 3,
      },
      signals: {
        emaReversal: raw.signals?.emaReversal ?? true,
        macdReversal: raw.signals?.macdReversal ?? true,
        volumeDrop: raw.signals?.volumeDrop ?? true,
        mtfAlignmentLoss: raw.signals?.mtfAlignmentLoss ?? true,
        orderbookImbalance: raw.signals?.orderbookImbalance ?? true,
        exchangeFlows: raw.signals?.exchangeFlows ?? false,
        entrySignalDeterioration: raw.signals?.entrySignalDeterioration ?? true,
        stagnationExit: raw.signals?.stagnationExit ?? true,
        marketRegimeAdjustment: raw.signals?.marketRegimeAdjustment ?? true,
      },
      notifications: {
        enabled: raw.notifications?.enabled ?? true,
        notifyOnThresholdHit: raw.notifications?.notifyOnThresholdHit ?? true,
        notifyOnExecutedExit: raw.notifications?.notifyOnExecutedExit ?? true,
        notifyOnRegimeChange: raw.notifications?.notifyOnRegimeChange ?? false,
        includeSnapshot: raw.notifications?.includeSnapshot ?? true,
        includePnl: raw.notifications?.includePnl ?? true,
        includeReasons: raw.notifications?.includeReasons ?? true,
        cooldownSec: raw.notifications?.cooldownSec ?? 300,
        minScoreToNotify: raw.notifications?.minScoreToNotify ?? 3,
        oneAlertPerEvent: raw.notifications?.oneAlertPerEvent ?? true,
      },
    };
  }

  // ─── Market Regime Detection ─────────────────────────────────────────────

  detectMarketRegime(candles: OHLCCandle[]): SmartExitRegime {
    if (!candles || candles.length < 30) return "CHOP";

    const closes = candles.map(c => c.close);
    const priceData: PriceData[] = candles.map(c => ({
      price: c.close, timestamp: c.time, high: c.high, low: c.low, volume: c.volume,
    }));

    // ADX for trend strength
    const adx = calculateADX(candles, 14);

    // EMA slope: EMA20 vs EMA50 alignment
    const ema20 = calculateEMA(closes.slice(-20), 20);
    const ema50 = calculateEMA(closes.slice(-50), 50);
    const emaAligned = Math.abs(ema20 - ema50) / ema50 > 0.005;

    // ATR% for volatility
    const atrPct = calculateATRPercent(priceData.slice(-15), 14);

    // Choppy detection: simplified cross detection using raw price vs EMA50
    // Counts how many times the short-term price crosses over/under the long-term average
    let crossCount = 0;
    const len = closes.length;
    for (let i = Math.max(1, len - 20); i < len; i++) {
      const prevAbove = closes[i - 1] > ema50;
      const currAbove = closes[i] > ema50;
      if (prevAbove !== currAbove) crossCount++;
    }

    // Decision logic
    if (adx > 25 && emaAligned && crossCount <= 2) {
      return "TREND";
    }
    if (atrPct > 2.5 || adx > 20) {
      return "VOLATILE";
    }
    return "CHOP";
  }

  // ─── Signal Evaluators ───────────────────────────────────────────────────

  evaluateEmaReversal(candles: OHLCCandle[]): SignalContribution | null {
    if (!candles || candles.length < 20) return null;
    const closes = candles.map(c => c.close);
    const ema10 = calculateEMA(closes.slice(-10), 10);
    const ema20 = calculateEMA(closes.slice(-20), 20);

    // For LONG: short EMA below long EMA = bearish reversal
    if (ema10 < ema20) {
      const pctBelow = ((ema20 - ema10) / ema20) * 100;
      return {
        signal: "EMA_REVERSAL",
        score: 2,
        detail: `EMA10 ${pctBelow.toFixed(2)}% below EMA20`,
      };
    }
    return null;
  }

  evaluateMacdReversal(candles: OHLCCandle[]): SignalContribution | null {
    if (!candles || candles.length < 26) return null;
    const closes = candles.map(c => c.close);
    const macd = calculateMACD(closes);

    if (macd.histogram < 0 && macd.macd < macd.signal) {
      return {
        signal: "MACD_REVERSAL",
        score: 1,
        detail: `MACD bearish (hist=${macd.histogram.toFixed(4)})`,
      };
    }
    return null;
  }

  evaluateVolumeDrop(candles: OHLCCandle[], volumeRatio?: number): SignalContribution | null {
    let ratio = volumeRatio;
    if (ratio === undefined && candles && candles.length >= 10) {
      const avgVol = candles.slice(-10).reduce((s, c) => s + c.volume, 0) / 10;
      const lastVol = candles[candles.length - 1]?.volume ?? 0;
      ratio = avgVol > 0 ? lastVol / avgVol : 1;
    }
    if (ratio !== undefined && ratio < 0.7) {
      return {
        signal: "VOLUME_DROP",
        score: 1,
        detail: `Volume ratio ${ratio.toFixed(2)} < 0.7`,
      };
    }
    return null;
  }

  evaluateMtfAlignmentLoss(mtfTrend?: string | null): SignalContribution | null {
    if (!mtfTrend) return null;
    // For LONG positions: if MTF trend is no longer bullish, alignment is lost
    if (mtfTrend === "bearish" || mtfTrend === "neutral") {
      return {
        signal: "MTF_ALIGNMENT_LOSS",
        score: 2,
        detail: `MTF trend: ${mtfTrend}`,
      };
    }
    return null;
  }

  evaluateOrderbookImbalance(orderbookBias?: number | null): SignalContribution | null {
    if (orderbookBias === null || orderbookBias === undefined) return null;
    // orderbookBias: -1 (full sell pressure) to +1 (full buy pressure)
    // For LONG: negative bias = sell pressure
    if (orderbookBias < -0.3) {
      return {
        signal: "ORDERBOOK_IMBALANCE",
        score: 1,
        detail: `Orderbook sell bias: ${orderbookBias.toFixed(2)}`,
      };
    }
    return null;
  }

  evaluateExchangeFlowPressure(netflow?: number | null): SignalContribution | null {
    if (netflow === null || netflow === undefined) return null;
    // Positive netflow = coins flowing INTO exchange (sell pressure)
    if (netflow > 0) {
      return {
        signal: "EXCHANGE_FLOW_PRESSURE",
        score: 1,
        detail: `Exchange net inflow: ${netflow.toFixed(2)}`,
      };
    }
    return null;
  }

  evaluateEntrySignalDeterioration(
    position: SmartExitPosition,
    candles: OHLCCandle[],
    mtfTrend?: string | null,
    volumeRatio?: number
  ): SignalContribution | null {
    const ctx = position.entryContext;
    if (!ctx) return null;

    let currentSignals = 0;
    if (candles && candles.length >= 20) {
      const closes = candles.map(c => c.close);
      const ema10 = calculateEMA(closes.slice(-10), 10);
      const ema20 = calculateEMA(closes.slice(-20), 20);
      if (ema10 > ema20) currentSignals++;

      if (candles.length >= 26) {
        const macd = calculateMACD(closes);
        if (macd.histogram > 0 && macd.macd > macd.signal) currentSignals++;
      }

      // Volume
      const vr = volumeRatio ?? (candles.slice(-10).reduce((s, c) => s + c.volume, 0) / 10 > 0
        ? (candles[candles.length - 1]?.volume ?? 0) / (candles.slice(-10).reduce((s, c) => s + c.volume, 0) / 10)
        : 1);
      if (vr > 1.0) currentSignals++;
    }

    // MTF
    if (mtfTrend === "bullish") currentSignals++;

    const lossSignals = ctx.entrySignalsCount - currentSignals;

    if (lossSignals >= 3) {
      return {
        signal: "ENTRY_SIGNAL_DETERIORATION",
        score: 3,
        detail: `Signals: entry=${ctx.entrySignalsCount} current=${currentSignals} lost=${lossSignals}`,
      };
    }
    if (lossSignals >= 2) {
      return {
        signal: "ENTRY_SIGNAL_DETERIORATION",
        score: 2,
        detail: `Signals: entry=${ctx.entrySignalsCount} current=${currentSignals} lost=${lossSignals}`,
      };
    }
    return null;
  }

  evaluateStagnation(
    position: SmartExitPosition,
    config: SmartExitConfig,
    candles?: OHLCCandle[]
  ): SignalContribution | null {
    const ageSec = (Date.now() - position.openedAt) / 1000;
    const ageMin = ageSec / 60;

    if (ageMin >= config.stagnationMinutes && Math.abs(position.pnlPct) < config.stagnationMinPnlPct) {
      return {
        signal: "STAGNATION",
        score: 1,
        detail: `Position ${ageMin.toFixed(0)}min old, PnL=${position.pnlPct.toFixed(2)}% < ${config.stagnationMinPnlPct}%`,
      };
    }
    return null;
  }

  // ─── Main Evaluation ────────────────────────────────────────────────────

  evaluate(
    position: SmartExitPosition,
    market: SmartExitMarketData,
    config: SmartExitConfig
  ): SmartExitDecision {
    const positionAgeSec = (Date.now() - position.openedAt) / 1000;

    // Detect regime
    const regime = market.candles
      ? this.detectMarketRegime(market.candles)
      : "CHOP";

    // Build base threshold
    const baseThreshold = config.signals.marketRegimeAdjustment
      ? (config.regimeThresholds[regime] ?? config.exitScoreThresholdBase)
      : config.exitScoreThresholdBase;

    // Adjust for loss
    const effectiveThreshold = position.pnlPct <= 0
      ? baseThreshold + config.extraLossThresholdPenalty
      : baseThreshold;

    // Guard: don't exit if loss is smaller than configured minimum loss threshold
    // (0 = disabled; only activates for negative PnL)
    if (config.minPnlLossPct < 0 && position.pnlPct < 0 && position.pnlPct > config.minPnlLossPct) {
      return {
        shouldExit: false,
        score: 0,
        threshold: effectiveThreshold,
        regime,
        confirmationProgress: 0,
        confirmationRequired: config.confirmationCycles,
        reasons: [`PnL ${position.pnlPct.toFixed(2)}% above min loss threshold ${config.minPnlLossPct}%`],
        contributions: [],
        positionAgeSec,
        pnlPct: position.pnlPct,
      };
    }

    // Too young — skip evaluation but still report regime
    if (positionAgeSec < config.minPositionAgeSec) {
      return {
        shouldExit: false,
        score: 0,
        threshold: effectiveThreshold,
        regime,
        confirmationProgress: 0,
        confirmationRequired: config.confirmationCycles,
        reasons: [],
        contributions: [],
        positionAgeSec,
        pnlPct: position.pnlPct,
      };
    }

    // Evaluate all signals
    const contributions: SignalContribution[] = [];
    const candles = market.candles;

    if (config.signals.emaReversal && candles) {
      const r = this.evaluateEmaReversal(candles);
      if (r) contributions.push(r);
    }

    if (config.signals.macdReversal && candles) {
      const r = this.evaluateMacdReversal(candles);
      if (r) contributions.push(r);
    }

    if (config.signals.volumeDrop) {
      const r = this.evaluateVolumeDrop(candles ?? [], market.volumeRatio);
      if (r) contributions.push(r);
    }

    if (config.signals.mtfAlignmentLoss) {
      const r = this.evaluateMtfAlignmentLoss(market.mtfTrend);
      if (r) contributions.push(r);
    }

    if (config.signals.orderbookImbalance) {
      const r = this.evaluateOrderbookImbalance(market.orderbookBias);
      if (r) contributions.push(r);
    }

    if (config.signals.exchangeFlows) {
      const r = this.evaluateExchangeFlowPressure(market.exchangeNetflow);
      if (r) contributions.push(r);
    }

    if (config.signals.entrySignalDeterioration && candles) {
      const r = this.evaluateEntrySignalDeterioration(
        position, candles, market.mtfTrend, market.volumeRatio
      );
      if (r) contributions.push(r);
    }

    if (config.signals.stagnationExit) {
      const r = this.evaluateStagnation(position, config, candles);
      if (r) contributions.push(r);
    }

    const totalScore = contributions.reduce((s, c) => s + c.score, 0);
    const reasons = contributions.map(c => c.signal);

    // Confirmation tracking
    const state = this.getOrCreateConfirmation(position.lotId);
    const meetsThreshold = totalScore >= effectiveThreshold;

    if (meetsThreshold) {
      state.consecutiveCycles++;
    } else {
      state.consecutiveCycles = 0;
    }
    state.lastScore = totalScore;

    // Regime change tracking — save old regime BEFORE overwriting
    // shouldNotifyRegimeChange compares previousRegime (old) vs decision.regime (new)
    state.previousRegime = state.lastRegime;
    state.lastRegime = regime;

    const shouldExit = meetsThreshold && state.consecutiveCycles >= config.confirmationCycles;

    return {
      shouldExit,
      score: totalScore,
      threshold: effectiveThreshold,
      regime,
      confirmationProgress: Math.min(state.consecutiveCycles, config.confirmationCycles),
      confirmationRequired: config.confirmationCycles,
      reasons,
      contributions,
      positionAgeSec,
      pnlPct: position.pnlPct,
    };
  }

  // ─── Confirmation state management ──────────────────────────────────────

  private getOrCreateConfirmation(lotId: string): ConfirmationState {
    if (!this.confirmationMap.has(lotId)) {
      this.confirmationMap.set(lotId, {
        consecutiveCycles: 0,
        lastScore: 0,
        lastRegime: "CHOP",
        lastThresholdHitNotifiedAt: 0,
        lastRegimeChangeNotifiedAt: 0,
        previousRegime: null,
        thresholdHitSent: false,
      });
    }
    return this.confirmationMap.get(lotId)!;
  }

  getConfirmationState(lotId: string): ConfirmationState | undefined {
    return this.confirmationMap.get(lotId);
  }

  resetConfirmation(lotId: string): void {
    this.confirmationMap.delete(lotId);
  }

  // ─── Telegram notification helpers ──────────────────────────────────────

  shouldNotifyThresholdHit(
    lotId: string,
    decision: SmartExitDecision,
    config: SmartExitConfig
  ): boolean {
    if (!config.notifications.enabled || !config.notifications.notifyOnThresholdHit) return false;
    if (decision.score < config.notifications.minScoreToNotify) return false;
    if (decision.score < decision.threshold) return false;

    const state = this.getOrCreateConfirmation(lotId);
    const now = Date.now();

    if (config.notifications.oneAlertPerEvent && state.thresholdHitSent) return false;

    if (now - state.lastThresholdHitNotifiedAt < config.notifications.cooldownSec * 1000) {
      return false;
    }

    return true;
  }

  markThresholdHitNotified(lotId: string): void {
    const state = this.getOrCreateConfirmation(lotId);
    state.lastThresholdHitNotifiedAt = Date.now();
    state.thresholdHitSent = true;
  }

  shouldNotifyRegimeChange(
    lotId: string,
    decision: SmartExitDecision,
    config: SmartExitConfig
  ): boolean {
    if (!config.notifications.enabled || !config.notifications.notifyOnRegimeChange) return false;

    const state = this.getOrCreateConfirmation(lotId);
    const now = Date.now();

    if (state.previousRegime === null || state.previousRegime === decision.regime) return false;
    if (now - state.lastRegimeChangeNotifiedAt < config.notifications.cooldownSec * 1000) {
      return false;
    }

    return true;
  }

  markRegimeChangeNotified(lotId: string): void {
    const state = this.getOrCreateConfirmation(lotId);
    state.lastRegimeChangeNotifiedAt = Date.now();
  }

  // ─── Telegram message builders ──────────────────────────────────────────

  buildTelegramSnapshot(
    decision: SmartExitDecision,
    position: SmartExitPosition,
    eventType: "THRESHOLD_HIT" | "EXECUTED" | "REGIME_CHANGE"
  ): string {
    const actionText = eventType === "EXECUTED"
      ? "🔴 <b>CIERRE EJECUTADO</b>"
      : eventType === "THRESHOLD_HIT"
        ? "⚡ <b>Condición detectada</b>"
        : "🔄 <b>Cambio de régimen</b>";

    const reasonsList = decision.reasons.length > 0
      ? decision.reasons.map(r => `   • ${r}`).join("\n")
      : "   • (ninguna)";

    const pnlEmoji = decision.pnlPct >= 0 ? "📈" : "📉";
    const confirmText = `${decision.confirmationProgress}/${decision.confirmationRequired}`;

    return `🤖 <b>SMART EXIT</b> 🧪
━━━━━━━━━━━━━━━━━━━
${actionText}

📦 <b>Posición:</b>
   • Par: <code>${position.pair}</code>
   • Entrada: <code>$${position.entryPrice.toFixed(2)}</code>
   ${pnlEmoji} PnL: <code>${decision.pnlPct >= 0 ? "+" : ""}${decision.pnlPct.toFixed(2)}%</code>

📊 <b>Análisis:</b>
   • Régimen: <code>${decision.regime}</code>
   • Score: <code>${decision.score}/${decision.threshold}</code>
   • Confirmación: <code>${confirmText}</code>

🔍 <b>Señales:</b>
${reasonsList}
━━━━━━━━━━━━━━━━━━━`;
  }

  // ─── Entry Context Builder ──────────────────────────────────────────────

  buildEntryContext(
    signalsCount: number,
    candles: OHLCCandle[],
    mtfTrend?: string,
    regime?: string,
    volumeRatio?: number
  ): EntryContext {
    let emaAlignment = false;
    let macdBullish = false;

    if (candles && candles.length >= 20) {
      const closes = candles.map(c => c.close);
      const ema10 = calculateEMA(closes.slice(-10), 10);
      const ema20 = calculateEMA(closes.slice(-20), 20);
      emaAlignment = ema10 > ema20;

      if (candles.length >= 26) {
        const macd = calculateMACD(closes);
        macdBullish = macd.histogram > 0 && macd.macd > macd.signal;
      }
    }

    return {
      entrySignalsCount: signalsCount,
      emaAlignment,
      macdBullish,
      volumeStrong: (volumeRatio ?? 0) > 1.0,
      mtfTrend: mtfTrend || "unknown",
      regimeAtEntry: regime || "unknown",
      timestamp: new Date().toISOString(),
    };
  }

  // ─── Diagnostics ────────────────────────────────────────────────────────

  getDiagnostics(
    lotId: string,
    decision?: SmartExitDecision | null,
    config?: SmartExitConfig | null
  ): Record<string, any> {
    const state = this.confirmationMap.get(lotId);
    return {
      smartExitEnabled: config?.enabled ?? false,
      smartExitScore: decision?.score ?? null,
      smartExitThreshold: decision?.threshold ?? null,
      smartExitRegime: decision?.regime ?? state?.lastRegime ?? null,
      smartExitSignalsTriggered: decision?.reasons ?? [],
      smartExitConfirmationProgress: decision?.confirmationProgress ?? state?.consecutiveCycles ?? 0,
      smartExitConfirmationRequired: decision?.confirmationRequired ?? config?.confirmationCycles ?? 3,
      smartExitWouldExit: decision?.shouldExit ?? false,
    };
  }
}

// Singleton instance
export const smartExitEngine = new SmartExitEngine();
