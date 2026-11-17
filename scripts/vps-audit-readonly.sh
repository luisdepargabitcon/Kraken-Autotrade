#!/usr/bin/env bash
# NEXA VPS: consulta no destructiva. Nunca deploy, ordenes, cambios SQL ni restart.
set -uo pipefail
export LC_ALL=C
echo '=== NEXA VPS AUDIT READ ONLY ==='
date -u '+utc=%Y-%m-%dT%H:%M:%SZ'
hostname | cut -c1-80
uname -sr
echo '=== VERSION DESPLEGADA ==='
if [ -d /opt/krakenbot-staging/.git ]; then
 (cd /opt/krakenbot-staging && git rev-parse HEAD && git log -1 --format='%cI %s' && git branch --show-current) || true
else
 echo 'git_deploy=NOT_FOUND'
fi
echo '=== PUERTOS ESPERADOS ==='
if command -v ss >/dev/null 2>&1; then
 ss -lnt 2>/dev/null | awk 'NR==1 || $4 ~ /:(22|80|443|2222|3020|5435)$/ {print}' | head -25
fi
echo '=== CONTENEDORES ==='
if command -v docker >/dev/null 2>&1; then
 docker ps --format '{{.Names}} | {{.Image}} | {{.Status}}' 2>&1 | head -35
 docker inspect -f 'staging_image={{.Image}} started={{.State.StartedAt}} status={{.State.Status}}' krakenbot-staging-app 2>/dev/null || true
else
 echo 'docker=NOT_AVAILABLE'
fi
echo '=== SALUD API (solo campos permitidos) ==='
if command -v curl >/dev/null 2>&1 && command -v python3 >/dev/null 2>&1; then
 curl -fsS --max-time 8 http://127.0.0.1:3020/api/health 2>/dev/null | python3 -c 'import json,sys;d=json.load(sys.stdin);print("health:",d.get("status"),"uptime:",d.get("uptime"))' || echo 'health=UNAVAILABLE'
 curl -fsS --max-time 8 http://127.0.0.1:3020/api/trading/status 2>/dev/null | python3 -c 'import json,sys;d=json.load(sys.stdin);print("spot_running:",d.get("engineRunning"),"kraken_connected:",d.get("krakenConnected"))' || echo 'trading_status=UNAVAILABLE'
fi
echo '=== POSTGRESQL: TRANSACCION READ ONLY ==='
if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -qx 'krakenbot-staging-db'; then
 docker exec -i krakenbot-staging-db sh -c '
   export PGOPTIONS="-c default_transaction_read_only=on -c statement_timeout=12000"
   export PGPASSWORD="$POSTGRES_PASSWORD"
   exec psql -X -q -A -F " | " -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f -
 ' <<'SQL' || echo 'DB_AGGREGATES=FAILED_OR_SCHEMA_DIFFERENT'
BEGIN READ ONLY;
SELECT 'VERSION',current_database(),current_setting('server_version');
SELECT 'TABLE',name,to_regclass('public.' || name) IS NOT NULL FROM (VALUES ('trades'),('dry_run_trades'),('trade_snapshots'),('institutional_dca_cycles'),('institutional_dca_events'),('grid_isolated_cycles'),('grid_isolated_events'),('open_positions')) t(name);
SELECT (to_regclass('public.trades') IS NOT NULL) AS t \gset
\if :t
SELECT 'SPOT_REAL',type,status,count(*),round(coalesce(sum(realized_pnl_usd::numeric),0),2) FROM trades WHERE executed_by_bot IS TRUE GROUP BY type,status ORDER BY count(*) DESC LIMIT 20;
\endif
SELECT (to_regclass('public.dry_run_trades') IS NOT NULL) AS t \gset
\if :t
SELECT 'SPOT_DRY_SELL',coalesce(normalized_reason,'UNKNOWN'),count(*),round(coalesce(sum(realized_pnl_usd::numeric),0),2) FROM dry_run_trades WHERE type='sell' AND excluded_from_pnl IS FALSE GROUP BY normalized_reason ORDER BY count(*) DESC LIMIT 25;
\endif
SELECT (to_regclass('public.trade_snapshots') IS NOT NULL) AS t \gset
\if :t
SELECT 'SNAPSHOT',source_mode,strategy_type,snapshot_type,count(*),round(coalesce(sum(pnl_net_usd::numeric),0),2) FROM trade_snapshots GROUP BY source_mode,strategy_type,snapshot_type ORDER BY count(*) DESC LIMIT 25;
\endif
SELECT (to_regclass('public.institutional_dca_cycles') IS NOT NULL) AS t \gset
\if :t
SELECT 'IDCA_CYCLE',mode,status,count(*),round(coalesce(sum(realized_pnl_usd::numeric),0),2) FROM institutional_dca_cycles GROUP BY mode,status ORDER BY mode,status;
SELECT 'IDCA_CLOSE',mode,coalesce(close_reason,'UNKNOWN'),count(*),round(coalesce(sum(realized_pnl_usd::numeric),0),2) FROM institutional_dca_cycles WHERE status='closed' GROUP BY mode,close_reason ORDER BY count(*) DESC LIMIT 25;
\endif
SELECT (to_regclass('public.institutional_dca_events') IS NOT NULL) AS t \gset
\if :t
SELECT 'IDCA_BLOCK_72H',mode,event_type,coalesce(reason_code,'NONE'),count(*) FROM institutional_dca_events WHERE created_at >= now()-interval '72 hours' GROUP BY mode,event_type,reason_code ORDER BY count(*) DESC LIMIT 35;
\endif
SELECT (to_regclass('public.grid_isolated_cycles') IS NOT NULL) AS t \gset
\if :t
SELECT 'GRID_CYCLE',pair,status,count(*),round(coalesce(sum(net_pnl_usd::numeric),0),2) FROM grid_isolated_cycles GROUP BY pair,status ORDER BY pair,status;
\endif
SELECT (to_regclass('public.grid_isolated_events') IS NOT NULL) AS t \gset
\if :t
SELECT 'GRID_EVENT_72H',mode,event_type,count(*) FROM grid_isolated_events WHERE created_at >= now()-interval '72 hours' GROUP BY mode,event_type ORDER BY count(*) DESC LIMIT 35;
\endif
SELECT (to_regclass('public.open_positions') IS NOT NULL) AS t \gset
\if :t
SELECT 'OPEN_SPOT',exchange,pair,count(*) FROM open_positions GROUP BY exchange,pair ORDER BY exchange,pair;
\endif
COMMIT;
SQL
else
 echo 'staging_postgres=NOT_FOUND'
fi
echo '=== CONTADORES DE ERRORES (sin logs crudos) ==='
if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -qx 'krakenbot-staging-app'; then
 docker logs --since 24h --tail 15000 krakenbot-staging-app 2>&1 |
   grep -oE 'ENTRY_BLOCKED|no_rebound_confirmed|confluence_no_entry|insufficient_dip|GRID_SHADOW_NO_VIABLE_RANGE|EXECUTION_MARKET_SNAPSHOT_UNAVAILABLE|PLANNING_CONTEXT_INCOMPLETE|SMART_EXIT_EXECUTED|TIME_STOP_CLOSE|STOP_LOSS_HIT|GRID_SHADOW_NO_LEVELS|RATE_LIMIT' |
   sort | uniq -c | sort -nr | head -50 || true
fi
echo '=== FIN: sin operaciones de escritura ==='
