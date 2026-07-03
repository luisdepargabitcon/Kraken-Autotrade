import { sql } from "drizzle-orm";
import { pgTable, text, varchar, serial, bigserial, timestamp, decimal, boolean, integer, bigint, jsonb, unique, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { tradingConfigSchema, configChangeSchema, type TradingConfig, type ConfigChange } from "./config-schema";

// New Trading Configuration Tables
export const tradingConfig = pgTable("trading_config", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  config: jsonb("config").notNull(),
  isActive: boolean("is_active").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const configChange = pgTable("config_change", {
  id: serial("id").primaryKey(),
  configId: text("config_id").notNull(),
  userId: text("user_id"),
  changeType: text("change_type").notNull(), // CREATE, UPDATE, DELETE, ACTIVATE_PRESET, ROLLBACK
  description: text("description").notNull(),
  previousConfig: jsonb("previous_config"),
  newConfig: jsonb("new_config").notNull(),
  changedFields: text("changed_fields").array().notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  appliedAt: timestamp("applied_at"),
  isActive: boolean("is_active").notNull().default(false),
});

export const configPreset = pgTable("config_preset", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description").notNull(),
  config: jsonb("config").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Zod schemas for new tables
export const tradingConfigInsertSchema = createInsertSchema(tradingConfig).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  config: tradingConfigSchema,
});

export const configChangeInsertSchema = createInsertSchema(configChange).omit({
  id: true,
  createdAt: true,
  appliedAt: true,
});

export const configPresetInsertSchema = createInsertSchema(configPreset).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  config: tradingConfigSchema,
});

// Type exports
export type TradingConfigRow = typeof tradingConfig.$inferInsert;
export type ConfigChangeRow = typeof configChange.$inferInsert;
export type ConfigPresetRow = typeof configPreset.$inferInsert;

// Legacy compatibility exports
export const botConfig = pgTable("bot_config", {
  id: serial("id").primaryKey(),
  isActive: boolean("is_active").notNull().default(false),
  strategy: text("strategy").notNull().default("momentum"),
  signalTimeframe: text("signal_timeframe").notNull().default("cycle"),
  riskLevel: text("risk_level").notNull().default("medium"),
  activePairs: text("active_pairs").array().notNull().default(["BTC/USD", "ETH/USD", "SOL/USD"]),
  stopLossPercent: decimal("stop_loss_percent", { precision: 5, scale: 2 }).notNull().default("5.00"),
  takeProfitPercent: decimal("take_profit_percent", { precision: 5, scale: 2 }).notNull().default("7.00"),
  trailingStopEnabled: boolean("trailing_stop_enabled").notNull().default(false),
  trailingStopPercent: decimal("trailing_stop_percent", { precision: 5, scale: 2 }).notNull().default("2.00"),
  nonceErrorAlertsEnabled: boolean("nonce_error_alerts_enabled").notNull().default(true),
  dailyLossLimitEnabled: boolean("daily_loss_limit_enabled").notNull().default(true),
  dailyLossLimitPercent: decimal("daily_loss_limit_percent", { precision: 5, scale: 2 }).notNull().default("10.00"),
  maxPairExposurePct: decimal("max_pair_exposure_pct", { precision: 5, scale: 2 }).notNull().default("25.00"),
  maxTotalExposurePct: decimal("max_total_exposure_pct", { precision: 5, scale: 2 }).notNull().default("60.00"),
  exposureBase: text("exposure_base").notNull().default("cash"),
  riskPerTradePct: decimal("risk_per_trade_pct", { precision: 5, scale: 2 }).notNull().default("15.00"),
  tradingHoursEnabled: boolean("trading_hours_enabled").notNull().default(true),
  tradingHoursStart: decimal("trading_hours_start", { precision: 2, scale: 0 }).notNull().default("8"),
  tradingHoursEnd: decimal("trading_hours_end", { precision: 2, scale: 0 }).notNull().default("22"),
  positionMode: text("position_mode").notNull().default("SINGLE"),
  // SMART_GUARD configuration
  sgMinEntryUsd: decimal("sg_min_entry_usd", { precision: 10, scale: 2 }).notNull().default("100.00"),
  sgAllowUnderMin: boolean("sg_allow_under_min").notNull().default(true),
  sgBeAtPct: decimal("sg_be_at_pct", { precision: 5, scale: 2 }).notNull().default("1.50"),
  sgFeeCushionPct: decimal("sg_fee_cushion_pct", { precision: 5, scale: 2 }).notNull().default("0.45"),
  sgFeeCushionAuto: boolean("sg_fee_cushion_auto").notNull().default(true),
  sgTrailStartPct: decimal("sg_trail_start_pct", { precision: 5, scale: 2 }).notNull().default("2.00"),
  sgTrailDistancePct: decimal("sg_trail_distance_pct", { precision: 5, scale: 2 }).notNull().default("0.85"),
  sgTrailStepPct: decimal("sg_trail_step_pct", { precision: 5, scale: 2 }).notNull().default("0.25"),
  sgTpFixedEnabled: boolean("sg_tp_fixed_enabled").notNull().default(false),
  sgTpFixedPct: decimal("sg_tp_fixed_pct", { precision: 5, scale: 2 }).notNull().default("10.00"),
  sgScaleOutEnabled: boolean("sg_scale_out_enabled").notNull().default(true),
  sgScaleOutPct: decimal("sg_scale_out_pct", { precision: 5, scale: 2 }).notNull().default("35.00"),
  sgMinPartUsd: decimal("sg_min_part_usd", { precision: 10, scale: 2 }).notNull().default("50.00"),
  sgScaleOutThreshold: decimal("sg_scale_out_threshold", { precision: 5, scale: 2 }).notNull().default("80.00"),
  sgMaxOpenLotsPerPair: integer("sg_max_open_lots_per_pair").notNull().default(1),
  // Capital efficiency gate — prevent dust/micro entries that waste slots
  sgAbsoluteDustUsd: decimal("sg_absolute_dust_usd", { precision: 10, scale: 2 }).notNull().default("20.00"),
  sgMinExpectedProfitUsd: decimal("sg_min_expected_profit_usd", { precision: 10, scale: 2 }).notNull().default("1.00"),
  sgSlotEfficiencyEnabled: boolean("sg_slot_efficiency_enabled").notNull().default(true),
  sgExcludeMicroTradesFromScore: boolean("sg_exclude_micro_trades_from_score").notNull().default(true),
  // SMART_GUARD pair overrides (JSON: { "BTC/USD": { trailDistancePct: 1.0 }, ... })
  sgPairOverrides: jsonb("sg_pair_overrides"),
  // DRY_RUN mode: audit/verify without sending real orders to exchange
  dryRunMode: boolean("dry_run_mode").notNull().default(false),
  // Market Regime Detection: automatically adjust SMART_GUARD exit params based on market conditions
  regimeDetectionEnabled: boolean("regime_detection_enabled").notNull().default(false),
  // Regime Router: select strategy based on market regime (TREND/RANGE/TRANSITION)
  regimeRouterEnabled: boolean("regime_router_enabled").notNull().default(false),
  // Router parameters for RANGE regime
  rangeCooldownMinutes: integer("range_cooldown_minutes").notNull().default(60),
  // Router parameters for TRANSITION regime
  transitionSizeFactor: decimal("transition_size_factor", { precision: 4, scale: 2 }).notNull().default("0.50"),
  transitionCooldownMinutes: integer("transition_cooldown_minutes").notNull().default(120),
  transitionBeAtPct: decimal("transition_be_at_pct", { precision: 5, scale: 2 }).notNull().default("2.00"),
  transitionTrailStartPct: decimal("transition_trail_start_pct", { precision: 5, scale: 2 }).notNull().default("2.80"),
  transitionTpPct: decimal("transition_tp_pct", { precision: 5, scale: 2 }).notNull().default("5.00"),
  // Adaptive Exit Engine configuration
  adaptiveExitEnabled: boolean("adaptive_exit_enabled").notNull().default(false),
  takerFeePct: decimal("taker_fee_pct", { precision: 5, scale: 3 }).notNull().default("0.400"),
  makerFeePct: decimal("maker_fee_pct", { precision: 5, scale: 3 }).notNull().default("0.250"),
  profitBufferPct: decimal("profit_buffer_pct", { precision: 5, scale: 2 }).notNull().default("1.00"),
  minBeFloorPct: decimal("min_be_floor_pct", { precision: 5, scale: 2 }).notNull().default("2.00"),
  timeStopHours: integer("time_stop_hours").notNull().default(36),
  timeStopMode: text("time_stop_mode").notNull().default("soft"),
  // Telegram Notification Cooldowns (in seconds)
  notifCooldownStopUpdated: integer("notif_cooldown_stop_updated").notNull().default(60),
  notifCooldownRegimeChange: integer("notif_cooldown_regime_change").notNull().default(300),
  notifCooldownHeartbeat: integer("notif_cooldown_heartbeat").notNull().default(3600),
  notifCooldownTrades: integer("notif_cooldown_trades").notNull().default(0),
  notifCooldownErrors: integer("notif_cooldown_errors").notNull().default(60),
  errorAlertChatId: text("error_alert_chat_id"),
  // Advanced Filters: Signal Rejection Alerts
  signalRejectionAlertsEnabled: boolean("signal_rejection_alerts_enabled").notNull().default(true),
  signalRejectionAlertChatId: text("signal_rejection_alert_chat_id"),
  // BUY Execution Snapshot Alert (Part D)
  buySnapshotAlertsEnabled: boolean("buy_snapshot_alerts_enabled").notNull().default(true),
  // Spread Filter configuration
  spreadFilterEnabled: boolean("spread_filter_enabled").notNull().default(true),
  spreadDynamicEnabled: boolean("spread_dynamic_enabled").notNull().default(true),
  spreadMaxPct: decimal("spread_max_pct", { precision: 5, scale: 2 }).notNull().default("2.00"),
  spreadThresholdTrend: decimal("spread_threshold_trend", { precision: 5, scale: 2 }).notNull().default("1.50"),
  spreadThresholdRange: decimal("spread_threshold_range", { precision: 5, scale: 2 }).notNull().default("2.00"),
  spreadThresholdTransition: decimal("spread_threshold_transition", { precision: 5, scale: 2 }).notNull().default("2.50"),
  spreadCapPct: decimal("spread_cap_pct", { precision: 5, scale: 2 }).notNull().default("3.50"),
  spreadFloorPct: decimal("spread_floor_pct", { precision: 5, scale: 2 }).notNull().default("0.30"),
  spreadRevolutxMarkupPct: decimal("spread_revolutx_markup_pct", { precision: 5, scale: 2 }).notNull().default("0.80"),
  spreadTelegramAlertEnabled: boolean("spread_telegram_alert_enabled").notNull().default(true),
  spreadTelegramCooldownMs: integer("spread_telegram_cooldown_ms").notNull().default(600000),
  // D2: Dynamic markup from real entry cost history (no extra API calls)
  dynamicMarkupEnabled: boolean("dynamic_markup_enabled").notNull().default(true),
  // MINI-B: Staleness gate — block if candle is too old
  stalenessGateEnabled: boolean("staleness_gate_enabled").notNull().default(true),
  stalenessMaxSec: integer("staleness_max_sec").notNull().default(60),
  // MINI-B: Chase gate — block if price moved up too much since candle close
  chaseGateEnabled: boolean("chase_gate_enabled").notNull().default(true),
  chaseMaxPct: decimal("chase_max_pct", { precision: 5, scale: 2 }).notNull().default("0.50"),
  // Log Retention: auto-managed daily purge of server_logs and bot_events
  logRetentionEnabled: boolean("log_retention_enabled").notNull().default(true),
  logRetentionDays: integer("log_retention_days").notNull().default(7),
  eventsRetentionEnabled: boolean("events_retention_enabled").notNull().default(true),
  eventsRetentionDays: integer("events_retention_days").notNull().default(14),
  lastLogPurgeAt: timestamp("last_log_purge_at"),
  lastLogPurgeCount: integer("last_log_purge_count").default(0),
  lastEventsPurgeAt: timestamp("last_events_purge_at"),
  lastEventsPurgeCount: integer("last_events_purge_count").default(0),
  // Market Metrics module config (JSONB)
  marketMetricsConfig: jsonb("market_metrics_config"),
  // Smart Exit Engine config (JSONB) — experimental dynamic exit system
  smartExitConfig: jsonb("smart_exit_config"),
  // Telegram Alert Deduplication config (JSONB) — controls spam prevention
  telegramAlertConfig: jsonb("telegram_alert_config"),
  // IDCA Hybrid Intelligent Layers — off | observer | real
  idcaHybridMode: text("idca_hybrid_mode").default("off"),
  // IDCA Hybrid config (JSONB) — profile, layers, grid policy
  idcaHybridConfig: jsonb("idca_hybrid_config"),
  // IDCA Hybrid alert config (JSONB) — verbosity, dedupe, event toggles
  idcaHybridAlertConfig: jsonb("idca_hybrid_alert_config"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const apiConfig = pgTable("api_config", {
  id: serial("id").primaryKey(),
  // Kraken configuration
  krakenApiKey: text("kraken_api_key"),
  krakenApiSecret: text("kraken_api_secret"),
  krakenConnected: boolean("kraken_connected").notNull().default(false),
  krakenEnabled: boolean("kraken_enabled").notNull().default(true),
  // Revolut X configuration
  revolutxApiKey: text("revolutx_api_key"),
  revolutxPrivateKey: text("revolutx_private_key"),
  revolutxConnected: boolean("revolutx_connected").notNull().default(false),
  revolutxEnabled: boolean("revolutx_enabled").notNull().default(false),
  // Exchange mode: which exchange is used for what purpose
  // 'tradingExchange' executes orders (BUY/SELL)
  tradingExchange: text("trading_exchange").notNull().default("kraken"),
  // 'dataExchange' provides market data (prices, OHLC, orderbook)
  dataExchange: text("data_exchange").notNull().default("kraken"),
  // Legacy activeExchange field - kept for backward compatibility
  activeExchange: text("active_exchange").notNull().default("kraken"),
  // Telegram configuration
  telegramToken: text("telegram_token"),
  telegramChatId: text("telegram_chat_id"),
  telegramConnected: boolean("telegram_connected").notNull().default(false),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Order intents: persiste la intención del bot ANTES de enviar orden al exchange
// Permite atribuir trades importados por sync al bot (executed_by_bot)
export const orderIntents = pgTable("order_intents", {
  id: serial("id").primaryKey(),
  clientOrderId: text("client_order_id").notNull().unique(), // UUID generado por el bot
  exchange: text("exchange").notNull(),
  pair: text("pair").notNull(),
  side: text("side").notNull(), // 'buy' | 'sell'
  volume: decimal("volume", { precision: 18, scale: 8 }).notNull(),
  status: text("status").notNull().default("pending"), // pending, accepted, filled, failed, expired
  exchangeOrderId: text("exchange_order_id"), // ID devuelto por el exchange
  hybridGuardWatchId: integer("hybrid_guard_watch_id"),
  hybridGuardReason: text("hybrid_guard_reason"),
  matchedTradeId: integer("matched_trade_id"), // FK a trades.id cuando se hace match
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const hybridReentryWatches = pgTable("hybrid_reentry_watches", {
  id: serial("id").primaryKey(),
  exchange: varchar("exchange", { length: 32 }).notNull(),
  pair: varchar("pair", { length: 24 }).notNull(),
  strategy: varchar("strategy", { length: 64 }).notNull(),

  reason: varchar("reason", { length: 32 }).notNull(),
  status: varchar("status", { length: 16 }).notNull().default("active"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),

  scanId: varchar("scan_id", { length: 64 }),
  regime: varchar("regime", { length: 24 }),
  rawSignal: varchar("raw_signal", { length: 16 }),

  rejectPrice: decimal("reject_price", { precision: 18, scale: 8 }),
  ema20: decimal("ema20", { precision: 18, scale: 8 }),
  priceVsEma20Pct: decimal("price_vs_ema20_pct", { precision: 18, scale: 8 }),
  volumeRatio: decimal("volume_ratio", { precision: 18, scale: 8 }),
  mtfAlignment: decimal("mtf_alignment", { precision: 18, scale: 8 }),
  signalsCount: integer("signals_count"),
  minSignalsRequired: integer("min_signals_required"),

  meta: jsonb("meta").notNull().default({}),
});

export const trades = pgTable("trades", {
  id: serial("id").primaryKey(),
  tradeId: text("trade_id").notNull(),
  exchange: text("exchange").notNull().default("kraken"),
  origin: text("origin").notNull().default("sync"),
  executedByBot: boolean("executed_by_bot").default(false), // true si el trade fue iniciado por el bot
  orderIntentId: integer("order_intent_id"), // FK a order_intents.id (opcional)
  pair: text("pair").notNull(),
  type: text("type").notNull(),
  price: decimal("price", { precision: 18, scale: 8 }).notNull(),
  amount: decimal("amount", { precision: 18, scale: 8 }).notNull(),
  status: text("status").notNull().default("pending"),
  krakenOrderId: text("kraken_order_id").unique(), // UNIQUE para evitar duplicados en sync
  entryPrice: decimal("entry_price", { precision: 18, scale: 8 }),
  realizedPnlUsd: decimal("realized_pnl_usd", { precision: 18, scale: 8 }),
  realizedPnlPct: decimal("realized_pnl_pct", { precision: 10, scale: 4 }),
  executedAt: timestamp("executed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  exchangePairTradeIdUnique: unique().on(table.exchange, table.pair, table.tradeId),
}));

export const appliedTrades = pgTable("applied_trades", {
  id: serial("id").primaryKey(),
  exchange: text("exchange").notNull(),
  pair: text("pair").notNull(),
  tradeId: text("trade_id").notNull(),
  appliedAt: timestamp("applied_at").notNull().defaultNow(),
}, (table) => ({
  exchangePairTradeUnique: unique().on(table.exchange, table.pair, table.tradeId),
}));

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  message: text("message").notNull(),
  telegramSent: boolean("telegram_sent").notNull().default(false),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const marketData = pgTable("market_data", {
  id: serial("id").primaryKey(),
  pair: text("pair").notNull(),
  price: decimal("price", { precision: 18, scale: 8 }).notNull(),
  volume24h: decimal("volume_24h", { precision: 18, scale: 2 }),
  change24h: decimal("change_24h", { precision: 10, scale: 2 }),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
});

export const telegramChats = pgTable("telegram_chats", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  chatId: text("chat_id").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  alertTrades: boolean("alert_trades").notNull().default(true),
  alertErrors: boolean("alert_errors").notNull().default(true),
  alertSystem: boolean("alert_system").notNull().default(true),
  alertBalance: boolean("alert_balance").notNull().default(false),
  alertHeartbeat: boolean("alert_heartbeat").notNull().default(true),
  alertPreferences: jsonb("alert_preferences").notNull().default({}),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// FISCO Alert Configuration Table
export const fiscoAlertConfig = pgTable("fisco_alert_config", {
  id: serial("id").primaryKey(),
  chatId: text("chat_id").notNull().unique(),
  // Alert toggles
  syncDailyEnabled: boolean("sync_daily_enabled").notNull().default(true),
  syncManualEnabled: boolean("sync_manual_enabled").notNull().default(true),
  reportGeneratedEnabled: boolean("report_generated_enabled").notNull().default(true),
  errorSyncEnabled: boolean("error_sync_enabled").notNull().default(true),
  // Notification preferences
  notifyAlways: boolean("notify_always").notNull().default(false), // Notificar siempre vs solo si hay cambios
  summaryThreshold: integer("summary_threshold").notNull().default(30), // >30 ops = resumen
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// FISCO Sync History
export const fiscoSyncHistory = pgTable("fisco_sync_history", {
  id: serial("id").primaryKey(),
  runId: text("run_id").notNull().unique(),
  mode: text("mode").notNull(), // 'auto' | 'manual'
  triggeredBy: text("triggered_by"), // 'scheduler' | 'ui_button' | 'telegram_command'
  startedAt: timestamp("started_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
  status: text("status").notNull().default('running'), // 'running' | 'completed' | 'failed'
  resultsJson: jsonb("results_json"), // Estadísticas por exchange
  errorJson: jsonb("error_json"),
});

export const alertPreferencesSchema = z.object({
  // Trading
  trade_buy: z.boolean().optional(),
  trade_sell: z.boolean().optional(),
  trade_breakeven: z.boolean().optional(),
  trade_trailing: z.boolean().optional(),
  trade_stoploss: z.boolean().optional(),
  trade_takeprofit: z.boolean().optional(),
  trade_timestop: z.boolean().optional(),
  trade_daily_pnl: z.boolean().optional(),
  trade_pending: z.boolean().optional(),
  trade_filled: z.boolean().optional(),
  trade_spread_rejected: z.boolean().optional(),
  // Strategy / Regime
  strategy_regime_change: z.boolean().optional(),
  strategy_router_transition: z.boolean().optional(),
  // System
  system_bot_started: z.boolean().optional(),
  system_bot_paused: z.boolean().optional(),
  daily_report: z.boolean().optional(),
  // Errors
  error_critical: z.boolean().optional(),
  error_api: z.boolean().optional(),
  error_nonce: z.boolean().optional(),
  // Risk / Balance
  balance_exposure: z.boolean().optional(),
  // Heartbeat
  heartbeat_periodic: z.boolean().optional(),
  // Smart Exit Engine
  smart_exit_threshold: z.boolean().optional(),
  smart_exit_executed: z.boolean().optional(),
  smart_exit_regime: z.boolean().optional(),
  smart_exit_suppressed: z.boolean().optional(),
  // FISCO alerts
  fisco_sync_daily: z.boolean().optional(),
  fisco_sync_manual: z.boolean().optional(),
  fisco_report_generated: z.boolean().optional(),
  fisco_error_sync: z.boolean().optional(),
  // Entry intent / signal
  entry_intent: z.boolean().optional(),
});

export type AlertPreferences = z.infer<typeof alertPreferencesSchema>;

// FISCO Alert Config Schema
export const fiscoAlertConfigSchema = z.object({
  syncDailyEnabled: z.boolean(),
  syncManualEnabled: z.boolean(),
  reportGeneratedEnabled: z.boolean(),
  errorSyncEnabled: z.boolean(),
  notifyAlways: z.boolean(),
  summaryThreshold: z.number().min(1).max(1000),
});

export type FiscoAlertConfig = z.infer<typeof fiscoAlertConfigSchema>;

// FISCO Sync Result Schema
export const fiscoSyncResultSchema = z.object({
  exchange: z.string(),
  status: z.enum(['success', 'warning', 'error']),
  tradesImported: z.number(),
  depositsImported: z.number(),
  withdrawalsImported: z.number(),
  stakingRewardsImported: z.number(),
  totalOperations: z.number(),
  assetsAffected: z.array(z.string()),
  error: z.string().optional(),
  lastSyncAt: z.string().optional(),
});

export type FiscoSyncResult = z.infer<typeof fiscoSyncResultSchema>;

// Dry Run trades - simulated positions for paper trading
export const dryRunTrades = pgTable("dry_run_trades", {
  id: serial("id").primaryKey(),
  simTxid: text("sim_txid").notNull().unique(),
  pair: text("pair").notNull(),
  type: text("type").notNull(), // buy | sell
  price: decimal("price", { precision: 18, scale: 8 }).notNull(),
  amount: decimal("amount", { precision: 18, scale: 8 }).notNull(),
  totalUsd: decimal("total_usd", { precision: 18, scale: 2 }).notNull(),
  reason: text("reason"),
  // Normalized exit reason for audit grouping (populated on insert for sells)
  // Values: TIME_STOP | BREAK_EVEN | TRAILING_STOP | SCALE_OUT | SMART_EXIT | STOP_LOSS | EMERGENCY_SL | TAKE_PROFIT | UNKNOWN
  normalizedReason: text("normalized_reason"),
  status: text("status").notNull().default("open"), // open | closed
  // For sells: link to original buy
  entrySimTxid: text("entry_sim_txid"),
  entryPrice: decimal("entry_price", { precision: 18, scale: 8 }),
  realizedPnlUsd: decimal("realized_pnl_usd", { precision: 18, scale: 2 }),
  realizedPnlPct: decimal("realized_pnl_pct", { precision: 10, scale: 4 }),
  closedAt: timestamp("closed_at"),
  // Strategy meta
  strategyId: text("strategy_id"),
  regime: text("regime"),
  confidence: decimal("confidence", { precision: 5, scale: 2 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // Audit columns for SPOT DRY RUN cleanup (migration 049)
  excludedFromPnl: boolean("excluded_from_pnl").notNull().default(false),
  exclusionReason: text("exclusion_reason"),
  excludedAt: timestamp("excluded_at"),
  auditBatchId: text("audit_batch_id"),
  effectiveDecisionContextJson: jsonb("effective_decision_context_json"),
});

// Archive table for exact duplicate dry-run trades removed during cleanup (migration 049)
export const dryRunTradesArchive = pgTable("dry_run_trades_archive", {
  id: serial("id").primaryKey(),
  simTxid: text("sim_txid").notNull(),
  pair: text("pair").notNull(),
  type: text("type").notNull(),
  price: decimal("price", { precision: 18, scale: 8 }).notNull(),
  amount: decimal("amount", { precision: 18, scale: 8 }).notNull(),
  totalUsd: decimal("total_usd", { precision: 18, scale: 2 }).notNull(),
  reason: text("reason"),
  normalizedReason: text("normalized_reason"),
  status: text("status").notNull().default("open"),
  entrySimTxid: text("entry_sim_txid"),
  entryPrice: decimal("entry_price", { precision: 18, scale: 8 }),
  realizedPnlUsd: decimal("realized_pnl_usd", { precision: 18, scale: 2 }),
  realizedPnlPct: decimal("realized_pnl_pct", { precision: 10, scale: 4 }),
  closedAt: timestamp("closed_at"),
  strategyId: text("strategy_id"),
  regime: text("regime"),
  confidence: decimal("confidence", { precision: 5, scale: 2 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  excludedFromPnl: boolean("excluded_from_pnl").notNull().default(false),
  exclusionReason: text("exclusion_reason"),
  excludedAt: timestamp("excluded_at"),
  auditBatchId: text("audit_batch_id"),
  // Archive-specific metadata
  archivedAt: timestamp("archived_at").notNull().defaultNow(),
  archiveReason: text("archive_reason").notNull().default("exact_duplicate"),
  originalId: integer("original_id"), // Reference to canonical row kept
});

export const botEvents = pgTable("bot_events", {
  id: serial("id").primaryKey(),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
  level: text("level").notNull(),
  type: text("type").notNull(),
  message: text("message").notNull(),
  meta: text("meta"),
});

// Server/application logs for Terminal tab (persisted for 7 days)
export const serverLogs = pgTable("server_logs", {
  id: serial("id").primaryKey(),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
  source: text("source").notNull(), // 'app_stdout', 'docker_compose', 'krakenbot_container', etc.
  level: text("level").notNull().default("INFO"), // INFO, WARN, ERROR, DEBUG
  line: text("line").notNull(), // Raw log line
  isError: boolean("is_error").default(false),
});

// Position status lifecycle
export type PositionStatus = 'PENDING_FILL' | 'OPEN' | 'FAILED' | 'CANCELLED';

export const openPositions = pgTable("open_positions", {
  id: serial("id").primaryKey(),
  lotId: text("lot_id").notNull().unique(), // Unique identifier for each lot (multi-lot support)
  exchange: text("exchange").notNull().default("kraken"),
  pair: text("pair").notNull(), // Removed unique constraint for multi-lot support
  entryPrice: decimal("entry_price", { precision: 18, scale: 8 }).notNull(),
  amount: decimal("amount", { precision: 18, scale: 8 }).notNull(),
  qtyRemaining: decimal("qty_remaining", { precision: 18, scale: 8 }), // Cantidad pendiente de vender (null = amount)
  qtyFilled: decimal("qty_filled", { precision: 18, scale: 8 }).default("0"), // Cantidad ya vendida
  highestPrice: decimal("highest_price", { precision: 18, scale: 8 }).notNull(),
  tradeId: text("trade_id"),
  krakenOrderId: text("kraken_order_id"),
  entryStrategyId: text("entry_strategy_id").notNull().default("momentum_cycle"),
  entrySignalTf: text("entry_signal_tf").notNull().default("cycle"),
  signalConfidence: decimal("signal_confidence", { precision: 5, scale: 2 }),
  signalReason: text("signal_reason"),
  entryMode: text("entry_mode"),
  configSnapshotJson: jsonb("config_snapshot_json"),
  // Entry fee for accurate P&L calculation (both legs)
  entryFee: decimal("entry_fee", { precision: 18, scale: 8 }).default("0"),
  // SMART_GUARD dynamic state
  sgBreakEvenActivated: boolean("sg_break_even_activated").default(false),
  sgCurrentStopPrice: decimal("sg_current_stop_price", { precision: 18, scale: 8 }),
  sgTrailingActivated: boolean("sg_trailing_activated").default(false),
  sgScaleOutDone: boolean("sg_scale_out_done").default(false),
  // Adaptive Exit Engine state per lot
  timeStopDisabled: boolean("time_stop_disabled").default(false),
  timeStopExpiredAt: timestamp("time_stop_expired_at"),
  // Break-even progressive level (1, 2, 3) for fee-aware BE
  beProgressiveLevel: integer("be_progressive_level").default(0),
  // Smart Exit Engine: entry context snapshot (signals at entry time)
  entryContextJson: jsonb("entry_context_json"),
  // === NEW: Instant Position & Average Entry Price ===
  // Position lifecycle status: PENDING_FILL → OPEN (or FAILED/CANCELLED)
  status: text("status").default("OPEN"),
  // Link to order_intent for idempotent upsert
  clientOrderId: text("client_order_id"), // UUID from placeOrder
  venueOrderId: text("venue_order_id"), // ID returned by exchange (for order status queries)
  orderIntentId: integer("order_intent_id"),
  // Expected amount before fills confirm
  expectedAmount: decimal("expected_amount", { precision: 18, scale: 8 }),
  // Cost aggregation for Average Entry Price (coste medio)
  // total_cost_quote = Σ (fill.amount * fill.price) in quote currency (USD)
  totalCostQuote: decimal("total_cost_quote", { precision: 18, scale: 8 }).default("0"),
  // total_amount_base = Σ fill.amount in base currency (TON, ETH, etc.)
  totalAmountBase: decimal("total_amount_base", { precision: 18, scale: 8 }).default("0"),
  // average_entry_price = total_cost_quote / total_amount_base
  averageEntryPrice: decimal("average_entry_price", { precision: 18, scale: 8 }),
  // Fill tracking
  fillCount: integer("fill_count").default(0),
  lastFillId: text("last_fill_id"),
  firstFillAt: timestamp("first_fill_at"),
  lastFillAt: timestamp("last_fill_at"),
  // === END NEW ===
  openedAt: timestamp("opened_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Trade fills from Kraken (granular level for partial fills)
export const tradeFills = pgTable("trade_fills", {
  id: serial("id").primaryKey(),
  txid: text("txid").notNull().unique(), // Kraken fill txid (UNIQUE para evitar duplicados)
  orderId: text("order_id").notNull(), // Kraken ordertxid (puede tener múltiples fills)
  exchange: text("exchange").notNull().default("kraken"),
  pair: text("pair").notNull(),
  type: text("type").notNull(), // buy/sell
  price: decimal("price", { precision: 18, scale: 8 }).notNull(),
  amount: decimal("amount", { precision: 18, scale: 8 }).notNull(),
  cost: decimal("cost", { precision: 18, scale: 8 }).notNull(),
  fee: decimal("fee", { precision: 18, scale: 8 }).notNull(),
  matched: boolean("matched").notNull().default(false), // Flag para evitar re-procesar
  executedAt: timestamp("executed_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Lot matches for FIFO matching (audit trail)
export const lotMatches = pgTable("lot_matches", {
  id: serial("id").primaryKey(),
  sellFillTxid: text("sell_fill_txid").notNull(), // Fill txid del SELL
  lotId: text("lot_id").notNull(), // ID del lot (open_position)
  matchedQty: decimal("matched_qty", { precision: 18, scale: 8 }).notNull(),
  buyPrice: decimal("buy_price", { precision: 18, scale: 8 }).notNull(),
  sellPrice: decimal("sell_price", { precision: 18, scale: 8 }).notNull(),
  buyFeeAllocated: decimal("buy_fee_allocated", { precision: 18, scale: 8 }).notNull(),
  sellFeeAllocated: decimal("sell_fee_allocated", { precision: 18, scale: 8 }).notNull(),
  pnlNet: decimal("pnl_net", { precision: 18, scale: 8 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  sellLotUnique: unique().on(table.sellFillTxid, table.lotId), // UNIQUE(sellFillTxid, lotId) para idempotencia
}));

export const aiTradeSamples = pgTable("ai_trade_samples", {
  id: serial("id").primaryKey(),
  tradeId: text("trade_id").unique().notNull(),
  pair: text("pair").notNull(),
  side: text("side").notNull(),
  entryTs: timestamp("entry_ts").notNull(),
  exitTs: timestamp("exit_ts"),
  entryPrice: decimal("entry_price", { precision: 18, scale: 8 }).notNull(),
  exitPrice: decimal("exit_price", { precision: 18, scale: 8 }),
  feesTotal: decimal("fees_total", { precision: 18, scale: 8 }),
  pnlGross: decimal("pnl_gross", { precision: 18, scale: 8 }),
  pnlNet: decimal("pnl_net", { precision: 18, scale: 8 }),
  labelWin: integer("label_win"),
  featuresJson: jsonb("features_json").notNull(),
  isComplete: boolean("is_complete").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const aiShadowDecisions = pgTable("ai_shadow_decisions", {
  id: serial("id").primaryKey(),
  tradeId: text("trade_id").notNull(),
  ts: timestamp("ts").defaultNow(),
  score: decimal("score", { precision: 5, scale: 4 }).notNull(),
  threshold: decimal("threshold", { precision: 5, scale: 4 }).notNull(),
  wouldBlock: boolean("would_block").notNull(),
  finalPnlNet: decimal("final_pnl_net", { precision: 18, scale: 8 }),
  pair: text("pair"),
  action: text("action"),
  confidence: decimal("confidence", { precision: 6, scale: 4 }),
  reason: text("reason"),
  modelVersion: text("model_version"),
  metadataJson: jsonb("metadata_json"),
  effectiveDecisionContextJson: jsonb("effective_decision_context_json"),
});

export const trainingTrades = pgTable("training_trades", {
  id: serial("id").primaryKey(),
  pair: text("pair").notNull(),
  strategyId: text("strategy_id"),
  buyTxid: text("buy_txid").notNull().unique(), // UNIQUE para evitar duplicados en backfill
  sellTxid: text("sell_txid"),
  sellTxidsJson: jsonb("sell_txids_json"),
  entryPrice: decimal("entry_price", { precision: 18, scale: 8 }).notNull(),
  exitPrice: decimal("exit_price", { precision: 18, scale: 8 }),
  entryAmount: decimal("entry_amount", { precision: 18, scale: 8 }).notNull(),
  exitAmount: decimal("exit_amount", { precision: 18, scale: 8 }),
  qtyRemaining: decimal("qty_remaining", { precision: 18, scale: 8 }),
  entryFee: decimal("entry_fee", { precision: 18, scale: 8 }).notNull().default("0"),
  exitFee: decimal("exit_fee", { precision: 18, scale: 8 }),
  costUsd: decimal("cost_usd", { precision: 18, scale: 8 }).notNull(),
  revenueUsd: decimal("revenue_usd", { precision: 18, scale: 8 }),
  pnlGross: decimal("pnl_gross", { precision: 18, scale: 8 }),
  pnlNet: decimal("pnl_net", { precision: 18, scale: 8 }),
  pnlPct: decimal("pnl_pct", { precision: 10, scale: 4 }),
  holdTimeMinutes: integer("hold_time_minutes"),
  labelWin: integer("label_win"),
  featuresJson: jsonb("features_json"),
  discardReason: text("discard_reason"),
  isClosed: boolean("is_closed").notNull().default(false),
  isLabeled: boolean("is_labeled").notNull().default(false),
  entryTs: timestamp("entry_ts").notNull(),
  exitTs: timestamp("exit_ts"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // Autotuning extension columns (Phase 1 - migration 051)
  sourceMode: text("source_mode").notNull().default("REAL"), // REAL | DRY_RUN | SHADOW | IDCA_SIMULATION
  sourceTradeId: text("source_trade_id"),
  sourceTable: text("source_table").notNull().default("trades"), // trades | dry_run_trades | shadow
  evidenceWeight: decimal("evidence_weight", { precision: 4, scale: 3 }).notNull().default("1.000"),
  exitReason: text("exit_reason"),
  exitCategory: text("exit_category"),
  wasTimeStop: boolean("was_time_stop").notNull().default(false),
  regime: text("regime"),
  configSnapshotJson: jsonb("config_snapshot_json"),
  mfePct: decimal("mfe_pct", { precision: 8, scale: 4 }),
  maePct: decimal("mae_pct", { precision: 8, scale: 4 }),
  maxDrawdownPct: decimal("max_drawdown_pct", { precision: 8, scale: 4 }),
  sessionLabel: text("session_label"),
  entryScore: decimal("entry_score", { precision: 6, scale: 3 }),
  tradeQualityScore: integer("trade_quality_score"),
  effectiveDecisionContextJson: jsonb("effective_decision_context_json"),
});

export const aiConfig = pgTable("ai_config", {
  id: serial("id").primaryKey(),
  filterEnabled: boolean("filter_enabled").default(false),
  shadowEnabled: boolean("shadow_enabled").default(false),
  modelPath: text("model_path"),
  modelVersion: text("model_version"),
  lastTrainTs: timestamp("last_train_ts"),
  lastBackfillTs: timestamp("last_backfill_ts"),
  lastBackfillError: text("last_backfill_error"),
  lastBackfillDiscardReasonsJson: jsonb("last_backfill_discard_reasons_json"),
  lastTrainError: text("last_train_error"),
  nSamples: integer("n_samples").default(0),
  threshold: decimal("threshold", { precision: 5, scale: 4 }).default("0.60"),
  metricsJson: jsonb("metrics_json"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Regime state for anti-spam and stabilization (Phase 1)
export const regimeState = pgTable("regime_state", {
  pair: text("pair").primaryKey(),
  currentRegime: text("current_regime").notNull().default("TRANSITION"),
  confirmedAt: timestamp("confirmed_at"),
  lastNotifiedAt: timestamp("last_notified_at"),
  holdUntil: timestamp("hold_until"),
  transitionSince: timestamp("transition_since"),
  candidateRegime: text("candidate_regime"),
  candidateCount: integer("candidate_count").notNull().default(0),
  lastParamsHash: text("last_params_hash"),
  lastReasonHash: text("last_reason_hash"),
  lastAdx: decimal("last_adx", { precision: 5, scale: 2 }),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertBotConfigSchema = createInsertSchema(botConfig).omit({ id: true, updatedAt: true });
export const insertTradeSchema = createInsertSchema(trades).omit({ id: true, createdAt: true });
export const insertNotificationSchema = createInsertSchema(notifications).omit({ id: true, createdAt: true });
export const insertMarketDataSchema = createInsertSchema(marketData).omit({ id: true, timestamp: true });
export const insertApiConfigSchema = createInsertSchema(apiConfig).omit({ id: true, updatedAt: true });
export const telegramChatInsertSchema = createInsertSchema(telegramChats).omit({
  id: true,
}).extend({
  alertPreferences: alertPreferencesSchema.optional(),
});

export type HybridReentryWatch = typeof hybridReentryWatches.$inferSelect;
export type InsertHybridReentryWatch = typeof hybridReentryWatches.$inferInsert;

export const insertDryRunTradeSchema = createInsertSchema(dryRunTrades).omit({ id: true, createdAt: true });
export const insertBotEventSchema = createInsertSchema(botEvents).omit({ id: true, timestamp: true });
export const insertOpenPositionSchema = createInsertSchema(openPositions).omit({ id: true, openedAt: true, updatedAt: true });
export const insertAiTradeSampleSchema = createInsertSchema(aiTradeSamples).omit({ id: true, createdAt: true });
export const insertAiShadowDecisionSchema = createInsertSchema(aiShadowDecisions).omit({ id: true, ts: true });
export const insertAiConfigSchema = createInsertSchema(aiConfig).omit({ id: true, updatedAt: true });
export const insertTrainingTradeSchema = createInsertSchema(trainingTrades).omit({ id: true, createdAt: true });
export const insertTradeFillSchema = createInsertSchema(tradeFills).omit({ id: true, createdAt: true });
export const insertLotMatchSchema = createInsertSchema(lotMatches).omit({ id: true, createdAt: true });
export const insertRegimeStateSchema = createInsertSchema(regimeState).omit({ updatedAt: true });
export const insertOrderIntentSchema = createInsertSchema(orderIntents).omit({ id: true, createdAt: true, updatedAt: true });

export type BotConfig = typeof botConfig.$inferSelect;
export type Trade = typeof trades.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type MarketData = typeof marketData.$inferSelect;
export type ApiConfig = typeof apiConfig.$inferSelect;
export type TelegramChat = typeof telegramChats.$inferSelect;
export type DryRunTrade = typeof dryRunTrades.$inferSelect;
export type InsertDryRunTrade = z.infer<typeof insertDryRunTradeSchema>;
export type BotEvent = typeof botEvents.$inferSelect;
export type OpenPosition = typeof openPositions.$inferSelect;
export type TradeFill = typeof tradeFills.$inferSelect;
export type LotMatch = typeof lotMatches.$inferSelect;
export type AiTradeSample = typeof aiTradeSamples.$inferSelect;
export type AiShadowDecision = typeof aiShadowDecisions.$inferSelect;
export type AiConfig = typeof aiConfig.$inferSelect;
export type TrainingTrade = typeof trainingTrades.$inferSelect;

export type InsertBotConfig = z.infer<typeof insertBotConfigSchema>;
export type InsertTrade = z.infer<typeof insertTradeSchema>;
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type InsertMarketData = z.infer<typeof insertMarketDataSchema>;
export type InsertApiConfig = z.infer<typeof insertApiConfigSchema>;
export type InsertTelegramChat = z.infer<typeof telegramChatInsertSchema>;
export type InsertBotEvent = z.infer<typeof insertBotEventSchema>;
export type InsertOpenPosition = z.infer<typeof insertOpenPositionSchema>;
export type InsertTradeFill = z.infer<typeof insertTradeFillSchema>;
export type InsertLotMatch = z.infer<typeof insertLotMatchSchema>;
export type InsertAiTradeSample = z.infer<typeof insertAiTradeSampleSchema>;
export type InsertAiShadowDecision = z.infer<typeof insertAiShadowDecisionSchema>;
export type InsertAiConfig = z.infer<typeof insertAiConfigSchema>;
export type InsertTrainingTrade = z.infer<typeof insertTrainingTradeSchema>;
export type AppliedTrade = typeof appliedTrades.$inferSelect;
export type InsertAppliedTrade = typeof appliedTrades.$inferInsert;
export type RegimeState = typeof regimeState.$inferSelect;
export type InsertRegimeState = z.infer<typeof insertRegimeStateSchema>;
export type OrderIntent = typeof orderIntents.$inferSelect;
export type InsertOrderIntent = z.infer<typeof insertOrderIntentSchema>;

// Master Backups Table
export const masterBackups = pgTable("master_backups", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  originalName: text("original_name"),
  type: text("type").notNull(), // 'database', 'code', 'full'
  filePath: text("file_path").notNull(),
  size: text("size").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  markedAsMasterAt: timestamp("marked_as_master_at").notNull().defaultNow(),
  metrics: jsonb("metrics"), // Bot metrics at backup time
  systemInfo: jsonb("system_info"), // System info at backup time
  tags: text("tags").array().notNull().default(sql`ARRAY[]::text[]`),
  priority: integer("priority").notNull().default(10),
  protection: text("protection").notNull().default('permanent'),
});

export const insertMasterBackupSchema = createInsertSchema(masterBackups).omit({
  id: true,
  createdAt: true,
  markedAsMasterAt: true,
});

export type MasterBackup = typeof masterBackups.$inferSelect;
export type InsertMasterBackup = z.infer<typeof insertMasterBackupSchema>;

// Smart TimeStop configuration: per-asset/market TTL with regime multipliers and close policy
export const timeStopConfig = pgTable("time_stop_config", {
  id: serial("id").primaryKey(),
  pair: text("pair").notNull(),                          // e.g. 'BTC/USD', '*' for default
  market: text("market").notNull().default("spot"),      // 'spot', 'futures', etc.

  // Base TTL in hours
  ttlBaseHours: decimal("ttl_base_hours", { precision: 8, scale: 2 }).notNull().default("36.00"),

  // Regime multipliers (applied to ttlBaseHours)
  factorTrend: decimal("factor_trend", { precision: 5, scale: 3 }).notNull().default("1.200"),
  factorRange: decimal("factor_range", { precision: 5, scale: 3 }).notNull().default("0.800"),
  factorTransition: decimal("factor_transition", { precision: 5, scale: 3 }).notNull().default("1.000"),

  // TTL clamp limits (in hours)
  minTtlHours: decimal("min_ttl_hours", { precision: 8, scale: 2 }).notNull().default("4.00"),
  maxTtlHours: decimal("max_ttl_hours", { precision: 8, scale: 2 }).notNull().default("168.00"),

  // Close policy on expiry
  closeOrderType: text("close_order_type").notNull().default("market"),          // 'market' or 'limit'
  limitFallbackSeconds: integer("limit_fallback_seconds").notNull().default(30), // fallback to market after N seconds

  // Logging & alerts
  telegramAlertEnabled: boolean("telegram_alert_enabled").notNull().default(true),
  logExpiryEvenIfDisabled: boolean("log_expiry_even_if_disabled").notNull().default(true),

  // FASE 4 — Soft mode: when true, only close on expiry if net P&L >= minProfitPctToExit.
  // Replaces the decorative bot_config.timeStopMode="soft" that never gated behavior.
  // Default is NOW true (migration 048 enables it for all rows).
  softMode: boolean("soft_mode").notNull().default(true),

  // FASE 4 — Minimum net PnL (after round-trip fees) required before TimeStop closes.
  // e.g. 0.25 means position must be at least +0.25% net before TimeStop fires.
  // Only evaluated when softMode=true.
  minProfitPctToExit: decimal("min_profit_pct_to_exit", { precision: 6, scale: 3 }).notNull().default("0.25"),

  // Priority (lower = higher priority)
  priority: integer("priority").notNull().default(100),

  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  pairMarketUnique: unique().on(table.pair, table.market),
}));

export const insertTimeStopConfigSchema = createInsertSchema(timeStopConfig).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type TimeStopConfigRow = typeof timeStopConfig.$inferSelect;
export type InsertTimeStopConfig = z.infer<typeof insertTimeStopConfigSchema>;

// Alert throttle: persists SG alert and time-stop notification timestamps across restarts
export const alertThrottle = pgTable("alert_throttle", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(), // "lotId:eventType" or "ts:lotId"
  lastAlertAt: timestamp("last_alert_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AlertThrottleRow = typeof alertThrottle.$inferSelect;

// Insert schemas for FISCO tables
export const insertFiscoAlertConfigSchema = createInsertSchema(fiscoAlertConfig).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  chatId: z.string(),
});

export const insertFiscoSyncHistorySchema = createInsertSchema(fiscoSyncHistory).omit({
  id: true,
  completedAt: true,
});

// Export types for FISCO tables
export type FiscoAlertConfigRow = typeof fiscoAlertConfig.$inferSelect;
export type FiscoSyncHistoryRow = typeof fiscoSyncHistory.$inferSelect;
export type InsertFiscoAlertConfig = z.infer<typeof insertFiscoAlertConfigSchema>;
export type InsertFiscoSyncHistory = z.infer<typeof insertFiscoSyncHistorySchema>;

// ============================================================
// FISCO: Fiscal Control Tables (exchange-only data)
// ============================================================

export const fiscoOperations = pgTable("fisco_operations", {
  id: serial("id").primaryKey(),
  exchange: text("exchange").notNull(),
  externalId: text("external_id").notNull(),
  opType: text("op_type").notNull(),
  asset: text("asset").notNull(),
  amount: decimal("amount", { precision: 18, scale: 8 }).notNull(),
  priceEur: decimal("price_eur", { precision: 18, scale: 8 }),
  totalEur: decimal("total_eur", { precision: 18, scale: 8 }),
  feeEur: decimal("fee_eur", { precision: 18, scale: 8 }).default("0"),
  counterAsset: text("counter_asset"),
  pair: text("pair"),
  executedAt: timestamp("executed_at").notNull(),
  rawData: jsonb("raw_data"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  exchangeExternalUnique: unique().on(table.exchange, table.externalId),
}));

export const fiscoLots = pgTable("fisco_lots", {
  id: serial("id").primaryKey(),
  operationId: integer("operation_id").notNull(),
  asset: text("asset").notNull(),
  quantity: decimal("quantity", { precision: 18, scale: 8 }).notNull(),
  remainingQty: decimal("remaining_qty", { precision: 18, scale: 8 }).notNull(),
  costEur: decimal("cost_eur", { precision: 18, scale: 8 }).notNull(),
  unitCostEur: decimal("unit_cost_eur", { precision: 18, scale: 8 }).notNull(),
  feeEur: decimal("fee_eur", { precision: 18, scale: 8 }).default("0"),
  acquiredAt: timestamp("acquired_at").notNull(),
  isClosed: boolean("is_closed").default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const fiscoDisposals = pgTable("fisco_disposals", {
  id: serial("id").primaryKey(),
  sellOperationId: integer("sell_operation_id").notNull(),
  lotId: integer("lot_id").notNull(),
  quantity: decimal("quantity", { precision: 18, scale: 8 }).notNull(),
  proceedsEur: decimal("proceeds_eur", { precision: 18, scale: 8 }).notNull(),
  costBasisEur: decimal("cost_basis_eur", { precision: 18, scale: 8 }).notNull(),
  gainLossEur: decimal("gain_loss_eur", { precision: 18, scale: 8 }).notNull(),
  disposedAt: timestamp("disposed_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const fiscoSummary = pgTable("fisco_summary", {
  id: serial("id").primaryKey(),
  fiscalYear: integer("fiscal_year").notNull(),
  asset: text("asset").notNull(),
  totalAcquisitions: decimal("total_acquisitions", { precision: 18, scale: 8 }).default("0"),
  totalDisposals: decimal("total_disposals", { precision: 18, scale: 8 }).default("0"),
  totalCostBasisEur: decimal("total_cost_basis_eur", { precision: 18, scale: 8 }).default("0"),
  totalProceedsEur: decimal("total_proceeds_eur", { precision: 18, scale: 8 }).default("0"),
  totalGainLossEur: decimal("total_gain_loss_eur", { precision: 18, scale: 8 }).default("0"),
  totalFeesEur: decimal("total_fees_eur", { precision: 18, scale: 8 }).default("0"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  yearAssetUnique: unique().on(table.fiscalYear, table.asset),
}));

export type FiscoOperation = typeof fiscoOperations.$inferSelect;
export type FiscoLot = typeof fiscoLots.$inferSelect;
export type FiscoDisposal = typeof fiscoDisposals.$inferSelect;
export type FiscoSummary = typeof fiscoSummary.$inferSelect;

// FISCO Sync Retry — persiste estado de reintentos por exchange (ej: Kraken RATE_LIMIT)
export const fiscoSyncRetry = pgTable("fisco_sync_retry", {
  id: serial("id").primaryKey(),
  exchange: text("exchange").notNull().unique(),
  retryCount: integer("retry_count").notNull().default(0),
  nextRetryAt: timestamp("next_retry_at"),
  lastErrorCode: text("last_error_code"),
  lastErrorMsg: text("last_error_msg"),
  status: text("status").notNull().default('pending'), // 'pending' | 'exhausted' | 'resolved'
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type FiscoSyncRetryRow = typeof fiscoSyncRetry.$inferSelect;

// ============================================================
// INSTITUTIONAL DCA MODULE — Complete isolation from main bot
// ============================================================

// Allowed pairs for Institutional DCA v1
export const INSTITUTIONAL_DCA_ALLOWED_PAIRS = ["BTC/USD", "ETH/USD"] as const;
export type InstitutionalDcaPair = typeof INSTITUTIONAL_DCA_ALLOWED_PAIRS[number];

// 10.1 Trading Engine Controls — independent toggles for normal bot and IDCA
export const tradingEngineControls = pgTable("trading_engine_controls", {
  id: serial("id").primaryKey(),
  normalBotEnabled: boolean("normal_bot_enabled").notNull().default(true),
  institutionalDcaEnabled: boolean("institutional_dca_enabled").notNull().default(false),
  globalTradingPause: boolean("global_trading_pause").notNull().default(false),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type TradingEngineControls = typeof tradingEngineControls.$inferSelect;
export type InsertTradingEngineControls = typeof tradingEngineControls.$inferInsert;

// 10.2 Institutional DCA Config — global module configuration
export const institutionalDcaConfig = pgTable("institutional_dca_config", {
  id: serial("id").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  mode: text("mode").notNull().default("disabled"), // disabled | simulation | live
  allocatedCapitalUsd: decimal("allocated_capital_usd", { precision: 18, scale: 2 }).notNull().default("1000.00"),
  protectPrincipal: boolean("protect_principal").notNull().default(true),
  reinvestMode: text("reinvest_mode").notNull().default("none"), // none | profits_only | full
  maxModuleExposurePct: decimal("max_module_exposure_pct", { precision: 5, scale: 2 }).notNull().default("80.00"),
  maxAssetExposurePct: decimal("max_asset_exposure_pct", { precision: 5, scale: 2 }).notNull().default("50.00"),
  maxModuleDrawdownPct: decimal("max_module_drawdown_pct", { precision: 5, scale: 2 }).notNull().default("15.00"),
  maxCombinedBtcExposurePct: decimal("max_combined_btc_exposure_pct", { precision: 5, scale: 2 }).notNull().default("40.00"),
  maxCombinedEthExposurePct: decimal("max_combined_eth_exposure_pct", { precision: 5, scale: 2 }).notNull().default("30.00"),
  blockOnBreakdown: boolean("block_on_breakdown").notNull().default(true),
  blockOnHighSpread: boolean("block_on_high_spread").notNull().default(true),
  blockOnSellPressure: boolean("block_on_sell_pressure").notNull().default(true),
  schedulerIntervalSeconds: integer("scheduler_interval_seconds").notNull().default(60),
  // FASE 8 — Adaptive scheduler intervals (state-aware).
  // idle: no active cycles; active: ≥1 active cycle; protected: ≥1 cycle with tp_armed/trailing_active/protection_armed.
  schedulerIdleSeconds: integer("scheduler_idle_seconds").notNull().default(900),
  schedulerActiveSeconds: integer("scheduler_active_seconds").notNull().default(300),
  schedulerProtectedSeconds: integer("scheduler_protected_seconds").notNull().default(120),
  localHighLookbackMinutes: integer("local_high_lookback_minutes").notNull().default(1440),
  // Smart Mode
  smartModeEnabled: boolean("smart_mode_enabled").notNull().default(true),
  volatilityTrailingEnabled: boolean("volatility_trailing_enabled").notNull().default(true),
  adaptiveTpEnabled: boolean("adaptive_tp_enabled").notNull().default(true),
  adaptivePositionSizingEnabled: boolean("adaptive_position_sizing_enabled").notNull().default(true),
  btcMarketGateForEthEnabled: boolean("btc_market_gate_for_eth_enabled").notNull().default(true),
  learningWindowCycles: integer("learning_window_cycles").notNull().default(20),
  learningAutoApply: boolean("learning_auto_apply").notNull().default(false),
  // Smart Mode guardrails
  minTrailingPctBtc: decimal("min_trailing_pct_btc", { precision: 5, scale: 2 }).notNull().default("0.50"),
  maxTrailingPctBtc: decimal("max_trailing_pct_btc", { precision: 5, scale: 2 }).notNull().default("2.50"),
  minTrailingPctEth: decimal("min_trailing_pct_eth", { precision: 5, scale: 2 }).notNull().default("0.80"),
  maxTrailingPctEth: decimal("max_trailing_pct_eth", { precision: 5, scale: 2 }).notNull().default("3.50"),
  minTpPctBtc: decimal("min_tp_pct_btc", { precision: 5, scale: 2 }).notNull().default("2.00"),
  maxTpPctBtc: decimal("max_tp_pct_btc", { precision: 5, scale: 2 }).notNull().default("6.00"),
  minTpPctEth: decimal("min_tp_pct_eth", { precision: 5, scale: 2 }).notNull().default("2.50"),
  maxTpPctEth: decimal("max_tp_pct_eth", { precision: 5, scale: 2 }).notNull().default("8.00"),
  marketScoreWeightsJson: jsonb("market_score_weights_json").notNull().default({
    ema20_distance: 15, ema50_distance: 10, ema20_slope: 10, ema50_slope: 10,
    rsi: 15, relative_volume: 10, drawdown_from_high: 15, btc_condition: 15,
  }),
  // Partial TP range
  partialTpMinPct: decimal("partial_tp_min_pct", { precision: 5, scale: 2 }).notNull().default("20.00"),
  partialTpMaxPct: decimal("partial_tp_max_pct", { precision: 5, scale: 2 }).notNull().default("50.00"),
  // Simulation
  simulationInitialBalanceUsd: decimal("simulation_initial_balance_usd", { precision: 18, scale: 2 }).notNull().default("10000.00"),
  simulationFeePct: decimal("simulation_fee_pct", { precision: 5, scale: 3 }).notNull().default("0.400"),
  simulationSlippagePct: decimal("simulation_slippage_pct", { precision: 5, scale: 3 }).notNull().default("0.100"),
  simulationTelegramEnabled: boolean("simulation_telegram_enabled").notNull().default(false),
  // Data retention
  eventRetentionDays: integer("event_retention_days").notNull().default(90),
  orderArchiveDays: integer("order_archive_days").notNull().default(180),
  // Telegram config for IDCA
  telegramEnabled: boolean("telegram_enabled").notNull().default(false),
  telegramChatId: text("telegram_chat_id"),
  telegramThreadId: text("telegram_thread_id"),
  telegramSummaryMode: text("telegram_summary_mode").notNull().default("compact"), // compact | detailed
  telegramCooldownSeconds: integer("telegram_cooldown_seconds").notNull().default(30),
  telegramAlertTogglesJson: jsonb("telegram_alert_toggles_json").notNull().default({
    cycle_started: true, base_buy_executed: true, safety_buy_executed: true,
    buy_blocked: true, tp_armed: true, partial_sell_executed: true,
    trailing_updated: false, trailing_exit: true, breakeven_exit: true,
    cycle_closed: true, daily_summary: true, critical_error: true,
    smart_adjustment_applied: true, simulation_alerts_enabled: true,
  }),
  dynamicTpConfigJson: jsonb("dynamic_tp_config_json").notNull().default({
    baseTpPctBtc: 4.0, baseTpPctEth: 5.0,
    reductionPerExtraBuyMain: 0.3, reductionPerExtraBuyPlus: 0.2,
    weakReboundReductionMain: 0.5, weakReboundReductionPlus: 0.3,
    strongReboundBonusMain: 0.3, strongReboundBonusPlus: 0.2,
    highVolatilityAdjustMain: 0.3, highVolatilityAdjustPlus: 0.2,
    lowVolatilityAdjustMain: -0.2, lowVolatilityAdjustPlus: -0.1,
    mainMinTpPctBtc: 2.0, mainMaxTpPctBtc: 6.0,
    mainMinTpPctEth: 2.5, mainMaxTpPctEth: 8.0,
    plusMinTpPctBtc: 2.5, plusMaxTpPctBtc: 5.0,
    plusMinTpPctEth: 3.0, plusMaxTpPctEth: 6.0,
  }),
  plusConfigJson: jsonb("plus_config_json").notNull().default({
    enabled: false, maxPlusCyclesPerMain: 2, maxPlusEntries: 3,
    capitalAllocationPct: 15, activationExtraDipPct: 4.0,
    requireMainExhausted: true, requireReboundConfirmation: true,
    cooldownMinutesBetweenBuys: 60, autoCloseIfMainClosed: true,
    maxExposurePctPerAsset: 20, entryDipSteps: [2.0, 3.5, 5.0],
    entrySizingMode: "fixed", baseTpPctBtc: 4.0, baseTpPctEth: 4.5,
    trailingPctBtc: 1.0, trailingPctEth: 1.2,
  }),
  recoveryConfigJson: jsonb("recovery_config_json").notNull().default({
    enabled: false, activationDrawdownPct: 25, maxRecoveryCyclesPerMain: 1,
    maxTotalCyclesPerPair: 3, maxPairExposurePct: 40, capitalAllocationPct: 10,
    maxRecoveryCapitalUsd: 500, cooldownMinutesAfterMainBuy: 120,
    cooldownMinutesBetweenRecovery: 360, minMarketScoreForRecovery: 40,
    requireReboundConfirmation: true, recoveryTpPctBtc: 2.5, recoveryTpPctEth: 3.0,
    maxRecoveryEntries: 2, recoveryEntryDipSteps: [2.0, 4.0],
    recoveryTrailingPctBtc: 0.8, recoveryTrailingPctEth: 1.0,
    autoCloseIfMainClosed: true, autoCloseIfMainRecovers: false,
    maxRecoveryDurationHours: 168,
  }),
  // ─── Slider-based UI configuration (source of truth for entry and Telegram alerts) ───
  // When present, these OVERRIDE individual technical params (minDipPct, trailingValue, etc.)
  // Application defaults (entryPatienceLevel:70, etc.) are applied in IdcaSliderConfig.ts
  entryUiJson: jsonb("entry_ui_json"),              // EntryUiConfig — sliders de entrada
  telegramUiJson: jsonb("telegram_ui_json"),         // TelegramUiConfig — sliders de alertas
  executionFeesJson: jsonb("execution_fees_json"),   // ExecutionFeesConfig — fees Revolut X / exchange
  // ─── Ancla Dinámica IDCA (Lote 5) ───────────────────────────────────────────
  idcaDynamicAnchorEnabled: boolean("idca_dynamic_anchor_enabled").notNull().default(true),
  idcaDynamicAnchorFallbackToLegacy: boolean("idca_dynamic_anchor_fallback_to_legacy").notNull().default(true),
  idcaDynamicAnchorEmergencyDisable: boolean("idca_dynamic_anchor_emergency_disable").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type InstitutionalDcaConfigRow = typeof institutionalDcaConfig.$inferSelect;
export type InsertInstitutionalDcaConfig = typeof institutionalDcaConfig.$inferInsert;

// 10.3 Asset-level configs (one row per pair)
export const institutionalDcaAssetConfigs = pgTable("institutional_dca_asset_configs", {
  id: serial("id").primaryKey(),
  pair: text("pair").notNull().unique(),
  enabled: boolean("enabled").notNull().default(true),
  minDipPct: decimal("min_dip_pct", { precision: 5, scale: 2 }).notNull().default("2.00"),
  dipReference: text("dip_reference").notNull().default("hybrid"), // hybrid | swing_high | window_high | ema (reserved)
  requireReboundConfirmation: boolean("require_rebound_confirmation").notNull().default(true),
  reboundMinPct: decimal("rebound_min_pct", { precision: 5, scale: 2 }).notNull().default("0.30"),
  trailingBuyEnabled: boolean("trailing_buy_enabled").notNull().default(true),
  vwapEnabled: boolean("vwap_enabled").notNull().default(false),
  vwapDynamicSafetyEnabled: boolean("vwap_dynamic_safety_enabled").notNull().default(false),
  safetyOrdersJson: jsonb("safety_orders_json").notNull().default([
    { dipPct: 2.0, sizePctOfAssetBudget: 25 },
    { dipPct: 4.0, sizePctOfAssetBudget: 25 },
    { dipPct: 6.0, sizePctOfAssetBudget: 25 },
    { dipPct: 8.0, sizePctOfAssetBudget: 25 },
  ]),
  maxSafetyOrders: integer("max_safety_orders").notNull().default(4),
  // Ladder ATRP config (new system)
  ladderAtrpConfigJson: jsonb("ladder_atrp_config_json"),
  ladderAtrpEnabled: boolean("ladder_atrp_enabled").notNull().default(false),
  // Trailing Buy Level 1 config
  trailingBuyLevel1ConfigJson: jsonb("trailing_buy_level_1_config_json"),
  // Dynamic Distance config (manual | dynamic_hybrid)
  dynamicDistanceConfigJson: jsonb("dynamic_distance_config_json"),
  // Dynamic Rebound config for intelligent trailing buy
  dynamicReboundConfigJson: jsonb("dynamic_rebound_config_json").notNull().default("{}"),
  // Entry Mode: which distance resolver is active for all buy types
  entryMode: text("entry_mode").notNull().default("assisted_entry"),
  takeProfitPct: decimal("take_profit_pct", { precision: 5, scale: 2 }).notNull().default("4.00"),
  dynamicTakeProfit: boolean("dynamic_take_profit").notNull().default(true),
  trailingPct: decimal("trailing_pct", { precision: 5, scale: 2 }).notNull().default("1.20"),
  partialTakeProfitPct: decimal("partial_take_profit_pct", { precision: 5, scale: 2 }).notNull().default("30.00"),
  breakevenEnabled: boolean("breakeven_enabled").notNull().default(true),
  // New exit sliders: protection → trailing → close
  protectionActivationPct: decimal("protection_activation_pct", { precision: 5, scale: 2 }).notNull().default("1.00"),
  // Net break-even buffer: adds margin to avgEntryPrice to cover fees/spread when protection triggers
  beNetBufferPct: decimal("be_net_buffer_pct", { precision: 5, scale: 3 }).notNull().default("0.30"),
  trailingActivationPct: decimal("trailing_activation_pct", { precision: 5, scale: 2 }).notNull().default("3.50"),
  trailingMarginPct: decimal("trailing_margin_pct", { precision: 5, scale: 2 }).notNull().default("1.50"),
  cooldownMinutesBetweenBuys: integer("cooldown_minutes_between_buys").notNull().default(180),
  maxCycleDurationHours: integer("max_cycle_duration_hours").notNull().default(720),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type InstitutionalDcaAssetConfigRow = typeof institutionalDcaAssetConfigs.$inferSelect;
export type InsertInstitutionalDcaAssetConfig = typeof institutionalDcaAssetConfigs.$inferInsert;

// 10.4 Cycles — one active cycle per pair per mode
export const institutionalDcaCycles = pgTable("institutional_dca_cycles", {
  id: serial("id").primaryKey(),
  pair: text("pair").notNull(),
  strategy: text("strategy").notNull().default("institutional_dca_v1"),
  mode: text("mode").notNull(), // simulation | live
  status: text("status").notNull().default("idle"), // idle|waiting_entry|active|tp_armed|trailing_active|paused|blocked|closed
  capitalReservedUsd: decimal("capital_reserved_usd", { precision: 18, scale: 2 }).notNull().default("0"),
  capitalUsedUsd: decimal("capital_used_usd", { precision: 18, scale: 2 }).notNull().default("0"),
  totalQuantity: decimal("total_quantity", { precision: 18, scale: 8 }).notNull().default("0"),
  avgEntryPrice: decimal("avg_entry_price", { precision: 18, scale: 8 }),
  currentPrice: decimal("current_price", { precision: 18, scale: 8 }),
  unrealizedPnlUsd: decimal("unrealized_pnl_usd", { precision: 18, scale: 2 }).default("0"),
  unrealizedPnlPct: decimal("unrealized_pnl_pct", { precision: 10, scale: 4 }).default("0"),
  realizedPnlUsd: decimal("realized_pnl_usd", { precision: 18, scale: 2 }).default("0"),
  buyCount: integer("buy_count").notNull().default(0),
  highestPriceAfterTp: decimal("highest_price_after_tp", { precision: 18, scale: 8 }),
  tpTargetPct: decimal("tp_target_pct", { precision: 5, scale: 2 }),
  tpTargetPrice: decimal("tp_target_price", { precision: 18, scale: 8 }),
  tpArmedAt: timestamp("tp_armed_at"),
  trailingPct: decimal("trailing_pct", { precision: 5, scale: 2 }),
  trailingActiveAt: timestamp("trailing_active_at"),
  nextBuyLevelPct: decimal("next_buy_level_pct", { precision: 5, scale: 2 }),
  nextBuyPrice: decimal("next_buy_price", { precision: 18, scale: 8 }),
  marketScore: decimal("market_score", { precision: 5, scale: 2 }),
  volatilityScore: decimal("volatility_score", { precision: 5, scale: 2 }),
  adaptiveSizeProfile: text("adaptive_size_profile"), // aggressive_quality|balanced|defensive
  lastBuyAt: timestamp("last_buy_at"),
  closeReason: text("close_reason"),
  maxDrawdownPct: decimal("max_drawdown_pct", { precision: 5, scale: 2 }).default("0"),
  notesJson: jsonb("notes_json"),
  tpBreakdownJson: jsonb("tp_breakdown_json"),
  cycleType: text("cycle_type").notNull().default("main"), // main | plus
  parentCycleId: integer("parent_cycle_id"),
  plusCyclesCompleted: integer("plus_cycles_completed").notNull().default(0),
  // Import fields
  isImported: boolean("is_imported").notNull().default(false),
  importedAt: timestamp("imported_at"),
  sourceType: text("source_type"), // manual | normal_bot | exchange | external
  managedBy: text("managed_by"), // idca | normal_bot | external | manual
  soloSalida: boolean("solo_salida").notNull().default(false),
  importNotes: text("import_notes"),
  importSnapshotJson: jsonb("import_snapshot_json"),
  // Manual cycle & exchange fields
  isManualCycle: boolean("is_manual_cycle").notNull().default(false),
  exchangeSource: text("exchange_source"), // revolut_x | kraken | other
  estimatedFeePct: decimal("estimated_fee_pct", { precision: 8, scale: 4 }),
  estimatedFeeUsd: decimal("estimated_fee_usd", { precision: 18, scale: 2 }),
  feesOverrideManual: boolean("fees_override_manual").notNull().default(false),
  importWarningAcknowledged: boolean("import_warning_acknowledged").notNull().default(false),
  // Entry base price — deterministic, persisted, auditable
  basePrice: decimal("base_price", { precision: 18, scale: 8 }),
  basePriceType: text("base_price_type"), // swing_high_1h | window_high_p95 | cycle_start_price
  basePriceWindowMinutes: integer("base_price_window_minutes"),
  basePriceTimestamp: timestamp("base_price_timestamp"),
  basePriceMetaJson: jsonb("base_price_meta_json"),
  entryDipPct: decimal("entry_dip_pct", { precision: 10, scale: 4 }),
  // Protection & trailing state
  protectionArmedAt: timestamp("protection_armed_at"),
  protectionStopPrice: decimal("protection_stop_price", { precision: 18, scale: 8 }),
  // Manual edit audit trail
  lastManualEditAt: timestamp("last_manual_edit_at"),
  lastManualEditReason: text("last_manual_edit_reason"),
  editHistoryJson: jsonb("edit_history_json").default([]),
  // Skipped safety levels for imported cycles (when price already below some levels)
  skippedSafetyLevels: integer("skipped_safety_levels").default(0),
  skippedLevelsDetail: jsonb("skipped_levels_detail"),
  // Per-cycle exit overrides (manual UI toggles)
  exitOverridesJson: jsonb("exit_overrides_json"),
  // Lote 4: cost basis tracking for partial sells
  totalCostBasisUsd: decimal("total_cost_basis_usd", { precision: 18, scale: 2 }).notNull().default("0"),
  realizedCostBasisUsd: decimal("realized_cost_basis_usd", { precision: 18, scale: 2 }).notNull().default("0"),
  partialSellCount: integer("partial_sell_count").notNull().default(0),
  lastPartialSellAt: timestamp("last_partial_sell_at"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  closedAt: timestamp("closed_at"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  // HOTFIX: Campos de reconciliación
  reconciliationStatus: text("reconciliation_status"),
  reconciliationBlockedReason: text("reconciliation_blocked_reason"),
  reconciliationBlockedAt: timestamp("reconciliation_blocked_at"),
});

export type InstitutionalDcaCycle = typeof institutionalDcaCycles.$inferSelect;
export type InsertInstitutionalDcaCycle = typeof institutionalDcaCycles.$inferInsert;

// 10.4b Exit Instructions — Lote 4
export const idcaExitInstructions = pgTable("idca_cycle_exit_instructions", {
  id: serial("id").primaryKey(),
  cycleId: integer("cycle_id").notNull(),
  pair: text("pair").notNull(),
  mode: text("mode").notNull(),                                     // simulation | live
  type: text("type").notNull(),                                     // immediate | price_target | scheduled_time
  triggerPrice: decimal("trigger_price", { precision: 18, scale: 8 }),
  triggerDirection: text("trigger_direction"),                       // above | below
  triggerTime: timestamp("trigger_time", { withTimezone: true }),
  timezone: text("timezone").notNull().default("Europe/Madrid"),
  closePct: decimal("close_pct", { precision: 5, scale: 2 }).notNull(), // 25 | 50 | 75 | 100
  requestedQuantity: decimal("requested_quantity", { precision: 18, scale: 8 }),
  status: text("status").notNull().default("pending"),              // pending|executing|executed|cancelled|failed|failed_requires_review
  createdAt: timestamp("created_at").notNull().defaultNow(),
  createdBy: text("created_by").notNull().default("user"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  // Transactional execution
  executingStartedAt: timestamp("executing_started_at", { withTimezone: true }),
  executionClientOrderId: text("execution_client_order_id"),
  executedAt: timestamp("executed_at", { withTimezone: true }),
  executionExchangeOrderId: text("execution_exchange_order_id"),
  executionPrice: decimal("execution_price", { precision: 18, scale: 8 }),
  executionQuantity: decimal("execution_quantity", { precision: 18, scale: 8 }),
  // Cost basis (never null in executed instructions)
  costBasisSoldUsd: decimal("cost_basis_sold_usd", { precision: 18, scale: 4 }),
  realizedPnlIncrementUsd: decimal("realized_pnl_increment_usd", { precision: 18, scale: 4 }),
  remainingCapitalUsedUsd: decimal("remaining_capital_used_usd", { precision: 18, scale: 4 }),
  remainingCycleQuantityAfter: decimal("remaining_cycle_quantity_after", { precision: 18, scale: 8 }),
  // Financial result
  grossValueUsd: decimal("gross_value_usd", { precision: 18, scale: 2 }),
  feesUsd: decimal("fees_usd", { precision: 18, scale: 4 }),
  netValueUsd: decimal("net_value_usd", { precision: 18, scale: 2 }),
  // Cancellation / Error
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelReason: text("cancel_reason"),
  failureReason: text("failure_reason"),
  // Notifications
  telegramSentAt: timestamp("telegram_sent_at", { withTimezone: true }),
  notes: text("notes"),
});

export type IdcaExitInstruction = typeof idcaExitInstructions.$inferSelect;
export type InsertIdcaExitInstruction = typeof idcaExitInstructions.$inferInsert;

// 10.5 Orders — granular order history
export const institutionalDcaOrders = pgTable("institutional_dca_orders", {
  id: serial("id").primaryKey(),
  cycleId: integer("cycle_id").notNull(),
  pair: text("pair").notNull(),
  mode: text("mode").notNull(), // simulation | live
  orderType: text("order_type").notNull(), // base_buy|safety_buy|partial_sell|final_sell|breakeven_sell|emergency_sell
  buyIndex: integer("buy_index"),
  side: text("side").notNull(), // buy | sell
  price: decimal("price", { precision: 18, scale: 8 }).notNull(),
  quantity: decimal("quantity", { precision: 18, scale: 8 }).notNull(),
  grossValueUsd: decimal("gross_value_usd", { precision: 18, scale: 2 }).notNull(),
  feesUsd: decimal("fees_usd", { precision: 18, scale: 2 }).notNull().default("0"),
  slippageUsd: decimal("slippage_usd", { precision: 18, scale: 2 }).notNull().default("0"),
  netValueUsd: decimal("net_value_usd", { precision: 18, scale: 2 }).notNull(),
  triggerReason: text("trigger_reason"),
  humanReason: text("human_reason"),
  exchangeOrderId: text("exchange_order_id"),
  executedAt: timestamp("executed_at").notNull().defaultNow(),
  // HOTFIX: Campos de trazabilidad de ejecución
  executionStatus: text("execution_status").default("pending"),
  intendedQuantity: decimal("intended_quantity", { precision: 18, scale: 8 }),
  intendedUsd: decimal("intended_usd", { precision: 18, scale: 2 }),
  executedQuantity: decimal("executed_quantity", { precision: 18, scale: 8 }),
  executedUsd: decimal("executed_usd", { precision: 18, scale: 2 }),
  avgFillPrice: decimal("avg_fill_price", { precision: 18, scale: 8 }),
  rawExchangeResponseJson: jsonb("raw_exchange_response_json"),
  voidedReason: text("voided_reason"),
  voidedAt: timestamp("voided_at"),
  reconciledAt: timestamp("reconciled_at"),
  sizeAdjusted: boolean("size_adjusted").default(false),
  originalIntendedUsd: decimal("original_intended_usd", { precision: 18, scale: 2 }),
  adjustedUsd: decimal("adjusted_usd", { precision: 18, scale: 2 }),
  idempotencyKey: text("idempotency_key"),
  availableQuoteBefore: decimal("available_quote_before", { precision: 18, scale: 2 }),
  spendableQuote: decimal("spendable_quote", { precision: 18, scale: 2 }),
  needsVerificationReason: text("needs_verification_reason"),
  // Fee tracking for base-asset fees (e.g., Revolut X charges fee in BTC)
  grossBaseQty: decimal("gross_base_qty", { precision: 18, scale: 8 }),
  netBaseQty: decimal("net_base_qty", { precision: 18, scale: 8 }),
  feeAsset: text("fee_asset"),
  feeAmount: decimal("fee_amount", { precision: 18, scale: 8 }),
  feeSource: text("fee_source"), // exchange_api, inferred_from_default_pct, manual, legacy
});

export type InstitutionalDcaOrder = typeof institutionalDcaOrders.$inferSelect;
export type InsertInstitutionalDcaOrder = typeof institutionalDcaOrders.$inferInsert;

// 10.6 Events — audit trail
export const institutionalDcaEvents = pgTable("institutional_dca_events", {
  id: serial("id").primaryKey(),
  cycleId: integer("cycle_id"),
  pair: text("pair"),
  mode: text("mode"),
  eventType: text("event_type").notNull(),
  reasonCode: text("reason_code"),
  severity: text("severity").notNull().default("info"), // info|warn|error|critical
  message: text("message").notNull(),
  humanTitle: text("human_title"),
  humanMessage: text("human_message"),
  technicalSummary: text("technical_summary"),
  payloadJson: jsonb("payload_json"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type InstitutionalDcaEvent = typeof institutionalDcaEvents.$inferSelect;
export type InsertInstitutionalDcaEvent = typeof institutionalDcaEvents.$inferInsert;

// 10.7 Backtests
export const institutionalDcaBacktests = pgTable("institutional_dca_backtests", {
  id: serial("id").primaryKey(),
  pair: text("pair").notNull(),
  fromDate: timestamp("from_date").notNull(),
  toDate: timestamp("to_date").notNull(),
  configSnapshotJson: jsonb("config_snapshot_json").notNull(),
  totalReturnPct: decimal("total_return_pct", { precision: 10, scale: 4 }),
  totalReturnUsd: decimal("total_return_usd", { precision: 18, scale: 2 }),
  maxDrawdownPct: decimal("max_drawdown_pct", { precision: 10, scale: 4 }),
  winRatePct: decimal("win_rate_pct", { precision: 10, scale: 4 }),
  profitFactor: decimal("profit_factor", { precision: 10, scale: 4 }),
  cyclesCount: integer("cycles_count"),
  avgCycleDurationHours: decimal("avg_cycle_duration_hours", { precision: 10, scale: 2 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type InstitutionalDcaBacktest = typeof institutionalDcaBacktests.$inferSelect;
export type InsertInstitutionalDcaBacktest = typeof institutionalDcaBacktests.$inferInsert;

// 10.8 Simulation Wallet
export const institutionalDcaSimulationWallet = pgTable("institutional_dca_simulation_wallet", {
  id: serial("id").primaryKey(),
  initialBalanceUsd: decimal("initial_balance_usd", { precision: 18, scale: 2 }).notNull().default("10000.00"),
  availableBalanceUsd: decimal("available_balance_usd", { precision: 18, scale: 2 }).notNull().default("10000.00"),
  usedBalanceUsd: decimal("used_balance_usd", { precision: 18, scale: 2 }).notNull().default("0"),
  realizedPnlUsd: decimal("realized_pnl_usd", { precision: 18, scale: 2 }).notNull().default("0"),
  unrealizedPnlUsd: decimal("unrealized_pnl_usd", { precision: 18, scale: 2 }).notNull().default("0"),
  totalEquityUsd: decimal("total_equity_usd", { precision: 18, scale: 2 }).notNull().default("10000.00"),
  totalCyclesSimulated: integer("total_cycles_simulated").notNull().default(0),
  totalOrdersSimulated: integer("total_orders_simulated").notNull().default(0),
  lastResetAt: timestamp("last_reset_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type InstitutionalDcaSimulationWalletRow = typeof institutionalDcaSimulationWallet.$inferSelect;
export type InsertInstitutionalDcaSimulationWallet = typeof institutionalDcaSimulationWallet.$inferInsert;

// 10.9 OHLCV Cache — local data source for backtest and analysis
export const institutionalDcaOhlcvCache = pgTable("institutional_dca_ohlcv_cache", {
  id: serial("id").primaryKey(),
  pair: text("pair").notNull(),
  timeframe: text("timeframe").notNull(), // 1m|5m|15m|1h|4h|1d
  ts: timestamp("ts").notNull(),
  open: decimal("open", { precision: 18, scale: 8 }).notNull(),
  high: decimal("high", { precision: 18, scale: 8 }).notNull(),
  low: decimal("low", { precision: 18, scale: 8 }).notNull(),
  close: decimal("close", { precision: 18, scale: 8 }).notNull(),
  volume: decimal("volume", { precision: 18, scale: 8 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  pairTimeframeTsUnique: unique().on(table.pair, table.timeframe, table.ts),
}));

export type InstitutionalDcaOhlcvCacheRow = typeof institutionalDcaOhlcvCache.$inferSelect;
export type InsertInstitutionalDcaOhlcvCache = typeof institutionalDcaOhlcvCache.$inferInsert;

// 10.10 IDCA Price Context Snapshots — daily per pair+bucket, max 2920 rows
export const idcaPriceContextSnapshots = pgTable("idca_price_context_snapshots", {
  id: serial("id").primaryKey(),
  pair: text("pair").notNull(),
  bucket: text("bucket").notNull(),               // '7d' | '30d' | '90d' | '180d'
  snapshotDate: date("snapshot_date").notNull(),  // 1 row per pair+bucket+day
  highMax: decimal("high_max", { precision: 18, scale: 8 }),
  lowMin: decimal("low_min", { precision: 18, scale: 8 }),
  p95High: decimal("p95_high", { precision: 18, scale: 8 }),
  avgClose: decimal("avg_close", { precision: 18, scale: 8 }),
  drawdownFromHighPct: decimal("drawdown_from_high_pct", { precision: 8, scale: 4 }),
  rangePosition: decimal("range_position", { precision: 8, scale: 4 }),
  source: text("source").notNull().default("scheduled"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  pairBucketDateUnique: unique().on(table.pair, table.bucket, table.snapshotDate),
}));

export type IdcaPriceContextSnapshotRow = typeof idcaPriceContextSnapshots.$inferSelect;
export type InsertIdcaPriceContextSnapshot = typeof idcaPriceContextSnapshots.$inferInsert;

// 10.11 IDCA Price Context Static — one permanent row per pair
// high_2y = max from ~720 daily Kraken candles (~2 years). Not true ATH.
export const idcaPriceContextStatic = pgTable("idca_price_context_static", {
  id: serial("id").primaryKey(),
  pair: text("pair").notNull().unique(),
  high2y: decimal("high_2y", { precision: 18, scale: 8 }),
  high2yTime: timestamp("high_2y_time"),
  low2y: decimal("low_2y", { precision: 18, scale: 8 }),
  low2yTime: timestamp("low_2y_time"),
  yearHigh: decimal("year_high", { precision: 18, scale: 8 }),
  yearLow: decimal("year_low", { precision: 18, scale: 8 }),
  lastP95_90d: decimal("last_p95_90d", { precision: 18, scale: 8 }),
  lastP95_180d: decimal("last_p95_180d", { precision: 18, scale: 8 }),
  lastDrawdown90dPct: decimal("last_drawdown_90d_pct", { precision: 8, scale: 4 }),
  lastDrawdown180dPct: decimal("last_drawdown_180d_pct", { precision: 8, scale: 4 }),
  lastRangePosition90d: decimal("last_range_position_90d", { precision: 8, scale: 4 }),
  lastRangePosition180d: decimal("last_range_position_180d", { precision: 8, scale: 4 }),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type IdcaPriceContextStaticRow = typeof idcaPriceContextStatic.$inferSelect;
export type InsertIdcaPriceContextStatic = typeof idcaPriceContextStatic.$inferInsert;

// 10.12 IDCA VWAP Anchors — persistent anchor memory (survives restarts)
export const idcaVwapAnchors = pgTable("idca_vwap_anchors", {
  pair:           text("pair").primaryKey(),
  anchorPrice:    decimal("anchor_price", { precision: 20, scale: 8 }).notNull(),
  anchorTs:       bigint("anchor_ts", { mode: "number" }).notNull(),
  setAt:          bigint("set_at",     { mode: "number" }).notNull(),
  drawdownPct:    decimal("drawdown_pct", { precision: 10, scale: 4 }).notNull().default("0"),
  prevPrice:      decimal("prev_price",   { precision: 20, scale: 8 }),
  prevTs:         bigint("prev_ts",       { mode: "number" }),
  prevSetAt:      bigint("prev_set_at",   { mode: "number" }),
  prevReplacedAt: bigint("prev_replaced_at", { mode: "number" }),
  updatedAt:      timestamp("updated_at").notNull().defaultNow(),
});

export type IdcaVwapAnchorRow    = typeof idcaVwapAnchors.$inferSelect;
export type InsertIdcaVwapAnchor = typeof idcaVwapAnchors.$inferInsert;

// ============================================================
// AUTOTUNING MODULE (Phase 1 — data model)
// ============================================================

export const tradeSnapshots = pgTable("trade_snapshots", {
  id:                    bigserial("id", { mode: "number" }).primaryKey(),
  sourceMode:            text("source_mode").notNull(),       // REAL | DRY_RUN | SHADOW | IDCA_SIMULATION
  strategyType:          text("strategy_type").notNull(),     // BOT_SPOT | IDCA
  sourceTradeId:         text("source_trade_id").notNull(),
  sourceTable:           text("source_table").notNull(),
  snapshotType:          text("snapshot_type").notNull(),     // ENTRY | EXIT | CYCLE_START | SAFETY_BUY | TP | BREAKEVEN
  evidenceWeight:        decimal("evidence_weight", { precision: 4, scale: 3 }).notNull().default("1.000"),
  pair:                  text("pair").notNull(),
  entryTsUtc:            timestamp("entry_ts_utc", { withTimezone: true }),
  exitTsUtc:             timestamp("exit_ts_utc", { withTimezone: true }),
  sessionLabel:          text("session_label"),
  entryPrice:            decimal("entry_price", { precision: 18, scale: 8 }),
  exitPrice:             decimal("exit_price", { precision: 18, scale: 8 }),
  executedAmount:        decimal("executed_amount", { precision: 18, scale: 8 }),
  entryFeeUsd:           decimal("entry_fee_usd", { precision: 18, scale: 8 }),
  exitFeeUsd:            decimal("exit_fee_usd", { precision: 18, scale: 8 }),
  slippageEntryPct:      decimal("slippage_entry_pct", { precision: 10, scale: 6 }),
  slippageExitPct:       decimal("slippage_exit_pct", { precision: 10, scale: 6 }),
  signalScore:           decimal("signal_score", { precision: 6, scale: 3 }),
  spreadPct:             decimal("spread_pct", { precision: 8, scale: 4 }),
  regime:                text("regime"),
  trend1h:               text("trend_1h"),
  trend4h:               text("trend_4h"),
  trend1d:               text("trend_1d"),
  ema10:                 decimal("ema10", { precision: 18, scale: 8 }),
  ema20:                 decimal("ema20", { precision: 18, scale: 8 }),
  atrPct:                decimal("atr_pct", { precision: 8, scale: 4 }),
  rsi14:                 decimal("rsi14", { precision: 6, scale: 2 }),
  macdHist:              decimal("macd_hist", { precision: 18, scale: 8 }),
  volumeRatio:           decimal("volume_ratio", { precision: 8, scale: 4 }),
  distanceToVwapPct:     decimal("distance_to_vwap_pct", { precision: 8, scale: 4 }),
  distanceToAnchorPct:   decimal("distance_to_anchor_pct", { precision: 8, scale: 4 }),
  capitalAvailableUsd:   decimal("capital_available_usd", { precision: 18, scale: 2 }),
  totalExposureUsd:      decimal("total_exposure_usd", { precision: 18, scale: 2 }),
  pairExposureUsd:       decimal("pair_exposure_usd", { precision: 18, scale: 2 }),
  configSnapshotJson:    jsonb("config_snapshot_json"),
  entryRulesMetJson:     jsonb("entry_rules_met_json"),
  entryRulesBlockedJson: jsonb("entry_rules_blocked_json"),
  exitReason:            text("exit_reason"),
  exitCategory:          text("exit_category"),
  wasTimeStop:           boolean("was_time_stop").notNull().default(false),
  pnlGrossUsd:           decimal("pnl_gross_usd", { precision: 18, scale: 8 }),
  pnlNetUsd:             decimal("pnl_net_usd", { precision: 18, scale: 8 }),
  pnlPct:                decimal("pnl_pct", { precision: 10, scale: 4 }),
  mfePct:                decimal("mfe_pct", { precision: 8, scale: 4 }),
  maePct:                decimal("mae_pct", { precision: 8, scale: 4 }),
  maxDrawdownPct:        decimal("max_drawdown_pct", { precision: 8, scale: 4 }),
  holdTimeMinutes:       integer("hold_time_minutes"),
  tradeQualityScore:     integer("trade_quality_score"),
  effectiveDecisionContextJson: jsonb("effective_decision_context_json"),
  createdAt:             timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  sourceEventUnique: unique().on(table.sourceTradeId, table.sourceMode, table.snapshotType),
}));

export type TradeSnapshot = typeof tradeSnapshots.$inferSelect;
export type InsertTradeSnapshot = typeof tradeSnapshots.$inferInsert;

export const tradeMetrics = pgTable("trade_metrics", {
  id:                   bigserial("id", { mode: "number" }).primaryKey(),
  sourceMode:           text("source_mode").notNull(),
  strategyType:         text("strategy_type").notNull(),
  sourceTradeId:        text("source_trade_id").notNull(),
  pair:                 text("pair").notNull(),
  sampledAt:            timestamp("sampled_at", { withTimezone: true }).notNull().defaultNow(),
  currentPrice:         decimal("current_price", { precision: 18, scale: 8 }),
  entryPrice:           decimal("entry_price", { precision: 18, scale: 8 }),
  floatingPnlUsd:       decimal("floating_pnl_usd", { precision: 18, scale: 8 }),
  floatingPnlPct:       decimal("floating_pnl_pct", { precision: 10, scale: 4 }),
  mfePct:               decimal("mfe_pct", { precision: 8, scale: 4 }),
  maePct:               decimal("mae_pct", { precision: 8, scale: 4 }),
  maxDrawdownPct:       decimal("max_drawdown_pct", { precision: 8, scale: 4 }),
  highPriceSeen:        decimal("high_price_seen", { precision: 18, scale: 8 }),
  lowPriceSeen:         decimal("low_price_seen", { precision: 18, scale: 8 }),
  trailingActivated:    boolean("trailing_activated").default(false),
  timePositiveMinutes:  integer("time_positive_minutes").default(0),
  timeNegativeMinutes:  integer("time_negative_minutes").default(0),
});

export type TradeMetric = typeof tradeMetrics.$inferSelect;
export type InsertTradeMetric = typeof tradeMetrics.$inferInsert;

export const strategyProfiles = pgTable("strategy_profiles", {
  id:                   serial("id").primaryKey(),
  strategyType:         text("strategy_type").notNull(),  // BOT_SPOT | IDCA
  pair:                 text("pair"),                     // NULL = all pairs
  profileName:          text("profile_name").notNull(),
  mode:                 text("mode").notNull().default("ACTIVE"), // ACTIVE | SHADOW | ARCHIVED
  configJson:           jsonb("config_json").notNull().default({}),
  parentProfileId:      integer("parent_profile_id"),
  rollbackOfProfileId:  integer("rollback_of_profile_id"),
  isActive:             boolean("is_active").notNull().default(false),
  notes:                text("notes"),
  approvedBy:           text("approved_by"),
  createdAt:            timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  appliedAt:            timestamp("applied_at", { withTimezone: true }),
  archivedAt:           timestamp("archived_at", { withTimezone: true }),
});

export type StrategyProfile = typeof strategyProfiles.$inferSelect;
export type InsertStrategyProfile = typeof strategyProfiles.$inferInsert;

export const tuningProposals = pgTable("tuning_proposals", {
  id:                    serial("id").primaryKey(),
  strategyType:          text("strategy_type").notNull(),
  pair:                  text("pair"),
  profileId:             integer("profile_id"),
  proposedProfileId:     integer("proposed_profile_id"),
  parameterChangesJson:  jsonb("parameter_changes_json"),
  metricsBeforeJson:     jsonb("metrics_before_json"),
  metricsAfterJson:      jsonb("metrics_after_json"),
  confidenceScore:       decimal("confidence_score", { precision: 5, scale: 2 }),
  riskScore:             decimal("risk_score", { precision: 5, scale: 2 }),
  recommendation:        text("recommendation"),
  // OBSERVING | TESTING | READY | APPROVED | ACTIVE | REJECTED | ROLLBACK
  status:                text("status").notNull().default("OBSERVING"),
  rejectionReason:       text("rejection_reason"),
  approvedBy:            text("approved_by"),
  sampleCountAtDecision: integer("sample_count_at_decision"),
  createdAt:             timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  approvedAt:            timestamp("approved_at", { withTimezone: true }),
  appliedAt:             timestamp("applied_at", { withTimezone: true }),
  rolledBackAt:          timestamp("rolled_back_at", { withTimezone: true }),
});

export type TuningProposal = typeof tuningProposals.$inferSelect;
export type InsertTuningProposal = typeof tuningProposals.$inferInsert;

// ─── Grid Isolated Professional Engine ──────────────────────────────

export const gridIsolatedConfigs = pgTable("grid_isolated_configs", {
  id:                      serial("id").primaryKey(),
  pair:                    text("pair").notNull().default("BTC/USD"),
  mode:                    text("mode").notNull().default("OFF"),
  capitalProfile:          text("capital_profile").notNull().default("balanced"),
  executionPolicy:         text("execution_policy").notNull().default("MAKER_FIRST_THEN_LIMIT_TAKER_FALLBACK"),
  netProfitTargetPct:      decimal("net_profit_target_pct", { precision: 6, scale: 3 }).notNull().default("0.500"),
  bandPeriod:              integer("band_period").notNull().default(20),
  bandStdDevMultiplier:    decimal("band_std_dev_multiplier", { precision: 4, scale: 2 }).notNull().default("2.00"),
  atrPeriod:               integer("atr_period").notNull().default(14),
  atrTimeframe:            text("atr_timeframe").notNull().default("1h"),
  gridStepAtrMultiplier:   decimal("grid_step_atr_multiplier", { precision: 4, scale: 2 }).notNull().default("1.50"),
  gridStepMinPct:          decimal("grid_step_min_pct", { precision: 6, scale: 3 }).notNull().default("0.150"),
  gridStepMaxPct:          decimal("grid_step_max_pct", { precision: 6, scale: 3 }).notNull().default("3.000"),
  geometricRatioMin:       decimal("geometric_ratio_min", { precision: 4, scale: 3 }).notNull().default("0.800"),
  geometricRatioMax:       decimal("geometric_ratio_max", { precision: 4, scale: 3 }).notNull().default("1.200"),
  trailingActivationPct:   decimal("trailing_activation_pct", { precision: 6, scale: 3 }).notNull().default("1.000"),
  trailingStopPct:         decimal("trailing_stop_pct", { precision: 6, scale: 3 }).notNull().default("0.400"),
  stopLossSoftPct:         decimal("stop_loss_soft_pct", { precision: 6, scale: 3 }).notNull().default("2.000"),
  stopLossHardPct:         decimal("stop_loss_hard_pct", { precision: 6, scale: 3 }).notNull().default("5.000"),
  stopLossEmergencyPct:    decimal("stop_loss_emergency_pct", { precision: 6, scale: 3 }).notNull().default("10.000"),
  hodlRecoveryEnabled:     boolean("hodl_recovery_enabled").notNull().default(true),
  pumpGuardDeviationPct:   decimal("pump_guard_deviation_pct", { precision: 6, scale: 3 }).notNull().default("3.000"),
  pumpGuardVolumeSpikeRatio: decimal("pump_guard_volume_spike_ratio", { precision: 6, scale: 2 }).notNull().default("3.00"),
  pumpGuardCooldownMinutes: integer("pump_guard_cooldown_minutes").notNull().default(30),
  dumpGuardDeviationPct:   decimal("dump_guard_deviation_pct", { precision: 6, scale: 3 }).notNull().default("3.000"),
  dumpGuardVolumeSpikeRatio: decimal("dump_guard_volume_spike_ratio", { precision: 6, scale: 2 }).notNull().default("3.00"),
  dumpGuardCooldownMinutes: integer("dump_guard_cooldown_minutes").notNull().default(30),
  maxOpenCycles:           integer("max_open_cycles").notNull().default(10),
  maxDailyOrders:          integer("max_daily_orders").notNull().default(300),
  fiscalStatus:            text("fiscal_status").notNull().default("pending"),
  isActive:                boolean("is_active").notNull().default(false),
  createdAt:               timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:               timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type GridIsolatedConfigRow = typeof gridIsolatedConfigs.$inferSelect;
export type InsertGridIsolatedConfig = typeof gridIsolatedConfigs.$inferInsert;

export const gridRangeVersions = pgTable("grid_range_versions", {
  id:                      text("id").primaryKey(),
  versionNumber:           integer("version_number").notNull(),
  pair:                    text("pair").notNull().default("BTC/USD"),
  status:                  text("status").notNull().default("proposed"),
  midPrice:                decimal("mid_price", { precision: 18, scale: 8 }).notNull(),
  upperPrice:              decimal("upper_price", { precision: 18, scale: 8 }).notNull(),
  lowerPrice:              decimal("lower_price", { precision: 18, scale: 8 }).notNull(),
  bandUpper:               decimal("band_upper", { precision: 18, scale: 8 }).notNull(),
  bandMiddle:              decimal("band_middle", { precision: 18, scale: 8 }).notNull(),
  bandLower:               decimal("band_lower", { precision: 18, scale: 8 }).notNull(),
  bandWidthPct:            decimal("band_width_pct", { precision: 8, scale: 4 }).notNull(),
  atrPct:                  decimal("atr_pct", { precision: 8, scale: 4 }).notNull(),
  regime:                  text("regime").notNull(),
  levelsCount:             integer("levels_count").notNull(),
  geometricRatio:          decimal("geometric_ratio", { precision: 6, scale: 4 }).notNull(),
  capitalBudgetUsd:        decimal("capital_budget_usd", { precision: 18, scale: 2 }).notNull(),
  capitalPerLevelUsd:      decimal("capital_per_level_usd", { precision: 18, scale: 2 }).notNull(),
  netProfitTargetPct:      decimal("net_profit_target_pct", { precision: 6, scale: 3 }).notNull(),
  createdAt:               timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  activatedAt:             timestamp("activated_at", { withTimezone: true }),
  closedAt:                timestamp("closed_at", { withTimezone: true }),
});

export type GridRangeVersionRow = typeof gridRangeVersions.$inferSelect;
export type InsertGridRangeVersion = typeof gridRangeVersions.$inferInsert;

export const gridIsolatedLevels = pgTable("grid_isolated_levels", {
  id:                      text("id").primaryKey(),
  rangeVersionId:          text("range_version_id").notNull(),
  levelIndex:              integer("level_index").notNull(),
  side:                    text("side").notNull(),
  price:                   decimal("price", { precision: 18, scale: 8 }).notNull(),
  notionalUsd:             decimal("notional_usd", { precision: 18, scale: 2 }).notNull(),
  quantity:                decimal("quantity", { precision: 18, scale: 8 }).notNull(),
  status:                  text("status").notNull().default("planned"),
  filledQuantity:          decimal("filled_quantity", { precision: 18, scale: 8 }).notNull().default("0"),
  filledPrice:             decimal("filled_price", { precision: 18, scale: 8 }),
  clientOrderId:           text("client_order_id").notNull().unique(),
  exchangeOrderId:         text("exchange_order_id"),
  postOnlyAttempts:        integer("post_only_attempts").notNull().default(0),
  usedTakerFallback:       boolean("used_taker_fallback").notNull().default(false),
  netProfitTargetUsd:      decimal("net_profit_target_usd", { precision: 18, scale: 8 }).notNull().default("0"),
  feeEstimateUsd:          decimal("fee_estimate_usd", { precision: 18, scale: 8 }).notNull().default("0"),
  taxReserveUsd:           decimal("tax_reserve_usd", { precision: 18, scale: 8 }).notNull().default("0"),
  createdAt:               timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  placedAt:                timestamp("placed_at", { withTimezone: true }),
  filledAt:                timestamp("filled_at", { withTimezone: true }),
  cancelledAt:             timestamp("cancelled_at", { withTimezone: true }),
});

export type GridIsolatedLevelRow = typeof gridIsolatedLevels.$inferSelect;
export type InsertGridIsolatedLevel = typeof gridIsolatedLevels.$inferInsert;

export const gridIsolatedCycles = pgTable("grid_isolated_cycles", {
  id:                      text("id").primaryKey(),
  rangeVersionId:          text("range_version_id").notNull(),
  cycleNumber:             integer("cycle_number").notNull(),
  pair:                    text("pair").notNull().default("BTC/USD"),
  status:                  text("status").notNull().default("pending"),
  buyLevelId:              text("buy_level_id"),
  sellLevelId:             text("sell_level_id"),
  buyPrice:                decimal("buy_price", { precision: 18, scale: 8 }),
  sellPrice:               decimal("sell_price", { precision: 18, scale: 8 }),
  quantity:                decimal("quantity", { precision: 18, scale: 8 }).notNull(),
  grossPnlUsd:             decimal("gross_pnl_usd", { precision: 18, scale: 8 }).notNull().default("0"),
  feeTotalUsd:             decimal("fee_total_usd", { precision: 18, scale: 8 }).notNull().default("0"),
  taxReserveUsd:           decimal("tax_reserve_usd", { precision: 18, scale: 8 }).notNull().default("0"),
  netPnlUsd:               decimal("net_pnl_usd", { precision: 18, scale: 8 }).notNull().default("0"),
  netPnlPct:               decimal("net_pnl_pct", { precision: 10, scale: 4 }).notNull().default("0"),
  buyClientOrderId:        text("buy_client_order_id"),
  sellClientOrderId:       text("sell_client_order_id"),
  buyFilledAt:             timestamp("buy_filled_at", { withTimezone: true }),
  sellFilledAt:            timestamp("sell_filled_at", { withTimezone: true }),
  holdTimeMinutes:         integer("hold_time_minutes"),
  createdAt:               timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt:             timestamp("completed_at", { withTimezone: true }),
});

export type GridIsolatedCycleRow = typeof gridIsolatedCycles.$inferSelect;
export type InsertGridIsolatedCycle = typeof gridIsolatedCycles.$inferInsert;

export const gridIsolatedEvents = pgTable("grid_isolated_events", {
  id:                      bigserial("id", { mode: "number" }).primaryKey(),
  eventType:               text("event_type").notNull(),
  pair:                    text("pair").notNull().default("BTC/USD"),
  rangeVersionId:          text("range_version_id"),
  levelId:                 text("level_id"),
  cycleId:                 text("cycle_id"),
  mode:                    text("mode").notNull(),
  message:                 text("message").notNull(),
  metadataJson:            jsonb("metadata_json"),
  createdAt:               timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type GridIsolatedEventRow = typeof gridIsolatedEvents.$inferSelect;
export type InsertGridIsolatedEvent = typeof gridIsolatedEvents.$inferInsert;

export const gridIsolatedMetricsSnapshots = pgTable("grid_isolated_metrics_snapshots", {
  id:                      bigserial("id", { mode: "number" }).primaryKey(),
  pair:                    text("pair").notNull().default("BTC/USD"),
  mode:                    text("mode").notNull(),
  activeRangeVersionId:    text("active_range_version_id"),
  openLevels:              integer("open_levels").notNull().default(0),
  openCycles:              integer("open_cycles").notNull().default(0),
  dailyOrderCount:         integer("daily_order_count").notNull().default(0),
  circuitBreakerOpen:      boolean("circuit_breaker_open").notNull().default(false),
  pumpDumpState:           text("pump_dump_state").notNull().default("normal"),
  capitalReservedUsd:      decimal("capital_reserved_usd", { precision: 18, scale: 2 }).notNull().default("0"),
  capitalAvailableUsd:     decimal("capital_available_usd", { precision: 18, scale: 2 }).notNull().default("0"),
  totalNetPnlUsd:          decimal("total_net_pnl_usd", { precision: 18, scale: 8 }).notNull().default("0"),
  totalCyclesCompleted:    integer("total_cycles_completed").notNull().default(0),
  capturedAt:              timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
});

export type GridIsolatedMetricsSnapshotRow = typeof gridIsolatedMetricsSnapshots.$inferSelect;
export type InsertGridIsolatedMetricsSnapshot = typeof gridIsolatedMetricsSnapshots.$inferInsert;

export const gridIsolatedBacktests = pgTable("grid_isolated_backtests", {
  id:                      bigserial("id", { mode: "number" }).primaryKey(),
  pair:                    text("pair").notNull().default("BTC/USD"),
  startDate:               timestamp("start_date", { withTimezone: true }).notNull(),
  endDate:                 timestamp("end_date", { withTimezone: true }).notNull(),
  timeframe:               text("timeframe").notNull().default("1h"),
  initialCapitalUsd:       decimal("initial_capital_usd", { precision: 18, scale: 2 }).notNull(),
  fillModel:               text("fill_model").notNull().default("realistic"),
  variantsJson:            jsonb("variants_json").notNull(),
  resultsJson:             jsonb("results_json").notNull(),
  createdAt:               timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type GridIsolatedBacktestRow = typeof gridIsolatedBacktests.$inferSelect;
export type InsertGridIsolatedBacktest = typeof gridIsolatedBacktests.$inferInsert;

export const strategyCapitalReservations = pgTable("strategy_capital_reservations", {
  id:                      text("id").primaryKey(),
  strategyType:            text("strategy_type").notNull(),
  pair:                    text("pair").notNull(),
  reservedUsd:             decimal("reserved_usd", { precision: 18, scale: 2 }).notNull(),
  availableUsd:            decimal("available_usd", { precision: 18, scale: 2 }).notNull(),
  reservedAt:              timestamp("reserved_at", { withTimezone: true }).notNull().defaultNow(),
  releasedAt:              timestamp("released_at", { withTimezone: true }),
  reason:                  text("reason").notNull(),
});

export type StrategyCapitalReservationRow = typeof strategyCapitalReservations.$inferSelect;
export type InsertStrategyCapitalReservation = typeof strategyCapitalReservations.$inferInsert;

export const exchangeBalanceSnapshots = pgTable("exchange_balance_snapshots", {
  id:                      bigserial("id", { mode: "number" }).primaryKey(),
  exchange:                text("exchange").notNull(),
  pair:                    text("pair").notNull().default("BTC/USD"),
  strategyType:            text("strategy_type").notNull(),
  balanceUsd:              decimal("balance_usd", { precision: 18, scale: 8 }),
  balanceBtc:              decimal("balance_btc", { precision: 18, scale: 8 }),
  openOrdersCount:         integer("open_orders_count").notNull().default(0),
  snapshotAt:              timestamp("snapshot_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ExchangeBalanceSnapshotRow = typeof exchangeBalanceSnapshots.$inferSelect;
export type InsertExchangeBalanceSnapshot = typeof exchangeBalanceSnapshots.$inferInsert;
