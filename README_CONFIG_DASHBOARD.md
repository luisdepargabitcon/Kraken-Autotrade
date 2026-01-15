# 🎛️ Sistema de Configuración Dinámica - Trading Bot

## 📋 Descripción General

Sistema completo de configuración dinámica para el bot de trading que permite ajustar parámetros en tiempo real sin reiniciar el bot. Incluye validación, auditoría, presets predefinidos y capacidad de rollback.

## 🚀 Características Implementadas

### Backend
- ✅ **ConfigService**: Servicio singleton con cache, locking y validación
- ✅ **API REST**: 15 endpoints completos para gestión de configuración
- ✅ **Base de Datos**: 3 nuevas tablas con migración SQL
- ✅ **Auditoría**: Historial completo de cambios con rollback
- ✅ **Hot-Reload**: Integración con tradingEngine para aplicar cambios sin reiniciar
- ✅ **Guardrails**: Validación de rangos seguros y cross-validation

### Frontend
- ✅ **Dashboard UI**: Componente React con tabs (Presets/Custom)
- ✅ **Validación en Tiempo Real**: Feedback inmediato de errores/warnings
- ✅ **Presets**: 3 configuraciones predefinidas (Conservative/Balanced/Aggressive)
- ✅ **Editor Custom**: Sliders y controles para ajuste fino

### Testing
- ✅ **Tests de Validación**: Suite completa de tests unitarios
- ✅ **Tests de Import/Export**: Verificación de JSON

## 📁 Archivos Creados/Modificados

### Nuevos Archivos
```
shared/config-schema.ts                    - Esquemas Zod y tipos TypeScript
server/services/ConfigService.ts           - Servicio de configuración
server/routes/config.ts                    - Endpoints API REST
db/migrations/001_create_config_tables.sql - Migración de base de datos
scripts/apply-config-migration.ts          - Script de aplicación de migración
server/tests/config.test.ts                - Tests unitarios
client/src/components/dashboard/TradingConfigDashboard.tsx - UI Dashboard
README_CONFIG_DASHBOARD.md                 - Esta documentación
```

### Archivos Modificados
```
shared/schema.ts                           - Tablas Drizzle ORM añadidas
server/services/botLogger.ts               - 9 nuevos eventos de logging
server/services/tradingEngine.ts           - Integración con ConfigService
server/routes.ts                           - Registro de rutas de configuración
client/src/pages/Settings.tsx              - Integración del dashboard
CORRECCIONES_Y_ACTUALIZACIONES.md         - Documentación de cambios
```

## 🗄️ Estructura de Base de Datos

### Tabla: `trading_config`
Almacena instancias de configuración con versionado.

```sql
CREATE TABLE trading_config (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  config JSONB NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

### Tabla: `config_change`
Auditoría completa de todos los cambios de configuración.

```sql
CREATE TABLE config_change (
  id SERIAL PRIMARY KEY,
  config_id TEXT NOT NULL,
  user_id TEXT,
  change_type TEXT NOT NULL, -- CREATE, UPDATE, DELETE, ACTIVATE_PRESET, ROLLBACK
  description TEXT NOT NULL,
  previous_config JSONB,
  new_config JSONB NOT NULL,
  changed_fields TEXT[] NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  applied_at TIMESTAMP,
  is_active BOOLEAN NOT NULL DEFAULT FALSE
);
```

### Tabla: `config_preset`
Plantillas de configuración predefinidas.

```sql
CREATE TABLE config_preset (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  config JSONB NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

## 🔌 API Endpoints

### Gestión de Configuración
```
GET    /api/config              - Obtener configuración activa
GET    /api/config/list         - Listar todas las configuraciones
GET    /api/config/:id          - Obtener configuración específica
POST   /api/config              - Crear nueva configuración
PUT    /api/config/:id          - Actualizar configuración
POST   /api/config/:id/activate - Activar configuración
POST   /api/config/validate     - Validar sin guardar
```

### Gestión de Presets
```
GET    /api/config/presets           - Listar presets
GET    /api/config/presets/:name     - Obtener preset específico
POST   /api/config/presets           - Crear preset
POST   /api/config/presets/:name/activate - Activar preset
```

### Historial y Utilidades
```
GET    /api/config/:id/history  - Historial de cambios
GET    /api/config/history      - Historial global
POST   /api/config/rollback     - Rollback a cambio anterior
GET    /api/config/:id/export   - Exportar configuración JSON
POST   /api/config/import       - Importar configuración JSON
GET    /api/config/health       - Health check del servicio
```

## 📊 Estructura de Configuración

```typescript
interface TradingConfig {
  global: {
    riskPerTradePct: number;        // 0.1 - 10.0
    maxTotalExposurePct: number;    // 10 - 100
    maxPairExposurePct: number;     // 5 - 50
    dryRunMode: boolean;
    regimeDetectionEnabled: boolean;
    regimeRouterEnabled: boolean;
  };
  signals: {
    TREND: SignalConfig;
    RANGE: SignalConfig;
    TRANSITION: SignalConfig;
  };
  exchanges: {
    kraken: ExchangeConfig;
    revolutx: ExchangeConfig;
  };
}

interface SignalConfig {
  regime: string;
  minSignals: number;      // 1 - 10
  maxSignals: number;      // 1 - 10
  currentSignals: number;  // 1 - 10
  description?: string;
}

interface ExchangeConfig {
  exchangeType: 'kraken' | 'revolutx';
  enabled: boolean;
  minOrderUsd: number;     // 1 - 10000
  maxOrderUsd: number;     // 1 - 50000
  maxSpreadPct: number;    // 0.1 - 5.0
  tradingHoursEnabled: boolean;
  tradingHoursStart: number;  // 0 - 23
  tradingHoursEnd: number;    // 0 - 23
}
```

## 🎯 Presets Predefinidos

### Conservative
- **Señales**: TREND=6, RANGE=7, TRANSITION=5
- **Riesgo**: 1% por trade
- **Exposición**: 30% total, 10% por par
- **Descripción**: Trading conservador con requisitos estrictos de señales

### Balanced
- **Señales**: TREND=5, RANGE=6, TRANSITION=4
- **Riesgo**: 2% por trade
- **Exposición**: 50% total, 20% por par
- **Descripción**: Balance entre oportunidades y seguridad

### Aggressive
- **Señales**: TREND=4, RANGE=5, TRANSITION=3
- **Riesgo**: 3% por trade
- **Exposición**: 70% total, 30% por par
- **Descripción**: Trading agresivo con menores requisitos de señales

## 🛡️ Guardrails Implementados

### Validación de Rangos
- Señales: 1-10 por régimen
- Riesgo por trade: 0.1%-10%
- Exposición total: 10%-100%
- Exposición por par: 5%-50%
- Spread máximo: 0.1%-5%
- Órdenes: $1-$50,000

### Cross-Validation
- `maxTotalExposurePct >= maxPairExposurePct`
- `minSignals <= currentSignals <= maxSignals`
- `riskPerTradePct <= maxPairExposurePct * 0.5` (warning)

### Locking
- Previene cambios concurrentes
- Timeout de 30 segundos
- Fallback automático a preset seguro

## 🔧 Instalación y Configuración

### 1. Aplicar Migración de Base de Datos

```bash
# Opción A: Usando el script TypeScript
npm run tsx scripts/apply-config-migration.ts

# Opción B: Directamente con psql
psql -U your_user -d your_database -f db/migrations/001_create_config_tables.sql
```

### 2. Reiniciar el Bot

```bash
npm run dev
```

El bot cargará automáticamente la configuración activa al iniciar.

### 3. Acceder al Dashboard

1. Navegar a `Settings` en el panel web
2. Buscar la sección "Trading Configuration"
3. Seleccionar un preset o crear configuración custom
4. Los cambios se aplican inmediatamente sin reiniciar

## 📝 Uso del Dashboard

### Modo Preset
1. Seleccionar uno de los 3 presets predefinidos
2. Hacer clic en "Activate Selected Preset"
3. La configuración se aplica inmediatamente

### Modo Custom
1. Cambiar a la pestaña "Custom Configuration"
2. Ajustar parámetros usando sliders e inputs
3. Ver validación en tiempo real (errores/warnings)
4. Hacer clic en "Save Configuration"
5. Los cambios se aplican sin reiniciar el bot

### Validación en Tiempo Real
- ❌ **Errores**: Bloquean el guardado
- ⚠️ **Warnings**: Permiten guardar pero alertan de valores edge-case

## 🔄 Hot-Reload

El sistema implementa hot-reload completo:

1. **ConfigService** emite eventos cuando cambia la configuración
2. **TradingEngine** escucha estos eventos
3. Los cambios se aplican inmediatamente:
   - Umbrales de señales por régimen
   - Modo dry run
   - Parámetros de riesgo
   - Configuración de exchanges

```typescript
// En tradingEngine.ts
configService.on('config:activated', async ({ configId }) => {
  await this.loadDynamicConfig();
});

configService.on('config:updated', async ({ configId }) => {
  await this.loadDynamicConfig();
});
```

## 🧪 Testing

### Ejecutar Tests

```bash
# Todos los tests
npm test

# Solo tests de configuración
npm test config.test.ts
```

### Tests Incluidos
- ✅ Validación de configuración válida
- ✅ Rechazo de señales inválidas (min > max)
- ✅ Rechazo de exposición inválida (total < par)
- ✅ Rechazo de currentSignals fuera de rango
- ✅ Generación de warnings para valores edge-case
- ✅ Export/Import de configuración JSON

## 📊 Eventos de Logging

Nuevos eventos añadidos a `botLogger`:

```typescript
"CONFIG_CREATED"      // Nueva configuración creada
"CONFIG_UPDATED"      // Configuración actualizada
"CONFIG_ACTIVATED"    // Configuración activada
"CONFIG_ROLLBACK"     // Rollback ejecutado
"CONFIG_IMPORTED"     // Configuración importada
"CONFIG_LOADED"       // Configuración cargada en tradingEngine
"PRESET_CREATED"      // Preset creado
"PRESET_ACTIVATED"    // Preset activado
```

## 🚨 Troubleshooting

### La configuración no se aplica
1. Verificar que la migración se aplicó correctamente
2. Revisar logs del bot para errores de carga
3. Verificar que existe una configuración activa: `GET /api/config`

### Errores de validación
1. Revisar los mensajes de error en el dashboard
2. Verificar que los valores están dentro de los rangos permitidos
3. Comprobar cross-validation rules

### Hot-reload no funciona
1. Verificar que el bot está corriendo
2. Revisar logs para eventos `CONFIG_LOADED`
3. Comprobar que ConfigService está emitiendo eventos

## 🔐 Seguridad

### Guardrails de Producción
- Validación estricta de rangos
- Locking para prevenir race conditions
- Auditoría completa de cambios
- Rollback disponible en caso de problemas

### Recomendaciones
1. Siempre probar cambios en STG antes de PROD
2. Usar presets como punto de partida
3. Revisar warnings antes de aplicar configuración
4. Mantener historial de cambios para auditoría

## 📈 Validación en STG (VPS/STG)

### Pasos para Validar

1. **Aplicar migración en STG**
   ```bash
   ssh user@stg-server
   cd /path/to/bot
   npm run tsx scripts/apply-config-migration.ts
   ```

2. **Reiniciar bot en STG**
   ```bash
   pm2 restart bot-stg
   ```

3. **Verificar carga de configuración**
   ```bash
   pm2 logs bot-stg | grep CONFIG
   ```

4. **Probar en dashboard**
   - Acceder a dashboard STG
   - Activar preset "balanced"
   - Verificar que se aplica sin errores

5. **Monitorear comportamiento**
   - Observar logs de trading
   - Verificar que usa los nuevos umbrales
   - Confirmar que hot-reload funciona

### Revertir a Preset Seguro

Si algo falla en producción:

```bash
# Opción 1: Desde dashboard
# Ir a Settings > Trading Configuration > Presets
# Seleccionar "conservative" y activar

# Opción 2: Desde API
curl -X POST http://localhost:5000/api/config/presets/conservative/activate \
  -H "Content-Type: application/json" \
  -d '{"userId": "admin"}'

# Opción 3: Rollback a cambio anterior
curl -X POST http://localhost:5000/api/config/rollback \
  -H "Content-Type: application/json" \
  -d '{"changeId": "123", "userId": "admin"}'
```

## 🎓 Próximos Pasos (Fase 2)

Funcionalidades adicionales para futuras iteraciones:

- [ ] Simulador en tiempo real de configuración
- [ ] Optimizador automático basado en histórico
- [ ] Modo adaptativo con ML
- [ ] Notificaciones de cambios de configuración
- [ ] Dashboard de métricas por configuración
- [ ] A/B testing de configuraciones
- [ ] Scheduler para cambios programados

## 📞 Soporte

Para problemas o preguntas:
1. Revisar logs: `pm2 logs bot`
2. Verificar health: `GET /api/config/health`
3. Consultar historial: `GET /api/config/history`

---

**Versión**: 1.0.0  
**Fecha**: 15 Enero 2026  
**Commit**: `WINDSURF CONFIG DASHBOARD`
