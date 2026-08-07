/**
 * AMA Runtime Repository — PostgreSQL persistence layer.
 *
 * Provides transactional, append-only CRUD for AMA runtime tables.
 * Uses pg Pool for explicit transaction control.
 *
 * SAFETY:
 * - All financial mutations are append-only or within explicit transactions.
 * - No DELETE operations on financial/audit tables.
 * - Restart-safe: state is persisted, not in-memory.
 */

import { pool } from "../../db";
import type {
  AmaMode,
  AmaState,
  AmaProtectionState,
  AmaCycle,
  AmaTranche,
  AmaTranchePlan,
  AmaTrancheCandidate,
  AmaResolvedPolicy,
  AmaMandateInput,
  PolicyStatus,
  TrancheType,
  OrderIntentStatus,
  SleeveType,
  MacroZone,
} from "./amaTypes";
import type { AssetSymbol } from "./amaSeedTypes";

// ─── Runtime State ───────────────────────────────────────────────────

export interface AmaRuntimeStateRow {
  mode: string;
  state: string;
  protectionState: string | null;
  killSwitchActive: boolean;
  autoBlockActive: boolean;
  autoBlockReason: string | null;
  activeCycleId: string | null;
  activeMandateId: string | null;
  activePolicyId: string | null;
  lastTickAt: string | null;
  lastReconciliationAt: string | null;
  restartCount: number;
  updatedAt: string;
}

export async function getRuntimeState(): Promise<AmaRuntimeStateRow | null> {
  const result = await pool.query(
    `SELECT mode, state, protection_state, kill_switch_active, auto_block_active,
            auto_block_reason, active_cycle_id, active_mandate_id, active_policy_id,
            last_tick_at, last_reconciliation_at, restart_count, updated_at
     FROM ama_runtime_state WHERE id = 1`,
  );
  if (result.rows.length === 0) return null;
  const r = result.rows[0];
  return {
    mode: r.mode,
    state: r.state,
    protectionState: r.protection_state,
    killSwitchActive: r.kill_switch_active,
    autoBlockActive: r.auto_block_active,
    autoBlockReason: r.auto_block_reason,
    activeCycleId: r.active_cycle_id,
    activeMandateId: r.active_mandate_id,
    activePolicyId: r.active_policy_id,
    lastTickAt: r.last_tick_at?.toISOString() ?? null,
    lastReconciliationAt: r.last_reconciliation_at?.toISOString() ?? null,
    restartCount: r.restart_count,
    updatedAt: r.updated_at?.toISOString() ?? new Date().toISOString(),
  };
}

export async function updateRuntimeState(
  updates: Partial<{
    mode: AmaMode;
    state: AmaState;
    protectionState: AmaProtectionState | null;
    killSwitchActive: boolean;
    autoBlockActive: boolean;
    autoBlockReason: string | null;
    activeCycleId: string | null;
    activeMandateId: string | null;
    activePolicyId: string | null;
    lastTickAt: string;
    lastReconciliationAt: string;
  }>,
): Promise<void> {
  const sets: string[] = [];
  const values: (string | boolean | null)[] = [];
  let idx = 1;

  if (updates.mode !== undefined) {
    sets.push(`mode = $${idx++}`);
    values.push(updates.mode);
  }
  if (updates.state !== undefined) {
    sets.push(`state = $${idx++}`);
    values.push(updates.state);
  }
  if (updates.protectionState !== undefined) {
    sets.push(`protection_state = $${idx++}`);
    values.push(updates.protectionState);
  }
  if (updates.killSwitchActive !== undefined) {
    sets.push(`kill_switch_active = $${idx++}`);
    values.push(updates.killSwitchActive);
  }
  if (updates.autoBlockActive !== undefined) {
    sets.push(`auto_block_active = $${idx++}`);
    values.push(updates.autoBlockActive);
  }
  if (updates.autoBlockReason !== undefined) {
    sets.push(`auto_block_reason = $${idx++}`);
    values.push(updates.autoBlockReason);
  }
  if (updates.activeCycleId !== undefined) {
    sets.push(`active_cycle_id = $${idx++}`);
    values.push(updates.activeCycleId);
  }
  if (updates.activeMandateId !== undefined) {
    sets.push(`active_mandate_id = $${idx++}`);
    values.push(updates.activeMandateId);
  }
  if (updates.activePolicyId !== undefined) {
    sets.push(`active_policy_id = $${idx++}`);
    values.push(updates.activePolicyId);
  }
  if (updates.lastTickAt !== undefined) {
    sets.push(`last_tick_at = $${idx++}`);
    values.push(updates.lastTickAt);
  }
  if (updates.lastReconciliationAt !== undefined) {
    sets.push(`last_reconciliation_at = $${idx++}`);
    values.push(updates.lastReconciliationAt);
  }

  sets.push(`updated_at = NOW()`);

  if (sets.length === 1) return; // only updated_at

  await pool.query(
    `UPDATE ama_runtime_state SET ${sets.join(", ")} WHERE id = 1`,
    values,
  );
}

export async function incrementRestartCount(): Promise<void> {
  await pool.query(
    `UPDATE ama_runtime_state SET restart_count = restart_count + 1, updated_at = NOW() WHERE id = 1`,
  );
}

// ─── Cycle Repository ────────────────────────────────────────────────

export async function insertCycle(
  cycle: AmaCycle,
  client?: import("pg").PoolClient,
): Promise<void> {
  const q = client ?? pool;
  await q.query(
    `INSERT INTO ama_cycles
      (cycle_id, asset, pair, mode, state, high_water_mark, ceiling_confirmed_at,
       cycle_low, cycle_low_at, max_drop_pct, current_drop_pct, rebound_from_low_pct,
       budget_usd, deployed_usd, reserved_usd, free_usd, accumulated_quantity,
       average_cost_basis, active_policy_id, created_at, closed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
     ON CONFLICT (cycle_id) DO NOTHING`,
    [
      cycle.cycleId,
      cycle.asset,
      cycle.pair,
      cycle.mode,
      cycle.state,
      cycle.highWaterMark,
      cycle.ceilingConfirmedAt,
      cycle.cycleLow,
      cycle.cycleLowAt,
      cycle.maxDropPct,
      cycle.currentDropPct,
      cycle.reboundFromLowPct,
      cycle.budgetUsd,
      cycle.deployedUsd,
      cycle.reservedUsd,
      cycle.freeUsd ?? (cycle.budgetUsd - cycle.deployedUsd - cycle.reservedUsd),
      cycle.accumulatedQuantity,
      cycle.averageCostBasis,
      cycle.activePolicyId,
      cycle.createdAt,
      cycle.closedAt,
    ],
  );
}

export async function updateCycleState(
  cycleId: string,
  newState: AmaState,
  client?: import("pg").PoolClient,
): Promise<void> {
  const q = client ?? pool;
  await q.query(
    `UPDATE ama_cycles SET state = $1 WHERE cycle_id = $2`,
    [newState, cycleId],
  );
}

export async function updateCycleBudget(
  cycleId: string,
  deployedUsd: number,
  reservedUsd: number,
  freeUsd: number,
  accumulatedQuantity: number,
  averageCostBasis: number | null,
  client?: import("pg").PoolClient,
): Promise<void> {
  const q = client ?? pool;
  await q.query(
    `UPDATE ama_cycles
     SET deployed_usd = $1, reserved_usd = $2, free_usd = $3,
         accumulated_quantity = $4, average_cost_basis = $5
     WHERE cycle_id = $6`,
    [deployedUsd, reservedUsd, freeUsd, accumulatedQuantity, averageCostBasis, cycleId],
  );
}

export async function closeCycle(
  cycleId: string,
  closedAt: string,
  client?: import("pg").PoolClient,
): Promise<void> {
  const q = client ?? pool;
  await q.query(
    `UPDATE ama_cycles SET state = 'CLOSED', closed_at = $1 WHERE cycle_id = $2`,
    [closedAt, cycleId],
  );
}

export async function getActiveCycle(): Promise<AmaCycle | null> {
  const result = await pool.query(
    `SELECT * FROM ama_cycles WHERE closed_at IS NULL ORDER BY created_at DESC LIMIT 1`,
  );
  if (result.rows.length === 0) return null;
  return mapCycleRow(result.rows[0]);
}

export async function getCycleById(cycleId: string): Promise<AmaCycle | null> {
  const result = await pool.query(
    `SELECT * FROM ama_cycles WHERE cycle_id = $1`,
    [cycleId],
  );
  if (result.rows.length === 0) return null;
  return mapCycleRow(result.rows[0]);
}

export async function getCyclesByAsset(asset: AssetSymbol): Promise<AmaCycle[]> {
  const result = await pool.query(
    `SELECT * FROM ama_cycles WHERE asset = $1 ORDER BY created_at DESC`,
    [asset],
  );
  return result.rows.map(mapCycleRow);
}

function mapCycleRow(r: any): AmaCycle {
  return {
    cycleId: r.cycle_id as string,
    asset: r.asset as AssetSymbol,
    pair: r.pair as string,
    mode: r.mode as AmaMode,
    state: r.state as AmaState,
    highWaterMark: r.high_water_mark !== null ? Number(r.high_water_mark) : null,
    ceilingConfirmedAt: r.ceiling_confirmed_at?.toISOString() ?? null,
    cycleLow: r.cycle_low !== null ? Number(r.cycle_low) : null,
    cycleLowAt: r.cycle_low_at?.toISOString() ?? null,
    maxDropPct: r.max_drop_pct !== null ? Number(r.max_drop_pct) : null,
    currentDropPct: r.current_drop_pct !== null ? Number(r.current_drop_pct) : null,
    reboundFromLowPct: r.rebound_from_low_pct !== null ? Number(r.rebound_from_low_pct) : null,
    budgetUsd: Number(r.budget_usd),
    deployedUsd: Number(r.deployed_usd),
    reservedUsd: Number(r.reserved_usd),
    freeUsd: Number(r.free_usd ?? 0),
    accumulatedQuantity: Number(r.accumulated_quantity),
    averageCostBasis: r.average_cost_basis !== null ? Number(r.average_cost_basis) : null,
    activePolicyId: r.active_policy_id ?? null,
    createdAt: r.created_at?.toISOString() ?? new Date().toISOString(),
    closedAt: r.closed_at?.toISOString() ?? null,
  };
}

// ─── Tranche Repository ──────────────────────────────────────────────

export async function insertTranche(
  tranche: AmaTranche,
  client?: import("pg").PoolClient,
): Promise<void> {
  const q = client ?? pool;
  await q.query(
    `INSERT INTO ama_tranches
      (tranche_id, cycle_id, plan_id, type, status, planned_amount_usd,
       executed_amount_usd, asset_quantity, fill_price, cost_basis,
       sleeve_allocation, remaining_quantity, realized_quantity, created_at, filled_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     ON CONFLICT (tranche_id) DO NOTHING`,
    [
      tranche.trancheId,
      tranche.cycleId,
      null,
      tranche.type,
      tranche.status,
      tranche.plannedAmountUsd,
      tranche.executedAmountUsd,
      tranche.assetQuantity,
      tranche.fillPrice,
      tranche.costBasis,
      tranche.sleeveAllocation,
      tranche.remainingQuantity,
      tranche.realizedQuantity,
      tranche.createdAt,
      tranche.filledAt,
    ],
  );
}

export async function getTranchesByCycle(cycleId: string): Promise<AmaTranche[]> {
  const result = await pool.query(
    `SELECT * FROM ama_tranches WHERE cycle_id = $1 ORDER BY created_at ASC`,
    [cycleId],
  );
  return result.rows.map(mapTrancheRow);
}

export async function updateTrancheStatus(
  trancheId: string,
  status: OrderIntentStatus,
  client?: import("pg").PoolClient,
): Promise<void> {
  const q = client ?? pool;
  await q.query(
    `UPDATE ama_tranches SET status = $1 WHERE tranche_id = $2`,
    [status, trancheId],
  );
}

export async function fillTranche(
  trancheId: string,
  executedAmountUsd: number,
  assetQuantity: number,
  fillPrice: number,
  costBasis: number,
  remainingQuantity: number,
  realizedQuantity: number,
  filledAt: string,
  client?: import("pg").PoolClient,
): Promise<void> {
  const q = client ?? pool;
  await q.query(
    `UPDATE ama_tranches
     SET status = 'COMPLETED', executed_amount_usd = $1, asset_quantity = $2,
         fill_price = $3, cost_basis = $4, remaining_quantity = $5,
         realized_quantity = $6, filled_at = $7
     WHERE tranche_id = $8`,
    [executedAmountUsd, assetQuantity, fillPrice, costBasis, remainingQuantity, realizedQuantity, filledAt, trancheId],
  );
}

function mapTrancheRow(r: any): AmaTranche {
  return {
    trancheId: r.tranche_id as string,
    cycleId: r.cycle_id as string,
    type: r.type as TrancheType,
    status: r.status as OrderIntentStatus,
    plannedAmountUsd: Number(r.planned_amount_usd),
    executedAmountUsd: Number(r.executed_amount_usd),
    assetQuantity: Number(r.asset_quantity),
    fillPrice: r.fill_price !== null ? Number(r.fill_price) : null,
    costBasis: r.cost_basis !== null ? Number(r.cost_basis) : null,
    sleeveAllocation: r.sleeve_allocation as SleeveType,
    remainingQuantity: Number(r.remaining_quantity),
    realizedQuantity: Number(r.realized_quantity),
    createdAt: r.created_at?.toISOString() ?? new Date().toISOString(),
    filledAt: r.filled_at?.toISOString() ?? null,
  };
}

// ─── Tranche Plan Repository ─────────────────────────────────────────

export async function insertTranchePlan(
  plan: AmaTranchePlan,
  client?: import("pg").PoolClient,
): Promise<void> {
  const q = client ?? pool;
  await q.query(
    `INSERT INTO ama_tranche_plans
      (plan_id, cycle_id, asset, policy_id, policy_version, version,
       planned_purchase_count, mandatory_reserve_usd, deployable_cycle_capital_usd,
       hwm_price, hwm_timestamp, as_of_confirmed_close_price, as_of_confirmed_close_timestamp,
       effective_deployment_pct, effective_reserve_pct, effective_deployable_pct,
       risk_overlay_multiplier, plan_hash, candidate_tranches, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
     ON CONFLICT (plan_id) DO NOTHING`,
    [
      plan.planId,
      plan.cycleId,
      plan.candidateTranches[0]?.asset ?? "BTC",
      plan.candidateTranches[0]?.policyId ?? "UNKNOWN",
      plan.candidateTranches[0]?.policyVersion ?? 1,
      plan.version,
      plan.plannedPurchaseCount,
      plan.mandatoryReserveUsd,
      plan.deployableCycleCapitalUsd,
      plan.hwmPrice,
      plan.hwmTimestamp,
      plan.asOfConfirmedClosePrice,
      plan.asOfConfirmedCloseTimestamp,
      plan.effectiveDeploymentPct,
      plan.effectiveReservePct,
      plan.effectiveDeployablePct,
      1, // risk_overlay_multiplier default
      "", // plan_hash — computed by caller
      JSON.stringify(plan.candidateTranches),
      plan.createdAt,
    ],
  );
}

export async function getTranchePlansByCycle(cycleId: string): Promise<AmaTranchePlan[]> {
  const result = await pool.query(
    `SELECT * FROM ama_tranche_plans WHERE cycle_id = $1 ORDER BY version DESC`,
    [cycleId],
  );
  return result.rows.map(mapPlanRow);
}

export async function getLatestTranchePlan(cycleId: string): Promise<AmaTranchePlan | null> {
  const result = await pool.query(
    `SELECT * FROM ama_tranche_plans WHERE cycle_id = $1 ORDER BY version DESC LIMIT 1`,
    [cycleId],
  );
  if (result.rows.length === 0) return null;
  return mapPlanRow(result.rows[0]);
}

function mapPlanRow(r: any): AmaTranchePlan {
  const candidates = Array.isArray(r.candidate_tranches)
    ? (r.candidate_tranches as AmaTrancheCandidate[])
    : JSON.parse(r.candidate_tranches as string);
  return {
    planId: r.plan_id as string,
    cycleId: r.cycle_id as string,
    version: r.version as number,
    plannedPurchaseCount: r.planned_purchase_count as number,
    candidateTranches: candidates,
    mandatoryReserveUsd: Number(r.mandatory_reserve_usd),
    deployableCycleCapitalUsd: Number(r.deployable_cycle_capital_usd),
    createdAt: r.created_at?.toISOString() ?? new Date().toISOString(),
    asOfConfirmedCloseTimestamp: r.as_of_confirmed_close_timestamp?.toISOString() ?? new Date().toISOString(),
    asOfConfirmedClosePrice: Number(r.as_of_confirmed_close_price),
    effectiveDeploymentPct: Number(r.effective_deployment_pct),
    effectiveReservePct: Number(r.effective_reserve_pct),
    effectiveDeployablePct: Number(r.effective_deployable_pct),
    hwmPrice: Number(r.hwm_price),
    hwmTimestamp: r.hwm_timestamp?.toISOString() ?? new Date().toISOString(),
  };
}

// ─── Policy Repository ───────────────────────────────────────────────

export async function insertPolicy(
  policy: AmaResolvedPolicy,
  client?: import("pg").PoolClient,
): Promise<void> {
  const q = client ?? pool;
  await q.query(
    `INSERT INTO ama_resolved_policies
      (policy_id, mandate_id, asset, policy_version, user_inputs,
       resolved_parameters, resolver_version, strategy_version, policy_hash,
       status, created_at, approved_at, activated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT (policy_id) DO NOTHING`,
    [
      policy.policyId,
      policy.mandateId,
      policy.userInputs.asset,
      policy.policyVersion,
      JSON.stringify(policy.userInputs),
      JSON.stringify(policy.resolvedParameters),
      policy.resolverVersion,
      policy.strategyVersion,
      policy.policyHash,
      policy.status,
      policy.createdAt,
      policy.approvedAt,
      policy.activatedAt,
    ],
  );
}

export async function getPolicyById(policyId: string): Promise<AmaResolvedPolicy | null> {
  const result = await pool.query(
    `SELECT * FROM ama_resolved_policies WHERE policy_id = $1`,
    [policyId],
  );
  if (result.rows.length === 0) return null;
  return mapPolicyRow(result.rows[0]);
}

export async function getActivePolicy(): Promise<AmaResolvedPolicy | null> {
  const result = await pool.query(
    `SELECT * FROM ama_resolved_policies WHERE status = 'ACTIVE' ORDER BY activated_at DESC LIMIT 1`,
  );
  if (result.rows.length === 0) return null;
  return mapPolicyRow(result.rows[0]);
}

export async function updatePolicyStatus(
  policyId: string,
  status: PolicyStatus,
  client?: import("pg").PoolClient,
): Promise<void> {
  const q = client ?? pool;
  const ts = status === "PENDING_APPROVAL" ? "approved_at" : status === "ACTIVE" ? "activated_at" : null;
  if (ts) {
    await q.query(
      `UPDATE ama_resolved_policies SET status = $1, ${ts} = NOW() WHERE policy_id = $2`,
      [status, policyId],
    );
  } else {
    await q.query(
      `UPDATE ama_resolved_policies SET status = $1 WHERE policy_id = $2`,
      [status, policyId],
    );
  }
}

function mapPolicyRow(r: any): AmaResolvedPolicy {
  const userInputs = typeof r.user_inputs === "string"
    ? JSON.parse(r.user_inputs as string)
    : r.user_inputs;
  const resolvedParameters = typeof r.resolved_parameters === "string"
    ? JSON.parse(r.resolved_parameters as string)
    : r.resolved_parameters;
  return {
    mandateId: r.mandate_id as string,
    policyId: r.policy_id as string,
    policyVersion: r.policy_version as number,
    userInputs: userInputs as AmaMandateInput,
    resolvedParameters: resolvedParameters as AmaResolvedPolicy["resolvedParameters"],
    resolverVersion: r.resolver_version as string,
    strategyVersion: r.strategy_version as string,
    policyHash: r.policy_hash as string,
    status: r.status as PolicyStatus,
    createdAt: r.created_at?.toISOString() ?? new Date().toISOString(),
    approvedAt: r.approved_at?.toISOString() ?? null,
    activatedAt: r.activated_at?.toISOString() ?? null,
  };
}

// ─── Audit Event Repository ──────────────────────────────────────────

export async function insertAuditEvent(
  eventName: string,
  severity: string,
  data: Record<string, unknown>,
  refs?: { cycleId?: string; trancheId?: string; mandateId?: string; policyId?: string },
  client?: import("pg").PoolClient,
): Promise<void> {
  const q = client ?? pool;
  await q.query(
    `INSERT INTO ama_audit_events
      (event_name, cycle_id, tranche_id, mandate_id, policy_id, severity, data)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      eventName,
      refs?.cycleId ?? null,
      refs?.trancheId ?? null,
      refs?.mandateId ?? null,
      refs?.policyId ?? null,
      severity,
      JSON.stringify(data),
    ],
  );
}

export async function getAuditEvents(
  limit: number = 100,
  cycleId?: string,
): Promise<Record<string, unknown>[]> {
  if (cycleId) {
    const result = await pool.query(
      `SELECT * FROM ama_audit_events WHERE cycle_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [cycleId, limit],
    );
    return result.rows;
  }
  const result = await pool.query(
    `SELECT * FROM ama_audit_events ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
  return result.rows;
}

// ─── State Transition Repository ─────────────────────────────────────

export async function insertStateTransition(
  cycleId: string | null,
  fromState: string,
  toState: string,
  reason?: string,
  metadata?: Record<string, unknown>,
  client?: import("pg").PoolClient,
): Promise<void> {
  const q = client ?? pool;
  await q.query(
    `INSERT INTO ama_state_transitions
      (cycle_id, from_state, to_state, reason, metadata)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      cycleId,
      fromState,
      toState,
      reason ?? null,
      metadata ? JSON.stringify(metadata) : null,
    ],
  );
}

// ─── Mode Change Log ─────────────────────────────────────────────────

export async function insertModeChange(
  fromMode: string,
  toMode: string,
  changedBy: string,
  reason?: string,
  previousKillSwitch?: boolean,
  newKillSwitch?: boolean,
): Promise<void> {
  await pool.query(
    `INSERT INTO ama_mode_change_log
      (from_mode, to_mode, changed_by, reason, previous_kill_switch, new_kill_switch)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [fromMode, toMode, changedBy, reason ?? null, previousKillSwitch ?? false, newKillSwitch ?? false],
  );
}

// ─── Transaction Helper ──────────────────────────────────────────────

export async function withTransaction<T>(
  fn: (client: import("pg").PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ─── Schema Check ────────────────────────────────────────────────────

export async function checkAmaSchemaAvailable(): Promise<boolean> {
  try {
    const result = await pool.query(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'ama_cycles'
      ) as exists`,
    );
    return result.rows[0]?.exists === true;
  } catch {
    return false;
  }
}
