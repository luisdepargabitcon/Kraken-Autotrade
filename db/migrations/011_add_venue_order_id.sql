-- Migration 011: Add venue_order_id to open_positions
-- Purpose: Store exchange order ID for FillWatcher queries and order status verification
-- Related to: BUG FIX - Orders executed but marked as FAILED due to missing fill data

-- Add venue_order_id column to open_positions
ALTER TABLE open_positions 
ADD COLUMN IF NOT EXISTS venue_order_id TEXT;

-- Create index for efficient lookup by venue_order_id
CREATE INDEX IF NOT EXISTS idx_open_positions_venue_order_id 
ON open_positions(venue_order_id) 
WHERE venue_order_id IS NOT NULL;

-- Log migration
DO $$
BEGIN
  RAISE NOTICE 'Migration 011: Added venue_order_id column to open_positions for exchange order tracking';
END $$;
