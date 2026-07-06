-- Migration 049: Telegram Bot Tokens Table
-- Gestión multi-bot de tokens Telegram
-- Cada canal puede asociarse a un token específico

CREATE TABLE IF NOT EXISTS telegram_bot_tokens (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  token_encrypted TEXT NOT NULL, -- Token encriptado (usar crypto en app)
  token_last4 TEXT NOT NULL, -- Últimos 4 caracteres para identificación visual
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_default BOOLEAN NOT NULL DEFAULT false,
  environment TEXT NOT NULL DEFAULT 'production', -- production/staging
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_validated_at TIMESTAMP,
  last_error TEXT,
  deleted_at TIMESTAMP
);

-- Índices
CREATE INDEX idx_telegram_bot_tokens_active ON telegram_bot_tokens(is_active) WHERE deleted_at IS NULL;
CREATE INDEX idx_telegram_bot_tokens_default ON telegram_bot_tokens(is_default) WHERE deleted_at IS NULL;
CREATE INDEX idx_telegram_bot_tokens_env ON telegram_bot_tokens(environment) WHERE deleted_at IS NULL;

-- Constraint: solo un token por defecto activo por entorno
CREATE UNIQUE INDEX idx_telegram_bot_tokens_unique_default 
  ON telegram_bot_tokens(environment) 
  WHERE is_default = true AND is_active = true AND deleted_at IS NULL;

-- Añadir token_id a telegram_chats
ALTER TABLE telegram_chats
  ADD COLUMN IF NOT EXISTS token_id INTEGER REFERENCES telegram_bot_tokens(id) ON DELETE SET NULL;

-- Añadir campos de modos y alertas a telegram_chats
ALTER TABLE telegram_chats
  ADD COLUMN IF NOT EXISTS enabled_modes TEXT[] DEFAULT ARRAY['trading', 'idca', 'fiscal', 'smart_exit']::TEXT[],
  ADD COLUMN IF NOT EXISTS enabled_alerts TEXT[] DEFAULT ARRAY['trades', 'errors', 'system', 'balance', 'heartbeat']::TEXT[];

-- Índice para búsqueda por token_id
CREATE INDEX idx_telegram_chats_token_id ON telegram_chats(token_id) WHERE token_id IS NOT NULL;

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION update_telegram_bot_tokens_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_telegram_bot_tokens_updated_at
  BEFORE UPDATE ON telegram_bot_tokens
  FOR EACH ROW
  EXECUTE FUNCTION update_telegram_bot_tokens_updated_at();
