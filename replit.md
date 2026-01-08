# KrakenBot - Autonomous Trading Bot

## Overview
KrakenBot is an autonomous cryptocurrency trading bot for the Kraken exchange, designed for 24/7 operation. Its core purpose is to automate trading decisions based on predefined strategies and robust risk management, aiming to capitalize on market movements while protecting capital. It features a web-based dashboard for monitoring, portfolio management (BTC, ETH, SOL, USD), and real-time Telegram notifications. It can be deployed on Replit for development or self-hosted via Docker for production.

## User Preferences
- Preferred communication style: Simple, everyday language.
- **Entornos**: NAS es la fuente de verdad (producción y dataset IA). Replit solo para desarrollo y pruebas.
- **Sincronización**: No implementar export/import ni DB remota entre NAS y Replit.
- **NAS Docker**: Contenedor PostgreSQL se llama `kraken-bot-db`. Para ejecutar SQL: `docker exec -it kraken-bot-db psql -U krakenbot -d krakenbot -c "SQL_AQUI"`

## System Architecture

### Frontend
- **Framework**: React with TypeScript.
- **Styling**: Tailwind CSS, utilizing shadcn/ui components (New York style).
- **State Management**: TanStack React Query for server-side state.
- **Build**: Vite.
- **Real-time Events**: WebSocket-based event streaming and terminal logs.

### Backend
- **Framework**: Express.js with TypeScript.
- **Runtime**: Node.js.
- **API**: RESTful endpoints.
- **Services**: KrakenService, TelegramService, AiService.

### Data Storage
- **Database**: PostgreSQL with Drizzle ORM.
- **Schema**: Defined in `shared/schema.ts`.
- **Key Tables**: `bot_config`, `api_config`, `trades`, `notifications`, `open_positions`, `training_trades`, `ai_config`.

### Trading Engine
- **Core Loop**: Executes every 10-30 seconds for balance checks, resets, stop-loss/take-profit, and strategy analysis.
- **Strategies**: Momentum, Mean Reversion, Scalping, Grid Trading.
- **Multi-Timeframe Analysis (MTF)**: Analyzes 5-min, 1-hour, and 4-hour trends.
- **Position Modes**: SINGLE, DCA, and SMART_GUARD.
- **Risk Management**: Commission profitability filter, exposure control, bid-ask spread, trading hours, dynamic position sizing, Stop-Loss/Take-Profit, Trailing Stop, Daily Loss Limit, Cooldown System, Kraken compliance.
- **SMART_GUARD Mode**: Intelligent capital protection with strict entry validation, including MTF entry filter, Anti-FOMO filter, minimum signals threshold, and dynamic sizing (Sizing v2) with fee cushion. Includes Break-Even Protection, Trailing Stop, Fixed Take-Profit, and Scale-Out features. Per-pair overrides are supported.
- **Market Regime Detection**: Automatically adjusts SMART_GUARD exit parameters based on ADX, EMA alignment, and Bollinger Band width to detect TREND, RANGE, or TRANSITION regimes. Includes hysteresis, confirmation, and cooldown mechanisms to prevent oscillation and spam.
- **Adaptive Exit Engine (ATR-based, 2025-12-31)**: Dynamic SL/TP/Trail calculation using ATR (Average True Range) and regime detection. Features:
  - ATR multipliers per regime: TREND (SL×2, TP×3, Trail×1.5), RANGE (SL×1, TP×1.5, Trail×0.75), TRANSITION (SL×1.5, TP×2, Trail×1)
  - Fee-aware TP floor: Minimum TP = 1.80% (0.40% taker × 2 legs + 1.00% buffer)
  - Safety floors: SL min 2%, Trail min 0.75%, Ceilings: SL 8%, TP 15%, Trail 4%
  - Fallback to static presets when ATR data insufficient (<14 periods)
  - Logs tagged `[ATR_EXIT]` and `[ATR_SNAPSHOT]` for debugging
- **Environment Safety**: DRY_RUN mode prevents real orders, automatically enabled on Replit.
- **FIFO Position Matching**: Automatic position closing with partial fills tracking using `trade_fills` and `lot_matches` tables, ensuring accurate P&L and eliminating phantom positions.
- **Confidence Normalization**: Internally uses 0..1 scale, displays and ML use 0..100.
- **Strategy Meta Inheritance**: SELL trades inherit strategy metadata from the original position for consistent labeling.
- **P&L Tracking**: Immediate P&L calculation and storage for every automatic SELL trade at execution time.
- **AI Filter Module**: Machine learning filter to approve/reject trade signals based on historical performance, operating in Red (data collection), Yellow (ready to train), and Green (filter active) phases.

### Telegram Integration
- **Functionality**: Sends notifications for bot status, trade executions, risk management triggers, and errors.
- **Commands**: Supported on Docker/NAS for `/estado`, `/pausar`, `/reanudar`, `/balance`, `/config`, `/exposicion`, `/uptime`, `/ultimas`, `/ayuda`, `/menu`, `/channels`.
- **Features**: Rate limiting, multi-chat support, inline keyboard buttons, daily reports, and channel management.
- **Security**: HTML formatting with `escapeHtml()` helper to prevent markup injection.
- **Natural Language Messages (2025-12-31)**: All trade notifications use conversational Spanish:
  - BUY: "Nueva compra de BTC - He comprado $X de BTC a $Y. Mercado en tendencia alcista, confianza alta (85%)."
  - SELL (Take-Profit): "Take-Profit en BTC - ¡Objetivo cumplido! Ganancia de +$45.32 (+3.5%)."
  - SELL (Stop-Loss): "Stop-Loss en ETH - Pérdida limitada a -$12.50 (-2.1%)."
  - SMART_GUARD events: "Protección activada en BTC - Tu posición ya está en ganancias (+2.5%). He movido el stop a break-even."
  - All messages include essential data: prices, P&L, lot IDs, duration, and panel link.

### Notifications Page (2025-12-31)
- **New Page**: `/notifications` - Gestión completa de canales Telegram y cooldowns.
- **Per-Chat Alert Policies**: Cada canal puede configurar qué alertas recibe:
  - `alertTrades`: Operaciones BUY/SELL
  - `alertErrors`: Errores de API, nonce
  - `alertSystem`: Bot iniciado/pausado
  - `alertBalance`: Alertas de exposición
  - `alertHeartbeat`: Verificación periódica de actividad
- **Granular Preferences (2026-01-01)**: Campo jsonb `alertPreferences` permite control fino:
  - **Trades**: trade_buy, trade_sell, trade_stoploss, trade_takeprofit, trade_breakeven, trade_trailing, trade_daily_pnl
  - **Strategy**: strategy_regime_change, strategy_router_transition
  - **System**: system_bot_started, system_bot_paused
  - **Errors**: error_api, error_nonce
  - **Balance**: balance_exposure
  - **Heartbeat**: heartbeat_periodic
  - Lógica: Si el subtype está definido en alertPreferences, usa ese valor. Si no, fallback a categoría legacy (alertTrades, alertErrors, etc.)
- **Configurable Cooldowns** (en `bot_config`):
  - `notifCooldownStopUpdated`: 60s default - Para actualizaciones de trailing stop
  - `notifCooldownRegimeChange`: 300s default - Para cambios de régimen de mercado
  - `notifCooldownHeartbeat`: 3600s default - Para mensajes de heartbeat
  - `notifCooldownTrades`: 0s default - Sin límite para trades
  - `notifCooldownErrors`: 60s default - Para alertas de error
- **Spam Prevention**: El sistema respeta los flags por chat y aplica cooldowns para evitar mensajes repetitivos.

### Quote Currency Validation
- **Purpose**: Blocks trades on non-USD pairs, allowing only "USD" quoted pairs.

## External Dependencies

-   **Kraken Exchange API**:
    -   **Package**: `node-kraken-api`.
    -   **Purpose**: Trading operations (execute, fetch balances, market data).
-   **Telegram Bot API**:
    -   **Package**: `node-telegram-bot-api`.
    -   **Purpose**: Send notifications and receive commands.
-   **PostgreSQL Database**:
    -   **ORM**: Drizzle ORM.
    -   **Driver**: `pg`.

### Regime Router (FASE 1 - IMPLEMENTADO 2025-12-26)
**Objetivo**: Permitir operar en mercados laterales (RANGE) y transición (TRANSITION) donde antes el bot pausaba.

**Implementación completada:**
1. `regimeRouterEnabled` toggle reversible (OFF por defecto, activable desde Dashboard)
2. Routing table:
   - TREND → momentum_candles_15m (sin cambios)
   - RANGE → mean_reversion_simple (BB(20,2) + RSI ≤35 BUY, SELL deshabilitado)
   - TRANSITION → momentum_candles_15m + sizing 50%
3. Parámetros configurables: rangeCooldownMinutes, transitionSizeFactor, transitionCooldownMinutes, transitionBeAtPct, transitionTrailStartPct, transitionTpPct
4. Mean Reversion Simple: Solo BUY (RSI ≤35 + cerca de Bollinger Lower), SELL deshabilitado para evitar conflicto con SMART_GUARD
5. Anti-oscilación: Histéresis (umbrales diferentes entrada/salida), Confirmación (2 lecturas consecutivas), Minimum Hold (15 min), Cooldown (60 seg)

**Archivos modificados:**
- `server/services/tradingEngine.ts` - Lógica del Router + estrategia mean_reversion_simple
- `shared/schema.ts` - Campos del Router en bot_config
- `client/src/pages/Settings.tsx` - Controles UI del Router
- `server/services/telegram.ts` - Alertas BUY con régimen/router, alerta inicio con estado Router

**Telegram Router Integration (2025-12-26):**
- BUY notifications include: 🧭 Régimen (TREND/RANGE/TRANSITION), regimeReason, 🔄 Router Strategy
- Bot Started notifications show Router status (ACTIVO/INACTIVO)
- Fields only shown when Router enabled and regime detection active

## Exit System Priority Hierarchy (2025-12-31)

When multiple exit systems are active, they follow this priority order:

```
1. EMERGENCIES (always win)
   └── Stop-Loss, Emergency SL, Daily Loss Limit
   
2. ADAPTIVE EXIT ENGINE (if enabled)
   └── Calculates SL/TP/Trail/BE dynamically based on ATR + regime
   └── OVERRIDES manual SMART_GUARD values
   └── Falls back to static presets if ATR data insufficient
   
3. SMART_GUARD (position protection)
   └── Uses ATR values when Adaptive Exit is ON
   └── Uses manual values when Adaptive Exit is OFF
   
4. TIME-STOP (last resort)
   └── Acts only after position exceeds configured hours
   └── SOFT mode: only closes if profit covers fees
   └── HARD mode: closes regardless of P&L
```

**Key behavior**: When Adaptive Exit is ON, manual fields (BE%, Trail%, TP%) are hidden in UI because they're automatically calculated. Only fee configuration (Taker %, Buffer %) and Time-Stop settings remain visible.

## Pending Features (FASE 2)

### Regime Router - Mejoras pendientes
- TRANSITION cooldown configurable (transitionCooldownMinutes)
- TRANSITION overrides completos para exits (BE/Trailing/TP)
- Mean Reversion SELL (requiere cambio en SMART_GUARD sell-flow)

### Multi-Exchange Support (FASE 1 - IMPLEMENTADO 2026-01-08)
**Objetivo**: Permitir usar múltiples exchanges (Kraken + Revolut X) para trading.

**Implementación completada:**
1. **IExchangeService interface**: Abstracción común para todos los exchanges en `server/services/exchanges/IExchangeService.ts`
2. **RevolutXService**: Implementación para Revolut X con autenticación Ed25519 en `server/services/exchanges/RevolutXService.ts`
3. **ExchangeFactory**: Selector dinámico de exchange en `server/services/exchanges/ExchangeFactory.ts`
4. **Schema**: Campos añadidos en `api_config`: `revolutxApiKey`, `revolutxPrivateKey`, `revolutxConnected`, `revolutxEnabled`, `krakenEnabled`, `activeExchange`
5. **UI**: Página de Integraciones actualizada con tarjeta Revolut X y selector de exchange activo
6. **API Routes**: Nuevos endpoints `/api/config/revolutx` y `/api/config/active-exchange`

**Configuración:**
- **Kraken**: Default, siempre activo, fees 0.40% taker / 0.25% maker
- **Revolut X**: Opcional, requiere cuenta Business, fees 0.09% taker / 0.00% maker (77% más barato)
- Solo un exchange activo a la vez
- Al menos un exchange debe estar habilitado

**Seguridad:**
- Credenciales almacenadas en base de datos, nunca en código
- Validación al cambiar exchange activo (debe estar conectado primero)
- DRY_RUN automático en Replit

**Pendiente (FASE 2):**
- Integración completa con TradingEngine para usar exchange dinámico en operaciones
- Testing con cuenta real de Revolut X
- Documentación API Revolut X detallada