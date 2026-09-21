# TEST_RESULTS — Exit R1 (metodología corregida)

Suite: `server/services/__tests__/exitR1.test.ts`
Comando: `DATABASE_URL=postgres://dummy:dummy@localhost:5432/dummy npx vitest run server/services/__tests__/exitR1.test.ts`
Resultado (2026-09-21): **26/26 PASS** (14 originales + 12 de corrección metodológica)

## Tests originales (14) — todos PASS

EXIT_NO_LOOKAHEAD · ENTRY_V4_FROZEN · EMERGENCY_UNCHANGED+INITIAL_STOP_UNCHANGED
· STRUCTURE_TEMPORAL_CONTRACT · TRAILING_STOP_NEVER_DECREASES (ATR ratchet)
· BREAK_EVEN_NEVER_REDUCES_PROTECTION · TIME_SINCE_LAST_MFE + MFE_ONLY_MOVES_UP (2)
· E1_DISABLED_EQUIVALENT_TO_E0 · FIXED_COHORT_REPRODUCES_E0 ·
FUTURE_CANDLE_INVARIANCE · FORMING_CANDLE_INVARIANCE · NO_PAIR_SPECIFIC_PARAMETERS
· NO_TEST_RETUNE (E0 config frozen)

## Tests añadidos (12) — todos PASS

| Test | Verifica |
|------|----------|
| HISTORICAL_ENTRY_THRESHOLDS_FIXED | constante = [0.50, 0.30, 0.30], len 3 |
| FOLD0_ENTRY_THRESHOLD_050 | fold0 = 0.50 |
| FOLD1_ENTRY_THRESHOLD_030 | fold1 = 0.30 |
| FOLD2_ENTRY_THRESHOLD_030 | fold2 = 0.30 |
| GRID_EXACTLY_96 | buildGrid() = 96 combos |
| GRID_BALANCED | cada valor de dimensión con frecuencia igual (32/48), 96 labels únicos |
| FIXED_COHORT_E1_SAME_ENTRIES | cohort E1 preserva lotIds/signalId/conteo |
| FIXED_COHORT_E1_SAME_ENTRY_PRICE | cohort E1 no modifica entryPrice/openedAtMs |
| FIXED_COHORT_E1_SAME_SIZE | cohort E1 no modifica volume |
| FIXED_COHORT_E1_SAME_INITIAL_STOP | frozenEntryToPosition preserva initialStop* |
| PRODUCTION_030_HAS_E0_AND_E1 | PRODUCTION_030_THRESHOLDS=[0.30×3], ambos evaluadores invocables |
| NO_TEST_RETUNE (extendido) | grid determinista e independiente de resultados test |
