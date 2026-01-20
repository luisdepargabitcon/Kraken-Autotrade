import { sql } from "drizzle-orm";
import { pgTable, text, varchar, serial, timestamp, decimal, boolean, integer, jsonb, unique } from "drizzle-orm/pg-core";
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
  sgTrailDistancePct: decimal("sg_trail_distance_pct", { precision: 5, scale: 2 }).notNull().default("1.50"),
  sgTrailStepPct: decimal("sg_trail_step_pct", { precision: 5, scale: 2 }).notNull().default("0.25"),
  sgTpFixedEnabled: boolean("sg_tp_fixed_enabled").notNull().default(false),
  sgTpFixedPct: decimal("sg_tp_fixed_pct", { precision: 5, scale: 2 }).notNull().default("10.00"),
  sgScaleOutEnabled: boolean("sg_scale_out_enabled").notNull().default(false),
  sgScaleOutPct: decimal("sg_scale_out_pct", { precision: 5, scale: 2 }).notNull().default("35.00"),
  sgMinPartUsd: decimal("sg_min_part_usd", { precision: 10, scale: 2 }).notNull().default("50.00"),
  sgScaleOutThreshold: decimal("sg_scale_out_threshold", { precision: 5, scale: 2 }).notNull().default("80.00"),
  sgMaxOpenLotsPerPair: integer("sg_max_open_lots_per_pair").notNull().default(1),
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

export const trades = pgTable("trades", {
  id: serial("id").primaryKey(),
  tradeId: text("trade_id").notNull(),
  exchange: text("exchange").notNull().default("kraken"),
  origin: text("origin").notNull().default("sync"),
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

export const alertPreferencesSchema = z.object({
  trade_buy: z.boolean().optional(),
  trade_sell: z.boolean().optional(),
  trade_breakeven: z.boolean().optional(),
  trade_trailing: z.boolean().optional(),
  trade_stoploss: z.boolean().optional(),
  trade_takeprofit: z.boolean().optional(),
  trade_daily_pnl: z.boolean().optional(),
  strategy_regime_change: z.boolean().optional(),
  strategy_router_transition: z.boolean().optional(),
  system_bot_started: z.boolean().optional(),
  system_bot_paused: z.boolean().optional(),
  error_api: z.boolean().optional(),
  error_nonce: z.boolean().optional(),
  balance_exposure: z.boolean().optional(),
  heartbeat_periodic: z.boolean().optional(),
});

export type AlertPreferences = z.infer<typeof alertPreferencesSchema>;

export const botEvents = pgTable("bot_events", {
  id: serial("id").primaryKey(),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
  level: text("level").notNull(),
  type: text("type").notNull(),
  message: text("message").notNull(),
  meta: text("meta"),
});

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
  openedAt: timestamp("opened_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Trade fills from Kraken (granular level for partial fills)
export const tradeFills = pgTable("trade_fills", {
  id: serial("id").primaryKey(),
  txid: text("txid").notNull().unique(), // Kraken fill txid (UNIQUE para evitar duplicados)
  orderId: text("order_id").notNull(), // Kraken ordertxid (puede tener múltiples fills)
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
export const insertTelegramChatSchema = createInsertSchema(telegramChats).omit({ id: true, createdAt: true });
export const insertBotEventSchema = createInsertSchema(botEvents).omit({ id: true, timestamp: true });
export const insertOpenPositionSchema = createInsertSchema(openPositions).omit({ id: true, openedAt: true, updatedAt: true });
export const insertAiTradeSampleSchema = createInsertSchema(aiTradeSamples).omit({ id: true, createdAt: true });
export const insertAiShadowDecisionSchema = createInsertSchema(aiShadowDecisions).omit({ id: true, ts: true });
export const insertAiConfigSchema = createInsertSchema(aiConfig).omit({ id: true, updatedAt: true });
export const insertTrainingTradeSchema = createInsertSchema(trainingTrades).omit({ id: true, createdAt: true });
export const insertTradeFillSchema = createInsertSchema(tradeFills).omit({ id: true, createdAt: true });
export const insertLotMatchSchema = createInsertSchema(lotMatches).omit({ id: true, createdAt: true });
export const insertRegimeStateSchema = createInsertSchema(regimeState).omit({ updatedAt: true });

export type BotConfig = typeof botConfig.$inferSelect;
export type Trade = typeof trades.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type MarketData = typeof marketData.$inferSelect;
export type ApiConfig = typeof apiConfig.$inferSelect;
export type TelegramChat = typeof telegramChats.$inferSelect;
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
export type InsertTelegramChat = z.infer<typeof insertTelegramChatSchema>;
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
