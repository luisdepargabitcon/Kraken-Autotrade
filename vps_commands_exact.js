// Comandos EXACTOS para VPS basados en la memoria del sistema
console.log('=== COMANDOS EXACTOS VPS/STG (SEGÚN MEMORIA) ===');

console.log('\n🔄 COMANDOS VPS/STG ESTÁNDAR:');
console.log('cd /opt/krakenbot-staging');
console.log('git pull origin main');
console.log('docker compose -f docker-compose.staging.yml up -d --build');

console.log('\n📊 VERIFICACIÓN ESTADO VPS:');
console.log('docker exec -it kraken-bot-app curl http://localhost:5000/api/dashboard');
console.log('docker exec -it kraken-bot-app curl http://localhost:5000/api/config/api');

console.log('\n⚙️ CONTROL BOT VPS:');
console.log('# Ver estado completo');
console.log('docker exec -it kraken-bot-app curl http://localhost:5000/api/config');
console.log('# Pausar bot');
console.log('docker exec -it kraken-bot-app curl -X POST http://localhost:5000/api/bot/pause');
console.log('# Reanudar bot');
console.log('docker exec -it kraken-bot-app curl -X POST http://localhost:5000/api/bot/resume');

console.log('\n🗄️ BASE DE DATOS VPS:');
console.log('# Ver configuración Telegram');
console.log('docker exec -it kraken-bot-db psql -U krakenbot -d krakenbot -c "SELECT telegram_token, telegram_chat_id, telegram_connected FROM api_config;"');
console.log('# Ver estado bot en BD');
console.log('docker exec -it kraken-bot-db psql -U krakenbot -d krakenbot -c "SELECT is_active, updated_at FROM bot_config;"');
console.log('# Ver chats adicionales');
console.log('docker exec -it kraken-bot-db psql -U krakenbot -d krakenbot -c "SELECT chat_id, chat_type, is_active FROM telegram_chats;"');

console.log('\n🔍 LOGS VPS:');
console.log('docker logs -f kraken-bot-app');
console.log('docker logs -f kraken-bot-db');
console.log('docker logs kraken-bot-app --tail 50');

console.log('\n🌐 ACCESO WEB VPS:');
console.log('# El VPS expone el puerto 3000:5000');
console.log('# Acceso web: http://IP-VPS:3000');
console.log('# API interna: http://localhost:5000');

console.log('\n📋 ESTADO ACTUAL LOCAL:');
console.log('- Entorno: WINDSURF/MAINT (modo mantenimiento)');
console.log('- Bot: PAUSADO localmente');
console.log('- Puerto local: 3009');
console.log('- VPS: Debería estar funcionando');

console.log('\n⚠️ RECORDATORIO:');
console.log('- Local: Mantener en WINDSURF/MAINT');
console.log('- VPS: Entorno productivo funcionando');
console.log('- No confundir puertos (VPS usa 5000 interno)');
