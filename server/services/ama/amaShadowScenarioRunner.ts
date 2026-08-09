/**
 * AMA Shadow Scenario Runner — Executes a full shadow scenario lifecycle.
 *
 * Given a scenario with a synthetic dataset, this runner:
 * 1. Loads/creates the scenario dataset
 * 2. Creates a simulated cycle
 * 3. Generates eligible tranches from the dataset
 * 4. Executes shadow ticks (create orders → simulate fills)
 * 5. Updates scenario totals (orders, fills, simulated USD)
 *
 * SAFETY:
 * - No real orders.
 * - No exchange calls.
 * - No capital at risk.
 * - All simulated orders persisted to ama_shadow_orders.
 */

import {
  executeShadowTick,
  type ShadowExecutionResult,
} from "./amaShadowExecutor";
import {
  getShadowScenarioById,
} from "./amaShadowReplayRepository";
import { pool } from "../../db";
import type { AmaTranche, TrancheType, OrderIntentStatus, SleeveType } from "./amaTypes";

export interface ScenarioRunResult {
  scenarioId: string;
  status: string;
  ordersCreated: number;
  ordersFilled: number;
  ordersRejected: number;
  totalSimulatedUsd: number;
}

interface ScenarioDataset {
  prices: Array<{ timestamp: string; price: number }>;
  initialPrice: number;
  hwm: number;
}

function generateDatasetFromConfig(config: Record<string, unknown>): ScenarioDataset {
  const basePrice = (config.basePrice as number) ?? 100000;
  const dropPcts = (config.dropPcts as number[]) ?? [5, 10, 15, 25, 35, 45];
  const hwm = basePrice;

  const prices = dropPcts.map((drop, i) => ({
    timestamp: new Date(Date.UTC(2025, 0, 1 + i)).toISOString(),
    price: basePrice * (1 - drop / 100),
  }));

  return { prices, initialPrice: basePrice, hwm };
}

function generateTranchesFromDataset(
  dataset: ScenarioDataset,
  capitalUsd: number,
): AmaTranche[] {
  const dropPcts = [5, 10, 15, 25, 35, 45];
  const trancheSize = capitalUsd / dropPcts.length;

  return dropPcts.map((dropPct, i) => {
    const price = dataset.initialPrice * (1 - dropPct / 100);
    const type: TrancheType = dropPct >= 35 ? "DEEP_VALUE" : dropPct >= 15 ? "VALUE" : "PROBE";
    return {
      trancheId: `tranche-scenario-${i + 1}`,
      cycleId: "scenario-cycle",
      type,
      status: "CREATED" as OrderIntentStatus,
      plannedAmountUsd: trancheSize,
      executedAmountUsd: 0,
      assetQuantity: trancheSize / price,
      fillPrice: null,
      costBasis: null,
      sleeveAllocation: "RECOVER_PRINCIPAL" as SleeveType,
      remainingQuantity: trancheSize / price,
      realizedQuantity: 0,
      createdAt: new Date().toISOString(),
      filledAt: null,
    };
  });
}

export async function runShadowScenario(
  scenarioId: string,
): Promise<ScenarioRunResult> {
  const scenario = await getShadowScenarioById(scenarioId);
  if (!scenario) {
    throw new Error(`Shadow scenario not found: ${scenarioId}`);
  }

  if (scenario.status === "CLOSED") {
    throw new Error(`Shadow scenario is closed: ${scenarioId}`);
  }

  // Generate dataset from scenario config
  const dataset = generateDatasetFromConfig(scenario.configJson);
  const capitalUsd = (scenario.configJson.capitalUsd as number) ?? 10000;
  const cycleId = `cycle-scenario-${scenarioId}`;

  // Generate tranches from dataset
  const tranches = generateTranchesFromDataset(dataset, capitalUsd);
  const trancheDropPcts = [5, 10, 15, 25, 35, 45];

  let ordersCreated = 0;
  let ordersFilled = 0;
  let ordersRejected = 0;
  let totalSimulatedUsd = 0;

  // Execute shadow ticks across the dataset
  for (const dataPoint of dataset.prices) {
    const currentDropPct = ((dataset.hwm - dataPoint.price) / dataset.hwm) * 100;
    const eligibleTranches = tranches.filter(
      (t, i) => t.status === "CREATED" && trancheDropPcts[i] <= currentDropPct,
    );

    if (eligibleTranches.length === 0) continue;

    const result: ShadowExecutionResult = await executeShadowTick(
      cycleId,
      eligibleTranches,
      dataPoint.price,
      {
        mode: "SHADOW_SCENARIO",
        hasHwm: true,
        hasBudget: true,
        hasCurrentPrice: true,
        dataCoveragePct: 100,
        minDataCoveragePct: 90,
      },
    );

    ordersCreated += result.ordersCreated;
    ordersFilled += result.ordersFilled;
    ordersRejected += result.ordersRejected;
    totalSimulatedUsd += result.totalSimulatedUsd;

    // Mark executed tranches as processed
    for (const tranche of eligibleTranches) {
      tranche.status = "SIMULATED" as any;
    }
  }

  // Update scenario totals in DB
  await pool.query(
    `UPDATE ama_shadow_scenarios
     SET total_orders = total_orders + $1,
         total_filled = total_filled + $2,
         total_simulated_usd = total_simulated_usd + $3,
         updated_at = NOW()
     WHERE scenario_id = $4`,
    [ordersCreated, ordersFilled, totalSimulatedUsd, scenarioId],
  );

  return {
    scenarioId,
    status: "COMPLETED",
    ordersCreated,
    ordersFilled,
    ordersRejected,
    totalSimulatedUsd,
  };
}
