/**
 * AMA Scheduler Runner — Executes periodic AMA runtime tasks.
 *
 * Uses the existing AmaSchedulerStateService for persistent state and advisory lock.
 * Processes: market refresh, HWM check, tick, shadow live execution, reconciliation.
 *
 * SAFETY: No orders. No REAL mode. No exchange writes.
 */

import { amaSchedulerStateService, amaHwmBootstrapService } from "./amaFunctionalClosure";
import { tick as runtimeTick, getMode, isKillSwitchActive } from "./amaRuntimeService";
import { getRealMarketView, executeHwmBootstrap } from "./amaMarketRuntimeService";
import { getActiveCycle } from "./amaRepository";
import { evaluateShadowReadiness } from "./amaShadowReadinessService";
import { executeShadowTick } from "./amaShadowExecutor";
import { getTranchesByCycle } from "./amaRepository";
import { MarketDataService } from "../MarketDataService";

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let isRunning = false;
const TICK_INTERVAL_MS = 60_000; // 1 minute

export async function executeSchedulerTick(): Promise<void> {
  if (isRunning) return; // Prevent overlapping ticks
  isRunning = true;

  const acquired = await amaSchedulerStateService.acquireAdvisoryLock();
  if (!acquired) {
    isRunning = false;
    return;
  }

  try {
    // 1. Runtime tick (updates lastTickAt, checks mode/killswitch)
    await runtimeTick();

    // 2. Record tick with active cycle
    const cycle = await getActiveCycle();
    await amaSchedulerStateService.recordTick(cycle?.cycleId);

    // 3. Refresh market view (cache update, no side effects)
    try {
      await getRealMarketView();
    } catch {
      // Market data refresh is best-effort
    }

    // 4. Check HWM bootstrap status — auto-trigger if PENDING
    const hwmState = await amaHwmBootstrapService.getState();
    if (hwmState.bootstrapStatus === "PENDING") {
      try {
        await executeHwmBootstrap("BTC/USD", 200);
        console.log("[AMA Scheduler] HWM bootstrap auto-triggered");
      } catch (e) {
        // HWM bootstrap failure is non-fatal
        console.warn("[AMA Scheduler] HWM bootstrap auto-trigger failed:", e);
      }
    }

    // 5. Evaluate current mode
    const mode = getMode();
    const killSwitch = isKillSwitchActive();

    if (killSwitch || mode === "OFF") {
      isRunning = false;
      return;
    }

    // 6. If SHADOW_LIVE, process shadow tick
    if (mode === "SHADOW_LIVE") {
      try {
        const readiness = await evaluateShadowReadiness("SHADOW_LIVE");
        if (readiness.ready && cycle) {
          const tranches = await getTranchesByCycle(cycle.cycleId);
          const price = await MarketDataService.getPrice("BTC/USD");
          if (price > 0 && tranches.length > 0) {
            const result = await executeShadowTick(
              cycle.cycleId,
              tranches,
              price,
              {
                mode: "SHADOW_LIVE",
                hasHwm: true,
                hasBudget: true,
                hasCurrentPrice: true,
                dataCoveragePct: hwmState.dataCoveragePct,
                minDataCoveragePct: 90,
              },
            );
            if (result.ordersCreated > 0) {
              console.log(`[AMA Scheduler] Shadow tick: ${result.ordersCreated} orders, ${result.ordersFilled} fills, $${result.totalSimulatedUsd} simulated`);
            }
          }
        }
      } catch (e) {
        console.warn("[AMA Scheduler] Shadow live tick failed:", e);
      }
    }

    // 7. Periodic portfolio reconciliation (best-effort)
    // TODO: Wire portfolio reconciliation when available

  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown scheduler error";
    await amaSchedulerStateService.recordError(msg);
    console.error("[AMA Scheduler] Tick error:", msg);
  } finally {
    await amaSchedulerStateService.releaseAdvisoryLock();
    isRunning = false;
  }
}

export function startScheduler(): void {
  if (schedulerInterval) return; // Prevent duplicate interval
  schedulerInterval = setInterval(() => {
    executeSchedulerTick().catch(() => {});
  }, TICK_INTERVAL_MS);
  console.log("[AMA] Scheduler runner started (60s interval)");
}

export function stopScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log("[AMA] Scheduler runner stopped");
  }
}

export function isSchedulerRunning(): boolean {
  return schedulerInterval !== null;
}
