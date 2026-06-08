/**
 * FiscoExportService
 *
 * Generates CSV exports for fiscal audit:
 *   - operations     (fisco_operations)
 *   - disposals      (fisco_disposals + fisco_operations)
 *   - lots           (fisco_lots + fisco_operations)
 *   - statement items (fisco_external_statement_items)
 *   - conservative disposals (fisco_external_statement_items WHERE classification = 'conservative_external_disposal')
 *
 * INVARIANTS: pure read — never modifies any table.
 */

import type { Pool } from "pg";

export type CsvDelimiter = "comma" | "semicolon";

interface ExportOpts {
  years?: number[];
  exchanges?: string[];
  delimiter?: CsvDelimiter;
  includeRaw?: boolean;
}

const SEP = (d: CsvDelimiter) => d === "semicolon" ? ";" : ",";

function esc(v: any, sep: string): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes(sep) || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function row(values: any[], sep: string): string {
  return values.map(v => esc(v, sep)).join(sep);
}

function buildYearFilter(years?: number[]): { clause: string; params: any[]; offset: number } {
  if (!years || years.length === 0) return { clause: "", params: [], offset: 1 };
  const placeholders = years.map((_, i) => `$${i + 1}`).join(", ");
  return { clause: `AND EXTRACT(YEAR FROM executed_at)::int IN (${placeholders})`, params: years, offset: years.length + 1 };
}

function buildExchangeFilter(exchanges: string[] | undefined, paramOffset: number): { clause: string; params: any[] } {
  const allowed = (exchanges || []).filter(e => e !== "all" && e !== "global");
  if (allowed.length === 0) return { clause: "", params: [] };
  const placeholders = allowed.map((_, i) => `$${paramOffset + i}`).join(", ");
  return { clause: `AND exchange IN (${placeholders})`, params: allowed };
}

export class FiscoExportService {
  constructor(private readonly pool: Pool) {}

  // ── 1. Operations ──────────────────────────────────────────────────────────

  async exportOperationsCsv(opts: ExportOpts = {}): Promise<string> {
    const sep = SEP(opts.delimiter ?? "comma");
    const { years, exchanges } = opts;

    const yf  = buildYearFilter(years);
    const ef  = buildExchangeFilter(exchanges, yf.offset);
    const params = [...yf.params, ...ef.params];

    const q = await this.pool.query(`
      SELECT
        EXTRACT(YEAR FROM executed_at)::int AS year,
        exchange,
        external_id,
        op_type,
        asset,
        amount::numeric        AS amount,
        price_eur::numeric     AS price_eur,
        total_eur::numeric     AS total_eur,
        fee_eur::numeric       AS fee_eur,
        counter_asset,
        pair,
        executed_at,
        created_at
        ${opts.includeRaw ? ", raw_data" : ""}
      FROM fisco_operations
      WHERE 1=1
        ${yf.clause}
        ${ef.clause}
      ORDER BY executed_at, id
    `, params);

    const headers = ["year","exchange","external_id","op_type","asset","amount",
      "price_eur","total_eur","fee_eur","counter_asset","pair","executed_at","created_at",
      ...(opts.includeRaw ? ["raw_data"] : [])];

    const lines = [row(headers, sep)];
    for (const r of q.rows) {
      lines.push(row([
        r.year, r.exchange, r.external_id, r.op_type, r.asset,
        r.amount != null ? parseFloat(r.amount) : "",
        r.price_eur != null ? parseFloat(r.price_eur) : "",
        r.total_eur != null ? parseFloat(r.total_eur) : "",
        r.fee_eur != null ? parseFloat(r.fee_eur) : "",
        r.counter_asset ?? "", r.pair ?? "",
        r.executed_at ? new Date(r.executed_at).toISOString() : "",
        r.created_at  ? new Date(r.created_at).toISOString() : "",
        ...(opts.includeRaw ? [r.raw_data ? JSON.stringify(r.raw_data) : ""] : []),
      ], sep));
    }
    return lines.join("\n");
  }

  // ── 2. Disposals ───────────────────────────────────────────────────────────

  async exportDisposalsCsv(opts: ExportOpts = {}): Promise<string> {
    const sep = SEP(opts.delimiter ?? "comma");
    const { years, exchanges } = opts;

    const yClause  = years && years.length > 0
      ? `AND EXTRACT(YEAR FROM fd.disposed_at)::int IN (${years.map((_, i) => `$${i + 1}`).join(", ")})`
      : "";
    const yParams  = years && years.length > 0 ? years : [];
    const eOffset  = yParams.length + 1;
    const allowed  = (exchanges || []).filter(e => e !== "all" && e !== "global");
    const eClause  = allowed.length > 0
      ? `AND fo.exchange IN (${allowed.map((_, i) => `$${eOffset + i}`).join(", ")})`
      : "";
    const params   = [...yParams, ...allowed];

    const q = await this.pool.query(`
      SELECT
        EXTRACT(YEAR FROM fd.disposed_at)::int AS year,
        fo.exchange,
        fo.asset,
        fo.pair,
        fd.sell_operation_id,
        fd.lot_id,
        fd.quantity::numeric        AS quantity,
        fd.proceeds_eur::numeric    AS proceeds_eur,
        fd.cost_basis_eur::numeric  AS cost_basis_eur,
        fd.gain_loss_eur::numeric   AS gain_loss_eur,
        fd.disposed_at
      FROM fisco_disposals fd
      JOIN fisco_operations fo ON fo.id = fd.sell_operation_id
      WHERE 1=1
        ${yClause}
        ${eClause}
      ORDER BY fd.disposed_at, fd.id
    `, params);

    const headers = ["year","exchange","asset","pair","sell_operation_id","lot_id",
      "quantity","proceeds_eur","cost_basis_eur","gain_loss_eur","disposed_at"];
    const lines = [row(headers, sep)];
    for (const r of q.rows) {
      lines.push(row([
        r.year, r.exchange, r.asset, r.pair ?? "",
        r.sell_operation_id, r.lot_id ?? "",
        r.quantity != null ? parseFloat(r.quantity) : "",
        r.proceeds_eur   != null ? parseFloat(r.proceeds_eur)   : "",
        r.cost_basis_eur != null ? parseFloat(r.cost_basis_eur) : "",
        r.gain_loss_eur  != null ? parseFloat(r.gain_loss_eur)  : "",
        r.disposed_at ? new Date(r.disposed_at).toISOString() : "",
      ], sep));
    }
    return lines.join("\n");
  }

  // ── 3. Lots ────────────────────────────────────────────────────────────────

  async exportLotsCsv(opts: ExportOpts = {}): Promise<string> {
    const sep = SEP(opts.delimiter ?? "comma");
    const { exchanges } = opts;

    const allowed = (exchanges || []).filter(e => e !== "all" && e !== "global");
    const eClause = allowed.length > 0
      ? `AND fo.exchange IN (${allowed.map((_, i) => `$${i + 1}`).join(", ")})`
      : "";
    const params = allowed;

    const q = await this.pool.query(`
      SELECT
        fl.asset,
        fo.exchange,
        fl.operation_id,
        fl.quantity::numeric       AS quantity,
        fl.remaining_qty::numeric  AS remaining_qty,
        fl.cost_eur::numeric       AS cost_eur,
        fl.unit_cost_eur::numeric  AS unit_cost_eur,
        fl.fee_eur::numeric        AS fee_eur,
        fo.executed_at             AS acquired_at,
        (fl.remaining_qty::numeric <= 0)::boolean AS is_closed
      FROM fisco_lots fl
      JOIN fisco_operations fo ON fo.id = fl.operation_id
      WHERE 1=1 ${eClause}
      ORDER BY fo.executed_at, fl.id
    `, params);

    const headers = ["asset","exchange","operation_id","quantity","remaining_qty",
      "cost_eur","unit_cost_eur","fee_eur","acquired_at","is_closed"];
    const lines = [row(headers, sep)];
    for (const r of q.rows) {
      lines.push(row([
        r.asset, r.exchange, r.operation_id,
        r.quantity      != null ? parseFloat(r.quantity)      : "",
        r.remaining_qty != null ? parseFloat(r.remaining_qty) : "",
        r.cost_eur      != null ? parseFloat(r.cost_eur)      : "",
        r.unit_cost_eur != null ? parseFloat(r.unit_cost_eur) : "",
        r.fee_eur       != null ? parseFloat(r.fee_eur)       : "",
        r.acquired_at ? new Date(r.acquired_at).toISOString() : "",
        r.is_closed ? "true" : "false",
      ], sep));
    }
    return lines.join("\n");
  }

  // ── 4. Statement items ─────────────────────────────────────────────────────

  async exportStatementItemsCsv(opts: ExportOpts = {}): Promise<string> {
    const sep = SEP(opts.delimiter ?? "comma");
    const { years, exchanges } = opts;

    const yClause  = years && years.length > 0
      ? `AND year IN (${years.map((_, i) => `$${i + 1}`).join(", ")})`
      : "";
    const yParams  = years && years.length > 0 ? years : [];
    const eOffset  = yParams.length + 1;
    const allowed  = (exchanges || []).filter(e => e !== "all" && e !== "global");
    const eClause  = allowed.length > 0
      ? `AND exchange IN (${allowed.map((_, i) => `$${eOffset + i}`).join(", ")})`
      : "";
    const params   = [...yParams, ...allowed];

    const q = await this.pool.query(`
      SELECT
        year, exchange, asset,
        statement_type,
        event_at,
        amount_sent::numeric     AS amount_sent,
        fee_amount::numeric      AS fee_amount,
        total_out::numeric       AS total_out,
        network,
        classification,
        taxable,
        market_price_eur::numeric   AS market_price_eur,
        proceeds_eur::numeric       AS proceeds_eur,
        cost_basis_eur::numeric     AS cost_basis_eur,
        gain_loss_eur::numeric      AS gain_loss_eur,
        reconciliation_status,
        classification_source,
        finalized_at,
        notes
      FROM fisco_external_statement_items
      WHERE 1=1 ${yClause} ${eClause}
      ORDER BY year, event_at, id
    `, params);

    const headers = ["year","exchange","asset","statement_type","event_at",
      "amount_sent","fee_amount","total_out","network","classification","taxable",
      "market_price_eur","proceeds_eur","cost_basis_eur","gain_loss_eur",
      "reconciliation_status","classification_source","finalized_at","notes"];
    const lines = [row(headers, sep)];
    for (const r of q.rows) {
      lines.push(row([
        r.year, r.exchange, r.asset, r.statement_type,
        r.event_at ? new Date(r.event_at).toISOString() : "",
        r.amount_sent    != null ? parseFloat(r.amount_sent)    : "",
        r.fee_amount     != null ? parseFloat(r.fee_amount)     : "",
        r.total_out      != null ? parseFloat(r.total_out)      : "",
        r.network ?? "",
        r.classification ?? "pending",
        r.taxable ?? "",
        r.market_price_eur != null ? parseFloat(r.market_price_eur) : "",
        r.proceeds_eur     != null ? parseFloat(r.proceeds_eur)     : "",
        r.cost_basis_eur   != null ? parseFloat(r.cost_basis_eur)   : "",
        r.gain_loss_eur    != null ? parseFloat(r.gain_loss_eur)    : "",
        r.reconciliation_status ?? "",
        r.classification_source ?? "",
        r.finalized_at ? new Date(r.finalized_at).toISOString() : "",
        r.notes ?? "",
      ], sep));
    }
    return lines.join("\n");
  }

  // ── 5. Conservative disposals ──────────────────────────────────────────────

  async exportConservativeDisposalsCsv(opts: ExportOpts = {}): Promise<string> {
    const sep = SEP(opts.delimiter ?? "comma");
    const { years, exchanges } = opts;

    const yClause  = years && years.length > 0
      ? `AND year IN (${years.map((_, i) => `$${i + 1}`).join(", ")})`
      : "";
    const yParams  = years && years.length > 0 ? years : [];
    const eOffset  = yParams.length + 1;
    const allowed  = (exchanges || []).filter(e => e !== "all" && e !== "global");
    const eClause  = allowed.length > 0
      ? `AND exchange IN (${allowed.map((_, i) => `$${eOffset + i}`).join(", ")})`
      : "";
    const params   = [...yParams, ...allowed];

    const q = await this.pool.query(`
      SELECT
        year, exchange, asset,
        event_at,
        amount_sent::numeric      AS amount_sent,
        fee_amount::numeric       AS fee_amount,
        total_out::numeric        AS total_out,
        market_price_eur::numeric AS market_price_eur,
        proceeds_eur::numeric     AS proceeds_eur,
        cost_basis_eur::numeric   AS cost_basis_eur,
        gain_loss_eur::numeric    AS gain_loss_eur,
        classification,
        taxable,
        finalized_note,
        conservative_reversed_at,
        conservative_reversed_to
      FROM fisco_external_statement_items
      WHERE classification = 'conservative_external_disposal'
        ${yClause}
        ${eClause}
      ORDER BY year, event_at, id
    `, params);

    const headers = ["year","exchange","asset","event_at","amount_sent","fee_amount",
      "total_out","market_price_eur","proceeds_eur","cost_basis_eur","gain_loss_eur",
      "classification","taxable","finalized_note","conservative_reversed_at","conservative_reversed_to"];
    const lines = [row(headers, sep)];
    for (const r of q.rows) {
      lines.push(row([
        r.year, r.exchange, r.asset,
        r.event_at ? new Date(r.event_at).toISOString() : "",
        r.amount_sent    != null ? parseFloat(r.amount_sent)    : "",
        r.fee_amount     != null ? parseFloat(r.fee_amount)     : "",
        r.total_out      != null ? parseFloat(r.total_out)      : "",
        r.market_price_eur != null ? parseFloat(r.market_price_eur) : "",
        r.proceeds_eur   != null ? parseFloat(r.proceeds_eur)   : "",
        r.cost_basis_eur != null ? parseFloat(r.cost_basis_eur) : "",
        r.gain_loss_eur  != null ? parseFloat(r.gain_loss_eur)  : "",
        r.classification ?? "", r.taxable ?? "",
        r.finalized_note ?? "",
        r.conservative_reversed_at ? new Date(r.conservative_reversed_at).toISOString() : "",
        r.conservative_reversed_to ?? "",
      ], sep));
    }
    return lines.join("\n");
  }

  // ── Counts helper (for audit metadata) ────────────────────────────────────

  async getCounts(opts: { years?: number[]; exchanges?: string[] } = {}): Promise<{
    operations: number; disposals: number; lots: number; statement_items: number;
  }> {
    const { years, exchanges } = opts;
    const yFilter = years && years.length > 0
      ? `AND EXTRACT(YEAR FROM executed_at)::int IN (${years.map((_, i) => `$${i + 1}`).join(",")})`
      : "";
    const allowed = (exchanges || []).filter(e => e !== "all" && e !== "global");
    const eFilter = (offset: number) => allowed.length > 0
      ? `AND exchange IN (${allowed.map((_, i) => `$${offset + i}`).join(",")})`
      : "";
    const yParams = years && years.length > 0 ? years : [];

    const [opsQ, dispQ, lotsQ, stmtQ] = await Promise.all([
      this.pool.query(
        `SELECT COUNT(*) AS cnt FROM fisco_operations WHERE 1=1 ${yFilter} ${eFilter(yParams.length + 1)}`,
        [...yParams, ...allowed],
      ),
      this.pool.query(
        `SELECT COUNT(*) AS cnt FROM fisco_disposals fd
         JOIN fisco_operations fo ON fo.id = fd.sell_operation_id WHERE 1=1
         ${years && years.length > 0 ? `AND EXTRACT(YEAR FROM fd.disposed_at)::int IN (${years.map((_, i) => `$${i + 1}`).join(",")})` : ""}
         ${allowed.length > 0 ? `AND fo.exchange IN (${allowed.map((_, i) => `$${yParams.length + 1 + i}`).join(",")})` : ""}`,
        [...yParams, ...allowed],
      ),
      this.pool.query(
        `SELECT COUNT(*) AS cnt FROM fisco_lots fl
         JOIN fisco_operations fo ON fo.id = fl.operation_id WHERE 1=1
         ${allowed.length > 0 ? `AND fo.exchange IN (${allowed.map((_, i) => `$${i + 1}`).join(",")})` : ""}`,
        allowed,
      ),
      this.pool.query(
        `SELECT COUNT(*) AS cnt FROM fisco_external_statement_items WHERE 1=1
         ${years && years.length > 0 ? `AND year IN (${years.map((_, i) => `$${i + 1}`).join(",")})` : ""}
         ${allowed.length > 0 ? `AND exchange IN (${allowed.map((_, i) => `$${yParams.length + 1 + i}`).join(",")})` : ""}`,
        [...yParams, ...allowed],
      ),
    ]);

    return {
      operations:     parseInt(opsQ.rows[0]?.cnt  ?? "0", 10),
      disposals:      parseInt(dispQ.rows[0]?.cnt ?? "0", 10),
      lots:           parseInt(lotsQ.rows[0]?.cnt ?? "0", 10),
      statement_items: parseInt(stmtQ.rows[0]?.cnt ?? "0", 10),
    };
  }
}
