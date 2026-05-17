-- 037_market_candles_cache.sql
-- Tabla de cache persistente de velas OHLCV para todos los módulos del sistema.
-- Usada por IDCA, modo normal y futuros módulos a través de MarketDataService.
-- No es fuente primaria - Kraken/MDS sigue siendo la fuente principal.
-- Esta tabla sirve como seed inicial, continuidad tras reinicio y fallback temporal.

-- -------------------------------------------------------
-- 1) Tabla principal de velas de mercado
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS market_candles (
  id BIGSERIAL PRIMARY KEY,
  pair TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'kraken',
  open_time TIMESTAMPTZ NOT NULL,
  close_time TIMESTAMPTZ NULL,
  open NUMERIC(30, 12) NOT NULL,
  high NUMERIC(30, 12) NOT NULL,
  low NUMERIC(30, 12) NOT NULL,
  close NUMERIC(30, 12) NOT NULL,
  volume NUMERIC(30, 12) NULL,
  is_closed BOOLEAN NOT NULL DEFAULT TRUE,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraint único para evitar duplicados
  UNIQUE(pair, timeframe, source, open_time)
);

-- -------------------------------------------------------
-- 2) Índices para consultas eficientes
-- -------------------------------------------------------

-- Índice principal para búsquedas por par/timeframe ordenado por tiempo
CREATE INDEX IF NOT EXISTS idx_market_candles_pair_tf_time 
  ON market_candles(pair, timeframe, open_time DESC);

-- Índice para consultas por tiempo de fetch (útil para limpieza)
CREATE INDEX IF NOT EXISTS idx_market_candles_fetched 
  ON market_candles(pair, timeframe, fetched_at DESC);

-- Índice para consultas por timeframe global
CREATE INDEX IF NOT EXISTS idx_market_candles_timeframe 
  ON market_candles(timeframe, open_time DESC);

-- Índice para identificar velas abiertas (en formación)
CREATE INDEX IF NOT EXISTS idx_market_candles_open 
  ON market_candles(is_closed) 
  WHERE is_closed = FALSE;

-- -------------------------------------------------------
-- 3) Trigger para actualizar updated_at automáticamente
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION update_market_candles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'trg_market_candles_updated_at'
  ) THEN
    CREATE TRIGGER trg_market_candles_updated_at
      BEFORE UPDATE ON market_candles
      FOR EACH ROW
      EXECUTE FUNCTION update_market_candles_updated_at();
  END IF;
END
$$;

-- -------------------------------------------------------
-- 4) Comentarios para documentación
-- -------------------------------------------------------
COMMENT ON TABLE market_candles IS 'Cache persistente de velas OHLCV para todos los módulos del sistema. No es fuente primaria.';
COMMENT ON COLUMN market_candles.source IS 'Fuente original: kraken, mds_cache, db_fallback, etc.';
COMMENT ON COLUMN market_candles.is_closed IS 'TRUE si la vela está cerrada, FALSE si está en formación';
COMMENT ON COLUMN market_candles.fetched_at IS 'Timestamp de cuando se obtuvo la vela de la fuente';

-- -------------------------------------------------------
-- 5) Configuración de retención (documentación - implementar en código)
-- -------------------------------------------------------
-- Retención recomendada:
-- - 1h: 180 días
-- - 1d: 5 años (1825 días)
-- - 15m: 90 días (si se usa en futuro)
-- 
-- La limpieza se implementa en código, no como trigger automático,
-- para evitar overhead en inserts frecuentes.
