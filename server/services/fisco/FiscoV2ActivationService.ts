/**
 * FiscoV2ActivationService — Activación oficial V2 con backup, rollback y auditoría.
 *
 * Endpoints:
 * - controlledCommit: registra operation_set_hash (inicial o existente), guarda auditoría
 * - activateOfficial: valida safe_for_official_switch, crea backup, cambia engine a v2_official
 * - rollback: restaura backup, revierte engine a legacy_fifo o v2_shadow
 *
 * Validaciones estrictas:
 * - confirm must be true
 * - safe_for_official_switch debe ser true (para activateOfficial)
 * - Hash y valores esperados deben coincidir
 * - controlledCommit NO exige hash previo; usa data_fingerprint.operation_set_hash
 */

import { pool } from "../../db";
import { runComparison } from "./FiscoComparisonService";
import { getFiscoConfig, setFiscoConfig } from "./FiscoConfigService";
import { fiscoControlStatusService } from "./FiscoControlStatusService";
import { randomUUID } from "crypto";

/**
 * Round to 2 decimal places — same formula as FiscoValidationService.round2
 * and finalization-status / annual-report.
 */
function roundMoney2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export interface ControlledCommitResult {
  ok: boolean;
  year: number;
  controlled_commit: boolean;
  hash_registered: boolean;
  already_registered: boolean;
  operation_set_hash: string;
  hash_scope: string;
  official_engine: string;
  shadow_engine: string;
  net_gain_loss_eur: number;
  rounded_eur: number;
  v2_activated: boolean;
  comparison_summary: {
    baseline_net: number;
    v2_net: number;
    diff_eur: number;
    safe_for_official_switch: boolean;
  };
  audit_log_id: string;
}

export interface RegisterGlobalHashResult {
  ok: boolean;
  hash_registered: boolean;
  already_registered: boolean;
  global_operation_set_hash: string;
  previous_hash: string | null;
  run_id: string;
  official_results: { year: number; net_gain_loss_eur: number }[];
  v2_activated: boolean;
  audit_log_id: string;
}

export async function controlledCommit(
  year: number,
  confirm: boolean,
  expectedCurrentNetGainLossEur: number,
  expectedCurrentRoundedEur: number
): Promise<ControlledCommitResult> {
  console.log(`[FISCO_V2_ACTIVATION] controlled commit for year ${year}`);

  if (!confirm) {
    throw new Error("confirm must be true to execute controlled commit. This is a safety check.");
  }

  // Get control status — contains data_fingerprint, official_result, last_committed_run, etc.
  const status = await fiscoControlStatusService.getControlStatus(year);

  // Validation 1: official_engine must be legacy_fifo
  if (status.official_engine !== "legacy_fifo") {
    throw new Error(`official_engine must be legacy_fifo for controlled commit. Current: ${status.official_engine}`);
  }

  // Validation 2: report_can_be_finalized must be true
  if (!status.report_can_be_finalized) {
    throw new Error(`report_can_be_finalized is false. Blockers: ${status.blockers.join(", ")}`);
  }

  // Validation 3: no blockers
  if (status.blockers.length > 0) {
    throw new Error(`Control status has blockers: ${status.blockers.join(", ")}`);
  }

  // Validation 4: no pending changes
  if (status.pending_changes?.has_pending) {
    throw new Error(`There are pending changes. Run rebuild FIFO first.`);
  }

  // Validation 5: data_fingerprint hashes must exist
  // Use the YEAR hash for controlledCommit since it's per-year
  const yearHash = status.data_fingerprint?.operation_set_hash ?? null;
  const globalHash = status.data_fingerprint?.global_operation_set_hash ?? null;
  if (!yearHash) {
    throw new Error("data_fingerprint.operation_set_hash is null. Cannot register hash.");
  }
  // The hash to register depends on the scope of the last committed run
  const committedScope = status.last_committed_run?.operations_count_scope ?? "global";
  const dataFingerprintHash = committedScope === "year" ? yearHash : (globalHash ?? yearHash);

  // Validation 6: official_result.net_gain_loss_eur must match expected
  const officialNet = status.official_result?.net_gain_loss_eur ?? null;
  if (officialNet === null || Math.abs(officialNet - expectedCurrentNetGainLossEur) > 0.01) {
    throw new Error(
      `official_result.net_gain_loss_eur mismatch. Expected: ${expectedCurrentNetGainLossEur}, Current: ${officialNet}`
    );
  }

  // Validation 7: rounded value must match (2 decimal places, with tolerance)
  const officialRounded = roundMoney2(officialNet);
  if (Math.abs(officialRounded - expectedCurrentRoundedEur) > 0.001) {
    throw new Error(
      `OFFICIAL_ROUNDED_MISMATCH: expected_current_rounded_eur=${expectedCurrentRoundedEur}, current_rounded_eur=${officialRounded}, source_net_gain_loss_eur=${officialNet}, rounding_mode=2_decimals`
    );
  }

  // Check last_committed_run.operation_set_hash
  const lastCommittedHash = status.last_committed_run?.operation_set_hash ?? null;
  let alreadyRegistered = false;

  if (lastCommittedHash) {
    if (lastCommittedHash === dataFingerprintHash) {
      // Hash already registered and matches — idempotent
      alreadyRegistered = true;
      console.log(`[FISCO_V2_ACTIVATION] hash already registered and matches: ${dataFingerprintHash}`);
    } else {
      // Hash mismatch — block
      throw new Error(
        `HASH_MISMATCH: last_committed_run.operation_set_hash (${lastCommittedHash}) != data_fingerprint.operation_set_hash (${dataFingerprintHash})`
      );
    }
  } else {
    // last_committed_run.operation_set_hash is null — register it for the first time
    // Update fisco_rebuild_runs with the hash and fiscal data
    const lastRunId = status.last_committed_run?.id ?? null;
    if (lastRunId) {
      await pool.query(`
        UPDATE fisco_rebuild_runs SET
          operation_set_hash = $2,
          fiscal_year = $3,
          gains_eur = $4,
          losses_eur = $5,
          net_gain_loss_eur = $6
        WHERE id = $1
      `, [
        lastRunId,
        dataFingerprintHash,
        year,
        status.official_result?.gains_eur ?? 0,
        status.official_result?.losses_eur ?? 0,
        officialNet,
      ]);
      console.log(`[FISCO_V2_ACTIVATION] registered hash ${dataFingerprintHash} on run ${lastRunId}`);
    } else {
      console.log(`[FISCO_V2_ACTIVATION] no last_committed_run to update, registering hash in audit log only`);
    }
  }

  // Run comparison to get V2 state for audit
  const comparison = await runComparison(year, true);

  // Insert audit log
  const auditId = randomUUID();
  await pool.query(`
    INSERT INTO fisco_v2_audit_log
      (id, year, event_type, engine_before, engine_after, operation_set_hash,
       legacy_net_gain_loss_eur, v2_net_gain_loss_eur, diff_eur,
       safe_for_official_switch, request_json, result_json, blockers, warnings)
    VALUES ($1, $2, 'controlled_commit_hash_registration', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
  `, [
    auditId,
    year,
    status.official_engine,
    status.official_engine, // engine_before = engine_after = legacy_fifo
    dataFingerprintHash,
    officialNet,
    comparison.v2.net_gain_loss_eur,
    comparison.diff_eur,
    comparison.safe_for_official_switch,
    JSON.stringify({ year, confirm, expected_current_net_gain_loss_eur: expectedCurrentNetGainLossEur, expected_current_rounded_eur: expectedCurrentRoundedEur }),
    JSON.stringify({
      baseline: comparison.baseline,
      v2: comparison.v2,
      fee_treatment_summary: comparison.fee_treatment_summary,
      operation_mapping_count: comparison.operation_mapping.length,
      unmapped_legacy: comparison.unmapped_legacy_disposals.length,
      unmapped_v2: comparison.unmapped_v2_disposals.length,
      already_registered: alreadyRegistered,
    }),
    JSON.stringify(comparison.official_switch_blockers),
    JSON.stringify(comparison.warnings),
  ]);

  return {
    ok: true,
    year,
    controlled_commit: true,
    hash_registered: !alreadyRegistered,
    already_registered: alreadyRegistered,
    operation_set_hash: dataFingerprintHash,
    hash_scope: committedScope,
    official_engine: status.official_engine,
    shadow_engine: status.shadow_engine,
    net_gain_loss_eur: officialNet,
    rounded_eur: officialRounded,
    v2_activated: false,
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
  const backupId = randomUUID();
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
    INSERT INTO fisco_v2_backups
      (id, year, backup_type, official_engine_before, official_engine_after,
       operation_set_hash, legacy_result_json, v2_result_json, comparison_json,
       config_snapshot, disposals_snapshot, lots_snapshot)
    VALUES ($1, $2, 'pre_activation', $3, 'v2_official', $4, $5, $6, $7, $8, $9, $10)
  `, [
    backupId,
    year,
    config.fiscoEngineMode,
    currentHash,
    JSON.stringify(comparison.baseline),
    JSON.stringify(comparison.v2),
    JSON.stringify({
      diff_eur: comparison.diff_eur,
      gross_gains_diff: comparison.gross_gains_diff_eur,
      gross_losses_diff: comparison.gross_losses_diff_eur,
      fee_diff_detail: comparison.fee_diff_detail,
    }),
    JSON.stringify(config),
    JSON.stringify(disposalsResult.rows),
    JSON.stringify(lotsResult.rows),
  ]);

  // Activate V2 official
  await setFiscoConfig({ fiscoEngineMode: "v2_official" } as any);

  // Insert audit log
  const auditId = randomUUID();
  await pool.query(`
    INSERT INTO fisco_v2_audit_log
      (id, year, event_type, engine_before, engine_after,
       operation_set_hash, expected_operation_set_hash,
       legacy_net_gain_loss_eur, v2_net_gain_loss_eur, diff_eur,
       safe_for_official_switch, backup_id, request_json, result_json, blockers, warnings)
    VALUES ($1, $2, 'activate', $3, 'v2_official', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
  `, [
    auditId,
    year,
    config.fiscoEngineMode,
    currentHash,
    expectedOperationSetHash,
    comparison.baseline.net_gain_loss_eur,
    comparison.v2.net_gain_loss_eur,
    comparison.diff_eur,
    comparison.safe_for_official_switch,
    backupId,
    JSON.stringify({
      confirm,
      expected_v2_net_gain_loss_eur: expectedV2NetGainLossEur,
      expected_v2_rounded_eur: expectedV2RoundedEur,
    }),
    JSON.stringify({
      fee_treatment_summary: comparison.fee_treatment_summary,
      operation_mapping_count: comparison.operation_mapping.length,
      unmapped_legacy: comparison.unmapped_legacy_disposals.length,
      unmapped_v2: comparison.unmapped_v2_disposals.length,
    }),
    JSON.stringify(comparison.official_switch_blockers),
    JSON.stringify(comparison.warnings),
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
    "SELECT * FROM fisco_v2_backups WHERE id = $1 AND year = $2",
    [backupId, year]
  );

  if (backupResult.rows.length === 0) {
    throw new Error(`Backup ${backupId} not found for year ${year}`);
  }

  const backup = backupResult.rows[0];
  const previousConfig = JSON.parse(backup.config_snapshot);
  const previousEngine = backup.official_engine_before || "legacy_fifo";

  // Restore engine mode
  await setFiscoConfig({ fiscoEngineMode: previousEngine } as any);

  // Insert audit log
  const auditId = randomUUID();
  await pool.query(`
    INSERT INTO fisco_v2_audit_log
      (id, year, event_type, engine_before, engine_after, backup_id, request_json, result_json)
    VALUES ($1, $2, 'rollback', $3, $4, $5, $6, $7)
  `, [
    auditId,
    year,
    'v2_official',
    previousEngine,
    backupId,
    JSON.stringify({ confirm, backup_id: backupId }),
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
    "SELECT * FROM fisco_v2_audit_log WHERE year = $1 ORDER BY created_at DESC LIMIT $2",
    [year, limit]
  );
  return result.rows;
}

export async function getBackups(year: number): Promise<any[]> {
  const result = await pool.query(
    "SELECT id, year, backup_type, official_engine_before, official_engine_after, operation_set_hash, created_at FROM fisco_v2_backups WHERE year = $1 ORDER BY created_at DESC",
    [year]
  );
  return result.rows;
}

/**
 * Register the current global operation_set_hash on the last committed run.
 *
 * This is a safe flow that:
 * - Does NOT activate V2
 * - Does NOT touch fisco_disposals
 * - Does NOT modify official results
 * - Requires explicit confirmation of expected official results and global hash
 * - Leaves an audit log
 *
 * Use this when the last_committed_run has a year hash stored as global
 * (SCOPE_MISMATCH_STORED_YEAR_AS_GLOBAL) to correct the registration.
 */
export async function registerGlobalHash(
  confirm: boolean,
  expectedGlobalHash: string,
  expectedOfficialResults: { year: number; net_gain_loss_eur: number }[]
): Promise<RegisterGlobalHashResult> {
  console.log(`[FISCO_V2_ACTIVATION] registerGlobalHash — safe hash registration`);

  if (!confirm) {
    throw new Error("confirm must be true to register global hash. This is a safety check.");
  }

  // Get control status for the first year to access global hash and last committed run
  const firstYear = expectedOfficialResults[0]?.year;
  if (!firstYear) {
    throw new Error("expectedOfficialResults must contain at least one year.");
  }

  const status = await fiscoControlStatusService.getControlStatus(firstYear);

  // Validation 1: official_engine must be legacy_fifo (not v2_official)
  if (status.official_engine !== "legacy_fifo") {
    throw new Error(`official_engine must be legacy_fifo. Current: ${status.official_engine}`);
  }

  // Validation 2: no blockers
  if (status.blockers.length > 0) {
    throw new Error(`Control status has blockers: ${status.blockers.join(", ")}`);
  }

  // Validation 3: no pending changes
  if (status.pending_changes?.has_pending) {
    throw new Error(`There are pending changes. Run rebuild FIFO first.`);
  }

  // Validation 4: global hash must exist
  const currentGlobalHash = status.data_fingerprint?.global_operation_set_hash ?? null;
  if (!currentGlobalHash) {
    throw new Error("data_fingerprint.global_operation_set_hash is null. Cannot register.");
  }

  // Validation 5: expected global hash must match current
  if (currentGlobalHash !== expectedGlobalHash) {
    throw new Error(
      `GLOBAL_HASH_MISMATCH: expected=${expectedGlobalHash}, current=${currentGlobalHash}`
    );
  }

  // Validation 6: verify official results for each year
  const officialResults: { year: number; net_gain_loss_eur: number }[] = [];
  for (const expected of expectedOfficialResults) {
    const yearStatus = await fiscoControlStatusService.getControlStatus(expected.year);
    const officialNet = yearStatus.official_result?.net_gain_loss_eur ?? null;
    if (officialNet === null || Math.abs(officialNet - expected.net_gain_loss_eur) > 0.01) {
      throw new Error(
        `OFFICIAL_RESULT_MISMATCH for year ${expected.year}: expected=${expected.net_gain_loss_eur}, current=${officialNet}`
      );
    }
    officialResults.push({ year: expected.year, net_gain_loss_eur: officialNet });
  }

  // Get last committed run
  const lastRunId = status.last_committed_run?.id ?? null;
  const previousHash = status.last_committed_run?.operation_set_hash ?? null;

  if (!lastRunId) {
    throw new Error("No last_committed_run found. Cannot register hash.");
  }

  // Check if already correct
  let alreadyRegistered = false;
  if (previousHash === currentGlobalHash) {
    alreadyRegistered = true;
    console.log(`[FISCO_V2_ACTIVATION] global hash already registered correctly: ${currentGlobalHash}`);
  } else {
    // Update the hash on the last committed run
    await pool.query(`
      UPDATE fisco_rebuild_runs SET
        operation_set_hash = $2
      WHERE id = $1
    `, [lastRunId, currentGlobalHash]);
    console.log(`[FISCO_V2_ACTIVATION] registered global hash ${currentGlobalHash} on run ${lastRunId} (previous: ${previousHash})`);
  }

  // Insert audit log
  const auditId = randomUUID();
  await pool.query(`
    INSERT INTO fisco_v2_audit_log
      (id, year, event_type, engine_before, engine_after, operation_set_hash,
       legacy_net_gain_loss_eur, v2_net_gain_loss_eur, diff_eur,
       safe_for_official_switch, request_json, result_json, blockers, warnings)
    VALUES ($1, $2, 'register_global_hash', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
  `, [
    auditId,
    firstYear,
    status.official_engine,
    status.official_engine, // engine_before = engine_after = legacy_fifo
    currentGlobalHash,
    officialResults[0]?.net_gain_loss_eur ?? 0,
    null, // no V2 comparison needed
    null,
    null,
    JSON.stringify({ confirm, expectedGlobalHash, expectedOfficialResults }),
    JSON.stringify({
      global_hash_registered: currentGlobalHash,
      previous_hash: previousHash,
      already_registered: alreadyRegistered,
      official_results: officialResults,
    }),
    JSON.stringify([]),
    JSON.stringify([]),
  ]);

  return {
    ok: true,
    hash_registered: !alreadyRegistered,
    already_registered: alreadyRegistered,
    global_operation_set_hash: currentGlobalHash,
    previous_hash: previousHash,
    run_id: lastRunId,
    official_results: officialResults,
    v2_activated: false,
    audit_log_id: auditId,
  };
}
