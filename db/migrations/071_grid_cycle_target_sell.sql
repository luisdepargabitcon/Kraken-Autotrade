-- 071_grid_cycle_target_sell.sql
-- FASE 3C.4-G-REV2: Persistir la SELL objetivo de ciclos Grid abiertos.
-- Idempotente: columnas e índice solo se crean si no existen.
-- No se realiza backfill masivo; las asociaciones se resuelven y persisten
-- posteriormente durante el recovery controlado en startup.

-- 1. Columnas para la SELL objetivo de un ciclo BUY abierto
ALTER TABLE grid_isolated_cycles
  ADD COLUMN IF NOT EXISTS target_sell_level_id TEXT REFERENCES grid_isolated_levels(id),
  ADD COLUMN IF NOT EXISTS target_sell_price DECIMAL(18,8),
  ADD COLUMN IF NOT EXISTS target_sell_quantity DECIMAL(18,8);

-- 2. Índice único parcial: una SELL objetivo no puede vincularse a dos ciclos distintos.
CREATE UNIQUE INDEX IF NOT EXISTS
  grid_isolated_cycles_target_sell_level_unique
ON grid_isolated_cycles(target_sell_level_id)
WHERE target_sell_level_id IS NOT NULL;
