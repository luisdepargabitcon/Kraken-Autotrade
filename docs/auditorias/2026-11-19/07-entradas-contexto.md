# Investigación de entradas y contexto de mercado

- **ID estable:** `AUD-20261119-07`
- **Fecha de auditoría:** 2026-11-19
- **Fecha de consolidación del archivo (UTC):** 2026-11-19T11:28:14Z
- **Repositorio:** `luisdepargabitcon/Kraken-Autotrade`
- **Estado:** auditoría finalizada; propuestas y escenarios **NO APROBADOS para trading REAL**
- **Informe original privado:** `NEXA_SPOT_Auditoria_Entradas_19-11-2026.html`
- **Paquete de evidencia privado:** `NEXA_SPOT_Entradas_Investigacion_19-11-2026.zip`
- **Ubicación de los originales:** [Carpeta privada de 2026-11-19](https://drive.google.com/drive/folders/1af2Guko1FXpzbxQ0fYAMiZP2oGAtzNn5)

## Alcance

Análisis de velas previas 15m, 1h y 4h, fuerza del pullback y limitaciones de reconstruir rechazos.

## Resultados documentados

- Ganadoras y perdedoras mostraron diferencias exploratorias en impulso previo y fuerza de velas.
- En septiembre, 102 compras tipo PULLBACK_CONTINUATION sumaron −1.546,80 USD.
- El filtro V4 actual no existía en algunos commits antiguos y se detectó una incoherencia temporal del origen 15m pendiente de prueba.

## Limitaciones y criterio de aprobación

No se dispone de todos los rechazos reales de agosto-septiembre ni de bid/ask tick Revolut X; la lista de candidatos es reconstruida y no son rechazos verificados.

**Interpretación:** cifras de trading SHADOW y simulaciones retrospectivas. No son ejecuciones REAL ni predicciones de rentabilidad. Los datos históricos, scripts y operaciones individualizadas se reservan en Drive privado.

## Acciones de seguimiento

- Verificar hipótesis con código y velas cerradas sin información futura.
- Confrontar costes, bid/ask, latencias y fills con fuente de ejecución.
- Exigir replay integral y pruebas fuera de muestra antes de considerar cambios productivos.

## Integridad

El índice y el manifiesto SHA-256 de originales están en la [carpeta maestra privada](https://drive.google.com/drive/folders/1Cz1BHX1yNsxfsHC6M9Y28UvCw3V8lRiO).

Sin cambios en el motor, VPS, órdenes ni configuraciones mediante esta operación documental.
