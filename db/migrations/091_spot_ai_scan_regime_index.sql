-- 091_spot_ai_scan_regime_index.sql
-- R15: Add partial expression index for regime distribution query.
--
-- Purpose:
--   Optimize GET /api/spot/ai/dataset/regimes which currently takes ~33.7s
--   due to TOAST decompression of nested JSONB on ~17k SCAN rows.
--
-- Index type:
--   Partial expression btree index on extracted regime fields.
--   Only indexes SCAN rows (the only rows the regimes query reads).
--
-- Compatibility:
--   CREATE INDEX CONCURRENTLY — cannot run inside a transaction block.
--   Must be applied via the dedicated non-transactional runner:
--     script/spot-ai-migrate-091.ts
--   NOT via AutoMigrationRunner (which wraps in BEGIN/COMMIT).
--
-- This file contains EXACTLY ONE executable statement.
-- No BEGIN, no COMMIT, no DROP, no ALTER, no DML.

CREATE INDEX CONCURRENTLY idx_ft_scan_regime
ON public.spot_forward_twin_snapshots
(
  ((data->'regime'->>'regime')),
  ((data->'regime'->>'direction'))
)
WHERE snapshot_type = 'SCAN';
