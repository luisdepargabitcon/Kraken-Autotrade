/**
 * IdcaSliderConfig — Slider-based configuration for IDCA entry and Telegram alerts.
 *
 * Sliders are the SINGLE SOURCE OF TRUTH for all user-facing configuration.
 * Technical parameters (minDipPct, reboundPct, cooldowns, etc.) are derived from
 * slider values using pair-specific interpolation curves.
 *
 * UI sliders: 0–100 integer range.
 * Pair-specific curves: BTC/USD, ETH/USD, generic fallback.
 *
 * Defaults:
 *   entryPatienceLevel       = 70   (prudente)
 *   reboundConfirmationLevel = 65   (confirmación sólida)
 *   entryQualityLevel        = 65   (filtro de calidad moderado)
 *   entrySizeAggressiveness  = 40   (tamaño conservador)
 *
 *   telegramAlertFrequencyLevel = 85 (pocos avisos)
 *   telegramAlertDetailLevel    = 40 (solo lo importante)
 *   telegramAlertGroupingLevel  = 85 (muy agrupado)
 */

// ─── Interfaces ────────────────────────────────────────────────────

export interface EntryUiConfig {
  entryPatienceLevel:       number;  // 0–100 | caída mínima / paciencia de entrada
  reboundConfirmationLevel: number;  // 0–100 | exigencia del rebote confirmado
  entryQualityLevel:        number;  // 0–100 | filtro de calidad de la oportunidad
  entrySizeAggressiveness:  number;  // 0–100 | tamaño relativo de la primera compra
}

export interface TelegramUiConfig {
  telegramAlertFrequencyLevel: number; // 0–100 | 0=muchos avisos, 100=pocos avisos
  telegramAlertDetailLevel:    number; // 0–100 | 0=solo crítico, 100=muy detallado
  telegramAlertGroupingLevel:  number; // 0–100 | 0=individual, 100=muy agrupado
}

/** Parámetros técnicos de entrada derivados de los sliders. */
export interface DerivedEntryConfig {
  effectiveMinDipPct:             number;  // % caída mínima desde referencia para activar TB
  reboundPct:                     number;  // % rebote requerido desde localLow
  maxExecutionOvershootPct:       number;  // % overshoot máximo sobre buyThreshold en ejecución
  minEntryQualityScore:           number;  // score mínimo de calidad (usado en Commit F)
  minMarketScore:                 number;  // score mínimo de mercado
  confirmationTicks:              number;  // ticks de confirmación requeridos (usado en Commit E)
  requiredReboundHoldSeconds:     number;  // segundos de rebote sostenido (usado en Commit E)
  entrySizeFactor:                number;  // multiplicador del tamaño base (0.50–1.25)
}

/** Política Telegram derivada de los sliders. */
export interface DerivedTelegramConfig {
  profile:                        "balanced" | "verbose" | "silent" | "actions_only";
  trackingEnabled:                boolean;
  watchingMinIntervalMinutes:     number;
  trackingMinIntervalMinutes:     number;
  trackingMinPriceImprovementPct: number;
  digestEnabled:                  boolean;
  digestIntervalMinutes:          number;
  armedEnabled:                   boolean;
  cancelledEnabled:               boolean;
  reboundDetectedEnabled:         boolean;
  executedEnabled:                boolean;
  blockedExecutionEnabled:        boolean;
}

// ─── Defaults profesionales ─────────────────────────────────────────

export const ENTRY_SLIDER_DEFAULTS: EntryUiConfig = {
  entryPatienceLevel:       70,
  reboundConfirmationLevel: 65,
  entryQualityLevel:        65,
  entrySizeAggressiveness:  40,
};

export const TELEGRAM_SLIDER_DEFAULTS: TelegramUiConfig = {
  telegramAlertFrequencyLevel: 85,
  telegramAlertDetailLevel:    40,
  telegramAlertGroupingLevel:  85,
};

// ─── Interpolación lineal por puntos ────────────────────────────────

/**
 * Interpolación lineal por tramos entre puntos clave.
 * @param level  valor del slider (0–100)
 * @param points array de [x, y] ordenado por x ascendente
 */
function lerp(level: number, points: [number, number][]): number {
  if (level <= points[0][0]) return points[0][1];
  if (level >= points[points.length - 1][0]) return points[points.length - 1][1];
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    if (level >= x0 && level <= x1) {
      const t = (level - x0) / (x1 - x0);
      return +(y0 + t * (y1 - y0)).toFixed(4);
    }
  }
  return points[points.length - 1][1];
}

// ─── Curvas de minDipPct por par ─────────────────────────────────────

const MIN_DIP_CURVE_BTC: [number, number][] = [
  [0, 3.00], [50, 3.70], [70, 4.20], [100, 5.20],
];
const MIN_DIP_CURVE_ETH: [number, number][] = [
  [0, 3.30], [50, 4.00], [70, 4.60], [100, 6.00],
];
const MIN_DIP_CURVE_GENERIC: [number, number][] = [
  [0, 3.80], [50, 4.40], [70, 5.00], [100, 6.20],
];

// ─── Curvas de reboundPct por par ────────────────────────────────────

const REBOUND_CURVE_BTC: [number, number][] = [
  [0, 0.25], [50, 0.45], [65, 0.55], [100, 0.90],
];
const REBOUND_CURVE_ETH: [number, number][] = [
  [0, 0.30], [50, 0.55], [65, 0.65], [100, 1.10],
];
const REBOUND_CURVE_GENERIC: [number, number][] = [
  [0, 0.30], [50, 0.50], [65, 0.60], [100, 0.95],
];

// ─── Derivación técnica de entry config ──────────────────────────────

/**
 * Deriva parámetros técnicos de entrada desde sliders.
 * @param sliders  config de sliders (con defaults ya aplicados)
 * @param pair     par de trading ("BTC/USD", "ETH/USD", etc.)
 */
export function deriveEntryConfigFromSliders(
  sliders: EntryUiConfig,
  pair: string,
): DerivedEntryConfig {
  const p  = sliders.entryPatienceLevel;       // 0–100
  const rb = sliders.reboundConfirmationLevel; // 0–100
  const q  = sliders.entryQualityLevel;        // 0–100
  const sz = sliders.entrySizeAggressiveness;  // 0–100

  const isBtc = pair === "BTC/USD";
  const isEth = pair === "ETH/USD";

  // 1. effectiveMinDipPct ─ cuánto debe bajar el precio para activar TB
  const dipCurve = isBtc ? MIN_DIP_CURVE_BTC : isEth ? MIN_DIP_CURVE_ETH : MIN_DIP_CURVE_GENERIC;
  const effectiveMinDipPct = lerp(p, dipCurve);

  // 2. reboundPct ─ % de rebote requerido desde localLow
  const rebCurve = isBtc ? REBOUND_CURVE_BTC : isEth ? REBOUND_CURVE_ETH : REBOUND_CURVE_GENERIC;
  const reboundPct = lerp(rb, rebCurve);

  // 3. maxExecutionOvershootPct ─ inversamente proporcional a paciencia
  //    (más paciencia → límite más estricto: acepta menos sobrepasar el buyThreshold)
  const maxExecutionOvershootPct = +(Math.max(0.10, 0.50 - p * 0.0035)).toFixed(3);

  // 4. minEntryQualityScore ─ puntuación mínima de calidad de entrada
  //    Toma el máximo entre el valor derivado de patience y el del slider de calidad
  const qualityFromPatience = lerp(p, [[0, 50], [50, 57], [70, 62], [100, 75]]);
  const qualityFromSlider   = lerp(q, [[0, 45], [50, 58], [65, 65], [100, 80]]);
  const minEntryQualityScore = +Math.max(qualityFromPatience, qualityFromSlider).toFixed(1);

  // 5. minMarketScore ─ score mínimo de mercado
  const minMarketScore = +lerp(p, [[0, 42], [50, 48], [70, 52], [100, 62]]).toFixed(1);

  // 6. confirmationTicks
  const confirmationTicks = rb <= 40 ? 1 : rb <= 80 ? 2 : 3;

  // 7. requiredReboundHoldSeconds
  let requiredReboundHoldSeconds: number;
  if (rb <= 40) {
    requiredReboundHoldSeconds = Math.round(lerp(rb, [[0, 0], [40, 10]]));
  } else if (rb <= 80) {
    requiredReboundHoldSeconds = Math.round(lerp(rb, [[40, 20], [80, 30]]));
  } else {
    requiredReboundHoldSeconds = Math.round(lerp(rb, [[80, 45], [100, 60]]));
  }

  // 8. entrySizeFactor ─ multiplicador del tamaño base (aplicado en Commit E)
  const entrySizeFactor = +lerp(sz, [[0, 0.50], [40, 0.80], [70, 1.00], [100, 1.25]]).toFixed(3);

  return {
    effectiveMinDipPct,
    reboundPct,
    maxExecutionOvershootPct,
    minEntryQualityScore,
    minMarketScore,
    confirmationTicks,
    requiredReboundHoldSeconds,
    entrySizeFactor,
  };
}

// ─── Derivación de política Telegram desde sliders ───────────────────

/**
 * Deriva la política Telegram anti-spam desde sliders.
 * @param sliders  config de sliders (con defaults ya aplicados)
 */
export function deriveTelegramPolicyFromSliders(
  sliders: TelegramUiConfig,
): DerivedTelegramConfig {
  const freq    = sliders.telegramAlertFrequencyLevel;  // 0=muchos, 100=pocos
  const detail  = sliders.telegramAlertDetailLevel;     // 0=solo crítico, 100=detallado
  const grouping = sliders.telegramAlertGroupingLevel;  // 0=individual, 100=agrupado

  // Intervalo mínimo WATCHING (más freq → menor intervalo)
  // freq=0 → 60min, freq=85 → 240min, freq=100 → 480min
  const watchingMinIntervalMinutes = Math.round(
    lerp(freq, [[0, 60], [85, 240], [100, 480]])
  );

  // Intervalo mínimo TRACKING
  // freq=0 → 30min, freq=85 → 90min, freq=100 → 180min
  const trackingMinIntervalMinutes = Math.round(
    lerp(freq, [[0, 30], [85, 90], [100, 180]])
  );

  // Mejora mínima para notificar TRACKING
  const trackingMinPriceImprovementPct = +lerp(freq, [[0, 0.10], [85, 0.30], [100, 0.50]]).toFixed(2);

  // trackingEnabled ← solo si detalle alto (>= 70)
  const trackingEnabled = detail >= 70;

  // digestEnabled ← si detail >= 20 y grouping >= 20
  const digestEnabled = detail >= 20 && grouping >= 20;

  // digestIntervalMinutes ← controlado por grouping (más grouping = más largo)
  const digestIntervalMinutes = Math.max(30,
    Math.round(lerp(grouping, [[0, 30], [50, 120], [85, 240], [100, 480]]))
  );

  // Perfil ← derivado de combinación freq + detail
  let profile: DerivedTelegramConfig["profile"];
  if (detail <= 15) {
    profile = "silent";
  } else if (detail <= 40 && freq >= 70) {
    profile = "balanced";
  } else if (detail >= 70) {
    profile = "verbose";
  } else {
    profile = "actions_only";
  }

  return {
    profile,
    trackingEnabled,
    watchingMinIntervalMinutes,
    trackingMinIntervalMinutes,
    trackingMinPriceImprovementPct,
    digestEnabled,
    digestIntervalMinutes,
    armedEnabled: true,                // siempre activo salvo perfil silent
    cancelledEnabled: detail >= 20,
    reboundDetectedEnabled: detail >= 10,
    executedEnabled: true,             // siempre activo
    blockedExecutionEnabled: detail >= 15,
  };
}

// ─── Helper principal ────────────────────────────────────────────────

/**
 * Lee la configuración de sliders del global config (con defaults aplicados)
 * y devuelve los parámetros técnicos de entrada para el par dado.
 *
 * Si entryUiJson no existe, aplica los defaults profesionales (entryPatienceLevel=70, etc.)
 */
export function getEffectiveEntryConfig(
  config: { entryUiJson?: unknown } | null | undefined,
  pair: string,
): DerivedEntryConfig {
  const stored = (config?.entryUiJson ?? {}) as Partial<EntryUiConfig>;
  const sliders: EntryUiConfig = { ...ENTRY_SLIDER_DEFAULTS, ...stored };
  return deriveEntryConfigFromSliders(sliders, pair);
}

/**
 * Lee la configuración Telegram de sliders del global config (con defaults aplicados)
 * y devuelve la política anti-spam derivada.
 *
 * Si telegramUiJson no existe, aplica los defaults profesionales.
 */
export function getEffectiveTelegramConfig(
  config: { telegramUiJson?: unknown } | null | undefined,
): DerivedTelegramConfig {
  const stored = (config?.telegramUiJson ?? {}) as Partial<TelegramUiConfig>;
  const sliders: TelegramUiConfig = { ...TELEGRAM_SLIDER_DEFAULTS, ...stored };
  return deriveTelegramPolicyFromSliders(sliders);
}
