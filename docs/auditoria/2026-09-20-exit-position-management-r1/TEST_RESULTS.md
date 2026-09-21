# TEST_RESULTS — Exit R1

Suite: `server/services/__tests__/exitR1.test.ts`
Comando: `DATABASE_URL=postgres://dummy:dummy@localhost:5432/dummy npx vitest run server/services/__tests__/exitR1.test.ts`
Resultado (2026-09-20, sesión previa): **14/14 PASS**

| # | Test | Resultado |
|---|------|-----------|
| 1 | E1 evaluator decision depends only on ctx ≤ now and carried state | PASS |
| 2 | E1 evaluator never touches entry logic — only exit decision shape | PASS |
| 3 | E1 with all flags still triggers emergency at initial stop | PASS |
| 4 | pre-entry candles below EMA cannot trigger structure exit | PASS |
| 5 | ATR ratchet stop is monotonic non-decreasing | PASS |
| 6 | fee-aware BE stop is always >= raw entry-price BE stop | PASS |
| 7 | stale timer resets only on new MFE highs, never on lower prices | PASS |
| 8 | MFE tracking only moves up | PASS |
| 9 | E1 with no flags produces identical decisions to evaluateExit | PASS |
| 10 | cohort replay with E0 evaluator reproduces the same exit on synthetic data (FIXED_COHORT_REPRODUCES_E0) | PASS |
| 11 | decision at time T is identical whether or not future candles exist | PASS |
| 12 | exit decision identical with/without forming candle present | PASS |
| 13 | E1 config has no per-pair fields | PASS |
| 14 | DEFAULT_SPOT_EXIT_CONFIG values are unchanged (E0 frozen) | PASS |

Cobertura de propiedades: temporalidad (sin lookahead, sin velas pre-entry ni
forming), invarianza E0, monotonicidad de ratchet/MFE, prioridad de emergencia,
gate de reproducción fixed-cohort, y congelamiento de Entry V4 / config E0.
