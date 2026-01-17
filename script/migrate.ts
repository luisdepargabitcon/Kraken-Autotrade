#!/usr/bin/env npx tsx
/**
 * Non-interactive database migration script for Docker/NAS deployment.
 * This script runs before the app starts to ensure schema is up-to-date.
 * 
 * Usage: npx tsx script/migrate.ts
 * 
 * Features:
 * - No interactive prompts (unlike drizzle-kit push)
 * - Safe ADD COLUMN IF NOT EXISTS
 * - Backfills lot_id for existing positions
 * - Adds unique constraint only if safe
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import pg from "pg";

const { Pool } = pg;

async function runMigration() {
  console.log("[migrate] Starting non-interactive database migration...");
  
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("[migrate] ERROR: DATABASE_URL not set");
    process.exit(1);
  }
  
  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool);
  
  try {
    // telegram_chats table (multi-chat support)
    console.log("[migrate] Ensuring telegram_chats table exists...");
    try {
      await db.execute(sql.raw(`
        CREATE TABLE IF NOT EXISTS telegram_chats (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          chat_id TEXT NOT NULL,
          is_default BOOLEAN NOT NULL DEFAULT false,
          alert_trades BOOLEAN NOT NULL DEFAULT true,
          alert_errors BOOLEAN NOT NULL DEFAULT true,
          alert_system BOOLEAN NOT NULL DEFAULT true,
          alert_balance BOOLEAN NOT NULL DEFAULT false,
          alert_heartbeat BOOLEAN NOT NULL DEFAULT true,
          alert_preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
          is_active BOOLEAN NOT NULL DEFAULT true,
          created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
          updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now()
        );
      `));
    } catch (e) {
      console.log("[migrate] telegram_chats table note:", e);
    }

    // Ensure expected telegram_chats columns exist (for older DBs created before these columns)
    console.log("[migrate] Ensuring telegram_chats columns exist...");
    const telegramChatsMigrations = [
      "ALTER TABLE telegram_chats ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false",
      "ALTER TABLE telegram_chats ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now()",
    ];
    for (const migration of telegramChatsMigrations) {
      try {
        await db.execute(sql.raw(migration));
      } catch (e) {
        // Ignore errors
      }
    }

    // bot_config columns
    const botConfigMigrations = [
      'ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS sg_max_open_lots_per_pair INTEGER DEFAULT 1',
      'ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS sg_pair_overrides JSONB',
      'ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS dry_run_mode BOOLEAN DEFAULT false',
      'ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS sg_min_entry_usd DECIMAL(10,2) DEFAULT 100.00',
      'ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS sg_allow_under_min BOOLEAN DEFAULT true',
      'ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS sg_be_at_pct DECIMAL(5,2) DEFAULT 1.50',
      'ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS sg_trail_start_pct DECIMAL(5,2) DEFAULT 2.00',
      'ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS sg_trail_distance_pct DECIMAL(5,2) DEFAULT 1.50',
      'ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS sg_trail_step_pct DECIMAL(5,2) DEFAULT 0.25',
      'ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS sg_tp_fixed_enabled BOOLEAN DEFAULT false',
      'ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS sg_tp_fixed_pct DECIMAL(5,2) DEFAULT 10.00',
      'ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS sg_scale_out_enabled BOOLEAN DEFAULT false',
      'ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS sg_scale_out_pct DECIMAL(5,2) DEFAULT 35.00',
      'ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS sg_min_part_usd DECIMAL(10,2) DEFAULT 50.00',
      'ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS sg_scale_out_threshold DECIMAL(5,2) DEFAULT 80.00',
      'ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS sg_fee_cushion_pct DECIMAL(5,2) DEFAULT 0.45',
      'ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS sg_fee_cushion_auto BOOLEAN DEFAULT true',
    ];
    
    // open_positions columns
    const openPositionsMigrations = [
      'ALTER TABLE open_positions ADD COLUMN IF NOT EXISTS lot_id TEXT',
      'ALTER TABLE open_positions ADD COLUMN IF NOT EXISTS sg_break_even_activated BOOLEAN DEFAULT false',
      'ALTER TABLE open_positions ADD COLUMN IF NOT EXISTS sg_trailing_activated BOOLEAN DEFAULT false',
      'ALTER TABLE open_positions ADD COLUMN IF NOT EXISTS sg_current_stop_price DECIMAL(18,8)',
      'ALTER TABLE open_positions ADD COLUMN IF NOT EXISTS sg_scale_out_done BOOLEAN DEFAULT false',
      'ALTER TABLE open_positions ADD COLUMN IF NOT EXISTS config_snapshot_json JSONB',
    ];
    
    console.log("[migrate] Applying bot_config migrations...");
    for (const migration of botConfigMigrations) {
      try {
        await db.execute(sql.raw(migration));
      } catch (e) {
        // Ignore errors (column may already exist)
      }
    }
    
    console.log("[migrate] Applying open_positions migrations...");
    for (const migration of openPositionsMigrations) {
      try {
        await db.execute(sql.raw(migration));
      } catch (e) {
        // Ignore errors
      }
    }

    // training_trades: add unique constraint on buy_txid if safe
    console.log("[migrate] Checking training_trades.buy_txid uniqueness...");
    try {
      const constraintExists = await db.execute(sql`
        SELECT constraint_name FROM information_schema.table_constraints
        WHERE table_name = 'training_trades' AND constraint_type = 'UNIQUE'
          AND constraint_name IN ('training_trades_buy_txid_unique', 'training_trades_buy_txid_key')
      `);

      if (constraintExists.rows.length === 0) {
        const duplicates = await db.execute(sql`
          SELECT buy_txid, COUNT(*)::int AS cnt
          FROM training_trades
          WHERE buy_txid IS NOT NULL
          GROUP BY buy_txid
          HAVING COUNT(*) > 1
          LIMIT 1
        `);

        if (duplicates.rows.length === 0) {
          console.log("[migrate] Adding unique constraint on training_trades.buy_txid...");
          await db.execute(sql`
            ALTER TABLE training_trades
            ADD CONSTRAINT training_trades_buy_txid_unique UNIQUE (buy_txid)
          `);
        } else {
          console.log("[migrate] WARNING: Duplicate buy_txid found, skipping unique constraint");
        }
      } else {
        console.log("[migrate] training_trades buy_txid unique constraint already exists");
      }
    } catch (e) {
      console.log("[migrate] training_trades constraint note:", e);
    }
    
    // Backfill lot_id for existing positions
    console.log("[migrate] Backfilling lot_id for existing positions...");
    try {
      await db.execute(sql`
        UPDATE open_positions 
        SET lot_id = 'LEGACY-' || id::text || '-' || SUBSTRING(MD5(pair || opened_at::text) FROM 1 FOR 6)
        WHERE lot_id IS NULL
      `);
    } catch (e) {
      console.log("[migrate] lot_id backfill note:", e);
    }
    
    // Add unique constraint if safe
    console.log("[migrate] Checking lot_id uniqueness...");
    try {
      const duplicates = await db.execute(sql`
        SELECT lot_id, COUNT(*) FROM open_positions 
        WHERE lot_id IS NOT NULL 
        GROUP BY lot_id 
        HAVING COUNT(*) > 1
      `);
      
      if (duplicates.rows.length === 0) {
        // Check if constraint already exists
        const constraintExists = await db.execute(sql`
          SELECT constraint_name FROM information_schema.table_constraints 
          WHERE table_name = 'open_positions' AND constraint_name = 'open_positions_lot_id_unique'
        `);
        
        if (constraintExists.rows.length === 0) {
          console.log("[migrate] Adding unique constraint on lot_id...");
          await db.execute(sql`
            ALTER TABLE open_positions ADD CONSTRAINT open_positions_lot_id_unique UNIQUE (lot_id)
          `);
        } else {
          console.log("[migrate] lot_id unique constraint already exists");
        }
      } else {
        console.log("[migrate] WARNING: Duplicate lot_ids found, skipping unique constraint");
      }
    } catch (e) {
      console.log("[migrate] Constraint note:", e);
    }
    
    console.log("[migrate] Migration completed successfully!");
    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error("[migrate] Migration failed:", error);
    await pool.end();
    process.exit(1);
  }
}

runMigration();
