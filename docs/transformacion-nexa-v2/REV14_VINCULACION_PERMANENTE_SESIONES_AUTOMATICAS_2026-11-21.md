# NEXA · REV14 — VINCULACIÓN PERMANENTE EN UN SOLO PASO

**Fecha:** 21/11/2026 · **Rama:** `feature/nexa-v2-transformacion-20261120` · **Estado:** código subido a GitHub, APK pendiente de compilación y QA física.

## Decisión del propietario

> «Pero vamos a ver, ¿qué sentido tiene tener una APK con un código que caduca?»

**Respuesta de producto vinculante:** el código temporal de 10 minutos es únicamente un mecanismo seguro de **alta de dispositivo**, NO un login de uso diario. Se pide **una sola vez por teléfono**. La clave criptográfica local P-256, persistida en IndexedDB, es la identidad a largo plazo. El servidor almacena únicamente la clave pública del dispositivo en un almacén independiente. Los tokens de sesión de 30 minutos se renuevan automáticamente mediante desafío firmado, sin un nuevo código ni nombre de usuario o contraseña. El PIN/biometría sigue siendo el acceso normal diario.

Se requiere un nuevo código SOLO para una instalación distinta que perdió la identidad, borrado de datos, dispositivo nuevo o revocación expresa; **no** por caducidad de la sesión, caída de Internet ni reinicio del BFF.

## Problema real encontrado (código)

Antes de Rev14, `scheduleRefresh()` actualizaba datos solo si `session.get()` seguía devolviendo un token vigente. Al caducar el token a los 30 min, la pantalla podía volver a «Sin vincular» y cesaba la actualización, aunque `device.isEnrolled()` siguiese siendo verdadero. Además, si fallaba el challenge de inicio por pérdida de red, el flujo caía directamente en la ventana de un **nuevo código de vinculación**.

## Correcciones YA PROGRAMADAS

- `nexa-v2/web/js/app.js`:
  - Separa explícitamente `deviceEnrolled` de `authenticated` (token temporal).
  - Tras desbloquear con PIN/biometría, si hay clave persistente, hace challenge firmado automáticamente y **no abre la pantalla de código**.
  - Renueva el token con antelación (si quedan menos de 2 minutos), cada 30 segundos mientras esté abierta, y recupera sesión cuando el teléfono recupera la red o pasa a primer plano.
  - Si el gateway reinicia y responde 401 a un token local aún vigente, realiza un challenge nuevo y repite la lectura como máximo una vez, sin consumir un código.
  - Si la red está caída, conserva la clave local, muestra «Conexión pendiente» con acción «Reintentar conexión» y no abre el diálogo de vinculación.
  - Si el servidor comunica `device_unknown_or_revoked`, marca expresamente la necesidad de registrar de nuevo el equipo. No confunde la revocación con un timeout.
  - Deduplica los challenges concurrentes, evita solicitar tokens si la APK está bloqueada y al pulsar Bloquear elimina el token de sesión manteniendo la clave del dispositivo.
  - Tras registrar con éxito un dispositivo, si falla la emisión inmediata del primer token no pide otro código: queda registrado, esperando reconexión.
- `nexa-v2/web/js/premium.js`: Inicio, motores, mercado, cartera, FISCO y Ajustes distinguen «teléfono registrado / conexión temporal pendiente» de «teléfono nunca vinculado». Cuando está registrado ofrecen **Reintentar**, no «Vincular de nuevo».
- `nexa-v2/web/sw.js`: caché rev14 `nexa-v2-persistent-session-r14`.
- `nexa-v2/tests/session-persistence.test.mjs`: **9 pruebas** para sesiones persistentes, rotación previa, expiración, caída de Internet, revocación, llamadas concurrentes, UI y renovación ante 401 remoto.

## Verificaciones realizadas en ChatGPT

Se han ejecutado **9/9 pruebas de lógica** cargando el código Rev14 REAL desde GitHub y ejecutándolo en V8 con dependencias simuladas. No se ha ejecutado `npm test` en un checkout Node ni la APK en el Pixel 9. La pasarela VPS no se ha modificado.

## Checklist OBLIGATORIO PARA CASCADE

- [ ] Continuar sobre `feature/nexa-v2-transformacion-20261120` (Rev14), sin volver a Rev13, ni quitar la seguridad del código de alta.
- [ ] Ejecutar `cd nexa-v2 && npm test`; verificar particularmente `node --test tests/session-persistence.test.mjs` y `tests/pairing-access.test.mjs`.
- [ ] Con fixture local de backend, registrar una vez, reiniciar APK 10 veces: acceso solo con PIN/biometría, sin nuevo código.
- [ ] Mantener la aplicación abierta más de 30 minutos en QA o adelantar reloj de pruebas mediante inyección controlada, verificar rotación 2 min antes de expiración, sin perder datos.
- [ ] Reiniciar BFF de laboratorio (no VPS LIVE), invalidar token en servidor y confirmar recuperación automática tras 401 GET.
- [ ] Desconectar/restablecer Wi-Fi o datos y comprobar «Conexión pendiente» → «Conectado», con clave de dispositivo intacta.
- [ ] Pulsar Bloquear y volver con PIN o huella: sesión nueva, identidad conservada.
- [ ] Borrar datos de app en un **dispositivo de QA** o revocar clave en un backend de laboratorio: solo entonces debe exigir nuevo alta por código. No borrar la identidad real del Pixel 9 del propietario.
- [ ] Probar Básico/Pro, indicadores, IDCA, GRID, AMA, SPOT, cartera y actividad: ningún panel exige otro código por caducidad normal.
- [ ] Compilar APK actualizada, instalar, ejecutar QA visual Pixel 9, generar SHA-256, publicar Release GitHub con tag apuntando al commit fuente exacto y entregar enlace.
- [ ] Mantener gateway VPS actual SOLO LECTURA; no cambiar trading, DB, puertos, firewall ni `main`.

**Nota:** al ser el primer alta de un Pixel 9 no vinculado, aún se necesita un código temporal nuevo, emitido justo cuando el usuario esté delante de la pantalla. Tras canjearlo correctamente, no debe volver a pedir uno.
