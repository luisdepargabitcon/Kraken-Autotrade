# Audit System Design — Trading Normal/Dry Run & IDCA

**Version**: 1.1  
**Fecha**: 2026-06-30  
**Estado**: Implementado (Fase 1–5 + Profit Capture Quality + bot_events retention)

---

## 1. Objetivo

Crear un sistema de auditoría completo, separado y no invasivo para dos sistemas distintos:

| Sistema | Unidad de análisis | Fuente de datos |
|---|---|---|
| **Trading Normal / Dry Run** | Operación/lote/señal | `dry_run_trades`, `market_candles` |
| **IDCA** | Ciclo completo | `institutional_dca_cycles`, `institutional_dca_orders`, `idca_hybrid_*` |

**Regla fundamental**: Trading normal e IDCA no se mezclan en ninguna tabla ni vista principal.

---

## 2. Estructura Monitor

Monitor incluye las siguientes pestañas:

| Valor | Etiqueta | Descripción |
|---|---|---|
| `events` | Eventos | Feed de eventos en tiempo real (WebSocket) |
| `terminal` | Terminal | Logs técnicos IDCA |
| `diagnostic` | Diagnóstico | Diagnóstico de mercado |
| `marketdata` | Market Data | Datos OHLCV |
| `audit-trading` | Auditoría Trading | Auditoría Trading/Dry Run separada |
| `audit-idca` | Auditoría IDCA | Auditoría IDCA separada |

La pestaña anterior "Auditoría Salidas" queda integrada dentro de "Auditoría Trading" como subvista "Salidas".

---

## 3. Métricas comunes (auditMetrics.ts)

Funciones puras compartidas para ambos sistemas:

### MFE — Maximum Favorable Excursion
Máximo beneficio alcanzado durante la vida de la operación/ciclo.
```
mfePnlUsd = max(pnlUsd observado durante la operación)
mfePct    = mfePnlUsd / capitalInvertido * 100
```
**Fuente en Trading**: candles HIGH entre `created_at` del buy y `closed_at` del sell → `(highPrice - entryPrice) * qty`.  
**Fuente en IDCA**: `highest_price_after_tp` columna en `institutional_dca_cycles`, más órdenes de venta históricas.  
**Si no disponible**: `null` / "N/A".

### MAE — Maximum Adverse Excursion
Máxima pérdida flotante sufrida antes de recuperar o cerrar.
```
maePnlUsd = min(pnlUsd observado durante la operación)  ← valor negativo
maePct    = maePnlUsd / capitalInvertido * 100
```
**Fuente en Trading**: candles LOW entre entry y exit → `(lowPrice - entryPrice) * qty`.  
**Fuente en IDCA**: derivado de `max_drawdown_pct` en ciclo + `capital_used_usd`.

### Giveback (beneficio devuelto)
```
givebackUsd = mfePnlUsd - finalPnlUsd
```
Siempre ≥ 0. Si `mfePnlUsd ≤ 0`, giveback = 0.

### Profit Capture
```
profitCapturePct = finalPnlUsd / mfePnlUsd * 100   (si mfePnlUsd > 0)
```
Rango 0–100%. Si MFE ≤ 0, se reporta `null`.

### Exit Efficiency
Calificación cualitativa de la salida:
- ≥ 80% → "Excelente"
- 50–79% → "Buena"
- 25–49% → "Regular"
- < 25% → "Baja"
- null → "Sin datos"

---

## 4. Tablas de base de datos

### Tablas existentes (reutilizadas)

| Tabla | Sistema | Uso |
|---|---|---|
| `dry_run_trades` | Trading | Operaciones dry-run buy/sell |
| `institutional_dca_cycles` | IDCA | Ciclos completos |
| `institutional_dca_orders` | IDCA | Órdenes buy/sell por ciclo |
| `idca_hybrid_state` | IDCA | Estado Hybrid/Grid/MR |
| `idca_grid_legs` | IDCA | Legs del grid observer |
| `idca_hybrid_events` | IDCA | Eventos del ciclo de vida grid |
| `market_candles` | Ambos | Velas OHLCV para MFE/MAE |

### Tabla nueva: `audit_trade_snapshots` (migration 061)

Snapshots de evolución de operaciones/ciclos. Se acumulan automáticamente para futuras consultas MFE/MAE. No se crean retroactivamente.

```sql
CREATE TABLE audit_trade_snapshots (
  id          BIGSERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL,         -- 'dry_run_trade' | 'idca_cycle'
  entity_id   INTEGER NOT NULL,
  pair        TEXT NOT NULL,
  ts          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  price       NUMERIC(20,8),
  pnl_usd     NUMERIC(20,8),
  pnl_pct     NUMERIC(10,4),
  max_pnl_usd_so_far NUMERIC(20,8),
  min_pnl_usd_so_far NUMERIC(20,8),
  be_active   BOOLEAN,
  trailing_active BOOLEAN,
  grid_state  TEXT,
  regime      TEXT,
  raw_json    JSONB
);
```

Retención: 12 meses. No acumular más de 1 snapshot cada 5 minutos por entidad.

### Tabla nueva: `audit_timeline_events` (migration 061)

Eventos clave por operación/ciclo (entrada, MFE, activación BE/trailing, cierre, etc.).

```sql
CREATE TABLE audit_timeline_events (
  id          SERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id   INTEGER NOT NULL,
  pair        TEXT NOT NULL,
  ts          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  event_type  TEXT NOT NULL,   -- ENTRY|ADDITIONAL_BUY|MANUAL_BUY|BE_ARMED|TRAILING_ARMED|MFE_UPDATED|CLOSED|GRID_CREATED|...
  description TEXT,
  price       NUMERIC(20,8),
  pnl_usd     NUMERIC(20,8),
  raw_json    JSONB
);
```

Retención: 12 meses para eventos críticos, 90 días para eventos técnicos.

---

## 5. Endpoints

### Trading

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/audit/trading/summary` | Resumen global + por motivo + por par |
| GET | `/api/audit/trading/operations` | Lista operaciones con MFE/MAE/Giveback derivados |
| GET | `/api/audit/trading/operations/:id` | Detalle operación + timeline |
| GET | `/api/audit/trading/export` | Exportar CSV/JSON |
| GET | `/api/audit/trading/chatgpt-summary` | Resumen copiable para ChatGPT |

### IDCA

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/audit/idca/summary` | Resumen ciclos abiertos + cerrados |
| GET | `/api/audit/idca/cycles` | Lista ciclos con métricas |
| GET | `/api/audit/idca/cycles/:id` | Detalle ciclo |
| GET | `/api/audit/idca/cycles/:id/timeline` | Eventos del ciclo |
| GET | `/api/audit/idca/cycles/:id/grid-mean-reversion` | Estado Grid/MR del ciclo |
| GET | `/api/audit/idca/export` | Exportar CSV/JSON |
| GET | `/api/audit/idca/chatgpt-summary` | Resumen copiable para ChatGPT |

### Retención

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/audit/retention/status` | Tamaño estimado y recuentos por tabla |
| POST | `/api/audit/retention/preview-cleanup` | Preview de qué se borraría sin borrar nada |
| POST | `/api/audit/retention/run-cleanup` | Ejecutar limpieza segura |

---

## 6. Política de retención

### Permanente (nunca borrar desde UI)
- Operaciones reales (`bot_trades` / fisco)
- Ciclos IDCA cerrados con `realized_pnl_usd`
- Compras/ventas reales (IDCA órdenes)
- Datos fiscales (tablas `fisco_*`)
- Resúmenes finales de ciclos

### 12 meses
- `audit_trade_snapshots`
- `audit_timeline_events` con `event_type` crítico
- Estados Grid/MR históricos

### 90 días
- `audit_timeline_events` técnicos no críticos
- `idca_hybrid_events`
- Snapshots de señales

### 30 días
- Logs de polling / heartbeats
- Eventos duplicados

---

## 7. Resumen copiable para ChatGPT

### Trading
```
AUDITORÍA TRADING — {pair} operación #{id}
Modo: {dry_run|real}
Entrada: {fecha} @ ${entryPrice} × {qty} = ${capital}
Salida: {fecha} @ ${exitPrice}
PnL final: ${pnl} ({pct}%)
MFE: ${mfe} (máximo beneficio alcanzado)
MAE: ${mae} (máxima pérdida flotante)
Giveback: ${giveback} (beneficio devuelto)
Profit Capture: {pct}%
Motivo entrada: {reason}
Motivo salida: {reason}
Smart Exit: {activo/no}
TimeStop: {activo/no}
Break Even: {activo/no}
Trailing: {activo/no}
Duración: {horas}h {min}m
Diagnóstico: {texto}
```

### IDCA
```
AUDITORÍA IDCA — {pair} ciclo #{id}
Periodo: {inicio} → {fin}
Estado: {abierto|cerrado}
Compras: {n} (manual: {n_manual})
Capital usado: ${capital}
Avg entrada inicial: ${avg_inicial}
Avg entrada final: ${avg_final}
TP objetivo: ${tp_price} (+{tp_pct}%)
PnL final: ${pnl}
MFE: ${mfe}
MAE: ${mae}
Giveback: ${giveback}
Profit Capture: {pct}%
Break Even: {armado|no}
Trailing: {activo|no}
Grid Observer: {plan_id|no activo}
Mean Reversion: {régimen} / decisión: {hold|allow|block}
Motivo cierre: {reason}
Duración: {días}d
Diagnóstico automático: {texto}
```

---

## 8. Diagnóstico automático

El sistema genera diagnósticos no invasivos basados en reglas:

| Condición | Diagnóstico |
|---|---|
| Profit Capture < 25% && MFE > 0 | "Salida poco eficiente: se dejó escapar >75% del beneficio potencial." |
| TimeStop PnL total < 0 | "TimeStop cerrando en pérdida neta. Revisar softMode y minProfitPctToExit." |
| Emergency SL count > 5 | "Exceso de cierres por Stop-Loss emergencia. Revisar parámetros de entrada." |
| Giveback > MFE * 0.7 | "Trailing demasiado amplio o BE tardío: devuelve >70% del beneficio." |
| Smart Exit PnL > sin Smart Exit PnL | "Smart Exit aporta valor sobre la media." |
| Grid observer simulado pero nunca activo | "Grid detecta oportunidades pero está siempre en observador o bloqueado." |
| MR bloquea por régimen alcista | "Grid no activa en régimen alcista. Correcto para evitar compras tardías." |
| MAE > capital * 50% | "Drawdown elevado durante la operación: más del 50% de capital en pérdida flotante." |

---

## 9. Limitaciones conocidas

1. **MFE/MAE retroactivos**: Para operaciones cerradas antes de implementar `audit_trade_snapshots`, MFE/MAE se derivan de candles (aproximación) o se marcan "N/A" si las candles no están disponibles.
2. **IDCA MFE**: Se deriva de `highest_price_after_tp` (parcial — solo captura el máximo después de armar TP).
3. **Snapshots en tiempo real**: La acumulación de snapshots requiere hooks en el motor de trading. En Fase 5 se añaden esos hooks. Hasta entonces, los datos son derivados.
4. **No datos reales en staging**: Si el VPS usa dry-run, los endpoints de "real" mostrarán vacío.

---

## 10. Fases futuras

- **Fase 5**: Integrar snapshot hooks en `tradingEngine.ts` e `IdcaEngine.ts` (sin tocar lógica real)
- **Fase 6**: Tabla `audit_idca_cycle_summary` para pre-computar resúmenes
- **Gráficos**: Añadir mini-chart de evolución de PnL por operación/ciclo
- **Alertas Telegram**: Enviar resumen de diagnóstico por Telegram (opcional)

---

## 11. Profit Capture Quality (v1.1)

### Problema
`avgProfitCapturePct` puede superar 100% cuando el MFE histórico (`highest_price_after_tp`) está infracalculado por falta de snapshots. El PnL final supera el MFE registrado, produciendo porcentajes absurdos (ej: 306.87%).

### Solución
Cada cálculo de Profit Capture incluye ahora un campo de calidad:

| Calidad | Criterio | Display |
|---|---|---|
| `reliable` | MFE de snapshots/candles reales, 0 ≤ pct ≤ 100 | Valor normal |
| `estimated` | MFE de fallback (highest_price_after_tp), 0 ≤ pct ≤ 100 | Valor + badge "est." |
| `insufficient_data` | MFE null, ≤0, o pct > 100 | null + warning |

### Campos API por ciclo
- `rawProfitCapturePct`: valor crudo (puede ser >100)
- `displayProfitCapturePct`: null si insufficient_data
- `profitCaptureQuality`: "reliable" | "estimated" | "insufficient_data"
- `profitCaptureWarning`: mensaje explicativo

### Campos API summary IDCA
- `avgProfitCapturePct`: media solo de ciclos reliable/estimated
- `cyclesWithProfitCaptureData`: count
- `cyclesWithoutProfitCaptureData`: count
- `profitCaptureDataQuality`: "complete" | "partial" | "none"

### UI
- Tabla de ciclos: badge "est." para estimated, "N/A" con tooltip para insufficient_data
- Summary: muestra cobertura de datos (X/Y ciclos con datos)

---

## 12. bot_events Retention Policy (v1.1)

### Problema
`bot_events` puede crecer a 117K+ filas / 147MB por eventos técnicos repetitivos.

### Clasificación

| Tier | Retención | Tipos de evento |
|---|---|---|
| **permanent** | Nunca borrar | TRADE_EXECUTED, ORDER_FILLED, POSITION_CLOSED, CONFIG_UPDATED, FIFO_LOTS_CLOSED, MANUAL_CLOSE_*, ERROR/WARN (todos) |
| **12mo** | 365 días | SIGNAL_GENERATED, SMART_EXIT_*, TIME_STOP_*, SG_*, BREAKEVEN_ARMED, TRAILING_UPDATED, EXIT_EVAL, etc. |
| **90d** | 90 días | ENGINE_TICK, MARKET_SCAN_SUMMARY, BALANCE_CHECK |
| **30d** | 30 días | Cualquier INFO no clasificado (fallback seguro) |

### Reglas de seguridad
- ERROR y WARN **siempre** permanentes, independientemente del tipo
- Borrado por **whitelist** de tipos no críticos, nunca borrado genérico por fecha
- `confirm: true` obligatorio para ejecutar cleanup
- Preview obligatorio antes de borrar
- Registro de cleanup en `audit_timeline_events` (CLEANUP_BOT_EVENTS_RUN)

### Endpoints
- `GET /api/audit/retention/status`: incluye breakdown de bot_events por tipo/level/retentionTier
- `POST /api/audit/retention/preview-cleanup`: muestra bot_events por tier
- `POST /api/audit/retention/run-cleanup`: soporta `target: "bot_events"` con `confirm: true`

### Lo que NUNCA se borra
- dry_run_trades (operaciones reales)
- institutional_dca_cycles (ciclos cerrados)
- institutional_dca_orders (órdenes reales)
- fisco_* (datos fiscales)
- bot_events ERROR/WARN
- bot_events de tipo TRADE_EXECUTED, ORDER_FILLED, POSITION_CLOSED, CONFIG_UPDATED, etc.

---

## 13. Active Cycle Visibility & Quality-Aware Diagnostics (v1.2)

### Problema
1. **Ciclos abiertos no visibles**: IDCA usa `status="active"` pero el frontend filtraba con `status="open"`, por lo que los ciclos activos no aparecían en Monitor → Auditoría IDCA → Ciclos abiertos.
2. **Diagnóstico falso "0% del MFE"**: Ciclos con `profitCaptureQuality: "insufficient_data"` recibían `LOW_PROFIT_CAPTURE` porque `(null ?? 0) = 0 < 25`.

### Solución
- **Backend**: `status=open` se normaliza a `status=active` antes de consultar la base de datos.
- **Frontend**: Parsing robusto de respuesta (soporta `data` array y `data.cycles`).
- **Frontend**: `STATUS_COLORS` incluye `active`, `running`, `in_progress`, `completed`, `finished`.
- **Frontend**: Helpers `isOpenCycle()` / `isClosedCycle()` para normalizar estados.
- **Diagnósticos quality-aware**:

| Quality | LOW_PROFIT_CAPTURE | HIGH_GIVEBACK | GOOD_CYCLE/EXIT | PROFIT_CAPTURE_INSUFFICIENT_DATA | MAE/Grid |
|---|---|---|---|---|---|
| `reliable` | ✅ normal | ✅ normal | ✅ normal | ❌ | ✅ |
| `estimated` | ✅ con "Estimación:" | ✅ normal | ✅ con "Estimación:" | ❌ | ✅ |
| `insufficient_data` | ❌ | ❌ | ❌ | ✅ info | ✅ |

---

## 14. Canonical PnL Integration (v1.3)

### Problema
La Auditoría IDCA leía `realized_pnl_usd` directamente de la base de datos. En ciclos legacy/importados (pre-bee8391), este campo contiene el **valor de venta** (sell proceeds), no el beneficio neto. Esto producía:
- Ciclo #18 ETH/USD: +1128.01 $ (venta) en lugar de +85.01 $ (beneficio)
- Ciclo #15 BTC/USD: +1198.41 $ (venta) en lugar de +44.37 $ (beneficio)
- `totalRealizedPnlUsd`: +1604.17 $ (suma de ventas brutas)

### Solución
La Auditoría IDCA usa ahora `calculateIdcaCycleRealizedPnl` de `shared/idcaCyclePnl.ts` — la misma función que usa IDCA → Historial.

### PnL Source Classification

| Source | Descripción | Calculable | Badge UI |
|---|---|---|---|
| `orders` | Calculado desde BUY+SELL orders | ✅ | — |
| `orders_cycle_capital` | SELL orders + capitalUsedUsd como cost basis | ✅ | — |
| `orders_avg_entry` | SELL orders + avgEntryPrice como cost basis | ✅ | — |
| `imported_persisted_pnl` | PnL persistido de ciclo importado/manual | ✅ | "persistido" |
| `cycle_realized_fallback` | Fallback: realizedPnlUsd plausible | ✅ | "fallback" |
| `cycle_realized` | Fallback: realizedPnlUsd (no sell proceeds) | ✅ | "fallback" |
| `cost_basis_missing` | Cost basis insuficiente | ❌ | "pendiente" |
| `insufficient` | Datos insuficientes | ❌ | "N/A" |

### Reglas de agregación
- `totalRealizedPnlUsd` solo suma ciclos con `pnlIsCalculable=true`
- `closedWins` / `closedLosses` solo de ciclos calculables
- `byCloseReason` solo incluye ciclos calculables
- Ciclos abiertos no suman en `totalRealizedPnlUsd`
- Export incluye `canonical_pnl_usd`, `pnl_source`, `raw_realized_pnl_usd`
