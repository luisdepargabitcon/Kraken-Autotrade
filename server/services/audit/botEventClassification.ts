/**
 * botEventClassification.ts
 * Classification of bot_events types for intelligent retention.
 * NEVER deletes permanent/critical events, trades, orders, fiscal data, or config changes.
 *
 * Table schema: bot_events(id, timestamp, level, type, message, meta)
 * - level: INFO | WARN | ERROR
 * - type: EventType string (see botLogger.ts)
 */

export type EventRetentionTier = "permanent" | "12mo" | "90d" | "30d";

// ─── PERMANENT — NEVER DELETE ─────────────────────────────────────────────────
// Trades, orders, positions, closes, config changes, critical errors, mode changes.
const PERMANENT_TYPES = new Set<string>([
  // Trades & orders
  "TRADE_EXECUTED", "TRADE_BLOCKED", "TRADE_FAILED", "TRADE_ADJUSTED",
  "TRADE_REJECTED_LOW_PROFIT", "TRADE_SKIPPED", "TRADE_PERSIST_FAIL",
  "ORDER_FILLED", "ORDER_FILLED_VIA_SYNC", "ORDER_FILLED_LATE",
  "ORDER_FAILED", "ORDER_ATTEMPT", "ORDER_PENDING_FILL",
  "DRY_RUN_TRADE", "DRY_RUN_DOUBLE_SELL_PREVENTED", "DRY_RUN_SELL_MATCH",
  // Positions
  "POSITION_OPENED", "POSITION_CLOSED", "POSITION_CLOSED_SG",
  "POSITION_CREATED_VIA_SYNC", "POSITION_CREATED_RECONCILE",
  "POSITION_UPDATED_RECONCILE", "POSITION_DELETED_RECONCILE",
  "POSITION_ADOPTED", "LEGACY_POSITION_PURGED",
  "ORPHAN_POSITION_CLEANED", "ORPHAN_POSITION_DELETED",
  // Exits & stops
  "STOP_LOSS_HIT", "TAKE_PROFIT_HIT", "TRAILING_STOP_HIT",
  "SG_EMERGENCY_STOPLOSS", "SG_STOP_HIT", "SG_EXIT_TRIGGERED",
  "SG_SCALE_OUT", "SG_SCALE_OUT_EXECUTED",
  "EXIT_TRIGGERED", "EXIT_ORDER_PLACED", "EXIT_ORDER_FAILED",
  "SAFE_SELL_SUCCESS", "SAFE_SELL_FAILED",
  // Manual operations
  "MANUAL_CLOSE_INITIATED", "MANUAL_CLOSE_SUCCESS",
  "MANUAL_CLOSE_FAILED", "MANUAL_CLOSE_EXCEPTION", "MANUAL_CLOSE_DUST",
  // FIFO & fiscal
  "FIFO_LOTS_CLOSED",
  // Config changes (permanent audit trail)
  "CONFIG_CREATED", "CONFIG_UPDATED", "CONFIG_ACTIVATED",
  "CONFIG_ROLLBACK", "CONFIG_IMPORTED", "CONFIG_LOADED",
  "PRESET_CREATED", "PRESET_ACTIVATED", "CONFIG_OVERRIDE_UPDATED",
  "SIGNAL_CONFIG_UPDATED", "FEATURE_FLAGS_UPDATED",
  // Bot lifecycle
  "BOT_STARTED", "BOT_STOPPED", "BOT_PAUSED", "BOT_RESUMED",
  // Critical system
  "SYSTEM_ERROR", "SYSTEM_ALERT",
  "CIRCUIT_BREAKER_BLOCKED", "EXIT_LOCK_BLOCKED",
  "KRAKEN_ERROR", "TELEGRAM_ERROR", "NONCE_ERROR",
]);

// ─── 12 MONTHS — important diagnostics, signals, regime changes ───────────────
const TWELVE_MONTH_TYPES = new Set<string>([
  "SIGNAL_GENERATED",
  "SMART_EXIT_THRESHOLD_HIT", "SMART_EXIT_EXECUTED", "SMART_EXIT_REGIME_CHANGE",
  "SG_BREAKEVEN_ACTIVATED", "SG_BREAK_EVEN_ACTIVATED", "SG_BE_ACTIVATED",
  "SG_PROGRESSIVE_BE", "SG_TRAILING_ACTIVATED", "SG_TRAIL_ACTIVATED",
  "SG_TRAILING_STOP_UPDATED", "SG_STOP_UPDATED", "SG_TP_FIXED",
  "SG_SNAPSHOT_BACKFILLED", "SG_SNAPSHOT_REFRESH",
  "TRAILING_UPDATED", "BREAKEVEN_ARMED",
  "TIME_STOP_EXPIRED_DISABLED", "TIME_STOP_DEFERRED", "TIME_STOP_CLOSE",
  "TIME_STOP_DUST_CLEANUP", "TIME_STOP_ORPHAN_CLEANUP", "TIME_STOP_LIMIT_FALLBACK",
  "SMART_TIME_STOP_V2",
  "EXIT_EVAL", "EXIT_MIN_VOLUME_BLOCKED",
  "ENTRY_QUALITY_ALLOWED", "D1_ENTRY_COST",
  "KRAKEN_CONNECTED", "TELEGRAM_CONNECTED",
  "PRICE_INVALID", "SPREAD_REJECTED", "SPREAD_DATA_MISSING",
  "SELL_BLOCKED_NO_CONTEXT", "PAIR_NOT_ALLOWED_QUOTE",
  "PAIR_COOLDOWN", "DAILY_LIMIT_HIT", "DAILY_LIMIT_RESET",
  "B3_REGEX_NO_MATCH", "ORDER_SKIPPED_INVALID_NUMBER",
  "FILL_WATCHER_STARTED", "FILL_WATCHER_TIMEOUT",
  "POSITION_PENDING_FILL", "POSITION_UPDATED",
  "NOTIFICATION_SENT", "NOTIFICATION_FAILED",
  "TEST_TRADE_SIMULATED", "TEST_POSITION_CREATED",
  "POSITION_RECONCILED",
]);

// ─── 90 DAYS — technical non-critical, repetitive tracking ────────────────────
const NINETY_DAY_TYPES = new Set<string>([
  "ENGINE_TICK", "MARKET_SCAN_SUMMARY", "BALANCE_CHECK",
]);

// ─── 30 DAYS — debug/polling/verbose (anything else INFO not above) ───────────
// Anything not in the sets above defaults to 30d if level is INFO,
// or permanent if level is ERROR/WARN.

/**
 * Classify a single event into its retention tier.
 * Falls back to "permanent" when uncertain (safe default).
 */
export function classifyEventRetention(
  eventType: string,
  level: string
): EventRetentionTier {
  // ERROR and WARN events are always permanent — never delete errors/warnings
  if (level === "ERROR" || level === "WARN") {
    return "permanent";
  }

  if (PERMANENT_TYPES.has(eventType)) return "permanent";
  if (TWELVE_MONTH_TYPES.has(eventType)) return "12mo";
  if (NINETY_DAY_TYPES.has(eventType)) return "90d";

  // Unknown INFO events → 30d (safe: if uncertain, keep for 30d then clean)
  return "30d";
}

/**
 * Get the SQL-safe list of event types for a given tier.
 * Used for preview and cleanup queries.
 */
export function getEventTypesForTier(tier: EventRetentionTier): string[] {
  switch (tier) {
    case "permanent": return Array.from(PERMANENT_TYPES);
    case "12mo": return Array.from(TWELVE_MONTH_TYPES);
    case "90d": return Array.from(NINETY_DAY_TYPES);
    case "30d": return []; // 30d is the fallback for anything not classified
  }
}

/**
 * Get all non-permanent event types (eligible for cleanup).
 * Returns types from 12mo, 90d, and 30d tiers.
 */
export function getCleanableTypes(): { types: string[]; tiers: { tier: EventRetentionTier; days: number; types: string[] }[] } {
  return {
    types: [
      ...Array.from(TWELVE_MONTH_TYPES),
      ...Array.from(NINETY_DAY_TYPES),
    ],
    tiers: [
      { tier: "12mo", days: 365, types: Array.from(TWELVE_MONTH_TYPES) },
      { tier: "90d", days: 90, types: Array.from(NINETY_DAY_TYPES) },
      { tier: "30d", days: 30, types: [] }, // fallback for unclassified INFO
    ],
  };
}

/**
 * Build SQL IN clause values for a set of types.
 * Returns a quoted, comma-separated string for use in SQL.
 */
export function buildSqlInList(types: string[]): string {
  return types.map(t => `'${t.replace(/'/g, "''")}'`).join(",");
}
