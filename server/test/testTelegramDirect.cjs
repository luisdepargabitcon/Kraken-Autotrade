const TelegramBot = require('node-telegram-bot-api');

async function testTelegramDirect() {
  try {
    console.log('🧪 Enviando mensaje directo al canal técnico...');
    
    const token = '8095940096:AAHLsPUW5UrIanvmuCExiXtUn7-ZHJqXQBU';
    const chatId = '-1003504297101'; // TRADE TECNICO
    
    const bot = new TelegramBot(token, { polling: false });
    
    await bot.sendMessage(chatId, '🎉 **SELECTOR DE CHAT PARA ALERTAS LISTO** 🎉\n\n✅ Sistema completamente operativo\n✅ ErrorAlertService corregido\n✅ Token de Telegram configurado\n✅ Import circulares resueltos\n✅ Tests funcionando correctamente\n\n📱 El selector de chat para alertas críticas está listo para producción.\n\n🔧 Puedes configurarlo desde: /notifications\n\n- Windsurf Development Team');
    
    console.log('✅ Mensaje enviado al canal técnico');
    console.log('🎊 ¡Sistema listo para producción!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testTelegramDirect();
