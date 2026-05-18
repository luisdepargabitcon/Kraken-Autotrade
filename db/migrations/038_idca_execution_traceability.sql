-- Migration 038: IDCA Execution Traceability & Reconciliation
-- HOTFIX: Campos para trazabilidad de ejecución y reconciliación automática

-- 1. Add execution traceability fields to orders table
ALTER TABLE institutional_dca_orders
ADD COLUMN IF NOT EXISTS execution_status TEXT DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS intended_quantity DECIMAL(18,8),
ADD COLUMN IF NOT EXISTS intended_usd DECIMAL(18,2),
ADD COLUMN IF NOT EXISTS executed_quantity DECIMAL(18,8),
ADD COLUMN IF NOT EXISTS executed_usd DECIMAL(18,2),
ADD COLUMN IF NOT EXISTS avg_fill_price DECIMAL(18,8),
ADD COLUMN IF NOT EXISTS raw_exchange_response_json JSONB,
ADD COLUMN IF NOT EXISTS voided_reason TEXT,
ADD COLUMN IF NOT EXISTS voided_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS size_adjusted BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS original_intended_usd DECIMAL(18,2),
ADD COLUMN IF NOT EXISTS adjusted_usd DECIMAL(18,2),
ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
ADD COLUMN IF NOT EXISTS available_quote_before DECIMAL(18,2),
ADD COLUMN IF NOT EXISTS spendable_quote DECIMAL(18,2),
ADD COLUMN IF NOT EXISTS needs_verification_reason TEXT;

-- 2. Add reconciliation fields to cycles table
ALTER TABLE institutional_dca_cycles
ADD COLUMN IF NOT EXISTS reconciliation_status TEXT,
ADD COLUMN IF NOT EXISTS reconciliation_blocked_reason TEXT,
ADD COLUMN IF NOT EXISTS reconciliation_blocked_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS needs_manual_review BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS manual_review_reason TEXT;

-- 3. Create index for execution status queries
CREATE INDEX IF NOT EXISTS idx_idca_orders_execution_status 
ON institutional_dca_orders (execution_status);

CREATE INDEX IF NOT EXISTS idx_idca_orders_idempotency 
ON institutional_dca_orders (idempotency_key) 
WHERE idempotency_key IS NOT NULL;

-- 4. Create index for reconciliation queries
CREATE INDEX IF NOT EXISTS idx_idca_cycles_reconciliation_status 
ON institutional_dca_cycles (reconciliation_status) 
WHERE reconciliation_status IS NOT NULL;

-- 5. Update existing orders to 'verified' if they're old (pre-hotfix)
-- This assumes existing orders before this migration are legitimate
UPDATE institutional_dca_orders 
SET execution_status = 'legacy_pre_hotfix'
WHERE execution_status = 'pending' 
AND executed_at < NOW() - INTERVAL '1 day';

-- 6. Add comment explaining the hotfix
COMMENT ON TABLE institutional_dca_orders IS 
'IDCA Orders with execution traceability (HOTFIX: requires confirmed fill before cycle update)';

COMMENT ON COLUMN institutional_dca_orders.execution_status IS 
'Status: pending, submitted, filled, partially_filled, rejected, canceled, failed, phantom_voided, verified, reconciled';
