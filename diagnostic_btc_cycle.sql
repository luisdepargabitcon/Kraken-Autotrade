-- ═══════════════════════════════════════════════════════════════════════════════
-- DIAGNÓSTICO CICLO BTC ACTIVO - SOLO LECTURA
-- Ejecutar en: docker exec -it krakenbot-staging-db psql -U krakenstaging -d krakenbot_staging -f diagnostic_btc_cycle.sql
-- ═══════════════════════════════════════════════════════════════════════════════

\echo '═══════════════════════════════════════════════════════════════════════════════'
\echo '1. DATOS DEL CICLO BTC ACTIVO'
\echo '═══════════════════════════════════════════════════════════════════════════════'

SELECT 
  id AS cycle_id,
  pair,
  status,
  cycle_type,
  total_quantity AS db_total_quantity,
  capital_used_usd AS db_capital_used_usd,
  avg_entry_price AS db_avg_entry_price,
  current_price AS db_current_price,
  unrealized_pnl_usd AS db_unrealized_pnl_usd,
  unrealized_pnl_pct AS db_unrealized_pnl_pct,
  started_at,
  updated_at
FROM institutional_dca_cycles 
WHERE pair = 'BTC/USD' AND status = 'active' 
ORDER BY started_at DESC 
LIMIT 1;

\echo '═══════════════════════════════════════════════════════════════════════════════'
\echo '2. ÓRDENES BUY DEL CICLO BTC ACTIVO'
\echo '═══════════════════════════════════════════════════════════════════════════════'

SELECT 
  id AS order_id,
  cycle_id,
  order_type,
  side,
  quantity AS order_quantity,
  gross_value_usd AS order_gross_usd,
  fees_usd AS order_fees_usd,
  net_value_usd AS order_net_usd,
  executed_quantity AS executed_quantity,
  executed_usd AS executed_usd,
  avg_fill_price AS avg_fill_price,
  execution_status,
  executed_at
FROM institutional_dca_orders 
WHERE pair = 'BTC/USD' 
  AND side = 'buy'
  AND cycle_id = (SELECT id FROM institutional_dca_cycles WHERE pair = 'BTC/USD' AND status = 'active' ORDER BY started_at DESC LIMIT 1)
ORDER BY executed_at ASC;

\echo '═══════════════════════════════════════════════════════════════════════════════'
\echo '3. ÓRDENES SELL DEL CICLO BTC ACTIVO'
\echo '═══════════════════════════════════════════════════════════════════════════════'

SELECT 
  id AS order_id,
  cycle_id,
  order_type,
  side,
  quantity AS order_quantity,
  gross_value_usd AS order_gross_usd,
  fees_usd AS order_fees_usd,
  net_value_usd AS order_net_usd,
  executed_quantity AS executed_quantity,
  executed_usd AS executed_usd,
  avg_fill_price AS avg_fill_price,
  execution_status,
  executed_at
FROM institutional_dca_orders 
WHERE pair = 'BTC/USD' 
  AND side = 'sell'
  AND cycle_id = (SELECT id FROM institutional_dca_cycles WHERE pair = 'BTC/USD' AND status = 'active' ORDER BY started_at DESC LIMIT 1)
ORDER BY executed_at ASC;

\echo '═══════════════════════════════════════════════════════════════════════════════'
\echo '4. RESUMEN DE ÓRDENES BUY'
\echo '═══════════════════════════════════════════════════════════════════════════════'

SELECT 
  COUNT(*) AS buy_order_count,
  COALESCE(SUM(executed_quantity), 0) AS total_buy_quantity,
  COALESCE(SUM(executed_usd), 0) AS total_buy_usd,
  COALESCE(SUM(fees_usd), 0) AS total_buy_fees_usd,
  COALESCE(AVG(avg_fill_price), 0) AS avg_buy_price
FROM institutional_dca_orders 
WHERE pair = 'BTC/USD' 
  AND side = 'buy'
  AND cycle_id = (SELECT id FROM institutional_dca_cycles WHERE pair = 'BTC/USD' AND status = 'active' ORDER BY started_at DESC LIMIT 1);

\echo '═══════════════════════════════════════════════════════════════════════════════'
\echo '5. RESUMEN DE ÓRDENES SELL'
\echo '═══════════════════════════════════════════════════════════════════════════════'

SELECT 
  COUNT(*) AS sell_order_count,
  COALESCE(SUM(executed_quantity), 0) AS total_sell_quantity,
  COALESCE(SUM(executed_usd), 0) AS total_sell_usd,
  COALESCE(SUM(fees_usd), 0) AS total_sell_fees_usd,
  COALESCE(AVG(avg_fill_price), 0) AS avg_sell_price
FROM institutional_dca_orders 
WHERE pair = 'BTC/USD' 
  AND side = 'sell'
  AND cycle_id = (SELECT id FROM institutional_dca_cycles WHERE pair = 'BTC/USD' AND status = 'active' ORDER BY started_at DESC LIMIT 1);

\echo '═══════════════════════════════════════════════════════════════════════════════'
\echo '6. CANTIDAD NETA ESTIMADA (BUY - SELL)'
\echo '═══════════════════════════════════════════════════════════════════════════════'

SELECT 
  (SELECT COALESCE(SUM(executed_quantity), 0) FROM institutional_dca_orders WHERE pair = 'BTC/USD' AND side = 'buy' AND cycle_id = (SELECT id FROM institutional_dca_cycles WHERE pair = 'BTC/USD' AND status = 'active' ORDER BY started_at DESC LIMIT 1)) 
  - 
  (SELECT COALESCE(SUM(executed_quantity), 0) FROM institutional_dca_orders WHERE pair = 'BTC/USD' AND side = 'sell' AND cycle_id = (SELECT id FROM institutional_dca_cycles WHERE pair = 'BTC/USD' AND status = 'active' ORDER BY started_at DESC LIMIT 1)) 
  AS estimated_net_quantity;

\echo '═══════════════════════════════════════════════════════════════════════════════'
\echo '7. COMPARACIÓN: DB CYCLE vs ÓRDENES'
\echo '═══════════════════════════════════════════════════════════════════════════════'

SELECT 
  c.total_quantity AS db_cycle_quantity,
  (SELECT COALESCE(SUM(executed_quantity), 0) FROM institutional_dca_orders WHERE pair = 'BTC/USD' AND side = 'buy' AND cycle_id = c.id) AS orders_buy_quantity,
  (SELECT COALESCE(SUM(executed_quantity), 0) FROM institutional_dca_orders WHERE pair = 'BTC/USD' AND side = 'sell' AND cycle_id = c.id) AS orders_sell_quantity,
  c.total_quantity - ((SELECT COALESCE(SUM(executed_quantity), 0) FROM institutional_dca_orders WHERE pair = 'BTC/USD' AND side = 'buy' AND cycle_id = c.id) - (SELECT COALESCE(SUM(executed_quantity), 0) FROM institutional_dca_orders WHERE pair = 'BTC/USD' AND side = 'sell' AND cycle_id = c.id)) AS diff_cycle_vs_orders
FROM institutional_dca_cycles c
WHERE c.pair = 'BTC/USD' AND c.status = 'active' 
ORDER BY c.started_at DESC 
LIMIT 1;

\echo '═══════════════════════════════════════════════════════════════════════════════'
\echo '8. EVENTOS DEL CICLO BTC ACTIVO (últimos 20)'
\echo '═══════════════════════════════════════════════════════════════════════════════'

SELECT 
  id AS event_id,
  event_type,
  reason_code,
  severity,
  message,
  created_at
FROM institutional_dca_events 
WHERE pair = 'BTC/USD' 
  AND cycle_id = (SELECT id FROM institutional_dca_cycles WHERE pair = 'BTC/USD' AND status = 'active' ORDER BY started_at DESC LIMIT 1)
ORDER BY created_at DESC 
LIMIT 20;

\echo '═══════════════════════════════════════════════════════════════════════════════'
\echo '9. TODOS LOS CICLOS BTC (incluyendo cerrados)'
\echo '═══════════════════════════════════════════════════════════════════════════════'

SELECT 
  id,
  status,
  cycle_type,
  total_quantity,
  capital_used_usd,
  avg_entry_price,
  current_price,
  unrealized_pnl_usd,
  realized_pnl_usd,
  started_at,
  closed_at
FROM institutional_dca_cycles 
WHERE pair = 'BTC/USD' 
ORDER BY started_at DESC 
LIMIT 10;

\echo '═══════════════════════════════════════════════════════════════════════════════'
\echo 'DIAGNÓSTICO COMPLETADO'
\echo '═══════════════════════════════════════════════════════════════════════════════'
