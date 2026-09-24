DEPLOY_CODE_SHA=3ae18319b8c0b68c9374241db65f8ef9bdd39a57
DEPLOY_TIMESTAMP_UTC=2026-09-20 11:12:22 UTC (docker CreatedAt krakenbot-staging-app; VPS git HEAD=3ae18319 committed 11:11:29 UTC)
DEPLOY_TIMESTAMP_MADRID=2026-09-20 13:12:22 Europe/Madrid (CEST, UTC+2)

EXTRACTION_END_UTC=2026-09-24T12:26:42.231Z
EXTRACTION_END_MADRID=2026-09-24T14:26:42.231 (approx CEST)

SPOT_MODE=SHADOW

TOTAL_CLOSED=29
TOTAL_OPEN=0 (open_positions table empty)
TOTAL_CARRYOVER=0

BTC_CLOSED=3
ETH_CLOSED=6
SOL_CLOSED=5
XRP_CLOSED=13
OTHER_PAIRS_CLOSED=2 (TON/USD — SPOT engine also trades TON; kept in extraction, flagged by pair validation)

TOTAL_ENTRY_EXECUTED=29
TOTAL_ENTRY_ALLOWED=250
TOTAL_ENTRY_BLOCKED=91
TOTAL_EXIT_EVENTS=27

EARLIEST_ENTRY=2026-09-21T08:25:01.618Z
LATEST_ENTRY=2026-09-23T04:38:10.958Z

NET_PNL_CLOSED=-166.04
TOTAL_FEES=124.32
WINNERS=12
LOSERS=17
PF=0.513
EXPECTANCY=-5.726
MAX_DD=236.38

VALIDATION: dupLotId=0 badOpenCloseTimes=0 nonShadow=0

DATA_SOURCE=MIXED (trades=DB canonical; openedAt/riskUsd/stop=DB supervisor snapshots; v4/context=DB scan snapshots; fills=DB fill snapshots)
MISSING_FIELDS=impulse/retracement/structure/reclaim/resumption scores NOT persisted per trade (v4 component breakdown not stored in scan intent row — only v4QualityScore/v4Threshold/v4Accepted/v4RejectReason); signalConfidence not persisted on trade rowsNOTE=29 executed intents match 29 closed trades 1:1 (signalId verified). EXIT_EVENTS=27/29 — 2 lots lack a supervisor shouldExit snapshot in the extracted window (exit itself recorded canonically in trades table).
