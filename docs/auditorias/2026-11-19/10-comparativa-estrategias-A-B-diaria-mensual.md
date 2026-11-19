# NEXA SPOT — Comparativa de estrategias A y B por día y mes

**ID de auditoría:** `AUD-20261119-10` · **Fecha:** 2026-11-19 · **Estado:** simulación exploratoria, **SIN VALIDACIÓN FUERA DE MUESTRA NI APROBACIÓN PARA TRADING**.  
**Universo:** 167 compras SPOT SHADOW históricas (agosto–noviembre de 2026).  
**Informe HTML privado e interactivo:** [Abrir en Google Drive](https://drive.google.com/file/d/1aVwbdKZ9Qk32gNPo_vSOVDrh2xJYnONg/view).  
**CSV privado de las 167 operaciones:** [Abrir en Google Drive](https://drive.google.com/file/d/1HQlBn9MbYJv3TI4nT95xEtddhg1YjUQq/view).  
**Carpeta de auditorías privadas:** [19/11/2026](https://drive.google.com/drive/folders/1af2Guko1FXpzbxQ0fYAMiZP2oGAtzNn5).

> El repositorio es público y contiene **solo conclusiones agregadas**, sin operaciones individuales, precios por lote ni datos privados. Todo el detalle queda en Drive de acceso restringido.

## Pregunta

¿Se pueden combinar las familias A (confirmación múltiple) y B (filtro de tendencia y ruido), y cómo cambian los resultados diarios, mensuales y totales? Se compararon también una estrategia de **tamaño escalonado** y, de forma secundaria, la triple barrera C.

## Reglas y relación

- **A**: 3 de 4 condiciones positivas anteriores a la compra: momentum 15m (3 velas), momentum 15m (6 velas), cuerpo alcista 15m y pendiente EMA20 de 1h.
- **B**: momentum 15m/3 velas >= +0,25 %; momentum 15m/6 velas >= +0,50 %; cuerpo vela >= +0,15 %; pendiente EMA20 1h positiva.
- **Hallazgo central:** las **38 compras B están incluidas entre las 112 compras A**. Por tanto **A Y B = B** y **A O B = A**. No hay operaciones «solo B».
- **A+B escalonada:** todas las compras B mantienen el 100 % del tamaño original; las 74 que pasan solo A mantienen el 50 % (regulable entre 0 % y 100 % en el HTML). Las 55 restantes se rechazan. La PnL se escala proporcionalmente; NO es una reconstrucción de ejecuciones, tarifas mínimas, capital ni órdenes.
- **C experimental**: +2R/−1R/180 minutos; aplica decisión sobre vela Kraken 15m cerrada y venta proxy en cierre de vela posterior disponible antes de la venta histórica, fricción extra 0,05 % y fee 0,09 % por lado. No es un backtest de stop exchange intrabar.

## Totales sobre la muestra existente

| Escenario | Operaciones admitidas | Neto USD |
|---|---:|---:|
| NEXA original | 167 | **−845,00** |
| A | 112 | **+277,05** |
| B | 38 | **+249,89** |
| A Y B | 38 | **+249,89** |
| A O B | 112 | **+277,05** |
| A+B escalonado (B 100 % y solo A 50 %) | 112 (75 lotes equivalentes) | **+263,47** |
| Triple barrera C sola | 167 | **−1.256,13** |
| A + C | 112 | **−134,08** |
| B + C | 38 | **−30,11** |
| A+B escalonado + C | 112 | **−82,09** |

**Diferencia de redondeo:** los resultados se recomputan con PnL por posición redondeado a centavos de la fuente OPS; el informe con netos de mayor precisión informa originalmente −845,01 USD, A +277,06 USD, B +249,89 USD. Las cifras de este análisis pueden diferir aproximadamente 0,01 USD.

## Resultado por mes de COMPRA (USD)

| Mes | Original | A | B = A y B | A+B escalonada |
|---|---:|---:|---:|---:|
| Agosto | +1.030,00 | +1.227,30 | +466,85 | +847,08 |
| Septiembre | −1.515,38 | −590,63 | −101,86 | −346,25 |
| Octubre | −234,07 | −234,07 | −61,58 | −147,82 |
| Noviembre | −125,55 | −125,55 | −53,52 | −89,53 |
| **Total** | **−845,00** | **+277,05** | **+249,89** | **+263,47** |

El HTML desglosa **29 días con operaciones**, mes por mes y las **167 operaciones** con filtros por fecha de compra, moneda, clasificación y motivo de salida. Permite variar el porcentaje de capital de los lotes «solo A» y exportar CSV por día y operación.

## Conclusión auditada

Las reglas A y B no son complementarias como filtros booleanos; B es estrictamente más selectiva. La versión escalonada ofrece una **hipótesis de asignación de riesgo**, no una nueva señal predictiva validada. Aunque el agregado retrospectivo sea positivo, septiembre, octubre y noviembre conservan pérdidas. La familia C en el modelo disponible recortó ganancias grandes y fue peor que A/B solas.

**Limitaciones críticas:** selección a posteriori en cohorte de compras ya hechas; no se reconstruyen señales descartadas, liberación de capital, comisiones variables, precios bid/ask ejecutables ni correlación de lotes; OHLC Kraken 15m no implica fill Revolut X SHADOW. Umbrales vistos en muestra: riesgo alto de sobreajuste. Falta walk-forward/holdout y ejecución SHADOW prospectiva antes de comparar rentabilidad futura.

**No se han modificado VPS, código del motor, configuración, estrategias productivas, órdenes ni estado REAL.**