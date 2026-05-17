/**
 * IdcaMarketDataHealthService
 *
 * Evalúa si los datos de mercado (velas de Kraken/MarketDataService)
 * son suficientes para que IDCA opere con seguridad.
 *
 * FASE B: Health timeframe-aware con estados ready/lagging/stale/stopped/warmup/degraded.
 * Umbrales ajustados por timeframe para eliminar falsos "feed detenido".
 *
 * NO bloquea el flujo principal: siempre devuelve un resultado.
 */

import { MarketDataService, type Timeframe } from "../MarketDataService";
import { idcaLog } from "./idcaLog";

// ─── Tipos ────────────────────────────────────────────────────────────────────

/**
 * Estados de salud de datos timeframe-aware:
 * - ready: Datos frescos, operativa normal
 * - lagging: Retraso leve pero contexto válido (ej: 126min en 1h)
 * - stale: Datos obsoletos para nuevas entradas, ciclos activos pueden seguir
 * - stopped: Feed realmente detenido, período anómalo
 * - warmup: Aún no hay mínimo de velas
 * - degraded: Usando BD/cache como fallback temporal
 */
export type DataReadinessState =
  | "ready"
  | "lagging"
  | "stale"
  | "stopped"
  | "warmup"
  | "degraded";

export type BackfillStatus =
  | "no_necesario"
  | "solicitado"
  | "completado"
  | "fallido"
  | "en_progreso";

/** Niveles de calidad de datos según profundidad de velas disponibles */
export type DataQualityLevel =
  | "none"           // 0 velas
  | "insufficient"   // 1-6 velas (menos que mínimo)
  | "minimal"        // 7-23 velas (mínimo técnico, contexto limitado)
  | "minimum_context" // 24-99 velas (contexto básico operable)
  | "good_context"   // 100-720 velas (buen contexto técnico)
  | "full_macro_context"; // 721+ velas (contexto macro completo)

export interface MarketDataHealthResult {
  pair: string;
  timeframe: string;
  source: "kraken" | "mds_cache" | "db_fallback" | "unknown";
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
  // FASE C: Metadatos de calidad extendidos
  quality: DataQualityLevel;
  usableForEntry: boolean;   // Puede usarse para entradas nuevas
  usableForContext: boolean;  // Puede usarse para contexto técnico
  usableForMacro: boolean;    // Puede usarse para análisis macro
  isFallback: boolean;       // Indica si viene de fallback
  canUseDynamicAnchor: boolean;
  canOpenNewIdcaCycle: boolean;
  allowsActiveCycleManagement: boolean;
  blocksNewMain: boolean;
  reason: string;
  checkedAt: string;
}

/** Umbrales de health por timeframe (en minutos) */
interface TimeframeThresholds {
  ready: number;      // Hasta este valor: datos frescos
  lagging: number;    // Hasta este valor: retraso leve, contexto válido
  stale: number;      // Hasta este valor: obsoleto para nuevas entradas
  stopped: number;    // Por encima: feed detenido
}

/** Configuración de umbrales por timeframe */
const TIMEFRAME_THRESHOLDS: Record<Timeframe, TimeframeThresholds> = {
  "1m": { ready: 2, lagging: 5, stale: 15, stopped: 30 },
  "5m": { ready: 10, lagging: 15, stale: 30, stopped: 60 },
  "15m": { ready: 30, lagging: 45, stale: 90, stopped: 180 },
  "30m": { ready: 60, lagging: 90, stale: 180, stopped: 360 },
  "1h": { ready: 120, lagging: 180, stale: 360, stopped: 720 },
  "4h": { ready: 480, lagging: 720, stale: 1440, stopped: 2880 },
  "1d": { ready: 2160, lagging: 2880, stale: 5760, stopped: 11520 }, // 36h, 48h, 96h
  "1w": { ready: 10080, lagging: 20160, stale: 40320, stopped: 80640 }, // 1w, 2w, 4w, 8w
  "15d": { ready: 21600, lagging: 43200, stale: 86400, stopped: 172800 }, // 15d, 30d, 60d, 120d
};

// ─── Configuración por defecto ─────────────────────────────────────────────

const DEFAULTS = {
  requiredCandles: 72,
  sufficientCandles: 24,
  minimumCandles: 7,
  timeframe: "1h" as Timeframe,
  timeframeMinutes: 60,
  gapThresholdMinutes: 90,        // hueco entre velas >90min = gap
};

/** Obtiene umbrales para un timeframe, con fallback a 1h */
function getTimeframeThresholds(timeframe: Timeframe): TimeframeThresholds {
  return TIMEFRAME_THRESHOLDS[timeframe] ?? TIMEFRAME_THRESHOLDS["1h"];
}

// ─── In-memory: backfill state por par ────────────────────────────────────

const backfillState = new Map<string, BackfillStatus>();
const backfillInProgress = new Set<string>();
const lastBackfillAttempt = new Map<string, number>();
const BACKFILL_COOLDOWN_MS = 10 * 60 * 1000; // 10 min entre intentos

// ─── Throttle de logs por estado ────────────────────────────────────────────

/** Último log por par+estado para evitar spam */
const lastLogByState = new Map<string, number>();

/** Throttle en ms por tipo de estado */
const LOG_THROTTLE_MS: Record<DataReadinessState, number> = {
  ready: 60 * 60 * 1000,      // 1 hora - no spam de "todo OK"
  lagging: 30 * 60 * 1000,    // 30 min - retraso leve
  stale: 30 * 60 * 1000,      // 30 min - obsoleto
  stopped: 15 * 60 * 1000,   // 15 min - detenido (más crítico)
  warmup: 5 * 60 * 1000,      // 5 min - calentando
  degraded: 15 * 60 * 1000,  // 15 min - fallback
};

/** Estado anterior por par para detectar transiciones */
const previousStateByPair = new Map<string, DataReadinessState>();

/** Verifica si se puede loguear según throttle, permitiendo siempre transiciones */
function canLogState(pair: string, state: DataReadinessState): boolean {
  const key = `${pair}:${state}`;
  const now = Date.now();
  const lastLog = lastLogByState.get(key) ?? 0;
  const throttleMs = LOG_THROTTLE_MS[state];
  
  // Siempre permitir si es transición de estado
  const prevState = previousStateByPair.get(pair);
  if (prevState !== state) {
    return true;
  }
  
  // Throttle para logs repetidos del mismo estado
  if (now - lastLog < throttleMs) {
    return false;
  }
  
  return true;
}

/** Marca que se logueó un estado */
function markStateLogged(pair: string, state: DataReadinessState): void {
  const key = `${pair}:${state}`;
  lastLogByState.set(key, Date.now());
  previousStateByPair.set(pair, state);
}

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

/**
 * Determina el nivel de calidad según cantidad de velas.
 * FASE C: Clasificación profesional por profundidad de datos.
 */
function computeDataQuality(
  candleCount: number,
  minimum: number,
  sufficient: number,
  required: number,
): DataQualityLevel {
  if (candleCount === 0) return "none";
  if (candleCount < minimum) return "insufficient";
  if (candleCount < sufficient) return "minimal";
  if (candleCount < required) return "minimum_context";
  if (candleCount < 100) return "minimum_context";
  if (candleCount < 721) return "good_context";
  return "full_macro_context";
}

/**
 * Computa el estado de salud de datos basado en timeframe-aware thresholds.
 *
 * FASE C: Lógica mejorada que considera:
 * 1. Fuente de datos (fallback BD vs Kraken directo)
 * 2. Cantidad de velas disponibles (quality)
 * 3. Frescura de la última vela
 *
 * Lógica:
 * - Sin velas mínimas -> warmup (independiente de fuente)
 * - Fallback BD con datos frescos y suficientes -> degraded (no oculta origen)
 * - Fallback BD con datos obsoletos -> degraded (pero marca stale/stopped por edad)
 * - Kraken directo: evaluar frescura normalmente
 */
function computeReadinessState(
  candleCount: number,
  lastCandleAgeMinutes: number | null,
  required: number,
  sufficient: number,
  minimum: number,
  thresholds: TimeframeThresholds,
  isFromDbFallback: boolean,
): DataReadinessState {
  // Sin velas mínimas -> warmup (independiente de fuente)
  if (candleCount < minimum) {
    return "warmup";
  }

  // Sin timestamp de última vela -> warmup (no sabemos la edad)
  if (lastCandleAgeMinutes === null) {
    return "warmup";
  }

  // Feed realmente detenido (muy antiguo)
  if (lastCandleAgeMinutes > thresholds.stopped) {
    return "stopped";
  }

  // Datos obsoletos para nuevas entradas
  if (lastCandleAgeMinutes > thresholds.stale) {
    return "stale";
  }

  // Retraso leve pero contexto válido
  if (lastCandleAgeMinutes > thresholds.ready) {
    return "lagging";
  }

  // Datos frescos: verificar fuente
  // Si es fallback BD, marcar como degraded (aunque sean utilizables)
  // Si es Kraken directo, marcar como ready
  if (isFromDbFallback) {
    return "degraded";
  }

  // Todo OK desde fuente primaria
  return "ready";
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

/**
 * Determina el mensaje de reason según el estado de salud.
 */
function getReasonMessage(
  state: DataReadinessState,
  candleCount: number,
  required: number,
  lastCandleAgeMinutes: number | null,
  fetchError: string | null,
  missingCandles: number,
): string {
  switch (state) {
    case "ready":
      return `Datos listos: ${candleCount}/${required} velas. Contexto de mercado actualizado.`;
    case "lagging":
      return `Velas ${DEFAULTS.timeframe} con ligero retraso: última vela hace ${lastCandleAgeMinutes}min. Contexto todavía utilizable.`;
    case "stale":
      return `Datos de velas obsoletos para nuevas entradas: última vela hace ${lastCandleAgeMinutes}min. Ciclos activos siguen con precio spot si disponible.`;
    case "stopped":
      return `Feed de velas detenido: última vela hace ${lastCandleAgeMinutes}min. Nuevas entradas pausadas hasta recuperar datos.`;
    case "warmup":
      return fetchError
        ? `Error obteniendo velas: ${fetchError}. Completando histórico.`
        : `Datos insuficientes: ${candleCount}/${required} velas. Faltan ${missingCandles} velas. Calentando datos...`;
    case "degraded":
      return `Usando cache persistente como fallback. Velas: ${candleCount}. Contexto puede no estar al día.`;
    default:
      return "Estado desconocido.";
  }
}

/**
 * Log estructurado de health con throttle.
 * FASE C: Incluye quality y usabilidad en logs.
 */
function logHealthState(
  pair: string,
  state: DataReadinessState,
  details: {
    candleCount: number;
    required: number;
    lastCandleAgeMinutes: number | null;
    source: string;
    quality: DataQualityLevel;
    usableForEntry: boolean;
    usableForContext: boolean;
    allowsActiveCycleManagement: boolean;
    blocksNewMain: boolean;
  },
): void {
  // Verificar throttle
  if (!canLogState(pair, state)) {
    return;
  }

  const prevState = previousStateByPair.get(pair);
  const isTransition = prevState && prevState !== state;

  // Log de transición o estado
  const logPrefix = isTransition ? "[MARKET_DATA_HEALTH_CHANGE]" : "[MARKET_DATA_HEALTH]";
  const transitionInfo = isTransition ? ` ${prevState} → ${state}` : "";

  const logMessage = `${logPrefix} ${pair} ${DEFAULTS.timeframe}${transitionInfo} | ` +
    `state=${state} | quality=${details.quality} | candles=${details.candleCount}/${details.required} | ` +
    `age=${details.lastCandleAgeMinutes}min | source=${details.source} | ` +
    `usableEntry=${details.usableForEntry} | usableCtx=${details.usableForContext} | ` +
    `allowsActiveMgmt=${details.allowsActiveCycleManagement} | blocksNewMain=${details.blocksNewMain}`;
  
  // Severidad según estado
  const level: "info" | "warn" | "error" = state === "stopped" ? "warn" : 
                                             state === "stale" ? "warn" :
                                             state === "warmup" ? "info" :
                                             "info";
  
  idcaLog(level, logMessage, {
    pair,
    timeframe: DEFAULTS.timeframe,
    state,
    previousState: prevState,
    isTransition,
    candleCount: details.candleCount,
    requiredCandles: details.required,
    lastCandleAgeMinutes: details.lastCandleAgeMinutes,
    source: details.source,
    quality: details.quality,
    usableForEntry: details.usableForEntry,
    usableForContext: details.usableForContext,
    allowsActiveCycleManagement: details.allowsActiveCycleManagement,
    blocksNewMain: details.blocksNewMain,
    event: isTransition ? "market_data_health_transition" : "market_data_health",
  });
  
  markStateLogged(pair, state);
}

export async function checkMarketDataHealth(
  pair: string,
  mode = "simulation",
  options: {
    requiredCandles?: number;
    sufficientCandles?: number;
    minimumCandles?: number;
    timeframe?: Timeframe;
    timeframeMinutes?: number;
    isFromDbFallback?: boolean;
  } = {},
): Promise<MarketDataHealthResult> {
  const required = options.requiredCandles ?? DEFAULTS.requiredCandles;
  const sufficient = options.sufficientCandles ?? DEFAULTS.sufficientCandles;
  const minimum = options.minimumCandles ?? DEFAULTS.minimumCandles;
  const timeframe = options.timeframe ?? DEFAULTS.timeframe;
  const tfMinutes = options.timeframeMinutes ?? DEFAULTS.timeframeMinutes;
  const isFromDbFallback = options.isFromDbFallback ?? false;
  const thresholds = getTimeframeThresholds(timeframe);
  const now = Date.now();

  let candles: Array<{ time: number; high: number; low: number; close: number; volume: number }> = [];
  let fetchError: string | null = null;
  let source: MarketDataHealthResult["source"] = "kraken";

  try {
    candles = await MarketDataService.getCandles(pair, timeframe);
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

  // Calcular estado de salud timeframe-aware
  const dataReadinessState = computeReadinessState(
    candleCount,
    lastCandleAgeMinutes,
    required,
    sufficient,
    minimum,
    thresholds,
    isFromDbFallback,
  );

  // FASE C: Calcular nivel de calidad según profundidad de velas
  const quality = computeDataQuality(candleCount, minimum, sufficient, required);

  // Si hubo error de fetch y no hay velas, marcar como warmup
  if (fetchError && candleCount === 0) {
    source = "unknown";
  } else if (isFromDbFallback) {
    source = "db_fallback";
  } else if (fetchError && candleCount > 0) {
    // Tenemos velas de cache aunque el fetch falló
    source = "mds_cache";
  }

  const missingCandles = Math.max(0, required - candleCount);
  const estimatedAt = estimateReadyAt(candleCount, required, tfMinutes);

  // FASE C: Lógica de capacidades mejorada considerando estado + calidad + frescura
  // ready: todo OK desde fuente primaria
  // lagging: retraso leve pero datos recientes, contexto válido
  // stale: datos obsoletos, solo gestión defensiva
  // stopped: feed detenido, solo gestión defensiva
  // warmup: sin datos suficientes
  // degraded: fallback BD, utilizable si calidad y frescura OK

  const hasFreshData = lastCandleAgeMinutes !== null && lastCandleAgeMinutes <= thresholds.stale;
  const hasMinimumQuality = quality !== "none" && quality !== "insufficient";
  const hasContextQuality = quality === "minimum_context" || quality === "good_context" || quality === "full_macro_context";
  const hasMacroQuality = quality === "full_macro_context";

  // Usable para entrada: requiere estado operable + datos frescos + calidad mínima
  const usableForEntry =
    (dataReadinessState === "ready" || dataReadinessState === "lagging") &&
    hasFreshData &&
    hasContextQuality;

  // Usable para contexto: requiere calidad mínima + no estar stopped/warmup
  const usableForContext =
    hasMinimumQuality &&
    dataReadinessState !== "stopped" &&
    dataReadinessState !== "warmup";

  // Usable para macro: requiere calidad macro completa
  const usableForMacro = hasMacroQuality;

  const allowsActiveCycleManagement =
    dataReadinessState === "ready" ||
    dataReadinessState === "lagging" ||
    dataReadinessState === "degraded";

  const blocksNewMain =
    dataReadinessState === "warmup" ||
    dataReadinessState === "stale" ||
    dataReadinessState === "stopped";

  const canUseDynamicAnchor =
    dataReadinessState === "ready" ||
    dataReadinessState === "lagging" ||
    dataReadinessState === "degraded";

  const canOpenNewIdcaCycle = dataReadinessState === "ready" && usableForEntry;

  const currentBackfill = backfillState.get(pair) ?? "no_necesario";

  const reason = getReasonMessage(
    dataReadinessState,
    candleCount,
    required,
    lastCandleAgeMinutes,
    fetchError,
    missingCandles,
  );

  // Log estructurado con throttle (FASE C: incluir quality)
  logHealthState(pair, dataReadinessState, {
    candleCount,
    required,
    lastCandleAgeMinutes,
    source,
    quality,
    usableForEntry,
    usableForContext,
    allowsActiveCycleManagement,
    blocksNewMain,
  });

  // Disparar backfill si es necesario (no bloquea)
  if (
    (dataReadinessState === "warmup") &&
    !backfillInProgress.has(pair) &&
    candleCount < minimum
  ) {
    triggerBackfill(pair, mode).catch(() => {});
  }

  return {
    pair,
    timeframe,
    source,
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
    // FASE C: Nuevos metadatos de calidad
    quality,
    usableForEntry,
    usableForContext,
    usableForMacro,
    isFallback: isFromDbFallback,
    canUseDynamicAnchor,
    canOpenNewIdcaCycle,
    allowsActiveCycleManagement,
    blocksNewMain,
    reason,
    checkedAt: new Date(now).toISOString(),
  };
}

export function getBackfillStatus(pair: string): BackfillStatus {
  return backfillState.get(pair) ?? "no_necesario";
}
