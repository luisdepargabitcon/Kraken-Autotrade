# BITÁCORA — WINDSURF CHESTER BOT

> Documentación técnica y operativa unificada. Solo describe cómo funciona **ahora**.
> Última actualización: 2026-07-08

---

## 2026-07-08 — FASE 3C-PRE ATR REAL Y SIMULACIÓN CON CANDLES REALES

### Resumen
Recálculo de ATR con velas reales de Kraken para 15m, 1h y 4h. Se confirma que con configuración actual (Bollinger 2σ) **no cabe ni un solo nivel rentable** en ningún timeframe ni center price. El problema es estructural: la banda es incompatible con el spacing mínimo rentable. **No se implementó ninguna fórmula nueva.**

### Script auxiliar
- **Archivo**: `scripts/grid_spacing_phase3c_pre_real_atr.ts`
- **Naturaleza**: Script auxiliar de análisis. NO forma parte del build de producción. No se importa en ningún módulo del bot. No modifica DB. No toca motor. Solo lee Kraken API pública y simula.
- **tsconfig.json**: `include` cubre `client/src/**/*`, `shared/**/*`, `server/**/*` — **NO cubre `scripts/`**.

### Fuente de candles
Kraken API pública: `GET https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval={min}`
Sin autenticación. Sin tocar DB. Sin tocar motor real.

### Candles obtenidas

| Timeframe | Candles recibidas | Suficientes para ATR 14 |
|---|---|---|
| 15m | 721 | ✅ |
| 1h | 721 | ✅ |
| 4h | 721 | ✅ |

### Vela cerrada vs vela en curso
La API de Kraken OHLC devuelve la última vela que puede estar aún en curso (sin cerrar). Este script **NO excluye** la última vela porque es de auditoría. Los cálculos pueden incluir la vela actual en curso. Para implementación final conviene excluir velas no cerradas o validar cierre por timestamp/timeframe.

### ATR real 14 por timeframe

| Timeframe | ATR 14 (USD) | ATR% | lastClose | BB upper | BB middle | BB lower | Band width |
|---|---|---|---|---|---|---|---|
| 15m | $182.97 | **0.2887%** | $63,406.80 | $64,190.25 | $63,700.76 | $63,211.27 | 1.54% |
| 1h | $453.21 | **0.7148%** | $63,406.80 | $64,058.78 | $63,404.49 | $62,750.20 | 2.06% |
| 4h | $908.46 | **1.4328%** | $63,406.80 | $64,070.48 | $63,203.15 | $62,335.83 | 2.74% |

### Comparativa ATR real vs estimación √T (Fase 3B)

| Timeframe | ATR% Real | ATR% √T (estimado) | Diferencia abs | Diferencia % | Nota |
|---|---|---|---|---|---|
| 15m | 0.2887% | 0.3103% | -0.0216% | -6.97% | √T sobreestimó |
| 1h | 0.7148% | 0.6206% | +0.0942% | +15.17% | √T subestimó |
| 4h | 1.4328% | 1.2412% | +0.1916% | +15.43% | Dato real actual > auditado Fase 3A |

**Conclusión**: La regla √T subestima el ATR real en 1h y 4h (~15%), y sobreestima ligeramente en 15m (~7%). La aproximación √T no es fiable para decisiones operativas.

### Distancias desde centerPrice a bandas

| TF | lastClose → upper | lastClose → lower | middle → upper | middle → lower |
|---|---|---|---|---|
| 15m | 1.24% | 0.31% | 0.77% | 0.77% |
| 1h | 1.03% | 1.04% | 1.03% | 1.03% |
| 4h | 1.05% | 1.69% | 1.37% | 1.37% |

### Simulación de viabilidad con ATR real

`minSpacingPctReal = 1.79%` | `gridStepAtrMultiplier = 1.5` | `gridStepMaxPct = 3.0%`

| TF | Center | ATR% | Spacing% | BUY | SELL | Total | BW necesaria 5+5 | Net% | Veredicto |
|---|---|---|---|---|---|---|---|---|---|
| 15m | lastClose | 0.2887% | 1.79% | 0 | 0 | 0 | 17.90% | 1.29% | ❌ No viable |
| 15m | Bollinger mid | 0.2887% | 1.79% | 0 | 0 | 0 | 17.90% | 1.29% | ❌ No viable |
| 15m | Híbrido | 0.2887% | 1.79% | 0 | 0 | 0 | 17.90% | 1.29% | ❌ No viable |
| 1h | lastClose | 0.7148% | 1.79% | 0 | 0 | 0 | 17.90% | 1.29% | ❌ No viable |
| 1h | Bollinger mid | 0.7148% | 1.79% | 0 | 0 | 0 | 17.90% | 1.29% | ❌ No viable |
| 1h | Híbrido | 0.7148% | 1.79% | 0 | 0 | 0 | 17.90% | 1.29% | ❌ No viable |
| 4h | lastClose | 1.4328% | 2.15% | 0 | 0 | 0 | 21.49% | 1.58% | ❌ No viable |
| 4h | Bollinger mid | 1.4328% | 2.15% | 0 | 0 | 0 | 21.49% | 1.58% | ❌ No viable |
| 4h | Híbrido | 1.4328% | 2.15% | 0 | 0 | 0 | 21.49% | 1.58% | ❌ No viable |

### Causa de 0 niveles

El `minSpacingPctReal` (1.79%) es mayor que el **semi-ancho de banda** en todos los timeframes:

| TF | Semi-ancho BW | Spacing mínimo | ¿Cabe 1 nivel? |
|---|---|---|---|
| 15m | 0.77% | 1.79% | ❌ (spacing > 2× semi-ancho) |
| 1h | 1.03% | 1.79% | ❌ (spacing > semi-ancho) |
| 4h | 1.37% | 2.15% | ❌ (spacing > semi-ancho) |

Incluso el primer nivel desde el center price cae fuera de la banda. **No cabe ni un solo nivel rentable.**

### BandWidth necesaria para 5+5

| TF | Spacing | BW necesaria 5+5 | BW actual | Ratio |
|---|---|---|---|---|
| 15m | 1.79% | 17.90% | 1.54% | 11.6× |
| 1h | 1.79% | 17.90% | 2.06% | 8.7× |
| 4h | 2.15% | 21.49% | 2.74% | 7.8× |

### Beneficio neto y fees

Todas las variantes cumplen el `netProfitTargetPct = 1.2%`:
- Spacing 1.79% (15m/1h): neto = 1.29% ✅
- Spacing 2.15% (4h): neto = 1.58% ✅

Fórmula (sin doble conteo): `neto = (spacing - fees) × (1 - taxReserve/100)`

### Conclusión principal

Con configuración actual, el Grid no debe generar niveles profesionales rentables. Si los genera, es porque la fórmula antigua los compacta artificialmente. Esto ya se observa en staging/SHADOW o en los rangos históricos auditados.

### ATR timeframe no resuelve el problema

El cambio de ATR timeframe no soluciona por sí solo el problema. Con datos reales, 15m, 1h y 4h siguen generando 0 niveles viables con la banda actual. La elección final del ATR timeframe solo tiene sentido después de definir un rango operativo suficiente.

Recomendación provisional:
- ATR 1h puede ser candidato para spacing operativo por equilibrio.
- ATR 4h puede servir como contexto/régimen.
- Decisión final pendiente de Fase 3C diseño.

### Implicación estratégica

No basta con cambiar la fórmula geométrica. Fase 3C debe resolver también el concepto de rango operativo.

Opciones:

**A) Mantener Bollinger como rango operativo:**
- Con 2σ no caben niveles.
- Con 3σ/4σ podría caber 1+1, pero seguiría siendo marginal.
- No resuelve 5+5 niveles.

**B) Separar rango macro y rango operativo:**
- Bollinger 4h sirve para régimen/diagnóstico.
- El rango operativo de Grid se calcula aparte.
- Puede basarse en ATR múltiple, porcentaje fijo configurable o combinación.

**C) Reducir niveles dinámicamente:**
- Generar solo niveles que caben.
- Si `totalLevels < minLevelsForViableGrid`, marcar Grid no viable.

**D) Bajar objetivo neto:**
- Permitiría más densidad.
- Pero reduce beneficio por ciclo.
- No hacerlo automáticamente.

**Recomendación documental**: La solución profesional más probable es combinar:
- Fórmula acumulativa.
- Spacing mínimo rentable.
- Rango operativo independiente.
- Reducción dinámica de niveles.
- Estado Grid compacto/no viable.
- Todo primero en SHADOW.

### Validación del script
- `npm run check`: ✅ (no cubre `scripts/`)
- `npx tsx scripts/grid_spacing_phase3c_pre_real_atr.ts`: ✅ (ejecuta correctamente, 721 candles por timeframe)

### Archivos creados
- `scripts/grid_spacing_phase3c_pre_real_atr.ts` — script auxiliar, no se importa en producción

### Confirmación de restricciones
- ✅ No IDCA · No FISCO · No REAL · No órdenes reales · No rebuild · No DB manual · No migraciones · No cambios de lógica de trading · No deploy
- ✅ Solo lectura de Kraken API pública + simulación + documentación

---

## 2026-07-08 — FASE 3B SIMULACIÓN: SPACING ATR Y VIABILIDAD PROFESIONAL DE GRID

### Resumen
Simulación comparativa de fórmulas de spacing para Grid Isolated. Se confirma que el problema es doble: (1) la fórmula geométrica actual deja niveles pegados, y (2) la banda actual (2.83%) es incompatible con spacing mínimo rentable (~1.79%). **No se implementó ninguna fórmula nueva.**

### Script auxiliar
- **Archivo**: `scripts/grid_spacing_phase3b_simulation.ts`
- **Naturaleza**: Script auxiliar de análisis. NO forma parte del build de producción. No se importa en ningún módulo del bot.
- **tsconfig.json**: `include` cubre `client/src/**/*`, `shared/**/*`, `server/**/*` — **NO cubre `scripts/`**.
- **Validación**:
  - `npm run check`: ✅ (no cubre scripts/, no afectado)
  - `npx tsc scripts/... --noEmit`: ❌ (error en `node_modules/@types/request` — conflicto de dependencias, no relacionado con el script)
  - `npx tsx scripts/grid_spacing_phase3b_simulation.ts`: ✅ (ejecuta correctamente, exit code 0)

### Fórmula actual simulada
```
distance[i] = effectiveBaseStep × ratio^i
price[i] = centerPrice ± distance[i]
```
Con `ratio ≈ 1.002286`, la separación entre niveles consecutivos es `baseStep × (ratio - 1) ≈ 0.004%`.

### Fórmula propuesta simulada (acumulativa)
```
spacingPct = clamp(atrPct × gridStepAtrMultiplier, minSpacingPctReal, gridStepMaxPct)

BUY[0]  = centerPrice × (1 - spacingPct/100)
BUY[i]  = BUY[i-1] × (1 - gapPct[i]/100)

SELL[0] = centerPrice × (1 + spacingPct/100)
SELL[i] = SELL[i-1] × (1 + gapPct[i]/100)
```

Tres variantes de `gapPct[i]` simuladas:
- **Lineal estable**: `gapPct = spacingPct`
- **Geométrica suave**: `gapPct = spacingPct × ratio^i`
- **Geométrica clampada**: `gapPct = clamp(spacingPct × ratio^i, minSpacingPctReal, gridStepMaxPct)`

### Spacing mínimo rentable (sin doble conteo de fees)
```
minSpacingPctReal = grossTargetPct + spreadBufferPct + safetyBufferPct
                  = 1.68% + 0.01% + 0.10% = 1.79%
```
`grossTargetPct` ya incluye `feeBuyPct + feeSellPct`. No sumar fees dos veces.

### Tabla comparativa de simulación

| # | Fórmula | Center | ATR | Spacing | BUY+SELL | B-B gap | En banda | Fuera | Net% | Veredicto |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Actual | lastClose | 4h | 1.86% | 5+5 | 0.004% | 5 | 5 | 1.35% | ❌ 5 fuera banda |
| 2 | Actual | Bollinger mid | 4h | 1.86% | 5+5 | 0.004% | 10 | 0 | 1.35% | ✅ pero niveles pegados |
| 3 | Prop. lineal | lastClose | 4h | 1.86% | 5+5 | 1.86% | 1 | 9 | 1.35% | ❌ 9 fuera banda |
| 4 | Prop. lineal | Bollinger mid | 4h | 1.86% | 5+5 | 1.86% | 2 | 8 | 1.35% | ❌ 8 fuera banda |
| 5 | Prop. geom. suave | lastClose | 4h | 1.86% | 5+5 | 1.87% | 1 | 9 | 1.35% | ❌ 9 fuera |
| 6 | Prop. geom. clamp | lastClose | 4h | 1.86% | 5+5 | 1.87% | 1 | 9 | 1.35% | ❌ 9 fuera |
| 7 | Prop. lineal | lastClose | 1h | 1.79% | 5+5 | 1.79% | 1 | 9 | 1.29% | ❌ 9 fuera |
| 8 | Prop. lineal | Bollinger mid | 1h | 1.79% | 5+5 | 1.79% | 2 | 8 | 1.29% | ❌ 8 fuera |
| 9 | Prop. + reducción din. | lastClose | 4h | 1.86% | 1+0 | 1.86% | 1 | 0 | 1.35% | ⚠️ Solo 1 nivel |
| 10 | Prop. + reducción din. | Bollinger mid | 4h | 1.86% | 1+1 | 1.86% | 2 | 0 | 1.35% | ⚠️ Solo 2 niveles |
| 11 | Prop. + tolerancia 3% | lastClose | 4h | 1.86% | 5+5 | 1.86% | 1 | 9 | 1.35% | ❌ Tolerancia insuficiente |
| 12 | Prop. + reducción din. | lastClose | 1h | 1.79% | 1+0 | 1.79% | 1 | 0 | 1.29% | ⚠️ Solo 1 nivel |
| 13 | Prop. + reducción din. | Bollinger mid | 1h | 1.79% | 1+1 | 1.79% | 2 | 0 | 1.29% | ⚠️ Solo 2 niveles |
| 14 | Prop. + reducción din. | lastClose | 15m | 1.79% | 1+0 | 1.79% | 1 | 0 | 1.29% | ⚠️ Solo 1 nivel |

### Niveles que caben realmente en banda (2.83%)

**Con lastClose ($63,300.80):**
- Spacing 1.86% (ATR 4h): 1 BUY + 0 SELL = **1 nivel total**
- Spacing 1.79% (ATR 1h/15m): 1 BUY + 0 SELL = **1 nivel total**
- BW necesaria para 5+5: **~18.63%**

**Con Bollinger middle ($62,489.56):**
- Spacing 1.86% (ATR 4h): 1 BUY + 1 SELL = **2 niveles total**
- Spacing 1.79% (ATR 1h/15m): 1 BUY + 1 SELL = **2 niveles total**
- BW necesaria para 5+5: **~17.91%**

### Comparación centerPrice

| Opción | Center | Espacio BUY | Espacio SELL | Niveles | Sesgo |
|---|---|---|---|---|---|
| A) lastClose | $63,300.80 | 3.48% | 0.92% | 1+0 | Arriba (SELL no caben) |
| B) Bollinger middle | $62,489.56 | 2.23% | 2.23% | 1+1 | Simétrico |
| C) Híbrido (clamp 25% BW) | $62,931.67 | 2.92% | 1.51% | 1+0 | Ligeramente arriba |

**Recomendación preliminar**: Bollinger middle — es el único que genera niveles simétricos.

### Comparación ATR timeframes

| Timeframe | ATR% | Spacing% | Niveles (lastClose) | Veredicto |
|---|---|---|---|---|
| 15m | 0.3103% (estimado √T) | 1.79% (clamp piso) | 1+0 | ❌ Insuficiente |
| 1h | 0.6206% (estimado √T) | 1.79% (clamp piso) | 1+0 | ❌ Insuficiente |
| 4h (actual) | 1.2412% | 1.86% | 1+0 | ❌ Insuficiente |

**Los ATR 1h y 15m de esta simulación son aproximaciones por escala temporal (regla √T), NO ATR calculados con velas reales. No deben usarse para decidir definitivamente el timeframe. Para una decisión final habría que recalcular con candles reales 1h y 15m (Fase 3C-PRE).**

**Con los datos estimados, cambiar ATR timeframe no soluciona el problema principal porque el `minSpacingPctReal` domina. La decisión definitiva de ATR timeframe queda pendiente de una simulación con candles reales 1h/15m. El problema prioritario es la incompatibilidad entre bandWidth actual, spacing mínimo real y número de niveles.**

### Beneficio neto y fees

Todas las variantes cumplen el `netProfitTargetPct = 1.2%`:
- Spacing 1.86%: neto = 1.35% ✅
- Spacing 1.79%: neto = 1.29% ✅

Fórmula (sin doble conteo): `neto = (spacing - fees) × (1 - taxReserve) = (spacing - 0.18%) × 0.80`

### Impacto sobre capital

- `gridMaxCapitalPerCycleUsd = $600` (configurable, no hardcodear)
- Sin reducción (5+5): BUY capital = $600, SELL notional = $600 ✅
- Con reducción dinámica (1+1): BUY capital = $120, SELL notional = $120 ✅

**En esta simulación el notional SELL se muestra simplificado. En el bot real, el SELL notional debe calcularse como quantity comprada × sellPrice y normalmente será superior al BUY si el SELL está por encima del BUY. SELL no consume USD, pero sí requiere inventario BTC.**

### Conclusión principal

No basta con corregir la fórmula geométrica. También hay que decidir:
- Reducir niveles dinámicamente según banda disponible.
- Ampliar rango operativo (evaluar `bandStdDevMultiplier` o rango operativo independiente).
- Marcar Grid como compacto/no viable si no caben suficientes niveles.
- Separar rango macro (Bollinger 4h para régimen) y rango operativo (banda para niveles).
- O cambiar configuración de niveles/bandas.

### Criterio profesional de viabilidad Grid

Un Grid profesional no debe forzar un número fijo de niveles si el rango disponible no permite una separación rentable.

La lógica correcta debe ser:

1. **Calcular rango útil**:
   `usefulRangePct = upperBandPct - lowerBandPct`

2. **Calcular spacing mínimo rentable**:
   `minSpacingPctReal = grossTargetPct + spreadBufferPct + safetyBufferPct`

   O equivalente:
   `minSpacingPctReal = netBeforeTaxPct + feeBuyPct + feeSellPct + spreadBufferPct + safetyBufferPct`

   No doble contar fees: no usar `feeBuyPct + feeSellPct + grossTargetPct` si `grossTargetPct` ya incluye fees.

3. **Calcular spacing operativo**:
   `spacingPct = clamp(atrPct × gridStepAtrMultiplier, minSpacingPctReal, gridStepMaxPct)`

4. **Calcular cuántos niveles caben**:
   `maxBuyLevels = floor(espacio disponible hacia abajo / spacingPct)`
   `maxSellLevels = floor(espacio disponible hacia arriba / spacingPct)`

5. **Generar solo niveles viables**:
   `buyLevels = min(configuredBuyLevels, maxBuyLevels)`
   `sellLevels = min(configuredSellLevels, maxSellLevels)`

6. **Si caben pocos niveles**:
   - Si `totalLevels < minLevelsForViableGrid`: marcar Grid como compacto/no viable.
   - No regenerar rango operativo automáticamente sin aprobación.
   - Explicar en UI por qué no caben niveles.

7. **No forzar 5 BUY + 5 SELL**:
   Si la banda solo permite 1 BUY + 1 SELL rentable, no fabricar 10 niveles pegados.

### Recomendaciones preliminares (no definitivas)

- **Fórmula**: Acumulativa lineal (`gapPct = spacingPct`). La geométrica no aporta beneficio significativo.
- **Center price**: Bollinger middle (simétrico). lastClose deja SELL fuera cuando precio está cerca del techo.
- **ATR timeframe**: Pendiente de Fase 3C-PRE con candles reales. Con datos estimados, el timeframe no cambia el resultado porque `minSpacingPctReal` domina.
- **Regla si no caben niveles**: Reducción dinámica + evaluar ampliación de rango operativo.
- **Configs nuevas propuestas**: `spreadBufferPct`, `safetyBufferPct`, `minLevelsForViableGrid`, `useBollingerMiddleAsCenter`, `dynamicLevelReduction`.
- **Configs existentes a reutilizar**: `gridStepAtrMultiplier`, `gridStepMaxPct`, `netProfitTargetPct`.
- **Configs a revisar**: `gridStepMinPct` (subir de 0.20% a ~1.0% o eliminar), `bandStdDevMultiplier` (evaluar subir de 2.0 a 3.0).

### Riesgos identificados

- **Riesgo medio**: Cambiar `generateGeometricLevels` puede romper tests existentes.
- **Riesgo medio**: Rangos existentes en DB quedan obsoletos con nueva fórmula.
- **Riesgo bajo**: En SHADOW no hay órdenes reales.
- **Riesgo de viabilidad**: Con banda 2.83% y spacing 1.79%, el Grid solo puede tener 1-2 niveles — operativamente inútil sin ampliar la banda.

### Propuesta para Fase 3C (diseño, NO implementación)

Fase 3C debería implementar solo si se aprueba explícitamente:
1. Fórmula acumulativa con `spacingPct` como separación real entre niveles.
2. `minSpacingPctReal` como piso de spacing.
3. Viabilidad de banda: calcular cuántos niveles caben antes de generar.
4. Reducción dinámica de niveles.
5. Estado UI: Grid equilibrado / compacto / no viable.
6. Center price: Bollinger middle o híbrido `clamp(currentPrice, middle ± X% de bandWidth)`.
7. `gridMaxCapitalPerCycleUsd` configurable (no hardcodear).
8. SELL notional calculado como `qty comprada × sellPrice`.
9. Todo primero en SHADOW.

**No iniciar Fase 3C hasta aprobar Fase 3C-PRE.**

### Próxima fase: FASE 3C-PRE — ATR REAL Y SIMULACIÓN CON CANDLES REALES

Objetivo: Recolectar datos reales de velas BTC/USD para 15m, 1h y 4h. Calcular ATR real 14 en cada timeframe y repetir simulación con datos reales, no con aproximación por √T.

Entregable Fase 3C-PRE:
1. ATR real 15m.
2. ATR real 1h.
3. ATR real 4h.
4. Comparativa contra estimación por √T.
5. Simulación de spacing con cada ATR real.
6. Niveles que caben con lastClose.
7. Niveles que caben con Bollinger middle.
8. Niveles que caben con center híbrido.
9. Recomendación final de timeframe ATR.
10. Recomendación final de centerPrice.
11. Recomendación final de viabilidad: reducir niveles / ampliar rango / marcar compacto / combinación.

**No implementar Fase 3C hasta aprobar Fase 3C-PRE.**

### Archivos creados
- `scripts/grid_spacing_phase3b_simulation.ts` — script auxiliar, no se importa en producción

### Confirmación de restricciones
- ✅ No IDCA · No FISCO · No REAL · No órdenes reales · No rebuild · No DB manual · No migraciones · No cambios de lógica de trading · No deploy
- ✅ Solo simulación y documentación, sin cambios funcionales

---

## 2026-07-07 — FASE 3A AUDITORÍA: SPACING ATR / PROXIMIDAD BUY-SELL / BENEFICIO NETO MÍNIMO

### Resumen
Auditoría exhaustiva (solo lectura, sin cambios funcionales) del sistema de generación de niveles del Grid Isolated. Se detecta un bug crítico: la separación entre niveles consecutivos del mismo lado es ~0.0043%, 37× inferior al objetivo bruto mínimo de ~1.68%. **No se implementó ninguna solución.**

### Fórmula actual exacta del spacing

#### Rango/Banda (Bollinger)
- **Archivo**: `server/services/gridIsolated/gridBandAdapter.ts:42-91`
- Se obtienen candles de `MarketDataService.getCandles(pair, atrTimeframe)`.
- Bollinger Bands: `bandPeriod=20`, `bandStdDevMultiplier=2.0` sobre los closes.
- **Pmin** = Bollinger lower band
- **Pmax** = Bollinger upper band
- **midPrice** = `prices[prices.length - 1]` (último close, **no** la banda media de Bollinger)

#### ATR
- **Archivo**: `server/services/gridIsolated/gridBandAdapter.ts:59-60` → `server/services/indicators.ts:118-147`
- **Timeframe**: `atrTimeframe = "4h"` (config DB)
- **Periodo**: `atrPeriod = 14` (14 velas de 4h = 56 horas)
- **Cálculo**: Simple average de los últimos `period` True Ranges (no EMA, no Wilder's smoothing)
- **ATR%** = `(ATR / currentPrice) * 100`

#### gridStep
- **Archivo**: `server/services/gridIsolated/gridGeometricLevels.ts:83-93`
```
atrBasedStepPct = atrPct * gridStepAtrMultiplier
clampedStepPct = clamp(atrBasedStepPct, gridStepMinPct, gridStepMaxPct)
baseStep = midPrice * (clampedStepPct / 100)
```

#### Ratio geométrico
- **Archivo**: `server/services/gridIsolated/gridGeometricLevels.ts:65-76`
- Mapea `bandWidthPct` de [1%, 15%] → [ratioMin, ratioMax]
- Con bandWidth 2.83%: `normalized = (2.83-1)/(15-1) = 0.131` → `ratio = 0.95 + 0.131*(1.35-0.95) = 1.0022`

#### Generación de niveles
- **Archivo**: `server/services/gridIsolated/gridGeometricLevels.ts:107-198`
```
minDistance = midPrice * (grossTargetPct / 100)
effectiveBaseStep = max(baseStep, minDistance)

BUY[i]:  price = midPrice - effectiveBaseStep * ratio^i
SELL[i]: price = midPrice + effectiveBaseStep * ratio^i
```
Solo se generan niveles dentro de la banda (±2% de tolerancia).

#### Beneficio objetivo y fees
- **Archivo**: `server/services/gridIsolated/gridNetCalculator.ts:62-86`
- `FEE_BUFFER_BUY_PCT = 0.09%`, `FEE_BUFFER_SELL_PCT = 0.09%` (taker conservativo)
- `TAX_RESERVE_PCT = 20%` del neto antes de impuestos
```
netBeforeTax = netProfitTargetPct / (1 - 0.20)
grossTargetPct = netBeforeTax + feeBuyPct + feeSellPct
```
- Con `netProfitTargetPct = 1.2%`:
  - `netBeforeTax = 1.50%`
  - `grossTargetPct = 1.50 + 0.09 + 0.09 = 1.68%`

**Importante**: `grossTargetPct` **ya incluye** las fees de compra y venta. No debe sumarse de nuevo en fórmulas de spacing mínimo.

### Valores reales de configuración (DB staging, 2026-07-07)

| Parámetro | Valor |
|---|---|
| mode | SHADOW |
| netProfitTargetPct | 1.2% |
| bandPeriod | 20 |
| bandStdDevMultiplier | 2.0 |
| atrPeriod | 14 |
| atrTimeframe | 4h |
| gridStepAtrMultiplier | 1.5 |
| gridStepMinPct | 0.20% |
| gridStepMaxPct | 3.0% |
| geometricRatioMin | 0.95 |
| geometricRatioMax | 1.35 |
| gridAllocationMode | adaptive_market |
| gridCapitalDeploymentMode | capped |
| gridMaxCapitalPerCycleUsd | 600 |
| gridWalletInitialUsd | 1000 |
| gridWalletMaxUsd | 1700 |

### Datos reales del rango #14 (aba1e874, paused, histórico)

| Dato | Valor |
|---|---|
| midPrice | $63,300.80 |
| Band lower | $61,098.74 |
| Band upper | $63,880.37 |
| Band width | 2.83% |
| ATR% | 1.2412% |
| Precio actual | $63,993.40 |
| geometric_ratio (DB) | 1.0022 |
| netProfitTargetPct (DB) | 1.20% |
| Niveles BUY | 5 |
| Niveles SELL | 5 |

### Niveles reales generados

**BUY (ordenados por precio ascendente):**

| Index | Precio | Dist. desde mid | Dist. nivel anterior |
|---|---|---|---|
| 0 | $62,111.66 | $1,189.14 (1.88%) | — |
| 1 | $62,114.32 | $1,186.48 (1.88%) | $2.66 (0.0043%) |
| 2 | $62,116.97 | $1,183.83 (1.87%) | $2.65 (0.0043%) |
| 3 | $62,119.62 | $1,181.18 (1.87%) | $2.65 (0.0043%) |
| 4 | $62,122.26 | $1,178.54 (1.86%) | $2.64 (0.0043%) |

**SELL (ordenados por precio ascendente):**

| Index | Precio | Dist. desde mid | Dist. nivel anterior |
|---|---|---|---|
| 0 | $64,479.34 | $1,178.54 (1.86%) | — |
| 1 | $64,481.98 | $1,181.18 (1.87%) | $2.64 (0.0043%) |
| 2 | $64,484.63 | $1,183.83 (1.87%) | $2.65 (0.0043%) |
| 3 | $64,487.28 | $1,186.48 (1.88%) | $2.65 (0.0043%) |
| 4 | $64,489.94 | $1,189.14 (1.88%) | $2.66 (0.0043%) |

### Métricas de separación

| Métrica | Valor |
|---|---|
| Separación media BUY-BUY | **$2.66 → 0.0043%** |
| Separación media SELL-SELL | **$2.66 → 0.0043%** |
| Separación BUY más cercano al mercado | $62,122.26 → 2.93% bajo precio actual |
| Separación SELL más cercano al mercado | $64,479.34 → 0.76% sobre precio actual |
| Gap BUY max → SELL min | $2,357.08 → 3.73% |
| Beneficio neto objetivo | 1.2% (~$1.44 por nivel sobre ~$120) |
| Beneficio bruto objetivo | 1.68% (incluye fees) |
| Fees estimadas por nivel | $0.108 (0.09% × 2 sobre ~$120) |

### Causa del bug: lógica geométrica

La fórmula actual calcula distancia **desde midPrice**, no separación acumulativa entre niveles:
```
distance[i] = effectiveBaseStep * ratio^i
price[i] = midPrice - distance[i]
```

La separación entre nivel `i` e `i-1` es:
```
gap = baseStep * ratio^i - baseStep * ratio^(i-1) = baseStep * ratio^(i-1) * (ratio - 1)
```

Con `ratio = 1.0022` y `baseStep = $1,177`:
```
gap = 1177 * 0.0022 = $2.59 → 0.004% del precio
```

**El ratio geométrico ≈ 1.0 hace que los niveles sean casi idénticos.** Con `bandWidthPct = 2.83%` y el rango de mapeo [1%, 15%], el ratio sale muy cerca de `ratioMin = 0.95`, que a su vez es muy cerca de 1.0.

### Diagnóstico: ¿configuración, lógica o ambas?

**Ambas:**

1. **Lógica**: El diseño geométrico con `distance[i] = baseStep * ratio^i` hace que la separación entre niveles consecutivos sea `baseStep * (ratio - 1)`, que con ratio ≈ 1.0 es casi cero. La separación debería ser acumulativa desde el nivel anterior, no desde mid.

2. **Configuración**: `gridStepMinPct = 0.20%` es demasiado bajo. No cubre ni las fees (0.18%). Debería ser al menos `grossTargetPct` (1.68%).

### ¿El spacing mínimo cubre fees + spread + target neto?

**No directamente.** El `gridStepMinPct = 0.20%` es insuficiente. Sin embargo, el `effectiveBaseStep = max(baseStep, minDistance)` salva el primer nivel porque `minDistance` se calcula desde `grossTargetPct = 1.68%`. Pero los niveles consecutivos del mismo lado pueden estar a 0.004% entre sí, lo que es el problema real.

### Propuesta de fórmula de spacing mínimo (corregida — sin doble conteo de fees)

**Corrección importante**: `grossTargetPct` ya incluye `feeBuyPct + feeSellPct` según `gridNetCalculator.ts:73-74`. Por tanto, la fórmula propuesta **no debe sumar fees dos veces**.

**Opción A (recomendada — usa grossTargetPct que ya incluye fees):**
```
minSpacingPctReal = max(
  gridStepMinPct,
  grossTargetPct + spreadBufferPct + safetyBufferPct
)
```

**Opción B (desglosada — equivalente matemática):**
```
minSpacingPctReal = max(
  gridStepMinPct,
  netBeforeTaxPct + feeBuyPct + feeSellPct + spreadBufferPct + safetyBufferPct
)
```

**No usar**: `feeBuyPct + feeSellPct + grossTargetPct` (doble conteo de fees).

Con valores actuales (Opción A):
```
minSpacingPctReal = max(0.20, 1.68 + 0.01 + 0.10) = 1.79%
spacingPct = clamp(atrPct * gridStepAtrMultiplier, minSpacingPctReal, gridStepMaxPct)
           = clamp(1.24 * 1.5, 1.79, 3.0) = clamp(1.86, 1.79, 3.0) = 1.86%
```

Separación mínima entre niveles: **1.86%** en vez del **0.004%** actual.

### Análisis de viabilidad de banda

**Advertencia crítica**: Si el spacing mínimo real ronda 1.7%–2.0%, puede que **no quepan 5 BUY y 5 SELL** dentro de una banda de solo 2.83% de anchura.

Cálculo: con spacing de 1.86% y banda de 2.83%:
- Cada lado (BUY o SELL) tiene ~1.41% de espacio desde midPrice al borde de banda
- Con spacing de 1.86%, solo cabría **0-1 niveles por lado** dentro de la banda
- Para 5 niveles por lado con spacing 1.86%: se necesitaría banda de al menos `5 * 1.86% = 9.3%` por lado → **18.6% total**

**Fase 3B debe analizar:**
- Cuántos niveles caben realmente en la banda con spacing corregido
- Si hay que reducir niveles dinámicamente según ancho de banda
- Si hay que ampliar la banda (cambiar `bandStdDevMultiplier` o timeframe de Bollinger)
- Si hay que marcar el Grid como "compacto/no viable" cuando no caben suficientes niveles
- Si hay que permitir niveles fuera de banda con tolerancia
- Si hay que separar rango macro (Bollinger 4h) y spacing operativo (ATR 1h)

### Duda técnica sobre midPrice

El código actual usa:
```
midPrice = prices[prices.length - 1]  // último close
```

Esto **no** es necesariamente el centro de la Bollinger Band.

**Comparación para Fase 3B:**

| Opción | Ventajas | Desventajas |
|---|---|---|
| **A) gridCenter = currentPrice/lastClose** (actual) | El Grid sigue al mercado; niveles se ajustan al precio actual | Si el precio está cerca del techo de la banda, los SELL pueden quedar fuera; el Grid se "desplaza" con el precio |
| **B) gridCenter = Bollinger middle band** | El Grid queda más estable; distribución simétrica dentro de la banda | Si el precio se aleja del centro, los niveles BUY/SELL quedan asimétricos respecto al precio real |

**No cambiar todavía.** Fase 3B debe evaluar ambas opciones con simulación.

### Recomendación ATR 15m vs 1h vs 4h

| Timeframe | Ventajas | Desventajas |
|---|---|---|
| 15m | Muy responsivo, detecta micro-volatilidad | Ruidoso, puede compactar grid en picos |
| 1h | Balance estabilidad/responsividad | Puede ser lento para ajustar spacing |
| 4h (actual) | Muy estable, menos ruido | Demasiado lento para adaptar spacing a cambios intradiarios |

**Recomendación para BTC/USD en este bot:**
- **Spacing micro**: ATR 14 en **1h** — mejor balance para grid trading BTC
- **Rango macro**: Bollinger 20 en **4h** — mantener actual para banda
- Dejar `atrTimeframe` configurable (ya lo es)

### Propuesta para Fase 3B: Diseño y simulación (NO implementación)

Fase 3B debe ser **diseño + simulación**, no implementación directa.

**Entregable Fase 3B:**
1. Fórmula actual vs fórmula propuesta (side-by-side)
2. Simulación con los mismos datos reales del rango #14
3. Número de niveles generados con fórmula nueva
4. Si caben dentro de banda
5. Separación media BUY-BUY con fórmula nueva
6. Separación media SELL-SELL con fórmula nueva
7. Beneficio neto esperado por nivel
8. Qué pasa si no caben 5 niveles por lado (reducción dinámica, ampliación de banda, etc.)
9. Recomendación: reducir niveles / ampliar rango / cambiar ATR timeframe / usar Bollinger middle / o mantener configuración
10. Riesgo de aplicar a rangos existentes
11. Qué tests habría que actualizar
12. Qué UI habría que ajustar
13. Confirmación de que NO se implementa nada sin aprobación

### Riesgos identificados

- **Riesgo bajo**: Los cambios serían en generación de niveles en SHADOW. No hay órdenes reales.
- **Riesgo medio**: Si se cambia la fórmula geométrica, los rangos existentes en DB quedan obsoletos. Habría que generar nuevos rangos para ver el efecto.
- **Riesgo de regresión**: Los tests existentes (`gridWeightedLevels.test.ts`, `gridAllocationEngine.test.ts`) podrían romperse si cambia la firma de `generateGeometricLevels`.
- **Riesgo de viabilidad**: Con spacing mínimo corregido (~1.8%), es posible que el Grid actual con 10 niveles no quepa en bandas estrechas (<5%). Habría que rediseñar el número de niveles o la anchura de banda.

### Archivos auditados (solo lectura)
- `server/services/gridIsolated/gridGeometricLevels.ts`
- `server/services/gridIsolated/gridBandAdapter.ts`
- `server/services/gridIsolated/gridNetCalculator.ts`
- `server/services/gridIsolated/gridIsolatedTypes.ts`
- `server/services/gridIsolated/gridIsolatedEngine.ts`
- `server/services/indicators.ts`
- `server/routes/gridIsolated.routes.ts`
- `client/src/components/grid/GridLevelsPanel.tsx`
- `client/src/components/grid/GridLevelsMarketHeader.tsx`

### Pendientes para Fase 3B
1. Diseñar fórmula de separación acumulativa entre niveles (no desde mid)
2. Simular con datos del rango #14
3. Analizar viabilidad de banda con spacing corregido
4. Evaluar midPrice = lastClose vs Bollinger middle
5. Proponer ajustes de configuración (gridStepMinPct, atrTimeframe, número de niveles)
6. Lista de tests a actualizar
7. Lista de cambios UI necesarios
8. **Sin implementación sin aprobación expresa**

### Confirmación de restricciones
- ✅ No IDCA · No FISCO · No REAL · No órdenes reales · No rebuild · No DB manual · No migraciones · No cambios de lógica de trading · No deploy
- ✅ Solo auditoría y documentación, sin cambios funcionales

---

## 2026-07-07 — FASE 2.2 FIX VISUAL: FILTRO RANGO ACTIVO NO MUSTRA HISTÓRICOS SI activeRangeVersionId ES NULL

### Resumen
Bug visual: el filtro "Rango activo" mostraba niveles históricos cuando `activeRangeVersionId` era null. **No se tocó lógica de trading.**

### Causa exacta
En `GridLevelsPanel.tsx` línea 175, el filtro "rango-activo" tenía fallback:
```typescript
case "rango-activo":
  return activeRangeId
    ? levels.filter((l) => l?.rangeVersionId === activeRangeId)
    : levels.filter((l) => l?.status === "planned"); // ← BUG: muestra todos los planificados globales
```
Cuando `activeRangeId` era null, el fallback mostraba todos los niveles con status "planned" de cualquier rangeVersionId.

### Corrección
1. **GridLevelsPanel.tsx**: filtro "rango-activo" ahora retorna `[]` cuando `activeRangeId` es null
2. **GridLevelsPanel.tsx**: contador muestra "Sin rango activo" cuando no hay rango activo
3. **GridLevelsPanel.tsx**: empty state con aviso azul: "No hay rango activo cargado. Los niveles históricos están disponibles en los filtros globales."
4. **GridLevelsPanel.tsx**: botón del empty state cambia a "Ver planificados globales"
5. **GridLevelsMarketHeader.tsx**: "Siguiente nivel cercano" muestra "Sin rango activo" cuando no hay rango activo
6. **GridLevelsMarketHeader.tsx**: explicación natural: "El Grid está en {mode} sin rango activo cargado en memoria..."
7. **gridIsolated.routes.ts**: `nearestLevel` en backend ahora filtra por `activeRangeId` — no usa niveles históricos

### Archivos tocados
- `client/src/components/grid/GridLevelsPanel.tsx` — fix filtro, contador, empty state
- `client/src/components/grid/GridLevelsMarketHeader.tsx` — prop activeRangeVersionId, textos "Sin rango activo"
- `client/src/pages/GridIsolated.tsx` — pasar activeRangeVersionId a GridLevelsMarketHeader
- `server/routes/gridIsolated.routes.ts` — nearestLevel filtrado por activeRangeId

### Tests ejecutados
- `npm run check`: ✅
- `npm run build`: ✅ (2606 módulos)
- `vitest`: ✅ 127/127

### Confirmación de restricciones
- ✅ No IDCA · No FISCO · No REAL · No órdenes reales · No rebuild · No DB · No migraciones · No lógica de trading

---

## 2026-07-07 — FASE 2.1 AJUSTE VISUAL/SEMÁNTICO POST-DEPLOY GRID

### Resumen
Ajustes visuales y semánticos tras revisión visual de la Fase 2 desplegada. **No se tocó lógica de trading.**

### Problemas detectados
1. **Filtro "Planificados"** mostraba 85 niveles globales (todos los rangeVersionId) sin aclarar que eran históricos/globales
2. **Tarjetas de resumen** mostraban valores del rango activo pero la tabla podía estar en modo global, causando confusión
3. **Pestaña Ayuda**: panel de módulos dormidos estaba al final, requiriendo scroll excesivo
4. **Mecanismos de seguridad**: Pump/Dump, HODL Recovery y Stop Loss aparecían como protecciones activas cuando están dormidas/informativas

### Cambios en filtros
- "Planificados" renombrado a "Planificados globales"
- Contador derecho cambia a "niveles globales" cuando el filtro es global
- Aviso ámbar visible cuando filtro ≠ "rango-activo": "Estás viendo niveles globales/históricos..."
- Nueva columna "Rango" en tabla: muestra "Activo" (verde) o "Histórico" + ID corto del rangeVersionId

### Cambios en tarjetas resumen
- Título "Resumen del rango activo" siempre visible sobre las tarjetas
- Cuando filtro es global, aparece etiqueta: "Tabla en modo global/histórico; este resumen sigue mostrando el rango activo actual"
- Las tarjetas siempre calculan desde el rango activo (Opción A del usuario)

### Cambios en pestaña Ayuda
- `GridIntegrationStatusPanel` movido antes de "Mecanismos de seguridad" (visible sin scroll)
- Circuit Breaker: etiqueta "Activo"
- Pump/Dump: renombrado a "Pump/Dump Detector", etiqueta "Informativo actualmente", texto aclarado
- HODL Recovery vs Stop Loss: etiqueta "Implementado, pendiente de integración", texto aclarado que no está cableado
- Target de Beneficio Neto: etiqueta "Activo" (se usa en gridNetCalculator)

### Archivos tocados
- `client/src/components/grid/GridLevelsPanel.tsx` — rename filtros, GLOBAL_FILTERS, columna Rango, título tarjetas, avisos
- `client/src/pages/GridIsolated.tsx` — mover GridIntegrationStatusPanel, actualizar textos de seguridad con badges

### Tests ejecutados
- `npm run check`: ✅
- `npm run build`: ✅ (2606 módulos)
- `vitest`: ✅ 127/127

### Confirmación de restricciones
- ✅ No IDCA · No FISCO · No REAL · No órdenes reales · No rebuild · No DB · No migraciones · No lógica de trading

---

## 2026-07-07 — FASE 2 SEGURA: UI / AUDITORÍA / SEMÁNTICA GRID

### Resumen
Mejoras de UI, auditoría visual y semántica en la pestaña Grid Isolated. **No se tocó lógica de trading.** No se cambiaron fórmulas, spacing, adaptive_market, ciclos, ni se activaron módulos dormidos.

### Causa exacta de la mezcla de niveles
La tabla `GridLevelsPanel` recibía `levels` desde `/api/grid-isolated/levels` que retorna `gridIsolatedEngine.getLevels()` — **todos** los niveles de **todos** los rangeVersionId. El filtro por defecto era "activos" (niveles con `exchangeOrderId`), pero en SHADOW no hay `exchangeOrderId`, así que la tabla aparecía vacía o mostraba niveles históricos mezclados con planificados. El KPI superior usaba `plannedLevelsCount` global (todos los planned de todos los rangos), no del rango activo.

### Dataset antes/después
- **Antes**: Tabla recibía `levels` globales sin `levelsSummary`. Filtro por defecto "activos". KPI usaba `plannedLevelsCount` global.
- **Después**: Tabla recibe `levelsSummary` con `activeRangeVersionId`. Filtro por defecto "rango-activo" que filtra por `rangeVersionId === activeRangeId`. KPI usa `currentPlannedLevelsCount` del rango activo. `GridLevelsMarketHeader` muestra `activeRangeLevelsCount` con históricos entre paréntesis.

### Qué muestra ahora la tabla
- Por defecto: solo niveles del rango activo actual (`rangeVersionId === activeRangeVersionId`)
- Filtros disponibles: Rango activo, Activos, Planificados, Históricos, Reemplazados, Ejecutados, Cancelados, Todos
- Si no hay rango activo, muestra niveles planificados como fallback

### Qué muestra ahora el resumen
- KPI "Niveles planificados" usa `currentPlannedLevelsCount` (rango activo)
- Subtexto: "X órdenes reales · Y en rango activo"
- "Total niveles" etiquetado como "(global/histórico)"
- "Rango actual" muestra `currentRangeLevelsCount`

### Modales añadidos
1. **Importe / Notional**: icono `HelpCircle` en cabecera de columna. Modal explica BUY (consume USD real, depende de capital máximo, modo reparto, min/max por nivel, número de niveles, precio) vs SELL (no consume USD, notional visual, puede ser mayor que BUY). Botones: Ir a Ajustes de Cartera, Ir a Reparto de Capital, Cerrar.
2. **Beneficio Objetivo**: icono `HelpCircle` en cabecera de columna. Modal explica factores (precio BUY/SELL, cantidad BTC, fees maker, spread, target neto, distancia entre niveles, ATR, política maker/post-only). Botones: Ir a Ajustes de Salidas/Beneficio, Ir a Ajustes de Bandas/Niveles, Cerrar.

### Explicación BUY vs SELL
- Disclaimer visible sobre la tabla: "Las compras BUY consumen capital USD real. Las ventas SELL no consumen USD: representan el valor estimado de vender el BTC comprado a un precio superior."
- Card de proximidad: aviso no alarmista si separación media < 1% — "Grid compacto: los niveles están cercanos. Revisa ATR multiplier, spacing mínimo, número de niveles o beneficio objetivo."
- Card de ayuda en pestaña Niveles: "La separación entre compras y ventas depende de la anchura de banda, ATR, número de niveles, spacing mínimo/máximo y beneficio neto objetivo."

### Estado de módulos dormidos mostrado
Nuevo componente `GridIntegrationStatusPanel` en pestaña Ayuda:
- Risk Manager: implementado pero no activo
- Execution Service: implementado pero no invocado
- Reconciliation: estructura existente, fetchExchangeOrders() es stub
- Modo REAL: no seguro hasta reconciliación real
- Pump/Dump: detector, no guard activo
- WebSocket: no implementado en esta fase

### Archivos tocados
- `client/src/components/grid/GridLevelsPanel.tsx` — nuevo filtro "rango-activo" por defecto, modales Importe/Notional y Beneficio Objetivo, disclaimer BUY/SELL, aviso proximidad, empty state para rango-activo
- `client/src/components/grid/GridSummaryPanel.tsx` — pasar `levelsSummary` y `netProfitTargetPct` a `GridLevelsPanel`, KPI usa `currentPlannedLevelsCount`, etiqueta "(global/histórico)" en total niveles
- `client/src/components/grid/GridKpiStrip.tsx` — KPI usa `currentPlannedLevelsCount` en vez de `plannedLevelsCount` global
- `client/src/components/grid/GridLevelsMarketHeader.tsx` — nueva prop `activeRangeLevelsCount`, muestra niveles en rango activo con históricos entre paréntesis
- `client/src/components/grid/GridIntegrationStatusPanel.tsx` — **nuevo** componente panel estado de integración
- `client/src/pages/GridIsolated.tsx` — import `GridIntegrationStatusPanel`, pasar `activeRangeLevelsCount` a header, card de ayuda proximidad, import `Info` icon

### Tests ejecutados
- `npm run check`: ✅ (tsc sin errores)
- `npm run build`: ✅ (2606 módulos, build completo)
- `npx vitest run gridIsolatedRoutes.test.ts`: ✅ 66/66
- `npx vitest run gridAllocationEngine.test.ts`: ✅ 26/26
- `npx vitest run gridWeightedLevels.test.ts`: ✅ 35/35
- Total: 127/127 tests pasan

### Pendientes
- Deploy (pendiente de aprobación del usuario)
- Fases 3-6 del roadmap (cycle linking, risk manager, reconciliation, execution) siguen pendientes

### Riesgos
- Ninguno: no se tocó lógica de trading, generación de niveles, spacing, adaptive_market, ciclos, risk manager, execution service, reconciliación real, ni DB

### Confirmación de restricciones
- ✅ No IDCA
- ✅ No FISCO
- ✅ No REAL
- ✅ No órdenes reales
- ✅ No rebuild
- ✅ No DB manual
- ✅ No migraciones
- ✅ No deploy sin aprobación

---

## 2026-07-07 — AUDITORÍA FASE 1.5: Integración real del Grid Isolated (sin commit, solo documental)

### Resumen
Auditoría profunda archivo por archivo del módulo Grid Isolated para verificar qué está realmente integrado, qué está dormido, y qué riesgos existen antes de avanzar a fases de implementación. **No se modificó código funcional.**

### Flujo real actual del tick

```
setInterval(60s) → tick()
  ├→ [GUARD] mode === "OFF"? → return
  ├→ [GUARD] isActive === false? → return
  ├→ checkDailyOrderReset()
  ├→ [GUARD] circuitBreakerOpen? → return (cooldown 5min)
  ├→ getGridBandSnapshot()          ← gridBandAdapter.ts (BBands + ATR)
  ├→ [GUARD] !bandSnapshot? → return
  ├→ checkPumpDumpGuard(midPrice)   ← SOLO precio, sin volumen
  ├→ [GUARD] !suitableForGrid? → pauseRangeVersion() → return
  ├→ IF !activeRangeVersion:
  │    └→ proposeRangeVersion(bandSnapshot)
  │         ├→ GridCapitalAllocator.allocate()
  │         ├→ generateGeometricLevels()
  │         ├→ applyWeightsToGeneratedLevels()
  │         ├→ db.insert(gridRangeVersions)
  │         ├→ db.insert(gridIsolatedLevels) × N
  │         └→ logEvent(GRID_RANGE_PROPOSED/ACTIVATED)
  ├→ ELSE IF isBandDrifted(bandSnapshot):
  │    ├→ canRebuildLevels()? → rebuildRangeAndLevels()
  │    └→ else → logShadowTickEvent(PRESERVED) → return
  ├→ ELSE: logShadowTickEvent(RANGE_REUSED)
  └→ IF mode === "SHADOW":
       └→ simulateShadowTick(midPrice)
            ├→ FOR each level (planned/open):
            │    ├→ BUY && price <= level.price → filled
            │    └→ SELL && price >= level.price → filled
            ├→ IF filled:
            │    ├→ level.status = "filled"
            │    ├→ db.update(gridIsolatedLevels)
            │    └→ processCycleFill(level, price)
            │         ├→ BUY → crear ciclo "buy_filled"
            │         └→ SELL → FIFO match primer "buy_filled" → "completed"
            └→ (sin risk evaluation, sin execution, sin reconciliation)
```

### Módulos activos (funcionando ahora)

| Módulo | Archivo | Función |
|--------|---------|---------|
| Engine Core | `gridIsolatedEngine.ts` | Tick, rangos, niveles, SHADOW sim, ciclos |
| Band Adapter | `gridBandAdapter.ts` | BBands + ATR + suitability |
| Geometric Levels | `gridGeometricLevels.ts` | Generación de niveles con ratio adaptativo |
| Allocation Engine | `gridAllocationEngine.ts` | Pesos uniform/progressive/adaptive |
| Capital Allocator | `gridCapitalAllocator.ts` | Balance, reservas, budget |
| Net Calculator | `gridNetCalculator.ts` | Gross/net target, fees, PnL |
| Mode Lock | `gridModeLockService.ts` | Safety gates para REAL |
| Backtest | `gridBacktest.ts` | Simulación histórica multi-variant |
| Activity Formatter | `gridActivityFormatter.ts` | Eventos → lenguaje natural |
| Types | `gridIsolatedTypes.ts` | Tipos, constantes, defaults |

### Módulos dormidos (existen pero no operan)

| Módulo | Archivo | Razón de dormancia |
|--------|---------|-------------------|
| Risk Manager | `gridRiskManager.ts` | **No importado** en engine. Trailing, stop loss 3-capas, HODL completos pero nunca invocados. |
| Execution Service | `gridExecutionService.ts` | **No importado** en engine. Maker-first + taker fallback completos pero nunca invocados. |
| Reconciliation Runner | `gridReconciliationRunner.ts` | Importado en routes pero `fetchExchangeOrders()` retorna `[]` siempre (stub). |

### Riesgos críticos identificados

1. **Taker fallback automático**: `gridExecutionService.placeOrder()` cae a taker después de 3 rechazos post-only **sin validar** `takerFallbackEnabled`, `takerFallbackRequiresNetProfit`, ni `takerFallbackAuditRequired` de config. **Contradice** la política del usuario: "maker/post-only salvo emergencia explícita".
2. **Reconciliation stub**: `fetchExchangeOrders()` retorna `[]` → no detecta mismatches → `canPlaceNewOrders()` retorna `true` → REAL podría desbloquearse sin verificación real.
3. **Risk Manager dormante**: 6 campos de config (`trailingActivationPct`, `trailingStopPct`, `stopLossSoftPct`, `stopLossHardPct`, `stopLossEmergencyPct`, `hodlRecoveryEnabled`) se persisten y cargan pero nunca se utilizan.
4. **Stop Loss Hard**: si se activara el risk manager, `STOP_LOSS_HARD` vende a mercado en pérdida — **viola** la política de no vender a mercado salvo emergencia explícita.
5. **Ciclos FIFO**: matching SELL→BUY es FIFO puro sin linking explícito. SELL de nivel lejano puede cerrar BUY de nivel cercano con PnL negativo. `maxOpenCycles` no se valida en `simulateShadowTick()`.
6. **Pump/Dump guard**: `volumeSpikeRatio` siempre = 0. No usa volumen real. Solo loggea, no pausa ni bloquea.

### Contradicción taker fallback vs política maker/post-only

`gridExecutionService.ts:304-340`: después de 3 intentos post-only rechazados, cae automáticamente a taker con price adjustment ±0.1%. **No consulta**:
- `config.takerFallbackEnabled` (debería ser gate)
- `config.takerFallbackRequiresNetProfit` (debería validar profit)
- `config.takerFallbackAuditRequired` (debería exigir evento auditoría)

Propuesta (no implementada): disabled por defecto, solo permitido con config explícita de emergencia, evento de auditoría obligatorio, nunca silencioso.

### Reconciliation stub — análisis crítico

**Archivo**: `gridReconciliationRunner.ts`
**Función**: `fetchExchangeOrders(pair)` @ línea 180

```typescript
private async fetchExchangeOrders(pair: string): Promise<any[]> {
  if (!revolutXService.isInitialized()) return [];
  // For now, return empty — will be populated when method is available
  return [];
}
```

**Comportamiento exacto de `canPlaceNewOrders()`**:
- `canPlaceNewOrders()` @ línea 225: retorna `!this.lastResult.blockedNewOrders`
- `reconcile()` @ línea 130: `const ok = mismatches.length === 0`
- Como `fetchExchangeOrders()` retorna `[]`, no hay órdenes del exchange para comparar
- Si hay niveles locales con `status === "open"` y `exchangeOrderId`, se detecta mismatch "not_found" → `ok = false` → `blockedNewOrders = true`
- **Pero**: en SHADOW actual, los niveles no tienen `exchangeOrderId` (no hay órdenes reales), y la línea 62 descarta niveles sin `exchangeOrderId` ni `clientOrderId` → **no se generan mismatches** → `ok = true` → `canPlaceNewOrders() = true`

**Riesgo**: Si se activa REAL sin fix, `setReconciliationPassed(true)` se invoca desde routes tras `reconcile()`, pero la reconciliación es vacía. REAL se desbloquearía sin verificación real.

**Propuesta de corrección** (no implementada):
- `fetchExchangeOrders()` debe retornar `null` (no `[]`) cuando no puede obtener órdenes
- `reconcile()` debe tratar `null` como error → `ok = false` → `blockedNewOrders = true`
- `canPlaceNewOrders()` debe retornar `false` si `lastResult` es null o si `fetchExchangeOrders` no está implementado

### Ciclos FIFO — estados usados vs definidos

**Estados usados**: `buy_filled`, `completed`
**Estados definidos pero no usados**: `pending`, `buy_placed`, `sell_placed`, `sell_filled`, `cancelled`, `stop_loss_hit`, `trailing_closed`

**Linking**: `buyLevelId` y `sellLevelId` ya existen en DB y se asignan, pero no hay pairing predefinido BUY level → SELL level. El matching es `this.cycles.find(c => c.status === "buy_filled")` (FIFO).

### Adaptive_market casi igual a uniform

En `gridAllocationEngine.ts`, `adaptive_market` aplica multiplicadores por régimen:
- `ranging` → ×1.0 (idéntico a uniform)
- `bullish` → ×0.70
- `bearish` → ×0.85

En SHADOW actual, el régimen suele ser `ranging` → resultado idéntico a uniform. Solo se diferencia en bullish/bearish, que son los casos donde `assessGridSuitability()` puede pausar el grid.

### Capital allocation — capitalPerLevelUsd

`gridRangeVersions.capitalPerLevelUsd` persiste el **uniform baseline**, no el weighted. Los niveles individuales sí tienen su `notionalUsd` weighted correcto. La UI usa `buildCapitalAllocationSummary()` que trabaja con notionalUsd reales, no con `capitalPerLevelUsd`.

**Decisión**: NO renombrar `capitalPerLevelUsd`. Si hace falta, añadir campos nuevos no destructivos: `baseCapitalPerLevelUsd`, `plannedBuyUsd`, `allocationModeApplied`.

### Pump/Dump guard — detector sin volumen

`checkPumpDumpGuard(currentPrice)` @ `gridIsolatedEngine.ts`:
- Compara precio actual vs `midPrice` del rango activo
- `volumeSpikeRatio` siempre = 0 (no obtiene volumen de candles)
- Solo loggea eventos, no pausa ni bloquea nuevos buys
- El nombre "guard" es engañoso — es un detector, no un guard

`MarketDataService.getCandles()` retorna candles con campo `volume` disponible pero no se utiliza.

### Tablas sin uso

| Tabla | Schema | Estado |
|-------|--------|--------|
| `grid_isolated_metrics_snapshots` | `shared/schema.ts:1818` | Creada en DB, ningún módulo la escribe ni lee |
| `grid_isolated_backtests` | `shared/schema.ts:1838` | Creada en DB, backtest engine no persiste resultados |

No se eliminan. Son infraestructura preparada para futuro.

### Recomendación de orden seguro de implementación

**Prioridad 1** (UI/audit sin tocar lógica):
- Mostrar risk states en UI (read-only)
- Persistir metrics snapshots y backtest results (solo inserts)
- Riesgo: Bajo

**Prioridad 2** (correcciones semánticas):
- Fix pump/dump: usar volumen real de candles
- Fix pump/dump: pausar nuevos buys cuando activo
- Añadir campos no destructivos: `plannedBuyUsd`, `allocationModeApplied`
- Riesgo: Medio

**Prioridad 3** (cycle linking en SHADOW):
- Paired SELL level en generateGeometricLevels
- Matching por pairedSellLevelId en processCycleFill
- maxOpenCycles validation
- Riesgo: Alto

**Prioridad 4** (risk manager en SHADOW):
- Añadir `riskStateJson` jsonb a `grid_isolated_cycles`
- Cablear gridRiskManager al engine
- evaluateCycle después de simulateShadowTick
- Cambiar STOP_LOSS_HARD → HODL (no vender a mercado)
- Riesgo: Alto

**Prioridad 5** (reconciliation READ-ONLY):
- Implementar `getOpenOrders()` en RevolutXService
- `fetchExchangeOrders()` real
- Bloquear REAL si no hay reconciliación < 10min
- Riesgo: Medio

**Prioridad 6** (execution service real):
- Fix taker fallback: disabled por defecto + gates
- `placeRealOrders()` en engine
- Polling de fills, cancelación stale
- Sincronizar circuit breaker y daily order count
- Riesgo: Crítico

### Archivos revisados (sin modificación)
- `server/services/gridIsolated/gridIsolatedEngine.ts` (1621L)
- `server/services/gridIsolated/gridIsolatedTypes.ts` (591L)
- `server/services/gridIsolated/gridBandAdapter.ts` (162L)
- `server/services/gridIsolated/gridGeometricLevels.ts` (231L)
- `server/services/gridIsolated/gridAllocationEngine.ts` (383L)
- `server/services/gridIsolated/gridCapitalAllocator.ts` (282L)
- `server/services/gridIsolated/gridNetCalculator.ts` (172L)
- `server/services/gridIsolated/gridExecutionService.ts` (382L)
- `server/services/gridIsolated/gridRiskManager.ts` (286L)
- `server/services/gridIsolated/gridReconciliationRunner.ts` (247L)
- `server/services/gridIsolated/gridModeLockService.ts` (215L)
- `server/services/gridIsolated/gridBacktest.ts` (360L)
- `server/services/gridIsolated/gridActivityFormatter.ts` (512L)
- `server/routes/gridIsolated.routes.ts` (1397L+)
- `shared/schema.ts` (grid tables: 1656-1857)
- `client/src/pages/GridIsolated.tsx` (720L)
- 20 componentes frontend en `client/src/components/grid/`

### Estado final
- Auditoría documental completada
- No se modificó código funcional
- No se tocó DB
- No se hizo deploy
- No se activó REAL
- No se tocaron IDCA ni FISCO

### Pendientes
- Fase 2 Segura: UI / auditoría / semántica (sin tocar lógica de trading)
- Fases 3-6: pendientes de aprobación tras Fase 2

---

## 2026-07-07 — FIX Telegram: /api/telegram/channels 404 + legacy rules enabled (commit 1234870)

### Problema
- `/api/telegram/channels` devolvía 404 aunque `/api/telegram/chats` existía → UI no podía gestionar canales
- Migration 067 creó alert rules `enabled=true` para canales legacy importados (importedFromLegacy=true, needsUserReview=true)
- Esto incumplía la regla: "Legacy importado no se activa por defecto y no debe conservar alertas activas hasta revisión/configuración manual"

### Solución — FIX 1: /api/telegram/channels alias endpoints
- `routes.ts`: Añadidos endpoints alias que reutilizan la lógica de `/api/telegram/chats`:
  - `GET /api/telegram/channels` → `getTelegramChats()`
  - `POST /api/telegram/channels` → `createTelegramChat()` con validación tokenId
  - `PUT /api/telegram/channels/:id` → `updateTelegramChat()` con validación tokenId
  - `DELETE /api/telegram/channels/:id` → `deleteTelegramChat()`
- UI Telegram → Canales ahora puede añadir, editar, activar/inactivar, asignar token, probar y eliminar canales

### Solución — FIX 2: Legacy alert rules disabled
- Migration 067: INSERT con `CASE` para `enabled=false` cuando `importedFromLegacy=true` o `needsUserReview=true`
- Migration 068: `UPDATE` para desactivar reglas legacy existentes en staging
- `routes.ts`: migration 068 añadida al AutoMigrationRunner
- Resultado: chat_id 7 (Legacy API Config) y chat_id 8 (Legacy IDCA) tienen todas sus alert rules `enabled=false`

### Solución — FIX 3: Tests
- 42 tests en `telegram-refactor.test.ts` (40 originales + 2 nuevos legacy rules)
- Tests cubren: alert rule disabled blocking, legacy channel con `importedFromLegacy=true`

### Validación VPS staging
- Container `krakenbot-staging-app` Up, no reinicia
- Health: `{"status":"ok","schema":{"healthy":true,"migrationRan":true}}`
- `/api/telegram/channels` responde 200 con 3 canales
- `/api/telegram/audit` sin HIGH (WARNING x2, INFO x1)
- Legacy API Config (chat_id 7): `isActive=false`, todas las alert rules `enabled=false`
- Legacy IDCA (chat_id 8): `isActive=false`, todas las alert rules `enabled=false`
- FISCO (chat_id 6): `isActive=true`, alert rules `enabled=true`
- Logs sin `DATABASE_ERROR` ni `ERROR CRITICAL`

### Archivos modificados
- `server/routes.ts` — /api/telegram/channels endpoints + migration 068
- `db/migrations/067_telegram_alert_rules.sql` — INSERT con CASE para legacy
- `db/migrations/068_disable_legacy_alert_rules.sql` — UPDATE legacy rules disabled
- `server/services/__tests__/telegram-refactor.test.ts` — 2 tests legacy rules

---

## 2026-07-07 — Validación final UX Telegram staging — eab28fc

### Deploy
- Commit: `eab28fc` fix(telegram): permitir crear canal inactivo sin test de envío
- Commit previo: `ad2c683` feat(telegram): UX 1-7 — Canales/Tokens reales, Alertas en subpestañas, eliminar restos
- VPS: `cd /opt/krakenbot-staging && git pull && docker compose -f docker-compose.staging.yml up -d --build`
- Espera: 50s para app startup

### Validación API
- Health: `{"status":"ok","schema":{"healthy":true,"migrationRan":true}}` ✅
- `/api/telegram/channels`: 200 OK, 3 canales (FISCO activo, Legacy API Config inactivo, Legacy IDCA inactivo) ✅
- `/api/telegram/tokens`: 200 OK, tokens listados ✅
- `/api/telegram/alert-rules`: 200 OK, 15 reglas (5 por canal) ✅
- `/api/telegram/audit`: 0 HIGH, 2 WARNING, 1 INFO ✅
- `/api/telegram/commands`: 51 comandos, 7 required encontrados ✅
- `/api/telegram/grid-alert-catalog`: 20 alertas, 0 observerForbidden ✅

### Validación DB
- Tablas: `telegram_bot_tokens`, `telegram_alert_rules`, `telegram_chats`, `telegram_alert_events` ✅
- Columnas `telegram_chats`: `token_id`, `enabled_modes`, `enabled_alerts` ✅
- Columnas `telegram_alert_events`: `token_id`, `channel_id`, `chat_id`, `status`, `block_reason` ✅
- Canales:
  - ID 6 FISCO: activo, sin token, enabled_modes trading/idca/fiscal/smart_exit ✅
  - ID 7 Legacy API Config: inactivo, importedFromLegacy=true ✅
  - ID 8 Legacy IDCA: inactivo, importedFromLegacy=true ✅
- Alert rules:
  - FISCO: 5 reglas enabled=true ✅
  - Legacy API Config: 5 reglas enabled=false ✅
  - Legacy IDCA: 5 reglas enabled=false ✅
- Migrations: 066, 067, 068 aplicadas ✅

### Validación CRUD Canal Temporal
- POST `/api/telegram/channels` con `isActive=false`: creado ID=9 ✅
- PUT `/api/telegram/channels/9` editado nombre: OK ✅
- GET `/api/telegram/channels` verificado canal temporal: OK ✅
- DELETE `/api/telegram/channels/9`: OK ✅
- Verificación borrado: 0 canales restantes con chatId=-999999999001 ✅

### Validación Bundle/Frontend
- "Tokens" encontrado en bundle ✅
- "Añadir canal" encontrado en bundle ✅
- "SPOT Dry Run" encontrado en bundle ✅
- "Grid / Hybrid" encontrado en bundle ✅
- "Alertas por modo" encontrado solo como tab trigger (no como estructura principal) ✅
- "Configurar Grid Isolated" no encontrado en bundle ✅
- "Configurar alertas fiscales" no encontrado en bundle (solo en código fuente como link informativo) ✅

### Validación Logs
- Sin `DATABASE_ERROR` ✅
- Sin `ERROR CRITICAL` ✅
- Sin `NOT_FOUND` en telegram endpoints ✅
- Sin `token completo` en logs ✅

### Validación Código Fuente Local
- "Alertas por modo": solo en Telegram.tsx como tab trigger ✅
- "Configurar Grid Isolated": no encontrado ✅
- "Configurar alertas fiscales": solo en TelegramFiscoTab.tsx como link a /fiscal (aceptable) ✅
- "Añadir canal": en TelegramChannelsTab.tsx ✅
- "TelegramTokensTab": existe, importado y renderizado en Telegram.tsx ✅
- "SPOT Dry Run": en Telegram.tsx ✅
- "Grid / Hybrid": en Telegram.tsx ✅

### Tests Locales
- `npm run check`: OK ✅
- `npm run build`: OK ✅
- `telegram-refactor.test.ts`: 42/42 OK ✅

### Checklist Visual Esperada
- Tabs principales: General, Tokens, Canales, Alertas, Comandos, Auditoría ✅
- Tokens: botón Añadir token, lista tokens, token oculto ✅
- Canales: botón Añadir canal, Editar/Activar-Inactivar/Eliminar, legacy inactivos ✅
- Alertas: subpestañas SPOT Real, SPOT Dry Run, IDCA, Grid/Hybrid, Smart Exit, Fiscalidad, Sistema, IA/Shadow ✅
- Grid/Hybrid: 20 alertas configurables con enabled/severity/cooldown ✅

### Limitaciones Pendientes
- Ninguna crítica

### URL Final
http://5.250.184.18:3020/telegram?v=telegram-ux-final-eab28fc

---

## 2026-07-07 — UX 1: Auditoría frontend Telegram (en progreso)

### Tabla de auditoría

| Archivo | Resto UX encontrado | Problema | Acción aplicada |
|---------|---------------------|----------|-----------------|
| `client/src/pages/Telegram.tsx` | Alertas por modo usa Accordion | Debe usar subpestañas internas | Pendiente UX 4 |
| `client/src/components/telegram/TelegramChannelsTab.tsx` | Usa `/api/telegram/chats` | Debe usar `/api/telegram/channels` | Pendiente UX 2 |
| `client/src/components/telegram/TelegramChannelsTab.tsx` | Formulario incompleto (sin token, enabledModes, enabledAlerts) | Falta configuración completa | Pendiente UX 2 |
| `client/src/pages/InstitutionalDca.tsx` | TelegramTab con "Configurar en Telegram → IDCA" | Link fuera de /telegram | Pendiente UX 5 |
| `client/src/pages/Fisco.tsx` | Tab "Alertas Telegram" con "Configurar en Telegram → Fiscalidad" | Link fuera de /telegram | Pendiente UX 5 |
| `client/src/components/strategies/SmartExitTab.tsx` | "Configurar en Telegram → Smart Exit" | Link fuera de /telegram | Pendiente UX 5 |
| `client/src/pages/Telegram.tsx` | Falta subpestaña Tokens | No hay UI multi-token | Pendiente UX 3 |
| `client/src/components/telegram/*` | Tabs de alertas por modo incompletos | Grid sin 20 alertas configurables | Pendiente UX 4 |

### Pendiente
- UX 2: Canales formulario real funcional
- UX 3: Tokens UI real multi-bot
- UX 4: Alertas por modo en subpestañas
- UX 5: Eliminar restos Telegram fuera de /telegram
- UX 6: Conectar UI a endpoints correctos
- UX 7: Limpiar scripts temporales
- UX 8: Tests frontend/integración
- UX 9: Deploy y validación visual real
- UX 10: BITACORA.md con UX real final

---

## 2026-07-06 — Refactor Telegram FASE 6-10: Routing central + fix staging (commits 068c0fe → 1ed19e1)

### Problema
- TelegramNotificationCenter.send() usaba lógica legacy de broadcast a todos los chats activos
- No existía pipeline de routing token → canal → modo → alerta
- No había validación de alert rules, mode filtering, ni token resolution
- Audit no incluía tokenId para trazabilidad
- Comandos no validaban token del canal
- Migrations 066/067 no estaban registradas en AutoMigrationRunner → staging app reiniciando

### Solución — FASE 6: Routing central token → canal → modo → alerta
- `TelegramNotificationCenter.send()` reescrito con pipeline de 16 pasos:
  1. global kill switch → 2. silent mode → 3. severity filter → 4. quiet hours →
  5. alert rule lookup → 6. dedupe → 7. rate limit → 8. active channels →
  9. channel resolution (rule.chatId → compatible → default) →
  10. mode validation (enabledModes) → 11. alert validation (enabledAlerts) →
  12. legacy shouldSendToChat → 13. token resolution (chat.tokenId → default) →
  14. token active validation → 15. send → 16. audit with tokenId/channelId
- Nuevos block reasons: `blocked_by_token_disabled`, `blocked_by_alert_rule_disabled`,
  `blocked_by_no_matching_channel`, `blocked_by_channel_mode_not_allowed`,
  `blocked_by_channel_alert_not_allowed`, `blocked_by_missing_token`
- `sendToSpecificChat()` actualizado con token resolution y audit con tokenId
- `shared/schema.ts`: `tokenId` añadido a `telegramAlertEvents`
- Migration 066: `ALTER TABLE telegram_alert_events ADD COLUMN IF NOT EXISTS token_id`

### Solución — FASE 7: Comandos por token/canal
- `authorizeCommand()` ahora resuelve token del canal y valida que esté activo
- Retorna `tokenId` en el resultado para audit
- `registerCommandsWithTelegram()` usa catálogo de TelegramNotificationCenter (no-deprecated only)
- `handleRefreshCommands()` usa catálogo nuevo en lugar de TELEGRAM_COMMANDS legacy
- Alias deprecated resueltos a comando canonical en authorizeCommand

### Solución — FASE 8: Validación UI no duplicados
- Verificado: todas las páginas fuera de /telegram tienen controles Telegram read-only
- Notifications.tsx: display only con link a /telegram
- InstitutionalDca.tsx TelegramTab: read-only con link a /telegram
- Integrations.tsx: card con link a /telegram
- TimeStopConfigPanel.tsx: sin referencias Telegram
- No se requirieron cambios

### Solución — FASE 9: Tests
- 40 tests en `telegram-refactor.test.ts` (26 originales + 14 nuevos FASE 6/7)
- Tests cubren: alert rule disabled, rule-specified channel routing, channel mode/alert blocking,
  token missing/disabled, token resolution from channel tokenId, audit with tokenId/channelId,
  sendToSpecificChat token resolution, authorizeCommand with tokenId, deprecated alias resolution

### Solución — FASE 10: Deploy staging + fix migrations
- **Causa**: migrations 066/067 no estaban en la lista del AutoMigrationRunner en `routes.ts`
- **Fix 1**: Añadidas 066 y 067 al runner automático
- **Fix 2**: Idempotencia — `CREATE INDEX IF NOT EXISTS` y `CREATE TRIGGER` envuelto en `DO $$` block
- **Fix 3**: Migration 067 INSERT con `CROSS JOIN VALUES` en lugar de `unnest` de arrays con longitudes distintas (producía NULLs en columna NOT NULL)
- **Validación VPS staging**:
  - Container `krakenbot-staging-app` Up, no reinicia
  - Health OK: `{"status":"ok","schema":{"healthy":true,"migrationRan":true}}`
  - `telegram_bot_tokens` table existe
  - `telegram_alert_rules` table existe (15 reglas por defecto insertadas)
  - `telegram_chats` tiene `token_id`, `enabled_modes`, `enabled_alerts`
  - `telegram_alert_events` tiene `token_id`
  - `/api/telegram/tokens` responde (`[]`)
  - `/api/telegram/alert-rules` responde (15 reglas)
  - `/api/telegram/commands` responde (51 comandos)
  - `/api/telegram/grid-alert-catalog` responde (20 entradas)
  - Logs sin `DATABASE_ERROR` ni `ERROR CRITICAL`

### Archivos modificados
- `server/services/TelegramNotificationCenter.ts` — Routing pipeline, helper functions, audit con tokenId
- `server/services/telegram.ts` — registerCommandsWithTelegram y handleRefreshCommands con nuevo catálogo
- `server/routes.ts` — Migrations 066/067 añadidas al AutoMigrationRunner
- `shared/schema.ts` — tokenId en telegramAlertEvents
- `db/migrations/066_telegram_bot_tokens.sql` — Idempotencia (IF NOT EXISTS, DO $$ trigger)
- `db/migrations/067_telegram_alert_rules.sql` — Idempotencia + fix INSERT CROSS JOIN VALUES
- `server/services/__tests__/telegram-refactor.test.ts` — 40 tests
- `scripts/deploy_validate_telegram.sh` — Script de deploy/validación VPS

---

## 2026-07-06 — Refactor Telegram FASE D/E/G/H/I/J (commit d8b6852)

### Problema
- Configuración Telegram dispersa en múltiples páginas (Notifications, IDCA, FISCO, SmartExit) con duplicados editables
- Legacy chat IDs detectados por auditoría sin mecanismo seguro de importación
- Catálogo de comandos mezclaba comandos nuevos y legacy sin distinción
- Falta catálogo completo de alertas Grid con regla de lenguaje observer_only
- UI Telegram con 12 subpestañas planas, difícil de navegar
- Envíos directos a Telegram sin pasar por NotificationCenter en algunos servicios

### Solución — FASE D: Centralización UI legacy (read-only)
**Archivos modificados:**
- `client/src/pages/Notifications.tsx` — Reescrito como resumen read-only con link a Telegram > Ajustes
- `client/src/pages/InstitutionalDca.tsx` — Tab Telegram reemplazado por resumen read-only link a Telegram > IDCA
- `client/src/pages/Fisco.tsx` — Sección alert config reemplazada por resumen read-only link a Telegram > Fiscalidad
- `client/src/components/strategies/SmartExitTab.tsx` — Toggles Telegram reemplazados por resumen read-only link a Telegram > Smart Exit
- `client/src/components/telegram/TelegramSmartExitTab.tsx` — Implementado config editable real migrado desde SmartExitTab

### Solución — FASE G: Importación segura de legacy chat IDs
**Archivos modificados:**
- `server/routes.ts` — POST `/api/telegram/audit/resolve` con acciones: `register_channel` (importa como INACTIVO con flags `importedFromLegacy=true`, `needsUserReview=true`), `clear_reference` (elimina referencia legacy), `ignore` (marca issue resuelto). Audit issues enriquecidos con `source`, `chatId`, `resolvable`. Severidad WARNING para legacy importado.
- `client/src/components/telegram/TelegramAuditTab.tsx` — Botones de acción para resolver issues, toast con mensaje claro sobre importación inactiva, estilos para severidad WARNING.

### Solución — FASE J: Rerouting completo a NotificationCenter
**Archivos modificados:**
- `server/services/institutionalDca/IdcaTelegramNotifier.ts` — `send()` rerouteado a `telegramNotificationCenter.sendToSpecificChat()`
- `server/services/institutionalDca/IdcaHybridAlertService.ts` — `sendTelegram()` rerouteado a `telegramNotificationCenter.sendToSpecificChat()`
- `server/services/FiscoTelegramNotifier.ts` — `sendTextReport()` rerouteado a `telegramNotificationCenter.sendToSpecificChat()`; `sendDocument()` mantiene directo (binario)
- `server/services/fisco/FiscoAutoSyncService.ts` — Todos los `sendMessage()` rerouteados a `telegramNotificationCenter.sendToSpecificChat()`
- `server/services/ErrorAlertService.ts` — `sendCriticalError()` rerouteado a `telegramNotificationCenter.sendToSpecificChat()`
- `server/services/__tests__/telegram-refactor.test.ts` — Test de regresión: legacy import como inactivo bloquea envíos, audita `blocked_by_channel_disabled`.

### Solución — FASE I: Catálogo de comandos rehecho
**Archivos modificados:**
- `server/services/TelegramNotificationCenter.ts` — `COMMAND_DEFINITIONS` expandido: comandos nuevos en inglés organizados por módulo (general, spot, idca, grid, fisco, system), comandos legacy en español marcados `deprecated: true` con `aliasOf` al comando nuevo, campo `requiresConfirmation` para acciones peligrosas.
- `server/services/telegram.ts` — Handlers nuevos: `/status`, `/help`, `/last_alerts`, `/pause_bot`, `/resume_bot`, `/telegram_status`, `/commands`, `/health`, `/version`, `/audit`. Handlers pending para comandos registrados pero sin implementación completa (`/spot_status`, `/idca_status`, etc.). Imports `readFileSync`, `join` para VERSION.
- `server/services/__tests__/telegram-refactor.test.ts` — Tests: `/grid_status` existe en catálogo, `/idca_status` existe, `/telegram_status` es read_only, `/estado` es deprecated con alias a `/status`, comandos peligrosos requieren confirmación, read-only no requieren confirmación.

### Solución — FASE H: Catálogo completo de alertas Grid
**Nuevos archivos:**
- `server/services/institutionalDca/GridAlertTypes.ts` — 20 tipos de alerta Grid definidos con: `type`, `label`, `defaultEnabled`, `defaultSeverity`, `defaultDedupeMinutes`, `maxMessagesPerHour`, `onlyOnStateChange`, `groupByCycle`, `observerOnlyType`, `naturalTemplate`. Función `buildGridAlertMessage()` que aplica regla de lenguaje: si `observerOnly=true`, nunca "ejecutado"/"orden creada"/"compra preparada" — siempre "simulado"/"informativo"/"sin orden real".
- `server/services/institutionalDca/__tests__/GridAlertTypes.test.ts` — 5 tests: 20 tipos definidos, observer-only no usa palabras prohibidas, sanitización de wording, wording real cuando observerOnly=false, lookup por tipo.

**Archivos modificados:**
- `server/routes.ts` — GET `/api/telegram/grid-alert-catalog` expone `GRID_ALERT_DEFINITIONS`.
- `client/src/components/telegram/TelegramIdcaHybridTab.tsx` — Muestra catálogo completo con badges de severidad, badge SIMULADO para observerOnly, dedupe y max/h.

### Solución — FASE E: Reorganización UI Telegram (5 grupos)
**Archivos modificados:**
- `client/src/pages/Telegram.tsx` — Reorganizado de 12 subpestañas planas a 5 grupos lógicos: 1) General (TelegramSettingsTab), 2) Canales (TelegramChannelsTab), 3) Alertas por modo (Accordion con 8 secciones: SPOT Real, SPOT Dry Run, IDCA, IDCA Hybrid/Grid, Smart Exit, Fiscalidad, Sistema, IA), 4) Comandos (TelegramCommandsTab), 5) Auditoría (TelegramAuditTab).

### Validación
- TypeScript: sin errores
- Build: exitoso (client 2605 módulos, server 3.9mb)
- Tests Telegram: 31/31 passing (26 refactor + 5 GridAlertTypes)
- Deploy staging: `git push` + `docker compose up -d --build` exitoso
- Commit: d8b6852

---

## 2026-07-06 — Refactor Telegram FASE A/B/C (commits 0a59cb3, bb98f61, b6098e2)

### Problema
El sistema Telegram tenía múltiples problemas:
- Mensajes fantasma (phantom) enviados a chat IDs legacy de `api_config` cuando no había canales activos
- FISCO enviaba por dual-path (HTML + texto) causando duplicados
- IDCA no validaba si el chat ID estaba activo en `telegram_chats`
- ErrorAlertService generaba HTML malformado (tag `<span>` sin clase `tg-spoiler`)
- Sin kill switch global para bloquear todos los envíos
- Sin deduplicación ni rate-limiting centralizado
- Comandos sin autorización por chat
- Sin auditoría de alertas enviadas/bloqueadas/fallidas
- Configuración Telegram dispersa en múltiples páginas (Integrations, Notifications, IDCA, FISCO, SmartExit)

### Solución — FASE A: Infraestructura backend (commit 0a59cb3)

**Nuevos archivos:**
- `server/services/TelegramNotificationCenter.ts` — Autoridad central para routing de alertas
- `server/services/__tests__/telegram-refactor.test.ts` — 19 tests
- `db/migrations/065_telegram_global_config.sql` — Tablas `telegram_global_config`, `telegram_alert_events`, `telegram_command_log`

**Archivos modificados:**
- `shared/schema.ts` — Schema Drizzle para nuevas tablas
- `server/storage.ts` — Métodos storage para global config, alert events, command logs
- `server/routes.ts` — Endpoints API: `/api/telegram/global-config`, `/api/telegram/alert-events`, `/api/telegram/command-logs`, `/api/telegram/commands`
- `server/services/telegram.ts` — Eliminados fallbacks a `this.chatId` en `sendAlertWithSubtype`, `sendAlertToMultipleChats`, heartbeat, daily report; añadido guard de autorización en comandos
- `server/services/ErrorAlertService.ts` — HTML escaping en mensaje, contexto, código y stack trace; eliminada creación de instancia fallback de TelegramService
- `server/services/FiscoTelegramNotifier.ts` — Eliminado dual-path; validación de chat activo antes de enviar
- `server/services/institutionalDca/IdcaTelegramNotifier.ts` — Validación de chat activo en `telegram_chats`; channel authorization en `canSend()`
- `server/services/institutionalDca/IdcaHybridAlertService.ts` — Validación de chat activo antes de enviar

**Validación FASE A en VPS:**
- Health OK, Docker up, migración 065 aplicada
- 3 tablas creadas: `telegram_global_config`, `telegram_alert_events`, `telegram_command_log`
- Global config: `telegramGlobalEnabled: true`, `telegramSilentMode: false`, `telegramMinSeverity: LOW`
- 19 comandos con permisos correctos (read_only/action/admin)
- Sin errores CRITICAL en logs

### Solución — FASE B: UI Telegram unificada (commit bb98f61)

**Nuevos archivos:**
- `client/src/pages/Telegram.tsx` — Página principal con 12 subpestañas
- `client/src/components/telegram/TelegramSettingsTab.tsx` — Kill switch, token, silent mode, severity, dedupe, rate-limit, quiet hours, environment label
- `client/src/components/telegram/TelegramChannelsTab.tsx` — CRUD de `telegram_chats`, toggle active/inactive, alert preferences
- `client/src/components/telegram/TelegramCommandsTab.tsx` — Command definitions + command logs
- `client/src/components/telegram/TelegramSpotTab.tsx` — SPOT / Trading activo
- `client/src/components/telegram/TelegramSpotDryRunTab.tsx` — SPOT Dry Run
- `client/src/components/telegram/TelegramIdcaTab.tsx` — IDCA status + link a config detallada
- `client/src/components/telegram/TelegramIdcaHybridTab.tsx` — IDCA Hybrid/Grid (Grid Observer = "Grid simulado")
- `client/src/components/telegram/TelegramSmartExitTab.tsx` — Smart Exit notificaciones
- `client/src/components/telegram/TelegramFiscoTab.tsx` — FISCO alertas
- `client/src/components/telegram/TelegramSystemTab.tsx` — Sistema / errores críticos
- `client/src/components/telegram/TelegramAiTab.tsx` — IA / Shadow Mode / Autoafinación
- `client/src/components/telegram/TelegramAuditTab.tsx` — Auditoría / Historial (alert events + diagnostic)

**Archivos modificados:**
- `client/src/App.tsx` — Ruta `/telegram`
- `client/src/components/dashboard/Nav.tsx` — Link "TELEGRAM" en sección SISTEMA
- `client/src/components/mobile/MobileTabBar.tsx` — `/telegram` en aliases
- `client/src/pages/Integrations.tsx` — Sección Telegram reemplazada con link a `/telegram`
- `client/src/pages/Notifications.tsx` — Link a `/telegram` en header

**Validación FASE B en VPS:**
- Build OK, deploy OK, health OK
- API endpoints funcionando: global-config, commands, alert-events, command-logs

### Solución — FASE C: Saneamiento legacy + telegram:audit + ENV policy (commit b6098e2)

**Archivos modificados:**
- `server/routes.ts` — Nuevo endpoint `GET /api/telegram/audit` que detecta:
  - Chat IDs legacy en `api_config` no registrados en `telegram_chats`
  - Chat IDs de IDCA/FISCO no registrados o inactivos
  - ENV fallback (TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID) presente pero ignorado correctamente
  - Canales huérfanos inactivos no referenciados por ningún módulo
- `server/services/telegram.ts` — `sendMessage()` ahora respeta kill switch global (ENV fallback policy)
- `client/src/components/telegram/TelegramAuditTab.tsx` — UI de diagnóstico con badges de severidad y recomendaciones

**Validación FASE C en VPS:**
- `GET /api/telegram/audit` responde correctamente
- Detecta 3 issues HIGH: chat IDs de api_config, IDCA y FISCO no registrados en `telegram_chats`
- ENV fallback: política correcta (ignorado si global OFF o sin canales activos)
- `sendMessage()` respeta kill switch global

### Estado final
- **3 fases completadas y validadas en VPS staging**
- **19/19 tests passing**
- **3 commits pushed a origin/main**: `0a59cb3`, `bb98f61`, `b6098e2`
- **Pendiente**: Registrar los chat IDs legacy (`-1002639300934`, `-10024116945102`, `-1003504297101`) en `telegram_chats` o eliminarlos de las configs de cada módulo

---

## 2026-07-06 — Fix: gridAllocationMode no se guardaba en DB (commit 9405cba)

### Problema
Al cambiar "Modo de reparto de capital" en la UI (Cartera → Configuración de Capital), el valor seleccionado (uniform, progressive_conservative, progressive_aggressive, adaptive_market) no persistía. Al refrescar la página volvía a "uniform".

### Causa raíz
El método `saveConfig()` en `server/services/gridIsolated/gridIsolatedEngine.ts` no incluía los 5 campos de capital allocation en el objeto `values` que se persiste a la DB:
- `gridAllocationMode`
- `gridCapitalDeploymentMode`
- `gridProgressiveIntensity`
- `gridMaxLevelPct`
- `gridMinLevelUsd`

El endpoint `POST /api/grid-isolated/config` sí los aceptaba en `allowedFields` y los guardaba en `this.config` en memoria, pero al llamar `saveConfig()` los campos no se escribían a la fila de `grid_isolated_configs`. Al recargar, `loadConfig()` leía la DB (donde el valor seguía siendo el default `uniform`) y el cambio se perdía.

### Corrección
Añadidos los 5 campos al objeto `values` en `saveConfig()`:
```typescript
gridAllocationMode: this.config.gridAllocationMode,
gridCapitalDeploymentMode: this.config.gridCapitalDeploymentMode,
gridProgressiveIntensity: this.config.gridProgressiveIntensity.toFixed(2),
gridMaxLevelPct: this.config.gridMaxLevelPct.toFixed(2),
gridMinLevelUsd: this.config.gridMinLevelUsd.toFixed(2),
```

### Archivo modificado
- `server/services/gridIsolated/gridIsolatedEngine.ts` — líneas 233-238

### Validaciones
- `npx tsc --noEmit`: OK
- `npx vitest run` (3 suites, 127 tests): 127/127 pass
- Bug confirmado en staging antes del fix: POST config con `gridAllocationMode=adaptive_market` devolvía `null`
- Pendiente: deploy a staging + validación API curl

### Estado final
- El fix está committed y pushed (`9405cba`)
- **No desplegado en staging** — pendiente aprobación de deploy

### Notas
- No se tocaron IDCA, FISCO, REAL, órdenes reales, niveles, ciclos ni DB manualmente
- Cambiar `gridAllocationMode` solo afecta a futuras generaciones de niveles, no regenera niveles existentes

---

## 2026-07-05 — Rebuild seguro de niveles planned antiguos (commit 9b09435)

### Problema

Tras el deploy del fix `208ea3d`, los niveles planned antiguos en DB seguían mostrando SELL=$60 (creados antes del fix). El código nuevo solo afectaría a nuevos rangos/niveles.

### Por qué no se usó SQL manual

- Riesgo de incoherencias entre rango activo, levelsSummary, eventos de auditoría, export ChatGPT, UI e histórico filled/replaced.
- Se decidió usar el motor para regenerar niveles de forma segura.

### Método seguro usado

Se implementó endpoint interno `POST /api/grid-isolated/rebuild-planned-levels` (commit `9b09435`):

**Método en `GridIsolatedEngine.rebuildPlannedLevels()`:**
1. Validar mode = OFF o SHADOW (nunca REAL)
2. Validar `realOpenOrdersCount = 0`
3. Validar `openCycles = 0`
4. Validar no hay niveles con `exchangeOrderId`
5. Validar no hay niveles `filled` en rango activo
6. Marcar rango activo como `replaced`
7. Marcar niveles planned antiguos como `replaced`
8. Generar nuevo rango + niveles con código actualizado (`proposeRangeVersion`)
9. Emitir eventos: `GRID_LEVELS_REPLACED`, `GRID_LEVELS_REBUILT`, `GRID_RANGE_REBUILT_MANUAL`

**Archivos nuevos/modificados:**
- `server/services/gridIsolated/gridIsolatedEngine.ts` — método `rebuildPlannedLevels()`
- `server/routes/gridIsolated.routes.ts` — endpoint `POST /api/grid-isolated/rebuild-planned-levels`
- `server/services/gridIsolated/gridIsolatedTypes.ts` — `GRID_RANGE_REBUILT_MANUAL` en `GridEventType`
- `server/services/gridIsolated/gridActivityFormatter.ts` — mapping para `GRID_RANGE_REBUILT_MANUAL`

### Guardas verificadas antes del rebuild

- mode = SHADOW ✅ (no REAL)
- realOpenOrdersCount = 0 ✅
- openCycles = 0 ✅
- exchangeOrderId = NULL en todos los niveles planned ✅
- No niveles filled en rango activo ✅

### Resultado del rebuild

| Métrica | Antes | Después |
|---|---|---|
| Rango activo | `5221cfca-...` | `e7ad49bc-...` |
| Niveles planned antiguos | 10 (replaced) | — |
| Niveles planned nuevos | — | 10 |
| BUY total | $600.00 | $600.00 |
| Cada BUY | $120.00 | $120.00 |
| SELL total | $300.00 (5 × $60) | $626.42 (5 × ~$125) |
| Cada SELL | $60.00 | $125.04–$125.53 |
| Capital USD necesario | $600.00 | $600.00 |
| Notional bruto visual | $900.00 | $1,226.42 |
| SELL computa USD | No | No |

### Validación post-rebuild

- `mode = OFF` ✅ (restaurado)
- `isActive = false` ✅
- `isRunning = false` ✅
- `realOpenOrdersCount = 0` ✅
- `openCycles = 0` ✅
- `exchangeOrderId = NULL` en nuevos planned ✅
- Niveles filled históricos no tocados ✅
- Niveles replaced históricos no tocados ✅
- Eventos de auditoría emitidos: `GRID_LEVELS_REPLACED`, `GRID_LEVELS_REBUILT`, `GRID_RANGE_REBUILT_MANUAL` ✅
- `capitalAllocationSummary`:
  - `plannedBuyUsd = 600` ✅
  - `plannedSellNotionalUsd = 626.42` ✅ (suma real, no artificial)
  - `grossVisualNotionalUsd = 1226.42` ✅
  - `usdActuallyNeededForBuyLevels = 600` ✅
  - `usdNotNeededBecauseSellLevelsDoNotConsumeUsd = 626.42` ✅
- `tsc --noEmit`: ✅
- `vitest`: 127/127 ✅
- Logs sin errores ✅

### Estado final

- Grid OFF ✅
- No IDCA ✅
- No FISCO ✅
- No REAL ✅
- No órdenes reales ✅
- BITACORA.md actualizado ✅

---

## 2026-07-05 — Fix semántica SELL en tabla de niveles y capitalAllocationSummary

### Problema detectado visualmente

En la tabla de Niveles se observaba:
- SELL #1-#5 con "Capital" = $60 cada uno
- BUY #6-#10 con "Capital" = $120 cada uno

Esto generaba confusión porque:
1. BUY sí consume USD ($120 correcto)
2. SELL no consume USD, pero mostraba $60 sin contexto
3. La columna se llamaba "Capital", pero en SELL no es capital real
4. `capitalAllocationSummary` decía `plannedSellNotionalUsd = $600` (artificial: 5 × $120)
5. La tabla/DB mostraba SELL total = $300 (5 × $60 real)
6. **Divergencia confirmada entre audit ($600) y DB/UI ($300)**

### Causa raíz

1. `gridCapitalAllocator.allocate()` calcula `capitalPerLevelUsd = $600 / 10 = $60` (divide entre todos los niveles)
2. `generateGeometricLevels()` crea 5 BUY + 5 SELL, **todos** con `notionalUsd = $60`
3. `applyWeightsToGeneratedLevels()` redistribuye **solo BUY** → cada BUY pasa a $120
4. **SELL nunca se actualiza** → se queda con $60 residual de la generación inicial
5. `buildCapitalAllocationSummary()` calcula `plannedSellNotionalUsd = sellLevelsCount × firstBuy.notionalUsd` = 5 × $120 = $600 (artificial)

### Fórmula final aplicada para SELL

```
SELL notionalUsd = pairedBuy.quantity × sell.price
```

- Cada SELL vende la cantidad de BTC que el BUY correspondiente compraría
- El precio del SELL es mayor que el del BUY → SELL notional > BUY notional
- SELL incluye implícitamente el beneficio objetivo
- SELL sigue sin consumir USD (`capitalImpactType = requires_base_asset_not_usd`)

### Correcciones aplicadas

**Archivo: `server/services/gridIsolated/gridAllocationEngine.ts`**

1. `applyWeightsToGeneratedLevels()`: después de redistribuir BUY, actualiza cada SELL:
   - `notionalUsd = pairedBuy.quantity × sell.price`
   - `quantity = pairedBuy.quantity` (misma cantidad de BTC)
   - `netProfitTargetUsd`, `feeEstimateUsd`, `taxReserveUsd` recalculados
   - `capitalImpactType = requires_base_asset_not_usd`
   - `allocationReason = "SELL teórico: no consume USD; requiere BTC/inventario"`

2. `buildCapitalAllocationSummary()`:
   - Nuevo parámetro `sellNotionalTotal` en `BuildSummaryParams`
   - `plannedSellNotionalUsd` ahora usa el valor real (suma de SELL notionalUsd)
   - Fallback a cálculo anterior solo si `sellNotionalTotal = 0`

**Archivo: `server/routes/gridIsolated.routes.ts`**

3. Audit endpoint: pasa `sellNotionalTotal` real (suma de `sellLevels[].notionalUsd`) al summary
4. ChatGPT export: texto actualizado con explicación de emparejamiento BUY-SELL y notional visual vs capital real

**Archivo: `client/src/components/grid/GridLevelsPanel.tsx`**

5. Columna "Capital" → "Importe / Notional"
6. Celda: BUY en ámbar ("Consume USD si se ejecuta."), SELL en azul ("No consume USD. Requiere BTC/inventario.")
7. Cards de resumen encima de la tabla:
   - Capital USD en BUY
   - Notional visual SELL
   - Capital USD necesario
   - Notional bruto visual
   - SELL computa USD: No
8. Disclaimer: "Los SELL no consumen USD. Son objetivos teóricos de venta..."
9. Modal: "Capital USD asignado" (BUY) / "Notional visual venta" (SELL)
10. Modal: explicaciones específicas BUY/SELL

### Tests

**Archivo: `server/services/__tests__/gridWeightedLevels.test.ts`**

- Test "SELL levels retain visual notionalUsd" → actualizado a "SELL levels have visual notionalUsd derived from paired BUY quantity × SELL price"
- 10 tests nuevos en bloque "SELL notional consistency: $600 budget, 5 BUY, 5 SELL, uniform":
  - BUY total = 600
  - Cada BUY = 120
  - SELL capitalImpactType correcto
  - BUY capitalImpactType correcto
  - plannedSellNotionalUsd = suma real (no artificial)
  - grossVisualNotionalUsd = plannedBuyUsd + plannedSellNotionalUsd
  - usdActuallyNeededForBuyLevels = plannedBuyUsd
  - usdNotNeededBecauseSellLevelsDoNotConsumeUsd = plannedSellNotionalUsd
  - SELL notional > paired BUY notional
  - SELL quantity = paired BUY quantity

### Validaciones

- `tsc --noEmit`: ✅ sin errores
- `vitest gridIsolatedRoutes`: ✅ 66/66
- `vitest gridAllocationEngine`: ✅ 26/26
- `vitest gridWeightedLevels`: ✅ 35/35 (10 tests nuevos)
- **Total: 127/127 ✅**

### Valores ejemplo (uniform, $600 budget)

| Concepto | Valor |
|---|---|
| BUY total | $600.00 |
| Cada BUY | $120.00 |
| SELL notional visual total | ~$607-610 (ligeramente > $600) |
| Cada SELL | ~$121-122 (pairedBuy.qty × sell.price) |
| Capital USD realmente necesario | $600.00 |
| Notional bruto visual | ~$1,207-1,210 |
| SELL computa USD | No |

### Estado final

- BUY no se rompió: sigue $120 cada uno, $600 total ✅
- Hard cap $600 no se rompió ✅
- Tabla, audit y export coinciden ✅
- No IDCA · No FISCO · No REAL · No órdenes reales
- Grid sigue OFF
- **NO se ha hecho deploy** (pendiente aprobación)

---

## 2026-07-05 — api1: Campos fecha/duración en audit/export ChatGPT

### Objetivo

Exponer los mismos datos de fechas/duración que se ven en UI en los endpoints API:
- `/api/grid-isolated/monitor/audit`
- `/api/grid-isolated/export/chatgpt`
- `/api/grid-isolated/export/json`

### Cambios realizados

**Archivo:** `server/routes/gridIsolated.routes.ts`

**Nuevas funciones helper** (puras, sin side effects):

| Función | Descripción |
|---|---|
| `fmtDateEs(v)` | Formatea fecha a es-ES DD/MM/YYYY HH:mm:ss |
| `durationLabel(fromMs, toMs, suffix)` | Calcula duración "duró Xh Ym" / "abierto hace Xh Ym" |
| `getLevelFinishedAt(level)` | Devuelve Date según status: filled→filledAt, cancelled→cancelledAt/updatedAt, replaced→replacedAt/updatedAt |
| `getLevelFinishedReason(status)` | "Pendiente" / "Ejecutado" / "Reemplazado" / "Cancelado" / "Expirado" |
| `enrichLevelTiming(level)` | Añade: createdAt, finishedAt, finishedReason, durationMs, durationLabel, statusLabel, capitalImpactType |
| `getCycleOpenedAt(cycle)` | openedAt → buyFilledAt → createdAt |
| `getCycleClosedAt(cycle)` | closedAt → completedAt → sellFilledAt → updatedAt (si cerrado) |
| `enrichCycleTiming(cycle)` | Añade: openedAt, closedAt, durationMs, durationLabel, statusLabel |

**Endpoints enriquecidos:**

1. `/monitor/audit`:
   - `levels[]`: cada nivel con timing completo
   - `cycles[]`: cada ciclo con timing completo
   - `levelsSummary.currentLevels[]`: enriquecidos con timing
   - `levelsSummary.historicalLevels[]`: enriquecidos con timing

2. `/export/chatgpt`:
   - Por cada nivel (primeros 5): "Nivel BUY creado el 05/07/2026 14:32:10. Sigue pendiente desde hace 1h 12m."
   - Por cada ciclo (primeros 5): "Ciclo #1 abierto el 05/07/2026 14:35:00 y cerrado el 05/07/2026 15:10:00. Cerrado, duró 35m."

3. `/export/json`:
   - `levels[]` y `cycles[]` enriquecidos con timing

**Reglas de `capitalImpactType`:**
- BUY → `consumes_usd`
- SELL → `requires_base_asset_not_usd`

**Reglas de `finishedAt`:**
- `filled` → `filledAt`
- `cancelled` → `cancelledAt` (fallback `updatedAt`)
- `replaced` → `replacedAt` (fallback `updatedAt`)
- `planned`/`open`/`active` → `null`

### Tests añadidos

**Archivo:** `server/routes/__tests__/gridIsolatedRoutes.test.ts`

| Test | Verifica |
|---|---|
| `monitor/audit levels include timing fields` | createdAt, finishedAt, finishedReason, durationMs, durationLabel, statusLabel, capitalImpactType en todos los niveles |
| `levelsSummary.currentLevels include timing fields` | statusLabel, capitalImpactType, durationLabel |
| `levelsSummary.historicalLevels include timing fields` | statusLabel, capitalImpactType |
| `monitor/audit cycles include timing fields` | openedAt, closedAt, durationMs, durationLabel, statusLabel |
| `export chatgpt handles empty levels/cycles gracefully` | No rompe sin datos |
| `export/json includes enriched levels with timing fields` | statusLabel, capitalImpactType, durationLabel en levels y cycles |

### Validaciones

- `tsc --noEmit`: ✅ sin errores
- `vitest gridIsolatedRoutes`: ✅ 66/66 (6 tests nuevos)
- `vitest gridAllocationEngine`: ✅ 26/26
- `vitest gridWeightedLevels`: ✅ 25/25
- **Total: 117/117 ✅**

### Estado final

- No se añadieron columnas a DB
- No IDCA · No FISCO · No REAL · No órdenes reales
- Grid sigue OFF

---

## 2026-07-05 — val1: Validación capitalAllocationSummary con SHADOW temporal

### Procedimiento

1. Guardado estado inicial: `mode=OFF, isActive=false`
2. Cambiado a `SHADOW` + `isActive=true`
3. Ejecutado `shadow-validate` (tick de simulación)
4. Consultado `/monitor/audit` para inspeccionar `capitalAllocationSummary`
5. Desactivado motor: `isActive=false`
6. Devuelto a `OFF`

### Resultados con budget $600 (uniform)

| Campo | Valor esperado | Valor real | OK |
|---|---|---|---|
| `buyLevelsCount` | > 0 | 5 | ✅ |
| `sellLevelsCount` | > 0 | 5 | ✅ |
| `plannedBuyUsd` | > 0 | 600 | ✅ |
| `plannedSellNotionalUsd` | > 0 | 600 | ✅ |
| `usdActuallyNeededForBuyLevels` | = plannedBuyUsd | 600 | ✅ |
| `usdNotNeededBecauseSellLevelsDoNotConsumeUsd` | = plannedSellNotionalUsd | 600 | ✅ |
| `grossVisualNotionalUsd` | = plannedBuyUsd + plannedSellNotionalUsd | 1200 | ✅ |
| `perLevelAllocations` | no vacío | 5 entradas | ✅ |
| BUY `capitalImpactType` | `consumes_usd` | `consumes_usd` | ✅ |
| SELL `capitalImpactType` | `requires_base_asset_not_usd` | `requires_base_asset_not_usd` | ✅ |

### Per-level allocations (uniform, $600 budget)

| Level | Side | Weight | Allocation | Reason |
|---|---|---|---|---|
| 0 | BUY | 1 | $120 | Uniforme |
| 1 | BUY | 1 | $120 | Uniforme |
| 2 | BUY | 1 | $120 | Uniforme |
| 3 | BUY | 1 | $120 | Uniforme |
| 4 | BUY | 1 | $120 | Uniforme |

5 × $120 = **$600** = budget ✅

### Estado final tras validación

```json
{
  "mode": "OFF",
  "isActive": false,
  "isRunning": false,
  "plannedLevelsCount": 45,
  "realOpenOrdersCount": 0
}
```

- Grid devuelto a OFF ✅
- Motor desactivado ✅
- 0 órdenes reales ✅
- No IDCA · No FISCO · No REAL

---

## 2026-07-05 — Limpieza doc + Fechas en tablas Niveles/Ciclos

### 1. Eliminación de CORRECCIONES_Y_ACTUALIZACIONES.md

`CORRECCIONES_Y_ACTUALIZACIONES.md` eliminado del repositorio. Era fuente paralela obsoleta; todo su contenido estaba ya en commits o en esta `BITACORA.md`.

**Comprobación post-eliminación:**
```
grep -R "CORRECCIONES_Y_ACTUALIZACIONES" . --exclude-dir=node_modules --exclude-dir=.git
→ Solo referencias históricas en docs/*.md de auditoría (no código fuente)
```

**Única fuente oficial: `BITACORA.md`**

### 2. Tabla de Niveles — nuevas columnas Creado / Finalizado / Duración

**Archivo:** `client/src/components/grid/GridLevelsPanel.tsx`

Columnas añadidas a la tabla (sin migración DB — usan campos ya existentes):

| Columna | Fuente | Lógica |
|---|---|---|
| **Estado final** | `status` | Localizado: Planificado / Activo / Ejecutado / Reemplazado / Cancelado |
| **Capital** | `notionalUsd` | Desplazado a posición más visible |
| **Beneficio objetivo** | `netProfitTargetUsd` | Compactado a `+X $` |
| **Creado** | `createdAt` | DD/MM/YYYY HH:mm:ss (es-ES) |
| **Finalizado** | `filledAt` si filled / `cancelledAt` si cancelled|replaced / "Pendiente" si planned | Calculado en UI, sin columna nueva |
| **Duración** | `createdAt` → `filledAt`/`cancelledAt`/`Date.now()` | "duró Xh Ym" o "hace Xh Ym" |

Nuevas funciones helpers (puras, sin side effects):
- `fmtDate(v)` — formatea cualquier fecha a es-ES DD/MM/YYYY HH:mm:ss
- `durationLabel(fromMs, toMs, suffix)` — calcula duración en Xh Ym
- `getLevelFinishedAt(level)` — devuelve Date|null según status
- `getLevelFinishedLabel(level)` — texto "Pendiente" / fecha formateada
- `getLevelStatusLabel(status)` — etiqueta natural española

**Modal de nivel** actualizado con:
- Fila "Creado" con fecha formateada
- Fila "Finalizado" (verde si terminado, gris si pendiente)
- Fila "Duración" (azul, "abierto hace..." / "duró...")
- Fila "Estado natural" en español
- Fila "Impacto capital": BUY → "Consume USD 💵" / SELL → "Requiere BTC/inventario 🔷"
- Textos obligatorios diferenciados BUY/SELL

### 3. Tabla de Ciclos — Reescritura completa GridCyclesPanel.tsx

**Archivo:** `client/src/components/grid/GridCyclesPanel.tsx` (reescrito completamente)

Columnas añadidas a la tabla:

| Columna | Fuente | Lógica |
|---|---|---|
| **Apertura** | `openedAt` → `buyFilledAt` → `createdAt` | Preferencia en orden |
| **Cierre** | `closedAt` → `completedAt` → `sellFilledAt` → `updatedAt` si closed | Fallback encadenado |
| **Duración** | Apertura → Cierre (o ahora si abierto) | "duró Xh Ym" / "hace Xh Ym" |
| **Estado** | `status` | Localizado: Abierto / Compra ejecutada / Cerrado / Cancelado |

Añadido:
- Paginación (10/25/50 por página)
- `showViewAll` prop para botón "Ver todos"
- Modal de detalle con: ID, par, estado, BUY/SELL precios, cantidad, capital usado, PnL bruto/fees/fiscal/neto, apertura, cierre, duración, BUY/SELL filledAt, holdTimeMinutes, levelIds, orderIds

No se añadieron columnas a DB. Toda la lógica de fechas se calcula en UI usando campos existentes (`createdAt`, `filledAt`, `cancelledAt`, `sellFilledAt`, `completedAt`, `updatedAt`).

### Validaciones

- `tsc --noEmit`: ✅ sin errores
- `vitest gridAllocationEngine`: ✅ 26/26
- `vitest gridWeightedLevels`: ✅ 25/25
- `vitest gridIsolatedRoutes`: ✅ 60/60
- **Total: 111/111 ✅**

### Estado final

- Grid en OFF durante todo el proceso
- No IDCA · No FISCO · No REAL · No órdenes reales
- `BITACORA.md` = única fuente oficial

---

## 2026-07-01 — Grid Capital Allocation Refactor

**Objetivo:** Refactorizar completamente la lógica de reparto de capital del Grid Aislado. Corregir el bug donde `gridMaxCapitalPerCycleUsd` era ignorado por el allocator. Añadir modos de reparto (uniform, progressive_conservative, progressive_aggressive, adaptive_market). Exponer un resumen canónico BUY/SELL en la API y la UI. Aclarar que los niveles SELL no consumen USD.

### Auditoría: fórmula real de $86.35

La fórmula que producía `$86.35/nivel` en staging era:

```
totalBalance = $3,454
Perfil: balanced → maxCapitalPctOfBalance = 25%, reservePct = 20%, maxLevels = 12, minNotional = $30, maxNotional = $800

reservedAmount = $3,454 × 20% = $690.80
availableForGrid = $3,454 − $690.80 = $2,763.20
maxGridCapital = $3,454 × 25% = $863.50
finalBudget = min($2,763.20, $863.50) = $863.50

effectiveLevels = min(10, 12) = 10
capitalPerLevel = $863.50 / 10 = $86.35  ← sin clamp

5 BUY × $86.35 = $431.75 USD realmente necesarios
5 SELL × $86.35 = $431.75 notional VISUAL — NO consume USD (requiere BTC/inventario)
```

**Bug corregido:** `gridMaxCapitalPerCycleUsd = 600` era almacenado en DB pero **nunca se aplicaba** como cap al allocator. Ahora se pasa como hard cap vía `constraints.maxCapitalPerCycleUsd`.

### Regla canónica BUY/SELL

- **Niveles BUY**: consumen USD real. `plannedBuyUsd = buyLevelsCount × notionalUsd`.
- **Niveles SELL**: objetivos de salida. Requieren BTC/inventario, **NO consumen USD**. El campo `notionalUsd` en SELL es visual.
- **Notional bruto** (BUY + SELL) ≠ capital USD necesario.
- **Presupuesto no usado**: es normal si el modo es `capped` (conservador por diseño).

### Archivos nuevos

| Archivo | Descripción |
|---|---|
| `server/services/gridIsolated/gridAllocationEngine.ts` | Funciones puras: pesos, distribución, summary |
| `server/services/__tests__/gridAllocationEngine.test.ts` | 26 tests unitarios |

### Archivos modificados

| Archivo | Cambio |
|---|---|
| `shared/schema.ts` | +5 columnas: `grid_allocation_mode`, `grid_capital_deployment_mode`, `grid_progressive_intensity`, `grid_max_level_pct`, `grid_min_level_usd` |
| `server/storage.ts` | +5 migraciones automáticas `ADD COLUMN IF NOT EXISTS` |
| `server/services/gridIsolated/gridIsolatedTypes.ts` | +`AllocationMode`, `CapitalDeploymentMode`, `CapitalAllocationSummary`, `PerLevelAllocation`; +5 campos en `GridIsolatedConfig` y `DEFAULT_GRID_CONFIG` |
| `server/services/gridIsolated/gridCapitalAllocator.ts` | `allocate()` acepta `GridCapitalConstraints`; aplica `maxCapitalPerCycleUsd` como hard cap |
| `server/services/gridIsolated/gridIsolatedEngine.ts` | `loadConfig()` mapea los 5 nuevos campos; `proposeRangeVersion()` pasa constraints al allocator |
| `server/routes/gridIsolated.routes.ts` | `allowedFields` +5 campos; `levelsSummary.capitalAllocationSummary` en audit; ChatGPT export con BUY/SELL breakdown |
| `client/src/components/grid/GridCarteraDashboard.tsx` | Panel "Reparto real de capital del Grid" con cards BUY/SELL, barra de uso, explicación, tabla per-level, selector de modo |
| `client/src/components/grid/GridAjustesPanel.tsx` | +`auditData` prop → pasa a `GridCarteraDashboard` |
| `client/src/pages/GridIsolated.tsx` | Pasa `auditData` a `GridAjustesPanel` |
| `server/routes/__tests__/gridIsolatedRoutes.test.ts` | +3 tests: capitalAllocationSummary en audit, chatgpt crash check |

### Modos de reparto implementados

| Modo | Comportamiento |
|---|---|
| `uniform` | Igual capital por nivel BUY (default) |
| `progressive_conservative` | Peso_i = 1 + intensity × i (conservative, default intensity=0.20) |
| `progressive_aggressive` | Peso_i = 1 + intensity × i (aggressive, default intensity=0.45) |
| `adaptive_market` | Peso por distancia al precio actual × factor régimen |

### Modos de uso de presupuesto

| Modo | Comportamiento |
|---|---|
| `capped` | Hasta el máximo configurado, sin forzar gasto total (default) |
| `target_budget` | Intenta aproximarse al máximo; el sobrante es mínimo |

### Validaciones

- `tsc --noEmit`: ✅ sin errores
- `vitest gridAllocationEngine`: ✅ 26/26
- `vitest gridIsolatedRoutes`: ✅ 60/60

### Aplicación de pesos reales en generación de niveles (r12 — completado)

**Problema:** `generateGeometricLevels()` asignaba `capitalPerLevelUsd` uniforme a todos los niveles BUY, ignorando el modo de reparto configurado.

**Solución implementada (2 pasos, sin migración DB):**

**Paso 1 — `gridGeometricLevels.ts`:**
- Nuevo tipo `CapitalImpactType = "consumes_usd" | "requires_base_asset_not_usd"`
- `GeneratedLevel` ahora incluye: `capitalImpactType`, `allocationWeight`, `allocationReason`
- BUY defaults: `capitalImpactType = "consumes_usd"`, weight = 1.0
- SELL defaults: `capitalImpactType = "requires_base_asset_not_usd"`, weight = 0

**Paso 2 — `gridAllocationEngine.ts`:**
- Nueva función `applyWeightsToGeneratedLevels(levels, effectiveBuyBudget, allocationMode, ...)`
- Muta los niveles BUY en-place: actualiza `notionalUsd`, `quantity`, `netProfitTargetUsd`, `feeEstimateUsd`, `taxReserveUsd`
- Marca los niveles SELL con los metadatos correctos
- El `notionalUsd` resultante queda persistido en DB con el valor correcto ponderado

**Paso 3 — `gridIsolatedEngine.ts` `proposeRangeVersion()`:**
- Llama a `applyWeightsToGeneratedLevels` DESPUÉS de `generateGeometricLevels` y ANTES de la inserción en DB
- Los niveles se persisten con el `notionalUsd` real ponderado

**Nuevo archivo de tests — `gridWeightedLevels.test.ts` (25 tests):**
- Invariantes de `capitalImpactType` por lado
- Cap de presupuesto BUY
- Floor `minLevelUsd`
- Modo uniform: todos iguales
- Modo progressive_conservative: BUY[0] < BUY[1] < ... (monotonía)
- Modo progressive_aggressive: pendiente más pronunciada
- Ejemplo real: $3454 balance, perfil balanced, cap $600
  - `computeEffectiveBuyBudget(863.5, 600, "capped", 5, 30) = 600` ✅
  - Uniform: 5 BUY × $120 = $600 total ✅
  - Progressive: suma ≈ $600, nivel más profundo > $120 ✅
  - SELL: visual, `capitalImpactType = "requires_base_asset_not_usd"` ✅
- Adaptive market: pesos por distancia
- Edge cases: budget 0, banda muy estrecha

**Validaciones finales:**
- `tsc --noEmit`: ✅ sin errores
- `vitest gridAllocationEngine`: ✅ 26/26
- `vitest gridWeightedLevels`: ✅ 25/25
- `vitest gridIsolatedRoutes`: ✅ 60/60
- **Total: 111/111 ✅**

### Pendiente

- Deploy staging: requiere aprobación explícita.

---

## 2026-04-27 — Refactor IDCA Telegram Alerts (Sliders UI + Anti-spam)

**Objetivo:** Eliminar spam en alertas Telegram IDCA, proporcionar información accionable, y permitir configuración vía UI con sliders profesionales.

**Commits:**
- **C** (aa9ea5b): Schema + sliders + derivación
  - `entryUiJson` + `telegramUiJson` en institutional_dca_config (nullable JSONB)
  - Migración 031_idca_slider_config.sql
  - `IdcaSliderConfig.ts` con defaults profesionales (BTC dip 4.20%, ETH dip 4.60%, rebote 0.55%/0.65%)
  - `IdcaEngine.ts` usa `getEffectiveEntryConfig` en lugar de hardcoded
  - 32 tests nuevos

- **D** (b6fbb96): UI sliders entrada + alertas Telegram IDCA
  - ConfigTab: sub-pestaña "Entrada" (por defecto) con 4 sliders + resumen calculado
  - TelegramTab: card "ALERTAS IDCA" con 3 sliders reemplaza panel complejo de toggles
  - Helpers client-side `lerpUI`, `deriveEntryPreview`, `deriveAlertPreview`

- **E** (af616c8): Cooldowns dinámicos desde sliders
  - `IdcaTelegramAlertPolicy.ts`: `resolveTrailingBuyPolicyWithSliders`
  - `IdcaTrailingBuyTelegramState.ts`: `watchingMinIntervalMs` opcional
  - `IdcaTelegramNotifier.ts`: WATCHING y TRACKING usan cooldowns dinámicos

- **F** (98ff9e9): Digest usa cooldowns dinámicos
  - `IdcaEngine.ts`: digest usa `resolveTrailingBuyPolicyWithSliders`

- **Fix** (7c928a0): Auto-migración 031 en storage.ts
  - Añadido `entryUiJson` y `telegramUiJson` a `runSchemaMigration()`

**Archivos nuevos:**
- `server/services/institutionalDca/IdcaSliderConfig.ts` — Configuración slider con interpolación
- `db/migrations/031_idca_slider_config.sql` — Migración DB
- `server/services/__tests__/idcaSliderConfig.test.ts` — 32 tests

**Archivos modificados:**
- `shared/schema.ts` — entryUiJson + telegramUiJson
- `server/services/institutionalDca/IdcaEngine.ts` — usa getEffectiveEntryConfig
- `server/services/institutionalDca/IdcaTelegramAlertPolicy.ts` — resolveTrailingBuyPolicyWithSliders
- `server/services/institutionalDca/IdcaTelegramNotifier.ts` — WATCHING/TRACKING usan sliders
- `server/services/institutionalDca/IdcaTrailingBuyTelegramState.ts` — watchingMinIntervalMs opcional
- `server/storage.ts` — auto-migración 031
- `client/src/hooks/useInstitutionalDca.ts` — IdcaConfig interface
- `client/src/pages/InstitutionalDca.tsx` — UI sliders entrada + alertas

**Validación:**
- npm run check: 
- npm run build: 
- vitest: 98/98 tests pasando

**Deploy VPS:**
```bash
cd /opt/krakenbot-staging
git pull origin main
docker compose -f docker-compose.staging.yml up -d --build
```
La migración 031 se aplica automáticamente al arrancar via `storage.ts::runSchemaMigration()`.

---

## ARQUITECTURA GENERAL

┌──────────────────────────────────────────────────────────────────┐
│                     ExchangeFactory (singleton)                   │
│                  Kraken  ←→  RevolutX                             │
│     Trading exchange / Data exchange (configurable)               │
└────────────┬─────────────────────────────────┬───────────────────┘
             │                                 │
             ▼                                 ▼
┌────────────────────────┐     ┌──────────────────────────────────┐
│  MarketDataService     │     │  tradingEngine (Modo Normal)     │
│  (cache unificado)     │     │  SmartGuard + Momentum + Candles │
│  TTLs: 15m/1h/1d/spot │     │  + ExitManager + FillWatcher     │
└────────┬───────────────┘     └──────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────────┐
│                     IdcaEngine (Modo IDCA)                        │
│  ┌──────────────┐  ┌────────────────┐  ┌──────────────────────┐ │
│  │IdcaSmartLayer│  │TrailingBuyMgr  │  │IdcaMessageFormatter  │ │
│  │(VWAP,rebound │  │(trailing stop  │  │(mensajes humanos +   │ │
│  │ ATR,basePrice│  │ buy inverso)   │  │ técnicos Telegram)   │ │
│  │ safetyOrders)│  │                │  │                      │ │
│  └──────────────┘  └────────────────┘  └──────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

### Exchanges soportados
- **Kraken**: API completa (OHLC, ticker, balance, orders, fills). Rate limiter FIFO con backpressure + estado degradado.
- **RevolutX**: Orders, fills, balances. Sin ticker/OHLC → usa Kraken como data source. `pendingFill` → FillWatcher monitorea.

### Modos de operación
- **NORMAL**: SmartGuard (BE + trailing + scale-out + time-stop)
- **IDCA**: Institutional DCA (ciclos, safety orders, TP dinámico, VWAP)
- **DRY_RUN**: Simulación sin órdenes reales (ambos modos)

---

## 🏗️ ESTRUCTURA DEL PROYECTO

```
server/
  services/
    tradingEngine.ts          ← Motor principal (modo Normal)
    exitManager.ts            ← SL/TP/BE/Trailing/Scale-out/Time-stop
    FillWatcher.ts            ← Reconciliación de fills pendientes
    MarketDataService.ts      ← Cache unificado velas+precios (TTL)
    strategies.ts             ← momentumCandlesStrategy
    telegram.ts               ← Multi-chat, alertas, polling
    ErrorAlertService.ts      ← Alertas críticas (instancia inyectada)
    botLogger.ts              ← Eventos + retención configurable
    kraken.ts                 ← Kraken API wrapper
    BackupService.ts          ← DB + code backups
    exchanges/
      ExchangeFactory.ts      ← Singleton multi-exchange
      RevolutXService.ts      ← RevolutX API
      IExchangeService.ts     ← Interfaz común
    institutionalDca/
      IdcaEngine.ts           ← Motor IDCA (ciclos, scheduler)
      IdcaSmartLayer.ts       ← VWAP, ATR, rebound, base price, safety orders
      IdcaTypes.ts            ← Interfaces (SafetyOrderLevel, VwapEntryContext, etc.)
      IdcaMessageFormatter.ts ← Mensajes humanos + técnicos
      IdcaReasonCatalog.ts    ← Catálogo de bloqueos con templates
      TrailingBuyManager.ts   ← Trailing stop buy inverso (in-memory)
  routes/
    config.ts                 ← Config REST API (15 endpoints)
    institutionalDca.routes.ts← IDCA REST API
    fiscoAlerts.routes.ts     ← Alertas FISCO
  utils/
    krakenRateLimiter.ts      ← FIFO + backpressure + degraded state
shared/
  schema.ts                   ← Drizzle schema (todas las tablas)
client/src/
  pages/
    InstitutionalDca.tsx      ← UI IDCA completa
    Terminal.tsx               ← Posiciones + historial
    Monitor.tsx                ← Eventos tiempo real
    Notifications.tsx          ← Preferencias alertas Telegram
  components/
    idca/IdcaEventCards.tsx    ← Cards con humanMessage + chips técnicos
  hooks/
    useInstitutionalDca.ts    ← React Query hooks IDCA
db/migrations/                ← SQL migrations (001-028)
script/migrate.ts             ← Migration runner (deploy automático)
```

---

## 📊 TABLAS DB PRINCIPALES

| Tabla | Propósito |
|-------|-----------|
| `bot_config` | Config global (SmartGuard, pares, dry_run, log retention) |
| `api_config` | Credenciales Kraken + RevolutX + Telegram |
| `open_positions` | Posiciones abiertas (solo bot-managed, nunca creadas por sync) |
| `trades` | Historial de trades (origin: engine/manual/sync) |
| `trade_fills` | Fills individuales por exchange |
| `order_intents` | Órdenes enviadas con tracking de estado |
| `institutional_dca_config` | Config global IDCA + scheduler + recovery |
| `institutional_dca_asset_configs` | Config por par (dip, rebound, VWAP, safety, TP, sliders) |
| `institutional_dca_cycles` | Ciclos activos/cerrados con base_price, TP, fees |
| `institutional_dca_orders` | Órdenes de ciclo (base_buy, safety_buy, take_profit) |
| `institutional_dca_events` | Eventos con humanMessage + technicalSummary + payload |
| `time_stop_config` | TTL por activo con multiplicadores régimen |
| `market_metrics_snapshots` | Snapshots de métricas (Fear&Greed, etc.) |
| `market_metrics_evaluations` | Evaluaciones por par (score, bias, action) |
| `fisco_operations` | Operaciones fiscales (Kraken + RevolutX) |
| `fisco_lots` | Lotes FIFO para cálculo fiscal |
| `fisco_disposals` | Ventas con cost basis y gain/loss EUR |
| `training_trades` | Pipeline ML (backfill + labeling) |
| `regime_state` | Estado régimen por par (TRANSITION, BULL, BEAR, RANGE) |
| `telegram_chats` | Multi-chat con preferencias granulares |

---

## 🔄 FLUJO DE DATOS

### Modo Normal (scan loop ~60s)
```
1. exitManager.checkStopLossTakeProfit() → SL/TP/BE/Trailing siempre
2. KrakenRL.getState() → actualizar marketDataDegraded
3. Por cada par:
   a. shouldPollForNewCandle() → fetch vela si nueva (con catch-up cap)
   b. Si CANDLE_NEW + !marketDataDegraded:
      - analyzeWithCandleStrategy() → señal BUY/SELL/HOLD
      - Si BUY: gate reentrada + anti-burst + exposure → executeTrade
      - Si SELL: SmartGuard filter → safeSell
   c. Si CANDLE_SAME: skip (timing invariant guard)
```

### Modo IDCA (scheduler adaptativo)
```
1. getCurrentPrice(pair) via MarketDataService
2. updateOhlcvCache(pair) via MarketDataService (1h + 1d)
3. checkEntryConditions():
   a. computeHybridV2() → base price
   b. entryDipPct = (basePrice - currentPrice) / basePrice
   c. Si dip >= minDip + marketScore OK + rebound OK:
      - computeVwapAnchored() → zona VWAP
      - Retorna IdcaEntryCheckResult con vwapContext
4. Si entry allowed: crear ciclo + base buy + safety levels
5. Monitor ciclos activos: safety buys + exit management
```

---

## 🔐 REGLAS INVARIANTES

1. **`open_positions` = solo posiciones del bot** — Reconcile/sync nunca crea posiciones, solo `trades`
2. **Salidas siempre ejecutan** — `marketDataDegraded` bloquea entradas, nunca salidas
3. **Migraciones idempotentes** — `ADD COLUMN IF NOT EXISTS` en ambos paths (deploy + startup)
4. **IDCA allowed pairs** — Solo `["BTC/USD", "ETH/USD"]` (constante en `shared/schema.ts`)
5. **Telegram single instance** — ErrorAlertService usa instancia inyectada, nunca crea la suya
6. **DRY_RUN gate en memoria** — Contadores de slots y cooldown usan Maps en memoria, no DB

---

## 🚀 DEPLOY

```bash
cd /opt/krakenbot-staging
git pull origin main
docker compose -f docker-compose.staging.yml up -d --build
```

Migraciones ejecutan automáticamente:
- `script/migrate.ts` (pre-start en Docker) — aplica SQL files de `db/migrations/`
- `storage.runSchemaMigration()` (startup app) — ALTER TABLE inline como redundancia

### Verificación post-deploy
```bash
docker logs krakenbot-staging-app --tail 50
# Buscar: [migrate] Migration completed successfully!
# Buscar: [startup] Auto-migration: added ...
# Buscar: [startup] ExchangeFactory initialized
```

---

## 📡 ENDPOINTS CLAVE

| Endpoint | Método | Propósito |
|----------|--------|-----------|
| `/api/market-data/stats` | GET | Cache stats de MarketDataService |
| `/api/exchange-diagnostics` | GET | Nonce, rate limiter, estado exchanges |
| `/api/portfolio` | GET | Balances + precios + P&L |
| `/api/open-positions` | GET | Posiciones abiertas |
| `/api/events` | GET | Eventos con filtros temporales |
| `/api/test/critical-alert` | POST | Test alerta Telegram |
| `/api/idca/*` | CRUD | Config, ciclos, órdenes, eventos IDCA |
| `/api/fisco/*` | CRUD | Operaciones, lotes, sync fiscal |

---

## ⚙️ MODO NORMAL — DETALLE TÉCNICO

### Motor de señales
- `momentumCandlesStrategy()`: EMA10/20, RSI, MACD, Bollinger, volumen, engulfing. Score ponderado con umbral configurable.
- `analyzeWithCandleStrategy()`: Multi-timeframe analysis + hybrid guard watches + anti-cresta + volume overrides + early momentum.

### SmartGuard (gestión de posiciones)
- **Break-even progresivo**: Activa stop a entry cuando P&L >= `sg_be_at_pct`
- **Trailing stop**: Arranca a `sg_trail_start_pct`, distancia `sg_trail_distance_pct`, steps `sg_trail_step_pct`
- **Scale-out**: Venta parcial (`sg_scale_out_pct`) al alcanzar `sg_scale_out_threshold`
- **TP fijo**: Opcional, a `sg_tp_fixed_pct`
- **Time-stop**: TTL por activo con multiplicadores por régimen (table `time_stop_config`)

### Protecciones
- **KrakenRL backpressure**: Cola FIFO con `KRAKEN_MAX_QUEUE_SIZE` (default 60). Queue overflow → rechazo inmediato.
- **Market Data Degraded**: Histéresis (entrada: queue>30 OR waitedMs>15s OR 3+ errores; salida: 3 ticks limpios). Bloquea entradas, no salidas.
- **Catch-up cap**: Max 1 poll catch-up/30s por par. Si desfase >4 intervalos → reset sync.
- **Anti-burst DRY_RUN**: Gate reentrada + cooldown 120s usando contadores en memoria.

### Telegram dedup
- SELL_BLOCKED: Cooldown 15 min por par
- Circuit breaker: Cooldown 15 min por lotId
- DRY_RUN: Max 1 mensaje simulación por par+tipo cada 15 min
- Market data degraded: Cooldown 10 min por par

---

## 📈 MODO IDCA — DETALLE TÉCNICO

### MarketDataService (singleton)
Cache TTL unificado para velas y precios. Sirve a ambos modos.

| Timeframe | TTL |
|-----------|-----|
| 15m | 20 min |
| 1h | 90 min |
| 1d | 6 horas |
| Spot price | 30 seg |

### Base Price (computeHybridV2)
Precio de referencia determinístico:
- Ventanas: 24h, 48h, 72h, 7d, 30d
- Candidatos: Swing highs (pivot detection) + P95
- Outlier guard: ATR-based
- Tolerancias dinámicas por par: Swing BTC [6%-18%], ETH [8%-25%]; Cap 7d BTC [6%-20%], ETH [8%-25%]; Cap 30d BTC 20%, ETH 25%

### VWAP Anchored + Bandas
- `computeVwapAnchored()`: VWAP desde timestamp del base price, bandas ±1σ y ±2σ
- `getVwapBandPosition()`: Zona → `below_lower2` / `below_lower1` / `between_bands` / `above_upper1` / `above_upper2`
- Per-pair toggle: `vwapEnabled` (default OFF)

### Dynamic Safety Orders
- `adjustSafetyOrdersWithVwap()`: Ajusta `dipPct` según zona VWAP (deep value → tighten, overextended → widen)
- Per-pair toggle: `vwapDynamicSafetyEnabled` (default OFF)

### Rebound Detection
- 3 condiciones OR: lower wick >40% range, bounce > `reboundMinPct` desde local low, bearish momentum decelerating
- `reboundMinPct`: Configurable por par (default 0.30%)

### TrailingBuyManager
Trailing stop inverso para entradas:
1. `arm(pair)` → empieza tracking
2. `update(pair, price)` → dispara buy cuando bounce >= 0.5% desde local low
3. Expira después de 4h. Estado efímero (in-memory)

### Ciclos
- **Main**: Compra base + safety orders escalonados
- **Plus**: Compra adicional en ciclo existente
- **Recovery**: Ciclo secundario cuando main está en drawdown

### Exit (3 sliders por par)
1. **Protección**: Stop-loss a `protectionActivationPct`
2. **Trailing**: Arranca a `trailingActivationPct`, margen `trailingMarginPct`
3. **Close**: Rompe trailing → venta

### Mensajes humanos
- `humanTitle` + `humanMessage` en castellano natural
- `technicalSummary` como chips coloreados en UI
- Composición inteligente multi-bloqueo
- Signo semántico: positivo = "Caída X%", negativo = "Precio sobre ancla X%"

---

## 🔌 IDCA ASSET CONFIG — COLUMNAS

| Columna | Tipo | Default |
|---------|------|---------|
| `pair` | TEXT | — |
| `enabled` | BOOLEAN | true |
| `min_dip_pct` | DECIMAL | 2.00 |
| `dip_reference` | TEXT | hybrid |
| `require_rebound_confirmation` | BOOLEAN | true |
| `rebound_min_pct` | DECIMAL | 0.30 |
| `trailing_buy_enabled` | BOOLEAN | true |
| `vwap_enabled` | BOOLEAN | false |
| `vwap_dynamic_safety_enabled` | BOOLEAN | false |
| `safety_orders_json` | JSONB | [{2%,25%},...] |
| `max_safety_orders` | INTEGER | 4 |
| `take_profit_pct` | DECIMAL | 4.00 |
| `dynamic_take_profit` | BOOLEAN | true |
| `protection_activation_pct` | DECIMAL | 1.00 |
| `trailing_activation_pct` | DECIMAL | 3.50 |
| `trailing_margin_pct` | DECIMAL | 1.50 |
| `cooldown_minutes_between_buys` | INTEGER | 180 |
| `max_cycle_duration_hours` | INTEGER | 720 |

---

## 🛡️ GUARDS Y PROTECCIONES

| Guard | Descripción |
|-------|-------------|
| Market Data Degraded | Histéresis KrakenRL. Bloquea entradas, no salidas |
| Anti-burst | Cooldown 120s entre entradas (LIVE + DRY_RUN) |
| DRY_RUN double-sell | Previene SELL duplicado si lot ya cerrado |
| Queue overflow | Rechaza tareas KrakenRL si cola >= 60 |
| Catch-up cap | Max 1 poll catch-up/30s, reset si >4 intervalos |
| Timing invariant | Detecta desync reloj, resetea lastEvaluatedCandle |
| Fee cushion | Markup mínimo para cubrir comisiones |
| Anti-cresta | Filtro de señales en pico de momentum |
| MTF strict | Confirmación multi-timeframe |

---

## 💬 TELEGRAM

### Multi-chat con preferencias granulares
Cada chat configura qué subtipos recibe (trades, errores, sistema, balance, heartbeat).

### Subtipos de alerta
- `trade_buy_*`, `trade_sell_*`, `trade_entry_blocked_degraded`
- `system_market_data_degraded_on/off`
- `system_error_*`, `system_heartbeat`
- `idca_*` (cycle started, buy executed, entry blocked, cycle closed, etc.)

### ErrorAlertService
Usa instancia inyectada del TelegramService global. Severidad: 🟡 Medium / 🔴 High / 🚨 Critical

---

## 💰 FISCO

- Panel UI estilo Bit2Me: operaciones, lotes FIFO, disposals, P&L fiscal en EUR
- Sync Kraken + RevolutX con retry/rate-limit
- Cron diario 08:30 + sync manual
- Alertas Telegram configurables por canal
- Tablas: `fisco_operations`, `fisco_lots`, `fisco_disposals`, `fisco_sync_history`, `fisco_sync_retry`

---

## 📎 REFERENCIA RÁPIDA

### RevolutX endpoints funcionales
| Endpoint | Método |
|----------|--------|
| `/api/1.0/accounts` | GET |
| `/api/1.0/orders` | POST / DELETE / GET |
| `/api/1.0/fills` | GET |
| `/api/1.0/currencies` | GET |
| `/api/1.0/symbols` | GET |

No disponibles: ticker (404), orderbook (404)

### Significado de `origin` en trades
| Valor | Significado |
|-------|-------------|
| `engine` | Ejecutado por motor de trading |
| `manual` | Ejecutado via API/dashboard |
| `sync` | Importado desde exchange |

### Queries de verificación útiles
```sql
-- Posiciones con snapshot
SELECT pair, entry_mode, config_snapshot_json IS NOT NULL as has_snapshot
FROM open_positions ORDER BY pair;

-- Trades por origen
SELECT origin, COUNT(*) FROM trades GROUP BY origin;

-- Ciclos IDCA activos
SELECT id, pair, status, cycle_type, buy_count, capital_used_usd
FROM institutional_dca_cycles WHERE status = 'active';

-- IDCA asset configs
SELECT pair, enabled, min_dip_pct, vwap_enabled, rebound_min_pct
FROM institutional_dca_asset_configs;
```

---

## 2026-04-23 — Terminal IDCA: Subpestaña de Logs Técnicos en Tiempo Real

### Nuevos archivos
- `server/services/institutionalDca/idcaLog.ts` — Helper centralizado `idcaLog(level, message, meta)` para emitir logs técnicos IDCA a consola + `institutional_dca_events`
- `client/src/components/idca/IdcaTerminalPanel.tsx` — Componente React "Terminal" tipo consola con polling 5s, filtros, pausa/reanudar, exportar, copiar
- `server/services/__tests__/idcaTerminalLogs.test.ts` — 11 tests unitarios sin DB (truncación payload, mapeo, retención)

### Archivos modificados
- `server/routes/institutionalDca.routes.ts` — Añadido endpoint `GET /api/institutional-dca/terminal/logs` (filtros: pair, mode, level, q, from, to, limit). Retención cambiada de 7 → 30 días.
- `client/src/hooks/useInstitutionalDca.ts` — Añadido hook `useIdcaTerminalLogs` con polling cada 5s
- `client/src/pages/InstitutionalDca.tsx` — `EventsTab` actualizado con 3ª subpestaña "Terminal"
- `server/services/institutionalDca/IdcaTelegramNotifier.ts` — Corregido `config` no definido en `alertTrailingBuyTriggered`

### Diseño
- **Fuente de datos**: `institutional_dca_events` (sin crear tabla nueva). La Terminal muestra TODOS los eventos incluyendo técnicos que el feed visual oculta.
- **Retención**: 30 días (purga batch cada 6h)
- **Polling**: 5s en tiempo real, pausa manual disponible
- **Máx**: 1.000 logs por request, 1.000 en vista
- **Filtros**: par, modo, nivel, texto libre, rangos de fecha (1h/6h/24h/7d/30d/Custom)

### Validación
- `npm run check` — 0 errores TypeScript
- `npm run build` — OK (3785 módulos)
- `vitest run idcaTerminalLogs.test.ts` — 11/11 tests

---

## 2026-04-26 — Logs IDCA: Nueva Pestaña Estilo Monitor Normal

### Objetivo
Añadir una 4ª subpestaña "Logs IDCA" en IDCA → Eventos, con vista continua tipo consola idéntica al Monitor normal del bot principal. Sin eliminar la pestaña "Terminal" existente.

### Nuevos archivos
- `client/src/components/idca/IdcaLogsPanel.tsx` — Componente React "Logs IDCA" completo:
  - Fondo oscuro `zinc-950`, fuente monoespaciada
  - Líneas completas con timestamp, badge nivel, badge par, badge modo, mensaje expandible
  - Campos técnicos extraídos inline: score, caída, mínimo, bloqueos, precio ref, precio actual, zona, trigger, motivo
  - Click en línea expande RAW completo
  - Polling 5s en modo "En vivo", histórico REST en otros rangos
  - Filtros: rango (1h/6h/24h/7d/30d/En vivo), nivel (INFO/WARN/ERROR/DEBUG), par, modo (SIM/LIVE), tipo (entrada/VWAP/TrailingBuy/compra/salida/warning/sistema), búsqueda libre
  - Copiar TXT (incluye RAW + campos extraídos), Copiar JSON, Descargar TXT, Descargar JSON, Export API
- `server/services/__tests__/idcaLogs.test.ts` — 42 tests unitarios sin DB

### Archivos modificados
- `client/src/pages/InstitutionalDca.tsx`:
  - Import `IdcaLogsPanel`
  - `EventsTab` actualizado con 4ª subpestaña "Logs IDCA" (`BarChart3` icon)
  - Descripción contextual por subpestaña (Terminal vs Logs IDCA)

### Diseño
- **Fuente de datos**: `GET /api/logs?search=[IDCA]&source=app_stdout` → tabla `server_logs` (reutiliza infraestructura existente, sin endpoint nuevo)
- **Sin WebSocket**: Polling 5s para "En vivo"; histórico vía REST para rangos
- **Parseo frontend**: `parseIdcaLine()` extrae par, modo, nivel, tipo de evento y campos numéricos de la línea de texto
- **Export completo**: copiar/descargar incluye `RAW: [línea original completa]` + campos extraídos → no solo el mensaje visible
- **Terminal sigue intacto**: subpestaña "Terminal" con `IdcaTerminalPanel` no se modifica

### Diferencia funcional Terminal vs Logs IDCA
| | Terminal | Logs IDCA |
|---|---|---|
| Fuente | `institutional_dca_events` | `server_logs` vía `console.log` |
| Vista | Eventos enriquecidos (tarjetas) | Líneas continuas tipo consola |
| Necesita abrir evento | Sí | No — todo inline |
| Export | Eventos IDCA estructurados | Líneas RAW + campos extraídos |
| Tiempo real | Polling 5s | Polling 5s / histórico |

### Validación
- `npm run check` — 0 errores TypeScript
- `npm run build` — OK (3786 módulos)
- `vitest run idcaLogs.test.ts` — 42/42 tests
- `vitest run idcaTrailingBuyTelegramState idcaLadderAtrp idcaMessageFormatter idcaReasonCatalog idcaLogs` — 131/131 tests

---

*Última actualización: 2026-04-26*
*Mantenido por: Windsurf Cascade AI*