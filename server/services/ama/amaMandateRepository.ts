/**
 * AMA Mandate Repository — PostgreSQL CRUD for ama_user_mandates.
 *
 * Full lifecycle: DRAFT → APPROVED → ACTIVE → SUPERSEDED → RETIRED
 * Supports versioning, approval, activation, and supersede.
 */

import { pool } from "../../db";
import type { AmaMandateInput } from "./amaTypes";

export interface AmaMandateRow {
  mandateId: string;
  asset: string;
  maxCapitalUsd: number;
  riskMandate: string;
  accumulationStyle: string;
  exitObjective: string;
  autonomyLevel: string;
  status: string;
  version: number;
  approvedBy: string | null;
  approvedAt: string | null;
  activatedAt: string | null;
  supersededAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function mapMandateRow(r: any): AmaMandateRow {
  return {
    mandateId: r.mandate_id as string,
    asset: r.asset as string,
    maxCapitalUsd: Number(r.max_capital_usd),
    riskMandate: r.risk_mandate as string,
    accumulationStyle: r.accumulation_style as string,
    exitObjective: r.exit_objective as string,
    autonomyLevel: r.autonomy_level as string,
    status: r.status as string,
    version: r.version as number,
    approvedBy: r.approved_by ?? null,
    approvedAt: r.approved_at?.toISOString() ?? null,
    activatedAt: r.activated_at?.toISOString() ?? null,
    supersededAt: r.superseded_at?.toISOString() ?? null,
    createdAt: r.created_at?.toISOString() ?? new Date().toISOString(),
    updatedAt: r.updated_at?.toISOString() ?? new Date().toISOString(),
  };
}

export async function insertMandateDraft(
  mandateId: string,
  input: AmaMandateInput,
): Promise<AmaMandateRow> {
  await pool.query(
    `INSERT INTO ama_user_mandates
      (mandate_id, asset, max_capital_usd, risk_mandate, accumulation_style,
       exit_objective, autonomy_level, status, version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'DRAFT', 1)
     ON CONFLICT (mandate_id) DO NOTHING`,
    [
      mandateId,
      input.asset,
      input.maxCapitalUsd,
      input.riskMandate,
      input.accumulationStyle,
      input.exitObjective,
      input.autonomyLevel,
    ],
  );

  const result = await pool.query(
    `SELECT * FROM ama_user_mandates WHERE mandate_id = $1`,
    [mandateId],
  );
  return mapMandateRow(result.rows[0]);
}

export async function getMandateById(mandateId: string): Promise<AmaMandateRow | null> {
  const result = await pool.query(
    `SELECT * FROM ama_user_mandates WHERE mandate_id = $1`,
    [mandateId],
  );
  if (result.rows.length === 0) return null;
  return mapMandateRow(result.rows[0]);
}

export async function getActiveMandate(): Promise<AmaMandateRow | null> {
  const result = await pool.query(
    `SELECT * FROM ama_user_mandates WHERE status = 'ACTIVE' ORDER BY activated_at DESC LIMIT 1`,
  );
  if (result.rows.length === 0) return null;
  return mapMandateRow(result.rows[0]);
}

export async function getLatestMandate(): Promise<AmaMandateRow | null> {
  const result = await pool.query(
    `SELECT * FROM ama_user_mandates ORDER BY created_at DESC LIMIT 1`,
  );
  if (result.rows.length === 0) return null;
  return mapMandateRow(result.rows[0]);
}

export async function approveMandate(
  mandateId: string,
  approvedBy: string,
): Promise<AmaMandateRow> {
  await pool.query(
    `UPDATE ama_user_mandates
     SET status = 'APPROVED', approved_by = $2, approved_at = NOW(), updated_at = NOW()
     WHERE mandate_id = $1 AND status = 'DRAFT'`,
    [mandateId, approvedBy],
  );
  const result = await pool.query(
    `SELECT * FROM ama_user_mandates WHERE mandate_id = $1`,
    [mandateId],
  );
  return mapMandateRow(result.rows[0]);
}

export async function activateMandate(mandateId: string): Promise<AmaMandateRow> {
  // Supersede any currently active mandate
  await pool.query(
    `UPDATE ama_user_mandates
     SET status = 'SUPERSEDED', superseded_at = NOW(), updated_at = NOW()
     WHERE status = 'ACTIVE' AND mandate_id != $1`,
    [mandateId],
  );

  // Activate the new mandate
  await pool.query(
    `UPDATE ama_user_mandates
     SET status = 'ACTIVE', activated_at = NOW(), updated_at = NOW()
     WHERE mandate_id = $1 AND status = 'APPROVED'`,
    [mandateId],
  );

  const result = await pool.query(
    `SELECT * FROM ama_user_mandates WHERE mandate_id = $1`,
    [mandateId],
  );
  return mapMandateRow(result.rows[0]);
}

export async function supersedeMandate(mandateId: string): Promise<AmaMandateRow> {
  await pool.query(
    `UPDATE ama_user_mandates
     SET status = 'SUPERSEDED', superseded_at = NOW(), updated_at = NOW()
     WHERE mandate_id = $1 AND status = 'ACTIVE'`,
    [mandateId],
  );
  const result = await pool.query(
    `SELECT * FROM ama_user_mandates WHERE mandate_id = $1`,
    [mandateId],
  );
  return mapMandateRow(result.rows[0]);
}

export async function retireMandate(mandateId: string): Promise<AmaMandateRow> {
  await pool.query(
    `UPDATE ama_user_mandates
     SET status = 'RETIRED', updated_at = NOW()
     WHERE mandate_id = $1`,
    [mandateId],
  );
  const result = await pool.query(
    `SELECT * FROM ama_user_mandates WHERE mandate_id = $1`,
    [mandateId],
  );
  return mapMandateRow(result.rows[0]);
}
