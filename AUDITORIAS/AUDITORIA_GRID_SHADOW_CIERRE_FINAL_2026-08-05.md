# AUDITORÍA GRID SHADOW CIERRE FINAL R2 — 2026-08-05

## Resumen

Grid SHADOW R2 cerrado y validado en staging. Fail-closed normalization de niveles, E2E estricto con status=completed, deploy app-only, 24 polls runtime, persistencia app-only restart y suite global con cero fallos nuevos.

## Commits R2

- TECH_R2_SHA: `03343221522868600f5554571406817360a91343`
- DOC_R2_PREDEPLOY_SHA: `ad9798ef8a72ea59776bd980e5d45f5cdb4ba5df`
- DOC_R2_FINAL_SHA_PREVIOUS: `45730ab05fe8948825ddc63a54e92f7abfe4a240`
- DEPLOY_SOURCE_SHA: `ad9798ef8a72ea59776bd980e5d45f5cdb4ba5df`

## Fixes R2

1. Normalizacion fail-closed de niveles (`gridLevelConstraintNormalizer.ts`): validacion de cada nivel contra `quantityStep`, `minOrderBase`, `minOrderQuote`, `minOrderUsd`, `maxOrderBase` con razon de rechazo detallada.
2. Retorno exclusivo de `acceptedLevels` en `buildRangeProposal`: el rango se rechaza si < 4 niveles aceptados. `levelsCount` en DB e in-memory usa solo niveles aceptados.
3. Validacion de `quantityStep` con `Math.floor` (evita floating-point rounding up).
4. `minOrderBase`: niveles con cantidad inferior al minimo son rechazados.
5. `minOrderQuote`: niveles cuyo notional (price * quantity) es inferior al minimo son rechazados.
6. `minOrderUsd`: niveles cuyo notional en USD es inferior al minimo son rechazados.
7. `maxOrderBase`: niveles con cantidad superior al maximo son rechazados.
8. E2E estricto con `status=completed`: eliminados `if(done)` y aceptacion de `buy_filled`. SELL lifecycle con 3 ticks: TRIGGERED -> MAKER_PENDING -> fill. Delay de 2ms entre ticks.
9. Maker BUY y SELL con tick posterior obligatorio: `lifecycleTickId` enforce, no double fill, repricing reset.

## Tests

- NORMALIZER_TESTS=18/18
- E2E_TESTS=34/34
- MAKER_PENDING_TESTS=10/10
- DIRECTED_TESTS=62/62
- GRID_ISOLATED_TESTS=612/612

## Full suite real

- TOTAL_TESTS=3510
- PASSED=3451
- FAILED_HISTORICAL=30
- SKIPPED=29
- NEW_FAILURES=0
- CHECK_EXIT=0
- BUILD_EXIT=0
- DIFF_EXIT=0

## Deploy

- PRE_APP_ID_PREFIX=61fe394484
- POST_APP_ID_PREFIX=ce46ea2d55
- PRE_APP_STARTED=2026-08-05T08:47:29
- POST_APP_STARTED=2026-08-05T10:48:35
- DB_ID_PREFIX=a2f9a3f275
- DB_STARTED=2026-05-03T21:10:46
- DB_RESTARTED=FALSE

## Runtime — 24 polls

- MODE=SHADOW
- PAIR=BTC/USD
- REAL_OPEN_ORDERS=0
- CIRCUIT_BREAKER_OPEN=FALSE
- OPEN_CYCLES=0
- PLANNED_LEVELS=4

## Niveles activos

- BUY 63416.14 / 0.00630754 / 400.00 USD
- BUY 62818.51 / 0.00636755 / 400.00 USD
- SELL 64622.78 / 0.00630754 / 407.69 USD
- SELL 65231.78 / 0.00636755 / 415.53 USD

## Constraints por nivel

- ACTIVE_CONSTRAINT_VIOLATIONS=0
- ZERO_QUANTITY_LEVELS=0
- DUPLICATE_LEVELS=0
- ORPHAN_SELLS=0
- OLD_RANGE_NEW_BUYS=0

## Persistencia

- APP_ONLY_RESTART_VALIDATED=TRUE
- DB_UNCHANGED=TRUE
- ACTIVE_RANGE_ID=937f406d-3abe-461e-9bfc-6ebfc96ff119
- ACTIVE_LEVELS_RECOVERED=4
- COMPLETED_CYCLES_RECOVERED=3
- OPEN_CYCLES_RECOVERED=0
- TERMINAL_CYCLES_REOPENED=0
- PROTECTED_CYCLE_MUTATIONS=0

## Seguridad

- EFFECTIVE_EXECUTION_POLICY=MAKER_ONLY
- EFFECTIVE_TAKER_FALLBACK_ENABLED=FALSE
- EFFECTIVE_TAKER_FALLBACK_ALLOWED=FALSE
- TAKER_FALLBACK_USED=FALSE
- REAL_ORDERS_CREATED=0
- MARKET_ORDERS_CREATED=0
- FATAL_ERRORS=0
- MANUAL_SQL=FALSE
- NEW_MIGRATIONS=FALSE
- PRODUCTION=FALSE
- REAL_LIMITED=FALSE
- REAL_FULL=FALSE

## Clasificacion

GRID_SHADOW_READY_WAITING_MARKET_VALIDATED

El rango esta activo con 4 niveles planned (2 BUY + 2 SELL). El motor funciona correctamente con normalizacion fail-closed. Esperando condiciones de mercado para que el precio cruce los niveles BUY.

## Estado final

DONE: TRUE para Grid SHADOW
HARD_BLOCKER: FALSE
TASK_STATUS: Grid SHADOW R2 cerrado y validado en staging
NEXT_ACTION: observacion prolongada SHADOW; modos REAL permanecen bloqueados
DEPLOY_AUTHORIZED: FALSE
MIGRATION_REQUIRED: FALSE

## Antecedente historico R1

R1 (2026-08-05, commit `12fdaf2`) aplico 3 fixes iniciales: maker pending lifecycle, timestamp canonico y quantity step alignment. R1 fue desplegado y validado en staging. R2 sustituye a R1 como cierre final al corregir el defecto de buildRangeProposal que devolvia gridLevels en vez de viableLevels y endurecer los tests E2E con status=completed estricto.
