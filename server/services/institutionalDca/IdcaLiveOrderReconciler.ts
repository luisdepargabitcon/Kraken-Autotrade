// IDCA durable live-order reconciliation.
// Status mapping with legacy spot values: created/submitting ≈ pending,
// accepted_pending ≈ accepted, rejected ≈ failed; filled/expired keep their
// meaning. IDCA rows are isolated by engine_owner='IDCA', so spot consumers
// that use positive SPOT provenance do not interpret these extended states.
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { ExchangeFactory } from "../exchanges/ExchangeFactory";
import { applyReconciledBuyEffect, applyReconciledSellEffect, type IdcaAccountingPort, defaultIdcaAccountingPort } from "./IdcaLiveAccounting";
import { deterministicClientOrderId } from "../deterministicClientOrderId";
import * as idcaRepo from "./IdcaRepository";
import { applyReconciledOutcomeAtomic } from "./IdcaLiveAtomicApply";

export type IdcaIntentState =
  | "created" | "submitting" | "accepted_pending" | "partial"
  | "filled" | "rejected" | "expired" | "uncertain";

export interface IdcaIntentRecord {
  clientOrderId: string;
  exchange: string;
  pair: string;
  side: "buy" | "sell";
  volume: number;
  status: IdcaIntentState;
  exchangeOrderId: string | null;
  internalIntentId: string;
  engineOwner: string;
  executionMode: string;
  lotId: string;
  reason: string;
  fillPrice: number | null;
  fillVolume: number | null;
  feeUsd: number | null;
}

export interface IdcaIntentStore {
  get(clientOrderId: string): Promise<IdcaIntentRecord | null>;
  insert(intent: IdcaIntentRecord): Promise<boolean>;
  update(intent: IdcaIntentRecord): Promise<void>;
  listPending(): Promise<IdcaIntentRecord[]>;
}

interface ReasonMeta { reason: string; applied?: boolean; fillIds?: string[]; appliedQty?: number; appliedGrossUsd?: number; appliedFeesUsd?: number; closePosition?: boolean; venueClientOrderId?: string; closeReason?: string }
function encodeReason(meta: ReasonMeta): string { return `IDCA_META:${JSON.stringify(meta)}`; }
function decodeReason(raw: string | null | undefined): ReasonMeta {
  if (!raw?.startsWith("IDCA_META:")) return { reason: raw ?? "" };
  try { return { reason: "", ...JSON.parse(raw.slice(10)) }; } catch { return { reason: raw }; }
}

export class InMemoryIdcaIntentStore implements IdcaIntentStore {
  readonly rows = new Map<string, IdcaIntentRecord>();
  async get(id: string) { return this.rows.get(id) ? { ...this.rows.get(id)! } : null; }
  async insert(intent: IdcaIntentRecord) {
    if (this.rows.has(intent.clientOrderId)) return false;
    this.rows.set(intent.clientOrderId, { ...intent });
    return true;
  }
  async update(intent: IdcaIntentRecord) { this.rows.set(intent.clientOrderId, { ...intent }); }
  async listPending() {
    return [...this.rows.values()].filter(r => {
      if (["submitting", "accepted_pending", "uncertain"].includes(r.status)) return true;
      if (r.status === "partial") return !isIntentApplied(r);
      return ["filled", "rejected", "expired"].includes(r.status) && !isIntentApplied(r);
    }).map(r => ({ ...r }));
  }
}

function rowToIntent(r: any): IdcaIntentRecord {
  return {
    clientOrderId: r.client_order_id,
    exchange: r.exchange,
    pair: r.pair,
    side: r.side,
    volume: parseFloat(String(r.volume)),
    status: r.status,
    exchangeOrderId: r.exchange_order_id,
    internalIntentId: r.internal_intent_id,
    engineOwner: r.engine_owner,
    executionMode: r.execution_mode,
    lotId: r.lot_id,
    reason: r.reason ?? "",
    fillPrice: r.fill_price == null ? null : parseFloat(String(r.fill_price)),
    fillVolume: r.fill_volume == null ? null : parseFloat(String(r.fill_volume)),
    feeUsd: r.fee_usd == null ? null : parseFloat(String(r.fee_usd)),
  };
}

export class DrizzleIdcaIntentStore implements IdcaIntentStore {
  async get(id: string) {
    const res: any = await db.execute(sql`SELECT * FROM order_intents WHERE client_order_id=${id} AND engine_owner='IDCA' LIMIT 1`);
    return res.rows[0] ? rowToIntent(res.rows[0]) : null;
  }
  async insert(i: IdcaIntentRecord) {
    const res: any = await db.execute(sql`
      INSERT INTO order_intents (client_order_id,exchange,pair,side,volume,status,internal_intent_id,engine_owner,policy_version,execution_mode,lot_id,order_type,reason,fill_price,fill_volume,fee_usd)
      VALUES (${i.clientOrderId},${i.exchange},${i.pair},${i.side},${String(i.volume)},${i.status},${i.internalIntentId},${i.engineOwner},${"IDCA_WP2"},${i.executionMode},${i.lotId},${decodeReason(i.reason).reason},${i.reason},${i.fillPrice},${i.fillVolume},${i.feeUsd})
      ON CONFLICT (client_order_id) DO NOTHING RETURNING id`);
    return (res.rows?.length ?? 0) > 0;
  }
  async update(i: IdcaIntentRecord) {
    await db.execute(sql`UPDATE order_intents SET status=${i.status},exchange_order_id=${i.exchangeOrderId},reason=${i.reason},fill_price=${i.fillPrice},fill_volume=${i.fillVolume},fee_usd=${i.feeUsd},updated_at=NOW() WHERE client_order_id=${i.clientOrderId} AND engine_owner='IDCA'`);
  }
  async listPending() {
    const res: any = await db.execute(sql`SELECT * FROM order_intents WHERE engine_owner='IDCA' AND (status IN ('submitting','accepted_pending','uncertain') OR (status IN ('partial','filled','rejected','expired') AND COALESCE(reason,'') NOT LIKE '%\"applied\":true%'))`);
    return res.rows.map(rowToIntent);
  }
}


function emitIntentCriticalEvent(intent: IdcaIntentRecord, eventType: string, message: string, extra: Record<string, unknown> = {}): void {
  idcaRepo.createEvent({
    cycleId: parseInt(intent.lotId, 10) || undefined,
    pair: intent.pair,
    mode: "live",
    eventType,
    severity: "critical",
    message,
    payloadJson: { clientOrderId: intent.clientOrderId, exchangeOrderId: intent.exchangeOrderId, ...extra },
  }).catch(() => {});
}

export interface IdcaVenuePort {
  placeOrder(params: any): Promise<any>;
  getOrder(id: string): Promise<any>;
  getFills(params: { orderId?: string; symbol?: string; limit?: number }): Promise<any[]>;
}

export function createRevolutXVenuePort(): IdcaVenuePort {
  return {
    placeOrder: p => ExchangeFactory.getExecutionVenue().placeOrder(p),
    getOrder: id => (ExchangeFactory.getExecutionVenue() as any).getOrder(id),
    getFills: p => (ExchangeFactory.getExecutionVenue() as any).getFills({ ...p, strict: true }),
  };
}

export interface ReconciledOutcome {
  state: IdcaIntentState;
  filledQty: number;
  grossFilledQty: number;
  netFilledQty: number;
  avgPrice: number;
  feesUsd: number;
  feeSource: "venue" | "estimated_preset" | "none";
  remainingQty: number;
  terminal: boolean;
  intent: IdcaIntentRecord;
  newlyAppliedFillIds: string[];
  alreadyApplied: boolean;
  deltaFilledQty: number;
  deltaGrossValueUsd: number;
  deltaFeesUsd: number;
  /** Cantidad que permanece en el ciclo tras una venta con fill parcial
   *  terminal o dust: el cierre no se consumo y el ciclo sigue activo. */
  residualQty?: number;
}

const TERMINAL_ZERO = new Set(["CANCELLED","CANCELED","EXPIRED","REJECTED","FAILED"]);
const TERMINAL_ANY = new Set(["FILLED","CANCELLED","CANCELED","EXPIRED","REJECTED","FAILED"]);
const DUST_REL_TOLERANCE = 0.0025;

export interface FillValidationIssue { code: string; detail: string }

/**
 * Strict fill validation per TANGO: any discordance — symbol mismatch, filled
 * quantity exceeding the requested amount beyond dust, incomplete pagination,
 * non-positive prices — means uncertainty and reconciliation, never silent
 * accounting. Excess quantity is NEVER clamped away: the position exists on
 * the venue and must be reconciled by a human or a later explicit decision.
 */
export function validateFillAggregation(
  fills: any[],
  pair: string,
  requestedQty: number,
  aggQty: number,
  pageLimit: number,
  rawFillCount: number,
): FillValidationIssue[] {
  const issues: FillValidationIssue[] = [];
  const normalizedPair = pair.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  for (const f of fills ?? []) {
    const fs = String(f.symbol ?? f.pair ?? f.product_id ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    if (fs && normalizedPair && fs !== normalizedPair) {
      issues.push({ code: "symbol_mismatch", detail: `fill symbol=${fs} != intent pair=${normalizedPair}` });
    }
  }
  if (aggQty > requestedQty * (1 + DUST_REL_TOLERANCE) + 1e-12) {
    issues.push({ code: "excess_qty", detail: `filled=${aggQty} > requested=${requestedQty}` });
  }
  if (rawFillCount >= pageLimit) {
    issues.push({ code: "pagination_incomplete", detail: `fill count ${rawFillCount} >= limit ${pageLimit}; aggregation may be partial` });
  }
  for (const f of fills ?? []) {
    const q = parseFloat(String(f.quantity ?? f.qty ?? f.size ?? 0));
    const p = parseFloat(String(f.price ?? 0));
    if (q > 0 && !(p > 0)) {
      issues.push({ code: "invalid_fill_price", detail: `fill id=${f.fill_id ?? f.id ?? "?"} qty>0 price=${p}` });
    }
  }
  return issues;
}

function aggregateFills(fills: any[], requestedQty: number) {
  const seen = new Set<string>();
  let qty = 0, quote = 0, fees = 0, feeSeen = false;
  const ids: string[] = [];
  const entries: Array<{ id: string; qty: number; price: number; fee: number }> = [];
  for (const f of fills ?? []) {
    const id = String(f.fill_id ?? f.id ?? `${f.order_id}-${f.created_at}-${f.price}-${f.quantity}`);
    if (seen.has(id)) continue;
    seen.add(id); ids.push(id);
    const q = parseFloat(String(f.quantity ?? f.qty ?? f.size ?? 0));
    const p = parseFloat(String(f.price ?? 0));
    if (!(q > 0)) continue;
    const feeRaw = parseFloat(String(f.fee ?? f.commission ?? NaN));
    const fee = Number.isFinite(feeRaw) ? feeRaw : 0;
    qty += q; quote += q * p;
    if (Number.isFinite(feeRaw) && feeRaw !== 0) { fees += fee; feeSeen = true; }
    entries.push({ id, qty, price: p, fee });
  }
  return { qty, avgPrice: qty > 0 ? quote / qty : 0, grossValueUsd: quote, fees, feeSeen, ids, entries };
}

function terminalStateFor(status: string, qty: number, requested: number): IdcaIntentState {
  const s = status.toUpperCase();
  if (qty > 0 && qty < requested * (1 - DUST_REL_TOLERANCE)) return "partial";
  if (qty > 0) return "filled";
  if (s === "FILLED") return "uncertain";
  if (s === "EXPIRED") return "expired";
  if (TERMINAL_ZERO.has(s)) return "rejected";
  return "uncertain";
}

export async function reconcileIntent(
  intent: IdcaIntentRecord,
  venue: IdcaVenuePort,
  store: IdcaIntentStore,
  requestedQty = intent.volume,
  accounting: IdcaAccountingPort = defaultIdcaAccountingPort,
  options: { deferBuyAccounting?: boolean } = {},
): Promise<ReconciledOutcome> {
  let order: any = null;
  try { order = await venue.getOrder(intent.exchangeOrderId || intent.clientOrderId); } catch { order = null; }
  let fills: any[] = [];
  let fillsFetchFailed = false;
  try { fills = await venue.getFills({ orderId: intent.exchangeOrderId || order?.id, symbol: intent.pair, limit: 100, strict: true } as any); } catch { fills = []; fillsFetchFailed = true; }
  const meta = decodeReason(intent.reason);
  const orderRef = String(intent.exchangeOrderId || order?.id || "");
  const venueClientOrderId = meta.venueClientOrderId ?? "";
  fills = (fills ?? []).filter(f =>
    (orderRef && String(f.order_id ?? "") === orderRef) ||
    (venueClientOrderId && String(f.client_order_id ?? f.clientOrderId ?? "") === venueClientOrderId) ||
    String(f.client_order_id ?? f.clientOrderId ?? "") === intent.clientOrderId
  );
  if (!order && (fills ?? []).length === 0) {
    const updated: IdcaIntentRecord = { ...intent, status: "uncertain" };
    await store.update(updated);
    return {
      state: "uncertain", filledQty: 0, grossFilledQty: 0, netFilledQty: 0, avgPrice: 0,
      feesUsd: 0, feeSource: "none", remainingQty: requestedQty, terminal: false,
      intent: updated, newlyAppliedFillIds: [], alreadyApplied: meta.applied === true,
      deltaFilledQty: 0, deltaGrossValueUsd: 0, deltaFeesUsd: 0,
    };
  }

  const FILLS_PAGE_LIMIT = 100;
  const rawFillCount = (fills ?? []).length;
  const agg = aggregateFills(fills, requestedQty);
  let qty = agg.qty, avg = agg.avgPrice, fees = agg.fees, feeSource: ReconciledOutcome["feeSource"] = agg.feeSeen ? "venue" : "none";
  const status0 = String(order?.status ?? "UNKNOWN");
  const validationIssues = validateFillAggregation(fills, intent.pair, requestedQty, agg.qty, FILLS_PAGE_LIMIT, rawFillCount);
  // P0-4: la cantidad reportada por la orden (filledSize) NO es evidencia
  // contable por si sola. Si no hay fills corroborables que la respalden,
  // la orden no puede declararse filled ni contabilizarse: se marca la
  // discordancia y el estado cae a uncertain (fail-closed).
  const orderClaimsQty = parseFloat(String(order?.filledSize ?? 0)) || 0;
  if ((!qty || qty <= 0) && orderClaimsQty > 0) {
    validationIssues.push({ code: "order_claims_fill_without_fill_rows", detail: `order.filledSize=${orderClaimsQty} sin fills corroborables; no se adopta como verdad contable` });
  }
  if (fillsFetchFailed && (orderClaimsQty > 0 || TERMINAL_ANY.has(status0))) {
    validationIssues.push({ code: "fills_evidence_unavailable", detail: "consulta de fills fallo; no se puede corroborar la ejecucion" });
  }
  if (!feeSource || feeSource === "none") {
    if (qty > 0) { fees = qty * avg * 0.0009; feeSource = "estimated_preset"; } else feeSource = "none";
  }
  const status = status0;
  const grossFilledQty = qty;
  const baseFeeEstimated = intent.side === "buy" && feeSource === "estimated_preset";
  const netFilledQty = baseFeeEstimated ? qty * (1 - 0.0009) : qty;
  let state: IdcaIntentState;
  if (qty > 0 && !(avg > 0)) state = "uncertain";
  else if (TERMINAL_ANY.has(status.toUpperCase())) state = terminalStateFor(status, qty, requestedQty);
  else if (qty >= requestedQty * (1 - DUST_REL_TOLERANCE)) state = "filled";
  else if (qty > 0) state = "partial";
  else if (status.toUpperCase() === "UNKNOWN" && !order) state = "uncertain";
  else state = "accepted_pending";
  if (validationIssues.length > 0 && state !== "uncertain") {
    state = "uncertain";
    emitIntentCriticalEvent(intent, "idca_order_uncertain", `Discordancia de fills detectada: ${validationIssues.map(i => i.code).join(",")}. Conciliación manual requerida; no se contabiliza nada.`, { issues: validationIssues });
  }
  const terminal = (state === "filled" && qty >= requestedQty * (1 - DUST_REL_TOLERANCE)) || (["filled", "partial", "rejected", "expired"].includes(state) && TERMINAL_ANY.has(status.toUpperCase()));
  const prior = new Set(meta.fillIds ?? []);
  const newEntries = agg.entries.filter(e => !prior.has(e.id));
  const newIds = newEntries.map(e => e.id);
  const mergedIds = [...prior, ...newIds];
  const cumulativeGrossValueUsd = qty > 0 ? (agg.entries.length > 0 ? agg.grossValueUsd : qty * avg) : 0;
  const appliedQty = Math.max(0, meta.appliedQty ?? 0);
  const appliedGross = Math.max(0, meta.appliedGrossUsd ?? 0);
  const appliedFees = Math.max(0, meta.appliedFeesUsd ?? 0);
  let deltaFilledQty = Math.max(0, qty - appliedQty);
  let deltaGrossValueUsd = Math.max(0, cumulativeGrossValueUsd - appliedGross);
  let deltaFeesUsd = Math.max(0, fees - appliedFees);
  if (deltaFilledQty <= 1e-12) {
    deltaFilledQty = 0;
    deltaGrossValueUsd = 0;
    deltaFeesUsd = 0;
  } else if (feeSource === "estimated_preset" && deltaFeesUsd <= 0) {
    deltaFeesUsd = deltaGrossValueUsd * 0.0009;
  }
  const remainingQty = Math.max(0, requestedQty - qty);
  const alreadyApplied = meta.applied === true;

  if (terminal && qty <= 0 && ["rejected", "expired"].includes(state) && !alreadyApplied) {
    emitIntentCriticalEvent(
      intent,
      state === "expired" ? "idca_order_expired" : "idca_order_rejected",
      `Orden IDCA terminó en estado ${state} sin fill efectivo. El ciclo no fue modificado.`,
      { venueStatus: status }
    );
  }

  const atomicStore = store instanceof DrizzleIdcaIntentStore;
  let atomicResidualQty: number | undefined;
  if (intent.side === "buy" && ["partial", "filled"].includes(state) && deltaFilledQty > 1e-12 && !alreadyApplied && !options.deferBuyAccounting && !atomicStore) {
    await applyReconciledBuyEffect({
      cycleId: parseInt(intent.lotId, 10),
      pair: intent.pair,
      cumulativeFilledQty: qty,
      cumulativeNetFilledQty: netFilledQty,
      previouslyAppliedQty: appliedQty,
      deltaQty: deltaFilledQty,
      deltaGrossValueUsd,
      deltaFeesUsd,
      averagePrice: deltaFilledQty > 0 ? deltaGrossValueUsd / deltaFilledQty : avg,
      orderType: meta.reason || "reconciled_buy",
      triggerReason: meta.reason || "reconciled_buy",
      exchangeOrderId: intent.exchangeOrderId ?? order?.id ?? null,
      clientOrderId: intent.clientOrderId,
      feeSource,
      terminal,
    }, accounting);
  }

  if (intent.side === "sell" && ["partial", "filled"].includes(state) && deltaFilledQty > 1e-12 && !alreadyApplied && !atomicStore) {
    await applyReconciledSellEffect({
      cycleId: parseInt(intent.lotId, 10),
      pair: intent.pair,
      deltaQty: deltaFilledQty,
      deltaGrossValueUsd,
      deltaFeesUsd,
      averagePrice: deltaFilledQty > 0 ? deltaGrossValueUsd / deltaFilledQty : avg,
      closePosition: state === "filled" && meta.closePosition === true,
      orderType: meta.reason || "reconciled_sell",
      triggerReason: meta.reason || "reconciled_sell",
      closeReason: meta.closeReason ?? meta.reason ?? "reconciled_sell",
      exchangeOrderId: intent.exchangeOrderId ?? order?.id ?? null,
      clientOrderId: intent.clientOrderId,
      feeSource,
    }, accounting);
  }

  const terminalDustRemainder = terminal && state === "filled" ? Math.max(0, requestedQty - qty) : 0;
  const updated: IdcaIntentRecord = {
    ...intent,
    status: state,
    exchangeOrderId: intent.exchangeOrderId ?? order?.id ?? null,
    fillPrice: qty > 0 ? avg : null,
    fillVolume: Math.max(intent.fillVolume ?? 0, qty),
    feeUsd: Math.max(intent.feeUsd ?? 0, qty > 0 ? fees : 0),
    reason: encodeReason({ ...meta, fillIds: mergedIds, appliedQty: Math.max(appliedQty, qty), appliedGrossUsd: Math.max(appliedGross, cumulativeGrossValueUsd), appliedFeesUsd: Math.max(appliedFees, fees), ...(terminalDustRemainder > 0 ? { dustRemainderQty: terminalDustRemainder } : {}), ...(terminal ? { applied: true } : {}) }),
  };
  if (atomicStore) {
    // Atomic path: accounting order + cycle update + intent meta in ONE tx.
    const effectBase = {
      averagePrice: deltaFilledQty > 0 ? deltaGrossValueUsd / deltaFilledQty : avg,
      orderType: meta.reason || `reconciled_${intent.side}`,
      triggerReason: meta.reason || `reconciled_${intent.side}`,
    };
    // Accounting applies only for partial/filled states with positive delta.
    // In any other state the cumulative inputs are zeroed so the in-tx
    // computations produce nothing: the transaction then only persists the
    // intent status/meta (rejected, expired, uncertain...).
    const accountingWarranted = ["partial", "filled"].includes(state) && deltaFilledQty > 1e-12 && !(intent.side === "buy" && options.deferBuyAccounting) && validationIssues.length === 0;
    const cumQty = accountingWarranted ? qty : 0;
    const cumGross = accountingWarranted ? cumulativeGrossValueUsd : 0;
    const cumFees = accountingWarranted ? fees : 0;
    const effect = intent.side === "sell"
      ? { side: "sell", cumulativeFilledQty: cumQty, cumulativeGrossValueUsd: cumGross, cumulativeFeesUsd: cumFees, deltaQty: deltaFilledQty, deltaGrossValueUsd, deltaFeesUsd, closePosition: state === "filled" && meta.closePosition === true, closeReason: meta.closeReason ?? meta.reason ?? "reconciled_sell", ...effectBase }
      : { side: "buy", cumulativeFilledQty: cumQty, cumulativeNetFilledQty: accountingWarranted ? netFilledQty : 0, cumulativeGrossValueUsd: cumGross, cumulativeFeesUsd: cumFees, deltaQty: deltaFilledQty, deltaGrossValueUsd, deltaFeesUsd, terminal, ...effectBase };
    let atomicResult: { residualQty?: number } | null = null;
    try {
      atomicResult = await applyReconciledOutcomeAtomic({
        clientOrderId: intent.clientOrderId,
        cycleId: parseInt(intent.lotId, 10),
        pair: intent.pair,
        exchangeOrderId: intent.exchangeOrderId ?? order?.id ?? null,
        feeSource,
        newStatus: state,
        mergedFillIds: mergedIds,
        newFillIds: newIds,
        terminal,
        fillPrice: qty > 0 ? avg : null,
        fillVolume: Math.max(intent.fillVolume ?? 0, qty),
        feeUsd: Math.max(intent.feeUsd ?? 0, qty > 0 ? fees : 0),
        dustRemainderQty: terminalDustRemainder > 0 ? terminalDustRemainder : undefined,
        effect: effect as any,
      });
      atomicResidualQty = atomicResult?.residualQty;
      if (atomicResult?.residualQty != null && atomicResult.residualQty > 1e-8) {
        emitIntentCriticalEvent(intent, "idca_residual_position", `Venta reconciliada con remanente: quedan ${atomicResult.residualQty.toFixed(8)} en el ciclo (fill parcial terminal o dust). El ciclo NO se cerro; conciliar residual antes de reapertura.`, { residualQty: atomicResult.residualQty });
      }
    } catch (e: any) {
      emitIntentCriticalEvent(intent, "idca_atomic_apply_failed", `Fallo de aplicación atómica (transacción revertida íntegramente): ${e.message}`, { error: e.message });
      throw e;
    }
  } else {
    await store.update(updated);
  }
  return {
    state, filledQty: qty, grossFilledQty, netFilledQty, avgPrice: avg, feesUsd: fees, feeSource, remainingQty, terminal,
    intent: updated, newlyAppliedFillIds: newIds, alreadyApplied,
    deltaFilledQty, deltaGrossValueUsd, deltaFeesUsd,
    residualQty: atomicResidualQty,
  };
}

export interface SubmitReconcileParams {
  cycleId: number; pair: string; side: "buy" | "sell"; requestedQty: number;
  reason: string; intentKey: string; venue?: IdcaVenuePort; store?: IdcaIntentStore;
  accounting?: IdcaAccountingPort;
  closePosition?: boolean;
  closeReason?: string;
  ordertype?: string; price?: string; dustToleranceQty?: number;
  /** Quote reservado para compras (USD). Persistido en la intención: la
   *  reserva ES la fila de intención, durable y recuperable tras reinicio. */
  reservedQuoteUsd?: number;
  /** Cap de exposición quote disponible (balance/asignación) evaluado dentro
   *  del lock de reserva. null = sin cap de quote (el chequeo de carreras por
   *  par+lado se aplica siempre). */
  availableQuoteCapUsd?: number | null;
}

/**
 * Persistence precondition for live execution: order_intents MUST be available
 * with the required schema. There is NO memory fallback for real execution —
 * without durable traceability no order may be sent, including protective
 * exits. In-memory stores are only used when explicitly injected (tests).
 */
export async function verifyIdcaIntentStorePrecondition(): Promise<{ ok: boolean; detail: string }> {
  try {
    const drizzle = new DrizzleIdcaIntentStore();
    await drizzle.listPending();
    const probe: any = await db.execute(sql`SELECT column_name FROM information_schema.columns WHERE table_name='order_intents' AND column_name IN ('engine_owner','internal_intent_id','lot_id','reserved_quote_usd','execution_mode')`);
    const cols = new Set((probe.rows ?? []).map((r: any) => r.column_name));
    const missing = ["engine_owner","internal_intent_id","lot_id","reserved_quote_usd","execution_mode"].filter(c => !cols.has(c));
    if (missing.length > 0) return { ok: false, detail: `order_intents schema incompleto: faltan ${missing.join(",")} (migración 087)` };
    return { ok: true, detail: "order_intents disponible con esquema requerido" };
  } catch (e: any) {
    return { ok: false, detail: `order_intents inaccesible: ${e.message}` };
  }
}

async function resolveStore(store?: IdcaIntentStore): Promise<IdcaIntentStore> {
  if (store) return store;
  const drizzle = new DrizzleIdcaIntentStore();
  try { await drizzle.listPending(); return drizzle; } catch (e: any) {
    if (e?.code === "42P01" || String(e?.message).includes("does not exist")) {
      idcaRepo.createEvent({
        eventType: "idca_intent_store_unavailable",
        severity: "critical",
        mode: "live",
        message: "order_intents no está disponible; ejecución live IDCA bloqueada fail-closed. No se enviará ninguna orden sin trazabilidad durable.",
        payloadJson: { reason: "order_intents_missing" },
      }).catch(() => {});
      throw new Error("IDCA_INTENT_STORE_UNAVAILABLE: persistencia durable requerida para cualquier ejecución live; apply migración 007/087");
    }
    throw e;
  }
}

export async function submitAndReconcile(params: SubmitReconcileParams): Promise<ReconciledOutcome> {
  const store = await resolveStore(params.store);
  const venue = params.venue ?? createRevolutXVenuePort();
  const key = params.intentKey.replace(/[^A-Za-z0-9_.-]/g, "_");
  const clientOrderId = `IDCA_${params.side}_${params.cycleId}_${key}`;
  const venueClientOrderId = deterministicClientOrderId(`idca-live-order:${clientOrderId}`);
  let intent = await store.get(clientOrderId);
  if (intent) return reconcileIntent(intent, venue, store, params.requestedQty, params.accounting ?? defaultIdcaAccountingPort, { deferBuyAccounting: params.side === "buy" });
  const pendingSameScope = (await store.listPending()).filter(i =>
    i.clientOrderId !== clientOrderId && i.lotId === String(params.cycleId) && i.side === params.side && i.pair === params.pair
  );
  if (pendingSameScope.length > 0) {
    throw new Error(`IDCA_ORDER_SCOPE_PENDING: cycle=${params.cycleId} side=${params.side} intent=${pendingSameScope[0].clientOrderId} state=${pendingSameScope[0].status}`);
  }
  intent = {
    clientOrderId, exchange: "revolutx", pair: params.pair, side: params.side,
    volume: params.requestedQty, status: "submitting", exchangeOrderId: null,
    internalIntentId: clientOrderId, engineOwner: "IDCA", executionMode: "live", lotId: String(params.cycleId),
    reason: encodeReason({ reason: params.reason, closePosition: params.closePosition === true, venueClientOrderId, closeReason: params.closeReason }), fillPrice: null, fillVolume: null, feeUsd: null,
  };
  let inserted: boolean;
  if (store instanceof DrizzleIdcaIntentStore) {
    // Race-free durable reservation: the insert happens inside the advisory-
    // locked transaction that evaluates global pending exposure. A violating
    // submission is rejected BEFORE any venue contact.
    const { insertIntentWithReservation } = await import("./IdcaLiveReservations");
    const res = await insertIntentWithReservation({
      clientOrderId,
      pair: params.pair,
      side: params.side,
      volume: params.requestedQty,
      reservedQuoteUsd: params.side === "buy" ? Math.max(0, params.reservedQuoteUsd ?? 0) : 0,
      availableQuoteCapUsd: params.availableQuoteCapUsd ?? null,
      internalIntentId: clientOrderId,
      executionMode: "live",
      lotId: String(params.cycleId),
      encodedReason: intent.reason,
    });
    if (!res.inserted && !res.violations.includes("client_order_id_conflict")) {
      throw new Error(`IDCA_RESERVATION_REJECTED: ${res.violations.join(",")} pair=${params.pair} side=${params.side}`);
    }
    inserted = res.inserted;
  } else {
    inserted = await store.insert(intent);
  }
  if (!inserted) {
    const existing = await store.get(clientOrderId);
    if (existing) return reconcileIntent(existing, venue, store, params.requestedQty, params.accounting ?? defaultIdcaAccountingPort, { deferBuyAccounting: params.side === "buy" });
    throw new Error(`IDCA_INTENT_INSERT_CONFLICT_MISSING: ${clientOrderId}`);
  }
  let result: any;
  try {
    result = await venue.placeOrder({ pair: params.pair, type: params.side, ordertype: params.ordertype ?? "market", volume: params.requestedQty.toFixed(8), price: params.price, clientOrderId: venueClientOrderId });
  } catch (e: any) {
    intent.status = "uncertain"; await store.update(intent);
    emitIntentCriticalEvent(intent, "idca_order_uncertain", `Orden IDCA incierta tras error de envío: ${e.message}. No se reenviará hasta reconciliar.`, { error: e.message });
    return { state: "uncertain", filledQty: 0, grossFilledQty: 0, netFilledQty: 0, avgPrice: 0, feesUsd: 0, feeSource: "none", remainingQty: params.requestedQty, terminal: false, intent, newlyAppliedFillIds: [], alreadyApplied: false, deltaFilledQty: 0, deltaGrossValueUsd: 0, deltaFeesUsd: 0 };
  }
  intent.exchangeOrderId = result?.orderId ?? result?.txid ?? null;
  // Classification matrix over the REAL adapter contract (RevolutXService.placeOrder):
  //   success=false + submissionState=REJECTED  → rejected (unequivocal only)
  //   success=false + submissionState=AMBIGUOUS → uncertain (never rejected!)
  //   success=false + submissionState missing/other → uncertain (doubt = uncertain)
  //   success=true  + submissionState=ACCEPTED/missing → accepted_pending (verify via fills)
  //   success=true  + submissionState=REJECTED/AMBIGUOUS → inconsistent → uncertain
  // An ambiguous result is never re-sent and never releases the reservation.
  const submissionState = result?.submissionState;
  const isUnequivocalReject = result?.success === false && submissionState === "REJECTED";
  const isAccepted = result?.success === true && (submissionState === "ACCEPTED" || submissionState == null);
  if (!isUnequivocalReject && !isAccepted) {
    intent.status = "uncertain"; await store.update(intent);
    emitIntentCriticalEvent(intent, "idca_order_uncertain", `Orden IDCA en estado incierto (success=${result?.success} submissionState=${submissionState ?? "ausente"}). No se reenviará ni liberará reserva hasta reconciliar.`, { submissionState: submissionState ?? null, success: result?.success ?? null, error: result?.error ?? null });
    return { state: "uncertain", filledQty: 0, grossFilledQty: 0, netFilledQty: 0, avgPrice: 0, feesUsd: 0, feeSource: "none", remainingQty: params.requestedQty, terminal: false, intent, newlyAppliedFillIds: [], alreadyApplied: false, deltaFilledQty: 0, deltaGrossValueUsd: 0, deltaFeesUsd: 0 };
  }
  if (isUnequivocalReject) {
    intent.status = "rejected";
    intent.reason = encodeReason({ ...decodeReason(intent.reason), applied: true });
    await store.update(intent);
    emitIntentCriticalEvent(intent, "idca_order_rejected", `Orden IDCA rechazada inequívocamente: ${result?.error || "sin detalle"}. El ciclo no fue modificado.`, { error: result?.error ?? null });
    return { state: "rejected", filledQty: 0, grossFilledQty: 0, netFilledQty: 0, avgPrice: 0, feesUsd: 0, feeSource: "none", remainingQty: params.requestedQty, terminal: true, intent, newlyAppliedFillIds: [], alreadyApplied: false, deltaFilledQty: 0, deltaGrossValueUsd: 0, deltaFeesUsd: 0 };
  }
  intent.status = "accepted_pending"; await store.update(intent);
  return reconcileIntent(intent, venue, store, params.requestedQty, params.accounting ?? defaultIdcaAccountingPort, { deferBuyAccounting: params.side === "buy" });
}

export async function reconcilePendingIntents(venue?: IdcaVenuePort, store?: IdcaIntentStore, accounting?: IdcaAccountingPort): Promise<ReconciledOutcome[]> {
  const s = await resolveStore(store);
  const v = venue ?? createRevolutXVenuePort();
  const out: ReconciledOutcome[] = [];
  for (const intent of await s.listPending()) {
    try {
      out.push(await reconcileIntent(intent, v, s, intent.volume, accounting ?? defaultIdcaAccountingPort));
    } catch (e: any) {
      console.error(`[IDCA][INTENT_RECONCILE] ${intent.clientOrderId}: ${e.message}`);
    }
  }
  return out;
}

export function markIntentApplied(intent: IdcaIntentRecord): IdcaIntentRecord {
  const meta = decodeReason(intent.reason);
  return { ...intent, reason: encodeReason({ ...meta, applied: true }) };
}
export function isIntentApplied(intent: IdcaIntentRecord): boolean { return decodeReason(intent.reason).applied === true; }
