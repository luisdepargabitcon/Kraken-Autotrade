// Script para verificar estado del bot en VPS vs Local
import http from 'http';

console.log('=== VERIFICACIÓN DE ESTADO BOT (VPS vs LOCAL) ===');

// URLs de posibles endpoints
const endpoints = [
  { name: 'VPS/Staging - API Config', url: 'http://localhost:3009/api/config/api' },
  { name: 'VPS/Staging - Dashboard', url: 'http://localhost:3009/api/dashboard' },
  { name: 'VPS/Staging - Environment', url: 'http://localhost:3009/api/environment' },
  { name: 'Local Dev - API Config', url: 'http://localhost:5000/api/config/api' },
  { name: 'Local Dev - Dashboard', url: 'http://localhost:5000/api/dashboard' },
];

async function checkEndpoint(endpoint) {
  return new Promise((resolve) => {
    const req = http.get(endpoint.url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          resolve({
            ...endpoint,
            status: 'online',
            statusCode: res.statusCode,
            data: jsonData
          });
        } catch (e) {
          resolve({
            ...endpoint,
            status: 'error',
            statusCode: res.statusCode,
            error: e.message,
            rawData: data.substring(0, 200)
          });
        }
      });
    });
    
    req.on('error', (error) => {
      resolve({
        ...endpoint,
        status: 'offline',
        error: error.message
      });
    });
    
    req.setTimeout(3000, () => {
      req.destroy();
      resolve({
        ...endpoint,
        status: 'timeout'
      });
    });
  });
}

async function checkAllEndpoints() {
  console.log('Verificando endpoints...\n');
  
  for (const endpoint of endpoints) {
    const result = await checkEndpoint(endpoint);
    
    console.log(`\n--- ${result.name} ---`);
    console.log(`Estado: ${result.status}`);
    console.log(`Código: ${result.statusCode || 'N/A'}`);
    
    if (result.status === 'online' && result.data) {
      // Extraer información relevante
      const info = {
        botActive: result.data.botActive,
        telegramConnected: result.data.telegramConnected,
        krakenConnected: result.data.krakenConnected,
        hasTelegramKeys: result.data.hasTelegramKeys,
        env: result.data.env,
        instanceId: result.data.instanceId,
        isVPS: result.data.isVPS,
        isNAS: result.data.isNAS,
        dryRun: result.data.dryRun
      };
      
      Object.entries(info).forEach(([key, value]) => {
        if (value !== undefined) {
          console.log(`  ${key}: ${value}`);
        }
      });
      
      // Determinar si es VPS o Local
      if (result.data.env) {
        console.log(`  📍 Entorno: ${result.data.env}`);
      }
      if (result.data.isVPS !== undefined) {
        console.log(`  🖥️  Es VPS: ${result.data.isVPS ? 'SÍ' : 'NO'}`);
      }
      if (result.data.instanceId) {
        console.log(`  🆔 Instance ID: ${result.data.instanceId}`);
      }
      
    } else if (result.status === 'error') {
      console.log(`  Error: ${result.error}`);
      if (result.rawData) {
        console.log(`  Data preview: ${result.rawData}`);
      }
    } else {
      console.log(`  ${result.error || 'No response'}`);
    }
  }
}

// Función para obtener comandos VPS
function getVPSCommands() {
  console.log('\n\n=== COMANDOS PARA VPS ===');
  console.log('\n📋 Conexión y Verificación:');
  console.log('ssh root@tu-vps-ip');
  console.log('cd /opt/krakenbot-staging');
  console.log('docker ps');
  console.log('docker logs kraken-bot-app --tail 50');
  
  console.log('\n🔄 Comandos Estándar VPS/STG:');
  console.log('# Actualizar y reiniciar');
  console.log('git pull origin main');
  console.log('docker compose -f docker-compose.staging.yml up -d --build');
  
  console.log('\n📊 Verificar estado:');
  console.log('docker exec -it kraken-bot-app curl http://localhost:5000/api/dashboard');
  console.log('docker exec -it kraken-bot-db psql -U krakenbot -d krakenbot -c "SELECT bot_active FROM bot_config;"');
  
  console.log('\n⚙️ Control del bot:');
  console.log('# Pausar bot');
  console.log('docker exec -it kraken-bot-app curl -X POST http://localhost:5000/api/bot/pause');
  console.log('# Reanudar bot');
  console.log('docker exec -it kraken-bot-app curl -X POST http://localhost:5000/api/bot/resume');
  console.log('# Ver estado');
  console.log('docker exec -it kraken-bot-app curl http://localhost:5000/api/config');
  
  console.log('\n🔍 Ver logs en tiempo real:');
  console.log('docker logs -f kraken-bot-app');
  console.log('docker logs -f kraken-bot-db');
  
  console.log('\n🗄️ Base de datos:');
  console.log('# Ver configuración Telegram');
  console.log('docker exec -it kraken-bot-db psql -U krakenbot -d krakenbot -c "SELECT telegram_token, telegram_chat_id, telegram_connected FROM api_config;"');
  console.log('# Ver estado bot');
  console.log('docker exec -it kraken-bot-db psql -U krakenbot -d krakenbot -c "SELECT is_active, updated_at FROM bot_config;"');
}

// Ejecutar verificación
checkAllEndpoints().then(() => {
  getVPSCommands();
  
  console.log('\n\n=== DIAGNÓSTICO ===');
  console.log('1. Si localhost:3009 responde -> El servicio VPS/STG está corriendo localmente');
  console.log('2. Si localhost:5000 responde -> El servicio local dev está corriendo');
  console.log('3. Si botActive=false -> El bot está pausado en ese entorno');
  console.log('4. Si isVPS=true -> Es el entorno VPS/STG');
  console.log('5. Si isVPS=false o undefined -> Es entorno local/dev');
  console.log('6. Comparar instanceId para saber si es la misma instancia');
});
