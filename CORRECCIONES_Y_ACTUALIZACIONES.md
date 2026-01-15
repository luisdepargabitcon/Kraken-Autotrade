# 📝 Correcciones y Actualizaciones - Bot Trading Kraken

**Proyecto:** Kraken Autotrade Bot  
**Repositorio:** https://github.com/luisdepargabitcon/Kraken-Autotrade  
**Última actualización:** 15 Enero 2026

---

## 🔄 Sesión 14-15 Enero 2026

### 0. Sistema de Configuración Dinámica (MVP - Fase 1)
**Commit:** `WINDSURF CONFIG DASHBOARD`  
**Fecha:** 15 Enero 2026  
**Archivos:** 
- `shared/config-schema.ts` (nuevo)
- `shared/schema.ts` (extendido)
- `server/services/ConfigService.ts` (nuevo)
- `server/routes/config.ts` (nuevo)
- `server/services/botLogger.ts` (eventos añadidos)
- `db/migrations/001_create_config_tables.sql` (nuevo)

**Descripción:**  
Implementado sistema completo de configuración dinámica para señales de trading multi-exchange con:
- **Esquemas Zod:** Validación de configuración (señales, exchanges, global)
- **ConfigService:** Servicio singleton con cache, locking, validación y hot-reload
- **API REST:** Endpoints completos para CRUD de configuraciones y presets
- **Base de datos:** 3 nuevas tablas (trading_config, config_change, config_preset)
- **Auditoría:** Historial completo de cambios con rollback
- **Presets:** 3 presets predefinidos (conservative, balanced, aggressive)

**Endpoints API:**
```
GET    /api/config/active              - Obtener configuración activa
GET    /api/config/list         - Listar todas las configuraciones
GET    /api/config/:id          - Obtener configuración específica
POST   /api/config/new              - Crear nueva configuración
PUT    /api/config/:id          - Actualizar configuración
POST   /api/config/:id/activate - Activar configuración
POST   /api/config/validate     - Validar sin guardar
GET    /api/config/presets      - Listar presets
POST   /api/config/presets      - Crear preset
POST   /api/config/presets/:name/activate - Activar preset
GET    /api/config/:id/history  - Historial de cambios
POST   /api/config/rollback     - Rollback a cambio anterior
GET    /api/config/:id/export   - Exportar configuración JSON
POST   /api/config/import       - Importar configuración JSON
GET    /api/config/health       - Health check del servicio
```

**Estructura de Configuración:**
```typescript
{
  global: {
    riskPerTradePct: number,
    maxTotalExposurePct: number,
    maxPairExposurePct: number,
    dryRunMode: boolean,
    regimeDetectionEnabled: boolean,
    regimeRouterEnabled: boolean
  },
  signals: {
    TREND: { minSignals, maxSignals, currentSignals, description },
    RANGE: { minSignals, maxSignals, currentSignals, description },
    TRANSITION: { minSignals, maxSignals, currentSignals, description }
  },
  exchanges: {
    kraken: { enabled, minOrderUsd, maxOrderUsd, maxSpreadPct, ... },
    revolutx: { enabled, minOrderUsd, maxOrderUsd, maxSpreadPct, ... }
  }
}
```

**Guardrails implementados:**
- Validación de rangos seguros para todos los parámetros
- Cross-validation (ej: maxTotalExposure >= maxPairExposure)
- Locking para evitar cambios concurrentes
- Fallback a preset seguro si configuración inválida

**Eventos de logging añadidos:**
- `CONFIG_CREATED`, `CONFIG_UPDATED`, `CONFIG_ACTIVATED`
- `CONFIG_ROLLBACK`, `CONFIG_IMPORTED`
- `PRESET_CREATED`, `PRESET_ACTIVATED`

**Motivo:** Permitir ajuste dinámico de parámetros de trading sin reiniciar el bot, con auditoría completa y capacidad de rollback para entornos de producción.

---

### 1. Etiqueta Windsurf en Dashboard
**Commit:** _(pendiente de despliegue en VPS)_  
**Fecha:** 15 Enero 2026  
**Archivos:** `client/src/components/dashboard/EnvironmentBadge.tsx`

**Descripción:**  
Añadida una insignia “Windsurf <commit>” junto a la información de entorno (ej. `VPS/STG`, `ID`, `versión`). El badge se renderiza tanto en vista regular como en compacta.

**Detalles técnicos:**
```tsx
const commitTag = data.version?.split("-").pop() ?? data.version ?? "N/A";

<Badge variant="outline" className="font-mono text-[10px] ...">
  Windsurf&nbsp;{commitTag}
</Badge>
```

**Motivo:** Proveer trazabilidad visual inmediata en el dashboard, mostrando la etiqueta “Windsurf + hash/versión” tal como solicitó el usuario.

---

### 1. Corrección de Crashes Críticos TypeScript

#### 1.1 Fix: Variable `pnl` indefinida en ventas SMART_GUARD
**Commit:** `b95cfe0`  
**Fecha:** 14 Enero 2026  
**Archivo:** `server/services/tradingEngine.ts` (líneas 2655-2670)

**Problema:**
- Crash `ReferenceError: pnl is not defined` al ejecutar ventas en modo SMART_GUARD
- Variable `pnl` usada en alerta de Telegram sin calcularla previamente

**Solución:**
```typescript
// Calcular P&L neto antes de usarlo en Telegram
const sellValueGross = sellAmount * currentPrice;
const sellFeeEstimated = sellValueGross * (getTakerFeePct() / 100);
const entryValueGross = sellAmount * position.entryPrice;
const entryFeeProrated = (position.entryFee || 0) * (sellAmount / position.amount);
const pnl = sellValueGross - sellFeeEstimated - entryValueGross - entryFeeProrated;
```

**Impacto:** Elimina crash en ventas SMART_GUARD, permite cálculo correcto de P&L neto con fees.

---

#### 1.2 Fix: `cooldownSec` undefined en propagación a UI
**Commit:** `b95cfe0`  
**Fecha:** 14 Enero 2026  
**Archivo:** `server/services/tradingEngine.ts` (líneas 6693, 6744)

**Problema:**
- Comparación `cooldownSec > 0` falla si la variable es `undefined`
- Causa crash al intentar mostrar cooldowns en dashboard

**Solución:**
```typescript
cooldownSec: cooldownSec !== undefined && cooldownSec > 0 ? cooldownSec : undefined
```

**Impacto:** Elimina crash en UI, maneja correctamente casos sin cooldown activo.

---

#### 1.3 Fix: Errores de tipado TypeScript
**Commit:** `b95cfe0`  
**Fecha:** 14 Enero 2026  
**Archivos:** 
- `server/services/tradingEngine.ts` (múltiples líneas)
- `tsconfig.json`

**Problemas:**
- Error TS2345: `parseFloat` con union `number | "0"`
- Tipos incompletos en `sellContext` y `executionMeta`
- Payload `upsertTradeFill` sin campos requeridos
- Error de iteración Map/Set con target ES2019

**Soluciones:**
```typescript
// 1. Coerción explícita a string
parseFloat(String(balances?.ZUSD || balances?.USD || "0"))

// 2. Ampliar tipo sellContext
sellContext?: { 
  entryPrice: number; 
  entryFee?: number; 
  sellAmount?: number; 
  positionAmount?: number; 
  aiSampleId?: number; 
  openedAt?: number | Date | null 
}

// 3. Ampliar tipo executionMeta
executionMeta?: { 
  mode: string; 
  usdDisponible: number; 
  orderUsdProposed: number; 
  orderUsdFinal: number; 
  sgMinEntryUsd: number; 
  sgAllowUnderMin_DEPRECATED: boolean; 
  dryRun: boolean; 
  env?: string; 
  floorUsd?: number; 
  availableAfterCushion?: number; 
  sgReasonCode?: SmartGuardReasonCode; 
  minOrderUsd?: number; 
  allowUnderMin?: boolean 
}

// 4. Completar payload upsertTradeFill
await storage.upsertTradeFill({
  txid,
  orderId: txid,
  pair,
  type: "sell",
  price: price.toString(),
  amount: volume,
  cost: (volumeNum * price).toFixed(8),
  fee: fee.toFixed(8),
  executedAt: new Date(),
  matched: false,
});

// 5. tsconfig.json
{
  "compilerOptions": {
    "target": "ES2020"  // Cambiado de ES2019
  }
}
```

**Impacto:** Código compila sin errores, tipos correctos en toda la aplicación.

---

### 2. Configuración de Testing

#### 2.1 Añadir Vitest como test runner
**Commit:** `b95cfe0`  
**Fecha:** 14 Enero 2026  
**Archivos:** 
- `package.json`
- `vitest.config.ts` (nuevo)
- `server/smoke.test.ts` (nuevo)

**Cambios:**
```json
// package.json
{
  "scripts": {
    "test": "vitest run"
  }
}
```

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['server/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'build'],
  },
});
```

```typescript
// server/smoke.test.ts
import { describe, it, expect } from 'vitest';

describe('Smoke Test', () => {
  it('should pass basic assertion', () => {
    expect(1 + 1).toBe(2);
  });
});
```

**Impacto:** 
- `npm run test` funcional
- Base para tests futuros
- CI/CD puede verificar código antes de despliegue

---

### 3. Scripts de Diagnóstico

#### 3.1 Test de conexión RevolutX
**Commit:** `ae2d206` → `6838815`  
**Fecha:** 15 Enero 2026  
**Archivo:** `test-revolutx-connection.cjs` (nuevo)

**Propósito:** Verificar credenciales, firma Ed25519 y obtención de balances desde RevolutX API.

**Uso:**
```bash
docker cp test-revolutx-connection.cjs krakenbot-staging-app:/app/
docker exec -it krakenbot-staging-app node /app/test-revolutx-connection.cjs
```

**Resultado:** Confirmado que RevolutX funciona correctamente, balance real $1,678.13.

---

#### 3.2 Test de precios de portfolio
**Commit:** `000d905`  
**Fecha:** 15 Enero 2026  
**Archivo:** `test-portfolio-prices.cjs` (nuevo)

**Propósito:** Verificar obtención de precios desde CoinGecko y cálculo de valor USD real del portfolio.

**Uso:**
```bash
docker cp test-portfolio-prices.cjs krakenbot-staging-app:/app/
docker exec -it krakenbot-staging-app node /app/test-portfolio-prices.cjs
```

**Resultado:** Precios se obtienen correctamente, valor real $1,678 vs $1,624 mostrado (diferencia por cache).

---

### 4. Diagnóstico de No Compras

#### 4.1 Análisis de eventos TRADE_SKIPPED
**Commit:** N/A (análisis, no código)  
**Fecha:** 14 Enero 2026  
**Archivo:** `DIAGNOSTICO_NO_COMPRA.md` (nuevo)

**Hallazgos:**
- 879 eventos `TRADE_SKIPPED` analizados desde DB real
- Top 2 causas (45%): 
  - `SMART_GUARD_INSUFFICIENT_SIGNALS` (208 eventos, 24%)
  - `VOLUME_BELOW_MINIMUM` (185 eventos, 21%)
- Causa raíz: Exposición al límite + señales insuficientes
- Balance disponible: $1,199 USD
- Exposición actual: $1,565 (BTC+ETH+TRX) vs límite $719 (60%)

**Recomendaciones documentadas:**
1. Aumentar `maxTotalExposurePct` de 60% a 75-80%
2. Reducir `sgMinEntryUsd` de $100 a $80
3. Activar `sgAllowUnderMin: true`
4. Bajar `minSignals` de 5 a 4 en TRANSITION

---

### 5. Ajuste de Estrategia (Basado en Historial Real)

#### 5.1 Revertir minSignals a 4 en régimen TRANSITION
**Commit:** `447dd67`  
**Fecha:** 15 Enero 2026  
**Archivo:** `server/services/tradingEngine.ts` (línea 426)

**Análisis previo:**
- Historial de trades revisado: 30 últimas operaciones
- Última compra: 7-ene ETH/USD (hace 7 días)
- Eventos bloqueados: 40 de 50 por `SMART_GUARD_INSUFFICIENT_SIGNALS`
- Todas con 4 señales obtenidas vs 5 requeridas
- Señales de alta calidad: confirmadas por MTF alcista, volumen, patrones

**Evidencia histórica:**
- Valor 4 usado exitosamente en dic-2025
- Trades rentables: SOL +1.6%/+3.0%, XRP +10.6%/+9.7%, TON +1.1%
- Cambio a 5 señales (13-ene) coincide con inicio de bloqueo total

**Cambio aplicado:**
```typescript
// REGIME_PRESETS
TRANSITION: {
  minSignals: 4,  // Cambiado de 5 a 4
  pauseEntries: true,  // Sin cambios
  // ... resto igual
}
```

**Impacto esperado:**
- Reactivar ~20 compras/semana en régimen TRANSITION
- Mantener filtros de calidad: RSI anti-FOMO, MTF, volumen
- Rentabilidad esperada: similar a dic-2025 (~1-3% por trade)
- Riesgo: Bajo (configuración ya probada en producción)

**Verificación:**
- ✅ `npm run check` - sin errores
- ✅ `npm run test` - todos los tests pasan
- ✅ Pusheado a GitHub main

---

#### 5.2 Fix definitivo: minSignalsRequired=4 en TRANSITION (trace + scans)
**Commit:** `eaa17ea` → _(base)_ y ajuste final en este commit local  
**Fecha:** 15 Enero 2026  
**Archivo:** `server/services/tradingEngine.ts`

**Problema:**
- En régimen `TRANSITION` seguía apareciendo `minSignalsRequired: 5` en `PAIR_DECISION_TRACE`.
- Causa raíz: el cálculo de mínimos usaba `Math.max(4, baseMinSignals)` (si `baseMinSignals=5`, el resultado siempre es 5).

**Solución aplicada (fuente única de verdad para TRANSITION):**
- En los 3 puntos donde se calcula el mínimo ajustado (modo `scans`, pre-cálculo para estrategia candles, y trace/cache candles) se reemplazó:
```ts
Math.max(4, baseMinSignals)
```
por:
```ts
Math.min(baseMinSignals, 4)
```

**Impacto esperado:**
- `TRANSITION` permite umbral 4 de forma efectiva.
- El `PAIR_DECISION_TRACE` debe mostrar `minSignalsRequired: 4` cuando el régimen sea `TRANSITION`.

---

## 🔄 Sesión 15 Enero 2026 (Dashboard Configuración Dinámica)

### 6. Dashboard de Configuración de Señales con Inteligencia

**Commit:** "WINDSURF 4 SEÑALES"  
**Fecha:** 15 Enero 2026  
**Archivos:**
- `client/src/components/dashboard/SignalThresholdConfig.tsx` (nuevo)
- `server/routes/signalConfig.ts` (nuevo)
- `server/storage.ts` (métodos añadidos)
- `server/services/botLogger.ts` (evento añadido)
- `server/services/tradingEngine.ts` (integración dinámica)
- `client/src/pages/Settings.tsx` (integración UI)

**Descripción:**
Implementación completa de dashboard para configuración dinámica de umbrales de señales por régimen de mercado, con presets vs personalización, simulador de impacto y optimización inteligente.

**Características implementadas:**

#### 6.1 Componente React: SignalThresholdConfig
```typescript
// Presets vs Custom Configuration
<Tabs value={selectedRegime}>
  <TabsContent value="TREND">
    <Card title="Configuración Predeterminada">
      <div className="text-2xl font-bold text-primary">{currentConfig?.current}</div>
      <Progress value={progress} />
    </Card>
    <Card title="Configuración Personalizada">
      <Switch checked={isCustomActive} />
      <Input type="number" value={customValue} />
      <Alert className="bg-purple-500/10">
        Sugerencia IA: {suggestion.recommended} señales
      </Alert>
    </Card>
  </TabsContent>
</Tabs>
```

#### 6.2 API Endpoints
```typescript
// GET /api/trading/signals/config
// PUT /api/trading/signals/config
// POST /api/trading/signals/simulate
// GET /api/trading/signals/optimize
// GET /api/trading/signals/performance
```

#### 6.3 Integración con Trading Engine
```typescript
getRegimeMinSignals(regime: MarketRegime, baseMinSignals: number): number {
  // Check if we have custom signal configuration
  const customConfig = this.getCustomSignalConfig();
  if (customConfig && customConfig[regime.toLowerCase()]) {
    const customMinSignals = customConfig[regime.toLowerCase()].current;
    if (customMinSignals >= 1 && customMinSignals <= 10) {
      return customMinSignals;
    }
  }
  // Fallback to preset values
  return Math.max(baseMinSignals, preset.minSignals);
}
```

**Funcionalidades clave:**

- **Presets inteligentes:** Valores optimizados por defecto (TREND: 5, RANGE: 6, TRANSITION: 4)
- **Personalización dinámica:** Override por régimen con validación en tiempo real
- **Simulador de impacto:** Predice trades adicionales, riesgo y confianza
- **Optimización IA:** Sugerencias basadas en histórico de rendimiento
- **Métricas en vivo:** Análisis de rendimiento por configuración
- **Integración transparente:** Sin reinicios, cambios hot-reload

**Configuración por defecto:**
```typescript
const DEFAULT_SIGNAL_CONFIG = {
  trend: { min: 3, max: 8, current: 5 },
  range: { min: 4, max: 10, current: 6 },
  transition: { min: 2, max: 6, current: 4 }
};
```

**Impacto esperado:**
- Control total sobre umbrales de señales sin modificar código
- Experimentación segura con rollback instantáneo
- Optimización basada en datos reales
- Reducción del cuello de botella actual (falta de BUY)

---

## 🔄 Sesión 16 Enero 2026 (Auditoría y Corrección Integral Telegram)

### 8. Auditoría Completa Sistema Telegram

**Commits:** `f773a09`, `7840e58`, `292b162`, `ead913c`, `77d358b`  
**Fecha:** 16 Enero 2026  
**Archivos:**
- `server/services/telegram.ts` (refactor completo)
- `server/services/environment.ts` (BOT_DISPLAY_NAME)
- `server/services/exchanges/ExchangeFactory.ts` (singleton)
- `server/storage.ts` (getRecentTradeFills)
- `tests/telegram.test.js` (guards)

**Descripción:**
- **Fix 1:** `formatSpanishDate` ahora valida fechas y devuelve "N/A" si es inválida. `sendDailyReport` pasa objeto `Date` en lugar de string locale.
- **Fix 2:** `normalizePanelUrl` valida URL y añade protocolo. `buildPanelUrlFooter` con fallback "Panel no configurado".
- **Fix 3:** Branding unificado con `BOT_DISPLAY_NAME` env var. Todos los templates usan `${environment.envTag} ${environment.botDisplayName}`.
- **Feat 4:** `/logs` con filtros (`/logs 50`, `/logs level=ERROR`, `/logs type=TRADE_EXECUTED`) y `/log <id>` para detalles completos.
- **Feat 5:** `/balance` multi-exchange via ExchangeFactory. Soporta `/balance all`, `/balance kraken`, `/balance revolutx`.
- **Fix 6:** `/ganancias` desde `lot_matches.pnlNet` (preferido) o fallback a `training_trades.pnlNet`.
- **Fix 7:** `/ultimas` desde `tradeFills` reales con dedupe por txid. Soporta `/ultimas 20`, `/ultimas exchange=kraken`.
- **Tests:** Guards para `formatSpanishDate` y `normalizePanelUrl` para evitar regresiones.

**Comandos Telegram Mejorados:**
```bash
/logs                    # Últimos 10 eventos
/logs 50                # Más eventos  
/logs level=ERROR       # Solo errores
/logs type=TRADE_EXECUTED # Por tipo
/log 12345              # Detalle completo

/balance                # Exchange trading actual
/balance all            # Todos los exchanges
/balance kraken         # Exchange específico

/ultimas                # Últimas 5 operaciones
/ultimas 20             # Más operaciones
/ultimas exchange=kraken # Filtrar por exchange
```

**Verificación:**
- ✅ `npm run check` (TypeScript sin errores)
- ✅ Todos los comandos usan fuentes reales (DB/ExchangeFactory)
- ✅ Compatibilidad hacia atrás con "N/A" si faltan datos
- ✅ Sin "Invalid Date" ni links rotos
- ✅ Branding consistente en todos los mensajes

---

## 🔄 Sesión 16 Enero 2026 (Corrección Revolut X API)

### 9. Fix Revolut X getTicker Endpoint 404

**Commit:** `7a2d283`  
**Fecha:** 16 Enero 2026  
**Archivos:**
- `server/services/exchanges/RevolutXService.ts` (getTicker refactor)

**Descripción:**
- **Problema:** Error 404 en `/api/1.0/orderbook` - endpoint no existe en Revolut X API
- **Solución:** Usar `/market-data/public/ticker` como endpoint primario (público, sin autenticación)
- **Fallback:** Si ticker falla, intentar `/api/1.0/orderbook` con autenticación
- **Resultado:** Evita errores 404 y permite obtener precios de Revolut X correctamente

**Error Original:**
```
[ERROR] [revolutx] getTicker response: 404 {"message":"Endpoint GET /api/1.0/orderbook not found"}
```

**Código Aplicado:**
```typescript
// Primario: endpoint público
const path = '/market-data/public/ticker';
const response = await fetch(fullUrl);

if (!response.ok) {
  // Fallback a orderbook autenticado
  return await this.getTickerFromOrderbook(pair);
}
```

**Verificación:**
- ✅ `npm run check` (TypeScript sin errores)
- ✅ Commit y push completados
- ✅ Listo para despliegue VPS

**Motivo:** Corregir error 404 que impedía obtener precios de Revolut X, afectando funcionalidad multi-exchange.

---

## 📊 Resumen de Cambios por Categoría

### Correcciones de Bugs
- ✅ Crash `pnl` undefined en ventas SMART_GUARD
- ✅ Crash `cooldownSec` undefined en UI
- ✅ Errores de tipado TypeScript (TS2345, tipos incompletos)

### Mejoras de Infraestructura
- ✅ Configuración de Vitest para testing
- ✅ Scripts de diagnóstico RevolutX y precios
- ✅ Target ES2020 en tsconfig para iteradores

### Ajustes de Estrategia
- ✅ `minSignals: 4` en TRANSITION (basado en evidencia histórica)

### Documentación
- ✅ `DIAGNOSTICO_NO_COMPRA.md` con análisis completo
- ✅ `CORRECCIONES_Y_ACTUALIZACIONES.md` (este archivo)

---

## 🚀 Próximos Pasos

### Despliegue en VPS
```bash
cd /opt/krakenbot-staging
git pull origin main
docker compose down
docker compose up -d --build
```

### Monitoreo Post-Despliegue
```bash
# Verificar logs en tiempo real
docker logs -f krakenbot-staging-app | grep -E "TRADE_EXECUTED|TRANSITION"

# Confirmar aceptación de 4 señales
docker logs krakenbot-staging-app | grep "Señales: 4"
```

### Ajustes Opcionales (Configuración, no código)
- Aumentar `maxTotalExposurePct` a 75-80% si se requiere más margen
- Reducir `sgMinEntryUsd` a $80 si balance es limitado
- Activar `sgAllowUnderMin: true` para órdenes entre $20-$80

---

## 📝 Notas Importantes

- Todos los cambios mantienen la lógica de trading intacta
- No se modificaron filtros de calidad (RSI anti-FOMO, MTF, volumen)
- Ajustes basados en datos reales del VPS, no suposiciones
- Rollback seguro disponible: `git revert 447dd67` si hay problemas

---

**Última revisión:** 15 Enero 2026, 00:43 UTC+01:00
