CREATE TABLE "ai_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"filter_enabled" boolean DEFAULT false,
	"shadow_enabled" boolean DEFAULT false,
	"model_path" text,
	"model_version" text,
	"last_train_ts" timestamp,
	"last_backfill_ts" timestamp,
	"last_backfill_error" text,
	"last_backfill_discard_reasons_json" jsonb,
	"last_train_error" text,
	"n_samples" integer DEFAULT 0,
	"threshold" numeric(5, 4) DEFAULT '0.60',
	"metrics_json" jsonb,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ai_shadow_decisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"trade_id" text NOT NULL,
	"ts" timestamp DEFAULT now(),
	"score" numeric(5, 4) NOT NULL,
	"threshold" numeric(5, 4) NOT NULL,
	"would_block" boolean NOT NULL,
	"final_pnl_net" numeric(18, 8)
);
--> statement-breakpoint
CREATE TABLE "ai_trade_samples" (
	"id" serial PRIMARY KEY NOT NULL,
	"trade_id" text NOT NULL,
	"pair" text NOT NULL,
	"side" text NOT NULL,
	"entry_ts" timestamp NOT NULL,
	"exit_ts" timestamp,
	"entry_price" numeric(18, 8) NOT NULL,
	"exit_price" numeric(18, 8),
	"fees_total" numeric(18, 8),
	"pnl_gross" numeric(18, 8),
	"pnl_net" numeric(18, 8),
	"label_win" integer,
	"features_json" jsonb NOT NULL,
	"is_complete" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "ai_trade_samples_trade_id_unique" UNIQUE("trade_id")
);
--> statement-breakpoint
CREATE TABLE "alert_throttle" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"last_alert_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "alert_throttle_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "api_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"kraken_api_key" text,
	"kraken_api_secret" text,
	"kraken_connected" boolean DEFAULT false NOT NULL,
	"kraken_enabled" boolean DEFAULT true NOT NULL,
	"revolutx_api_key" text,
	"revolutx_private_key" text,
	"revolutx_connected" boolean DEFAULT false NOT NULL,
	"revolutx_enabled" boolean DEFAULT false NOT NULL,
	"trading_exchange" text DEFAULT 'kraken' NOT NULL,
	"data_exchange" text DEFAULT 'kraken' NOT NULL,
	"active_exchange" text DEFAULT 'kraken' NOT NULL,
	"telegram_token" text,
	"telegram_chat_id" text,
	"telegram_connected" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applied_trades" (
	"id" serial PRIMARY KEY NOT NULL,
	"exchange" text NOT NULL,
	"pair" text NOT NULL,
	"trade_id" text NOT NULL,
	"applied_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "applied_trades_exchange_pair_trade_id_unique" UNIQUE("exchange","pair","trade_id")
);
--> statement-breakpoint
CREATE TABLE "bot_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"strategy" text DEFAULT 'momentum' NOT NULL,
	"signal_timeframe" text DEFAULT 'cycle' NOT NULL,
	"risk_level" text DEFAULT 'medium' NOT NULL,
	"active_pairs" text[] DEFAULT '{"BTC/USD","ETH/USD","SOL/USD"}' NOT NULL,
	"stop_loss_percent" numeric(5, 2) DEFAULT '5.00' NOT NULL,
	"take_profit_percent" numeric(5, 2) DEFAULT '7.00' NOT NULL,
	"trailing_stop_enabled" boolean DEFAULT false NOT NULL,
	"trailing_stop_percent" numeric(5, 2) DEFAULT '2.00' NOT NULL,
	"nonce_error_alerts_enabled" boolean DEFAULT true NOT NULL,
	"daily_loss_limit_enabled" boolean DEFAULT true NOT NULL,
	"daily_loss_limit_percent" numeric(5, 2) DEFAULT '10.00' NOT NULL,
	"max_pair_exposure_pct" numeric(5, 2) DEFAULT '25.00' NOT NULL,
	"max_total_exposure_pct" numeric(5, 2) DEFAULT '60.00' NOT NULL,
	"exposure_base" text DEFAULT 'cash' NOT NULL,
	"risk_per_trade_pct" numeric(5, 2) DEFAULT '15.00' NOT NULL,
	"trading_hours_enabled" boolean DEFAULT true NOT NULL,
	"trading_hours_start" numeric(2, 0) DEFAULT '8' NOT NULL,
	"trading_hours_end" numeric(2, 0) DEFAULT '22' NOT NULL,
	"position_mode" text DEFAULT 'SINGLE' NOT NULL,
	"sg_min_entry_usd" numeric(10, 2) DEFAULT '100.00' NOT NULL,
	"sg_allow_under_min" boolean DEFAULT true NOT NULL,
	"sg_be_at_pct" numeric(5, 2) DEFAULT '1.50' NOT NULL,
	"sg_fee_cushion_pct" numeric(5, 2) DEFAULT '0.45' NOT NULL,
	"sg_fee_cushion_auto" boolean DEFAULT true NOT NULL,
	"sg_trail_start_pct" numeric(5, 2) DEFAULT '2.00' NOT NULL,
	"sg_trail_distance_pct" numeric(5, 2) DEFAULT '0.85' NOT NULL,
	"sg_trail_step_pct" numeric(5, 2) DEFAULT '0.25' NOT NULL,
	"sg_tp_fixed_enabled" boolean DEFAULT false NOT NULL,
	"sg_tp_fixed_pct" numeric(5, 2) DEFAULT '10.00' NOT NULL,
	"sg_scale_out_enabled" boolean DEFAULT true NOT NULL,
	"sg_scale_out_pct" numeric(5, 2) DEFAULT '35.00' NOT NULL,
	"sg_min_part_usd" numeric(10, 2) DEFAULT '50.00' NOT NULL,
	"sg_scale_out_threshold" numeric(5, 2) DEFAULT '80.00' NOT NULL,
	"sg_max_open_lots_per_pair" integer DEFAULT 1 NOT NULL,
	"sg_pair_overrides" jsonb,
	"dry_run_mode" boolean DEFAULT false NOT NULL,
	"regime_detection_enabled" boolean DEFAULT false NOT NULL,
	"regime_router_enabled" boolean DEFAULT false NOT NULL,
	"range_cooldown_minutes" integer DEFAULT 60 NOT NULL,
	"transition_size_factor" numeric(4, 2) DEFAULT '0.50' NOT NULL,
	"transition_cooldown_minutes" integer DEFAULT 120 NOT NULL,
	"transition_be_at_pct" numeric(5, 2) DEFAULT '2.00' NOT NULL,
	"transition_trail_start_pct" numeric(5, 2) DEFAULT '2.80' NOT NULL,
	"transition_tp_pct" numeric(5, 2) DEFAULT '5.00' NOT NULL,
	"adaptive_exit_enabled" boolean DEFAULT false NOT NULL,
	"taker_fee_pct" numeric(5, 3) DEFAULT '0.400' NOT NULL,
	"maker_fee_pct" numeric(5, 3) DEFAULT '0.250' NOT NULL,
	"profit_buffer_pct" numeric(5, 2) DEFAULT '1.00' NOT NULL,
	"min_be_floor_pct" numeric(5, 2) DEFAULT '2.00' NOT NULL,
	"time_stop_hours" integer DEFAULT 36 NOT NULL,
	"time_stop_mode" text DEFAULT 'soft' NOT NULL,
	"notif_cooldown_stop_updated" integer DEFAULT 60 NOT NULL,
	"notif_cooldown_regime_change" integer DEFAULT 300 NOT NULL,
	"notif_cooldown_heartbeat" integer DEFAULT 3600 NOT NULL,
	"notif_cooldown_trades" integer DEFAULT 0 NOT NULL,
	"notif_cooldown_errors" integer DEFAULT 60 NOT NULL,
	"error_alert_chat_id" text,
	"signal_rejection_alerts_enabled" boolean DEFAULT true NOT NULL,
	"signal_rejection_alert_chat_id" text,
	"buy_snapshot_alerts_enabled" boolean DEFAULT true NOT NULL,
	"spread_filter_enabled" boolean DEFAULT true NOT NULL,
	"spread_dynamic_enabled" boolean DEFAULT true NOT NULL,
	"spread_max_pct" numeric(5, 2) DEFAULT '2.00' NOT NULL,
	"spread_threshold_trend" numeric(5, 2) DEFAULT '1.50' NOT NULL,
	"spread_threshold_range" numeric(5, 2) DEFAULT '2.00' NOT NULL,
	"spread_threshold_transition" numeric(5, 2) DEFAULT '2.50' NOT NULL,
	"spread_cap_pct" numeric(5, 2) DEFAULT '3.50' NOT NULL,
	"spread_floor_pct" numeric(5, 2) DEFAULT '0.30' NOT NULL,
	"spread_revolutx_markup_pct" numeric(5, 2) DEFAULT '0.80' NOT NULL,
	"spread_telegram_alert_enabled" boolean DEFAULT true NOT NULL,
	"spread_telegram_cooldown_ms" integer DEFAULT 600000 NOT NULL,
	"dynamic_markup_enabled" boolean DEFAULT true NOT NULL,
	"staleness_gate_enabled" boolean DEFAULT true NOT NULL,
	"staleness_max_sec" integer DEFAULT 60 NOT NULL,
	"chase_gate_enabled" boolean DEFAULT true NOT NULL,
	"chase_max_pct" numeric(5, 2) DEFAULT '0.50' NOT NULL,
	"log_retention_enabled" boolean DEFAULT true NOT NULL,
	"log_retention_days" integer DEFAULT 7 NOT NULL,
	"events_retention_enabled" boolean DEFAULT true NOT NULL,
	"events_retention_days" integer DEFAULT 14 NOT NULL,
	"last_log_purge_at" timestamp,
	"last_log_purge_count" integer DEFAULT 0,
	"last_events_purge_at" timestamp,
	"last_events_purge_count" integer DEFAULT 0,
	"market_metrics_config" jsonb,
	"smart_exit_config" jsonb,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"level" text NOT NULL,
	"type" text NOT NULL,
	"message" text NOT NULL,
	"meta" text
);
--> statement-breakpoint
CREATE TABLE "config_change" (
	"id" serial PRIMARY KEY NOT NULL,
	"config_id" text NOT NULL,
	"user_id" text,
	"change_type" text NOT NULL,
	"description" text NOT NULL,
	"previous_config" jsonb,
	"new_config" jsonb NOT NULL,
	"changed_fields" text[] NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"applied_at" timestamp,
	"is_active" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "config_preset" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"config" jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "config_preset_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "fisco_alert_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"sync_daily_enabled" boolean DEFAULT true NOT NULL,
	"sync_manual_enabled" boolean DEFAULT true NOT NULL,
	"report_generated_enabled" boolean DEFAULT true NOT NULL,
	"error_sync_enabled" boolean DEFAULT true NOT NULL,
	"notify_always" boolean DEFAULT false NOT NULL,
	"summary_threshold" integer DEFAULT 30 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "fisco_alert_config_chat_id_unique" UNIQUE("chat_id")
);
--> statement-breakpoint
CREATE TABLE "fisco_disposals" (
	"id" serial PRIMARY KEY NOT NULL,
	"sell_operation_id" integer NOT NULL,
	"lot_id" integer NOT NULL,
	"quantity" numeric(18, 8) NOT NULL,
	"proceeds_eur" numeric(18, 8) NOT NULL,
	"cost_basis_eur" numeric(18, 8) NOT NULL,
	"gain_loss_eur" numeric(18, 8) NOT NULL,
	"disposed_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fisco_lots" (
	"id" serial PRIMARY KEY NOT NULL,
	"operation_id" integer NOT NULL,
	"asset" text NOT NULL,
	"quantity" numeric(18, 8) NOT NULL,
	"remaining_qty" numeric(18, 8) NOT NULL,
	"cost_eur" numeric(18, 8) NOT NULL,
	"unit_cost_eur" numeric(18, 8) NOT NULL,
	"fee_eur" numeric(18, 8) DEFAULT '0',
	"acquired_at" timestamp NOT NULL,
	"is_closed" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fisco_operations" (
	"id" serial PRIMARY KEY NOT NULL,
	"exchange" text NOT NULL,
	"external_id" text NOT NULL,
	"op_type" text NOT NULL,
	"asset" text NOT NULL,
	"amount" numeric(18, 8) NOT NULL,
	"price_eur" numeric(18, 8),
	"total_eur" numeric(18, 8),
	"fee_eur" numeric(18, 8) DEFAULT '0',
	"counter_asset" text,
	"pair" text,
	"executed_at" timestamp NOT NULL,
	"raw_data" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "fisco_operations_exchange_external_id_unique" UNIQUE("exchange","external_id")
);
--> statement-breakpoint
CREATE TABLE "fisco_summary" (
	"id" serial PRIMARY KEY NOT NULL,
	"fiscal_year" integer NOT NULL,
	"asset" text NOT NULL,
	"total_acquisitions" numeric(18, 8) DEFAULT '0',
	"total_disposals" numeric(18, 8) DEFAULT '0',
	"total_cost_basis_eur" numeric(18, 8) DEFAULT '0',
	"total_proceeds_eur" numeric(18, 8) DEFAULT '0',
	"total_gain_loss_eur" numeric(18, 8) DEFAULT '0',
	"total_fees_eur" numeric(18, 8) DEFAULT '0',
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "fisco_summary_fiscal_year_asset_unique" UNIQUE("fiscal_year","asset")
);
--> statement-breakpoint
CREATE TABLE "fisco_sync_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"mode" text NOT NULL,
	"triggered_by" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"status" text DEFAULT 'running' NOT NULL,
	"results_json" jsonb,
	"error_json" jsonb,
	CONSTRAINT "fisco_sync_history_run_id_unique" UNIQUE("run_id")
);
--> statement-breakpoint
CREATE TABLE "fisco_sync_retry" (
	"id" serial PRIMARY KEY NOT NULL,
	"exchange" text NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"next_retry_at" timestamp,
	"last_error_code" text,
	"last_error_msg" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "fisco_sync_retry_exchange_unique" UNIQUE("exchange")
);
--> statement-breakpoint
CREATE TABLE "hybrid_reentry_watches" (
	"id" serial PRIMARY KEY NOT NULL,
	"exchange" varchar(32) NOT NULL,
	"pair" varchar(24) NOT NULL,
	"strategy" varchar(64) NOT NULL,
	"reason" varchar(32) NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"scan_id" varchar(64),
	"regime" varchar(24),
	"raw_signal" varchar(16),
	"reject_price" numeric(18, 8),
	"ema20" numeric(18, 8),
	"price_vs_ema20_pct" numeric(18, 8),
	"volume_ratio" numeric(18, 8),
	"mtf_alignment" numeric(18, 8),
	"signals_count" integer,
	"min_signals_required" integer,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "institutional_dca_asset_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"pair" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"min_dip_pct" numeric(5, 2) DEFAULT '2.00' NOT NULL,
	"dip_reference" text DEFAULT 'local_high' NOT NULL,
	"require_rebound_confirmation" boolean DEFAULT true NOT NULL,
	"trailing_buy_enabled" boolean DEFAULT true NOT NULL,
	"safety_orders_json" jsonb DEFAULT '[{"dipPct":2,"sizePctOfAssetBudget":25},{"dipPct":4,"sizePctOfAssetBudget":25},{"dipPct":6,"sizePctOfAssetBudget":25},{"dipPct":8,"sizePctOfAssetBudget":25}]'::jsonb NOT NULL,
	"max_safety_orders" integer DEFAULT 4 NOT NULL,
	"take_profit_pct" numeric(5, 2) DEFAULT '4.00' NOT NULL,
	"dynamic_take_profit" boolean DEFAULT true NOT NULL,
	"trailing_pct" numeric(5, 2) DEFAULT '1.20' NOT NULL,
	"partial_take_profit_pct" numeric(5, 2) DEFAULT '30.00' NOT NULL,
	"breakeven_enabled" boolean DEFAULT true NOT NULL,
	"protection_activation_pct" numeric(5, 2) DEFAULT '1.00' NOT NULL,
	"trailing_activation_pct" numeric(5, 2) DEFAULT '3.50' NOT NULL,
	"trailing_margin_pct" numeric(5, 2) DEFAULT '1.50' NOT NULL,
	"cooldown_minutes_between_buys" integer DEFAULT 180 NOT NULL,
	"max_cycle_duration_hours" integer DEFAULT 720 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "institutional_dca_asset_configs_pair_unique" UNIQUE("pair")
);
--> statement-breakpoint
CREATE TABLE "institutional_dca_backtests" (
	"id" serial PRIMARY KEY NOT NULL,
	"pair" text NOT NULL,
	"from_date" timestamp NOT NULL,
	"to_date" timestamp NOT NULL,
	"config_snapshot_json" jsonb NOT NULL,
	"total_return_pct" numeric(10, 4),
	"total_return_usd" numeric(18, 2),
	"max_drawdown_pct" numeric(10, 4),
	"win_rate_pct" numeric(10, 4),
	"profit_factor" numeric(10, 4),
	"cycles_count" integer,
	"avg_cycle_duration_hours" numeric(10, 2),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "institutional_dca_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"mode" text DEFAULT 'disabled' NOT NULL,
	"allocated_capital_usd" numeric(18, 2) DEFAULT '1000.00' NOT NULL,
	"protect_principal" boolean DEFAULT true NOT NULL,
	"reinvest_mode" text DEFAULT 'none' NOT NULL,
	"max_module_exposure_pct" numeric(5, 2) DEFAULT '80.00' NOT NULL,
	"max_asset_exposure_pct" numeric(5, 2) DEFAULT '50.00' NOT NULL,
	"max_module_drawdown_pct" numeric(5, 2) DEFAULT '15.00' NOT NULL,
	"max_combined_btc_exposure_pct" numeric(5, 2) DEFAULT '40.00' NOT NULL,
	"max_combined_eth_exposure_pct" numeric(5, 2) DEFAULT '30.00' NOT NULL,
	"block_on_breakdown" boolean DEFAULT true NOT NULL,
	"block_on_high_spread" boolean DEFAULT true NOT NULL,
	"block_on_sell_pressure" boolean DEFAULT true NOT NULL,
	"scheduler_interval_seconds" integer DEFAULT 60 NOT NULL,
	"local_high_lookback_minutes" integer DEFAULT 1440 NOT NULL,
	"smart_mode_enabled" boolean DEFAULT true NOT NULL,
	"volatility_trailing_enabled" boolean DEFAULT true NOT NULL,
	"adaptive_tp_enabled" boolean DEFAULT true NOT NULL,
	"adaptive_position_sizing_enabled" boolean DEFAULT true NOT NULL,
	"btc_market_gate_for_eth_enabled" boolean DEFAULT true NOT NULL,
	"learning_window_cycles" integer DEFAULT 20 NOT NULL,
	"learning_auto_apply" boolean DEFAULT false NOT NULL,
	"min_trailing_pct_btc" numeric(5, 2) DEFAULT '0.50' NOT NULL,
	"max_trailing_pct_btc" numeric(5, 2) DEFAULT '2.50' NOT NULL,
	"min_trailing_pct_eth" numeric(5, 2) DEFAULT '0.80' NOT NULL,
	"max_trailing_pct_eth" numeric(5, 2) DEFAULT '3.50' NOT NULL,
	"min_tp_pct_btc" numeric(5, 2) DEFAULT '2.00' NOT NULL,
	"max_tp_pct_btc" numeric(5, 2) DEFAULT '6.00' NOT NULL,
	"min_tp_pct_eth" numeric(5, 2) DEFAULT '2.50' NOT NULL,
	"max_tp_pct_eth" numeric(5, 2) DEFAULT '8.00' NOT NULL,
	"market_score_weights_json" jsonb DEFAULT '{"ema20_distance":15,"ema50_distance":10,"ema20_slope":10,"ema50_slope":10,"rsi":15,"relative_volume":10,"drawdown_from_high":15,"btc_condition":15}'::jsonb NOT NULL,
	"partial_tp_min_pct" numeric(5, 2) DEFAULT '20.00' NOT NULL,
	"partial_tp_max_pct" numeric(5, 2) DEFAULT '50.00' NOT NULL,
	"simulation_initial_balance_usd" numeric(18, 2) DEFAULT '10000.00' NOT NULL,
	"simulation_fee_pct" numeric(5, 3) DEFAULT '0.400' NOT NULL,
	"simulation_slippage_pct" numeric(5, 3) DEFAULT '0.100' NOT NULL,
	"simulation_telegram_enabled" boolean DEFAULT false NOT NULL,
	"event_retention_days" integer DEFAULT 90 NOT NULL,
	"order_archive_days" integer DEFAULT 180 NOT NULL,
	"telegram_enabled" boolean DEFAULT false NOT NULL,
	"telegram_chat_id" text,
	"telegram_thread_id" text,
	"telegram_summary_mode" text DEFAULT 'compact' NOT NULL,
	"telegram_cooldown_seconds" integer DEFAULT 30 NOT NULL,
	"telegram_alert_toggles_json" jsonb DEFAULT '{"cycle_started":true,"base_buy_executed":true,"safety_buy_executed":true,"buy_blocked":true,"tp_armed":true,"partial_sell_executed":true,"trailing_updated":false,"trailing_exit":true,"breakeven_exit":true,"cycle_closed":true,"daily_summary":true,"critical_error":true,"smart_adjustment_applied":true,"simulation_alerts_enabled":true}'::jsonb NOT NULL,
	"dynamic_tp_config_json" jsonb DEFAULT '{"baseTpPctBtc":4,"baseTpPctEth":5,"reductionPerExtraBuyMain":0.3,"reductionPerExtraBuyPlus":0.2,"weakReboundReductionMain":0.5,"weakReboundReductionPlus":0.3,"strongReboundBonusMain":0.3,"strongReboundBonusPlus":0.2,"highVolatilityAdjustMain":0.3,"highVolatilityAdjustPlus":0.2,"lowVolatilityAdjustMain":-0.2,"lowVolatilityAdjustPlus":-0.1,"mainMinTpPctBtc":2,"mainMaxTpPctBtc":6,"mainMinTpPctEth":2.5,"mainMaxTpPctEth":8,"plusMinTpPctBtc":2.5,"plusMaxTpPctBtc":5,"plusMinTpPctEth":3,"plusMaxTpPctEth":6}'::jsonb NOT NULL,
	"plus_config_json" jsonb DEFAULT '{"enabled":false,"maxPlusCyclesPerMain":2,"maxPlusEntries":3,"capitalAllocationPct":15,"activationExtraDipPct":4,"requireMainExhausted":true,"requireReboundConfirmation":true,"cooldownMinutesBetweenBuys":60,"autoCloseIfMainClosed":true,"maxExposurePctPerAsset":20,"entryDipSteps":[2,3.5,5],"entrySizingMode":"fixed","baseTpPctBtc":4,"baseTpPctEth":4.5,"trailingPctBtc":1,"trailingPctEth":1.2}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "institutional_dca_cycles" (
	"id" serial PRIMARY KEY NOT NULL,
	"pair" text NOT NULL,
	"strategy" text DEFAULT 'institutional_dca_v1' NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"capital_reserved_usd" numeric(18, 2) DEFAULT '0' NOT NULL,
	"capital_used_usd" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_quantity" numeric(18, 8) DEFAULT '0' NOT NULL,
	"avg_entry_price" numeric(18, 8),
	"current_price" numeric(18, 8),
	"unrealized_pnl_usd" numeric(18, 2) DEFAULT '0',
	"unrealized_pnl_pct" numeric(10, 4) DEFAULT '0',
	"realized_pnl_usd" numeric(18, 2) DEFAULT '0',
	"buy_count" integer DEFAULT 0 NOT NULL,
	"highest_price_after_tp" numeric(18, 8),
	"tp_target_pct" numeric(5, 2),
	"tp_target_price" numeric(18, 8),
	"tp_armed_at" timestamp,
	"trailing_pct" numeric(5, 2),
	"trailing_active_at" timestamp,
	"next_buy_level_pct" numeric(5, 2),
	"next_buy_price" numeric(18, 8),
	"market_score" numeric(5, 2),
	"volatility_score" numeric(5, 2),
	"adaptive_size_profile" text,
	"last_buy_at" timestamp,
	"close_reason" text,
	"max_drawdown_pct" numeric(5, 2) DEFAULT '0',
	"notes_json" jsonb,
	"tp_breakdown_json" jsonb,
	"cycle_type" text DEFAULT 'main' NOT NULL,
	"parent_cycle_id" integer,
	"plus_cycles_completed" integer DEFAULT 0 NOT NULL,
	"is_imported" boolean DEFAULT false NOT NULL,
	"imported_at" timestamp,
	"source_type" text,
	"managed_by" text,
	"solo_salida" boolean DEFAULT false NOT NULL,
	"import_notes" text,
	"import_snapshot_json" jsonb,
	"is_manual_cycle" boolean DEFAULT false NOT NULL,
	"exchange_source" text,
	"estimated_fee_pct" numeric(8, 4),
	"estimated_fee_usd" numeric(18, 2),
	"fees_override_manual" boolean DEFAULT false NOT NULL,
	"import_warning_acknowledged" boolean DEFAULT false NOT NULL,
	"protection_armed_at" timestamp,
	"protection_stop_price" numeric(18, 8),
	"started_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "institutional_dca_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"cycle_id" integer,
	"pair" text,
	"mode" text,
	"event_type" text NOT NULL,
	"reason_code" text,
	"severity" text DEFAULT 'info' NOT NULL,
	"message" text NOT NULL,
	"human_title" text,
	"human_message" text,
	"technical_summary" text,
	"payload_json" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "institutional_dca_ohlcv_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"pair" text NOT NULL,
	"timeframe" text NOT NULL,
	"ts" timestamp NOT NULL,
	"open" numeric(18, 8) NOT NULL,
	"high" numeric(18, 8) NOT NULL,
	"low" numeric(18, 8) NOT NULL,
	"close" numeric(18, 8) NOT NULL,
	"volume" numeric(18, 8) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "institutional_dca_ohlcv_cache_pair_timeframe_ts_unique" UNIQUE("pair","timeframe","ts")
);
--> statement-breakpoint
CREATE TABLE "institutional_dca_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"cycle_id" integer NOT NULL,
	"pair" text NOT NULL,
	"mode" text NOT NULL,
	"order_type" text NOT NULL,
	"buy_index" integer,
	"side" text NOT NULL,
	"price" numeric(18, 8) NOT NULL,
	"quantity" numeric(18, 8) NOT NULL,
	"gross_value_usd" numeric(18, 2) NOT NULL,
	"fees_usd" numeric(18, 2) DEFAULT '0' NOT NULL,
	"slippage_usd" numeric(18, 2) DEFAULT '0' NOT NULL,
	"net_value_usd" numeric(18, 2) NOT NULL,
	"trigger_reason" text,
	"human_reason" text,
	"exchange_order_id" text,
	"executed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "institutional_dca_simulation_wallet" (
	"id" serial PRIMARY KEY NOT NULL,
	"initial_balance_usd" numeric(18, 2) DEFAULT '10000.00' NOT NULL,
	"available_balance_usd" numeric(18, 2) DEFAULT '10000.00' NOT NULL,
	"used_balance_usd" numeric(18, 2) DEFAULT '0' NOT NULL,
	"realized_pnl_usd" numeric(18, 2) DEFAULT '0' NOT NULL,
	"unrealized_pnl_usd" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_equity_usd" numeric(18, 2) DEFAULT '10000.00' NOT NULL,
	"total_cycles_simulated" integer DEFAULT 0 NOT NULL,
	"total_orders_simulated" integer DEFAULT 0 NOT NULL,
	"last_reset_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lot_matches" (
	"id" serial PRIMARY KEY NOT NULL,
	"sell_fill_txid" text NOT NULL,
	"lot_id" text NOT NULL,
	"matched_qty" numeric(18, 8) NOT NULL,
	"buy_price" numeric(18, 8) NOT NULL,
	"sell_price" numeric(18, 8) NOT NULL,
	"buy_fee_allocated" numeric(18, 8) NOT NULL,
	"sell_fee_allocated" numeric(18, 8) NOT NULL,
	"pnl_net" numeric(18, 8) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "lot_matches_sell_fill_txid_lot_id_unique" UNIQUE("sell_fill_txid","lot_id")
);
--> statement-breakpoint
CREATE TABLE "market_data" (
	"id" serial PRIMARY KEY NOT NULL,
	"pair" text NOT NULL,
	"price" numeric(18, 8) NOT NULL,
	"volume_24h" numeric(18, 2),
	"change_24h" numeric(10, 2),
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "master_backups" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"original_name" text,
	"type" text NOT NULL,
	"file_path" text NOT NULL,
	"size" text NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"marked_as_master_at" timestamp DEFAULT now() NOT NULL,
	"metrics" jsonb,
	"system_info" jsonb,
	"tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"priority" integer DEFAULT 10 NOT NULL,
	"protection" text DEFAULT 'permanent' NOT NULL,
	CONSTRAINT "master_backups_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"message" text NOT NULL,
	"telegram_sent" boolean DEFAULT false NOT NULL,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "open_positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"lot_id" text NOT NULL,
	"exchange" text DEFAULT 'kraken' NOT NULL,
	"pair" text NOT NULL,
	"entry_price" numeric(18, 8) NOT NULL,
	"amount" numeric(18, 8) NOT NULL,
	"qty_remaining" numeric(18, 8),
	"qty_filled" numeric(18, 8) DEFAULT '0',
	"highest_price" numeric(18, 8) NOT NULL,
	"trade_id" text,
	"kraken_order_id" text,
	"entry_strategy_id" text DEFAULT 'momentum_cycle' NOT NULL,
	"entry_signal_tf" text DEFAULT 'cycle' NOT NULL,
	"signal_confidence" numeric(5, 2),
	"signal_reason" text,
	"entry_mode" text,
	"config_snapshot_json" jsonb,
	"entry_fee" numeric(18, 8) DEFAULT '0',
	"sg_break_even_activated" boolean DEFAULT false,
	"sg_current_stop_price" numeric(18, 8),
	"sg_trailing_activated" boolean DEFAULT false,
	"sg_scale_out_done" boolean DEFAULT false,
	"time_stop_disabled" boolean DEFAULT false,
	"time_stop_expired_at" timestamp,
	"be_progressive_level" integer DEFAULT 0,
	"entry_context_json" jsonb,
	"status" text DEFAULT 'OPEN',
	"client_order_id" text,
	"venue_order_id" text,
	"order_intent_id" integer,
	"expected_amount" numeric(18, 8),
	"total_cost_quote" numeric(18, 8) DEFAULT '0',
	"total_amount_base" numeric(18, 8) DEFAULT '0',
	"average_entry_price" numeric(18, 8),
	"fill_count" integer DEFAULT 0,
	"last_fill_id" text,
	"first_fill_at" timestamp,
	"last_fill_at" timestamp,
	"opened_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "open_positions_lot_id_unique" UNIQUE("lot_id")
);
--> statement-breakpoint
CREATE TABLE "order_intents" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_order_id" text NOT NULL,
	"exchange" text NOT NULL,
	"pair" text NOT NULL,
	"side" text NOT NULL,
	"volume" numeric(18, 8) NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"exchange_order_id" text,
	"hybrid_guard_watch_id" integer,
	"hybrid_guard_reason" text,
	"matched_trade_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "order_intents_client_order_id_unique" UNIQUE("client_order_id")
);
--> statement-breakpoint
CREATE TABLE "regime_state" (
	"pair" text PRIMARY KEY NOT NULL,
	"current_regime" text DEFAULT 'TRANSITION' NOT NULL,
	"confirmed_at" timestamp,
	"last_notified_at" timestamp,
	"hold_until" timestamp,
	"transition_since" timestamp,
	"candidate_regime" text,
	"candidate_count" integer DEFAULT 0 NOT NULL,
	"last_params_hash" text,
	"last_reason_hash" text,
	"last_adx" numeric(5, 2),
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "server_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"level" text DEFAULT 'INFO' NOT NULL,
	"line" text NOT NULL,
	"is_error" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "telegram_chats" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"chat_id" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"alert_trades" boolean DEFAULT true NOT NULL,
	"alert_errors" boolean DEFAULT true NOT NULL,
	"alert_system" boolean DEFAULT true NOT NULL,
	"alert_balance" boolean DEFAULT false NOT NULL,
	"alert_heartbeat" boolean DEFAULT true NOT NULL,
	"alert_preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_stop_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"pair" text NOT NULL,
	"market" text DEFAULT 'spot' NOT NULL,
	"ttl_base_hours" numeric(8, 2) DEFAULT '36.00' NOT NULL,
	"factor_trend" numeric(5, 3) DEFAULT '1.200' NOT NULL,
	"factor_range" numeric(5, 3) DEFAULT '0.800' NOT NULL,
	"factor_transition" numeric(5, 3) DEFAULT '1.000' NOT NULL,
	"min_ttl_hours" numeric(8, 2) DEFAULT '4.00' NOT NULL,
	"max_ttl_hours" numeric(8, 2) DEFAULT '168.00' NOT NULL,
	"close_order_type" text DEFAULT 'market' NOT NULL,
	"limit_fallback_seconds" integer DEFAULT 30 NOT NULL,
	"telegram_alert_enabled" boolean DEFAULT true NOT NULL,
	"log_expiry_even_if_disabled" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "time_stop_config_pair_market_unique" UNIQUE("pair","market")
);
--> statement-breakpoint
CREATE TABLE "trade_fills" (
	"id" serial PRIMARY KEY NOT NULL,
	"txid" text NOT NULL,
	"order_id" text NOT NULL,
	"exchange" text DEFAULT 'kraken' NOT NULL,
	"pair" text NOT NULL,
	"type" text NOT NULL,
	"price" numeric(18, 8) NOT NULL,
	"amount" numeric(18, 8) NOT NULL,
	"cost" numeric(18, 8) NOT NULL,
	"fee" numeric(18, 8) NOT NULL,
	"matched" boolean DEFAULT false NOT NULL,
	"executed_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "trade_fills_txid_unique" UNIQUE("txid")
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" serial PRIMARY KEY NOT NULL,
	"trade_id" text NOT NULL,
	"exchange" text DEFAULT 'kraken' NOT NULL,
	"origin" text DEFAULT 'sync' NOT NULL,
	"executed_by_bot" boolean DEFAULT false,
	"order_intent_id" integer,
	"pair" text NOT NULL,
	"type" text NOT NULL,
	"price" numeric(18, 8) NOT NULL,
	"amount" numeric(18, 8) NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"kraken_order_id" text,
	"entry_price" numeric(18, 8),
	"realized_pnl_usd" numeric(18, 8),
	"realized_pnl_pct" numeric(10, 4),
	"executed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "trades_kraken_order_id_unique" UNIQUE("kraken_order_id"),
	CONSTRAINT "trades_exchange_pair_trade_id_unique" UNIQUE("exchange","pair","trade_id")
);
--> statement-breakpoint
CREATE TABLE "trading_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"config" jsonb NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "trading_config_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "trading_engine_controls" (
	"id" serial PRIMARY KEY NOT NULL,
	"normal_bot_enabled" boolean DEFAULT true NOT NULL,
	"institutional_dca_enabled" boolean DEFAULT false NOT NULL,
	"global_trading_pause" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_trades" (
	"id" serial PRIMARY KEY NOT NULL,
	"pair" text NOT NULL,
	"strategy_id" text,
	"buy_txid" text NOT NULL,
	"sell_txid" text,
	"sell_txids_json" jsonb,
	"entry_price" numeric(18, 8) NOT NULL,
	"exit_price" numeric(18, 8),
	"entry_amount" numeric(18, 8) NOT NULL,
	"exit_amount" numeric(18, 8),
	"qty_remaining" numeric(18, 8),
	"entry_fee" numeric(18, 8) DEFAULT '0' NOT NULL,
	"exit_fee" numeric(18, 8),
	"cost_usd" numeric(18, 8) NOT NULL,
	"revenue_usd" numeric(18, 8),
	"pnl_gross" numeric(18, 8),
	"pnl_net" numeric(18, 8),
	"pnl_pct" numeric(10, 4),
	"hold_time_minutes" integer,
	"label_win" integer,
	"features_json" jsonb,
	"discard_reason" text,
	"is_closed" boolean DEFAULT false NOT NULL,
	"is_labeled" boolean DEFAULT false NOT NULL,
	"entry_ts" timestamp NOT NULL,
	"exit_ts" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "training_trades_buy_txid_unique" UNIQUE("buy_txid")
);
