// Comandos VPS ALTERNATIVOS (sin curl dentro del contenedor)
console.log('=== COMANDOS VPS ALTERNATIVOS (SIN CURL) ===');

console.log('\n❌ PROBLEMA: curl no está instalado en el contenedor');
console.log('✅ SOLUCIÓN: Usar wget o acceso directo desde el host');

console.log('\n🔄 OPCIÓN 1: USAR WGET DENTRO DEL CONTENEDOR:');
console.log('docker exec -it krakenbot-staging-app wget -qO- http://localhost:5000/api/dashboard');
console.log('docker exec -it krakenbot-staging-app wget -qO- http://localhost:5000/api/config/api');

console.log('\n🔄 OPCIÓN 2: ACCEDER DESDE EL HOST VPS:');
console.log('curl http://localhost:3020/api/dashboard');
console.log('curl http://localhost:3020/api/config/api');

console.log('\n🔄 OPCIÓN 3: USAR DOCKER COMPOSE EXEC:');
console.log('docker compose -f docker-compose.staging.yml exec krakenbot-staging-app wget -qO- http://localhost:5000/api/dashboard');

console.log('\n🔄 OPCIÓN 4: INSTALAR CURL EN EL CONTENEDOR:');
console.log('docker exec -it krakenbot-staging-app sh -c "apt update && apt install -y curl"');
console.log('# Después instalar curl, usar los comandos normales');

console.log('\n⚙️ CONTROL BOT VPS (ALTERNATIVAS):');
console.log('# Opción 1: Desde host VPS');
console.log('curl -X POST http://localhost:3020/api/bot/pause');
console.log('curl -X POST http://localhost:3020/api/bot/resume');
console.log('curl http://localhost:3020/api/config');

console.log('# Opción 2: Usar wget dentro del contenedor');
console.log('docker exec -it krakenbot-staging-app wget -qO- --post-data="" http://localhost:5000/api/bot/pause');
console.log('docker exec -it krakenbot-staging-app wget -qO- --post-data="" http://localhost:5000/api/bot/resume');

console.log('\n🗄️ BASE DE DATOS VPS (SIN CAMBIOS):');
console.log('docker exec -it krakenbot-staging-db psql -U krakenstaging -d krakenbot_staging -c "SELECT telegram_token, telegram_chat_id, telegram_connected FROM api_config;"');
console.log('docker exec -it krakenbot-staging-db psql -U krakenstaging -d krakenbot_staging -c "SELECT is_active, updated_at FROM bot_config;"');

console.log('\n🔍 LOGS VPS (SIN CAMBIOS):');
console.log('docker logs -f krakenbot-staging-app');
console.log('docker logs krakenbot-staging-app --tail 50');

console.log('\n🌐 ACCESO WEB VPS (DESDE HOST):');
console.log('# Desde el host VPS:');
console.log('curl http://localhost:3020/api/dashboard');
console.log('curl http://localhost:3020/api/config/api');
console.log('# Desde exterior:');
console.log('curl http://5.250.184.18:3020/api/dashboard');

console.log('\n📋 RECOMENDACIÓN:');
console.log('1. Usar OPCIÓN 2 (acceso desde host VPS) - más simple');
console.log('2. O instalar curl permanentemente en el contenedor');
console.log('3. Verificar que el bot esté funcionando en el VPS');

console.log('\n⚠️ RECORDATORIO:');
console.log('- Host VPS: http://localhost:3020');
console.log('- Contenedor interno: http://localhost:5000');
console.log('- Externo: http://5.250.184.18:3020');
