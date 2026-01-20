-- Migration: Create master_backups table
-- Date: 2026-01-20
-- Description: Table for managing master/golden backups

CREATE TABLE IF NOT EXISTS master_backups (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  original_name TEXT,
  type TEXT NOT NULL,
  file_path TEXT NOT NULL,
  size TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  marked_as_master_at TIMESTAMP NOT NULL DEFAULT NOW(),
  metrics JSONB,
  system_info JSONB,
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  priority INTEGER NOT NULL DEFAULT 10,
  protection TEXT NOT NULL DEFAULT 'permanent'
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_master_backups_name ON master_backups(name);
CREATE INDEX IF NOT EXISTS idx_master_backups_created_at ON master_backups(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_master_backups_priority ON master_backups(priority DESC);
