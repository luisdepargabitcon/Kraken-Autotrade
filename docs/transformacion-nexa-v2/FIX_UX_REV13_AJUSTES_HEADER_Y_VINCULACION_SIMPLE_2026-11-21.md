# NEXA — REV13 · AJUSTES EN CABECERA Y VINCULACIÓN SIMPLE

**21/11/2026 · Rama:** `feature/nexa-v2-transformacion-20261120`  
**Estado:** código corregido en GitHub; **pendiente de compilar APK y verificar físicamente**.  
**Motivo:** el propietario mostró que la pantalla de vinculación anterior seguía siendo excesiva y solicitó un engranaje de Ajustes **discreto, fijo en cabecera o pie**.

## Decisión de UX vinculante

- **Engranaje pequeño y siempre visible en la cabecera**, en Básico y Pro, sin desplazar la barra inferior. Los **cinco destinos principales** del pie son Inicio, Mercado, Motores, Cartera y Actividad. Ajustes NO debe volver a ser una sexta pestaña inferior.
- El selector de motor permanece disponible mediante botón compacto con aria-label actualizado para evitar sobrecargar el Pixel 9/360dp.
- **Vincular dispositivo** se convierte en **Conectar mi bot**: una sola entrada visible de código temporal de 24 caracteres, botón **Pegar**, botón **Conectar**, salida **Ahora no**. El nombre del móvil se asigna automáticamente.
- El servidor HTTPS de NEXA está **preconfigurado** en Android. El usuario NO debe teclear IP, puerto ni URL para realizar la vinculación normal.
- La dirección del servidor solo se muestra al tocar el engranaje pequeño dentro del propio diálogo o en Ajustes → Servidor. No se introduce la API antigua por HTTP.
- Errores HTTP comprensibles: 403 → «El código no es válido o ha caducado. Pide uno nuevo a Cascade». 429 → límite de intentos; offline/TLS → revisar servidor; sin mensajes crudos `pair_code_invalid_or_expired`.
- En Ajustes, sustituir tres tarjetas verticales grandes por **lista compacta**: estado de vinculación, servidor, vincular, PIN/biometría, actualizar y cerrar sesión (cuando proceda).

## Código ya escrito

1. `nexa-v2/web/index.html`: engranaje de cabecera `#settings-shortcut`, diálogo único de vinculación con engranaje avanzado y botón pegar.
2. `nexa-v2/web/js/app.js`: cinco destinos inferiores, selección de Ajustes desde cualquier pantalla, botón Pegar con validación HEX 24, texto de error simple, acceso a configuración opcional, etiqueta de accesibilidad para botón motor.
3. `nexa-v2/web/js/premium.js`: Ajustes en lista compacta, sin tarjetas grandes.
4. `nexa-v2/web/css/premium.css`: diseño de cabecera, iconografía sutil, diálogo compacto, responsividad estrecha 360–412dp.
5. `nexa-v2/web/sw.js`: caché PWA invalidada como `nexa-v2-simple-pair-r13`.
6. `nexa-v2/tests/pairing-access.test.mjs`: **8 pruebas de regresión** del flujo y de la navegación.

## Verificado en esta sesión

- 8/8 pruebas de `pairing-access.test.mjs` ejecutadas con un arnés aislado de V8 y fuentes reales de GitHub (ficheros y API URL simulados): **sin errores**.
- Sintaxis JS del shell y compositor premium contrastada durante la edición.
- Código presente y confirmado en la rama.
- La barra inferior tiene cinco entradas, el botón Ajustes tiene `data-nav="settings"` y el diálogo tiene un solo campo de entrada visible, con `maxlength>=24`.

**No equivale a `npm test` real, instalación en Pixel 9 ni prueba visual.** Esta revisión NO está dentro de la APK 0.5.0 y no se ha generado otra APK desde ChatGPT.

## Checklist de Cascade — ejecutar, no presentar como completado antes de validar

- [ ] `git fetch` y partir de la cabecera final de la rama; no sobrescribir Rev13 con estilos de Rev12.
- [ ] Ejecutar `cd nexa-v2 && npm test`; correr especialmente `node --test tests/pairing-access.test.mjs`. Corregir cualquier fallo con pruebas de regresión.
- [ ] Verificar **Básico y Pro** en 360/393/412dp y modo horizontal: botón engranaje siempre visible y sin colisiones con selector de motor, Bloquear y Básico/Pro.
- [ ] Abrir Ajustes desde cabecera antes y después de vincular. Confirmar cinco pestañas inferiores y que cualquier vista permite abrir Ajustes.
- [ ] Ver diálogo **Conectar mi bot**: un código y botón Pegar, nombre oculto, URL oculta inicialmente. Engranaje del diálogo despliega servidor HTTPS correctamente.
- [ ] Pegar código de 24 caracteres; validar entrada manual, con espacios o guiones, texto no válido, 403/caducado, 429/rate limit, ausencia de Internet y timeout; nunca «Vinculando…» permanente.
- [ ] Solicitar por entorno seguro código NUEVO de vinculación **solo cuando el propietario tenga instalada la APK nueva**. No publicar códigos en issues, logs, capturas ni chats compartidos.
- [ ] Verificar con código de QA end-to-end contra gateway **solo lectura**: dispositivo P-256, sesión y GET de SPOT, IDCA, GRID, AMA, mercado, cartera e históricos. Confirmar que no se envía ninguna operación real.
- [ ] Actualizar Capacitor `npx cap sync android`, compilar APK **0.5.1 o la siguiente versión libre** incrementando `versionCode`, instalar sobre la anterior si la firma lo permite, probar y generar SHA-256.
- [ ] Subir APK a GitHub Releases y **apuntar el tag al commit compilado**, no al SHA de `main`; comprobar asset y firma. Entregar enlace directo.
- [ ] Mostrar capturas reales legibles de Pixel 9 y navegador; no dar por aprobada la UX solo con `adb`/árbol UI.
- [ ] Sin modificar VPS operativo, trading, DB, órdenes, puertos ni `main`; la exposición 3020 (INC-015) es asunto aparte pendiente de autorización.

## Condición de cierre

**No considerar finalizada la tarea hasta que el propietario instale la APK corregida y vea el engranaje fijo, un diálogo simplificado y obtenga lectura del bot mediante código nuevo.** La versión inicial de la nueva APK debe marcarse SIN APROBAR hasta evaluación visual del propietario.
