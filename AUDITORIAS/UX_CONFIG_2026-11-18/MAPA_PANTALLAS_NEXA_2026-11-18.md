# MAPA DE PANTALLAS NEXA — 2026-11-18

**Alcance:** `main @ 3797cc99cd335b1a7f1bc0ae86079282486705a5` y runtime `integration/staging-spot-v4 @ 3ae18319b8c0b68c9374241db65f8ef9bdd39a57`.
**Método:** rutas de `client/src/App.tsx`, páginas, navegación y llamadas API observadas. No se pulsaron acciones mutables.

## 1. Inventario de rutas/páginas

| Pantalla | Ruta runtime | Ruta main | Función | Estado actual | Evidencia principal |
|---|---|---|---|---|---|
| Home NEXA | `/` | `/` | Tarjetas a motores y sistema | Activa | `NexaHome.tsx` |
| DCA/IDCA | `/dca`, `/institutional-dca` | no existe en main | Panel IDCA híbrido | Activa | `InstitutionalDca.tsx` |
| SPOT canónico | `/spot` | no existe | Motor SPOT SHADOW/REAL | Activa | `Spot.tsx` |
| Grid Isolated | `/grid-isolated` | no existe | Grid SHADOW/REAL limitado | Activa | `GridIsolated.tsx` |
| AMA | `/ama` | no existe | Lab/Shadow/Real/Monitor | Activa pero OFF | `Ama.tsx` |
| FISCAL | `/fiscal`, `/fisco` | `/fiscal`, `/fisco` | Informes y conciliación protegidos | Activa | `Fisco.tsx`, `FiscoDashboard.tsx` |
| Dashboard legacy | `/dashboard-legacy` | `/dashboard` | Dashboard antiguo | Legacy | `Dashboard.tsx` |
| Terminal | `/terminal`→`/spot` | `/terminal` página | Operación legacy | Redirect runtime / Activo main | `Terminal.tsx` en main |
| Wallet | `/wallet` | `/wallet` | Balances y cartera | Activa | `Wallet.tsx` |
| Integraciones | `/integrations` | `/integrations` | Exchanges/Telegram/API | Activa | `Integrations.tsx` |
| Telegram | `/telegram` | `/telegram` | Alertas, tokens, canales, comandos | Activa | `Telegram.tsx` |
| Settings | `/settings` | `/settings` | Config global, flags, retención, IA | Activa | `Settings.tsx` |
| Monitor | `/monitor` | `/monitor` | Logs, eventos, market data stats | Activa | `Monitor.tsx` |
| Backups | `/backups` | `/backups` | Respaldos/restauración | Activa | `Backups.tsx` |
| IA/ML | `/ai` | `/ai` | IA legacy/autotuning-related | Activa | `AiMl.tsx`, `AiMl.tsx.backup` |
| Autotuning | `/autotuning` | `/autotuning` | Métricas/perfiles/propuestas | Activa | `Autotuning.tsx` |
| Trading legacy | `/trading`→`/spot` | `/trading` Strategies | Estrategia legacy | Redirect runtime / Activo main | `Strategies.tsx` main |
| Strategies | `/strategies`→`/spot` | `/strategies` | Señales/config | Redirect runtime / Activo main | `Strategies.tsx` main |
| Notifications | `/notifications`→`/telegram` | `/notifications` | Alertas | Redirect | `App.tsx` |
| Guide | `/guide` | `/guide` | Ayuda | Activa | `Guide.tsx` |
| Not found | `*` | `*` | 404 | Activa | `not-found.tsx` |

## 2. Mapa de navegación actual

```text
NEXA HOME
├── Motores
│   ├── DCA / InstitutionalDca
│   ├── SPOT / Spot
│   ├── GRID / GridIsolated
│   └── AMA / Ama
├── Fiscal
│   └── FISCO / FiscoDashboard
└── Sistema
    ├── Telegram / Telegram
    ├── APIs / Integrations
    ├── Settings / Settings
    ├── Backups / Backups
    └── Guide / Guide

Bottom mobile: Home | DCA | SPOT | Fiscal | Sistema
Ocultos/legacy: /dashboard-legacy, /monitor, /wallet, /ai, /autotuning, /terminal redirect
```

## 3. Mapa propuesto conceptual

### Básico

```text
Inicio
├── Estado global y alertas
├── Motores: SPOT / IDCA / Grid / AMA
├── Cartera: balances, reservas por modo
├── Operaciones: historial unificado
└── Alertas: bloqueos explicados
```

### Pro

```text
Pro
├── SPOT: Terminal, Contexto, Intents, Auditoría, Actividad, IA Forward Twin
├── IDCA: Config efectiva, asset configs, eventos, simulación, exports
├── Grid: Niveles, ciclos, monitor, backtest, exports, unlock checks
├── AMA: Lab, Shadow, Real readiness, ledger, eventos
├── FISCO: dominio protegido separado
├── Sistema: Monitor, Autotuning, Integraciones, Backups, Settings avanzado
└── Archivo legacy: Dashboard legacy, rutas redirect
```

## 4. Flujos auditados estáticamente

| Flujo | Recorrido observado | Riesgo UX |
|---|---|---|
| Inicio → estado motor → bloqueo | Home → tarjeta motor → panel estado → tabs Pro | El usuario debe saber qué modo está activo |
| Config → guardar → runtime | Settings/IDCA/Grid → PATCH/POST → engine loadConfig/scheduler | Algunos cambios requieren scheduler/acknowledge/restart |
| Portfolio → reservas | Wallet → `/api/wallet/*`, `/api/portfolio/*` | No siempre muestra reservas por modo |
| Alertas → explicación | Monitor/Telegram/motor tabs → eventos/logs | Reason codes técnicos y duplicados |
| Modo navegación retorno | Bottom bar / menú hamburguesa / redirects | `/trading` y `/strategies` ya no son pantallas reales en runtime |

## 5. Hallazgos por pantalla

| Pantalla | Hallazgo principal | Recomendación |
|---|---|---|
| NexaHome | Tarjeta “Trading Activo” enlaza a ruta que redirige a SPOT | Renombrar a Motores y mostrar owner real |
| Spot | 10 tabs mezclan operación, terminal, IA y auditoría | Básico/Pro + agrupación |
| InstitutionalDca | Tabs legacy ocultos y configuración muy profunda | Centro de ajustes + Pro explícito |
| GridIsolated | Muchos parámetros y reason técnico | Resumen de bloqueo + Pro parámetros |
| Ama | Motor OFF pero superficie completa | Ocultar en Básico |
| Settings | Config global + IA + retención + flags | Centro único con alcance visible |
| Telegram | Alertas globales + por motor | Unificar vista, no reglas |
| Wallet | Balances sin separación clara por modo | Mostrar reservas/SSOT conceptual |
| Monitor | Logs/eventos muy técnicos | Básico incidentes; Pro logs |
| Fisco | Complejidad alta y dominio protegido | Rol/permisos reforzados |
| Dashboard legacy | Duplica estado | Archivo Pro hasta validar consumidores |
