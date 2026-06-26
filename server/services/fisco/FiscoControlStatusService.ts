/**
 * FiscoControlStatusService — Servicio central de control fiscal.
 *
 * Consolida en una sola respuesta:
 *  - schema health
 *  - config FISCO
 *  - último import batch / sync
 *  - último rebuild FIFO confirmado
 *  - conteos actuales (operations, lots, disposals, transfer_links)
 *  - última operación por año
 *  - operaciones pendientes por año
 *  - ventas huérfanas por año
 *  - withdrawals review por año
 *  - rewards sin precio por año
 *  - transfer links incompletos
 *  - comparison Legacy vs V2
 *  - finalization status
 *  - resultado oficial actual
 *  - si el resultado está actualizado o desfasado
 *  - huella de datos (operation_set_hash)
 */

import { pool } from "../../db";
import { getFiscoConfig, type FiscoConfig } from "./FiscoConfigService";
import { FiscoPendingDetector, type PendingFiscalChanges } from "./FiscoPendingDetector";
import { createHash } from "crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

export type FiscalResultStatus = "UPDATED" | "OUTDATED" | "BLOCKED" | "NEEDS_REBUILD" | "NEEDS_REVIEW";

export interface DataFingerprint {
  operations_count: number;
  operations_count_scope: string;
  lots_count: number;
  disposals_count: number;
  transfer_links_count: number;
  last_operation_executed_at: string | null;
  last_operation_created_at: string | null;
  operation_set_hash: string;
}

export interface OfficialResult {
  net_gain_loss_eur: number | null;
  gains_eur: number | null;
  losses_eur: number | null;
  disposals_count: number;
  sell_operations_count: number;
  calculated_from_run_id: string | null;
  calculated_at: string | null;
}

export interface SyncStatus {
  kraken_last_sync_at: string | null;
  revolutx_last_sync_at: string | null;
  last_import_batch_at: string | null;
  confirmed_imports_after_last_rebuild: number;
  preview_batches_pending: number;
  sync_errors: string[];
}

export interface ControlStatusResponse {
  year: number;
  fiscal_result_status: FiscalResultStatus;
  report_can_be_finalized: boolean;
  official_engine: string;
  shadow_engine: string;
  official_result: OfficialResult;
  data_fingerprint: DataFingerprint;
  last_committed_run: {
    id: string;
    completed_at: string;
    operations_count: number;
    operations_count_scope: string;
    lots_count: number;
    disposals_count: number;
    operation_set_hash: string | null;
    has_operation_set_hash: boolean;
  } | null;
  pending_changes: PendingFiscalChanges | null;
  blockers: string[];
  warnings: string[];
  required_actions: string[];
  sync_status: SyncStatus;
  schema_healthy: boolean;
  v2_activation_blocked: boolean;
  v2_activation_block_reason: string | null;
  generated_at: string;
}

export interface ResultHistoryEntry {
  id: number;
  fiscal_year: number;
  run_id: string | null;
  mode: string;
  status: string;
  operations_count: number;
  lots_count: number;
  disposals_count: number;
  gains_eur: number;
  losses_eur: number;
  net_gain_loss_eur: number;
  operation_set_hash: string | null;
  previous_net_gain_loss_eur: number | null;
  delta_net_gain_loss_eur: number | null;
  delta_gains_eur: number | null;
  delta_losses_eur: number | null;
  changed_from_previous: boolean;
  explanation: string | null;
  recorded_at: string;
}

export interface ChangeImpactResponse {
  year: number;
  has_changes: boolean;
  previous_result: {
    net_gain_loss_eur: number | null;
    gains_eur: number | null;
    losses_eur: number | null;
    run_id: string | null;
    recorded_at: string | null;
  } | null;
  current_official_result: OfficialResult;
  pending_simulated_result: {
    net_gain_loss_eur: number | null;
    gains_eur: number | null;
    losses_eur: number | null;
    pending_operations_count: number;
  } | null;
  delta: {
    net_gain_loss_eur: number | null;
    gains_eur: number | null;
    losses_eur: number | null;
  } | null;
  new_operations: Array<{
    id: number;
    exchange: string;
    op_type: string;
    asset: string;
    amount: string;
    total_eur: string | null;
    executed_at: string;
    created_at: string;
  }>;
  impact_by_asset: Record<string, { count: number; total_eur: number }>;
  explanation: string;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class FiscoControlStatusService {
  private static instance: FiscoControlStatusService;

  public static getInstance(): FiscoControlStatusService {
    if (!FiscoControlStatusService.instance) {
      FiscoControlStatusService.instance = new FiscoControlStatusService();
    }
    return FiscoControlStatusService.instance;
  }

  /**
   * Compute a deterministic hash for the set of operations in a fiscal year.
   * Hash = sha256(year | count | max(created_at) | max(executed_at) | sum_ids)
   */
  async computeOperationSetHash(year: number): Promise<string> {
    const yearStart = `${year}-01-01`;
    const yearEnd = `${year + 1}-01-01`;

    const result = await pool.query(`
      SELECT
        COUNT(*) as count,
        COALESCE(MAX(created_at)::text, '') as max_created,
        COALESCE(MAX(executed_at)::text, '') as max_executed,
        COALESCE(SUM(id), 0) as sum_ids
      FROM fisco_operations
      WHERE executed_at >= $1::date AND executed_at < $2::date
    `, [yearStart, yearEnd]);

    const row = result.rows[0];
    const payload = `${year}|${row.count}|${row.max_created}|${row.max_executed}|${row.sum_ids}`;
    return createHash("sha256").update(payload).digest("hex").substring(0, 16);
  }

  /**
   * Get current data fingerprint for a year.
   */
  async getDataFingerprint(year: number): Promise<DataFingerprint> {
    const yearStart = `${year}-01-01`;
    const yearEnd = `${year + 1}-01-01`;

    const [opsQ, lotsQ, dispQ, tlQ, lastOpQ] = await Promise.all([
      pool.query(`SELECT COUNT(*) as cnt FROM fisco_operations WHERE executed_at >= $1::date AND executed_at < $2::date`, [yearStart, yearEnd]),
      pool.query(`SELECT COUNT(*) as cnt FROM fisco_lots`),
      pool.query(`SELECT COUNT(*) as cnt FROM fisco_disposals`),
      pool.query(`SELECT COUNT(*) as cnt FROM fisco_transfer_links`),
      pool.query(`SELECT executed_at, created_at FROM fisco_operations WHERE executed_at >= $1::date AND executed_at < $2::date ORDER BY created_at DESC LIMIT 1`, [yearStart, yearEnd]),
    ]);

    const operation_set_hash = await this.computeOperationSetHash(year);

    return {
      operations_count: parseInt(opsQ.rows[0]?.cnt || "0"),
      operations_count_scope: "year",
      lots_count: parseInt(lotsQ.rows[0]?.cnt || "0"),
      disposals_count: parseInt(dispQ.rows[0]?.cnt || "0"),
      transfer_links_count: parseInt(tlQ.rows[0]?.cnt || "0"),
      last_operation_executed_at: lastOpQ.rows[0]?.executed_at?.toISOString() ?? null,
      last_operation_created_at: lastOpQ.rows[0]?.created_at?.toISOString() ?? null,
      operation_set_hash,
    };
  }

  /**
   * Get the official fiscal result for a year from fisco_summary or last committed run.
   */
  async getOfficialResult(year: number): Promise<OfficialResult> {
    const yearStart = `${year}-01-01`;
    const yearEnd = `${year + 1}-01-01`;

    // Get gains/losses from fisco_disposals
    const dispQ = await pool.query(`
      SELECT
        COUNT(*) as disposals_count,
        COALESCE(SUM(CASE WHEN gain_loss_eur > 0 THEN gain_loss_eur ELSE 0 END), 0) as gains_eur,
        COALESCE(SUM(CASE WHEN gain_loss_eur < 0 THEN gain_loss_eur ELSE 0 END), 0) as losses_eur,
        COALESCE(SUM(gain_loss_eur), 0) as net_gain_loss_eur
      FROM fisco_disposals
      WHERE disposed_at >= $1::date AND disposed_at < $2::date
    `, [yearStart, yearEnd]);

    // Count sell operations
    const sellQ = await pool.query(`
      SELECT COUNT(*) as cnt FROM fisco_operations
      WHERE op_type = 'trade_sell' AND executed_at >= $1::date AND executed_at < $2::date
    `, [yearStart, yearEnd]);

    // Get last committed run info — operation_set_hash may not exist if schema not ensured
    let runQ: any;
    try {
      runQ = await pool.query(`
        SELECT id, completed_at, operation_set_hash
        FROM fisco_rebuild_runs
        WHERE mode = 'commit' AND status = 'committed'
        ORDER BY completed_at DESC LIMIT 1
      `);
    } catch (_e: any) {
      // Column operation_set_hash may not exist — query without it
      runQ = await pool.query(`
        SELECT id, completed_at
        FROM fisco_rebuild_runs
        WHERE mode = 'commit' AND status = 'committed'
        ORDER BY completed_at DESC LIMIT 1
      `);
    }

    const row = dispQ.rows[0];
    return {
      net_gain_loss_eur: parseFloat(row?.net_gain_loss_eur ?? "0"),
      gains_eur: parseFloat(row?.gains_eur ?? "0"),
      losses_eur: parseFloat(row?.losses_eur ?? "0"),
      disposals_count: parseInt(row?.disposals_count ?? "0"),
      sell_operations_count: parseInt(sellQ.rows[0]?.cnt ?? "0"),
      calculated_from_run_id: runQ.rows[0]?.id ?? null,
      calculated_at: runQ.rows[0]?.completed_at?.toISOString() ?? null,
    };
  }

  /**
   * Get sync status info.
   */
  async getSyncStatus(lastRebuildAt: Date | null): Promise<SyncStatus> {
    const [krakenQ, revolutxQ, importQ, confirmedQ, previewQ] = await Promise.all([
      pool.query(`SELECT MAX(completed_at) as last_sync FROM fisco_rebuild_runs WHERE mode = 'commit' AND status = 'committed' AND exchange_filter IN ('kraken', NULL)`),
      pool.query(`SELECT MAX(completed_at) as last_sync FROM fisco_rebuild_runs WHERE mode = 'commit' AND status = 'committed' AND exchange_filter IN ('revolutx', NULL)`),
      pool.query(`SELECT MAX(created_at) as last_import FROM fisco_import_batches WHERE status = 'confirmed'`),
      pool.query(`
        SELECT COUNT(*) as cnt FROM fisco_import_batches
        WHERE status = 'confirmed'
          AND ($1::timestamp IS NULL OR confirmed_at > $1::timestamp)
      `, [lastRebuildAt]),
      pool.query(`SELECT COUNT(*) as cnt FROM fisco_import_batches WHERE status = 'preview'`),
    ]);

    // fisco_sync_retry may not exist — query separately with error handling
    let syncErrors: string[] = [];
    try {
      const errorsQ = await pool.query(`SELECT exchange, last_error_msg FROM fisco_sync_retry WHERE status = 'exhausted' LIMIT 10`);
      syncErrors = errorsQ.rows.map((r: any) => `[${r.exchange}] ${r.last_error_msg}`);
    } catch (_e: any) {
      // Table may not exist — skip gracefully
    }

    return {
      kraken_last_sync_at: krakenQ.rows[0]?.last_sync?.toISOString() ?? null,
      revolutx_last_sync_at: revolutxQ.rows[0]?.last_sync?.toISOString() ?? null,
      last_import_batch_at: importQ.rows[0]?.last_import?.toISOString() ?? null,
      confirmed_imports_after_last_rebuild: parseInt(confirmedQ.rows[0]?.cnt ?? "0"),
      preview_batches_pending: parseInt(previewQ.rows[0]?.cnt ?? "0"),
      sync_errors: syncErrors,
    };
  }

  /**
   * Get the full control status for a year.
   */
  async getControlStatus(year: number): Promise<ControlStatusResponse> {
    const config = await getFiscoConfig();
    const fingerprint = await this.getDataFingerprint(year);
    const officialResult = await this.getOfficialResult(year);

    // Last committed run — operation_set_hash may not exist if schema not ensured yet
    let lastRunQ: any;
    try {
      lastRunQ = await pool.query(`
        SELECT id, completed_at, operations_count, lots_count, disposals_count, operation_set_hash
        FROM fisco_rebuild_runs
        WHERE mode = 'commit' AND status = 'committed'
        ORDER BY completed_at DESC LIMIT 1
      `);
    } catch (_e: any) {
      lastRunQ = await pool.query(`
        SELECT id, completed_at, operations_count, lots_count, disposals_count
        FROM fisco_rebuild_runs
        WHERE mode = 'commit' AND status = 'committed'
        ORDER BY completed_at DESC LIMIT 1
      `);
    }
    const lastCommittedRun = lastRunQ.rows[0] ?? null;

    // Pending changes
    const detector = FiscoPendingDetector.getInstance();
    const pendingChanges = await detector.detectPendingFiscalChanges(year);

    // Sync status
    const syncStatus = await this.getSyncStatus(lastCommittedRun?.completed_at ?? null);

    // Schema health
    const schemaTables = ["fisco_operations", "fisco_lots", "fisco_disposals", "fisco_config", "fisco_import_batches", "fisco_transfer_links"];
    let schemaHealthy = true;
    for (const table of schemaTables) {
      const r = await pool.query("SELECT to_regclass($1) as exists", [`public.${table}`]);
      if (r.rows[0].exists === null) schemaHealthy = false;
    }

    // Determine fiscal_result_status (inline checks, avoid calling getFinalizationStatus to prevent duplicate DB queries)
    const blockers: string[] = [];
    const warnings: string[] = [];
    const requiredActions: string[] = [];

    let status: FiscalResultStatus;

    // Check for new operations after last rebuild
    const hasNewOps = pendingChanges.pending_operations_count > 0;
    const hasOrphanSells = pendingChanges.orphan_sells_count > 0;
    const hashChanged = lastCommittedRun?.operation_set_hash && lastCommittedRun.operation_set_hash !== fingerprint.operation_set_hash;
    const confirmedImportsAfterRebuild = syncStatus.confirmed_imports_after_last_rebuild > 0;

    if (!schemaHealthy) {
      status = "BLOCKED";
      blockers.push("SCHEMA_MISSING");
      requiredActions.push("Ejecutar migraciones FISCO pendientes");
    } else if (hasNewOps || confirmedImportsAfterRebuild) {
      status = "NEEDS_REBUILD";
      blockers.push("NEW_OPERATIONS_AFTER_REBUILD");
      blockers.push("RESULT_OUTDATED");
      warnings.push(`Hay ${pendingChanges.pending_operations_count} operaciones nuevas posteriores al último cálculo FIFO. El resultado fiscal puede haber cambiado.`);
      requiredActions.push("Simular reconstrucción FIFO (dry-run) para evaluar impacto");
      requiredActions.push("Confirmar reconstrucción FIFO oficial si no hay blockers críticos");
    } else if (hasOrphanSells) {
      status = "NEEDS_REVIEW";
      blockers.push("ORPHAN_SELLS");
      blockers.push("SELL_WITHOUT_COST_BASIS");
      warnings.push(`Hay ${pendingChanges.orphan_sells_count} ventas sin base de coste. FIFO debe reconstruirse.`);
      requiredActions.push("Revisar ventas huérfanas y reconstruir FIFO");
    } else if (hashChanged) {
      status = "OUTDATED";
      warnings.push("El conjunto de operaciones ha cambiado desde el último cálculo fiscal.");
      requiredActions.push("Reconstruir FIFO para actualizar el resultado oficial");
    } else {
      // Check inventory snapshot for remaining blockers/warnings (inline, avoids duplicate detectPendingFiscalChanges)
      let snapshotBlockers: string[] = [];
      let snapshotWarnings: string[] = [];
      try {
        const snapshotQ = await pool.query(
          "SELECT balance_check FROM fisco_inventory_snapshots WHERE year = $1 ORDER BY generated_at DESC LIMIT 1",
          [year]
        );
        if (snapshotQ.rows.length > 0) {
          const bc = snapshotQ.rows[0].balance_check;
          if (bc?.rewards_without_price?.length > 0) {
            if (config.blockIfRewardWithoutPrice) {
              snapshotBlockers.push(`${bc.rewards_without_price.length} rewards sin precio EUR (bloqueante por config)`);
            } else {
              snapshotWarnings.push(`${bc.rewards_without_price.length} rewards sin precio EUR (no bloqueante)`);
            }
          }
          if (bc?.sells_without_cost_basis?.length > 0 && !hasOrphanSells) {
            if (config.blockIfSellWithoutCostBasis) {
              snapshotBlockers.push(`${bc.sells_without_cost_basis.length} ventas sin base de coste (bloqueante por config)`);
            } else {
              snapshotWarnings.push(`${bc.sells_without_cost_basis.length} ventas sin base de coste (no bloqueante)`);
            }
          }
          // Check for critical issues from balance check
          const criticalIssues = bc?.issues?.filter((i: any) => i.severity === "CRITICAL") || [];
          const warningIssues = bc?.issues?.filter((i: any) => i.severity === "WARNING") || [];
          for (const issue of criticalIssues) {
            snapshotBlockers.push(`[${issue.code}] ${issue.asset}: ${issue.detail}`);
          }
          for (const issue of warningIssues) {
            snapshotWarnings.push(`[${issue.code}] ${issue.asset}: ${issue.detail}`);
          }
          // Suspected duplicate transfers
          if (bc?.suspected_duplicate_transfers?.length > 0) {
            if (config.blockIfTransferMismatch) {
              snapshotBlockers.push(`${bc.suspected_duplicate_transfers.length} withdrawals sin transfer_link (bloqueante por config)`);
            } else {
              snapshotWarnings.push(`${bc.suspected_duplicate_transfers.length} withdrawals sin transfer_link (no bloqueante)`);
            }
          }
        }
      } catch (snapErr: any) {
        // fisco_inventory_snapshots table may not exist yet — skip gracefully
        console.warn("[fisco/control-status] inventory snapshot check skipped:", snapErr.message);
      }

      // Engine mode check
      if (config.fiscoEngineMode === "v2_official" && snapshotBlockers.length > 0) {
        snapshotBlockers.push("No se puede activar v2_official mientras haya blockers. Usa v2_shadow para validar primero.");
      }

      if (snapshotBlockers.length > 0) {
        status = "BLOCKED";
        blockers.push(...snapshotBlockers);
      } else if (snapshotWarnings.length > 0) {
        status = "NEEDS_REVIEW";
        warnings.push(...snapshotWarnings);
        requiredActions.push("Revisar avisos antes de generar el informe");
      } else {
        status = "UPDATED";
      }
    }

    // Check incomplete transfer links
    const incompleteTlQ = await pool.query(`
      SELECT COUNT(*) as cnt FROM fisco_transfer_links
      WHERE status IN ('unmatched', 'manual_review')
    `);
    const incompleteTlCount = parseInt(incompleteTlQ.rows[0]?.cnt ?? "0");
    if (incompleteTlCount > 0) {
      warnings.push(`${incompleteTlCount} transferencias internas sin emparejar`);
      if (config.blockIfTransferMismatch && status === "UPDATED") {
        status = "NEEDS_REVIEW";
      }
    }

    // Determine official_engine: v2_shadow means legacy FIFO is still the official engine
    const officialEngine = config.fiscoEngineMode === "v2_official" ? "v2_official" : "legacy_fifo";

    // Check if last committed run has operation_set_hash
    const hasOperationSetHash = !!lastCommittedRun?.operation_set_hash;
    if (lastCommittedRun && !hasOperationSetHash) {
      warnings.push("El último cálculo confirmado es anterior al sistema de huella. Recalcular FIFO para registrar la huella completa.");
    }

    const reportCanBeFinalized = blockers.length === 0 && status !== "NEEDS_REBUILD" && status !== "BLOCKED";

    return {
      year,
      fiscal_result_status: status,
      report_can_be_finalized: reportCanBeFinalized,
      official_engine: officialEngine,
      shadow_engine: "v2_shadow",
      official_result: officialResult,
      data_fingerprint: fingerprint,
      last_committed_run: lastCommittedRun ? {
        id: lastCommittedRun.id,
        completed_at: lastCommittedRun.completed_at?.toISOString() ?? null,
        operations_count: lastCommittedRun.operations_count,
        operations_count_scope: "global",
        lots_count: lastCommittedRun.lots_count,
        disposals_count: lastCommittedRun.disposals_count,
        operation_set_hash: lastCommittedRun.operation_set_hash ?? null,
        has_operation_set_hash: hasOperationSetHash,
      } : null,
      pending_changes: pendingChanges,
      blockers,
      warnings,
      required_actions: requiredActions,
      sync_status: syncStatus,
      schema_healthy: schemaHealthy,
      v2_activation_blocked: !hasOperationSetHash,
      v2_activation_block_reason: !hasOperationSetHash ? "last_committed_run.operation_set_hash is null — recalcular FIFO antes de activar V2 oficial" : null,
      generated_at: new Date().toISOString(),
    };
  }

  /**
   * Get result history for a year.
   */
  async getResultHistory(year: number): Promise<ResultHistoryEntry[]> {
    const result = await pool.query(`
      SELECT * FROM fisco_result_history
      WHERE fiscal_year = $1
      ORDER BY recorded_at DESC
      LIMIT 50
    `, [year]);

    return result.rows.map((r: any) => ({
      ...r,
      gains_eur: parseFloat(r.gains_eur ?? "0"),
      losses_eur: parseFloat(r.losses_eur ?? "0"),
      net_gain_loss_eur: parseFloat(r.net_gain_loss_eur ?? "0"),
      previous_net_gain_loss_eur: r.previous_net_gain_loss_eur ? parseFloat(r.previous_net_gain_loss_eur) : null,
      delta_net_gain_loss_eur: r.delta_net_gain_loss_eur ? parseFloat(r.delta_net_gain_loss_eur) : null,
      delta_gains_eur: r.delta_gains_eur ? parseFloat(r.delta_gains_eur) : null,
      delta_losses_eur: r.delta_losses_eur ? parseFloat(r.delta_losses_eur) : null,
      recorded_at: r.recorded_at?.toISOString() ?? r.recorded_at,
    }));
  }

  /**
   * Record a result in history after a rebuild.
   */
  async recordResultHistory(entry: {
    fiscal_year: number;
    run_id: string;
    mode: string;
    status: string;
    operations_count: number;
    lots_count: number;
    disposals_count: number;
    gains_eur: number;
    losses_eur: number;
    net_gain_loss_eur: number;
    operation_set_hash: string;
    explanation?: string;
  }): Promise<void> {
    // Get previous result for delta calculation
    const prevQ = await pool.query(`
      SELECT net_gain_loss_eur, gains_eur, losses_eur
      FROM fisco_result_history
      WHERE fiscal_year = $1
      ORDER BY recorded_at DESC LIMIT 1
    `, [entry.fiscal_year]);

    const prev = prevQ.rows[0];
    const prevNet = prev ? parseFloat(prev.net_gain_loss_eur) : null;
    const prevGains = prev ? parseFloat(prev.gains_eur) : null;
    const prevLosses = prev ? parseFloat(prev.losses_eur) : null;

    const deltaNet = prevNet !== null ? entry.net_gain_loss_eur - prevNet : null;
    const deltaGains = prevGains !== null ? entry.gains_eur - prevGains : null;
    const deltaLosses = prevLosses !== null ? entry.losses_eur - prevLosses : null;
    const changed = deltaNet !== null && Math.abs(deltaNet) > 0.001;

    let explanation = entry.explanation ?? null;
    if (changed && deltaNet !== null) {
      const sign = deltaNet > 0 ? "aumentó" : "disminuyó";
      explanation = `El resultado ${entry.fiscal_year} ${sign} en ${Math.abs(deltaNet).toFixed(2)} € respecto al cálculo anterior.`;
    } else if (!changed) {
      explanation = "Sin cambios respecto al cálculo anterior.";
    }

    await pool.query(`
      INSERT INTO fisco_result_history
        (fiscal_year, run_id, mode, status, operations_count, lots_count, disposals_count,
         gains_eur, losses_eur, net_gain_loss_eur, operation_set_hash,
         previous_net_gain_loss_eur, delta_net_gain_loss_eur, delta_gains_eur, delta_losses_eur,
         changed_from_previous, explanation)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
    `, [
      entry.fiscal_year, entry.run_id, entry.mode, entry.status,
      entry.operations_count, entry.lots_count, entry.disposals_count,
      entry.gains_eur, entry.losses_eur, entry.net_gain_loss_eur, entry.operation_set_hash,
      prevNet, deltaNet, deltaGains, deltaLosses,
      changed, explanation,
    ]);

    // Also update the rebuild_runs row with hash and fiscal data
    await pool.query(`
      UPDATE fisco_rebuild_runs SET
        operation_set_hash = $2,
        fiscal_year = $3,
        gains_eur = $4,
        losses_eur = $5,
        net_gain_loss_eur = $6,
        previous_net_gain_loss_eur = $7,
        delta_net_gain_loss_eur = $8,
        delta_gains_eur = $9,
        delta_losses_eur = $10,
        changed_from_previous = $11
      WHERE id = $1
    `, [
      entry.run_id, entry.operation_set_hash, entry.fiscal_year,
      entry.gains_eur, entry.losses_eur, entry.net_gain_loss_eur,
      prevNet, deltaNet, deltaGains, deltaLosses, changed,
    ]);
  }

  /**
   * Get change impact analysis for a year.
   */
  async getChangeImpact(year: number): Promise<ChangeImpactResponse> {
    const controlStatus = await this.getControlStatus(year);
    const officialResult = controlStatus.official_result;
    const pendingChanges = controlStatus.pending_changes;

    // Get previous result from history
    const prevHistoryQ = await pool.query(`
      SELECT * FROM fisco_result_history
      WHERE fiscal_year = $1
      ORDER BY recorded_at DESC LIMIT 1
    `, [year]);
    const prevHistory = prevHistoryQ.rows[0] ?? null;

    const previousResult = prevHistory ? {
      net_gain_loss_eur: parseFloat(prevHistory.net_gain_loss_eur),
      gains_eur: parseFloat(prevHistory.gains_eur),
      losses_eur: parseFloat(prevHistory.losses_eur),
      run_id: prevHistory.run_id,
      recorded_at: prevHistory.recorded_at?.toISOString() ?? null,
    } : null;

    const hasChanges = controlStatus.fiscal_result_status === "NEEDS_REBUILD" ||
                       controlStatus.fiscal_result_status === "OUTDATED" ||
                       (pendingChanges?.has_pending ?? false);

    // New operations detail
    const newOps = pendingChanges?.pending_operations ?? [];
    const newOperations = newOps.map(op => ({
      id: op.id,
      exchange: op.exchange,
      op_type: op.op_type,
      asset: op.asset,
      amount: op.amount,
      total_eur: op.total_eur,
      executed_at: op.executed_at.toISOString(),
      created_at: op.created_at.toISOString(),
    }));

    // Impact by asset
    const impactByAsset: Record<string, { count: number; total_eur: number }> = {};
    for (const op of newOps) {
      if (!impactByAsset[op.asset]) {
        impactByAsset[op.asset] = { count: 0, total_eur: 0 };
      }
      impactByAsset[op.asset].count++;
      impactByAsset[op.asset].total_eur += parseFloat(op.total_eur ?? "0");
    }

    // Delta calculation
    let delta: ChangeImpactResponse["delta"] = null;
    if (previousResult && officialResult.net_gain_loss_eur !== null) {
      delta = {
        net_gain_loss_eur: officialResult.net_gain_loss_eur - previousResult.net_gain_loss_eur,
        gains_eur: officialResult.gains_eur! - previousResult.gains_eur,
        losses_eur: officialResult.losses_eur! - previousResult.losses_eur,
      };
    }

    // Explanation
    let explanation: string;
    if (!hasChanges && !delta) {
      explanation = "No hay cambios desde el último cálculo.";
    } else if (controlStatus.fiscal_result_status === "NEEDS_REBUILD") {
      explanation = `Hay ${newOps.length} operaciones nuevas pendientes de reconstrucción FIFO. El resultado puede cambiar.`;
    } else if (delta && Math.abs(delta.net_gain_loss_eur!) > 0.001) {
      const sign = delta.net_gain_loss_eur! > 0 ? "aumentó" : "disminuyó";
      explanation = `El resultado oficial ${year} ${sign} en ${Math.abs(delta.net_gain_loss_eur!).toFixed(2)} € respecto al cálculo anterior.`;
      if (newOps.length > 0) {
        explanation += ` El cambio se debe a ${newOps.length} operaciones nuevas.`;
      }
    } else {
      explanation = "El resultado está actualizado.";
    }

    return {
      year,
      has_changes: hasChanges,
      previous_result: previousResult,
      current_official_result: officialResult,
      pending_simulated_result: hasChanges ? {
        net_gain_loss_eur: null, // Would require dry-run
        gains_eur: null,
        losses_eur: null,
        pending_operations_count: newOps.length,
      } : null,
      delta,
      new_operations: newOperations,
      impact_by_asset: impactByAsset,
      explanation,
    };
  }
}

// ─── Singleton export ─────────────────────────────────────────────────────────

export const fiscoControlStatusService = FiscoControlStatusService.getInstance();
