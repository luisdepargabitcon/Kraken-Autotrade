# KrakenBot - Autonomous Trading Bot

## Overview

KrakenBot is an autonomous cryptocurrency trading bot that connects to the Kraken exchange. It provides a web-based dashboard for monitoring trades, managing portfolio balances (BTC, ETH, SOL, USD), and receiving notifications via Telegram. The application is designed to run 24/7, either on Replit or self-hosted on a QNAP NAS using Docker.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript
- **Routing**: Wouter (lightweight router)
- **State Management**: TanStack React Query for server state
- **Styling**: Tailwind CSS with shadcn/ui components (New York style)
- **Build Tool**: Vite with custom plugins for Replit integration
- **UI Components**: Radix UI primitives with custom dashboard components

### Backend Architecture
- **Framework**: Express.js with TypeScript
- **Runtime**: Node.js with tsx for TypeScript execution
- **Build**: esbuild for production bundling with selective dependency bundling
- **API Structure**: RESTful endpoints under `/api/*` prefix
- **Services**: 
  - KrakenService: Handles Kraken exchange API integration for trading and balance queries
  - TelegramService: Sends notifications for trades and system status

### Data Storage
- **Database**: PostgreSQL with Drizzle ORM
- **Schema Location**: `shared/schema.ts`
- **Tables**: 
  - `bot_config`: Trading bot settings (strategy, risk level, active pairs)
  - `api_config`: API credentials for Kraken and Telegram
  - `trades`: Trade history and execution records
  - `notifications`: Telegram notification queue
  - `market_data`: Price and market information cache
  - `open_positions`: Posiciones abiertas persistentes (sobreviven reinicios)

### Project Structure
```
├── client/           # React frontend
│   ├── src/
│   │   ├── components/   # UI components (dashboard/, ui/)
│   │   ├── pages/        # Route pages (Dashboard, Settings, History)
│   │   ├── hooks/        # Custom React hooks
│   │   └── lib/          # Utilities and query client
├── server/           # Express backend
│   ├── services/     # External service integrations (kraken.ts, telegram.ts)
│   ├── routes.ts     # API route definitions
│   ├── storage.ts    # Database access layer
│   └── db.ts         # Database connection
├── shared/           # Shared types and schema
└── migrations/       # Drizzle database migrations
```

## External Dependencies

### Kraken Exchange API
- **Package**: `node-kraken-api`
- **Purpose**: Execute trades, fetch balances, get market data
- **Configuration**: API key and secret stored in `api_config` table
- **Features**: Public ticker data, authenticated trading operations
- **Nonce Handling**: Centralized retry wrapper with 3 attempts per operation
  - Uses microsecond timestamps with monotonic increment tracking
  - Logs include endpoint name and attempt count (e.g., `[kraken] Nonce error on 'addOrder', retrying (1/3)...`)
  - Failed operations (after 3 retries) trigger Telegram alert (max 1 per 30 min)
  - Alerts can be disabled via `nonceErrorAlertsEnabled` in bot config
  - Bot stays alive after failed operations (doesn't crash)

### Telegram Bot API
- **Package**: `node-telegram-bot-api`
- **Purpose**: Send trade notifications and system status alerts
- **Configuration**: Bot token and chat ID stored in `api_config` table
- **Mode**: 
  - **Replit**: Polling desactivado (solo envía notificaciones)
  - **Docker/NAS**: Polling activado automáticamente (recibe comandos)
- **Comandos disponibles**: `/estado`, `/pausar`, `/reanudar`, `/ultimas`, `/ayuda`
- **Detección automática**: Usa `DOCKER_ENV=true` o `NODE_ENV=production` para activar polling

## Motor de Trading (TradingEngine)

El motor de trading es el corazón del bot, ubicado en `server/services/tradingEngine.ts`. Gestiona todo el ciclo de vida de las operaciones de forma autónoma.

### Ciclo de Trading (`runTradingCycle`)

El bot ejecuta un ciclo cada 10-30 segundos (según estrategia):

1. **Obtener balance fresco**: Consulta Kraken API para obtener balances actualizados
2. **Reset diario**: A medianoche resetea el P&L diario y límites
3. **Verificar límite diario**: Si las pérdidas superan el límite, pausa nuevas compras
4. **Verificar Stop-Loss/Take-Profit**: Para cada posición abierta, evalúa si debe cerrar
5. **Analizar pares activos**: Para cada par, ejecuta la estrategia seleccionada
6. **Ejecutar trades**: Si hay señal válida con confianza > 60%, ejecuta la operación

### Estrategias Disponibles

- **Momentum**: Detecta tendencias fuertes usando RSI, volumen y cambio de precio
- **Mean Reversion**: Compra en sobreventas (RSI < 30), vende en sobrecompras (RSI > 70)
- **Scalping**: Operaciones rápidas aprovechando pequeños movimientos (ciclo 10s)
- **Grid Trading**: Coloca órdenes en niveles de precio predefinidos

### Análisis Multi-Timeframe (MTF)

El bot analiza 3 temporalidades simultáneamente:
- **5 minutos**: Tendencia corto plazo
- **1 hora**: Tendencia medio plazo
- **4 horas**: Tendencia largo plazo

Las señales se filtran según alineación de tendencias:
- Si compra pero 1h y 4h son bajistas → señal rechazada
- Si todas las tendencias coinciden → +15% confianza

### Ejecución de Trades (`executeTrade`)

Al ejecutar una operación:
1. Envía orden de mercado a Kraken
2. Guarda trade en base de datos con txid
3. Actualiza posición en memoria y BD
4. Calcula P&L si es venta
5. Envía notificación a Telegram
6. Registra evento en botLogger

---

## Gestión de Riesgo

### Filtro de Rentabilidad por Comisiones

El bot verifica que cada trade sea rentable después de comisiones antes de ejecutar:

| Parámetro | Valor | Descripción |
|-----------|-------|-------------|
| `KRAKEN_FEE_PCT` | 0.26% | Comisión taker por operación |
| `ROUND_TRIP_FEE_PCT` | 0.52% | Comisión total (compra + venta) |
| `MIN_PROFIT_MULTIPLIER` | 2x | Take-profit debe ser al menos 2x las fees |

**Cálculo:**
- Fees round-trip = 0.52%
- Take-profit mínimo rentable = 0.52% × 2 = **1.04%**
- Si take-profit configurado < 1.04% → trade rechazado

**Ejemplo:**
- Take-profit configurado: 0.8%
- Fees round-trip: 0.52%
- Ganancia neta esperada: 0.8% - 0.52% = 0.28%
- **RECHAZADO** (0.8% < 1.04% mínimo)

Con el take-profit por defecto (7%), el filtro no bloquea trades normales.

### Control de Exposición

Limita cuánto capital puede estar comprometido en posiciones abiertas:

| Parámetro | Default | Descripción |
|-----------|---------|-------------|
| `maxPairExposurePct` | 25% | Máximo por par individual |
| `maxTotalExposurePct` | 60% | Máximo total en todas las posiciones |
| `riskPerTradePct` | 15% | Porcentaje del balance por operación |

**Flujo de control de exposición:**
```
1. Calcular exposición actual (posiciones abiertas × precio entrada)
2. Calcular máximo disponible = min(límite_par - actual_par, límite_total - actual_total)
3. Si trade > máximo disponible:
   a. Si máximo < mínimo de Kraken → Cooldown 15 min, alerta Telegram (max 1/30min)
   b. Si máximo >= mínimo → Ajustar trade al máximo permitido
4. Ejecutar trade (original o ajustado)
5. Telegram muestra "📉 Ajustado por exposición" si fue reducido
```

### Stop-Loss y Take-Profit

Verificados en cada ciclo para todas las posiciones abiertas:

| Control | Funcionamiento |
|---------|----------------|
| **Stop-Loss** | Si precio cae X% desde entrada → venta automática |
| **Take-Profit** | Si precio sube X% desde entrada → venta automática |
| **Trailing Stop** | Stop-loss dinámico que sigue al precio. Si precio sube, el stop sube. Si cae X% desde máximo → venta |

**Ejemplo Trailing Stop:**
- Compra a $100, trailing 2%
- Precio sube a $110 → stop en $107.80 (2% bajo máximo)
- Precio sube a $120 → stop sube a $117.60
- Precio cae a $117 → VENTA (cayó >2% desde $120)

### Límite de Pérdida Diaria

Protección contra días de pérdidas excesivas:
- Configurable en UI (default 10%)
- Se calcula: `(P&L_diario / balance_inicial_día) × 100`
- Si supera límite negativo → pausa nuevas compras
- Stop-Loss y Take-Profit siguen activos (pueden cerrar posiciones)
- Reset automático a medianoche

### Sistema de Cooldown

Evita bucles infinitos cuando no hay exposición disponible:

| Cooldown | Duración | Trigger |
|----------|----------|---------|
| Par sin exposición | 15 min | Cuando `effectiveMaxAllowed < minRequiredUSD` |
| Saldo insuficiente | 15 min | Cuando `freshUsdBalance < minRequiredUSD` |
| Volumen bajo | 15 min | Cuando `tradeVolume < minVolume` |
| **Post Stop-Loss** | **30 min** | Cuando se activa un Stop-Loss en un par |

### Mejoras Defensivas

Filtros adicionales para proteger el capital:

#### 1. Filtro de Spread Bid-Ask
- **Constante**: `MAX_SPREAD_PCT = 0.5%`
- **Funcionamiento**: No comprar si el spread es mayor a 0.5%
- **Cálculo**: `spreadPct = (ask - bid) / midPrice × 100`
- **Beneficio**: Evita pérdidas inmediatas por spreads amplios

#### 2. Horarios de Trading
- **Constantes**: `TRADING_HOURS_START = 8` UTC, `TRADING_HOURS_END = 22` UTC
- **Funcionamiento**: Solo opera entre 8:00 y 22:00 UTC
- **Beneficio**: Evita slippage en horarios de bajo volumen
- **Nota**: Stop-Loss y Take-Profit siguen activos 24/7

#### 3. Position Sizing Dinámico
Ajusta el monto del trade según la confianza de la señal:

| Confianza | Factor | Resultado |
|-----------|--------|-----------|
| ≥ 80% | 100% | Trade completo |
| 70-79% | 75% | 3/4 del monto |
| 60-69% | 50% | Mitad del monto |
| < 60% | 0% | No trade |

#### 4. Cooldown Post Stop-Loss
- **Constante**: `POST_STOPLOSS_COOLDOWN_MS = 30 min`
- **Funcionamiento**: Tras un Stop-Loss, el par entra en cooldown de 30 minutos
- **Beneficio**: Evita "revenge trading" automatizado
- **Nota**: Independiente del cooldown normal de 15 min

### Mínimos de Kraken

El bot respeta los volúmenes mínimos de Kraken:
```
BTC/USD: 0.0001 BTC
ETH/USD: 0.01 ETH
SOL/USD: 0.1 SOL
XRP/USD: 10 XRP
TON/USD: 1 TON
```

### Persistencia de Posiciones

Las posiciones sobreviven reinicios del bot:
- **Al comprar**: Guarda par, cantidad, precio entrada, precio máximo, timestamp
- **Al vender parcialmente**: Actualiza cantidad restante
- **Al cerrar**: Elimina de BD
- **Al iniciar**: Carga todas las posiciones de la BD

---

## Sistema de Telegram

### Modos de Operación

| Entorno | Polling | Funcionalidad |
|---------|---------|---------------|
| Replit | Desactivado | Solo envía notificaciones |
| Docker/NAS | Activado | Envía notificaciones + recibe comandos |

Detección automática: `DOCKER_ENV=true` o `NODE_ENV=production`

### Comandos Disponibles (solo Docker)

| Comando | Descripción |
|---------|-------------|
| `/estado` | Muestra estado del bot, balance y posiciones |
| `/pausar` | Pausa el bot de trading |
| `/reanudar` | Reanuda el bot de trading |
| `/ultimas` | Muestra últimas 5 operaciones |
| `/ayuda` | Lista de comandos disponibles |

### Tipos de Notificaciones

| Evento | Emoji | Descripción |
|--------|-------|-------------|
| Bot iniciado | 🤖 | Estrategia, pares activos, balance |
| Bot detenido | 🛑 | Confirmación de parada |
| Compra ejecutada | 🟢 | Par, cantidad, precio, razón |
| Venta ejecutada | 🔴 | Par, cantidad, precio, P&L |
| Stop-Loss | 🛑 | Posición cerrada por pérdida |
| Take-Profit | 🎯 | Posición cerrada por ganancia |
| Trailing Stop | 📉 | Posición cerrada por retroceso |
| Límite diario | ⚠️ | Trading pausado por pérdidas |
| Par en cooldown | ⏸️ | Sin exposición disponible |
| Trade ajustado | 📉 | Monto reducido por exposición |
| Error nonce | ⚠️ | Problema con API Kraken |

### Rate Limiting de Alertas

Para evitar spam en Telegram:
- **Alertas de exposición**: Máximo 1 cada 30 minutos por par
- **Errores de nonce**: Máximo 1 cada 30 minutos
- **Cooldown de par**: Solo se notifica 1 vez, luego silencio hasta que se resuelva

### Múltiples Chats

El bot puede enviar a múltiples chats (separados por coma en config):
- Alertas de trades: Canal principal
- Alertas de sistema: Canal de sistema (opcional)

### PostgreSQL Database
- **ORM**: Drizzle ORM with `drizzle-kit` for migrations
- **Connection**: Via `DATABASE_URL` environment variable
- **Driver**: `pg` (node-postgres)

### Environment Variables Required
- `DATABASE_URL`: PostgreSQL connection string
- Kraken and Telegram credentials are stored in the database after initial setup through the Settings page

## Docker Deployment (QNAP NAS)

### Log Rotation Configuration
Los contenedores tienen configurada rotación automática de logs para evitar crecimiento ilimitado:

- **App container (kraken-bot-app)**:
  - max-size: 10MB por archivo
  - max-file: 3 archivos
  - Total máximo: 30MB

- **Database container (kraken-bot-db)**:
  - max-size: 5MB por archivo
  - max-file: 2 archivos
  - Total máximo: 10MB

### Comandos útiles
```bash
# Ver logs recientes
docker logs kraken-bot-app --tail 100

# Ver logs en tiempo real
docker logs -f kraken-bot-app

# Actualizar y reiniciar
cd /share/ZFS37_DATA/share/Container/krakenbot && git pull && /share/ZFS530_DATA/.qpkg/container-station/bin/docker compose up -d --build --force-recreate
```