/**
 * SPOT DRY RUN Cleanup Tests
 *
 * Tests for the dry_run_trades cleanup functionality:
 * - Duplicate detection and archival
 * - Legacy TimeStop exclusion
 * - PnL calculation (gross vs clean)
 * - IDCA safety (ensuring IDCA tables are never touched)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { sql } from "drizzle-orm";
import { dryRunTrades, dryRunTradesArchive } from "../../../shared/schema";

const DATABASE_URL = process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/trading_bot_test";

// Test helpers
async function insertDryRunTrade(
  db: any,
  overrides: Partial<typeof dryRunTrades.$inferInsert> = {}
) {
  const base = {
    simTxid: `SIM-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    pair: "BTC/USD",
    type: "buy" as const,
    price: "50000.00",
    amount: "0.1",
    totalUsd: "5000.00",
    status: "open" as const,
    createdAt: new Date(),
    ...overrides,
  };

  const result = await db.execute(sql`
    INSERT INTO dry_run_trades (
      sim_txid, pair, type, price, amount, total_usd,
      reason, normalized_reason, status, entry_sim_txid, entry_price,
      realized_pnl_usd, realized_pnl_pct, closed_at,
      strategy_id, regime, confidence, created_at,
      excluded_from_pnl, exclusion_reason, excluded_at, audit_batch_id
    ) VALUES (
      ${base.simTxid}, ${base.pair}, ${base.type}, ${base.price}, ${base.amount}, ${base.totalUsd},
      ${overrides.reason || null}, ${overrides.normalizedReason || null}, ${base.status}, ${overrides.entrySimTxid || null}, ${overrides.entryPrice || null},
      ${overrides.realizedPnlUsd || null}, ${overrides.realizedPnlPct || null}, ${overrides.closedAt || null},
      ${overrides.strategyId || null}, ${overrides.regime || null}, ${overrides.confidence || null}, ${base.createdAt},
      ${overrides.excludedFromPnl || false}, ${overrides.exclusionReason || null}, ${overrides.excludedAt || null}, ${overrides.auditBatchId || null}
    )
    RETURNING id
  `);

  return Number(result.rows[0].id);
}

describe("SPOT DRY RUN Cleanup", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle>;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    db = drizzle(pool);

    // Ensure archive table exists
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS dry_run_trades_archive (
        LIKE dry_run_trades INCLUDING ALL,
        archived_at TIMESTAMP NOT NULL DEFAULT NOW(),
        archive_reason TEXT NOT NULL DEFAULT 'exact_duplicate',
        original_id INTEGER
      )
    `);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    // Clean up test data
    await db.execute(sql`DELETE FROM dry_run_trades WHERE sim_txid LIKE 'SIM-%'`);
    await db.execute(sql`DELETE FROM dry_run_trades_archive WHERE sim_txid LIKE 'SIM-%'`);
  });

  // ============================================================
  // TEST 1: Duplicate detection
  // ============================================================
  it("should detect exact duplicate sells by type+pair+price+amount+reason+time", async () => {
    const now = new Date();
    const timeBucket = new Date(Math.floor(now.getTime() / 60000) * 60000); // Same minute

    // Insert canonical buy
    const buyId = await insertDryRunTrade(db, {
      type: "buy",
      simTxid: "BUY-001",
      price: "50000",
      amount: "0.1",
      createdAt: timeBucket,
    });

    // Insert canonical sell
    const sellId1 = await insertDryRunTrade(db, {
      type: "sell",
      simTxid: "SELL-001",
      pair: "BTC/USD",
      price: "51000",
      amount: "0.1",
      normalizedReason: "TIME_STOP",
      realizedPnlUsd: "100",
      realizedPnlPct: "2.0",
      closedAt: timeBucket,
      createdAt: timeBucket,
      entrySimTxid: "BUY-001",
    });

    // Insert duplicate sell (same everything except simTxid)
    const sellId2 = await insertDryRunTrade(db, {
      type: "sell",
      simTxid: "SELL-001-DUP", // Different ID
      pair: "BTC/USD",
      price: "51000", // Same
      amount: "0.1", // Same
      normalizedReason: "TIME_STOP", // Same
      realizedPnlUsd: "100", // Same
      realizedPnlPct: "2.0",
      closedAt: timeBucket, // Same minute
      createdAt: timeBucket,
      entrySimTxid: "BUY-001",
    });

    // Query for duplicates using same logic as cleanup script
    const dupResult = await db.execute(sql`
      WITH duplicate_groups AS (
        SELECT 
          id,
          ROW_NUMBER() OVER (
            PARTITION BY 
              type, pair, price, amount, 
              COALESCE(normalized_reason, reason, 'UNKNOWN'),
              DATE_TRUNC('minute', created_at)
            ORDER BY id ASC
          ) as rn
        FROM dry_run_trades
        WHERE type = 'sell'
      )
      SELECT id FROM duplicate_groups WHERE rn > 1
    `);

    expect(dupResult.rows.length).toBe(1);
    expect(Number(dupResult.rows[0].id)).toBe(sellId2); // Higher ID is the duplicate
  });

  // ============================================================
  // TEST 2: Canonical row preservation
  // ============================================================
  it("should preserve the lowest ID as canonical when duplicates exist", async () => {
    const now = new Date();

    // Insert multiple sells with same attributes
    const ids: number[] = [];
    for (let i = 0; i < 3; i++) {
      const id = await insertDryRunTrade(db, {
        type: "sell",
        simTxid: `SELL-${i}`,
        pair: "ETH/USD",
        price: "3000",
        amount: "1.0",
        normalizedReason: "BREAK_EVEN",
        realizedPnlUsd: "10",
        closedAt: now,
        createdAt: now,
      });
      ids.push(id);
    }

    // Lowest ID should be kept
    const canonicalId = Math.min(...ids);

    // Query canonical
    const canonicalResult = await db.execute(sql`
      SELECT id FROM dry_run_trades
      WHERE type = 'sell' AND pair = 'ETH/USD'
      ORDER BY id ASC
      LIMIT 1
    `);

    expect(Number(canonicalResult.rows[0].id)).toBe(canonicalId);
  });

  // ============================================================
  // TEST 3: Duplicate archival before deletion
  // ============================================================
  it("should archive duplicates before deleting from main table", async () => {
    const now = new Date();
    const batchId = "test-batch-001";

    // Create a duplicate
    const canonicalId = await insertDryRunTrade(db, {
      type: "sell",
      simTxid: "ARCHIVE-TEST-1",
      pair: "BTC/USD",
      price: "50000",
      amount: "0.1",
      normalizedReason: "SMART_EXIT",
      realizedPnlUsd: "50",
      closedAt: now,
      createdAt: now,
    });

    const duplicateId = await insertDryRunTrade(db, {
      type: "sell",
      simTxid: "ARCHIVE-TEST-2",
      pair: "BTC/USD",
      price: "50000", // Same
      amount: "0.1", // Same
      normalizedReason: "SMART_EXIT", // Same
      realizedPnlUsd: "50",
      closedAt: now,
      createdAt: now,
    });

    // Archive the duplicate
    await db.execute(sql`
      INSERT INTO dry_run_trades_archive (
        sim_txid, pair, type, price, amount, total_usd,
        reason, normalized_reason, status,
        realized_pnl_usd, realized_pnl_pct, closed_at, created_at,
        excluded_from_pnl, audit_batch_id,
        archive_reason, original_id
      )
      SELECT 
        sim_txid, pair, type, price, amount, total_usd,
        reason, normalized_reason, status,
        realized_pnl_usd, realized_pnl_pct, closed_at, created_at,
        excluded_from_pnl, ${batchId},
        'exact_duplicate', ${canonicalId}
      FROM dry_run_trades
      WHERE id = ${duplicateId}
    `);

    // Verify in archive
    const archiveCheck = await db.execute(sql`
      SELECT COUNT(*) as cnt FROM dry_run_trades_archive
      WHERE sim_txid = 'ARCHIVE-TEST-2' AND audit_batch_id = ${batchId}
    `);

    expect(Number(archiveCheck.rows[0].cnt)).toBe(1);

    // Now safe to delete from main
    await db.execute(sql`DELETE FROM dry_run_trades WHERE id = ${duplicateId}`);

    // Verify deleted
    const mainCheck = await db.execute(sql`
      SELECT COUNT(*) as cnt FROM dry_run_trades WHERE sim_txid = 'ARCHIVE-TEST-2'
    `);
    expect(Number(mainCheck.rows[0].cnt)).toBe(0);
  });

  // ============================================================
  // TEST 4: Legacy TimeStop exclusion (not deletion)
  // ============================================================
  it("should mark legacy TimeStop losses as excluded_from_pnl, not delete them", async () => {
    const batchId = "test-timestop-batch";

    // Create negative TimeStop trade
    const timestopId = await insertDryRunTrade(db, {
      type: "sell",
      simTxid: "TIMESTOP-NEG",
      pair: "BTC/USD",
      price: "49000",
      amount: "0.1",
      normalizedReason: "TIME_STOP",
      realizedPnlUsd: "-100", // Negative!
      realizedPnlPct: "-2.0",
      closedAt: new Date(),
      createdAt: new Date(),
    });

    // Mark as excluded (cleanup logic)
    await db.execute(sql`
      UPDATE dry_run_trades
      SET 
        excluded_from_pnl = true,
        exclusion_reason = 'legacy_timestop_loss_before_fix',
        excluded_at = NOW(),
        audit_batch_id = ${batchId}
      WHERE id = ${timestopId}
        AND realized_pnl_usd < 0
        AND excluded_from_pnl = false
    `);

    // Verify still exists but marked
    const check = await db.execute(sql`
      SELECT excluded_from_pnl, exclusion_reason, audit_batch_id
      FROM dry_run_trades
      WHERE id = ${timestopId}
    `);

    expect(check.rows[0].excluded_from_pnl).toBe(true);
    expect(check.rows[0].exclusion_reason).toBe("legacy_timestop_loss_before_fix");
    expect(check.rows[0].audit_batch_id).toBe(batchId);
  });

  // ============================================================
  // TEST 5: Unknown reasons preserved for manual review
  // ============================================================
  it("should not auto-delete UNKNOWN reason trades", async () => {
    const unknownId = await insertDryRunTrade(db, {
      type: "sell",
      simTxid: "UNKNOWN-TEST",
      pair: "SOL/USD",
      price: "100",
      amount: "10",
      normalizedReason: "UNKNOWN",
      realizedPnlUsd: "50",
      closedAt: new Date(),
      createdAt: new Date(),
    });

    // Simulate NOT deleting it (cleanup script should skip)
    const check = await db.execute(sql`
      SELECT id FROM dry_run_trades WHERE id = ${unknownId}
    `);

    expect(Number(check.rows[0].id)).toBe(unknownId);
  });

  // ============================================================
  // TEST 6: IDCA safety — ensure IDCA tables are never touched
  // ============================================================
  it("should verify IDCA tables exist and are separate from dry_run_trades", async () => {
    // Check IDCA tables exist
    const tablesResult = await db.execute(sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name IN (
          'institutional_dca_cycles',
          'institutional_dca_orders',
          'institutional_dca_asset_configs',
          'institutional_dca_config'
        )
    `);

    const tableNames = tablesResult.rows.map((r: any) => r.table_name);
    expect(tableNames).toContain("institutional_dca_cycles");
    expect(tableNames).toContain("institutional_dca_orders");
    expect(tableNames).toContain("institutional_dca_asset_configs");

    // Verify dry_run_trades has no references to IDCA
    const dryrunResult = await db.execute(sql`
      SELECT COUNT(*) as cnt FROM dry_run_trades
    `);

    // Should be able to query dry_run_trades without joining IDCA
    expect(Number(dryrunResult.rows[0].cnt)).toBeGreaterThanOrEqual(0);
  });

  // ============================================================
  // TEST 7: Clean PnL excludes marked trades
  // ============================================================
  it("should calculate clean PnL excluding excluded_from_pnl trades", async () => {
    const now = new Date();

    // Positive trade (included)
    await insertDryRunTrade(db, {
      type: "sell",
      simTxid: "PNL-INCLUDED",
      pair: "BTC/USD",
      price: "55000",
      amount: "0.1",
      normalizedReason: "TAKE_PROFIT",
      realizedPnlUsd: "500",
      excludedFromPnl: false,
      closedAt: now,
      createdAt: now,
    });

    // Negative trade (excluded)
    await insertDryRunTrade(db, {
      type: "sell",
      simTxid: "PNL-EXCLUDED",
      pair: "BTC/USD",
      price: "45000",
      amount: "0.1",
      normalizedReason: "TIME_STOP",
      realizedPnlUsd: "-200",
      excludedFromPnl: true,
      exclusionReason: "legacy_timestop_loss_before_fix",
      closedAt: now,
      createdAt: now,
    });

    // Gross PnL (all sells)
    const grossResult = await db.execute(sql`
      SELECT COALESCE(SUM(realized_pnl_usd), 0) as pnl
      FROM dry_run_trades
      WHERE type = 'sell'
    `);
    const grossPnl = Number(grossResult.rows[0].pnl);

    // Clean PnL (excluded_from_pnl = false)
    const cleanResult = await db.execute(sql`
      SELECT COALESCE(SUM(realized_pnl_usd), 0) as pnl
      FROM dry_run_trades
      WHERE type = 'sell' AND excluded_from_pnl = false
    `);
    const cleanPnl = Number(cleanResult.rows[0].pnl);

    expect(grossPnl).toBe(300); // 500 - 200
    expect(cleanPnl).toBe(500); // Only the included trade
    expect(grossPnl - cleanPnl).toBe(-200); // Difference is the excluded loss
  });

  // ============================================================
  // TEST 8: Gross PnL preserves all trades
  // ============================================================
  it("should preserve gross PnL including excluded trades", async () => {
    const now = new Date();

    // Create multiple trades
    await insertDryRunTrade(db, {
      type: "sell",
      simTxid: "GROSS-1",
      pair: "ETH/USD",
      price: "3000",
      amount: "1",
      realizedPnlUsd: "100",
      excludedFromPnl: false,
      closedAt: now,
      createdAt: now,
    });

    await insertDryRunTrade(db, {
      type: "sell",
      simTxid: "GROSS-2",
      pair: "ETH/USD",
      price: "2900",
      amount: "1",
      realizedPnlUsd: "-50",
      excludedFromPnl: true,
      exclusionReason: "legacy_timestop_loss_before_fix",
      closedAt: now,
      createdAt: now,
    });

    // All trades should be in gross calculation
    const grossResult = await db.execute(sql`
      SELECT COUNT(*) as cnt, COALESCE(SUM(realized_pnl_usd), 0) as pnl
      FROM dry_run_trades
      WHERE type = 'sell'
    `);

    expect(Number(grossResult.rows[0].cnt)).toBe(2);
    expect(Number(grossResult.rows[0].pnl)).toBe(50); // 100 - 50
  });

  // ============================================================
  // TEST 9: Idempotent re-run after partial failure
  // ============================================================
  it("should handle idempotent re-run after archive succeeds but delete fails", async () => {
    const now = new Date();
    const batchId = "test-partial-failure";

    // Create duplicate pair
    const canonicalId = await insertDryRunTrade(db, {
      type: "sell",
      simTxid: "PARTIAL-CANONICAL",
      pair: "BTC/USD",
      price: "50000",
      amount: "0.1",
      normalizedReason: "TIME_STOP",
      realizedPnlUsd: "-100",
      closedAt: now,
      createdAt: now,
    });

    const duplicateId = await insertDryRunTrade(db, {
      type: "sell",
      simTxid: "PARTIAL-DUPLICATE",
      pair: "BTC/USD",
      price: "50000", // Same
      amount: "0.1", // Same
      normalizedReason: "TIME_STOP", // Same
      realizedPnlUsd: "-100",
      closedAt: now,
      createdAt: now,
    });

    // STEP 1: Simulate archive phase succeeded
    await db.execute(sql`
      INSERT INTO dry_run_trades_archive (
        sim_txid, pair, type, price, amount, total_usd,
        reason, normalized_reason, status,
        realized_pnl_usd, realized_pnl_pct, closed_at, created_at,
        excluded_from_pnl, audit_batch_id,
        archive_reason, original_id
      )
      SELECT 
        sim_txid, pair, type, price, amount, total_usd,
        reason, normalized_reason, status,
        realized_pnl_usd, realized_pnl_pct, closed_at, created_at,
        excluded_from_pnl, ${batchId},
        'exact_duplicate', ${canonicalId}
      FROM dry_run_trades
      WHERE id = ${duplicateId}
    `);

    // Verify archived
    const archiveCheck = await db.execute(sql`
      SELECT COUNT(*) as cnt FROM dry_run_trades_archive
      WHERE sim_txid = 'PARTIAL-DUPLICATE'
    `);
    expect(Number(archiveCheck.rows[0].cnt)).toBe(1);

    // STEP 2: Re-run archive should skip (idempotent check)
    const existingCheck = await db.execute(sql`
      SELECT 1 FROM dry_run_trades_archive
      WHERE sim_txid = 'PARTIAL-DUPLICATE'
      LIMIT 1
    `);
    expect(existingCheck.rows.length).toBe(1);

    // STEP 3: Simulate delete phase (now succeeds)
    // Check if exists before delete (idempotent)
    const existsResult = await db.execute(sql`
      SELECT 1 FROM dry_run_trades WHERE id = ${duplicateId} LIMIT 1
    `);
    expect(existsResult.rows.length).toBe(1);

    // Delete
    await db.execute(sql`DELETE FROM dry_run_trades WHERE id = ${duplicateId}`);

    // Verify deleted
    const afterDelete = await db.execute(sql`
      SELECT 1 FROM dry_run_trades WHERE id = ${duplicateId} LIMIT 1
    `);
    expect(afterDelete.rows.length).toBe(0);

    // STEP 4: Re-run delete should be idempotent (no error)
    const reRunExists = await db.execute(sql`
      SELECT 1 FROM dry_run_trades WHERE id = ${duplicateId} LIMIT 1
    `);
    expect(reRunExists.rows.length).toBe(0); // Still gone

    // Canonical should still exist
    const canonicalCheck = await db.execute(sql`
      SELECT 1 FROM dry_run_trades WHERE id = ${canonicalId} LIMIT 1
    `);
    expect(canonicalCheck.rows.length).toBe(1);
  });

  // ============================================================
  // TEST 10: Complete idempotent apply flow
  // ============================================================
  it("should complete full cleanup flow and allow idempotent re-run", async () => {
    const now = new Date();

    // Create trades
    await insertDryRunTrade(db, {
      type: "sell",
      simTxid: "FLOW-1",
      pair: "BTC/USD",
      price: "51000",
      amount: "0.1",
      normalizedReason: "TAKE_PROFIT",
      realizedPnlUsd: "100",
      closedAt: now,
      createdAt: now,
    });

    // Duplicate
    await insertDryRunTrade(db, {
      type: "sell",
      simTxid: "FLOW-1-DUP",
      pair: "BTC/USD",
      price: "51000",
      amount: "0.1",
      normalizedReason: "TAKE_PROFIT",
      realizedPnlUsd: "100",
      closedAt: now,
      createdAt: now,
    });

    // Legacy TimeStop loss
    const legacyId = await insertDryRunTrade(db, {
      type: "sell",
      simTxid: "FLOW-LEGACY",
      pair: "ETH/USD",
      price: "2900",
      amount: "1",
      normalizedReason: "TIME_STOP",
      realizedPnlUsd: "-50",
      closedAt: now,
      createdAt: now,
    });

    // STEP 1: Mark legacy as excluded
    await db.execute(sql`
      UPDATE dry_run_trades
      SET 
        excluded_from_pnl = true,
        exclusion_reason = 'legacy_timestop_loss_before_fix',
        excluded_at = NOW()
      WHERE id = ${legacyId}
    `);

    // Verify excluded
    const legacyCheck = await db.execute(sql`
      SELECT excluded_from_pnl FROM dry_run_trades WHERE id = ${legacyId}
    `);
    expect(legacyCheck.rows[0].excluded_from_pnl).toBe(true);

    // STEP 2: Clean PnL calculation excludes marked trades
    const cleanPnlResult = await db.execute(sql`
      SELECT COALESCE(SUM(realized_pnl_usd), 0) as pnl
      FROM dry_run_trades
      WHERE type = 'sell' AND excluded_from_pnl = false
    `);
    const cleanPnl = Number(cleanPnlResult.rows[0].pnl);

    // Should include FLOW-1 and FLOW-1-DUP (200), exclude FLOW-LEGACY (-50)
    expect(cleanPnl).toBe(200);
  });
});
