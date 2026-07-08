/**
 * FASE 3C-PRE — ATR REAL Y SIMULACIÓN CON CANDLES REALES
 *
 * Script auxiliar de análisis. NO forma parte del build de producción.
 * No se importa en ningún módulo del bot. Solo sirve para recalcular
 * ATR con velas reales de Kraken y repetir la simulación de viabilidad.
 *
 * Ejecutar con: npx tsx scripts/grid_spacing_phase3c_pre_real_atr.ts
 *
 * Fuentes:
 * - Candles: Kraken API pública (GET /0/public/OHLC), sin autenticación.
 * - ATR: misma fórmula que server/services/indicators.ts calculateATR()
 *   y MarketDataService.getATR().
 * - Bollinger Bands: misma fórmula que indicators.ts calculateBollingerBands().
 *
 * IMPORTANTE:
 * - Los ATR 1h y 15m de la Fase 3B eran aproximaciones por escala temporal
 *   (regla √T). Este script usa ATR calculados con velas reales.
 * - El notional SELL se muestra simplificado. En el bot real, el SELL notional
 *   debe calcularse como quantity comprada × sellPrice. SELL no consume USD,
 *   pero sí requiere inventario BTC.
 * - La decisión definitiva de ATR timeframe y centerPrice se emite en este
 *   informe como recomendación, pero la implementación queda pendiente de
 *   aprobación expresa (Fase 3C).
 *
 * VELA EN CURSO:
 * La API de Kraken OHLC devuelve la última vela que puede estar aún en curso
 * (sin cerrar). Este script NO excluye la última vela porque es de auditoría.
 * Los cálculos pueden incluir la vela actual en curso. Para implementación
 * final conviene excluir velas no cerradas o validar cierre por timestamp/timeframe.
 */

// ─── Tipos ────────────────────────────────────────────────────────────

interface OHLC {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface TimeframeResult {
  label: string;
  intervalMin: number;
  candles: OHLC[];
  candleCount: number;
  atr: number;
  atrPct: number;
  lastClose: number;
  bollingerUpper: number;
  bollingerMiddle: number;
  bollingerLower: number;
  bandWidthPct: number;
}

// ─── Constantes auditadas (Fase 3A/3B) ────────────────────────────────

const FEE_BUFFER_BUY_PCT = 0.09;
const FEE_BUFFER_SELL_PCT = 0.09;
const TAX_RESERVE_PCT = 20;

const SPREAD_BUFFER_PCT = 0.01;
const SAFETY_BUFFER_PCT = 0.10;

const NET_PROFIT_TARGET_PCT = 1.2;
const GROSS_TARGET_PCT = 1.68; // incluye fees
const MIN_SPACING_PCT_REAL = GROSS_TARGET_PCT + SPREAD_BUFFER_PCT + SAFETY_BUFFER_PCT; // 1.79%

const GRID_STEP_ATR_MULTIPLIER = 1.5;
const GRID_STEP_MAX_PCT = 3.0;
const BOLLINGER_PERIOD = 20;
const BOLLINGER_STD_DEV = 2.0;
const ATR_PERIOD = 14;
const MAX_LEVELS_PER_SIDE = 5;

const CAPITAL_PER_LEVEL_USD = 120;
const GRID_MAX_CAPITAL_PER_CYCLE_USD = 600;

// ATR 4h auditado en Fase 3A (rango #14 staging)
const ATR_PCT_4H_AUDITADO = 1.2412;
const LAST_CLOSE_AUDITADO = 63300.80;

// Estimaciones √T de Fase 3B
const ATR_PCT_1H_ESTIMADO_SQRT = ATR_PCT_4H_AUDITADO / 2;
const ATR_PCT_15M_ESTIMADO_SQRT = ATR_PCT_1H_ESTIMADO_SQRT / 2;

// ─── Helpers ──────────────────────────────────────────────────────────

function fmt(n: number, decimals = 2): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtPct(n: number, decimals = 4): string {
  return `${n.toFixed(decimals)}%`;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

// ─── Kraken API pública (sin autenticación) ───────────────────────────

async function fetchKrakenOHLC(intervalMin: number): Promise<{ candles: OHLC[]; lastTimestamp: number }> {
  const url = `https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=${intervalMin}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Kraken API returned ${resp.status}: ${resp.statusText}`);
  }
  const data = await resp.json() as any;
  if (data.error && data.error.length > 0) {
    throw new Error(`Kraken API error: ${data.error.join(", ")}`);
  }
  const result = data.result;
  if (!result) throw new Error("Kraken API: no result field");
  // result has a key like "XXBTZUSD" with the candle array, plus "last"
  const pairKey = Object.keys(result).find(k => k !== "last");
  if (!pairKey) throw new Error("Kraken API: no pair key found");
  const rawCandles = result[pairKey] as any[];
  if (!Array.isArray(rawCandles)) throw new Error("Kraken API: candles is not an array");

  const candles = rawCandles.map((c: any[]) => ({
    time: c[0],
    open: parseFloat(c[1]),
    high: parseFloat(c[2]),
    low: parseFloat(c[3]),
    close: parseFloat(c[4]),
    volume: parseFloat(c[6]),
  }));
  // Kraken devuelve "last" = timestamp de la última vela devuelta
  const lastTimestamp = result.last ?? candles[candles.length - 1]?.time ?? 0;
  return { candles, lastTimestamp };
}

// ─── ATR (misma fórmula que indicators.ts y MarketDataService.getATR) ──

function calculateATR(candles: OHLC[], period: number = 14): number {
  if (candles.length < period + 1) return 0;
  const slice = candles.slice(-(period + 1));
  let atrSum = 0;
  for (let i = 1; i < slice.length; i++) {
    const c = slice[i];
    const prev = slice[i - 1];
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prev.close),
      Math.abs(c.low - prev.close),
    );
    atrSum += tr;
  }
  return atrSum / period;
}

function calculateATRPct(candles: OHLC[], period: number = 14): number {
  const atr = calculateATR(candles, period);
  if (candles.length === 0 || atr === 0) return 0;
  const lastClose = candles[candles.length - 1].close;
  return (atr / lastClose) * 100;
}

// ─── Bollinger Bands (misma fórmula que indicators.ts) ────────────────

function calculateBollingerBands(
  closes: number[],
  period: number = 20,
  stdDevMultiplier: number = 2.0,
): { upper: number; middle: number; lower: number } {
  if (closes.length < period) {
    const avg = closes.reduce((a, b) => a + b, 0) / closes.length;
    return { upper: avg, middle: avg, lower: avg };
  }
  const recent = closes.slice(-period);
  const middle = recent.reduce((a, b) => a + b, 0) / period;
  const stdDev = Math.sqrt(
    recent.reduce((sum, p) => sum + Math.pow(p - middle, 2), 0) / period,
  );
  return {
    upper: middle + stdDevMultiplier * stdDev,
    middle,
    lower: middle - stdDevMultiplier * stdDev,
  };
}

// ─── Viabilidad de banda ──────────────────────────────────────────────

function calculateMaxLevelsInBand(
  centerPrice: number,
  spacingPct: number,
  lowerBand: number,
  upperBand: number,
): { buyCount: number; sellCount: number } {
  let buyCount = 0;
  let sellCount = 0;
  let price = centerPrice;
  for (let i = 0; i < MAX_LEVELS_PER_SIDE; i++) {
    price = price * (1 - spacingPct / 100);
    if (price >= lowerBand) buyCount++;
    else break;
  }
  price = centerPrice;
  for (let i = 0; i < MAX_LEVELS_PER_SIDE; i++) {
    price = price * (1 + spacingPct / 100);
    if (price <= upperBand) sellCount++;
    else break;
  }
  return { buyCount, sellCount };
}

function calculateRequiredBandWidth(centerPrice: number, spacingPct: number, levelsPerSide: number): number {
  // BW necesaria = spacing × levelsPerSide × 2 (aproximación conservadora)
  return spacingPct * levelsPerSide * 2;
}

function calculateNetPct(spacingPct: number): number {
  const feesPct = FEE_BUFFER_BUY_PCT + FEE_BUFFER_SELL_PCT;
  const netBeforeTax = spacingPct - feesPct;
  const taxPct = (netBeforeTax * TAX_RESERVE_PCT) / 100;
  return netBeforeTax - taxPct;
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main() {
  const SEP = "=".repeat(100);
  const SUB = "─".repeat(100);

  console.log(SEP);
  console.log("FASE 3C-PRE — ATR REAL Y SIMULACIÓN CON CANDLES REALES");
  console.log(SEP);
  console.log();
  console.log("Fuente de candles: Kraken API pública (GET /0/public/OHLC?pair=XBTUSD)");
  console.log("Sin autenticación. Sin modificación de DB. Sin tocar motor real.");
  console.log();
  console.log("ADVERTENCIA: Los cálculos son de auditoría y pueden incluir la vela actual");
  console.log("en curso según la respuesta de Kraken. Para implementación final conviene");
  console.log("excluir velas no cerradas o validar cierre por timestamp/timeframe.");
  console.log();

  // ─── 1. Fetch candles reales ────────────────────────────────────────
  console.log(SUB);
  console.log("1. OBTENCIÓN DE CANDLES REALES");
  console.log(SUB);
  console.log();

  const timeframes: { label: string; intervalMin: number }[] = [
    { label: "15m", intervalMin: 15 },
    { label: "1h", intervalMin: 60 },
    { label: "4h", intervalMin: 240 },
  ];

  const results: TimeframeResult[] = [];

  for (const tf of timeframes) {
    try {
      console.log(`  Fetching ${tf.label} candles from Kraken...`);
      const { candles, lastTimestamp } = await fetchKrakenOHLC(tf.intervalMin);
      console.log(`  → ${candles.length} candles received`);
      const lastCandleTime = candles[candles.length - 1]?.time ?? 0;
      const lastCandleDate = new Date(lastCandleTime * 1000).toISOString();
      const nowSec = Math.floor(Date.now() / 1000);
      const candleAgeSec = nowSec - lastCandleTime;
      const intervalSec = tf.intervalMin * 60;
      const isLastCandleClosed = candleAgeSec >= intervalSec;
      console.log(`  Última vela timestamp: ${lastCandleTime} (${lastCandleDate})`);
      console.log(`  Edad última vela: ${Math.floor(candleAgeSec / 60)} min vs intervalo ${tf.intervalMin} min`);
      console.log(`  ¿Vela cerrada? ${isLastCandleClosed ? 'SÍ (cerrada)' : 'NO PUDO CONFIRMARSE (puede estar en curso)'}`);

      if (candles.length < ATR_PERIOD + 1) {
        console.log(`  ⚠️ Insuficientes candles (${candles.length} < ${ATR_PERIOD + 1}) para ATR 14`);
      }

      const atr = calculateATR(candles, ATR_PERIOD);
      const atrPct = calculateATRPct(candles, ATR_PERIOD);
      const lastClose = candles[candles.length - 1].close;
      const closes = candles.map(c => c.close);
      const bb = calculateBollingerBands(closes, BOLLINGER_PERIOD, BOLLINGER_STD_DEV);
      const bandWidthPct = ((bb.upper - bb.lower) / bb.middle) * 100;

      const result: TimeframeResult = {
        label: tf.label,
        intervalMin: tf.intervalMin,
        candles,
        candleCount: candles.length,
        atr,
        atrPct,
        lastClose,
        bollingerUpper: bb.upper,
        bollingerMiddle: bb.middle,
        bollingerLower: bb.lower,
        bandWidthPct,
      };
      results.push(result);

      console.log(`  lastClose:    $${fmt(lastClose, 2)}`);
      console.log(`  ATR 14:       $${fmt(atr, 2)}`);
      console.log(`  ATR%:         ${fmtPct(atrPct, 4)}`);
      console.log(`  BB upper:     $${fmt(bb.upper, 2)}`);
      console.log(`  BB middle:    $${fmt(bb.middle, 2)}`);
      console.log(`  BB lower:     $${fmt(bb.lower, 2)}`);
      console.log(`  Band width:   ${fmtPct(bandWidthPct, 2)}`);
      console.log();
    } catch (e: any) {
      console.log(`  ❌ Error fetching ${tf.label}: ${e.message}`);
      console.log();
    }
  }

  if (results.length === 0) {
    console.log("❌ No se pudieron obtener candles de ningún timeframe. Abortando.");
    return;
  }

  // ─── 2. Comparativa ATR real vs estimado √T ────────────────────────
  console.log(SUB);
  console.log("2. COMPARATIVA ATR REAL vs ESTIMACIÓN √T (Fase 3B)");
  console.log(SUB);
  console.log();

  console.log("Timeframe | ATR% Real    | ATR% √T (estimado) | Diferencia abs | Diferencia %  | Nota");
  console.log("─".repeat(105));

  for (const r of results) {
    let estimado = 0;
    let nota = "";
    if (r.label === "4h") {
      estimado = ATR_PCT_4H_AUDITADO;
      nota = "Auditado en Fase 3A (rango #14)";
    } else if (r.label === "1h") {
      estimado = ATR_PCT_1H_ESTIMADO_SQRT;
      nota = "Estimación √T (ATR_4h / 2)";
    } else if (r.label === "15m") {
      estimado = ATR_PCT_15M_ESTIMADO_SQRT;
      nota = "Estimación √T (ATR_1h / 2)";
    }
    const diffAbs = r.atrPct - estimado;
    const diffPct = estimado > 0 ? ((diffAbs / estimado) * 100) : 0;
    console.log(
      `${r.label.padEnd(9)} | ${fmtPct(r.atrPct, 4).padEnd(12)} | ${fmtPct(estimado, 4).padEnd(19)} | ${fmtPct(diffAbs, 4).padEnd(15)} | ${fmtPct(diffPct, 2).padEnd(13)} | ${nota}`,
    );
  }

  console.log();
  console.log("NOTA: Los ATR reales se calculan con velas reales de Kraken en cada timeframe.");
  console.log("La estimación √T asume volatilidad proporcional a la raíz cuadrada del tiempo,");
  console.log("lo cual es una aproximación que puede diferir significativamente de la realidad.");
  console.log();

  // ─── 3. Datos de mercado por timeframe ─────────────────────────────
  console.log(SUB);
  console.log("3. DATOS DE MERCADO POR TIMEFRAME (Bollinger 20, 2σ)");
  console.log(SUB);
  console.log();

  console.log("Timeframe | lastClose     | BB upper      | BB middle     | BB lower      | Band width");
  console.log("─".repeat(95));

  for (const r of results) {
    console.log(
      `${r.label.padEnd(9)} | $${fmt(r.lastClose, 2).padEnd(13)} | $${fmt(r.bollingerUpper, 2).padEnd(13)} | $${fmt(r.bollingerMiddle, 2).padEnd(13)} | $${fmt(r.bollingerLower, 2).padEnd(13)} | ${fmtPct(r.bandWidthPct, 2)}`,
    );
  }
  console.log();

  // ─── 4. Distancias desde centerPrice ───────────────────────────────
  console.log(SUB);
  console.log("4. DISTANCIAS DESDE CENTER PRICE A BANDAS");
  console.log(SUB);
  console.log();

  for (const r of results) {
    const distToUpper = ((r.bollingerUpper - r.lastClose) / r.lastClose) * 100;
    const distToLower = ((r.lastClose - r.bollingerLower) / r.lastClose) * 100;
    const midToUpper = ((r.bollingerUpper - r.bollingerMiddle) / r.bollingerMiddle) * 100;
    const midToLower = ((r.bollingerMiddle - r.bollingerLower) / r.bollingerMiddle) * 100;

    console.log(`  ${r.label}:`);
    console.log(`    lastClose → upper: ${fmtPct(distToUpper, 2)}  | lastClose → lower: ${fmtPct(distToLower, 2)}`);
    console.log(`    middle → upper:    ${fmtPct(midToUpper, 2)}  | middle → lower:    ${fmtPct(midToLower, 2)}`);
    console.log();
  }

  // ─── 5. Simulación de viabilidad con ATR real ──────────────────────
  console.log(SUB);
  console.log("5. SIMULACIÓN DE VIABILIDAD CON ATR REAL");
  console.log(SUB);
  console.log();

  // Centers a comparar
  interface CenterVariant {
    name: string;
    getPrice: (r: TimeframeResult) => number;
  }

  const centerVariants: CenterVariant[] = [
    {
      name: "A) lastClose",
      getPrice: (r) => r.lastClose,
    },
    {
      name: "B) Bollinger middle",
      getPrice: (r) => r.bollingerMiddle,
    },
    {
      name: "C) Híbrido (clamp 25% BW)",
      getPrice: (r) => {
        const bw = r.bollingerUpper - r.bollingerLower;
        const quarter = bw * 0.25;
        return clamp(r.lastClose, r.bollingerMiddle - quarter, r.bollingerMiddle + quarter);
      },
    },
  ];

  console.log(`minSpacingPctReal = ${fmtPct(MIN_SPACING_PCT_REAL, 4)}`);
  console.log(`grossTargetPct = ${fmtPct(GROSS_TARGET_PCT, 4)}`);
  console.log(`gridStepAtrMultiplier = ${GRID_STEP_ATR_MULTIPLIER}`);
  console.log(`gridStepMaxPct = ${fmtPct(GRID_STEP_MAX_PCT, 2)}`);
  console.log();

  // Tabla comparativa
  console.log("TF   | Center                | ATR%      | Spacing%  | BUY | SELL | Total | BW necesaria 5+5 | Net%    | Veredicto");
  console.log("─".repeat(130));

  interface SimRow {
    tf: string;
    centerName: string;
    centerPrice: number;
    atrPct: number;
    spacingPct: number;
    buyCount: number;
    sellCount: number;
    totalLevels: number;
    requiredBw: number;
    netPct: number;
    verdict: string;
  }

  const simRows: SimRow[] = [];

  for (const r of results) {
    for (const cv of centerVariants) {
      const centerPrice = cv.getPrice(r);
      const spacingPct = clamp(
        r.atrPct * GRID_STEP_ATR_MULTIPLIER,
        MIN_SPACING_PCT_REAL,
        GRID_STEP_MAX_PCT,
      );
      const { buyCount, sellCount } = calculateMaxLevelsInBand(
        centerPrice,
        spacingPct,
        r.bollingerLower,
        r.bollingerUpper,
      );
      const totalLevels = buyCount + sellCount;
      const requiredBw = calculateRequiredBandWidth(centerPrice, spacingPct, MAX_LEVELS_PER_SIDE);
      const netPct = calculateNetPct(spacingPct);
      const meetsTarget = netPct >= NET_PROFIT_TARGET_PCT;

      let verdict: string;
      if (totalLevels >= 10) {
        verdict = "✅ Viable (5+5)";
      } else if (totalLevels >= 6) {
        verdict = `⚠️ Compacto (${buyCount}+${sellCount})`;
      } else if (totalLevels >= 3) {
        verdict = `⚠️ Muy compacto (${buyCount}+${sellCount})`;
      } else {
        verdict = `❌ No viable (${buyCount}+${sellCount})`;
      }

      const row: SimRow = {
        tf: r.label,
        centerName: cv.name,
        centerPrice,
        atrPct: r.atrPct,
        spacingPct,
        buyCount,
        sellCount,
        totalLevels,
        requiredBw,
        netPct,
        verdict,
      };
      simRows.push(row);

      console.log(
        `${r.label.padEnd(4)} | ${cv.name.padEnd(21)} | ${fmtPct(r.atrPct, 4).padEnd(9)} | ${fmtPct(spacingPct, 4).padEnd(9)} | ${String(buyCount).padEnd(3)} | ${String(sellCount).padEnd(5)} | ${String(totalLevels).padEnd(5)} | ${fmtPct(requiredBw, 2).padEnd(17)} | ${fmtPct(netPct, 2).padEnd(7)} | ${verdict}`,
      );
    }
  }

  console.log();

  // ─── 6. Detalle por timeframe ──────────────────────────────────────
  console.log(SUB);
  console.log("6. DETALLE DE NIVELES POR TIMEFRAME Y CENTER");
  console.log(SUB);
  console.log();

  for (const r of results) {
    console.log(`═══ ${r.label} ═══`);
    console.log(`  ATR%: ${fmtPct(r.atrPct, 4)}  |  Band width: ${fmtPct(r.bandWidthPct, 2)}  |  lastClose: $${fmt(r.lastClose, 2)}`);
    console.log(`  BB: $${fmt(r.bollingerLower, 2)} — $${fmt(r.bollingerMiddle, 2)} — $${fmt(r.bollingerUpper, 2)}`);
    console.log();

    for (const cv of centerVariants) {
      const centerPrice = cv.getPrice(r);
      const spacingPct = clamp(
        r.atrPct * GRID_STEP_ATR_MULTIPLIER,
        MIN_SPACING_PCT_REAL,
        GRID_STEP_MAX_PCT,
      );
      const { buyCount, sellCount } = calculateMaxLevelsInBand(
        centerPrice,
        spacingPct,
        r.bollingerLower,
        r.bollingerUpper,
      );

      console.log(`  ${cv.name} (center=$${fmt(centerPrice, 2)}, spacing=${fmtPct(spacingPct, 4)}):`);

      // Generar niveles BUY
      let price = centerPrice;
      const buyLevels: number[] = [];
      for (let i = 0; i < MAX_LEVELS_PER_SIDE; i++) {
        price = price * (1 - spacingPct / 100);
        if (price >= r.bollingerLower) {
          buyLevels.push(price);
        } else {
          break;
        }
      }
      // Generar niveles SELL
      price = centerPrice;
      const sellLevels: number[] = [];
      for (let i = 0; i < MAX_LEVELS_PER_SIDE; i++) {
        price = price * (1 + spacingPct / 100);
        if (price <= r.bollingerUpper) {
          sellLevels.push(price);
        } else {
          break;
        }
      }

      console.log(`    BUY (${buyLevels.length}):`);
      for (let i = 0; i < buyLevels.length; i++) {
        const inBand = buyLevels[i] >= r.bollingerLower && buyLevels[i] <= r.bollingerUpper;
        console.log(`      [${i}] $${fmt(buyLevels[i], 2)}  ${inBand ? "✅" : "❌"}`);
      }
      console.log(`    SELL (${sellLevels.length}):`);
      for (let i = 0; i < sellLevels.length; i++) {
        const inBand = sellLevels[i] >= r.bollingerLower && sellLevels[i] <= r.bollingerUpper;
        console.log(`      [${i}] $${fmt(sellLevels[i], 2)}  ${inBand ? "✅" : "❌"}`);
      }
      console.log(`    Total: ${buyLevels.length}+${sellLevels.length} = ${buyLevels.length + sellLevels.length} niveles en banda`);
      console.log();
    }
  }

  // ─── 7. Beneficio neto y fees ──────────────────────────────────────
  console.log(SUB);
  console.log("7. BENEFICIO NETO Y FEES POR TIMEFRAME");
  console.log(SUB);
  console.log();

  console.log("TF   | ATR%      | Spacing%  | Gross%    | Fees%     | Net%      | Cumple target (1.2%)");
  console.log("─".repeat(90));

  for (const r of results) {
    const spacingPct = clamp(
      r.atrPct * GRID_STEP_ATR_MULTIPLIER,
      MIN_SPACING_PCT_REAL,
      GRID_STEP_MAX_PCT,
    );
    const feesPct = FEE_BUFFER_BUY_PCT + FEE_BUFFER_SELL_PCT;
    const netPct = calculateNetPct(spacingPct);
    const meets = netPct >= NET_PROFIT_TARGET_PCT;
    console.log(
      `${r.label.padEnd(4)} | ${fmtPct(r.atrPct, 4).padEnd(9)} | ${fmtPct(spacingPct, 4).padEnd(9)} | ${fmtPct(spacingPct, 4).padEnd(9)} | ${fmtPct(feesPct, 4).padEnd(9)} | ${fmtPct(netPct, 4).padEnd(9)} | ${meets ? "✅" : "❌"}`,
    );
  }

  console.log();
  console.log("Fórmula (sin doble conteo): neto = (spacing - fees) × (1 - taxReserve/100)");
  console.log("grossTargetPct ya incluye fees. No sumar fees dos veces.");
  console.log();

  // ─── 8. Impacto sobre capital ──────────────────────────────────────
  console.log(SUB);
  console.log("8. IMPACTO SOBRE CAPITAL");
  console.log(SUB);
  console.log();

  console.log(`gridMaxCapitalPerCycleUsd = $${fmt(GRID_MAX_CAPITAL_PER_CYCLE_USD, 2)} (configurable)`);
  console.log(`capitalPerLevelUsd = $${fmt(CAPITAL_PER_LEVEL_USD, 2)} (aprox)`);
  console.log();
  console.log("NOTA: En esta simulación el notional SELL se muestra simplificado.");
  console.log("En el bot real, el SELL notional debe calcularse como quantity comprada × sellPrice");
  console.log("y normalmente será superior al BUY si el SELL está por encima del BUY.");
  console.log("SELL no consume USD, pero sí requiere inventario BTC.");
  console.log();

  console.log("TF   | Center                | BUY+SELL | BUY capital  | SELL notional | ¿Dentro de límite?");
  console.log("─".repeat(95));

  for (const row of simRows) {
    const buyCapital = row.buyCount * CAPITAL_PER_LEVEL_USD;
    const sellNotional = row.sellCount * CAPITAL_PER_LEVEL_USD;
    const withinLimit = buyCapital <= GRID_MAX_CAPITAL_PER_CYCLE_USD;
    console.log(
      `${row.tf.padEnd(4)} | ${row.centerName.padEnd(21)} | ${String(row.buyCount + "+" + row.sellCount).padEnd(9)} | $${fmt(buyCapital, 2).padEnd(12)} | $${fmt(sellNotional, 2).padEnd(13)} | ${withinLimit ? "✅" : "❌"}`,
    );
  }

  // ─── 9. Resumen y recomendaciones ──────────────────────────────────
  console.log();
  console.log(SEP);
  console.log("9. RESUMEN Y RECOMENDACIONES");
  console.log(SEP);
  console.log();

  // Encontrar mejor combinación
  let bestRow: SimRow | null = null;
  let bestTotal = 0;
  for (const row of simRows) {
    if (row.totalLevels > bestTotal) {
      bestTotal = row.totalLevels;
      bestRow = row;
    }
  }

  console.log("1. ATR REAL vs ESTIMADO √T:");
  for (const r of results) {
    let estimado = 0;
    if (r.label === "4h") estimado = ATR_PCT_4H_AUDITADO;
    else if (r.label === "1h") estimado = ATR_PCT_1H_ESTIMADO_SQRT;
    else if (r.label === "15m") estimado = ATR_PCT_15M_ESTIMADO_SQRT;
    const diffPct = estimado > 0 ? ((r.atrPct - estimado) / estimado) * 100 : 0;
    console.log(`   ${r.label}: real=${fmtPct(r.atrPct, 4)} vs estimado=${fmtPct(estimado, 4)} (diff: ${fmtPct(diffPct, 1)})`);
  }
  console.log();

  console.log("2. BAND WIDTH POR TIMEFRAME:");
  for (const r of results) {
    console.log(`   ${r.label}: ${fmtPct(r.bandWidthPct, 2)}`);
  }
  console.log();

  console.log("3. NIVELES QUE CABEN (mejor combinación):");
  if (bestRow) {
    console.log(`   Mejor: ${bestRow.tf} + ${bestRow.centerName} → ${bestRow.buyCount}+${bestRow.sellCount} = ${bestRow.totalLevels} niveles`);
    console.log(`   Spacing: ${fmtPct(bestRow.spacingPct, 4)}  |  Net%: ${fmtPct(bestRow.netPct, 2)}  |  ${bestRow.verdict}`);
  }
  console.log();

  console.log("4. RECOMENDACIÓN ATR TIMEFRAME:");
  // El timeframe que produce más niveles viables
  const tfScores: Record<string, number> = {};
  for (const row of simRows) {
    if (!tfScores[row.tf]) tfScores[row.tf] = 0;
    tfScores[row.tf] += row.totalLevels;
  }
  const sortedTf = Object.entries(tfScores).sort((a, b) => b[1] - a[1]);
  for (const [tf, score] of sortedTf) {
    console.log(`   ${tf}: score total = ${score} niveles (suma de 3 centers)`);
  }
  console.log();

  console.log("5. RECOMENDACIÓN CENTER PRICE:");
  const centerScores: Record<string, number> = {};
  for (const row of simRows) {
    if (!centerScores[row.centerName]) centerScores[row.centerName] = 0;
    centerScores[row.centerName] += row.totalLevels;
  }
  const sortedCenter = Object.entries(centerScores).sort((a, b) => b[1] - a[1]);
  for (const [name, score] of sortedCenter) {
    console.log(`   ${name}: score total = ${score} niveles (suma de 3 timeframes)`);
  }
  console.log();

  console.log("6. RECOMENDACIÓN DE VIABILIDAD:");
  const maxLevels = bestRow?.totalLevels ?? 0;
  if (maxLevels >= 10) {
    console.log("   ✅ Viable: caben 5+5 niveles con ATR real y algún center price.");
  } else if (maxLevels >= 6) {
    console.log(`   ⚠️ Compacto: máximo ${maxLevels} niveles. Recomendado: reducción dinámica + evaluar ampliación de rango.`);
  } else if (maxLevels >= 3) {
    console.log(`   ⚠️ Muy compacto: máximo ${maxLevels} niveles. Recomendado: ampliar rango operativo (bandStdDevMultiplier 3.0) o reducir niveles.`);
  } else {
    console.log(`   ❌ No viable: máximo ${maxLevels} niveles. Recomendado: ampliar rango operativo significativamente o cambiar configuración de banda.`);
  }
  console.log();

  console.log("7. BW NECESARIA PARA 5+5:");
  for (const r of results) {
    const spacingPct = clamp(
      r.atrPct * GRID_STEP_ATR_MULTIPLIER,
      MIN_SPACING_PCT_REAL,
      GRID_STEP_MAX_PCT,
    );
    const requiredBw = calculateRequiredBandWidth(r.lastClose, spacingPct, MAX_LEVELS_PER_SIDE);
    console.log(`   ${r.label}: spacing=${fmtPct(spacingPct, 4)} → BW necesaria ≈ ${fmtPct(requiredBw, 2)} (actual: ${fmtPct(r.bandWidthPct, 2)})`);
  }
  console.log();

  // ─── 10. Propuesta Fase 3C ─────────────────────────────────────────
  console.log(SEP);
  console.log("10. QUÉ IMPLEMENTARÍA EN FASE 3C (si se aprueba)");
  console.log(SEP);
  console.log();
  console.log("1. Fórmula acumulativa: BUY[i] = BUY[i-1] × (1 - spacingPct/100), SELL[i] = SELL[i-1] × (1 + spacingPct/100)");
  console.log("2. minSpacingPctReal como piso de spacing (grossTargetPct + spreadBuffer + safetyBuffer)");
  console.log("3. Viabilidad de banda: calcular cuántos niveles caben antes de generar");
  console.log("4. Reducción dinámica de niveles si no caben 5+5");
  console.log("5. Estado UI: Grid equilibrado / compacto / no viable");
  console.log(`6. Center price: ${sortedCenter[0]?.[0] ?? "Pendiente"}`);
  console.log(`7. ATR timeframe: ${sortedTf[0]?.[0] ?? "Pendiente"}`);
  console.log("8. gridMaxCapitalPerCycleUsd configurable (no hardcodear)");
  console.log("9. SELL notional calculado como qty comprada × sellPrice");
  console.log("10. Todo primero en SHADOW");
  console.log();
  console.log("NO iniciar Fase 3C hasta aprobación expresa.");
  console.log();

  // ─── 11. Riesgos ───────────────────────────────────────────────────
  console.log(SEP);
  console.log("11. RIESGOS");
  console.log(SEP);
  console.log();
  console.log("- Riesgo medio: Cambiar generateGeometricLevels puede romper tests existentes.");
  console.log("- Riesgo medio: Rangos existentes en DB quedan obsoletos con nueva fórmula.");
  console.log("- Riesgo bajo: En SHADOW no hay órdenes reales.");
  console.log(`- Riesgo de viabilidad: Con BW actual y spacing mínimo real (${fmtPct(MIN_SPACING_PCT_REAL, 2)}),`);
  console.log("  el Grid puede tener muy pocos niveles — operativamente limitado sin ampliar la banda.");
  console.log();

  // ─── 12. Confirmación de restricciones ─────────────────────────────
  console.log(SEP);
  console.log("12. CONFIRMACIÓN DE RESTRICCIONES");
  console.log(SEP);
  console.log();
  console.log("✅ No IDCA · No FISCO · No REAL · No órdenes reales · No rebuild");
  console.log("✅ No DB manual · No migraciones · No cambios de lógica de trading · No deploy");
  console.log("✅ Solo lectura de Kraken API pública + simulación + informe");
  console.log();

  console.log(SEP);
  console.log("FIN FASE 3C-PRE");
  console.log(SEP);
}

main().catch((e) => {
  console.error("Error fatal:", e);
  process.exit(1);
});
