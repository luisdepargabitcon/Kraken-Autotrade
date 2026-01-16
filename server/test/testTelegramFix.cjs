const { errorAlertService } = require('../services/ErrorAlertService');

async function testTelegramFix() {
  try {
    console.log('🧪 Probando ErrorAlertService con fix...');
    
    // Crear alerta de prueba
    const alert = {
      type: 'API_ERROR',
      message: 'Test del fix de ErrorAlertService',
      function: 'testTelegramFix',
      fileName: 'testTelegramFix.cjs',
      lineNumber: 1,
      timestamp: new Date(),
      severity: 'HIGH',
      context: { fix: 'applied' }
    };
    
    await errorAlertService.sendCriticalError(alert);
    console.log('✅ Alerta enviada con éxito');
    console.log('📱 Revisa Telegram - debería llegar al chat configurado');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Stack:', error.stack);
  }
}

testTelegramFix();
