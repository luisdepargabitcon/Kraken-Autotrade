# AUDITORIA GRID UI ESCALERA UNIFICADA 2026-08-05

## Resumen

Implementacion de la vista unificada de escalera para Grid Isolated, reemplazando las vistas separadas de BUY, SELL/rungs y salidas de ciclo por una sola escalera ordenada por precio descendente, con marcador de precio actual, subvistas de ciclos e historico, filtros y busqueda.

## Commit tecnico

- **SHA**: `3d43c836159ddef36610aafb24ad4f01cba0b729`
- **Parent**: `abe6f90a721c3d509c78990bb9a5af4b5f20caa5`
- **Mensaje**: `feat(grid-ui): unificar escalera y trazabilidad buy-sell`
- **Fast-forward**: Si, sin merge commit
- **Rama review**: `review/grid-ui-unified-ladder-20260805-153350`

## Archivos nuevos

| Archivo | Descripcion |
|---------|-------------|
| `client/src/components/grid/gridLevelLadderViewModel.ts` | Funcion pura `buildGridLevelLadderViewModel(operational)` que construye la escalera unificada |
| `client/src/components/grid/GridUnifiedLevelLadder.tsx` | Componente React con subvistas Escalera / Ciclos / Historico, filtros y busqueda |
| `client/src/components/grid/__tests__/gridLevelLadderViewModel.test.ts` | 30 tests unitarios del view model |
| `client/src/components/grid/__tests__/GridUnifiedLevelLadder.test.tsx` | 20 tests del componente |

## Archivos modificados

| Archivo | Cambio |
|---------|--------|
| `client/src/components/grid/GridLevelsCompactPanel.tsx` | Reemplazo del cuerpo principal por `GridUnifiedLevelLadder`, preservando el header y el diagnostic de niveles |
| `client/src/components/grid/GridLevelsCompactPanel.v3.test.tsx` | Actualizacion de tests para coincidir con las nuevas etiquetas unificadas |
| `client/src/components/grid/__tests__/gridUxRender.test.tsx` | Actualizacion del test de filtros para coincidir con las nuevas etiquetas |

## Diseno de la escalera unificada

### Tipos de fila

- **BUY_ENTRY**: Niveles BUY del rango activo. Muestra "Target definitivo: se asignara despues de ejecutar el BUY" cuando no hay ciclo asociado.
- **REFERENCE_RUNG**: Rungs SELL de referencia. Marcados como "No ejecutable" cuando no tienen ciclo asociado. Pueden tener multiples ciclos vinculados.
- **CYCLE_SELL_TARGET**: Target sintetico creado cuando un cycleOwnedExit no coincide con ningun rung por ID o precio.

### Ordenacion

- Primario: precio descendente (mayor a menor)
- Secundario (desempate): CYCLE_SELL_TARGET > REFERENCE_RUNG > BUY_ENTRY
- Terciario: key alfabetico

### Asociacion de ciclos

- Por `targetRungLevelId` (prioridad)
- Por `targetSellPrice` con tolerancia +/-0.01 cuando no hay ID
- Un rung puede tener multiples ciclos asociados
- Los ciclos no coincidentes generan filas sinteticas

### Marcador de precio actual

- Se inserta exactamente una vez
- Posicion: antes de la primera fila con precio menor al actual
- Si no hay filas menores, se inserta al final
- Si el precio es invalido (null, <=0, NaN), no se inserta

### Subvistas

1. **Escalera actual**: Vista por defecto con todos los niveles del rango vigente
2. **Ciclos y salidas**: Cards de cycleOwnedExits con detalle economico
3. **Historico**: Niveles historicos con paginacion (20 en 20)

### Filtros

- **Todos**: Muestra todas las filas
- **BUY**: Solo BUY_ENTRY
- **SELL / rungs**: REFERENCE_RUNG + CYCLE_SELL_TARGET
- **Con ciclo**: Filas con linkedCycles o cycleId

### Busqueda

- Busca en: side, kind, status, statusLabel, price, cycleNumber, cycleId, rangeVersionId, explanation

## Tests

### View model (30 casos)

- Combinacion de BUY y SELL
- Ordenacion por precio descendente
- No separacion en arrays independientes
- Insercion unica del marcador de precio
- Posicion del marcador (arriba, medio, abajo)
- Precio invalido (sin marcador)
- Exclusion de historico de la escalera
- Historico en coleccion separada
- No emparejamiento por cantidad o indice
- BUY planned con mensaje de target pendiente
- Asociacion por targetRungLevelId
- Asociacion por targetSellPrice con tolerancia
- No duplicacion de rung con ciclo
- Multiples ciclos en un mismo rung
- Target sintetico sin rung coincidente
- Ordenacion de target sintetico
- Calculo de notional
- No mutacion del input
- Keys estables y unicas
- Datos nulos sin excepcion
- Filtrado Todos/BUY/SELL/Con ciclo
- Busqueda por ciclo y por precio

### Componente (20 casos)

- Vista inicial "Escalera del rango actual"
- BUY y SELL visibles simultaneamente
- No vista exclusiva Entradas BUY
- No vista exclusiva Rungs SELL
- Marcador Precio actual visible
- Orden visual correcto
- BUY sin ciclo con mensaje de target pendiente
- Ciclo abierto visible
- Neto esperado visible
- Rung marcado como no ejecutable
- Historico separado
- Mostrar mas historico
- Filtros presentes
- Busqueda presente
- Estado comprensible
- No relacion falsa por cantidad
- Multiples ciclos visibles
- Datos vacios con mensaje util
- No clases de ancho fijo
- No errores React por keys duplicadas

## Validaciones

### Local (worktree de desarrollo)

- `npm run check`: OK (0 errores)
- `npm run build`: OK (client + server)
- `npx vitest run client/src/components/grid/`: OK 89/89 tests
- `npx vitest run` (suite completa): 3501 passed, 30 failed (historicos), 29 skipped -- 0 new failures
- `git diff --check`: OK

### Worktree independiente (verificacion limpia)

- `npm run check`: OK
- `npm run build`: OK
- `npx vitest run client/src/components/grid/`: OK 89/89 tests
- `npx vitest run` (suite completa): 3501 passed, 30 failed (historicos), 29 skipped -- 0 new failures
- `git diff --name-status HEAD~1 HEAD`: Solo 7 archivos autorizados
- `git diff --check`: OK

### Deploy staging

- **VPS**: `root@5.250.184.18:/opt/krakenbot-staging`
- **Fast-forward**: `abe6f90` -> `3d43c83`
- **Build app**: OK
- **Deploy app-only**: `docker compose up -d --no-deps krakenbot-staging-app` OK
- **DB unchanged**: ID y StartedAt identicos antes/despues OK
- **HTTP**: Root=200, Config=200, Status=200, Audit=200 OK
- **Operacional**: mode=SHADOW, pair=BTC/USD, realOpenOrdersCount=0, takerFallback=false OK
- **Runtime logs**: Sin errores, scanning normal OK
- **JS bundle**: Contiene "Escalera", "PRECIO", "Ladder" OK
- **API data contract**: entryLevels, referenceRungs, cycleOwnedExits, historicalLevels, currentPrice presentes OK

## Alcance

- **Solo frontend**: No se modificaron archivos de server, shared, migrations, Docker, package.json ni package-lock.json
- **No backend**: Sin cambios en API, DB, schema, motor ni lifecycle
- **No REAL**: Sin activacion de modo real, sin ordenes reales

## Pendientes

- Validacion visual interactiva en navegador (desktop 1440x900 y movil 390x844) -- completada en fase final

---

# Correccion contractual -- 2026-08-05 (segunda fase)

**Commit tecnico:** `da6524816970a6fb8c14a8265f3ad4ec6e0fff7f`
**Rama review:** `review/grid-ui-ladder-correction-20260805-170000`
**Estado:** COMPLETADO -- VALIDADO EN STAGING

## Problema detectado

El componente `GridUnifiedLevelLadder` y su view model `gridLevelLadderViewModel.ts` utilizaban `currentRange.id` como identificador del rango activo. Este campo **no existe** en el contrato canonico `GridOperationalViewModel` definido por `buildGridOperationalViewModel.ts`. El campo real es `market.entryRange.activeRangeVersionId`.

Esto provocaba:
- `activeRangeId` siempre `null` en runtime
- Etiqueta "Sin rango activo" incluso con rango vigente
- Filtrado incorrecto de niveles por rango
- Asociacion ciclo-rung con fallback por precio incluso cuando `targetRungLevelId` era invalido
- `makerState` mostrando codigos tecnicos (`MAKER_PENDING`) como texto operativo principal
- Sin busqueda independiente para filas historicas

## Solucion implementada

### 1. Alineacion contractual
- **Eliminado** `currentRange.id` de `OperationalInput`
- **Anadido** `market.entryRange.activeRangeVersionId` como fuente canonica
- Fallback: si no hay UUID explicito, inferir de `rangeVersionId` de niveles current (solo si todos coinciden)

### 2. Filtrado correcto de filas
- Nueva funcion `filterCurrentLevels<T>()`: filtra por `rangeRelation === "current"` (primario) o por `rangeVersionId === activeRangeId` (fallback)

### 3. Asociacion ciclo-rung corregida
- `matchCycleToRung` ahora retorna `{ rung, warning }`
- Cuando `targetRungLevelId` existe pero no coincide: **no cae a precio**, retorna warning
- Fallback por precio solo cuando no hay ID
- Warnings propagados al view model (`RUNG_NOT_FOUND`)

### 4. Humanizacion de makerState
- Nueva funcion `humanizeMakerState()`: mapea `MAKER_PENDING` -> "SELL maker pendiente", etc.
- Usada en filas sinteticas CYCLE_SELL_TARGET y en CycleExitCard del componente React
- El valor tecnico crudo solo aparece en "Detalle tecnico"

### 5. Busqueda historica separada
- Nueva funcion `searchHistoricalRows()`: busca por side, status, price, cycleNumber, cycleId, rangeVersionId, rangeRelation
- Input independiente con `aria-label="Buscar en historico"` en el subview Historico

## Validaciones ejecutadas (da65248)

- **42 tests view model** -- 42/42 PASS
- **32 tests componente** -- 32/32 PASS
- `npm run check`: PASS
- `npm run build`: PASS
- Deploy staging app-only completado
- HTTP: Root=200, Config=200, Status=200, Audit=200
- mode=SHADOW, pair=BTC/USD, realOpenOrdersCount=0, MAKER_ONLY
- Visual validation Playwright: Desktop 1440x900 20/20 PASS, Mobile 390x844 20/20 PASS

---

# Defectos residuales detectados -- 2026-08-06

Tras la correccion `da65248` se identificaron 4 defectos residuales:

1. **`activeRangeId` no retorna `resolvedRangeId`**: El view model retornaba `activeRangeId` (valor original de `market.entryRange.activeRangeVersionId`) en lugar de `resolvedRangeId` (que incluye el ID inferido de niveles current). Esto provocaba que `vm.activeRangeId` y `activeRangeLabel` no siempre representaran el mismo identificador.

2. **`filterCurrentLevels` evaluaba `hasRangeRelation` globalmente**: La funcion comprobaba si *alguna* fila tenia `rangeRelation` y, si era asi, filtraba *todas* por `rangeRelation === "current"`. Esto era incorrecto para colecciones mixtas donde algunas filas tienen `rangeRelation` y otras no.

3. **Tests del componente no eran interactivos**: Los tests usaban `renderToString` (SSR) para verificar contenido estatico. No verificaban la logica de filtrado, busqueda, cambio de subvista, o paginacion de historico.

4. **Historial documental sobrescrito**: El archivo de auditoria fue sobrescrito en la correccion `da65248` en lugar de preservar el contenido original y anadir la correccion cronologicamente.

---

# Correccion final -- 2026-08-06

**Commit tecnico:** `5ea383b`
**Rama review:** `review/grid-ui-final-contract-tests-20260805-235900`
**Estado:** COMPLETADO -- VALIDADO

## Correcciones implementadas

### 1. `activeRangeId` retorna `resolvedRangeId`
- `gridLevelLadderViewModel.ts` linea 550: `activeRangeId: resolvedRangeId` en lugar de `activeRangeId`
- Ahora `vm.activeRangeId`, `activeRangeLabel` y `filterCurrentLevels` usan el mismo identificador resuelto
- Test 43: verifica que `vm.activeRangeId` retorna el ID inferido cuando `activeRangeVersionId=null`
- Test 44: verifica que IDs inconsistentes producen `activeRangeId=null` y etiqueta "Rango vigente"

### 2. `filterCurrentLevels` evalua por fila
- Regla A: Si `rangeRelation` esta presente, incluir solo si `=== "current"`
- Regla B: Si `rangeRelation` ausente y `activeRangeId` existe, incluir si `rangeVersionId === activeRangeId` (preservar si `rangeVersionId` tambien ausente)
- Regla C: Si `rangeRelation` ausente y `activeRangeId` no existe, preservar la fila
- Tests 45-48: verifican colecciones mixtas, previous con ID coincidente, y filas sin metadatos

### 3. Tests de logica interactiva via funciones puras
- Entorno vitest: `environment="node"`, sin `@testing-library/react`, `jsdom`, o `happy-dom`
- No se instalaron nuevas dependencias ni se modificaron package files
- El componente delega todo comportamiento interactivo a funciones puras: `filterAndSearchRows`, `searchHistoricalRows`, `insertCurrentPriceMarker`, `humanizeMakerState`, `buildGridLevelLadderViewModel`
- 20 tests de logica interactiva (I1-I20) que verifican: filtros, busqueda, subvistas, Mostrar mas, refetch, keys unicas, rung inexistente, marcador de precio, movil, datos vacios
- Total: 52 tests componente (30 SSR + 20 logica interactiva + 2 existentes)
- **Aclaracion**: Estos tests validan la logica de interaccion mediante funciones puras en entorno Node. No utilizan Testing Library, jsdom ni happy-dom. La interaccion real con DOM se valido en navegador contra staging.

### 4. Restauracion documental
- Contenido original recuperado de commit `9bb124231dd1dbd35e2f8ff55c794ef55baed164`
- Correcciones anadidas cronologicamente sin sobrescribir

## Validaciones ejecutadas (5ea383b)

### Tests dirigidos (worktree desarrollo)
- **48 tests view model** -- 48/48 PASS (773ms)
- **52 tests componente** -- 52/52 PASS (908ms)

### Suite Grid UI completa
- **139 tests** -- 139/139 PASS (7 archivos, 2.48s)

### Verificacion limpia (worktree independiente desde origin/review)
- **100 tests dirigidos** (view model + componente) -- 100/100 PASS (1.23s)
- `CLEAN_VERIFY_UI=PASS`

### Suite completa
- 3551 passed, 30 failed (todos pre-existentes en server/), 29 skipped
- `FULL_SUITE_NEW_FAILURES=0`

### Build y type-check
- `npm run check` (tsc): PASS
- `npm run build`: PASS (client + server)

### Git
- `git diff --check`: limpio
- Solo 3 archivos frontend Grid modificados
- Cero cambios en server, shared, migrations, Docker, compose, package files
- Fast-forward main: `aa223cc` -> `5ea383b`

## Registros (corregidos)

- `ORIGINAL_UI_TECH_SHA`: `3d43c836159ddef36610aafb24ad4f01cba0b729`
- `FIRST_CORRECTION_SHA`: `da6524816970a6fb8c14a8265f3ad4ec6e0fff7f`
- `FINAL_UI_TECH_SHA`: `5ea383b`
- `RESOLVED_RANGE_ID_RETURNED=TRUE`
- `MIXED_RANGE_FILTERING_FIXED=TRUE`
- `INTERACTION_LOGIC_TESTS=TRUE`
- `INTERACTION_LOGIC_TEST_COUNT=20`
- `INTERACTION_LOGIC_TEST_METHOD=PURE_FUNCTIONS_NODE`
- `REAL_DOM_UNIT_TESTS=FALSE`
- `AUDIT_HISTORY_PRESERVED=TRUE`
- `CLEAN_VERIFY_UI=PASS`
- `FULL_SUITE_NEW_FAILURES=0`

## Pendientes

- Deploy staging y validacion visual real pendientes (requieren acceso VPS)

---

# Deploy final y validacion real en staging -- 2026-08-06

**DEPLOY_SOURCE_SHA:** `0a604d8a85b586dfbab6f0672e91a99c46f38d75`
**Estado:** COMPLETADO -- VALIDADO EN STAGING

## Pre-deploy

- **PRE_DEPLOY_SHA:** `aa223ccf22f2a809880850e3fd5fa878cfbad066`
- **APP_ID_BEFORE:** `d16d636e76b9`
- **APP_IMAGE_BEFORE:** `krakenbot-staging-krakenbot-staging-app`
- **APP_STARTED_BEFORE:** Up 7 hours
- **DB_ID_BEFORE:** `a2f9a3f275c3`
- **DB_IMAGE_BEFORE:** `postgres:16-alpine`
- **DB_STARTED_BEFORE:** Up 3 months (healthy)
- **DB_HEALTH_BEFORE:** healthy

### Verificacion operacional pre-deploy
- mode=SHADOW
- pair=BTC/USD
- executionPolicy=MAKER_ONLY
- realOpenOrdersCount=0
- fatalErrors=0

## Deploy app-only

- `git merge --ff-only origin/main` en VPS: `aa223cc` -> `0a604d8`
- `docker compose -f docker-compose.staging.yml build krakenbot-staging-app`: OK (2599 modulos, built in 8.72s)
- `docker compose -f docker-compose.staging.yml up -d --no-deps krakenbot-staging-app`: OK
- `--no-deps` utilizado: DB no tocada

## Post-deploy

- **POST_DEPLOY_SHA:** `0a604d8a85b586dfbab6f0672e91a99c46f38d75`
- **APP_ID_AFTER:** `62d48682c0f5`
- **APP_IMAGE_AFTER:** `krakenbot-staging-krakenbot-staging-app`
- **APP_STARTED_AFTER:** Up (recreado)
- **DB_ID_AFTER:** `a2f9a3f275c3` (= DB_ID_BEFORE)
- **DB_IMAGE_AFTER:** `postgres:16-alpine` (= DB_IMAGE_BEFORE)
- **DB_STARTED_AFTER:** Up 3 months (healthy) (= DB_STARTED_BEFORE)
- **DB_HEALTH_AFTER:** healthy
- **DB_RESTARTED=FALSE**

## Validacion HTTP

| Endpoint | Codigo |
|----------|--------|
| `GET /` | 200 |
| `GET /grid-isolated` | 200 |
| `GET /api/grid-isolated/config` | 200 |
| `GET /api/grid-isolated/status` | 200 |
| `GET /api/grid-isolated/monitor/audit` | 200 |

- ROOT_HTTP=200
- GRID_UI_HTTP=200
- CONFIG_HTTP=200
- STATUS_HTTP=200
- AUDIT_HTTP=200

## Validacion runtime

- MODE=SHADOW
- PAIR=BTC/USD
- MAKER_ONLY=TRUE
- TAKER_FALLBACK=FALSE (config), no ejecutado en runtime
- REAL_OPEN_ORDERS=0
- FATAL_ERRORS=0
- isRunning=true
- Logs: sin crash, sin error React, sin error de carga Grid, sin intento de orden real, sin taker fallback ejecutado
- `GRID_CYCLES_RECOVERED`: 0 ciclos resueltos, 0 en revision, 0 errores

## Validacion interactiva real en navegador (Playwright headless en VPS)

### Desktop 1440x900 — 25 checks

| ID | Check | Resultado |
|----|-------|-----------|
| D1 | Grid Isolated page loaded | PASS |
| D2 | Niveles section opened | PASS |
| D3 | "Escalera del rango actual" visible | PASS |
| D4 | BUY and SELL/rungs visible together (buy=3 sell=3) | PASS |
| D5 | Exactly one PRECIO ACTUAL marker (count=1) | PASS |
| D6 | Click Todos — all rows visible (rows=6) | PASS |
| D7 | BUY filter removes SELL/rungs (buy=3 sell=0) | PASS |
| D8 | SELL filter removes BUY (sell=3 buy=0) | PASS |
| D9 | Click Con ciclo filter (rows=0) | PASS |
| D10 | Back to Todos — rows restored (before=6 after=6) | PASS |
| D11 | Search filters rows (before=6 after=0) | PASS |
| D12 | Clear search restores rows (before=0 after=6) | PASS |
| D13 | Ciclos y salidas content visible | PASS |
| D14 | MAKER_PENDING not visible as operational state (count=0) | PASS |
| D15 | Historico tab opened | PASS |
| D16 | Historical rows visible (rows=20) | PASS |
| D17 | Mostrar mas increments rows (before=20 after=40) | PASS |
| D18 | Historical search by cycleId | PASS |
| D19 | Historical search by rangeVersionId | PASS |
| D20 | Empty result message for nonexistent search | PASS |
| D21 | Back to Escalera — no duplicate rows (expected=6 actual=6) | PASS |
| D22 | No false price associations | PASS |
| D23 | No duplicate React keys (total=6 unique=6) | PASS |
| D24 | Console errors = 0 | PASS |
| D25 | No horizontal overflow (scrollWidth=1440 innerWidth=1440) | PASS |

### Mobile 390x844 — 9 checks

| ID | Check | Resultado |
|----|-------|-----------|
| M1 | Grid Isolated loaded (mobile) | PASS |
| M2 | "Escalera del rango actual" visible (mobile) | PASS |
| M3 | BUY and SELL visible together (mobile) (buy=3 sell=3) | PASS |
| M4 | One price marker (mobile) (count=1) | PASS |
| M5 | BUY filter works (mobile) (buy=3 sell=0) | PASS |
| M6 | Ciclos y salidas tab (mobile) | PASS |
| M7 | Historico tab (mobile) | PASS |
| M8 | Console errors = 0 (mobile) | PASS |
| M9 | No horizontal overflow (mobile) (scrollWidth=390 innerWidth=390) | PASS |

### Registros de validacion real

- REAL_BROWSER_INTERACTION_VALIDATION=TRUE
- DESKTOP_VALIDATED=TRUE
- MOBILE_VALIDATED=TRUE
- CONSOLE_ERRORS=0
- REACT_KEY_WARNINGS=0
- HORIZONTAL_OVERFLOW=FALSE
- TOTAL_CHECKS=34
- TOTAL_PASS=34
- TOTAL_FAIL=0
- ALL_PASS=TRUE

### Evidencia

- Screenshots: `/tmp/grid_ui_desktop_final.png`, `/tmp/grid_ui_mobile_final.png`
- Method: Playwright headless Chromium en VPS, navegacion real sobre `http://127.0.0.1:3020/grid-isolated`
- Interacciones reales: click Niveles, click filtros, fill search, click subviews, click Mostrar mas, fill historico search

## Registros finales consolidados

- `ORIGINAL_UI_TECH_SHA`: `3d43c836159ddef36610aafb24ad4f01cba0b729`
- `FIRST_CORRECTION_SHA`: `da6524816970a6fb8c14a8265f3ad4ec6e0fff7f`
- `FINAL_UI_TECH_SHA`: `5ea383b`
- `DEPLOY_SOURCE_SHA`: `0a604d8a85b586dfbab6f0672e91a99c46f38d75`
- `RESOLVED_RANGE_ID_RETURNED=TRUE`
- `MIXED_RANGE_FILTERING_FIXED=TRUE`
- `INTERACTION_LOGIC_TESTS=TRUE`
- `INTERACTION_LOGIC_TEST_COUNT=20`
- `INTERACTION_LOGIC_TEST_METHOD=PURE_FUNCTIONS_NODE`
- `REAL_DOM_UNIT_TESTS=FALSE`
- `REAL_BROWSER_INTERACTION_VALIDATION=TRUE`
- `DESKTOP_VALIDATED=TRUE`
- `MOBILE_VALIDATED=TRUE`
- `CONSOLE_ERRORS=0`
- `REACT_KEY_WARNINGS=0`
- `HORIZONTAL_OVERFLOW=FALSE`
- `AUDIT_HISTORY_PRESERVED=TRUE`
- `CLEAN_VERIFY_UI=PASS`
- `FULL_SUITE_NEW_FAILURES=0`
- `DB_RESTARTED=FALSE`
- `MODE=SHADOW`
- `MAKER_ONLY=TRUE`
- `REAL_ORDERS=0`
- `FATAL_ERRORS=0`

## Pendientes

Ninguno.
