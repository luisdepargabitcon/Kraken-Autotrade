# FASE 1 — AUDITORÍA Y MAPA REAL DEL SISTEMA

**Fecha:** 2026-03-30
**Estado:** COMPLETADO

---

## 1. ARQUITECTURA DE DATOS — TABLAS Y ESQUEMAS

### Sistema Bot Normal (Trading Engine)

#### Tablas Principales:
1. **`bot_config`** — Configuración global del bot
   - `dry_run_mode: boolean` — Flag para modo simulación
   - `is_active: boolean` — Estado on/off del bot
   - `strategy`, `risk_level`, `active_pairs`
   - SmartGuard config (sg_*)
   - Regime detection config
   - **Fuente de verdad:** Única fila, ID=1

2. **`open_positions`** — Posiciones abiertas del bot normal
   - Campos: `lot_id`, `pair`, `entry_price`, `amount`, `qty_remaining`
   - SmartGuard state: `sg_break_even_activated`, `sg_trailing_activated`, `sg_current_stop_price`
   - **NO tiene flag de modo** — todas son posiciones "reales" del bot
   - **Problema detectado:** No distingue entre real y dry run

3. **`trades`** — Historial de trades ejecutados
   - Campos: `trade_id`, `pair`, `type`, `price`, `amount`, `status`
   - P&L: `realized_pnl_usd`, `realized_pnl_pct`
   - `exchange`, `kraken_order_id`
   - **Problema detectado:** No distingue entre real y dry run

4. **`dry_run_trades`** — Trades simulados (NUEVO, recién añadido)
   - Campos: `sim_txid`, `pair`, `type`, `price`, `amount`, `status`
   - P&L: `realized_pnl_usd`, `realized_pnl_pct`
   - FIFO: `entry_sim_txid`, `entry_price`
   - **Estado:** Tabla nueva, persistencia implementada pero NO integrada con open_positions

5. **`trade_fills`** — Fills de Kraken para FIFO real
   - Usado por `fifoMatcher.ts` para calcular P&L real
   - **Crítico:** NO debe mezclarse con dry run

6. **`lot_matches`** — Matching FIFO real
   - **Crítico:** NO debe mezclarse con dry run

### Sistema IDCA (Institutional DCA)

#### Tablas Principales:
1. **`trading_engine_controls`** — Control de IDCA
   - `normal_mode: text` — "live" | "simulation" | "dry_run"
   - `idca_mode: text` — "live" | "simulation" | "dry_run"
   - **Fuente de verdad:** Única fila para controles IDCA

2. **`institutional_dca_config`** — Config global IDCA
   - `simulation_initial_balance_usd`
   - `simulation_fee_pct`, `simulation_slippage_pct`
   - `simulation_telegram_enabled`

3. **`institutional_dca_cycles`** — Ciclos IDCA
   - `mode: text` — "live" | "simulation" | "dry_run"
   - `status: text` — "active" | "closed"
   - `cycle_type: text` — "main" | "recovery" | "plus"
   - `is_imported: boolean` — Flag para ciclos importados manualmente
   - `is_manual_cycle: boolean` — Flag para ciclos manuales
   - **Problema detectado:** Importados/manuales pueden ser inconsistentes

4. **`institutional_dca_orders`** — Órdenes IDCA
   - `cycle_id`, `mode`, `order_type`, `side`
   - `gross_value_usd`, `fees_usd`, `slippage_usd`, `net_value_usd`

5. **`institutional_dca_simulation_wallet`** — Wallet simulado IDCA
   - `initial_balance_usd`, `available_balance_usd`, `used_balance_usd`
   - `realized_pnl_usd`, `unrealized_pnl_usd`
   - **Aislado:** NO afecta contabilidad real

### Tablas Auxiliares:
- `bot_events` — Log de eventos (incluye DRY_RUN_TRADE históricos)
- `notifications` — Notificaciones
- `market_data` — Precios de mercado
- `regime_state` — Estado de régimen de mercado
- `telegram_chats` — Configuración de chats Telegram

---

## 2. FLUJO DE CONTROL — MODOS Y ESTADOS

### Bot Normal (Trading Engine)

#### Control de Modo:
```
bot_config.dry_run_mode: boolean
  ↓
tradingEngine.dryRunMode (private)
  ↓
executeTrade() → if (dryRunMode) { simulate } else { real order }
```

**Problema detectado:**
- `dry_run_mode` es un simple boolean en `bot_config`
- NO hay flag en `open_positions` ni `trades` para distinguir origen
- Las posiciones dry run NO se persisten en `open_positions`
- Los trades dry run NO se persisten en `trades`
- **NUEVA tabla `dry_run_trades`** creada pero NO integrada con UI de posiciones

#### Persistencia Actual:
- **Modo REAL:** `open_positions` + `trades` + `trade_fills` + FIFO
- **Modo DRY RUN:** `dry_run_trades` (nueva tabla) + `bot_events` (log)
- **Separación:** Correcta en backend, pero UI no refleja posiciones dry run como "abiertas"

### Sistema IDCA

#### Control de Modo:
```
trading_engine_controls.idca_mode: "live" | "simulation" | "dry_run"
  ↓
institutional_dca_cycles.mode
  ↓
IdcaEngine → if (mode === "simulation") { wallet simulado } else { real }
```

**Estado:** Bien separado, cada ciclo tiene su modo explícito

---

## 3. ENDPOINTS API — MAPEO COMPLETO

### Bot Normal

#### Posiciones:
- `GET /api/positions` → NO existe (se usa storage directo)
- `POST /api/positions/:pair/buy` → Compra manual
- `POST /api/positions/:pair/close` → Cierre manual
- `DELETE /api/positions/:lotId/orphan` → Eliminar huérfana
- `PATCH /api/positions/:lotId/time-stop` → Toggle time-stop
- `POST /api/positions/reconcile` → Reconciliar con exchange
- `POST /api/positions/refresh-snapshots` → Refresh SmartGuard

#### Trades:
- `GET /api/trades` → Últimos trades
- `GET /api/trades/closed` → Historial paginado
- `GET /api/trades/performance` → P&L agregado (REAL + UNREALIZED)
- `POST /api/trades/sync` → Sync desde Kraken
- `POST /api/trades/rebuild-pnl` → Recalcular P&L
- `POST /api/trades/cleanup-duplicates` → Limpiar duplicados

#### Dry Run (NUEVO):
- `GET /api/dryrun/positions` → Posiciones dry run abiertas
- `GET /api/dryrun/history` → Historial dry run cerrado
- `GET /api/dryrun/summary` → Resumen P&L dry run
- `DELETE /api/dryrun/clear` → Limpiar todo dry run
- `POST /api/dryrun/backfill` → Recuperar desde bot_events

**Problema detectado:**
- Endpoints dry run existen pero NO están integrados en UI principal
- UI de Terminal tiene pestañas DRY RUN pero son nuevas y separadas
- NO hay vista unificada de "posiciones activas" que incluya dry run

### Sistema IDCA

#### Ciclos:
- `GET /api/idca/cycles` → Todos los ciclos (filtrable por mode)
- `GET /api/idca/cycles/:id` → Detalle de ciclo
- `POST /api/idca/cycles/:id/close` → Cerrar ciclo
- `DELETE /api/idca/cycles/:id` → Eliminar ciclo
- `POST /api/idca/cycles/import` → Importar ciclo manual

#### Control:
- `GET /api/idca/controls` → Estado de controles
- `PATCH /api/idca/controls` → Actualizar controles (incluye mode)

#### Simulación:
- `GET /api/idca/simulation/wallet` → Wallet simulado
- `POST /api/idca/simulation/reset` → Reset simulación

### Dashboard:
- `GET /api/dashboard` → Datos principales (balances, precios, trades recientes)
  - **NO incluye:** Posiciones abiertas, P&L detallado, estado dry run

---

## 4. COMPONENTES FRONTEND — MAPEO COMPLETO

### Dashboard Principal (`Dashboard.tsx`)
- **Muestra:**
  - Balances por asset
  - Precios actuales
  - `<BotControl />` — Estado del bot (solo lectura)
  - `<ChartWidget />` — Gráfica (¿qué muestra?)
  - `<TradeLog />` — Log de trades recientes
  - `<EventsPanel />` — Eventos del bot
  - Pares activos

- **NO muestra:**
  - Posiciones abiertas
  - P&L realizado/no realizado
  - Estado dry run
  - Gráficas P&L (bot normal vs IDCA)
  - Navegación a posiciones

- **Problema detectado:**
  - Dashboard es informativo pero NO operativo
  - Datos pueden estar stale (refetch cada 30s)
  - No hay acceso directo a posiciones activas

### Terminal (`Terminal.tsx`)
- **Pestañas:**
  - POSITIONS — Posiciones abiertas bot normal (real)
  - HISTORY — Historial cerrado bot normal (real)
  - DRY RUN — Posiciones dry run abiertas (NUEVO)
  - HIST. DRY — Historial dry run cerrado (NUEVO)

- **Problema detectado:**
  - Pestañas dry run son nuevas y separadas
  - NO hay vista unificada
  - Botón "RECUPERAR" en dry run puede traer 65 ops inconsistentes

### Strategies (`Strategies.tsx`)
- **Control de bot:**
  - ON/OFF
  - Estrategia
  - Riesgo
  - Pares activos
  - **DRY RUN MODE toggle** — Existe pero NO está claro su efecto

### InstitutionalDca (`InstitutionalDca.tsx`)
- **Control IDCA:**
  - Mode selector: "live" | "simulation" | "dry_run"
  - Ciclos activos/cerrados
  - Wallet simulado
  - **Bien separado del bot normal**

### BotControl (`BotControl.tsx`)
- **Solo lectura:**
  - Estado ON/OFF
  - Estrategia
  - Nivel de riesgo
  - Exchange trading
  - Datos de mercado
  - **NO permite cambiar nada**

---

## 5. FUENTES DE VERDAD — IDENTIFICACIÓN

### Bot Normal:
1. **Config:** `bot_config` (única fila)
2. **Posiciones reales:** `open_positions` (sin flag de modo)
3. **Trades reales:** `trades` (sin flag de modo)
4. **FIFO real:** `trade_fills` + `lot_matches`
5. **Dry run:** `dry_run_trades` (tabla separada, nueva)

### IDCA:
1. **Config:** `institutional_dca_config` (única fila)
2. **Controles:** `trading_engine_controls` (única fila)
3. **Ciclos:** `institutional_dca_cycles` (con campo `mode`)
4. **Wallet sim:** `institutional_dca_simulation_wallet` (única fila)

### Dashboard:
1. **Datos:** Endpoint `/api/dashboard` (agregación en tiempo real)
2. **NO hay caché persistente**

---

## 6. INCONSISTENCIAS DETECTADAS

### A. Dry Run NO se comporta como modo real:
- ✅ Backend persiste en `dry_run_trades` (FIFO correcto)
- ❌ NO aparece en `open_positions` como posición "abierta"
- ❌ UI de posiciones NO muestra dry run como activas
- ❌ Dashboard NO refleja estado dry run
- ❌ Pestañas dry run son separadas, no integradas

### B. Botón "RECUPERAR" trae 65 operaciones inconsistentes:
- Origen: `bot_events` con type="DRY_RUN_TRADE"
- Problema: Puede incluir:
  - Duplicados
  - Operaciones sin match
  - Operaciones de pruebas antiguas
  - Operaciones con datos incompletos
- **Causa raíz:** Backfill sin filtros defensivos

### C. Contabilidad FIFO real puede contaminarse:
- ✅ `dry_run_trades` está separado
- ✅ `executeTrade()` NO envía órdenes reales en dry run
- ❌ Si alguien llama endpoints de trades sin verificar modo, puede mezclar
- ❌ NO hay validación explícita en endpoints de FIFO

### D. Dashboard muestra datos stale o incorrectos:
- Refetch cada 30s puede ser insuficiente
- NO usa WebSocket para updates en tiempo real
- NO muestra posiciones abiertas
- NO muestra P&L detallado
- NO tiene gráficas P&L

### E. Controles duplicados y confusos:
- `BotControl` (Dashboard) → Solo lectura
- `Strategies` → Permite cambiar config + dry run toggle
- NO está claro dónde controlar dry run
- NO hay explicación de qué afecta dry run

### F. Importadas/manuales IDCA:
- `is_imported: boolean` en `institutional_dca_cycles`
- `is_manual_cycle: boolean` en `institutional_dca_cycles`
- Pueden tener datos inconsistentes (precio, cantidad, fees)
- NO hay validación robusta en import

---

## 7. PROPUESTA DE CONSOLIDACIÓN

### A. Dry Run — Comportamiento funcional igual que real:
1. **Mantener separación de datos:**
   - `dry_run_trades` (ya existe)
   - NO mezclar con `open_positions` ni `trades`

2. **Integrar en UI:**
   - Dashboard debe mostrar estado dry run
   - Posiciones activas debe incluir dry run (con badge visual)
   - Historial debe poder filtrar por modo
   - Gráficas P&L deben distinguir real vs dry run

3. **Validación robusta:**
   - Endpoints de FIFO real deben rechazar dry run
   - Backfill debe filtrar duplicados/inconsistentes
   - Clear debe pedir confirmación

### B. Dashboard — Modernización:
1. **Añadir:**
   - Gráfica P&L bot normal (tiempo real)
   - Gráfica P&L IDCA (tiempo real)
   - Gráfica precio activos activos (tiempo real)
   - Sección posiciones activas (con navegación)

2. **Quitar:**
   - TradeLog (mover a Terminal)
   - EventsPanel (mover a Terminal)

3. **Mejorar:**
   - WebSocket para updates en tiempo real
   - Navegación directa a posiciones
   - Estados vacíos bien diseñados

### C. Control de Sistema — Unificación:
1. **Crear sección operativa:**
   - Bot Normal: ON/OFF + Mode (real/dry run)
   - IDCA: ON/OFF + Mode (live/simulation/dry run)
   - Explicación clara de cada modo
   - Confirmación para cambios críticos

2. **Eliminar redundancias:**
   - BotControl → Convertir en operativo o eliminar
   - Strategies → Mantener solo config avanzada
   - Un solo lugar para controlar modos

### D. Importadas/Recuperar — Limpieza:
1. **Clasificar operaciones:**
   - Válidas y consistentes → Mantener
   - Duplicadas → Consolidar
   - Inconsistentes → Archivar (soft delete)
   - Dry run mal clasificadas → Reubicar

2. **Backfill defensivo:**
   - Validar datos antes de importar
   - Detectar duplicados por sim_txid
   - Rechazar operaciones sin pair/type/price
   - Limitar a ventana temporal razonable

---

## 8. RIESGOS IDENTIFICADOS

### Críticos:
1. **Mezcla FIFO real con dry run** → Puede corromper contabilidad
2. **Backfill sin filtros** → Puede llenar BD con basura
3. **Dashboard stale** → Decisiones basadas en datos viejos

### Medios:
1. **Controles duplicados** → Confusión operativa
2. **Importadas inconsistentes** → Ruido en UI
3. **Dry run no visible** → Usuario no sabe qué está simulado

### Bajos:
1. **Gráficas ausentes** → Falta de visibilidad
2. **Navegación pobre** → Fricción operativa

---

## 9. CONCLUSIONES FASE 1

### Estado Actual:
- ✅ Arquitectura de datos bien separada (dry_run_trades vs trades)
- ✅ IDCA completamente aislado con modos explícitos
- ❌ Dry run NO se comporta funcionalmente como real en UI
- ❌ Dashboard desactualizado y poco operativo
- ❌ Controles dispersos y confusos
- ❌ Backfill puede traer operaciones inconsistentes

### Próximos Pasos (FASE 2-8):
1. Corregir comportamiento dry run (aislamiento + experiencia)
2. Limpiar importadas/recuperar (clasificación + archivo)
3. Refactorizar dashboard (gráficas + posiciones + navegación)
4. Unificar controles (operativo + explicativo)
5. Modernizar UX (gráficas + estados + navegación)
6. Pruebas exhaustivas (dry run + real + IDCA + dashboard)
7. Limpieza final (código muerto + commits + push)
8. Informe final estructurado

---

**FIN FASE 1**
