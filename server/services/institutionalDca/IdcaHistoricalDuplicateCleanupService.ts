/**
 * IDCA Historical Duplicate Final Sells Cleanup Service
 * 
 * Ejecuta automáticamente la limpieza de ventas finales duplicadas en el ciclo histórico afectado.
 * Solo se ejecuta una vez (idempotente) con guards estrictos de seguridad.
 * 
 * Ciclo afectado: cycle_id 22 (BTC/USD cerrado)
 * keepOrderId: 57
 * duplicateOrderIds: 58..493, 754
 */

import { db } from "../../db";
import { eq, and, desc, sql } from "drizzle-orm";
import { institutionalDcaCycles, institutionalDcaOrders, institutionalDcaEvents } from "@shared/schema";

const TAG = "[IDCA][DUP_FINAL_SELL_CLEANUP]";
const CLEANUP_KEY = "cycle_22_duplicate_final_sells_2026_05_11";

interface CleanupCandidate {
  cycleId: number;
  pair: string;
  totalBoughtQty: number;
  totalSoldQtyRaw: number;
  totalSoldQtyAfterCleanup: number;
  dustTolerance: number;
  keepOrderId: number | null;
  duplicateOrderIds: number[];
  applyBlocked: boolean;
  applyBlockedReason: string | null;
}

/**
 * Detecta duplicados de ventas finales en ciclos cerrados BTC/USD
 */
async function detectDuplicateFinalSells(): Promise<CleanupCandidate[]> {
  const closedBtcCycles = await db
    .select()
    .from(institutionalDcaCycles)
    .where(
      and(
        eq(institutionalDcaCycles.pair, "BTC/USD"),
        sql`${institutionalDcaCycles.status} IN ('closed', 'completed')`
      )
    )
    .orderBy(desc(institutionalDcaCycles.closedAt));

  const candidates: CleanupCandidate[] = [];

  for (const cycle of closedBtcCycles) {
    const cycleId = cycle.id;

    const orders = await db
      .select()
      .from(institutionalDcaOrders)
      .where(eq(institutionalDcaOrders.cycleId, cycleId))
      .orderBy(desc(institutionalDcaOrders.executedAt));

    const buyOrders = orders.filter((o: any) => o.side === "buy");
    const sellOrders = orders.filter((o: any) => o.side === "sell");

    const finalTrailingSells = sellOrders.filter((o: any) => {
      const type = (o.orderType || "").toLowerCase();
      const reason = (o.humanReason || o.triggerReason || "").toLowerCase();
      return (
        type.includes("final") ||
        type.includes("trailing") ||
        reason.includes("final") ||
        reason.includes("trailing") ||
        reason.includes("cerró el ciclo vendiendo la posición restante")
      );
    });

    const totalBoughtQty = buyOrders.reduce((sum: number, o: any) => sum + parseFloat(o.quantity || "0"), 0);
    const totalSoldQtyRaw = sellOrders.reduce((sum: number, o: any) => sum + parseFloat(o.quantity || "0"), 0);

    const isCandidate =
      finalTrailingSells.length >= 3 &&
      totalSoldQtyRaw > totalBoughtQty * 1.05;

    if (!isCandidate) continue;

    const finalSellsAnalysis = finalTrailingSells.map((o: any) => {
      const hasUniqueId = !!o.exchangeOrderId;
      return {
        orderId: o.id,
        executedAt: o.executedAt || new Date(),
        qty: parseFloat(o.quantity || "0"),
        usd: parseFloat(o.netValueUsd || "0"),
        exchangeOrderId: o.exchangeOrderId || null,
        hasUniqueId,
      };
    });

    finalSellsAnalysis.sort((a: any, b: any) => {
      if (a.hasUniqueId && !b.hasUniqueId) return -1;
      if (!a.hasUniqueId && b.hasUniqueId) return 1;
      return a.executedAt.getTime() - b.executedAt.getTime();
    });

    const keepOrder = finalSellsAnalysis[0];
    const keepOrderId = keepOrder?.orderId || null;

    const duplicateOrderIds: number[] = [];
    finalSellsAnalysis.forEach((o: any) => {
      if (o.orderId !== keepOrderId) duplicateOrderIds.push(o.orderId);
    });

    // Detectar SELL post-cierre
    if (keepOrder) {
      const postCloseDuplicateCandidates = sellOrders.filter((o: any) => {
        if (duplicateOrderIds.includes(o.id)) return false;
        if (o.id === keepOrderId) return false;
        if (o.exchangeOrderId) return false;
        const executedAt = o.executedAt || new Date();
        if (executedAt <= keepOrder.executedAt) return false;
        const qty = parseFloat(o.quantity || "0");
        const qtySimilarToBought = Math.abs(qty - totalBoughtQty) / totalBoughtQty < 0.10;
        const qtySimilarToKeep = keepOrder && Math.abs(qty - keepOrder.qty) / keepOrder.qty < 0.10;
        if (!qtySimilarToBought && !qtySimilarToKeep) return false;
        const currentSoldAfterCleanup = totalSoldQtyRaw - duplicateOrderIds.reduce((sum: number, id: number) => {
          const dup = finalSellsAnalysis.find((f: any) => f.orderId === id);
          return sum + (dup?.qty || 0);
        }, 0);
        const soldWithThisOrder = currentSoldAfterCleanup + qty;
        const dustTolerance = Math.max(0.00000010, totalBoughtQty * 0.005);
        if (soldWithThisOrder <= totalBoughtQty + dustTolerance) return false;
        return true;
      });

      for (const postCloseDup of postCloseDuplicateCandidates) {
        duplicateOrderIds.push(postCloseDup.id);
      }
    }

    const totalSoldQtyAfterCleanup = totalSoldQtyRaw - duplicateOrderIds.reduce((sum: number, id: number) => {
      const o = sellOrders.find((s: any) => s.id === id);
      return sum + parseFloat(o?.quantity || "0");
    }, 0);

    const dustTolerance = Math.max(0.00000010, totalBoughtQty * 0.005);
    const applyBlocked = totalSoldQtyAfterCleanup > totalBoughtQty + dustTolerance;
    const applyBlockedReason = applyBlocked
      ? `remaining_sold_exceeds_bought: ${totalSoldQtyAfterCleanup.toFixed(8)} > ${totalBoughtQty.toFixed(8)} + ${dustTolerance.toFixed(8)}`
      : null;

    candidates.push({
      cycleId,
      pair: cycle.pair,
      totalBoughtQty,
      totalSoldQtyRaw,
      totalSoldQtyAfterCleanup,
      dustTolerance,
      keepOrderId,
      duplicateOrderIds,
      applyBlocked,
      applyBlockedReason,
    });
  }

  return candidates;
}

/**
 * Verifica si la limpieza ya se aplicó (idempotencia)
 */
async function isCleanupAlreadyApplied(): Promise<boolean> {
  const existing = await db
    .select()
    .from(institutionalDcaEvents)
    .where(
      and(
        eq(institutionalDcaEvents.eventType, "duplicate_final_sell_cleanup_completed"),
        sql`${institutionalDcaEvents.payloadJson}::jsonb->>'cleanupKey' = ${CLEANUP_KEY}`
      )
    )
    .limit(1);

  return existing.length > 0;
}

/**
 * Aplica la limpieza de duplicados con backup obligatorio
 */
async function applyCleanup(candidate: CleanupCandidate): Promise<void> {
  const { cycleId, pair, keepOrderId, duplicateOrderIds, totalBoughtQty, totalSoldQtyAfterCleanup, dustTolerance, totalSoldQtyRaw } = candidate;

  if (duplicateOrderIds.length === 0) {
    throw new Error("No duplicate orders to delete");
  }

  const cleanupId = `cleanup_${Date.now()}`;

  await db.transaction(async (trx: any) => {
    // Backup
    const duplicateRowsFullData = await trx
      .select()
      .from(institutionalDcaOrders)
      .where(sql`${institutionalDcaOrders.id} = ANY(${duplicateOrderIds})`);

    // Calcular capital comprado para PnL
    const buyOrdersBefore = await trx
      .select()
      .from(institutionalDcaOrders)
      .where(
        and(
          eq(institutionalDcaOrders.cycleId, cycleId),
          eq(institutionalDcaOrders.side, "buy")
        )
      );
    const capitalBought = buyOrdersBefore.reduce((sum: number, o: any) => sum + parseFloat(o.netValueUsd || "0"), 0);
    const pnlBefore = totalSoldQtyRaw - capitalBought;

    await trx.insert(institutionalDcaEvents).values({
      cycleId,
      pair,
      mode: "live",
      eventType: "duplicate_final_sell_cleanup_backup",
      severity: "warning",
      message: `Backup before cleanup: ${duplicateOrderIds.length} duplicate final sells removed from cycle #${cycleId}.`,
      payloadJson: JSON.stringify({
        cleanupKey: CLEANUP_KEY,
        cleanupId,
        keptOrderId: keepOrderId,
        duplicateOrderIds,
        duplicateRowsFullData,
        totalBoughtQty,
        totalSoldQtyRaw,
        totalSoldQtyAfterCleanup,
        dustTolerance,
        pnlBefore,
        reason: "Duplicate final trailing sells detected and removed",
      }),
      createdAt: new Date(),
    });

    console.log(`${TAG} backup created`);

    // Delete duplicates
    await trx
      .delete(institutionalDcaOrders)
      .where(sql`${institutionalDcaOrders.id} = ANY(${duplicateOrderIds})`);

    console.log(`${TAG} deleted duplicate orders count=${duplicateOrderIds.length}`);

    // Recalculate cycle
    const ordersAfter = await trx
      .select()
      .from(institutionalDcaOrders)
      .where(eq(institutionalDcaOrders.cycleId, cycleId));

    const totalQty = ordersAfter.reduce((sum: number, o: any) => sum + parseFloat(o.quantity || "0"), 0);
    const totalCost = ordersAfter.reduce((sum: number, o: any) => sum + parseFloat(o.netValueUsd || "0"), 0);
    const buyCount = ordersAfter.filter((o: any) => o.side === "buy").length;
    const avg = totalQty > 0 ? totalCost / totalQty : 0;

    await trx
      .update(institutionalDcaCycles)
      .set({
        totalQuantity: totalQty.toFixed(8),
        capitalUsedUsd: totalCost.toFixed(2),
        avgEntryPrice: avg.toFixed(8),
        buyCount,
        updatedAt: new Date(),
      })
      .where(eq(institutionalDcaCycles.id, cycleId));

    console.log(`${TAG} cycle recalculated qty=${totalQty.toFixed(8)} cost=${totalCost.toFixed(2)}`);

    // Log completion
    await trx.insert(institutionalDcaEvents).values({
      cycleId,
      pair,
      mode: "live",
      eventType: "duplicate_final_sell_cleanup_completed",
      severity: "info",
      message: `Cleanup completed: ${duplicateOrderIds.length} duplicate final sells removed from cycle #${cycleId}. Cycle recalculated.`,
      payloadJson: JSON.stringify({
        cleanupKey: CLEANUP_KEY,
        cleanupId,
        keptOrderId: keepOrderId,
        deletedOrderIds: duplicateOrderIds,
        deletedCount: duplicateOrderIds.length,
        totalBoughtQty,
        totalSoldQtyAfterCleanup,
        newTotalQty: totalQty,
        newCapitalUsed: totalCost,
        newAvg: avg,
        newBuyCount: buyCount,
      }),
      createdAt: new Date(),
    });

    console.log(`${TAG} completed cycleId=${cycleId}`);
  });
}

/**
 * Ejecuta la limpieza histórica de duplicados una sola vez
 * Se llama durante el startup del servidor
 */
export async function runIdcaHistoricalDuplicateCleanupOnce(): Promise<void> {
  try {
    console.log(`${TAG} checking historical duplicate final sells`);

    // Idempotencia: verificar si ya se aplicó
    const alreadyApplied = await isCleanupAlreadyApplied();
    if (alreadyApplied) {
      console.log(`${TAG} already applied, skipping`);
      return;
    }

    // Detectar candidatos
    const candidates = await detectDuplicateFinalSells();

    if (candidates.length === 0) {
      console.log(`${TAG} no candidates found, skipping`);
      return;
    }

    if (candidates.length > 1) {
      console.log(`${TAG} aborted reason=multiple_candidates_found count=${candidates.length}`);
      return;
    }

    const candidate = candidates[0];

    // Guards de seguridad
    if (candidate.applyBlocked) {
      console.log(`${TAG} aborted reason=${candidate.applyBlockedReason}`);
      return;
    }

    if (candidate.cycleId !== 22) {
      console.log(`${TAG} aborted reason=unexpected_cycle_id cycleId=${candidate.cycleId}`);
      return;
    }

    if (candidate.keepOrderId !== 57) {
      console.log(`${TAG} aborted reason=unexpected_keep_order_id keepOrderId=${candidate.keepOrderId}`);
      return;
    }

    if (!candidate.duplicateOrderIds.includes(754)) {
      console.log(`${TAG} aborted reason=post_close_sell_754_not_in_duplicates`);
      return;
    }

    console.log(`${TAG} candidate cycleId=${candidate.cycleId} keepOrderId=${candidate.keepOrderId} duplicates=${candidate.duplicateOrderIds.length} applyBlocked=${candidate.applyBlocked}`);

    // Aplicar limpieza
    await applyCleanup(candidate);

  } catch (error: any) {
    console.error(`${TAG} failed reason=${error.message}`, error);
    // No lanzar excepción para no bloquear el startup
  }
}
