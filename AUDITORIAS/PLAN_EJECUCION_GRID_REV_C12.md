# PLAN_EJECUCION_GRID_REV_C12

- **DONE: FALSE**
- **HARD_BLOCKER: FALSE**
- **TASK_STATUS: REV-C12B corregida y subida a rama de revisión; pendiente verificación independiente final**
- **NEXT_ACTION: revisión independiente de los commits finales antes de merge**
- **DEPLOY_AUTHORIZED: FALSE**
- **MIGRATION_REQUIRED: FALSE**

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
- Tests ejecutados: 795
- Tests pasados: 795
- Tests fallidos: 0
- Duración: ~17s

## Historial de iteraciones

### REV-C12A
- Campos fantasma (buyLevels/sellLevels), recomendaciones y persistencia.

### REV-C12B
- Helper profesional, ProjectionState, allocation, gate, TTL compartido, view model, régimen canónico, config fail-closed, copia defensiva, limpieza tick, mensaje post-apply, saveConfig exacto, export una lectura.
- Corrección final: modos canónicos (adaptive_smart, fixed_compact, legacy_hybrid), eliminación de fallback "ranging", ProjectionState solo con ProjectionContextResult ok, validUntil fail-closed (sin fallback a evaluatedAt), tests TTL directos (14), copia defensiva probada, transición tick válido → tick bloqueado, 0 órdenes.

### REV-C12C (pendiente)
- Causa raíz de REVOLUT_X_UNAVAILABLE en staging.
- REV-C12C ES FUNCIONALMENTE BLOQUEANTE PARA CREAR NUEVOS RANGOS Y NIVELES.

## Rama

`review/grid-rev-c12a-20260731` en `origin`.

## Main intacto

`origin/main` permanece en `44cd46ff3a6e195556987968a87c8e795d66cd02`.
