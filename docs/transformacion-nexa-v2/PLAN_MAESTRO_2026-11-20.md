# NEXA V2 — PLAN MAESTRO DE TRANSFORMACIÓN
**Fecha:** 20-11-2026 · **Estado:** PLAN DE TRABAJO, NO APROBACIÓN REAL
**Repositorio:** https://github.com/luisdepargabitcon/Kraken-Autotrade
**Rama de implementación:** `feature/nexa-v2-transformacion-20261120`
**Referencia visual, NO rama de despliegue:** `design/nexa-apk-web-basico-pro-20261120`
**Base congelada de main:** `47d79db3f7065e0e54481447129f2f88e9225fe2`

## Decisión estructural
Trabajar en una rama del repositorio actual, no en un mirror/repo nuevo. Mantener `main` y el bot actual intactos. No fusionar motores, registros, ciclos, posiciones o configuraciones de trading. No trabajar en VPS ni modificar bases de datos ni realizar deploy sin autorización específica del usuario. Sin accesos REAL, sin órdenes y sin cambios retroactivos. La rama de diseño ya contiene `design/nexa-apk-web/index.html`, `src/app.js`, `src/style.css`, plantilla y referencias; preservar ese trabajo y usarlo como referencia para el HTML definitivo.

## Fuentes verificadas
- Arquitectura y hallazgos: [AUD-20261120-02](../auditorias/2026-11-20/02-auditoria-integral-motores-config-fuentes-codigo.md).
- Contraauditoría canónica de 22 hallazgos: [AUD-20261120-03](../auditorias/2026-11-20/03-contraauditoria-final-nexa-v2.md); el anexo de 18 hallazgos NO es otra auditoría.
- Backtest Grid de investigación: [AUD-20261120-01](../auditorias/2026-11-20/01-backtest-grid-continuo-adaptativo-hibrido.md).
- Prototipo NEXA: https://drive.google.com/file/d/1TrRGggK2vFxIqqYakOAYmYfNMiecZuWg/view
- Prototipo ORION (iteración más reciente): https://drive.google.com/file/d/1djd4ahCDwbWYecWPwFzcLARKIqkQdp40/view
- Carpeta de investigación y simulaciones históricas (Drive privado): https://drive.google.com/drive/folders/1af2Guko1FXpzbxQ0fYAMiZP2oGAtzNn5

## Principios irrevocables
1. Preservar SPOT/Swing, IDCA institucional, Grid aislado, AMA, cartera global, FISCO/AEAT, operaciones, logs, Telegram y todos los indicadores y datos ya capturados. Los términos «gridStrategy de SPOT», «overlay IDCA» y «Grid aislado» designan sistemas distintos.
2. Básico (también llamado Simple) y Pro son dos **niveles de presentación**, disponibles tanto en web como en APK; NO son dos motores ni dos configuraciones persistidas distintas. Cambiarlos nunca envía POST ni altera el estado del trading.
3. Los modos de **ejecución originales permanecen propios de cada motor**: SPOT dry-run/live, IDCA disabled/simulation/live, Grid OFF/SHADOW/REAL_*, AMA OFF/LAB/REPLAY/SHADOW_*/REAL_*. No exponer controles REAL no implementados ni confundir etiquetas con garantías.
4. No perder información de mercado. Inventariar RSI, MACD, Bollinger, EMA, ATR/ATRP, ADX, volumen, momentum, régimen, bandas, spread/bid/ask, OHLCV, fuentes auxiliares OI/funding, señales, métricas, frescura y timestamps. Mostrar solo campos realmente disponibles; `null` y «No disponible» en vez de ceros inventados.
5. Mantener los ciclos de Grid con obligación `1 BUY → 1 SELL`, misma cantidad, sin vender HOLD ni mezclar rangos; preservar targets y posiciones existentes. No implementar una nueva política de salida sin contraauditoría separada.
6. Sin NAS/QNAP ni pasos heredados de despliegue QNAP.
7. Las pantallas no hacen cálculos de PnL o estrategia de forma paralela al motor canónico. Etiquetar PnL realizado, no realizado y reserva fiscal por separado.
8. El repositorio actual es PÚBLICO. Está prohibido incorporar secretos, archivos `.env`, backups, registros individuales, datos personales, exportaciones fiscales, respuestas API privadas, firmas o CSV con transacciones individuales. Detener ante detección de secretos; no publicarlos ni en incidencias. Drive de trabajo permanecerá privado.

## Fases, entregables y puertas
### F0 — Congelación, seguridad y preservación (prioridad P0)
- Inventariar main y la rama de diseño, HEADs y diffs; revisar AGENTS.md y partes pertinentes de BITACORA.md.
- Revisar con pruebas read-only el riesgo de AMA `executed=true/orderId=null`; autenticación/autorización efectiva de rutas mutables, logs sensibles, venue fail-closed, dryRun y selección de fuente, migraciones/efectos del boot.
- Verificar, no asumir, que las copias de respaldo contienen 31 tablas FISCO/AEAT, velas SPOT, ciclos/targets, cartera y esquemas. El respaldo de noviembre fue **reportado**, no es licencia para borrar o sustituir datos.
- Proponer remediación de posibles secretos en el historial público como trabajo aparte; NO leer ni copiar valores de credenciales a documentos.
- Entregables: matriz riesgos confirmados/condicionales/pendientes, manifest de respaldo privado y checklist reversible. No código operativo.
**Gate:** ninguna fase de lógica REAL antes de cerrar P0 y obtener autorización expresa.

### F1 — Inventario de datos y controles sin pérdida
- Matriz pantalla actual → motor propietario → estado de ejecución → campo/indicador → proveedor → API → DB/config → cálculo canónico → timestamp/frescura → UI → derechos de edición → prueba.
- Catalogar los ≈90 parámetros ya inventariados (verificar número), sliders activos/legacy, defaults y si realmente modifican decisiones.
- Documentar todas las páginas actuales, gráficos, velas, bandas, PnL, operaciones, advertencias y controles. No ocultar por simplificación; jerarquizar.
- Separar datos de mercado Kraken, ejecución Revolut X, servicios auxiliares condicionales y datasets offline Binance de investigación. No mostrar datos offline como si fueran feed LIVE.
**Gate:** 100% de funciones y datos existentes trazados, sin pérdidas silenciosas.

### F2 — HTML definitivo, UX visual web + APK
- Consolidar prototipos NEXA y ORION sin sobrescribirlos: nueva versión de HTML con fuentes legibles y captura de aceptación.
- Web: menús principales **arriba**, no en lateral permanente; selección elegante por modal/emergente, no tabla simple. Mobile: navegación inferior segura y pantallas a ancho completo. Sin scroll horizontal.
- Paleta negros/azules y verde para beneficio, rojo para pérdida. Básico: equilibrio simple, patrimonio, mercado/resumen, posiciones, actividad y estados esenciales. Pro: toda la información de mercado, estrategias, indicadores, ejecución, órdenes, controles técnicos, auditoría y diagnósticos. Ambas presentaciones disponibles en web y APK, con diseño **distinto**, no un mero cambio de color.
- Páginas: Inicio, Mercado, Estrategias (SPOT/IDCA/Grid/AMA), Cartera/Posiciones, Actividad/Monitor/Logs, FISCO/AEAT, Ajustes. Subvistas por motor: grafos de ciclos/entradas/salidas, indicadores, regímenes, bandas, señales y decisiones.
- Selector de motor visual; selector de presentación Básico/Pro; modo de ejecución de cada motor solo en pantalla propietaria con controles protegidos.
- Gráficos SVG/Canvas limpios, ejes y unidades correctos, leyenda, rango temporal, estados stale/offline. Gráficas de precio, patrimonio, PnL realizado y abierto, y ciclos con BUY / SELL objetivo / SELL ejecutada.
- El HTML es PROTOTIPO con datos demo claramente rotulados; no promete acciones reales.
**Gate:** revisión visual real 360×800, 390×844 (Pixel 9), 768×1024, 1280×800, 1920×1080; usabilidad con teclado/tacto, contraste, navegación y comparación de pantallas Básico/Pro.

### F3 — Contratos canónicos read-only y convivencia
- Fachada API/BFF de lectura agregada sin endpoints mutables nuevos: estado y precio/frescura, balances, posiciones/ciclos, PnL, señales/indicadores y registro de decisiones con provenance.
- Reducir duplicación de UI y configuraciones, pero mantener cada motor dueño de su lógica y configuración.
- Cuando falte data, indicar «Sin datos», origen, timestamp y edad; no generar datos de prueba en API real.
- Evaluar presupuesto/locks de cartera global, exposición cruzada y idempotencia antes de nuevas compras; no cambiarlo en esta fase sin gate.
**Gate:** lectura de panel, selección de modo visual, navegación, expansión, filtros y sliders de borrador generan cero POST.

### F4 — Estrategias: análisis causal y validación independiente (solo LAB/SHADOW)
- SPOT agosto 2026 ~+1.029,99 USD / 41 cierres / 51,2%; septiembre ~−1.515,39 USD / 115 cierres / 22,6%. Estos son resultados históricos citados, NO garantía. Separar condiciones de mercado, cambios efectivos de código/config y distribución de entradas.
- Verificar discrepancias SPOT `STRUCTURE_INVALIDATION`, `PULLBACK_CONTINUATION`, timing de trailing, fees/slippage y veto real de régimen/estrés. Estudiar comportamiento rentable bruto que terminó en pérdida sin considerar máximos ex post ejecutables.
- Probar por ventana independiente y venue real con bid/ask/costes: baseline, robustez, drawdown de cartera, reservas, sensibilidad a fees, latencia y maker fills.
- Estudios del 20/11: B exigente con mercado BTC +159,27, B exigente +108,13, D −598,18, E −1.586,27, F −288,60, Grid continuo −166,95, Grid adaptativo −173,05, híbrido −241,88 USDT; enfoques/datasets no necesariamente comparables ni aprobados para REAL.
- Solo tras replicación y holdout, formular hipótesis de clasificación por régimen; sin autoejecución ni cambios retroactivos.
**Gate:** ninguna estrategia promovida a REAL por un backtest.

### F5 — PWA y APK Android
- Paridad web y móvil sobre contratos comunes. Soporte de PIN seguro, sin secretos embebidos, sesión/caducidad, permisos mínimos, detección desconexión y notificaciones respetando privacidad.
- Pruebas en Pixel 9 y QA de accesibilidad, batería/red, rotación, navegación atrás, caché y sincronización.
**Gate:** APK solo firmada y distribuida tras pruebas, sin afirmar «aprobada» sin revisión.

### F6 — QA comparativa y eventual promoción
- Pruebas unitarias, integración, contratos, E2E, snapshots UI, reconexión, auth, fallos proveedor, datos obsoletos, no POST implícitos, posiciones/ciclos históricos, integridad de FISCO/AEAT y reconciliación.
- Validar rama/commit/PR independientemente en GitHub, CI, diff y cobertura. No fusionar o desplegar sin orden expresa.
- Runbook de rollback, versión paralela y paridad de datos. QA de staging solo con autorización.

## Organización del trabajo
`main`: producción/continuidad, NO MODIFICAR.
`design/nexa-apk-web-basico-pro-20261120`: diseño histórico y prototipo, NO sustituir.
`feature/nexa-v2-transformacion-20261120`: trabajo nuevo y commits aislados; PR **draft** solamente tras primera fase. Sin merges automáticos.
`docs/transformacion-nexa-v2/`: plan, orden, matriz, inventarios y QA; ningún secreto ni dato privado.
Drive privado: «NEXA V2 - Transformacion - 2026-11-20». Históricos originales permanecen en sus carpetas; enlazarlos, NO moverlos ni duplicar sin necesidad.

## Siguiente trabajo autorizado
Iniciar F0 + F1 en local y preparar F2 del HTML, sin tocar runtime, motor, DB, configuración ni VPS; entregar matriz inventario, diagnóstico P0, propuesta visual y HTML aislado. Commit/push solo a la rama de trabajo después de tests. No PR merge, no deploy, no REAL.


## ACTUALIZACIÓN DE ALCANCE — 20/11/2026 (prevalece sobre restricciones anteriores)
El usuario autoriza que Cascade **complete F0-F6 en rama local aislada**, sin pausas entre tareas ordinarias. La anterior frase «No iniciar F3/F4/F5/F6» queda expresamente **sustituida** por esta orden. F3 solo lectura, F4 análisis no operativo, F5 prototipo PWA/APK local sin claves ni LIVE, F6 QA local; las puertas de NO VPS/DB/órdenes/REAL/deploy/main/merge permanecen. El artefacto debe cumplir el [checklist bloqueante de conservación total](CHECKLIST_PARIDAD_TOTAL_IDCA_SPOT_GRID_AMA_2026-11-20.md), que se ampliará si el inventario encuentra más campos que los de las capturas IDCA. En Básico, el detalle adicional sigue accesible; Pro exhibe toda la información real y configuraciones efectivas. CERO pérdida de información, trazabilidad o controles. No se puede cerrar sin matriz y pruebas de paridad web/APK x Básico/Pro x 4 motores. Una tarea dependiente de entorno real queda documentada como NO VERIFICADA, no como realizada.
