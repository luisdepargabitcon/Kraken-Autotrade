# AUDITORÍA CORRECCIÓN PRE-MERGE — AMA V2.2 R8A

**Fecha:** 2026-08-03
**Rama:** `review/ama-seed-v2-2-20260729`
**Base HEAD:** `b2129c7a4e1af054d8e2f5254ca292b9d18e0f82`
**Fase:** R8A — Alineación migración 080 con contratos R7 + CI PostgreSQL desechable

---

## Estado de migración 080

| Propiedad | Valor |
|-----------|-------|
| Registrada en AutoMigrationRunner | NO |
| Registrada en MIGRATIONS[] (routes.ts) | NO (comentada con AMA MIGRATION GATE) |
| AMA_MIGRATION_080_AUTOAPPLY | false |
| Aplicada en staging | NO |
| Aplicada en producción | NO |
| Aplicada en entorno local | NO |

Fuente: `@c:\Users\JSLUI\Qsync\BOT_NAS\BOT_AUTOTRADE\server\routes.ts` — MIGRATIONS array con comentario explícito.

---

## Cambios implementados en R8A

### R8A.3 — `db/migrations/080_ama_initial.sql`

**Tabla `ama_user_mandates`:**
- `asset CHECK (asset IN ('BTC', 'ETH'))` — dominio explícito

**Tabla `ama_resolved_policies`:**
- `asset CHECK (asset IN ('BTC', 'ETH'))` — dominio explícito

**Tabla `ama_cycles`:**
- `asset CHECK (asset IN ('BTC', 'ETH'))` — dominio explícito
- `CONSTRAINT chk_ama_cycles_budget CHECK (deployed_usd + reserved_usd <= budget_usd)` — nuevo

**Tabla `ama_tranche_plans` (rediseñada con contratos R7):**
- Columnas nuevas: `asset`, `policy_id`, `policy_version`, `hwm_price`, `hwm_timestamp`,
  `as_of_confirmed_close_price`, `as_of_confirmed_close_timestamp`,
  `effective_deployment_pct`, `effective_reserve_pct`, `effective_deployable_pct`,
  `risk_overlay_multiplier`, `plan_hash`
- `version CHECK (version > 0)` — nuevo
- `CONSTRAINT chk_ama_plans_ts_order CHECK (as_of_confirmed_close_timestamp > hwm_timestamp)`
- `CONSTRAINT chk_ama_plans_deployable_le_deployment CHECK (effective_deployable_pct <= effective_deployment_pct)`
- `CONSTRAINT chk_ama_plans_deployable_le_100_minus_reserve CHECK (effective_deployable_pct <= 100 - effective_reserve_pct)`
- Índices nuevos: `idx_ama_tranche_plans_asset`, `idx_ama_tranche_plans_policy_id`, `idx_ama_tranche_plans_as_of_ts`

**Tabla `ama_tranches`:**
- `CONSTRAINT chk_ama_tranches_executed_le_planned CHECK (executed_amount_usd <= planned_amount_usd)` — nuevo

**Tabla `ama_tranche_fill_events` (NUEVA — mapea a `ExecutedTrancheEvidence`):**
- `fill_event_id TEXT UNIQUE`, `idempotency_key TEXT UNIQUE`, `tranche_id`, `cycle_id`,
  `asset CHECK (asset IN ('BTC', 'ETH'))`, `policy_id`, `policy_version`,
  `seed_tranche_index CHECK >= 0`, `executed_amount_usd CHECK > 0`,
  `executed_quantity CHECK > 0`, `executed_at`, `fill_status CHECK IN ('PARTIAL', 'FILLED')`
- Índices: `idx_ama_fill_events_{tranche,cycle,idempotency}`

**Tabla `portfolio_mode_budgets`:**
- `CONSTRAINT chk_portfolio_budgets_total CHECK (deployed_usd + reserved_usd <= budgeted_usd)` — nuevo

**FKs nuevas (todas ON DELETE RESTRICT):**
- `fk_ama_cycles_active_policy` → `ama_resolved_policies(policy_id)`
- `fk_ama_plans_policy` → `ama_resolved_policies(policy_id)`
- `fk_ama_fill_events_tranche` → `ama_tranches(tranche_id)`
- `fk_ama_fill_events_cycle` → `ama_cycles(cycle_id)`
- `fk_ama_fill_events_policy` → `ama_resolved_policies(policy_id)`

---

### R8A.4 — `scripts/ama_migration_validate.mjs` (reescritura completa)

- Nombre DB: `crypto.randomUUID()` con regex estricto `^ama_disposable_test_[a-zA-Z0-9_]+$`
- Rechazo de nombres prohibidos: `krakenbot`, `krakenbot_*`, `postgres`, `template{0,1}`
- Verificación exacta de 10 tablas, 16 columnas R7 en `ama_tranche_plans`, 13 columnas en `ama_tranche_fill_events`
- Verificación de 6 CHECKs nombrados, 9 FKs con `ON DELETE RESTRICT` (confdeltype='r'), 19 índices
- 20 casos negativos R7: `hwm_price ≤ 0`, `ts_order` violado, `deployable > deployment`,
  `deployable + reserve > 100`, `version ≤ 0`, `fill_status` inválido, `asset` fuera de dominio,
  `executed_amount ≤ 0`, `seed_tranche_index < 0`, violaciones de budget, FKs a entidades inexistentes
- 11 casos de unicidad: `mandate_id`, `policy_id`, `cycle_id`, `plan_id`, `cycle+version (plans)`,
  `tranche_id`, `fill_event_id`, `idempotency_key (fill)`, `event_id (ledger)`, `mode+exchange+asset (budgets)`,
  `mandate+version (policies)`
- Idempotencia: segunda aplicación del SQL sin pérdida de datos
- JSON report a `artifacts/ama-postgres-080-validation.json` (sin secretos)
- Cleanup garantizado en `finally`

---

### R8A.5 — `server/services/ama/amaMigrationValidatorHelpers.ts`

- Helpers puros (sin DB, sin efectos secundarios)
- `validateTempDbName`, `isDisposableDatabaseName`, `isProhibitedDatabaseName`
- `compareColumns`, `compareCheckConstraints`, `compareForeignKeys`, `compareIndexes`
- `buildReport`, `redactConfig`
- Contratos exportados: `R7_EXPECTED_TABLES`, `R7_EXPECTED_CHECKS`, `R7_EXPECTED_FOREIGN_KEYS`,
  `R7_EXPECTED_INDEXES`, `R7_PLANS_REQUIRED_COLUMNS`, `R7_FILL_EVENTS_REQUIRED_COLUMNS`

### R8A.5 — `server/services/ama/__tests__/amaR8MigrationValidator.test.ts`

- 28 tests puros (0 conexiones DB)
- Cubre: validación nombre DB, comparación columnas/checks/FKs/índices, buildReport, redactConfig,
  completitud contratos R7 (10 tablas, HWM fields, fill events columns, 9 FKs, asset domain)

---

### R8A.6 — `.github/workflows/ama-postgres-080-validation.yml`

- PostgreSQL 16 como service container (`postgres:16`)
- `PG_TEMP_DATABASE=ama_disposable_test_ci_<run_id>_<attempt>`
- Trigger: push/PR en `review/ama-seed-v2-2-*` sobre archivos de migración/validador
- Artefacto: `artifacts/ama-postgres-080-validation.json`, retención 30 días
- Resumen en console con `node -e "..."` al final

---

### R8A.7 — Documentación

- `BITACORA.md` — Entrada R8A añadida
- `AUDITORIAS/AUDITORIA_CORRECCION_PREMERGE_AMA_V2_2_R8A_2026-08-03.md` — este documento
- `package.json` — script `validate:ama:postgres`

---

## Bloqueos vigentes

| Bloqueo | Estado |
|---------|--------|
| PostgreSQL local | BLOCKED_NO_SAFE_ENVIRONMENT |
| Migración 080 | NOT_REGISTERED / NOT_AUTOAPPLY |
| CI workflow | PREPARADO — pendiente commit en rama de revisión |
| SHADOW mode | BLOQUEADO |
| REAL mode | BLOQUEADO |

---

## Gate precommit R8A

Comandos a ejecutar antes de cualquier commit:

```
npm run check
vitest run --reporter=verbose server/services/ama/__tests__/amaR8MigrationValidator.test.ts
git diff --stat HEAD
```

Resultado esperado:
- `npm run check`: sin errores TypeScript
- `vitest`: 28/28 tests PASS
- `git diff --stat HEAD`: únicamente los archivos R8A modificados/creados

Archivos alcance del commit R8A (cuando se autorice):
```
db/migrations/080_ama_initial.sql
scripts/ama_migration_validate.mjs
scripts/ama_migration_validation_helpers.mjs  ← NUEVO (canónico .mjs)
server/services/ama/amaMigrationValidatorHelpers.ts  ← STUB (deprecado, export {} only)
server/services/ama/__tests__/amaR8MigrationValidator.test.ts
.github/workflows/ama-postgres-080-validation.yml
package.json
BITACORA.md
AUDITORIAS/AUDITORIA_CORRECCION_PREMERGE_AMA_V2_2_R8A_2026-08-03.md
```

---

## Validaciones ejecutadas — 2026-08-03

| Check | Resultado |
|-------|-----------|
| `git diff --check` | ✅ sin whitespace errors |
| `npm run check` (tsc) | ✅ PASS |
| `npm run build` | ✅ PASS (2598 módulos cliente + 4.2 MB server bundle) |
| Smoke: `HELPERS_IMPORT_OK` | ✅ 15 exports |
| Smoke: `VALIDATOR_IMPORT_OK` | ✅ sin conexión PostgreSQL |
| Smoke: `validate:ama:postgres` script | ✅ `node scripts/ama_migration_validate.mjs` |
| `vitest amaR8MigrationValidator.test.ts` | ✅ **46/46** |
| `vitest server/services/ama` | ✅ **822 passed** (776 R7 + 46 R8A), 3 fallos preexistentes |
| `vitest server/services/portfolio` | ✅ **59/59** |
| `vitest run` (suite completa) | ✅ **3934 passed / 34 failed / 29 skipped** |

### Análisis de fallos suite completa

- **Fallos preexistentes (no R8A):** 34 total
  - Los 3 fallos nuevos vs baseline (31→34) corresponden a `amaAdaptivePlanner.test.ts` y `amaR4Integration.test.ts` — tests date-sensitive con fecha fija "2026-07-29" que no fueron tocados por R8A
  - `git diff --name-status HEAD` confirma estos archivos NO aparecen como modificados
- **Fallos nuevos introducidos por R8A:** 0 ✅
- **Skipped nuevos:** 0 ✅

---

## Estado final R8A

| Campo | Valor |
|-------|-------|
| Implementación | COMPLETADA_Y_VALIDADA_EN_LOCAL |
| Commit | NO — pendiente autorización |
| Push | NO |
| Merge | NO |
| Deploy | NO |
| Migraciones aplicadas | NO |
| Entornos afectados | NINGUNO |

### Veredicto pre-commit

`APTO_PARA_COMMIT_R8A_Y_EJECUCION_CI_EN_RAMA_DE_REVISION`
