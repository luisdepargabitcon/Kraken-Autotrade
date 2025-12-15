import { 
  type BotConfig, 
  type Trade, 
  type Notification, 
  type MarketData,
  type ApiConfig,
  type TelegramChat,
  type OpenPosition,
  type AiTradeSample,
  type AiShadowDecision,
  type AiConfig,
  type TrainingTrade,
  type InsertBotConfig,
  type InsertTrade,
  type InsertNotification,
  type InsertMarketData,
  type InsertApiConfig,
  type InsertTelegramChat,
  type InsertOpenPosition,
  type InsertAiTradeSample,
  type InsertAiShadowDecision,
  type InsertAiConfig,
  type InsertTrainingTrade,
  botConfig as botConfigTable,
  trades as tradesTable,
  notifications as notificationsTable,
  marketData as marketDataTable,
  apiConfig as apiConfigTable,
  telegramChats as telegramChatsTable,
  openPositions as openPositionsTable,
  aiTradeSamples as aiTradeSamplesTable,
  aiShadowDecisions as aiShadowDecisionsTable,
  aiConfig as aiConfigTable,
  trainingTrades as trainingTradesTable
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, gt, lt, sql, isNull } from "drizzle-orm";

export interface IStorage {
  getBotConfig(): Promise<BotConfig | undefined>;
  updateBotConfig(config: Partial<InsertBotConfig>): Promise<BotConfig>;
  
  getApiConfig(): Promise<ApiConfig | undefined>;
  updateApiConfig(config: Partial<InsertApiConfig>): Promise<ApiConfig>;
  
  createTrade(trade: InsertTrade): Promise<Trade>;
  getTrades(limit?: number): Promise<Trade[]>;
  getClosedTrades(options: { limit?: number; offset?: number; pair?: string; result?: 'winner' | 'loser' | 'all'; type?: 'all' | 'buy' | 'sell' }): Promise<{ trades: Trade[]; total: number }>;
  updateTradeStatus(tradeId: string, status: string, krakenOrderId?: string): Promise<void>;
  getTradeByKrakenOrderId(krakenOrderId: string): Promise<Trade | undefined>;
  
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
  
  saveAiSample(sample: InsertAiTradeSample): Promise<AiTradeSample>;
  updateAiSample(sampleId: number, updates: Partial<InsertAiTradeSample>): Promise<AiTradeSample | undefined>;
  getAiSamples(options?: { complete?: boolean; limit?: number }): Promise<AiTradeSample[]>;
  getAiSamplesCount(complete?: boolean): Promise<number>;
  
  saveAiShadowDecision(decision: InsertAiShadowDecision): Promise<AiShadowDecision>;
  updateAiShadowFinalPnl(tradeId: string, pnl: string): Promise<void>;
  getAiShadowReport(): Promise<{ total: number; blocked: number; blockedLosers: number; passedLosers: number }>;
  
  getAiConfig(): Promise<AiConfig | undefined>;
  updateAiConfig(config: Partial<InsertAiConfig>): Promise<AiConfig>;
  
  saveTrainingTrade(trade: InsertTrainingTrade): Promise<TrainingTrade>;
  updateTrainingTrade(id: number, updates: Partial<InsertTrainingTrade>): Promise<TrainingTrade | undefined>;
  getTrainingTradeByBuyTxid(buyTxid: string): Promise<TrainingTrade | undefined>;
  getTrainingTrades(options?: { closed?: boolean; labeled?: boolean; limit?: number }): Promise<TrainingTrade[]>;
  getTrainingTradesCount(options?: { closed?: boolean; labeled?: boolean }): Promise<number>;
  getAllTradesForBackfill(): Promise<Trade[]>;
  runTrainingTradesBackfill(): Promise<{ created: number; closed: number; labeled: number; discardReasons: Record<string, number> }>;
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

  async getTradeByKrakenOrderId(krakenOrderId: string): Promise<Trade | undefined> {
    const trades = await db.select().from(tradesTable)
      .where(eq(tradesTable.krakenOrderId, krakenOrderId))
      .limit(1);
    return trades[0];
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

  async saveAiSample(sample: InsertAiTradeSample): Promise<AiTradeSample> {
    const [newSample] = await db.insert(aiTradeSamplesTable).values(sample).returning();
    return newSample;
  }

  async updateAiSample(sampleId: number, updates: Partial<InsertAiTradeSample>): Promise<AiTradeSample | undefined> {
    const [updated] = await db.update(aiTradeSamplesTable)
      .set(updates)
      .where(eq(aiTradeSamplesTable.id, sampleId))
      .returning();
    return updated;
  }

  async getAiSamples(options?: { complete?: boolean; limit?: number }): Promise<AiTradeSample[]> {
    const { complete, limit = 1000 } = options || {};
    if (complete !== undefined) {
      return await db.select().from(aiTradeSamplesTable)
        .where(eq(aiTradeSamplesTable.isComplete, complete))
        .orderBy(desc(aiTradeSamplesTable.createdAt))
        .limit(limit);
    }
    return await db.select().from(aiTradeSamplesTable)
      .orderBy(desc(aiTradeSamplesTable.createdAt))
      .limit(limit);
  }

  async getAiSamplesCount(complete?: boolean): Promise<number> {
    if (complete !== undefined) {
      const result = await db.select({ count: sql<number>`count(*)` })
        .from(aiTradeSamplesTable)
        .where(eq(aiTradeSamplesTable.isComplete, complete));
      return Number(result[0]?.count || 0);
    }
    const result = await db.select({ count: sql<number>`count(*)` }).from(aiTradeSamplesTable);
    return Number(result[0]?.count || 0);
  }

  async saveAiShadowDecision(decision: InsertAiShadowDecision): Promise<AiShadowDecision> {
    const [newDecision] = await db.insert(aiShadowDecisionsTable).values(decision).returning();
    return newDecision;
  }

  async updateAiShadowFinalPnl(tradeId: string, pnl: string): Promise<void> {
    await db.update(aiShadowDecisionsTable)
      .set({ finalPnlNet: pnl })
      .where(eq(aiShadowDecisionsTable.tradeId, tradeId));
  }

  async getAiShadowReport(): Promise<{ total: number; blocked: number; blockedLosers: number; passedLosers: number }> {
    const allDecisions = await db.select().from(aiShadowDecisionsTable)
      .where(sql`${aiShadowDecisionsTable.finalPnlNet} IS NOT NULL`);
    
    const total = allDecisions.length;
    const blocked = allDecisions.filter(d => d.wouldBlock).length;
    const blockedLosers = allDecisions.filter(d => d.wouldBlock && parseFloat(d.finalPnlNet || '0') < 0).length;
    const passedLosers = allDecisions.filter(d => !d.wouldBlock && parseFloat(d.finalPnlNet || '0') < 0).length;
    
    return { total, blocked, blockedLosers, passedLosers };
  }

  async getAiConfig(): Promise<AiConfig | undefined> {
    const configs = await db.select().from(aiConfigTable).limit(1);
    if (configs.length === 0) {
      const [newConfig] = await db.insert(aiConfigTable).values({}).returning();
      return newConfig;
    }
    return configs[0];
  }

  async updateAiConfig(config: Partial<InsertAiConfig>): Promise<AiConfig> {
    const existing = await this.getAiConfig();
    if (!existing) {
      const [newConfig] = await db.insert(aiConfigTable).values(config as InsertAiConfig).returning();
      return newConfig;
    }
    const [updated] = await db.update(aiConfigTable)
      .set({ ...config, updatedAt: new Date() })
      .where(eq(aiConfigTable.id, existing.id))
      .returning();
    return updated;
  }

  async saveTrainingTrade(trade: InsertTrainingTrade): Promise<TrainingTrade> {
    const [newTrade] = await db.insert(trainingTradesTable).values(trade).returning();
    return newTrade;
  }

  async updateTrainingTrade(id: number, updates: Partial<InsertTrainingTrade>): Promise<TrainingTrade | undefined> {
    const [updated] = await db.update(trainingTradesTable)
      .set(updates)
      .where(eq(trainingTradesTable.id, id))
      .returning();
    return updated;
  }

  async getTrainingTradeByBuyTxid(buyTxid: string): Promise<TrainingTrade | undefined> {
    const trades = await db.select().from(trainingTradesTable)
      .where(eq(trainingTradesTable.buyTxid, buyTxid))
      .limit(1);
    return trades[0];
  }

  async getTrainingTrades(options?: { closed?: boolean; labeled?: boolean; limit?: number }): Promise<TrainingTrade[]> {
    const { closed, labeled, limit = 1000 } = options || {};
    const conditions: any[] = [];
    
    if (closed !== undefined) {
      conditions.push(eq(trainingTradesTable.isClosed, closed));
    }
    if (labeled !== undefined) {
      conditions.push(eq(trainingTradesTable.isLabeled, labeled));
    }
    
    const whereClause = conditions.length > 0 
      ? (conditions.length === 1 ? conditions[0] : and(...conditions)) 
      : undefined;
    
    const query = db.select().from(trainingTradesTable)
      .orderBy(desc(trainingTradesTable.entryTs))
      .limit(limit);
    
    return whereClause ? await query.where(whereClause) : await query;
  }

  async getTrainingTradesCount(options?: { closed?: boolean; labeled?: boolean }): Promise<number> {
    const { closed, labeled } = options || {};
    const conditions: any[] = [];
    
    if (closed !== undefined) {
      conditions.push(eq(trainingTradesTable.isClosed, closed));
    }
    if (labeled !== undefined) {
      conditions.push(eq(trainingTradesTable.isLabeled, labeled));
    }
    
    const whereClause = conditions.length > 0 
      ? (conditions.length === 1 ? conditions[0] : and(...conditions)) 
      : undefined;
    
    const query = db.select({ count: sql<number>`count(*)` }).from(trainingTradesTable);
    const result = whereClause ? await query.where(whereClause) : await query;
    return Number(result[0]?.count || 0);
  }

  async getAllTradesForBackfill(): Promise<Trade[]> {
    return await db.select().from(tradesTable)
      .where(eq(tradesTable.status, 'filled'))
      .orderBy(tradesTable.executedAt);
  }

  async runTrainingTradesBackfill(): Promise<{ created: number; closed: number; labeled: number; discardReasons: Record<string, number> }> {
    const allTrades = await this.getAllTradesForBackfill();
    const discardReasons: Record<string, number> = {};
    let created = 0;
    let closed = 0;
    let labeled = 0;
    
    const KRAKEN_FEE_RATE = 0.004;
    const PNL_OUTLIER_THRESHOLD = 50;
    const MAX_HOLD_TIME_DAYS = 30;
    
    const buysByPair: Record<string, Trade[]> = {};
    const sellsByPair: Record<string, Trade[]> = {};
    
    for (const trade of allTrades) {
      const pair = trade.pair;
      if (trade.type === 'buy') {
        if (!buysByPair[pair]) buysByPair[pair] = [];
        buysByPair[pair].push(trade);
      } else if (trade.type === 'sell') {
        if (!sellsByPair[pair]) sellsByPair[pair] = [];
        sellsByPair[pair].push(trade);
      }
    }
    
    for (const pair of Object.keys(buysByPair)) {
      const buys = buysByPair[pair] || [];
      const sells = sellsByPair[pair] || [];
      
      const usedSells = new Set<number>();
      
      for (const buy of buys) {
        const existing = await this.getTrainingTradeByBuyTxid(buy.krakenOrderId || buy.tradeId);
        if (existing) {
          if (existing.isClosed) closed++;
          if (existing.isLabeled) labeled++;
          continue;
        }
        
        const buyTime = buy.executedAt ? new Date(buy.executedAt).getTime() : 0;
        const buyAmount = parseFloat(buy.amount || '0');
        const buyPrice = parseFloat(buy.price || '0');
        const buyCost = buyAmount * buyPrice;
        
        if (!buy.executedAt) {
          discardReasons['no_execution_time'] = (discardReasons['no_execution_time'] || 0) + 1;
          continue;
        }
        
        if (buyAmount <= 0) {
          discardReasons['invalid_buy_amount'] = (discardReasons['invalid_buy_amount'] || 0) + 1;
          continue;
        }
        
        if (buyPrice <= 0) {
          discardReasons['invalid_buy_price'] = (discardReasons['invalid_buy_price'] || 0) + 1;
          continue;
        }
        
        if (buyCost <= 0) {
          discardReasons['invalid_buy_cost'] = (discardReasons['invalid_buy_cost'] || 0) + 1;
          continue;
        }
        
        let matchedSell: Trade | null = null;
        
        for (let i = 0; i < sells.length; i++) {
          if (usedSells.has(sells[i].id)) continue;
          
          const sell = sells[i];
          const sellTime = sell.executedAt ? new Date(sell.executedAt).getTime() : 0;
          if (sellTime <= buyTime) continue;
          
          const sellAmount = parseFloat(sell.amount || '0');
          const amountDiff = Math.abs(sellAmount - buyAmount) / buyAmount;
          
          if (amountDiff < 0.02) {
            matchedSell = sell;
            break;
          }
        }
        
        if (!matchedSell) {
          for (let i = 0; i < sells.length; i++) {
            if (usedSells.has(sells[i].id)) continue;
            
            const sell = sells[i];
            const sellTime = sell.executedAt ? new Date(sell.executedAt).getTime() : 0;
            if (sellTime <= buyTime) continue;
            
            const sellAmount = parseFloat(sell.amount || '0');
            if (Math.abs(sellAmount - buyAmount) / buyAmount < 0.10 && sellAmount <= buyAmount * 1.1) {
              matchedSell = sell;
              break;
            }
          }
        }
        
        const entryFee = buyCost * KRAKEN_FEE_RATE;
        
        const trainingTrade: InsertTrainingTrade = {
          pair,
          buyTxid: buy.krakenOrderId || buy.tradeId,
          entryPrice: buy.price,
          entryAmount: buy.amount,
          costUsd: buyCost.toFixed(8),
          entryFee: entryFee.toFixed(8),
          entryTs: new Date(buy.executedAt),
          isClosed: false,
          isLabeled: false,
        };
        
        if (matchedSell) {
          const sellPrice = parseFloat(matchedSell.price || '0');
          const sellAmount = parseFloat(matchedSell.amount || '0');
          const sellTime = matchedSell.executedAt ? new Date(matchedSell.executedAt).getTime() : buyTime;
          
          let sellValid = true;
          let sellDiscardReason: string | null = null;
          
          if (sellPrice <= 0) {
            sellValid = false;
            sellDiscardReason = 'invalid_sell_price';
          } else if (sellAmount <= 0) {
            sellValid = false;
            sellDiscardReason = 'invalid_sell_amount';
          } else if (sellTime <= buyTime) {
            sellValid = false;
            sellDiscardReason = 'invalid_timestamps';
          }
          
          if (!sellValid) {
            trainingTrade.discardReason = sellDiscardReason!;
            discardReasons[sellDiscardReason!] = (discardReasons[sellDiscardReason!] || 0) + 1;
            await this.saveTrainingTrade(trainingTrade);
            created++;
            continue;
          }
          
          const revenue = sellAmount * sellPrice;
          const exitFee = revenue * KRAKEN_FEE_RATE;
          const pnlGross = revenue - buyCost;
          const pnlNet = pnlGross - entryFee - exitFee;
          const pnlPct = (pnlNet / buyCost) * 100;
          const holdTimeMinutes = Math.round((sellTime - buyTime) / 60000);
          
          const totalFeePct = ((entryFee + exitFee) / buyCost) * 100;
          if (totalFeePct > 2.0 || totalFeePct < 0.5) {
            trainingTrade.discardReason = 'abnormal_fees';
            discardReasons['abnormal_fees'] = (discardReasons['abnormal_fees'] || 0) + 1;
            await this.saveTrainingTrade(trainingTrade);
            created++;
            continue;
          }
          
          if (Math.abs(pnlPct) > PNL_OUTLIER_THRESHOLD) {
            trainingTrade.discardReason = 'pnl_outlier';
            discardReasons['pnl_outlier'] = (discardReasons['pnl_outlier'] || 0) + 1;
            await this.saveTrainingTrade(trainingTrade);
            created++;
            continue;
          }
          
          const holdTimeDays = holdTimeMinutes / (60 * 24);
          if (holdTimeDays > MAX_HOLD_TIME_DAYS) {
            trainingTrade.discardReason = 'hold_time_outlier';
            discardReasons['hold_time_outlier'] = (discardReasons['hold_time_outlier'] || 0) + 1;
            await this.saveTrainingTrade(trainingTrade);
            created++;
            continue;
          }
          
          if (holdTimeMinutes < 0) {
            trainingTrade.discardReason = 'negative_hold_time';
            discardReasons['negative_hold_time'] = (discardReasons['negative_hold_time'] || 0) + 1;
            await this.saveTrainingTrade(trainingTrade);
            created++;
            continue;
          }
          
          usedSells.add(matchedSell.id);
          
          trainingTrade.sellTxid = matchedSell.krakenOrderId || matchedSell.tradeId;
          trainingTrade.exitPrice = matchedSell.price;
          trainingTrade.exitAmount = matchedSell.amount;
          trainingTrade.revenueUsd = revenue.toFixed(8);
          trainingTrade.exitFee = exitFee.toFixed(8);
          trainingTrade.pnlGross = pnlGross.toFixed(8);
          trainingTrade.pnlNet = pnlNet.toFixed(8);
          trainingTrade.pnlPct = pnlPct.toFixed(4);
          trainingTrade.holdTimeMinutes = holdTimeMinutes;
          trainingTrade.labelWin = pnlNet > 0 ? 1 : 0;
          trainingTrade.exitTs = matchedSell.executedAt ? new Date(matchedSell.executedAt) : undefined;
          trainingTrade.isClosed = true;
          trainingTrade.isLabeled = true;
          
          closed++;
          labeled++;
        } else {
          trainingTrade.discardReason = 'no_matching_sell';
          discardReasons['no_matching_sell'] = (discardReasons['no_matching_sell'] || 0) + 1;
        }
        
        await this.saveTrainingTrade(trainingTrade);
        created++;
      }
    }
    
    return { created, closed, labeled, discardReasons };
  }
}

export const storage = new DatabaseStorage();
