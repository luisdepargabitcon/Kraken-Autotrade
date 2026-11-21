# NEXA V2 — PLAN MAESTRO DEFINITIVO, WEB + APK
**Revisión 9 · 21-11-2026 · Sustituye íntegramente el plan acumulativo anterior**
**Repositorio:** https://github.com/luisdepargabitcon/Kraken-Autotrade
**Rama única:** `feature/nexa-v2-transformacion-20261120`
**Main congelado (base de partida):** `47d79db3f7065e0e54481447129f2f88e9225fe2`
**Orden ejecutiva:** [Orden Cascade](ORDEN_CASCADE_F0_F1_F2_2026-11-20.md).
**Checklist de agente:** [Paridad y aceptación](CHECKLIST_PARIDAD_TOTAL_IDCA_SPOT_GRID_AMA_2026-11-20.md).
**Issue de seguimiento:** https://github.com/luisdepargabitcon/Kraken-Autotrade/issues/17

## 1. DECISIÓN DEL PROPIETARIO (PREVALECE SOBRE REV. 1–6)
**Desarrollar exclusivamente el producto definitivo desde el primer commit.** No crear una serie de «maquetas / demo → preview / pre-release → volver a programar panel real». Construir **una única aplicación NEXA V2 real** con dos clientes: **panel web administrativo y APK Android**, idénticos en datos y funciones, con UX propia para escritorio/móvil y dos niveles Básico/Pro.

Las fases F0-F6 siguen siendo **paquetes internos de trabajo y pruebas**, no productos intermedios a entregar. Los tests unitarios pueden usar fixtures y backend de prueba local, siempre aislados del producto runtime y sin hacer que la interfaz definitiva arranque mostrando datos ficticios. El estado de ejecución real solo se activa después de integrar, auditar, autorizar y validar el entorno de producción. La falta de permiso para despliegue **no justifica seguir implementando una segunda demo**.

### Entregable final
- **Web**: consola administrativa autenticada, datos reales del bot, gráficos, configuraciones, monitor, operaciones y logs; URL HTTPS en hosting privado/protegido cuando se autorice su publicación.
- **Android**: APK instalable de esa misma versión, autenticada y conectable al backend seguro, distribuida como asset descargable de GitHub Releases tras validación, con SHA-256, versión, procedencia y enlace real.
- **Código común**: contratos, modelos, decisiones de render y permisos compartidos; no dos bots ni dos fuentes de verdad.
- **Auditoría y calidad**: matriz 100 % de datos y controles originales con pruebas por campo/estado, checklist cumplimentado por Cascade y evidencia en `seguimiento/`.

## 2. ARQUITECTURA: REUTILIZAR MOTORES, NO REESCRIBIR TRADING
SPOT/Swing, IDCA institucional, **Grid aislado** y AMA siguen siendo los motores dueños de su algoritmo y configuración; la `gridStrategy` de SPOT y el overlay Hybrid/Grid de IDCA son distintos del Grid aislado. NEXA V2 reemplaza **capas de interacción**, no la lógica de ejecución ni las bases históricas.
- **Backend canónico y BFF/API segura:** contrato formal de datos por motor, estados y eventos, lectura de configuración efectiva y operaciones autorizadas; permisos y auditoría por ruta. Trazabilidad de proveedor y latencia para cada valor.
- **Un solo modelo de dominio tipado:** cartera, posiciones/ciclos, órdenes, fills, fees/slippage, PnL bruto/neto, realized/unrealized, riesgo, exposición y reservas diferenciadas por dueño/venue/moneda; fuente y tiempo, stale/offline, errores.
- **Clientes web y Android:** consumen BFF API por HTTPS, nunca almacenan claves de Kraken/Revolut X en cliente; gestionan sesión, roles y autorizaciones. Pantalla no recalcula la contabilidad del motor.
- **Política de seguridad:** PIN local puede complementar sesión, pero **no sustituye autenticación del servidor**; prohibido PIN fijo `2468` o clave/secretos en el bundle. Separar lectura, configuración y acciones de ejecución, con confirmaciones, audit-log, límites, CSRF/CORS/HTTPS y verificación de permiso.
- **No GitHub Pages para consola real:** sirve recursos públicos, incompatible con publicar un panel administrativo privado como si fuera acceso seguro. No generar una URL «demo» como entregable; URL definitiva solo tras aprobación de infraestructura.

## 3. CERO PÉRDIDA DE INFORMACIÓN (REQUISITO BLOQUEANTE)
Comparar **todas** las pantallas/datos/códigos con el bot anterior (capturas IDCA como patrón de profundidad) y certificar 100 % de origen→destino:

### IDCA
- Global/par: activado, disabled/simulation/live, pausa/emergencia, tick, latencia, origen/frescura, BTC/USD y ETH/USD, estado de cada par, precio, score/confianza y desglose, rango/régimen, ATR/volatilidad, dinámica inteligente, % caída, rebote requerido, filtros y motivos.
- Resumen económico: capital asignado/usado/libre, PnL por tipo, ciclos, compras/ventas de hoy, trailing, Smart Mode, anclas y referencias (viva/de ciclo/VWAP/híbrida).
- Ciclos: ID, fechas y duración, número de compras, TP y dip, precio actual y medio, cantidad, valor y capital, base y ancla, siguiente entrada, PnL USD/%/neto, drawdown, BE, trailing, time-stop, reglas y progreso, desglose de TP.
- Órdenes: ID, fecha/hora, lado/tipo, precio, volumen, valor, fee, slippage, motivo, totales, histórico, win/loss/neutral, cierre y exportes; acciones pausar/cerrar/programar salida/compra manual/eliminar con autorizaciones reales.
### SPOT/Swing
Estrategias y modos de ejecución, señales, confianza/score, contextos y vetos, RSI/EMA/MACD/Bollinger/ADX/ATR/volumen, órdenes, exposición, precio/coste/valor, TP/SL/BE/trailing/time-stop, protecciones y decisiones, PnL neto histórico y efectivo, logs y ajustes.
### Grid aislado
OFF/SHADOW/REAL*, maker/post-only, capital/locks, centro, spacing, niveles, rangos pasados/nuevos, BUY planificada y ejecutada, SELL target/pendiente/ejecutada, **1 BUY → 1 SELL de misma cantidad**, fees, PnL, históricos y estado. **No mezclar HOLD ni alterar posiciones/targets antiguos.**
### AMA
Mandatos, modos OFF/LAB/REPLAY/SHADOW*/REAL*, macro, señales, fuentes, scheduler/readiness, killswitch, budget/reserved/free, riesgo/HWM, órdenes y trace. **Reserved ≠ submitted ≠ executed ≠ filled**. Nunca habilitar REAL con gateway placeholder.
### Transversales
Mercado: OHLCV, RSI, MACD, EMAs, bandas, ATR/ATRP, ADX, momentum, régimen, spread bid/ask, volumen, fuentes y frescura. Fuentes externas OI/funding/etc solo si operan y están autorizadas; no inventarlas.
Cartera: por exchange/activo/motor, HOLD, NAV, PnL realizado/no realizado, exposición, reservas y fiscalidad separadas.
FISCO/AEAT: 31 tablas históricas protegidas (verificación de backup pendiente de autorización), lotes, operaciones/reportes/exportes con autorización, sin datos fiscales en repo.
Monitor/Actividad/Ajustes: logs, alertas, errores, cambios, Telegram, timestamps, sliders y configuración almacenada vs efectiva, controles de emergencia y confirmaciones.

**Visual:** En web navegación superior, en móvil inferior; modales agradables; Básico reduce densidad pero siempre permite abrir detalles; Pro cubre todos los campos. Gráficos con unidades/escala/periodo/fuentes; negro/azul, PnL verde/rojo. Sin botones vacíos.

## 4. PLAN DE EJECUCIÓN ÚNICO — ETAPAS INTERNAS
### F0 — Preservar, aislar, resolver riesgos de acceso
Auditoría de repositorio, SHA/diffs y WIP; leer `AGENTS.md`, BITACORA y auditorías. No operar ni acceder VPS. P0 estáticos: AMA `executed=true` con `orderId=null`, `dryRunMode` duplicado, ConfigService update sin evento efectivo, venue Kraken fallback, velas stale, reservas entre motores, autenticación de mutaciones, logs sensibles, secretos y copias FISCO. Clasificar confirmado/no verificado/bloqueado, sin fingir runtime auditado. Gate: no conectar ninguna operación REAL si P0 sin resolver.
### F1 — Inventario fino y trazabilidad
Matriz de cada pantalla/acción/campo: motor, fuente, ruta API, servicio, DB/config, tipo/unidades, permiso, timestamp, destino Básico/Pro web/APK, prueba y evidencia. Inventariar ~90 parámetros a verificar, estrategias, modos, históricos y operaciones. Corregir mapeos no verificados y evidencias mal asociadas a C041–C051. Gate: 100 % de datos originales con destinos confirmados o N/A motivado.
### F2 — UX final reutilizable, no maqueta
Evolucionar `nexa-v2/web/` como código de producto; sustituir dependencia del DEMO por modelo canónico y estados reales; mantener un diseño completo e intuitivo. Corregir INC-010 de safe areas. PWA configurada para URL segura. No añadir un prototipo paralelo ni publicar Pages de ejemplo.
### F3 — Integración funcional y autorizaciones
Adaptadores reales de contrato GET, validación de payload, errores por sección, reconexión y frescura, configuración efectiva y flujos de acciones seguras con permisos server-side e idempotencia. Inventariar rutas existentes y añadir implementación faltante **en rama aislada**, sin poner en marcha servicios con efectos en producción. Usar API local de test/fixtures solo para verificar integración, no para el producto que recibe el usuario. Gate: no botones placebo, no auth meramente de PIN, no confundir datos y estados demo con reales.
### F4 — Investigación de estrategia sin cambiar trading
Analizar por separado SPOT agosto 2026 (+1.029,99 USD/41 cierres/51,2 %) y septiembre (−1.515,39 USD/115/22,6 %): condiciones de mercado frente a parámetros/código. Estudios offline del 20/11 no son evidencia de rentabilidad en LIVE: B +159,27; B +108,13; D −598,18; E −1.586,27; F −288,60; Grid continuo −166,95; adaptativo −173,05; híbrido −241,88 (datasets/contextos no necesariamente comparables). Sin cambio de estrategia REAL sin aprobación separada.
### F5 — Web y APK definitivas, una sola versión
Instalar toolchain Android necesario cuando falte, preservar entorno, sincronizar assets, compilar APK reproducible, test de arranque/seguridad/back/rotación en emulador y Pixel 9 si disponible; preparar versión firmada y distribuir por GitHub Release **solo cuando sea producto validado**, con checksum y enlace directo. Empaquetar web lista para servidor HTTPS protegido, configuración sin secretos cliente. No release DEMO ni Pages público de consola admin. Si la conexión real necesita permisos, entregar producto listo y documentar gate sin declararlo validado en VPS.
### F6 — QA de aceptación definitiva
Tests unidad, integración, contrato, autorización, E2E, offline, grandes historiales, múltiples ciclos/órdenes, fallos de proveedor, validación responsiva a 360/390/480/768/1280/1920, PIN/sesión, accesibilidad y paridad web/APK/Básico/Pro. `npm run check`, tests, build, SHA, CI/diff; no marcar «OK» con solo 17 tests de fixtures ni asignar evidencias a ID equivocado. Actualizar checklist que administra **Cascade**, nunca el usuario. Quedan explícitamente BLOQUEADAS las pruebas que necesitan VPS/servicio operativo sin permiso.

## 5. PREPARACIÓN DE LA CONEXIÓN FINAL (SIN EJECUTAR AÚN)
Una vez desarrolladas web+APK definitivas, Cascade entrega runbook de conexión y puesta en servicio de alcance mínimo, autenticación, CORS/HTTPS, backup/reversión, migración sin tocar motores, controles antifraude, QA real de lectura y acciones, y la URL administrativa que se dará **después de la autorización**. No sugerir que el usuario ya tiene panel gestionando capital si solo existe código local. No habilitar trading REAL por entregar interfaces. No unir ramas ni cambiar VPS sin consentimiento.
**Estado correcto si falta permiso:** IMPLEMENTACIÓN DEFINITIVA LOCAL PREPARADA — INTEGRACIÓN/DEPLOY REAL PENDIENTE DE AUTORIZACIÓN. Este es un bloqueo de ejecución externa, no un producto DEMO ni un motivo para crear otro front-end.

## 6. ORGANIZACIÓN, EVIDENCIA Y ENTREGABLES
- `main` intacto. Rama de referencia `design/nexa-apk-web-basico-pro-20261120` intacta. Trabajo nuevo solo en `feature/nexa-v2-transformacion-20261120`.
- Preservar proyectos previos, no borrar WIP, sin `reset --hard`, `clean`, `stash`, `rebase`, `push --force`, ni `git add -A`.
- Seguir `docs/transformacion-nexa-v2/seguimiento/{ESTADO_FASES.md,MATRIZ_PARIDAD.csv,EVIDENCIAS_CHECKLIST.md,INCIDENCIAS.md}`. Cascade marca C001–C112+ individualmente con prueba. Ampliar si aparecen datos/acciones no inventariados.
- Entregables: código completo web+APK de una versión, contratos, adaptadores, flujos autenticados, pruebas y evidencias, paquete web preparado para hosting seguro, APK compilada y enlace GitHub Release cuando aprobada, SHA y guía de instalación, pendientes reales de autorización para conectar a producción. **No fases intermedias publicadas, demos ni pre-releases solo para completar enlaces.**
- Repositorio es público. Nunca subir `.env`, secretos, CSV fiscales, backups, datos personales ni transacciones individuales. Drive privado solo para evidencias sensibles.
- VPS, DB operativa, órdenes reales, deployments, configuración LIVE y merge a main **EXPRESAMENTE NO AUTORIZADOS** por esta orden. Si precisa permisos de administrador para toolchain o servicios externos, solicitar autorización solo para esa acción, continuar lo demás.


## PRIORIDAD REV. 8 — UX TRADING PREMIUM Y ACCESO PASSWORDLESS
Leer y ejecutar íntegramente [REDISENO_UX_REV8_PIN_BIOMETRIA_SIN_PASSWORD.md](REDISENO_UX_REV8_PIN_BIOMETRIA_SIN_PASSWORD.md). El usuario rechaza el diseño actual y los campos Usuario/Contraseña. Sustituir la UX móvil por navegación y visualizaciones premium con jerarquía de datos, smart cards, gráficos y pantallas completas, preservando cada indicador. Eliminar solape físico con Android status bar y exceso de `No disponible`.

**Acceso producto final:** PIN personal + BiometricPrompt nativo (huella/rostro soportados) y vinculación inicial del dispositivo con QR/código de un solo uso y credencial asimétrica; WebAuthn/passkeys para web. No pedir nombre de usuario ni contraseña. Desbloqueo de vista NO equivale a autenticación del bot: mantener seguridad servidor, permisos, sesiones, revocación y step-up para acciones críticas. Reemplazar el BFF provisional user/password por backend de emparejamiento/challenge seguro; primero implementar y probar todo en local, sin tocar VPS. No empaquetar secretos de firma: versiones anteriores contienen contraseña de firma expuesta, rotar/tratar con seguridad.

Cascade deberá completar checks C087–C102 además de C001–C086, realizar QA visual de Pixel 9, compilar APK corregida y subir a GitHub Release únicamente cuando la nueva versión supere todas las comprobaciones. No declarar biometric funcionando hasta probarlo realmente. No conectar VPS ni LIVE sin permiso.

## REV. 9 — REDISEÑO ESTRUCTURAL, NO UN NUEVO TEMA
Se incorpora `nexa-v2/web/js/experience.js` como nueva capa de experiencia mobile-first para Inicio, Mercado, Motores y Cartera. La presentación anterior queda accesible como detalle (sin borrar campos). Los cambios se acompañan de tests `nexa-v2/tests/experience.test.mjs`. Estos cambios son **código de rama**, aún sin compilación Android ni certificación visual.

El criterio de aceptación no es que los estilos sean diferentes, sino que **Básico y Pro organicen el trabajo de forma distinta**, con protagonistas claros (patrimonio/posiciones/ciclos/gráficas) y 0 duplicación interminable de «No disponible» sin sesión. Cascade completará la UX en todos los módulos, hará pruebas con el estado real de conexión y fixtures sólo dentro de QA, guardará capturas verificables de Pixel 9/web y subirá APK únicamente tras build y revisión. La 0.3.0 queda SIN APROBAR. Checklist a C001–C112.
