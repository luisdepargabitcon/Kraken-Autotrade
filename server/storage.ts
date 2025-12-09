import { 
  type BotConfig, 
  type Trade, 
  type Notification, 
  type MarketData,
  type ApiConfig,
  type InsertBotConfig,
  type InsertTrade,
  type InsertNotification,
  type InsertMarketData,
  type InsertApiConfig,
  botConfig as botConfigTable,
  trades as tradesTable,
  notifications as notificationsTable,
  marketData as marketDataTable,
  apiConfig as apiConfigTable
} from "@shared/schema";
import { db } from "./db";
import { eq, desc } from "drizzle-orm";

export interface IStorage {
  getBotConfig(): Promise<BotConfig | undefined>;
  updateBotConfig(config: Partial<InsertBotConfig>): Promise<BotConfig>;
  
  getApiConfig(): Promise<ApiConfig | undefined>;
  updateApiConfig(config: Partial<InsertApiConfig>): Promise<ApiConfig>;
  
  createTrade(trade: InsertTrade): Promise<Trade>;
  getTrades(limit?: number): Promise<Trade[]>;
  updateTradeStatus(tradeId: string, status: string, krakenOrderId?: string): Promise<void>;
  
  createNotification(notification: InsertNotification): Promise<Notification>;
  getUnsentNotifications(): Promise<Notification[]>;
  markNotificationSent(id: number): Promise<void>;
  
  saveMarketData(data: InsertMarketData): Promise<MarketData>;
  getLatestMarketData(pair: string): Promise<MarketData | undefined>;
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
}

export const storage = new DatabaseStorage();
