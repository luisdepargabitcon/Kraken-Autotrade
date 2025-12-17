# KrakenBot - Autonomous Trading Bot

## Overview
KrakenBot is an autonomous cryptocurrency trading bot designed for the Kraken exchange. It features a web-based dashboard for monitoring trades, managing cryptocurrency portfolio balances (BTC, ETH, SOL, USD), and receiving real-time notifications via Telegram. The application is built for 24/7 operation, supporting deployment on Replit or self-hosting via Docker on a QNAP NAS. Its core purpose is to automate trading decisions based on predefined strategies and robust risk management, aiming to capitalize on market movements while protecting capital.

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

### Backend
- **Framework**: Express.js with TypeScript.
- **Runtime**: Node.js.
- **API**: RESTful endpoints (`/api/*`).
- **Services**: KrakenService for exchange interaction, TelegramService for notifications, AiService for ML filter.

### Data Storage
- **Database**: PostgreSQL with Drizzle ORM.
- **Schema**: Defined in `shared/schema.ts`.
- **Key Tables**: 
  - `bot_config` (trading settings)
  - `api_config` (credentials)
  - `trades` (history)
  - `notifications` (queue)
  - `open_positions` (persistent open trades)
  - `training_trades` (AI dataset - BUY/SELL pairs with PnL labels)
  - `ai_config` (AI filter settings and backfill state)

### Trading Engine
- **Core Loop**: Executes every 10-30 seconds, including balance checks, daily resets, stop-loss/take-profit evaluations, and strategy analysis.
- **Strategies**: Momentum, Mean Reversion, Scalping, Grid Trading.
- **Multi-Timeframe Analysis (MTF)**: Analyzes 5-min, 1-hour, and 4-hour trends to filter trade signals.
- **Trade Execution**: Market orders, database logging, position updates, Telegram notifications.
- **Position Mode**: SINGLE (one position per pair) or DCA (multiple entries allowed).

### Risk Management
- **Commission Profitability Filter**: Ensures trades are profitable after Kraken fees (min 1.04% take-profit).
- **Exposure Control**: Limits capital exposure per pair (25%) and total (60%), and risk per trade (15%). Dynamically adjusts trade size based on available exposure.
- **Stop-Loss/Take-Profit**: Automatic position closing based on price deviation.
- **Trailing Stop**: Dynamic stop-loss that follows price appreciation.
- **Daily Loss Limit**: Pauses new purchases if daily losses exceed a configured percentage (default 10%).
- **Cooldown System**: Implements cooldown periods (e.g., 15 min for no exposure, 30 min post Stop-Loss) to prevent rapid re-entry into losing conditions.
- **Defensive Filters**:
    - **Bid-Ask Spread**: Avoids trades if spread > 0.5%.
    - **Trading Hours**: Operates between 8:00 and 22:00 UTC to avoid low-volume periods.
    - **Dynamic Position Sizing**: Adjusts trade amount based on signal confidence (e.g., 100% for >80% confidence, 50% for 60-69%).
    - **Real Balance Verification**: Prevents "Insufficient funds" errors by verifying actual Kraken balances before selling and rectifying discrepancies.
- **Kraken Minimums**: Adheres to Kraken's minimum trade volumes for each asset.
- **Position Persistence**: Open positions are stored in the database to survive bot restarts.

### AI Filter Module
- **Purpose**: Machine learning filter to approve/reject trade signals based on historical performance.
- **Phases**: 
  - Red (collecting data)
  - Yellow (ready to train, 300+ samples)
  - Green (filter active)
- **Training Data Pipeline**:
  - `training_trades` table stores BUY/SELL pairs with FIFO matching
  - Backfill reconstructs dataset from `trades` table (idempotent operation)
  - Labels: `labelWin = 1` if PnL > 0, `labelWin = 0` otherwise
- **Discard Reasons** (trades excluded from training):
  - `venta_sin_compra_previa`: SELL without prior BUY (inventory from before bot)
  - `datos_invalidos`: Invalid price/amount data
  - `pnl_atipico`: PnL outlier (> 50%)
  - `hold_excesivo`: Hold time > 30 days
  - `comisiones_anormales`: Fee percentage outside 0.5-2.0%
  - `timestamps_invalidos`: Exit before entry
- **Diagnostic Metrics** (`GET /api/ai/diagnostic`):
  - `discardReasonsDataset`: Aggregated counts from `training_trades.discardReason` (persisted)
  - `lastBackfillDiscardReasons`: Counts from most recent backfill run (stored in `ai_config`)
  - `openTradesCount`: training_trades with isClosed=false
  - `openLotsCount`: training_trades with qtyRemaining > 0
- **Invariance Rule**: If `qtyRemaining <= epsilon` then `isClosed = true` (enforced at end of backfill)
- **Legacy Key Translation**: English keys from old backfills are translated to Spanish in diagnostic output via `LEGACY_KEY_MAP`

### Telegram Integration
- **Modes**: Polling activated for Docker/NAS deployments (receiving commands), disabled for Replit (sending notifications only).
- **Commands (Docker/NAS)**: `/estado`, `/pausar`, `/reanudar`, `/ultimas`, `/ayuda`.
- **Notifications**: Comprehensive alerts for bot status, trade executions, stop-loss/take-profit events, risk management triggers, and errors.
- **Rate Limiting**: Prevents alert spam (e.g., max 1 exposure alert per 30 mins).
- **Multi-Chat Support**: Sends notifications to multiple configured Telegram chats.

## External Dependencies

- **Kraken Exchange API**:
    - **Package**: `node-kraken-api`.
    - **Purpose**: Trading operations (execute, fetch balances, market data).
    - **Configuration**: API key/secret stored in `api_config` table.
    - **Nonce Handling**: Centralized retry mechanism (3 attempts) with Telegram alerts for persistent failures.

- **Telegram Bot API**:
    - **Package**: `node-telegram-bot-api`.
    - **Purpose**: Send notifications and receive commands.
    - **Configuration**: Bot token and chat ID stored in `api_config` table.

- **PostgreSQL Database**:
    - **ORM**: Drizzle ORM.
    - **Connection**: Via `DATABASE_URL` environment variable.
    - **Driver**: `pg`.

## Recent Changes (Dec 2025)

### WebSocket Connection Stability Fix (Dec 15, 2025)
- **Issue**: WebSocket connections closed immediately after opening with code 1006 (abnormal closure) in both Replit and NAS environments
- **Root Cause**: Proxy interference with WebSocket upgrade when using attached mode, and compression negotiation issues
- **Solution**:
  - Changed both `eventsWebSocket` and `terminalWebSocket` to use `noServer: true` mode
  - Created centralized upgrade handler in `routes.ts` that coordinates upgrades for both `/ws/events` and `/ws/logs` paths
  - Disabled `perMessageDeflate` compression on both WebSocket servers
  - Added `handleUpgrade()` method to both WebSocket service classes
- **Files Modified**: `server/routes.ts`, `server/services/eventsWebSocket.ts`, `server/services/terminalWebSocket.ts`
- **Additional Fixes**: Fixed Telegram Markdown parsing error by escaping special characters in position strategy names, fixed SelectItem empty value error in Monitor.tsx

### Monitor Real-Time Events (Dec 15, 2025)
- Added WebSocket-based real-time event streaming to Monitor page
- New event types for market scan visibility:
  - `ENGINE_TICK`: 60-second heartbeat with engine status (activePairs, openPositions, balanceUsd, dailyPnL)
  - `MARKET_SCAN_SUMMARY`: Compact summary of per-pair signals (signal, reason, cooldown, exposure)
  - `TRADE_SKIPPED`: Detailed event when signals are blocked (with reason code)
- TRADE_SKIPPED reasons include: PAIR_COOLDOWN, SINGLE_MODE_POSITION_EXISTS, STOPLOSS_COOLDOWN, SPREAD_TOO_HIGH, INSUFFICIENT_FUNDS, EXPOSURE_ZERO, POSITION_TOO_LARGE, LOW_PROFITABILITY, VOLUME_BELOW_MINIMUM, NO_POSITION
- Monitor page updated with filters for new event types
- Files modified: `server/services/tradingEngine.ts`, `client/src/pages/Monitor.tsx`

### WebSocket Context Provider (Dec 15, 2025)
- Centralized EventsWebSocket via React Context to avoid duplicate connections
- EventsWebSocketProvider wraps App, both Dashboard and Monitor share single WebSocket
- `useEventsFeed()` hook replaces direct useEventsWebSocket calls in components
- Fixed reconnection loop caused by useCallback dependency chain in hook

### Monitor Terminal Tab + WebSocket Improvements (Dec 15, 2025)
- **FASE 1 - Events WebSocket**:
  - `/ws/events` with `WS_ADMIN_TOKEN` authentication (optional in dev, required in prod)
  - Snapshot inicial (200 eventos) + streaming en tiempo real
  - EventsPanel.tsx ahora usa WebSocket (eliminado polling GET /api/events)
  - Indicador "Último mensaje HH:MM:SS" en Monitor
  - Follow tail (auto-scroll), Pause/Clear functionality
- **FASE 2 - Terminal WebSocket**:
  - `/ws/logs` con `TERMINAL_TOKEN` obligatorio
  - Tab "Terminal" en Monitor con selector de fuentes predefinidas
  - Solo fuentes en whitelist (no comandos libres):
    - `docker compose logs -f --tail=200` (si ENABLE_DOCKER_LOGS_STREAM=true)
    - `docker logs -f --tail=200 <container>` (krakenbot, krakenbot-db)
    - `tail -f <ruta_log>` (rutas fijas)
  - UX: auto-scroll, Pause/Resume, Clear, contador de líneas, último mensaje
- **Environment Variables**:
  - `WS_ADMIN_TOKEN`: Token para autenticar conexiones a /ws/events (opcional en Replit, requerido en NAS)
  - `TERMINAL_TOKEN`: Token obligatorio para /ws/logs
  - `ENABLE_DOCKER_LOGS_STREAM`: Habilita fuentes Docker (default: false)
- **Tokens en frontend**: Guardar en localStorage como `WS_ADMIN_TOKEN` y `TERMINAL_TOKEN`
- Files: `server/services/eventsWebSocket.ts`, `server/services/terminalWebSocket.ts`, `client/src/pages/Monitor.tsx`, `client/src/hooks/useTerminalWebSocket.ts`, `client/src/components/dashboard/EventsPanel.tsx`

### AI Diagnostic Metrics Unification
- Added `lastBackfillDiscardReasonsJson` field to `ai_config` table
- `runBackfill()` now persists discard reasons to `ai_config` for traceability
- `getDiagnostic()` returns both `discardReasonsDataset` (from DB) and `lastBackfillDiscardReasons` (from last run)
- Legacy English keys automatically translated to Spanish via `LEGACY_KEY_MAP`
- Invariance enforcement: qtyRemaining <= epsilon → normalize to 0 + isClosed=true
- SQL aggregate query for discard reasons (no 10k row limit)

### Position Config Snapshot (Dec 17, 2025)
- **Purpose**: New positions now store a snapshot of trading parameters (SL/TP/trailing) at entry time
- **Behavior**:
  - **New positions**: Save `entry_mode` + `config_snapshot_json` with effective parameters at entry
  - **Legacy positions**: Continue using current `botConfig` values (fallback)
  - **DCA entries**: Preserve original snapshot from first entry
- **Database Changes**: Added `entry_mode TEXT` + `config_snapshot_json JSONB` to `open_positions` table
- **ConfigSnapshot Fields**:
  - `stopLossPercent`: SL% at entry
  - `takeProfitPercent`: TP% at entry
  - `trailingStopEnabled`: boolean
  - `trailingStopPercent`: trailing% at entry
  - `positionMode`: SINGLE/DCA at entry
- **Logs**: 
  - At entry: `NEW POSITION: BTC/USD - snapshot saved (SL=5%, TP=7%, trailing=false, mode=SINGLE)`
  - At close: `Stop-Loss activado ... [snapshot (SINGLE)]` or `[current config (legacy)]`
- **Files Modified**: `shared/schema.ts`, `server/services/tradingEngine.ts`

### Files Modified
- `shared/schema.ts`: Added `lastBackfillDiscardReasonsJson` jsonb field, `entry_mode` + `config_snapshot_json` to open_positions
- `server/storage.ts`: Added `getDiscardReasonsDataset()`, invariance check
- `server/services/aiService.ts`: Added `LEGACY_KEY_MAP`, `translateDiscardReasons()`, save to aiConfig
- `server/services/tradingEngine.ts`: Added ConfigSnapshot interface, snapshot save/load/use logic
- `client/src/pages/Settings.tsx`: Updated interface and render to use new field names
