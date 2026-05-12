/**
 * IdcaMarketDataHealthService
 *
 * Evalúa si los datos de mercado (velas 1h de Kraken/MarketDataService)
 * son suficientes para que la Ancla Dinámica IDCA opere con seguridad.
 *
 * NO crea tablas nuevas de velas: reutiliza MarketDataService/Kraken.
 * NO bloquea el flujo principal: siempre devuelve un resultado.
 */

import { MarketDataService } from "../MarketDataService";
import { idcaLog } from "./idcaLog";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type DataReadinessState =
  | "datos_completos"
  | "datos_suficientes"
  | "datos_parciales"
  | "datos_insuficientes"
  | "feed_detenido";

export type BackfillStatus =
  | "no_necesario"
  | "solicitado"
  | "completado"
  | "fallido"
  | "en_progreso";

export interface MarketDataHealthResult {
  pair: string;
  timeframe: string;
  source: string;
  candleCount: number;
  requiredCandles: number;
  sufficientCandles: number;
  minimumCandles: number;
  missingCandles: number;
  lastCandleTimestamp: number | null;
  lastCandleAgeMinutes: number | null;
  timeframeMinutes: number;
  estimatedReadyAt: string | null;
  hasGaps: boolean;
  gapCount: number;
  backfillStatus: BackfillStatus;
  dataReadinessState: DataReadinessState;
  canUseDynamicAnchor: boolean;
  canOpenNewIdcaCycle: boolean;
  reason: string;
  checkedAt: string;
}

// ─── Configuración por defecto ─────────────────────────────────────────────

const DEFAULTS = {
  requiredCandles: 72,
  sufficientCandles: 24,
  minimumCandles: 7,
  timeframe: "1h" as const,
  timeframeMinutes: 60,
  feedStaledThresholdMinutes: 90, // última vela >90min → feed detenido
  gapThresholdMinutes: 90,        // hueco entre velas >90min = gap
};

// ─── In-memory: backfill state por par ────────────────────────────────────

const backfillState = new Map<string, BackfillStatus>();
const backfillInProgress = new Set<string>();
const lastBackfillAttempt = new Map<string, number>();
const BACKFILL_COOLDOWN_MS = 10 * 60 * 1000; // 10 min entre intentos

// ─── Helpers ──────────────────────────────────────────────────────────────────

function detectGaps(
  candles: Array<{ time: number }>,
  timeframeMinutes: number,
  gapThresholdMinutes: number,
): { hasGaps: boolean; gapCount: number } {
  if (candles.length < 2) return { hasGaps: false, gapCount: 0 };
  const expectedMs = timeframeMinutes * 60 * 1000;
  const thresholdMs = gapThresholdMinutes * 60 * 1000;
  let gapCount = 0;
  const sorted = [...candles].sort((a, b) => a.time - b.time);
  for (let i = 1; i < sorted.length; i++) {
    const diff = sorted[i].time - sorted[i - 1].time;
    if (diff > thresholdMs + expectedMs) {
      gapCount++;
    }
  }
  return { hasGaps: gapCount > 0, gapCount };
}

function computeReadinessState(
  candleCount: number,
  lastCandleAgeMinutes: number | null,
  required: number,
  sufficient: number,
  minimum: number,
  feedStaledThreshold: number,
): DataReadinessState {
  if (lastCandleAgeMinutes !== null && lastCandleAgeMinutes > feedStaledThreshold) {
    return "feed_detenido";
  }
  if (candleCount >= required) return "datos_completos";
  if (candleCount >= sufficient) return "datos_suficientes";
  if (candleCount >= minimum) return "datos_parciales";
  return "datos_insuficientes";
}

function estimateReadyAt(
  candleCount: number,
  required: number,
  timeframeMinutes: number,
): string | null {
  if (candleCount >= required) return null;
  const missingMs = (required - candleCount) * timeframeMinutes * 60 * 1000;
  return new Date(Date.now() + missingMs).toISOString();
}

// ─── Servicio principal ────────────────────────────────────────────────────

async function triggerBackfill(pair: string, mode: string): Promise<void> {
  if (backfillInProgress.has(pair)) return;
  const lastAttempt = lastBackfillAttempt.get(pair) ?? 0;
  if (Date.now() - lastAttempt < BACKFILL_COOLDOWN_MS) return;

  backfillInProgress.add(pair);
  lastBackfillAttempt.set(pair, Date.now());
  backfillState.set(pair, "solicitado");

  idcaLog("info", `Backfill de velas solicitado`, {
    pair,
    mode,
    source: "IdcaMarketDataHealthService",
    event: "idca_market_data_backfill_requested",
  });

  try {
    await MarketDataService.getCandles(pair, "1h");
    backfillState.set(pair, "completado");
    idcaLog("info", `Backfill de velas completado`, {
      pair,
      mode,
      source: "IdcaMarketDataHealthService",
      event: "idca_market_data_backfill_completed",
    });
  } catch (err: any) {
    backfillState.set(pair, "fallido");
    idcaLog("warn", `Backfill de velas fallido: ${err?.message ?? String(err)}`, {
      pair,
      mode,
      source: "IdcaMarketDataHealthService",
      event: "idca_market_data_backfill_failed",
    });
  } finally {
    backfillInProgress.delete(pair);
  }
}

export async function checkMarketDataHealth(
  pair: string,
  mode = "simulation",
  options: {
    requiredCandles?: number;
    sufficientCandles?: number;
    minimumCandles?: number;
  } = {},
): Promise<MarketDataHealthResult> {
  const required  = options.requiredCandles  ?? DEFAULTS.requiredCandles;
  const sufficient = options.sufficientCandles ?? DEFAULTS.sufficientCandles;
  const minimum   = options.minimumCandles   ?? DEFAULTS.minimumCandles;
  const tfMinutes = DEFAULTS.timeframeMinutes;
  const now = Date.now();

  let candles: Array<{ time: number; high: number; low: number; close: number; volume: number }> = [];
  let fetchError: string | null = null;

  try {
    candles = await MarketDataService.getCandles(pair, "1h");
  } catch (err: any) {
    fetchError = err?.message ?? String(err);
  }

  // Normalizar time a ms
  const normalizedCandles = candles.map(c => ({
    ...c,
    time: c.time > 1e12 ? c.time : c.time * 1000,
  }));

  const candleCount = normalizedCandles.length;
  const sortedCandles = [...normalizedCandles].sort((a, b) => a.time - b.time);
  const lastCandle = sortedCandles[sortedCandles.length - 1] ?? null;
  const lastCandleTimestamp = lastCandle?.time ?? null;
  const lastCandleAgeMinutes = lastCandleTimestamp !== null
    ? Math.round((now - lastCandleTimestamp) / 60_000)
    : null;

  const { hasGaps, gapCount } = detectGaps(normalizedCandles, tfMinutes, DEFAULTS.gapThresholdMinutes);

  const dataReadinessState = fetchError
    ? "datos_insuficientes"
    : computeReadinessState(candleCount, lastCandleAgeMinutes, required, sufficient, minimum, DEFAULTS.feedStaledThresholdMinutes);

  const missingCandles = Math.max(0, required - candleCount);
  const estimatedAt = estimateReadyAt(candleCount, required, tfMinutes);

  const canUseDynamicAnchor =
    dataReadinessState === "datos_completos" ||
    dataReadinessState === "datos_suficientes" ||
    (dataReadinessState === "datos_parciales" && candleCount >= minimum);

  const canOpenNewIdcaCycle =
    dataReadinessState === "datos_completos" ||
    dataReadinessState === "datos_suficientes";

  const currentBackfill = backfillState.get(pair) ?? "no_necesario";

  let reason: string;
  switch (dataReadinessState) {
    case "datos_completos":
      reason = `Datos completos: ${candleCount}/${required} velas disponibles.`;
      break;
    case "datos_suficientes":
      reason = `Datos suficientes: ${candleCount}/${required} velas. Ancla dinámica conservadora.`;
      break;
    case "datos_parciales":
      reason = `Datos parciales: ${candleCount}/${required} velas. Diagnóstico limitado.`;
      break;
    case "datos_insuficientes":
      reason = fetchError
        ? `Error obteniendo velas: ${fetchError}. Backfill solicitado.`
        : `Datos insuficientes: ${candleCount}/${required} velas. Faltan ${missingCandles} velas. Backfill solicitado.`;
      break;
    case "feed_detenido":
      reason = `Feed detenido: última vela hace ${lastCandleAgeMinutes} minutos (límite: ${DEFAULTS.feedStaledThresholdMinutes} min).`;
      break;
    default:
      reason = "Estado desconocido.";
  }

  // Disparar backfill si es necesario (no bloquea)
  if (
    (dataReadinessState === "datos_insuficientes" || dataReadinessState === "datos_parciales") &&
    !backfillInProgress.has(pair)
  ) {
    triggerBackfill(pair, mode).catch(() => {});
  }

  // Alertar feed detenido
  if (dataReadinessState === "feed_detenido") {
    idcaLog("warn", `Feed de datos detenido: última vela hace ${lastCandleAgeMinutes}min`, {
      pair,
      mode,
      source: "IdcaMarketDataHealthService",
      event: "idca_market_data_feed_stalled",
      lastCandleAgeMinutes,
    });
  }

  return {
    pair,
    timeframe: "1h",
    source: "Kraken / MarketDataService",
    candleCount,
    requiredCandles: required,
    sufficientCandles: sufficient,
    minimumCandles: minimum,
    missingCandles,
    lastCandleTimestamp,
    lastCandleAgeMinutes,
    timeframeMinutes: tfMinutes,
    estimatedReadyAt: estimatedAt,
    hasGaps,
    gapCount,
    backfillStatus: currentBackfill,
    dataReadinessState,
    canUseDynamicAnchor,
    canOpenNewIdcaCycle,
    reason,
    checkedAt: new Date(now).toISOString(),
  };
}

export function getBackfillStatus(pair: string): BackfillStatus {
  return backfillState.get(pair) ?? "no_necesario";
}
