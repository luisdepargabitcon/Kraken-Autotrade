import { 
  type BotConfig, 
  type Trade, 
  type Notification, 
  type MarketData,
  type ApiConfig,
  type TelegramChat,
  type OpenPosition,
  type InsertBotConfig,
  type InsertTrade,
  type InsertNotification,
  type InsertMarketData,
  type InsertApiConfig,
  type InsertTelegramChat,
  type InsertOpenPosition,
  botConfig as botConfigTable,
  trades as tradesTable,
  notifications as notificationsTable,
  marketData as marketDataTable,
  apiConfig as apiConfigTable,
  telegramChats as telegramChatsTable,
  openPositions as openPositionsTable
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, gt, lt, sql } from "drizzle-orm";

export interface IStorage {
  getBotConfig(): Promise<BotConfig | undefined>;
  updateBotConfig(config: Partial<InsertBotConfig>): Promise<BotConfig>;
  
  getApiConfig(): Promise<ApiConfig | undefined>;
  updateApiConfig(config: Partial<InsertApiConfig>): Promise<ApiConfig>;
  
  createTrade(trade: InsertTrade): Promise<Trade>;
  getTrades(limit?: number): Promise<Trade[]>;
  getClosedTrades(options: { limit?: number; offset?: number; pair?: string; result?: 'winner' | 'loser' | 'all'; type?: 'all' | 'buy' | 'sell' }): Promise<{ trades: Trade[]; total: number }>;
  updateTradeStatus(tradeId: string, status: string, krakenOrderId?: string): Promise<void>;
  
  createNotification(notification: InsertNotification): Promise<Notification>;
  getUnsentNotifications(): Promise<Notification[]>;
  markNotificationSent(id: number): Promise<void>;
  
  saveMarketData(data: InsertMarketData): Promise<MarketData>;
  getLatestMarketData(pair: string): Promise<MarketData | undefined>;
  
  getTelegramChats(): Promise<TelegramChat[]>;
  getActiveTelegramChats(): Promise<TelegramChat[]>;
  createTelegramChat(chat: InsertTelegramChat): Promise<TelegramChat>;
  updateTelegramChat(id: number, chat: Partial<InsertTelegramChat>): Promise<TelegramChat>;
  deleteTelegramChat(id: number): Promise<void>;
  
  getOpenPositions(): Promise<OpenPosition[]>;
  getOpenPosition(pair: string): Promise<OpenPosition | undefined>;
  saveOpenPosition(position: InsertOpenPosition): Promise<OpenPosition>;
  updateOpenPosition(pair: string, updates: Partial<InsertOpenPosition>): Promise<OpenPosition | undefined>;
  deleteOpenPosition(pair: string): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getBotConfig(): Promise<BotConfig | undefined> {
    const configs = await db.select().from(botConfigTable).limit(1);
    if (configs.length === 0) {
      const [newConfig] = await db.insert(botConfigTable).values({}).returning();
      return newConfig;
    }
    return configs[0];
  }

  async updateBotConfig(config: Partial<InsertBotConfig>): Promise<BotConfig> {
    const existing = await this.getBotConfig();
    if (!existing) {
      const [newConfig] = await db.insert(botConfigTable).values(config as InsertBotConfig).returning();
      return newConfig;
    }
    const [updated] = await db.update(botConfigTable)
      .set({ ...config, updatedAt: new Date() })
      .where(eq(botConfigTable.id, existing.id))
      .returning();
    return updated;
  }

  async getApiConfig(): Promise<ApiConfig | undefined> {
    const configs = await db.select().from(apiConfigTable).limit(1);
    if (configs.length === 0) {
      const [newConfig] = await db.insert(apiConfigTable).values({}).returning();
      return newConfig;
    }
    return configs[0];
  }

  async updateApiConfig(config: Partial<InsertApiConfig>): Promise<ApiConfig> {
    const existing = await this.getApiConfig();
    if (!existing) {
      const [newConfig] = await db.insert(apiConfigTable).values(config as InsertApiConfig).returning();
      return newConfig;
    }
    const [updated] = await db.update(apiConfigTable)
      .set({ ...config, updatedAt: new Date() })
      .where(eq(apiConfigTable.id, existing.id))
      .returning();
    return updated;
  }

  async createTrade(trade: InsertTrade): Promise<Trade> {
    const [newTrade] = await db.insert(tradesTable).values(trade).returning();
    return newTrade;
  }

  async getTrades(limit: number = 50): Promise<Trade[]> {
    return await db.select().from(tradesTable).orderBy(desc(tradesTable.createdAt)).limit(limit);
  }

  async getClosedTrades(options: { limit?: number; offset?: number; pair?: string; result?: 'winner' | 'loser' | 'all'; type?: 'all' | 'buy' | 'sell' }): Promise<{ trades: Trade[]; total: number }> {
    const { limit = 10, offset = 0, pair, result = 'all', type = 'all' } = options;
    
    const conditions: any[] = [];
    
    if (type !== 'all') {
      conditions.push(eq(tradesTable.type, type));
    }
    
    if (pair) {
      conditions.push(eq(tradesTable.pair, pair));
    }
    
    if (result === 'winner') {
      conditions.push(gt(tradesTable.realizedPnlUsd, '0'));
    } else if (result === 'loser') {
      conditions.push(lt(tradesTable.realizedPnlUsd, '0'));
    }
    
    const whereClause = conditions.length > 0 ? (conditions.length === 1 ? conditions[0] : and(...conditions)) : undefined;
    
    const tradesQuery = db.select().from(tradesTable)
      .orderBy(desc(tradesTable.executedAt))
      .limit(limit)
      .offset(offset);
    
    const countQuery = db.select({ count: sql<number>`count(*)` }).from(tradesTable);
    
    const trades = whereClause ? await tradesQuery.where(whereClause) : await tradesQuery;
    const countResult = whereClause ? await countQuery.where(whereClause) : await countQuery;
    
    return { trades, total: Number(countResult[0]?.count || 0) };
  }

  async updateTradeStatus(tradeId: string, status: string, krakenOrderId?: string): Promise<void> {
    await db.update(tradesTable)
      .set({ status, krakenOrderId, executedAt: new Date() })
      .where(eq(tradesTable.tradeId, tradeId));
  }

  async createNotification(notification: InsertNotification): Promise<Notification> {
    const [newNotification] = await db.insert(notificationsTable).values(notification).returning();
    return newNotification;
  }

  async getUnsentNotifications(): Promise<Notification[]> {
    return await db.select().from(notificationsTable)
      .where(eq(notificationsTable.telegramSent, false))
      .orderBy(desc(notificationsTable.createdAt));
  }

  async markNotificationSent(id: number): Promise<void> {
    await db.update(notificationsTable)
      .set({ telegramSent: true, sentAt: new Date() })
      .where(eq(notificationsTable.id, id));
  }

  async saveMarketData(data: InsertMarketData): Promise<MarketData> {
    const [newData] = await db.insert(marketDataTable).values(data).returning();
    return newData;
  }

  async getLatestMarketData(pair: string): Promise<MarketData | undefined> {
    const data = await db.select().from(marketDataTable)
      .where(eq(marketDataTable.pair, pair))
      .orderBy(desc(marketDataTable.timestamp))
      .limit(1);
    return data[0];
  }

  async getTelegramChats(): Promise<TelegramChat[]> {
    return await db.select().from(telegramChatsTable).orderBy(desc(telegramChatsTable.createdAt));
  }

  async getActiveTelegramChats(): Promise<TelegramChat[]> {
    return await db.select().from(telegramChatsTable)
      .where(eq(telegramChatsTable.isActive, true))
      .orderBy(desc(telegramChatsTable.createdAt));
  }

  async createTelegramChat(chat: InsertTelegramChat): Promise<TelegramChat> {
    const [newChat] = await db.insert(telegramChatsTable).values(chat).returning();
    return newChat;
  }

  async updateTelegramChat(id: number, chat: Partial<InsertTelegramChat>): Promise<TelegramChat> {
    const [updated] = await db.update(telegramChatsTable)
      .set(chat)
      .where(eq(telegramChatsTable.id, id))
      .returning();
    return updated;
  }

  async deleteTelegramChat(id: number): Promise<void> {
    await db.delete(telegramChatsTable).where(eq(telegramChatsTable.id, id));
  }

  async getOpenPositions(): Promise<OpenPosition[]> {
    return await db.select().from(openPositionsTable);
  }

  async getOpenPosition(pair: string): Promise<OpenPosition | undefined> {
    const positions = await db.select().from(openPositionsTable)
      .where(eq(openPositionsTable.pair, pair))
      .limit(1);
    return positions[0];
  }

  async saveOpenPosition(position: InsertOpenPosition): Promise<OpenPosition> {
    const existing = await this.getOpenPosition(position.pair);
    if (existing) {
      const [updated] = await db.update(openPositionsTable)
        .set({ ...position, updatedAt: new Date() })
        .where(eq(openPositionsTable.pair, position.pair))
        .returning();
      return updated;
    }
    const [newPosition] = await db.insert(openPositionsTable).values(position).returning();
    return newPosition;
  }

  async updateOpenPosition(pair: string, updates: Partial<InsertOpenPosition>): Promise<OpenPosition | undefined> {
    const [updated] = await db.update(openPositionsTable)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(openPositionsTable.pair, pair))
      .returning();
    return updated;
  }

  async deleteOpenPosition(pair: string): Promise<void> {
    await db.delete(openPositionsTable).where(eq(openPositionsTable.pair, pair));
  }
}

export const storage = new DatabaseStorage();
