// P0 TANGO integration tests (revision of 8ccffb3):
//   1. uncertain fill must NOT be marked applied; recovery accounts exactly once
//   2. terminal partial close keeps residual quantity/cost in the cycle
//   3. reservations: sell without holdings and buy without positive reserve rejected
//   4. fills query failure / order-claims-without-evidence -> uncertain, no accounting
import fs from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { applyReconciledOutcomeAtomic, decodeIntentMeta } from "../IdcaLiveAtomicApply";
import { insertIntentWithReservation } from "../IdcaLiveReservations";

vi.mock("../../institutionalDca/IdcaRepository", () => ({
  createEvent: vi.fn(async () => ({})),
  idcaRepo: { createEvent: vi.fn(async () => ({})) },
}));
import {
  InMemoryIdcaIntentStore,
  submitAndReconcile,
  reconcilePendingIntents,
} from "../IdcaLiveOrderReconciler";

function mig(name: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), "db/migrations", name), "utf8").split(String.fromCharCode(13)).join("");
}
function strip(sqlText: string, patterns: RegExp[]): string {
  let out = sqlText;
  for (const re of patterns) out = out.replace(re, "");
  return out;
}
async function makeDb() {
  const pg = new PGlite();
  await pg.exec(strip(mig("007_order_intents.sql"), [/ALTER TABLE trades[\s\S]*?;/g, /CREATE INDEX IF NOT EXISTS idx_trades[\s\S]*?;/g, /COMMENT ON COLUMN trades[\s\S]*?;/g, /COMMENT ON TABLE trades[\s\S]*?;/g]));
  await pg.exec(strip(mig("087_spot_order_intents_provenance.sql"), [/ALTER TABLE bot_config[\s\S]*?;/g, /COMMENT ON[\s\S]*?;/g]));
  const m019 = mig("019_institutional_dca.sql");
  const extractTable = (name: string): string => {
    const lines = m019.split(String.fromCharCode(10));
    const out: string[] = [];
    let inside = false;
    for (const line of lines) {
      if (!inside && line.startsWith(`CREATE TABLE IF NOT EXISTS ${name} `)) inside = true;
      if (inside) { out.push(line); if (line.trim() === ");") break; }
    }
    return out.join(String.fromCharCode(10));
  };
  await pg.exec(extractTable("institutional_dca_cycles"));
  await pg.exec(extractTable("institutional_dca_orders"));
  await pg.exec(extractTable("institutional_dca_events"));
  await pg.exec(mig("020_idca_human_messages.sql"));
  await pg.exec(strip(mig("033_idca_exit_instructions.sql"), [/COMMENT ON[\s\S]*?;/g]));
  await pg.exec(strip(mig("038_idca_execution_traceability.sql"), [/UPDATE institutional_dca_orders[\s\S]*?;/g, /CREATE INDEX[\s\S]*?;/g, /COMMENT ON[\s\S]*?;/g]));
  await pg.exec(strip(mig("042_idca_order_fee_tracking.sql"), [/COMMENT ON[\s\S]*?;/g]));
  return { pg, db: drizzle(pg) };
}
// Una unica instancia PGlite compartida por fichero: cada PGlite es un postgres
// WASM completo y una instancia por test agota memoria cuando la suite completa
// ejecuta varios ficheros en paralelo. Los tests usan claves/pares unicos.
let sharedDbPromise: Promise<{ pg: any; db: any }> | null = null;
function sharedDb() {
  if (!sharedDbPromise) sharedDbPromise = makeDb();
  return sharedDbPromise;
}

async function seedCycle(db: any, qty = "1", capital = "100", pair = "BTC/USD") {
  const res = await db.execute(sql`INSERT INTO institutional_dca_cycles (pair, mode, status, total_quantity, capital_used_usd, total_cost_basis_usd, avg_entry_price, buy_count)
    VALUES (${pair},'live','active',${qty},${capital},${capital},'100',1) RETURNING id`);
  return res.rows[0].id as number;
}
async function seedIntent(db: any, clientOrderId: string, cycleId: number, side = "sell") {
  await db.execute(sql`INSERT INTO order_intents (client_order_id,exchange,pair,side,volume,status,internal_intent_id,engine_owner,policy_version,execution_mode,lot_id,reason)
    VALUES (${clientOrderId},'revolutx','BTC/USD',${side},'1','accepted_pending',${clientOrderId},'IDCA','IDCA_WP10','live',${String(cycleId)},'IDCA_META:{"reason":"test"}')`);
}
function sellParams(cycleId: number, clientOrderId: string, over: Record<string, unknown> = {}) {
  return {
    clientOrderId, cycleId, pair: "BTC/USD", exchangeOrderId: "o1", feeSource: "venue",
    newStatus: "filled", mergedFillIds: ["f1"], newFillIds: ["f1"], terminal: true,
    fillPrice: 110, fillVolume: 1, feeUsd: 0.05,
    effect: {
      side: "sell" as const, cumulativeFilledQty: 1, cumulativeGrossValueUsd: 110, cumulativeFeesUsd: 0.05,
      deltaQty: 1, deltaGrossValueUsd: 110, deltaFeesUsd: 0.05, averagePrice: 110,
      closePosition: true, orderType: "take_profit", triggerReason: "take_profit",
    },
    ...over,
  } as any;
}

describe("P0-1 incierto nunca se marca aplicado; recuperacion contabiliza una sola vez", () => {
  it("incierto->valido->una sola contabilizacion (DB real)", async () => {
    const { db } = await sharedDb();
    const cycleId = await seedCycle(db);
    const key = "IDCA_sell_1_p0";
    await seedIntent(db, key, cycleId);

    // Paso 1: validacion fallida (p.ej. simbolo discordante) -> el reconciliador
    // fuerza uncertain y pasa entradas acumuladas en cero. El fill f1 se observa
    // pero NO debe quedar marcado como aplicado.
    const uncertain = await applyReconciledOutcomeAtomic(sellParams(cycleId, key, {
      newStatus: "uncertain", terminal: false,
      effect: { side: "sell", cumulativeFilledQty: 0, cumulativeGrossValueUsd: 0, cumulativeFeesUsd: 0, deltaQty: 0, deltaGrossValueUsd: 0, deltaFeesUsd: 0, averagePrice: 110, closePosition: true, orderType: "take_profit", triggerReason: "take_profit" },
    }), db);
    expect(uncertain.applied).toBe(false);
    const intent = (await db.execute(sql`SELECT * FROM order_intents WHERE client_order_id=${key}`)).rows[0];
    const meta = decodeIntentMeta(intent.reason);
    expect(meta.fillIds ?? []).toHaveLength(0);
    expect(meta.appliedQty ?? 0).toBe(0);
    let cyc = (await db.execute(sql`SELECT * FROM institutional_dca_cycles WHERE id=${cycleId}`)).rows[0];
    expect(parseFloat(cyc.total_quantity)).toBeCloseTo(1, 8);

    // Paso 2: llega evidencia corregida del MISMO fill f1 -> se contabiliza exactamente una vez.
    const recovered = await applyReconciledOutcomeAtomic(sellParams(cycleId, key), db);
    expect(recovered.applied).toBe(true);
    expect(recovered.quantityApplied).toBeCloseTo(1, 8);
    cyc = (await db.execute(sql`SELECT * FROM institutional_dca_cycles WHERE id=${cycleId}`)).rows[0];
    expect(cyc.status).toBe("closed");
    const orders = (await db.execute(sql`SELECT * FROM institutional_dca_orders WHERE cycle_id=${cycleId}`)).rows;
    expect(orders).toHaveLength(1);

    // Paso 3: re-reconciliacion posterior -> delta cero, jamas doble contabilidad.
    const replay = await applyReconciledOutcomeAtomic(sellParams(cycleId, key), db);
    expect(replay.applied).toBe(false);
    const ordersAfter = (await db.execute(sql`SELECT * FROM institutional_dca_orders WHERE cycle_id=${cycleId}`)).rows;
    expect(ordersAfter).toHaveLength(1);
  });
});

describe("P0-2 cierre con cantidad residual: coste proporcional, ciclo activo", () => {
  it("fill terminal 0.999/1 NO cierra: residual conserva activo y coste", async () => {
    const { db } = await sharedDb();
    const cycleId = await seedCycle(db, "1", "100");
    const key = "IDCA_sell_1_resid";
    await seedIntent(db, key, cycleId);
    const out = await applyReconciledOutcomeAtomic(sellParams(cycleId, key, {
      effect: { side: "sell", cumulativeFilledQty: 0.999, cumulativeGrossValueUsd: 109.89, cumulativeFeesUsd: 0.05, deltaQty: 0.999, deltaGrossValueUsd: 109.89, deltaFeesUsd: 0.05, averagePrice: 110, closePosition: true, orderType: "take_profit", triggerReason: "take_profit" },
    }), db);
    expect(out.applied).toBe(true);
    expect(out.closed).toBe(false);
    expect(out.residualQty).toBeCloseTo(0.001, 8);
    const cyc = (await db.execute(sql`SELECT * FROM institutional_dca_cycles WHERE id=${cycleId}`)).rows[0];
    expect(cyc.status).toBe("active");
    expect(parseFloat(cyc.total_quantity)).toBeCloseTo(0.001, 8);
    // Coste consumido en proporcion 0.999, no el 100%: queda coste del residual.
    expect(parseFloat(cyc.capital_used_usd)).toBeCloseTo(0.1, 2);
    // PnL realizado = neto - coste vendido proporcional.
    expect(parseFloat(cyc.realized_pnl_usd)).toBeCloseTo(109.89 - 0.05 - 99.9, 2);
  });

  it("fill completo exacto si cierra y consume todo el coste (control)", async () => {
    const { db } = await sharedDb();
    const cycleId = await seedCycle(db, "1", "100");
    const key = "IDCA_sell_1_full";
    await seedIntent(db, key, cycleId);
    const out = await applyReconciledOutcomeAtomic(sellParams(cycleId, key), db);
    expect(out.closed).toBe(true);
    const cyc = (await db.execute(sql`SELECT * FROM institutional_dca_cycles WHERE id=${cycleId}`)).rows[0];
    expect(cyc.status).toBe("closed");
    expect(parseFloat(cyc.total_quantity)).toBeCloseTo(0, 8);
    expect(parseFloat(cyc.capital_used_usd)).toBeCloseTo(0, 2);
    expect(parseFloat(cyc.realized_pnl_usd)).toBeCloseTo(110 - 0.05 - 100, 2);
  });
});

describe("P0-3 reservas sin tenencia ni reserva positiva se rechazan", () => {
  // Par aislado sin ciclos live: la exposicion se evalua por par.
  const baseInsert = {
    pair: "XXX/USD", internalIntentId: "x", executionMode: "live", lotId: "1", encodedReason: "IDCA_META:{}",
  };
  it("venta con tenencia cero se rechaza aunque no haya pendientes", async () => {
    const { db } = await sharedDb();
    const res = await insertIntentWithReservation({
      ...baseInsert, clientOrderId: "IDCA_sell_zero", side: "sell", volume: 0.5, reservedQuoteUsd: 0, availableQuoteCapUsd: null,
    }, db);
    expect(res.inserted).toBe(false);
    expect(res.violations).toContain("sell_exceeds_held_plus_pending");
  });
  it("compra sin reserva positiva se rechaza", async () => {
    const { db } = await sharedDb();
    const res = await insertIntentWithReservation({
      ...baseInsert, clientOrderId: "IDCA_buy_nores", side: "buy", volume: 0.5, reservedQuoteUsd: 0, availableQuoteCapUsd: 500,
    }, db);
    expect(res.inserted).toBe(false);
    expect(res.violations).toContain("buy_without_positive_reservation");
  });
  it("compra con reserva positiva dentro del cap se acepta (control)", async () => {
    const { db } = await sharedDb();
    const res = await insertIntentWithReservation({
      ...baseInsert, clientOrderId: "IDCA_buy_ok", side: "buy", volume: 0.5, reservedQuoteUsd: 100, availableQuoteCapUsd: 500,
    }, db);
    expect(res.inserted).toBe(true);
  });
});

describe("P0-4 fallos de consulta de fills y evidencia ausente -> uncertain", () => {
  function venueMock() {
    return {
      placeOrder: vi.fn(async () => ({ success: true, orderId: "order-1", submissionState: "ACCEPTED" })),
      getOrder: vi.fn(async () => ({ id: "order-1", status: "OPEN", filledSize: 0, averagePrice: 0 })),
      getFills: vi.fn(async () => []),
    } as any;
  }
  function params(venue: any, store: any) {
    return { cycleId: 11, pair: "BTC/USD", side: "sell" as const, requestedQty: 1, reason: "t", intentKey: "close", venue, store };
  }
  function accounting() {
    const port = {
      getCycleById: vi.fn(async () => ({ id: 11, status: "active", totalQuantity: "1", capitalUsedUsd: "100" })),
      updateCycle: vi.fn(async () => ({})),
      createOrder: vi.fn(async (o: any) => o),
      getOrdersByCycle: vi.fn(async () => []),
    };
    return port as any;
  }

  it("error de consulta de fills con orden FILLED -> uncertain, sin contabilizar", async () => {
    const store = new InMemoryIdcaIntentStore();
    const v = venueMock();
    await submitAndReconcile(params(v, store));
    v.getOrder.mockResolvedValue({ id: "order-1", status: "FILLED", filledSize: 1, averagePrice: 100 });
    v.getFills.mockRejectedValue(new Error("REVOLUTX_FILLS_UNAVAILABLE: HTTP 500"));
    const acc = accounting();
    const out = await reconcilePendingIntents(v, store, acc);
    expect(out[0].state).toBe("uncertain");
    expect(acc.createOrder).not.toHaveBeenCalled();
    expect(acc.updateCycle).not.toHaveBeenCalled();
  });

  it("orden declara fill sin filas de fills corroborables -> uncertain, sin contabilizar", async () => {
    const store = new InMemoryIdcaIntentStore();
    const v = venueMock();
    await submitAndReconcile(params(v, store));
    v.getOrder.mockResolvedValue({ id: "order-1", status: "FILLED", filledSize: 1, averagePrice: 100 });
    v.getFills.mockResolvedValue([]); // cero fills reales: no hay evidencia
    const acc = accounting();
    const out = await reconcilePendingIntents(v, store, acc);
    expect(out[0].state).toBe("uncertain");
    expect(acc.createOrder).not.toHaveBeenCalled();
  });

  it("fills corroborables presentes -> filled con contabilidad (control)", async () => {
    const store = new InMemoryIdcaIntentStore();
    const v = venueMock();
    await submitAndReconcile(params(v, store));
    v.getOrder.mockResolvedValue({ id: "order-1", status: "FILLED", filledSize: 1, averagePrice: 100 });
    v.getFills.mockResolvedValue([{ fill_id: "f1", order_id: "order-1", symbol: "BTC-USD", price: 100, quantity: 1, fee: 0.09 }]);
    const acc = accounting();
    const out = await reconcilePendingIntents(v, store, acc);
    expect(out[0].state).toBe("filled");
    expect(acc.createOrder).toHaveBeenCalledTimes(1);
  });
});
