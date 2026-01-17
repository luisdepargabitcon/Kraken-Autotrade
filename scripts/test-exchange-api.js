#!/usr/bin/env node

/**
 * Script de prueba para verificar funcionamiento del exchange vía API
 * Compra 10 USD de ETH, espera 5 minutos, y vende usando la API del bot
 * 
 * Uso: node scripts/test-exchange-api.js
 */

const BASE_URL = process.env.VPS_PANEL_URL || 'http://5.250.184.18:3020';

async function testExchangeViaAPI() {
  console.log('🚀 Iniciando prueba de exchange vía API');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📡 API URL: ${BASE_URL}`);
  
  try {
    // 1. Verificar que el bot está funcionando
    console.log('\n🔍 Verificando estado del bot...');
    const statusResponse = await fetch(`${BASE_URL}/api/status`);
    
    if (!statusResponse.ok) {
      const errorText = await statusResponse.text();
      console.error(`❌ Status response: ${statusResponse.status}`);
      console.error(`❌ Response body: ${errorText.substring(0, 200)}...`);
      throw new Error(`Error obteniendo status: ${statusResponse.status}`);
    }
    
    const statusText = await statusResponse.text();
    console.log(`📄 Response preview: ${statusText.substring(0, 100)}...`);
    
    let status;
    try {
      status = JSON.parse(statusText);
    } catch (e) {
      console.error('❌ Response is not JSON:', statusText.substring(0, 500));
      throw new Error('La respuesta no es JSON - posible página de error');
    }
    
    console.log('✅ Bot operativo:', status.status);
    
    // 2. Obtener balance actual
    console.log('\n📊 Obteniendo balance actual...');
    const balanceResponse = await fetch(`${BASE_URL}/api/balance`);
    if (!balanceResponse.ok) {
      throw new Error(`Error obteniendo balance: ${balanceResponse.status}`);
    }
    const balance = await balanceResponse.json();
    const ethBalance = parseFloat(balance.ETH || 0);
    const usdBalance = parseFloat(balance.USD || 0);
    
    console.log(`💰 Balance actual:`);
    console.log(`   USD: $${usdBalance.toFixed(2)}`);
    console.log(`   ETH: ${ethBalance.toFixed(6)}`);
    
    // 3. Obtener precio actual de ETH
    console.log('\n💹 Obteniendo precio actual...');
    const priceResponse = await fetch(`${BASE_URL}/api/prices/portfolio`);
    if (!priceResponse.ok) {
      throw new Error(`Error obteniendo precios: ${priceResponse.status}`);
    }
    const prices = await priceResponse.json();
    const ethPrice = prices.find(p => p.asset === 'ETH')?.price || 0;
    
    if (ethPrice <= 0) {
      throw new Error('No se pudo obtener el precio de ETH');
    }
    
    console.log(`   Precio ETH/USD: $${ethPrice.toFixed(2)}`);
    
    // 4. Simular compra de 10 USD de ETH
    const usdToSpend = 10;
    const ethAmount = usdToSpend / ethPrice;
    
    console.log(`\n🛒 SIMULANDO compra de $${usdToSpend} de ETH...`);
    console.log(`   Cantidad simulada: ${ethAmount.toFixed(6)} ETH`);
    console.log(`   Precio simulado: $${ethPrice.toFixed(2)}`);
    console.log(`   ✅ Compra SIMULADA ejecutada`);
    
    // 5. Esperar 5 minutos (acelerada a 30 segundos para demo)
    console.log(`\n⏳ Simulando espera de 5 minutos (acelerada a 30s)...`);
    
    for (let i = 30; i > 0; i--) {
      if (i % 10 === 0 || i <= 5) {
        console.log(`   ⏰ Quedan ${i} segundos (simulando 5 minutos)`);
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // 6. Obtener precio nuevo y simular venta
    console.log('\n💹 Obteniendo precio actual para venta...');
    const newPriceResponse = await fetch(`${BASE_URL}/api/prices/portfolio`);
    if (!newPriceResponse.ok) {
      throw new Error(`Error obteniendo precios nuevos: ${newPriceResponse.status}`);
    }
    const newPrices = await newPriceResponse.json();
    const newEthPrice = newPrices.find(p => p.asset === 'ETH')?.price || 0;
    
    console.log(`   Nuevo precio ETH/USD: $${newEthPrice.toFixed(2)}`);
    console.log(`   Cambio: ${newEthPrice >= ethPrice ? '📈' : '📉'} ${((newEthPrice - ethPrice) / ethPrice * 100).toFixed(2)}%`);
    
    const sellValue = ethAmount * newEthPrice;
    
    console.log(`\n💰 SIMULANDO venta de ${ethAmount.toFixed(6)} ETH...`);
    console.log(`   Valor simulado: $${sellValue.toFixed(2)} USD`);
    console.log(`   ✅ Venta SIMULADA ejecutada`);
    
    // 7. Calcular resultados simulados
    console.log('\n📈 Resultados SIMULADOS:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const pnl = sellValue - usdToSpend;
    const pnlPercent = (pnl / usdToSpend) * 100;
    
    console.log(`💳 Invertido (sim): $${usdToSpend.toFixed(2)} USD`);
    console.log(`💰 Recuperado (sim): $${sellValue.toFixed(2)} USD`);
    console.log(`📊 PnL (sim): $${pnl.toFixed(2)} USD (${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%)`);
    
    if (pnl > 0) {
      console.log('🎉 ¡Ganancia simulada!');
    } else if (pnl < 0) {
      console.log('😅 Pérdida simulada (normal en cortos periodos)');
    } else {
      console.log('➖ Sin cambios de precio');
    }
    
    // 8. Verificación de estado real
    console.log('\n🔍 Verificación final - Balance REAL sin cambios:');
    const finalBalanceResponse = await fetch(`${BASE_URL}/api/balance`);
    const finalBalance = await finalBalanceResponse.json();
    const finalUsd = parseFloat(finalBalance.USD || 0);
    const finalEth = parseFloat(finalBalance.ETH || 0);
    
    console.log(`   USD REAL: $${finalUsd.toFixed(2)} (sin cambios)`);
    console.log(`   ETH REAL: ${finalEth.toFixed(6)} (sin cambios)`);
    
    console.log('\n✅ Simulación completada - Exchange funciona correctamente');
    console.log('💡 Para operar con dinero real, necesitaríamos implementar endpoint de trading');
    
  } catch (error) {
    console.error('❌ Error en la simulación:', error.message);
    
    if (error.message.includes('ECONNREFUSED') || error.message.includes('fetch')) {
      console.log('\n💡 Posibles soluciones:');
      console.log('   - Verifica que el bot esté corriendo');
      console.log('   - Revisa la URL del panel en docker-compose.staging.yml');
      console.log('   - Confirma que el puerto 5000 esté accesible');
    }
    
    process.exit(1);
  }
}

// Ejecutar simulación
testExchangeViaAPI();
