/**
 * AMA Replay Service — Deterministic historical replay.
 *
 * Replays historical price data through the AMA engine to produce
 * deterministic results. No real orders, no exchange calls.
 *
 * SAFETY:
 * - No real orders.
 * - No exchange calls.
 * - Results are deterministic (same input → same output).
 * - All replay runs are persisted for auditability.
 */

import {
  insertReplayRun,
  updateReplayRunStatus,
  getReplayRunById,
  getReplayRuns,
  insertReplayEvent,
  type ReplayRunRow,
} from "./amaShadowReplayRepository";

export interface ReplayConfig {
  startDate: string;
  endDate: string;
  pair: string;
  initialCapitalUsd: number;
  config?: {
    maxCapitalUsd?: number;
    riskMandate?: string;
    accumulationStyle?: string;
  };
}

export interface ReplayResult {
  totalTranchesExecuted: number;
  totalUsdDeployed: number;
  finalQuantity: number;
  finalValueUsd: number | null;
  events: ReplayEventResult[];
}

export interface ReplayEventResult {
  eventSeq: number;
  eventType: string;
  timestampSimulated: string;
  price: number;
  action: string;
  amountUsd?: number;
  quantity?: number;
}

export async function startReplayRun(config: ReplayConfig): Promise<string> {
  const replayRunId = `replay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  const asset = config.pair.split("/")[0] ?? "BTC";

  await insertReplayRun({
    replayRunId,
    asset,
    pair: config.pair,
    startDate: config.startDate,
    endDate: config.endDate,
    initialCapitalUsd: config.initialCapitalUsd,
    status: "QUEUED",
    configJson: config as unknown as Record<string, unknown>,
    resultJson: null,
    totalTranchesExecuted: 0,
    totalUsdDeployed: 0,
    finalQuantity: 0,
    finalValueUsd: null,
    errorMessage: null,
    startedAt: null,
    completedAt: null,
    createdAt: now,
  });

  return replayRunId;
}

export async function executeReplayRun(
  replayRunId: string,
  historicalPrices: Array<{ timestamp: string; price: number }>,
): Promise<ReplayResult> {
  await updateReplayRunStatus(replayRunId, "RUNNING", {});

  try {
    const events: ReplayEventResult[] = [];
    let totalUsdDeployed = 0;
    let totalQuantity = 0;
    let tranchesExecuted = 0;
    const capital = 10000; // default replay capital

    const dropPcts = [5, 10, 15, 25, 35, 45];
    const trancheSize = capital / dropPcts.length;
    let lastPrice = historicalPrices[0]?.price ?? 0;
    let hwm = lastPrice;

    for (let i = 0; i < historicalPrices.length; i++) {
      const candle = historicalPrices[i];
      const price = candle.price;

      if (price > hwm) hwm = price;

      const dropPct = hwm > 0 ? ((hwm - price) / hwm) * 100 : 0;

      // Check if we should execute a tranche
      const trancheIdx = dropPcts.findIndex((d) => d <= dropPct && d > (dropPcts[i % dropPcts.length] ?? 0));
      if (trancheIdx >= 0 && totalUsdDeployed < capital) {
        const amountUsd = Math.min(trancheSize, capital - totalUsdDeployed);
        const quantity = amountUsd / price;

        totalUsdDeployed += amountUsd;
        totalQuantity += quantity;
        tranchesExecuted++;

        const event: ReplayEventResult = {
          eventSeq: i,
          eventType: "TRANCHE_EXECUTED",
          timestampSimulated: candle.timestamp,
          price,
          action: "BUY",
          amountUsd,
          quantity,
        };
        events.push(event);

        await insertReplayEvent(
          replayRunId,
          i,
          event.eventType,
          event.timestampSimulated,
          price,
          event as unknown as Record<string, unknown>,
        );
      } else {
        const event: ReplayEventResult = {
          eventSeq: i,
          eventType: "OBSERVE",
          timestampSimulated: candle.timestamp,
          price,
          action: "HOLD",
        };
        events.push(event);

        await insertReplayEvent(
          replayRunId,
          i,
          event.eventType,
          event.timestampSimulated,
          price,
          event as unknown as Record<string, unknown>,
        );
      }

      lastPrice = price;
    }

    const finalValueUsd = totalQuantity * lastPrice;

    const result: ReplayResult = {
      totalTranchesExecuted: tranchesExecuted,
      totalUsdDeployed: totalUsdDeployed,
      finalQuantity: totalQuantity,
      finalValueUsd,
      events,
    };

    await updateReplayRunStatus(replayRunId, "COMPLETED", {
      resultJson: result as unknown as Record<string, unknown>,
      totalTranchesExecuted: tranchesExecuted,
      totalUsdDeployed: totalUsdDeployed,
      finalQuantity: totalQuantity,
      finalValueUsd,
      completedAt: new Date().toISOString(),
    });

    return result;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    await updateReplayRunStatus(replayRunId, "FAILED", {
      errorMessage,
      completedAt: new Date().toISOString(),
    });
    throw err;
  }
}

export async function getReplayRun(replayRunId: string): Promise<ReplayRunRow | null> {
  return await getReplayRunById(replayRunId);
}

export async function listReplayRuns(limit: number = 20): Promise<ReplayRunRow[]> {
  return await getReplayRuns(limit);
}
