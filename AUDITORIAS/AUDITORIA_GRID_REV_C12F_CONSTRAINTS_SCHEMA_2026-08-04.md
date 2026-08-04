# AUDITORIA_GRID_REV_C12F_CONSTRAINTS_SCHEMA_2026-08-04

## 1. Contexto

REV-C12F es la corrección mínima del schema de `configuration/pairs` Revolut X,
posterior al diagnóstico read-only REV-C12F que identificó la causa raíz
`G_PUBLIC_SCHEMA_MISMATCH`.

## 2. Causa raíz confirmada

REV-C12F_CAUSE = G_PUBLIC_SCHEMA_MISMATCH
OFFICIAL_RESPONSE_SHAPE = ROOT_PAIR_MAP
EXAMPLE_KEY = BTC/USD

El endpoint oficial `https://revx.revolut.com/api/1.0/public/configuration/pairs?region=EEA`
devuelve:

```json
{
  "BTC/USD": { "base": "BTC", "quote": "USD", "base_step": "0.00000001", ... },
  "ETH/USD": { ... }
}
```

El parser anterior solo aceptaba:
- array raíz;
- `{ pairs: [...] }`.

Por eso la respuesta oficial se rechazaba antes de encontrar BTC/USD.

## 3. Evidencia del diagnóstico read-only

- PUBLIC_HTTP = 200
- PUBLIC_JSON_VALID = TRUE
- HOST_BYTES = 87279
- CONTAINER_BYTES = 87279
- HOST_SHA256 = CONTAINER_SHA256 (respuestas idénticas)
- ENTRIES_EXTRACTED = 382
- BTC_USD_FOUND = TRUE
- BTC_USD_STATUS = active
- BTC_USD_BASE_STEP = "0.00000001"
- BTC_USD_QUOTE_STEP = "0.01"
- BTC_USD_MIN_ORDER_SIZE = "0.00000001"
- BTC_USD_MIN_ORDER_SIZE_QUOTE = "1"
- BTC_USD_MAX_ORDER_SIZE = "200"
- FIELD_TYPES: todos los campos numéricos son strings, status es string, slippage es number.

## 4. Corrección aplicada

### Helper único

`extractRevolutXPairConfigurationEntries(response: unknown): RevolutXPairConfigurationRaw[]`

Acepta tres formatos:
- A. Array directo: `[{ base, quote, ... }]`
- B. Wrapper histórico: `{ pairs: [{ base, quote, ... }] }`
- C. Mapa oficial Revolut X: `{ "BTC/USD": { base, quote, ... } }`

Contrato:
1. Si response es array: usa sus elementos objeto.
2. Si response es objeto y response.pairs es array: usa response.pairs.
3. Si response es objeto raíz: extrae `Object.values(response)`, conserva únicamente
   valores que no sean null, sean object, no sean array, y tengan base y quote de
   tipo string.
4. Si después del filtrado no queda ninguna entrada: lanza
   `new Error("Respuesta inválida de configuration/pairs")`.
5. No acepta strings, números, null, arrays vacíos, objetos de error, metadata sin
   base/quote.
6. No relaja parseStrictDecimal, status active, base exacta, quote exacta, mínimos,
   máximos, tick, quantity step.
7. No muta el objeto original.

### Endpoints modificados

- `getPairConfigurations()`: usa `extractRevolutXPairConfigurationEntries(response)`.
- `getPublicPairConfigurations(region)`: usa `extractRevolutXPairConfigurationEntries(body)`.

### Observabilidad sanitizada

En `resolveGridPairConstraints`:
- Log auth: `console.warn("[revolutx] pair constraints authenticated resolution failed", { pair, reason })`.
- Log público: `console.warn("[revolutx] pair constraints public resolution failed", { pair, region, reason })`.
- No expone API key, private key, firma, headers, body, cookies ni tokens.

### Fallback preservado

autenticado → público → caché → fail-closed.

## 5. Tests

### Helper tests (15)

1. acepta array directo
2. acepta `{pairs:[...]}`
3. acepta mapa raíz oficial
4. extrae BTC/USD del mapa oficial
5. conserva ETH/USD junto a BTC/USD
6. rechaza null
7. rechaza string
8. rechaza número
9. rechaza objeto vacío
10. rechaza objeto de error
11. ignora metadata que no contiene base/quote
12. no muta el objeto original
13. mantiene strings decimales sin transformarlos
14. no acepta arrays vacíos
15. no acepta pairs vacío

### Integración tests (13)

1. auth devuelve mapa raíz oficial: verified=true con constraints correctas
2. auth falla y público devuelve mapa raíz: verified=true con source público
3. BTC/USD ausente del mapa: verified=false, reasonCode=PAIR_CONSTRAINTS_UNAVAILABLE
4. status distinto de active: verified=false, reasonCode=PAIR_NOT_ACTIVE
5. base_step inválido: verified=false
6. quote_step inválido: verified=false
7. min_order_size_quote inválido: verified=false
8. max_order_size menor que min_order_size: verified=false
9. objeto de error no produce constraints verificadas
10. el mapa oficial no relaja la validación estricta
11. log auth sanitizado se emite cuando auth falla
12. log público sanitizado se emite cuando público falla
13. (incluido en 11/12) no expone credenciales en logs

### Tests Grid relacionados (105, 5 archivos)

- gridReferenceMarketResolver.test.ts: 15 tests
- gridExecutionCapabilityResolver.test.ts: 21 tests
- gridFillsConfirmation.test.ts: 10 tests
- gridPlanningContextResolver.test.ts: 48 tests
- gridExecutionServiceTakerFallback.test.ts: 11 tests

### Tests existentes (15)

- revolutXPairConstraints.test.ts: 15 tests (compatibilidad retroactiva)

## 6. Validación estática

- CHECK_EXIT = 0
- BUILD_EXIT = 0
- DIFF_EXIT = 0
- `git grep "Array.isArray(response).*pairs"` = 0 resultados (helper único confirmado)

## 7. Validación read-only del payload público real

```
{
  "http": 200,
  "entries": 382,
  "pair": "BTC/USD",
  "status": "active",
  "base_step": "0.00000001",
  "quote_step": "0.01",
  "min_order_size": "0.00000001",
  "min_order_size_quote": "1",
  "max_order_size": "200"
}
```

## 8. Archivos modificados

- `server/services/exchanges/RevolutXService.ts` (helper + endpoints + logs)
- `server/services/exchanges/__tests__/revolutXPairConstraintsSchema.test.ts` (nuevo)

## 9. Parámetros operativos

- DB_REQUIRED = FALSE
- MIGRATION_REQUIRED = FALSE
- DEPLOY_REQUIRED = TRUE_AFTER_REVIEW_AND_MERGE
- GRID_MODE = SHADOW
- REAL_ORDERS = 0

## 10. Estado

```
DONE: FALSE
HARD_BLOCKER: FALSE
TASK_STATUS: REV-C12F corregida en rama de revisión; pendiente verificación independiente
NEXT_ACTION: verificar commits y después autorizar merge
DEPLOY_AUTHORIZED: FALSE
MIGRATION_REQUIRED: FALSE
```

REV-C12E_COMPLETADA = TRUE (cierre histórico preservado)
GRID_NEW_ENTRIES_AVAILABLE = FALSE
GRID_NEW_ENTRIES_BLOCKER = REVOLUT_X_CONSTRAINTS_UNAVAILABLE (hasta deploy post-merge)
ALLOW_CYCLE_EXITS = TRUE

**REV-C12F CORREGIDA Y PUBLICADA EN RAMA DE REVISIÓN — PENDIENTE VERIFICACIÓN INDEPENDIENTE**
