# INC-019 — BLOQUEANTE: recuperar datos y UX del IDCA original en NEXA Android/Web

**Fecha:** 21/11/2026. **Rama de trabajo:** \`feature/nexa-v2-transformacion-20261120\`. **Versión de referencia:** NEXA 0.5.4 **SIN APROBAR**.

## 1. Evidencia comparativa (capturas del propietario, no API verificada)

**Panel original IDCA:** muestra en una sola pantalla datos reales organizados por prioridad: precio BTC/ETH, confianza y grado de entrada, régimen, ATRP, caída detectada y exigida, rebote, score; y, en histórico, 36 ciclos cerrados, **27 ganadores, 4 perdedores, 3 neutros, 2 insuficientes y PnL agregado −$1.006,67** (captura a las 19:43 del 21/11/2026). Los ciclos están resumidos por color, símbolo, par, ID, modo LIVE/SIM, importe de beneficio/pérdida, porcentaje, capital, duración y motivo. Al abrir aparecen cronología y órdenes con cantidades, fees y motivos.

**APK NEXA 0.5.4:** fichas de operaciones con decenas de propiedades sin jerarquía ni traducción (\`capitalReservedUsd\`, \`totalQuantity\`, \`fail_safe\`), SPOT con 0 posiciones y tabla de «Historial de operaciones SPOT» vacía pese a conexión, IDCA sin paridad visual del original, y FISCO bloqueado por rol separado. **Las capturas no prueban que SPOT tenga posiciones abiertas ni que el valor del screenshot del IDCA siga vigente: comprobar fuente/alcance y fecha.** FISCO sin \`fisco:read\` debe seguir restringido; no es una licencia para eludir permisos.

## 2. Causas concretas verificadas en el código

1. \`provider.spot()\` antes no solicitaba la ruta GET de históricos: solo \`/open-positions\` y \`/positions/smart-exit-diagnostics\`. La tabla vacía NO probaba ausencia de operaciones.
2. \`read-only-server.mjs\` (deny-by-default) no incluía \`/api/trades/closed\`, aunque el backend original contiene \`GET /api/trades/closed\` y devuelve \`{trades,total,limit,offset}\`. **Es un feed global, no necesariamente exclusivo SPOT**. Añadirlo exige permiso de despliegue de la pasarela, no modificar la base de datos ni abrir POST.
3. \`provider.idca()\` no solicitaba \`GET /institutional-dca/entry-diagnostics\`, que el backend expone con \`pairs[pair].currentPrice\`, \`confidenceScore\`, \`confidenceGrade\`, \`marketRegime\`, \`atrPct\`, \`drawdownFromReferencePct\`, \`requiredDistancePct\`, \`decisionClass\`, \`familyScores\`, \`hardBlockers\` y \`trailingBuy\`. Esa omisión vaciaba los indicadores de entrada del front-end. La consulta es calculada por par y puede ser costosa: cachear y no solicitar cada 30 segundos.
4. El inspector abría el bloque técnico por defecto y carecía de una jerarquía visual comparable al historial IDCA original.
5. \`renderEngineSub\` bloqueaba TODAS las subpestañas cuando el motor era \`partial\`, incluso si había resultados verificados. Debe mostrar los datos disponibles con aviso de lectura parcial.

## 3. Cambios IMPLEMENTADOS EN CÓDIGO DE RAMA (no en APK distribuida ni panel desplegado)

- \`web/js/inspector.js\`: ficha con resultado neto y % cuando proceden, colores verde/rojo, modo y estado, importado/manual cuando existe, resumen de capital/precios/fees, traducción de motivos frecuentes, cronología, órdenes enlazadas y bloque técnico original plegado. Los resultados desconocidos nunca se convierten en 0. Valor vendido derivado de órdenes parciales se etiqueta \`órdenes visibles\`.
- \`web/js/screens.js\`: histórico IDCA resumido visualmente con 5 contadores, PnL agregado solo de ciclos con resultado verificable, tarjetas de ciclos con colores e importes, un toque para ficha. Historial global de operaciones con origen/estrategia explícita y paginación: no atribuir implícitamente actividad de GRID/IDCA a SPOT. SPOT sin datos de modo o dryRun no aparece falso «detenido» ni «LIVE».
- \`web/js/provider.js\` + \`web/js/adapters.js\`: GET de historial global y adaptador no destructivo para precio/cantidad/PnL/origen, estados \`ok/partial/forbidden\` y consulta paginada; GET de diagnóstico de entrada por par cacheado durante 180 segundos, con grados/confianza/ATRP/score/desglose de rebote.
- \`web/js/premium.js\`: sección de estado de entrada por par en Básico y Pro, con precio/confianza, régimen, caída requerida vs detectada y barras; Pro añade motivos, score de familias, referencia y estado del rebote. Un diagnóstico es **informativo**, no una instrucción para ejecutar una orden.
- \`web/css/style.css\`: jerarquía, tarjetas compactas, colores semánticos, responsive, soporte táctil, visualización de estado parcial.
- \`web/js/app.js\`: conserva lectura de fuentes verificadas cuando una secundaria está \`partial\`, y mantiene páginas de historial consultadas durante refrescos del dashboard.
- \`bff/read-only-server.mjs\`: añade ÚNICAMENTE lectura autorizada \`GET /api/trades/closed\` (límite 1–100, offset 0–100000, sin otros parámetros) y \`GET /api/institutional-dca/entry-diagnostics\`. Es código pendiente de autorización de despliegue. No modifica firewall, motores, estrategia, base de datos, archivos secretos ni \`main\`.
- \`tests/idca-first-real-data.test.mjs\`: pruebas de regresión SINTÉTICAS, no sustituyen las capturas con datos reales ni QA Android.

## 4. Criterios de aceptación / checklist DE CASCADE

- [ ] Asegurar que se ejecuta \`cd nexa-v2 && npm test\`, sin omitir los nuevos tests ni alterar las pruebas para forzar un OK.
- [ ] Validar con API auténtica vía gateway read-only: las 36 filas de histórico (o número vigente en consulta actual), clasificación por ganadores/perdedores/neutros/sin dato, PnL total, ejemplo #54 beneficio, #53/#52 pérdida y #51 insuficiente; comparar con el IDCA original A LA MISMA HORA y mismo periodo, distinguiendo LIVE/SIM.
- [ ] Cada fila del historial IDCA muestra en la primera vista par, ciclo, modo, motivo, resultado neto, porcentaje (si lo hay), y color, sin abrirla; un toque abre ficha con capital, precio, compras/ventas, comisiones, timeline y órdenes.
- [ ] Cuando no hay PnL verificado, resultado «Insuficiente/sin verificar» y NO 0. Distinguir resultado bruto, neto, reservas, capital utilizado, total vendido y fees.
- [ ] Mercado IDCA en Básico/Pro: BTC+ETH, precio, confianza/grado, régimen, ATRP, caída detectada/exigida, referencia y rebote, según fuente GET \`entry-diagnostics\`. Verificar semántica de signos de drawdown. Mostrar indisponibilidad explícita si no autorizado y no calcular entradas ficticias.
- [ ] Contrastar el endpoint global GET \`trades/closed\` de verdad: controlar \`total\`, páginas, esquema de trade, moneda, Exchange, "strategy" y origen. No atribuir todos los trades a SPOT. Si no hay \`strategy\`, usar «motor no verificado», no inventar.
- [ ] SPOT: si GET de posiciones devuelve 0 es «0 posiciones abiertas según esta consulta»; si la estrategia o historial no responde, distinguirlo del 0 y mostrar \`partial\`.
- [ ] FISCO: mantener separado el permiso \`fisco:read\`; no concederlo automáticamente. No solicitar una nueva vinculación de dispositivo cuando solo falte un permiso.
- [ ] Revisión de seguridad: la ampliación GET del gateway debe requerir sesión read, aplicar límite/paginación, no permitir POST/PUT/PATCH/DELETE y no emitir secretos.
- [ ] Ejecutar pruebas reales desde la app y el navegador del VPS **solo en lectura**; revisar payloads y campos para no perder importes, comisiones, motivos o historial.
- [ ] Emulador + Pixel 9 (cuando disponible): vista vertical 360/393/412dp y horizontal; evitar cortes o texto técnico en primer plano, cabecera y barra inferior correctas; comparar capturas del original y nuevo.
- [ ] Verificar paginación, protección contra duplicados, refresco 30s, coherencia de estados \`ok/partial/forbidden/stale\` y que una acción de lectura nunca escribe en el bot.
- [ ] Producir informe de evidencia y compilación de nueva APK; publicar una prerelease SIN APROBAR solo tras QA. El panel web debe compartir fuente/build, pero **nada de VPS sin autorización expresa**.
- [ ] Mantener sin tocar \`main\`, LIVE, motores, estrategias, órdenes, balances, DB, firewall ni credenciales.

**Estado de la incidencia:** implementación de código en progreso/pendiente de QA de ejecución. No afirmar que las cifras del 21/11/2026 siguen vigentes. Una prueba automatizada con fixtures sintéticos no demuestra paridad con datos LIVE.
