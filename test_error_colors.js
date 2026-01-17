// Script para probar los nuevos colores de errores
console.log('=== DEMOSTRACIÓN DE NUEVOS COLORES DE ERRORES ===');

console.log('\n🎨 COLORES IMPLEMENTADOS POR SEVERIDAD:');

console.log('\n1. ERROR LOW (⚠️):');
console.log('   Color: Gris por defecto (sin cambios)');
console.log('   Uso: Errores menores informativos');

console.log('\n2. ERROR MEDIUM (🟡):');
console.log('   Color: Naranja (#FFA500)');
console.log('   Uso: Errores importantes pero no críticos');

console.log('\n3. ERROR HIGH (🔴):');
console.log('   Color: Rojo fuerte (#FF4444)');
console.log('   Uso: Errores graves que requieren atención');

console.log('\n4. ERROR CRITICAL (🚨):');
console.log('   Color: Rojo brillante + negrita (#FF0000; font-weight: bold)');
console.log('   Uso: Errores críticos que necesitan acción inmediata');

console.log('\n📋 EJEMPLOS VISUALES:');

console.log('\n--- ERROR MEDIUM ---');
console.log('⚠️ <span style="color: #FFA500"><b>ERROR MEDIUM</b></span> 🌐');
console.log('━━━━━━━━━━━━━━━━━━━');
console.log('📦 <span style="color: #FFA500"><b>Tipo:</b></span> API_ERROR');
console.log('⏰ <span style="color: #FFA500"><b>Hora:</b></span> 17/01/2026 11:37:00');
console.log('❌ <span style="color: #FFA500"><b>Error:</b></span> Conexión fallida');

console.log('\n--- ERROR HIGH ---');
console.log('🔴 <span style="color: #FF4444"><b>ERROR HIGH</b></span> 📈');
console.log('━━━━━━━━━━━━━━━━━━━');
console.log('📦 <span style="color: #FF4444"><b>Tipo:</b></span> TRADING_ERROR');
console.log('⏰ <span style="color: #FF4444"><b>Hora:</b></span> 17/01/2026 11:37:00');
console.log('❌ <span style="color: #FF4444"><b>Error:</b></span> Orden rechazada');

console.log('\n--- ERROR CRITICAL ---');
console.log('🚨 <span style="color: #FF0000; font-weight: bold"><b>ERROR CRITICAL</b></span> 🗄️');
console.log('━━━━━━━━━━━━━━━━━━━');
console.log('📦 <span style="color: #FF0000; font-weight: bold"><b>Tipo:</b></span> DATABASE_ERROR');
console.log('⏰ <span style="color: #FF0000; font-weight: bold"><b>Hora:</b></span> 17/01/2026 11:37:00');
console.log('❌ <span style="color: #FF0000; font-weight: bold"><b>Error:</b></span> Conexión perdida con BD');

console.log('\n✅ CAMBIOS REALIZADOS:');
console.log('1. Añadido sistema de colores por severidad');
console.log('2. Todos los campos del mensaje ahora usan el color correspondiente');
console.log('3. Los errores críticos tienen negrita adicional');
console.log('4. Formato unificado para todos los tipos de error');

console.log('\n🔄 PARA PROBAR EN VPS:');
console.log('cd /opt/krakenbot-staging');
console.log('git pull origin main');
console.log('docker compose -f docker-compose.staging.yml up -d --build');

console.log('\n📱 LOS MENSAJES EN TELEGRAM MOSTRARÁN:');
console.log('• Colores diferenciados por severidad');
console.log('• Mayor impacto visual para errores críticos');
console.log('• Jerarquía visual clara de importancia');
