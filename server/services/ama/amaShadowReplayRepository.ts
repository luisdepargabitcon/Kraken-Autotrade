/**
 * AMA Shadow & Replay Repository — PostgreSQL persistence for shadow orders,
 * replay runs, lab sessions, and shadow scenarios.
 *
 * Append-only for shadow orders, replay events, and lab results.
 */

import { pool } from "../../db";

// ─── Shadow Orders ───────────────────────────────────────────────────

export interface ShadowOrderRow {
  orderId: string;
  cycleId: string;
  trancheId: string;
  pair: string;
  side: string;
  orderType: string;
  price: number;
  quantity: number;
  amountUsd: number;
  status: string;
  simulatedFillPrice: number | null;
  simulatedFillTimestamp: string | null;
  rejectionReason: string | null;
  shadowMode: string;
  scenarioId: string | null;
  createdAt: string;
}

export async function insertShadowOrder(
  order: ShadowOrderRow,
  client?: import("pg").PoolClient,
): Promise<void> {
  const q = client ?? pool;
  await q.query(
    `INSERT INTO ama_shadow_orders
      (order_id, cycle_id, tranche_id, pair, side, order_type, price, quantity,
       amount_usd, status, simulated_fill_price, simulated_fill_timestamp,
       rejection_reason, shadow_mode, scenario_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     ON CONFLICT (order_id) DO NOTHING`,
    [
      order.orderId, order.cycleId, order.trancheId, order.pair,
      order.side, order.orderType, order.price, order.quantity,
      order.amountUsd, order.status, order.simulatedFillPrice,
      order.simulatedFillTimestamp, order.rejectionReason,
      order.shadowMode, order.scenarioId, order.createdAt,
    ],
  );
}

export async function updateShadowOrderStatus(
  orderId: string,
  status: string,
  simulatedFillPrice?: number,
  simulatedFillTimestamp?: string,
  rejectionReason?: string,
): Promise<void> {
  if (simulatedFillPrice !== undefined) {
    await pool.query(
      `UPDATE ama_shadow_orders
       SET status = $1, simulated_fill_price = $2, simulated_fill_timestamp = $3
       WHERE order_id = $4`,
      [status, simulatedFillPrice, simulatedFillTimestamp ?? null, orderId],
    );
  } else if (rejectionReason !== undefined) {
    await pool.query(
      `UPDATE ama_shadow_orders
       SET status = $1, rejection_reason = $2
       WHERE order_id = $3`,
      [status, rejectionReason, orderId],
    );
  } else {
    await pool.query(
      `UPDATE ama_shadow_orders SET status = $1 WHERE order_id = $2`,
      [status, orderId],
    );
  }
}

export async function getShadowOrdersByCycle(cycleId: string): Promise<ShadowOrderRow[]> {
  const result = await pool.query(
    `SELECT * FROM ama_shadow_orders WHERE cycle_id = $1 ORDER BY created_at ASC`,
    [cycleId],
  );
  return result.rows.map(mapShadowOrderRow);
}

export async function getShadowOrdersByScenario(scenarioId: string): Promise<ShadowOrderRow[]> {
  const result = await pool.query(
    `SELECT * FROM ama_shadow_orders WHERE scenario_id = $1 ORDER BY created_at ASC`,
    [scenarioId],
  );
  return result.rows.map(mapShadowOrderRow);
}

function mapShadowOrderRow(r: any): ShadowOrderRow {
  return {
    orderId: r.order_id as string,
    cycleId: r.cycle_id as string,
    trancheId: r.tranche_id as string,
    pair: r.pair as string,
    side: r.side as string,
    orderType: r.order_type as string,
    price: Number(r.price),
    quantity: Number(r.quantity),
    amountUsd: Number(r.amount_usd),
    status: r.status as string,
    simulatedFillPrice: r.simulated_fill_price !== null ? Number(r.simulated_fill_price) : null,
    simulatedFillTimestamp: r.simulated_fill_timestamp?.toISOString() ?? null,
    rejectionReason: r.rejection_reason ?? null,
    shadowMode: r.shadow_mode as string,
    scenarioId: r.scenario_id ?? null,
    createdAt: r.created_at?.toISOString() ?? new Date().toISOString(),
  };
}

// ─── Replay Runs ─────────────────────────────────────────────────────

export interface ReplayRunRow {
  replayRunId: string;
  asset: string;
  pair: string;
  startDate: string;
  endDate: string;
  initialCapitalUsd: number;
  status: string;
  configJson: Record<string, unknown>;
  resultJson: Record<string, unknown> | null;
  totalTranchesExecuted: number;
  totalUsdDeployed: number;
  finalQuantity: number;
  finalValueUsd: number | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export async function insertReplayRun(run: ReplayRunRow): Promise<void> {
  await pool.query(
    `INSERT INTO ama_replay_runs
      (replay_run_id, asset, pair, start_date, end_date, initial_capital_usd,
       status, config_json, result_json, total_tranches_executed, total_usd_deployed,
       final_quantity, final_value_usd, error_message, started_at, completed_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     ON CONFLICT (replay_run_id) DO NOTHING`,
    [
      run.replayRunId, run.asset, run.pair, run.startDate, run.endDate,
      run.initialCapitalUsd, run.status, JSON.stringify(run.configJson),
      run.resultJson ? JSON.stringify(run.resultJson) : null,
      run.totalTranchesExecuted, run.totalUsdDeployed, run.finalQuantity,
      run.finalValueUsd, run.errorMessage, run.startedAt, run.completedAt,
      run.createdAt,
    ],
  );
}

export async function updateReplayRunStatus(
  replayRunId: string,
  status: string,
  updates?: Partial<{
    resultJson: Record<string, unknown>;
    totalTranchesExecuted: number;
    totalUsdDeployed: number;
    finalQuantity: number;
    finalValueUsd: number | null;
    errorMessage: string;
    completedAt: string;
  }>,
): Promise<void> {
  const sets: string[] = [`status = $1`];
  const values: (string | number | Record<string, unknown> | null)[] = [status];
  let idx = 2;

  if (updates?.resultJson !== undefined) {
    sets.push(`result_json = $${idx++}`);
    values.push(JSON.stringify(updates.resultJson));
  }
  if (updates?.totalTranchesExecuted !== undefined) {
    sets.push(`total_tranches_executed = $${idx++}`);
    values.push(updates.totalTranchesExecuted);
  }
  if (updates?.totalUsdDeployed !== undefined) {
    sets.push(`total_usd_deployed = $${idx++}`);
    values.push(updates.totalUsdDeployed);
  }
  if (updates?.finalQuantity !== undefined) {
    sets.push(`final_quantity = $${idx++}`);
    values.push(updates.finalQuantity);
  }
  if (updates?.finalValueUsd !== undefined) {
    sets.push(`final_value_usd = $${idx++}`);
    values.push(updates.finalValueUsd);
  }
  if (updates?.errorMessage !== undefined) {
    sets.push(`error_message = $${idx++}`);
    values.push(updates.errorMessage);
  }
  if (updates?.completedAt !== undefined) {
    sets.push(`completed_at = $${idx++}`);
    values.push(updates.completedAt);
  }

  values.push(replayRunId);
  await pool.query(
    `UPDATE ama_replay_runs SET ${sets.join(", ")} WHERE replay_run_id = $${idx}`,
    values,
  );
}

export async function getReplayRunById(replayRunId: string): Promise<ReplayRunRow | null> {
  const result = await pool.query(
    `SELECT * FROM ama_replay_runs WHERE replay_run_id = $1`,
    [replayRunId],
  );
  if (result.rows.length === 0) return null;
  return mapReplayRunRow(result.rows[0]);
}

export async function getReplayRuns(limit: number = 20): Promise<ReplayRunRow[]> {
  const result = await pool.query(
    `SELECT * FROM ama_replay_runs ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
  return result.rows.map(mapReplayRunRow);
}

function mapReplayRunRow(r: any): ReplayRunRow {
  return {
    replayRunId: r.replay_run_id as string,
    asset: r.asset as string,
    pair: r.pair as string,
    startDate: r.start_date?.toISOString() ?? new Date().toISOString(),
    endDate: r.end_date?.toISOString() ?? new Date().toISOString(),
    initialCapitalUsd: Number(r.initial_capital_usd),
    status: r.status as string,
    configJson: typeof r.config_json === "string" ? JSON.parse(r.config_json) : r.config_json,
    resultJson: r.result_json
      ? (typeof r.result_json === "string" ? JSON.parse(r.result_json) : r.result_json)
      : null,
    totalTranchesExecuted: r.total_tranches_executed as number,
    totalUsdDeployed: Number(r.total_usd_deployed),
    finalQuantity: Number(r.final_quantity),
    finalValueUsd: r.final_value_usd !== null ? Number(r.final_value_usd) : null,
    errorMessage: r.error_message ?? null,
    startedAt: r.started_at?.toISOString() ?? null,
    completedAt: r.completed_at?.toISOString() ?? null,
    createdAt: r.created_at?.toISOString() ?? new Date().toISOString(),
  };
}

// ─── Replay Events ───────────────────────────────────────────────────

export async function insertReplayEvent(
  replayRunId: string,
  eventSeq: number,
  eventType: string,
  timestampSimulated: string,
  price: number | null,
  data: Record<string, unknown>,
  client?: import("pg").PoolClient,
): Promise<void> {
  const q = client ?? pool;
  await q.query(
    `INSERT INTO ama_replay_events
      (replay_run_id, event_seq, event_type, timestamp_simulated, price, data)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (replay_run_id, event_seq) DO NOTHING`,
    [replayRunId, eventSeq, eventType, timestampSimulated, price, JSON.stringify(data)],
  );
}

export async function getReplayEvents(replayRunId: string): Promise<Record<string, unknown>[]> {
  const result = await pool.query(
    `SELECT * FROM ama_replay_events WHERE replay_run_id = $1 ORDER BY event_seq ASC`,
    [replayRunId],
  );
  return result.rows;
}

// ─── Lab Sessions ────────────────────────────────────────────────────

export interface LabSessionRow {
  labSessionId: string;
  asset: string;
  pair: string;
  scenarioName: string;
  configJson: Record<string, unknown>;
  status: string;
  resultJson: Record<string, unknown> | null;
  totalTranchesPlanned: number;
  totalTranchesSimulated: number;
  totalUsdSimulated: number;
  finalQuantity: number;
  finalValueUsd: number | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export async function insertLabSession(session: LabSessionRow): Promise<void> {
  await pool.query(
    `INSERT INTO ama_lab_sessions
      (lab_session_id, asset, pair, scenario_name, config_json, status,
       result_json, total_tranches_planned, total_tranches_simulated,
       total_usd_simulated, final_quantity, final_value_usd, error_message,
       started_at, completed_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     ON CONFLICT (lab_session_id) DO NOTHING`,
    [
      session.labSessionId, session.asset, session.pair, session.scenarioName,
      JSON.stringify(session.configJson), session.status,
      session.resultJson ? JSON.stringify(session.resultJson) : null,
      session.totalTranchesPlanned, session.totalTranchesSimulated,
      session.totalUsdSimulated, session.finalQuantity, session.finalValueUsd,
      session.errorMessage, session.startedAt, session.completedAt, session.createdAt,
    ],
  );
}

export async function updateLabSessionStatus(
  labSessionId: string,
  status: string,
  updates?: Partial<{
    resultJson: Record<string, unknown>;
    totalTranchesPlanned: number;
    totalTranchesSimulated: number;
    totalUsdSimulated: number;
    finalQuantity: number;
    finalValueUsd: number | null;
    errorMessage: string;
    completedAt: string;
  }>,
): Promise<void> {
  const sets: string[] = [`status = $1`];
  const values: (string | number | Record<string, unknown> | null)[] = [status];
  let idx = 2;

  if (updates?.resultJson !== undefined) {
    sets.push(`result_json = $${idx++}`);
    values.push(JSON.stringify(updates.resultJson));
  }
  if (updates?.totalTranchesPlanned !== undefined) {
    sets.push(`total_tranches_planned = $${idx++}`);
    values.push(updates.totalTranchesPlanned);
  }
  if (updates?.totalTranchesSimulated !== undefined) {
    sets.push(`total_tranches_simulated = $${idx++}`);
    values.push(updates.totalTranchesSimulated);
  }
  if (updates?.totalUsdSimulated !== undefined) {
    sets.push(`total_usd_simulated = $${idx++}`);
    values.push(updates.totalUsdSimulated);
  }
  if (updates?.finalQuantity !== undefined) {
    sets.push(`final_quantity = $${idx++}`);
    values.push(updates.finalQuantity);
  }
  if (updates?.finalValueUsd !== undefined) {
    sets.push(`final_value_usd = $${idx++}`);
    values.push(updates.finalValueUsd);
  }
  if (updates?.errorMessage !== undefined) {
    sets.push(`error_message = $${idx++}`);
    values.push(updates.errorMessage);
  }
  if (updates?.completedAt !== undefined) {
    sets.push(`completed_at = $${idx++}`);
    values.push(updates.completedAt);
  }

  values.push(labSessionId);
  await pool.query(
    `UPDATE ama_lab_sessions SET ${sets.join(", ")} WHERE lab_session_id = $${idx}`,
    values,
  );
}

export async function getLabSessionById(labSessionId: string): Promise<LabSessionRow | null> {
  const result = await pool.query(
    `SELECT * FROM ama_lab_sessions WHERE lab_session_id = $1`,
    [labSessionId],
  );
  if (result.rows.length === 0) return null;
  return mapLabSessionRow(result.rows[0]);
}

export async function getLabSessions(limit: number = 20): Promise<LabSessionRow[]> {
  const result = await pool.query(
    `SELECT * FROM ama_lab_sessions ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
  return result.rows.map(mapLabSessionRow);
}

function mapLabSessionRow(r: any): LabSessionRow {
  return {
    labSessionId: r.lab_session_id as string,
    asset: r.asset as string,
    pair: r.pair as string,
    scenarioName: r.scenario_name as string,
    configJson: typeof r.config_json === "string" ? JSON.parse(r.config_json) : r.config_json,
    resultJson: r.result_json
      ? (typeof r.result_json === "string" ? JSON.parse(r.result_json) : r.result_json)
      : null,
    status: r.status as string,
    totalTranchesPlanned: r.total_tranches_planned as number,
    totalTranchesSimulated: r.total_tranches_simulated as number,
    totalUsdSimulated: Number(r.total_usd_simulated),
    finalQuantity: Number(r.final_quantity),
    finalValueUsd: r.final_value_usd !== null ? Number(r.final_value_usd) : null,
    errorMessage: r.error_message ?? null,
    startedAt: r.started_at?.toISOString() ?? null,
    completedAt: r.completed_at?.toISOString() ?? null,
    createdAt: r.created_at?.toISOString() ?? new Date().toISOString(),
  };
}

// ─── Shadow Scenarios ────────────────────────────────────────────────

export interface ShadowScenarioRow {
  scenarioId: string;
  name: string;
  description: string | null;
  asset: string;
  pair: string;
  configJson: Record<string, unknown>;
  status: string;
  totalOrders: number;
  totalFilled: number;
  totalSimulatedUsd: number;
  createdAt: string;
  updatedAt: string;
}

export async function insertShadowScenario(scenario: ShadowScenarioRow): Promise<void> {
  await pool.query(
    `INSERT INTO ama_shadow_scenarios
      (scenario_id, name, description, asset, pair, config_json, status,
       total_orders, total_filled, total_simulated_usd, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (scenario_id) DO NOTHING`,
    [
      scenario.scenarioId, scenario.name, scenario.description,
      scenario.asset, scenario.pair, JSON.stringify(scenario.configJson),
      scenario.status, scenario.totalOrders, scenario.totalFilled,
      scenario.totalSimulatedUsd, scenario.createdAt, scenario.updatedAt,
    ],
  );
}

export async function getShadowScenarios(): Promise<ShadowScenarioRow[]> {
  const result = await pool.query(
    `SELECT * FROM ama_shadow_scenarios ORDER BY created_at DESC`,
  );
  return result.rows.map(mapShadowScenarioRow);
}

export async function getShadowScenarioById(scenarioId: string): Promise<ShadowScenarioRow | null> {
  const result = await pool.query(
    `SELECT * FROM ama_shadow_scenarios WHERE scenario_id = $1`,
    [scenarioId],
  );
  if (result.rows.length === 0) return null;
  return mapShadowScenarioRow(result.rows[0]);
}

export async function updateShadowScenarioStatus(
  scenarioId: string,
  status: string,
): Promise<void> {
  await pool.query(
    `UPDATE ama_shadow_scenarios SET status = $1, updated_at = NOW() WHERE scenario_id = $2`,
    [status, scenarioId],
  );
}

function mapShadowScenarioRow(r: any): ShadowScenarioRow {
  return {
    scenarioId: r.scenario_id as string,
    name: r.name as string,
    description: r.description ?? null,
    asset: r.asset as string,
    pair: r.pair as string,
    configJson: typeof r.config_json === "string" ? JSON.parse(r.config_json) : r.config_json,
    status: r.status as string,
    totalOrders: r.total_orders as number,
    totalFilled: r.total_filled as number,
    totalSimulatedUsd: Number(r.total_simulated_usd),
    createdAt: r.created_at?.toISOString() ?? new Date().toISOString(),
    updatedAt: r.updated_at?.toISOString() ?? new Date().toISOString(),
  };
}
