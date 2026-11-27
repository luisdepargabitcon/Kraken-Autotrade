# Mapa de convergencia NEXA v2 → NEXA integral

Fecha: 2026-11-27

## Procedencia

- SHA origen: `2c8d6ef` (`feature/nexa-v2-transformacion-20261120` del repositorio de auditoría).
- Integración: copia selectiva del árbol `nexa-v2/` sin `node_modules`, artefactos de build ni binarios generados.
- El árbol local WIP del propietario en `C:/Users/JSLUI/Qsync/BOT_NAS/BOT_AUTOTRADE` no se ha leído ni modificado. Existe riesgo de divergencia futura si ese WIP cambió el mismo árbol; esta integración usa únicamente el SHA auditado anterior.

## Portado

- `nexa-v2/web/`: cliente web/APK.
- `nexa-v2/tests/`: pruebas del cliente NEXA.
- `nexa-v2/android/`: shell Capacitor/Android fuente, sin artefactos generados.
- `nexa-v2/bff/`: referencia histórica del contrato/proxy. El backend integral ya implementa auth v2 nativamente; el BFF no es la entrada operativa.
- `package.json`, `capacitor.config.json`, scripts y documentación incluidos en el árbol.

## Aplazado

- Build Android/APK y dependencias nativas.
- Adaptación de UI/UX visual a la web React existente.
- Cualquier sincronización con el WIP local del propietario.

## Endpoints consumidos y divergencias

Inventario automático sobre `web/js`: 82 combinaciones método/ruta. La mayoría existe en la candidata bajo `/api` y queda cubierta por la política auth v2.

Divergencias reales detectadas:

1. `GET /api/institutional-dca/hybrid/status` no existe. Existe una ruta equivalente en `GET /api/idca/hybrid/status`; no se ha inventado alias.
2. `GET /api/spot/orders` no existe. El propio cliente NEXA ya lo declara como dato ausente y no lo interpreta como cero órdenes.

Divergencias descriptivas, no ejecutadas por `runAction`:

- `adapters.js` documenta `POST /institutional-dca/controls` y `POST /institutional-dca/asset-configs/:pair`, pero las acciones reales usan `PATCH`, que sí existe en backend.
- La extracción inicial marcó `/fisco/meta` por un comentario; la ruta real `GET /api/fisco/meta` sí existe.

## Dependencias

- El cliente NEXA usa módulos ES nativos, WebCrypto, IndexedDB y Capacitor cuando está presente.
- Las pruebas de integración deberán usar polyfills de navegador en Node o un entorno jsdom/happy-dom.
- No se añaden credenciales ni configuración de red privada.

## Riesgos

- La política deny-by-default puede exponer permisos distintos a los que el cliente espera en acciones sensibles; la compatibilidad se valida en WP3b.
- Algunas rutas del cliente son inventario/documentación y no llamadas efectivas; las divergencias anteriores separan ambos casos.
