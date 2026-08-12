/**
 * SpotExecutionModeStore — DB-backed execution mode persistence.
 *
 * Replaces the in-memory `let currentExecutionMode` variable.
 * Execution mode is persisted in bot_config.spot_execution_mode.
 *
 * Fail-safe:
 *   - Unknown/corrupt/missing value → OFF
 *   - REAL during refactor → OFF + security event
 *   - Restart recovers mode from DB
 */

import { db } from "../../db";
import { botConfig } from "../../../shared/schema";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { ExecutionMode, resolveExecutionMode, REAL_ACTIVATION_ALLOWED } from "./spotTypes";

let cachedMode: ExecutionMode | null = null;
let lastLoadTime = 0;
const CACHE_TTL_MS = 5_000; // 5s cache to avoid DB hit on every call

/**
 * Load execution mode from DB.
 * Fail-safe: any error or unknown value → OFF.
 */
export async function loadExecutionMode(): Promise<ExecutionMode> {
  // Use cache if fresh
  if (cachedMode !== null && Date.now() - lastLoadTime < CACHE_TTL_MS) {
    return cachedMode;
  }

  try {
    const result = await db.execute(sql`
      SELECT spot_execution_mode FROM bot_config LIMIT 1
    `);

    if (result.rows.length === 0) {
      cachedMode = ExecutionMode.OFF;
      lastLoadTime = Date.now();
      return ExecutionMode.OFF;
    }

    const raw = result.rows[0].spot_execution_mode as string | null;
    let resolved = resolveExecutionMode(raw);

    // Security: if DB contains REAL but REAL is not allowed, force OFF
    if (resolved === ExecutionMode.REAL && !REAL_ACTIVATION_ALLOWED) {
      console.error(
        `[SPOT][SECURITY] DB contains spot_execution_mode=REAL but REAL_ACTIVATION_ALLOWED=false. ` +
        `Forcing OFF. This may indicate tampering or stale config.`
      );
      // Correct the DB
      await db.execute(sql`
        UPDATE bot_config SET spot_execution_mode = 'OFF' WHERE spot_execution_mode = 'REAL'
      `);
      resolved = ExecutionMode.OFF;
    }

    cachedMode = resolved;
    lastLoadTime = Date.now();
    return resolved;
  } catch (error) {
    console.error("[SPOT] Failed to load execution mode from DB, defaulting to OFF:", error);
    cachedMode = ExecutionMode.OFF;
    lastLoadTime = Date.now();
    return ExecutionMode.OFF;
  }
}

/**
 * Persist execution mode to DB.
 * REAL is blocked if REAL_ACTIVATION_ALLOWED is false.
 */
export async function saveExecutionMode(mode: ExecutionMode): Promise<void> {
  // Block REAL
  if (mode === ExecutionMode.REAL && !REAL_ACTIVATION_ALLOWED) {
    throw new Error(
      `REAL execution mode is not authorized. REAL_ACTIVATION_ALLOWED=false.`
    );
  }

  await db.execute(sql`
    UPDATE bot_config SET spot_execution_mode = ${mode}, updated_at = NOW()
  `);

  // Invalidate cache
  cachedMode = mode;
  lastLoadTime = Date.now();
}

/**
 * Get current execution mode (from cache or DB).
 * Synchronous version for cases where we need a quick read.
 * Falls back to OFF if cache is stale.
 */
export function getCachedExecutionMode(): ExecutionMode {
  if (cachedMode !== null && Date.now() - lastLoadTime < CACHE_TTL_MS) {
    return cachedMode;
  }
  // Cache stale — trigger async load (non-blocking)
  loadExecutionMode().catch(() => {});
  // Return cached or OFF
  return cachedMode ?? ExecutionMode.OFF;
}

/**
 * Invalidate cache (e.g. after external change).
 */
export function invalidateExecutionModeCache(): void {
  cachedMode = null;
  lastLoadTime = 0;
}
