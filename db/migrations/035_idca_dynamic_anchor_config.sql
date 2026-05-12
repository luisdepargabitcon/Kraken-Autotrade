-- 035_idca_dynamic_anchor_config.sql
-- Añade campos de configuración para la Ancla Dinámica IDCA (Lote 5)
-- Tabla: institutional_dca_config (una sola fila)

ALTER TABLE institutional_dca_config
  ADD COLUMN IF NOT EXISTS idca_dynamic_anchor_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS idca_dynamic_anchor_fallback_to_legacy boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS idca_dynamic_anchor_emergency_disable boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN institutional_dca_config.idca_dynamic_anchor_enabled IS
  'Si true, la Ancla Dinámica IDCA decide la referencia de entrada para nuevas entradas';
COMMENT ON COLUMN institutional_dca_config.idca_dynamic_anchor_fallback_to_legacy IS
  'Si true y el servicio dinámico falla, cae al comportamiento anterior (VWAP anchor si existe, Hybrid si no)';
COMMENT ON COLUMN institutional_dca_config.idca_dynamic_anchor_emergency_disable IS
  'Kill switch de emergencia: si true, vuelve inmediatamente al comportamiento anterior sin tocar ciclos ni DB sensible';
