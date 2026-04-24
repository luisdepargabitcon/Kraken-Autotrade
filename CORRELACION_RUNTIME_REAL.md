# Correlación Safety Orders / Plus / Recovery — Tabla Runtime Real

## Auditoría de código runtime (IdcaEngine.ts, IdcaMigrationService.ts)

| Capa | Campo DB | Usa runtime actual | Comentario | Riesgo | Estado |
|------|----------|-------------------|-----------|--------|--------|
| Safety Orders | safetyOrdersJson | SÍ - Runtime activo | Líneas 350-361, 1377-1388, 3546-3552, 3780-3785 | ALTO - Usa calculateEffectiveSafetyLevel para determinar nextBuyPrice | Legacy activo |
| Safety Orders | maxSafetyOrders | SÍ - Runtime activo | Línea 1612: `const maxOrders = assetConfig.maxSafetyOrders` | MEDIO - Limita total de compras | Legacy activo |
| Ladder ATRP | ladderAtrpEnabled | SÍ - Runtime activo | Línea 856: Verifica si está habilitado para trailing buy level 1 | - | Adaptativo activo |
| Ladder ATRP | ladderAtrpConfigJson | SÍ - Runtime activo | Líneas 861-866: Usa calculateLadder para triggerPrice | - | Adaptativo activo |
| Validación doble ejecución | validateNoDoubleExecution | SÍ - Runtime activo | Líneas 926-953: Emite warning si ambos sistemas activos | MEDIO - Solo warning, NO previene ejecución | Parcial |
| Plus Cycles | plusConfigJson | SÍ - Runtime activo | Línea 2952: `const safetyOrders = parseSafetyOrders(assetConfig.safetyOrdersJson)` | ALTO - Usa safetyOrders.length para determinar exhaustion | Legacy activo |
| Plus Cycles | requireMainExhausted | SÍ - Runtime activo | Línea 2951-2954: Usa safetyOrders.length + 1 | MEDIO - Debe usar ladder levels si ladder activo | Legacy activo |
| Recovery | recoveryConfigJson | SÍ - Runtime activo | Línea 762-769: checkRecoveryActivation, manageRecoveryCycle | BAJO - Independiente de safety orders | Independiente |
| Recovery | recoveryEnabled | SÍ - Runtime activo | Línea 761: Verifica si está habilitado | - | Independiente |

## Conclusión

**Doble sistema de compras existe:**
- safetyOrdersJson se usa activamente en runtime para determinar niveles de compra (calculateEffectiveSafetyLevel)
- ladder ATRP también se usa para trailing buy level 1
- La validación de no doble ejecución SOLO emite warning, NO previene ejecución

**Plus Cycles usan safetyOrders.length:**
- Línea 2952-2954: `const maxBuys = safetyOrders.length + 1`
- Debe actualizarse para usar ladder levels si ladder ATRP está activo

**Recovery es independiente:**
- No usa safetyOrders ni ladder
- Funciona correctamente como sistema separado

## Cambios mínimos necesarios

1. **Prioridad ALTA - Evitar doble ejecución:**
   - Cuando ladderAtrpEnabled=true, desactivar uso de safetyOrdersJson para compras de seguridad
   - O migrar automáticamente safetyOrders a ladder ATRP

2. **Prioridad ALTA - Plus Cycles:**
   - Actualizar línea 2952-2954 para usar ladder levels si ladder ATRP está activo:
     ```typescript
     if (assetConfig.ladderAtrpEnabled && assetConfig.ladderAtrpConfigJson) {
       const ladder = await idcaLadderAtrpService.calculateLadder(pair, assetConfig.ladderAtrpConfigJson);
       const maxBuys = ladder.totalLevels;
     } else {
       const safetyOrders = parseSafetyOrders(assetConfig.safetyOrdersJson);
       const maxBuys = safetyOrders.length + 1;
     }
     ```

3. **Prioridad MEDIA - maxSafetyOrders:**
   - Alinear con maxLevels cuando ladder ATRP está activo

4. **Prioridad BAJA - Recovery:**
   - Mantener independiente, documentar que no duplica entradas
