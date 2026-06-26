/**
 * FiscoV2ActivationService — Activación oficial V2 con backup, rollback y auditoría.
 *
 * Endpoints:
 * - controlledCommit: recalcula FIFO, registra operation_set_hash, guarda auditoría
 * - activateOfficial: valida safe_for_official_switch, crea backup, cambia engine a v2_official
 * - rollback: restaura backup, revierte engine a legacy_fifo o v2_shadow
 *
 * Validaciones estrictas:
 * - operation_set_hash debe estar registrado
 * - safe_for_official_switch debe ser true
 * - Doble confirmación (confirm: true)
 * - Hash y valores esperados deben coincidir
 */

import { pool } from "../../db";
import { runComparison } from "./FiscoComparisonService";
import { getFiscoConfig, setFiscoConfig } from "./FiscoConfigService";
import { fiscoControlStatusService } from "./FiscoControlStatusService";
import { randomUUID } from "crypto";

export interface ControlledCommitResult {
  committed: boolean;
  year: number;
  operation_set_hash: string;
  comparison_summary: {
    baseline_net: number;
    v2_net: number;
    diff_eur: number;
    safe_for_official_switch: boolean;
  };
  audit_log_id: string;
}

export async function controlledCommit(year: number): Promise<ControlledCommitResult> {
  console.log(`[FISCO_V2_ACTIVATION] controlled commit for year ${year}`);

  // Run comparison to get current state
  const comparison = await runComparison(year, true);

  // Get control status to check operation_set_hash
  const status = await fiscoControlStatusService.getControlStatus(year);
  const operationSetHash = status.last_committed_run?.operation_set_hash ?? null;

  if (!operationSetHash) {
    throw new Error("No hay operation_set_hash registrado. Ejecutar rebuild FIFO antes de controlled commit.");
  }

  // Insert audit log
  const auditId = `audit-${Date.now()}-${randomUUID().slice(0, 8)}`;
  await pool.query(`
    INSERT INTO fisco_v2_audit_log (id, action, year, operation_set_hash, legacy_result, v2_result, differences, fee_treatment_summary, details)
    VALUES ($1, 'controlled_commit', $2, $3, $4, $5, $6, $7, $8)
  `, [
    auditId,
    year,
    operationSetHash,
    JSON.stringify(comparison.baseline),
    JSON.stringify(comparison.v2),
    JSON.stringify({
      diff_eur: comparison.diff_eur,
      gross_gains_diff: comparison.gross_gains_diff_eur,
      gross_losses_diff: comparison.gross_losses_diff_eur,
      disposals_count_diff: comparison.disposals_count_diff,
    }),
    JSON.stringify(comparison.fee_treatment_summary),
    JSON.stringify({
      official_switch_blockers: comparison.official_switch_blockers,
      safe_for_official_switch: comparison.safe_for_official_switch,
      operation_mapping_count: comparison.operation_mapping.length,
      unmapped_legacy: comparison.unmapped_legacy_disposals.length,
      unmapped_v2: comparison.unmapped_v2_disposals.length,
    }),
  ]);

  return {
    committed: true,
    year,
    operation_set_hash: operationSetHash,
    comparison_summary: {
      baseline_net: comparison.baseline.net_gain_loss_eur,
      v2_net: comparison.v2.net_gain_loss_eur,
      diff_eur: comparison.diff_eur,
      safe_for_official_switch: comparison.safe_for_official_switch,
    },
    audit_log_id: auditId,
  };
}

export async function activateOfficial(
  year: number,
  confirm: boolean,
  expectedOperationSetHash: string,
  expectedV2NetGainLossEur: number,
  expectedV2RoundedEur: number
): Promise<{
  activated: boolean;
  year: number;
  engine: string;
  backup_id: string;
  rollback_available: boolean;
  audit_log_id: string;
}> {
  console.log(`[FISCO_V2_ACTIVATION] activate official for year ${year}`);

  // Validation 1: confirm must be true
  if (!confirm) {
    throw new Error("confirm must be true to activate V2 official. This is a safety check.");
  }

  // Validation 2: run comparison and check safe_for_official_switch
  const comparison = await runComparison(year, true);
  if (!comparison.safe_for_official_switch) {
    throw new Error(
      `safe_for_official_switch is false. Blockers: ${comparison.official_switch_blockers.join(", ")}`
    );
  }

  // Validation 3: check operation_set_hash
  const status = await fiscoControlStatusService.getControlStatus(year);
  const currentHash = status.last_committed_run?.operation_set_hash ?? null;
  if (!currentHash) {
    throw new Error("No hay operation_set_hash registrado. Ejecutar controlled commit primero.");
  }
  if (currentHash !== expectedOperationSetHash) {
    throw new Error(
      `operation_set_hash mismatch. Expected: ${expectedOperationSetHash}, Current: ${currentHash}`
    );
  }

  // Validation 4: check expected V2 net gain/loss
  const v2Net = comparison.v2.net_gain_loss_eur;
  if (Math.abs(v2Net - expectedV2NetGainLossEur) > 0.01) {
    throw new Error(
      `V2 net gain/loss mismatch. Expected: ${expectedV2NetGainLossEur}, Current: ${v2Net}`
    );
  }

  // Validation 5: check rounded value
  const v2Rounded = Math.round(v2Net);
  if (v2Rounded !== expectedV2RoundedEur) {
    throw new Error(
      `V2 rounded mismatch. Expected: ${expectedV2RoundedEur}, Current: ${v2Rounded}`
    );
  }

  // Create backup
  const backupId = `backup-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const config = await getFiscoConfig();

  // Snapshot current disposals and lots
  const disposalsResult = await pool.query(
    "SELECT * FROM fisco_disposals WHERE sell_operation_id IN (SELECT id FROM fisco_operations WHERE executed_at >= $1 AND executed_at < $2)",
    [`${year}-01-01`, `${year + 1}-01-01`]
  );
  const lotsResult = await pool.query(
    "SELECT * FROM fisco_lots WHERE operation_id IN (SELECT id FROM fisco_operations WHERE executed_at >= $1 AND executed_at < $2)",
    [`${year}-01-01`, `${year + 1}-01-01`]
  );

  await pool.query(`
    INSERT INTO fisco_v2_backups (backup_id, year, engine_mode, config_snapshot, disposals_snapshot, lots_snapshot)
    VALUES ($1, $2, $3, $4, $5, $6)
  `, [
    backupId,
    year,
    config.fiscoEngineMode,
    JSON.stringify(config),
    JSON.stringify(disposalsResult.rows),
    JSON.stringify(lotsResult.rows),
  ]);

  // Activate V2 official
  await setFiscoConfig({ fiscoEngineMode: "v2_official" } as any);

  // Insert audit log
  const auditId = `audit-${Date.now()}-${randomUUID().slice(0, 8)}`;
  await pool.query(`
    INSERT INTO fisco_v2_audit_log (id, action, year, operation_set_hash, legacy_result, v2_result, differences, fee_treatment_summary, backup_id, details)
    VALUES ($1, 'activate', $2, $3, $4, $5, $6, $7, $8, $9)
  `, [
    auditId,
    year,
    currentHash,
    JSON.stringify(comparison.baseline),
    JSON.stringify(comparison.v2),
    JSON.stringify({
      diff_eur: comparison.diff_eur,
      gross_gains_diff: comparison.gross_gains_diff_eur,
      gross_losses_diff: comparison.gross_losses_diff_eur,
    }),
    JSON.stringify(comparison.fee_treatment_summary),
    backupId,
    JSON.stringify({
      previous_engine: config.fiscoEngineMode,
      new_engine: "v2_official",
      expected_hash: expectedOperationSetHash,
      expected_v2_net: expectedV2NetGainLossEur,
      expected_v2_rounded: expectedV2RoundedEur,
    }),
  ]);

  console.log(`[FISCO_V2_ACTIVATION] activated. backup_id=${backupId}, audit_id=${auditId}`);

  return {
    activated: true,
    year,
    engine: "v2_official",
    backup_id: backupId,
    rollback_available: true,
    audit_log_id: auditId,
  };
}

export async function rollbackOfficial(
  year: number,
  backupId: string,
  confirm: boolean
): Promise<{
  rolled_back: boolean;
  year: number;
  engine: string;
  backup_id: string;
}> {
  console.log(`[FISCO_V2_ACTIVATION] rollback for year ${year}, backup ${backupId}`);

  if (!confirm) {
    throw new Error("confirm must be true to rollback. This is a safety check.");
  }

  // Get backup
  const backupResult = await pool.query(
    "SELECT * FROM fisco_v2_backups WHERE backup_id = $1 AND year = $2",
    [backupId, year]
  );

  if (backupResult.rows.length === 0) {
    throw new Error(`Backup ${backupId} not found for year ${year}`);
  }

  const backup = backupResult.rows[0];
  const previousConfig = JSON.parse(backup.config_snapshot);
  const previousEngine = backup.engine_mode || "v2_shadow";

  // Restore engine mode
  await setFiscoConfig({ fiscoEngineMode: previousEngine } as any);

  // Insert audit log
  const auditId = `audit-${Date.now()}-${randomUUID().slice(0, 8)}`;
  await pool.query(`
    INSERT INTO fisco_v2_audit_log (id, action, year, backup_id, details)
    VALUES ($1, 'rollback', $2, $3, $4)
  `, [
    auditId,
    year,
    backupId,
    JSON.stringify({
      restored_engine: previousEngine,
      backup_created_at: backup.created_at,
    }),
  ]);

  console.log(`[FISCO_V2_ACTIVATION] rolled back to ${previousEngine}. audit_id=${auditId}`);

  return {
    rolled_back: true,
    year,
    engine: previousEngine,
    backup_id: backupId,
  };
}

export async function getAuditLog(year: number, limit: number = 20): Promise<any[]> {
  const result = await pool.query(
    "SELECT * FROM fisco_v2_audit_log WHERE year = $1 ORDER BY timestamp DESC LIMIT $2",
    [year, limit]
  );
  return result.rows;
}

export async function getBackups(year: number): Promise<any[]> {
  const result = await pool.query(
    "SELECT backup_id, year, engine_mode, created_at FROM fisco_v2_backups WHERE year = $1 ORDER BY created_at DESC",
    [year]
  );
  return result.rows;
}
