/**
 * Script de prueba para el sistema de alertas de errores críticos
 * Ejecutar con: npx tsx server/test/errorAlertTest.ts
 */

import { errorAlertService, ErrorAlertService } from '../services/ErrorAlertService';

async function testErrorAlerts() {
  console.log('🧪 Iniciando pruebas del sistema de alertas de errores...\n');

  try {
    // Test 1: PRICE_INVALID
    console.log('📊 Test 1: PRICE_INVALID');
    const priceAlert = ErrorAlertService.createCustomAlert(
      'PRICE_INVALID',
      'Precio inválido detectado durante prueba: currentPrice=0 para BTC/USD',
      'HIGH',
      'testPriceInvalid',
      'server/test/errorAlertTest.ts',
      25,
      'BTC/USD',
      { currentPrice: 0, testMode: true }
    );
    await errorAlertService.sendCriticalError(priceAlert);
    console.log('✅ Alerta PRICE_INVALID enviada\n');

    // Esperar 2 segundos entre tests
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Test 2: API_ERROR
    console.log('🌐 Test 2: API_ERROR');
    const apiAlert = ErrorAlertService.createCustomAlert(
      'API_ERROR',
      'Error de API simulado: Revolut X endpoint no responde',
      'MEDIUM',
      'testApiError',
      'server/test/errorAlertTest.ts',
      40,
      'ETH/USD',
      { 
        endpoint: 'https://revx.revolut.com/market-data/public/ticker',
        status: 500,
        testMode: true
      }
    );
    await errorAlertService.sendCriticalError(apiAlert);
    console.log('✅ Alerta API_ERROR enviada\n');

    await new Promise(resolve => setTimeout(resolve, 2000));

    // Test 3: DATABASE_ERROR
    console.log('🗄️ Test 3: DATABASE_ERROR');
    const dbError = new Error('Connection timeout to PostgreSQL database');
    const dbAlert = ErrorAlertService.createFromError(
      dbError,
      'DATABASE_ERROR',
      'CRITICAL',
      'testDatabaseError',
      'server/test/errorAlertTest.ts',
      undefined,
      { 
        operation: 'getBotConfig',
        testMode: true,
        connectionPool: 'primary'
      }
    );
    await errorAlertService.sendCriticalError(dbAlert);
    console.log('✅ Alerta DATABASE_ERROR enviada\n');

    await new Promise(resolve => setTimeout(resolve, 2000));

    // Test 4: TRADING_ERROR
    console.log('📈 Test 4: TRADING_ERROR');
    const tradingAlert = ErrorAlertService.createCustomAlert(
      'TRADING_ERROR',
      'Error crítico en cierre de posición: Insufficient balance',
      'CRITICAL',
      'testTradingError',
      'server/test/errorAlertTest.ts',
      70,
      'SOL/USD',
      {
        lotId: 'test-lot-12345',
        operation: 'closePosition',
        balance: 0.001,
        required: 0.1,
        testMode: true
      }
    );
    await errorAlertService.sendCriticalError(tradingAlert);
    console.log('✅ Alerta TRADING_ERROR enviada\n');

    await new Promise(resolve => setTimeout(resolve, 2000));

    // Test 5: Rate Limiting
    console.log('⏱️ Test 5: Rate Limiting');
    console.log('Enviando 3 alertas del mismo tipo rápidamente...');
    
    for (let i = 1; i <= 3; i++) {
      const rateLimitAlert = ErrorAlertService.createCustomAlert(
        'SYSTEM_ERROR',
        `Error de sistema #${i} - Test de rate limiting`,
        'HIGH',
        'testRateLimit',
        'server/test/errorAlertTest.ts',
        90 + i,
        undefined,
        { testNumber: i, testMode: true }
      );
      await errorAlertService.sendCriticalError(rateLimitAlert);
      console.log(`  - Alerta ${i} procesada`);
      
      if (i < 3) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    console.log('✅ Test de rate limiting completado (solo la primera debería enviarse)\n');

    console.log('🎉 Todas las pruebas completadas exitosamente!');
    console.log('📱 Revisa tu Telegram para ver las alertas recibidas.');
    
  } catch (error) {
    console.error('❌ Error durante las pruebas:', error);
  }
}

// Ejecutar tests si se llama directamente
if (require.main === module) {
  testErrorAlerts().then(() => {
    console.log('\n✨ Script de pruebas finalizado');
    process.exit(0);
  }).catch(error => {
    console.error('\n💥 Error fatal en las pruebas:', error);
    process.exit(1);
  });
}

export { testErrorAlerts };
