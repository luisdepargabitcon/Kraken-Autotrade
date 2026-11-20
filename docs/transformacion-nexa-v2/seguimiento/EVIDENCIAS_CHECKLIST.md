# NEXA V2 — EVIDENCIAS DEL CHECKLIST (C001–C075 + extensiones)

Regla: cada ID lleva resultado, evidencia reproducible, commit/test y fecha. Estados: VERIFICADA / FALLIDA / PENDIENTE / NO APLICA / BLOQUEADA POR AUTORIZACIÓN.

| ID | Estado | Evidencia | Fecha |
|---|---|---|---|
| C001 | VERIFICADA | Rama aislada `feature/nexa-v2-transformacion-20261120`; base congelada 47d79db; diff solo docs | 2026-11-20 |
| C002 | VERIFICADA | Matriz P0 en ESTADO_FASES.md (P0-1..P0-9) | 2026-11-20 |
| C003 | PARCIAL | MATRIZ_PARIDAD.csv 76 filas T001–T076 | 2026-11-20 |
| C004 | VERIFICADA | `nexa-v2/web/` shell PIN+Básico/Pro+Web/APK; render tests 8/8 | 2026-11-20 |
| C005 | VERIFICADA | Contratos read-only + estados; parity tests 9/9 | 2026-11-20 |
| C006 | VERIFICADA | Test seguridad: 0 fetch POST/PUT/PATCH/DELETE, 0 secretos en bundle | 2026-11-20 |
| C007–C018 | PARCIAL | IDCA panel/ciclos/historial/config renderizan score, anclas, tramos, TP/BE/trailing, órdenes c/ID+fee+slip+motivo, acciones protegidas (render tests). Pendiente QA visual | 2026-11-20 |
| C019–C028 | PARCIAL | SPOT posiciones/protecciones, GRID ciclos 1:1+rangos antiguos, AMA reserved≠executed+REAL cerrado (tests). Pendiente QA visual | 2026-11-20 |
| C029–C033 | PARCIAL | Mercado (fuentes+frescura), Cartera, Actividad (filtro sev), FISCO restringido, Ajustes (tests) | 2026-11-20 |
| C034–C040 | PARCIAL | Estados DEMO/STALE/UNAVAILABLE/ERROR + null→NA (test no-falso-cero). Offline/SW pendiente QA | 2026-11-20 |
| C041–C046 | PARCIAL | **APK compilada** SHA 7a31a017…, manifest solo INTERNET, assets verificados. Instalación/arranque emulador BLOQUEADA por disco | 2026-11-20 |
| C047–C051 | PARCIAL | APK existe (4,16 MB, SHA verificado); PIN/navegación en emulador pendiente por disco | 2026-11-20 |
| C052–C058 | PARCIAL | PWA manifest+sw escritos; no-POST test OK; a11y/viewports pendientes | 2026-11-20 |
| C059–C065 | PARCIAL | Tests 17/17; viewports/emulador/instalación pendientes por INC-003 | 2026-11-20 |
| C066–C075 | EN CURSO | Seguimiento actualizado; commit/push rama pendiente; sin merge/deploy | 2026-11-20 |
