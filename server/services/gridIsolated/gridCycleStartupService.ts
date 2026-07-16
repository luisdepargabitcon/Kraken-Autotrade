/**
 * GridCycleStartupService — Single owner of Grid SHADOW initialization at server startup.
 *
 * Order:
 *   1. Run migrations (if a runMigrations callback is provided)
 *   2. Verify DB connectivity
 *   3. Load config without starting engine
 *   4. Only if mode === "SHADOW" and isActive === true:
 *      a. Recover open cycles (resolve + persist target SELL)
 *      b. Start engine tick loop
 *   5. Any other mode: do not start
 *
 * Guards prevent duplicate recovery and duplicate scheduler.
 */

import { db } from "../../db";
import { gridIsolatedEngine } from "./gridIsolatedEngine";
import { botLogger } from "../botLogger";
import type { GridMode, GridIsolatedConfig } from "./gridIsolatedTypes";

let startupInProgress = false;
let startupCompleted = false;
let startupError: Error | null = null;
let lastStartupEngine: GridStartupEngineLike | null = null;

export interface GridStartupResult {
  started: boolean;
  mode?: GridMode;
  isActive?: boolean;
  isRunning?: boolean;
  recovery?: { resolved: number; reviewRequired: number; errors: number };
  reason: string;
  error?: string;
}

/**
 * Verify that the database connection is healthy.
 */
async function verifyDbConnection(): Promise<boolean> {
  try {
    await db.execute("SELECT 1");
    return true;
  } catch (err) {
    botLogger.error("SYSTEM_ERROR", `[GridCycleStartupService] DB connection check failed: ${err}`);
    return false;
  }
}

export interface GridStartupEngineLike {
  loadConfig: () => Promise<GridIsolatedConfig>;
  resolveAndPersistOpenCycleTargets: () => Promise<{ resolved: number; reviewRequired: number; errors: number }>;
  start: () => void;
  getRunning: () => boolean;
}

/**
 * Initialize the Grid engine for SHADOW mode only.
 * Idempotent: multiple calls are no-ops after the first successful run.
 */
export async function initializeGridShadowAtStartup(
  engineOverride?: GridStartupEngineLike,
  options?: { runMigrations?: () => Promise<void> }
): Promise<GridStartupResult> {
  if (startupInProgress) {
    return { started: false, reason: "Startup already in progress" };
  }
  if (startupCompleted) {
    const engine = engineOverride ?? lastStartupEngine ?? gridIsolatedEngine;
    const running = engine.getRunning();
    return {
      started: running,
      isRunning: running,
      reason: "Startup already completed",
    };
  }
  if (startupError) {
    return { started: false, reason: "Previous startup failed", error: startupError.message };
  }

  const engine = engineOverride ?? gridIsolatedEngine;
  lastStartupEngine = engine;
  startupInProgress = true;

  try {
    if (options?.runMigrations) {
      await options.runMigrations();
    }

    const dbOk = await verifyDbConnection();
    if (!dbOk) {
      throw new Error("Database connection not available");
    }

    // 1. Load config WITHOUT starting engine
    const config = await engine.loadConfig();

    // 2. Only SHADOW + active is allowed to auto-start
    if (config.mode !== "SHADOW") {
      startupCompleted = true;
      return {
        started: false,
        mode: config.mode,
        isActive: config.isActive,
        isRunning: false,
        reason: `Mode is ${config.mode}; SHADOW required for auto-start`,
      };
    }

    if (!config.isActive) {
      startupCompleted = true;
      return {
        started: false,
        mode: config.mode,
        isActive: false,
        isRunning: false,
        reason: "isActive is false",
      };
    }

    // 3. Recover open cycles: resolve and persist target SELL (no closes)
    const recovery = await engine.resolveAndPersistOpenCycleTargets();

    // 4. Start the scheduler exactly once
    engine.start();

    if (!engine.getRunning()) {
      throw new Error("Engine scheduler did not start");
    }

    startupCompleted = true;
    const result: GridStartupResult = {
      started: true,
      mode: config.mode,
      isActive: true,
      isRunning: true,
      recovery,
      reason: "Grid SHADOW initialized successfully",
    };
    return result;
  } catch (err: any) {
    startupError = err;
    botLogger.error("SYSTEM_ERROR", `[GridCycleStartupService] Initialization failed: ${err}`);
    return {
      started: false,
      reason: "Initialization failed",
      error: String(err?.message || err),
    };
  } finally {
    startupInProgress = false;
  }
}

/**
 * Reset startup guards and error state. Useful for tests and manual retries.
 */
export function resetGridStartupState(): void {
  startupInProgress = false;
  startupCompleted = false;
  startupError = null;
}

/**
 * Check if startup has already been completed.
 */
export function isGridStartupCompleted(): boolean {
  return startupCompleted;
}
