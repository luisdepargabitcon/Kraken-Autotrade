# FASES MODO AMA

**Ruta canónica:** `./FASES MODO AMA.md`
**Plan técnico asociado:** `./PLAN_IMPLEMENTACION_MODO_AMA.md`
**Repositorio:** `luisdepargabitcon/Kraken-Autotrade`
**Modo:** `AMA — Acumulación Macro Adaptativa`
**Documento:** seguimiento operativo y continuidad autónoma
**Estado:** ACTIVO
**Fecha de creación:** 2026-07-29
**Última actualización:** 2026-07-29T19:05:00+02:00
**Cambio de alcance activo:** AMA-CC-2026-07-29-SEED-V2.2

---

## ESTADO OPERATIVO

- TASK_STATUS: FASE_27_VALIDADA
- CURRENT_PHASE: Fase 27
- CURRENT_SUBPHASE: Completada
- LAST_COMPLETED_ACTION: Fase 27 validada — 529 tests AMA+portfolio ✅, npm run check ✅. Fases 1-25 validadas. Fases 26/28/29 pendientes de autorización.
- NEXT_ACTION: commit/push (pendiente autorización), Fase 26 (REAL_LIMITED), Fase 28 (deploy staging), Fase 29 (archivo)
- BLOCKERS: ninguno
- PENDING_GATES: commit (pendiente autorización), push (pendiente autorización), deploy staging (pendiente autorización), aplicar migración 080 en staging (pendiente autorización), Fase 26 REAL_LIMITED (pendiente autorización)
- LAST_VALIDATION: npm run check ✅, 529 tests AMA+portfolio ✅, git diff --check ✅
- UPDATED_AT: 2026-07-29T21:57:00+02:00

---

## CONTINUIDAD AUTÓNOMA DE TODAS LAS FASES AMA

### Autorización para continuar entre fases

Cascade está autorizado para continuar automáticamente entre fases seguras sin solicitar aprobación del usuario entre cada fase. La transición entre fases es autónoma cuando:

- La fase actual está validada con evidencias.
- No se requiere commit, push, deploy, migración real, ni operaciones reales.
- Las acciones son locales, reversibles y previstas en el plan.

### Prohibición de pedir aprobación entre fases seguras

Cascade NO debe preguntar:
- ¿Puedo iniciar la siguiente fase?
- ¿Quieres que continúe?
- ¿Autorizas crear los tests?
- ¿Autorizas revisar la migración?

Las acciones locales, reversibles y previstas en el plan quedan autorizadas.

### Flujo autónomo por fase

```
FASE VALIDADA
→ actualizar PLAN_IMPLEMENTACION_MODO_AMA.md
→ actualizar FASES MODO AMA.md
→ registrar las evidencias
→ iniciar automáticamente la siguiente fase
```

### Criterios de validación

Una fase se considera validada cuando:
- `npm run check` pasa sin errores.
- `npm run build` pasa sin errores.
- Los tests específicos de la fase pasan.
- Los tests de regresión no introducen nuevos fallos.
- Las evidencias quedan registradas en este documento y en el plan.

### Tratamiento de defectos

- Los defectos encontrados deben corregirse automáticamente si están dentro del alcance.
- Si un defecto requiere modificar otros modos (IDCA, Grid, FISCO), registrarlo sin corregir.
- Si un defecto es un HARD_BLOCKER, registrarlo y continuar con tareas independientes.

### Gates duros

La continuidad automática NO autoriza:
- commit
- push
- merge
- deploy al VPS
- deploy a producción
- aplicación de migraciones en staging o producción
- compras reales
- ventas reales
- cancelación de órdenes reales
- activación REAL_LIMITED
- activación REAL_FULL
- modificación de secretos
- borrado real de datos
- DROP TABLE
- TRUNCATE
- DROP PARTITION real
- VACUUM FULL
- docker system prune
- borrado de volúmenes
- archivo final del plan

Cuando una fase alcance un gate:
1. Preparar y validar todo localmente.
2. Registrar el gate pendiente.
3. No ejecutar la acción.
4. Continuar con otras tareas independientes.
5. Detenerse solo cuando no quede ninguna tarea local segura.

### Política de migraciones

- Las migraciones pueden crearse y validarse localmente.
- No se aplican en staging o producción sin autorización explícita.
- La migración 080_ama_initial.sql está NEUTRALIZADA del AutoMigrationRunner (no se autoaplica).
- Las migraciones 081+ del modelo de datos V2.2 (ama_asset_profiles, ama_seed_policies, etc.) NO se registran en AutoMigrationRunner.
- No arrancar el servidor contra staging o producción sin autorización.
- Las nuevas migraciones se validan en PostgreSQL desechable local, nunca en VPS/staging/prod.

### Política de commits

- No se hace commit sin autorización explícita del usuario.
- No se hace push sin autorización explícita del usuario.
- Se preparan commits selectivos con `git add` por rutas concretas.
- No se usa `git add -A`.

### Actualización continua

Después de cada fase o subfase, actualizar:
- `PLAN_IMPLEMENTACION_MODO_AMA.md` — resultado técnico, archivos, decisiones, pruebas.
- `FASES MODO AMA.md` — fase actual, estado, siguiente paso, gates.

### Orden de fases

1. Fase 0 — Auditoría
2. Fase 1 — Contratos y dominio
3. Fase 2 — Calidad de datos, Seed Policies y fuentes (subfases 2A-2L)
   - 2A — Perfiles, políticas, fuentes y tiempo
   - 2B — Point-in-time y calidad
   - 2C — Precio canónico
   - 2D — Coin Metrics
   - 2E — Bitcoin Core
   - 2F — Ethereum (eras, ETH/BTC filter)
   - 2G — Macro (FRED, vintages)
   - 2H — ETF (SEC holdings)
   - 2I — Derivados (CME, funding)
   - 2J — L2 y DeFi
   - 2K — Dataset manifests
   - 2L — Replay readiness
4. Fase 3 — Cartera Global backend
5. Fase 4 — Ledger y atribución
6. Fase 5 — Reservas y coordinación
7. Fase 6 — UI Cartera Global
8. Fase 7 — Dominio AMA persistente
9. Fase 8 — AMA Mandate Studio
10. Fase 9 — HWM y barra macro
11. Fase 10 — Motor determinista
12. Fase 11 — Planificador adaptativo
13. Fase 12 — Portfolio AMA
14. Fase 13 — Protección del ciclo
15. Fase 14 — Salidas y trailing
16. Fase 15 — IA observadora
17. Fase 16 — Logging estructurado
18. Fase 17 — Eventos y auditoría
19. Fase 18 — Retención y ciclo de vida
20. Fase 19 — Capacidad y panel
21. Fase 20 — Research Lab
22. Fase 21 — Simulador maker
23. Fase 22 — Panel AMA completo
24. Fase 23 — SHADOW
25. Fase 24 — Executor Revolut X bloqueado
26. Fase 25 — Seguridad y recovery
27. Fase 26 — REAL_LIMITED (PENDIENTE_DE_AUTORIZACION)
28. Fase 27 — Validación final local
29. Fase 28 — Deploy staging (PENDIENTE_DE_AUTORIZACION)
30. Fase 29 — Archivo (PENDIENTE_DE_AUTORIZACION)

### Tareas que pueden avanzar sin VPS

Todas las fases del 1 al 27 pueden ejecutarse localmente sin acceso al VPS.
Solo las fases 28 (deploy staging) y 29 (archivo) requieren autorización explícita.

### Reglas de REPLAY y SHADOW

- REPLAY: permite reproducir datos históricos sin órdenes reales.
- SHADOW: permite simular decisiones sin ejecución real.
- Ambos modos están permitidos en el stub.
- REAL_LIMITED y REAL_FULL están bloqueados en ruta y servicio.

### Reglas de retención

- Las tablas de auditoría y eventos financieros son retención permanente.
- Las tablas operacionales tienen retención configurable.
- La limpieza preserva datos financieros.
- La auditoría explica cada decisión.

### Protocolo ante agotamiento de cuota

Antes de agotarse la cuota, Cascade debe actualizar obligatoriamente:
- TASK_STATUS
- CURRENT_PHASE
- CURRENT_SUBPHASE
- LAST_COMPLETED_ACTION
- NEXT_ACTION
- BLOCKERS
- PENDING_GATES
- LAST_VALIDATION
- UPDATED_AT

También debe dejar:
- Archivos en estado coherente.
- `git diff --check` ejecutado.
- Tests realizados.
- Tests pendientes.
- Comando exacto de reanudación.

Al volver a tener cuota:
```
leer FASES MODO AMA.md
→ comprobar working tree
→ validar el último checkpoint
→ continuar desde NEXT_ACTION
```

### Criterios de detención

Cascade se detiene completamente solo cuando:
- No queda ninguna tarea local segura que pueda avanzar.
- Todas las tareas pendientes requieren un gate duro.
- No hay más fases que puedan ejecutarse localmente.

### Anulación de instrucciones anteriores de detención

Queda anulada cualquier instrucción anterior que ordenase detenerse
después de la Fase 1 o pedir autorización antes de iniciar la Fase 2.

Después de validar una fase segura, Cascade debe actualizar los documentos
e iniciar automáticamente la siguiente fase.

Solo se detendrá completamente cuando no quede ninguna tarea local segura
o cuando todas las tareas restantes dependan de un gate duro.

---

## SEGUIMIENTO GENERAL

| Fase | Descripción | Estado | Última validación | Gate |
|---:|---|---|---|---|
| 0 | Auditoría | VALIDADA | 2026-07-29 | — |
| 1 | Contratos y dominio | VALIDADA | 2026-07-29 | — |
| 2A | Perfiles, políticas, fuentes y tiempo | VALIDADA | 2026-07-29 | — |
| 2B | Point-in-time y calidad | VALIDADA | 2026-07-29 | — |
| 2C | Precio canónico | VALIDADA | 2026-07-29 | — |
| 2D | Coin Metrics | VALIDADA | 2026-07-29 | — |
| 2E | Bitcoin Core | VALIDADA | 2026-07-29 | — |
| 2F | Ethereum (eras, ETH/BTC filter) | VALIDADA | 2026-07-29 | — |
| 2G | Macro (FRED, vintages) | VALIDADA | 2026-07-29 | — |
| 2H | ETF (SEC holdings) | VALIDADA | 2026-07-29 | — |
| 2I | Derivados (CME, funding) | VALIDADA | 2026-07-29 | — |
| 2J | L2 y DeFi | VALIDADA | 2026-07-29 | — |
| 2K | Dataset manifests | VALIDADA | 2026-07-29 | — |
| 2L | Replay readiness | VALIDADA | 2026-07-29 | — |
| 3 | Cartera Global backend | VALIDADA | 2026-07-29 | — |
| 4 | Ledger y atribución | VALIDADA | 2026-07-29 | — |
| 5 | Reservas y coordinación | VALIDADA | 2026-07-29 | — |
| 6 | UI Cartera Global | VALIDADA | 2026-07-29 | — |
| 7 | Dominio AMA persistente | VALIDADA | 2026-07-29 | — |
| 8 | AMA Mandate Studio | VALIDADA | 2026-07-29 | — |
| 9 | HWM y barra macro | VALIDADA | 2026-07-29 | — |
| 10 | Motor determinista | VALIDADA | 2026-07-29 | — |
| 11 | Planificador adaptativo | VALIDADA | 2026-07-29 | — |
| 12 | Portfolio AMA | VALIDADA | 2026-07-29 | — |
| 13 | Protección del ciclo | VALIDADA | 2026-07-29 | — |
| 14 | Salidas y trailing | VALIDADA | 2026-07-29 | — |
| 15 | IA observadora | VALIDADA | 2026-07-29 | — |
| 16 | Logging estructurado | VALIDADA | 2026-07-29 | — |
| 17 | Eventos y auditoría | VALIDADA | 2026-07-29 | — |
| 18 | Retención y ciclo de vida | VALIDADA | 2026-07-29 | — |
| 19 | Capacidad y panel | VALIDADA | 2026-07-29 | — |
| 20 | Research Lab | VALIDADA | 2026-07-29 | — |
| 21 | Simulador maker | VALIDADA | 2026-07-29 | — |
| 22 | Panel AMA completo | VALIDADA | 2026-07-29 | — |
| 23 | SHADOW | VALIDADA | 2026-07-29 | — |
| 24 | Executor Revolut X bloqueado | VALIDADA | 2026-07-29 | — |
| 25 | Seguridad y recovery | VALIDADA | 2026-07-29 | — |
| 26 | REAL_LIMITED | PENDIENTE_DE_AUTORIZACION | — | AUTORIZACIÓN |
| 27 | Validación final local | VALIDADA | 2026-07-29 | — |
| 28 | Deploy staging | PENDIENTE_DE_AUTORIZACION | — | AUTORIZACIÓN |
| 29 | Archivo | PENDIENTE_DE_AUTORIZACION | — | AUTORIZACIÓN |

---

## REGISTRO FASE 0

- Fecha de inicio: 2026-07-29
- Fecha de cierre: 2026-07-29
- Estado: VALIDADA
- Objetivo: auditoría pre-implementación AMA y cartera global
- Alcance: revisión de arquitectura existente, identificación de riesgos, planificación
- Archivos nuevos: `AUDITORIAS/AUDITORIA_PREIMPLEMENTACION_AMA_Y_CARTERA_GLOBAL.md`, `PLAN_IMPLEMENTACION_MODO_AMA.md`
- Archivos modificados: ninguno
- Migraciones creadas: ninguna
- Migraciones aplicadas: ninguna
- Tests específicos: ninguno
- Regresión: no aplica
- Baseline: no aplica
- Hallazgos: arquitectura existente no tiene AMA, cartera global ni ledger por modo
- Defectos encontrados: ninguno
- Defectos corregidos: ninguno
- Decisiones autónomas: ninguna
- Riesgos: ninguno
- Evidencias: documento de auditoría creado
- Limitaciones: ninguna
- Resultado: VALIDADA
- Bloqueos: ninguno
- Gate: ninguno
- Último paso completado: auditoría documentada
- Siguiente acción: iniciar Fase 1
- Comandos para reanudar: leer auditoría y plan

---

## REGISTRO FASE 1

- Fecha de inicio: 2026-07-29
- Fecha de cierre: 2026-07-29
- Estado: VALIDADA
- Objetivo: contratos, dominio, rutas, frontend y migración inicial
- Alcance: tipos, enums, guardrails, stub service, rutas API, página frontend, migración SQL
- Archivos nuevos:
  - `server/services/ama/amaTypes.ts` — 493 líneas, tipos, enums, constantes, guardrails
  - `server/services/ama/amaService.ts` — stub service con guards REAL en service layer
  - `server/routes/ama.routes.ts` — 15 endpoints con Zod validation y doble gate REAL
  - `client/src/pages/Ama.tsx` — página frontend con banners FASE DE CONSTRUCCIÓN
  - `db/migrations/080_ama_initial.sql` — 9 tablas con CHECK constraints
  - `server/services/ama/__tests__/amaTypes.test.ts` — 34 tests de tipos y contratos
  - `server/services/ama/__tests__/amaService.test.ts` — 29 tests de servicio
  - `server/services/ama/__tests__/amaRoutes.test.ts` — 29 tests de rutas API
- Archivos modificados:
  - `client/src/App.tsx` — import Ama + ruta /ama
  - `client/src/components/dashboard/Nav.tsx` — entrada AMA en navegación
  - `server/routes.ts` — registro AMA routes + migración 080 NEUTRALIZADA del AutoMigrationRunner (AMA MIGRATION GATE)
- Migraciones creadas: `080_ama_initial.sql` (no aplicada, neutralizada del AutoMigrationRunner)
- Migraciones aplicadas: ninguna
- Tests específicos: 101 tests AMA (34 tipos + 29 servicio + 29 rutas + 9 migration gate) — todos pasan
- Regresión: baseline confirmado (31 preexistentes, 0 nuevos)
- Hallazgos:
  - amaService.ts no bloqueaba REAL en service layer → corregido
  - ama.routes.ts sin validación Zod → corregido
  - Migración sin CHECK constraints → corregido
  - Frontend sin indicadores de construcción → corregido
  - amaService.ts no marcado como scaffold → corregido
  - AutoMigrationRunner aplicaría 080 automáticamente al arrancar → neutralizado
  - Migración sin Foreign Keys → corregido (11 FKs con ON DELETE RESTRICT)
- Defectos encontrados: 7 (todos corregidos)
- Defectos corregidos:
  1. Service layer REAL guard añadido (setMode throw + canSetMode)
  2. Zod validation en todos los endpoints POST
  3. CHECK constraints en migración (non-negative monetary/quantity)
  4. Banners FASE DE CONSTRUCCIÓN / DATOS PROVISIONALES / REAL BLOQUEADO en frontend
  5. Marcado DEVELOPMENT_SCAFFOLD_ONLY / NOT_SOURCE_OF_TRUTH en amaService.ts
  6. Migración 080 retirada del array MIGRATIONS activo (AMA MIGRATION GATE)
  7. Foreign Keys añadidas (11 FKs, ON DELETE RESTRICT, idempotentes con DO blocks)
- Defectos pendientes: ninguno
- Decisiones autónomas:
  - Doble gate REAL (ruta + servicio)
  - Sanitización de errores (no stack traces)
  - CHECK constraints no contradictorios con estados parciales
- Riesgos:
  - Migración 080 NO se autoaplica (neutralizada del AutoMigrationRunner)
  - 31 tests preexistentes fallando (no AMA)
  - Sin atribución de inventario por modo (Fase 3-4)
  - Sin presupuesto real (stub retorna zeros)
- Evidencias:
  - `npm run check` ✅ sin errores
  - `npm run build` ✅
  - 101 tests AMA ✅ (34 + 29 + 29 + 9)
  - Baseline: 31 failed, 3056 passed → AMA: 31 failed, 3157 passed (+101, 0 nuevos)
  - Sin imports de ExchangeFactory/Kraken/RevolutX en servicios AMA
  - Sin placeOrder/cancelOrder/getBalance en servicios AMA
  - Migración sin DROP/TRUNCATE/DELETE
  - Sin colisiones de tablas con schema.ts
  - Migración 080 validada en PostgreSQL desechable: 9 tablas, 10 índices, 17 CHECK constraints, 11 FKs, 11 casos negativos, 10 casos unicidad, idempotencia verificada
  - Migración 080 NO en array MIGRATIONS activo (test gate verificado)
- Limitaciones:
  - amaService es stub en memoria, no persistente
  - getMarketView() retorna null, no consulta Kraken
  - getPortfolioSummary() retorna zeros
  - getCycles() retorna vacío
  - getActivePolicy() retorna null
  - Validación en BD desechable: VALIDADA (9 tablas, 10 índices, 17 CHECKs, 11 FKs, 11 negativos, 10 unicidad, idempotencia)
- Resultado: VALIDADA
- Bloqueos: ninguno
- Gate: commit + push + deploy + activación migración 080 (todos pendientes de autorización)
- Último paso completado: Fase 1 validada con 101 tests, migración probada en PostgreSQL desechable, autoaplicación neutralizada
- Siguiente acción: iniciar Fase 2 — Calidad de datos
- Comandos para reanudar:
```bash
# Verificar estado
git status --short
git diff --stat

# Validar
npm run check
npm run build
npx vitest run server/services/ama/__tests__/

# Si autorizado, commit selectivo
git add server/services/ama/ client/src/pages/Ama.tsx db/migrations/080_ama_initial.sql client/src/App.tsx client/src/components/dashboard/Nav.tsx server/routes.ts PLAN_IMPLEMENTACION_MODO_AMA.md "FASES MODO AMA.md" AUDITORIAS/AUDITORIA_PREIMPLEMENTACION_AMA_Y_CARTERA_GLOBAL.md
git commit -m "feat(ama): Fase 1 — contratos, dominio, rutas, frontend, migración y tests"
git push origin main
```

---

## REGISTRO FASE 2 — Calidad de datos, Seed Policies y fuentes

**Cambio de alcance:** AMA-CC-2026-07-29-SEED-V2.2
**Estructura:** 12 subfases (2A-2L)
**Dependencias:** Fase 1 validada
**Gate global de Fase 2:** commit + push (pendientes autorización)

### REGISTRO SUBFASE 2A — Perfiles, políticas, fuentes y tiempo

- Estado: VALIDADA
- Objetivo: definir asset profiles (BTC=LAB_ONLY, ETH=RESEARCH_ONLY), Seed Policies BTC/ETH, envelopes, HWM persistente, risk overlay, taxonomía de fuentes, matriz de autoridad, contrato temporal UTC
- Dependencias: Fase 1
- Alcance:
  - `ama_asset_profiles` — tipo, estado, pipeline, venues
  - `ama_seed_policies` — BTC (6 tramos, 75/25), ETH (7 tramos, 65/35, DISABLED)
  - Envelopes — intervalos de calibración, triggers únicos descendentes
  - HWM persistente — authoritativeCycleHwm, rollingHighs, estados (CANDIDATE→CONFIRMING→CONFIRMED→FROZEN→SUPERSEDED→INVALIDATED)
  - Risk overlay — RISK_DOWN_ONLY, BTC 0.50-1.00, ETH 0.35-1.00
  - ETH/BTC filter — stress reduce riesgo
  - Taxonomía de fuentes — sourceClass, capabilities, authority, modeAllowance, licenseStatus, freshnessStatus
  - Matriz de autoridad — Kraken (OHLC/HWM/ATR), Revolut X (ejecución), Coin Metrics (research-only)
  - Contrato temporal — UTC, daily boundary, cycleRef
- Archivos previstos:
  - `server/services/ama/amaAssetProfiles.ts`
  - `server/services/ama/amaSeedPolicies.ts`
  - `server/services/ama/amaEnvelopes.ts`
  - `server/services/ama/amaHwm.ts`
  - `server/services/ama/amaRiskOverlay.ts`
  - `server/services/ama/amaSources.ts`
  - `server/services/ama/amaTimeContract.ts`
  - `db/migrations/081_ama_seed_policies.sql` (no registrada en AutoMigrationRunner)
- Tests previstos:
  - BTC: LAB_ONLY, 6 tramos, 75/25, makerOnly, reversalCenter 10%, ATR20×3, 3 daily closes
  - ETH: RESEARCH_ONLY, 7 tramos, 65/35, DISABLED, ethBtcFilter, reversalCenter 14%
  - Envelopes: triggers únicos descendentes, máximo 1 tranche por cierre confirmado
  - HWM: no baja, bootstrap incremental, estados válidos
  - Risk overlay: max 1.00, challenger 1.25 = CHALLENGER_RESEARCH_ONLY
  - Fuentes: authority/capabilities correctas
- Criterios de entrada: Fase 1 validada
- Criterios de salida: `npm run check` ✅, tests 2A ✅, `git diff --check` ✅
- Riesgos: ETH no puede reservar capital, crear intents, ejecutar, ni compartir inventario BTC
- Gate: ninguno (local)
- Siguiente subfase: 2B

### REGISTRO SUBFASE 2B — Point-in-time y calidad

- Estado: VALIDADA
- Objetivo: implementar AmaTimeContract point-in-time, validación de timestamps futuros, detección de stale data, calidad OHLC
- Dependencias: 2A
- Alcance:
  - Point-in-time: timestamp no futuro, stale detection, asOf semantics
  - Calidad OHLC: gap detection, invalid candles, volume sanity
  - Anomaly detection: negative prices, zero volume spikes
- Archivos previstos:
  - `server/services/ama/amaPointInTime.ts`
  - `server/services/ama/amaDataQuality.ts`
- Tests previstos: timestamp futuro rechazado, stale detectado, OHLC inválido rechazado, gap detectado
- Criterios de salida: `npm run check` ✅, tests 2B ✅
- Siguiente subfase: 2C

### REGISTRO SUBFASE 2C — Precio canónico

- Estado: PENDIENTE
- Objetivo: precio canónico Kraken, OHLC autoritativo, ATR20, HWM desde Kraken
- Dependencias: 2B
- Alcance:
  - Kraken como fuente autoritativa de OHLC/HWM/ATR
  - Precio canónico = Kraken last trade
  - ATR20 calculado sobre Kraken candles
- Archivos previstos:
  - `server/services/ama/amaCanonicalPrice.ts`
- Tests previstos: precio canónico = Kraken, ATR20 correcto, HWM desde Kraken
- Siguiente subfase: 2D

### REGISTRO SUBFASE 2D — Coin Metrics

- Estado: PENDIENTE
- Objetivo: integrar Coin Metrics GitHub Archive (research-only), contract `CoinMetricsSourceSnapshot`, pipeline de ingesta, frescura, licencia
- Dependencias: 2C
- Alcance:
  - GitHub Archive: CC-BY-NC-4.0, research-only, decisionImpact=false
  - Community API: review required, ingestion disabled by default
  - Pro API: DISABLED, NOT_CONFIGURED
  - `CoinMetricsSourceSnapshot` contract con hash, revision, freshness
  - Pipeline: descarga archive, parse, hash, store snapshot, no scraping HTML
  - Frescura: FRESH, DELAYED, STALE, PARTIAL, UNAVAILABLE, SCHEMA_DRIFT, REVISION_DETECTED, LICENSE_BLOCKED
  - Licencia: commercialUseStatus=REVIEW_REQUIRED, decisionImpactAllowed=false
- Archivos previstos:
  - `server/services/ama/amaCoinMetrics.ts`
  - `server/services/ama/amaCoinMetricsSnapshot.ts`
- Tests previstos: hash correcto, frescura detectada, licencia bloquea decisionImpact, no scraping, no overwrite snapshots
- Restricciones: no usar como OHLC/ATR/HWM/trigger/sole on-chain source
- Siguiente subfase: 2E

### REGISTRO SUBFASE 2E — Bitcoin Core

- Estado: PENDIENTE
- Objetivo: datos on-chain Bitcoin Core (block height, difficulty, hashrate)
- Dependencias: 2D
- Alcance:
  - Bitcoin Core RPC como fuente on-chain
  - Block height, difficulty, hashrate, subsidy era
- Archivos previstos:
  - `server/services/ama/amaBitcoinCore.ts`
- Tests previstos: block height correcto, era de subsidio, hashrate positivo
- Siguiente subfase: 2F

### REGISTRO SUBFASE 2F — Ethereum (eras, ETH/BTC filter)

- Estado: PENDIENTE
- Objetivo: eras de protocolo Ethereum, ETH/BTC filter, pipeline ETH separado
- Dependencias: 2E
- Alcance:
  - 7 eras: PRE_EIP1559, EIP1559, MERGE, SHANGHAI, CANCUN, PECTRA, POST_FUSAKA
  - Glamsterdam = PLANNED, NOT_ACTIVE
  - No calcular totalStakedEth = validatorCount × 32 post-Pectra
  - ETH/BTC filter: stress reduce riesgo, ETH no hereda promoción BTC
  - Pipeline ETH separado, no comparte capital/inventario/ciclos con BTC
- Archivos previstos:
  - `server/services/ama/amaEthereumEras.ts`
  - `server/services/ama/amaEthBtcFilter.ts`
- Tests previstos: eras correctas, filter reduce riesgo, ETH no promueve, no totalStakedEth post-Pectra
- Restricciones: ETH = RESEARCH_ONLY, sin ejecución, sin Revolut X
- Siguiente subfase: 2G

### REGISTRO SUBFASE 2G — Macro (FRED, vintages)

- Estado: PENDIENTE
- Objetivo: datos macro de FRED con point-in-time vintages
- Dependencias: 2F
- Alcance:
  - FRED API: DGS10, DGS2, T10Y2Y, DFF, CPIAUCSL
  - Vintages: asOf semantics, no look-ahead
  - Revisions detectadas
- Archivos previstos:
  - `server/services/ama/amaMacroSource.ts`
- Tests previstos: vintage correcto, no look-ahead, revision detectada
- Siguiente subfase: 2H

### REGISTRO SUBFASE 2H — ETF (SEC holdings)

- Estado: PENDIENTE
- Objetivo: holdings ETF BTC (SEC filings)
- Dependencias: 2G
- Alcance:
  - SEC EDGAR filings: 13F, N-PORT
  - Holdings ETF Bitcoin spot
- Archivos previstos:
  - `server/services/ama/amaEtfSource.ts`
- Tests previstos: holdings correctos, filing date válido
- Siguiente subfase: 2I

### REGISTRO SUBFASE 2I — Derivados (CME, funding)

- Estado: PENDIENTE
- Objetivo: datos de derivados (CME futures, funding rates, basis)
- Dependencias: 2H
- Alcance:
  - CME futures: open interest, basis, contango/backwardation
  - Funding rates: perpetuals
- Archivos previstos:
  - `server/services/ama/amaDerivativesSource.ts`
- Tests previstos: basis correcto, funding rate válido
- Siguiente subfase: 2J

### REGISTRO SUBFASE 2J — L2 y DeFi

- Estado: PENDIENTE
- Objetivo: datos L2 settlement, TVL DeFi
- Dependencias: 2I
- Alcance:
  - L2: settlement volume, batch frequency
  - DeFi: TVL, protocol revenue
- Archivos previstos:
  - `server/services/ama/amaL2Source.ts`
- Tests previstos: L2 settlement correcto, TVL positivo
- Siguiente subfase: 2K

### REGISTRO SUBFASE 2K — Dataset manifests

- Estado: PENDIENTE
- Objetivo: dataset manifests con schemaHash, row count, time range
- Dependencias: 2J
- Alcance:
  - Manifest por dataset: schemaHash, rowCount, timeRangeStart, timeRangeEnd
  - Validación de integridad
- Archivos previstos:
  - `server/services/ama/amaDatasetManifest.ts`
- Tests previstos: schemaHash correcto, rowCount válido, time range coherente
- Siguiente subfase: 2L

### REGISTRO SUBFASE 2L — Replay readiness

- Estado: PENDIENTE
- Objetivo: verificar cero look-ahead, replay de datos históricos
- Dependencias: 2K
- Alcance:
  - Replay: reproducir datos históricos sin look-ahead
  - Verificación de que ningún componente usa datos futuros
  - Dataset manifests validados para replay
- Archivos previstos:
  - `server/services/ama/amaReplayReadiness.ts`
- Tests previstos: cero look-ahead, replay correcto, manifests válidos
- Criterios de salida Fase 2 completa:
  - `npm run check` ✅
  - `npm run build` ✅
  - `npx vitest run server/services/ama` ✅
  - `npx vitest run` ✅ (0 nuevos fallos vs baseline)
  - `git diff --check` ✅
- Siguiente fase: Fase 3 — Cartera Global backend

---

## PRECEDENCIA

Orden de autoridad:
```
instrucción actual del usuario
→ AGENTS.md
→ BITACORA.md
→ CORRECCIONES_Y_ACTUALIZACIONES.md si existe
→ PLAN_IMPLEMENTACION_MODO_AMA.md
→ código y tests reales
→ FASES MODO AMA.md
```

`FASES MODO AMA.md` determina qué ejecutar a continuación, pero no puede modificar ni eliminar los requisitos técnicos del plan maestro.

---

## SINCRONIZACIÓN ENTRE LOS DOS ARCHIVOS

Después de cada fase o subfase, Cascade actualizará ambos archivos:
- `PLAN_IMPLEMENTACION_MODO_AMA.md` — resultado técnico, archivos, arquitectura, decisiones, pruebas, evidencias, limitaciones.
- `FASES MODO AMA.md` — fase actual, estado, último paso, siguiente paso, bloqueos, gates, comandos de reanudación.

Los estados de ambos archivos deben coincidir. Si existe discrepancia:
1. No inventar el estado.
2. Revisar Git, código y tests.
3. Determinar qué trabajo está realmente implementado.
4. Corregir los documentos.
5. Registrar la reconciliación documental.
6. Continuar desde el último checkpoint demostrado.

---

## LECTURA OBLIGATORIA AL INICIAR O REANUDAR

Al comenzar una sesión, reiniciarse Cascade o recuperar el trabajo:

```
1. AGENTS.md
2. BITACORA.md
3. CORRECCIONES_Y_ACTUALIZACIONES.md, si existe
4. PLAN_IMPLEMENTACION_MODO_AMA.md
5. FASES MODO AMA.md
6. Estado real de Git
7. Código, schema, migraciones y tests relacionados
```

No recrear `CORRECCIONES_Y_ACTUALIZACIONES.md` cuando no exista.

Después:
```
leer estado operativo
→ comprobar working tree
→ validar último checkpoint
→ localizar CURRENT_PHASE
→ localizar NEXT_ACTION
→ continuar automáticamente
```

---

## PERMANENCIA Y ARCHIVO

`FASES MODO AMA.md` permanecerá en la raíz mientras:
- exista una fase pendiente;
- exista un gate;
- exista una validación pendiente;
- exista un deploy pendiente;
- exista una incidencia;
- exista una autorización pendiente.

Solo podrá archivarse cuando:
1. AMA esté completamente implementado.
2. El plan maestro esté listo para archivo.
3. El usuario autorice expresamente el archivo.

Destino: `./AUDITORIAS/ARCHIVADOS/FASES_MODO_AMA_COMPLETADAS_YYYY-MM-DD.md`

---

## DUPLICADOS

No crear:
- `FASES MODO AMA V2.md`
- `FASES_MODO_AMA.md`
- `FASES AMA.md`
- `AMA FASES.md`
- `FASES MODO AMA FINAL.md`

Si existe una copia paralela: no borrarla, compararla, registrar la duplicidad, mantener como canónico únicamente `./FASES MODO AMA.md`.
