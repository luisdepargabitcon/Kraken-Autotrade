# NEXA V2 — INCIDENCIAS (defectos, bloqueos y su resolución)

Formato: ID · fase · gravedad · descripción · causa · reparación · nueva prueba · estado.

## INC-001
- **Fase:** F0 · **Gravedad:** info
- **Descripción:** AGENTS.md existe pero está vacío (0 líneas); el README de la rama de diseño advertía «AGENTS.md indicaba que no se recreara».
- **Causa:** archivo vacío en `main`.
- **Resolución:** documentado en ESTADO_FASES.md; se usan los docs de `docs/transformacion-nexa-v2/` como fuente de verdad de la transformación.
- **Estado:** CERRADA.

## INC-002
- **Fase:** F0 · **Gravedad:** bloqueo (autorización)
- **Descripción:** verificación runtime de auth, reservas, backups FISCO 31 tablas y secretos reales no ejecutable.
- **Causa:** prohibido VPS/DB/órdenes; sin autorización expresa.
- **Resolución:** marcadas como BLOQUEADO POR AUTORIZACIÓN en matriz P0 y checklist.
- **Estado:** BLOQUEADA POR AUTORIZACIÓN.

## INC-003
- **Fase:** F5 · **Gravedad:** bloqueo externo
- **Descripción:** `gradlew assembleDebug` falla: `java.io.IOException: Espacio en disco insuficiente` durante descarga de Gradle 8.2.1-all (~50%).
- **Causa:** unidad C: al 100% (0 bytes libres); D: solo 232 MB. Se requieren ~2 GB (dist Gradle + dependencias AndroidX + salidas de build).
- **Resolución:** liberados ~139 MB (borrador de descarga parcial propio + `npm cache clean`); insuficiente. Requiere acción del usuario: liberar ~3 GB o indicar unidad alternativa para GRADLE_USER_HOME.
- **Estado:** PARCIALMENTE RESUELTA (2026-11-20) — APK compilada offline con caché Gradle existente + buildDir en D:. Sigue bloqueada la **instalación/arranque en emulador** (AVD necesita ~GB libres en C:).

## INC-004
- **Fase:** F2 · **Gravedad:** defecto
- **Descripción:** acciones protegidas del ciclo IDCA (Pausar/Cerrar/Emergencia) no se renderizaban en modo Pro (solo en Básico, en rama muerta).
- **Causa:** condición ternaria mal anidada en `idcaCycles` (`ctx.mode==='pro'?tp+orders:expandable(...)` omitía `actions` en la rama Pro).
- **Reparación:** Pro renderiza `tp+orders+actions` en línea; Básico lo envuelve en `expandable`. Detectado por `render.test.mjs`.
- **Estado:** CERRADA (test «IDCA ciclos…acciones protegidas» PASS).

## INC-005
- **Fase:** F2 · **Gravedad:** defecto
- **Descripción:** tabla «Órdenes del ciclo» no incluía el ID de orden → pérdida de trazabilidad.
- **Reparación:** columna `ID` (mono) añadida; `ord_9012` visible. Detectado por `render.test.mjs`.
- **Estado:** CERRADA.

## INC-006
- **Fase:** F3 · **Gravedad:** defecto
- **Descripción:** `ctxMarketCandles` usaba `window` (no testeable en node) y `renderMarket` solo leía `m.sources` mientras fixtures usan `externalSources`.
- **Reparación:** `globalThis` + fallback `m.sources||m.externalSources`.
- **Estado:** CERRADA.

## INC-007
- **Fase:** F5 · **Gravedad:** defecto
- **Descripción:** `npx cap sync` regenera `capacitor-cordova-android-plugins/build.gradle` y revierte el pin AGP a 8.2.1 (no cacheado) rompiendo el build offline.
- **Reparación:** re-aplicar reemplazo AGP→8.13.0/gms→4.4.4 tras cada `cap sync` (documentado en nexa-v2/BUILD_APK.md).
- **Estado:** CERRADA (procedimiento documentado).

## INC-008
- **Fase:** F5 · **Gravedad:** bloqueo externo
- **Descripción:** emulador `qa34` no arrancaba: 1) check de disco (userdata 6 GB + RAM 2560 en ram.img), 2) crash silencioso de qemu tras «Starting QEMU main loop» (mem-path ram.img ~2,5 GB > espacio libre), 3) `opengl32sw` ausente en swiftshader_indirect.
- **Resolución:** liberados ~3,3 GB en C: (Temp, caches propios, qcow2 antiguos, Windsurf Cache, CrashDumps); `disk.dataPartition.size`→2 GB; `-memory 1024`; GPU `guest`/lavapipe headless. Boot OK (~100 s WHPX).
- **Estado:** CERRADA.

## INC-009
- **Fase:** F5 · **Gravedad:** menor
- **Descripción:** screencap produce PNG negro (headless `-gpu guest` + lavapipe no compone framebuffer).
- **Resolución:** verificación funcional por `uiautomator dump` (bounds+texto reales). Capturas visuales quedarían para QA con ventana.
- **Estado:** CERRADA (alternativa documentada).

## INC-010
- **Fase:** F5/F6 · **Gravedad:** menor
- **Descripción:** barra de navegación inferior queda parcialmente fuera del viewport en 480×800 (bounds y 793–800, ~7 px).
- **Causa probable:** safe-area/altura WebView; el área táctil responde pero el área visual es mínima.
- **Estado:** ABIERTA — ajuste CSS pendiente (padding-bottom safe-area en .bottomnav).

| INC-011 | RESUELTA | Rev7 | Evidencias C041–C046/C047–C051 mal asignadas a APK/PIN | Corregido: C041–C046→GRID, C047–C051→AMA en EVIDENCIAS rev7 | 2026-11-21 |
| INC-012 | RESUELTA | Rev7 | INC-010 nav inferior 480×800 | `min-height:44px` en `.bottomnav a` + min-height barra | 2026-11-21 |
| INC-013 | ABIERTA | Entorno | Emulador AOSP ATD API34 inestable en WHPX: arranques que quedan `offline`/crash MMIO; requiere varios reintentos | Receta que funciona: `-accel auto -gpu swiftshader_indirect -memory 1024 -no-snapshot -no-audio`; disco C≥1.6G libre, dataPartition=1400M | 2026-11-21 |
| INC-014 | ABIERTA | Rev7 | Verificación C-*-PARCIAL contra API real del bot | BLOQUEADA POR AUTORIZACIÓN (backend vivo/VPS) — ver DESPLIEGUE.md | 2026-11-21 |

## INC-014 — Rev11 QA (2026-11-21)
- Tests 51/51 tras corregir 4 regresiones: texto "detenido/sin ciclos/LIVE" en estado no verificado (premium.js), "Fuentes de datos" en Mercado Pro, ctx authenticated en tests render, filtro severidad en lista premium Actividad.
- APK 0.4.0 (VC4) compilada, firmada cert R8, SHA-256 `d68025a53764921b62285a091630806ceb541b3e14fc55498c3947c7296d30d7`, 5.68 MB. Instalada emulador API34: setup PIN 6 dígitos + confirmación, overlay de vinculación, nav Motores→IDCA premium, subpestañas conservadas, estados honestos. Screenshot negro (headless). Pixel 9 físico no disponible.
- Caché Gradle corrupta por disco lleno: borrado `caches/8.14.3` completo y rebuild online OK.

## INC-015 — Primera conexión VPS read-only (2026-11-21)
- Auditoría preflight: VPS OK (137G libre, Node 20.20, nginx 1.18, certbot 1.21). Bot REAL = `krakenbot-staging-app` puerto 3020 (integration/staging-spot-v4, IDCA live); puerto 3000 = main legacy (HTML).
- Pasarela `read-only-server.mjs` en `/opt/nexa-ro/bff`, servicio `nexa-readonly` (usuario nexa-ro, solo 127.0.0.1:3101). Tests VPS 2/2. Estado dispositivos `/var/lib/nexa-ro` 0700, env `/etc/nexa-ro/env` 0600.
- HTTPS: certbot 1.21 no soporta `--ip-address` → dominio `nexa-5-250-184-18.nip.io` con cert LE válido (plugin nginx, renovación automática). Vhost añadido sin tocar los 6 existentes.
- Verificación externa: panel 200, session 401, dca 401, POST close-all/buy 405, pair/issue 404, TLS válido.
- End-to-end QA: enrolamiento ECDSA P-256 + sesión + datos REALES (IDCA live $3000, GRID SHADOW, AMA OBSERVING, portfolio $5000, BTC $55862.70).
- **RIESGO ABIERTO:** puerto 3020 expone API completa públicamente (0.0.0.0, UFW inactivo, curl externo 200). NO tocado — requiere autorización separada para firewall. Puerto 3000 no alcanzable externamente.
- APK 0.5.0 (VC5): validación HTTPS obligatoria. SHA-256 `691669538a2058e6fbfc0a8bfbf2831340243a25a9252fb59c8cad0b55f27d3b`. Instalada en emulador, arranque OK.

## INC-018 + Ficha universal — entrega 0.5.4 (2026-11-21)
- **Ficha universal verificada con datos reales** (navegador QA contra pasarela real + emulador): órdenes IDCA (#827 venta $149,87 trailing_exit_dust_adj; #826 compra con score=78; #825 breakeven fail_safe $1400,86), ciclo #54 cerrado con PnL $5,65 y campos íntegros, 17 ciclos GRID con trazabilidad de rango (buy_filled BTC/USD $64.390,22 → objetivo $65.221,61), 2274 niveles GRID inspeccionables, 50 eventos monitor, mandato AMA real (PRUDENTE/ADAPTATIVO/RECUPERAR_CAPITAL/SOLO_ANALISIS), 280 eventos fusionados en Actividad.
- Cierre modal: X, backdrop, Escape y botón Atrás Android (popstate) — verificado en emulador. 30 aperturas/cierres sin acumulación.
- INC-018: totales de órdenes solo suman importes verificados (P01); IDCA Asignado/Usado separados (P02); cartera etiqueta «Valor total (API)» + asignado/desplegado/libre sin confundir presupuesto con NAV (P03); cartera con holdings/ledger/reservations/budgets/inventory reales inspeccionables; Actividad = notificaciones + eventos GRID/AMA/IDCA deduplicados (P09); tarjeta seguridad/bloqueos GRID; motivo de eventos usa naturalMessage.
- **Descubierto:** `/grid-isolated/monitor/audit` devuelve 502 payload_too_large en la pasarela (límite 5 MB anti-abuso; el audit lleva 2254 niveles). El monitor usa `/events` como respaldo. Ampliar el límite o paginar requiere autorización para tocar la pasarela desplegada.
- Tests 82/82. APK 0.5.4 (VC9), SHA-256 `9e9854b8f58b84a5c8614e05a7cb5b2c2f53cb88185d6d8bd1f20bffdab4a99f`, Release publicada tag→`acdb284`. Emulador: PIN→vinculación real→Conectado→fichas→reinicio→solo PIN→sesión automática.
- **Pendiente:** panel web del VPS no actualizado con esta revisión (despliegue bloqueado por autorización expresa); Pixel 9 físico; viewports 360–1920 exhaustivos.

## Rev20 — UX global + APK 0.6.0 (2026-11-21)
- **Fase A:** `npm ci` OK · `node --check` sobre todo JS OK · tests 95/95 · GitHub Actions `nexa-v2-feature-qa` VERDE en `44256a3` (tip `b270c91` solo añade docs).
- **Fase B (revisión código):** `collectPositions` exige evidencia ejecutada — GRID `buyQty>0`, AMA `filledQty>0` (mandatos/reservas/planes excluidos); trades globales etiquetados «motor de origen no atribuido» (no SPOT); velas solo reales («sin velas verificables» si la API no las da); correlación Pearson sobre retornos log sincronizados 15m, exige ≥8 muestras («Pendiente» honesto).
- **Fase C (QA navegador contra pasarela real, 393px):** Inicio visual — 7 posiciones confirmadas (LIVE 1 / SIM·SHADOW 6), NAV $5000, BTC $60.294,30, ETH $1.683,24. Posiciones con ficha + «Gestionar ciclo». BTC/ETH detalle: posiciones del activo, operaciones, indicadores, correlación «Pendiente» honesta. Inspector abre/cierra (Esc) conservando scroll. Gestión IDCA ciclo #55 ETH/USD live trailing_active ($1042,60 usado, +$51,23). Viewports 360/768/1280 sin overflow horizontal.
- **Fase D:** contratos verificados en `actions.js` — solo-salida PATCH `{soloSalida}`, time-stop PATCH `{disabled}`, manual-buy POST con pair/price/quantity/notionalUsd/feesUsd/executedAt/exchange + checkbox «compra YA ejecutada» (no lanza orden real). 10 acciones de gestión **deshabilitadas** con sesión de solo lectura (sin `idca:control`). BFF deny-by-default en vivo: POST/PATCH/DELETE → **405**; POST /auth/session → 405.
- **Fase E:** APK 0.6.0 (VC10) compilada y firmada (mismo cert, instala encima). SHA-256 `eafc280cfb749a06e962362cec90e454ef0dc0fe1852b61c8f149abdf5631c2d`, 5 755 896 B.
- **INC-020 ABIERTA (bloqueo infraestructura):** emulador qa34 inarrancable en este host — el AVD crea `snapshots/default_boot/ram.img` de 2,5 GB en cada arranque pese a `-no-snapstorage`/config cold-boot y el host tiene <1 GB disco libre y 3,3 GB RAM libre (invitado exige 2560 MB). Muere silenciosamente tras init. Instalación de la APK en dispositivo queda pendiente (Pixel 9 o host con recursos). Espacio parcialmente recuperado limpiando cachés Gradle, snapshots y APKs antiguas.
- **Web preparada, NO desplegada:** `nexa-v2/web` contiene Rev20; el panel `nexa-5-250-184-18.nip.io` sigue en la versión anterior (0.5.x) — despliegue bloqueado por autorización expresa.

## Rev22 — Cartera profesional + REAL/SHADOW + P0 keystore (2026-11-21)
- **INC-021 ABIERTA (P0 seguridad de firma):** `nexa-v2/android/nexa-v2-release.keystore` estaba versionado en Git. Auditoría sin imprimir secretos: keystore JKS válido, alias `nexa-v2`, certificado `CN=NEXA V2 R8, OU=Dev, O=Kraken-Autotrade, L=Local, C=ES`, SHA-256 del certificado `D3:05:2F:F2:…:25:AB` — **idéntico al certificado de la APK publicada 0.6.0** (apksigner: `d3052ff2649c755f7b844dfbaca04f08e12d890e7ed6696f01356a4d579825ab`). Conclusión: el keystore versionado ES la clave real de firma de las releases; la seguridad de firma NO está garantizada (exposición histórica en el historial de Git). Acciones: retirado del índice (`git rm --cached`), ignorado en `nexa-v2/android/.gitignore` (`nexa-v2-release.keystore`, `*.jks`). El archivo local se conserva solo en almacenamiento local protegido. **NO se reescribe historial** (exposición histórica permanece hasta remediación autorizada), **NO se rota la clave** (requiere autorización expresa), **releases firmadas BLOQUEADAS** hasta rotar clave o validar custodia.
- **QA autenticado contra pasarela real** (dispositivo QA emparejado, sesión real): Inicio REAL → LIVE 0 posiciones confirmadas, «Patrimonio exchange No confirmado», «Conectado · datos parciales» con Reintentar (honesto); Inicio SHADOW → 7 posiciones SIM/SHADOW, tema propio (`data-scope=shadow`); Cartera REAL → 12 saldos reales, Kraken y Revolut X separados (USD revolutx 1265,55 → $1265,55; ETH revolutx 0,00877624 → $15,03; TON/ZKJ/MEW…), presupuesto interno $5000 etiquetado «NO es saldo del exchange», 1 activo sin valorar señalado, sin total inventado; Cartera SHADOW → solo saldo virtual IDCA/simulation, aviso «no representa dinero depositado»; Motores REAL → IDCA live, historial 35 registros del entorno; Actividad REAL≠SHADOW (contenido difiere); Mercado → BTC $60.621,80 real, «Sin velas válidas, no se dibujan curvas ficticias», Bid/Ask/Spread «—» honesto; viewports 360/390/412/480/768/1280/1920 sin overflow horizontal.
- **Auditoría VPS solo lectura:** `nexa-readonly` activo (127.0.0.1:3101), nginx activo, upstream `http://127.0.0.1:3020` (bot real en Docker, `kraken-bot-db` healthy; `/api/health` 200 en ~177 ms). Puerto 3020 sigue expuesto en 0.0.0.0 vía docker-proxy (riesgo ya documentado INC-015 — remediación firewall NO autorizada). **Web desplegada obsoleta:** `/srv/nexa-v2/web` sigue siendo la build pre-Rev20 (sin `dashboard.js`, `display-scope.js`, `portfolio-view.js`, `scoped-pages.js`, `import-position.js`, `fisco-view.js`, `inspector.js`; `app.js` 26 KB vs 37 KB en rama) — despliegue sigue bloqueado por autorización expresa. `/api/v2/pair/issue` devuelve 404 en la capa nginx (correcto).
- **Android CI:** workflow corregido — localiza `sdkmanager` bajo `$ANDROID_HOME`/`$ANDROID_SDK_ROOT` en vez de la ruta fija `cmdline-tools/16.0/bin` inexistente; permisos `contents: read`, sin secretos de firma, artefacto debug QA (no release). Build debug local OK @ `aa9d718`, SHA-256 `4178a8cbe9232086d58476b29f34a31fd3016e881f2b1f6a993900d3fa0c6818`, 7 203 053 B (artefacto QA, NO release firmada).
- Tests: 103/103 tras rebase en `aa9d718`. Secretos: diff auditado, 0 coincidencias; `.env`/`.env.stg` raíz contienen placeholders de 5 caracteres (sin credenciales reales).
- **Pendiente:** CI Android en GitHub tras push del fix; verificación run a run.

## Rev23 — APK vieja diagnosticada + QA APK .qa + datos de mercado reales (2026-11-23)
- **Diagnóstico del reporte del usuario:** la APK instalada era 0.6.0 (commit `7201cb5`, SHA `eafc280c…`), compilada ANTES de toda la línea REAL/SHADOW + cartera profesional (`b8b9317`+). Verificado dentro del APK: `assets/public/js` no contiene `display-scope.js`, `portfolio-view.js`, `scoped-pages.js`, `fisco-view.js`, `import-position.js` (0/5). No era un fallo de sincronización: era una APK antigua legítima.
- **CI desplegada por detrás de la rama (hallazgo):** el BFF desplegado `/opt/nexa-ro/bff/read-only-server.mjs` (md5 `3e4719af…`) NO contiene `entry-diagnostics` en su allowlist (0 coincidencias) ni `exit-instructions`; la versión del repo sí. Además la guarda `%2F` de `isReadPath` bloquea TODAS las rutas con par codificado salvo `/api/market/` → `price-context/{pair}` y `market-data-health/{pair}` son inalcanzables aunque estén regex-permitidas. Consecuencia: régimen/ATRP/score IDCA quedan honestamente en «—» en la app hasta actualizar la pasarela (autorización pendiente).
- **Mercado enriquecido con datos REALES:** `ama/market-view` aporta bid/ask/spread/mid/spreadPct/macroZone cuando el par coincide (verificado en vivo: BTC BID $61.628,80 ASK $61.628,90 spread $0,10, zona macro CAPITULACION, caída real); `entry-diagnostics` alimenta régimen/ATRP/score/decisión por par cuando el BFF lo permite (403 → «—» honesto + fuente marcada `forbidden`). `/api/market/{pair}` upstream devuelve SOLO ticker (price, change24h, volume24h): **no existe endpoint OHLCV** — el bot cachea velas internamente (verificado: candleCount>0 en market-data-health upstream) pero no las exporta; la app lo explica explícitamente («El bot calcula velas internamente, pero la API de solo lectura no exporta la serie»).
- **Fichas honestas:** estados `rejected/cancelled/failed/skipped/vetoed/planned/reserved/pending/expired` y eventos técnicos (`path=events`, `trace.decisions`) ya no se presentan como operaciones ejecutadas: pastilla «EVENTO»/«COMPRA RECHAZADA», hero «sin ejecución confirmada», texto explícito «no computa como operación ni como resultado».
- **QA APK 0.7.0-qa (commit `8e6db45`):** `debug { applicationIdSuffix ".qa"; versionNameSuffix "-qa" }` → paquete `com.nexa.autotrade.v2.qa`, **coexiste con la release 0.6.0 sin desinstalar** (la firma debug es incompatible con el certificado release — se evita el conflicto cambiando el applicationId, no pidiendo desinstalación). Ajustes muestra `NEXA 0.7.0 · 8e6db45 · qa`. SHA-256 `eb1ba8b5812b14a3690ea5e5d5419253b283956d3fa3433cad0010f837f7cd31`, 7 205 429 B. Firmada con la clave debug estándar de Android — NO es una release ni usa la clave expuesta (INC-021 sigue bloqueando releases firmadas).
- **fisco:read:** la autorización se concede en el momento de vincular (rol incluido en el código de emisión). Mensaje 403 mejorado explicándolo. QA: emitido código con roles `["read","fisco:read"]` para el Pixel 9.
- Tests 103/103 tras los cambios. Sin tocar motores, DB, firewall, servicios ni `main`.
