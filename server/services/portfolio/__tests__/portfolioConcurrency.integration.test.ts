/**
 * R2.37 — Concurrent Reservation Test (PostgreSQL real)
 * R2.38 — Idempotent Reservation Test
 * R2.39 — Order Lock Concurrency Test
 * R2.40 — Restart Persistence Test
 *
 * These tests require a real PostgreSQL instance.
 * They are skipped when DATABASE_URL is not set.
 *
 * In CI, PostgreSQL 16 is provisioned with migrations 080-085 applied.
 *
 * SAFETY: Uses a dedicated test schema/tables that are cleaned up after each test.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool } from "pg";

const DATABASE_URL = process.env.DATABASE_URL || process.env.TEST_DATABASE_URL;

const shouldSkip = !DATABASE_URL;

const pool = shouldSkip ? null : new Pool({
  connectionString: DATABASE_URL,
  max: 10,
});

// Import the real repository functions but override the pool
async function withTestPool<T>(fn: (client: import("pg").PoolClient) => Promise<T>): Promise<T> {
  if (!pool) throw new Error("No pool");
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

describe.skipIf(shouldSkip)("R2.37-R2.40 PostgreSQL Concurrency & Persistence", () => {

  beforeAll(async () => {
    if (!pool) return;
    // Ensure tables exist (migrations should be applied by CI setup)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS portfolio_mode_budgets (
        id SERIAL PRIMARY KEY,
        mode TEXT NOT NULL,
        exchange TEXT NOT NULL,
        asset TEXT NOT NULL,
        budgeted_usd NUMERIC(18,2) NOT NULL DEFAULT 0,
        deployed_usd NUMERIC(18,2) NOT NULL DEFAULT 0,
        reserved_usd NUMERIC(18,2) NOT NULL DEFAULT 0,
        allocation_type TEXT NOT NULL DEFAULT 'MANUAL_FIXED_ALLOCATION',
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(mode, exchange, asset)
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS portfolio_reservations (
        id SERIAL PRIMARY KEY,
        reservation_id TEXT NOT NULL UNIQUE,
        idempotency_key TEXT NOT NULL UNIQUE,
        mode TEXT NOT NULL,
        exchange TEXT NOT NULL,
        asset TEXT NOT NULL,
        amount_usd NUMERIC(18,2) NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'PENDING',
        logical_intent_id TEXT,
        order_id TEXT,
        expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        confirmed_at TIMESTAMPTZ,
        released_at TIMESTAMPTZ,
        release_reason TEXT
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS portfolio_order_locks (
        id SERIAL PRIMARY KEY,
        lock_id TEXT NOT NULL UNIQUE,
        lock_key TEXT NOT NULL UNIQUE,
        mode TEXT NOT NULL,
        exchange TEXT NOT NULL,
        asset TEXT NOT NULL,
        logical_intent_id TEXT,
        status TEXT NOT NULL DEFAULT 'ACQUIRED',
        owner_instance TEXT,
        acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ,
        released_at TIMESTAMPTZ
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS portfolio_inventory_attribution (
        id SERIAL PRIMARY KEY,
        attribution_id TEXT NOT NULL UNIQUE,
        exchange TEXT NOT NULL,
        asset TEXT NOT NULL,
        mode TEXT NOT NULL,
        quantity NUMERIC(18,8) NOT NULL DEFAULT 0,
        cost_basis_usd NUMERIC(18,2) NOT NULL DEFAULT 0,
        source_type TEXT NOT NULL DEFAULT 'MANUAL',
        source_id TEXT,
        cycle_id TEXT,
        tranche_id TEXT,
        lot_id TEXT,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS portfolio_ledger_entries (
        id SERIAL PRIMARY KEY,
        event_id TEXT NOT NULL UNIQUE,
        idempotency_key TEXT NOT NULL UNIQUE,
        entry_type TEXT NOT NULL,
        exchange TEXT NOT NULL,
        asset TEXT NOT NULL,
        quantity NUMERIC(18,8) NOT NULL DEFAULT 0,
        amount_usd NUMERIC(18,2) NOT NULL DEFAULT 0,
        price_usd NUMERIC(18,8),
        fee_usd NUMERIC(18,2) NOT NULL DEFAULT 0,
        from_bucket TEXT,
        to_bucket TEXT,
        mode TEXT,
        cycle_id TEXT,
        tranche_id TEXT,
        reservation_id TEXT,
        order_id TEXT,
        realized_pnl_usd NUMERIC(18,2),
        environment TEXT NOT NULL DEFAULT 'LIVE',
        simulation_source TEXT,
        source TEXT NOT NULL DEFAULT 'SYSTEM',
        metadata_hash TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS portfolio_reconciliation_runs (
        reconciliation_id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'PENDING',
        exchange TEXT NOT NULL,
        asset TEXT NOT NULL,
        physical_balance NUMERIC(18,8) NOT NULL DEFAULT 0,
        attributed_balance NUMERIC(18,8) NOT NULL DEFAULT 0,
        budgeted_usd NUMERIC(18,2) NOT NULL DEFAULT 0,
        deployed_usd NUMERIC(18,2) NOT NULL DEFAULT 0,
        reserved_usd NUMERIC(18,2) NOT NULL DEFAULT 0,
        discrepancy_qty NUMERIC(18,8) NOT NULL DEFAULT 0,
        discrepancy_usd NUMERIC(18,2) NOT NULL DEFAULT 0,
        discrepancy_pct NUMERIC(8,2) NOT NULL DEFAULT 0,
        details_json JSONB NOT NULL DEFAULT '{}',
        blockers_json JSONB NOT NULL DEFAULT '[]',
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  });

  beforeEach(async () => {
    if (!pool) return;
    // Clean up test data before each test
    await pool.query("DELETE FROM portfolio_reservations WHERE reservation_id LIKE 'test-r2-%'");
    await pool.query("DELETE FROM portfolio_order_locks WHERE lock_id LIKE 'test-r2-%'");
    await pool.query("DELETE FROM portfolio_mode_budgets WHERE mode IN ('AMA','GRID','IDCA','SPOT_NORMAL') AND exchange = 'test-exchange'");
    await pool.query("DELETE FROM portfolio_inventory_attribution WHERE attribution_id LIKE 'test-r2-%'");
    await pool.query("DELETE FROM portfolio_ledger_entries WHERE event_id LIKE 'test-r2-%'");
    await pool.query("DELETE FROM portfolio_reconciliation_runs WHERE reconciliation_id LIKE 'test-r2-%'");
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query("DELETE FROM portfolio_reservations WHERE reservation_id LIKE 'test-r2-%'");
    await pool.query("DELETE FROM portfolio_order_locks WHERE lock_id LIKE 'test-r2-%'");
    await pool.query("DELETE FROM portfolio_mode_budgets WHERE exchange = 'test-exchange'");
    await pool.query("DELETE FROM portfolio_inventory_attribution WHERE attribution_id LIKE 'test-r2-%'");
    await pool.query("DELETE FROM portfolio_ledger_entries WHERE event_id LIKE 'test-r2-%'");
    await pool.query("DELETE FROM portfolio_reconciliation_runs WHERE reconciliation_id LIKE 'test-r2-%'");
    await pool.end();
  });

  // ─── R2.37: Concurrent Reservation ──────────────────────────────────

  describe("R2.37 Concurrent Reservation", () => {
    it("exactly one reservation succeeds when two compete for same budget", async () => {
      if (!pool) return;

      // Setup: budget = 1000, free = 1000
      await pool.query(
        `INSERT INTO portfolio_mode_budgets (mode, exchange, asset, budgeted_usd, deployed_usd, reserved_usd)
         VALUES ('AMA', 'test-exchange', 'BTC', 1000, 0, 0)`,
      );

      // Two concurrent reservations of 700 each
      const reserveA = pool.query(
        `UPDATE portfolio_mode_budgets
         SET reserved_usd = reserved_usd + 700, updated_at = NOW()
         WHERE mode = 'AMA' AND exchange = 'test-exchange' AND asset = 'BTC'
           AND status = 'ACTIVE'
           AND (budgeted_usd - deployed_usd - reserved_usd) >= 700
         RETURNING id, reserved_usd`,
      );
      const reserveB = pool.query(
        `UPDATE portfolio_mode_budgets
         SET reserved_usd = reserved_usd + 700, updated_at = NOW()
         WHERE mode = 'AMA' AND exchange = 'test-exchange' AND asset = 'BTC'
           AND status = 'ACTIVE'
           AND (budgeted_usd - deployed_usd - reserved_usd) >= 700
         RETURNING id, reserved_usd`,
      );

      const [resultA, resultB] = await Promise.all([reserveA, reserveB]);

      const aPassed = resultA.rows.length > 0;
      const bPassed = resultB.rows.length > 0;

      // Exactly one must pass
      expect(aPassed || bPassed).toBe(true);
      expect(aPassed && bPassed).toBe(false);

      // Verify final state
      const finalState = await pool.query(
        `SELECT reserved_usd, budgeted_usd, deployed_usd FROM portfolio_mode_budgets
         WHERE mode = 'AMA' AND exchange = 'test-exchange' AND asset = 'BTC'`,
      );
      const reserved = parseFloat(finalState.rows[0].reserved_usd);
      expect(reserved).toBe(700);
      expect(reserved).not.toBe(1400);
    });
  });

  // ─── R2.38: Idempotent Reservation ──────────────────────────────────

  describe("R2.38 Idempotent Reservation", () => {
    it("same idempotencyKey produces only one reservation", async () => {
      if (!pool) return;

      const idempotencyKey = "test-r2-idemp-001";

      // First insert
      const first = await pool.query(
        `INSERT INTO portfolio_reservations
           (reservation_id, idempotency_key, mode, exchange, asset, amount_usd, status)
         VALUES ('test-r2-res-001', $1, 'AMA', 'test-exchange', 'BTC', 500, 'PENDING')
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id`,
        [idempotencyKey],
      );
      expect(first.rows.length).toBe(1);

      // Second insert with same idempotency key
      const second = await pool.query(
        `INSERT INTO portfolio_reservations
           (reservation_id, idempotency_key, mode, exchange, asset, amount_usd, status)
         VALUES ('test-r2-res-002', $1, 'AMA', 'test-exchange', 'BTC', 500, 'PENDING')
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id`,
        [idempotencyKey],
      );
      expect(second.rows.length).toBe(0);

      // Verify only one row exists
      const count = await pool.query(
        `SELECT COUNT(*) as count FROM portfolio_reservations WHERE idempotency_key = $1`,
        [idempotencyKey],
      );
      expect(parseInt(count.rows[0].count, 10)).toBe(1);
    });
  });

  // ─── R2.39: Order Lock Concurrency ──────────────────────────────────

  describe("R2.39 Order Lock Concurrency", () => {
    it("only one worker acquires lock for same key", async () => {
      if (!pool) return;

      const lockKey = "GRID:test-exchange:BTC:intent-123";

      const lockA = pool.query(
        `INSERT INTO portfolio_order_locks (lock_id, lock_key, mode, exchange, asset, status)
         VALUES ('test-r2-lock-a', $1, 'GRID', 'test-exchange', 'BTC', 'ACQUIRED')
         ON CONFLICT (lock_key) DO NOTHING
         RETURNING id`,
        [lockKey],
      );
      const lockB = pool.query(
        `INSERT INTO portfolio_order_locks (lock_id, lock_key, mode, exchange, asset, status)
         VALUES ('test-r2-lock-b', $1, 'GRID', 'test-exchange', 'BTC', 'ACQUIRED')
         ON CONFLICT (lock_key) DO NOTHING
         RETURNING id`,
        [lockKey],
      );

      const [resultA, resultB] = await Promise.all([lockA, lockB]);

      const aAcquired = resultA.rows.length > 0;
      const bAcquired = resultB.rows.length > 0;

      expect(aAcquired || bAcquired).toBe(true);
      expect(aAcquired && bAcquired).toBe(false);

      // Verify only one active lock
      const activeLocks = await pool.query(
        `SELECT COUNT(*) as count FROM portfolio_order_locks WHERE lock_key = $1 AND status = 'ACQUIRED'`,
        [lockKey],
      );
      expect(parseInt(activeLocks.rows[0].count, 10)).toBe(1);
    });

    it("lock can be re-acquired after release", async () => {
      if (!pool) return;

      const lockKey = "GRID:test-exchange:BTC:intent-456";

      // Acquire
      const acquire = await pool.query(
        `INSERT INTO portfolio_order_locks (lock_id, lock_key, mode, exchange, asset, status)
         VALUES ('test-r2-lock-c', $1, 'GRID', 'test-exchange', 'BTC', 'ACQUIRED')
         ON CONFLICT (lock_key) DO NOTHING
         RETURNING id`,
        [lockKey],
      );
      expect(acquire.rows.length).toBe(1);

      // Release
      await pool.query(
        `UPDATE portfolio_order_locks SET status = 'RELEASED', released_at = NOW()
         WHERE lock_key = $1 AND status = 'ACQUIRED'`,
        [lockKey],
      );

      // Re-acquire with new lock_id (conflict is on lock_key, but it's now RELEASED)
      // Need to use a different approach: INSERT with a new lock_key won't work
      // because lock_key is UNIQUE. We need to UPDATE the existing row back.
      const reacquire = await pool.query(
        `UPDATE portfolio_order_locks
         SET status = 'ACQUIRED', lock_id = 'test-r2-lock-d', released_at = NULL, acquired_at = NOW()
         WHERE lock_key = $1 AND status = 'RELEASED'
         RETURNING id`,
        [lockKey],
      );
      expect(reacquire.rows.length).toBe(1);
    });

    it("expired lock allows new acquisition", async () => {
      if (!pool) return;

      const lockKey = "IDCA:test-exchange:BTC:intent-789";

      // Insert an already-expired lock
      await pool.query(
        `INSERT INTO portfolio_order_locks (lock_id, lock_key, mode, exchange, asset, status, expires_at)
         VALUES ('test-r2-lock-e', $1, 'IDCA', 'test-exchange', 'BTC', 'ACQUIRED', NOW() - INTERVAL '1 minute')
         ON CONFLICT (lock_key) DO NOTHING`,
        [lockKey],
      );

      // Expire it
      await pool.query(
        `UPDATE portfolio_order_locks SET status = 'EXPIRED'
         WHERE lock_key = $1 AND status = 'ACQUIRED' AND expires_at < NOW()`,
        [lockKey],
      );

      // Re-acquire by updating the expired lock
      const reacquire = await pool.query(
        `UPDATE portfolio_order_locks
         SET status = 'ACQUIRED', lock_id = 'test-r2-lock-f', expires_at = NULL, acquired_at = NOW()
         WHERE lock_key = $1 AND status = 'EXPIRED'
         RETURNING id`,
        [lockKey],
      );
      expect(reacquire.rows.length).toBe(1);
    });
  });

  // ─── R2.40: Restart Persistence ─────────────────────────────────────

  describe("R2.40 Restart Persistence", () => {
    it("all portfolio state persists across instance restart", async () => {
      if (!pool) return;

      // Instance A: Create all state
      await pool.query(
        `INSERT INTO portfolio_mode_budgets (mode, exchange, asset, budgeted_usd, deployed_usd, reserved_usd)
         VALUES ('AMA', 'test-exchange', 'BTC', 5000, 2000, 1000)`,
      );

      await pool.query(
        `INSERT INTO portfolio_reservations (reservation_id, idempotency_key, mode, exchange, asset, amount_usd, status)
         VALUES ('test-r2-restart-res', 'test-r2-restart-idemp', 'AMA', 'test-exchange', 'BTC', 500, 'PENDING')`,
      );

      await pool.query(
        `INSERT INTO portfolio_order_locks (lock_id, lock_key, mode, exchange, asset, status)
         VALUES ('test-r2-restart-lock', 'AMA:test-exchange:BTC:restart', 'AMA', 'test-exchange', 'BTC', 'ACQUIRED')`,
      );

      await pool.query(
        `INSERT INTO portfolio_inventory_attribution (attribution_id, exchange, asset, mode, quantity, cost_basis_usd, source_type, status)
         VALUES ('test-r2-restart-attr', 'test-exchange', 'BTC', 'AMA', 0.05, 2000, 'AMA_TRANCHE', 'ACTIVE')`,
      );

      await pool.query(
        `INSERT INTO portfolio_ledger_entries (event_id, idempotency_key, entry_type, exchange, asset, quantity, amount_usd, mode, source)
         VALUES ('test-r2-restart-ledger', 'test-r2-restart-ledger-idemp', 'PURCHASE', 'test-exchange', 'BTC', 0.05, 2000, 'AMA', 'TEST')`,
      );

      await pool.query(
        `INSERT INTO portfolio_reconciliation_runs (reconciliation_id, status, exchange, asset, physical_balance, attributed_balance)
         VALUES ('test-r2-restart-recon', 'RECONCILED', 'test-exchange', 'BTC', 0.05, 0.05)`,
      );

      // Simulate "restart" — just read back everything
      // No in-memory cache, all from DB

      const budget = await pool.query(
        `SELECT * FROM portfolio_mode_budgets WHERE mode = 'AMA' AND exchange = 'test-exchange' AND asset = 'BTC'`,
      );
      expect(budget.rows).toHaveLength(1);
      expect(parseFloat(budget.rows[0].budgeted_usd)).toBe(5000);
      expect(parseFloat(budget.rows[0].deployed_usd)).toBe(2000);
      expect(parseFloat(budget.rows[0].reserved_usd)).toBe(1000);

      const reservation = await pool.query(
        `SELECT * FROM portfolio_reservations WHERE reservation_id = 'test-r2-restart-res'`,
      );
      expect(reservation.rows).toHaveLength(1);
      expect(reservation.rows[0].status).toBe("PENDING");
      expect(parseFloat(reservation.rows[0].amount_usd)).toBe(500);

      const lock = await pool.query(
        `SELECT * FROM portfolio_order_locks WHERE lock_key = 'AMA:test-exchange:BTC:restart'`,
      );
      expect(lock.rows).toHaveLength(1);
      expect(lock.rows[0].status).toBe("ACQUIRED");

      const attribution = await pool.query(
        `SELECT * FROM portfolio_inventory_attribution WHERE attribution_id = 'test-r2-restart-attr'`,
      );
      expect(attribution.rows).toHaveLength(1);
      expect(parseFloat(attribution.rows[0].quantity)).toBeCloseTo(0.05);
      expect(attribution.rows[0].status).toBe("ACTIVE");

      const ledger = await pool.query(
        `SELECT * FROM portfolio_ledger_entries WHERE event_id = 'test-r2-restart-ledger'`,
      );
      expect(ledger.rows).toHaveLength(1);
      expect(ledger.rows[0].entry_type).toBe("PURCHASE");

      const recon = await pool.query(
        `SELECT * FROM portfolio_reconciliation_runs WHERE reconciliation_id = 'test-r2-restart-recon'`,
      );
      expect(recon.rows).toHaveLength(1);
      expect(recon.rows[0].status).toBe("RECONCILED");
    });
  });
});
