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
  configSource: string; // 'BTC/USD:spot' or '*:spot'
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
  configSource: string;
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
      // Return empty — callers will use legacy fallback
      return [];
    }
  }
  return configCache;
}

// ─── Config resolution ───────────────────────────────────────────────────────

function resolveConfig(
  configs: TimeStopConfigRow[],
  pair: string,
  market: string = "spot"
): TimeStopConfigRow | undefined {
  // Exact match (pair + market)
  const exact = configs.find(
    (c) => c.pair === pair && c.market === market && c.isActive
  );
  if (exact) return exact;

  // Wildcard fallback
  const wildcard = configs.find(
    (c) => c.pair === "*" && c.market === market && c.isActive
  );
  return wildcard;
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
  market: string = "spot"
): Promise<TimeStopCheckResult> {
  const now = Date.now();
  const ageMs = now - openedAt;
  const ageHours = ageMs / (1000 * 60 * 60);

  const smartTTL = await calculateSmartTTL(pair, regime, market);

  // If no config found, use legacy fallback from bot_config
  if (!smartTTL) {
    const config = await storage.getBotConfig();
    const legacyTTL = config?.timeStopHours ?? 36;
    return {
      expired: ageHours >= legacyTTL,
      shouldClose: !timeStopDisabled && ageHours >= legacyTTL,
      ageHours,
      ttlHours: legacyTTL,
      closeOrderType: "market",
      limitFallbackSeconds: 30,
      reason: ageHours >= legacyTTL
        ? `[TIME_STOP] TTL expirado (${ageHours.toFixed(1)}h >= ${legacyTTL}h) [legacy fallback]`
        : "",
      telegramAlertEnabled: true,
      logExpiryEvenIfDisabled: true,
      configSource: "legacy:bot_config",
    };
  }

  const { ttlHours, closeOrderType, limitFallbackSeconds, telegramAlertEnabled, logExpiryEvenIfDisabled, configSource } = smartTTL;
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
      configSource,
    };
  }

  // Expired AND enabled → should close
  log(`[TIME_STOP_EXPIRED] pair=${pair} ageHours=${ageHours.toFixed(1)} ttl=${ttlHours.toFixed(1)}h (base=${smartTTL.ttlBaseHours}h * ${smartTTL.regimeFactor} [${regime}]) closeType=${closeOrderType} config=${configSource}`, "trading");

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
