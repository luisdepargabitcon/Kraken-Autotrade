/**
 * SpotRealReadiness — R10 Preflight checks for REAL mode activation.
 *
 * Checks:
 *   1. REAL_ACTIVATION_ALLOWED = true
 *   2. ExchangeFactory.getTradingExchange() is initialized
 *   3. Exchange has valid fee model (takerFeePct > 0)
 *   4. No SHADOW positions still open (must close or migrate first)
 *   5. API credentials configured
 */

import { REAL_ACTIVATION_ALLOWED, ExecutionMode } from "./spotTypes";
import { ExchangeFactory } from "../exchanges/ExchangeFactory";
import { getTradingFeeModel } from "./feeModel";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { SPOT_POLICY_VERSION } from "./spotTypes";

export interface RealReadinessResult {
  ready: boolean;
  blockers: string[];
  warnings: string[];
  checks: {
    realActivationAllowed: boolean;
    exchangeInitialized: boolean;
    exchangeName: string | null;
    feeModelValid: boolean;
    takerFeePct: number | null;
    makerFeePct: number | null;
    shadowPositionsOpen: boolean;
    shadowPositionsCount: number;
    apiCredentialsConfigured: boolean;
  };
}

export async function checkRealReadiness(): Promise<RealReadinessResult> {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const checks = {
    realActivationAllowed: false,
    exchangeInitialized: false,
    exchangeName: null as string | null,
    feeModelValid: false,
    takerFeePct: null as number | null,
    makerFeePct: null as number | null,
    shadowPositionsOpen: false,
    shadowPositionsCount: 0,
    apiCredentialsConfigured: false,
  };

  // 1. REAL_ACTIVATION_ALLOWED
  checks.realActivationAllowed = REAL_ACTIVATION_ALLOWED;
  if (!REAL_ACTIVATION_ALLOWED) {
    blockers.push("REAL_ACTIVATION_ALLOWED=false en configuración");
  }

  // 2. Exchange initialized
  try {
    const exchange = ExchangeFactory.getTradingExchange();
    checks.exchangeInitialized = exchange.isInitialized();
    checks.exchangeName = exchange.exchangeName;
    if (!checks.exchangeInitialized) {
      blockers.push(`Exchange ${exchange.exchangeName} no inicializado`);
    }

    // 3. Fee model valid
    if (checks.exchangeInitialized) {
      const feeModel = getTradingFeeModel();
      checks.takerFeePct = feeModel.takerFeePct;
      checks.makerFeePct = feeModel.makerFeePct;
      checks.feeModelValid = feeModel.takerFeePct > 0;
      if (!checks.feeModelValid) {
        blockers.push("Fee model inválido (takerFeePct <= 0)");
      }
    }
  } catch (error: any) {
    blockers.push(`ExchangeFactory error: ${error.message}`);
  }

  // 4. Check for open SHADOW positions
  try {
    const result = await db.execute(sql`
      SELECT COUNT(*) as count FROM open_positions
      WHERE policy_version = ${SPOT_POLICY_VERSION}
        AND execution_mode = 'SHADOW'
        AND status != 'CLOSED'
    `);
    checks.shadowPositionsCount = Number(result.rows[0]?.count ?? 0);
    checks.shadowPositionsOpen = checks.shadowPositionsCount > 0;
    if (checks.shadowPositionsOpen) {
      warnings.push(`${checks.shadowPositionsCount} posiciones SHADOW abiertas — se mantendrán con modo SHADOW`);
    }
  } catch {
    warnings.push("No se pudo verificar posiciones SHADOW abiertas");
  }

  // 5. API credentials
  try {
    const result = await db.execute(sql`
      SELECT trading_exchange FROM api_config LIMIT 1
    `);
    checks.apiCredentialsConfigured = result.rows.length > 0 && !!result.rows[0]?.trading_exchange;
    if (!checks.apiCredentialsConfigured) {
      warnings.push("No se encontró trading_exchange configurado en api_config");
    }
  } catch {
    warnings.push("No se pudo verificar api_config");
  }

  const ready = blockers.length === 0;

  return { ready, blockers, warnings, checks };
}
