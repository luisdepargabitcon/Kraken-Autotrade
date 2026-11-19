# INFORME FALLOS SPOT — 19/11/2026

**Identificador:** `AUD-20261119-08` · **Estado:** registro de incidencias de auditoría **abierto**; no se han aprobado cambios ni hay reparaciones verificadas.  
**Ámbito:** NEXA **SPOT SHADOW** exclusivamente; quedan fuera GRID AISLADO, otros módulos, trading REAL y datos privados.  
**Código comprobado:** commit histórico `3ae18319b8c0b68c9374241db65f8ef9bdd39a57`; **no** implica que ese código siga desplegado o coincida con `main`.  
**Informe de trabajo íntegro privado:** [Google Docs — INFORME FALLOS SPOT — 19/11/2026](https://docs.google.com/document/d/1W3-z7Z_rPPGeMRan_Rh_WgNEnBdXP84aiH8ENEe-31M/edit) (acceso restringido).  
**Archivo privado:** [auditorías del 19/11/2026 en Google Drive](https://drive.google.com/drive/folders/1af2Guko1FXpzbxQ0fYAMiZP2oGAtzNn5).

> **Repositorio público:** resumen técnico sin posiciones individualizadas, secretos, tablas de cartera ni evidencias privadas. Las cifras son SPOT SHADOW simulado, no resultados de trading REAL.

## Lectura de resultados de auditoría

- Cohorte: **167 ventas SPOT SHADOW**, 47 ganancias y 120 pérdidas; PnL total **−845,01 USD**.
- **106** operaciones con MFE *bruto* positivo acabaron perdiendo: **−2.293,61 USD** netos en conjunto.
- Motivos dentro de esas 106: **80 invalidaciones de estructura** (**−1.784,51 USD**), **18 salidas por tiempo** (**−200,17 USD**), **4 salidas de emergencia** (**−287,78 USD**) y **4 cierres por break-even** (**−21,14 USD**).
- De las 106, solo **70** tuvieron un máximo *neto teórico* positivo tras costes estimados; los máximos son retrospectivos y no suponen fills ejecutables.
- En el conjunto de 167, hubo **98 invalidaciones** con **−2.050,38 USD** netos y solo 4 ganadoras. Es un síntoma; **no se ha demostrado** que la invalidación esté mal en todos esos casos.

## Registro público de incidencias

| ID | Prioridad | Estado de evidencia | Hallazgo y verificación pendiente |
|---|---|---|---|
| F-SPOT-01 | **P0** | Código y resultado archivado | **BREAK_EVEN** coloca stop en compra (`breakEvenStopPctR=0`), **no** en equilibrio neto: fees, bid/ask, slippage y gaps pueden dar pérdida. Cuatro cierres BE acumulan −21,14 USD. Auditar precio protegido **neto ejecutable estimado** y pruebas de deterioro de fill. |
| F-SPOT-02 | P1 | Orden confirmado, efecto causal no probado | **Prioridad:** EMERGENCY → STRUCTURE_INVALIDATION → DEFENSIVE → BREAK_EVEN → TRAILING → PROFIT → TIME_EFFICIENCY. La invalidación retorna antes de evaluar BE/trailing en esa iteración. Revisar coherencia del estado de protección; **no quitar el hard stop**. |
| F-SPOT-03 | **P0/P1** | Umbrales y distribución confirmados | BE se activa a **1R**, trailing a **1,5R**, TP a **3R**; en esta cohorte representaban aprox. **50/75/150 USD brutos**. **102 de las 106** pérdidas tras MFE positivo no alcanzaron 1R. Investigar umbrales netos/volatilidad **sin recortar** las ganancias grandes. |
| F-SPOT-04 | P1 | Código histórico confirmado | `STRUCTURE_INVALIDATION` compara dos cierres 15m contra una EMA20 calculada **solo al final**, en lugar de EMA por vela. El filtro `closeTime > openedAt` puede aceptar vela que empezó antes de compra. Auditar velas completas y cálculos contemporáneos. |
| F-SPOT-05 | P1 | Comportamiento histórico previo a parche | En versiones anteriores al 20/09 podían contarse velas pre-entrada; **no** atribuir automáticamente las pérdidas al fallo ni asumir ausencia en todas las versiones posteriores. Revalidar historial y corrección. |
| F-SPOT-06 | P1 | Código histórico confirmado | `TIME_EFFICIENCY` sale tras **180 min desde compra** cuando R actual <0,5; no mide **180 min sin un nuevo máximo**. Evaluar salidas por tiempo frente a trayectorias anteriores y costes, sin prolongar por sistema operaciones malas. |
| F-SPOT-07 | **P0/P1** | Arquitectura confirmada en fuente, fill no verificado | La supervisión consulta el mercado cada **60 s**; protecciones del código son evaluadas por servidor con `ticker.last`. No consta orden nativa de stop mantenida en el exchange en la evidencia revisada. Verificar latencia, fallos, gaps y bid ejecutable. |
| F-SPOT-08 | P1 | Código histórico confirmado | Parámetros de configuración declarados pero no aplicados en la ruta de salida estudiada (`trailingStepPct`, `profitTargetFixedPct`, `defensiveMaxAdversePctR`, umbrales de `regimeExit`). Revisar interfaz/configuración/uso real. |
| F-SPOT-09 | P1 | Ruta histórica confirmada | `manageOpenPositions` llamaba `evaluateExit` sin configuración específica, usando defaults. Verificar correspondencia entre ajustes mostrados al usuario y ajustes **realmente aplicados**; registrar configuración por operación. |
| F-SPOT-10 | P2 | Métrica confirmada | **MFE bruto** y ratio de captura `PnL neto / MFE bruto` pueden interpretarse erróneamente como dinero disponible. Diferenciar neto teórico, último precio, bid y ejecución final. |
| F-SPOT-11 | P1/P2 | Limitación de fuentes confirmada | OHLC archivado **Kraken** frente a cotización/ejecución **Revolut X SHADOW**; faltan ticks/bid-ask originales completos de agosto/septiembre. Las velas 5m históricas se conservan principalmente desde 19/10. Replays exactos NO acreditados. |
| F-SPOT-12 | P1 | Síntoma cuantificado, causa abierta | Invalidaciones numerosas y con grandes pérdidas. Distinguir entrada débil, mercado, ruido de EMA, stop, prioridad de salidas y exposición; no considerar "evitar la invalidación" solución automática. |
| F-SPOT-13 | P1 | Diagnóstico causal por validar | Septiembre: **102 entradas PULLBACK_CONTINUATION** con **−1.546,80 USD**. Analizar régimen, selección, límites de lotes por par, correlaciones y cooldown con señales históricas completas. |
| F-SPOT-14 | P1 | Falta de evidencia demostrada | Faltan reconstrucción exacta de entradas/decisiones, book/bid/ask y candidatos rechazados, replays de cartera coherentes, holdout y walk-forward. Alternativas simples de TP/trailing temprano ensayadas **no demostraron** mejorar el PnL. |

### Consulta abierta; **NO registrada como fallo, propuesta aprobada ni instrucción de desarrollo**

**F-SPOT-15 — Pregunta del usuario:** «¿Puede el bot prever si una operación perderá estructura dentro de unos 180 minutos? ¿Qué hacen los bots profesionales?» No es posible predecir el precio a tres horas con certeza. Algunas estrategias sistemáticas filtran el régimen multi-timeframe, confirman rupturas y usan volatilidad (ATR) para distinguir ruido de invalidación; las salidas realmente protectoras son necesarias. Si se investigara, exigiría validación fuera de muestra y no usar datos futuros para filtrar entradas. **No se pidió crear un filtro predictivo ni modificar la estrategia.**

## Criterios para cerrar cada incidencia

1. Identificar el commit/código **efectivamente desplegado** y reproducir el comportamiento en pruebas, nunca presumir que un commit histórico es producción.
2. Separar defecto confirmado, síntoma, limitación de datos e hipótesis; documentar evidencia y severidad.
3. Evaluar una corrección con comparación antes/después, agosto y septiembre por separado, más período fuera de muestra; medir fee/slippage y impacto sobre ganadoras grandes.
4. Preservar hard stop, seguridad y paridad SPOT SHADOW; **no habilitar trading REAL**.
5. Cerrar solo cuando haya prueba reproducible y aprobación expresa del usuario.

## Fuentes

- [Auditoría forense de protecciones](04-protecciones-forense.md).
- [Salidas profesionales y dinámicas](06-salidas-dinamicas.md).
- [Entradas y contexto](07-entradas-contexto.md).
- [Auditoría independiente de 167 posiciones](../2026-11-18/01-spot-167.md).
- [Política de salidas, commit histórico](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/3ae18319b8c0b68c9374241db65f8ef9bdd39a57/server/services/spot/spotExitPolicy.ts).
- [Informe privado completo (Google Docs)](https://docs.google.com/document/d/1W3-z7Z_rPPGeMRan_Rh_WgNEnBdXP84aiH8ENEe-31M/edit).
- [Fidelity: Average True Range y stops adaptados a volatilidad](https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/atr).

**Alcance de esta entrega:** documentación en GitHub y Google Drive únicamente. **No se ha tocado VPS, configuración del bot, base de datos de producción ni se han colocado órdenes.**
