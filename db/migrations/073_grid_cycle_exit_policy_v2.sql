-- 073_grid_cycle_exit_policy_v2.sql
-- FASE 3C.5-A-REV: Política FIRST_PROFITABLE_HIGHER_RUNG_V2 y persistencia
-- del estado de riesgo por ciclo.
--
-- Idempotente: solo añade columnas e índices si no existen.
-- No modifica datos legacy ni políticas de ejecución existentes.
-- No añade fallback taker ni permite órdenes reales.

-- 1. Columnas para identificar la política de salida y el origen del target.
ALTER TABLE grid_isolated_cycles
  ADD COLUMN IF NOT EXISTS exit_policy_version TEXT,
  ADD COLUMN IF NOT EXISTS target_kind TEXT,
  ADD COLUMN IF NOT EXISTS target_rung_level_id TEXT REFERENCES grid_isolated_levels(id),
  ADD COLUMN IF NOT EXISTS target_calculation_json JSONB,
  ADD COLUMN IF NOT EXISTS risk_state_json JSONB;

-- 2. Índice para localizar rápidamente ciclos por política de salida (auditoría).
CREATE INDEX IF NOT EXISTS idx_grid_cycles_exit_policy
  ON grid_isolated_cycles(exit_policy_version)
  WHERE exit_policy_version IS NOT NULL;

-- 3. Índice para localizar ciclos con estado de riesgo persistido.
CREATE INDEX IF NOT EXISTS idx_grid_cycles_risk_state
  ON grid_isolated_cycles(risk_state_json)
  WHERE risk_state_json IS NOT NULL;
