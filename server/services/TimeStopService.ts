/**
 * TimeStopService — Smart TimeStop with per-asset TTL, regime multipliers, and close policy.
 *
 * TTL_final = clamp(TTL_base[asset,market] * factorRegime, minTTL, maxTTL)
 *
 * Close policy on expiry:
 *  - 'market': immediate market order
 *  - 'limit': place limit order, fallback to market after limitFallbackSeconds
 *
 * Respects the per-position timeStopDisabled toggle (UI button).
 */

import { storage } from "../storage";
import { log } from "../utils/logger";
import { botLogger } from "./botLogger";
import type { TimeStopConfigRow } from "@shared/schema";

// ─── Types ───────────────────────────────────────────────────────────────────

export type MarketRegime = "TREND" | "RANGE" | "TRANSITION";

export interface SmartTTLResult {
  ttlHours: number;
  ttlBaseHours: number;
  regimeFactor: number;
  regime: MarketRegime;
  minTtl: number;
  maxTtl: number;
  clamped: boolean;
  closeOrderType: "market" | "limit";
  limitFallbackSeconds: number;
  telegramAlertEnabled: boolean;
  logExpiryEvenIfDisabled: boolean;
  softMode: boolean;         // FASE 4 — if true, only close if net P&L > roundTripFeePct
  configSource: string;      // 'BTC/USD:spot' or '*:spot'
}

export interface TimeStopCheckResult {
  expired: boolean;
  shouldClose: boolean;
  ageHours: number;
  ttlHours: number;
  closeOrderType: "market" | "limit";
  limitFallbackSeconds: number;
  reason: string;
  telegramAlertEnabled: boolean;
  logExpiryEvenIfDisabled: boolean;
  softMode: boolean;                // FASE 4 — effective softMode for the resolved config row
  softModeBlocked: boolean;         // FASE 4 — true iff expiry occurred but close was suppressed by softMode
  configSource: string;
  // FASE 4.1 — true when TimeStop is explicitly opted-out for this pair
  // (specific row exists with isActive=false) OR globally disabled (no rows / wildcard inactive).
  // Callers should treat it like timeStopDisabled but originated from config, not per-lot toggle.
  explicitlyDisabled?: boolean;
}

// FASE 4.1 — Internal resolution status of the TimeStop config for a pair.
// Encapsulates 3 distinct cases so callers can react correctly:
//   - 'active'             : a usable config row was found (specific or wildcard).
//   - 'explicitly_disabled': a specific row exists for this pair but isActive=false.
//                            Semantically: "user explicitly turned TimeStop OFF for this pair."
//                            → Do NOT fall through to wildcard/legacy.
//   - 'no_config'          : neither specific row nor active wildcard exists.
//                            → TimeStop is globally off. No legacy fallback in FASE 4.1.
type ConfigResolution =
  | { status: "active"; config: TimeStopConfigRow }
  | { status: "explicitly_disabled"; pair: string; market: string }
  | { status: "no_config" };

// ─── Dedup helpers (FASE 4.1) ────────────────────────────────────────────────
// Avoid flooding logs when TimeStop is disabled for a pair; we only want to
// surface the state once every DEDUP_WINDOW_MS per (pair, market, reason) key.
const DEDUP_WINDOW_MS = 30 * 60 * 1000; // 30 min
const lastDisabledLogMs = new Map<string, number>();
function logTimeStopDisabledOnce(pair: string, market: string, reason: "explicitly_disabled" | "no_config") {
  const key = `${pair}:${market}:${reason}`;
  const now = Date.now();
  const last = lastDisabledLogMs.get(key) ?? 0;
  if (now - last < DEDUP_WINDOW_MS) return;
  lastDisabledLogMs.set(key, now);
  const msg = reason === "explicitly_disabled"
    ? `[TIME_STOP_DISABLED] pair=${pair} market=${market} — fila específica con Activo=OFF (opt-out explícito)`
    : `[TIME_STOP_DISABLED] pair=${pair} market=${market} — ni fila específica ni wildcard activo, TimeStop inactivo`;
  log(msg, "trading");
}

// ─── In-memory cache ─────────────────────────────────────────────────────────

let configCache: TimeStopConfigRow[] = [];
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // Refresh every 5 minutes

async function ensureConfigCache(): Promise<TimeStopConfigRow[]> {
  const now = Date.now();
  if (configCache.length > 0 && now - cacheLoadedAt < CACHE_TTL_MS) {
    return configCache;
  }
  try {
    configCache = await storage.getTimeStopConfigs();
    cacheLoadedAt = now;
    log(`[TIME_STOP_SVC] Config cache refreshed: ${configCache.length} rows`, "trading");
  } catch (e: any) {
    log(`[TIME_STOP_SVC] Config cache refresh failed: ${e?.message}`, "trading");
    // Keep stale cache if available
    if (configCache.length === 0) {
      // FASE 4.1 — no rows at all. Callers will resolve to 'no_config' and
      // skip TimeStop entirely (the old legacy fallback to bot_config.timeStopHours
      // has been removed). A warning is logged per (pair, market) via
      // logTimeStopDisabledOnce to make the state visible.
      return [];
    }
  }
  return configCache;
}

// ─── Config resolution ───────────────────────────────────────────────────────

// FASE 4.1 — Resolution with explicit status so callers distinguish
// "no config for this pair" (cae al wildcard) vs "user turned off for this pair"
// (opt-out explícito, NO cae al wildcard).
function resolveConfigStatus(
  configs: TimeStopConfigRow[],
  pair: string,
  market: string = "spot"
): ConfigResolution {
  // Exact match (pair + market), cualquiera que sea el valor de isActive.
  const exact = configs.find((c) => c.pair === pair && c.market === market);
  if (exact) {
    if (exact.isActive) {
      return { status: "active", config: exact };
    }
    // Fila específica inactiva = opt-out explícito; NO fallback.
    return { status: "explicitly_disabled", pair, market };
  }

  // Sin fila específica → fallback al wildcard si está activo.
  const wildcard = configs.find(
    (c) => c.pair === "*" && c.market === market && c.isActive
  );
  if (wildcard) {
    return { status: "active", config: wildcard };
  }
  return { status: "no_config" };
}

// Kept for backward compatibility with any caller still expecting the old signature.
// Returns the effective config row if usable, or undefined if the pair should be skipped.
// NOTE: this collapses the 3 statuses to 2, so internal callers should prefer
// resolveConfigStatus() when they need to distinguish "disabled" from "no_config".
function resolveConfig(
  configs: TimeStopConfigRow[],
  pair: string,
  market: string = "spot"
): TimeStopConfigRow | undefined {
  const res = resolveConfigStatus(configs, pair, market);
  return res.status === "active" ? res.config : undefined;
}

function getRegimeFactor(config: TimeStopConfigRow, regime: MarketRegime): number {
  switch (regime) {
    case "TREND":
      return parseFloat(String(config.factorTrend ?? "1.2"));
    case "RANGE":
      return parseFloat(String(config.factorRange ?? "0.8"));
    case "TRANSITION":
      return parseFloat(String(config.factorTransition ?? "1.0"));
    default:
      return 1.0;
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Calculate the smart TTL for a given pair/market/regime.
 * TTL_final = clamp(TTL_base * factorRegime, minTTL, maxTTL)
 */
export async function calculateSmartTTL(
  pair: string,
  regime: MarketRegime,
  market: string = "spot"
): Promise<SmartTTLResult | null> {
  const configs = await ensureConfigCache();
  const config = resolveConfig(configs, pair, market);

  if (!config) return null;

  const ttlBase = parseFloat(String(config.ttlBaseHours ?? "36"));
  const factor = getRegimeFactor(config, regime);
  const minTtl = parseFloat(String(config.minTtlHours ?? "4"));
  const maxTtl = parseFloat(String(config.maxTtlHours ?? "168"));

  const rawTtl = ttlBase * factor;
  const ttlHours = Math.max(minTtl, Math.min(maxTtl, rawTtl));
  const clamped = ttlHours !== rawTtl;

  return {
    ttlHours,
    ttlBaseHours: ttlBase,
    regimeFactor: factor,
    regime,
    minTtl,
    maxTtl,
    clamped,
    closeOrderType: (config.closeOrderType as "market" | "limit") ?? "market",
    limitFallbackSeconds: config.limitFallbackSeconds ?? 30,
    telegramAlertEnabled: config.telegramAlertEnabled ?? true,
    logExpiryEvenIfDisabled: config.logExpiryEvenIfDisabled ?? true,
    softMode: (config as any).softMode ?? false,
    configSource: `${config.pair}:${config.market}`,
  };
}

/**
 * Check whether a position has expired its smart TTL.
 * Does NOT execute the sell — caller is responsible for that.
 *
 * @param pair          e.g. 'BTC/USD'
 * @param openedAt      epoch ms when position was opened
 * @param regime        current market regime
 * @param timeStopDisabled  per-position toggle from UI
 * @param market        'spot' (default)
 */
export async function checkSmartTimeStop(
  pair: string,
  openedAt: number,
  regime: MarketRegime,
  timeStopDisabled: boolean,
  market: string = "spot",
  // FASE 4 — optional P&L context for softMode evaluation.
  // If provided and the resolved row has softMode=true, we only close when
  // netPnlPct > 0 (priceChangePct − roundTripFeePct).
  priceChangePct?: number,
  roundTripFeePct?: number,
): Promise<TimeStopCheckResult> {
  const now = Date.now();
  const ageMs = now - openedAt;
  const ageHours = ageMs / (1000 * 60 * 60);

  // FASE 4.1 — Use explicit 3-state resolution (active / explicitly_disabled / no_config).
  // The legacy fallback to bot_config.timeStopHours has been removed. If the module has no
  // active config rows (no wildcard + no specific), TimeStop is simply not applied.
  const configs = await ensureConfigCache();
  const resolution = resolveConfigStatus(configs, pair, market);

  if (resolution.status === "explicitly_disabled") {
    // Specific row with isActive=false → user explicit opt-out for this pair.
    // Never close by TimeStop. No fallback, no legacy.
    logTimeStopDisabledOnce(pair, market, "explicitly_disabled");
    return {
      expired: false,
      shouldClose: false,
      ageHours,
      ttlHours: 0,
      closeOrderType: "market",
      limitFallbackSeconds: 30,
      reason: `TimeStop explícitamente desactivado para ${pair} (fila específica con Activo=OFF)`,
      telegramAlertEnabled: false,
      logExpiryEvenIfDisabled: false,
      softMode: false,
      softModeBlocked: false,
      configSource: `${pair}:${market} (disabled)`,
      explicitlyDisabled: true,
    };
  }

  if (resolution.status === "no_config") {
    // No wildcard + no specific row → TimeStop is globally off.
    // This is a degenerate state; warn once per pair so it shows in logs but doesn't spam.
    logTimeStopDisabledOnce(pair, market, "no_config");
    return {
      expired: false,
      shouldClose: false,
      ageHours,
      ttlHours: 0,
      closeOrderType: "market",
      limitFallbackSeconds: 30,
      reason: `Sin configuración TimeStop activa (ni fila específica ni wildcard '*'). TimeStop desactivado para ${pair}.`,
      telegramAlertEnabled: false,
      logExpiryEvenIfDisabled: false,
      softMode: false,
      softModeBlocked: false,
      configSource: "no_config",
      explicitlyDisabled: true,
    };
  }

  // resolution.status === "active" → proceed with the standard flow.
  const smartTTL = await calculateSmartTTL(pair, regime, market);
  if (!smartTTL) {
    // Defensive: resolveConfigStatus said "active" but calculateSmartTTL returned null.
    // Shouldn't happen (both paths share the same cache), but fail closed (no close).
    log(`[TIME_STOP_SVC] Unexpected: active resolution but null smartTTL for ${pair}:${market}`, "trading");
    return {
      expired: false,
      shouldClose: false,
      ageHours,
      ttlHours: 0,
      closeOrderType: "market",
      limitFallbackSeconds: 30,
      reason: "Config inconsistente; TimeStop en modo seguro (no cierra)",
      telegramAlertEnabled: false,
      logExpiryEvenIfDisabled: false,
      softMode: false,
      softModeBlocked: false,
      configSource: "error:inconsistent",
      explicitlyDisabled: true,
    };
  }

  const { ttlHours, closeOrderType, limitFallbackSeconds, telegramAlertEnabled, logExpiryEvenIfDisabled, softMode, configSource } = smartTTL;
  const expired = ageHours >= ttlHours;

  if (!expired) {
    return {
      expired: false,
      shouldClose: false,
      ageHours,
      ttlHours,
      closeOrderType,
      limitFallbackSeconds,
      reason: "",
      telegramAlertEnabled,
      logExpiryEvenIfDisabled,
      softMode,
      softModeBlocked: false,
      configSource,
    };
  }

  // Expired — but should we close?
  if (timeStopDisabled) {
    // Log event even if disabled (if configured)
    if (logExpiryEvenIfDisabled) {
      log(`[TIME_STOP_EXPIRED] pair=${pair} ageHours=${ageHours.toFixed(1)} ttl=${ttlHours.toFixed(1)}h regime=${regime} DISABLED_BY_TOGGLE — NO CLOSE`, "trading");
    }
    return {
      expired: true,
      shouldClose: false,
      ageHours,
      ttlHours,
      closeOrderType,
      limitFallbackSeconds,
      reason: `[TIME_STOP_EXPIRED] pair=${pair} ttl=${ttlHours.toFixed(1)}h regime=${regime} DISABLED_BY_TOGGLE`,
      telegramAlertEnabled,
      logExpiryEvenIfDisabled,
      softMode,
      softModeBlocked: false,
      configSource,
    };
  }

  // FASE 4 — softMode gate: if expired + enabled but softMode active and net P&L <= 0,
  // suppress close. Caller is responsible for providing priceChangePct and roundTripFeePct
  // (feeRoundTripPct ≈ 2 × takerFeePct). If the caller doesn't provide them, softMode is
  // a no-op to preserve backward compatibility.
  if (softMode && typeof priceChangePct === "number") {
    const fee = typeof roundTripFeePct === "number" ? roundTripFeePct : 0;
    const netPnlPct = priceChangePct - fee;
    if (netPnlPct <= 0) {
      log(`[TIME_STOP_SOFT_BLOCK] pair=${pair} ageHours=${ageHours.toFixed(1)} ttl=${ttlHours.toFixed(1)}h regime=${regime} netPnl=${netPnlPct.toFixed(2)}% (price=${priceChangePct.toFixed(2)}% fee=${fee.toFixed(2)}%) — cierre suprimido por softMode`, "trading");
      return {
        expired: true,
        shouldClose: false,
        ageHours,
        ttlHours,
        closeOrderType,
        limitFallbackSeconds,
        reason: `TimeStop expirado pero softMode bloquea cierre (P&L neto ${netPnlPct.toFixed(2)}% <= 0, price=${priceChangePct.toFixed(2)}%, fee=${fee.toFixed(2)}%) [${regime}] config=${configSource}`,
        telegramAlertEnabled,
        logExpiryEvenIfDisabled,
        softMode,
        softModeBlocked: true,
        configSource,
      };
    }
  }

  // Expired AND enabled AND (softMode off OR net gain) → should close
  log(`[TIME_STOP_EXPIRED] pair=${pair} ageHours=${ageHours.toFixed(1)} ttl=${ttlHours.toFixed(1)}h (base=${smartTTL.ttlBaseHours}h * ${smartTTL.regimeFactor} [${regime}]) closeType=${closeOrderType} softMode=${softMode} config=${configSource}`, "trading");

  return {
    expired: true,
    shouldClose: true,
    ageHours,
    ttlHours,
    closeOrderType,
    limitFallbackSeconds,
    reason: `TimeStop expirado (${ageHours.toFixed(0)}h >= ${ttlHours.toFixed(1)}h) [${regime}, base=${smartTTL.ttlBaseHours}h*${smartTTL.regimeFactor}] config=${configSource}`,
    telegramAlertEnabled,
    logExpiryEvenIfDisabled,
    softMode,
    softModeBlocked: false,
    configSource,
  };
}

/**
 * Force invalidate the in-memory config cache (e.g. after admin update).
 */
export function invalidateTimeStopConfigCache(): void {
  configCache = [];
  cacheLoadedAt = 0;
  log("[TIME_STOP_SVC] Config cache invalidated", "trading");
}
