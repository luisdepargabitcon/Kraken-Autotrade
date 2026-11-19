# Simulación combinada de cuatro cambios

- **ID estable:** `AUD-20261119-05`
- **Fecha de auditoría:** 2026-11-19
- **Fecha de consolidación del archivo (UTC):** 2026-11-19T11:28:14Z
- **Repositorio:** `luisdepargabitcon/Kraken-Autotrade`
- **Estado:** auditoría finalizada; propuestas y escenarios **NO APROBADOS para trading REAL**
- **Informe original privado:** `NEXA_SPOT_Simulacion_4_Puntos_19-11-2026.html`
- **Paquete de evidencia privado:** `NEXA_SPOT_Simulacion_4_Puntos_19-11-2026.zip`
- **Ubicación de los originales:** [Carpeta privada de 2026-11-19](https://drive.google.com/drive/folders/1af2Guko1FXpzbxQ0fYAMiZP2oGAtzNn5)

## Alcance

Protección de ganancias, lógica EMA, un lote/pausa y corte de nuevas entradas tras pérdida diaria.

## Resultados documentados

- Un lote/par + pausa 120 min + límite diario retrospectivo: 76 operaciones, −11,34 USD.
- Añadir la protección progresiva a esa combinación: −48,73 USD.
- 22 de 98 invalidaciones no esperaron dos velas íntegramente posteriores a la entrada.

## Limitaciones y criterio de aprobación

Comparación de cohorte histórica, no replay completo de candidatos ni validación fuera de muestra.

**Interpretación:** cifras de trading SHADOW y simulaciones retrospectivas. No son ejecuciones REAL ni predicciones de rentabilidad. Los datos históricos, scripts y operaciones individualizadas se reservan en Drive privado.

## Acciones de seguimiento

- Verificar hipótesis con código y velas cerradas sin información futura.
- Confrontar costes, bid/ask, latencias y fills con fuente de ejecución.
- Exigir replay integral y pruebas fuera de muestra antes de considerar cambios productivos.

## Integridad

El índice y el manifiesto SHA-256 de originales están en la [carpeta maestra privada](https://drive.google.com/drive/folders/1Cz1BHX1yNsxfsHC6M9Y28UvCw3V8lRiO).

Sin cambios en el motor, VPS, órdenes ni configuraciones mediante esta operación documental.
