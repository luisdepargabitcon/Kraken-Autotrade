-- Create telegram_chats table for multi-chat support
CREATE TABLE IF NOT EXISTS telegram_chats (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    chat_id VARCHAR(50) NOT NULL UNIQUE,
    is_default BOOLEAN DEFAULT FALSE,
    alert_trades BOOLEAN DEFAULT TRUE,
    alert_errors BOOLEAN DEFAULT TRUE,
    alert_system BOOLEAN DEFAULT TRUE,
    alert_balance BOOLEAN DEFAULT FALSE,
    alert_heartbeat BOOLEAN DEFAULT TRUE,
    alert_preferences JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_telegram_chats_chat_id ON telegram_chats(chat_id);
CREATE INDEX IF NOT EXISTS idx_telegram_chats_is_default ON telegram_chats(is_default);

-- Add trigger to update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_telegram_chats_updated_at 
    BEFORE UPDATE ON telegram_chats 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Ensure only one default chat exists
CREATE OR REPLACE FUNCTION ensure_single_default_chat()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_default = TRUE THEN
        UPDATE telegram_chats SET is_default = FALSE WHERE id != NEW.id;
    END IF;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER ensure_single_default_chat_trigger
    AFTER INSERT OR UPDATE ON telegram_chats
    FOR EACH ROW
    WHEN (NEW.is_default = TRUE)
    EXECUTE FUNCTION ensure_single_default_chat();
