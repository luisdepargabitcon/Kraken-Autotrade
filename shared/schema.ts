import { sql } from "drizzle-orm";
import { pgTable, text, varchar, serial, timestamp, decimal, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const botConfig = pgTable("bot_config", {
  id: serial("id").primaryKey(),
  isActive: boolean("is_active").notNull().default(false),
  strategy: text("strategy").notNull().default("momentum"),
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
  openedAt: timestamp("opened_at").notNull().defaultNow(),
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

export type BotConfig = typeof botConfig.$inferSelect;
export type Trade = typeof trades.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type MarketData = typeof marketData.$inferSelect;
export type ApiConfig = typeof apiConfig.$inferSelect;
export type TelegramChat = typeof telegramChats.$inferSelect;
export type BotEvent = typeof botEvents.$inferSelect;
export type OpenPosition = typeof openPositions.$inferSelect;

export type InsertBotConfig = z.infer<typeof insertBotConfigSchema>;
export type InsertTrade = z.infer<typeof insertTradeSchema>;
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type InsertMarketData = z.infer<typeof insertMarketDataSchema>;
export type InsertApiConfig = z.infer<typeof insertApiConfigSchema>;
export type InsertTelegramChat = z.infer<typeof insertTelegramChatSchema>;
export type InsertBotEvent = z.infer<typeof insertBotEventSchema>;
export type InsertOpenPosition = z.infer<typeof insertOpenPositionSchema>;
