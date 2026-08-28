# SPOT AI 090 STAGING RUNBOOK — 2026-08-28

## Migration 090: `spot_ai_forward_training_trades` + `spot_ai_forward_giveback_samples`

**Estado:** NO APLICADA. Requiere autorización explícita.
**Mecanismo:** `SPOT_AI_MIGRATION_090_CONFIRM=APPLY_STAGING_090 npx tsx script/spot-ai-migrate-090.ts`
**089:** Diferida. NO aplicar.

---

## 1. PRE-APPLY READ-ONLY SQL

Ejecutar en staging ANTES de aplicar 090. Todas son queries READ-ONLY.

### A) Total snapshots

```sql
SELECT COUNT(*) AS total_snapshots
FROM spot_forward_twin_snapshots;
```

### B) Por snapshot_type

```sql
SELECT snapshot_type, COUNT(*) AS cnt
FROM spot_forward_twin_snapshots
GROUP BY snapshot_type
ORDER BY cnt DESC;
```

### C) Por schema_version

```sql
SELECT (data->>'schemaVersion') AS schema_version, COUNT(*) AS cnt
FROM spot_forward_twin_snapshots
GROUP BY data->>'schemaVersion'
ORDER BY cnt DESC;
```

### D) Por policy_version

```sql
SELECT (data->>'policyVersion') AS policy_version, COUNT(*) AS cnt
FROM spot_forward_twin_snapshots
GROUP BY data->>'policyVersion'
ORDER BY cnt DESC;
```

### E) MIN/MAX timestamp

```sql
SELECT
  MIN((data->>'timestamp')::bigint) AS oldest_ts,
  MAX((data->>'timestamp')::bigint) AS newest_ts
FROM spot_forward_twin_snapshots;
```

### F) Edad del snapshot más antiguo

```sql
SELECT
  MIN((data->>'timestamp')::bigint) AS oldest_ts,
  EXTRACT(EPOCH FROM (NOW() - TO_TIMESTAMP(MIN((data->>'timestamp')::bigint) / 1000.0))) / 86400 AS oldest_age_days
FROM spot_forward_twin_snapshots;
```

### G) lotId faltante en FILL

```sql
SELECT COUNT(*) AS fills_missing_lotId
FROM spot_forward_twin_snapshots
WHERE snapshot_type = 'FILL'
  AND (data->'fill'->>'lotId' IS NULL OR data->'fill'->>'lotId' = '');
```

### H) scanId vacío/faltante en SCAN

```sql
SELECT COUNT(*) AS scans_missing_scanId
FROM spot_forward_twin_snapshots
WHERE snapshot_type = 'SCAN'
  AND (data->>'scanId' IS NULL OR data->>'scanId' = '');
```

### I) Canonical duplicate fills

Identidad canónica: lotId, pair, side, orderId, executedAt, fillPrice, fillVolume, feeUsd.

```sql
SELECT
  data->'fill'->>'lotId' AS lot_id,
  pair,
  data->'fill'->>'side' AS side,
  data->'fill'->>'orderId' AS order_id,
  (data->'fill'->>'executedAt')::bigint AS executed_at,
  (data->'fill'->>'fillPrice')::double precision AS fill_price,
  (data->'fill'->>'fillVolume')::double precision AS fill_volume,
  (data->'fill'->>'feeUsd')::double precision AS fee_usd,
  COUNT(*) AS cnt
FROM spot_forward_twin_snapshots
WHERE snapshot_type = 'FILL'
GROUP BY
  data->'fill'->>'lotId',
  pair,
  data->'fill'->>'side',
  data->'fill'->>'orderId',
  data->'fill'->>'executedAt',
  data->'fill'->>'fillPrice',
  data->'fill'->>'fillVolume',
  data->'fill'->>'feeUsd'
HAVING COUNT(*) > 1
ORDER BY cnt DESC;
```

### J) Fills missing identity fields

```sql
SELECT COUNT(*) AS fills_missing_identity_fields
FROM spot_forward_twin_snapshots
WHERE snapshot_type = 'FILL'
AND (
  data->'fill'->>'lotId' IS NULL OR
  data->'fill'->>'side' IS NULL OR
  data->'fill'->>'orderId' IS NULL OR
  data->'fill'->>'executedAt' IS NULL OR
  data->'fill'->>'fillPrice' IS NULL OR
  data->'fill'->>'fillVolume' IS NULL OR
  data->'fill'->>'feeUsd' IS NULL
);
```

### K) Completed trade candidates (BUY > 0 AND SELL > 0)

```sql
SELECT
  data->'fill'->>'lotId' AS lot_id,
  pair,
  COUNT(*) FILTER (
    WHERE data->'fill'->>'side' = 'BUY'
  ) AS buy_fill_count,
  COUNT(*) FILTER (
    WHERE data->'fill'->>'side' = 'SELL'
  ) AS sell_fill_count,
  SUM(
    CASE
      WHEN data->'fill'->>'side' = 'BUY'
      THEN (data->'fill'->>'fillVolume')::double precision
      ELSE 0
    END
  ) AS buy_volume,
  SUM(
    CASE
      WHEN data->'fill'->>'side' = 'SELL'
      THEN (data->'fill'->>'fillVolume')::double precision
      ELSE 0
    END
  ) AS sell_volume
FROM spot_forward_twin_snapshots
WHERE snapshot_type = 'FILL'
AND data->'fill'->>'lotId' IS NOT NULL
GROUP BY
  data->'fill'->>'lotId',
  pair
HAVING
  COUNT(*) FILTER (
    WHERE data->'fill'->>'side' = 'BUY'
  ) > 0
AND
  COUNT(*) FILTER (
    WHERE data->'fill'->>'side' = 'SELL'
  ) > 0
ORDER BY lot_id, pair;
```

---

## 2. MIGRATION APPLY (con autorización)

```bash
SPOT_AI_MIGRATION_090_CONFIRM=APPLY_STAGING_090 \
npx tsx script/spot-ai-migrate-090.ts
```

Exigir exit code 0. Si exit != 0: STOP. NO deploy.

---

## 3. POST-APPLY READ-ONLY SQL

Ejecutar DESPUÉS de aplicar 090 para verificar.

### A) Registry

```sql
SELECT id, applied_at
FROM schema_migrations
WHERE id = '090_spot_ai_forward_training_trades';
```

### B) Tables exist

```sql
SELECT to_regclass('public.spot_ai_forward_training_trades') AS training_table;
SELECT to_regclass('public.spot_ai_forward_giveback_samples') AS giveback_table;
```

### C) Constraints

```sql
SELECT conname, contype
FROM pg_constraint
WHERE conrelid = 'public.spot_ai_forward_training_trades'::regclass
ORDER BY conname;

SELECT conname, contype
FROM pg_constraint
WHERE conrelid = 'public.spot_ai_forward_giveback_samples'::regclass
ORDER BY conname;
```

### D) Unique indexes

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'spot_ai_forward_training_trades'
ORDER BY indexname;

SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'spot_ai_forward_giveback_samples'
ORDER BY indexname;
```

### E) Critical columns — training

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'spot_ai_forward_training_trades'
AND column_name IN (
  'dataset_fingerprint', 'policy_version', 'entry_features_json',
  'entry_labels_json', 'closed_qty', 'residual_qty', 'is_trainable'
)
ORDER BY column_name;
```

### F) Critical columns — giveback

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'spot_ai_forward_giveback_samples'
AND column_name IN (
  'dataset_fingerprint', 'policy_version', 'state_json',
  'labels_json', 'has_label', 'forward_twin_schema_version'
)
ORDER BY column_name;
```

### G) Row counts

```sql
SELECT COUNT(*) AS training_rows FROM spot_ai_forward_training_trades;
SELECT COUNT(*) AS giveback_rows FROM spot_ai_forward_giveback_samples;
```

---

## 4. SAFE DEPLOY ORDER

```
SAFE_DEPLOY_ORDER=MIGRATION_090_DEDICATED_RUNNER_THEN_APP_ACTIVATION
```

1. App staging anterior sigue activa.
2. Preparar checkout del nuevo SHA en VPS sin activar.
3. Verificar SHA exacto.
4. Verificar `AI_TRADING_CONTROL=NONE`.
5. Backup PostgreSQL.
6. Ejecutar PRE-APPLY READ-ONLY SQL (sección 1).
7. Revisar resultados pre-apply.
8. Solo con autorización expresa:
   ```bash
   SPOT_AI_MIGRATION_090_CONFIRM=APPLY_STAGING_090 \
   npx tsx script/spot-ai-migrate-090.ts
   ```
9. Exigir exit 0. Si exit != 0: STOP. NO deploy.
10. Ejecutar POST-APPLY READ-ONLY SQL (sección 3).
11. Verificar registry, schema, constraints, indexes, columns.
12. Build nueva app.
13. Activar/restart nueva versión.
14. Health check.
15. SHADOW only — `AI_TRADING_CONTROL=NONE`.
16. Durable reconciliation status.
17. Comprobar counts/quality.
18. NO training todavía.

---

## 5. ROLLBACK

### CASE A: MIGRATION_EXECUTION_FAILURE_BEFORE_COMMIT

- AutoMigrationRunner ejecuta `ROLLBACK`.
- 090 NO queda registrada en `schema_migrations`.
- Script exit != 0.
- NO deploy.
- App staging anterior permanece activa.
- NO DROP necesario — la transacción se revirtió.

### CASE B: POSTVERIFY_FAILURE_AFTER_MIGRATION_COMMIT

- 090 PUEDE ESTAR YA APLICADA Y COMMITEADA.
- NO afirmar rollback — la migration ya fue commiteada.
- Acción:
  1. STOP. NO deploy.
  2. Inspeccionar manualmente:
     - `schema_migrations` (¿090 presente?)
     - Tablas (¿existen?)
     - Constraints
     - Columns
     - Logs del script
  3. NO DROP automático.
  4. NO rerun destructivo.
  5. Como 090 es aditiva, mantener app staging anterior funcionando mientras se diagnostica.
  6. Si se confirma incompatibilidad: restaurar desde backup.

### CASE C: 090 aplica pero nueva app no arranca

- Revertir aplicación al release anterior.
- Tablas 090 son aditivas — dejar intactas salvo evidencia de incompatibilidad.
- NO DROP automático.

### CASE D: Reconciliation falla

- AI sigue observacional. NO trading impact.
- Revert app / investigar.

### CASE E: Fingerprint conflicts

- Fail closed. NO borrar rows. NO overwrite. Investigar.

---

## 6. ESTADO OPERACIONAL

```
NO DEPLOY (hasta autorización)
NO MIGRATION (hasta autorización)
NO VPS (hasta autorización)
NO TRAINING
NO REAL
AI_TRADING_CONTROL=NONE
PENDING_GITHUB_COUNTERAUDIT=YES
```
