-- Migration 046: Conservative External Disposal
-- Adds classification / taxable / conservative disposal columns to
-- fisco_external_statement_items so that unmatched withdrawals can be
-- automatically closed as taxable disposals when no internal transfer is found.
-- Date: 2026-06-08

-- ── Classification columns ────────────────────────────────────────────────────

ALTER TABLE fisco_external_statement_items
  ADD COLUMN IF NOT EXISTS classification TEXT NOT NULL DEFAULT 'pending';
  -- 'pending'                        : initial, no decision taken yet
  -- 'internal_transfer'              : linked to own-exchange deposit
  -- 'own_wallet'                     : sent to own non-exchange wallet
  -- 'external_disposal'              : confirmed 3rd-party (user-confirmed taxable)
  -- 'conservative_external_disposal' : auto-assumed taxable (no match found)
  -- 'payment'                        : payment to 3rd party
  -- 'gift'                           : gift

ALTER TABLE fisco_external_statement_items
  ADD COLUMN IF NOT EXISTS classification_source TEXT;
  -- 'auto_match'              : set by TransferMatchingService
  -- 'conservative_assumption' : set by ConservativeDisposalService (auto)
  -- 'manual'                  : set manually by user via UI

ALTER TABLE fisco_external_statement_items
  ADD COLUMN IF NOT EXISTS taxable TEXT NOT NULL DEFAULT 'pending_review';
  -- 'true'           : taxable disposal event
  -- 'false'          : non-taxable (internal transfer)
  -- 'pending_review' : not yet determined

-- ── Conservative disposal computed fields ────────────────────────────────────

ALTER TABLE fisco_external_statement_items
  ADD COLUMN IF NOT EXISTS market_price_eur DECIMAL(18,8);
  -- EUR price per unit at time of withdrawal (from fisco_operations / rates)

ALTER TABLE fisco_external_statement_items
  ADD COLUMN IF NOT EXISTS proceeds_eur DECIMAL(18,8);
  -- market_price_eur * amount_sent (disposal proceeds)

ALTER TABLE fisco_external_statement_items
  ADD COLUMN IF NOT EXISTS cost_basis_eur DECIMAL(18,8);
  -- FIFO cost from existing lots at time of disposal

ALTER TABLE fisco_external_statement_items
  ADD COLUMN IF NOT EXISTS gain_loss_eur DECIMAL(18,8);
  -- proceeds_eur - cost_basis_eur - fees_eur

ALTER TABLE fisco_external_statement_items
  ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMP;
  -- when the conservative closure was computed

ALTER TABLE fisco_external_statement_items
  ADD COLUMN IF NOT EXISTS finalized_note TEXT;
  -- human-readable note (e.g. "Auto-closed: no internal transfer found after 30d")

-- ── Reversal tracking ─────────────────────────────────────────────────────────

ALTER TABLE fisco_external_statement_items
  ADD COLUMN IF NOT EXISTS conservative_reversed_at TIMESTAMP;
  -- when a conservative disposal was reversed by manual reclassification

ALTER TABLE fisco_external_statement_items
  ADD COLUMN IF NOT EXISTS conservative_reversed_to TEXT;
  -- new classification after reversal (e.g. 'internal_transfer', 'own_wallet')

-- ── Sync classification with reconciliation_status ───────────────────────────
-- Backfill classification from existing reconciliation_status where unambiguous

UPDATE fisco_external_statement_items
SET
  classification        = 'internal_transfer',
  classification_source = 'auto_match',
  taxable               = 'false'
WHERE reconciliation_status = 'matched_internal_transfer'
  AND classification = 'pending';

UPDATE fisco_external_statement_items
SET
  classification        = 'pending',
  classification_source = NULL,
  taxable               = 'pending_review'
WHERE reconciliation_status = 'unmatched'
  AND classification = 'pending';

-- ── Index ─────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_fisco_stmt_items_classification
  ON fisco_external_statement_items(classification);

CREATE INDEX IF NOT EXISTS idx_fisco_stmt_items_taxable
  ON fisco_external_statement_items(taxable);
