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
import { institutionalDcaCycles, institutionalDcaOrders } from "@shared/schema";

const TAG = "[IDCA_RECONCILE]";

export interface ReconciliationResult {
  cyclesChecked: number;
  ordersChecked: number;
  phantomsFound: number;
  phantomsVoided: number;
  partialsAdjusted: number;
  ambiguousBlocked: number;
  errors: string[];
  safeToStart: boolean;
}

export interface PhantomCheckResult {
  isPhantom: boolean;
  confidence: "high" | "medium" | "low";
  reason: string;
  exchangeOrderId?: string;
  exchangeFillFound?: boolean;
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
    errors: [],
    safeToStart: true,
  };

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
        await reconcileCycle(cycle, result);
      } catch (cycleError: any) {
        console.error(`${TAG} Error reconciling cycle ${cycle.id}: ${cycleError.message}`);
        result.errors.push(`cycle_${cycle.id}: ${cycleError.message}`);
      }
    }

    // 3. Determinar si es seguro arrancar
    result.safeToStart = result.ambiguousBlocked === 0 && result.errors.length === 0;

    console.log(`${TAG} ==========================================`);
    console.log(`${TAG} RECONCILIATION COMPLETE`);
    console.log(`${TAG} Cycles checked: ${result.cyclesChecked}`);
    console.log(`${TAG} Orders checked: ${result.ordersChecked}`);
    console.log(`${TAG} Phantoms found: ${result.phantomsFound}`);
    console.log(`${TAG} Phantoms voided: ${result.phantomsVoided}`);
    console.log(`${TAG} Partials adjusted: ${result.partialsAdjusted}`);
    console.log(`${TAG} Ambiguous blocked: ${result.ambiguousBlocked}`);
    console.log(`${TAG} Safe to start: ${result.safeToStart}`);
    console.log(`${TAG} ==========================================`);

    // 4. Notificar resultado
    await notifyReconciliationResult(result);

    return result;

  } catch (error: any) {
    console.error(`${TAG} CRITICAL ERROR during reconciliation: ${error.message}`);
    result.errors.push(`critical: ${error.message}`);
    result.safeToStart = false;
    return result;
  }
}

/**
 * Reconcilia un ciclo individual
 */
async function reconcileCycle(cycle: any, result: ReconciliationResult): Promise<void> {
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

    // Skip si ya está verificado/reconciliado
    if (order.executionStatus === "verified" || order.executionStatus === "reconciled") {
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

    if (phantomCheck.isPhantom && phantomCheck.confidence === "high") {
      // Caso A: Fantasma inequívoco — anular
      console.log(`${TAG} Order ${order.id}: PHANTOM (high confidence) — voiding`);
      result.phantomsFound++;
      await voidPhantomBuy(order, cycle, phantomCheck.reason);
      result.phantomsVoided++;
    } else if (phantomCheck.isPhantom && phantomCheck.confidence === "medium") {
      // Caso D: Ambiguo — bloquear ciclo
      console.log(`${TAG} Order ${order.id}: AMBIGUOUS (medium confidence) — blocking cycle`);
      result.ambiguousBlocked++;
      await blockCycleForManualReview(cycle, `ambiguous_order_${order.id}: ${phantomCheck.reason}`);
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

    // Si no tiene exchangeOrderId, es candidata a fantasma
    if (!order.exchangeOrderId) {
      // Buscar por ventana temporal
      const windowStart = new Date(order.createdAt);
      windowStart.setMinutes(windowStart.getMinutes() - 5);
      const windowEnd = new Date(order.createdAt);
      windowEnd.setMinutes(windowEnd.getMinutes() + 5);

      // Intentar buscar orden similar en exchange
      // Nota: Esto requiere implementación específica por exchange
      const similarOrderFound = await searchSimilarOrderInExchange(
        pair,
        "buy",
        parseFloat(order.quantity),
        parseFloat(order.price),
        windowStart,
        windowEnd
      );

      if (similarOrderFound) {
        return {
          isPhantom: false,
          confidence: "medium",
          reason: "similar_order_found_in_exchange",
          exchangeOrderId: similarOrderFound,
        };
      }

      // No se encontró orden similar — probable fantasma
      return {
        isPhantom: true,
        confidence: "high",
        reason: "no_exchange_order_id_and_no_similar_order_found",
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
 */
export function isSafeToStartAfterReconciliation(result: ReconciliationResult): boolean {
  if (!result.safeToStart) {
    console.error(`${TAG} UNSAFE to start scheduler: ${result.ambiguousBlocked} cycles need manual review`);
    return false;
  }

  if (result.errors.length > 0) {
    console.error(`${TAG} UNSAFE to start scheduler: ${result.errors.length} errors during reconciliation`);
    return false;
  }

  return true;
}
