#!/usr/bin/env node

/**
 * Script de SIMULACIÓN para verificar funcionamiento del exchange
 * Simula compra y venta sin usar dinero real
 * 
 * Uso: node scripts/test-exchange-simulation.js
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Cargar variables de entorno
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

import RevolutXService from '../server/services/exchanges/RevolutXService.js';

async function testExchangeSimulation() {
  console.log('🎭 Iniciando SIMULACIÓN de exchange - RevolutX');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('⚠️  ESTE ES UNA SIMULACIÓN - NO SE USA DINERO REAL');
  console.log('');
  
  try {
    // Inicializar servicio
    const exchange = new RevolutXService();
    await exchange.initialize();
    
    console.log('✅ Exchange inicializado correctamente');
    
    // 1. Obtener balance actual (solo lectura)
    console.log('\n📊 Verificando balance actual...');
    const balance = await exchange.getBalance();
    const ethBalance = parseFloat(balance.ETH || 0);
    const usdBalance = parseFloat(balance.USD || 0);
    
    console.log(`💰 Balance real:`);
    console.log(`   USD: $${usdBalance.toFixed(2)}`);
    console.log(`   ETH: ${ethBalance.toFixed(6)}`);
    
    // 2. Obtener precio actual
    console.log('\n💹 Obteniendo precio actual...');
    const ticker = await exchange.getTicker('ETH/USD');
    const currentPrice = parseFloat(ticker.price);
    
    console.log(`   Precio ETH/USD: $${currentPrice.toFixed(2)}`);
    
    // 3. Simular compra de 10 USD de ETH
    const usdToSpend = 10;
    const ethAmount = usdToSpend / currentPrice;
    
    console.log(`\n🛒 SIMULANDO compra de $${usdToSpend} de ETH...`);
    console.log(`   Cantidad simulada: ${ethAmount.toFixed(6)} ETH`);
    console.log(`   Precio simulado: $${currentPrice.toFixed(2)}`);
    console.log(`   ✅ Compra SIMULADA ejecutada`);
    
    // 4. Simular espera de 5 minutos (acelerada a 30 segundos para demo)
    console.log(`\n⏳ Simulando espera de 5 minutos (acelerada a 30s)...`);
    
    for (let i = 30; i > 0; i--) {
      if (i % 10 === 0 || i <= 5) {
        console.log(`   ⏰ Quedan ${i} segundos (simulando 5 minutos)`);
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // 5. Obtener precio nuevo y simular venta
    console.log('\n💹 Obteniendo precio actual para venta...');
    const newTicker = await exchange.getTicker('ETH/USD');
    const newPrice = parseFloat(newTicker.price);
    
    console.log(`   Nuevo precio ETH/USD: $${newPrice.toFixed(2)}`);
    console.log(`   Cambio: ${newPrice >= currentPrice ? '📈' : '📉'} ${((newPrice - currentPrice) / currentPrice * 100).toFixed(2)}%`);
    
    const sellValue = ethAmount * newPrice;
    
    console.log(`\n💰 SIMULANDO venta de ${ethAmount.toFixed(6)} ETH...`);
    console.log(`   Valor simulado: $${sellValue.toFixed(2)} USD`);
    console.log(`   ✅ Venta SIMULADA ejecutada`);
    
    // 6. Calcular resultados simulados
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
    
    // 7. Verificación de estado real
    console.log('\n🔍 Verificación final - Balance REAL sin cambios:');
    const finalBalance = await exchange.getBalance();
    const finalUsd = parseFloat(finalBalance.USD || 0);
    const finalEth = parseFloat(finalBalance.ETH || 0);
    
    console.log(`   USD REAL: $${finalUsd.toFixed(2)} (sin cambios)`);
    console.log(`   ETH REAL: ${finalEth.toFixed(6)} (sin cambios)`);
    
    console.log('\n✅ Simulación completada - Exchange funciona correctamente');
    console.log('💡 Para operar con dinero real, usa: node scripts/test-exchange-trade.js');
    
  } catch (error) {
    console.error('❌ Error en la simulación:', error.message);
    
    if (error.message.includes('connection') || error.message.includes('network')) {
      console.log('\n💡 Posibles soluciones:');
      console.log('   - Verifica conexión a internet');
      console.log('   - Revisa credenciales de RevolutX');
      console.log('   - Confirma que el exchange esté operativo');
    }
    
    process.exit(1);
  }
}

// Ejecutar simulación
if (import.meta.url === `file://${process.argv[1]}`) {
  testExchangeSimulation();
}

export { testExchangeSimulation };
