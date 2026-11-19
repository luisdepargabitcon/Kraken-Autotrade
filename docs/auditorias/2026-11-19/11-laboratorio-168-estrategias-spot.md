# Laboratorio NEXA SPOT — Búsqueda de estrategias y pruebas de robustez (19/11/2026)

**ID:** `AUD-20261119-11` · **Estado:** INVESTIGACIÓN; **NINGUNA ESTRATEGIA VALIDADA NI APROBADA**.  
**Fuente:** 167 operaciones SPOT SHADOW del 20/08 al 12/11/2026 y pertenencia a filtros de entrada de la [auditoría previa A/B](10-comparativa-estrategias-A-B-diaria-mensual.md).  
**Informe HTML privado interactivo:** [Laboratorio de 168 configuraciones](https://drive.google.com/file/d/1pk4g4dIkvnsrmTnvO8yicDt9K92S4tuu/view).  
**Tabla privada completa de las 168 combinaciones:** [CSV de escenarios](https://drive.google.com/file/d/15bASeQBrHuNbrvB9aNs4twtl6eMWZv36/view).  
**Paquete de reproducción privado (HTML, scripts, datos, resultados):** [ZIP reproducible](https://drive.google.com/file/d/1h42cY0jqNyU5VUSeSsd9nA49jgQ75sKj/view).  
**Carpeta privada:** [Auditorías de 19/11/2026](https://drive.google.com/drive/folders/1af2Guko1FXpzbxQ0fYAMiZP2oGAtzNn5).

> Repositorio público: solo agregados y metodología. Los identificadores por operación, posiciones, trazas, saldos y detalles no publicables permanecen en Drive privado.

## Alcance de la exploración

168 parametrizaciones (60 selecciones de operaciones diferentes), combinando:

- 6 filtros de entrada preexistentes: sin filtro; A al menos 3 de 4 confirmaciones; A 4 de 4; B suave, medio y exigente.
- 1 o 2 posiciones simultáneas como máximo por par.
- Pausa tras cierre perdedor: 0/60/120/240 minutos.
- Bloqueo de **nuevas entradas** si el PnL realizado del mismo día UTC ya es ≤ −50 o ≤ −100 USD, o sin bloqueo.
- 24 variantes adicionales con tamaño A-solo del 25/50/75 % y B al 100 %, en combinaciones seleccionadas de exposición.
- Pruebas de fricción adicional round-trip del 0,05 y del 0,10 % sobre nominal original de las operaciones admitidas.

Se procesan entradas en orden temporal, contabilizando una salida únicamente cuando su hora histórica ya había llegado. **Esto no reproduce** nuevas señales que habrían surgido al liberar capital ni contempla el presupuesto global y las interacciones completas del motor de ejecución.

## Resultados resumidos

| Escenario | Admitidas | Neto histórico USD | Sept.–nov. USD | Con 0,10 % fricción adicional USD |
|---|---:|---:|---:|---:|
| NEXA original | 167 | −845,00 | −1.875,00 | −1.251,86 |
| A 3/4, 2 lotes | 112 | +277,05 | −950,25 | +23,38 |
| A 4/4, 2 lotes | 75 | +406,96 | −652,59 | +239,15 |
| B medio, 2 lotes | 38 | +249,89 | −216,96 | +172,09 |
| B exigente, 2 lotes | 24 | **+495,96** | −10,08 | +450,18 |
| B exigente, 1 lote | **15** | **+399,32** | **+41,19** | **+369,07** |
| A 4/4, 1 lote | 42 | +307,90 | −325,21 | +208,81 |
| B medio, 1 lote | 21 | +272,83 | −66,86 | +228,44 |

Las diferencias de un céntimo frente a los informes originales se deben al uso de los PnL individuales con dos decimales. La cohorte con mayor precisión sumaba −845,01 USD.

### Candidata a seguir investigando — **NO VALIDADA**

**B exigente, máximo una posición por moneda**: impulso 15m/3 velas ≥+0,35 %, impulso 15m/6 velas ≥+0,70 %, cuerpo de vela 15m ≥+0,20 %, pendiente EMA20 de 1h >+0,25 %.

- 15 operaciones: 11 ganadoras; 12 días distintos con operaciones.
- Agosto: **+358,13 USD** en cinco compras; septiembre: **+41,19 USD** en diez; octubre y noviembre: **ninguna entrada admitida**.
- Con fricción extra del 0,10 % sobre el nominal: **+369,07 USD total**, septiembre **+21,42 USD**.
- Si se eliminan las dos mejores operaciones, queda **+106,73 USD**; sin las cinco mejores resulta **−77,11 USD**. Esto evidencia dependencia de pocas operaciones.
- Septiembre contiene una venta que ganó **+82,88 USD**, por encima de sus **+41,19 USD** netos totales. Retirarla volvería negativo ese mes.
- Drawdown de PnL *realizado* −65,15 USD; no se midió drawdown de valor de cartera ni eventos intradía.

**Advertencia:** los parámetros B se estudiaron utilizando el mismo histórico; octubre y noviembre constan de solo 11 operaciones originales, y filtrar todas ellas no demuestra utilidad económica en un mercado que cambie. No hay prueba independiente de rentabilidad futura.

## Control adicional contra selección retrospectiva

Ensayo de **elección cronológica mensual**: para septiembre se eligió la familia con mayor PnL liquidado hasta fin de agosto; para octubre, la que destacaba hasta septiembre, etc., sin emplear en esa elección cierres posteriores a la fecha de selección.

| Mes observado | Política elegida con información previa | Operaciones | Neto USD |
|---|---|---:|---:|
| Septiembre | A 3/4, 2 lotes | 71 | **−590,63** |
| Octubre | A 4/4, 2 lotes | 7 | **−234,07** |
| Noviembre | B exigente, 2 lotes | 0 | **0,00** |
| **Total** | | | **−824,70** |

El proceso de elección usa resultados pasados, pero **no es walk-forward independiente**, ya que las reglas y sus umbrales fueron diseñados tras estudiar la misma cohorte. Demuestra de forma ilustrativa que la mejor regla del tramo agosto no fue resistente al giro de septiembre.

## Limitaciones que impiden considerar la estrategia «ganadora»

1. Falta el registro original de todas las señales rechazadas y de las que habría generado otro estado de capital; los 167 lotes admitidos originalmente no bastan para replay completo del motor.
2. No se dispone de una serie bid/ask ejecutable completa del venue de operación ni de fills simulados con latencia para todos los cierres; las OHLC 15m Kraken no son precios firmes de Revolut X.
3. Las entradas y los umbrales ya han sido revisados por analistas sobre estos meses. No existe holdout intacto; además, el número de fechas independientes para la candidata es reducido.
4. Un freno por pérdida diaria realizado no garantiza pérdida máxima diaria: no liquida posiciones abiertas ni predice sus pérdidas.
5. Los retornos y la dispersión dependen de posiciones muy correlacionadas, posibles pares gemelos y ganancias concentradas. El drawdown calculado en operaciones cerradas no equivale a riesgo máximo mientras permanecían abiertas.
6. Buscar entre muchas combinaciones hasta hallar +PnL produce **sesgo de búsqueda/selección**. Ningún número positivo aquí autoriza un despliegue en REAL.

## Próxima validación necesaria

1. Congelar especificaciones de B exigente/1 lote y comparadores antes de recopilar nuevos datos, sin ajustar por resultados del test.
2. Auditar que los indicadores solo usan velas cerradas y que el código realmente aplicado registra el filtro vigente, el precio ejecutable y cada motivo de rechazo.
3. Crear replay de señales completas con límites de capital, exposición simultánea, fees, spread, slippage y stops; evaluar meses/regímenes nuevos verdaderamente no vistos.
4. Ejecutar SHADOW prospectivo y medir PnL neto, pérdida máxima de cartera, costes reales, estabilidad por moneda y días independientes antes de considerar cualquier cambio al trading real.
5. El usuario deberá aprobar de manera explícita cualquier modificación operativa. **No se alteraron VPS, configuración, código ejecutable ni órdenes**.

**Conclusión:** la búsqueda encontró una candidata histórica que merece un experimento futuro, **no una estrategia de ganancias garantizadas ni científicamente validada**.
