# SPOT SHADOW forward extraction — since last V4 deploy

Extracción READ-ONLY de todas las operaciones SPOT SHADOW desde el último
deploy de Entry V4 (corrección `3ae18319`, container recreado
2026-09-20 11:12:22 UTC) hasta 2026-09-24 ~12:26 UTC.

Sin cambios en producción, sin código modificado, sin deploy, sin REAL.
Consultas: SELECT only sobre `krakenbot-staging-db` (krakenbot_staging).

## Fuentes

- `trades` (engine_owner=SPOT_CANONICAL, execution_mode=SHADOW): operaciones
  cerradas canónicas — PnL, fees, exit reason, MFE/MAE, hold time.
- `spot_forward_twin_snapshots` (snapshot_type=SUPERVISOR): openedAt exacto
  (ms), riskUsd, initialStop, MFE/MAE evolutivos, estados BE/trailing, decisiones
  de salida.
- `spot_forward_twin_snapshots` (snapshot_type=SCAN): señal canónica, intent
  (state, v4QualityScore/v4Threshold/v4Accepted/v4RejectReason), sizing
  (approved/blockCode/riskUsd/notional/stop), régimen, ADX, ATR%, spread,
  volumen.
- `spot_forward_twin_snapshots` (snapshot_type=FILL): fills BUY/SELL con
  notional/fee/slippage.
- `open_positions`: vacía → 0 posiciones abiertas.

## Archivos

- `SPOT_CLOSED_TRADES.csv/.json` — cohorte principal: 29 trades cerrados
  abiertos >= deploy. Match 1:1 verificado contra intents EXECUTED.
- `OPEN_POSITIONS_NOW.csv` — cabecera solamente (0 abiertas).
- `CARRYOVER_PRE_DEPLOY.csv` — 0 filas (ninguna posición pre-deploy cerró
  después del deploy).
- `SPOT_ENTRY_DECISIONS.csv` — 370 decisiones de entrada: 29 BUY_EXECUTED,
  250 BUY_ALLOWED (aprobado pero sin ejecución en esa ventana), 91 BUY_BLOCKED.
- `SPOT_EXIT_EVENTS.csv` — 27 evaluaciones de supervisor con shouldExit=true
  sobre la cohorte.
- `SPOT_ENTRY_CLUSTERS.csv` — agrupación de entradas dependientes (mismo
  pair + setupTag, separación consecutiva <30min): 29 trades → 20 clusters.
- `SUMMARY.md` — hechos agregados con scope separado CERTIFIED_V4 (4 pares) vs
  OTHER_SPOT_PAIRS (TON).
- `process.cjs` — script de procesamiento reproducible (local, read-only).
- Los dumps psql crudos (`raw/`) NO se suben a Git por política anti-dumps;
  los CSV finales contienen todos los campos extraídos.

## Corrección v2 (data integrity)

- Export re-hecho como **JSONL estructurado** (`jsonb_build_object` por fila)
  — elimina el bug de `split(",")` sobre campos quoted con comas que desplazaba
  columnas en SPOT_ENTRY_DECISIONS.csv.
- `entryStrategyId` ya no está hardcodeado: no se persiste para trades
  cerrados → NULL documentado.
- Estados de salida por lifecycle completo del lot: highestPrice = máximo
  observado, breakEven/trailingActivated = ANY snapshot true; último snapshot
  ≤ close como estado final. Validación: 0 trades TRAILING sin flag.
- Revalidado contra SQL directo: TRADE_COUNT/NET_PNL/FEES/LOTID = MATCH.

## Notas

- La cohorte incluye 2 trades TON/USD: el motor SPOT también opera TON; la
  validación por par los señala fuera de BTC/ETH/SOL/XRP.
- Los 5 componentes V4 (impulse/retracement/structure/reclaim/resumption) NO se
  persisten por trade — el intent solo guarda v4QualityScore/Threshold/Accepted/
  RejectReason, y en esta build llegan a NULL (campos presentes pero no
  poblados en el snapshot SCAN). La sección `sizing` del SCAN es una
  pre-evaluación diagnóstica (siempre approved=false con blockCode) — no es el
  sizing ejecutado; el sizing real se recupera vía supervisor/FILL.
- Deploy verificado: VPS `/opt/krakenbot-staging` HEAD = 3ae18319 (commit
  11:11:29 UTC) + container CreatedAt 11:12:22 UTC. La app reinició 2026-09-24
  11:59 UTC (restart, sin recreación — CreatedAt intacto).
