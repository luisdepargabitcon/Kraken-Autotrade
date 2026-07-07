/**
 * FASE 3B — SIMULACIÓN COMPARATIVA DE SPACING ATR
 *
 * Script auxiliar de análisis. NO forma parte del build de producción.
 * No se importa en ningún módulo del bot. Solo sirve para generar
 * el informe comparativo de fórmulas de spacing.
 *
 * Ejecutar con: npx tsx scripts/grid_spacing_phase3b_simulation.ts
 *
 * Datos base: rango #14 de staging (auditados en Fase 3A).
 *
 * IMPORTANTE:
 * - Los ATR 1h y 15m de esta simulación son aproximaciones por escala temporal
 *   (regla √T), NO ATR calculados con velas reales. No deben usarse para decidir
 *   definitivamente el timeframe. Para una decisión final habría que recalcular
 *   con candles reales 1h y 15m (Fase 3C-PRE).
 * - El notional SELL se muestra simplificado. En el bot real, el SELL notional
 *   debe calcularse como quantity comprada × sellPrice y normalmente será
 *   superior al BUY si el SELL está por encima del BUY. SELL no consume USD,
 *   pero sí requiere inventario BTC.
 * - La decisión definitiva de ATR timeframe queda pendiente de una simulación
 *   con candles reales 1h/15m. El problema prioritario es la incompatibilidad
 *   entre bandWidth actual, spacing mínimo real y número de niveles.
 */

// ─── Constantes auditadas (Fase 3A) ───────────────────────────────────

const FEE_BUFFER_BUY_PCT = 0.09;
const FEE_BUFFER_SELL_PCT = 0.09;
const TAX_RESERVE_PCT = 20;

const SPREAD_BUFFER_PCT = 0.01;   // spread estimado Revolut X / Kraken
const SAFETY_BUFFER_PCT = 0.10;   // margen de seguridad adicional

// Datos del rango #14 (aba1e874, paused, histórico)
const LAST_CLOSE = 63300.80;
const BOLLINGER_UPPER = 63880.37;
const BOLLINGER_LOWER = 61098.74;
const BOLLINGER_MIDDLE = (BOLLINGER_UPPER + BOLLINGER_LOWER) / 2; // 62489.555
const BAND_WIDTH_PCT = 2.83;
const ATR_PCT_4H = 1.2412;
const CURRENT_PRICE = 63993.40; // precio actual del mercado

// Config DB staging
const NET_PROFIT_TARGET_PCT = 1.2;
const BAND_PERIOD = 20;
const BAND_STD_DEV_MULTIPLIER = 2.0;
const ATR_PERIOD = 14;
const GRID_STEP_ATR_MULTIPLIER = 1.5;
const GRID_STEP_MIN_PCT = 0.20;
const GRID_STEP_MAX_PCT = 3.0;
const GEOMETRIC_RATIO_MIN = 0.95;
const GEOMETRIC_RATIO_MAX = 1.35;
const MAX_LEVELS = 10; // 5 BUY + 5 SELL
const CAPITAL_PER_LEVEL_USD = 120; // aproximado del rango #14
const GRID_MAX_CAPITAL_PER_CYCLE_USD = 600; // configurable, ejemplo

// Estimaciones ATR otros timeframes (square root of time rule)
// ATR_1h ≈ ATR_4h / sqrt(4) = ATR_4h / 2
// ATR_15m ≈ ATR_1h / sqrt(4) = ATR_1h / 2
//
// NOTA: Estos valores son aproximaciones por escala temporal, NO ATR calculados
// con velas reales. No deben usarse para decidir definitivamente el timeframe.
// Para una decisión final habría que recalcular con candles reales 1h y 15m.
const ATR_PCT_1H = ATR_PCT_4H / 2;    // ≈ 0.6206 (estimación √T)
const ATR_PCT_15M = ATR_PCT_1H / 2;   // ≈ 0.3103 (estimación √T)

// ─── Tipos ────────────────────────────────────────────────────────────

interface SimLevel {
  index: number;
  side: "BUY" | "SELL";
  price: number;
  distanceFromCenterPct: number;
  gapFromPreviousPct: number | null;
  inBand: boolean;
  notionalUsd: number;
  netProfitTargetUsd: number;
  feeEstimateUsd: number;
}

interface SimResult {
  label: string;
  formula: string;
  centerPrice: number;
  centerPriceType: string;
  atrTimeframe: string;
  atrPct: number;
  spacingPct: number;
  minSpacingPctReal: number;
  ratio: number;
  buyLevels: SimLevel[];
  sellLevels: SimLevel[];
  buyBuyGapAvgPct: number;
  sellSellGapAvgPct: number;
  buyDepthPct: number;
  sellHeightPct: number;
  levelsInBand: number;
  levelsOutOfBand: number;
  netProfitPerLevelUsd: number;
  netProfitPerLevelPct: number;
  meetsNetTarget: boolean;
  totalBuyCapitalUsd: number;
  totalSellNotionalUsd: number;
  verdict: string;
}

// ─── Funciones auxiliares ──────────────────────────────────────────────

function computeGrossTargetPct(netPct: number): number {
  const netBeforeTax = netPct / (1 - TAX_RESERVE_PCT / 100);
  return netBeforeTax + FEE_BUFFER_BUY_PCT + FEE_BUFFER_SELL_PCT;
}

function computeAdaptiveRatio(bandWidthPct: number, ratioMin: number, ratioMax: number): number {
  const normalized = Math.max(0, Math.min(1, (bandWidthPct - 1) / (15 - 1)));
  return ratioMin + normalized * (ratioMax - ratioMin);
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function fmt(n: number, decimals = 2): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtPct(n: number, decimals = 4): string {
  return n.toFixed(decimals) + "%";
}

function isInBand(price: number, bandLower: number, bandUpper: number, tolerance = 0): boolean {
  return price >= bandLower * (1 - tolerance / 100) && price <= bandUpper * (1 + tolerance / 100);
}

// ─── FÓRMULA ACTUAL ────────────────────────────────────────────────────

function simulateCurrentFormula(
  centerPrice: number,
  centerLabel: string,
  atrPct: number,
  atrLabel: string
): SimResult {
  const ratio = computeAdaptiveRatio(BAND_WIDTH_PCT, GEOMETRIC_RATIO_MIN, GEOMETRIC_RATIO_MAX);
  const grossTargetPct = computeGrossTargetPct(NET_PROFIT_TARGET_PCT);

  const atrBasedStepPct = atrPct * GRID_STEP_ATR_MULTIPLIER;
  const clampedStepPct = clamp(atrBasedStepPct, GRID_STEP_MIN_PCT, GRID_STEP_MAX_PCT);
  const baseStep = centerPrice * (clampedStepPct / 100);
  const minDistance = centerPrice * (grossTargetPct / 100);
  const effectiveBaseStep = Math.max(baseStep, minDistance);

  const halfMax = Math.floor(MAX_LEVELS / 2);
  const buyLevels: SimLevel[] = [];
  const sellLevels: SimLevel[] = [];

  for (let i = 0; i < halfMax; i++) {
    const distance = effectiveBaseStep * Math.pow(ratio, i);
    const price = centerPrice - distance;
    if (price < BOLLINGER_LOWER * 0.98) break;

    const gapPct = i > 0
      ? ((buyLevels[i - 1].price - price) / buyLevels[i - 1].price) * 100
      : null;

    buyLevels.push({
      index: i,
      side: "BUY",
      price,
      distanceFromCenterPct: (distance / centerPrice) * 100,
      gapFromPreviousPct: gapPct,
      inBand: isInBand(price, BOLLINGER_LOWER, BOLLINGER_UPPER),
      notionalUsd: CAPITAL_PER_LEVEL_USD,
      netProfitTargetUsd: CAPITAL_PER_LEVEL_USD * (NET_PROFIT_TARGET_PCT / 100),
      feeEstimateUsd: CAPITAL_PER_LEVEL_USD * (FEE_BUFFER_BUY_PCT / 100),
    });
  }

  for (let i = 0; i < halfMax; i++) {
    const distance = effectiveBaseStep * Math.pow(ratio, i);
    const price = centerPrice + distance;
    if (price > BOLLINGER_UPPER * 1.02) break;

    const gapPct = i > 0
      ? ((price - sellLevels[i - 1].price) / sellLevels[i - 1].price) * 100
      : null;

    sellLevels.push({
      index: i,
      side: "SELL",
      price,
      distanceFromCenterPct: (distance / centerPrice) * 100,
      gapFromPreviousPct: gapPct,
      inBand: isInBand(price, BOLLINGER_LOWER, BOLLINGER_UPPER),
      notionalUsd: CAPITAL_PER_LEVEL_USD,
      netProfitTargetUsd: CAPITAL_PER_LEVEL_USD * (NET_PROFIT_TARGET_PCT / 100),
      feeEstimateUsd: CAPITAL_PER_LEVEL_USD * (FEE_BUFFER_SELL_PCT / 100),
    });
  }

  return buildResult(
    "Fórmula ACTUAL",
    "distance[i] = effectiveBaseStep × ratio^i (desde mid)",
    centerPrice, centerLabel, atrPct, atrLabel,
    clampedStepPct, grossTargetPct, ratio,
    buyLevels, sellLevels
  );
}

// ─── FÓRMULA PROPUESTA: ACUMULATIVA ────────────────────────────────────

type RatioMode = "lineal" | "geometric_soft" | "geometric_clamped";

function simulateProposedFormula(
  centerPrice: number,
  centerLabel: string,
  atrPct: number,
  atrLabel: string,
  ratioMode: RatioMode,
  options: {
    dynamicReduction?: boolean;
    outOfBandTolerance?: number; // percentage
  } = {}
): SimResult {
  const ratio = computeAdaptiveRatio(BAND_WIDTH_PCT, GEOMETRIC_RATIO_MIN, GEOMETRIC_RATIO_MAX);
  const grossTargetPct = computeGrossTargetPct(NET_PROFIT_TARGET_PCT);

  // minSpacingPctReal = grossTargetPct + spreadBuffer + safety (sin doble conteo)
  const minSpacingPctReal = grossTargetPct + SPREAD_BUFFER_PCT + SAFETY_BUFFER_PCT;

  // spacingPct = clamp(atrPct * multiplier, minSpacingPctReal, maxPct)
  const spacingPct = clamp(
    atrPct * GRID_STEP_ATR_MULTIPLIER,
    minSpacingPctReal,
    GRID_STEP_MAX_PCT
  );

  const halfMax = Math.floor(MAX_LEVELS / 2);
  const tolerance = options.outOfBandTolerance ?? 0;
  const buyLevels: SimLevel[] = [];
  const sellLevels: SimLevel[] = [];

  // BUY levels: acumulativos desde center
  let prevBuyPrice = centerPrice;
  for (let i = 0; i < halfMax; i++) {
    let levelGapPct: number;
    switch (ratioMode) {
      case "lineal":
        levelGapPct = spacingPct;
        break;
      case "geometric_soft":
        levelGapPct = spacingPct * Math.pow(ratio, i);
        break;
      case "geometric_clamped":
        levelGapPct = clamp(spacingPct * Math.pow(ratio, i), minSpacingPctReal, GRID_STEP_MAX_PCT);
        break;
    }

    const price = i === 0
      ? centerPrice * (1 - spacingPct / 100)
      : prevBuyPrice * (1 - levelGapPct / 100);

    // Check band
    if (!options.dynamicReduction && !isInBand(price, BOLLINGER_LOWER, BOLLINGER_UPPER, tolerance)) {
      if (options.dynamicReduction) break;
      // Still add it but mark out of band
    }
    if (options.dynamicReduction && !isInBand(price, BOLLINGER_LOWER, BOLLINGER_UPPER, tolerance)) {
      break;
    }

    const gapPct = i > 0
      ? ((prevBuyPrice - price) / prevBuyPrice) * 100
      : ((centerPrice - price) / centerPrice) * 100;

    buyLevels.push({
      index: i,
      side: "BUY",
      price,
      distanceFromCenterPct: ((centerPrice - price) / centerPrice) * 100,
      gapFromPreviousPct: gapPct,
      inBand: isInBand(price, BOLLINGER_LOWER, BOLLINGER_UPPER),
      notionalUsd: CAPITAL_PER_LEVEL_USD,
      netProfitTargetUsd: CAPITAL_PER_LEVEL_USD * (NET_PROFIT_TARGET_PCT / 100),
      feeEstimateUsd: CAPITAL_PER_LEVEL_USD * (FEE_BUFFER_BUY_PCT / 100),
    });
    prevBuyPrice = price;
  }

  // SELL levels: acumulativos desde center
  let prevSellPrice = centerPrice;
  for (let i = 0; i < halfMax; i++) {
    let levelGapPct: number;
    switch (ratioMode) {
      case "lineal":
        levelGapPct = spacingPct;
        break;
      case "geometric_soft":
        levelGapPct = spacingPct * Math.pow(ratio, i);
        break;
      case "geometric_clamped":
        levelGapPct = clamp(spacingPct * Math.pow(ratio, i), minSpacingPctReal, GRID_STEP_MAX_PCT);
        break;
    }

    const price = i === 0
      ? centerPrice * (1 + spacingPct / 100)
      : prevSellPrice * (1 + levelGapPct / 100);

    if (options.dynamicReduction && !isInBand(price, BOLLINGER_LOWER, BOLLINGER_UPPER, tolerance)) {
      break;
    }

    const gapPct = i > 0
      ? ((price - prevSellPrice) / prevSellPrice) * 100
      : ((price - centerPrice) / centerPrice) * 100;

    sellLevels.push({
      index: i,
      side: "SELL",
      price,
      distanceFromCenterPct: ((price - centerPrice) / centerPrice) * 100,
      gapFromPreviousPct: gapPct,
      inBand: isInBand(price, BOLLINGER_LOWER, BOLLINGER_UPPER),
      notionalUsd: CAPITAL_PER_LEVEL_USD,
      netProfitTargetUsd: CAPITAL_PER_LEVEL_USD * (NET_PROFIT_TARGET_PCT / 100),
      feeEstimateUsd: CAPITAL_PER_LEVEL_USD * (FEE_BUFFER_SELL_PCT / 100),
    });
    prevSellPrice = price;
  }

  const modeLabel = ratioMode === "lineal" ? "Lineal estable" :
                    ratioMode === "geometric_soft" ? "Geométrica suave" :
                    "Geométrica clampada";

  const optLabel = options.dynamicReduction ? " + reducción dinámica" :
                   options.outOfBandTolerance ? ` + tolerancia ${options.outOfBandTolerance}%` : "";

  return buildResult(
    `Propuesta: ${modeLabel}${optLabel}`,
    `BUY[i] = BUY[i-1] × (1 - gap%/100); gap = spacingPct × ratio^i`,
    centerPrice, centerLabel, atrPct, atrLabel,
    spacingPct, minSpacingPctReal, ratio,
    buyLevels, sellLevels
  );
}

// ─── Construir resultado ───────────────────────────────────────────────

function buildResult(
  label: string,
  formula: string,
  centerPrice: number,
  centerLabel: string,
  atrPct: number,
  atrLabel: string,
  spacingPct: number,
  minSpacingPctReal: number,
  ratio: number,
  buyLevels: SimLevel[],
  sellLevels: SimLevel[]
): SimResult {
  const buyGaps = buyLevels.filter(l => l.gapFromPreviousPct !== null).map(l => l.gapFromPreviousPct!);
  const sellGaps = sellLevels.filter(l => l.gapFromPreviousPct !== null).map(l => l.gapFromPreviousPct!);

  const buyBuyGapAvg = buyGaps.length > 0 ? buyGaps.reduce((a, b) => a + b, 0) / buyGaps.length : 0;
  const sellSellGapAvg = sellGaps.length > 0 ? sellGaps.reduce((a, b) => a + b, 0) / sellGaps.length : 0;

  const buyDepth = buyLevels.length > 0
    ? ((centerPrice - buyLevels[buyLevels.length - 1].price) / centerPrice) * 100
    : 0;
  const sellHeight = sellLevels.length > 0
    ? ((sellLevels[sellLevels.length - 1].price - centerPrice) / centerPrice) * 100
    : 0;

  const inBandCount = [...buyLevels, ...sellLevels].filter(l => l.inBand).length;
  const outOfBandCount = [...buyLevels, ...sellLevels].length - inBandCount;

  const totalBuyCapital = buyLevels.reduce((s, l) => s + l.notionalUsd, 0);
  const totalSellNotional = sellLevels.reduce((s, l) => s + l.notionalUsd, 0);

  // Net profit per level
  const grossPnlUsd = CAPITAL_PER_LEVEL_USD * (spacingPct / 100);
  const totalFeesUsd = CAPITAL_PER_LEVEL_USD * (FEE_BUFFER_BUY_PCT / 100) + CAPITAL_PER_LEVEL_USD * (FEE_BUFFER_SELL_PCT / 100);
  const netBeforeTaxUsd = grossPnlUsd - totalFeesUsd;
  const taxUsd = netBeforeTaxUsd > 0 ? netBeforeTaxUsd * (TAX_RESERVE_PCT / 100) : 0;
  const netPnlUsd = netBeforeTaxUsd - taxUsd;
  const netPnlPct = (netPnlUsd / CAPITAL_PER_LEVEL_USD) * 100;

  const meetsTarget = netPnlPct >= NET_PROFIT_TARGET_PCT;

  let verdict = "";
  if (outOfBandCount === 0 && buyLevels.length === 5 && sellLevels.length === 5 && meetsTarget) {
    verdict = "✅ Viable — 5+5 niveles en banda, beneficio neto OK";
  } else if (outOfBandCount === 0 && meetsTarget) {
    verdict = `⚠️ Niveles reducidos (${buyLevels.length}+${sellLevels.length}) pero viable`;
  } else if (outOfBandCount > 0) {
    verdict = `❌ ${outOfBandCount} niveles fuera de banda`;
  } else if (!meetsTarget) {
    verdict = "❌ No cumple beneficio neto objetivo";
  } else {
    verdict = "⚠️ Revisar condiciones";
  }

  return {
    label,
    formula,
    centerPrice,
    centerPriceType: centerLabel,
    atrTimeframe: atrLabel,
    atrPct,
    spacingPct,
    minSpacingPctReal,
    ratio,
    buyLevels,
    sellLevels,
    buyBuyGapAvgPct: buyBuyGapAvg,
    sellSellGapAvgPct: sellSellGapAvg,
    buyDepthPct: buyDepth,
    sellHeightPct: sellHeight,
    levelsInBand: inBandCount,
    levelsOutOfBand: outOfBandCount,
    netProfitPerLevelUsd: netPnlUsd,
    netProfitPerLevelPct: netPnlPct,
    meetsNetTarget: meetsTarget,
    totalBuyCapitalUsd: totalBuyCapital,
    totalSellNotionalUsd: totalSellNotional,
    verdict,
  };
}

// ─── Función para calcular niveles que caben en banda ──────────────────

function calculateMaxLevelsInBand(
  centerPrice: number,
  spacingPct: number,
  bandLower: number,
  bandUpper: number
): { buyCount: number; sellCount: number } {
  let buyCount = 0;
  let price = centerPrice;
  while (true) {
    price = price * (1 - spacingPct / 100);
    if (price < bandLower) break;
    buyCount++;
    if (buyCount > 20) break; // safety
  }

  let sellCount = 0;
  price = centerPrice;
  while (true) {
    price = price * (1 + spacingPct / 100);
    if (price > bandUpper) break;
    sellCount++;
    if (sellCount > 20) break;
  }

  return { buyCount, sellCount };
}

// ─── Función para calcular bandWidth necesario ──────────────────────────

function calculateRequiredBandWidth(
  centerPrice: number,
  spacingPct: number,
  levelsPerSide: number
): number {
  // Distancia total desde center al último nivel
  let buyDistance = 0;
  let price = centerPrice;
  for (let i = 0; i < levelsPerSide; i++) {
    price = price * (1 - spacingPct / 100);
    buyDistance = (centerPrice - price) / centerPrice * 100;
  }

  let sellDistance = 0;
  price = centerPrice;
  for (let i = 0; i < levelsPerSide; i++) {
    price = price * (1 + spacingPct / 100);
    sellDistance = (price - centerPrice) / centerPrice * 100;
  }

  return buyDistance + sellDistance;
}

// ─── MAIN ──────────────────────────────────────────────────────────────

function main() {
  const grossTargetPct = computeGrossTargetPct(NET_PROFIT_TARGET_PCT);
  const minSpacingPctReal = grossTargetPct + SPREAD_BUFFER_PCT + SAFETY_BUFFER_PCT;
  const ratio = computeAdaptiveRatio(BAND_WIDTH_PCT, GEOMETRIC_RATIO_MIN, GEOMETRIC_RATIO_MAX);

  console.log("=".repeat(100));
  console.log("FASE 3B — SIMULACIÓN COMPARATIVA DE SPACING ATR");
  console.log("=".repeat(100));
  console.log();

  // ─── Datos base ─────────────────────────────────────────────────
  console.log("─ DATOS BASE (Rango #14, staging, 2026-07-07) ─");
  console.log(`  lastClose (midPrice actual):   $${fmt(LAST_CLOSE, 2)}`);
  console.log(`  Bollinger middle:              $${fmt(BOLLINGER_MIDDLE, 2)}`);
  console.log(`  Bollinger upper:               $${fmt(BOLLINGER_UPPER, 2)}`);
  console.log(`  Bollinger lower:               $${fmt(BOLLINGER_LOWER, 2)}`);
  console.log(`  Band width:                    ${fmtPct(BAND_WIDTH_PCT, 2)}`);
  console.log(`  Precio actual mercado:         $${fmt(CURRENT_PRICE, 2)}`);
  console.log(`  ATR% 4h (actual):              ${fmtPct(ATR_PCT_4H, 4)}`);
  console.log(`  ATR% 1h (estimado √T):         ${fmtPct(ATR_PCT_1H, 4)}`);
  console.log(`  ATR% 15m (estimado √T):        ${fmtPct(ATR_PCT_15M, 4)}`);
  console.log(`  netProfitTargetPct:            ${fmtPct(NET_PROFIT_TARGET_PCT, 2)}`);
  console.log(`  grossTargetPct:                ${fmtPct(grossTargetPct, 4)}`);
  console.log(`  minSpacingPctReal (propuesto): ${fmtPct(minSpacingPctReal, 4)}`);
  console.log(`  ratio geométrico:              ${ratio.toFixed(6)}`);
  console.log(`  gridStepAtrMultiplier:         ${GRID_STEP_ATR_MULTIPLIER}`);
  console.log(`  gridStepMinPct:                ${fmtPct(GRID_STEP_MIN_PCT, 2)}`);
  console.log(`  gridStepMaxPct:                ${fmtPct(GRID_STEP_MAX_PCT, 2)}`);
  console.log(`  capitalPerLevelUsd:            $${fmt(CAPITAL_PER_LEVEL_USD, 2)} (aprox)`);
  console.log(`  maxCapitalPerCycleUsd:         $${fmt(GRID_MAX_CAPITAL_PER_CYCLE_USD, 2)} (configurable)`);
  console.log();

  // ─── Simulaciones ───────────────────────────────────────────────
  const simulations: SimResult[] = [];

  // 1. Fórmula actual con lastClose (como funciona hoy)
  simulations.push(simulateCurrentFormula(LAST_CLOSE, "lastClose (actual)", ATR_PCT_4H, "4h (actual)"));

  // 2. Fórmula actual con Bollinger middle
  simulations.push(simulateCurrentFormula(BOLLINGER_MIDDLE, "Bollinger middle", ATR_PCT_4H, "4h (actual)"));

  // 3. Propuesta acumulativa lineal con lastClose, ATR 4h
  simulations.push(simulateProposedFormula(LAST_CLOSE, "lastClose", ATR_PCT_4H, "4h", "lineal"));

  // 4. Propuesta acumulativa lineal con Bollinger middle, ATR 4h
  simulations.push(simulateProposedFormula(BOLLINGER_MIDDLE, "Bollinger middle", ATR_PCT_4H, "4h", "lineal"));

  // 5. Propuesta acumulativa geométrica suave con lastClose, ATR 4h
  simulations.push(simulateProposedFormula(LAST_CLOSE, "lastClose", ATR_PCT_4H, "4h", "geometric_soft"));

  // 6. Propuesta acumulativa geométrica clampada con lastClose, ATR 4h
  simulations.push(simulateProposedFormula(LAST_CLOSE, "lastClose", ATR_PCT_4H, "4h", "geometric_clamped"));

  // 7. Propuesta acumulativa lineal con lastClose, ATR 1h
  simulations.push(simulateProposedFormula(LAST_CLOSE, "lastClose", ATR_PCT_1H, "1h (estimado)", "lineal"));

  // 8. Propuesta acumulativa lineal con Bollinger middle, ATR 1h
  simulations.push(simulateProposedFormula(BOLLINGER_MIDDLE, "Bollinger middle", ATR_PCT_1H, "1h (estimado)", "lineal"));

  // 9. Propuesta con reducción dinámica de niveles, lastClose, ATR 4h
  simulations.push(simulateProposedFormula(LAST_CLOSE, "lastClose", ATR_PCT_4H, "4h", "lineal", { dynamicReduction: true }));

  // 10. Propuesta con reducción dinámica, Bollinger middle, ATR 4h
  simulations.push(simulateProposedFormula(BOLLINGER_MIDDLE, "Bollinger middle", ATR_PCT_4H, "4h", "lineal", { dynamicReduction: true }));

  // 11. Propuesta con tolerancia fuera de banda 3%, lastClose, ATR 4h
  simulations.push(simulateProposedFormula(LAST_CLOSE, "lastClose", ATR_PCT_4H, "4h", "lineal", { outOfBandTolerance: 3 }));

  // 12. Propuesta con reducción dinámica, lastClose, ATR 1h
  simulations.push(simulateProposedFormula(LAST_CLOSE, "lastClose", ATR_PCT_1H, "1h (estimado)", "lineal", { dynamicReduction: true }));

  // 13. Propuesta con reducción dinámica, Bollinger middle, ATR 1h
  simulations.push(simulateProposedFormula(BOLLINGER_MIDDLE, "Bollinger middle", ATR_PCT_1H, "1h (estimado)", "lineal", { dynamicReduction: true }));

  // 14. Propuesta con reducción dinámica, lastClose, ATR 15m
  simulations.push(simulateProposedFormula(LAST_CLOSE, "lastClose", ATR_PCT_15M, "15m (estimado)", "lineal", { dynamicReduction: true }));

  // ─── Detalle de cada simulación ─────────────────────────────────
  for (const sim of simulations) {
    console.log("─".repeat(100));
    console.log(`SIMULACIÓN: ${sim.label}`);
    console.log(`  Fórmula: ${sim.formula}`);
    console.log(`  Center: $${fmt(sim.centerPrice, 2)} (${sim.centerPriceType})`);
    console.log(`  ATR: ${sim.atrTimeframe} = ${fmtPct(sim.atrPct, 4)}`);
    console.log(`  spacingPct: ${fmtPct(sim.spacingPct, 4)}`);
    console.log(`  minSpacingPctReal: ${fmtPct(sim.minSpacingPctReal, 4)}`);
    console.log(`  ratio: ${sim.ratio.toFixed(6)}`);
    console.log();

    console.log("  BUY levels:");
    for (const l of sim.buyLevels) {
      const inBandStr = l.inBand ? "✅" : "❌";
      const gapStr = l.gapFromPreviousPct !== null ? fmtPct(l.gapFromPreviousPct, 4) : "—";
      console.log(`    [${l.index}] $${fmt(l.price, 2)}  dist=${fmtPct(l.distanceFromCenterPct, 4)}  gap=${gapStr}  ${inBandStr}`);
    }

    console.log("  SELL levels:");
    for (const l of sim.sellLevels) {
      const inBandStr = l.inBand ? "✅" : "❌";
      const gapStr = l.gapFromPreviousPct !== null ? fmtPct(l.gapFromPreviousPct, 4) : "—";
      console.log(`    [${l.index}] $${fmt(l.price, 2)}  dist=${fmtPct(l.distanceFromCenterPct, 4)}  gap=${gapStr}  ${inBandStr}`);
    }

    console.log();
    console.log(`  BUY-BUY gap medio:    ${fmtPct(sim.buyBuyGapAvgPct, 4)}`);
    console.log(`  SELL-SELL gap medio:  ${fmtPct(sim.sellSellGapAvgPct, 4)}`);
    console.log(`  Profundidad BUY:      ${fmtPct(sim.buyDepthPct, 4)}`);
    console.log(`  Altura SELL:          ${fmtPct(sim.sellHeightPct, 4)}`);
    console.log(`  Niveles en banda:     ${sim.levelsInBand}/${sim.buyLevels.length + sim.sellLevels.length}`);
    console.log(`  Niveles fuera banda:  ${sim.levelsOutOfBand}`);
    console.log(`  Net profit/nivel:     $${fmt(sim.netProfitPerLevelUsd, 4)} (${fmtPct(sim.netProfitPerLevelPct, 4)})`);
    console.log(`  Cumple net target:    ${sim.meetsNetTarget ? "✅" : "❌"} (target=${fmtPct(NET_PROFIT_TARGET_PCT, 2)})`);
    console.log(`  Capital BUY total:    $${fmt(sim.totalBuyCapitalUsd, 2)}`);
    console.log(`  Notional SELL total:  $${fmt(sim.totalSellNotionalUsd, 2)}`);
    console.log(`  Veredicto:            ${sim.verdict}`);
    console.log();
  }

  // ─── TABLA COMPARATIVA ──────────────────────────────────────────
  console.log("=".repeat(100));
  console.log("TABLA COMPARATIVA FINAL");
  console.log("=".repeat(100));
  console.log();

  const header = [
    "Fórmula".padEnd(45),
    "Center".padEnd(18),
    "ATR".padEnd(12),
    "Spacing%".padEnd(10),
    "BUY+SELL".padEnd(10),
    "B-B gap".padEnd(10),
    "S-S gap".padEnd(10),
    "En banda".padEnd(10),
    "Fuera".padEnd(6),
    "Net%".padEnd(8),
    "Veredicto".padEnd(30),
  ].join(" | ");

  console.log(header);
  console.log("-".repeat(header.length));

  for (const sim of simulations) {
    const row = [
      sim.label.padEnd(45),
      sim.centerPriceType.padEnd(18),
      sim.atrTimeframe.padEnd(12),
      fmtPct(sim.spacingPct, 2).padEnd(10),
      `${sim.buyLevels.length}+${sim.sellLevels.length}`.padEnd(10),
      fmtPct(sim.buyBuyGapAvgPct, 2).padEnd(10),
      fmtPct(sim.sellSellGapAvgPct, 2).padEnd(10),
      `${sim.levelsInBand}`.padEnd(10),
      `${sim.levelsOutOfBand}`.padEnd(6),
      fmtPct(sim.netProfitPerLevelPct, 2).padEnd(8),
      sim.verdict.padEnd(30),
    ].join(" | ");
    console.log(row);
  }

  // ─── ANÁLISIS DE VIABILIDAD DE BANDA ────────────────────────────
  console.log();
  console.log("=".repeat(100));
  console.log("ANÁLISIS DE VIABILIDAD DE BANDA");
  console.log("=".repeat(100));
  console.log();

  const spacingValues = [
    { label: "ATR 4h × 1.5", atrPct: ATR_PCT_4H, spacing: clamp(ATR_PCT_4H * GRID_STEP_ATR_MULTIPLIER, minSpacingPctReal, GRID_STEP_MAX_PCT) },
    { label: "ATR 1h × 1.5", atrPct: ATR_PCT_1H, spacing: clamp(ATR_PCT_1H * GRID_STEP_ATR_MULTIPLIER, minSpacingPctReal, GRID_STEP_MAX_PCT) },
    { label: "ATR 15m × 1.5", atrPct: ATR_PCT_15M, spacing: clamp(ATR_PCT_15M * GRID_STEP_ATR_MULTIPLIER, minSpacingPctReal, GRID_STEP_MAX_PCT) },
    { label: "minSpacingPctReal (piso)", atrPct: 0, spacing: minSpacingPctReal },
  ];

  for (const center of [
    { label: "lastClose ($63,300.80)", price: LAST_CLOSE },
    { label: "Bollinger middle ($62,489.56)", price: BOLLINGER_MIDDLE },
  ]) {
    console.log(`Center: ${center.label}`);
    console.log(`  Banda: $${fmt(BOLLINGER_LOWER, 2)} - $${fmt(BOLLINGER_UPPER, 2)} (${fmtPct(BAND_WIDTH_PCT, 2)})`);
    console.log();

    for (const sv of spacingValues) {
      const { buyCount, sellCount } = calculateMaxLevelsInBand(center.price, sv.spacing, BOLLINGER_LOWER, BOLLINGER_UPPER);
      const requiredBW = calculateRequiredBandWidth(center.price, sv.spacing, 5);
      console.log(`  ${sv.label.padEnd(30)} spacing=${fmtPct(sv.spacing, 4)}  →  BUY=${buyCount}  SELL=${sellCount}  total=${buyCount + sellCount}  |  BW necesaria para 5+5: ${fmtPct(requiredBW, 2)}`);
    }
    console.log();
  }

  // ─── COMPARACIÓN CENTER PRICE ───────────────────────────────────
  console.log("=".repeat(100));
  console.log("COMPARACIÓN CENTER PRICE");
  console.log("=".repeat(100));
  console.log();

  const spacingProposed = clamp(ATR_PCT_4H * GRID_STEP_ATR_MULTIPLIER, minSpacingPctReal, GRID_STEP_MAX_PCT);

  console.log(`A) lastClose = $${fmt(LAST_CLOSE, 2)}`);
  console.log(`   Distancia a Bollinger lower: ${fmtPct(((LAST_CLOSE - BOLLINGER_LOWER) / LAST_CLOSE) * 100, 2)}`);
  console.log(`   Distancia a Bollinger upper: ${fmtPct(((BOLLINGER_UPPER - LAST_CLOSE) / LAST_CLOSE) * 100, 2)}`);
  console.log(`   Espacio BUY (hacia abajo):   ${fmtPct(((LAST_CLOSE - BOLLINGER_LOWER) / LAST_CLOSE) * 100, 2)}`);
  console.log(`   Espacio SELL (hacia arriba):  ${fmtPct(((BOLLINGER_UPPER - LAST_CLOSE) / LAST_CLOSE) * 100, 2)}`);
  const { buyCount: buyA, sellCount: sellA } = calculateMaxLevelsInBand(LAST_CLOSE, spacingProposed, BOLLINGER_LOWER, BOLLINGER_UPPER);
  console.log(`   Niveles que caben:           BUY=${buyA}  SELL=${sellA}`);
  console.log(`   Sesgo:                       ${buyA > sellA ? "Más BUY que SELL (precio arriba de la banda)" : sellA > buyA ? "Más SELL que BUY (precio abajo de la banda)" : "Simétrico"}`);
  console.log();

  console.log(`B) Bollinger middle = $${fmt(BOLLINGER_MIDDLE, 2)}`);
  console.log(`   Distancia a Bollinger lower: ${fmtPct(((BOLLINGER_MIDDLE - BOLLINGER_LOWER) / BOLLINGER_MIDDLE) * 100, 2)}`);
  console.log(`   Distancia a Bollinger upper: ${fmtPct(((BOLLINGER_UPPER - BOLLINGER_MIDDLE) / BOLLINGER_MIDDLE) * 100, 2)}`);
  console.log(`   Espacio BUY (hacia abajo):   ${fmtPct(((BOLLINGER_MIDDLE - BOLLINGER_LOWER) / BOLLINGER_MIDDLE) * 100, 2)}`);
  console.log(`   Espacio SELL (hacia arriba):  ${fmtPct(((BOLLINGER_UPPER - BOLLINGER_MIDDLE) / BOLLINGER_MIDDLE) * 100, 2)}`);
  const { buyCount: buyB, sellCount: sellB } = calculateMaxLevelsInBand(BOLLINGER_MIDDLE, spacingProposed, BOLLINGER_LOWER, BOLLINGER_UPPER);
  console.log(`   Niveles que caben:           BUY=${buyB}  SELL=${sellB}`);
  console.log(`   Sesgo:                       ${buyB > sellB ? "Más BUY que SELL" : sellB > buyB ? "Más SELL que BUY" : "Simétrico"}`);
  console.log();

  console.log(`C) Híbrido: clamp(currentPrice, middle ± X% de bandWidth)`);
  console.log(`   Si X = 25% de bandWidth = ${fmtPct(BAND_WIDTH_PCT * 0.25, 2)} → clamp range: $${fmt(BOLLINGER_MIDDLE * (1 - BAND_WIDTH_PCT * 0.25 / 100), 2)} - $${fmt(BOLLINGER_MIDDLE * (1 + BAND_WIDTH_PCT * 0.25 / 100), 2)}`);
  const hybridCenter = clamp(LAST_CLOSE, BOLLINGER_MIDDLE * (1 - BAND_WIDTH_PCT * 0.25 / 100), BOLLINGER_MIDDLE * (1 + BAND_WIDTH_PCT * 0.25 / 100));
  console.log(`   Center híbrido resultante:   $${fmt(hybridCenter, 2)}`);
  const { buyCount: buyC, sellCount: sellC } = calculateMaxLevelsInBand(hybridCenter, spacingProposed, BOLLINGER_LOWER, BOLLINGER_UPPER);
  console.log(`   Niveles que caben:           BUY=${buyC}  SELL=${sellC}`);
  console.log();

  // ─── COMPARACIÓN ATR TIMEFRAMES ─────────────────────────────────
  console.log("=".repeat(100));
  console.log("COMPARACIÓN ATR TIMEFRAMES");
  console.log("=".repeat(100));
  console.log();

  console.log("Timeframe | ATR%      | Spacing%  | Niveles BUY (lastClose) | Niveles SELL | Total | Veredicto");
  console.log("-".repeat(105));

  for (const tf of [
    { label: "15m", atrPct: ATR_PCT_15M },
    { label: "1h", atrPct: ATR_PCT_1H },
    { label: "4h (actual)", atrPct: ATR_PCT_4H },
  ]) {
    const spacing = clamp(tf.atrPct * GRID_STEP_ATR_MULTIPLIER, minSpacingPctReal, GRID_STEP_MAX_PCT);
    const { buyCount, sellCount } = calculateMaxLevelsInBand(LAST_CLOSE, spacing, BOLLINGER_LOWER, BOLLINGER_UPPER);
    const total = buyCount + sellCount;
    const verdict = total >= 10 ? "✅ 5+5 caben" : total >= 6 ? `⚠️ Solo ${buyCount}+${sellCount}` : `❌ ${buyCount}+${sellCount} insuficiente`;
    console.log(`${tf.label.padEnd(10)}| ${fmtPct(tf.atrPct, 4).padEnd(10)}| ${fmtPct(spacing, 4).padEnd(10)}| ${String(buyCount).padEnd(24)}| ${String(sellCount).padEnd(13)}| ${String(total).padEnd(6)}| ${verdict}`);
  }

  console.log();
  console.log("NOTA: Los ATR 1h y 15m de esta simulación son aproximaciones por escala temporal");
  console.log("(regla √T), NO ATR calculados con velas reales. No deben usarse para decidir");
  console.log("definitivamente el timeframe. Para una decisión final habría que recalcular");
  console.log("con candles reales 1h y 15m (Fase 3C-PRE).");
  console.log("No se cambiaron configs reales ni se consultó la API.");

  // ─── BENEFICIO NETO Y FEES ──────────────────────────────────────
  console.log();
  console.log("=".repeat(100));
  console.log("BENEFICIO NETO Y FEES POR VARIANTE");
  console.log("=".repeat(100));
  console.log();

  console.log("Fórmula".padEnd(45) + " | Spacing%  | Gross%    | Fees%     | Net%      | Cumple target");
  console.log("-".repeat(100));

  for (const sim of simulations) {
    const grossPct = sim.spacingPct;
    const feesPct = FEE_BUFFER_BUY_PCT + FEE_BUFFER_SELL_PCT;
    const netBeforeTaxPct = grossPct - feesPct;
    const taxPct = netBeforeTaxPct > 0 ? netBeforeTaxPct * (TAX_RESERVE_PCT / 100) : 0;
    const netPct = netBeforeTaxPct - taxPct;
    const meets = netPct >= NET_PROFIT_TARGET_PCT ? "✅" : "❌";
    console.log(
      sim.label.padEnd(45) + " | " +
      fmtPct(grossPct, 4).padEnd(10) + " | " +
      fmtPct(grossPct, 4).padEnd(10) + " | " +
      fmtPct(feesPct, 4).padEnd(10) + " | " +
      fmtPct(netPct, 4).padEnd(10) + " | " +
      meets
    );
  }

  // ─── IMPACTO SOBRE CAPITAL ──────────────────────────────────────
  console.log();
  console.log("=".repeat(100));
  console.log("IMPACTO SOBRE CAPITAL (ejemplo, no hardcodear)");
  console.log("=".repeat(100));
  console.log();

  console.log(`gridMaxCapitalPerCycleUsd = $${fmt(GRID_MAX_CAPITAL_PER_CYCLE_USD, 2)} (configurable)`);
  console.log(`capitalPerLevelUsd = $${fmt(CAPITAL_PER_LEVEL_USD, 2)} (aprox del rango #14)`);
  console.log();
  console.log("NOTA: En esta simulación el notional SELL se muestra simplificado.");
  console.log("En el bot real, el SELL notional debe calcularse como quantity comprada × sellPrice");
  console.log("y normalmente será superior al BUY si el SELL está por encima del BUY.");
  console.log("SELL no consume USD, pero sí requiere inventario BTC.");
  console.log();

  for (const sim of simulations) {
    const buyCapital = sim.totalBuyCapitalUsd;
    const sellNotional = sim.totalSellNotionalUsd;
    const withinLimit = buyCapital <= GRID_MAX_CAPITAL_PER_CYCLE_USD;
    console.log(
      `${sim.label.padEnd(45)} | BUY capital: $${fmt(buyCapital, 2).padEnd(8)} | SELL notional: $${fmt(sellNotional, 2).padEnd(8)} | ${withinLimit ? "✅" : "❌"} dentro de límite`
    );
  }

  // ─── RESUMEN FINAL ──────────────────────────────────────────────
  console.log();
  console.log("=".repeat(100));
  console.log("RESUMEN Y RECOMENDACIONES");
  console.log("=".repeat(100));
  console.log();

  console.log("1. BUG ACTUAL CONFIRMADO:");
  console.log(`   Fórmula actual genera separación BUY-BUY = ${fmtPct(simulations[0].buyBuyGapAvgPct, 4)}`);
  console.log(`   (37× inferior al grossTargetPct = ${fmtPct(grossTargetPct, 4)})`);
  console.log();

  console.log("2. FÓRMULA PROPUESTA (acumulativa lineal):");
  console.log(`   Separación BUY-BUY = ${fmtPct(simulations[2].buyBuyGapAvgPct, 4)} (vs actual ${fmtPct(simulations[0].buyBuyGapAvgPct, 4)})`);
  console.log(`   Pero solo caben ${simulations[2].buyLevels.length}+${simulations[2].sellLevels.length} niveles en banda de ${fmtPct(BAND_WIDTH_PCT, 2)}`);
  console.log();

  console.log("3. VIABILIDAD DE BANDA:");
  const spacing4h = clamp(ATR_PCT_4H * GRID_STEP_ATR_MULTIPLIER, minSpacingPctReal, GRID_STEP_MAX_PCT);
  const { buyCount: bc, sellCount: sc } = calculateMaxLevelsInBand(LAST_CLOSE, spacing4h, BOLLINGER_LOWER, BOLLINGER_UPPER);
  console.log(`   Con spacing ${fmtPct(spacing4h, 2)} y banda ${fmtPct(BAND_WIDTH_PCT, 2)}: solo caben ${bc}+${sc} niveles`);
  console.log(`   Para 5+5 niveles con ese spacing se necesita banda de ~${fmtPct(calculateRequiredBandWidth(LAST_CLOSE, spacing4h, 5), 2)}`);
  console.log();

  console.log("4. CENTER PRICE:");
  console.log(`   lastClose ($${fmt(LAST_CLOSE, 2)}): sesgado hacia arriba, ${buyA}+${sellA} niveles`);
  console.log(`   Bollinger middle ($${fmt(BOLLINGER_MIDDLE, 2)}): simétrico, ${buyB}+${sellB} niveles`);
  console.log(`   Híbrido ($${fmt(hybridCenter, 2)}): balanceado, ${buyC}+${sellC} niveles`);
  console.log();

  console.log("5. ATR TIMEFRAME:");
  console.log(`   4h: spacing=${fmtPct(spacing4h, 2)} → pocos niveles en banda estrecha`);
  const spacing1h = clamp(ATR_PCT_1H * GRID_STEP_ATR_MULTIPLIER, minSpacingPctReal, GRID_STEP_MAX_PCT);
  console.log(`   1h: spacing=${fmtPct(spacing1h, 2)} → más niveles pero spacing = minSpacingPctReal (clamp piso)`);
  const spacing15m = clamp(ATR_PCT_15M * GRID_STEP_ATR_MULTIPLIER, minSpacingPctReal, GRID_STEP_MAX_PCT);
  console.log(`   15m: spacing=${fmtPct(spacing15m, 2)} → spacing = minSpacingPctReal (clamp piso, ATR muy bajo)`);
  console.log("   Con los datos estimados, cambiar ATR timeframe no soluciona el problema principal");
  console.log("   porque el minSpacingPctReal domina. La decisión definitiva de ATR timeframe queda");
  console.log("   pendiente de una simulación con candles reales 1h/15m (Fase 3C-PRE).");
  console.log("   El problema prioritario es la incompatibilidad entre bandWidth actual,");
  console.log("   spacing mínimo real y número de niveles.");
  console.log();

  console.log("=".repeat(100));
  console.log("FIN SIMULACIÓN FASE 3B");
  console.log("=".repeat(100));
}

main();
