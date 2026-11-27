# INFORME DE IMPLEMENTACIÓN — NEXA INTEGRAL (Issue #22)

**Rama:** `feature/nexa-integral-20261127` — **Base:** `1784f94` (tip de `integration/staging-spot-v4`). Justificación de base: el SHA runtime auditado `3ae1831` es ancestro directo de `1784f94` y los 2 commits intermedios son exclusivamente documentación de BITACORA; el código operativo es idéntico al runtime. No se ha desplegado `main` ni se ha fusionado nada.

**Estado global: CANDIDATO IMPLEMENTADO PARCIALMENTE / VALIDADO EN AISLADO — SIN APROBAR PARA PRODUCCIÓN.**

Leyenda de estados por elemento: IMPLEMENTADO / PROBADO / COMPILADO / SUBIDO — ningún elemento está DESPLEGADO ni VALIDADO_USUARIO.

## Entorno y método

- Worktree aislado en la máquina del operador; el repositorio de desarrollo local y su WIP no se han tocado.
- Pruebas: módulos reales importados, mocks/fixtures sin red ni credenciales. Ningún test contacta APIs privadas ni envía órdenes.
- `npm test` = vitest. Typecheck = `tsc --noEmit`.
- Cero acceso al VPS, cero órdenes reales, cero cambios en producción, cero secretos en el diff.

## Matriz de hallazgos #20 → cambio → prueba → estado

| Hallazgo | Cambio | Prueba | Estado |
|---|---|---|---|
| H-001 Kraken ejecutable por API | `kraken.ts`: `placeOrder`/`placeOrderRaw`/`cancelOrder` lanzan `KRAKEN_EXECUTION_FORBIDDEN` incondicionalmente; implementación eliminada, no desactivada por flag | `krakenExecutionForbidden` 10/10 incl. con credenciales inicializadas (throw antes de cualquier HTTP) | IMPLEMENTADO/PROBADO/SUBIDO |
| H-002 API sin autenticación | Núcleo auth v2 server-side (pairing ECDSA P-256, challenge single-use, sesiones hash-only, roles deny-by-default, rate limit, revocación); endpoints `/v2/*` registrados; middleware `requireAuthV2`/`requirePermission` listo. **Enforcement en rutas legacy NO activado** (requiere compatibilidad cliente, ver pendientes) | `authV2Service` 11/11 con claves ECDSA reales: replay, expiración, revocación, oracle-resistance | PARCIAL: núcleo IMPLEMENTADO/PROBADO/SUBIDO; enforcement PENDIENTE |
| H-003 active-exchange a Kraken | Ruta rechaza `kraken` (400); setters del factory lanzan `KRAKEN_TRADING_FORBIDDEN`; config persistida coercionada a revolutx fail-closed | `krakenExecutionForbidden` (coerción de config persistida) | IMPLEMENTADO/PROBADO/SUBIDO |
| H-004 fallback silencioso a Kraken | `getExchange('revolutx')` sin inicializar → `VENUE_UNAVAILABLE`; ninguna sustitución de venue | `krakenExecutionForbidden` | IMPLEMENTADO/PROBADO/SUBIDO |
| H-005 executeExit sin guard de modo | Guard estricto `isLiveExecutionMode` (igualdad exacta); no-live ejecuta contabilidad simulada sin contacto con exchange | `idcaModeGuard` 21/21 tabla de verdad con valores corruptos | IMPLEMENTADO/PROBADO/SUBIDO |
| H-006 ticker firmado en planificación GRID | Valoración BTC/USD con referencia pública Kraken vía MarketDataService cache | Compilación + revisión estática; resto del engine grid ya evitaba ticker firmado | IMPLEMENTADO/COMPILADO/SUBIDO |
| H-007 ráfagas/429 LOW_API | Single-flight coalescing en `BalanceCache`; `getWithMeta` con edad real/stale; `getBalance` coalesced | Pendiente test de workload aislado (ver pendientes) | PARCIAL |
| H-016 EMA50 BTC→ETH errónea | EMA50 real de 50 periodos para el score BTC usado en ETH; prevEma50 correcto | `idcaVolumeAndEma` 7/7 (semántica EMA, contrato de indexación) | IMPLEMENTADO/PROBADO/SUBIDO |
| H-017 volumen relativo fijo 1/1 | `computeRelativeVolumeInputs`: vela cerrada medida vs media de ≤20 velas cerradas anteriores excluyendo la medida; vela en formación excluida; si falta volumen, el peso se excluye del score en lugar de alimentar 1/1 | `idcaVolumeAndEma` 7/7 (causalidad, vela en formación, null en datos ausentes) | IMPLEMENTADO/PROBADO/SUBIDO |
| H-025 ventas sin orderId | No tocado: requiere reconciliación privada autorizada contra fills del venue | — | PENDIENTE (autorización separada) |
| H-028 close sin guard TRADING_ENABLED | Cubierto parcialmente por la doctrina de reducción de riesgo: el cierre NO se bloquea; su protección real es la autenticación (pendiente de enforcement) | — | PARCIAL |
| H-033 ExecutionManager sin guard | `executeOrder` exige `mode: "live"` explícito o falla cerrado antes de efectos | `idcaModeGuard` 21/21 | IMPLEMENTADO/PROBADO/SUBIDO |
| H-009/H-020 normalización s/ms en main | No aplicable a esta rama (la corrección ya existe en la base runtime); la convergencia con main es fase separada | — | PENDIENTE (convergencia) |
| H-010…H-013 Market Metrics | No implementado en esta entrega | — | PENDIENTE |
| H-018 velas cerradas/formación | Parcial: el helper de volumen excluye vela en formación; política uniforme por consumidor pendiente | — | PARCIAL |
| H-026/H-027/H-014 retención/legacy/bloat | Fuera de alcance de código; requieren autorización de datos | — | PENDIENTE |
| H-030/031/032 indicadores divergentes | No unificados aún; la corrección de RSI plano y la librería centralizada quedan diseñadas en el plan | — | PENDIENTE |

## Commits en la rama

1. `0da52ee` — P0: prohibición ejecución Kraken + guards de modo estrictos + tests (31 tests nuevos).
2. `14cf539` — P1: LOW_API ticker firmado eliminado + single-flight + correcciones H-016/H-017 + tests (7).
3. `fix(types)` — narrowing de volumen (tsc clean).
4. Auth v2 (este informe lo acompaña en el mismo commit o inmediato posterior).

## Verificación ejecutada

| Comando | Resultado |
|---|---|
| `npx vitest run server/services/__tests__/krakenExecutionForbidden.test.ts` | 10/10 pass |
| `npx vitest run server/services/__tests__/idcaModeGuard.test.ts` | 21/21 pass |
| `npx vitest run server/services/__tests__/idcaVolumeAndEma.test.ts` | 7/7 pass |
| `npx vitest run server/services/authV2/__tests__/authV2Service.test.ts` | 11/11 pass |
| `npx tsc --noEmit` | exit 0 tras las correcciones |
| `npx vitest run` (suite completa) | resultado registrado en la issue; fallos preexistentes vs nuevos distinguidos |

## Límites y pendientes declarados (con siguiente acción exacta)

1. **Enforcement de autenticación en rutas legacy**: el núcleo está probado pero NO se ha activado denegación por defecto en las rutas existentes porque el cliente web actual no autentica; activarlo sin más rompería la UI. Siguiente acción exacta: adaptar el cliente web a `obtainSession()` del contrato v2 (el código cliente ya existe en la rama NEXA), luego montar `requirePermission` por recurso/acción en cada ruta mutativa con la matriz de la Fase 3.9 del plan, con tests E2E de compatibilidad. Mientras tanto, la contención real del acceso sigue siendo la Fase 1 de infraestructura (autorización separada).
2. **Persistencia durable de auth v2**: el store en memoria es correcto para el contrato pero las vinculaciones/sesiones no sobreviven reinicios. Siguiente acción: implementación drizzle expand-only del `AuthV2Store` + migración probada solo en DB desechable.
3. **Reconciliación de fills (OrderIntent durable → fills reconciliados)**: no implementada; es la mayor pieza de ingeniería restante. El guard actual exige orderId para cerrar en live, pero aceptación ≠ fill. Siguiente acción: modelar estados SUBMITTING/PENDING/UNCERTAIN/reconciled sobre los repositorios existentes con la batería de crash/restart/parcial/rechazada.
4. **Test de workload LOW_API** (contar llamadas firmadas en ciclo SHADOW simulado): pendiente; single-flight implementado sin medida de carga aún.
5. **Retry-After/circuit breaker LOW_API**: existe infraestructura de circuit breakers por endpoint en RevolutXService; no se ha verificado ni extendido el respeto de `Retry-After` en el scheduler — pendiente con test T6.
6. **Market Metrics (H-010…H-013)**: sin cambios en esta entrega. Siguiente acción: corrección OI/funding/stale según plan Fase 5.2 con fixtures E-040.
7. **Librería centralizada de indicadores (H-030/031/032)**: pendiente; incluye decisión de RSI plano (caso 100) y medición de impacto real MACD antes de cualquier corrección.
8. **Replay IDCA V2 (#19)**: NO CONCLUYENTE por definición en esta sesión — requiere el dataset privado autorizado y sus manifiestos; no se ha improvisado con datos sintéticos para no presentar simulación como evidencia.
9. **APK/artefactos**: la APK existe en `feature/nexa-v2-transformacion-20261120` pero su backend de auth no existía hasta esta entrega; la integración APK↔backend endurecido y el build firmado requieren entorno de firma del propietario — pendiente declarado, no inventado.
10. **Convergencia main/runtime/nexa**: mapa de divergencias pendiente como fase separada; esta rama no mezcla main.
11. **Contención de infraestructura (Fases 1-2 del plan)**: preparada, NO ejecutada — requiere autorización expresa del propietario (perímetro, credencial Kraken solo-Query).
12. **Riesgos operativos sensibles**: canal privado únicamente; este documento omite detalles de red/topología a propósito.

## Riesgos conocidos de la propia implementación

- `VENUE_UNAVAILABLE` ahora lanza donde antes había fallback silencioso: cualquier camino que llamara `getExchange('revolutx')` con RX no inicializado fallará loud en lugar de operar contra Kraken. Es el comportamiento fail-closed exigido, pero la suite completa de regresión debe confirmar que no rompe arranque ni lecturas legítimas; los resultados se registran en la issue.
- Las sesiones auth v2 en memoria se pierden al reiniciar (documentado; los clientes re-autentican con su clave de dispositivo sin intervención del usuario).
- `executeExit` en simulation ya no registra `exchangeOrderId` (correcto: nunca existió tal orden); consumidores de ese campo deben tolerar null en simulation, como ya hacía el código.

**Nada de lo implementado está activo en producción. Estado final: CANDIDATO PARCIAL IMPLEMENTADO/VALIDADO EN AISLADO — SIN APROBAR PARA PRODUCCIÓN, pendiente de contraauditoría TANGO.**
