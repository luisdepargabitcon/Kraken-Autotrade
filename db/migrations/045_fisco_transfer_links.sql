-- Migration: FISCO Transfer Links & External Statement Items
-- Description: Support for non-order exchange movements (withdrawals, transfers)
--              that are not available via exchange trading API.
--              Enables TransferMatchingService to link withdrawals to deposits
--              across exchanges without creating fake fiscal disposals.
-- Date: 2026-06-08

-- ============================================================
-- EXTERNAL STATEMENT ITEMS
-- Manual/document-sourced movements not available via exchange API
-- e.g. RevolutX withdrawals only visible in app / PDF statement
-- ============================================================

CREATE TABLE IF NOT EXISTS fisco_external_statement_items (
  id                      SERIAL PRIMARY KEY,
  exchange                TEXT NOT NULL,          -- 'revolutx' | 'kraken' | 'manual'
  year                    INTEGER NOT NULL,        -- fiscal year
  asset                   TEXT NOT NULL,           -- e.g. 'USDC'
  statement_type          TEXT NOT NULL,
    -- 'withdrawal_crypto' | 'deposit_crypto' | 'sell_order'
    -- | 'transfer_out' | 'transfer_in' | 'fee_payment'

  event_at                TIMESTAMP NOT NULL,      -- execution timestamp (UTC)

  -- Amount breakdown
  amount_sent             DECIMAL(18,8),           -- amount leaving origin (before on-chain fee)
  fee_amount              DECIMAL(18,8),           -- on-chain or exchange network fee
  fee_asset               TEXT,                    -- fee denomination (usually same as asset)
  total_out               DECIMAL(18,8),           -- amount_sent + fee_amount (total leaving wallet)
  network                 TEXT,                    -- 'ethereum' | 'solana' | 'tron' etc.

  -- Official statement values (if known from PDF/app)
  gross_proceeds_usd      DECIMAL(18,8),
  cost_basis_usd          DECIMAL(18,8),
  fees_usd                DECIMAL(18,8),
  net_pnl_usd             DECIMAL(18,8),

  -- Identifiers
  transaction_identifier  TEXT,                    -- partial tx hash / order ID visible in UI
  source_document         TEXT,                    -- 'revolut_fiscal_statement_2025' | 'screenshot' | etc.

  -- Reconciliation state
  reconciliation_status   TEXT NOT NULL DEFAULT 'unmatched',
    -- 'unmatched'               : no match found yet
    -- 'matched_internal_transfer': linked to a deposit on another own exchange
    -- 'matched_external_disposal': treated as taxable disposal to 3rd party
    -- 'manual_review'           : requires human decision

  matched_operation_id    INTEGER REFERENCES fisco_operations(id),
  matched_transfer_link_id INTEGER,               -- populated after FK created

  notes                   TEXT,
  raw_data_json           JSONB,
  created_at              TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TRANSFER LINKS
-- Links a withdrawal on one exchange to a deposit on another
-- Key rule: if status='matched' → no trade_sell FIFO event needed
-- ============================================================

CREATE TABLE IF NOT EXISTS fisco_transfer_links (
  id                      SERIAL PRIMARY KEY,
  asset                   TEXT NOT NULL,
  from_exchange           TEXT NOT NULL,
  to_exchange             TEXT,                    -- null if destination unknown

  -- Source: either a statement item or a fisco_operation withdrawal
  from_statement_item_id  INTEGER REFERENCES fisco_external_statement_items(id),
  from_operation_id       INTEGER REFERENCES fisco_operations(id),

  -- Destination: deposit operation on the receiving exchange
  to_operation_id         INTEGER REFERENCES fisco_operations(id),

  -- Amounts
  amount_sent             DECIMAL(18,8) NOT NULL,
  amount_received         DECIMAL(18,8),           -- null if unmatched
  fee_amount              DECIMAL(18,8),
  fee_asset               TEXT,

  -- Chain data
  network                 TEXT,
  tx_hash                 TEXT,

  -- Match quality
  confidence              TEXT NOT NULL DEFAULT 'low',
    -- 'high'   : amount ≈ exact, time < 2h, same network
    -- 'medium' : amount close, time < 24h
    -- 'low'    : heuristic only, requires manual confirmation
  status                  TEXT NOT NULL DEFAULT 'unmatched',
    -- 'matched' | 'unmatched' | 'rejected' | 'manual_review'
  match_reason            TEXT,                    -- human-readable explanation
  matched_at              TIMESTAMP,

  metadata_json           JSONB,
  created_at              TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Add FK from statement_items to transfer_links now that both tables exist
-- NOTE: PostgreSQL does NOT support ADD CONSTRAINT IF NOT EXISTS — use DO $$ block instead.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_stmt_item_transfer_link'
  ) THEN
    ALTER TABLE fisco_external_statement_items
      ADD CONSTRAINT fk_stmt_item_transfer_link
        FOREIGN KEY (matched_transfer_link_id) REFERENCES fisco_transfer_links(id);
  END IF;
END $$;

-- ============================================================
-- Indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_fisco_stmt_items_exchange_year
  ON fisco_external_statement_items(exchange, year);
CREATE INDEX IF NOT EXISTS idx_fisco_stmt_items_asset
  ON fisco_external_statement_items(asset, event_at);
CREATE INDEX IF NOT EXISTS idx_fisco_stmt_items_status
  ON fisco_external_statement_items(reconciliation_status);

CREATE INDEX IF NOT EXISTS idx_fisco_transfer_links_status
  ON fisco_transfer_links(status);
CREATE INDEX IF NOT EXISTS idx_fisco_transfer_links_asset
  ON fisco_transfer_links(asset, from_exchange);
CREATE INDEX IF NOT EXISTS idx_fisco_transfer_links_from_stmt
  ON fisco_transfer_links(from_statement_item_id);
CREATE INDEX IF NOT EXISTS idx_fisco_transfer_links_to_op
  ON fisco_transfer_links(to_operation_id);
