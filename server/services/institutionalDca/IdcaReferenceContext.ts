/**
 * IdcaReferenceContext — Enriched reference context builder for IDCA.
 *
 * Adds human-readable reasons, VWAP reliability metadata, anchor status,
 * and hybrid details on top of EffectiveEntryReferenceResult.
 *
 * Rules:
 * - NEVER changes trading logic or entry conditions.
 * - Output is metadata-only: for logs, events, and UI display.
 * - All fields have fallbacks; no field is required for correct trading operation.
 */

import type { EffectiveEntryReferenceResult, VwapAnchorState } from "./IdcaEntryReferenceResolver";
import type { VwapEntryContext, BasePriceResult } from "./IdcaTypes";

// ─── Constants ────────────────────────────────────────────────────────────────

export const MIN_VWAP_CANDLES_FOR_ENTRY_DEFAULT = 24;
export const ANCHOR_STALE_HOURS       = 72;
export const ANCHOR_VERY_STALE_HOURS  = 168;

// ─── Types ────────────────────────────────────────────────────────────────────

export type VwapReliabilityStatus =
  | "used"
  | "insufficient_candles"
  | "incomplete_window"
  | "low_or_abnormal_volume"
  | "invalid_ohlcv_data"
  | "immature_vwap"
  | "stale_anchor"
  | "invalidated_by_break_above"
  | "rejected_anti_chasing"
  | "change_too_small"
  | "locked_by_active_opportunity"
  | "locked_by_active_cycle"
  | "outlier_rejected"
  | "unstable_market_structure"
  | "vwap_hybrid_divergence"
  | "missing_anchor"
  | "calculation_error"
  | "unknown";

export type AnchorStatus = "active" | "stale" | "locked" | "fallback" | "imported" | "unknown";

export type ReferenceSource =
  | "vwap_anchor"
  | "smart_anchor"
  | "hybrid_v2"
  | "hybrid_fallback"
  | "manual_imported"
  | "unknown";

export interface VwapReliability {
  usableForEntry: boolean;
  usableForContext: boolean;
  status: VwapReliabilityStatus;
  reason: string;
  candlesUsed?: number;
  minCandlesRequired?: number;
  anchorAgeHours?: number;
  volumeQualityScore?: number;
  divergencePctVsHybrid?: number;
  checkedAt?: string;
}

export interface ReferenceContext {
  pair: string;

  effectiveEntryReference: number;

  referenceSource: ReferenceSource;
  referenceLabel: string;
  referenceReason: string;

  vwapUsed: boolean;
  vwapReliability: VwapReliability;
  vwapStatus: VwapReliabilityStatus;
  vwapRejectReason: string | null;

  hybridCandidatePrice: number | null;
  hybridCandidateMethod: string | null;
  hybridReason: string | null;

  anchorPrice: number | null;
  anchorTimestamp: string | null;   // ISO — candle timestamp
  anchorUpdatedAt: string | null;   // ISO — when the anchor was set (setAt)
  anchorAgeHours: number | null;
  anchorStatus: AnchorStatus;
  anchorReason: string;

  previousAnchor: {
    anchorPrice: number;
    anchorTimestamp: number;
    replacedAt?: number;
    invalidationReason?: string;
  } | null;
}

// ─── Helper: human-readable VWAP reason ──────────────────────────────────────

export function getVwapReliabilityReason(
  status: VwapReliabilityStatus,
  details?: {
    candlesUsed?: number;
    minCandlesRequired?: number;
    anchorAgeHours?: number;
    divergencePctVsHybrid?: number;
  },
): string {
  const c      = details?.candlesUsed ?? "?";
  const m      = details?.minCandlesRequired ?? MIN_VWAP_CANDLES_FOR_ENTRY_DEFAULT;
  const ageH   = details?.anchorAgeHours;
  const ageTxt = ageH != null ? ` Edad de la ancla: ${ageH.toFixed(1)}h.` : "";

  switch (status) {
    case "used":
      if (ageH != null && ageH > ANCHOR_VERY_STALE_HOURS)
        return `VWAP usado como referencia congelada.${ageTxt} Revisar si sigue siendo representativa del mercado actual.`;
      if (ageH != null && ageH > ANCHOR_STALE_HOURS)
        return `VWAP usado como referencia congelada.${ageTxt}`;
      return "VWAP usado: existe una referencia válida y se evalúa la entrada contra esa ancla.";
    case "insufficient_candles":
      return `VWAP no usado: solo hay ${c} velas y se requieren al menos ${m} para entrada.`;
    case "incomplete_window":
      return "VWAP no usado: la ventana de cálculo todavía no cubre suficiente histórico.";
    case "low_or_abnormal_volume":
      return "VWAP no usado: el volumen disponible es bajo o irregular, por lo que el precio medio ponderado no es representativo.";
    case "invalid_ohlcv_data":
      return "VWAP no usado: hay velas incompletas, duplicadas o con datos incoherentes.";
    case "immature_vwap":
      return "VWAP no usado: la referencia es demasiado reciente y aún no está estabilizada.";
    case "stale_anchor":
      return `VWAP no usado: la ancla es demasiado antigua y puede no representar bien la estructura actual del mercado.${ageTxt}`;
    case "invalidated_by_break_above":
      return "VWAP no usado: el precio superó la referencia anterior y esa ancla quedó invalidada.";
    case "rejected_anti_chasing":
      return "VWAP no usado: el nuevo candidato de ancla fue rechazado para evitar perseguir el precio.";
    case "change_too_small":
      return "VWAP no actualizado: el cambio respecto a la referencia anterior es demasiado pequeño.";
    case "locked_by_active_opportunity":
      return "VWAP no actualizado: hay una oportunidad activa o Trailing Buy en curso.";
    case "locked_by_active_cycle":
      return "VWAP no actualizado: existe un ciclo activo y la referencia queda congelada para no cambiar las reglas durante la gestión.";
    case "outlier_rejected":
      return "VWAP no usado: el candidato de referencia parece un outlier respecto al rango reciente.";
    case "unstable_market_structure":
      return "VWAP no usado: el precio se está moviendo de forma demasiado vertical y la referencia aún no es estable.";
    case "vwap_hybrid_divergence":
      return `VWAP no usado: la referencia VWAP se aleja demasiado de la referencia Hybrid V2.1.${
        details?.divergencePctVsHybrid != null ? ` Divergencia: ${details.divergencePctVsHybrid.toFixed(1)}%.` : ""
      }`;
    case "missing_anchor":
      return "VWAP no usado: no existe una ancla VWAP válida para este par.";
    case "calculation_error":
      return "VWAP no usado: no se pudo calcular una referencia VWAP válida.";
    case "unknown":
    default:
      return "VWAP no usado: motivo no determinado. Revisar metadata de referencia.";
  }
}

// ─── Helper: anchor status ────────────────────────────────────────────────────

function resolveAnchorStatus(
  source: ReferenceSource,
  anchorAgeHours: number | null,
  hasActiveCycle: boolean,
  trailingArmed: boolean,
): AnchorStatus {
  if (source === "hybrid_fallback" || source === "hybrid_v2") return "fallback";
  if (source === "manual_imported") return "imported";
  if (source === "unknown") return "unknown";
  if (hasActiveCycle || trailingArmed) return "locked";
  if (anchorAgeHours == null) return "unknown";
  if (anchorAgeHours >= ANCHOR_STALE_HOURS) return "stale";
  return "active";
}

// ─── Build input ──────────────────────────────────────────────────────────────

export interface BuildReferenceContextInput {
  pair: string;
  refResult: EffectiveEntryReferenceResult;
  basePriceResult: BasePriceResult;
  vwapEnabled: boolean;
  frozenAnchor?: VwapAnchorState;
  vwapContext?: VwapEntryContext;
  minCandlesForEntry?: number;
  hasActiveCycle?: boolean;
  trailingArmed?: boolean;
  now?: number;
}

// ─── Main builder ─────────────────────────────────────────────────────────────

export function buildReferenceContext(input: BuildReferenceContextInput): ReferenceContext {
  const {
    pair,
    refResult,
    basePriceResult,
    vwapEnabled,
    frozenAnchor,
    vwapContext,
    minCandlesForEntry = MIN_VWAP_CANDLES_FOR_ENTRY_DEFAULT,
    hasActiveCycle = false,
    trailingArmed = false,
    now = Date.now(),
  } = input;

  const rawSource = refResult.effectiveReferenceSource;

  // ── Normalize source ───────────────────────────────────────────────────────
  const referenceSource: ReferenceSource =
    rawSource === "vwap_anchor" ? "vwap_anchor" : "hybrid_v2";

  // ── Hybrid metadata ────────────────────────────────────────────────────────
  const hybridCandidatePrice  = basePriceResult.meta?.selectedAnchorPrice ?? basePriceResult.price ?? null;
  const hybridCandidateMethod = basePriceResult.meta?.selectedMethod ?? (basePriceResult.type as string) ?? null;
  const hybridReason          = basePriceResult.meta?.selectedReason ?? basePriceResult.reason ?? null;

  // ── Anchor timestamps ──────────────────────────────────────────────────────
  const anchorAgeHours  = refResult.frozenAnchorAgeHours ?? null;
  const anchorTimestamp = refResult.frozenAnchorTs
    ? new Date(refResult.frozenAnchorTs).toISOString()
    : null;
  const anchorUpdatedAt = frozenAnchor?.setAt
    ? new Date(frozenAnchor.setAt).toISOString()
    : refResult.referenceUpdatedAt ?? null;

  // ── VWAP status and reliability ────────────────────────────────────────────
  const candlesUsed = vwapContext?.candlesUsed ?? basePriceResult.meta?.candleCount;

  let vwapStatus: VwapReliabilityStatus;
  let vwapUsed: boolean;

  if (referenceSource === "vwap_anchor") {
    vwapUsed   = true;
    vwapStatus = "used";
  } else {
    vwapUsed = false;
    if (!vwapEnabled) {
      vwapStatus = "missing_anchor";
    } else if (!frozenAnchor || !(frozenAnchor.anchorPrice > 0)) {
      if (candlesUsed != null && candlesUsed < minCandlesForEntry) {
        vwapStatus = "insufficient_candles";
      } else if (!basePriceResult.isReliable) {
        vwapStatus = "calculation_error";
      } else {
        vwapStatus = "missing_anchor";
      }
    } else {
      vwapStatus = "unknown";
    }
  }

  const vwapReliabilityReason = getVwapReliabilityReason(vwapStatus, {
    candlesUsed,
    minCandlesRequired: minCandlesForEntry,
    anchorAgeHours: anchorAgeHours ?? undefined,
  });

  const vwapReliability: VwapReliability = {
    usableForEntry:    vwapUsed,
    usableForContext:  vwapUsed || (vwapContext?.isReliable ?? false),
    status:            vwapStatus,
    reason:            vwapReliabilityReason,
    candlesUsed,
    minCandlesRequired: minCandlesForEntry,
    anchorAgeHours:    anchorAgeHours ?? undefined,
    checkedAt:         new Date(now).toISOString(),
  };

  const vwapRejectReason = vwapUsed ? null : vwapReliabilityReason;

  // ── Anchor status ──────────────────────────────────────────────────────────
  const anchorStatus = resolveAnchorStatus(referenceSource, anchorAgeHours, hasActiveCycle, trailingArmed);

  // ── Human-readable reasons ─────────────────────────────────────────────────
  const referenceLabel = refResult.effectiveReferenceLabel;
  let referenceReason: string;
  let anchorReason: string;

  if (referenceSource === "vwap_anchor") {
    if (anchorStatus === "locked") {
      if (hasActiveCycle) {
        referenceReason = "Se usa VWAP Anclado porque existe un ciclo activo y la referencia está congelada.";
        anchorReason    = "Referencia congelada por ciclo activo — no se actualizará hasta que el ciclo cierre.";
      } else {
        referenceReason = "Se usa VWAP Anclado porque hay un Trailing Buy en curso.";
        anchorReason    = "Referencia congelada por Trailing Buy activo.";
      }
    } else if (anchorStatus === "stale") {
      referenceReason = "Se usa VWAP Anclado porque está congelado como referencia de entrada, aunque es una referencia antigua.";
      anchorReason    = anchorAgeHours != null
        ? `Referencia activa pero antigua. Edad: ${anchorAgeHours.toFixed(1)}h.${
            anchorAgeHours > ANCHOR_VERY_STALE_HOURS ? " Revisar si sigue siendo representativa." : ""
          }`
        : "Referencia activa con edad no determinada.";
    } else {
      referenceReason = "Se usa VWAP Anclado porque existe una referencia válida y está activa.";
      anchorReason    = "Referencia activa usada para medir caída de entrada.";
    }
  } else {
    if (!vwapEnabled) {
      referenceReason = "Se usa Hybrid V2.1 porque VWAP está desactivado para este par.";
    } else if (vwapStatus === "insufficient_candles") {
      referenceReason = `Se usa Hybrid V2.1 porque el VWAP no tiene datos suficientes (${candlesUsed ?? "?"} velas, mínimo ${minCandlesForEntry}).`;
    } else if (vwapStatus === "calculation_error") {
      referenceReason = "Se usa Hybrid V2.1 porque el VWAP no pudo calcular una referencia válida.";
    } else {
      referenceReason = "Se usa Hybrid V2.1 porque no existe una ancla VWAP válida.";
    }
    anchorReason = "Sin ancla VWAP activa. Referencia derivada de Hybrid V2.1.";
  }

  // ── Previous anchor ────────────────────────────────────────────────────────
  const previousAnchor = refResult.previousAnchor
    ? {
        anchorPrice:        refResult.previousAnchor.anchorPrice,
        anchorTimestamp:    refResult.previousAnchor.anchorTimestamp,
        replacedAt:         refResult.previousAnchor.replacedAt,
        invalidationReason: refResult.previousAnchor.invalidationReason,
      }
    : null;

  return {
    pair,
    effectiveEntryReference: refResult.effectiveEntryReference,
    referenceSource,
    referenceLabel,
    referenceReason,
    vwapUsed,
    vwapReliability,
    vwapStatus,
    vwapRejectReason,
    hybridCandidatePrice,
    hybridCandidateMethod,
    hybridReason,
    anchorPrice:      refResult.frozenAnchorPrice ?? null,
    anchorTimestamp,
    anchorUpdatedAt,
    anchorAgeHours,
    anchorStatus,
    anchorReason,
    previousAnchor,
  };
}
