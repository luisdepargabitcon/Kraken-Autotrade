# PLAN_EJECUCION_GRID_REV_C12

- **DONE: FALSE**
- **HARD_BLOCKER: FALSE**
- **TASK_STATUS: REV-C12A implementada en rama de revisión; pendiente verificación independiente**
- **NEXT_ACTION: revisión independiente del commit REV-C12A antes de merge a main**
- **DEPLOY_AUTHORIZED: FALSE**
- **MIGRATION_REQUIRED: FALSE**

## Alcance REV-C12A

Corrección del flujo `diagnóstico → recomendación → aplicación → persistencia → recarga` para el Grid Isolated.

## Cambios aplicados

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

## Tests validados

- `npx vitest run server/services/__tests__/gridRecommendationService.test.ts` ✅
- `npx vitest run server/services/__tests__/gridRecommendationValidation.test.ts` ✅
- `npx vitest run server/services/__tests__/applyRecommendationPatchAtomically.test.ts` ✅
- `npx vitest run server/routes/__tests__/gridRecommendationApply.test.ts` ✅
- `npx vitest run client/src/components/grid/GridRecommendationDialog.test.tsx` ✅
- `npx vitest run client/src/components/grid/GridMarketPanel.test.tsx` ✅
- `npx vitest run server/services/gridIsolated ... client/src/components/grid` ✅ (530/531; fallo aislado preexistente en `gridUxRender.test.tsx` no relacionado con el alcance)
- `npx tsc` ✅
- `npm run build` ✅
- `git diff --check` ✅

## Invariantes mantenidas

- SHADOW, MAKER_ONLY, cero órdenes reales.
- strict, `minLevelsForViableGrid=4`.
- Allocator como fuente de niveles.
- 1+1 no autorizado.
- Sin modificaciones de DB, schema, migraciones, deploy, VPS o credenciales.

## Pendiente REV-C12B

- Extensión del gate Revolut X en view model y `GridMarketPanel` (datos reales de `executionMarketSnapshot` / `pairConstraints`).
- Causa raíz de `REVOLUT_X_UNAVAILABLE` en staging.

## Rama

`review/grid-rev-c12a-20260731` en `origin`.

## Main intacto

`origin/main` permanece en `44cd46ff3a6e195556987968a87c8e795d66cd02`.
