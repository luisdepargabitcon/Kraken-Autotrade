# AUD-20261120-03-B — Contraauditoría final documental y plan de evolución NEXA

**Documento complementario:** la versión principal y más extensa de esta contraauditoría es [AUD-20261120-03](03-contraauditoria-final-nexa-v2.md) (22 hallazgos). Este anexo reúne 18 comprobaciones focalizadas y una matriz resumida; no debe presentarse como una segunda auditoría distinta.\n\n**Fecha:** 2026-11-20. **Tipo:** contraauditoría independiente de código + reconciliación de resultados históricos.  
**Base GitHub verificada:** `6ed48825ce53b898a1a37117c77718faac7de29f` de `main` (antes de registrar esta nueva auditoría).  
**Estado:** auditoría **estática completada**, **runtime NO VERIFICADO** por falta de conexión al VPS. Este informe NO certifica la aplicación de configuraciones, ni seguridad del perímetro, ni órdenes de REAL.

## Informe HTML final (Google Drive privado)

[**Abrir informe interactivo completo**](https://drive.google.com/file/d/1UEVl0HsWKUZNsNJKKk58Hrbwk29vmBXH/view)

Contiene **18 hallazgos** clasificados por prioridad y fuerza probatoria, matriz de **16 grupos de configuración**, **9 clases de fuentes** de datos, inventario de los **4 motores**, comparativa contrastada de backtests (A/B, D/E/F y tres variantes Grid), pruebas pendientes y hoja de ruta de transformación. Incluye citas a líneas del código fuente de GitHub. No incluye secretos ni valores de credenciales.

## Arquitectura comprobada

| Motor independiente | Código principal | Decisión |
|---|---|---|
| SPOT/Swing/Momentum | `server/services/tradingEngine.ts` y `strategies.ts` | Conservar motor/observabilidad; revisar señales y configuraciones. La estrategia `grid` histórica del SPOT es distinta del Grid aislado y sigue en el selector de TradingEngine. |
| IDCA institucional | `server/services/institutionalDca/IdcaEngine.ts` | Conservar ciclos, salidas y sliders; verificar cada parámetro hasta la decisión. `getEffectiveEntryConfig` sí aparece en el núcleo. |
| Grid aislado | `server/services/gridIsolated/gridIsolatedEngine.ts` | Preservar obligaciones 1 BUY→1 SELL y rangos heredados; uso SHADOW hasta validar la ejecución maker. |
| AMA macro | `server/services/ama/amaRuntimeService.ts` | Conservar LAB, REPLAY, SHADOW y modelos macro; REAL todavía NO certificado. |

**Dependencias compartidas:** `ExchangeFactory`, `MarketDataService`, PostgreSQL, servicios de Portfolio, FISCO, métricas y Telegram. La independencia lógica NO prueba que todas las compras queden cubiertas por una reserva global de capital.

## Hallazgos prioritarios (resumen publicable sin secretos)

1. **P0:** discrepancia de semántica entre reserva y ejecución real en la pasarela AMA: una reserva exitosa no acredita orden real enviada/ejecutada. Mantener gates REAL cerrados hasta completar y certificar la integración.
2. **P0 condicionado:** verificar de forma prioritaria la autorización y el perímetro real de los endpoints mutables antes de exponer el servicio. La lectura estática no demuestra exposición externa.
3. **P1:** `dataExchange` se recibe en `ExchangeFactory.initializeFromConfig` pero en ese inicio se fuerza Kraken.
4. **P1:** fallback de velas desde DB no demuestra allí frescura por timestamp del último cierre.
5. **P1:** AMA reconstruye un timestamp de análisis a la hora de consulta; se requiere timestamp de observación fuente.
6. **P1:** hay fallback de exchange que exige comprobaciones fail-closed en la trayectoria de órdenes.
7. **P1:** el startup tiene procesos de migración, reconciliación y limpieza, por lo que un reinicio NO es una auditoría solo lectura.
8. **P1:** registros de API requieren auditoría de minimización y censura de respuestas sensibles.
9. **P2:** `ConfigService` puede devolver objetos de configuración no válidos tras fallo de validación; su `cacheTimeout` declarado no se utiliza en ese archivo.
10. **P2:** Grid de señales SPOT y Grid aislado son códigos distintos; AMA conserva un scaffold antiguo.
11. **P2:** gates, flags, sliders y proveedores no pueden clasificarse como aplicados hasta contrastar UI→persistencia→valor efectivo→decisión; varios componentes son investigación o proveedores condicionales.
12. **P2:** el repositorio público contiene archivos de entorno y residuos históricos; esto NO demuestra por sí solo secretos reales expuestos.

**Detalle con referencias a archivos exactos y estatus del hallazgo:** HTML privado y auditorías de arquitectura:
- [AUD-20261120-02 — auditoría integral](02-auditoria-integral-motores-config-fuentes-codigo.md)
- [AUD-20261120-02-A — anexo focalizado](02-auditoria-arquitectura-motores-configuraciones-deuda-tecnica.md)

## Resultados históricos contrastados

Los resultados se extrajeron de los ZIP reproducibles previos con 10.000 USDT de capital base y periodo 01/08/2026–18/11/2026, y **no son simulaciones nuevas de esta contraauditoría**.

| Prueba | Neto USDT coste base | Operaciones cerradas |
|---|---:|---:|
| B exigente + mercado BTC | +159,27 | 86 |
| B exigente | +108,13 | 91 |
| D ruptura | −598,18 | 84 |
| E falsa ruptura | −1.586,27 | 192 |
| F rotación | −288,60 | 41 |
| Grid continuo | −166,95 | 92 |
| Grid adaptativo | −173,05 | 41 |
| Grid + swing | −241,88 | 53 |

**NO extrapolar** entre familias: tienen simuladores, exposición y reglas diferentes. Los parámetros proceden de investigación en la ventana histórica y carecen de un holdout verdaderamente independiente. No hay estrategia aprobada para REAL por estas pruebas.

## Decisión técnica: aprovechar / corregir / apartar

- **Aprovechar:** motores independientes, indicadores y exits SPOT, ciclos IDCA, BUY→SELL y rangos del Grid, laboratorio AMA, PostgreSQL, cartera, FISCO, monitorización, Telegram y suites.
- **Corregir primero:** seguridad de las rutas y registros, observabilidad de configuración efectiva, frescura/procedencia de datos, selección del exchange sin fallback silencioso, garantías de reservas globales y semántica de ejecución real AMA.
- **Aislar como legado, NO borrar aún:** `amaService.ts` scaffold, `gridStrategy` clásico SPOT (sigue referenciado), archivos `.local`, backups y configuraciones/proveedores con uso operativo no demostrado.
- **Evolución recomendada:** plataforma multiestrategia con cuatro motores **independientes** y un servicio compartido de riesgo/contabilidad. El clasificador alcista/lateral/bajista debe operar primero como **observador**. DCA bajista limitado, Grid lateral y Swing alcista son **hipótesis de investigación**, no garantía de rentabilidad.

## Contraauditoría del VPS: límite explícito

Se intentó conexión TCP solo para auditoría desde este entorno: 22/80/443/5000 devolvieron rechazo de conexión. **No se ejecutó SSH, no se consultó DB, ni se inspeccionaron contenedores, logs, configuraciones efectivas, órdenes ni reverse proxy.** El rechazo no demuestra que el VPS esté inactivo. El informe final se considera **integral documental**, no certificado de ejecución.

Siguiente paso requerido para cerrar la fase runtime: obtener desde entorno autorizado evidencias **de solo lectura** del SHA desplegado, estado de motores, configuración efectiva por par, provenance/freshness de market data, permisos/perímetro API, reservas y saldos, órdenes y reconciliación, y tests aislados, **sin ejecutar START/STOP, POST, migraciones, UPDATE, deploy ni modificar ciclos**.

**Permisos:** Solo se añadió documentación a GitHub y el informe HTML a Drive privado. No se modificaron VPS, DB, motores, órdenes, pares, configuraciones, ciclos ni objetivos SELL.
