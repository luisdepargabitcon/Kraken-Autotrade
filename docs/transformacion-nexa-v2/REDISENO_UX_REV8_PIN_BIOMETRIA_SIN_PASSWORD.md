# NEXA V2 — REDISEÑO VISUAL DEFINITIVO + ACCESO SIN USUARIO/CONTRASEÑA
**Rev. 8 · 21/11/2026 · Obligatoria para Devin Cascade**  
**Estado:** diseño y criterios técnicos; no declarar completado lo que no compile/pase QA.  
**Rama:** `feature/nexa-v2-transformacion-20261120`. Sin VPS/DB/operaciones/merge.

## 0. Instrucción rectora
El propietario considera que la APK 0.2.0 está MAL PRESENTADA: no continuar haciendo parches superficiales ni cambiar colores como único rediseño. Transformar el código existente `nexa-v2/` en una **interfaz premium moderna, propia, coherente y funcional**, manteniendo todos los datos, rutas, históricos y protecciones originales. No copiar literalmente código, recursos, logos, capturas ni identidad visual de terceros.

**Referencias para estudiar, NO clonar:** Revolut X (cartera clara, jerarquía, navegación y gráficos), Kraken Pro (órdenes, posiciones, velas, profundidad y alertas) y Coinbase Advanced (indicadores completos y contexto de mercado).
- https://www.revolut.com/en-EE/revolut-x/
- https://support.kraken.com/es/articles/kraken-pro-trading-interface-guide
- https://help.coinbase.com/en/coinbase/trading-and-funding/advanced-trade/dashboard-overview

## 1. Defectos que muestran las cinco capturas de Pixel 9
- Solape **físico** de hora/cobertura/batería del sistema con NEXA, motor, Básico/Pro; falta inset top real de edge-to-edge Android.
- Diseño de tarjetas repetidas, sobredimensionadas, mucho espacio vertical desaprovechado, casi todo «No disponible»; en ocasiones estado «DISABLED» u «ok.» engañoso cuando no existe una sesión válida.
- Mercado: RSI/MACD/ATR/Bollinger/EMA/ADX en una cuadrícula de texto diminuto, sin jerarquía, gráficos útiles ni explicaciones contextuales; tabulación/grupos rotos al faltar valores.
- Cartera: listas de tablas vacías y totales sin narrativa; no diferenciar falta de conexión de saldo 0 real.
- Menú de IDCA envuelve pestañas en dos filas de modo poco usable; aparente botón «ok.»; ciclos aparecen «Sin ciclos» cuando fuente puede no estar autenticada.
- Pantalla de inicio: nombre de usuario/contraseña — **rechazada expresamente** por el propietario.
- Todos los controles deben poder pulsarse con comodidad en móvil, sin solapar navbar, gestos del sistema o barra inferior.

## 2. Dirección visual PROPIA, no clonada
- Estilo de producto: **NEXA Control**. Fondo azul-noche/carbón, superficies bien separadas, gradientes discretos; azul de navegación; verde para PnL positivo, rojo para pérdida/operaciones peligrosas, ámbar solo para alerta/stale. Evitar decorar elementos normales como alertas.
- Jerarquía de 3 niveles: (A) total/cifra dominante y variación; (B) decisiones/contexto/posición activa; (C) detalle técnico e histórico desplegable.
- Tipografía 14–16 px de lectura real, secundarios 12–13 px, KPIs 28–36 px, controles táctiles de 44–48 dp mínimo, separación 12–16 px, tarjetas radio 16–22 px, contraste WCAG AA cuando proceda.
- **Header móvil:** reservar status bar con insets **reales**, logotipo corto, selector motor mediante bottom-sheet/modal, conmutador Básico/Pro y botón de bloqueo. Evitar etiquetas repetidas o que salten a segunda fila. El estado conexión en chip compacto bajo cabecera. **No utilizar padding fijo como prueba definitiva:** validar Android 14/15/16, Pixel 9, barras ocultas/rotación y WebView.
- **Tabbar inferior:** Inicio · Mercado · Motores · Cartera · Actividad, iconos simples, área segura de gestos, 56–68 dp + insets. Pantallas secundarias FISCO/Ajustes por menú/pantalla completa. Retroceso vuelve a destino correcto, no cierra app inadvertidamente.
- **Web:** navegación superior, grid que aproveche ancho, selector/modal agradable, paneles reorganizables si viable.
- **Básico:** 1 vista limpia y operativa por sección; 3–5 KPIs, estado del bot, estrategia, exposición, posición reciente, alertas prioritarias; detalles accesibles mediante ficha o «Ver más», nunca datos eliminados.
- **Pro:** panel total de mercado/estrategias, grupos por secciones, gráficas, tablas con filtros y selección, todas las métricas de las capturas originales; diseño distinto, no solo otra paleta.
- **Market:** cabecera BTC/ETH, precio y cambio, gráfico OHLCV con timeframe selector; debajo acordeones/tabs: Tendencia, Momentum, Volatilidad, Volumen, Fuentes; indicadores RSI/MACD/EMA20/50/200/Bollinger/ATR/ADX, spreads; leyendas, precisión, origen y timestamp. No hacer una pantalla de 20 valores «No disponible».
- **Cartera:** patrimonio y PnL, capital libre/usado/reservado, HOLD separado; exposición y distribución por motor/activo/exchange; operaciones/eventos; estados empty con CTA única de vinculación, nunca 0 ficticio.
- **Motores:** tarjetas por motor y fichas detalladas. IDCA con score, condición, anclas, drawdown, TP, BE, trailing, duración, órdenes/fees/slippage y cierres/historial con razones; SPOT, Grid y AMA con equivalentes que les corresponden. Acciones reales solo tras controles y permisos comprobados.
- **No conectado / falta permiso / stale / error:** UNA pantalla compacta o banner informativo relevante, sin repetir 20 veces «No disponible» ni ofrecer botones falsos. Conserva navegación pero no finge ausencia de ciclos reales. Distinción clara `AUTH_REQUIRED`, `OFFLINE`, `STALE`, `ERROR`, `EMPTY_REAL`, `DISABLED_REAL`.

## 3. Acceso: PIN, huella y rostro — CERO USUARIO/CONTRASEÑA EN LA APK
**Requisito absoluto:** la APK Android no debe solicitar usuario y contraseña. El propietario abre la app y se desbloquea con **PIN elegido por él o reconocimiento biométrico nativo**. En Android, huella y desbloqueo facial dependerán de sensores y biometría compatible del dispositivo; «Face ID» es la denominación de Apple para iOS futuro. Dar fallback por PIN sin desactivar seguridad.

**Importante:** el PIN/biometría local no autentica al servidor del bot por sí solo. No eliminar autenticación remota: cambiar a **vinculación de dispositivo** + credenciales criptográficas.
1. **Alta inicial SIN username/password:** desde el entorno administrativo seguro, generar un **código/QR de vinculación de un solo uso, con expiración corta y permisos limitados**. Primera vinculación necesita canal autorizado; no publicar código/QR en GitHub, log o panel público. Por defecto no dar privilegios de trading ni FULL_REAL.
2. **Dispositivo** genera clave asimétrica protegida por Android Keystore/servicio de credenciales; registra únicamente clave pública/identificador con backend. Atar sesión y challenge/response a esa credencial (preferentemente WebAuthn/passkeys/Credential Manager con origin, RP y Digital Asset Links autenticados), no a PIN local enviado por red.
3. **Primer acceso**: crear PIN local 6 dígitos recomendado (4–8 si se mantiene diseño), confirmarlo, activar huella/rostro si disponible; nunca guardarlo en claro ni poner uno predeterminado, proteger intentos con retardo/bloqueo y recuperación segura.
4. **Acceso normal**: pantalla elegante «Desbloquear NEXA», botón **Usar huella/rostro** cuando el sistema lo permita, opción **Usar PIN** y estado de dispositivo vinculado. Solicitar validación nativa por `BiometricPrompt` con `BIOMETRIC_STRONG` o `DEVICE_CREDENTIAL` según API y compatibilidad; proteger clave/sesión en Keystore. Si el sensor no está disponible, solo PIN.
5. **Backend** valida desafío firmado, emite sesión corta y roles/políticas; revocación, caducidad, re-pairing tras reinstalar/cambio de móvil y bloqueo por pérdida. No persistir Bearer de alto riesgo en `sessionStorage` sin diseño de seguridad; en web usar sesión protegida y WebAuthn/passkeys. La mera biometría desbloqueando UI **no habilita trading**.
6. **Acciones críticas** (emergencia, compra manual, cambio REAL, cierre, borrado): requiere permiso de servidor, doble confirmación y paso adicional de verificación biométrica/PIN vinculado con challenge de la operación, auditoría e idempotencia efectiva. Para funciones no autorizadas, deshabilitar el control con motivo.
7. **Web**: acceso sin usuario/contraseña mediante passkey/WebAuthn (autenticador del dispositivo) y, si procede, enlace QR de autorización. No degradar seguridad a PIN de cuatro dígitos verificable desde navegador remoto.
8. **Configuración y recuperación**: pantalla «Seguridad» para activar/desactivar biometrias, cambiar PIN, ver/revocar dispositivos autorizados, re-vinculación con código temporal seguro. Tras pérdida de móvil, el propietario puede revocar la clave antigua y autorizar la nueva. Nunca usar correo o contraseña como requisito de uso si el propietario no los quiere.

## 4. Implementación técnica y compatibilidad (sin atajos de seguridad)
- Revisar Capacitor 6 y elegir librería/plugin biométrico **compatible con la versión instalada**, auditado. Android usa `androidx.biometric.BiometricPrompt` para sensor huella/rostro + Android Keystore; no hacer un «popup huella» de HTML que siempre responda true. Las APIs Android 10 o inferiores tienen combinaciones `DEVICE_CREDENTIAL` distintas; degradación explícita sin crash.
- WebAuthn/passkeys en Capacitor WebView exige revisar Credential Manager/AndroidX WebKit y Digital Asset Links/HTTPS; si no se soporta en el motor WebView actual, implementar puente nativo seguro, no enviar un PIN fijo como password oculto.
- Autenticación BFF del repositorio actual usa `NXV2_USERS` (user/pass) como referencia: **no dejarlo como vía obligatoria de la app**. Cambiar cuidadosamente contrato y pruebas sin tocar VPS. Nuevo par de endpoints de vinculación y challenge firmados, rate limiting y revocación auditados. El bootstrap del primer administrador debe ser explícito, seguro y reversible.
- **Riesgos preexistentes que bloquean LIVE:** falta de permit-by-default en `v2-proxy.mjs` y acciones IDCA mal mapeadas (Pausar ciclo→Cerrar, Programar salida→Comprar, Borrar→Cerrar); corregirlos antes de conectar. Revisar FISCO/Ajustes y tipos adapter/screens. Test negativo de cada ruta.
- **Firma APK:** `android/app/build.gradle` contenía credenciales estáticas de firma; ya retiradas del HEAD. Las versiones previas de la clave pudieron verse en GitHub: Cascade debe tratar contraseña/clave de firma anterior como potencialmente comprometida, configurar secretos seguros y decidir migración de firma sin bloquear actualizaciones ni romper instalación del usuario.
- No habilitar nuevas fuentes de datos ficticios, claves exchange en APK, acceso público a consola, ni conexión directa en HTTP. No permisos peligrosos innecesarios.
- Publicar APK actualizada en GitHub Releases **solo después de implementar y probar** PIN+biometría+vinculación, sin identificarlo como completado mientras no se haya probado con backend autenticado. URL del panel privado solo tras autorización explícita de despliegue; ninguna acción VPS dentro de esta orden.

## 5. Pruebas de aceptación OBLIGATORIAS, con evidencias
**UX móvil:** Pixel 9 físico si disponible y emulador Android 14/15/16; 360, 390, 412, 480 px, rotación, teclado emergente, navegación Android, safe areas y navbar. Captura en cada sección. 0 solapes statusbar, 0 texto cortado, 0 botón invisible, 0 tabla inusable. Web 768/1280/1920.
**Login:** sin usuario/pass visible ni API que los exija al móvil, setup PIN doble entrada, PIN incorrecto y rate limit, reset/recovery, huella éxito/fallo/cancelación, rostro si sistema lo permite, dispositivo sin sensor, revocación y reinstalación. Probar no autenticación remota con solo biometría local.
**Ciclo/finanzas:** no confundir API sin sesión con motor DISABLED o ciclos=0; no cotizaciones ficticias, no lost history, datos correctos y frescura; confirmaciones de operaciones y roles denegados.
**Automatizadas:** tests funcionales que ejecuten backend BFF en local con payloads contractuales y permisos; no solo `assert.match` al código. Pruebas UI automatizadas + screenshots reales, APK instalada, SHA-256 y comparación con diseño.
**Entrega:** misma versión funcional de web/APK, NEXA V2 con acceso PIN/biometría, código en rama, tests, checklist marcado por Cascade y nueva APK GitHub descargable tras pasar QA. No publicar versión sin integración o fingir URL web operativa.

**Referencias oficiales técnicas:**
- https://developer.android.com/identity/sign-in/biometric-auth
- https://developer.android.com/identity/passkeys/architecture
- https://developer.android.com/identity/sign-in/credential-manager-webview

**Prohibido por mandato:** SSH/VPS/DB real, órdenes LIVE, configuración de trading real, deployment, merges o cambios en `main`. Toda preparación ocurre en rama de desarrollo y pruebas locales. Solicitar autorización solo cuando se vaya a vincular/desplegar de verdad.
