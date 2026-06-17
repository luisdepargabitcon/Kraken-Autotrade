#!/usr/bin/env ts-node
/**
 * SPOT DRY RUN Cleanup Script
 *
 * Purpose: Clean up the SPOT bot's DRY RUN simulation history.
 * - Does NOT touch IDCA (institutional_dca_* tables)
 * - Does NOT touch real trades, FISCO, balances, or exchange operations
 * - Only operates on dry_run_trades table
 *
 * Modes:
 *   --audit   : Preview what would be done (dry run of the cleanup)
 *   --apply   : Execute the cleanup with backups
 *
 * Usage:
 *   npm run spot-dryrun:cleanup:audit  -> npx ts-node script/spot-dryrun-cleanup.ts --audit
 *   npm run spot-dryrun:cleanup:apply  -> npx ts-node script/spot-dryrun-cleanup.ts --apply
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { sql, and, eq, inArray, isNull, desc, gt, lt } from "drizzle-orm";
import { dryRunTrades, dryRunTradesArchive } from "../shared/schema";
import { randomUUID } from "crypto";

// ============================================================
// CONFIGURATION
// ============================================================

const DATABASE_URL = process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/trading_bot";

// Criteria for detecting exact duplicates
// Match: type, pair, price, amount, normalized_reason, created_at within same minute
const DUPLICATE_WINDOW_MINUTES = 1;

// Legacy TimeStop negative PnL threshold (for exclusion marking)
const LEGACY_TIMESTOP_REASONS = ["TIME_STOP", "TIMESTOP"];
const LEGACY_NEGATIVE_PNL_THRESHOLD_USD = 0; // Mark any negative PnL TimeStop as legacy

// ============================================================
// DATABASE SETUP
// ============================================================

const pool = new Pool({ connectionString: DATABASE_URL });
const db = drizzle(pool);

// ============================================================
// TYPES
// ============================================================

interface AuditSummary {
  totalOperations: number;
  totalBuy: number;
  totalSell: number;
  grossPnlUsd: number;
  pnlByPair: Record<string, number>;
  pnlByReason: Record<string, number>;
  duplicateCandidates: DuplicateCandidate[];
  legacyTimestopLossCount: number;
  legacyTimestopLossPnl: number;
  unknownCount: number;
  unknownSample: UnknownSample[];
}

interface DuplicateCandidate {
  id: number;
  simTxid: string;
  pair: string;
  type: string;
  price: string;
  amount: string;
  normalizedReason: string | null;
  createdAt: Date;
  canonicalId: number; // The ID of the row that would be kept
  matchKey: string; // Composite key for grouping
}

interface UnknownSample {
  id: number;
  pair: string;
  reason: string | null;
  normalizedReason: string | null;
  realizedPnlUsd: string | null;
  realizedPnlPct: string | null;
  createdAt: Date;
}

interface CleanupResult {
  batchId: string;
  backupTableName: string;
  archivedCount: number;
  archivedIds: number[];
  excludedCount: number;
  excludedIds: number[];
  grossPnlBefore: number;
  cleanPnlAfter: number;
}

// ============================================================
// PHASE 1: BACKUP
// ============================================================

async function createBackup(batchId: string): Promise<string> {
  const dateStr = new Date().toISOString().split("T")[0].replace(/-/g, "");
  const backupTableName = `dry_run_trades_backup_${dateStr}_${batchId.substring(0, 8)}`;

  console.log(`[cleanup] Creating backup table: ${backupTableName}`);

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS "${backupTableName}" AS
    SELECT * FROM dry_run_trades;
  `));

  console.log(`[cleanup] Backup created: ${backupTableName}`);
  return backupTableName;
}

// ============================================================
// PHASE 2: DETECT DUPLICATES
// ============================================================

async function detectExactDuplicates(): Promise<DuplicateCandidate[]> {
  console.log("[cleanup] Detecting exact duplicates...");

  // Find groups of trades that match on key fields within time window
  const query = sql`
    WITH duplicate_groups AS (
      SELECT 
        id,
        type,
        pair,
        price::text,
        amount::text,
        COALESCE(normalized_reason, reason, 'UNKNOWN') as match_reason,
        DATE_TRUNC('minute', created_at) as time_bucket,
        -- Create a composite match key
        CONCAT(
          type, '|', 
          pair, '|', 
          price::text, '|', 
          amount::text, '|',
          COALESCE(normalized_reason, reason, 'UNKNOWN'), '|',
          DATE_TRUNC('minute', created_at)::text
        ) as match_key,
        -- Row number to identify canonical (first) vs duplicates
        ROW_NUMBER() OVER (
          PARTITION BY 
            type, pair, price, amount, 
            COALESCE(normalized_reason, reason, 'UNKNOWN'),
            DATE_TRUNC('minute', created_at)
          ORDER BY id ASC
        ) as rn
      FROM dry_run_trades
      WHERE type = 'sell'  -- Only dedupe sells (buys have unique sim_txid)
    )
    SELECT 
      id,
      type,
      pair,
      price,
      amount,
      match_reason as normalized_reason,
      time_bucket as created_at,
      match_key,
      rn
    FROM duplicate_groups
    WHERE rn > 1
    ORDER BY match_key, rn;
  `;

  const result = await db.execute(query);

  const duplicates: DuplicateCandidate[] = result.rows.map((row: any) => ({
    id: Number(row.id),
    simTxid: String(row.sim_txid || "unknown"),
    pair: String(row.pair),
    type: String(row.type),
    price: String(row.price),
    amount: String(row.amount),
    normalizedReason: row.normalized_reason ? String(row.normalized_reason) : null,
    createdAt: new Date(row.created_at as string | number),
    canonicalId: -1, // Will be determined later
    matchKey: String(row.match_key),
  }));

  // Find canonical IDs for each duplicate
  if (duplicates.length > 0) {
    const matchKeys = [...new Set(duplicates.map((d) => d.matchKey))];

    for (const matchKey of matchKeys) {
      const canonicalResult = await db.execute(sql`
        SELECT id FROM dry_run_trades
        WHERE CONCAT(
          type, '|', 
          pair, '|', 
          price::text, '|', 
          amount::text, '|',
          COALESCE(normalized_reason, reason, 'UNKNOWN'), '|',
          DATE_TRUNC('minute', created_at)::text
        ) = ${matchKey}
        ORDER BY id ASC
        LIMIT 1
      `);

      const canonicalId = Number((canonicalResult.rows[0] as any)?.id);
      duplicates
        .filter((d) => d.matchKey === matchKey)
        .forEach((d) => (d.canonicalId = canonicalId));
    }
  }

  console.log(`[cleanup] Found ${duplicates.length} exact duplicate(s)`);
  return duplicates;
}

// ============================================================
// PHASE 3: DETECT LEGACY TIMESTOP LOSSES
// ============================================================

async function detectLegacyTimestopLosses(): Promise<{ count: number; totalPnl: number }> {
  console.log("[cleanup] Detecting legacy TimeStop losses...");

  const result = await db.execute(sql`
    SELECT 
      COUNT(*) as count,
      COALESCE(SUM(realized_pnl_usd), 0) as total_pnl
    FROM dry_run_trades
    WHERE type = 'sell'
      AND (
        normalized_reason ILIKE '%TIME_STOP%'
        OR normalized_reason ILIKE '%TIMESTOP%'
        OR reason ILIKE '%TimeStop%'
        OR reason ILIKE '%time_stop%'
        OR reason ILIKE '%expirado%'
      )
      AND realized_pnl_usd < 0
      AND excluded_from_pnl = false
  `);

  const count = parseInt(String(result.rows[0]?.count) || "0", 10);
  const totalPnl = parseFloat(String(result.rows[0]?.total_pnl) || "0");

  console.log(`[cleanup] Found ${count} legacy TimeStop loss(es) with total PnL: $${totalPnl.toFixed(2)}`);
  return { count, totalPnl };
}

// ============================================================
// PHASE 4: DETECT UNKNOWN REASONS
// ============================================================

async function detectUnknownReasons(): Promise<{ count: number; samples: UnknownSample[] }> {
  console.log("[cleanup] Detecting UNKNOWN reasons...");

  const countResult = await db.execute(sql`
    SELECT COUNT(*) as count
    FROM dry_run_trades
    WHERE type = 'sell'
      AND (normalized_reason IS NULL OR normalized_reason = 'UNKNOWN')
  `);

  const count = parseInt(String(countResult.rows[0]?.count) || "0", 10);

  // Get sample of unknowns for review
  const sampleResult = await db.execute(sql`
    SELECT 
      id,
      pair,
      reason,
      normalized_reason,
      realized_pnl_usd::text,
      realized_pnl_pct::text,
      created_at
    FROM dry_run_trades
    WHERE type = 'sell'
      AND (normalized_reason IS NULL OR normalized_reason = 'UNKNOWN')
    ORDER BY created_at DESC
    LIMIT 10
  `);

  const samples: UnknownSample[] = sampleResult.rows.map((row: any) => ({
    id: Number(row.id),
    pair: String(row.pair),
    reason: row.reason ? String(row.reason) : null,
    normalizedReason: row.normalized_reason ? String(row.normalized_reason) : null,
    realizedPnlUsd: row.realized_pnl_usd ? String(row.realized_pnl_usd) : null,
    realizedPnlPct: row.realized_pnl_pct ? String(row.realized_pnl_pct) : null,
    createdAt: new Date(row.created_at as string | number),
  }));

  console.log(`[cleanup] Found ${count} UNKNOWN reason(s), sampled ${samples.length}`);
  return { count, samples };
}

// ============================================================
// PHASE 5: CALCULATE PNL SUMMARIES
// ============================================================

async function calculatePnlSummary(): Promise<{
  grossPnl: number;
  pnlByPair: Record<string, number>;
  pnlByReason: Record<string, number>;
}> {
  console.log("[cleanup] Calculating PnL summaries...");

  // Total gross PnL (including all sells, even those marked excluded)
  const totalResult = await db.execute(sql`
    SELECT COALESCE(SUM(realized_pnl_usd), 0) as total
    FROM dry_run_trades
    WHERE type = 'sell'
  `);
  const grossPnl = parseFloat(String(totalResult.rows[0]?.total) || "0");

  // PnL by pair
  const byPairResult = await db.execute(sql`
    SELECT 
      pair,
      COALESCE(SUM(realized_pnl_usd), 0) as pnl
    FROM dry_run_trades
    WHERE type = 'sell'
    GROUP BY pair
    ORDER BY pnl DESC
  `);

  const pnlByPair: Record<string, number> = {};
  for (const row of byPairResult.rows) {
    pnlByPair[String(row.pair)] = parseFloat(String(row.pnl) || "0");
  }

  // PnL by normalized_reason
  const byReasonResult = await db.execute(sql`
    SELECT 
      COALESCE(normalized_reason, 'UNKNOWN') as reason,
      COALESCE(SUM(realized_pnl_usd), 0) as pnl
    FROM dry_run_trades
    WHERE type = 'sell'
    GROUP BY normalized_reason
    ORDER BY pnl DESC
  `);

  const pnlByReason: Record<string, number> = {};
  for (const row of byReasonResult.rows) {
    pnlByReason[String(row.reason)] = parseFloat(String(row.pnl) || "0");
  }

  return { grossPnl, pnlByPair, pnlByReason };
}

// ============================================================
// PHASE 6: ARCHIVE DUPLICATES
// ============================================================

async function archiveDuplicates(
  duplicates: DuplicateCandidate[],
  batchId: string
): Promise<{ archivedCount: number; archivedIds: number[] }> {
  console.log(`[cleanup] Archiving ${duplicates.length} duplicate(s)...`);

  const archivedIds: number[] = [];

  for (const dup of duplicates) {
    // Check if already archived (idempotency)
    const existingCheck = await db.execute(sql`
      SELECT 1 FROM dry_run_trades_archive
      WHERE sim_txid = (
        SELECT sim_txid FROM dry_run_trades WHERE id = ${dup.id}
      )
      LIMIT 1
    `);

    if (existingCheck.rows.length > 0) {
      console.log(`[cleanup] Duplicate ID ${dup.id} already archived, skipping`);
      archivedIds.push(dup.id);
      continue;
    }

    // Insert into archive
    await db.execute(sql`
      INSERT INTO dry_run_trades_archive (
        sim_txid, pair, type, price, amount, total_usd,
        reason, normalized_reason, status, entry_sim_txid, entry_price,
        realized_pnl_usd, realized_pnl_pct, closed_at,
        strategy_id, regime, confidence, created_at,
        excluded_from_pnl, exclusion_reason, excluded_at, audit_batch_id,
        archive_reason, original_id
      )
      SELECT 
        sim_txid, pair, type, price, amount, total_usd,
        reason, normalized_reason, status, entry_sim_txid, entry_price,
        realized_pnl_usd, realized_pnl_pct, closed_at,
        strategy_id, regime, confidence, created_at,
        excluded_from_pnl, exclusion_reason, excluded_at, ${batchId},
        'exact_duplicate', ${dup.canonicalId}
      FROM dry_run_trades
      WHERE id = ${dup.id}
    `);

    archivedIds.push(dup.id);
  }

  console.log(`[cleanup] Archived ${archivedIds.length} duplicate(s)`);
  return { archivedCount: archivedIds.length, archivedIds };
}

// ============================================================
// PHASE 7: DELETE DUPLICATES FROM MAIN TABLE
// ============================================================

async function deleteDuplicates(duplicateIds: number[]): Promise<{ deletedCount: number; alreadyGoneCount: number }> {
  console.log(`[cleanup] Deleting ${duplicateIds.length} duplicate(s) from dry_run_trades...`);

  if (duplicateIds.length === 0) return { deletedCount: 0, alreadyGoneCount: 0 };

  let deletedCount = 0;
  let alreadyGoneCount = 0;

  // Delete one by one for idempotency and safety
  for (const id of duplicateIds) {
    // Check if still exists (idempotency for re-runs)
    const existsResult = await db.execute(sql`
      SELECT 1 FROM dry_run_trades WHERE id = ${id} LIMIT 1
    `);

    if (existsResult.rows.length === 0) {
      alreadyGoneCount++;
      continue;
    }

    // Delete single row
    const deleteResult = await db.execute(sql`
      DELETE FROM dry_run_trades WHERE id = ${id}
    `);

    // pg returns rowCount in command tag
    deletedCount++;
  }

  if (alreadyGoneCount > 0) {
    console.log(`[cleanup] ${alreadyGoneCount} duplicate(s) already deleted (idempotent)`);
  }
  console.log(`[cleanup] Deleted ${deletedCount} duplicate(s)`);

  return { deletedCount, alreadyGoneCount };
}

// ============================================================
// PHASE 8: MARK LEGACY TIMESTOP LOSSES AS EXCLUDED
// ============================================================

async function excludeLegacyTimestopLosses(batchId: string): Promise<{ count: number; ids: number[] }> {
  console.log("[cleanup] Marking legacy TimeStop losses as excluded from PnL...");

  // First, get the IDs that will be affected
  const idResult = await db.execute(sql`
    SELECT id
    FROM dry_run_trades
    WHERE type = 'sell'
      AND (
        normalized_reason ILIKE '%TIME_STOP%'
        OR normalized_reason ILIKE '%TIMESTOP%'
        OR reason ILIKE '%TimeStop%'
        OR reason ILIKE '%time_stop%'
        OR reason ILIKE '%expirado%'
      )
      AND realized_pnl_usd < 0
      AND excluded_from_pnl = false
  `);

  const ids = idResult.rows.map((row: any) => Number(row.id));

  if (ids.length === 0) {
    console.log("[cleanup] No legacy TimeStop losses to exclude");
    return { count: 0, ids: [] };
  }

  // Update to mark as excluded
  await db.execute(sql`
    UPDATE dry_run_trades
    SET 
      excluded_from_pnl = true,
      exclusion_reason = 'legacy_timestop_loss_before_fix',
      excluded_at = NOW(),
      audit_batch_id = ${batchId}
    WHERE type = 'sell'
      AND (
        normalized_reason ILIKE '%TIME_STOP%'
        OR normalized_reason ILIKE '%TIMESTOP%'
        OR reason ILIKE '%TimeStop%'
        OR reason ILIKE '%time_stop%'
        OR reason ILIKE '%expirado%'
      )
      AND realized_pnl_usd < 0
      AND excluded_from_pnl = false
  `);

  console.log(`[cleanup] Marked ${ids.length} legacy TimeStop loss(es) as excluded`);
  return { count: ids.length, ids };
}

// ============================================================
// AUDIT MODE
// ============================================================

async function runAudit(): Promise<void> {
  console.log("\n========================================");
  console.log("SPOT DRY RUN CLEANUP — AUDIT MODE");
  console.log("========================================\n");

  // Summary stats
  const statsResult = await db.execute(sql`
    SELECT 
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE type = 'buy') as buys,
      COUNT(*) FILTER (WHERE type = 'sell') as sells
    FROM dry_run_trades
  `);

  const totalOps = parseInt(String(statsResult.rows[0]?.total) || "0", 10);
  const totalBuy = parseInt(String(statsResult.rows[0]?.buys) || "0", 10);
  const totalSell = parseInt(String(statsResult.rows[0]?.sells) || "0", 10);

  // Detect issues
  const duplicates = await detectExactDuplicates();
  const legacyTimestop = await detectLegacyTimestopLosses();
  const unknowns = await detectUnknownReasons();
  const pnlSummary = await calculatePnlSummary();

  // Calculate clean PnL (excluding legacy timestop losses)
  const cleanPnl = pnlSummary.grossPnl - legacyTimestop.totalPnl;

  // Output report
  console.log("\n========== AUDIT SUMMARY ==========\n");

  console.log("📊 OVERVIEW:");
  console.log(`  Total operations: ${totalOps}`);
  console.log(`  Total BUY: ${totalBuy}`);
  console.log(`  Total SELL: ${totalSell}`);
  console.log("");

  console.log("💰 PnL SUMMARY:");
  console.log(`  Gross PnL (all sells): $${pnlSummary.grossPnl.toFixed(2)}`);
  console.log(`  Legacy TimeStop losses: $${legacyTimestop.totalPnl.toFixed(2)} (${legacyTimestop.count} trades)`);
  console.log(`  Clean PnL (after exclusion): $${cleanPnl.toFixed(2)}`);
  console.log(`  Difference: $${(pnlSummary.grossPnl - cleanPnl).toFixed(2)}`);
  console.log("");

  console.log("🔍 DUPLICATES:");
  console.log(`  Exact duplicate candidates: ${duplicates.length}`);
  if (duplicates.length > 0) {
    console.log("  Sample duplicates (first 5):");
    duplicates.slice(0, 5).forEach((dup) => {
      console.log(`    - ID ${dup.id} (canonical: ${dup.canonicalId}): ${dup.pair} ${dup.type} @ $${dup.price} (${dup.normalizedReason})`);
    });
  }
  console.log("");

  console.log("⚠️  LEGACY TIMESTOP LOSSES:");
  console.log(`  Count: ${legacyTimestop.count}`);
  console.log(`  Total PnL impact: $${legacyTimestop.totalPnl.toFixed(2)}`);
  console.log(`  Action: Will be marked as excluded_from_pnl=true`);
  console.log("");

  console.log("❓ UNKNOWN REASONS:");
  console.log(`  Count: ${unknowns.count}`);
  console.log(`  Action: Will NOT be modified (review manually)`);
  if (unknowns.samples.length > 0) {
    console.log("  Sample UNKNOWN trades:");
    unknowns.samples.slice(0, 5).forEach((u) => {
      console.log(`    - ID ${u.id}: ${u.pair} | reason:"${u.reason?.substring(0, 40)}" | PnL:$${u.realizedPnlUsd}`);
    });
  }
  console.log("");

  console.log("📈 PnL BY PAIR (top 5):");
  Object.entries(pnlSummary.pnlByPair)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .forEach(([pair, pnl]) => {
      console.log(`  ${pair}: $${pnl.toFixed(2)}`);
    });
  console.log("");

  console.log("📈 PnL BY REASON:");
  Object.entries(pnlSummary.pnlByReason)
    .sort((a, b) => b[1] - a[1])
    .forEach(([reason, pnl]) => {
      console.log(`  ${reason}: $${pnl.toFixed(2)}`);
    });
  console.log("");

  console.log("========== END AUDIT ==========\n");

  console.log("To apply these changes, run:");
  console.log("  npm run spot-dryrun:cleanup:apply");
  console.log("");
}

// ============================================================
// APPLY MODE
// ============================================================

async function runApply(): Promise<void> {
  console.log("\n========================================");
  console.log("SPOT DRY RUN CLEANUP — APPLY MODE");
  console.log("========================================\n");

  // Confirm
  console.log("⚠️  WARNING: This will modify the dry_run_trades table.");
  console.log("   - A backup will be created first");
  console.log("   - Exact duplicates will be archived and deleted");
  console.log("   - Legacy TimeStop losses will be marked excluded_from_pnl");
  console.log("   - IDCA tables will NOT be touched");
  console.log("");

  // Generate batch ID
  const batchId = randomUUID();
  console.log(`[cleanup] Batch ID: ${batchId}`);

  // PHASE 1: Backup
  console.log("\n--- PHASE 1: BACKUP ---");
  const backupTableName = await createBackup(batchId);

  // Get pre-cleanup stats
  const preStats = await calculatePnlSummary();

  // PHASE 2: Detect
  console.log("\n--- PHASE 2: DETECT ---");
  const duplicates = await detectExactDuplicates();
  const legacyTimestop = await detectLegacyTimestopLosses();

  // PHASE 3: Archive duplicates
  console.log("\n--- PHASE 3: ARCHIVE DUPLICATES ---");
  let archivedCount = 0;
  let archivedIds: number[] = [];
  if (duplicates.length > 0) {
    const archiveResult = await archiveDuplicates(duplicates, batchId);
    archivedCount = archiveResult.archivedCount;
    archivedIds = archiveResult.archivedIds;
  } else {
    console.log("[cleanup] No duplicates to archive");
  }

  // PHASE 4: Delete duplicates
  console.log("\n--- PHASE 4: DELETE DUPLICATES ---");
  let deleteResult = { deletedCount: 0, alreadyGoneCount: 0 };
  if (archivedIds.length > 0) {
    deleteResult = await deleteDuplicates(archivedIds);
  } else {
    console.log("[cleanup] No duplicates to delete");
  }

  // PHASE 5: Exclude legacy TimeStop losses
  console.log("\n--- PHASE 5: EXCLUDE LEGACY TIMESTOP LOSSES ---");
  const excludeResult = await excludeLegacyTimestopLosses(batchId);

  // PHASE 6: Recalculate PnL
  console.log("\n--- PHASE 6: RECALCULATE PnL ---");
  const postStats = await calculatePnlSummary();

  // Calculate clean PnL (excluding marked trades)
  const cleanPnlResult = await db.execute(sql`
    SELECT COALESCE(SUM(realized_pnl_usd), 0) as clean_pnl
    FROM dry_run_trades
    WHERE type = 'sell'
      AND excluded_from_pnl = false
  `);
  const cleanPnl = parseFloat(String(cleanPnlResult.rows[0]?.clean_pnl) || "0");

  // Output result
  console.log("\n========== CLEANUP RESULT ==========\n");

  console.log("📋 BATCH INFO:");
  console.log(`  Batch ID: ${batchId}`);
  console.log(`  Backup table: ${backupTableName}`);
  console.log("");

  console.log("📊 DUPLICATES:");
  console.log(`  Detected: ${duplicates.length}`);
  console.log(`  Archived: ${archivedCount}`);
  console.log(`  Deleted: ${deleteResult.deletedCount}`);
  if (deleteResult.alreadyGoneCount > 0) {
    console.log(`  Already deleted (idempotent): ${deleteResult.alreadyGoneCount}`);
  }
  console.log("");

  console.log("⚠️  LEGACY TIMESTOP:");
  console.log(`  Excluded from PnL: ${excludeResult.count}`);
  console.log("");

  console.log("💰 PnL IMPACT:");
  console.log(`  Gross PnL (before): $${preStats.grossPnl.toFixed(2)}`);
  console.log(`  Gross PnL (after): $${postStats.grossPnl.toFixed(2)}`);
  console.log(`  Clean PnL (excluded removed): $${cleanPnl.toFixed(2)}`);
  console.log(`  PnL difference (archived): $${(preStats.grossPnl - postStats.grossPnl).toFixed(2)}`);
  console.log("");

  console.log("✅ IDCA VERIFICATION:");
  const idcaCheck = await db.execute(sql`SELECT COUNT(*) as count FROM institutional_dca_cycles LIMIT 1`);
  console.log(`  institutional_dca_cycles: ${idcaCheck.rows[0]?.count || 0} rows (untouched)`);
  console.log("");

  console.log("========== CLEANUP COMPLETE ==========\n");

  console.log("To restore from backup if needed:");
  console.log(`  DROP TABLE dry_run_trades;`);
  console.log(`  CREATE TABLE dry_run_trades AS SELECT * FROM ${backupTableName};`);
  console.log("");
}

// ============================================================
// MAIN
// ============================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const isAudit = args.includes("--audit");
  const isApply = args.includes("--apply");

  if (!isAudit && !isApply) {
    console.log("Usage:");
    console.log("  npx ts-node script/spot-dryrun-cleanup.ts --audit   # Preview changes");
    console.log("  npx ts-node script/spot-dryrun-cleanup.ts --apply   # Execute cleanup");
    process.exit(1);
  }

  try {
    if (isAudit) {
      await runAudit();
    } else {
      await runApply();
    }
  } catch (error) {
    console.error("[cleanup] Error:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
