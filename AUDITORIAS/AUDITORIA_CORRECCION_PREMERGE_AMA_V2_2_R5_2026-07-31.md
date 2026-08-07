# AUDITORÍA R5 — Correcciones de Invariantes y Endurecimiento AMA V2.2

**Fecha:** 2026-07-31
**Iteración:** R5
**Branch:** `review/ama-seed-v2-2-20260729`
**Base R4 commit:** `9c86c148aecb980682e41ebc7719fbae3eaf7db9`
**origin/main:** `44cd46ff3a6e195556987968a87c8e795d66cd02`

---

## Resumen

R5 implementa 15 correcciones de invariantes y endurecimiento sobre el flujo adaptativo AMA, unificando la normalización strict en el flujo canónico HWM, validando confirmedClose, introduciendo canonical seed envelope por activo, corrigiendo fills parciales con remanente real, estableciendo fuente contable única de deployedUsd, validando evidencia ejecutada, reconstruyendo metadatos tras replan, garantizando identidad canónica de plan, reseteando límites temporales antes de decidir, endureciendo cooldown fail-closed, clasificando estados por nivel, usando cierre confirmado en decisiones, buscando ventanas consecutivas con gaps, trazando transiciones HWM con previous/current, y garantizando paridad de APIs HWM.

---

## Correcciones aplicadas

### R5.1 — Normalización strict en flujo canónico HWM
- **Archivo:** `server/services/ama/amaHwmBar.ts`
- **Cambio:** `normalizeClosedDailyClosesStrict()` es el normalizador obligatorio en `evaluateConfirmation()`, `bootstrapHWM()`, `processIncrementalClose()`. Rechaza candles sin `isClosed`, con timestamp inválido, precio negativo, o duplicados conflictivos. El normalizador permisivo `normalizeClosedDailyCloses()` queda solo para compatibilidad legacy.
- **Verificación:** `evaluateConfirmation()` reporta `normalizationValid` en su resultado. Tests 1-6 confirman.

### R5.2 — Validación de ConfirmedDailyClose
- **Archivo:** `server/services/ama/amaDeterministicEngine.ts`
- **Cambio:** `validateConfirmedDailyClose()` valida que el close tenga `isClosed: true`, timestamp parseable, precio > 0 finito. `buildCanonicalSeedPlan()` rechaza closes inválidos o no cerrados retornando `null`.
- **Verificación:** Tests 7-12 confirman aceptación de válidos y rechazo de inválidos.

### R5.3 — Canonical Seed Envelope
- **Archivo:** `server/services/ama/amaDeterministicEngine.ts`
- **Cambio:** `getCanonicalSeedEnvelope(asset)` retorna envelope inmutable por activo:
  - **BTC:** deploymentPct=75, reservePct=25, trancheCount=6, maxSeedTranchePct=18, policyId=AMA_BTC_SEED_V1_RESEARCH
  - **ETH:** deploymentPct=65, reservePct=35, trancheCount=7, maxSeedTranchePct=12, policyId=AMA_ETH_SEED_V1_RESEARCH_ONLY
- `validateAgainstSeedEnvelope()` bloquea: asset mismatch, reserve below envelope minimum, deployment above envelope max. `buildCanonicalSeedPlan()` usa envelope effective values.
- **Verificación:** Tests 13-18 confirman envelope BTC 75/25, ETH 65/35, bloqueo de parámetros de otro activo.

### R5.4 — Fills parciales con remanente real
- **Archivo:** `server/services/ama/amaTypes.ts`, `server/services/ama/amaAdaptivePlanner.ts`
- **Cambio:** `AmaTrancheCandidate` extendido con `plannedAmountUsd`, `executedAmountUsd`, `remainingAmountUsd`, `executionState` (`NOT_EXECUTED`, `PARTIALLY_EXECUTED`, `FULLY_EXECUTED`). Nuevos planes tienen `executionState=NOT_EXECUTED`, `remainingAmountUsd=amountUsd`, `executedAmountUsd=0`. Replan aplica fills: partial → `PARTIALLY_EXECUTED` con remanente; full → `FULLY_EXECUTED` e inelegible.
- **Verificación:** Tests 19-21 confirman estado inicial, partial fill con remanente, full fill inelegible.

### R5.5 — Fuente contable única de deployedUsd
- **Archivo:** `server/services/ama/amaAdaptivePlanner.ts`
- **Cambio:** `ReplanContext` usa `portfolioDeployedUsd` como fuente autoritativa. No se suma `seedInput.deployedUsd` + evidence. El plan se construye con `deployedUsd = portfolioDeployedUsd` directamente.
- **Verificación:** Tests 22-23 confirman que portfolioDeployedUsd es la fuente usada.

### R5.6 — Validación de evidencia ejecutada
- **Archivo:** `server/services/ama/amaAdaptivePlanner.ts`
- **Cambio:** `validateExecutedEvidence()` valida:
  - `trancheId` no vacío
  - `trancheId` existe en plan original
  - `seedTrancheIndex` en rango
  - `idempotencyKey` no vacío
  - sin duplicados de `idempotencyKey`
  - `executedAmountUsd` > 0
  - sin overfill (executedAmountUsd ≤ plannedAmountUsd)
- **Verificación:** Tests 24-30 confirman cada caso de rechazo.

### R5.7 — Reconstrucción de metadatos tras replan
- **Archivo:** `server/services/ama/amaAdaptivePlanner.ts`
- **Cambio:** `replanTranches()` recalcula:
  - `plannedPurchaseCount` = `candidateTranches.filter(c => c.eligible).length`
  - `planId` con payload final incluyendo confirmedClose
  - `version` = `originalPlan.version + 1`
  - `createdAt` = nuevo timestamp
- **Verificación:** Tests 31-33 confirman plannedPurchaseCount, planId distinto, version incrementada.

### R5.8 — Identidad canónica de plan
- **Archivo:** `server/services/ama/amaDeterministicEngine.ts`
- **Cambio:** `computePlanId()` incluye `cycleId`, `confirmedClose` (timestamp + price), y por candidato: `trancheId`, `amountUsd`, `eligible`, `seedTrancheIndex`, `canonicalTriggerPrice`, `remainingAmountUsd`, `executionState`, `policyId`, `policyVersion`. Excluye `createdAt`.
- **Verificación:** Tests 34-36 confirman determinismo, cambio con confirmedClose, cambio con remainingAmountUsd.

### R5.9 — Reset de límites temporales antes de decidir
- **Archivo:** `server/services/ama/amaAdaptivePlanner.ts`
- **Cambio:** `makeAdaptiveDecision()` normaliza `PeriodLimitState` (reset semanal/mensual UTC) antes de comprobar límites. `effectiveWeeklyDeployedUsd` y `effectiveMonthlyDeployedUsd` reflejan el estado normalizado.
- **Verificación:** Tests 37-38 confirman reset semanal y mensual.

### R5.10 — Cooldown fail-closed
- **Archivo:** `server/services/ama/amaAdaptivePlanner.ts`
- **Cambio:** `checkCooldownFailClosed()` valida:
  - timestamp actual parseable → `INVALID_CURRENT_TIMESTAMP`
  - `cooldownEndsAt` parseable → `INVALID_COOLDOWN_ENDS_AT`
  - policy válida → `INVALID_COOLDOWN_POLICY`
  - timestamp actual ≥ lastTrancheAt → `OUT_OF_ORDER_TIMESTAMP`
- `makeAdaptiveDecision()` retorna `ABORT` con `COOLDOWN_INVALID:<reason>` si cooldown inválido.
- **Verificación:** Tests 39-43 confirman cada caso fail-closed y ABORT.

### R5.11 — Estados por nivel
- **Archivo:** `server/services/ama/amaAdaptivePlanner.ts`
- **Cambio:** `AdaptiveDecision.levelStates` clasifica cada candidato:
  - `SELECTED` — tramo seleccionado para ejecución
  - `PENDING_COOLDOWN` — crossed pero cooldown activo
  - `PENDING_PERIOD_LIMIT` — crossed pero límite temporal excedido
  - `GUARDRAIL_BLOCKED` — crossed pero guardrail bloquea
- **Verificación:** Tests 44-46 confirman levelStates presentes, PENDING_COOLDOWN durante cooldown, SELECTED en tramo elegido.

### R5.12 — Decisión basada en cierre confirmado
- **Archivo:** `server/services/ama/amaDeterministicEngine.ts`, `server/services/ama/amaAdaptivePlanner.ts`
- **Cambio:** `buildCanonicalSeedPlan()` almacena `asOfConfirmedCloseTimestamp` y `asOfConfirmedClosePrice` en el plan. `makeAdaptiveDecision()` usa `plan.asOfConfirmedClosePrice` para detectar crossed levels, no precio live.
- **Verificación:** Tests 47-48 confirman campos en plan y uso de confirmedClose para crossed levels.

### R5.13 — Búsqueda de ventanas consecutivas con gaps
- **Archivo:** `server/services/ama/amaHwmBar.ts`
- **Cambio:** `findConsecutiveConfirmationWindow(closes, requiredConfirmations, reversalThresholdPrice, hwmPrice)` busca primera secuencia de N cierres consecutivos UTC que cumplan threshold. Gap resetea ventana. No usa cierres posteriores al confirmado.
- **Verificación:** Tests 49-52 confirman finding con secuencia, skip de gap, insuficientes, y evaluateConfirmation con gaps no confirma.

### R5.14 — Transición HWM con previous/current
- **Archivo:** `server/services/ama/amaHwmBar.ts`
- **Cambio:** `processIncrementalClose()` retorna `HwmTransition`:
  - `previous` — HWM anterior (con status actualizado si supersede)
  - `current` — HWM nuevo o existente
  - `transition` — `UNCHANGED`, `UPDATED`, `CONFIRMED`, `SUPERSEDED`, `REJECTED`
  - `reasonCodes` — motivos de la transición
- SUPERSEDED: `previous.status=SUPERSEDED`, `previous.supersededBy=current.hwmId`, `current.status=CANDIDATE`.
- **Verificación:** Tests 53-56 confirman estructura, supersede, rejected, unchanged.

### R5.15 — Paridad de APIs HWM
- **Archivo:** `server/services/ama/amaHwmBar.ts`
- **Cambio:** `isReversalConfirmed(hwmPrice, hwmTimestamp, reversalThresholdPct, requiredDailyCloses, dailyCloses)` delega a `evaluateConfirmation()`. Ambas producen mismo resultado para mismos inputs.
- **Verificación:** Tests 57-58 confirman paridad para caso confirmado y rechazado.

---

## Archivos modificados

| Archivo | Cambios |
|---------|---------|
| `server/services/ama/amaDeterministicEngine.ts` | R5.2, R5.3, R5.7, R5.8: ConfirmedDailyClose, CanonicalSeedEnvelope, validateAgainstSeedEnvelope, computePlanId con confirmedClose, buildCanonicalSeedPlan con envelope |
| `server/services/ama/amaAdaptivePlanner.ts` | R5.4, R5.5, R5.6, R5.7, R5.9, R5.10, R5.11, R5.12: ExecutedTrancheEvidence extendido, ReplanContext con portfolioDeployedUsd, validateExecutedEvidence, replanTranches con fills, makeAdaptiveDecision con reset/cooldown/levelStates/confirmedClose |
| `server/services/ama/amaTypes.ts` | R5.4, R5.12: TrancheExecutionState, campos de fill parcial, asOfConfirmedClose |
| `server/services/ama/amaHwmBar.ts` | R5.1, R5.13, R5.14, R5.15: normalizeClosedDailyClosesStrict en flujo canónico, findConsecutiveConfirmationWindow, HwmTransition, isReversalConfirmed nueva firma |
| `server/services/ama/__tests__/amaR5Invariants.test.ts` | **NUEVO** — 58 tests R5 |
| `server/services/ama/__tests__/amaR2Corrections.test.ts` | Fix: HwmTransition `.current`, `isClosed: true` en closes |
| `server/services/ama/__tests__/amaHwmBar.test.ts` | Fix: `isClosed: true` en closes, `isReversalConfirmed` nueva firma |
| `server/services/ama/__tests__/amaR4Integration.test.ts` | Fix: R5 API en tests R4 (portfolioDeployedUsd, evidence fields, HwmTransition, ETH 65/35) |
| `server/services/ama/__tests__/amaAdaptivePlanner.test.ts` | Fix: portfolioDeployedUsd en ReplanContext, campos R5 en evidence |

---

## Tests

- **Total AMA:** 695 tests en 22 archivos — **TODOS PASAN**
- **R5 nuevos:** 58 tests en `amaR5Invariants.test.ts`
- **R4/R2/HWM actualizados:** 4 archivos de test corregidos por cambios de API R5
- **Diferencia respecto a R4:** 695 - 637 = +58 tests

---

## Validación

- **npm run check:** pendiente de ejecución final R5.18
- **npm run build:** pendiente de ejecución final R5.18
- **Tests AMA:** `vitest run server/services/ama` — 695/695 pass (22 archivos)
- **Tests Portfolio:** pendiente de ejecución final R5.18
- **Suite completa:** pendiente de ejecución final R5.18
- **Fallos nuevos esperados:** 0
- **Skipped nuevos esperados:** 0

---

## Invariantes verificadas

### Normalización strict
- `evaluateConfirmation()` usa `normalizeClosedDailyClosesStrict()` ✅
- `bootstrapHWM()` usa `normalizeClosedDailyClosesStrict()` ✅
- `processIncrementalClose()` usa `normalizeClosedDailyClosesStrict()` ✅
- `isReversalConfirmed()` delega a `evaluateConfirmation()` → strict ✅
- El normalizador permisivo `normalizeClosedDailyCloses()` no se usa en flujo canónico ✅

### isClosed
- No hay default implícito para `isClosed` — debe estar presente ✅
- `isClosed: false` se respeta (no se convierte a true) ✅
- `isClosed: undefined` se rechaza en strict ✅
- Ausencia de `isClosed?` opcional en tipos del flujo canónico ✅

### Bloqueo de velas conflictivas
- Mismo timestamp, distinto precio → `CONFLICTING_CLOSED_CANDLE` ✅
- Mismo timestamp, mismo precio → dedup ✅
- Open + closed mismo timestamp → closed prevalece ✅

### Validación de confirmedClose
- `isClosed: true` obligatorio ✅
- Timestamp parseable ✅
- Precio > 0 finito ✅
- `buildCanonicalSeedPlan()` rechaza inválidos ✅

### Envelope BTC 75/25
- `getCanonicalSeedEnvelope("BTC")` → deploymentPct=75, reservePct=25, trancheCount=6 ✅
- Reserve below 25 → rechazado ✅
- Deployment above 75 → rechazado ✅

### Envelope ETH 65/35
- `getCanonicalSeedEnvelope("ETH")` → deploymentPct=65, reservePct=35, trancheCount=7 ✅
- Reserve below 35 → rechazado ✅
- Deployment above 65 → rechazado ✅

### Parámetros de otro activo bloqueados
- `input.parameters.asset !== input.asset` → `ASSET_MISMATCH` ✅
- BTC input con ETH params → rechazado ✅

### Fills parciales con remanente real
- `plannedAmountUsd = 7000`, `executedAmountUsd = 3500` → `remainingAmountUsd = 3500` ✅
- `executionState = PARTIALLY_EXECUTED` ✅
- Dos fills parciales (2000 + 1500 = 3500) → remanente = 3500 ✅

### Evidencia ejecutada validada
- trancheId vacío → rechazado ✅
- trancheId no en plan → rechazado ✅
- seedTrancheIndex fuera de rango → rechazado ✅
- idempotencyKey vacío → rechazado ✅
- idempotencyKey duplicado → rechazado ✅
- executedAmountUsd ≤ 0 → rechazado ✅
- Overfill → rechazado ✅

### Fuente desplegada autoritativa
- `portfolioDeployedUsd` es la fuente autoritativa ✅
- No se suma `seedInput.deployedUsd` + evidence ✅
- No hay doble suma de los mismos fills ✅

### plannedPurchaseCount recalculado
- `plannedPurchaseCount === candidateTranches.filter(c => c.eligible).length` ✅
- Tras fills se recalcula ✅

### planId derivado del payload final
- Incluye `remainingAmountUsd` → cambia planId ✅
- Incluye `eligibility` → cambia planId ✅
- Incluye `confirmedClose` → cambia planId ✅
- `createdAt` no afecta planId ✅
- Mismo payload → mismo planId ✅
- Distinto orden de evidence → mismo planId (replan es determinista) ✅

### Reset semanal y mensual antes de decidir
- `makeAdaptiveDecision()` normaliza primero ✅
- Semana UTC (Lunes) ✅
- Mes UTC (día 1) ✅

### Cooldown fail-closed
- Timestamp inválido → `ABORT` ✅
- `cooldownEndsAt` inválido → `ABORT` ✅
- Policy inválida → `ABORT` ✅
- Out-of-order → `ABORT` ✅
- No se convierte en `cooldownActive = false` sin error ✅

### Estados por nivel
- Durante cooldown global: `selected = null`, crossed pendientes = `PENDING_COOLDOWN` ✅
- Durante límite temporal: siguiente nivel = `PENDING_PERIOD_LIMIT` ✅
- Tramo seleccionado: `SELECTED` ✅

### Cierre confirmado en decisión
- `crossedLevels` y `selected` derivados de `asOfConfirmedClosePrice` ✅
- No de precio live o vela abierta ✅

### Búsqueda de ventanas consecutivas
- 1 jul, 3 jul, 4 jul, 5 jul con 3 requeridos:
  - Primera secuencia con hueco (1 jul solo) se rechaza ✅
  - 3, 4, 5 jul se detectan como ventana válida ✅
  - `confirmedAt` = 5 julio ✅
  - No se utilizan cierres posteriores ✅

### Transición HWM con previous/current
- Nuevo máximo: `previous.status = SUPERSEDED`, `previous.supersededBy = current.hwmId`, `current.status = CANDIDATE`, `transition = SUPERSEDED` ✅
- Rechazado: `current = previous`, `transition = REJECTED` ✅
- Sin cambios: `current = previous`, `transition = UNCHANGED` ✅

### Paridad de APIs HWM
- `isReversalConfirmed()` y `evaluateConfirmation()` producen mismo resultado ✅
- Caso confirmado: ambas true ✅
- Caso rechazado: ambas false ✅

---

## Estado de componentes no tocados

- **amaService:** DEVELOPMENT_SCAFFOLD_ONLY — sin cambios, sigue como stub
- **ama.routes.ts:** sin cambios, sigue con doble gate REAL
- **PostgreSQL:** BLOCKED_NO_SAFE_ENVIRONMENT — no validado, no disponible
- **Docker local:** NOT_AVAILABLE
- **Migración 080:** NOT_REGISTERED, NOT_AUTOAPPLY — no registrada en AutoMigrationRunner
- **Research Lab completo:** NO IMPLEMENTADO — solo AmaReplaySmokeSimulator scaffold
- **SHADOW:** BLOQUEADO
- **REAL_LIMITED:** BLOQUEADO
- **REAL_FULL:** BLOQUEADO
- **merge:** NO AUTORIZADO
- **deploy:** NO AUTORIZADO

---

## Riesgos pendientes

1. **PostgreSQL desechable no disponible** — no se puede validar migración 080 ni esquema real
2. **Integración real de persistencia** — amaService es stub en memoria
3. **Fuentes de datos reales** — Kraken, Coin Metrics, Bitcoin Core, FRED, SEC no integrados
4. **Research Lab** — solo smoke simulator, no implementado
5. **SHADOW** — bloqueado por readiness gate
6. **REAL_LIMITED / REAL_FULL** — bloqueados por autorización
7. **Suite completa** — 31 fallos preexistentes en grid/telegram/idca (no AMA)
8. **Deploy staging** — pendiente de autorización

---

## Veredicto

**APTO_PARA_COMMIT_R5_EN_RAMA_DE_REVISION**

No declarar:
- apto para merge
- apto para deploy
- PostgreSQL validado
- migración 080 lista para aplicarse
- SHADOW operativo
- REAL preparado

---

## Actualización posterior — R6

**Fecha:** 2026-07-31
**Estado R5:** COMMITTED_AND_PUSHED
**HEAD R5:** `f8edc55b43db517683dc3e2c7c9e1305be27dc33`

R5 ha sido committeado y pusheado a `origin/review/ama-seed-v2-2-20260729`. Las correcciones R6 se aplican sobre la base R5. Ver `AUDITORIA_CORRECCION_PREMERGE_AMA_V2_2_R6_2026-07-31.md` para el detalle de R6.
