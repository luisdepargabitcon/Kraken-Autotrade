#!/usr/bin/env node

/**
 * Script de prueba REAL de trading con RevolutX
 * Compra 1 USD de ETH, espera 30 segundos, y vende todo
 * 
 * ⚠️ ESTE SCRIPT USA DINERO REAL - USAR CON PRECAUCIÓN
 * 
 * Uso: node scripts/test-real-trade.js
 */

const BASE_URL = process.env.VPS_PANEL_URL || 'http://5.250.184.18:3020';

async function testRealTrade() {
  console.log('🚀 Iniciando prueba REAL de trading - RevolutX');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('⚠️  ESTE SCRIPT USA DINERO REAL - $1 USD');
  console.log('⚠️  PRESIONA Ctrl+C PARA CANCELAR EN CUALQUIER MOMENTO');
  console.log('');
  
  // Esperar 5 segundos para permitir cancelar
  console.log('⏳ Esperando 5 segundos antes de comenzar (Ctrl+C para cancelar)...');
  for (let i = 5; i > 0; i--) {
    console.log(`   ⏰ Quedan ${i} segundos...`);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('🔥 Iniciando trade REAL...');
  
  try {
    // 1. Verificar que el bot está funcionando
    console.log('\n🔍 Verificando estado del bot...');
    const statusResponse = await fetch(`${BASE_URL}/api/health`);
    if (!statusResponse.ok) {
      throw new Error(`Error obteniendo status: ${statusResponse.status}`);
    }
    const status = await statusResponse.json();
    console.log('✅ Bot operativo:', status.status);
    
    // 2. Obtener balance actual
    console.log('\n📊 Obteniendo balance actual...');
    const balanceResponse = await fetch(`${BASE_URL}/api/balance`);
    if (!balanceResponse.ok) {
      throw new Error(`Error obteniendo balance: ${balanceResponse.status}`);
    }
    const balance = await balanceResponse.json();
    const ethBalance = parseFloat(balance.XETH || balance.ETH || 0);
    const usdBalance = parseFloat(balance.ZUSD || balance.USD || 0);
    
    console.log(`💰 Balance actual:`);
    console.log(`   USD: $${usdBalance.toFixed(2)}`);
    console.log(`   ETH: ${ethBalance.toFixed(6)}`);
    
    if (usdBalance < 1) {
      throw new Error(`Balance USD insuficiente: $${usdBalance.toFixed(2)} (necesitas al menos $1.00)`);
    }
    
    // 3. Obtener precio actual de ETH
    console.log('\n💹 Obteniendo precio actual...');
    const priceResponse = await fetch(`${BASE_URL}/api/prices/portfolio`);
    if (!priceResponse.ok) {
      throw new Error(`Error obteniendo precios: ${priceResponse.status}`);
    }
    const priceData = await priceResponse.json();
    const ethPrice = priceData.prices.ETH.price;
    
    console.log(`   Precio ETH/USD: $${ethPrice.toFixed(2)}`);
    
    // 4. COMPRAR 1 USD de ETH
    const usdToSpend = 1;
    const ethAmount = usdToSpend / ethPrice;
    
    console.log(`\n🛒 COMPRANDO $${usdToSpend} de ETH...`);
    console.log(`   Cantidad esperada: ${ethAmount.toFixed(6)} ETH`);
    console.log(`   Precio actual: $${ethPrice.toFixed(2)}`);
    
    // Ejecutar trade real con RevolutX
    console.log('\n🚀 EJECUTANDO TRADE REAL CON REVOLUTX...');
    console.log('   POST /api/trade/revolutx');
    console.log(`   Body: { pair: "ETH/USD", type: "buy", ordertype: "market", volume: "${ethAmount}" }`);
    
    const tradeResponse = await fetch(`${BASE_URL}/api/trade/revolutx`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        pair: 'ETH/USD',
        type: 'buy',
        ordertype: 'market',
        volume: ethAmount.toString()
      })
    });
    
    if (!tradeResponse.ok) {
      const errorData = await tradeResponse.text();
      console.error(`❌ Error en trade: ${tradeResponse.status}`);
      console.error(`❌ Response: ${errorData}`);
      throw new Error(`Trade failed: ${tradeResponse.status}`);
    }
    
    const tradeResult = await tradeResponse.json();
    console.log('✅ Trade ejecutado:');
    console.log(`   Trade ID: ${tradeResult.trade.tradeId}`);
    console.log(`   Order ID: ${tradeResult.order.orderId}`);
    console.log(`   Amount: ${tradeResult.trade.amount} ETH`);
    console.log(`   Price: $${tradeResult.trade.price} USD`);
    console.log(`   Cost: $${tradeResult.order.cost} USD`);
    
    const actualEthReceived = parseFloat(tradeResult.order.amount || 0);
    
    // 5. Esperar 30 segundos
    console.log('\n⏳ Esperando 30 segundos (simulando espera real)...');
    for (let i = 30; i > 0; i--) {
      if (i % 10 === 0 || i <= 5) {
        console.log(`   ⏰ Quedan ${i} segundos...`);
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // 6. Obtener precio nuevo
    console.log('\n💹 Obteniendo precio para venta...');
    const newPriceResponse = await fetch(`${BASE_URL}/api/prices/portfolio`);
    if (!newPriceResponse.ok) {
      throw new Error(`Error obteniendo precios nuevos: ${newPriceResponse.status}`);
    }
    const newPriceData = await newPriceResponse.json();
    const newEthPrice = newPriceData.prices.ETH.price;
    
    console.log(`   Nuevo precio ETH/USD: $${newEthPrice.toFixed(2)}`);
    console.log(`   Cambio: ${newEthPrice >= ethPrice ? '📈' : '📉'} ${((newEthPrice - ethPrice) / ethPrice * 100).toFixed(2)}%`);
    
    // 7. VENDER todo el ETH recibido
    console.log('\n💰 VENDIENDO ETH recibido...');
    console.log(`   ETH a vender: ${actualEthReceived.toFixed(6)} ETH`);
    
    const sellResponse = await fetch(`${BASE_URL}/api/trade/revolutx`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        pair: 'ETH/USD',
        type: 'sell',
        ordertype: 'market',
        volume: actualEthReceived.toString()
      })
    });
    
    if (!sellResponse.ok) {
      const errorData = await sellResponse.text();
      console.error(`❌ Error en venta: ${sellResponse.status}`);
      console.error(`❌ Response: ${errorData}`);
      throw new Error(`Venta failed: ${sellResponse.status}`);
    }
    
    const sellResult = await sellResponse.json();
    console.log('✅ Venta ejecutada:');
    console.log(`   Trade ID: ${sellResult.trade.tradeId}`);
    console.log(`   Order ID: ${sellResult.order.orderId}`);
    console.log(`   Amount: ${sellResult.trade.amount} ETH`);
    console.log(`   Price: $${sellResult.trade.price} USD`);
    console.log(`   Cost: $${sellResult.order.cost} USD`);
    
    // 8. Calcular resultados finales
    const finalUsdReceived = parseFloat(sellResult.order.cost || 0);
    const pnl = finalUsdReceived - usdToSpend;
    const pnlPercent = (pnl / usdToSpend) * 100;
    
    console.log('\n📈 RESULTADOS REALES:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`💳 Invertido: $${usdToSpend.toFixed(2)} USD`);
    console.log(`💰 Recuperado: $${finalUsdReceived.toFixed(2)} USD`);
    console.log(`📊 PnL real: $${pnl.toFixed(2)} USD (${pnl >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%)`);
    console.log(`💸 Fees totales: $${(usdToSpend + finalUsdReceived - (tradeResult.order.cost + sellResult.order.cost)).toFixed(4)} USD`);
    
    // 9. Verificación final
    console.log('\n🔍 Verificación final - Balance REAL:');
    const finalBalanceResponse = await fetch(`${BASE_URL}/api/balance`);
    const finalBalance = await finalBalanceResponse.json();
    const finalUsd = parseFloat(finalBalance.ZUSD || finalBalance.USD || 0);
    const finalEth = parseFloat(finalBalance.XETH || finalBalance.ETH || 0);
    
    console.log(`   USD REAL: $${finalUsd.toFixed(2)}`);
    console.log(`   ETH REAL: ${finalEth.toFixed(6)}`);
    
    if (pnl > 0) {
      console.log('🎉 ¡GANANCIA REAL!');
    } else if (pnl < 0) {
      console.log('😅 Pérdida real (normal en trades cortos)');
    } else {
      console.log('➖ Sin cambios');
    }
    
    console.log('\n✅ Trade REAL completado exitosamente');
    
  } catch (error) {
    console.error('❌ Error en el trade:', error.message);
    process.exit(1);
  }
}

// Manejo de Ctrl+C para emergencia
process.on('SIGINT', () => {
  console.log('\n\n⚠️  Trade cancelado por usuario');
  console.log('💰 No se realizó ninguna operación real');
  process.exit(0);
});

// Ejecutar trade real
testRealTrade();
