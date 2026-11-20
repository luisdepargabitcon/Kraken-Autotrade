# ANÁLISIS DE ESTRATEGIAS — F4 (solo lectura, sin reconfiguración)

**Fecha:** 2026-11-20 · **Rama:** `feature/nexa-v2-transformacion-20261120`
**Alcance:** análisis estático de los 4 motores sobre `HEAD`. No se modifica configuración ni motor alguno.

---

## 1. SPOT NORMAL/SWING (`tradingEngine.ts` + `strategies.ts` + `exitManager.ts`)

- Normal/swing con protecciones gestionadas por `exitManager` (SL, TP, trailing, BE).
- **P0 heredado:** doble fuente `global.dryRunMode` vs `bot_config.dryRunMode`; el hot-reload vía ConfigService no siempre emite los eventos que consume TradingEngine.
- `gridStrategy` embebida ≠ Grid aislado: en UI se etiqueta como GRID dentro de estrategias SPOT para no confundirlo.
- Destino UI: `Panel` (modo, señales, estrategia), `Posiciones` (entrada/actual/PnL/protecciones), `Protecciones` (SL/TP/trailing/BE), `Config`.
- Riesgos trasladados a UI: ExchangeFactory puede ignorar `config.dataExchange` → se muestra `dataSource` efectivo; fallbacks de market-data sin validación de timestamp → estado `stale` obligatorio.

## 2. GRID AISLADO (`server/services/gridIsolated/`)

- Motor de ciclo propio (≠ `gridStrategy` SPOT, ≠ `IdcaGridOverlay`): ciclos BUY→SELL con propiedad 1:1, rangos dinámicos, circuit breakers (`gridCircuitBreakerV3`), maker/taker (`gridExecutionServiceTakerFallback`), recovery (`gridCycleOwnedV3Recovery`).
- Rangos antiguos/legacy preservados y etiquetados en UI como "rangos antiguos".
- Backtests de investigación (NO evidencia REAL): continuo −166,95 USDT (DD −4,93%), adaptativo −173,05 (−3,06%), híbrido −241,88 (−3,96%); peor con costes de estrés.
- Destino UI: `Panel` (rango, niveles, ciclo, breakers), `Ciclos` (BUY→SELL con cantidades y PnL), `Config`.
- Regla de paridad: qty BUY = qty SELL por ciclo (test automatizado).

## 3. IDCA INSTITUCIONAL (`server/services/institutionalDca/`)

- Confluence/score (`IdcaConfluenceEngine`), anclas dinámicas, distancias dinámicas, rebote, referencia de entrada, ladder ATRP, híbrido, overlay grid, ejecución (`IdcaExecutionManager`, `IdcaLiveExecutionGuard`), salidas, comisiones, limpieza.
- Modos: `disabled` / `simulation` / `live`.
- **P0 heredado:** Ladder ATRP activo puede ignorar `safetyOrdersJson` heredado → UI muestra legacy como **"no aplicados"**.
- Destino UI: `Panel` (estado, pares, score, condiciones), `Ciclos abiertos` (ancla, tramos, TP dinámico, BE, trailing, órdenes con ID/fee/slippage/motivo, acciones protegidas), `Historial`, `Config`.
- Controles (pausar/cerrar ciclo, emergencia): `data-demo-action` en demo, sin ejecución real.

## 4. AMA (`server/services/ama/`)

- OFF/LAB/REPLAY/SHADOW/REAL; readiness, migration gate, mandate studio, planner, portfolio/ledger, protection exits, data quality.
- **P0 heredado (fail-closed):** gateway devolvía `executed:true` con `orderId:null` → UI distingue `reserved`/`submitted`/`filled`; nunca infiere ejecución sin `orderId`. Prohibido promover a REAL.
- Destino UI: `Panel` (estado, mandato), `Readiness` (checks), `Traza` (órdenes con estado real y orderId), `Config`. REAL permanece cerrado.

## 5. Módulos comunes

- Fuentes de datos con estado/frescura; `stale`/`unavailable` nunca se disfrazan de vivo.
- Logs/actividad con filtro por severidad/motor; FISCO restringido (agregados, sin datos personales).
- Seguridad: 0 métodos mutables en la UI (test), PIN con hash local, sin credenciales en el bundle.

## 6. SPOT agosto vs septiembre 2026 (métricas del plan)

| Periodo | PnL | Cierres | Win-rate |
|---|---|---|---|
| Agosto 2026 | **+1.029,99 USD** | 41 | 51,2% |
| Septiembre 2026 | **−1.515,39 USD** | 115 | 22,6% |

**Lectura comparativa:**
- Septiembre multiplica ×2,8 la frecuencia de cierres con win-rate <mitad → el motor abrió/cerró en régimen lateral-hostil: entradas válidas por señal pero salidas por protección o time-stop antes del TP (comisión+slippage erosionan cada ciclo pequeño).
- Agosto, con menos operaciones y mejor selección, el win-rate >50% compensó comisiones → el mismo conjunto de protecciones (SL/TP/trailing/BE del `exitManager`) funciona cuando la señal es selectiva; no cuando la estrategia reentra en chop.
- La divergencia apunta a **calidad de entrada en régimen lateral**, no a las protecciones: el PnL medio por cierre pasó de +25,1 USD a −13,2 USD, coherente con stop-outs repetidos y no con fallos de ejecución.

**Contexto de estudios offline previos (no evidencia REAL, solo investigación):** B +159,27 / B +108,13 / D −598,18 / E −1.586,27 / F −288,60; Grid continuo −166,95, adaptativo −173,05, híbrido −241,88. El comportamiento de septiembre encaja con los escenarios de estrés (D/E): régimen lateral con costes.

**Acción derivada (sin tocar el motor):** la UI muestra en `Motores→SPOT→Historial` el win-rate y PnL por ventana y en `Protecciones` el conteo de stop-outs vs TP; la reconfiguración de umbrales de entrada queda fuera de esta orden y requiere decisión del propietario con evidencia live.

## Conclusión F4

Los 4 motores son arquitecturas distintas y se preservan. Los P0 se trasladan a la UI como estados explícitos. Ningún motor reconfigurado.
