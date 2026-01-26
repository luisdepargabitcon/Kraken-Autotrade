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
  type AppliedTrade,
  type OrderIntent,
  type InsertOrderIntent,
  botConfig as botConfigTable,
  trades as tradesTable,
  appliedTrades as appliedTradesTable,
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
  trainingTrades as trainingTradesTable,
  orderIntents as orderIntentsTable
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, gt, lt, sql, isNull, ne, or, inArray } from "drizzle-orm";
import { errorAlertService, ErrorAlertService } from "./services/ErrorAlertService";

type ExchangeSyncScope = 'ALL' | string;

export type ExchangeSyncStateRow = {
  exchange: string;
  scope: string;
  cursorType: string;
  cursorValue: Date | null;
  lastRunAt: Date | null;
  lastOkAt: Date | null;
  lastError: string | null;
};

export interface IStorage {
  getBotConfig(): Promise<BotConfig | undefined>;
  updateBotConfig(config: Partial<InsertBotConfig>): Promise<BotConfig>;
  
  getApiConfig(): Promise<ApiConfig | undefined>;
  updateApiConfig(config: Partial<InsertApiConfig>): Promise<ApiConfig>;
  
  createTrade(trade: InsertTrade): Promise<Trade>;
  insertTradeIgnoreDuplicate(trade: InsertTrade): Promise<{ inserted: boolean; trade?: Trade }>;
  getTrades(limit?: number): Promise<Trade[]>;
  getRecentTradesForReconcile(params: {
    pair: string;
    exchange: 'kraken' | 'revolutx';
    origin?: string;
    since?: Date;
    limit?: number;
    executedByBot?: boolean;
  }): Promise<Trade[]>;
  getClosedTrades(options: { limit?: number; offset?: number; pair?: string; exchange?: 'kraken' | 'revolutx'; result?: 'winner' | 'loser' | 'all'; type?: 'all' | 'buy' | 'sell' }): Promise<{ trades: Trade[]; total: number }>;
  updateTradeStatus(tradeId: string, status: string, krakenOrderId?: string): Promise<void>;
  getTradeByKrakenOrderId(krakenOrderId: string): Promise<Trade | undefined>;
  getTradeByComposite(exchange: string, pair: string, tradeId: string): Promise<Trade | undefined>;
  updateTradeByKrakenOrderId(krakenOrderId: string, patch: Partial<InsertTrade>): Promise<Trade | undefined>;
  getTradeByLotId(lotId: string): Promise<Trade | undefined>;
  getSellMatchingBuy(pair: string, buyLotId: string): Promise<Trade | undefined>;
  upsertTradeByKrakenId(trade: InsertTrade): Promise<{ inserted: boolean; trade?: Trade }>;
  getDuplicateTradesByKrakenId(): Promise<{ krakenOrderId: string; count: number; ids: number[] }[]>;
  deleteDuplicateTrades(): Promise<number>;
  deleteInvalidFilledTrades(): Promise<number>;
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
  deleteOpenPositionsByExchange(exchange: string): Promise<number>;
  getOpenPositionsWithQtyRemaining(): Promise<OpenPosition[]>;
  markTradeApplied(params: { exchange: string; pair: string; tradeId: string }): Promise<boolean>;
  unmarkTradeApplied(params: { exchange: string; pair: string; tradeId: string }): Promise<void>;
  updateOpenPositionQty(lotId: string, qtyRemaining: string, qtyFilled: string): Promise<void>;
  initializeQtyRemainingForAll(): Promise<number>;

  listTradesForRebuild(params: { exchanges: string[]; origin: 'bot' | 'engine'; since: Date }): Promise<Trade[]>;
  getRecentBotTradesCount(params: { since: Date; exchange?: string }): Promise<number>;
  
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

  // Exchange sync cursor state
  getExchangeSyncState(exchange: string, scope: ExchangeSyncScope): Promise<ExchangeSyncStateRow | undefined>;
  upsertExchangeSyncState(state: {
    exchange: string;
    scope: ExchangeSyncScope;
    cursorType: string;
    cursorValue?: Date | null;
    lastRunAt?: Date | null;
    lastOkAt?: Date | null;
    lastError?: string | null;
  }): Promise<void>;
  
  // Signal configuration methods
  getSignalConfig(): Promise<any | undefined>;
  setSignalConfig(config: any): Promise<void>;
  getRecentScans(limit?: number): Promise<any[]>;
  getRecentScansByTimeframe(timeframe: string): Promise<any[]>;
  getTradesByTimeframe(timeframe: string): Promise<any[]>;
  
  // Order intents (bot order attribution)
  createOrderIntent(intent: InsertOrderIntent): Promise<OrderIntent>;
  getOrderIntentByClientOrderId(clientOrderId: string): Promise<OrderIntent | undefined>;
  updateOrderIntentStatus(clientOrderId: string, status: string, exchangeOrderId?: string): Promise<void>;
  matchOrderIntentToTrade(clientOrderId: string, tradeId: number): Promise<void>;
  getPendingOrderIntents(exchange: string): Promise<OrderIntent[]>;
  markTradeAsExecutedByBot(tradeId: number, orderIntentId: number): Promise<void>;
  
  // SMART_GUARD gate functions
  countOccupiedSlotsForPair(exchange: string, pair: string): Promise<{
    openPositions: number;
    pendingFillPositions: number;
    pendingIntents: number;
    acceptedIntents: number;
    total: number;
  }>;
  getLastOrderTimeForPair(exchange: string, pair: string): Promise<Date | null>;
  
  // Backfill functions for legacy positions
  getLegacyPositionsNeedingBackfill(): Promise<OpenPosition[]>;
  findTradesForPositionBackfill(position: OpenPosition): Promise<Trade[]>;
  updatePositionWithBackfill(positionId: number, data: {
    totalCostQuote: number;
    totalAmountBase: number;
    averageEntryPrice: number | null;
    fillCount: number;
    firstFillAt: Date;
    lastFillAt: Date;
    entryPrice: number | null;
  }): Promise<void>;
  updatePositionAsImported(positionId: number): Promise<void>;
  getBackfillStatus(): Promise<{
    totalPositions: number;
    legacyPositions: number;
    backfilledPositions: number;
    importedPositions: number;
  }>;
}

export class DatabaseStorage implements IStorage {
  private schemaMigrationAttempted = false;

  private validateTradeForInsert(trade: InsertTrade) {
    // Allow PENDING trades to exist without a known price (legacy endpoints may insert first and update later)
    if ((trade.status || "pending") !== "filled") return;

    const priceNum = parseFloat(String((trade as any).price ?? "0"));
    const amountNum = parseFloat(String((trade as any).amount ?? "0"));

    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      throw new Error(`Invalid filled trade price (must be > 0): ${trade.price}`);
    }
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      throw new Error(`Invalid filled trade amount (must be > 0): ${trade.amount}`);
    }
  }
  
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
    this.validateTradeForInsert(trade);
    const [newTrade] = await db.insert(tradesTable).values(trade).returning();
    return newTrade;
  }

  // Fast insert for idempotent sync: attempt insert and ignore unique violations
  async insertTradeIgnoreDuplicate(trade: InsertTrade): Promise<{ inserted: boolean; trade?: Trade }> {
    try {
      this.validateTradeForInsert(trade);
      const [newTrade] = await db.insert(tradesTable).values(trade).returning();
      return { inserted: true, trade: newTrade };
    } catch (e: any) {
      if (e?.code === '23505') {
        const exchange = trade.exchange || 'kraken';
        const existing = await this.getTradeByComposite(exchange, trade.pair, trade.tradeId);
        return { inserted: false, trade: existing };
      }
      throw e;
    }
  }

  // Upsert trade - inserta solo si no existe (por krakenOrderId)
  async upsertTradeByKrakenId(trade: InsertTrade): Promise<{ inserted: boolean; trade?: Trade }> {
    if (!trade.krakenOrderId) {
      this.validateTradeForInsert(trade);
      const [newTrade] = await db.insert(tradesTable).values(trade).returning();
      return { inserted: true, trade: newTrade };
    }
    
    // Verificar si existe
    const existing = await this.getTradeByKrakenOrderId(trade.krakenOrderId);
    if (existing) {
      return { inserted: false, trade: existing };
    }
    
    try {
      this.validateTradeForInsert(trade);
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

  // Eliminar trades inválidos históricos (artefactos) para que no contaminen la UI/PnL
  // NOTA: Se limita a RevolutX y a trades sin executedAt, que son los casos típicos de price=0.
  async deleteInvalidFilledTrades(): Promise<number> {
    const result = await db.execute(sql`
      DELETE FROM trades
      WHERE status = 'filled'
        AND exchange = 'revolutx'
        AND executed_at IS NULL
        AND (price <= 0 OR amount <= 0)
    `);
    return Number(result.rowCount || 0);
  }

  async listTradesForRebuild(params: { exchanges: string[]; origin: 'bot' | 'engine'; since: Date }): Promise<Trade[]> {
    const { exchanges, origin, since } = params;
    if (!Array.isArray(exchanges) || exchanges.length === 0) return [];

    return await db.select().from(tradesTable)
      .where(and(
        inArray(tradesTable.exchange, exchanges),
        eq(tradesTable.origin, origin),
        gt(tradesTable.executedAt, since),
      ))
      .orderBy(tradesTable.executedAt);
  }

  async getRecentBotTradesCount(params: { since: Date; exchange?: string }): Promise<number> {
    const { since, exchange } = params;
    // Include both 'bot' (legacy) and 'engine' (new) origins
    const conditions: any[] = [
      or(eq(tradesTable.origin, 'bot'), eq(tradesTable.origin, 'engine')),
      gt(tradesTable.executedAt, since),
    ];
    if (exchange) {
      conditions.push(eq(tradesTable.exchange, exchange));
    }
    const whereClause = conditions.length === 1 ? conditions[0] : and(...conditions);
    const result = await db.select({ count: sql<number>`count(*)` }).from(tradesTable).where(whereClause);
    return Number(result[0]?.count || 0);
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
    // Hide invalid historical artifacts (e.g. filled trades with price=0) from API/UI.
    // Keep pending trades visible.
    return await db.select().from(tradesTable)
      .where(or(
        ne(tradesTable.status, 'filled'),
        and(gt(tradesTable.price, '0'), gt(tradesTable.amount, '0'))
      ))
      .orderBy(desc(tradesTable.createdAt))
      .limit(limit);
  }

  async getRecentTradesForReconcile(params: {
    pair: string;
    exchange: 'kraken' | 'revolutx';
    origin?: string;
    since?: Date;
    limit?: number;
    executedByBot?: boolean;
  }): Promise<Trade[]> {
    const {
      pair,
      exchange,
      origin = 'sync',
      since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      limit = 100,
      executedByBot,
    } = params;

    const conditions: any[] = [
      eq(tradesTable.pair, pair),
      eq(tradesTable.exchange, exchange),
      eq(tradesTable.status, 'filled'),
      gt(tradesTable.executedAt, since),
    ];

    if (origin) {
      conditions.push(eq(tradesTable.origin, origin));
    }
    
    if (executedByBot !== undefined) {
      conditions.push(eq(tradesTable.executedByBot, executedByBot));
    }

    return await db.select().from(tradesTable)
      .where(and(...conditions))
      .orderBy(desc(tradesTable.executedAt))
      .limit(limit);
  }

  async getClosedTrades(options: { limit?: number; offset?: number; pair?: string; exchange?: 'kraken' | 'revolutx'; result?: 'winner' | 'loser' | 'all'; type?: 'all' | 'buy' | 'sell' }): Promise<{ trades: Trade[]; total: number }> {
    const { limit = 10, offset = 0, pair, exchange, result = 'all', type = 'all' } = options;
    
    const conditions: any[] = [];
    
    if (type !== 'all') {
      conditions.push(eq(tradesTable.type, type));
    }
    
    if (pair) {
      conditions.push(eq(tradesTable.pair, pair));
    }

    if (exchange) {
      conditions.push(eq(tradesTable.exchange, exchange));
    }
    
    if (result === 'winner') {
      conditions.push(gt(tradesTable.realizedPnlUsd, '0'));
    } else if (result === 'loser') {
      conditions.push(lt(tradesTable.realizedPnlUsd, '0'));
    }
    
    // Always exclude invalid filled trades from listings.
    const baseValidity = or(
      ne(tradesTable.status, 'filled'),
      and(gt(tradesTable.price, '0'), gt(tradesTable.amount, '0'))
    );
    const whereClause = conditions.length > 0
      ? and(baseValidity, ...(conditions.length === 1 ? [conditions[0]] : conditions))
      : baseValidity;
    
    const tradesQuery = db.select().from(tradesTable)
      .orderBy(desc(tradesTable.executedAt))
      .limit(limit)
      .offset(offset);
    
    const countQuery = db.select({ count: sql<number>`count(*)` }).from(tradesTable);
    
    const trades = await tradesQuery.where(whereClause);
    const countResult = await countQuery.where(whereClause);
    
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

  async getTradeByComposite(exchange: string, pair: string, tradeId: string): Promise<Trade | undefined> {
    const trades = await db.select().from(tradesTable)
      .where(and(
        eq(tradesTable.exchange, exchange),
        eq(tradesTable.pair, pair),
        eq(tradesTable.tradeId, tradeId)
      ))
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

  async deleteOpenPositionsByExchange(exchange: string): Promise<number> {
    const result = await db.execute(sql`
      DELETE FROM open_positions
      WHERE exchange = ${exchange}
    `);
    return Number(result.rowCount || 0);
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

  async markTradeApplied(params: { exchange: string; pair: string; tradeId: string }): Promise<boolean> {
    const { exchange, pair, tradeId } = params;
    const result = await db.execute(sql`
      INSERT INTO applied_trades (exchange, pair, trade_id)
      VALUES (${exchange}, ${pair}, ${tradeId})
      ON CONFLICT (exchange, pair, trade_id)
      DO NOTHING
      RETURNING id
    `);
    return Number(result.rowCount || 0) > 0;
  }

  async unmarkTradeApplied(params: { exchange: string; pair: string; tradeId: string }): Promise<void> {
    const { exchange, pair, tradeId } = params;
    await db.delete(appliedTradesTable)
      .where(and(
        eq(appliedTradesTable.exchange, exchange),
        eq(appliedTradesTable.pair, pair),
        eq(appliedTradesTable.tradeId, tradeId)
      ));
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
      .orderBy(sql`COALESCE(${tradesTable.executedAt}, ${tradesTable.createdAt})`);
  }

  async runTrainingTradesBackfill(): Promise<{ created: number; closed: number; labeled: number; discardReasons: Record<string, number> }> {
    const allTrades = await this.getAllTradesForBackfill();
    const discardReasons: Record<string, number> = {};
    let created = 0;
    let closed = 0;
    let labeled = 0;
    
    const KRAKEN_FEE_RATE = 0.004;
    const REVOLUTX_FEE_RATE = 0.0009;
    const PNL_OUTLIER_THRESHOLD = 100; // Increased from 50% - crypto is volatile
    const MAX_HOLD_TIME_DAYS = 30;
    const MIN_FEE_PCT = 0.1; // Lowered from 0.5% - discount tiers exist
    const MAX_FEE_PCT = 2.5; // Raised from 2.0% - allow for spread costs
    const QTY_EPSILON = 0.00000001;

    const alreadyMatchedSellTxids = new Set<string>();
    const existingSellTxids = await db.select({ sellTxidsJson: trainingTradesTable.sellTxidsJson }).from(trainingTradesTable);
    for (const row of existingSellTxids) {
      const txids = (row.sellTxidsJson as string[]) || [];
      for (const txid of txids) {
        if (txid) alreadyMatchedSellTxids.add(txid);
      }
    }

    const feeRateByExchange = (ex?: string | null) => {
      if (ex === 'revolutx') return REVOLUTX_FEE_RATE;
      return KRAKEN_FEE_RATE;
    };

    const tradesByKey: Record<string, Trade[]> = {};
    for (const trade of allTrades) {
      const ex = ((trade as any).exchange as string | undefined) || 'kraken';
      const key = `${trade.pair}::${ex}`;
      if (!tradesByKey[key]) tradesByKey[key] = [];
      tradesByKey[key].push(trade);
    }
    
    for (const key of Object.keys(tradesByKey)) {
      const [pair, exchange] = key.split('::');
      const feeRate = feeRateByExchange(exchange);
      // Ordenación estable FIFO: timestamp + id (tie-breaker determinista)
      const pairTrades = tradesByKey[key].sort((a, b) => {
        const timeA = a.executedAt ? new Date(a.executedAt).getTime() : new Date(a.createdAt).getTime();
        const timeB = b.executedAt ? new Date(b.executedAt).getTime() : new Date(b.createdAt).getTime();
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
        const tradeTime = trade.executedAt ? new Date(trade.executedAt) : new Date(trade.createdAt);
        const tradeAmount = parseFloat(trade.amount || '0');
        const tradePrice = parseFloat(trade.price || '0');
        const tradeTxid = trade.krakenOrderId || trade.tradeId;
        
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
          const entryFee = buyCost * feeRate;
          
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
          if (alreadyMatchedSellTxids.has(tradeTxid)) {
            continue;
          }
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
            const sellFee = sellRevenue * feeRate;
            
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

  async getExchangeSyncState(exchange: string, scope: ExchangeSyncScope): Promise<ExchangeSyncStateRow | undefined> {
    const result = await db.execute(sql`
      SELECT exchange, scope, cursor_type, cursor_value, last_run_at, last_ok_at, last_error
      FROM exchange_sync_state
      WHERE exchange = ${exchange} AND scope = ${scope}
      LIMIT 1
    `);

    const row = (result.rows as any[])[0];
    if (!row) return undefined;

    return {
      exchange: row.exchange,
      scope: row.scope,
      cursorType: row.cursor_type,
      cursorValue: row.cursor_value ? new Date(row.cursor_value) : null,
      lastRunAt: row.last_run_at ? new Date(row.last_run_at) : null,
      lastOkAt: row.last_ok_at ? new Date(row.last_ok_at) : null,
      lastError: row.last_error ?? null,
    };
  }

  async upsertExchangeSyncState(state: {
    exchange: string;
    scope: ExchangeSyncScope;
    cursorType: string;
    cursorValue?: Date | null;
    lastRunAt?: Date | null;
    lastOkAt?: Date | null;
    lastError?: string | null;
  }): Promise<void> {
    const {
      exchange,
      scope,
      cursorType,
      cursorValue = null,
      lastRunAt = null,
      lastOkAt = null,
      lastError = null,
    } = state;

    await db.execute(sql`
      INSERT INTO exchange_sync_state (exchange, scope, cursor_type, cursor_value, last_run_at, last_ok_at, last_error)
      VALUES (${exchange}, ${scope}, ${cursorType}, ${cursorValue}, ${lastRunAt}, ${lastOkAt}, ${lastError})
      ON CONFLICT (exchange, scope)
      DO UPDATE SET
        cursor_type = EXCLUDED.cursor_type,
        cursor_value = COALESCE(EXCLUDED.cursor_value, exchange_sync_state.cursor_value),
        last_run_at = EXCLUDED.last_run_at,
        last_ok_at = EXCLUDED.last_ok_at,
        last_error = EXCLUDED.last_error
    `);
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

  // === ORDER INTENTS (bot order attribution) ===
  
  async createOrderIntent(intent: InsertOrderIntent): Promise<OrderIntent> {
    const [newIntent] = await db.insert(orderIntentsTable).values(intent).returning();
    return newIntent;
  }

  async getOrderIntentByClientOrderId(clientOrderId: string): Promise<OrderIntent | undefined> {
    const results = await db.select().from(orderIntentsTable)
      .where(eq(orderIntentsTable.clientOrderId, clientOrderId))
      .limit(1);
    return results[0];
  }

  async updateOrderIntentStatus(clientOrderId: string, status: string, exchangeOrderId?: string): Promise<void> {
    const updates: any = { status, updatedAt: new Date() };
    if (exchangeOrderId) {
      updates.exchangeOrderId = exchangeOrderId;
    }
    await db.update(orderIntentsTable)
      .set(updates)
      .where(eq(orderIntentsTable.clientOrderId, clientOrderId));
  }

  async matchOrderIntentToTrade(clientOrderId: string, tradeId: number): Promise<void> {
    await db.update(orderIntentsTable)
      .set({ matchedTradeId: tradeId, status: 'filled', updatedAt: new Date() })
      .where(eq(orderIntentsTable.clientOrderId, clientOrderId));
  }

  async getPendingOrderIntents(exchange: string): Promise<OrderIntent[]> {
    // Return both 'pending' and 'accepted' intents (accepted = order sent but not yet filled)
    return await db.select().from(orderIntentsTable)
      .where(and(
        eq(orderIntentsTable.exchange, exchange),
        or(
          eq(orderIntentsTable.status, 'pending'),
          eq(orderIntentsTable.status, 'accepted')
        )
      ))
      .orderBy(desc(orderIntentsTable.createdAt));
  }

  async markTradeAsExecutedByBot(tradeId: number, orderIntentId: number): Promise<void> {
    await db.update(tradesTable)
      .set({ executedByBot: true, orderIntentId })
      .where(eq(tradesTable.id, tradeId));
  }

  // === INSTANT POSITION CREATION & AVERAGE ENTRY PRICE ===

  /**
   * Create a new position in PENDING_FILL state (before fills arrive)
   * Called immediately when order is accepted by exchange
   */
  async createPendingPosition(data: {
    lotId: string;
    exchange: string;
    pair: string;
    clientOrderId: string;
    venueOrderId?: string; // ID returned by exchange for order status queries
    orderIntentId?: number;
    expectedAmount: string;
    entryMode?: string;
    configSnapshotJson?: any;
    entryStrategyId?: string;
    signalReason?: string;
  }): Promise<any> {
    const [position] = await db.insert(openPositionsTable).values({
      lotId: data.lotId,
      exchange: data.exchange,
      pair: data.pair,
      clientOrderId: data.clientOrderId,
      venueOrderId: data.venueOrderId,
      orderIntentId: data.orderIntentId,
      expectedAmount: data.expectedAmount,
      status: 'PENDING_FILL',
      entryPrice: '0', // Will be set when fills arrive
      amount: '0', // Will be updated with fills
      highestPrice: '0', // Will be set when fills arrive
      totalCostQuote: '0',
      totalAmountBase: '0',
      averageEntryPrice: null,
      fillCount: 0,
      entryMode: data.entryMode || 'SMART_GUARD',
      configSnapshotJson: data.configSnapshotJson,
      entryStrategyId: data.entryStrategyId || 'momentum_cycle',
      signalReason: data.signalReason,
      openedAt: new Date(),
      updatedAt: new Date(),
    }).returning();
    
    console.log(`[storage] Created PENDING_FILL position: ${data.pair} (clientOrderId: ${data.clientOrderId}, venueOrderId: ${data.venueOrderId})`);
    return position;
  }

  /**
   * Get position by clientOrderId (for upsert/update)
   */
  async getPositionByClientOrderId(clientOrderId: string): Promise<any | undefined> {
    const results = await db.select().from(openPositionsTable)
      .where(eq(openPositionsTable.clientOrderId, clientOrderId))
      .limit(1);
    return results[0];
  }

  /**
   * Get position by venueOrderId (exchange order ID for fill matching)
   */
  async getPositionByVenueOrderId(venueOrderId: string): Promise<any | undefined> {
    const results = await db.select().from(openPositionsTable)
      .where(eq(openPositionsTable.venueOrderId, venueOrderId))
      .limit(1);
    return results[0];
  }

  /**
   * Update position with a new fill (aggregates cost and amount)
   * Calculates average_entry_price = total_cost_quote / total_amount_base
   */
  async updatePositionWithFill(clientOrderId: string, fill: {
    fillId: string;
    price: number;
    amount: number;
    executedAt: Date;
  }): Promise<any | undefined> {
    // Get current position
    const position = await this.getPositionByClientOrderId(clientOrderId);
    if (!position) {
      console.error(`[storage] Position not found for clientOrderId: ${clientOrderId}`);
      return undefined;
    }

    // Calculate new aggregates
    const currentCost = parseFloat(position.totalCostQuote || '0');
    const currentAmount = parseFloat(position.totalAmountBase || '0');
    const fillCost = fill.price * fill.amount;
    
    const newTotalCost = currentCost + fillCost;
    const newTotalAmount = currentAmount + fill.amount;
    const newAvgPrice = newTotalAmount > 0 ? newTotalCost / newTotalAmount : 0;
    const newFillCount = (position.fillCount || 0) + 1;
    
    const isFirstFill = currentAmount === 0;
    
    // Update position
    const [updated] = await db.update(openPositionsTable)
      .set({
        status: 'OPEN',
        totalCostQuote: newTotalCost.toString(),
        totalAmountBase: newTotalAmount.toString(),
        averageEntryPrice: newAvgPrice.toString(),
        entryPrice: newAvgPrice.toString(), // Keep entryPrice in sync
        amount: newTotalAmount.toString(),
        highestPrice: newAvgPrice.toString(), // Initialize highest to entry
        fillCount: newFillCount,
        lastFillId: fill.fillId,
        firstFillAt: isFirstFill ? fill.executedAt : position.firstFillAt,
        lastFillAt: fill.executedAt,
        updatedAt: new Date(),
      })
      .where(eq(openPositionsTable.clientOrderId, clientOrderId))
      .returning();

    // Best-effort: when position is opened via fill, mark the order intent as filled.
    try {
      await this.updateOrderIntentStatus(clientOrderId, 'filled');
    } catch (e) {
      // best-effort
    }

    console.log(`[storage] Updated position ${position.pair} with fill: +${fill.amount} @ ${fill.price}, avgPrice=${newAvgPrice.toFixed(8)}, total=${newTotalAmount}`);
    return updated;
  }

  /**
   * Mark position as FAILED (e.g., order rejected, timeout with no fills)
   * IDEMPOTENT: Only updates if status is still PENDING_FILL (avoids race with late fills)
   */
  async markPositionFailed(clientOrderId: string, reason?: string): Promise<void> {
    // CRITICAL: Only mark as FAILED if still PENDING_FILL - avoids overwriting OPEN positions
    const result = await db.update(openPositionsTable)
      .set({
        status: 'FAILED',
        signalReason: reason ? `FAILED: ${reason}` : 'FAILED',
        updatedAt: new Date(),
      })
      .where(and(
        eq(openPositionsTable.clientOrderId, clientOrderId),
        eq(openPositionsTable.status, 'PENDING_FILL') // IDEMPOTENT: Only if still pending
      ))
      .returning();
    
    if (result.length > 0) {
      console.log(`[storage] Marked position FAILED: ${clientOrderId} - ${reason}`);
    } else {
      console.log(`[storage] markPositionFailed skipped (not PENDING_FILL or not found): ${clientOrderId}`);
    }
  }

  /**
   * Mark position as CANCELLED
   */
  async markPositionCancelled(clientOrderId: string): Promise<void> {
    await db.update(openPositionsTable)
      .set({
        status: 'CANCELLED',
        updatedAt: new Date(),
      })
      .where(eq(openPositionsTable.clientOrderId, clientOrderId));
    console.log(`[storage] Marked position CANCELLED: ${clientOrderId}`);
  }

  /**
   * SMART_GUARD GATE: Count active positions + pending intents for a pair
   * Returns the total "occupied slots" that should block new BUYs:
   * - Positions with status PENDING_FILL or OPEN
   * - Order intents with status pending or accepted (not yet filled)
   */
  async countOccupiedSlotsForPair(exchange: string, pair: string): Promise<{
    openPositions: number;
    pendingFillPositions: number;
    pendingIntents: number;
    acceptedIntents: number;
    total: number;
  }> {
    // Normalize pair format
    const normalizedPair = pair.replace('-', '/').toUpperCase();
    const altPair = pair.replace('/', '-').toUpperCase();
    
    // Count OPEN positions
    const openPositions = await db.select({ count: sql<number>`count(*)` })
      .from(openPositionsTable)
      .where(and(
        eq(openPositionsTable.exchange, exchange),
        or(
          eq(openPositionsTable.pair, normalizedPair),
          eq(openPositionsTable.pair, altPair)
        ),
        eq(openPositionsTable.status, 'OPEN')
      ));
    
    // Count PENDING_FILL positions
    const pendingFillPositions = await db.select({ count: sql<number>`count(*)` })
      .from(openPositionsTable)
      .where(and(
        eq(openPositionsTable.exchange, exchange),
        or(
          eq(openPositionsTable.pair, normalizedPair),
          eq(openPositionsTable.pair, altPair)
        ),
        eq(openPositionsTable.status, 'PENDING_FILL')
      ));
    
    // Count pending order intents (BUY only)
    const pendingIntents = await db.select({ count: sql<number>`count(*)` })
      .from(orderIntentsTable)
      .where(and(
        eq(orderIntentsTable.exchange, exchange),
        or(
          eq(orderIntentsTable.pair, normalizedPair),
          eq(orderIntentsTable.pair, altPair)
        ),
        eq(orderIntentsTable.side, 'buy'),
        eq(orderIntentsTable.status, 'pending')
      ));
    
    // Count accepted order intents (BUY only, submitted but not yet filled/position created)
    const acceptedIntents = await db.select({ count: sql<number>`count(*)` })
      .from(orderIntentsTable)
      .where(and(
        eq(orderIntentsTable.exchange, exchange),
        or(
          eq(orderIntentsTable.pair, normalizedPair),
          eq(orderIntentsTable.pair, altPair)
        ),
        eq(orderIntentsTable.side, 'buy'),
        eq(orderIntentsTable.status, 'accepted')
      ));
    
    const openCount = Number(openPositions[0]?.count || 0);
    const pendingFillCount = Number(pendingFillPositions[0]?.count || 0);
    const pendingIntentCount = Number(pendingIntents[0]?.count || 0);
    const acceptedIntentCount = Number(acceptedIntents[0]?.count || 0);
    
    // Total occupied = positions (OPEN + PENDING_FILL) + intents still in flight
    // Note: We don't double-count - accepted intents that created PENDING_FILL positions 
    // are counted only once via the position
    const total = openCount + pendingFillCount + pendingIntentCount;
    
    return {
      openPositions: openCount,
      pendingFillPositions: pendingFillCount,
      pendingIntents: pendingIntentCount,
      acceptedIntents: acceptedIntentCount,
      total,
    };
  }

  /**
   * Get the last order submission time for a pair (for cooldown)
   */
  async getLastOrderTimeForPair(exchange: string, pair: string): Promise<Date | null> {
    const normalizedPair = pair.replace('-', '/').toUpperCase();
    const altPair = pair.replace('/', '-').toUpperCase();
    
    const results = await db.select({ createdAt: orderIntentsTable.createdAt })
      .from(orderIntentsTable)
      .where(and(
        eq(orderIntentsTable.exchange, exchange),
        or(
          eq(orderIntentsTable.pair, normalizedPair),
          eq(orderIntentsTable.pair, altPair)
        ),
        eq(orderIntentsTable.side, 'buy')
      ))
      .orderBy(desc(orderIntentsTable.createdAt))
      .limit(1);
    
    return results[0]?.createdAt || null;
  }

  /**
   * Get all pending fill positions (for recovery/cleanup)
   */
  async getPendingFillPositions(exchange?: string): Promise<any[]> {
    if (exchange) {
      return await db.select().from(openPositionsTable)
        .where(and(
          eq(openPositionsTable.status, 'PENDING_FILL'),
          eq(openPositionsTable.exchange, exchange)
        ))
        .orderBy(desc(openPositionsTable.openedAt));
    }
    return await db.select().from(openPositionsTable)
      .where(eq(openPositionsTable.status, 'PENDING_FILL'))
      .orderBy(desc(openPositionsTable.openedAt));
  }

  /**
   * Recalculate position aggregates from trades (for reconcile/repair)
   */
  async recalculatePositionAggregates(positionId: number): Promise<any | undefined> {
    // Get position
    const [position] = await db.select().from(openPositionsTable)
      .where(eq(openPositionsTable.id, positionId))
      .limit(1);
    
    if (!position) return undefined;

    // Get all trades linked to this position
    const trades = await db.select().from(tradesTable)
      .where(and(
        eq(tradesTable.exchange, position.exchange),
        eq(tradesTable.pair, position.pair),
        eq(tradesTable.type, 'buy'),
        eq(tradesTable.executedByBot, true)
      ))
      .orderBy(tradesTable.executedAt);

    if (trades.length === 0) return position;

    // Recalculate aggregates
    let totalCost = 0;
    let totalAmount = 0;
    for (const trade of trades) {
      const price = parseFloat(trade.price);
      const amount = parseFloat(trade.amount);
      totalCost += price * amount;
      totalAmount += amount;
    }

    const avgPrice = totalAmount > 0 ? totalCost / totalAmount : 0;

    // Update position
    const [updated] = await db.update(openPositionsTable)
      .set({
        totalCostQuote: totalCost.toString(),
        totalAmountBase: totalAmount.toString(),
        averageEntryPrice: avgPrice.toString(),
        entryPrice: avgPrice.toString(),
        amount: totalAmount.toString(),
        fillCount: trades.length,
        updatedAt: new Date(),
      })
      .where(eq(openPositionsTable.id, positionId))
      .returning();

    console.log(`[storage] Recalculated position ${position.pair}: avgPrice=${avgPrice.toFixed(8)}, totalAmount=${totalAmount}`);
    return updated;
  }

  // Backfill functions for legacy positions
  async getLegacyPositionsNeedingBackfill(): Promise<OpenPosition[]> {
    return await db.select().from(openPositionsTable)
      .where(and(
        eq(openPositionsTable.status, 'OPEN'),
        sql`total_amount_base = 0`,
        isNull(openPositionsTable.clientOrderId)
      ));
  }

  async findTradesForPositionBackfill(position: OpenPosition): Promise<Trade[]> {
    const positionTime = new Date(position.openedAt);
    const windowStart = new Date(positionTime.getTime() - 24 * 60 * 60 * 1000); // 24h before
    const windowEnd = new Date(positionTime.getTime() + 2 * 60 * 60 * 1000); // 2h after

    return await db.select().from(tradesTable)
      .where(and(
        eq(tradesTable.exchange, position.exchange),
        eq(tradesTable.pair, position.pair),
        eq(tradesTable.type, 'buy'),
        gt(tradesTable.executedAt, windowStart),
        lt(tradesTable.executedAt, windowEnd)
      ))
      .orderBy(tradesTable.executedAt);
  }

  async updatePositionWithBackfill(positionId: number, data: {
    totalCostQuote: number;
    totalAmountBase: number;
    averageEntryPrice: number | null;
    fillCount: number;
    firstFillAt: Date;
    lastFillAt: Date;
    entryPrice: number | null;
  }): Promise<void> {
    await db.update(openPositionsTable)
      .set({
        totalCostQuote: data.totalCostQuote.toString(),
        totalAmountBase: data.totalAmountBase.toString(),
        averageEntryPrice: data.averageEntryPrice?.toString(),
        entryPrice: data.entryPrice?.toString(),
        fillCount: data.fillCount,
        firstFillAt: data.firstFillAt,
        lastFillAt: data.lastFillAt,
        updatedAt: new Date(),
      })
      .where(eq(openPositionsTable.id, positionId));
  }

  async updatePositionAsImported(positionId: number): Promise<void> {
    await db.update(openPositionsTable)
      .set({
        entryMode: 'IMPORTED',
        updatedAt: new Date(),
      })
      .where(eq(openPositionsTable.id, positionId));
  }

  async getBackfillStatus(): Promise<{
    totalPositions: number;
    legacyPositions: number;
    backfilledPositions: number;
    importedPositions: number;
  }> {
    const [totalResult] = await db.select({ count: sql`count(*)` }).from(openPositionsTable);
    const [legacyResult] = await db.select({ count: sql`count(*)` }).from(openPositionsTable)
      .where(and(
        eq(openPositionsTable.status, 'OPEN'),
        sql`total_amount_base = 0`,
        isNull(openPositionsTable.clientOrderId)
      ));
    const [backfilledResult] = await db.select({ count: sql`count(*)` }).from(openPositionsTable)
      .where(and(
        eq(openPositionsTable.status, 'OPEN'),
        sql`total_amount_base > 0`
      ));
    const [importedResult] = await db.select({ count: sql`count(*)` }).from(openPositionsTable)
      .where(eq(openPositionsTable.entryMode, 'IMPORTED'));

    return {
      totalPositions: Number(totalResult.count),
      legacyPositions: Number(legacyResult.count),
      backfilledPositions: Number(backfilledResult.count),
      importedPositions: Number(importedResult.count),
    };
  }
}

export const storage = new DatabaseStorage();
