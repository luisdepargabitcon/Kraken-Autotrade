# ORDEN CASCADE — NEXA V2 · ARRANQUE SEGURO F0/F1/F2
**Fecha 2026-11-20** · **Rama destino:** `feature/nexa-v2-transformacion-20261120`

## AUTORIZACIÓN LIMITADA
Se autoriza a Cascade a trabajar en local, documentar, analizar los archivos del repositorio, completar el prototipo HTML de diseño (sin conexión real ni credenciales), ejecutar pruebas locales y crear commits/push exclusivamente en `feature/nexa-v2-transformacion-20261120` cuando estén validados. NO se autoriza VPS, SQL, migraciones, cambios DB, órdenes, REAL, deploy, merges ni modificaciones de `main`.

### 1. Preparación obligatoria
1. Abrir repositorio en `C:\Users\JSLUI\Qsync\BOT_NAS\BOT_AUTOTRADE`. Si la ruta difiere, localizar el checkout correcto antes de actuar.
2. Ejecutar `git remote -v`, `git fetch origin`, `git status --short`, `git branch --show-current`, `git rev-parse origin/main`, `git log -5 --oneline`. No eliminar WIP ajeno. No `reset --hard`, `clean`, `stash`, `rebase`, `push --force` ni `git add -A`.
3. Confirmar HEAD de `main` esperado al iniciar la rama: `47d79db3f7065e0e54481447129f2f88e9225fe2`. Si main avanzó, informar el SHA y razonar compatibilidad; no mezclar sin revisión.
4. Checkout de `feature/nexa-v2-transformacion-20261120`, crear seguimiento remoto si procede. No crear rama duplicada. Leer `AGENTS.md`, secciones relevantes de `BITACORA.md`, `docs/transformacion-nexa-v2/PLAN_MAESTRO_2026-11-20.md`, auditorías AUD-20261120-02 y -03 y documentación de diseño.
5. Confirmar que la rama de diseño `design/nexa-apk-web-basico-pro-20261120` y el HTML ORION en Google Drive existen. Conservar los dos originales intactos.

### 2. Auditoría F0 — bloqueo de seguridad
- Documentar sin exponer secretos las áreas P0: AMA gateway `executed=true/orderId=null`, rutas mutables/auth, API log sensible, venue fallback Kraken/Revolut X, dryRun/simulation, arranque con migraciones/reconciliaciones, velas stale, reserva de capital.
- Revisar que los respaldos previos con las 31 tablas FISCO/AEAT, velas y operaciones EXISTAN, sin leer registros privados ni manipular backups para esta tarea. Si no se puede verificar, anotar NO VERIFICADO, sin borrarlos.
- El repositorio es público y contiene ficheros de entorno. No abrir, imprimir, citar ni copiar posibles valores secretos. Proponer reparación por auditoría de seguridad independiente, no improvisar.
- Cualquier necesidad de tocar infraestructura, runtime, contabilidad, API privada, DB o datos reales: detener esa subacción y registrar el bloqueo de autorización. Resto de tareas de diseño pueden continuar.

### 3. Inventario F1 — ningún dato perdido
- Crear matriz consultable de los cuatro motores: SPOT, IDCA, Grid aislado y AMA. Separar estrategias SPOT grid clásico e IDCA Grid overlay del Grid aislado.
- Inventariar **todas** las pantallas, indicadores, balances, bandas, RSI, MACD, EMAs, ATR, ADX, Bollinger, señales, régimen, volumen, velas, OI/funding condicional, spread, bid/ask, costes, PnL, órdenes, ciclos, estrategias, cartera, AEAT, Telegram, logs/monitor, y controles existentes.
- Para cada campo: nombre actual, componente, API, servicio/DB, fuente, timestamp/latencia, parámetro configurado/efectivo, lectura/escritura, modo de ejecución propietario, presencia en Básico/Pro y caso de prueba.
- Nunca confundir datos de investigación Binance/USDT con feed operativo Kraken/USD ni inventar indicadores faltantes.
- Mantener información íntegra en Pro; Básico solo filtra su presentación, no su adquisición/almacenamiento.

### 4. HTML F2 — completar el diseño antes de implementar motores
- Usar como fuentes de diseño `design/nexa-apk-web/` de la rama de referencia y «ORION_Prototipo_APK_Web.html» de Drive. Trabajar en ruta nueva dentro de la rama de transformación o copiar selectivamente los fuentes de diseño; NO modificar sus originales.
- Eliminar barra lateral permanente en desktop: navegación superior limpia con secciones claras. En móvil, navegación inferior. Selector de estrategias/motores mediante modal profesional; NO una tabla plana.
- Básico (Simple) debe mostrar una composición realmente minimalista: patrimonio, resultado, precio/estado mercado, posiciones/ciclos, actividad y avisos importantes. Pro debe mostrar visualmente una arquitectura más densa: estudios de mercado (RSI/Bollinger/etc.), gráficos, señales, ajustes, logs, análisis y auditoría. No basta cambiar colores de una lista.
- Ambos niveles disponibles en web y APK; colores negro/azul; verde PnL positivo y rojo negativo. Seleccionar el nivel visual jamás debe llamar POST.
- Mercado completo: gráficos de precio y patrimonio, régimen y bandas, OHLCV, RSI, indicadores y su fuente/frescura; descripciones entendibles y detalles técnicos expandibles. Estado stale/offline claro. Sin cifras ficticias presentadas como reales.
- Grid: nueva vista móvil desde cero; BUY, SELL objetivo, SELL ejecutada y avance, rango de nuevas compras separado de rangos anteriores con ventas pendientes. Nunca revender HOLD ni alterar targets.
- Pantallas incluidas: Inicio, Mercado, Motores/Estrategias, Cartera, Actividad/Monitor/Logs, Fiscal/AEAT, Ajustes. Selector de motor bonito en modal, no panel cuadriculado. Los controles de ejecución REAL solo aparecen cuando exista soporte/gate real, sin habilitarlos.
- Mostrar DEMO en todo dato ficticio de maqueta. Los botones que no tengan implementación deben avisarlo y no fingir acciones.
- No añadir referencias a NAS/QNAP en navegación o despliegue.

### 5. Validación y salida
- Antes de tocar código: registrar inventario de archivos/diff y evidencias de partida.
- Tests locales: `npm run check`, tests relevantes, `npm run build`; justificar scripts no disponibles. Validación de HTML en 360×800, 390×844, 768×1024, 1280×800 y 1920×1080. Sin scroll horizontal, botones accesibles, modales cerrables, coherencia básica/pro.
- Auditar Network local: navegación, cambio de nivel, apertura de modal y tarjetas = **cero POST**; ningún exchange privado invocado.
- `git diff --check`, secret scan de rutas cambiadas, y revisión completa de la lista de ficheros; `git add` por rutas exactas; crear commits de documentación y diseño únicamente en `feature/nexa-v2-transformacion-20261120`; push a `origin/feature/nexa-v2-transformacion-20261120`.
- NO abrir PR a main automáticamente salvo draft explícitamente etiquetado SIN MERGE, y sin pipelines de deploy por push; antes de push comprobar que no hay workflows que desplieguen ramas feature. Si existe tal riesgo, NO push y reportar.
- Entregar SHA completo verificable, lista de archivos, estado tests, ruta/HTML final, links Google Drive/GitHub si existen, matriz de datos, incidencias, pendientes y propuesta de siguiente fase.
- Veredicto: «F0/F1 DOCUMENTADOS Y HTML DISEÑADO — PENDIENTE APROBACIÓN FUNCIONAL» o «PARCIAL — DETALLAR PENDIENTES». Nunca decir desplegado o REAL habilitado.

**NO iniciar F3/F4/F5/F6 ni modificar algoritmos de estrategias tras esta orden.**
