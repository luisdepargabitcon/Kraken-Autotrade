# CONTRAAUDITORÍA DE INTEGRACIÓN AMA BTC/ETH/COINMETRICS

**Fecha:** 2026-07-29
**Cambio de alcance:** AMA-CC-2026-07-29-SEED-V2.2
**Autor:** Cascade

---

## 1. Estado real del repositorio

- **Branch:** main
- **HEAD:** 44cd46ff3a6e195556987968a87c8e795d66cd02
- **Origin/main:** 44cd46ff3a6e195556987968a87c8e795d66cd02
- **Tracked modified:** 3 archivos (App.tsx, Nav.tsx, routes.ts)
- **Untracked AMA:** server/services/ama/, server/routes/ama.routes.ts, client/src/pages/Ama.tsx, db/migrations/080_ama_initial.sql, FASES MODO AMA.md, PLAN_IMPLEMENTACION_MODO_AMA.md, scripts/ama_migration_validate.mjs
- **Untracked preexisting:** rev-c11-*, grid_test_out.txt, rev.txt, .cascade-check-runner.cjs, scripts/extract_*.py
- **git diff --check:** limpio

## 2. Estado real de Fase 1

- 080_ama_initial.sql existe: ✅
- Validada en PostgreSQL desechable: ✅ (9 tablas, 10 índices, 17 CHECKs, 11 FKs, 11 negativos, 10 unicidad, idempotencia)
- No activa en AutoMigrationRunner: ✅ (comentada, test gate verificado)
- npm run check: ✅
- npm run build: ✅
- 101 tests AMA: ✅
- Baseline: 31 preexistentes, 0 nuevos
- REAL bloqueado en route y service: ✅
- **Veredicto:** FASE_1_VALIDADA

## 3. Estado parcial de Fase 2

No se inició implementación de Fase 2. El cambio V2.2 detuvo el inicio para incorporar Seed Policies, auditorías y fuentes.

## 4. Archivos importados

Las auditorías `AUDITORIA_AMA_BTC_2026-07-29(1).md` y `AUDITORIA_AMA_ETH_2026-07-29(1).md` no se encontraron físicamente en el repositorio ni en attached_assets. Su contenido está inlineado en la instrucción V2.2 del usuario, que se usa como fuente canónica sustituta.

- **auditPath:** No disponible físicamente. Contenido extraído de instrucción V2.2.
- **auditSha256:** N/A (archivo no disponible)
- **auditVersion:** AMA-CC-2026-07-29-SEED-V2.2
- **auditCutoff:** 2026-07-29
- **importedAt:** 2026-07-29T15:15:00+02:00

## 5. Requisitos coincidentes

| Requisito | Fuente V2.2 | Plan existente | Estado |
|---|---|---|---|
| Contratos temporales UTC | V2.2 §9, §29 | Plan §27 | Compatible |
| HWM persistente | V2.2 §9 | Plan §30 | Requiere expansión |
| Seed Policy BTC | V2.2 §10 | Plan §38 | Requiere expansión |
| Seed Policy ETH | V2.2 §11 | No existe | Nuevo |
| Envelopes | V2.2 §12 | No existe | Nuevo |
| Risk overlay | V2.2 §15 | Plan §41 | Requiere expansión |
| ETH/BTC filter | V2.2 §13 | No existe | Nuevo |
| Eras ETH | V2.2 §14 | No existe | Nuevo |
| Coin Metrics | V2.2 §19-23 | No existe | Nuevo |
| Matriz autoridad | V2.2 §18 | Plan §13 | Requiere expansión |
| Fuentes taxonomía | V2.2 §17 | Plan §11 | Requiere expansión |
| Retención RESEARCH_LONG_TERM | V2.2 §24 | Plan §87-89 | Compatible |
| Salidas LAB_HYPOTHESIS | V2.2 §16 | Plan §55 | Requiere marcado |

## 6. Contradicciones

1. Plan §38 no diferenciaba BTC/ETH Seed Policies → SUPERSEDED_BY_AMA_CC_2026_07_29_SEED_V2_2
2. Plan no mencionaba ETH RESEARCH_ONLY ni aislamiento ETH → Nuevo
3. Plan no mencionaba Coin Metrics → Nuevo
4. Plan §55 salidas tratadas como diseño activo → Requiere marcado LAB_HYPOTHESIS
5. Risk multiplier >1.0 no estaba prohibido → SUPERSEDED

## 7. Omisiones

- Sin eras de protocolo Ethereum
- Sin filtro ETH/BTC
- Sin Coin Metrics (archive, community, pro)
- Sin Seed Policy ETH
- Sin envelopes de calibración
- Sin pipeline ETH separado
- Sin matriz de autoridad por capacidad
- Sin licencia Coin Metrics

## 8. Decisiones de integración

1. Preservar Fase 0 y Fase 1 validadas
2. Expandir Fase 2 a subfases 2A-2L según V2.2 §29
3. Integrar Seed Policies BTC/ETH como contratos canónicos
4. Marcar instrucciones incompatibles como SUPERSEDED_BY_AMA_CC_2026_07_29_SEED_V2_2
5. Usar contenido V2.2 inlineado como sustituto de auditorías no disponibles

## 9. Decisiones de seguridad

- BTC = LAB_ONLY, ETH = RESEARCH_ONLY
- ETH no puede reservar capital, crear intents, ejecutar, ni compartir inventario BTC
- Risk overlay RISK_DOWN_ONLY (max 1.00)
- Coin Metrics decisionImpact = false
- Migración 081 no se registra en AutoMigrationRunner
- Sin commit, push, deploy, migraciones reales

## 10. Seed Policy BTC

- policyId: AMA_BTC_SEED_V1_RESEARCH
- 6 tramos, capital 75%, reserva 25%
- makerOnly: true, takerFallback: false
- fixedReversalCenterPct: 10.0, ATR20 multiplier 3.0
- requiredDailyCloses: 3

## 11. Seed Policy ETH

- policyId: AMA_ETH_SEED_V1_RESEARCH_ONLY
- 7 tramos, capital 65%, reserva 35%
- executionVenue: DISABLED
- ethBtcFilterRequired: true
- fixedReversalCenterPct: 14.0

## 12. Envelopes

- Intervalos de calibración, no bandas simultáneas
- Triggers resueltos únicos y descendentes
- Máximo un tranche por cierre confirmado

## 13. HWM

- authoritativeCycleHwm no puede bajar
- rollingHigh puede bajar
- Estados: CANDIDATE, CONFIRMING, CONFIRMED, FROZEN, SUPERSEDED, INVALIDATED
- Bootstrap = incremental

## 14. Risk overlay

- ACTIVE_SEED_OVERLAY = RISK_DOWN_ONLY
- BTC: 0.50-1.00, ETH: 0.35-1.00
- Challenger 1.25/1.15 = CHALLENGER_RESEARCH_ONLY

## 15. Salidas como hipótesis

- BTC/ETH exits = LAB_HYPOTHESIS, NOT_ACTIVE
- No implementar ejecución en Fase 2

## 16. Matriz de autoridad

Ver V2.2 §18. Kraken = OHLC/HWM/ATR autoritativo. Revolut X = ejecución. Coin Metrics = research-only.

## 17. Coin Metrics

- GitHub Archive: CC-BY-NC-4.0, research-only, no decision impact
- Community API: review required, ingestion disabled by default
- Pro API: DISABLED, NOT_CONFIGURED

## 18. Licencias

- commercialUseStatus = REVIEW_REQUIRED
- decisionImpactAllowed = false

## 19. Frescura

- Verificar lastRowTime, lastCompleteRowTime por métrica
- Estados: FRESH, DELAYED, STALE, PARTIAL, UNAVAILABLE, SCHEMA_DRIFT, REVISION_DETECTED, LICENSE_BLOCKED

## 20. Eras Ethereum

- 7 eras desde PRE_EIP1559 hasta POST_FUSAKA
- Glamsterdam = PLANNED, NOT_ACTIVE
- No calcular totalStakedEth = validatorCount × 32 post-Pectra

## 21. Retención

- RESEARCH_LONG_TERM: no autoeliminar OHLC, HWM, policies, manifests, macro vintages, datasets Replay

## 22. Tests

Ver V2.2 §30. Tests obligatorios por BTC, ETH, envelopes, HWM, risk overlay, Coin Metrics, Ethereum.

## 23. Gates

- commit, push, deploy, migraciones reales: pendientes autorización
- Trabajo local: autorizado

## 24. Tabla de trazabilidad

| Requisito | Fuente | Sección plan | Fase/subfase | Estado | Tests previstos | Gate |
|---|---|---|---|---|---|---|
| Asset profiles | V2.2 §8,29 | Plan §6 | 2A | Pendiente | BTC LAB_ONLY, ETH RESEARCH_ONLY | — |
| Seed Policy BTC | V2.2 §10 | Plan §38 | 2A | Pendiente | 6 tramos, 75/25 | — |
| Seed Policy ETH | V2.2 §11 | Plan §38 | 2A | Pendiente | 7 tramos, 65/35 | — |
| Envelopes | V2.2 §12 | Plan §38 | 2A | Pendiente | triggers únicos descendentes | — |
| Time contract | V2.2 §9,29 | Plan §27 | 2A | Pendiente | UTC, daily boundary | — |
| Data sources | V2.2 §17-18 | Plan §11-13 | 2A | Pendiente | authority/capabilities | — |
| Point-in-time | V2.2 §29 2B | Plan §28 | 2B | Pendiente | timestamp futuro, stale | — |
| Data quality | V2.2 §29 2B | Plan §29 | 2B | Pendiente | OHLC inválido, gap | — |
| Coin Metrics | V2.2 §19-23 | Plan §34 (nuevo) | 2D | Pendiente | hash, frescura, licencia | — |
| HWM persistente | V2.2 §9 | Plan §30 | 2A/9 | Pendiente | no baja, bootstrap=incremental | — |
| ETH/BTC filter | V2.2 §13 | Plan §38 (nuevo) | 2A | Pendiente | stress reduce riesgo | — |
| Eras ETH | V2.2 §14 | Plan §34 (nuevo) | 2F | Pendiente | eras correctas | — |
| Risk overlay | V2.2 §15 | Plan §41 | 2A | Pendiente | max 1.00 | — |
| Salidas LAB | V2.2 §16 | Plan §55 | 14 | Pendiente | NOT_ACTIVE | — |
| Macro PIT | V2.2 §29 2G | Plan §11 | 2G | Pendiente | vintage, revision | — |
| ETF | V2.2 §29 2H | Plan §11 | 2H | Pendiente | SEC holdings | — |
| Derivados | V2.2 §29 2I | Plan §11 | 2I | Pendiente | CME, funding | — |
| L2/DeFi | V2.2 §29 2J | Plan §11 | 2J | Pendiente | L2 settlement | — |
| Dataset manifests | V2.2 §29 2K | Plan §28 | 2K | Pendiente | schemaHash | — |
| Replay readiness | V2.2 §29 2L | Plan §66 | 2L | Pendiente | cero look-ahead | — |

## 25. Veredicto

- Fase 1: VALIDADA con evidencias
- Fase 2: Pendiente de implementación con subfases 2A-2L
- Auditorías: no disponibles físicamente, contenido V2.2 usado como canónico
- Documentos: en proceso de reconstrucción
- Gates: respetados
- Continuidad: autorizada para fases locales seguras
