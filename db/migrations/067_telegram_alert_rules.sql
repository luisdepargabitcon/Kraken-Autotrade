-- Migration 050: Telegram Alert Rules Table
-- Gestión granular de alertas por modo y tipo
-- Permite configurar qué alertas específicas se envían para cada modo

CREATE TABLE IF NOT EXISTS telegram_alert_rules (
  id SERIAL PRIMARY KEY,
  chat_id INTEGER NOT NULL REFERENCES telegram_chats(id) ON DELETE CASCADE,
  mode TEXT NOT NULL, -- 'trading', 'idca', 'fiscal', 'smart_exit', 'system'
  alert_type TEXT NOT NULL, -- 'trade_buy', 'trade_sell', 'error_api', 'error_critical', 'cycle_started', 'cycle_closed', etc.
  enabled BOOLEAN NOT NULL DEFAULT true,
  min_severity TEXT DEFAULT 'LOW', -- 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'
  cooldown_seconds INTEGER DEFAULT 0, -- Cooldown entre alertas del mismo tipo
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_telegram_alert_rules_chat_id ON telegram_alert_rules(chat_id);
CREATE INDEX IF NOT EXISTS idx_telegram_alert_rules_mode ON telegram_alert_rules(mode);
CREATE INDEX IF NOT EXISTS idx_telegram_alert_rules_alert_type ON telegram_alert_rules(alert_type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_telegram_alert_rules_unique 
  ON telegram_alert_rules(chat_id, mode, alert_type);

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION update_telegram_alert_rules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_update_telegram_alert_rules_updated_at') THEN
    CREATE TRIGGER trigger_update_telegram_alert_rules_updated_at
      BEFORE UPDATE ON telegram_alert_rules
      FOR EACH ROW
      EXECUTE FUNCTION update_telegram_alert_rules_updated_at();
  END IF;
END $$;

-- Insertar reglas por defecto para chats existentes
INSERT INTO telegram_alert_rules (chat_id, mode, alert_type, enabled, min_severity)
SELECT 
  c.id, 
  m.mode, 
  'all' as alert_type,
  true,
  'LOW'
FROM telegram_chats c
CROSS JOIN (VALUES ('trading'), ('idca'), ('fiscal'), ('smart_exit'), ('system')) AS m(mode)
ON CONFLICT (chat_id, mode, alert_type) DO NOTHING;
