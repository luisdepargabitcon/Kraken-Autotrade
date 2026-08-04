# PLAN_EJECUCION_GRID_REV_C12

- **DONE: FALSE**
- **HARD_BLOCKER: FALSE**
- **TASK_STATUS: REV-C12F corregida tras verificación independiente; pendiente commit y nueva verificación**
- **NEXT_ACTION: verificar commits y autorizar fast-forward**
- **DEPLOY_AUTHORIZED: FALSE**
- **MIGRATION_REQUIRED: FALSE**

REV-C12E_COMPLETADA = TRUE
GRID_NEW_ENTRIES_AVAILABLE = FALSE
GRID_NEW_ENTRIES_BLOCKER = REVOLUT_X_CONSTRAINTS_UNAVAILABLE
ALLOW_CYCLE_EXITS = TRUE

## Correcciones tras segunda verificación independiente (2026-08-04)

Commits anteriores: 33094e5 (técnico), 7ff42bd (documental).

Defectos corregidos:
- Rebuild manual reutiliza allocation y projection context pre-resuelto del orquestador.
- buildRangeProposal fail-closed: allocation y projection context obligatorios.
- Gate canCreateRange fail-closed: exige allocation + split + projection + TTL + 0 blockers.
- Frescura invertida corregida en buildGridExecutionMarketSnapshot.
- UX fuentes correctas: executionGate.executionMarketSnapshot.executionVenue, pairConstraints.source.
- Encoding UTF-8 reparado: sin BOM, sin mojibake.

Matriz nueva real: 37 archivos, 934 tests, 0 failures.
npm run check: exit 0. npm run build: exit 0. git diff --check: exit 0.

## Validación global final (2026-08-04)

- Commit técnico: 39db52b6299e9a9f15a361d5324bb4e2b713c6be
- Commit documental: d8d56d5c6c6f274a788ae4f78000e52a0e416840
- Matriz Grid: 37 archivos, 934 tests, 0 fallos.
- Suite completa: 856 archivos, 3389 tests, 3330 pasados, 30 fallos históricos, 29 skipped.
- Fallos históricos exactos (30, 6 archivos):
  - telegram/templates.test.ts: 9
  - gridCompactRange.test.ts: 9
  - gridAdaptiveSmartRange.test.ts: 4
  - gridShadowPolicy.test.ts: 4
  - idcaMarketContextHelpers.test.ts: 3
  - gridSpacingCalculator.test.ts: 1
- Cero fallos nuevos.
- CHECK_EXIT=0, BUILD_EXIT=0, DIFF_EXIT=0.
- MERGE=NO, DEPLOY=NO, VPS=NO, DB=NO, órdenes reales=0.

## Integración en main (2026-08-04)

- MAIN_PREVIOUS_SHA = 44cd46ff3a6e195556987968a87c8e795d66cd02
- DEPLOYED_CODE_SHA = 8d5617fd0022be378d13b6c4ba9a523025057314
- MERGE_METHOD = FAST_FORWARD
- COMMITS_INTEGRATED = 24
- MERGE_COMMIT_CREATED = FALSE
- origin/main = 8d5617fd0022be378d13b6c4ba9a523025057314
- origin/review/grid-rev-c12a-20260731 = 8d5617fd0022be378d13b6c4ba9a523025057314

## Deploy staging (2026-08-04)

- VPS = root@5.250.184.18
- ENVIRONMENT = STAGING
- DIRECTORY = /opt/krakenbot-staging
- COMPOSE = docker-compose.staging.yml
- PRE_DEPLOY_SHA = 24518a1af91ddc64b338fffc3b250bf1414a72ec
- DEPLOY_SOURCE_SHA = 8d5617fd0022be378d13b6c4ba9a523025057314
- PRE_APP_IMAGE_ID = sha256:631ca9ab6c4d4bbda2730fdd6b7431bd54372073cb7b9f485d6a61110ce3fe23
- POST_APP_IMAGE_ID = sha256:197f41e3b8d1e44b46b16c62bc67acfa8f886637560624d08546ad603b28d71e
- APP_STATE = running
- APP_HEALTH = none
- ROLLBACK_IMAGE_ONLY = FALSE

### DB intacta

- DB_ID_BEFORE = a2f9a3f275c34e37b3800bbc00a0ae694387473d523503fbefb34cbb3483be1c
- DB_ID_AFTER = a2f9a3f275c34e37b3800bbc00a0ae694387473d523503fbefb34cbb3483be1c
- DB_STARTED_BEFORE = 2026-05-03T21:10:46.164388528Z
- DB_STARTED_AFTER = 2026-05-03T21:10:46.164388528Z
- DB_RESTARTED = FALSE
- SQL_EXECUTED = FALSE
- MIGRATIONS_EXECUTED = FALSE
- DB_CHANGED = FALSE

### Validación HTTP read-only

- ROOT_HTTP=200
- CONFIG_HTTP=200
- STATUS_HTTP=200
- LEVELS_HTTP=200
- CYCLES_HTTP=200
- EVENTS_HTTP=200
- UNLOCK_STATUS_HTTP=200
- MONITOR_AUDIT_HTTP=200
- MODE_BEFORE=SHADOW
- MODE_AFTER=SHADOW
- PAIR=BTC/USD
- MARKET_DATA_SOURCE=KRAKEN_MARKET_DATA
- MARKET_DATA_VENUE=KRAKEN
- EXECUTION_VENUE=REVOLUT_X
- EXECUTION_POLICY=MAKER_ONLY
- POST_ONLY_EFFECTIVE=TRUE
- EFFECTIVE_TAKER_FALLBACK_ENABLED=FALSE
- EFFECTIVE_TAKER_FALLBACK_ALLOWED=FALSE
- TAKER_FALLBACK_USED=FALSE
- REAL_OPEN_ORDERS_COUNT=0
- DAILY_ORDER_COUNT=0
- REAL_ORDERS_CREATED=0
- FATAL_ERRORS=0
- UNEXPECTED_RESTARTS=0

### Riesgo residual 1 — constraints

REVOLUT_X_CONSTRAINTS_UNAVAILABLE continúa apareciendo en staging.

Impacto:
- BUY bloqueado;
- nuevos rangos bloqueados;
- rebuild bloqueado;
- nuevas órdenes maker bloqueadas;
- salidas de ciclos abiertos preservadas;
- allowCycleExits=true.

Clasificación: FOLLOW_UP_REQUIRED, NO_REGRESSION_REV_C12E, FAIL_CLOSED_EXPECTED.
Próxima fase: REV-C12F — diagnóstico read-only de resolución de constraints Revolut X.

### Riesgo residual 2 — flags legacy

La DB mantiene storedTakerFallbackEnabled=true y storedTakerFallbackAllowed=true.
Pero el runtime impone effectiveTakerFallbackEnabled=false, effectiveTakerFallbackAllowed=false, takerFallbackUsed=false.
No realizar modificación DB en REV-C12E.
Clasificación: LEGACY_CONFIGURATION_DEBT, NO_EFFECTIVE_TAKER_PERMISSION, NO_IMMEDIATE_SAFETY_BLOCKER.

### Backup local

- BACKUP_PRESERVED = TRUE
- BACKUP_PATH = C:\Users\JSLUI\Qsync\BOT_NAS\BOT_AUTOTRADE_LOCAL_BACKUPS\REV-C12E_PRE_FF_20260804_201206
- BACKUP_SHA256 = 5CC20EB599C03DB7DA91ED8635A406851BF3B7A7BCF60A7FB4E2994B741EC80B
- TRACKED_SHA256 = D223841AE0462FE43BAE067EA769D5ACD9CFFCDC8A79D532C1826711229434C1

## REV-C12F — Corrección del schema de configuration/pairs (2026-08-04)

REV-C12F_CAUSE = G_PUBLIC_SCHEMA_MISMATCH
OFFICIAL_RESPONSE_SHAPE = ROOT_PAIR_MAP
EXAMPLE_KEY = BTC/USD
PUBLIC_HTTP = 200
PUBLIC_JSON_VALID = TRUE
PARSER_BEFORE = ARRAY_OR_PAIRS_WRAPPER_ONLY
PARSER_AFTER = ARRAY_OR_PAIRS_WRAPPER_OR_ROOT_PAIR_MAP
DB_REQUIRED = FALSE
MIGRATION_REQUIRED = FALSE
DEPLOY_REQUIRED = TRUE_AFTER_REVIEW_AND_MERGE
GRID_MODE = SHADOW
REAL_ORDERS = 0

Causa raíz: el endpoint oficial `https://revx.revolut.com/api/1.0/public/configuration/pairs?region=EEA`
devuelve un objeto raíz cuyas claves son nombres de pares (`{"BTC/USD": {...}, ...}`), no un array
ni `{pairs: [...]}`. El parser anterior solo aceptaba array raíz o wrapper `pairs`, por lo que
rechazaba la respuesta oficial antes de encontrar BTC/USD.

Corrección: helper `extractRevolutXPairConfigurationEntries` que acepta los tres formatos
(array raíz, wrapper `pairs`, mapa raíz oficial). Usado en `getPairConfigurations` y
`getPublicPairConfigurations`. Logs sanitizados añadidos en `resolveGridPairConstraints`.

Corrección post-verificación: `filterAndRequirePairEntries` fail-closed (array/wrapper no vacío
sin entries válidas → throw). `signedGetJson` no incluye body en error (usa statusText).
`sanitizeRevolutXConstraintError` limita reason a 240 chars sin saltos de línea.

ARRAY_INVALID_NONEMPTY_REJECTED = TRUE
WRAPPER_INVALID_NONEMPTY_REJECTED = TRUE
SIGNED_GET_RESPONSE_BODY_LOGGED = FALSE
CONSTRAINT_REASON_MAX_LENGTH = 240
SENSITIVE_SENTINEL_LOGGED = FALSE

Tests: 33 tests nuevos (19 helper + 14 integración), 105 tests Grid relacionados, 15 tests existentes.
CHECK_EXIT=0, BUILD_EXIT=0, DIFF_EXIT=0.

## Alcance REV-C12A

Corrección del flujo `diagnóstico → recomendación → aplicación → persistencia → recarga` para el Grid Isolated.

## Cambios aplicados (initial commit ba25ec7 + 15e2714)

1. Eliminación de `buyLevels`/`sellLevels` como campos aplicables:
   - `RECOMMENDATION_APPLY_ALLOWLIST` sin `buyLevels`/`sellLevels`.
   - `buildConfigFingerprint` no depende de esos campos.
   - `validateProposedValues` rechaza `buyLevels`/`sellLevels` como `FIELD_NOT_ALLOWED`.
   - `currentConfig` no publica esos campos.

2. Allocator como única fuente del número de niveles:
   - `resolveRequestedLevels` lee `requestedBuyLevels`/`requestedSellLevels` desde `professionalGenerator`, `resolvedRange` o `status`.
   - Sin datos canónicos, la recomendación queda bloqueada por datos insuficientes.

3. Alternativa A informativa:
   - `proposedConfig={}`, `changedFields=[]`, `safeToApply=false`.
   - Explica cuántos niveles caben, cuántos exige el motor y que el allocator es la fuente.

4. `recommendedAlternativeId` nullable:
   - Tipo `A | B | C | null`.
   - `null` cuando no hay alternativa segura.

5. Validación con proyección canónica:
   - Alternativas B y C solo `safeToApply=true` si la proyección resulta en al menos `MIN_LEVELS_FOR_VIABLE_GRID=4` niveles.
   - No se propone ampliar `gridRangeMaxPct` por encima de límites.

6. Persistencia fail-closed:
   - `saveConfig` relanza el error capturado.
   - `applyRecommendationPatchAtomically` restaura runtime y retorna `success=false`.
   - El endpoint no marca `applied` ni emite `GRID_RECOMMENDATION_APPLIED` tras fallo.

7. UX post-apply:
   - Mensaje: "Configuración guardada correctamente. No se ha creado ni modificado ningún rango..."
   - Aplicar y analizar continúan siendo acciones distintas.

## Cambios aplicados (cascada post-verificación REV-C12A)

8. `recommendedAlternativeId=null` en estados bloqueados:
   - `checkDataSufficiency` blocked return ahora usa `recommendedAlternativeId: null`.
   - Tests verifican que estados bloqueados no recomiendan A.

9. `resolveRequestedLevels` fail-closed estricto:
   - `validateStrictLevelValue` rechaza null, NaN, Infinity, cero, negativos, decimales y valores excesivos.
   - Nunca convierte un valor inválido a 1.
   - Retorna null si cualquier fuente es inválida, incompleta o inconsistente.

10. Proyección canónica B/C con `generateProfessionalGridLevels`:
    - `resolveProjectionInput` extrae todos los campos requeridos de `RecommendationServiceInput`.
    - `projectCanonicalLevels` ejecuta `generateProfessionalGridLevels` con overrides.
    - B y C solo son `safeToApply=true` si la proyección canónica retorna viable.
    - `computeSpacingAndLevels` se usa solo para diagnóstico preliminar, no para `safeToApply`.
    - Sin microestructura Revolut X (spread/tick), B y C quedan bloqueados.

11. Gate Revolut X visible en view model y `GridMarketPanel`:
    - `GridMarketPanel` muestra estado del gate: "microestructura no verificada", "validación canónica superada" o "pendiente".
    - `configurationRecommendation` ya está en el view model (`market.current.configurationRecommendation`).

12. UX post-apply en `GridRecommendationDialog`:
    - Mensaje de éxito incluye confirmación de validación canónica con Revolut X.

13. `gridUxRender.test.tsx` corregido:
    - Fixture actualizado a V3 (`entryLevels`, `referenceRungs`, `legacyTargetLevels`).
    - Aserciones actualizadas a etiquetas V3.
    - 10/10 tests pasan (antes 9/10 con fallo preexistente).

14. `gridRecommendationAlternatives.test.ts` actualizado:
    - Tests alineados con REV-C12A (A informativa, sin buyLevels/sellLevels, B/C bloqueados sin microestructura).

15. Codificación MD auditoría reparada:
    - `AUDITORIA_GRID_REV_C12_RECOMENDACIONES_SIN_EFECTO_2026-07-30.md`: UTF-8 sin BOM, LF.

## Tests validados

- `npx vitest run server/services/__tests__/gridRecommendationService.test.ts` ✅ (49/49)
- `npx vitest run server/services/__tests__/gridRecommendationValidation.test.ts` ✅
- `npx vitest run server/services/__tests__/applyRecommendationPatchAtomically.test.ts` ✅ (7/7)
- `npx vitest run server/routes/__tests__/gridRecommendationApply.test.ts` ✅
- `npx vitest run client/src/components/grid/GridRecommendationDialog.test.tsx` ✅
- `npx vitest run client/src/components/grid/GridMarketPanel.test.tsx` ✅ (8/8)
- `npx vitest run client/src/components/grid/__tests__/gridUxRender.test.tsx` ✅ (10/10)
- `npx vitest run server/services/__tests__/gridRecommendationAlternatives.test.ts` ✅ (6/6)
- Matriz Grid (9 archivos): 260/260 ✅
- `npx tsc --noEmit` ✅
- `npm run build` ✅

## Invariantes mantenidas

- SHADOW, MAKER_ONLY, cero órdenes reales.
- strict, `minLevelsForViableGrid=4`.
- Allocator como fuente de niveles.
- 1+1 no autorizado.
- Sin modificaciones de DB, schema, migraciones, deploy, VPS o credenciales.
- origin/main intacto en `44cd46ff3a6e195556987968a87c8e795d66cd02`.

## Pendiente REV-C12B

- **REV-C12C: Causa raíz de `REVOLUT_X_UNAVAILABLE` en staging.**
  - REV-C12C ES FUNCIONALMENTE BLOQUEANTE PARA CREAR NUEVOS RANGOS Y NIVELES.
  - Puede no bloquear el merge técnico, pero sí bloquea la funcionalidad observada por el usuario.

## Cambios aplicados (cascada REV-C12B — profesional input + microstructure + gate real)

16. Helper profesional compartido `gridProfessionalProjectionContext.ts`:
    - Single source of truth para `generateProfessionalGridLevels` input.
    - `resolveGridProfessionalProjectionContext` valida datos reales verificados.
    - `buildProfessionalGeneratorInput` construye el input con overrides opcionales.
    - Sin estimaciones inventadas, sin config hardcodeada, sin fallback a Kraken.

17. Microestructura Revolut X estricta (eliminar fallbacks):
    - `spreadPct` y `priceTickPct` solo de `executionMarketSnapshot` cuando `verified=true`, `fresh=true`, `venue=REVOLUT_X`, `pair` coincide.
    - `pairConstraints` deben estar `verified=true` y `expiresAt` no expirado.
    - Nunca usa `marketContext.spreadPct`/`marketContext.priceTickPct` como fallback.
    - Sin microestructura verificada, B y C quedan bloqueados con `microstructureVerified=false`.

18. Configuración real, no hardcodeada:
    - Todos los campos de config se leen del objeto `config` real.
    - Defaults solo cuando el campo es null/undefined, no como override de valores reales.
    - `configuredBuyLevels`/`configuredSellLevels` deben ser enteros (rechaza strings numéricos).

19. Alternativa B canónica con allocation real:
    - `resolveProjectionContext` usa `allocation.capitalPerLevelUsd` real del allocator.
    - Sin allocation, B queda bloqueado (no usa estimación inventada).
    - `expectedBefore` procede de proyección canónica actual, no de `computeSpacingAndLevels`.

20. Alternativa C iterativa por candidato:
    - Cada anchura candidata se valida con `generateProfessionalGridLevels`.
    - Se selecciona la primera anchura canónicamente viable (cambio mínimo seguro).
    - Sin microestructura verificada, C queda bloqueado.

21. Gate Revolut X real tipado en view model:
    - `ExecutionGateState` en `GridIsolatedEngine` (in-memory, no persistido).
    - `getExecutionGate()` expone el gate al route handler.
    - `ExecutionGateType` en `GridMarketViewModel`, siempre presente (nunca null).
    - `GridMarketPanel` muestra "VERIFICADO", "BLOQUEADO" o "SIN EVALUACIÓN RECIENTE".
    - El gate NO se deriva de `safeToApply` — es estado independiente del motor.

22. Mensaje post-apply exacto:
    - "Validación canónica superada: el generador profesional verificó la viabilidad con la microestructura de Revolut X. La configuración se guardó en DB y se aplicará en el próximo tick del motor."

23. Tests reales `GridIsolatedEngine.saveConfig` + call sites:
    - `gridIsolatedEngine.test.ts`: tests de `getExecutionGate` (SIN_EVALUACION_RECIENTE) y `saveConfig` real.
    - `gridProfessionalProjectionContext.test.ts`: 18 tests del helper compartido.

24. Mojibake MD reparado:
    - `AUDITORIA_GRID_REV_C12_RECOMENDACIONES_SIN_EFECTO_2026-07-30.md`: UTF-8 decode → Windows-1252 encode → bytes correctos.
    - Em-dashes y caracteres españoles restaurados.

## Cambios aplicados (cascada REV-C12B — runtime integration + gate edad + campos fantasma + validadores estrictos)

25. `GridRecommendationProjectionState` en `GridIsolatedEngine`:
    - Interface tipada con `evaluatedAt`, `validUntil`, `pair`, `bandSnapshot`, `executionMarketSnapshot`, `pairConstraints`, `allocation`.
    - `lastRecommendationProjectionState` in-memory, actualizado solo durante el tick.
    - `getRecommendationProjectionState()` devuelve copia si fresca, null si expirada o sin evaluación.
    - Lecturas no renuevan `evaluatedAt` ni `validUntil`.

26. Allocation resuelta una vez por tick:
    - `buildRangeProposal` acepta `preResolvedAllocation` opcional — no llama al allocator cuando se proporciona.
    - `proposeRangeVersion` y `rebuildRangeAndLevels` reciben y pasan el allocation pre-resuelto.
    - Misma instancia de allocation usada para recomendación, proyección y creación de rango.

27. Ruta corregida — datos reales al view model:
    - `gridIsolated.routes.ts` pasa `projectionState.executionMarketSnapshot`, `pairConstraints`, `allocation` reales a `buildGridAuditViewModel`.
    - Export JSON endpoint también pasa los datos reales.
    - Sin nulls — el view model recibe el contexto runtime exacto del último tick.

28. Gate invalidado por edad:
    - `ExecutionGateState` incluye `status` (`VERIFIED` | `BLOCKED` | `NO_RECENT_EVALUATION`), `ageMs`, `maxAgeMs`, `validUntil`.
    - `resolveExecutionGateState` recalcula en cada lectura — no devuelve VERIFIED stale.
    - `RawExecutionGateData` almacena datos crudos; `getExecutionGate()` deriva el estado público.
    - `GridMarketPanel` usa `status` para mostrar VERIFICADO/BLOQUEADO/SIN EVALUACIÓN RECIENTE.
    - Muestra edad (`ageMs/maxAgeMs`) y validez (`validUntil`) cuando VERIFIED.

29. `available` separado de `verified`/`fresh`:
    - `snapshotAvailable` requiere par correcto, venue REVOLUT_X, source presente, bid/ask o reasonCode.
    - `constraintsAvailable` requiere par correcto, venue REVOLUT_X, source presente.
    - `available` no es solo pair match — es presencia + estructura mínima.

30. Campos fantasma eliminados del view model:
    - `buildGridMarketViewModel.ts`: `config.buyLevels`/`config.sellLevels` eliminados.
    - `buildCurrentConfigurationProjection` usa `allocation.levelsCount` como fuente de niveles.
    - `requestedLevelsFrom` no usa `config.buyLevels`/`config.sellLevels` — solo fuentes canónicas.
    - `buildEntryRange` usa `professionalGenerator`/`adaptiveDecision`/`adaptiveRangeMinViableLevels`.
    - `buildActiveRangeSnapshot` no usa `configSnapshot.buyLevels`/`configSnapshot.sellLevels`.

31. Validadores estrictos sin `Number()`:
    - `validateStrictLevelValue` rechaza strings (`"4"`), booleanos, NaN, Infinity.
    - Solo acepta `typeof value === "number"` + `Number.isFinite` + `Number.isInteger`.
    - Tests: string `"4"`, NaN, Infinity, boolean true — todos blocked.

32. Market suitability y régimen fail-closed:
    - `resolveGridProfessionalProjectionContext` rechaza `marketSuitable !== true`.
    - Rechaza `regimeLabel` vacío o no-string.
    - No hay default `suitableForGrid ?? true` ni `regime ?? "ranging"`.

33. Consistencia de allocation:
    - `finalGridBudgetUsd` debe ser > 0.
    - `capitalPerLevelUsd * levelsCount` no debe exceder `finalGridBudgetUsd` + 10% tolerancia.
    - Tests: budget=0 blocked, budget=500 con 1000 requerido blocked, budget=1050 con 1000 aceptado.

34. Tests nuevos:
    - `gridIsolatedEngine.test.ts`: `getRecommendationProjectionState` null antes de tick, `saveConfig` DB_WRITE_FAILED, gate `status` field.
    - `gridProfessionalProjectionContext.test.ts`: 7 tests nuevos (marketSuitable, regimeLabel, allocation consistency).
    - `gridRecommendationService.test.ts`: 4 tests nuevos (strict validation: string, NaN, Infinity, boolean).
    - `GridMarketPanel.test.tsx`: fixtures actualizadas con `status`, `ageMs`, `maxAgeMs`, `validUntil`.

## Cambios aplicados (cascada REV-C12B — cierre estricto: copia defensiva, TTL compartido, ProjectionContextResult, régimen canónico, config fail-closed)

35. Copia defensiva de ProjectionState:
    - `getRecommendationProjectionState()` devuelve `structuredClone` (o clone manual fallback) del estado interno.
    - Modificar el resultado no afecta el estado interno del engine.
    - Preserva Date objects (fetchedAt, acquiredAt, timestamp, expiresAt).

36. Limpieza al comenzar tick:
    - `this.lastRecommendationProjectionState = null` al inicio de `tick()`, antes de resolver constraints/ticker/snapshot/allocation.
    - Solo se reasigna cuando el tick ACTUAL obtiene banda válida + suitableForGrid + régimen operable + snapshot verificado + constraints verificadas + allocation válida.
    - Si cualquier bloqueo ocurre, el estado anterior NO se conserva.

37. TTL canónico compartido (`gridExecutionGateTtl.ts`):
    - Helper puro `computeGateTtl(snapshot, constraints, now)` usado por `getExecutionGate()` y `getRecommendationProjectionState()`.
    - `snapshotValidUntil = fetchedAt + maxAgeMs`; `constraintsValidUntil = expiresAt`; `validUntil = min(snapshot, constraints)`.
    - Devuelve `{ fresh, ageMs, maxAgeMs, snapshotValidUntil, constraintsValidUntil, validUntil, staleReason }`.
    - Las lecturas nunca renuevan `evaluatedAt`, `fetchedAt`, `acquiredAt`, `validUntil`.

38. ProjectionContextResult tipado:
    - `resolveGridProfessionalProjectionContext` devuelve `{ ok: true, context } | { ok: false, reasonCode, explanation }`.
    - 14 reasonCodes: BAND_DATA_INVALID, CONFIG_INCOMPLETE, REQUESTED_LEVELS_INVALID, ALLOCATION_MISSING, ALLOCATION_LEVEL_COUNT_INVALID, ALLOCATION_LEVEL_COUNT_MISMATCH, ALLOCATION_CAPITAL_PER_LEVEL_INVALID, ALLOCATION_BUDGET_INVALID, MARKET_SUITABILITY_UNKNOWN, MARKET_UNSUITABLE, MARKET_REGIME_UNKNOWN, MARKET_REGIME_UNSUITABLE, MICROSTRUCTURE_UNAVAILABLE, PAIR_CONSTRAINTS_UNAVAILABLE.
    - Engine y recommendation service actualizados para usar el resultado tipado.

39. Consistencia estricta del allocator:
    - `configuredBuyLevels + configuredSellLevels === allocation.levelsCount` (ALLOCATION_LEVEL_COUNT_MISMATCH).
    - `requiredCapital = capitalPerLevelUsd * levelsCount` no puede superar `finalGridBudgetUsd` + epsilon 1 cent (ALLOCATION_BUDGET_INVALID).
    - No `Math.floor(levelsCount / 2)` que pierde un nivel — si es impar, es mismatch.
    - Auditoría de `gridCapitalAllocator.ts`: `finalGridBudgetUsd = capitalPerLevelUsd * effectiveLevels` (exacto, sin tolerancia arbitraria).

40. Régimen reconocido y operable:
    - Lista canónica: OPERABLES = {low_volatility, normal_lateral, high_volatility}; NO OPERABLES = {unsuitable_trend, pump_dump, unknown}.
    - Aliases normalizados explícitamente: ranging→normal_lateral, RANGE→normal_lateral, sideways→normal_lateral, etc.
    - Régimen ausente/desconocido → MARKET_REGIME_UNKNOWN; conocido pero no operable → MARKET_REGIME_UNSUITABLE.
    - No `undefined`/`null`/`""`/`"RANGE"` inventado → régimen apto sin normalización canónica.

41. Configuración fail-closed:
    - 18 campos de config obligatorios: netProfitTargetPct, gridStepAtrMultiplier, gridStepMinPct, gridStepMaxPct, enforceCompactRange, gridRangeMaxPct, maxDistanceFromCenterPct, maxSellDistanceFromNearestBuyPct, gridRangeControlMode, adaptiveRangeEnabled, adaptiveRangeProfile, adaptiveRangeMinPct, adaptiveRangeMaxPct, adaptiveRangeLowVolMaxPct, adaptiveRangeNormalMaxPct, adaptiveRangeHighVolMaxPct, adaptiveRangeTargetFullLevels, adaptiveRangeMinViableLevels.
    - Sin defaults silenciosos — si falta uno o es inválido → CONFIG_INCOMPLETE.
    - `enforceCompactRange=false` válido (boolean false no se sustituye).
    - `gridRangeControlMode` y `adaptiveRangeProfile` validados contra sets canónicos.

42. Mensaje post-apply exacto:
    - "Configuración guardada correctamente. No se ha creado ni modificado ningún rango. Pulsa «Analizar mercado ahora» cuando quieras ejecutar un nuevo análisis SHADOW."
    - Eliminada la promesa de creación automática y DB save.

43. saveConfig mismo objeto Error:
    - Test usa `await expect(saveConfig()).rejects.toBe(expectedError)` — exactamente el mismo objeto.
    - `botLogger.error` llamado una vez con "Failed to save config".
    - Mock restaurado en bloque `finally` — no contaminación.
    - Call sites auditados: `gridIsolated.routes.ts:874` (try/catch), `gridRecommendationService.ts:1280` (try/catch + rollback), engine internal (try/catch + re-throw).

44. Export JSON una única lectura:
    - `exportProjectionState = gridIsolatedEngine.getRecommendationProjectionState()` leído una vez.
    - Reutilizado para `executionMarketSnapshot`, `pairConstraints`, `allocation`.
    - No tres lecturas que pueden caducar entre sí.

## MATRIZ FINAL REV-C12B

Comando exacto:
```
npx vitest run server/services/gridIsolated server/services/__tests__/gridRecommendationService.test.ts server/services/__tests__/gridRecommendationValidation.test.ts server/services/__tests__/gridRecommendationAlternatives.test.ts server/services/__tests__/applyRecommendationPatchAtomically.test.ts server/services/__tests__/gridIsolatedEngine.test.ts server/services/__tests__/gridProfessionalProjectionContext.test.ts server/services/__tests__/gridExecutionGateTtl.test.ts server/routes/__tests__/gridRecommendationApply.test.ts server/routes/__tests__/gridIsolatedRoutes.test.ts client/src/components/grid --reporter=verbose
```

- Archivos ejecutados: 32
- Tests ejecutados: 819 (805 REV-C12B + 14 nuevos REV-C12C)
- Tests pasados: 819
- Tests fallidos: 0
- Duración: ~9s

## Historial de iteraciones

### REV-C12A
- Campos fantasma (buyLevels/sellLevels), recomendaciones y persistencia.

### REV-C12B
- Helper profesional, ProjectionState, allocation, gate, TTL compartido, view model, régimen canónico, config fail-closed, copia defensiva, limpieza tick, mensaje post-apply, saveConfig exacto, export una lectura.
- Corrección final: modos canónicos (adaptive_smart, fixed_compact, legacy_hybrid), eliminación de fallback "ranging", ProjectionState solo con ProjectionContextResult ok, validUntil fail-closed (sin fallback a evaluatedAt), tests TTL directos (14), copia defensiva probada, transición tick válido → tick bloqueado, 0 órdenes.
- Microcorrección final: helper simétrico `splitSymmetricLevels` (BUY=SELL, par obligatorio), eliminación de `Math.floor` en engine y view model, 9 tests obligatorios de paridad (10=5+5 ok, 9=4+5 INVALID, 9=5+4 INVALID, 9=5+5 INVALID, 10=4+6 MISMATCH, 10=4+4 MISMATCH, 10=5+5 no pérdida, "10" INVALID, 10.5 INVALID), test REAL tick N válido con mocks del flujo completo (getGridBandSnapshot, resolveGridPairConstraints, getTicker, allocate), tick N+1 Revolut X bloqueado limpia estado, variantes (mercado no apto, allocation falla, régimen desconocido, allocation impar), cero órdenes reales en SHADOW.

### REV-C12C (implementada 2026-08-03)
- Causa raíz de REVOLUT_X_UNAVAILABLE en staging confirmada: single try/catch en tick() fusionaba resolveGridPairConstraints con getTicker; cualquier excepción de getTicker descartaba constraints ya resueltas y silenciaba el error real.
- Corrección mínima: separación en dos try/catch independientes. Constraints resueltas se preservan aunque ticker falle.
- Observabilidad: botLogger.warn("GRID_REVOLUTX_TICKER_FAILED") con stage=TICKER_FETCH, constraintsVerified, constraintsSource, constraintsReasonCode, canCreateRange, allowCycleExits, error message real.
- Nuevos EventType en botLogger: GRID_REVOLUTX_TICKER_FAILED, GRID_REVOLUTX_PROJECTION_BLOCKED.
- Nuevo tipo RevolutXGridFailureStage en gridIsolatedTypes.ts (INITIALIZATION, AUTHENTICATION, PAIR_NORMALIZATION, PAIR_CONSTRAINTS, TICKER_FETCH, TICKER_VALIDATION, FRESHNESS, NETWORK, UNKNOWN).
- 14 tests dirigidos REV-C12C en gridIsolatedEngine.test.ts: T1–T7 getTicker throws variadas (not init, 401, 403, 404, 429, timeout, unknown), T8 constraints unverified, T9 constraints verificadas preservadas cuando ticker falla, T10 resolveGridPairConstraints throws, T11–T12 bid/ask inválido, T13 allowCycleExits siempre true, T14 cero órdenes reales.
- Tests Grid: 693/693 pasan (32 archivos baseline, sin nuevos fallos). tsc ✅. build ✅. diff --check ✅.
- Staging SHA: 44cd46f (origin/main = pre-REV-C12A); staging NO tiene REV-C12C aún (STAGING_CODE_OUTDATED).
- REV-C12C ES FUNCIONALMENTE BLOQUEANTE PARA CREAR NUEVOS RANGOS Y NIVELES hasta deploy.

## Rama

`review/grid-rev-c12a-20260731` en `origin`.

## Main intacto

`origin/main` permanece en `44cd46ff3a6e195556987968a87c8e795d66cd02`.
