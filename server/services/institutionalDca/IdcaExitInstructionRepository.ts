/**
 * IdcaExitInstructionRepository — CRUD for idca_cycle_exit_instructions.
 * Lote 4: manages pending/executing/executed exit instructions per cycle.
 */
import { db } from "../../db";
import { eq, and, lte, inArray } from "drizzle-orm";
import {
  idcaExitInstructions,
  type IdcaExitInstruction,
  type InsertIdcaExitInstruction,
} from "@shared/schema";

export type ExitInstructionStatus =
  | "pending"
  | "executing"
  | "executed"
  | "cancelled"
  | "failed"
  | "failed_requires_review";

export type ExitInstructionType = "immediate" | "price_target" | "scheduled_time";

// ─── Create ───────────────────────────────────────────────────────────────────

export async function createExitInstruction(
  data: Omit<InsertIdcaExitInstruction, "id" | "createdAt" | "updatedAt">
): Promise<IdcaExitInstruction> {
  const [created] = await db
    .insert(idcaExitInstructions)
    .values({ ...data, createdAt: new Date(), updatedAt: new Date() })
    .returning();
  return created;
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getExitInstructionById(id: number): Promise<IdcaExitInstruction | null> {
  const rows = await db
    .select()
    .from(idcaExitInstructions)
    .where(eq(idcaExitInstructions.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function getActiveExitInstruction(
  cycleId: number
): Promise<IdcaExitInstruction | null> {
  const rows = await db
    .select()
    .from(idcaExitInstructions)
    .where(
      and(
        eq(idcaExitInstructions.cycleId, cycleId),
        inArray(idcaExitInstructions.status, ["pending", "executing", "failed_requires_review"])
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Returns true if a blocking instruction (pending/executing/failed_requires_review) exists. */
export async function hasPendingExitInstruction(cycleId: number): Promise<boolean> {
  const instr = await getActiveExitInstruction(cycleId);
  return instr !== null;
}

/** All pending price_target instructions that should fire given currentPrice. */
export async function getPendingPriceTargetInstructions(
  mode: string,
  currentPrices: Record<string, number>
): Promise<IdcaExitInstruction[]> {
  const rows = await db
    .select()
    .from(idcaExitInstructions)
    .where(
      and(
        eq(idcaExitInstructions.status, "pending"),
        eq(idcaExitInstructions.type, "price_target"),
        eq(idcaExitInstructions.mode, mode)
      )
    );

  return rows.filter((instr) => {
    const price = currentPrices[instr.pair];
    if (!price || !instr.triggerPrice) return false;
    const tp = parseFloat(String(instr.triggerPrice));
    if (instr.triggerDirection === "above") return price >= tp;
    if (instr.triggerDirection === "below") return price <= tp;
    return false;
  });
}

/** All pending scheduled_time instructions whose trigger_time has passed. */
export async function getPendingTimeInstructions(
  mode: string,
  now: Date = new Date()
): Promise<IdcaExitInstruction[]> {
  const rows = await db
    .select()
    .from(idcaExitInstructions)
    .where(
      and(
        eq(idcaExitInstructions.status, "pending"),
        eq(idcaExitInstructions.type, "scheduled_time"),
        eq(idcaExitInstructions.mode, mode),
        lte(idcaExitInstructions.triggerTime, now)
      )
    );
  return rows;
}

/** All pending immediate instructions (should be executed as soon as seen). */
export async function getPendingImmediateInstructions(
  mode: string
): Promise<IdcaExitInstruction[]> {
  return db
    .select()
    .from(idcaExitInstructions)
    .where(
      and(
        eq(idcaExitInstructions.status, "pending"),
        eq(idcaExitInstructions.type, "immediate"),
        eq(idcaExitInstructions.mode, mode)
      )
    );
}

/** Executing instructions older than the given threshold (stale recovery). */
export async function getStaleExecutingInstructions(
  olderThan: Date
): Promise<IdcaExitInstruction[]> {
  const rows = await db
    .select()
    .from(idcaExitInstructions)
    .where(
      and(
        eq(idcaExitInstructions.status, "executing"),
        lte(idcaExitInstructions.executingStartedAt, olderThan)
      )
    );
  return rows;
}

export async function getInstructionsByCycle(
  cycleId: number
): Promise<IdcaExitInstruction[]> {
  return db
    .select()
    .from(idcaExitInstructions)
    .where(eq(idcaExitInstructions.cycleId, cycleId));
}

// ─── Update ───────────────────────────────────────────────────────────────────

export async function updateExitInstruction(
  id: number,
  patch: Partial<Omit<InsertIdcaExitInstruction, "id" | "createdAt">>
): Promise<IdcaExitInstruction> {
  const [updated] = await db
    .update(idcaExitInstructions)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(idcaExitInstructions.id, id))
    .returning();
  return updated;
}

/** Atomically transition pending → executing. Returns updated row or null if already moved. */
export async function markExecuting(
  id: number,
  clientOrderId: string
): Promise<IdcaExitInstruction | null> {
  const rows = await db
    .update(idcaExitInstructions)
    .set({
      status: "executing",
      executingStartedAt: new Date(),
      executionClientOrderId: clientOrderId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(idcaExitInstructions.id, id),
        eq(idcaExitInstructions.status, "pending") // Only if still pending (idempotency guard)
      )
    )
    .returning();
  return rows[0] ?? null;
}

/** Mark as executed with full financial result. */
export async function markExecuted(
  id: number,
  result: {
    executionExchangeOrderId: string | null;
    executionPrice: number;
    executionQuantity: number;
    costBasisSoldUsd: number;
    realizedPnlIncrementUsd: number;
    remainingCapitalUsedUsd: number;
    remainingCycleQuantityAfter: number;
    grossValueUsd: number;
    feesUsd: number;
    netValueUsd: number;
  }
): Promise<IdcaExitInstruction> {
  return updateExitInstruction(id, {
    status: "executed",
    executedAt: new Date(),
    executionExchangeOrderId: result.executionExchangeOrderId ?? undefined,
    executionPrice: result.executionPrice.toFixed(8),
    executionQuantity: result.executionQuantity.toFixed(8),
    costBasisSoldUsd: result.costBasisSoldUsd.toFixed(4),
    realizedPnlIncrementUsd: result.realizedPnlIncrementUsd.toFixed(4),
    remainingCapitalUsedUsd: result.remainingCapitalUsedUsd.toFixed(4),
    remainingCycleQuantityAfter: result.remainingCycleQuantityAfter.toFixed(8),
    grossValueUsd: result.grossValueUsd.toFixed(2),
    feesUsd: result.feesUsd.toFixed(4),
    netValueUsd: result.netValueUsd.toFixed(2),
  });
}

/** Mark as failed (no manual review needed). */
export async function markFailed(
  id: number,
  reason: string
): Promise<IdcaExitInstruction> {
  return updateExitInstruction(id, { status: "failed", failureReason: reason });
}

/** Mark as failed_requires_review (stale execution, uncertain state). */
export async function markFailedRequiresReview(
  id: number,
  reason: string
): Promise<IdcaExitInstruction> {
  return updateExitInstruction(id, { status: "failed_requires_review", failureReason: reason });
}

/** Cancel a pending/failed_requires_review instruction. */
export async function cancelExitInstruction(
  id: number,
  reason: string
): Promise<IdcaExitInstruction | null> {
  const rows = await db
    .update(idcaExitInstructions)
    .set({
      status: "cancelled",
      cancelledAt: new Date(),
      cancelReason: reason,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(idcaExitInstructions.id, id),
        inArray(idcaExitInstructions.status, ["pending", "failed_requires_review"])
      )
    )
    .returning();
  return rows[0] ?? null;
}

/**
 * Cancel any active (pending/failed_requires_review) instruction for a cycle.
 * Used by emergencyCloseAll.
 */
export async function cancelActiveExitInstructionForCycle(
  cycleId: number,
  reason: string
): Promise<void> {
  await db
    .update(idcaExitInstructions)
    .set({
      status: "cancelled",
      cancelledAt: new Date(),
      cancelReason: reason,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(idcaExitInstructions.cycleId, cycleId),
        inArray(idcaExitInstructions.status, ["pending", "failed_requires_review"])
      )
    );
}
