-- 070_grid_adaptive_smart_range.sql
-- FASE 3C.3-C: Adaptive Smart Range — rango inteligente adaptativo por régimen.
-- Idempotente: cada columna se añade solo si no existe.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'grid_isolated_configs' AND column_name = 'grid_range_control_mode'
  ) THEN
    ALTER TABLE grid_isolated_configs
      ADD COLUMN grid_range_control_mode text NOT NULL DEFAULT 'adaptive_smart';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'grid_isolated_configs' AND column_name = 'adaptive_range_enabled'
  ) THEN
    ALTER TABLE grid_isolated_configs
      ADD COLUMN adaptive_range_enabled boolean NOT NULL DEFAULT true;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'grid_isolated_configs' AND column_name = 'adaptive_range_profile'
  ) THEN
    ALTER TABLE grid_isolated_configs
      ADD COLUMN adaptive_range_profile text NOT NULL DEFAULT 'balanced';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'grid_isolated_configs' AND column_name = 'adaptive_range_min_pct'
  ) THEN
    ALTER TABLE grid_isolated_configs
      ADD COLUMN adaptive_range_min_pct decimal(6,2) NOT NULL DEFAULT '1.50';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'grid_isolated_configs' AND column_name = 'adaptive_range_max_pct'
  ) THEN
    ALTER TABLE grid_isolated_configs
      ADD COLUMN adaptive_range_max_pct decimal(6,2) NOT NULL DEFAULT '7.00';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'grid_isolated_configs' AND column_name = 'adaptive_range_low_vol_max_pct'
  ) THEN
    ALTER TABLE grid_isolated_configs
      ADD COLUMN adaptive_range_low_vol_max_pct decimal(6,2) NOT NULL DEFAULT '3.00';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'grid_isolated_configs' AND column_name = 'adaptive_range_normal_max_pct'
  ) THEN
    ALTER TABLE grid_isolated_configs
      ADD COLUMN adaptive_range_normal_max_pct decimal(6,2) NOT NULL DEFAULT '5.00';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'grid_isolated_configs' AND column_name = 'adaptive_range_high_vol_max_pct'
  ) THEN
    ALTER TABLE grid_isolated_configs
      ADD COLUMN adaptive_range_high_vol_max_pct decimal(6,2) NOT NULL DEFAULT '7.00';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'grid_isolated_configs' AND column_name = 'adaptive_range_target_full_levels'
  ) THEN
    ALTER TABLE grid_isolated_configs
      ADD COLUMN adaptive_range_target_full_levels boolean NOT NULL DEFAULT false;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'grid_isolated_configs' AND column_name = 'adaptive_range_min_viable_levels'
  ) THEN
    ALTER TABLE grid_isolated_configs
      ADD COLUMN adaptive_range_min_viable_levels integer NOT NULL DEFAULT 4;
  END IF;
END $$;
