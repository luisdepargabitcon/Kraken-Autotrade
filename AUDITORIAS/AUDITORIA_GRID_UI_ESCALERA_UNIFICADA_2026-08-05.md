# AUDITORÍA: Corrección contractual Grid UI Escalera Unificada

**Fecha:** 2026-08-05
**Commit técnico:** `da6524816970a6fb8c14a8265f3ad4ec6e0fff7f`
**Rama review:** `review/grid-ui-ladder-correction-20260805-170000`
**Estado:** COMPLETADO — VALIDADO EN STAGING

---

## Problema detectado

El componente `GridUnifiedLevelLadder` y su view model `gridLevelLadderViewModel.ts` utilizaban `currentRange.id` como identificador del rango activo. Este campo **no existe** en el contrato canónico `GridOperationalViewModel` definido por `buildGridOperationalViewModel.ts`. El campo real es `market.entryRange.activeRangeVersionId`.

Esto provocaba:
- `activeRangeId` siempre `null` en runtime
- Etiqueta "Sin rango activo" incluso con rango vigente
- Filtrado incorrecto de niveles por rango
- Asociación ciclo→rung con fallback por precio incluso cuando `targetRungLevelId` era inválido
- `makerState` mostrando códigos técnicos (`MAKER_PENDING`) como texto operativo principal
- Sin búsqueda independiente para filas históricas

## Solución implementada

### 1. Alineación contractual
- **Eliminado** `currentRange.id` de `OperationalInput`
- **Añadido** `market.entryRange.activeRangeVersionId` como fuente canónica
- `OperationalInput.currentRange` ahora refleja el contrato real (`exists`, `message`, `subtitle`, `lowerPrice`, `centerPrice`, `upperPrice`, `widthPct`)
- Fallback: si no hay UUID explícito, inferir de `rangeVersionId` de niveles current (solo si todos coinciden)

### 2. Filtrado correcto de filas
- Nueva función `filterCurrentLevels<T>()`: filtra por `rangeRelation === "current"` (primario) o por `rangeVersionId === activeRangeId` (fallback)

### 3. Asociación ciclo→rung corregida
- `matchCycleToRung` ahora retorna `{ rung, warning }`
- Cuando `targetRungLevelId` existe pero no coincide: **no cae a precio**, retorna warning
- Fallback por precio solo cuando no hay ID
- Warnings propagados al view model (`RUNG_NOT_FOUND`)

### 4. Humanización de makerState
- Nueva función `humanizeMakerState()`: mapea `MAKER_PENDING` → "SELL maker pendiente", etc.
- Usada en filas sintéticas CYCLE_SELL_TARGET y en CycleExitCard del componente React
- El valor técnico crudo solo aparece en "Detalle técnico"

### 5. Búsqueda histórica separada
- Nueva función `searchHistoricalRows()`: busca por side, status, price, cycleNumber, cycleId, rangeVersionId, rangeRelation
- Input independiente con `aria-label="Buscar en histórico"` en el subview Histórico

### 6. Limpieza frontend
- Eliminado import `ChevronDown` sin uso
- Sin tipos `any` nuevos en código productivo

## Archivos modificados

| Archivo | Cambios |
|---------|---------|
| `client/src/components/grid/gridLevelLadderViewModel.ts` | +118/-37 líneas |
| `client/src/components/grid/GridUnifiedLevelLadder.tsx` | +55/-12 líneas |
| `client/src/components/grid/__tests__/gridLevelLadderViewModel.test.ts` | +193/-12 líneas |
| `client/src/components/grid/__tests__/GridUnifiedLevelLadder.test.tsx` | +140/-25 líneas |

**Total:** 4 archivos, +469/-37 líneas. Cero cambios en server, shared, migrations, Docker, compose, o package files.

## Validaciones ejecutadas

### Tests unitarios (worktree limpio desde origin/review)
- **42 tests view model** — 42/42 PASS
- **32 tests componente** — 32/32 PASS
- **Total: 74/74 PASS**

### Suite completa sin filtros
- **3525 tests pasados**, 30 fallidos (todos pre-existentes en server: telegram, gridAdaptiveSmartRange, gridCompactRange, gridShadowPolicy, gridSpacingCalculator, idcaMarketContextHelpers)
- **FULL_SUITE_NEW_FAILURES=0** — cero fallos nuevos atribuibles a esta corrección

### Build y type-check
- `npm run check` (tsc): PASS
- `npm run build`: PASS (client 2599 módulos, built in 9.14s en VPS)

### Deploy staging
- **PRE_DEPLOY_SHA:** `3d43c836159ddef36610aafb24ad4f01cba0b729`
- **DEPLOY_SOURCE_SHA:** `da6524816970a6fb8c14a8265f3ad4ec6e0fff7f`
- **POST_DEPLOY_SHA:** `da6524816970a6fb8c14a8265f3ad4ec6e0fff7f`
- App container: recreado y running
- DB container: sin cambios (permanece igual)
- `--no-deps` — sin tocar DB

### Validación HTTP
- `GET /` → 200
- `GET /api/grid-isolated/config` → `mode=SHADOW`, `pair=BTC/USD`, `executionPolicy=MAKER_ONLY`
- `GET /api/grid-isolated/status` → `realOpenOrdersCount=0`
- `GET /api/grid-isolated/monitor/audit` → `mode=SHADOW`, `MAKER_ONLY`, "Solo maker (sin taker fallback)", `realOpenOrdersCount=0`, `fatalErrors=0`

### Validación visual (Playwright via túnel SSH)

**Desktop 1440×900 — 20/20 PASS**
**Mobile 390×844 — 20/20 PASS**
**Total: 40/40 PASS — VISUAL_VALIDATION=PASS**

Verificaciones confirmadas:
- 'Escalera del rango actual' visible
- Precio actual marker exactamente una vez
- Botones de filtro (Todos/BUY/SELL) presentes y clicables
- Búsqueda de escalera funcional
- Subview buttons (Escalera actual/Ciclos y salidas/Histórico) presentes
- Subview Ciclos renderiza contenido
- Subview Histórico renderiza contenido
- Búsqueda histórica filtra filas (before=20, after=0 para "81000")
- Mostrar más incrementa filas (20→40)
- No aparece MAKER_PENDING como texto operativo
- Sin warnings de React keys
- Sin errores de consola
- Sin claves duplicadas
- `scrollWidth <= innerWidth` en ambos viewports

## Estado final

- **CLEAN_VERIFY_UI=PASS**
- **FULL_SUITE_NEW_FAILURES=0**
- **VISUAL_VALIDATION=PASS**
- Commit técnico en main, origin/main y rama review: `da6524816970a6fb8c14a8265f3ad4ec6e0fff7f`
- Deploy staging app-only completado y validado

## Pendientes

Ninguno.
