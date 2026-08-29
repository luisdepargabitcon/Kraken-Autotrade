/**
 * spotForwardTwinCollector — In-memory ring buffer + async flush to DB.
 *
 * CAPTURE IS NON-BLOCKING:
 *   - captureScan(), captureSupervisor(), captureFill() are synchronous.
 *   - They push a ForwardTwinSnapshot to an in-memory ring buffer.
 *   - A timer flushes the buffer to DB every FLUSH_INTERVAL_MS.
 *   - If the buffer is full, oldest entries are dropped (ring buffer).
 *
 * FLUSH IS ASYNC:
 *   - Batch INSERT to spot_forward_twin_snapshots.
 *   - Retention: deletes entries older than RETENTION_DAYS on each flush.
 *   - If DB is unavailable, flush is skipped (buffer continues to accept).
 *
 * SANITIZATION:
 *   - No API keys, credentials, or secrets are ever in the snapshot data.
 *   - Only market data, decision states, and execution results are captured.
 *
 * INVARIANTS:
 *   - capture* methods NEVER throw (try/catch internally).
 *   - flush() NEVER throws (errors are logged).
 *   - Buffer size is bounded by BUFFER_MAX.
 *   - Only active when enabled (set by SpotEngine on SHADOW mode).
 */

import { db } from "../../db";
import { sql } from "drizzle-orm";
import {
  SPOT_FORWARD_TWIN_SCHEMA_VERSION,
  SPOT_FORWARD_TWIN_RETENTION_DAYS,
  SPOT_FORWARD_TWIN_FLUSH_INTERVAL_MS,
  SPOT_FORWARD_TWIN_BUFFER_MAX,
  type ForwardTwinSnapshot,
} from "./spotForwardTwinTypes";

// ─── Singleton State ─────────────────────────────────────────────────────────

let enabled = false;
let buffer: ForwardTwinSnapshot[] = [];
let flushTimer: NodeJS.Timeout | null = null;
let isFlushing = false;
let totalCaptured = 0;
let totalFlushed = 0;
let droppedSnapshots = 0;
let lastFlushError: string | null = null;
let lastFlushAt: number | null = null;

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Enable telemetry capture. Called when SpotEngine enters SHADOW mode.
 */
export function enableForwardTwin(): void {
  if (enabled) return;
  enabled = true;
  startFlushTimer();
  console.log("[ForwardTwin] Telemetry capture enabled");
}

/**
 * Disable telemetry capture. Called when SpotEngine exits SHADOW mode.
 * Performs a final flush before disabling.
 */
export async function disableForwardTwin(): Promise<void> {
  if (!enabled) return;
  enabled = false;
  stopFlushTimer();
  await flush();
  console.log("[ForwardTwin] Telemetry capture disabled");
}

/**
 * Check if telemetry capture is enabled.
 */
export function isForwardTwinEnabled(): boolean {
  return enabled;
}

/**
 * Capture a scan snapshot. Non-blocking, never throws.
 */
export function captureScan(snapshot: ForwardTwinSnapshot): void {
  if (!enabled) return;
  try {
    pushToBuffer(snapshot);
  } catch {
    // Never throw from capture
  }
}

/**
 * Capture a supervisor snapshot. Non-blocking, never throws.
 */
export function captureSupervisor(snapshot: ForwardTwinSnapshot): void {
  if (!enabled) return;
  try {
    pushToBuffer(snapshot);
  } catch {
    // Never throw from capture
  }
}

/**
 * Capture a fill snapshot. Non-blocking, never throws.
 */
export function captureFill(snapshot: ForwardTwinSnapshot): void {
  if (!enabled) return;
  try {
    pushToBuffer(snapshot);
  } catch {
    // Never throw from capture
  }
}

/**
 * Flush the buffer to DB. Async, never throws.
 * Batch INSERT all buffered snapshots + retention cleanup.
 */
export async function flush(): Promise<void> {
  if (isFlushing) return;
  if (buffer.length === 0) return;

  isFlushing = true;
  const batch = buffer.slice();
  buffer = [];

  try {
    // Batch INSERT — single query with VALUES list
    // R16: Project regime/direction into physical columns for SCAN snapshots.
    // SUPERVISOR and FILL get NULL/NULL/NULL for the three projection columns.
    const values = batch.map(snap => {
      const jsonStr = JSON.stringify(snap).replace(/'/g, "''");
      let regimeCol = "NULL";
      let directionCol = "NULL";
      let versionCol = "NULL";
      if (snap.snapshotType === "SCAN") {
        const projectedRegime = snap.regime?.regime ?? null;
        const projectedDirection = snap.regime?.direction ?? null;
        regimeCol = projectedRegime !== null ? `'${projectedRegime.replace(/'/g, "''")}'` : "NULL";
        directionCol = projectedDirection !== null ? `'${projectedDirection.replace(/'/g, "''")}'` : "NULL";
        versionCol = "1";
      }
      return `(${snap.schemaVersion}, '${snap.snapshotType}', '${snap.scanId.replace(/'/g, "''")}', ${snap.timestamp}, '${snap.pair.replace(/'/g, "''")}', '${snap.policyVersion.replace(/'/g, "''")}', '${snap.executionMode.replace(/'/g, "''")}', '${snap.engineOwner.replace(/'/g, "''")}', '${jsonStr}'::jsonb, ${regimeCol}, ${directionCol}, ${versionCol})`;
    }).join(', ');
    await db.execute(sql.raw(
      `INSERT INTO spot_forward_twin_snapshots (schema_version, snapshot_type, scan_id, timestamp, pair, policy_version, execution_mode, engine_owner, data, regime, direction, regime_projection_version) VALUES ${values}`
    ));
    totalFlushed += batch.length;
    lastFlushAt = Date.now();
    lastFlushError = null;

    // Retention cleanup
    const cutoff = Date.now() - SPOT_FORWARD_TWIN_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    await db.execute(sql`
      DELETE FROM spot_forward_twin_snapshots WHERE timestamp < ${cutoff}
    `);
  } catch (error: any) {
    lastFlushError = error.message;
    // Drop failed batch — do NOT re-buffer to avoid duplicates
    console.error(`[ForwardTwin] Flush error: ${error.message} — ${batch.length} snapshots lost`);
  } finally {
    isFlushing = false;
  }
}

/**
 * Get collector stats for monitoring.
 */
export function getCollectorStats(): {
  enabled: boolean;
  bufferSize: number;
  bufferMax: number;
  totalCaptured: number;
  totalFlushed: number;
  droppedSnapshots: number;
  lastFlushAt: number | null;
  lastFlushError: string | null;
  isFlushing: boolean;
} {
  return {
    enabled,
    bufferSize: buffer.length,
    bufferMax: SPOT_FORWARD_TWIN_BUFFER_MAX,
    totalCaptured,
    totalFlushed,
    droppedSnapshots,
    lastFlushAt,
    lastFlushError,
    isFlushing,
  };
}

// ─── Test-only API ───────────────────────────────────────────────────────────

/**
 * Reset all state for testing.
 */
export function _resetForTest(): void {
  enabled = false;
  buffer = [];
  stopFlushTimer();
  isFlushing = false;
  totalCaptured = 0;
  totalFlushed = 0;
  droppedSnapshots = 0;
  lastFlushError = null;
  lastFlushAt = null;
}

/**
 * Get buffer contents for testing (does not flush).
 */
export function _getBufferForTest(): ForwardTwinSnapshot[] {
  return buffer.slice();
}

/**
 * Enable without starting timer (for unit tests).
 */
export function _enableForTest(): void {
  enabled = true;
}

/**
 * Disable without flushing (for unit tests).
 */
export function _disableForTest(): void {
  enabled = false;
}

// ─── Internal ────────────────────────────────────────────────────────────────

function pushToBuffer(snapshot: ForwardTwinSnapshot): void {
  if (buffer.length >= SPOT_FORWARD_TWIN_BUFFER_MAX) {
    // Ring buffer: drop oldest, increment counter
    buffer.shift();
    droppedSnapshots++;
  }
  buffer.push(snapshot);
  totalCaptured++;
}

function startFlushTimer(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    flush().catch((err) => {
      console.error(`[ForwardTwin] Timer flush error: ${err.message}`);
    });
  }, SPOT_FORWARD_TWIN_FLUSH_INTERVAL_MS);
  flushTimer.unref?.();
}

function stopFlushTimer(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}
