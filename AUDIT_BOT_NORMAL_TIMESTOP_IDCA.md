# AUDITORÍA — Bot Normal DRY_RUN, TimeStop y Modo IDCA

**Fecha:** 2026-04-19
**Autor:** Windsurf Cascade (auditoría local, sin VPS)
**Alcance:** FASES 0, 1, 3, 5 del plan. **Sin cambios de código** — sólo diagnóstico y propuestas. Las fases 2, 4, 6, 7, 8 (correcciones + deploy) quedan en espera de aprobación.

---

## FASE 0 — Contexto detectado

### Bitácora / correcciones previas relevantes
- `BITACORA.md` → última actualización `2026-01-24`.
- `FASE1_AUDITORIA_ARQUITECTURA.md` / `FASE2_CORRECCION_DRY_RUN.md` → refactor reciente DRY_RUN (tabla `dry_run_trades` separada; UI nuevas pestañas DRY en Terminal).
- `AUDIT_FASE1.md`, `IDCA_AUDIT_REPORT.md` → auditorías previas IDCA (contexto).
- Commits recientes clave: `b0f9612` (humanMessage multi-block), `9cbe8d5` (KrakenRL backpressure, catch-up cap, degraded state, dedup Telegram, DRY_RUN guard), `c1082c7` (gate reentrada + spam Telegram NORMAL DRY_RUN), `d6465bd` (helpers privados LIVE/DRY paridad), `c3c76fa` (slider maestro Smart Exit).
- **Ramas activas:** `main` (única rama usada).

### Ficheros gobernantes

| Área | Fichero |
|---|---|
| Motor bot normal | `server/services/tradingEngine.ts` (376 KB) |
| Motor de salidas | `server/services/exitManager.ts` (79 KB) |
| Servicio TimeStop smart | `server/services/TimeStopService.ts` |
| Builder alertas TimeStop | `server/services/alertBuilder.ts` |
| IDCA | `server/services/institutionalDca/IdcaEngine.ts` (159 KB) |
| UI salidas | `client/src/components/trading/SalidasTab.tsx` |
| UI IDCA config | `client/src/pages/InstitutionalDca.tsx` |
| Schema | `shared/schema.ts` (`bot_config`, `time_stop_config`, `institutional_dca_config`) |

### Riesgos de regresión antes de tocar nada
1. Cualquier cambio en `runTradingCycle()` puede afectar LIVE: el código está compartido entre DRY_RUN y LIVE (refactor `d6465bd` unificó helpers). Hay que preservar ese contrato.
2. TimeStop tiene DOS rutas activas (legacy y SMART_GUARD). Eliminar una sin cuidado romperá posiciones existentes que ya tienen `timeStopExpiredAt` o `timeStopDisabled` persistido.
3. IDCA scheduler es `setInterval` fijo basado en `schedulerIntervalSeconds`. Migrar a scheduler adaptativo debe preservar `getHealthStatus()` y endpoints dependientes.
4. Tabla `time_stop_config` existe con wildcard `*:spot`. Si el usuario no conoce que existe, borrar/mezclar filas puede cambiar el comportamiento real.

---

## FASE 1 — Auditoría BOT NORMAL en DRY_RUN (fuera de horario)

### Evidencia del usuario (logs)
- `scanTime ~ 2026-04-18T22:30:29Z` (22:30 UTC → fuera de `TRADING_HOURS_END=22`)
- `lastCandleClosedAt ~ 2026-04-18T14:00:00Z` → `candleAgeSec ~ 48000+` (~13h)
- `SCAN_SKIP_REASON reason=TRADING_HOURS` repetido cada ~5s
- `PAIR_DECISION_TRACE` para BTC/USD y ETH/USD cada scan
- `EXIT_EVAL` por posiciones abiertas
- `KrakenRL Too many requests` también fuera de horario

### Mapa del ciclo real (`tradingEngine.runTradingCycle`, líneas 2860–3020)

Cadencia: `getIntervalForStrategy()` → **5 s** en modo vela (`momentum` + `signalTimeframe != "cycle"` + flag `candleCloseTriggerEnabled`) o **30 s** en momentum por ciclos. La evidencia del usuario (~5 s) confirma que el bot está en candle mode.

**Cada 5 s, en este orden, ANTES del early-return por `TRADING_HOURS`, se ejecuta:**

| Paso | Coste | Dónde |
|---|---|---|
| `storage.getOpenPositions()` | 1 query DB | 2874 |
| `getTradingExchange().getBalance()` | 1 call a Kraken (rate-limited) | 2882 |
| Reset diario P&L | trivial | 2886-2900 |
| Check daily loss limit | trivial | 2902-2937 |
| **`exitManager.checkStopLossTakeProfit()` por CADA par activo** | por par: varias queries+ticker+lógica SL/TP/Trailing/SmartGuard (+ log `EXIT_EVAL`) | 2947-2949 |
| **`evaluateOpenPositionsWithSmartExit()`** | scoring Smart Exit por cada posición abierta | 2952 |
| Verificar `tradingEnabled` y `positionsInconsistent` | trivial | 2955-2972 |
| Verificar límite diario | trivial | 2975-2992 |
| Verificar saldo < 5 USD | trivial | 2994-2997 |
| **CHECK `TRADING_HOURS`** → 2 logs + `emitPairDecisionTrace` por par + `return` | logs + WS push | 3000-3019 |

**Conclusión 1:** El "early return" es tardío. Todo el motor de salidas + balance + DB ya ha corrido ANTES.
**Conclusión 2:** `emitPairDecisionTrace()` publica el trace por WebSocket y DB — un par × cada 5 s × 2 logs por trace = fuente principal del ruido.

### Origen real de `lastCandleClosedAt`

- Se computa a partir de la última vela **cerrada evaluada** (línea 4564): `new Date((candle.time + interval * 60) * 1000).toISOString()`.
- Si el par se evalúa en modo "ciclo intermedio" (entre cierres de vela), se lee del cache (línea 5661).
- **Dado que fuera de horario el early-return ocurre ANTES de fetch de velas** (línea 3018 vs 3109+), `lastCandleClosedAt` se queda congelado en el último valor **del último scan dentro de horario** (≈14:00 UTC). Por eso aparece stale.

> **Es comportamiento correcto semánticamente**, pero el campo se emite igualmente en el trace `TRADING_HOURS` — lo que induce a pensar que el bot "sigue evaluando una vela vieja". En realidad no la está evaluando; sólo la está mostrando.

### Frecuencia EXIT_EVAL

- `EXIT_EVAL` se emite en **`exitManager.checkSmartGuardExit` (línea 1395)** cada vez que se evalúa una posición SMART_GUARD.
- Se invoca desde `checkStopLossTakeProfit()` → cada par activo → **cada ciclo (5 s)**. Con 2 pares y 2 posiciones abiertas ⇒ 2 logs/5 s = 24 logs/min.
- No depende de trailing/protección — corre siempre mientras hay posición abierta.
- También corre **fuera de horario** (es correcto: hay que gestionar posiciones existentes). El problema es su verbosidad constante y el `botLogger.info` que persiste a DB.

### Errores KrakenRL fuera de horario

- `getBalance()` en línea 2882 se ejecuta cada ciclo, rate-limited por `krakenRateLimiter`.
- `checkStopLossTakeProfit()` dentro lee ticker por par (para SL/TP).
- `evaluateOpenPositionsWithSmartExit()` puede fetch adicional.
- Con 2 pares × cada 5 s, la presión sobre Kraken es alta aunque no haya entradas → explica los "Too many requests".

### Causa raíz confirmada (BOT NORMAL DRY_RUN fuera de horario)

1. **Trabajo pesado antes del gate horario**: balance + exitManager + smartExit se ejecutan antes del check `TRADING_HOURS`. **Correcto funcionalmente** (hay que gestionar salidas 24/7), pero la cadencia de 5 s es excesiva para actividad de salidas cuando no hay cambio material.
2. **Emisión de PAIR_DECISION_TRACE repetitivo**: cada 5 s se emite el mismo trace con el mismo motivo `TRADING_HOURS` y el mismo `lastCandleClosedAt` congelado. Sin throttle.
3. **`lastCandleClosedAt` stale**: es un artefacto; correcto pero confunde al lector.
4. **Llamadas a Kraken innecesarias**: `getBalance()` cada 5 s fuera de horario sólo para decidir que no se puede operar.

---

## FASE 3 — Auditoría PRIORITARIA de TimeStop en modo NORMAL

### Mapa real de la lógica

**Dos fuentes de configuración conviven:**

#### Fuente A (legacy — visible en UI)
- `bot_config.timeStopHours` (default 36)
- `bot_config.timeStopMode` (`"soft" | "hard"`, default `"soft"`)
- UI: `client/src/components/trading/SalidasTab.tsx` líneas 273-300
  - Input numérico (no slider) `timeStopHours` (range 6-120)
  - Select `timeStopMode` con texto "soft = solo si hay ganancia"
  - Label "Time-Stop" con badge decorativo `AUTO` (línea 484) — **este badge no controla nada, es solo un adorno visual**

#### Fuente B (smart — invisible en UI)
- Tabla `time_stop_config` (`shared/schema.ts:739`)
- Campos: `pair`, `market`, `ttlBaseHours`, `factorTrend`, `factorRange`, `factorTransition`, `minTtlHours`, `maxTtlHours`, `closeOrderType`, `limitFallbackSeconds`, `telegramAlertEnabled`, `logExpiryEvenIfDisabled`, `isActive`
- Resolución: exact match `pair+market` → fallback wildcard `*+market` → si nada, legacy Fuente A (`timeStopHours`)
- Servicio: `server/services/TimeStopService.ts` → `calculateSmartTTL()` / `checkSmartTimeStop()`
- Fórmula: `TTL_final = clamp(ttlBaseHours × factorRegime, minTtlHours, maxTtlHours)` según régimen TREND/RANGE/TRANSITION

### Puntos de consumo

| Ruta | Archivo / línea | Qué usa |
|---|---|---|
| Entrada LEGACY (sin SMART_GUARD) | `exitManager.checkTimeStop` (473-624) | Llama `checkSmartTimeStop()` → **si no hay row smart, cae a `bot_config.timeStopHours`** |
| Entrada SMART_GUARD | `exitManager.checkSmartGuardExit` (1189-1350) | Llama `checkSmartTimeStop()` directamente — ignora `timeStopMode`/`timeStopHours` de UI |
| Carga de `exitConfig` | `exitManager.getAdaptiveExitConfig` (407-423) | Lee `bot_config.timeStopHours` + `bot_config.timeStopMode` |
| Alertas | `alertBuilder.buildTimeStopAlert` (línea 48-51) | Usa `timeStopMode` para **título** del Telegram (`"Time-Stop HARD — Cierre Inmediato"` vs texto soft) |

### Inconsistencias detectadas (CRÍTICAS)

1. **El slider de `timeStopHours` de la UI NO afecta al bot si existe un row en `time_stop_config`.**
   Si `time_stop_config` tiene `pair='*'`, `market='spot'`, `isActive=true` (configuración por defecto probable), el TTL efectivo es `ttlBaseHours × factor[regime]` y el input de la UI se ignora completamente. El usuario cree estar ajustando 36 h y el motor usa, por ejemplo, 36 × 0.8 = 28.8 h en RANGE o 36 × 1.2 = 43.2 h en TREND.

2. **`timeStopMode` ("soft" = solo si hay ganancia) es una mentira de UI.**
   Grep completo: `timeStopMode` sólo se usa en `alertBuilder.ts:51` para elegir el **título** del mensaje. **No hay ninguna condición en la lógica de cierre que requiera `priceChange > 0` en modo soft.** La lógica en `checkSmartTimeStop()` (TimeStopService.ts:194) y `checkSmartGuardExit()` (exitManager.ts:1208) cierra si expired && !disabled, **sin importar ganancia**.

3. **Prioridad de salida real en SMART_GUARD** (`checkSmartGuardExit`, líneas 1189–1350):
   - **TimeStop se evalúa PRIMERO**, antes de BE / trailing / TP.
   - Si expira y `!disabled` ⇒ `safeSell` y `return` inmediato.
   - Esto difiere de la prioridad documentada en la UI (`SalidasTab:511-519`) que pone TimeStop en posición **5 de 6**. Desalineación UI/motor.

4. **Badge "AUTO" decorativo**: la UI sugiere un modo automático que no existe. No hay `timeStopAuto` en `bot_config`. Engaña.

5. **Muchas salidas TimeStop en DRY_RUN — explicación probable**:
   - Al arrancar DRY_RUN, las posiciones se cargan de `open_positions` / `dry_run` con `openedAt` original.
   - Con TTL `*:spot` tipo 36 h y factor RANGE 0.8 → 28.8 h. Tras un parón/reinicio, muchas pueden estar ya expiradas → venta inmediata en cuanto se inicia el bot.
   - Como la lógica **no exige ganancia** (violando la semántica "soft"), se cierran a pérdida.
   - El historial DRY_RUN con "muchas salidas TimeStop" refleja exactamente este bug.

6. **Duplicación funcional**:
   - Hay un `checkTimeStop` en `exitManager.ts:473` (para modo legacy)
   - Hay un bloque TimeStop embebido en `checkSmartGuardExit` (1189-1350) — **replica lógica muy similar** (alert + close) pero con contexto SMART_GUARD.
   - Ambos usan `checkSmartTimeStop`, pero la alerta Telegram y la persistencia de `timeStopExpiredAt` se hacen en ambos sitios por separado.

### Causa raíz confirmada (TimeStop)

- **Fuente única**: no existe. Dos fuentes conviven (`bot_config` legacy + `time_stop_config` smart). La smart siempre gana si hay row wildcard.
- **Semántica "soft"**: sólo afecta al título del mensaje, no al comportamiento. Debería no cerrar en pérdidas netas.
- **UI confusa**: slider único de horas + badge "AUTO" no alineado con el modelo real (TTL base × factor régimen, clamp min/max, per-pair).
- **Demasiadas salidas TimeStop en DRY_RUN**: consecuencia directa de puntos 1+2+5.

---

## FASE 5 — Auditoría del MODO IDCA

### Scheduler actual (`IdcaEngine.ts`)

- `startScheduler()` (línea 310-324):
  - `intervalMs = schedulerIntervalSeconds × 1000` (default **60 s**)
  - `setInterval` fijo → `runTick()` cada 60 s **sin distinguir estado**

### Mapa del tick (`runTick`, línea 382)

Cada 60 s:
1. `repo.getTradingEngineControls()` → DB (read)
2. Si pausado global o IDCA off → return rápido (OK)
3. `repo.getIdcaConfig()` → DB (read)
4. Si `mode='disabled'` → return (OK)
5. `checkModuleDrawdown(config, mode)` → itera `getAllActiveCycles(mode)` (DB read) + cálculos
6. **`updateOhlcvCache()`** → por cada par allowed:
   - fetch OHLC 15 m (siempre, cada tick)
   - fetch OHLC 1 h, 4 h (siempre, cada tick) ← **coste principal**
   - fetch OHLC 1 d throttled 1×/6 h
7. Por cada `pair` en `INSTITUTIONAL_DCA_ALLOWED_PAIRS`:
   - `evaluatePair(pair, config, mode)` → `getAssetConfig`, `getCurrentPrice` (ticker), `getAllActiveCyclesForPair`, `updateCycle` write × N, `manageCycle` (BE/trailing/TP), `checkSafetyBuy`, `checkPlusActivation`, `checkRecoveryActivation`, o `checkEntry` → `performEntryCheck`
8. Log `[IDCA][TICK #N] mode=X | pair1:+0.5% | pair2:waiting | ...`

### Lo que ya está bien

- `DAILY_FETCH_INTERVAL_MS = 6h` → throttle para velas diarias
- `ENTRY_EVENT_THROTTLE_MS = 5min` → throttle para evento DB `entry_evaluated`
- Supresión de evento `data_not_ready` (línea 554-555)

### Lo que NO está optimizado (coste real por tick)

| Sub-tarea | ¿Necesaria cada 60 s? |
|---|---|
| OHLC 15m/1h/4h por par | **No** si no hay ciclo activo ni trailing armado |
| `getCurrentPrice()` (ticker) por par | **Sí** si hay ciclo activo; **No** si no hay ciclo |
| `updateCycle()` escrituras PnL | Sí pero con escritura cada 60 s aunque cambie decimal |
| `performEntryCheck` completo | Sólo tiene sentido si ya se resetearon las velas |
| `checkModuleDrawdown` | Sólo si hay ciclos activos |

### Persistencia de eventos repetidos

- `createHumanEvent({eventType: "entry_check_blocked", ...})` se emite cuando `check.blockReasons` no vacío y el primero ≠ `data_not_ready`.
- **No hay dedup por contenido/hash** — si el bloqueo tiene el mismo `blockReasons` tick tras tick (típico durante horas "calmas"), se persiste el mismo evento cada 60 s.

### Causa raíz confirmada (IDCA)

1. Un único interval fijo es suficiente para seguridad pero derrochador cuando no hay ciclos.
2. OHLC 15m/1h/4h refetch cada 60 s por par es el gasto dominante de red.
3. Persistencia de `entry_check_blocked` sin dedup material genera ruido en la DB de eventos.
4. No hay distinción entre "ciclo activo con trailing armado" y "ciclo activo en DCA normal" — todos reciben la misma atención.

---

## Resumen de hallazgos y prioridades

| # | Hallazgo | Severidad | Fase |
|---|---|---|---|
| H1 | TRADING_HOURS gate llega tarde: balance + exitManager corren antes aun fuera de horario | Media | 1 |
| H2 | PAIR_DECISION_TRACE emitido sin throttle cada 5 s cuando nada cambia | Alta (ruido/DB) | 1 |
| H3 | `lastCandleClosedAt` stale confunde en el trace fuera de horario | Baja | 1 |
| H4 | `getBalance()` a Kraken cada 5 s fuera de horario | Media | 1 |
| H5 | EXIT_EVAL ruidoso por tick aunque no haya cambio material | Media | 1 |
| **H6** | **Doble fuente TimeStop (`bot_config` legacy + `time_stop_config` smart) — UI muestra una que no siempre se usa** | **Crítica** | 3 |
| **H7** | **`timeStopMode` "soft" no implementa "solo si hay ganancia" — semántica mentida** | **Crítica** | 3 |
| H8 | Badge "AUTO" decorativo en UI Time-Stop | Media | 3 |
| H9 | Prioridad real de TimeStop (1ª) no coincide con la documentada en UI (5ª) | Media | 3 |
| H10 | Duplicación de código TimeStop entre `checkTimeStop` y `checkSmartGuardExit` | Baja | 3 |
| H11 | IDCA scheduler único fijo 60 s sin distinguir idle/active/protected | Media | 5 |
| H12 | OHLC 15m/1h/4h refetch cada tick por par (dominante en coste de red) | Media | 5 |
| H13 | `entry_check_blocked` sin dedup material genera ruido en DB | Media | 5 |

---

## Propuestas de corrección (pendientes de aprobación)

> Ninguna se aplica hasta que apruebes. Donde una propuesta no encaje con la arquitectura actual, lo indico y ofrezco alternativa más limpia.

### Para BOT NORMAL (Fases 2)

1. **Mover el check `TRADING_HOURS` arriba** — antes de `checkStopLossTakeProfit()` no es aceptable (hay que gestionar posiciones 24/7). **Alternativa recomendada:**
   - Mantener checkStopLossTakeProfit/SmartExit fuera de horario (correcto funcionalmente)
   - PERO elevar `getBalance()` sólo cuando se vaya a operar (ya lo necesita el exitManager para computar `getAssetBalance`), o cachear balance si el último fue < 30 s.
   - Y **omitir por completo la emisión de PAIR_DECISION_TRACE fuera de horario** (H2).
2. **Throttle de PAIR_DECISION_TRACE** (H2): si el `blockReasonCode` y `lastCandleClosedAt` no han cambiado respecto al trace anterior del par, NO emitir (dedup por contenido). Reduce ruido ≈95 %.
3. **Throttle EXIT_EVAL** (H5): emitir `EXIT_EVAL` sólo cada N ciclos (p. ej., 12 = 60 s en candle mode) o cuando haya transición material (BE armado, trailing movido, regime change). Mantener el log humano resumido.
4. **Cache de balance 30 s en el cycle** (H4): `currentUsdBalance` se re-fetch innecesariamente. Guardar `lastBalanceFetchedAt` y reutilizar si < 30 s y no hay trade reciente.
5. **Corregir semántica de `lastCandleClosedAt` en el trace fuera de horario** (H3): o omitirlo del payload cuando `blockReasonCode === 'TRADING_HOURS'`, o añadir flag explícito `candleStaleReason: 'OUT_OF_HOURS'`.

### Para TIMESTOP (Fase 4)

**Propuesta A — recomendada: fuente única = `time_stop_config`.**
1. Deprecar `bot_config.timeStopHours` / `bot_config.timeStopMode` como fuente activa; conservar columnas para backward compat pero no leerlas en el motor.
2. Reescribir UI `SalidasTab` TimeStop como panel per-pair con:
   - Slider maestro "Horas TTL base" (6–168)
   - Toggle "Factor régimen" (on/off) — si off, factor = 1 siempre
   - 3 sliders avanzados: factor TREND / RANGE / TRANSITION
   - min/max clamp
   - Switch "Cerrar sólo si ganancia ≥ feeRoundTrip" (implementación REAL del modo soft)
3. Añadir endpoint CRUD `GET/PUT /api/time-stop-config` (hay tabla — falta UI).
4. Implementar de verdad el modo "soft": antes de cerrar en `checkSmartTimeStop`, si `softMode && priceChangePct <= feeRoundTripPct` → no cerrar, solo loggear.
5. Eliminar badge "AUTO" o convertirlo en toggle real "Usar régimen dinámico".

**Propuesta B — alternativa ligera (si no quieres tocar UI grande aún):**
- Dejar `time_stop_config` como está.
- Hacer que el input de UI escriba en `time_stop_config` wildcard `*:spot.ttlBaseHours` (sync automático), y ocultar el resto.
- Implementar el modo soft real (corrige H7 sin UI grande).

> **Trade-off:** A es la solución definitiva; B resuelve el bug crítico sin rework de UI. Recomiendo **B primero (ship rápido del fix)**, luego A en iteración siguiente.

6. **Desduplicar código** (H10): extraer la emisión de alerta + cierre a un método `_executeTimeStopClose(position, tsResult)` en ExitManager y reutilizarlo desde `checkTimeStop` y `checkSmartGuardExit`.

### Para IDCA (Fases 6 + 7)

**Scheduler adaptativo (Variante 2 que pediste):**

1. Nuevas columnas en `institutional_dca_config`:
   - `schedulerIdleSeconds` (default **900** = 15 min)
   - `schedulerActiveSeconds` (default **300** = 5 min)
   - `schedulerProtectedSeconds` (default **120** = 2 min)
   - Conservar `schedulerIntervalSeconds` como fallback.
2. Cambiar `startScheduler` de `setInterval` fijo a **`setTimeout` recursivo** que decide el siguiente delay tras cada tick según estado global:
   - Hay algún ciclo en `trailing_active`, `protection_armed` o con trigger price dentro de ±1 % → `protectedSeconds`
   - Hay ciclos activos (cualquier subtype) → `activeSeconds`
   - Sin ciclos activos → `idleSeconds`
3. Añadir función `computeNextDelayMs(state)` → devuelve uno de los 3 valores.
4. UI en `InstitutionalDca.tsx` → pestaña Configuración:
   - Slider maestro (0–100) "Más rápido ↔ Equilibrado ↔ Más tranquilo" que mueve los 3 correlacionadamente usando curva preset (p. ej., `rápido: 300/120/60`, `equilibrado: 900/300/120`, `tranquilo: 1800/600/180`)
   - Sección "Configuración avanzada" colapsable con 3 sliders independientes
   - Labels claros: "Cuando no hay nada abierto" / "Cuando hay un ciclo activo" / "Cuando está cerca de comprar/vender o protegiendo salida"

**Reducción de ruido IDCA:**
5. **OHLC fetch condicional**: saltar el fetch de 15m/1h/4h si no hay ciclo activo en el par Y el último fetch fue < `idleSeconds`. Mantener throttle 6h para 1d (ya existe).
6. **Dedup `entry_check_blocked`**: por par, guardar hash `(blockReasons[0].code + Math.round(entryDipPct))` y sólo persistir evento si cambió o pasaron > 15 min.
7. **Skip tick completo cuando `institutionalDcaEnabled=false` Y no hay ciclos activos** — en vez de pasar por `getIdcaConfig` y `updateOhlcvCache`.

---

## Métricas antes/después (estimado)

| Métrica | Antes | Después propuesto |
|---|---|---|
| Ticks BOT por minuto fuera de horario | 12 (cada 5 s) | 12 (mantener, pero **sin PAIR_DECISION_TRACE**) |
| Logs PAIR_DECISION_TRACE/min fuera de horario | 24 (2 pares × 12 scans) | ≤ 1 cuando algo cambia |
| Logs EXIT_EVAL/min en DRY_RUN (2 posiciones) | 24 | ≤ 2 |
| `getBalance()` Kraken calls/min fuera de horario | 12 | 2 (cache 30 s) |
| Ticks IDCA/h sin ciclos | 60 | 4 (cada 15 min) |
| Ticks IDCA/h con ciclo activo | 60 | 12 (cada 5 min) |
| Ticks IDCA/h protegido | 60 | 30 (cada 2 min) |
| Eventos IDCA persistidos/h sin cambio | 60 | ≤ 4 |
| Cierres TimeStop a pérdida en DRY_RUN soft | alto (semántica mentida) | 0 (modo soft real) |

---

## Qué necesito de ti para continuar

Responde a estas decisiones (o di "procede con las recomendadas"):

- **TS1** — TimeStop: ¿Propuesta A (refactor UI grande, fuente única `time_stop_config`) o **Propuesta B (fix mínimo ahora, refactor UI después)**?
- **IDCA1** — ¿Mantienes los defaults sugeridos (15m / 5m / 2m) o quieres otros?
- **TH1** — ¿Te vale que PAIR_DECISION_TRACE se emita SOLO cuando el `blockReasonCode` del par cambie respecto al anterior? (reduce 95 % del ruido sin perder visibilidad)
- **EXIT1** — ¿EXIT_EVAL cada 60 s en vez de cada 5 s (si no hay cambio material) es aceptable? Es lo estándar en la industria para posiciones sin trailing armado.
- **KILL** — ¿Quieres que una vez aprobado todo entregue en **un solo commit grande** o separado por fase (bot normal / timestop / idca / ui)?

---

**FIN DE LA AUDITORÍA — sin cambios aplicados.**
