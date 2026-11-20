# AUD-20261120-03 — Contraauditoría final de NEXA y propuesta de reconversión V2

**Fecha:** 20 de noviembre de 2026  
**Repo auditado:** `luisdepargabitcon/Kraken-Autotrade`  
**Snapshot del código:** `ee497e60aae16f5e22116e7133c92e287db377ac`  
**Estado:** CONTRAAUDITORÍA ESTÁTICA CONCLUIDA / VERIFICACIÓN EFECTIVA DE VPS PENDIENTE  
**Ámbito de operaciones:** lectura de GitHub y archivos anteriores únicamente; sin cambio de motores, cuentas, órdenes, VPS, base de datos ni configuraciones.

## Entregables íntegros (privados)

- **[HTML final interactivo: NEXA, qué conservar, qué corregir y cómo reconvertir](https://drive.google.com/file/d/1lakf2MNxUQJn0IrPi4nB6G8caBEctSpd/view)**. Incluye cuatro motores, 11 fuentes/capas, 22 hallazgos, filtros de severidad, evidencia por archivo, comparación de backtests y el plan NEXA V2.
- [Resumen técnico archivado en Drive](https://docs.google.com/document/d/1kUh5FIHvKYzgvYRzw-dMtfbjeq2tyl_4/edit).
- [Auditoría integral previa AUD-20261120-02](02-auditoria-integral-motores-config-fuentes-codigo.md) y [anexo de verificación](02-auditoria-arquitectura-motores-configuraciones-deuda-tecnica.md).
- [Backtest Grid, adaptativo e híbrido AUD-20261120-01](01-backtest-grid-continuo-adaptativo-hibrido.md).
- [Investigación histórica SPOT SHADOW](../2026-11-19/08-informe-fallos-spot-2026-11-19.md).

## Contraauditoría y veredicto

Se reabrieron y confrontaron los archivos exactos del repositorio y los informes anteriores. Se verificaron, entre otros, los caminos `TradingEngine.start/loadDynamicConfig/setupConfigListener`, `ConfigService.update/activate`, `ExchangeFactory.initializeFromConfig/getExchange`, `MarketDataService.getCandles/getTicker/getCandlesFromDb`, `amaRealExecutionGateway.executeRealOrder`, `amaMarketRuntimeService`, `IdcaEngine`, `IdcaSliderConfig`, `gridCycleStartupService`, `marketMetrics` y el middleware de `server/index.ts`.

**Hay discrepancias confirmadas de código:**
1. AMA devuelve `executed: true` con `orderId: null` tras reserva, sin enviar orden al exchange. **No activar REAL.** [Código](../../../server/services/ama/amaRealExecutionGateway.ts#L150-L200).
2. SPOT usa dos fuentes para `dryRunMode`: `loadDynamicConfig` carga `global.dryRunMode` y el arranque lo sobrescribe con `bot_config.dryRunMode`. [Código](../../../server/services/tradingEngine.ts#L2395-L2420).
3. ConfigService update/activate no emite automáticamente los eventos `config:updated` y `config:activated` que TradingEngine escucha. La ruta de feature flags sí los emite. Un cambio guardado puede no verse reflejado en el motor sin otra acción. [ConfigService](../../../server/services/ConfigService.ts#L188-L323) · [TradingEngine](../../../server/services/tradingEngine.ts#L5932-L5965).
4. `ExchangeFactory` ignora `config.dataExchange` durante la inicialización y fija Kraken; `getExchange('revolutx')` puede devolver Kraken si Revolut X no está inicializado. No se ha demostrado envío de una orden a un venue erróneo. [Código](../../../server/services/exchanges/ExchangeFactory.ts#L37-L210).
5. Cache/fallback de datos puede entregar velas o ticker antiguos sin validación suficiente de la última observación; AMA usa timestamp de consulta, no necesariamente timestamp de proveedor. [MDS](../../../server/services/MarketDataService.ts#L148-L320) · [AMA](../../../server/services/ama/amaMarketRuntimeService.ts#L25-L145).
6. `server/index.ts` añade las respuestas JSON completas a logs de /api, con riesgo de registro de información sensible. [Código](../../../server/index.ts#L34-L51).
7. IDCA con `Ladder ATRP` activo ignora `safetyOrdersJson` heredado; conviene presentar el ajuste legacy como no aplicado. [Código](../../../server/services/institutionalDca/IdcaEngine.ts#L1789-L1812).
8. Existen tres conceptos distintos de Grid: `gridStrategy` de SPOT, overlay IDCA y el motor Grid aislado con ciclos. Nunca equipararlos.
9. AMA tiene scheduler y SHADOW pero una tarea `TODO` de reconciliación en el propio tick; la migración inicial 080 se mantiene excluida de autoaplicación por diseño.

**Riesgos pendientes de confirmar:**
- autenticación/autorización efectiva de rutas tras reverse proxy y firewall; el código Express no muestra guard general previo a todas las mutaciones, pero NO se ha comprobado exposición externa;
- integración completa de reservas de capital entre SPOT, IDCA, Grid y AMA (existe `PortfolioIntegrationAdapter`, no se probó cada vía final de compra);
- configuración real por motor, flags, proveedores activos y acceso a claves del VPS; no se ha ejecutado una sola orden o acción remota;
- historia pública .env y estado local: presencia de archivos confirmada, **filtración de claves reales NO demostrada**.

## Intento de validación runtime (solo conectividad)

Se probó TCP read-only de red desde este entorno, sin autenticación ni órdenes:
- SSH/22: `connection refused`.
- Web 80, 443, 3000, 5000 y 8080: `connection refused`.

Por tanto, **NO existe evidencia de inspección efectiva del VPS**: no se ha podido obtener BUILD_COMMIT, logs, DB, configuración, ciclos ni órdenes. No debe declararse la contraauditoría runtime terminada. Los workflows recientes visibles de GitHub Actions son de descarga de datos OHLCV en una rama de investigación y **no** acreditan la suite actual de `main`.

## ¿Qué aprovechar y qué retirar?

| Decisión | Componentes |
|---|---|
| **CONSERVAR** | SPOT/TradingEngine como infraestructura de ejecución/salidas y auditoría; IDCA y sus ciclos/ladder/derivador; Grid aislado con BUY→SELL y MAKER_ONLY; AMA LAB/REPLAY/SHADOW; MarketDataService, portfolio, FISCO, fuentes, logs y UI. |
| **CORREGIR CON PRIORIDAD** | FALSE executed de AMA, auth/rutas, logging sensible, dryRun único, hot reload, timestamps fuente, fallo explícito de venue, reservas atómicas y reconciliación de arranque. |
| **OCULTAR / DEPRECAR PARA NUEVO DISEÑO** | Grid de señales SPOT presentado como Grid aislado, controles guardados pero no aplicados, sliders legacy bajo ladder ATRP, fuentes conceptualizadas sin ingesta real, botones REAL de AMA no implementados. |
| **NO BORRAR AÚN** | amaService stub, componentes .backup, scripts temporales, migraciones legacy y órdenes/ciclos históricos. Necesitan mapa de importaciones y pruebas antes de retirarlos. |
| **NO PROMOVER A REAL** | Estrategias con backtests negativos o pequeñas ganancias dentro de muestra sin validación futura; AMA gateway; cualquier automatismo sin límites comunes. |

## Reconversión propuesta: NEXA Control Tower V2

**No fusionar ni reescribir los motores.** Construir una capa de gobierno que conozca saldos/posiciones/reservas por motor, la fuente y edad de los datos, los ajustes efectivos y las decisiones. Conservar modos aislados y no transferir órdenes entre ellos.

1. **F0, seguridad y verdad de la ejecución:** semántica AMA; auth; logs; venue fail-closed; modo REAL/dry-run inequívoco.
2. **F1, observabilidad:** matriz UI → API → DB → resolved → applied → decision; fuente y último timestamp por motor; alertas de stale.
3. **F2, cartera compartida:** presupuesto/reserva/lock atómicos para evitar doble gasto y venta cruzada entre motores.
4. **F3, especialización SHADOW:** swing alcista selectivo con SPOT, Grid maker-only en rangos, IDCA limitado para acumulación, AMA macro LAB/SHADOW; «sin nuevas compras» cuando el régimen no sea fiable. **Hipótesis, no sistema rentable demostrado**.
5. **F4, validación:** backtest independiente, costes reales del venue, drawdown de cartera e inventario, comparativa con efectivo/BTC buy-and-hold.
6. **F5, APK moderna:** modo básico minimalista y Pro, controles efectivos, logs y cartera global, sin UI que prometa acciones inexistentes.

**Decisión:** conservar infraestructura de cuatro motores, reparar componentes críticos y validar resultados; NO autorización de VPS, despliegue ni REAL.

**Siguiente verificación necesaria:** inspección read-only de staging cuando vuelva la conectividad, con cotejo del commit desplegado y configuración efectiva de cada motor antes de redactar cualquier certificado de runtime.
