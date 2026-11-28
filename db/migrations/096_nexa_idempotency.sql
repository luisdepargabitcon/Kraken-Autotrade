-- Migration 096: durable HTTP idempotency for financial mutating operations.
-- NOT registered in MIGRATIONS — applied only with authorized deployment, same
-- operational pattern as 095_nexa_auth_v2.sql.
--
-- Operation identity is durable across restarts: a disconnected/timed-out
-- request is never silently re-executed; the same key with a different payload
-- is a hard conflict.

CREATE TABLE IF NOT EXISTS nexa_idempotency_keys (
  id SERIAL PRIMARY KEY,
  scoped_key TEXT NOT NULL UNIQUE,
  principal TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress',
  response_status INTEGER,
  response_body_json JSONB,
  response_content_type TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP,
  expires_at TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nexa_idempotency_expires ON nexa_idempotency_keys (expires_at);

COMMENT ON TABLE nexa_idempotency_keys IS 'Durable operation identity for financial mutating HTTP operations';
