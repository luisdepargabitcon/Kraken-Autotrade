// IDCA atomic live-fill application.
//
// Applies, inside ONE database transaction: intent-row lock (idempotency/CAS),
// cycle-row lock, accounting order insert, cycle update and intent meta update
// (fill ids + applied marks). A crash at any point rolls the whole transaction
// back, so no partial application state can exist; recovery re-reconciles from
// venue fills. Two concurrent processes serialize on the intent row lock: the
// second re-reads the committed meta and detects the fills as already applied.
//
// The accounting math is ported from IdcaLiveAccounting into pure functions so
// the computation happens inside the transaction over rows locked FOR UPDATE.
import { db as defaultDb } from "../../db";
import { sql } from "drizzle-orm";

export interface AtomicSellInput {
  side: "sell";
  // Cumulative venue-truth values; deltas are recomputed INSIDE the
  // transaction against the locked intent meta (CAS). The precomputed delta
  // fields remain for order-row detail but never drive the applied amounts.
  cumulativeFilledQty: number;
  cumulativeGrossValueUsd: number;
  cumulativeFeesUsd: number;
  deltaQty: number;
  deltaGrossValueUsd: number;
  deltaFeesUsd: number;
  averagePrice: number;
  closePosition: boolean;
  orderType: string;
  triggerReason: string;
  closeReason?: string;
}

export interface AtomicBuyInput {
  side: "buy";
  cumulativeFilledQty: number;
  cumulativeNetFilledQty: number;
  cumulativeGrossValueUsd: number;
  cumulativeFeesUsd: number;
  deltaQty: number;
  deltaGrossValueUsd: number;
  deltaFeesUsd: number;
  averagePrice: number;
  orderType: string;
  triggerReason: string;
  terminal: boolean;
}

export interface AtomicApplyParams {
  clientOrderId: string;
  cycleId: number;
  pair: string;
  exchangeOrderId: string | null;
  feeSource: string;
  newStatus: string;
  mergedFillIds: string[];
  newFillIds: string[];
  terminal: boolean;
  fillPrice: number | null;
  fillVolume: number | null;
  feeUsd: number | null;
  dustRemainderQty?: number;
  effect: AtomicSellInput | AtomicBuyInput;
}

export interface AtomicApplyResult {
  applied: boolean;
  alreadyApplied: boolean;
  skippedReason?: string;
  quantityApplied: number;
  closed?: boolean;
}

function num(v: unknown): number {
  const n = parseFloat(String(v ?? "0"));
  return Number.isFinite(n) ? n : 0;
}

export function decodeIntentMeta(raw: string | null | undefined): Record<string, any> {
  if (!raw?.startsWith("IDCA_META:")) return { reason: raw ?? "" };
  try { return { reason: "", ...JSON.parse(raw.slice(10)) }; } catch { return { reason: raw ?? "" } };
}
export function encodeIntentMeta(meta: Record<string, any>): string {
  return `IDCA_META:${JSON.stringify(meta)}`;
}

// ── Pure accounting math (ported from IdcaLiveAccounting; no I/O) ──

export interface SellComputation {
  cyclePatch: Record<string, unknown>;
  orderRow: Record<string, unknown>;
  quantitySold: number;
  closed: boolean;
}

export function computeSellApplication(cycle: any, e: AtomicSellInput): SellComputation | null {
  if (!(e.deltaQty > 0)) return null;
  if (!cycle || cycle.status === "closed") return null;
  const oldQty = num(cycle.total_quantity ?? cycle.totalQuantity);
  const oldCapitalUsed = num(cycle.capital_used_usd ?? cycle.capitalUsedUsd);
  if (!(oldQty > 0)) return null;

  const quantitySold = Math.min(e.deltaQty, oldQty);
  const sellRatio = e.closePosition ? 1 : Math.min(1, quantitySold / oldQty);
  const costBasisSold = oldCapitalUsed * sellRatio;
  const remainingCost = Math.max(0, oldCapitalUsed - costBasisSold);
  const grossValue = e.deltaGrossValueUsd > 0 ? e.deltaGrossValueUsd : quantitySold * e.averagePrice;
  const netValue = grossValue - e.deltaFeesUsd;
  const realizedPnlIncrement = netValue - costBasisSold;
  const remainingQty = e.closePosition ? 0 : Math.max(0, oldQty - quantitySold);
  const closed = e.closePosition || remainingQty <= 0;

  const prevRealizedPnl = num(cycle.realized_pnl_usd ?? cycle.realizedPnlUsd);
  const prevRealizedCostBasis = num(cycle.realized_cost_basis_usd ?? cycle.realizedCostBasisUsd);
  const partialSellCount = Number(cycle.partial_sell_count ?? cycle.partialSellCount ?? 0);

  const cyclePatch: Record<string, unknown> = closed ? {
    status: "closed",
    close_reason: e.closeReason ?? e.triggerReason,
    total_quantity: "0",
    capital_used_usd: "0",
    realized_cost_basis_usd: (prevRealizedCostBasis + costBasisSold).toFixed(2),
    realized_pnl_usd: (prevRealizedPnl + realizedPnlIncrement).toFixed(2),
    unrealized_pnl_usd: "0",
    unrealized_pnl_pct: "0",
    current_price: e.averagePrice.toFixed(8),
    closed_at: new Date(),
  } : {
    total_quantity: remainingQty.toFixed(8),
    capital_used_usd: remainingCost.toFixed(2),
    realized_cost_basis_usd: (prevRealizedCostBasis + costBasisSold).toFixed(2),
    realized_pnl_usd: (prevRealizedPnl + realizedPnlIncrement).toFixed(2),
    partial_sell_count: partialSellCount + 1,
    last_partial_sell_at: new Date(),
    current_price: e.averagePrice.toFixed(8),
  };

  const orderRow: Record<string, unknown> = {
    order_type: e.orderType,
    side: "sell",
    price: e.averagePrice.toFixed(8),
    quantity: quantitySold.toFixed(8),
    gross_value_usd: grossValue.toFixed(2),
    fees_usd: e.deltaFeesUsd.toFixed(4),
    slippage_usd: "0",
    net_value_usd: netValue.toFixed(2),
    trigger_reason: e.triggerReason,
    human_reason: "Venta live reconciliada atómica",
  };
  return { cyclePatch, orderRow, quantitySold, closed };
}

export interface BuyComputation {
  cyclePatch: Record<string, unknown>;
  orderRow: Record<string, unknown>;
  qtyToApply: number;
}

export function computeBuyApplication(cycle: any, cycleOrders: any[], e: AtomicBuyInput, previouslyAppliedQty: number, orderKey: string): BuyComputation | null {
  if (!(e.cumulativeFilledQty > 0) || !(e.averagePrice > 0)) return null;
  if (!cycle || cycle.status === "closed") throw new Error(`IDCA_BUY_CYCLE_UNAVAILABLE`);

  const matching = (cycleOrders ?? []).filter(o => String(o?.exchange_order_id ?? o?.exchangeOrderId ?? "") === String(orderKey));
  const externallyAccountedQty = matching.reduce((max, o) => {
    const executed = num(o?.executed_quantity ?? o?.executedQuantity ?? o?.quantity);
    return Math.max(max, executed);
  }, 0);

  const isInitialLike = ["initial_buy", "plus_buy", "recovery_buy"].includes(e.triggerReason);
  const cycleQty = num(cycle.total_quantity ?? cycle.totalQuantity);
  const netRatio = e.cumulativeFilledQty > 0
    ? Math.min(1, Math.max(0, e.cumulativeNetFilledQty / e.cumulativeFilledQty))
    : 1;
  const initialFloor = isInitialLike && externallyAccountedQty <= 0
    ? Math.min(e.cumulativeFilledQty, Math.max(0, cycleQty) / Math.max(netRatio, 1e-12))
    : 0;
  const accountedQty = Math.max(previouslyAppliedQty, externallyAccountedQty, initialFloor);
  const qtyToApply = Math.max(0, e.cumulativeFilledQty - accountedQty);
  if (qtyToApply <= 1e-12) return null;

  const grossValue = e.deltaQty > 0
    ? e.deltaGrossValueUsd * (qtyToApply / e.deltaQty)
    : qtyToApply * e.averagePrice;
  const feesUsd = e.deltaQty > 0 ? e.deltaFeesUsd * (qtyToApply / e.deltaQty) : 0;

  const positionQtyToApply = qtyToApply * netRatio;
  const oldQty = Math.max(0, cycleQty);
  const oldCapital = Math.max(0, num(cycle.capital_used_usd ?? cycle.capitalUsedUsd));
  const oldCostBasis = Math.max(0, num(cycle.total_cost_basis_usd ?? cycle.totalCostBasisUsd ?? cycle.capital_used_usd ?? cycle.capitalUsedUsd));
  const newQty = oldQty + positionQtyToApply;
  const newCapital = oldCapital + grossValue;
  const newAvg = newQty > 0 ? newCapital / newQty : 0;
  const isBaseBuy = isInitialLike;
  const shouldIncrementBuyCount = e.terminal && !isBaseBuy;
  const newBuyCount = shouldIncrementBuyCount ? Number(cycle.buy_count ?? cycle.buyCount ?? 0) + 1 : Number(cycle.buy_count ?? cycle.buyCount ?? 0);

  const cyclePatch: Record<string, unknown> = {
    total_quantity: newQty.toFixed(8),
    capital_used_usd: newCapital.toFixed(2),
    total_cost_basis_usd: (oldCostBasis + grossValue).toFixed(2),
    avg_entry_price: newAvg.toFixed(8),
    buy_count: newBuyCount,
    last_buy_at: new Date(),
    current_price: e.averagePrice.toFixed(8),
  };

  const orderRow: Record<string, unknown> = {
    order_type: isBaseBuy ? "base_buy" : "safety_buy",
    buy_index: isBaseBuy ? 1 : Math.max(1, newBuyCount),
    side: "buy",
    price: e.averagePrice.toFixed(8),
    quantity: qtyToApply.toFixed(8),
    gross_value_usd: Math.max(0, grossValue - feesUsd).toFixed(2),
    fees_usd: feesUsd.toFixed(4),
    slippage_usd: "0",
    net_value_usd: grossValue.toFixed(2),
    trigger_reason: e.triggerReason,
    human_reason: "Compra live reconciliada atómica",
    execution_status: e.terminal ? "filled" : "partial",
    executed_quantity: e.cumulativeFilledQty.toFixed(8),
    gross_base_qty: qtyToApply.toFixed(8),
    net_base_qty: positionQtyToApply.toFixed(8),
    avg_fill_price: e.averagePrice.toFixed(8),
  };
  return { cyclePatch, orderRow, qtyToApply };
}

// ── Atomic application ──

const SKIP_TERMINAL_NOFILL = new Set(["rejected", "expired"]);

/**
 * Applies one reconciled outcome atomically. Returns applied=false with
 * alreadyApplied=true when every fill was already accounted (idempotent).
 * Throws on scope violations — callers must treat them as critical.
 */
export async function applyReconciledOutcomeAtomic(
  params: AtomicApplyParams,
  dbInstance: any = defaultDb,
): Promise<AtomicApplyResult> {
  return dbInstance.transaction(async (tx: any) => {
    // 1. Lock the intent row: serializes concurrent reconcilers of this intent.
    const intentRes = await tx.execute(sql`SELECT * FROM order_intents WHERE client_order_id=${params.clientOrderId} AND engine_owner='IDCA' FOR UPDATE`);
    const intentRow = intentRes.rows?.[0];
    if (!intentRow) throw new Error(`IDCA_INTENT_MISSING_IN_TX: ${params.clientOrderId}`);
    const meta = decodeIntentMeta(intentRow.reason);
    const priorFillIds = new Set<string>(meta.fillIds ?? []);
    const unappliedFillIds = params.newFillIds.filter(id => !priorFillIds.has(id));
    const appliedQtyPrev = Math.max(0, num(meta.appliedQty));

    // 2. Lock the cycle row: serializes accounting against other intents of the cycle.
    const cycleRes = await tx.execute(sql`SELECT * FROM institutional_dca_cycles WHERE id=${params.cycleId} FOR UPDATE`);
    const cycle = cycleRes.rows?.[0];
    if (!cycle) throw new Error(`IDCA_CYCLE_MISSING_IN_TX: cycle=${params.cycleId}`);
    // Scope validation inside the transaction: never mutate a foreign/non-live cycle.
    if (String(cycle.pair) !== params.pair) throw new Error(`IDCA_CYCLE_PAIR_MISMATCH: cycle=${params.cycleId}`);
    if (String(cycle.mode) !== "live") throw new Error(`IDCA_CYCLE_MODE_MISMATCH: cycle=${params.cycleId} mode=${cycle.mode}`);

    let quantityApplied = 0;
    let closed: boolean | undefined;
    let skipped: string | undefined;

    // Recompute deltas INSIDE the transaction against the locked meta so two
    // processes can never double-apply: the second one reads the committed
    // appliedQty/appliedGross/appliedFees and computes delta=0.
    let effect = params.effect;
    if (params.effect.side === "sell") {
      const se = params.effect as AtomicSellInput;
      const deltaQty = Math.max(0, se.cumulativeFilledQty - appliedQtyPrev);
      const deltaGross = Math.max(0, se.cumulativeGrossValueUsd - num(meta.appliedGrossUsd));
      const deltaFees = Math.max(0, se.cumulativeFeesUsd - num(meta.appliedFeesUsd));
      effect = { ...se, deltaQty, deltaGrossValueUsd: deltaGross, deltaFeesUsd: deltaFees, averagePrice: deltaQty > 1e-12 && deltaGross > 0 ? deltaGross / deltaQty : se.averagePrice };
    }
    const hasNewFills = unappliedFillIds.length > 0 && (effect.side === "sell" ? effect.deltaQty > 1e-12 : true);

    if (!hasNewFills && !(effect.side === "buy" && num((effect as AtomicBuyInput).cumulativeFilledQty) > appliedQtyPrev)) {
      skipped = "no_new_fills";
    } else if (effect.side === "sell" && cycle.status === "closed") {
      skipped = "cycle_already_closed";
    } else {
      const orderKey = params.exchangeOrderId ?? params.clientOrderId;
      let computation: SellComputation | BuyComputation | null = null;
      if (effect.side === "sell") {
        computation = computeSellApplication(cycle, effect as AtomicSellInput);
      } else {
        const ordersRes = await tx.execute(sql`SELECT * FROM institutional_dca_orders WHERE cycle_id=${params.cycleId}`);
        computation = computeBuyApplication(cycle, ordersRes.rows ?? [], effect as AtomicBuyInput, appliedQtyPrev, orderKey);
      }

      if (computation) {
        // 3. Insert the accounting order row.
        const o = computation.orderRow;
        await tx.execute(sql`INSERT INTO institutional_dca_orders
          (cycle_id, pair, mode, order_type, buy_index, side, price, quantity, gross_value_usd, fees_usd, slippage_usd, net_value_usd, trigger_reason, exchange_order_id, human_reason, execution_status, executed_quantity, gross_base_qty, net_base_qty, avg_fill_price, fee_source)
          VALUES (${params.cycleId}, ${params.pair}, 'live', ${o.order_type ?? effect.orderType}, ${o.buy_index ?? null}, ${o.side}, ${o.price}, ${o.quantity}, ${o.gross_value_usd}, ${o.fees_usd}, ${o.slippage_usd ?? "0"}, ${o.net_value_usd}, ${o.trigger_reason}, ${params.exchangeOrderId}, ${o.human_reason ?? null}, ${o.execution_status ?? "filled"}, ${o.executed_quantity ?? null}, ${o.gross_base_qty ?? null}, ${o.net_base_qty ?? null}, ${o.avg_fill_price ?? null}, ${params.feeSource === "venue" ? "exchange_api" : params.feeSource === "estimated_preset" ? "inferred_from_default_pct" : null})`);

        // 4. Update the cycle with the computed patch.
        const p = computation.cyclePatch;
        await tx.execute(sql`UPDATE institutional_dca_cycles SET
          status = COALESCE(${p.status ?? null}, status),
          close_reason = COALESCE(${p.close_reason ?? null}, close_reason),
          total_quantity = ${p.total_quantity},
          capital_used_usd = ${p.capital_used_usd},
          total_cost_basis_usd = COALESCE(${p.total_cost_basis_usd ?? null}, total_cost_basis_usd),
          avg_entry_price = COALESCE(${p.avg_entry_price ?? null}, avg_entry_price),
          buy_count = COALESCE(${p.buy_count ?? null}, buy_count),
          last_buy_at = COALESCE(${p.last_buy_at ?? null}, last_buy_at),
          realized_cost_basis_usd = COALESCE(${p.realized_cost_basis_usd ?? null}, realized_cost_basis_usd),
          realized_pnl_usd = COALESCE(${p.realized_pnl_usd ?? null}, realized_pnl_usd),
          unrealized_pnl_usd = COALESCE(${p.unrealized_pnl_usd ?? null}, unrealized_pnl_usd),
          unrealized_pnl_pct = COALESCE(${p.unrealized_pnl_pct ?? null}, unrealized_pnl_pct),
          partial_sell_count = COALESCE(${p.partial_sell_count ?? null}, partial_sell_count),
          last_partial_sell_at = COALESCE(${p.last_partial_sell_at ?? null}, last_partial_sell_at),
          current_price = COALESCE(${p.current_price ?? null}, current_price),
          closed_at = COALESCE(${p.closed_at ?? null}, closed_at),
          updated_at = NOW()
          WHERE id=${params.cycleId}`);
        quantityApplied = effect.side === "sell" ? (computation as SellComputation).quantitySold : (computation as BuyComputation).qtyToApply;
        closed = effect.side === "sell" ? (computation as SellComputation).closed : undefined;
      } else {
        skipped = "nothing_to_apply";
      }
    }

    // 5. Update intent meta in the SAME transaction: fill ids + applied marks.
    const newMeta = {
      ...meta,
      fillIds: params.mergedFillIds,
      appliedQty: Math.max(appliedQtyPrev, params.fillVolume ?? appliedQtyPrev),
      appliedGrossUsd: Math.max(num(meta.appliedGrossUsd), effect.side === "buy" ? num((effect as AtomicBuyInput).cumulativeGrossValueUsd) : num((effect as AtomicSellInput).cumulativeGrossValueUsd)),
      appliedFeesUsd: Math.max(num(meta.appliedFeesUsd), effect.side === "buy" ? num((effect as AtomicBuyInput).cumulativeFeesUsd) : num((effect as AtomicSellInput).cumulativeFeesUsd), params.feeUsd ?? 0),
      ...(params.dustRemainderQty != null && params.dustRemainderQty > 0 ? { dustRemainderQty: params.dustRemainderQty } : {}),
      ...(params.terminal ? { applied: true } : {}),
    };
    await tx.execute(sql`UPDATE order_intents SET status=${params.newStatus}, exchange_order_id=COALESCE(${params.exchangeOrderId}, exchange_order_id), reason=${encodeIntentMeta(newMeta)}, fill_price=${params.fillPrice}, fill_volume=${params.fillVolume}, fee_usd=${params.feeUsd}, updated_at=NOW() WHERE client_order_id=${params.clientOrderId} AND engine_owner='IDCA'`);

    return {
      applied: quantityApplied > 0,
      alreadyApplied: skipped === "no_new_fills" || skipped === "nothing_to_apply",
      skippedReason: skipped,
      quantityApplied,
      closed,
    };
  });
}
