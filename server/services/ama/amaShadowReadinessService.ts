/**
 * AMA Shadow Readiness Service — Real readiness evaluation for SHADOW modes.
 *
 * Replaces hardcoded false/false/false/0/90 in route layer.
 * Evaluates actual HWM bootstrap, budget, market data, and coverage conditions.
 *
 * SHADOW_SCENARIO: does NOT require live market data (uses synthetic/scenario data).
 * SHADOW_LIVE: requires real HWM, real market price, and data coverage.
 */

import type { AmaMode } from "./amaTypes";
import type { ShadowReadiness } from "./amaShadowExecutorSecurity";
import { amaHwmBootstrapService } from "./amaFunctionalClosure";
import { pool } from "../../db";

const MIN_DATA_COVERAGE_PCT = 90;

export async function evaluateShadowReadiness(
  mode: AmaMode,
): Promise<ShadowReadiness> {
  const blockers: string[] = [];

  if (mode !== "SHADOW_SCENARIO" && mode !== "SHADOW_LIVE") {
    blockers.push("MODE_IS_NOT_SHADOW");
    return { ready: false, blockers };
  }

  // HWM check — required for both modes
  const hwmState = await amaHwmBootstrapService.getState();
  const hasHwm = hwmState.bootstrapStatus === "COMPLETED" && hwmState.hwm !== null;
  if (!hasHwm) {
    blockers.push("NO_HIGH_WATER_MARK");
  }

  // Budget check — query portfolio_mode_budgets for AMA
  const budgetRes = await pool.query(
    `SELECT budgeted_usd, deployed_usd, reserved_usd, status
     FROM portfolio_mode_budgets
     WHERE mode = 'AMA' AND asset = 'BTC' AND status = 'ACTIVE'
     LIMIT 1`,
  );
  const hasBudget = budgetRes.rows.length > 0 &&
    Number(budgetRes.rows[0].budgeted_usd) > 0 &&
    (Number(budgetRes.rows[0].budgeted_usd) - Number(budgetRes.rows[0].deployed_usd) - Number(budgetRes.rows[0].reserved_usd)) > 0;
  if (!hasBudget) {
    blockers.push("NO_BUDGET_ALLOCATED");
  }

  // Data coverage check
  const dataCoveragePct = hwmState.dataCoveragePct;
  if (dataCoveragePct < MIN_DATA_COVERAGE_PCT) {
    blockers.push(`DATA_COVERAGE_BELOW_MINIMUM:${dataCoveragePct}%<${MIN_DATA_COVERAGE_PCT}%`);
  }

  // Market price check — only required for SHADOW_LIVE
  let hasCurrentPrice = false;
  if (mode === "SHADOW_LIVE") {
    try {
      const { MarketDataService } = await import("../MarketDataService");
      const price = await MarketDataService.getPrice("BTC/USD");
      hasCurrentPrice = price > 0;
    } catch {
      hasCurrentPrice = false;
    }
    if (!hasCurrentPrice) {
      blockers.push("NO_CURRENT_PRICE");
    }
  } else {
    // SHADOW_SCENARIO: synthetic prices are used, no live market required
    hasCurrentPrice = true;
  }

  return { ready: blockers.length === 0, blockers };
}
