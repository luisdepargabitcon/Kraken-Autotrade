# NEXA V2 — ESTADO DE FASES (seguimiento Cascade)

**Rama:** `feature/nexa-v2-transformacion-20261120`
**Base congelada:** `main @ 47d79db3f7065e0e54481447129f2f88e9225fe2`
**Inicio de trabajo:** 2026-11-20

Estados: PENDIENTE / EN CURSO / VALIDADA LOCALMENTE / PARCIAL / BLOQUEADA POR AUTORIZACIÓN.

## Resumen por fase

| Fase | Estado | % demostrado | Pruebas | Bloqueos |
|---|---|---|---|---|
| F0 — Congelación y P0 | VALIDADA LOCALMENTE | 100% | verificación por git/objects | runtime VPS no autorizado |
| F1 — Inventario y paridad | VALIDADA LOCALMENTE | ~85% | MATRIZ_PARIDAD.csv 76 filas + ROUTES reales en adapters.js | verificación viva pendiente |
| F2 — Panel definitivo | IMPLEMENTADO LOCAL | 85% | render tests + gate sesión en emulador | QA visual viewports pendiente |
| F3 — Contratos+auth+acciones | IMPLEMENTADO LOCAL | 80% | auth.test.mjs 7/7; adapters a rutas reales; BFF ref | validación contra API viva BLOQUEADA POR AUTORIZACIÓN |
| F4 — Análisis estrategias | VALIDADA LOCALMENTE | 100% | ANALISIS_ESTRATEGIAS_F4.md + ago/sep | — |
| F5 — APK definitiva | VALIDADA LOCALMENTE | 95% | app-release firmada v0.2.0 VC2 instalada en emulador; gate sesión verificado | release GitHub pendiente de publicación autorizada |
| F6 — QA final | EN CURSO | — | 24/24 tests node | integración real pendiente autorización |

## Revisión 7 — estado global
`IMPLEMENTACIÓN DEFINITIVA LOCAL PREPARADA — INTEGRACIÓN/DEPLOY REAL PENDIENTE DE AUTORIZACIÓN`.
Nada de DEMO en el producto: provider único `createApiProvider`, fixtures solo en tests/, PIN 2468 eliminado, sesión servidor + roles + CSRF + idempotencia + auditoría (BFF `nexa-v2/bff/`).

## F0 — Congelación, seguridad y preservación

**Ejecutado:**
- HEAD rama: `0f04ae11a424b77e98db1cb649a247d578dd4253` (docs iniciales de la orden).
- `merge-base(origin/main, HEAD)` = `47d79db3f7065e0e54481447129f2f88e9225fe2` == base congelada declarada.
- `git diff --name-only origin/main...HEAD`: solo los 4 documentos de `docs/transformacion-nexa-v2/`. Sin cambios de código previos.
- Leídos íntegros: PLAN_MAESTRO (rev. ámbito 20/11), ORDEN_CASCADE rev. 4, CHECKLIST C001–C075, README.
- Leídas auditorías de referencia: AUD-20261120-01 (backtest Grid), AUD-20261120-02 (integral), AUD-20261120-03 (contraauditoría 22 hallazgos + anexo).
- AGENTS.md existe pero está vacío (0 líneas) — evidencia: `wc -l AGENTS.md` = 0.
- BITACORA.md revisada en secciones recientes (AMA R3, scheduler, readiness, 17 gates fail-closed).
- Rama de diseño `design/nexa-apk-web-basico-pro-20261120` inventariada: `design/nexa-apk-web/{index.html (527 KB), src/app.js (512 KB), src/style.css, src/template.html, build.py, research/}` extraída a temp como referencia; NO copiada a la rama.

**Matriz de riesgos P0 (estado estático, de auditorías previas + verificación puntual en esta rama):**
| ID | Riesgo | Clase | Estado en F0 |
|---|---|---|---|
| P0-1 | AMA `executed=true` con `orderId=null` sin orden enviada | CONFIRMADO (AUD-03, código) | Documentado; no tocar REAL. |
| P0-2 | Doble fuente `dryRunMode` (global vs bot_config) | CONFIRMADO | Documentado. |
| P0-3 | ConfigService update/activate no emite `config:updated/activated` | CONFIRMADO | Documentado. |
| P0-4 | ExchangeFactory ignora `dataExchange`; posible venue equivocado | CONFIRMADO parcial (envío no demostrado) | Documentado. |
| P0-5 | Logs /api incluyen respuestas JSON completas (posible sensible) | CONFIRMADO (código) | Documentado. |
| P0-6 | Auth/autorización de rutas mutables no verificable sin runtime | NO VERIFICADO | BLOQUEADO POR AUTORIZACIÓN (VPS/DB). |
| P0-7 | Reservas de cartera entre motores no cubiertas e2e | NO VERIFICADO | Parcial: existe PortfolioIntegrationAdapter. |
| P0-8 | Secretos en historial público | NO VERIFICADO | Solo metadatos; sin leer valores. Propuesta aparte. |
| P0-9 | Backups FISCO 31 tablas/velas/ciclos | NO VERIFICADO | Verificar solo metadatos; no datos reales. BLOQUEADO POR AUTORIZACIÓN. |

**Sin pruebas de runtime**: no se ejecutó servidor, DB, VPS ni migraciones (prohibido y sin autorización).

## F1 — Inventario 100%
- Inventario por git-objects: endpoints `/api/*`, servicios `server/services/{tradingEngine,strategies,exitManager}.ts`, `institutionalDca/` (21+ servicios), `gridIsolated/` (40+ tests), `ama/` (50+ tests/servicios).
- `server/services/spot/` es **untracked WIP** (staging-v4 fuera de `main`) → no incluido ni modificado; SPOT canónico = tradingEngine+strategies+exitManager.
- MATRIZ_PARIDAD.csv: 76 filas T001–T076, mapeo campo→Básico/Pro→Web/APK con prueba asignada. Estado base `mapeado`; pendiente de marcar `verificado` por control.

## F2 — UX HTML
- `nexa-v2/web/` ES-modules sin bundler: index.html, css/style.css, js/{app,ui,util,contracts,fixtures,provider,screens}.js, manifest.webmanifest, sw.js, assets/icon.svg.
- Shell: PIN gate (hash SHA-256 local), presentación Web↔APK, nav superior escritorio / inferior móvil, Básico/Pro sin mutación (toggle local), router hash.
- 4 motores con subpestañas + Mercado/Cartera/Actividad/FISCO/Ajustes; gráficos SVG (velas, líneas, spark); estados DEMO/REAL/STALE/UNAVAILABLE/ERROR.
- Pruebas: `render.test.mjs` 8/8 (IDCA profundidad, GRID rangos antiguos, AMA REAL cerrado, FISCO restringido).

## F3 — Contratos read-only
- `contracts.js`: CONTRACTS idca/spot/grid/ama + ENGINE_SUBTABS + coverageReport.
- `provider.js`: capa read-only — fixtures DEMO etiquetados y `api()` preparada para endpoints GET reales (sin mutaciones; 0 POST/PUT/PATCH/DELETE verificado por test).
- Estados: fresh/stale/old/unknown por timestamp; null nunca renderiza como 0 (NA). DEMO nunca se confunde con real.
- Pruebas: `parity.test.mjs` 9/9 (cobertura contratos, frescura, no-falso-cero, no-mutaciones, 1:1 grid, AMA executed≠reserved).

## F4 — Análisis estrategias
- `docs/transformacion-nexa-v2/ANALISIS_ESTRATEGIAS_F4.md`: SPOT, GRID aislado, IDCA, AMA + comunes; P0 heredados trasladados a estados UI. Sin reconfiguración.

## F5 — PWA/APK
PARCIAL. **Toolchain real detectado:**
- JDK: Eclipse Temurin 21.0.12 (`C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot`).
- Java por defecto en PATH: 1.8 (insuficiente para AGP) → usar `JAVA_HOME` al JDK 21 sin tocar PATH global.
- Android SDK: `C:\Users\JSLUI\AppData\Local\Android\Sdk` — platforms `android-36`, build-tools `35.0.0`+`36.0.0`, cmdline-tools `latest`, platform-tools adb 37.0.1, emulator.
- AVD existente: `qa34` (AOSP ATD API 34, x86_64).
- Node 24.12.0 / npm 11.6.2; Python 3.11.9.
- `npm i @capacitor/{core,cli,android}@6` OK; `capacitor.config.json` (appId com.nexa.autotrade.v2, webDir=web); `npx cap add android` OK (proyecto nativo generado).
- **BLOQUEO DÍA 2026-11-20:** disco `C:` a 0 bytes libres → `gradlew assembleDebug` falla en la descarga de Gradle 8.2.1 (~50%, `Espacio en disco insuficiente`). D: solo 232 MB libres (insuficiente: se necesitan ~2 GB). Liberados ~139 MB de caches propios; insuficiente. **Se requiere liberación de espacio por el usuario** (~3 GB) o unidad alternativa. F5 queda PENDIENTE/BLOQUEADA, no completada.

## F6 — QA
EN CURSO.
- `node --test nexa-v2/tests`: **17/17 PASS** (9 paridad/contratos + 8 render).
- QA navegador viewports 360/390/768/1280/1920, emulador qa34, APK instalar/arrancar/PIN: PENDIENTE por bloqueo de disco.
- `npm run check`/`npm run build` del repo legacy: pendiente de evaluar pertinencia (frontend nuevo no usa bundler).
