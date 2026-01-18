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

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getRevolutxBalances() {
  const balanceResponse = await fetch(`${BASE_URL}/api/balances/all`);
  if (!balanceResponse.ok) {
    throw new Error(`Error obteniendo balance: ${balanceResponse.status}`);
  }
  const balanceData = await balanceResponse.json();
  return balanceData.revolutx?.balances || {};
}

async function placeRevolutxMarketOrder({ pair, type, volume }) {
  const tradeResponse = await fetch(`${BASE_URL}/api/trade/revolutx`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      pair,
      type,
      ordertype: 'market',
      volume: volume.toString(),
    }),
  });

  const responseText = await tradeResponse.text();
  let responseJson = null;
  try {
    responseJson = responseText ? JSON.parse(responseText) : null;
  } catch (_) {
    responseJson = null;
  }

  return {
    ok: tradeResponse.ok,
    status: tradeResponse.status,
    text: responseText,
    json: responseJson,
  };
}

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
    await sleep(1000);
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
    
    // 2. Obtener balance actual de RevolutX
    console.log('\n📊 Obteniendo balance actual...');
    const balance = await getRevolutxBalances();
    const ethBalance = parseFloat(balance.ETH || 0);
    const usdBalance = parseFloat(balance.USD || 0);
    
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
    
    // 4. COMPRAR ~$1 de ETH (con buffer para cumplir mínimo del exchange)
    const usdTarget = 1.0;
    let usdBuffer = 0.05; // empieza en $1.05
    const maxUsdBuffer = 0.50;
    let tradeResult = null;
    let ethAmount = 0;

    console.log(`\n🛒 COMPRANDO ~$${usdTarget.toFixed(2)} de ETH...`);
    console.log(`   Nota: se aplica buffer automático para evitar rechazo por mínimo`);
    console.log(`   Precio actual: $${ethPrice.toFixed(2)}`);

    while (usdBuffer <= maxUsdBuffer) {
      const usdToSpend = usdTarget + usdBuffer;
      ethAmount = usdToSpend / ethPrice;

      console.log('\n🚀 EJECUTANDO TRADE REAL CON REVOLUTX...');
      console.log('   POST /api/trade/revolutx');
      console.log(`   Intento con ~$${usdToSpend.toFixed(2)} => volume(base_size)=${ethAmount}`);

      const resp = await placeRevolutxMarketOrder({
        pair: 'ETH/USD',
        type: 'buy',
        volume: ethAmount,
      });

      if (resp.ok && resp.json) {
        tradeResult = resp.json;
        break;
      }

      console.error(`❌ Error en trade: ${resp.status}`);
      console.error(`❌ Response: ${resp.text}`);

      const msg = (resp.json && resp.json.error) ? resp.json.error : resp.text;
      if (typeof msg === 'string' && msg.includes('Estimated amount for order is too small')) {
        usdBuffer += 0.05;
        console.log(`⚠️  Mínimo no alcanzado. Subiendo buffer a +$${usdBuffer.toFixed(2)} y reintentando...`);
        continue;
      }

      throw new Error(`Trade failed: ${resp.status}`);
    }

    if (!tradeResult) {
      throw new Error(`Trade failed: no se pudo cumplir el mínimo tras buffer hasta +$${maxUsdBuffer.toFixed(2)}`);
    }
    console.log('✅ Trade ejecutado:');
    console.log(`   Trade ID: ${tradeResult.trade.tradeId}`);
    console.log(`   Order ID: ${tradeResult.order.orderId}`);
    console.log(`   Amount (requested): ${tradeResult.trade.amount} ETH`);

    // Derivar cantidad comprada y USD gastado desde delta de balances (más fiable que order.cost)
    const postBuyBalance = await getRevolutxBalances();
    const usdAfterBuy = parseFloat(postBuyBalance.USD || 0);
    const ethAfterBuy = parseFloat(postBuyBalance.ETH || 0);
    const actualEthReceived = Math.max(0, ethAfterBuy - ethBalance);
    const usdSpentReal = Math.max(0, usdBalance - usdAfterBuy);

    console.log(`   ETH comprado (delta): ${actualEthReceived.toFixed(8)} ETH`);
    console.log(`   USD gastado (delta): $${usdSpentReal.toFixed(4)} USD`);

    if (actualEthReceived <= 0) {
      throw new Error('No se pudo determinar ETH comprado (delta de balance <= 0).');
    }
    
    // 5. Esperar 30 segundos
    console.log('\n⏳ Esperando 30 segundos (simulando espera real)...');
    for (let i = 30; i > 0; i--) {
      if (i % 10 === 0 || i <= 5) {
        console.log(`   ⏰ Quedan ${i} segundos...`);
      }
      await sleep(1000);
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
    
    const sellResp = await placeRevolutxMarketOrder({
      pair: 'ETH/USD',
      type: 'sell',
      volume: actualEthReceived,
    });

    if (!sellResp.ok || !sellResp.json) {
      console.error(`❌ Error en venta: ${sellResp.status}`);
      console.error(`❌ Response: ${sellResp.text}`);
      throw new Error(`Venta failed: ${sellResp.status}`);
    }

    const sellResult = sellResp.json;
    console.log('✅ Venta ejecutada:');
    console.log(`   Trade ID: ${sellResult.trade.tradeId}`);
    console.log(`   Order ID: ${sellResult.order.orderId}`);
    console.log(`   Amount (requested): ${sellResult.trade.amount} ETH`);
    
    // 8. Calcular resultados finales por delta real de balances
    const postSellBalance = await getRevolutxBalances();
    const usdAfterSell = parseFloat(postSellBalance.USD || 0);
    const ethAfterSell = parseFloat(postSellBalance.ETH || 0);

    const usdReceivedReal = Math.max(0, usdAfterSell - usdAfterBuy);
    const pnl = usdAfterSell - usdBalance;
    const pnlPercent = usdSpentReal > 0 ? (pnl / usdSpentReal) * 100 : 0;
    
    console.log('\n📈 RESULTADOS REALES:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`💳 USD gastado (delta buy): $${usdSpentReal.toFixed(4)} USD`);
    console.log(`💰 USD recuperado (delta sell): $${usdReceivedReal.toFixed(4)} USD`);
    console.log(`📊 PnL neto (delta total): $${pnl.toFixed(4)} USD (${pnl >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%)`);
    
    // 9. Verificación final
    console.log('\n🔍 Verificación final - Balance REAL:');
    const finalBalance = await getRevolutxBalances();
    const finalUsd = parseFloat(finalBalance.USD || 0);
    const finalEth = parseFloat(finalBalance.ETH || 0);
    
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
