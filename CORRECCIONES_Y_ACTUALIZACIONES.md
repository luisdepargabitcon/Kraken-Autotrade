# 📝 BITÁCORA TÉCNICA - KRAKEN AUTOTRADE

> Registro detallado de cambios, fixes y mejoras en el sistema de trading autónomo.  
> Documentación completa de problemas resueltos y decisiones técnicas.

---

## 2026-02-27 — FIX: Pipeline Informe→Telegram (schema + notifier + sync innecesaria)

### Problemas
1. `fisco_alert_config` tenía columnas incorrectas → error `column "sync_daily_enabled" does not exist`
2. `fisco_sync_history` tenía columnas incorrectas → error `column "triggered_by" does not exist`
3. `FiscoTelegramNotifier` usaba `storage.getDefaultChat()` (chat global) en vez del chatId configurado en FISCO
4. Botón "Informe → Telegram" hacía full sync desde 2020 antes de generar informe → rate limit Kraken

### Correcciones
1. **Self-healing tables** (`fiscoAlerts.routes.ts`): `ensureFiscoTables()` valida columnas clave (`sync_daily_enabled`, `triggered_by`). Si faltan → DROP + CREATE con schema correcto.
2. **FiscoTelegramNotifier** (`FiscoTelegramNotifier.ts`): Todos los métodos (`sendToConfiguredChat`, `sendHtmlReport`, `sendTextReport`, `getAlertConfig`) ahora leen el `chatId` directamente de `fisco_alert_config` (el canal seleccionado en la UI), no del default chat global. Eliminado import `storage`.
3. **Pipeline sin sync** (`fiscoAlerts.routes.ts`): Botón "Informe → Telegram" ahora solo genera informe desde datos existentes en DB y lo envía. Sin sync previa (el botón "Sincronizar" ya existe para eso).

### Archivos Modificados
- `server/routes/fiscoAlerts.routes.ts` — Self-healing tables + pipeline sin sync
- `server/services/FiscoTelegramNotifier.ts` — Usa chatId de config FISCO

---

## 2026-02-26 — FEAT: Selector de canal Telegram para alertas FISCO

### Cambios
1. **Selector de canal en tab "Alertas Telegram"** (`Fisco.tsx`): Dropdown con todos los canales Telegram activos (TECNICO, CANAL ERRORES, CANAL TRADES). El usuario elige a qué canal enviar informes y alertas fiscales.
2. **Backend PUT `/api/fisco/alerts/config`**: Acepta `chatId` del body para cambiar canal destino. Ya no depende de un "default chat" global.
3. **Backend GET `/api/fisco/alerts/config`**: Busca config existente en DB directamente, sin depender del default chat.
4. **Warning visual**: Muestra aviso amarillo si no hay canal seleccionado aún.

### Archivos Modificados
- `client/src/pages/Fisco.tsx` — Selector canal Telegram + query telegramChats
- `server/routes/fiscoAlerts.routes.ts` — GET/PUT independientes de default chat

---

## 2026-02-26 — FIX: Crash startup VPS (revolutxService undefined) + Auto-migración tablas FISCO

### Problema
La app crasheaba al iniciar en VPS con `ReferenceError: revolutxService is not defined` en `routes.ts`.

### Causa Raíz
En `routes.ts` línea 51, se usaba shorthand property `revolutxService` (minúscula x), pero el import real es `revolutXService` (mayúscula X). TypeScript no detecta el error porque la propiedad del interface `RouterDeps` se llama `revolutxService`, pero en runtime la variable `revolutxService` no existe — solo existe `revolutXService`.

### Correcciones
1. **FIX `routes.ts`**: Cambiado `revolutxService,` → `revolutxService: revolutXService,` (asignación explícita).
2. **Auto-migración tablas FISCO en `script/migrate.ts`**: Añadidas migraciones `CREATE TABLE IF NOT EXISTS` para:
   - `fisco_alert_config` — configuración de alertas por chat
   - `fisco_sync_history` — historial de sincronizaciones
   - `fisco_operations` — operaciones importadas de exchanges
   - `fisco_lots` — lotes FIFO de compra
   - `fisco_disposals` — ventas con ganancia/pérdida

### Archivos Modificados
- `server/routes.ts` — Fix asignación revolutxService
- `script/migrate.ts` — Auto-creación tablas FISCO

---

## 2026-02-26 — FEAT: Panel UI Alertas FISCO + Fixes críticos de rutas

### Cambios Implementados

1. **Nueva tab "Alertas Telegram" en Fisco.tsx**: Panel completo con toggles Switch para activar/desactivar cada tipo de alerta (sync diaria, sync manual, informe generado, errores). Incluye preferencias de notificación (notificar siempre, umbral de resumen). Guardado automático al cambiar cada toggle.
2. **Historial de sincronización**: Tabla con fecha, modo, origen, estado y duración de cada sync. Botón "Sync Manual" integrado.
3. **Card info comandos Telegram**: Muestra los 4 comandos disponibles (`/informe_fiscal`, `/fiscal`, `/reporte`, `/impuestos`).
4. **FIX endpoint PUT `/api/fisco/alerts/config`**: Cambiado de validación full-schema a partial update (soporta enviar solo un campo). Upsert automático con defaults.
5. **FIX orden de rutas**: `/api/fisco/sync/history` movida ANTES de `/api/fisco/sync/:runId` para evitar que Express capture "history" como parámetro `:runId`.

### Archivos Modificados
- `client/src/pages/Fisco.tsx` — Tab "Alertas Telegram" completa (toggles, historial, comandos info)
- `server/routes/fiscoAlerts.routes.ts` — PUT partial update + orden correcto de rutas

---

## 2026-02-26 — FEAT: Módulo FISCO Expandido (Alertas Telegram + Sync Automático + Informe → Telegram)

### Resumen
Ampliación completa del módulo FISCO para:
1. Alertas Telegram configurables desde la UI (toggles + canal destino)
2. Sincronización automática diaria Exchange → Bot a las 08:00 (Europe/Madrid)
3. Botón UI + comando Telegram `/informe_fiscal` para: sync → generar informe → enviar a Telegram
4. **REGLA CRÍTICA**: El informe fiscal usa EXACTAMENTE la misma plantilla existente (`generateBit2MePDF`), sin cambios

### Nuevos Archivos Creados
- `server/services/FiscoSyncService.ts` — Servicio unificado de sincronización para todos los exchanges (Kraken + RevolutX). Importa trades, depósitos, retiros, staking. Guarda historial en DB con runId/mode/status.
- `server/services/FiscoTelegramNotifier.ts` — Envío de alertas configurables. Tipos: sync_daily, sync_manual, report_generated, sync_error. Mensajes HTML profesionales con emojis, resumen/detalle según umbral (>30 ops = resumen).
- `server/services/FiscoScheduler.ts` — Job cron diario a las 08:00 Europe/Madrid. Ejecuta sync completo y envía alerta. Singleton con initialize/shutdown.
- `server/routes/fiscoAlerts.routes.ts` — Endpoints API: GET/PUT alertas config, POST sync manual, POST generar informe, GET sync status/history, GET health check.

### Archivos Modificados
- `shared/schema.ts` — Nuevas tablas: `fisco_alert_config` (toggles alertas, chat destino, umbral), `fisco_sync_history` (historial syncs con runId). Tipos Zod + insert schemas. AlertPreferences extendido con alertas FISCO.
- `server/storage.ts` — Interfaz IStorage extendida + implementación DatabaseStorage: CRUD para fisco_alert_config y fisco_sync_history.
- `server/routes.ts` — Registro de rutas fiscoAlerts + inicialización del FiscoScheduler en startup.
- `server/routes/types.ts` — RouterDeps extendido con krakenService y revolutxService.
- `server/services/telegram.ts` — Nuevos comandos: `/informe_fiscal`, `/fiscal`, `/reporte`, `/impuestos`. Control de acceso (solo chat configurado). Pipeline: sync → generar informe real → enviar.
- `client/src/pages/Fisco.tsx` — Nuevo botón "Informe → Telegram" (verde, icono Send). Mutación `generateAndSend` que llama a `/api/fisco/report/generate`. Estados: Generando/Enviado/Error.

### Correcciones de Auditoría (bugs detectados y corregidos)
1. **FiscoSyncService**: Campos `rawJson`/`raw` corregidos a `rawData` + `pair` (campos reales de NormalizedOperation). Método `getOrderHistory` corregido a `getHistoricalOrders` (método real de RevolutXService). Eliminado `updatedAt` de fiscoSyncHistory (no existe en schema).
2. **FiscoTelegramNotifier**: `sendTelegramMessage` corregido a `telegramService.sendToChat()` (firma real). `(storage as any).db` corregido a importar `db` directamente.
3. **FiscoScheduler**: Cron `'0 7 * * *'` corregido a `'0 8 * * *'` con timezone Europe/Madrid (el timezone ya maneja la hora directamente).
4. **generateExistingFiscalReport**: Mock HTML reemplazado por llamada real a `/api/fisco/annual-report` + generación HTML idéntica a la plantilla del frontend.
5. **Schema**: `insertFiscoSyncHistorySchema` corregido para permitir `startedAt`.

### Endpoints API Nuevos
- `GET /api/fisco/alerts/config` — Obtener configuración alertas FISCO
- `PUT /api/fisco/alerts/config` — Actualizar configuración
- `POST /api/fisco/sync/manual` — Sincronización manual (async, devuelve runId)
- `GET /api/fisco/sync/:runId` — Estado de sync por runId
- `GET /api/fisco/sync/history` — Historial de sincronizaciones
- `POST /api/fisco/report/generate` — Pipeline completo: sync → report → telegram
- `GET /api/fisco/report/existing` — Obtener informe sin sincronizar
- `GET /api/fisco/alerts/health` — Health check de servicios FISCO

### Comandos Telegram Nuevos
- `/informe_fiscal` — Pipeline completo (sync + report + envío)
- `/fiscal`, `/reporte`, `/impuestos` — Alias del anterior
- Control de acceso: solo chat por defecto configurado

---

## 2026-02-25 — FIX: Correcciones PDF Fiscal (branding, datos, normalización, 2024)

### Cambios Implementados

1. **Branding PDF**: Sustituido "KRAKENBOT.AI" por "Gestor Fiscal de Criptoactivos" en todas las páginas. Variable centralizada `BRAND_LABEL`.
2. **Tabla agregada por activo**: Añadida tabla "B) Resumen por activo (agregado)" que fusiona exchanges, debajo de la tabla "A) Por activo y exchange". Ambas con fila "Total año".
3. **Origen de Datos**: Sustituido "genesis" por etiqueta dinámica basada en exchanges presentes en el informe (ej: "Kraken + Revolutx").
4. **Cuenta**: Sustituido "BÓSIM" por "Cuenta Principal" en PDF y dashboard.
5. **EUR.HOLD normalizado**: Añadidos mappings para tickers Kraken con sufijos (.HOLD, .S, .M, .F, .P) en `normalizer.ts`. Fallback con regex para futuros sufijos. Balance de Kraken en Section D ahora se normaliza via `krakenService.normalizeAsset()`.
6. **Selector de años 2024+**: El selector ahora muestra siempre años desde 2024 hasta el actual, independientemente de si hay datos en DB. Permite generar informes vacíos para verificar.

### Diagnóstico: Operaciones 2024 faltantes
- El pipeline `/api/fisco/run` ya usa `fetchAll: true` sin filtro de fecha → trae historial completo de Kraken y RevolutX.
- Si no aparecen operaciones 2024, es porque: (a) no se ha ejecutado sync tras el deploy, o (b) las APIs de los exchanges no devuelven datos de ese periodo (Kraken sí guarda todo; RevolutX puede tener límite).
- **Solución**: Ejecutar "Sincronizar Datos" desde la UI. El pipeline traerá todo el historial disponible y 2024 aparecerá si existen operaciones.

### Archivos Modificados
- `client/src/pages/Fisco.tsx` — Branding, labels dinámicos, tabla agregada, selector años
- `server/services/fisco/normalizer.ts` — ASSET_MAP ampliado, normalización con fallback regex
- `server/routes/fisco.routes.ts` — Normalización de balance Kraken en Section D

---

## 2026-02-25 — FEAT: Observabilidad D2/MINI-B en PAIR_DECISION_TRACE

### Resumen
Enriquecimiento del log `PAIR_DECISION_TRACE` con campos diagnósticos `spreadDiag` y `timingDiag` para validar D2 (MarkupTracker/spread) y MINI-B (staleness/chase) sin necesidad de señal BUY activa.

### Campos Añadidos
- **`spreadDiag`**: `{ markupSource, markupPct, markupSamples, markupEma }` — muestra la fuente de markup (fixed/dynamic), el porcentaje aplicado, muestras en EMA y valor EMA actual.
- **`timingDiag`**: `{ candleAgeSec, lastCandleCloseIso }` — edad en segundos de la última vela cerrada y su timestamp ISO.

### Validación (2026-02-25 13:46–13:52 UTC)
- 24 trazas analizadas (12 scans × 2 pares): **100% con campos presentes**
- `markupSource=fixed`, `markupPct=0.8`, `markupSamples=0` → correcto (sin fills recientes)
- `candleAgeSec` crece ~30s entre scans → coherente con ciclo de 30s
- 0 errores, 0 crasheos

### Archivos Modificados
- `server/services/tradingEngine.ts` — Interfaz `DecisionTraceContext` + método `emitPairDecisionTrace`

### Commit
- `ccf537e` — `feat(observability): enriquecer PAIR_DECISION_TRACE con spreadDiag y timingDiag`

---

## 2026-02-24 — FIX: Verificación y corrección de errores Sistema FISCO

### Problemas Detectados y Corregidos

1. **Estructura JSX rota** — `</SectionCard>` y `)}` duplicados/huérfanos en líneas 679-681 que rompían la compilación
2. **Modal fuera del componente** — El modal de lotes FIFO estaba renderizado fuera del `return()` del componente React
3. **CardContent condicional huérfano** — Restos del antiguo sistema collapsible `)}` que impedían el render
4. **TypeError en URLSearchParams** — `parseInt()` pasado como argumento a `.set()` que requiere `string`
5. **Endpoint disposals sin filtro asset** — El modal no podía filtrar ventas por activo específico
6. **Rangos rápidos faltantes** — Añadidos botones 7d, 30d, YTD, Todo en el date picker del Anexo
7. **Hint en Section B** — Añadido texto "Haz clic en un activo para ver el desglose por lotes FIFO"
8. **Click-away en modal** — Cierre del modal al hacer clic fuera con `stopPropagation`

### Archivos Modificados
- `client/src/pages/Fisco.tsx` — Reescritura completa sección tabs (líneas 516-950)
- `server/routes/fisco.routes.ts` — Filtro asset en endpoint `/api/fisco/disposals`

---

## 2026-02-24 — FEAT: Mejoras integrales Sistema FISCO

### Resumen Ejecutivo
Se han implementado todas las correcciones solicitadas para el módulo FISCO, mejorando la organización, UX y funcionalidad del sistema fiscal.

### Cambios Implementados

#### 1. Subpestaña "ANEXO – EXTRACTO DE TRANSACCIONES"
- **Problema**: Estaba integrada dentro de la pestaña Fisco sin separación clara
- **Solución**: 
  - Crear estructura de tabs con `Tabs` y `TabsContent`
  - Separar en "Resumen Fiscal" y "Anexo: Extracto de Transacciones"
  - Mejorar navegación y organización visual

#### 2. Operaciones Recientes y Filtro de Fechas
- **Orden**: Corregido para mostrar operaciones en orden descendente (DESC)
  - Modificado `ORDER BY executed_at DESC` en `/api/fisco/operations`
- **Filtro de Fechas**: Implementado date-range picker moderno
  - Reemplazado inputs `<input type="date">` por componentes `Calendar` + `Popover`
  - Añadido `date-fns` con locale español para formato `dd/MM/yyyy`
  - Mejor UX con selección visual y controles intuitivos

#### 3. Resumen de Ganancias y Pérdidas (Detalle por Lotes)
- **Funcionalidad**: Modal con detalles completos FIFO por activo
- **Implementación**:
  - Filas clicables en Section B para abrir modal
  - Queries para lotes (`/api/fisco/lots`) y disposals (`/api/fisco/disposals`)
  - Modal con dos tablas: "Lotes de Compra (FIFO)" y "Ventas y Ganancias/Pérdidas"
  - Información completa: fechas, cantidades, costos, método FIFO

#### 4. Activos Considerados en el Cálculo
- **Problema**: Solo consideraba activos operados por el bot
- **Solución**:
  - Obtener balances actuales de Kraken y RevolutX
  - Combinar con activos de operaciones históricas
  - Inicializar todos los activos en Section D para asegurar visibilidad
  - Considerar operaciones manuales, transferencias, staking

#### 5. Histórico Completo de Operaciones
- **Problema**: No aparecían operaciones anteriores a 2025
- **Solución**:
  - Modificado pipeline FISCO para eliminar límites de fecha
  - Kraken: `fetchAll: true` (ya recuperaba todo)
  - RevolutX: Eliminado `startMs` para obtener historial completo
  - Logs actualizados para indicar "FULL HISTORY - NO LIMIT"

#### 6. Sincronización Automática Exchange → Bot
- **Requerimiento**: Sincronización diaria 08:00 con notificaciones Telegram
- **Implementación**:
  - Scheduler con `node-cron` a las 08:00 (Europe/Madrid)
  - Llamada a `/api/fisco/run` para sincronización completa
  - Notificaciones Telegram para éxito y errores
  - Variables de entorno: `FISCO_DAILY_SYNC_CRON` y `FISCO_DAILY_SYNC_TZ`

### Archivos Modificados

#### Frontend
- `client/src/pages/Fisco.tsx`
  - Nueva estructura con tabs
  - Date-range picker moderno
  - Modal para detalles de lotes
  - Handlers para interacciones

#### Backend
- `server/routes/fisco.routes.ts`
  - Orden DESC en operaciones
  - Inclusión de todos los activos del exchange
  - Historial completo sin límites
- `server/routes.ts`
  - Scheduler FISCO diario 08:00
  - Notificaciones Telegram integradas

### Dependencias Añadidas
- `date-fns` - Para manejo de fechas y locale español

### Variables de Entorno
```bash
# FISCO Daily Sync (opcional, valores por defecto incluidos)
FISCO_DAILY_SYNC_CRON=0 8 * * *
FISCO_DAILY_SYNC_TZ=Europe/Madrid
```

### Beneficios Alcanzados
1. **Organización**: Separación clara entre resumen fiscal y extracto detallado
2. **UX**: Date picker moderno e intuitivo
3. **Transparencia**: Detalle completo de cálculos FIFO por activo
4. **Completitud**: Todos los activos del exchange considerados
5. **Historial**: Acceso a operaciones completas sin límite artificial
6. **Automatización**: Sincronización diaria automática con notificaciones

---

## 2026-02-24 — FIX/FEAT: Mejora calidad de entradas (D1 + D2 + MINI-B + Observabilidad)

### Problema
Entradas que nacen en rojo pese a spread filter endurecido. Causa raíz: discrepancia entre precio de referencia (Kraken) y precio de ejecución (RevolutX), timing tardío tras cierre de vela.

### Cambios implementados

**D1 — Coherencia de precio de ejecución**
- `tradingEngine.ts`: Guarda `krakenReferencePrice` antes de que se sobrescriba con el fill real de RevolutX
- Calcula `realEntryCostPct = (executedPrice - krakenRef) / krakenRef * 100` tras cada BUY
- Alimenta automáticamente al `MarkupTracker` para aprendizaje dinámico
- Log `[D1_ENTRY_COST]` con krakenRef, executed, realEntryCostPct

**D2 — Markup dinámico por par (sin llamadas extra a RevolutX)**
- Nuevo servicio `server/services/MarkupTracker.ts`: EMA rolling de `realEntryCostPct` por par
- `spreadFilter.ts`: usa markup dinámico cuando `dynamicMarkupEnabled=true` (default)
- Fallback a markup fijo si <3 samples históricos
- Floor 0.10%, Cap 5.00% para sanidad
- Campo `markupSource` ("dynamic"/"fixed"/"none") + `markupSamples` + `markupEma` en SpreadCheckDetails

**MINI-B — Timing gates (staleness + chase)**
- **Staleness gate**: bloquea si `candleAge > stalenessMaxSec` (default 60s para 5min candles)
- **Chase gate**: bloquea si `currentPrice > candleClose + chaseMaxPct%` (default 0.50%)
- Reason codes: `STALE_CANDLE_BLOCK`, `CHASE_BLOCK`
- Solo aplica en modo velas (candle mode), no en ciclos

**Observabilidad**
- Log `[ENTRY_QUALITY]` en cada BUY permitido: regime, spreadKraken, markupUsed, markupSource, spreadEff, threshold, stalenessAge, chaseDelta, candleClose, currentPrice, signals
- `botLogger` event types: `ENTRY_QUALITY_ALLOWED`, `D1_ENTRY_COST`
- Cada bloqueo incluye reason code + valores numéricos para calibración

**Config / Feature flags** (schema + DB)
- `dynamic_markup_enabled` (boolean, default true)
- `staleness_gate_enabled` (boolean, default true)
- `staleness_max_sec` (integer, default 60)
- `chase_gate_enabled` (boolean, default true)
- `chase_max_pct` (decimal, default 0.50)

### Archivos modificados
- `server/services/MarkupTracker.ts` (NUEVO)
- `server/services/spreadFilter.ts`
- `server/services/tradingEngine.ts`
- `server/services/botLogger.ts`
- `shared/schema.ts`
- `CORRECCIONES_Y_ACTUALIZACIONES.md`

---

## 2026-02-23 — FEAT: FISCO UI Rediseño Completo estilo Bit2Me

### Objetivo
Rediseño total de la interfaz FISCO para replicar la jerarquía visual y estructura de informes de Bit2Me. Vista principal = resumen anual (no listado de operaciones).

### Cambios Backend
- **Nuevo endpoint `/api/fisco/annual-report?year=&exchange=`** — Devuelve las 4 secciones del informe en una sola llamada:
  - **Sección A**: Resumen de ganancias y pérdidas derivadas de transmisiones (gains/losses/total)
  - **Sección B**: Desglose por activo (ticker, exchange, tipo, valor transmisión, valor adquisición, gan/pérd)
  - **Sección C**: Rendimiento de capital mobiliario (staking, masternodes, lending, distribuciones)
  - **Sección D**: Visión general de cartera (saldo 01/01, entradas, salidas, saldo 31/12 por activo)
  - Contadores: operaciones importadas + operaciones con valoración EUR pendiente
  - Última sincronización

### Cambios UI (`client/src/pages/Fisco.tsx`)
- **Barra superior**: Selector de año grande + filtro exchange + botón Sincronizar + botón Generar PDF
- **Contadores visibles**: Operaciones importadas + valoración pendiente + última sincronización
- **Sección A**: Tabla simple ganancias/pérdidas/total (cabecera azul, estilo Bit2Me)
- **Sección B**: Tabla por activo con valor transmisión, valor adquisición, ganancia/pérdida
- **Sección C**: Tabla capital mobiliario (staking/masternodes/lending/distribuciones)
- **Sección D**: Tabla cartera con saldos inicio/fin de año y movimientos
- **Sección E (Anexo)**: Operaciones completas en sección colapsable con filtros (fecha, activo, exchange, tipo)
- **PDF multi-página**: Genera HTML descargable con 4 páginas separadas replicando las tablas Bit2Me

### Diseño Visual
- Cabeceras de tabla azul claro (`bg-blue-500/10`)
- Números alineados a la derecha con font-mono
- Formato EUR con 2 decimales y separador de miles (es-ES)
- Filas totales destacadas en azul
- Sin gráficos complejos — tablas limpias y claras
- Operaciones completas solo en Anexo colapsable

### Archivos modificados
- `server/routes/fisco.routes.ts` — Nuevo endpoint `/api/fisco/annual-report`
- `client/src/pages/Fisco.tsx` — Reescritura completa estilo Bit2Me

---

## 2026-02-20 — FEAT: Módulo FISCO Completo — Control Fiscal FIFO en EUR

### Objetivo
Sistema fiscal completo: extracción de datos de exchanges → normalización → motor FIFO → persistencia DB → UI interactiva. Todo en EUR conforme a legislación española (IRPF).

### Arquitectura

```
Kraken API (ledger)  ──┐
                       ├─→ Normalizer ──→ FIFO Engine ──→ DB (PostgreSQL) ──→ UI React
RevolutX API (orders) ─┘       │                │
                          EUR Rates (ECB)   Gain/Loss calc
```

### Problema resuelto: RevolutX sin campo `side`
- El endpoint `/api/1.0/trades/private/{symbol}` NO incluye `side` (buy/sell).
- **Solución**: Usar `/api/1.0/orders/historical` que SÍ devuelve `side`, `filled_quantity`, `average_fill_price`.
- Limitación: máx 1 semana por consulta → iteración automática semana a semana.

### Fix: Rate limit Kraken + RevolutX fecha inicio
- Kraken: delay entre llamadas paginadas de 2s → 3.5s
- Kraken fetch-all: ejecución secuencial (no paralela) para evitar `EAPI:Rate limit exceeded`
- RevolutX: fecha inicio por defecto de 2020 → 2025 (evita 260+ semanas vacías)
- RevolutX: soporte `?start=` query param para rango personalizado

### Archivos creados/modificados

| Archivo | Cambio |
|---|---|
| `server/services/exchanges/RevolutXService.ts` | `getHistoricalOrders()` — iteración por semanas, cursor, filtro `state=filled` |
| `server/services/kraken.ts` | `getLedgers()` — deposits, withdrawals, staking, trades con paginación. Rate limit 3.5s |
| `server/services/fisco/normalizer.ts` | **NUEVO** — Normaliza Kraken ledger + RevolutX orders → formato unificado `NormalizedOperation` |
| `server/services/fisco/fifo-engine.ts` | **NUEVO** — Motor FIFO: lotes por compra, consume FIFO en ventas, calcula gain/loss EUR |
| `server/services/fisco/eur-rates.ts` | **NUEVO** — Conversión USD→EUR via ECB API con cache 4h + fallback |
| `server/routes/fisco.routes.ts` | Endpoints completos: test, fetch-all, run (pipeline), operations, lots, disposals, summary |
| `server/routes.ts` | Registra `fisco.routes.ts` |
| `db/migrations/015_fisco_tables.sql` | **NUEVO** — Tablas: `fisco_operations`, `fisco_lots`, `fisco_disposals`, `fisco_summary` + índices |
| `shared/schema.ts` | Tablas Drizzle: `fiscoOperations`, `fiscoLots`, `fiscoDisposals`, `fiscoSummary` + tipos |
| `client/src/pages/Fisco.tsx` | **NUEVO** — UI completa con 4 sub-pestañas: Resumen, Operaciones, Lotes FIFO, Ganancias |
| `client/src/App.tsx` | Ruta `/fisco` registrada |
| `client/src/components/dashboard/Nav.tsx` | Link FISCO con icono Calculator en navegación |

### Endpoints API disponibles
- `GET /api/fisco/test-apis` — Prueba rápida de ambas APIs
- `GET /api/fisco/fetch-all?exchange=kraken|revolutx` — Descarga completa de un exchange
- `GET /api/fisco/run` — **Pipeline completo**: fetch → normalize → FIFO → save DB. Acepta `?year=2026` y `?start=2025-01-01`
- `GET /api/fisco/operations` — Operaciones normalizadas desde DB. Filtros: `?year=`, `?asset=`, `?type=`
- `GET /api/fisco/lots` — Lotes FIFO desde DB. Filtros: `?asset=`, `?open=true`
- `GET /api/fisco/disposals` — Disposiciones con gain/loss. Filtro: `?year=`
- `GET /api/fisco/summary` — Resumen anual por activo

### Motor FIFO
- Cada compra crea un lote con coste en EUR (precio + fee)
- Cada venta consume lotes en orden FIFO (más antiguo primero)
- Si se vende más de lo que hay en lotes, se crea disposición con coste base 0 + warning
- Conversiones (USD↔USDC), deposits, withdrawals se registran pero no generan eventos fiscales

### Principio de diseño
> **Exchange-First**: Datos fiscales SIEMPRE de las APIs de los exchanges, nunca de la DB del bot. Garantiza captura de operaciones manuales, deposits, withdrawals y staking.

### Verificación
- `npx tsc --noEmit` → 0 errores
- APIs verificadas en staging: Kraken 253 trades + 535 ledger, RevolutX 80+ orders con side
- Rate limit fix verificado: sin errores EAPI en fetch-all secuencial

---

## 2026-02-21 — REFACTOR: Extracción strategies.ts + alertBuilder.ts de tradingEngine.ts

### Objetivo
Continuar reducción del monolito `tradingEngine.ts` extrayendo bloques cohesivos y testables.

### Extracciones realizadas

| Módulo | Líneas | Funciones extraídas |
|---|---|---|
| `strategies.ts` | 698 | `momentumStrategy`, `meanReversionStrategy`, `scalpingStrategy`, `gridStrategy`, `momentumCandlesStrategy`, `meanReversionSimpleStrategy`, `applyMTFFilter` |
| `alertBuilder.ts` | 247 | `buildTimeStopAlertMessage`, `sendTimeStopAlert`, `checkExpiredTimeStopPositions`, `forceTimeStopAlerts` |

### Patrón de extracción
- **strategies.ts**: Funciones puras (sin side-effects). Reciben datos de mercado, devuelven `TradeSignal`. Indicadores importados de `indicators.ts`.
- **alertBuilder.ts**: Patrón host-interface (`IAlertBuilderHost`). El engine implementa el adaptador para inyectar dependencias (telegram, precios, DB).
- En `tradingEngine.ts`, los métodos originales quedan como thin delegations de 1 línea.

### Resultado
- `tradingEngine.ts`: 6550 → **5767 líneas** (−783, −12%)
- Total módulos extraídos: 8 (exitManager, indicators, regimeDetection, regimeManager, spreadFilter, mtfAnalysis, **strategies**, **alertBuilder**)
- `npm run check` = 0 errores

### Tests añadidos
- `server/services/__tests__/strategies.test.ts` — **33 tests** (7 estrategias + MTF filter)
- `server/services/__tests__/alertBuilder.test.ts` — **30 tests** (message builder, alert dispatch, expired check, force alerts)
- Total tests del proyecto: 5 test suites, 63+ assertions nuevas

### Arquitectura actualizada

```
tradingEngine.ts    5767 líneas  (core trading loop, execution, entry logic)
├── exitManager.ts      1404 líneas  (SL/TP, SmartGuard, TimeStop, alert throttle)
├── strategies.ts        698 líneas  (momentum, meanReversion, scalping, grid, candles, MTF filter)
├── indicators.ts        296 líneas  (EMA, RSI, MACD, Bollinger, ATR, ADX)
├── regimeDetection.ts   273 líneas  (detectMarketRegime, params)
├── regimeManager.ts     319 líneas  (cache, confirmación, DB)
├── spreadFilter.ts      208 líneas  (spread gating, alertas)
├── mtfAnalysis.ts       198 líneas  (MTF fetch/cache, trend)
└── alertBuilder.ts      247 líneas  (Time-Stop alerts, host interface)
```

---

## 2026-02-20 — AUDIT: Verificación integral del proyecto (commit `0c38751`)

### Hallazgos del audit vs estado real

| Hallazgo del audit | Estado real | Veredicto |
|---|---|---|
| `routes.ts` tiene 4000+ líneas | **822 líneas** + 10 route modules en `server/routes/` | ✅ YA MODULARIZADO |
| `tradingEngine.ts` monolito 8000+ líneas | **6550 líneas** (-26%) + 6 módulos extraídos | ✅ PARCIALMENTE RESUELTO |
| `openPositions` Map se pierde en restart | `loadOpenPositionsFromDB()` + `recoverPendingFillPositionsFromDB()` en `start()` | ✅ YA TIENE RECOVERY |
| `sgAlertThrottle` volátil | `exitManager.ts` líneas 177-183: carga desde DB + persiste cada update | ✅ YA TIENE PERSISTENCIA DB |
| Sin capa de servicio | RouterDeps pattern + route modules por dominio | ✅ ADECUADO |
| Tests insuficientes | 3 test files + telegram templates test | ⚠️ MEJORABLE (no crítico) |
| Sin recovery automático de estado | Fail-closed safety check en `manualBuyForTest()` + DB persistence | ✅ IMPLEMENTADO |

### Arquitectura actual (post-refactor)

```
tradingEngine.ts    6550 líneas  (core trading loop, strategies, execution)
├── exitManager.ts      1404 líneas  (SL/TP, SmartGuard, TimeStop, alert throttle)
├── indicators.ts        296 líneas  (EMA, RSI, MACD, Bollinger, ATR, ADX)
├── regimeDetection.ts   273 líneas  (detectMarketRegime, params)
├── regimeManager.ts     319 líneas  (cache, confirmación, DB)
├── spreadFilter.ts      208 líneas  (spread gating, alertas)
└── mtfAnalysis.ts       198 líneas  (MTF fetch/cache, trend)

routes.ts            822 líneas  (startup, health, config endpoints)
├── trades.routes.ts         (CRUD trades, sync, FIFO, performance)
├── positions.routes.ts      (open-positions, buy, close, orphan)
├── admin.routes.ts          (purge, rebuild, backfill, indexes)
├── market.routes.ts         (balance, prices, trade, reconcile)
├── events.routes.ts         (events & logs)
├── ai.routes.ts             (AI, environment, DB diagnostics)
├── test.routes.ts           (test & debug)
├── telegram.routes.ts       (Telegram endpoints)
├── backups.routes.ts        (backup management)
└── config.ts                (configuration)
```

### Encoding fix pase 2 (commit `0c38751`)
- Patrones adicionales corregidos: `≈` `→` `≥` `ℹ` `⏳` `É` `Ú` `Á`
- Scanner exhaustivo: **0 mojibake residual** confirmado
- `npm run check` = 0 errores

---

## 2026-02-20 — FIX: Reparación encoding UTF-8 en alertas Telegram (commit `bacb179`)

### Problema
- `tradingEngine.ts` contenía **217 instancias de mojibake** (double-encoding Win-1252→UTF-8)
- Emojis se mostraban como `ðŸ¤–` en vez de 🤖, acentos como `Ã³` en vez de ó
- Afectaba TODAS las alertas Telegram: Time-Stop, Bot Started/Stopped, Trades, Errors, etc.

### Causa raíz
- El archivo fue guardado en algún momento con encoding Windows-1252 interpretando bytes UTF-8
- Cada byte UTF-8 fue mapeado a su equivalente Win-1252 y re-codificado como UTF-8

### Solución
- Script PowerShell (`fix-encoding.ps1`) con 3 fases:
  1. **Phase 0**: Reparar literales `u{XXXX}` de un intento previo (PS 5.1 no soporta backtick-u)
  2. **Phase 1**: Reemplazar emojis 4-byte restantes (💡🔄🟢🔴💵)
  3. **Phase 2+3**: Símbolos 3-byte (━•⏰⚠⚡⚙⏸) y acentos (óéáúíñÓÍÑü)
- **22+ tipos de patrones** corregidos, **426 líneas** afectadas
- `npm run check` = 0 errores post-fix

---

## 2026-02-19 — REFACTOR: Modularización de tradingEngine.ts (Fase 2)

### Cambios realizados

#### 1. Tests de executeTrade (commit `35c6c50`)
- Creado `server/services/__tests__/executeTrade.test.ts`
- **39 test cases, 73 assertions** — 100% pass
- Cobertura: pair validation, sellContext gating, order ID resolution, order execution resolution, P&L calculation (con fees reales/estimadas, breakeven, micro-cap), DCA average price, minimum validation, position sell P&L (full/parcial), edge cases
- Patrón: funciones puras extraídas de `executeTrade`, test runner custom (`npx tsx`)

#### 2. Persistencia de sgAlertThrottle en DB (commit `cee829a`)
- Nueva tabla `alert_throttle` en `shared/schema.ts` (key UNIQUE, last_alert_at)
- Métodos en `server/storage.ts`: `getAlertThrottle`, `upsertAlertThrottle`, `deleteAlertThrottleByPrefix`, `loadAlertThrottles`
- `ExitManager` carga throttle desde DB al arrancar, persiste escrituras (fire-and-forget)
- Prefijos: `sg:` para SmartGuard alerts, `ts:` para TimeStop notifications
- Auto-migración: `CREATE TABLE IF NOT EXISTS` en `runSchemaMigration()`
- **Impacto**: Throttle sobrevive reinicios del bot (no más alertas SG duplicadas)

#### 3. Extracción de indicadores técnicos (commit `7133f56`)
- Creado `server/services/indicators.ts` — funciones puras exportadas
- Funciones: `calculateEMA`, `calculateRSI`, `calculateVolatility`, `calculateMACD`, `calculateBollingerBands`, `calculateATR`, `calculateATRPercent`, `detectAbnormalVolume`, `wilderSmooth`, `calculateADX`
- Tipos: `PriceData`, `OHLCCandle`
- `tradingEngine.ts` delega via thin wrappers — **-259 líneas**

#### 4. Extracción de detección de régimen (commit `0a85a5e`)
- Creado `server/services/regimeDetection.ts` — funciones puras exportadas
- Funciones: `detectMarketRegime`, `getRegimeAdjustedParams`, `calculateAtrBasedExits`, `shouldPauseEntriesDueToRegime`
- Tipos: `MarketRegime`, `RegimeAnalysis`, `RegimePreset`, `AtrExitResult`
- Constantes: `REGIME_PRESETS`, `REGIME_CONFIG`
- `tradingEngine.ts` delega via thin wrappers — **-223 líneas**

#### 5. Extracción de RegimeManager stateful (commit `e972ac0`)
- Creado `server/services/regimeManager.ts` — clase `RegimeManager` con interfaz `IRegimeManagerHost`
- Métodos movidos: `getMarketRegimeWithCache`, `applyRegimeConfirmation`, `sendRegimeChangeAlert`, `getRegimeMinSignals`, `computeHash`, `computeParamsHash`, `computeReasonHash`, `getRegimeState`, `upsertRegimeState`
- Estado migrado: `regimeCache`, `lastRegime`, `dynamicConfig` (sincronizado via `setDynamicConfig()`)
- Dead code eliminado: `regimeAlertThrottle`, `emaMisalignCount`, `REGIME_ALERT_THROTTLE_MS`
- Tipos duplicados eliminados: `PriceData`, `OHLCCandle`, `MarketRegime`, `RegimeAnalysis`, `RegimePreset`, `REGIME_PRESETS`, `REGIME_CONFIG` (ahora importados de `indicators.ts` y `regimeDetection.ts`)
- Imports muertos eliminados: `createHash`, `regimeState`, `RegimeState`, `db`, `eq`, `sql`
- **-268 líneas** (+ ~120 líneas de tipos/imports limpiados)

#### 6. Extracción de SpreadFilter
- Creado `server/services/spreadFilter.ts` — clase `SpreadFilter` con interfaz `ISpreadFilterHost`
- Funciones puras exportadas: `calculateSpreadPct`, `getSpreadThresholdForRegime`
- Métodos movidos: `checkSpreadForBuy`, `sendSpreadTelegramAlert`
- Estado migrado: `spreadAlertCooldowns` (anti-spam cooldown por par+exchange)
- Tipo exportado: `SpreadCheckResult`, `SpreadCheckDetails`
- **-158 líneas**

#### 7. Extracción de MtfAnalyzer
- Creado `server/services/mtfAnalysis.ts` — clase `MtfAnalyzer` con interfaz `IMtfAnalysisHost`
- Funciones puras exportadas: `analyzeTimeframeTrend`, `analyzeMultiTimeframe`, `emitMTFDiagnostic`
- Tipos exportados: `MultiTimeframeData`, `TrendAnalysis`
- Estado migrado: `mtfCache` (cache 5min por par)
- Constantes movidas: `MTF_DIAG_ENABLED`, `MTF_CACHE_TTL`
- Eliminados de tradingEngine.ts: interfaces locales `MultiTimeframeData`, `TrendAnalysis`
- **-149 líneas**

### Reducción total de tradingEngine.ts
- **Antes**: 8865 líneas (original monolítico)
- **Post ExitManager**: 7661 líneas (-1204)
- **Post indicators.ts**: 7430 líneas (-231)
- **Post regimeDetection.ts**: 7207 líneas (-223)
- **Post regimeManager.ts + cleanup**: 6856 líneas (-351)
- **Post spreadFilter.ts**: 6699 líneas (-157)
- **Post mtfAnalysis.ts**: 6549 líneas (-150)
- **Reducción total**: **-2316 líneas (-26.1%)**

### Archivos creados/modificados
- `server/services/__tests__/executeTrade.test.ts` (nuevo)
- `server/services/indicators.ts` (nuevo)
- `server/services/regimeDetection.ts` (nuevo)
- `server/services/regimeManager.ts` (nuevo)
- `server/services/spreadFilter.ts` (nuevo)
- `server/services/mtfAnalysis.ts` (nuevo)
- `server/services/exitManager.ts` (modificado — persistencia throttle)
- `server/services/tradingEngine.ts` (modificado — delegaciones + cleanup)
- `server/storage.ts` (modificado — métodos alert_throttle)
- `shared/schema.ts` (modificado — tabla alert_throttle)

---

## 2026-02-XX — REFACTOR: Extracción de ExitManager desde tradingEngine.ts

### Motivación
- `tradingEngine.ts` era un archivo monolítico de **8865 líneas** con toda la lógica del bot
- La lógica de salida (SL/TP, SmartGuard, Time-Stop, Fee-Gating) estaba fuertemente acoplada
- Difícil de testear, mantener y razonar sobre el flujo de salidas

### Cambios realizados
- **tradingEngine.ts reducido de 8865 → 7660 líneas** (-1205 líneas, ~14%)
- Creado `server/services/exitManager.ts` (1374 líneas) con:
  - Interfaz `IExitManagerHost` para inyección de dependencias (patrón delegación)
  - Clase `ExitManager` con toda la lógica de salida
  - Tipos exportados: `OpenPosition`, `ConfigSnapshot`, `ExitReason`, `FeeGatingResult`

| Método extraído | Descripción | Líneas aprox. |
|----------------|-------------|---------------|
| `checkStopLossTakeProfit` | Dispatcher principal SL/TP | ~50 |
| `checkSinglePositionSLTP` | Legacy SL/TP + reconciliación | ~365 |
| `checkSmartGuardExit` | SmartGuard: BE, Trailing, Scale-out, TP fijo | ~475 |
| `sendSgEventAlert` | Alertas Telegram para eventos SmartGuard | ~115 |
| `shouldSendSgAlert` | Throttle de alertas SG | ~12 |
| `isRiskExit` | Clasificación de exit tipo risk | ~4 |
| `getAdaptiveExitConfig` | Config dinámica de exit desde DB | ~20 |
| `calculateMinCloseNetPct` | Cálculo mínimo neto para cierre | ~4 |
| `checkFeeGating` | Validación fee-gating | ~35 |
| `checkTimeStop` | Time-Stop soft/hard | ~130 |
| `calculateProgressiveBEStop` | Break-even progresivo (3 niveles) | ~40 |

### Patrón de arquitectura
- **Delegación via interfaz**: `TradingEngine` crea un adapter `IExitManagerHost` en `createExitHost()`
- Los métodos privados de `TradingEngine` se exponen al `ExitManager` sin cambiar su visibilidad
- Métodos que aún se usan internamente (`getAdaptiveExitConfig`, `calculateMinCloseNetPct`, etc.) tienen delegaciones thin al `ExitManager`
- Estado movido: `sgAlertThrottle`, `timeStopNotified` ahora pertenecen a `ExitManager`

### Verificación
- `npm run check` (tsc) pasa con **0 errores** después de la extracción
- Toda la funcionalidad de salida mantiene exactamente el mismo comportamiento
- La llamada `this.exitManager.checkStopLossTakeProfit(...)` reemplaza `this.checkStopLossTakeProfit(...)`

### Archivos modificados
- `server/services/tradingEngine.ts` (reducido ~14%)
- `server/services/exitManager.ts` (nuevo — 1374 líneas)

---

## 2026-02-XX — REFACTOR: Modularización completa de routes.ts

### Motivación
- `routes.ts` era un archivo monolítico de **5117 líneas** con todos los endpoints API mezclados
- Difícil de mantener, navegar y debuggear
- Alto riesgo de conflictos en merges

### Cambios realizados
- **routes.ts reducido de 5117 → 821 líneas** (solo orquestador + config/startup)
- Creada interfaz `RouterDeps` en `server/routes/types.ts` para inyección de dependencias
- Extraídos **10 módulos de rutas** por dominio:

| Módulo | Endpoints | Líneas aprox. |
|--------|-----------|---------------|
| `backups.routes.ts` | backup CRUD, restore, download | ~140 |
| `events.routes.ts` | events, server-logs | ~170 |
| `ai.routes.ts` | AI analysis, environment, DB diagnostic | ~300 |
| `test.routes.ts` | test/debug, critical-alert test | ~650 |
| `telegram.routes.ts` | Telegram chat CRUD, send message | ~120 |
| `admin.routes.ts` | purge-*, rebuild-*, legacy-*, backfill, indexes | ~350 |
| `trades.routes.ts` | trades listing, closed, performance, P&L, sync kraken, FIFO, cleanup | ~600 |
| `positions.routes.ts` | open-positions, buy, close, orphan, time-stop | ~480 |
| `market.routes.ts` | market, balance, prices, trade kraken/revolutx, sync-revolutx, reconcile | ~1100 |

### Verificación
- `npm run check` (tsc) pasa con **0 errores** después de cada extracción
- Todos los endpoints mantienen exactamente la misma funcionalidad
- Imports limpiados: solo quedan los necesarios en el orquestador

### Archivos modificados
- `server/routes.ts` (reducido ~84%)
- `server/routes/types.ts` (nuevo)
- `server/routes/backups.routes.ts` (nuevo)
- `server/routes/events.routes.ts` (nuevo)
- `server/routes/ai.routes.ts` (nuevo)
- `server/routes/test.routes.ts` (nuevo)
- `server/routes/telegram.routes.ts` (nuevo)
- `server/routes/admin.routes.ts` (nuevo)
- `server/routes/trades.routes.ts` (nuevo)
- `server/routes/positions.routes.ts` (nuevo)
- `server/routes/market.routes.ts` (nuevo)

---

## 2026-02-19 — AUDITORÍA + FIX: Pipeline de Salidas (BE/Trailing/Exits) + Alertas Telegram

### Problema reportado
- Una venta se tuvo que hacer **manualmente** porque el bot NO ejecutó BE ni trailing.
- No llegaban alertas Telegram de seguimiento (BE armado, trailing actualizado, salida ejecutada).
- Cuando `executeTrade` fallaba (orden rechazada por el exchange), la posición quedaba abierta **sin ningún log ni alerta**.

### Diagnóstico (hipótesis confirmadas)

#### H3 — CONFIRMADA: EXIT_ORDER_FAILED silencioso
En `checkSmartGuardExit` y `checkSinglePositionSLTP`, cuando `executeTrade()` devuelve `false`:
```ts
const success = await this.executeTrade(...);
if (success && ...) { /* Telegram */ }
if (success) { /* cerrar posición */ }
// ← NO había else: fallo silencioso, posición quedaba abierta sin log ni alerta
```

#### Bug adicional: estado BE/trailing no persistido antes de venta
El `savePositionToDB` solo ocurría si `!shouldSellFull && !shouldScaleOut`. Si en el mismo tick se activaba BE y el stop ya estaba cruzado, el estado `sgBreakEvenActivated=true` y `sgCurrentStopPrice` **no se guardaban en DB** antes de intentar la venta. Si la venta fallaba, el estado se perdía en el siguiente restart.

#### Bug adicional: EXIT_MIN_VOLUME_BLOCKED silencioso
Cuando `sellAmount < minVolume`, el bot retornaba silenciosamente sin log ni alerta. La posición quedaba abierta indefinidamente.

### Solución implementada

#### 1. `server/services/botLogger.ts` — Nuevos EventTypes
Añadidos: `EXIT_EVAL`, `EXIT_TRIGGERED`, `EXIT_ORDER_PLACED`, `EXIT_ORDER_FAILED`, `EXIT_MIN_VOLUME_BLOCKED`, `BREAKEVEN_ARMED`, `TRAILING_UPDATED`, `POSITION_CLOSED_SG`, `TRADE_PERSIST_FAIL`

#### 2. `server/services/tradingEngine.ts` — `checkSmartGuardExit`
- **EXIT_EVAL**: log al inicio de cada evaluación (posId, pair, price, beArmed, trailingArmed, stopPrice, thresholds)
- **BREAKEVEN_ARMED**: botLogger.info cuando BE se activa (además del log existente)
- **TRAILING_UPDATED**: botLogger.info cuando trailing step sube
- **Fix crítico**: `savePositionToDB` ahora se llama cuando `positionModified=true` **siempre** (antes solo si `!shouldSellFull && !shouldScaleOut`) → estado BE/trailing persiste aunque la venta falle
- **EXIT_TRIGGERED**: log antes de intentar la orden
- **EXIT_ORDER_PLACED**: log de intento de orden
- **EXIT_ORDER_FAILED**: botLogger.error + alerta Telegram 🚨 cuando `executeTrade` devuelve `false`
- **EXIT_MIN_VOLUME_BLOCKED**: botLogger.warn + alerta Telegram ⚠️ cuando `sellAmount < minVolume`
- **POSITION_CLOSED_SG**: botLogger.info cuando posición se cierra exitosamente

#### 3. `server/services/tradingEngine.ts` — `checkSinglePositionSLTP` (modo legacy)
Mismo patrón: `EXIT_TRIGGERED`, `EXIT_ORDER_PLACED`, `EXIT_ORDER_FAILED` (con Telegram), `EXIT_MIN_VOLUME_BLOCKED` (con Telegram), `POSITION_CLOSED_SG`

#### 4. `server/services/__tests__/exitPipeline.test.ts` — Tests mínimos
11 tests, 31 asserts — todos PASS:
- T1-T3: Break-even (activación, no-activación, stop hit)
- T4-T6: Trailing (activación, update ratchet, stop hit)
- T7: Ultimate SL emergencia
- T8-T9: Idempotencia (BE y trailing no se re-activan)
- T10: Sin precio válido (guard en caller)
- T11: Fixed TP

### Nota técnica: por qué no se ejecutaba BE/trailing
El motor SÍ ejecuta `checkSmartGuardExit` en cada tick (cada `intervalMs` según estrategia). La lógica de BE/trailing era correcta. El problema era:
1. Si `executeTrade` fallaba (ej: balance insuficiente, error de API, minOrderUsd), el fallo era silencioso → nadie sabía que la posición debía cerrarse.
2. El estado BE/trailing no se persistía si la venta se intentaba en el mismo tick que se activó → tras restart, el bot no sabía que BE estaba armado.

### Cómo validar en STG
```bash
# 1. Deploy normal
cd /opt/krakenbot-staging && git pull origin main
docker compose -f docker-compose.staging.yml up -d --build

# 2. Verificar logs de EXIT_EVAL periódicos (cada tick, por posición abierta)
curl "http://5.250.184.18:3020/api/logs?type=EXIT_EVAL&limit=10"

# 3. Cuando precio sube >= beAtPct: verificar BREAKEVEN_ARMED
curl "http://5.250.184.18:3020/api/logs?type=BREAKEVEN_ARMED&limit=5"

# 4. Cuando precio sube >= trailStartPct: verificar SG_TRAILING_ACTIVATED
curl "http://5.250.184.18:3020/api/logs?type=SG_TRAILING_ACTIVATED&limit=5"

# 5. Cuando trailing sube: verificar TRAILING_UPDATED
curl "http://5.250.184.18:3020/api/logs?type=TRAILING_UPDATED&limit=10"

# 6. Cuando stop se cruza: verificar EXIT_TRIGGERED → EXIT_ORDER_PLACED → POSITION_CLOSED_SG
curl "http://5.250.184.18:3020/api/logs?type=EXIT_TRIGGERED&limit=5"
curl "http://5.250.184.18:3020/api/logs?type=POSITION_CLOSED_SG&limit=5"

# 7. Si algo falla: EXIT_ORDER_FAILED aparece en logs Y llega alerta Telegram 🚨
curl "http://5.250.184.18:3020/api/logs?type=EXIT_ORDER_FAILED&limit=5"
```

### Archivos modificados
- `server/services/botLogger.ts` — 9 nuevos EventTypes
- `server/services/tradingEngine.ts` — checkSmartGuardExit + checkSinglePositionSLTP
- `server/services/__tests__/exitPipeline.test.ts` — 11 tests nuevos

---

## 2026-02-09 — FEATURE: Portfolio Summary unificado + P&L profesional (3 métricas)

### Problema
1. **Dashboard "Rendimiento del Portafolio"** mostraba un P&L total calculado con FIFO interno que no coincidía con la suma de `realizedPnlUsd` de los trades individuales.
2. **Terminal header badge** mostraba el mismo valor (unrealized P&L de posiciones abiertas) en ambas pestañas (Posiciones e Historial).
3. El P&L Realizado del Historial era solo de la página visible (paginado), no el total global.
4. FIFO del performance mezclaba buys de Kraken y RevolutX en la misma cola.

### Solución implementada: Opción A + E (3 métricas + endpoint unificado)

#### Nuevo endpoint: `/api/portfolio-summary`
- **Single source of truth** para métricas de P&L del portafolio.
- Devuelve:
  - `realizedPnlUsd` — suma de `realizedPnlUsd` de TODOS los SELLs filled
  - `unrealizedPnlUsd` — suma de (precio actual - entry price) × amount para posiciones abiertas
  - `totalPnlUsd` — realizado + no realizado
  - `todayRealizedPnl` — P&L realizado de hoy
  - `winRatePct`, `wins`, `losses`, `totalSells`, `openPositions`
- Auto-refresh cada 30 segundos en frontend.

#### Dashboard: 3 métricas separadas
- **P&L Realizado** (verde/rojo) — ganancias/pérdidas de trades cerrados
- **P&L No Realizado** (cyan/naranja) — ganancias/pérdidas latentes de posiciones abiertas
- **P&L Total** (verde/rojo con borde primario) — suma de ambos
- Métricas secundarias: Win Rate, Trades (W/L), Max Drawdown, P&L Hoy

#### Terminal: header badge context-aware
- **Tab Posiciones** → "P&L Abierto: +$X.XX" (unrealized global de portfolio-summary)
- **Tab Historial** → "P&L Realizado: -$X.XX" (realized global de portfolio-summary, NO paginado)

#### Fix `/api/performance`
- Acepta `realizedPnlUsd = 0` (antes saltaba al FIFO para trades con P&L exactamente 0)
- FIFO por `pair::exchange` (antes mezclaba Kraken y RevolutX)

### Archivos modificados
- `server/routes.ts` — nuevo endpoint `/api/portfolio-summary`, fix `/api/performance`
- `client/src/components/dashboard/ChartWidget.tsx` — 3 métricas + portfolio-summary query
- `client/src/pages/Terminal.tsx` — portfolio-summary query + header badge context-aware

---

## 2026-02-06 — FEATURE: Filtro de Spread funcional (v2) — Kraken proxy + RevolutX markup

### Problema
El filtro de spread existía en código pero **NUNCA funcionó** (dead code):
- `isSpreadAcceptable()` leía `tickerData.b[0]` / `tickerData.a[0]` (formato Kraken raw)
- Pero se llamaba con `getTicker()` que devuelve `{ bid: number, ask: number }` (tipo `Ticker`)
- Resultado: `bid = 0, ask = 0` → `spreadPct = 0` → **siempre acceptable**
- El umbral era hardcoded: `const MAX_SPREAD_PCT = 0.5`
- `maxSpreadPct` del schema de config nunca se leía
- RevolutX no tiene orderbook fiable → `bid=ask=last` → spread siempre 0

### Solución implementada: Opción B (Kraken proxy + markup RevolutX)

#### Arquitectura
- **Fuente de datos**: siempre `getDataExchange().getTicker()` (Kraken) — única fuente fiable de bid/ask
- **Para Kraken**: `spreadEffective = spreadKraken`
- **Para RevolutX**: `spreadEffective = spreadKraken + revolutxMarkupPct` (configurable, default 0.8%)
- **Un solo punto de decisión**: `checkSpreadForBuy()` llamado desde ambos flujos (cycle + candles)
- **Solo BUY**: nunca bloquea SELL, SL, TP ni forceClose

#### Cálculo
```
mid = (bid + ask) / 2
spreadKrakenPct = ((ask - bid) / mid) * 100
spreadEffectivePct = spreadKrakenPct + (tradingExchange === "revolutx" ? revolutxMarkupPct : 0)
```

#### Umbrales dinámicos por régimen (configurable desde UI)
| Régimen | Default | Descripción |
|---------|---------|-------------|
| TREND | 1.50% | Alto volumen → exigir mejor fill |
| RANGE | 2.00% | Menos volumen → algo más permisivo |
| TRANSITION | 2.50% | Intermedio |
| Cap | 3.50% | Hard limit absoluto (nunca permitir más) |
| Floor | 0.30% | Si spread < floor, siempre OK (micro-ruido) |

Si `dynamicSpread.enabled = false`, usa un umbral fijo `spreadMaxPct`.

#### Fail-safe
Si `bid <= 0` o `ask <= 0`: log `SPREAD_DATA_MISSING` + **no operar** (skip BUY).

#### Alerta Telegram
- Cuando se bloquea una BUY por spread, envía mensaje con:
  - Par, exchange, régimen
  - Spread Kraken, markup RevolutX (si aplica), spread efectivo, umbral
  - Bid/ask
- **Anti-spam**: cooldown configurable por (par + exchange), default 10 min
- **Best-effort**: si Telegram falla, no rompe el motor de trading

#### Log estructurado (SPREAD_REJECTED)
```json
{
  "event": "SPREAD_REJECTED",
  "pair": "BTC/USD",
  "regime": "TREND",
  "tradingExchange": "revolutx",
  "dataExchange": "kraken",
  "bid": 50000.00,
  "ask": 50100.00,
  "mid": 50050.00,
  "spreadKrakenPct": 0.1998,
  "revolutxMarkupPct": 0.80,
  "spreadEffectivePct": 0.9998,
  "thresholdPct": 1.50,
  "decision": "REJECT"
}
```

#### Ejemplo de mensaje Telegram
```
🤖 KRAKEN BOT 🇪🇸
━━━━━━━━━━━━━━━━━━━
🚫 BUY bloqueada por spread

📊 Detalle:
   Par: BTC/USD
   Exchange: revolutx
   Régimen: TREND
   Spread Kraken: 0.200%
   Markup RevolutX: +0.80%
   Spread Efectivo: 1.000%
   Umbral máximo: 1.50%
   Bid: $50000.00 | Ask: $50100.00
⏰ 2026-02-06 21:30:00 UTC
━━━━━━━━━━━━━━━━━━━
```

### Parámetros configurables (UI: Settings → Filtro de Spread)
| Parámetro | Default | Descripción |
|-----------|---------|-------------|
| `spreadFilterEnabled` | true | Activar/desactivar filtro |
| `spreadDynamicEnabled` | true | Umbrales por régimen vs fijo |
| `spreadMaxPct` | 2.00 | Umbral fijo (cuando dynamic=false) |
| `spreadThresholdTrend` | 1.50 | Umbral para régimen TREND |
| `spreadThresholdRange` | 2.00 | Umbral para régimen RANGE |
| `spreadThresholdTransition` | 2.50 | Umbral para régimen TRANSITION |
| `spreadCapPct` | 3.50 | Hard cap absoluto |
| `spreadFloorPct` | 0.30 | Spread < floor → siempre OK |
| `spreadRevolutxMarkupPct` | 0.80 | Estimación adicional para RevolutX |
| `spreadTelegramAlertEnabled` | true | Enviar alerta Telegram al bloquear |
| `spreadTelegramCooldownMs` | 600000 | Cooldown anti-spam (10 min default) |

### Archivos modificados
- `shared/schema.ts` — 11 nuevas columnas en `bot_config` para spread filter
- `shared/config-schema.ts` — `maxSpreadPct` ya existía en `exchangeConfigSchema`
- `server/services/tradingEngine.ts` — Eliminado `MAX_SPREAD_PCT` hardcode, eliminado `isSpreadAcceptable()` roto, nuevo `checkSpreadForBuy()` + `getSpreadThresholdForRegime()` + `sendSpreadTelegramAlert()`
- `server/services/botLogger.ts` — Nuevos eventos: `SPREAD_REJECTED`, `SPREAD_DATA_MISSING`
- `server/services/telegram.ts` — Nuevo subtipo: `trade_spread_rejected`
- `client/src/pages/Settings.tsx` — Card completa "Filtro de Spread" con todos los campos editables
- `db/migrations/013_spread_filter_config.sql` — Migración para nuevas columnas
- `server/services/__tests__/spreadFilter.test.ts` — 30 tests unitarios (cálculo, régimen, floor/cap, markup, missing data)

### Tests
```
npx tsx server/services/__tests__/spreadFilter.test.ts
→ 30 passed, 0 failed ✅
```

---

## 2026-02-06 — FIX: P&L a 0 en gráfica de rendimiento y historial de operaciones

### Problema
El P&L (Profit & Loss) aparecía como **0** o **null** en:
1. **Gráfica "Rendimiento del Portafolio"** (Dashboard → ChartWidget)
2. **Historial de Operaciones** (Terminal → tabla de trades cerrados)

### Causas Raíz Identificadas

#### Causa 1: `/api/performance` incluía trades no-filled con price=0
- `storage.getTrades()` devolvía trades `pending` con `price=0`
- Un BUY pending con `price=0` sobreescribía el precio real del último BUY
- Al llegar un SELL, `lastBuyPrice > 0` era `false` → **P&L no se calculaba**
- Además, solo guardaba UN buy por par (sin FIFO), perdiendo trades parciales

#### Causa 2: `/api/trades/closed` incluía trades no-filled
- El filtro `baseValidity` permitía trades `pending`/`cancelled` en el resultado
- Trades sin `realizedPnlUsd` mostraban `-` en la UI

#### Causa 3: Muchos SELL no tenían P&L calculado en la DB
- FillWatcher inserta trades sin P&L y luego intenta reconciliar con `tryRecalculatePnlForPairExchange`
- Si el reconcile fallaba (exchange/pair mismatch, trades no-filled mezclados), el P&L quedaba `null`
- No existía mecanismo de backfill/reparación masiva

### Cambios Implementados

#### `server/storage.ts`
- **`getFilledTradesForPerformance(limit)`**: Nuevo método que devuelve solo trades `filled` con `price > 0` y `amount > 0`, ordenados por `executedAt`
- **`rebuildPnlForAllSells()`**: Nuevo método de backfill masivo FIFO por par+exchange. Recalcula P&L neto (incluyendo fees) para todos los SELL que tengan `realizedPnlUsd = NULL`. Respeta el orden FIFO y consume cantidades de BUYs previos
- **`getClosedTrades()`**: Filtro cambiado de `baseValidity` (que incluía non-filled) a `status='filled' AND price>0 AND amount>0` explícito
- Ambos métodos añadidos al interface `IStorage` y a `DatabaseStorage`

#### `server/routes.ts`
- **`GET /api/performance`**: Reescrito completamente:
  - Usa `getFilledTradesForPerformance()` en vez de `getTrades()` (solo trades válidos)
  - FIFO con cola de BUYs por par (soporta múltiples buys parciales)
  - **Prioriza `realizedPnlUsd` del DB** cuando existe (más preciso, incluye fees reales)
  - Fallback a cálculo FIFO solo para sells sin P&L en DB
  - Consume FIFO incluso cuando usa P&L del DB para mantener sincronía
- **`POST /api/trades/rebuild-pnl`**: Nuevo endpoint para recalcular P&L masivamente
- **Auto-rebuild al startup**: 10s después de arrancar, ejecuta `rebuildPnlForAllSells()` en background

#### `client/src/pages/Terminal.tsx`
- **Botón "Recalcular P&L"** en el header del Historial de Operaciones
- Mutation `rebuildPnlMutation` que llama a `POST /api/trades/rebuild-pnl`
- Invalida queries de `closedTrades` y `performance` tras éxito
- Indicador de loading (spinner) durante la operación

### Archivos Modificados (v1)
- `server/storage.ts` — 2 nuevos métodos + interface + fix filtro getClosedTrades
- `server/routes.ts` — rewrite /api/performance + nuevo endpoint rebuild-pnl + auto-rebuild startup
- `client/src/pages/Terminal.tsx` — botón Recalcular P&L + mutation

### Fix v2 — Correcciones adicionales P&L

#### Problema residual: BUY trades mostraban "$0.0%" en P&L
- Algunos BUY tenían `realizedPnlUsd = "0.00000000"` en la DB (string truthy)
- El API y frontend los interpretaban como P&L = 0 y mostraban "+$0.00 (+0.0%)"
- **Fix**: Solo devolver/mostrar `realizedPnlUsd` cuando `trade.type === 'sell'`

#### Auto-rebuild P&L después de cada sync
- **Kraken sync** (`POST /api/trades/sync`): Ya calculaba P&L inline, ahora también ejecuta `rebuildPnlForAllSells()` para cubrir sells sin match
- **RevolutX sync** (`POST /api/trades/sync-revolutx`): NO calculaba P&L → ahora ejecuta `rebuildPnlForAllSells()` automáticamente
- Respuesta de ambos endpoints incluye `pnlRebuilt` con el número de trades actualizados

#### Flujo automático de P&L (sin intervención manual)
1. **Al cerrar posición** → `tradingEngine.forceClosePosition()` guarda P&L directamente
2. **FillWatcher** → Detecta fill de sell → `tryRecalculatePnlForPairExchange()`
3. **Sync Kraken/RevolutX** → Después de importar trades → `rebuildPnlForAllSells()`
4. **Startup del servidor** → 10s después de arrancar → `rebuildPnlForAllSells()`
5. **Manual** → Botón "Recalcular P&L" en Terminal (último recurso)

#### Archivos Modificados (v2)
- `server/routes.ts` — `/api/trades/closed`: solo P&L para SELL; sync-kraken y sync-revolutx: auto-rebuild
- `client/src/pages/Terminal.tsx` — Solo mostrar P&L para SELL trades

---

## 2026-02-01 — FEAT: Hybrid Guard (Re-entry) para señales BUY filtradas (ANTI_CRESTA / MTF_STRICT)

### Objetivo
Cuando una señal BUY es filtrada por:
- `ANTI_CRESTA` (anti-fomo / compra tardía sobre EMA20 con volumen alto)
- `MTF_STRICT` (filtro multi-timeframe estricto)

…se crea un “watch” temporal. Si en ciclos posteriores el mercado mejora (pullback a EMA20 o mejora MTF), el bot puede re-intentar la entrada sin perder el contexto.

### Cambios implementados

#### Base de datos (migraciones)
- `db/migrations/006_hybrid_reentry_watches.sql`
  - Crea tabla `hybrid_reentry_watches` + índices para lookup de watches activos y cleanup.
- `db/migrations/012_order_intents_hybrid_guard.sql`
  - Añade columnas a `order_intents`:
    - `hybrid_guard_watch_id` (INT)
    - `hybrid_guard_reason` (TEXT)

#### Startup / Migración automática
- `script/migrate.ts`
  - Asegura que se aplican:
    - `007_order_intents.sql`
    - `012_order_intents_hybrid_guard.sql`
  - Mantiene `006_hybrid_reentry_watches.sql` en el flujo de migración.

#### Schema compartido (Drizzle)
- `shared/schema.ts`
  - Añade tabla `hybrid_reentry_watches` (Drizzle) y tipos:
    - `HybridReentryWatch`
    - `InsertHybridReentryWatch`
  - Extiende `order_intents` con:
    - `hybridGuardWatchId`
    - `hybridGuardReason`

#### Storage (DB layer)
- `server/storage.ts`
  - Implementa métodos Hybrid Guard:
    - `getActiveHybridReentryWatch`
    - `recentlyCreatedHybridReentryWatch`
    - `insertHybridReentryWatch`
    - `markHybridReentryWatchTriggered`
    - `expireHybridReentryWatches`
    - `countActiveHybridReentryWatchesForPair` (para respetar `maxActiveWatchesPerPair`)

#### Trading Engine (core)
- `server/services/tradingEngine.ts`
  - Crea watch al bloquear BUY por `ANTI_CRESTA` o `MTF_STRICT`.
  - Re-entry:
    - `ANTI_CRESTA`: permite re-entry si `|priceVsEma20Pct| <= reentryMaxAbsPriceVsEma20Pct`.
    - `MTF_STRICT`: permite re-entry si `mtfAlignment >= reentryMinAlignment`.
  - Respeta límites:
    - `maxActiveWatchesPerPair`.
    - TTL (`ttlMinutes`) y cooldown (`cooldownMinutes`).
  - Persistencia de trazabilidad:
    - Propaga `hybridGuard` hacia `executionMeta` y lo guarda en `order_intents`.
  - Seguridad:
    - En `DRY_RUN` no marca watches como `triggered`.

#### Telegram
- `server/services/telegram.ts`
  - Nuevas alertas Hybrid Guard:
    - `sendHybridGuardWatchCreated`
    - `sendHybridGuardReentrySignal`
    - `sendHybridGuardOrderExecuted`

#### Config / UI
- `shared/config-schema.ts`
  - Añade `global.hybridGuard` con defaults y validación Zod.
- `server/services/ConfigService.ts`
  - Normaliza configs con Zod para aplicar defaults (incluye `global.hybridGuard`).
- `client/src/components/dashboard/TradingConfigDashboard.tsx`
  - Sección de configuración Hybrid Guard en el dashboard.


## 2026-01-31 — FIX CRÍTICO: SELL RevolutX (pendingFill) se ejecuta pero no aparece en Operaciones

### Síntoma
- Telegram notifica: `⏳ Orden SELL enviada` (pendiente de confirmación)
- RevolutX confirma la ejecución (orden completada)
- En el panel del bot NO aparece la operación (tabla `trades` sin registro)

### Caso real (STAGING)
- `order_intents.id=23`
- `client_order_id=ac3bf6b8-7316-4537-8c5b-c03e884509aa`
- `exchange_order_id=b77ddd5b-f299-4a9d-a83d-413bf803d604`
- BotEvents:
  - `SG_EMERGENCY_STOPLOSS` (caída ~-12%)
  - `ORDER_ATTEMPT`
  - `ORDER_PENDING_FILL`

### Causa Raíz
En RevolutX, algunas órdenes retornan `pendingFill=true` (aceptadas sin fill inmediato). Para SELL:
- Se enviaba el mensaje de Telegram.
- Se persistía `order_intent` como `accepted`.
- Pero NO se garantizaba la reconciliación del fill → no se insertaba el trade en `trades`.

### Solución Implementada
1) `server/services/tradingEngine.ts`:
- Iniciar `FillWatcher` también para órdenes SELL en `pendingFill`.

2) `server/services/FillWatcher.ts`:
- Persistir el trade aunque no exista `open_position` (caso SELL).
- En verificación por timeout (late fill), persistir trade y tratar como éxito incluso sin posición.
- `fillId` derivado de `getOrder` ahora es estable (`${exchangeOrderId}-fill`) para evitar duplicados.

### Impacto
- ✅ Los SELL `pendingFill` quedan persistidos en `trades`.
- ✅ El historial de Operaciones refleja la venta.
- ✅ Se evita que un SELL ejecutado quede “invisible” en UI.

### Nota (migraciones)
- Se ajustó `db/migrations/005_trades_origin_and_dedupe.sql` para ignorar `duplicate_table` (42P07) al recrear la constraint `trades_exchange_pair_trade_id_key`, evitando logs de error no-bloqueantes en startup.

### Mejora UI (trazabilidad)
- `client/src/pages/Terminal.tsx`: En **Posiciones Abiertas**, se muestra el `lotId` completo y un botón para copiar el lote (evita tener que buscar el ID en DB cuando hay incidencias/duplicados).

### Fix trazabilidad de build (BUILD_COMMIT)
- Problema: en contenedor aparecía `/bin/sh: git: not found` y `[startup] BUILD_COMMIT: unknown`.
- `server/services/environment.ts`: `getGitCommit()` deja de ejecutar `git` vía shell y usa `spawnSync` (silencioso) solo como fallback, priorizando `VERSION`.
- `server/services/BackupService.ts`: métricas de backup leen `VERSION` para `botVersion` y evitan dependencia de `git` dentro del contenedor.
- `Dockerfile`: prioriza `VERSION` existente (no lo sobreescribe si tiene hash) y solo usa `GIT_COMMIT` como fallback.
- `scripts/stamp-version.sh`: estampa `VERSION` en el VPS antes del build (`git rev-parse --short HEAD`) sin incluir `.git` en el build context.
- `scripts/deploy-staging.sh`: helper para hacer el deploy de STAGING con `VERSION` estampado.

## 29-ENE-2026: Fix conflicto de doble instancia en ErrorAlertService

**Problema identificado:**
- ErrorAlertService creaba una NUEVA instancia de TelegramService al enviar alertas
- El bot principal ya estaba corriendo con su propia instancia haciendo polling
- Dos instancias intentando polling → Error 409 Conflict de Telegram
- ErrorAlertService detectaba "bot not initialized" y no enviaba alertas

**Análisis del problema:**
- **Instancia 1**: Bot principal (inicializado al startup) haciendo polling con lock
- **Instancia 2**: ErrorAlertService creaba nueva instancia para enviar alertas
- **Conflicto**: `ETELEGRAM: 409 Conflict: terminated by other getUpdates request`
- **Resultado**: ErrorAlertService no podía enviar alertas críticas ni de rechazo

**Solución aplicada (2 commits):**

**Commit 1 (a5dba88): Inyectar instancia global**
```typescript
// server/routes.ts (líneas 138-140)
// Inyectar telegramService global en ErrorAlertService para evitar conflictos 409
errorAlertService.setTelegramService(telegramService);
console.log("[startup] TelegramService injected into ErrorAlertService");
```

**Commit 2 (e95f923): Modificar getTelegramService() para usar instancia inyectada**
```typescript
// server/services/ErrorAlertService.ts (líneas 54-73)
private async getTelegramService(): Promise<any> {
  // Si ya hay una instancia inyectada, usarla (evita conflicto 409)
  if (this.telegramService) {
    return this.telegramService;
  }
  
  // Import dinámico solo cuando se necesita (ESM compatible)
  const telegramModule = await import("./telegram");
  this.telegramService = new telegramModule.TelegramService();
  // ... inicialización solo si no hay instancia inyectada
}
```

**Verificación del fix:**
- ✅ `[startup] TelegramService injected into ErrorAlertService` en logs
- ✅ Alertas críticas llegan al chat `-1003504297101`
- ✅ Sin errores 409 en logs de Telegram
- ✅ Endpoint `/api/test/critical-alert` funciona correctamente

**Nota sobre alertas de rechazo:**
- Las alertas de rechazo (`sendSignalRejectionAlert`) solo se activan para `MTF_STRICT` y `ANTI_CRESTA`
- Rechazos por `MIN_ORDER_ABSOLUTE` no usan este sistema (por diseño)
- Para probar alertas de rechazo se necesita una señal real que sea filtrada por MTF/Anti-Cresta

**Impacto:**
- ✅ ErrorAlertService reutiliza instancia global del bot
- ✅ Eliminado conflicto de doble polling
- ✅ Sistema de alertas completamente funcional
- ✅ Alertas críticas y de rechazo operativas (cuando corresponde)

---

## 2026-01-29 20:32 — FIX: HTML inválido en alertas críticas de Telegram

### Problema Detectado
Las alertas críticas fallaban con error 400 de Telegram: "Tag 'span' must have class 'tg-spoiler'". El HTML usaba etiquetas `<span>` con estilos CSS que Telegram no permite.

### Solución Implementada
Reemplazar etiquetas `<span style="color: ...">` con emojis para indicar severidad:

```typescript
// Antes (causaba error 400):
MEDIUM: '<span style="color: #FFA500">', // Naranja
HIGH: '<span style="color: #FF4444">', // Rojo fuerte
CRITICAL: '<span style="color: #FF0000; font-weight: bold">' // Rojo brillante

// Después (compatible con Telegram):
MEDIUM: '🟡', // Amarillo/naranja
HIGH: '🔴', // Rojo
CRITICAL: '🚨' // Rojo crítico
```

### Archivos Modificados
- `server/services/ErrorAlertService.ts` - Reemplazado HTML span con emojis para severidad

### Impacto
- ✅ Alertas críticas ahora se envían correctamente a Telegram
- ✅ Elimina error 400 "can't parse entities"
- ✅ Más visual y compatible con formato de Telegram

---

## 2026-01-29 19:59 — MEJORA: Endpoint de test para alertas críticas

### Problema Detectado
No había forma de probar que las alertas críticas se enviaban correctamente al chat configurado sin generar un error real.

### Solución Implementada
Nuevo endpoint `/api/test/critical-alert` para enviar alertas críticas de prueba.

```bash
curl -X POST http://localhost:3020/api/test/critical-alert \
  -H "Content-Type: application/json" \
  -d '{"type":"PRICE_INVALID","message":"Test de alerta","pair":"BTC/USD"}'
```

### Archivos Modificados
- `server/routes.ts` - Añadido endpoint `/api/test/critical-alert` dentro de `registerRoutes()`

### Impacto
- ✅ Permite verificar configuración de alertas críticas por chat
- ✅ Útil para testing de integración con Telegram

---

## 2026-01-29 14:45 — MEJORA: Filtros Avanzados Anti-Cresta y MTF Estricto + Alertas de Rechazo

### Problema Detectado
Análisis de las posiciones abiertas del **28/01/2026** que quedaron en negativo:
- **SOL/USD 20:00** - Entró con 5/0 señales pero SIN confirmación MTF → -2.44%
- **SOL/USD 21:30** - Entró con 4/1 señales pero SIN confirmación MTF → -2.37%
- **ETH/USD 21:15** - Entró con volumen 2.1x en sobrecompra → -2.28%
- **ETH/USD 20:00** - Entró con confirmación MTF → -0.70% (menor pérdida)

**Patrón identificado:** Compras en regímenes TRANSITION sin suficiente confirmación MTF, y compras tardías con volumen alto (cresta).

### Solución Implementada

#### 1) Filtro MTF Estricto por Régimen
Nuevos umbrales en `applyMTFFilter()`:
- **TRANSITION**: Exige MTF alignment >= 0.30 para compras
- **RANGE**: Exige MTF alignment >= 0.20 para compras

```typescript
if (regime === "TRANSITION" && mtf.alignment < 0.3) {
  return { filtered: true, reason: "MTF insuficiente en TRANSITION", filterType: "MTF_STRICT" };
}
```

#### 2) Filtro Anti-Cresta (evita compras tardías)
Bloquea compras cuando se detecta:
- Volumen > 1.5x del promedio de 20 períodos
- Y precio > 1% sobre EMA20

```typescript
if (volumeRatio > 1.5 && priceVsEma20Pct > 0.01) {
  return { action: "hold", reason: "Anti-Cresta: Volumen alto en sobrecompra" };
}
```

#### 3) Alertas de Telegram para Rechazos Específicos
Nueva función `sendSignalRejectionAlert()` que envía alerta detallada cuando:
- Filtro **MTF_STRICT** bloquea una señal BUY
- Filtro **ANTI_CRESTA** bloquea una señal BUY

Incluye snapshot JSON copiable para debugging.

#### 4) Chat de destino configurable (por tipo de alerta)
- Las alertas de rechazo pueden enviarse a **un chat específico** (o a todos) vía UI.
- Las alertas de errores críticos ahora respetan el chat seleccionado en UI también cuando se envían desde `TelegramService`.

### Archivos Modificados
- `server/services/telegram.ts` - Nueva función `sendSignalRejectionAlert()` con configuración
- `server/services/tradingEngine.ts`:
  - `applyMTFFilter()` - Añadido parámetro `regime` y umbrales estrictos
  - `analyzeWithCandleStrategy()` - Añadido filtro anti-cresta y alertas de rechazo
- `shared/schema.ts` - Campos `signalRejectionAlertsEnabled` y `signalRejectionAlertChatId` en tabla `botConfig`
- `server/storage.ts` - Health-check + auto-migración de schema para nuevos campos
- `client/src/pages/Notifications.tsx` - Toggle y selector de chat para alertas de rechazo, y corrección de selector de chat de errores críticos

### Impacto Esperado
- ✅ Evitaría 2/4 compras problemáticas del 28/01 (SOL sin MTF)
- ✅ Evitaría compras tardías en momentum agotado
- ✅ Alertas informativas para análisis posterior
- ✅ Reduce compras contra tendencia mayor en regímenes inestables

---

## 2026-01-27 13:25 — MEJORA: Allowlist centralizada de pares activos (evita 404 por pares no soportados)

### Problema Detectado
El backend intentaba consultar precios en RevolutX para activos presentes en el balance pero **no operados por el bot** (ej.: `LMWR`).
Esto generaba spam de logs con errores 404 al construir pares como `LMWR-USD` y llamar endpoints de market data.

### Solución Implementada

#### 1) Allowlist centralizada basada en `botConfig.activePairs`
Se agregó un helper reutilizable para:
- Tomar `botConfig.activePairs` como **fuente de verdad**.
- Normalizar formato de par (`BTC-USD` -> `BTC/USD`).
- Validar si un par está permitido antes de ejecutar llamadas a RevolutX.

#### 2) Filtrado preventivo en `/api/prices/portfolio`
Antes, el endpoint intentaba `revolutXService.getTicker()` para cualquier asset del balance.
Ahora, solo consulta RevolutX si el par derivado está en allowlist.

#### 3) Validación en `/api/trade/revolutx`
Se valida que el par solicitado esté en allowlist y se normaliza el par para evitar inconsistencias (`BTC-USD` vs `BTC/USD`).

### Archivos Modificados
- `server/services/pairAllowlist.ts` (nuevo)
- `server/routes.ts`

### Impacto
- ✅ Evita errores 404 por pares no operados por el bot (ej.: `LMWR-USD`)
- ✅ Logs más limpios (menos ruido de endpoints inexistentes)
- ✅ Reduce llamadas innecesarias a la API de RevolutX
- ✅ Enforce consistente de pares activos para trading manual RevolutX

---

## 2026-01-26 15:30 — FIX CRÍTICO: Órdenes RevolutX Marcadas Como FAILED Incorrectamente

### Problema Detectado
**Síntoma:** Orden ejecutada exitosamente en RevolutX pero marcada como FAILED en el sistema. La alerta de Telegram muestra "La orden fue aceptada por revolutx" pero la posición termina en estado FAILED.

**Causa Raíz:** 
1. RevolutX acepta la orden pero no retorna precio inmediatamente (`pendingFill: true`)
2. FillWatcher inicia polling cada 3s buscando fills
3. `fetchFillsForOrder()` solo retorna fills si `averagePrice > 0`, ignorando órdenes con `filledSize > 0` pero precio pendiente
4. Después de 2 minutos sin detectar fills, FillWatcher marca la posición como FAILED
5. **El problema:** FillWatcher NO verificaba el estado real de la orden en el exchange antes de marcar como FAILED

### Correcciones Implementadas

#### 1. Verificación de Estado Real en Timeout (`FillWatcher.ts` líneas 93-188)

**Antes:**
```typescript
if (elapsed > timeoutMs && totalFilledAmount === 0) {
  await storage.markPositionFailed(clientOrderId, 'Timeout: No fills received');
  return;
}
```

**Después:**
```typescript
if (elapsed > timeoutMs && totalFilledAmount === 0 && exchangeOrderId) {
  // CRITICAL FIX: Verificar estado real de la orden en el exchange
  const order = await exchangeService.getOrder(exchangeOrderId);
  if (order.status === 'FILLED' && order.filledSize > 0) {
    // Orden fue FILLED - procesar fill tardío
    let price = order.averagePrice || order.executedValue / order.filledSize;
    // Crear fill sintético y actualizar posición
    await storage.updatePositionWithFill(clientOrderId, {...});
    await botLogger.info('ORDER_FILLED_LATE', ...);
    return; // Éxito - NO marcar como FAILED
  }
  // Solo marcar FAILED si verificación confirma que no hay fills
  await storage.markPositionFailed(clientOrderId, 'Timeout after verification');
}
```

#### 2. Derivación de Precio en `fetchFillsForOrder()` (`FillWatcher.ts` líneas 325-352)

**Antes:**
```typescript
if (order && order.filledSize > 0 && order.averagePrice > 0) {
  return [fill]; // Solo si averagePrice está disponible
}
```

**Después:**
```typescript
if (order && order.filledSize > 0) {
  let price = order.averagePrice || 0;
  if (price <= 0 && order.executedValue && order.filledSize > 0) {
    price = order.executedValue / order.filledSize; // Derivar precio
  }
  if (price > 0) {
    return [fill]; // Retornar fill con precio derivado
  }
}
```

#### 3. Nuevo Evento de Log (`botLogger.ts`)

Agregado tipo de evento `ORDER_FILLED_LATE` para rastrear fills detectados después del timeout.

### Flujo Corregido

```
1. RevolutX acepta orden → pendingFill: true
2. Posición PENDING_FILL creada
3. FillWatcher inicia polling
4. Si timeout SIN fills detectados:
   ├─ Verificar estado real en exchange
   ├─ Si FILLED → Procesar fill tardío ✅
   └─ Si NO FILLED → Marcar FAILED ❌
5. Posición actualizada correctamente
```

### Archivos Modificados
- `server/services/FillWatcher.ts` - Verificación en timeout + derivación de precio
- `server/services/botLogger.ts` - Nuevo evento ORDER_FILLED_LATE

### Impacto
- ✅ Elimina falsos positivos de órdenes FAILED
- ✅ Reconciliación automática de fills tardíos
- ✅ Mejor trazabilidad con evento ORDER_FILLED_LATE
- ✅ Previene pérdida de posiciones exitosas

---

## 2026-01-26 21:15 — FIX DEFINITIVO: PENDING_FILL se quedaba colgado aunque RevolutX ya estaba FILLED (tras restart)

### Problema Detectado
**Síntoma:** En UI quedaba una posición `PENDING_FILL` con `Cantidad=0` y `Precio Entrada=$0`, pero en RevolutX la compra estaba **Ejecutada** (FILLED) al instante.

**Caso real (TON/USD):**
- RevolutX `GET /api/1.0/orders/{id}` devolvía:
  - `filled_quantity > 0`
  - `average_fill_price > 0`
  - `status = filled`

### Causas Raíz
1. **Parsing incompleto en `getOrder()`**: RevolutX devuelve `average_fill_price`, pero el parser solo contemplaba `average_price/avg_price`, resultando en `averagePrice=0` aunque la orden estuviera llena.
2. **Watcher perdido tras reinicio**: `FillWatcher` corre en memoria. Si el contenedor se reinicia, una posición `PENDING_FILL` existente en BD puede quedarse “huérfana” si no se relanza el watcher.

### Correcciones Implementadas

#### 1) `RevolutXService.getOrder()` ahora parsea `average_fill_price`
- Se agregaron aliases `average_fill_price` / `avg_fill_price` para poblar `averagePrice`.
- Se añadió parsing de `created_date` (epoch ms) para `createdAt`.

**Commit:** `455f1ac` (RevolutX getOrder parse average_fill_price)

#### 2) Recovery automático en startup: relanzar FillWatcher para PENDING_FILL
- Al iniciar el engine:
  - `storage.getPendingFillPositions(exchange)`
  - `startFillWatcher()` por cada posición, usando `venueOrderId`.
  - Rehidrata `pendingFillExposure` (para SmartGuard) y la limpia al abrir/timeout.

**Commit:** `2b4693a` (Recover PENDING_FILL positions on startup)

#### 3) (Complementario) Error claro en compras manuales cuando no hay USD
- `manualBuyForTest()` valida balance del quote (USD) antes de enviar orden y devuelve error claro (disponible vs requerido con buffer).

**Commit:** `9e01b4d`

### Verificación (Evidencia)
- Logs:
  - `[PENDING_FILL_RECOVERY] Restarting FillWatcher for TON/USD ...`
  - `[FillWatcher] Found fill via getOrder: 0.98749 @ 1.5258`
  - `[storage] Updated position TON/USD with fill ... avgPrice=1.52580000`
- BD (`open_positions.id=28`): `status=OPEN`, `total_amount_base=0.98749000`, `average_entry_price=1.52580000`.

### Impacto
- ✅ PENDING_FILL ya no queda colgado tras reinicios
- ✅ Si RevolutX devuelve `average_fill_price`, se abre la posición con precio real
- ✅ Reduce falsos FAILED por timeouts y elimina “0 @ $0”

---

## 2026-01-25 21:30 — FIX CRÍTICO: Time-Stop ahora funciona en SMART_GUARD

### Problema Detectado
El Time-Stop **NO SE EVALUABA** en posiciones SMART_GUARD porque `checkSmartGuardExit()` hacía `return` sin verificar el tiempo de vida de la posición.

### Corrección
Integrado Time-Stop al inicio de `checkSmartGuardExit()`:

```typescript
// Línea 2964-3051: Time-Stop check en SMART_GUARD
if (!position.timeStopDisabled) {
  if (ageHours >= timeStopHours) {
    if (timeStopMode === "hard") {
      // Cierre forzado (anula SmartGuard)
      await executeTrade(...)
      return;
    } else {
      // SOFT: Solo alerta, SmartGuard sigue gestionando
      await sendAlertWithSubtype(..., "trade_timestop")
      // Continúa con lógica de SmartGuard
    }
  }
}
```

### Comportamiento Actual

| Modo | Posición Normal | Posición SMART_GUARD |
|------|-----------------|----------------------|
| **SOFT** | Alerta + espera profit 1.8% | Alerta + **SmartGuard sigue gestionando** |
| **HARD** | Alerta + cierre forzado | Alerta + **cierre forzado (anula SG)** |

### Botón Desactivar Time-Stop
- ✅ Endpoint `/api/positions/:lotId/time-stop` funciona
- ✅ Frontend muestra icono Timer/TimerOff según estado
- ✅ Campo `timeStopDisabled` en BD se respeta en ambos modos

---

## 2026-01-25 19:30 — CORRECCIÓN MÚLTIPLE: Time-Stop Robusto y Configurable

### 4 Puntos Corregidos

#### 1. SOFT Mode: Sin Cierre Forzado
**Problema**: El modo SOFT cerraba posiciones automáticamente a las 150% del tiempo (ej: 54h si timeStop=36h).
**Corrección**: Eliminado cierre forzado. Ahora SOFT solo cierra si hay profit suficiente o el usuario cierra manualmente.

```typescript
// ANTES: Cerraba automáticamente a 150% del tiempo
const maxAbsoluteHours = timeStopHours * 1.5;
if (ageHours >= maxAbsoluteHours) { shouldClose: true }

// DESPUÉS: Solo espera profit o cierre manual
// shouldClose: false hasta que priceChange >= minCloseNetPct
```

#### 2. TimeStopHours: Verificación
**Hallazgo**: `timeStopHours` es global (no por activo), configurable en Settings.tsx y `bot_config`.
- Default: 36h
- Rango: 6-120h
- Los 48h que viste eran probablemente un valor configurado anteriormente.

#### 3. TakerFeePct: Usa Fee del Exchange Activo
**Problema**: `getAdaptiveExitConfig()` usaba fee hardcodeado de BD (default 0.40%).
**Corrección**: Ahora usa `getTradingFees()` que devuelve fee del exchange activo:
- Kraken: 0.40%
- Revolut: 0.09%

```typescript
// ANTES
takerFeePct: parseFloat(config?.takerFeePct?.toString() ?? "0.40")

// DESPUÉS
const exchangeFees = this.getTradingFees();
takerFeePct: exchangeFees.takerFeePct
```

#### 4. UI: Toggle de Alertas Time-Stop en Notificaciones
**Nuevo**: Agregado toggle `trade_timestop` en la UI de Notificaciones.
- Usuarios pueden activar/desactivar alertas Time-Stop por chat
- Respeta preferencias usando `sendAlertWithSubtype(..., "trade_timestop")`

### Archivos Modificados
- `server/services/tradingEngine.ts`:
  - Eliminado bloque de cierre forzado a 150%
  - `getAdaptiveExitConfig()` usa fees del exchange activo
  - Alertas usan `sendAlertWithSubtype` con subtype `trade_timestop`
- `server/services/telegram.ts`:
  - Agregado `trade_timestop` al tipo `AlertSubtype`
- `client/src/pages/Notifications.tsx`:
  - Agregado toggle "Time-Stop" en categoría Trades

### Comportamiento Final SOFT Mode
1. Al llegar a `timeStopHours` → Alerta "Time-Stop Alcanzado"
2. Espera profit suficiente (>= minCloseNetPct) → Cierra automáticamente
3. Sin profit → **NO cierra** → Usuario puede cerrar manualmente
4. **Sin cierre forzado a 150%**

### Comportamiento Final HARD Mode
1. Al llegar a `timeStopHours` → Alerta "Cierre Inmediato" + Cierra automáticamente

---

## 2026-01-25 14:20 — FIX CRÍTICO: Exposición no contaba posiciones PENDING_FILL

### Problema Reportado
Una posición SOL/USD se creó a las 12:45 cuando el límite de exposición ya estaba alcanzado. El siguiente ciclo de scan (12:50) bloqueó correctamente por exposición, pero la orden ya había sido enviada.

### Causa Raíz
La verificación de exposición usaba `this.openPositions` (memoria) que NO incluía posiciones `PENDING_FILL`:
- Verificación de **slots** (BD): Incluía PENDING_FILL ✓
- Verificación de **exposición** (memoria): NO incluía PENDING_FILL ✗

Las posiciones PENDING_FILL tienen `amount: '0'` y `entryPrice: '0'` en BD, por lo que aunque se cargaran, su contribución a la exposición era 0.

### Solución
Implementado **tracking de exposición pendiente** en memoria:

```typescript
// Nuevo Map para trackear exposición de posiciones PENDING_FILL
private pendingFillExposure: Map<string, { pair: string; expectedUsd: number }> = new Map();

// calculatePairExposure y calculateTotalExposure ahora incluyen pendingFillExposure
private calculatePairExposure(pair: string): number {
  let total = 0;
  // OPEN positions
  this.openPositions.forEach((position) => {...});
  // PENDING_FILL positions
  this.pendingFillExposure.forEach((pending) => {...});
  return total;
}
```

**Ciclo de vida del tracking:**
1. `addPendingExposure()` - Al crear posición PENDING_FILL
2. `removePendingExposure()` - Cuando posición pasa a OPEN, timeout, o se carga desde BD
3. `clearAllPendingExposure()` - Al iniciar el engine (limpiar datos stale)

### Archivos Modificados
- `server/services/tradingEngine.ts`:
  - Líneas 483-485: Nuevo Map `pendingFillExposure`
  - Líneas 1135-1186: Funciones de cálculo y tracking de exposición
  - Línea 1869: Limpieza al inicio del engine
  - Línea 2026: Limpieza al cargar posición desde BD
  - Líneas 6476-6478: Añadir exposición al crear PENDING_FILL
  - Líneas 6504-6510: Remover exposición en callbacks de FillWatcher
  - Líneas 6727-6728, 6825-6826: Remover exposición al confirmar posición

### Impacto
- La exposición ahora cuenta PENDING_FILL positions correctamente
- No se pueden crear nuevas órdenes si hay órdenes pendientes que ya ocupan la exposición
- Previene sobre-asignación de capital cuando hay órdenes en vuelo

---

## 2026-01-25 16:45 — MEJORA: Alertas Telegram para Time-Stop en ambos modos

### Mejora Solicitada
Añadir alertas Telegram cuando una posición alcanza el Time-Stop, tanto en modo SOFT como HARD.

### Cambios Realizados
- **Modo SOFT**: Ya existía alerta, se añadió nota sobre cierre manual
- **Modo HARD**: Nueva alerta Telegram notificando cierre inmediato

### Archivos Modificados
- `server/services/tradingEngine.ts`:
  - Líneas 744-760: Alerta Telegram para modo HARD
  - Línea 823: Nota sobre cierre manual en modo SOFT

### Alertas Enviadas

**Modo SOFT (cuando expira):**
```
⏰ Posición en espera
📦 Detalles: Par, tiempo abierta, límite, cierre forzado
📊 Estado: Ganancia actual, mínimo para cerrar
💡 La posición se cerrará cuando supere X% o al llegar a 54h
⚠️ Puedes cerrarla manualmente si lo prefieres
```

**Modo HARD (cuando expira):**
```
⏰ Time-Stop HARD - Cierre Inmediato
📦 Detalles: Par, tiempo abierta, límite
📊 Estado: Ganancia actual
⚡ ACCIÓN: La posición se cerrará INMEDIATAMENTE [modo HARD]
```

### Impacto
- Notificación inmediata cuando Time-Stop se activa
- Opción de intervención manual en modo SOFT
- Claridad sobre acción automática en modo HARD

---

## 2026-01-25 19:05 — MEJORA ROBUSTA: Refactorización del Sistema de Alertas Time-Stop

### Problemas Identificados en Revisión
1. **Configuración Hardcodeada**: Las funciones usaban valores fijos (36h, soft) en lugar de leer de BD
2. **Código Duplicado**: Alertas Telegram repetidas en 3 lugares diferentes
3. **Sin Manejo de Errores**: getTicker(), sendAlertToMultipleChats() y savePositionToDB() sin try/catch
4. **Sin Estadísticas**: Endpoints no devolvían información útil sobre alertas enviadas

### Solución Implementada

#### 1. Helper para Construir Mensajes (`buildTimeStopAlertMessage`)
```typescript
private buildTimeStopAlertMessage(
  pair: string,
  ageHours: number,
  timeStopHours: number,
  timeStopMode: "soft" | "hard",
  priceChange: number,
  minCloseNetPct: number
): string
```
- Centraliza la construcción de mensajes de alerta
- Elimina duplicación de código
- Facilita mantenimiento futuro

#### 2. Helper para Enviar Alertas (`sendTimeStopAlert`)
```typescript
private async sendTimeStopAlert(
  position: OpenPosition,
  exitConfig: { takerFeePct; profitBufferPct; timeStopHours; timeStopMode }
): Promise<{ success: boolean; error?: string }>
```
- Manejo de errores robusto con try/catch
- Valida Telegram inicializado
- Captura errores de getTicker() y sendAlertToMultipleChats()
- Retorna resultado con error detallado si falla

#### 3. Configuración Dinámica desde BD
```typescript
// ANTES (hardcodeado):
const exitConfig = { timeStopHours: 36, timeStopMode: "soft" };

// DESPUÉS (dinámico):
const exitConfig = await this.getAdaptiveExitConfig();
```
- Usa `getAdaptiveExitConfig()` que lee de `bot_config` en BD
- Respeta cambios de configuración sin necesidad de redeploy

#### 4. Estadísticas de Ejecución
```typescript
// checkExpiredTimeStopPositions() retorna:
{ checked: number; alerted: number; errors: number }

// forceTimeStopAlerts() retorna:
{ checked: number; alerted: number; errors: number; skipped: number }
```
- Endpoint `/api/debug/time-stop-alerts-force` devuelve estadísticas
- Logging detallado de cada posición procesada

### Archivos Modificados
- `server/services/tradingEngine.ts`:
  - Líneas 1208-1252: `buildTimeStopAlertMessage()` helper
  - Líneas 1254-1306: `sendTimeStopAlert()` helper con error handling
  - Líneas 1308-1360: `checkExpiredTimeStopPositions()` refactorizado
  - Líneas 1362-1409: `forceTimeStopAlerts()` refactorizado
- `server/routes.ts`:
  - Línea 4734: Endpoint devuelve estadísticas

### Comportamiento Mejorado
- ✅ Lee configuración real de BD (timeStopHours, timeStopMode)
- ✅ Manejo de errores en cada paso (ticker, telegram, save)
- ✅ Logging detallado para debugging
- ✅ Estadísticas de alertas enviadas/fallidas/omitidas
- ✅ Código centralizado y mantenible

### Impacto
- No hay cambios de comportamiento visible para el usuario
- Mayor robustez ante errores de red o servicios externos
- Facilita debugging con logs detallados
- Prepara el sistema para futuras mejoras

---

## 2026-01-25 16:48 — FIX CRÍTICO: Alertas Time-Stop no llegaban para posiciones ya expiradas

### Problema Reportado
Las alertas de Time-Stop no llegaban para ETH/USD y TON/USD porque expiraron ANTES de implementar las alertas. El código solo enviaba alerta la primera vez que expiraba una posición.

### Causa Raíz
- Las posiciones expiraron hace 15 horas
- `timeStopExpiredAt` estaba vacío en BD
- El código solo notificaba si `!position.timeStopExpiredAt`
- Al iniciar el bot, no se verificaban posiciones ya expiradas

### Solución
Implementado `checkExpiredTimeStopPositions()` que se ejecuta al iniciar el bot:

```typescript
// Se ejecuta después de cargar posiciones desde BD
await this.checkExpiredTimeStopPositions();

// Verifica posiciones expiradas no notificadas y envía alerta
private async checkExpiredTimeStopPositions(): Promise<void> {
  for (const [lotId, position] of this.openPositions) {
    if (position.timeStopExpiredAt) continue;  // Ya notificada
    if (position.timeStopDisabled) continue;  // Time-Stop pausado
    
    if (ageHours >= exitConfig.timeStopHours) {
      // Enviar alerta SOFT o HARD según configuración
      // Marcar como notificada para evitar duplicados
    }
  }
}
```

### Archivos Modificados
- `server/services/tradingEngine.ts`:
  - Línea 1894: Llamada a `checkExpiredTimeStopPositions()` al iniciar
  - Líneas 1208-1288: Nueva función de verificación startup

### Comportamiento
- **Al iniciar bot**: Verifica todas las posiciones abiertas
- **Si expiraron y no notificadas**: Envía alerta inmediata
- **Marca como notificada**: Evita alertas duplicadas
- **Funciona para ambos modos**: SOFT y HARD

### Impacto
- Ahora recibirás alertas para posiciones ya expiradas (ETH, TON)
- Futuras expiraciones seguirán notificándose correctamente
- No se enviarán alertas duplicadas

---

## 2026-01-25 14:15 — FIX: Time-Stop SOFT no cerraba posiciones en pérdida

### Problema Reportado
Posición TON/USD con Time-Stop (48h) marcado como "EXPIRED" pero la posición seguía abierta. En modo SOFT, si la posición tiene pérdida, el bot esperaba indefinidamente a que tuviera profit.

### Causa Raíz
El Time-Stop en modo SOFT solo cerraba posiciones si el profit era suficiente para cubrir fees. Posiciones con pérdida quedaban abiertas indefinidamente.

### Solución
Añadido **tiempo máximo absoluto** del 50% adicional al Time-Stop configurado:
- Time-Stop 48h → Cierre forzado a las 72h
- Time-Stop 36h → Cierre forzado a las 54h

```typescript
// NUEVO: Force close after 50% additional time
const maxAbsoluteHours = timeStopHours * 1.5;
if (ageHours >= maxAbsoluteHours) {
  return {
    triggered: true,
    expired: true,
    shouldClose: true,
    reason: `Time-stop máximo absoluto - forzando cierre`,
  };
}
```

### Archivo Modificado
- `server/services/tradingEngine.ts` líneas 760-772

### Impacto
- Posiciones con Time-Stop expirado ya NO quedan abiertas indefinidamente
- Después del 50% de tiempo adicional, se fuerza el cierre aunque esté en pérdida
- Notificación de Telegram actualizada con hora de cierre forzado

---

## 2026-01-25 14:10 — FIX CRÍTICO: Reconciliación NUNCA crea posiciones

### Problema Reportado
Al darle a "Reconciliar", se creó una posición de BTC/USD sin señal válida.

### Regla Establecida
**Las posiciones SOLO las crea el bot por señal válida.** La reconciliación:
- ✅ Sincroniza cantidades de posiciones existentes
- ✅ Elimina posiciones huérfanas (balance=0)
- ❌ NUNCA crea nuevas posiciones

### Solución
Eliminada completamente la lógica de creación de posiciones en reconciliación. Si hay balance sin posición, se registra como "balance externo" sin crear posición.

### Archivo Modificado
- `server/routes.ts` líneas 2412-2419

---

## 2026-01-25 13:55 — FIX CRÍTICO: Reconciliación creaba posiciones desde balances externos

### Problema Reportado
Al darle a "Reconciliar", se creó una posición de BTC/USD sin señal válida. El usuario tenía balance de BTC en el exchange (probablemente depósito externo), y la reconciliación creó una posición basándose en trades históricos del bot.

### Causa Raíz
La lógica de reconciliación buscaba trades con `executed_by_bot=true` en los últimos 7 días, pero **no verificaba si hubo ventas posteriores** al último BUY del bot.

Escenario problemático:
1. Hace 5 días el bot compró BTC
2. Hace 3 días se vendió (manual o por bot)
3. Hoy el usuario depositó BTC externamente
4. Reconciliación: balance BTC > 0 + trade BUY del bot histórico → crea posición incorrecta

### Solución
```typescript
// ANTES: Solo verificaba si existía trade BUY del bot
const botTrades = await storage.getRecentTradesForReconcile({...});
if (botTrades.length > 0) {
  // Crear posición con último trade
}

// AHORA: Verifica que NO haya SELL posterior al último BUY
const buyTrades = botBuyTrades.filter(t => t.type === 'buy');
if (buyTrades.length > 0) {
  const lastBuyTime = new Date(buyTrades[0].executedAt).getTime();
  
  // Buscar cualquier SELL posterior al BUY
  const allRecentTrades = await storage.getRecentTradesForReconcile({
    since: new Date(lastBuyTime), // Desde el último BUY
    // Sin filtrar por executedByBot para capturar ventas manuales
  });
  
  const sellAfterBuy = allRecentTrades.find(t => 
    t.type === 'sell' && new Date(t.executedAt).getTime() > lastBuyTime
  );
  
  if (sellAfterBuy) {
    // Balance es externo - NO crear posición
    results.push({ action: 'skipped_sold_after_buy', ... });
  } else {
    // Sin ventas posteriores → crear posición
  }
}
```

### Archivo Modificado
- `server/routes.ts` líneas 2410-2505 (endpoint `/api/positions/reconcile`)

### Impacto
- Reconciliación ya NO crea posiciones de balances externos
- Solo crea posiciones si el último trade BUY del bot NO tiene ventas posteriores
- Previene "resurrecciones" de posiciones ya vendidas

### Acción Manual Requerida
- Eliminar manualmente la posición BTC/USD incorrecta desde el dashboard
- Verificar que las posiciones SOL/USD con status FAILED se limpien

---

## 2026-01-25 12:35 — FIX: P&L Neto usaba fee incorrecto para RevolutX

### Problema
El cálculo de P&L Neto en `/api/open-positions` usaba siempre `takerFeePct` (0.40% Kraken) en lugar del fee real según el exchange de la posición.

Para posiciones RevolutX (fee real 0.09%), las comisiones estimadas estaban infladas 4.4x.

### Causa Raíz
```typescript
// ANTES: Siempre usaba takerFeePct (0.40%)
const entryFeeUsd = entryValueUsd * takerFeePct;
const exitFeeUsd = currentValueUsd * takerFeePct;
```

### Solución
```typescript
// AHORA: Usa fee según exchange
const feePctForExchange = (exchange: string) => {
  if (exchange === 'revolutx') return 0.09 / 100;  // 0.09%
  return krakenFeePct;  // config (default 0.40%)
};

const feePct = feePctForExchange(ex);
const entryFeeUsd = entryValueUsd * feePct;
const exitFeeUsd = currentValueUsd * feePct;
```

### Archivo Modificado
- `server/routes.ts` líneas 762-812

### Impacto
- Posiciones RevolutX: comisiones correctas (0.09% vs 0.40%)
- P&L Neto más preciso para trading real
- Sin cambio para posiciones Kraken

---

## 2026-01-24 20:45 — FIX CRÍTICO: Órdenes ejecutadas marcadas como FALLIDA

### Problema Reportado
Orden BUY TON ejecutada correctamente en RevolutX (32.72251 TON @ $1.5323), pero en UI:
- Aparece lote 2/2 marcado como "FALLIDA"
- La cantidad comprada se suma a la posición TON existente (lote 1) en lugar del lote 2

### Causa Raíz Identificada
**RevolutXService NO tenía implementado el método `getFills`**. El FillWatcher:
1. Intentaba llamar `exchangeService.getFills?.({ limit: 50 })`
2. Al no existir, retornaba array vacío
3. Después de 120s de timeout sin fills, marcaba la posición como FAILED
4. La orden SÍ estaba ejecutada pero el bot no podía verificarlo

### Archivos Modificados

#### `server/services/exchanges/RevolutXService.ts`
- **NUEVO**: Método `getOrder(orderId)` - Consulta estado de orden específica
  - Usa endpoint `GET /api/1.0/orders/{orderId}`
  - Retorna filledSize, executedValue, averagePrice, status
- **NUEVO**: Método `getFills(params)` - Obtiene fills recientes
  - Usa `listPrivateTrades()` para symbol específico
  - Fallback a `getOrder()` para construir fill sintético
  - Fallback a endpoint `/api/1.0/fills`

#### `server/services/FillWatcher.ts`
- **MEJORADO**: Función `fetchFillsForOrder()` con 3 estrategias:
  1. **ESTRATEGIA 1**: Si hay `exchangeOrderId`, consulta `getOrder()` directamente
  2. **ESTRATEGIA 2**: Si hay `pair`, usa `getFills({ symbol })` con filtro temporal
  3. **ESTRATEGIA 3**: Fallback genérico `getFills({ limit: 50 })`

#### `shared/schema.ts`
- **NUEVO**: Campo `venueOrderId` en tabla `open_positions`
  - Almacena ID de orden del exchange para consultas de estado

#### `server/storage.ts`
- **ACTUALIZADO**: `createPendingPosition()` acepta `venueOrderId`
- **NUEVO**: Método `getPositionByVenueOrderId()`

#### `server/services/tradingEngine.ts`
- **ACTUALIZADO**: Pasa `venueOrderId: pendingOrderId` a `createPendingPosition()`

#### `db/migrations/011_add_venue_order_id.sql`
- Migración para agregar columna `venue_order_id` a `open_positions`
- Índice para búsqueda eficiente

### Flujo Corregido
1. `placeOrder()` → exchange acepta orden → retorna `orderId`
2. `createPendingPosition()` guarda `clientOrderId` + `venueOrderId`
3. `FillWatcher` inicia polling cada 3s
4. `getOrder(venueOrderId)` consulta estado real de la orden
5. Si orden tiene fills → actualiza posición a OPEN con precio medio
6. UI muestra lote 2/2 como OPEN (no FAILED)

### Migración Requerida
```sql
-- Ejecutar en BD antes de deploy:
ALTER TABLE open_positions ADD COLUMN IF NOT EXISTS venue_order_id TEXT;
CREATE INDEX IF NOT EXISTS idx_open_positions_venue_order_id 
ON open_positions(venue_order_id) WHERE venue_order_id IS NOT NULL;
```

### Criterio de Éxito (Validación)
- Repetir compra TON con `sgMaxOpenLotsPerPair=2`
- La compra nueva queda en lote 2 (OPEN), NO se suma al lote 1
- No aparece ningún lote "FALLIDA" para órdenes ejecutadas
- IDs (client_order_id y venue_order_id) persistidos y trazables

---

## 2026-01-25 13:20 — Mejora Visual de Alertas Telegram (Compras/Ventas/Errores)

### Objetivo
Mejorar el formato visual de las alertas de Telegram para que sean más claras y atractivas, con estados de proceso y P&L real.

### Cambios Implementados

#### 1️⃣ Alertas de Error con Severidad Visual
- **ERROR CRITICAL** 🔴 - Errores graves que requieren atención inmediata
- **ERROR MEDIUM** 🟡 - Errores moderados
- **ERROR LOW** 🟢 - Advertencias menores

Formato nuevo:
```
🔴 ERROR CRITICAL 🔴
━━━━━━━━━━━━━━━━━━━
🏷️ Tipo: TRADING_ERROR
📊 Par: ETH/USD
🏦 Exchange: RevolutX
🕐 Hora: 25/01/2026, 13:15:00
📁 Archivo: tradingEngine.ts
🔧 Función: executeTrade
📍 Línea: 1234

❌ Error al ejecutar orden de compra

📋 Contexto:
   • orderId: abc123...
   • reason: Insufficient funds
━━━━━━━━━━━━━━━━━━━
```

#### 2️⃣ Alertas de COMPRA con Estados
- **🟡 COMPRA ENVIADA** - Orden enviada, esperando confirmación
- **🟢 COMPRA REALIZADA** - Orden ejecutada exitosamente
- **🔴 COMPRA FALLIDA** - Error en la ejecución

Formato nuevo:
```
🟢🟢🟢 COMPRA REALIZADA 🟢🟢🟢
━━━━━━━━━━━━━━━━━━━
✅ XRP/USD

🏦 Exchange: RevolutX
💵 Precio: $3.15
📦 Cantidad: 109.58
💰 Total invertido: $345.19

📊 Indicadores:
EMA10>EMA20 ✓, MACD+ ✓

🧭 Régimen: TREND
   ↳ Tendencia alcista

⚙️ Modo: SMART_GUARD
🔗 OrderID: 177b3f2a...
🎫 LotID: engine-17691...
━━━━━━━━━━━━━━━━━━━
🕐 25/01/2026, 13:15:00
```

#### 3️⃣ Alertas de VENTA con P&L Real (incluyendo fees)
- **🟠 VENTA ENVIADA** - Orden enviada
- **🔴 VENTA REALIZADA** - Con resultado real
- **⚫ VENTA FALLIDA** - Error

Formato nuevo con P&L NETO:
```
🔴🔴🔴 VENTA REALIZADA 🔴🔴🔴
━━━━━━━━━━━━━━━━━━━
💰 ETH/USD

🏦 Exchange: RevolutX
💵 Precio venta: $3350.00
📦 Cantidad: 0.175
💰 Total recibido: $586.25
⏱️ Duración: 1d 2h 15m

━━━━━━━━━━━━━━━━━━━
🎉 RESULTADO REAL 🎉

📈 Beneficio/Pérdida NETO:
   💵 +$21.94 (+3.89%)

📊 Desglose:
   • P&L Bruto: +$23.11
   • Fees pagados: -$1.17
   • NETO: +$21.94
━━━━━━━━━━━━━━━━━━━

🛡️ Tipo salida: TRAILING_STOP
⚡ Trigger: Trail activado en $3380

⚙️ Modo: SMART_GUARD
🔗 OrderID: 288c4g3b...
━━━━━━━━━━━━━━━━━━━
🕐 25/01/2026, 13:30:00
```

### Archivos Modificados
- `server/services/telegram/templates.ts` - Nuevos templates visuales
- `server/services/telegram.ts` - Nuevos métodos de envío

### Nuevos Métodos en TelegramService
```typescript
// Errores con severidad
sendErrorAlert(ctx: ErrorAlertContext)
sendCriticalError(ctx: Omit<ErrorAlertContext, 'severity'>)

// Compras visuales
sendBuyAlert(ctx: { status: 'PENDING' | 'COMPLETED' | 'FAILED', ... })

// Ventas con P&L real
sendSellAlert(ctx: { pnlUsd, feeUsd, netPnlUsd, ... })

// Orden pendiente
sendOrderPending(type: 'BUY' | 'SELL', pair, exchange, amount, price, orderId)
```

---

## 2026-01-24 00:30 — Documentación Completa de Alertas Telegram

### Objetivo
Crear inventario completo de todas las alertas Telegram, cuándo se activan y cómo se configuran.

### Archivo Creado
`ALERTAS_TELEGRAM.md` - Documentación exhaustiva del sistema de alertas

### Contenido
- **25+ tipos de alertas** categorizadas por tipo
- **Tablas detalladas** con cuándo se activa cada alerta
- **Cooldowns configurables** por tipo de evento
- **Sistema de deduplicación v2.0** con hash/throttle
- **Comandos de gestión** (/channels, /menu, /refresh_commands)

### Categorías Documentadas
- 🕐 Programadas (Heartbeat, Reporte Diario)
- 🚀 Ciclo de vida del bot (Inicio/Detenido)
- 💰 Trading (Compras/Ventas/SL/TP/Trailing)
- 🛡️ Smart Guard (BE/Trailing/Scale-Out)
- ⚠️ Riesgos y Límites (Drawdown, Cooldown)
- 🔧 Reconciliación (Posiciones huérfanas)
- 🚨 Errores (Críticos, API)

### Configuración
- 6 tipos de alertas configurables en `/channels`
- Cooldowns personalizables por evento
- Sistema de deduplicación por tipo de mensaje

---

## 2026-01-24 00:00 — Refactorización Completa Sistema Telegram

### Objetivo
Modernizar notificaciones Telegram: branding unificado "CHESTER BOT", exchange explícito, anti-placeholders, deduplicación, comandos alineados.

### Archivos Creados

#### `server/services/telegram/types.ts`
- Schemas Zod para validación de contextos
- `BOT_CANONICAL_NAME = "CHESTER BOT"`
- `TELEGRAM_COMMANDS` - Lista autoritativa de comandos
- `DailyReportContextSchema`, `TradeBuyContextSchema`, etc.
- Funciones `validateContext()`, `safeValidateContext()`

#### `server/services/telegram/templates.ts`
- Templates HTML con branding consistente
- `buildHeader()` → `[VPS/STG] 🤖 CHESTER BOT 🇪🇸`
- `buildDailyReportHTML()` mejorado con secciones separadas
- `buildTradeBuyHTML()` / `buildTradeSellHTML()` con exchange explícito
- Helpers: `formatAge()`, `formatDuration()`, `escapeHtml()`

#### `server/services/telegram/deduplication.ts`
- `MessageDeduplicator` class con hash y throttle
- Configs por tipo: positions_update (5min), heartbeat (6h), etc.
- Rate limit por hora
- `checkAndMark()` para verificar y marcar en una llamada

#### `server/services/telegram/templates.test.ts`
- Tests snapshot para cada template
- Fixtures completos: reporte con posiciones, vacío, con pending orders
- Validación anti-placeholder en todos los templates
- Tests de helpers (escapeHtml, formatDuration, etc.)

### Archivos Modificados

#### `server/services/telegram.ts`
```typescript
// Nuevos imports
import { TELEGRAM_COMMANDS, BOT_CANONICAL_NAME, ... } from "./telegram/types";
import { telegramTemplates, buildDailyReportHTML, ... } from "./telegram/templates";
import { messageDeduplicator } from "./telegram/deduplication";

// Branding actualizado
function getBotBranding(): string {
  return `[${environment.envTag}] 🤖 <b>${BOT_CANONICAL_NAME}</b> 🇪🇸`;
}

// Nuevos comandos
this.bot.onText(/\/refresh_commands/, async (msg) => {
  await this.handleRefreshCommands(msg.chat.id);
});

// setMyCommands al iniciar
private async registerCommandsWithTelegram(): Promise<void> {
  await this.bot.setMyCommands(TELEGRAM_COMMANDS.map(...));
}

// /ayuda dinámico desde TELEGRAM_COMMANDS
private async handleAyuda(chatId: number) {
  const sections = [
    formatSection("📊 Información:", infoCommands),
    formatSection("⚙️ Configuración:", configCommands),
    ...
  ];
}
```

### Ejemplos de Salida

#### Reporte Diario (con posiciones)
```
[VPS/STG] 🤖 CHESTER BOT 🇪🇸
━━━━━━━━━━━━━━━━━━━
📋 REPORTE DIARIO (14:00)
🕒 23/01/2026 14:00:00 (Europe/Madrid)

🔌 Conexiones:
  ✅ Kraken | ✅ DB | ✅ Telegram | ✅ RevolutX

🧠 Sistema:
  CPU: 0.4%
  Memoria: 7.4/7.7 GB (96.4%) ⚠️
  Disco: 42.1/232.4 GB (18.1%)
  Uptime: 17d 16h 13m

🤖 Bot:
  Entorno: VPS/STG | DRY_RUN: NO
  Modo: SMART_GUARD | Estrategia: momentum
  Pares: TON/USD, BTC/USD, ETH/USD, SOL/USD, XRP/USD

💰 Portfolio (confirmado):
  Posiciones: 3 | Exposición: $1087.32
  • XRP/USD (RevolutX): $345.19 @ $3.1500
  • ETH/USD (RevolutX): $563.14 @ $3218.4500
  • TON/USD (RevolutX): $178.99 @ $5.2300

🧾 Órdenes pendientes:
  Sin órdenes pendientes

🔄 Sincronización:
  Kraken lastSync: 13:58:10 (hace 1m 50s)
  RevolutX lastSync: 13:52:05 (hace 7m 55s)
━━━━━━━━━━━━━━━━━━━
Panel: http://5.250.184.18:3020/
```

#### Trade Buy
```
[VPS/STG] 🤖 CHESTER BOT 🇪🇸
━━━━━━━━━━━━━━━━━━━
🟢 COMPRA XRP/USD 🟢

🏦 Exchange: RevolutX
💵 Precio: $3.15
📦 Cantidad: 109.58
💰 Total: $345.19

📊 Indicadores:
EMA10>EMA20 ✓, MACD+ ✓, Vol 1.8x ✓, RSI 42

🧭 Régimen: TREND
   ↳ Tendencia alcista (ADX=32, EMAs alineadas)

⚙️ Modo: SMART_GUARD
🔗 OrderID: 177b3f2a-1234-5678-9abc-def012345678
🎫 LotID: engine-1769186188930-XRPUSD

📅 23/01/2026 10:30:00
━━━━━━━━━━━━━━━━━━━
Panel: http://5.250.184.18:3020/
```

### Verificación
```bash
# Ejecutar tests
npm test -- server/services/telegram/templates.test.ts

# Verificar compilación
npx tsc --noEmit
```

---

## 2026-01-23 23:55 — Fix Logs en Rojo (detectLevel falsos positivos)

### Problema
Los logs del endpoint `/api/logs` aparecían en rojo (ERROR) en la UI del monitor aunque eran peticiones exitosas (HTTP 200). 

**Causa raíz:** La función `detectLevel()` en `serverLogsService.ts` buscaba la palabra "ERROR" en cualquier parte de la línea usando `line.toUpperCase().includes("ERROR")`. Cuando el endpoint `/api/logs` retornaba JSON con campos como `"isError":false`, toda la línea se clasificaba como ERROR.

### Solución
Modificado `server/services/serverLogsService.ts` líneas 53-98:

```typescript
private detectLevel(line: string): string {
  // Patrones regex específicos para errores reales
  const errorPatterns = [
    /\[ERROR\]/i,
    /\(ERROR\)/i,
    /^ERROR:/i,
    /\bERROR\b.*:/,
    /\[FATAL\]/i,
    /\bFATAL\b/i,
    /\bEXCEPTION\b/i,
    /\bUncaught\b/i,
    /\bUnhandled\b/i,
  ];
  
  // Detectar respuestas JSON que contienen logs anidados
  const isJsonResponseLog = line.includes('{"logs":') || line.includes('"isError"');
  
  if (!isJsonResponseLog) {
    // Aplicar patrones normalmente
    for (const pattern of errorPatterns) {
      if (pattern.test(line)) return "ERROR";
    }
  } else {
    // Solo marcar ERROR si HTTP status es 4xx/5xx
    const httpStatusMatch = line.match(/\s([45]\d{2})\s+in\s+\d+ms/);
    if (httpStatusMatch) return "ERROR";
  }
  
  // WARN y DEBUG patterns...
  return "INFO";
}
```

### Archivos modificados
- `server/services/serverLogsService.ts`

### Verificación
- Compilación OK (errores preexistentes en otros archivos)
- Documentado en BITACORA.md

---
