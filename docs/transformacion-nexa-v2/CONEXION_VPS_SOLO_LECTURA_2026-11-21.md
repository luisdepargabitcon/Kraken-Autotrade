# NEXA → BOT OPERATIVO: PRIMERA CONEXIÓN REAL DE SOLO LECTURA

**Autorización del propietario:** 21/11/2026, «Sí, continúa» en respuesta a configurar la conexión NEXA en el VPS. **Alcance estricto:** añadir pasarela segura y vincular dispositivo para CONSULTAS exclusivamente; ninguna orden ni cambio de estado de motores, DB, estrategias, configuración de riesgo, API keys o ejecución real.

**Estado a la fecha:** código de pasarela y pruebas en rama `feature/nexa-v2-transformacion-20261120`. **NO DESPLEGADO / NO VERIFICADO** en VPS desde el entorno ChatGPT: conexiones TCP SSH/HTTPS/3020 no accesibles desde aquí. Devin Cascade puede ejecutar localmente el procedimiento una vez auditadas las condiciones de funcionamiento. **No afirmar conexión activa sin prueba.**

## 0. Principio de seguridad

- Pasarela nueva `nexa-v2/bff/read-only-server.mjs`, puerto **127.0.0.1:3101**, completamente SEPARADA de `v2-proxy.mjs` (que no es seguro para producción). No publicar puerto 3101 ni reutilizar backend operativo.
- SÓLO GET en allowlist para SPOT, IDCA, GRID, AMA, market, balances, portfolio, notifications, FISCO con permiso adicional. **Todos** los métodos POST/PATCH/PUT/DELETE dirigidos a `/api/*` son 405 y **nunca** se reenvían al bot.
- Las rutas `/api/v2/pair/*`, `/api/v2/session/*` gestionan únicamente la identidad de dispositivo (NO trading). PIN/biometría siguen siendo desbloqueo local, no sustituyen autorización del servidor.
- Estado de dispositivos en `/var/lib/nexa-ro/devices.json` (0600), separado de la BD del trading. Secretos de bootstrap **sólo en VPS**, nunca en GitHub, release, APK ni logs públicos.
- Permisos admitidos: `read` y opcionalmente `fisco:read`. No existe permiso para control, LIVE, compras, ventas, limpiezas, o cambios de configuración en esta pasarela.
- Certificado HTTPS válido para la IP del VPS. No usar HTTP ni un certificado autofirmado con comprobaciones TLS desactivadas.
- La versión APK 0.4.0 permite configurar la URL con Ajustes → Conexión; sus datos sólo llegarán cuando todo el proceso se complete.

## 1. Auditoría READ-ONLY del VPS *ANTES de modificarlo*

Devin entra en SSH en el entorno del propietario, **sin copiar contraseñas ni credenciales a informes o GitHub**. Comprobar sin cambios:

- `ss -lntp` y `systemctl --type=service --state=running`: quién ocupa los puertos 80, 443, 3020, 3000 y 3101.
- `command -v node; node -v; command -v nginx; nginx -v; command -v certbot; certbot --version` y estado de firewall.
- `df -h / /var`; no instalar dependencias si no hay espacio suficiente.
- Contrastar los endpoints GET loopback con `curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:<puerto>/api/health` y `.../api/institutional-dca/summary`; verificar realmente el puerto upstream. **No hacer POST ni llamadas de modificación al bot.**
- Inventariar Nginx y certificados ya existentes sin sobrescribir configuraciones. Si no hay forma de añadir HTTPS sin alterar el servicio actual, PARAR y comunicar alternativa.

## 2. Aplicar BFF de solo lectura en servicio independiente

1. Extraer **sólo** `nexa-v2/bff/` y `nexa-v2/web/` de la rama a un directorio exclusivo de despliegue `/opt/nexa-ro/bff` y `/srv/nexa-v2/web`. No clonar .env del repositorio ni desplegar el bot ni hacer `git pull` sobre directorios operativos.
2. Crear cuenta de servicio sin login `nexa-ro` y directorio `/var/lib/nexa-ro` dueño `nexa-ro`, permisos 0700.
3. Instalar las dependencias **sólo del BFF** mediante `cd /opt/nexa-ro/bff && npm install --omit=dev`. Comprobar versión de Node >=20 y que Express sólo escucha localhost.
4. Generar bootstrap aleatorio de **al menos 32 bytes** (`openssl rand -hex 32`), exclusivamente en `/etc/nexa-ro/env` con modo 0600. Configurar las variables reales:
   - `NXV2_UPSTREAM=http://127.0.0.1:<puerto-real-auditado>` (**sin /api**, el BFF añade rutas completas `/api/...`).
   - `NXV2_STATE_DIR=/var/lib/nexa-ro`
   - `NXV2_BOOTSTRAP_CODE=<secreto de 64 caracteres hexadecimales, solo VPS>`
   - `NXV2_CORS_ORIGINS=https://localhost,https://5.250.184.18`
   - `NXV2_PORT=3101`
5. Adaptar la plantilla `nexa-v2/bff/nexa-readonly.service.example` según ruta REAL de Node. Validar con `systemd-analyze verify`; arrancar y comprobar que **sólo escucha 127.0.0.1:3101**, sin cambios en el proceso bot.
6. Ejecutar tests de gateway EN AISLAMIENTO antes de arrancar: `npm --prefix /opt/nexa-ro/bff test`, incluyendo denegación 405, denylist, P-256, persistencia de clave pública, CORS y FISCO aislado.
7. Nunca imprimir los códigos de acceso, tokens, bootstrap ni datos financieros en documentos públicos; no incluirlos en GitHub Issues.

## 3. HTTPS para IP 5.250.184.18, sin dominio (si puertos y permisos lo permiten)

Let's Encrypt soporta desde 2026 certificados de IP con perfil `shortlived` de ~6 días. Certbot **5.4+** puede obtenerlos con `--ip-address` y `--webroot` (fuente oficial: https://letsencrypt.org/2026/03/11/shorter-certs-certbot).

Si el servidor de puerto 80 ya sirve un webroot compatible, tras VALIDAR su configuración:
```bash
sudo certbot certonly --staging --preferred-profile shortlived \
  --webroot --webroot-path /ruta/webroot/ya-existente \
  --ip-address 5.250.184.18
# SOLO cuando staging verificado, ejecutar sin --staging.
```
- Sin forzar paradas de los servidores actuales.
- Certbot aún no instala automáticamente certificados IP en Nginx: usar la ruta que realmente devuelva Certbot.
- Instalar renovación automática y deploy-hook que haga `nginx -t && systemctl reload nginx`; **comprobar capacidad de renovación**, pues los certificados son de corta duración.
- Nginx: usar `nexa-v2/bff/nginx-ip-readonly.conf.example` únicamente cuando se confirme que no interfiere con virtual hosts del bot. Ruta `/api/` hacia **127.0.0.1:3101**, nunca directamente al backend del bot. Bloquear al público `/api/v2/pair/issue`.
- Si puerto 80/443 o su certificado no se pueden preparar sin interferencia, **PARAR y comunicar bloqueante; no dejar HTTP expuesto ni desactivar verificación TLS**.

## 4. Comprobaciones obligatorias ANTES de generar el código

Por HTTPS real:
- `GET /api/v2/auth/session` sin sesión → **401**, nunca 200.
- `GET /api/institutional-dca/summary` sin sesión → **401**.
- `POST /api/institutional-dca/emergency/close-all` → **405 sin llegar al bot**.
- `POST /api/positions/BTC-USD/buy` → **405**, sin llegar al bot.
- `GET /api/config/api` con sesión válida → **403** (ruta no permitida).
- `POST /api/v2/pair/issue` desde Internet → **404 por Nginx**.
- TLS certificación IP exacta sin warning, CORS **https://localhost** permitido para APK Capacitor 6. Cualquier otra origin arbitraria → 403.
- Estado del servicio original, órdenes actuales, posiciones y ciclos **idénticos** antes y después de desplegar.

## 5. Vincular Pixel 9 SIN USUARIO/CONTRASEÑA

1. Cascade, en la consola local VPS, genera un **único código efímero** llamando al BFF directamente por loopback `http://127.0.0.1:3101/api/v2/pair/issue` con `X-Bootstrap-Code` privado. Solicitar sólo rol `['read']` (y `fisco:read` únicamente cuando el propietario lo apruebe específicamente).
2. El código expira en **10 minutos**, se usa una sola vez. Entregarlo al propietario por medio privado; NO escribirlo en un issue público o una captura.
3. En APK NEXA: PIN → Ajustes → Conexión al servidor → `https://5.250.184.18/api` → Guardar → Vincular dispositivo → código efímero → Confirmar.
4. NEXA crea ECDSA P-256, registra clave pública y obtiene token de sesión tras desafío firmado. El BFF verifica el token en GET y consulta el backend existente **solo en loopback**.
5. Se espera ver SPOT, IDCA, GRID y AMA, cartera, mercado, ciclos e históricos reales. No debe aparecer «0» falso si falla algún endpoint. Correlacionar con pantalla web del bot y ver caducidad/latencia de datos.
6. **Validación de biometría y Keystore en hardware aún pendiente.** La primera fase permite lecturas, no operaciones: la clave WebCrypto no implica por sí sola que se haya verificado huella/rostro cada vez.

## 6. Aceptación y rollback

- Registrar evidencias de GET y 401/403/405 sin respuestas sensibles; filtros C001–C121 y pruebas de mercado/cartera, errores y estados.
- En la APK actual puede haber campos incompletos de adaptador/contrato; corregir en rama, testear y publicar nueva APK antes de dar por completa paridad.
- Publicar URL HTTPS del panel y enlace APK **únicamente cuando ambos estén realmente accesibles y comprobados**.
- Para rollback: detener `nexa-readonly`, retirar sólo el virtual host NEXA y recargar Nginx tras `nginx -t`; bot original intacto.
- Si el entorno VPS resulta diferente a lo supuesto, PARAR y aportar inventario y un cambio mínimo revisable, nunca tocar DB/trading ni sustituir Nginx a ciegas.

**Nota de seguridad:** el repositorio principal tiene archivos `.env` históricos. No copiar credenciales ni utilizar esa configuración para NEXA. Revisar exposición de secretos de forma separada.
