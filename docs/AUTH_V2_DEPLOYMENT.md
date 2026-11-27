# Auth v2 — prerrequisito de despliegue

El backend aplica autenticación v2 deny-by-default en `/api/*` y valida sesión en los upgrades WebSocket.

Antes de activar este build en un entorno durable, aplicar manualmente la migración expand-only `db/migrations/095_nexa_auth_v2.sql`. Esta migración no está registrada en el runner automático y requiere autorización operativa explícita.

Si las tablas no existen, el servicio sigue arrancando y degrada el estado auth a memoria volátil con una alerta de arranque. En ese modo las sesiones y dispositivos no sobreviven un reinicio; hay que repetir el emparejamiento tras cada reinicio hasta aplicar la migración.

El primer emparejamiento requiere `NXV2_BOOTSTRAP_CODE` configurado en el entorno. El bootstrap queda sin efecto en cuanto existe un dispositivo admin activo. No incluir ese valor en repositorio, logs ni documentación operativa.

## Cliente web React

La interfaz React exige un dispositivo vinculado antes de renderizar la aplicación. El navegador nunca solicita el bootstrap: el propietario debe emitir el primer código de vinculación usando `NXV2_BOOTSTRAP_CODE` en un acceso administrativo controlado y entregar ese código al operador por un canal seguro.

La clave privada ECDSA del navegador se genera como no exportable y se guarda en IndexedDB; el token y CSRF de sesión se guardan solo en sessionStorage y se renuevan mediante challenge firmado. Los WebSocket del cliente usan el token de sesión auth v2; los tokens legacy solo quedan como fallback de compatibilidad.
