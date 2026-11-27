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


## Convergencia de ramas: runtime, main y NEXA (medido con git, sin fusionar nada)

Refs comprobadas el 2026-11-27: runtime auditado `3ae1831` (`integration/staging-spot-v4`; tip actual `1784f94`, solo 2 commits de BITACORA más), `main` = `47d79db`, NEXA = `2c8d6ef`. Base común de las tres líneas: `a5ddbce`.

| Línea | Commits exclusivos respecto a la base | Qué contiene |
|---|---:|---|
| runtime (`3ae1831`) | 101 | Código operativo: ~236 ficheros en `server/services`, 51 en `client/src`, 7 migraciones (`db/migrations`), 6 rutas, `shared/schema.ts`, `storage.ts`, `routes.ts`, `index.ts`: GRID V3.1/V3.2, SPOT Entry V4, SPOT-AI, correcciones de normalización temporal, etc. |
| `main` (`47d79db`) | 43 | **Solo documentación**: 25 ficheros en `docs/auditorias`, `AUDITORIAS/AUDITORIA_INTEGRAL_2026-11-17.md`, README y órdenes de trabajo `.md`. Ningún fichero de código (verificado: 0 ficheros fuera de md/html/csv/json/txt/docs/AUDITORIAS). |
| NEXA (`2c8d6ef`) | 330 (respecto a runtime) | Cliente y documentación: `nexa-v2/android` (54), `nexa-v2/web` (35), `nexa-v2/tests` (25), `nexa-v2/bff` (7), `docs/transformacion-nexa-v2` (23), `docs/auditorias` (25), prototipos y 2 workflows; **un único fichero de backend** (`server/routes`). |

Hallazgos de convergencia (corrigen la lectura de la auditoría #20, que describía la divergencia 101/43 solo en número de commits):

1. **`main` no contiene código que el runtime no tenga**: sus 43 commits exclusivos son documentación. La diferencia funcional entre `main` y el runtime son las 101 correcciones solo-runtime (entre ellas la normalización de segundos/milisegundos en velas, H-009/H-020). Desplegar `main` seguiría perdiendo esas correcciones; desplegar la línea runtime/candidata no pierde ningún código de `main`.
2. **Prueba de fusión sin conflictos (en seco):** `git merge-tree` entre runtime y `main` no produce marcadores de conflicto (el lado `main` es solo docs). No se ha ejecutado ninguna fusión.
3. **NEXA no solapa con el runtime:** no hay ficheros cambiados en ambos lados desde la base (intersección vacía), por lo que integrar `nexa-v2/` es aditivo; se hizo selectivamente en la candidata (commit de procedencia) sin traer su historia ni tocar el WIP local del propietario.
4. Dependencia: el cliente NEXA asume un backend con auth v2; la candidata lo implementa (WP3a/3b). Sin esa pieza el cliente NEXA no puede operar contra el runtime desplegado.

**Plan de convergencia propuesto (para decisión del propietario, antes de cualquier despliegue):**
1. Mantener la candidata `feature/nexa-integral-20261127` (base runtime) como línea de integración.
2. PR de la candidata hacia `main` solo cuando el propietario lo autorice: es fusión conflict-free por lo medido (main solo añade docs), conserva las 101 correcciones del runtime y trae `nexa-v2/`.
3. Aplicar migraciones pendientes (p. ej. `095_nexa_auth_v2.sql`, no registrada) únicamente con backup y autorización, siguiendo `docs/AUTH_V2_DEPLOYMENT.md`.
4. Ningún despliegue de `main` tal cual; el despliegue de la candidata requiere: contención de perímetro (autorización separada), `NXV2_BOOTSTRAP_CODE`, y emparejado previo de un dispositivo admin.
