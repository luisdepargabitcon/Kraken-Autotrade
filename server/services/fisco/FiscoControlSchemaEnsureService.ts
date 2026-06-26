/**
 * FiscoControlSchemaEnsureService — Garantiza que el schema FISCO V2
 * tiene las tablas y columnas necesarias para control fiscal.
 *
 * Ejecutar al startup del servidor. Idempotente.
 */
import { pool } from "../../db";

class FiscoControlSchemaEnsureService {
  private static instance: FiscoControlSchemaEnsureService;
  private ensured = false;

  static getInstance(): FiscoControlSchemaEnsureService {
    if (!FiscoControlSchemaEnsureService.instance) {
      FiscoControlSchemaEnsureService.instance = new FiscoControlSchemaEnsureService();
    }
    return FiscoControlSchemaEnsureService.instance;
  }

  /**
   * Ejecuta todas las verificaciones de schema. Idempotente.
   * No lanza error — devuelve un objeto con resultados.
   */
  async ensure(): Promise<{ ok: boolean; errors: string[]; ensured: string[] }> {
    const errors: string[] = [];
    const ensured: string[] = [];

    // 1. fisco_rebuild_runs: columnas nuevas de control fiscal
    const rebuildCols = [
      { col: "operation_set_hash", type: "TEXT" },
      { col: "fiscal_year", type: "INTEGER" },
      { col: "gains_eur", type: "DECIMAL(18,8)" },
      { col: "losses_eur", type: "DECIMAL(18,8)" },
      { col: "net_gain_loss_eur", type: "DECIMAL(18,8)" },
      { col: "previous_net_gain_loss_eur", type: "DECIMAL(18,8)" },
      { col: "delta_net_gain_loss_eur", type: "DECIMAL(18,8)" },
      { col: "delta_gains_eur", type: "DECIMAL(18,8)" },
      { col: "delta_losses_eur", type: "DECIMAL(18,8)" },
      { col: "changed_from_previous", type: "BOOLEAN DEFAULT FALSE" },
    ];
    for (const { col, type } of rebuildCols) {
      try {
        await pool.query(`ALTER TABLE fisco_rebuild_runs ADD COLUMN IF NOT EXISTS ${col} ${type}`);
        ensured.push(`fisco_rebuild_runs.${col}`);
      } catch (e: any) {
        errors.push(`ALTER fisco_rebuild_runs.${col}: ${e.message}`);
      }
    }

    // 2. fisco_result_history
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS fisco_result_history (
          id SERIAL PRIMARY KEY,
          fiscal_year INTEGER NOT NULL,
          run_id TEXT REFERENCES fisco_rebuild_runs(id),
          mode TEXT NOT NULL,
          status TEXT NOT NULL,
          operations_count INTEGER DEFAULT 0,
          lots_count INTEGER DEFAULT 0,
          disposals_count INTEGER DEFAULT 0,
          gains_eur DECIMAL(18,8) DEFAULT 0,
          losses_eur DECIMAL(18,8) DEFAULT 0,
          net_gain_loss_eur DECIMAL(18,8) DEFAULT 0,
          operation_set_hash TEXT,
          previous_net_gain_loss_eur DECIMAL(18,8),
          delta_net_gain_loss_eur DECIMAL(18,8),
          delta_gains_eur DECIMAL(18,8),
          delta_losses_eur DECIMAL(18,8),
          changed_from_previous BOOLEAN DEFAULT FALSE,
          explanation TEXT,
          recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_fisco_result_history_year
        ON fisco_result_history(fiscal_year, recorded_at DESC)
      `);
      ensured.push("fisco_result_history");
    } catch (e: any) {
      errors.push(`CREATE fisco_result_history: ${e.message}`);
    }

    // 3. fisco_control_snapshots
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS fisco_control_snapshots (
          id SERIAL PRIMARY KEY,
          fiscal_year INTEGER NOT NULL,
          operation_set_hash TEXT NOT NULL,
          operations_count INTEGER NOT NULL,
          lots_count INTEGER NOT NULL,
          disposals_count INTEGER NOT NULL,
          transfer_links_count INTEGER NOT NULL,
          last_operation_executed_at TIMESTAMPTZ,
          last_operation_created_at TIMESTAMPTZ,
          net_gain_loss_eur DECIMAL(18,8),
          fiscal_result_status TEXT NOT NULL,
          run_id TEXT,
          recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_fisco_control_snapshots_year
        ON fisco_control_snapshots(fiscal_year, recorded_at DESC)
      `);
      ensured.push("fisco_control_snapshots");
    } catch (e: any) {
      errors.push(`CREATE fisco_control_snapshots: ${e.message}`);
    }

    this.ensured = true;
    return { ok: errors.length === 0, errors, ensured };
  }

  isEnsured(): boolean {
    return this.ensured;
  }
}

export const fiscoControlSchemaEnsureService = FiscoControlSchemaEnsureService.getInstance();
