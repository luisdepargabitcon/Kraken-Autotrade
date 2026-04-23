# Auditoría de Duplicidades: Config (Antiguo) vs Adaptativo (Nuevo) - CORREGIDA

## Principio: Adaptativo es el sistema nuevo real, Config es legacy secundario

## Tabla de Fuentes de Verdad - CORREGIDA

| Setting | Dónde aparece hoy | Fuente de verdad REAL | Estado deseado |
|---------|------------------|----------------------|----------------|
| **Entradas (Adaptativo)** | | | |
| ladder_atrp_config_json | EntradasTab (nuevo) + DB | **EntradasTab (nuevo)** | Activo |
| ladder_atrp_enabled | EntradasTab (nuevo) + DB | **EntradasTab (nuevo)** | Activo |
| trailing_buy_level_1_config_json | EntradasTab (nuevo) + DB | **EntradasTab (nuevo)** | Activo |
| **Salidas (Adaptativo)** | | | |
| takeProfitPct | SalidasTab (nuevo) + DB + runtime | **SalidasTab (nuevo)** | Activo |
| dynamicTakeProfit | SalidasTab (nuevo) + DB + runtime | **SalidasTab (nuevo)** | Activo |
| failSafeEnabled | SalidasTab (nuevo) + DB + runtime | **SalidasTab (nuevo)** | Activo |
| failSafeMaxLossPct | SalidasTab (nuevo) + runtime | **SalidasTab (nuevo)** | Activo |
| failSafeTriggerPct | SalidasTab (nuevo) + runtime | **SalidasTab (nuevo)** | Activo |
| **Entradas (Config - Legacy)** | | | |
| minDipPct | ConfigTab (General) + runtime | **ConfigTab (legacy)** | Mantener (no migrado aún) |
| requireReboundConfirmation | ConfigTab (General) + AvanzadoTab | **ConfigTab (legacy)** | Eliminar de AvanzadoTab |
| reboundMinPct | ConfigTab (VWAP & Rebound) + AvanzadoTab | **ConfigTab (legacy)** | Eliminar de AvanzadoTab |
| vwapEnabled | ConfigTab (VWAP & Rebound) + AvanzadoTab + runtime | **ConfigTab (legacy)** | Eliminar de AvanzadoTab |
| vwapDynamicSafetyEnabled | ConfigTab (VWAP & Rebound) + AvanzadoTab + runtime | **ConfigTab (legacy)** | Eliminar de AvanzadoTab |
| **Salidas (Config - Legacy)** | | | |
| protectionActivationPct | ConfigTab (General) + runtime | **ConfigTab (legacy)** | Ocultar en SalidasTab |
| trailingActivationPct | ConfigTab (General) + runtime | **ConfigTab (legacy)** | Ocultar en SalidasTab |
| trailingMarginPct | ConfigTab (General) + runtime | **ConfigTab (legacy)** | Ocultar en SalidasTab |
| volatilityTrailingEnabled | ConfigTab (General) + runtime | **ConfigTab (legacy)** | Mantener (no migrado aún) |
| **Ejecución (Adaptativo)** | | | |
| strategy, orderType, slippageTolerancePct | EjecucionTab (nuevo) | **Sin endpoint backend** | Marcar como roadmap/preview |
| maxRetries, retryDelayMs | EjecucionTab (nuevo) | **Sin endpoint backend** | Marcar como roadmap/preview |
| **Avanzado (Adaptativo)** | | | |
| cooldownMinutesBetweenBuys | AvanzadoTab (nuevo) + DB | **AvanzadoTab (nuevo)** | Activo |
| maxCapitalPerCycle, maxDailyTrades | AvanzadoTab (nuevo) | **AvanzadoTab (nuevo)** | Activo (si existe DB) |
| enableDetailedLogging, logRetentionDays | AvanzadoTab (nuevo) | **AvanzadoTab (nuevo)** | Activo (si existe DB) |
| telegramDiagnosticsEnabled | AvanzadoTab (nuevo) | **AvanzadoTab (nuevo)** | Activo (si existe DB) |
| **Avanzado (Config - Legacy)** | | | |
| maxSafetyOrders | ConfigTab (General) + runtime | **ConfigTab (legacy)** | Eliminar de AvanzadoTab |
| **Config (Global - Legacy)** | | | |
| allocatedCapitalUsd, maxModuleExposurePct | ConfigTab (General) | **ConfigTab (legacy)** | Mantener (global) |
| smartModeEnabled, btcMarketGateForEthEnabled | ConfigTab (General) | **ConfigTab (legacy)** | Mantener (global) |
| adaptivePositionSizingEnabled | ConfigTab (General) | **ConfigTab (legacy)** | Mantener (global) |
| plusConfigJson | ConfigTab (General) | **ConfigTab (legacy)** | Mantener (global) |
| recoveryConfigJson | ConfigTab (General) | **ConfigTab (legacy)** | Mantener (global) |

## Estrategia de Resolución - CORREGIDA

**Adaptativo (nuevo) - Fuente de verdad para:**
- ladder_atrp_config_json (EntradasTab)
- ladder_atrp_enabled (EntradasTab)
- trailing_buy_level_1_config_json (EntradasTab)
- takeProfitPct (SalidasTab)
- dynamicTakeProfit (SalidasTab)
- failSafeEnabled, failSafeMaxLossPct, failSafeTriggerPct (SalidasTab)
- cooldownMinutesBetweenBuys (AvanzadoTab)
- maxCapitalPerCycle, maxDailyTrades (AvanzadoTab)
- enableDetailedLogging, logRetentionDays (AvanzadoTab)
- telegramDiagnosticsEnabled (AvanzadoTab)

**ConfigTab (antiguo) - Legacy para:**
- Settings globales (capital, exposición, smart mode, plus, recovery)
- minDipPct (no migrado aún)
- requireReboundConfirmation (no migrado aún)
- reboundMinPct (no migrado aún)
- vwapEnabled, vwapDynamicSafetyEnabled (no migrado aún)
- protectionActivationPct, trailingActivationPct, trailingMarginPct (no migrado aún)
- volatilityTrailingEnabled (no migrado aún)
- maxSafetyOrders (no migrado aún)

**SalidasTab (nuevo) - Eliminar referencias a Config:**
- NO mostrar sliders de protection/trailing (usar ConfigTab legacy)
- Solo mostrar takeProfit, dynamicTakeProfit, failSafe (que sí manda)

**EjecucionTab (nuevo) - Marcar como roadmap:**
- Sin endpoint backend actualmente
- Marcar claramente como preview/roadmap
- Desactivar botón guardar o indicar que es solo visual

**AvanzadoTab (nuevo) - Solo nuevos:**
- Eliminar campos duplicados de Config
- Solo mostrar cooldown, límites, logging, notificaciones

**ConfigTab (antiguo) - Banner LEGACY + reducción de poder:**
- Mantener como legacy visible
- Banner claro indicando que es configuración clásica
- Considerar marcar algunos campos como solo lectura si se migran a Adaptativo
