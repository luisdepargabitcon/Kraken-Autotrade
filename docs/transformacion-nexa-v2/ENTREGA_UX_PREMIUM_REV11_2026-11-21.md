# NEXA V2 — UX PREMIUM: IMPLEMENTACIÓN DE CÓDIGO REV. 11

**Fecha:** 21/11/2026 · **Estado:** CÓDIGO SUBIDO, PENDIENTE DE BUILD ANDROID Y QA VISUAL.  
**Rama exclusiva:** `feature/nexa-v2-transformacion-20261120`. **No es una APK nueva publicada.**

## Qué he IMPLEMENTADO realmente en el código

En lugar de cambiar colores o recolocar las mismas tarjetas, ahora NEXA usa **dos árboles de interfaz distintos**:

- **Básico — cartera primero:** inicio con patrimonio y PnL, cuatro motores en lista visual, estado de vinculación, accesos rápidos, mercado con precio y gráfica de velas protagonista, cartera simplificada. La ficha del motor es específica para IDCA, SPOT, Grid o AMA.
- **Pro — terminal de gestión:** inicio en cuadrícula de mercado, riesgo, motores, eventos y herramientas; Mercado con OHLCV interactivo, BID/ASK, indicadores técnicos agrupados; motores con paneles especializados (IDCA: ciclos, anclas, TP; SPOT: señales y posiciones; GRID: mapa de niveles BUY/SELL; AMA: presupuesto, readiness y mandato); cartera por activo y motor; monitor de actividad, FISCO protegido y Ajustes de conexión/seguridad.
- **Gráficos nuevos:** `premium-chart.js` dibuja exclusivamente series OHLCV entregadas por el proveedor. Incluye volumen cuando existe, escala, niveles verificados, title/ARIA y tooltip mediante toque o teclado. No inventa precios, velas ni indicadores.
- **Datos no disponibles:** un estado contextual para vincular/recargar, **no** 20 filas «No disponible» ni insinuar que LIVE está activo/que el motor se ha detenido/que existen 0 ciclos si no hay respuesta.
- **Paridad:** renderizadores y subpestañas originales siguen disponibles en vistas completas/de auditoría con sus botones y desgloses. El nuevo diseño usa el read-model existente; no cambia los motores ni órdenes.

## Archivos de código modificados

- `nexa-v2/web/js/premium.js`: composición Básico/Pro y pantallas por motor.
- `nexa-v2/web/js/premium-chart.js`: SVG OHLCV táctil.
- `nexa-v2/web/css/premium.css`: sistema visual, tipografía, retícula, safe-area, chart y terminal adaptables.
- `nexa-v2/web/js/screens.js`: integración en renderizadores públicos; Activity con estructura de datos corregida.
- `nexa-v2/web/js/app.js`: cambio de par recarga la fuente, inspección de velas, navegación y acciones existentes.
- `nexa-v2/web/index.html`: importa premium.css.
- `nexa-v2/web/sw.js`: caché nueva para CSS y JS rev11; excluye API y autenticación, y elimina respuesta HTML ante fallo de API.
- `nexa-v2/web/manifest.webmanifest` y `nexa-v2/package.json`: descripción de producto corregida.
- `nexa-v2/tests/premium.test.mjs` (11 tests añadidos), `nexa-v2/tests/experience.test.mjs` (smoke adaptado).

## Verificación REALIZADA en esta entrega

- Sintaxis JavaScript de `premium.js`, `premium-chart.js`, `screens.js` y `app.js` evaluada sin errores de parser en V8 con imports simulados.
- **40 escenarios de render** de Básico/Pro, conexión ausente/presente, todos los motores y pantallas comunes ejecutados con datos aislados; 0 errores en esas pruebas de render.
- Chart SVG renderizado con datos OHLCV sintéticos de test, con tooltip y volumen; datos insuficientes → sin gráfico falso.
- Fuente y commits recuperados en GitHub tras escritura.

## AÚN NO COMPROBADO — NO DECLARAR IMPLEMENTACIÓN VALIDADA EN ANDROID

- Los tests Node del repositorio `npm test` **no se han ejecutado en un checkout local aquí**. Cascade debe correrlos (incluidos los 11 nuevos), corregir regresiones y documentar resultados.
- No se ha hecho `npx cap sync android`, compilación de APK ni instalación de esta revisión. Las APK 0.2.0 y 0.3.0 anteriores **no contienen** estos cambios.
- No se ha verificado la imagen visual resultante con captura real Pixel 9 ni en navegadores 360/390/412/480/768/1280/1920. Cascade debe hacerlo antes de publicar Release nueva.
- Fuente LIVE y backend real **no verificados**; no hay permisos para conectar al VPS/trading. En el estado actual seguirán apareciendo mensajes de vinculación, no cifras reales.
- Los contratos del proveedor siguen teniendo campos incompletos para fuentes de señales, contextos por par, FISCO y ajustes. No suplir esos huecos inventando valores ni declarar paridad completa solo por renderizar.

## Instrucción ejecutiva a Cascade

1. **Continuar sobre este código exacto**, no reescribir otra maqueta ni volver a las tablas anteriores.
2. Ejecutar `npm test`, probar estados conectados/sin conexión (fixtures solo dentro de tests), comprobar que `premium.test.mjs` pasa, añadir E2E y reparar incompatibilidades.
3. Completar la revisión visual comparada con APK 0.3.0 y con la especificación [Rev10](REFERENCIAS_UX_REV10_REVOLUT_KRAKEN_COINBASE.md). No aprobar un Pro que vuelva a ser la misma pantalla Básico.
4. Verificar cada control del checklist C001–C121 y conservar todos los datos/históricos/acciones originales, especialmente IDCA y Grid.
5. Ejecutar sincronización web→Capacitor, compilar APK instalable, instalar y probar con Pixel 9/emulador; generar SHA-256 y subir como nueva Release de GitHub **solo tras QA**. Dejar como SIN APROBAR hasta evaluación del propietario.
6. **Prohibido:** SSH/VPS, cambios DB reales, LIVE, órdenes reales, deploy, merge o modificación de main sin autorización.
