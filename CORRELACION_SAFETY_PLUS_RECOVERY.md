# Correlación Safety Orders / Plus / Recovery con sistema nuevo

## Auditoría de capas existentes

| Capa | Campo DB | Qué usa hoy | ¿Correlacionada con sistema nuevo? | Riesgo | Cambio propuesto |
|------|----------|-------------|----------------------------------|--------|-----------------|
| Safety Orders | safetyOrdersJson | Dip fijo desde avgEntryPrice, niveles predefinidos | NO - usa avgEntryPrice legacy, no VWAP Anchor | ALTO - duplica lógica con ladder ATRP | Migrar a ladder ATRP o desactivar si ladder activo |
| Safety Orders | maxSafetyOrders | Límite de compras | PARCIAL - limita total de compras | MEDIO - puede limitar ladder profundo | Alinear con maxLevels de ladder ATRP |
| Plus Cycles | plusConfigJson | Activación cuando main exhausted | PARCIAL - usa safetyOrders.length para determinar exhaustion | MEDIO - debe usar ladder levels si ladder activo | Actualizar lógica para usar ladder levels |
| Plus Cycles | requireMainExhausted | Requiere main agotado | NO - usa safetyOrders.length | MEDIO - debe usar ladder levels | Actualizar lógica para usar ladder levels |
| Recovery | recoveryConfigJson | Recuperación de drawdown | NO - usa avgEntryPrice legacy | BAJO - recovery es independiente | Mantener, pero alinearlo con VWAP Anchor si aplica |
| Cooldowns | cooldownMinutesBetweenBuys | Cooldown entre compras | NO - independiente | BAJO - cooldown es independiente | Mantener |
| Cycle Duration | maxCycleDurationHours | Duración máxima de ciclo | NO - independiente | BAJO - independiente | Mantener |
| Salidas | dynamicTakeProfit | TP dinámico | NO - independiente | BAJO - independiente | Mantener |
| Salidas | trailing/breakeven | Trailing stop | NO - independiente | BAJO - independiente | Mantener |

## Estado actual

- **IdcaMigrationService**: Ya existe servicio para migrar de safetyOrdersJson a ladder ATRP
- **IdcaEngine**: Usa safetyOrdersJson en múltiples lugares (líneas 350, 877, 926, 1121, 1377, 1613, 2952, 3546, 3779)
- **Validación**: IdcaCleanupService valida que no haya ciclos activos con safetyOrders sin migrar

## Recomendaciones

1. **Entrada inicial**: VWAP Anchor + Ladder ATRP es la fuente de verdad
2. **Safety Orders legacy**: Deben migrarse a ladder ATRP o desactivarse
3. **Plus Cycles**: Deben usar ladder levels en lugar de safetyOrders.length
4. **Recovery**: Mantener independiente, pero considerar alineación futura
5. **Validación**: Ya existe validación de no doble ejecución (IdcaMigrationService.validateNoDoubleExecution)

## Cambios mínimos necesarios

1. Actualizar lógica Plus cycles para usar ladder levels si ladder activo
2. Asegurar que safetyOrdersJson esté vacío si ladder ATRP está activo
3. Documentar que recovery sigue independiente por ahora

## Estado

- **Safety Orders**: Legacy, debe migrarse a ladder ATRP
- **Plus Cycles**: Parcialmente correlacionado, necesita actualización
- **Recovery**: Independiente, mantener como está
- **Salidas**: Independientes, mantener como está
