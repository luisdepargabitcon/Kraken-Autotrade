/**
 * AMA Functional Closure Services — R2.22-R2.31
 *
 * Three persistent singleton services backed by migration 084:
 * 1. AmaRealStateService — persistent REAL_LIMITED state machine
 * 2. AmaSchedulerStateService — scheduler tick state for restart recovery
 * 3. AmaHwmBootstrapService — HWM bootstrap process state
 *
 * All use singleton tables (id=1) from migration 084.
 */

import { pool } from "../../db";

// ─── 1. AMA Real State Machine ──────────────────────────────────────

export type AmaRealOperationalState =
  | "NOT_READY"
  | "READY_DISABLED"
  | "ARMED"
  | "ACTIVE"
  | "PAUSED_BY_USER"
  | "PAUSED_BY_RESTART"
  | "DISABLED_BY_USER"
  | "AUTO_BLOCKED"
  | "KILL_SWITCHED"
  | "EXPIRED";

export interface AmaRealState {
  operationalState: AmaRealOperationalState;
  previousState: string | null;
  transitionReason: string | null;
  transitionedAt: string | null;
  transitionedBy: string | null;
  requiresManualResume: boolean;
  autoBlockReason: string | null;
  killSwitchActive: boolean;
  killSwitchReason: string | null;
  killSwitchAt: string | null;
  updatedAt: string;
}

class AmaRealStateService {
  async getState(): Promise<AmaRealState> {
    const res = await pool.query(`SELECT * FROM ama_real_state WHERE id = 1`);
    const r = res.rows[0];
    return {
      operationalState: r.operational_state,
      previousState: r.previous_state,
      transitionReason: r.transition_reason,
      transitionedAt: r.transitioned_at,
      transitionedBy: r.transitioned_by,
      requiresManualResume: r.requires_manual_resume,
      autoBlockReason: r.auto_block_reason,
      killSwitchActive: r.kill_switch_active,
      killSwitchReason: r.kill_switch_reason,
      killSwitchAt: r.kill_switch_at,
      updatedAt: r.updated_at,
    };
  }

  async transition(
    newState: AmaRealOperationalState,
    reason: string,
    transitionedBy?: string,
  ): Promise<AmaRealState> {
    const current = await this.getState();
    const res = await pool.query(
      `UPDATE ama_real_state
       SET operational_state = $1,
           previous_state = $2,
           transition_reason = $3,
           transitioned_at = NOW(),
           transitioned_by = $4,
           updated_at = NOW()
       WHERE id = 1
       RETURNING *`,
      [newState, current.operationalState, reason, transitionedBy ?? null],
    );
    const r = res.rows[0];
    return {
      operationalState: r.operational_state,
      previousState: r.previous_state,
      transitionReason: r.transition_reason,
      transitionedAt: r.transitioned_at,
      transitionedBy: r.transitioned_by,
      requiresManualResume: r.requires_manual_resume,
      autoBlockReason: r.auto_block_reason,
      killSwitchActive: r.kill_switch_active,
      killSwitchReason: r.kill_switch_reason,
      killSwitchAt: r.kill_switch_at,
      updatedAt: r.updated_at,
    };
  }

  async activateKillSwitch(reason: string): Promise<AmaRealState> {
    const current = await this.getState();
    const res = await pool.query(
      `UPDATE ama_real_state
       SET operational_state = 'KILL_SWITCHED',
           previous_state = $1,
           kill_switch_active = TRUE,
           kill_switch_reason = $2,
           kill_switch_at = NOW(),
           requires_manual_resume = TRUE,
           updated_at = NOW()
       WHERE id = 1
       RETURNING *`,
      [current.operationalState, reason],
    );
    const r = res.rows[0];
    return {
      operationalState: r.operational_state,
      previousState: r.previous_state,
      transitionReason: r.transition_reason,
      transitionedAt: r.transitioned_at,
      transitionedBy: r.transitioned_by,
      requiresManualResume: r.requires_manual_resume,
      autoBlockReason: r.auto_block_reason,
      killSwitchActive: r.kill_switch_active,
      killSwitchReason: r.kill_switch_reason,
      killSwitchAt: r.kill_switch_at,
      updatedAt: r.updated_at,
    };
  }

  async clearKillSwitch(): Promise<AmaRealState> {
    await pool.query(
      `UPDATE ama_real_state
       SET kill_switch_active = FALSE,
           kill_switch_reason = NULL,
           kill_switch_at = NULL,
           requires_manual_resume = FALSE,
           updated_at = NOW()
       WHERE id = 1`,
    );
    return this.getState();
  }

  async autoBlock(reason: string): Promise<AmaRealState> {
    return this.transition("AUTO_BLOCKED", reason, "SYSTEM");
  }

  async canExecute(): Promise<boolean> {
    const state = await this.getState();
    return state.operationalState === "ACTIVE" && !state.killSwitchActive;
  }
}

// ─── 2. AMA Scheduler State ──────────────────────────────────────────

export interface AmaSchedulerState {
  currentMode: string;
  lastTickAt: string | null;
  lastCycleId: string | null;
  tickCount: number;
  errorCount: number;
  lastError: string | null;
  advisoryLockHeld: boolean;
  updatedAt: string;
}

class AmaSchedulerStateService {
  async getState(): Promise<AmaSchedulerState> {
    const res = await pool.query(`SELECT * FROM ama_scheduler_state WHERE id = 1`);
    const r = res.rows[0];
    return {
      currentMode: r.current_mode,
      lastTickAt: r.last_tick_at,
      lastCycleId: r.last_cycle_id,
      tickCount: parseInt(r.tick_count, 10),
      errorCount: parseInt(r.error_count, 10),
      lastError: r.last_error,
      advisoryLockHeld: r.advisory_lock_held,
      updatedAt: r.updated_at,
    };
  }

  async recordTick(cycleId?: string): Promise<void> {
    await pool.query(
      `UPDATE ama_scheduler_state
       SET last_tick_at = NOW(),
           last_cycle_id = COALESCE($1, last_cycle_id),
           tick_count = tick_count + 1,
           updated_at = NOW()
       WHERE id = 1`,
      [cycleId ?? null],
    );
  }

  async recordError(error: string): Promise<void> {
    await pool.query(
      `UPDATE ama_scheduler_state
       SET error_count = error_count + 1,
           last_error = $1,
           updated_at = NOW()
       WHERE id = 1`,
      [error],
    );
  }

  async setMode(mode: string): Promise<void> {
    await pool.query(
      `UPDATE ama_scheduler_state
       SET current_mode = $1, updated_at = NOW()
       WHERE id = 1`,
      [mode],
    );
  }

  async acquireAdvisoryLock(): Promise<boolean> {
    const res = await pool.query(
      `UPDATE ama_scheduler_state
       SET advisory_lock_held = TRUE, updated_at = NOW()
       WHERE id = 1 AND advisory_lock_held = FALSE
       RETURNING id`,
    );
    return res.rows.length > 0;
  }

  async releaseAdvisoryLock(): Promise<void> {
    await pool.query(
      `UPDATE ama_scheduler_state
       SET advisory_lock_held = FALSE, updated_at = NOW()
       WHERE id = 1`,
    );
  }
}

// ─── 3. AMA HWM Bootstrap ────────────────────────────────────────────

export type HwmBootstrapStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "FAILED";

export interface AmaHwmBootstrapState {
  pair: string;
  hwm: number | null;
  hwmTimestamp: string | null;
  bootstrapStatus: HwmBootstrapStatus;
  dataCoveragePct: number;
  candlesProcessed: number;
  candlesTotal: number;
  errorMessage: string | null;
  updatedAt: string;
}

class AmaHwmBootstrapService {
  async getState(): Promise<AmaHwmBootstrapState> {
    const res = await pool.query(`SELECT * FROM ama_hwm_bootstrap WHERE id = 1`);
    const r = res.rows[0];
    return {
      pair: r.pair,
      hwm: r.hwm !== null ? parseFloat(r.hwm) : null,
      hwmTimestamp: r.hwm_timestamp,
      bootstrapStatus: r.bootstrap_status,
      dataCoveragePct: parseFloat(r.data_coverage_pct),
      candlesProcessed: parseInt(r.candles_processed, 10),
      candlesTotal: parseInt(r.candles_total, 10),
      errorMessage: r.error_message,
      updatedAt: r.updated_at,
    };
  }

  async startBootstrap(pair: string, candlesTotal: number): Promise<void> {
    await pool.query(
      `UPDATE ama_hwm_bootstrap
       SET pair = $1,
           bootstrap_status = 'IN_PROGRESS',
           candles_processed = 0,
           candles_total = $2,
           data_coverage_pct = 0,
           error_message = NULL,
           hwm = NULL,
           hwm_timestamp = NULL,
           updated_at = NOW()
       WHERE id = 1`,
      [pair, candlesTotal],
    );
  }

  async updateProgress(candlesProcessed: number, currentHwm: number | null): Promise<void> {
    const state = await this.getState();
    const coveragePct = state.candlesTotal > 0
      ? (candlesProcessed / state.candlesTotal) * 100
      : 0;

    const hwmToSet = currentHwm !== null &&
      (state.hwm === null || currentHwm > state.hwm)
      ? currentHwm
      : state.hwm;

    await pool.query(
      `UPDATE ama_hwm_bootstrap
       SET candles_processed = $1,
           data_coverage_pct = $2,
           hwm = COALESCE($3, hwm),
           updated_at = NOW()
       WHERE id = 1`,
      [candlesProcessed, coveragePct, hwmToSet],
    );
  }

  async completeBootstrap(hwm: number, hwmTimestamp: string): Promise<void> {
    await pool.query(
      `UPDATE ama_hwm_bootstrap
       SET bootstrap_status = 'COMPLETED',
           hwm = $1,
           hwm_timestamp = $2,
           data_coverage_pct = 100,
           candles_processed = candles_total,
           error_message = NULL,
           updated_at = NOW()
       WHERE id = 1`,
      [hwm, hwmTimestamp],
    );
  }

  async failBootstrap(error: string): Promise<void> {
    await pool.query(
      `UPDATE ama_hwm_bootstrap
       SET bootstrap_status = 'FAILED',
           error_message = $1,
           updated_at = NOW()
       WHERE id = 1`,
      [error],
    );
  }

  async isReady(): Promise<boolean> {
    const state = await this.getState();
    return state.bootstrapStatus === "COMPLETED" && state.hwm !== null;
  }
}

export const amaRealStateService = new AmaRealStateService();
export const amaSchedulerStateService = new AmaSchedulerStateService();
export const amaHwmBootstrapService = new AmaHwmBootstrapService();
