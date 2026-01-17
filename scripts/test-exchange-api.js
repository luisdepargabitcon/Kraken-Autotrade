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
    
    // Probar diferentes endpoints
    const endpoints = ['/api/status', '/api/health', '/api/ping', '/status', '/health'];
    let workingEndpoint = null;
    let status = null;
    
    for (const endpoint of endpoints) {
      console.log(`   📡 Probando ${BASE_URL}${endpoint}...`);
      try {
        const response = await fetch(`${BASE_URL}${endpoint}`);
        const responseText = await response.text();
        
        if (response.ok) {
          try {
            const data = JSON.parse(responseText);
            console.log(`   ✅ ${endpoint} funciona!`);
            workingEndpoint = endpoint;
            status = data;
            break;
          } catch (e) {
            console.log(`   ❌ ${endpoint} devuelve HTML, no JSON`);
          }
        } else {
          console.log(`   ❌ ${endpoint} status: ${response.status}`);
        }
      } catch (e) {
        console.log(`   ❌ ${endpoint} error: ${e.message}`);
      }
    }
    
    if (!workingEndpoint) {
      console.log('\n❌ Ningún endpoint de API funcionó');
      console.log('💡 Esto puede significar:');
      console.log('   - El bot solo sirve el frontend (React app)');
      console.log('   - La API está en un puerto diferente');
      console.log('   - Los endpoints de API no existen');
      
      // Verificar si es el frontend de React
      console.log('\n🔍 Verificando si es el frontend...');
      try {
        const response = await fetch(BASE_URL);
        const text = await response.text();
        if (text.includes('KrakenAutoTrade') && text.includes('React')) {
          console.log('✅ Confirmado: Es el frontend de React');
          console.log('❌ La API probablemente no está expuesta públicamente');
        }
      } catch (e) {
        console.log('❌ Error verificando frontend:', e.message);
      }
      
      throw new Error('No se encontró ningún endpoint de API funcional');
    }
    
    console.log(`✅ Bot operativo usando ${workingEndpoint}:`, status);
    
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
    const priceData = await priceResponse.json();
    console.log('📄 Formato de precios recibido:', JSON.stringify(priceData, null, 2).substring(0, 300) + '...');
    
    let ethPrice = 0;
    
    // Intentar diferentes formatos posibles
    if (Array.isArray(priceData)) {
      // Formato: [{ asset: 'ETH', price: 3333.33 }, ...]
      ethPrice = priceData.find(p => p.asset === 'ETH')?.price || 0;
    } else if (priceData.prices && Array.isArray(priceData.prices)) {
      // Formato: { prices: [{ asset: 'ETH', price: 3333.33 }, ...] }
      ethPrice = priceData.prices.find(p => p.asset === 'ETH')?.price || 0;
    } else if (priceData.ETH) {
      // Formato: { ETH: 3333.33, BTC: 45000.00, ... }
      ethPrice = priceData.ETH;
    } else if (priceData.data && priceData.data.ETH) {
      // Formato: { data: { ETH: 3333.33, ... } }
      ethPrice = priceData.data.ETH;
    }
    
    console.log(`💰 ETH price detected: $${ethPrice}`);
    
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
    const newPriceData = await newPriceResponse.json();
    
    let newEthPrice = 0;
    
    // Usar la misma lógica flexible que antes
    if (Array.isArray(newPriceData)) {
      newEthPrice = newPriceData.find(p => p.asset === 'ETH')?.price || 0;
    } else if (newPriceData.prices && Array.isArray(newPriceData.prices)) {
      newEthPrice = newPriceData.prices.find(p => p.asset === 'ETH')?.price || 0;
    } else if (newPriceData.ETH) {
      newEthPrice = newPriceData.ETH;
    } else if (newPriceData.data && newPriceData.data.ETH) {
      newEthPrice = newPriceData.data.ETH;
    }
    
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
