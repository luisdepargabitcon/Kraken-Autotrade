# NEXA V2 — EVIDENCIAS DEL CHECKLIST (C001–C086)

Regla: cada ID lleva resultado, evidencia reproducible, commit/test y fecha. Estados: VERIFICADA / FALLIDA / PENDIENTE / NO APLICA / BLOQUEADA POR AUTORIZACIÓN.
Revisión 7: evidencias reevaluadas tras la conversión a producto definitivo (provider API real, sin PIN fijo, auth de servidor, acciones autenticadas).

| ID | Estado | Evidencia | Fecha |
|---|---|---|---|
| C001 | VERIFICADA | Rama aislada `feature/nexa-v2-transformacion-20261120`; base congelada 47d79db | 2026-11-20 |
| C002 | VERIFICADA | Matriz P0 en ESTADO_FASES.md (P0-1..P0-9) | 2026-11-20 |
| C003 | PARCIAL | MATRIZ_PARIDAD.csv 76 filas; `mapeado` ≠ `verificado` pendiente contra API real | 2026-11-21 |
| C004 | VERIFICADA | `nexa-v2/web/` shell: login servidor + desbloqueo local opcional + Básico/Pro + Web/APK; tests render+auth | 2026-11-21 |
| C005 | VERIFICADA | `adapters.js`: rutas reales del repo + normalizadores defensivos; estados ok/error/unreachable/auth_required/forbidden | 2026-11-21 |
| C006 | VERIFICADA | Test seguridad: mutaciones SOLO en actions.js/auth.js; 0 secretos; PIN local nunca viaja por fetch (24/24 tests) | 2026-11-21 |
| C007–C018 | PARCIAL | IDCA render: score, anclas, tramos, TP/BE/trailing, órdenes c/ID+fee+slip+motivo, acciones → data-action reales (idca.pauseGlobal/emergencyClose/closeCycle/manualBuy/togglePair). QA visual pendiente | 2026-11-21 |
| C019–C028 | PARCIAL | SPOT posiciones/protecciones renderizados; acción spot.closePosition mapeada a POST /positions/:pair/close real | 2026-11-21 |
| C029–C033 | PARCIAL | Mercado/Cartera/Actividad/FISCO/Ajustes: provider API real; FISCO devuelve auth_required honesto | 2026-11-21 |
| C034–C040 | PARCIAL | Estados ok/stale/unreachable/error/auth_required/forbidden + null→NA (test). Offline SW pendiente QA | 2026-11-21 |
| C041 | PARCIAL | GRID: `normEngineStatus` + ROUTES.grid cubre mode/capital/límites vía GET /grid-isolated/status real; pendiente contrato con API viva | 2026-11-21 |
| C042 | PARCIAL | GRID: niveles/rangos vía GET /grid-isolated/levels + cycles; UI conserva rangos antiguos (render test) | 2026-11-21 |
| C043 | VERIFICADA | GRID: `normGridCycle` preserva buyQty/sellQty/buyPrice/sellTarget/fees/pnl; test 1:1 BUY→SELL qty exacta PASS | 2026-11-21 |
| C044 | PARCIAL | GRID: SELL de rangos antiguos etiquetados en render (`rangeVersion`); pendiente datos vivos | 2026-11-21 |
| C045 | PARCIAL | GRID: events vía GET /grid-isolated/events + monitor/audit mapeados en ROUTES | 2026-11-21 |
| C046 | VERIFICADA | Documentación: gridStrategy SPOT ≠ overlay IDCA ≠ Grid aislado en ANALISIS_F4 + UI etiquetado distinto | 2026-11-21 |
| C047 | PARCIAL | AMA: ROUTES.ama mapea mode/kill-switch/tranches/status reales; modos OFF/LAB/REPLAY/SHADOW/REAL diferenciados en UI | 2026-11-21 |
| C048 | PARCIAL | AMA: mandate/policy/market-view mapeados; pendiente datos vivos | 2026-11-21 |
| C049 | PARCIAL | AMA: portfolio/tranche-plan current mapeados | 2026-11-21 |
| C050 | VERIFICADA | AMA: reserved/submitted/filled/executed diferenciados — test PASS; `executed` nunca inferido sin orderId | 2026-11-21 |
| C051 | VERIFICADA | AMA: killSwitch requiere doble confirmación + permiso ama:control; REAL no se presenta ejecutable por botón | 2026-11-21 |
| C052–C057 | PARCIAL | Mercado/cartera/actividad/config mapeados a rutas reales; freshness por respuesta | 2026-11-21 |
| C058 | VERIFICADA | Seguridad: sesión servidor + roles + caducidad (BFF ref), CSRF, confirmación, idempotencia; sin PIN fijo; tests auth 7/7 | 2026-11-21 |
| C059–C065 | PARCIAL | 24/24 tests; INC-010 nav corregida (min-height 44px); QA viewports/emulador pendiente | 2026-11-21 |
| C066–C075 | EN CURSO | Seguimiento actualizado rev7; rama aislada; sin merge/deploy | 2026-11-21 |
| C076–C079 | VERIFICADA | No DEMO como producto: createApiProvider única fuente; fixtures movidos a tests/; sin datos inventados (unavailable honesto) | 2026-11-21 |
| C080 | VERIFICADA | PIN 2468 eliminado (grep 0); PBKDF2 local elegido por usuario + sesión Bearer servidor con roles/caducidad/CSRF | 2026-11-21 |
| C081 | PARCIAL | Mercado/cartera mapeados a API real; FISCO devuelve auth_required con permiso fisco:read (BFF) — acceso real pendiente de despliegue | 2026-11-21 |
| C082 | PARCIAL | Paridad contratos por tests aislados; verificación contra API real BLOQUEADA POR AUTORIZACIÓN (backend vivo) | 2026-11-21 |
| C083 | PARCIAL | APK release firmada `nexa-v2-0.2.0-release.apk` v0.2.0/VC2, SHA-256 728d4b6c…; GitHub Release preparado tras QA; sin credenciales embebidas | 2026-11-21 |
| C084 | PARCIAL | Web empaquetada estática + BFF proxy; runbook HTTPS en DESPLIEGUE.md; URL real pendiente autorización | 2026-11-21 |
| C085 | VERIFICADA | Gate documentado: DESPLIEGUE.md runbook reversible; ninguna conexión VPS afirmada | 2026-11-21 |
| C086 | VERIFICADA | Mapeo corregido: C041–C046 ahora evidencian GRID, C047–C051 AMA (antes APK/PIN — corregido en esta revisión) | 2026-11-21 |
