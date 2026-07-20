# AUDITORÍA READ-ONLY — EMPAREJAMIENTO BUY → SELL DEL GRID AISLADO

- Fecha: 2026-07-20
- Entorno: staging (`5.250.184.18:3020`)
- Modo: `SHADOW` / `MAKER_ONLY`
- Órdenes reales abiertas: `0`
- Restricción: sin modificaciones de código, configuración, DB, rangos ni ciclos.

## 1. Estado del working tree

Inicio de la auditoría: working tree limpio (sin cambios previos).

Durante la auditoría se crearon únicamente archivos de trabajo en `AUDITORIAS/` (informe y datos temporales). No se modificó ningún archivo del proyecto.

---

## 2. Archivos y funciones revisados

- `server/services/gridIsolated/gridSpacingCalculator.ts`
  - `generateAccumulatedGridLevelsPreview` (l. 967): genera BUY/SELL acumulativos.
  - Fórmula documentada en el propio código:
    - `BUY[0] = centerPrice * (1 - spacingPct/100)`
    - `BUY[i] = BUY[i-1] * (1 - spacingPct/100)`
    - `SELL[0] = centerPrice * (1 + spacingPct/100)`
    - `SELL[i] = SELL[i-1] * (1 + spacingPct/100)`
- `server/services/gridIsolated/gridAllocationEngine.ts`
  - `applyWeightsToGeneratedLevels` (l. 231): asigna capital a BUY y copia la cantidad del BUY emparejado al SELL correspondiente (`sell.quantity = pairedBuy.quantity`).
- `server/services/gridIsolated/gridGeometricLevels.ts`
  - `toGridLevels` (l. 215): convierte niveles generados en persistibles. A los SELL les suma `100` al índice (`levelIndex + 100`).
- `server/services/gridIsolated/gridCycleTargetResolver.ts`
  - `resolveTargetSellForCycle` (l. 39): resuelve el target SELL de un ciclo abierto.
  - Reglas clave: mismo `rangeVersionId`, lado SELL, precio mayor que `cycle.buyPrice`, cantidad igual dentro de `1.5e-8`, y SELL no reclamada por otro ciclo.
- `server/services/gridIsolated/gridIsolatedEngine.ts`
  - `processCycleFill` (l. 1911): crea ciclos en SHADOW cuando un BUY se ejecuta.
  - `processOpenCyclesShadow` (l. 1518): cierra ciclos cuando `bestBid >= targetSellPrice`.
  - `canProcessShadowFill` (l. 1822): valida fills, incluyendo emparejamiento SELL→BUY vía `selectShadowCycleForSell`.
- `server/services/gridIsolated/gridShadowPolicy.ts`
  - `selectShadowCycleForSell` (l. 81): política `FIFO_SAME_RANGE_PROFITABLE`.
- `server/services/gridIsolated/gridNetCalculator.ts`
  - `computeCyclePnLWithRoles` (l. 163): cálculo de PnL usado al cerrar.
- `server/services/gridIsolated/buildGridOperationalViewModel.ts`
  - `computeCycleEstimates` (l. 285): estimaciones mostradas en la UI.

**CORRECCIONES_Y_ACTUALIZACIONES.md no existe.** Fue unificado en `BITACORA.md` según la memoria de proyecto.

---

## 3. Flujo BUY → ciclo → target SELL → cierre

```
1. Generar rango
   ↓  centerPrice, spacingPct, operationalLower/Upper
2. generateAccumulatedGridLevelsPreview
   ↓  BUY[0], BUY[1] … SELL[0], SELL[1] …
3. applyWeightsToGeneratedLevels
   ↓  SELL[i].quantity = paired BUY[i].quantity
4. toGridLevels
   ↓  SELL levelIndex += 100; persistencia en gridIsolatedLevels
5. SHADOW fill de un BUY
   ↓  processCycleFill crea ciclo con buyPrice=fillPrice, quantity=level.quantity
6. Resolver target SELL
   ↓  resolveTargetSellForCycle: primer SELL del mismo rango con quantity≈cycle.quantity
7. Persistir targetSellLevelId / targetSellPrice / targetSellQuantity
8. Cierre SHADOW (processOpenCyclesShadow)
   ↓  cuando bestBid >= targetPrice → cierra el ciclo con el target pre-resuelto
9. En ejecución directa de SELL (processCycleFill SELL)
   ↓  selectShadowCycleForSell: el BUY abierto más antiguo del mismo rango con buyPrice < sellPrice (FIFO)
```

---

## 4. Fórmula real de generación de niveles

A partir del código (`gridSpacingCalculator.ts:959-1039`):

```
BUY[0] = center * (1 - spacing/100)
BUY[1] = BUY[0] * (1 - spacing/100)
SELL[0] = center * (1 + spacing/100)
SELL[1] = SELL[0] * (1 + spacing/100)
```

**Consecuencia directa**: `BUY[1] → SELL[1]` atraviesa `BUY[0]`, el centro y `SELL[0]`. No es un único escalón de Grid.

La asignación de cantidades en `applyWeightsToGeneratedLevels` (l. 296-308) obliga a emparejar `BUY[i]` con `SELL[i]`, porque `SELL[i].quantity = pairedBuy[i].quantity`.

---

## 5. Política de emparejamiento encontrada

**Veredicto parcial: simetría por índice (Hipótesis B).**

- `resolveTargetSellForCycle` no busca el SELL más cercano ni el primero rentable; busca el SELL del **mismo rango** cuya **cantidad coincida** con la del ciclo.
- Como `applyWeightsToGeneratedLevels` copia la cantidad del BUY[i] al SELL[i], la coincidencia de cantidad selecciona el SELL con el mismo índice (simétrico respecto al centro).
- `selectShadowCycleForSell` (cierre en ejecución directa) usa **FIFO por tiempo** dentro del mismo rango (`FIFO_SAME_RANGE_PROFITABLE`). Si hubiera varios BUY abiertos en el mismo rango, un SELL podría cerrar el más antiguo, no necesariamente el que tenía asignado ese target. Actualmente no ocurre porque solo hay un ciclo abierto por rango.

---

## 6. Evidencia exacta del código

### 6.1 SELL quantity = BUY quantity (la clave del emparejamiento)

`@c:\Users\JSLUI\Qsync\BOT_NAS\BOT_AUTOTRADE\server\services\gridIsolated\gridAllocationEngine.ts:296-308`
```ts
for (const sell of sellLevels) {
  const pairedBuy = buyLevels.find(b => b.levelIndex === sell.levelIndex);
  if (pairedBuy && pairedBuy.quantity > 0) {
    sell.notionalUsd = pairedBuy.quantity * sell.price;
    sell.quantity = pairedBuy.quantity; // same BTC quantity as the paired BUY
```

### 6.2 SELL levelIndex offset +100

`@c:\Users\JSLUI\Qsync\BOT_NAS\BOT_AUTOTRADE\server\services\gridIsolated\gridGeometricLevels.ts:222`
```ts
levelIndex: g.side === "BUY" ? g.levelIndex : g.levelIndex + 100, // offset sells
```

### 6.3 Resolver target SELL por coincidencia de cantidad

`@c:\Users\JSLUI\Qsync\BOT_NAS\BOT_AUTOTRADE\server\services\gridIsolated\gridCycleTargetResolver.ts:82-92`
```ts
const candidates = levels.filter(level => {
  if (level.rangeVersionId !== cycle.rangeVersionId) return false;
  if (level.side !== "SELL") return false;
  if (level.price <= cycle.buyPrice!) return false;
  if (alreadyClaimedSellIds.has(level.id)) return false;

  const levelQty = level.quantity;
  const cycleQty = cycle.quantity;
  if (!Number.isFinite(levelQty) || !Number.isFinite(cycleQty)) return false;
  return Math.abs(levelQty - cycleQty) <= QUANTITY_TOLERANCE;
});
```

### 6.4 Cierre SHADOW por target pre-resuelto

`@c:\Users\JSLUI\Qsync\BOT_NAS\BOT_AUTOTRADE\server\services\gridIsolated\gridIsolatedEngine.ts:1576-1625`
```ts
if (!targetLevelId || targetPrice == null || targetQty == null) {
  const resolution = resolveTargetSellForCycle({ ... });
  ...
}
if (bestBid < targetPrice) continue;
```

### 6.5 Emparejamiento FIFO en ejecución directa de SELL

`@c:\Users\JSLUI\Qsync\BOT_NAS\BOT_AUTOTRADE\server\services\gridIsolated\gridShadowPolicy.ts:81-99`
```ts
export function selectShadowCycleForSell({ sellLevel, cycles, activeRangeId }) {
  return cycles
    .filter(cycle =>
      cycle.rangeVersionId === activeRangeId &&
      cycle.status === "buy_filled" &&
      ...
      sellLevel.price > cycle.buyPrice &&
      ...
    )
    .sort((a, b) => cycleTimestamp(a) - cycleTimestamp(b) || a.id.localeCompare(b.id))[0] ?? null;
}
```

---

## 7. Datos runtime (staging, 2026-07-20)

Configuración activa relevante:

| Campo | Valor |
|---|---|
| `mode` | SHADOW |
| `executionPolicy` | MAKER_ONLY |
| `netProfitTargetPct` | 0.5 % |
| `gridStepMinPct` | 0.35 % |
| `gridStepMaxPct` | 2.0 % |
| `gridRangeMaxPct` | 2.5 % |
| `maxDistanceFromCenterPct` | 1.25 % |
| `maxSellDistanceFromNearestBuyPct` | 1.5 % |
| `gridAllocationMode` | progressive |

Endpoints GET consultados:

- `/api/grid-isolated/monitor/audit`
- `/api/grid-isolated/status`
- `/api/grid-isolated/config`

Ciclos analizados (abiertos + cerrados recientes):

| Ciclo | Rango | Estado | BUY ejecutado | SELL objetivo | Distancia bruta % |
|---|---|---|---|---|---|
| 25 | `9bf99770-...` | completed | 63.264,40 | 64.893,12 | +2,57 % |
| 26 | `9bf99770-...` | buy_filled | 62.532,30 | 65.692,20 | +5,05 % |
| 27 | `f14f94d9-...` | completed | 63.826,00 | 65.417,44 | +2,49 % |

---

## 8. Tabla de ciclos

### Ciclo #26 (abierto) — Rango anterior `9bf99770-c40c-4870-a166-4389a51226f0`

| Campo | Valor |
|---|---|
| BUY planificado | 62.534,78 |
| BUY ejecutado | 62.532,30 |
| BUY index | 1 |
| SELL objetivo | 65.692,20 |
| SELL index | 101 |
| Distancia total % | +5,05 % |
| Spacing consecutivo % | ~1,247 % |
| Niveles atravesados | 3 (BUY index 1, BUY index 0, SELL index 100) |
| Centro del rango | ~64.098,91 |
| Siguiente nivel superior | BUY index 1 @ 62.534,78 |
| Primer SELL superior | SELL index 100 @ 64.893,12 |
| Beneficio neto siguiente nivel* | -0,36 % (no es SELL) |
| Beneficio neto primer SELL | +3,02 % |
| Beneficio neto target actual | +4,04 % (real) / +3,67 % (UI) |
| Regla detectada | Simetría por índice (Hipótesis B) |
| Veredicto | **Correcto según diseño, pero no es Grid de rotación corta** |

\* Beneficio neto calculado con fee maker 0 %, reserva fiscal 20 % sobre neto.

### Ciclo #27 (cerrado) — Rango vigente `f14f94d9-eb8d-44b8-8f8f-02ebf0fab621`

| Campo | Valor |
|---|---|
| BUY planificado | 63.854,36 |
| BUY ejecutado | 63.826,00 |
| BUY index | 0 |
| SELL objetivo | 65.417,44 |
| SELL index | 100 |
| Distancia total % | +2,49 % |
| Spacing consecutivo % | ~1,224 % |
| Niveles atravesados | 1 (BUY index 1) |
| Centro del rango | ~64.631,17 |
| Siguiente nivel superior | BUY index 0 @ 63.854,36 |
| Primer SELL superior | SELL index 100 @ 65.417,44 |
| Beneficio neto siguiente nivel* | -0,32 % (no es SELL) |
| Beneficio neto primer SELL | +1,99 % |
| Beneficio neto target actual | +1,99 % (real) / +1,63 % (UI) |
| Regla detectada | Simetría por índice (Hipótesis B) |
| Veredicto | **Correcto según diseño; aquí el primer SELL es el propio target** |

### Ciclo #25 (cerrado) — Rango anterior `9bf99770-...`

| Campo | Valor |
|---|---|
| BUY planificado | 63.314,42 |
| BUY ejecutado | 63.264,40 |
| BUY index | 0 |
| SELL objetivo | 64.893,12 |
| SELL index | 100 |
| Distancia total % | +2,57 % |
| Niveles atravesados | 1 (BUY index 1) |
| Beneficio neto primer SELL | +2,06 % |
| Beneficio neto target actual | +2,06 % (real) / +1,69 % (UI) |
| Regla detectada | Simetría por índice |
| Veredicto | **Correcto según diseño** |

---

## 9. Número de niveles atravesados por cada ciclo

Representación textual del ciclo #26:

```
BUY ejecutado @ 62.532,30  (BUY index 1)
   → BUY index 1 @ 62.534,78
   → BUY index 0 @ 63.314,42
   → centro ~64.098,91
   → SELL index 100 @ 64.893,12
   → SELL objetivo @ 65.692,20  (SELL index 101)
```

- Entre BUY index 1 y SELL index 101 hay **3 niveles intermedios**.
- El primer SELL rentable (SELL index 100) estaría a **2 niveles** de distancia.
- El sistema ignora SELL index 100 para el ciclo #26 porque su cantidad (0,00379061) no coincide con la cantidad del BUY index 1 (0,00383786).

---

## 10. Rentabilidad del siguiente nivel, primer SELL y target actual

Ciclo #26:

| Escenario | Precio de venta | Beneficio neto % real |
|---|---|---|
| Nivel inmediatamente superior (BUY) | 62.534,78 | -0,36 % |
| Primer SELL superior | 64.893,12 | +3,02 % |
| Target actual (SELL index 101) | 65.692,20 | +4,04 % |

Ciclo #27:

| Escenario | Precio de venta | Beneficio neto % real |
|---|---|---|
| Nivel inmediatamente superior (BUY) | 63.854,36 | -0,32 % |
| Primer SELL superior / target actual | 65.417,44 | +1,99 % |

**Observación**: en todos los casos el primer SELL superior ya cumple ampliamente el objetivo neto mínimo configurado (0,5 %). El target actual siempre es igual o más lejano.

---

## 11. Resultado de la auditoría SHADOW

- `mode=SHADOW`, `executionPolicy=MAKER_ONLY`, `realOpenOrdersCount=0` en todo momento.
- El BUY ejecutado (p. ej. 63.826,00 en ciclo #27) es **menor** que el BUY planificado (63.854,36). Esto indica que el fill se simula al precio de mercado que cruzó el nivel, no al precio límite del nivel.
- La cantidad del ciclo coincide con la del nivel BUY planificado (0,00608327), no se recalcula con el precio de ejecución.
- El cierre usa el `targetSellPrice` pre-resuelto; no se recalcula sobre la marcha.

---

## 12. Riesgo de ejecuciones múltiples en un tick

`canProcessShadowFill` (`gridIsolatedEngine.ts:1817`) tiene protecciones:

- `existingCycleForBuy`: evita duplicar un ciclo para el mismo BUY level.
- `maxOpenCycles`: limita ciclos abiertos del rango activo.
- `getCrossedShadowLevels` (`gridShadowPolicy.ts:31`) ordena los niveles cruzados según distancia al precio de ejecución.

Sin embargo, si un salto de precio ejecuta varios BUY de **diferentes niveles** en el mismo tick, se crearán varios ciclos. Cada uno recibirá su propio `targetSellLevelId` por coincidencia de cantidad, pero el **cierre futuro** usa FIFO por tiempo si se ejecuta un SELL directo. Esto puede desajustar el emparejamiento predefinido cuando hay más de un ciclo abierto en el mismo rango.

Actualmente hay un solo ciclo abierto, por tanto el riesgo no se manifiesta.

---

## 13. Riesgo de FIFO o mezcla de ciclos

- `resolveTargetSellForCycle` respeta el `rangeVersionId`; nunca mezcla rangos. Está verificado en los tests (`gridCycleTargetResolver.test.ts`).
- `selectShadowCycleForSell` tampoco mezcla rangos (`cycle.rangeVersionId === activeRangeId`).
- El riesgo potencial es intra-rango: si hay varios BUY abiertos y se ejecuta un SELL, el más antiguo se cierra primero, aunque el SELL ejecutado sea el target de otro ciclo.
- El cierre periódico `processOpenCyclesShadow` (que usa `targetSellLevelId`) y el cierre por ejecución directa de SELL (que usa FIFO) tienen lógicas distintas. Esto es una inconsistencia de diseño.

---

## 14. Cobertura de tests existentes

Tests ejecutados (read-only):

```bash
npx vitest run server/services/gridIsolated --reporter=dot
```

Resultado: **7 files, 107 tests passed**.

Archivos relevantes:

- `gridCycleTargetResolver.test.ts` (11 tests)
  - Cubre resolución por cantidad, rango histórico, no mezcla de rangos, SELL ya reclamada, quantity fuera de tolerancia.
  - **No cubre**: emparejamiento adyacente, primer SELL rentable, política FIFO de cierre.
- `gridOpenCycleShadowClose.test.ts`
  - Cubre cierre transaccional, estados, target incorrecto, rollback, resolución faltante.
  - **No cubre**: dos ciclos abiertos en mismo rango + FIFO, cierre de SELL que no es el target preasignado.
- `buildGridOperationalViewModel.test.ts`
  - Cubre vista UX con rangos anteriores y ciclos 25/26.
  - **No cubre**: cálculo de alternativas de target.

---

## 15. Tests ausentes que deberían añadirse si se autoriza cambio

1. `BUY[i]` debe asociarse a `SELL[i]` por simetría.
2. `BUY[i]` **no** debe asociarse a `SELL[i-1]` si el primero rentable está más cerca.
3. Con dos ciclos abiertos en mismo rango, un SELL directo cierra el más antiguo (FIFO) o el pre-asignado.
4. El primer SELL superior cumple `netProfitTargetPct`.
5. Simulación de múltiples fills en mismo tick: cada ciclo mantiene su target.
6. Cambiar de rango activo no invalida `targetSellLevelId` de ciclos históricos.

---

## 16. Veredicto único

**B. CORRECTO SEGÚN POLÍTICA SIMÉTRICA, PERO NO ES GRID DE ROTACIÓN CORTA.**

No hay bug técnico de emparejamiento: el sistema asigna consistentemente `BUY[i] → SELL[i]` mediante coincidencia de cantidad, que es el resultado de copiar `pairedBuy.quantity` al SELL en la generación. La distancia aparentemente anómala del ciclo #26 (+5,05 %) es consecuencia del diseño acumulativo de niveles: un BUY profundo (index 1) debe cruzar el centro y el SELL[0] para llegar a SELL[1].

Sin embargo, el diseño tiene **efectos operativos negativos**:

- Inmoviliza capital más tiempo.
- Reduce la rotación del Grid.
- El primer SELL superior ya es rentable y está más cerca, pero se ignora por política.
- Hay una inconsistencia entre la resolución de target (por cantidad/simétrica) y el cierre por ejecución directa de SELL (FIFO por tiempo) cuando existen múltiples ciclos abiertos en un rango.

---

## 17. Propuesta concreta (sin implementar)

**Opción recomendada: 2 — Primer nivel superior rentable.**

Para ciclos futuros, cambiar `resolveTargetSellForCycle` para que, en lugar de buscar coincidencia de cantidad, recorra los SELL del mismo rango ordenados de menor a mayor precio y seleccione el primero que, usando el PnL real configurado, cumpla:

```
estimatedNetPnlPct >= netProfitTargetPct
```

Además:

1. Asegurar que el cierre (`selectShadowCycleForSell` / `processOpenCyclesShadow`) use el mismo criterio: cerrar el ciclo cuyo `targetSellLevelId` coincida con el SELL ejecutado, no el más antiguo por FIFO.
2. Si ningún SELL del rango cumple la rentabilidad mínima, declarar el rango no viable o reducir niveles, en lugar de emparejar a un SELL lejano sin advertencia.
3. Mantener ciclos ya abiertos con sus targets actuales; aplicar la nueva política solo a ciclos creados tras el cambio.

**Impacto estimado:**

| Ciclo | Target actual | Target primer SELL rentable | Reducción distancia % | Diferencia neto % |
|---|---|---|---|---|
| #26 | 65.692,20 | 64.893,12 | -1,46 pp | -1,02 pp |
| #27 | 65.417,44 | 65.417,44 | 0 pp | 0 pp |
| #25 | 64.893,12 | 64.893,12 | 0 pp | 0 pp |

El ciclo #26 es el único que se beneficiaría, pasando de un objetivo a 5,05 % a uno a 3,59 % (distancia bruta) con beneficio neto aún positivo (+3,02 % real).

---

## 18. Confirmación de cero cambios

Al finalizar la auditoría:

- No se modificó ningún archivo del proyecto.
- No se ejecutó commit.
- No se ejecutó push.
- No se ejecutó deploy.
- No se ejecutó POST / PUT / PATCH / DELETE / SQL manual.
- No se generó ningún rango, nivel, ciclo u orden.
- Staging sigue en `SHADOW` / `MAKER_ONLY` con `realOpenOrdersCount=0`.

Archivos creados únicamente para el informe (bajo `AUDITORIAS/`) y temporales (`tmp_runtime/`) que deben eliminarse si el usuario lo desea.

```
Resultado del control final: ningún archivo modificado del repositorio.
```

---

**Esperando aprobación expresa antes de implementar cualquier corrección.**
