// Script para verificar configuración de Telegram usando diferentes métodos
import pg from 'pg';

async function checkTelegramConfig() {
  console.log('=== VERIFICANDO CONFIGURACIÓN TELEGRAM ===');
  
  // Método 1: Conexión directa a PostgreSQL
  const client = new pg.Client({
    host: 'localhost',
    port: 5432,
    database: 'krakenbot',
    user: 'krakenbot',
    password: 'KrakenBot2024Seguro',
  });

  try {
    await client.connect();
    console.log('✅ Conectado a PostgreSQL');
    
    // Verificar tabla api_config
    const tableCheck = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'api_config' 
      ORDER BY ordinal_position;
    `);
    
    if (tableCheck.rows.length === 0) {
      console.log('❌ La tabla api_config no existe');
      
      // Listar todas las tablas
      const tables = await client.query(`
        SELECT table_name FROM information_schema.tables 
        WHERE table_schema = 'public' 
        ORDER BY table_name;
      `);
      console.log('Tablas disponibles:');
      tables.rows.forEach(row => console.log(`  - ${row.table_name}`));
      return;
    }
    
    console.log('✅ Tabla api_config encontrada');
    console.log('Columnas:', tableCheck.rows.map(r => r.column_name).join(', '));
    
    // Obtener configuración
    const result = await client.query('SELECT * FROM api_config LIMIT 1');
    
    if (result.rows.length === 0) {
      console.log('❌ No hay registros en api_config');
      return;
    }
    
    const config = result.rows[0];
    console.log('\n=== CONFIGURACIÓN TELEGRAM ===');
    
    // Mostrar todos los campos relacionados con Telegram
    Object.keys(config).forEach(key => {
      if (key.toLowerCase().includes('telegram')) {
        const value = config[key];
        if (key === 'telegram_token' && value) {
          console.log(`${key}: ${value.substring(0, 15)}...${value.substring(value.length - 5)} (${value.length} chars)`);
        } else {
          console.log(`${key}: ${value || 'NULL'}`);
        }
      }
    });
    
    // Verificar tabla telegram_chats
    try {
      const chatsResult = await client.query('SELECT * FROM telegram_chats ORDER BY created_at DESC');
      if (chatsResult.rows.length > 0) {
        console.log('\n=== CHATS ADICIONALES ===');
        chatsResult.rows.forEach((chat, i) => {
          console.log(`Chat ${i + 1}: ID=${chat.chat_id}, Tipo=${chat.chat_type}, Activo=${chat.is_active}`);
        });
      }
    } catch (e) {
      console.log('❌ La tabla telegram_chats no existe o no hay acceso');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    
    // Método 2: Intentar con diferentes credenciales
    console.log('\n=== INTENTANDO CONEXIONES ALTERNATIVAS ===');
    
    const alternatives = [
      { user: 'postgres', password: 'postgres' },
      { user: 'postgres', password: 'KrakenBot2024Seguro' },
      { user: 'krakenbot', password: 'postgres' },
    ];
    
    for (const alt of alternatives) {
      try {
        const altClient = new pg.Client({
          host: 'localhost',
          port: 5432,
          database: 'krakenbot',
          user: alt.user,
          password: alt.password,
        });
        
        await altClient.connect();
        console.log(`✅ Conectado con usuario: ${alt.user}`);
        
        const result = await altClient.query('SELECT telegram_token, telegram_chat_id FROM api_config LIMIT 1');
        if (result.rows.length > 0) {
          const config = result.rows[0];
          console.log('Token:', config.telegram_token ? `${config.telegram_token.substring(0, 10)}...` : 'NULL');
          console.log('Chat ID:', config.telegram_chat_id || 'NULL');
        }
        
        await altClient.end();
        break;
      } catch (e) {
        console.log(`❌ Fallo con ${alt.user}: ${e.message}`);
      }
    }
  } finally {
    await client.end();
  }
}

checkTelegramConfig();
