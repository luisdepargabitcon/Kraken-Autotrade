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
 *   - Zero active pairs (active_pairs=[]) is VALID and persisted explicitly.
 *   - DB read failures FAIL CLOSED — throw error, do NOT default to allowlist.
 *   - Pair validation against allowlist is strict — invalid pairs are rejected with 400.
 *   - Toggle integrates with SpotEngine entry generation for race safety.
 */

import { db } from "../../db";
import { sql } from "drizzle-orm";
import { DEFAULT_ACTIVE_PAIRS, normalizePair } from "../pairAllowlist";
import { _invalidatePairEntryGenerationOnly, _drainPairCriticalSection } from "./spotEngine";

// ─── Typed errors ────────────────────────────────────────────────────────────

export class PairDisableDrainTimeoutError extends Error {
  readonly pair: string;
  readonly remainingCount: number;
  constructor(pair: string, remainingCount: number) {
    super(`El activo ${pair} se ha marcado como desactivado, pero todavía existe una sección crítica de entrada en curso. No se considera completada la desactivación hasta que el motor quede drenado.`);
    this.name = "PairDisableDrainTimeoutError";
    this.pair = pair;
    this.remainingCount = remainingCount;
  }
}

// ─── Allowlist validation ───────────────────────────────────────────────────

const ALLOWLIST_SET = new Set<string>(DEFAULT_ACTIVE_PAIRS.map(normalizePair));

/**
 * Validate that a pair is in the known allowlist.
 * Throws PairValidationError if not.
 */
export function validatePairAllowed(pair: string): void {
  const normalized = normalizePair(pair);
  if (!ALLOWLIST_SET.has(normalized)) {
    throw new PairValidationError(`Par no permitido: ${normalized}. Pares válidos: ${Array.from(ALLOWLIST_SET).join(", ")}`);
  }
}

export class PairValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PairValidationError";
  }
}

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

/**
 * Read active pairs from DB. FAIL CLOSED on error — throw, do NOT default to allowlist.
 */
async function readActivePairs(): Promise<string[]> {
  const result = await db.execute(sql`
    SELECT active_pairs FROM bot_config LIMIT 1
  `);
  if (result.rows.length === 0) return [];
  const pairs = result.rows[0].active_pairs as string[] | null;
  if (!pairs || !Array.isArray(pairs)) return [];
  return pairs.map(normalizePair);
}

async function writeActivePairs(pairs: string[]): Promise<void> {
  await db.execute(sql`
    UPDATE bot_config SET active_pairs = (${JSON.stringify(pairs)}::jsonb)::text[]
    WHERE id = (SELECT id FROM bot_config LIMIT 1)
  `);
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Get all known pairs with their enabled status.
 * Known pairs = union of DEFAULT_ACTIVE_PAIRS and currently configured active_pairs.
 * FAIL CLOSED on DB error — throws.
 */
export async function getPairStatuses(): Promise<PairStatus[]> {
  let activePairs: string[];
  try {
    activePairs = await readActivePairs();
  } catch (error) {
    console.error("[spotPairToggle] Failed to read active_pairs — FAIL CLOSED:", error);
    throw error;
  }
  const activeSet = new Set(activePairs.map(normalizePair));

  const allPairs = new Set<string>([...DEFAULT_ACTIVE_PAIRS, ...activePairs]);

  return Array.from(allPairs).sort().map(pair => ({
    pair,
    enabled: activeSet.has(normalizePair(pair)),
  }));
}

/**
 * Enable a pair for SPOT scanning (new entries).
 * Race-safe via mutex. Idempotent.
 * Validates pair against allowlist.
 */
export async function enablePair(pair: string): Promise<PairToggleResult> {
  validatePairAllowed(pair);
  return withToggleLock(async () => {
    const normalized = normalizePair(pair);
    let current: string[];
    try {
      current = await readActivePairs();
    } catch (error) {
      console.error("[spotPairToggle] Failed to read active_pairs — FAIL CLOSED:", error);
      throw error;
    }

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
 * Zero active pairs is VALID — the last pair can be disabled.
 */
export async function disablePair(pair: string): Promise<PairToggleResult> {
  validatePairAllowed(pair);
  return withToggleLock(async () => {
    const normalized = normalizePair(pair);
    let current: string[];
    try {
      current = await readActivePairs();
    } catch (error) {
      console.error("[spotPairToggle] Failed to read active_pairs — FAIL CLOSED:", error);
      throw error;
    }

    if (!current.includes(normalized)) {
      // Pair is already absent from active_pairs, but a previous disable may have
      // timed out on drain. Re-invalidate generation and re-check the critical section
      // before declaring success. Do NOT write DB again.
      await _invalidatePairEntryGenerationOnly(normalized);
      const drainResult = await _drainPairCriticalSection(normalized);
      if (!drainResult.drained) {
        console.error(`[spotPairToggle] DRAIN_TIMEOUT (retry) for ${normalized} — ${drainResult.remainingCount} critical sections still active.`);
        throw new PairDisableDrainTimeoutError(normalized, drainResult.remainingCount);
      }
      return {
        pair: normalized,
        enabled: false,
        activePairs: current,
        message: `Par ${normalized} ya está inactivo`,
      };
    }

    const updated = current.filter(p => normalizePair(p) !== normalized);

    // P3: Invalidate per-pair generation BEFORE persisting to DB.
    // This ensures any in-flight scanPair for THIS pair sees the invalidated
    // generation as soon as possible, even before the DB write completes.
    // The drain happens AFTER the DB write to maintain consistency.
    await _invalidatePairEntryGenerationOnly(normalized);

    // Zero active pairs is VALID — persist explicitly.
    // The scan loop will simply not evaluate any pairs.
    await writeActivePairs(updated);

    // Drain the per-pair critical section AFTER the DB write.
    const drainResult = await _drainPairCriticalSection(normalized);
    if (!drainResult.drained) {
      console.error(`[spotPairToggle] DRAIN_TIMEOUT for ${normalized} — ${drainResult.remainingCount} critical sections still active.`);
      throw new PairDisableDrainTimeoutError(normalized, drainResult.remainingCount);
    }

    const zeroWarning = updated.length === 0 ? " — ADVERTENCIA: no hay pares activos, el motor no abrirá nuevas posiciones." : "";
    console.log(`[spotPairToggle] Disabled pair: ${normalized} — existing positions and intents are NOT affected${zeroWarning}`);
    return {
      pair: normalized,
      enabled: false,
      activePairs: updated,
      message: `Par ${normalized} desactivado — no hay nuevas entradas. Posiciones e intents existentes se mantienen.${zeroWarning}`,
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
