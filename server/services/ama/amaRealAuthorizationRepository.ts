/**
 * AMA Real Authorization Repository — PostgreSQL persistence for
 * REAL_LIMITED authorization, pre-trade gates, reconciliation, and restart recovery.
 *
 * SAFETY:
 * - REAL_FULL is permanently locked and cannot be authorized.
 * - Authorization is a single-row, explicitly toggled record.
 * - Pre-trade gates are append-only.
 * - No DELETE operations.
 */

import { pool } from "../../db";

// ─── Real Authorization ──────────────────────────────────────────────

export interface RealAuthorizationRow {
  authorizedMode: string;
  authorizedBy: string;
  authorizedAt: string;
  revokedBy: string | null;
  revokedAt: string | null;
  isActive: boolean;
  maxCapitalUsd: number;
  maxSingleTrancheUsd: number;
  maxTranchesPerCycle: number;
  expiresAt: string | null;
  reason: string | null;
  updatedAt: string;
}

export async function getRealAuthorization(): Promise<RealAuthorizationRow> {
  const result = await pool.query(
    `SELECT authorized_mode, authorized_by, authorized_at, revoked_by, revoked_at,
            is_active, max_capital_usd, max_single_tranche_usd, max_tranches_per_cycle,
            expires_at, reason, updated_at
     FROM ama_real_authorization WHERE id = 1`,
  );
  const r = result.rows[0];
  return {
    authorizedMode: r.authorized_mode,
    authorizedBy: r.authorized_by,
    authorizedAt: r.authorized_at?.toISOString() ?? new Date().toISOString(),
    revokedBy: r.revoked_by ?? null,
    revokedAt: r.revoked_at?.toISOString() ?? null,
    isActive: r.is_active,
    maxCapitalUsd: Number(r.max_capital_usd),
    maxSingleTrancheUsd: Number(r.max_single_tranche_usd),
    maxTranchesPerCycle: r.max_tranches_per_cycle,
    expiresAt: r.expires_at?.toISOString() ?? null,
    reason: r.reason ?? null,
    updatedAt: r.updated_at?.toISOString() ?? new Date().toISOString(),
  };
}

export async function grantRealLimitedAuthorization(
  authorizedBy: string,
  maxCapitalUsd: number,
  maxSingleTrancheUsd: number,
  maxTranchesPerCycle: number,
  expiresAt?: string,
  reason?: string,
): Promise<void> {
  await pool.query(
    `UPDATE ama_real_authorization
     SET authorized_mode = 'REAL_LIMITED',
         authorized_by = $1,
         authorized_at = NOW(),
         revoked_by = NULL,
         revoked_at = NULL,
         is_active = TRUE,
         max_capital_usd = $2,
         max_single_tranche_usd = $3,
         max_tranches_per_cycle = $4,
         expires_at = $5,
         reason = $6,
         updated_at = NOW()
     WHERE id = 1`,
    [authorizedBy, maxCapitalUsd, maxSingleTrancheUsd, maxTranchesPerCycle, expiresAt ?? null, reason ?? null],
  );
}

export async function revokeRealAuthorization(
  revokedBy: string,
  reason?: string,
): Promise<void> {
  await pool.query(
    `UPDATE ama_real_authorization
     SET is_active = FALSE,
         revoked_by = $1,
         revoked_at = NOW(),
         reason = $2,
         updated_at = NOW()
     WHERE id = 1`,
    [revokedBy, reason ?? null],
  );
}

export async function restoreRealAuthorizationSnapshot(
  snapshot: RealAuthorizationRow,
): Promise<void> {
  await pool.query(
    `UPDATE ama_real_authorization
     SET authorized_mode = $1,
         authorized_by = $2,
         authorized_at = $3,
         revoked_by = $4,
         revoked_at = $5,
         is_active = $6,
         max_capital_usd = $7,
         max_single_tranche_usd = $8,
         max_tranches_per_cycle = $9,
         expires_at = $10,
         reason = $11,
         updated_at = NOW()
     WHERE id = 1`,
    [
      snapshot.authorizedMode,
      snapshot.authorizedBy,
      snapshot.authorizedAt,
      snapshot.revokedBy,
      snapshot.revokedAt,
      snapshot.isActive,
      snapshot.maxCapitalUsd,
      snapshot.maxSingleTrancheUsd,
      snapshot.maxTranchesPerCycle,
      snapshot.expiresAt,
      snapshot.reason,
    ],
  );
}

export async function isRealLimitedAuthorized(): Promise<boolean> {
  const result = await pool.query(
    `SELECT is_active, expires_at FROM ama_real_authorization WHERE id = 1`,
  );
  const r = result.rows[0];
  if (!r?.is_active) return false;
  if (r.expires_at && new Date(r.expires_at) < new Date()) return false;
  return true;
}

// ─── Pre-Trade Gates ─────────────────────────────────────────────────

export interface PreTradeGateRow {
  gateId: string;
  cycleId: string;
  trancheId: string;
  gateType: string;
  passed: boolean;
  reason: string | null;
  details: Record<string, unknown>;
  evaluatedAt: string;
}

export async function insertPreTradeGate(
  gate: PreTradeGateRow,
  client?: import("pg").PoolClient,
): Promise<void> {
  const q = client ?? pool;
  await q.query(
    `INSERT INTO ama_pre_trade_gates
      (gate_id, cycle_id, tranche_id, gate_type, passed, reason, details, evaluated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (gate_id) DO NOTHING`,
    [
      gate.gateId, gate.cycleId, gate.trancheId, gate.gateType,
      gate.passed, gate.reason, JSON.stringify(gate.details), gate.evaluatedAt,
    ],
  );
}

export async function getPreTradeGatesByCycle(cycleId: string): Promise<PreTradeGateRow[]> {
  const result = await pool.query(
    `SELECT * FROM ama_pre_trade_gates WHERE cycle_id = $1 ORDER BY evaluated_at DESC`,
    [cycleId],
  );
  return result.rows.map((r: any) => ({
    gateId: r.gate_id,
    cycleId: r.cycle_id,
    trancheId: r.tranche_id,
    gateType: r.gate_type,
    passed: r.passed,
    reason: r.reason,
    details: typeof r.details === "string" ? JSON.parse(r.details) : r.details,
    evaluatedAt: r.evaluated_at?.toISOString() ?? new Date().toISOString(),
  }));
}

// ─── Reconciliation Log ──────────────────────────────────────────────

export interface ReconciliationRow {
  reconciliationId: string;
  cycleId: string | null;
  status: string;
  expectedState: Record<string, unknown>;
  actualState: Record<string, unknown>;
  discrepancies: unknown[];
  resolved: boolean;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export async function insertReconciliation(
  rec: ReconciliationRow,
  client?: import("pg").PoolClient,
): Promise<void> {
  const q = client ?? pool;
  await q.query(
    `INSERT INTO ama_reconciliation_log
      (reconciliation_id, cycle_id, status, expected_state, actual_state,
       discrepancies, resolved, resolved_by, resolved_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (reconciliation_id) DO NOTHING`,
    [
      rec.reconciliationId, rec.cycleId, rec.status,
      JSON.stringify(rec.expectedState), JSON.stringify(rec.actualState),
      JSON.stringify(rec.discrepancies), rec.resolved,
      rec.resolvedBy, rec.resolvedAt, rec.createdAt,
    ],
  );
}

export async function resolveReconciliation(
  reconciliationId: string,
  resolvedBy: string,
): Promise<void> {
  await pool.query(
    `UPDATE ama_reconciliation_log
     SET resolved = TRUE, resolved_by = $1, resolved_at = NOW()
     WHERE reconciliation_id = $2`,
    [resolvedBy, reconciliationId],
  );
}

export async function getUnresolvedReconciliations(): Promise<ReconciliationRow[]> {
  const result = await pool.query(
    `SELECT * FROM ama_reconciliation_log WHERE resolved = FALSE ORDER BY created_at DESC`,
  );
  return result.rows.map((r: any) => ({
    reconciliationId: r.reconciliation_id,
    cycleId: r.cycle_id,
    status: r.status,
    expectedState: typeof r.expected_state === "string" ? JSON.parse(r.expected_state) : r.expected_state,
    actualState: typeof r.actual_state === "string" ? JSON.parse(r.actual_state) : r.actual_state,
    discrepancies: typeof r.discrepancies === "string" ? JSON.parse(r.discrepancies) : r.discrepancies,
    resolved: r.resolved,
    resolvedBy: r.resolved_by,
    resolvedAt: r.resolved_at?.toISOString() ?? null,
    createdAt: r.created_at?.toISOString() ?? new Date().toISOString(),
  }));
}

// ─── Restart Recovery ────────────────────────────────────────────────

export interface RestartRecoveryRow {
  recoveryId: string;
  trigger: string;
  previousMode: string | null;
  previousState: string | null;
  previousCycleId: string | null;
  actionsTaken: unknown[];
  status: string;
  completedAt: string | null;
  createdAt: string;
}

export async function insertRestartRecovery(
  recovery: RestartRecoveryRow,
): Promise<void> {
  await pool.query(
    `INSERT INTO ama_restart_recovery
      (recovery_id, trigger, previous_mode, previous_state, previous_cycle_id,
       actions_taken, status, completed_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (recovery_id) DO NOTHING`,
    [
      recovery.recoveryId, recovery.trigger, recovery.previousMode,
      recovery.previousState, recovery.previousCycleId,
      JSON.stringify(recovery.actionsTaken), recovery.status,
      recovery.completedAt, recovery.createdAt,
    ],
  );
}

export async function updateRestartRecoveryStatus(
  recoveryId: string,
  status: string,
  completedAt?: string,
): Promise<void> {
  if (completedAt) {
    await pool.query(
      `UPDATE ama_restart_recovery SET status = $1, completed_at = $2 WHERE recovery_id = $3`,
      [status, completedAt, recoveryId],
    );
  } else {
    await pool.query(
      `UPDATE ama_restart_recovery SET status = $1 WHERE recovery_id = $2`,
      [status, recoveryId],
    );
  }
}

export async function getLatestRestartRecovery(): Promise<RestartRecoveryRow | null> {
  const result = await pool.query(
    `SELECT * FROM ama_restart_recovery ORDER BY created_at DESC LIMIT 1`,
  );
  if (result.rows.length === 0) return null;
  const r = result.rows[0];
  return {
    recoveryId: r.recovery_id,
    trigger: r.trigger,
    previousMode: r.previous_mode,
    previousState: r.previous_state,
    previousCycleId: r.previous_cycle_id,
    actionsTaken: typeof r.actions_taken === "string" ? JSON.parse(r.actions_taken) : r.actions_taken,
    status: r.status,
    completedAt: r.completed_at?.toISOString() ?? null,
    createdAt: r.created_at?.toISOString() ?? new Date().toISOString(),
  };
}
