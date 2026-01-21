# INSTRUCCIONES DE DEPLOY - FIX PHANTOM BUYS

**Commit:** `4244df0` - fix: resolve phantom buys in RevolutX with unified trade ID and idempotent persistence  
**Fecha:** 20 de Enero 2026  
**Prioridad:** CRÍTICA - Resuelve pérdida de tracking de posiciones

---

## 🚨 PRE-REQUISITOS

**ANTES de ejecutar el deploy:**

1. ✅ Verificar que el bot NO está ejecutando trades activamente
2. ✅ Hacer backup de la base de datos
3. ✅ Verificar que tienes acceso SSH al VPS
4. ✅ Confirmar que no hay operaciones abiertas críticas

---

## 📋 PASO 1: BACKUP DE BASE DE DATOS

```bash
# Conectar al VPS
ssh usuario@tu-vps-ip

# Crear backup
cd /opt/krakenbot-staging
docker compose -f docker-compose.staging.yml exec -T postgres pg_dump -U krakenbot krakenbot > backup_pre_phantom_fix_$(date +%Y%m%d_%H%M%S).sql

# Verificar que el backup se creó correctamente
ls -lh backup_pre_phantom_fix_*.sql
```

---

## 📋 PASO 2: PULL Y BUILD

```bash
# Navegar al directorio del proyecto
cd /opt/krakenbot-staging

# Pull del código actualizado
git pull origin main

# Verificar que estamos en el commit correcto
git log -1 --oneline
# Debe mostrar: 4244df0 fix: resolve phantom buys in RevolutX...

# Rebuild de los contenedores
docker compose -f docker-compose.staging.yml up -d --build
```

---

## 📋 PASO 3: EJECUTAR MIGRACIÓN

```bash
# Opción A: Ejecutar migración desde contenedor
docker compose -f docker-compose.staging.yml exec app npm run migrate

# Opción B: Ejecutar migración manualmente en PostgreSQL
docker compose -f docker-compose.staging.yml exec -T postgres psql -U krakenbot krakenbot << 'EOF'
-- Migración 006: Applied Trades Table
CREATE TABLE IF NOT EXISTS applied_trades (
  id SERIAL PRIMARY KEY,
  exchange VARCHAR(50) NOT NULL,
  pair VARCHAR(20) NOT NULL,
  trade_id VARCHAR(255) NOT NULL,
  applied_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT applied_trades_unique UNIQUE (exchange, pair, trade_id)
);

CREATE INDEX IF NOT EXISTS idx_applied_trades_lookup 
  ON applied_trades(exchange, pair, trade_id);

COMMENT ON TABLE applied_trades IS 'Tracks which trades have been applied to open_positions to prevent duplicates';
EOF

# Verificar que la tabla se creó correctamente
docker compose -f docker-compose.staging.yml exec postgres psql -U krakenbot krakenbot -c "\d applied_trades"
```

---

## 📋 PASO 4: VERIFICACIÓN POST-DEPLOY

### 4.1 Verificar que no hay errores en logs

```bash
# Ver logs del contenedor
docker compose -f docker-compose.staging.yml logs -f --tail=100 app

# Buscar errores relacionados con la migración
docker compose -f docker-compose.staging.yml logs app | grep -i "error\|fail" | tail -20
```

### 4.2 Verificar estructura de base de datos

```bash
docker compose -f docker-compose.staging.yml exec postgres psql -U krakenbot krakenbot << 'EOF'

-- 1. Verificar que la tabla applied_trades existe
SELECT table_name, table_type 
FROM information_schema.tables 
WHERE table_name = 'applied_trades';

-- 2. Verificar índices
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'applied_trades';

-- 3. Contar registros actuales
SELECT COUNT(*) as total_trades FROM trades;
SELECT COUNT(*) as total_positions FROM open_positions;
SELECT COUNT(*) as total_applied FROM applied_trades;

EOF
```

### 4.3 Verificar operaciones fantasma históricas

```bash
docker compose -f docker-compose.staging.yml exec postgres psql -U krakenbot krakenbot << 'EOF'

-- Buscar trades sin posición asociada (phantom buys)
SELECT 
  t."tradeId", 
  t.exchange,
  t.pair, 
  t.type,
  t.amount, 
  t.price,
  t."executedAt",
  t.origin,
  CASE WHEN op."lotId" IS NOT NULL THEN 'HAS_POSITION' ELSE 'PHANTOM' END as status
FROM trades t
LEFT JOIN open_positions op ON t.exchange = op.exchange 
  AND t.pair = op.pair 
  AND t."tradeId" = op."tradeId"
WHERE t.type = 'buy' 
  AND t.exchange = 'revolutx'
  AND t."executedAt" >= NOW() - INTERVAL '7 days'
ORDER BY t."executedAt" DESC
LIMIT 20;

-- Verificar duplicados por contenido (debe ser 0 después del fix)
SELECT 
  exchange, 
  pair, 
  "executedAt", 
  type, 
  price, 
  amount, 
  COUNT(*) as cnt
FROM trades
WHERE exchange = 'revolutx'
  AND "executedAt" >= NOW() - INTERVAL '7 days'
GROUP BY exchange, pair, "executedAt", type, price, amount
HAVING COUNT(*) > 1;

EOF
```

---

## 📋 PASO 5: MONITOREO POST-DEPLOY

### 5.1 Monitorear logs en tiempo real

```bash
# Monitorear eventos de persistencia
docker compose -f docker-compose.staging.yml logs -f app | grep -E "TRADE_PERSIST|POSITION_APPLY"

# Buscar alertas críticas
docker compose -f docker-compose.staging.yml logs -f app | grep -E "CRITICAL|ORDER_FILLED_BUT_UNTRACKED"
```

### 5.2 Verificar próximas operaciones

Después de que el bot ejecute las próximas 2-3 operaciones, ejecutar:

```bash
docker compose -f docker-compose.staging.yml exec postgres psql -U krakenbot krakenbot << 'EOF'

-- Verificar que nuevas operaciones tienen applied_trades
SELECT 
  t."tradeId",
  t.pair,
  t.type,
  t."executedAt",
  t.origin,
  CASE WHEN at.id IS NOT NULL THEN 'APPLIED' ELSE 'NOT_APPLIED' END as applied_status,
  CASE WHEN op."lotId" IS NOT NULL THEN 'HAS_POSITION' ELSE 'NO_POSITION' END as position_status
FROM trades t
LEFT JOIN applied_trades at ON t.exchange = at.exchange 
  AND t.pair = at.pair 
  AND t."tradeId" = at.trade_id
LEFT JOIN open_positions op ON t.exchange = op.exchange 
  AND t.pair = op.pair 
  AND t."tradeId" = op."tradeId"
WHERE t.exchange = 'revolutx'
  AND t."executedAt" >= NOW() - INTERVAL '1 hour'
ORDER BY t."executedAt" DESC;

EOF
```

---

## 📋 PASO 6: VALIDACIÓN DE LOGS BOT

Verificar que aparecen los nuevos eventos en los logs:

```bash
# Buscar eventos de persistencia exitosa
docker compose -f docker-compose.staging.yml logs app | grep "TRADE_PERSIST_OK"

# Buscar eventos de aplicación exitosa
docker compose -f docker-compose.staging.yml logs app | grep "POSITION_APPLY_OK"

# Verificar que NO hay duplicados
docker compose -f docker-compose.staging.yml logs app | grep "TRADE_PERSIST_DUPLICATE"
docker compose -f docker-compose.staging.yml logs app | grep "POSITION_APPLY_DUPLICATE"

# Verificar que NO hay fallos
docker compose -f docker-compose.staging.yml logs app | grep "TRADE_PERSIST_FAIL"
docker compose -f docker-compose.staging.yml logs app | grep "POSITION_APPLY_FAIL"
```

---

## 🚨 ROLLBACK (Solo si hay problemas críticos)

Si encuentras problemas críticos después del deploy:

```bash
# 1. Detener el bot
docker compose -f docker-compose.staging.yml stop app

# 2. Revertir el commit
cd /opt/krakenbot-staging
git revert 4244df0
git push origin main

# 3. Restaurar backup de base de datos
docker compose -f docker-compose.staging.yml exec -T postgres psql -U krakenbot krakenbot < backup_pre_phantom_fix_YYYYMMDD_HHMMSS.sql

# 4. Rebuild y restart
docker compose -f docker-compose.staging.yml up -d --build

# 5. Notificar al equipo del rollback
```

---

## ✅ CRITERIOS DE ÉXITO

El deploy es exitoso si:

1. ✅ Migración ejecutada sin errores
2. ✅ Tabla `applied_trades` creada correctamente
3. ✅ Bot inicia sin errores en logs
4. ✅ Próximas operaciones generan logs `TRADE_PERSIST_OK` y `POSITION_APPLY_OK`
5. ✅ No aparecen alertas `ORDER_FILLED_BUT_UNTRACKED`
6. ✅ Nuevas operaciones tienen entrada en `applied_trades`
7. ✅ Nuevas operaciones tienen posición en `open_positions`
8. ✅ No hay duplicados en tabla `trades`

---

## 📞 CONTACTO EN CASO DE PROBLEMAS

Si encuentras algún problema durante el deploy:

1. **NO PANIC** - El backup está disponible para rollback
2. Capturar logs completos: `docker compose -f docker-compose.staging.yml logs app > error_logs.txt`
3. Capturar estado de DB con queries de verificación
4. Contactar con evidencia completa

---

## 📊 MÉTRICAS A MONITOREAR (Primeras 24h)

- **Trades ejecutados**: Debe coincidir con registros en `trades` y `applied_trades`
- **Posiciones abiertas**: Todas deben tener `tradeId` válido
- **Duplicados**: Debe ser 0
- **Alertas críticas**: Debe ser 0
- **Logs FAIL**: Debe ser 0

---

**Última actualización:** 20 de Enero 2026, 11:30 AM  
**Preparado por:** Windsurf Cascade AI  
**Commit:** 4244df0
