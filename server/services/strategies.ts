/**
 * strategies.ts — Pure trading strategy signal generators.
 * Extracted from tradingEngine.ts to reduce monolith size.
 *
 * Every function is stateless: it receives market data and returns a TradeSignal.
 * Indicator helpers are imported from indicators.ts.
 */

import {
  calculateEMA,
  calculateRSI,
  calculateVolatility,
  calculateMACD,
  calculateBollingerBands,
  calculateATR,
  calculateATRPercent,
  detectAbnormalVolume,
  type PriceData,
  type OHLCCandle,
} from "./indicators";
import type { MarketRegime } from "./regimeDetection";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TradeSignal {
  action: "buy" | "sell" | "hold";
  pair: string;
  confidence: number;
  reason: string;
  // Signal count diagnostics (for PAIR_DECISION_TRACE)
  signalsCount?: number;      // Number of signals in favor of action
  minSignalsRequired?: number; // Minimum signals required for action
  hybridGuard?: { watchId: number; reason: "ANTI_CRESTA" | "MTF_STRICT" };
}

export interface TrendAnalysis {
  shortTerm: "bullish" | "bearish" | "neutral";
  mediumTerm: "bullish" | "bearish" | "neutral";
  longTerm: "bullish" | "bearish" | "neutral";
  alignment: number;
  summary: string;
}

// ─── Cycle-mode strategies (PriceData history) ───────────────────────────────

export function momentumStrategy(pair: string, history: PriceData[], currentPrice: number): TradeSignal {
  const prices = history.map(h => h.price);
  const shortEMA = calculateEMA(prices.slice(-10), 10);
  const longEMA = calculateEMA(prices.slice(-20), 20);
  const rsi = calculateRSI(prices.slice(-14));
  const macd = calculateMACD(prices);
  const bollinger = calculateBollingerBands(prices);
  const volumeAnalysis = detectAbnormalVolume(history);

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
      reason: `Momentum alcista: ${buyReasons.join(", ")} | Señales: ${buySignals}/${sellSignals}`,
      signalsCount: buySignals,
      minSignalsRequired,
    };
  }

  if (sellSignals >= minSignalsRequired && sellSignals > buySignals && rsi > 30) {
    return {
      action: "sell",
      pair,
      confidence,
      reason: `Momentum bajista: ${sellReasons.join(", ")} | Señales: ${sellSignals}/${buySignals}`,
      signalsCount: sellSignals,
      minSignalsRequired,
    };
  }

  // No signal: provide detailed diagnostic reason
  const dominantCount = Math.max(buySignals, sellSignals);
  const dominantSide = buySignals >= sellSignals ? "buy" : "sell";

  let blockReason = "";
  if (dominantCount < minSignalsRequired) {
    blockReason = `señales insuficientes (${dominantCount}/${minSignalsRequired})`;
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
    reason: `Sin señal clara momentum: ${blockReason} | buy=${buySignals}/sell=${sellSignals}`,
    signalsCount: dominantCount,
    minSignalsRequired,
  };
}

export function meanReversionStrategy(pair: string, history: PriceData[], currentPrice: number): TradeSignal {
  const prices = history.map(h => h.price);
  const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
  const stdDev = Math.sqrt(prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length);
  const zScore = (currentPrice - mean) / stdDev;

  const bollinger = calculateBollingerBands(prices);
  const rsi = calculateRSI(prices.slice(-14));
  const volumeAnalysis = detectAbnormalVolume(history);

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
      reasons.push("Volumen de capitulación");
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

export function scalpingStrategy(pair: string, history: PriceData[], currentPrice: number): TradeSignal {
  // Scalping uses threshold-based signals
  const minSignalsRequired = 1;

  if (history.length < 15) {
    return { action: "hold", pair, confidence: 0, reason: "Datos insuficientes para scalping", signalsCount: 0, minSignalsRequired };
  }

  const prices = history.map(h => h.price);
  const recentPrices = prices.slice(-5);
  const avgPrice = recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length;
  const priceChange = (currentPrice - avgPrice) / avgPrice * 100;

  const volatility = calculateVolatility(recentPrices);
  const rsi = calculateRSI(prices.slice(-14));
  const volumeAnalysis = detectAbnormalVolume(history);
  const macd = calculateMACD(prices);
  const atrPercent = calculateATRPercent(history, 14);

  const reasons: string[] = [];
  let confidence = 0.65;

  // Filtro de volatilidad mínima usando ATR
  if (atrPercent < 0.1) {
    return { action: "hold", pair, confidence: 0.2, reason: `Volatilidad ATR muy baja (${atrPercent.toFixed(2)}%)`, signalsCount: 0, minSignalsRequired };
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
      signalsCount: 1,
      minSignalsRequired,
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

export function gridStrategy(pair: string, history: PriceData[], currentPrice: number): TradeSignal {
  // Grid uses level-based signals
  const minSignalsRequired = 1;

  if (history.length < 15) {
    return { action: "hold", pair, confidence: 0, reason: "Datos insuficientes para grid", signalsCount: 0, minSignalsRequired };
  }

  const prices = history.map(h => h.price);
  const high = Math.max(...prices);
  const low = Math.min(...prices);

  // Usar ATR para determinar el espaciado del grid dinámicamente
  const atr = calculateATR(history, 14);
  const atrPercent = calculateATRPercent(history, 14);

  // El grid size se basa en ATR para adaptarse a la volatilidad del mercado
  // Usamos 1.5x ATR como espaciado entre niveles del grid
  const atrBasedGridSize = atr * 1.5;
  const rangeBasedGridSize = (high - low) / 5;

  // Usamos el mayor de los dos para evitar niveles demasiado cercanos
  const gridSize = Math.max(atrBasedGridSize, rangeBasedGridSize);

  if (gridSize <= 0) {
    return { action: "hold", pair, confidence: 0, reason: "Grid size inválido", signalsCount: 0, minSignalsRequired };
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

// ─── Candle-mode strategies (OHLCCandle[]) ───────────────────────────────────

export function momentumCandlesStrategy(pair: string, candles: OHLCCandle[], currentPrice: number, adjustedMinSignals?: number): TradeSignal {
  const minSignalsRequired = adjustedMinSignals ?? 5; // Default 5, but can be overridden (e.g., 4 for TRANSITION)

  if (candles.length < 20) {
    return { action: "hold", pair, confidence: 0, reason: "Historial de velas insuficiente", signalsCount: 0, minSignalsRequired };
  }

  const closes = candles.map(c => c.close);
  const shortEMA = calculateEMA(closes.slice(-10), 10);
  const longEMA = calculateEMA(closes.slice(-20), 20);
  const rsi = calculateRSI(closes.slice(-14));
  const macd = calculateMACD(closes);
  const bollinger = calculateBollingerBands(closes);

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

  // B2: Filtro anti-FOMO - bloquear BUY en condiciones de entrada tardía
  const isAntifomoTriggered = rsi > 65 && bollinger.percentB > 85 && bodyRatio > 0.7;

  if (buySignals >= minSignalsRequired && buySignals > sellSignals && rsi < 70) {
    // B2: Verificar anti-FOMO antes de emitir señal BUY
    if (isAntifomoTriggered) {
      return {
        action: "hold",
        pair,
        confidence: 0.4,
        reason: `Anti-FOMO: RSI=${rsi.toFixed(0)} BB%=${bollinger.percentB.toFixed(0)} bodyRatio=${bodyRatio.toFixed(2)} | Señales: ${buySignals}/${sellSignals}`,
        signalsCount: buySignals,
        minSignalsRequired,
      };
    }
    return {
      action: "buy",
      pair,
      confidence,
      reason: `Momentum Velas COMPRA: ${buyReasons.join(", ")} | Señales: ${buySignals}/${sellSignals}`,
      signalsCount: buySignals,
      minSignalsRequired,
    };
  }

  if (sellSignals >= minSignalsRequired && sellSignals > buySignals && rsi > 30) {
    return {
      action: "sell",
      pair,
      confidence,
      reason: `Momentum Velas VENTA: ${sellReasons.join(", ")} | Señales: ${sellSignals}/${buySignals}`,
      signalsCount: sellSignals,
      minSignalsRequired,
    };
  }

  // No signal: provide detailed diagnostic reason
  const dominantCount = Math.max(buySignals, sellSignals);
  const dominantSide = buySignals >= sellSignals ? "buy" : "sell";

  let blockReason = "";
  if (dominantCount < minSignalsRequired) {
    blockReason = `señales insuficientes (${dominantCount}/${minSignalsRequired})`;
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
    reason: `Sin señal clara velas: ${blockReason} | buy=${buySignals}/sell=${sellSignals}`,
    signalsCount: dominantCount,
    minSignalsRequired,
  };
}

export function meanReversionSimpleStrategy(pair: string, candles: OHLCCandle[], currentPrice: number): TradeSignal {
  const minSignalsRequired = 2; // Simpler strategy: BB touch + RSI confirmation

  if (candles.length < 20) {
    return { action: "hold", pair, confidence: 0, reason: "Historial insuficiente para Mean Reversion", signalsCount: 0, minSignalsRequired };
  }

  const closes = candles.map(c => c.close);
  const rsi = calculateRSI(closes.slice(-14));
  const bollinger = calculateBollingerBands(closes);

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
    reasons.push("Vela bajista fuerte (penalización)");
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
      reason: `Mean Reversion COMPRA: ${reasons.join(", ")} | Señales: ${buySignals}`,
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
  //     reason: `Mean Reversion VENTA: ${reasons.join(", ")} | Señales: ${sellSignals}`,
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
    reason: `Mean Reversion sin señal: ${dominantSide}=${dominantCount} < min=${minSignalsRequired} | RSI=${rsi.toFixed(0)} BB%=${bollinger.percentB.toFixed(0)}`,
    signalsCount: dominantCount,
    minSignalsRequired,
  };
}

// ─── MTF Filter (used by both modes) ────────────────────────────────────────

export function applyMTFFilter(
  signal: TradeSignal,
  mtf: TrendAnalysis,
  regime?: MarketRegime | string | null
): { filtered: boolean; confidenceBoost: number; reason: string; filterType?: "MTF_STRICT" | "MTF_STANDARD" } {
  if (signal.action === "buy") {
    // === MTF ESTRICTO POR RÉGIMEN (Fase 2.4) ===
    // En TRANSITION: exigir MTF >= 0.3 para compras
    // En RANGE: exigir MTF >= 0.2 para compras
    // Esto evita compras contra tendencia mayor en regímenes inestables
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

    // Filtros estándar existentes
    if (mtf.longTerm === "bearish" && mtf.mediumTerm === "bearish") {
      return { filtered: true, confidenceBoost: 0, reason: "Tendencia 1h y 4h bajista", filterType: "MTF_STANDARD" };
    }
    if (mtf.alignment < -0.5) {
      return { filtered: true, confidenceBoost: 0, reason: `Alineación MTF negativa (${mtf.alignment.toFixed(2)})`, filterType: "MTF_STANDARD" };
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
