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
import fs from "fs";
import path from "path";

const { Pool } = pg;

async function tryExecute(db: any, statement: string, label: string): Promise<void> {
  try {
    await db.execute(sql.raw(statement));
  } catch (e) {
    console.log(`[migrate] ${label} note:`, e);
  }
}

async function tryExecuteFile(db: any, filePath: string, label: string): Promise<void> {
  try {
    if (!fs.existsSync(filePath)) {
      console.log(`[migrate] ${label} skipped (file not found): ${filePath}`);
      return;
    }
    const content = fs.readFileSync(filePath, "utf-8");
    if (!content.trim()) {
      console.log(`[migrate] ${label} skipped (empty file): ${filePath}`);
      return;
    }
    await db.execute(sql.raw(content));
    console.log(`[migrate] ${label} applied: ${path.basename(filePath)}`);
  } catch (e) {
    console.log(`[migrate] ${label} note:`, e);
  }
}

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
    // Trading configuration tables + presets (Trade Configuration dashboard)
    console.log("[migrate] Ensuring trading configuration tables and presets exist...");
    const configSqlPath = path.resolve(process.cwd(), "db", "migrations", "001_create_config_tables.sql");
    await tryExecuteFile(db, configSqlPath, "trading_config/config_preset/config_change");

    // api_config table (credentials)
    console.log("[migrate] Ensuring api_config table exists...");
    await tryExecute(
      db,
      `CREATE TABLE IF NOT EXISTS api_config (
        id SERIAL PRIMARY KEY,
        kraken_api_key TEXT,
        kraken_api_secret TEXT,
        kraken_connected BOOLEAN NOT NULL DEFAULT false,
        kraken_enabled BOOLEAN NOT NULL DEFAULT true,
        revolutx_api_key TEXT,
        revolutx_private_key TEXT,
        revolutx_connected BOOLEAN NOT NULL DEFAULT false,
        revolutx_enabled BOOLEAN NOT NULL DEFAULT false,
        trading_exchange TEXT NOT NULL DEFAULT 'kraken',
        data_exchange TEXT NOT NULL DEFAULT 'kraken',
        active_exchange TEXT NOT NULL DEFAULT 'kraken',
        telegram_token TEXT,
        telegram_chat_id TEXT,
        telegram_connected BOOLEAN NOT NULL DEFAULT false,
        updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now()
      );`,
      "api_config table"
    );

    // bot_config table (core bot settings)
    console.log("[migrate] Ensuring bot_config table exists...");
    await tryExecute(
      db,
      `CREATE TABLE IF NOT EXISTS bot_config (
        id SERIAL PRIMARY KEY,
        is_active BOOLEAN NOT NULL DEFAULT false,
        strategy TEXT NOT NULL DEFAULT 'momentum',
        updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now()
      );`,
      "bot_config table"
    );

    // bot_config extended columns (keep in sync with shared/schema.ts)
    console.log("[migrate] Ensuring bot_config extended columns exist...");
    const botConfigSqlPath = path.resolve(process.cwd(), "db", "migrations", "003_add_missing_bot_config_columns.sql");
    await tryExecuteFile(db, botConfigSqlPath, "bot_config columns");

    // open_positions table (positions)
    console.log("[migrate] Ensuring open_positions table exists...");
    await tryExecute(
      db,
      `CREATE TABLE IF NOT EXISTS open_positions (
        id SERIAL PRIMARY KEY,
        pair TEXT NOT NULL,
        opened_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
        updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now()
      );`,
      "open_positions table"
    );

    // Ensure open_positions timestamps exist even if table pre-existed (fix /api/open-positions 500)
    console.log("[migrate] Ensuring open_positions timestamp columns exist...");
    const openPositionsTimestampMigrations = [
      "ALTER TABLE open_positions ADD COLUMN IF NOT EXISTS opened_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now()",
      "ALTER TABLE open_positions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now()",
    ];
    for (const migration of openPositionsTimestampMigrations) {
      try {
        await db.execute(sql.raw(migration));
      } catch (e) {
        // Ignore errors
      }
    }

    // notifications table
    console.log("[migrate] Ensuring notifications table exists...");
    await tryExecute(
      db,
      `CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        type TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now()
      );`,
      "notifications table"
    );

    // market_data table
    console.log("[migrate] Ensuring market_data table exists...");
    await tryExecute(
      db,
      `CREATE TABLE IF NOT EXISTS market_data (
        id SERIAL PRIMARY KEY,
        pair TEXT NOT NULL,
        price DECIMAL(18,8) NOT NULL,
        timestamp TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now()
      );`,
      "market_data table"
    );

    // ai_config table (AI diagnostics/status)
    console.log("[migrate] Ensuring ai_config table exists...");
    await tryExecute(
      db,
      `CREATE TABLE IF NOT EXISTS ai_config (
        id SERIAL PRIMARY KEY,
        filter_enabled BOOLEAN DEFAULT false,
        shadow_enabled BOOLEAN DEFAULT false,
        model_path TEXT,
        model_version TEXT,
        last_train_ts TIMESTAMP WITHOUT TIME ZONE,
        last_backfill_ts TIMESTAMP WITHOUT TIME ZONE,
        last_backfill_error TEXT,
        last_backfill_discard_reasons_json JSONB,
        last_train_error TEXT,
        n_samples INTEGER DEFAULT 0,
        threshold DECIMAL(5,4) DEFAULT 0.60,
        metrics_json JSONB,
        updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now()
      );`,
      "ai_config table"
    );

    // regime_state table (regime router stabilization)
    console.log("[migrate] Ensuring regime_state table exists...");
    await tryExecute(
      db,
      `CREATE TABLE IF NOT EXISTS regime_state (
        pair TEXT PRIMARY KEY,
        current_regime TEXT NOT NULL DEFAULT 'TRANSITION',
        confirmed_at TIMESTAMP WITHOUT TIME ZONE,
        last_notified_at TIMESTAMP WITHOUT TIME ZONE,
        hold_until TIMESTAMP WITHOUT TIME ZONE,
        transition_since TIMESTAMP WITHOUT TIME ZONE,
        candidate_regime TEXT,
        candidate_count INTEGER NOT NULL DEFAULT 0,
        last_params_hash TEXT,
        last_reason_hash TEXT,
        last_adx DECIMAL(5,2),
        updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now()
      );`,
      "regime_state table"
    );

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

    // trades table + columns required by dashboard
    console.log("[migrate] Ensuring trades table exists...");
    await tryExecute(
      db,
      `CREATE TABLE IF NOT EXISTS trades (
        id SERIAL PRIMARY KEY,
        trade_id TEXT NOT NULL UNIQUE,
        pair TEXT NOT NULL,
        type TEXT NOT NULL,
        price TEXT NOT NULL,
        amount TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now()
      );`,
      "trades table"
    );

    console.log("[migrate] Ensuring trades columns exist...");
    const tradesMigrations = [
      "ALTER TABLE trades ADD COLUMN IF NOT EXISTS exchange TEXT DEFAULT 'kraken'",
      "ALTER TABLE trades ADD COLUMN IF NOT EXISTS kraken_order_id TEXT",
      "ALTER TABLE trades ADD COLUMN IF NOT EXISTS entry_price DECIMAL(18,8)",
      "ALTER TABLE trades ADD COLUMN IF NOT EXISTS realized_pnl_usd DECIMAL(18,8)",
      "ALTER TABLE trades ADD COLUMN IF NOT EXISTS realized_pnl_pct DECIMAL(10,4)",
      "ALTER TABLE trades ADD COLUMN IF NOT EXISTS executed_at TIMESTAMP WITHOUT TIME ZONE",
    ];
    for (const migration of tradesMigrations) {
      try {
        await db.execute(sql.raw(migration));
      } catch (e) {
        // Ignore errors
      }
    }

    // Backfill exchange for legacy rows
    try {
      await db.execute(sql`
        UPDATE trades
        SET exchange = CASE
          WHEN trade_id LIKE 'KRAKEN-%' THEN 'kraken'
          WHEN trade_id LIKE 'RX-%' THEN 'revolutx'
          WHEN trade_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN 'revolutx'
          ELSE 'kraken'
        END
        WHERE exchange IS NULL OR exchange = ''
      `);
    } catch (e) {
      // Ignore
    }

    // Correct legacy RevolutX trades that may have been fast-defaulted to 'kraken'
    // (Postgres can show default for existing rows after ADD COLUMN DEFAULT)
    try {
      await db.execute(sql`
        UPDATE trades
        SET exchange = 'revolutx'
        WHERE exchange <> 'revolutx'
          AND (
            trade_id LIKE 'RX-%'
            OR trade_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          )
      `);
    } catch (e) {
      // Ignore
    }

    console.log("[migrate] Ensuring notifications columns exist...");
    const notificationsMigrations = [
      "ALTER TABLE notifications ADD COLUMN IF NOT EXISTS telegram_sent BOOLEAN NOT NULL DEFAULT false",
      "ALTER TABLE notifications ADD COLUMN IF NOT EXISTS sent_at TIMESTAMP WITHOUT TIME ZONE",
    ];
    for (const migration of notificationsMigrations) {
      try {
        await db.execute(sql.raw(migration));
      } catch (e) {
        // Ignore errors
      }
    }

    // market_data table columns used by portfolio/prices
    console.log("[migrate] Ensuring market_data columns exist...");
    const marketDataMigrations = [
      "ALTER TABLE market_data ADD COLUMN IF NOT EXISTS volume_24h DECIMAL(18,2)",
      "ALTER TABLE market_data ADD COLUMN IF NOT EXISTS change_24h DECIMAL(10,2)",
    ];
    for (const migration of marketDataMigrations) {
      try {
        await db.execute(sql.raw(migration));
      } catch (e) {
        // Ignore errors
      }
    }

    // bot_events table (logs feed)
    console.log("[migrate] Ensuring bot_events table exists...");
    await tryExecute(
      db,
      `CREATE TABLE IF NOT EXISTS bot_events (
        id SERIAL PRIMARY KEY,
        timestamp TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
        level TEXT NOT NULL,
        type TEXT NOT NULL,
        message TEXT NOT NULL,
        meta TEXT
      );`,
      "bot_events table"
    );

    // trade_fills table
    console.log("[migrate] Ensuring trade_fills table exists...");
    await tryExecute(
      db,
      `CREATE TABLE IF NOT EXISTS trade_fills (
        id SERIAL PRIMARY KEY,
        txid TEXT NOT NULL UNIQUE,
        order_id TEXT NOT NULL,
        pair TEXT NOT NULL,
        type TEXT NOT NULL,
        price DECIMAL(18,8) NOT NULL,
        amount DECIMAL(18,8) NOT NULL,
        cost DECIMAL(18,8) NOT NULL,
        fee DECIMAL(18,8) NOT NULL,
        matched BOOLEAN NOT NULL DEFAULT false,
        executed_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
        created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now()
      );`,
      "trade_fills table"
    );

    // lot_matches table
    console.log("[migrate] Ensuring lot_matches table exists...");
    await tryExecute(
      db,
      `CREATE TABLE IF NOT EXISTS lot_matches (
        id SERIAL PRIMARY KEY,
        sell_fill_txid TEXT NOT NULL,
        lot_id TEXT NOT NULL,
        matched_qty DECIMAL(18,8) NOT NULL,
        buy_price DECIMAL(18,8) NOT NULL,
        sell_price DECIMAL(18,8) NOT NULL,
        buy_fee_allocated DECIMAL(18,8) NOT NULL,
        sell_fee_allocated DECIMAL(18,8) NOT NULL,
        pnl_net DECIMAL(18,8) NOT NULL,
        created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now()
      );`,
      "lot_matches table"
    );
    await tryExecute(
      db,
      `DO $$
       BEGIN
         IF NOT EXISTS (
           SELECT 1
           FROM information_schema.table_constraints
           WHERE table_name = 'lot_matches'
             AND constraint_type = 'UNIQUE'
             AND constraint_name = 'lot_matches_sell_lot_unique'
         ) THEN
           ALTER TABLE lot_matches
             ADD CONSTRAINT lot_matches_sell_lot_unique UNIQUE (sell_fill_txid, lot_id);
         END IF;
       END $$;`,
      "lot_matches unique constraint"
    );

    // training_trades table (used by backfills and telegram profits fallback)
    console.log("[migrate] Ensuring training_trades table exists...");
    await tryExecute(
      db,
      `CREATE TABLE IF NOT EXISTS training_trades (
        id SERIAL PRIMARY KEY,
        pair TEXT NOT NULL,
        strategy_id TEXT,
        buy_txid TEXT NOT NULL,
        sell_txid TEXT,
        sell_txids_json JSONB,
        entry_price DECIMAL(18,8) NOT NULL,
        exit_price DECIMAL(18,8),
        entry_amount DECIMAL(18,8) NOT NULL,
        exit_amount DECIMAL(18,8),
        qty_remaining DECIMAL(18,8),
        entry_fee DECIMAL(18,8) NOT NULL DEFAULT 0,
        exit_fee DECIMAL(18,8),
        cost_usd DECIMAL(18,8) NOT NULL,
        revenue_usd DECIMAL(18,8),
        pnl_gross DECIMAL(18,8),
        pnl_net DECIMAL(18,8),
        pnl_pct DECIMAL(10,4),
        hold_time_minutes INTEGER,
        label_win INTEGER,
        features_json JSONB,
        discard_reason TEXT,
        is_closed BOOLEAN NOT NULL DEFAULT false,
        is_labeled BOOLEAN NOT NULL DEFAULT false,
        entry_ts TIMESTAMP WITHOUT TIME ZONE NOT NULL,
        exit_ts TIMESTAMP WITHOUT TIME ZONE,
        created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now()
      );`,
      "training_trades table"
    );

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
      "ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS signal_timeframe TEXT DEFAULT 'cycle'",
      "ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS risk_level TEXT DEFAULT 'medium'",
      "ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS active_pairs TEXT[] DEFAULT ARRAY['BTC/USD','ETH/USD','SOL/USD']",
      'ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS error_alert_chat_id TEXT',
    ];
    
    // open_positions columns
    const openPositionsMigrations = [
      'ALTER TABLE open_positions ADD COLUMN IF NOT EXISTS lot_id TEXT',
      'ALTER TABLE open_positions ADD COLUMN IF NOT EXISTS entry_price DECIMAL(18,8)',
      'ALTER TABLE open_positions ADD COLUMN IF NOT EXISTS amount DECIMAL(18,8)',
      'ALTER TABLE open_positions ADD COLUMN IF NOT EXISTS qty_remaining DECIMAL(18,8)',
      'ALTER TABLE open_positions ADD COLUMN IF NOT EXISTS qty_filled DECIMAL(18,8) DEFAULT 0',
      'ALTER TABLE open_positions ADD COLUMN IF NOT EXISTS highest_price DECIMAL(18,8)',
      'ALTER TABLE open_positions ADD COLUMN IF NOT EXISTS trade_id TEXT',
      'ALTER TABLE open_positions ADD COLUMN IF NOT EXISTS kraken_order_id TEXT',
      "ALTER TABLE open_positions ADD COLUMN IF NOT EXISTS entry_strategy_id TEXT DEFAULT 'momentum_cycle'",
      "ALTER TABLE open_positions ADD COLUMN IF NOT EXISTS entry_signal_tf TEXT DEFAULT 'cycle'",
      'ALTER TABLE open_positions ADD COLUMN IF NOT EXISTS signal_confidence DECIMAL(5,2)',
      'ALTER TABLE open_positions ADD COLUMN IF NOT EXISTS signal_reason TEXT',
      'ALTER TABLE open_positions ADD COLUMN IF NOT EXISTS entry_mode TEXT',
      'ALTER TABLE open_positions ADD COLUMN IF NOT EXISTS config_snapshot_json JSONB',
      'ALTER TABLE open_positions ADD COLUMN IF NOT EXISTS entry_fee DECIMAL(18,8) DEFAULT 0',
      'ALTER TABLE open_positions ADD COLUMN IF NOT EXISTS sg_break_even_activated BOOLEAN DEFAULT false',
      'ALTER TABLE open_positions ADD COLUMN IF NOT EXISTS sg_trailing_activated BOOLEAN DEFAULT false',
      'ALTER TABLE open_positions ADD COLUMN IF NOT EXISTS sg_current_stop_price DECIMAL(18,8)',
      'ALTER TABLE open_positions ADD COLUMN IF NOT EXISTS sg_scale_out_done BOOLEAN DEFAULT false',
      'ALTER TABLE open_positions ADD COLUMN IF NOT EXISTS time_stop_disabled BOOLEAN DEFAULT false',
      'ALTER TABLE open_positions ADD COLUMN IF NOT EXISTS time_stop_expired_at TIMESTAMP WITHOUT TIME ZONE',
      'ALTER TABLE open_positions ADD COLUMN IF NOT EXISTS be_progressive_level INTEGER DEFAULT 0',
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
