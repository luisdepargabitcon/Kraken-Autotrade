# AUDITORÍA AMA UX PORTFOLIO TRUE FINAL — 2026-08-08

## Hallazgos Iniciales

### AMA UI

- **Enums internos visibles**: Los modos (`OFF`, `LAB`, `REPLAY`, `SHADOW_SCENARIO`, `SHADOW_LIVE`, `REAL_LIMITED`, `REAL_FULL`) se muestran directamente sin traducción al usuario.
- **Mezcla español/inglés**: Etiquetas como "Tranche", "Fill", "Sleeve", "High Water Mark", "Cycle Low", "Shadow", "Replay" no están traducidas.
- **Poca explicación**: No hay guía de qué hace cada modo ni comparación entre ellos.
- **Visualmente básica**: Cards simples sin jerarquía visual, sin gráficos, sin hero.
- **Banners obsoletos**: "FASE DE CONSTRUCCIÓN", "DATOS PROVISIONALES", "REAL BLOQUEADO" son estados falsos.
- **Modos poco comprensibles**: Lab/Replay/Shadow difíciles de distinguir para el usuario.
- **Lab UI**: Solo input manual de texto libre para scenarioName, sin presets visuales.
- **Replay UI**: Pestaña llamada "Replay" en inglés, sin explicación.
- **Shadow UI**: Una sola pestaña genérica que mezcla Escenario y Vivo.
- **Real UI**: Estados en inglés (`NOT_READY`, `ARMED`, `ACTIVE`, etc.), botones mezclados.

### Runtime

- **Lab no completa end-to-end**: `startLabSession` inserta en DB con status `RUNNING` pero el motor `simulateLabScenario` no se invoca automáticamente. Falta runner asíncrono.
- **Replay no ejecuta automáticamente**: `startReplayRun` inserta con status `QUEUED` pero `executeReplayRun` no se invoca. Falta runner asíncrono.
- **Shadow readiness**: `checkShadowReadiness` recibe parámetros booleanos pero no consulta datos reales (HWM, budget, precio, coverage).
- **Market View**: `getMarketView` devuelve null en todos los campos de mercado. No hay conexión con Kraken/MarketDataService.
- **Mandato/policy**: No hay persistencia de mandato en DB. `getMandate()` devuelve null.
- **REAL state machine**: `operationalState` no se persiste en DB. Solo en memoria.

### Portfolio

- **PortfolioGlobalService**: Totalmente in-memory (`Map`, arrays). No persistente.
- **ReservationCoordinator**: In-memory (`Map`).
- **Snapshots**: Array in-memory. `takeSnapshot([])` recibe valuations vacías.
- **Holdings**: Array in-memory.
- **Ledger**: Array in-memory.
- **AMA portfolio paralelo**: AMA tiene `amaPortfolio.ts` y `amaPortfolioLedger.ts` independientes del Portfolio Global.
- **No única source of truth**: Dos sistemas de portfolio paralelos.
- **Wallet**: Muestra exchange balances pero sin atribución por estrategia.
- **Cartera Global no gobierna**: No integra AMA/GRID/IDCA/Trading.
- **FISCO en StrategyMode**: FISCO aparece como modo operativo cuando debería ser solo reporting.
- **Detección doble conteo**: Heurística simple, no invariantes reales.

### Migraciones

- **Libres**: 084 y 085 están disponibles.
- **Aplicador**: `ama_apply_staging_migrations.mjs` necesita incluir las nuevas migraciones.
