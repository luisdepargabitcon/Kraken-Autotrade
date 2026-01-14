// Test de conexión RevolutX desde VPS
// Uso: node test-revolutx-connection.js
const crypto = require('crypto');
const { Client } = require('pg');

async function testRevolutXConnection() {
  const dbClient = new Client({
    connectionString: process.env.DATABASE_URL
  });

  try {
    console.log('=== TEST CONEXIÓN REVOLUT X ===\n');
    
    // 1. Conectar a DB y obtener credenciales
    await dbClient.connect();
    console.log('✅ Conectado a PostgreSQL');
    
    const result = await dbClient.query(
      'SELECT revolutx_api_key, revolutx_private_key, revolutx_connected, revolutx_enabled FROM api_config LIMIT 1'
    );
    
    if (result.rows.length === 0) {
      console.error('❌ No hay configuración de API en la DB');
      process.exit(1);
    }
    
    const config = result.rows[0];
    console.log('✅ Credenciales cargadas desde DB');
    console.log('   - API Key:', config.revolutx_api_key ? config.revolutx_api_key.substring(0, 20) + '...' : 'NO CONFIGURADA');
    console.log('   - Private Key:', config.revolutx_private_key ? 'CONFIGURADA' : 'NO CONFIGURADA');
    console.log('   - Connected:', config.revolutx_connected);
    console.log('   - Enabled:', config.revolutx_enabled);
    console.log('');
    
    if (!config.revolutx_api_key || !config.revolutx_private_key) {
      console.error('❌ Credenciales incompletas en DB');
      process.exit(1);
    }
    
    // 2. Preparar firma Ed25519
    const timestamp = Date.now().toString();
    const path = '/api/1.0/balances';
    const message = timestamp + 'GET' + path;
    
    console.log('📝 Preparando request...');
    console.log('   - Timestamp:', timestamp);
    console.log('   - Path:', path);
    console.log('   - Message:', message.substring(0, 50) + '...');
    console.log('');
    
    let signature;
    try {
      const signatureBuffer = crypto.sign(null, Buffer.from(message), config.revolutx_private_key);
      signature = signatureBuffer.toString('base64');
      console.log('✅ Firma generada:', signature.substring(0, 30) + '...');
    } catch (signError) {
      console.error('❌ Error al generar firma:', signError.message);
      console.error('   Verifica que la private key sea Ed25519 válida');
      process.exit(1);
    }
    console.log('');
    
    // 3. Hacer request a RevolutX API
    console.log('🌐 Conectando a RevolutX API...');
    const response = await fetch('https://revx.revolut.com' + path, {
      headers: {
        'Content-Type': 'application/json',
        'X-Revx-Api-Key': config.revolutx_api_key,
        'X-Revx-Timestamp': timestamp,
        'X-Revx-Signature': signature
      }
    });
    
    console.log('📡 Status:', response.status, response.statusText);
    console.log('');
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Error API RevolutX:');
      console.error('   Status:', response.status);
      console.error('   Response:', errorText);
      
      if (response.status === 401) {
        console.error('\n💡 Posibles causas:');
        console.error('   - API Key incorrecta');
        console.error('   - Private Key incorrecta o mal formateada');
        console.error('   - Firma Ed25519 inválida');
      } else if (response.status === 403) {
        console.error('\n💡 Posibles causas:');
        console.error('   - IP del VPS no está en whitelist de RevolutX');
        console.error('   - Permisos insuficientes en la API Key');
      }
      
      process.exit(1);
    }
    
    // 4. Parsear y mostrar balance
    const data = await response.json();
    console.log('✅ Balance obtenido exitosamente:\n');
    
    if (Array.isArray(data) && data.length > 0) {
      console.table(data.map(item => ({
        Currency: item.currency || item.asset,
        Available: item.available || item.balance || 0,
        Total: item.total || item.balance || 0
      })));
    } else {
      console.log('⚠️  No hay balances o formato inesperado:', data);
    }
    
    console.log('\n✅ TEST COMPLETADO - Conexión RevolutX OK');
    
  } catch (error) {
    console.error('\n❌ Error durante el test:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  } finally {
    await dbClient.end();
  }
}

testRevolutXConnection();
