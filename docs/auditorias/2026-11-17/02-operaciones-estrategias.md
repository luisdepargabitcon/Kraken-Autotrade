# Auditoría de operaciones y estrategias

- **ID estable:** `AUD-20261117-02`
- **Fecha de auditoría:** 2026-11-17
- **Fecha de consolidación del archivo (UTC):** 2026-11-19T11:28:14Z
- **Repositorio:** `luisdepargabitcon/Kraken-Autotrade`
- **Estado:** auditoría finalizada; propuestas y escenarios **NO APROBADOS para trading REAL**
- **Informe original privado:** `NEXA_Auditoria_OPERACIONES_y_ESTRATEGIAS_17-11-2026.html`
- **Ubicación de los originales:** [Carpeta privada de 2026-11-17](https://drive.google.com/drive/folders/1WZMTEf8swuti7jaxz0IIGV5LI3l6kHT7)

## Alcance

Revisión de 389 registros SPOT históricos, 31 ciclos IDCA, eventos GRID y diagnóstico exportado de PostgreSQL.

## Resultados documentados

- Los 389 registros SPOT pertenecen a un universo histórico diferente de las 167 ventas SHADOW examinadas después.
- Las cifras de motores y el diagnóstico de PostgreSQL son datos exportados y no deben atribuirse automáticamente a dinero REAL.

## Limitaciones y criterio de aprobación

No mezclar períodos, poblaciones ni definiciones de PnL. Diagnóstico PostgreSQL no contrastado directamente por SQL en vivo.

**Interpretación:** cifras de trading SHADOW y simulaciones retrospectivas. No son ejecuciones REAL ni predicciones de rentabilidad. Los datos históricos, scripts y operaciones individualizadas se reservan en Drive privado.

## Acciones de seguimiento

- Verificar hipótesis con código y velas cerradas sin información futura.
- Confrontar costes, bid/ask, latencias y fills con fuente de ejecución.
- Exigir replay integral y pruebas fuera de muestra antes de considerar cambios productivos.

## Integridad

El índice y el manifiesto SHA-256 de originales están en la [carpeta maestra privada](https://drive.google.com/drive/folders/1Cz1BHX1yNsxfsHC6M9Y28UvCw3V8lRiO).

Sin cambios en el motor, VPS, órdenes ni configuraciones mediante esta operación documental.
