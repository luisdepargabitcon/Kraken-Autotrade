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

### Helper tests (20)

1. acepta array directo
2. acepta `{pairs:[...]}`
3. acepta mapa raíz oficial
4. extrae BTC/USD del mapa oficial
5. conserva ETH/USD junto a BTC/USD
6. rechaza null (it.each)
7. rechaza undefined (it.each)
8. rechaza string
9. rechaza número
10. rechaza objeto vacío
11. rechaza objeto de error
12. ignora metadata que no contiene base/quote
13. no muta el objeto original
14. mantiene strings decimales sin transformarlos
15. no acepta arrays vacíos
16. no acepta pairs vacío
17. array no vacío sin entries válidas → throw
18. wrapper no vacío sin entries válidas → throw
19. array mixto conserva solo el par válido
20. wrapper mixto conserva solo el par válido

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
11. error HTTP 401 con body sensible no aparece en ningún log
12. reason no contiene saltos de línea
13. reason tiene longitud máxima 240

Nota: la restauración del singleton (initialized y getHeaders) está implementada en afterEach, no es un test independiente.

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
- `signedGetJson` no contiene `response.text()` en su error (body no se incorpora al mensaje ni log)

## 6b. Corrección post-verificación

ARRAY_INVALID_NONEMPTY_REJECTED = TRUE
WRAPPER_INVALID_NONEMPTY_REJECTED = TRUE
SIGNED_GET_RESPONSE_BODY_LOGGED = FALSE
CONSTRAINT_REASON_MAX_LENGTH = 240
SENSITIVE_SENTINEL_LOGGED = FALSE

Defectos corregidos:
1. Arrays y wrappers no vacíos pero sin entries válidas ahora lanzan (antes devolvían []).
2. `signedGetJson` no incluye el body en el mensaje de error (usa statusText, no response.text()).
3. `sanitizeRevolutXConstraintError` limita reason a 240 chars y elimina saltos de línea/tabs.
4. Restauración correcta del singleton (initialized y getHeaders) en afterEach.
5. Conteo de tests corregido: 20 helper + 13 integración = 33 total nuevos.

SINGLETON_RESTORATION_IMPLEMENTED = TRUE
SINGLETON_RESTORATION_LOCATION = afterEach
SINGLETON_RESTORATION_COUNTED_AS_TEST = FALSE

## 6c. Estado documental pre-merge

TECH_INITIAL_SHA = c35cdb4ae4e48b142d851c88dcb9904c97aa211a
DOC_INITIAL_SHA = dd5109119786c5b2a420c5b159685ef578ade6e7
TECH_FIX_SHA = 1e309fef3bdba34ddfb36d3fd0d334f4764b4b6a
DOC_FIX_SHA = b2290411537df62a59728ffbf8c793aa7fe1886c
INDEPENDENT_VERIFICATION = PASSED_WITH_DOCUMENTATION_CORRECTION_ONLY
TECHNICAL_BLOCKERS = 0
MERGE = NO
DEPLOY = NO
DB = NO
REAL_ORDERS = 0

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
TASK_STATUS: REV-C12F corregida, publicada y verificada independientemente en rama review
NEXT_ACTION: fast-forward controlado de review a main
DEPLOY_AUTHORIZED: FALSE
MIGRATION_REQUIRED: FALSE
```

REV-C12E_COMPLETADA = TRUE (cierre histórico preservado)
GRID_NEW_ENTRIES_AVAILABLE = FALSE
GRID_NEW_ENTRIES_BLOCKER = REVOLUT_X_CONSTRAINTS_UNAVAILABLE (hasta deploy post-merge)
ALLOW_CYCLE_EXITS = TRUE

**REV-C12F CORREGIDA Y PUBLICADA EN RAMA DE REVISIÓN — PENDIENTE VERIFICACIÓN INDEPENDIENTE**
