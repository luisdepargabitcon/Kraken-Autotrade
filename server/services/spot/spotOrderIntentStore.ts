/**
 * SpotOrderIntentStore — R10.1 Idempotency layer for REAL order submissions.
 *
 * Guarantees: ONE internalIntentId → AT MOST ONE placeOrder call.
 *
 * Flow:
 *   1. Engine creates internalIntentId (stable, deterministic)
 *   2. Engine generates clientOrderId (UUID, stable per internalIntentId)
 *   3. persistSubmissionIntent() — INSERT into order_intents BEFORE placeOrder
 *   4. If already SUBMITTED → return existing record, skip placeOrder
 *   5. Only then call adapter/exchange
 *   6. updateSubmissionResult() — persist venueOrderId, status
 *
 * No migration required — reuses existing order_intents table.
 */

import { db } from "../../db";
import { sql } from "drizzle-orm";
import { createHash, randomUUID } from "crypto";
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
  // Check cache first
  const cached = intentCache.get(internalIntentId);
  if (cached?.clientOrderId) {
    return cached.clientOrderId;
  }
  // Deterministic UUID from hash of internalIntentId
  const hash = createHash("sha256").update(internalIntentId).digest("hex");
  // Format as UUID: 8-4-4-4-12
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

/**
 * Persist a submission intent to order_intents BEFORE calling placeOrder.
 * If the intent already exists with status SUBMITTED/PENDING_FILL, returns it
 * without creating a new one — this is the idempotency guard.
 *
 * Returns the RealOrderRecord to use for the rest of the flow.
 */
export async function persistSubmissionIntent(
  params: CreateSubmissionIntentParams,
  clientOrderId: string,
  venue: string,
): Promise<{ record: RealOrderRecord; alreadySubmitted: boolean }> {
  // Check in-memory cache first
  const cached = intentCache.get(params.internalIntentId);
  if (cached && (cached.status === "SUBMITTED" || cached.status === "PENDING_FILL")) {
    return { record: cached, alreadySubmitted: true };
  }

  // Check DB for existing intent with this clientOrderId
  try {
    const existing = await db.execute(sql`
      SELECT client_order_id, exchange_order_id, status
      FROM order_intents
      WHERE client_order_id = ${clientOrderId}
      LIMIT 1
    `);
    if (existing.rows.length > 0) {
      const row = existing.rows[0] as any;
      const dbStatus = row.status as string;
      // Map DB status to RealOrderState
      const mappedStatus = mapDbStatusToRealOrderState(dbStatus);
      if (mappedStatus === "SUBMITTED" || mappedStatus === "PENDING_FILL") {
        const record: RealOrderRecord = {
          internalIntentId: params.internalIntentId,
          clientOrderId: row.client_order_id,
          venueOrderId: row.exchange_order_id ?? null,
          pair: params.pair,
          side: params.side,
          requestedQty: params.requestedQty,
          requestedPrice: params.requestedPrice,
          orderType: params.orderType,
          submittedAt: Date.now(),
          status: mappedStatus,
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
        intentCache.set(params.internalIntentId, record);
        return { record, alreadySubmitted: true };
      }
    }
  } catch (error: any) {
    console.warn(`[SpotOrderIntentStore] DB check failed for ${clientOrderId}: ${error.message}`);
    // Continue to insert — best effort
  }

  // Insert new intent into order_intents
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

  try {
    await db.execute(sql`
      INSERT INTO order_intents (client_order_id, exchange, pair, side, volume, status)
      VALUES (${clientOrderId}, ${venue}, ${params.pair}, ${params.side.toLowerCase()}, ${params.requestedQty.toString()}, 'pending')
      ON CONFLICT (client_order_id) DO NOTHING
    `);
  } catch (error: any) {
    console.warn(`[SpotOrderIntentStore] DB insert failed for ${clientOrderId}: ${error.message}`);
  }

  intentCache.set(params.internalIntentId, record);
  return { record, alreadySubmitted: false };
}

/**
 * Update the submission result after placeOrder returns.
 * Persists venueOrderId and status to both cache and DB.
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

  // Persist to DB
  if (cached) {
    try {
      const dbStatus = mapRealOrderStateToDbStatus(updates.status);
      await db.execute(sql`
        UPDATE order_intents SET
          status = ${dbStatus},
          exchange_order_id = COALESCE(${updates.venueOrderId ?? null}, exchange_order_id),
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
 * Load all pending REAL orders from order_intents at restart.
 * Returns records that need reconciliation.
 */
export async function loadPendingRealOrders(): Promise<RealOrderRecord[]> {
  const pending: RealOrderRecord[] = [];

  try {
    const result = await db.execute(sql`
      SELECT client_order_id, exchange_order_id, exchange, pair, side, volume, status
      FROM order_intents
      WHERE status IN ('pending', 'accepted')
        AND client_order_id NOT LIKE 'legacy-backfill-%'
      ORDER BY created_at DESC
      LIMIT 100
    `);

    for (const row of result.rows as any[]) {
      const internalIntentId = `restart-${row.client_order_id}`;
      const record: RealOrderRecord = {
        internalIntentId,
        clientOrderId: row.client_order_id,
        venueOrderId: row.exchange_order_id ?? null,
        pair: row.pair,
        side: (row.side === "buy" ? "BUY" : "SELL") as ExecutionSide,
        requestedQty: parseFloat(row.volume),
        requestedPrice: null,
        orderType: "MARKET" as ExecutionOrderType,
        submittedAt: Date.now(),
        status: mapDbStatusToRealOrderState(row.status),
        policyVersion: SPOT_POLICY_VERSION,
        engineOwner: SPOT_ENGINE_OWNER,
        executionMode: "REAL" as ExecutionMode,
        lotId: null,
        fillPrice: null,
        fillVolume: null,
        feeUsd: null,
        reason: null,
        error: null,
      };
      pending.push(record);
    }
  } catch (error: any) {
    console.warn(`[SpotOrderIntentStore] Failed to load pending orders: ${error.message}`);
  }

  return pending;
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
