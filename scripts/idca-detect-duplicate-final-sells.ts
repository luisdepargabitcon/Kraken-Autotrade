/**
 * IDCA Duplicate Final Sells Detector — DRY-RUN
 * 
 * Detecta automáticamente ciclos cerrados BTC/USD con ventas finales/trailing duplicadas.
 * Por defecto: DRY_RUN=true (no borra nada).
 * 
 * Uso:
 *   npx tsx scripts/idca-detect-duplicate-final-sells.ts          # dry-run
 *   npx tsx scripts/idca-detect-duplicate-final-sells.ts --apply  # aplicar limpieza
 * 
 * Criterios de candidato:
 * - pair = BTC/USD
 * - status closed/completed
 * - finalTrailingSellCount >= 3
 * - totalSoldQty > totalBoughtQty * 1.05
 * - múltiples ventas con motivo "final/trailing" muy parecido
 * 
 * Aborta si:
 * - candidateCount = 0
 * - candidateCount > 1
 * - no puede crear backup (en modo --apply)
 */

import { db } from "../server/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { institutionalDcaCycles, institutionalDcaOrders, institutionalDcaEvents } from "../shared/schema";

const TAG = "[IDCA_DUP_FINAL_SELL]";

interface DuplicateCandidate {
  cycleId: number;
  pair: string;
  openedAt: Date;
  closedAt: Date;
  buyCount: number;
  sellCount: number;
  finalTrailingSellCount: number;
  totalBoughtQty: number;
  totalSoldQtyRaw: number;
  totalSoldQtyAfterCleanup: number;
  capitalBought: number;
  soldUsdRaw: number;
  soldUsdAfterCleanup: number;
  pnlBefore: number;
  pnlAfterEstimated: number;
  keepOrderId: number | null;
  duplicateOrderIds: number[];
  finalSells: Array<{
    orderId: number;
    executedAt: Date;
    price: number;
    qty: number;
    usd: number;
    exchangeOrderId: string | null;
    reason: string;
    decision: "KEEP" | "DUPLICATE";
    why: string;
  }>;
}

async function main() {
  const args = process.argv.slice(2);
  const APPLY_MODE = args.includes("--apply");
  const DRY_RUN = !APPLY_MODE;

  console.log(`${TAG} ==========================================`);
  console.log(`${TAG} DUPLICATE FINAL SELLS DETECTOR`);
  console.log(`${TAG} MODE: ${DRY_RUN ? "DRY-RUN (no changes)" : "APPLY (will delete)"}`);
  console.log(`${TAG} ==========================================`);

  // 1. Buscar ciclos cerrados BTC/USD
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

  console.log(`${TAG} Found ${closedBtcCycles.length} closed BTC/USD cycles`);

  // 2. Analizar cada ciclo para detectar duplicados
  const candidates: DuplicateCandidate[] = [];

  for (const cycle of closedBtcCycles) {
    const cycleId = cycle.id;

    // Obtener todas las órdenes del ciclo
    const orders = await db
      .select()
      .from(institutionalDcaOrders)
      .where(eq(institutionalDcaOrders.cycleId, cycleId))
      .orderBy(desc(institutionalDcaOrders.executedAt));

    const buyOrders = orders.filter(o => o.side === "buy");
    const sellOrders = orders.filter(o => o.side === "sell");

    // Detectar ventas finales/trailing
    const finalTrailingSells = sellOrders.filter(o => {
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

    const totalBoughtQty = buyOrders.reduce((sum, o) => sum + parseFloat(o.quantity || "0"), 0);
    const totalSoldQtyRaw = sellOrders.reduce((sum, o) => sum + parseFloat(o.quantity || "0"), 0);
    const capitalBought = buyOrders.reduce((sum, o) => sum + parseFloat(o.netValueUsd || "0"), 0);
    const soldUsdRaw = sellOrders.reduce((sum, o) => sum + parseFloat(o.netValueUsd || "0"), 0);

    // Criterio de candidato: muchas ventas finales y qty vendida > qty comprada
    const isCandidate =
      finalTrailingSells.length >= 3 &&
      totalSoldQtyRaw > totalBoughtQty * 1.05;

    if (!isCandidate) continue;

    // 3. Analizar ventas finales para determinar cuál conservar
    const finalSellsAnalysis = finalTrailingSells.map(o => {
      const hasUniqueId = !!o.exchangeOrderId;
      return {
        orderId: o.id,
        executedAt: o.executedAt || new Date(),
        price: parseFloat(o.price || "0"),
        qty: parseFloat(o.quantity || "0"),
        usd: parseFloat(o.netValueUsd || "0"),
        exchangeOrderId: o.exchangeOrderId || null,
        reason: o.humanReason || o.triggerReason || "",
        hasUniqueId,
      };
    });

    // Ordenar por: primero las con ID único, luego por fecha
    finalSellsAnalysis.sort((a, b) => {
      if (a.hasUniqueId && !b.hasUniqueId) return -1;
      if (!a.hasUniqueId && b.hasUniqueId) return 1;
      return a.executedAt.getTime() - b.executedAt.getTime();
    });

    // Determinar cuál conservar (la primera con ID único, o la primera por fecha)
    const keepOrder = finalSellsAnalysis[0];
    const keepOrderId = keepOrder?.orderId || null;

    // Marcar el resto como duplicados
    const duplicateOrderIds: number[] = [];
    const finalSellsWithDecision = finalSellsAnalysis.map(o => {
      const isKeep = o.orderId === keepOrderId;
      const decision: "KEEP" | "DUPLICATE" = isKeep ? "KEEP" : "DUPLICATE";
      const why = isKeep
        ? keepOrder?.hasUniqueId
          ? "Has unique exchangeOrderId/tradeId/clientOrderId"
          : "First final sell by executedAt"
        : "Duplicate final sell (same cycle, similar qty/price/reason)";
      
      if (!isKeep) duplicateOrderIds.push(o.orderId);

      return {
        ...o,
        decision,
        why,
      };
    });

    // Calcular totales después de limpieza
    const totalSoldQtyAfterCleanup = totalSoldQtyRaw - duplicateOrderIds.reduce((sum, id) => {
      const o = finalSellsAnalysis.find(f => f.orderId === id);
      return sum + (o?.qty || 0);
    }, 0);

    const soldUsdAfterCleanup = soldUsdRaw - duplicateOrderIds.reduce((sum, id) => {
      const o = finalSellsAnalysis.find(f => f.orderId === id);
      return sum + (o?.usd || 0);
    }, 0);

    const pnlBefore = soldUsdRaw - capitalBought;
    const pnlAfterEstimated = soldUsdAfterCleanup - capitalBought;

    candidates.push({
      cycleId,
      pair: cycle.pair,
      openedAt: cycle.startedAt || new Date(),
      closedAt: cycle.closedAt || new Date(),
      buyCount: buyOrders.length,
      sellCount: sellOrders.length,
      finalTrailingSellCount: finalTrailingSells.length,
      totalBoughtQty,
      totalSoldQtyRaw,
      totalSoldQtyAfterCleanup,
      capitalBought,
      soldUsdRaw,
      soldUsdAfterCleanup,
      pnlBefore,
      pnlAfterEstimated,
      keepOrderId,
      duplicateOrderIds,
      finalSells: finalSellsWithDecision,
    });
  }

  // 4. Imprimir informe
  console.log(`\n${TAG} ==========================================`);
  console.log(`${TAG} CANDIDATE COUNT: ${candidates.length}`);
  console.log(`${TAG} ==========================================\n`);

  for (const c of candidates) {
    console.log(`${TAG} --- CANDIDATE CYCLE #${c.cycleId} ---`);
    console.log(`${TAG} pair=${c.pair}`);
    console.log(`${TAG} openedAt=${c.openedAt.toISOString()}`);
    console.log(`${TAG} closedAt=${c.closedAt.toISOString()}`);
    console.log(`${TAG} buyCount=${c.buyCount}`);
    console.log(`${TAG} sellCount=${c.sellCount}`);
    console.log(`${TAG} finalTrailingSellCount=${c.finalTrailingSellCount}`);
    console.log(`${TAG} totalBoughtQty=${c.totalBoughtQty.toFixed(8)}`);
    console.log(`${TAG} totalSoldQtyRaw=${c.totalSoldQtyRaw.toFixed(8)}`);
    console.log(`${TAG} totalSoldQtyAfterCleanup=${c.totalSoldQtyAfterCleanup.toFixed(8)}`);
    console.log(`${TAG} capitalBought=$${c.capitalBought.toFixed(2)}`);
    console.log(`${TAG} soldUsdRaw=$${c.soldUsdRaw.toFixed(2)}`);
    console.log(`${TAG} soldUsdAfterCleanup=$${c.soldUsdAfterCleanup.toFixed(2)}`);
    console.log(`${TAG} pnlBefore=$${c.pnlBefore.toFixed(2)}`);
    console.log(`${TAG} pnlAfterEstimated=$${c.pnlAfterEstimated.toFixed(2)}`);
    console.log(`${TAG} keepOrderId=${c.keepOrderId}`);
    console.log(`${TAG} duplicateOrderIds=[${c.duplicateOrderIds.join(", ")}]`);
    console.log(`${TAG}`);
    console.log(`${TAG} --- FINAL SELLS DETAIL ---`);
    for (const fs of c.finalSells) {
      console.log(`${TAG} orderId=${fs.orderId} executedAt=${fs.executedAt.toISOString()} price=${fs.price} qty=${fs.qty} usd=${fs.usd}`);
      console.log(`${TAG}   exchangeOrderId=${fs.exchangeOrderId}`);
      console.log(`${TAG}   reason="${fs.reason}"`);
      console.log(`${TAG}   decision=${fs.decision} why=${fs.why}`);
    }
    console.log(`${TAG} ----------------------------------------\n`);
  }

  // 5. Validación de seguridad
  if (candidates.length === 0) {
    console.log(`${TAG} ❌ ABORT: No candidates found. Nothing to do.`);
    process.exit(0);
  }

  if (candidates.length > 1) {
    console.log(`${TAG} ❌ ABORT: ${candidates.length} candidates found. Ambiguous. Manual review required.`);
    process.exit(1);
  }

  // 6. Modo APPLY
  if (APPLY_MODE) {
    const candidate = candidates[0];
    console.log(`${TAG} ==========================================`);
    console.log(`${TAG} APPLY MODE - CLEANUP CYCLE #${candidate.cycleId}`);
    console.log(`${TAG} ==========================================`);

    if (candidate.duplicateOrderIds.length === 0) {
      console.log(`${TAG} ❌ ABORT: No duplicate orders to delete.`);
      process.exit(1);
    }

    const cleanupId = `cleanup_${Date.now()}`;

    try {
      await db.transaction(async (trx) => {
        // 6a. Backup antes de borrar
        const duplicateRowsFullData = await trx
          .select()
          .from(institutionalDcaOrders)
          .where(sql`${institutionalDcaOrders.id} = ANY(${candidate.duplicateOrderIds})`);

        await trx.insert(institutionalDcaEvents).values({
          cycleId: candidate.cycleId,
          pair: candidate.pair,
          mode: "live",
          eventType: "duplicate_final_sell_cleanup_backup",
          severity: "warning",
          message: `Backup before cleanup: ${candidate.duplicateOrderIds.length} duplicate final sells removed from cycle #${candidate.cycleId}.`,
          payloadJson: JSON.stringify({
            cleanupId,
            keptOrderId: candidate.keepOrderId,
            duplicateOrderIds: candidate.duplicateOrderIds,
            duplicateRowsFullData,
            dryRunSummary: {
              totalSoldQtyBefore: candidate.totalSoldQtyRaw,
              totalSoldQtyAfter: candidate.totalSoldQtyAfterCleanup,
              pnlBefore: candidate.pnlBefore,
              pnlAfter: candidate.pnlAfterEstimated,
            },
            reason: "Duplicate final trailing sells detected and removed",
          }),
          createdAt: new Date(),
        });

        console.log(`${TAG} ✅ Backup created in institutional_dca_events`);

        // 6b. Eliminar duplicadas
        await trx
          .delete(institutionalDcaOrders)
          .where(sql`${institutionalDcaOrders.id} = ANY(${candidate.duplicateOrderIds})`);

        console.log(`${TAG} ✅ Deleted ${candidate.duplicateOrderIds.length} duplicate orders`);

        // 6c. Recalcular ciclo
        const ordersAfter = await trx
          .select()
          .from(institutionalDcaOrders)
          .where(eq(institutionalDcaOrders.cycleId, candidate.cycleId));

        const totalQty = ordersAfter.reduce((sum, o) => sum + parseFloat(o.quantity || "0"), 0);
        const totalCost = ordersAfter.reduce((sum, o) => sum + parseFloat(o.netValueUsd || "0"), 0);
        const buyCount = ordersAfter.filter(o => o.side === "buy").length;
        const sellCount = ordersAfter.filter(o => o.side === "sell").length;
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
          .where(eq(institutionalDcaCycles.id, candidate.cycleId));

        console.log(`${TAG} ✅ Cycle recalculated: qty=${totalQty.toFixed(8)} cost=${totalCost.toFixed(2)} avg=${avg.toFixed(2)}`);

        // 6d. Evento de completado
        await trx.insert(institutionalDcaEvents).values({
          cycleId: candidate.cycleId,
          pair: candidate.pair,
          mode: "live",
          eventType: "duplicate_final_sell_cleanup_completed",
          severity: "info",
          message: `Cleanup completed: ${candidate.duplicateOrderIds.length} duplicate final sells removed from cycle #${candidate.cycleId}. Cycle recalculated.`,
          payloadJson: JSON.stringify({
            cleanupId,
            duplicateOrderIds: candidate.duplicateOrderIds,
            newTotalQty: totalQty,
            newCapitalUsed: totalCost,
            newAvg: avg,
            newBuyCount: buyCount,
            newSellCount: sellCount,
          }),
          createdAt: new Date(),
        });

        console.log(`${TAG} ✅ Cleanup completed event logged`);
      });

      console.log(`${TAG} ==========================================`);
      console.log(`${TAG} ✅ CLEANUP SUCCESSFUL`);
      console.log(`${TAG} ==========================================`);
    } catch (error: any) {
      console.error(`${TAG} ❌ CLEANUP FAILED: ${error.message}`);
      console.error(error);
      process.exit(1);
    }
  } else {
    console.log(`${TAG} ==========================================`);
    console.log(`${TAG} DRY-RUN COMPLETE`);
    console.log(`${TAG} To apply cleanup, run: npx tsx scripts/idca-detect-duplicate-final-sells.ts --apply`);
    console.log(`${TAG} ==========================================`);
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(`${TAG} FATAL ERROR:`, error);
  process.exit(1);
});
