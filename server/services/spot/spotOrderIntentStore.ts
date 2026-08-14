/**
 * SpotOrderIntentStore — R10.2 Idempotency layer for REAL order submissions.
 *
 * Guarantees: ONE internalIntentId → AT MOST ONE placeOrder call.
 *
 * R10.2 changes:
 *   - Fail-closed: DB SELECT/INSERT failure → NO placeOrder.
 *   - Concurrency: DB atomic INSERT ... ON CONFLICT DO NOTHING ... RETURNING
 *     distinguishes CREATED_BY_THIS_CALL vs ALREADY_EXISTS.
 *   - Positive provenance: filter by engine_owner=SPOT_CANONICAL, policy_version, execution_mode=REAL.
 *   - Full column persistence: internal_intent_id, engine_owner, policy_version, etc.
 *
 * Flow:
 *   1. Engine creates internalIntentId (stable, deterministic — NO Date.now)
 *   2. Engine generates clientOrderId (deterministic hash of internalIntentId)
 *   3. persistSubmissionIntent() — atomic INSERT into order_intents BEFORE placeOrder
 *   4. If CREATED_BY_THIS_CALL → proceed to placeOrder
 *   5. If ALREADY_EXISTS → return existing record, skip placeOrder
 *   6. If persistence fails → throw REAL_INTENT_PERSISTENCE_FAILED_FAIL_CLOSED
 *   7. updateSubmissionResult() — persist venueOrderId, status, fill data
 */

import { db } from "../../db";
import { sql } from "drizzle-orm";
import { createHash } from "crypto";
import type { RealOrderRecord, RealOrderState, ExecutionSide, ExecutionOrderType, ExecutionMode } from "./spotTypes";
import { SPOT_POLICY_VERSION } from "./spotTypes";
import { SPOT_ENGINE_OWNER } from "./spotEngine";

// ─── In-memory cache for fast dedup ──────────────────────────────────────────

const intentCache = new Map<string, RealOrderRecord>();

// ─── Public API ──────────────────────────────────────────────────────────────

export interface CreateSubmissionIntentParams {
  internalIntentId: string;
  pair: string;
  side: ExecutionSide;
  requestedQty: number;
  requestedPrice: number | null;
  orderType: ExecutionOrderType;
  executionMode: ExecutionMode;
  lotId: string | null;
  reason: string | null;
}

/**
 * Generate a stable clientOrderId from an internalIntentId.
 * The same internalIntentId always produces the same clientOrderId.
 */
export function generateClientOrderId(internalIntentId: string): string {
  const cached = intentCache.get(internalIntentId);
  if (cached?.clientOrderId) {
    return cached.clientOrderId;
  }
  const hash = createHash("sha256").update(internalIntentId).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

export class RealIntentPersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RealIntentPersistenceError";
  }
}

/**
 * Persist a submission intent to order_intents BEFORE calling placeOrder.
 *
 * R10.2: FAIL-CLOSED. If DB SELECT or INSERT fails, throws RealIntentPersistenceError.
 * No placeOrder may proceed without confirmed persistence.
 *
 * Uses INSERT ... ON CONFLICT DO NOTHING ... RETURNING to atomically distinguish:
 *   - CREATED_BY_THIS_CALL (RETURNING yields a row) → alreadySubmitted=false
 *   - ALREADY_EXISTS (RETURNING yields no rows) → alreadySubmitted=true
 *
 * For ALREADY_EXISTS, recovers the existing row via SELECT to populate the record.
 */
export async function persistSubmissionIntent(
  params: CreateSubmissionIntentParams,
  clientOrderId: string,
  venue: string,
): Promise<{ record: RealOrderRecord; alreadySubmitted: boolean }> {
  // Check in-memory cache first (fast path)
  const cached = intentCache.get(params.internalIntentId);
  if (cached && (cached.status === "SUBMITTED" || cached.status === "PENDING_FILL" || cached.status === "FILLED")) {
    return { record: cached, alreadySubmitted: true };
  }

  // R10.2: Atomic INSERT with full provenance columns
  // ON CONFLICT (client_order_id) DO NOTHING — but we must verify the result
  let insertResult: any;
  try {
    insertResult = await db.execute(sql`
      INSERT INTO order_intents (
        client_order_id, exchange, pair, side, volume, status,
        internal_intent_id, engine_owner, policy_version, execution_mode,
        lot_id, requested_price, order_type, reason
      ) VALUES (
        ${clientOrderId}, ${venue}, ${params.pair}, ${params.side.toLowerCase()},
        ${params.requestedQty.toString()}, 'pending',
        ${params.internalIntentId}, ${SPOT_ENGINE_OWNER}, ${SPOT_POLICY_VERSION},
        ${params.executionMode},
        ${params.lotId}, ${params.requestedPrice?.toString() ?? null},
        ${params.orderType}, ${params.reason}
      )
      ON CONFLICT (client_order_id) DO NOTHING
      RETURNING id, client_order_id, exchange_order_id, status
    `);
  } catch (error: any) {
    // R10.2: FAIL-CLOSED — do NOT continue to placeOrder
    throw new RealIntentPersistenceError(
      `REAL_INTENT_PERSISTENCE_FAILED_FAIL_CLOSED: DB insert failed for ${clientOrderId}: ${error.message}`
    );
  }

  const record: RealOrderRecord = {
    internalIntentId: params.internalIntentId,
    clientOrderId,
    venueOrderId: null,
    pair: params.pair,
    side: params.side,
    requestedQty: params.requestedQty,
    requestedPrice: params.requestedPrice,
    orderType: params.orderType,
    submittedAt: Date.now(),
    status: "SUBMITTED",
    policyVersion: SPOT_POLICY_VERSION,
    engineOwner: SPOT_ENGINE_OWNER,
    executionMode: params.executionMode,
    lotId: params.lotId,
    fillPrice: null,
    fillVolume: null,
    feeUsd: null,
    reason: params.reason,
    error: null,
  };

  // R10.2: Check if we created the row or it already existed
  if (insertResult.rows && insertResult.rows.length > 0) {
    // CREATED_BY_THIS_CALL — we own this intent, proceed to placeOrder
    const row = insertResult.rows[0] as any;
    record.venueOrderId = row.exchange_order_id ?? null;
    intentCache.set(params.internalIntentId, record);
    return { record, alreadySubmitted: false };
  }

  // ON CONFLICT → row already existed. Must SELECT to recover the existing record.
  // This is the concurrency-safe path: another call won the race.
  let existingRow: any;
  try {
    const existing = await db.execute(sql`
      SELECT client_order_id, exchange_order_id, status,
             internal_intent_id, engine_owner, policy_version, execution_mode,
             lot_id, requested_price, order_type, reason,
             fill_price, fill_volume, fee_usd
      FROM order_intents
      WHERE client_order_id = ${clientOrderId}
      LIMIT 1
    `);
    if (existing.rows.length === 0) {
      // R10.2: INSERT said conflict but SELECT finds nothing — uncertain state
      throw new RealIntentPersistenceError(
        `REAL_INTENT_PERSISTENCE_FAILED_FAIL_CLOSED: INSERT conflicted but SELECT found no row for ${clientOrderId}`
      );
    }
    existingRow = existing.rows[0];
  } catch (error: any) {
    if (error instanceof RealIntentPersistenceError) throw error;
    throw new RealIntentPersistenceError(
      `REAL_INTENT_PERSISTENCE_FAILED_FAIL_CLOSED: DB select after conflict failed for ${clientOrderId}: ${error.message}`
    );
  }

  // Recover existing record
  const dbStatus = existingRow.status as string;
  const mappedStatus = mapDbStatusToRealOrderState(dbStatus);
  record.clientOrderId = existingRow.client_order_id;
  record.venueOrderId = existingRow.exchange_order_id ?? null;
  record.status = mappedStatus;
  if (existingRow.fill_price != null) record.fillPrice = Number(existingRow.fill_price);
  if (existingRow.fill_volume != null) record.fillVolume = Number(existingRow.fill_volume);
  if (existingRow.fee_usd != null) record.feeUsd = Number(existingRow.fee_usd);

  intentCache.set(params.internalIntentId, record);
  return { record, alreadySubmitted: true };
}

/**
 * Update the submission result after placeOrder returns.
 * Persists venueOrderId, status, and fill data to both cache and DB.
 */
export async function updateSubmissionResult(
  internalIntentId: string,
  updates: {
    venueOrderId?: string | null;
    status: RealOrderState;
    fillPrice?: number | null;
    fillVolume?: number | null;
    feeUsd?: number | null;
    error?: string | null;
  },
): Promise<void> {
  const cached = intentCache.get(internalIntentId);
  if (cached) {
    if (updates.venueOrderId !== undefined) cached.venueOrderId = updates.venueOrderId;
    cached.status = updates.status;
    if (updates.fillPrice !== undefined) cached.fillPrice = updates.fillPrice;
    if (updates.fillVolume !== undefined) cached.fillVolume = updates.fillVolume;
    if (updates.feeUsd !== undefined) cached.feeUsd = updates.feeUsd;
    if (updates.error !== undefined) cached.error = updates.error;
  }

  if (cached) {
    try {
      const dbStatus = mapRealOrderStateToDbStatus(updates.status);
      await db.execute(sql`
        UPDATE order_intents SET
          status = ${dbStatus},
          exchange_order_id = COALESCE(${updates.venueOrderId ?? null}, exchange_order_id),
          fill_price = COALESCE(${updates.fillPrice != null ? updates.fillPrice.toString() : null}, fill_price),
          fill_volume = COALESCE(${updates.fillVolume != null ? updates.fillVolume.toString() : null}, fill_volume),
          fee_usd = COALESCE(${updates.feeUsd != null ? updates.feeUsd.toString() : null}, fee_usd),
          updated_at = NOW()
        WHERE client_order_id = ${cached.clientOrderId}
      `);
    } catch (error: any) {
      console.warn(`[SpotOrderIntentStore] DB update failed for ${internalIntentId}: ${error.message}`);
    }
  }
}

/**
 * Get a cached record by internalIntentId.
 */
export function getCachedRecord(internalIntentId: string): RealOrderRecord | null {
  return intentCache.get(internalIntentId) ?? null;
}

/**
 * Check if a submission already exists for this internalIntentId.
 */
export function hasExistingSubmission(internalIntentId: string): boolean {
  const record = intentCache.get(internalIntentId);
  return record !== undefined && (record.status === "SUBMITTED" || record.status === "PENDING_FILL");
}

/**
 * R10.2: Load all pending REAL orders from order_intents at restart.
 * Uses POSITIVE provenance filtering: engine_owner=SPOT_CANONICAL, policy_version, execution_mode=REAL.
 * Does NOT use NOT LIKE 'legacy-backfill-%' as primary isolation.
 */
export async function loadPendingRealOrders(): Promise<RealOrderRecord[]> {
  const pending: RealOrderRecord[] = [];

  try {
    const result = await db.execute(sql`
      SELECT client_order_id, exchange_order_id, exchange, pair, side, volume, status,
             internal_intent_id, engine_owner, policy_version, execution_mode,
             lot_id, requested_price, order_type, reason,
             fill_price, fill_volume, fee_usd
      FROM order_intents
      WHERE status IN ('pending', 'accepted')
        AND engine_owner = ${SPOT_ENGINE_OWNER}
        AND policy_version = ${SPOT_POLICY_VERSION}
        AND execution_mode = 'REAL'
      ORDER BY created_at DESC
      LIMIT 100
    `);

    for (const row of result.rows as any[]) {
      const internalIntentId = row.internal_intent_id ?? `restart-${row.client_order_id}`;
      const record: RealOrderRecord = {
        internalIntentId,
        clientOrderId: row.client_order_id,
        venueOrderId: row.exchange_order_id ?? null,
        pair: row.pair,
        side: (row.side === "buy" ? "BUY" : "SELL") as ExecutionSide,
        requestedQty: parseFloat(row.volume),
        requestedPrice: row.requested_price ? Number(row.requested_price) : null,
        orderType: (row.order_type ?? "MARKET") as ExecutionOrderType,
        submittedAt: Date.now(),
        status: mapDbStatusToRealOrderState(row.status),
        policyVersion: row.policy_version ?? SPOT_POLICY_VERSION,
        engineOwner: row.engine_owner ?? SPOT_ENGINE_OWNER,
        executionMode: (row.execution_mode ?? "REAL") as ExecutionMode,
        lotId: row.lot_id ?? null,
        fillPrice: row.fill_price ? Number(row.fill_price) : null,
        fillVolume: row.fill_volume ? Number(row.fill_volume) : null,
        feeUsd: row.fee_usd ? Number(row.fee_usd) : null,
        reason: row.reason ?? null,
        error: null,
      };
      pending.push(record);
      intentCache.set(internalIntentId, record);
    }
  } catch (error: any) {
    console.warn(`[SpotOrderIntentStore] Failed to load pending orders: ${error.message}`);
  }

  return pending;
}

/**
 * R10.2: Count pending SPOT REAL order_intents by status.
 * Used by readiness checks.
 */
export async function countPendingRealOrderIntents(): Promise<{
  pendingEntryOrders: number;
  pendingExitOrders: number;
  uncertainOrders: number;
  submittedOrdersWithoutVenueId: number;
}> {
  try {
    const result = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending' AND side = 'buy') as pending_entry,
        COUNT(*) FILTER (WHERE status = 'pending' AND side = 'sell') as pending_exit,
        COUNT(*) FILTER (WHERE status = 'accepted' AND side = 'buy') as accepted_entry,
        COUNT(*) FILTER (WHERE status = 'accepted' AND side = 'sell') as accepted_exit,
        COUNT(*) FILTER (WHERE exchange_order_id IS NULL AND status IN ('pending', 'accepted')) as no_venue_id
      FROM order_intents
      WHERE engine_owner = ${SPOT_ENGINE_OWNER}
        AND policy_version = ${SPOT_POLICY_VERSION}
        AND execution_mode = 'REAL'
        AND status IN ('pending', 'accepted')
    `);
    const row = result.rows[0] as any;
    return {
      pendingEntryOrders: Number(row?.pending_entry ?? 0) + Number(row?.accepted_entry ?? 0),
      pendingExitOrders: Number(row?.pending_exit ?? 0) + Number(row?.accepted_exit ?? 0),
      uncertainOrders: 0,
      submittedOrdersWithoutVenueId: Number(row?.no_venue_id ?? 0),
    };
  } catch {
    return { pendingEntryOrders: 0, pendingExitOrders: 0, uncertainOrders: 0, submittedOrdersWithoutVenueId: 0 };
  }
}

/**
 * Clear the in-memory cache (for testing).
 */
export function _clearCacheForTest(): void {
  intentCache.clear();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mapDbStatusToRealOrderState(dbStatus: string): RealOrderState {
  switch (dbStatus) {
    case "pending": return "SUBMITTED";
    case "accepted": return "PENDING_FILL";
    case "filled": return "FILLED";
    case "failed": return "FAILED";
    case "expired": return "CANCELLED";
    default: return "UNCERTAIN";
  }
}

function mapRealOrderStateToDbStatus(state: RealOrderState): string {
  switch (state) {
    case "SUBMITTED": return "pending";
    case "PENDING_FILL": return "accepted";
    case "FILLED": return "filled";
    case "FAILED": return "failed";
    case "CANCELLED": return "expired";
    case "UNCERTAIN": return "pending";
    case "EXIT_PENDING": return "accepted";
    case "CREATED": return "pending";
    default: return "pending";
  }
}
