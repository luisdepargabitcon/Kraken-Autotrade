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
  type TradeFill,
  type LotMatch,
  type InsertTradeFill,
  type InsertLotMatch,
  botConfig as botConfigTable,
  trades as tradesTable,
  notifications as notificationsTable,
  marketData as marketDataTable,
  apiConfig as apiConfigTable,
  telegramChats as telegramChatsTable,
  openPositions as openPositionsTable,
  tradeFills as tradeFillsTable,
  lotMatches as lotMatchesTable,
  aiTradeSamples as aiTradeSamplesTable,
  aiShadowDecisions as aiShadowDecisionsTable,
  aiConfig as aiConfigTable,
  trainingTrades as trainingTradesTable
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, gt, lt, sql, isNull } from "drizzle-orm";
import { errorAlertService, ErrorAlertService } from "./services/ErrorAlertService";

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
  updateTradeByKrakenOrderId(krakenOrderId: string, patch: Partial<InsertTrade>): Promise<Trade | undefined>;
  getTradeByLotId(lotId: string): Promise<Trade | undefined>;
  getSellMatchingBuy(pair: string, buyLotId: string): Promise<Trade | undefined>;
  upsertTradeByKrakenId(trade: InsertTrade): Promise<{ inserted: boolean; trade?: Trade }>;
  getDuplicateTradesByKrakenId(): Promise<{ krakenOrderId: string; count: number; ids: number[] }[]>;
  deleteDuplicateTrades(): Promise<number>;
  updateTradePnl(id: number, entryPrice: string, realizedPnlUsd: string, realizedPnlPct: string): Promise<void>;
  getUnmatchedBuys(pair: string): Promise<Trade[]>;
  
  createNotification(notification: InsertNotification): Promise<Notification>;
  getUnsentNotifications(): Promise<Notification[]>;
  markNotificationSent(id: number): Promise<void>;
  
  saveMarketData(data: InsertMarketData): Promise<MarketData>;
  getLatestMarketData(pair: string): Promise<MarketData | undefined>;
  
  getTelegramChats(): Promise<TelegramChat[]>;
  getActiveTelegramChats(): Promise<TelegramChat[]>;
  getTelegramChatByChatId(chatId: string): Promise<TelegramChat | undefined>;
  createTelegramChat(chat: InsertTelegramChat): Promise<TelegramChat>;
  updateTelegramChat(id: number, chat: Partial<InsertTelegramChat>): Promise<TelegramChat>;
  deleteTelegramChat(id: number): Promise<void>;
  
  getOpenPositions(): Promise<OpenPosition[]>;
  getOpenPosition(pair: string): Promise<OpenPosition | undefined>;
  getOpenPositionByLotId(lotId: string): Promise<OpenPosition | undefined>;
  getOpenPositionsByPair(pair: string): Promise<OpenPosition[]>;
  saveOpenPosition(position: InsertOpenPosition): Promise<OpenPosition>;
  saveOpenPositionByLotId(position: InsertOpenPosition): Promise<OpenPosition>;
  updateOpenPosition(pair: string, updates: Partial<InsertOpenPosition>): Promise<OpenPosition | undefined>;
  updateOpenPositionByLotId(lotId: string, updates: Partial<InsertOpenPosition>): Promise<OpenPosition | undefined>;
  updateOpenPositionLotId(id: number, lotId: string): Promise<void>;
  deleteOpenPosition(pair: string): Promise<void>;
  deleteOpenPositionByLotId(lotId: string): Promise<void>;
  getOpenPositionsWithQtyRemaining(): Promise<OpenPosition[]>;
  updateOpenPositionQty(lotId: string, qtyRemaining: string, qtyFilled: string): Promise<void>;
  initializeQtyRemainingForAll(): Promise<number>;
  
  // Trade fills
  upsertTradeFill(fill: InsertTradeFill): Promise<{ inserted: boolean; fill?: TradeFill }>;
  getTradeFillByTxid(txid: string): Promise<TradeFill | undefined>;
  getUnmatchedSellFills(pair: string): Promise<TradeFill[]>;
  markFillAsMatched(txid: string): Promise<void>;
  getRecentTradeFills(limit?: number, exchange?: string): Promise<TradeFill[]>;
  
  // Lot matches (FIFO matcher audit trail)
  createLotMatch(match: InsertLotMatch): Promise<LotMatch>;
  getLotMatchesByLotId(lotId: string): Promise<LotMatch[]>;
  getLotMatchBySellFillAndLot(sellFillTxid: string, lotId: string): Promise<LotMatch | undefined>;
  
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
  getDuplicateTrainingTradesByBuyTxid(): Promise<{ buyTxid: string; count: number; ids: number[] }[]>;
  deleteDuplicateTrainingTrades(): Promise<number>;
  getTrainingTradesCount(options?: { closed?: boolean; labeled?: boolean; hasOpenLots?: boolean }): Promise<number>;
  getDiscardReasonsDataset(): Promise<Record<string, number>>;
  getAllTradesForBackfill(): Promise<Trade[]>;
  runTrainingTradesBackfill(): Promise<{ created: number; closed: number; labeled: number; discardReasons: Record<string, number> }>;
  
  // Schema health check and auto-migration
  checkSchemaHealth(): Promise<{ healthy: boolean; missingColumns: string[]; migrationRan: boolean }>;
  runSchemaMigration(): Promise<{ success: boolean; columnsAdded: string[]; error?: string }>;
  
  // Signal configuration methods
  getSignalConfig(): Promise<any | undefined>;
  setSignalConfig(config: any): Promise<void>;
  getRecentScans(limit?: number): Promise<any[]>;
  getRecentScansByTimeframe(timeframe: string): Promise<any[]>;
  getTradesByTimeframe(timeframe: string): Promise<any[]>;
}

export class DatabaseStorage implements IStorage {
  private schemaMigrationAttempted = false;
  
  async getBotConfig(): Promise<BotConfig | undefined> {
    try {
      const configs = await db.select().from(botConfigTable).limit(1);
      if (configs.length === 0) {
        const [newConfig] = await db.insert(botConfigTable).values({}).returning();
        return newConfig;
      }
      return configs[0];
    } catch (error) {
      // If schema is outdated, try auto-migration ONCE then retry
      if (!this.schemaMigrationAttempted && error instanceof Error && error.message.includes('does not exist')) {
        console.log('[storage] Schema issue detected, attempting auto-migration...');
        this.schemaMigrationAttempted = true;
        const migrationResult = await this.runSchemaMigration();
        if (migrationResult.success) {
          console.log('[storage] Auto-migration successful, retrying getBotConfig...');
          return this.getBotConfig();
        }
        // Migration failed - propagate error
        console.error('[storage] Auto-migration failed:', migrationResult.error);
      }
      
      // Enviar alerta crítica de error de base de datos
      const alert = ErrorAlertService.createFromError(
        error as Error,
        'DATABASE_ERROR',
        'CRITICAL',
        'getBotConfig',
        'server/storage.ts',
        undefined,
        { operation: 'getBotConfig', migrationAttempted: this.schemaMigrationAttempted }
      );
      await errorAlertService.sendCriticalError(alert);
      
      // No fallback - surface the error so operators know to fix schema
      throw error;
    }
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

  // Upsert trade - inserta solo si no existe (por krakenOrderId)
  async upsertTradeByKrakenId(trade: InsertTrade): Promise<{ inserted: boolean; trade?: Trade }> {
    if (!trade.krakenOrderId) {
      const [newTrade] = await db.insert(tradesTable).values(trade).returning();
      return { inserted: true, trade: newTrade };
    }
    
    // Verificar si existe
    const existing = await this.getTradeByKrakenOrderId(trade.krakenOrderId);
    if (existing) {
      return { inserted: false, trade: existing };
    }
    
    try {
      const [newTrade] = await db.insert(tradesTable).values(trade).returning();
      return { inserted: true, trade: newTrade };
    } catch (e: any) {
      // Handle unique constraint violation gracefully
      if (e.code === '23505') {
        return { inserted: false };
      }
      throw e;
    }
  }

  // Obtener duplicados por krakenOrderId para limpieza
  async getDuplicateTradesByKrakenId(): Promise<{ krakenOrderId: string; count: number; ids: number[] }[]> {
    const result = await db.execute(sql`
      SELECT kraken_order_id, COUNT(*) as count, ARRAY_AGG(id ORDER BY id) as ids
      FROM trades
      WHERE kraken_order_id IS NOT NULL
      GROUP BY kraken_order_id
      HAVING COUNT(*) > 1
    `);
    return (result.rows as any[]).map(row => ({
      krakenOrderId: row.kraken_order_id,
      count: parseInt(row.count),
      ids: row.ids,
    }));
  }

  // Eliminar duplicados manteniendo el más antiguo (menor id)
  async deleteDuplicateTrades(): Promise<number> {
    const duplicates = await this.getDuplicateTradesByKrakenId();
    let deleted = 0;
    
    for (const dup of duplicates) {
      // Mantener el primer id (más antiguo), eliminar el resto
      const idsToDelete = dup.ids.slice(1);
      for (const id of idsToDelete) {
        await db.delete(tradesTable).where(eq(tradesTable.id, id));
        deleted++;
      }
    }
    
    return deleted;
  }

  // Actualizar P&L de un trade
  async updateTradePnl(id: number, entryPrice: string, realizedPnlUsd: string, realizedPnlPct: string): Promise<void> {
    await db.update(tradesTable)
      .set({ entryPrice, realizedPnlUsd, realizedPnlPct })
      .where(eq(tradesTable.id, id));
  }

  // Obtener trades BUY sin emparejar para un par (para calcular P&L)
  async getUnmatchedBuys(pair: string): Promise<Trade[]> {
    return await db.select().from(tradesTable)
      .where(and(
        eq(tradesTable.pair, pair),
        eq(tradesTable.type, 'buy'),
        eq(tradesTable.status, 'filled')
      ))
      .orderBy(tradesTable.executedAt);
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

  // B1: Update trade by krakenOrderId with partial patch
  async updateTradeByKrakenOrderId(krakenOrderId: string, patch: Partial<InsertTrade>): Promise<Trade | undefined> {
    if (!krakenOrderId) return undefined;
    
    const [updated] = await db.update(tradesTable)
      .set(patch)
      .where(eq(tradesTable.krakenOrderId, krakenOrderId))
      .returning();
    return updated;
  }

  // Check for duplicate trade by characteristics (pair + amount + type + timestamp within 60 seconds)
  async findDuplicateTrade(pair: string, amount: string, type: string, executedAt: Date): Promise<Trade | undefined> {
    const trades = await db.select().from(tradesTable)
      .where(and(
        eq(tradesTable.pair, pair),
        eq(tradesTable.amount, amount),
        eq(tradesTable.type, type),
        sql`ABS(EXTRACT(EPOCH FROM (${tradesTable.executedAt} - ${executedAt}))) < 60`
      ))
      .limit(1);
    return trades[0];
  }

  async getTradeByLotId(lotId: string): Promise<Trade | undefined> {
    // lotId typically equals krakenOrderId for synced trades
    const trades = await db.select().from(tradesTable)
      .where(eq(tradesTable.krakenOrderId, lotId))
      .limit(1);
    return trades[0];
  }

  async getSellMatchingBuy(pair: string, buyLotId: string): Promise<Trade | undefined> {
    // Find the BUY trade first to get its timestamp (case-insensitive)
    const buyTrade = await db.select().from(tradesTable)
      .where(and(
        eq(tradesTable.krakenOrderId, buyLotId),
        sql`UPPER(${tradesTable.type}) = 'BUY'`
      ))
      .limit(1);
    
    if (!buyTrade[0]) return undefined;
    
    // Find any SELL for the same pair that happened after this BUY (case-insensitive)
    const sellTrades = await db.select().from(tradesTable)
      .where(and(
        eq(tradesTable.pair, pair),
        sql`UPPER(${tradesTable.type}) = 'SELL'`,
        gt(tradesTable.executedAt, buyTrade[0].executedAt!)
      ))
      .orderBy(tradesTable.executedAt)
      .limit(1);
    
    return sellTrades[0];
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

  async getTelegramChatByChatId(chatId: string): Promise<TelegramChat | undefined> {
    const chats = await db.select().from(telegramChatsTable)
      .where(eq(telegramChatsTable.chatId, chatId))
      .limit(1);
    return chats[0];
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

  async ensureDefaultChat(): Promise<void> {
    // Check if there's already a default chat
    const existingDefault = await db.select()
      .from(telegramChatsTable)
      .where(eq(telegramChatsTable.isDefault, true))
      .limit(1);

    if (existingDefault.length === 0) {
      // Get legacy chat_id from api_config
      const apiConfig = await this.getApiConfig();
      if (apiConfig?.telegramChatId) {
        // Create default chat from legacy config
        await this.createTelegramChat({
          name: "Chat por defecto",
          chatId: apiConfig.telegramChatId,
          isDefault: true,
          alertTrades: true,
          alertErrors: true,
          alertSystem: true,
          alertBalance: false,
          alertHeartbeat: false,
          isActive: true
        });
      }
    }
  }

  async setDefaultChat(chatId: number): Promise<void> {
    // Remove default from all chats
    await db.update(telegramChatsTable)
      .set({ isDefault: false })
      .where(eq(telegramChatsTable.isDefault, true));

    // Set new default
    await db.update(telegramChatsTable)
      .set({ isDefault: true })
      .where(eq(telegramChatsTable.id, chatId));
  }

  async getDefaultChat(): Promise<TelegramChat | undefined> {
    const [defaultChat] = await db.select()
      .from(telegramChatsTable)
      .where(eq(telegramChatsTable.isDefault, true))
      .limit(1);
    return defaultChat;
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

  async getOpenPositionByLotId(lotId: string): Promise<OpenPosition | undefined> {
    const positions = await db.select().from(openPositionsTable)
      .where(eq(openPositionsTable.lotId, lotId))
      .limit(1);
    return positions[0];
  }

  async getOpenPositionsByPair(pair: string): Promise<OpenPosition[]> {
    return await db.select().from(openPositionsTable)
      .where(eq(openPositionsTable.pair, pair));
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

  async saveOpenPositionByLotId(position: InsertOpenPosition): Promise<OpenPosition> {
    if (!position.lotId) {
      throw new Error("lotId is required for saveOpenPositionByLotId");
    }
    const existing = await this.getOpenPositionByLotId(position.lotId);
    if (existing) {
      const [updated] = await db.update(openPositionsTable)
        .set({ ...position, updatedAt: new Date() })
        .where(eq(openPositionsTable.lotId, position.lotId))
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

  async updateOpenPositionByLotId(lotId: string, updates: Partial<InsertOpenPosition>): Promise<OpenPosition | undefined> {
    const [updated] = await db.update(openPositionsTable)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(openPositionsTable.lotId, lotId))
      .returning();
    return updated;
  }

  async updateOpenPositionLotId(id: number, lotId: string): Promise<void> {
    await db.update(openPositionsTable)
      .set({ lotId, updatedAt: new Date() })
      .where(eq(openPositionsTable.id, id));
  }

  async deleteOpenPosition(pair: string): Promise<void> {
    await db.delete(openPositionsTable).where(eq(openPositionsTable.pair, pair));
  }

  async deleteOpenPositionByLotId(lotId: string): Promise<void> {
    await db.delete(openPositionsTable).where(eq(openPositionsTable.lotId, lotId));
  }

  async getOpenPositionsWithQtyRemaining(): Promise<OpenPosition[]> {
    // Returns only positions with qtyRemaining > 0 (or null which means not yet initialized)
    return await db.select().from(openPositionsTable)
      .where(sql`${openPositionsTable.qtyRemaining} > 0 OR ${openPositionsTable.qtyRemaining} IS NULL`)
      .orderBy(openPositionsTable.openedAt);
  }

  async updateOpenPositionQty(lotId: string, qtyRemaining: string, qtyFilled: string): Promise<void> {
    await db.update(openPositionsTable)
      .set({ qtyRemaining, qtyFilled, updatedAt: new Date() })
      .where(eq(openPositionsTable.lotId, lotId));
  }

  async initializeQtyRemainingForAll(): Promise<number> {
    // Initialize qtyRemaining = amount for all positions where qtyRemaining is null
    const result = await db.execute(sql`
      UPDATE open_positions 
      SET qty_remaining = amount, qty_filled = '0'
      WHERE qty_remaining IS NULL
    `);
    return Number(result.rowCount || 0);
  }

  // Trade fills
  async upsertTradeFill(fill: InsertTradeFill): Promise<{ inserted: boolean; fill?: TradeFill }> {
    const existing = await this.getTradeFillByTxid(fill.txid);
    if (existing) {
      return { inserted: false, fill: existing };
    }
    try {
      const [newFill] = await db.insert(tradeFillsTable).values(fill).returning();
      return { inserted: true, fill: newFill };
    } catch (error: any) {
      if (error.code === '23505') { // Unique violation
        const existingFill = await this.getTradeFillByTxid(fill.txid);
        return { inserted: false, fill: existingFill };
      }
      throw error;
    }
  }

  async getTradeFillByTxid(txid: string): Promise<TradeFill | undefined> {
    const fills = await db.select().from(tradeFillsTable)
      .where(eq(tradeFillsTable.txid, txid))
      .limit(1);
    return fills[0];
  }

  async getUnmatchedSellFills(pair: string): Promise<TradeFill[]> {
    return await db.select().from(tradeFillsTable)
      .where(and(
        eq(tradeFillsTable.pair, pair),
        sql`UPPER(${tradeFillsTable.type}) = 'SELL'`,
        eq(tradeFillsTable.matched, false)
      ))
      .orderBy(tradeFillsTable.executedAt);
  }

  async markFillAsMatched(txid: string): Promise<void> {
    await db.update(tradeFillsTable)
      .set({ matched: true })
      .where(eq(tradeFillsTable.txid, txid));
  }

  async getRecentTradeFills(limit: number = 20, exchange?: string): Promise<TradeFill[]> {
    // Note: tradeFills table doesn't have exchange column, so we ignore exchange filter for now
    // In future, we could add exchange column or join with trades table
    return await db.select()
      .from(tradeFillsTable)
      .orderBy(desc(tradeFillsTable.executedAt))
      .limit(limit);
  }

  // Lot matches
  async createLotMatch(match: InsertLotMatch): Promise<LotMatch> {
    try {
      const [newMatch] = await db.insert(lotMatchesTable).values(match).returning();
      return newMatch;
    } catch (error: any) {
      if (error.code === '23505') { // Unique violation - already exists
        const existing = await this.getLotMatchBySellFillAndLot(match.sellFillTxid, match.lotId);
        if (existing) return existing;
      }
      throw error;
    }
  }

  async getLotMatchesByLotId(lotId: string): Promise<LotMatch[]> {
    return await db.select().from(lotMatchesTable)
      .where(eq(lotMatchesTable.lotId, lotId))
      .orderBy(lotMatchesTable.createdAt);
  }

  async getLotMatchBySellFillAndLot(sellFillTxid: string, lotId: string): Promise<LotMatch | undefined> {
    const matches = await db.select().from(lotMatchesTable)
      .where(and(
        eq(lotMatchesTable.sellFillTxid, sellFillTxid),
        eq(lotMatchesTable.lotId, lotId)
      ))
      .limit(1);
    return matches[0];
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

  // Obtener duplicados por buyTxid para limpieza de training_trades
  async getDuplicateTrainingTradesByBuyTxid(): Promise<{ buyTxid: string; count: number; ids: number[] }[]> {
    const result = await db.execute(sql`
      SELECT buy_txid, COUNT(*) as count, ARRAY_AGG(id ORDER BY id) as ids
      FROM training_trades
      GROUP BY buy_txid
      HAVING COUNT(*) > 1
    `);
    return (result.rows as any[]).map(row => ({
      buyTxid: row.buy_txid,
      count: parseInt(row.count),
      ids: row.ids,
    }));
  }

  // Eliminar duplicados en training_trades manteniendo el más antiguo
  async deleteDuplicateTrainingTrades(): Promise<number> {
    const duplicates = await this.getDuplicateTrainingTradesByBuyTxid();
    let deleted = 0;
    
    for (const dup of duplicates) {
      const idsToDelete = dup.ids.slice(1);
      for (const id of idsToDelete) {
        await db.delete(trainingTradesTable).where(eq(trainingTradesTable.id, id));
        deleted++;
      }
    }
    
    return deleted;
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

  async getDiscardReasonsDataset(): Promise<Record<string, number>> {
    const result = await db.select({
      discardReason: trainingTradesTable.discardReason,
      count: sql<number>`count(*)`,
    })
    .from(trainingTradesTable)
    .where(sql`${trainingTradesTable.discardReason} IS NOT NULL`)
    .groupBy(trainingTradesTable.discardReason);
    
    const reasons: Record<string, number> = {};
    for (const row of result) {
      if (row.discardReason) {
        reasons[row.discardReason] = Number(row.count);
      }
    }
    return reasons;
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
    const PNL_OUTLIER_THRESHOLD = 100; // Increased from 50% - crypto is volatile
    const MAX_HOLD_TIME_DAYS = 30;
    const MIN_FEE_PCT = 0.1; // Lowered from 0.5% - discount tiers exist
    const MAX_FEE_PCT = 2.5; // Raised from 2.0% - allow for spread costs
    const QTY_EPSILON = 0.00000001;
    
    const tradesByPair: Record<string, Trade[]> = {};
    for (const trade of allTrades) {
      if (!tradesByPair[trade.pair]) tradesByPair[trade.pair] = [];
      tradesByPair[trade.pair].push(trade);
    }
    
    for (const pair of Object.keys(tradesByPair)) {
      // Ordenación estable FIFO: timestamp + id (tie-breaker determinista)
      const pairTrades = tradesByPair[pair].sort((a, b) => {
        const timeA = a.executedAt ? new Date(a.executedAt).getTime() : 0;
        const timeB = b.executedAt ? new Date(b.executedAt).getTime() : 0;
        if (timeA !== timeB) return timeA - timeB;
        // Tie-breaker: ID de base de datos (determinista)
        return a.id - b.id;
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
            const qtyRem = parseFloat(existing.qtyRemaining || existing.entryAmount || '0');
            
            // Si ya está cerrado y etiquetado/descartado, es inmutable - no reprocesar
            if (existing.isClosed && qtyRem <= QTY_EPSILON) {
              // Trade ya procesado completamente - skip sin modificar
              continue;
            }
            
            // Solo añadir a openLots si tiene cantidad restante para procesar
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
              if (totalFeePct > MAX_FEE_PCT || totalFeePct < MIN_FEE_PCT) {
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
    
    // Invariance check: if qtyRemaining <= epsilon then normalize to 0 and ensure isClosed=true
    const allTrainingTrades = await db.select().from(trainingTradesTable);
    for (const trade of allTrainingTrades) {
      const qty = parseFloat(trade.qtyRemaining || trade.entryAmount || '0');
      if (qty <= QTY_EPSILON && qty > 0) {
        // Normalize tiny residuals to exactly 0
        await this.updateTrainingTrade(trade.id, { qtyRemaining: '0', isClosed: true });
      } else if (qty <= QTY_EPSILON && !trade.isClosed) {
        // qty is already 0 but isClosed is false - fix invariance
        await this.updateTrainingTrade(trade.id, { isClosed: true });
      }
    }
    
    return { created, closed, labeled, discardReasons };
  }

  async checkSchemaHealth(): Promise<{ healthy: boolean; missingColumns: string[]; migrationRan: boolean }> {
    const missingColumns: string[] = [];
    
    // Check required columns in bot_config table
    const requiredBotConfigColumns = [
      { column: 'sg_max_open_lots_per_pair', table: 'bot_config' },
      { column: 'sg_pair_overrides', table: 'bot_config' },
      { column: 'dry_run_mode', table: 'bot_config' },
      { column: 'sg_min_entry_usd', table: 'bot_config' },
      { column: 'sg_allow_under_min', table: 'bot_config' },
      { column: 'sg_be_at_pct', table: 'bot_config' },
      { column: 'sg_trail_start_pct', table: 'bot_config' },
      { column: 'sg_trail_distance_pct', table: 'bot_config' },
      { column: 'sg_trail_step_pct', table: 'bot_config' },
      { column: 'sg_tp_fixed_enabled', table: 'bot_config' },
      { column: 'sg_tp_fixed_pct', table: 'bot_config' },
      { column: 'sg_scale_out_enabled', table: 'bot_config' },
      { column: 'sg_scale_out_pct', table: 'bot_config' },
      { column: 'sg_min_part_usd', table: 'bot_config' },
      { column: 'sg_scale_out_threshold', table: 'bot_config' },
      { column: 'sg_fee_cushion_pct', table: 'bot_config' },
      { column: 'sg_fee_cushion_auto', table: 'bot_config' },
    ];
    
    const requiredOpenPositionsColumns = [
      { column: 'lot_id', table: 'open_positions' },
      { column: 'sg_break_even_activated', table: 'open_positions' },
      { column: 'sg_trailing_activated', table: 'open_positions' },
      { column: 'sg_current_stop_price', table: 'open_positions' },
      { column: 'sg_scale_out_done', table: 'open_positions' },
      { column: 'config_snapshot_json', table: 'open_positions' },
    ];
    
    const allRequiredColumns = [...requiredBotConfigColumns, ...requiredOpenPositionsColumns];
    
    // Health check ONLY reports status - does NOT auto-migrate
    // Migration should be run by script/migrate.ts (Docker startup) or manually
    // This ensures the migration flow has a single source of truth
    for (const { column, table } of allRequiredColumns) {
      const result = await db.execute(sql`
        SELECT column_name FROM information_schema.columns 
        WHERE table_name = ${table} AND column_name = ${column}
      `);
      if (result.rows.length === 0) {
        missingColumns.push(`${table}.${column}`);
      }
    }
    
    if (missingColumns.length > 0) {
      console.warn(`[schema] Health check: missing columns detected: ${missingColumns.join(', ')}`);
      console.warn('[schema] Run "npx tsx script/migrate.ts" to fix schema issues');
    }

    const healthy = missingColumns.length === 0;
    return { healthy, missingColumns, migrationRan: healthy };
  }

  async runSchemaMigration(): Promise<{ success: boolean; columnsAdded: string[]; error?: string }> {
    const columnsAdded: string[] = [];
    
    try {
      // Define all migrations with safe ADD COLUMN IF NOT EXISTS
      const migrations = [
        // bot_config columns
        { table: 'bot_config', column: 'sg_max_open_lots_per_pair', sql: 'ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS sg_max_open_lots_per_pair INTEGER DEFAULT 1' },
        { table: 'bot_config', column: 'sg_pair_overrides', sql: 'ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS sg_pair_overrides JSONB' },
        { table: 'bot_config', column: 'dry_run_mode', sql: 'ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS dry_run_mode BOOLEAN DEFAULT false' },
        { table: 'bot_config', column: 'sg_min_entry_usd', sql: 'ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS sg_min_entry_usd DECIMAL(10,2) DEFAULT 100.00' },
        { table: 'bot_config', column: 'sg_allow_under_min', sql: 'ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS sg_allow_under_min BOOLEAN DEFAULT true' },
        { table: 'bot_config', column: 'sg_be_at_pct', sql: 'ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS sg_be_at_pct DECIMAL(5,2) DEFAULT 1.50' },
        { table: 'bot_config', column: 'sg_trail_start_pct', sql: 'ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS sg_trail_start_pct DECIMAL(5,2) DEFAULT 2.00' },
        { table: 'bot_config', column: 'sg_trail_distance_pct', sql: 'ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS sg_trail_distance_pct DECIMAL(5,2) DEFAULT 1.50' },
        { table: 'bot_config', column: 'sg_trail_step_pct', sql: 'ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS sg_trail_step_pct DECIMAL(5,2) DEFAULT 0.25' },
        { table: 'bot_config', column: 'sg_tp_fixed_enabled', sql: 'ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS sg_tp_fixed_enabled BOOLEAN DEFAULT false' },
        { table: 'bot_config', column: 'sg_tp_fixed_pct', sql: 'ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS sg_tp_fixed_pct DECIMAL(5,2) DEFAULT 10.00' },
        { table: 'bot_config', column: 'sg_scale_out_enabled', sql: 'ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS sg_scale_out_enabled BOOLEAN DEFAULT false' },
        { table: 'bot_config', column: 'sg_scale_out_pct', sql: 'ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS sg_scale_out_pct DECIMAL(5,2) DEFAULT 35.00' },
        { table: 'bot_config', column: 'sg_min_part_usd', sql: 'ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS sg_min_part_usd DECIMAL(10,2) DEFAULT 50.00' },
        { table: 'bot_config', column: 'sg_scale_out_threshold', sql: 'ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS sg_scale_out_threshold DECIMAL(5,2) DEFAULT 80.00' },
        { table: 'bot_config', column: 'sg_fee_cushion_pct', sql: 'ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS sg_fee_cushion_pct DECIMAL(5,2) DEFAULT 0.45' },
        { table: 'bot_config', column: 'sg_fee_cushion_auto', sql: 'ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS sg_fee_cushion_auto BOOLEAN DEFAULT true' },
        { table: 'bot_config', column: 'regime_detection_enabled', sql: 'ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS regime_detection_enabled BOOLEAN DEFAULT false' },
        
        // open_positions columns
        { table: 'open_positions', column: 'lot_id', sql: 'ALTER TABLE open_positions ADD COLUMN IF NOT EXISTS lot_id TEXT' },
        { table: 'open_positions', column: 'sg_break_even_activated', sql: 'ALTER TABLE open_positions ADD COLUMN IF NOT EXISTS sg_break_even_activated BOOLEAN DEFAULT false' },
        { table: 'open_positions', column: 'sg_trailing_activated', sql: 'ALTER TABLE open_positions ADD COLUMN IF NOT EXISTS sg_trailing_activated BOOLEAN DEFAULT false' },
        { table: 'open_positions', column: 'sg_current_stop_price', sql: 'ALTER TABLE open_positions ADD COLUMN IF NOT EXISTS sg_current_stop_price DECIMAL(18,8)' },
        { table: 'open_positions', column: 'sg_scale_out_done', sql: 'ALTER TABLE open_positions ADD COLUMN IF NOT EXISTS sg_scale_out_done BOOLEAN DEFAULT false' },
        { table: 'open_positions', column: 'config_snapshot_json', sql: 'ALTER TABLE open_positions ADD COLUMN IF NOT EXISTS config_snapshot_json JSONB' },
      ];
      
      for (const migration of migrations) {
        try {
          await db.execute(sql.raw(migration.sql));
          columnsAdded.push(`${migration.table}.${migration.column}`);
        } catch (e) {
          // Column may already exist, continue
        }
      }
      
      // Backfill lot_id for existing positions without it
      try {
        await db.execute(sql`
          UPDATE open_positions 
          SET lot_id = 'LEGACY-' || id::text || '-' || SUBSTRING(MD5(pair || opened_at::text) FROM 1 FOR 6)
          WHERE lot_id IS NULL
        `);
        
        // Add unique constraint if not exists (safe: only if all lot_ids are unique)
        const duplicates = await db.execute(sql`
          SELECT lot_id, COUNT(*) FROM open_positions WHERE lot_id IS NOT NULL GROUP BY lot_id HAVING COUNT(*) > 1
        `);
        if (duplicates.rows.length === 0) {
          try {
            await db.execute(sql`
              ALTER TABLE open_positions ADD CONSTRAINT open_positions_lot_id_unique UNIQUE (lot_id)
            `);
          } catch (e) {
            // Constraint may already exist
          }
        }
      } catch (e) {
        console.log('[schema] lot_id backfill note:', e);
      }
      
      console.log(`[schema] Migration completed. Columns added: ${columnsAdded.join(', ') || 'none (all exist)'}`);
      return { success: true, columnsAdded };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[schema] Migration failed:', errorMessage);
      return { success: false, columnsAdded, error: errorMessage };
    }
  }

  // Signal configuration methods
  async getSignalConfig(): Promise<any | undefined> {
    try {
      // For now, store signal config in a separate storage approach
      // We'll use a simple file-based approach for now
      const config = await this.getBotConfig();
      if (config && (config as any).signalConfig) {
        return JSON.parse((config as any).signalConfig as string);
      }
      return undefined;
    } catch (error) {
      console.error('[storage] Error getting signal config:', error);
      return undefined;
    }
  }

  async setSignalConfig(config: any): Promise<void> {
    try {
      // Use type assertion to bypass TypeScript checking for now
      await this.updateBotConfig({
        ...(config as any),
        updatedAt: new Date()
      });
    } catch (error) {
      console.error('[storage] Error setting signal config:', error);
      throw error;
    }
  }

  async getRecentScans(limit: number = 100): Promise<any[]> {
    try {
      // For now, return empty array - this would need to be implemented
      // based on actual scan data storage
      console.log(`[storage] Getting recent scans (limit: ${limit})`);
      return [];
    } catch (error) {
      console.error('[storage] Error getting recent scans:', error);
      return [];
    }
  }

  async getRecentScansByTimeframe(timeframe: string): Promise<any[]> {
    try {
      // For now, return empty array - this would need to be implemented
      // based on actual scan data storage
      console.log(`[storage] Getting scans by timeframe: ${timeframe}`);
      return [];
    } catch (error) {
      console.error('[storage] Error getting scans by timeframe:', error);
      return [];
    }
  }

  async getTradesByTimeframe(timeframe: string): Promise<any[]> {
    try {
      // Simple implementation based on existing getTrades method
      const hours = timeframe === '24h' ? 24 : timeframe === '7d' ? 168 : 24;
      const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000);
      
      const trades = await this.getTrades(1000); // Get more trades to filter
      return trades.filter(trade => new Date(trade.createdAt) > cutoffTime);
    } catch (error) {
      console.error('[storage] Error getting trades by timeframe:', error);
      return [];
    }
  }
}

export const storage = new DatabaseStorage();
