/**
 * Smart Exit State Manager
 * Persists state per pair + positionId to prevent spam
 * Only triggers Telegram on state transitions
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { log } from "../utils/logger";

// ============================================================
// STATE DEFINITIONS
// ============================================================

export type SmartExitState =
  | "NORMAL"
  | "BLOCKED_BY_FEE_BAND"
  | "UNBLOCKED"
  | "EXECUTED"
  | "CANCELLED_BY_SIGNAL_DISAPPEAR";

export interface StateTransition {
  previousState: SmartExitState | null;
  newState: SmartExitState;
  shouldNotify: boolean;
  notifyMessage?: string;
}

export interface StateEvaluationInput {
  pair: string;
  positionId: string;
  decision: {
    shouldExit: boolean;
    suppressedByFeeBand: boolean;
    score: number;
    threshold: number;
    regime: string;
    confirmationProgress: number;
    confirmationRequired: number;
    reasons: string[];
    pnlPct: number;
  };
  isPositionOpen: boolean;
}

// ============================================================
// STATE MANAGER
// ============================================================

export class SmartExitStateManager {
  /**
   * Evaluate state transition based on current decision
   * Returns transition info and updates persistent state
   */
  async evaluateTransition(input: StateEvaluationInput): Promise<StateTransition> {
    const { pair, positionId, decision, isPositionOpen } = input;

    try {
      // Get current state from DB
      const currentState = await this.getCurrentState(pair, positionId);

      // Determine new state based on decision
      const newState = this.computeNewState(decision, isPositionOpen, currentState);

      // Check if state changed
      if (currentState === newState) {
        // No change - update evaluation timestamp but don't notify
        await this.updateEvaluationOnly(pair, positionId, decision);
        return {
          previousState: currentState,
          newState,
          shouldNotify: false,
        };
      }

      // State changed - update state and determine notification
      const notifyMessage = this.getNotifyMessage(currentState, newState, pair, decision);
      await this.updateState(pair, positionId, newState, currentState, decision);

      return {
        previousState: currentState,
        newState,
        shouldNotify: true,
        notifyMessage,
      };
    } catch (error: any) {
      log(`[SMART_EXIT_STATE] Error evaluating transition for ${pair} (${positionId}): ${error.message}`, 'trading');
      // Fail-closed for suppressed events: if state check fails, don't notify
      return {
        previousState: null,
        newState: "NORMAL",
        shouldNotify: false,
      };
    }
  }

  /**
   * Get current state from DB
   */
  private async getCurrentState(pair: string, positionId: string): Promise<SmartExitState | null> {
    try {
      const result = await db.execute(sql`
        SELECT current_state
        FROM smart_exit_state
        WHERE pair = ${pair} AND position_id = ${positionId}
      `);

      if (result.rows.length === 0) {
        return null; // No state yet = NORMAL
      }

      const row = result.rows[0] as any;
      return row.current_state as SmartExitState;
    } catch (error: any) {
      log(`[SMART_EXIT_STATE] Error getting current state: ${error.message}`, 'trading');
      return null;
    }
  }

  /**
   * Compute new state based on decision
   */
  private computeNewState(
    decision: StateEvaluationInput["decision"],
    isPositionOpen: boolean,
    currentState: SmartExitState | null
  ): SmartExitState {
    // If position is closed, state is EXECUTED
    if (!isPositionOpen) {
      return "EXECUTED";
    }

    // If exit is suppressed by fee-band
    if (decision.suppressedByFeeBand) {
      return "BLOCKED_BY_FEE_BAND";
    }

    // If shouldExit is true (and not suppressed)
    if (decision.shouldExit) {
      return "EXECUTED";
    }

    // If score > 0 but not enough to exit (signal present but weak)
    if (decision.score > 0 && decision.score < decision.threshold) {
      // If we were blocked, now we're unblocked
      if (currentState === "BLOCKED_BY_FEE_BAND") {
        return "UNBLOCKED";
      }
      return "NORMAL";
    }

    // If score is 0 (no signal)
    if (decision.score === 0) {
      // If we had a signal before, it disappeared
      if (currentState === "BLOCKED_BY_FEE_BAND" || currentState === "UNBLOCKED" || currentState === "NORMAL") {
        return "CANCELLED_BY_SIGNAL_DISAPPEAR";
      }
      return "NORMAL";
    }

    return "NORMAL";
  }

  /**
   * Get notification message for state transition
   */
  private getNotifyMessage(
    previousState: SmartExitState | null,
    newState: SmartExitState,
    pair: string,
    decision: StateEvaluationInput["decision"]
  ): string | undefined {
    switch (newState) {
      case "BLOCKED_BY_FEE_BAND":
        return `🤖 SMART EXIT detectado, pero salida suprimida por fee-band. No se ejecuta venta.\nPar: ${pair}\nScore: ${decision.score}/${decision.threshold}\nRégimen: ${decision.regime}`;

      case "UNBLOCKED":
        return `🤖 Fee-band desaparecido para ${pair}. La salida vuelve a estar disponible.\nScore: ${decision.score}/${decision.threshold}\nRégimen: ${decision.regime}`;

      case "EXECUTED":
        // EXECUTED notification is handled by the existing trading logic
        // Don't return a message here to avoid duplicate
        return undefined;

      case "CANCELLED_BY_SIGNAL_DISAPPEAR":
        return `🤖 SMART EXIT cancelado: la señal de salida desapareció antes de poder vender por fee-band.\nPar: ${pair}`;

      case "NORMAL":
        // No notification for returning to normal
        return undefined;

      default:
        return undefined;
    }
  }

  /**
   * Update state in DB
   */
  private async updateState(
    pair: string,
    positionId: string,
    newState: SmartExitState,
    previousState: SmartExitState | null,
    decision: StateEvaluationInput["decision"]
  ): Promise<void> {
    try {
      await db.execute(sql`
        INSERT INTO smart_exit_state (
          pair,
          position_id,
          current_state,
          previous_state,
          state_changed_at,
          last_evaluation_at,
          last_score,
          last_regime,
          last_pnl_pct,
          last_suppression_reason,
          last_signals
        ) VALUES (
          ${pair},
          ${positionId},
          ${newState},
          ${previousState || null},
          NOW(),
          NOW(),
          ${decision.score},
          ${decision.regime},
          ${decision.pnlPct},
          ${decision.suppressedByFeeBand ? 'fee-band' : null},
          ${JSON.stringify(decision.reasons)}::jsonb
        )
        ON CONFLICT (pair, position_id) DO UPDATE SET
          current_state = EXCLUDED.current_state,
          previous_state = EXCLUDED.previous_state,
          state_changed_at = NOW(),
          last_evaluation_at = NOW(),
          last_score = EXCLUDED.last_score,
          last_regime = EXCLUDED.last_regime,
          last_pnl_pct = EXCLUDED.last_pnl_pct,
          last_suppression_reason = EXCLUDED.last_suppression_reason,
          last_signals = EXCLUDED.last_signals,
          updated_at = NOW()
      `);
    } catch (error: any) {
      log(`[SMART_EXIT_STATE] Error updating state: ${error.message}`, 'trading');
      throw error;
    }
  }

  /**
   * Update evaluation timestamp only (no state change)
   */
  private async updateEvaluationOnly(
    pair: string,
    positionId: string,
    decision: StateEvaluationInput["decision"]
  ): Promise<void> {
    try {
      await db.execute(sql`
        UPDATE smart_exit_state
        SET
          last_evaluation_at = NOW(),
          last_score = ${decision.score},
          last_regime = ${decision.regime},
          last_pnl_pct = ${decision.pnlPct},
          last_suppression_reason = ${decision.suppressedByFeeBand ? 'fee-band' : null},
          last_signals = ${JSON.stringify(decision.reasons)}::jsonb,
          updated_at = NOW()
        WHERE pair = ${pair} AND position_id = ${positionId}
      `);
    } catch (error: any) {
      log(`[SMART_EXIT_STATE] Error updating evaluation only: ${error.message}`, 'trading');
      // Non-critical error, don't throw
    }
  }

  /**
   * Reset state for a position (call when position is closed)
   */
  async resetState(pair: string, positionId: string): Promise<void> {
    try {
      await db.execute(sql`
        DELETE FROM smart_exit_state
        WHERE pair = ${pair} AND position_id = ${positionId}
      `);
    } catch (error: any) {
      log(`[SMART_EXIT_STATE] Error resetting state: ${error.message}`, 'trading');
    }
  }

  /**
   * Cleanup old entries
   */
  async cleanupOldEntries(): Promise<number> {
    try {
      const result = await db.execute(sql`
        SELECT cleanup_old_smart_exit_state() as deleted
      `);
      const row = result.rows[0] as any;
      const deleted = typeof row?.deleted === 'number' ? row.deleted : 0;
      if (deleted > 0) {
        log(`[SMART_EXIT_STATE] Cleaned ${deleted} old entries`, 'trading');
      }
      return deleted;
    } catch (error: any) {
      log(`[SMART_EXIT_STATE] Error cleaning old entries: ${error.message}`, 'trading');
      return 0;
    }
  }
}

// Singleton instance
export const smartExitStateManager = new SmartExitStateManager();
