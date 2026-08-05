# AUDITORIA GRID UI ESCALERA UNIFICADA 2026-08-05

## Resumen

Implementación de la vista unificada de escalera para Grid Isolated, reemplazando las vistas separadas de BUY, SELL/rungs y salidas de ciclo por una sola escalera ordenada por precio descendente, con marcador de precio actual, subvistas de ciclos e histórico, filtros y búsqueda.

## Commit técnico

- **SHA**: `3d43c836159ddef36610aafb24ad4f01cba0b729`
- **Parent**: `abe6f90a721c3d509c78990bb9a5af4b5f20caa5`
- **Mensaje**: `feat(grid-ui): unificar escalera y trazabilidad buy-sell`
- **Fast-forward**: Sí, sin merge commit
- **Rama review**: `review/grid-ui-unified-ladder-20260805-153350`

## Archivos nuevos

| Archivo | Descripción |
|---------|-------------|
| `client/src/components/grid/gridLevelLadderViewModel.ts` | Función pura `buildGridLevelLadderViewModel(operational)` que construye la escalera unificada |
| `client/src/components/grid/GridUnifiedLevelLadder.tsx` | Componente React con subvistas Escalera / Ciclos / Histórico, filtros y búsqueda |
| `client/src/components/grid/__tests__/gridLevelLadderViewModel.test.ts` | 30 tests unitarios del view model |
| `client/src/components/grid/__tests__/GridUnifiedLevelLadder.test.tsx` | 20 tests del componente |

## Archivos modificados

| Archivo | Cambio |
|---------|--------|
| `client/src/components/grid/GridLevelsCompactPanel.tsx` | Reemplazo del cuerpo principal por `GridUnifiedLevelLadder`, preservando el header y el diagnostic de niveles |
| `client/src/components/grid/GridLevelsCompactPanel.v3.test.tsx` | Actualización de tests para coincidir con las nuevas etiquetas unificadas |
| `client/src/components/grid/__tests__/gridUxRender.test.tsx` | Actualización del test de filtros para coincidir con las nuevas etiquetas |

## Diseño de la escalera unificada

### Tipos de fila

- **BUY_ENTRY**: Niveles BUY del rango activo. Muestra "Target definitivo: se asignará después de ejecutar el BUY" cuando no hay ciclo asociado.
- **REFERENCE_RUNG**: Rungs SELL de referencia. Marcados como "No ejecutable" cuando no tienen ciclo asociado. Pueden tener múltiples ciclos vinculados.
- **CYCLE_SELL_TARGET**: Target sintético creado cuando un cycleOwnedExit no coincide con ningún rung por ID o precio.

### Ordenación

- Primario: precio descendente (mayor a menor)
- Secundario (desempate): CYCLE_SELL_TARGET > REFERENCE_RUNG > BUY_ENTRY
- Terciario: key alfabético

### Asociación de ciclos

- Por `targetRungLevelId` (prioridad)
- Por `targetSellPrice` con tolerancia ±0.01 cuando no hay ID
- Un rung puede tener múltiples ciclos asociados
- Los ciclos no coincidentes generan filas sintéticas

### Marcador de precio actual

- Se inserta exactamente una vez
- Posición: antes de la primera fila con precio menor al actual
- Si no hay filas menores, se inserta al final
- Si el precio es inválido (null, ≤0, NaN), no se inserta

### Subvistas

1. **Escalera actual**: Vista por defecto con todos los niveles del rango vigente
2. **Ciclos y salidas**: Cards de cycleOwnedExits con detalle económico
3. **Histórico**: Niveles históricos con paginación (20 en 20)

### Filtros

- **Todos**: Muestra todas las filas
- **BUY**: Solo BUY_ENTRY
- **SELL / rungs**: REFERENCE_RUNG + CYCLE_SELL_TARGET
- **Con ciclo**: Filas con linkedCycles o cycleId

### Búsqueda

- Busca en: side, kind, status, statusLabel, price, cycleNumber, cycleId, rangeVersionId, explanation

## Tests

### View model (30 casos)

- Combinación de BUY y SELL
- Ordenación por precio descendente
- No separación en arrays independientes
- Inserción única del marcador de precio
- Posición del marcador (arriba, medio, abajo)
- Precio inválido (sin marcador)
- Exclusión de histórico de la escalera
- Histórico en colección separada
- No emparejamiento por cantidad o índice
- BUY planned con mensaje de target pendiente
- Asociación por targetRungLevelId
- Asociación por targetSellPrice con tolerancia
- No duplicación de rung con ciclo
- Múltiples ciclos en un mismo rung
- Target sintético sin rung coincidente
- Ordenación de target sintético
- Cálculo de notional
- No mutación del input
- Keys estables y únicas
- Datos nulos sin excepción
- Filtrado Todos/BUY/SELL/Con ciclo
- Búsqueda por ciclo y por precio

### Componente (20 casos)

- Vista inicial "Escalera del rango actual"
- BUY y SELL visibles simultáneamente
- No vista exclusiva Entradas BUY
- No vista exclusiva Rungs SELL
- Marcador Precio actual visible
- Orden visual correcto
- BUY sin ciclo con mensaje de target pendiente
- Ciclo abierto visible
- Neto esperado visible
- Rung marcado como no ejecutable
- Histórico separado
- Mostrar más histórico
- Filtros presentes
- Búsqueda presente
- Estado comprensible
- No relación falsa por cantidad
- Múltiples ciclos visibles
- Datos vacíos con mensaje útil
- No clases de ancho fijo
- No errores React por keys duplicadas

## Validaciones

### Local (worktree de desarrollo)

- `npm run check`: ✅ (0 errores)
- `npm run build`: ✅ (client + server)
- `npx vitest run client/src/components/grid/`: ✅ 89/89 tests
- `npx vitest run` (suite completa): 3501 passed, 30 failed (históricos), 29 skipped — 0 new failures
- `git diff --check`: ✅

### Worktree independiente (verificación limpia)

- `npm run check`: ✅
- `npm run build`: ✅
- `npx vitest run client/src/components/grid/`: ✅ 89/89 tests
- `npx vitest run` (suite completa): 3501 passed, 30 failed (históricos), 29 skipped — 0 new failures
- `git diff --name-status HEAD~1 HEAD`: Solo 7 archivos autorizados
- `git diff --check`: ✅

### Deploy staging

- **VPS**: `root@5.250.184.18:/opt/krakenbot-staging`
- **Fast-forward**: `abe6f90` → `3d43c83`
- **Build app**: ✅
- **Deploy app-only**: `docker compose up -d --no-deps krakenbot-staging-app` ✅
- **DB unchanged**: ID y StartedAt idénticos antes/después ✅
- **HTTP**: Root=200, Config=200, Status=200, Audit=200 ✅
- **Operacional**: mode=SHADOW, pair=BTC/USD, realOpenOrdersCount=0, takerFallback=false ✅
- **Runtime logs**: Sin errores, scanning normal ✅
- **JS bundle**: Contiene "Escalera", "PRECIO", "Ladder" ✅
- **API data contract**: entryLevels, referenceRungs, cycleOwnedExits, historicalLevels, currentPrice presentes ✅

## Alcance

- **Solo frontend**: No se modificaron archivos de server, shared, migrations, Docker, package.json ni package-lock.json
- **No backend**: Sin cambios en API, DB, schema, motor ni lifecycle
- **No REAL**: Sin activación de modo real, sin órdenes reales

## Pendientes

- Validación visual interactiva en navegador (desktop 1440x900 y móvil 390x844) — no ejecutable por restricciones de herramientas de browser preview contra IP externa
