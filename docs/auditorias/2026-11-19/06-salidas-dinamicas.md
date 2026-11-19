# Simulación de salidas profesionales y dinámicas

- **ID estable:** `AUD-20261119-06`
- **Fecha de auditoría:** 2026-11-19
- **Fecha de consolidación del archivo (UTC):** 2026-11-19T11:28:14Z
- **Repositorio:** `luisdepargabitcon/Kraken-Autotrade`
- **Estado:** auditoría finalizada; propuestas y escenarios **NO APROBADOS para trading REAL**
- **Informe original privado:** `NEXA_SPOT_Salidas_Dinamicas_Informe_2026-11-19.html`
- **Paquete de evidencia privado:** `NEXA_SPOT_Salidas_Profesionales_21_Politicas_2026-11-19.zip`
- **Ubicación de los originales:** [Carpeta privada de 2026-11-19](https://drive.google.com/drive/folders/1af2Guko1FXpzbxQ0fYAMiZP2oGAtzNn5)

## Alcance

Veinte políticas alternativas de salida sin tramos fijos, ATR, EMA, pérdida de impulso y costes.

## Resultados documentados

- La mejor salida aislada ensayada (EMA20 con dos cierres completos) quedó en −813,64 USD.
- La venta inmediata al primer cierre positivo sube la proporción de ganadoras pero empeora el PnL a alrededor de −1.528 USD.
- Una combinación defensiva dio +9,84 USD, pero volvió a negativo con mayor fricción.

## Limitaciones y criterio de aprobación

No permite concluir rentabilidad ni fills de stops persistentes; las fechas futuras y candidatos descartados requieren replay integral.

**Interpretación:** cifras de trading SHADOW y simulaciones retrospectivas. No son ejecuciones REAL ni predicciones de rentabilidad. Los datos históricos, scripts y operaciones individualizadas se reservan en Drive privado.

## Acciones de seguimiento

- Verificar hipótesis con código y velas cerradas sin información futura.
- Confrontar costes, bid/ask, latencias y fills con fuente de ejecución.
- Exigir replay integral y pruebas fuera de muestra antes de considerar cambios productivos.

## Integridad

El índice y el manifiesto SHA-256 de originales están en la [carpeta maestra privada](https://drive.google.com/drive/folders/1Cz1BHX1yNsxfsHC6M9Y28UvCw3V8lRiO).

Sin cambios en el motor, VPS, órdenes ni configuraciones mediante esta operación documental.
