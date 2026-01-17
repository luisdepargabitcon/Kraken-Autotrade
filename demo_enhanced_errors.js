// Demostración de errores mejorados con más código fuente
console.log('=== ERRORES MEJORADOS - MÁS CÓDIGO FUENTE ===');

console.log('\n📊 NUEVA CONFIGURACIÓN DE LÍNEAS POR SEVERIDAD:');

console.log('\n1. ERROR LOW/MEDIUM (⚠️🟡):');
console.log('   • Líneas: 10 totales (5 antes + 4 después)');
console.log('   • Etiqueta: "Código implicado"');
console.log('   • Uso: Contexto básico del error');

console.log('\n2. ERROR HIGH (🔴):');
console.log('   • Líneas: 15 totales (7 antes + 7 después)');
console.log('   • Etiqueta: "Código contextual"');
console.log('   • Uso: Mayor contexto para diagnóstico');

console.log('\n3. ERROR CRITICAL (🚨):');
console.log('   • Líneas: 25 totales (12 antes + 12 después)');
console.log('   • Etiqueta: "Código fuente" + instrucción de copiado');
console.log('   • Uso: Contexto completo para análisis profundo');

console.log('\n📱 EJEMPLO ERROR CRITICAL CON MÁS CÓDIGO:');
console.log('🚨 ERROR CRITICAL 🗄️');
console.log('━━━━━━━━━━━━━━━━━━━');
console.log('📦 Tipo: DATABASE_ERROR');
console.log('⏰ Hora: 17/01/2026 11:39:00');
console.log('📍 Archivo: DatabaseService.ts');
console.log('📍 Función: connect()');
console.log('📍 Línea: 156');
console.log('❌ Error: Connection timeout after 30000ms');
console.log('');
console.log('📋 Código Fuente:');
console.log('💡 Para copiar: Selecciona el código y usa Ctrl+C');
console.log('📁 Archivo: DatabaseService.ts:156');
console.log('   144   async connect() {');
console.log('   145     try {');
console.log('   146       console.log("[DB] Connecting to database...");');
console.log('   147       ');
console.log('   148       // Configuración de conexión');
console.log('   149       const config = {');
console.log('   150         host: process.env.DB_HOST,');
console.log('   151         port: parseInt(process.env.DB_PORT || "5432"),');
console.log('   152         database: process.env.DB_NAME,');
console.log('   153         user: process.env.DB_USER,');
console.log('   154         password: process.env.DB_PASSWORD,');
console.log('   155         timeout: 30000,');
console.log('→  156         connectionTimeoutMillis: 30000');
console.log('   157       };');
console.log('   158       ');
console.log('   159       // Intentar conexión');
console.log('   160       this.pool = new Pool(config);');
console.log('   161       await this.pool.connect();');
console.log('   162       ');
console.log('   163       console.log("[DB] Connected successfully");');
console.log('   164       return true;');
console.log('   165     } catch (error) {');
console.log('   166       console.error("[DB] Connection failed:", error);');
console.log('   167       throw error;');
console.log('   168     }');
console.log('   169   }');
console.log('   170 ');
console.log('   171   async disconnect() {');
console.log('   172     if (this.pool) {');
console.log('   173       await this.pool.end();');
console.log('   174       this.pool = null;');
console.log('   175     }');
console.log('   176   }');
console.log('   177   ');
console.log('   178   async query(sql: string, params?: any[]) {');
console.log('   179     if (!this.pool) {');
console.log('   180       throw new Error("Database not connected");');

console.log('\n✅ MEJORAS IMPLEMENTADAS:');
console.log('1. ✨ Más líneas de código según severidad');
console.log('2. 📁 Información del archivo para fácil localización');
console.log('3. 💡 Instrucciones de copiado para errores críticos');
console.log('4. 🎯 Línea exacta marcada con →');
console.log('5. 📋 Etiquetas diferenciadas por tipo de error');

console.log('\n🔧 VENTAJAS PARA DESARROLLADOR:');
console.log('• Contexto amplio para errores graves');
console.log('• Fácil identificación del problema');
console.log('• Código listo para copiar y pegar');
console.log('• Navegación rápida al archivo y línea');

console.log('\n🔄 PARA DESPLEGAR:');
console.log('cd /opt/krakenbot-staging');
console.log('git pull origin main');
console.log('docker compose -f docker-compose.staging.yml up -d --build');

console.log('\n📱 RESULTADO EN TELEGRAM:');
console.log('• Errores críticos con 25 líneas de contexto');
console.log('• Errores graves con 15 líneas de contexto');
console.log('• Instrucciones claras de copiado');
console.log('• Formato optimizado para análisis rápido');
