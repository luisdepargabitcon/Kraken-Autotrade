-- Migration 008: Backfill trades de hoy como executed_by_bot=true
-- SOLO para trades de RevolutX de las últimas 24h con type='buy' y origin='sync'
-- Estos trades fueron ejecutados por el bot pero importados antes del sistema de atribución

-- Primero verificamos qué trades se van a actualizar (dry-run)
SELECT id, pair, type, origin, executed_at, executed_by_bot
FROM trades
WHERE exchange = 'revolutx'
  AND type = 'buy'
  AND origin = 'sync'
  AND executed_at > NOW() - INTERVAL '24 hours'
  AND (executed_by_bot IS NULL OR executed_by_bot = false)
ORDER BY executed_at DESC;

-- EJECUTAR SOLO SI LOS TRADES SON CORRECTOS:
-- UPDATE trades
-- SET executed_by_bot = true, updated_at = NOW()
-- WHERE exchange = 'revolutx'
--   AND type = 'buy'
--   AND origin = 'sync'
--   AND executed_at > NOW() - INTERVAL '24 hours'
--   AND (executed_by_bot IS NULL OR executed_by_bot = false);

-- Verificar resultado
-- SELECT id, pair, type, origin, executed_at, executed_by_bot
-- FROM trades
-- WHERE exchange = 'revolutx' AND executed_by_bot = true
-- ORDER BY executed_at DESC;
