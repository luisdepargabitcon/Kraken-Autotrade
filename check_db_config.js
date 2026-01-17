// Script para verificar configuración de Telegram en la base de datos
import pg from 'pg';

async function checkTelegramConfig() {
  const client = new pg.Client({
    host: 'localhost',
    port: 5432,
    database: 'krakenbot',
    user: 'krakenbot',
    password: 'KrakenBot2024Seguro',
  });

  try {
    await client.connect();
    console.log('=== CONECTADO A LA BASE DE DATOS ===');
    
    // Verificar si existe la tabla api_config
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'api_config'
      );
    `);
    
    if (!tableCheck.rows[0].exists) {
      console.log('❌ La tabla api_config no existe');
      
      // Verificar qué tablas existen
      const tables = await client.query(`
        SELECT table_name FROM information_schema.tables 
        WHERE table_schema = 'public' 
        ORDER BY table_name;
      `);
      console.log('Tablas disponibles:', tables.rows.map(r => r.table_name));
      return;
    }
    
    console.log('✅ Tabla api_config encontrada');
    
    // Obtener configuración de Telegram
    const result = await client.query(`
      SELECT telegram_token, telegram_chat_id, telegram_connected, updated_at 
      FROM api_config 
      LIMIT 1;
    `);
    
    if (result.rows.length === 0) {
      console.log('❌ No hay registros en api_config');
      return;
    }
    
    const config = result.rows[0];
    console.log('\n=== CONFIGURACIÓN TELEGRAM EN BASE DE DATOS ===');
    console.log('Token:', config.telegram_token ? `✅ CONFIGURADO (${config.telegram_token.length} caracteres)` : '❌ NO CONFIGURADO');
    console.log('Chat ID:', config.telegram_chat_id || '❌ NO CONFIGURADO');
    console.log('Conectado:', config.telegram_connected ? '✅ SÍ' : '❌ NO');
    console.log('Última actualización:', config.updated_at || 'N/A');
    
    if (config.telegram_token) {
      console.log('\nToken (primeros 10 caracteres):', config.telegram_token.substring(0, 10) + '...');
      console.log('Token (últimos 10 caracteres):', '...' + config.telegram_token.substring(config.telegram_token.length - 10));
    }
    
    if (config.telegram_chat_id) {
      console.log('Chat ID tipo:', typeof config.telegram_chat_id);
      console.log('Chat ID valor:', config.telegram_chat_id);
    }
    
    console.log('\n=== CHATS ADICIONALES CONFIGURADOS ===');
    
    // Verificar tabla telegram_chats si existe
    const telegramChatsCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'telegram_chats'
      );
    `);
    
    if (telegramChatsCheck.rows[0].exists) {
      const chatsResult = await client.query(`
        SELECT chat_id, chat_type, is_active, created_at 
        FROM telegram_chats 
        ORDER BY created_at DESC;
      `);
      
      if (chatsResult.rows.length > 0) {
        console.log(`✅ ${chatsResult.rows.length} chats adicionales configurados:`);
        chatsResult.rows.forEach((chat, index) => {
          console.log(`  ${index + 1}. Chat ID: ${chat.chat_id} | Tipo: ${chat.chat_type} | Activo: ${chat.is_active ? '✅' : '❌'}`);
        });
      } else {
        console.log('❌ No hay chats adicionales configurados');
      }
    } else {
      console.log('❌ La tabla telegram_chats no existe');
    }
    
  } catch (error) {
    console.error('❌ Error conectando a la base de datos:', error.message);
  } finally {
    await client.end();
  }
}

checkTelegramConfig();
