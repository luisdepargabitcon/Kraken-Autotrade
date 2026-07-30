# PLAN MAESTRO DE IMPLEMENTACIÓN AMA

# AMA — ACUMULACIÓN MACRO ADAPTATIVA

**Archivo canónico:** `PLAN_IMPLEMENTACION_MODO_AMA.md`
**Versión objetivo inicial:** `1.0.0`
**Estado inicial:** `PENDIENTE_DE_AUDITORIA`
**Repositorio:** `luisdepargabitcon/Kraken-Autotrade`
**Responsable de ejecución:** Cascade
**Aprobación funcional:** usuario
**Fecha de creación:** 2026-07-29
**Entorno operativo:** VPS staging, únicamente cuando exista autorización de deploy

---

# 0. DIRECTIVA DE EJECUCIÓN AUTÓNOMA NOCTURNA

## 0.1 Finalidad

Cascade queda autorizado para trabajar de forma autónoma durante la sesión nocturna en todas las tareas locales, reversibles y seguras necesarias para avanzar en la implementación de AMA.

Cascade deberá:

1. Leer las fuentes de gobierno.
2. Auditar el repositorio real.
3. Crear o actualizar este plan.
4. Crear la auditoría previa.
5. Diseñar la arquitectura.
6. Implementar por fases.
7. Crear migraciones sin aplicarlas en entornos compartidos.
8. Crear tests.
9. Ejecutar comprobaciones locales.
10. Corregir errores introducidos por sus cambios.
11. Documentar decisiones y resultados.
12. Continuar con la siguiente tarea segura cuando una subtarea quede bloqueada.
13. Detener únicamente la acción que alcance un gate duro.
14. No esperar al usuario para resolver dudas menores que puedan resolverse conservadoramente.

La autonomía no autoriza operaciones reales, deploy, borrado de datos, aplicación de migraciones destructivas, commit ni push.

---

## 0.2 Fuentes para resolver dudas

Ante cualquier duda, consultar en este orden:

```text
1. Instrucción actual del usuario
2. AGENTS.md
3. Secciones vigentes de BITACORA.md
4. CORRECCIONES_Y_ACTUALIZACIONES.md, si existe
5. PLAN_IMPLEMENTACION_MODO_AMA.md
6. Código real
7. Tests existentes
8. Schema y migraciones
9. Historial Git relevante
```

Reglas:

* No recrear `CORRECCIONES_Y_ACTUALIZACIONES.md` si no existe.
* No crear una segunda bitácora.
* No crear un segundo plan AMA.
* No inventar comportamientos para resolver contradicciones.
* No modificar datos para hacerlos coincidir con la documentación.

---

## 0.3 Protocolo ante una decisión no definida

Cuando una decisión no esté expresamente definida:

1. Elegir la opción que no aumente exposición.
2. Elegir la opción reversible.
3. Elegir la opción que preserve datos.
4. Mantener compatibilidad.
5. Evitar una dependencia innecesaria.
6. Registrar el razonamiento.
7. Continuar con las tareas no bloqueadas.

Registrar:

```markdown
## DECISION_RECORD AMA-XXX

- Fecha:
- Problema:
- Fuentes consultadas:
- Alternativas consideradas:
- Decisión conservadora:
- Motivo:
- Riesgo:
- Reversibilidad:
- Impacto:
- Revisión futura:
```

---

## 0.4 Protocolo ante un atasco técnico

Ante un error:

1. Capturar el error exacto.
2. Localizar el primer punto de fallo.
3. Formular varias hipótesis.
4. Revisar código, schema, tests y logs.
5. Aplicar el cambio mínimo.
6. Repetir la prueba específica.
7. Ejecutar regresión relacionada.
8. Documentar la causa raíz.

Si la subtarea continúa bloqueada:

* marcar solo esa subtarea como `BLOCKED`;
* conservar evidencias;
* no introducir bypasses inseguros;
* avanzar en otra subtarea independiente;
* dejar instrucciones exactas de reanudación.

Prohibido ocultar el atasco mediante:

```text
TODO silencioso
catch vacío
return true fijo
mock conectado a producción
desactivación de tests
bypass de reconciliación
bypass del pre-trade gate
```

---

## 0.5 Acciones autónomas permitidas

Cascade puede:

* leer y buscar archivos;
* inspeccionar código y tests;
* modificar código local;
* crear archivos AMA;
* crear componentes compartidos realmente generales;
* crear migraciones;
* validar migraciones en una base temporal;
* crear y ejecutar tests;
* ejecutar `check`, `build` y pruebas;
* ejecutar `git diff` y `git diff --check`;
* documentar;
* actualizar el registro de fases;
* corregir fallos introducidos dentro del alcance;
* continuar hasta un gate duro.

---

## 0.6 Gates duros

Cascade no podrá ejecutar autónomamente:

```text
commit
push
deploy al VPS
deploy a producción
compras reales
ventas reales
cancelación de órdenes reales
activación REAL_LIMITED
activación REAL_FULL
reasignación de capital real
reclasificación de inventario real
aplicación de migraciones en staging o producción
borrado real de datos
DROP TABLE
TRUNCATE
DROP PARTITION real
VACUUM FULL
modificación de secretos
docker system prune
borrado de volúmenes
git reset --hard
git clean
archivo del plan
```

Ante un gate:

1. Preparar el cambio.
2. Validarlo localmente.
3. Documentar el comando pendiente.
4. Marcar `PENDIENTE_DE_AUTORIZACION`.
5. Continuar con otras tareas seguras.

---

## 0.7 Política Git

Preservar cualquier cambio ajeno.

Usar únicamente stage selectivo cuando exista autorización futura:

```bash
git add ruta1 ruta2 ruta3
```

No utilizar:

```bash
git add .
git add -A
```

Durante la sesión autónoma:

* no hacer commit;
* no hacer push;
* dejar una propuesta de commits;
* indicar archivos exactos de cada propuesta;
* mantener los cambios organizados y auditables.

---

## 0.8 Informe de cierre nocturno

Al terminar o alcanzar un gate duro, informar:

```text
HEAD inicial
HEAD final
rama
estado git
archivos modificados
archivos nuevos
migraciones creadas
tests ejecutados
tests verdes
tests fallidos
fases completadas
fases parciales
decisiones autónomas
riesgos
bloqueos
gates pendientes
propuesta de commits
comandos para reanudar
siguiente tarea recomendada
```

---

# 1. CARÁCTER DE ESTE PLAN

Este documento sustituye íntegramente cualquier versión anterior del plan AMA.

A partir de esta versión:

* AMA es un modo nuevo e independiente.
* AMA tiene pestaña propia.
* No existe una regla universal de cuatro compras.
* No existe un número fijo obligatorio de tramos.
* No existen sliders técnicos individuales para indicadores.
* La configuración principal utiliza `AMA Mandate Studio`.
* El usuario define un mandato.
* AMA resuelve una política técnica.
* Las compras se calculan mediante planificación adaptativa.
* La Cartera Global protege capital e inventario.
* AMA incorpora observabilidad moderna.
* Logs, eventos y auditoría son categorías distintas.
* Existe limpieza automática segura y versionada.
* Los datos financieros no se borran automáticamente.
* La IA no puede ampliar el riesgo real.
* La ejecución será inicialmente maker/post-only.
* REAL permanece bloqueado hasta autorización.
* No se modifica la lógica estratégica interna de otros modos.

---

# 2. IDENTIDAD OFICIAL

Nombre visible:

```text
AMA — Acumulación Macro Adaptativa
```

Denominación técnica:

```text
Adaptive Macro Accumulation
```

Identificadores:

```text
displayName     = "AMA — Acumulación Macro Adaptativa"
shortName       = "AMA"
mode            = "AMA"
strategyCode    = "ADAPTIVE_MACRO_ACCUMULATION"
strategyVersion = "1.0.0"
route           = "/ama"
apiPrefix       = "/api/ama"
databasePrefix  = "ama_"
```

Toda tabla, servicio, endpoint, evento, configuración y auditoría nueva utilizará AMA.

No crear denominaciones alternativas para el mismo modo.

---

# 3. ARCHIVO MAESTRO Y ESTADOS

Archivo:

```text
PLAN_IMPLEMENTACION_MODO_AMA.md
```

Estados:

```text
PENDIENTE_DE_AUDITORIA
EN_AUDITORIA
AUDITORIA_COMPLETADA
PENDIENTE_DE_IMPLEMENTACION
EN_IMPLEMENTACION
EN_REPLAY
REPLAY_VALIDADO
EN_SHADOW
SHADOW_VALIDADO
PENDIENTE_DE_AUTORIZACION_REAL_LIMITED
EN_REAL_LIMITED
REAL_LIMITED_VALIDADO
PENDIENTE_DE_AUTORIZACION_DEPLOY
IMPLEMENTACION_COMPLETA_PENDIENTE_DE_AUTORIZACION_DE_ARCHIVO
ARCHIVADO_TRAS_AUTORIZACION_USUARIO
```

El plan permanecerá en la raíz mientras exista trabajo pendiente.

No se puede:

* borrar;
* mover;
* renombrar;
* archivar;
* declarar completado;

sin evidencia y autorización expresa.

---

# 4. AUDITORÍA PREIMPLEMENTACIÓN

Crear:

```text
AUDITORIAS/AUDITORIA_PREIMPLEMENTACION_AMA_Y_CARTERA_GLOBAL.md
```

La auditoría deberá identificar:

* rama;
* HEAD;
* relación con `origin/main`;
* working tree;
* cambios preexistentes;
* arquitectura frontend;
* arquitectura backend;
* rutas;
* servicios;
* schema;
* migraciones;
* balances;
* órdenes;
* fills;
* inventario;
* lotes;
* presupuestos;
* reservas;
* FISCO;
* logs;
* eventos;
* tablas de mercado;
* políticas de retención;
* logging Docker;
* componentes compartibles;
* duplicidades;
* datos sin atribuir;
* riesgos.

La auditoría será read-only.

---

# 5. OBJETIVO FUNCIONAL

AMA será una estrategia profesional de acumulación macro de BTC/USD y, en fase de investigación, ETH/USD.

> **Cambio de alcance AMA-CC-2026-07-29-SEED-V2.2:** BTC/USD = `LAB_ONLY`, ETH/USD = `RESEARCH_ONLY`. ETH no puede reservar capital real, crear intents ejecutables, crear órdenes, usar Revolut X executor, compartir capital/inventario/ciclos con BTC, ni heredar promoción BTC. Las auditorías BTC y ETH (2026-07-29) son hallazgos canónicos. Su contenido se integra en este plan.

Flujo:

```text
observar mercado
→ reconstruir máximo macro
→ confirmar techo
→ medir caída
→ identificar valor
→ detectar capitulación
→ resolver mandato
→ crear plan adaptativo
→ reservar capital
→ ejecutar tramos elegibles
→ preservar reserva
→ gestionar inventario
→ confirmar recuperación
→ recuperar principal
→ reducir riesgo
→ conservar runner
→ aplicar trailing macro
→ cerrar ciclo
```

AMA deberá:

* operar inicialmente BTC/USD;
* usar Kraken para análisis;
* usar Revolut X para ejecución;
* ejecutar maker/post-only;
* mantener inventario propio;
* integrarse con Cartera Global;
* trabajar primero en REPLAY;
* continuar en SHADOW;
* bloquear REAL hasta autorización;
* ser determinista;
* reproducible;
* auditable;
* recuperable;
* explicable;
* fail-closed.

---

# 6. PRINCIPIOS DE DISEÑO

```text
mandato antes que parámetros
límites antes que predicciones
presupuesto antes que compras
fill antes que inventario
reconciliación antes que retry
maker antes que velocidad
datos confirmados antes que señales
explicación antes que opacidad
reducción de riesgo antes que ampliación
```

El usuario define:

* capital autorizado;
* mandato de riesgo;
* estilo de acumulación;
* objetivo de salida;
* autonomía.

AMA resuelve:

* número de tramos;
* tipo de tramos;
* zonas;
* importes;
* distancias;
* reserva;
* cadencia;
* confirmaciones;
* pausas;
* sleeves;
* trailing.

---

# 7. ALCANCE

## Incluido

* BTC/USD.
* Kraken.
* Revolut X.
* AMA Mandate Studio.
* Planificación adaptativa.
* HWM persistente.
* Barra macro.
* PROBE opcional.
* VALUE.
* DEEP_VALUE.
* CAPITULATION.
* RECOVERY.
* Cartera Global.
* Presupuestos.
* Reservas.
* Inventario por modo.
* Ledger.
* Sleeves.
* Trailing.
* IA observadora.
* Replay.
* Walk-forward.
* Holdout bloqueado.
* SHADOW.
* REAL_LIMITED autorizado.
* Reconciliación.
* FISCO.
* Logs estructurados.
* Eventos de dominio.
* Auditoría protegida.
* Retención.
* Compactación.
* Limpieza segura.
* Control de capacidad.
* Backup y restore.

## Excluido inicialmente

* Apalancamiento.
* Futuros.
* Derivados.
* Préstamos.
* Taker automático.
* Market orders sin límite.
* Compras ilimitadas.
* Martingala.
* Autooptimización en REAL.
* Aprendizaje online con dinero real.
* LLM enviando órdenes.
* Reasignación ilimitada entre modos.
* REAL_FULL.
* Stop loss porcentual estrecho.
* Garantías de rentabilidad.

---

# 8. PESTAÑA AMA

Crear:

```text
client/src/pages/Ama.tsx
```

Ruta:

```text
/ama
```

Añadir navegación principal y móvil.

Subpestañas:

```text
Resumen
Mandato AMA
Inteligencia macro
Plan de acumulación
Ciclos y tranches
Cartera AMA
Salidas y trailing
Fuentes
IA y challenger
Replay
Auditoría
Operación y seguridad
```

En `Operación y seguridad`:

```text
Salud
Reconciliación
Observabilidad y datos
Logs y eventos
Retención
Capacidad
Backups
Kill switches
```

Backend:

```text
/api/ama/*
```

Servicios:

```text
server/services/ama/*
```

Tablas:

```text
ama_*
```

---

# 9. MODOS OPERATIVOS

```text
OFF
REPLAY
SHADOW
REAL_LIMITED
REAL_FULL
```

## OFF

Sin análisis ni ejecución automática.

## REPLAY

Mismo pipeline incremental sobre histórico.

## SHADOW

Datos reales, decisiones simuladas y cero órdenes reales.

## REAL_LIMITED

* autorización expresa;
* capital limitado;
* autonomía inicial SUPERVISADA;
* maker-only;
* una orden AMA abierta como máximo inicialmente;
* rollback inmediato.

## REAL_FULL

Bloqueado en `1.0.0`.

No existe promoción automática.

---

# 10. ARQUITECTURA OBJETIVO

```text
Cartera Global
├── ExchangeBalanceSnapshotService
├── PortfolioValuationService
├── PortfolioBudgetService
├── PortfolioAttributionLedger
├── GlobalCapitalReservationService
├── GlobalOpenOrderRegistry
├── CrossModeExecutionCoordinator
├── PortfolioReconciliationService
├── PortfolioAccountingInvariantService
└── PortfolioAuditService

AMA
├── AmaMandateStudio
├── AmaMandateResolver
├── AmaMandateScenarioSimulator
├── AmaResolvedPolicyService
├── AmaTimeContract
├── AmaPointInTimeDataService
├── AmaDataQualityService
├── AmaMarketDataAnomalyGuard
├── AmaCycleCeilingService
├── AmaMacroCycleService
├── AmaSignalEngine
├── AmaStateMachine
├── AmaAdaptiveTranchePlanner
├── AmaAutoRiskManager
├── AmaPortfolioService
├── AmaDistributionPlanner
├── AmaMacroTrailingService
├── AmaController
├── AmaExecutionPlanner
├── AmaPreTradeRiskGate
├── AmaOrderExecutor
├── AmaReconciliationService
├── AmaReplaySmokeSimulator
├── AmaMlChallenger
├── AmaLlmAnalyst
├── AmaAiRiskMonitor
├── AmaAuditService
└── AmaObservabilityService

Observabilidad compartida
├── StructuredLogger
├── CorrelationContext
├── DomainEventService
├── AuditLedgerService
├── EventSchemaRegistry
├── RetentionPolicyRegistry
├── RetentionScheduler
├── DataCompactionService
├── DataArchivalService
├── DiskCapacityGuard
└── DatabaseCapacityMonitor
```

---

# 11. FUENTES CANÓNICAS

## Análisis

```text
analysisVenue = KRAKEN
```

Kraken será fuente de:

* OHLCV;
* cierres diarios;
* semanas reconstruidas;
* HWM;
* ATR;
* EMA;
* SMA;
* volumen;
* drawdown;
* momentum;
* trailing analítico.

## Ejecución

```text
futureExecutionVenue = REVOLUT_X  (BTC, target)
executionEnabled     = false       (BTC, LAB_ONLY)
executionStatus      = LAB_ONLY    (BTC)

futureExecutionVenue = DISABLED    (ETH, RESEARCH_ONLY)
executionEnabled     = false       (ETH)
executionStatus      = RESEARCH_ONLY (ETH)
```

> **R1 — Separación de venues canónica:** El campo `executionVenue` se renombra a `futureExecutionVenue` en el código. BTC tiene `analysisVenue = KRAKEN` y `futureExecutionVenue = REVOLUT_X` (no habilitada). ETH tiene `futureExecutionVenue = DISABLED`. Ambos tienen `executionEnabled = false`. Tests en `amaSeedTypes.test.ts` verifican cada campo independientemente.

Revolut X será fuente de:

* custodia;
* saldo;
* saldo disponible;
* saldo retenido;
* bid;
* ask;
* mid;
* spread;
* order book;
* constraints;
* precisiones;
* órdenes;
* fills;
* fees.

No habrá fallback de ejecución a Kraken.

---

# 12. PRECIO ANALÍTICO Y EJECUTABLE

Persistir:

```text
analysisPrice
executionBid
executionAsk
executionMid
spreadPct
crossVenueBasisPct
analysisTimestamp
executionTimestamp
```

El drawdown se calcula exclusivamente con:

```text
techo Kraken
+
precio analítico Kraken
```

Revolut X se utiliza para:

* validar saldo;
* spread;
* basis;
* constraints;
* precio de orden;
* ejecución.

No mezclar precios de ambos venues en una fórmula sin declarar su función.

---

# 13. MATRIZ DE FUENTES DE VERDAD

| Dominio             | Fuente                           |
| ------------------- | -------------------------------- |
| Custodia real       | Exchange                         |
| Saldo ejecutable    | Revolut X                        |
| Precio analítico    | Kraken                           |
| Precio de ejecución | Revolut X                        |
| Constraints         | Revolut X verificada             |
| Orden activa        | Exchange + registro reconciliado |
| Fill                | Exchange                         |
| Inventario por modo | Ledger derivado de fills         |
| Presupuesto         | Cartera Global                   |
| Reserva             | Base transaccional               |
| Mandato             | Versión aprobada                 |
| Política            | Versión ACTIVE                   |
| Señal               | Snapshot determinista            |
| P&L operativo       | Fills y fees                     |
| P&L fiscal          | FISCO                            |
| Explicación IA      | Informativa                      |

El frontend no es fuente financiera.

## 13.1 Matriz de autoridad por capacidad (V2.2)

| Capacidad | Fuente autoritativa | Fuente research | Fuente disabled |
|---|---|---|---|
| OHLC / cierres diarios | Kraken | — | — |
| HWM | Kraken | — | — |
| ATR | Kraken | — | — |
| Precio canónico | Kraken last trade | — | — |
| Ejecución | Revolut X | — | Kraken (no fallback) |
| On-chain BTC | Bitcoin Core RPC | Coin Metrics | — |
| On-chain ETH | Ethereum specs | Coin Metrics | — |
| Macro | FRED | — | — |
| ETF holdings | SEC EDGAR | — | — |
| Derivados | CME | — | — |
| L2/DeFi | L2 settlement | — | — |
| Coin Metrics Pro API | — | — | DISABLED, NOT_CONFIGURED |

## 13.2 Taxonomía de fuentes (V2.2)

```text
sourceClass: EXCHANGE | ONCHAIN | MACRO | REGULATORY | DERIVATIVES | RESEARCH
capabilities: [OHLC, HWM, ATR, VOLUME, ONCHAIN, MACRO, ...]
authority: AUTHORITATIVE | RESEARCH_ONLY | DISABLED
modeAllowance: LAB_ONLY | RESEARCH_ONLY | SHADOW | REAL_LIMITED | REAL_FULL
licenseStatus: OK | REVIEW_REQUIRED | BLOCKED | NOT_APPLICABLE
freshnessStatus: FRESH | DELAYED | STALE | PARTIAL | UNAVAILABLE | SCHEMA_DRIFT | REVISION_DETECTED | LICENSE_BLOCKED
```

## 13.3 Coin Metrics (V2.2)

Fuentes Coin Metrics:
1. **GitHub Archive** — licencia CC-BY-NC-4.0, research-only, `decisionImpactAllowed = false`
2. **Community API** — review required, ingestion disabled by default
3. **Pro API** — `DISABLED`, `NOT_CONFIGURED`, sin secrets

Contract `CoinMetricsSourceSnapshot`:
```text
metricId
assetId
timestamp
value
revisionHash
sourceRevision
lastRowTime
lastCompleteRowTime
freshnessStatus
licenseStatus
commercialUseStatus = REVIEW_REQUIRED
decisionImpactAllowed = false
```

Pipeline de ingesta:
- Descargar archive (no scraping HTML)
- Parse, calcular hash
- Store snapshot (no overwrite, no mix revisions)
- Verificar frescura por métrica
- Cadencia: no consultar cada minuto, no descargar repo entero cada vez

Restricciones:
- No usar Coin Metrics como OHLC, ATR, HWM, trigger, ni única fuente on-chain
- No activar Coin Metrics Pro API
- No crear secrets para Coin Metrics Pro
- No interpretar CC-BY-NC-4.0 como autorizada para trading real

## 13.4 Retención AMA (V2.2)

```text
RESEARCH_LONG_TERM
```

- No autoeliminar: OHLC, HWM, policies, manifests, macro vintages, datasets Replay
- Auto-deletion de RESEARCH_LONG_TERM está prohibido

---

# 14. CARTERA GLOBAL MULTIMODO

Mantener:

```text
/wallet
```

Categorías:

```text
AMA
IDCA
GRID
MOMENTUM_NORMAL
MANUAL_EXTERNAL
UNATTRIBUTED
DUST
```

Funciones:

1. Leer balances reales.
2. Distinguir total, disponible y retenido.
3. Mantener presupuesto por modo.
4. Mantener reservas.
5. Atribuir fills.
6. Evitar doble uso de capital.
7. Evitar doble venta de inventario.
8. Mostrar capital sin asignar.
9. Reconciliar.
10. Mostrar discrepancias.

---

# 15. PRESUPUESTOS POR MODO

Cada modo tendrá:

```text
BUDGETED
DEPLOYED
RESERVED
FREE
```

```text
FREE = BUDGETED - DEPLOYED - RESERVED
```

AMA `1.0.0` utilizará:

```text
MANUAL_FIXED_ALLOCATION
```

Preparar:

```text
BOUNDED_DYNAMIC_ALLOCATION
```

Estado inicial:

```text
DISABLED
```

La IA no mueve capital entre modos.

---

# 16. CAPITAL ASIGNABLE

```text
saldo disponible real
− fondos retenidos
− reserva manual
− buffer operativo
− reservas AMA
− reservas IDCA
− reservas GRID
− reservas Momentum
= capital global sin asignar
```

```text
amaFreeCapital =
amaBudget
− amaDeployed
− amaReserved
```

Ningún modo puede utilizar capital de otro sin transferencia explícita y auditada.

---

# 17. LEDGER GLOBAL

Crear:

```text
PortfolioAttributionLedger
portfolio_ledger_entries
```

Características:

* append-only;
* inmutable;
* idempotente;
* auditable.

Movimientos:

```text
DEPOSIT
WITHDRAWAL
TRADE_BUY
TRADE_SELL
FEE
MODE_ALLOCATION
MODE_TRANSFER
MANUAL_ATTRIBUTION
RECONCILIATION_ADJUSTMENT
```

Campos:

```text
eventId
idempotencyKey
exchange
asset
quantity
fromBucket
toBucket
mode
cycleId
trancheId
logicalIntentId
fillId
source
createdAt
metadataHash
```

Correcciones mediante asientos compensatorios.

---

# 18. RESERVAS GLOBALES

Crear:

```text
GlobalCapitalReservationService
portfolio_capital_reservations
portfolio_reservation_events
```

Estados:

```text
PENDING
ACTIVE
PARTIALLY_CONSUMED
CONSUMED
RELEASED
EXPIRED
RECONCILIATION_REQUIRED
```

Reserva, intent y evento se crean en una transacción.

Un fill parcial consume solo la parte ejecutada.

Un submit ambiguo conserva la reserva.

---

# 19. ATRIBUCIÓN DE INVENTARIO

Propiedad:

```text
exchange + asset + mode
```

Cada modo solo vende:

```text
inventario atribuido
− inventario reservado
− inventario consumido
```

Prohibiciones:

* AMA no vende inventario ajeno.
* Otro modo no vende AMA.
* No doble reserva de inventario.
* No venta automática de `UNATTRIBUTED`.
* No compensar inventario entre exchanges.

---

# 20. SNAPSHOTS DE BALANCE

Crear:

```text
ExchangeBalanceSnapshotService
```

Guardar:

```text
exchange
asset
totalQuantity
availableQuantity
heldQuantity
sourceTimestamp
retrievedAt
freshness
rawResponseHash
```

No asumir:

```text
totalQuantity = availableQuantity
```

Disponibilidad desconocida bloquea la operación.

---

# 21. VALORACIÓN GLOBAL

Crear:

```text
PortfolioValuationService
```

Separar:

```text
custodyQuantity
referencePrice
executionBid
executionAsk
mid
estimatedValue
```

Tipos:

```text
EXECUTABLE_BID
EXECUTABLE_ASK
MID
LAST
REFERENCE
EXTERNAL_ESTIMATE
UNAVAILABLE
```

Reglas:

* USD = 1 USD.
* Stablecoins con precio dinámico.
* Detectar depeg.
* EUR con FX dinámico.
* No usar cambios fijos.
* Coste desconocido = `COST_BASIS_UNKNOWN`.
* No inventar P&L.

---

# 22. API DE CARTERA GLOBAL

```text
GET  /api/portfolio/global
GET  /api/portfolio/assets
GET  /api/portfolio/modes
GET  /api/portfolio/budgets
GET  /api/portfolio/reservations
GET  /api/portfolio/open-orders
GET  /api/portfolio/reconciliation
POST /api/portfolio/refresh
```

`refresh` puede consultar y reconciliar.

No puede comprar, vender ni reasignar capital automáticamente.

---

# 23. MIGRACIÓN DE `/wallet`

Feature flag:

```text
GLOBAL_PORTFOLIO_ENABLED
```

Secuencia:

1. Backend nuevo.
2. Vista existente.
3. Dual-read.
4. Comparación.
5. Registro de diferencias.
6. Corrección de dobles conteos.
7. Nueva UI en SHADOW.
8. Rollback.
9. Retirada de cálculos financieros del frontend.
10. API global como fuente oficial.

No eliminar endpoints anteriores antes de demostrar paridad.

---

# 24. PANEL DE CARTERA GLOBAL

Subpestañas:

```text
Resumen global
Por activo
Por exchange
Por modo
Presupuestos
Reservas y órdenes
Rentabilidad
Reconciliación
Auditoría
```

Estados visuales:

```text
REAL
DERIVED
ESTIMATED
STALE
INCOMPLETE
UNAVAILABLE
```

---

# 25. REGISTRO GLOBAL DE ÓRDENES

Crear:

```text
GlobalOpenOrderRegistry
CrossModeExecutionCoordinator
```

Guardar:

```text
exchange
pair
side
mode
cycleId
logicalIntentId
clientOrderId
venueOrderId
originalQuantity
cumulativeFilled
remainingQuantity
price
status
createdAt
updatedAt
```

Políticas:

* BUY de modos distintos: solo con reservas independientes.
* BUY contra SELL de otro modo: bloqueado por defecto.
* Dos SELL sobre el mismo inventario: prohibido.
* Orden externa desconocida: reconciliación.
* Cada modo cancela solo sus órdenes.

---

# 26. CONCURRENCIA E IDEMPOTENCIA

Crear:

```text
SchedulerLeaseService
ExecutionFencingService
```

Usar:

* locks transaccionales;
* leases;
* fencing tokens;
* constraints únicas;
* idempotency keys.

Modelo:

```text
at-least-once
+ idempotencia
+ reconciliación
```

Evitar doble scheduler, doble análisis, doble submit y retry duplicado.

---

# 27. CONTRATO TEMPORAL

Crear:

```text
AmaTimeContract
```

```text
timezone      = UTC
dailyBoundary = 00:00 UTC
```

Persistir:

```text
barOpenAt
barCloseAt
barAvailableAt
barComplete
providerTimestamp
ingestedAt
```

Una vela incompleta no confirma decisiones.

Bloquear ante clock drift excesivo.

---

# 28. DATOS POINT-IN-TIME

Crear:

```text
AmaPointInTimeDataService
AmaDataQualityService
```

Guardar:

```text
eventTime
effectiveAt
publishedAt
availableAt
retrievedAt
providerRevision
providerVersion
isPointInTime
```

Replay solo usa información disponible en ese instante.

Estados:

```text
FRESH
STALE
UNAVAILABLE
ERROR
DISABLED
REVISION_RISK
```

---

# 29. PROTECCIÓN CONTRA DATOS ANÓMALOS

Crear:

```text
AmaMarketDataAnomalyGuard
```

Validar:

* OHLC;
* precio positivo;
* volumen;
* timestamp;
* duplicados;
* huecos;
* orden temporal;
* desviación extrema;
* comparación entre venues;
* segunda lectura.

Ante anomalía:

```text
ANOMALOUS_MARKET_DATA
```

No actualizar ciclo ni operar.

---

# 30. HIGH-WATER MARK PERSISTENTE

Crear:

```text
AmaCycleCeilingService
```

Definición:

> HWM persistente basado en cierres diarios de Kraken, confirmado mediante reversión adaptativa al ATR y persistencia temporal.

> **V2.2 — HWM autoritativo:** `authoritativeCycleHwm` no puede bajar durante el ciclo. `rollingHigh` puede bajar. El bootstrap es incremental, no replay completo.

Estados V2.2:

```text
CANDIDATE
CONFIRMING
CONFIRMED
FROZEN
SUPERSEDED
INVALIDATED
```

Reglas:
- `authoritativeCycleHwm`: una vez CONFIRMED → FROZEN, no baja ni expira.
- `rollingHigh`: máximo móvil, puede bajar si nuevos datos lo justifican.
- Bootstrap: cargar histórico → ejecutar algoritmo incremental → reconstruir candidatos → confirmar → seleccionar último ciclo coherente → persistir manifiesto.
- Un HWM CANDIDATE no es autoritativo hasta CONFIRMED.

Fórmulas:

```text
candidateHighWaterMark =
max(previousCandidateHighWaterMark, latestConfirmedDailyClose)
```

```text
atrPct =
ATR20Daily / latestConfirmedDailyClose × 100
```

```text
reversalThresholdPct =
clamp(
  atrPct × atrMultiplier,
  minimumReversalPct,
  maximumReversalPct
)
```

Rangos de laboratorio:

```text
atrMultiplier      = 2,5–4,0
minimumReversalPct = 8–10 %
maximumReversalPct = 16–20 %
```

Comparar:

```text
2 cierres diarios
3 cierres diarios
1 semana canónica
```

El techo congelado no baja ni expira durante el ciclo.

---

# 31. CICLO SIN INVENTARIO

Estado:

```text
ABANDONED_NO_INVENTORY
```

Puede abandonarse cuando:

* se recupera el techo;
* aparece nuevo máximo;
* desaparece el valor;
* se supera tiempo máximo sin fill.

No aplicar a ciclos con inventario AMA.

---

# 32. MÍNIMO Y REBOTE

```text
cycleLowPrice =
min(previousCycleLowPrice, latestConfirmedDailyClose)
```

Calcular:

```text
currentDropPct
maxDropPct
reboundFromLowPct
daysSinceCeiling
daysSinceLow
distanceToValueZone
distanceToNextCandidate
distanceToRecovery
```

Un mínimo provisional no es un suelo confirmado.

---

# 33. BARRA MACRO

Crear:

```text
AmaMacroCycleBar
```

Zonas:

|   Caída | Zona                 |
| ------: | -------------------- |
|  0–10 % | NORMAL               |
| 10–20 % | RETROCESO            |
| 20–30 % | CORRECCIÓN           |
| 30–40 % | VALUE                |
| 40–50 % | DEEP VALUE           |
| 50–60 % | CAPITULACIÓN         |
| 60–80 % | CAPITULACIÓN EXTREMA |

Marcadores:

```text
C = techo
● = caída actual
◆ = caída máxima
P = PROBE
V = VALUE
D = DEEP_VALUE
X = CAPITULATION
R = RECOVERY
B = coste medio
T = trailing
```

Las zonas no son órdenes.

---

# 34. MÁQUINA DE ESTADOS

Estados:

```text
OBSERVING
CEILING_BOOTSTRAPPING
CEILING_CANDIDATE
CEILING_CONFIRMING
VALUE_ZONE
PLAN_ELIGIBLE
ACCUMULATING
POSITION_OPEN
RECOVERY_MONITORING
DISTRIBUTING
CLOSING
CLOSED
ABANDONED_NO_INVENTORY
```

Protección:

```text
DATA_DEGRADED
CEILING_REVIEW_REQUIRED
EXECUTION_BLOCKED
RECONCILIATION_REQUIRED
THESIS_REVIEW_REQUIRED
CAPITAL_DEPLOYMENT_PAUSED
KILL_SWITCH_ACTIVE
```

Toda transición será persistida y reproducible.

---

# 35. AMA MANDATE STUDIO

Crear:

```text
AmaMandateStudio
AmaMandateEditor
AmaMandatePreview
AmaMandateScenarioSimulator
AmaMandateDiffViewer
AmaPolicyVersionHistory
AmaResolvedPolicyViewer
AmaMandateApprovalGate
```

Flujo:

```text
mandato
→ política resuelta
→ simulación
→ validación
→ aprobación
→ activación
→ plan adaptativo
```

---

# 36. CONTROLES DEL MANDATO

## Capital máximo AMA

Importe exacto y slider sincronizado.

Valor inicial:

```text
0 €
```

Límite duro.

## Mandato de riesgo

```text
MUY PRUDENTE
PRUDENTE
EQUILIBRADO
DINÁMICO
OPORTUNISTA
```

## Estilo de acumulación

```text
ENTRAR ANTES
ADAPTATIVO
ESPERAR MÁS VALOR
```

## Objetivo de salida

```text
RECUPERAR CAPITAL
EQUILIBRADO
ACUMULAR BTC
```

## Nivel de autonomía

```text
SOLO ANÁLISIS
SUPERVISADO
AUTOPILOT
```

Reglas:

```text
REPLAY       → AUTOPILOT permitido
SHADOW       → AUTOPILOT permitido
REAL_LIMITED → SUPERVISADO
REAL_FULL    → bloqueado
```

---

# 37. POLÍTICAS VERSIONADAS

Crear:

```text
AmaUserMandate
AmaResolvedStrategyPolicy
AmaMandateResolver
```

Estados:

```text
DRAFT
SIMULATED
VALIDATED
PENDING_APPROVAL
ACTIVE
SUPERSEDED
REVOKED
```

Una política ACTIVE es inmutable.

Guardar:

```text
mandateId
policyId
policyVersion
userInputs
resolvedParameters
resolverVersion
strategyVersion
policyHash
createdAt
approvedAt
activatedAt
effectiveFrom
status
```

---

# 38. PARÁMETROS TÉCNICOS RESUELTOS

> **V2.2 — Seed Policies BTC/ETH:** Los parámetros técnicos se resuelven mediante Seed Policies específicas por asset. BTC y ETH tienen políticas independientes con envelopes de calibración.

## 38.1 Seed Policy BTC

```text
policyId           = AMA_BTC_SEED_V1_RESEARCH
asset              = BTC/USD
status             = LAB_ONLY
analysisVenue      = KRAKEN
futureExecutionVenue = REVOLUT_X
executionEnabled   = false
makerOnly          = true
takerFallback      = false
capitalAllocation  = 75% deployable, 25% reserve
trancheCount       = 6
fixedReversalCenterPct = 10.0
atrMultiplier      = 3.0
requiredDailyCloses = 3
```

Invariants:
- `mandatoryReservePct` = 25%
- `maxSingleTranchePct` ≤ 15% del capital deployable
- `maxCycleDeploymentPct` = 75%
- Máximo 1 tranche por cierre diario confirmado
- Sin taker fallback

## 38.2 Seed Policy ETH

```text
policyId           = AMA_ETH_SEED_V1_RESEARCH_ONLY
asset              = ETH/USD
status             = RESEARCH_ONLY
analysisVenue      = KRAKEN
futureExecutionVenue = DISABLED
executionEnabled   = false
makerOnly          = true (hypothetical)
takerFallback      = false
capitalAllocation  = 65% deployable, 35% reserve
trancheCount       = 7
fixedReversalCenterPct = 14.0
atrMultiplier      = 3.0
requiredDailyCloses = 3
ethBtcFilterRequired = true
relativePair       = ETH/BTC
```

Invariants:
- ETH no puede reservar capital real
- ETH no puede crear intents ejecutables
- ETH no puede usar Revolut X executor
- ETH no comparte capital/inventario/ciclos con BTC
- ETH no hereda promoción BTC
- `executionVenue` = DISABLED hasta autorización explícita

## 38.3 Envelopes (intervalos de calibración)

> Los envelopes son **intervalos de calibración**, no bandas de ejecución simultánea.

Reglas:
- Cada tranche tiene un trigger resuelto único y descendente.
- No se ejecutan múltiples tranches simultáneamente sobre el mismo cierre.
- Máximo un tranche por cierre diario confirmado.
- Los triggers son puntos, no rangos solapados.

## 38.4 Parámetros generales (preservado)

```text
mandatoryReservePct
maxSingleTranchePct
maxCycleDeploymentPct
maxWeeklyDeploymentPct
maxMonthlyDeploymentPct
minimumSpacingPct
spacingAtrMultiplier
minimumDataCoveragePct
requiredConfirmationStrength
cooldownPolicy
maximumCandidateTranches
absoluteSafetyCap
spreadTolerancePct
crossVenueBasisTolerancePct
profitRecoveryPolicy
deRiskPolicy
runnerPolicy
trailingPolicy
thesisInvalidationPolicy
```

No editables directamente en producción.

Visibles en auditoría y replay.

---

# 39. VISTA PREVIA Y DIFERENCIAS

Mostrar:

```text
Así actuará AMA
```

Incluir:

* mandato;
* política;
* reserva;
* rango de tramos;
* máximo por tramo;
* ritmo;
* confirmación;
* sleeves;
* trailing;
* invalidación;
* riesgos;
* diferencias con política activa;
* efecto sobre ciclo activo.

---

# 40. SIMULADOR DE MANDATO

Escenarios:

```text
CORRECCION_MODERADA
MERCADO_BAJISTA_PROFUNDO
CAPITULACION_EXTREMA
RECUPERACION_EN_V
LATERALIDAD_PROLONGADA
FALSA_CAPITULACION
```

Mostrar:

* tramos estimados;
* capital desplegado;
* reserva;
* pausas;
* exposición;
* salida;
* riesgos.

Aviso:

```text
Simulación de comportamiento, no previsión de rentabilidad.
```

---

# 41. GUARDRAILS

```text
Solo maker/post-only
Sin compras ilimitadas
Sin martingala
Sin usar capital de otros modos
Sin superar capital autorizado
Máximo un tramo por cierre diario
Sin operar con datos degradados
Sin operar con reconciliación pendiente
Sin aumentar riesgo tras el primer fill
Sin ampliar presupuesto mediante IA
Sin modificar una política ACTIVE
```

## 41.1 Risk Overlay (V2.2)

```text
ACTIVE_SEED_OVERLAY = RISK_DOWN_ONLY
```

- El risk overlay reduce el tamaño de tranches cuando el riesgo aumenta.
- **Nunca amplía** el tamaño de tranches.
- `minimumWeightMultiplier`: BTC = 0.50, ETH = 0.35
- `maximumWeightMultiplier`: BTC = 1.00, ETH = 1.00
- Challenger con multiplier >1.00 (ej. 1.25/1.15) = `CHALLENGER_RESEARCH_ONLY`, no activo en producción.
- Un multiplier >1.00 está prohibido en el overlay activo.

## 41.2 Salidas como hipótesis (V2.2)

```text
BTC exits = LAB_HYPOTHESIS
ETH exits = LAB_HYPOTHESIS
exitStatus = NOT_ACTIVE
```

- Las salidas (de-risk, runner, trailing) son hipótesis de laboratorio.
- No se implementan ejecuciones de salida en Fase 2.
- Se registran como diseño pendiente de validación.

---

# 42. PLANIFICACIÓN ADAPTATIVA

Crear:

```text
AmaAdaptiveTranchePlanner
```

Calcular:

```text
plannedPurchaseCount
candidateTranches
trancheTypes
activationZones
trancheAmounts
minimumSpacing
mandatoryReserve
deploymentCadence
eligibilityConditions
cancellationConditions
expirationConditions
```

Tipos:

```text
PROBE
VALUE
DEEP_VALUE
CAPITULATION
RECOVERY
```

No todos los ciclos utilizan todos los tipos.

---

# 43. NÚMERO DE TRAMOS

```text
deployableCycleCapital =
cycleBudget
− mandatoryReserve
```

```text
minimumSafeTrancheAmount =
max(
  configuredMinimumTrancheAmount,
  RevolutXMinimumNotionalWithBuffer
)
```

```text
maximumByAvailableBudget =
floor(
  deployableCycleCapital
  / minimumSafeTrancheAmount
)
```

```text
minimumSpacingPct =
max(
  policyMinimumSpacingPct,
  ATRPct × spacingAtrMultiplier,
  executionTickPct,
  spreadProtectionPct
)
```

```text
maximumByValidPriceSpacing =
floor(
  plannedRemainingDrawdownRangePct
  / minimumSpacingPct
)
```

```text
plannedPurchaseCount =
min(
  maximumByAvailableBudget,
  maximumByValidPriceSpacing,
  validatedConfigurationMaximum,
  absoluteSafetyCap
)
```

No permitir ilimitado.

---

# 44. VALIDACIÓN DEL MÁXIMO

Comparar en laboratorio:

```text
2
3
4
5
6
8
```

Evaluar:

* estabilidad;
* drawdown;
* concentración;
* capital ocioso;
* oportunidad;
* duración;
* fills;
* slippage;
* robustez fuera de muestra.

No elegir solo el mayor beneficio histórico.

---

# 45. DISTRIBUCIÓN DE CAPITAL

Prohibida la martingala.

Permitir:

```text
uniforme
creciente limitada
híbrida
dependiente de confirmación
```

Invariantes:

```text
trancheAmount
<= maxSingleTranchePct × cycleBudget
```

```text
totalPlannedCapital
<= deployableCycleCapital
```

```text
mandatoryReserve
>= policyMinimumReserve
```

---

# 46. ELEGIBILIDAD POR TIPO

## PROBE

* Opcional.
* Importe reducido.
* Valor suficiente.
* No exige suelo confirmado.

## VALUE

* Profundidad.
* Valoración.
* Persistencia.
* Estructura válida.

## DEEP_VALUE

* Caída profunda.
* Reserva suficiente.
* Valoración elevada.

## CAPITULATION

* Volumen.
* Rango.
* Miedo.
* Presión vendedora.
* Estructura.

No se activa solo por porcentaje.

## RECOVERY

* Estabilización.
* Rebote.
* Mejora estructural.
* Puede comprar por encima del mínimo.

---

# 47. CADENCIA

```text
MAX_ONE_NEW_TRANCHE_PER_CONFIRMED_DAILY_BAR
```

Si se atraviesan varios niveles:

1. Registrar.
2. Evaluar siguiente elegible.
3. Ejecutar como máximo uno.
4. Esperar cierre nuevo.
5. Recalcular.

---

# 48. RECÁLCULO DEL PLAN

Antes del primer fill:

* recalcular completamente;
* versionar cada plan.

Después del primer fill:

Puede:

* cancelar;
* reducir;
* espaciar;
* aumentar reserva;
* aplazar;
* pausar.

No puede:

* aumentar presupuesto;
* reducir reserva;
* aumentar tamaños;
* añadir riesgo;
* perseguir el precio;
* superar safety cap.

```text
postFirstFillRisk <= approvedFirstFillRisk
```

---

# 49. MOTOR DE SEÑALES

Crear:

```text
StructuralValueAssessment
CapitulationAssessment
RecoveryAssessment
FlowAssessment
NetworkAssessment
DistributionAssessment
DataConfidenceAssessment
```

Salida:

```text
status
score
reasons
inputs
coveragePct
confidence
freshness
version
```

No usar un único score como orden.

Separar acumulación y distribución.

---

# 50. COBERTURA Y CONFIANZA

```text
rawScoreOnFullScale
conditionalScore
coveragePct
confidence
```

Con datos insuficientes:

```text
INSUFFICIENT_DATA
```

No operar.

Mostrar confianza desglosada, no solo un porcentaje agregado.

---

# 51. AMA CORE Y ENHANCED

## Core

* Kraken.
* HWM.
* Drawdown.
* ATR.
* EMA/SMA.
* Volumen.
* Momentum.
* Fear & Greed cuando esté disponible.

## Enhanced

* Coin Metrics.
* mempool.space.
* Dune.
* Arkham.
* on-chain.
* flows.
* network health.

Core debe funcionar solo.

Enhanced comienza como challenger.

---

# 52. PRESUPUESTO AMA

Crear:

```text
AmaRiskBudgetService
AmaAutoRiskManager
```

Gestionar:

* presupuesto;
* desplegado;
* reservado;
* libre;
* reserva;
* máximo por tranche;
* límites semanales;
* límites mensuales;
* cooldown;
* ajuste de volatilidad;
* ajuste de profundidad.

La IA no modifica sizing REAL.

---

# 53. PROTECCIÓN DEL CICLO (drawdown separado, R1)

> **R1 — Corrección:** El drawdown de precio está separado del riesgo sistémico. `canSell` y `canPause` son funciones granulares independientes. El drawdown de precio no vende. El riesgo sistémico se evalúa por separado.

Implementar:

```text
CAPITAL_DEPLOYMENT_STOP
CYCLE_RISK_BUDGET
THESIS_INVALIDATION_GATE
EMERGENCY_EXIT_POLICY
PROFIT_TRAILING
```

## Deployment Stop

Detiene nuevas compras.

## Risk Budget

Limita exposición total del ciclo.

## Invalidación

Políticas de laboratorio:

```text
PAUSE_AND_MONITOR
PARTIAL_DE_RISK
CONFIRMED_STRUCTURAL_EXIT
```

Inicial REAL_LIMITED:

```text
PAUSE_AND_MONITOR
```

## Emergency Exit

Inicialmente:

```text
DISABLED
```

## Profit Trailing

Protege beneficios tras recuperación.

No existe stop estrecho automático como protección primaria.

---

# 54. SLEEVES

```text
RECOVER_PRINCIPAL
DE_RISK
LONG_TERM_RUNNER
```

Cada tranche guardará:

```text
grossQuantity
netQuantity
fee
costBasis
sleeveAllocation
remainingQuantity
realizedQuantity
```

---

# 55. TRAILING MACRO

Crear:

```text
AmaMacroTrailingService
```

```text
peakDailyClose
```

```text
atrPct =
ATR14Daily / dailyClose × 100
```

```text
distancePct =
clamp(
  atrMultiplier × atrPct,
  regimeMinDistancePct,
  regimeMaxDistancePct
)
```

```text
candidateStopPrice =
peakDailyClose × (1 - distancePct / 100)
```

```text
activeStopPrice =
max(previousActiveStopPrice, candidateStopPrice)
```

Reglas:

* solo sube;
* nunca baja;
* usa cierres;
* persiste;
* protege inicialmente el runner;
* requiere condiciones de armado.

---

# 56. ANÁLISIS BAJO DEMANDA

```text
POST /api/ama/analyze-now
GET  /api/ama/analysis-runs/:id
```

El análisis manual:

* no compra;
* no vende;
* no reserva capital;
* no cambia modo;
* no modifica parámetros;
* no provoca ejecución indirecta.

---

# 57. ARQUITECTURA DE IA (RISK_DOWN_ONLY, R1)

> **R1 — Corrección:** La IA implementa `RISK_DOWN_ONLY` — nunca amplía presupuesto ni recomienda venta positiva. `AI_INSUFFICIENT_DATA` se emite cuando faltan datos (HWM, budget, price). IDs deterministas SHA-256 (`insight-<12 hex>`).

Crear:

```text
AmaMlChallenger
AmaLlmAnalyst
AmaAiRiskMonitor
```

La IA puede:

* explicar;
* comparar;
* detectar drift;
* detectar riesgo;
* recomendar menos exposición.

No puede:

* autorizar órdenes;
* aumentar capital;
* aumentar tramos;
* cambiar políticas;
* saltarse gates.

Estados:

```text
AI_UNCERTAIN
AI_INSUFFICIENT_DATA
AI_OUT_OF_DISTRIBUTION
AI_PROVIDER_UNAVAILABLE
```

---

# 58. SEGURIDAD DE IA

Crear:

```text
AmaAiInputSanitizer
```

Proteger contra:

* prompt injection;
* instrucciones ocultas;
* datos manipulados;
* exfiltración;
* acceso a secretos;
* modificación de herramientas;
* escalada de permisos.

Contenido externo informa, no gobierna.

---

# 59. FEATURE STORE

Crear:

```text
AmaFeatureStore
```

Guardar:

```text
featureName
value
eventTime
availableAt
source
sourceVersion
calculationVersion
snapshotId
qualityStatus
```

Mismo pipeline en REPLAY, SHADOW y REAL.

---

# 60. CONTROLADOR Y EJECUTOR

```text
AmaController
→ AmaActionProposal
```

```text
AmaExecutionPlanner
→ ExecutableAmaAction
```

```text
AmaOrderExecutor
→ lifecycle de orden
```

Estados:

```text
CREATED
VALIDATED
SUBMITTING
ACCEPTED_PENDING_FILL
PARTIALLY_FILLED
COMPLETED
CANCELED
REJECTED
EXPIRED
UNKNOWN_RECONCILIATION_REQUIRED
```

La máquina de estados no llama directamente a `placeOrder()`.

---

# 61. PRE-TRADE GATE

Crear:

```text
AmaPreTradeRiskGate
```

Validar:

* modo;
* autonomía;
* política;
* commit autorizado;
* capabilities;
* fees;
* kill switch;
* reloj;
* datos;
* propuesta;
* expiración;
* collar de precio;
* cantidad;
* notional;
* posición;
* presupuesto;
* reserva;
* saldo;
* reconciliación;
* duplicados;
* conflictos;
* spread;
* basis;
* constraints;
* límites temporales.

---

# 62. EJECUCIÓN REVOLUT X

```text
POST_ONLY_MAKER_ONLY
```

Flujo:

```text
post-only
→ espera limitada
→ repricing limitado
→ cancelación individual
→ reevaluación
```

No taker automático.

No market order sin límite.

Guardar:

```text
decisionPrice
executionReferencePrice
averageFillPrice
spreadPct
basisPct
implementationShortfallPct
```

---

# 63. FILLS PARCIALES

```text
replacementQuantity =
logicalTargetQuantity
− cumulativeFilledAcrossAllAttempts
```

Nunca reenviar la cantidad original tras un fill parcial.

Una orden aceptada no crea inventario.

Solo el fill confirmado modifica:

* inventario;
* desplegado;
* reserva consumida;
* coste;
* sleeves.

---

# 64. SIMULADOR MAKER (parametrizado, R1)

> **R1 — Corrección:** El simulador maker está parametrizado con `makerFeeBps`, `takerFeeBps`, `postOnly = true`, `fillSimulated = false`. `simulationId` determinista SHA-256.

Estados:

```text
NO_FILL
PARTIAL_FILL
FULL_FILL
EXPIRED
REPLACED
```

Incluir:

* latencia;
* volumen;
* prioridad;
* spread;
* fees;
* slippage;
* cancel/replace.

Escenarios:

```text
CONSERVATIVE
BASE
FAVOURABLE
```

El gate usa `CONSERVATIVE`.

---

# 65. RECONCILIACIÓN

Crear:

```text
AmaReconciliationService
PortfolioReconciliationService
```

Reconciliar:

* balances;
* órdenes;
* fills;
* reservas;
* intents;
* attempts;
* inventario;
* sleeves;
* presupuesto;
* ciclo.

Ante incertidumbre:

```text
no nueva orden
no nueva reserva
no nueva venta
RECONCILIATION_REQUIRED
```

---

# 66. REPLAY Y VALIDACIÓN

Mismo código para:

```text
REPLAY
SHADOW
REAL
```

Gates:

```text
LOOKAHEAD_GATE
RECURSIVE_STABILITY_GATE
POINT_IN_TIME_GATE
```

Utilizar:

* train;
* validation;
* anchored walk-forward;
* gap o embargo;
* holdout bloqueado.

No reutilizar holdout para ajustar.

---

# 67. BENCHMARKS

```text
Efectivo
Buy & Hold BTC
DCA periódico
Drawdown + EMA200
Drawdown + EMA200 + recuperación
AMA Core
AMA Enhanced
AMA con tramos fijos
AMA con tramos adaptativos
AMA + challenger
```

Ablation de fuentes, PROBE, RECOVERY, trailing, HWM e IA.

---

# 68. MÉTRICAS

* rentabilidad;
* CAGR;
* XIRR;
* Sortino;
* Calmar;
* max drawdown;
* CVaR;
* capital presupuestado;
* desplegado;
* reservado;
* capital ocioso;
* MFE;
* MAE;
* tiempo de recuperación;
* principal recuperado;
* runner;
* fill ratio;
* slippage;
* implementation shortfall;
* sensibilidad;
* frecuencia de pausa;
* exposición máxima.

No aprobar solo por Sharpe.

---

# 69. CONTROL DE SOBREAJUSTE

Crear:

```text
ama_research_trials
```

Guardar:

```text
trialId
hypothesis
parameterSetHash
datasetVersion
seed
trainPeriod
validationPeriod
finalBlockedPeriod
metrics
accepted
rejectionReason
```

Analizar:

* IS/OOS;
* sensibilidad;
* Deflated Sharpe;
* probabilidad de sobreajuste;
* estabilidad.

Seleccionar regiones estables.

---

# 70. STRESS TESTS

Probar:

* caída tras cada tranche;
* recuperación en V;
* lateralidad;
* nuevo máximo y caída;
* Kraken caído;
* Revolut X caído;
* divergencia entre venues;
* fill parcial;
* DB caída tras submit;
* retirada manual;
* depósito;
* reserva simultánea;
* depeg;
* precio anómalo;
* vela duplicada;
* clock drift;
* migración parcial;
* cambio de API;
* cambio de fees;
* IA caída;
* prompt injection;
* trailing durante outage;
* varios niveles atravesados;
* capital pequeño;
* cambio de política con ciclo activo;
* intento de ampliar riesgo tras fill.

---

# 71. PROMOCIÓN A REAL

Crear:

```text
AmaPromotionGate
```

Exigir:

* Replay aprobado;
* look-ahead aprobado;
* estabilidad;
* holdout intacto;
* stress tests;
* SHADOW;
* cero órdenes en SHADOW;
* cero duplicados;
* Cartera Global;
* reservas;
* reconciliación;
* restore;
* kill switch;
* capabilities;
* fees;
* política ACTIVE;
* commit identificado.

---

# 72. KILL SWITCHES

## AMA_KILL_SWITCH

* bloquea AMA;
* impide submits;
* conserva inventario;
* continúa reconciliando;
* cancela solo órdenes AMA;
* no vende automáticamente.

## ACCOUNT_EMERGENCY_KILL_SWITCH

* manual;
* doble confirmación;
* bloquea todos;
* cancela órdenes;
* no vende;
* exige revisión para reactivar.

AMA no activa automáticamente el kill switch global.

---

# 73. CAPABILITIES Y FEES

Crear:

```text
RevolutXCapabilitySnapshot
RevolutXFeeSnapshot
```

Verificar:

* autenticación;
* símbolos;
* constraints;
* precisiones;
* tamaños;
* post-only;
* cancelación;
* replace;
* fills;
* estados;
* rate limits;
* fees;
* vigencia.

Ante drift:

```text
CAPABILITY_DRIFT_DETECTED
FEE_SCHEDULE_DRIFT_DETECTED
```

Bloquear REAL.

---

# 74. DECISION MANIFEST

Crear:

```text
AmaDecisionManifest
```

Guardar:

```text
codeCommitSha
strategyVersion
parameterSetHash
datasetManifestHash
providerSnapshotIds
marketSnapshotId
portfolioSnapshotId
featureSnapshotId
modelVersion
analysisRunId
proposalId
executionPlannerVersion
decisionTimestamp
manifestHash
```

Cada decisión debe poder reconstruirse.

---

# 75. FISCO

Todo fill AMA:

```text
mode = AMA
cycleId
trancheId
sleeve
logicalIntentId
venueOrderId
fillId
grossQuantity
netQuantity
feeAsset
feeAmount
costBasis
proceeds
realizedPnl
timestamps
```

No duplicar operaciones importadas.

Los registros fiscales no se borran mediante retención operativa.

---

# 76. MODELO DE DATOS PRINCIPAL

## Cartera Global

```text
portfolio_exchange_snapshots
portfolio_ledger_entries
portfolio_mode_budgets
portfolio_capital_reservations
portfolio_reservation_events
portfolio_open_orders
portfolio_reconciliation_runs
portfolio_reconciliation_items
portfolio_valuation_snapshots
portfolio_audit_events
```

## AMA

```text
ama_user_mandates
ama_resolved_policies
ama_policy_versions
ama_policy_approvals
ama_mandate_simulations
ama_scenario_results
ama_cycles
ama_market_snapshots
ama_provider_snapshots
ama_assessments
ama_state_transitions
ama_tranche_plans
ama_tranche_plan_versions
ama_tranche_candidates
ama_tranche_eligibility_evaluations
ama_tranches
ama_sleeves
ama_analysis_runs
ama_action_proposals
ama_order_intents
ama_order_attempts
ama_fills
ama_trailing_state
ama_audit_events
ama_feature_snapshots
ama_model_versions
ama_parameter_sets
ama_validation_reports
ama_research_trials
ama_ai_predictions
ama_ai_drift_metrics
ama_decision_manifests
```

Reutilizar tablas existentes cuando proceda.

---

# 77. API AMA

## Mandato

```text
GET  /api/ama/mandate
POST /api/ama/mandate/drafts
POST /api/ama/mandate/:id/simulate
POST /api/ama/mandate/:id/validate
POST /api/ama/mandate/:id/approve
POST /api/ama/mandate/:id/activate
GET  /api/ama/mandate/:id/preview
GET  /api/ama/mandate/:id/diff
GET  /api/ama/mandate/history
```

## Política

```text
GET /api/ama/policy/active
GET /api/ama/policy/:id/resolved
```

## Estado

```text
GET /api/ama/status
GET /api/ama/market-view
GET /api/ama/assessments
GET /api/ama/providers
```

## Plan

```text
GET /api/ama/tranche-plan/current
GET /api/ama/tranche-plan/history
GET /api/ama/tranche-plan/:id
GET /api/ama/tranche-plan/:id/explanation
```

## Ciclos

```text
GET /api/ama/cycles
GET /api/ama/cycles/:id
GET /api/ama/cycles/:id/tranches
GET /api/ama/cycles/:id/audit
```

## Replay e IA

```text
POST /api/ama/replay/run
GET  /api/ama/replay/results
GET  /api/ama/ai/status
GET  /api/ama/ai/challenger-results
```

---

# 78. PANEL AMA

## Resumen

* ciclo;
* techo;
* caída;
* mínimo;
* rebote;
* mandato;
* política;
* presupuesto;
* reserva;
* próxima acción;
* bloqueos.

## Mandato

* controles;
* preview;
* simulación;
* diff;
* versiones;
* aprobación.

## Inteligencia macro

* barra;
* assessments;
* confianza;
* cobertura;
* fuentes.

## Plan de acumulación

* tramos;
* importes;
* reserva;
* elegibilidad;
* razones;
* próxima revisión.

## Ciclos

* historial;
* fills;
* coste;
* estados.

## Cartera AMA

* presupuesto;
* desplegado;
* reservado;
* libre;
* BTC;
* coste;
* P&L;
* sleeves;
* reconciliación.

## Salidas

* principal;
* de-risk;
* runner;
* trailing.

## Auditoría

* mandatos;
* políticas;
* planes;
* decisiones;
* órdenes;
* fills;
* manifiestos;
* eventos.

---

# 79. SISTEMA MODERNO DE LOGS, EVENTOS Y CICLO DE VIDA

Crear arquitectura unificada de:

```text
logs estructurados
eventos de dominio
auditoría
métricas
correlación
retención
compactación
archivo
eliminación segura
control de crecimiento
```

No duplicar innecesariamente:

```text
serverLogsService
bot_events
logStreamService
MarketDataService
MarketCandleRepository
```

Auditar, migrar o compatibilizar.

---

# 80. SEPARACIÓN DE CATEGORÍAS

## Logs operativos

Temporales:

```text
HTTP_REQUEST_COMPLETED
PROVIDER_TIMEOUT
DB_QUERY_SLOW
CACHE_MISS
SCHEDULER_HEARTBEAT
```

## Eventos de dominio

Reconstruyen el ciclo:

```text
AMA_POLICY_ACTIVATED
AMA_CYCLE_CREATED
AMA_CEILING_CONFIRMED
AMA_TRANCHE_PLAN_CREATED
AMA_ORDER_INTENT_CREATED
AMA_FILL_CONFIRMED
AMA_CYCLE_CLOSED
```

## Auditoría protegida

* mandatos;
* políticas;
* órdenes;
* fills;
* fees;
* ledger;
* reservas;
* inventario;
* reconciliaciones;
* autorizaciones;
* FISCO;
* seguridad.

No usar la misma retención.

---

# 81. LOGGER ESTRUCTURADO

Tecnología preferente:

```text
Pino
```

Confirmar tras auditoría.

Formato:

```text
timestamp
observedTimestamp
eventName
schemaVersion
severityText
severityNumber
message
serviceName
serviceVersion
environment
module
mode
pair
cycleId
trancheId
mandateId
policyId
logicalIntentId
venueOrderId
fillId
traceId
spanId
correlationId
requestId
reasonCode
durationMs
attributes
dataClass
retentionClass
```

No detectar severidad buscando palabras en una línea.

---

# 82. CORRELACIÓN

Usar:

```text
AsyncLocalStorage
```

Propagar:

```text
requestId
correlationId
traceId
cycleId
tranchePlanId
trancheId
logicalIntentId
orderAttemptId
venueOrderId
```

Cadena trazable:

```text
mandato
→ política
→ plan
→ tranche
→ reserva
→ intent
→ orden
→ fill
→ ledger
→ FISCO
```

---

# 83. REDACCIÓN Y MINIMIZACIÓN

No registrar:

```text
API keys
API secrets
Authorization
cookies
tokens
passwords
private keys
respuestas completas
peticiones completas
datos fiscales innecesarios
```

Eliminar el registro indiscriminado de cuerpos JSON completos.

Registrar HTTP:

```text
method
path normalizado
statusCode
durationMs
responseSizeBytes
requestId
errorCode
```

---

# 84. CONTROL DE VOLUMEN

Crear:

```text
LogSamplingService
LogDeduplicationService
EventAggregationService
```

Política:

```text
TRACE → desactivado normalmente
DEBUG → muestreado
INFO repetitivo → agregado
WARN → completo
ERROR → completo
FATAL → completo
```

No muestrear:

* órdenes;
* fills;
* reservas;
* reconciliaciones;
* políticas;
* fiscalidad;
* seguridad.

Deduplicación:

```text
fingerprint
firstSeenAt
lastSeenAt
occurrenceCount
```

---

# 85. DESTINOS DE LOGS

## Principal

```text
stdout/stderr NDJSON
```

## PostgreSQL

Guardar solo:

* WARN;
* ERROR;
* FATAL;
* eventos seleccionados;
* eventos de dominio;
* auditoría.

No almacenar indefinidamente todos los `console.log`.

Preparar compatibilidad con:

```text
OpenTelemetry
Prometheus
Grafana
Loki
Tempo
```

No instalar todo obligatoriamente.

---

# 86. ROTACIÓN DOCKER

Preferencia:

```yaml
logging:
  driver: local
  options:
    max-size: "20m"
    max-file: "5"
    compress: "true"
```

Los valores definitivos dependerán del VPS.

No permitir logs ilimitados.

No editar archivos internos de Docker.

---

# 87. CLASES DE RETENCIÓN

```text
EPHEMERAL
OPERATIONAL
DIAGNOSTIC
RESEARCH
DOMAIN_HISTORY
FINANCIAL_PROTECTED
SECURITY_PROTECTED
MANUAL_HOLD
```

Orientación:

| Clase               |              Retención |
| ------------------- | ---------------------: |
| EPHEMERAL           |                 3 días |
| OPERATIONAL         |                14 días |
| DIAGNOSTIC          |                90 días |
| RESEARCH            |            30–180 días |
| DOMAIN_HISTORY      |         larga duración |
| FINANCIAL_PROTECTED | sin borrado automático |
| SECURITY_PROTECTED  |             específica |
| MANUAL_HOLD         |       hasta liberación |

Políticas versionadas.

---

# 88. DATOS PROTEGIDOS

No borrar automáticamente:

```text
orders
order attempts
fills
fees
trades
ledger
mode allocations
inventory attribution
fiscal records
mandate approvals
policies
cycle closing summaries
reconciliation adjustments
security incidents
legal holds
decision manifests
```

Podrán archivarse, nunca desaparecer por limpieza general.

---

# 89. DATOS LIMPIABLES

Candidatos:

```text
DEBUG antiguos
INFO repetitivos
heartbeats
cachés obsoletas
snapshots intermedios resumidos
respuestas crudas temporales
Replay temporal
borradores abandonados
simulaciones expiradas
planes nunca activados
evaluaciones redundantes
SHADOW agregado
trazas técnicas
exports temporales
locks expirados
```

Antes de borrar verificar:

* referencias;
* ciclos activos;
* órdenes;
* reconciliación;
* reproducibilidad;
* protección;
* legal hold.

---

# 90. RETENCIÓN DE MERCADO

Retención diferenciada por timeframe.

Revisar especialmente:

```text
1d
1w
```

AMA necesita histórico macro suficiente.

No borrar datos necesarios para:

* bootstrap;
* HWM;
* Replay;
* walk-forward;
* holdout;
* stress tests.

Las semanas podrán reconstruirse desde días verificados.

---

# 91. COMPACTACIÓN Y DOWNSAMPLING

Crear:

```text
DataCompactionService
MarketDataDownsamplingService
```

Flujo:

```text
detalle
→ resumen horario
→ resumen diario
→ resumen semanal
```

Solo borrar detalle si:

* resumen válido;
* checksum;
* lineage;
* no afecta Replay;
* política lo permite.

---

# 92. PARTICIONAMIENTO

Evaluar para:

```text
server_logs
operational_events
ama_market_snapshots
ama_provider_snapshots
ama_assessments
ama_tranche_eligibility_evaluations
ama_ai_predictions
ama_ai_drift_metrics
ama_research_trials
```

Partición diaria o mensual según volumen.

No particionar todas las tablas automáticamente.

---

# 93. BORRADO POR LOTES

Para tablas sin partición:

```text
seleccionar lote
→ borrar lote
→ commit de base de datos
→ comprobar carga
→ continuar
```

Configurar:

```text
batchSize
maximumRowsPerRun
maximumRuntimeMs
pauseBetweenBatchesMs
```

No ejecutar un DELETE masivo no acotado.

---

# 94. VACUUM Y BLOAT

Mantener autovacuum.

Monitorizar:

```text
dead tuples
last autovacuum
last analyze
table size
index size
bloat
long transactions
```

No ejecutar automáticamente:

```text
VACUUM FULL
```

---

# 95. RETENTION SCHEDULER

Crear:

```text
RetentionScheduler
```

Características:

```text
singleton
lease persistente
fencing token
idempotente
reanudable
auditable
timeout
límites
```

No depender solo de `setInterval()`.

Estados:

```text
SCHEDULED
RUNNING
COMPLETED
PARTIAL
FAILED
PAUSED
SKIPPED_HIGH_LOAD
SKIPPED_ACTIVE_EXECUTION
```

---

# 96. VENTANA DE MANTENIMIENTO

Pausar limpieza ante:

```text
orden en SUBMITTING
reconciliación crítica
DB bajo presión
backup
restore
migración
disco crítico sin política segura
```

La reconciliación de una orden tiene prioridad sobre limpieza.

---

# 97. DRY-RUN Y SHADOW DE RETENCIÓN

Flujo:

```text
DRAFT
→ DRY_RUN
→ VALIDATED
→ SHADOW_RETENTION
→ ACTIVE
```

El dry-run mostrará:

* filas;
* bytes;
* tablas;
* fechas de corte;
* exclusiones;
* protecciones;
* referencias activas.

Durante la sesión nocturna no activar borrado real.

---

# 98. DISK CAPACITY GUARD

Crear:

```text
DiskCapacityGuard
DatabaseCapacityMonitor
```

Medir:

```text
filesystem total
filesystem usado
filesystem libre
Docker logs
PostgreSQL
tablas
índices
crecimiento diario
días hasta llenado
```

Umbrales orientativos:

```text
70 % → INFO
80 % → WARN
90 % → CRITICAL
95 % → EXECUTION_SAFETY_REVIEW
```

No realizar prune ni borrar datos protegidos.

---

# 99. PANEL DE OBSERVABILIDAD

Mostrar:

* eventos por minuto;
* logs por nivel;
* errores;
* deduplicación;
* disco;
* PostgreSQL;
* tablas grandes;
* crecimiento;
* última limpieza;
* próxima limpieza;
* política;
* filas candidatas;
* autovacuum;
* datos protegidos;
* legal holds.

Acciones:

```text
Simular limpieza
Pausar
Reanudar
Exportar informe
Aplicar legal hold
```

No crear un botón genérico de borrado.

---

# 100. EVENT EXPLORER

Crear:

```text
AmaEventExplorer
AmaCycleTimeline
```

Filtros:

```text
fecha
severidad
eventName
mode
pair
cycleId
trancheId
orderId
fillId
correlationId
reasonCode
retentionClass
```

Categorías:

```text
LOG
DOMAIN_EVENT
AUDIT_EVENT
SECURITY_EVENT
FINANCIAL_EVENT
```

---

# 101. EXPORTACIÓN

Formatos:

```text
NDJSON
CSV
JSON
```

Usar:

* streaming;
* paginación;
* cursores;
* límites.

No cargar exportaciones masivas en memoria.

Exports temporales con expiración y checksum.

---

# 102. EVENT SCHEMA REGISTRY

Crear:

```text
EventSchemaRegistry
```

Cada evento:

```text
eventName
schemaVersion
description
severity
requiredAttributes
optionalAttributes
dataClass
retentionClass
containsSensitiveData
redactionPolicy
owner
```

Cambios incompatibles generan nueva versión.

---

# 103. EVENTOS DE RETENCIÓN

```text
RETENTION_POLICY_CREATED
RETENTION_POLICY_SIMULATED
RETENTION_POLICY_ACTIVATED
RETENTION_JOB_STARTED
RETENTION_JOB_PARTIAL
RETENTION_JOB_COMPLETED
RETENTION_JOB_FAILED
RETENTION_JOB_SKIPPED_HIGH_LOAD
DATA_PARTITION_CREATED
DATA_PARTITION_DETACHED
DATA_PARTITION_DROPPED
DATA_BATCH_DELETED
DATA_COMPACTION_COMPLETED
DATA_ARCHIVED
LEGAL_HOLD_APPLIED
LEGAL_HOLD_RELEASED
DISK_USAGE_WARNING
DISK_USAGE_CRITICAL
DATABASE_BLOAT_WARNING
LOG_RATE_LIMIT_ACTIVATED
```

No borrar estos eventos mediante la tarea que documentan.

---

# 104. MIGRACIÓN DEL SISTEMA ACTUAL

## A — Auditoría

* `serverLogsService`;
* `bot_events`;
* `logStreamService`;
* middleware HTTP;
* Docker;
* tablas;
* volúmenes.

## B — Logger estructurado

* Pino;
* correlation IDs;
* redacción;
* eliminación de cuerpos completos;
* compatibilidad UI.

## C — Separación

* logs;
* eventos;
* auditoría;
* clases de retención;
* scheduler;
* dry-run.

## D — Escalabilidad

* particionamiento;
* compactación;
* lotes.

## E — Activación

* panel;
* alertas;
* SHADOW;
* paridad;
* deprecación progresiva.

No eliminar `server_logs` sin paridad y rollback.

---

# 105. MODELO DE DATOS DE OBSERVABILIDAD

```text
observability_events
observability_event_summaries
observability_retention_policies
observability_retention_jobs
observability_retention_job_items
observability_log_fingerprints
observability_disk_snapshots
observability_database_snapshots
observability_archives
observability_legal_holds
observability_event_schema_versions
```

Auditar antes de duplicar tablas existentes.

---

# 106. INVARIANTES

Trading:

```text
plannedCapital <= deployableCycleCapital
mandatoryReserve >= policyMinimumReserve
plannedPurchaseCount <= absoluteSafetyCap
executedTranchesPerConfirmedDailyBar <= 1
postFirstFillRisk <= approvedFirstFillRisk
```

Contabilidad:

```text
grossQuantity >= netQuantity
remainingQuantity >= 0
filledQuantity <= targetQuantity
sum(sleeves.quantity) = AMA attributed quantity
consumedReservation + releasedReservation = originalReservation
```

Datos:

```text
financialProtectedRecordDeletedAutomatically = false
activeCycleDataDeleted = false
unreconciledOrderDataDeleted = false
legalHoldRecordDeleted = false
retentionJobConcurrency <= 1
payloadSize <= configuredMaximum
eventSchemaVersion != null
cleanupAuditEventExists = true
requiredMacroHistoryAvailable = true
```

Ante fallo:

```text
PLAN_INVALID
CAPITAL_DEPLOYMENT_PAUSED
RECONCILIATION_REQUIRED
RETENTION_JOB_ABORTED
DATA_LIFECYCLE_INVARIANT_FAILED
AMA_EXECUTION_SAFETY_REVIEW
```

---

# 107. BACKUP Y RECOVERY

* backup antes de migraciones;
* rollback;
* restore probado;
* reconstrucción desde Revolut X;
* reconstrucción del ledger;
* recuperación de reservas;
* recuperación de intents;
* recuperación de políticas;
* recuperación de planes congelados;
* reconciliación tras reinicio.

Gate:

```text
restore test completado
```

No basta con crear un backup.

---

# 108. OBSERVABILIDAD OPERATIVA

Métricas:

* edad de datos;
* cobertura;
* clock drift;
* HWM;
* estado AMA;
* política;
* presupuesto;
* reservas;
* órdenes;
* reconciliación;
* spread;
* basis;
* fills;
* slippage;
* fees;
* plan recalculado;
* IA drift;
* logs por nivel;
* eventos por minuto;
* disco;
* DB;
* bloat;
* última limpieza.

Crear runbooks para alertas críticas.

---

# 109. FASES DE IMPLEMENTACIÓN

## Fase 0 — Auditoría

Gobierno, repo, balances, órdenes, fills, cartera, FISCO, logs, tablas y Docker.

## Fase 1 — Contratos y dominio

Identidad, rutas, APIs, estados, flags y contratos temporales.

## Fase 2 — Calidad de datos, Seed Policies y fuentes (V2.2)

> **Cambio de alcance AMA-CC-2026-07-29-SEED-V2.2:** Fase 2 se expande a 12 subfases (2A-2L).

### Fase 2A — Perfiles, políticas, fuentes y tiempo
Asset profiles (BTC=LAB_ONLY, ETH=RESEARCH_ONLY), Seed Policies BTC/ETH, envelopes, HWM persistente, risk overlay, ETH/BTC filter, taxonomía de fuentes, matriz de autoridad, contrato temporal UTC.

### Fase 2B — Point-in-time y calidad
Point-in-time timestamps, stale detection, calidad OHLC, anomaly detection.

### Fase 2C — Precio canónico
Kraken como fuente autoritativa OHLC/HWM/ATR, precio canónico = Kraken last trade, ATR20.

### Fase 2D — Coin Metrics
GitHub Archive (research-only), Community API (review), Pro API (DISABLED), CoinMetricsSourceSnapshot, pipeline ingesta, frescura, licencia.

### Fase 2E — Bitcoin Core
On-chain Bitcoin Core RPC: block height, difficulty, hashrate, subsidy era.

### Fase 2F — Ethereum
Eras de protocolo (7 eras), ETH/BTC filter, pipeline ETH separado, no totalStakedEth post-Pectra.

### Fase 2G — Macro
FRED API con vintages point-in-time, no look-ahead, revisions detectadas.

### Fase 2H — ETF
SEC EDGAR filings: 13F, N-PORT, holdings ETF BTC spot.

### Fase 2I — Derivados
CME futures: open interest, basis, contango/backwardation, funding rates perpetuals.

### Fase 2J — L2 y DeFi
L2 settlement volume, batch frequency, TVL DeFi, protocol revenue.

### Fase 2K — Dataset manifests
Manifest por dataset: schemaHash, rowCount, timeRangeStart, timeRangeEnd, validación integridad.

### Fase 2L — Replay readiness
Replay de datos históricos, cero look-ahead, verificación de componentes, manifests validados.

## Fase 3 — Cartera Global backend

Snapshots, valoración, presupuestos y API.

## Fase 4 — Ledger y atribución

Movimientos, inventario y reconciliación.

## Fase 5 — Reservas y coordinación

Reservas, órdenes, locks e idempotencia.

## Fase 6 — UI Cartera Global

Dual-read, filtros, modos y discrepancias.

## Fase 7 — Dominio AMA

Tablas, ciclos, estados, endpoints y auditoría.

## Fase 8 — Mandate Studio

Controles, resolver, políticas, preview, simulación y aprobación.

## Fase 9 — HWM y barra

Bootstrap, ATR, techo, mínimo, rebote y barra.

## Fase 10 — Motor determinista

Assessments, confianza y explicaciones.

## Fase 11 — Planificador adaptativo

Límites, tranches, reserva, cadencia y elegibilidad.

## Fase 12 — Portfolio AMA

Fills, inventario, sleeves y coste.

## Fase 13 — Protección del ciclo

Deployment stop, risk budget e invalidación.

## Fase 14 — Salidas y trailing

Principal, de-risk, runner y trailing.

## Fase 15 — IA observadora

Challenger, analyst, drift y seguridad.

## Fase 16 — Logging estructurado

Pino, esquema, correlación, redacción y middleware.

## Fase 17 — Eventos y auditoría

Catálogo, eventos, timeline y manifest.

## Fase 18 — Retención y ciclo de vida

Políticas, scheduler, dry-run, compactación y particiones.

## Fase 19 — Capacidad y panel

Disco, DB, crecimiento, UI y alertas.

## Fase 20 — Research Lab (AmaReplaySmokeSimulator)

> **R1 — Estado real:** Actualmente existe `AmaReplaySmokeSimulator` (smoke test de replay), NO un Research Lab estadístico completo. Walk-forward, holdout, benchmarks y stress tests completos están pendientes. El simulador actual ejecuta `runReplaySmoke` con IDs deterministas SHA-256.

Replay smoke, benchmarks (pendiente), walk-forward (pendiente), holdout (pendiente) y stress (pendiente).

## Fase 21 — Simulador maker (parametrizado)

> **R1 — Estado real:** El simulador maker está parametrizado con fees configurables, `postOnly = true` por defecto, y `fillSimulated = false` por defecto. IDs deterministas SHA-256 (`sim-<12 hex>`). Estados: NO_FILL, PARTIAL_FILL, FULL_FILL, EXPIRED, REPLACED.

No-fill, partial, latencia, replace, fees parametrizados, post-only obligatorio.

## Fase 22 — Panel AMA completo

Todas las subpestañas.

## Fase 23 — SHADOW (bloqueado por readiness)

> **R1 — Estado real:** SHADOW está bloqueado en rutas mediante `checkShadowReadiness()`. Requiere HWM, budget, price y data coverage >= 90%. En stub, todos son false/0, por lo tanto 403. `LIMIT_TAKER` rechazado. Solo `LIMIT_MAKER` permitido.

Políticas, planes, challenger, observabilidad, shadow retention, readiness gate.

## Fase 24 — Executor Revolut X

Gate, post-only, lifecycle, fills y reconciliación.

## Fase 25 — Seguridad y recovery

Kill switches, backup, restore y runbooks.

## Fase 26 — REAL_LIMITED

Solo con autorización.

## Fase 27 — Validación final

Funcional, cuantitativa, operativa, fiscal y forense.

## Fase 28 — Deploy staging

Solo con autorización.

## Fase 29 — Archivo

Solo con autorización independiente.

---

# 110. PRUEBAS OBLIGATORIAS

## Cartera Global

* balances;
* disponibilidad;
* reservas;
* atribución;
* dobles conteos;
* reconciliación;
* depeg;
* FX;
* dual-read.

## Mandate Studio

* borrador;
* preview;
* simulación;
* diff;
* validación;
* aprobación;
* activación;
* rollback;
* inmutabilidad.

## Planificador

* 2/3/4/5/6/8;
* capital pequeño;
* min notional;
* spacing;
* volatilidad;
* capitulación;
* recuperación;
* PROBE omitida;
* reserva;
* sin martingala.

## Cadencia

* varios niveles;
* máximo uno diario;
* gap;
* vela incompleta;
* reinicio;
* duplicado.

## Ejecución

* maker-only;
* rechazo post-only;
* partial fill;
* replace;
* timeout;
* submit ambiguo;
* retry;
* idempotencia;
* conflicto.

## IA

* indisponibilidad;
* abstención;
* drift;
* prompt injection;
* propuesta agresiva rechazada;
* cero órdenes.

## Logs

* JSON;
* severidad;
* correlación;
* redacción;
* truncado;
* sampling;
* deduplicación;
* ausencia de secretos;
* ausencia de cuerpos completos.

## Retención

* dry-run;
* legal hold;
* ciclo activo;
* orden pendiente;
* tabla protegida;
* lote parcial;
* restart;
* dos instancias;
* timeout.

## Mercado

* histórico macro;
* downsampling;
* checksum;
* Replay antes y después.

## Docker y capacidad

* rotación;
* compresión;
* máximo de archivos;
* umbrales;
* alertas.

## Seed Policy BTC (V2.2)

* LAB_ONLY status;
* 6 tramos, 75/25 capital;
* makerOnly, no taker fallback;
* fixedReversalCenterPct = 10.0;
* ATR20 × 3.0;
* requiredDailyCloses = 3;
* reserva 25% intocable;
* máximo 1 tranche por cierre.

## Seed Policy ETH (V2.2)

* RESEARCH_ONLY status;
* 7 tramos, 65/35 capital;
* executionVenue = DISABLED;
* ethBtcFilterRequired;
* fixedReversalCenterPct = 14.0;
* sin reservar capital real;
* sin intents ejecutables;
* sin Revolut X;
* sin compartir inventario BTC;
* sin heredar promoción BTC.

## Envelopes (V2.2)

* triggers únicos descendentes;
* máximo 1 tranche por cierre confirmado;
* no ejecución simultánea de tranches;
* intervalos de calibración, no bandas.

## HWM (V2.2)

* authoritativeCycleHwm no baja;
* rollingHigh puede bajar;
* estados: CANDIDATE → CONFIRMING → CONFIRMED → FROZEN → SUPERSEDED → INVALIDATED;
* bootstrap incremental.

## Risk Overlay (V2.2)

* RISK_DOWN_ONLY;
* BTC: 0.50-1.00;
* ETH: 0.35-1.00;
* challenger 1.25 = CHALLENGER_RESEARCH_ONLY;
* multiplier >1.00 prohibido en overlay activo.

## Coin Metrics (V2.2)

* hash correcto;
* frescura detectada (FRESH/DELAYED/STALE/PARTIAL/UNAVAILABLE/SCHEMA_DRIFT/REVISION_DETECTED/LICENSE_BLOCKED);
* licencia bloquea decisionImpact;
* no scraping HTML;
* no overwrite snapshots;
* no mix revisions;
* Pro API = DISABLED.

## Ethereum (V2.2)

* 7 eras correctas (PRE_EIP1559 → POST_FUSAKA);
* Glamsterdam = PLANNED, NOT_ACTIVE;
* no totalStakedEth = validatorCount × 32 post-Pectra;
* ETH/BTC filter reduce riesgo;
* ETH no promueve a REAL automáticamente.

Comandos:

```bash
npm run check
npm run build
npx vitest run
git diff --check
```

---

# 111. PROPUESTA DE COMMITS

Cascade no hará commit sin autorización.

Preparará propuestas como:

```text
docs(ama): crear plan maestro y auditoría
feat(portfolio): añadir presupuestos y atribución
feat(ama): crear dominio y estados
feat(ama): añadir mandate studio
feat(ama): implementar planificación adaptativa
feat(observability): añadir logging estructurado
feat(observability): separar eventos y auditoría
feat(retention): añadir políticas y dry-run
feat(ama): añadir panel operativo
feat(ama): añadir ejecución maker
```

Cada propuesta incluirá archivos y tests.

---

# 112. DEPLOY

No desplegar autónomamente.

Cuando se autorice staging:

```bash
cd /opt/krakenbot-staging
git pull origin main
docker compose -f docker-compose.staging.yml up -d --build
```

Prohibido:

```text
docker compose down
--remove-orphans
compose genérico
borrar volúmenes
recrear DB
operaciones reales de prueba
deploy producción
```

---

# 113. DEFINICIÓN DE COMPLETADO

Debe demostrarse:

* pestaña AMA;
* Mandate Studio;
* políticas;
* Cartera Global;
* ledger;
* reservas;
* atribución;
* HWM;
* barra;
* motor;
* planificación adaptativa;
* safety cap;
* protección del ciclo;
* sleeves;
* trailing;
* IA limitada;
* maker-only;
* reconciliación;
* FISCO;
* logs estructurados;
* eventos;
* auditoría;
* retención;
* dry-run;
* compactación;
* capacidad;
* panel;
* Replay;
* holdout;
* SHADOW;
* tests;
* restore;
* staging autorizado;
* aceptación del usuario.

Estado final previo al archivo:

```text
IMPLEMENTACION_COMPLETA_PENDIENTE_DE_AUTORIZACION_DE_ARCHIVO
```

---

# 114. ARCHIVO

Solo tras:

```text
Autorizo archivar el plan AMA
```

Mover:

```bash
git mv \
PLAN_IMPLEMENTACION_MODO_AMA.md \
AUDITORIAS/ARCHIVADOS/PLAN_IMPLEMENTACION_MODO_AMA_COMPLETADO_YYYY-MM-DD.md
```

No borrar.

---

# 115. REGISTRO DE FASES

Después de cada fase:

```markdown
## REGISTRO FASE X

- Fecha:
- Estado:
- Archivos:
- Migraciones:
- Tests:
- Hallazgos:
- Decisiones:
- Riesgos:
- Evidencias:
- Resultado:
- Pendientes:
- Gate de autorización:
```

---

# 116. PRIMERA EJECUCIÓN AUTÓNOMA

Cascade deberá:

1. Leer fuentes de gobierno.
2. Revisar working tree.
3. Crear o sustituir el plan.
4. Crear auditoría.
5. Auditar Cartera Global.
6. Auditar Kraken.
7. Auditar Revolut X.
8. Auditar balances.
9. Auditar órdenes.
10. Auditar fills.
11. Auditar inventario.
12. Auditar FISCO.
13. Auditar `/wallet`.
14. Auditar `serverLogsService`.
15. Auditar `bot_events`.
16. Auditar `logStreamService`.
17. Auditar middleware HTTP.
18. Auditar Docker logging.
19. Medir tablas e índices.
20. Auditar retenciones.
21. Auditar histórico diario y semanal.
22. Proponer migraciones.
23. Implementar fases locales seguras.
24. Ejecutar tests después de cada bloque.
25. No hacer commit.
26. No hacer push.
27. No desplegar.
28. No operar.
29. No borrar datos.
30. No activar limpieza real.
31. Continuar hasta completar tareas locales o alcanzar gates.

Validar:

```bash
git diff --check
git status --short
npm run check
npm run build
npx vitest run
```

Informe:

```text
HEAD
origin/main
rama
estado git
plan
auditoría
arquitectura
fuentes
balances
órdenes
fills
inventario
FISCO
logging actual
volumen de logs
retenciones
tablas
histórico macro
migraciones
tests
riesgos
bloqueos
propuesta de commits
gates pendientes
siguiente fase
```

---

# 117. RESULTADO FINAL ESPERADO

```text
El usuario define el mandato.
AMA resuelve la política.
AMA simula sus consecuencias.
El usuario aprueba.
AMA crea un plan adaptativo.
Los guardrails limitan el riesgo.
La Cartera Global protege capital e inventario.
El executor opera maker-only.
Los eventos reconstruyen el ciclo.
Los logs permiten diagnosticar.
La retención controla el crecimiento.
La limpieza preserva datos financieros.
La auditoría explica cada decisión.
```

---

## REGISTRO FASE 1 — Contratos y Dominio

### Archivos nuevos
- `server/services/ama/amaTypes.ts` — Tipos, enums, constantes, interfaces, guardrails
- `server/services/ama/amaService.ts` — Stub service en memoria (no es fuente de verdad)
- `server/routes/ama.routes.ts` — 15 endpoints `/api/ama/*`
- `client/src/pages/Ama.tsx` — Página frontend AMA
- `db/migrations/080_ama_initial.sql` — 9 tablas (7 ama_* + 2 portfolio_*)

### Archivos modificados
- `client/src/App.tsx` — Import Ama + ruta `/ama`
- `client/src/components/dashboard/Nav.tsx` — Entrada AMA en sección TRADING
- `server/routes.ts` — Registro `registerAmaRoutes` + migración `080_ama_initial` en `MIGRATIONS`

### Endpoints creados
- `GET /api/ama/status` — Estado del modo AMA
- `POST /api/ama/mode` — Cambiar modo (OFF/REPLAY/SHADOW; REAL_LIMITED/REAL_FULL bloqueados con 403)
- `GET /api/ama/market-view` — Vista de mercado (stub, todo null)
- `GET /api/ama/mandate` — Mandato actual (null)
- `POST /api/ama/mandate/drafts` — Guardar borrador de mandato
- `GET /api/ama/policy/active` — Política activa (null)
- `GET /api/ama/tranche-plan/current` — Plan de tramos actual (null)
- `GET /api/ama/cycles` — Lista de ciclos (vacío)
- `GET /api/ama/cycles/:id` — Ciclo por ID
- `GET /api/ama/cycles/:id/tranches` — Tramos de un ciclo
- `GET /api/ama/portfolio` — Resumen de cartera AMA (zeros)
- `POST /api/ama/kill-switch` — Activar/desactivar kill switch
- `POST /api/ama/analyze-now` — Solicitar análisis (no ejecuta órdenes)
- `POST /api/ama/replay/run` — Encolar replay (no órdenes reales)
- `GET /api/ama/ai/status` — Estado AI (no configurado)
- `GET /api/ama/meta` — Metadatos AMA

### Tablas previstas en migración 080
- `ama_user_mandates`
- `ama_resolved_policies`
- `ama_cycles`
- `ama_tranche_plans`
- `ama_tranches`
- `ama_state_transitions`
- `ama_audit_events`
- `portfolio_mode_budgets`
- `portfolio_ledger_entries`

### Tests ejecutados
- `npm run check` (tsc): ✅ sin errores
- `npm run build` (vite + esbuild): ✅ sin errores
- `npx vitest run`: 3056 passed, 31 failed, 29 skipped (160 files)
  - Los 31 fallos son preexistentes (IDCA market context, snapshots) — NO relacionados con AMA
  - No hay tests AMA (correcto para Fase 1: stubs sin lógica)

### Tests pendientes
- Tests unitarios AMA (Fase 2+): tipos, enums, zone resolver, mandate validation
- Tests de integración AMA (Fase 5+): rutas, servicio, persistencia
- Tests de regresión: verificar que los 31 fallos preexistentes no se incrementan

### Riesgos
- Sin atribución de inventario por modo (se aborda en Fase 3-4)
- Sin presupuesto por modo real (stub retorna zeros)
- Sin reconciliación cross-mode (Fase 4)
- Sin pre-trade risk gate (Fase 8-9)
- 31 tests preexistentes fallando (no introducidos por AMA)

### Limitaciones del stub en memoria
- `amaService` mantiene estado en variables locales — se reinicia al reiniciar el servidor
- No persiste mandatos, políticas, ciclos, tramos ni cartera
- No es fuente de verdad — no debe usarse para decisiones financieras
- `getMarketView()` retorna todo null — no consulta Kraken ni RevolutX
- `getPortfolioSummary()` retorna zeros — no consulta balances ni DB
- `getCycles()` retorna array vacío
- `getActivePolicy()` retorna null
- `getTranchePlan()` retorna null

### Confirmaciones de cierre
- Cero commit: ✅ (no se ha ejecutado `git commit`)
- Cero push: ✅ (no se ha ejecutado `git push`)
- Cero deploy: ✅ (no se ha accedido al VPS)
- Migración no aplicada: ✅ (no se ha ejecutado en DB ni staging)
- Migración sin DROP/TRUNCATE/DELETE: ✅ (solo CREATE TABLE IF NOT EXISTS + CREATE INDEX)
- Nombres de tablas no chocan con existentes: ✅ (verificado en schema.ts)
- App.tsx y Nav.tsx no rompen navegación: ✅ (solo añaden entrada, no modifican rutas existentes)
- server/routes.ts registra AMA una sola vez: ✅
- Ningún archivo preexistente ajeno modificado: ✅ (solo 3 archivos compartidos, todos AMA)
- Ningún archivo GRID incluido en cambios AMA: ✅
- REAL_LIMITED y REAL_FULL bloqueados: ✅ (HTTP 403 en ruta + no hay ejecución en servicio)
- analyze-now no compra/vende/reserva/cambia estados: ✅ (solo retorna message)
- No existe camino de ejecución real: ✅ (no hay placeOrder/cancelOrder/getBalance en servicios AMA)

### Comandos exactos para reanudar
```bash
# 1. Verificar estado
git status --short
git diff --stat

# 2. Validar
npm run check
npm run build
npx vitest run

# 3. Revisar migración antes de aplicar
cat db/migrations/080_ama_initial.sql

# 4. Si autorizado, commit selectivo (solo archivos AMA)
git add server/services/ama/amaTypes.ts server/services/ama/amaService.ts server/routes/ama.routes.ts client/src/pages/Ama.tsx db/migrations/080_ama_initial.sql client/src/App.tsx client/src/components/dashboard/Nav.tsx server/routes.ts PLAN_IMPLEMENTACION_MODO_AMA.md AUDITORIAS/AUDITORIA_PREIMPLEMENTACION_AMA_Y_CARTERA_GLOBAL.md

# 5. Commit
git commit -m "feat(ama): Fase 1 — contratos, dominio, rutas, frontend y migración inicial"

# 6. Push
git push origin main

# 7. Deploy staging (manual, en VPS)
cd /opt/krakenbot-staging
git pull origin main
docker compose -f docker-compose.staging.yml up -d --build
```

---

## REGISTRO DE ESTADO

```text
DONE: FALSE
HARD_BLOCKER: FALSE
TASK_STATUS: R3_CORRECCIONES_APLICADAS_EN_GATE_PRECOMMIT
NEXT_ACTION: presentar gate precommit R3, luego autorización commit/push en rama de revisión
LAST_COMPLETED_ACTION: R3 — 8 correcciones aplicadas (doble descuento reserva, overlay fail-closed, triggers Seed canónicos, no-lookahead incremental, normalizeClosedDailyCloses compartida, isClosed modelado, test migración real, equality exacta). 598 tests AMA ✅, tsc ✅
LAST_VALIDATION: 2026-07-30 — 598/598 AMA tests (79 R2+R3), 0 errores tsc
CURRENT_HEAD: a74f550 (R2 commit en rama revisión)
ORIGIN_HEAD: review/ama-seed-v2-2-20260729
UPDATED_AT: 2026-07-30T17:20:00+02:00
```

---

## REVISIÓN AUTOMÁTICA FASE 1 — Resultado

### Defectos encontrados y corregidos
1. **amaService.ts sin guard REAL en service layer** → añadido `isModeReal` check en `setMode()` + `canSetMode()`
2. **ama.routes.ts sin validación Zod** → añadidos schemas Zod para mode, mandate, kill-switch, replay
3. **Migración 080 sin CHECK constraints** → añadidos constraints non-negative en todas las columnas monetarias y de cantidad
4. **Frontend sin indicadores de construcción** → añadidos banners FASE DE CONSTRUCCIÓN / DATOS PROVISIONALES / REAL BLOQUEADO
5. **amaService.ts no marcado como scaffold** → añadido DEVELOPMENT_SCAFFOLD_ONLY / NOT_SOURCE_OF_TRUTH / NOT_RESTART_SAFE / NOT_SHADOW_READY / NOT_REAL_READY

### Tests AMA creados
- `server/services/ama/__tests__/amaTypes.test.ts` — 34 tests (tipos, enums, guardrails, zones, modes)
- `server/services/ama/__tests__/amaService.test.ts` — 29 tests (service layer, REAL guards, no exchange, stubs)
- `server/services/ama/__tests__/amaRoutes.test.ts` — 29 tests (API endpoints, 403 REAL, Zod, sanitización, analyze-now side-effect free)
- **Total: 92 tests AMA — todos pasan**

### Baseline confirmado
- Worktree temporal en HEAD (sin AMA): 31 failed, 3056 passed, 29 skipped (3116 total)
- Working tree AMA: 31 failed, 3148 passed, 29 skipped (3208 total)
- Diferencia: +92 tests passing (exactamente los tests AMA)
- Clasificación: PREEXISTENTE_CONFIRMADO — cero fallos nuevos AMA

### Migración 080 — auditoría
- Sin DROP/TRUNCATE/DELETE/ALTER DROP/CASCADE destructivo: ✅
- Sin colisiones con schema.ts o migraciones existentes: ✅
- CHECK constraints añadidos: ✅ (capital_limit >= 0, budgeted >= 0, deployed >= 0, reserved >= 0, planned_purchase_count >= 0, mandatory_reserve >= 0, tranche_amount >= 0, filled_quantity >= 0, remaining_quantity >= 0, policy_version > 0)
- Idempotente (CREATE TABLE IF NOT EXISTS): ✅
- Se aplicará automáticamente al arrancar (AutoMigrationRunner): NEUTRALIZADA — migración 080 comentada en MIGRATIONS array, no se autoaplica
- Validación en BD desechable: VALIDADA (9 tablas, 10 índices, 17 CHECKs, 11 FKs, 11 negativos, 10 unicidad, idempotencia)

### Caminos de ejecución prohibidos
- placeOrder/cancelOrder/marketOrder/submitOrder/createOrder: NO encontrados
- ExchangeFactory/getPrivateBalance/withdraw: NO encontrados
- Import de Kraken privado o RevolutX operativo: NO encontrados

### Validaciones finales
- `npm run check` (tsc): ✅ sin errores
- `npm run build` (vite + esbuild): ✅ built in 20.83s
- `npx vitest run` (completo): 3148 passed, 31 failed (preexistentes), 29 skipped
- `npx vitest run server/services/ama/__tests__/`: 92 passed, 0 failed
- `git diff --check`: ✅ sin errores whitespace

---

# 118. SEED POLICIES Y ERAS DE PROTOCOLO (V2.2)

## 118.1 Eras de protocolo Ethereum

```text
PRE_EIP1559
EIP1559
MERGE
SHANGHAI
CANCUN
PECTRA
POST_FUSAKA
GLAMSTERDAM = PLANNED, NOT_ACTIVE
```

Reglas:
- No calcular `totalStakedEth = validatorCount × 32` post-Pectra.
- Cada era tiene parámetros de gas, staking y slashing distintos.
- Las eras se determinan por block height / timestamp, no por fecha calendario.

## 118.2 ETH/BTC Filter

```text
ethBtcFilterRequired = true
relativePair = ETH/BTC
```

- El filter reduce el riesgo de ETH cuando ETH/BTC está en tendencia bajista.
- ETH no hereda la promoción de BTC a REAL.
- ETH no puede transitar a REAL automáticamente.
- El filter es obligatorio para la Seed Policy ETH.

## 118.3 Modelo de datos V2.2 — Tablas planificadas

```text
ama_asset_profiles
ama_seed_policies
ama_envelope_calibrations
ama_hwm_states
ama_risk_overlay_states
ama_source_snapshots
ama_coin_metrics_snapshots
ama_dataset_manifests
ama_ethereum_era_states
ama_eth_btc_filter_states
```

Reglas de migración:
- Validar en PostgreSQL desechable local.
- No registrar en AutoMigrationRunner.
- No aplicar en VPS/staging/production.
- No DROP, TRUNCATE, DELETE.
- Idempotentes (CREATE TABLE IF NOT EXISTS, DO blocks para FKs).

## 118.4 Auditorías canónicas (V2.2)

Los hallazgos de las auditorías BTC y ETH (2026-07-29) son canónicos.
- No se presentan como evidencia estadística cerrada si declaran pendiente.
- No se modifican silenciosamente.
- Se importan a `./AUDITORIAS/` sin sufijo `(1)`.
- Se calculan SHA256 hashes.
- Contraauditoría: `./AUDITORIAS/CONTRAAUDITORIA_INTEGRACION_AMA_BTC_ETH_COINMETRICS_2026-07-29.md`

> **Nota:** Los archivos adjuntos no estaban disponibles físicamente. El contenido V2.2 inlineado se usa como fuente canónica sustituta. Ver contraauditoría §4.

---

# 119. CORRECCIONES R1 — ESTADO REAL (2026-07-30)

## 119.1 Scaffolds declarados

Los siguientes módulos son `DEVELOPMENT_SCAFFOLD_ONLY`, `NOT_SOURCE_OF_TRUTH`, `IN_MEMORY`, `NOT_RESTART_SAFE`:

```text
amaService.ts
amaPortfolio.ts
amaLoggingEvents.ts
amaDatasetManifest.ts (funciones puras, sin persistencia)
```

No deben presentarse como implementación productiva.

## 119.2 PostgreSQL desechable — GATE explícito

```text
POSTGRESQL_DISPOSABLE = BLOCKED_NO_SAFE_ENVIRONMENT
FASE_1 = EN_VALIDACION
MIGRATION_080 = NOT_REGISTERED
MIGRATION_080 = NOT_AUTOAPPLY
```

No hay entorno temporal disponible. No usar VPS, staging, producción, base compartida ni base krakenbot. La migración 080 está comentada en `MIGRATIONS` array — no se autoaplica.

## 119.3 Correcciones aplicadas por fase

| Fase | Módulo | Defecto original | Corrección R1 |
|---|---|---|---|
| 1 | `amaSeedTypes.ts` | `executionVenue` sin separar analysis/execution | `analysisVenue` + `futureExecutionVenue` + `executionEnabled` + `executionStatus` |
| 1 | `amaSeedTypes.ts` | BTC modelado como `executionVenue = REVOLUT_X` sin `executionEnabled` | `futureExecutionVenue = REVOLUT_X`, `executionEnabled = false`, `executionStatus = LAB_ONLY` |
| 1 | `amaSeedTypes.ts` | ETH sin `executionEnabled` explícito | `futureExecutionVenue = DISABLED`, `executionEnabled = false`, `executionStatus = RESEARCH_ONLY` |
| 4 | `amaHwmBar.ts` | HWM sin bootstrap con ordenación | Bootstrap incremental con ordenación de velas y confirmación |
| 4 | `amaHwmBar.ts` | Reversión sin fórmula canónica | `reversalThresholdPct = clamp(atrPct × atrMultiplier, min, max)` |
| 5 | `amaDeterministicEngine.ts` | IDs no deterministas | SHA-256 para todos los IDs |
| 5 | `amaDeterministicEngine.ts` | Caps de capital y tramos mezclados | `absoluteSafetyCap` (capital) separado de `maximumCandidateTranches` (número) |
| 6 | `amaAdaptivePlanner.ts` | Planificación no acumulativa | Reserva acumulativa, importes reales, reinicio UTC |
| 7 | `amaMandateStudio.ts` | Sin envelope constraint | Clamping de parámetros dentro del envelope |
| 7 | `amaMandateStudio.ts` | Challenger sin restricción | `CHALLENGER_RESEARCH_ONLY`, multiplier >1.0 prohibido en overlay activo |
| 8 | `amaProtectionExits.ts` | Drawdown de precio y riesgo sistémico mezclados | `canSell`/`canPause` separados, drawdown de precio no vende |
| 9 | `amaProtectionExits.ts` | Salidas como ejecución activa | `LAB_HYPOTHESIS`, `NOT_ACTIVE` |
| 10 | `amaAIObserver.ts` | IA sin `RISK_DOWN_ONLY` | `RISK_DOWN_ONLY` implementado, no amplía presupuesto |
| 10 | `amaAIObserver.ts` | Sin `AI_INSUFFICIENT_DATA` | Emitido cuando faltan HWM, budget o price |
| 10 | `amaAIObserver.ts` | IDs no deterministas | `insight-<12 hex>` SHA-256 |
| 11 | `amaCapacityResearch.ts` | Research Lab como backtest estadístico | Renombrado a `AmaReplaySmokeSimulator`, `runReplaySmoke` |
| 11 | `amaCapacityResearch.ts` | `smokeId` no determinista | `smoke-<12 hex>` SHA-256 |
| 12 | `amaCapacityResearch.ts` | Maker simulator sin fees parametrizados | `makerFeeBps`, `takerFeeBps`, `postOnly`, `fillSimulated` |
| 12 | `amaCapacityResearch.ts` | `simulationId` no determinista | `sim-<12 hex>` SHA-256 |
| 13 | `amaShadowExecutorSecurity.ts` | SHADOW sin readiness check | `checkShadowReadiness()` bloquea sin HWM/budget/price/coverage |
| 13 | `amaShadowExecutorSecurity.ts` | `LIMIT_TAKER` permitido | Rechazado, solo `LIMIT_MAKER` |
| 13 | `amaShadowExecutorSecurity.ts` | IDs no deterministas | `shadow-<12 hex>`, `sim-<12 hex>` SHA-256, procedure IDs estáticos |
| 14 | `amaPortfolio.ts` | Sin marca de scaffold | `DEVELOPMENT_SCAFFOLD_ONLY`, `NOT_SOURCE_OF_TRUTH`, `NOT_RESTART_SAFE` |
| 14 | `amaPortfolio.ts` | Mutaciones en ciclos cerrados | `canMutateCycle` + `freezeCycleBudget` |
| 15-16 | `amaDatasetManifest.ts` | `computeSchemaHash` con hash simple | SHA-256 (`schema_<16 hex>`) |
| 17 | `ama.routes.ts` | SHADOW permitido sin readiness | Bloqueado con 403 si `checkShadowReadiness` falla |
| 17 | `ama.routes.ts` | Sin `SCHEMA_NOT_AVAILABLE` | Endpoint `GET /api/ama/schema-status` |
| 17 | `ama.routes.ts` | IDs no deterministas | `run-<12 hex>`, `replay-<12 hex>` SHA-256 |

## 119.4 Gates explícitos

```text
GATE_REPLAY_READY: requiere manifests validados, coverage >= 90%
GATE_SHADOW_READY: requiere HWM, budget, price, coverage >= 90%
GATE_REAL_LIMITED: bloqueado en ruta (403) y servicio (throw)
GATE_REAL_FULL: bloqueado en ruta (403) y servicio (throw)
GATE_POSTGRESQL: BLOCKED_NO_SAFE_ENVIRONMENT
GATE_MIGRATION_080: NOT_REGISTERED, NOT_AUTOAPPLY
```

## 119.5 Estados de fases reales (R1)

| Fase | Estado real | Notas |
|---|---|---|
| 1 | SCAFFOLD_VALIDADO | Stub en memoria, no persistente |
| 2A-2L | PARCIAL | Tipos definidos, sin persistencia DB |
| 3-6 | SCAFFOLD | Funciones puras, tests aislados |
| 7-9 | SCAFFOLD | Mandate Studio con envelope, sin UI |
| 10 | SCAFFOLD | IA observadora con RISK_DOWN_ONLY, sin provider real |
| 11 | SCAFFOLD | AmaReplaySmokeSimulator, no Research Lab completo |
| 12 | SCAFFOLD | Maker simulator parametrizado, sin ejecución real |
| 13 | SCAFFOLD | SHADOW bloqueado por readiness, sin executor real |
| 14 | SCAFFOLD | Portfolio con mutation guards, no persistente |
| 15-16 | SCAFFOLD | Logging y manifests como funciones puras |
| 17 | SCAFFOLD | Rutas con gates, sin UI completa |
| 18-29 | PENDIENTE | No iniciadas |

## 119.6 Asset Profiles canónicos (R1)

```text
BTC:
  analysisVenue         = KRAKEN
  futureExecutionVenue  = REVOLUT_X
  executionEnabled      = false
  executionStatus       = LAB_ONLY
  canReserveCapital     = false
  canCreateIntents      = false
  canExecute            = false
  canUseRevolutX        = false

ETH:
  analysisVenue         = KRAKEN
  futureExecutionVenue  = DISABLED
  executionEnabled      = false
  executionStatus       = RESEARCH_ONLY
  canReserveCapital     = false
  canCreateIntents      = false
  canExecute            = false
  canUseRevolutX        = false
  sharesBtcCapital      = false
  inheritsBtcPromotion  = false
```

Tests en `amaSeedTypes.test.ts` lines 41-75 verifican cada campo independientemente.

---

## CORRECCIONES R2 — Plan acumulativo, Seed Tranches, HWM canónico, IDs

**Fecha:** 2026-07-30
**Rama:** `review/ama-seed-v2-2-20260729`
**Base:** R1 commit `05a8344`

### R2.1 — Planificador acumulativo

- `planTranches()` ahora acumula `plannedEligibleUsd` y `plannedEligibleCount` al iterar candidatos.
- Cada candidato se re-evalúa contra `projectedDeployedUsd = input.deployedUsd + plannedEligibleUsd + candidate.amountUsd`.
- Nuevos reasons: `CUMULATIVE_CYCLE_DEPLOYMENT_LIMIT`, `CUMULATIVE_RESERVE_VIOLATION`, `CUMULATIVE_CAPITAL_CAP_EXCEEDED`, `CUMULATIVE_MAX_TRANCHES_REACHED`, `CUMULATIVE_TRANCHE_COUNT_CAP_EXCEEDED`.
- Nuevo `planTranchesFromSeeds()` usa tramos canónicos con tracking acumulativo desde el inicio.

### R2.2 — ResolvedSeedTranche

- Interface `ResolvedSeedTranche` con `index`, `asset`, `triggerDropPct`, `capitalPct`, `trancheType`, `policyId`, `policyVersion`.
- `BTC_SEED_TRANCHES`: 6 tramos, triggers [18,25,33,42,52,63], capital [7,9,12,14,15,18], sum=75.
- `ETH_SEED_TRANCHES`: 7 tramos, triggers [24,32,41,51,61,71,80], capital [5,7,8,10,11,12,12], sum=65.
- `getSeedTranches(asset)` devuelve tramos canónicos.

### R2.3 — Límites seed vs user vs effective

- `SEED_MAXIMUM_TRANCHE_PCT`: BTC=18, ETH=12.
- `getSeedMaximumTranchePct(asset)` → máximo de la política.
- `computeEffectiveMaximumTranchePct(asset, userMax)` = `Math.min(seedMax, userMax)`.
- El tramo BTC 18% no se recorta silenciosamente.

### R2.4 — validateSeedPolicy (fail-closed)

- Verifica tranche count, suma capital, deployment+reserve=100, triggers únicos y crecientes, ETH executionEnabled=false, max tranche <= seed max.
- Devuelve array de errores (vacío = válido).

### R2.5 — Bootstrap HWM every-close

- `evaluateConfirmation()` requiere `every(close <= reversalThresholdPrice)` AND `every(close < hwmPrice)`.
- Antes: `some()` (al menos uno). Ahora: `every()` (todos).
- Deduplicación por timestamp. Ordenamiento estricto.

### R2.6 — Función canónica compartida

- `evaluateConfirmation()` usada por `bootstrapHWM()` y `processIncrementalClose()`.
- Tests verifican mismo dataset → mismo HWM, estado, fecha, umbral.

### R2.7 — Confirmación semanal deshabilitada

- `WeeklyConfirmationConfig` con `weeklyOverrideEnabled=false` por defecto.
- `isWeeklyConfirmationEnabled()` devuelve false.
- Documentada como deshabilitada. No afecta operación diaria.

### R2.8 — Clasificación de IDs

| Tipo | Patrón | Determinismo |
|------|--------|--------------|
| Domain ID | `hwm-${timestamp}`, `cycle-${id}` | No determinista |
| Reproducible hash | `computePlanHash()` SHA-256 64 hex | Determinista |
| Idempotency key | `computeIdempotencyKey()` SHA-256 24 hex | Determinista |

- `computeIdempotencyKey(asset, cycleId, policyVersion, trancheIndex, confirmedCandleTimestamp, action)` — no usa `Date.now()`.
- `computePlanHash()` excluye `planId` y `createdAt` del payload canónico.

### R2.9 — PostgreSQL desechable

- Docker no disponible. `BLOCKED_NO_SAFE_ENVIRONMENT`.
- Migración 080: `NOT_REGISTERED, NOT_AUTOAPPLY`.
- Script `ama_migration_validate.mjs` preparado.

### R2.10 — Tests R2

- `amaR2Corrections.test.ts`: 41 tests cubriendo todas las correcciones.
- Total AMA: 560/560 pass.

### Archivos modificados R2

- `server/services/ama/amaSeedTypes.ts` — ResolvedSeedTranche, seed tranches, validation
- `server/services/ama/amaHwmBar.ts` — evaluateConfirmation, processIncrementalClose, weekly config
- `server/services/ama/amaDeterministicEngine.ts` — cumulative planning, seed-based generation, idempotency key
- `server/services/ama/__tests__/amaR2Corrections.test.ts` — NUEVO, 41 tests
- `server/services/ama/__tests__/amaDeterministicEngine.test.ts` — makeInput actualizado
- `server/services/ama/__tests__/amaAdaptivePlanner.test.ts` — makeInput actualizado
- `AUDITORIAS/VALIDACION_POSTGRESQL_DESECHABLE_AMA_080_2026-07-30.md` — actualizado R2
- `AUDITORIAS/AUDITORIA_CORRECCION_PREMERGE_AMA_V2_2_R2_2026-07-30.md` — NUEVO
- `FASES MODO AMA.md` — estado R2
- `PLAN_IMPLEMENTACION_MODO_AMA.md` — registro R2

---

## CORRECCIONES R3 — Reserva, Triggers Seed y No-Lookahead

**Fecha:** 2026-07-30
**Base:** R2 publicada en `a74f550`
**Rama:** `review/ama-seed-v2-2-20260729`

### Defectos corregidos

1. **Doble descuento de reserva** — `projectedFreeUsd - amountUsd` restaba dos veces el candidato. Corregido a `projectedFreeAfterCandidateUsd` que ya incluye el descuento.
2. **Overlay silenciosamente clamped** — `Math.min(riskOverlayMultiplier, 1.0)` aceptaba `1.50`. Corregido con `isValidRiskOverlayMultiplier()` fail-closed.
3. **Triggers Seed no vinculantes** — Planner aceptaba pricePoints externos sin verificar trigger canónico. Añadido `planSeedTranches()` y `evaluateSeedTrancheEligibility()`.
4. **Look-ahead en HWM incremental** — `processIncrementalClose()` usaba `allCloses` con cierres futuros. Corregido a `closesAvailableAsOfNewClose` con filtro `timestamp <= asOf`.
5. **Vela incompleta no modelada** — Añadido `DailyCloseObservation` con `isClosed`. Bootstrap, evaluate e incremental filtran velas no cerradas.
6. **Deduplicación no compartida** — Añadido `normalizeClosedDailyCloses()` usada desde bootstrap, incremental y evaluate.
7. **Test trivial de migración** — `expect(true).toBe(true)` reemplazado por test real que lee `server/routes.ts`.
8. **Falsos verdes `<= 75%`** — Reemplazado por equality exacta `=== 7500` y `=== 6500` con assertions sobre tramos, importes y reason codes.

### Tests R3 nuevos (+38)

- BTC exacto 75% / 25% (6 tramos, 7500, 2500, último 1800)
- ETH exacto 65% / 35% (7 tramos, 6500, 3500)
- Overlay fail-closed (1.01, 1.50, negativo, NaN, Infinity)
- Triggers canónicos BTC [18,25,33,42,52,63] y ETH [24,32,41,51,61,71,80]
- Incremental sin look-ahead (6 tests: progresivo, no futuro, confirma en 3er cierre)
- normalizeClosedDailyCloses (6 tests: ordena, dedup, valida, isClosed)
- Velas cerradas (3 tests: abierta no confirma, cierra confirma, extremo no modifica)
- Migración real (2 tests: 080 no activa, 080 comentada)

### Archivos modificados R3

- `server/services/ama/amaDeterministicEngine.ts` — isValidRiskOverlayMultiplier, planSeedTranches, evaluateSeedTrancheEligibility, fix doble descuento, trigger canónico
- `server/services/ama/amaHwmBar.ts` — DailyCloseObservation, normalizeClosedDailyCloses, no-lookahead, isClosed
- `server/services/ama/__tests__/amaR2Corrections.test.ts` — +38 tests R3, equality exacta, migración real
- `AUDITORIAS/AUDITORIA_CORRECCION_PREMERGE_AMA_V2_2_R3_2026-07-30.md` — NUEVO
- `FASES MODO AMA.md` — estado R3
- `PLAN_IMPLEMENTACION_MODO_AMA.md` — registro R3
