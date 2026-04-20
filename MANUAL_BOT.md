# 📖 MANUAL DEL BOT - WINDSURF CHESTER BOT

> **Fuente de verdad** para descripción funcional del bot: arquitectura, configuración, operación y troubleshooting.  
> Para registro de cambios e incidentes, ver `BITACORA.md`.

---

## 1. QUÉ ES EL BOT Y OBJETIVOS

### Descripción
**KrakenBot** (Windsurf Chester Bot) es un bot de trading autónomo de criptomonedas diseñado para operación 24/7 en exchanges Kraken y Revolut X. Automatiza decisiones de trading, ejecuta estrategias predefinidas y gestiona riesgo.

### Objetivos
- Automatizar trading de criptomonedas (BTC, ETH, SOL, TON, etc.)
- Gestionar riesgo con múltiples capas de protección
- Proporcionar trazabilidad completa de operaciones
- Notificar en tiempo real vía Telegram
- Ofrecer dashboard web para monitorización

### Entornos
| Entorno | Ubicación | Puerto | Propósito |
|---------|-----------|--------|-----------|
| **NAS** | `192.168.1.104` | 3000 | Producción (fuente de verdad) |
| **VPS/STG** | `5.250.184.18` | 3020 | Staging (pruebas con dinero real) |
| **Local** | `localhost` | 5000 | Desarrollo |

---

## 2. EXCHANGES SOPORTADOS

### Kraken
- **Uso**: Datos de mercado (OHLC, tickers)
- **API**: REST + WebSocket
- **Fees**: ~0.26% taker

### Revolut X
- **Uso**: Trading (órdenes, balances)
- **API**: REST (requiere IP whitelist)
- **Fees**: ~0.09% taker
- **Limitaciones**: Sin endpoints públicos de market data (ticker, orderbook)

### Arquitectura Multi-Exchange
```
┌─────────────────┐     ┌─────────────────┐
│   Kraken API    │     │  Revolut X API  │
│  (Market Data)  │     │    (Trading)    │
└────────┬────────┘     └────────┬────────┘
         │                       │
         ▼                       ▼
┌─────────────────────────────────────────┐
│         IExchangeService Interface      │
│  ┌─────────────┐   ┌─────────────────┐  │
│  │KrakenService│   │RevolutXService  │  │
│  └─────────────┘   └─────────────────┘  │
└─────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────┐
│            Trading Engine               │
└─────────────────────────────────────────┘
```

---

## 3. ARQUITECTURA

### Stack Tecnológico
| Componente | Tecnología |
|------------|------------|
| **Frontend** | React + TypeScript + Vite |
| **Styling** | Tailwind CSS + shadcn/ui |
| **Backend** | Express.js + TypeScript |
| **Database** | PostgreSQL + Drizzle ORM |
| **Runtime** | Node.js 20 |
| **Deploy** | Docker + Docker Compose |

### Estructura de Directorios
```
/
├── client/                 # Frontend React
│   └── src/
│       ├── components/     # Componentes UI
│       ├── pages/          # Páginas principales
│       └── hooks/          # Custom hooks
├── server/                 # Backend Express
│   ├── services/           # Servicios core
│   │   ├── tradingEngine.ts    # Motor de trading
│   │   ├── exchanges/          # Adapters de exchanges
│   │   ├── telegram.ts         # Notificaciones
│   │   └── botLogger.ts        # Logging estructurado
│   ├── routes.ts           # Endpoints API
│   └── storage.ts          # Capa de datos
├── shared/                 # Código compartido
│   └── schema.ts           # Esquema DB (Drizzle)
├── scripts/                # Scripts de utilidad
└── db/migrations/          # Migraciones SQL
```

### Servicios Principales
| Servicio | Responsabilidad |
|----------|-----------------|
| `TradingEngine` | Motor principal: análisis, señales, ejecución |
| `KrakenService` | Adapter para Kraken API |
| `RevolutXService` | Adapter para Revolut X API |
| `TelegramService` | Notificaciones y comandos |
| `ConfigService` | Configuración dinámica |
| `BackupService` | Backups de DB y código |
| `BotLogger` | Logging estructurado a DB |

---

## 4. SMART-GUARD (Sistema de Protección)

### Descripción
Smart-Guard es el sistema de protección inteligente de capital que gestiona posiciones con múltiples capas de seguridad.

### Componentes

#### 4.1 Break-Even (BE)
- **Activación**: Cuando ganancia >= `sgBeAtPct` (default: 1.5%)
- **Efecto**: Stop-loss se mueve a precio de entrada + fees
- **Flag DB**: `sg_break_even_activated`

#### 4.2 Trailing Stop
- **Activación**: Cuando ganancia >= `sgTrailStartPct` (default: 2%)
- **Distancia**: `sgTrailDistancePct` (default: 1.5%)
- **Step**: `sgTrailStepPct` (default: 0.25%)
- **Flag DB**: `sg_trailing_activated`, `sg_current_stop_price`

#### 4.3 Take-Profit Fijo
- **Activación**: Si `sgTpFixedEnabled = true`
- **Nivel**: `sgTpFixedPct` (default: 10%)

#### 4.4 Scale-Out
- **Activación**: Si `sgScaleOutEnabled = true`
- **Porcentaje**: `sgScaleOutPct` (default: 35%)
- **Threshold**: `sgScaleOutThreshold` (default: 80%)
- **Flag DB**: `sg_scale_out_done`

#### 4.5 Time-Stop
- **Activación**: Posición abierta > X horas sin alcanzar BE
- **Flag DB**: `time_stop_disabled`, `time_stop_expired_at`

### Config Snapshot
Cada posición guarda un snapshot de la configuración al momento de entrada:
```json
{
  "stopLossPercent": 5,
  "takeProfitPercent": 7,
  "sgBeAtPct": 1.5,
  "sgTrailStartPct": 2,
  "sgTrailDistancePct": 1.5,
  "sgTpFixedEnabled": false,
  "positionMode": "SMART_GUARD"
}
```

### Estados Persistidos en DB
| Campo | Tipo | Descripción |
|-------|------|-------------|
| `config_snapshot_json` | JSONB | Snapshot de config al entry |
| `entry_mode` | TEXT | SINGLE, DCA, SMART_GUARD |
| `sg_break_even_activated` | BOOLEAN | BE activado |
| `sg_trailing_activated` | BOOLEAN | Trailing activado |
| `sg_current_stop_price` | DECIMAL | Precio actual del stop |
| `sg_scale_out_done` | BOOLEAN | Scale-out ejecutado |

### Eventos de Auditoría
| Evento | Descripción |
|--------|-------------|
| `SG_SNAPSHOT_BACKFILLED` | Snapshot creado para posición legacy |
| `SG_BE_ACTIVATED` | Break-even activado |
| `SG_TRAIL_ACTIVATED` | Trailing stop activado |
| `SG_STOP_UPDATED` | Stop price actualizado |
| `SG_EXIT_TRIGGERED` | Salida ejecutada por Smart-Guard |

---

## 5. CONFIGURACIÓN

### Variables de Entorno
```bash
# Base de datos (VPS Staging — contenedor krakenbot-staging-db)
DATABASE_URL=postgresql://krakenstaging:Kr4k3n_St4g1ng_2026!@krakenbot-staging-db:5432/krakenbot_staging
POSTGRES_USER=krakenstaging
POSTGRES_PASSWORD=Kr4k3n_St4g1ng_2026!
POSTGRES_DB=krakenbot_staging

# Trading
TRADING_ENABLED=true
TRADING_EXCHANGE=revolutx
DRY_RUN_MODE=false

# RevolutX
REVOLUTX_SYNC_ENABLED=true  # Solo en VPS con IP whitelist

# Backups
BACKUP_DIR=/app/backups
BACKUP_SCRIPTS_DIR=/app/scripts
```

### Acceso a PostgreSQL en VPS (Staging)
```bash
# Conectar a la DB (desde el host del VPS)
docker exec krakenbot-staging-db psql -U krakenstaging -d krakenbot_staging

# Consulta directa
docker exec krakenbot-staging-db psql -U krakenstaging -d krakenbot_staging -c "SELECT ..."

# Ejemplos útiles
docker exec krakenbot-staging-db psql -U krakenstaging -d krakenbot_staging -c "SELECT pair, anchor_price, set_at FROM idca_vwap_anchors;"
docker exec krakenbot-staging-db psql -U krakenstaging -d krakenbot_staging -c "\dt"
```

### Presets de Configuración
| Preset | Señales | Riesgo | Exposición |
|--------|---------|--------|------------|
| **Conservative** | TREND=6, RANGE=7 | 1% | 30% total, 10% par |
| **Balanced** | TREND=5, RANGE=6 | 2% | 50% total, 20% par |
| **Aggressive** | TREND=4, RANGE=5 | 3% | 70% total, 30% par |

### Configuración Smart-Guard (Defaults)
| Parámetro | Default | Descripción |
|-----------|---------|-------------|
| `sgMinEntryUsd` | 100 | Mínimo USD por entrada |
| `sgAllowUnderMin` | true | Permitir entradas bajo mínimo |
| `sgBeAtPct` | 1.5 | % ganancia para activar BE |
| `sgFeeCushionPct` | 0.45 | Colchón de fees |
| `sgTrailStartPct` | 2 | % ganancia para iniciar trailing |
| `sgTrailDistancePct` | 1.5 | Distancia del trailing stop |
| `sgTrailStepPct` | 0.25 | Step mínimo de actualización |
| `sgTpFixedEnabled` | false | TP fijo habilitado |
| `sgTpFixedPct` | 10 | % de TP fijo |

---

## 6. ENDPOINTS PRINCIPALES

### Trading
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/bot-status` | Estado del bot |
| POST | `/api/bot/start` | Iniciar bot |
| POST | `/api/bot/stop` | Detener bot |
| GET | `/api/open-positions` | Posiciones abiertas |
| POST | `/api/positions/:pair/close` | Cerrar posición |

### Trades y Sync
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/trades` | Historial de trades |
| POST | `/api/trades/sync-revolutx` | Sync trades RevolutX (solo importa trades) |
| POST | `/api/positions/reconcile` | Reconciliar posiciones del bot |

### Configuración
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/config` | Config activa |
| POST | `/api/config` | Crear config |
| POST | `/api/config/:id/activate` | Activar config |
| GET | `/api/config/presets` | Listar presets |
| POST | `/api/config/presets/:name/activate` | Activar preset |

### Backups
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/backups` | Listar backups |
| POST | `/api/backups` | Crear backup |
| POST | `/api/backups/:id/restore` | Restaurar backup |

---

## 7. JOBS / CRON

### Sync RevolutX (Automático)
- **Frecuencia**: Cada 6 horas
- **Endpoint**: `POST /api/trades/sync-revolutx`
- **Función**: Importa trades ejecutados en RevolutX (solo tabla `trades`, nunca crea posiciones)

### Purga de Eventos (Manual/Cron)
- **Frecuencia recomendada**: Diario a las 03:30 UTC
- **Endpoint**: `POST /api/admin/purge-events`
- **Script**: `scripts/purge-events.sh`
- **Función**: Elimina eventos de `bot_events` con más de 7 días de antigüedad

**Configurar cron en VPS:**
```bash
# Editar crontab
crontab -e

# Añadir línea (03:30 UTC diario)
30 3 * * * /opt/krakenbot-staging/scripts/purge-events.sh >> /var/log/krakenbot-purge.log 2>&1
```

**Ejecutar manualmente:**
```bash
# DryRun (ver qué se borraría)
curl -X POST "http://127.0.0.1:3020/api/admin/purge-events" \
  -H "Content-Type: application/json" \
  -d '{"retentionDays":7,"dryRun":true}'

# Purga real
curl -X POST "http://127.0.0.1:3020/api/admin/purge-events" \
  -H "Content-Type: application/json" \
  -d '{"retentionDays":7,"dryRun":false,"confirm":true}'
```

### Reporte Diario
- **Frecuencia**: Diario a las 08:00
- **Función**: Envía resumen de P&L y posiciones a Telegram

### Heartbeat
- **Frecuencia**: Cada 5 minutos
- **Función**: Verifica que el bot está activo

### Trading Cycle
- **Frecuencia**: Cada 10-30 segundos (según estrategia)
- **Función**: Análisis de mercado y ejecución de trades

### Crear Índices DB (Una vez post-deploy)
- **Endpoint**: `POST /api/admin/create-indexes`
- **Función**: Crea índices para optimizar queries de eventos, trades y posiciones

```bash
curl -X POST "http://127.0.0.1:3020/api/admin/create-indexes"
```

Índices creados:
- `idx_bot_events_ts` — Acelera filtrado de eventos por fecha
- `idx_trades_executed_at` — Acelera historial de trades
- `idx_open_positions_exchange` — Acelera queries por exchange

---

## 8. OPERACIÓN

### Deploy en VPS
```bash
cd /opt/krakenbot-staging
git pull origin main
docker compose -f docker-compose.staging.yml up -d --build --force-recreate
```

### Ver Logs
```bash
# Logs en tiempo real
docker logs -f krakenbot-staging-app

# Filtrar por tipo
docker logs krakenbot-staging-app | grep -i "error\|ORDER\|SG_"
```

### Reiniciar Bot
```bash
docker restart krakenbot-staging-app
```

### Acceso a DB
```bash
docker exec -it krakenbot-staging-db psql -U krakenstaging -d krakenbot_staging
```

### Backup Manual
```bash
# Backup completo
/opt/krakenbot-staging/scripts/backup-full.sh golden_backup_name

# Solo DB
/opt/krakenbot-staging/scripts/backup-database.sh pre_deploy
```

### Restore
```bash
/opt/krakenbot-staging/scripts/restore-database.sh backup_name
```

### Rollback de Código
```bash
git revert <commit_hash>
docker compose -f docker-compose.staging.yml up -d --build
```

---

## 9. TROUBLESHOOTING

### Bot no compra
**Causas comunes:**
1. **Exposición al límite**: Verificar `maxTotalExposurePct`
2. **Señales insuficientes**: Verificar `minSignals` por régimen
3. **DRY_RUN activo**: Verificar `dry_run_mode` en DB
4. **Balance insuficiente**: Verificar balance en exchange

**Diagnóstico:**
```sql
SELECT * FROM bot_events 
WHERE type = 'TRADE_SKIPPED' 
ORDER BY timestamp DESC LIMIT 20;
```

### Posiciones sin Smart-Guard
**Síntoma:** `sg_break_even_activated = false` permanentemente

**Causa:** Posición sin `config_snapshot_json` (no es posición del bot)

**Fix:** Solo las posiciones del bot (engine-managed) tienen Smart-Guard

### Sync RevolutX falla (403)
**Causa:** `REVOLUTX_SYNC_ENABLED` no configurado

**Fix:** Añadir en `docker-compose.staging.yml`:
```yaml
environment:
  - REVOLUTX_SYNC_ENABLED=true
```

### Telegram no envía notificaciones
**Diagnóstico:**
```sql
SELECT * FROM bot_events 
WHERE type IN ('NOTIFICATION_SENT', 'NOTIFICATION_FAILED') 
ORDER BY timestamp DESC LIMIT 10;
```

**Causas:**
1. Token inválido
2. Chat ID incorrecto
3. Bot no iniciado en chat

### Precio muestra $0.00
**Causa:** RevolutX no tiene endpoint de ticker

**Solución:** El bot usa Kraken para precios (ya implementado)

### SELLs de RevolutX no aparecen en UI
**Causa:** La UI muestra trades paginados (20 por página). Los SELLs antiguos están en páginas posteriores.

**Solución:** 
- Usar filtro de tipo "Sell" en la UI
- Hacer scroll hacia abajo para ver trades más antiguos
- El endpoint `/api/trades/closed` funciona correctamente

---

## 10. COMANDOS TELEGRAM

| Comando | Descripción |
|---------|-------------|
| `/estado` | Estado actual del bot |
| `/balance` | Balances por exchange |
| `/balance all` | Balances de todos los exchanges |
| `/cartera` | Valoración USD del portfolio |
| `/ganancias` | P&L total y por período |
| `/ultimas` | Últimas operaciones |
| `/logs` | Logs recientes |
| `/logs 50` | Últimos 50 logs |
| `/pausar` | Pausar/reanudar bot |
| `/config` | Configuración actual |

---

## 11. REGLA FUNDAMENTAL: POSICIONES DEL BOT

### open_positions = solo posiciones del bot

**Principio básico:**
- La tabla `open_positions` contiene únicamente posiciones abiertas por el bot (engine)
- NUNCA refleja balances externos del exchange
- NUNCA "adopta" holdings existentes

### Implicaciones:

**Sync de RevolutX:**
- Solo importa trades a la tabla `trades`
- NUNCA crea/modifica `open_positions`

**Reconcile:**
- Elimina posiciones del bot si balance real = 0
- Actualiza qty solo de posiciones del bot (con configSnapshot)
- PROHIBIDO crear posiciones desde balances externos

**Smart-Guard:**
- Solo gestiona posiciones del bot (engine-managed)
- Ignora posiciones sin configSnapshot o con prefijos especiales

Esta regla previene:
- Venta accidental de holdings personales
- "Resurrección" de posiciones vendidas
- Inflado de posiciones con balances externos

---

## 12. SEGURIDAD

### API Keys
- **NUNCA** activar permisos de retiro en Kraken
- Revolut X requiere IP whitelist
- API keys almacenadas encriptadas en DB

### DRY_RUN
- Siempre activar en entornos de prueba
- Verificar antes de deploy a producción:
```sql
SELECT dry_run_mode FROM bot_config WHERE id = 1;
```

### Backups
- Backup automático cada 6 horas
- Backup manual antes de cada deploy
- Backups maestros (golden) nunca se eliminan automáticamente

---

## 13. ROADMAP / NUEVAS FUNCIONES

### Implementado ✅
- [x] Smart-Guard con BE, Trailing, TP fijo
- [x] Multi-exchange (Kraken + RevolutX)
- [x] Configuración dinámica con presets
- [x] Sistema de backups con golden backups
- [x] Telegram multi-chat
- [x] Reconciliación de posiciones (solo bot positions)
- [x] Eventos de auditoría SG_*
- [x] Regla única: open_positions = solo posiciones del bot

### Pendiente 📋
- [ ] Separar `ALLOW_NEW_ENTRIES` vs `ALLOW_POSITION_MANAGEMENT`
- [ ] Simulador en tiempo real de configuración
- [ ] A/B testing de configuraciones
- [ ] Dashboard de métricas por configuración
- [ ] Soporte Bit2Me exchange

---

*Última actualización: 2026-01-22*  
*Mantenido por: Windsurf Cascade AI*
