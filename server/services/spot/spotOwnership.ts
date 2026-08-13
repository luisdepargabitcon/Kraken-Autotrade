/**
 * R8: Canonical Ownership — Pure module with NO heavy dependencies.
 *
 * This module is intentionally dependency-free (no DB, no SpotEngine,
 * no MarketData, no exchanges, no routes). It can be imported directly
 * by TradingEngine or any other module without risking circular deps
 * or runtime initialization failures.
 *
 * INVARIANT:
 *   Once SPOT_CANONICAL is deployed, it ALWAYS owns new entries.
 *   Ownership does NOT depend on:
 *     - execution mode (OFF/SHADOW/REAL)
 *     - DB availability
 *     - dynamic import success
 *     - startup correctness
 *     - cache state
 *     - SpotEngine runtime state
 *
 * FAIL-CLOSED:
 *   If any caller cannot resolve ownership, the default is:
 *     spotOwnsRuntime = true  →  legacy entries BLOCKED.
 *   There is NO path where ownership resolution failure
 *   re-enables legacy new entries.
 */

// ─── Canonical Ownership Constant ───────────────────────────────────────────

/**
 * Hard-coded canonical ownership flag.
 * Once SPOT_CANONICAL code is deployed, this is ALWAYS true.
 * Changing this requires a new deployment — it is NOT runtime-configurable.
 */
export const SPOT_CANONICAL_OWNS_ENTRIES = true as const;

/**
 * The runtime owner identifier.
 * SPOT_CANONICAL is the sole owner of new entries.
 */
export const SPOT_RUNTIME_OWNER = "SpotEngine" as const;

/**
 * The engine owner identifier for DB provenance.
 */
export const SPOT_ENGINE_OWNER = "SPOT_CANONICAL" as const;

// ─── Ownership Check ────────────────────────────────────────────────────────

/**
 * Check if SPOT_CANONICAL is the runtime owner of new entries.
 *
 * This function is PURE — no side effects, no I/O, no dependencies.
 * It ALWAYS returns true once SPOT_CANONICAL is deployed.
 *
 * @returns true — SPOT_CANONICAL always owns new entries
 */
export function isSpotRuntimeOwner(): boolean {
  return SPOT_CANONICAL_OWNS_ENTRIES;
}

/**
 * Invariant: when ownership check fails (e.g. import error),
 * legacy entries must remain BLOCKED.
 *
 * This constant documents the fail-closed semantics.
 * If this were false, a failure would re-enable legacy entries (FAIL-OPEN).
 */
export const LEGACY_ENTRY_PERMISSION_WHEN_OWNERSHIP_CHECK_FAILS = false as const;
