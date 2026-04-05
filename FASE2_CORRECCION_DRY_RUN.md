# FASE 2 — CORRECCIÓN DRY RUN Y AISLAMIENTO CONTABLE

**Fecha:** 2026-03-30
**Estado:** COMPLETADO

---

## OBJETIVO
Que DRY RUN se comporte funcionalmente como el modo real en posiciones abiertas e historial, pero completamente aislado de la contabilidad FIFO real.

---

## HALLAZGOS INICIALES (de FASE 1)

### ✅ Correcto:
1. Backend persiste correctamente en `dry_run_trades` (tabla separada)
2. FIFO de dry run funciona correctamente (matching BUY/SELL)
3. `fifoMatcher.ts` solo procesa `open_positions`, NO tiene acceso a `dry_run_trades`
4. Cálculos P&L son correctos (USD y porcentaje)

### ❌ Problemas detectados:
1. Backfill puede traer 65 operaciones inconsistentes desde `bot_events`
2. No hay validación de datos en backfill
3. No hay filtro temporal (trae eventos antiguos)
4. No hay información detallada de por qué se omiten operaciones

---

## CORRECCIONES IMPLEMENTADAS

### 2.1 — Validación de Aislamiento FIFO

**Verificación realizada:**
- ✅ `fifoMatcher.ts` solo procesa `open_positions` con filtros estrictos
- ✅ Excluye posiciones reconciliadas, sincronizadas y adoptadas
- ✅ NO tiene acceso a `dry_run_trades`
- ✅ Aislamiento FIFO es correcto y robusto

**Conclusión:** No se requieren cambios en FIFO. El aislamiento es completo.

---

### 2.2 — Backfill Defensivo

**Problema:** 
El endpoint `/api/dryrun/backfill` traía 65 operaciones inconsistentes desde `bot_events` sin validación.

**Solución implementada:**

#### Backend (`server/routes/dryrun.routes.ts`):

1. **Filtro temporal:**
   - Solo eventos de los últimos 30 días (configurable)
   - Parámetro `daysBack` en request body
   - Evita traer operaciones de pruebas antiguas

2. **Validación robusta:**
   - Verificar que existan campos críticos: `pair`, `type`, `simTxid`
   - Validar formato de pair (debe contener `/`)
   - Validar que `price > 0` y no sea NaN
   - Validar que `volume > 0` y no sea NaN
   - Detectar duplicados por `simTxid` (idempotencia)

3. **Skip reasons detallados:**
   ```typescript
   skipReasons: {
     duplicate: number,      // Ya existe en BD
     missingData: number,    // Faltan campos críticos
     invalidPrice: number,   // Precio <= 0 o NaN
     invalidVolume: number,  // Volumen <= 0 o NaN
     invalidPair: number     // Formato de pair inválido
   }
   ```

4. **Response enriquecida:**
   ```typescript
   {
     success: true,
     totalEvents: number,
     imported: number,
     skipped: number,
     skipReasons: Record<string, number>,
     daysBack: number,
     cutoffDate: string (ISO)
   }
   ```

#### Frontend (`client/src/pages/Terminal.tsx`):

1. **Request con parámetros:**
   - Envía `daysBack: 30` en body
   - Headers `Content-Type: application/json`

2. **Toast informativo:**
   - Muestra cantidad importada y omitida
   - Detalla razones de omisión si existen
   - Duración 8 segundos para leer detalles
   - Ejemplo: "5 trades recuperados de 70 eventos (últimos 30 días). Omitidos: 65 (duplicate: 40, invalidPrice: 15, missingData: 10)"

---

### 2.3 — Verificación de Cálculos P&L

**Revisión realizada:**
- ✅ FIFO correcto: busca el BUY más antiguo abierto del mismo pair
- ✅ Cálculo P&L USD: `(sellPrice - entryPrice) * volume`
- ✅ Cálculo P&L %: `((sellPrice - entryPrice) / entryPrice) * 100`
- ✅ Cierre de posición: marca BUY como `closed` al hacer match con SELL
- ✅ Manejo de orphan sells: si no hay BUY, usa precio de venta como entry

**Conclusión:** Cálculos son correctos. No se requieren cambios.

---

## ARCHIVOS MODIFICADOS

### Backend:
- `server/routes/dryrun.routes.ts` — Backfill defensivo con validación robusta

### Frontend:
- `client/src/pages/Terminal.tsx` — Toast informativo con skip reasons

### Documentación:
- `FASE1_AUDITORIA_ARQUITECTURA.md` — Mapa completo del sistema
- `FASE2_CORRECCION_DRY_RUN.md` — Este documento

---

## VERIFICACIÓN

### Build TypeScript:
```bash
npx tsc --noEmit --pretty
```
**Resultado:** ✅ Sin errores

### Commit:
```
990383f feat(fase2): backfill defensivo dry run - filtros temporales, validacion robusta, skip reasons detallados
```

---

## COMPORTAMIENTO ESPERADO DESPUÉS DE CORRECCIONES

### Antes:
- Backfill traía 65 operaciones sin filtrar
- No se sabía por qué se omitían operaciones
- Podía traer operaciones de hace meses
- Datos inconsistentes contaminaban la UI

### Después:
- Backfill solo trae últimos 30 días (configurable)
- Validación robusta rechaza datos inválidos
- Usuario ve razones detalladas de omisión
- Solo operaciones válidas llegan a la UI

---

## PRÓXIMOS PASOS (FASE 3)

1. Clasificar las 65 operaciones inconsistentes
2. Implementar soft delete o archivo de operaciones inválidas
3. Mejorar UI para distinguir operaciones válidas vs archivadas
4. Añadir confirmación antes de ejecutar backfill

---

## RIESGOS REMANENTES

### Ninguno crítico detectado:
- ✅ Aislamiento FIFO verificado y robusto
- ✅ Cálculos P&L correctos
- ✅ Backfill ahora es defensivo

### Mejoras futuras (no críticas):
- Añadir endpoint para ver operaciones archivadas
- Permitir configurar `daysBack` desde UI
- Añadir preview antes de ejecutar backfill

---

**FIN FASE 2**
