/**
 * AMA Lab & Replay Async Runners — R2.26-R2.27
 *
 * Wraps amaLabService and amaReplayService to automatically execute
 * simulations asynchronously after session start.
 *
 * SAFETY:
 * - No real orders.
 * - No exchange calls.
 * - No capital at risk.
 * - Results are persisted for comparison.
 */

import { startLabSession, completeLabSession, failLabSession, simulateLabScenario, type LabConfig } from "./amaLabService";
import { startReplayRun, executeReplayRun, type ReplayConfig, type ReplayResult } from "./amaReplayService";

/**
 * Lab Runner: starts a lab session and immediately runs the simulation
 * with the provided prices. Returns the session ID.
 *
 * The simulation runs synchronously (it's pure computation, no I/O).
 */
export async function runLabSession(
  config: LabConfig,
  prices: number[],
): Promise<string> {
  const labSessionId = await startLabSession(config);

  try {
    const result = simulateLabScenario(config, prices);
    await completeLabSession(labSessionId, result);
    console.log(`[AmaLabRunner] Lab session ${labSessionId} completed: ${result.totalTranchesSimulated} tranches`);
  } catch (e) {
    await failLabSession(labSessionId, String(e));
    console.error(`[AmaLabRunner] Lab session ${labSessionId} failed: ${e}`);
  }

  return labSessionId;
}

/**
 * Replay Runner: starts a replay run and immediately executes it
 * with the provided historical prices.
 * Returns the run ID and result.
 *
 * The replay execution is deterministic and uses historical data.
 * executeReplayRun handles completion/failure internally.
 */
export async function runReplaySession(
  config: ReplayConfig,
  historicalPrices: Array<{ timestamp: string; price: number }>,
): Promise<{ replayRunId: string; result: ReplayResult | null }> {
  const replayRunId = await startReplayRun(config);

  try {
    const result = await executeReplayRun(replayRunId, historicalPrices);
    console.log(`[AmaReplayRunner] Replay run ${replayRunId} completed: ${result.totalTranchesExecuted} tranches`);
    return { replayRunId, result };
  } catch (e) {
    console.error(`[AmaReplayRunner] Replay run ${replayRunId} failed: ${e}`);
    return { replayRunId, result: null };
  }
}
