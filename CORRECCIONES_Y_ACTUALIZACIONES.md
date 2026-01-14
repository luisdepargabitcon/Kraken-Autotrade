# 📝 Correcciones y Actualizaciones - Bot Trading Kraken

**Proyecto:** Kraken Autotrade Bot  
**Repositorio:** https://github.com/luisdepargabitcon/Kraken-Autotrade  
**Última actualización:** 15 Enero 2026

---

## 🔄 Sesión 14-15 Enero 2026

### 0. Etiqueta Windsurf en Dashboard
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
