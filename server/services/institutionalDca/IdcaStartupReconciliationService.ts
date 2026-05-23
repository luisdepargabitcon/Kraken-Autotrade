/**
 * IdcaStartupReconciliationService — HOTFIX: Auto-reconciliación segura en startup/deploy
 * 
 * Responsabilidad: Antes de activar el scheduler IDCA LIVE, reconciliar automáticamente
 * compras fantasma o parciales no verificadas. Si no puede verificar con certeza,
 * bloquea el ciclo para ejecución automática en lugar de inventar datos.
 * 
 * REGLA DE ORO: Solo auto-aplica cambios si son deterministas y seguros.
 * Si hay duda, bloquea el ciclo afectado.
 */
import { db } from "../../db";
import { eq, and, ne } from "drizzle-orm";
import { ExchangeFactory } from "../exchanges/ExchangeFactory";
import * as repo from "./IdcaRepository";
import * as telegram from "./IdcaTelegramNotifier";
import { institutionalDcaCycles, institutionalDcaOrders, institutionalDcaEvents, type InstitutionalDcaOrder } from "@shared/schema";

const TAG = "[IDCA_RECONCILE]";

export interface ReconciliationResult {
  cyclesChecked: number;
  ordersChecked: number;
  phantomsFound: number;
  phantomsVoided: number;
  partialsAdjusted: number;
  ambiguousBlocked: number;
  /** Critical errors that should block the global scheduler (DB corruption, technical failures) */
  criticalErrors: string[];
  /** Legacy warnings that only block affected cycles, not the global scheduler */
  warnings: string[];
  /** @deprecated Use criticalErrors instead */
  errors: string[];
  safeToStart: boolean;
  /** Cycles that need manual review but shouldn't block the global scheduler */
  cyclesNeedingReview: Array<{ pair: string; cycleId: number; reason: string }>;
}

export interface PhantomCheckResult {
  isPhantom: boolean;
  confidence: "high" | "medium" | "low";
  reason: string;
  exchangeOrderId?: string;
  exchangeFillFound?: boolean;
}

/**
 * Void canónico de una compra fantasma y recalculo del ciclo.
 *
 * Busca EXACTAMENTE UNA orden candidata en el ciclo que cumpla todos los criterios.
 * Si hay 0 o más de 1 candidatas, aborta sin tocar nada.
 * Es idempotente: si la orden ya está phantom_voided, no recalcula de nuevo.
 *
 * @returns { voided: boolean; reason: string; orderId?: number }
 */
export async function voidPhantomBuyAndRecalculateCycle(params: {
  cycleId: number;
  pair: string;
  targetPrice: number;          // precio de la compra fantasma (e.g. 76850.70)
  targetQuantity: number;       // qty esperada (e.g. 0.010857)
  targetUsd: number;            // valor USD esperado (e.g. 834.40)
  reason: string;               // razón trazable para auditoría
  eventType?: string;           // tipo de evento (default: manual_reconciliation_phantom_buy_voided)
}): Promise<{ voided: boolean; reason: string; orderId?: number }> {
  const { cycleId, pair, targetPrice, targetQuantity, targetUsd, reason, eventType } = params;
  const PRICE_TOL = 0.01;   // 1% tolerancia en precio
  const QTY_TOL   = 0.001;  // 0.1% tolerancia en cantidad
  const USD_TOL   = 0.01;   // 1% tolerancia en valor USD

  // 1. Obtener ciclo
  const [cycle] = await db
    .select()
    .from(institutionalDcaCycles)
    .where(eq(institutionalDcaCycles.id, cycleId))
    .limit(1);

  if (!cycle) {
    return { voided: false, reason: `CYCLE_NOT_FOUND: cycleId=${cycleId}` };
  }
  if (cycle.pair !== pair) {
    return { voided: false, reason: `PAIR_MISMATCH: expected=${pair}, got=${cycle.pair}` };
  }

  // 2. Obtener todas las compras del ciclo
  const buyOrders = await db
    .select()
    .from(institutionalDcaOrders)
    .where(and(
      eq(institutionalDcaOrders.cycleId, cycleId),
      eq(institutionalDcaOrders.side, "buy")
    ));

  // 3. Buscar candidata exacta (tolerancia por floating point)
  const candidates = buyOrders.filter((o) => {
    const price = parseFloat(o.price);
    const qty   = parseFloat(o.quantity);
    const usd   = parseFloat(o.netValueUsd);
    const matchPrice = Math.abs(price - targetPrice) / targetPrice < PRICE_TOL;
    const matchQty   = Math.abs(qty   - targetQuantity) / targetQuantity < QTY_TOL;
    const matchUsd   = Math.abs(usd   - targetUsd)   / targetUsd   < USD_TOL;
    return matchPrice && matchQty && matchUsd;
  });

  if (candidates.length === 0) {
    return { voided: false, reason: `NO_CANDIDATE_FOUND: ninguna orden de compra en ciclo #${cycleId} coincide con price≈${targetPrice} qty≈${targetQuantity} usd≈${targetUsd}` };
  }
  if (candidates.length > 1) {
    return { voided: false, reason: `AMBIGUOUS: ${candidates.length} órdenes coinciden — abortar sin tocar DB. IDs: ${candidates.map(o => o.id).join(',')}` };
  }

  const target = candidates[0];

  // 4. Idempotencia: si ya está anulada, no repetir
  if (target.executionStatus === "phantom_voided") {
    console.log(`${TAG} [VOID_SKIP] Order ${target.id} already phantom_voided — idempotent skip`);
    return { voided: true, reason: "ALREADY_VOIDED_IDEMPOTENT", orderId: target.id };
  }

  console.log(`${TAG} [VOID] Voiding order #${target.id} (cycle #${cycleId} ${pair}) — ${reason}`);

  // 5. Transacción: anular + recalcular + evento
  await db.transaction(async (trx) => {
    // 5a. Marcar orden como phantom_voided (sin DELETE)
    await trx.update(institutionalDcaOrders)
      .set({
        executionStatus: "phantom_voided",
        voidedReason: reason,
        voidedAt: new Date(),
        reconciledAt: new Date(),
      })
      .where(eq(institutionalDcaOrders.id, target.id));

    // 5b. Recalcular ciclo desde órdenes válidas (excluyendo phantom_voided)
    const validBuys = await trx
      .select()
      .from(institutionalDcaOrders)
      .where(and(
        eq(institutionalDcaOrders.cycleId, cycleId),
        eq(institutionalDcaOrders.side, "buy"),
        ne(institutionalDcaOrders.executionStatus, "phantom_voided")
      ));

    let totalQty = 0;
    let totalCost = 0;
    let buyCount = 0;
    for (const o of validBuys) {
      const qty  = parseFloat(o.quantity);
      const cost = parseFloat(o.netValueUsd);
      if (qty > 0 && cost > 0) {
        totalQty  += qty;
        totalCost += cost;
        buyCount++;
      }
    }
    const newAvgPrice = totalQty > 0 ? totalCost / totalQty : 0;

    console.log(`${TAG} [VOID] Cycle #${cycleId} recalculated: qty=${totalQty.toFixed(8)}, cost=${totalCost.toFixed(2)}, avg=${newAvgPrice.toFixed(2)}, buys=${buyCount}`);

    // 5c. Actualizar agregados del ciclo + desbloquear si el status era needs_reconciliation
    const cycleUpdate: Record<string, any> = {
      totalQuantity: totalQty.toFixed(8),
      capitalUsedUsd: totalCost.toFixed(2),
      avgEntryPrice: newAvgPrice.toFixed(8),
      buyCount: buyCount,
      updatedAt: new Date(),
    };
    if (cycle.status === "needs_reconciliation") {
      cycleUpdate.status = "active";
      cycleUpdate.reconciliationStatus = "reconciled";
    }
    await trx.update(institutionalDcaCycles)
      .set(cycleUpdate)
      .where(eq(institutionalDcaCycles.id, cycleId));

    // 5d. Evento de auditoría (sin DELETE — pista trazable)
    await trx.insert(institutionalDcaEvents).values({
      cycleId,
      pair,
      mode: "live",
      eventType: eventType ?? "manual_reconciliation_phantom_buy_voided",
      severity: "warning",
      message: `Compra fantasma anulada por reconciliación: ${reason}. Ciclo recalculado desde órdenes válidas.`,
      payloadJson: {
        orderId: target.id,
        targetPrice,
        targetQuantity,
        targetUsd,
        newAvgPrice: newAvgPrice.toFixed(8),
        newTotalQty: totalQty.toFixed(8),
        newCapitalUsd: totalCost.toFixed(2),
        newBuyCount: buyCount,
        voidReason: reason,
        reconciledAt: new Date().toISOString(),
      },
    });
  });

  return { voided: true, reason: "OK", orderId: target.id };
}

/**
 * Reconcilia los fills reales de Revolut X del 23/05/2026 para BTC #24.
 *
 * Contexto: El bot marcó dos compras como no_fill:unknown aunque Revolut X sí las ejecutó.
 * Esta función las importa como órdenes reconciliadas si no existen ya en DB.
 * Es idempotente: usa idempotencyKey único por fill.
 *
 * Fill 1: 09:52 — 0.00896639 BTC @ $74,466.31 ≈ $667.69
 * Fill 2: 09:55 — 0.0011208  BTC @ $74,469.94 ≈ $83.47
 */
export async function reconcileBtc24MissingFillsMay23(): Promise<{
  applied: boolean;
  inserted: number;
  skipped: number;
  reason: string;
}> {
  const cycleId = 24;
  const pair = "BTC/USD";

  const fills = [
    {
      qty:   0.00896639,
      price: 74466.31,
      usd:   667.69,
      executedAt: new Date("2026-05-23T07:52:00.000Z"), // 09:52 Europe/Madrid = 07:52 UTC
      ikey: "RECONCILE:BTC/USD:24:2026-05-23T09:52:qty0.00896639:price74466.31",
    },
    {
      qty:   0.0011208,
      price: 74469.94,
      usd:   83.47,
      executedAt: new Date("2026-05-23T07:55:00.000Z"), // 09:55 Europe/Madrid = 07:55 UTC
      ikey: "RECONCILE:BTC/USD:24:2026-05-23T09:55:qty0.0011208:price74469.94",
    },
  ];

  // 1. Verificar que el ciclo existe
  const [cycle] = await db
    .select()
    .from(institutionalDcaCycles)
    .where(eq(institutionalDcaCycles.id, cycleId))
    .limit(1);

  if (!cycle) return { applied: false, inserted: 0, skipped: 0, reason: `CYCLE_NOT_FOUND: cycleId=${cycleId}` };
  if (cycle.pair !== pair) return { applied: false, inserted: 0, skipped: 0, reason: `PAIR_MISMATCH` };

  // 2. Obtener órdenes existentes para comprobar idempotencia
  const existingOrders = await db
    .select()
    .from(institutionalDcaOrders)
    .where(eq(institutionalDcaOrders.cycleId, cycleId));

  let inserted = 0;
  let skipped = 0;

  await db.transaction(async (trx) => {
    for (const fill of fills) {
      // Idempotencia primaria: por idempotencyKey
      const alreadyByKey = existingOrders.some(o => o.idempotencyKey === fill.ikey);
      if (alreadyByKey) {
        console.log(`${TAG} [BTC#24_FILLS] Already reconciled (key): ${fill.ikey}`);
        skipped++;
        continue;
      }
      // Idempotencia secundaria: por precio+qty parecidos con status reconciled
      const PRICE_TOL = 0.01;
      const QTY_TOL = 0.001;
      const alreadyByData = existingOrders.some(o => {
        if (!["reconciled", "filled", "confirmed"].includes(o.executionStatus ?? "")) return false;
        const pMatch = Math.abs(parseFloat(o.price) - fill.price) / fill.price < PRICE_TOL;
        const qMatch = Math.abs(parseFloat(o.quantity) - fill.qty) / fill.qty < QTY_TOL;
        return pMatch && qMatch;
      });
      if (alreadyByData) {
        console.log(`${TAG} [BTC#24_FILLS] Already reconciled (data match): price=${fill.price} qty=${fill.qty}`);
        skipped++;
        continue;
      }

      // Insertar fill reconciliado
      await trx.insert(institutionalDcaOrders).values({
        cycleId,
        pair,
        mode: "live",
        orderType: "safety_buy",
        buyIndex: 2,
        side: "buy",
        price: fill.price.toFixed(8),
        quantity: fill.qty.toFixed(8),
        grossValueUsd: fill.usd.toFixed(2),
        feesUsd: "0.00",
        slippageUsd: "0.00",
        netValueUsd: fill.usd.toFixed(2),
        executionStatus: "reconciled",
        executedQuantity: fill.qty.toFixed(8),
        executedUsd: fill.usd.toFixed(2),
        avgFillPrice: fill.price.toFixed(8),
        executedAt: fill.executedAt,
        reconciledAt: new Date(),
        idempotencyKey: fill.ikey,
        triggerReason: "revolutx_reconciliation",
        humanReason: "Compra ejecutada en Revolut X reconciliada desde historial; originalmente marcada como no_fill: unknown.",
        needsVerificationReason: null,
      });
      console.log(`${TAG} [BTC#24_FILLS] Inserted reconciled fill: price=${fill.price} qty=${fill.qty} usd=${fill.usd}`);
      inserted++;
    }

    // 3. Siempre recalcular ciclo desde órdenes válidas (incluso si inserted=0, para corregir desviaciones)
    // Incluir: filled, confirmed, reconciled, partially_filled + legacy sin status explícito pero con datos válidos
    // Excluir explícitamente: phantom/voided/rejected/canceled/failed/no_fill y variantes
    const EXCLUDED_STATUSES = [
      "phantom_voided",
      "voided_by_reconciliation",
      "rejected",
      "canceled",
      "cancelled",
      "failed",
      "no_fill",
      "no_fill_confirmed",
      "execution_unknown_pending_reconciliation"
    ];
    const allBuys = await trx
      .select()
      .from(institutionalDcaOrders)
      .where(and(
        eq(institutionalDcaOrders.cycleId, cycleId),
        eq(institutionalDcaOrders.side, "buy")
      ));

    const validBuys: InstitutionalDcaOrder[] = [];
    for (const o of allBuys) {
      const rawStatus = o.executionStatus ?? "";
      const st = String(rawStatus).trim().toLowerCase();
      const qty = parseFloat(o.executedQuantity ?? o.quantity);
      const cost = parseFloat(o.executedUsd ?? o.netValueUsd);
      const hasPositiveData = qty > 0 && cost > 0;
      const excluded = EXCLUDED_STATUSES.includes(st);
      const included = !excluded && hasPositiveData;

      // Log de auditoría detallado para BTC #24
      const reason = excluded
        ? "excluded_status"
        : !hasPositiveData
          ? "zero_qty_or_cost"
          : "positive_qty_cost_legacy";
      console.log(`${TAG} [BTC#24_RECALC_ORDER] orderId=${o.id} status="${rawStatus}" normalized="${st}" qty=${qty.toFixed(8)} cost=${cost.toFixed(2)} included=${included} reason=${reason}`);

      if (included) validBuys.push(o);
    }

    let totalQty = 0, totalCost = 0, buyCount = 0;
    for (const o of validBuys) {
      const qty  = parseFloat(o.executedQuantity ?? o.quantity);
      const cost = parseFloat(o.executedUsd ?? o.netValueUsd);
      if (qty > 0 && cost > 0) { totalQty += qty; totalCost += cost; buyCount++; }
    }
    const newAvg = totalQty > 0 ? totalCost / totalQty : 0;

    console.log(`${TAG} [BTC#24_FILLS] Recalculated: qty=${totalQty.toFixed(8)} cost=${totalCost.toFixed(2)} avg=${newAvg.toFixed(2)} buys=${buyCount} (validOrders=${validBuys.length})`);

      await trx.update(institutionalDcaCycles)
      .set({
        totalQuantity: totalQty.toFixed(8),
        capitalUsedUsd: totalCost.toFixed(2),
        avgEntryPrice: newAvg.toFixed(8),
        buyCount,
        updatedAt: new Date(),
      })
      .where(eq(institutionalDcaCycles.id, cycleId));

    // 4. Evento de auditoría
    await trx.insert(institutionalDcaEvents).values({
      cycleId,
      pair,
      mode: "live",
      eventType: "fills_reconciled_from_exchange_history",
      severity: "info",
      message: `${inserted} fill(s) de Revolut X importados para BTC #24. Ciclo recalculado: qty=${totalQty.toFixed(8)}, avg=${newAvg.toFixed(2)}, capital=${totalCost.toFixed(2)}.`,
      payloadJson: { inserted, fills: fills.map(f => ({ price: f.price, qty: f.qty, usd: f.usd })), newAvg, newTotalQty: totalQty, newCapital: totalCost },
    });
  });

  return {
    applied: inserted > 0,
    inserted,
    skipped,
    reason: inserted > 0 ? "OK" : skipped > 0 ? "ALREADY_RECONCILED_IDEMPOTENT" : "NO_ACTION",
  };
}

/**
 * Ejecuta reconciliación automática segura al arrancar.
 * Debe llamarse ANTES de activar el scheduler IDCA LIVE.
 */
export async function runStartupReconciliation(): Promise<ReconciliationResult> {
  console.log(`${TAG} ==========================================`);
  console.log(`${TAG} STARTUP RECONCILIATION STARTED`);
  console.log(`${TAG} ==========================================`);

  const result: ReconciliationResult = {
    cyclesChecked: 0,
    ordersChecked: 0,
    phantomsFound: 0,
    phantomsVoided: 0,
    partialsAdjusted: 0,
    ambiguousBlocked: 0,
    criticalErrors: [],
    warnings: [],
    errors: [], // deprecated, kept for backward compatibility
    safeToStart: true,
    cyclesNeedingReview: [],
  };

  // Set para deduplicar ciclos bloqueados (por pair+cycleId+reason)
  const blockedCyclesUnique = new Set<string>();

  try {
    // 1. Buscar ciclos activos LIVE
    const activeCycles = await repo.getAllActiveCycles("live");
    result.cyclesChecked = activeCycles.length;
    console.log(`${TAG} Found ${activeCycles.length} active LIVE cycles`);

    if (activeCycles.length === 0) {
      console.log(`${TAG} No active cycles to reconcile`);
      return result;
    }

    // 2. Para cada ciclo, verificar órdenes recientes
    for (const cycle of activeCycles) {
      try {
        await reconcileCycle(cycle, result, blockedCyclesUnique);
      } catch (cycleError: any) {
        console.error(`${TAG} Error reconciling cycle ${cycle.id}: ${cycleError.message}`);
        // Errores técnicos durante reconciliación son críticos
        result.criticalErrors.push(`cycle_${cycle.id}: ${cycleError.message}`);
        result.errors.push(`cycle_${cycle.id}: ${cycleError.message}`);
      }
    }

    // 3. Reparación específica BTC #24 — idempotente
    // Compra adicional fantasma del 18/05/26 05:14 — sin saldo real en Revolut X
    // Condiciones de auto-aplicación:
    //   - ciclo #24 existe y es BTC/USD LIVE
    //   - status = needs_reconciliation o active
    //   - existe EXACTAMENTE UNA orden candidata con price≈76850.70, qty≈0.010857, usd≈834.40
    //   - esa orden NO está ya phantom_voided
    //   - no hay ambigüedad
    try {
      const btc24Result = await voidPhantomBuyAndRecalculateCycle({
        cycleId: 24,
        pair: "BTC/USD",
        targetPrice: 76850.70,
        targetQuantity: 0.010857,
        targetUsd: 834.40,
        reason: "Compra no ejecutada en Revolut X por saldo insuficiente; confirmada como fantasma por usuario el 18/05/2026",
        eventType: "manual_reconciliation_phantom_buy_voided",
      });
      if (btc24Result.voided && btc24Result.reason === "OK") {
        console.log(`${TAG} [BTC#24] Phantom buy voided successfully — orderId=${btc24Result.orderId}`);
        result.phantomsFound++;
        result.phantomsVoided++;
      } else if (btc24Result.voided && btc24Result.reason === "ALREADY_VOIDED_IDEMPOTENT") {
        console.log(`${TAG} [BTC#24] Already voided — skip (idempotent)`);
      } else {
        console.warn(`${TAG} [BTC#24] Could not auto-void: ${btc24Result.reason}`);
        // No es un error crítico, solo un warning
        result.warnings.push(`btc24: ${btc24Result.reason}`);
      }
    } catch (btcError: any) {
      console.error(`${TAG} [BTC#24] Error during targeted repair: ${btcError.message}`);
      result.criticalErrors.push(`btc24_repair: ${btcError.message}`);
      result.errors.push(`btc24_repair: ${btcError.message}`);
    }

    // 3b. Importar fills reales de Revolut X del 23/05/2026 para BTC #24
    try {
      const fillsResult = await reconcileBtc24MissingFillsMay23();
      if (fillsResult.applied) {
        console.log(`${TAG} [BTC#24_FILLS] Reconciled ${fillsResult.inserted} fill(s) — cycle recalculated`);
      } else {
        console.log(`${TAG} [BTC#24_FILLS] ${fillsResult.reason} (inserted=${fillsResult.inserted} skipped=${fillsResult.skipped})`);
      }
    } catch (fillsError: any) {
      console.error(`${TAG} [BTC#24_FILLS] Error importing fills: ${fillsError.message}`);
      result.warnings.push(`btc24_fills: ${fillsError.message}`);
    }

    // 4. Re-verificar qué ciclos siguen realmente bloqueados tras reparaciones específicas
    // (p.ej. BTC #24 puede haber sido restaurado a "active" por voidPhantomBuyAndRecalculateCycle)
    if (result.cyclesNeedingReview.length > 0) {
      const stillBlocked: typeof result.cyclesNeedingReview = [];
      for (const entry of result.cyclesNeedingReview) {
        const [freshCycle] = await db
          .select()
          .from(institutionalDcaCycles)
          .where(eq(institutionalDcaCycles.id, entry.cycleId))
          .limit(1);
        if (freshCycle && freshCycle.status === "needs_reconciliation") {
          stillBlocked.push(entry);
        } else if (freshCycle) {
          console.log(`${TAG} [REVIEW_CLEARED] ${entry.pair} #${entry.cycleId} status=${freshCycle.status} — removed from needsReview (restored)`);
        }
      }
      result.cyclesNeedingReview = stillBlocked;
      result.ambiguousBlocked = stillBlocked.length;
    }

    // 5. Determinar si es seguro arrancar
    // SOLO errores críticos bloquean el scheduler global
    // Ciclos ambiguos/legacy solo bloquean el ciclo afectado
    result.safeToStart = result.criticalErrors.length === 0;

    // Contar ciclos únicos bloqueados (deduplicados)
    const uniqueBlockedCycles = result.cyclesNeedingReview.length;

    console.log(`${TAG} ==========================================`);
    console.log(`${TAG} [RECONCILIATION_SUMMARY] criticalErrors=${result.criticalErrors.length} ambiguousCycles=${uniqueBlockedCycles} globalSchedulerBlocked=${!result.safeToStart} cycleBlocked=${uniqueBlockedCycles}`);
    console.log(`${TAG} Cycles checked: ${result.cyclesChecked}`);
    console.log(`${TAG} Orders checked: ${result.ordersChecked}`);
    console.log(`${TAG} Phantoms found: ${result.phantomsFound}`);
    console.log(`${TAG} Phantoms voided: ${result.phantomsVoided}`);
    console.log(`${TAG} Partials adjusted: ${result.partialsAdjusted}`);
    console.log(`${TAG} Ambiguous blocked: ${result.ambiguousBlocked} (deduplicated: ${uniqueBlockedCycles})`);
    console.log(`${TAG} Cycles needing review: ${result.cyclesNeedingReview.map(c => `${c.pair}#${c.cycleId}`).join(", ") || "none"}`);
    console.log(`${TAG} Safe to start: ${result.safeToStart}`);
    console.log(`${TAG} ==========================================`);

    // 4. Notificar resultado
    await notifyReconciliationResult(result);

    return result;

  } catch (error: any) {
    console.error(`${TAG} CRITICAL ERROR during reconciliation: ${error.message}`);
    result.criticalErrors.push(`critical: ${error.message}`);
    result.errors.push(`critical: ${error.message}`);
    result.safeToStart = false;
    return result;
  }
}

/**
 * Reconcilia un ciclo individual
 */
async function reconcileCycle(
  cycle: any,
  result: ReconciliationResult,
  blockedCyclesUnique: Set<string>
): Promise<void> {
  const pair = cycle.pair;
  const cycleId = cycle.id;

  console.log(`${TAG} Checking cycle #${cycleId} ${pair}...`);

  // Buscar órdenes de compra del ciclo
  const orders = await db
    .select()
    .from(institutionalDcaOrders)
    .where(and(
      eq(institutionalDcaOrders.cycleId, cycleId),
      eq(institutionalDcaOrders.side, "buy")
    ));

  console.log(`${TAG} Cycle #${cycleId}: ${orders.length} buy orders`);

  for (const order of orders) {
    result.ordersChecked++;

    // Skip si ya está verificado/reconciliado/anulado
    if (["verified", "reconciled", "phantom_voided", "simulated"].includes(order.executionStatus ?? "")) {
      continue;
    }

    // Skip órdenes muy antiguas (más de 30 días) — asumir correctas
    const orderAge = Date.now() - new Date(order.executedAt).getTime();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    if (orderAge > thirtyDays) {
      console.log(`${TAG} Order ${order.id}: Skipping (>${30} days old)`);
      continue;
    }

    // Verificar si es fantasma
    const phantomCheck = await checkIfPhantom(order, pair);

    // Decisiones seguras: solo auto-actuar con evidencia determinista
    if (phantomCheck.isPhantom && phantomCheck.confidence === "high") {
      // Caso A: Fantasma inequívoco con prueba determinista — anular
      console.log(`${TAG} Order ${order.id}: PHANTOM (high confidence) — voiding`);
      result.phantomsFound++;
      await voidPhantomBuy(order, cycle, phantomCheck.reason);
      result.phantomsVoided++;
    } else if (phantomCheck.reason === "legacy_order_no_exchange_order_id_needs_manual_review") {
      // Caso Legacy: Orden sin exchangeOrderId del sistema anterior
      // NO auto-anular, marcar para revisión manual
      console.log(`${TAG} Order ${order.id}: LEGACY — marking needs_verification (no auto-void)`);
      await markOrderLegacyUnverified(order);
      // Solo bloquear ciclo si hay múltiples órdenes legacy sin verificar
      if (await hasMultipleLegacyUnverifiedOrders(cycle.id)) {
        const uniqueKey = `${pair}:${cycle.id}:legacy_orders_need_verification`;
        if (!blockedCyclesUnique.has(uniqueKey)) {
          blockedCyclesUnique.add(uniqueKey);
          result.ambiguousBlocked++;
          result.cyclesNeedingReview.push({
            pair,
            cycleId: cycle.id,
            reason: "legacy_orders_need_verification",
          });
          await blockCycleForManualReview(cycle, `legacy_orders_need_verification: cycle_${cycle.id}`);
        }
      }
    } else if (phantomCheck.confidence === "low") {
      // Caso B: Evidencia insuficiente — no auto-actuar
      console.log(`${TAG} Order ${order.id}: LOW CONFIDENCE — marking needs_verification`);
      await markOrderNeedsVerification(order, phantomCheck.reason);
    } else {
      // Caso C: Parece válido — marcar como verificado
      console.log(`${TAG} Order ${order.id}: OK — marking verified`);
      await markOrderVerified(order);
    }
  }
}

/**
 * Verifica si una orden es fantasma consultando el exchange
 */
async function checkIfPhantom(order: any, pair: string): Promise<PhantomCheckResult> {
  try {
    const exchange = ExchangeFactory.getTradingExchange();
    if (!exchange.isInitialized()) {
      return {
        isPhantom: false,
        confidence: "low",
        reason: "exchange_not_initialized",
      };
    }

    // Si no tiene exchangeOrderId, verificar si es orden legacy o nueva
    if (!order.exchangeOrderId) {
      // Órdenes creadas por el nuevo sistema (post-hotfix) tienen idempotencyKey
      // Si tiene idempotencyKey pero no exchangeOrderId -> no se envió al exchange
      const isNewSystemOrder = !!order.idempotencyKey;

      if (isNewSystemOrder) {
        // Orden nueva que nunca se envió al exchange -> fantasma seguro
        return {
          isPhantom: true,
          confidence: "high",
          reason: "new_system_order_without_exchange_id",
        };
      }

      // Orden legacy (pre-hotfix) sin exchangeOrderId
      // NO auto-anular sin evidencia determinista
      return {
        isPhantom: false,
        confidence: "low",
        reason: "legacy_order_no_exchange_order_id_needs_manual_review",
      };
    }

    // Tiene exchangeOrderId — verificar estado
    const orderStatus: any = await (exchange as any).getOrderStatus?.(pair, order.exchangeOrderId);

    if (!orderStatus) {
      // No se pudo consultar estado — ambiguo
      return {
        isPhantom: false,
        confidence: "low",
        reason: "could_not_query_exchange_status",
      };
    }

    if (orderStatus.status === "filled" || orderStatus.status === "partially_filled") {
      // Orden ejecutada — no es fantasma
      return {
        isPhantom: false,
        confidence: "high",
        reason: "exchange_confirms_fill",
        exchangeOrderId: order.exchangeOrderId,
        exchangeFillFound: true,
      };
    }

    if (["rejected", "canceled", "expired", "failed"].includes(orderStatus.status)) {
      // Orden fallida — es fantasma
      return {
        isPhantom: true,
        confidence: "high",
        reason: `exchange_status_${orderStatus.status}`,
        exchangeOrderId: order.exchangeOrderId,
        exchangeFillFound: false,
      };
    }

    // Estado pendiente u otro — ambiguo
    return {
      isPhantom: false,
      confidence: "low",
      reason: `exchange_status_${orderStatus.status}_unclear`,
      exchangeOrderId: order.exchangeOrderId,
    };

  } catch (error: any) {
    console.error(`${TAG} Error checking phantom status for order ${order.id}: ${error.message}`);
    return {
      isPhantom: false,
      confidence: "low",
      reason: `error_checking: ${error.message}`,
    };
  }
}

/**
 * Busca orden similar en exchange (stub — implementar por exchange)
 */
async function searchSimilarOrderInExchange(
  pair: string,
  side: string,
  quantity: number,
  price: number,
  windowStart: Date,
  windowEnd: Date
): Promise<string | null> {
  // TODO: Implementar búsqueda específica por exchange
  // Revolut X puede no soportar búsqueda por ventana temporal
  return null;
}

/**
 * Anula una compra fantasma y recalcula el ciclo
 */
async function voidPhantomBuy(order: any, cycle: any, reason: string): Promise<void> {
  console.log(`${TAG} Voiding phantom order ${order.id} for cycle ${cycle.id}: ${reason}`);

  await db.transaction(async (trx) => {
    // 1. Marcar orden como voided
    await trx.update(institutionalDcaOrders)
      .set({
        executionStatus: "phantom_voided",
        voidedReason: reason,
        voidedAt: new Date(),
      })
      .where(eq(institutionalDcaOrders.id, order.id));

    // 2. Recalcular ciclo excluyendo esta orden
    await recalculateCycleExcludingOrder(cycle, order, trx);

    // 3. Crear evento
    await repo.createEvent({
      cycleId: cycle.id,
      pair: cycle.pair,
      mode: "live",
      eventType: "auto_reconciliation_phantom_buy_voided",
      severity: "warning",
      message: `Compra fantasma anulada automáticamente: ${reason}. Ciclo recalculado.`,
      payloadJson: {
        orderId: order.id,
        originalQty: order.quantity,
        originalPrice: order.price,
        voidReason: reason,
      },
    });
  });
}

/**
 * Bloquea ciclo para revisión manual
 */
async function blockCycleForManualReview(cycle: any, reason: string): Promise<void> {
  console.log(`${TAG} Blocking cycle ${cycle.id} for manual review: ${reason}`);

  await db.update(institutionalDcaCycles)
    .set({
      status: "needs_reconciliation",
      reconciliationStatus: "manual_review_required",
      reconciliationBlockedReason: reason,
      reconciliationBlockedAt: new Date(),
    })
    .where(eq(institutionalDcaCycles.id, cycle.id));

  // Alertar
  await repo.createEvent({
    cycleId: cycle.id,
    pair: cycle.pair,
    mode: "live",
    eventType: "auto_reconciliation_required_manual_review",
    severity: "critical",
    message: `Ciclo bloqueado para revisión manual: ${reason}. No se ejecutarán compras/ventas automáticas hasta resolver.`,
    payloadJson: {
      reason,
      cycleId: cycle.id,
    },
  });

  // Notificar Telegram
  // TODO: Implementar notifyReconciliationRequired en IdcaTelegramNotifier
  console.log(`${TAG} Would notify Telegram: reconciliation required for ${cycle.pair} #${cycle.id}: ${reason}`);
}

/**
 * Marca orden como verificada
 */
async function markOrderVerified(order: any): Promise<void> {
  await db.update(institutionalDcaOrders)
    .set({
      executionStatus: "verified",
      reconciledAt: new Date(),
    })
    .where(eq(institutionalDcaOrders.id, order.id));
}

/**
 * Marca orden legacy como no verificada (necesita revisión manual)
 */
async function markOrderLegacyUnverified(order: any): Promise<void> {
  await db.update(institutionalDcaOrders)
    .set({
      executionStatus: "legacy_unverified",
      reconciledAt: new Date(),
    })
    .where(eq(institutionalDcaOrders.id, order.id));
}

/**
 * Marca orden como necesita verificación adicional
 */
async function markOrderNeedsVerification(order: any, reason: string): Promise<void> {
  await db.update(institutionalDcaOrders)
    .set({
      executionStatus: "needs_verification",
      reconciledAt: new Date(),
      needsVerificationReason: reason,
    })
    .where(eq(institutionalDcaOrders.id, order.id));
}

/**
 * Verifica si un ciclo tiene múltiples órdenes legacy sin verificar
 */
async function hasMultipleLegacyUnverifiedOrders(cycleId: number): Promise<boolean> {
  const orders = await db
    .select()
    .from(institutionalDcaOrders)
    .where(and(
      eq(institutionalDcaOrders.cycleId, cycleId),
      eq(institutionalDcaOrders.side, "buy"),
      eq(institutionalDcaOrders.executionStatus, "legacy_unverified")
    ));
  return orders.length >= 2;
}

/**
 * Recalcula ciclo excluyendo una orden
 */
async function recalculateCycleExcludingOrder(
  cycle: any,
  excludedOrder: any,
  trx: any
): Promise<void> {
  // Obtener todas las órdenes válidas del ciclo (excluyendo la anulada)
  const validOrders = await trx
    .select()
    .from(institutionalDcaOrders)
    .where(and(
      eq(institutionalDcaOrders.cycleId, cycle.id),
      eq(institutionalDcaOrders.side, "buy"),
      ne(institutionalDcaOrders.executionStatus, "phantom_voided")
    ));

  // Recalcular agregados
  let totalQty = 0;
  let totalCost = 0;
  let buyCount = 0;

  for (const order of validOrders) {
    const qty = parseFloat(order.quantity);
    const cost = parseFloat(order.netValueUsd);
    if (qty > 0 && cost > 0) {
      totalQty += qty;
      totalCost += cost;
      buyCount++;
    }
  }

  const newAvgPrice = totalQty > 0 ? totalCost / totalQty : 0;

  // Actualizar ciclo
  await trx.update(institutionalDcaCycles)
    .set({
      totalQuantity: totalQty.toFixed(8),
      capitalUsedUsd: totalCost.toFixed(2),
      avgEntryPrice: newAvgPrice.toFixed(8),
      buyCount: buyCount,
    })
    .where(eq(institutionalDcaCycles.id, cycle.id));

  console.log(`${TAG} Cycle ${cycle.id} recalculated: qty=${totalQty.toFixed(8)}, cost=${totalCost.toFixed(2)}, avg=${newAvgPrice.toFixed(2)}, buys=${buyCount}`);
}

/**
 * Notifica resultado de reconciliación
 */
async function notifyReconciliationResult(result: ReconciliationResult): Promise<void> {
  try {
    // TODO: Implementar notifyReconciliationComplete en IdcaTelegramNotifier
    console.log(`${TAG} Reconciliation complete notification would be sent: ${JSON.stringify(result)}`);
  } catch (e: any) {
    console.error(`${TAG} Failed to send reconciliation notification: ${e.message}`);
  }
}

/**
 * Verifica si es seguro arrancar el scheduler después de reconciliación
 *
 * NUEVA POLÍTICA:
 * - Solo errores CRÍTICOS bloquean el scheduler global
 * - Ciclos con órdenes legacy/ambiguas solo bloquean el ciclo afectado, no el scheduler global
 */
export function isSafeToStartAfterReconciliation(result: ReconciliationResult): boolean {
  // Solo errores críticos bloquean el scheduler global
  if (result.criticalErrors.length > 0) {
    console.error(`${TAG} [RECONCILIATION_BLOCK] UNSAFE to start scheduler: ${result.criticalErrors.length} critical errors`);
    for (const err of result.criticalErrors) {
      console.error(`${TAG}   - ${err}`);
    }
    return false;
  }

  // Ciclos con revisiones manuales no bloquean el scheduler global
  if (result.cyclesNeedingReview.length > 0) {
    console.log(`${TAG} [RECONCILIATION_OK] Scheduler can start: ${result.cyclesNeedingReview.length} cycles will be skipped (needs review)`);
    for (const cycle of result.cyclesNeedingReview) {
      console.log(`${TAG}   - ${cycle.pair} #${cycle.cycleId}: ${cycle.reason}`);
    }
  }

  // El scheduler puede arrancar si no hay errores críticos
  return true;
}
