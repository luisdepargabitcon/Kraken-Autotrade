/**
 * IdcaExitExecutor — Lote 4
 * Executes pending exit instructions: immediate, price_target, scheduled_time.
 * Handles partial (25/50/75%) and total (100%) closes.
 * Supports simulation and live modes.
 * Idempotent: uses clientOrderId and status transitions to prevent double execution.
 */
import * as repo from "./IdcaRepository";
import * as exitRepo from "./IdcaExitInstructionRepository";
import * as telegram from "./IdcaTelegramNotifier";
import { ExchangeFactory } from "../exchanges/ExchangeFactory";
import type {
  InstitutionalDcaCycle,
  InstitutionalDcaConfigRow,
} from "@shared/schema";
import type { IdcaExitInstruction } from "@shared/schema";
import type { IdcaMode } from "./IdcaTypes";

const TAG = "[IDCA_EXIT_EXEC]";
const EXECUTING_TIMEOUT_MINUTES = 5;

// ─── Fee resolution ────────────────────────────────────────────────────────────

function resolveExitFeePct(config: InstitutionalDcaConfigRow): number {
  const execFees = (config as any).executionFeesJson as any;
  if (execFees && typeof execFees.takerFeePct === "number") return execFees.takerFeePct;
  const legacy = parseFloat(String((config as any).simulationFeePct));
  if (Number.isFinite(legacy) && legacy >= 0) return legacy;
  return 0.09; // RevolutX default fallback
}

interface FeeResult {
  feePct: number;
  fees: number;
  slippage: number;
  netValue: number;
}

function resolveExitFees(
  config: InstitutionalDcaConfigRow,
  mode: IdcaMode,
  grossSellValue: number
): FeeResult {
  const feePct = resolveExitFeePct(config);
  const fees = grossSellValue * (feePct / 100);

  if (mode === "simulation") {
    const slippage = grossSellValue * (parseFloat(String((config as any).simulationSlippagePct || "0")) / 100);
    return { feePct, fees, slippage, netValue: grossSellValue - fees - slippage };
  }
  // LIVE: estimated fee for record-keeping; exchange deducts real fee from fill
  return { feePct, fees, slippage: 0, netValue: grossSellValue - fees };
}

// ─── Balance guard ─────────────────────────────────────────────────────────────

async function verifyBalance(
  cycle: InstitutionalDcaCycle,
  quantityToSell: number,
  mode: IdcaMode
): Promise<void> {
  if (mode !== "live") return; // simulation: no exchange check needed

  const exchange = ExchangeFactory.getTradingExchange();
  const balance = await exchange.getBalance();
  const asset = cycle.pair.split("/")[0];
  const available = parseFloat(
    String((balance[asset] as any)?.available ?? balance[asset] ?? "0")
  );

  if (available <= 0) {
    throw new Error(
      `balance_zero: balance de ${asset} es 0 en exchange.`
    );
  }

  // 2% tolerance for rounding/fees at the exchange level
  if (available < quantityToSell * 0.98) {
    throw new Error(
      `insufficient_exchange_balance: ciclo requiere ${quantityToSell.toFixed(8)} ${asset}, ` +
      `disponible ${available.toFixed(8)}. Diferencia supera tolerancia del 2%.`
    );
  }
}

// ─── Core P&L accounting ───────────────────────────────────────────────────────

interface SellAccounting {
  quantitySold: number;
  sellRatio: number;
  costBasisSold: number;
  remainingCost: number;
  grossSellValue: number;
  fees: number;
  slippage: number;
  netSellValue: number;
  realizedPnlIncrement: number; // can be negative
}

function computeSellAccounting(
  cycle: InstitutionalDcaCycle,
  closePct: number,
  executionPrice: number,
  config: InstitutionalDcaConfigRow,
  mode: IdcaMode
): SellAccounting {
  const oldQty = parseFloat(String(cycle.totalQuantity || "0"));
  const oldCapitalUsed = parseFloat(String(cycle.capitalUsedUsd || "0"));

  const quantitySold = oldQty * (closePct / 100);
  const sellRatio = quantitySold / oldQty;
  const costBasisSold = oldCapitalUsed * sellRatio;
  const remainingCost = oldCapitalUsed - costBasisSold;

  const grossSellValue = quantitySold * executionPrice;
  const { fees, slippage, netValue: netSellValue } = resolveExitFees(config, mode, grossSellValue);
  const realizedPnlIncrement = netSellValue - costBasisSold; // negative if sold at a loss

  return {
    quantitySold,
    sellRatio,
    costBasisSold,
    remainingCost,
    grossSellValue,
    fees,
    slippage,
    netSellValue,
    realizedPnlIncrement,
  };
}

// ─── Simulation sell ───────────────────────────────────────────────────────────

async function executeSimulationSell(
  cycle: InstitutionalDcaCycle,
  acc: SellAccounting,
  closePct: number,
  instructionId: number
): Promise<string | null> {
  // Simulation wallet update
  const wallet = await repo.getSimulationWallet();
  await repo.updateSimulationWallet({
    availableBalanceUsd: (parseFloat(String(wallet.availableBalanceUsd)) + acc.netSellValue).toFixed(2),
    usedBalanceUsd: Math.max(0, parseFloat(String(wallet.usedBalanceUsd)) - acc.grossSellValue).toFixed(2),
    ...(closePct === 100
      ? { realizedPnlUsd: (parseFloat(String(wallet.realizedPnlUsd)) + acc.realizedPnlIncrement).toFixed(2) }
      : {}),
  });

  return `SIM_EXIT_${instructionId}_${Date.now()}`;
}

// ─── Live sell ────────────────────────────────────────────────────────────────

async function executeLiveSell(
  cycle: InstitutionalDcaCycle,
  acc: SellAccounting,
  clientOrderId: string
): Promise<string | null> {
  const exchange = ExchangeFactory.getTradingExchange();
  const sellOrder = await exchange.placeOrder({
    pair: cycle.pair,
    type: "sell",
    ordertype: "market",
    volume: acc.quantitySold.toFixed(8),
    // userref / clientOrderId passed if exchange supports it (Kraken: userref)
    ...(clientOrderId ? { userref: clientOrderId } : {}),
  });

  if (!sellOrder) throw new Error("placeOrder devolvió null/undefined");

  const hasOrderId = !!(sellOrder.orderId || sellOrder.txid);
  if (!hasOrderId) {
    throw new Error(
      `live_no_order_id: order creada (success=${sellOrder.success}) pero sin orderId/txid confirmado.`
    );
  }

  return sellOrder.orderId || sellOrder.txid || null;
}

// ─── Cycle accounting update ──────────────────────────────────────────────────

async function updateCycleAfterSell(
  cycle: InstitutionalDcaCycle,
  acc: SellAccounting,
  closePct: number,
  executionPrice: number,
  closeReason: string
): Promise<void> {
  const oldRealizedPnl = parseFloat(String(cycle.realizedPnlUsd || "0"));
  const oldRealizedCostBasis = parseFloat(String((cycle as any).realizedCostBasisUsd || "0"));
  const oldPartialSellCount = (cycle as any).partialSellCount ?? 0;

  if (closePct < 100) {
    // Partial sell — cycle stays active
    await repo.updateCycle(cycle.id, {
      totalQuantity: (parseFloat(String(cycle.totalQuantity || "0")) - acc.quantitySold).toFixed(8),
      capitalUsedUsd: acc.remainingCost.toFixed(2),
      // totalCostBasisUsd: unchanged (historical cost never decreases)
      realizedCostBasisUsd: (oldRealizedCostBasis + acc.costBasisSold).toFixed(2),
      realizedPnlUsd: (oldRealizedPnl + acc.realizedPnlIncrement).toFixed(2),
      partialSellCount: oldPartialSellCount + 1,
      lastPartialSellAt: new Date(),
      currentPrice: executionPrice.toFixed(8),
    } as any);
  } else {
    // Full close — cycle closed
    await repo.updateCycle(cycle.id, {
      status: "closed",
      closeReason,
      totalQuantity: "0",
      capitalUsedUsd: "0",
      // totalCostBasisUsd: preserved as historical
      realizedCostBasisUsd: (oldRealizedCostBasis + acc.costBasisSold).toFixed(2),
      realizedPnlUsd: (oldRealizedPnl + acc.realizedPnlIncrement).toFixed(2),
      unrealizedPnlUsd: "0",
      unrealizedPnlPct: "0",
      currentPrice: executionPrice.toFixed(8),
      closedAt: new Date(),
    } as any);
  }
}

// ─── Main executor ────────────────────────────────────────────────────────────

async function createExitOrder(
  cycle: InstitutionalDcaCycle,
  acc: SellAccounting,
  executionPrice: number,
  exchangeOrderId: string | null,
  orderType: string
): Promise<void> {
  await repo.createOrder({
    cycleId: cycle.id,
    pair: cycle.pair,
    mode: cycle.mode,
    orderType,
    side: "sell",
    price: executionPrice.toFixed(8),
    quantity: acc.quantitySold.toFixed(8),
    grossValueUsd: acc.grossSellValue.toFixed(2),
    feesUsd: acc.fees.toFixed(4),
    slippageUsd: acc.slippage.toFixed(4),
    netValueUsd: acc.netSellValue.toFixed(2),
    exchangeOrderId: exchangeOrderId ?? undefined,
    triggerReason: orderType,
    humanReason: orderType === "partial_sell" ? "Venta parcial (instrucción programada)" : "Cierre por instrucción programada",
  });
}

/**
 * Execute a single exit instruction.
 * Transactional flow:
 *   1. Re-read instruction — verify still pending
 *   2. Generate clientOrderId, mark executing
 *   3. Re-read cycle — verify still active and has qty
 *   4. Balance guard (live only)
 *   5. Execute sell (simulation or live)
 *   6. Update cycle accounting
 *   7. Mark instruction executed
 *   8. Create order record, event, Telegram
 */
export async function executeExitInstruction(
  instructionId: number,
  currentPrice: number
): Promise<void> {
  // 1. Re-read instruction (idempotency: verify still pending)
  const instr = await exitRepo.getExitInstructionById(instructionId);
  if (!instr) {
    console.warn(`${TAG} #${instructionId}: not found, skipping`);
    return;
  }
  if (instr.status !== "pending") {
    console.log(`${TAG} #${instructionId}: status=${instr.status}, skipping (already processed)`);
    return;
  }

  const mode = instr.mode as IdcaMode;
  const cycleId = instr.cycleId;
  const closePct = parseFloat(String(instr.closePct));

  // 2. Generate clientOrderId + mark executing
  const clientOrderId = `IDCA_EXIT_${cycleId}_${instructionId}_${Date.now()}`;
  const marked = await exitRepo.markExecuting(instructionId, clientOrderId);
  if (!marked) {
    console.log(`${TAG} #${instructionId}: could not transition to executing (race condition), skipping`);
    return;
  }

  let cycle: InstitutionalDcaCycle | null = null;

  try {
    // 3. Re-read cycle
    cycle = (await repo.getCycleById(cycleId)) ?? null;
    if (!cycle) throw new Error(`Ciclo #${cycleId} no encontrado`);
    if (cycle.status === "closed") throw new Error(`Ciclo #${cycleId} ya está cerrado`);

    const totalQty = parseFloat(String(cycle.totalQuantity || "0"));
    if (totalQty <= 0) throw new Error(`Ciclo #${cycleId} sin cantidad disponible (totalQuantity=0)`);

    // 4. Balance guard
    await verifyBalance(cycle, totalQty * (closePct / 100), mode);

    // 5. Compute accounting
    const config = await repo.getIdcaConfig();
    const acc = computeSellAccounting(cycle, closePct, currentPrice, config, mode);

    // 6. Execute sell
    let exchangeOrderId: string | null = null;
    if (mode === "simulation") {
      exchangeOrderId = await executeSimulationSell(cycle, acc, closePct, instructionId);
    } else {
      exchangeOrderId = await executeLiveSell(cycle, acc, clientOrderId);
    }

    // 7. Update cycle
    const closeReason = instr.type === "price_target"
      ? "price_target_exit"
      : instr.type === "scheduled_time"
      ? "scheduled_exit"
      : "manual_exit";

    await updateCycleAfterSell(cycle, acc, closePct, currentPrice, closeReason);

    // 8. Create order record
    const orderType = closePct < 100 ? "partial_sell" : "final_sell";
    await createExitOrder(cycle, acc, currentPrice, exchangeOrderId, orderType);

    // 9. Mark instruction executed
    const remainingQty = closePct < 100
      ? parseFloat(String(cycle.totalQuantity || "0")) - acc.quantitySold
      : 0;
    await exitRepo.markExecuted(instructionId, {
      executionExchangeOrderId: exchangeOrderId,
      executionPrice: currentPrice,
      executionQuantity: acc.quantitySold,
      costBasisSoldUsd: acc.costBasisSold,
      realizedPnlIncrementUsd: acc.realizedPnlIncrement,
      remainingCapitalUsedUsd: acc.remainingCost,
      remainingCycleQuantityAfter: remainingQty,
      grossValueUsd: acc.grossSellValue,
      feesUsd: acc.fees,
      netValueUsd: acc.netSellValue,
    });

    // 10. Event
    const pnlSign = acc.realizedPnlIncrement >= 0 ? "+" : "";
    await repo.createEvent({
      cycleId,
      pair: cycle.pair,
      mode,
      eventType: closePct < 100 ? "partial_sell_executed" : "cycle_closed",
      severity: "info",
      message:
        closePct < 100
          ? `Venta parcial ${closePct}% ejecutada: ${acc.quantitySold.toFixed(6)} @ $${currentPrice.toFixed(2)}, PnL parcial=${pnlSign}$${acc.realizedPnlIncrement.toFixed(2)}`
          : `Ciclo cerrado (${closeReason}): ${acc.quantitySold.toFixed(6)} @ $${currentPrice.toFixed(2)}, PnL=${pnlSign}$${acc.realizedPnlIncrement.toFixed(2)}`,
      payloadJson: {
        instructionId,
        closePct,
        executionPrice: currentPrice,
        quantitySold: acc.quantitySold,
        costBasisSold: acc.costBasisSold,
        realizedPnlIncrement: acc.realizedPnlIncrement,
        remainingCost: acc.remainingCost,
        grossValueUsd: acc.grossSellValue,
        feesUsd: acc.fees,
        netValueUsd: acc.netSellValue,
        exchangeOrderId,
        clientOrderId,
        mode,
        type: instr.type,
      },
    });

    // 11. Telegram
    await sendExitTelegram(cycle, acc, closePct, currentPrice, closeReason, mode, instructionId);

    console.log(
      `${TAG} #${instructionId} EXECUTED: cycleId=${cycleId} pair=${cycle.pair} ` +
      `closePct=${closePct}% qty=${acc.quantitySold.toFixed(8)} price=$${currentPrice.toFixed(2)} ` +
      `pnlIncrement=${pnlSign}$${acc.realizedPnlIncrement.toFixed(2)} orderId=${exchangeOrderId ?? "sim"}`
    );
  } catch (err: any) {
    const reason = err.message || "unknown error";
    console.error(`${TAG} #${instructionId} FAILED: ${reason}`);

    // Determine if failure is a balance issue (clean fail) or execution uncertainty
    const isBalanceFail = reason.includes("insufficient_exchange_balance") || reason.includes("balance_zero");
    const isLiveUncertain = !isBalanceFail && mode === "live";

    if (isLiveUncertain) {
      // Could be a partial execution — mark for manual review
      await exitRepo.markFailedRequiresReview(
        instructionId,
        `Error durante ejecución LIVE: ${reason}. Verificar manualmente en exchange. ClientOrderId: ${clientOrderId}`
      );
      if (cycle) {
        await sendReviewRequiredTelegram(cycle, instructionId, reason, clientOrderId);
      }
    } else {
      await exitRepo.markFailed(instructionId, reason);
      if (cycle) {
        await sendFailedTelegram(cycle, instructionId, reason, closePct);
      }
    }

    // Create failure event
    if (cycle) {
      await repo.createEvent({
        cycleId,
        pair: cycle.pair,
        mode,
        eventType: "exit_instruction_failed",
        severity: isLiveUncertain ? "critical" : "error",
        message: `Instrucción de salida #${instructionId} fallida: ${reason}`,
        payloadJson: { instructionId, reason, clientOrderId, closePct: parseFloat(String(instr.closePct)) },
      });
    }
  }
}

// ─── Stale executing recovery ─────────────────────────────────────────────────

export async function checkStaleExecutingInstructions(): Promise<void> {
  const threshold = new Date(Date.now() - EXECUTING_TIMEOUT_MINUTES * 60_000);
  const stale = await exitRepo.getStaleExecutingInstructions(threshold);

  for (const instr of stale) {
    console.warn(
      `${TAG} Stale executing #${instr.id}: cycleId=${instr.cycleId} ` +
      `started=${instr.executingStartedAt?.toISOString()} clientOrderId=${instr.executionClientOrderId ?? "n/a"}`
    );

    await exitRepo.markFailedRequiresReview(
      instr.id,
      `Atascada en executing durante >${EXECUTING_TIMEOUT_MINUTES} min. ` +
      `ClientOrderId: ${instr.executionClientOrderId ?? "n/a"}. Revisar en exchange manualmente.`
    );

    const cycle = (await repo.getCycleById(instr.cycleId)) ?? null;
    await repo.createEvent({
      cycleId: instr.cycleId,
      pair: instr.pair,
      mode: instr.mode,
      eventType: "exit_instruction_requires_review",
      severity: "critical",
      message: `Instrucción #${instr.id} atascada en executing. Revisión manual requerida.`,
      payloadJson: {
        instructionId: instr.id,
        clientOrderId: instr.executionClientOrderId,
        executingStartedAt: instr.executingStartedAt,
      },
    });

    if (cycle) {
      await sendReviewRequiredTelegram(
        cycle,
        instr.id,
        `Timeout tras ${EXECUTING_TIMEOUT_MINUTES} min en executing`,
        instr.executionClientOrderId ?? "n/a"
      );
    }
  }
}

// ─── Scheduler tick: process triggered instructions ───────────────────────────

export async function processTriggeredExitInstructions(
  mode: IdcaMode,
  currentPrices: Record<string, number>
): Promise<void> {
  const now = new Date();

  // Check stale executing first
  await checkStaleExecutingInstructions();

  // Immediate instructions
  const immediates = await exitRepo.getPendingImmediateInstructions(mode);
  for (const instr of immediates) {
    const price = currentPrices[instr.pair] ?? 0;
    if (price > 0) {
      await executeExitInstruction(instr.id, price);
    }
  }

  // Price target instructions
  const priceTargets = await exitRepo.getPendingPriceTargetInstructions(mode, currentPrices);
  for (const instr of priceTargets) {
    const price = currentPrices[instr.pair] ?? 0;
    if (price > 0) {
      await executeExitInstruction(instr.id, price);
    }
  }

  // Scheduled time instructions
  const timed = await exitRepo.getPendingTimeInstructions(mode, now);
  for (const instr of timed) {
    const price = currentPrices[instr.pair] ?? 0;
    if (price > 0) {
      await executeExitInstruction(instr.id, price);
    }
  }
}

// ─── Telegram helpers ─────────────────────────────────────────────────────────

async function sendExitTelegram(
  cycle: InstitutionalDcaCycle,
  acc: SellAccounting,
  closePct: number,
  executionPrice: number,
  closeReason: string,
  mode: IdcaMode,
  instructionId: number
): Promise<void> {
  const pnlSign = acc.realizedPnlIncrement >= 0 ? "+" : "";
  const emoji = acc.realizedPnlIncrement >= 0 ? "✅" : "⚠️";

  try {
    if (closePct < 100) {
      await telegram.sendRawMessage(
        `${emoji} <b>[IDCA] Venta parcial ejecutada</b>\n\n` +
        `Par: <b>${cycle.pair}</b> · Ciclo #${cycle.id} · ${mode.toUpperCase()}\n` +
        `Porcentaje vendido: <b>${closePct}%</b>\n` +
        `Cantidad: <code>${acc.quantitySold.toFixed(6)}</code>\n` +
        `Precio: <code>$${executionPrice.toFixed(2)}</code>\n` +
        `Valor bruto: <code>$${acc.grossSellValue.toFixed(2)}</code>\n` +
        `Fees: <code>$${acc.fees.toFixed(4)}</code>\n` +
        `Valor neto: <code>$${acc.netSellValue.toFixed(2)}</code>\n` +
        `PnL parcial: <b>${pnlSign}$${acc.realizedPnlIncrement.toFixed(2)}</b>\n` +
        `Capital restante: <code>$${acc.remainingCost.toFixed(2)}</code>\n` +
        `Instrucción #${instructionId}`
      );
    } else {
      const totalCostBasis = parseFloat(String((cycle as any).totalCostBasisUsd || cycle.capitalUsedUsd || "0"));
      const oldRealizedPnl = parseFloat(String(cycle.realizedPnlUsd || "0"));
      const totalPnl = oldRealizedPnl + acc.realizedPnlIncrement;
      const totalPnlPct = totalCostBasis > 0 ? (totalPnl / totalCostBasis) * 100 : 0;
      const totalSign = totalPnl >= 0 ? "+" : "";
      const closeEmoji = totalPnl >= 0 ? "🟢" : "🔴";
      await telegram.sendRawMessage(
        `${closeEmoji} <b>[IDCA] Ciclo cerrado (${closeReason})</b>\n\n` +
        `Par: <b>${cycle.pair}</b> · Ciclo #${cycle.id} · ${mode.toUpperCase()}\n` +
        `Precio venta: <code>$${executionPrice.toFixed(2)}</code>\n` +
        `Cantidad: <code>${acc.quantitySold.toFixed(6)}</code>\n` +
        `Valor bruto: <code>$${acc.grossSellValue.toFixed(2)}</code>\n` +
        `Fees: <code>$${acc.fees.toFixed(4)}</code>\n` +
        `PnL total realizado: <b>${totalSign}$${totalPnl.toFixed(2)} (${totalSign}${totalPnlPct.toFixed(2)}%)</b>\n` +
        `Instrucción #${instructionId}`
      );
    }
  } catch { /* ignore telegram errors */ }
}

async function sendFailedTelegram(
  cycle: InstitutionalDcaCycle,
  instructionId: number,
  reason: string,
  closePct: number
): Promise<void> {
  try {
    await telegram.sendRawMessage(
      `⛔ <b>[IDCA] Salida fallida</b>\n\n` +
      `Par: <b>${cycle.pair}</b> · Ciclo #${cycle.id}\n` +
      `Instrucción #${instructionId} · ${closePct}%\n` +
      `Motivo: <code>${reason}</code>\n\n` +
      `Ciclo sigue activo. No se vendió nada.`
    );
  } catch { /* ignore */ }
}

async function sendReviewRequiredTelegram(
  cycle: InstitutionalDcaCycle,
  instructionId: number,
  reason: string,
  clientOrderId: string
): Promise<void> {
  try {
    await telegram.sendRawMessage(
      `🚨 <b>[IDCA] Instrucción requiere revisión manual</b>\n\n` +
      `Par: <b>${cycle.pair}</b> · Ciclo #${cycle.id}\n` +
      `Instrucción #${instructionId}\n` +
      `ClientOrderId: <code>${clientOrderId}</code>\n` +
      `Motivo: <code>${reason}</code>\n\n` +
      `⚠️ Estado incierto — verificar si la venta se ejecutó en el exchange.\n` +
      `Cancelar la instrucción desde el panel si el estado está resuelto.`
    );
  } catch { /* ignore */ }
}

export async function sendInstructionCreatedTelegram(
  cycle: InstitutionalDcaCycle,
  instructionId: number,
  type: string,
  closePct: number,
  triggerInfo: string
): Promise<void> {
  try {
    const pctLabel = closePct === 100 ? "cierre total" : `venta parcial ${closePct}%`;
    await telegram.sendRawMessage(
      `📋 <b>[IDCA] Salida programada</b>\n\n` +
      `Par: <b>${cycle.pair}</b> · Ciclo #${cycle.id}\n` +
      `Tipo: <code>${type}</code> · ${pctLabel}\n` +
      `Disparo: <code>${triggerInfo}</code>\n` +
      `Instrucción #${instructionId}`
    );
  } catch { /* ignore */ }
}

export async function sendInstructionCancelledTelegram(
  cycle: InstitutionalDcaCycle,
  instructionId: number,
  reason: string
): Promise<void> {
  try {
    await telegram.sendRawMessage(
      `🚫 <b>[IDCA] Salida cancelada</b>\n\n` +
      `Par: <b>${cycle.pair}</b> · Ciclo #${cycle.id}\n` +
      `Instrucción #${instructionId}\n` +
      `Motivo: <code>${reason}</code>`
    );
  } catch { /* ignore */ }
}
