# DEFECTS_AUDIT — Exit Position Management R1

Fecha: 2026-09-21
Scope: auditoría de defectos/deuda del exit policy E0 (`server/services/spot/spotExitPolicy.ts`)
y del harness de research R1. Documentación solamente — ningún defecto se corrige
fuera del scope R1 sin autorización.

Checks A–H pedidos en el plan de auditoría, con veredicto y evidencia.

## A) `timeEfficiencyNoProgressMinutes` usa tiempo-desde-apertura, no tiempo-desde-último-MFE — CONFIRMADO

`evaluateTimeEfficiency` mide el "no progress" como `now - position.openedAt > noProgressMs`
(`spotExitPolicy.ts:356-357`). No existe `lastMfeAt` ni `timeSinceLastMFE` en
`SpotPosition`/`SpotExitState`. Consecuencia: una posición que acaba de hacer un
MFE nuevo y está en pullback (R < 0.5) puede ser cerrada por "no progress" aunque
siga progresando. Es exactamente el defecto que la hipótesis E1-A corrige
(`staleSinceLastMfeMinutes` en `spotExitE1.ts`).

## B) `trailingStepPct` es config muerta — CONFIRMADO

Declarado en `SpotExitConfig` (`spotExitPolicy.ts:65`, default `0.5` en `:95`).
`evaluateTrailing` (`:273-296`) solo usa `trailingActivateAtPctR` y
`trailingDistancePct`; `trailingStepPct` no aparece en ninguna evaluación.
Deuda: parámetro expuesto que no hace nada → riesgo de falsa sensación de control.

## C) `regimeExitEnabled` + thresholds son config muerta — CONFIRMADO

`regimeExitEnabled`, `regimeExitAdxThreshold` (23) y `regimeExitHardAdxThreshold`
(19) declarados (`:76-78`, defaults `:103-105`). No existe `evaluateRegimeExit`
en la cadena de `evaluateExit` (`:372-412`); la cadena es EMERGENCY → STRUCTURE →
DEFENSIVE → BREAK_EVEN → TRAILING → PROFIT → TIME_EFFICIENCY. El deterioro de
régimen sí se evalúa parcialmente dentro de DEFENSIVE (ADX < `defensiveAdxThreshold`
con R<0, y flip a BEARISH con R<0.5), pero los thresholds `regimeExit*` no se leen
en ningún sitio. Deuda: config muerta + responsabilidad difusa entre DEFENSIVE y
un hipotético REGIME_EXIT.

## D) `defensiveMaxAdversePctR` es config muerta — CONFIRMADO

Declarado (`:56`, default `100` en `:88`, comentado como "1R adverse").
`evaluateDefensive` (`:214-241`) no lo referencia: solo ADX + direction flip.
El stop de emergencia cubre el adverse máximo de facto, pero el parámetro
documentado no gobierna nada. Config muerta.

## E) Trailing stop puede disminuir — NO CONFIRMADO

`state.trailingHighestPrice` es monótono creciente (`:284`, `Math.max`), y
`trailingStopPrice = highest * (1 - distancePct/100)` (`:287`), por tanto el stop
nunca baja una vez armado. Ratchet implícito correcto. Observación menor: el stop
se reescribe cada evaluación mientras R ≥ activación — equivalente por monotonía,
pero no hay guard explícito `newStop > prevStop`.

## F) Break-even puede reducir protección previa — PARCIAL / COSMÉTICO

`breakEvenStopPrice` se fija a `entryPrice * (1 + 0/100)` = entrada (`:259`) y no
se mueve. No sobrescribe `trailingStopPrice`. Interacción real: BE (prioridad 4)
se evalúa ANTES que TRAILING (prioridad 5); en un tick con gap que perfora ambos
stops, la salida se etiqueta BREAK_EVEN aunque el trailing stop (más alto) debió
capturar antes. El fill es el mismo `currentPrice`, así que el impacto económico
es nulo en replay; el impacto es de clasificación de `exitReason` (métricas por
razón sesgadas hacia BREAK_EVEN). Deuda menor.

## G) Salidas usando velas pre-entry — NO CONFIRMADO

`evaluateStructureInvalidation` filtra explícitamente velas 15m con
`closeTime > position.openedAt` (`:190-195`). El resto de evaluadores usan
`ctx.ticker.last` / régimen actual. Correcto.

## H) Salidas usando velas forming/futuras — NO CONFIRMADO (research path)

En el harness de research, `buildReplayContextFast` + `prepareCandles`
(`closedCandleContract`) construyen ctx solo con velas cerradas ≤ eval time, y los
fills ejecutan en el open de la siguiente vela 5m (misma convención en
`fastResearchReplay` y `fixedCohortReplay`). Sin lookahead en el path evaluado.

## Hallazgos adicionales del forense E0

- `avgCapturePct = -692.5` en `e0_forensic_summary.json`: métrica distorsionada
  (división por MFE≈0 en trades que nunca fueron positivos). Deuda de métrica:
  el aggregate no es robusto; usar capture solo sobre trades con MFE>0 o mediana.
- `evaluateDefensive` lee `ctx.regimeContext` sin guard de disponibilidad; si el
  ctx incompleto llegara con ADX=0 dispararía DEFENSIVE espurio con R<0.
- `fixedCohortReplay` hace `sorted5m.findIndex` dentro del loop de `evalTimes`
  (O(n²) por posición abierta larga). Funciona, pero es deuda de performance si
  se reutiliza para cohortes grandes.
- Forense E0 (ventana completa, 84 trades): netPnl=-85.19, PF=0.931,
  giveback medio 0.49R sobre MFE medio 0.567R → la tesis R1 (giveback/stale)
  está motivada por datos. ETH (PF 0.469) y XRP (PF 0.528) concentran la pérdida.

## Resumen

| Check | Descripción | Estado |
|-------|-------------|--------|
| A | no-progress desde apertura, no desde último MFE | CONFIRMADO → corrige E1-A |
| B | `trailingStepPct` muerto | CONFIRMADO (deuda) |
| C | `regimeExit*` muerto | CONFIRMADO (deuda) |
| D | `defensiveMaxAdversePctR` muerto | CONFIRMADO (deuda) |
| E | trailing puede bajar | NO CONFIRMADO |
| F | BE reduce protección previa | PARCIAL (etiquetado, no económico) |
| G | velas pre-entry | NO CONFIRMADO |
| H | velas forming/futuras | NO CONFIRMADO |

Ninguna corrección aplicada fuera del scope R1. B/C/D quedan como deuda
documentada para una limpieza de config futura.
