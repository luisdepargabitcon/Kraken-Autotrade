// IDCA durable capital reservations.
//
// Race-free reservation pattern: the intent row IS the reservation. Insertion
// happens inside a transaction that first takes a transaction-scoped advisory
// lock, so all IDCA live submissions serialize; pending exposure is then summed
// inside the same transaction and the insert is rejected if any cap would be
// violated. A crash rolls back both the reservation and the intent — there is
// no state where an order can be sent without a durable reservation, and no
// reservation can leak without an intent row to reconcile.
//
// Caps enforced (all inside the lock):
//   - max one pending intent per pair+side across ALL IDCA cycles (cross-cycle
//     race protection, complementing the per-cycle scope check);
//   - sells: cumulative pending sell volume for the asset + new volume must not
//     exceed the total quantity held in live cycles for that pair (HOLD/assets
//     outside the engine are never touched because sells are sized from cycle
//     quantities, and the pending sum cannot exceed them);
//   - buys: cumulative pending reserved quote + new reservation must not exceed
//     the caller-provided available quote cap (the caller derives it from
//     balance/config; this module never invents balances).
import { db as defaultDb } from "../../db";
import { sql } from "drizzle-orm";

export interface PendingExposure {
  pendingBuyCountPairSide: number;
  pendingSellQtyAsset: number;
  pendingBuyReservedQuoteUsd: number;
  heldQtyLiveCycles: number;
  /** Exposición de compra pendiente agregada de TODOS los motores de la cuenta (TANGO-5 §2). */
  pendingBuyReservedQuoteUsdAllEngines?: number;
}

export interface ReservationCheck {
  ok: boolean;
  violations: string[];
  exposure: PendingExposure;
}

export async function computePendingExposure(
  pair: string,
  side: "buy" | "sell",
  dbOrTx: any,
): Promise<PendingExposure> {
  // Estados fijos del módulo (constantes, no input externo): IN literales.
  const rows = (await dbOrTx.execute(sql`SELECT pair, side, volume, reserved_quote_usd, status, engine_owner FROM order_intents WHERE status IN ('submitting','accepted_pending','uncertain','partial')`)).rows ?? [];
  let pendingBuyCountPairSide = 0;
  let pendingSellQtyAsset = 0;
  let pendingBuyReservedQuoteUsd = 0;
  // TANGO-5 §2: exposición de CUENTA — las compras pendientes de cualquier motor
  // que comparte el capital de la cuenta (IDCA, SPOT, ...) compiten por el mismo
  // quote. El cap de IDCA descuenta la exposición pendiente agregada cross-motor.
  let pendingBuyReservedQuoteUsdAllEngines = 0;
  for (const r of rows) {
    const v = parseFloat(String(r.volume ?? "0")) || 0;
    if (r.side === "buy") {
      const rq = parseFloat(String(r.reserved_quote_usd ?? "0")) || 0;
      pendingBuyReservedQuoteUsdAllEngines += rq;
      if (r.engine_owner === 'IDCA') {
        pendingBuyReservedQuoteUsd += rq;
        if (r.pair === pair && side === "buy") pendingBuyCountPairSide++;
      }
    } else if (r.side === "sell" && r.pair === pair && r.engine_owner === 'IDCA') {
      pendingSellQtyAsset += v;
    }
  }
  const heldRes = await dbOrTx.execute(sql`SELECT COALESCE(SUM(total_quantity),0) AS held FROM institutional_dca_cycles WHERE pair=${pair} AND mode='live' AND status IN ('active','open','running','provisional')`);
  const heldQtyLiveCycles = parseFloat(String(heldRes.rows?.[0]?.held ?? "0")) || 0;
  return { pendingBuyCountPairSide, pendingSellQtyAsset, pendingBuyReservedQuoteUsd, pendingBuyReservedQuoteUsdAllEngines, heldQtyLiveCycles };
}

export function evaluateReservation(
  exposure: PendingExposure,
  side: "buy" | "sell",
  newQty: number,
  newReservedQuoteUsd: number,
  availableQuoteCapUsd: number | null,
): ReservationCheck {
  const violations: string[] = [];
  if (side === "buy") {
    if (exposure.pendingBuyCountPairSide > 0) violations.push("pending_buy_same_pair");
    // Toda compra real exige reserva positiva durable: sin reserva no hay
    // proteccion de capital y la intencion no debe existir.
    if (!(newReservedQuoteUsd > 0)) violations.push("buy_without_positive_reservation");
    // Cap de exposición OBLIGATORIO (P0 TANGO 10.2): toda compra live exige
    // un cap finito y positivo validado en backend. Cap ausente, NaN,
    // infinito o no positivo → rechazo ANTES de contactar el venue. Nunca es
    // opcional en el contrato real.
    if (availableQuoteCapUsd == null || !Number.isFinite(availableQuoteCapUsd) || availableQuoteCapUsd <= 0) {
      violations.push("buy_without_valid_quote_cap");
    } else {
      // TANGO-5 §2: el cap se evalúa contra la exposición de CUENTA completa
      // (todos los motores). La exposición de otros motores nunca se ignora.
      const accountExposure = Math.max(
        exposure.pendingBuyReservedQuoteUsdAllEngines ?? 0,
        exposure.pendingBuyReservedQuoteUsd,
      );
      if (accountExposure + newReservedQuoteUsd > availableQuoteCapUsd * (1 + 1e-9)) {
        violations.push("quote_cap_exceeded");
      }
    }
  } else {
    // Ventas: disponible = tenencia live menos ventas ya pendientes. Con
    // tenencia cero el disponible es cero y TODA venta se rechaza; antes el
    // chequeo solo aplicaba cuando held>0 y una venta sin tenencia pasaba.
    const availableToSell = exposure.heldQtyLiveCycles - exposure.pendingSellQtyAsset;
    if (!(availableToSell > 0) || newQty > availableToSell * (1 + 1e-6)) {
      violations.push("sell_exceeds_held_plus_pending");
    }
  }
  return { ok: violations.length === 0, violations, exposure };
}

export interface InsertWithReservationParams {
  clientOrderId: string;
  pair: string;
  side: "buy" | "sell";
  volume: number;
  reservedQuoteUsd: number;
  reservedQuoteCurrency?: string;
  availableQuoteCapUsd: number | null;
  internalIntentId: string;
  executionMode: string;
  lotId: string;
  encodedReason: string;
}

export interface InsertWithReservationResult {
  inserted: boolean;
  violations: string[];
  exposure?: PendingExposure;
}

/**
 * Inserts the intent row atomically with the reservation evaluation. Uses a
 * global IDCA advisory lock so concurrent submissions — even with different
 * intent keys, cycles or processes — cannot race each other.
 */
export async function insertIntentWithReservation(
  params: InsertWithReservationParams,
  dbInstance: any = defaultDb,
): Promise<InsertWithReservationResult> {
  return dbInstance.transaction(async (tx: any) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('idca_live_intent_reservation'))`);
    // TANGO-5 §2: lock COMPARTIDO con SPOT — serializa las reservas de compra de
    // todos los motores de la cuenta en el mismo dominio transaccional.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('account_live_buy_reservation'))`);
    const exposure = await computePendingExposure(params.pair, params.side, tx);
    const check = evaluateReservation(exposure, params.side, params.volume, params.reservedQuoteUsd, params.availableQuoteCapUsd);
    if (!check.ok) {
      return { inserted: false, violations: check.violations, exposure };
    }
    const res = await tx.execute(sql`
      INSERT INTO order_intents (client_order_id,exchange,pair,side,volume,status,internal_intent_id,engine_owner,policy_version,execution_mode,lot_id,order_type,reason,reserved_quote_usd,reserved_quote_currency)
      VALUES (${params.clientOrderId},'revolutx',${params.pair},${params.side},${String(params.volume)},'submitting',${params.internalIntentId},'IDCA','IDCA_WP10',${params.executionMode},${params.lotId},${null},${params.encodedReason},${params.reservedQuoteUsd > 0 ? String(params.reservedQuoteUsd) : null},${params.reservedQuoteCurrency ?? (params.reservedQuoteUsd > 0 ? "USD" : null)})
      ON CONFLICT (client_order_id) DO NOTHING RETURNING id`);
    const inserted = (res.rows?.length ?? 0) > 0;
    return { inserted, violations: inserted ? [] : ["client_order_id_conflict"], exposure };
  });
}
