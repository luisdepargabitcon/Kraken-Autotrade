#!/usr/bin/env node

/**
 * Script de prueba para verificar funcionamiento del exchange
 * Compra 10 USD de ETH, espera 5 minutos, y vende
 * 
 * Uso: node scripts/test-exchange-trade.js
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Cargar variables de entorno
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

import RevolutXService from '../server/services/exchanges/RevolutXService.js';

async function testExchangeTrade() {
  console.log('🚀 Iniciando prueba de exchange - RevolutX');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  try {
    // Inicializar servicio
    const exchange = new RevolutXService();
    await exchange.initialize();
    
    console.log('✅ Exchange inicializado correctamente');
    
    // 1. Obtener balance actual
    console.log('\n📊 Obteniendo balance actual...');
    const balance = await exchange.getBalance();
    const ethBalance = parseFloat(balance.ETH || 0);
    const usdBalance = parseFloat(balance.USD || 0);
    
    console.log(`💰 Balance actual:`);
    console.log(`   USD: $${usdBalance.toFixed(2)}`);
    console.log(`   ETH: ${ethBalance.toFixed(6)}`);
    
    // 2. Comprar 10 USD de ETH
    const usdToSpend = 10;
    console.log(`\n🛒 Comprando $${usdToSpend} de ETH...`);
    
    const ticker = await exchange.getTicker('ETH/USD');
    const currentPrice = parseFloat(ticker.price);
    const ethAmount = usdToSpend / currentPrice;
    
    console.log(`   Precio actual ETH/USD: $${currentPrice.toFixed(2)}`);
    console.log(`   Cantidad a comprar: ${ethAmount.toFixed(6)} ETH`);
    
    const buyOrder = await exchange.createMarketOrder('buy', 'ETH/USD', ethAmount);
    
    console.log(`✅ Orden de compra ejecutada:`);
    console.log(`   Order ID: ${buyOrder.orderId}`);
    console.log(`   Cantidad: ${buyOrder.amount} ETH`);
    console.log(`   Precio: $${buyOrder.price} USD`);
    console.log(`   Total: $${buyOrder.cost} USD`);
    
    // 3. Esperar 5 minutos
    console.log(`\n⏳ Esperando 5 minutos para vender...`);
    console.log('   (Ctrl+C para cancelar y vender manualmente)');
    
    for (let i = 300; i > 0; i--) {
      if (i % 60 === 0 || i <= 10) {
        console.log(`   ⏰ Quedan ${Math.floor(i / 60)}:${(i % 60).toString().padStart(2, '0')}`);
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // 4. Vender exactamente el ETH comprado (incluyendo fees)
    console.log('\n💰 Vendiendo exactamente el ETH comprado...');
    
    // Obtener balance actual para ver cuánto ETH recibimos realmente
    const newBalance = await exchange.getBalance();
    const actualEthReceived = parseFloat(newBalance.ETH || 0);
    
    if (actualEthReceived <= 0) {
      console.log('❌ No hay ETH para vender');
      return;
    }
    
    console.log(`   ETH recibido en compra: ${actualEthReceived.toFixed(8)} ETH`);
    console.log(`   ETH teórico sin fees: ${ethAmount.toFixed(8)} ETH`);
    console.log(`   Diferencia (fees): ${(ethAmount - actualEthReceived).toFixed(8)} ETH`);
    
    // Vender exactamente el ETH que tenemos (lo que recibimos después de fees)
    const sellOrder = await exchange.createMarketOrder('sell', 'ETH/USD', actualEthReceived);
    
    console.log(`✅ Orden de venta ejecutada:`);
    console.log(`   Order ID: ${sellOrder.orderId}`);
    console.log(`   Cantidad: ${sellOrder.amount} ETH`);
    console.log(`   Precio: $${sellOrder.price} USD`);
    console.log(`   Total: $${sellOrder.cost} USD`);
    
    // 5. Calcular resultados precisos
    console.log('\n📈 Resultados de la operación:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const finalBalance = await exchange.getBalance();
    const finalUsd = parseFloat(finalBalance.USD || 0);
    const pnl = finalUsd - usdBalance;
    const pnlPercent = (pnl / usdToSpend) * 100;
    
    // Calcular fees
    const buyFee = usdToSpend - (buyOrder.amount * buyOrder.price);
    const sellFee = (sellOrder.amount * sellOrder.price) - sellOrder.cost;
    const totalFees = buyFee + sellFee;
    
    console.log(`💳 Invertido: $${usdToSpend.toFixed(2)} USD`);
    console.log(`💰 Recuperado: $${sellOrder.cost.toFixed(2)} USD`);
    console.log(`📊 PnL neto: $${pnl.toFixed(2)} USD (${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%)`);
    console.log(`💸 Fees totales: $${totalFees.toFixed(4)} USD`);
    console.log(`   └─ Fee compra: $${buyFee.toFixed(4)} USD`);
    console.log(`   └─ Fee venta: $${sellFee.toFixed(4)} USD`);
    console.log(`💵 Balance final USD: $${finalUsd.toFixed(2)}`);
    console.log(`🪙 ETH final: ${parseFloat(finalBalance.ETH || 0).toFixed(8)} ETH`);
    
    if (pnl > 0) {
      console.log('🎉 ¡Ganancia!');
    } else if (pnl < 0) {
      console.log('😅 Pérdida pequeña (es normal en 5 minutos)');
    } else {
      console.log('➖ Sin pérdidas/ganancias');
    }
    
  } catch (error) {
    console.error('❌ Error en la prueba:', error.message);
    
    if (error.message.includes('insufficient')) {
      console.log('\n💡 Posibles soluciones:');
      console.log('   - Verifica que tengas saldo USD disponible');
      console.log('   - Revisa las comisiones de trading');
      console.log('   - Intenta con un monto menor (ej: $5 USD)');
    }
    
    process.exit(1);
  }
}

// Manejar Ctrl+C para venta de emergencia
process.on('SIGINT', async () => {
  console.log('\n\n⚠️  Interrupción detectada - Vendiendo ETH de emergencia...');
  
  try {
    const exchange = new RevolutXService();
    await exchange.initialize();
    
    const balance = await exchange.getBalance();
    const ethBalance = parseFloat(balance.ETH || 0);
    
    if (ethBalance > 0) {
      console.log(`🚨 Vendiendo ${ethBalance.toFixed(8)} ETH de emergencia...`);
      const sellOrder = await exchange.createMarketOrder('sell', 'ETH/USD', ethBalance);
      console.log(`✅ Venta de emergencia completada: $${sellOrder.cost.toFixed(2)} USD`);
      console.log(`   Cantidad vendida: ${sellOrder.amount} ETH`);
    } else {
      console.log('ℹ️  No hay ETH para vender');
    }
  } catch (error) {
    console.error('❌ Error en venta de emergencia:', error.message);
  }
  
  process.exit(0);
});

// Ejecutar prueba
if (import.meta.url === `file://${process.argv[1]}`) {
  testExchangeTrade();
}

export { testExchangeTrade };
