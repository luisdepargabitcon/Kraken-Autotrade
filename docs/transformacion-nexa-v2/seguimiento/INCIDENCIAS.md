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
