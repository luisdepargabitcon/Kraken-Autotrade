# AUDITORIA GRID REV-C12G — TAKER FALLBACK EFECTIVO EN SHADOW (2026-08-05)

## Causa raíz

REV_C12G_CAUSE = A_STORED_FLAG_PASSED_INSTEAD_OF_EFFECTIVE

El tick automático (`gridIsolatedEngine.ts`) y el rebuild manual pasaban
`this.config.takerFallbackEnabled` (valor almacenado en DB = `true`) al resolver
`resolveGridExecutionCapability`, sin aplicar el override SHADOW que fuerza `false`.
El audit (`gridIsolated.routes.ts`) sí aplicaba el override mediante un ternario
local duplicado (`mode === "SHADOW" ? false : storedTakerFallbackEnabled`).

Resultado: el tick recibía `TAKER_FALLBACK_NOT_DISABLED` mientras el audit mostraba
`effectiveTakerFallbackEnabled=false`. Divergencia entre tick, rebuild y audit.

## Valores observados en staging (SHA 482d3e4)

- STORED_TAKER_FALLBACK_ENABLED = TRUE
- SHADOW_EFFECTIVE_TAKER_FALLBACK_ENABLED = FALSE
- TICK_BEFORE = STORED_TRUE
- TICK_AFTER = EFFECTIVE_FALSE
- REBUILD_BEFORE = STORED_TRUE
- REBUILD_AFTER = EFFECTIVE_FALSE
- AUDIT_BEFORE = EFFECTIVE_FALSE_WITH_LOCAL_DUPLICATED_RULE
- AUDIT_AFTER = EFFECTIVE_FALSE_WITH_SHARED_HELPER

## Corrección

SHARED_HELPER = getEffectiveTakerFallbackEnabled

Helper canónico creado en `gridIsolatedTypes.ts` junto a `getEffectiveExecutionPolicy`:

```ts
export function getEffectiveTakerFallbackEnabled(
  config: { mode: GridMode; takerFallbackEnabled: boolean },
): boolean {
  if (config.mode === "SHADOW") {
    return false;
  }
  return config.takerFallbackEnabled;
}
```

Usado en:
- Tick automático (`gridIsolatedEngine.ts:1344`)
- Rebuild manual (`gridIsolatedEngine.ts:5024`)
- Auditoría (`gridIsolated.routes.ts:1333`)

El tick, rebuild y audit ahora dependen de la misma función canónica. No se vuelve
a implementar manualmente el ternario en routes.

## Metadata del evento corregida

El evento `EXECUTION_MARKET_SNAPSHOT_UNAVAILABLE` mantenía su tipo histórico
(para compatibilidad) pero ahora:
- Mensaje: "Gate de planificación Grid bloqueado: se conservan salidas abiertas
  y se bloquean BUY, rebuild y rangos nuevos."
- Metadata añadida: `blockerComponent`, `blockerExplanation`,
  `referenceMarketVerified`, `executionCapabilityVerified`,
  `executionMarketSnapshotVerified`, `pairConstraintsVerified`,
  `effectiveTakerFallbackEnabled`.

## Aclaraciones

- `executionMarketSnapshot` se calcula independientemente de `executionCapability`.
- El bloqueo observado procedía de `executionCapability` (TAKER_FALLBACK_NOT_DISABLED),
  no de `executionMarketSnapshot`.
- El evento histórico tenía un nombre genérico que no identificaba el componente
  bloqueante real.
- La metadata ahora identifica `blockerComponent` para distinguir
  REFERENCE_MARKET, EXECUTION_CAPABILITY, PAIR_CONSTRAINTS,
  EXECUTION_MARKET_SNAPSHOT y PLANNING_GATE.
- No se modificó el valor stored de DB. El stored `takerFallbackEnabled=true`
  permanece en la fila de configuración.

## Tests

- 10 tests nuevos del helper en `gridEffectiveExecutionPolicy.test.ts`.
- 1 test nuevo del planning context en `gridPlanningContextResolver.test.ts`
  (I14: SHADOW con stored=true → effective=false → executionCapability.verified=true).
- Tests existentes del resolver confirmados (21 tests, incluyendo
  TAKER_FALLBACK_NOT_DISABLED con takerFallbackEnabled=true).
- 91 tests dirigidos pasados (4 archivos).
- 73 tests Revolut X/Grid relacionados pasados (4 archivos).

## Validación estática

- CHECK_EXIT=0
- BUILD_EXIT=0
- DIFF_EXIT=0

## Parámetros

DB_REQUIRED = FALSE
MIGRATION_REQUIRED = FALSE
DEPLOY_REQUIRED = TRUE_AFTER_REVIEW_AND_MERGE
GRID_MODE = SHADOW
REAL_ORDERS = 0

## Corrección post-verificación independiente (2026-08-05)

EFFECTIVE_EXECUTION_POLICY_SHARED = TRUE
TICK_EFFECTIVE_POLICY = MAKER_ONLY_IN_SHADOW
REBUILD_EFFECTIVE_POLICY = MAKER_ONLY_IN_SHADOW
AUDIT_EFFECTIVE_POLICY = MAKER_ONLY_IN_SHADOW
PAIR_CONSTRAINTS_PRECEDES_EXECUTION_CAPABILITY = TRUE
CIRCUIT_BREAKER_COMPONENT_SUPPORTED = TRUE
PUMP_GUARD_COMPONENT_SUPPORTED = TRUE
BLOCKER_REASON_CODE_ALWAYS_NON_NULL = TRUE
BLOCKER_EXPLANATION_ALWAYS_NON_EMPTY = TRUE
UNNECESSARY_BOOLEAN_NORMALIZATION_REMOVED = TRUE

Cuatro defectos corregidos tras verificación independiente:

1. PAIR_CONSTRAINTS ahora precede a EXECUTION_CAPABILITY en la prioridad del
   blocker. Una capability inválida puede ser consecuencia directa de
   constraints inválidas, por lo que las constraints deben identificarse primero.

2. Circuit breaker y Pump Guard ahora se identifican en blockerComponent.
   El helper `resolveGridPlanningBlockerMetadata` soporta CIRCUIT_BREAKER y
   PUMP_GUARD como componentes distintos, con reasonCode siempre no nulo y
   explicación siempre no vacía.

3. Tick y rebuild ahora usan `getEffectiveExecutionPolicy` además de
   `getEffectiveTakerFallbackEnabled`. Antes pasaban la policy almacenada al
   resolver; ahora pasan la policy efectiva (MAKER_ONLY en SHADOW).

4. Se restauró `takerFallbackEnabled: this.config.takerFallbackEnabled` en
   saveConfig (representación del valor almacenado). El cambio innecesario
   `Boolean(...)` fue eliminado. La normalización efectiva ocurre solo al
   construir el planning context.

Helper puro de metadata de bloqueo: `gridPlanningBlockerMetadata.ts`
- Función `resolveGridPlanningBlockerMetadata(input)` devuelve
  `{ blockerComponent, reasonCode, blockerExplanation }`.
- Prioridad: REFERENCE_MARKET > PAIR_CONSTRAINTS > EXECUTION_CAPABILITY >
  EXECUTION_MARKET_SNAPSHOT > CIRCUIT_BREAKER > PUMP_GUARD > PLANNING_GATE.
- reasonCode siempre no nulo; blockerExplanation siempre no vacía.
- No usa explicación positiva de componente verificado como explicación de bloqueo.

Aclaraciones:
- El helper del taker original se mantiene.
- stored takerFallbackEnabled=true no se modifica.
- executionPolicy almacenada tampoco se modifica.
- Solo se normalizan valores efectivos en runtime.
- No se desplegó.
- No se modificó DB.

Tests post-verificación:
- 14 tests helper política efectiva (gridEffectiveExecutionPolicy.test.ts).
- 10 tests blocker metadata (gridPlanningBlockerMetadata.test.ts).
- 50 tests planning context (gridPlanningContextResolver.test.ts, +1 I15).
- 21 tests capability resolver.
- 84 tests Revolut X/Grid relacionados.
- CHECK_EXIT=0, BUILD_EXIT=0, DIFF_EXIT=0.

## Estado

DONE: FALSE
HARD_BLOCKER: FALSE
TASK_STATUS: REV-C12G corregida tras verificación independiente; pendiente nueva verificación
NEXT_ACTION: verificar commits antes de fast-forward
DEPLOY_AUTHORIZED: FALSE
MIGRATION_REQUIRED: FALSE
