# Acceso VPS desde GitHub Actions: auditoría de solo lectura

Fecha: 2026-11-17. Estado: workflow preparado en una rama, SIN conexión SSH ni auditoría runtime ejecutada.

## Archivos

- .github/workflows/vps-audit-readonly.yml: workflow manual, no se ejecuta automáticamente.
- scripts/vps-audit-readonly.sh: inspecciona commit desplegado, Docker, puertos, salud, PostgreSQL, SPOT, IDCA y Grid.
- No hace pull, despliegue, reinicio, órdenes ni SQL de modificación.
- El informe se cifra antes de subirlo como artifact. El repo es público; no publicar secretos ni informes sin cifrar.

## Configurar GitHub Actions Secrets

En el repositorio: Settings → Secrets and variables → Actions → New repository secret.

1. VPS_AUDIT_SSH_PRIVATE_KEY: clave privada de un usuario auditor con permisos mínimos. Como alternativa, VPS_AUDIT_SSH_PASSWORD: contraseña SSH del usuario especificado por el workflow. Nunca poner credenciales en archivos Git.
2. VPS_AUDIT_HOST_FINGERPRINT: huella SSH ED25519 auténtica, obtenida desde el propio VPS con: ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub -E sha256. Tiene formato SHA256:... y sirve para rechazar conexiones con huella distinta.
3. VPS_AUDIT_REPORT_PASSPHRASE: contraseña aleatoria fuerte, al menos 24 caracteres, para cifrar el resultado. Conservarla en lugar seguro, fuera del repositorio.

Por defecto el workflow intenta SSH como root; se recomienda crear un usuario auditor con permisos mínimos y cambiar VPS_USER antes de ejecutar.

ChatGPT puede leer y escribir en GitHub, pero esa autorización NO proporciona una sesión SSH ni permite consultar o crear GitHub Actions Secrets con la integración actual.

## Cómo ejecutar

Tras revisar la PR y fusionarla en main: GitHub → Actions → NEXA VPS - Auditoria cifrada solo lectura → Run workflow.

Si faltan secretos, el workflow falla antes de conectar. Si la huella no coincide, rechaza la conexión. Si el servidor tiene un firewall que deniega los runners de GitHub, la conexión puede fallar sin tocar el VPS.

El informe solo aparece como artifact cifrado: nexa-vps-audit-encrypted-... Se puede descifrar localmente con:

    openssl enc -d -aes-256-cbc -pbkdf2 -iter 250000 -in NEXA_VPS_AUDIT.enc -out NEXA_VPS_AUDIT.txt

OpenSSL pide la contraseña sin necesidad de pasarla en línea de comandos. Compartir el TXT por un canal privado, NUNCA en una issue o PR pública.

## Protección

- Queries PostgreSQL solo SELECT, en BEGIN READ ONLY y default_transaction_read_only=on.
- Logs solo como contadores de marcadores, nunca volcados completos.
- Los endpoints HTTP consultados son GET; no activan operaciones de compra/venta.
- No usar este script como sustituto de una auditoría manual de exposición de seguridad o reconciliación detallada.
