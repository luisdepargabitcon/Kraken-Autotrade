/**
 * IdcaTelegramAlertPolicy — Política centralizada de alertas Telegram para Trailing Buy IDCA.
 *
 * Lee el bloque "trailingBuy" de telegramAlertTogglesJson y aplica valores por defecto seguros.
 * Si existe telegramUiJson (sliders), usa getEffectiveTelegramConfig para override cooldowns dinámicos.
 *
 * Regla crítica: trackingEnabled = false por defecto.
 * El tracking técnico siempre se escribe en Logs IDCA, pero Telegram solo recibe eventos
 * accionables (armado, rebote, cancelado, ejecutado) a menos que el usuario active tracking.
 *
 * Perfiles:
 *   silent       — solo compras ejecutadas y errores graves
 *   actions_only — solo acciones directas (rebote, compra, bloqueo crítico)
 *   balanced     — eventos importantes sin tracking individual (recomendado por defecto)
 *   verbose      — permite tracking individual con límites duros
 */
import { getEffectiveTelegramConfig } from "./IdcaSliderConfig";

export interface TrailingBuyTelegramConfig {
  profile: "silent" | "actions_only" | "balanced" | "verbose";
  armedEnabled: boolean;
  watchingEnabled: boolean;
  trackingEnabled: boolean;
  cancelledEnabled: boolean;
  reboundDetectedEnabled: boolean;
  executedEnabled: boolean;
  blockedExecutionEnabled: boolean;
  digestEnabled: boolean;
  digestIntervalMinutes: number;
  trackingMinMinutes: number;
  trackingMinPriceImprovementPct: number;
  dedupeTtlMinutes: number;
}

export const TB_ALERT_DEFAULTS: TrailingBuyTelegramConfig = {
  profile: "balanced",
  armedEnabled: true,
  watchingEnabled: true,
  trackingEnabled: false,           // DESACTIVADO por defecto — evita spam Telegram
  cancelledEnabled: true,
  reboundDetectedEnabled: true,
  executedEnabled: true,
  blockedExecutionEnabled: true,
  digestEnabled: true,
  digestIntervalMinutes: 240,       // resumen cada 4h
  trackingMinMinutes: 60,           // cooldown mínimo entre tracking (si activo)
  trackingMinPriceImprovementPct: 0.30, // mejora mínima de precio para notificar tracking
  dedupeTtlMinutes: 30,
};

/**
 * Extrae y normaliza el bloque trailingBuy del telegramAlertTogglesJson.
 * Si no existe, devuelve los defaults seguros.
 * Clamp de valores mínimos para evitar configuraciones abusivas.
 */
export function getTrailingBuyTelegramConfig(togglesJson: unknown): TrailingBuyTelegramConfig {
  const raw =
    typeof togglesJson === "object" && togglesJson !== null
      ? ((togglesJson as Record<string, unknown>).trailingBuy as Partial<TrailingBuyTelegramConfig> | undefined) ?? {}
      : {};

  return {
    ...TB_ALERT_DEFAULTS,
    ...raw,
    digestIntervalMinutes: Math.max(
      typeof raw.digestIntervalMinutes === "number" ? raw.digestIntervalMinutes : TB_ALERT_DEFAULTS.digestIntervalMinutes,
      30,
    ),
    trackingMinMinutes: Math.max(
      typeof raw.trackingMinMinutes === "number" ? raw.trackingMinMinutes : TB_ALERT_DEFAULTS.trackingMinMinutes,
      15,
    ),
    trackingMinPriceImprovementPct: Math.max(
      typeof raw.trackingMinPriceImprovementPct === "number"
        ? raw.trackingMinPriceImprovementPct
        : TB_ALERT_DEFAULTS.trackingMinPriceImprovementPct,
      0.10,
    ),
    dedupeTtlMinutes: Math.max(
      typeof raw.dedupeTtlMinutes === "number" ? raw.dedupeTtlMinutes : TB_ALERT_DEFAULTS.dedupeTtlMinutes,
      5,
    ),
  };
}

/** Aplica las restricciones del perfil sobre la config base. */
function applyProfileOverrides(config: TrailingBuyTelegramConfig): TrailingBuyTelegramConfig {
  switch (config.profile) {
    case "silent":
      return {
        ...config,
        armedEnabled: false,
        watchingEnabled: false,
        trackingEnabled: false,
        cancelledEnabled: false,
        reboundDetectedEnabled: false,
        blockedExecutionEnabled: false,
        digestEnabled: false,
      };
    case "actions_only":
      return {
        ...config,
        watchingEnabled: false,
        trackingEnabled: false,
        digestEnabled: false,
      };
    case "balanced":
      // En "equilibrado", tracking individual siempre desactivado, digest activado
      return { ...config, trackingEnabled: false };
    case "verbose":
      // En "detallado", se respetan todos los ajustes del usuario
      return config;
    default:
      return config;
  }
}

/**
 * Resuelve la política definitiva combinando config base + restricciones de perfil.
 * Llamar una vez por función de notificación.
 */
export function resolveTrailingBuyPolicy(togglesJson: unknown): TrailingBuyTelegramConfig {
  const config = getTrailingBuyTelegramConfig(togglesJson);
  return applyProfileOverrides(config);
}

/**
 * Resuelve la política con override desde telegramUiJson (sliders).
 * Si telegramUiJson existe, usa getEffectiveTelegramConfig para derivar cooldowns dinámicos.
 * Los toggles individuales (armedEnabled, watchingEnabled, etc.) siguen desde telegramAlertTogglesJson.
 */
export function resolveTrailingBuyPolicyWithSliders(
  togglesJson: unknown,
  telegramUiJson: unknown,
): TrailingBuyTelegramConfig {
  const baseConfig = getTrailingBuyTelegramConfig(togglesJson);
  const sliderOverride = getEffectiveTelegramConfig({ telegramUiJson });

  // Override solo los cooldowns y trackingEnabled desde sliders
  const merged: TrailingBuyTelegramConfig = {
    ...baseConfig,
    trackingEnabled: sliderOverride.trackingEnabled,
    trackingMinMinutes: sliderOverride.trackingMinIntervalMinutes,
    digestIntervalMinutes: sliderOverride.digestIntervalMinutes,
    trackingMinPriceImprovementPct: sliderOverride.trackingMinPriceImprovementPct,
    // watchingCooldownMinutes se pasa por separado a IdcaTrailingBuyTelegramState
  };

  return applyProfileOverrides(merged);
}

/**
 * Decide si se puede enviar la notificación de tracking por Telegram.
 * Devuelve { should, reason } para facilitar logging de diagnóstico.
 */
export function shouldSendTrackingTelegram(
  policy: TrailingBuyTelegramConfig,
  timeSinceLastNotifyMs: number,
  priceImprovementPct: number,
): { should: boolean; reason: string } {
  if (!policy.trackingEnabled) {
    return { should: false, reason: "tracking_disabled_by_policy" };
  }
  const minMs = policy.trackingMinMinutes * 60 * 1000;
  if (timeSinceLastNotifyMs >= minMs) {
    return { should: true, reason: "interval" };
  }
  if (priceImprovementPct >= policy.trackingMinPriceImprovementPct) {
    return { should: true, reason: "improvement" };
  }
  return { should: false, reason: "throttle" };
}

/** Decide si es momento de enviar el digest de Trailing Buy. */
export function shouldSendDigest(lastDigestAt: number, policy: TrailingBuyTelegramConfig): boolean {
  if (!policy.digestEnabled) return false;
  const minMs = policy.digestIntervalMinutes * 60 * 1000;
  return Date.now() - lastDigestAt >= minMs;
}

/** Tipo de entrada para el digest */
export interface TrailingBuyDigestEntry {
  pair: string;
  stateLabel: string;
  referencePrice?: number;
  localLow?: number;
  reboundTriggerPrice?: number;
  maxExecutionPrice?: number;
}

/** Construye el mensaje de resumen digest (castellano natural, sin códigos técnicos). */
export function buildDigestMessage(entries: TrailingBuyDigestEntry[], mode: string): string {
  const modeLabel = mode === "simulation" ? "simulación" : "real";
  const lines: string[] = [
    `<b>Resumen Trailing Buy IDCA</b> — ${modeLabel}`,
    ``,
  ];

  for (const e of entries) {
    lines.push(`<b>${e.pair}</b>`);
    lines.push(`Estado: ${e.stateLabel}`);
    if (e.referencePrice) lines.push(`Referencia entrada: <code>$${e.referencePrice.toFixed(2)}</code>`);
    if (e.localLow)       lines.push(`Mínimo observado: <code>$${e.localLow.toFixed(2)}</code>`);
    if (e.reboundTriggerPrice) lines.push(`Rebote técnico: <code>$${e.reboundTriggerPrice.toFixed(2)}</code>`);
    if (e.maxExecutionPrice)   lines.push(`Límite máximo: <code>$${e.maxExecutionPrice.toFixed(2)}</code>`);
    lines.push(``);
  }

  lines.push(`Sin compras ejecutadas en este período.`);
  lines.push(``, `<i>Modo: ${modeLabel}</i>`);
  return lines.join("\n");
}
