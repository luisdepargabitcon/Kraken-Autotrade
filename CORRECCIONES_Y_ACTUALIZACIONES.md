# Correcciones y Actualizaciones — Kraken-Autotrade

## CAPACIDADES DE DEPLOY Y PROCEDIMIENTO

- Los cambios de código se gestionan en el repositorio local y se suben a `origin/main` mediante git.
- El despliegue en el VPS staging se realiza con:
  ```bash
  ssh root@5.250.184.18 "cd /opt/krakenbot-staging && git pull origin main && docker compose -f docker-compose.staging.yml up -d --build"
  ```
- Antes de desplegar se requiere explicar el alcance y pedir aprobación explícita al usuario.
- Después del deploy se entregan comandos de validación y se espera verificación del usuario.

---

## 2026-01-23 — Grid Isolated V2 Tick Audit (Gate A / C)

- **Módulo:** `server/services/gridIsolated/gridIsolatedEngine.ts`
- **Problema:** `currentTickId` podía incrementarse en helpers (`processOpenCyclesShadow`, `evaluateRiskForOpenCycles`), existía el contador obsoleto `tickSequence` y las transiciones de ciclo de vida podían ocurrir en el mismo tick.
- **Motivo:** Garantizar un tick canónico, separación de fases del ciclo de vida (`TRIGGERED` → `MAKER_PENDING` → fill en ticks distintos) y un post-only realista para órdenes SELL en SHADOW.
- **Solución:**
  - Eliminado `tickSequence`; `currentTickId` solo se incrementa en `tick()`.
  - `processOpenCyclesShadow` y `evaluateRiskForOpenCycles` requieren `GridTickContext`; si no se recibe, generan un contexto fallback con `Date.now()` como `tickId` (defensa para tests).
  - `lifecycleTickId` es la fuente de separación de fases.
  - `resolveExitForCycle` permite cerrar targets fijos (`NORMAL_TARGET`, `SYNTHETIC_RUNG`, `LEGACY_PERSISTED_TARGET`) directamente desde `TRIGGERED` tras un tick de separación.
  - `advanceProtectiveExitLifecycle` impide `TRIGGERED` → `MAKER_PENDING` en el mismo tick y reinicia el trigger si cambia la ruta.
  - `computeShadowPostOnlySellPrice` aplica reglas estrictas: `requestedMakerPrice > bestBid`, `>= bestAsk`, rechazo si falta `bestAsk`, y redondeo con `getPriceTickSize`/`ceilToStep`.
  - `resolveIntendedExit` arma `NORMAL_TARGET` en cuanto existe el target, sin esperar a que el bid lo alcance.
  - `TRAILING_UPDATE` no expone `activeExitRoute` (modo vigilancia).
- **Archivos afectados:**
  - `server/services/gridIsolated/gridIsolatedEngine.ts`
  - `server/services/gridIsolated/gridIsolatedTypes.ts`
  - `server/services/gridIsolated/gridJsonbValidators.ts`
  - `server/services/gridIsolated/__tests__/gridOpenCycleShadowClose.test.ts`
- **Validaciones:**
  - `npm run check`: OK
  - `npx vitest run server/services/gridIsolated`: 120/120 passed
  - `npx vitest run`: 2621 passed, 12 failed (fallos en snapshots de Telegram e IDCA no relacionados con Grid Isolated)
- **Estado final:** Gate A y C del tick audit cerrados. Pendientes Gates D, E, F, G, H, J.

---

## 2026-01-23 — Grid Isolated V2 cierre atómico unificado (Gate D)

- **Módulo:** `server/services/gridIsolated/gridIsolatedEngine.ts`
- **Problema:** `processCycleFill` para SELL duplicaba la lógica de cierre del ciclo (PnL, persistencia, rearme BUY) en lugar de reutilizar `completeCycleShadow`.
- **Motivo:** Tener un único path transaccional atómico para cerrar ciclos tanto por fills de nivel SELL como por `processOpenCyclesShadow`.
- **Solución:**
  - La rama SELL de `processCycleFill` ahora determina la ruta de cierre (`NORMAL_TARGET`, `SYNTHETIC_RUNG`, `LEGACY_PERSISTED_TARGET`) y delega en `completeCycleShadow`.
  - `completeCycleShadow` permanece como el único punto que actualiza atomáticamente ciclo, nivel SELL y nivel BUY.
- **Archivos afectados:**
  - `server/services/gridIsolated/gridIsolatedEngine.ts`
- **Validaciones:**
  - `npm run check`: OK
  - `npx vitest run server/services/gridIsolated`: 120/120 passed
- **Estado final:** Gate D cerrado. Pendientes Gates E, F, G, H, J.

---

## 2026-01-23 — Grid Isolated V2 circuit breaker persistente (Gate E)

- **Módulo:** `server/services/gridIsolated/gridIsolatedEngine.ts`, `server/services/gridIsolated/gridIsolatedTypes.ts`, `shared/schema.ts`, `db/migrations/075_grid_circuit_breaker_persistence.sql`
- **Problema:** El estado del circuit breaker (`circuitBreakerOpen`, `openedAt`) se mantenía solo en memoria y se perdía al reiniciar el proceso.
- **Motivo:** Garantizar que un stop-loss de emergencia o error crítico persista el bloqueo de nuevas compras hasta que pase el cooldown, incluso tras reinicio.
- **Solución:**
  - Añadidas columnas `circuit_breaker_open`, `circuit_breaker_opened_at`, `circuit_breaker_reason`, `circuit_breaker_cooldown_until` a `grid_isolated_configs`.
  - Añadidos campos equivalentes a `GridIsolatedConfig` y `DEFAULT_GRID_CONFIG`.
  - `loadConfig` y `readConfigSnapshotFromDbInternal` cargan el estado desde DB.
  - `tick()` consulta `circuitBreakerCooldownUntil` y, al cerrarse, limpia estado en DB con `saveConfig()`.
  - `evaluateRiskForOpenCycles` abre el breaker en `STOP_LOSS_EMERGENCY`, calcula cooldown y persiste con `saveConfig()`.
- **Archivos afectados:**
  - `server/services/gridIsolated/gridIsolatedEngine.ts`
  - `server/services/gridIsolated/gridIsolatedTypes.ts`
  - `shared/schema.ts`
  - `db/migrations/075_grid_circuit_breaker_persistence.sql`
- **Validaciones:**
  - `npm run check`: OK
  - `npx vitest run server/services/gridIsolated`: 120/120 passed
- **Estado final:** Gate E cerrado. Pendientes Gates F, G, H, J.

---

## 2026-01-23 — Grid Isolated V2 validación JSONB estricta antes de persistir (Gate F)

- **Módulo:** `server/services/gridIsolated/gridIsolatedEngine.ts`, `server/services/gridIsolated/gridJsonbValidators.ts`
- **Problema:** Los JSONB `riskStateJson` y `makerExitStateJson` se persistían sin validación estricta tras su modificación en runtime.
- **Motivo:** Evitar estados corruptos/inválidos en DB y detectar desajustes de esquema de forma defensiva.
- **Solución:**
  - Se importan `validateRiskStateJson` y `validateMakerExitStateJson` en el motor.
  - Antes de `db.update(gridIsolatedCycles).set(...)` en `evaluateRiskForOpenCycles` se valida `nextRisk` y `nextRisk.protectiveExit`. Si fallan, se reemplazan por estados por defecto (`defaultRiskState` / `defaultMakerExit`) y se loguea el error.
- **Archivos afectados:**
  - `server/services/gridIsolated/gridIsolatedEngine.ts`
- **Validaciones:**
  - `npm run check`: OK
  - `npx vitest run server/services/gridIsolated`: 120/120 passed
- **Estado final:** Gate F cerrado. Pendientes Gates G, H, J.
