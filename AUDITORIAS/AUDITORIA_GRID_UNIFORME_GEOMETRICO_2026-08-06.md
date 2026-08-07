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
- **Validado:** ✅ (tests + tsc + build)
- **Commiteado:** ✅ (`57fd074`)
- **Subido:** ✅ (`origin/main`)
- **Desplegado:** ✅ (staging app-only, DB intacta)
- **Operacional:** ✅ (SHADOW activo, 0 órdenes reales)

## Pendientes

- Ninguno para esta tarea.
