/**
 * Script de prueba para el selector de chat de alertas de errores
 * Ejecutar con: npx tsx server/test/chatSelectorTest.ts
 */

import { errorAlertService, ErrorAlertService } from '../services/ErrorAlertService';
import { storage } from '../storage';

async function testChatSelector() {
  console.log('🧪 Iniciando pruebas del selector de chat para alertas de errores...\n');

  try {
    // Test 1: Verificar configuración actual
    console.log('📋 Test 1: Verificar configuración actual');
    const config = await storage.getBotConfig();
    console.log(`   Configuración actual: ${config?.errorAlertChatId || 'Todos los chats (por defecto)'}`);
    
    // Test 2: Obtener chats disponibles
    console.log('\n📱 Test 2: Obtener chats disponibles');
    const chats = await storage.getTelegramChats();
    console.log(`   Chats configurados: ${chats.length}`);
    chats.forEach(chat => {
      console.log(`   - ${chat.name} (${chat.chatId}) - ${chat.isActive ? 'Activo' : 'Inactivo'}`);
    });

    if (chats.length === 0) {
      console.log('⚠️  No hay chats configurados. Ve a /notifications para añadir chats.');
      return;
    }

    // Test 3: Enviar alerta con configuración actual
    console.log('\n🚨 Test 3: Enviar alerta de prueba con configuración actual');
    const testAlert = ErrorAlertService.createCustomAlert(
      'SYSTEM_ERROR',
      'Prueba del selector de chat - configuración actual',
      'MEDIUM',
      'testChatSelector',
      'server/test/chatSelectorTest.ts',
      25,
      undefined,
      { 
        testMode: true,
        currentConfig: config?.errorAlertChatId || 'all_chats',
        timestamp: new Date().toISOString()
      }
    );
    
    await errorAlertService.sendCriticalError(testAlert);
    console.log('✅ Alerta enviada con configuración actual');

    // Test 4: Probar con chat específico (si hay chats disponibles)
    if (chats.length > 0) {
      const firstActiveChat = chats.find(chat => chat.isActive);
      if (firstActiveChat) {
        console.log(`\n🎯 Test 4: Configurar chat específico (${firstActiveChat.name})`);
        
        // Actualizar configuración temporalmente
        await storage.updateBotConfig({ errorAlertChatId: firstActiveChat.chatId });
        console.log(`   Configuración actualizada a: ${firstActiveChat.name} (${firstActiveChat.chatId})`);
        
        // Enviar alerta de prueba
        const specificAlert = ErrorAlertService.createCustomAlert(
          'API_ERROR',
          `Prueba del selector de chat - enviando solo a ${firstActiveChat.name}`,
          'HIGH',
          'testSpecificChat',
          'server/test/chatSelectorTest.ts',
          50,
          'BTC/USD',
          { 
            testMode: true,
            targetChat: firstActiveChat.name,
            targetChatId: firstActiveChat.chatId,
            timestamp: new Date().toISOString()
          }
        );
        
        await errorAlertService.sendCriticalError(specificAlert);
        console.log(`✅ Alerta enviada específicamente a: ${firstActiveChat.name}`);
        
        // Esperar un momento
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Restaurar configuración original
        await storage.updateBotConfig({ errorAlertChatId: config?.errorAlertChatId });
        console.log('   Configuración restaurada a la original');
      }
    }

    // Test 5: Probar configuración "todos los chats"
    console.log('\n👥 Test 5: Probar configuración "todos los chats"');
    await storage.updateBotConfig({ errorAlertChatId: undefined });
    
    const allChatsAlert = ErrorAlertService.createCustomAlert(
      'TRADING_ERROR',
      'Prueba del selector de chat - enviando a todos los chats activos',
      'CRITICAL',
      'testAllChats',
      'server/test/chatSelectorTest.ts',
      75,
      'ETH/USD',
      { 
        testMode: true,
        targetConfig: 'all_active_chats',
        activeChatsCount: chats.filter(c => c.isActive).length,
        timestamp: new Date().toISOString()
      }
    );
    
    await errorAlertService.sendCriticalError(allChatsAlert);
    console.log('✅ Alerta enviada a todos los chats activos');
    
    // Restaurar configuración original
    await storage.updateBotConfig({ errorAlertChatId: config?.errorAlertChatId });

    console.log('\n🎉 Todas las pruebas del selector de chat completadas exitosamente!');
    console.log('📱 Revisa tu Telegram para ver las alertas recibidas en los diferentes chats.');
    console.log('🔧 Puedes configurar el chat específico desde /notifications en la UI.');
    
  } catch (error) {
    console.error('❌ Error durante las pruebas:', error);
  }
}

// Ejecutar tests si se llama directamente
if (require.main === module) {
  testChatSelector().then(() => {
    console.log('\n✨ Script de pruebas del selector de chat finalizado');
    process.exit(0);
  }).catch(error => {
    console.error('\n💥 Error fatal en las pruebas:', error);
    process.exit(1);
  });
}

export { testChatSelector };
