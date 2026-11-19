# Trailing +15 USD netos y tomas parciales

- **ID estable:** `AUD-20261119-02`
- **Fecha de auditoría:** 2026-11-19
- **Fecha de consolidación del archivo (UTC):** 2026-11-19T11:28:14Z
- **Repositorio:** `luisdepargabitcon/Kraken-Autotrade`
- **Estado:** auditoría finalizada; propuestas y escenarios **NO APROBADOS para trading REAL**
- **Informe original privado:** `CONCLUSIONES_Y_LIMITACIONES.md`
- **Paquete de evidencia privado:** `NEXA_SPOT_TRAILING_15_TESTS.zip`
- **Ubicación de los originales:** [Carpeta privada de 2026-11-19](https://drive.google.com/drive/folders/1af2Guko1FXpzbxQ0fYAMiZP2oGAtzNn5)

## Alcance

Comparativa de 70 variantes de trailing y 15 de beneficios parciales con velas cerradas de 15m.

## Resultados documentados

- Todas las 70 variantes de trailing empeoraron el resultado de la muestra frente a −845,01 USD.
- Un trailing activado a +15 USD netos con distancia 0,35 % y suelo +5 USD produjo −1.429,46 USD en el ensayo.

## Limitaciones y criterio de aprobación

Se simuló USD, no EUR. La muestra es histórica y los precios de vela no garantizan fills.

**Interpretación:** cifras de trading SHADOW y simulaciones retrospectivas. No son ejecuciones REAL ni predicciones de rentabilidad. Los datos históricos, scripts y operaciones individualizadas se reservan en Drive privado.

## Acciones de seguimiento

- Verificar hipótesis con código y velas cerradas sin información futura.
- Confrontar costes, bid/ask, latencias y fills con fuente de ejecución.
- Exigir replay integral y pruebas fuera de muestra antes de considerar cambios productivos.

## Integridad

El índice y el manifiesto SHA-256 de originales están en la [carpeta maestra privada](https://drive.google.com/drive/folders/1Cz1BHX1yNsxfsHC6M9Y28UvCw3V8lRiO).

Sin cambios en el motor, VPS, órdenes ni configuraciones mediante esta operación documental.
