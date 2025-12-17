import { sql } from "drizzle-orm";
import { pgTable, text, varchar, serial, timestamp, decimal, boolean, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

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
  riskPerTradePct: decimal("risk_per_trade_pct", { precision: 5, scale: 2 }).notNull().default("15.00"),
  tradingHoursEnabled: boolean("trading_hours_enabled").notNull().default(true),
  tradingHoursStart: decimal("trading_hours_start", { precision: 2, scale: 0 }).notNull().default("8"),
  tradingHoursEnd: decimal("trading_hours_end", { precision: 2, scale: 0 }).notNull().default("22"),
  positionMode: text("position_mode").notNull().default("SINGLE"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const apiConfig = pgTable("api_config", {
  id: serial("id").primaryKey(),
  krakenApiKey: text("kraken_api_key"),
  krakenApiSecret: text("kraken_api_secret"),
  krakenConnected: boolean("kraken_connected").notNull().default(false),
  telegramToken: text("telegram_token"),
  telegramChatId: text("telegram_chat_id"),
  telegramConnected: boolean("telegram_connected").notNull().default(false),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const trades = pgTable("trades", {
  id: serial("id").primaryKey(),
  tradeId: text("trade_id").notNull().unique(),
  pair: text("pair").notNull(),
  type: text("type").notNull(),
  price: decimal("price", { precision: 18, scale: 8 }).notNull(),
  amount: decimal("amount", { precision: 18, scale: 8 }).notNull(),
  status: text("status").notNull().default("pending"),
  krakenOrderId: text("kraken_order_id"),
  entryPrice: decimal("entry_price", { precision: 18, scale: 8 }),
  realizedPnlUsd: decimal("realized_pnl_usd", { precision: 18, scale: 8 }),
  realizedPnlPct: decimal("realized_pnl_pct", { precision: 10, scale: 4 }),
  executedAt: timestamp("executed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

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
  alertTrades: boolean("alert_trades").notNull().default(true),
  alertErrors: boolean("alert_errors").notNull().default(true),
  alertSystem: boolean("alert_system").notNull().default(true),
  alertBalance: boolean("alert_balance").notNull().default(false),
  alertHeartbeat: boolean("alert_heartbeat").notNull().default(true),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

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
  pair: text("pair").notNull().unique(),
  entryPrice: decimal("entry_price", { precision: 18, scale: 8 }).notNull(),
  amount: decimal("amount", { precision: 18, scale: 8 }).notNull(),
  highestPrice: decimal("highest_price", { precision: 18, scale: 8 }).notNull(),
  tradeId: text("trade_id"),
  krakenOrderId: text("kraken_order_id"),
  entryStrategyId: text("entry_strategy_id").notNull().default("momentum_cycle"),
  entrySignalTf: text("entry_signal_tf").notNull().default("cycle"),
  signalConfidence: decimal("signal_confidence", { precision: 5, scale: 2 }),
  signalReason: text("signal_reason"),
  entryMode: text("entry_mode"),
  configSnapshotJson: jsonb("config_snapshot_json"),
  openedAt: timestamp("opened_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

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
  buyTxid: text("buy_txid").notNull(),
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

export type BotConfig = typeof botConfig.$inferSelect;
export type Trade = typeof trades.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type MarketData = typeof marketData.$inferSelect;
export type ApiConfig = typeof apiConfig.$inferSelect;
export type TelegramChat = typeof telegramChats.$inferSelect;
export type BotEvent = typeof botEvents.$inferSelect;
export type OpenPosition = typeof openPositions.$inferSelect;
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
export type InsertAiTradeSample = z.infer<typeof insertAiTradeSampleSchema>;
export type InsertAiShadowDecision = z.infer<typeof insertAiShadowDecisionSchema>;
export type InsertAiConfig = z.infer<typeof insertAiConfigSchema>;
export type InsertTrainingTrade = z.infer<typeof insertTrainingTradeSchema>;
