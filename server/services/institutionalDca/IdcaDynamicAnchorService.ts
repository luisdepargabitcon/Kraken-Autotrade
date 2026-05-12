/**
 * IdcaDynamicAnchorService — Ancla Dinámica IDCA
 *
 * Sustituye el comportamiento estático:
 *   "Si existe VWAP anchor, manda siempre aunque sea viejo"
 * por una política profesional que evalúa 5 tipos de cambio:
 *   A) Cambio por estructura
 *   B) Cambio por VWAP
 *   C) Cambio por ruptura y consolidación
 *   D) Cambio por obsolescencia / antigüedad
 *   E) Cambio por calidad de datos
 *
 * REGLA CENTRAL:
 * - Con ciclo activo/importado → decision = ciclo_activo_solo_contexto
 *   La Ancla no modifica: basePrice, avgEntryPrice, nextBuyPrice, imported_avg,
 *   totalQuantity, capitalUsedUsd, PnL, ladder, protection, trailing, salidas.
 * - Sin ciclo activo → la Ancla puede renovar, mantener, avisar, esperar o bloquear.
 * - Renovar ancla NO significa comprar. Solo actualiza la referencia global de entrada.
 *   Cualquier entrada sigue pasando por: minDip, marketScore, capital, cooldown, exposición.
 */

import type { VwapEntryContext, BasePriceResult } from "./IdcaTypes";
import type { VwapAnchorState } from "./IdcaEntryReferenceResolver";
import type { VwapResult } from "./IdcaSmartLayer";
import {
  computeATRPct,
  type TimestampedCandle,
} from "./IdcaSmartLayer";
import { checkMarketDataHealth, type DataReadinessState } from "./IdcaMarketDataHealthService";
import { idcaLog } from "./idcaLog";

// ─── Tipos de decisión ────────────────────────────────────────────────────────

export type AnchorDecision =
  | "mantener_ancla"
  | "avisar_pero_mantener"
  | "renovar_ancla"
  | "esperar_mas_datos"
  | "bloquear_nuevas_entradas_por_datos"
  | "precio_caro_no_perseguir"
  | "zona_interesante_con_confirmacion"
  | "ciclo_activo_solo_contexto"
  | "salida_pendiente_sin_accion";

export type ChangeTrigger =
  | "cambio_por_estructura"
  | "cambio_por_vwap"
  | "cambio_por_ruptura_consolidacion"
  | "cambio_por_obsolescencia"
  | "cambio_por_calidad_datos"
  | "sin_cambio"
  | "bloqueado_por_ciclo"
  | "bloqueado_por_salida"
  | "bloqueado_por_datos";

export interface DynamicAnchorResult {
  decision: AnchorDecision;
  changeTrigger: ChangeTrigger;

  currentAnchor: { price: number; ageHours: number; setAt: number } | null;
  calculatedAnchor: { price: number; method: string; confidence: "alta" | "media" | "baja"; timestamp?: number } | null;
  effectiveEntryReference: number;
  usedByEngine: boolean;

  reason: string;
  marketReading: string;
  marketZone: string | null;

  dataState: DataReadinessState;
  cycleProtection: "sin_ciclo" | "ciclo_activo_protegido" | "salida_pendiente";
  actionTaken: "renovacion_automatica" | "sin_cambios" | "completando_historico" | "nuevas_entradas_bloqueadas" | "sin_accion_por_ciclo";
  canOpenNewCycle: boolean;

  auditPayload: Record<string, unknown>;
}

// ─── Input del resolver ───────────────────────────────────────────────────────

export interface ResolveDynamicAnchorInput {
  pair: string;
  mode: string;
  currentPrice: number;
  candles: TimestampedCandle[];
  basePriceResult: BasePriceResult;
  frozenAnchor: VwapAnchorState | null;
  vwapContext: VwapEntryContext | undefined;
  vwapResult: VwapResult | undefined;
  hasActiveCycle: boolean;
  hasPendingExit: boolean;
  vwapEnabled: boolean;
  dynamicAnchorEnabled: boolean;
  emergencyDisable: boolean;
  now?: number;
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const ANCHOR_STALE_WARN_HOURS      = 72;
const ANCHOR_VERY_STALE_HOURS      = 168;
const ANCHOR_COOLDOWN_MIN_HOURS    = 6;
const ANCHOR_DIVERGENCE_VWAP_THRESHOLD = 0.035; // 3.5% lejos del VWAP → revisión
const STRUCTURE_DIVERGENCE_THRESHOLD   = 0.04;  // 4% entre ancla y estructura reciente
const BREAKOUT_CONSECUTIVE_CANDLES     = 3;      // mínimo de velas fuera de zona para confirmar ruptura
const PRICE_EXPENSIVE_ABOVE_VWAP_PCT   = 0.025; // 2.5% por encima del VWAP → precio caro
const PRICE_INTERESTING_BELOW_VWAP_PCT = 0.010; // 1.0% por debajo del VWAP → zona interesante

// ─── Helpers internos ─────────────────────────────────────────────────────────

function anchorAgeHours(frozenAnchor: VwapAnchorState, now: number): number {
  return (now - frozenAnchor.setAt) / 3_600_000;
}

function cooldownOk(frozenAnchor: VwapAnchorState, now: number): boolean {
  return anchorAgeHours(frozenAnchor, now) >= ANCHOR_COOLDOWN_MIN_HOURS;
}

function computeP95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * 0.95);
  return sorted[Math.min(idx, sorted.length - 1)];
}

function computeRecentStructure(candles: TimestampedCandle[], lookbackH: number, now: number): {
  p95: number;
  windowHigh: number;
  windowLow: number;
  candleCount: number;
} {
  const fromMs = now - lookbackH * 3_600_000;
  const window = candles.filter(c => c.time >= fromMs);
  if (window.length === 0) return { p95: 0, windowHigh: 0, windowLow: 0, candleCount: 0 };
  const highs = window.map(c => c.high);
  const lows  = window.map(c => c.low);
  return {
    p95: computeP95(highs),
    windowHigh: Math.max(...highs),
    windowLow: Math.min(...lows),
    candleCount: window.length,
  };
}

function detectBreakoutAndConsolidation(
  candles: TimestampedCandle[],
  anchorPrice: number,
  now: number,
): { breakoutDetected: boolean; newLevel: number; consecutiveBelow: number } {
  if (candles.length < BREAKOUT_CONSECUTIVE_CANDLES + 1) {
    return { breakoutDetected: false, newLevel: 0, consecutiveBelow: 0 };
  }

  // Usar las últimas 12 velas para detectar ruptura y consolidación
  const recent = candles.slice(-12);
  const atrPct = computeATRPct(recent, Math.min(14, recent.length - 1));
  const breakoutThreshold = anchorPrice * (1 + atrPct / 100 * 2); // ancla + 2×ATR

  // Contar cuántas velas recientes cierran POR ENCIMA del ancla + buffer
  let consecutiveAbove = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    if (recent[i].close > breakoutThreshold) {
      consecutiveAbove++;
    } else {
      break;
    }
  }

  // Contar cuántas velas recientes trabajan claramente DEBAJO del ancla
  const belowThreshold = anchorPrice * 0.97; // 3% bajo el ancla = zona diferente
  let consecutiveBelow = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    if (recent[i].high < anchorPrice && recent[i].close < belowThreshold) {
      consecutiveBelow++;
    } else {
      break;
    }
  }

  const newLevel = consecutiveAbove >= BREAKOUT_CONSECUTIVE_CANDLES
    ? computeP95(recent.slice(-6).map(c => c.high))
    : 0;

  return {
    breakoutDetected: consecutiveAbove >= BREAKOUT_CONSECUTIVE_CANDLES && newLevel > anchorPrice,
    newLevel,
    consecutiveBelow,
  };
}

// ─── Decisor principal ────────────────────────────────────────────────────────

export async function resolveDynamicAnchor(
  input: ResolveDynamicAnchorInput,
): Promise<DynamicAnchorResult> {
  const {
    pair, mode, currentPrice, candles, basePriceResult, frozenAnchor,
    vwapContext, vwapResult, hasActiveCycle, hasPendingExit,
    vwapEnabled, dynamicAnchorEnabled, emergencyDisable,
  } = input;
  const now = input.now ?? Date.now();

  // ── 0. Kill switch / emergency disable ───────────────────────────────────
  if (emergencyDisable || !dynamicAnchorEnabled) {
    const currentAnchorData = frozenAnchor ? {
      price: frozenAnchor.anchorPrice,
      ageHours: anchorAgeHours(frozenAnchor, now),
      setAt: frozenAnchor.setAt,
    } : null;
    return {
      decision: "mantener_ancla",
      changeTrigger: "sin_cambio",
      currentAnchor: currentAnchorData,
      calculatedAnchor: null,
      effectiveEntryReference: frozenAnchor?.anchorPrice ?? basePriceResult.price,
      usedByEngine: false,
      reason: emergencyDisable
        ? "Ancla dinámica desactivada por emergencia. Usando comportamiento anterior."
        : "Ancla dinámica desactivada. Usando comportamiento anterior.",
      marketReading: "Sin evaluación dinámica.",
      marketZone: vwapContext?.zone ?? null,
      dataState: "datos_suficientes",
      cycleProtection: "sin_ciclo",
      actionTaken: "sin_cambios",
      canOpenNewCycle: true,
      auditPayload: { emergencyDisable, dynamicAnchorEnabled },
    };
  }

  // ── 1. Protección: ciclo activo ───────────────────────────────────────────
  if (hasActiveCycle) {
    const currentAnchorData = frozenAnchor ? {
      price: frozenAnchor.anchorPrice,
      ageHours: anchorAgeHours(frozenAnchor, now),
      setAt: frozenAnchor.setAt,
    } : null;
    return {
      decision: "ciclo_activo_solo_contexto",
      changeTrigger: "bloqueado_por_ciclo",
      currentAnchor: currentAnchorData,
      calculatedAnchor: frozenAnchor ? {
        price: frozenAnchor.anchorPrice,
        method: "frozen",
        confidence: "alta",
      } : null,
      effectiveEntryReference: frozenAnchor?.anchorPrice ?? basePriceResult.price,
      usedByEngine: false,
      reason: "Hay un ciclo activo. La Ancla IDCA solo aporta contexto. No modifica precio medio, próxima compra ni escalera.",
      marketReading: "Contexto informativo. El ciclo activo gestiona su propia referencia.",
      marketZone: vwapContext?.zone ?? null,
      dataState: "datos_suficientes",
      cycleProtection: "ciclo_activo_protegido",
      actionTaken: "sin_accion_por_ciclo",
      canOpenNewCycle: false,
      auditPayload: { hasActiveCycle, pair, frozenAnchorPrice: frozenAnchor?.anchorPrice },
    };
  }

  // ── 2. Protección: salida pendiente ──────────────────────────────────────
  if (hasPendingExit) {
    const currentAnchorData = frozenAnchor ? {
      price: frozenAnchor.anchorPrice,
      ageHours: anchorAgeHours(frozenAnchor, now),
      setAt: frozenAnchor.setAt,
    } : null;
    return {
      decision: "salida_pendiente_sin_accion",
      changeTrigger: "bloqueado_por_salida",
      currentAnchor: currentAnchorData,
      calculatedAnchor: null,
      effectiveEntryReference: frozenAnchor?.anchorPrice ?? basePriceResult.price,
      usedByEngine: false,
      reason: "Hay una salida pendiente. La Ancla IDCA no realiza ninguna acción nueva.",
      marketReading: "Salida programada en curso. Sin acción de entrada.",
      marketZone: vwapContext?.zone ?? null,
      dataState: "datos_suficientes",
      cycleProtection: "salida_pendiente",
      actionTaken: "sin_cambios",
      canOpenNewCycle: false,
      auditPayload: { hasPendingExit, pair },
    };
  }

  // ── 3. Evaluar calidad de datos (E) ───────────────────────────────────────
  const health = await checkMarketDataHealth(pair, mode);
  const dataState = health.dataReadinessState;

  if (dataState === "feed_detenido") {
    return {
      decision: "bloquear_nuevas_entradas_por_datos",
      changeTrigger: "bloqueado_por_datos",
      currentAnchor: frozenAnchor ? {
        price: frozenAnchor.anchorPrice,
        ageHours: anchorAgeHours(frozenAnchor, now),
        setAt: frozenAnchor.setAt,
      } : null,
      calculatedAnchor: null,
      effectiveEntryReference: frozenAnchor?.anchorPrice ?? basePriceResult.price,
      usedByEngine: false,
      reason: `Feed de datos detenido: última vela hace ${health.lastCandleAgeMinutes} minutos. No se abrirán nuevas entradas IDCA hasta recuperar datos fiables.`,
      marketReading: "Feed de datos detenido.",
      marketZone: null,
      dataState,
      cycleProtection: "sin_ciclo",
      actionTaken: "nuevas_entradas_bloqueadas",
      canOpenNewCycle: false,
      auditPayload: { dataState, lastCandleAgeMinutes: health.lastCandleAgeMinutes, candleCount: health.candleCount },
    };
  }

  if (dataState === "datos_insuficientes") {
    return {
      decision: "bloquear_nuevas_entradas_por_datos",
      changeTrigger: "cambio_por_calidad_datos",
      currentAnchor: frozenAnchor ? {
        price: frozenAnchor.anchorPrice,
        ageHours: anchorAgeHours(frozenAnchor, now),
        setAt: frozenAnchor.setAt,
      } : null,
      calculatedAnchor: null,
      effectiveEntryReference: frozenAnchor?.anchorPrice ?? basePriceResult.price,
      usedByEngine: false,
      reason: `No hay datos suficientes para calcular la Ancla IDCA con seguridad. Velas disponibles: ${health.candleCount}/${health.requiredCandles}. Acción: completando histórico desde Kraken.`,
      marketReading: "Datos insuficientes.",
      marketZone: null,
      dataState,
      cycleProtection: "sin_ciclo",
      actionTaken: "completando_historico",
      canOpenNewCycle: false,
      auditPayload: { dataState, candleCount: health.candleCount, required: health.requiredCandles },
    };
  }

  // Modo conservador si datos parciales
  const conservativeMode = dataState === "datos_parciales";

  // ── 4. Calcular estructura actual del mercado ─────────────────────────────
  const structure24h = computeRecentStructure(candles, 24, now);
  const structure48h = computeRecentStructure(candles, 48, now);
  const structure72h = computeRecentStructure(candles, 72, now);

  const newBasePriceCandidate = basePriceResult.price;
  const currentAnchorPrice = frozenAnchor?.anchorPrice ?? 0;
  const hasAnchor = currentAnchorPrice > 0;
  const anchorAge = frozenAnchor ? anchorAgeHours(frozenAnchor, now) : 0;
  const anchorCooldownOk = frozenAnchor ? cooldownOk(frozenAnchor, now) : true;

  // ── 5. Evaluar zona de mercado y VWAP ─────────────────────────────────────
  const vwapPrice = vwapResult?.vwap ?? vwapContext?.vwap ?? 0;
  const vwapIsReliable = (vwapResult?.isReliable ?? false) && vwapPrice > 0;
  const zone = vwapContext?.zone ?? null;

  let marketReading = "Evaluación de Ancla IDCA.";
  let marketZone: string | null = zone;

  // Detectar precio caro vs VWAP
  const priceAboveVwapPct = vwapIsReliable && vwapPrice > 0
    ? (currentPrice - vwapPrice) / vwapPrice
    : null;

  if (vwapIsReliable && priceAboveVwapPct !== null) {
    if (priceAboveVwapPct > PRICE_EXPENSIVE_ABOVE_VWAP_PCT) {
      // Precio caro — no perseguir. No significa vender.
      return {
        decision: "precio_caro_no_perseguir",
        changeTrigger: "sin_cambio",
        currentAnchor: hasAnchor ? {
          price: currentAnchorPrice,
          ageHours: anchorAge,
          setAt: frozenAnchor!.setAt,
        } : null,
        calculatedAnchor: newBasePriceCandidate > 0 ? {
          price: newBasePriceCandidate,
          method: basePriceResult.type,
          confidence: "media",
        } : null,
        effectiveEntryReference: hasAnchor ? currentAnchorPrice : basePriceResult.price,
        usedByEngine: false,
        reason: `Precio caro frente al VWAP (${(priceAboveVwapPct * 100).toFixed(1)}% por encima). No perseguir entrada. La Ancla IDCA no renovará ni abrirá entrada agresiva en esta zona.`,
        marketReading: `Precio extendido sobre VWAP (${(priceAboveVwapPct * 100).toFixed(1)}%).`,
        marketZone,
        dataState,
        cycleProtection: "sin_ciclo",
        actionTaken: "sin_cambios",
        canOpenNewCycle: false,
        auditPayload: { priceAboveVwapPct, vwapPrice, currentPrice, zone },
      };
    }

    if (priceAboveVwapPct < -PRICE_INTERESTING_BELOW_VWAP_PCT) {
      marketReading = `Precio en zona interesante (${(-priceAboveVwapPct * 100).toFixed(1)}% bajo VWAP). Requiere confirmación antes de entrada.`;
    }
  }

  // ── 6. Si no hay ancla → crear una nueva ──────────────────────────────────
  if (!hasAnchor && newBasePriceCandidate > 0) {
    const confidence = dataState === "datos_completos" ? "alta" : dataState === "datos_suficientes" ? "media" : "baja";
    return {
      decision: "renovar_ancla",
      changeTrigger: "cambio_por_estructura",
      currentAnchor: null,
      calculatedAnchor: { price: newBasePriceCandidate, method: basePriceResult.type, confidence },
      effectiveEntryReference: newBasePriceCandidate,
      usedByEngine: true,
      reason: `Sin ancla previa. Se establece nueva referencia IDCA desde estructura actual del mercado (${basePriceResult.type}).`,
      marketReading,
      marketZone,
      dataState,
      cycleProtection: "sin_ciclo",
      actionTaken: "renovacion_automatica",
      canOpenNewCycle: health.canOpenNewIdcaCycle,
      auditPayload: { noAnchor: true, newBasePriceCandidate, method: basePriceResult.type, dataState },
    };
  }

  // A partir de aquí tenemos ancla existente — evaluar si renovar

  // ── 7. Trigger A — CAMBIO POR ESTRUCTURA ─────────────────────────────────
  if (!conservativeMode && anchorCooldownOk && hasAnchor && structure24h.candleCount >= 7) {
    const structureDivergence = structure24h.p95 > 0
      ? Math.abs(currentAnchorPrice - structure24h.p95) / currentAnchorPrice
      : 0;

    const marketWorkingInNewZone =
      structure24h.p95 > 0 &&
      structureDivergence > STRUCTURE_DIVERGENCE_THRESHOLD &&
      newBasePriceCandidate > 0 &&
      Math.abs(newBasePriceCandidate - currentAnchorPrice) / currentAnchorPrice > STRUCTURE_DIVERGENCE_THRESHOLD;

    if (marketWorkingInNewZone) {
      const confidence = dataState === "datos_completos" ? "alta" : "media";
      idcaLog("info", `Ancla IDCA renovada por cambio de estructura`, {
        pair, mode,
        event: "idca_dynamic_anchor_structure_change",
        oldAnchor: currentAnchorPrice,
        newAnchor: newBasePriceCandidate,
        divergencePct: +(structureDivergence * 100).toFixed(2),
      });
      return {
        decision: "renovar_ancla",
        changeTrigger: "cambio_por_estructura",
        currentAnchor: { price: currentAnchorPrice, ageHours: anchorAge, setAt: frozenAnchor!.setAt },
        calculatedAnchor: { price: newBasePriceCandidate, method: basePriceResult.type, confidence },
        effectiveEntryReference: newBasePriceCandidate,
        usedByEngine: true,
        reason: `El mercado está trabajando en una zona distinta. La Ancla IDCA se renueva para futuras entradas. Divergencia de estructura: ${(structureDivergence * 100).toFixed(1)}%.`,
        marketReading: `Estructura reciente (P95 24h: $${structure24h.p95.toFixed(0)}) se aleja del ancla anterior ($${currentAnchorPrice.toFixed(0)}).`,
        marketZone,
        dataState,
        cycleProtection: "sin_ciclo",
        actionTaken: "renovacion_automatica",
        canOpenNewCycle: health.canOpenNewIdcaCycle,
        auditPayload: {
          trigger: "estructura",
          oldAnchor: currentAnchorPrice,
          newAnchor: newBasePriceCandidate,
          p95_24h: structure24h.p95,
          p95_48h: structure48h.p95,
          structureDivergencePct: +(structureDivergence * 100).toFixed(2),
          dataState,
        },
      };
    }
  }

  // ── 8. Trigger C — CAMBIO POR RUPTURA Y CONSOLIDACIÓN ────────────────────
  if (!conservativeMode && anchorCooldownOk && hasAnchor && candles.length >= BREAKOUT_CONSECUTIVE_CANDLES + 2) {
    const { breakoutDetected, newLevel } = detectBreakoutAndConsolidation(candles, currentAnchorPrice, now);

    if (breakoutDetected && newLevel > currentAnchorPrice) {
      const confidence = dataState === "datos_completos" ? "alta" : "media";
      idcaLog("info", `Ancla IDCA renovada por ruptura y consolidación`, {
        pair, mode,
        event: "idca_dynamic_anchor_breakout_consolidation_change",
        oldAnchor: currentAnchorPrice,
        newAnchor: newLevel,
      });
      return {
        decision: "renovar_ancla",
        changeTrigger: "cambio_por_ruptura_consolidacion",
        currentAnchor: { price: currentAnchorPrice, ageHours: anchorAge, setAt: frozenAnchor!.setAt },
        calculatedAnchor: { price: newLevel, method: "breakout_consolidation", confidence },
        effectiveEntryReference: newLevel,
        usedByEngine: true,
        reason: `El precio rompió la zona anterior y consolidó en una nueva referencia. La Ancla IDCA se renueva.`,
        marketReading: `Ruptura confirmada: ${BREAKOUT_CONSECUTIVE_CANDLES}+ velas fuera de la zona anterior.`,
        marketZone,
        dataState,
        cycleProtection: "sin_ciclo",
        actionTaken: "renovacion_automatica",
        canOpenNewCycle: health.canOpenNewIdcaCycle,
        auditPayload: {
          trigger: "ruptura_consolidacion",
          oldAnchor: currentAnchorPrice,
          newAnchor: newLevel,
          consecutiveCandlesRequired: BREAKOUT_CONSECUTIVE_CANDLES,
          dataState,
        },
      };
    }
  }

  // ── 9. Trigger B — CAMBIO POR VWAP ───────────────────────────────────────
  if (vwapEnabled && vwapIsReliable && anchorCooldownOk && hasAnchor) {
    const anchorVsVwapDivergence = vwapPrice > 0
      ? Math.abs(currentAnchorPrice - vwapPrice) / vwapPrice
      : 0;

    const vwapDiverged = anchorVsVwapDivergence > ANCHOR_DIVERGENCE_VWAP_THRESHOLD;
    const vwapAlignedWithNewBase = newBasePriceCandidate > 0 && vwapPrice > 0 &&
      Math.abs(newBasePriceCandidate - vwapPrice) / vwapPrice < ANCHOR_DIVERGENCE_VWAP_THRESHOLD;

    if (vwapDiverged && vwapAlignedWithNewBase && !conservativeMode) {
      const confidence = dataState === "datos_completos" ? "alta" : "media";
      idcaLog("info", `Ancla IDCA renovada por VWAP`, {
        pair, mode,
        event: "idca_dynamic_anchor_vwap_change",
        oldAnchor: currentAnchorPrice,
        newAnchor: newBasePriceCandidate,
        vwapPrice,
        divergencePct: +(anchorVsVwapDivergence * 100).toFixed(2),
      });
      return {
        decision: "renovar_ancla",
        changeTrigger: "cambio_por_vwap",
        currentAnchor: { price: currentAnchorPrice, ageHours: anchorAge, setAt: frozenAnchor!.setAt },
        calculatedAnchor: { price: newBasePriceCandidate, method: basePriceResult.type, confidence },
        effectiveEntryReference: newBasePriceCandidate,
        usedByEngine: true,
        reason: `El ancla actual está alejada del VWAP y ya no representa bien el mercado. Divergencia: ${(anchorVsVwapDivergence * 100).toFixed(1)}% vs VWAP.`,
        marketReading: `VWAP: $${vwapPrice.toFixed(0)} | Ancla anterior: $${currentAnchorPrice.toFixed(0)} | Nueva referencia alineada.`,
        marketZone,
        dataState,
        cycleProtection: "sin_ciclo",
        actionTaken: "renovacion_automatica",
        canOpenNewCycle: health.canOpenNewIdcaCycle,
        auditPayload: {
          trigger: "vwap",
          oldAnchor: currentAnchorPrice,
          newAnchor: newBasePriceCandidate,
          vwapPrice,
          anchorVsVwapDivergencePct: +(anchorVsVwapDivergence * 100).toFixed(2),
          dataState,
        },
      };
    }

    // Ancla coherente con VWAP pero con divergencia moderada → avisar
    if (vwapDiverged && !vwapAlignedWithNewBase) {
      return {
        decision: "avisar_pero_mantener",
        changeTrigger: "cambio_por_vwap",
        currentAnchor: { price: currentAnchorPrice, ageHours: anchorAge, setAt: frozenAnchor!.setAt },
        calculatedAnchor: null,
        effectiveEntryReference: currentAnchorPrice,
        usedByEngine: true,
        reason: `El ancla tiene divergencia frente al VWAP (${(anchorVsVwapDivergence * 100).toFixed(1)}%), pero no hay alternativa más alineada disponible. Se mantiene con aviso.`,
        marketReading: `VWAP: $${vwapPrice.toFixed(0)} | Ancla: $${currentAnchorPrice.toFixed(0)}.`,
        marketZone,
        dataState,
        cycleProtection: "sin_ciclo",
        actionTaken: "sin_cambios",
        canOpenNewCycle: health.canOpenNewIdcaCycle,
        auditPayload: {
          trigger: "vwap_warn",
          anchorVsVwapDivergencePct: +(anchorVsVwapDivergence * 100).toFixed(2),
          dataState,
        },
      };
    }
  }

  // ── 10. Trigger D — CAMBIO POR OBSOLESCENCIA ─────────────────────────────
  if (hasAnchor) {
    // Ancla muy antigua (>168h) y divergente
    if (anchorAge >= ANCHOR_VERY_STALE_HOURS && anchorCooldownOk && !conservativeMode) {
      const candidateDivergence = newBasePriceCandidate > 0
        ? Math.abs(newBasePriceCandidate - currentAnchorPrice) / currentAnchorPrice
        : 0;

      if (candidateDivergence > 0.02) { // 2% diferente = divergente
        const confidence = dataState === "datos_completos" ? "alta" : "media";
        idcaLog("info", `Ancla IDCA renovada por obsolescencia`, {
          pair, mode,
          event: "idca_dynamic_anchor_obsolescence_review",
          oldAnchor: currentAnchorPrice,
          newAnchor: newBasePriceCandidate,
          anchorAgeHours: +anchorAge.toFixed(1),
        });
        return {
          decision: "renovar_ancla",
          changeTrigger: "cambio_por_obsolescencia",
          currentAnchor: { price: currentAnchorPrice, ageHours: anchorAge, setAt: frozenAnchor!.setAt },
          calculatedAnchor: { price: newBasePriceCandidate, method: basePriceResult.type, confidence },
          effectiveEntryReference: newBasePriceCandidate,
          usedByEngine: true,
          reason: `El ancla es muy antigua (${anchorAge.toFixed(0)}h) y ya no representa bien el mercado actual. Se renueva con la estructura reciente.`,
          marketReading: `Ancla obsoleta: ${anchorAge.toFixed(0)}h de antigüedad.`,
          marketZone,
          dataState,
          cycleProtection: "sin_ciclo",
          actionTaken: "renovacion_automatica",
          canOpenNewCycle: health.canOpenNewIdcaCycle,
          auditPayload: {
            trigger: "obsolescencia",
            anchorAgeHours: +anchorAge.toFixed(1),
            oldAnchor: currentAnchorPrice,
            newAnchor: newBasePriceCandidate,
            candidateDivergencePct: +(candidateDivergence * 100).toFixed(2),
            dataState,
          },
        };
      }
    }

    // Ancla antigua (>72h) pero coherente → avisar, mantener
    if (anchorAge >= ANCHOR_STALE_WARN_HOURS) {
      idcaLog("info", `Revisión de antigüedad de Ancla IDCA`, {
        pair, mode,
        event: "idca_dynamic_anchor_obsolescence_review",
        anchorAgeHours: +anchorAge.toFixed(1),
        anchorPrice: currentAnchorPrice,
      });
      return {
        decision: "avisar_pero_mantener",
        changeTrigger: "cambio_por_obsolescencia",
        currentAnchor: { price: currentAnchorPrice, ageHours: anchorAge, setAt: frozenAnchor!.setAt },
        calculatedAnchor: newBasePriceCandidate > 0 ? {
          price: newBasePriceCandidate,
          method: basePriceResult.type,
          confidence: "media",
        } : null,
        effectiveEntryReference: currentAnchorPrice,
        usedByEngine: true,
        reason: `El ancla tiene antigüedad (${anchorAge.toFixed(0)}h), pero sigue alineada con el mercado actual. Se mantiene con aviso de revisión.`,
        marketReading: `Ancla con ${anchorAge.toFixed(0)}h. Coherente con estructura actual.`,
        marketZone,
        dataState,
        cycleProtection: "sin_ciclo",
        actionTaken: "sin_cambios",
        canOpenNewCycle: health.canOpenNewIdcaCycle,
        auditPayload: {
          trigger: "obsolescencia_aviso",
          anchorAgeHours: +anchorAge.toFixed(1),
          dataState,
        },
      };
    }
  }

  // ── 11. Zona interesante sin trigger claro de cambio ─────────────────────
  if (vwapIsReliable && priceAboveVwapPct !== null && priceAboveVwapPct < -PRICE_INTERESTING_BELOW_VWAP_PCT) {
    return {
      decision: "zona_interesante_con_confirmacion",
      changeTrigger: "sin_cambio",
      currentAnchor: hasAnchor ? {
        price: currentAnchorPrice,
        ageHours: anchorAge,
        setAt: frozenAnchor!.setAt,
      } : null,
      calculatedAnchor: null,
      effectiveEntryReference: hasAnchor ? currentAnchorPrice : basePriceResult.price,
      usedByEngine: true,
      reason: `Precio en zona interesante (${(-priceAboveVwapPct * 100).toFixed(1)}% bajo VWAP). Puede ser zona de valor, pero requiere confirmación: caída mínima, score, capital, cooldown y filtros.`,
      marketReading: `Precio bajo VWAP en zona favorable.`,
      marketZone,
      dataState,
      cycleProtection: "sin_ciclo",
      actionTaken: "sin_cambios",
      canOpenNewCycle: health.canOpenNewIdcaCycle,
      auditPayload: {
        priceAboveVwapPct: +(priceAboveVwapPct * 100).toFixed(2),
        vwapPrice,
        currentPrice,
        dataState,
      },
    };
  }

  // ── 12. Mantener ancla — sin trigger claro ────────────────────────────────
  return {
    decision: "mantener_ancla",
    changeTrigger: "sin_cambio",
    currentAnchor: hasAnchor ? {
      price: currentAnchorPrice,
      ageHours: anchorAge,
      setAt: frozenAnchor!.setAt,
    } : null,
    calculatedAnchor: newBasePriceCandidate > 0 ? {
      price: newBasePriceCandidate,
      method: basePriceResult.type,
      confidence: "media",
    } : null,
    effectiveEntryReference: hasAnchor ? currentAnchorPrice : basePriceResult.price,
    usedByEngine: true,
    reason: `Ancla IDCA mantenida. No hay trigger profesional claro para renovación.`,
    marketReading,
    marketZone,
    dataState,
    cycleProtection: "sin_ciclo",
    actionTaken: "sin_cambios",
    canOpenNewCycle: health.canOpenNewIdcaCycle,
    auditPayload: {
      anchorAgeHours: hasAnchor ? +anchorAge.toFixed(1) : null,
      currentAnchorPrice,
      newBasePriceCandidate,
      dataState,
      conservativeMode,
    },
  };
}
