/**
 * IdcaRepository — Data access layer for the Institutional DCA module.
 * Completely isolated from the main bot's storage.
 */
import { db } from "../../db";
import { eq, desc, and, sql, lt, ne, inArray } from "drizzle-orm";
import {
  tradingEngineControls,
  institutionalDcaConfig,
  institutionalDcaAssetConfigs,
  institutionalDcaCycles,
  institutionalDcaOrders,
  institutionalDcaEvents,
  institutionalDcaBacktests,
  institutionalDcaSimulationWallet,
  institutionalDcaOhlcvCache,
  type TradingEngineControls,
  type InsertTradingEngineControls,
  type InstitutionalDcaConfigRow,
  type InsertInstitutionalDcaConfig,
  type InstitutionalDcaAssetConfigRow,
  type InsertInstitutionalDcaAssetConfig,
  type InstitutionalDcaCycle,
  type InsertInstitutionalDcaCycle,
  type InstitutionalDcaOrder,
  type InsertInstitutionalDcaOrder,
  type InstitutionalDcaEvent,
  type InsertInstitutionalDcaEvent,
  type InstitutionalDcaBacktest,
  type InsertInstitutionalDcaBacktest,
  type InstitutionalDcaSimulationWalletRow,
  type InsertInstitutionalDcaSimulationWallet,
  type InstitutionalDcaOhlcvCacheRow,
  type InsertInstitutionalDcaOhlcvCache,
} from "@shared/schema";

// ─── Trading Engine Controls ───────────────────────────────────────

export async function getTradingEngineControls(): Promise<TradingEngineControls> {
  const rows = await db.select().from(tradingEngineControls).limit(1);
  if (rows.length === 0) {
    const [created] = await db.insert(tradingEngineControls).values({}).returning();
    return created;
  }
  return rows[0];
}

export async function updateTradingEngineControls(
  patch: Partial<Omit<InsertTradingEngineControls, "id">>
): Promise<TradingEngineControls> {
  const current = await getTradingEngineControls();
  const [updated] = await db
    .update(tradingEngineControls)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(tradingEngineControls.id, current.id))
    .returning();
  return updated;
}

// ─── IDCA Config ───────────────────────────────────────────────────

export async function getIdcaConfig(): Promise<InstitutionalDcaConfigRow> {
  const rows = await db.select().from(institutionalDcaConfig).limit(1);
  if (rows.length === 0) {
    const [created] = await db.insert(institutionalDcaConfig).values({}).returning();
    return created;
  }
  return rows[0];
}

export async function updateIdcaConfig(
  patch: Partial<Omit<InsertInstitutionalDcaConfig, "id" | "createdAt">>
): Promise<InstitutionalDcaConfigRow> {
  const current = await getIdcaConfig();
  const [updated] = await db
    .update(institutionalDcaConfig)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(institutionalDcaConfig.id, current.id))
    .returning();
  return updated;
}

// ─── Asset Configs ─────────────────────────────────────────────────

export async function getAssetConfigs(): Promise<InstitutionalDcaAssetConfigRow[]> {
  return db.select().from(institutionalDcaAssetConfigs);
}

export async function getAssetConfig(pair: string): Promise<InstitutionalDcaAssetConfigRow | undefined> {
  const rows = await db
    .select()
    .from(institutionalDcaAssetConfigs)
    .where(eq(institutionalDcaAssetConfigs.pair, pair))
    .limit(1);
  return rows[0];
}

export async function upsertAssetConfig(
  pair: string,
  patch: Partial<Omit<InsertInstitutionalDcaAssetConfig, "id" | "createdAt">>
): Promise<InstitutionalDcaAssetConfigRow> {
  const existing = await getAssetConfig(pair);
  if (!existing) {
    const [created] = await db
      .insert(institutionalDcaAssetConfigs)
      .values({ pair, ...patch } as InsertInstitutionalDcaAssetConfig)
      .returning();
    return created;
  }
  const [updated] = await db
    .update(institutionalDcaAssetConfigs)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(institutionalDcaAssetConfigs.id, existing.id))
    .returning();
  return updated;
}

// ─── Cycles ────────────────────────────────────────────────────────

export async function getActiveCycle(
  pair: string,
  mode: string
): Promise<InstitutionalDcaCycle | undefined> {
  const rows = await db
    .select()
    .from(institutionalDcaCycles)
    .where(
      and(
        eq(institutionalDcaCycles.pair, pair),
        eq(institutionalDcaCycles.mode, mode),
        eq(institutionalDcaCycles.cycleType, "main"),
        ne(institutionalDcaCycles.status, "closed")
      )
    )
    .limit(1);
  return rows[0];
}

export async function getActivePlusCycle(
  pair: string,
  mode: string,
  parentCycleId: number
): Promise<InstitutionalDcaCycle | undefined> {
  const rows = await db
    .select()
    .from(institutionalDcaCycles)
    .where(
      and(
        eq(institutionalDcaCycles.pair, pair),
        eq(institutionalDcaCycles.mode, mode),
        eq(institutionalDcaCycles.cycleType, "plus"),
        eq(institutionalDcaCycles.parentCycleId, parentCycleId),
        ne(institutionalDcaCycles.status, "closed")
      )
    )
    .limit(1);
  return rows[0];
}

export async function getClosedPlusCyclesCount(
  parentCycleId: number
): Promise<number> {
  const rows = await db
    .select()
    .from(institutionalDcaCycles)
    .where(
      and(
        eq(institutionalDcaCycles.cycleType, "plus"),
        eq(institutionalDcaCycles.parentCycleId, parentCycleId),
        eq(institutionalDcaCycles.status, "closed")
      )
    );
  return rows.length;
}

export async function getActiveRecoveryCycles(
  pair: string,
  mode: string,
  parentCycleId: number
): Promise<InstitutionalDcaCycle[]> {
  return db
    .select()
    .from(institutionalDcaCycles)
    .where(
      and(
        eq(institutionalDcaCycles.pair, pair),
        eq(institutionalDcaCycles.mode, mode),
        eq(institutionalDcaCycles.cycleType, "recovery"),
        eq(institutionalDcaCycles.parentCycleId, parentCycleId),
        ne(institutionalDcaCycles.status, "closed")
      )
    );
}

export async function getClosedRecoveryCyclesCount(
  parentCycleId: number
): Promise<number> {
  const rows = await db
    .select()
    .from(institutionalDcaCycles)
    .where(
      and(
        eq(institutionalDcaCycles.cycleType, "recovery"),
        eq(institutionalDcaCycles.parentCycleId, parentCycleId),
        eq(institutionalDcaCycles.status, "closed")
      )
    );
  return rows.length;
}

export async function getTotalPairExposureUsd(
  pair: string,
  mode: string
): Promise<number> {
  const rows = await db
    .select()
    .from(institutionalDcaCycles)
    .where(
      and(
        eq(institutionalDcaCycles.pair, pair),
        eq(institutionalDcaCycles.mode, mode),
        ne(institutionalDcaCycles.status, "closed")
      )
    );
  return rows.reduce((sum, c) => sum + parseFloat(String(c.capitalUsedUsd || "0")), 0);
}

export async function getAllActiveCyclesForPair(pair: string, mode: string): Promise<InstitutionalDcaCycle[]> {
  return db
    .select()
    .from(institutionalDcaCycles)
    .where(
      and(
        eq(institutionalDcaCycles.pair, pair),
        eq(institutionalDcaCycles.mode, mode),
        ne(institutionalDcaCycles.status, "closed")
      )
    );
}

export async function getAllActiveCycles(mode?: string): Promise<InstitutionalDcaCycle[]> {
  if (mode) {
    return db
      .select()
      .from(institutionalDcaCycles)
      .where(
        and(
          eq(institutionalDcaCycles.mode, mode),
          ne(institutionalDcaCycles.status, "closed")
        )
      );
  }
  return db
    .select()
    .from(institutionalDcaCycles)
    .where(ne(institutionalDcaCycles.status, "closed"));
}

export async function createCycle(
  data: InsertInstitutionalDcaCycle
): Promise<InstitutionalDcaCycle> {
  const [created] = await db
    .insert(institutionalDcaCycles)
    .values(data)
    .returning();
  return created;
}

export async function updateCycle(
  id: number,
  patch: Partial<Omit<InsertInstitutionalDcaCycle, "id" | "startedAt">>
): Promise<InstitutionalDcaCycle> {
  const [updated] = await db
    .update(institutionalDcaCycles)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(institutionalDcaCycles.id, id))
    .returning();
  return updated;
}

export async function getCycleById(id: number): Promise<InstitutionalDcaCycle | undefined> {
  const rows = await db
    .select()
    .from(institutionalDcaCycles)
    .where(eq(institutionalDcaCycles.id, id))
    .limit(1);
  return rows[0];
}

export async function getCycles(options: {
  mode?: string;
  pair?: string;
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<InstitutionalDcaCycle[]> {
  let query = db.select().from(institutionalDcaCycles);
  const conditions = [];
  if (options.mode) conditions.push(eq(institutionalDcaCycles.mode, options.mode));
  if (options.pair) conditions.push(eq(institutionalDcaCycles.pair, options.pair));
  if (options.status) conditions.push(eq(institutionalDcaCycles.status, options.status));
  if (conditions.length > 0) query = query.where(and(...conditions)) as any;
  query = query.orderBy(desc(institutionalDcaCycles.startedAt)) as any;
  if (options.limit) query = query.limit(options.limit) as any;
  if (options.offset) query = (query as any).offset(options.offset);
  return query;
}

/**
 * Elimina un ciclo manual/importado de forma segura.
 * Reglas:
 *  - Solo ciclos con is_imported=true O source_type='manual'
 *  - Si tiene órdenes SELL ejecutadas post-importación → soft delete (archived)
 *  - Si no tiene actividad post-importación → hard delete (ciclo + órdenes + eventos)
 *
 * @returns { deleted: boolean; archived: boolean; reason: string; ordersDeleted: number; eventsDeleted: number }
 */
export async function deleteManualCycle(cycleId: number): Promise<{
  deleted: boolean;
  archived: boolean;
  reason: string;
  ordersDeleted: number;
  eventsDeleted: number;
  cycle: InstitutionalDcaCycle | null;
}> {
  // 1. Fetch the cycle
  const [cycle] = await db
    .select()
    .from(institutionalDcaCycles)
    .where(eq(institutionalDcaCycles.id, cycleId))
    .limit(1);

  if (!cycle) {
    return { deleted: false, archived: false, reason: 'CYCLE_NOT_FOUND', ordersDeleted: 0, eventsDeleted: 0, cycle: null };
  }

  // 2. Verify it's a manual/imported cycle
  const isManual = cycle.isImported === true || cycle.sourceType === 'manual';
  if (!isManual) {
    return { deleted: false, archived: false, reason: 'NOT_MANUAL_CYCLE', ordersDeleted: 0, eventsDeleted: 0, cycle };
  }

  // 3. Check for post-import sell orders (real activity generated by the system)
  const orders = await db
    .select()
    .from(institutionalDcaOrders)
    .where(eq(institutionalDcaOrders.cycleId, cycleId));

  const postImportSells = orders.filter(o => {
    if (o.side !== 'sell') return false;
    // If the cycle was imported, any sell order is post-import activity
    // Unless it was part of the import itself (check importNotes or timing)
    const importedAt = cycle.importedAt ? new Date(cycle.importedAt).getTime() : 0;
    const orderTime = o.executedAt ? new Date(o.executedAt).getTime() : 0;
    // If order was created after import, it's system-generated
    return importedAt > 0 && orderTime > importedAt;
  });

  if (postImportSells.length > 0) {
    // Soft delete: archive the cycle instead of hard deleting
    await db
      .update(institutionalDcaCycles)
      .set({
        status: 'archived',
        closeReason: 'manual_archived_by_user',
        closedAt: new Date(),
      })
      .where(eq(institutionalDcaCycles.id, cycleId));

    return {
      deleted: false,
      archived: true,
      reason: 'ARCHIVED_HAS_POST_IMPORT_ACTIVITY',
      ordersDeleted: 0,
      eventsDeleted: 0,
      cycle,
    };
  }

  // 4. Safe to hard delete — no post-import activity
  // Delete events first (FK dependency)
  const deletedEvents = await db
    .delete(institutionalDcaEvents)
    .where(eq(institutionalDcaEvents.cycleId, cycleId))
    .returning();

  // Delete orders
  const deletedOrders = await db
    .delete(institutionalDcaOrders)
    .where(eq(institutionalDcaOrders.cycleId, cycleId))
    .returning();

  // Delete the cycle itself
  await db
    .delete(institutionalDcaCycles)
    .where(eq(institutionalDcaCycles.id, cycleId));

  return {
    deleted: true,
    archived: false,
    reason: 'HARD_DELETED',
    ordersDeleted: deletedOrders.length,
    eventsDeleted: deletedEvents.length,
    cycle,
  };
}

export async function closeCyclesBulk(
  mode: string,
  reason: string,
  currentPrices: Record<string, number>
): Promise<number> {
  const activeCycles = await getAllActiveCycles(mode);
  let closed = 0;
  for (const cycle of activeCycles) {
    const price = currentPrices[cycle.pair] || 0;
    await updateCycle(cycle.id, {
      status: "closed",
      closeReason: reason,
      currentPrice: price.toFixed(8),
      closedAt: new Date(),
    });
    closed++;
  }
  return closed;
}

// ─── Orders ────────────────────────────────────────────────────────

export async function createOrder(
  data: InsertInstitutionalDcaOrder
): Promise<InstitutionalDcaOrder> {
  const [created] = await db
    .insert(institutionalDcaOrders)
    .values(data)
    .returning();
  return created;
}

export async function getOrdersByCycle(cycleId: number): Promise<InstitutionalDcaOrder[]> {
  return db
    .select()
    .from(institutionalDcaOrders)
    .where(eq(institutionalDcaOrders.cycleId, cycleId))
    .orderBy(desc(institutionalDcaOrders.executedAt));
}

export async function getOrderHistory(options: {
  mode?: string;
  pair?: string;
  limit?: number;
  offset?: number;
}): Promise<InstitutionalDcaOrder[]> {
  let query = db.select().from(institutionalDcaOrders);
  const conditions = [];
  if (options.mode) conditions.push(eq(institutionalDcaOrders.mode, options.mode));
  if (options.pair) conditions.push(eq(institutionalDcaOrders.pair, options.pair));
  if (conditions.length > 0) query = query.where(and(...conditions)) as any;
  query = query.orderBy(desc(institutionalDcaOrders.executedAt)) as any;
  if (options.limit) query = query.limit(options.limit) as any;
  if (options.offset) query = (query as any).offset(options.offset);
  return query;
}

// ─── Events ────────────────────────────────────────────────────────

export async function createEvent(
  data: InsertInstitutionalDcaEvent
): Promise<InstitutionalDcaEvent> {
  const [created] = await db
    .insert(institutionalDcaEvents)
    .values(data)
    .returning();
  return created;
}

export async function getEvents(options: {
  cycleId?: number;
  eventType?: string;
  limit?: number;
  offset?: number;
}): Promise<InstitutionalDcaEvent[]> {
  let query = db.select().from(institutionalDcaEvents);
  const conditions = [];
  if (options.cycleId) conditions.push(eq(institutionalDcaEvents.cycleId, options.cycleId));
  if (options.eventType) conditions.push(eq(institutionalDcaEvents.eventType, options.eventType));
  if (conditions.length > 0) query = query.where(and(...conditions)) as any;
  query = query.orderBy(desc(institutionalDcaEvents.createdAt)) as any;
  if (options.limit) query = query.limit(options.limit) as any;
  if (options.offset) query = (query as any).offset(options.offset);
  return query;
}

export async function purgeOldEvents(retentionDays: number): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const result = await db
    .delete(institutionalDcaEvents)
    .where(lt(institutionalDcaEvents.createdAt, cutoff));
  return (result as any).rowCount || 0;
}

// ─── Backtests ─────────────────────────────────────────────────────

export async function createBacktest(
  data: InsertInstitutionalDcaBacktest
): Promise<InstitutionalDcaBacktest> {
  const [created] = await db
    .insert(institutionalDcaBacktests)
    .values(data)
    .returning();
  return created;
}

export async function getBacktests(limit = 20): Promise<InstitutionalDcaBacktest[]> {
  return db
    .select()
    .from(institutionalDcaBacktests)
    .orderBy(desc(institutionalDcaBacktests.createdAt))
    .limit(limit);
}

// ─── Simulation Wallet ─────────────────────────────────────────────

export async function getSimulationWallet(): Promise<InstitutionalDcaSimulationWalletRow> {
  const rows = await db.select().from(institutionalDcaSimulationWallet).limit(1);
  if (rows.length === 0) {
    const [created] = await db
      .insert(institutionalDcaSimulationWallet)
      .values({})
      .returning();
    return created;
  }
  return rows[0];
}

export async function updateSimulationWallet(
  patch: Partial<Omit<InsertInstitutionalDcaSimulationWallet, "id">>
): Promise<InstitutionalDcaSimulationWalletRow> {
  const current = await getSimulationWallet();
  const [updated] = await db
    .update(institutionalDcaSimulationWallet)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(institutionalDcaSimulationWallet.id, current.id))
    .returning();
  return updated;
}

export async function resetSimulation(
  initialBalance?: number
): Promise<{ wallet: InstitutionalDcaSimulationWalletRow; cyclesClosed: number; ordersDeleted: number; eventsDeleted: number }> {
  const config = await getIdcaConfig();
  const balance = initialBalance || parseFloat(String(config.simulationInitialBalanceUsd));

  // 1. Get all simulation cycles to count and delete their orders/events
  const simulationCycles = await getAllActiveCycles('simulation');
  const simulationClosedCycles = await getCycles({ mode: 'simulation', status: 'closed', limit: 10000 });
  const allSimulationCycleIds = [
    ...simulationCycles.map(c => c.id),
    ...simulationClosedCycles.map(c => c.id)
  ];

  // 2. Delete all orders for simulation cycles
  let ordersDeleted = 0;
  for (const cycleId of allSimulationCycleIds) {
    const deletedOrders = await db
      .delete(institutionalDcaOrders)
      .where(eq(institutionalDcaOrders.cycleId, cycleId))
      .returning();
    ordersDeleted += deletedOrders.length;
  }

  // 3. Delete all events for simulation mode
  const deletedEvents = await db
    .delete(institutionalDcaEvents)
    .where(eq(institutionalDcaEvents.mode, 'simulation'))
    .returning();
  const eventsDeleted = deletedEvents.length;

  // 4. Delete all simulation cycles (both active and closed)
  await db
    .delete(institutionalDcaCycles)
    .where(eq(institutionalDcaCycles.mode, 'simulation'));

  // 5. Reset wallet
  const wallet = await updateSimulationWallet({
    initialBalanceUsd: balance.toFixed(2),
    availableBalanceUsd: balance.toFixed(2),
    usedBalanceUsd: "0",
    realizedPnlUsd: "0",
    unrealizedPnlUsd: "0",
    totalEquityUsd: balance.toFixed(2),
    totalCyclesSimulated: 0,
    totalOrdersSimulated: 0,
    lastResetAt: new Date(),
  });

  return {
    wallet,
    cyclesClosed: allSimulationCycleIds.length,
    ordersDeleted,
    eventsDeleted
  };
}

// ─── Order Deletion ────────────────────────────────────────────────

export async function deleteOrder(orderId: number): Promise<boolean> {
  const result = await db
    .delete(institutionalDcaOrders)
    .where(eq(institutionalDcaOrders.id, orderId))
    .returning();
  return result.length > 0;
}

export async function deleteOrdersByCycle(cycleId: number): Promise<number> {
  const result = await db
    .delete(institutionalDcaOrders)
    .where(eq(institutionalDcaOrders.cycleId, cycleId))
    .returning();
  return result.length;
}

export async function deleteAllOrders(mode?: string): Promise<number> {
  if (mode) {
    const result = await db
      .delete(institutionalDcaOrders)
      .where(eq(institutionalDcaOrders.mode, mode))
      .returning();
    return result.length;
  }
  const result = await db
    .delete(institutionalDcaOrders)
    .returning();
  return result.length;
}

// ─── OHLCV Cache ───────────────────────────────────────────────────

export async function upsertOhlcv(
  data: InsertInstitutionalDcaOhlcvCache
): Promise<void> {
  await db
    .insert(institutionalDcaOhlcvCache)
    .values(data)
    .onConflictDoUpdate({
      target: [
        institutionalDcaOhlcvCache.pair,
        institutionalDcaOhlcvCache.timeframe,
        institutionalDcaOhlcvCache.ts,
      ],
      set: {
        open: data.open,
        high: data.high,
        low: data.low,
        close: data.close,
        volume: data.volume,
      },
    });
}

export async function getOhlcvRange(
  pair: string,
  timeframe: string,
  from: Date,
  to: Date
): Promise<InstitutionalDcaOhlcvCacheRow[]> {
  return db
    .select()
    .from(institutionalDcaOhlcvCache)
    .where(
      and(
        eq(institutionalDcaOhlcvCache.pair, pair),
        eq(institutionalDcaOhlcvCache.timeframe, timeframe),
        sql`${institutionalDcaOhlcvCache.ts} >= ${from}`,
        sql`${institutionalDcaOhlcvCache.ts} <= ${to}`
      )
    )
    .orderBy(institutionalDcaOhlcvCache.ts);
}

// ─── Import Position ──────────────────────────────────────────────

export async function hasActiveCycleForPair(pair: string, mode: string): Promise<boolean> {
  const rows = await db
    .select({ id: institutionalDcaCycles.id })
    .from(institutionalDcaCycles)
    .where(
      and(
        eq(institutionalDcaCycles.pair, pair),
        eq(institutionalDcaCycles.mode, mode),
        ne(institutionalDcaCycles.status, "closed")
      )
    )
    .limit(1);
  return rows.length > 0;
}

export async function getImportableStatus(mode: string): Promise<Record<string, { canImport: boolean; hasActiveCycle: boolean; reason?: string }>> {
  const result: Record<string, { canImport: boolean; hasActiveCycle: boolean; reason?: string }> = {};
  const allowedPairs = ["BTC/USD", "ETH/USD"];
  for (const pair of allowedPairs) {
    const hasActive = await hasActiveCycleForPair(pair, mode);
    if (hasActive) {
      result[pair] = {
        canImport: true,
        hasActiveCycle: true,
        reason: `Ya existe otro ciclo activo de ${pair} en IDCA. Si importas como CICLO MANUAL, convivirán ambos.`,
      };
    } else {
      result[pair] = { canImport: true, hasActiveCycle: false };
    }
  }
  return result;
}

export async function createImportedCycle(
  data: InsertInstitutionalDcaCycle
): Promise<InstitutionalDcaCycle> {
  const [created] = await db
    .insert(institutionalDcaCycles)
    .values(data)
    .returning();
  return created;
}

// ─── Summary helpers ───────────────────────────────────────────────

export async function getModuleSummary(mode: string) {
  const config = await getIdcaConfig();
  const activeCycles = await getAllActiveCycles(mode);
  const wallet = mode === "simulation" ? await getSimulationWallet() : null;

  let totalCapitalUsed = 0;
  let totalUnrealizedPnl = 0;
  let totalRealizedPnl = 0;
  let trailingCount = 0;
  let buysToday = 0;
  let sellsToday = 0;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  for (const cycle of activeCycles) {
    totalCapitalUsed += parseFloat(String(cycle.capitalUsedUsd || "0"));
    totalUnrealizedPnl += parseFloat(String(cycle.unrealizedPnlUsd || "0"));
    totalRealizedPnl += parseFloat(String(cycle.realizedPnlUsd || "0"));
    if (cycle.status === "trailing_active") trailingCount++;
  }

  // Count today's orders
  const todayOrders = await db
    .select()
    .from(institutionalDcaOrders)
    .where(
      and(
        eq(institutionalDcaOrders.mode, mode),
        sql`${institutionalDcaOrders.executedAt} >= ${todayStart}`
      )
    );
  for (const o of todayOrders) {
    if (o.side === "buy") buysToday++;
    else sellsToday++;
  }

  const allocatedCapital = parseFloat(String(config.allocatedCapitalUsd));

  return {
    mode: config.mode,
    allocatedCapitalUsd: allocatedCapital,
    capitalUsedUsd: totalCapitalUsed,
    capitalFreeUsd: allocatedCapital - totalCapitalUsed,
    realizedPnlUsd: totalRealizedPnl,
    unrealizedPnlUsd: totalUnrealizedPnl,
    activeCyclesCount: activeCycles.length,
    trailingActiveCount: trailingCount,
    buysToday,
    sellsToday,
    smartModeEnabled: config.smartModeEnabled,
    simulationWallet: wallet,
    cycles: activeCycles,
  };
}

// ─── Edit Imported Cycle ───────────────────────────────────────────

export async function detectPostImportActivity(
  cycle: InstitutionalDcaCycle
): Promise<import("./IdcaTypes").PostImportActivityCheck> {
  const cycleId = cycle.id;
  const importedAt = cycle.importedAt ? new Date(cycle.importedAt).getTime() : 0;
  const buyCount = cycle.buyCount || 1;

  // Get all orders for this cycle
  const orders = await db
    .select()
    .from(institutionalDcaOrders)
    .where(eq(institutionalDcaOrders.cycleId, cycleId));

  // Count post-import sell orders
  const postImportSells = orders.filter(o => {
    if (o.side !== 'sell') return false;
    const orderTime = o.executedAt ? new Date(o.executedAt).getTime() : 0;
    return importedAt > 0 && orderTime > importedAt;
  });

  // Count safety buys (buyCount > 1 indicates automatic activity)
  const safetyBuys = Math.max(0, buyCount - 1);

  // Determine case
  const hasActivity = buyCount > 1 || postImportSells.length > 0;
  const caseType: "A_no_activity" | "B_with_activity" = hasActivity ? "B_with_activity" : "A_no_activity";

  const warnings: string[] = [];
  if (buyCount > 1) {
    warnings.push(`El ciclo tiene ${safetyBuys} compra(s) de seguridad automática(s) ejecutada(s).`);
  }
  if (postImportSells.length > 0) {
    warnings.push(`El ciclo tiene ${postImportSells.length} venta(s) ejecutada(s) post-importación.`);
  }
  if (cycle.status === 'trailing_active' || cycle.status === 'tp_armed') {
    warnings.push(`El ciclo está en estado avanzado: ${cycle.status}.`);
  }

  return {
    hasActivity,
    buyCount,
    postImportSells: postImportSells.length,
    safetyBuys,
    currentStatus: cycle.status,
    case: caseType,
    warnings,
  };
}

export async function updateCycleWithEditAudit(
  cycleId: number,
  patch: Record<string, any>,
  editHistoryEntry: import("./IdcaTypes").EditHistoryEntry
): Promise<InstitutionalDcaCycle> {
  // First, get current cycle to retrieve existing edit history
  const [currentCycle] = await db
    .select()
    .from(institutionalDcaCycles)
    .where(eq(institutionalDcaCycles.id, cycleId))
    .limit(1);

  if (!currentCycle) {
    throw new Error(`Cycle ${cycleId} not found`);
  }

  // Build new edit history
  const existingHistory = (currentCycle.editHistoryJson as import("./IdcaTypes").EditHistoryEntry[]) || [];
  const newHistory = [...existingHistory, editHistoryEntry];

  // Update cycle with patch + audit fields
  const [updated] = await db
    .update(institutionalDcaCycles)
    .set({
      ...patch,
      lastManualEditAt: new Date(),
      lastManualEditReason: editHistoryEntry.reason,
      editHistoryJson: newHistory,
      updatedAt: new Date(),
    })
    .where(eq(institutionalDcaCycles.id, cycleId))
    .returning();

  return updated;
}
