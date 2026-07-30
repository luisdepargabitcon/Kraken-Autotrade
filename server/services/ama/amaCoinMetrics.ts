/**
 * AMA Coin Metrics — Fase 2D
 *
 * GitHub Archive: CC-BY-NC-4.0, research-only, decisionImpactAllowed = false
 * Community API: review required, ingestion disabled by default
 * Pro API: DISABLED, NOT_CONFIGURED
 *
 * Safety: No scraping HTML. No overwrite snapshots. No mix revisions.
 * Coin Metrics cannot be used as OHLC, ATR, HWM, trigger, or sole on-chain source.
 */

import type { CoinMetricsSourceSnapshot, FreshnessStatus, LicenseStatus } from "./amaSeedTypes";

export type CoinMetricsTier = "COINMETRICS_GITHUB_ARCHIVE" | "COINMETRICS_COMMUNITY_API" | "COINMETRICS_PRO_API";

export const COIN_METRICS_TIERS: Record<CoinMetricsTier, {
  enabled: boolean;
  licenseStatus: LicenseStatus;
  decisionImpactAllowed: boolean;
}> = {
  COINMETRICS_GITHUB_ARCHIVE: {
    enabled: true,
    licenseStatus: "REVIEW_REQUIRED",
    decisionImpactAllowed: false,
  },
  COINMETRICS_COMMUNITY_API: {
    enabled: false, // disabled by default
    licenseStatus: "REVIEW_REQUIRED",
    decisionImpactAllowed: false,
  },
  COINMETRICS_PRO_API: {
    enabled: false,
    licenseStatus: "BLOCKED",
    decisionImpactAllowed: false,
  },
};

export function isCoinMetricsProEnabled(): boolean {
  return COIN_METRICS_TIERS.COINMETRICS_PRO_API.enabled;
}

export function canCoinMetricsImpactDecisions(tier: CoinMetricsTier): boolean {
  return COIN_METRICS_TIERS[tier].decisionImpactAllowed;
}

export function computeSnapshotHash(data: string): string {
  // Simple hash for testing — in production use crypto.createHash('sha256')
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `cm_hash_${Math.abs(hash)}`;
}

export function createSnapshot(
  metricId: string,
  assetId: string,
  timestamp: string,
  value: number,
  revisionHash: string,
  sourceRevision: string,
  lastRowTime: string,
  lastCompleteRowTime: string,
  freshnessStatus: FreshnessStatus,
): CoinMetricsSourceSnapshot {
  return {
    metricId,
    assetId,
    timestamp,
    value,
    revisionHash,
    sourceRevision,
    lastRowTime,
    lastCompleteRowTime,
    freshnessStatus,
    licenseStatus: "REVIEW_REQUIRED",
    commercialUseStatus: "REVIEW_REQUIRED",
    decisionImpactAllowed: false,
  };
}

export function isFreshnessAcceptable(status: FreshnessStatus): boolean {
  return status === "FRESH" || status === "DELAYED";
}

export function isFreshnessBlocked(status: FreshnessStatus): boolean {
  return (
    status === "UNAVAILABLE" ||
    status === "SCHEMA_DRIFT" ||
    status === "LICENSE_BLOCKED"
  );
}

export function canOverwriteSnapshot(
  existing: CoinMetricsSourceSnapshot,
  incoming: CoinMetricsSourceSnapshot,
): boolean {
  // No overwrite: only append new revisions
  return existing.revisionHash !== incoming.revisionHash;
}

export function isScrapingHtmlAllowed(): boolean {
  return false;
}
