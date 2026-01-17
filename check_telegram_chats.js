// Script para verificar todos los chats Telegram configurados
console.log('=== VERIFICACIÓN COMPLETA DE CHATS TELEGRAM ===');

console.log('\n🔍 COMANDOS PARA VER TODOS LOS CHATS TELEGRAM EN VPS:');

console.log('\n📋 CHATS PRINCIPALES (api_config):');
console.log('docker exec -it krakenbot-staging-db psql -U krakenstaging -d krakenbot_staging -c "SELECT telegram_token, telegram_chat_id, telegram_connected FROM api_config;"');

console.log('\n📋 CHATS ADICIONALES (telegram_chats):');
console.log('docker exec -it krakenbot-staging-db psql -U krakenstaging -d krakenbot_staging -c "SELECT * FROM telegram_chats ORDER BY created_at DESC;"');

console.log('\n📋 TODAS LAS TABLAS RELACIONADAS CON TELEGRAM:');
console.log('# Ver todas las tablas que contengan "telegram"');
console.log('docker exec -it krakenbot-staging-db psql -U krakenstaging -d krakenbot_staging -c "\\dt *telegram*"');

console.log('\n📋 ESTRUCTURA COMPLETA DE TABLAS:');
console.log('# Estructura tabla api_config');
console.log('docker exec -it krakenbot-staging-db psql -U krakenstaging -d krakenbot_staging -c "\\d api_config"');

console.log('# Estructura tabla telegram_chats');
console.log('docker exec -it krakenbot-staging-db psql -U krakenstaging -d krakenbot_staging -c "\\d telegram_chats"');

console.log('\n📋 CHATS POR TIPO:');
console.log('# Chats grupales');
console.log('docker exec -it krakenbot-staging-db psql -U krakenstaging -d krakenbot_staging -c "SELECT chat_id, chat_type, is_active, created_at FROM telegram_chats WHERE chat_type = \'group\' ORDER BY created_at;"');

console.log('# Chats privados');
console.log('docker exec -it krakenbot-staging-db psql -U krakenstaging -d krakenbot_staging -c "SELECT chat_id, chat_type, is_active, created_at FROM telegram_chats WHERE chat_type = \'private\' ORDER BY created_at;"');

console.log('# Chats activos vs inactivos');
console.log('docker exec -it krakenbot-staging-db psql -U krakenstaging -d krakenbot_staging -c "SELECT chat_id, chat_type, is_active, COUNT(*) as count FROM telegram_chats GROUP BY chat_id, chat_type, is_active ORDER BY count DESC;"');

console.log('\n📋 LOGS DE ACTIVIDAD TELEGRAM:');
console.log('# Ver logs recientes con actividad Telegram');
console.log('docker logs krakenbot-staging-app --tail 100 | grep -i telegram');

console.log('# Ver logs de comandos Telegram');
console.log('docker logs krakenbot-staging-app --tail 100 | grep -E "(telegram|chat|message)"');

console.log('\n📋 VERIFICACIÓN DE CONEXIÓN:');
console.log('# Verificar estado actual de conexión');
console.log('curl http://localhost:3020/api/config/api | jq .telegramConnected');

console.log('# Ver configuración completa');
console.log('curl http://localhost:3020/api/config/api | jq .');

console.log('\n📋 COMANDOS PARA GESTIONAR CHATS:');
console.log('# Para agregar un nuevo chat (si existe el endpoint)');
console.log('curl -X POST http://localhost:3020/api/telegram/chats/add -H "Content-Type: application/json" -d \'{"chat_id": "123456789", "chat_type": "group"}\'');

console.log('# Para activar/desactivar chats');
console.log('curl -X PUT http://localhost:3020/api/telegram/chats/123456789/toggle');

console.log('\n⚠️ NOTAS IMPORTANTES:');
console.log('1. El chat principal está en api_config.telegram_chat_id');
console.log('2. Los chats adicionales están en telegram_chats');
console.log('3. Puede haber múltiples chats para diferentes notificaciones');
console.log('4. Algunos chats pueden estar inactivos (is_active = false)');
console.log('5. Los tipos pueden ser: private, group, channel, etc.');

console.log('\n📋 RESUMEN ESPERADO:');
console.log('- Chat principal (api_config): 1 chat');
console.log('- Chats adicionales (telegram_chats): 0+ chats');
console.log('- Total esperado: 1+ chats si hay configuración múltiple');
