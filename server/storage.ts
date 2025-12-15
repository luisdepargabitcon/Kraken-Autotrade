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
  getTrainingTradesCount(options?: { closed?: boolean; labeled?: boolean; hasOpenLots?: boolean }): Promise<number>;
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

  async getTrainingTradesCount(options?: { closed?: boolean; labeled?: boolean; hasOpenLots?: boolean }): Promise<number> {
    const { closed, labeled, hasOpenLots } = options || {};
    const conditions: any[] = [];
    
    if (closed !== undefined) {
      conditions.push(eq(trainingTradesTable.isClosed, closed));
    }
    if (labeled !== undefined) {
      conditions.push(eq(trainingTradesTable.isLabeled, labeled));
    }
    if (hasOpenLots === true) {
      conditions.push(sql`${trainingTradesTable.qtyRemaining} > 0`);
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
    const QTY_EPSILON = 0.00000001;
    
    const tradesByPair: Record<string, Trade[]> = {};
    for (const trade of allTrades) {
      if (!tradesByPair[trade.pair]) tradesByPair[trade.pair] = [];
      tradesByPair[trade.pair].push(trade);
    }
    
    for (const pair of Object.keys(tradesByPair)) {
      const pairTrades = tradesByPair[pair].sort((a, b) => {
        const timeA = a.executedAt ? new Date(a.executedAt).getTime() : 0;
        const timeB = b.executedAt ? new Date(b.executedAt).getTime() : 0;
        return timeA - timeB;
      });
      
      interface OpenLot {
        dbId: number | null;
        buyTxid: string;
        entryPrice: number;
        entryAmount: number;
        qtyRemaining: number;
        entryTs: Date;
        costUsd: number;
        entryFee: number;
        sellTxids: string[];
        totalRevenue: number;
        totalExitFee: number;
        lastSellTs: Date | null;
        lastSellPrice: number;
      }
      
      const openLots: OpenLot[] = [];
      
      for (const trade of pairTrades) {
        const tradeTime = trade.executedAt ? new Date(trade.executedAt) : null;
        const tradeAmount = parseFloat(trade.amount || '0');
        const tradePrice = parseFloat(trade.price || '0');
        const tradeTxid = trade.krakenOrderId || trade.tradeId;
        
        if (!tradeTime) {
          discardReasons['sin_fecha_ejecucion'] = (discardReasons['sin_fecha_ejecucion'] || 0) + 1;
          continue;
        }
        
        if (tradeAmount <= 0 || tradePrice <= 0) {
          discardReasons['datos_invalidos'] = (discardReasons['datos_invalidos'] || 0) + 1;
          continue;
        }
        
        if (trade.type === 'buy') {
          const existing = await this.getTrainingTradeByBuyTxid(tradeTxid);
          if (existing) {
            if (existing.isClosed) closed++;
            if (existing.isLabeled) labeled++;
            const qtyRem = parseFloat(existing.qtyRemaining || existing.entryAmount || '0');
            if (qtyRem > QTY_EPSILON) {
              openLots.push({
                dbId: existing.id,
                buyTxid: tradeTxid,
                entryPrice: parseFloat(existing.entryPrice),
                entryAmount: parseFloat(existing.entryAmount),
                qtyRemaining: qtyRem,
                entryTs: new Date(existing.entryTs),
                costUsd: parseFloat(existing.costUsd),
                entryFee: parseFloat(existing.entryFee || '0'),
                sellTxids: (existing.sellTxidsJson as string[]) || [],
                totalRevenue: parseFloat(existing.revenueUsd || '0'),
                totalExitFee: parseFloat(existing.exitFee || '0'),
                lastSellTs: existing.exitTs ? new Date(existing.exitTs) : null,
                lastSellPrice: parseFloat(existing.exitPrice || '0'),
              });
            }
            continue;
          }
          
          const buyCost = tradeAmount * tradePrice;
          const entryFee = buyCost * KRAKEN_FEE_RATE;
          
          const trainingTrade: InsertTrainingTrade = {
            pair,
            buyTxid: tradeTxid,
            entryPrice: trade.price,
            entryAmount: trade.amount,
            qtyRemaining: trade.amount,
            costUsd: buyCost.toFixed(8),
            entryFee: entryFee.toFixed(8),
            entryTs: tradeTime,
            sellTxidsJson: [],
            isClosed: false,
            isLabeled: false,
          };
          
          const saved = await this.saveTrainingTrade(trainingTrade);
          created++;
          
          openLots.push({
            dbId: saved.id,
            buyTxid: tradeTxid,
            entryPrice: tradePrice,
            entryAmount: tradeAmount,
            qtyRemaining: tradeAmount,
            entryTs: tradeTime,
            costUsd: buyCost,
            entryFee,
            sellTxids: [],
            totalRevenue: 0,
            totalExitFee: 0,
            lastSellTs: null,
            lastSellPrice: 0,
          });
          
        } else if (trade.type === 'sell') {
          let remainingToSell = tradeAmount;
          const sellPrice = tradePrice;
          const sellTime = tradeTime;
          
          if (openLots.length === 0) {
            discardReasons['venta_sin_compra_previa'] = (discardReasons['venta_sin_compra_previa'] || 0) + 1;
            continue;
          }
          
          while (remainingToSell > QTY_EPSILON && openLots.length > 0) {
            const lot = openLots[0];
            const consumeQty = Math.min(remainingToSell, lot.qtyRemaining);
            const proportion = consumeQty / lot.entryAmount;
            const sellRevenue = consumeQty * sellPrice;
            const sellFee = sellRevenue * KRAKEN_FEE_RATE;
            
            lot.qtyRemaining -= consumeQty;
            remainingToSell -= consumeQty;
            lot.sellTxids.push(tradeTxid);
            lot.totalRevenue += sellRevenue;
            lot.totalExitFee += sellFee;
            lot.lastSellTs = sellTime;
            lot.lastSellPrice = sellPrice;
            
            if (lot.qtyRemaining <= QTY_EPSILON) {
              const pnlGross = lot.totalRevenue - lot.costUsd;
              const pnlNet = pnlGross - lot.entryFee - lot.totalExitFee;
              const pnlPct = (pnlNet / lot.costUsd) * 100;
              const holdTimeMinutes = Math.round((lot.lastSellTs!.getTime() - lot.entryTs.getTime()) / 60000);
              
              let discardReason: string | null = null;
              
              const totalFeePct = ((lot.entryFee + lot.totalExitFee) / lot.costUsd) * 100;
              if (totalFeePct > 2.0 || totalFeePct < 0.5) {
                discardReason = 'comisiones_anormales';
              } else if (Math.abs(pnlPct) > PNL_OUTLIER_THRESHOLD) {
                discardReason = 'pnl_atipico';
              } else if (holdTimeMinutes / (60 * 24) > MAX_HOLD_TIME_DAYS) {
                discardReason = 'hold_excesivo';
              } else if (holdTimeMinutes < 0) {
                discardReason = 'timestamps_invalidos';
              }
              
              if (discardReason) {
                discardReasons[discardReason] = (discardReasons[discardReason] || 0) + 1;
              }
              
              const avgExitPrice = lot.totalRevenue / lot.entryAmount;
              
              await this.updateTrainingTrade(lot.dbId!, {
                sellTxid: lot.sellTxids[lot.sellTxids.length - 1],
                sellTxidsJson: lot.sellTxids,
                exitPrice: avgExitPrice.toFixed(8),
                exitAmount: lot.entryAmount.toFixed(8),
                qtyRemaining: '0',
                revenueUsd: lot.totalRevenue.toFixed(8),
                exitFee: lot.totalExitFee.toFixed(8),
                pnlGross: pnlGross.toFixed(8),
                pnlNet: pnlNet.toFixed(8),
                pnlPct: pnlPct.toFixed(4),
                holdTimeMinutes,
                labelWin: discardReason ? undefined : (pnlNet > 0 ? 1 : 0),
                exitTs: lot.lastSellTs!,
                isClosed: true,
                isLabeled: discardReason ? false : true,
                discardReason: discardReason || undefined,
              });
              
              closed++;
              if (!discardReason) labeled++;
              
              openLots.shift();
            } else {
              await this.updateTrainingTrade(lot.dbId!, {
                qtyRemaining: lot.qtyRemaining.toFixed(8),
                sellTxidsJson: lot.sellTxids,
              });
            }
          }
          
          if (remainingToSell > QTY_EPSILON) {
            discardReasons['venta_excede_lotes'] = (discardReasons['venta_excede_lotes'] || 0) + 1;
          }
        }
      }
      
      for (const lot of openLots) {
        if (lot.qtyRemaining > QTY_EPSILON && lot.qtyRemaining < lot.entryAmount) {
          await this.updateTrainingTrade(lot.dbId!, {
            qtyRemaining: lot.qtyRemaining.toFixed(8),
            sellTxidsJson: lot.sellTxids,
          });
        }
      }
    }
    
    return { created, closed, labeled, discardReasons };
  }
}

export const storage = new DatabaseStorage();
