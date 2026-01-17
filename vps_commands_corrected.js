// Comandos CORREGIDOS para VPS según docker-compose.staging.yml
console.log('=== COMANDOS CORREGIDOS VPS/STG ===');

console.log('\n🔍 CONFIGURACIÓN VPS REAL:');
console.log('- Container: krakenbot-staging-app');
console.log('- Puerto interno: 5000');
console.log('- Puerto externo: 3020');
console.log('- Panel URL: http://5.250.184.18:3020');
console.log('- Database: krakenbot-staging-db (puerto 5435)');

console.log('\n🔄 COMANDOS VPS/STG ESTÁNDAR:');
console.log('cd /opt/krakenbot-staging');
console.log('git pull origin main');
console.log('docker compose -f docker-compose.staging.yml up -d --build');

console.log('\n📊 VERIFICACIÓN ESTADO VPS:');
console.log('docker exec -it krakenbot-staging-app curl http://localhost:5000/api/dashboard');
console.log('docker exec -it krakenbot-staging-app curl http://localhost:5000/api/config/api');

console.log('\n⚙️ CONTROL BOT VPS:');
console.log('# Ver estado completo');
console.log('docker exec -it krakenbot-staging-app curl http://localhost:5000/api/config');
console.log('# Pausar bot');
console.log('docker exec -it krakenbot-staging-app curl -X POST http://localhost:5000/api/bot/pause');
console.log('# Reanudar bot');
console.log('docker exec -it krakenbot-staging-app curl -X POST http://localhost:5000/api/bot/resume');

console.log('\n🗄️ BASE DE DATOS VPS:');
console.log('# Ver configuración Telegram');
console.log('docker exec -it krakenbot-staging-db psql -U krakenstaging -d krakenbot_staging -c "SELECT telegram_token, telegram_chat_id, telegram_connected FROM api_config;"');
console.log('# Ver estado bot en BD');
console.log('docker exec -it krakenbot-staging-db psql -U krakenstaging -d krakenbot_staging -c "SELECT is_active, updated_at FROM bot_config;"');

console.log('\n🌐 ACCESO WEB VPS:');
console.log('# Panel web: http://5.250.184.18:3020');
console.log('# API interna contenedor: http://localhost:5000');
console.log('# API externa: http://5.250.184.18:3020/api/...');

console.log('\n🔍 LOGS VPS:');
console.log('docker logs -f krakenbot-staging-app');
console.log('docker logs -f krakenbot-staging-db');
console.log('docker logs krakenbot-staging-app --tail 50');

console.log('\n📋 ESTADO FINAL:');
console.log('- Local: WINDSURF/MAINT (puerto 3009)');
console.log('- VPS: Producción (puerto externo 3020, interno 5000)');
console.log('- Container names: krakenbot-staging-app, krakenbot-staging-db');
console.log('- BD: krakenstaging/Kr4k3n_St4g1ng_2026!');

console.log('\n⚠️ IMPORTANTE:');
console.log('- Usar "krakenbot-staging-app" NO "kraken-bot-app"');
console.log('- Usar "krakenstaging" NO "krakenbot" para BD');
console.log('- Puerto interno SIEMPRE 5000 dentro del contenedor');
console.log('- Puerto externo 3020 para acceso web');
