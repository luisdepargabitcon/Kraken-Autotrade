/**
 * MTF Analysis — Multi-Timeframe data fetching, caching, diagnostic, and trend analysis.
 * Extracted from TradingEngine for modularity.
 */

import { log } from "../utils/logger";
import { calculateEMA } from "./indicators";
import type { OHLCCandle } from "./indicators";

// === Types ===

export interface MultiTimeframeData {
  tf5m: OHLCCandle[];
  tf1h: OHLCCandle[];
  tf4h: OHLCCandle[];
  lastUpdate: number;
}

export interface TrendAnalysis {
  shortTerm: "bullish" | "bearish" | "neutral";
  mediumTerm: "bullish" | "bearish" | "neutral";
  longTerm: "bullish" | "bearish" | "neutral";
  alignment: number;
  confidence: number;
  summary: string;
}

// === Constants ===

const MTF_DIAG_ENABLED = true;
const MTF_CACHE_TTL = 300000; // 5 minutes

// === Host interface ===

export interface IMtfAnalysisHost {
  getOHLC(pair: string, intervalMinutes: number): Promise<OHLCCandle[]>;
}

// === Pure functions ===

export function analyzeTimeframeTrend(candles: OHLCCandle[]): "bullish" | "bearish" | "neutral" {
  if (candles.length < 10) return "neutral";

  const closes = candles.map(c => c.close);
  const ema10 = calculateEMA(closes.slice(-10), 10);
  const ema20 = calculateEMA(closes.slice(-20), 20);
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

export function analyzeMultiTimeframe(mtfData: MultiTimeframeData): TrendAnalysis {
  const shortTerm = analyzeTimeframeTrend(mtfData.tf5m);
  const mediumTerm = analyzeTimeframeTrend(mtfData.tf1h);
  const longTerm = analyzeTimeframeTrend(mtfData.tf4h);

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

export function emitMTFDiagnostic(pair: string, tf5m: OHLCCandle[], tf1h: OHLCCandle[], tf4h: OHLCCandle[]): void {
  const formatTs = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 16);
  const calcSpanHours = (candles: OHLCCandle[]) => {
    if (candles.length < 2) return 0;
    return ((candles[candles.length - 1].time - candles[0].time) / 3600).toFixed(1);
  };

  const span5m = calcSpanHours(tf5m);
  const span1h = calcSpanHours(tf1h);
  const span4h = calcSpanHours(tf4h);

  const first5m = tf5m[0]?.time || 0;
  const first1h = tf1h[0]?.time || 0;
  const first4h = tf4h[0]?.time || 0;
  const last5m = tf5m[tf5m.length - 1]?.time || 0;
  const last1h = tf1h[tf1h.length - 1]?.time || 0;
  const last4h = tf4h[tf4h.length - 1]?.time || 0;

  // Detectar duplicación real (más restrictivo para evitar falsos positivos)
  // Solo alertar si hay evidencia clara de datos incorrectos
  const exactFirstMatch = (first5m === first1h && first1h === first4h && first5m > 0);
  const exactLastMatch = (last5m === last1h && last1h === last4h && last5m > 0);
  const identicalSpans = (span5m === span1h && span1h === span4h && parseFloat(String(span5m)) > 0);

  // Detectar casos sospechosos pero menos críticos
  const suspiciousOverlap = (
    (Math.abs(last5m - last1h) < 3600) || // Menos de 1h de diferencia entre 5m y 1h
    (Math.abs(last1h - last4h) < 7200)    // Menos de 2h de diferencia entre 1h y 4h
  ) && tf5m.length > 10 && tf1h.length > 10 && tf4h.length > 10;

  log(`[MTF_DIAG] ${pair}: ` +
    `5m: ${tf5m.length} velas [${formatTs(first5m)} -> ${formatTs(last5m)}] span=${span5m}h | ` +
    `1h: ${tf1h.length} velas [${formatTs(first1h)} -> ${formatTs(last1h)}] span=${span1h}h | ` +
    `4h: ${tf4h.length} velas [${formatTs(first4h)} -> ${formatTs(last4h)}] span=${span4h}h`, "trading");

  // Solo alertar en casos realmente problemáticos
  if (exactFirstMatch || exactLastMatch || identicalSpans) {
    log(`[MTF_DIAG] \u{1F6A8} ERROR ${pair}: Duplicación MTF CRÍTICA detectada! ` +
      `exactFirst=${exactFirstMatch}, exactLast=${exactLastMatch}, identicalSpans=${identicalSpans}`, "trading");
  } else if (suspiciousOverlap) {
    log(`[MTF_DIAG] \u26A0\uFE0F INFO ${pair}: Solapamiento temporal detectado (puede ser normal en mercados activos)`, "trading");
  }
}

// === MtfAnalyzer class (stateful: cache) ===

export class MtfAnalyzer {
  private host: IMtfAnalysisHost;
  private mtfCache: Map<string, MultiTimeframeData> = new Map();

  constructor(host: IMtfAnalysisHost) {
    this.host = host;
  }

  async getMultiTimeframeData(pair: string): Promise<MultiTimeframeData | null> {
    try {
      const cached = this.mtfCache.get(pair);
      if (cached && Date.now() - cached.lastUpdate < MTF_CACHE_TTL) {
        return cached;
      }

      const [tf5m, tf1h, tf4h] = await Promise.all([
        this.host.getOHLC(pair, 5),
        this.host.getOHLC(pair, 60),
        this.host.getOHLC(pair, 240),
      ]);

      const data: MultiTimeframeData = {
        tf5m: tf5m.slice(-50),
        tf1h: tf1h.slice(-50),
        tf4h: tf4h.slice(-50),
        lastUpdate: Date.now(),
      };

      this.mtfCache.set(pair, data);
      log(`MTF datos actualizados para ${pair}: 5m=${tf5m.length}, 1h=${tf1h.length}, 4h=${tf4h.length}`, "trading");

      // MTF Diagnostic: Verificar rangos temporales
      if (MTF_DIAG_ENABLED && tf5m.length > 0 && tf1h.length > 0 && tf4h.length > 0) {
        emitMTFDiagnostic(pair, tf5m, tf1h, tf4h);
      }

      return data;
    } catch (error: any) {
      log(`Error obteniendo datos MTF para ${pair}: ${error.message}`, "trading");
      return null;
    }
  }
}
