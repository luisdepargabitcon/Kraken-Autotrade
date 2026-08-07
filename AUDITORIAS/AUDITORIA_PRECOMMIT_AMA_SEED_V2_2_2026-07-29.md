# AUDITORÍA PRECOMMIT AMA SEED V2.2 — 2026-07-30

## Metadatos

- **Rama:** `review/ama-seed-v2-2-20260729`
- **Base SHA:** `44cd46ff3a6e195556987968a87c8e795d66cd02`
- **Origin/main:** `44cd46ff3a6e195556987968a87c8e795d66cd02`
- **Fecha:** 2026-07-30T00:35:00+02:00
- **Veredicto:** APTO_PARA_COMMIT_EN_RAMA_DE_REVISION

---

## 1. Inventario de archivos

### TRACKED_MODIFIED (3 archivos)
| Archivo | Cambio | Justificación |
|---|---|---|
| `client/src/App.tsx` | +4 líneas | Routing a página AMA |
| `client/src/components/dashboard/Nav.tsx` | +3/-1 | Nav link a AMA |
| `server/routes.ts` | +19/-1 | Mount rutas AMA y portfolio; migración 080 comentada |

### UNTRACKED_AMA (62 archivos nuevos)
- **Servicios AMA (27):** `server/services/ama/*.ts`
- **Tests AMA (21):** `server/services/ama/__tests__/*.test.ts`
- **Servicios Portfolio (4):** `server/services/portfolio/*.ts`
- **Tests Portfolio (3):** `server/services/portfolio/__tests__/*.test.ts`
- **Rutas (2):** `server/routes/ama.routes.ts`, `server/routes/portfolio.routes.ts`
- **UI (2):** `client/src/pages/Ama.tsx`, `client/src/components/portfolio/PortfolioGlobalPanel.tsx`
- **Migración (1):** `db/migrations/080_ama_initial.sql`
- **Script (1):** `scripts/ama_migration_validate.mjs`
- **Documentación (4):** `FASES MODO AMA.md`, `PLAN_IMPLEMENTACION_MODO_AMA.md`, 2 auditorías

### UNTRACKED_PREEXISTING_AJENO (excluidos del commit)
- `.cascade-check-runner.cjs`, `grid_test_out.txt`, `rev.txt`
- `scripts/extract_grid_audit.py`, `scripts/extract_grid_status.py`
- `AUDITORIAS/rev-c11-*`, `AUDITORIAS/build-*`, `AUDITORIAS/test-rev-c11.txt`

---

## 2. Alcance

Todo el diff corresponde exclusivamente a AMA y Cartera Global. No hay modificaciones en:
- GRID, IDCA, SPOT, Telegram, FISCO
- Exchange adapters compartidos
- Docker, VPS, credenciales
- Producción

---

## 3. Matriz de fases

| Fase | Objetivo | Estado | Tests | Evidencia |
|---|---|---|---|---|
| 0-2 | Docs, validación, tipos, fuentes | COMPLETADA | 49+ | amaSeedTypes, amaSources2D2L, amaTypes |
| 3 | Cartera Global backend | COMPLETADA | 25 | portfolioGlobal |
| 4 | Ledger y atribución | COMPLETADA | 18 | portfolioLedger |
| 5 | Reservas y coordinación | COMPLETADA | 16 | portfolioReservations |
| 6 | UI Cartera Global | COMPLETADA | — | PortfolioGlobalPanel.tsx |
| 7 | Dominio AMA persistente | COMPLETADA | 28 | amaDomainPersistent |
| 8 | AMA Mandate Studio | COMPLETADA | 26 | amaMandateStudio |
| 9 | HWM y barra macro | COMPLETADA | 26 | amaHwmBar |
| 10 | Motor determinista | COMPLETADA | 17 | amaDeterministicEngine |
| 11 | Planificador adaptativo | COMPLETADA | 22 | amaAdaptivePlanner |
| 12 | Portfolio AMA | COMPLETADA | 16 | amaPortfolio |
| 13 | Protección del ciclo | COMPLETADA | 26 | amaProtectionExits |
| 14 | Salidas y trailing | COMPLETADA | (en 13) | amaProtectionExits |
| 15 | IA observadora | COMPLETADA | 18 | amaAIObserver |
| 16 | Logging estructurado | COMPLETADA | 22 | amaLoggingEvents |
| 17 | Eventos y auditoría | COMPLETADA | (en 16) | amaLoggingEvents |
| 18 | Retención y ciclo de vida | COMPLETADA | (en 16) | amaLoggingEvents |
| 19 | Capacidad y panel | COMPLETADA | 16 | amaCapacityResearch |
| 20 | Research Lab | COMPLETADA | (en 19) | amaCapacityResearch |
| 21 | Simulador maker | COMPLETADA | (en 19) | amaCapacityResearch |
| 22 | Panel AMA completo | COMPLETADA | (en 19) | amaCapacityResearch |
| 23 | SHADOW | COMPLETADA | 20 | amaShadowExecutorSecurity |
| 24 | Executor bloqueado | COMPLETADA | (en 23) | amaShadowExecutorSecurity |
| 25 | Seguridad y recovery | COMPLETADA | (en 23) | amaShadowExecutorSecurity |
| 26 | REAL_LIMITED | BLOQUEADA_POR_GATE | — | Pendiente autorización |
| 27 | Validación final local | COMPLETADA | 529 total | npm run check ✅ |
| 28 | Deploy staging | BLOQUEADA_POR_GATE | — | Pendiente autorización |
| 29 | Archivo | BLOQUEADA_POR_GATE | — | Pendiente autorización |

---

## 4. Migración 080

- **Estado:** NOT_REGISTERED, NOT_AUTOAPPLY
- **AutoMigrationRunner:** línea comentada en `server/routes.ts`
- **Test de gate:** `amaMigrationGate.test.ts` verifica que no está activa
- **SQL:**
  - `CREATE TABLE IF NOT EXISTS` (idempotente)
  - `CHECK >= 0` en todas las columnas monetarias
  - `UNIQUE` en IDs y combinaciones
  - `ON DELETE RESTRICT` en todas las FKs
  - No DROP, TRUNCATE, DELETE, VACUUM
- **081:** No existe (no fue creada)

---

## 5. Seguridad

### SHADOW (Fase 23)
- Simulación interna, no usa credenciales
- No inicializa exchange privado
- No crea/cancela órdenes reales
- No reserva capital real
- No muta inventario real

### Executor (Fase 24)
- REAL_LIMITED y REAL_FULL bloqueados con 403 y throw
- Revolut X bloqueado
- No import de ExchangeFactory
- No placeOrder/cancelOrder methods

### BTC/ETH
- BTC/USD = LAB_ONLY, 6 tranches, 75% desplegable, 25% reserva
- ETH/USD = RESEARCH_ONLY, 7 tranches, venue DISABLED
- ETH no puede reservar capital real ni heredar presupuesto BTC

### Coin Metrics
- decisionImpactAllowed = false
- licenseStatus = REVIEW_REQUIRED
- No puede reemplazar Kraken ni generar ATR con PriceUSD

---

## 6. Tests

### Tests AMA+Portfolio: 529 passed / 0 failed / 0 skipped

| Archivo | Tests | Fase |
|---|---|---|
| amaMigrationGate.test.ts | 9 | 0-2 |
| amaTypes.test.ts | 34 | 0-2 |
| amaService.test.ts | 29 | 7 |
| amaShadowExecutorSecurity.test.ts | 20 | 23-25 |
| amaSeedTypes.test.ts | 46 | 0-2 |
| amaMandateStudio.test.ts | 26 | 8 |
| amaAIObserver.test.ts | 18 | 15 |
| amaDomainPersistent.test.ts | 28 | 7 |
| portfolioGlobal.test.ts | 25 | 3 |
| amaSources2D2L.test.ts | 49 | 0-2 |
| amaDeterministicEngine.test.ts | 17 | 10 |
| amaHwmBar.test.ts | 26 | 9 |
| portfolioLedger.test.ts | 18 | 4 |
| amaAdaptivePlanner.test.ts | 22 | 11 |
| amaDataQuality.test.ts | 21 | 0-2 |
| amaLoggingEvents.test.ts | 22 | 16-18 |
| portfolioReservations.test.ts | 16 | 5 |
| amaProtectionExits.test.ts | 26 | 13-14 |
| amaCapacityResearch.test.ts | 16 | 19-22 |
| amaPortfolio.test.ts | 16 | 12 |
| amaRoutes.test.ts | 29 | 7 |
| amaCanonicalPrice.test.ts | 16 | 0-2 |

### Suite completa: 3585 passed, 31 failed (preexisting), 29 skipped
- **0 fallos nuevos AMA**
- Fallos preexistentes: telegram, IDCA, spot, strategies, spreadFilter

---

## 7. Build y TypeScript

- `npm run check` (tsc): ✅
- `npm run build` (vite): ✅
- `git diff --check`: ✅

---

## 8. Secret scan

- Password hardcodeado en `scripts/ama_migration_validate.mjs` → corregido a `process.env.PG_PASSWORD`
- No API keys, tokens, cookies, private keys en archivos AMA
- No .env, logs, capturas en archivos AMA

---

## 9. Riesgos

1. **PostgreSQL desechable no validada localmente** — la DB está en VPS. Validación pendiente para staging.
2. **Fase 26 (REAL_LIMITED)** no implementada — pendiente autorización explícita.
3. **31 tests preexistentes fallan** — no relacionados con AMA, no corregidos por alcance.

---

## 10. Veredicto

**APTO_PARA_COMMIT_EN_RAMA_DE_REVISION**
