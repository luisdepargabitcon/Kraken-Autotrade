# CONTRAUDITORÍA READ-ONLY — GRID ADYACENTE

- Fecha: 2026-07-21
- Entorno: staging (`5.250.184.18:3020`)
- Modo: `SHADOW` / `MAKER_ONLY`
- Restricción: sin modificaciones de código, configuración, DB, rangos, niveles ni ciclos.

---

## 1. Control inicial del working tree

```bash
git status --short
# ?? AUDITORIAS/

git diff --stat
# (vacío)

git diff --name-status
# (vacío)
```

Únicamente existe la carpeta no trackeada `AUDITORIAS/` con el informe previo. No hay cambios en archivos rastreados.

---

## 2. Corrección del informe anterior sobre "siguiente nivel superior"

### 2.1 Error detectado

En `AUDITORIAS/AUDITORIA_GRID_BUY_SELL_2026-07-20.md`, sección 8 (Ciclo #26), aparecía:

> Siguiente nivel superior: BUY index 1 @ 62.534,78

Ese valor **no es el siguiente escalón superior al BUY ejecutado**; es el **propio nivel BUY de origen** (BUY[1] planificado). El siguiente escalón geométrico superior es:

```
BUY[0] @ 63.314,42 USD
```

### 2.2 Causa

Fue un **error de presentación/cálculo auxiliar**, no del modelo conceptual:

- El script auxiliar ordenó los niveles por precio y aplicó `price > buyFill`.
- Como el `buyFill` real (62.532,30) es ligeramente inferior al BUY planificado (62.534,78), el algoritmo devolvió el BUY planificado como "siguiente nivel superior" en lugar de filtrar niveles estrictamente superiores al propio escalón de entrada.
- El informe no diferenció entre:
  - **nivel de entrada** (BUY[1]);
  - **siguiente escalón geométrico** (BUY[0]);
  - **primer SELL persistido** (SELL[0]);
  - **SELL simétrico** (SELL[1]).

### 2.3 Rejilla real ordenada por precio — Rango `9bf99770-c40c-4870-a166-4389a51226f0`

| RUNG | Side persistido | levelIndex | Precio USD | Descripción |
|---|---|---|---|---|
| 0 | BUY | 1 | 62.534,78 | BUY[1] = nivel de entrada del ciclo #26 |
| 1 | BUY | 0 | 63.314,42 | **Siguiente escalón geométrico superior** |
| 2 | — | — | 64.098,91 | Centro (referencia, no es fila persistida) |
| 3 | SELL | 100 | 64.893,12 | Primer SELL persistido |
| 4 | SELL | 101 | 65.692,20 | SELL simétrico = target actual del ciclo #26 |

### 2.4 Rejilla real ordenada por precio — Rango `f14f94d9-eb8d-44b8-8f8f-02ebf0fab621`

| RUNG | Side persistido | levelIndex | Precio USD | Descripción |
|---|---|---|---|---|
| 0 | BUY | 0 | 63.854,36 | BUY[0] = nivel de entrada del ciclo #27 |
| 1 | — | — | 64.631,17 | Centro |
| 2 | SELL | 100 | 65.417,44 | Primer SELL persistido y target actual |

### 2.5 Rejilla real ordenada por precio — Rango `9bf99770-...` (ciclo #25)

| RUNG | Side persistido | levelIndex | Precio USD | Descripción |
|---|---|---|---|---|
| 0 | BUY | 1 | 62.534,78 | BUY[1] |
| 1 | BUY | 0 | 63.314,42 | BUY[0] = nivel de entrada del ciclo #25 |
| 2 | — | — | 64.098,91 | Centro |
| 3 | SELL | 100 | 64.893,12 | Primer SELL persistido y target actual |

---

## 3. Cálculo exacto del escalón adyacente para el ciclo #26

### 3.1 Datos del ciclo

| Campo | Valor |
|---|---|
| BUY fill | 62.532,30 USD |
| BUY planificado | 62.534,78 USD |
| Quantity | 0,00383786 BTC |
| Escalón adyacente (RUNG 1) | 63.314,42 USD |
| Primer SELL persistido (RUNG 3) | 64.893,12 USD |
| Target simétrico actual (RUNG 4) | 65.692,20 USD |
| `netProfitTargetPct` | 0,5 % |
| Política de fee | MAKER_ONLY (0 % fee) |
| Reserva fiscal | 20 % del neto antes de reserva |

### 3.2 Fórmula canónica utilizada

Función `computeCyclePnLWithRoles` (`@c:\Users\JSLUI\Qsync\BOT_NAS\BOT_AUTOTRADE\server\services\gridIsolated\gridNetCalculator.ts:163-211`):

```ts
buyNotional  = buyPrice * quantity
sellNotional = sellPrice * quantity
grossPnlUsd  = sellNotional - buyNotional
totalFeesUsd = buyFeeUsd + sellFeeUsd        // 0 en SHADOW maker/maker
netBeforeTaxUsd = grossPnlUsd - totalFeesUsd
taxReserveUsd   = netBeforeTaxUsd > 0 ? netBeforeTaxUsd * 0.20 : 0
netPnlUsd       = netBeforeTaxUsd - taxReserveUsd
netPnlPct       = netPnlUsd / buyNotional * 100
```

### 3.3 Cálculo para RUNG 1 — 63.314,42 USD

```
buyNotional  = 62.532,30 * 0,00383786 = 239,990212878 USD
sellNotional = 63.314,41750845 * 0,00383786 = 242,991870379 USD
grossPnlUsd  = 242,991870379 - 239,990212878 = 3,001657501 USD
buyFeeUsd    = 0
sellFeeUsd   = 0
totalFeesUsd = 0
netBeforeTaxUsd = 3,001657501 USD
taxReserveUsd   = 3,001657501 * 0,20 = 0,600331500 USD
netPnlUsd       = 3,001657501 - 0,600331500 = 2,401326001 USD
actualPriceGapPct = (63.314,41750845 - 62.532,30) / 62.532,30 * 100 = 1,250741630 %
netPnlPct       = 2,401326001 / 239,990212878 * 100 = 1,000593304 %
```

### 3.4 Respuesta a la pregunta principal de rentabilidad

**¿La salida adyacente en 63.314,42 USD habría cumplido el objetivo neto mínimo configurado del 0,5 % después de todos los costes conservadores reales?**

**SÍ, CUMPLE.**

- Net PnL % real: **1,0006 %**.
- Beneficio neto operativo (antes de reserva): **3,0017 USD**.
- Reserva fiscal (20 %): **0,6003 USD**.
- Beneficio disponible después de reserva: **2,4013 USD**.
- La distancia bruta es **1,2507 %**, pero tras reserva fiscal el beneficio neto queda en **1,0006 %**, superior al 0,5 % requerido.

---

## 4. Comparación de las cuatro políticas

### 4.1 Ciclo #26 (BUY fill 62.532,30)

| Política | Target | Distancia bruta % | Neto antes reserva USD | Reserva fiscal USD | Neto disponible USD | Net PnL % | Cumple 0,5 % |
|---|---|---|---|---|---|---|---|
| **A — SELL simétrico** | 65.692,20 | +5,0532 % | 12,1272 | 2,4254 | 9,7018 | 4,0426 % | SÍ |
| **B — Primer SELL persistido** | 64.893,12 | +3,7754 % | 9,0605 | 1,8121 | 7,2484 | 3,0203 % | SÍ |
| **C — Siguiente escalón geométrico** | 63.314,42 | +1,2507 % | 3,0017 | 0,6003 | 2,4013 | 1,0006 % | SÍ |
| **D — Primer escalón rentable** | 63.314,42 | +1,2507 % | 3,0017 | 0,6003 | 2,4013 | 1,0006 % | SÍ |

**Escalones atravesados por política:**

- A: 4 rungs (BUY[1] → BUY[0] → centro → SELL[0] → SELL[1]).
- B: 2 rungs (BUY[1] → BUY[0] → SELL[0]).
- C / D: 1 rung (BUY[1] → BUY[0]).

### 4.2 Ciclo #27 (BUY fill 63.826,00)

| Política | Target | Distancia bruta % | Net PnL % | Cumple 0,5 % |
|---|---|---|---|---|
| A | 65.417,44 | +2,4934 % | 1,9947 % | SÍ |
| B | 65.417,44 | +2,4934 % | 1,9947 % | SÍ |
| C | 63.854,36 | +0,0444 % | 0,0355 % | **NO** |
| D | 65.417,44 | +2,4934 % | 1,9947 % | SÍ |

### 4.3 Ciclo #25 (BUY fill 63.264,40)

| Política | Target | Distancia bruta % | Net PnL % | Cumple 0,5 % |
|---|---|---|---|---|
| A | 64.893,12 | +2,5745 % | 2,0596 % | SÍ |
| B | 64.893,12 | +2,5745 % | 2,0596 % | SÍ |
| C | 63.314,42 | +0,0791 % | 0,0632 % | **NO** |
| D | 64.893,12 | +2,5745 % | 2,0596 % | SÍ |

### 4.4 Interpretación

- La política C pura (siguiente escalón sin importar rentabilidad) **no siempre cumple** el objetivo neto mínimo.
- La política D (primer escalón superior rentable) **siempre cumple** y, para el ciclo #26, coincide con el escalón adyacente.
- La política B coincide con D para los ciclos #25 y #27 porque el primer SELL persistido es el primer escalón rentable.
- Para el ciclo #26, D supera a B al usar el escalón BUY[0] como salida, reduciendo la distancia en ~2,52 pp y el capital inmovilizado.

---

## 5. Análisis arquitectónico: etiquetas BUY/SELL estáticas

### 5.1 Evidencia del código

`resolveTargetSellForCycle` filtra explícitamente por `side === "SELL"` (`@c:\Users\JSLUI\Qsync\BOT_NAS\BOT_AUTOTRADE\server\services\gridIsolated\gridCycleTargetResolver.ts:84`):

```ts
if (level.side !== "SELL") return false;
```

`processOpenCyclesShadow` actualiza una fila `gridIsolatedLevels` exigiendo `side === "SELL"` (`@c:\Users\JSLUI\Qsync\BOT_NAS\BOT_AUTOTRADE\server\services\gridIsolated\gridIsolatedEngine.ts:1683-1687`):

```ts
.where(and(
  eq(gridIsolatedLevels.id, targetLevelId),
  eq(gridIsolatedLevels.rangeVersionId, cycle.rangeVersionId),
  eq(gridIsolatedLevels.side, "SELL"),
  isNull(gridIsolatedLevels.filledAt)
))
```

### 5.2 Confusión entre escalón geométrico y lado de orden

En un Grid continuo profesional:

- Un **precio de escalón** es una referencia geométrica.
- El **lado de la orden** depende del estado del ciclo:
  - Si el precio está por debajo del precio de mercado y no hay posición, es un **BUY**.
  - Una vez ejecutado un BUY inferior, ese mismo precio de escalón puede convertirse en objetivo **SELL** para ese ciclo.
  - Tras vender, el mismo precio puede volver a ser BUY para un nuevo ciclo.

La arquitectura actual **mezcla** ambos conceptos en una sola fila `gridIsolatedLevels` con `side` inmutable. Por eso:

- No puede usar `BUY[0]` (63.314,42) como target SELL del ciclo #26 sin alterar o duplicar la fila.
- No puede existir simultáneamente un BUY y un SELL en el mismo precio.
- La cantidad de un SELL está atada al BUY emparejado (`applyWeightsToGeneratedLevels`), lo que impide que dos ciclos compartan un precio objetivo.

### 5.3 Consecuencia directa

La política C pura (siguiente escalón geométrico sin importar etiqueta) **no es implementable** tal cual. Requiere una de estas opciones:

1. **Obligación SELL sintética por ciclo**: almacenar `targetSellPrice`/`targetSellQuantity` sin `targetSellLevelId` (o con `targetSellLevelId` apuntando a un BUY level bajo una semántica extendida).
2. **Duplicar filas**: crear una fila SELL adicional en el mismo precio cuando un BUY se ejecuta.
3. **Refactorizar a niveles dinámicos**: separar tabla de `gridRungPrices` (geometría) de `gridRungOrders` (órdenes activas por ciclo).

---

## 6. Obligaciones SELL por ciclo

### 6.1 Regla de oro auditada

> 1 BUY → 1 obligación SELL por la misma cantidad.

El ciclo ya cumple parcialmente esta regla:

- `GridCycle.quantity` = cantidad comprada.
- `GridCycle.targetSellQuantity` = cantidad objetivo de venta.
- En SHADOW, el cierre por `processOpenCyclesShadow` cierra exactamente esa cantidad.

### 6.2 Reserva de cantidad

Actualmente la "reserva" es indirecta: `targetSellLevelId` apunta a una fila SELL que, una vez completada, pasa a `filled`. No hay un pool de inventario compartido; cada ciclo es aislado (`gridIsolated`).

Si se implementan targets sintéticos, la reserva debe hacerse **a nivel de ciclo**:

- `targetSellQuantity = cycle.quantity`.
- Ningún otro ciclo puede usar esa misma obligación.
- Si dos ciclos terminan con el mismo `targetSellPrice`, deben existir dos obligaciones SELL separadas (aunque se agrupen en una orden agregada para el exchange).

### 6.3 Prohibición de vender HOLD

El motor nunca vende saldo HOLD. Solo cierra ciclos creados por fills de BUY. El cálculo de PnL y la cantidad cerrada se limitan a `cycle.quantity` (`@c:\Users\JSLUI\Qsync\BOT_NAS\BOT_AUTOTRADE\server\services\gridIsolated\gridIsolatedEngine.ts:1633-1642`).

---

## 7. Riesgo FIFO

### 7.1 Inconsistencia confirmada

- `processOpenCyclesShadow` cierra por **target explícito** (`targetSellLevelId` / `targetSellPrice`).
- `processCycleFill` para SELL (`level.side === "SELL"`) usa `selectShadowCycleForSell`, que selecciona el ciclo **más antiguo** del mismo rango cuyo `buyPrice < sellPrice` (`@c:\Users\JSLUI\Qsync\BOT_NAS\BOT_AUTOTRADE\server\services\gridIsolated\gridShadowPolicy.ts:81-99`).

### 7.2 Simulación pura — Caso 1

- Rango activo con SELL[0] @ 64.893 y SELL[1] @ 65.692.
- Ciclo A (más antiguo) target SELL[0] @ 64.893.
- Ciclo B target SELL[1] @ 65.692.
- El precio cruza SELL[1] primero (bid >= 65.692) sin haber cruzado SELL[0].

**Comportamiento actual con SELL directo:** `processCycleFill` recibe `level = SELL[1]`. `selectShadowCycleForSell` devuelve el ciclo A (más antiguo) porque su `buyPrice < 65.692`. El ciclo A se cerraría en 65.692 con un PnL mayor del esperado, y el ciclo B quedaría sin su target.

**Comportamiento esperado:** cerrar el ciclo B, cuyo target explícito es SELL[1].

### 7.3 Simulación pura — Caso 2

- Dos ciclos A y B con el **mismo target price** pero cantidades diferentes.
- Actualmente `resolveTargetSellForCycle` rechaza si hay más de una SELL compatible. Si se permitiera, habría colisión.

**Comportamiento esperado:** cada ciclo conserva su propia obligación SELL; si se agrega, el exchange recibe una orden agregada con asignación interna determinista.

### 7.4 Simulación pura — Caso 3

- Un salto de precio ejecuta BUY[0] y BUY[1] en el mismo tick.
- `canProcessShadowFill` evita duplicar el mismo BUY level, pero permite crear ciclos distintos.
- Cada ciclo recibe su target por coincidencia de cantidad.
- Futuro cierre por SELL directo podría mezclarlos si se ejecuta un SELL no asignado.

**Conclusión:** la discrepancia target-explícito vs FIFO debe eliminarse. El cierre siempre debe respetar el target pre-resuelto del ciclo.

---

## 8. Compatibilidad con maker-only

- SHADOW fuerza `MAKER_ONLY` y 0 % de fee (`gridNetCalculator.ts:163-211`).
- La política D no requiere taker fallback: el target es un precio límite en el siguiente escalón.
- En modo real, la orden SELL se colocaría como maker en `targetSellPrice`.
- No hay cambio en la política de ejecución.

---

## 9. Compatibilidad con ciclos históricos

- Los ciclos existentes (#25, #26, #27) deben conservar su `targetSellLevelId`, `targetSellPrice` y `targetSellQuantity`.
- La nueva política debe aplicarse **solo a ciclos creados después del cambio**.
- `GridCycle` no tiene un campo de versión de política; para una implementación limpia se debería añadir `pairingPolicyVersion` o similar.

---

## 10. Tests necesarios para futura implementación

1. Identificar el siguiente escalón geométrico superior a un BUY fill.
2. No rechazar un target solo porque el lado persistido sea BUY.
3. Seleccionar el primer escalón superior rentable (D).
4. Rechazar el escalón adyacente si no cubre costes (C sin D).
5. Usar el BUY fill real en el cálculo de rentabilidad.
6. Mantener `quantity` exacta del ciclo en la obligación SELL.
7. No vender saldo HOLD.
8. No mezclar cantidades entre ciclos.
9. No mezclar rangos.
10. Dos ciclos con targets de precio diferentes.
11. Dos ciclos con el mismo precio target pero cantidades separadas.
12. Varios BUY cruzados en un mismo tick.
13. SELL directo cierra el ciclo cuyo target coincide, no FIFO.
14. Cambio de rango activo no invalida targets de ciclos históricos.
15. Ciclos legacy conservan política simétrica.
16. Ciclos nuevos usan política D.
17. Maker-only permanece activo.
18. Taker fallback permanece desactivado.
19. SHADOW sin órdenes reales.
20. Idempotencia del cierre.

---

## 11. Veredicto único

**C. CAMBIAR AL SIGUIENTE ESCALÓN RENTABLE (Política D para la selección, con obligación SELL por ciclo).**

**Justificación:**

- La salida adyacente de 63.314,42 USD para el ciclo #26 **sí cumple** el objetivo neto mínimo del 0,5 % (neto real 1,0006 %).
- El motor actual no puede implementar C puro porque `targetSellLevelId` debe apuntar a una fila `side=SELL`.
- La solución mínima viable es permitir **obligaciones SELL sintéticas por ciclo** (`targetSellPrice`/`targetSellQuantity` sin depender exclusivamente de una fila SELL), lo que permite usar el siguiente escalón rentable aunque esté etiquetado como BUY.
- Para ciclos #25 y #27, el siguiente escalón no es rentable, por lo que D selecciona el primer SELL persistido, igual que B.
- Esto aumenta la rotación, mantiene el beneficio neto, reduce capital inmovilizado y preserva maker-only.
- La opción D (refactor a niveles dinámicos) es arquitectónicamente más limpia, pero es un cambio mayor. La política C con obligaciones por ciclo es el paso intermedio correcto.

---

## 12. Plan de implementación (sin ejecutar)

### 12.1 Funciones a modificar

1. `server/services/gridIsolated/gridCycleTargetResolver.ts`
   - Añadir política `NEXT_PROFITABLE_RUNG`.
   - Recorrer todos los escalones geométricos superiores ordenados por precio.
   - Seleccionar el primero cuyo `netPnlPct` (usando `computeCyclePnLWithRoles`) >= `netProfitTargetPct`.
   - Permitir que `targetSellLevelId` sea `null` cuando el escalón seleccionado no sea una fila SELL persistida.
   - Añadir campo `pairingPolicyVersion` a `TargetSellResolution`.

2. `server/services/gridIsolated/gridIsolatedEngine.ts`
   - `processCycleFill` para SELL: cerrar el ciclo cuyo `targetSellLevelId`/`targetSellPrice` coincida con el SELL ejecutado, en lugar de `selectShadowCycleForSell` FIFO.
   - `processOpenCyclesShadow`: ya usa `targetSellPrice`; mantener. Ajustar para targets sintéticos sin fila SELL.
   - `canProcessShadowFill`: eliminar/ajustar el emparejamiento FIFO para SELL.

3. `server/services/gridIsolated/gridShadowPolicy.ts`
   - Deprecar `selectShadowCycleForSell` o restringirlo a casos sin target explícito.

4. `server/services/gridIsolated/gridIsolatedTypes.ts`
   - Añadir `pairingPolicyVersion?: string` a `GridCycle`.
   - Añadir tipo `GridPairingPolicy = "symmetric" | "next_profitable_rung"`.

5. `server/services/gridIsolated/buildGridOperationalViewModel.ts`
   - Mostrar `targetSellLevelId` nulo como "objetivo sintético".
   - Calcular distancia al siguiente escalón rentable.

### 12.2 Tipos a modificar

- `GridCycle`: añadir `pairingPolicyVersion?: string`.
- `TargetSellResolution`: añadir `policyVersion`, `targetIsSynthetic?: boolean`.

### 12.3 Migración

- **Opción A (con migración)**: añadir columna `pairing_policy_version` a `gridIsolatedCycles`. Los ciclos existentes se dejan en `symmetric`; los nuevos usan `next_profitable_rung`.
- **Opción B (sin migración)**: inferir la política de los ciclos existentes por `targetSellLevelId IS NOT NULL` y asumir `symmetric`; los nuevos con `targetSellLevelId` nulo usan `next_profitable_rung`. Más frágil.

**Recomendación:** Opción A con migración pequeña.

### 12.4 Compatibilidad con ciclos legacy

- Ciclos con `pairingPolicyVersion = "symmetric"` mantienen `resolveTargetSellForCycle` actual.
- Ciclos nuevos usan la nueva función.
- Nunca se recalculan targets de ciclos abiertos existentes.

### 12.5 Cierre por target explícito

- En `processCycleFill` SELL, buscar el ciclo cuyo `targetSellLevelId === level.id` o cuyo `targetSellPrice` coincida (dentro de tolerancia) y que pertenezca al mismo rango.
- Si no hay target explícito, fallback a FIFO solo para ciclos legacy.

### 12.6 Reserva de cantidad

- La cantidad se reserva por ciclo, no por nivel.
- Si dos ciclos apuntan al mismo precio, se crean dos obligaciones.
- En modo real, se puede agregar órdenes en el mismo precio o usar una orden agregada con asignación interna.

### 12.7 Tests

- Añadir tests en `gridCycleTargetResolver.test.ts` para política D.
- Añadir tests en `gridOpenCycleShadowClose.test.ts` para cierre por target explícito.
- Añadir tests en `gridIsolatedEngine.test.ts` para múltiples ciclos y FIFO.

### 12.8 Riesgos

- Cambio en el comportamiento de cierre para SELL directo.
- Posible colisión si varios ciclos apuntan al mismo precio sintético.
- UX debe mostrar claramente "target sintético".

### 12.9 Rollback

- Cambiar el default de `pairingPolicyVersion` a `"symmetric"` para nuevos ciclos.
- Restaurar `selectShadowCycleForSell` si es necesario.

---

## 13. Confirmación de cero cambios

Al finalizar esta contraauditoría:

- No se modificó ningún archivo del proyecto.
- No se ejecutó commit.
- No se ejecutó push.
- No se ejecutó deploy.
- No se ejecutó POST / PUT / PATCH / DELETE / SQL manual.
- No se generó ningún rango, nivel, ciclo u orden.
- Staging sigue en `SHADOW` / `MAKER_ONLY` con `realOpenOrdersCount=0`.

```bash
git status --short
# ?? AUDITORIAS/

git diff --stat
# (vacío)

git diff --name-status
# (vacío)
```

Archivos temporales creados bajo `AUDITORIAS/tmp_runtime/` serán eliminados tras la validación final.

---

**Esperando aprobación expresa antes de implementar cualquier corrección.**
