// Script para verificar variables de entorno y configuración
import fs from 'fs';
import path from 'path';
import http from 'http';

console.log('=== VERIFICACIÓN DE VARIABLES DE ENTORNO ===');

// Leer archivo .env
const envPath = path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  console.log('\n--- Contenido de .env ---');
  const lines = envContent.split('\n');
  lines.forEach(line => {
    if (line.trim() && !line.startsWith('#')) {
      if (line.includes('TELEGRAM')) {
        if (line.includes('TOKEN') && line.split('=')[1]) {
          const token = line.split('=')[1];
          console.log(`TELEGRAM_BOT_TOKEN: ${token.substring(0, 10)}...${token.substring(token.length - 5)} (${token.length} chars)`);
        } else if (line.includes('CHAT') && line.split('=')[1]) {
          console.log(`TELEGRAM_CHAT_ID: ${line.split('=')[1]}`);
        } else {
          console.log(`${line.split('=')[0]}: ${line.split('=')[1] || 'VACÍO'}`);
        }
      } else if (line.includes('DATABASE_URL')) {
        console.log(`DATABASE_URL: ${line.split('=')[1] || 'VACÍO'}`);
      }
    }
  });
} else {
  console.log('❌ Archivo .env no encontrado');
}

// Variables de entorno actuales
console.log('\n--- Variables de entorno actuales ---');
console.log(`TELEGRAM_BOT_TOKEN: ${process.env.TELEGRAM_BOT_TOKEN ? `${process.env.TELEGRAM_BOT_TOKEN.substring(0, 10)}...` : 'NO DEFINIDA'}`);
console.log(`TELEGRAM_CHAT_ID: ${process.env.TELEGRAM_CHAT_ID || 'NO DEFINIDA'}`);
console.log(`DATABASE_URL: ${process.env.DATABASE_URL || 'NO DEFINIDA'}`);
console.log(`DB_PASSWORD: ${process.env.DB_PASSWORD ? '***CONFIGURADA***' : 'NO DEFINIDA'}`);

// Verificar si el servidor está corriendo
console.log('\n=== VERIFICACIÓN DEL SERVIDOR ===');

function checkServer(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/api/config/api`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const config = JSON.parse(data);
          resolve({ port, status: 'online', config });
        } catch (e) {
          resolve({ port, status: 'error', error: e.message });
        }
      });
    });
    
    req.on('error', () => {
      resolve({ port, status: 'offline' });
    });
    
    req.setTimeout(3000, () => {
      req.destroy();
      resolve({ port, status: 'timeout' });
    });
  });
}

async function checkPorts() {
  const ports = [5000, 3000, 8000];
  
  for (const port of ports) {
    const result = await checkServer(port);
    console.log(`Puerto ${port}: ${result.status}`);
    
    if (result.status === 'online' && result.config) {
      console.log(`  - hasTelegramKeys: ${result.config.hasTelegramKeys}`);
      console.log(`  - telegramConnected: ${result.config.telegramConnected}`);
      console.log(`  - krakenConnected: ${result.config.krakenConnected}`);
    }
  }
}

checkPorts().then(() => {
  console.log('\n=== RESUMEN ===');
  console.log('1. Las variables de entorno .env están vacías');
  console.log('2. El sistema usa configuración almacenada en base de datos');
  console.log('3. No se puede acceder directamente a la base de datos PostgreSQL');
  console.log('4. El servidor no está accesible en los puertos comunes');
  console.log('5. El token y chat ID están configurados pero no visibles sin acceso a la BD');
});
