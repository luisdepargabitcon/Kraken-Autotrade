# Venta directa al alcanzar +10 USD netos

- **ID estable:** `AUD-20261119-03`
- **Fecha de auditoría:** 2026-11-19
- **Fecha de consolidación del archivo (UTC):** 2026-11-19T11:28:14Z
- **Repositorio:** `luisdepargabitcon/Kraken-Autotrade`
- **Estado:** auditoría finalizada; propuestas y escenarios **NO APROBADOS para trading REAL**
- **Informe original privado:** `NEXA_SPOT_TP10_Informe_2026-11-19.html`
- **Paquete de evidencia privado:** `TP10_DATOS_Y_METODOLOGIA_2026-11-19.zip`
- **Ubicación de los originales:** [Carpeta privada de 2026-11-19](https://drive.google.com/drive/folders/1af2Guko1FXpzbxQ0fYAMiZP2oGAtzNn5)

## Alcance

Cierre fijo de cada posición al superar +10 USD netos, en lugar de esperar un trailing.

## Resultados documentados

- 61 de 167 operaciones alcanzaron el precio-objetivo según el modelo con velas de 15m.
- El total contrafactual fue −1.733,32 USD: vender temprano recortó operaciones de mayor beneficio.

## Limitaciones y criterio de aprobación

No es un fill garantizado. Se conserva resultado original de los lotes sin objetivo.

**Interpretación:** cifras de trading SHADOW y simulaciones retrospectivas. No son ejecuciones REAL ni predicciones de rentabilidad. Los datos históricos, scripts y operaciones individualizadas se reservan en Drive privado.

## Acciones de seguimiento

- Verificar hipótesis con código y velas cerradas sin información futura.
- Confrontar costes, bid/ask, latencias y fills con fuente de ejecución.
- Exigir replay integral y pruebas fuera de muestra antes de considerar cambios productivos.

## Integridad

El índice y el manifiesto SHA-256 de originales están en la [carpeta maestra privada](https://drive.google.com/drive/folders/1Cz1BHX1yNsxfsHC6M9Y28UvCw3V8lRiO).

Sin cambios en el motor, VPS, órdenes ni configuraciones mediante esta operación documental.
