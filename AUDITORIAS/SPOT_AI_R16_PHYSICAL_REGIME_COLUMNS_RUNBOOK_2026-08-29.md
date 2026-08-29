# SPOT AI R16 — PHYSICAL REGIME COLUMNS RUNBOOK

**Date:** 2026-08-29  
**Branch:** `refactor/spot-canonical-shadow-20260812`  
**Base SHA:** `9101062be2233b7653ebb0a13c659cc15041e67e`  
**Status:** CODE + TESTS + AUDIT ONLY — NOT APPLIED IN STAGING

---

## 1. Contexto R15D

R15D demostró que la query `GET /api/spot/ai/dataset/regimes` tarda ~42s porque debe descomprimir el JSONB `data` (TOAST ~2GB) para cada fila SCAN.

**Pruebas R15D:**
- Seq Scan: ~42-44s
- Bitmap Index + Heap: ~44.8s
- Index Scan forzado: ~46s
- Bitmap Index Scan únicamente: ~1.6ms

**Conclusión R15D:** El cuello de botella es TOAST decompression, no row lookup. El índice 091 (`idx_ft_scan_regime`) no puede acelerar la agregación completa porque el planner necesita heap fetches para las expresiones GROUP BY.

## 2. Root Cause TOAST

La tabla `spot_forward_twin_snapshots` tiene:
- Heap: ~5.8 MB (697 páginas)
- Total: ~2175 MB (TOAST ~2169 MB)

Cada fila SCAN tiene un JSONB `data` grande almacenado comprimido en TOAST. La query legacy extrae `data->'regime'->>'regime'` y `data->'regime'->>'direction'` para ~24k filas, requiriendo descompresión TOAST para cada una.

## 3. Arquitectura Physical Projection

R16 añade tres columnas físicas a `spot_forward_twin_snapshots`:
- `regime TEXT NULL` — proyección del régimen
- `direction TEXT NULL` — proyección de la dirección
- `regime_projection_version SMALLINT NULL` — 1 = proyectado, NULL = pendiente

El collector copia los valores ya calculados desde `snap.regime.regime` y `snap.regime.direction` al INSERT. El endpoint consulta las columnas físicas en lugar de extraer JSONB.

**El JSONB `data` sigue siendo canónico y no cambia.**

## 4. Migration 092

**File:** `db/migrations/092_spot_ai_regime_physical_columns.sql`

Contiene exactamente tres `ALTER TABLE ADD COLUMN` (DDL aditivo):
- `regime TEXT`
- `direction TEXT`
- `regime_projection_version SMALLINT`

Sin NOT NULL, sin DEFAULT, sin CHECK, sin backfill, sin index, sin DROP.

**Compatible con app vieja:** La app R14 puede seguir insertando sin conocer las columnas nuevas (quedan NULL).

## 5. Migration Runner

**File:** `script/spot-ai-migrate-092.ts`

- Token: `SPOT_AI_MIGRATION_092_CONFIRM=APPLY_STAGING_092`
- Usa `AutoMigrationRunner` (transaccional, advisory-locked, registry-tracked)
- Post-verify: registry, column existence, data types, nullability, no defaults
- Import-safe (no ejecuta en import)
- Idempotente

## 6. Backfill Runner

**File:** `script/spot-ai-backfill-regime-columns-092.ts`

- Token: `SPOT_AI_BACKFILL_092_CONFIRM=APPLY_STAGING_BACKFILL_092`
- Requiere migration 092 registrada
- Solo modifica SCAN rows con `regime_projection_version IS DISTINCT FROM 1`
- Batch-based (default=250, min=50, max=1000)
- Session advisory lock dedicado (920092202)
- Idempotente
- STOP on batch failure (no skip)
- Unlock siempre en finally; destroy client si unlock falla

## 7. Projection Version Rationale

`regime IS NULL` no distingue entre:
- A) fila correctamente proyectada cuyo source era NULL
- B) fila pendiente de backfill

`regime_projection_version` resuelve esto:
- `1` = proyectado correctamente (incluso si regime/direction son NULL)
- `NULL` = pendiente o no-SCAN

## 8. Old-App Compatibility

Las columnas son nullable sin default. La app R14 actual puede seguir insertando snapshots sin conocer las columnas nuevas. Esto permite la secuencia:
1. Apply migration 092
2. Pre-backfill con app vieja viva
3. Deploy R16
4. Catch-up backfill
5. Parity + benchmark

## 9. Pre-Backfill

Ejecutar backfill con la app vieja todavía viva para marcar filas históricas como `regime_projection_version=1`.

**NO garantiza completeness** porque la app vieja sigue insertando filas con `regime_projection_version=NULL`.

## 10. Deploy Order

1. **FASE A:** Apply migration 092
2. **FASE B:** Pre-backfill (app vieja viva)
3. **FASE C:** Build/deploy R16
4. **FASE D:** Verificar SHADOW + AI_TRADING_CONTROL=NONE + collector R16 activo
5. **FASE E:** Catch-up backfill inmediatamente
6. **FASE F:** Esperar al menos un ciclo de flush del collector (~5s)
7. **FASE G:** Verificar pending projection rows=0
8. **FASE H:** Same-MVCC parity JSONB vs physical
9. **FASE I:** Benchmark físico
10. **FASE J:** Solo entonces cerrar performance

## 11. Catch-Up

Después del deploy R16, nuevos SCAN nacen con `projection_version=1`. El catch-up backfill cubre la ventana: fin pre-backfill → cutover app R16.

## 12. Parity Same-MVCC

Test futuro dentro de `REPEATABLE READ READ ONLY`:

**Query A (legacy):**
```sql
SELECT data->'regime'->>'regime', data->'regime'->>'direction', COUNT(*)
FROM spot_forward_twin_snapshots WHERE snapshot_type='SCAN'
GROUP BY 1,2 ORDER BY 1,2;
```

**Query B (physical):**
```sql
SELECT regime, direction, COUNT(*)
FROM spot_forward_twin_snapshots WHERE snapshot_type='SCAN'
GROUP BY 1,2 ORDER BY 1,2;
```

Exigir: `LEGACY_RESULT_SHA256 == PHYSICAL_RESULT_SHA256`

## 13. Benchmark

Después de catch-up:
```sql
EXPLAIN (ANALYZE, BUFFERS, SETTINGS)
SELECT regime, direction, COUNT(*) AS count
FROM spot_forward_twin_snapshots
WHERE snapshot_type='SCAN' AND regime_projection_version=1
GROUP BY regime, direction
ORDER BY count DESC;
```

**Gates futuros:**
- First: <=5000ms
- Target: median <=1000ms
- Preferred: median <=250ms

## 14. Failure Modes

**A. 092 DDL fails:** Transaction rollback. No damage.

**B. Pre-backfill fails:** Stop. App old remains valid. Columns may remain partially projected. Run again when safe.

**C. Deploy fails:** App rollback possible. Old app remains compatible with 092 columns (they're nullable).

**D. Catch-up fails:** Endpoint remains `available=false`, `reason=PHYSICAL_REGIME_BACKFILL_PENDING`. No partial results.

**E. Parity fails:** NO performance closure. NO training. NO REAL. Investigate root cause.

**F. Physical benchmark fails:** NO summary-table implementation automatically. STOP. Wait for user decision.

## 15. Recovery

- Migration 092 es aditiva. Dejar las columnas en DB es seguro.
- NO automatizar `DROP COLUMN` como rollback.
- Preferir app rollback sobre DB rollback.
- Si se necesita eliminar las columnas: requiere autorización explícita y migration separada.

## 16. 091 Remains Untouched

- `idx_ft_scan_regime` NO se modifica ni se elimina en R16.
- Ocupa ~176 kB.
- Puede servir consultas selectivas futuras.
- Su decisión se pospone hasta después del benchmark físico real.

## 17. No Training / No REAL

R16 no modifica:
- strategy, regime detector, entry, exit, sizing, stops, fees, execution, orders
- position lifecycle, policy_version, risk
- Forward Twin snapshot content
- durable labels, giveback, training dataset semantics

R16 solo replica valores ya existentes en columnas físicas para optimizar lectura.

---

**END OF RUNBOOK**
