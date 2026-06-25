/**
 * FISCO Import Service: Handles CSV import preview, hash dedupe, and confirmation.
 * Supports Kraken Ledger and RevolutX orders CSV formats.
 */

import { pool } from "../../db";
import { createHash } from "crypto";
import { normalizeKrakenLedger, normalizeRevolutXOrders, mergeAndSort, type NormalizedOperation } from "./normalizer";
import { krakenService } from "../kraken";
import { revolutXService } from "../exchanges/RevolutXService";

// ============================================================
// Types
// ============================================================

export interface ImportOptions {
  includeNormal: boolean;
  includeThirdFees: boolean;
  includeStaking: boolean;
  includeDeposits: boolean;
  includeWithdrawals: boolean;
  skipFiatDepositsWithdrawals: boolean;
  detectDuplicates: boolean;
  reconcileTransfers: boolean;
}

export interface ImportPreviewRow {
  row_number: number;
  exchange: string;
  raw_type: string;
  normalized_type: string | null;
  buy_amount: number | null;
  buy_asset: string | null;
  sell_amount: number | null;
  sell_asset: string | null;
  fee_amount: number | null;
  fee_asset: string | null;
  executed_at: string | null;
  external_id: string | null;
  status: "ok" | "warning" | "error" | "duplicate" | "skipped";
  message: string | null;
}

export interface ImportPreviewResult {
  import_batch_id: string;
  exchange: string;
  year: number;
  total_rows: number;
  normalized: number;
  duplicates: number;
  skipped: number;
  date_errors: number;
  value_warnings: number;
  errors: number;
  rows: ImportPreviewRow[];
  dry_run: boolean;
  options: ImportOptions;
}

// ============================================================
// Helpers
// ============================================================

function generateBatchId(): string {
  return `batch_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
}

function hashRow(op: NormalizedOperation): string {
  const key = `${op.exchange}:${op.externalId}:${op.amount}:${op.executedAt.getTime()}`;
  return createHash("sha256").update(key).digest("hex");
}

// ============================================================
// Kraken CSV Parser
// ============================================================

interface KrakenLedgerCsvRow {
  txid: string;
  refid: string;
  time: string;
  type: string;
  subtype: string;
  aclass: string;
  asset: string;
  amount: string;
  fee: string;
  balance: string;
}

function parseKrakenCsv(csv: string): KrakenLedgerCsvRow[] {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim().toLowerCase());
  const rows: KrakenLedgerCsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",");
    if (values.length !== headers.length) continue;
    const row: any = {};
    headers.forEach((h, idx) => row[h] = values[idx]?.trim());
    rows.push(row as KrakenLedgerCsvRow);
  }
  return rows;
}

// ============================================================
// RevolutX CSV Parser
// ============================================================

interface RevolutXOrderCsvRow {
  id: string;
  symbol: string;
  side: string;
  type: string;
  quantity: string;
  filled_quantity: string;
  average_fill_price: string;
  total_fee: string;
  status: string;
  created_date: string;
  filled_date: string;
}

function parseRevolutXCsv(csv: string): RevolutXOrderCsvRow[] {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim().toLowerCase());
  const rows: RevolutXOrderCsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",");
    if (values.length !== headers.length) continue;
    const row: any = {};
    headers.forEach((h, idx) => row[h] = values[idx]?.trim());
    rows.push(row as RevolutXOrderCsvRow);
  }
  return rows;
}

// ============================================================
// Main import functions
// ============================================================

export async function createImportPreview(
  exchange: "kraken" | "revolutx",
  csvContent: string,
  options: ImportOptions,
  dryRun: boolean = true
): Promise<ImportPreviewResult> {
  const batchId = generateBatchId();
  const year = new Date().getFullYear();

  let ops: NormalizedOperation[] = [];
  let rawRows: any[] = [];

  if (exchange === "kraken") {
    const ledgerRows = parseKrakenCsv(csvContent);
    rawRows = ledgerRows;
    // Convert CSV rows to KrakenLedgerEntry format
    const ledgerEntries = ledgerRows.map(r => ({
      id: r.txid,
      refid: r.refid,
      type: r.type,
      subtype: r.subtype,
      asset: r.asset,
      amount: parseFloat(r.amount),
      fee: parseFloat(r.fee),
      balance: parseFloat(r.balance),
      time: Math.floor(new Date(r.time).getTime() / 1000),
    }));
    ops = await normalizeKrakenLedger(ledgerEntries);
  } else if (exchange === "revolutx") {
    const orderRows = parseRevolutXCsv(csvContent);
    rawRows = orderRows;
    // Convert CSV rows to RevolutXOrder format
    const orders = orderRows.map(r => ({
      id: r.id,
      symbol: r.symbol,
      side: r.side as "buy" | "sell",
      type: r.type,
      quantity: parseFloat(r.quantity),
      filled_quantity: parseFloat(r.filled_quantity),
      average_fill_price: parseFloat(r.average_fill_price),
      total_fee: parseFloat(r.total_fee),
      status: r.status,
      created_date: Math.floor(new Date(r.created_date).getTime() / 1000),
      filled_date: r.filled_date ? Math.floor(new Date(r.filled_date).getTime() / 1000) : undefined,
    }));
    ops = await normalizeRevolutXOrders(orders);
  }

  // Apply options filters
  if (!options.includeNormal) ops = ops.filter(o => o.opType !== "trade_buy" && o.opType !== "trade_sell");
  if (!options.includeStaking) ops = ops.filter(o => o.opType !== "staking");
  if (!options.includeDeposits) ops = ops.filter(o => o.opType !== "deposit");
  if (!options.includeWithdrawals) ops = ops.filter(o => o.opType !== "withdrawal");
  if (options.skipFiatDepositsWithdrawals) {
    const fiat = new Set(["USD", "EUR", "GBP", "JPY", "CHF"]);
    ops = ops.filter(o => {
      if (o.opType === "deposit" || o.opType === "withdrawal") {
        return !fiat.has(o.asset);
      }
      return true;
    });
  }

  // Hash dedupe
  const hashes = new Set<string>();
  const dedupedOps: NormalizedOperation[] = [];
  const duplicateRows = new Set<number>();

  if (options.detectDuplicates) {
    for (let i = 0; i < ops.length; i++) {
      const h = hashRow(ops[i]);
      if (hashes.has(h)) {
        duplicateRows.add(i);
      } else {
        hashes.add(h);
        dedupedOps.push(ops[i]);
      }
    }
  } else {
    dedupedOps.push(...ops);
  }

  // Build preview rows
  const previewRows: ImportPreviewRow[] = [];
  let normalized = 0;
  let skipped = 0;
  const dateErrors = 0;
  const valueWarnings = 0;
  const errors = 0;

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    const isDup = duplicateRows.has(i);
    const status: ImportPreviewRow["status"] = isDup ? "duplicate" : "ok";
    const message = isDup ? "Duplicado (hash)" : null;

    previewRows.push({
      row_number: i + 1,
      exchange: op.exchange,
      raw_type: op.rawData?.type || op.rawData?.side || "unknown",
      normalized_type: op.opType,
      buy_amount: op.opType === "trade_buy" || op.opType === "deposit" || op.opType === "staking" ? op.amount : null,
      buy_asset: (op.opType === "trade_buy" || op.opType === "deposit" || op.opType === "staking") ? op.asset : null,
      sell_amount: op.opType === "trade_sell" ? op.amount : null,
      sell_asset: op.opType === "trade_sell" ? op.asset : null,
      fee_amount: op.feeEur > 0 ? op.feeEur : null,
      fee_asset: op.feeEur > 0 ? "EUR" : null,
      executed_at: op.executedAt.toISOString(),
      external_id: op.externalId,
      status,
      message,
    });

    if (!isDup) normalized++;
    else skipped++;
  }

  // Store in DB
  try {
    await pool.query(`
      INSERT INTO fisco_import_batches (import_batch_id, exchange, year, status, dry_run, options_json, summary_json)
      VALUES ($1, $2, $3, 'preview', $4, $5, $6)
    `, [batchId, exchange, year, dryRun, JSON.stringify(options), JSON.stringify({
      total_rows: ops.length,
      normalized,
      duplicates: duplicateRows.size,
      skipped,
      date_errors: dateErrors,
      value_warnings: valueWarnings,
      errors,
    })]);

    for (const row of previewRows) {
      await pool.query(`
        INSERT INTO fisco_import_rows (import_batch_id, row_number, exchange, raw_type, normalized_type,
          buy_amount, buy_asset, sell_amount, sell_asset, fee_amount, fee_asset, executed_at, external_id, status, message)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      `, [batchId, row.row_number, row.exchange, row.raw_type, row.normalized_type,
        row.buy_amount, row.buy_asset, row.sell_amount, row.sell_asset,
        row.fee_amount, row.fee_asset, row.executed_at, row.external_id, row.status, row.message]);
    }
  } catch (e: any) {
    if (e.code === "42P01" || e.message?.includes("does not exist")) {
      const error = new Error("FISCO_IMPORT_SCHEMA_MISSING: fisco_import_batches or fisco_import_rows table does not exist. Run migration 059_fisco_v2_import_config.sql") as any;
      error.code = "FISCO_IMPORT_SCHEMA_MISSING";
      throw error;
    }
    throw e;
  }

  return {
    import_batch_id: batchId,
    exchange,
    year,
    total_rows: ops.length,
    normalized,
    duplicates: duplicateRows.size,
    skipped,
    date_errors: dateErrors,
    value_warnings: valueWarnings,
    errors,
    rows: previewRows,
    dry_run: dryRun,
    options,
  };
}

export async function confirmImport(
  batchId: string,
  exchange: "kraken" | "revolutx",
  options: ImportOptions
): Promise<{ confirmed: number; batch_id: string }> {
  // In a real implementation, this would:
  // 1. Load the preview rows from DB
  // 2. Insert normalized operations into fisco_operations
  // 3. Mark batch as 'confirmed'
  // 4. Trigger a FIFO rebuild

  // For now, just mark as confirmed (FIFO V2 will handle the actual insertion)
  const result = await pool.query(`
    UPDATE fisco_import_batches
    SET status = 'confirmed', confirmed_at = NOW()
    WHERE import_batch_id = $1 AND status = 'preview'
    RETURNING id
  `, [batchId]);

  if (result.rows.length === 0) {
    throw new Error("Batch not found or already confirmed");
  }

  // Count normalized rows
  const countResult = await pool.query(`
    SELECT COUNT(*) FROM fisco_import_rows
    WHERE import_batch_id = $1 AND status = 'ok'
  `, [batchId]);

  const confirmed = parseInt(countResult.rows[0].count);

  return { confirmed, batch_id: batchId };
}

export async function getImportBatches(year?: number): Promise<any[]> {
  try {
    const query = year
      ? "SELECT * FROM fisco_import_batches WHERE year = $1 ORDER BY created_at DESC"
      : "SELECT * FROM fisco_import_batches ORDER BY created_at DESC";
    const params = year ? [year] : [];
    const result = await pool.query(query, params);
    return result.rows;
  } catch (e: any) {
    if (e.code === "42P01" || e.message?.includes("does not exist")) {
      // Table does not exist - return empty array
      return [];
    }
    throw e;
  }
}

export async function getImportBatch(batchId: string): Promise<any> {
  try {
    const result = await pool.query("SELECT * FROM fisco_import_batches WHERE import_batch_id = $1", [batchId]);
    if (result.rows.length === 0) throw new Error("Batch not found");
    return result.rows[0];
  } catch (e: any) {
    if (e.code === "42P01" || e.message?.includes("does not exist")) {
      const error = new Error("FISCO_IMPORT_SCHEMA_MISSING: fisco_import_batches table does not exist. Run migration 059_fisco_v2_import_config.sql") as any;
      error.code = "FISCO_IMPORT_SCHEMA_MISSING";
      throw error;
    }
    throw e;
  }
}
