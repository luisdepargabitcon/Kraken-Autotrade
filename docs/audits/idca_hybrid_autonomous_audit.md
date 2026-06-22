# Auditoría Autónoma — IDCA Híbrido Inteligente

**Fecha:** 2026-06-22  
**Commit base:** `96e63f2` feat(ai-shadow)  
**Rama:** main  
**Repositorio:** c:\Users\JSLUI\Qsync\BOT_NAS\BOT_AUTOTRADE  

---

## 0. Contexto leído de CORRECCIONES_Y_ACTUALIZACIONES.md

### Decisiones técnicas relevantes ya tomadas

| Tema | Decisión |
|------|----------|
| Smart Guard config | `sgMaxOpenLotsPerPair` lee exclusivamente de `bot_config.sg_max_open_lots_per_pair`; nunca hardcode |
| Distancia dinámica lotes | ATR(14)-based via `getSmartGuardMinEntryDistancePct()`. Fallback 1.5%. Caché 5 min |
| Deduplicación Telegram | Tabla `telegram_alert_dedupe` + fingerprint lógico. TTL por tipo. NO hash exacto |
| Smart Exit alertas | Máquina de estados en `smart_exit_state`. Alerta solo en cambio de estado |
| MTF Critical | `exactLast=true` NOT es CRÍTICO. Solo lo es: mismo array, spans idénticos, step incorrecto |
| Telegram token | Almacenado en DB, no en `.env` |
| Docker base | `node:20-bookworm-slim` (Debian, no Alpine). Python venv en `/opt/ai-venv` |
| Migraciones | AutoMigrationRunner en startup (`server/routes.ts`). Lista explícita de IDs |
| Predeploy VPS | Ejecutar `bash scripts/vps-predeploy-clean-sync.sh` antes de docker compose |

### Bugs ya corregidos — NO reabrir

- ❌ No usar `maxLotsPerPair: 2` hardcodeado en `initPairTrace` (corregido con `cachedEffectiveMaxLots`)
- ❌ No duplicar detector de régimen SPOT — existe `regimeDetection.ts` + `regimeManager.ts`
- ❌ No crear tabla de dedup Telegram sin usar la ya existente (`telegram_alert_dedupe`)
- ❌ No abrir múltiples posiciones en el mismo tick sin pasar por `checkMultiLotEntryGate`
- ❌ No enviar alertas Smart Exit por cada tick de evaluación — solo en cambio de estado

### Reglas sobre IDCA / VWAP / ancla / basePrice

- **NUNCA reescribir** `anchor`, `basePrice`, `basePriceType` del ciclo activo desde lógica híbrida
- `frozenAnchorPrice` en `IdcaMarketContextService` es un snapshot de lectura; NO modificar el source
- `vwapAnchorMemory` es el mapa in-memory para referencia de entrada — solo escribe el engine IDCA original
- `basePriceType` puede ser: `vwap_anchor` | `hybrid_v2_fallback` | legacy — el híbrido NO puede cambiarlo
- `avgEntryPrice` es calculado por el engine IDCA en safety buys — híbrido NO puede modificarlo
- Reversión a la Media es **filtro de entrada**, nunca estrategia independiente

### Reglas sobre Smart Guard / Smart Exit

- Smart Guard es para el modo SPOT (TradingEngine) — NO aplica a IDCA
- Smart Exit Engine (`SmartExitEngine.ts`) es para SPOT — NO aplica a IDCA
- IDCA tiene su propio `IdcaExitManager.ts` y `IdcaExitExecutor.ts`

### Reglas sobre Modo Observador / Shadow Mode

- `dry_run_trades` = tabla de DRY RUN del modo SPOT
- `ai_shadow_decisions` = tabla de Shadow Mode del AI filter
- Para IDCA Híbrido: usar nueva tabla `idca_hybrid_state` (evitar colisión con las anteriores)
- Observer mode IDCA Híbrido: NO ejecutar órdenes reales, solo registrar hipotéticas

### Reglas sobre Telegram / alertas / dedupe

- Extender sistema existente — NO crear `TelegramService` paralelo
- Usar `IdcaTelegramNotifier.ts` como punto de envío para eventos IDCA
- Aplicar dedupe: usar tabla `telegram_alert_dedupe` existente con fingerprint lógico
- TTL mínimo para dedup: 15 minutos por evento repetido del mismo tipo+par

### Reglas sobre migraciones

- Último número usado: `056_ai_shadow_decisions.sql`
- Siguiente disponible: `057_idca_hybrid_intelligent_layers.sql`
- Formato obligatorio: `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS`
- Añadir al array en `server/routes.ts` `AutoMigrationRunner`

---

## 1. Resumen Ejecutivo

| Campo | Valor |
|-------|-------|
| Detector de régimen existente | **Sí** (SPOT: TREND/RANGE/TRANSITION; IDCA: contexto VWAP parcial) |
| Ubicación detector SPOT | `server/services/regimeDetection.ts` + `regimeManager.ts` |
| Lo usa modo normal/SPOT | **Sí** — `TradingEngine.ts` vía `regimeManager` |
| Lo usa IDCA | **No directamente** — IDCA usa `IdcaMarketContextService` (VWAP+ATR, sin regime label) |
| Reutilizable para IDCA Híbrido | **Parcial** — `IdcaMarketContextService` tiene VWAP/ATR/drawdown pero no clasifica lateral/bullish/bearish |
| Recomendación | **Crear adaptador** `IdcaRegimeAdapter.ts` que consume `IdcaMarketContextService` y añade clasificación de régimen |
| Riesgo principal | Interferir con ancla/basePrice del ciclo activo |
| Decisión de implementación | Híbrido como capa aditiva (filtro). Default: `idca_hybrid_mode='off'`. No rompe nada existente. |

---

## 2. Mapa de Servicios Existentes

| Archivo | Responsabilidad | Lo usa SPOT | Lo usa IDCA | Reutilizable | Observaciones |
|---------|----------------|-------------|-------------|--------------|---------------|
| `regimeDetection.ts` | Detección TREND/RANGE/TRANSITION vía ADX+EMA+Bollinger | ✅ | ❌ | Parcial | Vocabulario diferente al que IDCA necesita |
| `regimeManager.ts` | Persistencia y cambio de estado de régimen SPOT | ✅ | ❌ | No directo | Acoplado a TradingEngine |
| `MarketDataService.ts` | Velas/precio cacheados (TTL) | ✅ | ✅ | ✅ | Fuente canónica de datos de mercado |
| `IdcaSmartLayer.ts` | `computeVwapAnchored`, `computeATR`, `computeEMA`, `computeRSI`, `computeMarketScore` | ❌ | ✅ | ✅ | Reutilizar funciones aquí para híbrido |
| `IdcaMarketContextService.ts` | VWAP, ATR, drawdown, dataQuality, ancla | ❌ | ✅ | ✅ | Base principal para RegimeAdapter |
| `IdcaEngine.ts` | Motor principal IDCA: entry/safety/exit/trailing | ❌ | ✅ | Punto de integración | Modificar mínimamente antes de `checkEntry` |
| `IdcaTelegramNotifier.ts` | Alertas Telegram IDCA | ❌ | ✅ | ✅ | Extender para alertas híbridas |
| `telegram.ts` | Envío raw Telegram + dedup | ✅ | ✅ | ✅ | No modificar directamente |
| `indicators.ts` | EMA, ADX, Bollinger (SPOT) | ✅ | ❌ | Parcial | `IdcaSmartLayer.ts` tiene sus propias implementaciones |
| `SmartExitEngine.ts` | SMART EXIT para SPOT | ✅ | ❌ | ❌ | NO usar para IDCA |
| `exitManager.ts` | SELL logic SPOT | ✅ | ❌ | ❌ | IDCA tiene `IdcaExitManager.ts` propio |

---

## 3. Modo Normal/SPOT

- **Entradas**: `TradingEngine.analyzePairAndTrade` + `analyzePairAndTradeWithCandles`
- **Salidas**: `exitManager.ts` > `safeSell()` → `checkStopLossTakeProfit`, `evaluateOpenPositionsWithSmartExit`
- **Smart Guard**: `checkMultiLotEntryGate()` en `tradingEngine.ts` — 4 gates (max lots, cooldown 10min, distancia 1.5%/ATR, dedup vela)
- **Smart Exit**: `SmartExitEngine.ts` — máquina de estados, fee-band, alertas por cambio de estado
- **Régimen**: `regimeDetection.ts` → `regimeManager.ts` — TREND/RANGE/TRANSITION via ADX+EMA+Bollinger
- **Alertas**: `telegram.ts` + `telegram_alert_dedupe`
- **Observador/DryRun**: `dry_run_trades` tabla
- **Autoafinación**: `aiService.ts` + `ai_shadow_decisions` (Shadow Mode)
- **Reutilizable para híbrido**: `MarketDataService`, `IdcaSmartLayer.ts` funciones

---

## 4. Modo IDCA

- **Nacimiento ciclo**: `IdcaEngine.ts` → `checkEntry()` → `performEntryCheck()` → si allowed → `executeCyclePurchase()`
- **basePrice/ancla**: `IdcaSmartLayer.computeBasePrice()` + `IdcaEntryReferenceResolver.resolveEffectiveEntryReference()`
- **avgEntryPrice**: Calculado en `IdcaRepository` al hacer safety buy (suma ponderada)
- **nextBuyPrice**: Calculado por `IdcaDistanceResolver` basado en distancia dinámica/ATRP
- **Safety buys**: `IdcaEngine.ts` línea ~650-1250 — `checkSafetyBuy()` → gates → `executeSafetyBuy()`
- **Salidas**: `IdcaExitManager.ts` → `IdcaExitExecutor.ts` — TP, stop, time-stop, manual
- **VWAP/ATR**: `IdcaSmartLayer.ts` + `IdcaMarketContextService.ts` — usados en entry check
- **No tocar**:
  - `vwapAnchorMemory` Map en `IdcaEngine.ts` — solo escribe el engine
  - `performEntryCheck()` — no modificar la lógica de verificación original
  - `IdcaExitManager/Executor` — el híbrido NO gestiona salidas
  - `basePriceType`, `avgEntryPrice`, `nextBuyPrice` del ciclo activo

---

## 5. Detector de Régimen

1. **¿Existe?** Sí, dos detectores: SPOT (`regimeDetection.ts`) e IDCA implícito (`IdcaMarketContextService.ts` con VWAP zones)
2. **¿Dónde?** `server/services/regimeDetection.ts` (SPOT) y `server/services/institutionalDca/IdcaMarketContextService.ts` (IDCA)
3. **¿Qué datos usa?** SPOT: ADX, EMA alineación, Bollinger width, candles 1h. IDCA: VWAP, ATR, drawdown desde ancla
4. **¿Qué indica?** SPOT: TREND/RANGE/TRANSITION. IDCA-MCS: dataQuality (excellent/good/poor/insufficient) + vwapZone
5. **¿Suficiente para lateral/alcista/bajista/alta vol?** IDCA-MCS: NO tiene label explícito. SPOT: RANGE ≈ lateral, pero no usado por IDCA
6. **¿Reutilizable para IDCA Híbrido?** IDCA-MCS sí, como base. Añadir clasificación encima (RegimeAdapter)
7. **¿Qué mejoras necesita?** Adaptador que map vwapZone + atrPct + EMA slope → {lateral, bullish, bearish, high_volatility, unknown}

---

## 6. Datos de Mercado

- **Fuente velas**: `MarketDataService.getCandles(pair, "1h")` — TTL 5 min, Kraken API
- **Fuente precio**: `MarketDataService.getPrice(pair)` — TTL 30s
- **Fuente ticker**: `MarketDataService` / ExchangeFactory
- **Cache**: In-memory Map con TTL per-pair
- **Single-flight**: No implementado explícitamente, pero la caché TTL previene duplicados por par
- **Kraken**: Fuente principal. RevolutX no se usa para velas/precio
- **Riesgos stale**: Si `dataQuality === 'insufficient'` → bloquear modo real del híbrido

---

## 7. Reversión a la Media

**Lo que existe:**
- `IdcaSmartLayer.computeMarketScore()` — score 0-100 basado en EMA, RSI, volumen, drawdown
- `IdcaMarketContextService` — VWAP, ATR, drawdown, vwapZone
- `performEntryCheck()` — ya evalúa `market_score_too_low`, `vwap_weekly_trend_bearish`, `breakdown_detected`
- `IdcaSmartLayer.computeVwapAnchored()` — VWAP anclado con bandas 1σ/2σ/3σ

**Lo que falta:**
- Z-score explícito: `(price - vwap) / (atr_abs)` para medir desviación estándar desde VWAP
- Clasificación allow/block/reduce_size como overlay (no como reemplazo del check existente)
- Lógica de `bearTrendBlock` separada del check existente (para el modo real del híbrido)

**Cómo integrar sin crear estrategia nueva:**
- `IdcaMeanReversionOverlay.ts` — recibe `MarketContext` de `IdcaMarketContextService` y decide
- Solo se activa cuando `idca_hybrid_mode !== 'off'`
- En modo `observer`: evalúa y registra en `idca_hybrid_state`, no bloquea
- En modo `real`: puede retornar `block_buy` antes de que `checkEntry` ejecute

---

## 8. Grid o Lógica Parecida a Grid

**¿Existe algo parecido?**
- `IdcaLadderAtrpService.ts` — Escalera de safety buys dinámica por ATRP. Es similar pero no es grid puro de trading
- `nextBuyPrice` y niveles de safety — no son grid (solo una dirección, no compra+venta lateral)

**Lo que falta:**
- Grid bidireccional: compra en nivel inferior, venta en nivel superior (spread captura)
- Tabla `idca_grid_legs` para tracking de patas individuales
- Lógica de capitalización dinámica sin reescribir ancla del ciclo principal

**Evitar duplicar compras IDCA+Grid:**
- Grid solo se activa si NO hay compra IDCA pendiente en el mismo tramo de precio
- Usar `planned_price` de grid legs para verificar colisión con `nextBuyPrice` del ciclo

---

## 9. Modo Observador

**Tablas existentes reutilizables:**
- `dry_run_trades` — DRY RUN del modo SPOT (no usar para IDCA)
- `ai_shadow_decisions` — Shadow AI (no usar)
- `institutional_dca_events` — Eventos IDCA humanos (usar para logs)

**Para híbrido:** Nueva tabla `idca_hybrid_state` con decisiones por par+ciclo
- Reutiliza `institutional_dca_events` para logs de narrativa
- `idca_grid_legs` con `observer_only=true` para legs simuladas

---

## 10. Alertas

- **Servicio Telegram**: `IdcaTelegramNotifier.ts` — punto de envío para IDCA
- **Dedupe**: `telegram_alert_dedupe` con fingerprint lógico. TTL configurable
- **Config UI**: `bot_config.telegram_alert_config` (JSONB). Nueva columna: `idca_hybrid_alert_config`
- **Extensión**: Añadir métodos en `IdcaHybridAlertService.ts` que deleguen a `IdcaTelegramNotifier`
- **Nuevos eventos**: `IDCA_REGIME_CHANGED`, `IDCA_MEAN_REVERSION_CONFIRMED`, `IDCA_MEAN_REVERSION_BLOCKED`, `IDCA_GRID_ARMED`, `IDCA_GRID_PAUSED`, `IDCA_HYBRID_DATA_STALE`, `IDCA_HYBRID_OBSERVER_DECISION`

---

## 11. UI

- **Pantalla IDCA**: `client/src/pages/InstitutionalDca.tsx` — tabs Mercado/Entradas/Salidas/Avanzado/Eventos/Terminal
- **Componentes idca**: `client/src/components/idca/` — Cards, EventCards, MarketContext, etc.
- **Dónde añadir**: Nueva pestaña "Mejoras" con componente `IdcaHybridPanel.tsx`
- **Interruptor**: Selector 3 estados (Apagado/Observador/Real) en `IdcaHybridPanel`
- **Hooks**: Extender `useInstitutionalDca.ts` con `useIdcaHybridConfig`, `useIdcaHybridStatus`

---

## 12. Duplicidades

| Capa | SPOT | IDCA | Duplicada | Acción |
|------|------|------|-----------|--------|
| Detección régimen | `regimeDetection.ts` TREND/RANGE/TRANSITION | Nuevo `IdcaRegimeAdapter.ts` | No | Conservar ambas — vocabularios distintos |
| Indicadores técnicos | `indicators.ts` (ADX, Bollinger) | `IdcaSmartLayer.ts` (EMA, RSI, ATR, VWAP) | Parcial | Conservar ambas — `IdcaSmartLayer` es el canónico para IDCA |
| Market data | `MarketDataService.ts` | Misma instancia vía `IdcaMarketContextService` | No — misma fuente | Conservar |
| Alertas Telegram | `telegram.ts` | `IdcaTelegramNotifier.ts` | No — mismo servicio subyacente | Conservar |
| Observador/DryRun | `dry_run_trades` | `idca_hybrid_state` (nuevo) | No | Conservar — propósitos distintos |
| Exit logic | `exitManager.ts` | `IdcaExitManager.ts` | Paralelas intencionadas | Conservar — motores independientes |

---

## 13. Riesgos

### Trading
- ❗ **Riesgo mayor**: `idca_hybrid_mode = 'real'` podría bloquear entradas legítimas si el clasificador de régimen falla → Mitigación: `dataQuality check` antes de bloquear; fail-open en `observer` si hay error
- ❗ Grid real podría solapar con safety buy del ciclo → Mitigación: check `planned_price vs nextBuyPrice` antes de armar grid
- ❗ Grid parcial podría confundirse con cierre de ciclo → Mitigación: `idca_grid_legs.observer_only=true` por defecto; grid real requiere flag explícito

### Técnicos
- `IdcaEngine.ts` es 333KB — injection mínima, sin refactorizar
- `IdcaMarketContextService.getMarketContext()` puede lanzar si no hay precio → manejar con try/catch en HybridDecisionService
- `vwapAnchorMemory` es un Map privado en IdcaEngine — no expuesto externamente → RegimeAdapter debe usar `IdcaMarketContextService` en su lugar

### DB
- Migración 057 debe ser idempotente (IF NOT EXISTS en todo)
- Colisión de numeración ya ocurrió antes (048, 049 duplicados) → confirmar que 057 no existe

### UI
- Tab "Mejoras" no debe sobrecargar la pantalla principal IDCA — usar collapsible por defecto

### Órdenes Reales
- Grid en modo `real` queda **deshabilitado por defecto** (default `gridEnabled = false` en `idca_hybrid_config`)
- `executionScope = 'observer'` es el default aunque `idca_hybrid_mode = 'real'`

---

## 14. Plan de Implementación Adoptado

| # | Fase | Acción | Nuevo/Modifica |
|---|------|--------|----------------|
| 1 | Migración | `057_idca_hybrid_intelligent_layers.sql` | Nuevo |
| 2 | Schema | Añadir 3 columnas a `shared/schema.ts` `botConfig` | Modifica |
| 3 | RegimeAdapter | `IdcaRegimeAdapter.ts` — wraps MarketContextService | Nuevo |
| 4 | MeanReversionOverlay | `IdcaMeanReversionOverlay.ts` — z-score + ATR filter | Nuevo |
| 5 | GridOverlay | `IdcaGridOverlay.ts` — lateral grid (observer default) | Nuevo |
| 6 | HybridDecisionService | `IdcaHybridDecisionService.ts` — coordinator | Nuevo |
| 7 | HybridAlertService | `IdcaHybridAlertService.ts` — wraps IdcaTelegramNotifier | Nuevo |
| 8 | API Routes | `server/routes/idcaHybrid.routes.ts` | Nuevo |
| 9 | Engine integration | `IdcaEngine.ts` — inject before `checkEntry` | Modifica |
| 10 | Routes registration | `server/routes.ts` — add migration + hybrid routes | Modifica |
| 11 | UI Panel | `IdcaHybridPanel.tsx` | Nuevo |
| 12 | UI Integration | `InstitutionalDca.tsx` — nueva pestaña Mejoras | Modifica |
| 13 | Tests | `idcaHybrid.test.ts` — 15+ casos | Nuevo |
| 14 | Docs | `CORRECCIONES_Y_ACTUALIZACIONES.md` | Modifica |

---

## 15. Archivos a Tocar

**Nuevos:**
- `db/migrations/057_idca_hybrid_intelligent_layers.sql`
- `server/services/institutionalDca/IdcaRegimeAdapter.ts`
- `server/services/institutionalDca/IdcaMeanReversionOverlay.ts`
- `server/services/institutionalDca/IdcaGridOverlay.ts`
- `server/services/institutionalDca/IdcaHybridDecisionService.ts`
- `server/services/institutionalDca/IdcaHybridAlertService.ts`
- `server/routes/idcaHybrid.routes.ts`
- `client/src/components/idca/IdcaHybridPanel.tsx`
- `server/services/__tests__/idcaHybrid.test.ts`
- `docs/audits/idca_hybrid_autonomous_audit.md` (este archivo)

**Modificados:**
- `shared/schema.ts` — añadir `idcaHybridMode`, `idcaHybridConfig`, `idcaHybridAlertConfig`
- `server/services/institutionalDca/IdcaEngine.ts` — inyectar antes de `checkEntry`
- `server/routes.ts` — registrar migración 057 + rutas híbridas
- `client/src/pages/InstitutionalDca.tsx` — nueva pestaña "Mejoras"
- `CORRECCIONES_Y_ACTUALIZACIONES.md`

---

## 16. Comandos Ejecutados en Auditoría

```bash
git log --oneline -15                          # estado commits
git status --short                             # working tree limpio
ls db/migrations/                              # último número migración
grep -r "regimeDetection\|regimeManager" server/services/  # detector régimen
ls server/services/institutionalDca/           # mapa IDCA
grep -r "checkEntry\|performEntryCheck" server/services/institutionalDca/IdcaEngine.ts
grep "botConfig\|smartExitConfig\|telegramAlertConfig" shared/schema.ts
grep "AutoMigrationRunner\|idca\|institutionalDca" server/routes.ts
find client/src -name "*[Ii]dca*" -type f
```

---

## 17. Conclusión — Decisión Técnica Final

**No se crea detector de régimen nuevo.** Se crea `IdcaRegimeAdapter.ts` como adaptador ligero sobre `IdcaMarketContextService` existente.

**No se duplica Telegram/alertas.** Se crea `IdcaHybridAlertService.ts` que delega en `IdcaTelegramNotifier.ts`.

**No se toca `performEntryCheck` ni la lógica de ancla/basePrice.** La integración es una capa previa que solo decide si llegar o no a `checkEntry`.

**Default seguro:** `idca_hybrid_mode='off'`, `gridEnabled=false`, `executionScope='observer'`. En `off`, el motor IDCA funciona exactamente como antes.

**Grid real** queda fuera de este commit. Solo se implementa la planificación y registro en observer mode. El grid real requerirá validación adicional antes de activarse.
