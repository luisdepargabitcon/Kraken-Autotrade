# IDCA Recovery Cycle — Diseño Completo
## Multi-Ciclo por Drawdown Profundo

**Fecha:** 25-Mar-2026  
**Estado:** Propuesta de diseño — pendiente aprobación  
**Autor:** Cascade (Windsurf)

---

## A) PROPUESTA FUNCIONAL

### Concepto
Cuando un ciclo principal (`main`) entra en **drawdown profundo** (configurable, ej: ≥25%), el bot puede abrir un **ciclo recovery** adicional en el mismo par. Este ciclo recovery opera con capital reducido y condiciones más estrictas, aprovechando que el precio está significativamente por debajo del precio medio del ciclo principal.

### Diferencia con Plus Cycle
| Aspecto | Plus Cycle | Recovery Cycle |
|---------|-----------|---------------|
| **Trigger** | Main agotó safety buys + dip extra | Main en drawdown profundo (≥25%) |
| **Capital** | 15% del capital del módulo | 8-12% del capital del módulo (configurable) |
| **Propósito** | Aprovechar caída extra cuando main está lleno | Recuperar capital atrapado en posición profunda |
| **Riesgo** | Moderado | Alto — requiere más restricciones |
| **TP objetivo** | Dinámico (similar a main) | Más conservador (2-3%) para cierre rápido |
| **Máximo ciclos** | 2 por main | 1-2 por main (configurable, recomendado: 1) |

### Flujo de Activación

```
1. Tick normal → manageCycle(mainCycle)
2. Detectar drawdown >= recoveryActivationDrawdownPct (ej: 25%)
3. Verificar TODOS los gate checks:
   a) ¿Recovery habilitado en config?
   b) ¿Ya existe recovery activo para este par?
   c) ¿Límite de ciclos recovery por main no superado?
   d) ¿Exposición total del par < límite?
   e) ¿Cooldown desde último recovery respetado?
   f) ¿Condiciones de mercado mínimas OK? (score >= umbral)
   g) ¿Main cycle aún activo (no cerrado/pausado)?
   h) ¿Capital disponible suficiente?
4. Si TODOS pasan → Emitir recovery_cycle_eligible
5. Esperar confirmación de rebote (rebound detection)
6. Si rebote confirmado → Abrir recovery cycle
7. Emitir recovery_cycle_started
8. Si algún gate falla → Emitir recovery_cycle_blocked + motivo
```

### Parámetros Configurables (RecoveryConfig)

```typescript
interface RecoveryConfig {
  // ── Activación ─────────────────────────────
  enabled: boolean;                        // default: false
  activationDrawdownPct: number;           // default: 25.0 (% drawdown del main)
  
  // ── Límites ────────────────────────────────
  maxRecoveryCyclesPerMain: number;        // default: 1 (recomendado)
  maxTotalCyclesPerPair: number;           // default: 3 (main + plus + recovery)
  maxPairExposurePct: number;              // default: 40 (% del capital total del módulo)
  
  // ── Capital ────────────────────────────────
  capitalAllocationPct: number;            // default: 10 (% del capital del módulo)
  maxRecoveryCapitalUsd: number;           // default: 500 (tope absoluto en USD)
  
  // ── Timing ─────────────────────────────────
  cooldownMinutesAfterMainBuy: number;     // default: 120 (esperar 2h tras última compra main)
  cooldownMinutesBetweenRecovery: number;  // default: 360 (6h entre recovery cycles)
  
  // ── Condiciones de mercado ──────────────────
  minMarketScoreForRecovery: number;       // default: 40 (de 100)
  requireReboundConfirmation: boolean;     // default: true
  
  // ── Take Profit ────────────────────────────
  recoveryTpPctBtc: number;               // default: 2.5 (conservador)
  recoveryTpPctEth: number;               // default: 3.0
  
  // ── Safety orders del recovery ─────────────
  maxRecoveryEntries: number;              // default: 2 (base + 1 safety)
  recoveryEntryDipSteps: number[];         // default: [2.0, 4.0]
  
  // ── Trailing ───────────────────────────────
  recoveryTrailingPctBtc: number;          // default: 0.8 (tight)
  recoveryTrailingPctEth: number;          // default: 1.0
  
  // ── Auto-cierre ────────────────────────────
  autoCloseIfMainClosed: boolean;          // default: true
  autoCloseIfMainRecovers: boolean;        // default: false (cerrar recovery si main vuelve a +)
  maxRecoveryDurationHours: number;        // default: 168 (7 días max)
}
```

---

## B) RIESGOS

### 🔴 Riesgos Altos
1. **Acumulación de exposición**: Si el mercado sigue cayendo, tener main + recovery duplica la pérdida potencial
2. **Falso rebote**: El recovery se abre en un rebote que resulta ser temporal → más capital atrapado
3. **Correlación**: En crash de mercado, todos los pares caen → múltiples recovery cycles simultáneos

### 🟡 Riesgos Medios
4. **Complejidad de gestión**: Más ciclos = más eventos, más trailing, más posibilidad de bugs
5. **Liquidez**: En crash real, los spreads se amplían y la ejecución se degrada
6. **PnL confuso**: El usuario puede no entender bien el PnL combinado

### 🟢 Mitigaciones Incorporadas
| Riesgo | Mitigación |
|--------|-----------|
| Acumulación | `maxPairExposurePct` limita exposición total por par |
| Falso rebote | `requireReboundConfirmation` + `minMarketScoreForRecovery` |
| Correlación | `maxTotalCyclesPerPair` + exposición global del módulo |
| Complejidad | Recovery es simplificado (menos safety buys, TP conservador) |
| Liquidez | Se ejecuta en simulación primero para validar |
| PnL confuso | UI distingue visualmente main vs recovery |

### Escenario Peor Caso (Worst Case)
- Main: $1000 invertido, -30% drawdown = -$300 unrealized
- Recovery: $100 invertido, el precio sigue cayendo -15% = -$15 unrealized
- **Pérdida total unrealized: $315** (vs $300 sin recovery)
- **Ganancia si recovery funciona**: Recovery cierra +2.5% = +$2.50, y el main sigue gestionándose normalmente
- **Conclusión**: El riesgo incremental es bajo (capital reducido), pero el beneficio psicológico y económico es real

---

## C) ARQUITECTURA NECESARIA

### Cambios en Tipos

```
// IdcaTypes.ts
export type IdcaCycleType = "main" | "plus" | "recovery";  // +recovery

export interface RecoveryConfig { ... }  // nuevo (ver arriba)
```

### Cambios en Schema (DB)

```sql
-- En institutional_dca_config:
ALTER TABLE institutional_dca_config 
  ADD COLUMN recovery_config_json jsonb NOT NULL DEFAULT '{"enabled": false}';

-- En institutional_dca_cycles (ya existente, solo nuevo valor para cycle_type):
-- cycle_type: "main" | "plus" | "recovery"
-- parent_cycle_id: ya existe, se usa para vincular recovery → main
```

### Nuevos Métodos en IdcaRepository

```typescript
// Consultas recovery
getActiveRecoveryCycles(pair: string, mode: string, mainCycleId: number): Promise<Cycle[]>
getClosedRecoveryCyclesCount(mainCycleId: number): Promise<number>
getTotalPairExposure(pair: string, mode: string): Promise<number> // suma capitalUsed de todos los ciclos activos del par
```

### Nuevo Bloque en IdcaEngine

```
// En processPair(), después de manageCycle() y plus cycle logic:
if (recoveryConfig.enabled) {
  const existingRecovery = await repo.getActiveRecoveryCycles(pair, mode, mainCycle.id);
  if (existingRecovery.length > 0) {
    for (const rc of existingRecovery) {
      await manageRecoveryCycle(rc, mainCycle, currentPrice, config, assetConfig, mode, recoveryConfig);
    }
  } else {
    await checkRecoveryActivation(mainCycle, currentPrice, config, assetConfig, mode, recoveryConfig);
  }
}
```

### Funciones Nuevas en IdcaEngine

```
checkRecoveryActivation()    — evalúa si se cumplen las condiciones
executeRecoveryEntry()       — abre el ciclo recovery
manageRecoveryCycle()        — gestión del ciclo (similar a managePlusCycle pero con reglas propias)
closeRecoveryCycle()         — cierre del ciclo recovery
checkRecoverySafetyBuy()     — safety buys del recovery
getRecoveryConfig()          — parser de config JSON
```

---

## D) CAMBIOS EN BACKEND

### Archivos a Modificar

| Archivo | Cambios |
|---------|---------|
| `IdcaTypes.ts` | +`RecoveryConfig` interface, actualizar `IdcaCycleType` |
| `IdcaEngine.ts` | +`checkRecoveryActivation`, `manageRecoveryCycle`, `closeRecoveryCycle`, `checkRecoverySafetyBuy` |
| `IdcaRepository.ts` | +queries de recovery cycles y exposición por par |
| `IdcaMessageFormatter.ts` | +formateo para 5 nuevos event types recovery |
| `IdcaReasonCatalog.ts` | +5 entradas de catálogo (eligible, started, blocked, closed, risk_warning) |
| `IdcaTelegramNotifier.ts` | +5 funciones de alerta Telegram para recovery |
| `IdcaSmartLayer.ts` | Sin cambios (reutiliza lógica existente) |
| `shared/schema.ts` | +`recovery_config_json` en config table |
| `server/storage.ts` | +migración para nuevo campo |

### Estimación de Complejidad
- **~400-500 líneas** de código nuevo en backend
- **~100 líneas** de schema/migración
- **~150 líneas** de tests recomendados
- **Tiempo estimado**: 4-6 horas de implementación

---

## E) CAMBIOS EN UI

### 5 Nuevos Event Types para IdcaEventCards.tsx

```
recovery_cycle_eligible     🟡 warning   "Ciclo recovery habilitado"
recovery_cycle_started      ⚡ positive  "Ciclo recovery abierto"
recovery_cycle_blocked      🛡️ warning   "Ciclo recovery bloqueado"
recovery_cycle_closed       📊 info      "Ciclo recovery cerrado"
recovery_cycle_risk_warning ⚠️ warning   "Alerta de riesgo: exposición elevada"
```

### Mensajes Humanos por Evento

#### `recovery_cycle_eligible` 🟡
**Título:** Ciclo de recuperación habilitado  
**Resumen:** El ciclo principal de {pair} alcanzó un drawdown de {drawdownPct}%, superando el umbral de activación ({activationDrawdownPct}%). El bot queda habilitado para abrir un ciclo de recuperación adicional cuando se confirme un rebote.  
**Acción:** Vigilando rebote para abrir ciclo recovery.  
**Datos:**
- Par, Modo
- Drawdown del main: -28.5%
- Umbral activación: -25%
- Capital asignado: $100
- Exposición actual del par: $850 (34%)
- Score de mercado: 45/100

#### `recovery_cycle_started` ⚡
**Título:** Ciclo de recuperación abierto  
**Resumen:** Se abrió un ciclo de recuperación para {pair}. El ciclo principal tiene un drawdown de {drawdownPct}% y el bot detectó un rebote favorable. Se invirtió {capitalUsd} a {price} con un TP conservador de {tpPct}%.  
**Acción:** Compra recovery: {qty} @ {price}. TP objetivo: +{tpPct}%.  
**Datos:**
- Par, Modo, Cycle ID
- Drawdown del main: -28.5%
- Capital recovery: $100
- Precio entrada: $68,420
- TP objetivo: +2.5%
- Exposición total par: $950 (38%)
- Ciclo padre (main): #42

#### `recovery_cycle_blocked` 🛡️
**Título:** Ciclo de recuperación bloqueado  
**Resumen:** El ciclo principal de {pair} cumple las condiciones de drawdown, pero el ciclo recovery fue bloqueado por: {motivo}. El bot seguirá vigilando para futuros intentos.  
**Acción:** Sin acción. {motivo detallado}.  
**Motivos posibles:**
- "Ya existe un recovery activo" → max recovery cycles alcanzado
- "Exposición del par al límite (38% ≥ 40%)" → maxPairExposurePct
- "Cooldown activo (faltan 2h)" → cooldownMinutes
- "Mercado débil (score 28 < 40)" → minMarketScore
- "Capital insuficiente" → no hay capital disponible
- "Rebote no confirmado" → requireReboundConfirmation

#### `recovery_cycle_closed` 📊
**Título:** Ciclo de recuperación cerrado  
**Resumen:** El ciclo de recuperación de {pair} se cerró con resultado {pnlPct}% ({pnlUsd}). Motivo: {closeReason}. El capital se ha liberado.  
**Acción:** Recovery cerrado. Capital liberado: {netValue}.  
**Datos:**
- Par, Modo, Cycle ID
- PnL: +2.3% (+$2.30)
- Duración: 18h
- Motivo cierre: TP alcanzado / trailing exit / main cerrado / tiempo máximo
- Compras realizadas: 2
- Exposición par tras cierre: $850

#### `recovery_cycle_risk_warning` ⚠️
**Título:** Alerta de riesgo: exposición elevada en {pair}  
**Resumen:** Con el ciclo de recuperación activo, la exposición total en {pair} es de {totalExposure} ({exposurePct}% del capital), acercándose al límite de {maxPct}%. Si el mercado sigue cayendo, la pérdida potencial aumenta.  
**Acción:** El bot no abrirá más ciclos para este par hasta que la exposición se reduzca.  
**Datos:**
- Exposición main: $850
- Exposición recovery: $100
- Total: $950 (38%)
- Límite: $1000 (40%)
- Drawdown combinado: -26.8%

### Distinción Visual Main vs Recovery en UI

#### En lista de eventos
- **Main**: Badge normal `[ETH/USD]`
- **Recovery**: Badge especial `[ETH/USD 🔄 Recovery #1]` con borde naranja/ámbar

#### En historial de ciclos
- Columna "Tipo" con badges:
  - `MAIN` → badge azul
  - `PLUS` → badge púrpura  
  - `RECOVERY` → badge ámbar/naranja con icono 🔄
- Referencia al ciclo padre: "Recovery de ciclo #42"

#### En detalle de ciclo expandido
- Sección nueva: "Ciclos vinculados"
  - Si es main: lista de plus y recovery cycles asociados
  - Si es recovery: link al ciclo padre con su estado

### Configuración UI
- Nuevo panel en Settings → IDCA → "Ciclos Recovery"
- Toggle on/off
- Sliders para: drawdown de activación, capital %, cooldown, max ciclos, TP
- Indicador visual de riesgo (barra de exposición por par)

---

## F) ALERTAS TELEGRAM

### Formato de Alertas

#### `recovery_cycle_eligible`
```
🟡 IDCA Recovery — Habilitado

Par: ETH/USD | Modo: SIM
Ciclo principal #42 en drawdown -28.5%
Umbral de activación: -25%

📊 Contexto:
• Capital asignado: $100
• Exposición par: $850 (34%)
• Score mercado: 45/100

⏳ Esperando confirmación de rebote...
```

#### `recovery_cycle_started`
```
⚡ IDCA Recovery — Ciclo Abierto

Par: ETH/USD | Modo: SIM
Recovery #1 para ciclo principal #42

💰 Entrada:
• Compra: 0.001462 ETH @ $68,420
• Capital: $100
• TP objetivo: +2.5% → $70,131

📊 Estado:
• Drawdown main: -28.5%
• Exposición total par: $950 (38%)
• Score mercado: 45/100
```

#### `recovery_cycle_blocked`
```
🛡️ IDCA Recovery — Bloqueado

Par: ETH/USD | Modo: SIM
Ciclo principal #42 en drawdown -28.5%

❌ Motivo: Exposición del par al límite (38% ≥ 40%)

El bot seguirá vigilando para futuros intentos.
```

#### `recovery_cycle_closed`
```
📊 IDCA Recovery — Ciclo Cerrado

Par: ETH/USD | Modo: SIM
Recovery #1 del ciclo principal #42

📈 Resultado: +2.3% (+$2.30)
⏱ Duración: 18h 42m
🔒 Motivo: TP alcanzado

Exposición par tras cierre: $850 (34%)
```

#### `recovery_cycle_risk_warning`
```
⚠️ IDCA Recovery — Riesgo Elevado

Par: ETH/USD | Modo: SIM

📊 Exposición:
• Main: $850 (-28.5%)
• Recovery: $100 (-3.2%)
• Total: $950 (38% de $2,500)
• Límite: 40%

⚠️ No se abrirán más ciclos hasta reducir exposición.
```

---

## G) RECOMENDACIÓN FINAL

### ✅ Recomiendo implementar Recovery Cycles con estas condiciones:

1. **Empezar deshabilitado** (`enabled: false`) — activación manual tras validación en simulación
2. **Máximo 1 recovery por main** — evitar acumulación excesiva
3. **Capital muy reducido** (8-10% del módulo, tope $500) — el riesgo incremental debe ser bajo
4. **TP conservador** (2-3%) — cierre rápido para liberar capital
5. **Cooldown largo** (6h) — evitar reactivaciones rápidas en cascada
6. **Rebote obligatorio** — no abrir en caída libre
7. **Score de mercado mínimo** (40/100) — no operar en pánico total
8. **Auto-cierre si main cierra** — no dejar huérfanos
9. **Tiempo máximo** (7 días) — evitar posiciones eternamente atrapadas
10. **Alertas siempre activas** — visibilidad total en Telegram y UI

### Orden de implementación sugerida:
1. Schema + tipos + config (1h)
2. Repository queries (30min)
3. Engine: activation + management + close (2h)
4. Alertas: eventos + formatter + catalog (1h)
5. Telegram notifier (30min)
6. UI: EventCards + historial + config panel (1.5h)
7. Tests en simulación (1h)

### ⚠️ NO recomiendo si:
- El módulo aún no ha sido validado en simulación con ciclos normales
- No hay capital suficiente para absorber pérdidas combinadas
- El usuario no monitorea regularmente la plataforma

---

*Diseño listo para revisión. Confirmar aprobación antes de implementar.*
