/**
 * IdcaRepository — Data access layer for the Institutional DCA module.
 * Completely isolated from the main bot's storage.
 */
import { db } from "../../db";
import { eq, desc, asc, and, sql, lt, ne, inArray } from "drizzle-orm";
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
  idcaPriceContextSnapshots,
  idcaPriceContextStatic,
  idcaVwapAnchors,
  type IdcaPriceContextSnapshotRow,
  type InsertIdcaPriceContextSnapshot,
  type IdcaPriceContextStaticRow,
  type InsertIdcaPriceContextStatic,
  type IdcaVwapAnchorRow,
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

const DEFAULT_EXECUTION_FEES = {
  exchange: "revolut_x",
  makerFeePct: 0,
  takerFeePct: 0.09,
  defaultFeeMode: "taker",
  includeEntryFeeInCostBasis: true,
  includeExitFeeInNetPnlEstimate: true,
  useRealFeesWhenAvailable: true,
};

export async function getIdcaConfig(): Promise<InstitutionalDcaConfigRow> {
  const rows = await db.select().from(institutionalDcaConfig).limit(1);
  let row: InstitutionalDcaConfigRow;
  if (rows.length === 0) {
    const [created] = await db.insert(institutionalDcaConfig).values({}).returning();
    row = created;
  } else {
    row = rows[0];
  }
  // Auto-inject executionFeesJson default if not set — ensures Revolut X 0.09% without manual UI action
  if (!row.executionFeesJson) {
    await db
      .update(institutionalDcaConfig)
      .set({ executionFeesJson: DEFAULT_EXECUTION_FEES, updatedAt: new Date() })
      .where(eq(institutionalDcaConfig.id, row.id));
    row = { ...row, executionFeesJson: DEFAULT_EXECUTION_FEES };
    console.log("[IDCA_FEES] Auto-injected default executionFeesJson: exchange=revolut_x maker=0% taker=0.09% source=default");
  }
  return row;
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

export async function getLastClosedRecoveryCycle(
  parentCycleId: number
): Promise<InstitutionalDcaCycle | null> {
  const rows = await db
    .select()
    .from(institutionalDcaCycles)
    .where(
      and(
        eq(institutionalDcaCycles.cycleType, "recovery"),
        eq(institutionalDcaCycles.parentCycleId, parentCycleId),
        eq(institutionalDcaCycles.status, "closed")
      )
    )
    .orderBy(desc(institutionalDcaCycles.closedAt))
    .limit(1);
  return rows[0] ?? null;
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

// ─── Bot-only queries (exclude imported positions) ─────────────────
// Imported cycles are independent: they don't block autonomous entries
// and their capital doesn't count against the bot's allocated budget.

export async function getActiveBotCycle(
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
        eq(institutionalDcaCycles.isImported, false),
        ne(institutionalDcaCycles.status, "closed")
      )
    )
    .limit(1);
  return rows[0];
}

export async function getActiveImportedCycles(
  pair: string,
  mode: string
): Promise<InstitutionalDcaCycle[]> {
  return db
    .select()
    .from(institutionalDcaCycles)
    .where(
      and(
        eq(institutionalDcaCycles.pair, pair),
        eq(institutionalDcaCycles.mode, mode),
        eq(institutionalDcaCycles.isImported, true),
        ne(institutionalDcaCycles.status, "closed")
      )
    );
}

export async function getAllActiveBotCycles(mode: string): Promise<InstitutionalDcaCycle[]> {
  return db
    .select()
    .from(institutionalDcaCycles)
    .where(
      and(
        eq(institutionalDcaCycles.mode, mode),
        eq(institutionalDcaCycles.isImported, false),
        ne(institutionalDcaCycles.status, "closed")
      )
    );
}

export async function getAllActiveBotCyclesForPair(
  pair: string,
  mode: string
): Promise<InstitutionalDcaCycle[]> {
  return db
    .select()
    .from(institutionalDcaCycles)
    .where(
      and(
        eq(institutionalDcaCycles.pair, pair),
        eq(institutionalDcaCycles.mode, mode),
        eq(institutionalDcaCycles.isImported, false),
        ne(institutionalDcaCycles.status, "closed")
      )
    );
}

export async function getTotalBotPairExposureUsd(pair: string, mode: string): Promise<number> {
  const rows = await db
    .select()
    .from(institutionalDcaCycles)
    .where(
      and(
        eq(institutionalDcaCycles.pair, pair),
        eq(institutionalDcaCycles.mode, mode),
        eq(institutionalDcaCycles.isImported, false),
        ne(institutionalDcaCycles.status, "closed")
      )
    );
  return rows.reduce((sum, c) => sum + parseFloat(String(c.capitalUsedUsd || "0")), 0);
}

export async function hasActiveBotCycleForPair(pair: string, mode: string): Promise<boolean> {
  const rows = await db
    .select({ id: institutionalDcaCycles.id })
    .from(institutionalDcaCycles)
    .where(
      and(
        eq(institutionalDcaCycles.pair, pair),
        eq(institutionalDcaCycles.mode, mode),
        eq(institutionalDcaCycles.isImported, false),
        ne(institutionalDcaCycles.status, "closed")
      )
    )
    .limit(1);
  return rows.length > 0;
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
  if (options.status === "active") {
    // "active" filter = all non-closed statuses (active, tp_armed, trailing_active, waiting_entry, idle, paused, blocked)
    conditions.push(ne(institutionalDcaCycles.status, "closed"));
  } else if (options.status) {
    conditions.push(eq(institutionalDcaCycles.status, options.status));
  }
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

/**
 * Elimina cualquier ciclo de forma forzada (hard delete).
 * Borra ciclo + órdenes + eventos asociados.
 * Funciona para ciclos de cualquier modo (simulation, live) y tipo.
 */
export async function deleteCycleForce(cycleId: number): Promise<{
  deleted: boolean;
  reason: string;
  ordersDeleted: number;
  eventsDeleted: number;
  cycle: InstitutionalDcaCycle | null;
}> {
  const [cycle] = await db
    .select()
    .from(institutionalDcaCycles)
    .where(eq(institutionalDcaCycles.id, cycleId))
    .limit(1);

  if (!cycle) {
    return { deleted: false, reason: 'CYCLE_NOT_FOUND', ordersDeleted: 0, eventsDeleted: 0, cycle: null };
  }

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
  mode?: string;
  pair?: string;
  severity?: string;
  dateFrom?: Date;
  dateTo?: Date;
  limit?: number;
  offset?: number;
  orderBy?: 'createdAt' | 'severity';
  orderDirection?: 'asc' | 'desc';
}): Promise<InstitutionalDcaEvent[]> {
  let query = db.select().from(institutionalDcaEvents);
  const conditions = [];
  
  if (options.cycleId) conditions.push(eq(institutionalDcaEvents.cycleId, options.cycleId));
  if (options.eventType) conditions.push(eq(institutionalDcaEvents.eventType, options.eventType));
  if (options.mode) conditions.push(eq(institutionalDcaEvents.mode, options.mode));
  if (options.pair) conditions.push(eq(institutionalDcaEvents.pair, options.pair));
  if (options.severity === 'no-debug') conditions.push(ne(institutionalDcaEvents.severity, 'debug'));
  else if (options.severity) conditions.push(eq(institutionalDcaEvents.severity, options.severity));
  if (options.dateFrom) conditions.push(sql`${institutionalDcaEvents.createdAt} >= ${options.dateFrom}`);
  if (options.dateTo) conditions.push(sql`${institutionalDcaEvents.createdAt} <= ${options.dateTo}`);
  
  if (conditions.length > 0) query = query.where(and(...conditions)) as any;
  
  // Ordenación flexible
  const orderField = options.orderBy === 'severity' ? institutionalDcaEvents.severity : institutionalDcaEvents.createdAt;
  const orderDir = options.orderDirection === 'asc' ? asc : desc;
  query = query.orderBy(orderDir(orderField)) as any;
  
  if (options.limit) query = query.limit(options.limit) as any;
  if (options.offset) query = (query as any).offset(options.offset);
  
  return query;
}

export async function getEventsCount(options: Omit<Parameters<typeof getEvents>[0], 'limit' | 'offset' | 'orderBy' | 'orderDirection'>): Promise<number> {
  let query = db.select({ count: sql<number>`count(*)` }).from(institutionalDcaEvents);
  const conditions = [];
  
  if (options.cycleId) conditions.push(eq(institutionalDcaEvents.cycleId, options.cycleId));
  if (options.eventType) conditions.push(eq(institutionalDcaEvents.eventType, options.eventType));
  if (options.mode) conditions.push(eq(institutionalDcaEvents.mode, options.mode));
  if (options.pair) conditions.push(eq(institutionalDcaEvents.pair, options.pair));
  if (options.severity === 'no-debug') conditions.push(ne(institutionalDcaEvents.severity, 'debug'));
  else if (options.severity) conditions.push(eq(institutionalDcaEvents.severity, options.severity));
  if (options.dateFrom) conditions.push(sql`${institutionalDcaEvents.createdAt} >= ${options.dateFrom}`);
  if (options.dateTo) conditions.push(sql`${institutionalDcaEvents.createdAt} <= ${options.dateTo}`);
  
  if (conditions.length > 0) query = query.where(and(...conditions)) as any;
  
  const result = await query;
  return Number(result[0]?.count) || 0;
}

export async function purgeOldEvents(retentionDays: number, batchSize: number = 500): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  let totalDeleted = 0;

  // Borrado por lotes via subquery de IDs para evitar locks largos
  while (true) {
    const toDelete = await db
      .select({ id: institutionalDcaEvents.id })
      .from(institutionalDcaEvents)
      .where(lt(institutionalDcaEvents.createdAt, cutoff))
      .limit(batchSize);

    if (toDelete.length === 0) break;

    const ids = toDelete.map(r => r.id);
    const result = await db
      .delete(institutionalDcaEvents)
      .where(inArray(institutionalDcaEvents.id, ids));

    const deletedCount = (result as any).rowCount || ids.length;
    totalDeleted += deletedCount;

    if (toDelete.length < batchSize) break;
  }

  return totalDeleted;
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

// ─── IDCA Price Context ────────────────────────────────────────────────

export async function upsertPriceContextSnapshot(
  data: Omit<InsertIdcaPriceContextSnapshot, "id" | "createdAt">
): Promise<void> {
  await db
    .insert(idcaPriceContextSnapshots)
    .values(data as InsertIdcaPriceContextSnapshot)
    .onConflictDoUpdate({
      target: [idcaPriceContextSnapshots.pair, idcaPriceContextSnapshots.bucket, idcaPriceContextSnapshots.snapshotDate],
      set: {
        highMax:              data.highMax,
        lowMin:               data.lowMin,
        p95High:              data.p95High,
        avgClose:             data.avgClose,
        drawdownFromHighPct:  data.drawdownFromHighPct,
        rangePosition:        data.rangePosition,
        source:               data.source ?? "scheduled",
      },
    });
}

export async function getLatestPriceContextSnapshots(
  pair: string
): Promise<IdcaPriceContextSnapshotRow[]> {
  return db
    .select()
    .from(idcaPriceContextSnapshots)
    .where(eq(idcaPriceContextSnapshots.pair, pair))
    .orderBy(desc(idcaPriceContextSnapshots.snapshotDate))
    .limit(20);
}

export async function purgeOldPriceContextSnapshots(
  retentionDays = 365
): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  const deleted = await db
    .delete(idcaPriceContextSnapshots)
    .where(sql`${idcaPriceContextSnapshots.createdAt} < ${cutoff}`)
    .returning();
  return deleted.length;
}

export async function upsertPriceContextStatic(
  data: Omit<InsertIdcaPriceContextStatic, "id" | "updatedAt">
): Promise<void> {
  await db
    .insert(idcaPriceContextStatic)
    .values({ ...data, updatedAt: new Date() } as InsertIdcaPriceContextStatic)
    .onConflictDoUpdate({
      target: [idcaPriceContextStatic.pair],
      set: {
        high2y:               data.high2y,
        high2yTime:           data.high2yTime,
        low2y:                data.low2y,
        low2yTime:            data.low2yTime,
        yearHigh:             data.yearHigh,
        yearLow:              data.yearLow,
        lastP95_90d:          data.lastP95_90d,
        lastP95_180d:         data.lastP95_180d,
        lastDrawdown90dPct:   data.lastDrawdown90dPct,
        lastDrawdown180dPct:  data.lastDrawdown180dPct,
        lastRangePosition90d: data.lastRangePosition90d,
        lastRangePosition180d: data.lastRangePosition180d,
        updatedAt:            new Date(),
      },
    });
}

export async function getPriceContextStatic(
  pair: string
): Promise<IdcaPriceContextStaticRow | undefined> {
  const rows = await db
    .select()
    .from(idcaPriceContextStatic)
    .where(eq(idcaPriceContextStatic.pair, pair))
    .limit(1);
  return rows[0];
}

// ─── VWAP Anchor Persistence ───────────────────────────────────────

export async function getVwapAnchor(pair: string): Promise<{
  anchor_price: number;
  anchor_ts: number;
  set_at: number;
  drawdown_pct: number;
  prev_price?: number | null;
  prev_ts?: number | null;
  prev_set_at?: number | null;
  prev_replaced_at?: number | null;
} | null> {
  const rows = await db.select()
    .from(idcaVwapAnchors)
    .where(eq(idcaVwapAnchors.pair, pair))
    .limit(1);
  if (!rows[0]) return null;
  return {
    anchor_price: parseFloat(String(rows[0].anchorPrice)),
    anchor_ts: rows[0].anchorTs,
    set_at: rows[0].setAt,
    drawdown_pct: parseFloat(String(rows[0].drawdownPct)),
    prev_price: rows[0].prevPrice ? parseFloat(String(rows[0].prevPrice)) : null,
    prev_ts: rows[0].prevTs || null,
    prev_set_at: rows[0].prevSetAt || null,
    prev_replaced_at: rows[0].prevReplacedAt || null,
  };
}

export async function upsertVwapAnchor(anchor: {
  pair: string;
  anchorPrice: number;
  anchorTs: number;
  setAt: number;
  drawdownPct: number;
  prevPrice?: number | null;
  prevTs?: number | null;
  prevSetAt?: number | null;
  prevReplacedAt?: number | null;
}): Promise<void> {
  await db
    .insert(idcaVwapAnchors)
    .values({
      pair:           anchor.pair,
      anchorPrice:    anchor.anchorPrice.toString(),
      anchorTs:       anchor.anchorTs,
      setAt:          anchor.setAt,
      drawdownPct:    anchor.drawdownPct.toString(),
      prevPrice:      anchor.prevPrice != null ? anchor.prevPrice.toString() : null,
      prevTs:         anchor.prevTs ?? null,
      prevSetAt:      anchor.prevSetAt ?? null,
      prevReplacedAt: anchor.prevReplacedAt ?? null,
      updatedAt:      new Date(),
    })
    .onConflictDoUpdate({
      target: idcaVwapAnchors.pair,
      set: {
        anchorPrice:    sql`excluded.anchor_price`,
        anchorTs:       sql`excluded.anchor_ts`,
        setAt:          sql`excluded.set_at`,
        drawdownPct:    sql`excluded.drawdown_pct`,
        prevPrice:      sql`excluded.prev_price`,
        prevTs:         sql`excluded.prev_ts`,
        prevSetAt:      sql`excluded.prev_set_at`,
        prevReplacedAt: sql`excluded.prev_replaced_at`,
        updatedAt:      sql`NOW()`,
      },
    });
}

export async function loadAllVwapAnchors(): Promise<IdcaVwapAnchorRow[]> {
  return db.select().from(idcaVwapAnchors);
}

export async function deleteVwapAnchor(pair: string): Promise<void> {
  await db.delete(idcaVwapAnchors).where(eq(idcaVwapAnchors.pair, pair));
}
