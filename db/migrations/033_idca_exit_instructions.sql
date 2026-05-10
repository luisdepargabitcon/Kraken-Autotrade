-- Migration 033: IDCA Cycle Exit Instructions
-- Adds structured exit instruction table + cost basis tracking to institutional_dca_cycles
-- Safe: idempotent via IF NOT EXISTS / DO UPDATE WHERE

-- ─── Parte A: Campos nuevos en institutional_dca_cycles ───────────────────────

ALTER TABLE institutional_dca_cycles
  ADD COLUMN IF NOT EXISTS total_cost_basis_usd    DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS realized_cost_basis_usd DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS partial_sell_count       INTEGER       NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_partial_sell_at     TIMESTAMPTZ;

COMMENT ON COLUMN institutional_dca_cycles.total_cost_basis_usd IS
  'Coste histórico total comprado por el ciclo. Sube con cada compra, NUNCA baja. Denominador para realizedPnlPct en ciclos cerrados.';
COMMENT ON COLUMN institutional_dca_cycles.realized_cost_basis_usd IS
  'Coste acumulado de la parte ya vendida (Lote 4 ventas parciales). Sube con cada venta parcial.';
COMMENT ON COLUMN institutional_dca_cycles.partial_sell_count IS
  'Número de ventas parciales ejecutadas sobre este ciclo.';
COMMENT ON COLUMN institutional_dca_cycles.last_partial_sell_at IS
  'Timestamp de la última venta parcial ejecutada.';

-- Migración legacy: poblar total_cost_basis_usd con capital_used_usd existente
-- Solo afecta filas donde total_cost_basis_usd = 0 (todas las ya existentes)
UPDATE institutional_dca_cycles
  SET total_cost_basis_usd = COALESCE(capital_used_usd, 0)
  WHERE total_cost_basis_usd = 0 OR total_cost_basis_usd IS NULL;

-- ─── Parte B: Tabla de instrucciones de salida ────────────────────────────────

CREATE TABLE IF NOT EXISTS idca_cycle_exit_instructions (
  id                             SERIAL PRIMARY KEY,
  cycle_id                       INTEGER NOT NULL
                                   REFERENCES institutional_dca_cycles(id)
                                   ON DELETE CASCADE,
  pair                           TEXT NOT NULL,
  mode                           TEXT NOT NULL
                                   CHECK (mode IN ('simulation', 'live')),

  -- Tipo de instrucción
  type                           TEXT NOT NULL
                                   CHECK (type IN ('immediate', 'price_target', 'scheduled_time')),
  trigger_price                  DECIMAL(18,8),
  trigger_direction              TEXT
                                   CHECK (trigger_direction IN ('above', 'below') OR trigger_direction IS NULL),
  trigger_time                   TIMESTAMPTZ,
  timezone                       TEXT NOT NULL DEFAULT 'Europe/Madrid',

  -- Coherencia por tipo: exactamente los campos correctos para cada tipo
  CONSTRAINT chk_exit_type_coherence CHECK (
    (type = 'immediate'
      AND trigger_price     IS NULL
      AND trigger_direction IS NULL
      AND trigger_time      IS NULL)
    OR
    (type = 'price_target'
      AND trigger_price     IS NOT NULL
      AND trigger_direction IS NOT NULL
      AND trigger_time      IS NULL)
    OR
    (type = 'scheduled_time'
      AND trigger_price     IS NULL
      AND trigger_direction IS NULL
      AND trigger_time      IS NOT NULL)
  ),

  -- Porcentaje a cerrar (solo valores permitidos)
  close_pct                      DECIMAL(5,2) NOT NULL
                                   CHECK (close_pct IN (25, 50, 75, 100)),

  -- Snapshot informativo de la cantidad esperada al crear la instrucción (no se usa en ejecución)
  requested_quantity             DECIMAL(18,8),

  -- Estado del ciclo de vida de la instrucción
  status                         TEXT NOT NULL DEFAULT 'pending'
                                   CHECK (status IN (
                                     'pending', 'executing', 'executed',
                                     'cancelled', 'failed', 'failed_requires_review'
                                   )),

  created_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by                     TEXT NOT NULL DEFAULT 'user',
  updated_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Ejecución transaccional
  executing_started_at           TIMESTAMPTZ,
  execution_client_order_id      TEXT,          -- IDCA_EXIT_{cycleId}_{instrId}_{ts}
  executed_at                    TIMESTAMPTZ,
  execution_exchange_order_id    TEXT,          -- orderId/txid devuelto por exchange
  execution_price                DECIMAL(18,8), -- precio del tick en el momento de ejecución
  execution_quantity             DECIMAL(18,8), -- cantidad real vendida

  -- Cost basis real (nunca NULL en instrucciones executed)
  cost_basis_sold_usd            DECIMAL(18,4), -- capitalUsedUsd * sellRatio
  realized_pnl_increment_usd     DECIMAL(18,4), -- netSellValue - costBasisSold (puede ser negativo)
  remaining_capital_used_usd     DECIMAL(18,4), -- capitalUsedUsd del ciclo tras la venta
  remaining_cycle_quantity_after DECIMAL(18,8), -- totalQuantity del ciclo tras la venta

  -- Resultado financiero
  gross_value_usd                DECIMAL(18,2),
  fees_usd                       DECIMAL(18,4),
  net_value_usd                  DECIMAL(18,2),

  -- Cancelación
  cancelled_at                   TIMESTAMPTZ,
  cancel_reason                  TEXT,

  -- Error
  failure_reason                 TEXT,

  -- Notificaciones
  telegram_sent_at               TIMESTAMPTZ,
  notes                          TEXT
);

-- ─── Índices ───────────────────────────────────────────────────────────────────

-- Una sola instrucción bloqueante por ciclo (pending, executing o failed_requires_review)
CREATE UNIQUE INDEX IF NOT EXISTS uq_idca_exit_instruction_active
  ON idca_cycle_exit_instructions(cycle_id)
  WHERE status IN ('pending', 'executing', 'failed_requires_review');

CREATE INDEX IF NOT EXISTS idx_exit_instr_status
  ON idca_cycle_exit_instructions(status);

CREATE INDEX IF NOT EXISTS idx_exit_instr_cycle_id
  ON idca_cycle_exit_instructions(cycle_id);

CREATE INDEX IF NOT EXISTS idx_exit_instr_price_pending
  ON idca_cycle_exit_instructions(trigger_price, trigger_direction)
  WHERE status = 'pending' AND type = 'price_target';

CREATE INDEX IF NOT EXISTS idx_exit_instr_time_pending
  ON idca_cycle_exit_instructions(trigger_time)
  WHERE status = 'pending' AND type = 'scheduled_time';

CREATE INDEX IF NOT EXISTS idx_exit_instr_executing_stale
  ON idca_cycle_exit_instructions(executing_started_at)
  WHERE status = 'executing';

COMMENT ON TABLE idca_cycle_exit_instructions IS
  'Instrucciones de salida manual/programada por ciclo IDCA. Máximo una instrucción activa (pending/executing/failed_requires_review) por ciclo, garantizado por índice único parcial.';
