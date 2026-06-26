-- Migration 061: FISCO V2 Activation Audit & Backups
-- Tablas para auditoría de activación/rollback y backups de seguridad.
-- Idempotente: DROP IF EXISTS + CREATE (tablas nuevas, sin datos en producción).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- 1. fisco_v2_backups — Snapshots antes de activación V2 oficial
-- ============================================================

DROP TABLE IF EXISTS fisco_v2_backups;
CREATE TABLE fisco_v2_backups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year INTEGER NOT NULL,
  backup_type TEXT NOT NULL,
  official_engine_before TEXT,
  official_engine_after TEXT,
  operation_set_hash TEXT,
  legacy_result_json JSONB,
  v2_result_json JSONB,
  comparison_json JSONB,
  config_snapshot JSONB,
  disposals_snapshot JSONB,
  lots_snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT DEFAULT 'system',
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_fisco_v2_backups_year_created
  ON fisco_v2_backups(year, created_at DESC);

-- ============================================================
-- 2. fisco_v2_audit_log — Registro de eventos de activación/rollback/commit
-- ============================================================

DROP TABLE IF EXISTS fisco_v2_audit_log;
CREATE TABLE fisco_v2_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  engine_before TEXT,
  engine_after TEXT,
  operation_set_hash TEXT,
  expected_operation_set_hash TEXT,
  legacy_net_gain_loss_eur NUMERIC,
  v2_net_gain_loss_eur NUMERIC,
  diff_eur NUMERIC,
  safe_for_official_switch BOOLEAN,
  backup_id UUID,
  request_json JSONB,
  result_json JSONB,
  blockers JSONB,
  warnings JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT DEFAULT 'system'
);

CREATE INDEX IF NOT EXISTS idx_fisco_v2_audit_year_created
  ON fisco_v2_audit_log(year, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_fisco_v2_audit_event_type
  ON fisco_v2_audit_log(event_type);

COMMENT ON TABLE fisco_v2_backups IS 'FISCO V2: backups antes de activación oficial para rollback';
COMMENT ON TABLE fisco_v2_audit_log IS 'FISCO V2: log de auditoría de activación, rollback y controlled commits';
