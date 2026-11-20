# NEXA V2 — RUNBOOK DE DESPLIEGUE (requiere autorización)

## Estado: IMPLEMENTADO LOCAL — ninguna acción ejecutada en producción.

Todo lo siguiente está **preparado** pero NO ejecutado. Cada paso necesita permiso expreso.

## 1. Componentes

- `nexa-v2/web/` — panel estático (servir por HTTPS, nunca GitHub Pages público como consola admin).
- `nexa-v2/bff/` — auth de sesión (v2-auth.mjs) + proxy a rutas reales (v2-proxy.mjs).
- `nexa-v2/dist/nexa-v2-0.2.0-release.apk` — APK firmada (keystore local `android/nexa-release.keystore`, NO subir al repo).

## 2. HTTPS (ejemplo nginx delante del backend del bot)

```nginx
server {
  listen 443 ssl http2;
  server_name <host-autorizado>;
  ssl_certificate     /etc/letsencrypt/live/<host>/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/<host>/privkey.pem;
  root /srv/nexa-v2/web;            # estático
  location /api/v2/ { proxy_pass http://127.0.0.1:3100/; }   # BFF
  location /api/    { proxy_pass http://127.0.0.1:3000/api/; } # bot (solo lectura tras auth via BFF recomendado)
}
```
Recomendado: servir TODO /api a través del BFF (auth+CSRF+permisos) en lugar de exponer el bot directo.

## 3. BFF

```bash
NXV2_USERS='{"admin":{"pass":"<pass>","roles":["admin"]}}' \
BOT_UPSTREAM=http://127.0.0.1:3000 \
node -e "import('./bff/v2-auth.mjs').then(async a=>{const e=(await import('express')).default();const p=(await import('./bff/v2-proxy.mjs'));e().use('/v2',a.v2AuthRouter(),p.v2ProxyRouter()).listen(3100)})"
```
Provisionar usuarios/roles reales en `NXV2_USERS` (env, nunca en repo). Roles: `read`, `<motor>:read`, `<motor>:control`, `fisco`, `admin`.

## 4. APK

`?api=https://<host>/api` en primer arranque o Ajustes→Conexión backend. La APK no contiene endpoints ni credenciales.

## 5. Verificación post-despliegue (tras autorización)

- login → 200 + token/roles/expiresAt; logout → sesión invalidada.
- acción sin permiso → 403; acción con permiso → 2xx + auditLog + X-Idempotent-Replay en reintento.
- CSRF faltante en mutación → 403.
- Checklist: pasar C-*-PARCIAL a VERIFICADA solo con respuestas reales registradas.

## 6. Reversibilidad

Quitar `location /api/v2/` y `root /srv/nexa-v2/web` del nginx → el bot sigue operando igual (BFF no toca motores ni DB; solo proxifica).
