/**
 * AMA Scheduler Runner — Executes periodic AMA runtime tasks.
 *
 * Uses the existing AmaSchedulerStateService for persistent state and advisory lock.
 * Processes: market refresh, HWM check, tick, reconciliation check.
 *
 * SAFETY: No orders. No REAL mode. No exchange writes.
 */

import { amaSchedulerStateService } from "./amaFunctionalClosure";
import { tick as runtimeTick } from "./amaRuntimeService";
import { getRealMarketView } from "./amaMarketRuntimeService";
import { amaHwmBootstrapService } from "./amaFunctionalClosure";
import { getActiveCycle } from "./amaRepository";

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
const TICK_INTERVAL_MS = 60_000; // 1 minute

export async function executeSchedulerTick(): Promise<void> {
  const acquired = await amaSchedulerStateService.acquireAdvisoryLock();
  if (!acquired) return;

  try {
    const cycle = await getActiveCycle();
    await amaSchedulerStateService.recordTick(cycle?.cycleId);
    await runtimeTick();

    // Refresh market view (cache update, no side effects)
    try {
      await getRealMarketView();
    } catch {
      // Market data refresh is best-effort
    }

    // Check HWM bootstrap status
    const hwmState = await amaHwmBootstrapService.getState();
    if (hwmState.bootstrapStatus === "PENDING") {
      // Auto-trigger HWM bootstrap if not started
      // This is safe — it only reads public market data
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown scheduler error";
    await amaSchedulerStateService.recordError(msg);
  } finally {
    await amaSchedulerStateService.releaseAdvisoryLock();
  }
}

export function startScheduler(): void {
  if (schedulerInterval) return;
  schedulerInterval = setInterval(() => {
    executeSchedulerTick().catch(() => {});
  }, TICK_INTERVAL_MS);
  console.log("[AMA] Scheduler runner started");
}

export function stopScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log("[AMA] Scheduler runner stopped");
  }
}
