# FASE 1: Auditoría Completa UI/Código

## Estructura actual de navegación (13 páginas)

| Ruta | Página | Tamaño | Función principal |
|------|--------|--------|-------------------|
| `/` | Dashboard | 8.9KB | Panel principal: BotControl, AssetCards, TradeLog, ChartWidget, EventsPanel |
| `/settings` | Settings | 106KB | Config monolítica: DryRun, Tokens, Alertas, Horario, Spread, Posición, Overrides, Logs, IA, QNAP, Info |
| `/terminal` | Terminal | 87KB | Posiciones abiertas, historial operaciones, detalle posición |
| `/strategies` | Strategies | 30KB | Estrategia, señal, riesgo, pares, SL/TP/Trailing, tamaño trade, exposición + tabs Métricas/Motor/SmartExit |
| `/wallet` | Wallet | 18KB | Balance, distribución activos |
| `/integrations` | Integrations | 23KB | APIs Kraken/RevolutX, Telegram, credenciales |
| `/notifications` | Notifications | 51KB | Config alertas Telegram detallada |
| `/guide` | Guide | 68KB | Documentación/guía usuario |
| `/monitor` | Monitor | 62KB | Logs en tiempo real, diagnóstico escaneo, diagnóstico PostgreSQL |
| `/backups` | Backups | 23KB | Gestión backups config |
| `/fisco` | Fisco | 76KB | Informes fiscales |
| `/ai` | AiMl | 30KB | Dashboard IA/ML detallado |
| `/institutional-dca` | InstitutionalDca | 136KB | IDCA completo |

## Duplicidades identificadas

### D1: SL/TP/Trailing — 3 lugares
- **Strategies.tsx** (líneas 370-460): Sliders SL%, TP%, Trailing toggle+distancia
- **Settings.tsx** (BotConfig interface): `stopLossPercent`, `takeProfitPercent`, `trailingStopEnabled`, `trailingStopPercent`
- **TradingConfigDashboard.tsx** (en Settings): Global Risk Parameters con mismos campos
- **IMPACTO**: Tres fuentes de verdad para los mismos parámetros. Riesgo de desincronización.

### D2: Configuración IA — 2 lugares
- **Settings.tsx** (líneas 1516-1830): Motor de IA con toggle, estado, backfill, entrenamiento
- **AiMl.tsx** (30KB): Dashboard IA completo con métricas, diagnóstico, toggle
- **IMPACTO**: Funcionalidad duplicada. Settings tiene versión compacta, AiMl tiene versión detallada.

### D3: Alertas/Notificaciones — 2 lugares
- **Settings.tsx** (línea 539): Card "Alertas y Notificaciones" con link a Notifications
- **Notifications.tsx** (51KB): Config detallada de alertas Telegram
- **IMPACTO**: Settings tiene redirect, pero el bloque existe como confusión de navegación.

### D4: Pares de Trading — 2 lugares
- **Strategies.tsx** (líneas 313-355): Toggle de pares activos
- **Settings.tsx** (BotConfig): `activePairs` array
- **IMPACTO**: Mismo dato manipulado desde dos sitios.

### D5: Modo de Posición / SmartGuard — 2 lugares
- **Settings.tsx** (línea 831): Card "Modo de Posición" con FIFO/SMART_GUARD y todos los parámetros SG
- **TradingConfigDashboard.tsx** (en Settings): Preset configs con parámetros SG
- **IMPACTO**: Parámetros SmartGuard editables en bloque monolítico de Settings Y en TradingConfigDashboard.

### D6: Signal Thresholds — import muerto
- **Settings.tsx** importa `SignalThresholdConfig` pero NUNCA lo usa en el JSX
- **TradingConfigDashboard.tsx** tiene "Signal Thresholds by Regime" (línea 767)
- **IMPACTO**: Import innecesario en Settings. Config real en TradingConfigDashboard.

### D7: Estrategia + Riesgo — solapamiento
- **Strategies.tsx**: Strategy selector, Risk Level, Trade Size
- **TradingConfigDashboard.tsx** (Settings): Presets con strategy + risk implícitos
- **IMPACTO**: El usuario puede pensar que configura riesgo en Strategies, pero los presets en Settings sobreescriben.

## Fuentes de verdad

| Concepto | Fuente real (server) | UI principal | UI secundaria |
|----------|---------------------|--------------|---------------|
| Config bot completa | `/api/config` (POST) | Settings | Strategies (parcial) |
| Posiciones abiertas | `openPositions` Map | Terminal | Dashboard (AssetCards) |
| Historial trades | DB `trades` | Terminal | Dashboard (TradeLog) |
| Estado IA | `/api/ai/status` | AiMl | Settings (compacto) |
| Alertas Telegram | `/api/telegram/*` | Notifications | Settings (link) |
| IDCA ciclos | `/api/idca/*` | InstitutionalDca | — |
| Backups | `/api/admin/backups` | Backups | — |
| Logs realtime | WebSocket events | Monitor | Dashboard (EventsPanel) |
| Balance/Wallet | Exchange API | Wallet | Dashboard (AssetCards) |
| Diagnóstico | `/api/diagnostics/*` | Monitor | — |
| Fiscal | DB trades + calc | Fisco | — |

## Dependencias IDCA

- **InstitutionalDca.tsx** (136KB) es autónomo — NO depende de Settings para config
- Usa sus propias APIs: `/api/idca/cycles`, `/api/idca/config`, `/api/idca/wallet`
- NO hay duplicidad con el sistema de trading principal
- **PROTEGER**: No tocar InstitutionalDca durante refactor UI

## Problemas arquitecturales

1. **Settings.tsx es un monolito de 106KB** — Debe descomponerse en componentes
2. **TradingConfigDashboard.tsx (37KB)** embebido dentro de Settings añade otra capa de complejidad
3. **No hay sistema de tabs/secciones en Settings** — Todo es scroll vertical
4. **Strategies y Settings compiten** por la config de trading
5. **Dashboard es ligero (9KB)** pero podría centralizar más métricas
6. **Nav.tsx** muestra todas las 13 rutas — exceso de opciones
7. **MobileTabBar** solo muestra 6 rutas — inconsistencia con desktop

## Recomendación para FASE 2

Arquitectura propuesta de navegación:
1. **DASHBOARD** — Panel principal (actual, mejorado)
2. **TRADING** — Fusión de Strategies + Settings(trading): SL/TP/Trailing, Pares, Riesgo, SmartGuard, Spread, Señales
3. **IDCA** — InstitutionalDca (sin cambios)
4. **SALIDAS** — SmartExit + TimeStop + BreakEven (extraer de Strategies)
5. **ALERTAS** — Notifications (sin cambios significativos)
6. **INTEGRACIONES** — Integrations (sin cambios)
7. **IA** — AiMl (absorber sección IA de Settings)
8. **SISTEMA** — Settings(sistema): DryRun, Tokens, Logs, QNAP, Info, Backups
9. **DIAGNÓSTICO** — Monitor + Fisco
10. **TERMINAL** — Terminal (sin cambios)
11. **GUÍA** — Guide (sin cambios)
12. **WALLET** — Wallet (sin cambios)
