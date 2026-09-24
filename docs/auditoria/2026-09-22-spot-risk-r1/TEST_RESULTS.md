# TEST_RESULTS — Risk R1

Suites: `server/services/__tests__/riskR1.test.ts` (+ regresión `exitR1.test.ts`)
Comando: `DATABASE_URL=postgres://dummy:dummy@localhost:5432/dummy npx vitest run server/services/__tests__/riskR1.test.ts server/services/__tests__/exitR1.test.ts`
Resultado (2026-09-24): **38/38 PASS** (riskR1 12 + exitR1 26)

## riskR1.test.ts — 12 tests

| Test | Resultado |
|------|-----------|
| ENTRY_V4_FROZEN (threshold 0.30, weights 0.20×5) | PASS |
| EXIT_E0_FROZEN (DEFAULT_SPOT_EXIT_CONFIG intacto) | PASS |
| RISK_NEVER_EXCEEDS_BASE (mult>1 en config → clamp ≤1) | PASS |
| RISK_MULTIPLIER_BOUNDED ([0.25,1.0] en todo el grid × contextos) | PASS |
| RISK_NO_LOOKAHEAD (output idéntico con velas futuras en ctx) | PASS |
| RISK_FORMING_CANDLE_INVARIANCE | PASS |
| RISK_FUTURE_CANDLE_INVARIANCE | PASS |
| SAME_ENTRY_FIXED_COHORT (stop/entry no cambian al escalar) | PASS |
| SAME_EXIT_FIXED_COHORT (id.) | PASS |
| SAME_STOP_FIXED_COHORT (stopPrice/stopDistance idénticos, volume/fee ∝ m) | PASS |
| UNIFORM_75_CONTROL / UNIFORM_50_CONTROL (multiplicador constante exacto) | PASS |
| NO_PAIR_SPECIFIC_PARAMETERS | PASS |
| NO_TEST_RETUNE (grid determinista 24, sin campos de fold/test) | PASS |
| PRODUCTION_030_SECONDARY_ONLY ([0.30×3] vs histórico [0.50,0.30,0.30]) | PASS |

## exitR1.test.ts — regresión 26/26 PASS (sin cambios de comportamiento)

## WFO runtime

- FIXED_COHORT_PASS=YES (todos los snapshots de entrada recuperados por lotId)
- Determinismo del replay verificado contra R0 (mismas entradas sin scaler).
- Grid assert `===24` activo en buildGrid().
