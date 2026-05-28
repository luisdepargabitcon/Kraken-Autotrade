/**
 * IdcaLiveExecutionGuard — HOTFIX CRÍTICO: Protección contra compras fantasma
 * 
 * Responsabilidad: Validar saldo, ajustar tamaño, y asegurar fill confirmado
 * antes de modificar el ciclo IDCA en modo LIVE.
 * 
 * REGLA DE ORO: En LIVE, ninguna compra modifica el ciclo sin fill confirmado.
 */
import { ExchangeFactory } from "../exchanges/ExchangeFactory";
import { db } from "../../db";
const TAG = "[IDCA_LIVE_GUARD]";

/** Configuración de reserva de seguridad */
const RESERVE_MIN_USD = 5;
const RESERVE_PCT = 0.005; // 0.5%

/** Escalones de reducción por saldo insuficiente */
const DOWNSIZE_STEPS = [1.0, 0.8, 0.6, 0.5, 0.4, 0.3, 0.25, 0.2, 0.15, 0.1];

/** Umbral mínimo de compra (ej: $10 USD mínimo para evitar micro-compras) */
const MIN_BUY_USD = 10;

export interface BuyIntention {
  pair: string;
  cycleId: number;
  buyType: "initial" | "safety" | "plus" | "recovery";
  intendedUsd: number;
  intendedQty: number;
  currentPrice: number;
  feePct: number;
  slippagePct: number;
  mode: string;
  buyLevel?: number;
}

export interface BalanceCheckResult {
  canProceed: boolean;
  reason?: string;
  availableUsd: number;
  spendableUsd: number;
  reserveUsd: number;
  requiredUsd: number;
  adjustedUsd?: number;
  adjustedQty?: number;
  wasReduced: boolean;
  reductionPct?: number;
}

export interface FillConfirmation {
  confirmed: boolean;
  exchangeOrderId?: string;
  status: "filled" | "partially_filled" | "rejected" | "canceled" | "expired" | "failed" | "pending" | "unknown" | "execution_unknown_pending_reconciliation";
  filledQty: number;
  filledUsd: number;
  avgFillPrice: number;
  feeUsd: number;
  fillTime?: Date;
  rawResponse?: any;
  // Fee tracking for base-asset fees (e.g., Revolut X charges fee in BTC)
  grossBaseQty?: number;
  netBaseQty?: number;
  feeAsset?: string;
  feeAmount?: number;
  feeSource?: "exchange_api" | "inferred_from_default_pct" | "manual" | "legacy" | null;
}

export interface ExecutionGuardResult {
  allowed: boolean;
  blocked?: boolean;
  reduced?: boolean;
  finalUsd?: number;
  finalQty?: number;
  exchangeOrderId?: string;
  reason?: string;
  balanceCheck?: BalanceCheckResult;
}

/**
 * Consulta saldo real disponible en Revolut X (trading exchange)
 */
async function getAvailableBalanceUsd(): Promise<number> {
  try {
    const exchange = ExchangeFactory.getTradingExchange();
    if (!exchange.isInitialized()) {
      console.warn(`${TAG} Trading exchange not initialized`);
      return 0;
    }

    const balance: any = await exchange.getBalance();
    if (!balance || typeof balance !== "object") {
      console.warn(`${TAG} Invalid balance response from exchange`);
      return 0;
    }

    // Para BTC/USD y ETH/USD, necesitamos saldo USD disponible
    const usdBalance: any = balance["USD"] || balance["ZUSD"] || balance["USD.HOLD"] || 0;
    const available = typeof usdBalance === "object" ? (usdBalance.available || usdBalance.free || 0) : usdBalance;
    
    return parseFloat(String(available)) || 0;
  } catch (error: any) {
    console.error(`${TAG} Error fetching balance: ${error.message}`);
    return 0;
  }
}

/**
 * Consulta saldo real disponible del asset base (para ventas)
 */
async function getAvailableBaseQty(pair: string): Promise<number> {
  try {
    const exchange = ExchangeFactory.getTradingExchange();
    if (!exchange.isInitialized()) {
      console.warn(`${TAG} Trading exchange not initialized`);
      return 0;
    }

    const balance: any = await exchange.getBalance();
    if (!balance || typeof balance !== "object") {
      console.warn(`${TAG} Invalid balance response from exchange`);
      return 0;
    }

    const asset = pair.split("/")[0];
    const assetBalance: any = balance[asset] || balance[`Z${asset}`] || 0;
    const available = typeof assetBalance === "object" ? (assetBalance.available || assetBalance.free || 0) : assetBalance;
    
    return parseFloat(String(available)) || 0;
  } catch (error: any) {
    console.error(`${TAG} Error fetching base balance: ${error.message}`);
    return 0;
  }
}

/**
 * Calcula coste total requerido incluyendo fees y slippage estimado
 */
function calculateRequiredUsd(intendedUsd: number, feePct: number, slippagePct: number): number {
  const feeUsd = intendedUsd * (feePct / 100);
  const slippageUsd = intendedUsd * (slippagePct / 100);
  return intendedUsd + feeUsd + slippageUsd;
}

/**
 * Verifica si hay saldo suficiente y propone ajuste si es posible
 */
async function checkBalanceWithDownsizing(
  intention: BuyIntention
): Promise<BalanceCheckResult> {
  const { intendedUsd, feePct, slippagePct } = intention;

  // Obtener saldo real
  const availableUsd = await getAvailableBalanceUsd();
  
  // Calcular reserva de seguridad
  const reserveUsd = Math.max(RESERVE_MIN_USD, availableUsd * RESERVE_PCT);
  const spendableUsd = Math.max(0, availableUsd - reserveUsd);

  // Calcular requerido para compra completa
  const requiredUsd = calculateRequiredUsd(intendedUsd, feePct, slippagePct);

  // Caso 1: Saldo suficiente
  if (spendableUsd >= requiredUsd) {
    return {
      canProceed: true,
      availableUsd,
      spendableUsd,
      reserveUsd,
      requiredUsd,
      wasReduced: false,
    };
  }

  // Caso 2: Intentar reducir tamaño
  for (const step of DOWNSIZE_STEPS) {
    const adjustedUsd = intendedUsd * step;
    if (adjustedUsd < MIN_BUY_USD) continue; // Mínimo absoluto

    const requiredAdjusted = calculateRequiredUsd(adjustedUsd, feePct, slippagePct);
    if (spendableUsd >= requiredAdjusted) {
      const adjustedQty = adjustedUsd / intention.currentPrice;
      return {
        canProceed: true,
        availableUsd,
        spendableUsd,
        reserveUsd,
        requiredUsd,
        adjustedUsd,
        adjustedQty,
        wasReduced: true,
        reductionPct: (1 - step) * 100,
      };
    }
  }

  // Caso 3: No hay saldo suficiente ni siquiera para compra mínima
  return {
    canProceed: false,
    reason: `insufficient_exchange_balance: available=${availableUsd.toFixed(2)}, spendable=${spendableUsd.toFixed(2)}, required=${requiredUsd.toFixed(2)}`,
    availableUsd,
    spendableUsd,
    reserveUsd,
    requiredUsd,
    wasReduced: false,
  };
}

/**
 * Valida intención de compra LIVE antes de enviar orden.
 * Retorna resultado con tamaño ajustado si procede.
 */
export async function validateLiveBuyIntention(
  intention: BuyIntention
): Promise<ExecutionGuardResult> {
  console.log(`${TAG}[VALIDATE] pair=${intention.pair} type=${intention.buyType} intendedUsd=${intention.intendedUsd.toFixed(2)} cycleId=${intention.cycleId}`);

  // Solo aplicar en modo LIVE
  if (intention.mode !== "live") {
    return { allowed: true };
  }

  // Verificar saldo con posible reducción
  const balanceCheck = await checkBalanceWithDownsizing(intention);

  if (!balanceCheck.canProceed) {
    console.warn(`${TAG}[BLOCKED] ${balanceCheck.reason}`);
    return {
      allowed: false,
      blocked: true,
      reason: balanceCheck.reason,
      balanceCheck,
    };
  }

  if (balanceCheck.wasReduced) {
    console.log(`${TAG}[REDUCED] Original=${intention.intendedUsd.toFixed(2)}, Adjusted=${balanceCheck.adjustedUsd!.toFixed(2)} (-${balanceCheck.reductionPct!.toFixed(0)}%)`);
    return {
      allowed: true,
      reduced: true,
      finalUsd: balanceCheck.adjustedUsd,
      finalQty: balanceCheck.adjustedQty,
      balanceCheck,
    };
  }

  // Sin reducción, usar valores originales
  return {
    allowed: true,
    reduced: false,
    finalUsd: intention.intendedUsd,
    finalQty: intention.intendedQty,
    balanceCheck,
  };
}

/**
 * Espera y confirma fill de orden en exchange.
 * Para Revolut X: consulta estado de orden y trades.
 */
export async function confirmOrderFill(
  pair: string,
  exchangeOrderId: string,
  timeoutMs: number = 30000,
  pollIntervalMs: number = 2000
): Promise<FillConfirmation> {
  console.log(`${TAG}[CONFIRM_FILL] orderId=${exchangeOrderId} pair=${pair}`);

  const startTime = Date.now();

  // Revolut X: estados finales confirmados (uppercase)
  const FILLED_STATUSES = ["FILLED", "EXECUTED", "COMPLETED", "DONE", "FULLY_FILLED"];
  const PARTIAL_STATUSES = ["PARTIALLY_FILLED", "PARTIAL", "PART_FILLED"];
  const REJECTED_STATUSES = ["REJECTED", "CANCELED", "CANCELLED", "EXPIRED", "FAILED"];

  while (Date.now() - startTime < timeoutMs) {
    try {
      const exchange = ExchangeFactory.getTradingExchange();
      if (!exchange.isInitialized()) {
        return { confirmed: false, status: "unknown", filledQty: 0, filledUsd: 0, avgFillPrice: 0, feeUsd: 0 };
      }

      // Usar getOrder (existe en RevolutXService) — getOrderStatus NO existe
      // El status devuelto por getOrder está en UPPERCASE (normalizedStatus)
      const orderData: any = await (exchange as any).getOrder?.(exchangeOrderId)
        ?? await (exchange as any).getOrderStatus?.(pair, exchangeOrderId);

      if (!orderData) {
        await sleep(pollIntervalMs);
        continue;
      }

      const status = (orderData.status || '').toUpperCase();
      const filledQty = parseFloat(String(orderData.filledSize ?? orderData.filledQty ?? orderData.volume ?? 0));
      let filledUsd = parseFloat(String(orderData.executedValue ?? orderData.cost ?? orderData.value ?? 0));
      const avgFillPrice = parseFloat(String(orderData.averagePrice ?? orderData.avgPrice ?? orderData.price ?? 0));
      const feeUsd = parseFloat(String(orderData.fee ?? 0));

      // HOTFIX: Recalcular filledUsd si viene 0 pero hay filledQty y avgFillPrice
      if (filledUsd === 0 && filledQty > 0 && avgFillPrice > 0) {
        filledUsd = filledQty * avgFillPrice;
        console.log(`${TAG}[FILLED_USD_RECALC] orderId=${exchangeOrderId} recalculated filledUsd=${filledUsd.toFixed(2)} from qty=${filledQty.toFixed(8)} * price=${avgFillPrice.toFixed(2)}`);
      }

      // Fee tracking para Revolut X (base-asset fee)
      let grossBaseQty = filledQty;
      let netBaseQty = filledQty;
      let feeAsset: string | undefined = undefined;
      let feeAmount: number | undefined = undefined;
      let feeSource: "exchange_api" | "inferred_from_default_pct" | "manual" | "legacy" | null = null;

      // Detectar si es Revolut X y aplicar fallback para fee en base asset
      const exchangeName = exchange.constructor.name.toLowerCase();
      if (exchangeName.includes("revolut") && filledQty > 0 && avgFillPrice > 0) {
        // Revolut X default fee: 0.09% (0.0009)
        const REVOLUT_FEE_PCT = 0.0009;
        const inferredFeeBaseQty = filledQty * REVOLUT_FEE_PCT;
        const inferredFeeUsd = filledUsd * REVOLUT_FEE_PCT;

        // Si el fee de la API es 0 o muy pequeño, inferir fee en base asset
        if (feeUsd === 0 || Math.abs(feeUsd - inferredFeeUsd) > 0.01) {
          netBaseQty = filledQty - inferredFeeBaseQty;
          feeAsset = pair.split("/")[0]; // Base asset (BTC, ETH, etc.)
          feeAmount = inferredFeeBaseQty;
          feeSource = "inferred_from_default_pct";
          console.log(`${TAG}[REVOLUT_FEE_INFERRED] orderId=${exchangeOrderId} fee_asset=${feeAsset} fee_amount=${feeAmount.toFixed(8)} net_base_qty=${netBaseQty.toFixed(8)} source=inferred_from_default_pct`);
        } else {
          // Fee de la API es confiable
          feeAsset = "USD"; // Asumimos USD si la API devuelve fee en USD
          feeAmount = feeUsd;
          feeSource = "exchange_api";
        }
      }

      if (FILLED_STATUSES.includes(status) && filledQty > 0) {
        return {
          confirmed: true,
          exchangeOrderId,
          status: "filled",
          filledQty,
          filledUsd,
          avgFillPrice,
          feeUsd,
          fillTime: new Date(),
          rawResponse: orderData,
          grossBaseQty,
          netBaseQty,
          feeAsset,
          feeAmount,
          feeSource,
        };
      }

      if (PARTIAL_STATUSES.includes(status) && filledQty > 0) {
        return {
          confirmed: true,
          exchangeOrderId,
          status: "partially_filled",
          filledQty,
          filledUsd,
          avgFillPrice,
          feeUsd,
          fillTime: new Date(),
          rawResponse: orderData,
          grossBaseQty,
          netBaseQty,
          feeAsset,
          feeAmount,
          feeSource,
        };
      }

      if (REJECTED_STATUSES.includes(status)) {
        return { confirmed: false, exchangeOrderId, status: "rejected", filledQty: 0, filledUsd: 0, avgFillPrice: 0, feeUsd: 0, rawResponse: orderData };
      }

      // Estado pendiente (OPEN, NEW, PENDING, etc): esperar siguiente poll
      console.log(`${TAG}[POLL] Order ${exchangeOrderId} status=${status}, waiting...`);
      await sleep(pollIntervalMs);

    } catch (error: any) {
      console.error(`${TAG}[CONFIRM_ERROR] ${error.message}`);
      await sleep(pollIntervalMs);
    }
  }

  // Timeout: último recurso — consultar fills directamente por orderId
  try {
    const exchange = ExchangeFactory.getTradingExchange();
    if (exchange.isInitialized()) {
      const fills: any[] = await (exchange as any).getFills?.({ orderId: exchangeOrderId }) ?? [];
      if (Array.isArray(fills) && fills.length > 0) {
        let totalQty = 0, totalUsd = 0;
        for (const f of fills) {
          const qty = parseFloat(String(f.quantity ?? f.qty ?? f.size ?? 0));
          const px = parseFloat(String(f.price ?? f.rate ?? 0));
          if (qty > 0) { totalQty += qty; totalUsd += px * qty; }
        }
        if (totalQty > 0) {
          const avgFillPrice = totalQty > 0 ? totalUsd / totalQty : 0;
          console.log(`${TAG}[FILLS_FALLBACK] Found fills for ${exchangeOrderId}: qty=${totalQty.toFixed(8)} usd=${totalUsd.toFixed(2)}`);

          // Fee tracking para Revolut X en fallback
          let grossBaseQty = totalQty;
          let netBaseQty = totalQty;
          let feeAsset: string | undefined = undefined;
          let feeAmount: number | undefined = undefined;
          let feeSource: "exchange_api" | "inferred_from_default_pct" | "manual" | "legacy" | null = null;

          const exchangeName = exchange.constructor.name.toLowerCase();
          if (exchangeName.includes("revolut") && totalQty > 0 && avgFillPrice > 0) {
            const REVOLUT_FEE_PCT = 0.0009;
            const inferredFeeBaseQty = totalQty * REVOLUT_FEE_PCT;
            netBaseQty = totalQty - inferredFeeBaseQty;
            feeAsset = pair.split("/")[0];
            feeAmount = inferredFeeBaseQty;
            feeSource = "inferred_from_default_pct";
            console.log(`${TAG}[FILLS_FALLBACK][REVOLUT_FEE_INFERRED] orderId=${exchangeOrderId} fee_asset=${feeAsset} fee_amount=${feeAmount.toFixed(8)} net_base_qty=${netBaseQty.toFixed(8)}`);
          }

          return {
            confirmed: true,
            exchangeOrderId,
            status: "filled",
            filledQty: totalQty,
            filledUsd: totalUsd,
            avgFillPrice,
            feeUsd: 0,
            fillTime: new Date(),
            grossBaseQty,
            netBaseQty,
            feeAsset,
            feeAmount,
            feeSource,
          };
        }
      }
    }
  } catch (_fallbackErr) { /* best-effort */ }

  // Genuinamente desconocido — NO marcar failed; dejar para reconciliación manual
  console.warn(`${TAG}[UNCONFIRMED] Order ${exchangeOrderId} unconfirmed after ${timeoutMs}ms — marking execution_unknown_pending_reconciliation`);
  return {
    confirmed: false,
    status: "execution_unknown_pending_reconciliation",
    filledQty: 0,
    filledUsd: 0,
    avgFillPrice: 0,
    feeUsd: 0,
  };
}

/**
 * Valida que hay suficiente balance base para una venta propuesta.
 * Para full closes (isFullClose=true): aplica dust tolerance y devuelve cantidad ajustada.
 * Para partial closes: no tolerancia, lanza si available < requested.
 */
export async function validateSellQuantity(
  pair: string,
  requestedQty: number,
  cycleQty: number,
  isFullClose: boolean = false
): Promise<{ valid: boolean; availableQty: number; adjustedQty?: number; reason?: string }> {
  const availableQty = await getAvailableBaseQty(pair);
  
  console.log(`${TAG}[SELL_CHECK] pair=${pair} requested=${requestedQty.toFixed(8)} available=${availableQty.toFixed(8)} cycleQty=${cycleQty.toFixed(8)} isFullClose=${isFullClose}`);

  // Si el ciclo cree tener más de lo disponible en exchange, hay mismatch
  if (cycleQty > availableQty * 1.0025) { // 0.25% tolerancia (cubre dust/fees)
    return {
      valid: false,
      availableQty,
      reason: `cycle_exchange_qty_mismatch: cycleQty=${cycleQty.toFixed(8)}, availableQty=${availableQty.toFixed(8)}`,
    };
  }

  // Si la cantidad solicitada excede lo disponible
  if (requestedQty > availableQty) {
    const diff = requestedQty - availableQty;
    const diffPct = requestedQty > 0 ? (diff / requestedQty) * 100 : 100;
    const dustTolerance = Math.max(0.00000002, requestedQty * 0.0025); // 0.25% relativo

    if (isFullClose && diff <= dustTolerance) {
      // Dust tolerance aplicable: ajustar a cantidad disponible
      console.log(`${TAG}[SELL_CHECK] Dust tolerance applied: requested=${requestedQty.toFixed(8)} adjusted=${availableQty.toFixed(8)} diff=${diff.toFixed(8)} (${diffPct.toFixed(4)}%)`);
      return {
        valid: true,
        availableQty,
        adjustedQty: availableQty,
        reason: `fee_dust_quantity_adjustment: requested=${requestedQty.toFixed(8)}, available=${availableQty.toFixed(8)}, diff=${diff.toFixed(8)} (${diffPct.toFixed(4)}%) tolerance=${dustTolerance.toFixed(8)}`,
      };
    }

    return {
      valid: false,
      availableQty,
      reason: `insufficient_base_balance: requested=${requestedQty.toFixed(8)}, available=${availableQty.toFixed(8)}, diff=${diff.toFixed(8)} (${diffPct.toFixed(4)}%)`,
    };
  }

  return { valid: true, availableQty };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Genera idempotency key única para evitar dobles compras
 */
export function generateIdempotencyKey(
  pair: string,
  cycleId: number,
  buyType: string,
  buyLevel: number | undefined,
  timestampBucket: string
): string {
  return `idca-live-${pair}-${cycleId}-${buyType}-${buyLevel ?? 0}-${timestampBucket}`;
}
