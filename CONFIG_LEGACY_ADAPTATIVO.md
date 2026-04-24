# Config Legacy vs Adaptativo — Tabla Real Basada en Código

## Auditoría de código runtime (IdcaEngine.ts, IdcaTypes.ts, shared/schema.ts)

| Campo | Ubicación | Usa runtime actual | Sistema que manda | Estado |
|-------|-----------|-------------------|-------------------|--------|
| **Adaptativo manda** |
| VWAP Anchor (frozenAnchorPrice) | IdcaEngine.ts línea 2320-2353 | SÍ - Runtime activo | Adaptativo - Prioridad 1 para entrada | Adaptativo activo |
| Ladder ATRP (ladderAtrpEnabled) | IdcaEngine.ts línea 856 | SÍ - Runtime activo | Adaptativo - Usa para trailing buy level 1 | Adaptativo activo |
| Ladder ATRP (ladderAtrpConfigJson) | IdcaEngine.ts línea 861-866 | SÍ - Runtime activo | Adaptativo - calculateLadder para triggerPrice | Adaptativo activo |
| Trailing Buy VWAP | IdcaEngine.ts línea 802-814 | SÍ - Runtime activo | Adaptativo - arm() con VWAP lowerBand1 | Adaptativo activo |
| Trailing Buy Level 1 | IdcaEngine.ts línea 895-913 | SÍ - Runtime activo | Adaptativo - armLevel() con ladder levels | Adaptativo activo |
| **Legacy sigue mandando** |
| Capital global (allocatedCapitalUsd) | IdcaEngine.ts línea 1116-1119 | SÍ - Runtime activo | Legacy - Gestión de capital | Legacy activo |
| Exposición global (maxAssetExposurePct) | IdcaEngine.ts línea 1116-1119 | SÍ - Runtime activo | Legacy - Límite de exposición | Legacy activo |
| Safety Orders (safetyOrdersJson) | IdcaEngine.ts línea 350-361, 3546-3552 | SÍ - Runtime activo | Legacy - calculateEffectiveSafetyLevel | Legacy activo (doble sistema) |
| maxSafetyOrders | IdcaEngine.ts línea 1612 | SÍ - Runtime activo | Legacy - Límite de compras | Legacy activo |
| minDipPct | IdcaEngine.ts línea 2320-2353 | SÍ - Runtime activo | Legacy - effectiveMinDip | Legacy activo |
| VWAP enable (vwapEnabled) | IdcaEngine.ts línea 783 | SÍ - Runtime activo | Legacy - Habilita trailing buy VWAP | Legacy activo |
| reboundMinPct | IdcaEngine.ts línea 803 | SÍ - Runtime activo | Legacy - Trailing buy VWAP | Legacy activo |
| **Independientes / Ambos** |
| Plus Cycles (plusConfigJson) | IdcaEngine.ts línea 2951-2954 | SÍ - Runtime activo | Legacy - Usa safetyOrders.length | Legacy activo |
| Recovery (recoveryConfigJson) | IdcaEngine.ts línea 761-769 | SÍ - Runtime activo | Independiente - Sistema separado | Independiente |
| Take Profit dinámico | IdcaEngine.ts (no encontrado) | NO - No se usa en runtime | Solo visual / roadmap | Solo visual |
| Trailing/breakeven legacy | IdcaEngine.ts (no encontrado) | NO - No se usa en runtime | Solo visual / roadmap | Solo visual |
| **Solo visual / Preview** |
| Coeficientes ATRP manuales | EntradasTab.tsx (state) | NO - Solo state visual | Solo visual - No persistido aún | Solo visual |
| Ladder profundo UI | EntradasTab.tsx (state) | PARCIAL - State visual + endpoint preview | Parcial - Preview sí, guardar no implementado aún | Parcial |

## Conclusión

**Adaptativo manda:**
- VWAP Anchor como referencia principal de entrada ✓
- Ladder ATRP para trailing buy level 1 ✓
- Trailing Buy VWAP y Level 1 ✓

**Legacy sigue mandando:**
- Capital global y exposición global ✓
- Safety Orders (doble sistema con ladder ATRP) ⚠️
- maxSafetyOrders ⚠️
- minDipPct ✓
- VWAP enable y reboundMinPct ✓

**Solo visual / roadmap:**
- Take Profit dinámico - No se usa en runtime
- Trailing/breakeven legacy - No se usa en runtime
- Coeficientes ATRP manuales - Solo state visual, no persistido aún
- Ladder profundo UI - Parcial (preview sí, guardar no implementado aún)

## Acciones necesarias

1. **Prioridad ALTA - Marcar controles solo visual en UI:**
   - Take Profit dinámico: agregar badge "Preview / no afecta al bot"
   - Trailing/breakeven legacy: agregar badge "Preview / no afecta al bot"

2. **Prioridad ALTA - Completar ladder profundo:**
   - Implementar persistencia de depthMode, targetCoveragePct, minStepPct, allowDeepExtension
   - Ya implementado en handleSaveLadderConfig ✓

3. **Prioridad ALTA - Resolver doble sistema:**
   - Migrar safetyOrders a ladder ATRP o desactivar cuando ladder está activo
   - Ver CORRELACION_RUNTIME_REAL.md

4. **Prioridad MEDIA - Completar coeficientes ATRP manuales:**
   - Implementar UI para editar multiplicadores por nivel
   - Implementar persistencia en ladder_atrp_config_json
