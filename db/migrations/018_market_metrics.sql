-- 018_market_metrics.sql
-- Tablas para el módulo de Métricas de Mercado (Market Metrics)
-- Proveedores: DeFiLlama, CoinMetrics, WhaleAlert, CoinGlass

-- -------------------------------------------------------
-- 1) Snapshots de métricas crudas ingresadas desde providers
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS market_metrics_snapshots (
  id            BIGSERIAL PRIMARY KEY,
  source        TEXT NOT NULL,
  metric        TEXT NOT NULL,
  asset         TEXT,
  pair          TEXT,
  value         NUMERIC NOT NULL,
  ts_provider   TIMESTAMPTZ,
  ts_ingested   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  meta          JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_mms_metric_asset_ts
  ON market_metrics_snapshots (metric, asset, ts_ingested DESC);

CREATE INDEX IF NOT EXISTS idx_mms_source_ts
  ON market_metrics_snapshots (source, ts_ingested DESC);

-- -------------------------------------------------------
-- 2) Evaluaciones del engine: resultado por par/operación
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS market_metrics_evaluations (
  id            BIGSERIAL PRIMARY KEY,
  pair          TEXT NOT NULL,
  side          TEXT NOT NULL DEFAULT 'buy',
  ts            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  enabled       BOOLEAN NOT NULL DEFAULT false,
  score         INTEGER NOT NULL DEFAULT 0,
  risk_level    TEXT NOT NULL DEFAULT 'DESCONOCIDO',
  bias          TEXT NOT NULL DEFAULT 'DESCONOCIDO',
  action        TEXT NOT NULL DEFAULT 'PERMITIR',
  mode          TEXT NOT NULL DEFAULT 'observacion',
  reasons       TEXT[] NOT NULL DEFAULT '{}',
  snapshot      JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_mme_pair_ts
  ON market_metrics_evaluations (pair, ts DESC);

CREATE INDEX IF NOT EXISTS idx_mme_ts
  ON market_metrics_evaluations (ts DESC);

-- -------------------------------------------------------
-- 3) Añadir columna de configuración en bot_config
--    market_metrics_config almacena el JSON de configuración
-- -------------------------------------------------------
ALTER TABLE bot_config
  ADD COLUMN IF NOT EXISTS market_metrics_config JSONB;
