# AUDITORÍA — REV-C12C: Causa raíz REVOLUT_X_UNAVAILABLE en staging

**Fecha:** 2026-08-03
**Rama:** `review/grid-rev-c12a-20260731`
**HEAD antes del commit:** `58f25c090c5a107c20472c648bc5612aa48cb64c`
**Clasificación:** Observabilidad + corrección mínima de colapso de errores

---

## 1. Evidencia staging

| Campo | Valor |
|---|---|
| URL | `http://5.250.184.18:3020` |
| `/api/health` | OK |
| `/api/exchange-diagnostics` | active: `"revolutx"`, initialized: `true`, enabled: `true` |
| Evento recurrente | `EXECUTION_MARKET_SNAPSHOT_UNAVAILABLE` cada 60s |
| `metadataJson.source` | `"REVOLUT_X_UNAVAILABLE"` |
| `metadataJson.reasonCode` | `"EXECUTION_MARKET_CONSTRAINTS_UNAVAILABLE"` |
| `metadataJson.allowCycleExits` | `true` |
| SHA desplegado | `44cd46f` (origin/main, pre-REV-C12A) |
| Estado staging | `STAGING_CODE_OUTDATED` |

El servicio Revolut X está inicializado y habilitado, lo que descarta fallo de credenciales en startup.

---

## 2. Causa raíz confirmada

### Defecto en `gridIsolatedEngine.ts` (líneas ~1334–1344 pre-corrección)

```typescript
// ANTES (defectuoso)
try {
  pairConstraints = await revolutXService.resolveGridPairConstraints(this.config.pair);
  const ticker = await revolutXService.getTicker(this.config.pair);
  executionMarketSnapshot = buildGridExecutionMarketSnapshot({ ... source: "REVOLUT_X_TICKER" ... });
} catch {
  // Catch único: cualquier excepción de getTicker DESCARTA constraints ya resueltas
  // y silencia el error real sin logging
  pairConstraints = { ... verified: false, reasonCode: "PAIR_CONSTRAINTS_UNAVAILABLE" };
  executionMarketSnapshot = buildGridExecutionMarketSnapshot({ ... source: "REVOLUT_X_UNAVAILABLE" ... });
}
```

**Efectos del defecto:**
1. `getTicker` falla en todos sus 6 intentos (3 order-book + 3 trades) → lanza `"RevolutX ticker unavailable for BTC/USD"`
2. Catch bloque atrapa la excepción y **descarta** las constraints que `resolveGridPairConstraints` ya resolvió (posiblemente verified=true desde endpoint público)
3. El error real (código HTTP, mensaje) **nunca se loggea** a ningún destino persistente
4. El engine genera `source: "REVOLUT_X_UNAVAILABLE"` → `reasonCode: "EXECUTION_MARKET_CONSTRAINTS_UNAVAILABLE"`
5. `allowRangeBuys = false` → ningún rango, ningún BUY nuevo, modo: mantenimiento de salidas

### Por qué `getTicker` falla en staging

Con `rateLimiter.totalCalls = 8273` en ~69h de uptime:
- ~120 calls/h = 2 calls/min sobre 7 esperadas/min
- Evidencia de que algunos paths fallan antes de alcanzar el rate limiter (errores de red, 404, etc.)

La función `getTickerFromOrderbook` ya incluye un comentario explícito:
```
// DISABLED: Este endpoint NO EXISTE en RevolutX API (404)
// El endpoint /api/1.0/orderbook devuelve "Endpoint GET /api/1.0/orderbook not found"
```

Los paths probados (`/api/1.0/order-book/`, `/api/1.0/order_book/`, `/api/1.0/orderbook/`) y los de trades (`/api/1.0/trades/`) probablemente devuelven 404 o errores de autenticación, pero sin logging persistente es imposible confirmarlo sin acceso a la consola Docker.

---

## 3. Corrección aplicada

### 3.1 Separación del try/catch (código principal)

**Archivo:** `server/services/gridIsolated/gridIsolatedEngine.ts`

```typescript
// DESPUÉS (corregido)
// resolveGridPairConstraints nunca lanza en práctica; safety catch para par inválido
try {
  pairConstraints = await revolutXService.resolveGridPairConstraints(this.config.pair);
} catch {
  pairConstraints = { ... verified: false, reasonCode: "PAIR_CONSTRAINTS_UNAVAILABLE" };
}

// getTicker en bloque separado — preserva constraints ya resueltas
try {
  const ticker = await revolutXService.getTicker(this.config.pair);
  executionMarketSnapshot = buildGridExecutionMarketSnapshot({ ... source: "REVOLUT_X_TICKER" ... });
} catch (tickerErr) {
  const failureStage: RevolutXGridFailureStage = "TICKER_FETCH";
  botLogger.warn("GRID_REVOLUTX_TICKER_FAILED", `RevolutX ticker no disponible: ${mensaje_real}`, {
    stage: "TICKER_FETCH",
    pair, constraintsVerified, constraintsSource, constraintsReasonCode,
    canCreateRange: false, allowCycleExits: true,
    error: mensaje_real,
  });
  executionMarketSnapshot = buildGridExecutionMarketSnapshot({ ... source: "REVOLUT_X_TICKER_FETCH_FAILED" ... });
}
```

### 3.2 Tipo clasificador

**Archivo:** `server/services/gridIsolated/gridIsolatedTypes.ts`

```typescript
export type RevolutXGridFailureStage =
  | "INITIALIZATION" | "AUTHENTICATION" | "PAIR_NORMALIZATION"
  | "PAIR_CONSTRAINTS" | "TICKER_FETCH" | "TICKER_VALIDATION"
  | "FRESHNESS" | "NETWORK" | "UNKNOWN";
```

### 3.3 EventType nuevos

**Archivo:** `server/services/botLogger.ts`

```
"GRID_REVOLUTX_TICKER_FAILED"
"GRID_REVOLUTX_PROJECTION_BLOCKED"
```

---

## 4. Tests dirigidos (14 nuevos)

**Archivo:** `server/services/__tests__/gridIsolatedEngine.test.ts`

| ID | Escenario | Verificación |
|---|---|---|
| T1 | getTicker throws "not initialized" | fail-closed + warn con stage=TICKER_FETCH |
| T2 | getTicker throws HTTP 401 | fail-closed + warn |
| T3 | getTicker throws HTTP 403 | fail-closed + warn |
| T4 | getTicker throws HTTP 404 (endpoint no existe) | fail-closed + warn |
| T5 | getTicker throws HTTP 429 (rate limited) | fail-closed |
| T6 | getTicker throws ETIMEDOUT (red) | fail-closed + warn con allowCycleExits=true |
| T7 | getTicker throws error desconocido | fail-closed |
| T8 | constraints unverified, ticker ok | fail-closed, NO warn de ticker |
| T9 | constraints verified=true preservadas cuando ticker falla | constraintsVerified=true en log |
| T10 | resolveGridPairConstraints throws (par inválido) | fail-closed |
| T11 | ticker bid=null | fail-closed (snapshot BID_INVALID) |
| T12 | ticker bid >= ask | fail-closed (snapshot ASK_INVALID) |
| T13 | constraints fail + ticker fail | allowCycleExits=true siempre |
| T14 | cualquier fallo en SHADOW | cero órdenes reales |

---

## 5. Cambio de comportamiento observable

| Comportamiento | Antes | Después |
|---|---|---|
| Error real de `getTicker` | Silenciado | `botLogger.warn` con mensaje completo |
| Constraints cuando ticker falla | Descartadas (false) | Preservadas del resultado real |
| `source` en snapshot de fallo | `"REVOLUT_X_UNAVAILABLE"` | `"REVOLUT_X_TICKER_FETCH_FAILED"` |
| `reasonCode` en evento | `"EXECUTION_MARKET_CONSTRAINTS_UNAVAILABLE"` | `"EXECUTION_MARKET_BID_INVALID"` (cuando constraints ok) |
| `allowCycleExits` | true | true (sin cambio) |
| `canCreateRange` | false | false (sin cambio) |
| ProjectionState | null | null (sin cambio) |

---

## 6. Archivos modificados

| Archivo | Cambio |
|---|---|
| `server/services/gridIsolated/gridIsolatedEngine.ts` | Separación try/catch, import RevolutXGridFailureStage |
| `server/services/gridIsolated/gridIsolatedTypes.ts` | Nuevo tipo RevolutXGridFailureStage |
| `server/services/botLogger.ts` | 2 nuevos EventType |
| `server/services/__tests__/gridIsolatedEngine.test.ts` | 14 nuevos tests T1–T14 |

---

## 7. Validación

- `npx tsc --noEmit` ✅
- `npm run build` ✅
- `git diff --check` ✅ (sin whitespace errors)
- Tests Grid (32 archivos, comando baseline): **819/819 pasados**, 0 fallidos
- Tests pre-existentes fallados (pre-REV-C12C): `gridShadowPolicy`, `gridCompactRange`, `gridSpacingCalculator`, `gridAdaptiveSmartRange` — sin cambios en esos archivos, fallos no causados por esta cascada

---

## 8. Estado post-corrección

- **Implementado**: ✅
- **Validado**: ✅
- **Comprometido**: ✅ (commits `8e8f127` + `d28d6c6` + `d230635`)
- **Subido**: ✅ (origin/review/grid-rev-c12a-20260731 = `d230635`)
- **Desplegado en staging**: NO (requiere autorización)

El error real de ticker seguirá ocurriendo en staging hasta que se despliegue el código + se confirme que los endpoints de Revolut X están accesibles. Esta corrección garantiza que cuando el error ocurra, quede registrado en los logs con el mensaje exacto, y que las constraints no sean descartadas innecesariamente.

---

## 9. Adenda REV-C12E (2026-08-03)

REV-C12C corrigió observabilidad y preservación de constraints. REV-C12E
elimina el ticker nativo Revolut X como dependencia operativa. Kraken es la
fuente central de datos de mercado y Revolut X continúa siendo el venue
exclusivo de ejecución.

Ver `AUDITORIAS/AUDITORIA_GRID_REV_C12E_ARQUITECTURA_DATOS_EJECUCION_2026-08-03.md`
para el detalle completo de la separación arquitectónica.

## 10. Correcciones tras segunda verificación independiente (2026-08-04)

Commits anteriores: 33094e5 (técnico), 7ff42bd (documental).

Defectos corregidos en REV-C12E:
- Rebuild manual reutiliza allocation y projection context pre-resuelto.
- buildRangeProposal fail-closed: allocation y projection context obligatorios.
- Gate canCreateRange fail-closed: exige allocation + split + projection + TTL + 0 blockers.
- Frescura invertida corregida en buildGridExecutionMarketSnapshot.
- UX fuentes correctas: executionGate.executionMarketSnapshot.executionVenue, pairConstraints.source.
- Encoding UTF-8 reparado: sin BOM, sin mojibake.

Matriz nueva real: 37 archivos, 934 tests, 0 failures.
npm run check: exit 0. npm run build: exit 0. git diff --check: exit 0.

Sin deploy. Sin merge. Sin VPS. Sin DB.

## 11. Validacion global final (2026-08-04)

- Commit tecnico: 39db52b6299e9a9f15a361d5324bb4e2b713c6be
- Commit documental: d8d56d5c6c6f274a788ae4f78000e52a0e416840
- Suite completa: 856 archivos, 3389 tests, 3330 pasados, 30 fallos historicos, 29 skipped.
- Cero fallos nuevos.
- CHECK_EXIT=0, BUILD_EXIT=0, DIFF_EXIT=0.
- MERGE=NO, DEPLOY=NO, VPS=NO, DB=NO, ordenes reales=0.
- APTA PARA VERIFICACION PRE-MERGE, SIN MERGE Y SIN DEPLOY.
