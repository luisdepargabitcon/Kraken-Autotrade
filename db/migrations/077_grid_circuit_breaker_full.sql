-- Migration 077: circuit breaker completo con trazabilidad del ciclo causante,
-- severidad, revisión programada y resolución auditada.
-- Phase: 3C.5-A-REV-C9
--
-- Idempotente: solo añade columnas si no existen.
-- No backfill; legacy no cambia.

ALTER TABLE grid_isolated_configs
  ADD COLUMN IF NOT EXISTS circuit_breaker_source_cycle_id TEXT,
  ADD COLUMN IF NOT EXISTS circuit_breaker_severity TEXT,
  ADD COLUMN IF NOT EXISTS circuit_breaker_review_after TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS circuit_breaker_resolved_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS circuit_breaker_resolved_by TEXT,
  ADD COLUMN IF NOT EXISTS circuit_breaker_resolution_reason TEXT;
