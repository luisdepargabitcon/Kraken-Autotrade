# ORDEN EJECUTABLE PARA DEVIN CASCADE
## NEXA V2 — implementación definitiva de Inicio visual, BTC/ETH, cartera de posiciones y gestión IDCA
**Fecha:** 21/11/2026 · **Rama de trabajo:** \`feature/nexa-v2-transformacion-20261120\`
**Estado:** CÓDIGO SUBIDO / QA CI EN CURSO / APK NUEVA PENDIENTE / VPS SIN AUTORIZAR
**Prioridad:** ejecutar esta orden EN SU TOTALIDAD, siguiendo asimismo PLAN_MAESTRO, INC-018/INC-019, paridad y \`UX_GLOBAL_REV20_CASCADE_2026-11-21.md\`. No entregar prototipos intermedios como producto final.

### Objetivo no negociable
Entregar NEXA como **APK Android instalable** y **panel web equivalente** con gestión, datos verificables y UX clara, estilo producto financiero moderno sin replicar material protegido. La pantalla Inicio debe ser visual, no una tabla de parámetros; toda posición u orden debe tener ficha comprensible al toque. Modo Básico minimalista y Pro exhaustivo, sin perder ningún campo de las interfaces originales.

### Qué se ha subido realmente (partir de este código, NO volver a empezar)
- \`nexa-v2/web/js/dashboard.js\` — nuevas vistas \`renderDashboard\`, \`renderPositions\`, \`renderAsset\`, \`renderCycleManager\`, \`collectPositions\`, minigráficas de velas reales y correlación BTC/ETH por retornos sincronizados.
- \`nexa-v2/web/css/dashboard.css\` — responsive móvil/escritorio, jerarquía visual, tarjetas, navegación y gestión.
- \`nexa-v2/web/js/app.js\` — router y navegación para Inicio, \`positions\`, \`asset\`, \`manage-idca\`; proveedores BTC/ETH consultados en cada lectura y formulario de registro de compra externa con validación.
- \`nexa-v2/web/index.html\` — importa el CSS nuevo.
- \`nexa-v2/web/js/actions.js\` y \`screens.js\` — acciones IDCA reparadas, etiquetas, restricciones para importados/manuales, historial con resultados y motivos.
- \`nexa-v2/web/js/adapters.js\`, \`provider.js\` e \`inspector.js\` — preservación de campos reales, historial global sin adjudicarlo a SPOT, diagnóstico, fichas con datos técnicos desplegables.
- \`nexa-v2/tests/dashboard-global.test.mjs\` y pruebas existentes.
- \`.github/workflows/nexa-v2-feature-qa.yml\`: **CI real de npm ci + node --check + npm test, sin despliegue**.
- Contratos anteriores: \`docs/transformacion-nexa-v2/UX_FICHA_UNIVERSAL_OPERACIONES_2026-11-21.md\` y \`docs/transformacion-nexa-v2/UX_GLOBAL_REV20_CASCADE_2026-11-21.md\`.

### Orden de ejecución, sin saltarse pasos
**Fase A — recoger código y resolver CI.** Abrir la rama mencionada, comprobar SHA actual, lanzar \`cd nexa-v2 && npm ci --legacy-peer-deps && npm test\`, pasar \`node --check\` de los JS y verificar workflow GitHub Actions verde. El primer CI (run #44950575548) detectó 3 regresiones de presentación/semántica en 95 tests: 1) una operación del historial global debe declararse «origen no atribuido»; 2) historial IDCA debe conservar el código \`trailing\`; 3) un ciclo sin PnL debe decir «Resultado sin verificar». Se han subido correcciones posteriores; **no suponer aprobación sin CI verde**. Si hay más fallos, corregir en rama y repetir.

**Fase B — revisión de datos y seguridad.**
- Fuente real de cada cifra: API → adaptador → vista → ficha. Auditar SPOT, IDCA, GRID, AMA, Cartera, Mercado, Actividad y FISCO.
- No llamar «posición abierta» a planes AMA ni capital reservado; GRID requiere compras efectivamente ejecutadas; excluir cerrados. **Prohibido llamar «0» a un dato no leído**.
- La API de \`GET /trades/closed\` es historial GLOBAL. Conservar motor de origen y separar atribuciones. Etiquetar inventarios incompletos y períodos/páginas del histórico.
- Precio BTC/ETH y velas por par: sin falsas cotizaciones; cuando no exista OHLCV indicar «sin velas». Correlación solo para intervalos equivalentes de 15m, retornos logarítmicos, suficientes muestras; indicador histórico, nunca señal de compra.
- Confirmar semántica PnL realizado/no realizado, venta bruta/beneficio neto, comisiones, slippage, estado de cada orden y antigüedad de datos.
- Revisar falsos «LIVE» en estados no verificados y los encabezados que aparenten que el bot está operando sin confirmación.

**Fase C — UX final de app y web.**
- Inicio: cabecera compacta, resumen visual, BTC y ETH accesibles, posición global LIVE/SIM/SHADOW, motores, actividad reciente. Los valores ausentes no deben ocupar paneles gigantes.
- Al pulsar BTC/ETH: precio/velas verificables, bandas Bollinger/RSI/MACD/EMA/ATR/ATRP/volumen, diagnóstico IDCA, correlación, posiciones **de cualquier motor**, operaciones recientes por activo.
- Al pulsar una operación, posición o ciclo: ficha/bottom-sheet profesional con PnL neto y % cuando proceda, monto de orden cuando no exista PnL, motivo, precios, cantidad, capital utilizado, protección, eventos y órdenes vinculadas, campos completos al final. Legibilidad, contraste, foco, Android Back, mantener scroll.
- Selector Básico/Pro real, no solo colores. Básico vista visual y detalle completo accesible; Pro métricas de riesgo, indicadores y trazabilidad.
- Panel desktop con menús superiores; APK con pie fijo de 5 iconos y ajustes discreto en cabecera, respetando safe-area y área útil.

**Fase D — Gestión completa IDCA con verificación de contratos.**
- Revisar estado/ciclos/historial/órdenes y todos los controles originales: pausa/reanudación ciclo, bloqueo, solo salida ciclos importados, TimeStop, cierre manual, eliminación de ciclos manuales, registrar **compra externa ya ejecutada**; controles globales pausa/pares/emergencia.
- \`solo-salida\` exige \`{soloSalida:boolean}\`, \`time-stop\` exige \`{disabled:boolean}\`, manual-buy exige datos reales (par, precio, cantidad, importe, comisión, fecha, exchange). Revisar servidor y tests. Nunca lanzar compra real cuando el flujo dice «registrar».
- La pasarela desplegada actualmente es **READ-ONLY** y debe seguir siéndolo. **NO activar escrituras, ni abrir /3020, ni modificar permisos, proxy o trading sin autorización del propietario.** Preparar solución de gateway de acciones con scopes mínimos, CSRF, idempotencia, doble confirmación, auditoría y modo fail-closed; documentar como BLOQUEADA POR AUTORIZACIÓN la activación real.
- Botones que no sean operativos por permisos/route deben estar claramente deshabilitados o explicar el motivo; nunca devolver confirmación de éxito si hay 403/405.

**Fase E — QA real y empaquetado.**
- Ejecutar toda la batería Node, pruebas de regresión del BFF (403/405 deny-by-default y FISCO aislado), validaciones datos/semántica.
- QA visual y navegación en 360, 393/Pixel 9, 480, 768 y 1920 px; scroll/modal/overlay/contraste, toda la pantalla y sin tarjetas truncadas.
- Compilar Android actualizando código WebView (\`npx cap sync android\`) e instalando herramientas de compilación necesarias si faltan en el entorno LOCAL de build. **No usar el VPS para compilar**. Comprobar APK que contiene exactamente el commit probado, instalación encima sin borrar PIN ni vinculación, y QA en emulador API34. Si el Pixel 9 físico no está accesible, marcar pendiente la prueba física; NO inventar resultados.
- Publicar **GitHub Release prerelease SIN APROBAR** con APK instalable, SHA-256, versión y commit, enlaces directos. La firma debe conservar compatibilidad con el APK anterior o explicar explícitamente la migración.
- Dejar panel web listo para actualizar; **sin autorización no desplegar al VPS**. Indicar URL ya existente como antigua, no como nueva.
- Actualizar INCIDENCIAS, bitácora y checklist; listar pruebas efectuadas, bloqueos, hallazgos, cambios y enlaces verificables.

### Checklist ejecutable que debe usar Cascade (es suyo, no del propietario)
- [ ] Rama y SHA cotejados; main intacta.
- [ ] npm ci, todos los JS \`node --check\`, npm test y GitHub Actions VERDE.
- [ ] Pantalla Inicio realmente visual y responsive en Básico y Pro.
- [ ] BTC/ETH presentan velas/indicadores/correlación reales o ausencia explicada.
- [ ] Posiciones de todos los motores con origen/mode LIVE-SIM claramente identificados.
- [ ] No cuenta reservas AMA como compras ni cierra rangos GRID mezclando SELL anteriores.
- [ ] Historial global no atribuido a SPOT sin respaldo API.
- [ ] Un toque abre detalle completo de compra, venta, cierre, orden, ciclo, alerta.
- [ ] PnL, órdenes, cantidades, capital, fees, motivos y fechas sin pérdida ni falsos ceros.
- [ ] Gestor IDCA y controles globales con contratos/validaciones correctas, separados de lectura.
- [ ] BFF read-only conserva 403/405 para rutas no autorizadas.
- [ ] Sin modificaciones a motores, trading, DB, main, VPS ni secretos.
- [ ] QA Android API34 y multi-viewport; Pixel 9 físico pendiente si no disponible.
- [ ] APK nueva generada, SHA verificado, subida a GitHub Releases como SIN APROBAR.
- [ ] Panel web listo; despliegue SOLO si autorizado.
- [ ] Enlace directo a APK, commit, tests y pendientes en informe final.

### Texto de arranque para ejecutar de forma autónoma
«Cascade: ejecuta COMPLETA esta orden sobre la rama indicada; no empieces desde cero ni dejes pasos autorizados a medias. Corre CI y arregla los defectos, revisa API y paridad, integra UX real en web y APK, compila y publica la nueva APK **SIN APROBAR**, con SHA y enlace. Sigue TU CHECKLIST y aporta evidencias. **No toques VPS, main, DB ni trading**. El despliegue web y el gateway de escrituras quedan bloqueados hasta mi autorización expresa».
