-- 072_grid_maker_only_defaults.sql
-- FASE 3C.4-I-REV-B: Forzar defaults MAKER_ONLY en la tabla grid_isolated_configs
-- Idempotente: solo modifica los DEFAULTs de las columnas.
-- NO actualiza filas existentes para no sobreescribir configuraciones antiguas.
-- Las políticas legacy en configs SHADOW existentes se normalizan en runtime,
-- sin reescritura silenciosa de la DB.

-- 1. Default de política de ejecución: MAKER_ONLY
ALTER TABLE grid_isolated_configs
  ALTER COLUMN execution_policy
  SET DEFAULT 'MAKER_ONLY';

-- 2. Default de fallback taker: desactivado
ALTER TABLE grid_isolated_configs
  ALTER COLUMN taker_fallback_enabled
  SET DEFAULT FALSE;
