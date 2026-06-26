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
import { setFiscoRebuildMode } from "./fisco/rebuild-state";
import { fiscoControlStatusService } from "./fisco/FiscoControlStatusService";

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

    setFiscoRebuildMode(true);
    let backupId: string | null = null;

    try {
      // Step 1: Backup current official tables
      backupId = await this.backup(runId);
      console.log(`[fisco/rebuild] Backup complete: ${backupId}`);

      // Step 2: Fetch and normalize
      const { ops, partialWarnings, fetchStats } = await this.fetchAndNormalize(exchangeFilter, fullSync);
      console.log(`[fisco/rebuild] Normalized ${ops.length} operations`);

      // Step 3: FIFO
      const fifo = runFifo(ops);
      // Inject partial-history warnings before validation
      fifo.warnings.push(...partialWarnings);
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
        fetch_stats_json: JSON.stringify(fetchStats),
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

        // Step 9: Record result history per fiscal year
        const gainsByYear = new Map<number, { gains: number; losses: number; net: number; disposals: number }>();
        for (const disp of fifo.disposals) {
          const dispYear = new Date(disp.disposedAt).getFullYear();
          const entry = gainsByYear.get(dispYear) ?? { gains: 0, losses: 0, net: 0, disposals: 0 };
          entry.net += disp.gainLossEur;
          if (disp.gainLossEur > 0) entry.gains += disp.gainLossEur;
          else entry.losses += disp.gainLossEur;
          entry.disposals++;
          gainsByYear.set(dispYear, entry);
        }
        for (const [fy, data] of gainsByYear) {
          const hash = await fiscoControlStatusService.computeOperationSetHash(fy);
          await fiscoControlStatusService.recordResultHistory({
            fiscal_year: fy,
            run_id: runId,
            mode: "commit",
            status: "committed",
            operations_count: ops.length,
            lots_count: fifo.lots.length,
            disposals_count: data.disposals,
            gains_eur: data.gains,
            losses_eur: data.losses,
            net_gain_loss_eur: data.net,
            operation_set_hash: hash,
          });
          console.log(`[fisco/rebuild] Result history recorded for year=${fy} net=${data.net.toFixed(2)}€ hash=${hash}`);
        }
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
      setFiscoRebuildMode(false);
      const _errDetail = err?.message || "Unknown error";
      const _errStack  = err?.stack   || null;
      await this.updateRun(runId, {
        status: "failed",
        completed_at: new Date().toISOString(),
        notes: _errDetail,
        errors_json: JSON.stringify([{
          code:    "COMMIT_EXCEPTION",
          phase:   mode,
          message: _errDetail,
          stack:   _errStack,
          detail:  String(err),
        }]),
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
    } finally {
      setFiscoRebuildMode(false);
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
        SELECT
          $1,
          fd.id,
          fd.sell_operation_id,
          COALESCE(fd.lot_id::text, 'UNKNOWN_BASIS') AS lot_id_str,
          fo.asset,
          fd.quantity,
          fd.proceeds_eur,
          fd.cost_basis_eur,
          fd.gain_loss_eur,
          fd.disposed_at
        FROM fisco_disposals fd
        JOIN fisco_operations fo ON fo.id = fd.sell_operation_id
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
  ): Promise<{
    ops: NormalizedOperation[];
    partialWarnings: string[];
    fetchStats: Record<string, any>;
  }> {
    const doKraken = !exchangeFilter || exchangeFilter === "kraken";
    const doRevolut = !exchangeFilter || exchangeFilter === "revolutx";

    let krakenOps: NormalizedOperation[] = [];
    let revolutOps: NormalizedOperation[] = [];
    const fetchStats: Record<string, any> = {};

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

        // Kraken stats — using raw ledger time (Unix seconds)
        const times = ledgerEntries.map(e => e.time).filter(Boolean);
        fetchStats.krakenLedgerCount = ledgerEntries.length;
        fetchStats.krakenOpCount = krakenOps.length;
        fetchStats.krakenFirstLedgerDate = times.length ? new Date(Math.min(...times) * 1000).toISOString() : null;
        fetchStats.krakenLastLedgerDate = times.length ? new Date(Math.max(...times) * 1000).toISOString() : null;
        fetchStats.krakenFullSync = fullSync;
      } catch (e: any) {
        const isRL = e.message?.includes("Rate limit") || e.stage === "kraken_ledger_pagination";
        const detail = {
          stage: e.stage ?? "kraken_ledger_pagination",
          offset: e.offset ?? null,
          retries: e.retries ?? null,
          lastError: e.lastError ?? e.message,
          hint: isRL
            ? "Kraken rate limit during private ledger fetch — retry will happen automatically next time"
            : "Kraken API error during ledger pagination",
        };
        console.error(`[fisco/rebuild] Kraken fetch failed:`, JSON.stringify(detail));
        throw Object.assign(new Error(`Error fetching Kraken data: ${JSON.stringify(detail)}`), detail);
      }
    }

    const partialWarnings: string[] = [];

    if (doRevolut) {
      try {
        // For fullSync, always start from Revolut crypto launch era (2020-01-01)
        const revolutStartMs = fullSync ? new Date('2020-01-01T00:00:00Z').getTime() : undefined;
        const result = await revolutXService.getHistoricalOrders({
          states: ["filled"],
          startMs: revolutStartMs,
        });
        revolutOps = await normalizeRevolutXOrders(result.orders);
        console.log(`[fisco/rebuild] RevolutX: ${result.orders.length} orders → ${revolutOps.length} ops`);

        // RevolutX stats
        const rdates = result.orders.map(o => o.filled_date || o.created_date).filter(Boolean);
        fetchStats.revolutOrderCount = result.orders.length;
        fetchStats.revolutOpCount = revolutOps.length;
        fetchStats.revolutFirstOrderDate = rdates.length ? new Date(Math.min(...rdates)).toISOString() : null;
        fetchStats.revolutLastOrderDate = rdates.length ? new Date(Math.max(...rdates)).toISOString() : null;
        fetchStats.revolutCompletedWindows = result.completedWindows;
        fetchStats.revolutSkippedWindows = result.skippedWindows.length;
        fetchStats.revolutSkippedWindowsList = result.skippedWindows;
        fetchStats.revolutStartMs = revolutStartMs ?? new Date('2020-01-01T00:00:00Z').getTime();
        fetchStats.revolutPartialHistory = result.partialHistory;

        if (result.partialHistory) {
          const w = `REVOLUT_PARTIAL_HISTORY: ${result.skippedWindows.length} ventana(s) fallidas: ${result.skippedWindows.join('; ')}`;
          console.warn(`[fisco/rebuild] ${w}`);
          partialWarnings.push(w);
        }
      } catch (e: any) {
        console.warn(`[fisco/rebuild] RevolutX fetch failed (non-fatal): ${e.message}`);
        fetchStats.revolutError = e.message;
      }
    }

    // ── Opening balances (saldo inicial fiscal) — synthetic trade_buy ops ──
    let openingOps: NormalizedOperation[] = [];
    try {
      const obRows = await pool.query(
        `SELECT * FROM fisco_opening_balances WHERE is_active = TRUE ORDER BY acquisition_date ASC`
      );
      if (!(!exchangeFilter || exchangeFilter === null) && exchangeFilter) {
        // If exchange-filtered, don't inject opening balances
      } else {
        openingOps = obRows.rows.map((row: any) => {
          const qty = parseFloat(row.quantity);
          const cost = parseFloat(row.cost_basis_eur);
          return {
            exchange: row.exchange ?? 'manual',
            externalId: `opening_balance_${row.id}`,
            opType: 'trade_buy' as const,
            asset: row.asset,
            amount: qty,
            priceEur: qty > 0 ? cost / qty : 0,
            totalEur: cost,
            feeEur: 0,
            counterAsset: 'EUR',
            pair: `${row.asset}/EUR`,
            executedAt: new Date(row.acquisition_date),
            rawData: { source: 'opening_balance', note: row.note },
            requiresEurPrice: false,
          };
        });
        if (openingOps.length > 0) {
          console.log(`[fisco/rebuild] Opening balances: ${openingOps.length} synthetic BUY ops injected`);
          fetchStats.openingBalancesCount = openingOps.length;
        }
      }
    } catch (e: any) {
      console.warn(`[fisco/rebuild] Could not load opening balances: ${e.message}`);
    }

    return { ops: mergeAndSort(krakenOps, revolutOps, openingOps), partialWarnings, fetchStats };
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
  // CRITICAL: Handles FK constraints from fisco_external_statement_items
  // and fisco_transfer_links by preserving → detaching → rebuilding → reattaching
  // ============================================================

  async commitToOfficial(runId: string, backupId: string | null): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // ─────────────────────────────────────────────────────────────────
      // PHASE 1: Preserve external references before any DELETE
      // ─────────────────────────────────────────────────────────────────

      // 1a. Preserve statement items with matched operations
      const statementItemsRes = await client.query(`
        SELECT
          esi.id as statement_item_id,
          esi.matched_operation_id,
          fo.exchange,
          fo.external_id,
          fo.op_type,
          fo.asset,
          fo.amount,
          fo.executed_at,
          esi.transaction_identifier
        FROM fisco_external_statement_items esi
        JOIN fisco_operations fo ON fo.id = esi.matched_operation_id
        WHERE esi.matched_operation_id IS NOT NULL
      `);

      // 1b. Preserve transfer links with operation references
      const transferLinksRes = await client.query(`
        SELECT
          ftl.id as link_id,
          ftl.from_operation_id,
          ftl.to_operation_id,
          fo_from.exchange as from_exchange,
          fo_from.external_id as from_external_id,
          fo_to.exchange as to_exchange,
          fo_to.external_id as to_external_id
        FROM fisco_transfer_links ftl
        LEFT JOIN fisco_operations fo_from ON fo_from.id = ftl.from_operation_id
        LEFT JOIN fisco_operations fo_to ON fo_to.id = ftl.to_operation_id
        WHERE ftl.from_operation_id IS NOT NULL OR ftl.to_operation_id IS NOT NULL
      `);

      const preservedStatementItems = statementItemsRes.rows;
      const preservedTransferLinks = transferLinksRes.rows;

      console.log(`[fisco/rebuild/commit] Preserved ${preservedStatementItems.length} statement item links, ${preservedTransferLinks.length} transfer links`);

      // ─────────────────────────────────────────────────────────────────
      // PHASE 2: Detach external references (set FKs to NULL)
      // ─────────────────────────────────────────────────────────────────

      // Detach statement items
      await client.query(`
        UPDATE fisco_external_statement_items
        SET matched_operation_id = NULL
        WHERE matched_operation_id IS NOT NULL
      `);

      // Detach transfer links
      await client.query(`
        UPDATE fisco_transfer_links
        SET from_operation_id = NULL, to_operation_id = NULL
        WHERE from_operation_id IS NOT NULL OR to_operation_id IS NOT NULL
      `);

      console.log(`[fisco/rebuild/commit] Detached external references`);

      // ─────────────────────────────────────────────────────────────────
      // PHASE 3: Clear and rebuild official tables
      // ─────────────────────────────────────────────────────────────────

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

      // Build exchange:external_id → official_id map for reattachment
      const extIdToOfficialId = new Map<string, number>();
      for (const r of opsR.rows) {
        extIdToOfficialId.set(`${r.exchange}:${r.external_id}`, parseInt(r.id));
      }

      // Build staging_id → official_id map via external_id
      const stagingOpsR = await client.query(`
        SELECT id, exchange, external_id FROM fisco_staging_operations WHERE rebuild_run_id = $1
      `, [runId]);

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

      // ─────────────────────────────────────────────────────────────────
      // PHASE 4: Reattach external references
      // ─────────────────────────────────────────────────────────────────

      const reattachmentWarnings: string[] = [];
      let reattachedStatementItems = 0;
      let failedStatementItems = 0;

      // Reattach statement items by exchange:external_id
      for (const item of preservedStatementItems) {
        const key = `${item.exchange}:${item.external_id}`;
        const newOpId = extIdToOfficialId.get(key);

        if (newOpId) {
          await client.query(`
            UPDATE fisco_external_statement_items
            SET matched_operation_id = $1
            WHERE id = $2
          `, [newOpId, item.statement_item_id]);
          reattachedStatementItems++;
        } else {
          failedStatementItems++;
          reattachmentWarnings.push(
            `Statement item ${item.statement_item_id} (tx: ${item.transaction_identifier || 'N/A'}) ` +
            `could not be reattached: operation ${item.exchange}:${item.external_id} not found in new dataset`
          );
        }
      }

      let reattachedTransferLinks = 0;
      let failedTransferLinks = 0;

      // Reattach transfer links by exchange:external_id
      for (const link of preservedTransferLinks) {
        let newFromOpId: number | null = null;
        let newToOpId: number | null = null;

        if (link.from_exchange && link.from_external_id) {
          newFromOpId = extIdToOfficialId.get(`${link.from_exchange}:${link.from_external_id}`) ?? null;
        }
        if (link.to_exchange && link.to_external_id) {
          newToOpId = extIdToOfficialId.get(`${link.to_exchange}:${link.to_external_id}`) ?? null;
        }

        // Only update if at least one side can be reattached
        if (newFromOpId !== null || newToOpId !== null || (link.from_operation_id === null && link.to_operation_id === null)) {
          await client.query(`
            UPDATE fisco_transfer_links
            SET from_operation_id = $1, to_operation_id = $2
            WHERE id = $3
          `, [newFromOpId, newToOpId, link.link_id]);

          if ((link.from_operation_id && newFromOpId) || (link.to_operation_id && newToOpId)) {
            reattachedTransferLinks++;
          }
          if ((link.from_operation_id && !newFromOpId) || (link.to_operation_id && !newToOpId)) {
            failedTransferLinks++;
          }
        }

        if (link.from_operation_id && !newFromOpId) {
          reattachmentWarnings.push(
            `Transfer link ${link.link_id} lost from_operation reference: ${link.from_exchange}:${link.from_external_id} not found`
          );
        }
        if (link.to_operation_id && !newToOpId) {
          reattachmentWarnings.push(
            `Transfer link ${link.link_id} lost to_operation reference: ${link.to_exchange}:${link.to_external_id} not found`
          );
        }
      }

      console.log(`[fisco/rebuild/commit] Reattached ${reattachedStatementItems} statement items, ${reattachedTransferLinks} transfer links`);

      if (reattachmentWarnings.length > 0) {
        console.warn(`[fisco/rebuild/commit] ${reattachmentWarnings.length} reattachment warnings:`, reattachmentWarnings);
        // Store warnings in the rebuild run record for visibility
        await client.query(`
          UPDATE fisco_rebuild_runs
          SET warnings_json = COALESCE(warnings_json::jsonb, '[]'::jsonb) || $1::jsonb
          WHERE id = $2
        `, [JSON.stringify(reattachmentWarnings.map(w => ({ code: "REATTACHMENT_WARNING", detail: w }))), runId]);
      }

      // ─────────────────────────────────────────────────────────────────
      // PHASE 5: Log final external reference status
      // ─────────────────────────────────────────────────────────────────

      // Note: We don't fail the commit for orphaned items, but we log them clearly
      console.log(`[fisco/rebuild/commit] External reference status: ${reattachedStatementItems} reattached, ${failedStatementItems} failed (previously matched statement items that lost their operation in new dataset)`);

      await client.query("COMMIT");
      console.log(`[fisco/rebuild] Committed runId=${runId} to official tables with ${reattachmentWarnings.length} reattachment warnings`);
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
      SELECT fo.asset, COUNT(*) as cnt, SUM(d.quantity) as total_qty
      FROM fisco_disposals d
      JOIN fisco_operations fo ON fo.id = d.sell_operation_id
      WHERE d.lot_id IS NULL
      GROUP BY fo.asset
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

    // Check for stablecoin lots with anomalous cost basis (USDC/USDT should be ~0.70-1.20 EUR/unit)
    const stablecoinAnomalyQ = await pool.query(`
      SELECT fl.id AS lot_id, fl.asset,
             fl.quantity::numeric, fl.unit_cost_eur::numeric,
             fo.exchange, fo.op_type, fo.executed_at
      FROM fisco_lots fl
      JOIN fisco_operations fo ON fo.id = fl.operation_id
      WHERE fl.asset IN ('USDC','USDT')
        AND fl.unit_cost_eur IS NOT NULL
        AND fl.quantity > 0
        AND (fl.unit_cost_eur::numeric < 0.70 OR fl.unit_cost_eur::numeric > 1.20)
    `);
    for (const r of stablecoinAnomalyQ.rows) {
      discrepancies.push({
        item_type: "stablecoin_cost_basis_anomaly",
        asset: r.asset,
        exchange: r.exchange,
        actual_value: parseFloat(r.unit_cost_eur),
        detail: `Lote ${r.lot_id} ${r.asset} (${r.exchange}/${r.op_type} ${new Date(r.executed_at).toISOString().split('T')[0]}): unit_cost_eur=${parseFloat(r.unit_cost_eur).toFixed(4)} fuera de rango 0.70-1.20`,
        severity: "critical",
      });
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

  /**
   * Watchdog: mark rebuild runs that have been stuck in 'running' for > 15 minutes.
   * Returns the count of runs marked as failed_stale.
   */
  async markStaleRebuildRuns(): Promise<number> {
    const result = await pool.query(`
      UPDATE fisco_rebuild_runs
      SET
        status       = 'failed_stale',
        completed_at = NOW(),
        errors_json  = jsonb_build_array(
          jsonb_build_object(
            'code',    'STALE_REBUILD_TIMEOUT',
            'phase',   'unknown',
            'message', 'Rebuild run exceeded 15-minute timeout without completing',
            'detail',  CONCAT('started_at=', started_at::text)
          )
        )
      WHERE status = 'running'
        AND started_at < NOW() - INTERVAL '15 minutes'
      RETURNING id
    `);
    const count = result.rowCount ?? 0;
    if (count > 0) {
      console.warn(`[fisco/rebuild] Watchdog: marked ${count} stale rebuild run(s) as failed_stale`);
    }
    return count;
  }
}

export const fiscoRebuildService = FiscoRebuildService.getInstance();
