/**
 * IdcaManualBuyService — Registers a manual buy into an open IDCA cycle.
 *
 * This does NOT execute any real order on the exchange.
 * It records a buy that the user already made externally and recalculates
 * the cycle's avg entry price, capital used, quantity, TP, next buy, etc.
 */
import * as repo from "./IdcaRepository";
import * as telegram from "./IdcaTelegramNotifier";

export interface ManualBuyInput {
  cycleId: number;
  pair: string;
  price: number;
  quantity: number;
  notionalUsd: number;
  feesUsd: number;
  executedAt: string;
  exchange: string;
  externalOrderId?: string | null;
  note?: string | null;
  continueAutomaticManagement: boolean;
}

export interface ManualBuyResult {
  success: boolean;
  cycleId: number;
  pair: string;
  previousAvg: number;
  newAvg: number;
  previousQty: number;
  newQty: number;
  previousCapitalUsed: number;
  newCapitalUsed: number;
  previousTp: number | null;
  newTp: number | null;
  previousNextBuy: number | null;
  newNextBuy: number | null;
  orderId: number;
  eventId: number;
  cycle: any;
}

export async function addManualBuyToCycle(input: ManualBuyInput): Promise<ManualBuyResult> {
  const {
    cycleId, pair, price, quantity, notionalUsd, feesUsd,
    executedAt, exchange, externalOrderId, note, continueAutomaticManagement,
  } = input;

  // ── Validations ──
  const cycle = await repo.getCycleById(cycleId);
  if (!cycle) throw new Error("Ciclo no encontrado");
  if (cycle.status === "closed") throw new Error("No se puede añadir compra a un ciclo cerrado");
  if (cycle.pair !== pair) throw new Error(`El par del ciclo (${cycle.pair}) no coincide con el par indicado (${pair})`);
  if (price <= 0) throw new Error("El precio debe ser mayor que 0");
  if (quantity <= 0) throw new Error("La cantidad debe ser mayor que 0");
  if (notionalUsd <= 0) throw new Error("El valor USD debe ser mayor que 0");
  if (feesUsd < 0) throw new Error("Las comisiones no pueden ser negativas");

  // Check for duplicate externalOrderId if provided
  if (externalOrderId) {
    const existingOrders = await repo.getOrdersByCycle(cycleId);
    const dup = existingOrders.find((o: any) => o.exchangeOrderId === externalOrderId);
    if (dup) throw new Error(`Ya existe una orden con externalOrderId=${externalOrderId} en este ciclo`);
  }

  // ── Current cycle state ──
  const prevQty = parseFloat(String(cycle.totalQuantity || "0"));
  const prevCost = parseFloat(String(cycle.capitalUsedUsd || "0"));
  const prevAvg = parseFloat(String(cycle.avgEntryPrice || "0"));
  const prevTp = cycle.tpTargetPrice ? parseFloat(String(cycle.tpTargetPrice)) : null;
  const prevNextBuy = cycle.nextBuyPrice ? parseFloat(String(cycle.nextBuyPrice)) : null;
  const prevBuyCount = cycle.buyCount || 0;
  const prevTotalCostBasis = parseFloat(String((cycle as any).totalCostBasisUsd || cycle.capitalUsedUsd || "0"));

  // ── Recalculate ──
  const manualGrossCost = notionalUsd;
  const manualNetCost = manualGrossCost + feesUsd;

  const newQty = prevQty + quantity;
  const newCost = prevCost + manualNetCost;
  const newAvg = newQty > 0 ? newCost / newQty : prevAvg;
  const newBuyCount = prevBuyCount + 1;

  // TP recalculation using the same tp pct
  const tpPct = parseFloat(String(cycle.tpTargetPct || "0"));
  const newTp = tpPct > 0 ? newAvg * (1 + tpPct / 100) : prevTp;

  // Next buy recalculation using the same nextBuyLevelPct
  const nextLevelPct = cycle.nextBuyLevelPct ? parseFloat(String(cycle.nextBuyLevelPct)) : null;
  let newNextBuy: number | null = null;
  if (nextLevelPct && nextLevelPct > 0) {
    newNextBuy = newAvg * (1 - nextLevelPct / 100);
  } else if (prevNextBuy && prevNextBuy > 0) {
    // Keep existing next buy if no level pct available
    newNextBuy = prevNextBuy;
  }

  // ── Update cycle ──
  await repo.updateCycle(cycleId, {
    capitalUsedUsd: newCost.toFixed(2),
    totalCostBasisUsd: (prevTotalCostBasis + manualNetCost).toFixed(2),
    totalQuantity: newQty.toFixed(8),
    avgEntryPrice: newAvg.toFixed(8),
    buyCount: newBuyCount,
    lastBuyAt: new Date(executedAt),
    tpTargetPrice: newTp ? newTp.toFixed(8) : null,
    nextBuyPrice: newNextBuy ? newNextBuy.toFixed(8) : null,
    lastManualEditAt: new Date(),
    lastManualEditReason: "manual_buy_added",
    editHistoryJson: [
      ...((cycle as any).editHistoryJson || []),
      {
        action: "manual_buy_added",
        timestamp: new Date().toISOString(),
        price,
        quantity,
        notionalUsd,
        feesUsd,
        exchange,
        previousAvg: prevAvg,
        newAvg,
        previousQty: prevQty,
        newQty,
        previousCapitalUsed: prevCost,
        newCapitalUsed: newCost,
        continueAutomaticManagement,
      },
    ],
  } as any);

  // ── Create order record ──
  const order = await repo.createOrder({
    cycleId,
    pair,
    mode: cycle.mode,
    orderType: "manual_buy",
    buyIndex: newBuyCount,
    side: "buy",
    price: price.toFixed(8),
    quantity: quantity.toFixed(8),
    grossValueUsd: manualGrossCost.toFixed(2),
    feesUsd: feesUsd.toFixed(2),
    slippageUsd: "0",
    netValueUsd: manualNetCost.toFixed(2),
    triggerReason: "Compra manual añadida por el usuario",
    humanReason: "Compra manual registrada — no ejecutada por el bot",
    executionStatus: "filled",
    executedQuantity: quantity.toFixed(8),
    executedUsd: manualNetCost.toFixed(2),
    avgFillPrice: price.toFixed(8),
    exchangeOrderId: externalOrderId || undefined,
    rawExchangeResponseJson: {
      manualEntry: true,
      continueAutomaticManagement,
      userRegistered: true,
      note: note || null,
      externalOrderId: externalOrderId || null,
      exchange,
      executedAt,
      previousAvg: prevAvg,
      newAvg,
      previousQty: prevQty,
      newQty,
      previousCapitalUsed: prevCost,
      newCapitalUsed: newCost,
    } as any,
  } as any);

  // ── Create audit event ──
  const naturalMessage = continueAutomaticManagement
    ? `Compra manual registrada en el ciclo #${cycleId}. El precio medio se actualizó de $${prevAvg.toFixed(2)} a $${newAvg.toFixed(2)}. El ciclo continuará gestionándose automáticamente.`
    : `Compra manual registrada en el ciclo #${cycleId}. El precio medio se actualizó de $${prevAvg.toFixed(2)} a $${newAvg.toFixed(2)}. El ciclo queda protegido y no abrirá nuevas compras automáticas.`;

  const event = await repo.createEvent({
    cycleId,
    pair,
    mode: cycle.mode,
    eventType: "manual_buy_added_to_cycle",
    severity: "info",
    message: naturalMessage,
    payloadJson: {
      price,
      quantity,
      notionalUsd,
      feesUsd,
      exchange,
      previousAvg: prevAvg,
      newAvg,
      previousQty: prevQty,
      newQty,
      previousCapitalUsed: prevCost,
      newCapitalUsed: newCost,
      previousTp: prevTp,
      newTp,
      previousNextBuy: prevNextBuy,
      newNextBuy,
      note: note || null,
      continueAutomaticManagement,
      orderId: order.id,
    } as any,
  });

  // ── Telegram notification ──
  try {
    await telegram.sendRawMessage(
      `📝 *Compra manual registrada*\n` +
      `Ciclo: #${cycleId} (${pair})\n` +
      `Precio: $${price.toFixed(2)}\n` +
      `Cantidad: ${quantity.toFixed(8)}\n` +
      `Valor: $${notionalUsd.toFixed(2)}\n` +
      `Fees: $${feesUsd.toFixed(2)}\n` +
      `Nuevo precio medio: $${newAvg.toFixed(2)}\n` +
      `Gestión: ${continueAutomaticManagement ? "Automática" : "Protegida"}`
    );
  } catch { /* ignore telegram errors */ }

  // ── If user chose to protect cycle ──
  if (!continueAutomaticManagement) {
    await repo.updateCycle(cycleId, {
      isManualCycle: true,
      managedBy: "manual",
    } as any);
  }

  const updatedCycle = await repo.getCycleById(cycleId);

  return {
    success: true,
    cycleId,
    pair,
    previousAvg: prevAvg,
    newAvg,
    previousQty: prevQty,
    newQty,
    previousCapitalUsed: prevCost,
    newCapitalUsed: newCost,
    previousTp: prevTp,
    newTp,
    previousNextBuy: prevNextBuy,
    newNextBuy,
    orderId: order.id,
    eventId: event.id,
    cycle: updatedCycle,
  };
}
