# Auditoría: Malla Geométrica Uniforme Canónica

**Fecha:** 2026-08-07  
**Commit:** `57fd074`  
**Branch:** `review/grid-uniform-geometric-20260806` → `main`  
**Autor:** Cascade (Windsurf)

## Problema

El sistema Grid utilizaba una fórmula de espaciado acumulativo lineal que producía un **doble gap central** entre BUY[0] y SELL[0], además de no garantizar uniformidad geométrica entre niveles adyacentes.

## Solución

Refactor a **malla geométrica uniforme canónica** con fórmula:

```
ratio = 1 + spacingPct/100
BUY[i]  = centerPrice / ratio^(i + 0.5)
SELL[i] = centerPrice * ratio^(i + 0.5)
```

**Invariante de gap central:** `SELL[0] / BUY[0] = ratio` (un único gap central igual al ratio geométrico).

**Gap adyacente uniforme:** La razón entre cualquier par de niveles adyacentes del mismo lado es exactamente `ratio`.

## Archivos afectados

### Nuevos
- `server/services/gridIsolated/gridUniformGeometric.ts` — Helper canónico: `calculateUniformGeometricRatio`, `calculateUniformGeometricLevelPrice`, `calculateUniformGeometricRangeRequirement`
- `server/services/__tests__/gridUniformGeometric.test.ts` — 14 tests obligatorios

### Modificados
- `server/services/gridIsolated/gridSpacingCalculator.ts` — Import del helper, cambio de fórmula a `uniform_geometric_spacing`, refactor de `countViableLevelsIterative`, `generateAccumulatedGridLevelsPreview`, `calculateAdaptiveSmartRange`, range audit con `adjacentGapMinPct`, `centralGapPct`, `uniformSpacingOk`
- `server/services/gridIsolated/gridIsolatedEngine.ts` — `geometricRatio` usa ratio real, method `professional_uniform_geometric_spacing`
- `server/services/gridIsolated/gridLevelConstraintNormalizer.ts` — Alineación de precio a tick size (`priceTickSize`, `pricePrecision`)
- `server/routes/gridIsolated.routes.ts` — `accumulated_spacing` → `uniform_geometric_spacing`
- `server/services/gridIsolated/buildGridAuditViewModel.ts` — `accumulated_spacing` → `uniform_geometric_spacing`
- `server/services/gridIsolated/__tests__/gridForensicJsonb.test.ts` — `accumulated_spacing` → `uniform_geometric_spacing`
- `server/services/__tests__/gridSpacingCalculator.test.ts` — Valores esperados actualizados
- `server/services/__tests__/gridAdaptiveSmartRange.test.ts` — Microstructure params añadidos
- `server/services/__tests__/gridCompactRange.test.ts` — Microstructure params + texto de warning corregido
- `server/services/gridIsolated/__tests__/gridLevelConstraintNormalizer.test.ts` — `priceTickSize`/`pricePrecision` añadidos

## Validaciones

| Validación | Resultado |
|---|---|
| Tests dirigidos (85) | ✅ 85/85 pass |
| Tests grid completos (697) | ✅ 697/697 pass |
| TypeScript check | ✅ 0 errors |
| Build | ✅ client + server |
| Suite completa (3624) | 3579 pass, 16 fail (pre-existing, no relacionados) |

## Deploy staging

- **VPS:** `5.250.184.18`
- **Directorio:** `/opt/krakenbot-staging`
- **Método:** `git fetch` → `git merge --ff-only origin/main` → `docker compose build krakenbot-staging-app` → `docker compose up -d --no-deps krakenbot-staging-app`
- **DB no tocada:** DB_ID_BEFORE = DB_ID_AFTER, DB_STARTED sin cambios, DB_HEALTH = healthy
- **App recreada:** nuevo container ID, started `2026-08-07T08:53:05`

## Estado operacional post-deploy

| Métrica | Valor |
|---|---|
| MODE | SHADOW |
| isActive | true |
| isRunning | true |
| realOpenOrdersCount | 0 |
| circuitBreakerOpen | false |
| pumpDumpState | normal |
| activeRangeVersion | 29 (pre-deploy, reutilizado) |
| lastTickAt | 2026-08-07T08:54:08 |

## Estado final

- **Implementado:** ✅
- **Validado:** ✅ (22 tests A-H + 612 grid tests + tsc + build)
- **Commiteado:** ✅ (`49ec105` — fix(grid): cerrar geometria uniforme y restaurar dependencias)
- **Subido:** ✅ (`origin/main` + `review/grid-uniform-geometric-final-audit-20260807`)
- **Desplegado:** ✅ (staging app-only, DB intacta, --no-deps)
- **Operacional:** ✅ (SHADOW activo, 0 órdenes reales, DB sin restart)

## Deploy staging — 2026-08-09

### Pre-deploy
- VPS_SHA_BEFORE: 752d57d
- ORIGIN_MAIN: ff4a139
- APP_ID_BEFORE: d70c0c37e3c0
- DB_ID_BEFORE: a2f9a3f275c3
- DB_HEALTH: healthy (Up 3 months)
- Branch: main, checkout limpio

### Deploy
- git merge --ff-only origin/main → ff4a139
- docker compose build krakenbot-staging-app → exitoso
- docker compose up -d --no-deps krakenbot-staging-app → exitoso

### Post-deploy
- APP_ID_AFTER: 16ef332176a6
- DB_ID_AFTER: a2f9a3f275c3 (= BEFORE, intacta)
- DB_RESTARTED: FALSE
- DB_HEALTH: healthy
- Endpoints: / /grid-isolated /api/grid-isolated/config /api/grid-isolated/status /api/grid-isolated/monitor/audit → todos HTTP 200
- MODE: SHADOW
- PAIR: BTC/USD
- isActive: true, isRunning: true
- realOpenOrdersCount: 0
- circuitBreakerOpen: false
- openCycles: 0
- pairConstraints: verified + fresh
- executionGate: VERIFIED

### Rebuild shadow range
- REBUILD_EXECUTED: FALSE
- REBUILD_BLOCKER: shadow_compact_not_viable — banda Bollinger 1.65% + compact range max 2.5% solo permite 2 niveles (1 por lado) vs 8 solicitados; spacing mínimo rentable 1.29%
- Guardas pre-check: TODAS pasaron
- El bloqueo es por condiciones de mercado (banda estrecha), no por código
- professional-generator/validate: viabilityStatus=not_viable, sideEffectsDetected=false, readOnly=true

### Métricas finales
- FINAL_TECH_SHA: 49ec105704a0cbde1b6391337b479b01a46dd89e
- VITEST_VERSION: 4.0.17
- PACKAGE_FILES_RESTORED: TRUE
- UNIFORM_GEOMETRIC_GRID: TRUE
- ALTERNATIVE_GEOMETRY_MODES: FALSE
- CENTRAL_DEADBAND: FALSE
- NEW_GEOMETRY_CONFIG_FIELDS: 0
- V3_TARGET_ECONOMICS_CHANGED: FALSE
- HISTORICAL_LEVELS_MUTATED: FALSE

## Pendientes

- Rebuild del rango shadow cuando las condiciones de mercado lo permitan (banda suficientemente ancha)
- Validación UI real cuando exista un rango activo generado por la nueva geometría
