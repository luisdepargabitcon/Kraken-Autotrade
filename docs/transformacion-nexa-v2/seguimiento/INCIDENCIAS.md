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
