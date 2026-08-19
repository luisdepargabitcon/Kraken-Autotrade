/**
 * spotPairToggle — Race-safe enable/disable of individual SPOT trading pairs.
 *
 * Design:
 *   - Reads/writes bot_config.active_pairs in DB.
 *   - Uses a mutex (Promise queue) to serialize toggle operations.
 *   - Disabling a pair stops NEW entries (scan) for that pair but does NOT:
 *     - Close existing positions
 *     - Cancel active intents
 *     - Affect position supervision (runPositionSupervisor protects ALL open positions)
 *   - Enabling a pair resumes scan evaluation for that pair.
 *
 * INVARIANTS:
 *   - No DB migration required — reuses existing bot_config.active_pairs JSON array.
 *   - Toggle is idempotent: toggling an already-enabled pair to enabled is a no-op.
 *   - DEFAULT_ACTIVE_PAIRS used as fallback if bot_config has no active_pairs.
 */

import { db } from "../../db";
import { sql } from "drizzle-orm";
import { DEFAULT_ACTIVE_PAIRS, normalizePair } from "../pairAllowlist";

// ─── Mutex ──────────────────────────────────────────────────────────────────

let toggleMutex: Promise<unknown> = Promise.resolve();

async function withToggleLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = toggleMutex;
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const next = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  toggleMutex = next.catch(() => {});

  await prev;
  try {
    const result = await fn();
    resolve(result);
    return result;
  } catch (err) {
    reject(err as Error);
    throw err;
  }
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PairToggleResult {
  pair: string;
  enabled: boolean;
  activePairs: string[];
  message: string;
}

export interface PairStatus {
  pair: string;
  enabled: boolean;
}

// ─── DB helpers ─────────────────────────────────────────────────────────────

async function readActivePairs(): Promise<string[]> {
  try {
    const result = await db.execute(sql`
      SELECT active_pairs FROM bot_config LIMIT 1
    `);
    if (result.rows.length === 0) return [...DEFAULT_ACTIVE_PAIRS];
    const pairs = result.rows[0].active_pairs as string[] | null;
    if (!pairs || !Array.isArray(pairs) || pairs.length === 0) {
      return [...DEFAULT_ACTIVE_PAIRS];
    }
    return pairs.map(normalizePair);
  } catch (error) {
    console.error("[spotPairToggle] Failed to read active_pairs:", error);
    return [...DEFAULT_ACTIVE_PAIRS];
  }
}

async function writeActivePairs(pairs: string[]): Promise<void> {
  await db.execute(sql`
    UPDATE bot_config SET active_pairs = ${JSON.stringify(pairs)}::jsonb
    WHERE id = (SELECT id FROM bot_config LIMIT 1)
  `);
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Get all known pairs with their enabled status.
 * Known pairs = union of DEFAULT_ACTIVE_PAIRS and currently configured active_pairs.
 */
export async function getPairStatuses(): Promise<PairStatus[]> {
  const activePairs = await readActivePairs();
  const activeSet = new Set(activePairs.map(normalizePair));

  // Union of defaults and active
  const allPairs = new Set<string>([...DEFAULT_ACTIVE_PAIRS, ...activePairs]);

  return Array.from(allPairs).sort().map(pair => ({
    pair,
    enabled: activeSet.has(normalizePair(pair)),
  }));
}

/**
 * Enable a pair for SPOT scanning (new entries).
 * Race-safe via mutex. Idempotent.
 */
export async function enablePair(pair: string): Promise<PairToggleResult> {
  return withToggleLock(async () => {
    const normalized = normalizePair(pair);
    const current = await readActivePairs();

    if (current.includes(normalized)) {
      return {
        pair: normalized,
        enabled: true,
        activePairs: current,
        message: `Par ${normalized} ya está activo`,
      };
    }

    const updated = [...current, normalized];
    await writeActivePairs(updated);

    console.log(`[spotPairToggle] Enabled pair: ${normalized}`);
    return {
      pair: normalized,
      enabled: true,
      activePairs: updated,
      message: `Par ${normalized} activado — nuevas entradas permitidas`,
    };
  });
}

/**
 * Disable a pair for SPOT scanning (no new entries).
 * Race-safe via mutex. Idempotent.
 * Does NOT affect existing positions or active intents.
 */
export async function disablePair(pair: string): Promise<PairToggleResult> {
  return withToggleLock(async () => {
    const normalized = normalizePair(pair);
    const current = await readActivePairs();

    if (!current.includes(normalized)) {
      return {
        pair: normalized,
        enabled: false,
        activePairs: current,
        message: `Par ${normalized} ya está inactivo`,
      };
    }

    const updated = current.filter(p => normalizePair(p) !== normalized);

    // Don't allow removing ALL pairs — keep at least the defaults
    if (updated.length === 0) {
      return {
        pair: normalized,
        enabled: true,
        activePairs: current,
        message: `No se puede desactivar el último par activo`,
      };
    }

    await writeActivePairs(updated);

    console.log(`[spotPairToggle] Disabled pair: ${normalized} — existing positions and intents are NOT affected`);
    return {
      pair: normalized,
      enabled: false,
      activePairs: updated,
      message: `Par ${normalized} desactivado — no hay nuevas entradas. Posiciones e intents existentes se mantienen.`,
    };
  });
}

/**
 * Toggle a pair's enabled status.
 * Race-safe via mutex.
 */
export async function togglePair(pair: string, enable: boolean): Promise<PairToggleResult> {
  return enable ? enablePair(pair) : disablePair(pair);
}
