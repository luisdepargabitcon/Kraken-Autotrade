// PGlite integration tests for the atomic live-fill application and the
// durable reservation insertion. Uses the REAL migration SQL (007/087 for
// order_intents, 019/020/033/038/042 for IDCA tables) so schema drift is
// detected rather than assumed.
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { applyReconciledOutcomeAtomic } from "../IdcaLiveAtomicApply";
import { insertIntentWithReservation, computePendingExposure } from "../IdcaLiveReservations";

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
      if (inside) {
        out.push(line);
        if (line.trim() === ");") break;
      }
    }
    if (out.length === 0) throw new Error(`table ${name} not found in migration 019`);
    return out.join(String.fromCharCode(10));
  };
  const cycles = extractTable("institutional_dca_cycles");
  const orders = extractTable("institutional_dca_orders");
  const events = extractTable("institutional_dca_events");
  await pg.exec(cycles);
  await pg.exec(orders);
  await pg.exec(events);
  await pg.exec(mig("020_idca_human_messages.sql"));
  await pg.exec(strip(mig("033_idca_exit_instructions.sql"), [/COMMENT ON[\s\S]*?;/g]));
  await pg.exec(strip(mig("038_idca_execution_traceability.sql"), [/UPDATE institutional_dca_orders[\s\S]*?;/g, /CREATE INDEX[\s\S]*?;/g, /COMMENT ON[\s\S]*?;/g]));
  await pg.exec(strip(mig("042_idca_order_fee_tracking.sql"), [/COMMENT ON[\s\S]*?;/g]));
  return { pg, db: drizzle(pg) };
}

async function seedCycle(db: any, overrides: Record<string, unknown> = {}) {
  const res = await db.execute(sql`INSERT INTO institutional_dca_cycles (pair, mode, status, total_quantity, capital_used_usd, total_cost_basis_usd, avg_entry_price, buy_count)
    VALUES ('BTC/USD','live','active','1','100','100','100',1) RETURNING id`);
  const id = res.rows[0].id;
  if (Object.keys(overrides).length) {
    for (const [k, v] of Object.entries(overrides)) {
      await db.execute(sql.raw(`UPDATE institutional_dca_cycles SET ${k}='${v}' WHERE id=${id}`));
    }
  }
  return id as number;
}

async function seedIntent(db: any, clientOrderId: string, cycleId: number, side = "sell", status = "accepted_pending") {
  await db.execute(sql`INSERT INTO order_intents (client_order_id,exchange,pair,side,volume,status,internal_intent_id,engine_owner,policy_version,execution_mode,lot_id,reason)
    VALUES (${clientOrderId},'revolutx','BTC/USD',${side},'1',${status},${clientOrderId},'IDCA','IDCA_WP10','live',${String(cycleId)},'IDCA_META:{"reason":"test"}')`);
}

function sellParams(cycleId: number, clientOrderId: string, over: Record<string, unknown> = {}) {
  return {
    clientOrderId, cycleId, pair: "BTC/USD", exchangeOrderId: "o1", feeSource: "venue",
    newStatus: "filled", mergedFillIds: ["f1"], newFillIds: ["f1"], terminal: true,
    fillPrice: 110, fillVolume: 0.5, feeUsd: 0.05,
    effect: {
      side: "sell" as const, cumulativeFilledQty: 0.5, cumulativeGrossValueUsd: 55, cumulativeFeesUsd: 0.05,
      deltaQty: 0.5, deltaGrossValueUsd: 55, deltaFeesUsd: 0.05, averagePrice: 110,
      closePosition: false, orderType: "take_profit", triggerReason: "take_profit",
    },
    ...over,
  } as any;
}

describe("aplicación atómica PGlite", () => {
  it("aplica fill de venta: orden + ciclo + meta en una transacción", async () => {
    const { db } = await makeDb();
    const cycleId = await seedCycle(db);
    await seedIntent(db, "IDCA_sell_1_t1", cycleId);
    const out = await applyReconciledOutcomeAtomic(sellParams(cycleId, "IDCA_sell_1_t1"), db);
    expect(out.applied).toBe(true);
    expect(out.quantityApplied).toBeCloseTo(0.5, 8);
    const cyc = (await db.execute(sql`SELECT * FROM institutional_dca_cycles WHERE id=${cycleId}`)).rows[0];
    expect(parseFloat(cyc.total_quantity)).toBeCloseTo(0.5, 8);
    expect(parseFloat(cyc.capital_used_usd)).toBeCloseTo(50, 2);
    expect(parseFloat(cyc.realized_pnl_usd)).toBeCloseTo(55 - 0.05 - 50, 2);
    const orders = (await db.execute(sql`SELECT * FROM institutional_dca_orders WHERE cycle_id=${cycleId}`)).rows;
    expect(orders).toHaveLength(1);
    expect(orders[0].side).toBe("sell");
    const intent = (await db.execute(sql`SELECT * FROM order_intents WHERE client_order_id='IDCA_sell_1_t1'`)).rows[0];
    expect(intent.status).toBe("filled");
    expect(intent.reason).toContain('"applied":true');
    expect(intent.reason).toContain("f1");
  });

  it("idempotencia: reaplicar el mismo fill no duplica ni recontabiliza", async () => {
    const { db } = await makeDb();
    const cycleId = await seedCycle(db);
    await seedIntent(db, "IDCA_sell_1_t2", cycleId);
    const first = await applyReconciledOutcomeAtomic(sellParams(cycleId, "IDCA_sell_1_t2"), db);
    expect(first.applied).toBe(true);
    // Segundo proceso/reenvío con los mismos datos: la recomputación CAS dentro
    // de la transacción produce delta=0.
    const second = await applyReconciledOutcomeAtomic(sellParams(cycleId, "IDCA_sell_1_t2"), db);
    expect(second.applied).toBe(false);
    const cyc = (await db.execute(sql`SELECT * FROM institutional_dca_cycles WHERE id=${cycleId}`)).rows[0];
    expect(parseFloat(cyc.total_quantity)).toBeCloseTo(0.5, 8);
    const orders = (await db.execute(sql`SELECT * FROM institutional_dca_orders WHERE cycle_id=${cycleId}`)).rows;
    expect(orders).toHaveLength(1);
  });

  it("failsafe: violación de scope (modo no live) revierte TODO sin aplicar nada", async () => {
    const { db } = await makeDb();
    const cycleId = await seedCycle(db, { mode: "simulation" });
    await seedIntent(db, "IDCA_sell_1_t3", cycleId);
    await expect(applyReconciledOutcomeAtomic(sellParams(cycleId, "IDCA_sell_1_t3"), db)).rejects.toThrow(/MODE_MISMATCH/);
    // Rollback íntegro: ni orden ni ciclo ni meta del intent cambiaron.
    const cyc = (await db.execute(sql`SELECT * FROM institutional_dca_cycles WHERE id=${cycleId}`)).rows[0];
    expect(parseFloat(cyc.total_quantity)).toBeCloseTo(1, 8);
    const orders = (await db.execute(sql`SELECT * FROM institutional_dca_orders WHERE cycle_id=${cycleId}`)).rows;
    expect(orders).toHaveLength(0);
    const intent = (await db.execute(sql`SELECT * FROM order_intents WHERE client_order_id='IDCA_sell_1_t3'`)).rows[0];
    expect(intent.status).toBe("accepted_pending");
    expect(intent.reason).not.toContain('"applied":true');
  });

  it("violación de par discordante revierte la transacción completa", async () => {
    const { db } = await makeDb();
    const cycleId = await seedCycle(db);
    await seedIntent(db, "IDCA_sell_1_t4", cycleId);
    await expect(applyReconciledOutcomeAtomic(sellParams(cycleId, "IDCA_sell_1_t4", { pair: "ETH/USD" }), db)).rejects.toThrow(/PAIR_MISMATCH/);
    const orders = (await db.execute(sql`SELECT * FROM institutional_dca_orders WHERE cycle_id=${cycleId}`)).rows;
    expect(orders).toHaveLength(0);
  });

  it("dos procesos concurrentes serializan y no duplican contabilidad", async () => {
    const { db } = await makeDb();
    const cycleId = await seedCycle(db);
    await seedIntent(db, "IDCA_sell_1_t5", cycleId);
    // PGlite serializa en una conexión, pero el patrón lock+CAS es el que
    // garantiza la corrección en PostgreSQL multi-conexión: ambas llamadas
    // compiten y el resultado final debe ser exactamente una aplicación.
    const [a, b] = await Promise.allSettled([
      applyReconciledOutcomeAtomic(sellParams(cycleId, "IDCA_sell_1_t5"), db),
      applyReconciledOutcomeAtomic(sellParams(cycleId, "IDCA_sell_1_t5"), db),
    ]);
    const applied = [a, b].filter(r => r.status === "fulfilled" && (r as any).value.applied);
    expect(applied.length).toBeLessThanOrEqual(1);
    const orders = (await db.execute(sql`SELECT * FROM institutional_dca_orders WHERE cycle_id=${cycleId}`)).rows;
    expect(orders.length).toBeLessThanOrEqual(1);
    const cyc = (await db.execute(sql`SELECT * FROM institutional_dca_cycles WHERE id=${cycleId}`)).rows[0];
    expect(parseFloat(cyc.total_quantity)).toBeCloseTo(0.5, 8);
  });

  it("venta con cierre de posición cierra el ciclo atómicamente", async () => {
    const { db } = await makeDb();
    const cycleId = await seedCycle(db);
    await seedIntent(db, "IDCA_sell_1_t6", cycleId);
    const p = sellParams(cycleId, "IDCA_sell_1_t6");
    p.effect.cumulativeFilledQty = 1; p.effect.deltaQty = 1;
    p.effect.cumulativeGrossValueUsd = 110; p.effect.deltaGrossValueUsd = 110;
    p.effect.closePosition = true;
    p.fillVolume = 1;
    const out = await applyReconciledOutcomeAtomic(p, db);
    expect(out.closed).toBe(true);
    const cyc = (await db.execute(sql`SELECT * FROM institutional_dca_cycles WHERE id=${cycleId}`)).rows[0];
    expect(cyc.status).toBe("closed");
    expect(parseFloat(cyc.total_quantity)).toBe(0);
  });

  it("compra parcial acumulativa: segundo fill aplica solo el delta", async () => {
    const { db } = await makeDb();
    const cycleId = await seedCycle(db, { total_quantity: "0", capital_used_usd: "0", total_cost_basis_usd: "0" });
    await seedIntent(db, "IDCA_buy_1_t7", cycleId, "buy");
    const buyParams = (fills: string[], cumQty: number, cumGross: number, terminal: boolean) => ({
      clientOrderId: "IDCA_buy_1_t7", cycleId, pair: "BTC/USD", exchangeOrderId: "ob1", feeSource: "venue",
      newStatus: terminal ? "filled" : "partial", mergedFillIds: fills, newFillIds: fills, terminal,
      fillPrice: 100, fillVolume: cumQty, feeUsd: cumGross * 0.001,
      effect: {
        side: "buy" as const, cumulativeFilledQty: cumQty, cumulativeNetFilledQty: cumQty * 0.999,
        cumulativeGrossValueUsd: cumGross, cumulativeFeesUsd: cumGross * 0.001,
        deltaQty: cumQty, deltaGrossValueUsd: cumGross, deltaFeesUsd: cumGross * 0.001,
        averagePrice: 100, orderType: "safety_buy", triggerReason: "safety_buy", terminal,
      },
    } as any);
    const first = await applyReconciledOutcomeAtomic(buyParams(["f1"], 0.3, 30, false), db);
    expect(first.quantityApplied).toBeCloseTo(0.3, 6);
    // Segundo fill parcial acumulativo (total 0.7): solo 0.4 nuevo.
    const second = await applyReconciledOutcomeAtomic(buyParams(["f1", "f2"], 0.7, 70, true), db);
    expect(second.quantityApplied).toBeCloseTo(0.4, 6);
    const cyc = (await db.execute(sql`SELECT * FROM institutional_dca_cycles WHERE id=${cycleId}`)).rows[0];
    expect(parseFloat(cyc.total_quantity)).toBeCloseTo(0.7 * 0.999, 5);
    const orders = (await db.execute(sql`SELECT * FROM institutional_dca_orders WHERE cycle_id=${cycleId}`)).rows;
    expect(orders).toHaveLength(2);
  });
});

describe("reservas durables PGlite", () => {
  const baseInsert = {
    clientOrderId: "IDCA_buy_9_r1", pair: "BTC/USD", side: "buy" as const, volume: 0.1,
    reservedQuoteUsd: 100, availableQuoteCapUsd: 500, internalIntentId: "IDCA_buy_9_r1",
    executionMode: "live", lotId: "9", encodedReason: 'IDCA_META:{"reason":"t"}',
  };

  it("inserción con reserva persiste reserved_quote_usd", async () => {
    const { db } = await makeDb();
    const res = await insertIntentWithReservation(baseInsert, db);
    expect(res.inserted).toBe(true);
    const row = (await db.execute(sql`SELECT * FROM order_intents WHERE client_order_id='IDCA_buy_9_r1'`)).rows[0];
    expect(parseFloat(row.reserved_quote_usd)).toBeCloseTo(100, 2);
  });

  it("rechaza segunda compra pendiente del mismo par (carrera cross-ciclo)", async () => {
    const { db } = await makeDb();
    const first = await insertIntentWithReservation(baseInsert, db);
    expect(first.inserted).toBe(true);
    const second = await insertIntentWithReservation({ ...baseInsert, clientOrderId: "IDCA_buy_9_r2", internalIntentId: "IDCA_buy_9_r2", lotId: "10" }, db);
    expect(second.inserted).toBe(false);
    expect(second.violations).toContain("pending_buy_same_pair");
  });

  it("rechaza compra que excede el cap de quote disponible", async () => {
    const { db } = await makeDb();
    const res = await insertIntentWithReservation({ ...baseInsert, reservedQuoteUsd: 600 }, db);
    expect(res.inserted).toBe(false);
    expect(res.violations).toContain("quote_cap_exceeded");
    const rows = (await db.execute(sql`SELECT * FROM order_intents`)).rows;
    expect(rows).toHaveLength(0);
  });

  it("rechaza venta que excede lo mantenido más lo pendiente", async () => {
    const { db } = await makeDb();
    const cycleId = await seedCycle(db); // holds 1 BTC
    void cycleId;
    const res = await insertIntentWithReservation({
      ...baseInsert, clientOrderId: "IDCA_sell_9_r3", internalIntentId: "IDCA_sell_9_r3",
      side: "sell", volume: 1.5, reservedQuoteUsd: 0,
    }, db);
    expect(res.inserted).toBe(false);
    expect(res.violations).toContain("sell_exceeds_held_plus_pending");
  });

  it("permite venta dentro de lo mantenido y acumula exposición pendiente", async () => {
    const { db } = await makeDb();
    await seedCycle(db);
    const first = await insertIntentWithReservation({
      ...baseInsert, clientOrderId: "IDCA_sell_9_r4", internalIntentId: "IDCA_sell_9_r4",
      side: "sell", volume: 0.5, reservedQuoteUsd: 0,
    }, db);
    expect(first.inserted).toBe(true);
    const exposure = await computePendingExposure("BTC/USD", "sell", db);
    expect(exposure.pendingSellQtyAsset).toBeCloseTo(0.5, 8);
    // Otra venta de 0.6 excedería: 0.5 pendiente + 0.6 > 1 mantenido.
    const second = await insertIntentWithReservation({
      ...baseInsert, clientOrderId: "IDCA_sell_9_r5", internalIntentId: "IDCA_sell_9_r5",
      side: "sell", volume: 0.6, reservedQuoteUsd: 0,
    }, db);
    expect(second.inserted).toBe(false);
    expect(second.violations).toContain("sell_exceeds_held_plus_pending");
  });

  it("inserciones concurrentes del mismo par: exactamente una gana", async () => {
    const { db } = await makeDb();
    const [a, b] = await Promise.allSettled([
      insertIntentWithReservation(baseInsert, db),
      insertIntentWithReservation({ ...baseInsert, clientOrderId: "IDCA_buy_9_r6", internalIntentId: "IDCA_buy_9_r6" }, db),
    ]);
    const inserted = [a, b].filter(r => r.status === "fulfilled" && (r as any).value.inserted).length;
    expect(inserted).toBe(1);
    const rows = (await db.execute(sql`SELECT * FROM order_intents`)).rows;
    expect(rows).toHaveLength(1);
  });

  // TANGO-5 §2: coordinación cross-motor — la exposición pendiente de OTROS
  // motores que comparten la cuenta consume el mismo cap.
  it("cross-motor: compra pendiente de SPOT descuenta el cap de IDCA", async () => {
    const { db } = await makeDb();
    // SPOT tiene 400 USD reservados pendientes; cap total 500 → IDCA solo puede 100.
    await db.execute(sql`INSERT INTO order_intents (client_order_id,exchange,pair,side,volume,status,internal_intent_id,engine_owner,policy_version,execution_mode,lot_id,reason,reserved_quote_usd,reserved_quote_currency)
      VALUES ('SPOT_buy_1_x','revolutx','ETH/USD','buy','1','accepted_pending','SPOT_buy_1_x','SPOT_CANONICAL','SPOT_P1','live','5','spot','400','USD')`);
    const exposure = await computePendingExposure("BTC/USD", "buy", db);
    expect(exposure.pendingBuyReservedQuoteUsdAllEngines).toBeCloseTo(400, 6);
    expect(exposure.pendingBuyReservedQuoteUsd).toBeCloseTo(0, 6); // IDCA propio: nada
    // IDCA intenta reservar 150 → 400+150=550 > 500 → rechazo cross-motor.
    const res = await insertIntentWithReservation({ ...baseInsert, reservedQuoteUsd: 150 }, db);
    expect(res.inserted).toBe(false);
    expect(res.violations).toContain("quote_cap_exceeded");
    // Con 100 exactos sí cabe (400+100=500 ≤ 500).
    const ok = await insertIntentWithReservation({ ...baseInsert, reservedQuoteUsd: 100 }, db);
    expect(ok.inserted).toBe(true);
  });

  it("cross-motor: la exposición pendiente de IDCA también agrega en el total de cuenta", async () => {
    const { db } = await makeDb();
    const first = await insertIntentWithReservation({ ...baseInsert, reservedQuoteUsd: 300 }, db);
    expect(first.inserted).toBe(true);
    // Segunda compra de OTRO par (ETH) con 250: 300+250=550 > 500 → rechazada por cuenta.
    const second = await insertIntentWithReservation({
      ...baseInsert, clientOrderId: "IDCA_buy_10_eth", internalIntentId: "IDCA_buy_10_eth",
      pair: "ETH/USD", reservedQuoteUsd: 250,
    }, db);
    expect(second.inserted).toBe(false);
    expect(second.violations).toContain("quote_cap_exceeded");
  });
});
