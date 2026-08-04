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

Fuente: `server/routes.ts` — MIGRATIONS array con comentario explícito.

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

### R8A.5 — `scripts/ama_migration_validation_helpers.mjs`

- JS puro, 15 exports, sin conexión DB, fuente canónica única
- Helpers puros (sin DB, sin efectos secundarios)
- `validateTempDbName`, `isDisposableDatabaseName`, `isProhibitedDatabaseName`
- `compareColumns`, `compareCheckConstraints`, `compareForeignKeys`, `compareIndexes`
- `buildReport`, `redactConfig`
- Contratos exportados: `R7_EXPECTED_TABLES`, `R7_EXPECTED_CHECKS`, `R7_EXPECTED_FOREIGN_KEYS`,
  `R7_EXPECTED_INDEXES`, `R7_PLANS_REQUIRED_COLUMNS`, `R7_FILL_EVENTS_REQUIRED_COLUMNS`

### R8A.5b — `server/services/ama/__tests__/amaR8MigrationValidator.test.ts`

- 46 tests puros (0 conexiones DB)
- Cubre: validación nombre DB, comparación columnas/checks/FKs/índices, buildReport, redactConfig,
  completitud contratos R7 (10 tablas, HWM fields, fill events columns, 9 FKs, asset domain)

---

### R8A.6 — `.github/workflows/ama-postgres-080-validation.yml`

- PostgreSQL 16 como service container (`postgres:16`)
- `PG_TEMP_DATABASE=ama_disposable_test_ci_<run_id>_<attempt>`
- Trigger: push/PR en `review/ama-seed-v2-2-*` sobre archivos de migración/validador/workflow/tests/package
- `workflow_dispatch` definido pero solo disponible cuando el workflow exista en la rama predeterminada
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
| CI workflow | COMMITTED_AND_PUSHED — pendiente verificación en GitHub Actions |
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
- `vitest`: 46/46 tests PASS
- `git diff --stat HEAD`: únicamente los archivos R8A modificados/creados

Archivos alcance del commit R8A:
```
db/migrations/080_ama_initial.sql
scripts/ama_migration_validate.mjs
scripts/ama_migration_validation_helpers.mjs  ← NUEVO (canónico .mjs)
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
| `vitest server/services/ama` | **822 tests AMA: 819 passed, 3 failed preexistentes, 0 fallos nuevos R8A** |
| `vitest server/services/portfolio` | ✅ **59/59** |
| `vitest run` (suite completa) | **3900 passed / 34 failed (preexistentes) / 29 skipped — 3934 total no-skipped** |

### Análisis de fallos suite completa

- **Fallos preexistentes (no R8A):** 34 total
- La reproducción de R7 en worktree limpio y en el mismo entorno obtuvo
  los mismos 34 fallos que R8A.
- Los conjuntos exactos de tests fallidos son idénticos.
- Por tanto, R8A no introduce fallos nuevos.
- **FAILURE_SETS_IDENTICAL = YES**
- **R8A_NEW_FAILURES = 0** ✅
- **R8A_NEW_SKIPPED = 0** ✅

---

## Estado final R8A

| Campo | Valor |
|-------|-------|
| Implementación | COMMITTED_AND_PUSHED |
| Commit técnico | 27f7c3ad77350460d3dbe20bba379e48ea37b5df |
| Commit documental | ef8f837e93bae2e0f3a4d7fd5e0aba502edd2c04 |
| Push | FAST_FORWARD a origin/review/ama-seed-v2-2-20260729 |
| Merge | NO |
| Deploy | NO |
| Migraciones aplicadas | NO |
| Entornos afectados | NINGUNO |
| CI PostgreSQL 16 | PENDIENTE_DE_VERIFICACION |

### Veredicto

`AMA R8A COMMITTED_AND_PUSHED — POSTGRESQL_16_DISPOSABLE_VALIDATION = PENDING_MANUAL_VERIFICATION`

El trigger `workflow_dispatch` permanece definido, pero GitHub solo permite
dispararlo manualmente cuando el workflow existe en la rama predeterminada.
Durante R8A, la validación se dispara mediante push a la rama de revisión.
No se requiere merge para ejecutar el push-trigger.
