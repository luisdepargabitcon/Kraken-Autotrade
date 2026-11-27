# Inventario de divergencias de indicadores

Fecha WP4e: 2026-11-27  
Alcance: `server/` y `scripts/`. Se buscaron `computeRSI`, `computeEMA`, `computeATR`, `ema`, `macd`, `bollinger`, `vwap`, `rsi`, `calculateEMA`, `calculateRSI`, `calculateATR`, `calculateMACD`, `calculateBollingerBands`, `vwapAnchored` y `vwapPeriod`. La tabla se centra en consumidores de cálculo; las menciones de VWAP de persistencia/rutas sin cálculo propio no son consumidores de indicador y quedan fuera de la migración.

## Migraciones aplicadas en WP4e con paridad 1e-12

| Consumidor | Ubicación | Convención anterior | Migración | Evidencia |
|---|---|---|---|---|
| IDCA RSI | `server/services/institutionalDca/IdcaSmartLayer.ts:292` | RSI Wilder, serie plana ⇒ 100, serie corta ⇒ 50 | Wrapper a `rsiWilder(..., flatPolicy:"legacy100")` | `consumerParity.test.ts`, vectores ascendente/descendente/ruido/plano, tolerancia 1e-12 |
| SmartTimeStopV2 EMA | `server/services/SmartTimeStopV2.ts:79` | SMA seed en `period`, después recursiva, array compacto | `ema()` de core filtrando nulls de warm-up | misma batería de paridad |
| AMA ATR | `server/services/ama/amaHwmBar.ts:226` | SMA de últimos TR, null si `len < period+1` | `atr(..., method:"sma")` | misma batería de paridad |

No se migró ningún consumidor donde la semántica no fuera exactamente igual.

## Inventario de consumidores

| Archivo:línea | Consumidor | Convención actual | Estado | Siguiente paso |
|---|---|---|---|---|
| `server/services/indicators.ts:27` | `calculateEMA` SPOT legado | semilla en primer precio, sin SMA seed ni nulls de warm-up | No migrado: difiere de `core.ema` | comparar shadow antes de cualquier sustitución |
| `server/services/indicators.ts:39` | `calculateRSI` SPOT legado | media simple sobre toda la ventana pasada, plano/no pérdidas ⇒ 100 | No migrado: no es Wilder | comparación shadow opcional WP4e |
| `server/services/indicators.ts:68` | `calculateMACD` SPOT legado | EMA truncadas en ventanas y señal sobre historial incompleto | No migrado: difiere de MACD core full-series | no migrar sin shadow del propietario |
| `server/services/indicators.ts:92` | `calculateBollingerBands` | desviación poblacional, `%B` escala 0-100 | No migrado: core devuelve ratio 0-1 y null en banda plana | definir contrato de escala antes de migrar |
| `server/services/indicators.ts:118` | `calculateATR` | SMA de TR sobre `PriceData.price` | Pendiente de paridad central; no migrado en WP4e por refactor mayor de tipos | evaluar wrapper `price⇒close` con prueba exhaustiva |
| `server/services/institutionalDca/IdcaSmartLayer.ts:244` | `computeATR` IDCA | SMA de TR aunque haya menos de `period+1` velas | No migrado: core devuelve null en insuficiente | decidir si la semántica corta es deseada; no cambiarla implícitamente |
| `server/services/institutionalDca/IdcaSmartLayer.ts:270` | `computeEMA` IDCA | semilla en primer valor, array completo | No migrado: difiere de SMA seed core | documentar convención o migrar solo tras medición |
| `server/services/institutionalDca/IdcaSmartLayer.ts:282` | `computeEmaStrict` | ya era wrapper exacto a `emaStrict` | Migrado previamente | mantener |
| `server/services/institutionalDca/IdcaSmartLayer.ts:292` | `computeRSI` | Wilder legacy100 | Migrado WP4e | mantener wrapper por compatibilidad |
| `server/services/institutionalDca/IdcaEngine.ts:3934-3947` | motor IDCA | consume `computeEmaStrict`, `computeEMA`, `computeRSI` | Hereda convenciones mixtas | no unificar hasta resolver warm-up/productivo |
| `server/services/institutionalDca/IdcaEngine.ts:189,4584,4913` | ATRP IDCA | usa `computeATRPct` SMA permisivo | No migrado | depende de decisión sobre ATR insuficiente |
| `server/services/institutionalDca/IdcaMarketContextService.ts:243-244` | contexto IDCA | ATR/ATRP SMA permisivo | No migrado | igual que anterior |
| `server/services/institutionalDca/IdcaDynamicAnchorService.ts:154` | ancla IDCA | ATRP SMA permisivo | No migrado | igual que anterior |
| `server/services/institutionalDca/IdcaRegimeAdapter.ts:94-95` | régimen IDCA | `computeEMA` seed-first | No migrado | medir impacto de warm-up antes de migrar |
| `server/services/SmartTimeStopV2.ts:79,125,134` | EMA TimeStop | SMA seed compacta | Migrado WP4e | mantener paridad |
| `server/services/SmartTimeStopV2.ts:86,162` | RSI TimeStop | suma simple de últimas N diferencias, no Wilder | No migrado | requiere decisión de convención; no sustituir |
| `server/services/ama/amaHwmBar.ts:226` | ATR AMA | SMA TR estricta | Migrado WP4e | mantener |
| `server/services/EntryDecisionContext.ts:121-163` | entrada SPOT | EMA seed-first + MACD legado | No migrado | shadow antes de cambio |
| `server/services/mtfAnalysis.ts:47-48` | MTF SPOT | EMA seed-first | No migrado | shadow/medición |
| `server/services/regimeDetection.ts:115-137` | régimen SPOT | EMA seed-first + Bollinger escala 0-100 | No migrado | definir contrato y medir |
| `server/services/SmartExitEngine.ts:245-719` | salidas SPOT | EMA/MACD/ATRP legados | No migrado | salidas protectoras: no tocar sin validación completa |
| `server/services/spot/spotAdaptiveMarketState.ts:238-284` | estado adaptativo | ATR legado + EMA seed-first | No migrado | shadow/medición |
| `server/services/spot/spotCanonicalStrategy.ts:153-164` | estrategia canónica | EMA seed-first, RSI simple legado, ATR SMA | No migrado | shadow/medición |
| `server/services/spot/spotEntryQualityFeatures.ts:73,125` | features entrada | ATR legado + EMA seed-first | No migrado | medición |
| `server/services/spot/spotEntryV3.ts:109,302` | entrada V3 | ATR legado + EMA seed-first | No migrado | medición |
| `server/services/spot/spotExitPolicy.ts:199` | salida SPOT | EMA seed-first | No migrado | salidas protectoras: validación reforzada |
| `server/services/spot/spotMarketContext.ts:114` | contexto SPOT | ATR legado | No migrado | paridad central primero |
| `server/services/spot/spotRegimeEngine.ts:87-169` | régimen SPOT | EMA seed-first + ATR legado | No migrado | medición |
| `server/services/spot/spotReplayEngine.ts:708` | replay | ATR legado | No migrado | paridad central primero |
| `server/services/strategies.ts:77-672` | estrategias SPOT | EMA/RSI/MACD/Bollinger/ATR legados | No migrado | shadow/medición; alto impacto productivo |
| `server/services/tradingEngine.ts:2291-7241` | motor SPOT | wrappers a indicadores legados | No migrado | primero shadow agregado WP4e |
| `server/services/gridIsolated/gridBandAdapter.ts:59-61` | grid band | Bollinger/ATR legados | No migrado | contrato de escala Bollinger |
| `server/services/gridIsolated/gridBacktest.ts:119-120` | backtest grid | Bollinger/ATR legados | No migrado | debe migrar junto a adapter para consistencia |
| `server/routes/institutionalDca.routes.ts:2343` | diagnóstico IDCA | ATRP SMA permisivo | No migrado | seguir implementación IDCA |
| `scripts/grid_spacing_phase3c_pre_real_atr.ts:138-277` | script análisis grid | duplica ATR/Bollinger legados | No migrado | script operativo local; migrar solo con harness porque las funciones no son exportadas |
| `scripts/measure_indicator_impact.ts:98-109` | medición lead | implementa referencias propias | No tocado: archivo en paralelo del lead | lead lo gestiona |

## Convenciones detectadas

- `core.ema`: SMA seed y nulls durante warm-up.
- `computeEMA` IDCA / `calculateEMA` SPOT: seed en primer valor disponible, por tanto disponible demasiado pronto y numéricamente distinta.
- `core.rsiWilder`: Wilder; con política `unreliable` marca series planas no fiables.
- `calculateRSI` SPOT: media simple sobre todo el slice recibido; no es Wilder si el caller recorta ventanas.
- `computeRSI` SmartTimeStopV2: suma simple de últimas N diferencias; tampoco es Wilder.
- `core.atr(method:"sma")`: exige `period+1`; algunos consumidores IDCA calculan SMA parcial con menos historia.
- `calculateBollingerBands` legado reporta `%B` en escala 0-100; core reporta ratio 0-1.

## Recomendación

No migrar MACD ni RSI productivos sin una comparación shadow en el entorno del propietario. La medición pública previa mostró 0,15% de desacuerdo de signo MACD y diferencias absolutas pequeñas; incluso diferencias pequeñas pueden cruzar umbrales discretos. El modo shadow WP4e es solo diagnóstico en memoria, desactivado por defecto, sin DB y sin efecto en decisiones.
