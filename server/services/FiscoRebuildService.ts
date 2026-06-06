/**
 * FiscoRebuildService — Controlled FISCO data rebuild with backup, dry-run,
 * validation and reconciliation.
 *
 * Flow:
 *   1. backup()           → snapshot current official tables
 *   2. fetchAndNormalize() → get fresh data from exchange APIs
 *   3. computeFifo()       → run FIFO engine on normalized ops
 *   4. saveToDryRun()      → write to staging tables (non-destructive)
 *   5. validate()          → check for critical errors
 *   6. compareWithOfficial() → generate diff report
 *   7. commitToOfficial()  → atomic swap staging → official (ONLY if no critical errors)
 *   8. runReconciliation() → store reconciliation results
 */

import { pool } from "../db";
import { krakenService } from "./kraken";
import { revolutXService } from "./exchanges/RevolutXService";
import { normalizeKrakenLedger, normalizeRevolutXOrders, mergeAndSort, type NormalizedOperation } from "./fisco/normalizer";
import { runFifo, validateFifoResult, type FifoResult, type FiscoCriticalError } from "./fisco/fifo-engine";
import { randomUUID } from "crypto";

// ============================================================
// Types
// ============================================================

export type RebuildMode = "dry_run" | "commit";

export interface RebuildOptions {
  mode: RebuildMode;
  triggeredBy?: string;
  exchangeFilter?: "kraken" | "revolutx" | null;
  fullSync?: boolean;
}

export interface RebuildResult {
  runId: string;
  mode: RebuildMode;
  status: "completed_dry" | "committed" | "failed" | "aborted";
  isSafeForReport: boolean;
  operationsCount: number;
  lotsCount: number;
  disposalsCount: number;
  criticalErrorsCount: number;
  warningsCount: number;
  criticalErrors: FiscoCriticalError[];
  warnings: string[];
  backupId: string | null;
  comparison: ComparisonSummary | null;
  reconciliationId: string | null;
  elapsedMs: number;
  error?: string;
}

export interface ComparisonSummary {
  previousOperationsCount: number;
  newOperationsCount: number;
  addedOperations: number;
  removedOperations: number;
  addedByAsset: Record<string, number>;
  removedByAsset: Record<string, number>;
  previousGainLossEur: Record<number, number>;
  newGainLossEur: Record<number, number>;
}

// ============================================================
// FiscoRebuildService
// ============================================================

export class FiscoRebuildService {
  private static instance: FiscoRebuildService;

  public static getInstance(): FiscoRebuildService {
    if (!FiscoRebuildService.instance) {
      FiscoRebuildService.instance = new FiscoRebuildService();
    }
    return FiscoRebuildService.instance;
  }

  // ============================================================
  // Public entrypoint
  // ============================================================

  async rebuild(options: RebuildOptions): Promise<RebuildResult> {
    const t0 = Date.now();
    const runId = randomUUID();
    const { mode, triggeredBy = "unknown", exchangeFilter = null, fullSync = true } = options;

    console.log(`[fisco/rebuild] Starting rebuild runId=${runId} mode=${mode} exchange=${exchangeFilter ?? "all"}`);

    await this.createRun(runId, mode, triggeredBy, exchangeFilter ?? null);

    let backupId: string | null = null;

    try {
      // Step 1: Backup current official tables
      backupId = await this.backup(runId);
      console.log(`[fisco/rebuild] Backup complete: ${backupId}`);

      // Step 2: Fetch and normalize
      const ops = await this.fetchAndNormalize(exchangeFilter, fullSync);
      console.log(`[fisco/rebuild] Normalized ${ops.length} operations`);

      // Step 3: FIFO
      const fifo = runFifo(ops);
      const validationErrors = validateFifoResult(fifo);
      fifo.criticalErrors.push(...validationErrors.filter(e =>
        !fifo.criticalErrors.some(x => x.code === e.code && x.externalId === e.externalId)
      ));
      // Recalculate isSafeForReport based on the final merged error list
      fifo.isSafeForReport = fifo.criticalErrors.length === 0;

      console.log(`[fisco/rebuild] FIFO done. Lots=${fifo.lots.length} Disposals=${fifo.disposals.length} Errors=${fifo.criticalErrors.length} Safe=${fifo.isSafeForReport}`);

      // Step 4: Save to staging tables
      await this.saveToDryRun(runId, ops, fifo);

      // Step 5: Generate comparison
      const comparison = await this.compareWithOfficial(runId);

      // Step 6: Update run record
      await this.updateRun(runId, {
        operations_count: ops.length,
        lots_count: fifo.lots.length,
        disposals_count: fifo.disposals.length,
        critical_errors_count: fifo.criticalErrors.length,
        warnings_count: fifo.warnings.length,
        is_safe_for_report: fifo.isSafeForReport,
        errors_json: JSON.stringify(fifo.criticalErrors),
        warnings_json: JSON.stringify(fifo.warnings),
        comparison_json: JSON.stringify(comparison),
        backup_id: backupId,
      });

      // Step 7: Commit if mode=commit AND no critical errors
      let finalStatus: RebuildResult["status"];
      let reconciliationId: string | null = null;

      if (mode === "dry_run") {
        finalStatus = "completed_dry";
        console.log(`[fisco/rebuild] Dry-run complete. ${fifo.criticalErrors.length} critical errors.`);
      } else if (!fifo.isSafeForReport) {
        // ABORT: cannot commit with critical errors
        finalStatus = "aborted";
        await this.updateRun(runId, {
          status: "aborted",
          completed_at: new Date().toISOString(),
          notes: `Commit abortado: ${fifo.criticalErrors.length} errores críticos impiden la sustitución de datos oficiales.`,
        });
        console.warn(`[fisco/rebuild] COMMIT ABORTED — ${fifo.criticalErrors.length} critical errors`);
      } else {
        // COMMIT: swap staging → official
        await this.commitToOfficial(runId, backupId);
        finalStatus = "committed";

        // Step 8: Reconciliation after commit
        reconciliationId = await this.runReconciliation(runId);
        console.log(`[fisco/rebuild] Committed and reconciled. ReconciliationId=${reconciliationId}`);
      }

      await this.updateRun(runId, {
        status: finalStatus,
        completed_at: new Date().toISOString(),
      });

      return {
        runId,
        mode,
        status: finalStatus,
        isSafeForReport: fifo.isSafeForReport,
        operationsCount: ops.length,
        lotsCount: fifo.lots.length,
        disposalsCount: fifo.disposals.length,
        criticalErrorsCount: fifo.criticalErrors.length,
        warningsCount: fifo.warnings.length,
        criticalErrors: fifo.criticalErrors,
        warnings: fifo.warnings,
        backupId,
        comparison,
        reconciliationId,
        elapsedMs: Date.now() - t0,
      };
    } catch (err: any) {
      console.error(`[fisco/rebuild] FAILED runId=${runId}:`, err);
      await this.updateRun(runId, {
        status: "failed",
        completed_at: new Date().toISOString(),
        notes: err.message,
      });
      return {
        runId, mode,
        status: "failed",
        isSafeForReport: false,
        operationsCount: 0, lotsCount: 0, disposalsCount: 0,
        criticalErrorsCount: 0, warningsCount: 0,
        criticalErrors: [], warnings: [],
        backupId, comparison: null, reconciliationId: null,
        elapsedMs: Date.now() - t0,
        error: err.message,
      };
    }
  }

  // ============================================================
  // Step 1: Backup
  // ============================================================

  async backup(runId: string): Promise<string> {
    const backupId = `bkp_${Date.now()}_${runId.slice(0, 8)}`;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(`
        INSERT INTO fisco_backup_operations
          (backup_id, original_id, exchange, external_id, op_type, asset, amount,
           price_eur, total_eur, fee_eur, counter_asset, pair, executed_at, raw_data)
        SELECT $1, id, exchange, external_id, op_type, asset, amount,
               price_eur, total_eur, fee_eur, counter_asset, pair, executed_at, raw_data
        FROM fisco_operations
      `, [backupId]);

      await client.query(`
        INSERT INTO fisco_backup_lots
          (backup_id, original_id, operation_id, asset, quantity, remaining_qty,
           cost_eur, unit_cost_eur, fee_eur, acquired_at, is_closed)
        SELECT $1, id, operation_id, asset, quantity, remaining_qty,
               cost_eur, unit_cost_eur, fee_eur, acquired_at, is_closed
        FROM fisco_lots
      `, [backupId]);

      await client.query(`
        INSERT INTO fisco_backup_disposals
          (backup_id, original_id, sell_operation_id, lot_id_str, asset,
           quantity, proceeds_eur, cost_basis_eur, gain_loss_eur, disposed_at)
        SELECT $1, id, sell_operation_id,
               COALESCE(lot_id::text, 'UNKNOWN_BASIS'),
               asset, quantity, proceeds_eur, cost_basis_eur, gain_loss_eur, disposed_at
        FROM fisco_disposals
        LEFT JOIN fisco_lots ON fisco_disposals.lot_id = fisco_lots.id
      `, [backupId]);

      await client.query("COMMIT");
      return backupId;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  // ============================================================
  // Step 2: Fetch & Normalize
  // ============================================================

  async fetchAndNormalize(
    exchangeFilter: string | null | undefined,
    fullSync = true
  ): Promise<NormalizedOperation[]> {
    const doKraken = !exchangeFilter || exchangeFilter === "kraken";
    const doRevolut = !exchangeFilter || exchangeFilter === "revolutx";

    let krakenOps: NormalizedOperation[] = [];
    let revolutOps: NormalizedOperation[] = [];

    if (doKraken) {
      try {
        const ledgerResp = await krakenService.getLedgers({ fetchAll: fullSync });
        const ledgerMap = ledgerResp?.ledger || {};
        const ledgerEntries = Object.entries(ledgerMap).map(([id, e]: [string, any]) => ({
          id,
          refid: e.refid,
          type: e.type,
          subtype: e.subtype ?? "",
          asset: e.asset,
          amount: parseFloat(e.amount),
          fee: parseFloat(e.fee),
          balance: parseFloat(e.balance),
          time: e.time,
        }));
        krakenOps = await normalizeKrakenLedger(ledgerEntries);
        console.log(`[fisco/rebuild] Kraken: ${ledgerEntries.length} entries → ${krakenOps.length} ops`);
      } catch (e: any) {
        console.error(`[fisco/rebuild] Kraken fetch failed: ${e.message}`);
        throw new Error(`Error fetching Kraken data: ${e.message}`);
      }
    }

    if (doRevolut) {
      try {
        const orders = await revolutXService.getHistoricalOrders({ states: ["filled"] });
        revolutOps = await normalizeRevolutXOrders(orders);
        console.log(`[fisco/rebuild] RevolutX: ${orders.length} orders → ${revolutOps.length} ops`);
      } catch (e: any) {
        console.warn(`[fisco/rebuild] RevolutX fetch failed (non-fatal): ${e.message}`);
      }
    }

    return mergeAndSort(krakenOps, revolutOps);
  }

  // ============================================================
  // Step 4: Save to staging tables
  // ============================================================

  async saveToDryRun(
    runId: string,
    operations: NormalizedOperation[],
    fifo: FifoResult
  ): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Clear previous staging data for this run
      await client.query("DELETE FROM fisco_staging_disposals WHERE rebuild_run_id = $1", [runId]);
      await client.query("DELETE FROM fisco_staging_lots WHERE rebuild_run_id = $1", [runId]);
      await client.query("DELETE FROM fisco_staging_operations WHERE rebuild_run_id = $1", [runId]);
      await client.query("DELETE FROM fisco_staging_summary WHERE rebuild_run_id = $1", [runId]);

      // Insert operations → build idx→stagingId map
      const opIdMap = new Map<number, number>();
      for (let i = 0; i < operations.length; i++) {
        const op = operations[i];
        const r = await client.query(
          `INSERT INTO fisco_staging_operations
           (exchange, external_id, op_type, asset, amount, price_eur, total_eur, fee_eur,
            counter_asset, pair, executed_at, raw_data, requires_eur_price, rebuild_run_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           ON CONFLICT (exchange, external_id, rebuild_run_id) DO NOTHING
           RETURNING id`,
          [op.exchange, op.externalId, op.opType, op.asset,
           op.amount.toString(), op.priceEur?.toString() ?? null,
           op.totalEur?.toString() ?? null, op.feeEur.toString(),
           op.counterAsset, op.pair, op.executedAt.toISOString(),
           JSON.stringify(op.rawData), op.requiresEurPrice ?? false, runId]
        );
        if (r.rows[0]) opIdMap.set(i, r.rows[0].id);
      }

      // Insert lots → build lot.id → stagingLotId map
      const lotIdMap = new Map<string, number>();
      for (const lot of fifo.lots) {
        const opDbId = opIdMap.get(lot.operationIdx);
        if (!opDbId) continue;
        const r = await client.query(
          `INSERT INTO fisco_staging_lots
           (operation_id, asset, quantity, remaining_qty, cost_eur, unit_cost_eur,
            fee_eur, acquired_at, is_closed, rebuild_run_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [opDbId, lot.asset, lot.quantity.toString(), lot.remainingQty.toString(),
           lot.costEur.toString(), lot.unitCostEur.toString(), lot.feeEur.toString(),
           lot.acquiredAt.toISOString(), lot.isClosed, runId]
        );
        if (r.rows[0]) lotIdMap.set(lot.id, r.rows[0].id);
      }

      // Insert disposals
      for (const d of fifo.disposals) {
        const sellOpDbId = opIdMap.get(d.sellOperationIdx);
        if (!sellOpDbId) continue;
        const stagingLotId = d.lotId !== "UNKNOWN_BASIS" ? lotIdMap.get(d.lotId) : null;
        await client.query(
          `INSERT INTO fisco_staging_disposals
           (sell_operation_id, lot_id_str, asset, quantity, proceeds_eur,
            cost_basis_eur, gain_loss_eur, disposed_at, rebuild_run_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [sellOpDbId, stagingLotId?.toString() ?? d.lotId,
           d.asset, d.quantity.toString(), d.proceedsEur.toString(),
           d.costBasisEur.toString(), d.gainLossEur.toString(),
           d.disposedAt.toISOString(), runId]
        );
      }

      // Insert summaries
      for (const s of fifo.yearSummary) {
        await client.query(
          `INSERT INTO fisco_staging_summary
           (fiscal_year, asset, total_acquisitions, total_disposals, total_cost_basis_eur,
            total_proceeds_eur, total_gain_loss_eur, total_fees_eur, rebuild_run_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [s.year, s.asset, s.acquisitions, s.disposals,
           s.costBasisEur, s.proceedsEur, s.gainLossEur, s.feesEur, runId]
        );
      }

      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  // ============================================================
  // Step 6: Compare staging vs official
  // ============================================================

  async compareWithOfficial(runId: string): Promise<ComparisonSummary> {
    const prev = await pool.query(`
      SELECT op_type, asset, COUNT(*) as cnt, SUM(total_eur) as total_eur
      FROM fisco_operations GROUP BY op_type, asset
    `);
    const next = await pool.query(`
      SELECT op_type, asset, COUNT(*) as cnt, SUM(total_eur) as total_eur
      FROM fisco_staging_operations WHERE rebuild_run_id = $1
      GROUP BY op_type, asset
    `, [runId]);

    const prevCount = prev.rows.reduce((s: number, r: any) => s + parseInt(r.cnt), 0);
    const nextCount = next.rows.reduce((s: number, r: any) => s + parseInt(r.cnt), 0);

    const prevByAsset: Record<string, number> = {};
    const nextByAsset: Record<string, number> = {};
    for (const r of prev.rows) {
      prevByAsset[r.asset] = (prevByAsset[r.asset] || 0) + parseInt(r.cnt);
    }
    for (const r of next.rows) {
      nextByAsset[r.asset] = (nextByAsset[r.asset] || 0) + parseInt(r.cnt);
    }

    const addedByAsset: Record<string, number> = {};
    const removedByAsset: Record<string, number> = {};
    const allAssets = new Set([...Object.keys(prevByAsset), ...Object.keys(nextByAsset)]);
    for (const asset of allAssets) {
      const diff = (nextByAsset[asset] || 0) - (prevByAsset[asset] || 0);
      if (diff > 0) addedByAsset[asset] = diff;
      else if (diff < 0) removedByAsset[asset] = Math.abs(diff);
    }

    // Year summary comparison
    const prevGl = await pool.query(
      `SELECT fiscal_year, SUM(total_gain_loss_eur) as gl FROM fisco_summary GROUP BY fiscal_year`
    );
    const nextGl = await pool.query(
      `SELECT fiscal_year, SUM(total_gain_loss_eur) as gl FROM fisco_staging_summary
       WHERE rebuild_run_id = $1 GROUP BY fiscal_year`, [runId]
    );

    const prevGainLoss: Record<number, number> = {};
    const newGainLoss: Record<number, number> = {};
    for (const r of prevGl.rows) prevGainLoss[parseInt(r.fiscal_year)] = parseFloat(r.gl || 0);
    for (const r of nextGl.rows) newGainLoss[parseInt(r.fiscal_year)] = parseFloat(r.gl || 0);

    return {
      previousOperationsCount: prevCount,
      newOperationsCount: nextCount,
      addedOperations: Math.max(0, nextCount - prevCount),
      removedOperations: Math.max(0, prevCount - nextCount),
      addedByAsset, removedByAsset,
      previousGainLossEur: prevGainLoss,
      newGainLossEur: newGainLoss,
    };
  }

  // ============================================================
  // Step 7: Commit staging → official (atomic)
  // ============================================================

  async commitToOfficial(runId: string, backupId: string | null): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Clear official tables
      await client.query("DELETE FROM fisco_disposals");
      await client.query("DELETE FROM fisco_lots");
      await client.query("DELETE FROM fisco_operations");
      await client.query("DELETE FROM fisco_summary");

      // Copy staging operations → official
      const opsR = await client.query(`
        INSERT INTO fisco_operations
          (exchange, external_id, op_type, asset, amount, price_eur, total_eur,
           fee_eur, counter_asset, pair, executed_at, raw_data)
        SELECT exchange, external_id, op_type, asset, amount, price_eur, total_eur,
               fee_eur, counter_asset, pair, executed_at, raw_data
        FROM fisco_staging_operations
        WHERE rebuild_run_id = $1
        RETURNING id, external_id, exchange
      `, [runId]);

      // Build staging_id → official_id map via external_id
      const stagingOpsR = await client.query(`
        SELECT id, exchange, external_id FROM fisco_staging_operations WHERE rebuild_run_id = $1
      `, [runId]);

      const extIdToOfficialId = new Map<string, number>();
      for (const r of opsR.rows) {
        extIdToOfficialId.set(`${r.exchange}:${r.external_id}`, parseInt(r.id));
      }
      const stagingIdToOfficialId = new Map<number, number>();
      for (const r of stagingOpsR.rows) {
        const officialId = extIdToOfficialId.get(`${r.exchange}:${r.external_id}`);
        if (officialId) stagingIdToOfficialId.set(parseInt(r.id), officialId);
      }

      // Copy lots
      const stagingLots = await client.query(`
        SELECT * FROM fisco_staging_lots WHERE rebuild_run_id = $1 ORDER BY id
      `, [runId]);

      const stagingLotIdToOfficialId = new Map<number, number>();
      for (const lot of stagingLots.rows) {
        const officialOpId = stagingIdToOfficialId.get(parseInt(lot.operation_id));
        if (!officialOpId) continue;
        const r = await client.query(`
          INSERT INTO fisco_lots
            (operation_id, asset, quantity, remaining_qty, cost_eur, unit_cost_eur,
             fee_eur, acquired_at, is_closed)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id
        `, [officialOpId, lot.asset, lot.quantity, lot.remaining_qty,
            lot.cost_eur, lot.unit_cost_eur, lot.fee_eur, lot.acquired_at, lot.is_closed]);
        if (r.rows[0]) stagingLotIdToOfficialId.set(parseInt(lot.id), parseInt(r.rows[0].id));
      }

      // Copy disposals
      const stagingDisp = await client.query(`
        SELECT * FROM fisco_staging_disposals WHERE rebuild_run_id = $1
      `, [runId]);

      for (const d of stagingDisp.rows) {
        const officialSellOpId = stagingIdToOfficialId.get(parseInt(d.sell_operation_id));
        if (!officialSellOpId) continue;
        const lotIdStr = d.lot_id_str;
        const officialLotId = lotIdStr && !isNaN(parseInt(lotIdStr))
          ? stagingLotIdToOfficialId.get(parseInt(lotIdStr)) ?? null
          : null;
        await client.query(`
          INSERT INTO fisco_disposals
            (sell_operation_id, lot_id, quantity, proceeds_eur, cost_basis_eur,
             gain_loss_eur, disposed_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7)
        `, [officialSellOpId, officialLotId, d.quantity,
            d.proceeds_eur, d.cost_basis_eur, d.gain_loss_eur, d.disposed_at]);
      }

      // Copy summaries
      await client.query(`
        INSERT INTO fisco_summary
          (fiscal_year, asset, total_acquisitions, total_disposals, total_cost_basis_eur,
           total_proceeds_eur, total_gain_loss_eur, total_fees_eur)
        SELECT fiscal_year, asset, total_acquisitions, total_disposals, total_cost_basis_eur,
               total_proceeds_eur, total_gain_loss_eur, total_fees_eur
        FROM fisco_staging_summary
        WHERE rebuild_run_id = $1
      `, [runId]);

      await client.query("COMMIT");
      console.log(`[fisco/rebuild] Committed runId=${runId} to official tables`);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  // ============================================================
  // Step 8: Reconciliation
  // ============================================================

  async runReconciliation(rebuildRunId: string): Promise<string> {
    const reconId = randomUUID();

    const discrepancies: Array<{
      item_type: string; exchange?: string; external_id?: string;
      asset?: string; expected_value?: number; actual_value?: number;
      diff_value?: number; detail: string; severity: string;
    }> = [];

    // Check for UNKNOWN_BASIS disposals in official tables
    const unknownBasis = await pool.query(`
      SELECT d.asset, COUNT(*) as cnt, SUM(d.quantity) as total_qty
      FROM fisco_disposals d
      WHERE d.lot_id IS NULL
      GROUP BY d.asset
    `);
    for (const r of unknownBasis.rows) {
      discrepancies.push({
        item_type: "unknown_basis",
        asset: r.asset,
        actual_value: parseFloat(r.total_qty),
        detail: `${r.cnt} disposals sin base de coste para ${r.asset} (total: ${parseFloat(r.total_qty).toFixed(8)})`,
        severity: "critical",
      });
    }

    // Check for negative balances per asset
    const balances = await pool.query(`
      SELECT asset,
        COALESCE((SELECT SUM(quantity) FROM fisco_lots WHERE asset = fo.asset), 0) -
        COALESCE((SELECT SUM(quantity) FROM fisco_disposals fd
                  JOIN fisco_operations fop ON fd.sell_operation_id = fop.id
                  WHERE fop.asset = fo.asset), 0) AS balance
      FROM (SELECT DISTINCT asset FROM fisco_operations WHERE op_type IN ('trade_buy','trade_sell')) fo
    `);
    for (const r of balances.rows) {
      const bal = parseFloat(r.balance);
      if (bal < -0.000001) {
        discrepancies.push({
          item_type: "negative_balance",
          asset: r.asset,
          actual_value: bal,
          detail: `Balance negativo de ${r.asset}: ${bal.toFixed(8)}`,
          severity: "critical",
        });
      }
    }

    // Get year ranges
    const yearRange = await pool.query(
      `SELECT MIN(EXTRACT(YEAR FROM executed_at))::int AS min_yr,
              MAX(EXTRACT(YEAR FROM executed_at))::int AS max_yr
       FROM fisco_operations`
    );
    const yearFrom = yearRange.rows[0]?.min_yr ?? null;
    const yearTo = yearRange.rows[0]?.max_yr ?? null;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(`
        INSERT INTO fisco_reconciliation_runs
          (id, rebuild_run_id, year_from, year_to, total_operations_checked,
           discrepancies_found, status, summary_json)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      `, [
        reconId, rebuildRunId, yearFrom, yearTo,
        (await pool.query(`SELECT COUNT(*) FROM fisco_operations`)).rows[0].count,
        discrepancies.length,
        discrepancies.some(d => d.severity === "critical") ? "critical" : "ok",
        JSON.stringify({ discrepancies }),
      ]);

      for (const d of discrepancies) {
        await client.query(`
          INSERT INTO fisco_reconciliation_items
            (run_id, item_type, exchange, external_id, asset, expected_value,
             actual_value, diff_value, detail, severity)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        `, [reconId, d.item_type, d.exchange ?? null, d.external_id ?? null,
            d.asset ?? null, d.expected_value ?? null, d.actual_value ?? null,
            d.diff_value ?? null, d.detail, d.severity]);
      }

      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    return reconId;
  }

  // ============================================================
  // Get list of rebuild runs
  // ============================================================

  async getRebuildRuns(limit = 20): Promise<any[]> {
    const r = await pool.query(
      `SELECT * FROM fisco_rebuild_runs ORDER BY started_at DESC LIMIT $1`, [limit]
    );
    return r.rows;
  }

  async getRebuildRunById(runId: string): Promise<any | null> {
    const r = await pool.query(
      `SELECT * FROM fisco_rebuild_runs WHERE id = $1`, [runId]
    );
    return r.rows[0] ?? null;
  }

  async getLatestReconciliation(): Promise<any | null> {
    const r = await pool.query(
      `SELECT rr.*, rr2.discrepancies_found
       FROM fisco_reconciliation_runs rr
       LEFT JOIN fisco_reconciliation_runs rr2 ON rr.id = rr2.id
       ORDER BY rr.reconciled_at DESC LIMIT 1`
    );
    return r.rows[0] ?? null;
  }

  // ============================================================
  // DB helpers
  // ============================================================

  private async createRun(
    runId: string, mode: string, triggeredBy: string, exchangeFilter: string | null
  ): Promise<void> {
    await pool.query(
      `INSERT INTO fisco_rebuild_runs (id, mode, triggered_by, exchange_filter, status)
       VALUES ($1,$2,$3,$4,'running')`,
      [runId, mode, triggeredBy, exchangeFilter]
    );
  }

  private async updateRun(runId: string, fields: Record<string, any>): Promise<void> {
    const keys = Object.keys(fields);
    if (keys.length === 0) return;
    const setClauses = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
    const values = keys.map(k => fields[k]);
    await pool.query(
      `UPDATE fisco_rebuild_runs SET ${setClauses} WHERE id = $1`,
      [runId, ...values]
    );
  }
}

export const fiscoRebuildService = FiscoRebuildService.getInstance();
