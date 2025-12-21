# KrakenBot - Autonomous Trading Bot

## Overview
KrakenBot is an autonomous cryptocurrency trading bot for the Kraken exchange. It features a web-based dashboard for monitoring, portfolio management (BTC, ETH, SOL, USD), and real-time Telegram notifications. Designed for 24/7 operation, it can be deployed on Replit or self-hosted via Docker. Its core purpose is to automate trading decisions based on predefined strategies and robust risk management, aiming to capitalize on market movements while protecting capital.

## User Preferences
- Preferred communication style: Simple, everyday language.
- **Entornos**: NAS es la fuente de verdad (producción y dataset IA). Replit solo para desarrollo y pruebas.
- **Sincronización**: No implementar export/import ni DB remota entre NAS y Replit.

## System Architecture

### Frontend
- **Framework**: React with TypeScript.
- **Styling**: Tailwind CSS, utilizing shadcn/ui components (New York style).
- **State Management**: TanStack React Query for server-side state.
- **Build**: Vite.
- **Real-time Events**: WebSocket-based event streaming and terminal logs to the Monitor page.

### Backend
- **Framework**: Express.js with TypeScript.
- **Runtime**: Node.js.
- **API**: RESTful endpoints (`/api/*`).
- **Services**: KrakenService for exchange interaction, TelegramService for notifications, AiService for ML filter.

### Data Storage
- **Database**: PostgreSQL with Drizzle ORM.
- **Schema**: Defined in `shared/schema.ts`.
- **Key Tables**: `bot_config`, `api_config`, `trades`, `notifications`, `open_positions`, `training_trades`, `ai_config`.

### Trading Engine
- **Core Loop**: Executes every 10-30 seconds for balance checks, resets, stop-loss/take-profit, and strategy analysis.
- **Strategies**: Momentum, Mean Reversion, Scalping, Grid Trading.
- **Multi-Timeframe Analysis (MTF)**: Analyzes 5-min, 1-hour, and 4-hour trends.
- **Trade Execution**: Market orders, database logging, position updates, Telegram notifications.
- **Position Modes**: SINGLE (one position per pair), DCA (multiple entries), and SMART_GUARD (intelligent capital protection).

### Risk Management
- **Filters**: Commission profitability, exposure control (per pair, total, per trade), bid-ask spread, trading hours.
- **Dynamic Adjustments**: Dynamic position sizing based on signal confidence.
- **Loss Control**: Stop-Loss/Take-Profit, Trailing Stop, Daily Loss Limit, Cooldown System.
- **Kraken Compliance**: Adherence to Kraken minimum trade volumes and real balance verification.
- **Position Persistence**: Open positions are stored in the database.
- **Configuration Snapshot**: New positions store a snapshot of trading parameters at entry.

### SMART_GUARD Mode
- **Purpose**: Intelligent capital protection with strict entry validation.
- **Signal SELL Blocking (A1/A2)**: SMART_GUARD bloquea ventas por señal de estrategia. Solo risk exits (SL/TP/trailing) pueden vender. Excepción: orphan cleanup cuando wallet balance > 0 sin posición trackeada.
- **MTF Entry Filter (B1)**: Señales de velas requieren que 2/3 timeframes (5m, 1h, 4h) confirmen tendencia.
- **Anti-FOMO Filter (B2)**: Bloquea BUY cuando RSI>65 + BollingerB>85 + bodyRatio>0.7 simultáneamente.
- **Min Signals Threshold (B3)**: Requiere ≥5 señales para BUY en SMART_GUARD mode.
- **sellContext Validation (C1)**: Todas las ventas requieren sellContext para trazabilidad de P&L excepto emergency exits (stop-loss/emergencia).
- **Sizing v2 (Auto Fallback)**:
  - `sgMinEntryUsd` es un "objetivo preferido", no un bloqueo.
  - Si `availableUsd >= sgMinEntryUsd` → orden = `sgMinEntryUsd` exacto (no más).
  - Si `availableUsd < sgMinEntryUsd` → orden = saldo disponible (fallback automático).
  - `floorUsd = max(minOrderExchangeUsd, $20)` → mínimo absoluto (hard block).
  - Si `availableUsd < floorUsd` → trade bloqueado.
  - **Fee Cushion**: Si `sgFeeCushionPct` o `sgFeeCushionAuto` activo, resta reserva para fees antes de sizing.
  - **sgAllowUnderMin DEPRECATED**: Ya no afecta el comportamiento (siempre fallback automático).
- **Reason Codes**:
  - `SMART_GUARD_ENTRY_USING_CONFIG_MIN`: Saldo suficiente, usa sgMinEntryUsd.
  - `SMART_GUARD_ENTRY_FALLBACK_TO_AVAILABLE`: Saldo insuficiente, usa saldo disponible.
  - `SMART_GUARD_BLOCKED_BELOW_EXCHANGE_MIN`: Saldo < floorUsd (hard block).
  - `SMART_GUARD_BLOCKED_AFTER_FEE_CUSHION`: Fee cushion reduce saldo por debajo de floorUsd.
- **Break-Even Protection**: Moves stop-loss to entry price + fees when profit reaches sgBeAtPct.
- **Trailing Stop**: Activates at sgTrailStartPct profit, follows at sgTrailDistancePct, updates at sgTrailStepPct steps.
- **Fixed Take-Profit**: Optional sgTpFixedPct for guaranteed profit capture.
- **Scale-Out**: Optional partial profit taking at sgScaleOutPct before fixed TP.
- **Per-Pair Overrides**: sgPairOverrides allows customizing parameters per trading pair via API and UI.
- **Diagnostic Endpoint**: GET /api/scan/diagnostic provides scan results with Spanish reasons.
- **Test Endpoint**: POST /api/test/sg-sizing para simular sizing v2 (solo en dev/dryRun).
- **Telegram Alerts**: Notifications for key events (Break-Even activation, Trailing Stop activation/updates, Scale-Out execution) with 5-min throttle on trailing updates.
- **Override API**: GET/PUT/DELETE /api/config/sg-overrides/:pair for managing per-pair parameters.
- **Event Types**: SG_BREAK_EVEN_ACTIVATED, SG_TRAILING_ACTIVATED, SG_TRAILING_STOP_UPDATED, SG_SCALE_OUT_EXECUTED, CONFIG_OVERRIDE_UPDATED.

### Environment Safety
- **DRY_RUN Mode**: Prevents real orders from being sent to exchange.
- **Auto-Detection**: Replit environment (REPLIT_DEPLOYMENT, REPL_ID) forces DRY_RUN automatically.
- **NAS Control**: On NAS, dryRunMode can be toggled via bot_config.
- **Simulation**: In DRY_RUN, executeTrade() logs events and sends "[DRY_RUN] Trade Simulado" Telegram messages without touching Kraken.
- **Production Safety**: NAS is the source of truth for production trading; Replit is development/testing only.

### FIFO Position Matching
- **Purpose**: Automatic position closing with partial fills tracking to eliminate "phantom positions."
- **Tables**:
  - `trade_fills`: Individual fills with UNIQUE(txid), matched flag for idempotency.
  - `lot_matches`: FIFO matching audit trail with UNIQUE(sellFillTxid, lotId).
  - `open_positions.qtyRemaining/qtyFilled`: Track partial consumption of buy lots.
- **FIFO Logic**:
  - Sell fills match against oldest buy lots first (ORDER BY openedAt ASC).
  - Uses SELECT FOR UPDATE within transaction to prevent concurrent double-consumption.
  - Pro-rates buy/sell fees based on matched quantity for accurate P&L.
- **Orphan Handling**: 
  - Fills only marked `matched=true` when fully processed (sellRemaining ≈ 0).
  - Orphan fills (no matching lots) remain unmatched for future retry.
- **API Endpoints**:
  - `POST /api/fifo/init-lots`: Initialize qtyRemaining = amount for existing lots.
  - `POST /api/fifo/process-sells`: Process all unmatched sell fills.
  - `POST /api/fifo/ingest-fill`: Ingest a new fill and trigger FIFO matching.
  - `GET /api/fifo/open-lots`: Get lots with qtyRemaining > 0.
- **Auto-Integration**: After each real sell execution in `executeTrade()`, the trading engine automatically:
  1. Creates a TradeFill record with txid, pair, price, amount, and estimated fee
  2. Triggers `fifoMatcher.processSellFill()` to match against open buy lots
  3. Logs matching results (lots closed, P&L, orphan qty)
  4. Only runs for real trades (DRY_RUN mode is safely bypassed with triple guard)
- **Transaction Safety**: All operations (lot select, match insert, qty update, fill mark) run within same tx handle.

### Confidence Normalization
- **Convention**: Interno (signals/positions) usa escala 0..1, Display (UI/Telegram/logs) y ML usa 0..100.
- **Helper**: `server/utils/confidence.ts` con `toConfidencePct()` y `toConfidenceUnit()`.
- **DB Loading**: Posiciones cargadas con `toConfidenceUnit()` para normalizar valores históricos.
- **Scale-Out**: Comparación y logs usan `toConfidencePct()` para mostrar "78%" no "0.78%".
- **AI Dataset**: Features siempre en 0..100 para consistencia del modelo.

### Strategy Meta Inheritance (SELL Labeling)
- **Purpose**: SELL trades inherit strategy metadata from the original position to ensure consistent labeling.
- **Autocompletion**: If `strategyMeta` is missing or incomplete in `executeTrade()`, it's auto-populated from the open position.
- **Multi-Lot Support**: Uses `getPositionsByPair()` and selects the oldest position (FIFO) for metadata.
- **Fields Inherited**: `entryStrategyId`, `entrySignalTf`, `signalConfidence` from the position.
- **Result**: SELL labeled as "Momentum (Velas 15m)" matches the BUY origin, not generic "Ciclos".

### P&L Tracking (Immediate SELL)
- **Purpose**: Every automatic SELL trade stores P&L at execution time, not just after sync.
- **executeTrade()**: Calculates and stores entryPrice, realizedPnlUsd, realizedPnlPct when sellContext.entryPrice is available.
- **Orphan Handling**: Emergency/orphan SELLs (no entryPrice) allowed but marked with `SELL_NO_ENTRYPRICE` and P&L fields = NULL.
- **Sync Upsert**: `/api/trades/sync` uses UPSERT by kraken_order_id:
  - If trade exists → UPDATE (preserving existing P&L, never overwriting)
  - If not exists → INSERT
- **Anti-Duplicates**: UNIQUE partial index on `trades.kraken_order_id WHERE NOT NULL`.

### AI Filter Module
- **Purpose**: Machine learning filter to approve/reject trade signals based on historical performance.
- **Phases**: Red (data collection), Yellow (ready to train), Green (filter active).
- **Training Data**: `training_trades` table stores BUY/SELL pairs with PnL labels. Backfill reconstructs data.
- **Discard Reasons**: Excludes invalid or anomalous trades from training data.
- **Diagnostic Metrics**: Provides aggregated counts of discard reasons and open trades/lots.

### Telegram Integration
- **Functionality**: Sends notifications for bot status, trade executions, risk management triggers, and errors.
- **Commands (Docker/NAS)**: Supports commands like `/estado`, `/pausar`, `/reanudar`.
- **Modes**: Polling for Docker/NAS deployments (commands), disabled for Replit (notifications only).
- **Features**: Rate limiting to prevent spam and multi-chat support.

## External Dependencies

- **Kraken Exchange API**:
    - **Package**: `node-kraken-api`.
    - **Purpose**: Trading operations (execute, fetch balances, market data).
    - **Configuration**: API key/secret stored in `api_config` table.

- **Telegram Bot API**:
    - **Package**: `node-telegram-bot-api`.
    - **Purpose**: Send notifications and receive commands.
    - **Configuration**: Bot token and chat ID stored in `api_config` table.

- **PostgreSQL Database**:
    - **ORM**: Drizzle ORM.
    - **Connection**: Via `DATABASE_URL` environment variable.
    - **Driver**: `pg`.