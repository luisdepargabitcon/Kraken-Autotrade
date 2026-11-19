# Auditoría forense de protecciones SPOT

- **ID estable:** `AUD-20261119-04`
- **Fecha de auditoría:** 2026-11-19
- **Fecha de consolidación del archivo (UTC):** 2026-11-19T11:28:14Z
- **Repositorio:** `luisdepargabitcon/Kraken-Autotrade`
- **Estado:** auditoría finalizada; propuestas y escenarios **NO APROBADOS para trading REAL**
- **Informe original privado:** `NEXA_SPOT_Informe_Causal_Protecciones_19-11-2026.html`
- **Paquete de evidencia privado:** `PROTECCIONES_EVIDENCIAS_2026-11-19.zip`
- **Ubicación de los originales:** [Carpeta privada de 2026-11-19](https://drive.google.com/drive/folders/1af2Guko1FXpzbxQ0fYAMiZP2oGAtzNn5)

## Alcance

Comparación de 47 ganadoras y 106 posiciones con MFE positivo bruto que acabaron perdiendo.

## Resultados documentados

- 102 de 106 perdedoras que llegaron a positivo bruto no alcanzaron el umbral de 1R para armar break-even.
- El BE al precio de entrada no cubre fees y el supervisor consulta precios a intervalos de 60 segundos.
- Las invalidaciones tienen prioridad sobre BE/trailing, y algunas variables declaradas no se aplican en la política revisada.

## Limitaciones y criterio de aprobación

No se ha probado que los máximos intravela hubieran producido ventas netas; las conclusiones distinguen fallo de diseño de fallo de implementación.

**Interpretación:** cifras de trading SHADOW y simulaciones retrospectivas. No son ejecuciones REAL ni predicciones de rentabilidad. Los datos históricos, scripts y operaciones individualizadas se reservan en Drive privado.

## Acciones de seguimiento

- Verificar hipótesis con código y velas cerradas sin información futura.
- Confrontar costes, bid/ask, latencias y fills con fuente de ejecución.
- Exigir replay integral y pruebas fuera de muestra antes de considerar cambios productivos.

## Integridad

El índice y el manifiesto SHA-256 de originales están en la [carpeta maestra privada](https://drive.google.com/drive/folders/1Cz1BHX1yNsxfsHC6M9Y28UvCw3V8lRiO).

Sin cambios en el motor, VPS, órdenes ni configuraciones mediante esta operación documental.
