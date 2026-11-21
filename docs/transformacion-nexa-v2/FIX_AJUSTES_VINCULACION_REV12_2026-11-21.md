# NEXA Rev12 — AJUSTES Y VINCULACIÓN SIN BLOQUEO (21/11/2026)

**Problema observado físicamente en Pixel 9 / APK 0.5.0:** la pantalla de vinculación aparece en primer plano, SIN botón Ajustes, y el bottom navigation solo tiene 5 destinos: Inicio, Mercado, Motores, Cartera, Actividad. No se puede configurar el backend antes de intentar vincularse. El `input#pair-code` tenía `maxlength=12`, incompatible con el código de **24 caracteres** que genera la pasarela `read-only-server.mjs` (`randomBytes(12).toString('hex').toUpperCase()`). El texto «Vinculando…» persistía si el backend era inalcanzable y la petición lanzaba excepción o quedaba esperando.

## CORRECCIONES REALIZADAS EN CÓDIGO (NO en la APK 0.5.0 ya publicada)

- `nexa-v2/web/index.html`: junto a los campos de vinculación aparece siempre **Servidor NEXA** y **⚙ Ajustes**; editor desplegable de dirección HTTPS y botón «Guardar servidor». Código temporal acepta copia de 24 caracteres, incluso con separadores.
- `nexa-v2/web/js/config.js`: en Android, nueva instalación sin dirección guardada preconfigura `https://nexa-5-250-184-18.nip.io/api` (URL reportada como activa por Cascade); en navegador web se conserva `/api`; se purgan HTTP heredados y las direcciones requieren HTTPS y ruta exacta `/api`. **No usar** `http://5.250.184.18:3020` ni conectar directamente a API operativa.
- `nexa-v2/web/js/app.js`: añade **Ajustes** al bottom nav (6 entradas, accesibles en Básico y Pro); formulario editable **antes** de vincular; feedback sin revelar secretos; valida código hex de **exactamente 24** caracteres; mensaje para código incompleto; botón deshabilitado durante solicitud; captura errores de red; sesión fallida redirige a pantalla de configuración en vez de dejar la app bloqueada.
- `nexa-v2/web/js/auth.js`: la API de sesión/pareado admite timeout opcional.
- `nexa-v2/web/js/pairing.js`: timeout de 12 segundos para redeem/challenge; si canje falla restaura claves locales anteriores, evitando corromper la identidad válida.
- `nexa-v2/web/css/premium.css`: editor seguro, texto de URL legible y barra de **6 iconos** bien distribuida; modal con desplazamiento en pantallas pequeñas.
- `nexa-v2/web/sw.js`: caché actualizada a `nexa-v2-access-settings-r12`, evita repetir HTML/JS antiguos en PWA.
- `nexa-v2/tests/pairing-access.test.mjs`: 5 pruebas automáticas (UI antes de sesión, longitud del código, navegación, defaults Android/web y rechazo HTTP). No se ha ejecutado todavía `node --test` en checkout completo desde ChatGPT; se hizo comprobación de sintaxis y lógica de configuración V8 con URL simulada.

## PROCEDIMIENTO PARA CASCADE — ¡OBLIGATORIO!

1. No rehacer el UX: partir de la **rama actual** `feature/nexa-v2-transformacion-20261120` y sus últimos commits, conservar la corrección Rev12 y la UI premium Rev11.
2. Ejecutar `cd nexa-v2 && npm test` y reparar cualquier fallo, además de `node --test tests/pairing-access.test.mjs`.
3. Hacer QA visual real en Pixel 9/emulador: (a) PIN → Vincular dispositivo → Ajustes de servidor **sin código**; (b) guardar URL y volver a vincular, (c) menú inferior Ajustes visible en Básico/Pro, (d) copiar código 24 hex íntegro, (e) código incorrecto, caducado, sin Internet o TLS caído produce error legible en ~12 s, NO «Vinculando…» infinito; (f) scroll en modo paisaje y fuentes ampliadas.
4. Correlacionar el flujo completo con un código QA NUEVO no publicado: canje solo uso + challenge firma ECDSA + GET reales de SPOT, IDCA, Grid, AMA y cartera; mantener **SOLO LECTURA**. No imprimir secretos en capturas/logs.
5. Comprobar compatibilidad de firma con APK 0.5.0 y actualización sin desinstalar cuando sea posible. Ejecutar `npx cap sync android`, compilar nueva **APK 0.5.1** (o siguiente versión disponible) con `versionCode` incrementado, tests y QA visual; generar SHA-256 y publicar Release con tag **apuntando al commit EXACTO compilado**, no a `main` (problema recurrente 0.3–0.5).
6. Entregar enlace directo de APK, URL panel web y guía de vinculación. Emite un código NUEVO de emparejamiento de 10 min solo cuando el propietario confirme tener instalada la versión corregida; enviar por canal privado, NO guardarlo en GitHub.
7. No modificar trading, estrategias, órdenes, DB, VPS salvo ajustes del servicio NEXA de lectura expresamente autorizados y necesarios; el riesgo de exposición del puerto 3020 (INC-015) continúa pendiente de autorización separada. No cambiar reglas de firewall sin permiso nuevo.

## Verificación positiva y límites

- Código y documentos subidos a GitHub.
- Sintaxis JS verificada en `app.js`, `auth.js`, `pairing.js` con V8.
- Test de configuración en V8 con URL simulado: valor inicial Android, `/api` web, limpieza del HTTP heredado y rechazo de URL inseguras.
- **No compilado**, instalado ni validado visualmente en Android desde esta sesión: las pantallas con botón nuevo no aparecerán en la 0.5.0 actual hasta que Cascade genere una nueva APK.
