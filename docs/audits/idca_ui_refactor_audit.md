# IDCA UI Refactor Audit — Fase 1

**Fecha:** 2026-06-29  
**Autor:** Cascade (Windsurf)  
**Alcance:** Auditoría completa de la UI IDCA — pestañas, duplicidades, eventos y propuesta de navegación.  
**Regla de seguridad:** No se toca lógica de trading. No se activa modo real. No se cambian parámetros del bot.

---

## A) Mapa Actual de Pestañas

### Pestañas principales (11 pestañas en una sola fila)

| # | Nombre visible | Tab key | Componente React | APIs usadas | Datos mostrados | Datos editables | Tipo |
|---|---|---|---|---|---|---|---|
| 1 | Resumen | `summary` | `SummaryTab` | `useIdcaSummary`, `useIdcaConfig`, `useIdcaAssetConfigs`, `useIdcaPerformance`, `useAllMarketContextPreviews`, `useAllMarketDataHealth` | KPIs capital, PnL, ciclos activos, Smart Strategy Score, estado por par, contexto mercado, ciclos activos | No | Operativo |
| 2 | Config | `config` | `ConfigTab` | `useIdcaConfig`, `useIdcaAssetConfigs`, `useUpdateIdcaConfig`, `useUpdateAssetConfig` | Capital, exposición, scheduler, min dip, smart mode, toggles por par, TP dinámico, Plus/Recovery, distancia dinámica, VWAP/ancla | Sí — todos los parámetros generales y por par | Configuración |
| 3 | Adaptativo | `adaptive` | `AdaptiveTab` → `EntradasTab`, `SalidasTab`, `EjecucionTab`, `AvanzadoTab` | `useIdcaAssetConfigs`, `useUpdateAssetConfig`, `useLadderPreview`, `useMarketContextPreview`, `useUpdateLadderAtrpConfig`, `useUpdateTrailingBuyLevel1Config` | Ladder ATRP, trailing buy, salidas (TP, BE, trailing, fail-safe), ejecución, avanzado | Sí — parámetros por par (entradas, salidas, ejecución) | Configuración |
| 4 | Ciclos | `cycles` | `CyclesTab` → `CycleDetailRow` | `useIdcaCycles`, `useIdcaCycleOrders`, `useAllMarketContextPreviews`, `useToggleSoloSalida`, `useToggleTimeStop`, `useDeleteManualCycle`, `useDeleteCycleForce`, `useManualCloseCycle`, `useEditImportedCycle`, `useSetCycleStatus` | Lista de ciclos (activos y cerrados), métricas por ciclo, grid overlay, órdenes, importar posición | Sí — toggle solo salida, timestop, delete, close, edit | Operativo |
| 5 | Historial | `history` | `HistoryTab` → `HistoryCyclesView` / `HistoryOrdersView` | `useIdcaClosedCycles`, `useIdcaOrders` | Ciclos cerrados con PnL, órdenes pasadas, aggregate stats | No | Histórico |
| 6 | Leyenda | `legend` | `LegendTab` | Ninguna (estático) | Glosario VWAP, Hybrid V2, colores, datos clave | No | Ayuda |
| 7 | Simulación | `simulation` | `SimulationTab` | `useIdcaSimulationWallet`, `useIdcaConfig`, `useResetSimulationWallet` | Wallet virtual: equity, balance, PnL, retorno, ciclos/órdenes simulados | Sí — reset wallet | Operativo |
| 8 | Eventos | `events` | `EventsTab` → `LiveMonitorPanel` / `EventsLogPanel` / `IdcaTerminalPanel` / `IdcaLogsPanel` | `useIdcaEvents`, `useIdcaEventsCount`, `useIdcaEventsPurge`, `useIdcaHealth`, `useIdcaControls` | Live monitor, historial eventos filtrable, terminal, logs técnicos | Sí — purge eventos | Operativo |
| 9 | Telegram | `telegram` | `TelegramTab` | `useIdcaConfig`, `useUpdateIdcaConfig`, `useIdcaTelegramTest`, `useIdcaTelegramStatus` | Config Telegram, toggles alertas por categoría, estado conexión | Sí — toda la config Telegram | Configuración |
| 10 | Guía | `guide` | `GuideTab` | Ninguna (estático) | Documentación inline: qué es IDCA, independencia, controles, pestañas, config detallada, sim vs live, ciclo de vida, FAQ | No | Ayuda |
| 11 | Mejoras | `hybrid` | `IdcaHybridPanel` | `useIdcaHybridConfig`, `useIdcaHybridStatus`, `useIdcaHybridEventsPanel`, `IdcaCycleGridOverlay` | Modo híbrido (off/observer/real), régimen, MR state, grid state, ciclos abiertos con diagnóstico, eventos hybrid/grid, config avanzada, alertas hybrid | Sí — modo, capas, alertas hybrid | Operativo + Configuración |

### Sub-pestañas dentro de Config (5)

| Sub-tab | Contenido |
|---|---|
| General | Capital, exposición, drawdown, scheduler, smart mode, min dip, toggles por par |
| Compras | Entry sub-sections (safety orders, trailing buy, dynamic entry) |
| Plus / Recovery | Config Plus y Recovery (JSON config) |
| Distancia Dinámica | Config distancia dinámica de safety orders |
| Ancla / VWAP | Config VWAP, ancla dinámica, bandas |

### Sub-pestañas dentro de Adaptativo (4)

| Sub-tab | Componente | Contenido |
|---|---|---|
| Entradas | `EntradasTab` | Ladder ATRP, perfiles, slider intensidad, trailing buy nivel 1 |
| Salidas | `SalidasTab` | TP, break-even, trailing, fail-safe, OCO |
| Ejecución | `EjecucionTab` | Configuración de ejecución |
| Avanzado | `AvanzadoTab` | Parámetros técnicos, JSON raw |

### Sub-pestañas dentro de Eventos (4)

| Sub-tab | Componente | Contenido |
|---|---|---|
| Monitor Tiempo Real | `LiveMonitorPanel` | Health bar + eventos live (50 últimos) |
| Historial de Eventos | `EventsLogPanel` | Tabla filtrable, paginada, exportable |
| Terminal | `IdcaTerminalPanel` | Eventos enriquecidos con payload técnico |
| Logs IDCA | `IdcaLogsPanel` | Logs técnicos continuos |

---

## B) Mapa de Duplicidades — Ampliado

### B.1) Tabla maestra de duplicidades

**Criterio de decisión aplicado:**
1. Versión más nueva/completa/segura → principal.
2. Usa datos backend/API vs cálculo local/legacy → backend gana.
3. Lógica adaptativa/inteligente validada vs legacy/manual → inteligente gana.
4. Informativa vs editable → solo una editable, resto lectura.
5. Dos controles editan mismo parámetro → eliminar uno de UI principal.
6. Dato en varias pestañas → solo si tiene sentido contextual.
7. Opción peligrosa → solo en Configuración > Avanzado con aviso.
8. Legacy necesario para compatibilidad → oculto de UI principal.
9. No eliminar columnas/APIs/lógica sin comprobar dependencias.
10. No cambiar valores actuales del usuario.

**Regla principal:** Cada parámetro tiene UNA fuente de verdad y UN sitio principal de edición.

| # | Parámetro / Bloque | Aparece en | Fuente real de datos | Cuál es editable | Cuál es solo visual | Riesgo de confusión | Mantener principal | Convertir a solo lectura | Ocultar/Mover a avanzado | Motivo |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **TP objetivo (`takeProfitPct`)** | ConfigTab → Sub-tab "Compras" (NO edita directamente), AdaptiveTab → SalidasTab (slider editable), CyclesTab → `CycleDetailRow` (read-only chip `tpTargetPrice`), HybridPanel (read-only `tpTargetPrice`) | `institutional_dca_asset_configs.take_profit_pct` | **SalidasTab** (slider + `handleSave` → `updateConfig.mutateAsync`) | CyclesTab, HybridPanel, ConfigTab (solo muestra guardrails min/max) | **Alto** — SalidasTab tiene slider que edita `takeProfitPct`, pero ConfigTab tiene guardrails TP min/max que limitan el rango. Usuario puede poner 4% en Salidas pero el guardrail min es 2% — confusión sobre qué manda | **Configuración → Salidas** (slider TP) | CyclesTab (chip "Objetivo TP" con tooltip), HybridPanel (precio TP) | Guardrails TP min/max → Configuración → Salidas (sección avanzada colapsable) | SalidasTab usa API real (`updateConfig.mutateAsync`). ConfigTab no edita `takeProfitPct` directamente, solo guardrails. Criterio 4: una editable, resto lectura |
| 2 | **TP dinámico guardrails (`dynamicTpConfigJson`)** | ConfigTab → Sub-tab "Compras" → "Ajustes finos TP dinámico" (colapsable, 12+ sliders), SalidasTab (`dynamicTpEnabled` toggle) | `institutional_dca_config.dynamic_tp_config_json` | **ConfigTab** (sliders reductionPerExtraBuy, weakRebound, strongRebound, volatilityAdjust, min/max TP) | SalidasTab (toggle enable/disable) | **Medio** — toggle enable en SalidasTab, parámetros finos en ConfigTab. Si desactivas en Salidas pero guardrails siguen configurados en Config, no hay feedback visual | **Configuración → Salidas** (toggle + guardrails juntos) | — | — | Criterio 5: dos sitios editan aspectos del mismo feature. Unificar |
| 3 | **Trailing margin (`trailingMarginPct`)** | ConfigTab → Sub-tab "Compras" → Slider BTC/ETH (editable), SalidasTab (`trailingEnabled` toggle, NO edita valor), CyclesTab → `CycleDetailRow` (read-only, calcula `trailStopPrice`) | `institutional_dca_asset_configs.trailing_margin_pct` | **ConfigTab** (slider 0.3-3.5%) | CyclesTab (read-only), SalidasTab (solo toggle enable) | **Alto** — valor se edita en ConfigTab, enable en SalidasTab. Usuario puede activar trailing en Salidas pero el % está en otro sitio | **Configuración → Salidas** (slider + toggle juntos) | CyclesTab (chip trailing stop con precio) | — | Criterio 4+5: unificar enable y valor en mismo sitio |
| 4 | **Trailing activation (`trailingActivationPct`)** | ConfigTab → Sub-tab "Compras" → Slider BTC/ETH (editable), CyclesTab (read-only, calcula `trailProgress`) | `institutional_dca_asset_configs.trailing_activation_pct` | **ConfigTab** (slider 1.5-7.0%) | CyclesTab (read-only progress bar) | **Bajo** — solo un sitio edita | **Configuración → Salidas** | CyclesTab (progress bar) | — | Correcto, mantener |
| 5 | **Break-even enable (`breakevenEnabled`)** | ConfigTab (no visible directamente), SalidasTab (toggle editable), CyclesTab (read-only `protectionArmedAt`) | `institutional_dca_asset_configs.breakeven_enabled` | **SalidasTab** (toggle) | CyclesTab (badge BE armado) | **Medio** — enable en Salidas, pero `protectionActivationPct` está en ConfigTab | **Configuración → Salidas** (toggle + valor juntos) | CyclesTab | — | Criterio 5: enable y valor separados |
| 6 | **Break-even activation (`protectionActivationPct`)** | ConfigTab → Sub-tab "Compras" → Slider BTC/ETH (editable), CyclesTab (read-only, calcula `beProgress`) | `institutional_dca_asset_configs.protection_activation_pct` | **ConfigTab** (slider 0.3-2.5%) | CyclesTab (progress bar) | **Medio** — valor en ConfigTab, enable en SalidasTab | **Configuración → Salidas** (slider + toggle juntos) | CyclesTab | — | Criterio 5: unificar |
| 7 | **BE net buffer (`beNetBufferPct`)** | ConfigTab → Sub-tab "Compras" → Slider BTC/ETH (editable), CyclesTab (no visible) | `institutional_dca_asset_configs.be_net_buffer_pct` | **ConfigTab** (slider 0-1.0%) | — | **Bajo** — solo un sitio | **Configuración → Salidas** | — | — | Mover a Salidas junto con BE |
| 8 | **Trailing dinámico ATR (`volatilityTrailingEnabled`)** | ConfigTab → Sub-tab "Compras" → Toggle (editable), SalidasTab (no visible) | `institutional_dca_config.volatility_trailing_enabled` | **ConfigTab** (toggle) | — | **Bajo** — solo un sitio | **Configuración → Salidas** | — | — | Mover a Salidas |
| 9 | **Min Dip (`minDipPct`)** | ConfigTab → Sub-tab "General" → Slider BTC/ETH (editable), AdaptiveTab → EntradasTab (implícito en ladder preview, no edita directamente), AvanzadoTab (comentario: "se configura en ConfigTab") | `institutional_dca_asset_configs.min_dip_pct` | **ConfigTab** (slider 1-20%) | EntradasTab (preview en ladder) | **Medio** — ConfigTab edita, EntradasTab muestra preview que depende del valor pero no indica que viene de Config | **Configuración → Entradas** | EntradasTab (preview ladder) | — | Criterio 4: ConfigTab es editable, Entradas es preview |
| 10 | **Rebound confirm (`requireReboundConfirmation`)** | ConfigTab → Sub-tab "General" → Toggle BTC/ETH (editable), AvanzadoTab (comentario: "se configura en ConfigTab"), Plus/Recovery config (toggle propio `requireReboundConfirmation` dentro de `plusConfigJson`/`recoveryConfigJson`) | `institutional_dca_asset_configs.require_rebound_confirmation` (main), `plus_config_json.requireReboundConfirmation` (plus), `recovery_config_json.requireReboundConfirmation` (recovery) | **ConfigTab** (main), **ConfigTab → Plus/Recovery** (plus/recovery) | AvanzadoTab (comentario informativo) | **Bajo** — son 3 parámetros diferentes para 3 tipos de ciclo | **Configuración → Entradas** (main), **Configuración → Avanzado** (plus/recovery) | — | — | Son parámetros distintos por tipo de ciclo, correcto |
| 11 | **Rebound min (`reboundMinPct`)** | ConfigTab → Sub-tab "Ancla/VWAP" → Slider BTC/ETH (editable), AvanzadoTab (comentario: "se configura en ConfigTab") | `institutional_dca_asset_configs.rebound_min_pct` | **ConfigTab** (slider 0.1-2.0%) | AvanzadoTab (comentario) | **Bajo** — solo un sitio edita | **Configuración → Entradas** | — | — | Correcto, mantener |
| 12 | **VWAP enabled (`vwapEnabled`)** | ConfigTab → Sub-tab "Ancla/VWAP" → Toggle BTC/ETH (editable), AvanzadoTab (comentario: "se configura en Config → VWAP & Rebound"), EntradasTab (no visible directamente) | `institutional_dca_asset_configs.vwap_enabled` | **ConfigTab** (toggle) | AvanzadoTab (comentario) | **Bajo** — solo un sitio edita | **Configuración → Entradas** (sección VWAP/ancla) | — | — | Correcto, mantener |
| 13 | **VWAP dynamic safety (`vwapDynamicSafetyEnabled`)** | ConfigTab → Sub-tab "Ancla/VWAP" → Toggle BTC/ETH (editable), AvanzadoTab (comentario) | `institutional_dca_asset_configs.vwap_dynamic_safety_enabled` | **ConfigTab** (toggle) | AvanzadoTab (comentario) | **Bajo** — solo un sitio edita | **Configuración → Entradas** | — | — | Correcto, mantener |
| 14 | **Max safety orders (`maxSafetyOrders`)** | ConfigTab → Sub-tab "Plus/Recovery" → Slider BTC/ETH (editable), SummaryTab (read-only display), AvanzadoTab (comentario: "se configura en ConfigTab") | `institutional_dca_asset_configs.max_safety_orders` | **ConfigTab** (slider 0-10) | SummaryTab (display), AvanzadoTab (comentario) | **Bajo** — solo un sitio edita | **Configuración → Entradas** | SummaryTab | — | Correcto, mantener |
| 15 | **Smart Mode (`smartModeEnabled`)** | ConfigTab → Sub-tab "General" → Toggle (editable), SummaryTab (KPI card "Smart Mode ON/OFF") | `institutional_dca_config.smart_mode_enabled` | **ConfigTab** (toggle) | SummaryTab (read-only) | **Bajo** — solo un sitio edita | **Configuración → General** | Panel (KPI) | — | Correcto, mantener |
| 16 | **Pair enable (`enabled`)** | ControlsBar (switch BTC/ETH en header), ConfigTab → Sub-tab "General" → Toggle por par (editable) | `institutional_dca_asset_configs.enabled` | **AMBOS** — ControlsBar y ConfigTab | — | **Alto** — dos sitios editan el mismo campo. Usuario puede activar en ControlsBar y desactivar en Config sin saberlo | **ControlsBar** (switch principal) | ConfigTab → mostrar como badge "Activo/Inactivo" con enlace "Editar en barra superior" | — | Criterio 5: eliminar uno. ControlsBar es más visible y contextual |
| 17 | **Capital asignado (`allocatedCapitalUsd`)** | ConfigTab → Sub-tab "General" → Input (editable), SummaryTab (KPI read-only) | `institutional_dca_config.allocated_capital_usd` | **ConfigTab** (input) | SummaryTab (KPI) | **Bajo** — solo un sitio edita | **Configuración → General** | Panel (KPI) | — | Correcto, mantener |
| 18 | **Exposición máxima (`maxModuleExposurePct`)** | ConfigTab → Sub-tab "General" → Slider (editable), SummaryTab (no visible directamente) | `institutional_dca_config.max_module_exposure_pct` | **ConfigTab** (slider) | — | **Bajo** | **Configuración → Protección** | — | — | Correcto, mantener |
| 19 | **Drawdown máximo (`maxModuleDrawdownPct`)** | ConfigTab → Sub-tab "General" → Slider (editable) | `institutional_dca_config.max_module_drawdown_pct` | **ConfigTab** (slider) | — | **Bajo** | **Configuración → Protección** | — | — | Correcto, mantener |
| 20 | **Scheduler (`schedulerIdleSeconds` etc.)** | ConfigTab → Sub-tab "General" → `SchedulerConfigBlock` (editable) | `institutional_dca_config.scheduler_idle_seconds` etc. | **ConfigTab** | — | **Bajo** | **Configuración → General** | — | — | Correcto, mantener |
| 21 | **Distancia dinámica (`dynamicDistanceConfigJson`)** | ConfigTab → Sub-tab "Distancia Dinámica" → `DynamicDistancePanel` BTC/ETH (editable), AvanzadoTab (no visible) | `institutional_dca_asset_configs.dynamic_distance_config_json` | **ConfigTab** | — | **Bajo** — solo un sitio | **Configuración → Entradas** | — | — | Correcto, mantener |
| 22 | **Plus config (`plusConfigJson`)** | ConfigTab → Sub-tab "Plus/Recovery" (editable, 10+ sliders/toggles) | `institutional_dca_config.plus_config_json` | **ConfigTab** | — | **Bajo** — solo un sitio | **Configuración → Avanzado** | — | — | Correcto, mantener |
| 23 | **Recovery config (`recoveryConfigJson`)** | ConfigTab → Sub-tab "Plus/Recovery" (editable, 12+ sliders/toggles) | `institutional_dca_config.recovery_config_json` | **ConfigTab** | — | **Bajo** — solo un sitio | **Configuración → Avanzado** | — | — | Correcto, mantener |
| 24 | **Ladder ATRP (`ladderAtrpConfigJson`)** | AdaptiveTab → EntradasTab (editable: perfiles, slider intensidad, depth mode, manual multipliers), ConfigTab (no visible) | `institutional_dca_asset_configs.ladder_atrp_config_json` | **EntradasTab** | — | **Bajo** — solo un sitio | **Configuración → Entradas** | — | — | Correcto, mantener |
| 25 | **Trailing buy nivel 1 (`trailingBuyLevel1ConfigJson`)** | AdaptiveTab → EntradasTab (editable: enable, trigger level, trailing mode, trailing value), ConfigTab (no visible) | `institutional_dca_asset_configs.trailing_buy_level1_config_json` | **EntradasTab** | — | **Bajo** — solo un sitio | **Configuración → Entradas** | — | — | Correcto, mantener |
| 26 | **Fail-safe (`failSafeEnabled`, `failSafeMaxLossPct`, `failSafeTriggerPct`)** | AdaptiveTab → SalidasTab (sliders + toggle, PERO `failSafeEnabled` está `disabled` y hardcoded `true`, sliders editan `localConfig` pero NO guardan a API) | `institutional_dca_asset_configs` (no existe columna — simulated/local) | **SalidasTab** (local state, NO persiste) | — | **Alto** — sliders de fail-safe parecen editables pero NO guardan a backend. `handleSave` solo guarda `breakevenEnabled`, `takeProfitPct`, `dynamicTakeProfit`. Usuario cree que configura fail-safe pero no persiste | **Configuración → Salidas** (si se implementa persistencia) o **eliminar sliders decorativos** | — | Si no se persiste: **Ocultar/Mover a Avanzado** con aviso "No funcional" | Criterio 2: usa cálculo local, no backend. Criterio 8: legacy decorativo |
| 27 | **OCO (`ocoEnabled`)** | AdaptiveTab → SalidasTab (toggle, local state, NO persiste a API) | No existe en schema — local only | **SalidasTab** (local, NO persiste) | — | **Alto** — toggle parece funcional pero no guarda | — | — | **Ocultar/Mover a Avanzado** con aviso "No funcional" | Criterio 2+8: local, no backend, legacy |
| 28 | **TP ref mode (`tpRefMode`)** | AdaptiveTab → SalidasTab (select, local state, NO persiste) | No existe en schema — local only | **SalidasTab** (local, NO persiste) | — | **Medio** — select parece funcional pero no guarda | — | — | **Ocultar/Mover a Avanzado** | Criterio 2+8 |
| 29 | **Execution fees (`executionFeesJson`)** | AdaptiveTab → EjecucionTab (editable: exchange, maker, taker, mode, includeExit, useReal), ConfigTab (no visible) | `institutional_dca_config.execution_fees_json` | **EjecucionTab** (guarda via `updateIdcaConfig.mutateAsync`) | — | **Bajo** — solo un sitio edita | **Configuración → Avanzado** | — | — | Correcto, mantener |
| 30 | **Cooldown entre compras (`cooldownMinutesBetweenBuys`)** | AdaptiveTab → AvanzadoTab (editable), ConfigTab (no visible) | `institutional_dca_asset_configs.cooldown_minutes_between_buys` | **AvanzadoTab** (guarda via `updateConfig.mutateAsync`) | — | **Bajo** — solo un sitio | **Configuración → Entradas** | — | — | Correcto, mantener |
| 31 | **Telegram IDCA (toggles)** | TelegramTab (12+ toggles por categoría: compra, venta, VWAP, sistema), HybridPanel → Alertas híbridas (4 toggles: regimeChange, MR, grid) | `institutional_dca_config.telegram_alert_toggles_json` (IDCA), `idca_hybrid_alert_config` (Hybrid) | **TelegramTab** (IDCA), **HybridPanel** (Hybrid) | — | **Medio** — dos paneles editan alertas Telegram diferentes pero visualmente solapados. Usuario no distingue cuáles manda | **Alertas → IDCA** (TelegramTab), **Alertas → Hybrid/Grid** (HybridPanel alertas) | — | — | Criterio 4: unificar en pestaña Alertas con sub-secciones claras |
| 32 | **Telegram config (`telegramEnabled`, `telegramChatId`, `telegramThreadId`, `telegramCooldownSeconds`)** | TelegramTab (editable), Integrations.tsx (5 matches — posible edición) | `institutional_dca_config.telegram_*` | **TelegramTab** (principal), Integrations.tsx (secundario) | — | **Medio** — posible edición duplicada en Integrations | **Alertas** (TelegramTab migrado) | — | Integrations.tsx → verificar si edita mismo campo | Criterio 5: verificar dependencia |
| 33 | **`idcaHybridMode`** | HybridPanel (mode selector off/observer/real), ControlsBar (no visible) | `idca_hybrid_config.mode` | **HybridPanel** | — | **Bajo** — solo un sitio | **Hybrid/Grid** (modo) + **Configuración → Hybrid/Grid** (referencia) | Panel (badge modo) | — | Correcto, mantener |
| 34 | **`executionScope`** | No visible en UI | Backend config (`idca_hybrid_config.execution_scope`) | No editable en UI | — | **N/A** | — | — | **Mostrar en Configuración → Hybrid/Grid** (read-only badge) | Debe ser visible para transparencia |
| 35 | **`observer_only`** | HybridPanel (badge "observer_only=true"), IdcaCycleGridOverlay (badge "OBSERVADOR"), IdcaHybridEventsPanel (6 matches) | Backend config | No editable en UI | HybridPanel, GridOverlay, HybridEvents | **N/A** | — | Panel (badge traducido), Ciclos abiertos (badge), Hybrid/Grid (badge) | — | Mostrar como "Observador, sin órdenes reales" |
| 36 | **`doNotRewriteAnchor`** | No visible en UI | Backend config | No editable en UI | — | **N/A** | — | — | **Mostrar en Configuración → Avanzado** (read-only, "Protección de ancla activa") | Debe ser visible para transparencia |
| 37 | **`maxGridLevels` / `maxGridCapitalPctOfCycle`** | HybridPanel → Config avanzada (no visible directamente como slider), IdcaCycleGridOverlay (read-only display) | `idca_hybrid_config` | **HybridPanel** (config avanzada) | IdcaCycleGridOverlay | **Bajo** | **Configuración → Hybrid/Grid** | Ciclos abiertos (Grid Observer) | — | Mostrar en Grid Observer como lectura |
| 38 | **Grid enabled (`gridEnabled`)** | HybridPanel → Config avanzada (toggle), IdcaCycleGridOverlay (read-only status) | `idca_hybrid_config.grid_enabled` | **HybridPanel** | GridOverlay | **Bajo** — solo un sitio edita | **Configuración → Hybrid/Grid** | Ciclos abiertos (Grid Observer) | — | Correcto, mantener |
| 39 | **Mean reversion enabled (`meanReversionEnabled`)** | HybridPanel → Config avanzada (toggle) | `idca_hybrid_config.mean_reversion_enabled` | **HybridPanel** | — | **Bajo** | **Configuración → Hybrid/Grid** | — | — | Correcto, mantener |
| 40 | **Bear trend block (`bearTrendBlockEnabled`)** | HybridPanel → Config avanzada (toggle) | `idca_hybrid_config.bear_trend_block_enabled` | **HybridPanel** | — | **Bajo** | **Configuración → Hybrid/Grid** | — | — | Correcto, mantener |
| 41 | **Dynamic volatility block (`dynamicVolatilityEnabled`)** | HybridPanel → Config avanzada (toggle) | `idca_hybrid_config.dynamic_volatility_enabled` | **HybridPanel** | — | **Bajo** | **Configuración → Hybrid/Grid** | — | — | Correcto, mantener |
| 42 | **Régimen** | HybridPanel (badge con color), IdcaCycleGridOverlay (read-only), SummaryTab → `IdcaMarketContextSummary` (market context), HybridPanel → active cycle rows (badge) | `idca_hybrid_state.regime` | No editable | HybridPanel, GridOverlay, SummaryTab | **Bajo** — todos son read-only | — | Panel (badge resumen), Ciclos abiertos (badge), Hybrid/Grid (badge detallado) | — | Mostrar en Panel como badge, detalle en Hybrid/Grid |
| 43 | **Simulación / Dry Run / Observer (IDCA mode)** | ControlsBar (mode selector DISABLED/SIMULATION/LIVE), SimulationTab (wallet display), HybridPanel (hybrid mode — diferente) | `institutional_dca_config.mode` (IDCA), `idca_hybrid_config.mode` (Hybrid) | **ControlsBar** (IDCA mode), **HybridPanel** (Hybrid mode) | SimulationTab (wallet) | **Alto** — dos modos diferentes (IDCA mode vs Hybrid mode) que el usuario confunde. "Observer" en Hybrid ≠ "Simulation" en IDCA | **Panel** (mostrar ambos claramente: "IDCA: Simulation" + "Hybrid: Observer"), **ControlsBar** (IDCA mode), **Hybrid/Grid** (Hybrid mode) | — | — | Criterio 6: mostrar contextualmente con etiquetas claras |
| 44 | **Market score** | SummaryTab (KPI card), CyclesTab → `CycleDetailRow` (read-only `cycle.marketScore`), HybridPanel (read-only `latestState.score`) | `idca_hybrid_state.score` / cycle data | No editable | SummaryTab, CyclesTab, HybridPanel | **Bajo** — todos read-only | — | Panel (KPI), Ciclos abiertos (chip), Hybrid/Grid (detalle) | — | Correcto, todos lectura |
| 45 | **ATR / Volatilidad** | SummaryTab (KPI card), HybridPanel (read-only `latestState.atr_pct`), EntradasTab (preview ladder usa ATRP) | `idca_hybrid_state.atr_pct` / market data | No editable | SummaryTab, HybridPanel, EntradasTab | **Bajo** — todos read-only | — | Panel (KPI), Configuración → Entradas (preview), Hybrid/Grid (detalle) | — | Correcto |
| 46 | **Next buy price** | CyclesTab → `CycleDetailRow` (read-only chip), HybridPanel → active cycle rows (read-only `raw.nextBuyPrice`) | Cycle data (calculado por engine) | No editable | CyclesTab, HybridPanel | **Bajo** — todos read-only | — | Ciclos abiertos (chip), Hybrid/Grid (detalle) | — | Correcto |
| 47 | **Precio medio / Avg entry** | CyclesTab → `CycleDetailRow` (read-only chip), HybridPanel → active cycle rows (read-only `raw.avgEntryPrice`), EditImportedCycleModal (editable solo para importados) | `institutional_dca_cycles.avg_entry_price` | **EditImportedCycleModal** (solo importados/manuales) | CyclesTab, HybridPanel | **Bajo** — solo editable en importados | **Ciclos abiertos** (chip lectura), Edit modal para importados | — | — | Criterio 4: editable solo en modal de importación |
| 48 | **Capital usado / reservado** | CyclesTab → `CycleDetailRow` (read-only chip), SummaryTab (KPI capital en uso), HybridPanel (no visible), EditImportedCycleModal (editable para importados) | `institutional_dca_cycles.capital_used_usd` | **EditImportedCycleModal** (solo importados) | CyclesTab, SummaryTab | **Bajo** | — | Panel (KPI), Ciclos abiertos (chip) | — | Correcto |
| 49 | **PnL no realizado** | CyclesTab → `CycleDetailRow` (read-only, calcula `pnlPct`, `pnlUsd`, `netPnlUsd`), SummaryTab (KPI PnL), HybridPanel (no visible) | `institutional_dca_cycles.unrealized_pnl_*` | No editable | CyclesTab, SummaryTab | **Bajo** — todos read-only | — | Panel (KPI), Ciclos abiertos (chip) | — | Correcto |
| 50 | **PnL realizado (historial)** | HistoryTab → `HistoryCyclesView` (read-only, calcula via `calculateIdcaCycleRealizedPnl`), SummaryTab (KPI PnL realizado) | `institutional_dca_cycles.realized_pnl_usd` + orders | No editable | HistoryTab, SummaryTab | **Bajo** — todos read-only | — | Panel (KPI), Historial (detalle) | — | Correcto |

### B.2) Duplicidades críticas — Resumen de acciones

**Riesgo ALTO (requieren intervención prioritaria):**

| # | Parámetro | Problema | Acción |
|---|---|---|---|
| 1 | TP objetivo | Editable en SalidasTab, guardrails en ConfigTab, read-only en Cycles/Hybrid | Unificar en Configuración → Salidas (slider + guardrails colapsables) |
| 3 | Trailing margin | Valor en ConfigTab, enable en SalidasTab | Unificar en Configuración → Salidas |
| 16 | Pair enable | Dos sitios editan (ControlsBar + ConfigTab) | Editable solo en ControlsBar, Config → lectura |
| 26 | Fail-safe | Sliders parecen editables pero NO persisten a backend | Eliminar sliders decorativos o marcar como "No funcional" |
| 27 | OCO | Toggle parece funcional pero NO persiste | Eliminar o marcar como "No funcional" |
| 43 | Simulación/Observer | Dos modos diferentes confundidos | Panel debe mostrar ambos con etiquetas claras |

**Riesgo MEDIO (requieren unificación):**

| # | Parámetro | Problema | Acción |
|---|---|---|---|
| 2 | TP dinámico guardrails | Toggle en Salidas, parámetros en Config | Unificar en Configuración → Salidas |
| 5 | BE enable | Enable en Salidas, valor en Config | Unificar en Configuración → Salidas |
| 6 | BE activation | Valor en Config, enable en Salidas | Unificar en Configuración → Salidas |
| 9 | Min Dip | Config edita, Entradas muestra preview sin indicar origen | Añadir enlace "Editar en Configuración → Entradas" |
| 31 | Telegram alerts | IDCA y Hybrid en paneles separados | Unificar en Alertas con sub-secciones |
| 32 | Telegram config | Posible edición en Integrations.tsx | Verificar y unificar |
| 28 | TP ref mode | Select local no persiste | Eliminar o marcar "No funcional" |

### B.3) Parámetros con datos simulados/no persistentes (legacy decorativo)

Estos parámetros aparecen en la UI como editables pero **NO persisten** al backend:

| Parámetro | Componente | Estado | Acción recomendada |
|---|---|---|---|
| `failSafeEnabled` | SalidasTab | `disabled`, hardcoded `true` | Mostrar como badge "Siempre activo" (no toggle) |
| `failSafeMaxLossPct` | SalidasTab | Slider local, no guarda | Eliminar slider o mover a Avanzado con aviso |
| `failSafeTriggerPct` | SalidasTab | Slider local, no guarda | Eliminar slider o mover a Avanzado con aviso |
| `ocoEnabled` | SalidasTab | Toggle local, no guarda | Eliminar o mover a Avanzado con aviso |
| `tpRefMode` | SalidasTab | Select local, no guarda | Eliminar o mover a Avanzado con aviso |
| `exitState` (failSafeArmed, breakEvenArmed, etc.) | SalidasTab | `useEffect` con datos simulados hardcoded | Conectar a API real o eliminar |
| `migrationStatus` | AvanzadoTab | `useEffect` con datos simulados | Conectar a API real o eliminar |
| `systemHealth` | AvanzadoTab | `useEffect` con datos simulados | Conectar a API real o eliminar |
| `executionState` | EjecucionTab | `useEffect` con datos simulados | Conectar a API real o eliminar |

**Nota:** Estos no se eliminan en esta fase (Criterio 9: no eliminar sin comprobar dependencias). Se marcan para fase de implementación.

---

## B.4) Decisiones Aplicadas — Commit 1

> `fix(idca-ui): remove misleading duplicate controls and clarify config ownership`

### SalidasTab.tsx

| Control eliminado | Motivo | Reemplazado por |
|---|---|---|
| `failSafeMaxLossPct` slider | No persiste en backend (local state) | Badge "Siempre activo" + nota sobre migración DB pendiente |
| `failSafeTriggerPct` slider | No persiste en backend (local state) | Badge "Siempre activo" + nota sobre migración DB pendiente |
| `failSafeEnabled` Switch (disabled) | Hardcoded, engañoso | Eliminado; misma info en badge |
| `ocoEnabled` Switch | No persiste; no afecta al bot | Card OCO con aviso "Pendiente backend" |
| `tpRefMode` Select | No persiste; no tiene acción backend | Eliminado |
| `trailingEnabled` Switch | No persiste; trailing se activa por umbral en ConfigTab | Eliminado; tarjeta trailing ahora es informativa con redirect a Configuración |
| `exitState` useEffect (simulado) | Datos hardcoded falsos (PnL: 2.5%, etc.) | Eliminado; redirige a Ciclos abiertos para estado real |
| "Estado Actual de Protecciones" Card | Mostraba datos simulados como reales | Eliminado |

**Controles que se conservan en SalidasTab (persisten a backend):**
- `breakEvenEnabled` → `breakevenEnabled` via `updateConfig.mutateAsync`
- `takeProfitPct` → `takeProfitPct` via `updateConfig.mutateAsync`
- `dynamicTpEnabled` → `dynamicTakeProfit` via `updateConfig.mutateAsync`

### AvanzadoTab.tsx

| Sección eliminada | Motivo |
|---|---|
| Tab "Migración" completo | `migrationStatus` useEffect con datos simulados; botones sin endpoint backend |
| Tab "Salud Sistema" completo | `systemHealth` useEffect con datos simulados |
| Tab "Notificaciones" completo | Todos los toggles Telegram locales, no persisten en ningún backend |
| `maxCapitalPerCycle` Input | No existe en schema DB, no persiste |
| `maxDailyTrades` Input | No existe en schema DB, no persiste |
| `logRetentionDays` Slider | No persiste |
| `enableDetailedLogging` / `enablePerformanceMetrics` Switches | No persisten |

**Controles que se conservan en AvanzadoTab (persiste a backend):**
- `cooldownMinutesBetweenBuys` → `cooldownMinutesBetweenBuys` via `updateConfig.mutateAsync`

**Estructura simplificada:** De 4 sub-tabs (General/Migración/Salud/Notificaciones) a layout plano con 1 card + 3 alertas de redirección.

### EjecucionTab.tsx

| Sección eliminada | Motivo |
|---|---|
| `executionState` useEffect (simulado) | Datos hardcoded falsos (activeOrders: 0, avgExecutionTime: 1250ms) |
| "Estado Actual de Ejecución" Card | Mostraba datos simulados como reales |
| `diagnostics` useEffect (simulado) | Datos hardcoded falsos con recomendaciones fake |
| "Diagnóstico de Ejecución" Card | Mostraba diagnóstico simulado sin conexión real |

**Controles que se conservan en EjecucionTab (persisten a backend):**
- Sección "Costes de ejecución — Revolut X": `executionFeesJson` via `updateIdcaConfig.mutateAsync`
- Sección "Estrategia de ejecución": Marcada claramente como "Preview — no afecta runtime"

### InstitutionalDca.tsx — ConfigTab (par enabled)

| Cambio | Antes | Ahora |
|---|---|---|
| Par enabled en ConfigTab | `ToggleField` editable (duplicidad con ControlsBar) | Badge read-only + nota "Editar en barra de controles superior" |
| Fuente única de verdad | Ambiguado entre ConfigTab y ControlsBar | **ControlsBar** (single source of truth) |

---

## C) Mapa de Eventos

### Eventos útiles (deben mostrarse por defecto)

| Event type | Categoría | Descripción | Dónde mostrar |
|---|---|---|---|
| `cycle_started` | Compra | Ciclo abierto con compra base | Ciclos abiertos + Alertas |
| `base_buy_executed` | Compra | Orden base ejecutada | Ciclos abiertos + Alertas |
| `safety_buy_executed` | Compra | Safety order ejecutada | Ciclos abiertos + Alertas |
| `tp_armed` | Salida | TP armado | Ciclos abiertos + Alertas |
| `trailing_activated` | Salida | Trailing activado | Ciclos abiertos + Alertas |
| `trailing_exit` | Salida | Salida por trailing | Historial + Alertas |
| `breakeven_exit` | Salida | Salida por break-even | Historial + Alertas |
| `protection_armed` | Salida | Break-even armado | Ciclos abiertos |
| `buy_blocked` | Bloqueo | Compra rechazada | Alertas |
| `critical_error` | Error | Error crítico del módulo | Alertas |
| `GRID_PLAN_CREATED` | Grid | Plan grid creado | Hybrid/Grid |
| `GRID_LEVEL_PLANNED` | Grid | Nivel planificado | Hybrid/Grid |
| `GRID_LEVEL_TRIGGERED_SIMULATED` | Grid | Compra simulada activada | Hybrid/Grid + Alertas |
| `GRID_LEVEL_TP_SIMULATED` | Grid | TP simulado alcanzado | Hybrid/Grid + Alertas |
| `GRID_PLAN_CANCELLED` | Grid | Plan cancelado | Hybrid/Grid |
| `smart_adjustment_applied` | Sistema | Ajuste smart aplicado | Alertas |
| `module_max_drawdown_reached` | Riesgo | Drawdown máximo alcanzado | Alertas |

### Eventos repetitivos (deben agruparse/colapsarse)

| Event type | Motivo | Acción |
|---|---|---|
| `cycle_under_monitoring` / heartbeat | Se repite cada tick del scheduler | Agrupar: "N eventos de seguimiento ocultos" |
| `scheduler_tick` | Cada tick del scheduler | Ocultar por defecto |
| `market_data_refresh` | Refresh de datos de mercado | Ocultar por defecto |
| `vwap_anchor_unchanged` | Ancla VWAP sin cambios | Ocultar por defecto |

### Eventos técnicos (solo en Avanzado/Terminal)

| Event type | Motivo |
|---|---|
| `debug_*` | Debug interno |
| Eventos con `severity: "debug"` | No mostrar en vista operativa |
| Eventos con `state_after: null` antiguos | Sin estado final, solo histórico |

### Eventos que deben ir solo a histórico

| Event type | Motivo |
|---|---|
| `cycle_closed` | Ciclo cerrado — va a Historial |
| `emergency_close` | Cierre de emergencia — va a Historial |
| `manual_close` | Cierre manual — va a Historial |
| `max_duration` | Duración máxima alcanzada — va a Historial |

---

## D) Propuesta Final de Navegación

### Arquitectura propuesta: 7 pestañas principales

| # | Pestaña | Tab key | Contenido | Componentes migrados |
|---|---|---|---|---|
| 1 | **Panel** | `panel` | Vista ejecutiva: estado IDCA, modo, hybrid, grid, KPIs, alertas críticas, ciclos activos resumidos | `SummaryTab` (simplificado) + `HealthBadge` + `ControlsBar` |
| 2 | **Ciclos abiertos** | `open-cycles` | Solo ciclos activos/abiertos como tarjetas grandes con Grid Observer embebido | `CyclesTab` (filtrado a activos) + `CycleDetailRow` + `IdcaCycleGridOverlay` |
| 3 | **Configuración** | `config` | Sub-pestañas: General, Entradas, Salidas, Protección, Hybrid/Grid, Avanzado | `ConfigTab` + `AdaptiveTab` fusionados |
| 4 | **Hybrid/Grid** | `hybrid` | Estado hybrid, régimen, grid observer por ciclo, eventos del plan, config avanzada | `IdcaHybridPanel` (renombrado de "Mejoras") |
| 5 | **Historial** | `history` | Ciclos cerrados, órdenes pasadas, filtros por modo/par/fecha | `HistoryTab` (sin cambios mayores) |
| 6 | **Alertas** | `alerts` | Telegram config, alertas operativas, alertas errores, alertas Grid/Hybrid, cooldowns | `TelegramTab` + alertas híbridas de `IdcaHybridPanel` |
| 7 | **Ayuda** | `help` | Glosario, buscador, bloques plegables, FAQ, explicación Grid Observer | `LegendTab` + `GuideTab` fusionados |

### Migración de pestañas eliminadas

| Pestaña actual | Destino |
|---|---|
| Resumen | → Panel (simplificado) |
| Config | → Configuración (sub-tab General + otros) |
| Adaptativo | → Configuración (sub-tabs Entradas, Salidas, Protección) |
| Ciclos | → Ciclos abiertos (solo activos) + Historial (cerrados) |
| Historial | → Historial (sin cambios) |
| Leyenda | → Ayuda (fusionado con Guía) |
| Simulación | → Panel (KPIs wallet) o sub-tab dentro de Configuración → General |
| Eventos | → Integrar en Ciclos abiertos (eventos del ciclo), Hybrid/Grid (eventos grid), Historial (histórico completo), Alertas (eventos que requieren atención) |
| Telegram | → Alertas |
| Guía | → Ayuda (fusionado con Leyenda) |
| Mejoras | → Hybrid/Grid (renombrado) |

### Sub-pestañas de Configuración propuesta

| Sub-tab | Contenido | Origen |
|---|---|---|
| General | IDCA on/off, modo, capital, exposición, scheduler, pares | ConfigTab → General + ControlsBar (referencia) |
| Entradas | Min dip, rebound, ladder ATRP, trailing buy, VWAP/ancla, distancia dinámica | ConfigTab → Compras + AdaptiveTab → Entradas + ConfigTab → Ancla/VWAP + Distancia |
| Salidas | TP, break-even, trailing, fail-safe, Smart Exit | AdaptiveTab → Salidas + ConfigTab (BE/trailing config) |
| Protección | Exposición máxima, límites por par, stale data, spread, chase, bloqueo tendencias | ConfigTab → General (exposición/drawdown) |
| Hybrid/Grid | idcaHybridMode, executionScope, maxGridLevels, maxGridCapitalPctOfCycle, gridEnabled, meanReversionEnabled, doNotRewriteAnchor | IdcaHybridPanel → Config avanzada |
| Avanzado | Parámetros técnicos, JSON/raw config, Plus/Recovery | AdaptiveTab → Avanzado + ConfigTab → Plus/Recovery |

### Layout propuesto

- **Ancho máximo:** `max-w-[1920px]` (actual: `max-w-[1600px]`)
- **Grid:** 2 columnas en desktop para tarjetas de ciclos y KPIs
- **Tablas:** Full-width con scroll horizontal si necesario
- **Responsive:** Mantiene grid-cols-2 en tablet, 1 columna en móvil

---

## E) Traducción Centralizada de Estados Propuesta

Crear archivo: `client/src/components/idca/idcaStateLabels.ts`

| Código técnico | Traducción UI |
|---|---|
| `GRID_PLAN_SIMULATED` | Grid planificado en observador |
| `GRID_LEVEL_PLANNED` | Nivel planificado |
| `GRID_BLOCKED_MANUAL_CYCLE` | Grid no aplicado por seguridad |
| `GRID_BLOCKED_IMPORTED_CYCLE` | Grid no aplicado por ciclo importado |
| `GRID_BLOCKED_BEAR_TREND` | Grid pausado por tendencia bajista |
| `GRID_BLOCKED_DATA_QUALITY` | Grid pausado por datos insuficientes |
| `GRID_BLOCKED_CAPITAL_LIMIT` | Grid pausado por límite de capital |
| `OBSERVING_ACTIVE_CYCLE` | Observando ciclo activo |
| `OBSERVING_IMPORTED_CYCLE` | Observando ciclo importado |
| `OBSERVING_MANUAL_CYCLE` | Observando ciclo manual |
| `ASSISTED_PROPOSAL_READY` | Propuesta asistida lista |
| `observer_only=true` | Observador, sin órdenes reales |
| `doNotRewriteAnchor=true` | Protege ancla y parámetros históricos |
| `GRID_INACTIVE` | Sin grid activo |
| `planned` | Planificado |
| `armed` | Vigilando |
| `triggered` | Activado |
| `closed` | Cerrado |
| `cancelled` | Cancelado |
| `inactive` | Inactivo |

Los códigos técnicos solo deben aparecer en **Configuración → Avanzado**.

---

## F) Observaciones Adicionales

### Problemas visuales confirmados

1. **Columna estrecha:** `max-w-[1600px]` con contenido centrado deja mucho espacio vacío en pantallas grandes. Aumentar a `max-w-[1920px]` o eliminar el límite en desktop.

2. **11 pestañas en una fila:** `grid-cols-5 md:grid-cols-11` — en móvil se ven 5 por fila (3 filas), en desktop 11 en una fila. Demasiado comprimido. Reducir a 7 pestañas.

3. **"Mejoras" es incorrecto:** Hybrid/Grid es una capa operativa importante, no "mejoras". Debe renombrarse y posicionarse cerca de Configuración.

4. **Guía es documentación inline:** ~250 líneas de documentación técnica que debería ser ayuda plegable, no una pestaña operativa.

5. **Leyenda y Guía solapan:** Ambas explican conceptos. Leyenda focuses en VWAP/Hybrid datos, Guía focuses en IDCA general. Deben fusionarse.

6. **Config y Adaptativo solapan:** Config tiene parámetros generales y por par. Adaptativo también tiene parámetros por par (entradas, salidas, ejecución). Deben fusionarse.

7. **Ciclos mezcla activos y cerrados:** `CyclesTab` tiene filtro `all/active/closed` pero por defecto muestra "all". Debería separarse.

8. **Eventos es vertedero:** 4 sub-pestañas (Live, Events, Terminal, Logs) con mucha información repetitiva. Debe distribuirse.

9. **Grid Observer no muestra "NO hay orden real":** `IdcaCycleGridOverlay` muestra badge "OBSERVADOR" pero no dice explícitamente "NO hay orden real" o "Solo simulación".

10. **"6 legs técnicas" visible:** `IdcaCycleGridOverlay` muestra `plan.totalLegsCount` que confunde al usuario. Debería mostrar "3 niveles de compra + 3 TP vinculados".

11. **Estados técnicos visibles:** Eventos muestran `GRID_PLAN_SIMULATED`, `GRID_LEVEL_PLANNED` etc. directamente. Deben traducirse.

12. **Simulación desconectada:** `SimulationTab` muestra wallet virtual pero no se relaciona visualmente con el resto del sistema.

### Confirmaciones de seguridad

- **No se toca lógica de trading:** motor de compras, ventas, IDCA, Smart Exit, TimeStop, trailing, break-even, anclas, basePrice, órdenes reales.
- **No se activa modo real:** `idcaHybridMode` se mantiene en `observer`, `executionScope` se mantiene en `observer`, `observer_only` se mantiene en `true`, `doNotRewriteAnchor` se mantiene en `true`.
- **No se cambian parámetros del bot:** `bot_config` y parámetros actuales no se modifican.
- **No se eliminan funcionalidades:** solo se reubican y reorganizan componentes.

---

## G) Plan de Implementación por Fases

### Fase B — Navegación (commit 1)
- Renombrar "Mejoras" → "Hybrid/Grid"
- Crear pestaña "Ciclos abiertos" (filtrar CyclesTab a activos)
- Fusionar "Leyenda" + "Guía" → "Ayuda"
- Mover "Telegram" → "Alertas"
- Renombrar "Resumen" → "Panel"
- Fusionar "Config" + "Adaptativo" → "Configuración" con sub-pestañas
- Mover "Simulación" → sub-tab dentro de Panel o Configuración
- Distribuir "Eventos" en Ciclos abiertos, Hybrid/Grid, Historial, Alertas
- Mantener componentes antiguos compatibles

### Fase C — Grid visual (commit 2)
- Rehacer `IdcaCycleGridOverlay` con estado explícito "NO hay orden real"
- Mostrar "3 niveles de compra + 3 TP vinculados" (no "6 legs")
- Añadir PnL simulado realizado/no realizado
- Añadir "Falta para activar" con % distancia
- Añadir explicación visible "Esto es simulación"
- Eventos del plan actual por defecto

### Fase D — Configuración (commit 3)
- Fusionar Config + Adaptativo visualmente con 6 sub-pestañas
- Cada parámetro editable en un solo sitio
- Otros sitios: solo lectura

### Fase E — Historial/Eventos (commit 4)
- Separar eventos operativos, históricos y alertas
- Agrupar ruido ("N eventos repetidos ocultos")
- Filtros por modo/par/fecha en Historial

### Fase F — Traducción centralizada (commit 5 o incluido en B)
- Crear `idcaStateLabels.ts`
- Aplicar traducciones en todos los componentes
- Códigos técnicos solo en Avanzado

### Fase G — Responsive/ancho (incluido en B)
- Aumentar `max-w` a 1920px
- Cards más amplias, tablas legibles
- Grid de 2 columnas cuando proceda

---

## H) Tests de Validación

| Test | Descripción |
|---|---|
| "Mejoras" no aparece como pestaña | Verificar que el tab "hybrid" se llama "Hybrid/Grid" |
| "Hybrid/Grid" aparece | Verificar tab "hybrid" con label correcto |
| "Ciclos abiertos" aparece | Verificar tab "open-cycles" |
| "Ayuda" aparece (no "Leyenda" ni "Guía") | Verificar tab "help" |
| "Configuración" aparece (no "Config" ni "Adaptativo") | Verificar tab "config" |
| "Alertas" aparece (no "Telegram") | Verificar tab "alerts" |
| Grid Observer muestra "Orden real Grid abierta: NO" | Cuando observer_only=true |
| Grid muestra "3 niveles + 3 TP" (no "6 niveles") | En IdcaCycleGridOverlay |
| Eventos del Grid muestran solo plan actual por defecto | No histórico completo |
| `idcaHybridMode` no cambia | Seguir observer |
| `executionScope` no cambia | Seguir observer |
| `doNotRewriteAnchor` sigue true | No se modifica |
| Modo real no se activa | No hay botón que active real sin confirm |

---

**Fin del documento de auditoría.**
