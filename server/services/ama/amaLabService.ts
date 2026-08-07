/**
 * AMA Lab Service — Scenario-based simulation without exchange calls.
 *
 * The Lab allows testing different configurations and scenarios against
 * historical data. It produces deterministic results that can be compared.
 *
 * SAFETY:
 * - No real orders.
 * - No exchange calls.
 * - No capital at risk.
 * - Results are persisted for comparison.
 */

import { pool } from "../../db";
import {
  insertLabSession,
  updateLabSessionStatus,
  getLabSessionById,
  getLabSessions,
  type LabSessionRow,
} from "./amaShadowReplayRepository";

export interface LabConfig {
  asset: string;
  pair: string;
  scenarioName: string;
  initialCapitalUsd: number;
  config: {
    maxCapitalUsd: number;
    riskMandate: string;
    accumulationStyle: string;
    exitObjective: string;
    autonomyLevel: string;
    customDropPcts?: number[];
    customPrices?: number[];
  };
}

export interface LabResult {
  totalTranchesPlanned: number;
  totalTranchesSimulated: number;
  totalUsdSimulated: number;
  finalQuantity: number;
  finalValueUsd: number | null;
  trancheResults: LabTrancheResult[];
}

export interface LabTrancheResult {
  trancheType: string;
  plannedAmountUsd: number;
  simulatedPrice: number;
  simulatedQuantity: number;
  sleeveAllocation: string;
}

export async function startLabSession(config: LabConfig): Promise<string> {
  const labSessionId = `lab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();

  await insertLabSession({
    labSessionId,
    asset: config.asset,
    pair: config.pair,
    scenarioName: config.scenarioName,
    configJson: config.config,
    status: "RUNNING",
    resultJson: null,
    totalTranchesPlanned: 0,
    totalTranchesSimulated: 0,
    totalUsdSimulated: 0,
    finalQuantity: 0,
    finalValueUsd: null,
    errorMessage: null,
    startedAt: now,
    completedAt: null,
    createdAt: now,
  });

  return labSessionId;
}

export async function completeLabSession(
  labSessionId: string,
  result: LabResult,
): Promise<void> {
  await updateLabSessionStatus(labSessionId, "COMPLETED", {
    resultJson: result as unknown as Record<string, unknown>,
    totalTranchesPlanned: result.totalTranchesPlanned,
    totalTranchesSimulated: result.totalTranchesSimulated,
    totalUsdSimulated: result.totalUsdSimulated,
    finalQuantity: result.finalQuantity,
    finalValueUsd: result.finalValueUsd,
    completedAt: new Date().toISOString(),
  });
}

export async function failLabSession(
  labSessionId: string,
  errorMessage: string,
): Promise<void> {
  await updateLabSessionStatus(labSessionId, "FAILED", {
    errorMessage,
    completedAt: new Date().toISOString(),
  });
}

export async function getLabSession(labSessionId: string): Promise<LabSessionRow | null> {
  return await getLabSessionById(labSessionId);
}

export async function listLabSessions(limit: number = 20): Promise<LabSessionRow[]> {
  return await getLabSessions(limit);
}

// ─── Lab Simulation Engine ───────────────────────────────────────────

export function simulateLabScenario(
  config: LabConfig,
  prices: number[],
): LabResult {
  const trancheResults: LabTrancheResult[] = [];
  let totalUsdSimulated = 0;
  let totalQuantity = 0;
  let tranchesPlanned = 0;

  const dropPcts = config.config.customDropPcts ?? [5, 10, 15, 25, 35, 45];
  const maxCapital = config.config.maxCapitalUsd;
  const trancheSize = maxCapital / dropPcts.length;

  for (let i = 0; i < prices.length && i < dropPcts.length; i++) {
    const price = prices[i];
    const dropPct = dropPcts[i];
    tranchesPlanned++;

    const trancheType = getTrancheTypeForDrop(dropPct);
    const amountUsd = Math.min(trancheSize, maxCapital - totalUsdSimulated);
    if (amountUsd <= 0) break;

    const quantity = amountUsd / price;
    totalUsdSimulated += amountUsd;
    totalQuantity += quantity;

    trancheResults.push({
      trancheType,
      plannedAmountUsd: amountUsd,
      simulatedPrice: price,
      simulatedQuantity: quantity,
      sleeveAllocation: getSleeveForTranche(trancheType),
    });
  }

  const finalPrice = prices[prices.length - 1] ?? 0;
  const finalValueUsd = totalQuantity * finalPrice;

  return {
    totalTranchesPlanned: tranchesPlanned,
    totalTranchesSimulated: trancheResults.length,
    totalUsdSimulated,
    finalQuantity: totalQuantity,
    finalValueUsd,
    trancheResults,
  };
}

function getTrancheTypeForDrop(dropPct: number): string {
  if (dropPct < 10) return "PROBE";
  if (dropPct < 25) return "VALUE";
  if (dropPct < 40) return "DEEP_VALUE";
  if (dropPct < 55) return "CAPITULATION";
  return "RECOVERY";
}

function getSleeveForTranche(trancheType: string): string {
  switch (trancheType) {
    case "PROBE":
    case "VALUE":
      return "RECOVER_PRINCIPAL";
    case "DEEP_VALUE":
    case "CAPITULATION":
      return "DE_RISK";
    default:
      return "LONG_TERM_RUNNER";
  }
}
