# NEXA — UX Rev13: conectar el móvil sin complicaciones

**Incidencia comunicada por el propietario mediante capturas de APK:** «No. Hazlo más fácil y el icono ajustes tiene que estar visible en el pie de página o encabezado de forma sutil». Se aprecia formulario de vinculación muy alto con nombre del equipo, texto técnico y error expuesto `pair_code_invalid_or_expired`; al entrar en Ajustes aparecen tres tarjetas de tamaño innecesario y la vinculación tapa la navegación.

**Criterio adoptado:** icono ⚙ discreto y persistente **arriba a la derecha**, para conservar los 5 destinos inferiores habituales sin sobrecargar la barra: Inicio, Mercado, Motores, Cartera y Actividad. El icono está visible en la app Básico y Pro; la propia ventana de vinculación también tiene un engranaje discreto en la esquina superior derecha para poder configurar el servidor sin tener que cerrarla.

## CÓDIGO YA MODIFICADO en rama (sin alterar VPS, main ni motores)

- `nexa-v2/web/index.html`: engranaje visible en header global; ventana simplificada «Conectar mi bot» con **un único campo visible** (código temporal), botón **Pegar** (lectura del portapapeles bajo interacción explícita), **Conectar** y **Ahora no**. Nombre de dispositivo automático, no exige introducirlo. Configuración del servidor HTTPS oculta en el engranaje de la ventana, accesible incluso antes del primer emparejamiento.
- `nexa-v2/web/js/app.js`: la barra inferior vuelve a 5 elementos; el nuevo botón de cabecera usa el router existente para `settings`; botón Pegar valida el código de 24 hex sin imprimirlo; 403 se presenta en lenguaje comprensible «El código no es válido o ha caducado. Pide uno nuevo a Cascade», nunca errores internos del backend; el mismo validador de 24 caracteres, timeout y recuperación de identidad se mantienen.
- `nexa-v2/web/js/premium.js`: Ajustes sustituye tres tarjetas enormes por una lista compacta de acciones: **Servidor**, **Conectar este móvil**, **PIN y biometría** (informativo, no botón falso), **Actualizar datos** y **Cerrar sesión** si hay sesión. Los permisos de trading siguen siendo solo lectura.
- `nexa-v2/web/css/premium.css`: cabecera con engranaje sutil de zona táctil ≥33–38 px, campos compactos, panel de configuración desplegable y ajustes en lista. Layout responsive desde 360 px y safe-area Android.
- `nexa-v2/web/sw.js`: cache `nexa-v2-simple-pair-r13` para evitar mostrar UI web antigua.
- `nexa-v2/tests/pairing-access.test.mjs`: 7 pruebas actualizadas de icono en header, cinco tabs, único campo visible, pegado, 24 hex, 403 en castellano, valores por defecto HTTPS y limpieza de URL HTTP antigua.

## Aceptación obligatoria de Cascade

1. Ejecutar `cd nexa-v2 && npm test`, con los tests de pairing y regresiones completos; corregir cualquier test de Rev12 que siguiera esperando un sexto icono en el pie.
2. `npx cap sync android`, compilar **0.5.1 o versión superior** y comprobar sin desinstalar (preservar PIN, claves de dispositivo y IndexedDB); firma idéntica a la versión instalada o proporcionar procedimiento de migración seguro, no borrar datos sin permiso.
3. Verificación visual REAL con Android (capturas legibles): Inicio Básico/Pro → icono engranaje en cabecera, 5 destinos al pie. PIN → Conectar: **solo código**, botón Pegar, Conectar, Ahora no. Engranaje del modal → URL HTTPS accesible antes de vincular. Página Ajustes → lista compacta.
4. Pruebas negativas: código de 12 caracteres no se envía, 24 caracteres íntegros, código caducado 403 muestra texto amable, timeout 12 segundos muestra error, portapapeles denegado permite pegar manualmente; no pérdida de sesión/clave tras error de vinculación.
5. Confirmar que la APK nueva consulta la pasarela HTTPS **sin permitir escrituras**. Pedir un código nuevo de 10 minutos solo cuando el propietario haya actualizado la APK. Enviarlo privadamente: no compartir códigos activos, tokens ni credenciales en Issues.
6. Publicar APK firmada, SHA-256, GitHub Release y tag apuntando **al commit compilado** (no a `main`), y URL real del panel. Mantener SIN APROBAR hasta prueba en Pixel 9.
7. Mantener `main`, VPS, motores, BD y LIVE intactos. El riesgo INC-015 (3020 expuesto) es independiente y no se corrige sin permiso nuevo.

## Límites de esta sesión

**Realizado:** código fuente cambiado y subido; 16 comprobaciones estructurales y de renderizado de Ajustes en V8 superadas sin errores. **No realizado:** `npm test` real (sin checkout local completo), compilación APK, QA visual Pixel 9 o pruebas con código de vinculación válido. No decir que 0.5.0 contiene Rev13: es necesario compilar una nueva entrega.
