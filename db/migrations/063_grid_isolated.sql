-- 063_grid_isolated.sql — Grid Isolated Professional Engine tables
-- BTC/USD Revolut X — Isolated from Spot Normal and IDCA

-- 1. Grid Isolated Configs
CREATE TABLE IF NOT EXISTS grid_isolated_configs (
    id              SERIAL PRIMARY KEY,
    pair            TEXT NOT NULL DEFAULT 'BTC/USD',
    mode            TEXT NOT NULL DEFAULT 'OFF',  -- OFF | SHADOW | REAL_LIMITED | REAL_FULL
    capital_profile TEXT NOT NULL DEFAULT 'balanced',  -- conservative | balanced | aggressive
    execution_policy TEXT NOT NULL DEFAULT 'MAKER_FIRST_THEN_LIMIT_TAKER_FALLBACK',
    net_profit_target_pct   DECIMAL(6,3) NOT NULL DEFAULT 0.500,
    band_period             INTEGER NOT NULL DEFAULT 20,
    band_std_dev_multiplier DECIMAL(4,2) NOT NULL DEFAULT 2.00,
    atr_period              INTEGER NOT NULL DEFAULT 14,
    atr_timeframe           TEXT NOT NULL DEFAULT '1h',
    grid_step_atr_multiplier DECIMAL(4,2) NOT NULL DEFAULT 1.50,
    grid_step_min_pct       DECIMAL(6,3) NOT NULL DEFAULT 0.150,
    grid_step_max_pct       DECIMAL(6,3) NOT NULL DEFAULT 3.000,
    geometric_ratio_min    DECIMAL(4,3) NOT NULL DEFAULT 0.800,
    geometric_ratio_max    DECIMAL(4,3) NOT NULL DEFAULT 1.200,
    trailing_activation_pct DECIMAL(6,3) NOT NULL DEFAULT 1.000,
    trailing_stop_pct      DECIMAL(6,3) NOT NULL DEFAULT 0.400,
    stop_loss_soft_pct     DECIMAL(6,3) NOT NULL DEFAULT 2.000,
    stop_loss_hard_pct     DECIMAL(6,3) NOT NULL DEFAULT 5.000,
    stop_loss_emergency_pct DECIMAL(6,3) NOT NULL DEFAULT 10.000,
    hodl_recovery_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
    pump_guard_deviation_pct   DECIMAL(6,3) NOT NULL DEFAULT 3.000,
    pump_guard_volume_spike_ratio DECIMAL(6,2) NOT NULL DEFAULT 3.00,
    pump_guard_cooldown_minutes INTEGER NOT NULL DEFAULT 30,
    dump_guard_deviation_pct   DECIMAL(6,3) NOT NULL DEFAULT 3.000,
    dump_guard_volume_spike_ratio DECIMAL(6,2) NOT NULL DEFAULT 3.00,
    dump_guard_cooldown_minutes INTEGER NOT NULL DEFAULT 30,
    max_open_cycles        INTEGER NOT NULL DEFAULT 10,
    max_daily_orders       INTEGER NOT NULL DEFAULT 300,
    fiscal_status          TEXT NOT NULL DEFAULT 'pending',
    is_active              BOOLEAN NOT NULL DEFAULT FALSE,
    created_at             TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- 2. Grid Range Versions
CREATE TABLE IF NOT EXISTS grid_range_versions (
    id              TEXT PRIMARY KEY,  -- UUID
    version_number  INTEGER NOT NULL,
    pair            TEXT NOT NULL DEFAULT 'BTC/USD',
    status          TEXT NOT NULL DEFAULT 'proposed',  -- proposed | active | paused | exhausted | closed | archived
    mid_price       DECIMAL(18,8) NOT NULL,
    upper_price     DECIMAL(18,8) NOT NULL,
    lower_price     DECIMAL(18,8) NOT NULL,
    band_upper      DECIMAL(18,8) NOT NULL,
    band_middle     DECIMAL(18,8) NOT NULL,
    band_lower      DECIMAL(18,8) NOT NULL,
    band_width_pct  DECIMAL(8,4) NOT NULL,
    atr_pct         DECIMAL(8,4) NOT NULL,
    regime          TEXT NOT NULL,
    levels_count    INTEGER NOT NULL,
    geometric_ratio DECIMAL(6,4) NOT NULL,
    capital_budget_usd   DECIMAL(18,2) NOT NULL,
    capital_per_level_usd DECIMAL(18,2) NOT NULL,
    net_profit_target_pct DECIMAL(6,3) NOT NULL,
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    activated_at    TIMESTAMP WITH TIME ZONE,
    closed_at       TIMESTAMP WITH TIME ZONE
);

-- 3. Grid Isolated Levels
CREATE TABLE IF NOT EXISTS grid_isolated_levels (
    id              TEXT PRIMARY KEY,  -- UUID
    range_version_id TEXT NOT NULL REFERENCES grid_range_versions(id),
    level_index     INTEGER NOT NULL,
    side            TEXT NOT NULL,  -- BUY | SELL
    price           DECIMAL(18,8) NOT NULL,
    notional_usd    DECIMAL(18,2) NOT NULL,
    quantity        DECIMAL(18,8) NOT NULL,
    status          TEXT NOT NULL DEFAULT 'planned',  -- planned | open | partially_filled | filled | cancelled | expired
    filled_quantity DECIMAL(18,8) NOT NULL DEFAULT 0,
    filled_price    DECIMAL(18,8),
    client_order_id TEXT NOT NULL UNIQUE,  -- idempotency
    exchange_order_id TEXT,
    post_only_attempts INTEGER NOT NULL DEFAULT 0,
    used_taker_fallback BOOLEAN NOT NULL DEFAULT FALSE,
    net_profit_target_usd DECIMAL(18,8) NOT NULL DEFAULT 0,
    fee_estimate_usd     DECIMAL(18,8) NOT NULL DEFAULT 0,
    tax_reserve_usd      DECIMAL(18,8) NOT NULL DEFAULT 0,
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    placed_at       TIMESTAMP WITH TIME ZONE,
    filled_at       TIMESTAMP WITH TIME ZONE,
    cancelled_at    TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_grid_levels_range ON grid_isolated_levels(range_version_id);
CREATE INDEX IF NOT EXISTS idx_grid_levels_status ON grid_isolated_levels(status);
CREATE INDEX IF NOT EXISTS idx_grid_levels_client_order ON grid_isolated_levels(client_order_id);

-- 4. Grid Isolated Cycles (Buy → Sell round trips)
CREATE TABLE IF NOT EXISTS grid_isolated_cycles (
    id              TEXT PRIMARY KEY,  -- UUID
    range_version_id TEXT NOT NULL REFERENCES grid_range_versions(id),
    cycle_number    INTEGER NOT NULL,
    pair            TEXT NOT NULL DEFAULT 'BTC/USD',
    status          TEXT NOT NULL DEFAULT 'pending',  -- pending | buy_placed | buy_filled | sell_placed | sell_filled | completed | stop_loss_hit | trailing_closed | hodl_recovery | cancelled
    buy_level_id    TEXT REFERENCES grid_isolated_levels(id),
    sell_level_id   TEXT REFERENCES grid_isolated_levels(id),
    buy_price       DECIMAL(18,8),
    sell_price      DECIMAL(18,8),
    quantity        DECIMAL(18,8) NOT NULL,
    gross_pnl_usd   DECIMAL(18,8) NOT NULL DEFAULT 0,
    fee_total_usd   DECIMAL(18,8) NOT NULL DEFAULT 0,
    tax_reserve_usd DECIMAL(18,8) NOT NULL DEFAULT 0,
    net_pnl_usd     DECIMAL(18,8) NOT NULL DEFAULT 0,
    net_pnl_pct     DECIMAL(10,4) NOT NULL DEFAULT 0,
    buy_client_order_id TEXT,
    sell_client_order_id TEXT,
    buy_filled_at   TIMESTAMP WITH TIME ZONE,
    sell_filled_at  TIMESTAMP WITH TIME ZONE,
    hold_time_minutes INTEGER,
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_grid_cycles_range ON grid_isolated_cycles(range_version_id);
CREATE INDEX IF NOT EXISTS idx_grid_cycles_status ON grid_isolated_cycles(status);

-- 5. Grid Isolated Events (separate from bot_events for dedicated audit trail)
CREATE TABLE IF NOT EXISTS grid_isolated_events (
    id              BIGSERIAL PRIMARY KEY,
    event_type      TEXT NOT NULL,
    pair            TEXT NOT NULL DEFAULT 'BTC/USD',
    range_version_id TEXT,
    level_id        TEXT,
    cycle_id        TEXT,
    mode            TEXT NOT NULL,
    message         TEXT NOT NULL,
    metadata_json   JSONB,
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_grid_events_type ON grid_isolated_events(event_type);
CREATE INDEX IF NOT EXISTS idx_grid_events_range ON grid_isolated_events(range_version_id);
CREATE INDEX IF NOT EXISTS idx_grid_events_created ON grid_isolated_events(created_at DESC);

-- 6. Grid Isolated Metrics Snapshots (periodic state capture)
CREATE TABLE IF NOT EXISTS grid_isolated_metrics_snapshots (
    id              BIGSERIAL PRIMARY KEY,
    pair            TEXT NOT NULL DEFAULT 'BTC/USD',
    mode            TEXT NOT NULL,
    active_range_version_id TEXT,
    open_levels     INTEGER NOT NULL DEFAULT 0,
    open_cycles     INTEGER NOT NULL DEFAULT 0,
    daily_order_count INTEGER NOT NULL DEFAULT 0,
    circuit_breaker_open BOOLEAN NOT NULL DEFAULT FALSE,
    pump_dump_state TEXT NOT NULL DEFAULT 'normal',
    capital_reserved_usd DECIMAL(18,2) NOT NULL DEFAULT 0,
    capital_available_usd DECIMAL(18,2) NOT NULL DEFAULT 0,
    total_net_pnl_usd DECIMAL(18,8) NOT NULL DEFAULT 0,
    total_cycles_completed INTEGER NOT NULL DEFAULT 0,
    captured_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_grid_metrics_captured ON grid_isolated_metrics_snapshots(captured_at DESC);

-- 7. Grid Isolated Backtests
CREATE TABLE IF NOT EXISTS grid_isolated_backtests (
    id              BIGSERIAL PRIMARY KEY,
    pair            TEXT NOT NULL DEFAULT 'BTC/USD',
    start_date      TIMESTAMP WITH TIME ZONE NOT NULL,
    end_date        TIMESTAMP WITH TIME ZONE NOT NULL,
    timeframe       TEXT NOT NULL DEFAULT '1h',
    initial_capital_usd DECIMAL(18,2) NOT NULL,
    fill_model      TEXT NOT NULL DEFAULT 'realistic',  -- optimistic | realistic | pessimistic
    variants_json   JSONB NOT NULL,
    results_json    JSONB NOT NULL,
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- 8. Strategy Capital Reservations (cross-strategy isolation)
CREATE TABLE IF NOT EXISTS strategy_capital_reservations (
    id              TEXT PRIMARY KEY,  -- UUID
    strategy_type   TEXT NOT NULL,  -- GRID_ISOLATED | IDCA | SPOT_NORMAL
    pair            TEXT NOT NULL,
    reserved_usd    DECIMAL(18,2) NOT NULL,
    available_usd   DECIMAL(18,2) NOT NULL,
    reserved_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    released_at     TIMESTAMP WITH TIME ZONE,
    reason          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_capital_reservations_strategy ON strategy_capital_reservations(strategy_type);
CREATE INDEX IF NOT EXISTS idx_capital_reservations_pair ON strategy_capital_reservations(pair);

-- 9. Exchange Balance Snapshots (for reconciliation)
CREATE TABLE IF NOT EXISTS exchange_balance_snapshots (
    id              BIGSERIAL PRIMARY KEY,
    exchange        TEXT NOT NULL,  -- revolutx | kraken
    pair            TEXT NOT NULL DEFAULT 'BTC/USD',
    strategy_type   TEXT NOT NULL,  -- GRID_ISOLATED | IDCA | SPOT_NORMAL | GLOBAL
    balance_usd     DECIMAL(18,8),
    balance_btc     DECIMAL(18,8),
    open_orders_count INTEGER NOT NULL DEFAULT 0,
    snapshot_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_balance_snapshots_exchange ON exchange_balance_snapshots(exchange);
CREATE INDEX IF NOT EXISTS idx_balance_snapshots_strategy ON exchange_balance_snapshots(strategy_type);
CREATE INDEX IF NOT EXISTS idx_balance_snapshots_at ON exchange_balance_snapshots(snapshot_at DESC);
