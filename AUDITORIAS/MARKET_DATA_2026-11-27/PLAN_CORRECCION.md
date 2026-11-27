# PLAN DE CORRECCIÓN DEFINITIVO — Issue #20 (TANGO 2)

**Solo propuesta. Nada de lo aquí descrito se ha ejecutado.** Cada fase requiere autorización expresa del propietario, es reversible y tiene pruebas aisladas previas. Versión definitiva que incorpora los requisitos TANGO 2 (issuecomment-7222576267): contingencias seguras, guards de modo estrictos, confirmación de fills, criterios de calidad de Market Data para todos los consumidores y compatibilidad con la APK NEXA.

## Principios rectores

1. **Preservar la gestión legítima de posiciones en todo momento:**
   - IDCA `live` debe poder seguir comprando y vendiendo en Revolut X.
   - Las salidas de reducción de riesgo (cierres manuales, emergency close, TimeStop, fail-safe) **nunca** se bloquean: se autentican y auditan.
   - FISCO debe poder seguir leyendo de Kraken (clave con permiso Query).
   - GRID/SPOT/AMA en SHADOW deben seguir simulando.
2. **Kraken solo datos; Revolut X único venue; SHADOW jamás ejecuta.**
3. **Contingencias seguras (TANGO 2):** ningún rollback puede restaurar la exposición pública de la API ni permisos de trading prohibidos. Un rollback solo revierte a un estado igual o más seguro. Si la reversión completa es imposible sin reabrir el riesgo, se documenta como rollback parcial y se define el estado seguro alternativo.
4. **Sin promesas de continuidad no verificadas:** antes de cortar el acceso público se prueba de extremo a extremo el canal autenticado sustituto, incluida la gestión real de posiciones desde la UI/APK. Si la prueba falla, no se ejecuta el corte.
5. **Reversibilidad y pruebas primero:** ninguna fase se aplica sin sus pruebas aisladas en verde (mocks, sin red, sin credenciales).

## Fase 0 — Decisiones del propietario (sin tocar el sistema)

| Acción | Detalle |
|---|---|
| 0.1 | Confirmar en el panel de Kraken los permisos reales de la clave actual (Query / Trade / Withdraw). |
| 0.2 | Decidir el canal de acceso remoto legítimo (túnel SSH, proxy autenticado, VPN). |
| 0.3 | Tratar por canal privado el detalle de red/topología (omitido de los documentos públicos) y decidir el tratamiento del historial ya publicado en PR #21 / Issue #20. La decisión de restringir visibilidad del repositorio corresponde al propietario. |
| 0.4 | Autorizar expresamente la Fase 1. |

## Fase 1 — Perímetro (infraestructura, sin código)

| Acción | Verificación previa obligatoria | Rollback seguro |
|---|---|---|
| La API deja de ser alcanzable desde Internet; acceso solo por el canal autenticado decidido en 0.2. Detalle técnico por canal privado. | **Antes del corte:** prueba E2E del canal autenticado — lectura de estado, una operación de gestión real de posición IDCA (o simulacro verificado) y una operación desde la APK/web. Sin esta prueba en verde no se ejecuta el corte. | El rollback **nunca** restaura la exposición pública completa anterior. Ante fallo del canal autenticado, el estado seguro alternativo es acceso temporal solo-loopback con acceso local en el host, hasta corregir el canal. |

Criterio de salida: ninguna ruta mutativa alcanzable sin autenticación desde fuera del host, y gestión legítima verificada por el canal nuevo.

## Fase 2 — Credencial Kraken de solo lectura (sin código)

| Acción | Verificación | Rollback seguro |
|---|---|---|
| Rotar la clave Kraken por una de **solo Query**. No borrar la antigua antes de verificar. | Datos de mercado siguen llegando (públicos). FISCO sigue leyendo. Órdenes a Kraken rechazadas por el venue. | Si una lectura privada legítima se rompe, se genera una clave nueva con los permisos mínimos necesarios (Query + el permiso de lectura concreto). **Jamás** se restauran permisos Trade/Withdraw como rollback. La clave antigua con permisos excesivos se revoca y no se reutiliza. |

## Fase 3 — Guards de ejecución y confirmación de fills (rama nueva desde runtime `3ae1831`, no desde main)

| # | Cambio | Hallazgos | Prueba aislada de aceptación |
|---|---|---|---|
| 3.1 | `krakenService.placeOrder/placeOrderRaw/cancelOrder` lanzan `KRAKEN_EXECUTION_FORBIDDEN` incondicionalmente | H-001 | Con cualquier configuración, placeOrder lanza; lecturas siguen funcionando |
| 3.2 | ExchangeFactory sin fallback silencioso: RX no inicializado → `VENUE_UNAVAILABLE` fail-closed con alerta | H-004 | `getExchange('revolutx')` sin init → error, nunca Kraken |
| 3.3 | `POST /api/config/active-exchange` rechaza `kraken`; UI de Integrations actualizada | H-003 | POST con kraken → 400 |
| 3.4 | **Guard de modo estricto (TANGO 2):** `mode === "live"` como condición exacta en todo envío de orden. Cualquier otro valor — `simulation`, `shadow`, `undefined`, `null`, cadena vacía, valor corrupto o desconocido — se trata como NO-live (fail-closed), nunca como live. No se admite la lógica inversa (`mode !== "live"` → real). Aplicable a `executeExit`, `manualCloseCycle`, `emergencyCloseAll`, `IdcaExecutionManager` y cualquier ruta futura | H-005, H-033 | Tabla de verdad completa: para cada valor de modo (incluidos inválidos), 0 llamadas a placeOrder salvo `live` exacto (spy) |
| 3.5 | Guard de modo en `IdcaExecutionManager` o eliminación si es código muerto | H-033 | Revisión estática + test de diagnósticos sin efectos |
| 3.6 | Autenticación en todas las rutas mutativas `/api`, incluidas las usadas por la APK NEXA | H-002 | Mutativo sin credencial → 401; con credencial → flujo normal |
| 3.7 | Guards simétricos en positions buy/close con excepción auditada para reducción de riesgo: los cierres se autentican y registran, no se bloquean | H-028 | Close autenticado funciona incluso con TRADING_ENABLED=false |
| 3.8 | **Confirmación de fills (TANGO 2):** ningún ciclo/posición se marca cerrado por la mera presencia de un identificador de orden o por respuesta de aceptación. Se requiere confirmación de ejecución real: fill confirmado por el venue (status filled/partial con cantidades) o evidencia de trade en el ledger. Órdenes pending/rechazadas/expiradas dejan el ciclo en estado intermedio explícito con alerta, nunca cerrado | H-005 relacionado | Tests: respuesta con orderId sin fill → ciclo NO cerrado; fill parcial → cantidades reales registradas; orden rechazada → ciclo sigue abierto con alerta |
| 3.9 | **Revisión exhaustiva de rutas de orden (TANGO 2):** inventario final de todas las rutas que pueden terminar en orden (actuales y de la APK): `POST /api/trade`, `/positions/:pair/buy`, `/positions/:pair/close`, `/institutional-dca/cycles/:id/close-manual`, `/institutional-dca/emergency/close-all`, `/grid-isolated/mode` (acepta REAL_LIMITED/REAL_FULL desde la APK), `/ama/kill-switch`, `/ama/analyze-now`, `/config/active-exchange`. Cada una con: autenticación, permiso, guard de venue, guard de modo, confirmación de fill e idempotencia | H-001/002/028 + APK | Matriz ruta × control verificada con test por ruta |

## Fase 4 — LOW_API Revolut X (calidad de servicio)

| # | Cambio | Hallazgos | Prueba |
|---|---|---|---|
| 4.1 | Scheduler único de llamadas privadas con prioridades (fills/órdenes/protecciones > balance > histórico) y respeto de `Retry-After` | H-007 | 429 con Retry-After N → siguiente petición ≥ N s |
| 4.2 | Eliminar `getTicker` firmado del allocator GRID; valorar BTC con referencia pública (MDS) | H-006 | Planificación SHADOW → 0 GET firmados de ticker |
| 4.3 | Caché de balance compartida entre consumidores | H-006/H-007 | Contador de requests por endpoint en métricas |

## Fase 5 — Calidad de Market Data e indicadores centralizados (TANGO 2: criterios concretos para todos los consumidores)

### 5.0 Librería centralizada de indicadores

| # | Cambio | Hallazgos | Prueba |
|---|---|---|---|
| 5.0.1 | Una única librería de indicadores (RSI Wilder, MACD, Bollinger, percentB, VWAP, EMA) consumida por todos los motores; eliminar implementaciones divergentes o documentar explícitamente cualquier convención distinta | H-030/H-031/H-032 | Fixtures E-045 como tests permanentes de referencia contra vectores independientes |
| 5.0.2 | RSI en serie plana devuelve 100 por división avgLoss=0 en ambas implementaciones (caracterización TANGO 2): definir comportamiento explícito (p. ej. 50 neutro o NaN) y test del caso | H-032 ampliado | Test: serie plana → valor definido, documentado |
| 5.0.3 | VWAP: pruebas sobre el módulo real cubriendo bandas/anclajes temporales, datos inválidos (precio 0/negativo/NaN, volumen 0) y reloj de replay, no solo el fixture sintético | H-030 | Tests sobre el módulo real importado |
| 5.0.4 | percentB NaN con precios planos: política explícita de propagación o tratamiento en cada consumidor | H-030 | Test del caso plano por consumidor |
| 5.0.5 | Nota TANGO 2: la desviación MACD 30,03 % y el desacuerdo de signo 16/66 son caracterización sobre datos sintéticos con copias parciales. No constituyen evidencia de impacto histórico en operaciones reales ni equivalen a la suite de producción. Antes de corregir MACD hay que medir el impacto real sobre datos históricos reales y consumidores concretos | H-031 | Estudio de impacto acotado previo a la corrección |

### 5.1 Criterios de calidad de datos por consumidor (H-021/H-022/H-023)

Criterios concretos aplicables a **todos** los consumidores (IDCA, SPOT, GRID, AMA, Market Metrics, UI/APK), no solo al repositorio de velas:

| # | Criterio | Especificación concreta | Prueba |
|---|---|---|---|
| 5.1.1 | Procedencia (H-021) | Cada dato consumido lleva fuente y timestamp de origen trazables; ningún consumidor acepta datos sin procedencia registrada | Test: dato sin fuente → rechazado/flagged |
| 5.1.2 | Frescura real (H-022) | La edad se mide contra el timestamp del dato en el proveedor, no contra el momento de persistencia ni contra el de otro activo. Umbral de frescura explícito por consumidor y por tipo de dato; dato caducado → el consumidor degrada (no decide con datos stale ni los trata como favorables) | Test: dato con ts antiguo persistido ahora → detectado como stale |
| 5.1.3 | Fallback (H-023) | Prohibido el fallback cruzado silencioso (dato de BTC aplicado a TON). Cualquier sustitución de fuente o activo se registra, alerta y degrada la decisión | Test: fallo de proveedor primario → sustitución registrada o rechazo, nunca silenciosa |
| 5.1.4 | Precio inválido (H-023) | Precio 0, negativo, NaN o fuera de banda razonable → rechazado antes de cualquier cálculo; nunca propagado a sizing ni a indicadores | Test con precios corruptos inyectados |
| 5.1.5 | Velas cerradas vs en formación (H-018) | Decisión explícita y uniforme por consumidor; documentada en la librería de indicadores | Test con vela en formación controlada |
| 5.1.6 | Warm-up | Ningún consumidor decide con ventanas de indicador incompletas (p. ej. EMA200 con 50 velas): mínimo de datos explícito por indicador, insuficiente → sin señal | Test con historial corto |
| 5.1.7 | Normalización en todos los consumidores (H-009/H-020) | Unidades (s/ms), zonas horarias y formato de par normalizados en un único punto de ingesta; los consumidores nunca re-normalizan por su cuenta | Test upsert con segundos → fecha correcta en todos los consumidores |

### 5.2 Correcciones específicas

| # | Cambio | Hallazgos | Prueba |
|---|---|---|---|
| 5.2.1 | Corrección EMA50 BTC→ETH y volumen relativo real en IDCA | H-016/H-017 | Fixtures E-041/E-042 invertidos |
| 5.2.2 | Market Metrics: corregir OI (serie Δ%), funding (edad por tsProvider, sin fallback cruzado), stale/NaN; o retirar el modo "activo" si no hay consumidor | H-010…H-013 | Fixture E-040 invertido |
| 5.2.3 | Reconciliar ventas sin `exchange_order_id` contra fills del venue antes de cualquier corrección | H-025 | Informe de reconciliación |

## Fase 6 — Compatibilidad APK NEXA y convergencia de ramas

| # | Cambio | Detalle |
|---|---|---|
| 6.1 | La APK NEXA (rama `feature/nexa-v2-transformacion-20261120`, SHA 2c8d6ef, Capacitor Android + web) ya implementa el modelo correcto: sesión por challenge firmado, Bearer token, permisos por rol, confirmaciones, doble confirmación para acciones peligrosas e idempotencia en cliente. La Fase 3.6 debe adoptar ese modelo de autenticación en servidor para que la APK siga funcionando como canal legítimo tras el corte del perímetro. Sus acciones mutativas (`emergencyClose`, `closeCycle`, `grid.setMode` — que acepta modos REAL —, `spot.closePosition`, `ama.killSwitch`) quedan cubiertas por la matriz de la Fase 3.9 |
| 6.2 | Verificación E2E de la APK contra el backend endurecido antes del corte de la Fase 1: cada acción mutativa de `actions.js` probada contra el servidor autenticado |
| 6.3 | Plan separado y autorizado para reconciliar `integration/staging-spot-v4` con `main` (101/43 commits divergentes). Nunca desplegar `main` directamente |
| 6.4 | Limpieza de instancia legacy inactiva (H-026), retención de `market_metrics_snapshots` (H-014), bloat de `market_candles` (H-027, causa por verificar) y análisis de los 17 529 reinicios (NO_VERIFICADO) |

## Dependencias y orden

```
Fase 0 → Fase 1 (perímetro, con E2E previo) → Fase 2 (credencial) → Fase 3 (código) → Fase 4/5 (calidad) → Fase 6 (APK/convergencia)
```

Las fases 1 y 2 contienen el riesgo P0 sin tocar código. La contención urgente (Fases 1-2) se autoriza por separado y no espera a investigaciones de rentabilidad ni a las fases de calidad.

**Este plan no autoriza por sí mismo ninguna acción. Estado: PREPARADO PARA AUTORIZACIÓN EXPRESA DEL PROPIETARIO / SIN APROBAR.**
